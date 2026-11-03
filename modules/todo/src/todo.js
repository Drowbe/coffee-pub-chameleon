// To-do module. One file of code for every place it shows: the environment's own page, a
// space's canvas (docked or floating), a window of its own, and the Calendar destination's panel. Each place has its
// own list. On the environment page (and as the panel) the viewer's spaces' lists are shown too, each with its
// space's icon, and editable where the viewer may change tasks in that space (`write` from host.spaces()); a new task
// there asks where it goes, every time. As the panel in a space (/calendar?space=<id>; plan-calendar-todo.md) it holds
// that space's list alone: nothing is asked about where a task goes, and its reminders are that space's. The SDK
// (window.host) is injected by the host.
(async function () {
  'use strict';

  // This module runs in a frame (the SDK is a global) or in the page (its SDK is handed to its script);
  // either way it looks elements up in host.root, never in document, so it works in both.
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
  const { esc, ymd, parseYmd, objectKey, id: newId } = host.util;

  /*__LIB__*/

  let info;
  try {
    info = await host.ready();
  } catch (err) {
    showMsg('The to-do list could not start', err.message, () => location.reload());
    return;
  }
  const inSpace = info.context.scope === 'space';
  const canEdit = host.can('edit'); // in this frame's own place: the space it is in, else the environment
  // The Calendar destination's panel ('panel'), or null on every other surface. As the panel it draws no filter of
  // its own (the page's bar has it, through host.destination) and groups the tasks by when they are due.
  const part = (info.context.destination && info.context.destination.part) || null;
  const DAY = 24 * 60 * 60 * 1000;

  // Every task we know of, by key. `scope` is 'own' (this place's list) or 'spaces' (another space's, read-only).
  const tasks = new Map();
  const spaceInfo = new Map(); // space id -> { id, name, icon, svg, write }, on the environment page
  const hiddenSpaces = new Set();
  let hideOwn = false; // as the panel: the page's filter has the environment's own list off
  let show = 'open';

  // Where a task may be changed: this place's list by this module's permission here; another space's (on the
  // environment page) where host.spaces() says `write`. A space that does not say is read only.
  const spaceWritable = (spaceId) => Boolean(spaceInfo.get(spaceId) && spaceInfo.get(spaceId).write === true);
  const writable = (x) => (x.scope === 'own' ? canEdit : x.scope === 'spaces' ? spaceWritable(x.spaceId) : false);
  const writableSpaces = () => [...spaceInfo.values()].filter((r) => r.write === true);
  const canAdd = () => canEdit || (!inSpace && writableSpaces().length > 0);
  // The storage options for a task's place: another space's list is reached with { space }.
  const placeOpts = (scope, spaceId) => (scope === 'spaces' ? { space: spaceId } : {});
  // The environment's own list is named by the environment's name (info.context.environment.name), as the destination's
  // filter names it (decision 19); the environment word only where the name is not known.
  const envName = () => (info.context.environment && info.context.environment.name) || word('environment', { cap: true });
  const placeName = (scope, spaceId) => (scope === 'spaces' ? (spaceInfo.get(spaceId) ? spaceInfo.get(spaceId).name : word('space', { cap: true })) : inSpace ? word('space', { cap: true }) : envName());
  let editing = null; // { key, id, version } while the editor is open
  let editingLinks = []; // the links the open editor will save
  let editingRules = {}; // and what each does when the object reports something: { pointerKey: { eventName: outcome } }
  const MAX_LINKS = 5;
  // What this module may link to is whatever other modules share and the host says it may (module.json
  // refs.consumes is "*"), so a module written later takes part with no change here.
  let consumable = new Set(); // "module:kind"
  const kindEvents = new Map(); // "module:kind" -> what that kind of object can report: [{ name, label, data }]
  async function loadKinds() {
    try {
      const kinds = await host.objects.kinds();
      consumable = new Set(kinds.map((k) => k.module + ':' + k.kind));
      for (const k of kinds) kindEvents.set(k.module + ':' + k.kind, k.events || []);
    } catch (err) {
      consumable = new Set();
    }
  }
  // What a task can do when an object it links to reports something. Each is offered only when the event
  // carries what it needs: the summary is a line about how it turned out, the pick is an object it chose.
  const OUTCOMES = [
    { id: 'tick', label: 'Tick this', needs: [] },
    { id: 'note', label: 'Add the result to the notes', needs: ['summary'] },
    { id: 'both', label: 'Tick this and add the result', needs: ['summary'] },
    { id: 'title', label: 'Use the result as the title', needs: ['summary'] },
    { id: 'link', label: 'Link what it picked', needs: ['pick'] },
  ];
  const FINISHED = new Set(['closed', 'done', 'completed', 'finished']);
  // And what it can ask other modules to do with what an object reports: any action another module offers whose
  // required fields can be filled from the event (a date from its date, text from its summary, the object itself),
  // shown as "Module: what it does". Nothing here names those modules.
  let askable = [];
  async function loadAskable() {
    try {
      askable = (await host.actions.list()).filter((a) => a && a.input);
    } catch (err) {
      askable = [];
    }
  }
  const baseType = (t) => t.replace(/\?$/, '');
  const fillable = (a, event) => Object.entries(a.input).every(([, type]) => {
    if (type.endsWith('?')) return true;
    const base = baseType(type);
    const has = (f) => Object.keys(event.data || {}).includes(f);
    return base === 'date' ? has('date') : base === 'string' || base === 'text' ? has('summary') : base === 'ref';
  }) && Object.values(a.input).some((t) => !t.endsWith('?'))
    // An action that says it needs a date (the Calendar's, whose date may come inside an object instead) gets one only from the event.
    && (!(a.needs || []).includes('date') || Object.keys(event.data || {}).includes('date'));
  const outcomesFor = (event) => [
    ...OUTCOMES.filter((o) => o.needs.every((f) => Object.keys(event.data || {}).includes(f))),
    ...askable.filter((a) => fillable(a, event)).map((a) => ({ id: 'ask:' + a.action, label: a.moduleName + ': ' + a.label })),
  ];
  const askInput = (a, e) => {
    const data = e.data || {};
    const input = {};
    for (const [field, type] of Object.entries(a.input)) {
      const base = baseType(type);
      // An optional date the action says it needs is filled too (the Calendar's, which may also come inside an object).
      if (type.endsWith('?') && !(base === 'date' && data.date && (a.needs || []).includes('date'))) continue;
      if (base === 'date') input[field] = String(data.date || '');
      else if (base === 'string' || base === 'text') input[field] = String(data.summary || '');
      else if (base === 'ref') input[field] = e.ref;
    }
    return input;
  };
  const summaries = new Map(); // pointer key -> summary, or { error } when it is gone or not for this viewer

  // --- dates ---------------------------------------------------------------

  const pad = (n) => String(n).padStart(2, '0');
  const startOfToday = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };

  function dueText(due) {
    const days = Math.round((parseYmd(due) - startOfToday()) / DAY);
    if (days === 0) return { text: 'Today', cls: 'soon' };
    if (days === 1) return { text: 'Tomorrow', cls: 'soon' };
    if (days === -1) return { text: 'Yesterday', cls: 'late' };
    const text = parseYmd(due).toLocaleDateString([], { month: 'short', day: 'numeric' });
    return { text, cls: days < 0 ? 'late' : '' };
  }

  // --- loading and live updates --------------------------------------------

  const OLD_PLACE = { room: 'space', server: 'environment' };
  const ruleKey = (k) => { const p = String(k).split('|'); if (p.length === 5 && OLD_PLACE[p[3]]) p[3] = OLD_PLACE[p[3]]; return p.join('|'); };

  const keyOf = (scope, id, spaceId) => (scope === 'spaces' ? `spaces:${spaceId}:${id}` : `own:${id}`);
  function remember(scope, item, spaceId) {
    if (!item.key.startsWith('task:') || !item.value) return;
    const id = item.key.slice(5);
    const key = keyOf(scope, id, spaceId);
    // Stored data is whatever a writer put there: keep only well-formed links.
    const t = item.value;
    t.links = Array.isArray(t.links) ? t.links.filter((r) => r && typeof r === 'object' && typeof r.module === 'string' && typeof r.kind === 'string' && typeof r.id === 'string' && linkable(r)).slice(0, MAX_LINKS) : [];
    // A rule is kept under its link's key (host.util.objectKey), which named the place 'room' or 'server' before
    // The product's names changed: read those under the new names. Saving the task writes the new keys.
    if (t.rules && typeof t.rules === 'object') t.rules = Object.fromEntries(Object.entries(t.rules).map(([k, v]) => [ruleKey(k), v]));
    tasks.set(key, { key, scope, spaceId, id, version: item.version, t });
  }
  async function load() {
    tasks.clear();
    for (const item of await host.storage.list('task:')) remember('own', item);
    if (!inSpace && info.context.scope === 'environment') {
      try {
        for (const r of await host.spaces()) if (r.id !== 'lobby') spaceInfo.set(r.id, r); // the Lobby is not a trip: as in the Calendar
        for (const item of await host.storage.list('task:', { scope: 'spaces' })) remember('spaces', item, item.spaceId);
      } catch (err) {
        // just the environment's own list
      }
    }
  }
  host.on('change', (e) => {
    if (!e.key.startsWith('task:')) return;
    const scope = e.scope === 'spaces' ? 'spaces' : 'own';
    const id = e.key.slice(5);
    if (e.deleted) tasks.delete(keyOf(scope, id, e.spaceId));
    else remember(scope, { key: e.key, value: e.value, version: e.version }, e.spaceId);
    if (editing && editing.key === keyOf(scope, id, e.spaceId) && e.by !== info.user.key) {
      showError('This task was just changed by someone else. Close and reopen it to see the change.');
    }
    render();
  });

  // --- links to other modules' objects ----------------------------------------
  // A task stores only pointers ({ module, kind, id, scope, space }); what to show comes from
  // the host each time (host.objects.resolve), so it is always current and never more than the
  // viewer may see. The pointers are checked in the drop and search: only the kinds above.

  const linkable = (r) => consumable.has(r.module + ':' + r.kind);
  // A pointer to one of this module's tasks: in this place, or (from the environment page) in another space.
  const myRef = (id, spaceId) => host.objects.make('task', id, spaceId ? { space: spaceId } : undefined);
  const syncedLinks = new Map(); // task key -> the links last told to the host

  // Tell the host what a task points at, so the things it points at can show it. Only when it changed.
  async function syncLinks(x, links) {
    if (!host.objects || !host.objects.setLinks) return;
    const sig = JSON.stringify(links.map(objectKey));
    if (syncedLinks.get(x.key) === sig) return;
    syncedLinks.set(x.key, sig);
    try {
      await host.objects.setLinks(myRef(x.id, x.spaceId), links, placeOpts(x.scope, x.spaceId));
    } catch (err) {
      syncedLinks.delete(x.key); // try again next time
    }
  }

  async function resolveLinks() {
    if (!host.objects) return;
    const want = new Map();
    for (const x of tasks.values()) for (const r of x.t.links || []) if (!summaries.has(objectKey(r))) want.set(objectKey(r), r);
    for (const r of editingLinks) if (!summaries.has(objectKey(r))) want.set(objectKey(r), r);
    if (!want.size) return;
    const list = [...want.values()];
    try {
      const got = await host.objects.resolve(list);
      list.forEach((r, i) => summaries.set(objectKey(r), got[i] || { error: 'unavailable' }));
    } catch (err) {
      list.forEach((r) => summaries.set(objectKey(r), { error: 'unavailable' }));
    }
    if (!$('body')) return; // closed while the host answered: nothing left to draw into
    render();
    renderEditorLinks();
  }

  function dateText(when, allDay) {
    if (when === undefined || when === null || when === '') return '';
    const d = typeof when === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(when) ? parseYmd(when) : new Date(when);
    if (Number.isNaN(d.getTime())) return '';
    return allDay === false ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: host.util.hour12() }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function linkChip(r, removable) {
    const c = summaries.get(objectKey(r));
    const x = removable ? `<button class="x" type="button" data-unlink="${esc(objectKey(r))}" aria-label="Remove link">&times;</button>` : '';
    if (!c) return `<span class="link gone">Loading...${x}</span>`;
    if (c.error) return `<span class="link gone" title="Deleted, or not something you can see">Not available${x}</span>`;
    const when = dateText(c.when, c.allDay);
    const body = `<b>${esc(c.kindName || c.module.name)}</b> ${esc(c.title)}${when ? ' &middot; ' + esc(when) : ''}`;
    // A summary that says its module can show the object is a button that does.
    return c.open
      ? `<span class="link"><span class="open" role="button" tabindex="0" data-open-ref="${esc(objectKey(r))}" title="Open ${esc(c.title)}">${body}</span>${x}</span>`
      : `<span class="link" title="${esc(c.title)}">${body}${x}</span>`;
  }

  // Add a pointer to a task (from a drop) and save it.
  async function linkTo(key, ref) {
    const x = tasks.get(key);
    if (!x || !writable(x) || !ref || !linkable(ref)) return;
    const links = x.t.links || [];
    if (links.some((r) => objectKey(r) === objectKey(ref))) return;
    if (links.length >= MAX_LINKS) return showNote('A task can link to ' + MAX_LINKS + ' things.');
    try {
      await put(x, { ...x.t, links: [...links, ref] });
    } catch (err) {
      showNote(err.status === 409 ? 'Someone changed that task first. Try again.' : err.message);
    }
    render();
    resolveLinks();
  }

  // --- drawing -------------------------------------------------------------

  const spaceIcon = (spaceId) => {
    const r = spaceInfo.get(spaceId);
    return r && r.svg ? `<span class="ri">${r.svg}</span>` : '';
  };

  // Open tasks: soonest due first, then the ones with no date, oldest first. Done: latest first.
  function sorted(list, done) {
    return list.slice().sort((a, b) => {
      if (done) return (b.t.doneAt || 0) - (a.t.doneAt || 0);
      const da = a.t.due || '9999';
      const db = b.t.due || '9999';
      return da < db ? -1 : da > db ? 1 : (a.t.createdAt || 0) - (b.t.createdAt || 0);
    });
  }

  function taskHtml(x) {
    const t = x.t;
    const editable = writable(x);
    const due = t.due ? dueText(t.due) : null;
    const notes = t.notes ? `<small>${esc(t.notes.split('\n')[0].slice(0, 90))}</small>` : '';
    const links = (t.links || []).length ? `<span class="links">${t.links.map((r) => linkChip(r, false)).join('')}</span>` : '';
    return `<div class="sdk-row task ${t.done ? 'done' : ''}" data-task="${esc(x.key)}">
      <label class="sdk-row-tick"><input class="tick" type="checkbox" data-tick="${esc(x.key)}" ${t.done ? 'checked' : ''} ${editable ? '' : 'disabled'} aria-label="Done"></label>
      <button class="sdk-open text" type="button" data-open="${esc(x.key)}">${part && x.scope === 'spaces' ? spaceIcon(x.spaceId) : ''}<span class="t-title">${esc(t.title)}</span>${notes}${links}</button>
      ${due && !t.done ? `<span class="due ${due.cls}">${esc(due.text)}</span>` : ''}
    </div>`;
  }

  function groupHtml(label, list) {
    const shown = list.filter((x) => (show === 'all' ? true : show === 'done' ? x.t.done : !x.t.done));
    if (!shown.length) return '';
    const open = sorted(shown.filter((x) => !x.t.done), false);
    const done = sorted(shown.filter((x) => x.t.done), true);
    return `<section class="sdk-list-group">${label ? `<h4 class="sdk-group-head">${label}</h4>` : ''}<div class="sdk-list">${[...open, ...done].map(taskHtml).join('')}</div></section>`;
  }

  // Open / Done / All is the toolbar's view switch.
  const FILTERS = [
    { id: 'open', label: 'Open', icon: 'circle', regular: true },
    { id: 'done', label: 'Done', icon: 'circle-check' },
    { id: 'all', label: 'All', icon: 'list-check' },
  ];
  // As the destination's panel it is in the page's one toolbar row, while the panel shows.
  const filterSwitch = host.ui.viewSwitch({
    id: 'filter',
    options: FILTERS,
    value: show,
    onChange: (id) => { show = id; render(); },
  });

  // As the panel: open tasks across the places the page's filter has on, by when they are due.
  function dueGroup(t) {
    if (!t.due) return 'none';
    const today = startOfToday();
    const due = parseYmd(t.due);
    if (due < today) return 'late';
    if (due - today < DAY / 2) return 'today';
    const weekEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (6 - today.getDay()));
    return due <= weekEnd ? 'week' : 'later';
  }
  const DUE_GROUPS = [['late', 'Overdue'], ['today', 'Today'], ['week', 'This week'], ['later', 'Later'], ['none', 'No date']];
  function renderByDue() {
    const shown = [...tasks.values()].filter((x) => (x.scope === 'own' ? !hideOwn : !hiddenSpaces.has(x.spaceId)));
    const openCount = shown.filter((x) => !x.t.done).length;
    filterSwitch.set(show, FILTERS.map((f) => (f.id === 'open' && openCount ? { ...f, count: openCount } : f)));
    if (!inSpace && hideOwn && ![...spaceInfo.keys()].some((id) => !hiddenSpaces.has(id))) {
      $('body').innerHTML = `<p class="sdk-empty">Pick at least one in ${esc(word('space', { many: true, cap: true }))}.</p>`;
      return;
    }
    let html = '';
    if (show !== 'done') {
      const open = shown.filter((x) => !x.t.done);
      for (const [id, label] of DUE_GROUPS) {
        const list = sorted(open.filter((x) => dueGroup(x.t) === id), false);
        if (list.length) html += `<section class="sdk-list-group"><h4 class="sdk-group-head">${esc(label)}</h4><div class="sdk-list">${list.map(taskHtml).join('')}</div></section>`;
      }
    }
    if (show !== 'open') {
      const done = sorted(shown.filter((x) => x.t.done), true);
      if (done.length) html += `<section class="sdk-list-group">${show === 'all' ? '<h4 class="sdk-group-head">Done</h4>' : ''}<div class="sdk-list">${done.map(taskHtml).join('')}</div></section>`;
    }
    $('body').innerHTML = html || `<p class="sdk-empty">${show === 'done' ? 'Nothing done yet.' : 'Nothing to do.'}${canAdd() && show !== 'done' ? ' Add a task to get started.' : ''}</p>`;
  }

  function render() {
    syncStatus();
    if (part) return renderByDue();
    const own = [...tasks.values()].filter((x) => x.scope === 'own');
    const openCount = own.filter((x) => !x.t.done).length;
    syncToolbar();
    filterSwitch.set(show, FILTERS.map((f) => (f.id === 'open' && openCount ? { ...f, count: openCount } : f)));

    let html = groupHtml(spaceInfo.size ? esc(envName()) : '', own);
    for (const r of spaceInfo.values()) {
      if (hiddenSpaces.has(r.id)) continue;
      html += groupHtml(`${spaceIcon(r.id)} ${esc(r.name)}`, [...tasks.values()].filter((x) => x.scope === 'spaces' && x.spaceId === r.id));
    }
    $('body').innerHTML = html || `<p class="sdk-empty">${show === 'done' ? 'Nothing done yet.' : 'Nothing to do.'}${canAdd() && show !== 'done' ? ' Add a task to get started.' : ''}</p>`;
  }

  // A short notice with Undo (the SDK's toast has no action): ticking a task makes it leave the Open list, and a delete is gone,
  // so each says what happened and takes it back for a while. One at a time; the next replaces it.
  let undoFn = null;
  let undoTimer = 0;
  function showUndo(text, undo) {
    undoFn = undo;
    $('undo-text').textContent = text;
    $('undo').hidden = false;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(hideUndo, 8000);
  }
  function hideUndo() {
    undoFn = null;
    $('undo').hidden = true;
  }
  $('undo-btn').addEventListener('click', async () => {
    const fn = undoFn;
    hideUndo();
    if (!fn) return;
    try { await fn(); } catch (err) { showNote(err.message); }
  });
  function showNote(text) {
    $('note').textContent = text;
    $('note').hidden = !text;
    if (text) setTimeout(() => { $('note').hidden = true; }, 5000);
  }

  // --- reminders ------------------------------------------------------------
  // A reminder is a schedule the host runs for us: at 9:00 on the due date it sends a
  // notification, even with this page closed. It stops when the task is done, changed or deleted.

  // `where` is the task's place for the host ({ space } for another space's task), so the reminder is set in that
  // space and reaches its people.
  async function applyReminder(t, where) {
    const key = 'remind:' + t.id;
    try {
      if (!t.remind || !t.due || t.done) return await host.cancelSchedule(key, where);
      const at = parseYmd(t.due).getTime() + 9 * 60 * 60 * 1000;
      if (at <= Date.now()) return await host.cancelSchedule(key, where);
      await host.schedule({ key, at, payload: { id: t.id }, notify: { title: t.title, body: 'Due today' }, ...(where || {}) });
    } catch (err) {
      showNote('Saved, but the reminder could not be set: ' + err.message);
      throw err;
    }
  }

  // --- changing tasks --------------------------------------------------------

  // Save a task in its place: an existing task's own (`x`), or `target` ({ scope: 'own' } or { scope: 'spaces',
  // spaceId }) for a new one. Answers the saved record, with `where` (the storage options for its place).
  async function put(x, t, target) {
    const place = x ? { scope: x.scope, spaceId: x.spaceId } : target || { scope: 'own' };
    const where = placeOpts(place.scope, place.spaceId);
    const saved = await host.storage.set('task:' + t.id, t, { ...(x && x.version ? { version: x.version } : {}), ...where });
    remember(place.scope, { key: 'task:' + t.id, value: t, version: saved.version }, place.spaceId);
    const now = tasks.get(keyOf(place.scope, t.id, place.spaceId));
    if (now) syncLinks(now, t.links || []);
    return { ...saved, where };
  }
  const whereOf = (x) => placeOpts(x.scope, x.spaceId);


  async function tick(key, done) {
    const x = tasks.get(key);
    if (!x || !writable(x)) return;
    const t = { ...x.t, done, doneAt: done ? Date.now() : null };
    try {
      await put(x, t);
      applyReminder(t, whereOf(x)).catch(() => {});
      if (done) showUndo(`Done: ${t.title.length > 40 ? `${t.title.slice(0, 40)}...` : t.title}`, () => tick(key, false));
    } catch (err) {
      showNote(err.status === 409 ? 'Someone changed that task first. It has been refreshed.' : err.message);
      try { await load(); } catch (e) { /* keep what we have */ }
    }
    render();
  }

  // --- the editor -----------------------------------------------------------

  function showError(text) {
    $('f-error').textContent = text;
    $('f-error').hidden = !text;
  }

  function syncForm() {
    $('f-remind-wrap').hidden = !$('f-due').value;
  }
  $('f-due').addEventListener('change', syncForm);
  const duePicker = host.ui.datePicker($('f-due'), { clearable: true });

  // The form opens in the SDK's editor window (host.ui.editor): a modal <dialog> over everything, sized to the form, a
  // sheet on a phone. Escape and its Close button ask "Discard your changes?" when the form differs from what it opened
  // with (isDirty), and so does Cancel (editor.cancel); Save and Delete close it at once. On close, focus goes back to the task's row (found again by
  // its key, since render() redraws the list) or the New todo button.
  let opened = ''; // what the form held when it opened, as formState() gives it
  const formState = () => JSON.stringify({
    where: $('f-where-wrap').hidden ? '' : $('f-where').value,
    title: $('f-title').value,
    notes: $('f-notes').value,
    due: $('f-due').value,
    remind: $('f-remind').checked,
    done: $('f-done').checked,
    links: editingLinks.map((r) => objectKey(r)),
    rules: editingRules,
  });
  let lastKey = null; // the key of the task the form was opened on, or saved as: where focus returns
  const returnTo = () => {
    const row = lastKey ? root.querySelector(`[data-open="${CSS.escape(lastKey)}"]`) : null;
    if (row) return row;
    return null;
  };
  const editor = host.ui.editor($('editor'), {
    size: 'medium',
    isDirty: () => Boolean(editing) && !editing.readOnly && formState() !== opened, // a read-only form has nothing to lose
    onClose: () => {
      duePicker.close();
      editing = null;
      editingLinks = [];
      editingRules = {};
    },
  });

  // --- where a task goes ------------------------------------------------------------
  // On the environment page (and as the panel) a new task asks where it goes, every time: the environment's own list,
  // for people who may change it, then each space where the viewer may add tasks. It starts empty whatever was picked
  // last, and Save says to pick first. A task that exists stays where it is: Where shows its place, unchangeable.
  const pickWhere = () => `Pick ${word('space', { a: true })}`;
  function fillWhere(x) {
    const select = $('f-where');
    $('f-where-wrap').hidden = inSpace;
    if (inSpace) return;
    if (x) {
      select.innerHTML = `<option value="">${esc(placeName(x.scope, x.spaceId))}</option>`;
      select.disabled = true;
      return;
    }
    const options = [`<option value="" selected disabled>${esc(pickWhere())}</option>`];
    if (canEdit) options.push(`<option value="own">${esc(placeName('own'))}</option>`);
    for (const r of writableSpaces()) options.push(`<option value="in:${esc(r.id)}">${esc(r.name)}</option>`);
    select.innerHTML = options.join('');
    select.value = '';
    select.disabled = false;
  }
  // Where the open editor's new task goes, or null while none is picked on the environment page.
  function targetOf() {
    if (inSpace) return { scope: 'own' };
    const w = $('f-where').value;
    if (w === 'own' && canEdit) return { scope: 'own' };
    if (w.startsWith('in:') && spaceWritable(w.slice(3))) return { scope: 'spaces', spaceId: w.slice(3) };
    return null;
  }
  $('f-where').addEventListener('change', () => showError(''));

  // What a person who may not change a task reads instead of the form: when it is due, whether it is done, the notes.
  function summaryHtml(t) {
    const lines = [`<p class="sum-when">${t.done ? 'Done' : 'Open'}${t.due ? ` &middot; Due ${esc(parseYmd(t.due).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }))}` : ''}</p>`];
    if (t.remind && t.due && !t.done) lines.push('<p>People are reminded at 9:00 that day.</p>');
    if (t.notes) lines.push(`<p class="detail">${esc(t.notes)}</p>`);
    return lines.join('');
  }
  function openEditor(x, prefill) {
    if (!x && !canAdd()) return;
    const readOnly = x ? !writable(x) : false;
    const t = x ? x.t : { title: (prefill && prefill.title) || '', notes: '', due: (prefill && prefill.date) || null, remind: false, done: false };
    editing = x ? { key: x.key, id: x.id, version: x.version, readOnly } : { key: null, id: null, version: null, readOnly: false };
    fillWhere(x);
    // Read only in a place where the viewer may not change tasks: say why (on the environment page, where it can differ).
    const why = readOnly && !inSpace && x ? `Only people who can add tasks in ${placeName(x.scope, x.spaceId)} can change this.` : '';
    $('f-readonly').textContent = why;
    $('f-readonly').hidden = !why;
    editingLinks = ((x && x.t.links) || []).slice();
    editingRules = rulesFor(x && x.t);
    $('f-link-search').value = '';
    $('f-link-results').innerHTML = '';
    $('f-link-search').hidden = readOnly || !host.objects;
    $('f-links-wrap').hidden = !host.objects || (readOnly && !editingLinks.length);
    renderEditorLinks(readOnly);
    resolveLinks();
    showError('');
    const from = x && x.scope === 'spaces' && spaceInfo.get(x.spaceId) ? ` (${spaceInfo.get(x.spaceId).name})` : '';
    $('editor-title').textContent = x ? (readOnly ? t.title + from : 'Edit task') : 'New task';
    $('f-title').value = t.title;
    $('f-notes').value = t.notes || '';
    $('f-due').value = t.due || '';
    duePicker.refresh();
    $('f-remind').checked = Boolean(t.remind);
    $('f-done').checked = Boolean(t.done);
    $('f-by').textContent = x && t.by ? `Added by ${t.by}` : '';
    for (const id of ['f-title', 'f-notes', 'f-due', 'f-remind', 'f-done']) $(id).disabled = readOnly;
    // A task the viewer may only look at: a summary, not a form of disabled fields.
    $('f-fields').hidden = readOnly;
    $('f-done-wrap').hidden = readOnly;
    $('f-summary').hidden = !readOnly;
    $('f-summary').innerHTML = readOnly ? summaryHtml(t) : '';
    duePicker.refresh(); // its Pick a date follows the field: disabled with it
    $('f-save').hidden = readOnly;
    $('f-delete').hidden = readOnly || !x;
    $('f-delete').textContent = 'Delete';
    // Read-only (a task from elsewhere): no button row; the window's own Close in the corner is the one way out.
    $('f-cancel').hidden = readOnly;
    $('f-cancel').parentElement.hidden = readOnly;
    syncForm();
    lastKey = x ? x.key : null;
    opened = formState();
    // Read-only: focus the window itself (nothing in it takes input); the corner Close is next on Tab.
    editor.open({ focus: readOnly ? $('editor') : $(x || inSpace ? 'f-title' : 'f-where'), returnTo });
  }
  function closeEditor() {
    editor.close();
  }

  // The task's rules with the older per-task settings folded in: those meant "tick, and keep the result" for
  // a finished object, which is what a rule on a link now says.
  function rulesFor(t) {
    const rules = {};
    const legacy = t && t.autoDone && t.autoNote ? 'both' : t && t.autoDone ? 'tick' : t && t.autoNote ? 'note' : null;
    for (const r of (t && t.links) || []) {
      for (const ev of kindEvents.get(r.module + ':' + r.kind) || []) {
        const set = t.rules && t.rules[objectKey(r)] && t.rules[objectKey(r)][ev.name];
        const use = set || (FINISHED.has(ev.name) ? legacy : null);
        if (use && outcomesFor(ev).some((o) => o.id === use)) (rules[objectKey(r)] = rules[objectKey(r)] || {})[ev.name] = use;
      }
    }
    return rules;
  }
  function renderRules(readOnly) {
    const rows = [];
    for (const r of editingLinks) {
      const c = summaries.get(objectKey(r));
      for (const ev of kindEvents.get(r.module + ':' + r.kind) || []) {
        const chosen = (editingRules[objectKey(r)] || {})[ev.name] || '';
        rows.push(`<label class="sdk-field"><span class="sdk-label">${esc(c && !c.error ? c.title : `That ${word('object')}`)}: ${esc(ev.label)}</span><select data-rule="${esc(objectKey(r))}|${esc(ev.name)}" ${readOnly ? 'disabled' : ''}><option value="">Do nothing</option>${outcomesFor(ev).map((o) => `<option value="${o.id}"${o.id === chosen ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select><span class="sdk-hint"></span></label>`);
      }
    }
    $('f-rules').innerHTML = rows.join('');
  }
  $('f-rules').addEventListener('change', (e) => {
    const s = e.target.closest('[data-rule]');
    if (!s) return;
    const cut = s.dataset.rule.lastIndexOf('|'); // the pointer's own key holds bars
    const key = s.dataset.rule.slice(0, cut);
    const name = s.dataset.rule.slice(cut + 1);
    const rule = editingRules[key] = editingRules[key] || {};
    if (s.value) rule[name] = s.value; else delete rule[name];
  });
  function renderEditorLinks(readOnly = $('f-link-search').hidden) {
    $('f-links').innerHTML = editingLinks.map((r) => linkChip(r, !readOnly)).join('');
    renderRules(readOnly);
  }
  $('f-links').addEventListener('click', (e) => {
    const o = e.target.closest('[data-open-ref]');
    if (o) return void openLink(o.dataset.openRef);
    const b = e.target.closest('[data-unlink]');
    if (!b) return;
    editingLinks = editingLinks.filter((r) => objectKey(r) !== b.dataset.unlink);
    renderEditorLinks();
  });

  function addEditorLink(ref) {
    if (!linkable(ref) || editingLinks.some((r) => objectKey(r) === objectKey(ref))) return;
    if (editingLinks.length >= MAX_LINKS) return showError('A task can link to ' + MAX_LINKS + ' things.');
    editingLinks.push(ref);
    renderEditorLinks();
    resolveLinks();
  }

  // Search the things this module may link to: here, and (from a space) the environment's.
  let searchTimer = 0;
  async function searchLinks() {
    const text = $('f-link-search').value.trim();
    const box = $('f-link-results');
    if (!host.objects) return;
    try {
      const found = [...await host.objects.search(text)];
      if (inSpace) found.push(...await host.objects.search(text, { scope: 'environment' }).catch(() => []));
      // A copy (the Calendar's copy of an Itinerary object) is the same thing twice: only the original is offered.
      const fresh = found.filter((c) => !c.copy && !editingLinks.some((r) => objectKey(r) === objectKey(c.ref))).slice(0, 12);
      for (const c of fresh) summaries.set(objectKey(c.ref), c);
      box.innerHTML = fresh.length ? fresh.map((c) => `<button type="button" class="sdk-row result" data-link="${esc(objectKey(c.ref))}"><span>${esc(c.module.name)}: ${esc(c.title)}</span><small>${esc(dateText(c.when, c.allDay))}</small></button>`).join('') : '<span class="hint">Nothing found.</span>';
      box.dataset.found = JSON.stringify(fresh.map((c) => c.ref));
    } catch (err) {
      box.innerHTML = '';
    }
  }
  $('f-link-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(searchLinks, 250); });
  $('f-link-search').addEventListener('focus', searchLinks);
  $('f-link-results').addEventListener('click', (e) => {
    const b = e.target.closest('[data-link]');
    if (!b) return;
    const ref = JSON.parse($('f-link-results').dataset.found || '[]').find((r) => objectKey(r) === b.dataset.link);
    if (ref) addEditorLink(ref);
    b.remove(); // the focused button goes with it: focus the search field, not the page
    $('f-link-search').focus();
  });

  // Cancel goes the way the SDK's own Close does (editor.cancel), so it asks "Discard your changes?" after typing.
  $('f-cancel').addEventListener('click', () => editor.cancel());
  async function save() {
    if (!editing) return;
    showError('');
    const current = editing.key ? tasks.get(editing.key) : null;
    const target = current ? null : targetOf();
    if (!current && !target) return showError(`${pickWhere()} first.`);
    const title = $('f-title').value.trim();
    if (!title) return showError('A task needs a name.');
    const done = $('f-done').checked;
    const due = $('f-due').value || null;
    const t = {
      id: editing.id || newId(),
      title,
      notes: $('f-notes').value.trim(),
      due,
      remind: Boolean(due) && $('f-remind').checked,
      done,
      doneAt: done ? (current && current.t.done ? current.t.doneAt : Date.now()) : null,
      createdAt: current ? current.t.createdAt : Date.now(),
      by: current ? current.t.by : info.user.name,
      links: editingLinks.slice(0, MAX_LINKS),
      rules: Object.fromEntries(Object.entries(editingRules).filter(([k, v]) => editingLinks.some((r) => objectKey(r) === k) && Object.keys(v).length)),
    };
    $('f-save').disabled = true;
    try {
      const saved = await put(current, t, target);
      lastKey = current ? current.key : keyOf(target.scope, t.id, target.spaceId);
      let reminderFailed = false;
      try { await applyReminder(t, saved.where); } catch (err) { reminderFailed = true; }
      render();
      if (!reminderFailed) closeEditor();
    } catch (err) {
      showError(err.status === 409 ? 'Someone changed this task since you opened it. Close it and open it again.' : err.message);
    } finally {
      $('f-save').disabled = false;
    }
  }
  $('f-save').addEventListener('click', save);
  $('form').addEventListener('submit', (e) => { e.preventDefault(); save(); });
  $('form').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    save();
  });

  let deleteArmed = false;
  $('f-delete').addEventListener('click', async () => {
    if (!editing || !editing.id) return;
    if (!deleteArmed) {
      deleteArmed = true;
      $('f-delete').textContent = 'Really delete?';
      setTimeout(() => { deleteArmed = false; $('f-delete').textContent = 'Delete'; }, 4000);
      return;
    }
    deleteArmed = false;
    const x = tasks.get(editing.key);
    if (!x) return;
    try {
      const gone = { t: x.t, scope: x.scope, spaceId: x.spaceId, where: whereOf(x) };
      await host.storage.delete('task:' + editing.id, whereOf(x));
      showUndo(`Deleted: ${x.t.title.length > 40 ? `${x.t.title.slice(0, 40)}...` : x.t.title}`, async () => {
        const saved = await host.storage.set('task:' + gone.t.id, gone.t, gone.where);
        remember(gone.scope, { key: 'task:' + gone.t.id, value: gone.t, version: saved.version }, gone.spaceId);
        const back = tasks.get(keyOf(gone.scope, gone.t.id, gone.spaceId));
        if (back) syncLinks(back, gone.t.links || []);
        applyReminder(gone.t, gone.where).catch(() => {});
        render();
      });
      syncLinks(x, []);
      try { await host.cancelSchedule('remind:' + editing.id, whereOf(x)); } catch (err) { /* nothing to cancel */ }
      tasks.delete(editing.key);
      closeEditor();
      render();
    } catch (err) {
      showError(err.message);
    }
  });

  // --- wiring ---------------------------------------------------------------

  // The toolbar row: the view switch leads it; on the environment page the row's Filters menu has a switch for each of the
  // viewer's spaces, to show or hide its list (as the panel the page's filter has them).
  const ICON_NAME = /^[a-z0-9-]{1,40}$/;
  function syncToolbar() {
    const chips = !part && spaceInfo.size
      ? [{ type: 'chips', id: 'spaces', label: word('space', { many: true, cap: true }), options: [...spaceInfo.values()].map((r) => ({ id: r.id, label: r.name, ...(ICON_NAME.test(r.icon || '') ? { icon: r.icon } : {}), on: !hiddenSpaces.has(r.id) })) }]
      : [];
    host.toolbar.set(chips).catch(() => {});
  }
  host.on('toolbar', (e) => {
    if (e.id !== 'spaces' || typeof e.value !== 'string') return;
    if (e.on) hiddenSpaces.delete(e.value); else hiddenSpaces.add(e.value);
    render();
  });
  // A link to another module's object opens it there; the host opens that module and hands it the pointer.
  const openLink = (key) => {
    const c = summaries.get(key);
    if (!c || c.error || !c.open || !host.objects || !host.objects.open) return;
    host.objects.open(c.ref).catch((err) => showNote(err.message));
  };
  $('body').addEventListener('click', (e) => {
    const ref = e.target.closest('[data-open-ref]');
    if (ref) return void openLink(ref.dataset.openRef);
    const open = e.target.closest('[data-open]');
    if (open) {
      const x = tasks.get(open.dataset.open);
      if (x) openEditor(x);
    }
  });
  // A task can be dragged to another module (one that links to tasks, or does something with one).
  if (host.objects && host.objects.draggable) {
    host.objects.draggable($('body'), (target) => {
      const row = target.closest('[data-task]');
      const x = row && tasks.get(row.dataset.task);
      return x && writable(x) ? { kind: 'task', id: x.id, label: x.t.title, ...whereOf(x) } : null;
    });
  }

  // Something dropped here from another module (a drag the host brokers between panes on the same page): what can be
  // done with it is the shared decision (host.objects.dropMenu). This module's own offers: link it to the task under
  // the pointer, or start a task from it (linked to it when it is an object, titled and dated from it when it is a summary
  // carried by the drag, an answer say). Nothing can be dropped into the open form: the page is inert under the editor
  // window; its link search stays (plan-editor-window.md, decision 9).
  const clearDrop = () => {
    for (const r of root.querySelectorAll('.task.drop')) r.classList.remove('drop');
  };
  const taskAt = (pt) => {
    const el = host.objects.elementAt(pt);
    const row = el && el.closest('[data-task]');
    return row && tasks.get(row.dataset.task) && writable(tasks.get(row.dataset.task)) ? row : null;
  };
  if (host.objects && host.objects.dropTarget) {
    host.objects.dropTarget({
      over: (pt, ref, dragged) => {
        clearDrop();
        if (!(ref || dragged.summary) || !canAdd() || editor.isOpen) return;
        const row = taskAt(pt);
        if (row) row.classList.add('drop');
      },
      leave: clearDrop,
      drop: async (ref, pt, dragged) => {
        clearDrop();
        if (!(ref || dragged.summary) || !canAdd()) return host.objects.trace(`drop ignored: ${canAdd() ? 'nothing valid was dropped' : 'cannot edit'}`);
        if (editor.isOpen) return host.objects.trace('drop ignored: the editor window is open');
        const row = taskAt(pt);
        const x = row && tasks.get(row.dataset.task);
        try {
          // On a task, the obvious thing is to link it there; on the list's empty space, to start a task from it. One
          // own offer each, so the drop just does it unless the object's own module adds something (see dropMenu).
          const own = x && ref && linkable(ref)
            ? [{ id: 'link', label: `Link it to "${x.t.title}"`, run: () => linkTo(row.dataset.task, ref) }]
            : [{ id: 'create', label: 'Start a task from it', run: (ctx) => { openEditor(null, { title: ctx.summary.title || '', date: ctx.summary.date || null }); if (ref && linkable(ref)) addEditorLink(ref); } }];
          const chosen = await host.objects.dropMenu(dragged, pt, { context: x ? { target: myRef(x.id, x.spaceId) } : {}, own, remember: x ? 'task' : 'list' });
          if (chosen && chosen.id !== 'link' && chosen.id !== 'create') showNote(`${chosen.label}: done`);
        } catch (err) {
          showNote(err.message);
        }
      },
    });
  }
  $('body').addEventListener('change', (e) => {
    const box = e.target.closest('[data-tick]');
    if (box) tick(box.dataset.tick, box.checked);
  });
  function startNew() {
    if (!canAdd()) return;
    openEditor(null);
  }
  // Typed text goes through Chat `/t` (addTask): parseWhen, then this same editor, nothing saved until Save.
  // Add task is the host's "+" (host.add.set, one action: it runs at once) wherever the To-do is drawn: a window's
  // titlebar, popped out, its own page, or the destination's page as its panel. Who may add is known once the spaces are in.
  const ADD_TASK = { id: 'task', label: 'Add task', icon: 'square-plus' };
  function showAdd() {
    host.add.set(canAdd() ? [ADD_TASK] : []).catch(() => {});
  }
  host.on('add', (e) => { if (e.id === ADD_TASK.id && canAdd()) startNew(); });

  // The status line at the foot of the window: what is open, due today and overdue among the tasks shown ("5 open · 2 due
  // today · 1 overdue"), and a chip when Done or All is shown. Hidden while there are no tasks. As the panel in a
  // Workspace's Calendar, the composite's status bar shows it beside the calendar's.
  const SHOW_WORDS = { done: 'Showing done', all: 'Showing all' };
  function syncStatus() {
    if (!host.status) return;
    const shown = [...tasks.values()].filter((x) => (x.scope === 'own' ? !(part && hideOwn) : !hiddenSpaces.has(x.spaceId)));
    const items = [];
    if ($('app') && !$('app').hidden && shown.length) { // once loaded
      const open = shown.filter((x) => !x.t.done);
      const today = open.filter((x) => dueGroup(x.t) === 'today').length;
      const late = open.filter((x) => dueGroup(x.t) === 'late').length;
      items.push({ text: open.length ? `${open.length} open` : 'Nothing open' });
      if (today) items.push({ text: `${today} due today` });
      if (late) items.push({ text: `${late} overdue` });
      if (SHOW_WORDS[show]) items.push({ text: SHOW_WORDS[show] });
    }
    host.status.set(items).catch(() => {});
  }

  // As the panel: the page's filter says whose tasks show (host.destination.onState); the panel sets nothing.
  let pickedSpaces = null;
  let loaded = false;
  function takeState(st) {
    if (!st || typeof st !== 'object') return;
    if (Array.isArray(st.spaces)) {
      pickedSpaces = new Set(st.spaces.map(String));
      hiddenSpaces.clear();
      for (const id of spaceInfo.keys()) if (!pickedSpaces.has(id)) hiddenSpaces.add(id);
    }
    // In a space the page has no filter of places (its state says `environment: false` for the aggregate's sake):
    // this space's own list always shows.
    hideOwn = !inSpace && st.environment === false;
    if (loaded) render();
  }
  if (part && host.destination) host.destination.onState(takeState);

  // As a part of the destination's page, say how tall the content is: a page too narrow for the panel beside the
  // list stacks the parts in its one scroll, each as tall as this, so nothing here scrolls on its own. Beside each
  // other the page ignores it. Not while an editor is open (it lifts the frame).
  if (part) {
    let told = -1;
    let queued = false;
    const tell = () => {
      queued = false;
      const app = $('app');
      const body = $('body');
      if (!app || !body || app.hidden || document.querySelector('dialog[open]')) return;
      // The lowest edge of what is last, margins included (down the last element of the last, as far as it goes).
      let edge = 0;
      for (let el = body.lastElementChild; el; el = el.lastElementChild) edge = Math.max(edge, el.getBoundingClientRect().bottom + (parseFloat(getComputedStyle(el).marginBottom) || 0));
      const tail = edge ? edge - body.getBoundingClientRect().top + body.scrollTop : 0;
      const h = Math.ceil(app.offsetHeight - body.offsetHeight + Math.max(tail, 0)) + 2;
      if (h === told) return;
      told = h;
      host.resize({ height: h });
    };
    const later = () => { if (!queued) { queued = true; requestAnimationFrame(tell); } };
    new MutationObserver(later).observe($('body'), { childList: true, subtree: true });
    new ResizeObserver(later).observe($('app'));
  }

  async function start() {
    try {
      await loadKinds();
      await loadAskable();
      await load();
    } catch (err) {
      showMsg('The to-do list could not load', err.message, start);
      return;
    }
    if (pickedSpaces) for (const id of spaceInfo.keys()) if (!pickedSpaces.has(id)) hiddenSpaces.add(id);
    showAdd();
    loaded = true;
    $('msg').hidden = true;
    $('loading').hidden = true;
    $('app').hidden = false;
    render();
  }
  await start();
  // Other modules say what happens to their objects (a poll closing, say); the host delivers what this module
  // was approved to hear. Each link on a task can carry a rule for an event it may report: tick the task, keep
  // the result in its notes, use it as the title, or link what the object picked. A task from before rules that
  // asked to follow a finished object keeps doing that (the conventional names closed, done, completed and
  // finished). Doing a rule twice is harmless.
  if (host.events && host.events.subscribe) {
    host.events.subscribe(async (e) => {
      if (!e.ref) return;
      const k = objectKey(e.ref);
      const summary = e.data && typeof e.data.summary === 'string' ? e.data.summary.slice(0, 200) : '';
      const pick = e.data && e.data.pick && typeof e.data.pick === 'object' && linkable(e.data.pick) ? e.data.pick : null;
      for (const x of [...tasks.values()]) {
        if (x.scope !== 'own' || !(x.t.links || []).some((r) => objectKey(r) === k)) continue;
        const rule = rulesFor(x.t)[k] && rulesFor(x.t)[k][e.name];
        if (!rule) continue;
        let t = { ...x.t };
        let ask = null;
        if (rule.startsWith('ask:')) {
          // Ask another module to do something; the first page to record it does the asking, the others fail to save.
          const a = askable.find((o) => 'ask:' + o.action === rule);
          const marker = k + '|' + e.name;
          if (!a || (e.id && t.fired && t.fired[marker] === e.id) || (e.data && e.data.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(e.data.date)))) continue;
          t = { ...t, fired: { ...(t.fired || {}), [marker]: e.id || Date.now() } };
          ask = { a, input: askInput(a, e) };
        }
        if ((rule === 'tick' || rule === 'both') && !t.done) t = { ...t, done: true, doneAt: Date.now() };
        if ((rule === 'note' || rule === 'both') && summary && !(t.notes || '').includes('Result: ' + summary)) t.notes = ((t.notes ? t.notes + '\n' : '') + 'Result: ' + summary).slice(0, 1000);
        if (rule === 'title' && summary && t.title !== summary) t.title = summary.slice(0, 200);
        if (rule === 'link' && pick && !(t.links || []).some((r) => objectKey(r) === objectKey(pick)) && (t.links || []).length < MAX_LINKS) t.links = [...(t.links || []), pick];
        if (JSON.stringify(t) === JSON.stringify(x.t)) continue;
        try {
          await put(x, t);
          applyReminder(t).catch(() => {});
          if (ask) {
            try {
              await host.actions.request(ask.a.action, ask.input);
              showNote(ask.a.moduleName + ': ' + ask.a.label + ' (from "' + t.title + '")');
            } catch (err) {
              showNote(err.message);
            }
          }
        } catch (err) {
          // changed or ticked by someone else meanwhile
        }
      }
      render();
    });
  }

  // What other modules may ask of this one about a task it names: link it to something, or set its due date. On the
  // environment page that may be one of a space's tasks, where the viewer may change it.
  const taskFor = (ref) => {
    if (!ref || ref.kind !== 'task') return null;
    if (ref.scope === 'space' && !inSpace) return tasks.get(keyOf('spaces', ref.id, ref.space)) || null;
    return tasks.get('own:' + ref.id) || null;
  };
  const ownTask = (ref) => {
    const x = taskFor(ref);
    if (!x || !writable(x)) throw new Error('that task is not here');
    return x;
  };
  // What other modules may ask of this one. A task made this way links to the object it came from.
  if (host.actions && host.actions.provide) {
    host.actions.provide({
      // With `object` (plan-object-handoff.md): a task made of it (taskFromObject in todo-lib.js), due on a task's day.
      // `due` given on its own is the due date whatever the object says.
      createTask: async (input, meta) => {
        const made = input.object && typeof input.object === 'object' ? taskFromObject(input.object, host.util) : null;
        const title = (made && made.title) || String(input.title || '').trim();
        if (!title) throw new Error('a task needs a title');
        const t = {
          id: newId(), title, notes: made ? made.notes : input.notes || '', due: input.due || (made && made.due) || null, remind: false, done: false, doneAt: null,
          createdAt: Date.now(), by: (meta && meta.by) || 'someone', links: input.ref && linkable(input.ref) ? [input.ref] : [], autoDone: false,
        };
        await put(null, t);
        render();
        resolveLinks();
        return { ref: myRef(t.id) };
      },
      linkTask: async (input) => {
        const x = ownTask(input.task);
        if (!linkable(input.target)) throw new Error('this list may not link to that');
        await linkTo(x.key, input.target);
        return { ref: myRef(x.id, x.spaceId) };
      },
      setTaskDue: async (input) => {
        const x = ownTask(input.task);
        const t = { ...x.t, due: input.date, remind: x.t.remind };
        await put(x, t);
        applyReminder(t, whereOf(x)).catch(() => {});
        render();
        return { ref: myRef(x.id, x.spaceId) };
      },
      addTask: async (input) => {
        if (!canAdd()) throw new Error('this person cannot add tasks here');
        const parsed = input.text && host.util.parseWhen ? host.util.parseWhen(input.text) : { title: input.text || '' };
        openEditor(null, parsed);
        return {};
      },
    });
  }

  // Another module asking to show one of this module's tasks (from a link to it): open it.
  if (host.objects && host.objects.onOpen) {
    host.objects.onOpen((ref) => {
      const x = taskFor(ref);
      if (x) openEditor(x);
    });
  }
  resolveLinks();
  // Tell the host about links made before it was told (and only those that changed).
  for (const x of [...tasks.values()].filter((t) => t.scope === 'own' && (t.t.links || []).length).slice(0, 100)) syncLinks(x, x.t.links);
  // The objects linked to can change or go; look again now and then.
  const relook = setInterval(() => { if (!$('body')) return void clearInterval(relook); summaries.clear(); resolveLinks(); }, 60000);
})();
