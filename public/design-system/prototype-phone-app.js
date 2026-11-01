// The phone screen (phone.html), drawn inside the Prototype's phone frame (prototype-phone.js). Design-process only: nothing here ships
// (Thomas, 2026-11-01; plan-phone-experience.md, "Navigation on a phone"). Built from the SDK's own pieces: the tab bar (.sdk-tabbar), the
// module frame, the form standard (.sdk-form, .sdk-field), buttons, the menu's classes (.host-menu), avatars and badges. The module's content
// is the real Planner (prototype-planner.js), not drawn again.
import { createModuleFrame } from '/module-frame.js';
import { createPlanner, PLANNER_VIEWS } from './prototype-planner.js';

const D = document;
const root = D.getElementById('ph');
const q = new URLSearchParams(location.search);
const THEMES = ['strong-coffee', 'calming-teal', 'burnt-orange'];

const S = {
  view: ['call', 'chat', 'module'].includes(q.get('view')) ? q.get('view') : 'chat',
  call: ['off', 'on', 'speaking', 'muted'].includes(q.get('call')) ? q.get('call') : 'off',
  sheet: ['none', 'modules', 'object', 'edit', 'menu', 'actions', 'online', 'bar', 'leave'].includes(q.get('sheet')) ? q.get('sheet') : 'none',
  kb: q.get('kb') === '1',
  module: 'planner',
};
const MODULES = [
  { id: 'planner', name: 'Planner', icon: 'map-location-dot', unread: 0 },
  { id: 'places', name: 'Places', icon: 'location-dot', unread: 0 },
  { id: 'maps', name: 'Maps', icon: 'map', unread: 0 },
  { id: 'calendar', name: 'Calendar', icon: 'calendar', unread: 1 },
  { id: 'todo', name: 'To-do', icon: 'list-check', unread: 3 },
  { id: 'budget', name: 'Budget', icon: 'wallet', unread: 0 },
  { id: 'polls', name: 'Polls', icon: 'square-poll-vertical', unread: 1 },
  { id: 'research', name: 'Research', icon: 'magnifying-glass', unread: 0 },
];
const PEOPLE = [
  { name: 'Mia Alvarez', ini: 'MA', me: true }, { name: 'Sam Okafor', ini: 'SO' }, { name: 'Ana Costa', ini: 'AC' }, { name: 'Ben Hart', ini: 'BH' },
];

const el = (tag, cls, attrs = {}, kids = []) => {
  const e = D.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : String(v)); }
  e.append(...kids.filter(Boolean));
  return e;
};
const ico = (name, regular = false) => el('i', `fa-${regular ? 'regular' : 'solid'} fa-${name} fa-fw`, { 'aria-hidden': 'true' });
const iconBtn = (name, label, cls = '') => { const b = el('button', `sdk-icon-btn ${cls}`.trim(), { type: 'button', 'aria-label': label, title: label }); b.append(ico(name)); return b; };
const textBtn = (label, cls = '', icon = null) => { const b = el('button', `btn ${cls}`.trim(), { type: 'button' }); if (icon) b.append(ico(icon)); b.append(el('span', '', { text: label })); return b; };
const avatar = (p, size = 24) => el('span', `sdk-avatar sdk-avatar-${size}`, { 'aria-hidden': 'true' }, [el('span', 'sdk-avatar-ini', { text: p.ini })]);
const say = (patch) => { Object.assign(S, patch); draw(); parent.postMessage({ ph: 'set', patch }, '*'); };

// ---- theme and size ----
function theme(t) {
  if (t.theme && THEMES.includes(t.theme)) { D.getElementById('ph-theme-css').href = `themes/${t.theme}.css`; D.documentElement.dataset.ppTheme = t.theme; }
  if (t.mode) D.documentElement.dataset.themeMode = t.mode === 'light' ? 'light' : 'dark';
  if (t.light) D.documentElement.dataset.ppLight = t.light; else if ('light' in t) delete D.documentElement.dataset.ppLight;
  if (planner) planner.set({ mode: D.documentElement.dataset.themeMode });
}
// The compact shape. In the product it is: a coarse pointer when 640px or narrower, or sideways at 500px high or less (plan, Q1 and Q2);
// the pointer cannot be emulated in a frame, so here the size alone decides.
function shape() {
  const w = innerWidth;
  const land = w > innerHeight && innerHeight <= 500;
  D.documentElement.classList.toggle('ph-land', land);
  D.documentElement.classList.toggle('ph-compact', w <= 640 || land);
}
addEventListener('resize', shape);

// ---- the pieces ----
let planner = null;
let plannerHost = null;
let plannerFrame = null;

