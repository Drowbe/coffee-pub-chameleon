// The Prototype page (prototype.html): the panel we are building, the one module panel, createModuleFrame (public/module-frame.js), in four states, with a
// theme, light or dark, and the panels' width chosen at the top (also from the address: ?theme=&mode=&w=).
import { createModuleFrame } from '/module-frame.js';
import { shareDialog, printFrame } from '/module-actions.js';
import { createPlanner, jumpList, PLANNER_VIEWS, PLANNER_TITLE, plannerStatus } from './prototype-planner.js';

const D = document;
const THEMES = [
  { id: 'chameleon', label: 'Chameleon' },
  { id: 'strong-coffee', label: 'Strong Coffee' },
  { id: 'calming-teal', label: 'Calming Teal' },
  { id: 'burnt-orange', label: 'Burnt Orange' },
];
const MODES = [{ id: 'dark', label: 'Dark', icon: 'moon' }, { id: 'light', label: 'Light', icon: 'sun' }];
const WIDTHS = [390, 500, 700, 1280].map((w) => ({ id: String(w), label: `${w}` }));

let planner = null;

const q = new URLSearchParams(location.search);
const state = {
  theme: THEMES.some((t) => t.id === q.get('theme')) ? q.get('theme') : 'chameleon',
  mode: q.get('mode') === 'light' ? 'light' : 'dark',
  w: WIDTHS.some((w) => w.id === q.get('w')) ? q.get('w') : '700',
};

function apply() {
  D.getElementById('pp-theme-css').href = `themes/${state.theme}.css`;
  D.documentElement.dataset.themeMode = state.mode;
  D.documentElement.style.setProperty('--pp-w', `${state.w}px`);
  D.documentElement.dataset.ppTheme = state.theme;
  if (planner) planner.set(state);
  const u = new URL(location.href);
  u.searchParams.set('theme', state.theme);
  u.searchParams.set('mode', state.mode);
  u.searchParams.set('w', state.w);
  history.replaceState(null, '', u);
}

// The page's own switches: the segmented switch (a radio group; the arrows move and choose: /sdk/host.js).
function pageSwitch(id, key, options) {
  const box = D.getElementById(id);
  const draw = () => {
    box.textContent = '';
    for (const o of options) {
      const b = D.createElement('button');
      b.type = 'button';
      b.className = 'mf-switch-btn';
      b.dataset.key = `${key}:${o.id}`;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(state[key] === o.id));
      b.tabIndex = state[key] === o.id ? 0 : -1;
      if (o.icon) { const i = D.createElement('i'); i.className = `fa-solid fa-${o.icon} fa-fw`; i.setAttribute('aria-hidden', 'true'); b.append(i); }
      const w = D.createElement('span');
      w.textContent = o.label;
      b.append(w);
      b.addEventListener('click', () => { state[key] = o.id; apply(); draw(); box.querySelector('[aria-checked="true"]').focus(); });
      box.append(b);
    }
  };
  draw();
}

