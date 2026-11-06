// The Host console section of the Prototype (plan-host-console.md, slice 1; Thomas approved the plan, 2026-11-06): the host console drawn as
// whole screens, for Thomas to judge before anything is built. Design-process only: nothing here ships and nothing calls the server.
// The console is drawn twice, working: once as wide as the page's width switch (default 700; use 1280 to see it wide) and once always 390
// wide, the phone. Both answer to their own width (a container query at 640 px, as the real console will answer to the window's), so
// the left navigation folds into the tab strip the console has now. 30 invented environments, or 6 (the switch under the heading).
// Pieces reused, not drawn again: .subtabs (the navigation, the environment's tabs, the editor's jump list), .sdk-table, .sdk-card,
// .sdk-panel, .sdk-status, .sdk-progress, .sdk-banner, .sdk-search and the fields, openHostMenu (host.menu.show's menu), confirmDialog.
import { openHostMenu } from '/host-menu.js';
import { confirmDialog } from '/confirm.js';
import {
  DOMAIN, PLANS, MODULES, TEMPLATES, ENVIRONMENTS, HOST_ADMINS, MAP_FILES, KINDS, STATUS_WORD, STATUS_TONE,
  pct, nearCap, needsAttention, tplName, usedBy, runningModule,
} from './prototype-host-console-data.js';

const D = document;
const h = (tag, cls, text) => { const e = D.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const fa = (name) => { const i = h('i', `fa-solid fa-${name} fa-fw`); i.setAttribute('aria-hidden', 'true'); return i; };
const btn = (label, { icon, cls = 'btn', onClick, aria } = {}) => {
  const b = h('button', cls);
  b.type = 'button';
  if (icon) b.append(fa(icon));
  if (label) b.append(h('span', '', label));
  if (aria) b.setAttribute('aria-label', aria);
  if (onClick) b.addEventListener('click', onClick);
  return b;
};
const iconBtn = (icon, label, onClick, cls = 'sdk-icon-btn btn-quiet btn-small') => {
  const b = h('button', cls);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.append(fa(icon));
  b.addEventListener('click', onClick);
  return b;
};
const chip = (tone, word, dot = true) => {
  const s = h('span', 'sdk-status');
  s.dataset.tone = tone;
  if (dot) { const d = h('span', 'sdk-chip-dot'); d.setAttribute('aria-hidden', 'true'); s.append(d); }
  s.append(word);
  return s;
};
const bar = (label, value, cap, { unit = '' } = {}) => {
  const p = pct(value, cap);
  const b = h('span', `sdk-progress sdk-progress-sm${p >= 80 ? ' warn' : ''}`);
  b.setAttribute('role', 'progressbar');
  b.setAttribute('aria-label', label);
  b.setAttribute('aria-valuemin', '0');
  b.setAttribute('aria-valuemax', '100');
  b.setAttribute('aria-valuenow', String(p));
  b.setAttribute('aria-valuetext', `${p} percent${p >= 80 ? ', near the cap' : ''}${unit}`);
  const f = h('span', 'sdk-progress-fill');
  f.style.setProperty('--pct', `${p}%`);
  b.append(f);
  return b;
};
const num = (n) => n.toLocaleString('en-US');
const field = (label, control, hint) => {
  const l = h('label', 'sdk-field');
  l.append(h('span', 'sdk-label', label), control);
  if (hint) l.append(h('span', 'sdk-hint', hint));
  return l;
};
const input = (value = '', ph = '', type = 'text') => { const i = h('input'); i.type = type; i.value = value; if (ph) i.placeholder = ph; return i; };
const select = (options, value) => {
  const s = h('select');
  for (const [id, label] of options) { const o = h('option', '', label); o.value = id; if (id === value) o.selected = true; s.append(o); }
  return s;
};
const check = (label, on = false, disabled = false) => {
  const l = h('label', 'sdk-choice-row');
  const c = h('input'); c.type = 'checkbox'; c.checked = on; c.disabled = disabled;
  l.append(c, h('span', 'sdk-choice-text', label));
  return l;
};
const switchBox = (label, on) => { const c = h('input', 'sdk-switch'); c.type = 'checkbox'; c.checked = on; c.setAttribute('aria-label', label); return c; };
const panel = (title, ...kids) => { const p = h('section', 'sdk-panel hc-part'); if (title) p.append(h('h3', 'hc-part-name', title)); p.append(...kids); return p; };
const hint = (text) => h('p', 'sdk-hint hc-hint', text);
const facts = (pairs) => {
  const d = h('dl', 'hc-facts');
  for (const [k, v] of pairs) { d.append(h('dt', '', k)); const dd = h('dd'); if (v instanceof Node) dd.append(v); else dd.textContent = v; d.append(dd); }
  return d;
};
const tableIn = (label, head, ...rest) => {
  const wrap = h('div', 'sdk-table-wrap hc-wrap');
  const t = h('table', 'sdk-table');
  t.setAttribute('aria-label', label);
  const th = h('thead'); const tr = h('tr');
  for (const [text, cls] of head) { const c = h('th', cls || '', text); c.scope = 'col'; if (!text) { c.textContent = ''; c.append(h('span', 'visually-hidden', cls === 'hc-more-col' ? 'Actions' : '')); } tr.append(c); }
  th.append(tr);
  t.append(th, ...rest);
  wrap.append(t);
  return { wrap, table: t };
};
const link = (text, onClick) => { const a = h('a', 'hc-link', text); a.href = '#'; a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); }); return a; };

const NAV = [
  ['environments', 'Environments', 'layer-group'],
  ['templates', 'Templates', 'clone'],
  ['modules', 'Modules', 'puzzle-piece'],
  ['plans', 'Plans', 'tags'],
  ['server', 'Server', 'server'],
];
const TABS = [
  ['overview', 'Overview'], ['plan', 'Plan and modules'], ['template', 'Template'], ['owners', 'Owners and two-step'],
  ['backups', 'Backups'], ['danger', 'Danger zone'],
];
const EDITOR_PARTS = ['Basics', 'Words and verbs', 'Home icon', 'Modules', 'New environments', 'Phases', 'Reactions', 'Theme', 'Icons'];
const SERVER_PARTS = ['The host', 'Your two-step sign-in', 'Host admins', 'AI', 'Maps', 'Flight schedule'];

