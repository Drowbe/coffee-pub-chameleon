// The Budget module: a space's costs, each with a planned and a paid amount, a category, who paid and a date. It shows the
// space's target against what is spent, each category, the target left over time (the burndown), the costs themselves and who
// owes whom. The costs live in the module's store (see budget-lib.js); the target is the space's own (host.space().budget),
// which only the space's owner, the admin and its moderators may change. Everyone who may see this module reads it. This page
// draws into the markup in budget.html by cloning its templates and filling their [data-slot] and [data-icon] hooks. Nothing
// here names another module: other modules reach it through its `addCost` action and by pointing at a cost.
(async () => {
  'use strict';

  // This module runs in a frame (the SDK is a global) or in the page (its SDK is handed to its script); either way it looks
  // elements up in host.root, never in document.
  const host = (document.currentScript && document.currentScript.host) || window.host;
  const root = host.root;
  const word = host.util.word; // the environment's word for a level or role (host.locale().words)
  const $ = (id) => root.getElementById(id);
  // States: loading is the skeleton in #loading; a failure or a plain notice is the block in #msg (.sdk-empty: an icon, a heading, a line,
  // and Retry on a failure, data-kind="error").
  function showMsg(title, text, retry) {
    $('loading').hidden = true;
    const m = $('msg');
    const icon = document.createElement('span');
    icon.className = 'ic';
    host.ui.icon(retry ? 'triangle-exclamation' : 'circle-info').then((svg) => { icon.innerHTML = svg; }).catch(() => {});
    const head = document.createElement('h2');
    head.className = 'sdk-empty-title';
    head.textContent = title;
    const parts = [icon, head];
    if (text) {
      const line = document.createElement('p');
      line.className = 'sdk-empty-text';
      line.textContent = text;
      parts.push(line);
    }
    if (retry) {
      const actions = document.createElement('div');
      actions.className = 'sdk-empty-actions';
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'btn';
      again.textContent = 'Retry';
      again.addEventListener('click', () => { m.hidden = true; $('loading').hidden = false; retry(); });
      actions.append(again);
      parts.push(actions);
    }
    m.replaceChildren(...parts);
    if (retry) m.dataset.kind = 'error'; else delete m.dataset.kind;
    m.hidden = false;
  }

  let info;
  try {
    info = await host.ready();
  } catch (err) {
    showMsg('Budget could not start', err.message, () => location.reload());
    return;
  }
  if (info.context.scope !== 'space') {
    showMsg(`${info.module.name} opens in ${word('space', { a: true })}.`);
    return;
  }
  /*__LIB__*/

  const canEdit = host.can('edit');
  const ns = 'http://www.w3.org/2000/svg';

  // --- state ---------------------------------------------------------------------------------------------------------
  const state = {
    costs: new Map(), // id -> { cost, version }
    people: [], // [{ key, name }]
    cats: DEFAULT_CATS,
    target: host.space() && host.space().budget ? host.space().budget : null, // { amount?, currency? } or null
    canTarget: false, // may this person change the target (owner, admin, a moderator of this space)
    view: 'overview',
    groupBy: 'day',
    sort: 'date-asc',
    category: '',
    payer: '',
    text: '',
    loaded: false,
    pulled: [], // costs read from other modules' objects (never stored here); see refreshPulled
    withheld: 0, // priced objects the server left out because this person may not read their module
    editing: null, // { id | null, version, opened, conflict }
  };
  const nameOf = (key) => (state.people.find((p) => p.key === key) || {}).name || '';
  const nameOrLeft = (key) => nameOf(key) || 'Someone who left';
  const ownCosts = () => [...state.costs.values()].map((x) => x.cost);
  const costs = () => allCosts(ownCosts(), state.pulled, state.cats); // Budget's own and the pulled-in ones, each counted once
  const serverCurrency = () => (host.locale() && host.locale().currency) || 'USD';
  const currencyCode = () => (state.target && state.target.currency) || serverCurrency();
  const money = (n, code) => host.util.money(n, code || currencyCode());

  // --- small helpers ---------------------------------------------------------------------------------------------------
  const clone = (id) => $(id).content.firstElementChild.cloneNode(true);
  const hide = (node, yes) => { if (node) node.hidden = Boolean(yes); };
  const slot = (el, name) => (el.dataset.slot === name ? el : el.querySelector(`[data-slot="${name}"]`));
  function fill(el, values) {
    for (const [name, value] of Object.entries(values)) {
      const s = slot(el, name);
      if (!s) continue;
      s.textContent = value == null ? '' : String(value);
      s.hidden = value === '' || value == null;
    }
  }
  const iconSvg = new Map();
  const iconWait = new Map();
  function wantIcon(name) {
    if (iconSvg.has(name)) return Promise.resolve(iconSvg.get(name));
    if (!iconWait.has(name)) iconWait.set(name, host.ui.icon(name).then((svg) => { iconSvg.set(name, svg); return svg; }).catch(() => { iconSvg.set(name, ''); return ''; }));
    return iconWait.get(name);
  }
  // Icons not here yet are waited for once per scan, together (a scan per pending icon would scan itself 2^n times).
  function hydrate(scope) {
    const pending = new Set();
    for (const el of scope.querySelectorAll('[data-icon]')) {
      const name = el.dataset.icon;
      if (!name || el.dataset.shown === name) continue;
      if (iconSvg.has(name)) { el.innerHTML = iconSvg.get(name); el.dataset.shown = name; } else pending.add(name);
    }
    if (pending.size) Promise.all([...pending].map(wantIcon)).then(() => hydrate(scope));
  }
  const setIcon = (node, name) => { if (node) { node.dataset.icon = name || ''; delete node.dataset.shown; node.textContent = ''; } };
  const say = (text) => { if (text && host.ui && host.ui.toast) host.ui.toast(String(text)).catch(() => {}); };
  const svgEl = (tag, attrs, text) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
    if (text !== undefined) el.textContent = text;
    return el;
  };

  // Days in words: "Oct 14", and with the weekday for a heading ("Tue, Oct 14"); the year only when it is not this one.
  const dayDate = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd); };
  const thisYear = new Date().getFullYear();
  const dayShort = (d) => { const x = dayDate(d); return x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(x.getFullYear() !== thisYear ? { year: 'numeric' } : {}) }); };
  const dayLong = (d) => { const x = dayDate(d); return x.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(x.getFullYear() !== thisYear ? { year: 'numeric' } : {}) }); };
  const today = () => host.util.ymd(new Date());

  // --- the cost store ----------------------------------------------------------------------------------------------------
  const remember = (id, value, version) => {
    const c = value ? cleanCost(id, value) : null;
    if (c) state.costs.set(id, { cost: c, version }); else state.costs.delete(id);
  };
  async function loadCosts() {
    state.costs.clear();
    for (const it of await host.storage.list(COST_PREFIX)) remember(it.key.slice(COST_PREFIX.length), it.value, it.version);
  }
  host.on('change', (e) => {
    if (!String(e.key).startsWith(COST_PREFIX) || e.scope === 'spaces' || e.scope === 'person' || e.scope === 'environment') return;
    remember(String(e.key).slice(COST_PREFIX.length), e.deleted ? null : e.value, e.version);
    if (state.loaded) render();
  });
  // Many at once (a Clear, its Undo): kept in one pass, drawn once. Keys only (a big event comes without values): read again.
  host.on('changes', (e) => {
    if (e.scope === 'spaces' || e.scope === 'person' || e.scope === 'environment') return;
    const list = (Array.isArray(e.changes) ? e.changes : []).filter((c) => String(c.key).startsWith(COST_PREFIX));
    if (!list.length) return;
    if (list.some((c) => !c.deleted && c.value === undefined)) { if (state.loaded) loadCosts().then(render).catch(() => {}); return; }
    for (const c of list) remember(String(c.key).slice(COST_PREFIX.length), c.deleted ? null : c.value, c.version);
    if (state.loaded) render();
  });
  const pointer = (id) => host.objects.make('cost', id);
  async function saveCost(c, version) {
    const id = c.id && c.id !== 'new' ? c.id : host.util.id();
    const value = costValue(c, catRow(state.cats, c.category).label);
    const saved = await host.storage.set(COST_PREFIX + id, value, version === undefined ? {} : { version });
    const cost = cleanCost(id, value);
    state.costs.set(id, { cost, version: saved && saved.version });
    if (cost.ref) host.objects.setLinks(pointer(id), [cost.ref]).catch(() => {});
    render();
    return cost;
  }
  async function removeCost(id) {
    const had = state.costs.get(id);
    await host.storage.delete(COST_PREFIX + id, had ? { version: had.version } : {});
    state.costs.delete(id);
    host.objects.setLinks(pointer(id), []).catch(() => {});
    render();
  }

  // --- costs pulled in from other modules ---------------------------------------------------------------------------------
  // Read from what the other modules in this space offer as priced objects (host.objects.priced: only what this person may read,
  // and a count of what was left out). Never copied into this module's storage, so turning Budget off or on loses and doubles
  // nothing. Asked on load, when the window is focused or shown again, and every 30 seconds.
  let pulledSig = '';
  async function refreshPulled() {
    if (!host.objects || !host.objects.priced) return;
    let answer;
    try { answer = await host.objects.priced(); } catch (err) { return; } // keep what is shown; the next look asks again
    const pulled = pulledCosts(answer && answer.summaries, info.module.id);
    const withheld = answer && Number(answer.withheld) > 0 ? Number(answer.withheld) : 0;
    const sig = JSON.stringify([pulled, withheld]);
    if (sig === pulledSig) return;
    pulledSig = sig;
    state.pulled = pulled;
    state.withheld = withheld;
    if (state.loaded) render();
  }
  const openSource = (c) => host.objects.open(c.ref).catch((err) => say(err && err.message ? err.message : 'It could not be opened.'));

  // --- the pieces of the page ---------------------------------------------------------------------------------------------
  const fit = () => {
    const w = host.rootElement.clientWidth;
    if (!w) return;
    const narrow = w < 520;
    if ($('app').classList.contains('narrow') !== narrow) $('app').classList.toggle('narrow', narrow);
    if (state.loaded && state.view === 'overview' && chartWidth() !== drawnWidth) drawChart();
  };

  const views = { overview: 'view-overview', costs: 'view-costs', settle: 'view-settle' };
  const settleOn = () => settleShows(costs(), state.people.map((p) => p.key));
  const VIEW_OPTIONS = () => [
    { id: 'overview', label: 'Overview', icon: 'chart-line' },
    { id: 'costs', label: 'Costs', icon: 'list' },
    ...(settleOn() ? [{ id: 'settle', label: 'Settle up', icon: 'scale-balanced' }] : []),
  ];
  let viewSwitch = null;
  function showView(next) {
    state.view = next;
    try { localStorage.setItem('budget-view', next); } catch (err) { /* not remembered */ }
    host.menu.close();
    render();
  }

  // The state of this space's money, drawn from the costs, the target and the settings.
  function render() {
    if (!state.loaded) return;
    if (state.view === 'settle' && !settleOn()) state.view = 'overview';
    viewSwitch.set(state.view, VIEW_OPTIONS());
    for (const [id, el] of Object.entries(views)) hide($(el), id !== state.view);
    if (state.view === 'overview') renderOverview();
    else if (state.view === 'costs') renderCosts();
    else renderSettle();
    if (state.view !== 'costs') syncToolbar([], []);
    for (const n of root.querySelectorAll('[data-slot="withheld-note"]')) fill(n, { 'withheld-note': withheldNote(state.withheld) });
    hydrate(root);
    chrome();
  }

  // --- Overview --------------------------------------------------------------------------------------------------------
  function sumRow(label, value, over) {
    const el = clone('tpl-sum');
    fill(el, { label, value });
    if (over) slot(el, 'value').classList.add('over');
    return el;
  }
  function renderOverview() {
    const all = costs();
    const tv = targetView(state.canTarget, state.target);
    const t = totals(all, tv.amount);
    const tile = $('target-tile');
    const big = slot(tile, 'big');
    big.classList.toggle('over', t.over);
    big.textContent = '';
    if (tv.amount) {
      big.append(money(t.spent), ' ');
      const of = document.createElement('span');
      of.className = 'of';
      of.textContent = `of ${money(tv.amount)}`;
      big.append(of);
    } else big.textContent = `${money(t.spent)} spent`;
    const bar = $('target-bar');
    hide(bar, !tv.amount);
    if (tv.amount) {
      const pct = (x) => `${Math.max(0, Math.min(100, (x / tv.amount) * 100)).toFixed(1)}%`;
      $('bar-spent').style.setProperty('--pct', pct(t.spent));
      $('bar-expected').style.setProperty('--pct', pct(t.expected));
      bar.classList.toggle('over', t.over);
      bar.setAttribute('aria-valuenow', String(Math.round(Math.min(100, (t.spent / tv.amount) * 100))));
      bar.setAttribute('aria-valuetext', t.over ? `Over by ${money(Math.abs(t.left))}: ${money(t.spent)} of ${money(tv.amount)} spent` : `${money(t.spent)} of ${money(tv.amount)} spent`);
    }
    const sums = [sumRow('Planned', money(t.planned)), sumRow('Paid', money(t.spent)), sumRow('Expected', money(t.expected))];
    if (tv.amount) sums.push(sumRow(t.over ? 'Over by' : 'Left', money(Math.abs(t.left)), t.over));
    $('sums').replaceChildren(...sums);
    const btn = $('target-edit');
    hide(btn, !tv.action);
    if (tv.action) fill(btn, { label: tv.action === 'edit' ? 'Edit target' : 'Set a target' });
    fill(tile, { 'target-note': tv.amount ? '' : tv.readOnly ? 'No target is set yet.' : 'A target lets you see how much is left.' });

    // each category: planned behind, paid in front, both in the category's own colour
    const rows = byCategory(all, state.cats).filter((r) => r.count);
    const scale = Math.max(...rows.map((r) => Math.max(r.planned, r.actual)), 0.01);
    hide($('cats-tile'), false);
    if (!rows.length) {
      const none = document.createElement('p');
      none.className = 'hint';
      none.textContent = 'No costs yet.';
      $('cat-rows').replaceChildren(none);
    } else {
      $('cat-rows').replaceChildren(...rows.map((r) => {
        const el = clone('tpl-cat-row');
        el.style.setProperty('--tone', toneOf(state.cats, r.id));
        setIcon(el.querySelector('[data-icon]'), r.icon);
        const text = r.actual && r.planned ? `${money(r.actual)} of ${money(r.planned)}` : r.actual ? `${money(r.actual)} paid` : `${money(r.planned)} planned`;
        fill(el, { name: `${r.label} · ${r.count}`, amount: text });
        el.querySelector('.sdk-progress-planned').style.setProperty('--pct', `${((r.planned / scale) * 100).toFixed(1)}%`);
        el.querySelector('.sdk-progress-fill').style.setProperty('--pct', `${((r.actual / scale) * 100).toFixed(1)}%`);
        const catBar = el.querySelector('.cat-bar');
        catBar.setAttribute('aria-label', `${r.label}: ${text}`);
        catBar.setAttribute('aria-valuenow', String(Math.round((r.actual / scale) * 100)));
        catBar.setAttribute('aria-valuetext', text);
        return el;
      }));
    }
    drawChart();
  }

  // --- the burndown ------------------------------------------------------------------------------------------------------
  let drawnWidth = 0;
  const chartWidth = () => Math.floor($('chart').clientWidth || 0);
  function drawChart() {
    const tv = targetView(state.canTarget, state.target);
    const box = $('chart');
    const words = $('burn-words');
    const legend = $('legend');
    const b = burndown(costs(), { target: tv.amount, dates: (host.space() && host.space().phases) || {} });
    if (!b) {
      box.replaceChildren();
      legend.replaceChildren();
      drawnWidth = 0;
      words.textContent = !tv.amount ? (tv.readOnly ? 'No target is set yet, so there is nothing to count down from.' : 'Set a target to see it counted down over time.') : 'Add a cost with a date, or set dates for the phases, to see it counted down over time.';
      return;
    }
    const W = Math.max(240, chartWidth() || 320);
    drawnWidth = chartWidth();
    const H = W < 400 ? 190 : 230;
    const m = { l: 56, r: 12, t: 12, b: 26 };
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const lowV = Math.min(b.low, 0);
    const span = b.high - lowV || 1;
    const y = (v) => m.t + ((b.high - v) / span) * ph;
    const n0 = dayNum(b.from);
    const n1 = dayNum(b.to);
    const x = (d) => m.l + ((dayNum(d) - n0) / (n1 - n0 || 1)) * pw;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Chart of the target left over time. The same is written out below it.' });
    // the phases behind it, when the space has dates for them
    let bands = [];
    try { bands = host.util.phaseTimeline ? host.util.phaseTimeline() : []; } catch (err) { bands = []; }
    for (const band of bands.filter((p) => p.dated && p.start)) {
      const s = band.start < b.from ? b.from : band.start;
      const e = !band.end || band.end > b.to ? b.to : band.end;
      if (s > e) continue;
      const x0 = x(s);
      const x1 = Math.max(x(e), x0 + 2);
      const r = svgEl('rect', { class: 'band', x: x0, y: m.t, width: x1 - x0, height: ph });
      r.style.fill = `var(--tint-${band.tint || 'blue'})`;
      svg.append(r);
      if (x1 - x0 > band.label.length * 6.5 + 8) svg.append(svgEl('text', { x: x0 + 4, y: m.t + 11 }, band.label));
    }
    // the guides and the numbers on the left: the target, the middle, zero (and the lowest point when it is over)
    const marks = [b.high, b.high / 2, 0, ...(lowV < 0 ? [lowV] : [])];
    for (const v of marks) {
      svg.append(svgEl('line', { class: v === 0 && lowV < 0 ? 'zero' : 'grid', x1: m.l, x2: m.l + pw, y1: y(v), y2: y(v) }));
      svg.append(svgEl('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, money(v).replace(/\.00$/, '')));
    }
    svg.append(svgEl('line', { class: 'axis', x1: m.l, x2: m.l, y1: m.t, y2: m.t + ph }));
    svg.append(svgEl('text', { x: m.l, y: H - 6, 'text-anchor': 'start' }, dayShort(b.from)));
    svg.append(svgEl('text', { x: m.l + pw, y: H - 6, 'text-anchor': 'end' }, dayShort(b.to)));
    const now = today();
    if (now > b.from && now < b.to) {
      svg.append(svgEl('line', { class: 'today', x1: x(now), x2: x(now), y1: m.t, y2: m.t + ph }));
      svg.append(svgEl('text', { x: Math.min(x(now), m.l + pw - 14), y: H - 6, 'text-anchor': 'middle' }, 'Today'));
    }
    // a step line: flat until a payment, then straight down
    const path = (points) => {
      let d = `M ${x(points[0].day)} ${y(points[0].remaining)}`;
      for (const p of points.slice(1)) d += ` H ${x(p.day)} V ${y(p.remaining)}`;
      return `${d} H ${m.l + pw}`;
    };
    if (b.endExpected !== b.endActual || b.expected.length !== b.actual.length) svg.append(svgEl('path', { class: 'line-expected', d: path(b.expected) }));
    svg.append(svgEl('path', { class: 'line-paid', d: path(b.actual) }));
    for (const p of b.actual.slice(1)) {
      const dot = svgEl('circle', { class: 'dot', cx: x(p.day), cy: y(p.remaining), r: 3 });
      dot.append(svgEl('title', {}, `${dayShort(p.day)}: ${money(p.remaining)} left`));
      svg.append(dot);
    }
    box.replaceChildren(svg);
    const keys = [['Paid', ''], ...(b.endExpected !== b.endActual || b.expected.length !== b.actual.length ? [['If all planned is spent', 'expected']] : [])];
    legend.replaceChildren(...keys.map(([label, cls]) => { const li = clone('tpl-legend'); if (cls) li.classList.add(cls); fill(li, { label }); return li; }));
    words.textContent = burndownWords(b, dayShort, money);
  }

  // --- Costs ---------------------------------------------------------------------------------------------------------------
  const SORT_WORDS = { 'date-asc': 'Date, earliest first', 'date-desc': 'Date, latest first', 'amount-desc': 'Amount, largest first', 'amount-asc': 'Amount, smallest first', title: 'Title, A to Z' };
  function costRow(c) {
    const el = clone('tpl-cost');
    el.dataset.id = c.id;
    if (c.pulled) el.classList.add('pulled');
    const r = catRow(state.cats, c.category);
    el.style.setProperty('--tone', toneOf(state.cats, c.category));
    setIcon(el.querySelector('.mark [data-icon]'), r.icon);
    const sub = [r.label, c.date ? dayShort(c.date) : '', c.paidBy ? `Paid by ${nameOrLeft(c.paidBy)}` : ''].filter(Boolean).join(' · ');
    const paid = c.actual ? money(c.actual) : '';
    fill(el, {
      title: c.title,
      sub,
      amount: paid || (c.planned ? money(c.planned) : 'No amount'),
      planned: c.pulled
        ? (c.actual ? (c.estimate ? `estimated ${money(c.estimate)}` : '') : c.planned ? 'estimated' : '')
        : c.actual ? (c.planned ? `of ${money(c.planned)} planned` : '') : c.planned ? 'planned' : '',
      source: c.pulled ? `From ${c.source.name}` : '',
    });
    el.querySelector('.cost-main').setAttribute('aria-label', `${c.title}, ${sub}, ${paid ? `${paid} paid` : c.planned ? `${money(c.planned)} ${c.pulled ? 'estimated' : 'planned'}` : 'no amount'}.${c.pulled ? ` From ${c.source.name}. Open in ${c.source.name}` : ` ${canEdit ? 'Change it' : 'Open it'}`}`);
    return el;
  }
  function renderCosts() {
    const all = costs();
    const people = [{ key: '', label: 'Anyone paid' }, { key: '-', label: 'Nobody paid yet' }, ...state.people.map((p) => ({ key: p.key, label: `Paid by ${p.name}` }))];
    if (state.payer && !people.some((p) => p.key === state.payer)) state.payer = '';
    if (state.category && !state.cats.some((c) => c.id === state.category)) state.category = '';
    syncToolbar(all, people);
    const host_ = $('groups');
    if (!all.length) {
      const el = clone('tpl-state');
      fill(el, { title: 'No costs yet', text: 'Add what you expect to spend and what you have paid. Each one can have a category, a date and who paid.' });
      const add = el.querySelector('[data-action="add"]');
      hide(add, !canEdit);
      add.addEventListener('click', () => openEditor(null));
      host_.replaceChildren(el);
      return;
    }
    const shown = sortCosts(filterCosts(all, state.cats, { category: state.category, payer: state.payer, text: state.text }), state.sort);
    if (!shown.length) {
      const el = clone('tpl-state');
      fill(el, { title: 'Nothing matches', text: 'No cost matches what you chose.' });
      setIcon(el.querySelector('.ic'), 'magnifying-glass');
      hide(el.querySelector('[data-action="add"]'), true);
      host_.replaceChildren(el);
      return;
    }
    host_.replaceChildren(...groupCosts(shown, state.cats, state.groupBy, state.sort === 'date-desc' ? 'desc' : 'asc').map((g) => {
      const el = clone('tpl-group');
      const first = g.costs[0];
      setIcon(el.querySelector('[data-icon]'), state.groupBy === 'category' ? catRow(state.cats, first.category).icon : 'calendar-day');
      fill(el, { title: state.groupBy === 'category' ? g.label : g.key ? dayLong(g.key) : 'No date', total: g.total.expected ? money(g.total.expected) : '' });
      el.querySelector('.rows').replaceChildren(...g.costs.map(costRow));
      return el;
    }));
  }
  // Rows: a press opens the cost; the "..." has Change and Delete.
  $('groups').addEventListener('click', (e) => {
    const row = e.target.closest('.cost-row');
    if (!row) return;
    const id = row.dataset.id;
    const menu = e.target.closest('[data-action="menu"]');
    const pulled = state.pulled.find((c) => c.id === id);
    if (pulled) {
      // a pulled-in cost is read-only here: it opens in the module that holds it
      if (menu) host.menu.show({ id: `cost-${id}`, anchor: menu, items: [{ id: 'open', label: `Open in ${pulled.source.name}`, icon: 'arrow-up-right-from-square', onClick: () => openSource(pulled) }] });
      else if (e.target.closest('[data-action="open"]')) openSource(pulled);
      return;
    }
    if (menu) { openRowMenu(id, menu); return; }
    if (e.target.closest('[data-action="open"]')) openEditor(id);
  });
  function openRowMenu(id, button) {
    const items = [{ id: 'edit', label: canEdit ? 'Change' : 'Open', icon: canEdit ? 'pen' : 'eye', onClick: () => openEditor(id) }];
    if (canEdit) {
      items.push({ separator: true });
      let armed = false;
      items.push({ id: 'delete', label: 'Delete', icon: 'trash', danger: true, onClick: (_, b) => {
        if (!armed) { armed = true; b.querySelector('.sdk-menu-label').textContent = 'Really delete?'; return false; }
        removeCost(id).catch((err) => say(err.message));
        return undefined;
      } });
    }
    host.menu.show({ id: `cost-${id}`, anchor: button, items });
  }
  // The toolbar row while Costs shows and has costs: how they are grouped and how they are sorted (two buttons on the left
  // that say the current choice and open the choices under them, at their `x`), find a cost, and the filters: the category
  // and who paid, each one choice, with how many costs each would show (of what the search leaves). The sort is not a
  // filter, so it is never counted as one (Thomas, 2026-10-29). The view switch leads the row. Nothing of it in the other views.
  function syncToolbar(all, people) {
    if (state.view !== 'costs' || !all.length) { host.toolbar.set([]).catch(() => {}); return; }
    const count = (f) => filterCosts(all, state.cats, { category: '', payer: '', text: state.text, ...f }).length;
    host.toolbar.set([
      { type: 'button', id: 'group', label: state.groupBy === 'day' ? 'By day' : 'By category', icon: 'layer-group' },
      { type: 'button', id: 'sort', label: `Sort: ${SORT_WORDS[state.sort]}`, icon: 'arrow-down-wide-short' },
      { type: 'search', id: 'find', value: state.text, placeholder: 'Find a cost', label: 'Find a cost' },
      { type: 'chips', id: 'category', label: 'Category', single: true, value: state.category || 'all', options: [
        { id: 'all', label: 'All categories', count: count({}) },
        ...state.cats.map((c) => ({ id: c.id, label: c.label, ...(c.icon ? { icon: c.icon } : {}), count: count({ category: c.id }) })),
      ] },
      { type: 'chips', id: 'payer', label: 'Paid by', single: true, value: state.payer || 'all', options: people.map((p) => ({ id: p.key || 'all', label: p.label, count: count({ payer: p.key }) })) },
    ]).catch(() => {});
  }
  function chooser(e, entries, current, pick) {
    host.menu.show({ id: e.id, at: { x: Number(e.x) || 0, y: 4 }, items: entries.map((en) => ({ id: String(en.id), label: en.label, icon: en.id === current ? 'check' : en.icon, onClick: () => { pick(en.id); render(); } })) });
  }
  host.on('toolbar', (e) => {
    if (e.id === 'find' && typeof e.value === 'string') {
      if (e.value === state.text) return;
      state.text = e.value;
      renderCosts();
      hydrate(root);
    } else if (e.id === 'group') chooser(e, [{ id: 'day', label: 'By day' }, { id: 'category', label: 'By category' }], state.groupBy, (v) => { state.groupBy = v; });
    else if (e.id === 'sort') chooser(e, SORTS.map((id) => ({ id, label: SORT_WORDS[id] })), state.sort, (v) => { state.sort = v; });
    else if (e.id === 'category' && typeof e.value === 'string') { state.category = e.value === 'all' ? '' : e.value; render(); }
    else if (e.id === 'payer' && typeof e.value === 'string') { state.payer = e.value === 'all' ? '' : e.value; render(); }
  });

  // --- Settle up ----------------------------------------------------------------------------------------------------------
  function renderSettle() {
    const b = balances(costs(), state.people.map((p) => p.key));
    const label = (key) => nameOrLeft(key);
    $('payments').replaceChildren(...(b.payments.length ? b.payments.map((p) => {
      const el = clone('tpl-payment');
      fill(el, { text: `${label(p.from)} pays ${label(p.to)}`, amount: money(p.amount) });
      return el;
    }) : [Object.assign(document.createElement('p'), { className: 'hint', textContent: b.total ? 'Everyone is square. Nobody owes anything.' : 'Nothing to settle yet: no cost has an amount paid.' })]));
    const keys = [...new Set([...state.people.map((p) => p.key), ...Object.keys(b.paid), ...Object.keys(b.share)])];
    $('people-rows').replaceChildren(...keys.map((k) => {
      const el = clone('tpl-person');
      const net = b.net[k] || 0;
      fill(el, { initial: (label(k)[0] || '?').toUpperCase(), name: label(k), paid: `Paid ${money(b.paid[k] || 0)}`, share: `Share ${money(b.share[k] || 0)}`, net: net > 0 ? `Owed ${money(net)}` : net < 0 ? `Owes ${money(-net)}` : 'Square' });
      slot(el, 'net').classList.add(net > 0 ? 'owed' : net < 0 ? 'owes' : 'square');
      return el;
    }));
    fill(root.querySelector('#view-settle'), { 'settle-note': 'Counts the costs that have an amount paid and a person who paid. A cost is shared by everyone unless it says who shares it.' });
  }

  // --- the window around it: add, status line, the strip --------------------------------------------------------------------
  const ADD_COST = { id: 'cost', label: 'Add a cost', icon: 'plus' };
  let factsSent = '';
  function chrome() {
    host.add.set(canEdit ? [ADD_COST] : []).catch(() => {});
    host.status.set([{ text: statusWords(costs(), (n) => money(n)), icon: 'wallet' }]).catch(() => {});
    reportFacts();
  }
  // "Spent $X of $Y" for the space's status strip: kept for a week and renewed whenever this module is open and changes.
  function reportFacts() {
    if (!host.facts || !canEdit) return;
    const facts = stripFacts({ costs: costs(), target: state.target, currency: currencyCode(), money: (n, c) => host.util.money(n, c) });
    const sig = JSON.stringify(facts);
    if (sig === factsSent) return;
    factsSent = sig;
    host.facts.set(facts).catch(() => { factsSent = ''; });
  }
  host.on('add', (e) => { if (e.id === 'cost' && canEdit) openEditor(null); });

  // --- the cost, in the editor window ---------------------------------------------------------------------------------------
  const editorError = (text) => { $('f-error').textContent = text; $('f-error').hidden = !text; };
  const sharedChosen = () => [...$('f-shared').querySelectorAll('input:checked')].map((i) => i.value);
  const formSnapshot = () => JSON.stringify([$('f-title').value, $('f-planned').value, $('f-actual').value, $('f-category').value, $('f-date').value, $('f-payer').value, sharedChosen(), $('f-notes').value]);
  const formDirty = () => Boolean(state.editing && state.editing.opened !== undefined && !state.editing.readOnly && state.editing.opened !== formSnapshot());
  const dates = { current: null };
  const editor = host.ui.editor($('editor'), { size: 'medium', isDirty: formDirty, onClose: () => { state.editing = null; if (dates.current) { dates.current.destroy(); dates.current = null; } } });
  const amountText = (n) => (n ? String(n) : '');

  function openEditor(id, seed) {
    const found = id ? state.costs.get(id) : null;
    if (id && !found) return;
    if (!id && !canEdit) return;
    const shown = found ? found.cost : { id: '', title: (seed && seed.title) || '', category: 'other', planned: null, actual: null, paidBy: '', sharedBy: [], date: '', notes: '', by: '', ref: null };
    const readOnly = !canEdit;
    state.editing = { id: id || null, version: found ? found.version : undefined, readOnly };
    $('editor-title').textContent = id ? (readOnly ? shown.title : 'Change this cost') : 'Add a cost';
    $('f-readonly').textContent = readOnly ? `You can look at the costs but not change them.` : '';
    hide($('f-readonly'), !readOnly);
    $('f-title').value = shown.title;
    for (const u of $('form').querySelectorAll('[data-slot="unit"]')) u.textContent = currencyCode();
    $('f-planned').value = amountText(shown.planned);
    $('f-actual').value = amountText(shown.actual);
    // A category taken off the list shows as Other and is kept as it was until another is chosen.
    state.editing.cat = shown.category;
    const known = state.cats.some((c) => c.id === shown.category);
    $('f-category').replaceChildren(...state.cats.map((c) => Object.assign(document.createElement('option'), { value: c.id, textContent: c.label })));
    $('f-category').value = known ? shown.category : 'other';
    $('f-date').value = shown.date;
    const people = [...state.people];
    for (const k of [shown.paidBy, ...shown.sharedBy]) if (k && !people.some((p) => p.key === k)) people.push({ key: k, name: 'Someone who left' });
    $('f-payer').replaceChildren(...[{ key: '', name: 'Nobody yet' }, ...people].map((p) => Object.assign(document.createElement('option'), { value: p.key, textContent: p.name })));
    $('f-payer').value = shown.paidBy;
    $('f-shared').replaceChildren(...people.map((p) => {
      const el = clone('tpl-check');
      el.querySelector('input').value = p.key;
      el.querySelector('input').checked = shown.sharedBy.includes(p.key);
      fill(el, { name: p.name });
      return el;
    }));
    $('f-by').textContent = shown.by ? `Added by ${nameOf(shown.by) || 'someone'}` : '';
    state.editing.ref = shown.ref;
    editorError('');
    for (const el of $('form').querySelectorAll('input, select, textarea')) el.disabled = readOnly;
    hide($('f-save'), readOnly);
    hide($('f-cancel'), readOnly);
    hide($('f-delete'), readOnly || !id);
    hide($('f-actions'), readOnly);
    $('f-delete').textContent = 'Delete';
    state.editing.armed = false;
    state.editing.opened = formSnapshot();
    dates.current = host.ui.datePicker($('f-date'), { clearable: true });
    editor.open({ focus: readOnly ? editor.element : $('f-title'), returnTo: () => (state.editing && state.editing.id && root.querySelector(`.cost-row[data-id="${state.editing.id}"] .cost-main`)) || null });
    dates.current.refresh();
  }
  $('f-cancel').addEventListener('click', () => editor.cancel());
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ed = state.editing;
    if (!ed || ed.readOnly) return;
    const title = $('f-title').value.trim();
    const planned = readAmount($('f-planned').value);
    const actual = readAmount($('f-actual').value);
    const date = $('f-date').value;
    if (!title) { editorError('Give the cost a title.'); $('f-title').focus(); return; }
    if (planned === undefined) { editorError('The planned amount is a number above zero, such as 40 or 12.50.'); $('f-planned').focus(); return; }
    if (actual === undefined) { editorError('The paid amount is a number above zero, such as 40 or 12.50.'); $('f-actual').focus(); return; }
    if (date && !isDay(date)) { editorError('The date is a day, such as 2026-10-14.'); $('f-date').focus(); return; }
    const was = ed.id ? (state.costs.get(ed.id) || {}).cost : null;
    const picked = $('f-category').value;
    const draft = {
      id: ed.id || '',
      title,
      category: was && ed.cat === was.category && !state.cats.some((c) => c.id === ed.cat) && picked === 'other' ? was.category : picked,
      planned,
      actual,
      paidBy: $('f-payer').value,
      sharedBy: sharedChosen(),
      date,
      notes: $('f-notes').value,
      by: was ? was.by : info.user.key,
      ref: ed.ref || null,
    };
    $('f-save').disabled = true;
    try {
      await saveCost(draft, ed.version);
      editor.close();
    } catch (err) {
      if (err && err.status === 409) {
        // someone saved first: show their copy's version, so saving again is a choice to keep this one
        if (err.current && state.editing) state.editing.version = err.current.version;
        editorError('Someone else changed this cost while you had it open. Save again to keep your changes.');
      } else editorError(err && err.message ? err.message : 'The cost could not be saved.');
    } finally {
      $('f-save').disabled = false;
    }
  });
  $('f-delete').addEventListener('click', async () => {
    const ed = state.editing;
    if (!ed || !ed.id || ed.readOnly) return;
    if (!ed.armed) { ed.armed = true; $('f-delete').textContent = 'Really delete?'; return; }
    try {
      await removeCost(ed.id);
      editor.close();
    } catch (err) {
      editorError(err && err.message ? err.message : 'The cost could not be deleted.');
    }
  });

  // --- the target ---------------------------------------------------------------------------------------------------------------
  // Changed here only by someone the server lets (the owner, the admin, a moderator of this space); everyone else sees it and
  // is never offered the button. The form starts with the stored amount, and sends the amount with the currency every time:
  // the server replaces the whole target with what it is sent.
  const targetEditor = host.ui.editor($('target-editor'), { size: 'medium', isDirty: () => Boolean(targetOpened) && targetOpened !== targetSnapshot(), onClose: () => { targetOpened = ''; dropCurrencyPick(); } });
  let targetOpened = '';
  let currencyPick = null;
  const dropCurrencyPick = () => { if (currencyPick) { currencyPick.destroy(); currencyPick = null; } };
  const targetSnapshot = () => JSON.stringify([$('t-amount').value, currencyPick ? currencyPick.value : '']);
  function openTargetEditor() {
    if (!state.canTarget) return;
    const tv = targetView(true, state.target);
    $('target-editor-title').textContent = tv.amount ? 'Edit target' : 'Set a target';
    $('t-amount').value = amountText(tv.amount);
    $('t-error').hidden = true;
    dropCurrencyPick();
    currencyPick = host.ui.currencySelect($('t-currency'), { value: currencyCode() });
    targetOpened = targetSnapshot();
    targetEditor.open({ focus: $('t-amount') });
  }
  $('target-edit').addEventListener('click', openTargetEditor);
  $('t-cancel').addEventListener('click', () => targetEditor.cancel());
  $('target-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = readAmount($('t-amount').value);
    if (amount === undefined) { $('t-error').textContent = 'The target is a number above zero, such as 4000.'; $('t-error').hidden = false; return; }
    const send = targetToSend(amount, currencyPick ? currencyPick.value : currencyCode());
    if (!send) { $('t-error').textContent = 'Choose a currency or give an amount.'; $('t-error').hidden = false; return; }
    $('t-save').disabled = true;
    try {
      const saved = await host.budget.set(send);
      state.target = saved;
      targetEditor.close();
      say(saved && saved.amount ? 'Target saved.' : saved ? 'Amount cleared. The currency is kept.' : 'Target cleared.');
      render();
    } catch (err) {
      $('t-error').textContent = err && err.message ? err.message : 'The target could not be saved.';
      $('t-error').hidden = false;
    } finally {
      $('t-save').disabled = false;
    }
  });
  host.on('space', (e) => { state.target = e && e.budget ? e.budget : null; if (state.loaded) render(); });

  // --- what other modules may ask of this one ----------------------------------------------------------------------------------
  const REFUSED = 'you may not add costs here';
  if (host.actions && host.actions.provide) {
    host.actions.provide({
      addCost: async (input, ctx) => {
        if (!canEdit) throw new Error(REFUSED);
        const c = costFromRequest(input, (ctx && ctx.by) || info.user.key, state.people.map((p) => p.key));
        const saved = await saveCost(c);
        return { ref: pointer(saved.id) };
      },
    });
  }
  if (host.objects && host.objects.onOpen) {
    host.objects.onOpen((ref) => {
      if (ref.module !== info.module.id || ref.kind !== 'cost') return;
      const show = () => { if (state.view !== 'costs') showView('costs'); openEditor(ref.id); };
      if (state.loaded) show(); else state.openWanted = show;
    });
  }

  // --- start -----------------------------------------------------------------------------------------------------------------
  fit();
  new ResizeObserver(fit).observe(host.rootElement);
  try {
    const last = localStorage.getItem('budget-view');
    if (last === 'overview' || last === 'costs' || last === 'settle') state.view = last;
  } catch (err) { /* the default */ }
  viewSwitch = host.ui.viewSwitch({ id: 'view', options: VIEW_OPTIONS(), value: state.view === 'settle' ? 'overview' : state.view, onChange: showView });
  let wired = false; // the timers and listeners are set once, however many times it is tried
  async function load() {
    $('msg').hidden = true;
    $('loading').hidden = true;
    $('app').hidden = false;
    try {
      const [people, settings, canTarget] = await Promise.all([
        host.people().catch(() => []),
        host.settings.get().catch(() => null),
        host.budget ? host.budget.can().catch(() => false) : false,
        loadCosts(),
        refreshPulled(),
      ]);
      state.people = people;
      state.cats = cleanCategories(settings && settings.categories);
      state.canTarget = canTarget === true;
      if (host.space() && host.space().budget) state.target = host.space().budget;
      await Promise.all([...new Set(['plus', 'pen', 'eye', 'trash', 'check', 'tag', 'wallet', 'layer-group', 'calendar-day', 'user', 'arrow-up-right-from-square', ...state.cats.map((c) => c.icon)])].map(wantIcon));
      state.loaded = true;
      render();
      if (!wired) {
        wired = true;
        host.settings.onChange((v) => { state.cats = cleanCategories(v && v.categories); if (state.loaded) render(); });
        const pullTimer = setInterval(() => { if (!host.rootElement.isConnected) clearInterval(pullTimer); else if (!document.hidden) refreshPulled(); }, 30000);
        window.addEventListener('focus', refreshPulled);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPulled(); });
      }
      if (state.openWanted) { const f = state.openWanted; state.openWanted = null; f(); }
    } catch (err) {
      $('app').hidden = true;
      showMsg('The costs could not load', err.message, load);
    }
  }
  await load();
})();