// ---- the sample panels ----
const rows = (n, words) => {
  const ul = D.createElement('ul');
  ul.className = 'pp-rows';
  for (let i = 0; i < n; i += 1) {
    const li = D.createElement('li');
    li.className = 'pp-row';
    const a = D.createElement('span');
    a.className = 'pp-row-words';
    a.textContent = words[i % words.length];
    const b = D.createElement('span');
    b.className = 'pp-row-note';
    b.textContent = `${(i % 5) + 1} May`;
    li.append(a, b);
    ul.append(li);
  }
  return ul;
};
const WORDS = ['Passports and visas', 'Chargers and adaptors', 'Rain jackets', 'First aid kit', 'Snacks for the drive', 'Maps printed', 'Camera and spare batteries', 'Sunscreen'];
const titlebar = (extra = []) => ({
  add: { label: 'Add', entries: [{ id: 'list', label: 'A list', icon: 'list' }, { id: 'note', label: 'A note', icon: 'note-sticky' }] },
  actions: [...extra, { id: 'pin', icon: 'thumbtack', label: 'Pin', placement: 'bar', on: false }, { id: 'alerts', icon: 'bell', label: 'Alerts', placement: 'bar' }],
  close: true,
});
const viewSwitch = () => ({ type: 'switch', id: 'view', label: 'View', value: 'list', options: [{ id: 'list', label: 'List', icon: 'list' }, { id: 'board', label: 'Board', icon: 'table-columns' }, { id: 'calendar', label: 'Calendar', icon: 'calendar' }] });
const filtersCtl = () => (
{ type: 'filters', id: 'filters', label: 'Filters', groups: [
    { id: 'whose', heading: 'Show', single: true, value: 'all', options: [{ id: 'all', label: 'All', count: 24 }, { id: 'mine', label: 'Mine', count: 8 }, { id: 'shared', label: 'Shared', count: 5 }, { id: 'done', label: 'Done', count: 3 }] },
    { id: 'when', heading: 'When', options: [{ id: 'today', label: 'Today', on: true }, { id: 'week', label: 'This week' }, { id: 'flagged', label: 'Flagged' }] },
    { id: 'status', heading: 'Status', options: [{ id: 'late', label: 'Late' }, { id: 'unassigned', label: 'Not assigned' }] },
  ] }
);
const manyTools = () => [
  viewSwitch(),
  { type: 'search', id: 'find', label: 'Search the list', placeholder: 'Search' },
  filtersCtl(),
  { type: 'title', text: 'Week of 3 May' },
];

const tabsGroup = { name: 'Tabs', note: 'A tab strip, for switching between different pages: a plain fill on the chosen tab, no shape that joins the content.',
  frame: () => ({
    title: 'Trip', icon: 'suitcase', titlebar: titlebar(),
    toolbar: [{ type: 'tabs', id: 'page', label: 'Page', value: 'plan', options: [{ id: 'plan', label: 'Plan' }, { id: 'people', label: 'People', count: 4 }, { id: 'money', label: 'Money' }] }],
    content: rows(12, WORDS),
    status: { text: 'Plan' },
  }) };
const STATES = [
  {
    name: 'Idle', note: 'A typical panel: a view switch, then the search and Filters at the end. The "+" adds; the menu has the window\'s standard actions.',
    frame: () => ({
      title: 'Packing list', icon: 'suitcase', titlebar: titlebar(),
      toolbar: [viewSwitch(), { type: 'search', id: 'find', label: 'Search the list', placeholder: 'Search' }, filtersCtl()],
      content: rows(12, WORDS),
      status: { text: '12 things, 3 packed', items: [{ text: 'Saved', icon: 'check', tone: 'ok' }] },
    }),
  },
  {
    name: 'Many controls', note: 'The view switch, an info line, and the search and Filters at the end. Export is an icon in the title bar. Narrow the width: the left side folds first; the end group stays put.',
    frame: () => ({
      title: 'Packing list for the long weekend in the mountains', icon: 'suitcase', titlebar: titlebar([{ id: 'export', icon: 'file-export', label: 'Export', placement: 'bar' }]), toolbar: manyTools(),
      content: rows(6, WORDS),
      status: { text: 'Showing 24 of 31, filtered by Today, sorted by date', items: [{ text: '2 late', icon: 'triangle-exclamation', tone: 'warn' }, { text: 'Saved', icon: 'check', tone: 'ok' }] },
    }),
  },
  {
    name: 'Empty', note: 'No content yet: the empty state in the content area.',
    frame: () => ({
      title: 'Packing list', icon: 'suitcase', titlebar: titlebar(),
      toolbar: [viewSwitch()],
      empty: { icon: 'inbox', title: 'Nothing here yet', text: 'Add the first one with New.' },
      status: { text: 'Nothing yet' },
    }),
  },
  {
    name: 'Narrow', note: 'Always 300 pixels wide: the left side goes into More; the search and Filters stay at the end.', narrow: true,
    frame: () => ({
      title: 'Packing list', icon: 'suitcase', titlebar: titlebar(), toolbar: manyTools(),
      content: rows(6, WORDS),
      status: { text: '24 things', items: [{ text: 'Saved', icon: 'check', tone: 'ok' }] },
    }),
  },
];