// One console. `count` says how many environments it holds (30 or 6), read at each draw.
export function createConsole({ count, width }) {
  const frame = h('div', 'hc-frame');
  if (width) frame.dataset.fixed = String(width);
  const el = h('div', 'hc');
  frame.append(el);
  const S = { route: 'environments', slug: '', tab: 'overview', tpl: 'travel', q: '', filter: 'all', sort: 'attention', offer: false, log: '' };
  const envs = () => ENVIRONMENTS.slice(0, count());
  const byslug = (slug) => ENVIRONMENTS.find((e) => e.slug === slug) || ENVIRONMENTS[0];

  // ---- the top bar and the navigation ----
  const top = h('header', 'hc-top');
  const brand = h('span', 'hc-brand'); brand.append(fa('mug-hot'), h('span', '', 'Host console'));
  const hash = h('code', 'hc-hash');
  top.append(brand, hash, btn('Sign out', { cls: 'btn btn-small', icon: 'right-from-bracket' }));
  const nav = h('nav', 'subtabs hc-nav');
  nav.setAttribute('aria-label', 'Host console sections');
  const navBtns = {};
  for (const [id, label, icon] of NAV) {
    const b = h('button', 'subtab');
    b.type = 'button';
    b.append(fa(icon), h('span', '', label));
    b.addEventListener('click', () => go(id));
    navBtns[id] = b;
    nav.append(b);
  }
  const main = h('main', 'hc-main');
  const body = h('div', 'hc-body');
  body.append(nav, main);
  el.append(top, body);

  const status = (text) => { S.log = text; const s = main.querySelector('.hc-status'); if (s) s.textContent = text; };
  const statusLine = () => { const s = h('p', 'hc-status'); s.setAttribute('role', 'status'); s.setAttribute('aria-live', 'polite'); s.textContent = S.log; return s; };
  const pageHead = (title, ...actions) => {
    const hd = h('div', 'hc-head');
    hd.append(h('h2', 'hc-title', title));
    if (actions.length) { const a = h('div', 'hc-head-actions'); a.append(...actions); hd.append(a); }
    return hd;
  };

  function go(route, extra = {}) {
    Object.assign(S, { route, ...extra });
    S.log = '';
    draw();
    el.scrollTop = 0;
  }
  const openEnv = (slug, tab = 'overview') => go('env', { slug, tab });
  const openTpl = (id) => go('editor', { tpl: id });

  function draw() {
    const at = S.route === 'env' || S.route === 'new' ? 'environments' : S.route === 'editor' ? 'templates' : S.route;
    for (const [id, b] of Object.entries(navBtns)) { if (id === at) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
    hash.textContent = `#${S.route === 'env' ? `environments/${S.slug}` : S.route === 'new' ? 'environments/new' : S.route === 'editor' ? `templates/${S.tpl}` : S.route}`;
    main.textContent = '';
    ({ environments: drawEnvironments, env: drawEnv, new: drawNew, templates: drawTemplates, editor: drawEditor, modules: drawModules, plans: drawPlans, server: drawServer })[S.route]();
    frame.dataset.route = S.route;
  }

  // ---- actions that ask first ----
  const ask = async (opts, done) => { if (await confirmDialog(opts)) status(done); };
  const rowMenu = (trigger, e) => openHostMenu(trigger, [
    { label: 'Open', icon: 'arrow-up-right-from-square', onPick: () => openEnv(e.slug) },
    { label: 'Back up', icon: 'download', onPick: () => status(`Backed up ${e.name}: a zip would download. Nothing is made here.`) },
    e.status === 'suspended'
      ? { label: 'Resume', icon: 'circle-play', onPick: () => ask({ title: `Resume ${e.name}?`, message: 'People can open it again.', action: 'Resume' }, `${e.name} resumed (a picture).`) }
      : { label: 'Suspend', icon: 'circle-pause', onPick: () => ask({ title: `Suspend ${e.name}?`, message: 'No one can open it until you resume it. Nothing is removed.', action: 'Suspend', kind: 'destructive' }, `${e.name} suspended (a picture).`) },
    { divider: true },
    { label: 'Delete', icon: 'trash', danger: true, onPick: () => deleteEnv(e) },
  ]);
  const deleteEnv = (e) => ask({ title: `Delete ${e.name}?`, message: 'It is moved aside, not erased. Its owners can no longer open it.\n\nType its address to say you mean it.', action: 'Delete', kind: 'final', typed: e.slug }, `${e.name} deleted (a picture).`);

  // ======== Environments ========
  function drawEnvironments() {
    const all = envs();
    const nw = btn('New environment', { cls: 'btn btn-primary', icon: 'plus', onClick: () => go('new') });
    main.append(pageHead('Environments', nw));

    // The needs-attention strip: each kind with its count is a filter.
    const strip = h('section', 'sdk-card hc-attention');
    strip.setAttribute('aria-label', 'Needs attention');
    const stripBody = h('div', 'hc-attention-row');
    strip.append(stripBody);

    const tools = h('div', 'hc-tools');
    const search = h('div', 'sdk-search hc-search');
    const si = input(S.q, 'Search name or address', 'search');
    si.setAttribute('aria-label', 'Search environments');
    search.append(fa('magnifying-glass'), si);
    const fOptions = [['all', 'All statuses'], ...KINDS.map((k) => [k.id, k.one]), ['active', 'Active']];
    const fSel = select(fOptions, S.filter); fSel.setAttribute('aria-label', 'Status');
    const sSel = select([['attention', 'Needs attention first'], ['name', 'Name'], ['plan', 'Plan'], ['newest', 'Newest'], ['use', 'Most used']], S.sort); sSel.setAttribute('aria-label', 'Sort');
    const counter = h('p', 'hc-count'); counter.setAttribute('role', 'status'); counter.setAttribute('aria-live', 'polite');
    tools.append(search, fSel, sSel, counter);

    const tbody = h('tbody');
    const { wrap, table } = tableIn('Environments', [['Name'], ['Plan'], ['Status'], ['Use'], ['Template'], ['', 'hc-more-col']], tbody);
    table.classList.add('hc-envs');
    main.append(strip, tools, wrap, statusLine());

    const matches = (e) => {
      const f = S.filter;
      if (f !== 'all' && !(f === 'active' ? e.status === 'active' : KINDS.find((k) => k.id === f).test(e))) return false;
      const q = S.q.trim().toLowerCase();
      return !q || e.name.toLowerCase().includes(q) || e.slug.includes(q);
    };
    const use = (e) => Math.max(pct(e.members, e.memCap), pct(e.ai, e.aiCap));
    const order = {
      attention: (a, b) => (needsAttention(b) - needsAttention(a)) || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
      plan: (a, b) => (b.plan === 'pro') - (a.plan === 'pro') || a.name.localeCompare(b.name),
      newest: (a, b) => ENVIRONMENTS.indexOf(b) - ENVIRONMENTS.indexOf(a),
      use: (a, b) => use(b) - use(a),
    };
    function rows() {
      tbody.textContent = '';
      const list = all.filter(matches).sort(order[S.sort]);
      counter.textContent = `${list.length} of ${all.length} environments`;
      // the strip
      stripBody.textContent = '';
      const lead = h('span', 'hc-attention-label'); lead.append(fa('bell'), h('span', '', 'Needs attention'));
      stripBody.append(lead);
      const live = KINDS.map((k) => [k, all.filter(k.test).length]).filter(([, n]) => n);
      if (!live.length) stripBody.append(h('span', 'hc-attention-none', 'Nothing needs attention.'));
      for (const [k, n] of live) {
        const b = btn('', { cls: 'btn btn-small hc-kind' });
        b.dataset.kind = k.id;
        b.dataset.tone = k.tone;
        b.setAttribute('aria-pressed', String(S.filter === k.id));
        b.append(fa(k.icon), h('b', '', String(n)), h('span', '', k.word));
        b.addEventListener('click', () => { S.filter = S.filter === k.id ? 'all' : k.id; fSel.value = S.filter; rows(); });
        stripBody.append(b);
      }
      if (S.filter !== 'all') { const c = btn('Clear', { cls: 'btn btn-quiet btn-small', onClick: () => { S.filter = 'all'; fSel.value = 'all'; rows(); } }); stripBody.append(c); }
      if (!list.length) {
        const tr = h('tr', 'sdk-table-empty'); const td = h('td', '', 'No environment matches. Clear the search or the filter.'); td.colSpan = 6; tr.append(td); tbody.append(tr);
        return;
      }
      for (const e of list) {
        const tr = h('tr');
        tr.tabIndex = 0;
        tr.dataset.slug = e.slug;
        tr.addEventListener('click', (ev) => { if (!ev.target.closest('button, a')) openEnv(e.slug); });
        tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target === tr) openEnv(e.slug); });
        const name = h('th', 'hc-name-cell'); name.scope = 'row';
        const a = link(e.name, () => openEnv(e.slug)); a.href = `#environments/${e.slug}`;
        name.append(a, h('span', 'sdk-table-sub', `${e.slug}.${DOMAIN}`));
        const plan = h('td', '', e.plan === 'pro' ? 'Pro' : 'Free');
        const st = h('td', 'hc-status-cell');
        st.append(chip(STATUS_TONE[e.status], STATUS_WORD[e.status]));
        if (nearCap(e)) st.append(chip('warn', 'Near a cap', false));
        if (e.degraded) st.append(chip('warn', 'Degraded', false));
        const u = h('td'); u.append(useCell(e));
        const tp = h('td', 'sdk-table-dim', tplName(e.template));
        const mo = h('td', 'hc-more-cell');
        const more = iconBtn('ellipsis', `More for ${e.name}`, () => rowMenu(more, e));
        more.setAttribute('aria-haspopup', 'menu');
        mo.append(more);
        tr.append(name, plan, st, u, tp, mo);
        tbody.append(tr);
      }
    }
    search.querySelector('input').addEventListener('input', (ev) => { S.q = ev.target.value; rows(); });
    fSel.addEventListener('change', () => { S.filter = fSel.value; rows(); });
    sSel.addEventListener('change', () => { S.sort = sSel.value; rows(); });
    rows();
  }
  // Use at a glance: members and AI calls this month against their caps, and calls now where there are any.
  function useCell(e) {
    const box = h('div', 'hc-use');
    const line = (label, v, cap) => {
      const r = h('div', 'hc-use-row');
      r.append(h('span', 'hc-use-key', label), bar(`${label} of ${e.name}`, v, cap), h('span', 'hc-use-val', `${num(v)} / ${num(cap)}`));
      box.append(r);
    };
    line('Members', e.members, e.memCap);
    line('AI', e.ai, e.aiCap);
    if (e.calls) line('Calls', e.calls, e.callsCap);
    return box;
  }

  // ======== New environment ========
  function drawNew() {
    main.append(pageHead('New environment'));
    const back = btn('Environments', { cls: 'btn btn-quiet btn-small hc-back', icon: 'arrow-left', onClick: () => go('environments') });
    main.prepend(back);
    const f = h('form', 'sdk-form hc-form');
    f.noValidate = true;
    f.addEventListener('submit', (ev) => { ev.preventDefault(); status('Created (a picture).'); });
    const tplRows = h('fieldset', 'hc-fieldset'); tplRows.append(h('legend', 'sdk-label', 'Template'));
    TEMPLATES.filter((t) => !t.hidden).concat([{ id: 'none', name: 'No template' }]).forEach((t, i) => {
      const l = h('label', 'sdk-choice-row'); const r = h('input'); r.type = 'radio'; r.name = `new-tpl-${count()}`; r.checked = i === 0;
      l.append(r, h('span', 'sdk-choice-text', t.name)); tplRows.append(l);
    });
    f.append(
      field('Address', input('', 'harbour-club'), `Becomes harbour-club.${DOMAIN}`),
      field('Name', input('', 'Harbour Club')),
      field('Plan', select(PLANS.map((p) => [p.id, p.name]), 'free')),
      tplRows,
      field('First owner login', input('', 'ana.ortiz')),
      field('Their display name', input('', 'Ana Ortiz')),
      field('Their password', input('', '', 'password'), 'At least twelve characters.'),
    );
    const row = h('div', 'hc-actions');
    const create = btn('Create environment', { cls: 'btn btn-primary' }); create.type = 'submit';
    row.append(create, btn('Cancel', { onClick: () => go('environments') }));
    f.append(row);
    main.append(panel('', f), statusLine());
  }

  // ======== One environment's page ========
  function drawEnv() {
    const e = byslug(S.slug);
    main.append(btn('Environments', { cls: 'btn btn-quiet btn-small hc-back', icon: 'arrow-left', onClick: () => go('environments') }));
    const hd = h('div', 'hc-env-head');
    const l = h('div', 'hc-env-id');
    l.append(h('h2', 'hc-title', e.name), h('code', 'hc-slug', `${e.slug}.${DOMAIN}`));
    const chips = h('div', 'hc-chips');
    chips.append(chip(STATUS_TONE[e.status], STATUS_WORD[e.status]));
    if (nearCap(e)) chips.append(chip('warn', 'Near a cap', false));
    if (e.degraded) chips.append(chip('warn', 'Degraded', false));
    l.append(chips);
    hd.append(l, btn('Open environment', { icon: 'arrow-up-right-from-square' }));
    main.append(hd);

    const tabs = h('nav', 'subtabs hc-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', `${e.name}, pages`);
    const mk = (id, label, disabled) => {
      const b = h('button', 'subtab'); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.tab = id;
      b.setAttribute('aria-selected', String(S.tab === id)); b.tabIndex = S.tab === id ? 0 : -1;
      b.append(h('span', '', label));
      if (disabled) { b.setAttribute('aria-disabled', 'true'); b.disabled = true; b.append(h('span', 'sdk-tab-badge', 'later')); }
      else b.addEventListener('click', () => { S.tab = id; S.log = ''; draw(); });
      return b;
    };
    for (const [id, label] of TABS) tabs.append(mk(id, label));
    tabs.append(mk('domain', 'Domain', true));
    tabs.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
      const live = TABS.map(([id]) => id); const i = live.indexOf(S.tab);
      S.tab = live[(i + (ev.key === 'ArrowRight' ? 1 : live.length - 1)) % live.length];
      draw(); main.querySelector(`.hc-tabs [data-tab="${S.tab}"]`).focus();
    });
    main.append(tabs);
    const pane = h('div', 'hc-pane'); pane.setAttribute('role', 'tabpanel');
    main.append(pane, statusLine());
    ({ overview: envOverview, plan: envPlan, template: envTemplate, owners: envOwners, backups: envBackups, danger: envDanger })[S.tab](pane, e);
  }
  function envOverview(pane, e) {
    if (e.why && e.status === 'refused') pane.append(banner('danger', 'triangle-exclamation', `This environment will not open. ${e.why}`));
    if (e.status === 'pastdue') pane.append(banner('danger', 'credit-card', `Past due since ${e.since}. After 14 days it goes back to the Free plan.`));
    if (e.degraded) pane.append(banner('warn', 'arrow-trend-down', `Went back to the Free plan on ${e.degraded}, after a payment stayed past due.`));
    if (e.status === 'deletion') pane.append(banner('warn', 'trash-can', e.why));
    const grid = h('div', 'hc-grid');
    const st = [['Status', chip(STATUS_TONE[e.status], STATUS_WORD[e.status])], ['Plan', e.plan === 'pro' ? 'Pro' : 'Free'], ['Template', tplName(e.template)], ['Created', e.created], ['Spaces', String(e.spaces)]];
    if (e.since && e.status !== 'pastdue') st.splice(1, 0, ['Since', e.since]);
    if (e.status === 'pastdue') st.splice(1, 0, ['Past due since', e.since]);
    if (e.degraded) st.push(['Degraded', e.degraded]);
    grid.append(panel('Status', facts(st)));
    const u = h('div', 'hc-caps');
    const cap = (label, v, c, words) => {
      const r = h('div', 'hc-cap');
      const top2 = h('div', 'hc-cap-top'); top2.append(h('span', 'hc-cap-key', label), h('span', 'hc-cap-val', words || `${num(v)} of ${num(c)}`));
      r.append(top2);
      if (c) { r.append(bar(label, v, c)); if (pct(v, c) >= 80) r.append(h('span', 'hc-cap-note', pct(v, c) >= 100 ? 'At the cap' : 'Near the cap')); }
      return r;
    };
    u.append(cap('Members', e.members, e.memCap), cap('AI calls this month', e.ai, e.aiCap), cap('Calls at once', e.calls, e.callsCap, `${e.calls} now, of ${e.callsCap}`), cap('Storage', e.storageGb, e.storageCap, `${e.storageGb} of ${e.storageCap} GB`));
    grid.append(panel('Use against its caps', u, hint('Storage is measured here, once a minute. It is not in the table.')));
    pane.append(grid);
  }
  function envPlan(pane, e) {
    const f = h('form', 'sdk-form hc-form');
    f.addEventListener('submit', (ev) => { ev.preventDefault(); status('Saved (a picture).'); });
    const caps = h('div', 'hc-fields');
    caps.append(
      field('Members', input(String(e.memCap), 'no cap', 'number')), field('Storage (GB)', input(String(e.storageCap), 'no cap', 'number')),
      field('AI calls a month', input(String(e.aiCap), 'no cap', 'number')), field('Calls at once', input(String(e.callsCap), 'no cap', 'number')),
    );
    const mods = h('fieldset', 'hc-fieldset'); mods.append(h('legend', 'sdk-label', 'Modules it runs'));
    const all = e.mods.length === MODULES.length;
    for (const [id, label] of [['all', 'All installed'], ['list', 'Only these']]) {
      const l = h('label', 'sdk-choice-row'); const r = h('input'); r.type = 'radio'; r.name = `mods-${e.slug}-${count()}`; r.checked = (id === 'all') === all;
      l.append(r, h('span', 'sdk-choice-text', label)); mods.append(l);
    }
    const list = h('div', 'hc-checks'); for (const m of MODULES) list.append(check(m.name, e.mods.includes(m.id)));
    mods.append(list);
    const row = h('div', 'hc-actions'); const save = btn('Save', { cls: 'btn btn-primary' }); save.type = 'submit'; row.append(save);
    f.append(field('Plan', select(PLANS.map((p) => [p.id, p.name]), e.plan)), h('p', 'sdk-label hc-sub', 'Its own caps (empty means no cap)'), caps, mods, row);
    pane.append(panel('Plan and modules', f));
  }
  function envTemplate(pane, e) {
    const t = TEMPLATES.find((x) => x.id === e.template);
    const made = h('div', 'hc-stack');
    made.append(facts([['Made from', t ? link(t.name, () => openTpl(t.id)) : 'No template'], ['Skipped', e.plan === 'free' ? 'Two modules (the Free plan runs six)' : 'Nothing']]));
    const sw = h('div', 'hc-inline');
    const sel = select([...TEMPLATES.map((x) => [x.id, x.name]), ['none', 'No template']], e.template); sel.setAttribute('aria-label', 'Template');
    sw.append(sel, btn('Switch template', { onClick: () => ask({ title: `Switch to the ${sel.selectedOptions[0].textContent} template?`, message: 'Words and icons change now. Nothing is turned off or removed. Then you choose what else it turns on.', action: 'Switch' }, 'Switched (a picture). The offer shows below.') }));
    made.append(sw);
    pane.append(panel('Template', made));
    const offer = h('div', 'hc-stack');
    const ban = banner('info', 'gift', 'The Travel template has a new version. It offers 2 modules and a new Lobby.', S.offer ? '' : 'Review');
    const rv = ban.querySelector('.sdk-banner-action');
    if (rv) rv.addEventListener('click', () => { S.offer = true; draw(); });
    offer.append(ban);
    if (S.offer) {
      offer.append(check('Places (new)', true), check('Maps (new)', true, false), check('A Lobby called "Base camp"'), check('The Travel icons'));
      const row = h('div', 'hc-actions');
      row.append(btn('Apply', { cls: 'btn btn-primary', onClick: () => { S.offer = false; S.log = 'Applied (a picture).'; draw(); } }), btn('Not now', { onClick: () => { S.offer = false; draw(); } }));
      offer.append(row);
    }
    pane.append(panel('What the template offers', offer));
  }
  const banner = (kind, icon, text, action) => {
    const b = h('div', 'sdk-banner'); b.dataset.kind = kind; b.setAttribute('role', 'status');
    const ic = h('span', 'sdk-banner-icon'); ic.setAttribute('aria-hidden', 'true'); ic.append(fa(icon));
    b.append(ic, h('span', 'sdk-banner-text', text));
    if (action) b.append(btn(action, { cls: 'btn btn-small sdk-banner-action' }));
    return b;
  };
  function envOwners(pane, e) {
    const tb = h('tbody');
    for (const o of e.owners) {
      const tr = h('tr');
      const n = h('th', ''); n.scope = 'row'; n.append(o.name, h('span', 'sdk-table-sub', o.login));
      const s = h('td'); s.append(o.twoStep ? chip('ok', 'On') : chip('neutral', 'Off'));
      const a = h('td', 'hc-more-cell');
      a.append(btn('Reset second factor', { cls: 'btn btn-small', onClick: () => ask({ title: `Reset ${o.name}'s second factor?`, message: `${o.login} signs in with the password alone next time, then sets up an authenticator app again.`, action: 'Reset', kind: 'destructive' }, `Reset for ${o.login} (a picture).`) }));
      tr.append(n, s, a); tb.append(tr);
    }
    const { wrap } = tableIn('Owners', [['Owner'], ['Two-step'], ['', 'hc-more-col']], tb);
    const by = h('div', 'hc-inline');
    by.append(input('', 'their login'), btn('Reset by login', { onClick: () => status('Type a login first (a picture).') }));
    by.firstChild.setAttribute('aria-label', 'Owner login');
    pane.append(panel('Owners and two-step', hint('An owner locked out of their authenticator app: reset their second factor.'), wrap, h('p', 'sdk-label hc-sub', 'Or by login'), by));
  }
  function envBackups(pane, e) {
    const dl = h('div', 'hc-stack'); dl.append(hint('A zip of everything in this environment.'), btn('Download a backup', { icon: 'download', onClick: () => status(`Backup of ${e.name}: a zip would download.`) }));
    const rs = h('div', 'hc-stack');
    const file = h('input'); file.type = 'file'; file.accept = '.zip'; file.setAttribute('aria-label', 'Backup file');
    rs.append(hint('Replaces what is in the environment with the backup.'), file, btn('Restore a backup', { cls: 'btn btn-danger', icon: 'rotate-left', onClick: () => ask({ title: `Restore ${e.name} from a backup?`, message: 'What is there now is replaced by the backup. This cannot be undone.', action: 'Restore', kind: 'destructive' }, 'Restored (a picture).') }));
    pane.append(panel('Download', dl), panel('Restore', rs), hint('Backups are a download. Nothing is kept on the host, and there is no schedule.'));
  }
  function envDanger(pane, e) {
    const row = (title, text, button) => { const r = h('div', 'hc-danger-row'); const t = h('div', 'hc-danger-text'); t.append(h('b', '', title), h('span', 'sdk-hint', text)); r.append(t, button); return r; };
    const sus = e.status === 'suspended';
    const box = h('div', 'hc-stack');
    box.append(
      row(sus ? 'Resume' : 'Suspend', sus ? 'People can open it again.' : 'No one can open it. Nothing is removed.', btn(sus ? 'Resume' : 'Suspend', { onClick: () => rowMenuAct(e, sus) })),
      row('Delete this environment', 'It is moved aside, not erased.', btn('Delete', { cls: 'btn btn-danger', icon: 'trash', onClick: () => deleteEnv(e) })),
    );
    pane.append(panel('Danger zone', box));
  }
  const rowMenuAct = (e, sus) => (sus
    ? ask({ title: `Resume ${e.name}?`, message: 'People can open it again.', action: 'Resume' }, `${e.name} resumed (a picture).`)
    : ask({ title: `Suspend ${e.name}?`, message: 'No one can open it until you resume it. Nothing is removed.', action: 'Suspend', kind: 'destructive' }, `${e.name} suspended (a picture).`));

  // ======== Templates ========
  function drawTemplates() {
    main.append(pageHead('Templates', btn('Import file', { icon: 'file-import' }), btn('New template', { cls: 'btn btn-primary', icon: 'plus' })));
    const outdated = TEMPLATES.filter((t) => t.update);
    for (const t of outdated) { const b = banner('info', 'gift', `The ${t.name} template has a new version.`, 'Review'); main.append(b); }
    const tb = h('tbody');
    for (const t of TEMPLATES) {
      const tr = h('tr'); tr.tabIndex = 0; tr.dataset.id = t.id;
      tr.addEventListener('click', (ev) => { if (!ev.target.closest('button, a, input')) openTpl(t.id); });
      tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target === tr) openTpl(t.id); });
      const n = h('th', 'hc-name-cell'); n.scope = 'row';
      const a = link(t.name, () => openTpl(t.id)); n.append(a, h('span', 'sdk-table-sub', t.id));
      const k = h('td'); k.append(chip('neutral', t.kind === 'bundled' ? 'Bundled' : 'Own', false)); if (t.edited) k.append(chip('info', 'Edited', false));
      const v = h('td', 'sdk-table-dim', `v${t.version}`);
      const used = h('td', 'hc-used'); const list = usedBy(envs(), t.id);
      if (!list.length) used.append(h('span', 'sdk-table-dim', 'None'));
      list.slice(0, 4).forEach((e, i) => { if (i) used.append(h('span', 'hc-sep', ', ')); used.append(link(e.name, () => openEnv(e.slug))); });
      if (list.length > 4) used.append(` and ${list.length - 4} more`);
      const hid = h('td'); hid.append(switchBox(`Hide ${t.name} from new environments`, t.hidden));
      const mo = h('td', 'hc-more-cell');
      const more = iconBtn('ellipsis', `More for ${t.name}`, () => openHostMenu(more, [
        { label: 'Edit', icon: 'pen', onPick: () => openTpl(t.id) }, { label: 'Export', icon: 'file-export', onPick: () => status(`Exported ${t.name} (a picture).`) },
        { label: 'Duplicate', icon: 'copy', onPick: () => status(`Duplicated ${t.name} (a picture).`) },
        ...(t.kind === 'bundled' && t.edited ? [{ label: 'Reset to shipped', icon: 'rotate-left', onPick: () => ask({ title: `Reset ${t.name} to the shipped one?`, message: 'Your changes to it are lost.', action: 'Reset', kind: 'destructive' }, 'Reset (a picture).') }] : []),
        ...(t.kind === 'own' && !list.length ? [{ divider: true }, { label: 'Delete', icon: 'trash', danger: true, onPick: () => ask({ title: `Delete ${t.name}?`, message: 'No environment uses it.', action: 'Delete', kind: 'destructive' }, 'Deleted (a picture).') }] : []),
      ]));
      more.setAttribute('aria-haspopup', 'menu'); mo.append(more);
      tr.append(n, k, v, used, hid, mo); tb.append(tr);
    }
    const { wrap, table } = tableIn('Templates', [['Template'], ['Kind'], ['Version'], ['Used by'], ['Hidden'], ['', 'hc-more-col']], tb);
    table.classList.add('hc-tpls');
    main.append(wrap, statusLine());
  }
  function drawEditor() {
    const t = TEMPLATES.find((x) => x.id === S.tpl) || TEMPLATES[0];
    main.append(btn('Templates', { cls: 'btn btn-quiet btn-small hc-back', icon: 'arrow-left', onClick: () => go('templates') }));
    main.append(pageHead(`Edit ${t.name}`, btn('Save template', { cls: 'btn btn-primary', icon: 'floppy-disk', onClick: () => status('Saved (a picture).') })));
    const shell = h('div', 'hc-editor');
    const jump = h('nav', 'subtabs hc-jump'); jump.setAttribute('aria-label', 'Jump to a part of the template');
    const parts = h('div', 'hc-parts');
    const ids = EDITOR_PARTS.map((n, i) => `${frame.dataset.uid}-ed-${i}`);
    const mkPart = (i, ...kids) => { const p = panel(EDITOR_PARTS[i], ...kids); p.id = ids[i]; p.setAttribute('tabindex', '-1'); return p; };
    const two = (...f) => { const g = h('div', 'hc-fields'); g.append(...f); return g; };
    const modRows = h('div', 'hc-modrows');
    for (const m of MODULES.slice(0, 6)) {
      const r = h('div', 'hc-modrow');
      r.append(check(m.name, true), input(m.name, 'Name shown'), input('', 'Icon'));
      modRows.append(r);
    }
    const chipsOf = (words) => { const c = h('div', 'hc-chips'); for (const w of words) c.append(chip('neutral', w, false)); return c; };
    parts.append(
      mkPart(0, two(field('Id', Object.assign(input(t.id), { readOnly: true })), field('Name', input(t.name))), field('Description', Object.assign(h('textarea'), { value: t.desc, rows: 3 }))),
      mkPart(1, two(field('Space', input('Trip')), field('Spaces', input('Trips')), field('Home', input('My trips')), field('Member', input('Traveller')))),
      mkPart(2, two(field('Icon', select([['suitcase', 'Suitcase'], ['compass', 'Compass'], ['mug-hot', 'Mug']], 'suitcase')))),
      mkPart(3, hint('Which modules a new environment gets, and the name and icon each shows as.'), modRows),
      mkPart(4, two(field('Lobby name', input('Base camp')), field('Opens first', select([['lobby', 'The Lobby'], ['planner', 'The Planner']], 'lobby'))), check('Ask for a profile picture', true)),
      mkPart(5, chipsOf(['Dreaming', 'Booking', 'Packing', 'Travelling', 'Remembering']), btn('Add a phase', { cls: 'btn btn-small', icon: 'plus' })),
      mkPart(6, chipsOf(['Thumbs up', 'Heart', 'Laughing', 'Question']), btn('Add a reaction', { cls: 'btn btn-small', icon: 'plus' })),
      mkPart(7, two(field('Theme file', select([['none', 'None'], ['travel-warm', 'travel-warm.css']], 'travel-warm'))), btn('Check the file', { cls: 'btn btn-small' })),
      mkPart(8, two(field('Icon set', select([['default', 'The default'], ['travel', 'Travel icons']], 'travel')))),
    );
    EDITOR_PARTS.forEach((n, i) => {
      const b = h('button', 'subtab'); b.type = 'button'; b.textContent = n;
      b.addEventListener('click', () => { const p = D.getElementById(ids[i]); p.scrollIntoView({ block: 'start' }); p.focus({ preventScroll: true }); p.classList.add('pp-flash'); setTimeout(() => p.classList.remove('pp-flash'), 900); });
      jump.append(b);
    });
    shell.append(jump, parts);
    main.append(shell, statusLine());
  }

  // ======== Modules (read only) ========
  function drawModules() {
    main.append(pageHead('Modules'));
    main.append(hint('The modules on this host, and how many environments run each. Read only: installing and updating come later.'));
    const all = envs(); const tb = h('tbody');
    for (const m of MODULES) {
      const run = runningModule(all, m.id);
      const tr = h('tr');
      const n = h('th', ''); n.scope = 'row'; n.append(m.name, h('span', 'sdk-table-sub', m.id));
      const v = h('td', 'sdk-table-dim', m.version);
      const c = h('td'); const box = h('div', 'hc-use-row hc-mod-run'); box.append(bar(`${m.name}: environments running it`, run.length, all.length), h('span', 'hc-use-val', `${run.length} of ${all.length}`)); c.append(box);
      tr.append(n, v, c); tb.append(tr);
    }
    const { wrap } = tableIn('Modules', [['Module'], ['Version'], ['Environments running it']], tb);
    main.append(wrap);
  }

  // ======== Plans ========
  function drawPlans() {
    main.append(pageHead('Plans', btn('Add a plan', { icon: 'plus' })));
    main.append(hint('What an environment may use, by plan. Empty means no cap. Free is what sign-up makes, and it cannot be removed.'));
    const all = envs(); const tb = h('tbody');
    for (const p of PLANS) {
      const tr = h('tr');
      const n = h('th', ''); n.scope = 'row'; n.append(input(p.name), h('span', 'sdk-table-sub', p.id)); n.firstChild.setAttribute('aria-label', `${p.name}: name`);
      const cell = (v, label, type = 'number') => { const td = h('td'); const i = input(String(v), 'no cap', type); i.setAttribute('aria-label', `${p.name}: ${label}`); td.append(i); return td; };
      const used = h('td', 'num', String(all.filter((e) => e.plan === p.id).length));
      const rm = h('td', 'hc-more-cell'); rm.append(p.id === 'free' ? h('span', 'sdk-table-dim', 'Kept') : btn('Remove', { cls: 'btn btn-small btn-danger', onClick: () => ask({ title: `Remove the ${p.name} plan?`, message: 'Environments on it keep their caps until you move them.', action: 'Remove', kind: 'destructive' }, 'Removed (a picture).') }));
      tr.append(n, cell(p.members, 'members'), cell(p.storageGb, 'storage in GB'), cell(p.ai, 'AI calls a month'), cell(p.calls, 'calls at once'), cell(p.modules, 'modules', 'text'), used, rm);
      tb.append(tr);
    }
    const { wrap, table } = tableIn('Plans', [['Plan'], ['Members'], ['Storage (GB)'], ['AI calls a month'], ['Calls at once'], ['Modules'], ['Environments', 'num'], ['', 'hc-more-col']], tb);
    table.classList.add('hc-plans');
    const row = h('div', 'hc-actions'); row.append(btn('Save plans', { cls: 'btn btn-primary', onClick: () => status('Saved (a picture).') }));
    main.append(wrap, row, statusLine());
  }

  // ======== Server ========
  function drawServer() {
    main.append(pageHead('Server'));
    const ids = SERVER_PARTS.map((n, i) => `${frame.dataset.uid}-sv-${i}`);
    const jump = h('nav', 'subtabs hc-jump hc-jump-row'); jump.setAttribute('aria-label', 'Jump to a part of the server');
    SERVER_PARTS.forEach((n, i) => { const b = h('button', 'subtab'); b.type = 'button'; b.textContent = n; b.addEventListener('click', () => { const p = D.getElementById(ids[i]); p.scrollIntoView({ block: 'start' }); p.classList.add('pp-flash'); setTimeout(() => p.classList.remove('pp-flash'), 900); }); jump.append(b); });
    main.append(jump);
    const stack = h('div', 'hc-parts');
    const part = (i, ...kids) => { const p = panel(SERVER_PARTS[i], ...kids); p.id = ids[i]; return p; };
    const admins = h('tbody');
    for (const a of HOST_ADMINS) {
      const tr = h('tr'); const n = h('th', ''); n.scope = 'row'; n.append(a.login, a.you ? h('span', 'sdk-table-sub', 'You') : '');
      const s = h('td'); s.append(a.twoStep === 'on' ? chip('ok', 'Two-step on') : chip('neutral', 'Two-step off'));
      const r = h('td', 'hc-more-cell'); r.append(a.you ? h('span', 'sdk-table-dim', '') : btn('Remove', { cls: 'btn btn-small btn-danger', onClick: () => ask({ title: `Remove ${a.login}?`, message: 'They can no longer sign in here.', action: 'Remove', kind: 'destructive' }, 'Removed (a picture).') }));
      tr.append(n, s, r); admins.append(tr);
    }
    const adm = tableIn('Host admins', [['Login'], ['Two-step'], ['', 'hc-more-col']], admins);
    const addAdmin = h('div', 'hc-inline'); addAdmin.append(input('', 'login'), input('', 'password', 'password'), btn('Add a host admin'));
    addAdmin.children[0].setAttribute('aria-label', 'New host admin login'); addAdmin.children[1].setAttribute('aria-label', 'New host admin password');
    const ai = h('div', 'hc-stack');
    for (const [name, offered] of [['OpenAI', true], ['Anthropic', true], ['Other', false]]) {
      const r = h('div', 'hc-ai');
      const hd = h('div', 'hc-ai-head'); hd.append(h('b', '', name), chip(offered ? 'ok' : 'neutral', offered ? 'Offered' : 'Not offered', false));
      r.append(hd, two2(field('Key', input('', offered ? 'set (write only)' : 'not set', 'password')), field('Model', select([['a', 'The default'], ['b', 'The newest']], 'a'))), h('div', 'hc-actions'));
      r.lastChild.append(btn('Save', { cls: 'btn btn-small' }), btn('Refresh models', { cls: 'btn btn-small' }));
      ai.append(r);
    }
    const mt = h('tbody');
    for (const f of MAP_FILES) { const tr = h('tr'); const n = h('th', '', f.name); n.scope = 'row'; const del = h('td', 'hc-more-cell'); del.append(iconBtn('trash', `Delete ${f.name}`, () => ask({ title: `Delete ${f.name}?`, message: 'Maps that use it stop showing that area.', action: 'Delete', kind: 'destructive' }, 'Deleted (a picture).'), 'sdk-icon-btn btn-small btn-danger')); tr.append(n, h('td', 'sdk-table-dim', f.kind), h('td', 'sdk-table-dim', f.zoom), h('td', 'num sdk-table-dim', f.size), del); mt.append(tr); }
    const maps = tableIn('Map files', [['File'], ['Type'], ['Zoom'], ['Size', 'num'], ['', 'hc-more-col']], mt);
    const region = h('div', 'hc-inline'); region.append(input('', 'Find a region'), btn('Find'), btn('Estimate'));
    region.firstChild.setAttribute('aria-label', 'Find a region');
    const flight = h('div', 'hc-stack'); const fi = h('div', 'hc-inline'); fi.append(input('', 'WN 2483'), btn('Forget a flight')); fi.firstChild.setAttribute('aria-label', 'Flight number');
    flight.append(h('p', 'hc-line', 'This server has learned 214 flights from saved trips.'), hint('It keeps the airline, the airports, the times and the terminal, never who flew.'), fi, btn('Clear all', { cls: 'btn btn-small btn-danger', onClick: () => ask({ title: 'Clear every flight it learned?', message: 'Later lookups start from nothing.', action: 'Clear all', kind: 'destructive' }, 'Cleared (a picture).') }));
    const hostFacts = facts([['Base domain', DOMAIN], ['Version', '0.9.4'], ['Environments', String(ENVIRONMENTS.length)], ['Sign-up', chip('ok', 'On')], ['Billing webhook', 'Receives payment news at /api/host/billing; the signing secret is set.']]);
    const mfa = h('div', 'hc-stack'); mfa.append(h('p', 'hc-line', ''), (() => { const r = h('div', 'hc-inline'); r.append(chip('ok', 'On'), btn('Turn off', { cls: 'btn btn-small' }), btn('Reset', { cls: 'btn btn-small' })); return r; })());
    mfa.firstChild.textContent = 'You sign in with a password and an authenticator app.';
    stack.append(part(0, hostFacts), part(1, mfa), part(2, adm.wrap, addAdmin), part(3, ai), part(4, maps.wrap, h('p', 'sdk-label hc-sub', 'A region cut from the world file'), region), part(5, flight));
    main.append(stack, statusLine());
  }
  const two2 = (...f) => { const g = h('div', 'hc-fields'); g.append(...f); return g; };

  const api = { el: frame, go, openEnv, redraw: draw, state: S };
  frame.dataset.uid = `hc${++uidn}`;
  draw();
  return api;
}
let uidn = 0;

