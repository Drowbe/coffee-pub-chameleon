// The phone screen (phone.html), drawn inside the Prototype's phone frame (prototype-phone.js). Design-process only: nothing here ships
// (Thomas, 2026-11-01; plan-phone-experience.md, "Navigation on a phone"). Built from the SDK's own pieces: the tab bar (.sdk-tabbar), the
// module frame (the bottom bar is the tab bar with the call out of it, 2026-11-03: four places of the person's own and a switcher, More), the form standard (.sdk-form, .sdk-field), buttons, the menu's classes (.host-menu), avatars and badges. The module's content
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
  sheet: ['none', 'more', 'pin', 'replace', 'states', 'object', 'edit', 'menu', 'actions', 'online', 'bar', 'leave'].includes(q.get('sheet')) ? q.get('sheet') : 'none',
  bar: q.get('bar') === 'middle' ? 'middle' : 'end', // where the switcher sits: A at the end, B in the middle
  glyph: q.get('glyph') === 'dots' ? 'dots' : 'lines', // B's glyph
  pins: ['chat', 'planner', 'calendar', 'maps'], // this person's four (the template's to start: travel)
  replace: { slot: 3 }, // what the Replace sheet is for: { slot } puts a module in a place, { mod } asks which place it takes
  kb: q.get('kb') === '1',
  module: 'planner',
};
const TEMPLATE_PINS = ['chat', 'planner', 'calendar', 'maps']; // travel's four (the template's default)
const CHAT = { id: 'chat', name: 'Chat', icon: 'comments', unread: 2 };
const MODULES = [
  { id: 'planner', name: 'Planner', icon: 'map-location-dot', unread: 0 },
  { id: 'places', name: 'Places', icon: 'location-dot', unread: 0 },
  { id: 'maps', name: 'Map', icon: 'map', unread: 0 },
  { id: 'calendar', name: 'Calendar', icon: 'calendar', unread: 1 },
  { id: 'todo', name: 'To-do', icon: 'list-check', unread: 3 },
  { id: 'budget', name: 'Budget', icon: 'wallet', unread: 0 },
  { id: 'polls', name: 'Polls', icon: 'square-poll-vertical', unread: 1 },
  { id: 'research', name: 'Research', icon: 'magnifying-glass', unread: 0 },
];
const DEST = [CHAT, ...MODULES]; // every place the bar can hold
const dest = (id) => DEST.find((d) => d.id === id);
const PEOPLE = [
  { name: 'Mia Alvarez', ini: 'MA', me: true }, { name: 'Sam Okafor', ini: 'SO' }, { name: 'Ana Costa', ini: 'AC' },
]; // the three online in the space (the Online badge, the Online list, and the call when you are in it); Ben Hart is away
const ONLINE = PEOPLE.length;
const CALL_TIME = '4:12';