function topBar() {
  const online = el('button', 'ph-online', { type: 'button', 'aria-label': '3 people online. Show who is online' }, [ico('user-group'), el('span', '', { text: '3' })]);
  online.addEventListener('click', () => say({ sheet: 'online' }));
  const menu = iconBtn('ellipsis-vertical', 'Menu', 'btn-quiet');
  menu.setAttribute('aria-haspopup', 'menu');
  menu.setAttribute('aria-expanded', String(S.sheet === 'menu'));
  menu.addEventListener('click', () => say({ sheet: S.sheet === 'menu' ? 'none' : 'menu' }));
  return el('header', 'ph-top', {}, [
    el('h1', 'ph-space', { text: 'Lisbon in autumn' }), online, el('span', 'ph-grow'), menu,
  ]);
}

function callView() {
  if (S.call === 'off') {
    const join = textBtn('Join the call', 'btn-primary', 'phone');
    join.addEventListener('click', () => say({ call: 'on' }));
    return el('section', 'ph-call', { 'aria-label': 'Call' }, [el('div', 'sdk-empty', {}, [ico('video'), el('p', 'sdk-empty-title', { text: 'You are not in the call' }), el('p', 'sdk-empty-text', { text: '3 people are in it.' }), el('div', 'sdk-empty-actions', {}, [join])])]);
  }
  const tiles = el('div', 'ph-tiles');
  PEOPLE.forEach((p, i) => {
    const speaking = (S.call === 'speaking' && i === 1);
    const muted = (p.me && S.call === 'muted') || i === 3;
    tiles.append(el('div', `ph-tile${speaking ? ' is-speaking' : ''}`, { 'aria-label': `${p.name}${speaking ? ', talking' : ''}${muted ? ', muted' : ''}` }, [
      avatar(p, 64),
      el('span', 'ph-tile-name', {}, [muted ? ico('microphone-slash') : null, el('span', '', { text: p.me ? 'You' : p.name })]),
    ]));
  });
  const mic = iconBtn(S.call === 'muted' ? 'microphone-slash' : 'microphone', S.call === 'muted' ? 'Unmute' : 'Mute', S.call === 'muted' ? 'btn-danger' : '');
  mic.addEventListener('click', () => say({ call: S.call === 'muted' ? 'on' : 'muted' }));
  const cam = iconBtn('video', 'Turn the camera off');
  const spk = iconBtn('volume-high', 'Speaker');
  const end = iconBtn('phone-slash', 'Hang up', 'btn-danger solid');
  end.addEventListener('click', () => say({ call: 'off' }));
  return el('section', 'ph-call', { 'aria-label': 'Call' }, [tiles, el('div', 'ph-controls', {}, [mic, cam, spk, end])]);
}

const MESSAGES = [
  ['Ana Costa', 'AC', '8:11', 'The second day suits the old town. Start with the Tile Museum.'],
  ['Sam Okafor', 'SO', '8:30', 'That sounds good. I will add it to the plan.'],
  ['Ben Hart', 'BH', '8:41', 'Lunch at Cervejaria Ramiro? Book ahead if you can.'],
  ['Mia Alvarez', 'MA', '8:52', 'Booking it now. Table for four at one.'],
];
function chatView() {
  const list = el('div', 'ph-msgs', { role: 'log', 'aria-label': 'Messages' });
  for (const [name, ini, time, text] of MESSAGES) {
    list.append(el('article', 'ph-msg', {}, [avatar({ ini }), el('div', 'ph-msg-main', {}, [el('div', 'ph-msg-head', {}, [el('strong', '', { text: name }), el('span', 'ph-muted', { text: time })]), el('p', 'ph-msg-text', { text })])]));
  }
  const field = el('textarea', 'ph-compose-field', { rows: 1, placeholder: 'Send a message', 'aria-label': 'Message', enterkeyhint: 'send', autocapitalize: 'sentences' });
  const send = el('button', 'btn btn-primary ph-send', { type: 'button', 'aria-label': 'Send' }, [ico('paper-plane'), el('span', '', { text: 'Send' })]);
  send.addEventListener('click', () => { field.value = ''; field.focus(); });
  return el('section', 'ph-chat', { 'aria-label': 'Chat' }, [list, el('div', 'ph-compose', {}, [field, send])]);
}