// ---- the section ----
const main = D.getElementById('pp-main');
const sec = h('section', 'pp-group hc-section');
sec.id = 'pp-host-console';
sec.setAttribute('aria-labelledby', 'pp-host-console-name');
const title = h('h2', 'pp-group-name', 'Host console: the whole console, every screen');
title.id = 'pp-host-console-name';
sec.append(title, h('p', 'pp-state-note', 'The host console as the plan draws it (plan-host-console.md, slice 1): a left navigation, the Environments table with a needs-attention strip, one page per environment, Templates with their editor, Modules, Plans and Server. All of it is invented and nothing is saved; the buttons that change something ask first, in the real dialog. The first console is as wide as the width switch at the top (choose 1280 to see it wide); the second is always the 390 pixel phone, where the left navigation becomes the tab strip the console has now. Both work: open a row, a tab, a menu.'));

const state = { count: 30 };
const consoles = [];
const bar2 = h('div', 'hc-bar');
bar2.append(h('span', 'hc-bar-label', 'Environments:'));
const sw = h('div', 'mf-switch'); sw.setAttribute('role', 'radiogroup'); sw.setAttribute('aria-label', 'How many environments');
function drawSwitch() {
  sw.textContent = '';
  for (const n of [30, 6]) {
    const b = h('button', 'mf-switch-btn'); b.type = 'button'; b.dataset.key = `hccount:${n}`;
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(state.count === n)); b.tabIndex = state.count === n ? 0 : -1;
    b.append(h('span', '', `${n}`));
    b.addEventListener('click', () => { state.count = n; drawSwitch(); for (const c of consoles) c.redraw(); sw.querySelector('[aria-checked="true"]').focus(); });
    sw.append(b);
  }
}
drawSwitch();
bar2.append(sw);
sec.append(bar2);

