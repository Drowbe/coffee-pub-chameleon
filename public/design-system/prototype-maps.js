// The Maps section of the Prototype (plan-map-options.md, step 0; Thomas, 2026-11-04): the map themes and Map options, drawn for Thomas to
// judge before anything is built. Design-process only: nothing here ships. Each drawing is the map screen (map-screen.html,
// prototype-maps-screen.js) in an iframe, so it carries its own app theme (dark or light, side by side) and is a real viewport of its width.
// The theme chosen at the top of the page reaches every drawing; the switches below the heading redraw them. Under each map the contrast of
// its names, roads and pins is measured from the colours the browser draws, against MAP_MIN (the copy below; check-prototype-page.mjs holds
// it equal to modules/maps/src/maps-lib-d-style.js and runs that file's guardMap on the colours).
const D = document;
// The readability clamp's minimums, copied from modules/maps/src/maps-lib-d-style.js (MAP_MIN): tools/check-prototype-page.mjs fails when they differ.
export const MAP_MIN = { label: 4.5, labelWater: 3, roadMinor: 1.7, roadMedium: 2.3, roadMajor: 3, roadStep: 1.1, water: 1.5, park: 1.15, wood: 1.06, building: 1.15, boundary: 2 };

const h = (tag, cls, text) => { const e = D.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const q = new URLSearchParams(location.search);
const T = { edge: q.get('mpedge') === 'app' ? 'app' : 'map' }; // the recommendation is drawn first (question 2)
const frames = [];

const main = D.getElementById('pp-main');
const sec = h('section', 'mp-section');
sec.id = 'pp-maps';
sec.setAttribute('aria-labelledby', 'pp-maps-name');
const title = h('h2', 'pp-group-name', 'Maps: map themes and Map options');
title.id = 'pp-maps-name';
sec.append(title, h('p', 'pp-state-note', 'The plan\'s step 0 (plan-map-options.md): the map gets its own themes, Light and Dark, apart from the app theme, and each person picks one in Map options, from the map\'s "..." menu. Theme default is the app theme\'s own map: Light for the shipped dark themes (decided), else today\'s map. The map is a picture made of the map tokens (the real one needs a map file and WebGL); the pins, search results, buttons and the panel are the Maps module\'s own markup and styles. Each drawing has its own app theme, chosen with the switches at the top for the theme; nothing is saved.'));

// ---- the switch for what the plan leaves open ----
const bar = h('div', 'mp-bar');
bar.append(h('span', 'mp-bar-label', 'Pin edge (question 2):'));
const sw = h('div', 'mf-switch');
sw.setAttribute('role', 'radiogroup');
sw.setAttribute('aria-label', 'Pin edge');
function drawSwitch() {
  sw.textContent = '';
  for (const [id, word] of [['app', 'App colours (today)'], ['map', 'The map\'s colours']]) {
    const b = h('button', 'mf-switch-btn');
    b.type = 'button';
    b.dataset.key = `mpedge:${id}`;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(T.edge === id));
    b.tabIndex = T.edge === id ? 0 : -1;
    b.append(h('span', '', word));
    b.addEventListener('click', () => {
      T.edge = id; drawSwitch(); redraw(); sw.querySelector('[aria-checked="true"]').focus();
      const u = new URL(location.href); u.searchParams.set('mpedge', id); history.replaceState(null, '', u);
    });
    sw.append(b);
  }
}
drawSwitch();
bar.append(sw);
sec.append(bar);

const jump = h('nav', 'pp-jump');
jump.setAttribute('aria-label', 'Jump to a part of Maps');
jump.append(h('span', 'pp-jump-label', 'Jump to'));
sec.append(jump);

function set(id, name, note) {
  const s = h('section', 'mp-set');
  s.id = `mp-${id}`;
  s.setAttribute('aria-labelledby', `mp-${id}-name`);
  const hh = h('h3', 'mp-set-name', name);
  hh.id = `mp-${id}-name`;
  s.append(hh);
  if (note) s.append(h('p', 'pp-state-note', note));
  sec.append(s);
  const b = h('button', 'btn btn-small', name);
  b.type = 'button';
  b.addEventListener('click', () => { hh.scrollIntoView({ block: 'start' }); s.classList.add('pp-flash'); setTimeout(() => s.classList.remove('pp-flash'), 900); });
  jump.append(b);
  return s;
}