function moduleView() {
  const m = MODULES.find((x) => x.id === S.module);
  if (m.id !== 'planner') {
    return el('section', 'ph-module', { 'aria-label': m.name }, [el('div', 'sdk-empty', {}, [ico(m.icon), el('p', 'sdk-empty-title', { text: m.name }), el('p', 'sdk-empty-text', { text: 'Its content is not drawn here. Pick Planner in the Modules list to see a real module.' })])]);
  }
  if (!planner) {
    plannerHost = el('div', 'pp-planner');
    planner = createPlanner(plannerHost);
    planner.set({ mode: D.documentElement.dataset.themeMode });
    const bar = (view) => [{ type: 'switch', id: 'view', label: 'View', value: view, options: PLANNER_VIEWS }];
    plannerFrame = createModuleFrame({
      title: 'Planner', icon: 'map-location-dot', bands: { titlebar: false, status: false },
      toolbar: bar('days'), content: plannerHost, flush: true,
      onAction: (e) => { if (e.area === 'toolbar' && e.id === 'view') planner.setView(e.value); },
    });
    planner.onView = (id) => plannerFrame.setToolbar(bar(id));
  }
  return el('section', 'ph-module', { 'aria-label': 'Planner' }, [plannerFrame.el]);
}

function strip() {
  const talking = S.call === 'speaking';
  const muted = S.call === 'muted';
  const who = el('button', 'ph-strip-who', { type: 'button', 'aria-label': 'Show the call' }, [
    talking ? avatar(PEOPLE[1], 24) : ico(muted ? 'microphone-slash' : 'phone'),
    el('span', 'ph-strip-words', {}, [el('strong', '', { text: talking ? 'Sam Okafor' : 'In the call' }), el('span', 'ph-muted', { text: talking ? 'is talking' : muted ? 'you are muted' : '00:04' })]),
  ]);
  who.addEventListener('click', () => say({ view: 'call' }));
  const mic = iconBtn(muted ? 'microphone-slash' : 'microphone', muted ? 'Unmute' : 'Mute', muted ? 'btn-danger' : '');
  mic.addEventListener('click', () => say({ call: muted ? 'on' : 'muted' }));
  const end = iconBtn('phone-slash', 'Hang up', 'btn-danger solid');
  end.addEventListener('click', () => say({ call: 'off' }));
  return el('div', `ph-strip${talking ? ' is-speaking' : ''}${muted ? ' is-muted' : ''}`, { role: 'group', 'aria-label': 'The call' }, [who, mic, end]);
}

function bottomBar() {
  const m = MODULES.find((x) => x.id === S.module);
  const inCall = S.call !== 'off';
  const tab = (id, icon, label, { current = false, count = 0, extra = '' } = {}) => {
    const b = el('button', `sdk-tabbar-tab${extra ? ` ${extra}` : ''}`, { type: 'button', 'aria-current': current ? 'page' : false, 'data-tab': id });
    const glyph = el('span', 'sdk-tabbar-glyph', {}, [ico(icon), count ? el('span', 'sdk-badge-micro', { 'aria-hidden': 'true', text: String(count) }) : null]);
    b.append(glyph, el('span', 'sdk-tabbar-label', { text: label }));
    return b;
  };
  const call = tab('call', 'phone', inCall ? 'Call' : 'Join', { current: S.view === 'call' && S.sheet !== 'modules', extra: inCall ? 'in-call' : '' });
  if (!inCall) call.dataset.role = 'join';
  if (S.call === 'on' || S.call === 'speaking') call.dataset.mic = 'live';
  const chat = tab('chat', 'comments', 'Chat', { current: S.view === 'chat', count: 2 });
  const mod = tab('module', m.icon, m.name, { current: S.view === 'module' });
  const more = tab('modules', 'table-cells-large', 'Modules');
  call.addEventListener('click', () => (inCall || S.view === 'call' ? say({ view: 'call' }) : say({ view: 'call' })));
  chat.addEventListener('click', () => say({ view: 'chat' }));
  mod.addEventListener('click', () => say({ view: 'module' }));
  more.addEventListener('click', () => say({ sheet: 'modules' }));
  return el('nav', 'sdk-tabbar ph-bar', { 'aria-label': 'Views' }, [call, chat, mod, more]);
}