const jump = h('nav', 'pp-jump'); jump.setAttribute('aria-label', 'Jump to a screen of the Host console');
jump.append(h('span', 'pp-jump-label', 'Show'));
const SHOWS = [
  ['Environments', (c) => c.go('environments')], ['New environment', (c) => c.go('new')],
  ['An environment', (c) => c.openEnv('the-long-table')], ['Plan and modules', (c) => c.openEnv('harbour-club', 'plan')], ['Template', (c) => c.openEnv('lisbon-trip', 'template')],
  ['Owners', (c) => c.openEnv('harbour-club', 'owners')], ['Backups', (c) => c.openEnv('harbour-club', 'backups')], ['Danger zone', (c) => c.openEnv('old-book-club', 'danger')],
  ['Templates', (c) => c.go('templates')], ['Template editor', (c) => c.go('editor', { tpl: 'travel' })], ['Modules', (c) => c.go('modules')], ['Plans', (c) => c.go('plans')], ['Server', (c) => c.go('server')],
];
const slots = [];
for (const [name, fn] of SHOWS) {
  const b = h('button', 'btn btn-small', name); b.type = 'button';
  b.addEventListener('click', () => { for (const c of consoles) fn(c); slots[0]?.scrollIntoView({ block: 'start' }); });
  jump.append(b);
}
sec.append(jump);

for (const [name, note, width] of [['Wide', 'As wide as the width switch at the top.', 0], ['Phone, 390 wide', 'Always 390 wide: the navigation is the tab strip, tables scroll inside themselves, taps are 44 pixels.', 390]]) {
  const st = h('section', 'pp-state');
  const hh = h('h3', 'pp-state-name', name);
  slots.push(hh);
  const c = createConsole({ count: () => state.count, width });
  consoles.push(c);
  st.append(hh, h('p', 'pp-state-note', note), c.el);
  sec.append(st);
}
main.append(sec);
const pageJump = D.querySelector('nav.pp-jump[aria-label="Jump to a section of the page"]');
if (pageJump) {
  const b = h('button', 'btn btn-small', 'Host console'); b.type = 'button';
  b.addEventListener('click', () => D.getElementById('pp-host-console-name')?.scrollIntoView({ block: 'start' }));
  pageJump.append(b);
}
if (location.hash === '#pp-host-console') requestAnimationFrame(() => D.getElementById('pp-host-console-name')?.scrollIntoView({ block: 'start' }));