const main = D.getElementById('pp-main');
const lastAction = (log) => (e) => {
  log.textContent = `Last: ${e.area} ${e.id}${e.standard ? ' (standard)' : ''}${e.value !== undefined ? ` = ${e.value}` : ''}${e.on !== undefined ? (e.on ? ' (on)' : ' (off)') : ''}`;
};
// One panel: its name, a note, the panel on the canvas colour, and a line that says what was last pressed.
function drawState(s, into, level = 'h2') {
  const sec = D.createElement('section');
  sec.className = 'pp-state';
  const h = D.createElement(level);
  h.className = 'pp-state-name';
  h.textContent = s.name;
  const p = D.createElement('p');
  p.className = 'pp-state-note';
  p.textContent = s.note;
  const box = D.createElement('div');
  box.className = `pp-frame${s.narrow ? ' pp-narrow' : ''}${s.phone ? ' pp-phone' : ''}${s.tall ? ' pp-tall' : ''}${s.open ? ' pp-open' : ''}`;
  const log = D.createElement('p');
  log.className = 'pp-log';
  log.setAttribute('aria-live', 'polite');
  const frame = createModuleFrame({ ...s.frame(), onAction: (e) => { lastAction(log)(e); if (s.onAction) s.onAction(e); } });
  box.append(frame.el);
  sec.append(h, p, box, log);
  into.append(sec);
  return { frame, box };
}
for (const s of [...STATES, tabsGroup]) drawState(s, main);

// ---- the title bar's actions (Thomas, 2026-10-24) ----
const EXPENSES = ['Hotel, two nights', 'Train tickets', 'Dinner on Friday', 'Museum passes', 'Taxi from the station', 'Coffee and snacks'];
const EVENTS = ['Breakfast at the hotel', 'Walking tour', 'Lunch by the river', 'Train to the coast', 'Dinner booking'];
const MESSAGES = ['Ana: The train is at nine', 'Ben: I will bring the snacks', 'Mia: Hotel is booked', 'Ana: Who has the passes?'];
const budgetLike = () => ({
  title: 'Budget', icon: 'wallet',
  titlebar: { add: { label: 'Add an expense' }, actions: [{ id: 'clear', label: 'Clear', icon: 'trash', placement: 'menu', danger: true }], close: true },
  toolbar: [viewSwitch(), { type: 'spacer' }, { type: 'search', id: 'find', label: 'Search the budget', placeholder: 'Search' }],
  content: rows(6, EXPENSES),
  status: { text: '6 expenses' },
});
const TITLEBAR_STATES = [
  {
    name: 'Budget-like', note: 'The "+", Clear in the menu (last, in red, after its own line) and the window\'s standard actions.',
    frame: budgetLike,
  },
  {
    name: 'Calendar-like', note: 'The "+", Today and Filter as icons beside the menu, and the window\'s standard actions in the menu.',
    frame: () => ({
      title: 'Calendar', icon: 'calendar',
      titlebar: {
        add: { label: 'Add an event' },
        actions: [{ id: 'today', label: 'Today', icon: 'calendar-day', placement: 'bar' }, { id: 'filter', label: 'Filter', icon: 'filter', placement: 'bar', on: false }],
        close: true,
      },
      toolbar: [{ type: 'switch', id: 'view', label: 'View', value: 'week', options: [{ id: 'day', label: 'Day', icon: 'calendar-day' }, { id: 'week', label: 'Week', icon: 'calendar-week' }, { id: 'month', label: 'Month', icon: 'calendar' }] }],
      content: rows(5, EVENTS),
      status: { text: 'Week of 3 May' },
    }),
  },
  {
    name: 'Chat-like', note: 'No "+"; the tool handles Share only, so Settings and Print are not in the menu.',
    frame: () => ({
      title: 'Chat', icon: 'comments',
      titlebar: { moduleStandard: { share: true, onPick: () => {} }, close: true },
      toolbar: [],
      content: rows(4, MESSAGES),
      status: { text: '4 messages' },
    }),
  },
  {
    name: 'Narrow, 390', note: 'Always 390 pixels wide, with three icons: the last ones fold into the menu, at its top, before the title is cut.', phone: true,
    frame: () => ({
      title: 'Calendar for the long weekend away', icon: 'calendar',
      titlebar: {
        add: { label: 'Add an event' },
        actions: [{ id: 'today', label: 'Today', icon: 'calendar-day', placement: 'bar' }, { id: 'filter', label: 'Filter', icon: 'filter', placement: 'bar', on: false }, { id: 'sync', label: 'Sync now', icon: 'arrows-rotate', placement: 'bar' }, { id: 'clear', label: 'Clear', icon: 'trash', placement: 'menu', danger: true }],
        close: true,
      },
      toolbar: [],
      content: rows(5, EVENTS),
      status: { text: 'Week of 3 May' },
    }),
  },
  {
    name: 'The menu, open', note: 'The Budget-like menu drawn open, so it can be seen without a click (a picture: the real one opens from More).', open: true,
    frame: budgetLike,
  },
];

