// The Phone section of the Prototype (Thomas, 2026-11-01): the shared phone pieces drawn for him to judge before anything is built
// (plan-phone-experience.md, "Navigation on a phone"). The screen is phone.html in an iframe of the device's size, so it is a real
// viewport and the product's own @media rules apply; the frame around it (status bar, home indicator, keyboard) is drawn here.
// Design-process only: nothing here ships. The page's Theme, Dark/Light and Light switches reach the screen through the attributes they set on <html>.
const D = document;
const DEVICES = [
  { id: '390', label: '390 × 844', w: 390, h: 844, kb: 336 },
  { id: '360', label: '360 × 780', w: 360, h: 780, kb: 336 },
  { id: 'land', label: '844 × 390', w: 844, h: 390, kb: 200, land: true },
];
const opts = (...a) => a.map(([id, label]) => ({ id, label }));
const CALLS = opts(['off', 'Not in a call'], ['on', 'In a call'], ['speaking', 'Speaking'], ['muted', 'Muted']);
const VIEWS = opts(['call', 'Call'], ['chat', 'Chat'], ['module', 'Module']);
const SHEETS = opts(['none', 'None'], ['more', 'More'], ['pin', 'Edit the four'], ['replace', 'Replace one'], ['states', 'Bar states'], ['object', 'Full sheet'], ['edit', 'Edit sheet'], ['actions', 'Bottom sheet'], ['bar', 'Action bar'], ['menu', 'Menu'], ['online', 'Online'], ['leave', 'Leave?']);
// Where the switcher (More) sits: at the end as a fifth place (A), or in the middle as a small round button (B); Both draws the two side by side.
const BARS = opts(['both', 'Both'], ['end', 'A: at the end'], ['middle', 'B: in the middle']);
const GLYPHS = opts(['lines', 'Three lines'], ['dots', 'Three dots']);
const KBS = opts(['0', 'Down'], ['1', 'Up']);
const PRESETS = [
  ['Planner, not in the call', { call: 'off', view: 'module', sheet: 'none', kb: '0' }],
  ['Planner, in the call', { call: 'on', view: 'module', sheet: 'none', kb: '0' }],
  ['Chat with new, speaking', { call: 'speaking', view: 'chat', sheet: 'none', kb: '0' }],
  ['Muted, Planner', { call: 'muted', view: 'module', sheet: 'none', kb: '0' }],
  ['The call, opened from the top bar', { call: 'speaking', view: 'call', sheet: 'none', kb: '0' }],
  ['More list', { sheet: 'more', kb: '0' }],
  ['Edit the four', { sheet: 'pin', kb: '0' }],
  ['Replace one', { sheet: 'replace', kb: '0' }],
  ['Bar states', { sheet: 'states', kb: '0' }],
  ['Leave?', { sheet: 'leave', kb: '0' }],
  ['Edit, keyboard up', { sheet: 'edit', kb: '1' }],
  ['Chat, keyboard up', { call: 'on', view: 'chat', sheet: 'none', kb: '1' }],
  ['Bottom sheet', { sheet: 'actions', kb: '0' }],
  ['Action bar', { call: 'on', sheet: 'bar', kb: '0' }],
];
const state = { device: '390', call: 'off', view: 'module', sheet: 'none', kb: '0', module: 'planner', bar: 'both', glyph: 'lines' };
const KEYS = ['device', 'call', 'view', 'sheet', 'kb', 'bar', 'glyph'];
const q = new URLSearchParams(location.search);
for (const k of KEYS) if (q.get(`ph${k}`)) state[k] = q.get(`ph${k}`);