// The page's theme (the switch at the top), read at each draw.
const pageTheme = () => D.documentElement.dataset.ppTheme || 'chameleon';
const src = (f) => {
  const u = new URLSearchParams({ id: f.id, theme: pageTheme(), mode: f.mode, map: f.map, scene: f.scene, edge: T.edge });
  if (f.tdef) u.set('tdef', f.tdef);
  return `map-screen.html?${u}`;
};
// One drawing: its name, a note, the screen, and (with numbers) the contrast measured in it. Drawn when it comes near the screen.
function shot(into, f) {
  const cell = h('div', 'mp-cell');
  cell.append(h('h4', 'mp-cell-name', f.name));
  if (f.note) cell.append(h('p', 'pp-state-note', f.note));
  const fr = h('iframe', 'mp-shot');
  fr.title = f.name;
  fr.dataset.size = f.size || 'map';
  fr.dataset.mp = f.id;
  cell.append(fr);
  const out = h('div', 'ci-scroll');
  if (f.numbers) cell.append(out);
  into.append(cell);
  const rec = { ...f, fr, out, ready: false, shown: false };
  frames.push(rec);
  return rec;
}
function load(rec) { rec.shown = true; rec.ready = false; rec.fr.src = src(rec); }
function redraw() { for (const r of frames) if (r.shown) load(r); }
const io = new IntersectionObserver((list) => { for (const e of list) { const r = frames.find((x) => x.fr === e.target); if (r && e.isIntersecting && !r.shown) load(r); } }, { rootMargin: '300px 0px' });

// ---- the numbers under a map ----
const fmt = (x) => `${x.toFixed(2)}:1`;
function numbers(rec) {
  let m;
  try { m = rec.fr.contentWindow.mapMeasure(); } catch { return; }
  rec.measure = m;
  const r = m.ratios;
  const rows = [
    ['Names on land', r.label, MAP_MIN.label], ['Names on water', r.labelWater, MAP_MIN.labelWater],
    ['Town names on land', r.city, MAP_MIN.label], ['Town names on water', r.cityWater, MAP_MIN.labelWater],
    ['Region names on land', r.region, MAP_MIN.label], ['Region names on water', r.regionWater, MAP_MIN.labelWater],
    ['Minor road', r.roadMinor, MAP_MIN.roadMinor], ['Medium road', r.roadMedium, MAP_MIN.roadMedium], ['Major road', r.roadMajor, MAP_MIN.roadMajor],
    ['Water', r.water, MAP_MIN.water], ['Parks', r.park, MAP_MIN.park], ['Woods', r.wood, MAP_MIN.wood], ['Buildings', r.building, MAP_MIN.building], ['Border, as drawn', r.boundary, MAP_MIN.boundary],
  ];
  const pinRows = [];
  if (m.pin) pinRows.push(['Pin edge on the land', Math.max(m.pin.edge, m.pin.ring), 3, `edge ${fmt(m.pin.edge)}, ring ${fmt(m.pin.ring)}`], ['Pin name on its chip', m.pin.name, 4.5]);
  if (m.selected) pinRows.push(['Selected pin on the land', Math.max(m.selected.edge, m.selected.fill), 3, `edge ${fmt(m.selected.edge)}, fill ${fmt(m.selected.fill)}`]);
  pinRows.push(['Search results text', r.results, 4.5]);
  const t = h('table', 'ci-numbers');
  const head = h('thead');
  const hr = h('tr');
  for (const w of ['Against the land', 'Measured', 'Needs', '']) hr.append(h('th', '', w));
  head.append(hr);
  const body = h('tbody');
  const row = ([name, v, need, note]) => {
    const tr = h('tr');
    const ok = v >= need - 1e-9;
    const cell = h('td', ok ? '' : 'ci-low', fmt(v));
    tr.append(h('td', '', name), cell, h('td', '', `${need}`), h('td', ok ? '' : 'ci-low', note || (ok ? 'ok' : 'under')));
    body.append(tr);
  };
  rows.forEach(row);
  const sep = h('tr');
  const sh = h('th', '', 'Over the map, in app colours');
  sh.colSpan = 4;
  sep.append(sh);
  body.append(sep);
  pinRows.forEach(row);
  t.append(head, body);
  rec.out.textContent = '';
  rec.out.append(t);
}
addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data || !['ms-ready', 'ms-change'].includes(e.data.type)) return;
  const rec = frames.find((r) => r.id === e.data.id);
  if (!rec) return;
  rec.ready = true;
  if (rec.numbers) numbers(rec);
});

