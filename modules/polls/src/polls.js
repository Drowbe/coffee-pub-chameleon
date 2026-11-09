// Polls module. One file of code for every place it shows: the environment's own page, a space's
// canvas (docked or floating), and a window of its own. Each place has its own polls; on
// the environment page the viewer's spaces' polls are shown too, read-only, under their space's
// icon. The SDK (window.host) is injected by the host.
//
// A poll is for deciding something together (where to go, where to stay, what to do): each
// option can carry a short detail, a poll can let people suggest more options while it is
// open, and a closed poll marks its winner.
//
// Storage: `poll:<id>` is the poll; `vote:<pollId>:<userKey>` is one person's vote. Each
// person writes only their own vote key, so two people voting at once never conflict.
// A vote records the voter's name, so results can show who voted for what.
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
  const { esc, objectKey, id: newId } = host.util;

  /*__LIB__*/

  let info;
  try {
    info = await host.ready();
  } catch (err) {
    showMsg('Polls could not start', err.message, () => location.reload());
    return;
  }
  const inSpace = info.context.scope === 'space';
  const me = info.user.key;
  // What the environment's owners and this space's moderators chose (Module settings): a new poll's starting point.
  let prefs = { addableByDefault: false, closeAfterDays: 0 };
  const loadPrefs = () => host.settings.get().then((v) => { prefs = { ...prefs, ...v }; }).catch(() => {});
  await loadPrefs();
  host.settings.onChange((v) => { prefs = { ...prefs, ...v }; });
  const canVote = host.can('vote');
  const canCreate = host.can('create');
  const MAX_OPTIONS = 20;

  // An option can point at an object in another module (a place to stay, a date on the calendar): drop the object
  // on the option. When the poll closes, the object the winning option points at goes out with the result, for
  // whoever follows the poll to use. What may be linked is whatever other modules share and the host allows.
  let consumable = new Set();
  const linkable = (r) => Boolean(r) && consumable.has(r.module + ':' + r.kind);
  const optSummaries = new Map(); // pointer key -> summary, or { error }
  async function loadKinds() {
    try {
      consumable = new Set((await host.objects.kinds()).map((k) => k.module + ':' + k.kind));
    } catch (err) {
      consumable = new Set();
    }
  }

  // Every poll we know of by key, and each poll's votes. `scope` is 'own' (this place's poll) or
  // 'spaces' (another space's, read-only). The votes are keyed by the poll's key, then the voter's.
  const polls = new Map();
  const votes = new Map();
  const spaceInfo = new Map(); // space id -> { id, name, icon, svg }, on the environment page
  const hiddenSpaces = new Set();
  let show = 'open';

  // --- storage --------------------------------------------------------------

  const pollKey = (scope, id, spaceId) => (scope === 'spaces' ? `spaces:${spaceId}:${id}` : `own:${id}`);
  function rememberPoll(scope, item, spaceId) {
    const id = item.key.slice(5);
    const key = pollKey(scope, id, spaceId);
    polls.set(key, { key, scope, spaceId, id, version: item.version, p: item.value });
  }
  // vote:<pollId>:<userKey>
  function rememberVote(scope, item, spaceId) {
    const [, id, user] = item.key.split(':');
    if (!id || !user) return;
    const key = pollKey(scope, id, spaceId);
    if (!votes.has(key)) votes.set(key, new Map());
    votes.get(key).set(user, item.value);
  }
  function forgetVote(scope, itemKey, spaceId) {
    const [, id, user] = itemKey.split(':');
    const key = pollKey(scope, id, spaceId);
    if (votes.has(key)) votes.get(key).delete(user);
  }

  async function load() {
    polls.clear();
    votes.clear();
    for (const item of await host.storage.list('poll:')) if (item.value) rememberPoll('own', item);
    for (const item of await host.storage.list('vote:')) if (item.value) rememberVote('own', item);
    if (!inSpace && info.context.scope === 'environment') {
      try {
        for (const r of await host.spaces()) spaceInfo.set(r.id, r);
        for (const item of await host.storage.list('poll:', { scope: 'spaces' })) if (item.value) rememberPoll('spaces', item, item.spaceId);
        for (const item of await host.storage.list('vote:', { scope: 'spaces' })) if (item.value) rememberVote('spaces', item, item.spaceId);
      } catch (err) {
        // just this place's own polls
      }
    }
  }

  // One change: kept, not drawn. False when it is not a poll or a vote.
  function applyChange(e) {
    const scope = e.scope === 'spaces' ? 'spaces' : 'own';
    if (e.key.startsWith('poll:')) {
      const key = pollKey(scope, e.key.slice(5), e.spaceId);
      if (e.deleted) {
        polls.delete(key);
        votes.delete(key);
      } else {
        rememberPoll(scope, { key: e.key, value: e.value, version: e.version }, e.spaceId);
      }
    } else if (e.key.startsWith('vote:')) {
      if (e.deleted) forgetVote(scope, e.key, e.spaceId);
      else rememberVote(scope, { key: e.key, value: e.value }, e.spaceId);
    } else {
      return false;
    }
    return true;
  }
  host.on('change', (e) => {
    if (applyChange(e)) render();
  });
  // Many at once (a Clear, its Undo): kept in one pass, drawn once. Keys only (a big event comes without values): read again.
  host.on('changes', (e) => {
    const list = (Array.isArray(e.changes) ? e.changes : []).map((c) => ({ ...c, scope: e.scope, spaceId: e.spaceId })).filter((c) => String(c.key).startsWith('poll:') || String(c.key).startsWith('vote:'));
    if (!list.length) return;
    if (list.some((c) => !c.deleted && c.value === undefined)) { load().then(render).catch(() => {}); return; }
    let any = false;
    for (const c of list) any = applyChange(c) || any;
    if (any) render();
  });

  // --- what links to a poll, and being opened from a link ---------------------
  // Other modules (a to-do, say) can point at a poll. The host says what points at it, only what the
  // viewer may see (host.objects.linksTo), and a link to a poll can ask for it to be shown
  // (host.objects.onOpen). Nothing here knows which modules those are.

  const backlinks = new Map(); // poll key -> summaries
  const asked = new Set();
  function askBacklinks() {
    if (!host.objects || !host.objects.linksTo) return;
    for (const x of polls.values()) {
      if (asked.has(x.key)) continue;
      asked.add(x.key);
      const ref = host.objects.make('poll', x.id, x.scope === 'spaces' ? { space: x.spaceId } : undefined);
      host.objects.linksTo(ref).then((summaries) => {
        if (JSON.stringify(summaries.map((c) => c.ref)) === JSON.stringify((backlinks.get(x.key) || []).map((c) => c.ref)) && backlinks.has(x.key)) return;
        backlinks.set(x.key, summaries);
        render();
      }).catch(() => backlinks.set(x.key, []));
    }
  }
  const backlinksHtml = (x) => {
    const summaries = backlinks.get(x.key) || [];
    if (!summaries.length) return '';
    return `<div class="meta">Linked from ${summaries.map((c) => (c.open
      ? `<button type="button" class="sdk-chip-tag" data-ref="${esc(JSON.stringify(c.ref))}"><b>${esc(c.kindName || c.module.name)}</b> ${esc(c.title)}</button>`
      : `<span class="sdk-chip-tag"><b>${esc(c.kindName || c.module.name)}</b> ${esc(c.title)}</span>`)).join(' ')}</div>`;
  };
  if (host.objects && host.objects.onOpen) {
    host.objects.onOpen((ref) => {
      const key = polls.has('own:' + ref.id) ? 'own:' + ref.id : `spaces:${ref.space}:${ref.id}`;
      if (!polls.has(key)) return;
      show = 'all';
      hiddenSpaces.delete(ref.space);
      render();
      const el = root.querySelector(`[data-poll="${CSS.escape(key)}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.classList.add('on');
        setTimeout(() => el.classList.remove('on'), 2000);
      }
    });
    host.on('links', (e) => {
      if (!e.ref || e.ref.kind !== 'poll') return;
      for (const x of polls.values()) if (x.id === e.ref.id) asked.delete(x.key);
      askBacklinks();
    });
  }

  // --- state of a poll --------------------------------------------------------

  const isClosed = (p) => Boolean(p.closed) || (p.closesAt && Date.now() >= p.closesAt);

  function tally(x) {
    const byVoter = votes.get(x.key) || new Map();
    const counts = new Map(x.p.options.map((o) => [o.id, []]));
    for (const [user, v] of byVoter) for (const id of v.options || []) if (counts.has(id)) counts.get(id).push(v.name || user);
    return { counts, voters: byVoter.size, mine: (byVoter.get(me) || {}).options || [] };
  }

  // --- drawing -------------------------------------------------------------

  const spaceIcon = (spaceId) => {
    const r = spaceInfo.get(spaceId);
    return r && r.svg ? `<span class="ri">${r.svg}</span>` : '';
  };

  function closesText(p) {
    if (p.closed) return 'Closed';
    if (!p.closesAt) return '';
    const d = new Date(p.closesAt);
    const when = d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: host.util.hour12() });
    return Date.now() >= p.closesAt ? `Closed ${when}` : `Closes ${when}`;
  }

  const manageAny = host.can('manage_any'); // close, change and delete polls other people started (owners always can)
  const mayManage = (x) => canCreate && x.scope === 'own' && (x.p.byKey === me || manageAny);
  function optionLinkHtml(x, o) {
    if (!o.link) return '';
    const c = optSummaries.get(objectKey(o.link));
    const remove = mayManage(x) && !isClosed(x.p) ? `<button class="x" type="button" data-unlink="${esc(x.key)}|${esc(o.id)}" aria-label="Remove link">&times;</button>` : '';
    if (!c) return '<div class="optlink"><span class="sdk-chip-tag">Loading...</span></div>';
    if (c.error) return `<div class="optlink"><span class="sdk-chip-tag" title="Deleted, or not something you can see">Not available</span>${remove}</div>`;
    const body = `<b>${esc(c.kindName || c.module.name)}</b> ${esc(c.title)}`;
    return `<div class="optlink">${c.open ? `<button type="button" class="sdk-chip-tag" data-ref="${esc(JSON.stringify(c.ref))}">${body}</button>` : `<span class="sdk-chip-tag">${body}</span>`}${remove}</div>`;
  }
  async function resolveOptionLinks() {
    if (!host.objects || !host.objects.resolve) return;
    const want = new Map();
    for (const x of polls.values()) for (const o of x.p.options) if (o.link && !optSummaries.has(objectKey(o.link))) want.set(objectKey(o.link), o.link);
    if (!want.size) return;
    const list = [...want.values()].slice(0, 50);
    try {
      const got = await host.objects.resolve(list);
      list.forEach((r, i) => optSummaries.set(objectKey(r), got[i] || { error: 'unavailable' }));
    } catch (err) {
      list.forEach((r) => optSummaries.set(objectKey(r), { error: 'unavailable' }));
    }
    render();
  }
  // Tell the host what this poll points at (all its options' links, as one list), so those objects can show it.
  const syncedOptionLinks = new Map();
  async function syncOptionLinks(x) {
    if (!host.objects || !host.objects.setLinks || x.scope !== 'own') return;
    const links = x.p.options.filter((o) => o.link).map((o) => o.link);
    const sig = JSON.stringify(links.map(objectKey));
    if (syncedOptionLinks.get(x.id) === sig || (!links.length && !syncedOptionLinks.has(x.id))) return;
    syncedOptionLinks.set(x.id, sig);
    try {
      await host.objects.setLinks(host.objects.make('poll', x.id), links);
    } catch (err) {
      syncedOptionLinks.delete(x.id);
    }
  }
  async function setOptionLink(key, optionId, ref) {
    const x = polls.get(key);
    if (!x || !mayManage(x) || isClosed(x.p)) return;
    if (ref && !linkable(ref)) return showNote('A poll option cannot link to that.');
    const p = { ...x.p, options: x.p.options.map((o) => {
      if (o.id !== optionId) return o;
      const { link, ...rest } = o;
      return ref ? { ...rest, link: ref } : rest;
    }) };
    try {
      const saved = await host.storage.set('poll:' + x.id, p, { version: x.version });
      rememberPoll('own', { key: 'poll:' + x.id, value: p, version: saved.version });
      syncOptionLinks(polls.get(key));
      resolveOptionLinks();
    } catch (err) {
      showNote(err.status === 409 ? 'Someone changed that poll first. It has been refreshed.' : err.message);
      try { await load(); } catch (e) { /* keep what we have */ }
    }
    render();
  }

  function pollHtml(x) {
    const p = x.p;
    const closed = isClosed(p);
    const { counts, voters, mine } = tally(x);
    const votable = canVote && !closed && x.scope === 'own';
    const max = Math.max(0, ...[...counts.values()].map((v) => v.length));
    const leaders = closed && max > 0 ? p.options.filter((o) => counts.get(o.id).length === max) : [];
    const opts = p.options.map((o) => {
      const names = counts.get(o.id);
      const width = voters ? Math.round((names.length / Math.max(voters, max, 1)) * 100) : 0;
      const win = leaders.some((l) => l.id === o.id);
      return `<button type="button" class="sdk-row opt ${mine.includes(o.id) ? 'on mine' : ''} ${win ? 'win' : ''}" data-vote="${esc(x.key)}|${esc(o.id)}" ${votable ? '' : 'disabled'}>
        <span class="sdk-progress-behind" role="progressbar" aria-label="Votes for ${esc(o.text)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${width}" aria-valuetext="${names.length} of ${voters || 0} voted for it" style="--pct:${width}%"></span><span class="name">${esc(o.text)}${o.date ? `<small>${esc(new Date(o.date + 'T00:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }))}</small>` : ''}${o.desc ? `<small>${esc(o.desc)}</small>` : ''}</span><span class="num">${win ? (leaders.length > 1 ? 'Tied &middot; ' : 'Winner &middot; ') : ''}${names.length}</span></button>
        ${names.length ? `<div class="who">${esc(names.join(', '))}</div>` : ''}${optionLinkHtml(x, o)}`;
    }).join('');
    const canManage = mayManage(x);
    const status = closesText(p);
    return `<article class="sdk-card-banded poll ${closed ? 'closed' : ''}" data-poll="${esc(x.key)}">
      <header class="sdk-card-head"><div class="sdk-card-main"><h3 class="sdk-card-title" data-drag="${esc(x.key)}" title="${esc(p.question)}. Drag onto a to-do to link it">${esc(p.question)}</h3><span class="sdk-card-sub">${voters} ${voters === 1 ? 'vote' : 'votes'}</span></div>${canManage ? `<button class="sdk-icon-btn btn-quiet btn-small" type="button" data-menu="${esc(x.key)}" aria-haspopup="menu" aria-label="Poll actions" title="Poll actions">${moreSvg}</button>` : ''}</header>
      <div class="sdk-card-body">
      <div class="meta">${p.multi ? 'Pick any' : 'Pick one'}${status ? `<span class="sdk-chip-tag">${esc(status)}</span>` : ''}<br>Started by ${esc(p.by || 'someone')}</div>
      <div class="sdk-card-list">${opts}</div>
      ${p.addable && votable && p.options.length < MAX_OPTIONS ? `<div class="addopt"><input type="text" maxlength="100" placeholder="Suggest another option" data-addtext="${esc(x.key)}" aria-label="Suggest another option"><button class="btn btn-small" type="button" data-addopt="${esc(x.key)}">Add</button></div>` : ''}
      ${x.scope === 'spaces' && !closed ? `<div class="meta">Vote in that ${esc(word('space'))}.</div>` : ''}
      ${backlinksHtml(x)}
      ${closed && x.scope === 'own' && offeredFor(x).length ? `<div class="actions">${offeredFor(x).map((a) => `<button class="btn btn-small" type="button" data-action="${esc(x.key)}|${esc(a.action)}" title="${esc(a.moduleName)}">${esc(a.label)}</button>`).join('')}</div>` : ''}
      </div>
    </article>`;
  }

  function groupHtml(label, list) {
    const shown = list.filter((x) => (show === 'all' ? true : show === 'closed' ? isClosed(x.p) : !isClosed(x.p)));
    if (!shown.length) return '';
    shown.sort((a, b) => (b.p.createdAt || 0) - (a.p.createdAt || 0));
    return `<section class="sdk-list-group">${label ? `<h4 class="sdk-group-head">${label}</h4>` : ''}<div class="sdk-list">${shown.map(pollHtml).join('')}</div></section>`;
  }

  // Open / Closed / All is the toolbar's view switch: host.ui.viewSwitch draws it, tracks the current
  // choice and only redraws when the value or a label (the open count) actually changes.
  const FILTERS = [
    { id: 'open', label: 'Open', icon: 'lock-open' },
    { id: 'closed', label: 'Closed', icon: 'lock' },
    { id: 'all', label: 'All', icon: 'list' },
  ];
  const filterSwitch = host.ui.viewSwitch({
    id: 'filter',
    label: 'Show',
    options: FILTERS,
    value: show,
    onChange: (id) => { show = id; render(); },
  });
  // The "..." on a poll: the one icon every "..." in the host wears (see architecture-module-window.md), fetched
  // once as inline SVG since this page builds its markup from strings.
  let moreSvg = '';
  host.ui.icon('ellipsis-vertical').then((svg) => { moreSvg = svg; render(); }).catch(() => {});

  function render() {
    const own = [...polls.values()].filter((x) => x.scope === 'own');
    const open = own.filter((x) => !isClosed(x.p)).length;
    syncToolbar();
    filterSwitch.set(show, FILTERS.map((f) => (f.id === 'open' && open ? { ...f, count: open } : f)));

    let html = groupHtml(spaceInfo.size ? word('environment', { cap: true }) : '', own);
    for (const r of spaceInfo.values()) {
      if (hiddenSpaces.has(r.id)) continue;
      html += groupHtml(`${spaceIcon(r.id)} ${esc(r.name)}`, [...polls.values()].filter((x) => x.scope === 'spaces' && x.spaceId === r.id));
    }
    askBacklinks();
    $('body').innerHTML = html || `<p class="sdk-empty">${show === 'closed' ? 'No closed polls.' : 'No open polls.'}${canCreate && show !== 'closed' ? ' Start one to get a vote going.' : ''}</p>`;
    syncStatus();
    syncAttention();
  }

  // The status line at the foot of the window: the open polls shown, and how many of this place's still wait for this
  // person's vote ("2 open polls · 1 waiting for your vote"); a chip when Closed or All is shown. Hidden while there are none.
  const SHOW_WORDS = { closed: 'Showing closed', all: 'Showing all' };
  function syncStatus() {
    if (!host.status) return;
    const shown = [...polls.values()].filter((x) => x.scope === 'own' || !hiddenSpaces.has(x.spaceId));
    const items = [];
    if (shown.length) {
      const open = shown.filter((x) => !isClosed(x.p));
      const waiting = canVote ? open.filter((x) => x.scope === 'own' && !tally(x).mine.length).length : 0;
      items.push({ text: open.length ? `${open.length} open ${open.length === 1 ? 'poll' : 'polls'}` : 'No open polls' });
      if (waiting) items.push({ text: `${waiting} waiting for your vote` });
      if (SHOW_WORDS[show]) items.push({ text: SHOW_WORDS[show] });
    }
    host.status.set(items).catch(() => {});
  }

  // What needs this person's action, for the space's status strip ("2 need action"): the open polls in this space they
  // have not voted in, as the widget counts them. Told when Polls runs here and after each vote (every render), and only
  // when the words change. Nothing in an environment page, or for someone who may not vote.
  let attentionSent = null;
  function syncAttention() {
    if (!inSpace || !host.attention) return;
    const waiting = canVote ? [...polls.values()].filter((x) => x.scope === 'own' && !isClosed(x.p) && !tally(x).mine.length) : [];
    const shown = waiting.slice(0, 20);
    const report = { count: Math.min(99, waiting.length), label: 'to vote in', items: shown.map((x) => ({ title: String(x.p.question || 'A poll').slice(0, 120), object: host.objects.make('poll', x.id) })) };
    const key = JSON.stringify(report);
    if (key === attentionSent) return;
    attentionSent = key;
    (report.count ? host.attention.set(report) : host.attention.clear()).catch(() => { attentionSent = null; });
  }

  function showNote(text, ok) {
    $('note').textContent = text;
    $('note').classList.toggle('ok', Boolean(ok));
    $('note').hidden = !text;
    if (text) setTimeout(() => { $('note').hidden = true; }, 5000);
  }

  // What other modules can do for a finished poll (whatever they offer that takes a title; offeredFor keeps those it can fill), offered as
  // buttons named by the action, so nothing here knows which modules there are.
  let offered = [];
  async function loadActions() {
    if (!host.actions || !canVote) return;
    try {
      offered = (await host.actions.list()).filter((a) => a.input && a.input.title);
    } catch (err) {
      offered = [];
    }
  }
  // Only what this poll can fill (pollFills in polls-lib.js): an action that needs a date (the Calendar's) only when the winning
  // option stands for a day, which it is given; never one that requires something a poll does not have (a link's address).
  const offeredFor = (x) => offered.filter((a) => pollFills(a, Boolean(pickOf(x).date)));
  async function runAction(key, action) {
    const x = polls.get(key);
    const a = offeredFor(x).find((o) => o.action === action);
    if (!x || !a) return;
    const { winner } = winnerOf(x);
    const input = { title: winner ? `${x.p.question}: ${winner}` : x.p.question };
    if (a.input.notes) input.notes = x.p.question;
    if (a.input.date && pickOf(x).date) input.date = pickOf(x).date;
    if (a.input.ref) input.ref = host.objects.make('poll', x.id, x.scope === 'spaces' ? { space: x.spaceId } : undefined);
    try {
      await host.actions.request(action, input);
      showNote(`Sent to ${a.moduleName}: ${a.label}`, true);
    } catch (err) {
      showNote(err.message);
    }
  }

  // --- voting and managing -----------------------------------------------------

  async function vote(key, optionId) {
    const x = polls.get(key);
    if (!x || x.scope !== 'own' || !canVote || isClosed(x.p)) return;
    const mine = tally(x).mine;
    // One choice: picking the same option again takes the vote back. Several: each option toggles.
    const next = x.p.multi
      ? (mine.includes(optionId) ? mine.filter((o) => o !== optionId) : [...mine, optionId])
      : (mine.length === 1 && mine[0] === optionId ? [] : [optionId]);
    const voteKey = `vote:${x.id}:${me}`;
    try {
      if (!next.length) {
        await host.storage.delete(voteKey);
        forgetVote('own', voteKey);
      } else {
        const value = { options: next, name: info.user.name, at: Date.now() };
        await host.storage.set(voteKey, value);
        rememberVote('own', { key: voteKey, value });
      }
    } catch (err) {
      showNote(err.message);
    }
    render();
  }

  // Closing a poll is something other modules may care about (a task waiting on it, say): say so through
  // the host, which delivers it to whichever modules were approved to hear it. Nothing here knows which.
  function winnerOf(x) {
    const { counts } = tally(x);
    const max = Math.max(0, ...[...counts.values()].map((v) => v.length));
    const top = max > 0 ? x.p.options.filter((o) => counts.get(o.id).length === max) : [];
    return { winner: top.length === 1 ? top[0].text : null, tied: top.length > 1 ? top.map((o) => o.text).slice(0, 5) : [] };
  }
  // The object the winning option points at, when there is one winner and it points at something.
  function pickOf(x) {
    const { winner } = winnerOf(x);
    const o = winner ? x.p.options.find((opt) => opt.text === winner) : null;
    return { ...(o && o.link ? { pick: o.link } : {}), ...(o && o.date ? { date: o.date } : {}) };
  }
  // A short line on how it turned out, for whoever follows the poll.
  function summaryOf(x) {
    const { winner, tied } = winnerOf(x);
    return (winner ? `${x.p.question}: ${winner}` : tied.length ? `${x.p.question}: tied between ${tied.join(', ')}` : `${x.p.question}: no votes`).slice(0, 200);
  }
  const announcing = new Set();
  async function announceClosed(x) {
    try {
      await host.events.publish('closed', { ref: host.objects.make('poll', x.id), data: { ...winnerOf(x), summary: summaryOf(x), ...pickOf(x) } });
    } catch (err) {
      // nobody may hear it, or this person cannot publish: the poll is closed either way
      if (host.objects && host.objects.trace) host.objects.trace('polls: could not announce the close: ' + err.message);
    }
  }
  // A poll that closes by its time closes with nobody clicking: whoever sees it first announces it, once.
  async function announceIfDue() {
    if (!host.events || !canVote) return;
    for (const x of polls.values()) {
      if (x.scope !== 'own' || x.p.closed || x.p.announced || !x.p.closesAt || Date.now() < x.p.closesAt || announcing.has(x.key)) continue;
      announcing.add(x.key);
      const p = { ...x.p, announced: true };
      try {
        const saved = await host.storage.set('poll:' + x.id, p, { version: x.version });
        rememberPoll('own', { key: 'poll:' + x.id, value: p, version: saved.version });
        await announceClosed({ ...x, p });
      } catch (err) {
        // someone else got there first
      }
    }
  }

  async function setClosed(key) {
    const x = polls.get(key);
    if (!x) return;
    const closing = !isClosed(x.p);
    const p = { ...x.p, closed: closing, closesAt: closing ? x.p.closesAt : null, announced: closing };
    try {
      const saved = await host.storage.set('poll:' + x.id, p, { version: x.version });
      rememberPoll('own', { key: 'poll:' + x.id, value: p, version: saved.version });
      if (closing) announceClosed({ ...x, p });
    } catch (err) {
      showNote(err.status === 409 ? 'Someone changed that poll first. It has been refreshed.' : err.message);
      try { await load(); } catch (e) { /* keep what we have */ }
    }
    render();
  }

  // Anyone who can vote may add an option to a poll that allows it. The poll is one stored value,
  // so if someone changed it meanwhile, reload and try once more.
  async function addOption(key, text) {
    text = text.trim();
    if (!text) return;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const x = polls.get(key);
      if (!x || !x.p.addable || isClosed(x.p) || !canVote) return;
      if (x.p.options.length >= MAX_OPTIONS) return showNote('That poll has all the options it can hold.');
      if (x.p.options.some((o) => o.text.toLowerCase() === text.toLowerCase())) return showNote('That option is already there.');
      const p = { ...x.p, options: [...x.p.options, { id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), text, by: info.user.name }] };
      try {
        const saved = await host.storage.set('poll:' + x.id, p, { version: x.version });
        rememberPoll('own', { key: 'poll:' + x.id, value: p, version: saved.version });
        break;
      } catch (err) {
        if (err.status !== 409 || attempt === 1) return showNote(err.message);
        await load();
      }
    }
    render();
  }

  // The menu item arms itself in place (its own label becomes "Really delete?") rather than closing and
  // reopening; returning `false` to host.menu.show is what keeps it open for that second click.
  const armed = new Set();
  async function remove(key, button) {
    const x = polls.get(key);
    if (!x) return;
    if (!armed.has(key)) {
      armed.add(key);
      const label = button && button.querySelector('.sdk-menu-label');
      if (label) label.textContent = 'Really delete?';
      setTimeout(() => armed.delete(key), 4000);
      return false;
    }
    armed.delete(key);
    try {
      // The server removes its votes with it (closed or not: a closed poll's votes are final on their own).
      await host.storage.delete('poll:' + x.id);
      polls.delete(key);
      votes.delete(key);
    } catch (err) {
      showNote(err.message);
    }
    render();
  }

  // --- the editor -----------------------------------------------------------

  function showError(text) {
    $('f-error').textContent = text;
    $('f-error').hidden = !text;
  }

  // One row per option: its name, and an optional detail (a price, a place, a date).
  function addOptionField() {
    const row = document.createElement('div');
    row.className = 'opt-row';
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'o-text';
    name.maxLength = 100;
    name.placeholder = `Option ${$('f-options').children.length + 1}`;
    const desc = document.createElement('input');
    desc.type = 'text';
    desc.className = 'o-desc';
    desc.maxLength = 140;
    desc.placeholder = 'Detail (optional)';
    const dateWrap = document.createElement('div');
    dateWrap.className = 'o-datewrap sdk-field';
    const date = document.createElement('input');
    date.type = 'date';
    date.className = 'o-date';
    date.title = 'A date this option stands for (optional)';
    date.setAttribute('aria-label', 'Date (optional)');
    // The date picker writes the weekday into the hint of the field it is in: each option's date is a field of its own.
    const weekday = document.createElement('span');
    weekday.className = 'sdk-hint';
    dateWrap.append(date, weekday);
    row.append(name, desc, dateWrap);
    $('f-options').appendChild(row);
    host.ui.datePicker(date, { clearable: true });
    $('f-more').hidden = $('f-options').children.length >= MAX_OPTIONS;
    return name;
  }

  const closesPicker = host.ui.datePicker($('f-closes'), { clearable: true });
  // The closing time is a day and a time (12:00 when the day has no time), kept together as 'YYYY-MM-DDTHH:MM'.
  const closesValue = () => ($('f-closes').value ? `${$('f-closes').value}T${$('f-closes-time').value || '12:00'}` : '');
  const setCloses = (v) => { const [day, time] = String(v || '').split('T'); $('f-closes').value = day || ''; $('f-closes-time').value = time || '12:00'; };
  // The form opens as the editor window (host.ui.editor): over everything, sized to the form, a sheet on a phone. What
  // the form held when it opened, as text, so Escape and Close can ask "Discard your changes?" only after something changed.
  let opened = null;
  const formSnapshot = () => JSON.stringify({
    question: $('f-question').value,
    options: [...$('f-options').children].map((r) => [r.querySelector('.o-text').value, r.querySelector('.o-desc').value, r.querySelector('.o-date').value]),
    multi: $('f-multi').checked,
    addable: $('f-addable').checked,
    closes: closesValue(),
    notify: $('f-notify').checked,
  });
  const editor = host.ui.editor($('editor'), {
    size: 'medium',
    isDirty: () => opened !== null && formSnapshot() !== opened,
    onClose: () => { opened = null; },
  });
  // `prefill`: a quick add's { title, date?, time? }, or a draft's { title, options, closes, multi } (pollFromObject).
  function openEditor(prefill) {
    showError('');
    $('f-question').value = '';
    $('f-options').innerHTML = '';
    const given = prefill && Array.isArray(prefill.options) ? prefill.options.slice(0, MAX_OPTIONS) : [];
    for (let i = 0; i < Math.max(2, given.length); i += 1) {
      const field = addOptionField();
      if (given[i]) field.value = given[i];
    }
    $('f-multi').checked = Boolean(prefill && prefill.multi);
    $('f-addable').checked = Boolean(prefs.addableByDefault);
    // A quick add fills the question, and the closing time when a day was typed (12:00 unless a time was).
    $('f-question').value = (prefill && prefill.title) || '';
    const closes = prefill && prefill.closes ? prefill.closes : prefill && prefill.date ? prefill.date + 'T' + (prefill.time || '12:00') : '';
    setCloses(closes && new Date(closes).getTime() > Date.now() ? closes : '');
    if (!$('f-closes').value && prefs.closeAfterDays > 0) {
      const d = new Date(Date.now() + prefs.closeAfterDays * 24 * 60 * 60 * 1000);
      setCloses(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T12:00`);
    }
    closesPicker.refresh();
    $('f-notify').checked = false;
    opened = formSnapshot();
    // Focus goes back to whatever had it (the host's "+", the action bar, Chat).
    editor.open({ focus: $('f-question') });
  }
  // After Start poll: closes at once, nothing asked.
  function closeEditor() {
    opened = null;
    editor.close();
  }
  // Cancel goes the way the SDK's own Close does (editor.cancel), so it asks "Discard your changes?" after typing.
  $('f-more').addEventListener('click', () => addOptionField().focus());
  $('f-cancel').addEventListener('click', () => editor.cancel());

  async function save() {
    showError('');
    const question = $('f-question').value.trim();
    const rows = [...$('f-options').children]
      .map((r) => ({ text: r.querySelector('.o-text').value.trim(), desc: r.querySelector('.o-desc').value.trim(), date: r.querySelector('.o-date').value }))
      .filter((o) => o.text);
    if (!question) return showError('A poll needs a question.');
    if (rows.length < 2) return showError('Give at least two options.');
    if (new Set(rows.map((o) => o.text.toLowerCase())).size !== rows.length) return showError('Two options are the same.');
    let closesAt = null;
    if ($('f-closes').value) {
      closesAt = new Date(closesValue()).getTime();
      if (Number.isNaN(closesAt) || closesAt <= Date.now()) return showError('The closing time has to be in the future.');
    }
    const p = {
      id: newId(),
      question,
      options: rows.map((o, i) => ({ id: 'o' + (i + 1), text: o.text, ...(o.desc ? { desc: o.desc } : {}), ...(o.date ? { date: o.date } : {}) })),
      multi: $('f-multi').checked,
      addable: $('f-addable').checked,
      closed: false,
      closesAt,
      createdAt: Date.now(),
      by: info.user.name,
      byKey: me,
    };
    $('f-save').disabled = true;
    try {
      const saved = await host.storage.set('poll:' + p.id, p);
      rememberPoll('own', { key: 'poll:' + p.id, value: p, version: saved.version });
      if ($('f-notify').checked) {
        try { await host.notify({ title: 'New poll', body: question }); } catch (err) { showNote('Started, but people could not be notified: ' + err.message); }
      }
      closeEditor();
      show = 'open';
      render();
    } catch (err) {
      showError(err.message);
    } finally {
      $('f-save').disabled = false;
    }
  }
  $('f-save').addEventListener('click', save);
  $('form').addEventListener('submit', (e) => { e.preventDefault(); save(); });
  $('form').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    // Enter in an option's name moves on: to a new row from the last one, else to its detail.
    if (e.target.matches('.o-text')) {
      if (!e.target.value.trim()) return;
      const row = e.target.parentElement;
      if (row === $('f-options').lastElementChild && !$('f-more').hidden) addOptionField().focus();
      else row.querySelector('.o-desc').focus();
      return;
    }
    if (e.target.matches('.o-desc')) {
      const next = e.target.parentElement.nextElementSibling;
      if (next) next.querySelector('.o-text').focus();
      else if (!$('f-more').hidden) addOptionField().focus();
      return;
    }
    save();
  });

  // --- wiring ---------------------------------------------------------------

  // The toolbar row: the view switch leads it; on the environment page the row's Filters menu has a switch for each of the
  // viewer's spaces, to show or hide its polls.
  const ICON_NAME = /^[a-z0-9-]{1,40}$/;
  function syncToolbar() {
    const chips = spaceInfo.size
      ? [{ type: 'chips', id: 'spaces', label: word('space', { many: true, cap: true }), options: [...spaceInfo.values()].map((r) => ({ id: r.id, label: r.name, ...(ICON_NAME.test(r.icon || '') ? { icon: r.icon } : {}), on: !hiddenSpaces.has(r.id) })) }]
      : [];
    host.toolbar.set(chips).catch(() => {});
  }
  host.on('toolbar', (e) => {
    if (e.id !== 'spaces' || typeof e.value !== 'string') return;
    if (e.on) hiddenSpaces.delete(e.value); else hiddenSpaces.add(e.value);
    render();
  });
  // A poll's question can be dragged onto another module that links to polls (a to-do, say).
  if (host.objects && host.objects.draggable) {
    host.objects.draggable($('body'), (target) => {
      const h = target.closest('[data-drag]');
      const x = h && polls.get(h.dataset.drag);
      return x ? { kind: 'poll', id: x.id, label: x.p.question, ...(x.scope === 'spaces' ? { space: x.spaceId } : {}) } : null;
    });
  }
  $('body').addEventListener('click', (e) => {
    const mb = e.target.closest('[data-menu]');
    if (mb) {
      const key = mb.dataset.menu;
      const x = polls.get(key);
      if (!x) return;
      return void host.menu.show({
        id: `poll-${key}`,
        anchor: mb,
        items: [
          { id: 'toggle', label: isClosed(x.p) ? 'Reopen poll' : 'End poll', icon: isClosed(x.p) ? 'lock-open' : 'lock', onClick: () => setClosed(key) },
          { separator: true },
          { id: 'delete', label: 'Delete poll', icon: 'trash', danger: true, onClick: (item, b) => remove(key, b) },
        ],
      });
    }
    const un = e.target.closest('[data-unlink]');
    if (un) {
      const [k, o] = un.dataset.unlink.split('|');
      return void setOptionLink(k, o, null);
    }
    const act = e.target.closest('[data-action]');
    if (act) {
      const [k, a] = act.dataset.action.split('|');
      return void runAction(k, a);
    }
    const link = e.target.closest('[data-ref]');
    if (link && host.objects) return void host.objects.open(JSON.parse(link.dataset.ref)).catch((err) => showNote(err.message));
    const v = e.target.closest('[data-vote]');
    if (v) {
      const [key, option] = v.dataset.vote.split('|');
      return void vote(key, option);
    }
    const a = e.target.closest('[data-addopt]');
    if (a) {
      const input = a.parentElement.querySelector('[data-addtext]');
      addOption(a.dataset.addopt, input.value).then(() => { input.value = ''; });
    }
  });
  $('body').addEventListener('keydown', (e) => {
    const input = e.target.closest('[data-addtext]');
    if (!input || e.key !== 'Enter') return;
    e.preventDefault();
    const key = input.dataset.addtext;
    addOption(key, input.value);
  });
  // An object dragged from another module onto an option links the option to it.
  const optionAt = (pt) => {
    const el = host.objects.elementAt(pt);
    const opt = el && el.closest('[data-vote]');
    if (!opt) return null;
    const [key, id] = opt.dataset.vote.split('|');
    const x = polls.get(key);
    return x && mayManage(x) && !isClosed(x.p) ? { el: opt, key, id } : null;
  };
  const clearDrop = () => { for (const e of root.querySelectorAll('.opt.drop')) e.classList.remove('drop'); };
  // What the drop can do is the shared decision (host.objects.dropMenu): linking the option to it is this module's
  // own offer, and whatever the modules around offer for an object of that kind comes after, with this poll as the target.
  if (host.objects && host.objects.dropTarget) {
    host.objects.dropTarget({
      over: (pt, ref) => {
        clearDrop();
        const at = ref ? optionAt(pt) : null;
        if (at) at.el.classList.add('drop');
      },
      leave: clearDrop,
      drop: async (ref, pt, dragged) => {
        clearDrop();
        if (!ref) return host.objects.trace('drop ignored: only a pointer can be linked to an option');
        const at = optionAt(pt);
        if (!at) return host.objects.trace('drop ignored: no option of yours under the pointer');
        const x = polls.get(at.key);
        try {
          const chosen = await host.objects.dropMenu(dragged, pt, {
            context: { target: host.objects.make('poll', x.id, x.scope === 'spaces' ? { space: x.spaceId } : undefined) },
            own: linkable(ref) ? [{ id: 'link', label: 'Link it to this option', run: () => setOptionLink(at.key, at.id, ref) }] : [],
            remember: 'option',
          });
          if (chosen && chosen.id !== 'link') showNote(`${chosen.label}: done`);
        } catch (err) {
          showNote(err.message);
        }
      },
    });
  }
  // New poll is the host's "+" (host.add.set, one action: it runs at once) wherever Polls is drawn: a window's titlebar,
  // popped out, or its own page. Typing is `/p` in Chat, which opens the same form.
  host.add.set(canCreate ? [{ id: 'poll', label: 'New poll', icon: 'square-poll-horizontal' }] : []).catch(() => {});
  host.on('add', (e) => { if (e.id === 'poll' && canCreate) openEditor(); });
  if (host.actions && host.actions.provide) {
    host.actions.provide({
      // A poll or a message's words from Chat's Send to... (plan-object-handoff.md): the form, filled in; nothing is saved
      // until the person starts it.
      draftPoll: async (input) => {
        if (!canCreate) throw new Error('this person cannot start a poll here');
        openEditor(pollFromObject(input.object, host.util));
        return {};
      },
      addPoll: async (input) => {
        if (!canCreate) throw new Error('this person cannot start a poll here');
        const parsed = input.text && host.util.parseWhen ? host.util.parseWhen(input.text) : { title: input.text || '' };
        openEditor(parsed);
        return {};
      },
    });
  }
  // A poll with a closing time closes on its own: redraw now and then to show it.
  // Stopped once this module is closed (in the page, its elements go and the timer would draw into nothing).
  const redraw = setInterval(() => { if (!$('app')) return void clearInterval(redraw); render(); announceIfDue(); }, 30000);

  async function start() {
    try {
      await load();
    } catch (err) {
      showMsg(`${info.module.name} could not load`, err.message, start);
      return;
    }
    await loadKinds();
    await loadActions();
    resolveOptionLinks();
    for (const x of [...polls.values()]) syncOptionLinks(x);
    $('msg').hidden = true;
    $('loading').hidden = true;
    $('app').hidden = false;
    render();
    announceIfDue();
  }
  await start();
})();
