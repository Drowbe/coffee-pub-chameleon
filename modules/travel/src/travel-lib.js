  // The Travel module's model, with no page in it: dates, cleaning what is stored, the order of a day, and the gaps
  // between items. Shared by the module's page and its dashboard widget (inlined into both by the build), and run
  // on its own by tools/check-travel.mjs. It expects `ymd` and `parseYmd` (from host.util) in scope.

  // The trip is one stored value per space (its key is a pointer's id, so the trip can be pointed at and opened).
  const TRIP_KEY = 'trip:main';
  // Each item of the plan is its own stored value, `plan:<id>` (its kind's name, as other modules point at it). Before the product's
  // rename of items to objects (plan-names step 7) it was `item:<id>`: the plan moves those to `plan:` the first time it loads
  // in a place and records that it has (MOVED_KEY), and reads both until then, so nothing is lost for someone who cannot edit.
  const PLAN_PREFIX = 'plan:';
  const OLD_PLAN_PREFIX = 'item:';
  const MOVED_KEY = '_moved:plan-keys';
  // Phases (plan-one-bar.md, step 2): the dates are the space's (host.space().phases, read through the SDK's
  // host.util.phaseTimeline), not the trip's. A trip stored with `start`, `end` and `phases` of its own by an earlier
  // Planner keeps them until its next write, which drops them; with phases they are never read.
  const PHASE_ID = /^[a-z][a-z0-9-]{0,31}$/;
  // The id of an item of the plan from its stored key, under either prefix, or null for any other key.
  const planIdOf = (key) => (typeof key !== 'string' ? null : key.startsWith(PLAN_PREFIX) ? key.slice(PLAN_PREFIX.length) : key.startsWith(OLD_PLAN_PREFIX) ? key.slice(OLD_PLAN_PREFIX.length) : null);
  const CATEGORIES = ['do', 'eat', 'stay', 'travel', 'other'];
  const KINDS = ['stop', 'stay', 'journey', 'note', 'link', 'block', 'lane'];
  // What an item is, for how it is drawn (the page decides how; the model only keeps a known value). A journey has a `mode`,
  // a stop and a stay a `type`, and any item may say how you get to it (`travelMode`, `travelMinutes`: the leg from the
  // item before), which a person sets now and a routing service could fill later.
  const MODES = ['flight', 'train', 'bus', 'ferry', 'car', 'taxi', 'rideshare', 'shuttle', 'other'];
  const STOP_TYPES = ['restaurant', 'cafe', 'bar', 'sight', 'museum', 'attraction', 'tour', 'show', 'hike', 'beach', 'shop', 'spa', 'other'];
  const STAY_TYPES = ['hotel', 'rental', 'hostel', 'camp', 'other'];
  const TRAVEL_MODES = ['walk', 'drive', 'transit', 'bike', 'taxi', 'rideshare', 'none'];
  const MAX_DAYS = 60;
  const DAY_MS = 24 * 60 * 60 * 1000;
  // The longest length an item can have (a journey of several days, a ferry overnight and more): 7 days, in minutes.
  const MAX_MINUTES = 7 * 24 * 60;

  const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseYmd(s).getTime()) && ymd(parseYmd(s)) === s;
  const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  // A ticket's arrival as stored (decision 11): a local day and time ("2026-11-14T15:25") while the journey has a day. While it
  // has none, its time with how many days after the day it leaves ("15:25", "06:30+1", "13:00-1"; -1 to +7), so the offset
  // survives a stay under "Unscheduled" or on the line. Null for anything else.
  const RELATIVE_ARRIVAL = /^(\d{2}:\d{2})(?:([+-])(\d))?$/;
  const ticketWhen = (s) => {
    if (typeof s !== 'string') return null;
    if (s.length === 16 && s.charAt(10) === 'T') return isYmd(s.slice(0, 10)) && isTime(s.slice(11)) ? s : null;
    const m = RELATIVE_ARRIVAL.exec(s);
    if (!m || !isTime(m[1])) return null;
    const n = m[2] ? Number(m[2] + m[3]) : 0;
    return n >= -1 && n <= 7 ? `${m[1]}${n > 0 ? `+${n}` : n < 0 ? `${n}` : ''}` : null;
  };
  // A day `n` days later (earlier when negative). (Named so: the page has an addDays of its own, and the library is inlined
  // into the page's scope.)
  const daysLater = (day, n) => { const d = parseYmd(day); return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };
  // A ticket's dated arrival moved with its journey: `n` days later. A relative one already follows the journey's day.
  const shiftArrives = (arrives, n) => (typeof arrives === 'string' && arrives.length === 16 && n ? `${daysLater(arrives.slice(0, 10), n)}${arrives.slice(10)}` : arrives);
  // A dated arrival as the relative one kept while the journey has no day, from the day it left on.
  const relativeArrives = (date, arrives) => {
    if (!isYmd(date) || typeof arrives !== 'string' || arrives.length !== 16) return arrives;
    const n = Math.round((parseYmd(arrives.slice(0, 10)) - parseYmd(date)) / DAY_MS);
    return ticketWhen(`${arrives.slice(11)}${n > 0 ? `+${n}` : n < 0 ? `${n}` : ''}`);
  };
  // A relative arrival on the day the journey leaves: dated again.
  const datedArrives = (date, arrives) => {
    const m = RELATIVE_ARRIVAL.exec(typeof arrives === 'string' ? arrives : '');
    return m && isYmd(date) ? `${daysLater(date, m[2] ? Number(m[2] + m[3]) : 0)}T${m[1]}` : arrives;
  };
  // Whether a ticket's dated arrival can be one, against the day (and time) it leaves: at most 7 days after (the longest a
  // journey can be), at most 1 day before (across the date line). A time alone, or no day to leave on, always can.
  function arrivalFits(date, time, arrives) {
    if (typeof arrives !== 'string' || arrives.length !== 16 || !isYmd(date)) return true;
    const days = Math.round((parseYmd(arrives.slice(0, 10)) - parseYmd(date)) / DAY_MS);
    if (!isTime(time)) return days >= -1 && days <= 7;
    const at = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const minutes = days * 1440 + at(arrives.slice(11)) - at(time);
    return minutes >= -1440 && minutes <= MAX_MINUTES;
  }
  // An arrival as a notes line ("Arrives: 2026-11-14 15:25"), for one that cannot be the ticket's.
  const arrivesLine = (arrives) => `Arrives: ${String(arrives).replace('T', ' ')}`;

  // --- the editor's days that follow another day (#241, #242, #245) --------------------------------------------------
  // A day that follows another until the person chooses one: a flight's arrival day is its departure day, a stay's check-out
  // the day after its check-in. `chosen` is what the person set (null or undefined while they have not; '' is a chosen "none"),
  // `base` the day it follows, `n` days later. No base and nothing chosen: ''.
  const followDay = (base, chosen, n) => (chosen !== null && chosen !== undefined ? chosen : isYmd(base) ? daysLater(base, n) : '');
  // The arrival days the editor offers for a journey, the same day as the departure first, then up to 7 days after, then the day
  // before (across the date line): the days a ticket's arrival can be (arrivalFits). On a day, each is a date; with no day, each is
  // how many days later ('0', '1', '-1'), the way the arrival is kept then.
  const ARRIVAL_OFFSETS = [0, 1, 2, 3, 4, 5, 6, 7, -1];
  const arrivalDays = (base) => ARRIVAL_OFFSETS.map((n) => ({ value: isYmd(base) ? daysLater(base, n) : String(n), n }));
  // A ticket's arrival as the editor shows it, a day (one of arrivalDays) and a time, from how it is stored. Nothing stored is the
  // departure day (or '0', the same day) with no time.
  function arrivalParts(base, arrives) {
    const m = RELATIVE_ARRIVAL.exec(typeof arrives === 'string' ? arrives : '');
    if (m) { const n = m[2] ? Number(m[2] + m[3]) : 0; return { day: isYmd(base) ? daysLater(base, n) : String(n), time: m[1] }; }
    if (typeof arrives === 'string' && arrives.length === 16) return { day: arrives.slice(0, 10), time: arrives.slice(11) };
    return { day: isYmd(base) ? base : '0', time: '' };
  }
  // And back: what is stored for the day and time the editor shows. No time is no arrival.
  function arrivalJoin(day, time) {
    if (!isTime(time)) return '';
    if (isYmd(day)) return `${day}T${time}`;
    const n = Number(day);
    if (!Number.isInteger(n)) return '';
    return ticketWhen(`${time}${n > 0 ? `+${n}` : n < 0 ? `${n}` : ''}`) || '';
  }
  // The days a stay can check out, the day after it checks in and on, as many as a plan can be long. None without a check-in day.
  const checkoutDays = (base) => (isYmd(base) ? Array.from({ length: MAX_DAYS }, (_, i) => ({ value: daysLater(base, i + 1), n: i + 1 })) : []);
  // A small whole number, 1 to max, or null.
  const count = (n, max) => (Number.isFinite(n) && n >= 1 ? Math.min(Math.round(n), max) : null);
  // A code such as an airport (IATA, 3 letters) or a gate: letters and digits, upper case, or ''.
  const code = (s, n) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, n);
  const clip = (s, n) => String(s ?? '').replace(/\p{Cc}/gu, (c) => (c === '\n' ? c : ' ')).trim().slice(0, n);

  // One stored item, made safe and complete; null when it cannot be an item at all. `date` is null for an idea
  // that has no day yet. A `link` item points at another module's object (`ref`) and takes its day from that
  // object's summary unless it has its own.
  function cleanItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const kind = KINDS.includes(raw.kind) ? raw.kind : 'stop';
    const item = {
      id: clip(raw.id, 40),
      kind,
      title: clip(raw.title, 120),
      date: isYmd(raw.date) ? raw.date : null,
      time: isTime(raw.time) ? raw.time : null,
      minutes: Number.isFinite(raw.minutes) && raw.minutes > 0 ? Math.min(Math.round(raw.minutes), MAX_MINUTES) : null,
      category: CATEGORIES.includes(raw.category) ? raw.category : kind === 'stay' ? 'stay' : kind === 'journey' ? 'travel' : 'do',
      place: clip(raw.place, 120),
      address: clip(raw.address, 200),
      notes: clip(raw.notes, 8000),
      confirm: clip(raw.confirm, 60),
      from: clip(raw.from, 80),
      to: clip(raw.to, 80),
      checkOut: isYmd(raw.checkOut) ? raw.checkOut : null,
      travelMode: TRAVEL_MODES.includes(raw.travelMode) ? raw.travelMode : null,
      travelMinutes: Number.isFinite(raw.travelMinutes) && raw.travelMinutes > 0 ? Math.min(Math.round(raw.travelMinutes), MAX_MINUTES) : null,
      order: Number.isFinite(raw.order) ? raw.order : 0,
      owners: Array.isArray(raw.owners) ? [...new Set(raw.owners.filter((k) => typeof k === 'string').map((k) => k.slice(0, 40)))].slice(0, 20) : [],
      done: Boolean(raw.done),
      pinned: Boolean(raw.pinned),
      phase: typeof raw.phase === 'string' && PHASE_ID.test(raw.phase) ? raw.phase : null,
      by: clip(raw.by, 40),
      cost: Number.isFinite(raw.cost) && raw.cost > 0 ? Math.min(Math.round(raw.cost * 100) / 100, 1e9) : null, // the actual amount
      estimate: Number.isFinite(raw.estimate) && raw.estimate > 0 ? Math.min(Math.round(raw.estimate * 100) / 100, 1e9) : null, // what is expected, before it is paid
      paidBy: typeof raw.paidBy === 'string' ? raw.paidBy.slice(0, 40) : '',
      follow: Boolean(raw.follow),
      result: clip(raw.result, 200),
      fired: Number.isFinite(raw.fired) ? raw.fired : 0,
    };
    if (kind === 'link') {
      const r = raw.ref;
      if (!r || typeof r.module !== 'string' || typeof r.kind !== 'string' || typeof r.id !== 'string') return null;
      item.ref = { module: r.module, kind: r.kind, id: r.id, scope: r.scope === 'space' ? 'space' : 'environment', ...(r.scope === 'space' && r.space ? { space: r.space } : {}) };
    }
    // Where the item is: on a day (`date`, then `time`, then `order`) or on the plan's line at a joint (`after`: the day the joint
    // follows, '' for the head of the line before the first day; then `order`). One or the other: a day clears the joint. Neither
    // (an old idea, a pointer with no day of its own) is read by the plan as the head of the line, or the pointed-at item's day.
    item.after = isYmd(raw.after) ? raw.after : raw.after === '' ? '' : null;
    if (item.date) item.after = null;
    // A time block (free time, rest, a meet-up...): something that happens inside a day and has no place. Its `type` names one of the
    // module's marker types (a setting); the label is optional and falls back to the type's.
    // A marker between the days (a `lane`): always on the line, never in a day.
    if (kind === 'lane') {
      item.type = typeof raw.type === 'string' && /^[a-z][a-z0-9-]{0,29}$/.test(raw.type) ? raw.type : '';
      item.after = isYmd(raw.after) ? raw.after : '';
      item.date = null;
      item.time = null;
      item.minutes = null;
    }
    if (kind === 'block') item.type = typeof raw.type === 'string' && /^[a-z][a-z0-9-]{0,29}$/.test(raw.type) ? raw.type : '';
    // Details that belong to one kind of item, all optional. A stop: what it is, and for a meal or an event who and how many.
    if (kind === 'stop') {
      // The Place this stop is at, when it is one the space keeps (a pointer; `place` stays the name the person typed).
      const pr = raw.placeRef;
      item.placeRef = pr && typeof pr.module === 'string' && typeof pr.kind === 'string' && typeof pr.id === 'string'
        ? { module: pr.module.slice(0, 40), kind: pr.kind.slice(0, 40), id: pr.id.slice(0, 80), scope: pr.scope === 'space' ? 'space' : 'environment', ...(pr.scope === 'space' && pr.space ? { space: String(pr.space).slice(0, 64) } : {}) }
        : null;
      item.type = STOP_TYPES.includes(raw.type) ? raw.type : null;
      item.partySize = count(raw.partySize, 99);
      item.reservationName = clip(raw.reservationName, 60);
      item.admissionCount = count(raw.admissionCount, 999);
      item.gate = clip(raw.gate, 30);
    }
    // A stay: what kind, the room, how many guests, and a check-out time.
    if (kind === 'stay') {
      item.type = STAY_TYPES.includes(raw.type) ? raw.type : null;
      item.roomType = clip(raw.roomType, 60);
      item.guests = count(raw.guests, 99);
      item.checkOutTime = isTime(raw.checkOutTime) ? raw.checkOutTime : null;
    }
    // A journey: how, and what a ticket for it says (a flight's airline and number, a train's operator and platform...).
    if (kind === 'journey') {
      item.mode = MODES.includes(raw.mode) ? raw.mode : 'other';
      item.checkOutTime = MODES.includes(raw.mode) && raw.mode === 'car' && isTime(raw.checkOutTime) ? raw.checkOutTime : null; // a car's drop-off time
      item.operator = clip(raw.operator, 60); // the airline, the train company, the ferry line
      item.number = clip(raw.number, 20); // flight or train number
      item.fromCode = code(raw.fromCode, 5);
      item.toCode = code(raw.toCode, 5);
      item.terminal = clip(raw.terminal, 30);
      item.gate = clip(raw.gate, 30);
      item.platform = clip(raw.platform, 30);
      item.carriage = clip(raw.carriage, 30);
      item.seat = clip(raw.seat, 30);
      item.travelClass = clip(raw.travelClass, 30);
      item.pickup = clip(raw.pickup, 120); // a car: where it is collected and where it goes back
      item.dropoff = clip(raw.dropoff, 120);
      // A rental car is kept for days: the day it goes back (checkOut), after the day it is collected. No other journey has one.
      if (item.mode !== 'car') item.checkOut = null;
      // When it arrives as the ticket says, in the local time where it lands (plan-object-handoff.md, decision 11): beside the
      // length, so a journey across time zones shows both its arrival and its time in the air right. Not for a car.
      item.arrives = item.mode === 'car' ? null : ticketWhen(raw.arrives);
      // On a day, a relative arrival (kept while it had none) is dated again.
      if (item.arrives && item.date && item.arrives.length !== 16) item.arrives = datedArrives(item.date, item.arrives);
      // One that cannot be (more than 7 days after it leaves, more than a day before) is kept in the notes, not shown.
      if (item.arrives && !arrivalFits(item.date, item.time, item.arrives)) {
        item.notes = clip([item.notes, arrivesLine(item.arrives)].filter(Boolean).join('\n\n'), 8000);
        item.arrives = null;
      }
      // A later leg of one booking (a round trip's return) points at the first leg, which holds the booking reference, the cost
      // and who paid. Any journey but a car; never itself. More legs can use the same field. Its own booking details are kept
      // here: they are set aside only where its outbound is found (outboundOf), so a leg whose outbound is gone keeps them.
      const legOf = typeof raw.legOf === 'string' ? clip(raw.legOf, 40) : '';
      item.legOf = legOf && legOf !== item.id && item.mode !== 'car' ? legOf : null;
    }
    if ((kind === 'block' || kind === 'lane') && !item.type) return null;
    if (kind !== 'link' && kind !== 'block' && kind !== 'lane' && !item.title) return null;
    if (kind === 'stay' && item.checkOut && item.date && item.checkOut < item.date) item.checkOut = null;
    if (kind === 'journey' && item.checkOut && (!item.date || item.checkOut <= item.date)) item.checkOut = null;
    if (kind === 'journey' && !item.checkOut) item.checkOutTime = null;
    return item;
  }

  // The trip's days, first to last, at most MAX_DAYS. No dates (or an end before the start): no days.
  function tripDays(trip) {
    if (!trip || !isYmd(trip.start) || !isYmd(trip.end) || trip.end < trip.start) return [];
    const out = [];
    const first = parseYmd(trip.start);
    for (let i = 0; i < MAX_DAYS; i += 1) {
      const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
      const k = ymd(d);
      out.push(k);
      if (k === trip.end) break;
    }
    return out;
  }

  // "Day 3 of 7", the weekday and the date of a day of the trip.
  function dayLabel(day, days) {
    const d = parseYmd(day);
    return {
      position: `Day ${days.indexOf(day) + 1} of ${days.length}`,
      weekday: d.toLocaleDateString([], { weekday: 'long' }),
      date: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
    };
  }

  // Whole days from today until the trip starts (negative while it is on or over), or null without dates.
  function daysUntil(trip, today) {
    if (!trip || !isYmd(trip.start)) return null;
    return Math.round((parseYmd(trip.start) - parseYmd(today)) / DAY_MS);
  }

  // The joint an item is at on the plan's line ('' the head, else the day it follows), or null when it is on a day. `day` is
  // the day the item shows on (its own, or for a pointer the pointed-at item's), given by the plan's dayOf. An item placed
  // nowhere and with no day to borrow is at the head: the old "ideas with no day yet".
  const lineOf = (item, day) => (item.after !== null && item.after !== undefined ? item.after : day ? null : '');
  // The joints of the plan in line order: the head, then after each day.
  const joints = (days) => ['', ...days];
  // The stored fields for a place: `{ date }` a day, `{ after }` a joint ('' the head), nothing for "wherever it falls".
  const placeFields = (place) => {
    if (place && (place.after === '' || isYmd(place.after))) return { date: null, after: place.after };
    return { date: place && isYmd(place.date) ? place.date : null, after: null };
  };
  // Items on the line in their order: by joint (the head first, then the day each follows), then by hand order.
  const sortLine = (items) => [...items].sort((a, b) => String(a.after || '').localeCompare(String(b.after || '')) || a.order - b.order || String(a.id).localeCompare(String(b.id)));

  // Where a day's items sit: those with no time first (the whole-day things, in the order people put them), then
  // the timed ones by time. A link's day (from its object's summary) is given by dayOf.
  const minutesOfDay = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  function sortDay(items) {
    const untimed = items.filter((i) => !i.time).sort((a, b) => a.order - b.order || String(a.id).localeCompare(String(b.id)));
    const timed = items.filter((i) => i.time).sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time) || a.order - b.order || String(a.id).localeCompare(String(b.id)));
    return [...untimed, ...timed];
  }

  // Every item under its day; `dayOf(item)` says which (the item's own date, or a linked object's summary). Items with
  // no day go under null, the ideas not yet placed.
  function itemsByDay(items, days, dayOf = (i) => i.date) {
    const by = new Map(days.map((d) => [d, []]));
    by.set(null, []);
    for (const item of items) {
      const d = dayOf(item);
      const key = d && by.has(d) ? d : d ? undefined : null;
      if (key === undefined) continue; // a day outside the trip is not shown
      by.get(key).push(item);
    }
    for (const [d, list] of by) by.set(d, sortDay(list));
    return by;
  }

  // A number for an untimed item between two neighbours' numbers (either may be missing); null when there is no
  // no gap left between them and the day needs renumbering.
  function orderBetween(before, after) {
    if (before === undefined && after === undefined) return 1000;
    if (before === undefined) return after - 1000;
    if (after === undefined) return before + 1000;
    const mid = (before + after) / 2;
    return mid > before && mid < after && after - before > 1e-6 ? mid : null;
  }

  // The day's untimed items renumbered 1000 apart, in their order: { id: order } for those that change.
  function renumber(untimed) {
    const out = {};
    untimed.forEach((item, i) => { if (item.order !== (i + 1) * 1000) out[item.id] = (i + 1) * 1000; });
    return out;
  }

  // Put an untimed item at `index` among the day's untimed items (which do not include it). Returns the changes
  // as { id: { date?, order } }, renumbering the day when there is no gap.
  function placeUntimed(dayUntimed, moving, date, index) {
    const rest = dayUntimed.filter((i) => i.id !== moving.id);
    const at = Math.max(0, Math.min(index, rest.length));
    const order = orderBetween(rest[at - 1]?.order, rest[at]?.order);
    if (order !== null) return { [moving.id]: { date, order } };
    const sequence = [...rest.slice(0, at), { ...moving }, ...rest.slice(at)];
    const numbers = renumber(sequence);
    const changes = {};
    for (const [id, order2] of Object.entries(numbers)) changes[id] = { order: order2 };
    changes[moving.id] = { ...(changes[moving.id] || {}), date, order: (at + 1) * 1000 };
    return changes;
  }

  // A day's objects moved to another day (the day menu's "Move all to..."). `items` are the plan's objects with `date` set to the
  // day each is on (an object that follows another module's object has that object's day). Not on a day: left alone.
  // Without `rest`, the objects of `from` go to `to`. With `rest`, every day from `from` on moves by the same number of days, so
  // the plan slides earlier or later. Objects already on a day they land on stay, and the moved ones go after them: nothing is
  // lost. A stay's check-out moves by the same days. Returns { changes: { id: { date, order?, checkOut? } }, moved, days, delta }:
  // how many objects, how many different days they were on, and how many days later (negative: earlier).
  function shiftDays(items, from, to, rest) {
    const delta = isYmd(from) && isYmd(to) ? Math.round((parseYmd(to) - parseYmd(from)) / DAY_MS) : 0;
    const out = { changes: {}, moved: 0, days: 0, delta };
    if (!delta) return out;
    const dated = items.filter((i) => isYmd(i.date) && i.kind !== 'lane');
    const picked = dated.filter((i) => (rest ? i.date >= from : i.date === from));
    const ids = new Set(picked.map((i) => i.id));
    const staying = dated.filter((i) => !ids.has(i.id));
    // Moving objects land after the untimed ones already on their new day, keeping their own order among themselves.
    const next = new Map();
    for (const i of [...picked].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.order || 0) - (b.order || 0))) {
      const date = daysLater(i.date, delta);
      const patch = { date };
      if ((i.kind === 'stay' || i.kind === 'journey') && isYmd(i.checkOut)) patch.checkOut = daysLater(i.checkOut, delta);
      if (!i.time) {
        const last = next.has(date) ? next.get(date) : Math.max(0, ...staying.filter((o) => o.date === date && !o.time).map((o) => o.order || 0));
        const hasStaying = staying.some((o) => o.date === date && !o.time);
        if (hasStaying || next.has(date)) { patch.order = last + 1000; next.set(date, patch.order); }
      }
      out.changes[i.id] = patch;
    }
    out.moved = picked.length;
    out.days = new Set(picked.map((i) => i.date)).size;
    return out;
  }

  // A day's objects taken off it (the day menu's "Clear this day"): they lose their day and go under "Unscheduled", after the
  // ones already there. A pointer to another module's object cannot lose a day it takes from that object, so it stays (`kept`).
  // Returns { changes: { id: { date: null, after: null, order } }, moved, kept }.
  function clearDay(items, day) {
    const mine = items.filter((i) => i.date === day && i.kind !== 'lane');
    const here = mine.filter((i) => i.kind !== 'link');
    let order = Math.max(0, ...items.filter((i) => !i.date && (i.after === null || i.after === undefined) && i.kind !== 'lane' && i.kind !== 'link').map((i) => i.order || 0));
    const changes = {};
    for (const i of [...here].sort((a, b) => (a.order || 0) - (b.order || 0))) {
      order += 1000;
      changes[i.id] = { date: null, after: null, order };
    }
    return { changes, moved: here.length, kept: mine.length - here.length };
  }

  // Earlier and later, for the item menu (the way to move on a phone): an untimed item swaps with its neighbour;
  // a timed one moves by half an hour. Returns the changes as { id: { time | order } }, or null at the edge.
  function nudge(dayItems, item, direction) {
    if (item.time) {
      const m = minutesOfDay(item.time) + direction * 30;
      if (m < 0 || m >= 24 * 60) return null;
      const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      return { [item.id]: { time: t } };
    }
    const untimed = sortDay(dayItems.filter((i) => !i.time));
    const at = untimed.findIndex((i) => i.id === item.id);
    const other = untimed[at + direction];
    if (at < 0 || !other) return null;
    return { [item.id]: { order: other.order }, [other.id]: { order: item.order } };
  }

  // The minutes between the end of one timed item and the start of the next, when there is a gap worth showing.
  function gapMinutes(prev, next) {
    if (!prev || !next || !prev.time || !next.time) return null;
    const gap = minutesOfDay(next.time) - (minutesOfDay(prev.time) + (prev.minutes || 0));
    return gap > 0 ? gap : null;
  }
  function gapText(minutes) {
    if (!minutes) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
  }
  // A length as the editor shows it, hours and minutes ({ hours: 8, minutes: 15 } for 495), and back: the stored value stays
  // whole minutes. Nothing entered is null; either part may be left empty.
  function splitMinutes(total) {
    if (!Number.isFinite(total) || total <= 0) return { hours: null, minutes: null };
    const t = Math.round(total);
    return { hours: Math.floor(t / 60) || null, minutes: t % 60 || null };
  }
  function joinMinutes(hours, minutes) {
    const h = Number.isFinite(hours) && hours > 0 ? hours : 0;
    const m = Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
    const total = Math.round(h * 60 + m);
    return total > 0 ? Math.min(total, MAX_MINUTES) : null;
  }

  // A length from a start and an end time of day ("HH:MM"), as the editor's End time gives it (#247). An end before the start is the
  // next day; an end equal to the start is no length (0), which the editor refuses. Null when either is missing or not a time.
  function lengthBetween(start, end) {
    const ok = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
    if (!ok(start) || !ok(end)) return null;
    return (minutesOfDay(end) - minutesOfDay(start) + 24 * 60) % (24 * 60);
  }
  // The end time of day ("HH:MM") for a start and a length in minutes, and how many days later it falls (0 the same day, 1 the
  // next). Null with no start or no length. Nothing is stored: the end is always worked out from the start and the length.
  function endOf(start, minutes) {
    if (typeof start !== 'string' || !/^\d\d:\d\d$/.test(start) || !Number.isFinite(minutes) || minutes <= 0) return null;
    const m = minutesOfDay(start) + Math.round(minutes);
    const rest = m % (24 * 60);
    return { time: `${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`, days: Math.floor(m / (24 * 60)) };
  }

  // When a timed item ends: its day (null when it has none), the time of day ("HH:MM"), and how many days after the day it starts
  // that is (0 the same day, 1 the next, -1 the day before). A journey's arrival as on its ticket (`arrives`) wins, marked
  // `ticket`; else it is worked out from the time and the length. Null with neither.
  function arrivalOf(item) {
    if (item && item.arrives) {
      const relative = RELATIVE_ARRIVAL.exec(item.arrives);
      if (relative) {
        const n = relative[2] ? Number(relative[2] + relative[3]) : 0;
        return { day: item.date ? daysLater(item.date, n) : null, time: relative[1], days: n, ticket: true };
      }
      const day = item.arrives.slice(0, 10);
      const days = item.date ? Math.round((parseYmd(day) - parseYmd(item.date)) / DAY_MS) : 0;
      return { day, time: item.arrives.slice(11), days, ticket: true };
    }
    if (!item || !item.time || !item.minutes) return null;
    const m = minutesOfDay(item.time) + item.minutes;
    const days = Math.floor(m / (24 * 60));
    const rest = m % (24 * 60);
    const time = `${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`;
    const start = item.date ? parseYmd(item.date) : null;
    return { day: start ? ymd(new Date(start.getFullYear(), start.getMonth(), start.getDate() + days)) : null, time, days };
  }
  // The words after an arrival time for the days it is later than the start: '' the same day, "the next day", "+2 days".
  // A ticket's arrival can be the day before, across the date line.
  const laterText = (days) => (days === 1 ? 'the next day' : days > 1 ? `+${days} days` : days === -1 ? 'the day before' : days < -1 ? `${days} days` : '');

  // A stay covers the nights from its date up to (not including) its check-out day.
  function stayNights(item) {
    if (item.kind !== 'stay' || !item.date || !item.checkOut) return 0;
    return Math.round((parseYmd(item.checkOut) - parseYmd(item.date)) / DAY_MS);
  }

  // A time zone name the browser's own list knows ('Europe/Lisbon'), else ''.
  function zoneName(v) {
    if (typeof v !== 'string' || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(v.trim()) || v.length > 60) return '';
    try { new Intl.DateTimeFormat('en-US', { timeZone: v.trim() }); return v.trim(); } catch (err) { return ''; }
  }
  // The trip itself: a heading, where, and its dates. `start` and `end` are the plan's own first and last day, kept
  // only for a space whose template has no phases; with phases the main phase's band gives them (tripSpan) and they
  // are left out of what is written. A stored `phases` is never read. `v: 2` is this shape. An empty title means the
  // plan is shown under the space's name (planName).
  function cleanTrip(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const start = isYmd(r.start) ? r.start : null;
    const end = isYmd(r.end) && start && r.end >= start ? r.end : start;
    const currency = typeof r.currency === 'string' && /^[A-Za-z]{3}$/.test(r.currency.trim()) ? r.currency.trim().toUpperCase() : '';
    // The trip's own time zone (an IANA name such as Europe/Lisbon), which its Calendar copy is dated in; '' follows each viewer.
    const tz = zoneName(r.tz);
    return { title: clip(r.title, 80), destination: clip(r.destination, 80), start, end, notes: clip(r.notes, 2000), currency, ...(tz ? { tz } : {}), by: clip(r.by, 40), v: 2 };
  }

  // The main phase's band of a timeline (host.util.phaseTimeline), or null without one.
  const mainBand = (bands) => (Array.isArray(bands) ? bands.find((b) => b && b.main) : null) || null;

  // The plan's first and last day. With phases (any band), the main band's: its start, and its end or, open-ended, its
  // start again; { start: null, end: null } while the main phase has no start. Without phases, the trip's own.
  function tripSpan(trip, bands) {
    if (Array.isArray(bands) && bands.length) {
      const m = mainBand(bands);
      return m && m.dated ? { start: m.start, end: m.end || m.start } : { start: null, end: null };
    }
    const start = trip && isYmd(trip.start) ? trip.start : null;
    const end = start && trip && isYmd(trip.end) && trip.end >= start ? trip.end : start;
    return { start, end };
  }

  // The name the plan shows: its own title, or the space's name when the title is empty (including when nothing is stored yet).
  function planName(trip, space) {
    const title = trip && typeof trip.title === 'string' ? trip.title.trim() : '';
    if (title) return title;
    return space && typeof space.name === 'string' ? space.name.trim() : '';
  }

  // The day the space was created, from `createdAt` (a day, or a moment). Null when there is no space.
  function createdDay(space) {
    const c = space && space.createdAt;
    if (typeof c !== 'string' || !c) return null;
    if (c.length === 10 && isYmd(c)) return c;
    const d = new Date(c);
    return Number.isNaN(d.getTime()) ? null : ymd(d);
  }

  // The current phase of a timeline (the bands of host.util.phaseTimeline): the last dated band that has started by
  // `today`, else the first band (nothing has started). Null without bands. The band today is in has `current` from the
  // rule; this also answers between a passed band and the next (the gap after the main phase's end).
  function currentBand(bands, today) {
    const list = Array.isArray(bands) ? bands.filter(Boolean) : [];
    if (!list.length) return null;
    let found = null;
    if (isYmd(today)) for (const b of list) if (b.dated && b.start <= today) found = b;
    return found || list[0];
  }

  // Which phase a day is in, for the colour a day wears (the bands of host.util.phaseTimeline): the dated band whose first
  // day is on or before `day` and whose last day (null: open-ended) is on or after it, as { id, label, tint, first } with
  // `first` true on the band's first day; null for a day before the first band, in a gap between bands, after a band that
  // ended, or when the day or the bands are not usable. `tint` is one of the eight theme tint names (else null, no colour).
  function phaseOnDay(bands, day) {
    const PHASE_TINTS = ['blue', 'green', 'teal', 'purple', 'orange', 'pink', 'gold', 'red'];
    if (!Array.isArray(bands) || typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    for (const b of bands) {
      if (!b || !b.dated || typeof b.start !== 'string' || b.start > day || (b.end && b.end < day)) continue;
      return { id: b.id, label: String(b.label || ''), tint: PHASE_TINTS.includes(b.tint) ? b.tint : null, first: b.start === day };
    }
    return null;
  }

  // Which phase an object is in: its own, when that phase is still listed. Else null: it is "Unscheduled", the default phase of
  // an object with none (it never follows the calendar into today's phase).
  function phaseOf(item, bands) {
    const list = Array.isArray(bands) ? bands.filter(Boolean) : [];
    if (item && item.phase && list.some((b) => b.id === item.phase)) return item.phase;
    return null;
  }


  // The days an object occupies on the plan: its own day, a stay's check-out, and the day a journey arrives. One with no day of
  // its own occupies none (under "Unscheduled", its check-out or ticket arrival does not stretch the plan).
  function coverDaysOf(item) {
    if (!item || !item.date) return [];
    const days = [item.date];
    if (item.checkOut) days.push(item.checkOut);
    const a = arrivalOf(item);
    if (a && a.day) days.push(a.day);
    return days;
  }

  // The days the plan shows: from the earliest to the latest of the trip's start and end and every object's date
  // (a stay's check-out and a journey's arrival count). None of those: no days. Capped the same way as the trip's own days.
  function planDays(trip, items) {
    const dates = [];
    if (trip && isYmd(trip.start)) dates.push(trip.start);
    if (trip && isYmd(trip.end)) dates.push(trip.end);
    for (const item of items || []) for (const d of coverDaysOf(item)) if (isYmd(d)) dates.push(d);
    if (!dates.length) return [];
    dates.sort();
    return tripDays({ start: dates[0], end: dates[dates.length - 1] });
  }

  // An object moves the trip's dates only when its phase is the main one, or it has none. A phase that is not the
  // main one never does. With no object given, every date is considered (a caller that has already chosen).
  function phaseExtendsTrip(item, phases) {
    if (!item || !item.phase) return true;
    const main = (Array.isArray(phases) ? phases : []).find((p) => p && p.main);
    return Boolean(main) && item.phase === main.id;
  }

  // True when `end` is one of the first MAX_DAYS days from `start`, counting the start. The plan never
  // shows more than that (tripDays), so a trip must not grow past it either (GitHub #76).
  function withinDays(start, end) {
    if (!isYmd(start) || !isYmd(end) || end < start) return false;
    const first = parseYmd(start);
    for (let i = 0; i < MAX_DAYS; i += 1) {
      const k = ymd(new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
      if (k >= end) return true;
    }
    return false;
  }

  // Whether an object on `day` would show on the plan whose days are `days` (planDays): the plan stretches to it, or it already
  // is one of them. A day that would make the plan longer than MAX_DAYS would not show (plan-object-handoff.md, decision 12).
  function fitsPlan(days, day) {
    if (!isYmd(day) || !Array.isArray(days) || !days.length) return true;
    const first = days[0] < day ? days[0] : day;
    const last = days[days.length - 1] > day ? days[days.length - 1] : day;
    return withinDays(first, last);
  }

  // Move the trip's first or last day out so every given day sits on it. Only grows; never shrinks, and never
  // past MAX_DAYS. A day that would make it longer is listed in `outside` and left off. Null when there is no
  // trip yet, when the trip already covers every day, or when the object is in a phase that is not the main one.
  // With phases the plan sends only `end` to the host's cover route (the main phase's start is the timeline's); the
  // MAX_DAYS refusal is the same either way.
  function coverTrip(trip, dates, item, phases) {
    if (item && !phaseExtendsTrip(item, phases)) return null;
    if (!trip || !isYmd(trip.start)) return null;
    let start = trip.start;
    let end = isYmd(trip.end) ? trip.end : trip.start;
    const outside = [];
    for (const d of dates || []) {
      if (!isYmd(d)) continue;
      const nextStart = d < start ? d : start;
      const nextEnd = d > end ? d : end;
      if (!withinDays(nextStart, nextEnd)) outside.push(d);
      else { start = nextStart; end = nextEnd; }
    }
    const changed = start !== trip.start || end !== (isYmd(trip.end) ? trip.end : trip.start);
    if (!changed && !outside.length) return null;
    return { ...(changed ? { start, end } : {}), ...(outside.length ? { outside } : {}) };
  }

  // When an object's summary says it is: its `when` may be a day ("2026-10-03"), a moment (ISO text) or milliseconds (a poll's
  // closing time). Returns { day, time } with the time as "HH:MM" (empty for a whole day), or null.
  // A summary that says it is all day, or whose moment is exactly local midnight (what a date with no time turns into),
  // has no time of day.
  const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const clockOf = (d, summary) => (summary.allDay === true || (d.getHours() === 0 && d.getMinutes() === 0) ? '' : hhmm(d));
  function summaryWhen(summary) {
    const w = summary && summary.when;
    if (typeof w === 'number' && Number.isFinite(w)) { const d = new Date(w); return { day: ymd(d), time: clockOf(d, summary) }; }
    if (typeof w !== 'string' || !w) return null;
    if (w.length <= 10) return isYmd(w) ? { day: w, time: '' } : null;
    const d = new Date(w);
    return Number.isNaN(d.getTime()) ? null : { day: ymd(d), time: clockOf(d, summary) };
  }

  // Round trips. The later legs of a booking are the journeys whose `legOf` is the first leg's id, in `order` (two returns saved
  // at once by two people: the first is the return, the other reads as a journey of its own). A leg whose first leg is gone, or is
  // not a journey that can have legs, reads as a one-way journey.
  const byOrder = (a, b) => a.order - b.order || String(a.id).localeCompare(String(b.id));
  const canHaveLegs = (i) => Boolean(i) && i.kind === 'journey' && !i.legOf && i.mode !== 'car';
  function legsOf(items, id) {
    return items.filter((i) => i.kind === 'journey' && i.legOf === id && i.id !== id).sort(byOrder);
  }
  // The return of the journey `id`, or null.
  function returnOf(items, id) {
    return canHaveLegs(items.find((i) => i.id === id)) ? legsOf(items, id)[0] || null : null;
  }
  // The outbound of a return, or null (not a return, its outbound is gone, or it is a second return).
  function outboundOf(items, item) {
    if (!item || !item.legOf) return null;
    const out = items.find((i) => i.id === item.legOf);
    if (!canHaveLegs(out)) return null;
    return (returnOf(items, out.id) || {}).id === item.id ? out : null;
  }
  // A return placed before its outbound (allowed; its card says so). Both need a day; on one day, both need a time.
  function returnBefore(back, out) {
    if (!back || !out || !back.date || !out.date) return false;
    if (back.date !== out.date) return back.date < out.date;
    return Boolean(back.time && out.time && back.time < out.time);
  }

  // The items whose cost counts in Money: a return found with its outbound shares the outbound's, so it is not counted again.
  function costItems(items) {
    return items.filter((i) => i.cost && !outboundOf(items, i));
  }

  // The bookings: stays and journeys, in date and time order. A round trip is one booking: its return is not listed on its own.
  function bookings(items) {
    return items.filter((i) => (i.kind === 'stay' || i.kind === 'journey') && !outboundOf(items, i))
      .sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')) || String(a.time || '').localeCompare(String(b.time || '')) || String(a.id).localeCompare(String(b.id)));
  }

  // Who owes what. An item with a cost was paid by one person and is shared by the people it belongs to (all the
  // travellers when it belongs to nobody). Returns each person's paid, share and net (positive: owed money), the total,
  // and the fewest payments that settle it. `total` counts what someone paid; `planned` every cost, paid or not. Amounts are in the trip's one currency, rounded to cents.
  const cents = (n) => Math.round(n * 100);
  function balances(items, travellers) {
    const keys = travellers.slice();
    const paid = {};
    const share = {};
    let total = 0;
    let planned = 0;
    for (const item of items) {
      if (item.cost) planned += cents(item.cost);
      if (!item.cost || !item.paidBy) continue;
      const among = (item.owners.length ? item.owners : keys).filter(Boolean);
      if (!among.length) continue;
      const amount = cents(item.cost);
      total += amount;
      paid[item.paidBy] = (paid[item.paidBy] || 0) + amount;
      const each = Math.floor(amount / among.length);
      let rest = amount - each * among.length;
      for (const k of among) { share[k] = (share[k] || 0) + each + (rest > 0 ? 1 : 0); if (rest > 0) rest -= 1; }
    }
    const people = [...new Set([...keys, ...Object.keys(paid), ...Object.keys(share)])];
    const net = {};
    for (const k of people) net[k] = (paid[k] || 0) - (share[k] || 0);
    const owed = people.filter((k) => net[k] > 0).map((k) => [k, net[k]]).sort((a, b) => b[1] - a[1]);
    const owing = people.filter((k) => net[k] < 0).map((k) => [k, -net[k]]).sort((a, b) => b[1] - a[1]);
    const payments = [];
    let i = 0;
    let j = 0;
    while (i < owing.length && j < owed.length) {
      const amount = Math.min(owing[i][1], owed[j][1]);
      if (amount > 0) payments.push({ from: owing[i][0], to: owed[j][0], amount: amount / 100 });
      owing[i][1] -= amount;
      owed[j][1] -= amount;
      if (owing[i][1] === 0) i += 1;
      if (owed[j][1] === 0) j += 1;
    }
    const out = { total: total / 100, planned: planned / 100, paid: {}, share: {}, net: {}, payments };
    for (const k of people) { out.paid[k] = (paid[k] || 0) / 100; out.share[k] = (share[k] || 0) / 100; out.net[k] = net[k] / 100; }
    return out;
  }

  // --- what the Planner tells the space's status strip (host.facts; plan-space-story-strip.md step 6; #216) -----------
  // The facts, pure: the money spent so far (costs that have a payer, as the Money view's total), against the space's
  // budget target when one is set, and the next journey or stay from today on. `target` is the space's budget, { amount,
  // currency? } or null (no currency: the trip's); `currency` the trip's (else the server's); `money(amount, code)` words an
  // amount. Spent is always reported, so Set up can offer the target (the fact is marked `budget`): "Spent $0" on a new
  // trip. A target in another currency is shown, not compared. Over the target the icon is a warning (a full bar alone
  // would look the same as exactly on it) and the words say "over". The next booking carries its day as `when`
  // (YYYY-MM-DD) and words without a day ("SJC → ONT"): the host words the day against each viewer's own today and
  // leaves the fact out once it has passed, so it never reads a stale "tomorrow".
  const NEXT_ICONS = { flight: 'plane', train: 'train', bus: 'bus', ferry: 'ship', car: 'car', taxi: 'taxi', rideshare: 'car', shuttle: 'van-shuttle' };
  // Cut to `n` characters as a person counts them (code points), so an emoji is never split in half.
  const cutText = (s, n) => { const cps = [...String(s)]; return cps.length > n ? `${cps.slice(0, n - 1).join('')}…` : String(s); };
  function stripFacts({ items = [], travellers = [], today, target = null, currency = '', money, budgetOn = false }) {
    const facts = [];
    const spent = balances(costItems(items), travellers).total;
    const goal = target && Number(target.amount) > 0 ? Number(target.amount) : 0;
    const goalCode = goal ? String(target.currency || currency || '').toUpperCase() : '';
    const sameCode = !goal || !target.currency || goalCode === String(currency || '').toUpperCase();
    if (budgetOn) {
      // Budget is on in the space: it reports the one money fact (the bookings' costs included), so this module sends none.
    } else if (!goal) {
      facts.push({ id: 'spent', icon: 'coins', text: cutText(`Spent ${money(spent, currency)}`, 40), order: 10, budget: true });
    } else if (!sameCode) {
      facts.push({ id: 'spent', icon: 'coins', text: cutText(`${money(spent, currency)} of ${money(goal, goalCode)}`, 40), value: 'Another currency', order: 10, budget: true });
    } else {
      const over = spent > goal;
      const fact = { id: 'spent', icon: over ? 'circle-exclamation' : 'coins', text: cutText(`${money(spent, currency)} of ${money(goal, currency)}${over ? ' · over' : ''}`, 40), order: 10, budget: true };
      fact.value = cutText(over ? `${money(Math.round((spent - goal) * 100) / 100, currency)} over` : `${money(Math.round((goal - spent) * 100) / 100, currency)} left`, 24);
      fact.progress = Math.min(1, Math.round((spent / goal) * 1000) / 1000);
      facts.push(fact);
    }
    // The next journey or stay on or after today (a stay by its check-in), in day and time order.
    const next = items
      .filter((i) => (i.kind === 'journey' || i.kind === 'stay') && isYmd(i.date) && i.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || String(a.time || '').localeCompare(String(b.time || '')) || String(a.id).localeCompare(String(b.id)))[0];
    if (next) {
      const from = next.kind === 'journey' ? (next.fromCode || next.from || '') : '';
      const to = next.kind === 'journey' ? (next.toCode || next.to || '') : '';
      const what = from && to ? `${from} → ${to}` : next.title;
      const fact = { id: 'next', icon: next.kind === 'stay' ? 'bed' : NEXT_ICONS[next.mode] || 'route', text: cutText(what, 40), when: next.date, order: 20 };
      if (from && to && next.title) fact.value = cutText(next.title, 24);
      facts.push(fact);
    }
    return facts;
  }

  // --- what an item is, for its card and its editor ---------------------------------------------------------------
  // The editor's tiles, one per kind of thing, and the card's colour family and silhouette for each. A card's family is what
  // the stylesheet colours by (`data-type` on the row), so the kinds without a colour of their own borrow one.
  const TILES = ['flight', 'train', 'ferry', 'bus', 'car', 'taxi', 'rideshare', 'shuttle', 'hotel', 'restaurant', 'cafe', 'bar', 'sight', 'museum', 'attraction', 'tour', 'show', 'note'];
  const JOURNEY_TILES = ['flight', 'train', 'ferry', 'bus', 'car', 'taxi', 'rideshare', 'shuttle'];
  // An attraction (a theme park, a zoo: #246) is a stop like a sight, with the activity card.
  const STOP_TILES = ['restaurant', 'cafe', 'bar', 'sight', 'museum', 'attraction', 'tour', 'show'];
  // The tile an item shows under in the editor. A link (another module's object) has none.
  function tileOf(item) {
    if (!item) return 'sight';
    if (item.kind === 'journey') return item.mode === 'other' || !JOURNEY_TILES.includes(item.mode) ? 'bus' : item.mode;
    if (item.kind === 'stay') return 'hotel';
    if (item.kind === 'note') return 'note';
    if (item.kind === 'block') return `block:${item.type}`;
    if (item.kind === 'lane') return `lane:${item.type}`;
    if (item.kind === 'link') return null;
    if (STOP_TILES.includes(item.type)) return item.type;
    if (item.type === 'hike') return 'tour';
    if (item.type === 'beach' || item.type === 'shop' || item.type === 'spa') return 'sight';
    return item.category === 'eat' ? 'restaurant' : 'sight';
  }
  // The colour family of each kind in the editor's kind picker: degrees the accent's hue is turned, the same numbers the
  // cards use (`--turn` per `data-type` in travel-lib-cards.css), so the kind in the picker and its card look alike.
  const TURNS = { flight: 195, train: 150, ferry: 120, bus: 100, car: 45, taxi: 170, rideshare: 220, shuttle: 80, hotel: 255, restaurant: 0, cafe: 345, bar: 320, sight: 95, museum: 285, attraction: 240, tour: 65, show: 305, note: 25 };
  // The kind picker shows each marker type once (`marker:<type>`); Where decides whether it is stored in a day (a `block:`
  // tile) or at a joint between days (a `lane:` tile). kindOf: the picker's id for a tile; tileAt: the tile for a picker's id
  // at a Where value (`d:<day>` or `d:` a day, `j:<day>` or `j:` a joint).
  const kindOf = (tile) => (typeof tile === 'string' && (tile.startsWith('block:') || tile.startsWith('lane:')) ? `marker:${tile.slice(tile.indexOf(':') + 1)}` : tile);
  const tileAt = (kind, place) => (typeof kind === 'string' && kind.startsWith('marker:') ? `${String(place || '').startsWith('j:') ? 'lane' : 'block'}:${kind.slice(7)}` : kind);
  // The fields a chosen tile decides: `kind`, `mode` or `type`, and `category`. An item that keeps its tile keeps its finer type
  // (a hike stays a hike under the Tour tile; a rental stays a rental under Stay).
  function fromTile(tile, item) {
    if (typeof tile === 'string' && tile.startsWith('lane:')) return { kind: 'lane', type: tile.slice(5), category: 'other' };
    if (typeof tile === 'string' && tile.startsWith('block:')) return { kind: 'block', type: tile.slice(6), category: 'other' };
    const keep = item && tileOf(item) === tile;
    if (JOURNEY_TILES.includes(tile)) return { kind: 'journey', mode: keep && item.mode ? item.mode : tile, category: 'travel' };
    if (tile === 'hotel') return { kind: 'stay', type: keep && item.type ? item.type : 'hotel', category: 'stay' };
    if (tile === 'note') return { kind: 'note', category: 'other' };
    return { kind: 'stop', type: keep && item.type ? item.type : tile, category: tile === 'restaurant' || tile === 'cafe' || tile === 'bar' ? 'eat' : 'do' };
  }
  // How an item is drawn: its card's template, the colour family on its row, the kicker and the badge icon. A link is drawn
  // from the summary of the object it points at (`summary`, as host.objects.resolve gave it).
  const KICKERS = { flight: 'Flight', train: 'Train', ferry: 'Ferry', bus: 'Bus', car: 'Rental car', taxi: 'Taxi', rideshare: 'Ride share', shuttle: 'Shuttle', restaurant: 'Restaurant', cafe: 'Café', bar: 'Bar', sight: 'Sight', museum: 'Museum', attraction: 'Attraction', tour: 'Tour', hike: 'Hike', beach: 'Beach', shop: 'Shop', spa: 'Spa', show: 'Show', other: 'Stop' };
  const BADGES = { flight: 'plane', train: 'train', ferry: 'ship', bus: 'bus', car: 'car', taxi: 'taxi', rideshare: 'car-side', shuttle: 'van-shuttle', restaurant: 'utensils', cafe: 'mug-hot', bar: 'martini-glass', sight: 'monument', museum: 'building-columns', attraction: 'wand-magic-sparkles', tour: 'person-hiking', hike: 'person-hiking', beach: 'umbrella-beach', shop: 'bag-shopping', spa: 'spa', show: 'masks-theater', other: 'location-dot' };
  const STAY_KICKERS = { hotel: 'Hotel', rental: 'Rental', hostel: 'Hostel', camp: 'Camp', other: 'Stay' };
  function cardOf(item, summary) {
    if (item.kind === 'link') return { template: summary && !summary.error && summary.kind === 'place' ? 'place' : 'link', family: summary && !summary.error && summary.kind === 'place' ? 'place' : 'link', kicker: '', badge: '' };
    if (item.kind === 'note') return { template: 'note', family: 'note', kicker: 'Note', badge: '' };
    if (item.kind === 'block') return { template: 'block', family: 'block', kicker: '', badge: '' };
    if (item.kind === 'lane') return { template: 'lane', family: 'lane', kicker: '', badge: '' };
    if (item.kind === 'stay') return { template: 'hotel', family: 'hotel', kicker: STAY_KICKERS[item.type] || 'Hotel', badge: 'bed' };
    if (item.kind === 'journey') {
      const mode = JOURNEY_TILES.includes(item.mode) ? item.mode : 'bus';
      const template = mode === 'flight' ? 'flight' : mode === 'train' ? 'train' : 'transit';
      return { template, family: mode, kicker: item.mode === 'other' ? 'Transit' : KICKERS[mode], badge: BADGES[mode] };
    }
    const t = item.type || (item.category === 'eat' ? 'restaurant' : item.category === 'do' ? 'sight' : 'other');
    const family = ['hike', 'beach', 'shop', 'spa', 'other'].includes(t) ? 'sight' : t;
    const template = t === 'restaurant' || t === 'cafe' || t === 'bar' ? 'meal' : t === 'show' ? 'show' : 'activity';
    return { template, family, kicker: KICKERS[t] || 'Stop', badge: BADGES[t] || 'location-dot' };
  }
  // The icon for the way to a stop.
  const LEG_ICONS = { walk: 'person-walking', drive: 'car', transit: 'bus', bike: 'bicycle', taxi: 'taxi', rideshare: 'car-side' };

  // The first and last booked items of a plan: where the trip itself starts and ends (as opposed to the days planned for it).
  // "Booked" is a journey, a stay, or anything with a confirmation; with none of those, the first and last timed item. Only items
  // on a day count. { start: { id, day, time }, end: { id, day, time } } (`time` is when the item starts, and for the end its
  // arrival or check-out), or null when nothing qualifies.
  function tripBounds(items) {
    const dated = items.filter((i) => i.kind !== 'link' && i.kind !== 'note' && i.kind !== 'block' && i.kind !== 'lane' && i.date);
    let pool = dated.filter((i) => i.kind === 'journey' || i.kind === 'stay' || i.confirm);
    if (!pool.length) pool = dated.filter((i) => i.time);
    if (!pool.length) return null;
    const endOf = (i) => {
      if (i.kind === 'stay') return { day: i.checkOut || i.date, time: i.checkOutTime || '' };
      if (i.checkOut) return { day: i.checkOut, time: '' }; // a rental car's drop-off
      const a = arrivalOf(i);
      if (a) return { day: a.day, time: a.time };
      return { day: i.date, time: i.time || '' };
    };
    // An item with no time is the least certain: it does not start the day's trip before a timed one, nor end it after one.
    const startKey = (i) => `${i.date} ${i.time || '24:00'}`;
    const endKey = (i) => { const e = endOf(i); return `${e.day} ${e.time || '00:00'}`; };
    const first = [...pool].sort((a, b) => startKey(a).localeCompare(startKey(b)) || a.order - b.order)[0];
    const last = [...pool].sort((a, b) => endKey(b).localeCompare(endKey(a)) || b.order - a.order)[0];
    const e = endOf(last);
    return { start: { id: first.id, day: first.date, time: first.time || '' }, end: { id: last.id, day: e.day, time: e.time } };
  }

  // An `order` for an item placed among the ones already at a joint (`others`, in their order): before or after the one with id
  // `targetId`, or at the end when there is none.
  function jointOrder(others, targetId, where) {
    const at = targetId ? others.findIndex((l) => l.id === targetId) : -1;
    if (at < 0) return others.length ? Math.max(...others.map((l) => l.order)) + 1000 : 1000;
    const lo = where === 'before' ? (others[at - 1] ? others[at - 1].order : others[at].order - 2000) : others[at].order;
    const hi = where === 'before' ? others[at].order : (others[at + 1] ? others[at + 1].order : others[at].order + 2000);
    return (lo + hi) / 2;
  }
