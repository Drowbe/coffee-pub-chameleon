
  // The plan itself: the trip and its items, kept in the module's own store and live for everyone. No page in it,
  // so the page, the widget and the checks can all use it. Each item is its own stored value (`plan:<id>`) and the
  // trip is one (`trip`), so two people editing different items never collide; an edit to an item someone else
  // changed meanwhile is refused with `error.conflict` and the newer copy is loaded.
  function createPlan(host) {
    const objectKey = host.util.objectKey;
    const items = new Map(); // id -> { item, version, key }: `key` is where it is stored (see PLAN_PREFIX)
    const summaries = new Map(); // pointer key -> the summary of the object it points at, or { error } when it is gone or not for this viewer
    let trip = null;
    let tripVersion = null;
    let suggested = [];
    let waiting = []; // other modules' open polls and tasks due before the trip (the Decisions view)
    const listeners = new Set();
    const changed = () => { for (const fn of listeners) fn(); };

    const remember = (key, value, version) => {
      if (key === TRIP_KEY) {
        trip = value ? cleanTrip(value) : null;
        tripVersion = value ? version : null;
      } else {
        const id = planIdOf(key);
        if (id === null) return;
        // An item still under its old key while it has one under the new: the new one is the item.
        if (key.startsWith(OLD_PLAN_PREFIX) && items.has(id) && items.get(id).key.startsWith(PLAN_PREFIX)) return;
        const item = value ? cleanItem({ ...value, id }) : null;
        if (item) items.set(id, { item, version, key });
        else if ((items.get(id) || {}).key === key) items.delete(id);
      }
    };

    // Move one item from its old key to `plan:<id>`: written only where nothing is yet, then the old key removed as it was read.
    // Anyone else doing the same at the same time is harmless: whichever write lands second is refused. When `plan:<id>` is
    // already there with a different value, the old key is left where it is, never deleted: the plan shows the new one, and
    // nothing anyone wrote is lost.
    async function moveOld(entry) {
      const id = entry.key.slice(OLD_PLAN_PREFIX.length);
      try {
        await host.storage.set(PLAN_PREFIX + id, entry.value, { version: 0 });
      } catch (err) {
        if (!err || err.status !== 409) throw err;
        const there = await host.storage.get(PLAN_PREFIX + id);
        if (there && JSON.stringify(there.value) !== JSON.stringify(entry.value)) return;
      }
      try {
        await host.storage.delete(entry.key, { version: entry.version });
      } catch (err) {
        if (!err || err.status !== 409) throw err; // changed meanwhile (an old page still open): moved on its next change
      }
    }
    // The plan's old `item:` keys renamed to `plan:` (plan-names decision 19), once in each place, recorded under MOVED_KEY. Someone
    // who cannot edit moves nothing and records nothing; the plan reads both kinds of key, so they see it all the same.
    async function moveOldKeys() {
      try {
        if (await host.storage.get(MOVED_KEY)) return;
        for (const entry of await host.storage.list(OLD_PLAN_PREFIX)) await moveOld(entry);
        await host.storage.set(MOVED_KEY, { at: new Date().toISOString() }, { version: 0 });
      } catch (err) {
        // not allowed to write here, or it failed part way: tried again on the next load; nothing is lost meanwhile
      }
    }

    const templatePhases = () => (typeof host.phases === 'function' ? host.phases() : []) || [];
    // The space's phase timeline (plan-one-bar.md step 2), [] without phases or on a host without the rule.
    // The space's dates come from the hello and then from the host's 'phases' event (host.on('phases'), host.space().phases
    // kept current), so refreshPhases reads host.util.phaseTimeline() again and, when the dates differ, the plan uses them.
    let phaseNow = null; // { dates, created } once asked and different from the hello's
    const bands = () => {
      if (!templatePhases().length || !host.util || typeof host.util.phaseTimeline !== 'function') return [];
      try { return host.util.phaseTimeline({ today: ymd(new Date()), ...(phaseNow || {}) }) || []; } catch (err) { return []; }
    };
    const heldNow = typeof host.space === 'function' ? host.space() : null;
    let phaseSeen = heldNow ? JSON.stringify([heldNow.phases || {}, heldNow.createdAt || null]) : null; // the hello's dates
    function refreshPhases() {
      const here = typeof host.space === 'function' ? host.space() : null;
      if (!here || !templatePhases().length) return false;
      const next = JSON.stringify([here.phases || {}, here.createdAt || null]);
      if (next === phaseSeen) return false;
      phaseSeen = next;
      phaseNow = { dates: here.phases || {}, created: here.createdAt };
      changed();
      return true;
    }
    const phased = () => templatePhases().length > 0;
    // The trip as the plan shows it: with phases, its first and last day are the main band's (null while the main
    // phase has no start) and never the stored ones; a space with dated phases has a trip even before anything is
    // stored. Without phases, the stored trip as it is.
    const withDates = (t) => {
      if (!phased()) return t;
      const span = tripSpan(null, bands());
      if (!t && !span.start) return null;
      return { ...(t || cleanTrip({})), start: span.start, end: span.end };
    };

    // What the plan points at, told to the host (setLinks), so the object pointed at can show "Used by" and warn before it is deleted
    // (Places does). Fire and forget: a viewer who may not write is refused, and the plan works the same.
    const planRef = (id) => host.objects.make('plan', id);
    function setLink(id, ref) {
      if (!host.objects || typeof host.objects.setLinks !== 'function') return Promise.resolve(false);
      return host.objects.setLinks(planRef(id), ref ? [ref] : []).then(() => true).catch(() => false);
    }
    // Plans made before the plan told the host: once per browser and change, tell it for every item that points at something. What was
    // told is kept here ({ id: pointer key }) so a page load asks only about what changed.
    async function backfillLinks() {
      if (!host.objects || typeof host.objects.setLinks !== 'function' || typeof host.can !== 'function' || !host.can('edit')) return;
      const here = typeof host.space === 'function' ? host.space() : null;
      const key = `travel-links-told.${(here && here.id) || ''}`;
      let told = {};
      try { told = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (err) { told = {}; }
      const now = {};
      const todo = [...items.values()].map((x) => x.item).filter((i) => i.ref).slice(0, 200);
      for (const i of todo) now[i.id] = objectKey(i.ref);
      for (const id of Object.keys(told)) if (!now[id] && !items.has(id)) delete told[id];
      let changed = false;
      for (const i of todo) {
        if (told[i.id] === now[i.id]) continue;
        if (await setLink(i.id, i.ref)) { told[i.id] = now[i.id]; changed = true; }
      }
      if (changed) { try { localStorage.setItem(key, JSON.stringify(told)); } catch (err) { /* not kept */ } }
    }

    async function load() {
      await moveOldKeys();
      const t = await host.storage.get(TRIP_KEY);
      remember(TRIP_KEY, t ? t.value : null, t ? t.version : null);
      items.clear();
      for (const it of await host.storage.list(PLAN_PREFIX)) remember(it.key, it.value, it.version);
      for (const it of await host.storage.list(OLD_PLAN_PREFIX)) remember(it.key, it.value, it.version);
      changed();
      resolveSummaries().catch(() => {});
      backfillLinks().catch(() => {});
    }

    host.on('change', (e) => {
      if (e.scope === 'spaces') return;
      if (e.key !== TRIP_KEY && planIdOf(e.key) === null) return;
      remember(e.key, e.deleted ? null : e.value, e.version);
      changed();
      if (planIdOf(e.key) === null) return;
      resolveSummaries().catch(() => {});
      // An old page still open wrote under the old key: move it along, when this person may.
      if (!e.deleted && String(e.key).startsWith(OLD_PLAN_PREFIX)) moveOld({ key: e.key, value: e.value, version: e.version }).catch(() => {});
    });

    // The summaries of the objects other modules hold that this plan points at.
    // `all` asks again for every one (an object may have been changed or deleted where it lives), not just the new ones.
    async function resolveSummaries(all) {
      const want = [...items.values()].map((x) => x.item).filter((i) => i.ref && (all || !summaries.has(objectKey(i.ref)))).map((i) => i.ref);
      if (!want.length) return;
      let got;
      try {
        got = await host.objects.resolve(want);
      } catch (err) {
        if (all) return; // asking again failed: what was shown stays as it was
        got = want.map(() => ({ error: 'unavailable' }));
      }
      want.forEach((r, i) => summaries.set(objectKey(r), got[i] || { error: 'unavailable' }));
      changed();
    }

    // The day of an item: its own, or for a pointer with no place of its own the day of the object it points at. An item on the
    // line (at a joint) has no day.
    const dayOf = (item) => {
      if (item.date) return item.date;
      if (item.after !== null && item.after !== undefined) return null;
      const c = item.ref ? summaries.get(objectKey(item.ref)) : null;
      const w = c && !c.error ? summaryWhen(c) : null;
      return w ? w.day : null;
    };
    // The joint an item is at on the line ('' the head, else the day it follows), or null when it is on a day.
    const jointOf = (item) => lineOf(item, dayOf(item));

    const list = () => [...items.values()].map((x) => x.item);
    // An item as it is placed in a day: a pointer with no time of its own takes the time its object's summary gives, so it sorts
    // where that time says.
    const timed = (item) => {
      if (item.time || !item.ref) return item;
      const c = summaries.get(objectKey(item.ref));
      const w = c && !c.error ? summaryWhen(c) : null;
      return w && w.time ? { ...item, time: w.time } : item;
    };
    // The items on days (what the days see); items on the line are not among them.
    const sortable = () => list().filter((i) => jointOf(i) === null).map(timed);
    // The items on the line, in the order they are on it: by joint (the head first, then the day each follows), then by hand order.
    const onLine = () => sortLine(list().filter((i) => jointOf(i) !== null).map((i) => ({ ...i, after: jointOf(i) })));
    const atJoint = (after) => onLine().filter((i) => i.after === after);
    const days = () => planDays(withDates(trip), list().map((i) => ({ ...i, date: dayOf(i) })));
    const byDay = () => itemsByDay(sortable(), days(), dayOf);
    const nextOrder = (date) => {
      const same = sortable().filter((i) => !i.time && i.date === date);
      return same.length ? Math.max(...same.map((i) => i.order)) + 1000 : 1000;
    };
    const nextJointOrder = (after) => jointOrder(atJoint(after), null, null);

    // With phases, the dates are the space's: `start` and `end` are left out of what is written (an old trip's are
    // dropped here), and any stored `phases` goes with them (cleanTrip never keeps it).
    async function saveTrip(patch) {
      const clean = cleanTrip({ ...(trip || {}), ...patch, by: host.user.name });
      const { start: _s, end: _e, ...rest } = clean;
      const next = phased() ? rest : clean;
      const saved = await host.storage.set(TRIP_KEY, next, tripVersion === null ? {} : { version: tripVersion });
      remember(TRIP_KEY, next, saved.version);
      changed();
      return withDates(trip);
    }

    // The main phase's end moved later to cover `day` through the host (host.phasesCover, the cover route): only the
    // end moves, and every later boundary with it. Nothing without phases, or on a host without the call.
    async function coverDay(day) {
      if (!phased() || typeof host.phasesCover !== 'function') return null;
      const result = await host.phasesCover(day);
      changed();
      return result;
    }

    async function stretchFor(item) {
      const current = withDates(trip);
      const span = coverTrip(current, coverDaysOf(item), item, templatePhases());
      if (span && span.start) {
        // With phases only the main phase's end may move (the sheet sets its start); without, the plan's own dates grow.
        if (phased()) { if (span.end > current.end) await coverDay(span.end); } else await saveTrip({ start: span.start, end: span.end });
      }
      // No trip yet, or a phase that is not the main one: the object is kept, and nothing is left off the day list.
      const missed = span && span.outside;
      if (!missed || !missed.length) return;
      throw new Error(missed.length > 1
        ? `A plan can be at most ${MAX_DAYS} days long, so those days are left off the plan.`
        : `A plan can be at most ${MAX_DAYS} days long, so that day is left off the plan.`);
    }

    async function addItem(fields) {
      const id = host.util.id();
      const onTheLine = !fields.date && (fields.after === '' || isYmd(fields.after) || fields.kind === 'lane');
      const item = cleanItem({ ...fields, id, order: fields.order ?? (onTheLine ? nextJointOrder(fields.after || '') : nextOrder(fields.date)), by: host.user.name });
      if (!item) throw new Error('that needs a title');
      const { id: _drop, ...value } = item;
      const saved = await host.storage.set(PLAN_PREFIX + id, value, {});
      items.set(id, { item, version: saved.version, key: PLAN_PREFIX + id });
      changed();
      if (item.ref) { setLink(id, item.ref); resolveSummaries().catch(() => {}); }
      try {
        await stretchFor(item);
      } catch (err) {
        err.item = item; // it is saved; only a day of it is left off
        throw err;
      }
      return item;
    }

    // An object handed in from elsewhere (an import, an AI's answer, another module's idea): on its day when the plan can show
    // that day. A day past the plan's MAX_DAYS would show nowhere, so it goes under "Unscheduled" with "Dated <day>,
    // outside the plan" in its notes (plan-object-handoff.md, decision 12). What the person should know is said through
    // onSaid (the page's note) and comes back with the result.
    async function addHandedIn(fields) {
      const said = [];
      let next = fields;
      if (next.date && !fitsPlan(days(), next.date)) {
        said.push(`${next.title} is dated ${next.date}, outside the plan's ${MAX_DAYS} days, so it is under Unscheduled.`);
        next = { ...next, date: null, after: null, arrives: relativeArrives(next.date, next.arrives), notes: [`Dated ${next.date}, outside the plan`, next.notes].filter(Boolean).join('\n\n') };
      }
      // On its day, its check-out or its ticket's arrival must fit too, else the plan would grow to 60 days of nothing (with no
      // trip set, quietly): that one is kept as a notes line instead, and said.
      if (next.date) {
        const span = [...days(), next.date].sort();
        const keepAsLine = (line, what, day) => {
          next = { ...next, notes: [next.notes, line].filter(Boolean).join('\n\n') };
          said.push(`${next.title}: ${what}, ${day}, is outside the plan's ${MAX_DAYS} days, so it is in its notes.`);
        };
        if (isYmd(next.checkOut) && !fitsPlan(span, next.checkOut)) {
          const out = next.checkOut;
          keepAsLine(`Check out: ${out}${next.checkOutTime ? ` ${next.checkOutTime}` : ''}`, 'its check-out', out);
          next = { ...next, checkOut: null, checkOutTime: null };
        }
        if (typeof next.arrives === 'string' && next.arrives.length === 16 && !fitsPlan(span, next.arrives.slice(0, 10))) {
          const arrives = next.arrives;
          keepAsLine(arrivesLine(arrives), 'its arrival', arrives.slice(0, 10));
          next = { ...next, arrives: null };
        }
      }
      let item;
      try {
        item = await addItem(next);
      } catch (err) {
        if (!err.item) throw err;
        item = err.item;
        said.push(err.message);
      }
      const words = said.join(' ');
      if (words && tell) tell(words);
      return { ref: host.objects.make('plan', item.id), ...(words ? { data: { note: words } } : {}) };
    }

    // A journey moved to another day (dragged, "Move to...", earlier or later) takes its ticket's dated arrival along, the same
    // number of days later or earlier, unless the change says its own arrival (the editor does). Moved off its days (onto the
    // line, under "Unscheduled"), the arrival is kept relative to the day it left ("06:30+1"), and cleanItem dates it
    // again on whatever day it is put back on.
    const withArrival = (item, patch) => {
      if (!patch || patch.arrives !== undefined || !Object.prototype.hasOwnProperty.call(patch, 'date')) return patch;
      if (!item.date || patch.date === item.date || typeof item.arrives !== 'string' || item.arrives.length !== 16) return patch;
      if (!isYmd(patch.date)) return { ...patch, arrives: relativeArrives(item.date, item.arrives) };
      return { ...patch, arrives: shiftArrives(item.arrives, Math.round((parseYmd(patch.date) - parseYmd(item.date)) / DAY_MS)) };
    };

    async function updateItem(id, patch) {
      const cur = items.get(id);
      if (!cur) throw new Error(`that ${host.util.word('object')} is not here any more`);
      patch = withArrival(cur.item, patch);
      const item = cleanItem({ ...cur.item, ...patch, id });
      if (!item) throw new Error('that needs a title');
      const { id: _drop, ...value } = item;
      try {
        // Still under its old key (someone who could not move it loaded it): saved under the new one, and the old one goes.
        const moving = cur.key !== PLAN_PREFIX + id;
        const saved = await host.storage.set(PLAN_PREFIX + id, value, moving ? {} : { version: cur.version });
        if (moving) await host.storage.delete(cur.key).catch(() => {});
        items.set(id, { item, version: saved.version, key: PLAN_PREFIX + id });
        changed();
        if ((cur.item.ref ? objectKey(cur.item.ref) : '') !== (item.ref ? objectKey(item.ref) : '')) setLink(id, item.ref || null);
        await stretchFor(item);
        return item;
      } catch (err) {
        if (err && err.status === 409) {
          const fresh = await host.storage.get(PLAN_PREFIX + id).catch(() => null);
          if (fresh) remember(fresh.key, fresh.value, fresh.version); else items.delete(id);
          changed();
          const conflict = new Error('someone changed this first');
          conflict.conflict = true;
          throw conflict;
        }
        throw err;
      }
    }

    async function removeItem(id) {
      const cur = items.get(id);
      if (!cur) return;
      await host.storage.delete(cur.key || PLAN_PREFIX + id);
      items.delete(id);
      changed();
      if (cur.item.ref) setLink(id, null);
    }

    // A round trip: the outbound, then the return pointing at it. A car cannot be one.
    async function addRoundTrip(outFields, backFields) {
      if (outFields.mode === 'car') throw new Error('A rental car cannot be a round trip.');
      const out = await addItem({ ...outFields, kind: 'journey', legOf: null });
      const back = await addItem({ ...backFields, kind: 'journey', mode: out.mode, legOf: out.id, confirm: '', cost: null, estimate: null, paidBy: '' });
      return { out, back };
    }
    const returnFor = (id) => returnOf(list(), id);
    const outboundFor = (item) => outboundOf(list(), item);
    // The returns of `id` beyond the first (two people added one at the same time).
    const extraReturns = (id) => (returnFor(id) ? legsOf(list(), id).slice(1) : []);
    // Deleting a leg of a round trip: both legs (and any extra return), or only this one. Only the outbound: the return becomes a
    // one-way journey and takes the booking reference, the cost and who paid, so nothing that was paid disappears. Not a leg of a
    // round trip: the item alone.
    async function removeLeg(id, both) {
      const all = list();
      const item = all.find((i) => i.id === id);
      if (!item) return;
      const out = item.legOf ? outboundOf(all, item) : item;
      const back = out ? returnOf(all, out.id) : null;
      if (!out || !back) return removeItem(id);
      if (both) {
        for (const leg of legsOf(all, out.id)) await removeItem(leg.id);
        return removeItem(out.id);
      }
      if (id === out.id) await updateItem(back.id, { legOf: null, confirm: out.confirm, cost: out.cost, estimate: out.estimate, paidBy: out.paidBy });
      return removeItem(id);
    }

    // Several items changed at once, from a move: { id: patch }.
    async function applyChanges(changes) {
      for (const [id, patch] of Object.entries(changes)) await updateItem(id, patch);
    }

    // Put the item at a place in a day (the drag, and "Move to..."): untimed items are ordered by hand, a timed
    // one only changes day. Coming off the line, it leaves its joint. A link dragged to a day other than its
    // object's day stays there (`pinned`); dragged back onto that day, it follows the object again.
    function pinPatch(item, date) {
      if (item.kind !== 'link' || !item.ref || !date) return {};
      const summary = summaries.get(objectKey(item.ref));
      const when = summary && !summary.error ? summaryWhen(summary) : null;
      if (!when || !when.day) return {};
      return { pinned: date !== when.day };
    }
    async function moveTo(id, date, index) {
      const cur = items.get(id);
      if (!cur) return;
      const pin = pinPatch(cur.item, date);
      if (timed(cur.item).time) return void (await updateItem(id, { date, after: null, ...pin }));
      const dayUntimed = sortDay(sortable().filter((i) => !i.time && dayOf(i) === date && i.id !== id));
      const changes = placeUntimed(dayUntimed, cur.item, date, index);
      changes[id] = { ...(changes[id] || {}), after: null, ...pin };
      await applyChanges(changes);
    }
    // Put the item at a joint on the line ('' the head), at `index` among the items already there.
    async function moveToJoint(id, after, index) {
      const cur = items.get(id);
      if (!cur) return;
      const others = atJoint(after).filter((i) => i.id !== id);
      const changes = placeUntimed(others, cur.item, null, index);
      changes[id] = { ...(changes[id] || {}), date: null, after };
      await applyChanges(changes);
    }
    // The objects as the day menu sees them: each with the day it is on (a pointer follows its object's day), the line's with none.
    const onDays = () => list().map((i) => ({ ...i, date: dayOf(i) }));
    // What "Move all to..." would do, with nothing changed: { changes, moved, days, delta } (see shiftDays). `rest` moves every
    // day from `from` on by the same days.
    const previewMove = (from, to, rest) => shiftDays(onDays(), from, to, rest);
    // Everything on `from` (and with `rest`, every day after it) moved by the days between `from` and `to`, merged with what is
    // there. When the first day of a plan with its own dates is slid, the plan's dates slide with it, so no empty days are left at
    // the start; with phases the dates are the space's and stay. A pointer moved off its object's day stays there (pinned), as
    // when it is dragged. Nothing else in the space is changed: a Calendar event keeps its own day.
    async function moveDays(from, to, rest) {
      const r = shiftDays(onDays(), from, to, rest);
      const slide = Boolean(rest && r.delta && !phased() && trip && isYmd(trip.start) && from === days()[0]);
      if (!r.moved && !slide) return r;
      const moving = new Set(Object.keys(r.changes));
      const dates = [...onDays().filter((i) => !moving.has(i.id)).map((i) => i.date), ...Object.values(r.changes).flatMap((c) => [c.date, c.checkOut]), ...(slide ? [daysLater(trip.start, r.delta), daysLater(trip.end || trip.start, r.delta)] : days())].filter(isYmd).sort();
      if (dates.length && Math.round((parseYmd(dates[dates.length - 1]) - parseYmd(dates[0])) / DAY_MS) + 1 > MAX_DAYS) throw new Error(`A plan can be at most ${MAX_DAYS} days long, so that move is too far.`);
      if (slide) await saveTrip({ start: daysLater(trip.start, r.delta), end: daysLater(trip.end || trip.start, r.delta) });
      const changes = {};
      for (const [id, patch] of Object.entries(r.changes)) {
        const cur = items.get(id);
        changes[id] = cur ? { ...patch, ...pinPatch(cur.item, patch.date) } : patch;
      }
      await applyChanges(changes);
      return r;
    }
    // What "Clear this day" would do: { changes, moved, kept } (see clearDay).
    const previewClear = (day) => clearDay(onDays(), day);
    // The day's objects taken off it and kept, with no day: under "Unscheduled". Nothing is deleted.
    async function clearDayOf(day) {
      const r = clearDay(onDays(), day);
      await applyChanges(r.changes);
      return r;
    }
    // Earlier or later: on a day, the day's own rule (nudge); on the line, a swap with the neighbour at the joint, and at
    // either end of a joint a hop to the next one.
    async function nudgeItem(id, direction) {
      const cur = items.get(id);
      if (!cur) return;
      const joint = jointOf(cur.item);
      if (joint === null) {
        const day = dayOf(cur.item);
        const changes = nudge(sortDay(sortable().filter((i) => dayOf(i) === day)), timed(cur.item), direction);
        if (changes) await applyChanges(changes);
        return;
      }
      const here = atJoint(joint);
      const changes = nudge(here, { ...cur.item, time: null }, direction);
      if (changes) return void (await applyChanges(changes));
      const all = joints(days());
      const next = all[all.indexOf(joint) + direction];
      if (next === undefined) return;
      await moveToJoint(id, next, direction < 0 ? 1e6 : 0);
    }

    // A pointer to another module's object, put at a place: `{ date }` a day, `{ after }` a joint on the line, or nothing (the
    // pointed-at object's own day when it has one, else the head of the line).
    const addLink = (ref, place, title) => addItem({ kind: 'link', ref, ...placeFields(place), title: title || '' });

    // Dated objects other modules hold in this space, on days of the trip, that the plan does not already point at:
    // what the plan could take in. Nothing is stored until one is added. A Calendar copy of the plan's own object (`copy`, set
    // by the host) is never offered: that would be the plan's own item coming back.
    async function suggest() {
      const tripDaysList = days();
      let found = [];
      try {
        found = await host.objects.search('');
      } catch (err) {
        found = [];
      }
      // Decisions: a poll still open, and a task not done with a due day before the trip starts (or already past).
      const first = (withDates(trip) || {}).start || tripDaysList[0] || '';
      waiting = found.filter((c) => c && c.ref && c.module && c.module.id !== 'travel' && !c.copy && c.done !== true
        && (c.kind === 'poll' || (c.kind === 'task' && first && (summaryWhen(c) || {}).day && summaryWhen(c).day < first)));
      if (!tripDaysList.length) { suggested = []; changed(); return suggested; }
      const pinned = new Set(list().filter((i) => i.ref).map((i) => objectKey(i.ref)));
      suggested = found.filter((c) => c && c.ref && c.module && c.module.id !== 'travel' && !c.copy && !pinned.has(objectKey(c.ref)) && tripDaysList.includes((summaryWhen(c) || {}).day));
      changed();
      return suggested;
    }

    // What other modules may ask of this one, and what it is when they do.
    function provide() {
      if (!host.actions || !host.actions.provide) return;
      host.actions.provide({
        addStop: async (input) => {
          const date = input.date && isYmd(input.date) ? input.date : null;
          const item = input.ref
            ? await addLink(input.ref, date, input.title)
            : await addItem({ kind: 'stop', title: input.title, date, notes: input.notes || '' });
          return { ref: host.objects.make('plan', item.id) };
        },
        addToDay: async (input) => {
          // `item` is what the input was called before the rename (a request queued then is still carried out).
          const item = await addLink(input.object || input.item, isYmd(input.date) ? input.date : null);
          return { ref: host.objects.make('plan', item.id) };
        },
        // A suggestion from anywhere (an AI's typed summary, another module's idea): placed as the right kind of item when its
        // `kind` is one of the everyday words a journey, a stay or a stop already knows (a flight, a hotel, a sight...); an
        // unrecognised or missing kind is an ordinary stop, the same as addStop. Found by name and input shape, never by
        // whoever asks for it.
        // With `object` (plan-object-handoff.md): the whole object, its details in the plan's own fields (fromObject).
        acceptSuggestion: async (input) => addHandedIn(input.object ? fromObject(input.object) : fromSuggestion(input)),
        addFromText: async (input) => {
          if (!composeFromText) throw new Error('the Planner is not open');
          composeFromText(String(input.text || ''));
          return {};
        },
      });
    }
    let composeFromText = null;
    function onFromText(fn) { composeFromText = fn; }
    // Who hears what an object handed in needs said (the page's note).
    let tell = null;
    function onSaid(fn) { tell = fn; }
    // The item an object of the objects format becomes (objectFields in travel-lib-object.js), with host.util's plain text and
    // local times. `place` ({ date } or { after }): the Planner's own drop, whose day wins over the object's.
    const fromObject = (object, place) => objectFields(object, host.util, place);
    // The item a suggestion becomes ({ title, kind?, content?, place?, date? }, an AI's summary or a summary dropped here):
    // the right kind when `kind` is one of the everyday words a journey, a stay or a stop already knows, else a stop.
    function fromSuggestion(input) {
      // A title is plain text (decision 5); the notes keep their Markdown, which the plan draws.
      const plainTitle = typeof host.util.plain === 'function' ? host.util.plain(String(input.title ?? ''), { line: true }) : input.title;
      const title = clip(plainTitle, 120);
      if (!title) throw new Error('that needs a title');
      const fields = { title, ...placeFields(input), notes: clip(input.content, 8000), place: clip(input.place, 120) };
      const kindWord = typeof input.kind === 'string' ? input.kind : '';
      if (MODES.includes(kindWord)) { fields.kind = 'journey'; fields.mode = kindWord; }
      else if (STAY_TYPES.includes(kindWord)) { fields.kind = 'stay'; fields.type = kindWord; }
      else if (STOP_TYPES.includes(kindWord)) { fields.kind = 'stop'; fields.type = kindWord; }
      else fields.kind = 'stop';
      return fields;
    }

    return {
      refreshSummaries: () => resolveSummaries(true), refreshPhases, load, list, onLine, atJoint, sortable, days, byDay, dayOf, jointOf, summaries, suggest, provide, onFromText, onSaid, saveTrip, coverDay, bands, phased, addItem, updateItem, removeItem, addRoundTrip, returnFor, outboundFor, extraReturns, removeLeg, applyChanges, moveTo, moveToJoint, previewMove, moveDays, previewClear, clearDay: clearDayOf, nudgeItem, addLink, fromSuggestion, fromObject,
      get trip() { return withDates(trip); },
      get suggestions() { return suggested; },
      get waiting() { return waiting; },
      versionOf: (id) => (items.get(id) || {}).version,
      subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    };
  }
