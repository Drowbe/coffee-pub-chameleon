// The Prototype's "Card icon colour" comparison (Thomas, 2026-11-03): five ways to colour the circle on a card head and a row.
// Draws the samples (each wears data-ci-fixed and keeps its own variant), the switch that restyles every circle on the page (data-ci on <html>
// and on the Planner's page in its shadow root; also ?ci=v0..v4), and the numbers: glyph against disc, and disc against its surface,
// measured from the colours the browser draws, for the theme and mode chosen at the top. The rules are in prototype.css; nothing here ships.
const D = document;
const VARIANTS = [
  { id: 'v0', name: 'Now', note: 'The page colour on the disc at the kind\'s own lightness (--card-disc-l: 0.74 in dark, 0.5 in light). What the product draws today.' },
  { id: 'v1', name: 'Light on a darker disc', note: 'White on a darker disc of the kind colour (--ci-1-l: 0.54 in dark, 0.48 in light).' },
  { id: 'v2', name: 'Knock-out', note: 'The glyph takes the colour behind the disc (the head band, or the row\'s surface), so it looks cut out of the disc. The disc stays as it is now.' },
  { id: 'v3', name: 'Dark brown', note: 'A dark step of the theme\'s accent hue (brown in Strong Coffee, dark teal in Calming Teal) on the disc; in light mode the disc is a little darker than now (--ci-3-l: 0.59) so the edge still shows.' },
  { id: 'v4', name: 'Ring', note: 'No solid disc: the kind colour as the glyph, on a faint fill of the kind colour inside a ring of the disc colour.' },
];
const KINDS = [
  { name: 'Hotel', tint: 'blue', icon: 'bed' },
  { name: 'Flight', tint: 'purple', icon: 'plane' },
  { name: 'Meal', tint: 'orange', icon: 'utensils' },
  { name: 'Activity', tint: 'green', icon: 'landmark' },
  { name: 'Task', tint: 'teal', icon: 'list-check' },
  { name: 'Note', tint: 'gold', icon: 'note-sticky' },
  { name: 'Place', tint: 'red', icon: 'location-dot' },
  { name: 'Neutral', tint: '', icon: 'hourglass-half' },
];
const TITLES = { Hotel: 'Hotel Roma', Flight: 'Flight to Lisbon', Meal: 'Dinner booking', Activity: 'Walking tour', Task: 'Print the tickets', Note: 'Packing', Place: 'Pastelaria', Neutral: 'Buffer' };

const el = (tag, cls, text) => { const e = D.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const icon = (k) => { const s = el('span', 'sdk-card-icon'); if (k.tint) s.dataset.tint = k.tint; const i = el('i', `fa-solid fa-${k.icon}`); i.setAttribute('aria-hidden', 'true'); s.append(i); return s; };

function cell(k) {
  const c = el('div', 'ci-cell');
  c.dataset.kind = k.name;
  const card = el('article', 'sdk-card-banded');
  const head = el('header', 'sdk-card-head');
  const main = el('div', 'sdk-card-main');
  main.append(icon(k), el('h4', 'sdk-card-title', TITLES[k.name]), el('span', 'sdk-card-sub sdk-tint-text', k.name));
  head.append(main);
  card.append(head);
  const list = el('div', 'sdk-list');
  const row = el('div', 'sdk-row');
  const rm = el('span', 'sdk-row-main');
  rm.append(el('span', 'sdk-row-title', TITLES[k.name]));
  row.append(icon(k), rm);
  list.append(row);
  c.append(card, list);
  return c;
}

const state = { ci: new URLSearchParams(location.search).get('ci') };
if (!VARIANTS.some((v) => v.id === state.ci)) state.ci = 'v0';

const main = D.getElementById('pp-main');
const sec = el('section', 'ci-section');
sec.setAttribute('aria-labelledby', 'ci-title');
const h = el('h2', 'pp-group-name', 'Card icon colour');
h.id = 'ci-title';
const note = el('p', 'pp-state-note', 'The black glyph on a colour disc reads hard. Five tries, each shown below on eight kinds, at 36px (a card head) and 28px (a row), in the theme and mode chosen at the top. The switch restyles every card on this page, the Planner\'s too. Nothing here is in the product yet.');
const bar = el('div', 'ci-bar');
const barLabel = el('span', 'ci-bar-label', 'Every card on the page:');
const sw = el('div', 'mf-switch');
sw.setAttribute('role', 'radiogroup');
sw.setAttribute('aria-label', 'Card icon colour');
bar.append(barLabel, sw);

function drawSwitch() {
  sw.textContent = '';
  for (const v of VARIANTS) {
    const b = el('button', 'mf-switch-btn');
    b.type = 'button';
    b.dataset.key = `ci:${v.id}`;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(state.ci === v.id));
    b.tabIndex = state.ci === v.id ? 0 : -1;
    b.append(el('span', '', `${v.id.slice(1)} ${v.name}`));
    b.addEventListener('click', () => { state.ci = v.id; apply(); drawSwitch(); sw.querySelector('[aria-checked="true"]').focus(); });
    sw.append(b);
  }
}
function apply() {
  D.documentElement.dataset.ci = state.ci;
  const planner = D.querySelector('.pp-planner');
  const app = planner && planner.shadowRoot && planner.shadowRoot.getElementById('app');
  if (app) app.dataset.ci = state.ci;
  const u = new URL(location.href);
  u.searchParams.set('ci', state.ci);
  history.replaceState(null, '', u);
}