// The menu as the host draws it (host-menu.js: the same classes and rows), held open in place.
function staticMenu(items) {
  const menu = D.createElement('div');
  menu.className = 'host-menu pp-menu-open';
  menu.setAttribute('aria-hidden', 'true');
  menu.inert = true;
  for (const it of items) {
    if (it.divider) {
      const line = D.createElement('div');
      line.className = 'host-menu-divider';
      menu.append(line);
      continue;
    }
    const b = D.createElement('button');
    b.type = 'button';
    b.className = `host-menu-item${it.danger ? ' danger' : ''}`;
    b.tabIndex = -1;
    if (typeof it.checked === 'boolean') {
      b.setAttribute('role', 'menuitemcheckbox');
      b.setAttribute('aria-checked', String(it.checked));
      const box = D.createElement('span');
      box.className = 'host-menu-check';
      b.append(box);
    }
    if (it.icon) {
      const i = D.createElement('i');
      i.className = `fa-${it.regular ? 'regular' : 'solid'} fa-${it.icon} fa-fw`;
      b.append(i);
    }
    const label = D.createElement('span');
    label.className = 'host-menu-label';
    label.textContent = it.label;
    b.append(label);
    menu.append(b);
  }
  return menu;
}

const group = D.createElement('section');
group.className = 'pp-group';
group.setAttribute('aria-labelledby', 'pp-titlebar-actions');
const groupName = D.createElement('h2');
groupName.className = 'pp-group-name';
groupName.id = 'pp-titlebar-actions';
groupName.textContent = 'Title bar actions';
const groupNote = D.createElement('p');
groupNote.className = 'pp-state-note';
groupNote.textContent = 'Standard actions are the host\'s, the same in every tool; a tool adds its own, as icons beside the menu or in it. The "+" is always beside the menu.';
group.append(groupName, groupNote);
main.append(group);
// The standard actions a module hands to the host (host.standard.set; Thomas, 2026-10-29): Settings, Share and Print, drawn by
// the host in every module's menu after the module's own actions, only for the ones the module handles. Here the panel
// registers all three: Settings is the module's own (here a line below says so), Share opens the host's one Share dialog
// and Print prints this panel's content area alone (public/module-actions.js).
TITLEBAR_STATES.push({
  name: 'Settings, Share and Print', note: 'This panel handles all three, so the host draws them in its menu after the panel\'s own Pin, in the same words, icons and order as in every tool. Share opens the host\'s Share dialog; Print prints the list alone, in light colours.',
  standard: true,
  frame: () => ({
    title: 'Packing list', icon: 'suitcase',
    titlebar: { add: { label: 'Add' }, actions: [{ id: 'pin', icon: 'thumbtack', label: 'Pin', placement: 'menu', on: false }], close: true },
    toolbar: [viewSwitch()],
    content: rows(8, WORDS),
    status: { text: '8 things' },
  }),
});
function registerStandard(frame, log) {
  frame.setTitlebar({ moduleStandard: { settings: true, share: true, print: true, onPick: (id) => {
    log.textContent = `Last: titlebar ${id} (the tool's, run by the host)`;
    if (id === 'share') shareDialog(D, { title: 'Share the packing list', url: `${location.origin}/s/packing-list-3f9a`, message: 'Anyone with the link can see the list, not change it.' });
    else if (id === 'print') printFrame(frame.el);
  } } });
}