const el = (tag, cls, attrs = {}, kids = []) => {
  const e = D.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : String(v)); }
  e.append(...kids.filter(Boolean));
  return e;
};
const ico = (name, regular = false) => el('i', `fa-${regular ? 'regular' : 'solid'} fa-${name} fa-fw`, { 'aria-hidden': 'true' });
const iconBtn = (name, label, cls = '', key = null) => { const b = el('button', `sdk-icon-btn ${cls}`.trim(), { type: 'button', 'aria-label': label, title: label, 'data-key': key }); b.append(ico(name)); return b; };
const textBtn = (label, cls = '', icon = null, key = null) => { const b = el('button', `btn ${cls}`.trim(), { type: 'button', 'data-key': key }); if (icon) b.append(ico(icon)); b.append(el('span', '', { text: label })); return b; };
const avatar = (p, size = 24) => el('span', `sdk-avatar sdk-avatar-${size}`, { 'aria-hidden': 'true' }, [el('span', 'sdk-avatar-ini', { text: p.ini })]);
// Focus. A sheet is a level (More 1, Edit the four 2, Replace 3; every other sheet or dialog 1). Opening a level remembers the control that opened it;
// leaving it (Esc, Close, Stay, a tap on a place) puts the focus back on that control, so the keyboard never falls to the page.
const LEVEL = { none: 0, more: 1, pin: 2, replace: 3 };
const level = (s) => (s in LEVEL ? LEVEL[s] : 1);
const BACK = { replace: 'pin', pin: 'more' }; // Esc steps back one level; any other sheet closes
const openers = []; // openers[n]: the key of the control that opened level n + 1
let trigger = null; // the control last pressed
let drawn = 'none'; // the sheet the last draw showed
const keyOf = (e) => (e ? e.dataset.key || (e.dataset.tab && `tab:${e.dataset.tab}`) || e.getAttribute('aria-label') || null : null);
const find = (key) => (key ? [...root.querySelectorAll('button, input, textarea, [tabindex]')].find((e) => keyOf(e) === key && !e.closest('[inert]')) : null);
D.addEventListener('click', (e) => { trigger = e.target.closest ? e.target.closest('button') : null; }, true);
const say = (patch) => {
  if ('sheet' in patch && patch.sheet !== S.sheet) {
    const from = level(S.sheet); const to = level(patch.sheet);
    const t = trigger && root.contains(trigger) ? trigger : D.activeElement;
    if (to > from) openers[from] = keyOf(t) || openers[from];
  }
  Object.assign(S, patch);
  draw();
  parent.postMessage({ ph: 'set', patch }, '*');
};

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

function callButton() {
  const inCall = S.call !== 'off';
  if (!inCall) {
    const b = el('button', 'btn btn-primary ph-callbtn is-join', { type: 'button', 'aria-label': 'Join the call', 'data-key': 'call' }, [ico('phone'), el('span', '', { text: 'Join' })]);
    b.addEventListener('click', () => say({ call: 'on', view: 'call' }));
    return b;
  }
  const b = el('button', `btn ph-callbtn is-live${S.call === 'muted' ? ' is-muted' : ''}`, { type: 'button', 'aria-label': `In the call, 4 minutes${S.call === 'muted' ? ', you are muted' : ''}. Show the call`, 'aria-pressed': String(S.view === 'call'), 'data-key': 'call' }, [
    el('span', 'ph-dot', { 'aria-hidden': 'true' }), ico('phone'), el('span', 'ph-time', { 'aria-hidden': 'true', text: CALL_TIME }),
  ]);
  b.addEventListener('click', () => say({ view: 'call' }));
  return b;
}

function topBar() {
  const online = el('button', 'ph-online', { type: 'button', 'aria-label': `${ONLINE} people online. Show who is online`, 'data-key': 'online' }, [ico('user-group'), el('span', '', { text: String(ONLINE) })]);
  online.addEventListener('click', () => say({ sheet: 'online' }));
  const menu = iconBtn('ellipsis-vertical', 'Menu', 'btn-quiet', 'menu');
  menu.setAttribute('aria-haspopup', 'menu');
  menu.setAttribute('aria-expanded', String(S.sheet === 'menu'));
  menu.addEventListener('click', () => say({ sheet: S.sheet === 'menu' ? 'none' : 'menu' }));
  return el('header', 'ph-top', {}, [
    el('h1', 'ph-space', { text: 'Lisbon in autumn', title: 'Lisbon in autumn' }), online, el('span', 'ph-grow'), callButton(), menu,
  ]);
}

// The microphone: muted is the quiet state (a slashed icon on the selected fill); red belongs to Hang up alone, so two red buttons never sit together.
function micBtn(muted, key) {
  const b = iconBtn(muted ? 'microphone-slash' : 'microphone', muted ? 'Unmute' : 'Mute', muted ? 'ph-mic-off' : '', key);
  b.setAttribute('aria-pressed', String(muted));
  return b;
}