sec.append(h, note, bar);
for (const v of VARIANTS) {
  const box = el('div', 'ci-variant');
  box.dataset.ciFixed = v.id;
  box.append(el('h3', 'ci-variant-name', `${v.id.slice(1)}. ${v.name}`), el('p', 'ci-variant-note', v.note));
  const grid = el('div', 'ci-grid');
  for (const k of KINDS) grid.append(cell(k));
  box.append(grid);
  sec.append(box);
}

// ---- the numbers ----
const nh = el('h3', 'ci-variant-name', 'Contrast, measured');
const nn = el('p', 'ci-variant-note', 'Read from the colours drawn now. Glyph on disc: the icon against the disc (aim 4.5 or more; 3 is the least for an icon). Disc on surface: the disc, or the ring for 4, against the card head it sits on and the row it sits in, the lower of the two (3 or more to read as a colour dot). A number under its aim is marked with "!".');
const wrap = el('div', 'ci-scroll');
const tbl = el('table', 'ci-numbers');
wrap.append(tbl);
sec.append(nh, nn, wrap);
main.prepend(sec);

const cv = D.createElement('canvas');
cv.width = 1;
cv.height = 1;
const ctx = cv.getContext('2d', { willReadFrequently: true });
function rgb(css) {
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = '#000';
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}
const lum = ([r, g, b]) => { const f = (x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const firstColour = (s) => { const m = /^(rgba?\([^)]*\)|color\([^)]*\)|oklch\([^)]*\)|lab\([^)]*\))/.exec(s); return m ? m[1] : s; };

export function measure() {
  const out = {};
  for (const v of VARIANTS) {
    out[v.id] = {};
    for (const k of KINDS) {
      const c = D.querySelector(`[data-ci-fixed="${v.id}"] .ci-cell[data-kind="${k.name}"]`);
      const ic = c.querySelector('.sdk-card-head .sdk-card-icon');
      const ric = c.querySelector('.sdk-row .sdk-card-icon');
      const cs = getComputedStyle(ic);
      const disc = rgb(cs.backgroundColor);
      const glyph = rgb(cs.color);
      const edge = v.id === 'v4' ? rgb(firstColour(cs.boxShadow)) : disc;
      const band = rgb(getComputedStyle(c.querySelector('.sdk-card-head')).backgroundColor);
      const rcs = getComputedStyle(ric);
      const rowDisc = rgb(rcs.backgroundColor);
      const rowGlyph = rgb(rcs.color);
      const rowEdge = v.id === 'v4' ? rgb(firstColour(rcs.boxShadow)) : rowDisc;
      const rowSurface = rgb(getComputedStyle(c.querySelector('.sdk-row')).backgroundColor);
      out[v.id][k.name] = {
        glyph: Math.min(ratio(glyph, disc), ratio(rowGlyph, rowDisc)),
        surface: Math.min(ratio(edge, band), ratio(rowEdge, rowSurface)),
      };
    }
  }
  return out;
}
function drawNumbers() {
  const m = measure();
  tbl.textContent = '';
  const cap = el('caption', 'ci-variant-note', `${D.documentElement.dataset.ppTheme || 'strong-coffee'}, ${D.documentElement.dataset.themeMode}`);
  cap.style.textAlign = 'left';
  const thead = el('thead');
  const r1 = el('tr');
  r1.append(el('th', '', 'Kind'));
  for (const v of VARIANTS) { const t = el('th', '', `${v.id.slice(1)} ${v.name}`); t.colSpan = 2; t.style.textAlign = 'center'; r1.append(t); }
  const r2 = el('tr');
  r2.append(el('th', '', ''));
  for (let i = 0; i < VARIANTS.length; i += 1) r2.append(el('th', '', 'Glyph on disc'), el('th', '', 'Disc on surface'));
  thead.append(r1, r2);
  const tb = el('tbody');
  const low = {};
  for (const k of KINDS) {
    const tr = el('tr');
    tr.append(el('td', '', k.name));
    for (const v of VARIANTS) {
      const x = m[v.id][k.name];
      for (const [key, aim] of [['glyph', 4.5], ['surface', 3]]) {
        const bad = x[key] < aim;
        tr.append(el('td', bad ? 'ci-low' : '', `${x[key].toFixed(2)}${bad ? ' !' : ''}`));
        const lk = `${v.id}${key}`;
        low[lk] = Math.min(low[lk] ?? 99, x[key]);
      }
    }
    tb.append(tr);
  }
  const tf = el('tfoot');
  const fr = el('tr');
  fr.append(el('td', '', 'Lowest'));
  for (const v of VARIANTS) {
    for (const [key, aim] of [['glyph', 4.5], ['surface', 3]]) {
      const x = low[`${v.id}${key}`];
      fr.append(el('td', x < aim ? 'ci-low' : '', `${x.toFixed(2)}${x < aim ? ' !' : ''}`));
    }
  }
  tf.append(fr);
  tbl.append(cap, thead, tb, tf);
  window.__ciNumbers = m;
}
const redraw = () => requestAnimationFrame(() => requestAnimationFrame(drawNumbers));
new MutationObserver(redraw).observe(D.documentElement, { attributes: true, attributeFilter: ['data-theme-mode', 'data-pp-theme'] });
D.getElementById('pp-theme-css').addEventListener('load', redraw);

drawSwitch();
apply();
if (D.fonts && D.fonts.ready) D.fonts.ready.then(redraw);
redraw();
