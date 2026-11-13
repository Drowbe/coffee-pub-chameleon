/* The design system page's engine (public/design-system/index.html). Plain script, no build, no external script.
 *
 * It reads the product's own stylesheets (style.css, sdk/system.css, sdk/host.css, theme.css and each module's) as text, and draws:
 *   - Tokens: every custom property on :root, in light and dark, with contrast; and what the stylesheets use today
 *     (font sizes, padding, shadows, z-index, breakpoints, transitions...) counted from the CSS so the page cannot drift.
 *   - Components: window.DS_FAMILIES (components*.js) as blocks, one per family block of public/sdk/system.css and the few
 *     looks public/style.css still draws; each family's examples are the product's real markup, drawn in a small same-origin
 *     frame that carries only the stylesheets that page or module really has: an app page has style.css, the theme and
 *     system.css; a module's page has system.css and host.css (the server puts them in), and the module's own.
 *     tools/check-design-system-catalog.mjs fails on a class in an example that none of those stylesheets has a rule for. Forced hover, focus and pressed come from copying the stylesheet's own
 *     :hover, :focus and :active rules to classes (never a second copy of a look). Light and dark set <html data-theme-mode>.
 *   - Live SDK pieces: the real public/sdk/host.js, with a stand-in host (`call`), mounts host.ui.* and host.menu.show.
 *   - Icons: the Font Awesome Free solid icons the product uses (DS_SOURCES.icons, found by tools/design-system-snapshot.mjs).
 * Nothing here is a second source of a component's look.
 */
