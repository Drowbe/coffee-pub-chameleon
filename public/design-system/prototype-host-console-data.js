// The Host console section of the Prototype (plan-host-console.md, slice 1): the invented data. Nothing here is real and nothing is
// fetched: thirty made-up environments (and the first six of them for the second state), the plans, the templates, the modules.
// Design-process only: nothing here ships.
export const DOMAIN = 'example.org';

export const PLANS = [
  { id: 'free', name: 'Free', members: 10, storageGb: 2, ai: 50, calls: 2, modules: '6 modules' },
  { id: 'pro', name: 'Pro', members: 60, storageGb: 50, ai: 2000, calls: 10, modules: 'all' },
];

export const MODULES = [
  { id: 'assistant', name: 'Assistant', version: '0.1.26' },
  { id: 'budget', name: 'Budget', version: '0.1.24' },
  { id: 'calendar', name: 'Calendar', version: '1.24.37' },
  { id: 'maps', name: 'Maps', version: '0.9.14' },
  { id: 'places', name: 'Places', version: '0.12.21' },
  { id: 'polls', name: 'Polls', version: '1.15.28' },
  { id: 'research', name: 'Research', version: '0.4.32' },
  { id: 'stream', name: 'Stream', version: '0.1.15' },
  { id: 'todo', name: 'To-do', version: '1.15.26' },
  { id: 'travel', name: 'Planner', version: '0.16.5' },
  { id: 'vault', name: 'Vault', version: '0.3.4' },
];

// The templates: bundled ones and the host's own. `edited` is a bundled template the host has changed; `update` is a newer shipped version.
export const TEMPLATES = [
  { id: 'travel', name: 'Travel', kind: 'bundled', version: '3', edited: true, update: true, hidden: false, desc: 'Trips with friends and family: a Planner, a budget, places and maps.' },
  { id: 'campaigns', name: 'Campaigns', kind: 'bundled', version: '2', edited: false, update: false, hidden: false, desc: 'Tabletop games: sessions, a map table, polls for when to play.' },
  { id: 'book-club', name: 'Book club', kind: 'own', version: '1', edited: false, update: false, hidden: false, desc: 'A reading list, polls and a place to talk.' },
  { id: 'study-group', name: 'Study group', kind: 'own', version: '1', edited: false, update: false, hidden: true, desc: 'Shared notes, a calendar and a to-do list.' },
];
const TPL_MODS = {
  travel: ['calendar', 'travel', 'places', 'maps', 'budget', 'todo'],
  campaigns: ['calendar', 'maps', 'polls', 'stream', 'todo', 'vault'],
  'book-club': ['calendar', 'polls', 'todo', 'research', 'vault', 'assistant'],
  'study-group': ['calendar', 'todo', 'research', 'vault', 'polls', 'assistant'],
};

