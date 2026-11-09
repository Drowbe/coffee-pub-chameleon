// The map screen (map-screen.html): one drawing of the Prototype's Maps section (plan-map-options.md, step 0). Design-process only: nothing
// here ships. The page is an iframe of prototype-maps.js, so its app theme (?theme=&mode=) and its width are its own.
//  - The frame is the real createModuleFrame: the title bar with "+" (Add a place), the "..." menu with Map options, the search in the
//    toolbar, the status line.
//  - The map is a picture made of the --map-* tokens (the map library and a map file would draw it in the product; neither is here): land,
//    water, parks, woods, buildings, three road classes and paths, a region border, and the place names with their halo.
//  - Over it, the module's own markup and rules (maps.css, from sources.js, in a shadow root as the product has it): the pins, a selected
//    one, a search result's pin, a cluster, the search results, the zoom buttons and the credit.
//  - Map options: the panel (prototype-maps.css, "to maps.css"), opened from the menu, closed by Escape, a click outside or its close button.
//    It saves on every change (here: for this tab only) and the map redraws at once.
// window.mapMeasure() returns the colours as drawn and their contrast, for the section's numbers and for tools/check-prototype-page.mjs.
import { createModuleFrame } from '/module-frame.js';

const D = document;
const q = new URLSearchParams(location.search);
const THEMES = ['chameleon', 'strong-coffee', 'calming-teal', 'burnt-orange'];
const SCENES = ['map', 'menu', 'options', 'later', 'picture', 'guest'];
const S = {
  id: q.get('id') || '',
  theme: THEMES.includes(q.get('theme')) ? q.get('theme') : 'chameleon',
  mode: q.get('mode') === 'light' ? 'light' : 'dark',
  choice: ['default', 'light', 'dark'].includes(q.get('map')) ? q.get('map') : 'default',
  scene: SCENES.includes(q.get('scene')) ? q.get('scene') : 'map',
  edge: q.get('edge') === 'map' ? 'map' : 'app',
  // Whether the app theme names its map (step 3, `--map-default`): the shipped dark themes name Light (decision 5). ?tdef=none draws
  // Theme default as it is until step 3 is built: today's map, mixed from the app theme.
  tdef: q.get('tdef') === 'none' ? 'none' : 'set',
  open: false,
};
D.getElementById('ms-theme-css').href = `themes/${S.theme}.css`;
D.documentElement.dataset.themeMode = S.mode;
const guest = S.scene === 'guest';
const picture = S.scene === 'picture';