function callView() {
  if (S.call === 'off') {
    const join = textBtn('Join the call', 'btn-primary', 'phone', 'join');
    join.addEventListener('click', () => say({ call: 'on' }));
    return el('section', 'ph-call', { 'aria-label': 'Call' }, [el('div', 'sdk-empty', {}, [ico('video'), el('p', 'sdk-empty-title', { text: 'You are not in the call' }), el('p', 'sdk-empty-text', { text: `${ONLINE - 1} people are in it.` }), el('div', 'sdk-empty-actions', {}, [join])])]);
  }
  const tiles = el('div', 'ph-tiles');
  PEOPLE.forEach((p, i) => {
    const speaking = (S.call === 'speaking' && i === 1);
    const muted = (p.me && S.call === 'muted') || i === 2;
    tiles.append(el('div', `ph-tile${speaking ? ' is-speaking' : ''}`, { 'aria-label': `${p.name}${speaking ? ', talking' : ''}${muted ? ', muted' : ''}` }, [
      avatar(p, 64),
      el('span', 'ph-tile-name', {}, [muted ? ico('microphone-slash') : null, el('span', '', { text: p.me ? 'You' : p.name })]),
    ]));
  });
  const mic = micBtn(S.call === 'muted', 'call-mic');
  mic.addEventListener('click', () => say({ call: S.call === 'muted' ? 'on' : 'muted' }));
  const cam = iconBtn('video', 'Turn the camera off', '', 'call-cam');
  const spk = iconBtn('volume-high', 'Speaker', '', 'call-speaker');
  const end = iconBtn('phone-slash', 'Hang up', 'btn-danger solid', 'call-end');
  end.addEventListener('click', () => say({ call: 'off' }));
  const head = el('p', 'ph-call-head', {}, [el('strong', '', { text: `${ONLINE} people in the call` }), el('span', 'ph-muted', { text: CALL_TIME })]);
  return el('section', 'ph-call', { 'aria-label': 'Call' }, [head, tiles, el('div', 'ph-controls', {}, [mic, cam, spk, end])]);
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
  const who = el('button', 'ph-strip-who', { type: 'button', 'aria-label': 'Show the call', 'data-key': 'strip-who' }, [
    talking ? avatar(PEOPLE[1], 24) : ico(muted ? 'microphone-slash' : 'phone'),
    el('span', 'ph-strip-words', {}, [el('strong', '', { text: talking ? 'Sam Okafor' : 'In the call' }), el('span', 'ph-muted', { text: talking ? 'is talking' : muted ? 'you are muted' : '' }), el('span', 'ph-muted ph-strip-time', { text: CALL_TIME })]),
  ]);
  who.addEventListener('click', () => say({ view: 'call' }));
  const mic = micBtn(muted, 'strip-mic');
  mic.addEventListener('click', () => say({ call: muted ? 'on' : 'muted' }));
  const end = iconBtn('phone-slash', 'Hang up', 'btn-danger solid', 'strip-end');
  end.addEventListener('click', () => say({ call: 'off' }));
  return el('div', `ph-strip${talking ? ' is-speaking' : ''}${muted ? ' is-muted' : ''}`, { role: 'group', 'aria-label': 'The call' }, [who, mic, end]);
}