// ================= 1. the map themes =================
{
  const s = set('themes', 'The map themes', 'Light and Dark, each under a dark and a light app theme: the map is the same, only what sits over it (pins, names on chips, the search results, the buttons) takes the app theme. The pins, a selected pin (the castle), a search result\'s pin (dashed, Pastéis de Belém), a group of three and the search results for "pastel". Cais do Sodré is a place name that falls on the water. Under each, the contrast as drawn.');
  const g = h('div', 'mp-grid');
  s.append(g);
  for (const [map, word] of [['light', 'Light'], ['dark', 'Dark']]) {
    for (const mode of ['dark', 'light']) shot(g, { id: `themes-${map}-${mode}`, name: `${word} map, ${mode} app theme`, mode, map, scene: 'map', numbers: true });
  }
  s.append(h('p', 'pp-state-note', 'For comparison, Theme default as it is until a theme can name its map (step 3): today\'s map, mixed from the app theme. Its numbers are the tokens before the clamp; the product moves any that fall short.'));
  const g2 = h('div', 'mp-grid');
  s.append(g2);
  for (const mode of ['dark', 'light']) shot(g2, { id: `themes-today-${mode}`, name: `Today's map, ${mode} app theme`, mode, map: 'default', tdef: 'none', scene: 'map', numbers: true });
}
// ================= 2. the menu =================
{
  const s = set('menu', 'The "..." menu', 'Map options is the module\'s own entry, first, above the window\'s standard ones (a toolbar entry with placement "menu"; icon: sliders). The menu is held open here as a picture; in the other drawings it opens from "...".');
  const row = h('div', 'mp-row');
  s.append(row);
  shot(row, { id: 'menu-dark', name: 'Dark app theme', mode: 'dark', map: 'default', scene: 'menu', size: 'menu' });
  shot(row, { id: 'menu-light', name: 'Light app theme', mode: 'light', map: 'default', scene: 'menu', size: 'menu' });
}
// ================= 3. the panel =================
{
  const s = set('options', 'Map options', 'A small panel over the map\'s corner, with no Save: a choice applies at once and is kept. Each choice has a swatch of the land, water and a road it gives. Theme default says what it gives in this theme. Escape, a click outside or the close button closes it, and the focus goes back to "...". Try it: pick a theme, close it, open it again from "...".');
  const row = h('div', 'mp-row');
  s.append(row);
  shot(row, { id: 'options-dark', name: 'Desktop, dark app theme, Theme default (Light)', mode: 'dark', map: 'default', scene: 'options', size: 'desktop' });
  shot(row, { id: 'options-light', name: 'Desktop, light app theme, Dark chosen', mode: 'light', map: 'dark', scene: 'options', size: 'desktop' });
  const row2 = h('div', 'mp-row');
  s.append(row2);
  shot(row2, { id: 'options-390-dark', name: '390, dark app theme', note: 'Across the map\'s width; every row and the close button is a 44px tap.', mode: 'dark', map: 'light', scene: 'options', size: 'phone' });
  shot(row2, { id: 'options-390-light', name: '390, light app theme', mode: 'light', map: 'default', scene: 'options', size: 'phone' });
}
// ================= 4. later sections =================
{
  const s = set('later', 'Later: Show on the map, Units', 'A sketch of where later options go, under Map theme, each a heading and its controls. Not built, and off here: place names, buildings, borders, paths, and transit once the style draws it; kilometres or miles once the map has a scale or distances. No terrain: the map files carry no heights.');
  const row = h('div', 'mp-row');
  s.append(row);
  shot(row, { id: 'later-desktop', name: 'Desktop, dark app theme', mode: 'dark', map: 'default', scene: 'later', size: 'desktop' });
  shot(row, { id: 'later-390', name: '390, light app theme', mode: 'light', map: 'light', scene: 'later', size: 'phone' });
}
// ================= 5. a picture map, a guest =================
{
  const s = set('other', 'A picture map, a guest', 'A picture map keeps its own colours, so Map theme shows one line instead of the choices. A guest sees the same panel (no "+", since a guest cannot add a place); their choice is kept in their browser, not on the server.');
  const row = h('div', 'mp-row');
  s.append(row);
  shot(row, { id: 'picture', name: 'A picture map', mode: 'dark', map: 'default', scene: 'picture', size: 'desktop' });
  shot(row, { id: 'guest', name: 'A guest, 390', mode: 'dark', map: 'default', scene: 'guest', size: 'phone' });
}
// ================= 6. questions =================
{
  const s = set('questions', 'Decided, and one still open', 'Thomas decided the first, second, third and fifth; they are drawn as decided. The fourth is still open, with its recommendation.');
  const ol = h('ol', 'mp-qlist');
  for (const [ask, rec] of [
    ['The region names (LISBOA) are the app\'s muted text today. On a light map in a dark app that is under 4.5 to 1, so the clamp would move it. Give each map theme its own muted colour (--map-muted, drawn here)?', 'Decided: yes. It is one more token beside the plan\'s three (ink, blue, green), and it lets every map theme hold the minimums with nothing moved.'],
    ['The pins take the app\'s colours today. A plain pin still reads on every map (its ring), but the selected pin is filled with the app\'s text colour: on a light map in a dark app that is a pale disc on pale land (1.1 to 1, its teal edge 2 to 1). Take the pins\' edge from the map instead (the switch above)?', 'Decided: yes, the map\'s colours (drawn first): a pin\'s edge is the land and its ring the map\'s ink, and the selected pin is filled with the map\'s ink, so a pin looks the same on a given map whatever the app theme, and every pin is 3 to 1 or more on the land. Switch to App colours to see today\'s, with its numbers.'],
    ['Theme default shows what it gives ("Light, from the theme"). Keep that line, or the word alone?', 'Decided: keep it. Without it, Theme default and Light look like two different choices when, under a dark theme, they are the same map.'],
    ['The plan puts the map theme on the whole module (#app). Then the panel\'s Theme default swatch cannot show the app theme\'s own map. Put it on the map alone (#map) instead, as drawn?', 'Yes: the pins and the place names are on the map and follow it; the panel and the search results are not and keep the app theme; the module reads the map\'s colours from the map.'],
    ['Should the panel tell a guest their choice is kept only in this browser?', 'Decided: no note. It behaves the same for them, and one more line is noise.'],
  ]) {
    const li = h('li');
    li.append(h('strong', '', ask), h('span', '', ` Recommendation: ${rec}`));
    ol.append(li);
  }
  s.append(ol);
}

// After the Phone section, before Icon colour (so it is not next to the Vault, whose scroll is timed by the checks).
const ci = main.querySelector('.ci-section');
if (ci) main.insertBefore(sec, ci); else main.append(sec);
for (const r of frames) io.observe(r.fr);
// The page's own jump list (prototype-phone.js; the Vault moves it into the dock): one more button.
const pageJump = D.querySelector('nav.pp-jump[aria-label="Jump to a section of the page"]');
if (pageJump) {
  const b = h('button', 'btn btn-small', 'Maps');
  b.type = 'button';
  b.addEventListener('click', () => title.scrollIntoView({ block: 'start' }));
  pageJump.append(b);
}
// The theme switch at the top: redraw what is drawn.
new MutationObserver((list) => { if (list.some((m) => m.oldValue !== pageTheme())) redraw(); }).observe(D.documentElement, { attributes: true, attributeOldValue: true, attributeFilter: ['data-pp-theme'] });
window.mapsSection = { frames, MAP_MIN, load };
