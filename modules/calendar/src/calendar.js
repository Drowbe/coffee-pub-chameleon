// Calendar module. One file of code for every place it shows: the environment's own
// page, a space's canvas (docked or floating), a window of its own, and the two parts of the Calendar destination
// (the calendar itself, `main`, and the Agenda beside it, `panel`). On the environment page (and as a part) it holds
// the environment's events and shows the events of every space the viewer belongs to, each marked with its space's
// icon, editable where the viewer may add events in that space (`write` from host.spaces()); a new event there asks
// where it goes, every time. In a space it holds that space's events and shows the environment's beside them. As a
// part of the destination in a space (/calendar?space=<id>; plan-calendar-todo.md) it holds that space's events alone:
// nothing is asked about where an event goes, reminders and markers are that space's, and the environment's events
// are neither fetched nor shown. The SDK (window.host) is injected by the host.
(async function () {
  'use strict';

  // This module runs in a frame (the SDK is a global) or in the page (its SDK is handed to its script);
  // either way it looks elements up in host.root, never in document, so it works in both.
  const host = (document.currentScript && document.currentScript.host) || window.host;
  const root = host.root;
  const word = host.util.word; // the environment's word for a level or role (host.locale().words)

  const $ = (id) => root.getElementById(id);
  const { esc, ymd, parseYmd } = host.util;

  let info;
  try {
    info = await host.ready();
  } catch (err) {
    $('msg').textContent = 'The calendar could not start: ' + err.message;
    return;
  }
  const inSpace = info.context.scope === 'space';
  // A part of the Calendar destination: 'main' (the calendar) or 'panel' (the Agenda); null on every other surface.
  // As a part it draws no view switch or filter of its own: the page's bar does those (host.destination).
  const part = (info.context.destination && info.context.destination.part) || null;
  // The environment's events beside a space's: on the space's canvas and its own page, never as a part in a space.
  const showsEnvironment = inSpace && !part;
  // The person's own choice of the view to open on (Settings > Module settings).
  let prefs = {};
  try { prefs = await host.settings.get(); } catch (err) { prefs = {}; }
  const canEdit = host.can('edit'); // in this frame's own place: the space it is in, else the environment
  const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (err) { return undefined; } })();

  // Every event we know of, by "<scope>:<id>". `scope` is where it is stored: 'here'
  // (this space, or the environment on its page -- the frame's own context),
  // 'environment' (shown read-only in a space) or 'spaces' (another space's, on the environment page).
  const events = new Map();
  const LOBBY = 'lobby'; // the Lobby's id: not a space of the viewer's trips
  const spaceInfo = new Map(); // space id -> { id, name, icon, svg, write }, on the environment page
  const hiddenSpaces = new Set(); // spaces filtered out on the environment page
  let hideOwn = false; // as a part: the page's filter has the environment's own events off
  let cursor = new Date();
  cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  let view = 'month'; // set from "Open on" once the library is in (openView, below)
  let anchor = new Date(); // the day the week and day views are built around; as a part, the selected day
  let editing = null; // { scope, id, version, spaceId } while the editor is open

  // Where an event may be changed. Another space's (on the environment page) where the viewer may add events there:
  // host.spaces() says so with `write`, and a space that does not say is read only. The environment's events, seen
  // from a space, are read only there as before.
  const spaceWritable = (spaceId) => Boolean(spaceInfo.get(spaceId) && spaceInfo.get(spaceId).write === true);
  const writable = (x) => (x.scope === 'here' ? canEdit : x.scope === 'spaces' ? spaceWritable(x.spaceId) : false);
  const writableSpaces = () => [...spaceInfo.values()].filter((r) => r.write === true);
  // Anyone who may add an event somewhere here: in this place, or (on the environment page) in one of their spaces.
  const canAdd = () => canEdit || (!inSpace && writableSpaces().length > 0);
  // The storage options for a place: another space's events are reached with { space }.
  const placeOpts = (scope, spaceId) => (scope === 'spaces' ? { space: spaceId } : {});
  // The environment's own calendar is named by the environment's name (info.context.environment.name), as the
  // destination's filter names it (decision 19); the environment word only where the name is not known.
  const envName = () => (info.context.environment && info.context.environment.name) || word('environment', { cap: true });
  const placeName = (scope, spaceId) => (scope === 'spaces' ? (spaceInfo.get(spaceId) ? spaceInfo.get(spaceId).name : word('space', { cap: true })) : inSpace && scope === 'here' ? word('space', { cap: true }) : envName());

  // The person's own other calendars (plan-google-calendar.md, Part 2; the `external` hook): their events, read from
  // the host on the environment's page and as a part of the destination, never in a space (where others may be
  // watching the screen). Kept in `events` as scope 'external', read only, never stored, published or sent anywhere.
  const showsExternal = info.context.scope === 'environment' && Boolean(host.external && host.external.events);
  const externalCalendars = new Map(); // calendar id -> { id, name, tint } in the person's order (the tint: its place)
  const hiddenExternal = new Set(); // other calendars filtered out
  const EXTERNAL_TINTS = 5; // .ext-0 to .ext-4 in calendar.css; the destination's filter uses the same order
  const externalName = (id) => (externalCalendars.get(id) ? externalCalendars.get(id).name : 'Other');
  const isExternal = (x) => x.scope === 'external';

  // Other modules' objects shown as markers (plan-calendar-markers.md): a task due on a day, a poll's closing time. Asked
  // of the host for the period shown (host.objects.markers), never stored, never an event: a marker is not edited,
  // dragged or made into anything here, and a click opens the object in its own module. Kept apart from `events`, as
  // x = { key, scope: 'marker', marker, kindKey, tint, due, ev }, where `ev` is only what the drawing needs.
  const showsMarkers = Boolean(host.objects && host.objects.markers);
  const markerItems = new Map(); // key -> x
  const markerKinds = new Map(); // '<module>:<kind>' -> { id, label, icon, tint }, in the order first seen
  const hiddenMarkers = new Set(); // kinds of markers the filter has off
  // In a space the kinds turned off in the Show menu are remembered in this browser, per space, as /calendar remembers
  // its filter; as a part the page's filter holds them, and the environment's page remembers none of its filter.
  const MARKERS_OFF_KEY = inSpace && !part && info.context.spaceId ? `calendar-markers-off:${info.context.spaceId}` : '';
  if (MARKERS_OFF_KEY) {
    try {
      const saved = JSON.parse(localStorage.getItem(MARKERS_OFF_KEY) || '[]');
      if (Array.isArray(saved)) for (const id of saved.slice(0, 20)) if (typeof id === 'string') hiddenMarkers.add(id);
    } catch (err) {
      // nothing remembered: every kind on
    }
  }
  const markerIcons = new Map(); // a module's icon name -> its SVG ('' while it is asked for, or when there is none)
  const kindNames = new Map(); // '<module>:<kind>' -> the kind's name ("Task"), from host.objects.kinds()
  const TINTS = ['gold', 'blue', 'green', 'teal', 'purple', 'red', 'orange', 'pink'];
  const isMarker = (x) => x.scope === 'marker';

  /*__LIB__*/

  view = openView(prefs.defaultView);

  // Every occurrence of every event that touches [from, to), soonest first: one that began earlier
  // and runs into the range counts too.
  function inRange(from, to) {
    const out = [];
    for (const x of events.values()) {
      if (x.scope === 'spaces' && hiddenSpaces.has(x.spaceId)) continue;
      if (x.scope === 'here' && hideOwn) continue;
      if (isExternal(x) && hiddenExternal.has(x.calendar)) continue;
      const dur = durationOf(x.ev);
      for (const start of occurrences(x.ev, new Date(from.getTime() - dur), to)) {
        const end = endOf(x.ev, start);
        if (end > from || start >= from) out.push({ x, start, end });
      }
    }
    for (const x of markerItems.values()) {
      if (!markerShown(x)) continue;
      const start = startOf(x.ev);
      if (start >= from && start < to) out.push({ x, start, end: endOf(x.ev, start) });
    }
    return out.sort((a, b) => a.start - b.start);
  }

  // --- loading and live updates --------------------------------------------

  // scope 'spaces' is another space's event on the environment page: read-only, kept by space and id.
  const keyOf = (scope, id, spaceId) => (scope === 'spaces' ? `spaces:${spaceId}:${id}` : `${scope}:${id}`);
  function remember(scope, item, spaceId) {
    if (!item.key.startsWith('event:') || !item.value) return;
    const id = item.key.slice(6);
    const key = keyOf(scope, id, spaceId);
    events.set(key, { key, scope, spaceId, id, version: item.version, ev: item.value });
  }

  // A space's icon (inline SVG from the host) with its name for a tooltip.
  const spaceIcon = (x) => {
    const r = x.scope === 'spaces' ? spaceInfo.get(x.spaceId) : null;
    return r && r.svg ? `<span class="ri" title="${esc(r.name)}">${r.svg}</span>` : '';
  };
  const chipSpaceIcon = (x) => (spaceIconOn() ? spaceIcon(x) : '');
  // Which events are copies of another module's object (the Itinerary's): the host says so on the object's summary (`copy: true`,
  // `twinOf`), asked of host.objects.resolve for the events this page shows (a copy exists only in a space), once each. A copy
  // is marked with the original's module icon and "from <its name>"; its length, All day and the end are the original's to set.
  // key -> { name, icon, ref } for a copy, null for an event that is not one.
  const pairInfo = new Map();
  let learning = false;
  const canHaveCopy = (x) => !isExternal(x) && !isMarker(x) && (x.scope === 'spaces' || (x.scope === 'here' && inSpace));
  async function learnCopies() {
    if (learning || !host.objects || !host.objects.resolve) return;
    const todo = [...events.values()].filter((x) => canHaveCopy(x) && !pairInfo.has(x.key));
    if (!todo.length) return;
    learning = true;
    let changed = false;
    try {
      const sums = await host.objects.resolve(todo.map((x) => host.objects.make('event', x.id, whereFor(x))));
      const originals = new Map(); // ref key -> ref, for the copies' originals
      todo.forEach((x, i) => {
        const sum = sums[i];
        if (sum && !sum.error && sum.copy === true && sum.twinOf) {
          pairInfo.set(x.key, { name: '', icon: '', ref: sum.twinOf });
          originals.set(JSON.stringify(sum.twinOf), sum.twinOf);
        } else pairInfo.set(x.key, null);
      });
      if (originals.size) {
        const refs = [...originals.values()];
        const found = await host.objects.resolve(refs);
        const byRef = new Map(refs.map((r, i) => [JSON.stringify(r), found[i]]));
        for (const [k, info2] of pairInfo) {
          const got = info2 && byRef.get(JSON.stringify(info2.ref));
          if (!got || got.error || !got.module) continue;
          info2.name = String(got.module.name || '');
          info2.icon = String(got.module.icon || '');
          if (typeof got.module.svg === 'string' && got.module.svg.includes('<svg') && info2.icon && !markerIcons.get(info2.icon)) markerIcons.set(info2.icon, got.module.svg);
          else wantIcon(info2.icon);
        }
      }
      changed = todo.some((x) => pairInfo.get(x.key));
    } catch (err) {
      for (const x of todo) if (!pairInfo.has(x.key)) pairInfo.set(x.key, null); // nothing is marked; not asked again
    } finally {
      learning = false;
    }
    if (changed && $('app')) render();
  }
  const copyOf = (x) => pairInfo.get(x.key) || null;
  const copyName = (c) => c.name || 'the original';
  const copyIcon = (c) => (c.icon && markerIcons.get(c.icon) ? `<span class="mi copy-mark" aria-hidden="true">${markerIcons.get(c.icon)}</span>` : '');
  // The zone note for a copy shown in the trip's clock ("Lisbon time"), else ''.
  const zoneFor = (x) => (isExternal(x) || isMarker(x) ? '' : zoneOf(x.ev));
  // The space's icon on a chip: only where there is more than one place to tell apart (one space shown: it says nothing).
  const placesShown = () => (hideOwn ? 0 : 1) + [...spaceInfo.keys()].filter((id) => !hiddenSpaces.has(id)).length;
  const spaceIconOn = () => part === 'panel' || placesShown() > 1;
  async function load() {
    events.clear();
    // The names of the kinds this module may show as markers ("Task"), for the filter's words.
    if (showsMarkers && host.objects.kinds && !kindNames.size) {
      try {
        for (const k of await host.objects.kinds()) if (k && k.module && k.kind && k.name) kindNames.set(`${k.module}:${k.kind}`, String(k.name).slice(0, 30));
      } catch (err) {
        // the kind's own word, then
      }
    }
    for (const item of await host.storage.list('event:')) remember('here', item);
    if (showsEnvironment) {
      try {
        for (const item of await host.storage.list('event:', { scope: 'environment' })) remember('environment', item);
      } catch (err) {
        // guests and people without environment access see just the space's events
      }
    } else if (info.context.scope === 'environment') {
      // Every space the viewer belongs to that has the calendar on.
      try {
        // The Lobby is not a trip: the destination's filter and the To-do leave it out, so does this.
        for (const r of await host.spaces()) if (r.id !== LOBBY) spaceInfo.set(r.id, r);
        for (const item of await host.storage.list('event:', { scope: 'spaces' })) if (spaceInfo.has(item.spaceId)) remember('spaces', item, item.spaceId);
      } catch (err) {
        // no spaces is fine: just the environment's own events
      }
    }
  }
  // One change: kept, not drawn (the caller draws, once). False when it is not for this page.
  function applyChange(e) {
    if (!e.key.startsWith('event:')) return false;
    if (e.scope === 'environment' && inSpace && !showsEnvironment) return false; // not shown here: a part in a space
    if (e.scope === 'spaces' && !spaceInfo.has(e.spaceId)) return false; // the Lobby, or a space this page does not list
    const scope = e.scope === 'spaces' ? 'spaces' : e.scope === 'environment' && inSpace ? 'environment' : 'here';
    const id = e.key.slice(6);
    if (e.deleted) { events.delete(keyOf(scope, id, e.spaceId)); pairInfo.delete(keyOf(scope, id, e.spaceId)); }
    else remember(scope, { key: e.key, value: e.value, version: e.version }, e.spaceId);
    if (editing && editing.scope === scope && editing.id === id && (scope !== 'spaces' || editing.spaceId === e.spaceId) && e.by !== info.user.key) {
      showError('This event was just changed by someone else. Close and reopen it to see the change.');
    }
    return true;
  }
  host.on('change', (e) => {
    if (applyChange(e)) render();
  });
  // Many at once (a Clear, its Undo): kept in one pass and drawn once; keys only (a big event comes without values): read again.
  host.on('changes', (e) => {
    const list = (Array.isArray(e.changes) ? e.changes : []).map((c) => ({ ...c, scope: e.scope, spaceId: e.spaceId })).filter((c) => String(c.key).startsWith('event:'));
    if (!list.length) return;
    if (list.some((c) => !c.deleted && c.value === undefined)) { load().then(render).catch(() => {}); return; }
    let any = false;
    for (const c of list) any = applyChange(c) || any;
    if (any) render();
  });

  // --- phases --------------------------------------------------------------
  // A space with phases wears them: each day inside a dated phase has a soft wash of the phase's tint, and the
  // phase's first day (and the first day a view shows) names it. The host tells this page when the dates change
  // (host.on('phases'), a save in the sheet or Set up, or someone else's), and the view redraws at once, only when the
  // bands changed. A slow look every five minutes stays as a fallback. Nothing is drawn on the environment page, in a
  // space without phases or on a day in none.
  let phaseBands = [];
  const bandsKey = (list) => JSON.stringify(list.map((b) => [b.id, b.label, b.tint, b.start, b.end]));
  function readPhases(timeline) {
    const here = host.space();
    if (!here || !host.phases().length || typeof host.util.phaseTimeline !== 'function') return [];
    try { return (timeline || host.util.phaseTimeline()).filter((b) => b.dated); } catch (err) { return []; }
  }
  function lookAtPhases(timeline) {
    const next = readPhases(timeline);
    if (bandsKey(next) === bandsKey(phaseBands)) return;
    phaseBands = next;
    render();
  }
  // The day's phase for drawing: the class and style a cell takes, and its name when it is shown (its first day, or the
  // first day the view shows). '' parts when the day is in no phase.
  function phaseFor(key, showName) {
    const ph = phaseOnDay(phaseBands, key);
    if (!ph || !ph.tint) return { cls: '', name: '', label: '' };
    return { cls: ` ph ph-${ph.tint}`, name: showName || ph.first ? ph.label : '', label: ph.label };
  }
  const phaseNameHtml = (ph) => (ph.name ? `<small class="ph-name" title="${esc(ph.name)}">${esc(ph.name)}</small>` : '');

  // --- drawing -------------------------------------------------------------

  const isCompact = () => $('app').classList.contains('sdk-cal-compact');

  const externalClass = (x) => `ext-${externalCalendars.get(x.calendar) ? externalCalendars.get(x.calendar).tint : 0}`;
  function chipHtml({ x, start, cont, hour }) {
    if (isMarker(x)) return markerChipHtml(x, start);
    // A multi-day event shows its time on the first day and an arrow on the days after. The month's chips give the hour short
    // ("7 PM"), the day's hour rows none at all on the hour (their row says it).
    const label = cont ? '\u2192 ' + x.ev.title : (x.ev.allDay || (hour && start.getMinutes() === 0) ? '' : (hour ? timeText(start) : shortTime(start)) + ' ') + x.ev.title;
    if (isExternal(x)) return `<button class="sdk-cal-event sdk-bar-kept is-ext ${externalClass(x)}" data-open="${esc(x.key)}" title="${esc(`${x.ev.title} (${externalName(x.calendar)})`)}">${esc(label)}</button>`;
    const copy = copyOf(x);
    const zone = zoneFor(x);
    const tip = `${x.ev.title}${copy ? ` (from ${copyName(copy)})` : ''}${zone ? ` (${zoneNote(zone)})` : ''}`;
    return `<button class="sdk-cal-event${x.scope === 'environment' && inSpace ? ' is-environment' : ''}${copy ? ' is-copy' : ''}" data-open="${esc(x.key)}" data-at="${ymd(start)}" title="${esc(tip)}">${copy ? copyIcon(copy) : ''}${chipSpaceIcon(x)}${x.ev.repeat ? '<span class="rep">&#8635;</span>' : ''}${esc(label)}</button>`;
  }

  // A day's cell: its phase wash, outside the month, today, the chosen day (as the destination's calendar).
  const cellClass = (day, ph, today, sel, other) => `sdk-cal-cell${ph.cls}${other ? ' is-other' : ''}${ymd(day) === today ? ' is-today' : ''}${ymd(day) === sel ? ' is-selected' : ''}`;
  function monthGrid() {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    const gridEnd = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + 42);
    const byDay = new Map();
    for (const occ of inRange(gridStart, gridEnd)) {
      // Every day the occurrence covers, within the grid.
      const firstDay = startOfDay(occ.start);
      const lastDay = startOfDay(new Date(Math.max(occ.end.getTime() - 1, occ.start.getTime())));
      for (let d = firstDay < gridStart ? gridStart : firstDay; d <= lastDay && d < gridEnd; d = addDays(d, 1)) {
        const k = ymd(d);
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push({ ...occ, cont: d > firstDay });
      }
    }
    const today = ymd(new Date());
    const sel = selectedDay();
    const roving = rovingDay(Array.from({ length: 42 }, (_, i) => ymd(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i))), ymd(first));
    let html = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="sdk-cal-dow">${d}</div>`).join('');
    for (let i = 0; i < 42; i += 1) {
      const day = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const list = byDay.get(ymd(day)) || [];
      const shown = isCompact() ? list : list.slice(0, 3);
      const ph = phaseFor(ymd(day), i === 0);
      html += `<div class="${cellClass(day, ph, today, sel, day.getMonth() !== cursor.getMonth())}" data-day="${ymd(day)}"${ymd(day) === today ? ' aria-current="date"' : ''}${dayKeys(day, roving, ph.label)}>
        <span class="sdk-cal-n">${day.getDate()}</span>${phaseNameHtml(ph)}<div class="sdk-cal-chips">${shown.map(chipHtml).join('')}</div>
        ${shown.length < list.length ? `<span class="sdk-cal-more">+${list.length - shown.length} more</span>` : ''}</div>`;
    }
    return `<div class="sdk-cal-grid">${html}</div>`;
  }

  // Occurrences as a list grouped by day.
  function listHtml(occs, emptyText, floor, end) {
    if (!occs.length) return `<p class="sdk-empty">${emptyText}</p>`;
    // The Agenda (the destination's panel) is narrow: a space's icon before the title stands for its name.
    const agenda = part === 'panel';
    const groups = new Map();
    for (const occ of occs) {
      // An event that began before the list does starts it on the list's first day.
      const k = ymd(occ.start < floor ? floor : occ.start);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(occ);
    }
    return `<div class="list">${[...groups.values()].map((g) => `<div class="group"><h4>${esc(dayHeading(g[0].start < floor ? floor : g[0].start))}</h4><div class="sdk-cal-agenda">${g.map(({ x, start, end }) => (isMarker(x) ? markerItemHtml(x, start, agenda) : `
      <button type="button" class="sdk-row sdk-bar-kept${isExternal(x) ? ` is-ext ${externalClass(x)}` : ''}" data-open="${esc(x.key)}" data-at="${ymd(start)}" title="${esc(`${whenFull(x.ev, start, end)}${zoneFor(x) ? ` (${zoneNote(zoneFor(x))})` : ''}  ${x.ev.title}${x.ev.desc ? ' - ' + x.ev.desc.slice(0, 120) : ''}`)}"><span class="sdk-row-meta">${esc(whenText(x.ev, start, end, isCompact()))}</span>
        <span class="sdk-row-main"><span class="sdk-row-title">${agenda ? spaceIcon(x) : ''}${copyOf(x) ? copyIcon(copyOf(x)) : ''}${esc(x.ev.title)}${copyOf(x) ? `<span class="sdk-chip-tag">from ${esc(copyName(copyOf(x)))}</span>` : ''}${zoneFor(x) ? `<span class="sdk-chip-tag">${esc(zoneNote(zoneFor(x)))}</span>` : ''}${x.ev.repeat ? `<span class="sdk-chip-tag">${esc(REPEAT_NAMES[x.ev.repeat.every] || 'repeats')}</span>` : ''}${x.scope === 'environment' && inSpace ? `<span class="sdk-chip-tag">${esc(envName())}</span>` : ''}${!agenda && x.scope === 'spaces' && spaceInfo.get(x.spaceId) ? `<span class="sdk-chip-tag">${spaceIcon(x)} ${esc(spaceInfo.get(x.spaceId).name)}</span>` : ''}${isExternal(x) ? `<span class="sdk-chip-tag" data-tone="custom">${esc(externalName(x.calendar))}</span>` : ''}</span></span></button>`)).join('')}</div></div>`).join('')}${end ? `<p class="empty end">${esc(end)}</p>` : ''}</div>`;
  }

  function monthList() {
    const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    return listHtml(inRange(from, to), `Nothing in ${cursor.toLocaleDateString([], { month: 'long' })}.${canEdit ? ' Add an event to get started.' : ''}`, from);
  }

  function weekList() {
    const from = weekStart();
    return listHtml(inRange(from, addDays(from, 7)), `Nothing this week.${canEdit ? ' Add an event to get started.' : ''}`, from);
  }

  function upcomingList() {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + 90 * DAY);
    return listHtml(inRange(from, to).slice(0, 300), `Nothing coming up.${canEdit ? ' Add an event to get started.' : ''}`, from);
  }

  // The seven days (Sunday first, like the month grid) around the anchor day, each with its events in full.
  const weekStart = () => new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - anchor.getDay());
  function weekHtml() {
    const start = weekStart();
    const byDay = new Map();
    for (const occ of inRange(start, addDays(start, 7))) {
      const firstDay = startOfDay(occ.start);
      const lastDay = startOfDay(new Date(Math.max(occ.end.getTime() - 1, occ.start.getTime())));
      for (let d = firstDay < start ? start : firstDay; d <= lastDay && d < addDays(start, 7); d = addDays(d, 1)) {
        const k = ymd(d);
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push({ ...occ, cont: d > firstDay });
      }
    }
    const today = ymd(new Date());
    const sel = selectedDay();
    const roving = rovingDay(Array.from({ length: 7 }, (_, i) => ymd(addDays(start, i))), ymd(start));
    let html = '';
    for (let i = 0; i < 7; i += 1) {
      const day = addDays(start, i);
      const list = byDay.get(ymd(day)) || [];
      const ph = phaseFor(ymd(day), i === 0);
      html += `<div class="${cellClass(day, ph, today, sel, false)}" data-day="${ymd(day)}"${ymd(day) === today ? ' aria-current="date"' : ''}${dayKeys(day, roving, ph.label)}><span class="sdk-cal-n">${esc(day.toLocaleDateString([], { weekday: 'short' }))} <b>${day.getDate()}</b>${phaseNameHtml(ph)}</span><div class="sdk-cal-chips">${list.map(chipHtml).join('')}</div></div>`;
    }
    return `<div class="sdk-cal-grid sdk-cal-week">${html}</div>`;
  }
  function weekTitle() {
    const s = weekStart();
    const e = addDays(s, 6);
    const m = (d) => d.toLocaleDateString([], { month: 'short' });
    return s.getMonth() === e.getMonth() ? `${m(s)} ${s.getDate()} \u2013 ${e.getDate()}, ${e.getFullYear()}` : `${m(s)} ${s.getDate()} \u2013 ${m(e)} ${e.getDate()}, ${e.getFullYear()}`;
  }

  // One day: an all-day row (with what runs into the day from before it), then a column of hours, each with the
  // events that start in it. As one day of the Week view, hour by hour.
  function dayHtml() {
    const start = startOfDay(anchor);
    const end = addDays(start, 1);
    const allDay = [];
    const byHour = new Map();
    for (const occ of inRange(start, end)) {
      if (occ.x.ev.allDay || occ.start < start) allDay.push({ ...occ, cont: occ.start < start });
      else {
        const h = occ.start.getHours();
        if (!byHour.has(h)) byHour.set(h, []);
        byHour.get(h).push({ ...occ, cont: false, hour: true });
      }
    }
    const k = ymd(start);
    const ph = phaseFor(k, true);
    // The phase bar and the all-day row are one block that stays at the top of the scroll (the day opens at its first hour).
    let html = `<div class="daytop">${ph.label ? `<div class="phasehead ph ph-${esc(phaseOnDay(phaseBands, k).tint)}"><small class="ph-name">${esc(ph.label)}</small></div>` : ''}<div class="sdk-cal-allday"><span class="sdk-cal-hr">All day</span><div class="sdk-cal-chips">${allDay.map(chipHtml).join('')}</div></div></div><div class="sdk-cal-hours">`;
    const now = new Date();
    for (let h = 0; h < 24; h += 1) {
      const at = new Date(start.getFullYear(), start.getMonth(), start.getDate(), h);
      const current = ymd(now) === k && now.getHours() === h;
      html += `<div class="sdk-cal-hour${current ? ' is-now' : ''}" data-day="${k}" data-hour="${h}"><span class="sdk-cal-hr">${esc(timeText(at))}</span><div class="sdk-cal-chips">${(byHour.get(h) || []).map(chipHtml).join('')}</div>${current ? '<span class="sdk-status" data-tone="info"><span class="sdk-chip-label">Now</span></span>' : ''}</div>`;
    }
    return `<div class="dayview">${html}</div></div>`;
  }
  // Open the day at its first event, or the hour it is now, or 7:00; once per day shown, so a change does not jump it.
  let scrolledFor = '';
  function scrollDay() {
    const k = ymd(anchor);
    if (scrolledFor === k) return;
    scrolledFor = k;
    const first = root.querySelector('.sdk-cal-hours .sdk-cal-hour .sdk-cal-event');
    const now = root.querySelector('.sdk-cal-hours .sdk-cal-hour.is-now');
    const row = (first && first.closest('.sdk-cal-hour')) || now || root.querySelector('.sdk-cal-hours .sdk-cal-hour[data-hour="7"]');
    const body = $('body');
    if (!row || !body) return;
    // The phase bar and the all-day row stick to the top of the scroll, so the row stops just beneath them, not under them.
    const top = body.querySelector('.daytop');
    const go = () => { body.scrollTop = Math.max(0, row.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 4 - (top ? top.offsetHeight + 6 : 0)); };
    go();
    requestAnimationFrame(() => { if (row.isConnected) go(); }); // once laid out, in case the first pass had no height yet
  }

  // Month / Week / Day / Agenda is the toolbar's view switch (the Agenda's key is `list`). As the destination's
  // calendar the page's row has Month, Week and Day, and this draws whichever it says.
  const VIEWS = [
    { id: 'month', label: 'Month', icon: 'calendar-days' },
    { id: 'week', label: 'Week', icon: 'calendar-week' },
    { id: 'day', label: 'Day', icon: 'calendar-day' },
    { id: 'list', label: 'Agenda', icon: 'list' },
  ];
  const PART_VIEWS = ['month', 'week', 'day'];
  if (part && !PART_VIEWS.includes(view)) view = prefs.defaultView === 'week' ? 'week' : 'month';
  const viewSwitch = part ? null : host.ui.viewSwitch({
    id: 'view',
    options: VIEWS,
    value: view,
    onChange: (id) => { view = id; render(); },
  });

  // As the destination's calendar a day is selected by keyboard too: Tab to it, then Enter or Space. (Not a button:
  // it holds the events' own buttons.)
  // One Tab stop in the grid (roving tabindex): the day the arrow keys moved to, else the selected day, else the first one;
  // the arrows move it (root keydown, below). The chips of the other days are out of the Tab order (the Agenda lists them).
  let focusDay = ''; // the day with the grid's Tab stop
  let focusUntil = 0; // until then a redraw gives the focus back to focusDay (a pick redraws twice: the page's state comes round)
  const rovingDay = (keys, fallback) => (keys.includes(focusDay) ? focusDay : keys.includes(selectedDay()) ? selectedDay() : fallback);
  function dayKeys(day, roving, phase) {
    return part === 'main' ? ` tabindex="${ymd(day) === roving ? 0 : -1}" title="${esc(dayHeading(day) + (phase ? ` \u2013 ${phase}` : ''))}"` : '';
  }
  function settleGrid() {
    if (part !== 'main') return;
    for (const chip of root.querySelectorAll('.sdk-cal-cell:not(.is-selected) .sdk-cal-event')) chip.tabIndex = -1;
    if (Date.now() < focusUntil && focusDay) {
      const cell = root.querySelector(`.sdk-cal-cell[data-day="${focusDay}"]`);
      const active = root.activeElement || document.activeElement;
      if (cell && (!active || active === document.body || !active.isConnected)) cell.focus({ preventScroll: true });
    }
  }
  // As a part: the selected day (YYYY-MM-DD), which the Agenda follows.
  function selectedDay() {
    return part === 'main' ? ymd(anchor) : '';
  }
  // The period the calendar shows: [from, to).
  function period() {
    if (view === 'day') { const d = startOfDay(anchor); return { from: d, to: addDays(d, 1) }; }
    if (view === 'week') { const s0 = weekStart(); return { from: s0, to: addDays(s0, 7) }; }
    return { from: new Date(cursor.getFullYear(), cursor.getMonth(), 1), to: new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1) };
  }
  // The destination's filter left nothing on (in a space there is no such filter: its one place is always shown).
  const nothingPicked = () => Boolean(part) && !inSpace && hideOwn && ![...spaceInfo.keys()].some((id) => !hiddenSpaces.has(id)) && ![...externalCalendars.keys()].some((id) => !hiddenExternal.has(id));
  const pickOne = () => `Pick at least one in ${word('space', { many: true, cap: true })}.`;

  function render() {
    // A calendar that was just closed (its elements gone) draws nothing: an icon or markers arriving late, say.
    if (!$('app')) return;
    if (part === 'panel') return renderAgenda();
    syncToolbar();
    if (part === 'main') tellPeriod();
    if (view !== 'day') scrolledFor = ''; // back to the day view later opens it at its first event again
    if (nothingPicked()) {
      $('body').innerHTML = `<p class="sdk-empty">${esc(pickOne())}</p>`;
    } else if (view === 'week') {
      // Week and Month list their events beneath the grid (listUnder); not as the destination's calendar, whose
      // Agenda beside it is that list.
      $('body').innerHTML = listUnder(view, part) ? `<div class="stack">${weekHtml()}<div><h3 class="list-title">This week</h3>${weekList()}</div></div>` : weekHtml();
    } else if (view === 'day') {
      // A redraw of the same day keeps where it was scrolled to; a new day opens at its first event.
      const keep = $('body').scrollTop;
      $('body').innerHTML = dayHtml();
      if (scrolledFor === ymd(anchor)) $('body').scrollTop = keep;
      else scrollDay();
    } else if (view === 'list') {
      $('body').innerHTML = upcomingList();
    } else if (listUnder(view, part)) {
      $('body').innerHTML = `<div class="stack">${monthGrid()}<div><h3 class="list-title">This month</h3>${monthList()}</div></div>`;
    } else {
      $('body').innerHTML = monthGrid();
    }
    askExternal(false);
    askMarkers(false);
    syncStatus();
    settleGrid();
    learnCopies();
  }

  // The Agenda (the destination's panel): the events of the period the calendar shows, from the selected day on.
  let agendaState = null;
  function renderAgenda() {
    if (nothingPicked()) {
      $('body').innerHTML = `<p class="sdk-empty">${esc(pickOne())}</p>`;
      return;
    }
    const st = agendaState || {};
    const today = startOfDay(new Date());
    const from = st.from ? parseYmd(st.from) : new Date(today.getFullYear(), today.getMonth(), 1);
    const to = st.to ? parseYmd(st.to) : new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const day = st.day ? parseYmd(st.day) : today;
    const start = day > from && day < to ? day : from;
    const unit = st.view === 'day' ? 'day' : st.view === 'week' ? 'week' : 'month';
    const occs = inRange(start, to);
    // From the selected day on: "Nothing this day." for a day, "Nothing else this week." (the days before it are in the calendar).
    $('body').innerHTML = listHtml(occs, unit === 'day' ? 'Nothing this day.' : `Nothing else this ${unit}.`, start, `Nothing else this ${unit}.`);
    askExternal(false);
    askMarkers(false);
    learnCopies();
  }

  // --- the person's other calendars: asked of the host for what is shown -----------------------------------
  // The period shown, with room around it, asked again only when what is shown leaves what was asked for, and whenever
  // the host says they changed (the 'external' event). A failure (the hook not approved yet, say) shows none.
  let externalWindow = null; // { from, to }: what was last asked for
  let externalTicket = 0;
  function externalNeed() {
    const today = startOfDay(new Date());
    if (part === 'panel') {
      const st = agendaState || {};
      return { from: st.from ? parseYmd(st.from) : new Date(today.getFullYear(), today.getMonth(), 1), to: st.to ? parseYmd(st.to) : new Date(today.getFullYear(), today.getMonth() + 1, 1) };
    }
    if (view === 'list') return { from: today, to: addDays(today, 91) };
    const p = period();
    return { from: addDays(p.from, -7), to: addDays(p.to, 14) }; // the month grid's days from the months either side
  }
  function askExternal(again) {
    if (!showsExternal || !loaded) return;
    const need = externalNeed();
    if (!again && externalWindow && need.from >= externalWindow.from && need.to <= externalWindow.to) return;
    const want = { from: addDays(need.from, -31), to: addDays(need.to, 31) };
    externalWindow = want;
    const ticket = ++externalTicket;
    host.external.events({ from: ymd(want.from), to: ymd(want.to) }).then((got) => {
      if (ticket !== externalTicket) return;
      takeExternal(got || {});
      render();
    }).catch(() => {
      // none to show: the hook is not approved, the switch is off, or the server could not answer just now
    });
  }
  function takeExternal(got) {
    for (const k of [...events.keys()]) if (k.startsWith('external:')) events.delete(k);
    externalCalendars.clear();
    (Array.isArray(got.calendars) ? got.calendars : []).forEach((c, i) => {
      if (c && c.id) externalCalendars.set(String(c.id), { id: String(c.id), name: String(c.name || 'Other').slice(0, 60), tint: i % EXTERNAL_TINTS });
    });
    for (const e of Array.isArray(got.events) ? got.events : []) {
      const cal = e && externalCalendars.get(String(e.calendar));
      if (!cal || typeof e.start !== 'string') continue;
      const allDay = e.allDay === true;
      const ev = { title: String(e.title || 'No title').slice(0, 200), allDay, start: e.start, end: typeof e.end === 'string' && e.end ? e.end : null, desc: '', remind: null, repeat: null };
      if (Number.isNaN(startOf(ev).getTime())) continue;
      const key = `external:${cal.id}:${String(e.uid || '')}:${e.start}`;
      events.set(key, { key, scope: 'external', calendar: cal.id, id: String(e.uid || ''), version: null, ev });
    }
    if (editing && editing.scope === 'external' && !events.has(editing.key)) closeEditor();
  }
  if (showsExternal) host.on('external', () => askExternal(true));

  // --- markers: other modules' objects with a date, asked of the host for what is shown --------------------------
  // The period shown, with a week of room either side (the host answers at most 92 days), asked again only when what is
  // shown leaves what was asked for, and whenever the host says one changed (the 'markers' event). A failure (no
  // approval yet, say) shows none.
  let markerWindow = null; // { from, to }: what was last asked for
  let markerTicket = 0;
  function askMarkers(again) {
    if (!showsMarkers || !loaded) return;
    const need = externalNeed();
    if (!again && markerWindow && need.from >= markerWindow.from && need.to <= markerWindow.to) return;
    let want = { from: addDays(need.from, -7), to: addDays(need.to, 7) };
    if (want.to - want.from > 90 * DAY) want = need;
    markerWindow = want;
    const ticket = ++markerTicket;
    // `to` is the last day asked for: the host takes in the whole of a date-only `to`.
    host.objects.markers({ from: ymd(want.from), to: ymd(addDays(want.to, -1)) }).then((list) => {
      if (ticket !== markerTicket) return;
      takeMarkers(Array.isArray(list) ? list : []);
      render();
    }).catch(() => {
      // none to show: not approved to link to them, or the server could not answer just now
    });
  }
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const plural = (name) => (/s$/i.test(name) ? name : name + 's');
  // A kind's switch: "Tasks due" for a kind marked on a day, "Polls closing" for one marked at a time.
  // The word is the kind's (`due`: dated by a due day, else by a moment), never one marker's allDay.
  const markerKindLabel = (kindKey, m) => `${plural(kindNames.get(kindKey) || (m.kind.charAt(0).toUpperCase() + m.kind.slice(1)))} ${m.due === true ? 'due' : 'closing'}`;
  function takeMarkers(list) {
    markerItems.clear();
    let newKind = false;
    for (const m of list) {
      const ref = m && m.ref;
      if (!ref || typeof ref.module !== 'string' || typeof ref.kind !== 'string' || typeof ref.id !== 'string' || !m.module || typeof m.module.id !== 'string') continue;
      const allDay = m.allDay === true;
      if (allDay ? !(typeof m.start === 'string' && DAY_RE.test(m.start)) : !Number.isFinite(m.start)) continue;
      const kindKey = `${m.module.id}:${m.kind}`;
      const tint = TINTS.includes(m.module.color) ? m.module.color : null;
      const key = `marker:${ref.module}:${ref.kind}:${ref.scope}:${ref.space || ''}:${ref.id}`;
      const title = String(m.title || 'Untitled').slice(0, 200);
      markerItems.set(key, { key, scope: 'marker', marker: m, kindKey, tint, due: m.due === true, ev: { title, allDay, start: m.start, end: null, repeat: null } });
      if (!markerKinds.has(kindKey)) {
        markerKinds.set(kindKey, { id: kindKey, label: markerKindLabel(kindKey, m), icon: typeof m.module.icon === 'string' ? m.module.icon : '', tint });
        newKind = true;
      }
      // The icon comes with the marker as SVG (a guest cannot ask the host for icons); asked for only when it does not.
      if (typeof m.module.icon === 'string' && typeof m.module.svg === 'string' && m.module.svg.includes('<svg') && !markerIcons.get(m.module.icon)) markerIcons.set(m.module.icon, m.module.svg);
      else wantIcon(m.module.icon);
    }
    if (newKind) tellMarkerKinds();
  }
  if (showsMarkers) host.on('markers', () => askMarkers(true));

  // Whether a marker shows: its kind on in the filter, and its place (on the environment's page and the destination,
  // the environment's own and each space, by the filter; in a space there is only the space's).
  function markerShown(x) {
    if (hiddenMarkers.has(x.kindKey)) return false;
    const ref = x.marker.ref;
    if (ref.scope === 'space' && !inSpace) return pickedSpaces ? pickedSpaces.has(ref.space) : !hiddenSpaces.has(ref.space);
    if (ref.scope === 'environment' && hideOwn) return false;
    return true;
  }
  // Past: a day before today (an overdue task, until it is ticked done), or a time gone by (a closed poll).
  const markerPast = (x) => (x.ev.allDay ? x.ev.start < ymd(new Date()) : x.ev.start <= Date.now());
  // The module's icon, as inline SVG (a frame cannot load the icon font), asked for once.
  function wantIcon(name) {
    if (typeof name !== 'string' || !/^[a-z0-9-]{1,40}$/.test(name) || markerIcons.has(name) || !host.ui.icon) return;
    markerIcons.set(name, '');
    host.ui.icon(name).then((svg) => {
      if (typeof svg !== 'string' || !svg.includes('<svg')) return;
      markerIcons.set(name, svg);
      if (loaded) render();
    }).catch(() => {});
  }
  const markerIconHtml = (x) => {
    const svg = markerIcons.get(x.marker.module.icon);
    return svg ? `<span class="mi" aria-hidden="true">${svg}</span>` : '';
  };
  const markerSpaceIcon = (x) => (x.marker.ref.scope === 'space' && !inSpace ? spaceIcon({ scope: 'spaces', spaceId: x.marker.ref.space }) : '');
  const tintClass = (x) => (x.tint ? ` tint-${x.tint}` : '');
  // The words are the kind's. Due on a day: the title alone, or "Due 6:00 PM: Pack the bags" with a time. Closing at a
  // moment: "Closes 6:00 PM: Where for dinner?", "Closed" once past, and "Closes: ..." on a day with no time.
  function markerText(x, start, past) {
    if (x.due) return x.ev.allDay ? x.ev.title : `Due ${timeText(start)}: ${x.ev.title}`;
    return `${past ? 'Closed' : 'Closes'}${x.ev.allDay ? '' : ` ${timeText(start)}`}: ${x.ev.title}`;
  }
  function markerTip(x, past) {
    const name = x.marker.module && x.marker.module.name ? String(x.marker.module.name) : '';
    const late = x.due && past ? ' (overdue)' : '';
    return `${markerText(x, startOf(x.ev), past)}${late}${name ? ` - open in ${name}` : ''}`;
  }
  function markerChipHtml(x, start) {
    const past = markerPast(x);
    return `<button type="button" class="sdk-cal-event sdk-bar-kept is-marker${past ? (x.due ? ' is-overdue' : ' is-past') : ''}${tintClass(x)}" data-marker="${esc(x.key)}" title="${esc(markerTip(x, past))}">${markerIconHtml(x)}${markerSpaceIcon(x)}${esc(markerText(x, start, past))}</button>`;
  }
  function markerItemHtml(x, start, agenda) {
    const past = markerPast(x);
    const said = x.due ? (past ? 'Overdue' : 'Due') : past ? 'Closed' : 'Closes';
    const when = x.ev.allDay ? said : `${said} ${timeText(start)}`;
    const r = x.marker.ref.scope === 'space' && !inSpace ? spaceInfo.get(x.marker.ref.space) : null;
    const name = x.marker.module && x.marker.module.name ? String(x.marker.module.name) : '';
    return `<button type="button" class="sdk-row sdk-bar-kept is-marker${past ? (x.due ? ' is-overdue' : ' is-past') : ''}${tintClass(x)}" data-marker="${esc(x.key)}" title="${esc(markerTip(x, past))}"><span class="sdk-row-meta">${esc(isCompact() ? when.replace(/:00(?=\s?[AP]M)/i, '') : when)}</span>
      <span class="sdk-row-main"><span class="sdk-row-title">${markerIconHtml(x)}${agenda ? markerSpaceIcon(x) : ''}${esc(x.ev.title)}${name ? `<span class="sdk-chip-tag">${esc(name)}</span>` : ''}${!agenda && r ? `<span class="sdk-chip-tag">${spaceIcon({ scope: 'spaces', spaceId: r.id })} ${esc(r.name)}</span>` : ''}</span></span></button>`;
  }
  // A marker opens its object in its own module, as a link does; Ctrl or Cmd asks for a new tab where the page can.
  function openMarker(key, e) {
    const x = markerItems.get(key);
    if (!x) return;
    host.objects.open(x.marker.ref, { newTab: Boolean(e && (e.ctrlKey || e.metaKey)) }).catch((err) => note(err.message, true));
  }

  // The kinds of markers, for the filter: the toolbar's chips here, and as the destination's calendar the page's filter
  // holds them (told here; the page tells every part).
  function tellMarkerKinds() {
    if (part === 'main' && host.destination) {
      host.destination.set({ markerKinds: [...markerKinds.values()].slice(0, 20).map((k) => ({ id: k.id, label: k.label, icon: k.icon, tint: k.tint })) }).catch(() => {});
    }
    syncToolbar();
  }
  function toggleMarkerKind(id, on) {
    if (on) hiddenMarkers.delete(id); else hiddenMarkers.add(id);
    if (MARKERS_OFF_KEY) {
      try { localStorage.setItem(MARKERS_OFF_KEY, JSON.stringify([...hiddenMarkers])); } catch (err) { /* not remembered */ }
    }
    render();
  }

  // --- the toolbar row ---------------------------------------------------------------
  // The host's one row: the view switch, the period's title, back, Today and forward (Today alone on the Agenda), and the
  // filters in the row's Filters menu: on the environment page the viewer's spaces, the kinds of markers ("Tasks due") and
  // the person's other calendars; in a space the kinds of markers alone. As the destination's calendar the page's row has
  // the view switch and the filters, so this gives only the title and the way through; the Agenda gives nothing (the
  // page's panel switch is its heading).
  const ICON_NAME = /^[a-z0-9-]{1,40}$/;
  const EXTERNAL_TINT_NAMES = ['blue', 'teal', 'purple', 'green', 'orange']; // .ext-0 to .ext-4, in the destination's order
  function periodTitle() {
    return view === 'week' ? weekTitle() : view === 'day' ? dayHeading(anchor) : view === 'list' ? 'Next 90 days' : cursor.toLocaleDateString([], { month: 'long', year: 'numeric' });
  }
  // The filters, each a group of switches in the row's Filters menu (on: shown; one turned off is a filter applied).
  function filterGroups() {
    if (part) return [];
    const kinds = [...markerKinds.values()];
    const groups = [
      { id: 'show-spaces', label: word('space', { many: true, cap: true }), options: inSpace ? [] : [...spaceInfo.values()].map((r) => ({ id: `space:${r.id}`, label: r.name, ...(ICON_NAME.test(r.icon || '') ? { icon: r.icon } : {}), on: !hiddenSpaces.has(r.id) })) },
      { id: 'show-markers', label: 'Markers', options: kinds.map((k) => ({ id: `marker:${k.id}`, label: k.label, ...(ICON_NAME.test(k.icon || '') ? { icon: k.icon } : {}), ...(k.tint ? { tint: k.tint } : {}), on: !hiddenMarkers.has(k.id) })) },
      { id: 'show-calendars', label: 'Other calendars', options: inSpace ? [] : [...externalCalendars.values()].map((c) => ({ id: `ext:${c.id}`, label: c.name, icon: 'calendar', note: 'only you', tint: EXTERNAL_TINT_NAMES[c.tint] || 'blue', on: !hiddenExternal.has(c.id) })) },
    ];
    return groups.filter((g) => g.options.length).map((g) => ({ type: 'chips', ...g }));
  }
  function syncToolbar() {
    if (part === 'panel') return;
    host.toolbar.set([
      { type: 'title', text: periodTitle() },
      ...(view !== 'list' ? [{ id: 'prev', icon: 'chevron-left', title: 'Previous' }] : []),
      { id: 'today', label: 'Today' },
      ...(view !== 'list' ? [{ id: 'next', icon: 'chevron-right', title: 'Next' }] : []),
      ...filterGroups(),
    ]).catch(() => {});
    if (viewSwitch) viewSwitch.set(view);
  }
  host.on('toolbar', (e) => {
    if (e.id === 'prev') step(-1);
    else if (e.id === 'next') step(1);
    else if (e.id === 'today') { anchor = part ? startOfDay(new Date()) : new Date(); cursor = new Date(anchor.getFullYear(), anchor.getMonth(), 1); render(); }
    else if (['show-spaces', 'show-markers', 'show-calendars'].includes(e.id) && typeof e.value === 'string') {
      const at = e.value.indexOf(':');
      const what = e.value.slice(0, at);
      const id = e.value.slice(at + 1);
      if (what === 'marker') return toggleMarkerKind(id, Boolean(e.on));
      const set = what === 'space' ? hiddenSpaces : what === 'ext' ? hiddenExternal : null;
      if (!set) return;
      if (e.on) set.delete(id); else set.add(id);
      render();
    }
  });

  // --- the editor -----------------------------------------------------------

  function showError(text) {
    $('f-error').textContent = text;
    $('f-error').hidden = !text;
  }

  function syncForm() {
    const all = $('f-allday').checked;
    $('f-time-wrap').hidden = all;
    $('f-end-wrap').hidden = all;
    $('f-until-wrap').hidden = $('f-repeat').value === '';
  }
  $('f-allday').addEventListener('change', syncForm);
  $('f-repeat').addEventListener('change', syncForm);

  // Who a reminder reaches: everyone in the event's own place.
  function remindHint() {
    let who;
    const target = editing ? targetOf() : null;
    if (inSpace) who = `Everyone in this ${word('space')}`;
    else if (!target) who = `Everyone in the ${word('space')} you pick`;
    else if (target.scope === 'spaces') who = `Everyone in ${placeName('spaces', target.spaceId)}`;
    else who = `Everyone in this ${word('environment')}`;
    $('f-remind-hint').textContent = $('f-remind').value === '' ? '' : who + ' gets a notification, if they are allowed to see the calendar.';
  }
  $('f-remind').addEventListener('change', remindHint);

  // --- where an event goes ----------------------------------------------------------
  // On the environment page (and as a destination's part) a new event asks where it goes, every time: the
  // environment's own calendar, for people who may add events there, then each space where the viewer may add events.
  // It starts empty whatever was picked last, and Save says to pick first. An event that exists stays where it is:
  // Where shows its place and cannot be changed. In a space there is nothing to ask: it goes in that space.
  const pickWhere = () => `Pick ${word('space', { a: true })}`;
  function fillWhere(x) {
    const select = $('f-where');
    $('f-where-wrap').hidden = inSpace;
    if (inSpace) return;
    if (x) {
      select.innerHTML = `<option value="">${esc(x && isExternal(x) ? externalName(x.calendar) : placeName(x.scope, x.spaceId))}</option>`;
      select.disabled = true;
      return;
    }
    const options = [`<option value="" selected disabled>${esc(pickWhere())}</option>`];
    if (canEdit) options.push(`<option value="own">${esc(placeName('here'))}</option>`);
    for (const r of writableSpaces()) options.push(`<option value="in:${esc(r.id)}">${esc(r.name)}</option>`);
    select.innerHTML = options.join('');
    select.value = '';
    select.disabled = false;
  }
  // Where the open editor's event is, or goes: { scope: 'here' } or { scope: 'spaces', spaceId }; null while a new
  // event on the environment page has no place picked yet.
  function targetOf() {
    if (!editing) return null;
    if (editing.id) return { scope: editing.scope, spaceId: editing.spaceId };
    if (inSpace) return { scope: 'here' };
    const w = $('f-where').value;
    if (w === 'own') return { scope: 'here' };
    if (w.startsWith('in:') && spaceWritable(w.slice(3))) return { scope: 'spaces', spaceId: w.slice(3) };
    return null;
  }
  $('f-where').addEventListener('change', () => { showError(''); remindHint(); });

  // --- the date pickers ------------------------------------------------------
  // The shared picker from the SDK; the end and repeat-until fields can be cleared, and the picker on either
  // shows the event's span.
  const span = () => [$('f-date').value, $('f-end-date').value];
  const pickers = [
    host.ui.datePicker($('f-date'), { range: span }),
    host.ui.datePicker($('f-end-date'), { range: span, clearable: true }),
    host.ui.datePicker($('f-until'), { range: span, clearable: true }),
  ];

  // The times follow the environment's clock (12 or 24 hours), not the browser's own; .value stays "HH:MM".
  host.ui.timeField($('f-time'));
  host.ui.timeField($('f-end'));

  // The form opens in the SDK's editor window (host.ui.editor): a modal <dialog> over everything, sized to the form, a
  // sheet on a phone; the date pickers open inside it. Escape and its Close button ask "Discard your changes?" when the
  // form differs from what it opened with (isDirty), and so does Cancel (editor.cancel); Save and Delete close it at once. On close, focus goes back
  // to the event's chip or row (found again by its key, since render() redraws) or the Add event button.
  let opened = ''; // what the form held when it opened, as formState() gives it
  const formState = () => JSON.stringify({
    where: $('f-where-wrap').hidden ? '' : $('f-where').value,
    title: $('f-title').value,
    allDay: $('f-allday').checked,
    date: $('f-date').value,
    time: $('f-time').value,
    endDate: $('f-end-date').value,
    end: $('f-end').value,
    repeat: $('f-repeat').value,
    until: $('f-until').value,
    desc: $('f-desc').value,
    remind: $('f-remind').value,
  });
  let lastKey = null; // the key of the event the form was opened on, or saved as: where focus returns
  const returnTo = () => {
    const row = lastKey ? root.querySelector(`[data-open="${CSS.escape(lastKey)}"]`) : null;
    if (row) return row;
    return null; // the host's "+" that opened it
  };
  const editor = host.ui.editor($('editor'), {
    size: 'medium',
    isDirty: () => Boolean(editing) && !editing.readOnly && formState() !== opened, // a read-only form has nothing to lose
    onClose: () => {
      pickers.forEach((p) => p.close());
      backlinksFor = null;
      editing = null;
    },
  });

  // --- what links to an event, and being opened from a link -----------------------
  // Other modules (a to-do, say) can point at an event. The host tells this module what points at it
  // (host.objects.linksTo), only what the viewer may see, and a link to an event can ask for it to be
  // shown (host.objects.onOpen). Nothing here knows which modules those are.

  const whereFor = (x) => (x.scope === 'spaces' ? { space: x.spaceId } : x.scope === 'environment' && inSpace ? { scope: 'environment' } : undefined);
  let backlinksFor = null; // the event key the shown backlinks are for
  async function showBacklinks(x) {
    backlinksFor = x ? x.key : null;
    $('f-links-wrap').hidden = true;
    if (!x || isExternal(x) || !host.objects || !host.objects.linksTo) return;
    let summaries = [];
    try {
      summaries = await host.objects.linksTo(host.objects.make('event', x.id, whereFor(x)));
    } catch (err) {
      summaries = [];
    }
    if (backlinksFor !== x.key) return; // the editor moved on
    $('f-links').innerHTML = summaries.map((c) => (c.open
      ? `<button type="button" class="sdk-chip-tag" data-ref="${esc(JSON.stringify(c.ref))}"><b>${esc(c.kindName || c.module.name)}</b> ${esc(c.title)}</button>`
      : `<span class="sdk-chip-tag"><b>${esc(c.kindName || c.module.name)}</b> ${esc(c.title)}</span>`)).join('');
    $('f-links-wrap').hidden = summaries.length === 0;
  }
  $('f-links').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ref]');
    if (b && host.objects) host.objects.open(JSON.parse(b.dataset.ref)).catch((err) => showError(err.message));
  });
  // Opened at a place in the page (from the dashboard's month: "day=2026-09-24"): show that month with that day marked.
  if (host.page && host.page.onHash) {
    host.page.onHash((hash) => {
      const m = /(?:^|&)day=(\d{4}-\d{2}-\d{2})(?:&|$)/.exec(hash);
      if (!m) return;
      const d = parseYmd(m[1]);
      if (Number.isNaN(d.getTime())) return;
      cursor = new Date(d.getFullYear(), d.getMonth(), 1);
      anchor = d;
      if (!part) view = 'month'; // as a part the page's bar has the view
      render();
      const cell = root.querySelector(`.sdk-cal-cell[data-day="${m[1]}"]`);
      if (cell) {
        // The day the link opened: the selected fill and the word, for a moment.
        const word = document.createElement('span');
        word.className = 'sdk-cal-word';
        word.textContent = 'Linked';
        cell.querySelector('.sdk-cal-n').after(word);
        cell.classList.add('is-linked');
        cell.scrollIntoView({ block: 'center' });
        setTimeout(() => { cell.classList.remove('is-linked'); word.remove(); }, 2500);
      }
    });
  }
  // A pointer can arrive before the events have loaded (a #ref link on a fresh page, a pane just opened on a
  // space's canvas): it waits until they have, then the event is shown.
  let loaded = false;
  let waitingRef = null;
  function showRef(ref) {
    const x = events.get(keyOf('here', ref.id)) || events.get(keyOf('environment', ref.id)) || events.get(keyOf('spaces', ref.id, ref.space));
    if (!x) return;
    const d = startOf(x.ev);
    cursor = new Date(d.getFullYear(), d.getMonth(), 1);
    anchor = startOfDay(d);
    if (!part) view = 'month';
    render();
    openEditor(x);
  }
  if (host.objects && host.objects.onOpen) {
    host.objects.onOpen((ref) => {
      if (loaded) showRef(ref);
      else waitingRef = ref;
    });
    host.on('links', (e) => {
      if (e.ref && e.ref.kind === 'event' && editing && events.get(backlinksFor) && events.get(backlinksFor).id === e.ref.id) showBacklinks(events.get(backlinksFor));
    });
  }

  // What a person who may not change an event reads instead of the form: when, where, how often, the details.
  function summaryHtml(x, ev, zone) {
    const start = startOf(ev);
    const end = endOf(ev, start);
    const lines = [`<p class="sum-when">${esc(dayHeading(start))}<br>${esc(whenText(ev, start, end, false))}${zone ? ` <span class="sdk-chip-tag">${esc(zoneNote(zone))}</span>` : ''}</p>`];
    if (ev.repeat) lines.push(`<p>Repeats ${esc(REPEAT_NAMES[ev.repeat.every] || 'again and again')}${ev.repeat.until ? ` until ${esc(shortDay(parseYmd(ev.repeat.until)))}` : ''}.</p>`);
    if (!inSpace) lines.push(`<p>${esc(isExternal(x) ? externalName(x.calendar) : placeName(x.scope, x.spaceId))}</p>`);
    if (ev.desc) lines.push(`<p class="detail">${esc(ev.desc)}</p>`);
    if (ev.by && !isExternal(x)) lines.push(`<p class="sdk-hint">Added by ${esc(ev.by)}</p>`);
    return lines.join('');
  }
  function openEditor(x, day, prefill, at) {
    if (!x && !canAdd()) return;
    const readOnly = x ? !writable(x) : false;
    const ev = x ? x.ev : { title: '', allDay: false, start: '', end: null, desc: '', remind: null, repeat: null };
    const copy = x ? copyOf(x) : null;
    const zone = x ? zoneFor(x) : '';
    editing = x ? { scope: x.scope, id: x.id, version: x.version, spaceId: x.spaceId, key: x.key, readOnly, base: ev, tz: zone || null, copy: Boolean(copy), at: ev.repeat && at && /^\d{4}-\d{2}-\d{2}$/.test(at) ? at : '' } : { scope: null, id: null, version: null, spaceId: null };
    showError('');
    fillWhere(x);
    // One of the person's other calendars: what it is and when, nothing to remind, repeat or link.
    const outside = Boolean(x && isExternal(x));
    for (const el of [$('f-remind').closest('.sdk-field'), $('f-repeat-row'), $('f-desc').closest('.sdk-field')]) el.hidden = outside;
    // A copy of another module's object (the Itinerary's): it says so, and the length, All day and the repeat are the original's.
    $('f-repeat-row').hidden = outside || Boolean(copy);
    $('f-copy').hidden = !copy;
    $('f-copy').innerHTML = copy ? `${copyIcon(copy)}from ${esc(copyName(copy))}.${readOnly ? '' : ' Changing the title or the start changes it there too.'}` : '';
    // Read only in a place where the viewer may not add events: say why.
    const why = outside ? `From your ${externalName(x.calendar)} calendar. Only you see this.`
      : readOnly && !inSpace && x ? `Only people who can add events in ${placeName(x.scope, x.spaceId)} can change this.`
      : readOnly ? 'You can look at this event, not change it.' : '';
    $('f-readonly').textContent = why;
    $('f-readonly').hidden = !why;
    // A summary instead of a form of disabled fields.
    $('f-fields').hidden = readOnly;
    $('f-summary').hidden = !readOnly;
    $('f-summary').innerHTML = readOnly ? summaryHtml(x, ev, zone) : '';
    if (readOnly) $('f-where-wrap').hidden = true;
    const from = x && x.scope === 'spaces' && spaceInfo.get(x.spaceId) ? ` (${spaceInfo.get(x.spaceId).name})` : '';
    $('editor-title').textContent = x ? (readOnly ? ev.title + from : 'Edit event') : 'New event';
    $('f-title').value = ev.title;
    $('f-allday').checked = Boolean(ev.allDay);
    const start = x ? startOf(ev) : null;
    $('f-date').value = start ? ymd(start) : day || ymd(new Date());
    $('f-time').value = start && !ev.allDay ? `${pad(start.getHours())}:${pad(start.getMinutes())}` : '19:00';
    // The end: a date and time for a timed event, the last day for an all-day one.
    const endAt = ev.end && !ev.allDay ? readAt(ev, ev.end) : null;
    $('f-end-date').value = ev.end ? (ev.allDay ? ev.end : ymd(endAt)) : '';
    $('f-end').value = endAt ? `${pad(endAt.getHours())}:${pad(endAt.getMinutes())}` : '';
    $('f-desc').value = ev.desc || '';
    $('f-remind').value = ev.remind === null || ev.remind === undefined ? '' : String(ev.remind);
    // A quick add fills in what it understood: the title, and a time when one was typed.
    if (!x && prefill) {
      if (prefill.title) $('f-title').value = prefill.title;
      if (prefill.time) { $('f-time').value = prefill.time; $('f-allday').checked = false; }
    }
    $('f-repeat').value = ev.repeat ? ev.repeat.every : '';
    $('f-until').value = ev.repeat && ev.repeat.until ? ev.repeat.until : '';
    for (const id of ['f-title', 'f-date', 'f-time', 'f-end-date', 'f-end', 'f-allday', 'f-desc', 'f-remind', 'f-repeat', 'f-until']) $(id).disabled = readOnly;
    // The original owns a copy's length and whether it is all day: shown, not changed, and said so.
    const owned = Boolean(copy) && !readOnly;
    for (const id of ['f-allday', 'f-end-date', 'f-end']) $(id).disabled = readOnly || owned;
    const ownedWords = owned ? `The length and All day are set by the ${copyName(copy)}.` : '';
    $('f-owned').textContent = ownedWords; // under All day and the end: the date picker keeps its own hint line under the field
    $('f-owned').hidden = !owned;
    $('f-time-wrap').querySelector('.sdk-hint').textContent = zone ? zoneNote(zone) : '';
    $('f-save').hidden = readOnly;
    $('f-delete').hidden = readOnly || !x;
    $('f-delete').textContent = deleteLabel();
    $('f-delete-one').hidden = readOnly || !x || !(ev.repeat && editing.at);
    $('f-delete-one').textContent = 'Delete this one';
    // Read-only (an event from elsewhere): no button row; the window's own Close in the corner is the one way out.
    $('f-cancel').hidden = readOnly;
    $('f-cancel').parentElement.hidden = readOnly;
    syncForm();
    remindHint();
    if (outside) $('f-remind-hint').textContent = '';
    pickers.forEach((p) => p.refresh());
    showBacklinks(x || null);
    lastKey = x ? x.key : null;
    opened = formState();
    // Read-only: focus the window itself (nothing in it takes input); the corner Close is next on Tab.
    editor.open({ focus: readOnly ? $('editor') : $(x || inSpace ? 'f-title' : 'f-where'), returnTo });
  }
  function closeEditor() {
    editor.close();
  }
  // Cancel goes the way the SDK's own Close does (editor.cancel), so it asks "Discard your changes?" after typing.
  $('f-cancel').addEventListener('click', () => editor.cancel());
  // A reminder is a schedule the host runs for us: at the right time it sends the
  // notification, and for a repeating event the host schedules the next one itself,
  // so reminders keep coming while this page is closed. It stops if the event
  // changes or goes away.
  // `where` is the event's place for the host ({ space } for another space's event), so the reminder is set there and
  // reaches that space's people.
  async function applyReminder(id, ev, where) {
    const key = 'remind:' + id;
    const stop = () => host.cancelSchedule(key, where);
    try {
      if (ev.remind === null || ev.remind === undefined) return await stop();
      const lead = ev.remind * 60 * 1000;
      const nineAm = ev.allDay ? 9 * 60 * 60 * 1000 : 0; // an all-day event reminds relative to 9:00
      const now = Date.now();
      // The first occurrence whose reminder is not already in the past.
      const next = occurrences(ev, new Date(now + lead - 4 * 60 * 1000 - nineAm), new Date(now + 400 * DAY))[0];
      if (!next) return await stop();
      const at = next.getTime() + nineAm - lead;
      const until = ev.repeat && ev.repeat.until ? endOfDay(parseYmd(ev.repeat.until)).getTime() : null;
      if (until !== null && at > until) return await stop();
      const label = ev.remind === 0 ? 'Starting now' : ev.remind === 15 ? 'Starts in 15 minutes' : ev.remind === 60 ? 'Starts in an hour' : 'Starts tomorrow';
      await host.schedule({
        key,
        at,
        payload: { id },
        notify: { title: ev.title, body: label },
        repeat: ev.repeat ? { every: ev.repeat.every, until, tz: TZ } : undefined,
        ...(where || {}),
      });
    } catch (err) {
      showError('Saved, but the reminder could not be set: ' + err.message);
      throw err;
    }
  }

  async function save() {
    if (!editing || editing.scope === 'external') return; // another calendar's event is never saved anywhere
    showError('');
    const target = targetOf();
    if (!target) return showError(`${pickWhere()} first.`);
    const title = $('f-title').value.trim();
    const date = $('f-date').value;
    if (!title || !date) return showError('A title and a date are needed.');
    const base = editing.id ? editing.base : null;
    const allDay = editing.copy ? Boolean(base.allDay) : $('f-allday').checked;
    let start = date;
    let end = null;
    const endDate = $('f-end-date').value;
    if (editing.copy && allDay) {
      // A whole-day copy: moving its day moves its last day the same way.
      end = base.end ? ymd(addDays(parseYmd(base.end), Math.round((parseYmd(date) - parseYmd(base.start)) / DAY))) : null;
    } else if (editing.copy) {
      const time = $('f-time').value || '19:00';
      const s = instantFrom(date, time, editing.tz);
      if (Number.isNaN(s.getTime())) return showError('That time is not valid.');
      start = s.toISOString();
      // Its length stays the original's: the end moves with the start.
      end = base.end ? new Date(Date.parse(base.end) + (s.getTime() - Date.parse(base.start))).toISOString() : null;
    } else if (allDay) {
      // An all-day event's end is its last day.
      if (endDate && endDate < date) return showError('The end is before the start.');
      if (endDate && endDate > date) end = endDate;
    } else {
      const time = $('f-time').value || '19:00';
      const s = new Date(`${date}T${time}`);
      if (Number.isNaN(s.getTime())) return showError('That time is not valid.');
      start = s.toISOString();
      // An end date, an end time, or both. Missing one takes the start's.
      if (endDate || $('f-end').value) {
        const t = new Date(`${endDate || date}T${$('f-end').value || time}`);
        if (Number.isNaN(t.getTime())) return showError('That end is not valid.');
        if (t < s) return showError('The end is before the start.');
        if (t > s) end = t.toISOString();
      }
    }
    const remind = $('f-remind').value === '' ? null : Number($('f-remind').value);
    let repeat = null;
    if ($('f-repeat').value) {
      const until = $('f-until').value || null;
      if (until && until < date) return showError('"Until" is before the first date.');
      repeat = { every: $('f-repeat').value, until };
    }
    const id = editing.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    // The zone a copy's clock is read in, and the days taken out of a repeat, stay as they were.
    const ev = { id, title, allDay, start, end, desc: $('f-desc').value.trim(), remind, repeat, by: info.user.name, ...(base && base.tz !== undefined ? { tz: base.tz } : {}), ...(base && repeat && base.skips ? { skips: base.skips } : {}) };
    const where = placeOpts(target.scope, target.spaceId);
    $('f-save').disabled = true;
    try {
      // A copy is saved in its own zone, so the original's time follows what is on screen, not where this person is.
      const saved = await host.storage.set('event:' + id, ev, { ...(editing.id ? { version: editing.version } : {}), ...(editing.copy && base && base.tz ? { tz: base.tz } : {}), ...where });
      remember(target.scope, { key: 'event:' + id, value: ev, version: saved.version }, target.spaceId);
      lastKey = keyOf(target.scope, id, target.spaceId);
      let reminderFailed = false;
      try { await applyReminder(id, ev, where); } catch (err) { reminderFailed = true; }
      render();
      if (!reminderFailed) closeEditor();
      else editing = { scope: target.scope, id, version: saved.version, spaceId: target.spaceId };
    } catch (err) {
      showError(err.status === 409 ? 'Someone changed this event since you opened it. Close it and open it again.' : err.message);
    } finally {
      $('f-save').disabled = false;
    }
  }
  // Save on the button, and on Enter in a field. (The frame's own form-submit is
  // not relied on, so this works wherever a sandboxed frame blocks submitting.)
  $('f-save').addEventListener('click', save);
  $('form').addEventListener('submit', (e) => { e.preventDefault(); save(); });
  $('form').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    save();
  });

  let deleteArmed = false;
  let deleteAsking = false;
  // A copy is hidden, not deleted (the original keeps it); a repeat offers this one or all of them.
  const deleteLabel = () => (editing && editing.copy ? 'Hide' : editing && editing.at ? 'Delete all' : 'Delete');
  $('f-delete').addEventListener('click', async () => {
    if (!editing || !editing.id || deleteAsking) return;
    if (!deleteArmed) {
      deleteAsking = true;
      const current = events.get(keyOf(editing.scope, editing.id, editing.spaceId));
      const usual = current && current.ev.repeat ? 'Really delete all of them?' : 'Really delete?';
      let n = 0;
      let original = null;
      if (current && host.objects && host.objects.linksTo) {
        try {
          const summaries = await host.objects.linksTo(host.objects.make('event', current.id, whereFor(current)));
          n = Array.isArray(summaries) ? summaries.length : 0;
          // The object this event is a copy of (the host marks it: `twins` lists its copies). Deleting a copy only hides it.
          original = (Array.isArray(summaries) ? summaries : []).find((x) => Array.isArray(x.twins) && x.twins.some((t) => t.module === 'calendar' && String(t.id) === String(current.id))) || null;
        } catch { /* the usual question still stands */ }
      }
      deleteAsking = false;
      deleteArmed = true;
      $('f-delete').textContent = original ? `This hides it from the Calendar. The ${(original.module && original.module.name) || 'original'} keeps it. Hide it?` : n ? `Used by ${n}. ${usual}` : usual;
      setTimeout(() => { deleteArmed = false; $('f-delete').textContent = deleteLabel(); }, 4000);
      return;
    }
    deleteArmed = false;
    try {
      const where = placeOpts(editing.scope, editing.spaceId);
      await host.storage.delete('event:' + editing.id, where);
      try { await host.cancelSchedule('remind:' + editing.id, where); } catch (err) { /* nothing to cancel */ }
      events.delete(keyOf(editing.scope, editing.id, editing.spaceId));
      closeEditor();
      render();
    } catch (err) {
      showError(err.message);
    }
  });

  // One occurrence of a repeat taken out: its day is kept in the event's `skips`, the rest go on.
  $('f-delete-one').addEventListener('click', async () => {
    if (!editing || !editing.id || !editing.at) return;
    const current = events.get(keyOf(editing.scope, editing.id, editing.spaceId));
    if (!current) return;
    const where = placeOpts(editing.scope, editing.spaceId);
    const ev = { ...current.ev, skips: [...new Set([...(Array.isArray(current.ev.skips) ? current.ev.skips : []), editing.at])].slice(-400) };
    try {
      const saved = await host.storage.set('event:' + editing.id, ev, { version: current.version, ...where });
      remember(editing.scope, { key: 'event:' + editing.id, value: ev, version: saved.version }, editing.spaceId);
      applyReminder(editing.id, ev, where).catch(() => {});
      closeEditor();
      render();
    } catch (err) {
      showError(err.status === 409 ? 'Someone changed this event since you opened it. Close it and open it again.' : err.message);
    }
  });

  // --- wiring ---------------------------------------------------------------

  // Previous and next step a month, a week in the week view or a day in the day view; the month, the week and the
  // day follow each other. As the destination's calendar a month keeps today selected when it is in it, else its 1st.
  const step = (n) => {
    if (view === 'day') anchor = addDays(anchor, n);
    else if (view === 'week') anchor = addDays(anchor, 7 * n);
    else {
      anchor = new Date(cursor.getFullYear(), cursor.getMonth() + n, 1);
      const now = new Date();
      if (part && now.getFullYear() === anchor.getFullYear() && now.getMonth() === anchor.getMonth()) anchor = startOfDay(now);
    }
    cursor = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    render();
  };
  function startNew() {
    if (!canAdd()) return;
    openEditor(null, part === 'main' ? ymd(anchor) : undefined);
  }
  // Typed text goes through Chat `/e` (addEvent): parseWhen, then this same editor, nothing saved until Save.
  // Add event is the "+" in the titlebar (host.add.set, one action: it runs at once), which the host draws wherever the
  // calendar is: a window's titlebar, popped out too, the page bar on its own page and on the Calendar destination, the
  // composite's "+" in a Workspace's Calendar. The Agenda adds nothing. Who may add is known once the spaces are in.
  const ADD_EVENT = { id: 'event', label: 'Add event', icon: 'calendar-plus' };
  function showAdd() {
    if (part !== 'panel') host.add.set(canAdd() ? [ADD_EVENT] : []).catch(() => {});
  }
  if (part !== 'panel') host.on('add', (e) => { if (e.id === ADD_EVENT.id && canAdd()) startNew(); });

  // The status line at the foot of the window: the period shown and how many events are in it ("Oct 2026 · 14 events"),
  // and a chip when kinds of markers are hidden. As the destination's calendar the composite's status bar shows it.
  // The Agenda says nothing (the calendar beside it does).
  function syncStatus() {
    if (!host.status || part === 'panel') return;
    const items = [];
    if (loaded || events.size) {
      let range;
      let count;
      if (view === 'list') {
        const from = startOfDay(new Date());
        range = 'Next 90 days';
        count = inRange(from, addDays(from, 90)).filter((o) => !isMarker(o.x)).length;
      } else {
        const p = period();
        range = view === 'week' ? weekTitle() : view === 'day' ? anchor.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : cursor.toLocaleDateString([], { month: 'short', year: 'numeric' });
        count = nothingPicked() ? 0 : inRange(p.from, p.to).filter((o) => !isMarker(o.x)).length;
      }
      items.push({ text: range }, { text: count ? `${count} ${count === 1 ? 'event' : 'events'}` : 'No events' });
      const hiddenKinds = [...markerKinds.values()].filter((k) => hiddenMarkers.has(k.id)).length;
      if (hiddenKinds) items.push({ text: `${hiddenKinds} ${hiddenKinds === 1 ? 'kind' : 'kinds'} hidden`, title: 'Kinds of markers hidden in Filters' });
    }
    host.status.set(items).catch(() => {});
  }

  // --- as a part of the Calendar destination -------------------------------------------
  // The page owns the view and the filter and hands them over (host.destination.onState); the calendar owns the
  // selected day and the period it shows, and tells the page (host.destination.set), which tells the Agenda.
  let told = '';
  function tellPeriod() {
    if (part !== 'main' || !host.destination) return;
    const p = period();
    const next = { day: ymd(anchor), from: ymd(p.from), to: ymd(p.to) };
    const sig = JSON.stringify(next);
    if (sig === told) return;
    told = sig;
    host.destination.set(next).catch(() => { told = ''; });
  }
  let firstState = true;
  function takeState(st) {
    if (!st || typeof st !== 'object') return;
    if (Array.isArray(st.spaces)) {
      const on = new Set(st.spaces.map(String));
      hiddenSpaces.clear();
      for (const id of spaceInfo.keys()) if (!on.has(id)) hiddenSpaces.add(id);
      pickedSpaces = on;
    }
    // The page's filter says whether the environment's own events show; in a space the page has no such choice (its
    // state says `environment: false` for the aggregate's sake) and this place's own events always show.
    hideOwn = !inSpace && st.environment === false;
    if (Array.isArray(st.externalOff)) {
      hiddenExternal.clear();
      for (const id of st.externalOff) hiddenExternal.add(String(id));
    }
    if (Array.isArray(st.markersOff)) {
      hiddenMarkers.clear();
      for (const id of st.markersOff) hiddenMarkers.add(String(id));
    }
    if (part === 'main') {
      if (PART_VIEWS.includes(st.view)) view = st.view;
      // The day the page opens on (a link to a day, say); after that the calendar says which day is selected.
      if (firstState && typeof st.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(st.day)) {
        anchor = parseYmd(st.day);
        cursor = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      }
    } else {
      agendaState = st;
    }
    firstState = false;
    if (loaded) render();
  }
  // The filter's spaces, kept so a space that loads after the state (or joins later) is shown or hidden by it.
  let pickedSpaces = null;
  if (part && host.destination) host.destination.onState(takeState);
  // An event can be dragged onto another module that links to events (a to-do, say): it carries a
  // pointer to the event, and the other module asks the host for what it may show.
  if (host.objects && host.objects.draggable) {
    host.objects.draggable($('body'), (target) => {
      const open = target.closest('[data-open]');
      const x = open && events.get(open.dataset.open);
      return x && !isExternal(x) ? { kind: 'event', id: x.id, label: x.ev.title, ...whereFor(x) } : null;
    });
  }
  // --- what a drop can do ---------------------------------------------------
  // An object dropped from another module on a day, or on an event, offers what can be done with it. Some
  // of that is this module's own (make an event of it); the rest is whatever other modules say they can do
  // with an object of that kind and can be filled in from what this module has (the day, an event's pointer).
  // Nothing here names the module the object came from. More than one choice: the person is asked.
  let noteTimer = 0;
  function note(text, bad) {
    $('note').textContent = text;
    $('note').classList.toggle('bad', Boolean(bad));
    $('note').hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { $('note').hidden = true; }, 4000);
  }
  // An all-day event on `date`; `fields` (eventFromObject) gives its own times and description instead.
  async function createEventOn(title, date, ref, fields) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const when = fields ? { allDay: fields.allDay, start: fields.start, end: fields.end || null, desc: fields.desc || '' } : { allDay: true, start: date, end: null, desc: '' };
    const ev = { id, title: String(title).slice(0, 120), ...when, remind: null, repeat: null, by: info.user.name };
    const saved = await host.storage.set('event:' + id, ev, {});
    remember('here', { key: 'event:' + id, value: ev, version: saved.version });
    const made = host.objects.make('event', id);
    // Made from an object dropped or handed over: point at it, so the link shows from both ends.
    if (ref && host.objects.setLinks) host.objects.setLinks(made, [ref]).catch(() => {});
    render();
    return { ref: made };
  }
  const dropSpot = (pt) => {
    const el = host.objects.elementAt(pt);
    if (!el) return null;
    const open = el.closest('[data-open]');
    const x = open && events.get(open.dataset.open);
    if (x && !isExternal(x)) return { el: open, event: x, day: ymd(startOf(x.ev)) };
    const cell = el.closest('[data-day]');
    return cell ? { el: cell, event: null, day: cell.dataset.day } : null;
  };
  const clearDrop = () => { for (const e of root.querySelectorAll('.is-drop')) e.classList.remove('is-drop'); };
  // What a drop can do is the one shared decision (host.objects.dropMenu): this module says what is under the
  // pointer (the day, and the event when dropped on one) and offers its own (make an event of it); the SDK adds
  // whatever the modules around offer for an object of that kind, filled from the same context.
  if (host.objects && host.objects.dropTarget && host.actions) {
    const foreign = (ref, dragged) => (ref ? ref.module !== info.module.id : Boolean(dragged && dragged.summary));
    host.objects.dropTarget({
      // A drop is taken from anyone: what it offers may be another module's to do (a task's due date, To-do's own
      // permission), and this module's own offer (an event made of it) only for those who may add events here.
      over: (pt, ref, dragged) => {
        clearDrop();
        if (!foreign(ref, dragged)) return;
        const spot = dropSpot(pt);
        if (spot) spot.el.classList.add('is-drop');
      },
      leave: clearDrop,
      drop: async (ref, pt, dragged) => {
        clearDrop();
        if (!foreign(ref, dragged)) return;
        const spot = dropSpot(pt);
        host.objects.trace(spot ? 'drop on ' + (spot.event ? 'event ' + spot.event.id : 'day ' + spot.day) : 'drop: nothing under the pointer');
        if (!spot) return;
        try {
          const context = { date: spot.day, ...(spot.event ? { target: host.objects.make('event', spot.event.id, whereFor(spot.event)) } : {}) };
          const chosen = await host.objects.dropMenu(dragged, pt, {
            context,
            own: spot.event || !canEdit ? [] : [{ id: 'create', label: 'Add to the calendar as an event', hint: shortDay(parseYmd(spot.day)), run: (ctx) => createEventOn(ctx.summary.title || (ref ? ref.kind : 'Event'), spot.day, ref) }],
            remember: spot.event ? 'event' : 'day',
          });
          if (chosen) note(chosen.label + ': done');
        } catch (err) {
          note(err.message, true);
        }
      },
    });
  }
  // What other modules may ask of this one: put something on the calendar, pointing at `ref` when one is given.
  // The Agenda leaves them to the calendar beside it, so one page does each once.
  if (host.actions && host.actions.provide && part !== 'panel') {
    host.actions.provide({
      // With `object` (plan-object-handoff.md): an event made of it (eventFromObject in calendar-lib.js), timed when it says
      // a time. Either way it needs a day: the object's, else `date`.
      createEvent: async (input) => {
        if (!canEdit) throw new Error('this person cannot add events here');
        if (input.object && typeof input.object === 'object') {
          const made = eventFromObject(input.object, host.util, input.date);
          if (!made) throw new Error('that needs a day to go on the calendar');
          return createEventOn(made.title || input.title, made.allDay ? made.start : null, input.ref, made);
        }
        if (!input.date) throw new Error('that needs a day to go on the calendar');
        return createEventOn(input.title, input.date, input.ref);
      },
      addEvent: async (input) => {
        if (!canAdd()) throw new Error('this person cannot add events here');
        const parsed = input.text && host.util.parseWhen ? host.util.parseWhen(input.text) : { title: input.text || '' };
        openEditor(null, parsed.date, parsed);
        return {};
      },
    });
  }
  $('body').addEventListener('click', (e) => {
    // A marker opens its object in its own module; it is never edited here.
    const marker = e.target.closest('[data-marker]');
    if (marker) {
      openMarker(marker.dataset.marker, e);
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open) {
      const x = events.get(open.dataset.open);
      if (x) openEditor(x, undefined, undefined, open.dataset.at);
      return;
    }
    // An hour of the day view: a new event at that hour.
    const hour = e.target.closest('[data-hour]');
    if (hour) {
      if (canAdd()) openEditor(null, hour.dataset.day, { time: `${pad(Number(hour.dataset.hour))}:00` });
      return;
    }
    const day = e.target.closest('[data-day]');
    if (!day) return;
    // As the destination's calendar a click selects the day (the Agenda follows); elsewhere it starts an event on it.
    if (part === 'main') {
      anchor = parseYmd(day.dataset.day);
      cursor = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      focusDay = day.dataset.day;
      render();
    } else if (canAdd()) openEditor(null, day.dataset.day);
  });
  // On a day: Enter or Space picks it and keeps the focus on it (the redraws that follow give it back); the arrows move the
  // focus a day or a week, Home and End to the week's ends, Page Up and Down a month. A day outside the grid is picked.
  root.addEventListener('keydown', (e) => {
    if (part !== 'main' || !e.target.matches || !e.target.matches('.sdk-cal-cell[data-day]') || e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.target.dataset.day;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      focusDay = k;
      focusUntil = Date.now() + 1500;
      e.target.click();
      settleGrid();
      return;
    }
    const from = parseYmd(k);
    const to = { ArrowLeft: addDays(from, -1), ArrowRight: addDays(from, 1), ArrowUp: addDays(from, -7), ArrowDown: addDays(from, 7),
      Home: addDays(from, -from.getDay()), End: addDays(from, 6 - from.getDay()),
      PageUp: new Date(from.getFullYear(), from.getMonth() - 1, from.getDate()), PageDown: new Date(from.getFullYear(), from.getMonth() + 1, from.getDate()) }[e.key];
    if (!to) return;
    e.preventDefault();
    const key = ymd(to);
    const cell = root.querySelector(`.sdk-cal-cell[data-day="${key}"]`);
    focusDay = key;
    if (cell && e.key !== 'PageUp' && e.key !== 'PageDown') {
      for (const c of root.querySelectorAll('.sdk-cal-cell[tabindex="0"]')) c.tabIndex = -1;
      cell.tabIndex = 0;
      cell.focus();
      return;
    }
    focusUntil = Date.now() + 1500;
    anchor = to;
    cursor = new Date(to.getFullYear(), to.getMonth(), 1);
    render();
  });

  // A frame can report no width while it is still being laid out, so wait for a real
  // one before choosing the compact layout.
  const fit = () => {
    const w = host.rootElement.clientWidth;
    if (!w) return;
    $('app').classList.toggle('sdk-cal-compact', w < 520);
  };
  // A calendar that was just closed (in the page, its elements go before its root stops resizing) has nothing to draw.
  new ResizeObserver(() => { if (!$('app')) return; fit(); render(); }).observe(host.rootElement);

  // As a part of the destination's page, say how tall the content is: a page too narrow for the panel beside the
  // calendar stacks the parts in its one scroll, each as tall as this, so nothing here scrolls on its own. Beside each
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

  try {
    await load();
  } catch (err) {
    $('msg').textContent = 'The calendar could not load: ' + err.message;
    return;
  }
  if (pickedSpaces) for (const id of spaceInfo.keys()) if (!pickedSpaces.has(id)) hiddenSpaces.add(id);
  showAdd();
  $('msg').hidden = true;
  $('app').hidden = false;
  fit();
  phaseBands = readPhases();
  render();
  loaded = true;
  // The host says when the phases change; a slow look now and then is the fallback.
  host.on('phases', (e) => { if ($('app')) lookAtPhases(e && e.timeline); });
  const phaseTimer = setInterval(() => { if (!$('app')) clearInterval(phaseTimer); else lookAtPhases(); }, 300000);
  askExternal(false);
  askMarkers(false);
  // A poll's closing time passing, or midnight making a task overdue, dims its marker without anyone asking.
  // Stopped once this module is closed (in the page, its elements go and the timer would draw into nothing).
  let pastSeen = '';
  const pastTimer = setInterval(() => {
    if (!$('app')) return void clearInterval(pastTimer);
    const now = [...markerItems.values()].map(markerPast).join('');
    if (now !== pastSeen) { pastSeen = now; if (markerItems.size) render(); }
  }, 60000);
  if (waitingRef) {
    const ref = waitingRef;
    waitingRef = null;
    showRef(ref);
  }

  // An event that has passed is announced once, for the modules that follow it (a task that is done when the
  // event is over, say). Whoever has the calendar open first after it ends announces it, marking the event so
  // nobody repeats it; moving the event clears the mark. Repeating events are not announced, and neither is
  // one that ended more than a week ago (so opening an old calendar announces nothing from long ago).
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const announcing = new Set();
  async function announceEnded() {
    if (!host.events || !canEdit || part === 'panel') return;
    const now = Date.now();
    let sent = 0;
    for (const x of [...events.values()]) {
      if (x.scope !== 'here' || x.ev.repeat || x.ev.announced || announcing.has(x.id) || sent >= 5) continue;
      const ends = instantOfStart(x.ev).getTime() + durationOf(x.ev);
      if (ends > now || now - ends > WEEK) continue;
      announcing.add(x.id);
      sent += 1;
      const ev = { ...x.ev, announced: true };
      try {
        const saved = await host.storage.set('event:' + x.id, ev, { version: x.version });
        remember('here', { key: 'event:' + x.id, value: ev, version: saved.version });
        const day = startOf(ev).toLocaleDateString([], { month: 'short', day: 'numeric' });
        await host.events.publish('ended', { ref: host.objects.make('event', x.id, whereFor(x)), data: { summary: (ev.title + ', ' + day).slice(0, 200) } });
      } catch (err) {
        // someone else announced it first, or nobody may hear it: the event is fine either way
      } finally {
        announcing.delete(x.id);
      }
    }
  }
  announceEnded();
  const announceTimer = setInterval(() => { if (!$('app')) return void clearInterval(announceTimer); announceEnded(); }, 60000);
})();