// The bottom bar: four places of the person's own and the switcher (More). The call is never a place in it (the top bar's phone opens it).
// `o` forces a look for the Bar states drawing: o.pressed / o.focus name a place (or 'more'), o.here the place that is open, o.counts a count by place.
function bottomBar(o = {}) {
  const here = o.here !== undefined ? o.here : S.view === 'chat' ? 'chat' : S.view === 'module' ? S.module : null;
  const pins = o.pins || S.pins;
  const kind = o.bar || S.bar;
  const count = (d) => (o.counts && d.id in o.counts ? o.counts[d.id] : here === d.id ? 0 : d.unread); // the place that is open has nothing new
  const badge = (n) => (n ? el('span', 'sdk-badge-micro', { 'aria-hidden': 'true', text: n > 9 ? '9+' : String(n) }) : null);
  const word = (n) => (n ? `, ${n} new` : '');
  const look = (id) => `${o.pressed === id ? ' is-pressed' : ''}${o.focus === id ? ' is-focus' : ''}`;
  const place = (d) => {
    const n = count(d);
    const b = el('button', `sdk-tabbar-tab${look(d.id)}`, { type: 'button', 'aria-current': here === d.id ? 'page' : false, 'data-tab': d.id, 'aria-label': `${d.name}${word(n)}` });
    b.append(el('span', 'sdk-tabbar-glyph', {}, [ico(d.icon), badge(n)]), el('span', 'sdk-tabbar-label', { text: d.name }));
    b.addEventListener('click', () => (d.id === 'chat' ? say({ view: 'chat', sheet: 'none' }) : say({ module: d.id, view: 'module', sheet: 'none' })));
    return b;
  };
  const places = pins.map((id) => place(dest(id)));
  const rest = DEST.filter((d) => !pins.includes(d.id));
  const restNew = rest.reduce((n, d) => n + count(d), 0);
  const offBar = here !== null && !pins.includes(here); // the open place is not one of the four: the switcher shows where you are
  let more;
  if (kind === 'middle') {
    more = el('button', `ph-round${look('more')}`, { type: 'button', 'aria-label': `More${word(restNew)}`, 'aria-current': offBar ? 'page' : false, 'data-tab': 'more' });
    more.append(el('span', 'ph-round-disc', {}, [ico(S.glyph === 'lines' ? 'bars' : 'ellipsis'), badge(restNew)]));
    places.splice(2, 0, more);
  } else {
    more = el('button', `sdk-tabbar-tab${look('more')}`, { type: 'button', 'aria-current': offBar ? 'page' : false, 'data-tab': 'more', 'aria-label': `More${word(restNew)}` });
    more.append(el('span', 'sdk-tabbar-glyph', {}, [ico('bars'), badge(restNew)]), el('span', 'sdk-tabbar-label', { text: 'More' }));
    places.push(more);
  }
  more.addEventListener('click', () => say({ sheet: 'more' }));
  return el(o.plain ? 'div' : 'nav', `sdk-tabbar ph-bar${kind === 'middle' ? ' ph-bar-middle' : ''}${o.safe ? ' ph-safe-demo' : ''}`, o.plain ? {} : { 'aria-label': 'Places' }, places);
}