for (const s of TITLEBAR_STATES) {
  const { frame, box } = drawState(s, group, 'h3');
  if (s.standard) registerStandard(frame, box.nextElementSibling);
  if (!s.open) continue;
  const menu = staticMenu(frame.titlebarMenu());
  box.append(menu);
  const trigger = frame.el.querySelector('.mf-titlebar-menu');
  trigger.classList.add('pp-held');
  // Under More, its end in line with the button's, as the host's menu sits when it meets the window's edge.
  const place = () => {
    const b = box.getBoundingClientRect();
    const t = trigger.getBoundingClientRect();
    menu.style.top = `${t.bottom - b.top + box.scrollTop + 4}px`;
    menu.style.left = `${Math.max(0, t.right - b.left + box.scrollLeft - menu.offsetWidth)}px`;
  };
  new ResizeObserver(place).observe(frame.el);
  place();
}


// ---- the Planner, every part of it (Thomas, 2026-10-30) ----
// The real structure (public/design-system/prototype-planner.js): the toolbar's views, the date strip, the phase markers, the days with their
// stays, markers and joints, the unscheduled things. The jump list moves to each part.
const planSec = D.createElement('section');
planSec.className = 'pp-group';
planSec.setAttribute('aria-labelledby', 'pp-plan-icons');
const planName = D.createElement('h2');
planName.className = 'pp-group-name';
planName.id = 'pp-plan-icons';
planName.textContent = 'Planner: the whole page, as the Planner draws it';
const planNote = D.createElement('p');
planNote.className = 'pp-state-note';
planNote.textContent = 'The Planner\'s own markup and styles, with a week in Lisbon as the sample. Use the views in the toolbar, the date strip and Hide empty days as in the Planner, or jump to a part below. The Light switch (Strong Coffee, light only) tries four candidate light modes on the same screen: Paper, Cool mist, Cream and Contrast.';
planSec.append(planName, planNote);
main.prepend(planSec);
const planHost = D.createElement('div');
planHost.className = 'pp-planner';
planner = createPlanner(planHost);
planSec.append(jumpList(planner));
let shownView = 'days';
const planBar = (view) => [{ type: 'switch', id: 'view', label: 'View', value: view, options: PLANNER_VIEWS }, { type: 'title', text: PLANNER_TITLE }];
const planned = drawState({
  name: 'Planner', note: 'In the shared frame, in the chosen theme and mode.', tall: true,
  onAction: (e) => {
    if (e.area === 'toolbar' && e.id === 'view') { shownView = e.value; planner.setView(e.value); }
    if (e.area === 'titlebar' && e.id === 'toggle-empty') planner.setHideEmpty(e.on);
  },
  frame: () => ({
    title: 'Planner', icon: 'map-location-dot', titlebar: titlebar([{ id: 'toggle-empty', icon: 'eye-slash', label: 'Hide empty days', placement: 'bar', on: false }]),
    toolbar: planBar('days'),
    content: planHost, flush: true,
    status: { text: plannerStatus('days') },
  }),
}, planSec, 'h3');
planner.onView = (id) => { if (id !== shownView) { shownView = id; planned.frame.setToolbar(planBar(id)); } planned.frame.setStatus({ text: plannerStatus(id) }); };

pageSwitch('pp-theme', 'theme', THEMES);
pageSwitch('pp-mode', 'mode', MODES);
pageSwitch('pp-width', 'w', WIDTHS);
apply();