// The map theme a choice gives: Theme default is the app theme's own map (Light for a shipped dark theme), else today's mixed map (none).
const themeMap = () => (S.tdef === 'set' && S.mode === 'dark' ? 'light' : '');
const resolved = (choice) => (choice === 'default' ? themeMap() : choice);
const CHOICES = [
  { id: 'default', label: 'Theme default' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];
const defaultDesc = () => (themeMap() === 'light' ? 'Light, from the theme' : 'Matches the theme');

// ---- small helpers ----
const h = (tag, cls, text) => { const e = D.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => { const e = D.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const svgs = () => (window.DS_SOURCES || {}).svgs || {};
// An icon as the module draws one (host.ui.icon: the SVG); the interface's icon font where the snapshot has no SVG of it.
function ic(name, cls = 'ic') {
  const span = h('span', cls);
  span.setAttribute('aria-hidden', 'true');
  if (svgs()[name]) span.innerHTML = svgs()[name];
  else span.append(h('i', `fa-solid fa-${name} fa-fw`));
  return span;
}

// ---- the module's stylesheets, in the shadow root as the product has them (maps.css from sources.js, then host.css and system.css) ----
const scopeCss = (text) => text.replace(/:root\s*\{[^}]*\}/g, '').replace(/(^|[\s,}])(html|body)(?=[\s,{.:[])/g, '$1:host');
async function sheets() {
  const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u} ${r.status}`); return r.text(); };
  const [host, system, own] = await Promise.all([get('/sdk/host.css'), get('/sdk/system.css'), get(new URL('prototype-maps.css', import.meta.url))]);
  const files = (((window.DS_SOURCES || {}).modules || {}).maps || {}).files || [];
  const module = files.filter((f) => f.page).map((f) => f.text).join('\n');
  return `${scopeCss(host)}\n${scopeCss(system)}\n${scopeCss(module)}\n${own}`;
}

// ---- the map, as a picture (800 by 500, cut to fill the screen as the map fills its window) ----
const W0 = 800; const H0 = 500;
function geography() {
  const g = s('svg', { class: 'ms-geo', viewBox: `0 0 ${W0} ${H0}`, preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' });
  g.append(s('rect', { class: 'g-land', x: 0, y: 0, width: W0, height: H0 }));
  g.append(s('path', { class: 'g-wood', d: 'M610,20 C680,10 770,30 790,80 C800,130 740,150 680,140 C620,130 590,70 610,20Z' }));
  g.append(s('path', { class: 'g-park', d: 'M30,110 C80,80 170,90 195,140 C210,195 160,240 95,232 C45,226 18,170 30,110Z' }));
  g.append(s('ellipse', { class: 'g-park', cx: 330, cy: 196, rx: 34, ry: 22 }));
  // the buildings of the centre: blocks between the streets (the style draws them from zoom 15)
  for (let x = 250; x < 600; x += 26) {
    for (let y = 110; y < 320; y += 22) {
      if ((x * 7 + y * 3) % 5 === 0) continue;
      if (Math.abs(y - 0.12 * x - 228) < 16) continue; // the avenue
      if (Math.abs(x - 440) < 14) continue;
      if (x > 300 && x < 365 && y > 172 && y < 222) continue; // the garden
      g.append(s('rect', { class: 'g-building', x, y, width: 18, height: 14, rx: 1 }));
    }
  }
  g.append(s('path', { class: 'g-water', d: 'M0,350 C120,326 220,346 330,336 C450,326 560,298 680,318 C740,328 780,308 800,300 L800,500 L0,500Z' }));
  g.append(s('path', { class: 'g-land', d: 'M0,462 C200,440 400,452 560,432 C680,416 760,430 800,420 L800,500 L0,500Z' }));
  g.append(s('path', { class: 'g-river', d: 'M640,0 C630,90 660,190 650,312', 'stroke-width': 6 }));
  const road = (cls, d) => g.append(s('path', { class: `g-road ${cls}`, d }));
  for (const d of ['M60,130 C90,160 120,180 170,170', 'M80,210 C110,190 150,200 180,150']) road('g-path', d);
  for (const x of [270, 320, 380, 500, 560]) road('g-minor', `M${x},90 L${x + 12},330`);
  for (const y of [130, 175, 215, 265]) road('g-minor', `M240,${y} L610,${y - 10}`);
  road('g-minor', 'M200,330 C230,300 240,260 230,200');
  road('g-medium', 'M210,100 C300,120 420,100 600,120');
  road('g-medium', 'M600,120 C620,200 600,260 590,300');
  road('g-medium', 'M140,320 C170,280 200,250 250,240');
  road('g-major', 'M0,318 C200,306 400,314 560,292 C650,280 720,262 800,252');
  road('g-major', 'M430,0 C436,110 446,200 452,300');
  road('g-major', 'M560,440 C600,420 640,400 700,330');
  g.append(s('path', { class: 'g-border', d: 'M0,64 C200,84 300,44 500,74 C600,89 700,64 800,84' }));
  return g;
}
// An invented world, for the picture map: a picture with its own colours, the same whatever the map theme.
function pictureMap() {
  const g = s('svg', { class: 'ms-geo ms-picture', viewBox: `0 0 ${W0} ${H0}`, preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' });
  g.append(s('rect', { class: 'g-sea', x: 0, y: 0, width: W0, height: H0 }));
  g.append(s('path', { class: 'g-isle', d: 'M120,140 C200,60 380,70 460,130 C540,190 520,300 430,350 C330,400 180,380 120,300 C80,250 80,190 120,140Z' }));
  g.append(s('path', { class: 'g-isle', d: 'M560,260 C610,220 700,230 720,290 C740,350 680,400 620,390 C560,380 520,310 560,260Z' }));
  g.append(s('ellipse', { class: 'g-hill', cx: 280, cy: 200, rx: 70, ry: 40 }));
  g.append(s('ellipse', { class: 'g-hill', cx: 650, cy: 310, rx: 30, ry: 20 }));
  g.append(s('path', { class: 'g-trail', d: 'M170,290 C240,250 300,280 360,230 C400,200 460,240 520,280 C560,300 600,300 640,300' }));
  const t = s('text', { class: 'g-script', x: 230, y: 425 });
  t.textContent = 'The Sunken Isles';
  g.append(t);
  return g;
}

// The place names: [words, kind, x, y, on]. A name on the water is held to 3 to 1 there (MAP_MIN.labelWater).
const NAMES = [
  ['Lisbon', 'city', 430, 150], ['Almada', 'city', 520, 476],
  ['Alfama', 'local', 540, 232], ['Baixa', 'local', 470, 252], ['Estrela', 'local', 330, 226], ['Belém', 'local', 140, 336],
  ['Cais do Sodré', 'local', 470, 352, 'water'],
  ['Lisboa', 'region', 300, 96], ['Setúbal', 'region', 690, 486],
];
// The pins: the module's markup (tpl-pin). cat and tint as Places gives them; sel the selected one; kind object, cluster, candidate, mine.
const PINS = [
  { name: 'Castelo de São Jorge', icon: 'landmark', cat: 'sights', tint: 'teal', x: 520, y: 178, sel: true },
  { name: 'Hotel Alfama', icon: 'bed', cat: 'stay', tint: 'green', x: 572, y: 214, visit: 'booked', visitIcon: 'calendar-check' },
  { name: 'Time Out Market', icon: 'utensils', cat: 'food', tint: 'blue', x: 400, y: 296, visit: 'favorite', visitIcon: 'star' },
  { name: 'Jardim da Estrela', icon: 'tree', cat: 'nature', tint: 'purple', x: 332, y: 190 },
  { name: 'Dinner booking', icon: 'calendar', kind: 'object', x: 470, y: 222 },
  { name: 'Miradouro', icon: 'location-dot', cat: 'activities', tint: 'orange', x: 600, y: 262, mine: true },
  { count: 3, x: 190, y: 296 },
];
const CANDIDATE = { name: 'Pastéis de Belém', icon: 'location-dot', x: 118, y: 292 };
const PICTURE_PINS = [
  { name: 'The old lighthouse', icon: 'landmark', cat: 'sights', tint: 'teal', x: 450, y: 150, sel: true },
  { name: 'Smugglers\' cove', icon: 'location-dot', cat: 'activities', tint: 'orange', x: 600, y: 300 },
  { name: 'Camp', icon: 'bed', cat: 'stay', tint: 'green', x: 220, y: 280 },
];
const RESULTS = [
  ['Pastéis de Belém', 'Rua de Belém 84, Lisbon'],
  ['Pastelaria Alcôa', 'Rua Garrett 37, Lisbon'],
  ['Pastelaria Versailles', 'Avenida da República 15A, Lisbon'],
];

function pin(p, extra = '') {
  if (p.count) {
    const b = h('button', 'pin cluster');
    b.type = 'button'; b.dataset.kind = 'cluster';
    b.setAttribute('aria-label', `${p.count} places`);
    b.append(h('span', 'pin-body', String(p.count)));
    return b;
  }
  const b = h('button', `pin${p.sel ? ' selected' : ''}${extra}`);
  b.type = 'button';
  b.dataset.kind = p.kind || 'place';
  if (p.cat) { b.dataset.cat = p.cat; b.style.setProperty('--tone', `var(--tint-${p.tint})`); }
  if (p.mine) b.dataset.scope = 'person';
  const body = h('span', 'pin-body');
  body.append(ic(p.icon));
  const badge = h('span', 'pin-badge');
  if (p.visit) { badge.dataset.visit = p.visit; badge.append(ic(p.visitIcon)); } else badge.hidden = true;
  const label = h('span', 'pin-label', p.name);
  b.setAttribute('aria-label', p.name);
  b.append(body, badge, label);
  return b;
}

// ---- the panel: Map options ----
function swatch(choice) {
  const box = h('span', 'mo-swatch');
  const m = resolved(choice);
  if (m) box.dataset.mapTheme = m;
  const g = s('svg', { viewBox: '0 0 40 28', 'aria-hidden': 'true' });
  g.append(s('rect', { class: 's-land', x: 0, y: 0, width: 40, height: 28 }), s('circle', { class: 's-park', cx: 8, cy: 7, r: 6 }),
    s('path', { class: 's-water', d: 'M20,28 C25,20 32,18 40,15 L40,28Z' }), s('path', { class: 's-minor', d: 'M12,0 L18,28' }),
    s('path', { class: 's-road', d: 'M0,21 C12,17 22,11 40,6' }));
  box.append(g);
  return box;
}
function laterSection() {
  const sec = h('fieldset', 'mo-sec mo-later');
  sec.disabled = true;
  sec.append(h('legend', 'mo-sec-name', 'Show on the map'));
  const tag = h('span', 'sdk-chip-tag mo-later-tag', 'Later, not built');
  const list = h('div', 'sdk-choice-list');
  for (const [word, on, desc] of [['Place names', true], ['Buildings', true], ['Borders', true], ['Paths', true], ['Transit', false, 'Once the map draws it']]) {
    const row = h('label', 'sdk-choice-row');
    const inp = h('input', 'sdk-switch');
    inp.type = 'checkbox'; inp.checked = on;
    const text = h('span', 'sdk-choice-text');
    text.append(h('span', 'sdk-choice-label', word));
    if (desc) text.append(h('span', 'sdk-choice-desc', desc));
    row.append(text, inp);
    list.append(row);
  }
  const units = h('fieldset', 'mo-sec');
  units.append(h('legend', 'mo-sec-name', 'Units'));
  const sw = h('div', 'mf-switch');
  sw.setAttribute('role', 'radiogroup');
  sw.setAttribute('aria-label', 'Units');
  for (const [id, word] of [['km', 'Kilometres'], ['mi', 'Miles']]) {
    const b = h('button', 'mf-switch-btn');
    b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(id === 'km')); b.tabIndex = id === 'km' ? 0 : -1;
    b.disabled = true;
    b.append(h('span', '', word));
    sw.append(b);
  }
  units.append(sw);
  sec.append(tag, list, units);
  return sec;
}
let pop = null;
function buildOptions() {
  const p = h('div', 'sdk-popover mo-pop');
  p.setAttribute('role', 'dialog');
  p.setAttribute('aria-labelledby', 'mo-title');
  const head = h('div', 'mo-head');
  const title = h('h2', 'mo-title', 'Map options');
  title.id = 'mo-title';
  const close = h('button', 'sdk-icon-btn btn-quiet btn-small mo-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.dataset.tip = 'Close';
  close.append(ic('xmark'));
  close.addEventListener('click', () => closeOptions(true));
  head.append(title, close);
  const sec = h('fieldset', 'mo-sec');
  sec.append(h('legend', 'mo-sec-name', 'Map theme'));
  if (picture) sec.append(h('p', 'mo-note', 'A picture map keeps its own colours.'));
  else {
    const list = h('div', 'sdk-choice-list');
    for (const c of CHOICES) {
      const row = h('label', 'sdk-choice-row');
      row.dataset.choice = c.id;
      const inp = h('input');
      inp.type = 'radio'; inp.name = 'map-theme'; inp.value = c.id; inp.checked = S.choice === c.id;
      inp.addEventListener('change', () => { if (inp.checked) choose(c.id); });
      const text = h('span', 'sdk-choice-text');
      text.append(h('span', 'sdk-choice-label', c.label));
      if (c.id === 'default') text.append(h('span', 'sdk-choice-desc', defaultDesc()));
      row.append(inp, swatch(c.id), text);
      list.append(row);
    }
    sec.append(list);
  }
  p.append(head, sec);
  if (S.scene === 'later') p.append(laterSection());
  p.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeOptions(true); } });
  return p;
}
function openOptions(focus) {
  if (!pop) { pop = buildOptions(); area.append(pop); }
  pop.hidden = false;
  S.open = true;
  results.hidden = true;
  if (focus) (pop.querySelector('input:checked') || pop.querySelector('.mo-close')).focus();
}
function closeOptions(back) {
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  S.open = false;
  if (back) { const t = D.querySelector('.mf-titlebar-menu'); if (t) t.focus(); }
}
function choose(id) {
  S.choice = id;
  apply();
  // It saves on every change (Maps' person data, `options`; a guest's in the browser). Here, for this tab only.
  if (parent !== window) parent.postMessage({ type: 'ms-change', id: S.id }, location.origin);
}

// ---- the frame ----
const root = D.getElementById('ms-root');
const hostEl = h('div', 'ms-host');
const shadow = hostEl.attachShadow({ mode: 'open' });
const style = D.createElement('style');
const fa = D.createElement('link');
fa.rel = 'stylesheet'; fa.href = new URL('../fa/css/all.min.css', import.meta.url).href;
const app = h('div', 'app');
app.id = 'app';
const area = h('div', 'map-area');
const map = h('div', 'map ms-map');
map.id = 'map';
const names = h('div', 'ms-names');
const pins = h('div', 'ms-pins');
const results = h('ul', 'results sdk-menu under-search');
results.setAttribute('role', 'listbox');
results.setAttribute('aria-label', 'Search results');
const zoom = h('div', 'maplibregl-ctrl-top-right');
const attribution = h('div', 'maplibregl-ctrl-bottom-right');
shadow.append(style, fa, app);
app.append(area);
area.append(map, results, zoom, attribution);

map.append(picture ? pictureMap() : geography(), names, pins);
if (!picture) for (const [word, kind, x, y, on] of NAMES) { const n = h('span', 'ms-name', word); n.dataset.kind = kind; if (on) n.dataset.on = on; n.dataset.x = x; n.dataset.y = y; names.append(n); }
const placed = [];
for (const p of picture ? PICTURE_PINS : PINS) { const b = pin(p); b.dataset.x = p.x; b.dataset.y = p.y; pins.append(b); placed.push(b); }
if (S.scene === 'map') { const c = pin(CANDIDATE, ' candidate'); c.dataset.x = CANDIDATE.x; c.dataset.y = CANDIDATE.y; pins.append(c); }
for (const [title, sub] of RESULTS) {
  const li = h('li');
  const b = h('button', 'result sdk-menu-item');
  b.type = 'button';
  b.append(ic('location-dot', 'ic sdk-menu-icon'), h('span', 'sdk-menu-label', title), h('span', 'sdk-menu-hint', sub));
  li.append(b);
  results.append(li);
}
results.hidden = S.scene !== 'map';
{
  const grp = h('div', 'maplibregl-ctrl-group ms-zoom');
  for (const [word, name] of [['Zoom in', 'plus'], ['Zoom out', 'minus']]) { const b = h('button'); b.type = 'button'; b.setAttribute('aria-label', word); b.append(ic(name)); grp.append(b); }
  zoom.append(grp);
  const credit = h('div', 'attribution');
  credit.append(D.createTextNode('© '));
  const a = h('a', '', 'OpenStreetMap');
  a.href = 'https://www.openstreetmap.org/copyright'; a.target = '_blank'; a.rel = 'noopener';
  credit.append(a, D.createTextNode(' contributors'));
  if (!picture) attribution.append(credit); // a picture map carries no map data, so no credit for it
}

const menuEntry = { id: 'map-options', label: 'Map options', icon: 'sliders', placement: 'menu' };
const frame = createModuleFrame({
  title: 'Map', icon: 'map',
  titlebar: { ...(guest ? {} : { add: { label: 'Add a place' } }), actions: [menuEntry], close: true },
  toolbar: [{ type: 'search', id: 'find', value: S.scene === 'map' ? 'pastel' : '', placeholder: picture ? 'Search saved places' : 'Search, or paste coordinates or a link', label: picture ? 'Search saved places' : 'Search the map' }],
  content: hostEl, flush: true,
  status: { items: S.scene === 'map' ? [{ text: '3 found' }, { text: '7 places shown' }] : [{ text: `${picture ? 3 : 7} places shown` }] },
  onAction: (e) => { if (e.area === 'titlebar' && e.id === 'map-options') openOptions(true); },
});
root.append(frame.el);

// The "..." menu, held open (scene menu): the host's own menu, copied open so it can be seen without a click (prototype.js does the same).
function heldMenu() {
  const items = frame.titlebarMenu();
  const menu = h('div', 'host-menu ms-menu-open');
  menu.setAttribute('aria-hidden', 'true');
  menu.inert = true;
  for (const it of items) {
    if (it.divider) { menu.append(h('div', 'host-menu-divider')); continue; }
    const b = h('button', `host-menu-item${it.danger ? ' danger' : ''}`);
    b.type = 'button'; b.tabIndex = -1;
    if (it.icon) b.append(h('i', `fa-${it.regular ? 'regular' : 'solid'} fa-${it.icon} fa-fw`));
    b.append(h('span', 'host-menu-label', it.label));
    menu.append(b);
  }
  root.style.position = 'relative';
  root.append(menu);
  const trigger = frame.el.querySelector('.mf-titlebar-menu');
  trigger.classList.add('ms-held');
  const place = () => {
    const t = trigger.getBoundingClientRect();
    menu.style.top = `${t.bottom + 4}px`;
    menu.style.left = `${Math.max(4, t.right - menu.offsetWidth)}px`;
  };
  new ResizeObserver(place).observe(frame.el);
  place();
}

// ---- drawing ----
function apply() {
  const m = resolved(S.choice);
  if (m && !picture) map.dataset.mapTheme = m; else delete map.dataset.mapTheme;
  app.dataset.pinEdge = S.edge;
  if (pop) for (const r of pop.querySelectorAll('input[name="map-theme"]')) r.checked = r.value === S.choice;
}
// The map is cut to fill its window (slice): the names and pins follow the same scale, at their own size, as the map library keeps them.
function layout() {
  const r = map.getBoundingClientRect();
  const k = Math.max(r.width / W0, r.height / H0);
  const ox = (r.width - W0 * k) / 2; const oy = (r.height - H0 * k) / 2;
  for (const e of [...names.children, ...pins.children]) { e.style.left = `${ox + Number(e.dataset.x) * k}px`; e.style.top = `${oy + Number(e.dataset.y) * k}px`; }
  // The cut can leave a name or a pin's chip past the map's edge: move it in so it sits whole inside (the map library keeps a name inside its tile the same way).
  const pad = 4;
  for (const e of [...names.children, ...pins.children]) {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const n of [e, ...e.querySelectorAll('*')]) { const b = n.getBoundingClientRect(); if (!b.width || !b.height) continue; x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top); x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom); }
    if (x0 === Infinity) continue;
    const dx = Math.max(r.left + pad - x0, 0) + Math.min(r.right - pad - x1, 0);
    const dy = Math.max(r.top + pad - y0, 0) + Math.min(r.bottom - pad - y1, 0);
    if (dx) e.style.left = `${parseFloat(e.style.left) + dx}px`;
    if (dy) e.style.top = `${parseFloat(e.style.top) + dy}px`;
  }
  app.classList.toggle('narrow', r.width < 720);
  app.classList.toggle('mo-tight', r.width < 480); // the panel goes across the map's width (to maps.js)
}

// ---- measuring: the colours as drawn, and their contrast (WCAG's ratio, as maps-lib-d-style.js measures) ----
function rgba(text) {
  const t = String(text || '').trim();
  let m = t.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?/i);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4]))];
  m = t.match(/^color\(\s*srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+%?))?/i);
  if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4]))];
  return null;
}
const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3]));
const whole = (c) => c.slice(0, 3).map(Math.round);
const lum = (c) => { const f = (x) => { const v = x / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function probe(into, value) {
  const p = h('span');
  p.style.color = value;
  into.append(p);
  const c = rgba(getComputedStyle(p).color);
  p.remove();
  return c;
}
window.mapMeasure = () => {
  const at = (v) => whole(probe(map, v));
  const land = at('var(--map-land)');
  const col = {
    land, water: at('var(--map-water)'), park: at('var(--map-park)'), wood: at('var(--map-wood)'),
    roadMinor: at('var(--map-road-minor)'), roadMedium: at('var(--map-road-medium)'), roadMajor: at('var(--map-road-major)'),
    building: at('var(--map-building)'), label: at('var(--map-label)'), boundary: at('var(--map-boundary)'),
    city: at('var(--map-ink, var(--text-primary))'), region: at('var(--map-muted, var(--text-dim, var(--text-muted)))'),
  };
  // What the clamp mixes toward (buildStyle's tok): the map theme's ink, blue and green, else the app theme's text and tints.
  const tok = { text: col.city, dim: col.region, blue: at('var(--map-blue, var(--tint-blue))'), green: at('var(--map-green, var(--tint-green))'), section: at('var(--bg-section, var(--surface-panel))'), bg: at('var(--bg, var(--surface-page))') };
  const drawnBoundary = [0, 1, 2].map((i) => col.boundary[i] * 0.7 + land[i] * 0.3);
  const sel = pins.querySelector('.pin.selected');
  const plain = pins.querySelector('.pin[data-cat]:not(.selected)');
  const pinOf = (b) => {
    if (!b) return null;
    const body = b.querySelector('.pin-body');
    const edge = rgba(getComputedStyle(body).borderTopColor);
    const ring = probe(b, 'var(--pin-ring)');
    const fill = rgba(getComputedStyle(body).backgroundColor);
    const label = b.querySelector('.pin-label');
    const chip = over(rgba(getComputedStyle(label).backgroundColor), land);
    const text = rgba(getComputedStyle(label).color);
    return { edge: ratio(over(edge, land), land), ring: ratio(over(ring, land), land), fill: ratio(over(fill, land), land), name: ratio(text, chip) };
  };
  const rs = getComputedStyle(results);
  const resBg = rgba(rs.backgroundColor);
  const resText = rgba(rs.color);
  return {
    theme: S.theme, mode: S.mode, choice: S.choice, map: picture ? 'picture' : (resolved(S.choice) || 'theme'), scene: S.scene, edge: S.edge,
    colours: col, tok,
    ratios: {
      label: ratio(col.label, land), labelWater: ratio(col.label, col.water),
      city: ratio(col.city, land), cityWater: ratio(col.city, col.water),
      region: ratio(col.region, land), regionWater: ratio(col.region, col.water),
      roadMinor: ratio(col.roadMinor, land), roadMedium: ratio(col.roadMedium, land), roadMajor: ratio(col.roadMajor, land),
      water: ratio(col.water, land), park: ratio(col.park, land), wood: ratio(col.wood, land), building: ratio(col.building, land),
      boundary: ratio(drawnBoundary, land),
      results: ratio(resText, over(resBg, land)), resultsOnMap: ratio(over(resBg, land), land),
    },
    pin: pinOf(plain), selected: pinOf(sel),
    open: S.open,
  };
};

(async () => {
  style.textContent = await sheets();
  apply();
  new ResizeObserver(layout).observe(map);
  layout();
  if (S.scene === 'menu') heldMenu();
  if (['options', 'later', 'picture', 'guest'].includes(S.scene)) openOptions(false);
  // A click outside the panel closes it (not one on the "..." menu, which opens it).
  D.addEventListener('pointerdown', (e) => {
    if (!S.open) return;
    const path = e.composedPath();
    if (path.includes(pop) || path.some((n) => n.classList && (n.classList.contains('host-menu') || n.classList.contains('mf-titlebar-menu')))) return;
    closeOptions(false);
  });
  D.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.open) closeOptions(true); });
  await D.fonts.ready;
  layout();
  D.documentElement.dataset.ready = '1';
  if (parent !== window) parent.postMessage({ type: 'ms-ready', id: S.id }, location.origin);
})();
