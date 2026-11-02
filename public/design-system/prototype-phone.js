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
const SHEETS = opts(['none', 'None'], ['modules', 'Modules'], ['object', 'Full sheet'], ['edit', 'Edit sheet'], ['actions', 'Bottom sheet'], ['bar', 'Action bar'], ['menu', 'Menu'], ['online', 'Online'], ['leave', 'Leave?']);
const KBS = opts(['0', 'Down'], ['1', 'Up']);
const PRESETS = [
  ['Not in a call, Chat', { call: 'off', view: 'chat', sheet: 'none', kb: '0' }],
  ['In a call, Planner', { call: 'on', view: 'module', sheet: 'none', kb: '0' }],
  ['Speaking, Chat', { call: 'speaking', view: 'chat', sheet: 'none', kb: '0' }],
  ['Muted, Planner', { call: 'muted', view: 'module', sheet: 'none', kb: '0' }],
  ['The call', { call: 'speaking', view: 'call', sheet: 'none', kb: '0' }],
  ['Modules list', { sheet: 'modules', kb: '0' }],
  ['Edit, keyboard up', { sheet: 'edit', kb: '1' }],
  ['Chat, keyboard up', { call: 'on', view: 'chat', sheet: 'none', kb: '1' }],
  ['Bottom sheet', { sheet: 'actions', kb: '0' }],
  ['Action bar', { call: 'on', sheet: 'bar', kb: '0' }],
];
const state = { device: '390', call: 'on', view: 'chat', sheet: 'none', kb: '0', module: 'planner' };
const q = new URLSearchParams(location.search);
for (const k of ['device', 'call', 'view', 'sheet', 'kb']) if (q.get(`ph${k}`)) state[k] = q.get(`ph${k}`);

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
note.textContent = 'The space on a phone as the plan decided it: the top bar (the space\'s name, Online, the menu with Leave), the view, a call strip above the fixed bottom bar (Call, Chat, the module in use, Modules). Sideways, the bar is a rail and the call, Chat and module use the width. The screen is a real viewport of the size chosen, so the product\'s own rules apply inside it. Pick a state below, or a preset.';
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
sec.append(h, note, tools, presets, stage, measure);
main.append(sec);

let frame = null;
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
for (const [label, patch] of PRESETS) {
  const b = D.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-small';
  b.textContent = label;
  b.addEventListener('click', () => set(patch));
  presets.append(b);
}

const theme = () => ({ ph: 'theme', theme: D.documentElement.dataset.ppTheme || 'strong-coffee', mode: D.documentElement.dataset.themeMode || 'dark', light: D.documentElement.dataset.ppLight || '' });
function post(msg) { if (frame && frame.contentWindow) frame.contentWindow.postMessage(msg, '*'); }
function pushState() { post({ ph: 'state', state: { call: state.call, view: state.view, sheet: state.sheet, kb: state.kb === '1', module: state.module } }); }

function build() {
  const dev = DEVICES.find((d) => d.id === state.device);
  const up = state.kb === '1';
  stage.textContent = '';
  const box = D.createElement('div');
  box.className = `phf-device${dev.land ? ' phf-land' : ''}${up ? ' phf-kb-up' : ''}`;
  box.style.setProperty('--phf-w', `${dev.w}px`);
  box.style.setProperty('--phf-h', `${dev.h}px`);
  box.style.setProperty('--phf-kb-h', `${dev.kb}px`);
  box.style.setProperty('--phf-screen-h', `${up ? dev.h - dev.kb : dev.h}px`);
  frame = D.createElement('iframe');
  frame.className = 'phf-screen';
  frame.title = `The phone screen, ${dev.label}`;
  const u = new URL('phone.html', location.href);
  const t = theme();
  u.searchParams.set('theme', t.theme); u.searchParams.set('mode', t.mode); if (t.light) u.searchParams.set('light', t.light);
  u.searchParams.set('view', state.view); u.searchParams.set('call', state.call); u.searchParams.set('sheet', state.sheet); u.searchParams.set('kb', state.kb);
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
  stage.append(box);
}
let built = '';
function set(patch) {
  Object.assign(state, patch);
  for (const f of Object.values(switches)) f();
  const key = `${state.device}|${state.kb}`;
  if (key !== built) { built = key; build(); } else pushState();
  const u = new URL(location.href);
  for (const k of ['device', 'call', 'view', 'sheet', 'kb']) u.searchParams.set(`ph${k}`, state[k]);
  history.replaceState(null, '', u);
}
addEventListener('message', (e) => {
  if (!frame || e.source !== frame.contentWindow || !e.data) return;
  if (e.data.ph === 'ready') { post(theme()); pushState(); }
  if (e.data.ph === 'set') { Object.assign(state, e.data.patch); for (const f of Object.values(switches)) f(); const u = new URL(location.href); for (const k of ['call', 'view', 'sheet']) u.searchParams.set(`ph${k}`, state[k]); history.replaceState(null, '', u); }
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