const main = D.getElementById('pp-main');
const sec = D.createElement('section');
sec.className = 'pp-group phf';
sec.id = 'pp-phone';
sec.setAttribute('aria-labelledby', 'pp-phone-name');
const h = D.createElement('h2');
h.className = 'pp-group-name';
h.id = 'pp-phone-name';
h.textContent = 'Phone: the shared pieces';
const note = D.createElement('p');
note.className = 'pp-state-note';
note.textContent = 'The space on a phone, as Thomas decided on 2026-11-03: the top bar (the space\'s name, Online beside it, the call button, the menu with Leave), the view, a call strip above the fixed bottom bar while you are in the call and looking at something else, and the bottom bar: four places of your own and a switcher, More. The call is never in the bar: the top bar\'s phone opens it. The four start as the template\'s (travel: Chat, Planner, Calendar, Map) and each person can pin their own from More. The switcher is drawn two ways for you to choose: A at the end, B in the middle (the Switcher switch: Both puts them side by side). Sideways, the bar is a rail. The screen is a real viewport of the size chosen, so the product\'s own rules apply inside it. Pick a state below, or a preset; Bar states shows the pressed, focus and long-label cases.';
const tools = D.createElement('div');
tools.className = 'phf-tools';
const presets = D.createElement('div');
presets.className = 'pp-jump';
presets.setAttribute('role', 'group');
presets.setAttribute('aria-label', 'Phone presets');
const stage = D.createElement('div');
stage.className = 'phf-stage';
const measure = D.createElement('p');
measure.className = 'phf-measure';
measure.textContent = 'Safe areas: 47px at the top and 34px at the foot upright; sideways 47px at each side and 21px at the foot (a phone\'s own). With the keyboard up the screen is 336px shorter (200px sideways), and the bar and the call strip give their room to the field.';
const qs = D.createElement('div');
qs.className = 'phf-qs';
const qh = D.createElement('h3');
qh.className = 'phf-qs-name';
qh.textContent = 'Questions for Thomas';
const qnote = D.createElement('p');
qnote.className = 'phf-note';
qnote.textContent = 'Only what the brief of 2026-11-03 left open. Each has a recommendation; the drawing already shows it.';
const ql = D.createElement('ol');
ql.className = 'phf-qlist';
for (const [ask, rec] of [
  ['Does the round button (B) carry the word More under it?', 'No. It has its name for a screen reader; a word under a small disc would crowd the four.'],
  ['For B, which glyph in the round button, three lines or three dots?', 'Three lines. The top bar\'s Menu is already three dots, so the two never look alike. (A\'s icon is decided: three lines.)'],
  ['Does More show the new count of the places that are not in the bar?', 'Yes, the total (drawn: 4, from To-do and Polls). Without it a new To-do is invisible while the bar holds Chat, Planner, Calendar and Map.'],
  ['When the open module is not one of the four, does the switcher show you are there?', 'Yes (drawn in Bar states: the open look on More). Otherwise no place in the bar is marked and the person is lost.'],
  ['The round button\'s size and place (plan question 29), if B is kept: 44px inset in the bar, or 48px raised above its top edge?', '44px inset (drawn). A raised button cannot collide with the call strip or the keyboard-up bar.'],
  ['Where is a person\'s four remembered (plan question 28)? (a) in the browser, per space; (b) on the account; (c) the browser first, the account later.', '(b) for members and owners, the template\'s four for guests, because people re-pin on one phone and expect the same on the next. (c) if Thomas wants no server work now.'],
  ['A pinned module that is off in the space you are in: what takes its place?', 'The first module of the template\'s four that is not already in the bar, as the plan does for the template\'s own four (question 27), so the bar still holds four.'],
  ['Sideways, does B keep the round button?', 'Yes, in the middle of the rail, a 56px target like the rest.'],
]) {
  const li = D.createElement('li');
  const a = D.createElement('strong'); a.textContent = ask;
  const r = D.createElement('span'); r.textContent = ` Recommendation: ${rec}`;
  li.append(a, r);
  ql.append(li);
}
qs.append(qh, qnote, ql);
sec.append(h, note, tools, presets, stage, measure, qs);
main.append(sec);

let frames = [];
const switches = {};
function sw(key, label, options) {
  const wrap = D.createElement('div');
  wrap.className = 'phf-tool';
  const l = D.createElement('span');
  l.className = 'phf-tool-label';
  l.textContent = label;
  const box = D.createElement('div');
  box.className = 'mf-switch';
  box.setAttribute('role', 'radiogroup');
  box.setAttribute('aria-label', label);
  wrap.append(l, box);
  tools.append(wrap);
  switches[key] = () => {
    box.textContent = '';
    for (const o of options) {
      const b = D.createElement('button');
      b.type = 'button';
      b.className = 'mf-switch-btn';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(state[key] === o.id));
      b.tabIndex = state[key] === o.id ? 0 : -1;
      const s = D.createElement('span');
      s.textContent = o.label;
      b.append(s);
      b.addEventListener('click', () => { set({ [key]: o.id }); box.querySelector('[aria-checked="true"]')?.focus(); });
      box.append(b);
    }
  };
}
sw('device', 'Screen', DEVICES);
sw('call', 'Call', CALLS);
sw('view', 'View', VIEWS);
sw('sheet', 'Over it', SHEETS);
sw('kb', 'Keyboard', KBS);
sw('bar', 'Switcher', BARS);
sw('glyph', 'Round glyph', GLYPHS);
for (const [label, patch] of PRESETS) {
  const b = D.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-small';
  b.textContent = label;
  b.addEventListener('click', () => set(patch));
  presets.append(b);
}

const theme = () => ({ ph: 'theme', theme: D.documentElement.dataset.ppTheme || 'strong-coffee', mode: D.documentElement.dataset.themeMode || 'dark', light: D.documentElement.dataset.ppLight || '' });
function post(msg, only, list) { for (const f of list || frames) if (f.contentWindow && (!only || f === only)) f.contentWindow.postMessage(msg, '*'); }
function pushState(only) { post({ ph: 'state', state: { call: state.call, view: state.view, sheet: state.sheet, kb: state.kb === '1', module: state.module, ...(state.pins ? { pins: state.pins, replace: state.replace } : {}) } }, only); }