// ---- sheets ----
function sheetShell(title, left, right, body) {
  const bar = el('header', 'ph-sheet-bar', {}, [left, el('h2', 'ph-sheet-title', { text: title }), right]);
  const sec = el('section', 'ph-sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [bar, el('div', 'ph-sheet-body', {}, [body])]);
  return sec;
}
const closeSheet = () => say({ sheet: 'none' });

// More: the places that are not in the bar, big rows with their new counts. Edit is the way to pin one (the title bar's button and a row here).
const openId = () => (S.view === 'chat' ? 'chat' : S.view === 'module' ? S.module : null);
function row(d, tail) {
  const n = openId() === d.id ? 0 : d.unread;
  return [el('span', 'ph-row-icon', {}, [ico(d.icon)]), el('span', 'ph-row-name', { text: d.name }), n ? el('span', 'sdk-badge', { text: String(n), 'aria-label': `${n} new` }) : null, ...tail];
}
function moreSheet() {
  const edit = S.sheet === 'pin' || S.sheet === 'replace';
  const close = iconBtn('xmark', 'Close', 'btn-quiet', 'close');
  close.addEventListener('click', closeSheet);
  const toggle = edit ? textBtn('Done', 'btn-primary', null, 'toggle') : textBtn('Edit the four', 'btn-quiet', 'thumbtack', 'toggle');
  toggle.addEventListener('click', () => say({ sheet: edit ? 'more' : 'pin' }));
  const body = el('div', 'ph-more');
  if (!edit) {
    const rest = DEST.filter((d) => !S.pins.includes(d.id));
    const list = el('ul', 'ph-list');
    for (const d of rest) {
      const b = el('button', 'ph-row', { type: 'button', 'data-key': `row-${d.id}` }, row(d, [ico('chevron-right')]));
      b.addEventListener('click', () => say(d.id === 'chat' ? { view: 'chat', sheet: 'none' } : { module: d.id, view: 'module', sheet: 'none' }));
      list.append(el('li', '', {}, [b]));
    }
    const pin = el('button', 'ph-row ph-row-quiet', { type: 'button', 'data-key': 'edit-row' }, [el('span', 'ph-row-icon', {}, [ico('thumbtack')]), el('span', 'ph-row-name', { text: 'Edit the four' }), ico('chevron-right')]);
    pin.addEventListener('click', () => say({ sheet: 'pin' }));
    body.append(el('p', 'ph-more-hint', { text: rest.length ? 'The other places in this space.' : 'Every place is in your bar.' }), list, el('ul', 'ph-list', {}, [el('li', '', {}, [pin])]));
    return sheetShell('More', close, toggle, body);
  }
  // Edit the four: the four in the bar's order first, each a tap to replace; then the others with a Pin button (the menu route; nothing to drag).
  const slots = el('div', 'ph-slots', { role: 'group', 'aria-label': 'Your four places' });
  S.pins.forEach((id, i) => {
    const d = dest(id);
    const b = el('button', 'ph-slot', { type: 'button', 'aria-label': `Place ${i + 1}, ${d.name}. Change it`, 'data-key': `slot-${i}` }, [el('span', 'ph-slot-n', { text: String(i + 1), 'aria-hidden': 'true' }), ico(d.icon), el('span', 'ph-slot-name', { text: d.name }), el('span', 'ph-slot-change', { 'aria-hidden': 'true' }, [ico('arrows-rotate')])]);
    b.addEventListener('click', () => say({ sheet: 'replace', replace: { slot: i } }));
    slots.append(b);
  });
  const reset = textBtn('Use the space\'s four', 'btn-quiet', 'rotate-left');
  reset.disabled = S.pins.join() === TEMPLATE_PINS.join();
  reset.addEventListener('click', () => say({ pins: [...TEMPLATE_PINS] }));
  const list = el('ul', 'ph-list');
  for (const d of [...S.pins.map(dest), ...DEST.filter((x) => !S.pins.includes(x.id))]) { // the four in the bar's order, then the rest
    const at = S.pins.indexOf(d.id);
    let tail;
    if (at >= 0) tail = [el('span', 'ph-row-tag', { text: `Place ${at + 1}` })];
    else {
      const pin = el('button', 'btn ph-pin', { type: 'button', 'aria-label': `Pin ${d.name}`, 'data-key': `pin-${d.id}` }, [ico('thumbtack'), el('span', '', { text: 'Pin' })]);
      pin.addEventListener('click', () => say({ sheet: 'replace', replace: { mod: d.id } }));
      tail = [pin];
    }
    list.append(el('li', `ph-row ph-row-static${at >= 0 ? ' is-pinned' : ''}`, {}, row(d, tail)));
  }
  body.append(
    el('h3', 'ph-more-head', { text: 'Your four, in the bar\'s order' }), el('p', 'ph-more-hint', { text: 'Tap a place to change what it holds. The bar always holds four.' }), slots, el('div', 'ph-more-foot', {}, [reset]),
    el('h3', 'ph-more-head', { text: 'All places' }), list,
  );
  return sheetShell('Edit the four', close, toggle, body);
}

// The Replace sheet (a bottom sheet over Edit): either a place is chosen and it asks what goes in it, or a module is chosen and it asks which place it takes.
function replaceLayer() {
  const r = S.replace || { slot: 3 };
  const rows = [];
  let title;
  const done = (pins) => say({ pins, sheet: 'pin' });
  if (r.mod) {
    const d = dest(r.mod);
    title = `Pin ${d.name}. Which place does it take?`;
    S.pins.forEach((id, i) => rows.push({ d: dest(id), tail: `Place ${i + 1}`, run: () => { const next = [...S.pins]; next[i] = r.mod; done(next); } }));
  } else {
    const at = r.slot;
    title = `Place ${at + 1} holds ${dest(S.pins[at]).name}. Put what there?`;
    for (const d of DEST) {
      if (d.id === S.pins[at]) continue;
      const from = S.pins.indexOf(d.id);
      rows.push({ d, tail: from >= 0 ? `Swaps with place ${from + 1}` : '', run: () => { const next = [...S.pins]; if (from >= 0) next[from] = S.pins[at]; next[at] = d.id; done(next); } });
    }
  }
  const scrim = el('div', 'ph-scrim'); scrim.addEventListener('click', () => say({ sheet: 'pin' }));
  const list = el('div', 'ph-actions', { role: 'menu', 'aria-label': title });
  for (const x of rows) {
    const b = el('button', 'ph-action', { type: 'button', role: 'menuitem', 'data-key': `pick-${x.d.id}` }, [ico(x.d.icon), el('span', 'ph-action-name', { text: x.d.name }), x.tail ? el('span', 'ph-row-tag', { text: x.tail }) : null]);
    b.addEventListener('click', x.run);
    list.append(b);
  }
  const cancel = textBtn('Cancel', 'ph-action-cancel', null, 'cancel'); cancel.addEventListener('click', () => say({ sheet: 'pin' }));
  return el('div', 'ph-sheet-layer', {}, [scrim, el('section', 'ph-bottom', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [el('h2', 'ph-bottom-title', { text: title }), list, cancel])]);
}

// Bar states: the bar drawn with each look forced on, for the eye (a finger cannot hold a state still).
function statesSheet() {
  const close = iconBtn('xmark', 'Close', 'btn-quiet', 'close');
  close.addEventListener('click', closeSheet);
  const one = (label, o) => {
    const bar = bottomBar({ plain: true, ...o });
    const box = el('div', 'ph-state', {}, [el('p', 'ph-state-label', { text: label }), bar]);
    box.inert = true;
    return box;
  };
  const kind = S.bar === 'middle' ? 'the round button' : 'More';
  const body = el('div', 'ph-states', {}, [
    one('Resting. Planner is open; Chat has 2 new.', { here: 'planner' }),
    one('Pressed: a finger on Calendar.', { here: 'planner', pressed: 'calendar' }),
    one('Focus: the keyboard on Calendar.', { here: 'planner', focus: 'calendar' }),
    one(`Pressed: a finger on ${kind}.`, { here: 'planner', pressed: 'more' }),
    one(`Focus: the keyboard on ${kind}.`, { here: 'planner', focus: 'more' }),
    one('Planner is open; 12 new in Chat and in Calendar (9+).', { here: 'planner', counts: { chat: 12, calendar: 12 } }),
    one('Chat is open: it shows no count.', { here: 'chat' }),
    one('A place that is not one of the four is open (To-do): the switcher shows you are there.', { here: 'todo' }),
    one('The safe area under the bar: 34px of the bar\'s own surface, the places above it.', { here: 'planner', safe: true }),
  ]);
  return sheetShell('Bar states', close, el('span', 'ph-bar-end'), body);
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
  return el('div', 'ph-sheet-layer', {}, [scrim, el('section', 'ph-bottom', { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Leave the space?' }, [
    el('h2', 'ph-bottom-title', { text: 'Leave Lisbon in autumn?' }), el('p', 'ph-bottom-text', { text: S.call !== 'off' ? 'You will leave the space and the call.' : 'You will leave the space.' }), el('div', 'ph-bottom-foot', {}, [stay, leave])])]);
}

// The top bar's menu: the host's menu classes, held under the button.
function menuPop() {
  const scrim = el('div', 'ph-scrim ph-scrim-clear'); scrim.addEventListener('click', closeSheet);
  const items = [{ icon: 'share-nodes', label: 'Share' }, { divider: true }, { icon: 'right-from-bracket', label: 'Leave', danger: true }];
  const menu = el('div', 'host-menu ph-menu', { role: 'menu' });
  for (const it of items) {
    if (it.divider) { menu.append(el('div', 'host-menu-divider')); continue; }
    const b = el('button', `host-menu-item${it.danger ? ' danger' : ''}`, { type: 'button', role: 'menuitem' }, [ico(it.icon), el('span', 'host-menu-label', { text: it.label })]);
    b.addEventListener('click', () => { if (it.label === 'Leave') say({ sheet: 'leave' }); else closeSheet(); });
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
function draw(quiet = false) {
  const keep = { chat: root.querySelector('.ph-compose-field')?.value };
  const was = keyOf(root.contains(D.activeElement) ? D.activeElement : null);
  root.className = `ph${S.kb ? ' kb' : ''}${S.call !== 'off' ? ' in-call' : ''}`;
  if (S.sheet === 'bar') S.view = 'module';
  const view = el('main', 'ph-view', {}, [S.view === 'call' ? callView() : S.view === 'chat' ? chatView() : moduleView()]);
  if (S.sheet === 'bar') view.append(actionBar());
  const layers = [];
  if (S.sheet === 'more' || S.sheet === 'pin' || S.sheet === 'replace') { const m = moreSheet(); if (S.sheet === 'replace') m.inert = true; layers.push(m); }
  if (S.sheet === 'replace') layers.push(replaceLayer());
  if (S.sheet === 'states') layers.push(statesSheet());
  if (S.sheet === 'object') layers.push(objectSheet());
  if (S.sheet === 'edit') layers.push(editSheet());
  if (S.sheet === 'actions') layers.push(actionsSheet());
  if (S.sheet === 'online') layers.push(actionsSheet('Online', [...PEOPLE.slice(0, 3).map((p) => ({ icon: 'circle-user', label: p.me ? `${p.name} (you)` : p.name })), { divider: true }, { icon: 'user-plus', label: 'Invite someone' }]));
  if (S.sheet === 'leave') layers.push(leaveSheet());
  if (S.sheet === 'menu') layers.push(menuPop());
  // The module's own view moves the planner's frame out of the old view: keep it by re-parenting through append.
  const page = [topBar(), view, S.call !== 'off' && S.view !== 'call' ? strip() : el('span', 'ph-none'), bottomBar()];
  if (S.sheet !== 'none' && S.sheet !== 'bar') for (const e of page) e.inert = true; // a sheet or dialog is open: nothing behind it takes focus or a tap
  root.replaceChildren(...page, ...layers);
  if (keep.chat) { const f = root.querySelector('.ph-compose-field'); if (f) f.value = keep.chat; }
  if (S.kb) {
    const f = S.sheet === 'edit' ? D.getElementById('ph-edit-name') : S.view === 'chat' && S.sheet === 'none' ? root.querySelector('.ph-compose-field') : null;
    if (f) { f.focus({ preventScroll: true }); f.scrollIntoView({ block: 'nearest' }); }
  }
  const first = () => (root.querySelector('.ph-bottom button, .ph-menu button') || root.querySelector('.ph-sheet:not([inert]) button'));
  const before = drawn; drawn = S.sheet;
  if (quiet || S.kb) return;
  const from = level(before); const to = level(S.sheet);
  let target = null;
  if (before !== S.sheet && to < from) { // back out of a level: the control that opened it
    target = find(openers[to]);
    openers.length = to;
    if (!target) target = first() || root.querySelector('.sdk-tabbar [aria-current="page"], .sdk-tabbar [data-tab]');
  } else if (before !== S.sheet) target = S.sheet !== 'none' && S.sheet !== 'bar' ? first() : find(was);
  else target = find(was);
  target?.focus({ preventScroll: true });
}

D.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.sheet !== 'none' && !e.defaultPrevented) say({ sheet: BACK[S.sheet] || 'none' }); }); // one level back
addEventListener('message', (e) => {
  const d = e.data;
  if (!d || typeof d !== 'object') return;
  if (d.ph === 'theme') theme(d);
  if (d.ph === 'state') { Object.assign(S, d.state); draw(true); shape(); } // the other frame follows without taking the focus
});
theme({ theme: q.get('theme'), mode: q.get('mode'), light: q.get('light') });
shape();
draw();
parent.postMessage({ ph: 'ready' }, '*');