// [slug, name, plan, status, members, ai calls this month, calls now, template id, extras]
// status: active, pastdue, suspended, refused, deletion. extras: degraded, why (refused or deletion), cap overrides, storage.
const ROWS = [
  ['harbour-club', 'Harbour Club', 'pro', 'active', 41, 1180, 3, 'campaigns', { gb: 18.4 }],
  ['lisbon-trip', 'Lisbon in May', 'free', 'active', 6, 12, 0, 'travel', { gb: 0.6 }],
  ['the-long-table', 'The Long Table', 'pro', 'active', 58, 1710, 4, 'campaigns', { gb: 31.2 }],
  ['northside-writers', 'Northside Writers', 'pro', 'pastdue', 22, 340, 1, 'book-club', { gb: 6.1, since: '24 Oct' }],
  ['oakridge-hikers', 'Oakridge Hikers', 'pro', 'pastdue', 35, 90, 0, 'travel', { gb: 9.8, since: '30 Oct' }],
  ['tiny-trips', 'Tiny Trips', 'pro', 'pastdue', 4, 8, 0, 'travel', { gb: 0.3, since: '2 Nov' }],
  ['old-book-club', 'Old Book Club', 'free', 'suspended', 9, 0, 0, 'book-club', { gb: 0.4, since: '12 Sep' }],
  ['summer-camp-2025', 'Summer Camp 2025 for the whole extended family', 'free', 'suspended', 8, 0, 0, 'travel', { gb: 1.1, since: '3 Oct' }],
  ['greenway-co-op', 'Greenway Co-op', 'pro', 'refused', 12, 0, 0, 'study-group', { gb: 4.0, why: 'Its data folder cannot be read.' }],
  ['dragons-rest', 'Dragon’s Rest', 'free', 'refused', 7, 0, 0, 'campaigns', { gb: 0.9, why: 'Its template is missing.' }],
  ['test-env', 'Test environment', 'free', 'deletion', 1, 0, 0, 'travel', { gb: 0.1, why: 'The owner asked on 3 Nov.' }],
  ['kims-rollback', 'Kim’s rollback', 'free', 'deletion', 2, 3, 0, 'study-group', { gb: 0.2, why: 'The owner asked on 5 Nov.' }],
  ['riverside-chess', 'Riverside Chess', 'free', 'active', 9, 41, 1, 'study-group', { gb: 1.3, degraded: '28 Oct' }],
  ['anas-birthday', 'Ana’s Birthday Trip', 'free', 'active', 5, 7, 0, 'travel', { gb: 0.8, degraded: '1 Nov' }],
  ['westgate-gamers', 'Westgate Gamers', 'pro', 'active', 51, 1650, 9, 'campaigns', { gb: 22.0 }],
  ['maple-street', 'Maple Street Reading Circle', 'free', 'active', 10, 46, 1, 'book-club', { gb: 1.7 }],
  ['the-pines', 'The Pines', 'pro', 'active', 17, 1980, 2, 'travel', { gb: 12.5 }],
  ['coffee-and-code', 'Coffee and Code', 'pro', 'active', 29, 620, 2, 'study-group', { gb: 7.7 }],
  ['uncle-joes', 'Uncle Joe’s 80th', 'free', 'active', 8, 18, 1, 'travel', { gb: 1.9 }],
  ['moonlight-ttrpg', 'Moonlight TTRPG', 'free', 'active', 6, 2, 1, 'campaigns', { gb: 0.5 }],
  ['berlin-2027', 'Berlin 2027', 'pro', 'active', 12, 210, 0, 'travel', { gb: 3.3 }],
  ['sunday-league', 'Sunday League', 'pro', 'active', 44, 330, 5, 'book-club', { gb: 10.2 }],
  ['quiet-corner', 'Quiet Corner', 'free', 'active', 3, 0, 0, 'book-club', { gb: 0.1 }],
  ['atlas-guild', 'Atlas Guild', 'pro', 'active', 33, 800, 3, 'campaigns', { gb: 14.9 }],
  ['grandma-visit', 'Visiting Grandma', 'free', 'active', 4, 9, 0, 'travel', { gb: 0.4 }],
  ['night-owls', 'Night Owls', 'pro', 'active', 19, 150, 1, 'study-group', { gb: 5.0 }],
  ['patagonia', 'Patagonia', 'pro', 'active', 14, 460, 0, 'travel', { gb: 8.6 }],
  ['the-quest-board', 'The Quest Board', 'free', 'active', 7, 25, 0, 'campaigns', { gb: 0.7 }],
  ['vale-family', 'Vale Family', 'free', 'active', 5, 4, 0, 'travel', { gb: 0.9 }],
  ['zeta-lab', 'Zeta Lab', 'pro', 'active', 27, 540, 2, 'study-group', { gb: 6.6 }],
];

const planOf = (id) => PLANS.find((p) => p.id === id) || PLANS[0];