function device(dev, up, bar, caption) {
  const wrap = D.createElement('figure');
  wrap.className = 'phf-fig';
  const box = D.createElement('div');
  box.className = `phf-device${dev.land ? ' phf-land' : ''}${up ? ' phf-kb-up' : ''}`;
  box.style.setProperty('--phf-w', `${dev.w}px`);
  box.style.setProperty('--phf-h', `${dev.h}px`);
  box.style.setProperty('--phf-kb-h', `${dev.kb}px`);
  box.style.setProperty('--phf-screen-h', `${up ? dev.h - dev.kb : dev.h}px`);
  const frame = D.createElement('iframe');
  frame.className = 'phf-screen';
  frame.title = `The phone screen, ${dev.label}${caption ? `, ${caption}` : ''}`;
  const u = new URL('phone.html', location.href);
  const t = theme();
  u.searchParams.set('theme', t.theme); u.searchParams.set('mode', t.mode); if (t.light) u.searchParams.set('light', t.light);
  u.searchParams.set('view', state.view); u.searchParams.set('call', state.call); u.searchParams.set('sheet', state.sheet); u.searchParams.set('kb', state.kb);
  u.searchParams.set('bar', bar); u.searchParams.set('glyph', state.glyph);
  frame.src = u.href;
  box.append(frame);
  if (!dev.land) {
    const s = D.createElement('div');
    s.className = 'phf-status';
    s.setAttribute('aria-hidden', 'true');
    const time = D.createElement('span'); time.textContent = '9:41';
    const ic = D.createElement('span');
    for (const n of ['signal', 'wifi', 'battery-full']) { const i = D.createElement('i'); i.className = `fa-solid fa-${n}`; ic.append(i); }
    s.append(time, ic);
    box.append(s);
  }
  const home = D.createElement('div'); home.className = 'phf-home'; home.setAttribute('aria-hidden', 'true');
  box.append(home);
  if (up) {
    const kb = D.createElement('div');
    kb.className = 'phf-kb';
    kb.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < (dev.land ? 20 : 40); i += 1) kb.append(D.createElement('span'));
    box.append(kb);
  }
  wrap.append(box);
  if (caption) { const c = D.createElement('figcaption'); c.className = 'phf-caption'; c.textContent = caption; wrap.append(c); }
  frames.push(frame);
  return wrap;
}
function build() {
  const dev = DEVICES.find((d) => d.id === state.device);
  const up = state.kb === '1';
  stage.textContent = '';
  frames = [];
  const both = state.bar === 'both';
  const row = D.createElement('div');
  row.className = 'phf-row';
  if (both) row.append(device(dev, up, 'end', 'A: the switcher at the end'), device(dev, up, 'middle', 'B: the switcher in the middle'));
  else row.append(device(dev, up, state.bar, state.bar === 'end' ? 'A: the switcher at the end' : 'B: the switcher in the middle'));
  stage.append(row);
}
let built = '';
function set(patch) {
  Object.assign(state, patch);
  for (const f of Object.values(switches)) f();
  const key = `${state.device}|${state.kb}|${state.bar}|${state.glyph}`;
  if (key !== built) { built = key; build(); } else pushState();
  const u = new URL(location.href);
  for (const k of KEYS) u.searchParams.set(`ph${k}`, state[k]);
  history.replaceState(null, '', u);
}
addEventListener('message', (e) => {
  if (!e.data || !frames.some((f) => e.source === f.contentWindow)) return;
  if (e.data.ph === 'ready') { const f = frames.find((x) => x.contentWindow === e.source); post(theme(), f); pushState(f); }
  if (e.data.ph === 'set') {
    const p = {};
    for (const k of ['call', 'view', 'sheet', 'module', 'pins', 'replace']) if (k in e.data.patch) p[k] = e.data.patch[k]; // the pins follow into the other frame in Both
    Object.assign(state, p);
    for (const f of Object.values(switches)) f();
    const u = new URL(location.href); for (const k of ['call', 'view', 'sheet']) u.searchParams.set(`ph${k}`, state[k]); history.replaceState(null, '', u);
    const other = frames.filter((f) => f.contentWindow !== e.source);
    if (other.length) post({ ph: 'state', state: p }, null, other);
  }
});
new MutationObserver(() => post(theme())).observe(D.documentElement, { attributes: true, attributeFilter: ['data-theme-mode', 'data-pp-theme', 'data-pp-light'] });
set({});

// The page's jump list: the sections, so the Phone section is one tap from the top (the Planner has its own list for its parts).
const jump = D.createElement('nav');
jump.className = 'pp-jump';
jump.setAttribute('aria-label', 'Jump to a section of the page');
const lab = D.createElement('span'); lab.className = 'pp-jump-label'; lab.textContent = 'Sections';
jump.append(lab);
for (const [label, id] of [['Planner', 'pp-plan-icons'], ['Phone', 'pp-phone-name'], ['Title bar actions', 'pp-titlebar-actions']]) {
  const b = D.createElement('button');
  b.type = 'button'; b.className = 'btn btn-small'; b.textContent = label;
  b.addEventListener('click', () => D.getElementById(id)?.scrollIntoView({ block: 'start' }));
  jump.append(b);
}
main.prepend(jump);