// ---- sheets ----
function sheetShell(title, left, right, body) {
  const bar = el('header', 'ph-sheet-bar', {}, [left, el('h2', 'ph-sheet-title', { text: title }), right]);
  const sec = el('section', 'ph-sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [bar, el('div', 'ph-sheet-body', {}, [body])]);
  return sec;
}
const closeSheet = () => say({ sheet: 'none' });

function modulesSheet() {
  const close = iconBtn('xmark', 'Close', 'btn-quiet');
  close.addEventListener('click', closeSheet);
  const list = el('ul', 'ph-list');
  for (const m of MODULES) {
    const b = el('button', 'ph-row', { type: 'button', 'aria-current': m.id === S.module ? 'true' : false }, [
      el('span', 'ph-row-icon', {}, [ico(m.icon)]), el('span', 'ph-row-name', { text: m.name }),
      m.unread ? el('span', 'sdk-badge', { text: String(m.unread), 'aria-label': `${m.unread} new` }) : null,
      m.id === S.module ? ico('check') : ico('chevron-right'),
    ]);
    b.addEventListener('click', () => say({ module: m.id, view: 'module', sheet: 'none' }));
    list.append(el('li', '', {}, [b]));
  }
  return sheetShell('Modules', close, el('span', 'ph-bar-end'), list);
}

function objectSheet() {
  const back = iconBtn('chevron-left', 'Back', 'btn-quiet');
  back.addEventListener('click', closeSheet);
  const more = iconBtn('ellipsis-vertical', 'More', 'btn-quiet');
  more.addEventListener('click', () => say({ sheet: 'actions' }));
  const edit = textBtn('Edit', '', 'pen');
  edit.addEventListener('click', () => say({ sheet: 'edit' }));
  const dl = el('dl', 'ph-facts', {}, [
    el('dt', '', { text: 'Day' }), el('dd', '', { text: 'Mon 26 Oct' }),
    el('dt', '', { text: 'Time' }), el('dd', '', { text: '10:00 to 12:00' }),
    el('dt', '', { text: 'Where' }), el('dd', '', { text: 'Museu Nacional do Azulejo' }),
    el('dt', '', { text: 'Cost' }), el('dd', '', { text: '$24.00' }),
    el('dt', '', { text: 'Notes' }), el('dd', '', { text: 'Book ahead. The tile workshop is on the first floor.' }),
  ]);
  return sheetShell('Tile Museum', back, more, el('div', 'ph-stack', {}, [dl, edit]));
}

function editSheet() {
  const cancel = textBtn('Cancel', 'btn-quiet');
  cancel.addEventListener('click', closeSheet);
  const save = textBtn('Save', 'btn-primary');
  save.addEventListener('click', closeSheet);
  const f = (label, control, hint) => el('label', 'sdk-field', {}, [el('span', 'sdk-label', { text: label }), control, hint ? el('span', 'sdk-hint', { text: hint }) : null]);
  const name = el('input', '', { type: 'text', value: 'Tile Museum', autocomplete: 'off', enterkeyhint: 'next' });
  name.id = 'ph-edit-name';
  const form = el('form', 'sdk-form', { novalidate: true }, [
    f('Name', name),
    f('Day', el('input', '', { type: 'date', value: '2026-10-26' })),
    f('Starts', el('input', '', { type: 'time', value: '10:00' })),
    f('Ends (optional)', el('input', '', { type: 'time', value: '12:00' })),
    f('Cost (optional)', el('input', '', { type: 'text', inputmode: 'decimal', value: '24.00', enterkeyhint: 'next' })),
    f('Where (optional)', el('input', '', { type: 'text', value: 'Museu Nacional do Azulejo', enterkeyhint: 'next' })),
    f('Notes (optional)', el('textarea', '', { rows: 4 }), 'Only your space sees this.'),
  ]);
  form.addEventListener('submit', (e) => e.preventDefault());
  return sheetShell('Edit a stop', cancel, save, form);
}

// The bottom sheet: a menu of actions in 44px+ rows.
function actionsSheet(title = 'Tile Museum', rows = null) {
  const scrim = el('div', 'ph-scrim'); scrim.addEventListener('click', closeSheet);
  rows = rows || [
    { icon: 'pen', label: 'Edit' }, { icon: 'clock', label: '30 minutes earlier' }, { icon: 'clock', label: '30 minutes later' },
    { icon: 'calendar-day', label: 'Move to another day' }, { icon: 'share-nodes', label: 'Share' }, { divider: true }, { icon: 'trash', label: 'Delete', danger: true },
  ];
  const list = el('div', 'ph-actions', { role: 'menu', 'aria-label': title });
  for (const r of rows) {
    if (r.divider) { list.append(el('div', 'ph-actions-line', { role: 'separator' })); continue; }
    const b = el('button', `ph-action${r.danger ? ' danger' : ''}`, { type: 'button', role: 'menuitem' }, [ico(r.icon), el('span', '', { text: r.label })]);
    b.addEventListener('click', closeSheet);
    list.append(b);
  }
  const cancel = textBtn('Cancel', 'ph-action-cancel'); cancel.addEventListener('click', closeSheet);
  return el('div', 'ph-sheet-layer', {}, [scrim, el('section', 'ph-bottom', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Actions' }, [el('h2', 'ph-bottom-title', { text: title }), list, cancel])]);
}

function leaveSheet() {
  const scrim = el('div', 'ph-scrim'); scrim.addEventListener('click', closeSheet);
  const stay = textBtn('Stay', ''); stay.addEventListener('click', closeSheet);
  const leave = textBtn('Leave', 'btn-danger solid'); leave.addEventListener('click', () => say({ sheet: 'none', call: 'off' }));
  return el('div', 'ph-sheet-layer', {}, [scrim, el('section', 'ph-bottom', { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Leave the call?' }, [
    el('h2', 'ph-bottom-title', { text: 'Leave the call?' }), el('p', 'ph-bottom-text', { text: 'You will leave the space and the call.' }), el('div', 'ph-bottom-foot', {}, [stay, leave])])]);
}

// The top bar's menu: the host's menu classes, held under the button.
function menuPop() {
  const scrim = el('div', 'ph-scrim ph-scrim-clear'); scrim.addEventListener('click', closeSheet);
  const items = [{ icon: 'share-nodes', label: 'Share' }, { divider: true }, { icon: 'right-from-bracket', label: 'Leave', danger: true }];
  const menu = el('div', 'host-menu ph-menu', { role: 'menu' });
  for (const it of items) {
    if (it.divider) { menu.append(el('div', 'host-menu-divider')); continue; }
    const b = el('button', `host-menu-item${it.danger ? ' danger' : ''}`, { type: 'button', role: 'menuitem' }, [ico(it.icon), el('span', 'host-menu-label', { text: it.label })]);
    b.addEventListener('click', () => { if (it.label === 'Leave' && S.call !== 'off') say({ sheet: 'leave' }); else closeSheet(); });
    menu.append(b);
  }
  return el('div', 'ph-sheet-layer ph-menu-layer', {}, [scrim, menu]);
}

function actionBar() {
  const add = textBtn('Add a stop', 'btn-primary', 'plus');
  add.addEventListener('click', () => say({ sheet: 'edit' }));
  return el('div', 'ph-actionbar', {}, [add]);
}

// ---- the screen ----
function draw() {
  const keep = { chat: root.querySelector('.ph-compose-field')?.value };
  root.className = `ph${S.kb ? ' kb' : ''}${S.call !== 'off' ? ' in-call' : ''}`;
  if (S.sheet === 'bar') S.view = 'module';
  const view = el('main', 'ph-view', {}, [S.view === 'call' ? callView() : S.view === 'chat' ? chatView() : moduleView()]);
  if (S.sheet === 'bar') view.append(actionBar());
  const layers = [];
  if (S.sheet === 'modules') layers.push(modulesSheet());
  if (S.sheet === 'object') layers.push(objectSheet());
  if (S.sheet === 'edit') layers.push(editSheet());
  if (S.sheet === 'actions') layers.push(actionsSheet());
  if (S.sheet === 'online') layers.push(actionsSheet('Online', [...PEOPLE.slice(0, 3).map((p) => ({ icon: 'circle-user', label: p.me ? `${p.name} (you)` : p.name })), { divider: true }, { icon: 'user-plus', label: 'Invite someone' }]));
  if (S.sheet === 'leave') layers.push(leaveSheet());
  if (S.sheet === 'menu') layers.push(menuPop());
  // The module's own view moves the planner's frame out of the old view: keep it by re-parenting through append.
  root.replaceChildren(topBar(), view, S.call !== 'off' && S.view !== 'call' ? strip() : el('span', 'ph-none'), bottomBar(), ...layers);
  if (keep.chat) { const f = root.querySelector('.ph-compose-field'); if (f) f.value = keep.chat; }
  if (S.kb) {
    const f = S.sheet === 'edit' ? D.getElementById('ph-edit-name') : S.view === 'chat' && S.sheet === 'none' ? root.querySelector('.ph-compose-field') : null;
    if (f) { f.focus({ preventScroll: true }); f.scrollIntoView({ block: 'nearest' }); }
  }
  if (S.sheet !== 'none' && S.sheet !== 'bar' && !S.kb) root.querySelector('.ph-sheet :is(button), .ph-bottom button, .ph-menu button')?.focus({ preventScroll: true });
}

D.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.sheet !== 'none') say({ sheet: 'none' }); });
addEventListener('message', (e) => {
  const d = e.data;
  if (!d || typeof d !== 'object') return;
  if (d.ph === 'theme') theme(d);
  if (d.ph === 'state') { Object.assign(S, d.state); draw(); shape(); }
});
theme({ theme: q.get('theme'), mode: q.get('mode'), light: q.get('light') });
shape();
draw();
parent.postMessage({ ph: 'ready' }, '*');