(() => {
  'use strict';
  const D = document;
  const SRC = window.DS_SOURCES || {};
  const FILES = SRC.files || {};
  const PATHS = {
    'style.css': '/style.css', 'system.css': '/sdk/system.css', 'host.css': '/sdk/host.css', 'theme.css': '/theme.css', 'host.js': '/sdk/host.js', 'tooltip.js': '/tooltip.js',
    'destination.css': '/destination.css', 'diag.css': '/diag.css',
  };
  const stats = { frames: 0, loaded: 0, families: 0, variants: 0, examples: 0, errors: [], notLoaded: [], forcedRules: 0, tokens: 0, icons: 0, orphans: [] };
  window.__dsStats = stats;
  window.addEventListener('error', (e) => stats.errors.push(String(e.message || e)));

  const h = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = (sel, root) => (root || D).querySelector(sel);
  const $$ = (sel, root) => [...(root || D).querySelectorAll(sel)];
  const mk = (tag, cls, html) => { const e = D.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // ---- sources ----
  const text = {}; // file name -> css or js text
  async function load(name) {
    if (FILES[name] != null) { text[name] = FILES[name]; return; }
    try {
      const r = await fetch(PATHS[name]);
      if (r.ok) { text[name] = await r.text(); return; }
    } catch (e) { /* offline */ }
    text[name] = '';
    stats.notLoaded.push(name);
  }
  const MODS = SRC.modules || {}; // id -> { files: [{ file, text }] }
  const pageFiles = (id) => ((MODS[id] && MODS[id].files) || []).filter((f) => f.page !== false);
  const widgetFiles = (id) => ((MODS[id] && MODS[id].files) || []).filter((f) => /-widget\.css$/.test(f.file));
  const widgetCss = (id) => widgetFiles(id).map((f) => f.text).join('\n');
  const modCss = (id) => pageFiles(id).map((f) => f.text).join('\n');

  // ---- the stylesheets as parsed rules (any origin, even from disk) ----
  function parse(cssText) {
    const s = new CSSStyleSheet();
    try { s.replaceSync(cssText); } catch (e) { stats.errors.push('parse: ' + e.message); }
    return s;
  }
  function* walk(rules, media) {
    for (const r of rules) {
      if (r.constructor && r.constructor.name === 'CSSKeyframesRule') continue;
      if (r.type === 1) yield { rule: r, media };
      if (r.cssRules && r.type !== 1) yield* walk(r.cssRules, r.type === 4 || r.type === 12 || r.constructor.name === 'CSSContainerRule' ? (r.conditionText || (r.media && r.media.mediaText) || '') : media);
      else if (r.cssRules && r.type === 1) yield* walk(r.cssRules, media);
    }
  }
  function decls(rule) {
    const t = rule.cssText;
    const body = t.slice(t.indexOf('{') + 1, t.lastIndexOf('}'));
    const out = [];
    let depth = 0; let quote = ''; let cur = '';
    for (const ch of body) {
      if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (ch === ';' && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out.map((d) => { const i = d.indexOf(':'); return i < 0 ? null : [d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).replace(/!important/i, '').trim().replace(/\s+/g, ' ')]; }).filter(Boolean);
  }

  // ---- contexts: which stylesheets a page or module really has ----
  const MODULE_ORDER = ['assistant', 'budget', 'calendar', 'maps', 'polls', 'research', 'stream', 'todo', 'travel'];
  function ctxLabel(ctx) {
    if (ctx === 'app') return 'An app page (public/style.css, the theme and public/sdk/system.css)';
    if (ctx === 'host') return 'A module page (public/sdk/system.css and public/sdk/host.css)';
    if (ctx.startsWith('widget:')) return `The ${ctx.slice(7)} dashboard widget (system.css, host.css and its widget stylesheet)`;
    return `The ${ctx.slice(4)} module (system.css, host.css and its own stylesheet)`;
  }
  // The menu's and the more button's CSS is a string inside host.js (UI_CSS), added to a module's page when the SDK starts.
  const uiCss = () => { const m = /const UI_CSS = `([\s\S]*?)`;/.exec(text['host.js'] || ''); return m ? m[1] : ''; };
  // In the order the product loads them: an app page links style.css, the theme, then system.css; a module's page gets
  // system.css then host.css from the server (server/index.js), then its own stylesheet.
  function ctxSheets(ctx) {
    if (ctx === 'app') return [text['style.css'], text['theme.css'], text['system.css']];
    if (ctx === 'host') return [text['system.css'], text['host.css'], uiCss()];
    if (ctx.startsWith('widget:')) return [text['system.css'], text['host.css'], uiCss(), widgetCss(ctx.slice(7))];
    return [text['system.css'], text['host.css'], uiCss(), modCss(ctx.slice(4))];
  }
  const SYS = { file: 'public/sdk/system.css', get text() { return text['system.css']; } };
  function ctxFiles(ctx) {
    if (ctx === 'app') return [{ file: 'public/style.css', text: text['style.css'] }, { file: 'public/theme.css', text: text['theme.css'] }, SYS];
    if (ctx === 'host') return [SYS, { file: 'public/sdk/host.css', text: text['host.css'] }];
    if (ctx.startsWith('widget:')) return [SYS, { file: 'public/sdk/host.css', text: text['host.css'] }, ...widgetFiles(ctx.slice(7)).map((f) => ({ file: f.file, text: f.text }))];
    return [SYS, { file: 'public/sdk/host.css', text: text['host.css'] }, ...pageFiles(ctx.slice(4)).map((f) => ({ file: f.file, text: f.text }))];
  }
  // "file:line" of the first rule whose selector starts with `sel`, searched last file first (the module's own rule wins over the base).
  function locate(ctx, sel) {
    if (!sel) return '';
    const files = ctxFiles(ctx).slice().reverse();
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exact = new RegExp('(^|\\n)\\s*' + esc + '\\s*\\{');
    const loose = new RegExp('(^|[\\s,}>+~])' + esc + '(?![A-Za-z0-9_-])[^{;]*\\{', 'm');
    for (const rx of [exact, loose]) {
      for (const f of files) {
        const m = rx.exec(f.text || '');
        if (m) return `${f.file}:${(f.text.slice(0, m.index + m[1].length).match(/\n/g) || []).length + 1}`;
      }
    }
    return '';
  }

  // ---- frames ----
  // The same list as public/module-host.js (THEME_TOKENS): what a module's frame is given of the host's theme.
  const THEME_TOKENS = ['--bg', '--bg-section', '--bg-card', '--bg-input', '--border', '--text', '--text-dim', '--accent', '--on-accent', '--accent-hover', '--primary-hover', '--secondary', '--secondary-text', '--secondary-hover', '--header-bg', '--header-text', '--icon-hover', '--danger', '--ok', '--surface', '--surface-hover', '--shade',
    '--accent-fill', '--accent-fill-hover', '--text-on-accent', '--fill-secondary', '--fill-secondary-hover', '--text-on-secondary', '--edge-hairline', '--text-primary', '--text-muted', '--fill-hover', '--fill-selected', '--text-selected', '--focus-ring', '--status-danger-fill', '--status-danger-text', '--status-danger-on-fill',
    '--tint-gold', '--tint-blue', '--tint-green', '--tint-teal', '--tint-purple', '--tint-red', '--tint-orange', '--tint-pink'];
  let mode = 'dark';
  let width = 'fit';
  let FA_HREF = '';
  // What the SDK does for a module's frame (module-host.js, readTheme): the host's computed tokens, as custom properties.
  function tokenStyle(m) {
    const root = D.documentElement;
    const prev = root.dataset.themeMode;
    if (m && m !== prev) root.dataset.themeMode = m; // a frame pinned to the other mode reads that mode's tokens
    const cs = getComputedStyle(root);
    const out = THEME_TOKENS.map((t) => { const v = cs.getPropertyValue(t).trim(); return v ? `${t}:${v}` : ''; }).filter(Boolean).join(';');
    if (root.dataset.themeMode !== prev) root.dataset.themeMode = prev;
    return out;
  }
  const FRAME_CSS = `
html, body { min-height: 0 !important; height: auto !important; overflow-x: hidden; }
body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: var(--font-ui, system-ui, sans-serif); font-size: 14px; }
.dsf { padding: 4px 14px 14px; }
.dsf-var { padding: 12px 0 14px; border-top: 1px solid var(--border); }
.dsf-var:first-child { border-top: 0; }
.dsf-cap { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; margin: 0 0 8px; font-size: 12px; line-height: 1.4; color: var(--text-dim); }
.dsf-cap b { color: var(--text); font-size: 13px; font-weight: 700; }
.dsf-cap code, .dsf-note code { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text-dim); overflow-wrap: anywhere; }
.dsf-note { margin: 0 0 8px; color: var(--text-dim); font-size: 12px; max-width: 80ch; }
.dsf-states { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 14px 24px; }
.dsf-state { display: flex; flex-direction: column; gap: 5px; min-width: 0; max-width: 100%; }
.dsf-state > small { color: var(--text-dim); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.dsf-ex { min-width: 0; max-width: 100%; }
.dsf-wide .dsf-state, .dsf-wide .dsf-ex { width: 100%; }
.dsf-static .dsf-ex > * { position: static !important; transform: none !important; inset: auto !important; max-height: none !important; }
.dsf-box { position: relative; }
.dsf-md { margin-top: 10px; font-size: 12px; }
.dsf-md summary { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; color: var(--text-dim); }
.dsf-md pre { margin: 6px 0 0; padding: 10px; overflow: auto; border-radius: var(--radius-small); background: var(--shade, var(--bg-section)); color: var(--text); font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.dsf-copy { margin-left: 8px; padding: 2px 9px; border: 1px solid var(--border); border-radius: var(--radius-small); background: var(--secondary); color: var(--secondary-text); font: inherit; font-size: 11px; cursor: pointer; }
.dsf-copy:hover { background: var(--secondary-hover); }
.ds-force-disabled { opacity: .5; }
`;
  function frameHtml(ctx, body, opts = {}) {
    const sheets = ctxSheets(ctx).map((s) => `<style>${s || ''}</style>`).join('');
    const m = opts.pin || mode;
    const inline = ctx === 'app' ? '' : ` style="${h(tokenStyle(m))}"`;
    return `<!doctype html><html lang="en" data-theme-mode="${m}"${inline}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${FA_HREF}">${sheets}<style>${FRAME_CSS}${opts.css || ''}</style></head><body><div class="dsf">${body}</div></body></html>`;
  }

  // Forced states: for every rule with :hover, :focus or :active, add a copy that matches a class instead (right after
  // the original, so the cascade is the same), and the example gets the class.
  const PSEUDO = /:(hover|focus-visible|focus-within|focus|active)(?![A-Za-z-])/g;
  const FORCE = { hover: 'ds-force-hover', 'focus-visible': 'ds-force-focus', 'focus-within': 'ds-force-focus', focus: 'ds-force-focus', active: 'ds-force-active' };
  function addForceRules(doc) {
    let added = 0;
    const handle = (parent) => {
      const list = parent.cssRules;
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const r = list[i];
        if (r.type === 1) {
          PSEUDO.lastIndex = 0;
          if (!PSEUDO.test(r.selectorText)) continue;
          PSEUDO.lastIndex = 0;
          const sel = r.selectorText.replace(PSEUDO, (_, k) => '.' + FORCE[k]);
          const t = r.cssText;
          try { parent.insertRule(sel + ' ' + t.slice(t.indexOf('{')), i + 1); added += 1; } catch (e) { /* a selector the clone cannot be written for */ }
        } else if (r.cssRules && r.constructor.name !== 'CSSKeyframesRule') handle(r);
      }
    };
    for (const s of doc.styleSheets) { try { handle(s); } catch (e) { /* a sheet we cannot read */ } }
    stats.forcedRules += added;
    return added;
  }

  function pretty(html) {
    const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/;
    const INLINE = /^(a|b|i|em|strong|span|code|small|u|s|kbd|abbr|sub|sup|label|svg|path|circle|rect|g|polyline|line)$/;
    const parts = html.replace(/>\s+</g, '><').split(/(?=<)|(?<=>)/).filter(Boolean);
    let out = ''; let depth = 0; let line = '';
    const flush = () => { if (line.trim()) out += '  '.repeat(Math.max(0, depth)) + line.trim() + '\n'; line = ''; };
    let inlineDepth = 0;
    for (const p of parts) {
      const m = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(p);
      if (!m) { line += p; continue; }
      const tag = m[1].toLowerCase();
      const closing = p.startsWith('</');
      const selfClosing = VOID.test(tag) || p.endsWith('/>');
      if (INLINE.test(tag)) { line += p; if (!closing && !selfClosing) inlineDepth += 1; else if (closing) inlineDepth = Math.max(0, inlineDepth - 1); continue; }
      if (inlineDepth) { line += p; continue; }
      if (closing) { flush(); depth -= 1; line = p; flush(); } else if (selfClosing) { flush(); line = p; flush(); } else { flush(); line = p; flush(); depth += 1; }
    }
    flush();
    return out.trim();
  }

  // One state cell's html: the example with a forced class, an attribute or its own replacement.
  function stateHtml(v, st) {
    if (st.html) return st.html;
    const t = D.createElement('template');
    t.innerHTML = v.html;
    const target = v.target ? t.content.querySelector(v.target) : t.content.firstElementChild;
    if (target) {
      if (st.force) target.classList.add('ds-force-' + st.force);
      if (st.cls) for (const c of st.cls.split(' ')) target.classList.add(c);
      for (const [k, val] of Object.entries(st.attrs || {})) target.setAttribute(k, val);
    }
    return t.innerHTML;
  }
  const STATE_NAMES = {
    hover: { n: 'Hover', force: 'hover' }, focus: { n: 'Focus', force: 'focus' }, active: { n: 'Pressed', force: 'active' },
    disabled: { n: 'Disabled', attrs: { disabled: '', 'aria-disabled': 'true' } },
    on: { n: 'On', cls: 'on' }, selected: { n: 'Selected', attrs: { 'aria-selected': 'true' } },
    current: { n: 'Current', attrs: { 'aria-current': 'page' } }, pressed: { n: 'Pressed (on)', attrs: { 'aria-pressed': 'true' } },
    invalid: { n: 'Error', attrs: { 'aria-invalid': 'true' } }, checked: { n: 'Checked', attrs: { checked: '' } },
  };

  let seq = 0;
  function variantHtml(fam, v, ctx) {
    seq += 1;
    const states = (v.states || []).map((s) => (typeof s === 'string' ? STATE_NAMES[s] : s)).filter(Boolean);
    const cells = [{ n: states.length ? 'Rest' : '', html: v.html }, ...states.map((s) => ({ n: s.n, html: stateHtml(v, s) }))];
    const where = v.where || locate(ctx, v.sel);
    const cap = `<header class="dsf-cap"><b>${h(v.n)}</b>${where ? `<code>${h(where)}</code>` : ''}</header>${v.note ? `<p class="dsf-note">${v.note}</p>` : ''}`;
    const body = cells.map((c) => `<div class="dsf-state">${c.n ? `<small>${h(c.n)}</small>` : ''}<div class="dsf-ex">${c.html}</div></div>`).join('');
    return `<section class="dsf-var${v.wide ? ' dsf-wide' : ''}${v.static ? ' dsf-static' : ''}${v.box ? ' dsf-box' : ''}" data-v="${seq}">${cap}<div class="dsf-states">${body}</div><details class="dsf-md"><summary>Markup</summary><button type="button" class="dsf-copy">Copy</button><pre></pre></details></section>`;
  }

  const frames = []; // { iframe, ctx, famId }
  const frameReady = [];
  function setWidth(f) {
    f.iframe.style.width = f.pinWidth ? f.pinWidth + 'px' : width === 'fit' ? '100%' : width + 'px';
  }
  function makeFrame(ctx, bodyHtml, o = {}) {
    const wrap = mk('div', 'ds-frame-wrap');
    const iframe = D.createElement('iframe');
    iframe.className = 'ds-frame';
    iframe.title = o.title || 'Examples';
    iframe.setAttribute('loading', 'eager');
    iframe.style.height = (o.height || 160) + 'px';
    const f = { iframe, ctx, fixed: o.height || 0, wrap, pin: o.pin || '', pinWidth: o.pinWidth || 0, fit: null };
    frames.push(f);
    stats.frames += 1;
    const ready = new Promise((resolve) => {
      iframe.addEventListener('load', () => {
        const doc = iframe.contentDocument;
        if (!doc || !doc.body) { resolve(); return; }
        addForceRules(doc);
        for (const section of doc.querySelectorAll('.dsf-var')) {
          const ex = section.querySelector('.dsf-ex');
          const pre = section.querySelector('pre');
          if (ex && pre) pre.textContent = pretty(ex.innerHTML.replace(/\s*\bds-force-(hover|focus|active)\b/g, '').replace(/ class=""/g, ''));
        }
        doc.addEventListener('click', (e) => {
          const b = e.target.closest && e.target.closest('.dsf-copy');
          if (b) {
            const t = b.parentElement.querySelector('pre').textContent;
            const done = () => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1400); };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, done); else done();
          }
          // The examples are pictures of the product: a link or a form in one goes nowhere.
          // A link to another design system page (target="_top") does go there.
          const a = e.target.closest && e.target.closest('a[href]');
          if (a && a.target !== '_top') e.preventDefault();
        });
        doc.addEventListener('submit', (e) => e.preventDefault());
        if (!f.fixed) {
          const fit = () => { const n = Math.ceil(doc.body.getBoundingClientRect().height + 2) + 'px'; if (iframe.style.height !== n) iframe.style.height = n; };
          fit();
          f.fit = fit;
          if (window.ResizeObserver) new ResizeObserver(() => requestAnimationFrame(fit)).observe(doc.body);
        }
        stats.loaded += 1;
        if (o.onLoad) { try { o.onLoad(iframe, doc); } catch (e) { stats.errors.push('frame: ' + e.message); } }
        resolve();
      }, { once: true });
    });
    frameReady.push(ready);
    setWidth(f);
    iframe.srcdoc = frameHtml(ctx, bodyHtml, o);
    wrap.appendChild(iframe);
    return wrap;
  }

  // ---- components ----
  function familyBlock(fam, n) {
    const block = mk('section', 'ds-block');
    block.id = fam.id;
    block.dataset.name = [fam.name, fam.id, fam.desc || '', (fam.variants || []).map((v) => v.n).join(' ')].join(' ').toLowerCase();
    block.setAttribute('aria-labelledby', fam.id + '-h');
    const variants = fam.variants || [];
    const groups = [];
    for (const v of variants) {
      const ctx = v.ctx || 'app';
      let g = groups.find((x) => x.ctx === ctx);
      if (!g) groups.push(g = { ctx, items: [] });
      g.items.push(v);
    }
    stats.variants += variants.length;
    stats.examples += variants.reduce((a, v) => a + 1 + (v.states || []).length, 0);
    const blockId = fam.block || fam.id;
    const from = SYS_BLOCKS.has(blockId) ? `public/sdk/system.css, the ${blockId} block` : 'public/style.css';
    block.innerHTML = `<header><h3 id="${fam.id}-h"><a href="#today/${fam.id}">${h(fam.name)}</a></h3><span class="ds-count">${variants.length} look${variants.length === 1 ? '' : 's'}, from ${h(from)}</span></header>${fam.desc ? `<p class="ds-desc">${fam.desc}</p>` : ''}`;
    for (const g of groups) {
      const cap = mk('p', 'ds-ctx', `Drawn with: ${h(ctxLabel(g.ctx))}`);
      block.appendChild(cap);
      block.appendChild(makeFrame(g.ctx, g.items.map((v) => variantHtml(fam, v, g.ctx)).join(''), { title: `${fam.name}, ${ctxLabel(g.ctx)}` }));
    }
    if (fam.notMounted) block.appendChild(mk('p', 'ds-desc', `<b>Not mounted here:</b> ${fam.notMounted}`));
    return block;
  }

  // ---- the live SDK pieces ----
  const LIVE_PRELUDE = `
window.Phases = window.Phases || {};
window.__dsLog = [];
// A live piece that takes focus (the editor window opens on its first field) must not scroll the design-system page to its frame.
(function () { var f = HTMLElement.prototype.focus; HTMLElement.prototype.focus = function (o) { return f.call(this, Object.assign({}, o, { preventScroll: true })); }; })();
(function () {
  var svgs = ${JSON.stringify(SRC.svgs || {})};
  var locale = { language: 'en', clock: '12', currency: 'USD', currencies: ['EUR', 'GBP', 'JPY', 'USD', 'CAD', 'AUD', 'CHF', 'SEK'], words: {} };
  function note(t) {
    var layer = document.getElementById('toast-layer');
    if (!layer) { layer = document.createElement('div'); layer.id = 'toast-layer'; layer.className = 'sdk-toasts'; layer.style.position = 'static'; layer.style.pointerEvents = 'auto'; document.body.appendChild(layer); }
    var b = document.createElement('div'); b.className = 'sdk-toast'; b.dataset.kind = 'info'; b.setAttribute('role', 'status');
    var i = document.createElement('span'); i.className = 'sdk-toast-icon'; i.setAttribute('aria-hidden', 'true'); i.innerHTML = '<i class="fa-solid fa-circle-info"></i>';
    var m = document.createElement('div'); m.className = 'sdk-toast-body';
    var s = document.createElement('span'); s.className = 'sdk-toast-title'; s.textContent = t; m.appendChild(s); b.appendChild(i); b.appendChild(m); b.addEventListener('click', function () { b.remove(); }); layer.appendChild(b);
  }
  window.__dsCall = function (m, p) {
    window.__dsLog.push(m);
    if (m === 'hello') return Promise.resolve({ locale: locale, theme: null, module: { id: 'design-system' } });
    if (m === 'icons.svg') return svgs[p.name] ? Promise.resolve(svgs[p.name]) : Promise.reject(new Error('no such icon'));
    if (m === 'ui.toast') { note(p.text); return Promise.resolve(true); }
    return Promise.resolve({});
  };
})();`;
  function injectScript(doc, code, attrs) {
    const s = doc.createElement('script');
    for (const [k, v] of Object.entries(attrs || {})) s.setAttribute(k, v);
    s.textContent = code;
    doc.head.appendChild(s);
  }
  function liveFrame(spec) {
    // The module panel is an app page's piece (public/module-frame.js, an ES module): it is imported, not mounted by the SDK.
    if (spec.module) {
      return makeFrame(spec.ctx || 'app', spec.body, {
        height: spec.height || 360, title: spec.title,
        css: '.dsf-live { padding-top: 10px; }',
        onLoad: (iframe, doc) => {
          const win = iframe.contentWindow;
          win.addEventListener('error', (e) => stats.errors.push('live: ' + e.message));
          win.addEventListener('unhandledrejection', (e) => stats.errors.push('live: ' + (e.reason && e.reason.message)));
          if (location.protocol === 'file:') { doc.body.insertAdjacentHTML('beforeend', '<p class="dsf-note">Open this page from the app to see the live panel; a copy on disk cannot load public/module-frame.js.</p>'); return; }
          injectScript(doc, `window.__dsDone = (function () { ${spec.script} })().catch(function (e) { window.__dsFail = String(e && e.message || e); });`);
        },
      });
    }
    const wrap = makeFrame(spec.ctx || 'host', spec.body, {
      height: spec.height || 360, title: spec.title,
      css: '.dsf-live { display: grid; gap: 18px; padding-top: 10px; } .dsf-live h4 { margin: 0 0 6px; font-size: 12px; color: var(--text-dim); font-weight: 700; } .dsf-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; } .dsf-live p { margin: 0; }',
      onLoad: (iframe, doc) => {
        const win = iframe.contentWindow;
        if (!text['host.js']) { doc.body.insertAdjacentHTML('beforeend', '<p class="dsf-note">The SDK (public/sdk/host.js) could not be loaded here, so the live pieces are not mounted.</p>'); return; }
        win.addEventListener('error', (e) => stats.errors.push('live: ' + e.message));
        win.addEventListener('unhandledrejection', (e) => stats.errors.push('live: ' + (e.reason && e.reason.message)));
        injectScript(doc, LIVE_PRELUDE);
        if (text['tooltip.js']) injectScript(doc, text['tooltip.js']); // the page's tooltip script, as brand.js gives a real page
        injectScript(doc, text['host.js'], { 'data-host-sdk': '' });
        if (!win.createHost) { doc.body.insertAdjacentHTML('beforeend', '<p class="dsf-note">The SDK did not start.</p>'); return; }
        injectScript(doc, `window.__dsDone = (async function () { var made = createHost({ call: window.__dsCall, root: document, rootElement: document.body }); var host = made.host; try { await host.ready(); } catch (e) {} ${spec.script} })().catch(function (e) { window.__dsFail = String(e && e.message || e); });`);
      },
    });
    return wrap;
  }
  // The family blocks of public/sdk/system.css (/* <id>:start */ ... /* <id>:end */), read when the page opens.
  const SYS_BLOCKS = new Set();
  const LIVE = window.DS_LIVE || [];

  // ---- tokens ----
  const probeCanvas = D.createElement('canvas'); probeCanvas.width = probeCanvas.height = 1;
  const pctx = probeCanvas.getContext('2d', { willReadFrequently: true });
  function rgba(css) {
    pctx.clearRect(0, 0, 1, 1);
    pctx.fillStyle = '#000'; pctx.fillStyle = css;
    pctx.fillRect(0, 0, 1, 1);
    const d = pctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  }
  const hex = (c) => '#' + c.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('') + (c[3] < 1 ? Math.round(c[3] * 255).toString(16).padStart(2, '0') : '');
  const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat([1]);
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

  const BASE = ['--bg', '--bg-section', '--bg-card', '--bg-input', '--border', '--text', '--text-dim', '--accent', '--on-accent', '--ok', '--danger', '--on-danger', '--danger-text', '--accent-hover'];
  const SURFACES = ['--bg', '--bg-section', '--bg-card', '--bg-input', '--surface', '--surface-hover', '--shade', '--secondary', '--secondary-hover', '--selected-bg'];
  const ON = { '--accent': ['--on-accent'], '--primary-hover': ['--on-accent'], '--accent-hover': ['--on-accent'], '--danger': ['--on-danger'], '--ok': ['--on-danger'], '--header-bg': ['--header-text'], '--nav-brand-bg': ['--nav-brand-text'], '--nav-right-bg': ['--nav-right-text'], '--nav-primary-bg': ['--header-text'] };
  const TEXTY = ['--text', '--text-dim', '--accent', '--danger-text', '--danger', '--ok', '--icon-hover', '--tint-gold', '--tint-blue', '--tint-green', '--tint-teal', '--tint-purple', '--tint-red', '--tint-orange', '--tint-pink'];

  function rootTokens() {
    const found = new Map();
    for (const [file, css] of [['public/style.css', text['style.css']], ['public/sdk/host.css', text['host.css']]]) {
      const sheet = parse(css || '');
      for (const { rule } of walk(sheet.cssRules)) {
        if (!/^:root\b/.test(rule.selectorText) || /\s/.test(rule.selectorText.replace(/\[[^\]]*\]|:not\([^)]*\)/g, ''))) continue;
        const modeOnly = /theme-mode|mode-shown/.test(rule.selectorText);
        for (const [p, v] of decls(rule)) {
          if (!p.startsWith('--')) continue;
          if (modeOnly && found.has(p)) continue; // the light override of a tint: shown by the light value
          if (!found.has(p)) found.set(p, { name: p, raw: v, file });
        }
      }
    }
    return [...found.values()];
  }

  async function tokenValues(m) {
    // A hidden app frame in each mode: the computed value of every token, as a person's browser resolves it.
    const iframe = D.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true'); iframe.tabIndex = -1;
    iframe.style.cssText = 'position:absolute;left:-9999px;width:400px;height:200px;border:0';
    D.body.appendChild(iframe);
    const saved = mode; mode = m;
    iframe.srcdoc = frameHtml('app', '');
    mode = saved;
    await new Promise((r) => iframe.addEventListener('load', r, { once: true }));
    const cs = iframe.contentWindow.getComputedStyle(iframe.contentDocument.documentElement);
    const out = {};
    for (const t of tokens) out[t.name] = cs.getPropertyValue(t.name).trim();
    iframe.remove();
    return out;
  }
  let tokens = [];

  function fmtRatio(r) { return r >= 4.5 ? `${r.toFixed(1)}:1` : `<span class="ds-low">${r.toFixed(1)}:1</span>`; }

  async function tokenSection() {
    tokens = rootTokens();
    stats.tokens = tokens.length;
    const vals = { light: await tokenValues('light'), dark: await tokenValues('dark') };
    const isColor = (v) => v && CSS.supports('color', v);
    const colors = tokens.filter((t) => isColor(vals.dark[t.name]) && !/^(--z-|--radius)/.test(t.name));
    const colorNames = new Set(colors.map((t) => t.name));
    const other = tokens.filter((t) => !colorNames.has(t.name));
    const rgb = { light: {}, dark: {} };
    for (const m of ['light', 'dark']) for (const t of colors) rgb[m][t.name] = rgba(vals[m][t.name]);
    const groupOf = (n) => (BASE.includes(n) ? 'Base' : /^--tint-/.test(n) ? 'Tints' : /^--(nav|header)/.test(n) ? 'Header and navigation' : /^--(surface|shade|secondary|primary|selected|icon)/.test(n) ? 'Surfaces and roles' : 'Other colours');
    const order = ['Base', 'Surfaces and roles', 'Tints', 'Header and navigation', 'Other colours'];
    const sec = mk('section', 'ds-sec');
    sec.id = 'tokens';
    sec.innerHTML = '<h2>Tokens</h2><p class="ds-lead">Every custom property on :root in public/style.css and public/sdk/host.css, read from the stylesheets when this page opens, with the value a browser computes in light and in dark (public/theme.css, Strong Coffee unless the environment set another). Contrast is WCAG 2; a ratio under 4.5:1 is marked. A semi-transparent colour is laid over --bg first. Then what the stylesheets use today, counted: nothing here is a recommendation.</p>';
    const parts = [];
    const sub = (id, title, lead) => { const s = mk('div', 'ds-tok'); s.id = id; s.dataset.name = (title + ' ' + id).toLowerCase(); s.innerHTML = `<h3 class="ds-group">${h(title)}</h3>${lead ? `<p class="ds-desc">${lead}</p>` : ''}`; parts.push(s); sec.appendChild(s); return s; };

    const cs = sub('tokens-colour', 'Colour', `${colors.length} colour tokens. Each swatch shows light on the left, dark on the right.`);
    for (const g of order) {
      const list = colors.filter((t) => groupOf(t.name) === g);
      if (!list.length) continue;
      cs.appendChild(mk('h4', 'ds-h4', `${h(g)} <span class="ds-count">${list.length}</span>`));
      const grid = mk('div', 'ds-swatches');
      for (const t of list) {
        const L = rgb.light[t.name]; const Dk = rgb.dark[t.name];
        const lines = (m, c) => {
          const bg = rgb[m]['--bg'];
          const base = over(c, bg);
          const rows = [];
          if (ON[t.name]) for (const on of ON[t.name]) if (rgb[m][on]) rows.push([`${on.slice(2)} on it`, ratio(over(rgb[m][on], base), base)]);
          if (SURFACES.includes(t.name)) { rows.push(['--text on it', ratio(over(rgb[m]['--text'], base), base)]); rows.push(['--text-dim on it', ratio(over(rgb[m]['--text-dim'], base), base)]); }
          if (TEXTY.includes(t.name) && t.name !== '--text') rows.push(['on --bg', ratio(base, bg)]);
          else if (t.name === '--text') rows.push(['on --bg', ratio(base, bg)]);
          return rows.map(([k, r]) => `<span class="r"><span>${h(k)}</span><span>${fmtRatio(r)}</span></span>`).join('');
        };
        const sw = mk('div', 'ds-sw');
        sw.dataset.search = (t.name + ' ' + t.raw).toLowerCase();
        const tc = (c, m) => { const base = over(c, rgb[m]['--bg']); return ratio([0, 0, 0, 1], base) > ratio([255, 255, 255, 1], base) ? '#000' : '#fff'; };
        const bgOf = (m, c) => `background:${hex(over(c, rgb[m]['--bg']))}`;
        sw.innerHTML = `<div class="ds-sw-chip" aria-hidden="true"><span style="${bgOf('light', L)};color:${tc(L, 'light')}">Aa</span><span style="${bgOf('dark', Dk)};color:${tc(Dk, 'dark')}">Aa</span></div><div class="ds-sw-body"><b>${h(t.name)}</b><code>light ${hex(L)}${L[3] < 1 ? ' (over --bg)' : ''}</code><code>dark ${hex(Dk)}${Dk[3] < 1 ? ' (over --bg)' : ''}</code><code title="as written">${h(t.raw.length > 70 ? t.raw.slice(0, 68) + '...' : t.raw)}</code>${lines('light', L) ? `<div><small>Light</small>${lines('light', L)}</div>` : ''}${lines('dark', Dk) ? `<div><small>Dark</small>${lines('dark', Dk)}</div>` : ''}</div>`;
        grid.appendChild(sw);
      }
      cs.appendChild(grid);
    }
    // Fixed pairs worth one table: text tokens on every surface.
    const mt = mk('div', 'ds-tbl');
    let rowsHtml = '';
    for (const m of ['light', 'dark']) for (const fg of ['--text', '--text-dim', '--accent', '--danger-text', '--ok']) {
      rowsHtml += `<tr><td>${m}</td><td><code>${fg}</code></td>${['--bg', '--bg-section', '--bg-card', '--bg-input', '--surface', '--selected-bg'].map((bgN) => { if (!rgb[m][fg] || !rgb[m][bgN]) return '<td class="num">-</td>'; const base = over(rgb[m][bgN], rgb[m]['--bg']); return `<td class="num">${fmtRatio(ratio(over(rgb[m][fg], base), base))}</td>`; }).join('')}</tr>`;
    }
    mt.innerHTML = `<h4 class="ds-h4">Text colours on each surface</h4><table class="ds-table"><thead><tr><th>Mode</th><th>Text</th><th>--bg</th><th>--bg-section</th><th>--bg-card</th><th>--bg-input</th><th>--surface</th><th>--selected-bg</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
    cs.appendChild(mt);

    // Non-colour tokens
    const ot = sub('tokens-other', 'Radii, sizes and layers', `${other.length} other custom properties on :root.`);
    const radii = other.filter((t) => t.name.startsWith('--radius'));
    ot.appendChild(mk('h4', 'ds-h4', 'Radius tokens'));
    const radiiBox = mk('div', 'ds-radii', radii.map((t) => `<div data-r="${h(t.name)}"><span><b>${h(t.name)}</b><br>${h(vals.dark[t.name])}</span></div>`).join(''));
    for (const d of $$('[data-r]', radiiBox)) d.style.setProperty('border-radius', 'var(' + d.dataset.r + ')');
    ot.appendChild(radiiBox);
    ot.appendChild(mk('h4', 'ds-h4', 'Everything else'));
    ot.appendChild(mk('div', '', `<table class="ds-table"><thead><tr><th>Token</th><th>Value as written</th><th>Computed</th><th>Defined in</th></tr></thead><tbody>${other.filter((t) => !t.name.startsWith('--radius')).map((t) => `<tr data-search="${h(t.name.toLowerCase())}"><td><code>${h(t.name)}</code></td><td><code>${h(t.raw)}</code></td><td><code>${h(vals.dark[t.name])}</code></td><td>${h(t.file)}</td></tr>`).join('')}</tbody></table>`));

    // What the stylesheets use today
    const sheets = [
      ['public/style.css', text['style.css']], ['public/sdk/host.css', text['host.css']], ['public/destination.css', text['destination.css']], ['public/diag.css', text['diag.css']],
      ...Object.keys(MODS).sort().flatMap((id) => (MODS[id].files || []).map((f) => [f.file, f.text])),
    ].filter(([, t]) => t);
    const tally = (prop, pick) => {
      const m = new Map(); let total = 0;
      for (const [, css] of sheets) for (const { rule } of walk(parse(css).cssRules)) for (const [p, v] of decls(rule)) {
        if (p !== prop) continue;
        for (const val of pick(v)) { if (!val) continue; total += 1; m.set(val, (m.get(val) || 0) + 1); }
      }
      return { rows: [...m.entries()].sort((a, b) => b[1] - a[1]), total };
    };
    const media = new Map(); let mediaTotal = 0;
    for (const [, css] of sheets) for (const { media: mq } of walk(parse(css).cssRules)) { if (!mq) continue; for (const q of mq.match(/\((?:max|min)-(?:width|height):\s*[^)]+\)/g) || []) { const k = q.replace(/\s+/g, ' '); media.set(k, (media.get(k) || 0) + 1); mediaTotal += 1; } }
    const table = (t, label, fmt) => {
      const max = t.rows.length ? t.rows[0][1] : 1;
      const row = ([v, n]) => `<tr><td><code>${h(fmt ? fmt(v) : v)}</code></td><td class="num">${n}</td><td><span class="ds-bar" style="width:${Math.max(2, Math.round((n / max) * 140))}px"></span></td></tr>`;
      const top = t.rows.slice(0, 14); const rest = t.rows.slice(14);
      return `<div><h4 class="ds-h4">${h(label)}: ${t.rows.length} different, ${t.total} uses</h4><table class="ds-table"><thead><tr><th>Value</th><th class="num">Uses</th><th></th></tr></thead><tbody>${top.map(row).join('')}</tbody></table>${rest.length ? `<details><summary>${rest.length} more</summary><table class="ds-table"><tbody>${rest.map(row).join('')}</tbody></table></details>` : ''}</div>`;
    };
    const px = (v) => [v];
    const fs = tally('font-size', px);
    const ty = sub('tokens-type', 'Type', `Read from ${sheets.length} stylesheets. Font sizes as declared (font-size only; a size inside the font shorthand is not counted).`);
    ty.appendChild(mk('div', 'ds-two', table(fs, 'Font sizes') + table(tally('font-weight', px), 'Font weights') + table(tally('font-family', (v) => [v.replace(/"/g, "'")]), 'Font families') + table(tally('line-height', px), 'Line heights') + table(tally('letter-spacing', px), 'Letter spacing')));
    const pad = tally('padding', px); const gap = tally('gap', px);
    const sp = sub('tokens-spacing', 'Spacing', 'Padding and gap as declared: no scale exists, so every pair is its own value.');
    sp.appendChild(mk('div', 'ds-two', table(pad, 'padding') + table(gap, 'gap') + table(tally('margin', px), 'margin')));
    const rd = sub('tokens-radius-use', 'Border radius in use', 'How the radius tokens are used, and any literal radius. --radius-round is for true circles only (avatars, dots, round icon buttons, the toggle switch, progress bars, the single-digit count): a chip, tag, label or badge with words takes --radius-small, never a pill. tools/check-radius.mjs lists every circle.');
    rd.appendChild(mk('div', 'ds-two', table(tally('border-radius', px), 'border-radius')));
    const shd = tally('box-shadow', (v) => (v === 'none' ? [] : [v]));
    const shadows = sub('tokens-shadow', 'Shadows', 'Every box-shadow value in use, rendered on a card.');
    shadows.appendChild(mk('div', 'ds-two', table(shd, 'box-shadow')));
    shadows.appendChild(mk('h4', 'ds-h4', 'The most used, drawn'));
    shadows.appendChild(mk('div', 'ds-shadows', shd.rows.slice(0, 12).map(([v, n]) => `<div style="box-shadow:${h(v)}"><b>${n} uses</b><code class="ds-code">${h(v)}</code></div>`).join('')));
    const z = sub('tokens-layers', 'Layers (z-index)', 'z-index values in use. Only --z-menu is a token.');
    z.appendChild(mk('div', 'ds-two', table(tally('z-index', px), 'z-index')));
    const bp = sub('tokens-breakpoints', 'Breakpoints', 'Width and height conditions found in @media and @container rules.');
    const bpRows = [...media.entries()].sort((a, b) => b[1] - a[1]);
    bp.appendChild(mk('div', 'ds-two', table({ rows: bpRows, total: mediaTotal }, 'Conditions')));
    const mo = sub('tokens-motion', 'Motion', 'transition and animation values in use; prefers-reduced-motion appears in the number of files shown.');
    const rm = sheets.filter(([, css]) => /prefers-reduced-motion/.test(css)).length;
    mo.appendChild(mk('div', 'ds-two', table(tally('transition', px), 'transition') + table(tally('animation', px), 'animation')));
    mo.appendChild(mk('p', 'ds-desc', `prefers-reduced-motion appears in ${rm} of ${sheets.length} stylesheets.`));
    const bd = tally('border', px);
    const bdr = sub('tokens-borders', 'Borders', 'The border shorthand as declared.');
    bdr.appendChild(mk('div', 'ds-two', table(bd, 'border')));
    const note = mk('p', 'ds-desc', `Stylesheets read: ${sheets.length} (${sheets.map(([f, t]) => f.replace(/^.*\//, '') + ' ' + Math.round(t.length / 1024) + ' KB').join(', ')}).`);
    sec.appendChild(note);
    stats.sheets = sheets.length;
    return sec;
  }

  // ---- icons ----
  function iconSection() {
    const list = SRC.icons || [];
    const sec = mk('section', 'ds-sec');
    sec.id = 'icons';
    sec.innerHTML = `<h2>Icons</h2><p class="ds-lead">The Font Awesome Free solid icons the product uses: ${list.length} names found in the stylesheets, scripts, pages, module sources and server templates. Each is written <code>&lt;i class="fa-solid fa-name" aria-hidden="true"&gt;&lt;/i&gt;</code> on an app page; a module asks the SDK for an SVG with host.ui.icon(name). Click one to copy its markup.</p>`;
    stats.icons = list.length;
    const groups = new Map();
    for (const i of list) { if (!i.group) i.group = 'Modules'; // an icon only a module uses has no group from sources.js (module-sources.js adds it)
      if (!groups.has(i.group)) groups.set(i.group, []); groups.get(i.group).push(i); }
    for (const [g, items] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
      sec.appendChild(mk('h3', 'ds-group', `${h(g)} <span class="ds-count">${items.length}</span>`));
      const grid = mk('div', 'ds-icons');
      for (const i of items.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))) {
        const b = mk('button', 'ds-icon', `<i class="fa-solid fa-${h(i.name)}${i.free === false ? '' : ''}" aria-hidden="true"></i><span>${h(i.name)}</span><span>${i.count} use${i.count === 1 ? '' : 's'}${i.free === false ? ' (not in Free)' : ''}</span>`);
        b.type = 'button';
        b.dataset.search = (i.name + ' ' + g + ' ' + (i.files || []).join(' ')).toLowerCase();
        b.title = (i.files || []).join('\n') || i.name;
        b.setAttribute('aria-label', `${i.name}, ${i.count} uses. Copy the markup`);
        b.addEventListener('click', () => { const t = `<i class="fa-solid fa-${i.name}" aria-hidden="true"></i>`; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).catch(() => {}); b.querySelector('span:last-child').textContent = 'Copied'; });
        grid.appendChild(b);
      }
      sec.appendChild(grid);
    }
    return sec;
  }

  // ---- the page ----
  const content = $('#ds-content');
  const nav = $('#ds-nav');
  const navItems = []; // { li, target (element), name }
  function navGroup(title, el) { const n = el || nav; n.appendChild(mk('h2', '', h(title))); const ul = mk('ul'); n.appendChild(ul); return ul; }
  function navItem(ul, label, id, count, search, href, chip) {
    const li = mk('li'); const a = mk('a', '', `<span>${h(label)}</span>${chip ? chip : count != null ? `<span class="n">${count}</span>` : ''}`);
    a.href = (href || '#today/' + id); li.appendChild(a); ul.appendChild(li);
    navItems.push({ li, a, id, name: (search || label).toLowerCase() });
    return li;
  }

  function applySearch() {
    const q = $('#ds-search').value.trim().toLowerCase();
    for (const b of $$('.ds-block')) b.hidden = Boolean(q) && !b.dataset.name.includes(q);
    for (const e of $$('[data-search]')) e.hidden = Boolean(q) && !e.dataset.search.includes(q);
    for (const t of $$('.ds-tok')) { if (!q) { t.hidden = false; continue; } const any = $$('[data-search]', t).some((e) => !e.hidden); t.hidden = !(any || t.dataset.name.includes(q)); }
    for (const n of navItems) { const t = D.getElementById(n.id); n.li.hidden = Boolean(q) && (t ? t.hidden || !!(t.classList.contains('ds-sec') && false) : !n.name.includes(q)); }
    // a family hidden by the search also hides its nav entry; headings with nothing left are dimmed by the count only
  }

  function setMode(m) {
    mode = m;
    D.documentElement.dataset.themeMode = m;
    for (const b of $$('#ds-mode button')) { const on = b.dataset.mode === m; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    for (const f of frames) {
      const doc = f.iframe.contentDocument;
      if (!doc || !doc.documentElement) continue;
      const fm = f.pin || m;
      doc.documentElement.dataset.themeMode = fm;
      if (f.ctx !== 'app') doc.documentElement.setAttribute('style', tokenStyle(fm));
    }
  }
  function setWidthAll(w) {
    width = w;
    for (const b of $$('#ds-width button')) { const on = b.dataset.w === w; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    for (const f of frames) setWidth(f);
  }

  // #today/<id> and a bare #<id> scroll to that block.
  function route(first) {
    const hsh = decodeURIComponent(location.hash.slice(1));
    const id = hsh.replace(/^today\//, '');
    if (id) { const t = D.getElementById(id); if (t) { t.scrollIntoView(); return; } }
    if (!first) window.scrollTo(0, 0);
  }

  async function init() {
    FA_HREF = $('link[data-ds="fa"]').href;
    await Promise.all(['style.css', 'system.css', 'host.css', 'theme.css', 'host.js', 'tooltip.js', 'destination.css', 'diag.css'].map(load));
    $('#ds-status').textContent = 'Drawing the examples';

    for (const m of (text['system.css'] || '').matchAll(/\/\* ([a-z][a-z0-9-]*):start \*\//g)) SYS_BLOCKS.add(m[1]);
    const families = (window.DS_FAMILIES || []).slice();
    stats.families = families.length;
    const tokenSec = await tokenSection();
    content.appendChild(tokenSec);

    const compSec = mk('section', 'ds-sec');
    compSec.id = 'components';
    compSec.innerHTML = `<h2>Components</h2><p class="ds-lead">${families.length} families: one for each family block of public/sdk/system.css, and the few looks public/style.css still draws. Every example is the product's own markup and classes, drawn in a small frame that carries only the stylesheets that page or module really has, so what you see is what a person sees; a check (tools/check-design-system-catalog.mjs) fails if an example uses a class no stylesheet has. Use the width and light or dark buttons at the top; the state cells (hover, focus, pressed) are the stylesheet's own :hover, :focus and :active rules, forced on. Under each look, <b>Markup</b> shows the HTML to copy.</p>`;
    content.appendChild(compSec);
    const order = []; const byGroup = new Map();
    for (const f of families) { if (!byGroup.has(f.group)) { byGroup.set(f.group, []); order.push(f.group); } byGroup.get(f.group).push(f); }

    const ulTok = navGroup('Tokens');
    for (const [id, label] of [['tokens-colour', 'Colour'], ['tokens-other', 'Radii, sizes, layers'], ['tokens-type', 'Type'], ['tokens-spacing', 'Spacing'], ['tokens-radius-use', 'Radius in use'], ['tokens-shadow', 'Shadows'], ['tokens-layers', 'Layers'], ['tokens-breakpoints', 'Breakpoints'], ['tokens-motion', 'Motion'], ['tokens-borders', 'Borders']]) navItem(ulTok, label, id);
    for (const g of order) {
      compSec.appendChild(mk('h3', 'ds-group', h(g)));
      const ul = navGroup(g);
      for (const f of byGroup.get(g)) {
        const b = familyBlock(f);
        compSec.appendChild(b);
        navItem(ul, f.name, f.id, (f.variants || []).length, f.name + ' ' + f.id);
      }
    }
    // live
    compSec.appendChild(mk('h3', 'ds-group', 'Live SDK pieces'));
    const ulLive = navGroup('Live SDK pieces');
    for (const spec of LIVE) {
      const b = mk('section', 'ds-block'); b.id = spec.id; b.dataset.name = (spec.name + ' sdk host live ' + spec.id).toLowerCase();
      b.innerHTML = `<header><h3><a href="#today/${spec.id}">${h(spec.name)}</a></h3></header><p class="ds-desc">${spec.desc}</p>`;
      b.appendChild(liveFrame(spec));
      compSec.appendChild(b);
      navItem(ulLive, spec.name.replace(/^Live: /, ''), spec.id);
    }
    // not mounted
    const nm = mk('section', 'ds-block'); nm.id = 'not-mounted'; nm.dataset.name = 'not mounted missing what could not be mounted';
    nm.innerHTML = `<header><h3><a href="#today/not-mounted">What could not be mounted</a></h3></header><p class="ds-desc">Drawn by the host or needing a live call, so they are not shown as running pieces here. Where the markup is known, it appears above as a static picture.</p><ul class="ds-desc">${(window.DS_NOT_MOUNTED || []).map((x) => `<li>${x}</li>`).join('')}</ul>`;
    compSec.appendChild(nm);
    const ulMisc = navGroup('Other');
    navItem(ulMisc, 'What could not be mounted', 'not-mounted');
    content.appendChild(iconSection());
    navItem(ulMisc, 'Icons', 'icons', (SRC.icons || []).length);

    $('#ds-status').textContent = 'Loading the examples';
    await Promise.all(frameReady);
    const bad = stats.notLoaded.length ? ` Not loaded: ${stats.notLoaded.join(', ')}.` : '';
    $('#ds-status').textContent = `${stats.families} component families, ${stats.variants} looks, ${stats.examples} examples in ${stats.frames} frames, ${stats.tokens} tokens, ${stats.icons} icons.${bad}`;
    route(true);
    stats.ready = true;
    window.__dsReadyResolve && window.__dsReadyResolve();
  }

  // events
  $('#ds-search').addEventListener('input', applySearch);
  $('#ds-mode').addEventListener('click', (e) => { const b = e.target.closest('button[data-mode]'); if (b) setMode(b.dataset.mode); });
  $('#ds-width').addEventListener('click', (e) => { const b = e.target.closest('button[data-w]'); if (b) setWidthAll(b.dataset.w); });
  $('#ds-menu-btn').addEventListener('click', () => { const open = nav.classList.toggle('open'); $('#ds-menu-btn').setAttribute('aria-expanded', String(open)); });
  for (const n of [nav]) n.addEventListener('click', (e) => { if (e.target.closest('a') && n.classList.contains('open')) { n.classList.remove('open'); $('#ds-menu-btn').setAttribute('aria-expanded', 'false'); } });
  window.addEventListener('hashchange', () => route(false));
  window.__dsReady = new Promise((r) => { window.__dsReadyResolve = r; });
  window.__ds = { setMode, setWidth: setWidthAll, frames, stats };
  const start = new URLSearchParams(location.search).get('mode');
  if (start === 'light' || start === 'dark') mode = start;
  setMode(mode);
  init().catch((e) => { stats.errors.push('init: ' + (e && e.stack || e)); $('#ds-status').textContent = 'The page failed to draw: ' + (e && e.message); });
})();
