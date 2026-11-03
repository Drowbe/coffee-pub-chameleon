// The Travel module's page: a trip's itinerary, day by day, for one space. The trip and its items live in the module's
// store (see travel-lib-plan.js); this page draws them into the markup in travel.html by cloning its templates and
// filling their [data-slot] and [data-icon] hooks, and then only toggles the state classes and data attributes that
// CONTRACT.md lists. It never builds markup from strings and sets no style (one exception: the item menu is placed
// under the button that opened it). Objects other modules hold come in as pointers, drawn from their summaries.
(async () => {
  'use strict';

  // This module runs in a frame (the SDK is a global) or in the page (its SDK is handed to its script); either way
  // it looks elements up in host.root, never in document, so it works in both.
  const host = (document.currentScript && document.currentScript.host) || window.host;
  const root = host.root;
  const word = host.util.word; // the environment's word for a level or role (host.locale().words)
  const $ = (id) => root.getElementById(id);
  const { ymd, parseYmd } = host.util;

  let info;
  try {
    info = await host.ready();
  } catch (err) {
    $('msg').textContent = 'Planner could not start: ' + err.message;
    return;
  }
  if (info.context.scope !== 'space') {
    // Named by the module's own name here and the environment's space word, never the Planner's own item (a trip), which
    // a template may also call its space word.
    $('msg').textContent = `${info.module.name} works inside ${word('space', { a: true })}. Open ${word('space', { a: true })}, then ${info.module.name} there; the dashboard lists your ${word('space', { many: true })}.`;
    return;
  }

  /*__LIB__*/

  const canEdit = host.can('edit');
  const plan = createPlan(host);
  // A linked object changed or was deleted: ask again, so the plan shows the current one without a reload.
  if (host.objects && host.objects.onChange) host.objects.onChange(() => { plan.refreshSummaries().catch(() => {}); });
  const CAT = { do: 'things', eat: 'food', stay: 'stay', travel: 'travel', other: 'other' };
  const CAT_LABEL = { do: 'Things to do', eat: 'Food', stay: 'Stay', travel: 'Travel', other: 'Other' };
  const CAT_ICON = { do: 'ticket', eat: 'utensils', stay: 'bed', travel: 'plane', other: 'note-sticky' };

  const state = {
    view: 'days',
    budgetOn: false, // another module that reads the budget is on in this space: its money replaces the Money view and the spent fact
    loaded: false,
    focusAfterRedraw: null, // { id, until }: a new object just saved; each redraw until then focuses its row's menu
    people: [], // [{ key, name }] of this space
    links: new Map(), // plan item id -> summaries of what other modules link to it
    tripLinks: [], // summaries of what other modules link to the trip itself
    conflicts: new Map(), // item id -> { patch }: my edit that met someone else's change
    editing: null, // { mode: 'item' | 'trip', id, kind, day, opened }: the form that is open, and what it held when it opened
    editingFrom: null, // where focus goes when the form closes: { el, id, date }
    menuFor: null, // item id
    currentDay: null, // the day in view (where a quick add goes)
    expanded: new Set(), // item ids whose card's "More" is open
    markerTypes: [],
    flightLookup: false, // the server offers the flight lookup here (host.lookup.available)
    hideEmpty: (() => { try { return localStorage.getItem('planner-hide-empty') === '1'; } catch (err) { return false; } })(), // per person, off by default
  };
  const nameOf = (key) => (state.people.find((p) => p.key === key) || {}).name || 'Someone';

  // --- small helpers -----------------------------------------------------------------------------------------

  // A template's copy, its data-word marks filled with this environment's words.
  const clone = (id) => host.util.fillWords($(id).content.firstElementChild.cloneNode(true));
  const parts = (id) => [...$(id).content.children].map((n) => host.util.fillWords(n.cloneNode(true)));
  const hide = (node, yes) => { if (node) node.hidden = Boolean(yes); };
  // The place line has an icon and a text of its own: set the text and hide the line when there is none.
  const setPlace = (el, text) => { fill(el, { 'place-text': text }); hide(slot(el, 'place'), !text); };
  const slot = (el, name) => el.querySelector(`[data-slot="${name}"]`);
  // Set a slot's text, or hide the slot when there is nothing to show.
  function fill(el, values) {
    for (const [name, v] of Object.entries(values)) {
      const node = slot(el, name);
      if (!node) continue;
      if (v === null || v === undefined || v === '') { node.hidden = true; continue; }
      node.hidden = false;
      node.textContent = String(v);
    }
  }

  // Icons come as inline SVG from the SDK, fetched once each; an element with data-icon gets its icon when it arrives.
  const iconSvg = new Map();
  const iconWait = new Map();
  function wantIcon(name) {
    if (iconSvg.has(name)) return Promise.resolve(iconSvg.get(name));
    if (!iconWait.has(name)) iconWait.set(name, host.ui.icon(name).then((svg) => { iconSvg.set(name, svg); return svg; }).catch(() => { iconSvg.set(name, ''); return ''; }));
    return iconWait.get(name);
  }
  // Icons not here yet are waited for once per scan, together: a scan per pending icon would attach a scan to every
  // other pending icon too, and a form opened while its icons still load would scan itself 2^n times.
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
  // A note drawn with the same markdown as chat and research. Links open in a new window.
  function setMarkup(node, text) {
    if (!node) return;
    const words = String(text || '').trim();
    node.hidden = !words;
    node.innerHTML = words ? host.util.markdown(words) : '';
  }

  const dayShort = (d) => parseYmd(d).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  // A stored time ("22:30") the way the server shows times (host.util.time: "10:30 PM" on the default 12-hour clock).
  const tt = (t) => (t ? host.util.time(t) : '');
  const hm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const lengthText = gapText; // "8 h 15 min", "45 min"
  // "– 3:00 PM" (with " +1" past midnight) for a timed stop with a length; else ''.
  const endText = (item) => {
    if (!item || !item.time || !item.minutes) return '';
    const e = endOf(item.time, item.minutes);
    return e ? `– ${tt(e.time)}${e.days ? ` +${e.days}` : ''}` : '';
  };
  // "8:00 AM – 3:00 PM": the start and the end.
  const spanText = (item) => [tt(item.time), endText(item)].filter(Boolean).join(' ');
  // When a timed item arrives, on the environment's clock, with the day when it is not the day it leaves ("2:00 AM the next day").
  // `sep` goes between the time and the day: the narrow time column puts the day on a line of its own ("\n").
  const arriveText = (item, sep = ' ') => { const a = arrivalOf(item); return a ? [tt(a.time), laterText(a.days)].filter(Boolean).join(sep) : ''; };
  // One letter, or two when another traveller of the space starts with the same one.
  const initial = (key) => {
    const name = nameOf(key);
    const first = (name[0] || '?').toUpperCase();
    const clash = state.people.some((p) => p.key !== key && (p.name[0] || '').toUpperCase() === first);
    return clash ? first + (name[1] || '').toLowerCase() : first;
  };
  const timeOf = (summary) => (summaryWhen(summary) || {}).time || '';
  const planRef = (id) => host.objects.make('plan', id);
  const tripRef = () => host.objects.make('trip', 'main');
  const note = (text) => { $('note').textContent = text || ''; hide($('note'), !text); };

  // The time cell: the start in bold, then whatever goes after it.
  function setTime(cell, start, after) {
    cell.textContent = '';
    if (start) { const b = document.createElement('b'); b.textContent = start; cell.append(b); }
    if (after) cell.append(document.createTextNode(after));
  }

  // --- one entry of a day: a row with its card ---------------------------------------------------------------------

  const LEG_MODES = Object.keys(LEG_ICONS);
  function ownersInto(el, item) {
    const box = slot(el, 'owners');
    if (!box) return;
    box.textContent = '';
    hide(box, !item.owners.length);
    for (const key of item.owners) { const o = clone('tpl-owner'); o.textContent = initial(key); box.append(o); }
    box.setAttribute('title', item.owners.map(nameOf).join(', '));
  }
  const words = (n, one, many) => (n ? `${n} ${n === 1 ? one : many}` : '');
  // Fill the slots named in `values`; a slot with no value hides, and so does a wrapper whose only content it was.
  function put(el, values) {
    fill(el, values);
    for (const w of el.querySelectorAll('[data-slot$="-wrap"]')) {
      const name = w.dataset.slot.replace(/-wrap$/, '');
      const inner = slot(el, name === 'class' ? 'travelClass' : name);
      w.hidden = !inner || inner.hidden;
    }
  }

  // Why a linked object cannot be drawn from its summary: 'gone' (deleted), 'hidden' (this viewer may not see it), 'unavailable'
  // (it could not be read just now), or '' when it can.
  const linkState = (summary) => (summary && summary.error ? summary.state || 'unavailable' : '');

  // The card for an item, by its type (see cardOf in the model), filled by slot name. A link is drawn from `summary`, what the
  // object it points at says of itself.
  function buildCard(entry, kind, summary) {
    const { item, span } = entry;
    const c = cardOf(item, summary);
    const el = clone(`tpl-card-${span === 'middle' ? 'hotel-mid' : span === 'end' ? 'hotel-out' : c.template}`);
    const arrive = arriveText(item);
    const duration = lengthText(item.minutes);
    const where = item.place || item.address;
    const badge = el.querySelector('.badge [data-icon]');
    if (badge && c.badge && !badge.dataset.icon) setIcon(badge, c.badge);
    if (c.template === 'flight') {
      put(el, { title: [item.operator, item.number].filter(Boolean).join(' ') || item.title, fromCode: item.fromCode, toCode: item.toCode, from: item.from, to: item.to, time: tt(item.time), arrival: arrive, duration, seat: item.seat, gate: item.gate, travelClass: item.travelClass });
    } else if (c.template === 'train') {
      put(el, { title: [item.operator, item.number].filter(Boolean).join(' ') || item.title, from: item.from, to: item.to, time: tt(item.time), arrival: arrive, platform: item.platform ? `Platform ${item.platform}` : '', seat: [item.carriage && `Coach ${item.carriage}`, item.seat && `Seat ${item.seat}`].filter(Boolean).join(' · '), duration, confirm: item.confirm });
    } else if (c.template === 'transit') {
      const back = item.mode === 'car' && item.checkOut ? `Back ${[dayShort(item.checkOut), tt(item.checkOutTime)].filter(Boolean).join(' · ')}` : '';
      const to = [item.to || item.dropoff, back].filter(Boolean).join(' · ');
      put(el, { kicker: [c.kicker, item.operator].filter(Boolean).join(' · '), title: item.title, time: tt(item.time), to, confirm: item.confirm });
      const go = el.querySelector('.go');
      if (go && !item.time && !to && !item.confirm) go.hidden = true;
    } else if (c.template === 'hotel' && span !== 'end' && span !== 'middle') {
      const nights = stayNights(item);
      put(el, { kicker: c.kicker, title: item.title, address: where, nights: words(nights, 'night', 'nights'), checkin: [item.date && dayShort(item.date), tt(item.time)].filter(Boolean).join(' · '), checkout: item.checkOut ? [dayShort(item.checkOut), tt(item.checkOutTime)].filter(Boolean).join(' · ') : 'Not set', roomType: item.roomType, guests: words(item.guests, 'guest', 'guests'), confirm: item.confirm });
    } else if (span === 'end') {
      put(el, { title: item.title, address: where, time: tt(item.checkOutTime), nights: words(stayNights(item), 'night', 'nights') });
    } else if (span === 'middle') {
      put(el, { title: `Staying at ${item.title}` });
    } else if (c.template === 'meal') {
      setIcon(el.querySelector('.badge [data-icon]'), c.badge);
      put(el, { kicker: c.kicker, title: item.title, address: where, partySize: item.partySize ? `Table for ${item.partySize}` : '', reservationName: item.reservationName ? `under ${item.reservationName}` : '', time: spanText(item), minutes: duration });
    } else if (c.template === 'activity') {
      setIcon(el.querySelector('.badge [data-icon]'), c.badge);
      put(el, { kicker: c.kicker, title: item.title, address: where, minutes: duration, admissionCount: words(item.admissionCount, 'ticket', 'tickets'), confirm: item.confirm });
    } else if (c.template === 'show') {
      put(el, { kicker: c.kicker, title: item.title, address: where, gate: item.gate ? `Gate ${item.gate}` : '', confirm: item.confirm, admissionCount: item.admissionCount ? String(item.admissionCount) : '', time: tt(item.time) });
    } else if (c.template === 'block') {
      const type = markerType(item.type);
      el.dataset.type = item.type;
      setIcon(el.querySelector('.sdk-card-icon [data-icon]'), type.icon);
      colourPill(el, type);
      put(el, { title: item.title || type.label, minutes: duration, body: item.notes });
    } else if (c.template === 'note') {
      put(el, { title: item.title });
      setMarkup(slot(el, 'body'), item.notes);
    } else if (c.template === 'place') {
      put(el, { title: summary.title || item.title, address: summary.subtitle });
    } else {
      // What the linked object says now (never a copy kept here), or, when it cannot be read, why: it is gone, or this viewer may not
      // see it. Either way nothing opens an editor for it, and it can be removed from the plan.
      const stateOf = linkState(summary);
      const broken = Boolean(stateOf);
      setIcon(el.querySelector('.src [data-icon]'), broken ? 'link-slash' : (summary && summary.module && summary.module.icon) || 'link');
      const shown = stateOf === 'hidden' ? `${word('object', { a: true, cap: true })} you cannot see` : stateOf ? item.title || word('object', { a: true, cap: true }) : (summary && summary.title) || item.title;
      put(el, { module: broken || !summary ? `another ${word('module')}` : (summary.module && summary.module.name) || `another ${word('module')}`, title: shown, sub: broken ? '' : item.result ? `Result: ${item.result}` : summary ? summary.subtitle : '', state: stateOf === 'hidden' ? 'Not available to you' : stateOf === 'gone' ? 'No longer available' : stateOf === 'unavailable' ? 'Could not be read right now' : '' });
      if (broken) el.classList.add(stateOf === 'hidden' ? 'hidden' : 'gone');
      hide(el.querySelector('[data-action="open"]'), broken || !summary || !summary.open);
      hide(el.querySelector('[data-action="remove-link"]'), !broken || !canEdit);
    }
    placeChipInto(el, item);
    ownersInto(el, item);
    moreInto(el, item);
    roundTripInto(el, item);
    if (!canEdit) el.querySelector('.menu-btn')?.remove();
    // A part with nothing shown in it takes no room: a line of chips, then the body (the card is then its band alone).
    for (const box of [...el.querySelectorAll('.chips2'), ...el.querySelectorAll('.sdk-card-body > .main'), el.querySelector(':scope > .sdk-card-body')]) if (box) hide(box, ![...box.children].some((k) => !k.hidden));
    return el;
  }

  // A stop at a Place from Places: the place as a chip on its card that opens it (the card's own "open" action, by the pointer it carries).
  // A place that is gone, or that this person may not see, is not drawn as a link; the name the person typed shows as before.
  function placeChipInto(el, item) {
    if (item.kind !== 'stop' || !item.placeRef) return;
    const summary = plan.summaries.get(host.util.objectKey(item.placeRef));
    if (summary && linkState(summary)) return;
    const text = (summary && summary.title) || item.place || 'Place';
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'sdk-chip-tag place-chip';
    chip.dataset.tone = 'custom';
    chip.dataset.action = 'open';
    chip.dataset.ref = JSON.stringify(item.placeRef);
    chip.innerHTML = '<span class="ic" data-icon="location-dot"></span><span class="place-chip-text"></span>';
    chip.querySelector('.place-chip-text').textContent = text;
    chip.setAttribute('aria-label', `Open ${text}`);
    let box = el.querySelector('.chips2');
    if (!box) { box = document.createElement('div'); box.className = 'chips2'; (el.querySelector('.sdk-card-body') || el).append(box); }
    box.prepend(chip);
  }

  // A leg of a round trip: a line under its card with the other leg's day ("Round trip · Return Fri, Oct 9"), and on a return placed
  // before its outbound, a warning (it is allowed).
  function roundTripInto(el, item) {
    if (item.kind !== 'journey' || !el.matches('.sdk-card-banded')) return;
    const out = plan.outboundFor(item);
    const other = out || plan.returnFor(item.id);
    if (!other) return;
    const mark = clone('tpl-card-roundtrip');
    fill(mark, {
      'roundtrip-text': `Round trip · ${out ? 'Outbound' : 'Return'} ${other.date ? dayShort(other.date) : 'unscheduled'}`,
      'roundtrip-warn': out && returnBefore(item, out) ? 'Return is before the outbound' : '',
    });
    el.insertBefore(mark, el.querySelector(':scope > .card-more'));
  }
  // The item as its card shows it: a return shows its outbound's booking reference, cost and payer (the outbound holds them).
  const withBooking = (item) => {
    const out = item.kind === 'journey' ? plan.outboundFor(item) : null;
    return out ? { ...item, confirm: out.confirm, cost: out.cost, estimate: out.estimate, paidBy: out.paidBy } : item;
  };

  // What the card's own face has no place for, folded under it: the note, who is on it, the booking reference, the
  // terminal, the cost... Only what the item has and the template did not show (a slot of that name); "More" opens it,
  // and a card someone opened stays open through redraws.
  function moreInto(el, item) {
    if (item.kind === 'link' || item.kind === 'lane' || !el.matches('.sdk-card-banded')) return; // not on a one-line row (a stay's nights between)
    const has = (name) => Boolean(slot(el, name));
    const rows = [];
    const add = (label, value, slotName) => { if (value && !(slotName && has(slotName))) rows.push([label, value]); };
    add('Note', item.notes, 'body');
    if (item.owners && item.owners.length && !has('owners')) rows.push(['Who', item.owners.map(nameOf).join(', ')]);
    add('Booking', item.confirm, 'confirm');
    add('Terminal', item.terminal, 'terminal');
    add('Platform', item.platform, 'platform');
    add('Coach', item.carriage, 'carriage');
    add('Seat', item.seat, 'seat');
    add('Class', item.travelClass, 'travelClass');
    add('Pick up', item.pickup, 'pickup');
    add('Drop off', item.dropoff, 'dropoff');
    add('Room', item.roomType, 'roomType');
    add('Guests', words(item.guests, 'guest', 'guests'), 'guests');
    add('Reservation', item.reservationName, 'reservationName');
    add('Address', item.address, 'address');
    const linkedFrom = state.links.get(item.id);
    if (linkedFrom && linkedFrom.length) rows.push(['Linked from', linkedFrom.map((l) => l.title).filter(Boolean).join(', ')]);
    if (item.cost) rows.push(['Cost', `${host.util.money(item.cost, planCurrency())}${item.estimate ? ` · estimated ${host.util.money(item.estimate, planCurrency())}` : ''}${item.paidBy ? ` · paid by ${nameOf(item.paidBy)}` : ''}`]);
    else if (item.estimate) rows.push(['Cost', `~${host.util.money(item.estimate, planCurrency())} estimated`]);
    if (!rows.length) return;
    const more = clone('tpl-card-more');
    more.open = state.expanded.has(item.id);
    const dl = more.querySelector('dl');
    for (const [label, value] of rows) {
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd');
      if (label === 'Note') { dd.className = 'note-text'; setMarkup(dd, value); }
      else dd.textContent = value;
      dl.append(dt, dd);
    }
    more.addEventListener('toggle', () => { if (more.open) state.expanded.add(item.id); else state.expanded.delete(item.id); });
    el.append(more);
  }

  // `entry` is { item, span } (a stay is drawn on each night it covers; only its first day is the real item). On the line
  // (`line`: at a joint between days, not in a day) the same card is drawn with no time: a time means nothing there.
  function buildEntry(entry, line) {
    const item = withBooking(entry.item);
    const { span } = entry;
    entry = { ...entry, item };
    const summary = item.ref ? plan.summaries.get(host.util.objectKey(item.ref)) : null;
    const c = cardOf(item, summary);
    const row = clone('tpl-row');
    row.dataset.id = item.id;
    row.dataset.kind = item.kind;
    row.dataset.type = c.family;
    row.classList.toggle('done', item.done);
    if (item.kind === 'journey') { const leg = plan.outboundFor(item) ? 'return' : plan.returnFor(item.id) ? 'outbound' : ''; if (leg) row.dataset.leg = leg; }
    let time = tt(item.time);
    let sub = '';
    if (item.kind === 'link') { time = tt(timeOf(summary)); sub = ''; }
    else if (item.kind === 'stay') { time = span === 'end' ? tt(item.checkOutTime) : span === 'middle' ? '' : tt(item.time); sub = span === 'end' ? 'check out' : span === 'middle' ? '' : 'check in'; }
    else if (item.kind === 'journey') sub = arrivalOf(item) ? `→ ${arriveText(item, '\n')}` : '';
    else sub = [endText(item).replace(/^– /, '→ '), item.minutes ? `(${lengthText(item.minutes)})` : ''].filter(Boolean).join('\n'); // from, to, (length): each on a line in the wide column, one line when narrow
    if (line) { time = ''; sub = ''; }
    fill(row, { time, sub });
    row.querySelector('.slot').append(buildCard(entry, item.kind, summary));
    if (state.conflicts.has(item.id)) {
      row.classList.add('conflict');
      const bar = clone('tpl-conflict');
      fill(bar, { text: 'Someone changed this while you were editing.' });
      row.querySelector('.slot').append(bar);
    }
    return row;
  }

  // The way to a stop, drawn between it and the one before when the person has said how (and how long).
  function buildLeg(item) {
    if (!item.travelMode || item.travelMode === 'none' || !LEG_MODES.includes(item.travelMode)) return null;
    const row = clone('tpl-leg-row');
    row.dataset.id = item.id;
    const button = row.querySelector('.leg');
    button.dataset.mode = item.travelMode;
    setIcon(button.querySelector('[data-icon]'), LEG_ICONS[item.travelMode]);
    fill(row, { minutes: item.travelMinutes ? lengthText(item.travelMinutes) : '', dist: '' });
    if (!canEdit) button.disabled = true;
    return row;
  }

  // --- the days ----------------------------------------------------------------------------------------------

  // The entries of a day: its items in order, and the stays that cover it.
  function entriesFor(day, days, by) {
    const list = by.get(day) || [];
    const out = list.map((item) => ({ item, span: item.kind === 'stay' && item.checkOut && item.checkOut > day ? 'start' : undefined }));
    // The nights a stay covers (and its check-out) sit at the top of the day, like a banner, before the day's own items.
    const covering = [];
    for (const s of plan.list().filter((i) => i.kind === 'stay' && i.date && i.checkOut)) {
      if (day > s.date && day <= s.checkOut) covering.push({ item: s, span: day === s.checkOut ? 'end' : 'middle' });
    }
    return [...covering, ...out];
  }

  // "10:05 – 23:30 · 6 stops · 1 h 24 min getting around": the first and last time, how many stops, and the time spent getting between them.
  function daySummary(entries) {
    const own = entries.filter((e) => (!e.span || e.span === 'start') && e.item.kind !== 'block');
    const times = own.map((e) => e.item.time).filter(Boolean).sort();
    const range = times.length ? (times.length > 1 && times[0] !== times[times.length - 1] ? `${tt(times[0])} – ${tt(times[times.length - 1])}` : tt(times[0])) : '';
    const around = own.reduce((sum, e) => sum + (e.item.travelMode && e.item.travelMode !== 'none' && e.item.travelMinutes ? e.item.travelMinutes : 0), 0);
    return [range, words(own.length, 'stop', 'stops'), around ? `${lengthText(around)} getting around` : ''].filter(Boolean).join(' · ');
  }

  // The marker types (a setting an admin edits): the four automatic ones and the time blocks people add. Until it is read, or if it
  // cannot be, these stand.
  const AUTOMATIC = ['planning-start', 'planning-end', 'trip-start', 'trip-end'];
  const DEFAULT_MARKER_TYPES = [
    { id: 'planning-start', label: 'Planning starts', icon: 'flag', color: '#3b82f6' },
    { id: 'planning-end', label: 'Planning ends', icon: 'flag-checkered', color: '#8b5cf6' },
    { id: 'trip-start', label: 'Trip starts', icon: 'plane-departure', color: '#22c55e' },
    { id: 'trip-end', label: 'Trip ends', icon: 'plane-arrival', color: '#f97316' },
    { id: 'free-time', label: 'Free time', icon: 'face-smile', color: '#14b8a6' },
    { id: 'rest', label: 'Rest', icon: 'moon', color: '#6366f1' },
    { id: 'buffer', label: 'Buffer', icon: 'hourglass-half', color: '#a3a3a3' },
    { id: 'meet-up', label: 'Meet-up', icon: 'users', color: '#ec4899' },
    { id: 'leave-by', label: 'Leave by', icon: 'clock', color: '#eab308' },
    { id: 'travel-day', label: 'Travel day', icon: 'suitcase-rolling', color: '#0ea5e9' },
    { id: 'free-day', label: 'Free day', icon: 'sun', color: '#f59e0b' },
  ];
  const markerType = (id) => state.markerTypes.find((t) => t.id === id) || DEFAULT_MARKER_TYPES.find((t) => t.id === id) || { id, label: id, icon: 'clock', color: '#888888' };
  const blockTypes = () => state.markerTypes.filter((t) => !AUTOMATIC.includes(t.id));
  function useMarkerTypes(values) {
    const list = values && Array.isArray(values.markers) && values.markers.length ? values.markers : DEFAULT_MARKER_TYPES;
    state.markerTypes = list.filter((t) => t && typeof t.id === 'string' && /^#[0-9a-f]{6}$/i.test(t.color || ''));
    if (!state.markerTypes.length) state.markerTypes = DEFAULT_MARKER_TYPES;
  }
  // A marker's one colour: on the chip or row as a custom property, which gives its icon chip and its tint fill.
  const colourPill = (el, type) => { if (el) el.style.setProperty('--marker', type.color); };
  function buildMarker(kind, time, sub) {
    const type = markerType(kind);
    const row = clone('tpl-row-marker');
    row.dataset.marker = kind;
    setIcon(row.querySelector('.sdk-mk-ic [data-icon]'), type.icon);
    // `mdate` repeats `time` (a date, for these plan-wide markers) inside the pill: on a phone, where the pill
    // is the whole row and .when's own column has nowhere to sit beside it, the stylesheet shows this instead
    // and hides .when, so the date stays with the box it is about rather than stranded above it.
    fill(row, { time, mdate: time, title: type.label, sub });
    colourPill(row.querySelector('.sdk-mk-line'), type);
    return row;
  }
  // The markers of the whole plan, on the main timeline between the day blocks (not inside a day): the plan's ends above the first day
  // and below the last, and the trip's start above the day it begins and its end below the day it ends.
  // The phase boundaries of a space with phases, grouped by the joint they sit at (drawn, never stored). A phase starting on S is a
  // boundary after the day before S; a dated phase ending on E, after E. Boundaries before the first shown day gather at the head
  // (key ''), those from the last shown day on at the tail (key = the last day). Every start and every end is a marker of its own,
  // even on the same joint (the ending one first, then the starting one), each in its own phase's tint. Days are read as plain dates (UTC in the phase rule), so a day is a day whatever the viewer's timezone.
  function phaseJoints(days, bands) {
    const out = new Map();
    if (!days.length || !bands.some((b) => b.dated)) return out;
    const first = days[0];
    const last = days[days.length - 1];
    const back = (d) => { const t = parseYmd(d); return ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1)); };
    const events = []; // { day: the day the marker follows, ends: [band] | [], starts: [band] | [] }: one band each
    for (const b of bands) {
      if (!b.dated) continue;
      events.push({ day: back(b.start), ends: [], starts: [b] });
      if (b.end) events.push({ day: b.end, ends: [b], starts: [] });
    }
    events.sort((x, y) => x.day.localeCompare(y.day) || y.ends.length - x.ends.length); // stable: the ending marker first on a joint
    for (const g of events) {
      const key = g.day < first ? '' : g.day >= last ? last : g.day;
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(g);
    }
    return out;
  }
  function buildPhaseMarker(g) {
    const row = clone('tpl-row-marker');
    const names = [...g.ends.map((b) => `${b.label} ends`), ...g.starts.map((b) => `${b.label} starts`)];
    row.dataset.marker = 'phase';
    row.classList.add('phase');
    const lead = g.ends[0] || g.starts[0];
    row.classList.add(`ph-${lead.tint}`);
    const when = g.starts.length ? g.starts[0].start : g.day; // the day the phase begins, else the day it ends
    const text = parseYmd(when).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
    setIcon(row.querySelector('.sdk-mk-ic [data-icon]'), g.starts.length ? 'flag' : 'flag-checkered');
    fill(row, { time: text, mdate: text, title: names.join(' · '), sub: '' });
    return row;
  }

  function timelineMarkers(day, position, days, by, joints) {
    // With phases the markers are the bar's: every phase's start and end, and the trip's own are the main phase's.
    if (joints && joints.size) {
      const groups = joints.get(position === 'before' ? (day === days[0] ? '' : null) : day);
      if (!groups) return null;
      const list = document.createElement('ol');
      list.className = 'timeline ends';
      list.dataset.ends = position;
      list.append(...groups.map(buildPhaseMarker));
      return list;
    }
    const bounds = state.bounds;
    const rows = [];
    const dateText = (d) => parseYmd(d).toLocaleDateString([], { weekday: 'short', day: 'numeric' });
    const itemOf = (id) => plan.list().find((i) => i.id === id);
    const bands = plan.bands();
    // With phases, planning starts on the first phase's band and ends at the close of the last dated band before the
    // main one. With none, both stay on the first and last day of the plan. The booked start and end are unchanged.
    const mainAt = bands.findIndex((b) => b.main);
    const beforeMain = bands.slice(0, mainAt > 0 ? mainAt : 0).filter((b) => b.dated);
    const planningStart = bands.length ? (bands[0].dated ? bands[0].start : null) : days[0];
    const planningEnd = bands.length ? (beforeMain.length ? beforeMain[beforeMain.length - 1].end : null) : days[days.length - 1];
    if (position === 'before') {
      if (planningStart && day === planningStart) rows.push(buildMarker('planning-start', dateText(day), 'the plan begins'));
      if (bounds && bounds.start.day === day) rows.push(buildMarker('trip-start', tt(bounds.start.time), describe(itemOf(bounds.start.id) || {})));
    } else {
      // An arrival after the plan's last day (a journey home overnight) ends the trip under the last day, with its own date.
      const last = day === days[days.length - 1];
      const after = bounds && bounds.end.day > days[days.length - 1];
      const endDate = after ? parseYmd(bounds.end.day).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
      if (bounds && (bounds.end.day === day || (last && after))) rows.push(buildMarker('trip-end', [endDate, tt(bounds.end.time)].filter(Boolean).join('\n'), describe(itemOf(bounds.end.id) || {})));
      if (planningEnd && day === planningEnd) rows.push(buildMarker('planning-end', dateText(day), 'the plan ends'));
    }
    if (!rows.length) return null;
    const list = document.createElement('ol');
    list.className = 'timeline ends';
    list.dataset.ends = position;
    list.append(...rows);
    return list;
  }

  // Whether a day is the trip itself: with phases the main phase's days, else from the first booked item to the last.
  function inTrip(day) {
    const main = plan.bands().find((b) => b.main);
    if (main) return Boolean(main.dated) && day >= main.start && (!main.end || day <= main.end);
    const b = tripBounds(plan.list());
    return Boolean(b) && day >= b.start.day && day <= b.end.day;
  }

  // The days that are numbered ("Day 2 of 4"): with phases, the main phase's own days only (a pre-trip or post-trip day has no
  // number); else every day of the plan. `n` is a day's place among them, 0 when it is not one of them.
  function numberedDays(days) {
    const main = plan.bands().find((b) => b.main);
    return main && main.dated ? days.filter(inTrip) : days;
  }
  const dayNumber = (day, days) => numberedDays(days).indexOf(day) + 1;

  // A short name for an item, for a marker's line.
  const describe = (item) => (item.kind === 'journey' && [item.operator, item.number].filter(Boolean).join(' ')) || item.title;

  function buildDay(day, index, days, by) {
    const el = clone('tpl-day2');
    el.id = `day-${day}`;
    el.dataset.day = day;
    el.dataset.index = String(index + 1);
    const isToday = day === ymd(new Date());
    const all = entriesFor(day, days, by);
    // A marker with no time is about the whole day ("Travel day", "Free day"): a tag in the day's header, not a row.
    const tags = all.filter((e) => e.item.kind === 'block' && !e.item.time);
    const entries = all.filter((e) => !tags.includes(e));
    const head = clone('tpl-day-head');
    if (!canEdit) hide(head.querySelector('.sdk-day-actions'), true);
    const d = parseYmd(day);
    fill(head, { daynum: String(d.getDate()), daymonth: `${d.toLocaleDateString([], { weekday: 'short' })} · ${d.toLocaleDateString([], { month: 'short' })}`, position: dayNumber(day, days) ? `Day ${dayNumber(day, days)} of ${numberedDays(days).length}` : '', summary: daySummary(entries) });
    // The labels under the title: the phase, "Today", then the whole-day markers.
    const tagBox = head.querySelector('.sdk-day-labels');
    for (const { item } of tags) {
      const type = markerType(item.type);
      const tag = clone('tpl-day-tag');
      tag.dataset.id = item.id;
      tag.dataset.type = item.type;
      if (!canEdit) tag.disabled = true;
      colourPill(tag, type);
      setIcon(tag.querySelector('[data-icon]'), type.icon);
      fill(tag, { title: item.title || type.label });
      tag.title = item.notes || '';
      tagBox.append(tag);
    }
    // A day in a dated phase wears the phase's name as a label in its tint (no wash); today says so in words.
    const ph = phaseOnDay(plan.bands(), day);
    if (ph && ph.tint) {
      el.classList.add('in-phase', `ph-${ph.tint}`);
      const tag = document.createElement('span');
      tag.className = 'sdk-chip-tag';
      tag.dataset.tone = 'custom';
      tag.textContent = ph.label;
      tag.title = `${ph.label}${ph.first ? ' starts' : ''}`;
      tagBox.prepend(tag);
    }
    if (isToday) {
      const now = document.createElement('span');
      now.className = 'sdk-chip-tag';
      now.dataset.tone = 'info';
      now.textContent = 'Today';
      tagBox.insertBefore(now, tagBox.querySelector('.sdk-mk-tag'));
    }
    hide(tagBox, !tagBox.children.length);
    el.prepend(head);
    const list = el.querySelector('.timeline');
    if (!entries.length) {
      // An empty day is one button that opens the day's add menu (the same action as the header's "..."); a viewer
      // who cannot edit gets the plain sentence. The word follows the pointer, not the width.
      if (canEdit) {
        const empty = clone('tpl-day-empty-add');
        const b = empty.querySelector('.sdk-day-empty');
        b.textContent = `Nothing planned yet. ${matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Click'} to add.`;
        b.title = `Add to ${dayShort(day)}`;
        list.append(empty);
      } else {
        const empty = clone('tpl-day-empty');
        empty.textContent = 'Nothing planned yet.';
        list.append(empty);
      }
    }
    // The plan's own ends, and where the trip itself starts and ends (the first and last booked item). Markers are drawn, never stored:
    // they have no id, no menu and no handle, and are not counted as something planned.
    entries.forEach((entry, i) => {
      const prev = entries[i - 1];
      const covers = (e) => e && (e.span === 'middle' || e.span === 'end');
      if (i && !covers(entry) && !covers(prev)) { const leg = buildLeg(entry.item); if (leg) list.append(leg); }
      list.append(buildEntry(entry));
    });
    if (!entries.length) el.classList.add('is-empty');
    // The days the trip itself covers (from the first booked item to the last) are marked, for their badge.
    // What other modules hold on this day that the plan could take in.
    const box = el.querySelector('.suggestions');
    const list2 = box.querySelector('.suggestions-list');
    const mine = canEdit ? plan.suggestions.filter((c) => (summaryWhen(c) || {}).day === day) : [];
    hide(box, !mine.length);
    for (const c of mine) {
      const s = clone('tpl-suggestion');
      s.dataset.ref = JSON.stringify(c.ref);
      setIcon(s.querySelector('[data-icon]'), c.module.icon);
      fill(s, { title: c.title, module: c.module.name });
      list2.append(s);
    }
    return el;
  }

  // Days with nothing on them (a stay that covers a night counts; markers do not).
  const emptyDays = () => { const days = plan.days(); const by = plan.byDay(); return new Set(days.filter((d) => !entriesFor(d, days, by).length)); };

  // A marker between the days (a `lane`), on the plan's line.
  function buildLane(item) {
    const type = markerType(item.type);
    const row = clone('tpl-row-lane');
    row.dataset.id = item.id;
    row.dataset.type = item.type;
    setIcon(row.querySelector('.sdk-mk-ic [data-icon]'), type.icon);
    fill(row, { title: item.title || type.label, body: item.notes });
    colourPill(row.querySelector('.sdk-mk-line'), type);
    if (!canEdit) row.querySelector('.menu-btn')?.remove();
    return row;
  }
  // The items at a joint on the line (`after` is the day before it; '' is the head, before the first day): a marker as its
  // pill, anything else as the card it would be in a day. Then the + where a new one goes (`withJoint`; a hidden day's joint
  // has no + of its own, the badge standing in for the day has it).
  // An object with no date and no place on the line belongs under "Unscheduled", not at the head of the line.
  const placedOnLine = (item) => {
    const stored = plan.list().find((i) => i.id === item.id);
    return Boolean(stored && (stored.kind === 'lane' || stored.after === '' || (stored.after && stored.after !== null)));
  };
  function buildBetween(after, withJoint = true) {
    const mine = plan.atJoint(after).filter(placedOnLine);
    const out = [];
    if (mine.length) {
      const list = document.createElement('ol');
      list.className = 'timeline between';
      list.dataset.after = after;
      list.append(...mine.map((item) => (item.kind === 'lane' ? buildLane(item) : buildEntry({ item }, true))));
      out.push(list);
    }
    if (canEdit && withJoint) {
      const joint = clone('tpl-joint');
      joint.dataset.after = after;
      out.push(joint);
    }
    return out;
  }
  // Where a joint is, in words, for a menu: "Before the first day", "Between Oct 1 and Oct 2", "After the last day".
  function jointLabel(after) {
    const days = plan.days();
    if (after === '' || !days.includes(after)) return 'Before the first day';
    const at = days.indexOf(after);
    if (at === days.length - 1) return 'After the last day';
    const short = (d) => parseYmd(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `Between ${short(after)} and ${short(days[at + 1])}`;
  }
  // A place as a menu value and back: a day is `d:<date>`, a joint `j:<after>` (`j:` the head).
  const placeValue = (place) => (place && place.after !== null && place.after !== undefined ? `j:${place.after}` : `d:${(place && place.date) || ''}`);
  const parsePlace = (value) => (String(value).startsWith('j:') ? { after: value.slice(2) } : { date: value.slice(2) || null });
  // The places an item can be, in line order (the head, day 1, the joint after it, day 2...), as a select's options. A
  // between-days marker's menu sees only the joints (jointsOnly); the editor with a marker chosen sees the days and the
  // joints but not "Unscheduled" (placedOnly), since Where decides whether it is in a day or between days.
  function placeOptions(select, { jointsOnly, placedOnly } = {}) {
    const was = select.value;
    select.replaceChildren();
    const add = (value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; select.append(o); };
    const days = plan.days();
    // With phases, any day of the space's timeline can be chosen (first phase's start to last phase's end), not only the days the
    // plan already draws: the ones before the first drawn day come first, the ones after the last come last. Choosing one makes
    // the plan draw it (planDays), under its own phase's tint. The phase's name follows each day.
    const bands = plan.bands().filter((b) => b.dated);
    const inPhase = (d) => { const p = bands.length ? phaseOnDay(bands, d) : null; return p && p.label ? ` · ${p.label}` : ''; };
    let before = [];
    let after = [];
    if (!jointsOnly && bands.length) {
      const first = bands.reduce((m, b) => (b.start < m ? b.start : m), bands[0].start);
      const last = bands.reduce((m, b) => ((b.end || b.start) > m ? (b.end || b.start) : m), bands[0].end || bands[0].start);
      const span = tripDays({ start: days.length && days[0] < first ? days[0] : first, end: days.length && days[days.length - 1] > last ? days[days.length - 1] : last });
      const here = new Set(days);
      const lo = days[0];
      const hi = days[days.length - 1];
      before = span.filter((d) => !here.has(d) && (!days.length || d < lo));
      after = span.filter((d) => !here.has(d) && days.length && d > hi);
      if (!days.length) before = span;
    }
    if (!jointsOnly && !placedOnly) add('d:', 'Unscheduled');
    before.forEach((d) => add(`d:${d}`, `${dayShort(d)}${inPhase(d)}`));
    add('j:', jointLabel(''));
    days.forEach((d) => {
      if (!jointsOnly) add(`d:${d}`, `${dayShort(d)}${inPhase(d)}`);
      add(`j:${d}`, jointLabel(d));
    });
    after.forEach((d) => add(`d:${d}`, `${dayShort(d)}${inPhase(d)}`));
    // A day chosen on the date field that the list does not hold (no phases: any date) is kept as a choice of its own.
    if (/^d:\d{4}-\d{2}-\d{2}$/.test(was) && ![...select.options].some((o) => o.value === was)) add(was, `${dayShort(was.slice(2))}, outside the plan`);
    select.value = [...select.options].some((o) => o.value === was) ? was : 'j:';
  }

  // ---- Choosing a day: a date field, a grouped list, and Unscheduled -------------------------------------------------------
  // The form's When, Return day and Check out are a date field (the primary control), the phase the day is in, "Pick from the
  // list" (the SDK's host.menu.show, days under a heading or a flyout per phase, or per month without phases) and a button for no
  // day. The hidden select stays the one place the value lives (the saving code reads and sets it, as before); its `value`
  // is wrapped so setting it from code draws the field again. Move to another day... in the item menu opens the same list.
  const DAY_NEST = 8; // more days than this: one flyout per phase (or month); fewer: a heading per phase, the days flat
  const dayMonth = (d) => parseYmd(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
  // The days that can be picked: the plan's own, and with phases every day of the space's timeline too.
  function choosableDays() {
    const days = plan.days();
    const bands = plan.bands().filter((b) => b.dated);
    if (!bands.length) return days.slice();
    const first = bands.reduce((m, b) => (b.start < m ? b.start : m), bands[0].start);
    const last = bands.reduce((m, b) => ((b.end || b.start) > m ? (b.end || b.start) : m), bands[0].end || bands[0].start);
    return tripDays({ start: days.length && days[0] < first ? days[0] : first, end: days.length && days[days.length - 1] > last ? days[days.length - 1] : last });
  }
  // Days in order, grouped: by phase when the space has them, else by month. [{ label, range, days }]
  function groupDays(days) {
    const bands = plan.bands().filter((b) => b.dated);
    const out = [];
    for (const d of days) {
      const p = bands.length ? phaseOnDay(bands, d) : null;
      const key = bands.length ? (p && p.id) || '' : d.slice(0, 7);
      let g = out[out.length - 1];
      if (!g || g.key !== key) {
        g = { key, label: bands.length ? (p && p.label) || 'Other days' : parseYmd(d).toLocaleDateString([], { month: 'long', year: 'numeric' }), days: [] };
        out.push(g);
      }
      g.days.push(d);
    }
    for (const g of out) g.range = g.days.length > 1 ? `${dayMonth(g.days[0])} – ${dayMonth(g.days[g.days.length - 1])}` : dayMonth(g.days[0]);
    return out;
  }
  // The grouped list as menu items. `current` is a place ({ date } / { after }); `choose(place)` gets the pick; `days` the
  // days offered; `none` the label of the no-day entry (null: not offered); `joints` whether the spots between days are; `pickDate`
  // (optional) adds "Pick a date..." last; `jointsOnly` lists only the spots between days (a marker between days).
  function dayMenuItems({ current, choose, days, none, joints, pickDate, jointsOnly, label = dayLong }) {
    const same = (p) => (p.after !== undefined ? current.after === p.after : current.after === undefined && (current.date || null) === (p.date || null));
    const row = (p, text) => ({ id: placeValue(p), label: text, icon: 'calendar-day', current: same(p), ariaLabel: same(p) ? `${text}, chosen` : undefined, onClick: () => choose(p) });
    const nest = days.length > DAY_NEST;
    const items = [];
    // Unscheduled: no day, and the spots between days (before the first day, between two, after the last).
    const unscheduled = [];
    if (none && !jointsOnly) unscheduled.push(row({ date: null }, none));
    if (joints) for (const after of ['', ...plan.days()]) unscheduled.push(row({ after }, jointLabel(after)));
    if (unscheduled.length) {
      const name = jointsOnly || !none ? 'Between days' : 'Unscheduled';
      if (nest || unscheduled.length > DAY_NEST) items.push({ id: 'unscheduled', label: name, icon: 'inbox', items: unscheduled });
      else items.push({ heading: name }, ...unscheduled);
    }
    if (!jointsOnly) {
      for (const g of groupDays(days)) {
        const rows = g.days.map((d) => row({ date: d }, label(d)));
        if (nest) items.push({ id: `group-${g.key}`, label: g.label, hint: g.range, icon: 'calendar-days', items: rows });
        else items.push({ heading: `${g.label} · ${g.range}` }, ...rows);
      }
    }
    if (pickDate) items.push({ separator: true }, { id: 'pick-date', label: 'Pick a date…', icon: 'calendar', onClick: pickDate });
    return items;
  }
  // The days a date field is held to: the timeline's first to last day when the space has phases (widened to the day it
  // already holds, which is never refused), none otherwise.
  function dayBounds(held) {
    if (!plan.bands().some((b) => b.dated)) return { min: '', max: '' };
    const days = choosableDays();
    if (!days.length) return { min: '', max: '' };
    return { min: held && held < days[0] ? held : days[0], max: held && held > days[days.length - 1] ? held : days[days.length - 1] };
  }
  // The weekday a day falls on, as the date picker words it ("Thursday, Oct 15, 2026"); the day field's hint slot starts with it.
  const weekdayOf = (d) => parseYmd(d).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  // Make one of the form's day selects (#f-date, #f-back-date, #f-checkout) a date field with its list: host.ui.datePicker on the date
  // input (#<id>-input) with `list` (the days by phase and the spots between days, with Unscheduled first where there is no day), and
  // the select, hidden, that keeps the value. The field's hint slot (#<id>-phase) says the weekday and the phase the day is in.
  // `checkout`: the select's values are plain days ('' for none) and the list is its own options; else they are places (`d:<day>`, `j:<after>`).
  function dayField(select, { checkout = false } = {}) {
    const id = select.id;
    const input = $(`${id}-input`);
    const caption = $(`${id}-phase`);
    if (!input || !caption) return;
    const place = () => (checkout ? { date: select.value || null } : parsePlace(select.value));
    const valueOf = (p) => (checkout ? p.date || '' : placeValue(p));
    const dayOptions = () => [...select.options].map((o) => o.value).filter(isYmd);
    const canNone = () => [...select.options].some((o) => o.value === (checkout ? '' : 'd:')) && (checkout ? Boolean(dayOptions().length) : true);
    const set = (value) => {
      if (value && !checkout && !/^[dj]:/.test(value)) return;
      if (value && ![...select.options].some((o) => o.value === value)) {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = checkout ? value : `${dayShort(value.slice(2))}, outside the plan`;
        select.append(o);
      }
      select.value = value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const picker = host.ui.datePicker(input, {
      get clearable() { return canNone(); },
      list: {
        label: 'Pick from the list',
        get none() { return canNone() ? (checkout ? 'Not set' : 'Unscheduled') : ''; },
        items: () => {
          const p = place();
          if (checkout) {
            const label = (d) => ((([...select.options].find((o) => o.value === d) || {}).textContent) || dayLong(d));
            return dayMenuItems({ current: p, choose: (x) => set(x.date || ''), days: dayOptions(), none: null, joints: false, label });
          }
          return dayMenuItems({ current: p, choose: (x) => set(valueOf(x)), days: choosableDays(), none: null, joints: true });
        },
      },
    });
    const draw = () => {
      const p = place();
      const held = p.date || '';
      input.value = held;
      let note = '';
      if (checkout) {
        const days = dayOptions();
        input.disabled = !days.length;
        input.min = days[0] || '';
        input.max = days[days.length - 1] || '';
        const o = [...select.options].find((x) => x.value === select.value && select.value);
        note = o && / · /.test(o.textContent) ? o.textContent.split(' · ').pop() : days.length ? 'Not set' : 'Choose the check-in day first';
      } else {
        const b = dayBounds(held);
        input.min = b.min;
        input.max = b.max;
        const bands = plan.bands().filter((x) => x.dated);
        const ph = held && bands.length ? phaseOnDay(bands, held) : null;
        note = ph && ph.label ? ph.label : p.after !== undefined ? jointLabel(p.after) : held ? '' : 'Unscheduled';
      }
      picker.refresh();
      caption.textContent = [held ? weekdayOf(held) : '', note].filter(Boolean).join(' · ');
    };
    // Setting the select's value from code (opening the form, a lookup, the kind) draws the field again.
    const own = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(select, 'value', { configurable: true, get() { return own.get.call(this); }, set(v) { own.set.call(this, v); draw(); } });
    input.addEventListener('change', () => {
      if (!input.value) { if (canNone()) set(checkout ? '' : 'd:'); else draw(); return; }
      if (input.validity.rangeUnderflow || input.validity.rangeOverflow) { draw(); return; }
      set(checkout ? input.value : `d:${input.value}`);
    });
    draw();
  }

  // A journey's arrival day is the same date field as the departure day: a date field held to the days a ticket can arrive on
  // (arrivalDays) with the list of those days, and the select (#f-arrival-day, hidden) that keeps the value: a day, or while the leg
  // has no day, how many days later ('0', '1', '-1'). No Unscheduled: an arrival always has a day.
  function arrivalField(select) {
    const id = select.id;
    const input = $(`${id}-input`);
    const caption = $(`${id}-phase`);
    if (!input || !caption) return;
    const opts = () => [...select.options];
    const days = () => opts().map((o) => o.value).filter(isYmd).sort();
    const note = (o) => { if (!o) return ''; const m = /\(([^)]*)\)\s*$/.exec(o.textContent); const t = m ? m[1] : isYmd(o.value) ? 'same day' : o.textContent; return t.charAt(0).toUpperCase() + t.slice(1); };
    const set = (value) => {
      select.value = value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const picker = host.ui.datePicker(input, {
      list: {
        label: 'Pick from the list',
        items: () => opts().sort((a, b) => (isYmd(a.value) && isYmd(b.value) ? a.value.localeCompare(b.value) : 0)).map((o) => ({ id: o.value, label: o.textContent, icon: o.value === select.value ? 'check' : 'calendar-day', ariaLabel: o.value === select.value ? `${o.textContent}, chosen` : undefined, onClick: () => set(o.value) })),
      },
    });
    const draw = () => {
      const d = days();
      input.disabled = !d.length;
      input.min = d[0] || '';
      input.max = d[d.length - 1] || '';
      input.value = isYmd(select.value) ? select.value : '';
      picker.refresh();
      caption.textContent = [input.value ? weekdayOf(input.value) : '', note(opts().find((o) => o.value === select.value))].filter(Boolean).join(' · ');
    };
    const own = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(select, 'value', { configurable: true, get() { return own.get.call(this); }, set(v) { own.set.call(this, v); draw(); } });
    input.addEventListener('change', () => {
      if (!input.value || input.validity.rangeUnderflow || input.validity.rangeOverflow || !opts().some((o) => o.value === input.value)) { draw(); return; }
      set(input.value);
    });
    draw();
  }

  // The badge for a run of hidden days: how many, and a + for what can be added there.
  function buildGap(run) {
    const el = clone('tpl-gap');
    el.dataset.from = run[0];
    el.dataset.to = run[run.length - 1];
    fill(el, { count: String(run.length), word: run.length === 1 ? 'day between' : 'days between' });
    const count = slot(el, 'count');
    if (count) count.title = `${run.length} day${run.length === 1 ? '' : 's'} between`;
    if (!canEdit) hide(el.querySelector('[data-action="gap-add"]'), true);
    return el;
  }
  // The joint a + stands at: a joint says so; a badge for hidden days is at the joint before its first hidden day.
  function jointOfButton(button) {
    const joint = button.closest('.joint');
    if (joint) return joint.dataset.after;
    const gap = button.closest('.gap');
    const allDays = plan.days();
    return (gap && allDays[allDays.indexOf(gap.dataset.from) - 1]) || '';
  }
  // The "..." on a day and the + on a joint: everything that can be added there, the same kinds the editor's tiles offer,
  // each opening the editor at that place with the kind chosen; then the markers (a time block on a day, a between-days
  // marker on the line, added at once). A hidden-days badge also offers to show the days. The type-to-add row and the
  // titlebar's "+" are the fast path; this is the plain one. Grouped (Thomas, 2026-10-13): Travel, Eat and drink, See and
  // do, Mark the day and Add at a time are categories whose entries fly out beside them (host.menu.show's `items`; on a
  // phone they drill in); a stay and a note are picked straight away.
  // What can be added to a day or a joint, in the day menu's order and short row wording: Travel, a stay, Eat and drink, See and
  // do, a note. One list for the day menu and the titlebar "+" (no markers here: they stay in the day menu). A category has
  // `items`; a row's `tip` keeps the full wording ("Add a flight").
  function addKinds() {
    // A row in a category is short (the category says the rest): "Flight"; its `tip` keeps the full wording, "Add a flight".
    const kindRow = (t) => ({ id: t, label: KICKERS[t], icon: BADGES[t], tip: `Add ${/^[aeiou]/i.test(KICKERS[t]) ? 'an' : 'a'} ${KICKERS[t].toLowerCase()}` }); // "an attraction"
    const kinds = [];
    const category = (id, label, icon, tiles) => { if (tiles.length) kinds.push({ id, label, icon, items: tiles.map(kindRow) }); };
    const EAT = ['restaurant', 'cafe', 'bar'];
    category('travel', 'Travel', 'plane', JOURNEY_TILES);
    kinds.push({ id: 'hotel', label: 'Add a stay', icon: 'bed' });
    category('eat', 'Eat and drink', 'utensils', STOP_TILES.filter((t) => EAT.includes(t)));
    category('see', 'See and do', 'binoculars', STOP_TILES.filter((t) => !EAT.includes(t)));
    kinds.push({ id: 'note', label: 'Add a note', icon: 'note-sticky' });
    return kinds;
  }
  function openAddMenu(button, place, { gap } = {}) {
    const onLine = place.after !== undefined;
    const items = [];
    const withTile = (tile) => openEditor('item', null, { ...place, tile }, button);
    const category = (id, label, icon, rows) => { if (rows.length) items.push({ id, label, icon, items: rows }); }; // a flyout of the day menu (addKinds has its own)
    for (const k of addKinds()) {
      items.push(k.items ? { ...k, items: k.items.map((r) => ({ ...r, onClick: () => withTile(r.id) })) } : { ...k, onClick: () => withTile(k.id) });
    }
    items.push({ separator: true });
    // On a day, a marker with no time marks the whole day (a tag in its header), added at once; the timed ones below open the editor.
    if (!onLine) {
      category('mark', 'Mark the day', 'calendar-day', blockTypes().map((t) => ({ id: `mark:${t.id}`, label: t.label, tip: `Mark the day: ${t.label.toLowerCase()}`, icon: t.icon, iconColor: t.color || undefined, onClick: () => attempt(() => plan.addItem({ kind: 'block', type: t.id, title: t.label, date: place.date, time: null, minutes: null })) })));
    }
    category(onLine ? 'lane' : 'block', onLine ? 'Add between days' : 'Add at a time', onLine ? 'arrows-left-right' : 'clock', blockTypes().map((t) => ({
      id: `${onLine ? 'lane' : 'block'}:${t.id}`,
      label: t.label,
      tip: onLine ? `Add ${t.label.toLowerCase()} between days` : `Add ${t.label.toLowerCase()} at a time`,
      icon: t.icon,
      iconColor: t.color || undefined,
      onClick: () => (onLine ? attempt(() => plan.addItem({ kind: 'lane', type: t.id, title: t.label, after: place.after })) : withTile(`block:${t.id}`)),
    })));
    if (gap) {
      items.push({ separator: true });
      items.push({
        id: 'show-days',
        label: 'Show these days',
        icon: 'eye',
        onClick: () => {
          state.hideEmpty = false;
          try { localStorage.setItem('planner-hide-empty', '0'); } catch (err) { /* not remembered */ }
          redraw();
        },
      });
    }
    host.menu.show({ id: `add-${placeValue(place)}`, anchor: button, items });
  }

  // --- the day's "..." : Move all to..., Clear this day ----------------------------------------------------------------------
  // A day as a sentence has it: "Mon, Oct 12".
  const dayLong = (d) => parseYmd(d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  // What a set of objects is called in a question: "3 stops", "3 stops and 1 marker".
  function stopsText(ids) {
    const all = plan.list().filter((i) => ids.includes(i.id));
    const markers = all.filter((i) => i.kind === 'block').length;
    const stops = all.length - markers;
    return [words(stops, 'stop', 'stops'), words(markers, 'marker', 'markers')].filter(Boolean).join(' and ') || 'nothing';
  }
  function openDayMore(button, day) {
    const clear = plan.previewClear(day);
    host.menu.show({
      id: `day-more-${day}`,
      anchor: button,
      items: [
        { id: 'move', label: 'Move all to…', icon: 'calendar-days', hint: 'Move this day, and the days after it if you like', onClick: () => openDayDialog('move', day, button) },
        { id: 'clear', label: 'Clear this day', icon: 'eraser', disabled: !clear.moved, hint: clear.moved ? 'Take its stops off the day and keep them' : 'Nothing on this day to take off', onClick: () => openDayDialog('clear', day, button) },
      ],
    });
  }
  const dayEditor = host.ui.editor($('day-dialog'), {
    size: 'medium',
    onClose: () => { if (dayPicker) dayPicker.destroy(); dayPicker = null; $('day-dialog').replaceChildren(); dayState = null; },
  });
  let dayPicker = null;
  let dayState = null; // { mode: 'move' | 'clear', day }
  // What the dialog says about the change it would make, from the same figures the change uses.
  function daySentence() {
    const { mode, day } = dayState;
    if (mode === 'clear') {
      const r = plan.previewClear(day);
      const kept = r.kept ? ` ${words(r.kept, 'object', 'objects')} from other ${host.util.word('module', { many: true })} stay, because they follow their own date.` : '';
      return { text: r.moved ? `Take ${stopsText(Object.keys(r.changes))} off ${dayLong(day)}? They stay in the Planner, unscheduled.${kept}` : `Nothing on ${dayLong(day)} to take off.${kept}`, ok: r.moved > 0 };
    }
    const to = $('day-to').value;
    const rest = $('day-rest').checked;
    if (!to || to === day) return { text: 'Pick the day to move to.', ok: false };
    const r = plan.previewMove(day, to, rest);
    const slides = rest && !plan.phased() && plan.trip && plan.trip.start && day === plan.days()[0];
    if (!r.moved && !slides) return { text: rest ? `Nothing on or after ${dayLong(day)} to move.` : `Nothing on ${dayLong(day)} to move.`, ok: false };
    const links = Object.keys(r.changes).filter((id) => (plan.list().find((i) => i.id === id) || {}).kind === 'link').length;
    const n = Math.abs(r.delta);
    const head = rest
      ? `Move ${stopsText(Object.keys(r.changes))} on ${words(r.days, 'day', 'days')}, ${words(n, 'day', 'days')} ${r.delta > 0 ? 'later' : 'earlier'}.`
      : `Move ${stopsText(Object.keys(r.changes))} to ${dayLong(to)}.`;
    const merge = Object.values(r.changes).some((c) => plan.byDay().get(c.date) && plan.byDay().get(c.date).some((i) => !(i.id in r.changes))) ? ' Days that already have stops keep them; these go after.' : '';
    const own = links ? ` ${words(links, 'object', 'objects')} from other ${host.util.word('module', { many: true })} move here only; each keeps its own date where it lives.` : '';
    const trip = slides ? ' The plan\'s first and last day move too.' : '';
    return { text: head + merge + own + trip, ok: true };
  }
  function openDayDialog(mode, day, from) {
    if (!canEdit) return;
    dayState = { mode, day, from };
    $('day-dialog').replaceChildren(clone('tpl-day-dialog'));
    const moving = mode === 'move';
    hide($('day-fields'), !moving);
    $('day-title').textContent = moving ? `Move all from ${dayLong(day)}` : `Clear ${dayLong(day)}`;
    $('day-go').textContent = moving ? 'Move' : 'Unschedule';
    $('day-cancel').textContent = moving ? 'Cancel' : 'Keep';
    if (moving) {
      $('day-to').value = day;
      dayPicker = host.ui.datePicker($('day-to'));
    }
    const refresh = () => { const r = daySentence(); $('day-summary').textContent = r.text; $('day-go').disabled = !r.ok; $('day-error').hidden = true; };
    $('day-form').addEventListener('input', refresh);
    $('day-form').addEventListener('change', refresh);
    refresh();
    dayEditor.open({ focus: moving ? $('day-to') : $('day-cancel'), returnTo: () => root.querySelector(`.sdk-day[data-day="${CSS.escape(day)}"] [data-action="day-more"]`) || from });
  }
  $('day-dialog').addEventListener('click', (e) => { if (e.target.closest('#day-cancel')) dayEditor.cancel(); });
  $('day-dialog').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!dayState || !canEdit || $('day-go').disabled) return;
    const { mode, day } = dayState;
    const to = mode === 'move' ? $('day-to').value : '';
    const rest = mode === 'move' && $('day-rest').checked;
    $('day-go').disabled = true;
    try {
      note('');
      if (mode === 'move') await plan.moveDays(day, to, rest); else await plan.clearDay(day);
      dayEditor.close();
      if (mode === 'move') { const target = $(`day-${to}`); if (target) target.scrollIntoView({ block: 'start' }); }
    } catch (err) {
      $('day-error').textContent = err.conflict ? 'Someone changed that first; the newer version is shown. Try again.' : err.message;
      $('day-error').hidden = false;
      $('day-go').disabled = false;
    }
  });

  // The button (and its small form) to add days before the first day or after the last.
  function buildEdge(where) {
    const el = clone('tpl-dayedge');
    el.dataset.edge = where;
    fill(el, { label: where === 'before' ? 'Add days before' : 'Add days after' });
    const input = el.querySelector('input[name="count"]');
    input.max = String(Math.max(1, Math.min(30, MAX_DAYS - plan.days().length)));
    el.querySelector('.edge-form').noValidate = true; // too many is said in the page's note, not by the browser
    return el;
  }
  // Moving the plan's first day back or its last day forward, through the same save as Edit trip.
  function addDays(where, count) {
    const trip = plan.trip;
    const left = MAX_DAYS - plan.days().length;
    if (!(count >= 1)) return;
    if (count > left) { note(left > 0 ? `A plan can be at most ${MAX_DAYS} days long, so at most ${left} more can be added.` : `A plan can be at most ${MAX_DAYS} days long.`); return; }
    const shift = (day, n) => { const d = parseYmd(day); return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };
    if (!trip || !trip.start) { note(plan.phased() ? 'Set when the trip starts first.' : 'Set the first day before adding days.'); return; }
    const start = where === 'before' ? shift(trip.start, -count) : trip.start;
    const end = where === 'after' ? shift(trip.end || trip.start, count) : trip.end || trip.start;
    // With phases the main phase's end moves through the host (only "after": its start is the timeline's).
    if (plan.phased()) { attempt(async () => { await plan.coverDay(end); scrolled = true; }); return; }
    attempt(async () => { await plan.saveTrip({ ...trip, start, end }); scrolled = true; });
  }

  function renderDays() {
    const days = plan.days();
    const by = plan.byDay();
    const wrap = document.createElement('div');
    wrap.id = 'days';
    wrap.className = 'days';
    state.bounds = tripBounds(plan.list());
    const empties = emptyDays();
    // Empty days can be hidden, unless every day is empty (then there would be nothing to show).
    const hiding = state.hideEmpty && empties.size > 0 && empties.size < days.length;
    $('app').classList.toggle('hide-empty', hiding);
    // With phases the line carries a marker at each phase's start and end (phaseJoints), in place of the old phase headings.
    const joints = phaseJoints(days, plan.bands());
    // With phases the first day is the timeline's (the main phase's start), so days are only added after.
    if (canEdit && !plan.phased()) wrap.append(buildEdge('before'));
    // One badge for each run of hidden days, standing in for them on the line.
    const runs = new Map(); // first hidden day of a run -> the days in it
    if (hiding) {
      let run = null;
      for (const d of days) {
        if (empties.has(d)) { if (!run) { run = []; runs.set(d, run); } run.push(d); } else run = null;
      }
    }
    days.forEach((day, i) => {
      const above = timelineMarkers(day, 'before', days, by, joints);
      if (above) wrap.append(above);
      if (runs.has(day)) wrap.append(buildGap(runs.get(day)));
      if (i === 0) wrap.append(...buildBetween(''));
      wrap.append(buildDay(day, i, days, by));
      // A hidden day's own joint has nowhere meaningful to point (its day is not shown) and only piles up on
      // the gap badge standing in for it; the badge's own + already opens the same menu for the run. What is at
      // that joint is still drawn, after the badge, so nothing on the line disappears with the day.
      wrap.append(...buildBetween(day, !(hiding && empties.has(day))));
      const below = timelineMarkers(day, 'after', days, by, joints);
      if (below) wrap.append(below);
    });
    if (canEdit) wrap.append(buildEdge('after'));
    return wrap;
  }

  function renderStrip() {
    const strip = $('daystrip');
    strip.replaceChildren();
    const today = ymd(new Date());
    const empties = emptyDays();
    const bandList = plan.bands();
    for (const day of plan.days()) {
      const chip = clone('tpl-daychip');
      chip.dataset.day = day;
      chip.classList.toggle('is-empty', empties.has(day));
      chip.classList.toggle('is-today', day === today);
      const ph = phaseOnDay(bandList, day);
      if (ph && ph.tint) chip.title = ph.label;
      fill(chip, { weekday: parseYmd(day).toLocaleDateString([], { weekday: 'short' }), day: parseYmd(day).getDate() });
      // In the trip: a dot in the corner, and the words in the chip's label.
      const words = [parseYmd(day).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }), day === today ? 'today' : '', inTrip(day) ? 'in the trip' : '', ph && ph.label ? ph.label : ''].filter(Boolean);
      chip.setAttribute('aria-label', words.join(', '));
      if (inTrip(day)) { const dot = document.createElement('span'); dot.className = 'sdk-daychip-dot'; dot.setAttribute('aria-hidden', 'true'); chip.append(dot); }
      strip.append(chip);
    }
  }

  // --- the other views ---------------------------------------------------------------------------------------

  // What is waiting on someone: the polls still open and the tasks due before the trip (the space's own, as the Planner's search
  // finds them), then anything else that is linked to the trip and not done. Each once.
  function openDecisions() {
    const seen = new Set();
    return [...plan.waiting, ...state.tripLinks.filter((c) => c.done !== true)].filter((c) => {
      const k = host.util.objectKey(c.ref);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  const DECISION_GROUPS = { poll: 'Polls to vote on', task: 'Tasks due before the trip' };
  function renderDecisions() {
    const body = $('body');
    body.replaceChildren();
    const groups = new Map();
    for (const first of Object.values(DECISION_GROUPS)) groups.set(first, []); // polls, then tasks, then whatever else is linked
    for (const c of openDecisions()) {
      const k = DECISION_GROUPS[c.kind] || c.kindName || (c.module && c.module.name) || 'Other';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    for (const [k, list] of groups) if (!list.length) groups.delete(k);
    if (!groups.size) {
      const empty = clone('tpl-day-empty');
      empty.textContent = 'Nothing is waiting on anyone. Open polls and tasks due before the trip appear here.';
      const ul = document.createElement('ul');
      ul.className = 'decisions';
      ul.append(empty);
      body.append(ul);
      return;
    }
    for (const [kind, summaries] of groups) {
      const [title, list] = parts('tpl-decisions');
      title.textContent = kind;
      list.replaceChildren();
      // Soonest first, the most overdue at the top; undated last.
      summaries.sort((a, b) => ((summaryWhen(a) || {}).day || '9999').localeCompare((summaryWhen(b) || {}).day || '9999'));
      for (const c of summaries) {
        const row = clone('tpl-decision');
        setIcon(row.querySelector('[data-icon]'), c.module && c.module.icon);
        const w = summaryWhen(c);
        const when = w ? `${parseYmd(w.day).toLocaleDateString([], { month: 'short', day: 'numeric' })}${w.time ? ' ' + tt(w.time) : ''}` : '';
        fill(row, { title: c.title, sub: [when, c.subtitle].filter(Boolean).join(' · ') });
        const btn = row.querySelector('[data-action="open"]');
        btn.textContent = c.kind === 'poll' ? 'Vote' : 'Open';
        btn.dataset.ref = JSON.stringify(c.ref);
        hide(btn, !c.open);
        list.append(row);
      }
      body.append(title, list);
    }
  }

  // A list row in the style of the Decisions rows: an icon, a title and a line under it, and optionally a button.
  function row(list, { icon, title, sub, code, button, id }) {
    const r = clone('tpl-decision');
    setIcon(r.querySelector('[data-icon]'), icon);
    fill(r, { title, sub, code });
    const btn = r.querySelector('[data-action="open"]');
    if (button) { btn.textContent = button; btn.dataset.action = 'edit-item'; btn.dataset.id = id; } else btn.remove();
    list.append(r);
  }
  function section(body, title) {
    const [t, ul] = parts('tpl-decisions');
    t.textContent = title;
    ul.replaceChildren();
    body.append(t, ul);
    return ul;
  }
  const nothing = (body, text) => { const ul = document.createElement('ul'); ul.className = 'decisions'; const e = clone('tpl-day-empty'); e.textContent = text; ul.append(e); body.append(ul); };
  const dayTime = (i) => [i.date ? parseYmd(i.date).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : 'unscheduled', tt(i.time)].filter(Boolean).join(' ');

  // Bookings: the stays and journeys with their reference codes, in date order.
  function renderBookings() {
    const body = $('body');
    body.replaceChildren();
    const list = bookings(plan.list());
    if (!list.length) return nothing(body, 'No stays or journeys yet. Add one to a day and it is listed here with its booking reference.');
    for (const [kind, title] of [['stay', 'Stays'], ['journey', 'Journeys']]) {
      const mine = list.filter((i) => i.kind === kind);
      if (!mine.length) continue;
      const ul = section(body, title);
      for (const i of mine) {
        const nights = stayNights(i);
        // A round trip is one row: both days, and the route both ways ("LHR ⇄ JFK").
        const back = kind === 'journey' ? plan.returnFor(i.id) : null;
        const ends = back && i.fromCode && i.toCode ? [i.fromCode, i.toCode] : [i.from, i.to];
        const route = back ? (ends[0] && ends[1] ? `${ends[0]} ⇄ ${ends[1]}` : ends.filter(Boolean).join(' ⇄ ')) : [i.from, i.to].filter(Boolean).join(' → ');
        const line = kind === 'stay'
          ? [i.checkOut && i.date ? `${dayShort(i.date)} – ${dayShort(i.checkOut)}` : dayTime(i), nights ? `${nights} night${nights === 1 ? '' : 's'}` : '', i.place || i.address].filter(Boolean).join(' · ')
          : [dayTime(i), back ? dayTime(back) : '', route].filter(Boolean).join(' · ');
        row(ul, { icon: kind === 'stay' ? 'bed' : cardOf(i).badge || 'route', title: i.title, sub: line, code: i.confirm, button: 'Open', id: i.id });
      }
    }
  }

  // Money: what was spent, who is owed what, and the fewest payments that settle it.
  const money = (n) => {
    return host.util.money(n, planCurrency()); // the budget's currency, else the plan's, else the server's
  };
  function renderMoney() {
    const body = $('body');
    body.replaceChildren();
    const costs = costItems(plan.list());
    if (!costs.length) return nothing(body, 'Nothing has a cost yet. Give a stop, stay or journey a cost and who paid, and it is shared out here.');
    const keys = state.people.map((p) => p.key);
    const b = balances(costs, keys);
    const totals = section(body, `Total ${money(b.planned)}`);
    row(totals, { icon: 'coins', title: 'Paid so far', sub: b.planned > b.total ? `${money(b.total)} of ${money(b.planned)} · ${money(Math.round((b.planned - b.total) * 100) / 100)} not paid yet` : money(b.total) });
    for (const k of Object.keys(b.net)) {
      const n = b.net[k];
      row(totals, { icon: 'user', title: nameOf(k), sub: `paid ${money(b.paid[k])} · share ${money(b.share[k])} · ${n > 0 ? `is owed ${money(n)}` : n < 0 ? `owes ${money(-n)}` : 'all square'}` });
    }
    const settle = section(body, 'Settle up');
    if (!b.payments.length) row(settle, { icon: 'check', title: 'Everyone is square', sub: '' });
    for (const p of b.payments) row(settle, { icon: 'right-left', title: `${nameOf(p.from)} pays ${nameOf(p.to)}`, sub: money(p.amount) });
    const list = section(body, 'Costs');
    for (const i of costs.sort((x, y) => String(x.date).localeCompare(String(y.date)))) {
      row(list, { icon: 'receipt', title: i.title, sub: `${dayTime(i)} · paid by ${i.paidBy ? nameOf(i.paidBy) : 'nobody yet'}${i.owners.length ? ' · shared by ' + i.owners.map(nameOf).join(', ') : ' · shared by everyone'}`, button: money(i.cost), id: i.id });
    }
  }

  // --- the page ----------------------------------------------------------------------------------------------


  // The four views are the toolbar's view switch. Hide/Show empty days and Edit dates are not a view --
  // they're the trip's own actions, icons in the titlebar (host.header.set) wherever the host draws the module.
  const VIEWS = [
    { id: 'days', label: 'Days', icon: 'calendar-days' },
    { id: 'decisions', label: 'Decisions', icon: 'scale-balanced' },
    { id: 'bookings', label: 'Bookings', icon: 'ticket' },
    { id: 'money', label: 'Money', icon: 'coins' },
  ];
  // With Budget on in this space its Overview and Costs carry the money, so the Money view steps aside (the bookings keep their
  // cost fields). Found by the `budget` flag of another module that is on here, never by name; asked on load, on focus and every 30 s.
  // A guest gets the Money view only where an owner turned on "Guests can see costs and booking codes" in Set up
  // (host.space().guestsSeeHidden); the server keeps the amounts from them otherwise.
  const hideMoney = () => info.user.role === 'guest' && !(spaceOf() && spaceOf().guestsSeeHidden === true);
  const viewsNow = () => VIEWS.filter((v) => v.id !== 'money' || (!state.budgetOn && !hideMoney()));
  let topNext = false;
  const viewSwitch = host.ui.viewSwitch({
    id: 'view',
    options: viewsNow(),
    value: state.view,
    onChange: (id) => {
      state.view = id;
      scrolled = state.view !== 'days';
      topNext = true; // another view opens at its top, not where the last one was scrolled to
      redraw();
    },
  });
  let headerSig = '';
  function syncHeader() {
    const items = [];
    if (state.view === 'days') items.push({ id: 'toggle-empty', icon: 'eye-slash', title: state.hideEmpty ? 'Show empty days' : 'Hide empty days', on: state.hideEmpty });
    // With phases the dates are the bar's and the currency is the budget's (Set up): the time zone is left to edit here.
    if (canEdit) items.push({ id: 'edit-trip', icon: 'pen', title: plan.phased() ? 'Edit time zone and currency' : 'Edit dates, time zone and currency' });
    const sig = JSON.stringify(items);
    if (sig === headerSig) return;
    headerSig = sig;
    host.header.set(items).catch(() => {});
  }
  host.on('header', (e) => {
    if (e.id === 'toggle-empty') {
      state.hideEmpty = !state.hideEmpty;
      try { localStorage.setItem('planner-hide-empty', state.hideEmpty ? '1' : '0'); } catch (err) { /* not remembered */ }
      return redraw();
    }
    if (e.id === 'edit-trip') return openEditor('trip');
  });

  const templatePhases = () => (typeof host.phases === 'function' ? host.phases() : []);
  const spaceOf = () => (typeof host.space === 'function' ? host.space() : null);
  // The currency costs are worded in: the budget's (Set up), else the one stored on the plan, else none (the server's).
  function planCurrency() {
    const sp = typeof host.space === 'function' ? host.space() : null;
    const b = sp && sp.budget && typeof sp.budget.currency === 'string' ? sp.budget.currency.trim().toUpperCase() : '';
    return b || (plan.trip || {}).currency || undefined;
  }
  // No date, and not placed at a joint: it belongs under "Unscheduled". So does one dated on a day the plan cannot show
  // (past its 60 days, saved before such an object went there itself), rather than showing nowhere.
  const undatedItems = () => {
    const shownDays = new Set(plan.days());
    return plan.list().filter((i) => i.kind !== 'lane' && (i.after === null || i.after === undefined) && (!i.date || !shownDays.has(i.date)));
  };
  function undatedRow(ul, item) {
    row(ul, { icon: cardOf(item).badge || 'note-sticky', title: item.title, sub: item.date ? `Dated ${dayShort(item.date)}, outside the plan` : '', button: canEdit ? 'Edit' : '', id: item.id });
  }
  function buildUndated() {
    const items = undatedItems();
    if (!items.length) return null;
    const bands = plan.bands();
    const box = clone('tpl-undated');
    if (!bands.length) {
      const ul = document.createElement('ul');
      ul.className = 'decisions';
      for (const item of items) undatedRow(ul, item);
      box.append(ul);
    } else {
      // "Unscheduled" is the default phase: first, for an object with no phase of its own. Not a phase of the plan. Its group has no
      // heading of its own, alone or beside phases: the area's own "Unscheduled" above it already says it, and the phases' groups
      // follow with theirs.
      const groups = [{ id: null, label: 'Unscheduled' }, ...bands].map((p) => ({ p, mine: items.filter((item) => phaseOf(item, bands) === p.id) })).filter((g) => g.mine.length);
      for (const { p, mine } of groups) {
        const group = clone('tpl-undated-group');
        fill(group, { label: p.label });
        if (p.id === null) group.querySelector('h3').hidden = true;
        const ul = group.querySelector('ul');
        for (const item of mine) undatedRow(ul, item);
        box.append(group);
      }
    }
    return box;
  }

  // The plan's dates, worded short ("Fri 9 – Sun 25 Oct 2026"); empty without a start.
  function tripDates(trip) {
    if (!trip || !trip.start) return '';
    const a = parseYmd(trip.start);
    const b = parseYmd(trip.end || trip.start);
    const part = (d, o) => d.toLocaleDateString([], o);
    const same = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
    return trip.end && trip.end !== trip.start
      ? `${part(a, { weekday: 'short' })} ${a.getDate()}${same ? '' : ' ' + part(a, { month: 'short' })} – ${part(b, { weekday: 'short' })} ${b.getDate()} ${part(b, { month: 'short' })} ${b.getFullYear()}`
      : `${part(a, { weekday: 'short' })} ${a.getDate()} ${part(a, { month: 'short' })} ${a.getFullYear()}`;
  }

  // The host draws the window's bands: the titlebar names the module (its display name) and holds the trip's own actions; the
  // toolbar row is the view switch, then the plan's name and dates as the row's title; the status line says the rest.
  let toolbarSig = '';
  function renderHeader() {
    const trip = plan.trip;
    host.setTitle(info.module.name);
    const name = planName(trip, spaceOf()) || 'Trip';
    const dates = tripDates(trip);
    const items = state.loaded ? [{ type: 'title', text: dates ? `${name} · ${dates}` : name }] : [];
    const sig = JSON.stringify(items);
    if (sig !== toolbarSig) { toolbarSig = sig; host.toolbar.set(items).catch(() => { toolbarSig = ''; }); }
    const openCount = openDecisions().length;
    if (state.view === 'money' && !viewsNow().some((v) => v.id === 'money')) state.view = 'days';
    viewSwitch.set(state.view, viewsNow().map((v) => (v.id === 'decisions' && openCount ? { ...v, label: `Decisions (${openCount} open)` } : v)));
    syncHeader();
    syncStatus();
  }

  // The status line at the foot of the window: the day in view ("Day 6 of 26 · Wed 14 Oct · 3 stops") on Days, a count on the other
  // views. Short, read-only; none until the plan has loaded.
  function syncStatus() {
    const items = [];
    if (state.loaded) {
      // The phase line is the chip's words (host.util.phaseWords, the one rule), first; none without phases.
      const bands = plan.bands();
      const phase = bands.length && host.util.phaseWords ? host.util.phaseWords(bands, ymd(new Date())) : '';
      if (phase) items.push({ text: phase });
      if (state.view === 'days') {
        const days = plan.days();
        const day = days.includes(state.currentDay) ? state.currentDay : null;
        if (day) {
          const own = entriesFor(day, days, plan.byDay()).filter((e) => (!e.span || e.span === 'start') && e.item.kind !== 'block');
          const spent = own.reduce((sum, e) => sum + (Number(e.item.cost) > 0 ? Number(e.item.cost) : 0), 0);
          items.push({ text: dayNumber(day, days) ? `Day ${dayNumber(day, days)} of ${numberedDays(days).length} · ${dayShort(day)}` : dayShort(day) });
          items.push({ text: own.length ? words(own.length, 'stop', 'stops') : 'Nothing planned' });
          if (spent) items.push({ text: money(spent) });
          if (state.people.length) items.push({ text: words(state.people.length, 'traveller', 'travellers') });
        }
      } else if (state.view === 'decisions') {
        const n = openDecisions().length;
        if (n) items.push({ text: `${n} open` });
      } else if (state.view === 'bookings') {
        const list = bookings(plan.list());
        if (list.length) items.push({ text: `${list.filter((i) => i.confirm).length} of ${list.length} booked` });
      } else if (state.view === 'money') {
        const costs = costItems(plan.list());
        if (costs.length) items.push({ text: `Total ${money(balances(costs, state.people.map((p) => p.key)).planned)}` }, { text: words(costs.length, 'cost', 'costs') });
      }
    }
    host.status.set(items).catch(() => {});
  }

  function keepInputs() { return {}; }
  function restoreInputs() {}

  let scrolled = false;
  function render() {
    const app = $('app');
    app.hidden = false;
    $('msg').hidden = true;
    if (!state.loaded) {
      $('stripbar').hidden = true;
      $('body').replaceChildren(clone('tpl-state-loading'));
      return;
    }
    const kept = keepInputs();
    const scroller = $('body');
    const top = scroller.scrollTop;
    renderHeader();
    if (state.view !== 'days') {
      $('stripbar').hidden = true;
      ({ decisions: renderDecisions, bookings: renderBookings, money: renderMoney })[state.view]();
    } else if (!plan.days().length && !undatedItems().length) {
      $('stripbar').hidden = true;
      const s = clone('tpl-state-empty-trip');
      if (!canEdit) s.querySelector('[data-action="add-first"]').remove();
      $('body').replaceChildren(s);
    } else {
      $('stripbar').hidden = !plan.days().length;
      if (plan.days().length) renderStrip();
      else $('daystrip').replaceChildren();
      const undated = buildUndated();
      const days = plan.days().length ? renderDays() : null;
      $('body').replaceChildren(...[undated, days].filter(Boolean));
    }
    hydrate(root === document ? document.body : root);
    restoreInputs(kept);
    if (scrolled) { scroller.scrollTop = topNext ? 0 : top; if (state.view === 'days' && state.currentDay) markCurrent(state.currentDay); }
    else if (state.view === 'days') {
      scrolled = true;
      const today = $(`day-${ymd(new Date())}`) || $(`day-${plan.days()[0]}`);
      if (today) today.scrollIntoView({ inline: 'center', block: 'start' });
      markCurrent(today ? today.dataset.day : null);
    }
    topNext = false;
    loadLinks().catch(() => {});
    refocusNewRow();
  }
  // After a new object is saved, the plan redraws more than once (the save, then the change echo a moment later), and each
  // redraw replaces the row that had focus. For a short while after the save, every redraw puts focus back on the new
  // row's menu, unless the person has moved it somewhere that still exists.
  function refocusNewRow() {
    const want = state.focusAfterRedraw;
    if (!want) return;
    if (Date.now() > want.until) { state.focusAfterRedraw = null; return; }
    if ($('editor').open) return; // the form is still open (the save's own redraw): its close comes first
    const inside = root.activeElement;
    if (inside && inside.isConnected && !inside.closest('.row')) return; // moved to something else in here: leave it
    const btn = objectControl(want.id);
    if (btn) { try { btn.focus(); } catch (err) { /* not focusable */ } }
  }
  // The control that stands for an object on the page: its row's menu on a day, or its Edit button in a list (undated,
  // the Decisions and Bookings views).
  const objectControl = (id) => root.querySelector(`.row[data-id="${CSS.escape(id)}"] [data-action="move-menu"]`) || root.querySelector(`[data-action="edit-item"][data-id="${CSS.escape(id)}"]`);
  let queued = false;
  const redraw = () => { if (queued) return; queued = true; Promise.resolve().then(() => { queued = false; render(); reportFacts(); }); };

  // What the space's status strip shows from the Planner (host.facts; #216): the money spent, against the space's budget
  // target when an owner set one in Set up (host.space().budget), and the next journey or stay with its day as `when`,
  // which the host words for each viewer (stripFacts, the lib).
  // Reported by someone who may edit the plan, in a space, after each change; the same facts again are not sent.
  const wholeMoney = (n, code) => {
    const c = code || host.locale().currency || 'USD';
    const whole = Math.round(n) === n; // "$4,000", "$1,560.50"
    try { return new Intl.NumberFormat([], { style: 'currency', currency: c, ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}) }).format(n); } catch (err) { return host.util.money(n, c); }
  };
  let factsSaid = '';
  function reportFacts() {
    if (!host.facts || !canEdit || !state.loaded || !spaceOf()) return;
    const list = stripFacts({
      items: plan.list(),
      travellers: state.people.map((p) => p.key),
      today: ymd(new Date()),
      budgetOn: state.budgetOn,
      target: spaceOf().budget || null,
      currency: planCurrency() || host.locale().currency || 'USD',
      money: wholeMoney,
    });
    const sig = JSON.stringify(list);
    if (sig === factsSaid) return;
    factsSaid = sig;
    host.facts.set(list).catch(() => { factsSaid = ''; }); // tried again on the next change
  }
  // Is Budget on in this space? It counts the bookings' costs itself, so with it on this module reports no `spent` fact (the one
  // it sent before is replaced by the shorter list) and hides its Money view; with it off both return. Nothing stored changes.
  async function lookBudget() {
    if (!host.budget || !host.budget.elsewhere || !spaceOf()) return;
    let on;
    try { on = await host.budget.elsewhere(); } catch (err) { return; }
    if (on === state.budgetOn) return;
    state.budgetOn = on;
    if (state.loaded) { redraw(); reportFacts(); }
  }
  const budgetTimer = setInterval(() => { if (!host.rootElement.isConnected) clearInterval(budgetTimer); else if (!document.hidden) lookBudget(); }, 30000);
  window.addEventListener('focus', lookBudget);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) lookBudget(); });
  // The space's budget target changed (an owner's Set up): the strip's money follows.
  host.on('space', () => { reportFacts(); redraw(); });

  function markCurrent(day) {
    if (day) { state.currentDay = day; syncStatus(); }
    for (const c of root.querySelectorAll('.sdk-daychip')) { if (c.dataset.day === day) c.setAttribute('aria-current', 'true'); else c.removeAttribute('aria-current'); }
    for (const d of root.querySelectorAll('.sdk-day[data-day]')) d.classList.toggle('is-current', Boolean(day) && d.dataset.day === day);
    // keep the chosen chip in view inside the strip (the strip alone scrolls, never the page)
    const strip = $('daystrip');
    const chip = strip && strip.querySelector('.sdk-daychip[aria-current="true"]');
    if (chip) {
      const left = chip.offsetLeft - strip.offsetLeft;
      if (left < strip.scrollLeft || left + chip.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollTo({ left: left - (strip.clientWidth - chip.offsetWidth) / 2 });
    }
  }
  // The arrows beside the day strip: a page of days at a time; each is disabled at its end.
  function stripArrows() {
    const strip = $('daystrip');
    if (!strip) return;
    const prev = root.querySelector('[data-action="strip-prev"]');
    const next = root.querySelector('[data-action="strip-next"]');
    if (prev) prev.disabled = strip.scrollLeft <= 1;
    if (next) next.disabled = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1;
  }
  $('daystrip').addEventListener('scroll', stripArrows, { passive: true });
  new ResizeObserver(stripArrows).observe($('daystrip'));
  $('body').addEventListener('scroll', () => {
    const days = [...root.querySelectorAll('.sdk-day[data-day]')].filter((d) => d.dataset.day);
    const top = $('body').getBoundingClientRect().top;
    const first = days.find((d) => d.getBoundingClientRect().bottom > top + 24);
    if (first) markCurrent(first.dataset.day);
  }, { passive: true });

  // What other modules link to each item and to the trip (only asked for what is shown, and once).
  const asked = new Set();
  async function loadLinks() {
    if (!host.objects || !host.objects.linksToAll) return;
    // One request for the trip and every object not asked about yet (the server answers at most 200 at a time).
    const fresh = [];
    if (!asked.has('trip')) { asked.add('trip'); fresh.push({ key: 'trip', ref: tripRef() }); }
    for (const item of plan.list()) {
      if (asked.has(item.id)) continue;
      asked.add(item.id);
      fresh.push({ key: item.id, ref: planRef(item.id) });
    }
    let changed = false;
    for (let at = 0; at < fresh.length; at += 200) {
      const chunk = fresh.slice(at, at + 200);
      let found = [];
      try { found = await host.objects.linksToAll(chunk.map((f) => f.ref)); } catch (err) { /* nothing links to them */ }
      const byKey = new Map(found.map((f) => [host.util.objectKey(f.ref), f.summaries || []]));
      for (const f of chunk) {
        const summaries = byKey.get(host.util.objectKey(f.ref)) || [];
        if (f.key === 'trip') { state.tripLinks = summaries; changed = true; } else if (summaries.length) { state.links.set(f.key, summaries); changed = true; }
      }
    }
    if (changed) redraw();
  }
  if (host.on) host.on('links', () => { asked.clear(); state.links.clear(); loadLinks().catch(() => {}); });

  // --- the item menu, and moving ------------------------------------------------------------------------------

  // Where an item is, as the menu's Move to value: its joint on the line, or its day.
  // Where an item is, for the place menus: its day, its joint on the line, or (no day and not placed on the line) "Not on a day
  // yet", which the plan's own reading would put at the head of the line.
  const placeOf = (item) => {
    if (item.kind !== 'lane' && !item.date && (item.after === null || item.after === undefined) && !plan.dayOf(item)) return { date: null };
    const j = plan.jointOf(item);
    return j === null ? { date: plan.dayOf(item) } : { after: j };
  };
  // Set a place menu, keeping a day the plan does not show (past its 60 days) as a choice of its own, so saving does not lose it.
  function setPlaceMenu(select, place) {
    const value = placeValue(place);
    select.value = value;
    if (select.value === value || !place || !place.date) return;
    const o = document.createElement('option');
    o.value = value;
    o.textContent = `${dayShort(place.date)}, outside the plan`;
    select.append(o);
    select.value = value;
  }
  // The item menu: host.menu.show under the button that opened it. Edit, Move up or down (or 30 minutes earlier or later), Move to
  // another day, Change type (a time block's marker types, a flyout), Move to unscheduled, Follow its result (a link), Delete.
  function openMenu(id, button) {
    const item = plan.list().find((i) => i.id === id);
    if (!item) return;
    state.menuFor = id;
    state.menuButton = button;
    // Move up / Move down swap with the neighbour on the same day; an object with a time moves by half an hour instead.
    const timedNow = Boolean(item.time) || (item.kind === 'link' && Boolean(item.ref) && Boolean(timeOf(plan.summaries.get(host.util.objectKey(item.ref)))));
    // A time block can change its type; it is removed rather than deleted.
    const isBlock = item.kind === 'block' || item.kind === 'lane';
    // A link that cannot be read has nothing to edit.
    const unreadable = item.kind === 'link' && Boolean(linkState(item.ref && plan.summaries.get(host.util.objectKey(item.ref))));
    const typeRows = isBlock ? blockTypes().map((t) => ({ id: t.id, label: t.label, icon: t.icon, iconColor: t.color || undefined, current: t.id === item.type, onClick: () => attempt(() => plan.updateItem(id, { type: t.id })) })) : [];
    if (isBlock && !typeRows.some((r) => r.current)) { const t = markerType(item.type); typeRows.push({ id: t.id, label: t.label, icon: t.icon, iconColor: t.color || undefined, current: true, onClick: () => {} }); }
    host.menu.show({
      id: `item-${id}`,
      anchor: button,
      items: [
        unreadable ? null : { id: 'edit', label: 'Edit', icon: 'pen', onClick: () => openItemEditor(id) },
        { id: 'earlier', label: timedNow ? '30 minutes earlier' : 'Move up', icon: 'arrow-up', tip: timedNow ? 'Changes the time, half an hour earlier. It stays on the same day.' : 'Swaps places with the one above it. It stays on the same day.', onClick: () => attempt(() => plan.nudgeItem(id, -1)) },
        { id: 'later', label: timedNow ? '30 minutes later' : 'Move down', icon: 'arrow-down', tip: timedNow ? 'Changes the time, half an hour later. It stays on the same day.' : 'Swaps places with the one below it. It stays on the same day.', onClick: () => attempt(() => plan.nudgeItem(id, 1)) },
        { id: 'move-to', label: 'Move to another day…', icon: 'calendar-days', tip: 'Choose another day, or unscheduled', onClick: () => setTimeout(() => openMoveTo(id, button), 0) }, // after this menu has closed and given focus back
        typeRows.length ? { id: 'type', label: 'Change type', icon: 'tag', items: typeRows } : null,
        plan.jointOf(item) === null ? { id: 'to-line', label: 'Move to unscheduled', icon: 'lightbulb', onClick: () => attempt(() => plan.moveTo(id, null, 1e6)) } : null, // off its day, into the Unscheduled area
        item.kind === 'link' ? { id: 'follow', label: item.follow ? 'Stop following its result' : 'Follow its result', icon: 'bell', onClick: () => attempt(() => plan.updateItem(id, { follow: !item.follow })) } : null,
        { id: 'delete', label: isBlock ? 'Remove' : 'Delete', icon: 'trash', danger: true, onClick: () => setTimeout(() => askDelete(id, button, isBlock), 0) },
      ],
    });
  }
  // Only the date field of "Pick a date…" is still a layer of this module's own; the menus are the SDK's.
  const closeMenu = () => { $('date-pop').hidden = true; state.menuFor = null; };
  // Move to another day...: the grouped list under the item's button, ending in "Pick a date...". Unscheduled holds "Not on a day
  // yet" and the spots between days (a marker between days sees only those).
  function openMoveTo(id, anchor) {
    const item = plan.list().find((i) => i.id === id);
    if (!item) return;
    const go = (p) => attempt(() => (p.after !== undefined ? plan.moveToJoint(id, p.after, 1e6) : plan.moveTo(id, p.date, 1e6)));
    const lane = item.kind === 'lane';
    host.menu.show({
      id: `move-to-${id}`,
      anchor,
      items: dayMenuItems({ current: placeOf(item), choose: go, days: choosableDays(), none: 'Unscheduled', joints: true, jointsOnly: lane, pickDate: lane ? null : () => setTimeout(() => openDatePop(id, anchor), 0) }), // after the list has closed and given focus back
    });
  }
  // The date field for "Pick a date...": under the item's button; Move or Enter moves it, Escape or Cancel leaves it.
  function openDatePop(id, anchor) {
    const item = plan.list().find((i) => i.id === id);
    if (!item) return;
    const pop = $('date-pop');
    const input = $('date-pop-input');
    const held = placeOf(item).date || '';
    const b = dayBounds(held);
    input.min = b.min;
    input.max = b.max;
    input.value = held;
    state.menuFor = id;
    pop.hidden = false;
    const app = $('app').getBoundingClientRect();
    const r = anchor.getBoundingClientRect();
    let top = Math.round(r.bottom - app.top + 4);
    if (top + pop.offsetHeight > app.height - 8) top = Math.max(8, Math.round(r.top - app.top - pop.offsetHeight - 4));
    pop.style.top = `${top}px`;
    pop.style.left = `${Math.max(8, Math.min(Math.round(r.right - app.left - pop.offsetWidth), Math.round(app.width - pop.offsetWidth - 8)))}px`;
    input.focus();
  }
  $('date-pop').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = state.menuFor;
    const date = $('date-pop-input').value;
    if (!id || !date || !$('date-pop-input').checkValidity()) return;
    closeMenu();
    attempt(() => plan.moveTo(id, date, 1e6));
  });
  $('date-pop-cancel').addEventListener('click', () => { const from = state.menuButton; closeMenu(); if (from && from.isConnected) from.focus(); });
  $('date-pop').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); $('date-pop-cancel').click(); } });

  // Delete asks once more, in a small menu under the same button ("Really delete?"); a leg of a round trip asks which leg instead.
  function askDelete(id, anchor, block) {
    if (askDeleteLegs(id, anchor)) return;
    host.menu.show({
      id: `delete-${id}`,
      anchor,
      items: [
        { id: 'sure', label: block ? 'Really remove?' : ((state.links.get(id) || []).length ? `Used by ${state.links.get(id).length}. Really delete?` : 'Really delete?'), icon: 'trash', danger: true, onClick: () => attempt(() => plan.removeItem(id)) },
        { id: 'cancel', label: 'Cancel', icon: 'xmark', onClick: () => {} },
      ],
    });
  }
  // Deleting a leg of a round trip asks which: both legs, only this one (only the outbound: the return keeps the booking details),
  // or neither. Anchored to the button that asked. False when the item is not a leg of a round trip.
  function askDeleteLegs(id, anchor, before) {
    const item = plan.list().find((i) => i.id === id);
    if (!item || item.kind !== 'journey') return false;
    const isReturn = Boolean(plan.outboundFor(item));
    if (!isReturn && !plan.returnFor(id)) return false;
    const run = (both) => () => { if (before) before(); attempt(() => plan.removeLeg(id, both)); };
    host.menu.show({
      id: `delete-legs-${id}`,
      anchor,
      items: [
        { id: 'both', label: 'Delete both legs', icon: 'trash', danger: true, onClick: run(true) },
        { id: 'this', label: 'Delete only this leg', icon: 'trash', hint: isReturn ? 'The outbound stays.' : 'The return stays, with the booking details.', onClick: run(false) },
        { id: 'cancel', label: 'Cancel', icon: 'xmark', onClick: () => {} },
      ],
    });
    return true;
  }

  async function attempt(fn) {
    note('');
    try {
      await fn();
    } catch (err) {
      note(err.conflict ? 'Someone changed that first; the newer version is shown.' : err.message);
    }
  }

  root.addEventListener('click', (e) => { if (!$('date-pop').hidden && !e.target.closest('#date-pop, [data-action="move-menu"]')) closeMenu(); });

  // --- dragging (desktop) --------------------------------------------------------------------------------------

  let dragId = null;
  let lastTarget = null;
  // While anything is over the plan, every joint opens into a drop zone on the line (.days.dragging-line). Closing them
  // moves everything below the first joint up, so it must not happen between the last "over" and the drop: a drop
  // is hit-tested against the layout the pointer saw. `leave` (which the drop is sent right after) closes them a tick later.
  const openJoints = () => { const days = root.querySelector('.days'); if (days) days.classList.add('dragging-line'); };
  const closeJoints = () => { for (const d of root.querySelectorAll('.days.dragging-line')) d.classList.remove('dragging-line'); };
  const clearDrop = (keepJoints) => {
    if (lastTarget) lastTarget.removeAttribute('data-drop');
    lastTarget = null;
    for (const d of root.querySelectorAll('.sdk-day.drop-target, .joint.drop-target, .timeline.between.drop-target')) d.classList.remove('drop-target');
    for (const d of root.querySelectorAll('.row.entry.dragging')) d.classList.remove('dragging');
    if (!keepJoints) closeJoints();
  };
  // Where a point on the page is on the plan: at a joint on the line (`after`; `el` is the list of items there or the + itself) or
  // on a day (`date`; `el` the day), and either way the entry under the pointer and whether the pointer is in its top or bottom
  // half. Null off both.
  function spotFrom(el, clientY) {
    if (!el || !el.closest) return null;
    const half = (row) => { const r = row.getBoundingClientRect(); return clientY < r.top + r.height / 2 ? 'before' : 'after'; };
    const line = el.closest('.joint, .timeline.between');
    if (line) {
      const row = el.closest('.timeline.between .row.entry');
      return { after: line.dataset.after, el: line, row, where: row ? half(row) : null };
    }
    const dayEl = el.closest('.sdk-day');
    if (!dayEl) return null;
    const row = el.closest('.sdk-day .row.entry');
    return { date: dayEl.dataset.day, el: dayEl, row, where: row ? half(row) : null };
  }
  // Light a spot as the drop target, with the entry under the pointer and the side the item would go on.
  function showSpot(spot, movingId) {
    if (!spot) return;
    spot.el.classList.add('drop-target');
    if (spot.row && spot.row.dataset.id !== movingId) { spot.row.dataset.drop = spot.where; lastTarget = spot.row; }
  }
  // Edge scrolling while an item is dragged: only with the pointer in a zone at the top or bottom of the list's visible area,
  // faster the nearer (or further past) the edge. Driven by dragover (which repeats while the pointer rests); it stops when the
  // pointer leaves the zone or the window, the list ends, or the drag ends. Dragstart never scrolls and scrollTop is never set
  // to a fixed value.
  const edge = { y: 0, at: 0, raf: 0 };
  function edgeStep() {
    edge.raf = 0;
    const body = $('body');
    if (!dragId || !body || performance.now() - edge.at > 250) return;
    const r = body.getBoundingClientRect();
    const zone = Math.min(56, r.height * 0.15);
    const slow = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const max = slow ? 6 : 20;
    const fromTop = r.top + zone - edge.y;
    const fromBottom = edge.y - (r.bottom - zone);
    const depth = fromTop > 0 ? -fromTop : fromBottom > 0 ? fromBottom : 0;
    if (!depth) return;
    const before = body.scrollTop;
    body.scrollTop = before + Math.sign(depth) * Math.max(1, Math.min(max, Math.round(max * Math.min(1, Math.abs(depth) / zone))));
    if (body.scrollTop !== before) edge.raf = requestAnimationFrame(edgeStep);
  }
  function edgeScroll(y) {
    edge.y = y;
    edge.at = performance.now();
    if (!edge.raf) edge.raf = requestAnimationFrame(edgeStep);
  }
  function edgeStop() { if (edge.raf) cancelAnimationFrame(edge.raf); edge.raf = 0; edge.at = 0; }
  root.addEventListener('dragleave', (e) => { if (!e.relatedTarget) edgeStop(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') edgeStop(); });
  // The handle is the only drag source: an item becomes draggable only while it is pressed.
  root.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.rail');
    if (handle && canEdit) { const row = handle.closest('.row.entry'); if (row) row.draggable = true; }
  });
  root.addEventListener('dragstart', (e) => {
    const li = e.target.closest && e.target.closest('.row.entry[draggable="true"]');
    if (!li) return;
    dragId = li.dataset.id;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    openJoints();
  });
  root.addEventListener('dragend', () => {
    edgeStop();
    for (const li of root.querySelectorAll('.row.entry.dragging, .row.entry[draggable="true"]')) { li.classList.remove('dragging'); li.draggable = false; }
    dragId = null;
    clearDrop();
  });
  root.addEventListener('dragover', (e) => {
    if (!dragId) return;
    edgeScroll(e.clientY);
    const spot = spotFrom(e.target, e.clientY);
    if (!spot) return;
    e.preventDefault();
    clearDrop(true);
    openJoints();
    showSpot(spot, dragId);
  });
  root.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    edgeStop();
    const spot = spotFrom(e.target, e.clientY);
    const id = dragId;
    clearDrop();
    if (spot) attempt(() => moveOwn(id, spot));
  });

  // Where an item of the plan is put when it is dropped. At a joint on the line: among the items there, before or after the one
  // under the pointer, else last. On a day: an item with no time is placed in the order of the day's untimed ones; an item with a
  // time keeps it when it goes to another day, and, dropped between two others on the same day, takes the end of the item before it
  // as its time (nothing changes if that one has no time). A marker between days only ever goes to a joint.
  function moveOwn(id, spot) {
    const item = plan.list().find((i) => i.id === id);
    if (!item || !spot) return null;
    const overId = spot.row && spot.row.dataset.id !== id ? spot.row.dataset.id : null;
    if (spot.after !== undefined) {
      const others = plan.atJoint(spot.after).filter((i) => i.id !== id);
      const at = overId ? others.findIndex((i) => i.id === overId) : -1;
      return plan.moveToJoint(id, spot.after, at >= 0 ? at + (spot.where === 'after' ? 1 : 0) : others.length);
    }
    if (item.kind === 'lane') return null;
    const date = spot.date;
    const sameDay = plan.dayOf(item) === date;
    if (item.time) {
      if (!sameDay || !overId) return sameDay ? null : plan.moveTo(id, date, 1e6);
      const rows = [...spot.el.querySelectorAll('.row.entry')].filter((r) => r.dataset.id !== id);
      const prevRow = spot.where === 'after' ? spot.row : rows[rows.indexOf(spot.row) - 1];
      const prev = prevRow && plan.list().find((i) => i.id === prevRow.dataset.id);
      if (!prev || !prev.time) return null;
      const end = minutesOfDay(prev.time) + (prev.minutes || 30);
      return end < 24 * 60 ? plan.updateItem(id, { time: hm(end) }) : null;
    }
    const dayUntimed = sortDay(plan.sortable().filter((i) => !i.time && plan.dayOf(i) === date && i.id !== id));
    let index = dayUntimed.length;
    if (overId) {
      const at = dayUntimed.findIndex((i) => i.id === overId);
      if (at >= 0) index = at + (spot.where === 'after' ? 1 : 0);
    }
    return plan.moveTo(id, date, index);
  }

  // A pointer a shared plan may hold: a private object is copied to the space first (title, position and address, through a module that
  // offers to save a place), and the copy's pointer is used.
  async function sharedRef(ref) {
    if (ref.scope !== 'person') return ref;
    const summary = await host.objects.resolve(ref);
    if (!summary || summary.error) throw new Error(`That private ${word('object')} could not be read.`);
    let add = null;
    try { add = (await host.actions.list()).find((a) => a.name === 'addPlace' && a.input && a.input.title); } catch (err) { add = null; }
    if (!add) throw new Error(`That ${word('object')} is private to you. Share it to the ${word('space')} first, then use the shared copy.`);
    const out = await host.actions.request(add.action, { title: summary.title, ...(summary.subtitle ? { address: summary.subtitle } : {}), ...(summary.place ? { lat: summary.place.lat, lng: summary.place.lng } : {}) }, { wait: true });
    if (out.status === 'done' && out.result && out.result.ok && out.result.ref) return out.result.ref;
    throw new Error(`It could not be shared to the ${word('space')}.`);
  }

  // Something dropped on the plan, by the pointer drag every module's objects share: one of this plan's own items (pressed on its
  // body) moves to the day or the joint it lands on; another module's object, or a summary the drag carried, is put there.
  if (host.objects && host.objects.dropTarget && canEdit) {
    const ownRef = (ref) => Boolean(ref) && ref.module === info.module.id && ref.kind === 'plan';
    const isLane = (ref) => { const it = plan.list().find((i) => i.id === ref.id); return Boolean(it) && it.kind === 'lane'; };
    // The pointer is in this module's own coordinates, a box in the page's.
    const pageY = (pt) => pt.y + host.rootElement.getBoundingClientRect().top;
    const spotAt = (pt) => spotFrom(host.objects.elementAt(pt), pageY(pt));
    // A marker between days is only ever on the line, so for it the joint nearest the pointer is the spot wherever the pointer is.
    const laneSpot = (pt, id) => {
      const y = pageY(pt);
      let best = null;
      for (const j of root.querySelectorAll('.joint')) {
        const r = j.getBoundingClientRect();
        const d = Math.abs(y - (r.top + r.height / 2));
        if (!best || d < best.d) best = { joint: j, d };
      }
      if (!best) return null;
      const spot = spotAt(pt);
      const inJoint = Boolean(spot) && spot.after === best.joint.dataset.after && Boolean(spot.row) && spot.row.dataset.id !== id;
      return { after: best.joint.dataset.after, el: best.joint, row: inJoint ? spot.row : null, where: inJoint ? spot.where : null };
    };
    const foreign = (ref, dragged) => (ref ? ref.module !== info.module.id : Boolean(dragged && dragged.summary));
    host.objects.dropTarget({
      over: (pt, ref, dragged) => {
        clearDrop(true);
        if (!ownRef(ref) && !foreign(ref, dragged)) return closeJoints();
        openJoints();
        if (ownRef(ref)) {
          const me = root.querySelector(`.row.entry[data-id="${ref.id}"]`);
          if (me) me.classList.add('dragging');
          showSpot(isLane(ref) ? laneSpot(pt, ref.id) : spotAt(pt), ref.id);
          return;
        }
        const spot = spotAt(pt);
        if (spot) spot.el.classList.add('drop-target');
      },
      leave: () => { clearDrop(true); setTimeout(closeJoints, 0); },
      drop: (ref, pt, dragged) => {
        const spot = ownRef(ref) && isLane(ref) ? laneSpot(pt, ref.id) : spotAt(pt);
        clearDrop();
        if (!spot) return;
        if (ownRef(ref)) { attempt(() => moveOwn(ref.id, spot)); return; }
        if (!foreign(ref, dragged)) return;
        const place = spot.after !== undefined ? { after: spot.after } : { date: spot.date };
        const target = spot.row && spot.row.dataset.id ? planRef(spot.row.dataset.id) : null;
        attempt(async () => {
          // What can be done with it here is the shared decision (host.objects.dropMenu). This module's own offer puts it
          // on the day, or at the joint on the line: a pointer as a link, a summary carried by the drag (an answer) as an item of
          // its own kind. The modules around add whatever they offer for an object of that kind, filled from the day and the
          // entry under the pointer. A private object (someone's own, in their profile) cannot be pointed at from a shared plan,
          // nor handed to another module here: only they could open it. So it is shared first, as a copy in the space, by
          // whichever module offers to save a place, and the plan points at the copy; nothing else is offered for it.
          const own = [{
            id: 'add',
            label: place.date ? `Put it on ${dayShort(place.date)}` : `Put it here, ${jointLabel(place.after).toLowerCase()}`,
            run: async (ctx) => (ref
              ? plan.addLink(await sharedRef(ref), place)
              : plan.addItem(ctx.summary.details
                // An object with details (plan-object-handoff.md): its fields filled, on the day it was dropped on.
                ? plan.fromObject({ ...ctx.summary, content: ctx.summary.content || ctx.summary.text }, place)
                : plan.fromSuggestion({ title: ctx.summary.title, kind: ctx.summary.kind, content: ctx.summary.text, place: ctx.summary.place && ctx.summary.place.name, ...place }))),
          }];
          if (ref && ref.scope === 'person') {
            const summary = await host.objects.resolve(ref);
            if (!summary || summary.error) throw new Error(`That private ${word('object')} could not be read.`);
            await own[0].run({ summary });
            return note('');
          }
          const chosen = await host.objects.dropMenu(dragged, pt, { context: { ...(place.date ? { date: place.date } : {}), ...(target ? { target } : {}) }, own, remember: target ? 'item' : place.date ? 'day' : 'joint' }); // 'item': the key a browser kept the choice under, kept
          note(chosen && chosen.id !== 'add' ? `${chosen.label}: done` : '');
        });
      },
    });
  }

  // An item of the trip can be dragged out to another module (a task links to it): pressing its body and moving. The
  // handle is the other drag (reordering), so a press there is left alone.
  if (host.objects && host.objects.draggable) {
    host.objects.draggable(root, (target) => {
      const li = target.closest && target.closest('.row.entry');
      if (!li || !li.dataset.id || target.closest('.rail, .menu-btn, button, input, select, textarea, a')) return null;
      const item = plan.list().find((i) => i.id === li.dataset.id);
      return item ? { kind: 'plan', id: item.id, label: item.title || 'Plan' } : null;
    });
  }

  // An item that follows another module's item (a poll): when that item reports how it turned out, keep the result on
  // the item and, when it says which day, put a stop there. Whichever page records it first does it, once.
  if (host.events && host.events.subscribe) {
    host.events.subscribe(async (e) => {
      const summary = e.data && typeof e.data.summary === 'string' ? e.data.summary.slice(0, 200) : '';
      if (!e.ref || !summary) return;
      const k = host.util.objectKey(e.ref);
      for (const item of plan.list().filter((i) => i.kind === 'link' && i.follow && i.ref && host.util.objectKey(i.ref) === k)) {
        const fired = Number(e.id) || Date.now();
        if (item.fired === fired) continue;
        try { await plan.updateItem(item.id, { result: summary, fired }); } catch (err) { continue; }
        const date = e.data.date && /^\d{4}-\d{2}-\d{2}$/.test(String(e.data.date)) ? String(e.data.date) : null;
        try {
          if (e.data.pick && e.data.pick.module) await plan.addLink(e.data.pick, { date });
          else if (date) await plan.addItem({ kind: 'stop', title: summary, date, notes: `From ${item.title || `a linked ${word('object')}`}` });
        } catch (err) { /* the result is kept either way */ }
      }
    });
  }

  // --- the editor ---------------------------------------------------------------------------------------------

  // A placeholder for the title of each kind of thing.
  const TITLES = { flight: 'Flight to Lisbon', train: 'Train to Porto', ferry: 'Ferry to the island', bus: 'Bus to the airport', car: 'Rental car', taxi: 'Taxi to the hotel', rideshare: 'Ride to the airport', shuttle: 'Shuttle to the airport', hotel: 'Hotel Avenida', restaurant: 'Dinner at Cervejaria Ramiro', cafe: 'Coffee at the pier', bar: 'Drinks at the rooftop', sight: 'Belem Tower', museum: 'The tile museum', attraction: 'Disneyland', tour: 'Walking tour', show: 'Fado night', note: 'Remember to...' };
  const option = (value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; };
  // The days a stay can check out, a list like the check-in's (#245): the day after it checks in and on, as many as a plan can be
  // long (checkoutDays; a stored day past that is added), so a stay can check out after the trip's last day. Until a check-out is
  // chosen (state.editing.checkOut, set by the person or an existing stay) it is the day after the check-in and follows it
  // (followDay); a chosen one is never written over. With no check-in day there is nothing to choose from.
  function checkoutOptions() {
    const select = $('f-checkout');
    const ed = state.editing;
    if (!select || !ed) return;
    const { date } = parsePlace($('f-date').value);
    const days = checkoutDays(date);
    const car = ed.tile === 'car'; // a rental car: the drop-off day, in days, and none until one is chosen
    select.replaceChildren(option('', days.length ? 'Not set' : car ? 'Choose the pick-up day first' : 'Choose the check-in day first'), ...days.map(({ value, n }) => option(value, car ? `${dayShort(value)} · ${n} day${n === 1 ? '' : 's'}` : `${dayShort(value)} · ${n} night${n === 1 ? '' : 's'}`)));
    setVal('f-checkout', followDay(date, car && ed.checkOut === undefined ? '' : ed.checkOut, 1));
  }
  // A rental car's Drop-off day, its length and its End time say one thing. A Drop-off day chosen sets the length from the End time
  // (the End time on that day), or clears it when there is no End time; a length or End time typed moves the Drop-off day to the
  // day it ends on (none when it ends the same day). `from` is what the person changed: 'drop' or 'length'.
  function carAgree(from) {
    const ed = state.editing;
    const select = $('f-checkout');
    if (!ed || ed.tile !== 'car' || !select || !$('f-time')) return;
    const l = LENS.out;
    const time = $(l.time).value;
    const { date } = parsePlace($('f-date').value);
    if (from === 'drop') {
      const drop = select.value;
      if (!drop || !date) return;
      const end = $(l.end).value;
      const n = Math.round((parseYmd(drop) - parseYmd(date)) / (24 * 60 * 60 * 1000));
      const total = time && end ? n * 24 * 60 + minutesOfDay(end) - minutesOfDay(time) : 0;
      setLength(l.hours, l.minutes, total > 0 && total <= MAX_MINUTES ? total : null);
      if (!(total > 0 && total <= MAX_MINUTES)) $(l.end).value = '';
      syncEnd(l);
      showArrival();
      return;
    }
    const len = lengthOf(l.hours, l.minutes);
    if (!len || !time || !date) return;
    const e = endOf(time, len);
    const day = e && e.days >= 1 ? daysLater(date, e.days) : '';
    ed.checkOut = day && [...select.options].some((o) => o.value === day) ? day : '';
    select.value = ed.checkOut;
  }
  // A journey's arrival on the ticket is shown as a day and a time, laid out as the departure is (#241): the day one of
  // arrivalDays around the leg's day (the same day first, the way it stays until a day is chosen: #242), and f-arrival, hidden,
  // holds what is stored (dated on a day, relative to the day it leaves while it has none).
  const arrivalDayLabel = (value, n) => (isYmd(value) ? `${dayShort(value)}${n ? ` (${laterText(n)})` : ''}` : n === 0 ? 'Same day' : laterText(n).replace(/^the/, 'The'));
  function arrivalFieldsFrom(leg) {
    const l = LEGS[leg];
    const daySel = $(l.arrivalDay);
    if (!daySel || !$(l.arrivalTime) || !$(l.arrival)) return;
    const base = parsePlace($(l.date).value).date;
    const parts = arrivalParts(base, $(l.arrival).value);
    daySel.replaceChildren(...arrivalDays(base).map(({ value, n }) => option(value, arrivalDayLabel(value, n))));
    setVal(l.arrivalDay, parts.day);
    $(l.arrivalTime).value = parts.time;
  }
  function arrivalFieldsInto(leg) {
    const l = LEGS[leg];
    if (!$(l.arrivalDay) || !$(l.arrivalTime) || !$(l.arrival)) return;
    $(l.arrival).value = arrivalJoin($(l.arrivalDay).value, $(l.arrivalTime).value);
  }
  // A length in the editor is hours and minutes side by side; stored, it stays whole minutes.
  const setLength = (hoursId, minutesId, total) => { const p = splitMinutes(total); $(hoursId).value = p.hours ?? ''; $(minutesId).value = p.minutes ?? ''; };
  const lengthOf = (hoursId, minutesId) => (shown(minutesId) ? joinMinutes(num(hoursId), num(minutesId)) : null);
  // A length typed past the longest an item can have (7 days), which would otherwise be cut when stored.
  const tooLong = (hoursId, minutesId) => shown(minutesId) && (num(hoursId) || 0) * 60 + (num(minutesId) || 0) > MAX_MINUTES;
  // ---- The start, the end it comes to and the length (#247) ----
  // Each leg has a start time and, for a stop, a car, a taxi, a ride or a marker, an end time with the length shown under it; a
  // journey with a ticket (a flight, train, ferry or bus) keeps a flight time of its own, since its arrival is in another time zone.
  // The length is what is stored (`minutes`), in the hours and minutes fields; the end is worked out from the start and the length,
  // and a typed end gives the length.
  const LENS = {
    out: { time: 'f-time', hours: 'f-hours', minutes: 'f-minutes', end: 'f-endTime', note: 'f-endNote', lenField: 'f-length-field', endField: 'f-end-field' },
    back: { time: 'f-back-time', hours: 'f-back-hours', minutes: 'f-back-minutes', end: 'f-back-endTime', note: 'f-back-endNote', lenField: 'f-back-length-field', endField: 'f-back-end-field' },
  };
  // A journey with a ticket has its own arrival day and time, so it keeps the flight time alone.
  const ticketed = () => { const ed = state.editing; return Boolean(ed && ['flight', 'train', 'ferry', 'bus'].includes(ed.tile)); };
  const endMode = () => !ticketed();
  const SAME_END = 'Same as the start, so there is no length.';
  const laterNote = (days) => (days === 1 ? '+1 (the next day)' : days > 1 ? `+${days} days` : '');
  // A moment, not a stretch of time: no length and no end.
  const noLengthTile = () => { const ed = state.editing; return Boolean(ed && ['block:meet-up', 'block:leave-by'].includes(ed.tile)); };
  // The end time from the start and the length in the form; the length is said under it.
  function syncEnd(l) {
    const end = $(l.end);
    if (end.value && end.value === $(l.time).value) { $(l.note).textContent = SAME_END; return; } // zero stays as typed until it is fixed
    const len = lengthOf(l.hours, l.minutes);
    const e = endOf($(l.time).value, len);
    end.value = e ? e.time : '';
    $(l.note).textContent = len ? [lengthText(len), laterNote(e ? e.days : 0)].filter(Boolean).join(' · ') : '';
  }
  // The length from the start and the end time typed; an end before the start is the next day.
  function endToLength(l) {
    const time = $(l.time).value;
    const end = $(l.end).value;
    const note = $(l.note);
    if (!end) { setLength(l.hours, l.minutes, null); note.textContent = ''; return; }
    const len = lengthBetween(time, end);
    if (len === null) { note.textContent = time ? '' : 'Add a start time first.'; return; }
    setLength(l.hours, l.minutes, len || null);
    note.textContent = len === 0 ? SAME_END : [lengthText(len), laterNote(endOf(time, len).days)].filter(Boolean).join(' · ');
  }
  // Show the flight time for a ticketed journey, else the end time (and keep it in step with the start and the length).
  function applyLenMode() {
    const tick = ticketed();
    const none = noLengthTile();
    for (const l of Object.values(LENS)) {
      const len = $(l.lenField);
      const end = $(l.endField);
      if (!len || !end) continue;
      len.hidden = !tick || none;
      end.hidden = tick || none;
      if (!end.hidden) syncEnd(l);
    }
  }
  // The sentence for an End time the form cannot take, or ''. Leg 'back' counts only for a round trip.
  function endProblem() {
    if (!endMode()) return '';
    for (const l of [LENS.out, roundTripOn() ? LENS.back : null]) {
      const field = l && $(l.endField);
      if (!field || field.hidden || !shown(l.end)) continue;
      const end = $(l.end).value;
      if (end && !$(l.time).value) return 'Add a start time first.';
      if (end && end === $(l.time).value) return 'The end time is the same as the start time. Pick a different end time.';
    }
    return '';
  }
  // Under a journey's departure: when it arrives, from its departure time and how long it takes.
  function showArrival() {
    applyLenMode();
    arrivalInto('f-arrives', 'f-time', 'f-hours', 'f-minutes');
    // The ticket's own arrival says it already.
    if ($('f-arrives') && $('f-arrival') && $('f-arrival').value) $('f-arrives').hidden = true;
    arrivalInto('f-back-arrives', 'f-back-time', 'f-back-hours', 'f-back-minutes');
    if ($('f-back-arrives') && $('f-back-arrival') && $('f-back-arrival').value) $('f-back-arrives').hidden = true;
  }
  function arrivalInto(outId, timeId, hoursId, minutesId) {
    const out = $(outId);
    if (!out) return;
    const t = $(timeId).value;
    const m = lengthOf(hoursId, minutesId);
    const a = t && m && !tooLong(hoursId, minutesId) ? arrivalOf({ time: t, minutes: m }) : null;
    out.textContent = a ? `Arrives ${[tt(a.time), laterText(a.days)].filter(Boolean).join(' ')}` : '';
    out.hidden = !a;
  }
  // What the shared fields are called for each kind of thing: a stay checks in, a flight departs, a taxi picks up.
  const FIELD_WORDS = {
    hotel: { date: 'Check in', time: 'Check-in time' },
    flight: { date: 'Departure day', time: 'Departure time', length: 'Flight time', operator: 'Airline', number: 'Flight number', from: 'Departs from', to: 'Arrives at' },
    train: { date: 'Departure day', time: 'Departure time', length: 'Travel time', operator: 'Train company', number: 'Train number', from: 'Departs from', to: 'Arrives at' },
    ferry: { date: 'Departure day', time: 'Departure time', length: 'Travel time', from: 'Departs from', to: 'Arrives at' },
    bus: { date: 'Departure day', time: 'Departure time', length: 'Travel time', from: 'Departs from', to: 'Arrives at' },
    shuttle: { date: 'Departure day', time: 'Departure time', length: 'Travel time', from: 'Departs from', to: 'Arrives at' },
    car: { date: 'Pick-up day', time: 'Pick-up time', operator: 'Rental company', checkout: 'Drop-off day' },
    taxi: { time: 'Pick-up time', length: 'Travel time', from: 'Pick up at', to: 'Drop off at' },
    rideshare: { time: 'Pick-up time', length: 'Travel time', from: 'Pick up at', to: 'Drop off at' },
  };
  const FIELD_DEFAULTS = { checkout: 'Check out', date: 'When', time: 'Start time', length: 'How long', operator: 'Company', number: 'Number', from: 'From', to: 'To' };
  // The people of the space as chips (a tick box each) for "Whose is it", and as chips with a radio each for "Paid by".
  function personChip(type, name, value, checked, text) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = type;
    if (name) input.name = name;
    input.value = value;
    input.checked = checked;
    label.append(input, document.createTextNode(text));
    return label;
  }
  function ownerBoxes(selected) {
    const box = $('f-owners');
    box.replaceChildren(...state.people.map((p) => personChip('checkbox', '', p.key, selected.includes(p.key), p.name)));
  }
  function paidByOptions(selected) {
    const box = $('f-paidBy');
    const want = selected || '';
    box.replaceChildren(...[{ key: '', name: 'Nobody yet' }, ...state.people].map((p) => personChip('radio', 'paidBy', p.key, p.key === want, p.name)));
    if (!box.querySelector('input:checked')) box.querySelector('input').checked = true;
  }
  const paidByValue = () => { const on = $('f-paidBy').querySelector('input:checked'); return on ? on.value : ''; };
  // The value of a field, or '' when the chosen type does not show it (so a field that is hidden is never saved).
  const shown = (id) => { const w = $(id) && $(id).closest('[data-types]'); return !w || w.classList.contains('on-type'); };
  const get = (id) => (shown(id) ? $(id).value.trim() : '');
  const num = (id) => (shown(id) && $(id).value ? Number($(id).value) : null);
  const setVal = (id, v) => { const el = $(id); if (!el) return; if (el.tagName === 'SELECT' && v && ![...el.options].some((o) => o.value === String(v))) { const o = document.createElement('option'); o.value = String(v); o.textContent = String(v); el.append(o); } el.value = v == null ? '' : String(v); };

  // Choosing a kind of thing shows the fields it needs (each field wrapper lists its types in data-types).
  function applyType(tile) {
    const ed = state.editing;
    if (!ed) return;
    ed.tile = tile;
    const key = tile.startsWith('block:') ? 'block' : tile.startsWith('lane:') ? 'lane' : tile; // every marker shows the same fields
    for (const el of $('form').querySelectorAll('[data-types]')) el.classList.toggle('on-type', el.dataset.types.split(/\s+/).includes(key));
    // A row that shows one field for this kind gives it the whole row, so no gap is left beside it.
    for (const row of $('form').querySelectorAll('.sdk-form-row[data-grow]')) {
      const fields = [...row.children].filter((c) => c.classList.contains('sdk-field') && !c.matches('[data-types]:not(.on-type)'));
      for (const f of row.querySelectorAll(':scope > .sdk-field')) f.classList.toggle('sdk-full', fields.length === 1 && f === fields[0]);
    }
    $('f-title').required = key !== 'block' && key !== 'lane'; // a marker's label is optional: the type names it
    // A marker is one kind in the picker; Where decides whether it is in a day (block) or between days (lane), so the
    // list has no "Unscheduled". A marker that was unplaced goes to the first day; one whose Where says otherwise
    // takes the tile Where says.
    const marker = key === 'block' || key === 'lane';
    const unplaced = $('f-date').value === 'd:';
    // An existing marker stored with no day keeps "Unscheduled", so its Where is not left blank.
    const keepUnplaced = Boolean(ed.id && ed.unplaced);
    placeOptions($('f-date'), { placedOnly: marker && !keepUnplaced });
    if (marker && !keepUnplaced && unplaced && [...$('f-date').options].some((o) => o.value.startsWith('d:'))) $('f-date').value = [...$('f-date').options].find((o) => o.value.startsWith('d:')).value;
    if (marker && tileAt(kindOf(tile), $('f-date').value) !== tile) return applyType(tileAt(kindOf(tile), $('f-date').value));
    // The same fields in each kind's own words (a stay's day is its check-in, a flight's time its departure).
    const labels = { ...FIELD_DEFAULTS, ...(FIELD_WORDS[key] || {}) };
    for (const [name, id] of [['date', 'f-date-label'], ['time', 'f-time-label'], ['length', 'f-minutes-label'], ['operator', 'f-operator-label'], ['number', 'f-number-label'], ['from', 'f-from-label'], ['to', 'f-to-label'], ['checkout', 'f-checkout-label'], ['time', 'f-back-time-label'], ['length', 'f-back-minutes-label'], ['number', 'f-back-number-label'], ['from', 'f-back-from-label'], ['to', 'f-back-to-label']]) if ($(id)) $(id).textContent = labels[name];
    if ($('f-checkout') && ed.tile) checkoutOptions();
    roundTripShown();
    showArrival();
    if (key === 'flight') seedLookup('out');
    if (kindField) kindField.set(kindOf(tile));
    $('f-title').placeholder = key === 'block' ? markerType(tile.slice(6)).label : key === 'lane' ? markerType(tile.slice(5)).label : TITLES[tile] || '';
  }
  // The kind picker (host.ui.kindPicker in #f-types): what kind of thing it is, one row with the kind's icon in its colour,
  // typing to filter, the kinds in groups. A kind's colour is its card's family (the accent turned by TURNS, the same
  // expression the cards use, or the plain mix where the browser has no relative colours); a marker type's its own colour
  // from the settings. Each marker type is one kind (`marker:<type>`); Where decides block or lane (tileAt).
  const TONE = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('color', 'oklch(from red l c h)')
    ? (turn) => `oklch(from var(--accent) l calc(c * 0.95) calc(h + ${turn}))`
    : () => 'color-mix(in srgb, var(--accent) 65%, var(--text))';
  // Other words a kind is found by when typing.
  const KIND_WORDS = { flight: ['plane', 'air', 'fly'], train: ['rail'], ferry: ['boat', 'ship'], bus: ['coach'], car: ['rental', 'drive', 'hire'], taxi: ['cab'], rideshare: ['uber', 'lyft', 'ride'], shuttle: ['van'], hotel: ['hotel', 'rental', 'hostel', 'camp', 'lodging', 'sleep'], restaurant: ['dinner', 'lunch', 'eat', 'meal', 'food'], cafe: ['coffee', 'breakfast', 'brunch'], bar: ['drinks', 'pub', 'cocktails'], sight: ['see', 'landmark', 'beach', 'shop', 'spa'], museum: ['gallery', 'exhibit'], attraction: ['theme park', 'park', 'zoo', 'aquarium', 'disney', 'rides'], tour: ['hike', 'walk', 'guide'], show: ['theater', 'theatre', 'concert', 'tickets', 'game'], note: ['memo', 'reminder'] };
  const kindOption = (t, label) => ({ id: t, label: label || KICKERS[t], icon: t === 'hotel' ? 'bed' : t === 'note' ? 'note-sticky' : BADGES[t], color: TONE(TURNS[t] || 0), words: KIND_WORDS[t] });
  function kindGroups() {
    return [
      { label: 'Getting there', options: JOURNEY_TILES.map((t) => kindOption(t)) },
      { label: 'Stay', options: [kindOption('hotel', 'Stay')] },
      { label: 'Eat and drink', options: ['restaurant', 'cafe', 'bar'].map((t) => kindOption(t)) },
      { label: 'See and do', options: ['sight', 'museum', 'attraction', 'tour', 'show'].map((t) => kindOption(t)) },
      { label: 'Markers', options: blockTypes().map((t) => ({ id: `marker:${t.id}`, label: t.label, icon: t.icon, color: t.color, words: ['marker', 'time'] })) },
      { label: 'Other', options: [kindOption('note', 'Note')] },
    ];
  }
  let kindField = null; // the open form's picker (the form is cloned anew on each open)
  function addKindPicker(value) {
    const box = $('f-types');
    kindField = box ? host.ui.kindPicker(box, {
      label: 'What is it',
      groups: kindGroups(),
      value: value || 'sight',
      start: value ? undefined : 'recent', // a new object: the kind chosen last in this browser, else Sight
      recent: { key: 'add', max: 4 },
      // A kind the list no longer has (a marker type removed in the settings) comes back as its own id: the fields stay
      // those of the stored type, which is kept on save unless the person picks another kind.
      onChange: (id) => applyType(tileAt(id, $('f-date').value)),
    }) : null;
    return kindField;
  }
  // How you get there: the segmented switch (a radio group; the arrows move and choose, the SDK's keyboard). The chosen one is
  // the one Tab stop, the first while none is; pressing the chosen one again clears it (the leg has no way set).
  const setModeOn = (b, on) => { b.setAttribute('aria-checked', String(on)); };
  const roveModes = () => {
    const all = [...$('f-travelMode').querySelectorAll('.mode')];
    const stop = all.find((m) => m.getAttribute('aria-checked') === 'true') || all[0];
    for (const m of all) m.tabIndex = m === stop ? 0 : -1;
  };
  const chosenMode = () => { const on = $('f-travelMode') && $('f-travelMode').querySelector('.mode[aria-checked="true"]'); return on ? on.dataset.mode : null; };

  // The form opens as the SDK's editor window (host.ui.editor): over everything, sized to the form (large for an item, medium
  // for the plan), a sheet on a phone. What the form held when it opened, as text, so Escape, Close and Cancel ask "Discard
  // your changes?" only after something changed. Every field in the form, the kind chosen and the way of getting there.
  const formSnapshot = () => {
    const form = $('form');
    const ed = state.editing;
    if (!form || !ed) return '';
    const fields = [...form.querySelectorAll('input, select, textarea')].map((el, i) => `${el.id || el.name || i}${el.type === 'radio' ? `:${el.value}` : ''}=${el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value}`);
    return `${ed.tile}|${chosenMode()}|${ed.placeRef ? host.util.objectKey(ed.placeRef) : ''}|${fields.join('\n')}`;
  };
  const editorOpened = () => { if (state.editing) state.editing.opened = formSnapshot(); };
  const editorDirty = () => Boolean(state.editing && state.editing.opened !== undefined && formSnapshot() !== state.editing.opened);
  // Where focus goes when the form closes: the control that opened it, or, once a save redrew the plan, the menu button of the
  // object it edited or added, or the "..." of the day it was added to. Nothing found leaves it to the SDK (what had focus before).
  const editorReturn = () => {
    const ed = state.editingFrom;
    if (!ed) return null;
    if (ed.el && ed.el.isConnected) return ed.el;
    if (ed.id) { const row = objectControl(ed.id); if (row) return row; }
    if (ed.date) { const day = root.querySelector(`.sdk-day[data-day="${CSS.escape(ed.date)}"] [data-action="day-menu"]`); if (day) return day; }
    return null;
  };
  // --- the stop's Place (plan-places-and-maps.md): the name typed stays valid on its own; a Place from Places can be linked to it ---
  // The editor holds the link in state.editing.placeRef until Save; the plan records it (setLinks) when the stop is saved, and removes it
  // when it is unlinked or the stop goes. Save as a place makes a Place from the typed name (the Places action addPlace, when a module offers it).
  let placeAction;
  async function addPlaceAction() {
    if (placeAction !== undefined) return placeAction;
    try { placeAction = (await host.actions.list()).find((a) => a.name === 'addPlace' && a.input && a.input.title) || null; } catch (err) { placeAction = null; }
    return placeAction;
  }
  function placeFieldSync() {
    const ed = state.editing;
    if (!ed || !$('f-place')) return;
    const linked = Boolean(ed.placeRef);
    const summary = linked ? plan.summaries.get(host.util.objectKey(ed.placeRef)) : null;
    const gone = Boolean(linkState(summary));
    hide($('f-place-linked'), !linked);
    fill($('f-place-linked'), { title: gone ? 'A place you cannot open' : (summary && summary.title) || ed.placeTitle || $('f-place').value || 'Place' });
    hide($('f-place-open'), !linked || gone);
    hide($('f-place-unlink'), !linked);
    hide($('f-place-save'), linked || !$('f-place').value.trim() || !ed.canSavePlace);
    $('f-place-pick').textContent = linked ? 'Pick another' : 'Pick from Places';
  }
  function placeFieldInit(item) {
    const ed = state.editing;
    if (!ed || !$('f-place')) return;
    ed.placeRef = item && item.placeRef ? item.placeRef : null;
    ed.placeTitle = '';
    ed.canSavePlace = false;
    setVal('f-place', item ? item.place : '');
    const say = (text) => { $('f-place-hint').textContent = text || ''; };
    placeFieldSync();
    if (ed.placeRef && !plan.summaries.has(host.util.objectKey(ed.placeRef))) plan.refreshSummaries().then(placeFieldSync).catch(() => {});
    addPlaceAction().then((a) => { if (state.editing === ed) { ed.canSavePlace = Boolean(a); placeFieldSync(); } });
    $('f-place').addEventListener('input', () => { say(''); placeFieldSync(); });
    $('f-place-pick').addEventListener('click', () => attempt(async () => {
      say('');
      const picked = await host.objects.pick({ modules: ['places'], kinds: ['place'], title: 'Pick a place' });
      if (!picked || state.editing !== ed) return;
      const ref = await sharedRef(picked);
      const summary = await host.objects.resolve(ref);
      if (state.editing !== ed) return;
      ed.placeRef = ref;
      ed.placeTitle = summary && !summary.error ? summary.title : '';
      if (summary && !summary.error) {
        plan.summaries.set(host.util.objectKey(ref), summary);
        $('f-place').value = summary.title;
        if (summary.subtitle && !$('f-address-stop').value.trim()) $('f-address-stop').value = summary.subtitle;
      }
      placeFieldSync();
      $('f-place-pick').focus();
    }));
    $('f-place-save').addEventListener('click', () => attempt(async () => {
      const add = await addPlaceAction();
      const name = $('f-place').value.trim();
      if (!add || !name) return;
      say('Saving...');
      $('f-place-save').disabled = true;
      try {
        const address = $('f-address-stop').value.trim();
        const out = await host.actions.request(add.action, { title: name, ...(address ? { address } : {}) }, { wait: true });
        if (state.editing !== ed) return;
        if (out.status === 'done' && out.result && out.result.ok !== false && out.result.ref) {
          ed.placeRef = out.result.ref;
          ed.placeTitle = name;
          say('Saved as a place.');
        } else say('Places did not answer. Open Places, then try again.');
      } finally { $('f-place-save').disabled = false; }
      placeFieldSync();
    }));
    $('f-place-open').addEventListener('click', () => { if (ed.placeRef) host.objects.open(ed.placeRef).catch((err) => say(err.message)); });
    $('f-place-unlink').addEventListener('click', () => { ed.placeRef = null; ed.placeTitle = ''; say('Unlinked. The name stays.'); placeFieldSync(); $('f-place').focus(); });
  }

  const editor = host.ui.editor($('editor'), {
    size: 'large',
    isDirty: editorDirty,
    // The SDK asks `returnTo` after this, so where focus goes (state.editingFrom) is kept until the next open.
    onClose: () => { if (kindField) kindField.close(); kindField = null; $('editor').replaceChildren(); state.editing = null; },
  });

  // The time zones the browser knows, in a select, with the trip's own chosen (else the browser's).
  // The first choice, empty, is no zone for the trip: each person's copies are read in their own.
  function zoneSelect(select, value) {
    let names = [];
    try { names = Intl.supportedValuesOf('timeZone'); } catch (err) { names = []; }
    if (value && !names.includes(value)) names = [value, ...names];
    if (!names.includes('UTC')) names.push('UTC');
    select.replaceChildren(option('', 'Each person\'s own time zone'), ...names.map((n) => option(n, n.replace(/_/g, ' '))));
    select.value = value || '';
  }

  // `place` for a new item: `{ date }` a day, `{ after }` a joint on the line; none is the head of the line. `from` is the control
  // that opened the form (focus goes back to it on close).
  function openEditor(mode, item, place, from) {
    if (!canEdit) return;
    const isLink = Boolean(item && item.kind === 'link');
    state.editing = { mode, id: item ? item.id : null, place: place || null, version: item ? plan.versionOf(item.id) : null, tile: 'sight', isLink, unplaced: Boolean(item && item.kind === 'block' && !item.date), checkOut: item && (item.kind === 'stay' || item.mode === 'car') ? item.checkOut || '' : undefined };
    state.editingFrom = { el: from || null, id: item ? item.id : null, date: place && place.date ? place.date : null };
    // The plan's own form is the medium window; an item's the large one (the SDK sets the size once, so it is switched here).
    $('editor').classList.toggle('sdk-editor-large', mode !== 'trip');
    $('editor').classList.toggle('sdk-editor-medium', mode === 'trip');
    $('editor').replaceChildren(clone(mode === 'trip' ? 'tpl-editor-trip' : 'tpl-editor2'));
    $('f-error').hidden = true;
    if (mode === 'trip') {
      const t = plan.trip || {};
      $('editor-title').textContent = plan.phased() ? 'The trip' : 'The dates';
      for (const f of $('form').querySelectorAll('[data-dates]')) f.hidden = plan.phased();
      zoneSelect($('f-tz'), t.tz);
      $('f-start').value = t.start || '';
      $('f-end').value = t.end || '';
      host.ui.datePicker($('f-start'), { clearable: true });
      host.ui.datePicker($('f-end'), { clearable: true });
      host.ui.currencySelect($('f-currency'), { value: t.currency || '', empty: true }); // "" is the server's currency
      $('f-by').textContent = '';
    } else {
      $('editor-title').textContent = item ? 'Edit' : 'Add to the plan';
      hide($('f-types'), Boolean(item) && isLink);
      hide($('f-delete'), !item);
      // The kind: an existing object's own, the one the day's "..." or a joint's + chose, else the last kind chosen in this
      // browser (the picker remembers), else Sight. Where is set first, since it decides a marker's block or lane.
      const preset = item ? tileOf(item) || 'sight' : place && place.tile;
      // The times follow the environment's clock (12 or 24 hours), not the browser's own; the stored value stays "HH:MM".
      for (const tid of ['f-time', 'f-endTime', 'f-checkOutTime', 'f-arrival-time', 'f-back-time', 'f-back-endTime', 'f-back-arrival-time']) if ($(tid)) host.ui.timeField($(tid));
      dayField($('f-date'));
      dayField($('f-back-date'));
      dayField($('f-checkout'), { checkout: true });
      arrivalField($('f-arrival-day'));
      arrivalField($('f-back-arrival-day'));
      lookupDayFields();
      for (const unit of $('form').querySelectorAll('[data-slot="currency"]')) unit.textContent = planCurrency() || host.locale().currency || '';
      placeOptions($('f-date'));
      setPlaceMenu($('f-date'), item ? placeOf(item) : place);
      const picker = addKindPicker(preset ? kindOf(preset) : undefined);
      applyType(preset || tileAt((picker && picker.value) || 'sight', $('f-date').value));
      if (preset) setPlaceMenu($('f-date'), item ? placeOf(item) : place);
      fillPhaseSelect(item);
      $('f-date').addEventListener('change', syncPhaseField);
      // A marker follows Where: a day stores block, a joint lane. An existing marker keeps its kind until Where changes.
      $('f-date').addEventListener('change', () => { const ed = state.editing; if (!ed || !ed.tile) return; const want = tileAt(kindOf(ed.tile), $('f-date').value); if (want !== ed.tile) applyType(want); });
      checkoutOptions();
      const v = item || {};
      setVal('f-checkOutTime', v.checkOutTime);
      $('f-time').value = v.time || '';
      setLength('f-hours', 'f-minutes', v.minutes);
      // The arrival as on the ticket: dated on its day, else relative to the day it leaves ("06:30+1", "The next day" in the list).
      setVal('f-arrival', v.arrives ? (v.arrives.length === 16 || !v.date ? v.arrives : datedArrives(v.date, v.arrives)) : '');
      arrivalFieldsFrom('out');
      state.editing.dayWas = parsePlace($('f-date').value).date; // a change of day moves the ticket's arrival along
      hide($('f-pinned-row'), !isLink);
      if ($('f-pinned')) $('f-pinned').checked = Boolean(v.pinned);
      $('f-title').value = item ? item.title : '';
      for (const f of ['operator', 'number', 'fromCode', 'toCode', 'from', 'to', 'pickup', 'dropoff', 'terminal', 'platform', 'carriage', 'seat', 'roomType', 'partySize', 'reservationName', 'admissionCount', 'guests']) setVal(`f-${f}`, v[f]);
      setVal('f-travelClass', v.travelClass);
      setVal('f-gate', v.gate);
      setVal('f-gate-show', v.gate);
      setVal('f-address', v.address);
      setVal('f-address-stop', v.address);
      placeFieldInit(item);
      setVal('f-confirm', v.confirm);
      $('f-notes').value = v.notes || '';
      $('f-cost').value = v.cost || '';
      $('f-estimate').value = v.estimate || '';
      paidByOptions(item ? item.paidBy : info.user.key);
      ownerBoxes(v.owners || []);
      for (const b of $('f-travelMode').querySelectorAll('.mode')) setModeOn(b, b.dataset.mode === v.travelMode);
      roveModes();
      setLength('f-travelHours', 'f-travelMinutes', v.travelMinutes);
      openReturn(item);
      showLookups();
      seedLookup('out');
      seedLookup('back');
      showArrival();
      $('f-by').textContent = item && item.by ? `Added by ${item.by}` : '';
    }
    hydrate($('editor'));
    editorOpened();
    // A new object with no kind chosen for it starts in the kind field, so typing starts the search.
    editor.open({ focus: mode !== 'trip' && !item && !(place && place.tile) && kindField ? kindField.input : $('f-title'), returnTo: editorReturn });
  }
  function fillPhaseSelect(item) {
    const select = $('f-phase');
    if (!select) return;
    const phases = templatePhases();
    select.replaceChildren();
    // "Unscheduled" (no phase) is the default choice, and the first.
    for (const p of [{ id: '', label: 'Unscheduled' }, ...phases]) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.label;
      select.append(o);
    }
    select.value = item && item.phase && phases.some((p) => p.id === item.phase) ? item.phase : '';
    syncPhaseField();
  }
  function syncPhaseField() {
    const row = $('f-phase-row');
    if (!row || !$('f-date')) return;
    const place = parsePlace($('f-date').value);
    const undated = !(place && place.date) && !(place && place.after !== null && place.after !== undefined);
    hide(row, !undated || !templatePhases().length);
  }

  // Either leg of a round trip opens the one editor with both legs; the outbound's fields are the main ones.
  const openItemEditor = (id, from) => {
    const item = plan.list().find((i) => i.id === id);
    if (!item) return;
    openEditor('item', plan.outboundFor(item) || item, null, from);
    if (state.editing) state.editing.openedId = id;
    if (state.editingFrom) state.editingFrom.id = id;
  };

  // --- a round trip in the editor ---
  // The switch shows the return's fields; an existing pair fills them from its return.
  const roundTripOn = () => Boolean($('f-roundtrip')) && shown('f-roundtrip') && $('f-roundtrip').checked;
  function roundTripShown() {
    const ed = state.editing;
    if (!$('f-roundtrip') || !ed) return;
    const on = roundTripOn();
    hide($('f-return'), !on);
    hide($('f-booking-both'), !on);
    hide($('f-roundtrip-note'), !ed.removeReturn);
    $('f-roundtrip-note').textContent = ed.removeReturn ? 'The return leg is deleted when you save.' : '';
    $('f-back-title').placeholder = backTitle();
  }
  // A return's title when none is given: "Flight to London", else "Return: <the outbound's title>".
  function backTitle() {
    const kicker = KICKERS[state.editing && fromTile(state.editing.tile).mode] || 'Return';
    const to = $('f-back-to').value.trim() || $('f-back-toCode').value.trim();
    return to ? `${kicker} to ${to}` : `Return: ${$('f-title').value.trim() || 'the outbound'}`;
  }
  function openReturn(item) {
    const ed = state.editing;
    const back = item && item.kind === 'journey' ? plan.returnFor(item.id) : null;
    ed.backId = back ? back.id : null;
    ed.backVersion = back ? plan.versionOf(back.id) : null;
    ed.removeReturn = false;
    placeOptions($('f-back-date'));
    $('f-roundtrip').checked = Boolean(back);
    if (back) {
      $('f-back-title').value = back.title;
      $('f-back-date').value = placeValue(placeOf(back));
      $('f-back-time').value = back.time || '';
      setLength('f-back-hours', 'f-back-minutes', back.minutes);
      for (const f of ['number', 'fromCode', 'toCode', 'from', 'to', 'seat']) setVal(`f-back-${f}`, back[f]);
      // The return's arrival on the ticket, as the outbound's.
      setVal('f-back-arrival', back.arrives ? (back.arrives.length === 16 || !back.date ? back.arrives : datedArrives(back.date, back.arrives)) : '');
    }
    arrivalFieldsFrom('back');
    ed.backDayWas = parsePlace($('f-back-date').value).date; // a change of the return's day moves its arrival along
    const extra = item ? plan.extraReturns(item.id) : [];
    hide($('f-extra'), !extra.length);
    roundTripShown();
  }
  // Turning the switch on for a new return fills it from the outbound, the ends swapped, on the trip's last day (or the outbound's
  // own when that is later). Turning it off on an existing pair asks first; the return is deleted when the editor saves.
  function roundTripSwitched(input) {
    const ed = state.editing;
    if (!ed) return;
    if (input.checked) {
      ed.removeReturn = false;
      if (!ed.backId && !$('f-back-from').value && !$('f-back-to').value && !$('f-back-fromCode').value && !$('f-back-toCode').value) {
        $('f-back-from').value = $('f-to').value;
        $('f-back-to').value = $('f-from').value;
        $('f-back-fromCode').value = $('f-toCode').value;
        $('f-back-toCode').value = $('f-fromCode').value;
        const days = plan.days();
        const { date } = parsePlace($('f-date').value);
        const last = days[days.length - 1];
        $('f-back-date').value = placeValue({ date: date && last && date > last ? date : last || date });
        ed.backDayWas = parsePlace($('f-back-date').value).date;
        arrivalFieldsFrom('back');
      }
      seedLookup('back');
      return roundTripShown();
    }
    if (!ed.backId) return roundTripShown();
    input.checked = true; // until the question is answered
    host.menu.show({
      id: 'remove-return',
      anchor: input.closest('label'),
      items: [
        { id: 'remove', label: 'Remove the return leg', hint: 'It is deleted when you save.', icon: 'trash', danger: true, onClick: () => { input.checked = false; ed.removeReturn = true; roundTripShown(); } },
        { id: 'keep', label: 'Keep it', icon: 'xmark', onClick: () => {} },
      ],
    });
  }
  // The return's own fields, from the editor. It shares the outbound's way of travelling, company, class and people.
  function returnFields(out) {
    return {
      kind: 'journey',
      confirm: '', // the outbound holds the booking details
      cost: null,
      estimate: null,
      paidBy: '',
      category: 'travel',
      mode: out.mode,
      title: $('f-back-title').value.trim() || backTitle(),
      ...placeFields(parsePlace($('f-back-date').value)),
      time: $('f-back-time').value || null,
      minutes: lengthOf('f-back-hours', 'f-back-minutes'),
      arrives: get('f-back-arrival') || null,
      number: numberToSave(out.mode, get('f-back-number')),
      seat: get('f-back-seat'),
      fromCode: get('f-back-fromCode'),
      toCode: get('f-back-toCode'),
      from: get('f-back-from'),
      to: get('f-back-to'),
      operator: out.operator || '',
      travelClass: out.travelClass || '',
      owners: out.owners || [],
    };
  }
  // Whether a patch would change what is stored for an item.
  const changes = (item, patch) => JSON.stringify(cleanItem({ ...item, ...patch, id: item.id })) !== JSON.stringify(item);
  // After Save or Delete: closes at once, nothing asked (the SDK's close event clears the form). Cancel goes the way the SDK's
  // own Close does (editor.cancel), so it asks "Discard your changes?" after typing. Escape inside the window is the SDK's;
  // here it closes the menu.
  const closeEditor = () => editor.close();
  const cancelEditor = () => editor.cancel();
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  // --- the flight lookup (plan-flight-lookup.md) -----------------------------------------------------------------------
  // A row at the top of a flight (and one in its return leg): a number, a day and Find. The server answers from the flights
  // saved on it before; one found fills the form at once, several give a list to choose from. Shown only while the server offers
  // it (host.lookup.available: the environment's Suggest flights from earlier trips setting).
  const LEGS = {
    out: { pre: 'f-', date: 'f-date', time: 'f-time', hours: 'f-hours', minutes: 'f-minutes', number: 'f-number', fromCode: 'f-fromCode', from: 'f-from', toCode: 'f-toCode', to: 'f-to', operator: 'f-operator', terminal: 'f-terminal', arrival: 'f-arrival', arrivalDay: 'f-arrival-day', arrivalTime: 'f-arrival-time', title: 'f-title', was: 'dayWas' },
    back: { pre: 'f-back-', date: 'f-back-date', time: 'f-back-time', hours: 'f-back-hours', minutes: 'f-back-minutes', number: 'f-back-number', fromCode: 'f-back-fromCode', from: 'f-back-from', toCode: 'f-back-toCode', to: 'f-back-to', arrival: 'f-back-arrival', arrivalDay: 'f-back-arrival-day', arrivalTime: 'f-back-arrival-time', was: 'backDayWas' },
  };
  // The look-up's day is a date field like the others, with the list of the plan's days (none: a flight can be from before the plan).
  const lookupPickers = {};
  function lookupDayFields() {
    for (const leg of Object.keys(LEGS)) {
      const input = lookupEl(leg, 'date');
      lookupPickers[leg] = null;
      if (!input) continue;
      lookupPickers[leg] = host.ui.datePicker(input, choosableDays().length
        ? { list: { label: 'Pick from the list', items: (set) => dayMenuItems({ current: { date: input.value || null }, choose: (x) => set(x.date), days: choosableDays(), none: null, joints: false }) } }
        : {});
    }
  }
  const lookupEl = (leg, part) => $(`${LEGS[leg].pre}lookup${part ? `-${part}` : ''}`);
  const legOfLookup = (el) => { const row = el && el.closest('.lookup'); return row ? (row.id === 'f-back-lookup' ? 'back' : 'out') : null; };
  // Show or hide both rows as the server offers the lookup or not.
  function showLookups() {
    for (const leg of Object.keys(LEGS)) { const row = lookupEl(leg); if (row) row.hidden = !state.flightLookup; }
  }
  // The row starts from the form's own number and day, when it has them and the row is still empty.
  function seedLookup(leg) {
    const l = LEGS[leg];
    const number = lookupEl(leg, 'number');
    const date = lookupEl(leg, 'date');
    if (!number || !date || !$(l.number) || !$(l.date)) return;
    if (!number.value) number.value = $(l.number).value.trim();
    if (!date.value) { date.value = parsePlace($(l.date).value).date || ''; if (lookupPickers[leg]) lookupPickers[leg].refresh(); }
  }
  function lookupSay(leg, text, bad) {
    const msg = lookupEl(leg, 'msg');
    if (!msg) return;
    msg.textContent = text || '';
    msg.className = `${bad ? 'sdk-error' : 'sdk-hint'} lookup-msg`;
  }
  function closeLookupList(leg) {
    const list = lookupEl(leg, 'list');
    if (!list) return;
    list.hidden = true;
    list.querySelector('.lookup-choices').replaceChildren();
  }
  // Whether the server offers the lookup here (the environment's setting), asked at the start and on a change of settings.
  function checkFlightLookup() {
    if (!canEdit || !host.lookup) return;
    host.lookup.available('flight').then((on) => { state.flightLookup = on; showLookups(); });
  }
  const lookupFound = {}; // the flights the last Find answered, by leg: { out: [...], back: [...] }
  // "flies on this day of the week", or the month it was last seen ("last seen Oct 2026").
  function lookupWhen(entry) {
    if (entry.sameWeekday) return 'flies on this day of the week';
    const m = /^(\d{4})-(\d{2})/.exec(String(entry.lastSeen || ''));
    return m ? `last seen ${new Date(+m[1], +m[2] - 1, 1).toLocaleDateString([], { month: 'short', year: 'numeric' })}` : '';
  }
  async function findFlight(leg) {
    const numberInput = lookupEl(leg, 'number');
    const dateInput = lookupEl(leg, 'date');
    const find = lookupEl(leg, 'find');
    if (!numberInput || !state.editing || find.disabled) return;
    closeLookupList(leg);
    const number = flightNumberOf(numberInput.value);
    if (!number) { lookupSay(leg, 'Enter the airline code and number, like WN 2483.', true); return numberInput.focus(); }
    if (!dateInput.value) { lookupSay(leg, 'Choose the day it leaves.', true); return dateInput.focus(); }
    find.disabled = true;
    lookupEl(leg).setAttribute('aria-busy', 'true');
    lookupSay(leg, 'Looking...');
    let flights;
    try {
      flights = ((await host.lookup.flight(number, dateInput.value)) || {}).flights || [];
    } catch (err) {
      const said = err && err.message;
      if (said === 'bad number') lookupSay(leg, 'Enter the airline code and number, like WN 2483.', true);
      else if (said === 'bad date') lookupSay(leg, 'Choose the day it leaves.', true);
      else if (err && err.status === 429) lookupSay(leg, said, true); // the server's own sentence, with the template's word for module
      else lookupSay(leg, "Flight lookup isn't working right now. Fill it in by hand.", true);
      return;
    } finally {
      if (find.isConnected) { find.disabled = false; lookupEl(leg).removeAttribute('aria-busy'); }
    }
    if (!find.isConnected) return; // the editor closed meanwhile
    if (!flights.length) return lookupSay(leg, `No flight ${number} saved here yet. Fill it in, and it will be suggested next time.`);
    if (flights.length === 1) return fillFromLookup(leg, flights[0]);
    lookupSay(leg, '');
    lookupFound[leg] = flights;
    const list = lookupEl(leg, 'list');
    const ul = list.querySelector('.lookup-choices');
    ul.replaceChildren(...flights.map((f, i) => {
      const li = clone('tpl-lookup-choice');
      fill(li, { line: f.line || '', when: lookupWhen(f) });
      const b = li.querySelector('button');
      b.dataset.index = String(i);
      b.setAttribute('aria-label', [f.line, lookupWhen(f)].filter(Boolean).join(', ')); // read as one sentence, not "15:25flies"
      return li;
    }));
    list.hidden = false;
    const first = ul.querySelector('button');
    if (first) first.focus();
  }
  // Fill the leg from a found flight: the schedule's fields only (decision 4), the title only when it is empty. Nothing is saved
  // until Save.
  function fillFromLookup(leg, entry) {
    const ed = state.editing;
    if (!ed || !entry || !entry.object) return;
    let fields;
    try { fields = objectFields(entry.object, host.util); } catch (err) { return lookupSay(leg, "Flight lookup isn't working right now. Fill it in by hand.", true); }
    const got = lookupFill(fields);
    if (got.arrives && got.arrives.length !== 16) delete got.arrives; // the server always dates it; anything else is left out
    const l = LEGS[leg];
    if (leg === 'out' && fields.title) got.title = fields.title; // the return's title follows its own placeholder
    // What the form holds now, by lookupFill's names, so a value an earlier lookup filled can be told from one the person typed.
    const KEYS = ['number', 'fromCode', 'from', 'toCode', 'to', 'operator', 'terminal', 'title'];
    const now = { date: parsePlace($(l.date).value).date || '', time: $(l.time).value, minutes: lengthOf(l.hours, l.minutes) ?? '', arrives: $(l.arrival).value };
    for (const f of KEYS) if (l[f]) now[f] = $(l[f]).value;
    ed.lookupFilled = ed.lookupFilled || {};
    const { set, filled } = lookupApply(got, ed.lookupFilled[leg], now);
    ed.lookupFilled[leg] = filled;
    if (set.date) {
      setPlaceMenu($(l.date), { date: set.date });
      if (leg === 'out') { checkoutOptions(); syncPhaseField(); }
    }
    if (set.date || set.arrives !== undefined) ed[l.was] = parsePlace($(l.date).value).date;
    if (set.time !== undefined) $(l.time).value = set.time;
    if (set.minutes !== undefined) setLength(l.hours, l.minutes, set.minutes || null);
    if (set.arrives !== undefined) $(l.arrival).value = set.arrives;
    arrivalFieldsFrom(leg);
    for (const f of KEYS) if (l[f] && set[f] !== undefined) setVal(l[f], set[f]);
    showArrival();
    if ($('f-back-title')) $('f-back-title').placeholder = backTitle();
    closeLookupList(leg);
    lookupSay(leg, 'Filled in from a flight saved here before. Check it against your booking.');
  }
  // After a flight is saved, its schedule part (and its return's) goes to the server's schedule. Never in the way of a save.
  function rememberFlights(...legs) {
    if (!state.flightLookup || !host.lookup) return;
    for (const leg of legs) {
      const object = flightObject(leg);
      if (object) host.lookup.remember('flight', object);
    }
  }
  // A typed airport code fills its name, when the name is empty and the code is in the server's airport list (on leaving the
  // code). Works with the suggestions off: it uses only the airport list.
  const CODE_NAMES = { 'f-fromCode': 'f-from', 'f-toCode': 'f-to', 'f-back-fromCode': 'f-back-from', 'f-back-toCode': 'f-back-to' };
  // A four-letter ICAO code ("KMDW") is looked up even with a name, and once found shows as its IATA code ("MDW"), the code the
  // cards, the lookup and the schedule use.
  async function airportName(codeInput) {
    const nameInput = $(CODE_NAMES[codeInput.id]);
    const code = codeInput.value.trim().toUpperCase();
    const icao = /^[A-Z0-9]{4}$/.test(code);
    if (!nameInput || !(icao || /^[A-Z]{3}$/.test(code)) || (!icao && nameInput.value.trim()) || !host.lookup || !state.editing || state.editing.tile !== 'flight') return;
    let airport = null;
    try { airport = await host.lookup.airport(code); } catch (err) { return; }
    // Still the same code once the answer comes.
    if (!airport || !nameInput.isConnected || codeInput.value.trim().toUpperCase() !== code) return;
    if (icao && /^[A-Z]{3}$/.test(airport.code || '')) codeInput.value = airport.code;
    if (airport.name && !nameInput.value.trim()) nameInput.value = airport.name;
    if ($('f-back-title')) $('f-back-title').placeholder = backTitle();
  }
  $('editor').addEventListener('focusout', (e) => { if (CODE_NAMES[e.target.id]) airportName(e.target); });
  // Find, a choice in the list, and Enter in the row's inputs (which would otherwise save the form).
  $('editor').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    const leg = legOfLookup(b);
    if (!b || !leg) return;
    if (b.id === `${LEGS[leg].pre}lookup-find`) return findFlight(leg);
    if (b.classList.contains('lookup-choice')) {
      const entry = (lookupFound[leg] || [])[Number(b.dataset.index)];
      fillFromLookup(leg, entry);
      lookupEl(leg, 'find').focus();
    }
  });
  $('editor').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    const leg = legOfLookup(e.target);
    if (!leg) return;
    e.preventDefault();
    findFlight(leg);
  });

  // An amount typed as text ("1,234.50"): null when empty or not shown, NaN when it is not an amount.
  const amountOf = (id) => {
    if (!shown(id)) return null;
    const raw = $(id).value.trim();
    if (!raw) return null;
    const n = Number(raw.replace(/[\s,]/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  // A refusal that is one field's goes under it (its #<id>-error), the field is marked and has the focus; it goes when the field is typed in.
  function fieldError(id, text) {
    const el = $(id);
    const slot = $(`${id}-error`);
    if (!el || !slot) { $('f-error').textContent = text; $('f-error').hidden = false; return; }
    slot.textContent = text;
    el.setAttribute('aria-invalid', 'true');
    el.focus();
  }
  function clearFieldError(el) {
    const slot = el && el.id ? $(`${el.id}-error`) : null;
    if (!slot || !slot.textContent) return;
    slot.textContent = '';
    el.removeAttribute('aria-invalid');
  }
  async function saveEditor() {
    const ed = state.editing;
    if (!ed) return;
    const fail = (text) => { $('f-error').textContent = text; $('f-error').hidden = false; };
    $('f-error').hidden = true;
    $('f-save').disabled = true;
    try {
      if (ed.mode === 'trip') {
        // The name, Where and Notes are kept as stored (saveTrip merges); the form edits the dates and the currency.
        const patch = { currency: $('f-currency').value.trim() };
        // The zone is written only when the person changed it (blank: each person's own).
        const tzChanged = $('f-tz').value !== ((plan.trip || {}).tz || '');
        if (tzChanged) patch.tz = $('f-tz').value;
        // With phases the dates are the space's timeline, not the form's (the plan leaves them out of the write).
        if (!plan.phased()) {
          const start = $('f-start').value;
          const end = $('f-end').value;
          if (end && !start) return fail('The last day needs a first day.');
          if (start && end && end < start) return fail('The last day is before the first.');
          patch.start = start || null;
          patch.end = end || start || null;
        }
        await plan.saveTrip(patch);
        scrolled = false;
        plan.suggest().catch(() => {});
        closeEditor();
        if (tzChanged) {
          const failed = await plan.redateCopies();
          if (failed) host.ui.toast(`${failed} of the copies on the calendar could not be moved to the new time zone.`);
        }
        return;
      }
      const item = ed.id ? plan.list().find((i) => i.id === ed.id) : null;
      if (!ed.isLink && !ed.tile.startsWith('block:') && !ed.tile.startsWith('lane:') && !$('f-title').value.trim()) return fieldError('f-title', 'Give it a title.');
      const cost = amountOf('f-cost');
      const estimate = amountOf('f-estimate');
      if (Number.isNaN(cost)) return fieldError('f-cost', 'Enter an amount, like 12.50.');
      if (Number.isNaN(estimate)) return fieldError('f-estimate', 'Enter an amount, like 12.50.');
      const endSaid = endProblem();
      if (endSaid) { fail(endSaid); $(LENS.out.end).focus(); return; }
      if (tooLong('f-hours', 'f-minutes') || tooLong('f-travelHours', 'f-travelMinutes') || (roundTripOn() && tooLong('f-back-hours', 'f-back-minutes'))) return fail('A length can be at most 7 days (168 hours).');
      const common = {
        title: $('f-title').value.trim(),
        ...placeFields(parsePlace($('f-date').value)),
        notes: $('f-notes').value.trim(),
        ...($('f-phase-row') && !$('f-phase-row').hidden ? { phase: $('f-phase').value || null } : {}),
        owners: [...$('f-owners').querySelectorAll('input:checked')].map((i) => i.value),
        travelMode: shown('f-travelMode') ? chosenMode() : null,
        travelMinutes: lengthOf('f-travelHours', 'f-travelMinutes'),
        cost,
        estimate,
      };
      common.paidBy = common.cost ? paidByValue() : '';
      let fields;
      if (ed.isLink) {
        fields = { ...common, kind: 'link', time: $('f-time').value || null, minutes: lengthOf('f-hours', 'f-minutes'), pinned: Boolean($('f-pinned') && $('f-pinned').checked) };
      } else {
        const t = fromTile(ed.tile, item);
        // A round trip stays a journey other than a car: its return is removed first, with the switch.
        if (ed.backId && !ed.removeReturn && !roundTripOn()) return fail('Only a journey other than a car can be a round trip. Choose one, or turn off Round trip first.');
        if (t.kind === 'lane') { common.date = null; common.travelMode = null; common.travelMinutes = null; common.owners = []; common.cost = null; common.estimate = null; common.paidBy = ''; }
        // A time block or a marker between days can be left untitled in the form (the type's own label is its
        // placeholder, shown greyed until someone types over it): store that label as the real title rather than
        // leaving the field empty, so the item has a real name anywhere it is shown generically (Assistant's
        // context picker, a ref search, a backlink), not just in this module's own rendering, which already
        // falls back to the type's label on its own.
        if ((t.kind === 'lane' || t.kind === 'block') && !common.title) common.title = markerType(t.type).label;
        fields = { ...common, ...t, time: shown('f-time') ? $('f-time').value || null : t.kind === 'stay' && item ? item.time : null, minutes: ['block:meet-up', 'block:leave-by'].includes(ed.tile) || ed.tile.startsWith('lane:') ? null : lengthOf('f-hours', 'f-minutes') };
        if (t.kind === 'journey') {
          for (const f of ['operator', 'number', 'from', 'to', 'pickup', 'dropoff', 'terminal', 'platform', 'carriage', 'seat', 'travelClass']) fields[f] = get(`f-${f}`);
          fields.number = numberToSave(fields.mode, fields.number); // "wn 2483" is kept as "WN 2483"
          fields.fromCode = get('f-fromCode');
          fields.toCode = get('f-toCode');
          fields.gate = get('f-gate');
          fields.confirm = get('f-confirm');
          fields.arrives = get('f-arrival') || null;
          if (fields.arrives && !arrivalFits(fields.date, fields.time, fields.arrives)) return fail('The arrival on the ticket can be at most 7 days after it leaves, and at most a day before.');
          // The editor always saves the main leg as a first leg (a return whose outbound is gone becomes a one-way journey).
          fields.legOf = null;
          if (fields.mode === 'car') {
            fields.checkOut = $('f-checkout').value || null;
            if (fields.checkOut && !fields.date) return fail('Choose the day it is picked up.');
            if (fields.checkOut && fields.checkOut <= fields.date) return fail('Drop-off is on or before pick-up.');
            // The copy on the calendar ends on the Drop-off day at the End time (else at the pick-up time), and the length agrees.
            fields.checkOutTime = fields.checkOut && fields.time && $(LENS.out.end).value ? $(LENS.out.end).value : null;
            if (fields.checkOut && fields.time) {
              const total = fields.checkOutTime ? Math.round((parseYmd(fields.checkOut) - parseYmd(fields.date)) / 864e5) * 1440 + minutesOfDay(fields.checkOutTime) - minutesOfDay(fields.time) : 0;
              if (total > MAX_MINUTES) return fail('A length can be at most 7 days (168 hours).');
              fields.minutes = total > 0 ? total : null;
            }
          } else { fields.checkOut = null; fields.checkOutTime = null; }
        } else if (t.kind === 'stay') {
          fields.checkOut = $('f-checkout').value || null;
          if (fields.checkOut && !fields.date) return fail('Choose the day it checks in.');
          if (fields.checkOut && fields.checkOut <= fields.date) return fail('Check out is on or before check in.');
          fields.checkOutTime = get('f-checkOutTime') || null;
          fields.address = get('f-address');
          fields.roomType = get('f-roomType');
          fields.guests = num('f-guests');
          fields.confirm = get('f-confirm');
        } else if (t.kind === 'stop') {
          fields.place = get('f-place');
          fields.placeRef = ed.placeRef || null;
          fields.address = get('f-address-stop');
          fields.partySize = num('f-partySize');
          fields.reservationName = get('f-reservationName');
          fields.admissionCount = num('f-admissionCount');
          fields.gate = get('f-gate-show');
          fields.confirm = get('f-confirm');
        }
      }
      const round = fields.kind === 'journey' && roundTripOn();
      const back = round ? returnFields(fields) : null;
      if (back && back.arrives && !arrivalFits(back.date, back.time, back.arrives)) return fail("The return's arrival on the ticket can be at most 7 days after it leaves, and at most a day before.");
      if (item) {
        // Each leg that changed is written with its own version; a conflict is shown on that leg. Someone changed it since this
        // editor opened (the change has already arrived): do not write over it.
        let conflicted = false;
        const write = async (id, version, patch) => {
          const cur = plan.list().find((i) => i.id === id);
          if (!cur || !changes(cur, patch)) return;
          try {
            if (plan.versionOf(id) !== version) throw Object.assign(new Error('changed'), { conflict: true });
            await plan.updateItem(id, patch);
          } catch (err) {
            if (!err.conflict) throw err;
            state.conflicts.set(id, { patch });
            conflicted = true;
          }
        };
        await write(item.id, ed.version, fields);
        if (round && ed.backId && plan.list().some((i) => i.id === ed.backId)) await write(ed.backId, ed.backVersion, { ...back, legOf: item.id });
        else if (round) await plan.addItem({ ...back, legOf: item.id });
        else if (ed.backId && ed.removeReturn) await plan.removeItem(ed.backId);
        if (conflicted) { closeEditor(); return redraw(); }
      } else {
        // A new object: focus goes to its row once the plan redraws (the bar's button that opened the form is the host's,
        // and may be drawn again by then).
        const added = round ? (await plan.addRoundTrip(fields, back)).out : await plan.addItem(fields);
        if (state.editingFrom && added && added.id) { state.editingFrom.id = added.id; state.focusAfterRedraw = { id: added.id, until: Date.now() + 2000 }; }
        // The kind it was saved with is recent, also when the bar, the day's "..." or a joint's + chose it.
        if (kindField) kindField.remember(kindOf(ed.tile));
      }
      rememberFlights(fields, back);
      closeEditor();
    } catch (err) {
      fail(err.message);
    } finally {
      const save = $('f-save');
      if (save) save.disabled = false;
    }
  }

  // The dialog's buttons, by delegation (its form is made afresh each time it opens).
  $('editor').addEventListener('submit', (e) => { e.preventDefault(); saveEditor(); });
  // A journey's arrival follows its departure and length as they are typed; a stay's checkout follows its check-in day.
  $('editor').addEventListener('input', (e) => {
    if (['f-arrival-day', 'f-arrival-time'].includes(e.target.id)) arrivalFieldsInto('out');
    if (['f-back-arrival-day', 'f-back-arrival-time'].includes(e.target.id)) arrivalFieldsInto('back');
    if (Object.values(LENS).some((l) => [l.end, l.time, l.hours, l.minutes].includes(e.target.id)) && $('f-error')) $('f-error').hidden = true; // what was refused is being fixed
    clearFieldError(e.target);
    if (CODE_NAMES[e.target.id] && e.target.value !== e.target.value.toUpperCase()) { const at = e.target.selectionStart; e.target.value = e.target.value.toUpperCase(); try { e.target.setSelectionRange(at, at); } catch (err) { /* a field with no caret */ } }
    for (const l of Object.values(LENS)) {
      if (!endMode()) break;
      if (e.target.id === l.end || (e.target.id === l.time && $(l.end).value && !lengthOf(l.hours, l.minutes))) endToLength(l);
    }
    if (['f-time', 'f-hours', 'f-minutes', 'f-endTime'].includes(e.target.id)) carAgree('length');
    if (['f-time', 'f-hours', 'f-minutes', 'f-arrival-day', 'f-arrival-time', 'f-back-time', 'f-back-hours', 'f-back-minutes', 'f-back-arrival-day', 'f-back-arrival-time'].includes(e.target.id)) showArrival();
    if (['f-title', 'f-back-to', 'f-back-toCode'].includes(e.target.id) && $('f-back-title')) $('f-back-title').placeholder = backTitle();
  });
  // Without the browser's own bubble, a missing title is said under the field.
  $('editor').addEventListener('invalid', (e) => { if (e.target.id === 'f-title') { e.preventDefault(); fieldError('f-title', 'Give it a title.'); } }, true);
  $('editor').addEventListener('change', (e) => {
    // The check-out a person picks is theirs (an empty one too); until then it follows the check-in day.
    if (e.target.id === 'f-checkout' && state.editing) state.editing.checkOut = e.target.value;
    if (e.target.id === 'f-checkout') carAgree('drop');
    if (e.target.id === 'f-date') checkoutOptions();
    // Another departure day, for either leg: the ticket's arrival moves by as many days, as a move on the plan does (an arrival
    // not yet chosen stays the same day as the departure). Off its days, it is kept relative to the day it left ("The next day");
    // given a day again, it is dated on that one.
    const leg = e.target.id === 'f-date' ? 'out' : e.target.id === 'f-back-date' ? 'back' : null;
    const ed = state.editing;
    if (leg && ed) {
      const l = LEGS[leg];
      const day = parsePlace(e.target.value).date;
      const arrival = $(l.arrival);
      if (arrival) {
        const was = ed[l.was];
        if (arrival.value.length === 16 && was && day && day !== was) {
          arrival.value = shiftArrives(arrival.value, Math.round((parseYmd(day) - parseYmd(was)) / (24 * 60 * 60 * 1000)));
        } else if (arrival.value.length === 16 && was && !day) {
          arrival.value = relativeArrives(was, arrival.value) || '';
        } else if (arrival.value && arrival.value.length !== 16 && day) {
          arrival.value = datedArrives(day, arrival.value);
        }
        arrivalFieldsFrom(leg);
        showArrival();
      }
      ed[l.was] = day;
    }
    if (e.target.id === 'f-roundtrip') roundTripSwitched(e.target);
  });
  let deleteArmedInEditor = false;
  let deleteAsking = false;
  // A plan object others point at says so before the usual question (plan-linked-objects, step 4).
  async function confirmPlanDelete(ed, b) {
    if (deleteAsking) return;
    if (!deleteArmedInEditor) {
      deleteAsking = true;
      let n = 0;
      if (host.objects && host.objects.linksTo) {
        try {
          const summaries = await host.objects.linksTo(planRef(ed.id));
          n = Array.isArray(summaries) ? summaries.length : 0;
        } catch { /* the usual question still stands */ }
      }
      deleteAsking = false;
      if (!b.isConnected) return;
      deleteArmedInEditor = true;
      b.textContent = n ? `Used by ${n}. Really delete?` : 'Really delete?';
      setTimeout(() => { deleteArmedInEditor = false; if (b.isConnected) b.textContent = 'Delete'; }, 4000);
      return;
    }
    deleteArmedInEditor = false;
    const id = ed.id;
    closeEditor();
    attempt(() => plan.removeItem(id));
  }
  $('editor').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'f-cancel') return cancelEditor();
    if (b.classList.contains('mode')) {
      const was = b.getAttribute('aria-checked') === 'true';
      for (const m of $('f-travelMode').querySelectorAll('.mode')) setModeOn(m, false);
      if (!was) setModeOn(b, true);
      roveModes();
      return;
    }
    if (b.id === 'f-extra-delete') {
      const ed = state.editing;
      const extra = ed && ed.id ? plan.extraReturns(ed.id) : [];
      hide($('f-extra'), true);
      if (extra.length) attempt(() => plan.removeItem(extra[extra.length - 1].id));
      return;
    }
    if (b.id === 'f-delete') {
      const ed = state.editing;
      if (!ed || !ed.id) return;
      if (askDeleteLegs(ed.openedId || ed.id, b, closeEditor)) return;
      confirmPlanDelete(ed, b);
      return;
    }
  });

  // --- clicks and adding ---------------------------------------------------------------------------------------

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const action = b.dataset.action;
    const li = b.closest('.row.entry, .leg-row');
    if (action === 'strip-prev' || action === 'strip-next') {
      const strip = $('daystrip');
      strip.scrollBy({ left: (action === 'strip-next' ? 1 : -1) * Math.max(120, strip.clientWidth * 0.7) });
    } else if (action === 'goto-day') {
      const target = $(`day-${b.dataset.day}`);
      if (target) { target.scrollIntoView({ inline: 'center', block: 'start' }); markCurrent(b.dataset.day); }
    } else if (action === 'move-menu' && (li || b.dataset.id)) {
      openMenu(li ? li.dataset.id : b.dataset.id, b); // a row's "...", or a day tag itself
    } else if (action === 'remove-link' && li) {
      const id = li.dataset.id;
      attempt(() => plan.removeItem(id));
    } else if (action === 'open') {
      const item = li ? plan.list().find((i) => i.id === li.dataset.id) : null;
      const ref = item && item.ref ? item.ref : b.dataset.ref ? JSON.parse(b.dataset.ref) : null;
      if (ref) host.objects.open(ref).catch((err) => note(err.message));
    } else if (action === 'edit-item') {
      openItemEditor(b.dataset.id, b);
    } else if (action === 'edit-leg' && li) {
      openItemEditor(li.dataset.id, b);
    } else if (action === 'day-menu') {
      const dayEl = b.closest('.sdk-day');
      if (dayEl) openAddMenu(b, { date: dayEl.dataset.day });
    } else if (action === 'day-more') {
      const dayEl = b.closest('.sdk-day');
      if (dayEl) openDayMore(b, dayEl.dataset.day);
    } else if (action === 'gap-add') {
      openAddMenu(b, { after: jointOfButton(b) }, { gap: Boolean(b.closest('.gap')) });
    } else if (action === 'edge-open') {
      const edge = b.closest('.dayedge');
      hide(b, true);
      hide(edge.querySelector('.edge-form'), false);
      edge.querySelector('input[name="count"]').focus();
    } else if (action === 'edge-cancel') {
      const edge = b.closest('.dayedge');
      hide(edge.querySelector('.edge-form'), true);
      hide(edge.querySelector('[data-action="edge-open"]'), false);
    } else if (action === 'add-first') {
      if (canEdit) openEditor('item', null, {}, b);
    } else if (action === 'use-theirs' && li) {
      state.conflicts.delete(li.dataset.id);
      redraw();
    } else if (action === 'keep-mine' && li) {
      const c = state.conflicts.get(li.dataset.id);
      if (!c) return;
      attempt(async () => { await plan.updateItem(li.dataset.id, c.patch); state.conflicts.delete(li.dataset.id); redraw(); });
    } else if (action === 'add-suggestion') {
      const s = b.closest('.suggestion');
      const day = b.closest('.sdk-day');
      if (s && day) attempt(async () => { await plan.addLink(JSON.parse(s.dataset.ref), { date: day.dataset.day }); await plan.suggest(); });
    }
  });

  // The small form on a day edge: how many days to add.
  root.addEventListener('submit', (e) => {
    const form = e.target.closest('.edge-form');
    if (!form) return;
    e.preventDefault();
    note('');
    addDays(form.closest('.dayedge').dataset.edge, Number(form.elements.count.value));
  });

  // --- what other modules may ask, and the first load ---------------------------------------------------------

  // The titlebar's "+" adds to the selected day. Typing is `/p` in Chat.
  const defaultDay = () => {
    const days = plan.days();
    const today = ymd(new Date());
    return days.includes(state.currentDay) ? state.currentDay : days.includes(today) ? today : days[0] || null;
  };
  const addFromBar = (tile) => {
    if (!canEdit) return;
    const day = defaultDay();
    openEditor('item', null, day ? { date: day, tile } : { tile });
  };
  // The host's "+": the day menu's kinds, adding to the selected day (addFromBar), wherever the Planner is drawn.
  const addTiles = new Set(addKinds().flatMap((k) => (k.items ? k.items.map((r) => r.id) : [k.id])));
  host.add.set(canEdit ? addKinds().map(({ tip, ...k }) => (k.items ? { ...k, items: k.items.map(({ tip: t, ...r }) => r) } : k)) : []).catch(() => {});
  host.on('add', (e) => { if (canEdit && addTiles.has(e.id)) addFromBar(e.id); });

  // The pane's width, not the window's: a bundled module runs in the page, so a media query would follow the window. The
  // stylesheet keys its narrow layout on `.app.narrow`. A frame can report no width while it is laid out, so wait for one.
  const fit = () => {
    const w = host.rootElement.clientWidth;
    if (w) { $('app').classList.toggle('narrow', w < 720); $('app').classList.toggle('tiny', w < 480); }
  };
  fit();
  new ResizeObserver(fit).observe(host.rootElement);

  plan.provide();
  // An object handed in that could not go on its day (past the plan's 60 days): say so here too.
  plan.onSaid((text) => note(text));
  plan.onFromText((text) => {
    if (!canEdit) return;
    const parsed = host.util.parseWhen ? host.util.parseWhen(text) : { title: text };
    const day = parsed.date && plan.days().includes(parsed.date) ? parsed.date : defaultDay();
    openEditor('item', null, { date: day });
    if ($('f-title')) $('f-title').value = parsed.title || text;
    if (parsed.time && $('f-time')) $('f-time').value = parsed.time;
    editorOpened();
  });
  plan.subscribe(() => { if (state.loaded) redraw(); });
  // What the plan points at can change or go where it lives without telling this page, so look again now and then and when the
  // page comes back into view (until the server announces it).
  const look = () => { if (state.loaded) { plan.refreshSummaries().catch(() => {}); } };
  // The host says when the phases change (host.on('phases'), host.space().phases already the new ones): redraw at once.
  host.on('phases', () => { if (state.loaded) plan.refreshPhases(); });
  // The summaries can change where they live without telling this page, so look now and then; the phases only as a slow fallback.
  const lookTimer = setInterval(() => { if (!host.rootElement.isConnected) clearInterval(lookTimer); else look(); }, 20000);
  const phaseTimer = setInterval(() => { if (!host.rootElement.isConnected) clearInterval(phaseTimer); else if (state.loaded) plan.refreshPhases(); }, 300000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) look(); });
  window.addEventListener('focus', look);
  render();
  try {
    await plan.load();
    state.people = await host.people().catch(() => []);
    await lookBudget();
    try { useMarkerTypes(await host.settings.get()); } catch (err) { useMarkerTypes(null); }
    host.settings.onChange((v) => { useMarkerTypes(v); if (kindField) kindField.setGroups(kindGroups()); if (state.loaded) redraw(); checkFlightLookup(); });
    checkFlightLookup();
    state.loaded = true;
    // Warm the icons the page draws, so the first draw is not empty.
    await Promise.all([...new Set([...root.querySelectorAll('template')].flatMap((t) => [...t.content.querySelectorAll('[data-icon]')].map((n) => n.dataset.icon)).concat(Object.values(CAT_ICON), Object.values(BADGES), Object.values(LEG_ICONS), ['link-slash'], [...root.querySelectorAll('[data-icon]')].map((n) => n.dataset.icon)))].filter(Boolean).map(wantIcon));
    redraw();
    plan.suggest().catch(() => {});
    hydrate(root === document ? document.body : root);
  } catch (err) {
    $('app').hidden = true;
    $('msg').hidden = false;
    $('msg').textContent = 'The trip could not load: ' + err.message;
  }
})();
