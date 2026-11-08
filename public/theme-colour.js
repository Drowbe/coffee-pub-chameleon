/* The colours a theme does not set, worked out from the ones it does (documentation/plans/plan-design-system.md, step 8).
   One file for two readers: the server (server/theme-css.js, which writes the picks into /theme.css; `require`d) and the theme editor
   (public/admin.js, which shows the same picks and the contrast panel as a colour is changed; a plain script, `window.ThemeColour`).

   A theme sets seven base colours and may set more (server/store.js). Four kinds of colour are picked here, never typed:
     - text on the accent fill and on each status fill: white or near-black, whichever reaches 4.5:1 (the accent's own text colour in
       the theme is kept while it already reaches 4.5:1; else the pick replaces it). If neither reaches it, the fill is flagged.
     - the accent as text (links): the accent itself if it reaches 4.5:1 on the page and on a panel, else the accent mixed with the
       least text colour that does.
     - each status colour as text: the fill with at least 30% text colour, the least that reaches 4.5:1 on the page, a panel and
       its own soft background.
     - the OK green as a mark (bars, the presence dot): the fill, or the least text colour mixed in that reaches 3:1 on the page and a panel.
   The soft backgrounds, hover fills and the rest are formulas in public/sdk/system.css and are not worked out here, except where a
   pick has to be tested against one (a status tint over a panel). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ThemeColour = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const WHITE = '#ffffff';
  const NEAR_BLACK = '#0a0a0a';
  const MIN_TEXT = 4.5;
  const MIN_MARK = 3;
  const STATUSES = ['danger', 'ok', 'warn', 'info'];
  // The word a person reads for each (the Colour family's: Danger, OK, Warning, Info).
  const STATUS_WORD = { danger: 'Danger', ok: 'OK', warn: 'Warning', info: 'Info' };

  // What each status fill is while a theme leaves it on Auto, per mode (the same values as --danger and --ok and the light and dark
  // category tints in public/style.css; tools/check-theme.mjs holds the two together).
  // (In the order of STATUSES; written as lists so that no line here reads as a stylesheet declaration.)
  const AUTO_FILLS = {
    dark: ['#b8503f', '#6fae6b', '#d9a93c', '#6aa6e8'],
    light: ['#b8503f', '#6fae6b', '#94680a', '#2a62b0'],
  };
  const STATUS_AUTO = Object.fromEntries(Object.entries(AUTO_FILLS).map(([mode, list]) => [mode, Object.fromEntries(STATUSES.map((k, i) => [k, list[i]]))]));

  // The formula public/sdk/system.css gives each optional role while a theme leaves it on Auto, as CSS. The editor sets these on the
  // page when a field is on Auto so that the preview shows the formula even when the live theme sets that role.
  // tools/check-system-css.mjs holds them equal to system.css.
  const AUTO_CSS = {
    'surface-card': 'color-mix(in srgb, var(--surface-panel) 92%, var(--text-primary))',
    'surface-bar-top': 'var(--surface-page)',
    'text-bar': 'var(--text-primary)',
    'surface-bar-brand': 'color-mix(in srgb, var(--surface-bar-top) 97%, black)',
    'text-bar-brand': 'var(--text-bar)',
    'surface-bar-right': 'color-mix(in srgb, var(--surface-bar-top) 97%, black)',
    'text-bar-right': 'var(--text-bar)',
    'icon-default': 'var(--text-muted)',
    'icon-hover': 'var(--accent-fill)',
    'accent-fill-hover': 'color-mix(in srgb, var(--accent-fill) 85%, white)',
    'fill-secondary': 'var(--surface-card)',
    'text-on-secondary': 'var(--text-primary)',
    'fill-secondary-hover': 'color-mix(in srgb, var(--surface-card) 94%, var(--text-primary))',
    'surface-field': 'color-mix(in srgb, var(--surface-page) 85%, var(--edge-hairline))',
    'surface-menu': 'color-mix(in srgb, var(--surface-panel) 96%, var(--text-primary))',
    'surface-bar-nav': 'var(--surface-page)',
    'edge-field': 'color-mix(in srgb, var(--edge-hairline) 80%, var(--text-primary))',
    'wash-ink': 'var(--accent-fill)',
    'fill-chosen': 'var(--accent-fill)',
    'text-on-chosen': 'var(--text-on-accent)',
    'ink-chosen': 'var(--accent-fill)',
    'mf-surface-title': 'color-mix(in srgb, var(--surface-panel) 70%, black)',
    'mf-surface-toolbar': 'color-mix(in srgb, var(--surface-panel) 93%, var(--text-primary))',
    'mf-surface-row': 'color-mix(in srgb, var(--surface-panel) 94%, var(--accent-fill))',
    'mf-surface-row-hover': 'color-mix(in srgb, var(--surface-panel) 88%, var(--accent-fill))',
  };

  // SCAFFOLDING, deleted with the old tokens when their last consumer moves (plan-design-system.md, step 36): four roles whose old
  // token has a default that is not the role's own, so a theme that sets the role is written to the old token as well
  // (server/theme-css.js), and the editor's preview does the same. LEGACY_AUTO is each old token's own default.
  const LEGACY = {
    'surface-card': '--bg-card',
    'surface-field': '--bg-input',
    'fill-secondary': '--secondary',
    'fill-secondary-hover': '--secondary-hover',
    'icon-default': '--icon',
  };
  const LEGACY_AUTO = { '--bg-input': 'color-mix(in srgb, var(--surface-page) 85%, var(--edge-hairline) 15%)', '--bg-card': 'var(--bg-input)', '--secondary': 'var(--surface)', '--secondary-hover': 'var(--surface-hover)', '--icon': 'initial' };

  const hexOf = (x) => (typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x) ? x.toLowerCase() : null);
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (c) => `#${c.map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
  const lum = (c) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratioRgb = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // The WCAG 2 contrast ratio of two #rrggbb colours.
  const contrast = (a, b) => ratioRgb(rgb(a), rgb(b));
  // `top` at `alpha` laid over `under`.
  const over = (top, alpha, under) => top.map((v, i) => v * alpha + under[i] * (1 - alpha));

  // White or near-black on a fill, whichever has more contrast with it; ok when that reaches 4.5:1.
  function pickOn(fill) {
    const f = rgb(fill);
    const w = ratioRgb(rgb(WHITE), f);
    const d = ratioRgb(rgb(NEAR_BLACK), f);
    const best = Math.max(w, d);
    return { hex: w >= d ? WHITE : NEAR_BLACK, ratio: best, ok: best >= MIN_TEXT };
  }

  // The fill itself, or the fill mixed with the least text colour (from `floor` percent, in whole percents) that reaches `min` on
  // every one of `backgrounds` (flattened #rrggbb colours). A hair over `min` is asked for so that the browser's own rounding of the
  // backgrounds it mixes cannot take the result under it.
  function pickMix(fill, text, backgrounds, floor, min) {
    const f = rgb(fill);
    const t = rgb(text);
    const bgs = backgrounds.map(rgb);
    let last = null;
    for (let p = floor; p <= 100; p += 1) {
      const k = p / 100;
      const c = f.map((v, i) => Math.round(v * (1 - k) + t[i] * k));
      const worst = Math.min(...bgs.map((b) => ratioRgb(c, b)));
      last = { hex: toHex(c), percent: p, ratio: worst, ok: worst >= min };
      if (worst >= min + 0.01) return { ...last, ok: true };
    }
    return last;
  }

  // Everything a set (one mode of a theme: role name -> #rrggbb, the seven base roles at least) decides for itself, for `mode`
  // ('light' or 'dark', which picks the Auto status fills). Answers
  //   picks   role -> #rrggbb, the colours /theme.css writes that the theme does not type: text-on-accent (the theme's own while
  //           it reaches 4.5:1 on the accent, else the pick), text-accent, status-<k>-text, status-<k>-on-fill, status-ok-mark
  //   fills   status -> the fill in force (the theme's, else the Auto one)
  //   report  the pairs a person reads, each { id, label, fg, bg, ratio, min, kind } -- kind 'text' (needs 4.5), 'mark' (needs 3) or
  //           'info' (no minimum) -- and `ok` false when it is below its minimum
  //   flags   what could not be made to pass, as plain sentences
  function resolve(set, mode) {
    const m = mode === 'light' ? 'light' : 'dark';
    const page = hexOf(set['surface-page']);
    const panel = hexOf(set['surface-panel']);
    const text = hexOf(set['text-primary']);
    const muted = hexOf(set['text-muted']);
    const edge = hexOf(set['edge-hairline']);
    const accent = hexOf(set['accent-fill']);
    if (!page || !panel || !text || !muted || !edge || !accent) return null;

    const picks = {};
    const fills = {};
    const report = [];
    const flags = [];
    const add = (id, label, fg, bg, min, kind, extra) => {
      const ratio = contrast(fg, bg);
      report.push({ id, label, fg, bg, ratio, min, kind, ok: min === 0 || ratio >= min, ...(extra || {}) });
    };

    add('text-on-page', 'Text on the page', text, page, MIN_TEXT, 'text');
    add('text-on-panel', 'Text on a panel', text, panel, MIN_TEXT, 'text');
    add('muted-on-page', 'Muted text on the page', muted, page, MIN_TEXT, 'text');
    add('muted-on-panel', 'Muted text on a panel', muted, panel, MIN_TEXT, 'text');

    const asText = pickMix(accent, text, [page, panel], 0, MIN_TEXT);
    picks['text-accent'] = asText.hex;
    add('accent-text-on-page', 'Accent as text (links), on the page', asText.hex, page, MIN_TEXT, 'text', { picked: asText.percent > 0 });
    add('accent-text-on-panel', 'Accent as text (links), on a panel', asText.hex, panel, MIN_TEXT, 'text', { picked: asText.percent > 0 });
    add('accent-mark-on-page', 'Accent as a mark (bars, focus ring), on the page', accent, page, MIN_MARK, 'mark');

    const stored = hexOf(set['text-on-accent']);
    const onAccentPick = pickOn(accent);
    const keepStored = stored && contrast(stored, accent) >= MIN_TEXT;
    picks['text-on-accent'] = keepStored ? stored : onAccentPick.hex;
    add('on-accent', 'Text on the accent', picks['text-on-accent'], accent, MIN_TEXT, 'text', {
      picked: !keepStored, pick: onAccentPick.hex, stored, own: stored ? contrast(stored, accent) : null,
    });
    if (!picks['text-on-accent'] || contrast(picks['text-on-accent'], accent) < MIN_TEXT) flags.push('Neither white nor near-black reaches 4.5 : 1 on the accent.');

    for (const k of STATUSES) {
      const fill = hexOf(set[`status-${k}-fill`]) || STATUS_AUTO[m][k];
      fills[k] = fill;
      const tint = toHex(over(rgb(fill), 0.12, rgb(panel)));
      const on = pickOn(fill);
      picks[`status-${k}-on-fill`] = on.hex;
      add(`${k}-on-fill`, `Text on the ${STATUS_WORD[k]} fill`, on.hex, fill, MIN_TEXT, 'text');
      if (!on.ok) flags.push(`Neither white nor near-black reaches 4.5 : 1 on the ${STATUS_WORD[k]} fill.`);
      const t = pickMix(fill, text, [page, panel, tint], 30, MIN_TEXT);
      picks[`status-${k}-text`] = t.hex;
      add(`${k}-text-on-page`, `${STATUS_WORD[k]} as text, on the page`, t.hex, page, MIN_TEXT, 'text');
      add(`${k}-text-on-panel`, `${STATUS_WORD[k]} as text, on a panel`, t.hex, panel, MIN_TEXT, 'text');
      if (k === 'ok') {
        const mark = pickMix(fill, text, [page, panel], 0, MIN_MARK);
        picks['status-ok-mark'] = mark.hex;
        add('ok-mark', 'OK as a mark (bars, dots), on the page', mark.hex, page, MIN_MARK, 'mark', { picked: mark.percent > 0 });
      } else {
        add(`${k}-mark`, `${STATUS_WORD[k]} as a mark, on the page`, fill, page, MIN_MARK, 'mark');
      }
    }

    add('border-on-page', 'Border on the page (a quiet line by design)', edge, page, 0, 'info');
    return { picks, fills, report, flags };
  }

  return { WHITE, NEAR_BLACK, MIN_TEXT, MIN_MARK, STATUSES, STATUS_WORD, STATUS_AUTO, AUTO_CSS, LEGACY, LEGACY_AUTO, hexOf, contrast, pickOn, pickMix, resolve };
}));