export const ENVIRONMENTS = ROWS.map(([slug, name, plan, status, members, ai, calls, template, x], i) => {
  const p = planOf(plan);
  const free = plan === 'free';
  const all = MODULES.map((m) => m.id);
  const mods = free ? TPL_MODS[template] : all.filter((m) => !(m === 'stream' && i % 3 === 0) && !(m === 'research' && i % 4 === 0));
  return {
    slug, name, plan, status, template,
    members, ai, calls,
    memCap: p.members, aiCap: p.ai, callsCap: p.calls, storageCap: p.storageGb,
    storageGb: x.gb, spaces: 1 + (members % 4),
    degraded: x.degraded || '', why: x.why || '', since: x.since || '',
    mods,
    created: `${(i * 7) % 27 + 1} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'][i % 7]} 2026`,
    owners: [
      { login: `${slug.split('-')[0]}.owner`, name: `${['Ana', 'Ben', 'Mia', 'Kim', 'Raj', 'Eli'][i % 6]} ${['Ortiz', 'Hale', 'Costa', 'Lind', 'Rao', 'Park'][(i + 2) % 6]}`, twoStep: i % 3 !== 1 },
      ...(i % 4 === 0 ? [{ login: `${slug.split('-')[0]}.second`, name: 'Sam Weir', twoStep: false }] : []),
    ],
  };
});

export const pct = (n, cap) => (cap ? Math.min(100, Math.round((n / cap) * 100)) : 0);
// Near a cap (Thomas, 2026-11-06): 80 percent or more of members, AI calls a month or calls at once. Storage is not counted here.
export const nearCap = (e) => e.status === 'active' && [[e.members, e.memCap], [e.ai, e.aiCap], [e.calls, e.callsCap]].some(([n, c]) => c && n / c >= 0.8);
// The kinds the strip counts, in its order. An environment can be in more than one (a past-due one near a cap).
export const KINDS = [
  { id: 'pastdue', word: 'past due', one: 'Past due', icon: 'credit-card', tone: 'danger', test: (e) => e.status === 'pastdue' },
  { id: 'suspended', word: 'suspended', one: 'Suspended', icon: 'circle-pause', tone: 'warn', test: (e) => e.status === 'suspended' },
  { id: 'refused', word: 'won’t open', one: 'Won’t open', icon: 'triangle-exclamation', tone: 'danger', test: (e) => e.status === 'refused' },
  { id: 'deletion', word: 'deletion asked', one: 'Deletion asked', icon: 'trash-can', tone: 'warn', test: (e) => e.status === 'deletion' },
  { id: 'near', word: 'near a cap', one: 'Near a cap', icon: 'gauge-high', tone: 'warn', test: nearCap },
  { id: 'degraded', word: 'degraded', one: 'Degraded', icon: 'arrow-trend-down', tone: 'warn', test: (e) => Boolean(e.degraded) },
];
export const needsAttention = (e) => KINDS.some((k) => k.test(e));
export const STATUS_WORD = { active: 'Active', pastdue: 'Past due', suspended: 'Suspended', refused: 'Won’t open', deletion: 'Deletion asked' };
export const STATUS_TONE = { active: 'ok', pastdue: 'danger', suspended: 'warn', refused: 'danger', deletion: 'warn' };

export const tplName = (id) => (TEMPLATES.find((t) => t.id === id) || { name: 'No template' }).name;
export const usedBy = (all, id) => all.filter((e) => e.template === id);
export const runningModule = (all, id) => all.filter((e) => e.mods.includes(id));

export const HOST_ADMINS = [{ login: 'admin', twoStep: 'on', you: true }, { login: 'thomas', twoStep: 'on' }, { login: 'ops.night', twoStep: 'off' }];
export const MAP_FILES = [
  { name: 'world-low.pmtiles', kind: 'World', zoom: '0–5', size: '84 MB' },
  { name: 'portugal.pmtiles', kind: 'Region', zoom: '0–14', size: '1.2 GB' },
  { name: 'alps.pmtiles', kind: 'Region', zoom: '0–14', size: '2.8 GB' },
];
