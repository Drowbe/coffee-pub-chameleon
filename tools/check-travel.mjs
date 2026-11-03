#!/usr/bin/env node
/*
 * check-travel.mjs -- run the Travel module's model (modules/travel/src/travel-lib.js) on its own.
 * The library is written to be inlined into a module page, so it is loaded here as a function body with the two
 * date helpers a page gets from the SDK.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (name) => fs.readFileSync(new URL(`../modules/travel/src/${name}`, import.meta.url), 'utf8');
// In the build's order: travel-lib.js, then travel-lib-*.js by name.
const src = read('travel-lib.js') + '\n' + read('travel-lib-object.js') + '\n' + read('travel-lib-plan.js');
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const names = ['followDay', 'arrivalDays', 'arrivalParts', 'arrivalJoin', 'checkoutDays', 'STOP_TILES', 'KICKERS', 'BADGES', 'bookings', 'balances', 'summaryWhen', 'TRIP_KEY', 'PLAN_PREFIX', 'OLD_PLAN_PREFIX', 'MOVED_KEY', 'planIdOf', 'createPlan', 'cleanTrip', 'tripSpan', 'mainBand', 'currentBand', 'cleanItem', 'coverTrip', 'coverDaysOf', 'tripDays', 'planDays', 'dayLabel', 'daysUntil', 'sortDay', 'itemsByDay', 'orderBetween', 'renumber', 'placeUntimed', 'nudge', 'gapMinutes', 'gapText', 'stayNights', 'MODES', 'STOP_TYPES', 'STAY_TYPES', 'TRAVEL_MODES', 'jointOrder', 'lineOf', 'joints', 'sortLine', 'placeFields', 'tripBounds', 'tileOf', 'fromTile', 'cardOf', 'TILES', 'TURNS', 'kindOf', 'tileAt', 'LEG_ICONS', 'JOURNEY_TILES', 'KICKERS', 'BADGES', 'splitMinutes', 'joinMinutes', 'legsOf', 'returnOf', 'outboundOf', 'returnBefore', 'costItems', 'MAX_MINUTES', 'arrivalOf', 'laterText', 'phaseOf', 'planName', 'createdDay', 'fitsPlan', 'objectFields', 'minutesBetween', 'arrivalFits', 'shiftArrives', 'relativeArrives', 'datedArrives', 'flightNumberOf', 'flightObject', 'lookupFill', 'numberToSave', 'lookupApply', 'shiftDays', 'clearDay', 'phaseOnDay', 'stripFacts', 'lengthBetween', 'endOf'];
const lib = new Function('ymd', 'parseYmd', `${src}\nreturn { ${names.join(', ')} };`)(ymd, parseYmd);
// The phase timeline rule (public/phases.js), which the SDK gives a module as host.util.phaseTimeline (plan-one-bar.md step 2).
const Phases = new Function('module', fs.readFileSync(new URL('../public/phases.js', import.meta.url), 'utf8') + '\nreturn module.exports;')({ exports: {} });
// The SDK's own text and time helpers (host.util.plain and host.util.localWhen in public/sdk/host.js), which the plan is given.
const sdkText = (() => {
  const win = { addEventListener() {}, location: { search: '' } };
  win.parent = win;
  new Function('window', 'document', fs.readFileSync(new URL('../public/sdk/host.js', import.meta.url), 'utf8'))(win, { createElement: (tag) => ({ tag }) });
  return win.hostText;
})();
const { plain, localWhen } = sdkText;

let n = 0;
const test = (name, fn) => { fn(); n += 1; };

test('the Planner redraws on host.on(\'phases\'), keeps a slow fallback and does not read host.spaces() for phases', () => {
  const main = read('travel.js');
  assert.match(main, /host\.on\('phases', \(\) => \{ if \(state\.loaded\) plan\.refreshPhases\(\); \}\);/, 'redraws when the host says');
  assert.match(main, /plan\.refreshPhases\(\); \}, 300000\)/, 'a five-minute fallback');
  assert.ok(!/const look = .*refreshPhases/.test(main), 'the 20 s look no longer reads phases');
  const lib = read('travel-lib-plan.js');
  const part = lib.slice(lib.indexOf('function refreshPhases'), lib.indexOf('const phased = '));
  assert.ok(!/host\.spaces/.test(part), 'refreshPhases does not use host.spaces()');
});

test('a drag does not change the plan\'s height: the joint keeps one height, and .dragging-line only restyles it', () => {
  // On 0.15.48 the joint was 0 high and .dragging-line grew every joint to 30px at once, so the rows below the first joint jumped
  // down (up to 300px measured) when a drag began. Measured live on the seed: scrollHeight and scrollTop unchanged with the class on.
  const css = read('travel-lib-cards.css');
  assert.match(css, /^\.joint \{[^}]*\bheight: var\(--joint-h\)/m, 'the joint has its own constant height');
  const rules = [...css.matchAll(/^([^\n{]*\.dragging-line[^\n{]*)\{([^}]*)\}/gm)].filter((m) => /\.joint\b/.test(m[1]) && !/::(before|after)/.test(m[1]) && !/\.jointadd/.test(m[1]));
  for (const m of rules) assert.ok(!/(^|[;\s])(height|min-height|max-height|margin|margin-top|margin-bottom|padding|padding-top|padding-bottom|display|position)\s*:/.test(m[2]), `".dragging-line" must not resize the joint: ${m[1].trim()} { ${m[2].trim()} }`);
  const main = read('travel.js');
  assert.ok(!/dragstart[\s\S]{0,400}(scrollTop|scrollIntoView|scrollTo\()/.test(main.slice(main.indexOf("addEventListener('dragstart'"), main.indexOf("addEventListener('dragend'"))), 'dragstart does not scroll');
});

test('dragging near the top or bottom of the list scrolls it, nowhere else, and stops when the drag ends', () => {
  const main = read('travel.js');
  const a = main.indexOf('function edgeStep');
  const block = main.slice(a, main.indexOf("addEventListener('pointerdown'", a));
  assert.ok(a > 0 && /requestAnimationFrame\(edgeStep\)/.test(block), 'a frame loop scrolls');
  assert.ok(/Math\.min\(56, r\.height \* 0\.15\)/.test(block) && /if \(!depth\) return;/.test(block), 'only inside an edge zone (56 px, or 15% of a short list)');
  assert.ok(/max = slow \? 6 : 20/.test(block) && /prefers-reduced-motion/.test(block), 'capped, lower with reduced motion');
  assert.ok(!/scrollTop\s*=\s*\d/.test(block) && /body\.scrollTop = before \+/.test(block), 'scrolls by a step, never to a fixed place');
  assert.match(main, /addEventListener\('dragover', \(e\) => \{\s*if \(!dragId\) return;\s*edgeScroll\(e\.clientY\);/, 'driven by dragover, only while dragging');
  assert.match(main, /addEventListener\('dragend', \(\) => \{\s*edgeStop\(\);/, 'stops at dragend');
  assert.match(main, /addEventListener\('drop', \(e\) => \{[^}]*edgeStop\(\);/, 'stops at drop');
  assert.ok(/e\.key === 'Escape'\) edgeStop/.test(main) && /'dragleave'/.test(main), 'stops on Escape and when the pointer leaves');
  const start = main.slice(main.indexOf("addEventListener('dragstart'"), main.indexOf("addEventListener('dragend'"));
  assert.ok(!/edgeScroll|edgeStep|scrollTop/.test(start), 'dragstart does not scroll');
});

test('cleanItem needs a title, keeps good fields and drops bad ones', () => {
  assert.equal(lib.cleanItem({ kind: 'stop', title: '' }), null);
  const i = lib.cleanItem({ id: 'a', kind: 'stop', title: ' Museum ', date: '2026-10-03', time: '09:30', minutes: 90, category: 'nope', order: 5 });
  assert.equal(i.title, 'Museum');
  assert.equal(i.date, '2026-10-03');
  assert.equal(i.time, '09:30');
  assert.equal(i.category, 'do');
  assert.equal(lib.cleanItem({ id: 'b', title: 'x', date: '2026-02-30' }).date, null);
  assert.equal(lib.cleanItem({ id: 'b', title: 'x', time: '25:00' }).time, null);
  assert.equal(lib.cleanItem({ id: 'c', kind: 'stay', title: 'Hotel' }).category, 'stay');
  assert.equal(lib.cleanItem({ id: 'c', kind: 'journey', title: 'Train' }).category, 'travel');
});

test('a link item needs a pointer and may have no title', () => {
  assert.equal(lib.cleanItem({ id: 'l', kind: 'link' }), null);
  const l = lib.cleanItem({ id: 'l', kind: 'link', ref: { module: 'calendar', kind: 'event', id: 'e1', scope: 'space', space: 'lobby' } });
  assert.deepEqual(l.ref, { module: 'calendar', kind: 'event', id: 'e1', scope: 'space', space: 'lobby' });
  assert.equal(l.pinned, false);
  assert.equal(lib.cleanItem({ id: 'l', kind: 'link', ref: l.ref, pinned: true }).pinned, true);
  assert.equal(lib.cleanItem({ id: 's', kind: 'stop', title: 'Museum', pinned: true }).pinned, true);
  assert.equal(lib.cleanItem({ id: 's', kind: 'stop', title: 'Museum' }).pinned, false);
});

test('a stay cannot check out before it checks in', () => {
  assert.equal(lib.cleanItem({ id: 's', kind: 'stay', title: 'Hotel', date: '2026-10-05', checkOut: '2026-10-03' }).checkOut, null);
  assert.equal(lib.stayNights(lib.cleanItem({ id: 's', kind: 'stay', title: 'Hotel', date: '2026-10-05', checkOut: '2026-10-08' })), 3);
});

test('tripDays runs from start to end, across a month, and is capped', () => {
  assert.deepEqual(lib.tripDays({ start: '2026-09-29', end: '2026-10-02' }), ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  assert.deepEqual(lib.tripDays({ start: '2026-10-02', end: '2026-10-01' }), []);
  assert.deepEqual(lib.tripDays({}), []);
  assert.equal(lib.tripDays({ start: '2026-01-01', end: '2027-12-31' }).length, 60);
});

test('coverTrip grows the first and last day to include given dates, and never shrinks', () => {
  const trip = { start: '2026-10-03', end: '2026-10-05' };
  assert.deepEqual(lib.coverTrip(trip, ['2026-10-01']), { start: '2026-10-01', end: '2026-10-05' });
  assert.deepEqual(lib.coverTrip(trip, ['2026-10-07']), { start: '2026-10-03', end: '2026-10-07' });
  assert.deepEqual(lib.coverTrip(trip, ['2026-10-01', '2026-10-08']), { start: '2026-10-01', end: '2026-10-08' });
  assert.equal(lib.coverTrip(trip, ['2026-10-03', '2026-10-05', '2026-10-04']), null);
  assert.equal(lib.coverTrip(trip, [null, 'not-a-day', '']), null);
  assert.equal(lib.coverTrip(null, ['2026-10-01']), null);
  assert.equal(lib.coverTrip({}, ['2026-10-01']), null);
  const stay = lib.cleanItem({ id: 's', kind: 'stay', title: 'Hotel', date: '2026-10-05', checkOut: '2026-10-08' });
  assert.deepEqual(lib.coverDaysOf(stay), ['2026-10-05', '2026-10-08']);
  const flight = lib.cleanItem({ id: 'f', kind: 'journey', title: 'Night flight', date: '2026-10-05', time: '22:00', minutes: 180 });
  assert.deepEqual(lib.coverDaysOf(flight), ['2026-10-05', '2026-10-06']);
});

test('coverTrip will not grow a trip past 60 days, and names the days it leaves off', () => {
  const trip = { start: '2026-01-01', end: '2026-01-10' };
  assert.deepEqual(lib.coverTrip(trip, ['2026-03-01']), { start: '2026-01-01', end: '2026-03-01' });
  assert.deepEqual(lib.coverTrip(trip, ['2026-03-02']), { outside: ['2026-03-02'] });
  assert.deepEqual(lib.coverTrip({ start: '2026-01-01', end: '2026-03-01' }, ['2025-12-31']), { outside: ['2025-12-31'] });
  assert.equal(lib.coverTrip({ start: '2026-01-01', end: '2026-03-01' }, ['2026-02-01']), null);
  const both = lib.coverTrip(trip, ['2026-01-20', '2026-06-01']);
  assert.deepEqual(both, { start: '2026-01-01', end: '2026-01-20', outside: ['2026-06-01'] });
});

test('dayLabel says which day of how many', () => {
  const days = lib.tripDays({ start: '2026-09-29', end: '2026-10-05' });
  assert.equal(lib.dayLabel('2026-10-01', days).position, 'Day 3 of 7');
});

test('daysUntil counts to the start, negative once it has begun', () => {
  assert.equal(lib.daysUntil({ start: '2026-10-01' }, '2026-09-20'), 11);
  assert.equal(lib.daysUntil({ start: '2026-10-01' }, '2026-10-03'), -2);
  assert.equal(lib.daysUntil({}, '2026-10-03'), null);
});

const it = (id, extra) => lib.cleanItem({ id, title: id, date: '2026-10-01', ...extra });

test('sortDay puts the untimed first in hand order, then the timed by time', () => {
  const sorted = lib.sortDay([it('late', { time: '18:00' }), it('b', { order: 2000 }), it('early', { time: '08:15' }), it('a', { order: 1000 })]);
  assert.deepEqual(sorted.map((i) => i.id), ['a', 'b', 'early', 'late']);
});

test('itemsByDay groups by day, keeps ideas apart and drops days outside the trip', () => {
  const days = ['2026-10-01', '2026-10-02'];
  const by = lib.itemsByDay([it('a'), it('b', { date: '2026-10-02' }), it('idea', { date: null }), it('out', { date: '2026-11-01' })], days);
  assert.deepEqual(by.get('2026-10-01').map((i) => i.id), ['a']);
  assert.deepEqual(by.get('2026-10-02').map((i) => i.id), ['b']);
  assert.deepEqual(by.get(null).map((i) => i.id), ['idea']);
  assert.equal([...by.values()].flat().some((i) => i.id === 'out'), false);
});

test('a linked object is placed by its summary when it has no day of its own', () => {
  const l = lib.cleanItem({ id: 'l', kind: 'link', ref: { module: 'calendar', kind: 'event', id: 'e', scope: 'environment' } });
  const by = lib.itemsByDay([l], ['2026-10-01', '2026-10-02'], (i) => i.date || '2026-10-02');
  assert.equal(by.get('2026-10-02').length, 1);
});

test('orderBetween finds a number, or says the day needs renumbering', () => {
  assert.equal(lib.orderBetween(undefined, undefined), 1000);
  assert.equal(lib.orderBetween(1000, undefined), 2000);
  assert.equal(lib.orderBetween(undefined, 1000), 0);
  assert.equal(lib.orderBetween(1000, 2000), 1500);
  assert.equal(lib.orderBetween(1, 1 + 1e-9), null);
});

test('placeUntimed puts an item between neighbours and renumbers when squeezed', () => {
  const a = it('a', { order: 1000 }); const b = it('b', { order: 2000 }); const m = it('m', { order: 9000, date: '2026-10-02' });
  assert.deepEqual(lib.placeUntimed([a, b], m, '2026-10-01', 1), { m: { date: '2026-10-01', order: 1500 } });
  assert.deepEqual(lib.placeUntimed([], m, '2026-10-01', 0), { m: { date: '2026-10-01', order: 1000 } });
  const c = it('c', { order: 1 }); const d = it('d', { order: 1 + 1e-9 });
  const changes = lib.placeUntimed([c, d], m, '2026-10-01', 1);
  assert.equal(changes.m.order, 2000);
  assert.equal(changes.d.order, 3000);
});

test('nudge swaps untimed neighbours and moves a timed item by half an hour', () => {
  const a = it('a', { order: 1000 }); const b = it('b', { order: 2000 }); const t = it('t', { time: '09:00' });
  assert.deepEqual(lib.nudge([a, b, t], b, -1), { b: { order: 1000 }, a: { order: 2000 } });
  assert.equal(lib.nudge([a, b, t], a, -1), null);
  assert.deepEqual(lib.nudge([a, b, t], t, 1), { t: { time: '09:30' } });
  assert.equal(lib.nudge([a, b, it('z', { time: '23:45' })], it('z', { time: '23:45' }), 1), null);
});

test('gaps are the minutes between the end of one timed item and the next start', () => {
  assert.equal(lib.gapMinutes(it('a', { time: '09:00', minutes: 60 }), it('b', { time: '10:45' })), 45);
  assert.equal(lib.gapMinutes(it('a', { time: '09:00', minutes: 120 }), it('b', { time: '10:45' })), null);
  assert.equal(lib.gapMinutes(it('a'), it('b', { time: '10:45' })), null);
  assert.equal(lib.gapText(45), '45 min');
  assert.equal(lib.gapText(120), '2 h');
  assert.equal(lib.gapText(135), '2 h 15 min');
});

test('a summary says when in a day, a moment or milliseconds', () => {
  assert.deepEqual(lib.summaryWhen({ when: '2026-10-03' }), { day: '2026-10-03', time: '' });
  const d = new Date(2026, 9, 3, 18, 30);
  assert.deepEqual(lib.summaryWhen({ when: d.toISOString() }), { day: '2026-10-03', time: '18:30' });
  assert.deepEqual(lib.summaryWhen({ when: d.getTime() }), { day: '2026-10-03', time: '18:30' });
  assert.deepEqual(lib.summaryWhen({ when: new Date(2026, 9, 3, 0, 0).getTime() }), { day: '2026-10-03', time: '' }); // local midnight: no time of day
  assert.deepEqual(lib.summaryWhen({ when: d.toISOString(), allDay: true }), { day: '2026-10-03', time: '' });
  assert.equal(lib.summaryWhen({}), null);
  assert.equal(lib.summaryWhen({ when: 'soon' }), null);
});

test('bookings are stays and journeys by date and time', () => {
  const list = [it('a', { kind: 'stop', date: '2026-10-01' }), it('s', { kind: 'stay', date: '2026-10-02' }), it('j2', { kind: 'journey', date: '2026-10-01', time: '18:00' }), it('j1', { kind: 'journey', date: '2026-10-01', time: '08:00' })];
  assert.deepEqual(lib.bookings(list).map((i) => i.id), ['j1', 'j2', 's']);
});

test('a booking has an actual (cost) and an estimate: cents, a cap, either, both or neither; the money maths use the actual only', () => {
  const both = it('b', { cost: 80, estimate: 70.456, paidBy: 'a' });
  assert.deepEqual([both.cost, both.estimate], [80, 70.46]);
  assert.deepEqual([it('e', { estimate: 12 }).cost, it('e', { estimate: 12 }).estimate], [null, 12]);
  assert.deepEqual([it('n', {}).cost, it('n', {}).estimate], [null, null]);
  assert.deepEqual([it('x', { estimate: 5e9 }).estimate, it('y', { estimate: -1 }).estimate, it('z', { estimate: '9' }).estimate], [1e9, null, null]);
  assert.equal(lib.costItems([both, it('e', { estimate: 12, paidBy: 'a' })]).length, 1, 'an estimate alone is not a cost in the Money view');
  assert.equal(lib.balances([it('e', { estimate: 12, paidBy: 'a' }), both], ['a', 'b']).total, 80, 'who-paid counts the actual only');
});

test('balances share a cost among its owners (or everyone) and settle in the fewest payments', () => {
  const people = ['a', 'b', 'c'];
  const dinner = it('d', { cost: 90, paidBy: 'a' }); // shared by all three: 30 each
  const taxi = it('t', { cost: 20, paidBy: 'b', owners: ['b', 'c'] }); // 10 each
  const r = lib.balances([dinner, taxi, it('free')], people);
  assert.equal(r.total, 110);
  assert.deepEqual(r.net, { a: 60, b: -20, c: -40 });
  assert.deepEqual(r.payments.map((p) => [p.from, p.to, p.amount]), [['c', 'a', 40], ['b', 'a', 20]]);
  // odd cents are handed out, not lost
  const odd = lib.balances([it('o', { cost: 10, paidBy: 'a' })], people);
  assert.equal(Math.round((odd.share.a + odd.share.b + odd.share.c) * 100), 1000);
  assert.equal(lib.balances([it('x', { cost: 5 })], people).total, 0); // no payer: not counted
});

test('stripFacts (#216): spent from costs with a payer, against the space\'s budget target, and the next booking', () => {
  const people = ['a', 'b'];
  const money = (n, code) => `${code || '?'} ${n}`;
  const today = '2026-10-14';
  const costs = [it('d', { cost: 90, paidBy: 'a' }), it('t', { cost: 20.5, paidBy: 'b' }), it('x', { cost: 500 })]; // x: no payer, not spent
  const facts = (o) => lib.stripFacts({ items: costs, travellers: people, today, currency: 'USD', money, ...o });
  // No target: spent only, marked as reading the budget so Set up can offer one.
  assert.deepEqual(facts({}), [{ id: 'spent', icon: 'coins', text: 'Spent USD 110.5', order: 10, budget: true }]);
  assert.deepEqual(lib.stripFacts({ items: [], travellers: people, today, currency: 'EUR', money }), [{ id: 'spent', icon: 'coins', text: 'Spent EUR 0', order: 10, budget: true }], 'a new trip: spent 0');
  // A target in the trip's currency (or with none of its own): "of", what is left, and the progress.
  const under = facts({ target: { amount: 400 } })[0];
  assert.deepEqual(under, { id: 'spent', icon: 'coins', text: 'USD 110.5 of USD 400', value: 'USD 289.5 left', progress: 0.276, order: 10, budget: true });
  assert.deepEqual(facts({ target: { amount: 400, currency: 'usd' } })[0], under, 'the same currency named in small letters');
  // Over the target: said in the words, the bar full, the value what it is over by, and a warning icon, so it never
  // looks the same as exactly on the target (also a full bar, with the coins).
  const over = facts({ target: { amount: 100 } })[0];
  assert.equal(over.text, 'USD 110.5 of USD 100 · over');
  assert.equal(over.value, 'USD 10.5 over');
  assert.equal(over.progress, 1);
  assert.equal(over.icon, 'circle-exclamation');
  const onIt = facts({ target: { amount: 110.5 } })[0];
  assert.deepEqual([onIt.icon, onIt.text, onIt.value, onIt.progress], ['coins', 'USD 110.5 of USD 110.5', 'USD 0 left', 1], 'exactly on the budget: full, the coins, nothing over');
  assert.notDeepEqual([over.icon, over.text], [onIt.icon, onIt.text], 'over and exactly on look different');
  // A target in another currency is shown, never compared (no progress).
  const other = facts({ target: { amount: 300, currency: 'EUR' } })[0];
  assert.deepEqual([other.text, other.value, 'progress' in other], ['USD 110.5 of EUR 300', 'Another currency', false]);
  // A target of nothing is no target.
  assert.equal(facts({ target: { amount: 0 } })[0].text, 'Spent USD 110.5');
  // The words never pass 40 characters.
  const long = lib.stripFacts({ items: costs, travellers: people, today, currency: 'USD', money: () => 'x'.repeat(30), target: { amount: 5 } })[0];
  assert.ok(long.text.length <= 40 && long.value.length <= 24, long.text);
  // Cut by characters as a person counts them: an emoji is never split into half a pair.
  const emoji = lib.stripFacts({ items: costs, travellers: people, today, currency: 'USD', money: () => '😀'.repeat(30), target: { amount: 5 } })[0];
  assert.equal([...emoji.text].length, 40, 'forty characters, emoji counted as one');
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/.test(emoji.text + emoji.value), 'no lone half of an emoji');
  // The next journey or stay from today on: the earliest by day and time, its route when it has one, else its title.
  const trip = [
    it('past', { kind: 'journey', mode: 'flight', date: '2026-10-01', fromCode: 'LHR', toCode: 'JFK', title: 'Old' }),
    it('later', { kind: 'journey', mode: 'flight', date: '2026-10-16', time: '18:00', fromCode: 'SFO', toCode: 'LAX', title: 'UA 2' }),
    it('soon', { kind: 'journey', mode: 'flight', date: '2026-10-16', time: '08:15', fromCode: 'SJC', toCode: 'ONT', title: 'UA 1' }),
    it('hotel', { kind: 'stay', date: '2026-10-20', title: 'Hotel Alfama' }),
    it('stop', { kind: 'stop', date: '2026-10-15', title: 'Museum' }),
  ];
  // Its day goes as `when`, never in the words ("tomorrow" baked in would go stale): the host words it for each viewer.
  const withNext = lib.stripFacts({ items: trip, travellers: people, today, currency: 'USD', money });
  assert.deepEqual(withNext[1], { id: 'next', icon: 'plane', text: 'SJC → ONT', when: '2026-10-16', value: 'UA 1', order: 20 });
  const stayNext = lib.stripFacts({ items: trip, travellers: people, today: '2026-10-17', currency: 'USD', money })[1];
  assert.deepEqual(stayNext, { id: 'next', icon: 'bed', text: 'Hotel Alfama', when: '2026-10-20', order: 20 });
  assert.equal(lib.stripFacts({ items: trip, travellers: people, today: '2026-10-21', currency: 'USD', money }).length, 1, 'nothing ahead: no next fact');
  // The Planner reports them: in a space, for someone who may edit, after each draw, and when the budget changes.
  const js = read('travel.js');
  assert.match(js, /if \(!host\.facts \|\| !canEdit \|\| !state\.loaded \|\| !spaceOf\(\)\) return;/);
  assert.match(js, /target: spaceOf\(\)\.budget \|\| null,/, 'the target is the space\'s, from host.space()');
  assert.match(js, /queued = false; render\(\); reportFacts\(\);/, 'after each draw');
  assert.match(js, /host\.on\('space', \(\) => \{ reportFacts\(\); redraw\(\); \}\);/, 'and when the budget changes');
  assert.match(js, /if \(sig === factsSaid\) return;/, 'the same facts are not sent again');
  assert.ok(!/nearDay|dayWord|'tomorrow'|'today'/.test(js.slice(js.indexOf('function reportFacts('), js.indexOf("host.on('space'"))), 'the Planner words no day relative to its own today');
});

test('with Budget on the Planner steps its money aside; with it off nothing changes (plan-budget-module.md, step 3)', () => {
  const people = ['a', 'b'];
  const money = (n, code) => `${code || '?'} ${n}`;
  const today = '2026-10-14';
  const items = [it('d', { cost: 90, paidBy: 'a' }), it('s', { kind: 'journey', mode: 'flight', date: '2026-10-16', fromCode: 'SJC', toCode: 'ONT', title: 'UA 1' })];
  const off = lib.stripFacts({ items, travellers: people, today, currency: 'USD', money });
  assert.deepEqual(off.map((f) => f.id), ['spent', 'next'], 'Budget off: both facts, as ever');
  assert.deepEqual(lib.stripFacts({ items, travellers: people, today, currency: 'USD', money, budgetOn: false }), off, 'budgetOn false is the same');
  const on = lib.stripFacts({ items, travellers: people, today, currency: 'USD', money, budgetOn: true, target: { amount: 400 } });
  assert.deepEqual(on.map((f) => f.id), ['next'], 'Budget on: no spent fact, so the strip carries one money fact (Budget\'s)');
  assert.deepEqual(lib.stripFacts({ items: [], travellers: people, today, currency: 'USD', money, budgetOn: true }), [], 'nothing to say: an empty list replaces the old one');
  // the costs stay on the bookings either way
  assert.equal(lib.costItems(items).length, 1);
  assert.equal(lib.balances(lib.costItems(items), people).total, 90);
  const js = read('travel.js');
  assert.match(js, /const viewsNow = \(\) => VIEWS\.filter\(\(v\) => v\.id !== 'money' \|\| \(!state\.budgetOn && !hideMoney\(\)\)\);/, 'the Money tab is left out while Budget is on, and for a guest unless an owner opened costs to guests');
  assert.match(js, /if \(state\.view === 'money' && !viewsNow\(\)\.some\(\(v\) => v\.id === 'money'\)\) state\.view = 'days';/, 'a person on Money is moved to Days when Budget comes on');
  assert.match(js, /budgetOn: state\.budgetOn,/, 'the fact reporter knows');
  assert.match(js, /host\.budget\.elsewhere\(\)/, 'found by the flag of another module, never by name');
  assert.ok(!/['"`]budget['"`]\s*[,)]/.test(js.slice(js.indexOf('async function lookBudget'), js.indexOf("host.on('space', () => { reportFacts"))), 'no module is named');
  assert.match(js, /addEventListener\('focus', lookBudget\)/, 'asked again on focus, and every 30 seconds');
  assert.match(js, /if \(on === state\.budgetOn\) return;\s*state\.budgetOn = on;\s*if \(state\.loaded\) \{ redraw\(\); reportFacts\(\); \}/, 'toggling redraws and re-reports');
  assert.ok(js.includes("{ id: 'money', label: 'Money', icon: 'coins' }") && js.includes('renderMoney'), 'the Money view itself is kept for Budget off');
  const form = js.slice(js.indexOf('f-cost'), js.indexOf('f-cost') + 200);
  assert.ok(form.length > 0, 'the booking form keeps its cost field');
});

test('a trip has an optional three-letter currency, an item an optional cost', () => {
  assert.equal(lib.cleanTrip({ start: '2026-10-01', currency: 'eur' }).currency, 'EUR');
  assert.equal(lib.cleanTrip({ start: '2026-10-01', currency: 'euros' }).currency, '');
  assert.equal(it('c', { cost: 12.345 }).cost, 12.35);
  assert.equal(it('c', { cost: -3 }).cost, null);
});

// The trip's Currency picker (host.ui.currencySelect in public/sdk/host.js), on a stand-in <select>: the server's list, a
// first "" choice for the server's currency, and a stored code kept and selected even when the server would not take it.
await (async () => {
  const sdk = fs.readFileSync(new URL('../public/sdk/host.js', import.meta.url), 'utf8');
  const win = { addEventListener() {}, location: { search: '' } };
  win.parent = win;
  // host.ready() adds the SDK's shared styles to the module's root once hello answers, so the stand-ins take a <style>.
  new Function('window', 'document', sdk)(win, { createElement: (tag) => ({ tag }) });
  // The picker also mounts the kind picker's field and list over the select (the Pickers family), which needs a real DOM; a
  // stand-in that answers anything it is asked with another stand-in is enough here, the list itself is checked in the browser.
  const deep = () => new Proxy(function () { return deep(); }, { get: (_t, k) => (k === Symbol.toPrimitive ? () => '' : deep()), apply: () => deep(), set: () => true });
  const el = (tag) => new Proxy({ tag, nodeType: 1, get ownerDocument() { return doc; }, value: '', textContent: '', label: '', children: [], append(...c) { this.children.push(...c); } }, { get: (t, k) => (k in t || typeof k === 'symbol' ? t[k] : deep()) });
  const doc = { createElement: el };
  const select = { ownerDocument: doc, children: [], _v: '', listeners: [], disabled: false, after() {}, dispatchEvent() {}, closest: () => null, getAttribute: () => null,
    replaceChildren(...c) { this.children = c; this._v = ''; },
    options() { return this.children.flatMap((c) => (c.tag === 'optgroup' ? c.children : [c])); },
    get value() { return this._v; },
    set value(v) { this._v = this.options().some((o) => o.value === v) ? v : ''; },
    addEventListener(_e, fn) { this.listeners.push(fn); }, removeEventListener() {} };
  const locale = { language: 'en', clock: '12', currency: 'USD', currencies: ['EUR', 'JPY', 'USD', 'XAF'] };
  const { host } = win.createHost({ call: async (m) => (m === 'hello' ? { locale } : {}), root: { appendChild() {} }, rootElement: {} });
  await host.ready();
  const pick = host.ui.currencySelect(select, { value: '', empty: true });
  test('the trip Currency picker: empty is the server currency, Common then All, odd codes kept', () => {
    assert.equal(select.children[0].value, '');
    assert.equal(select.children[0].textContent, 'Default (USD)');
    assert.equal(select.value, '');
    assert.deepEqual(select.children[1].children.map((o) => o.value), ['USD', 'EUR', 'JPY']);
    assert.equal(select.children[1].label, 'Common');
    assert.deepEqual(select.children[2].children.map((o) => o.value), ['XAF']);
    pick.set('eur');
    assert.equal(pick.value, 'EUR');
    pick.set('XYZ');
    assert.equal(select.children[1].value, 'XYZ'); // shown before the groups, and selected
    assert.equal(pick.value, 'XYZ');
    delete locale.currencies; // a built-in fallback locale has no list: the browser's
    pick.set('GBP');
    assert.equal(pick.value, 'GBP');
  });
})();

// --- the plan, against a small stand-in for the SDK -------------------------------------------------------------

function fakeHost({ summaries = [], search = [], readOnly = false, phases = [], space = null, today = null } = {}) {
  const store = new Map(); // key -> { value, version }
  const handlers = { change: [] };
  const provided = {};
  const covered = []; // every day asked of host.phasesCover, in order
  let clock = 0;
  const objectKey = (r) => [r.module, r.kind, r.id, r.scope, r.space || ''].join('|');
  const refuse = () => { if (readOnly) throw Object.assign(new Error('you may not change this'), { status: 403 }); };
  const t = {
    user: { key: 'u1', name: 'Ann' },
    phases: () => phases,
    space: () => space,
    // As the SDK: the timeline of this space's dates (or the given ones), and the cover route applied to the space.
    phasesCover: async (day) => {
      refuse();
      covered.push(day);
      const r = Phases.coverMain(phases, space ? space.phases : {}, day, { created: space ? space.createdAt : null });
      if (!r.moved) return null;
      space.phases = r.dates;
      return r.dates;
    },
    util: { id: () => 'id' + (++clock), objectKey, ymd, parseYmd, word: (k) => k, plain, localWhen,
      phaseTimeline: (o = {}) => Phases.timelineOf(phases, o.dates !== undefined ? o.dates : (space && space.phases) || {}, { today: o.today || today || ymd(new Date()), created: o.created !== undefined ? o.created : space ? space.createdAt : null }),
      phaseWords: (bands, day) => Phases.chipWords(bands, day) },
    storage: {
      get: async (key) => (store.has(key) ? { key, ...store.get(key) } : null),
      list: async (prefix) => [...store].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, ...v })),
      // As the server: a version given must be the one stored (0 when there is none).
      set: async (key, value, o = {}) => {
        refuse();
        const cur = store.get(key);
        if (o.version !== undefined && (cur ? cur.version : 0) !== o.version) throw Object.assign(new Error('stale'), { status: 409 });
        const version = (cur ? cur.version : 0) + 1;
        store.set(key, { value, version });
        return { key, value, version };
      },
      delete: async (key, o = {}) => {
        refuse();
        const cur = store.get(key);
        if (cur && o.version !== undefined && cur.version !== o.version) throw Object.assign(new Error('stale'), { status: 409 });
        store.delete(key);
      },
    },
    on: (event, fn) => { (handlers[event] ||= []).push(fn); },
    objects: {
      resolve: async (refs) => refs.map((r) => summaries.find((c) => objectKey(c.ref) === objectKey(r)) || { error: 'gone' }),
      search: async () => search,
      make: (kind, id) => ({ module: 'travel', kind, id, scope: 'space' }),
    },
    actions: { provide: (h) => Object.assign(provided, h) },
  };
  return { t, store, provided, covered, push: (e) => handlers.change.forEach((fn) => fn(e)) };
}

const run = async () => {
  const f = fakeHost();
  const plan = lib.createPlan(f.t);
  await plan.load();
  assert.equal(plan.trip, null);
  await plan.saveTrip({ title: 'Cabin', start: '2026-10-01', end: '2026-10-03' });
  assert.deepEqual(plan.days(), ['2026-10-01', '2026-10-02', '2026-10-03']);
  await assert.rejects(() => plan.addItem({ kind: 'stop', title: '' }));

  const a = await plan.addItem({ kind: 'stop', title: 'Hike', date: '2026-10-01' });
  const b = await plan.addItem({ kind: 'stop', title: 'Dinner', date: '2026-10-01' });
  assert.deepEqual(plan.byDay().get('2026-10-01').map((i) => i.title), ['Hike', 'Dinner']);
  n += 1;

  await plan.nudgeItem(b.id, -1);
  assert.deepEqual(plan.byDay().get('2026-10-01').map((i) => i.title), ['Dinner', 'Hike']);
  await plan.moveTo(a.id, '2026-10-02', 0);
  assert.deepEqual(plan.byDay().get('2026-10-02').map((i) => i.title), ['Hike']);
  assert.deepEqual(plan.byDay().get('2026-10-01').map((i) => i.title), ['Dinner']);
  n += 1;

  // a pointer whose object's summary has a time sorts by it
  const evc = { ref: { module: 'calendar', kind: 'event', id: 'ev9', scope: 'space', space: 'lobby' }, module: { id: 'calendar' }, title: 'Dinner', when: new Date(2026, 9, 1, 20, 0).toISOString() };
  const h = fakeHost({ summaries: [evc] });
  const plan3 = lib.createPlan(h.t);
  await plan3.load();
  await plan3.saveTrip({ start: '2026-10-01', end: '2026-10-02' });
  await plan3.addItem({ kind: 'stop', title: 'Lunch', date: '2026-10-01', time: '13:00' });
  await plan3.addItem({ kind: 'stop', title: 'Museum', date: '2026-10-01', time: '15:00' });
  await plan3.addLink(evc.ref, null);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(plan3.byDay().get('2026-10-01').map((i) => i.title || 'link'), ['Lunch', 'Museum', 'link']);
  n += 1;

  // two people: an edit to something changed meanwhile is refused and the newer copy is loaded
  await f.t.storage.set('plan:' + a.id, { ...f.store.get('plan:' + a.id).value, title: 'Long hike' }, {});
  await assert.rejects(() => plan.updateItem(a.id, { notes: 'x' }), (e) => e.conflict === true);
  assert.equal(plan.list().find((i) => i.id === a.id).title, 'Long hike');
  await plan.updateItem(a.id, { notes: 'x' });
  n += 1;

  // live changes from someone else
  f.push({ key: 'plan:zz', value: { kind: 'note', title: 'Bring cash', date: '2026-10-03', order: 1000 }, version: 1 });
  assert.equal(plan.byDay().get('2026-10-03').length, 1);
  f.push({ key: 'plan:zz', deleted: true });
  assert.equal(plan.byDay().get('2026-10-03').length, 0);
  n += 1;

  // what other modules may ask
  plan.provide();
  await f.provided.addStop({ title: 'Winning hotel', date: '2026-10-02' });
  assert.equal(plan.byDay().get('2026-10-02').some((i) => i.title === 'Winning hotel'), true);
  // acceptSuggestion: a recognised kind becomes the right sort of item; anything else (or none) is a plain stop
  await assert.rejects(() => f.provided.acceptSuggestion({ title: '' }));
  await f.provided.acceptSuggestion({ title: 'LIS to FAO', kind: 'flight', date: '2026-10-01', content: 'window seat', place: 'Lisbon airport' });
  const flight = plan.list().find((i) => i.title === 'LIS to FAO');
  assert.equal(flight.kind, 'journey');
  assert.equal(flight.mode, 'flight');
  assert.equal(flight.category, 'travel');
  assert.equal(flight.notes, 'window seat');
  assert.equal(flight.place, 'Lisbon airport');
  await f.provided.acceptSuggestion({ title: 'Seaside Inn', kind: 'hotel', date: '2026-10-01' });
  const stay = plan.list().find((i) => i.title === 'Seaside Inn');
  assert.equal(stay.kind, 'stay');
  assert.equal(stay.type, 'hotel');
  await f.provided.acceptSuggestion({ title: 'The old town', kind: 'sight', date: '2026-10-01' });
  const sight = plan.list().find((i) => i.title === 'The old town');
  assert.equal(sight.kind, 'stop');
  assert.equal(sight.type, 'sight');
  await f.provided.acceptSuggestion({ title: 'A surprise' });
  const plain = plan.list().find((i) => i.title === 'A surprise');
  assert.equal(plain.kind, 'stop');
  assert.equal(plain.type, null);
  await f.provided.acceptSuggestion({ title: 'Something odd', kind: 'nonsense' });
  assert.equal(plan.list().find((i) => i.title === 'Something odd').kind, 'stop');
  const ev = { ref: { module: 'calendar', kind: 'event', id: 'e1', scope: 'space', space: 'lobby' }, module: { id: 'calendar' }, title: 'Train', when: '2026-10-03' };
  const g = fakeHost({ summaries: [ev], search: [ev, { ...ev, ref: { ...ev.ref, id: 'e2' }, when: '2026-12-25' }, { ...ev, ref: { ...ev.ref, id: 'e3' }, module: { id: 'travel' } }, { ...ev, ref: { ...ev.ref, id: 'e4' }, copy: true, twinOf: { module: 'travel', kind: 'plan', id: 'p1', scope: 'space', space: 'lobby' } }] });
  const plan2 = lib.createPlan(g.t);
  await plan2.load();
  await plan2.saveTrip({ start: '2026-10-01', end: '2026-10-03' });
  const sug = await plan2.suggest();
  assert.deepEqual(sug.map((c) => c.ref.id), ['e1']);
  plan2.provide();
  await g.provided.addToDay({ object: ev.ref, date: null });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(plan2.byDay().get('2026-10-03').length, 1); // placed by the linked item's own day
  assert.equal((await plan2.suggest()).length, 0); // and no longer suggested
  n += 1;
};
await run();

// --- the plan's own keys renamed (plan-names decision 19): item:<id> becomes plan:<id>, once, recorded ------------------
await (async () => {
  const old = (f, id, title, extra = {}) => f.store.set(lib.OLD_PLAN_PREFIX + id, { value: { kind: 'stop', title, date: '2026-10-01', order: 1000, ...extra }, version: 3 });
  assert.equal(lib.PLAN_PREFIX, 'plan:');
  assert.equal(lib.planIdOf('plan:a1'), 'a1');
  assert.equal(lib.planIdOf('item:a1'), 'a1');
  assert.equal(lib.planIdOf('trip:main'), null);
  assert.equal(lib.planIdOf('_moved:plan-keys'), null);

  // Someone who may edit opens the plan: every old key moves, values intact, and the move is recorded.
  const f = fakeHost();
  old(f, 'a1', 'Ferry', { notes: 'deck' });
  old(f, 'a2', 'Castle');
  const plan = lib.createPlan(f.t);
  await plan.load();
  assert.deepEqual([...f.store.keys()].filter((k) => k.startsWith('item:')), [], 'no old key is left');
  assert.equal(f.store.get('plan:a1').value.notes, 'deck', 'the value moved as it was');
  assert.ok(f.store.get(lib.MOVED_KEY), 'the move is recorded');
  assert.deepEqual(plan.list().map((i) => i.title).sort(), ['Castle', 'Ferry']);
  // Loading again moves nothing and changes nothing.
  const before = JSON.stringify([...f.store]);
  await lib.createPlan(f.t).load();
  assert.equal(JSON.stringify([...f.store]), before, 'a second load changes nothing');
  n += 1;

  // Recorded already: an old key that turns up later (an old page still open) is shown, and moved on its change.
  old(f, 'a3', 'Late');
  f.push({ key: 'item:a3', value: f.store.get('item:a3').value, version: 3 });
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(plan.list().some((i) => i.title === 'Late'), 'an old key is still read');
  assert.ok(f.store.has('plan:a3') && !f.store.has('item:a3'), 'and moved');
  n += 1;

  // A different copy already under the new key: the plan shows the new one, and the old key is kept, never deleted.
  const g = fakeHost();
  old(g, 'b1', 'Old title');
  g.store.set('plan:b1', { value: { kind: 'stop', title: 'New title', date: '2026-10-01', order: 1000 }, version: 1 });
  const plan2 = lib.createPlan(g.t);
  await plan2.load();
  assert.equal(g.store.get('plan:b1').value.title, 'New title');
  assert.equal(g.store.get('item:b1').value.title, 'Old title', 'a different old value is kept');
  assert.deepEqual(plan2.list().map((i) => i.title), ['New title']);
  // The same value under both keys (someone else moved it first): the old key goes.
  const same = fakeHost();
  old(same, 'b2', 'Twin');
  same.store.set('plan:b2', { value: same.store.get('item:b2').value, version: 1 });
  await lib.createPlan(same.t).load();
  assert.ok(same.store.has('plan:b2') && !same.store.has('item:b2'), 'an identical old copy is removed');
  n += 1;

  // Someone who cannot edit moves nothing and records nothing, and still sees the whole plan.
  const r = fakeHost({ readOnly: true });
  old(r, 'c1', 'Museum');
  const plan3 = lib.createPlan(r.t);
  await plan3.load();
  assert.ok(r.store.has('item:c1') && !r.store.has(lib.MOVED_KEY), 'nothing moved or recorded');
  assert.deepEqual(plan3.list().map((i) => i.title), ['Museum']);
  n += 1;

  // An item still under its old key, changed by someone who can edit: saved under the new key, the old one gone.
  const e = fakeHost();
  old(e, 'd1', 'Walk');
  e.store.set(lib.MOVED_KEY, { value: { at: 'x' }, version: 1 }); // recorded, but this one was left behind
  const plan4 = lib.createPlan(e.t);
  await plan4.load();
  await plan4.updateItem('d1', { notes: 'bring water' });
  assert.equal(e.store.get('plan:d1').value.notes, 'bring water');
  assert.ok(!e.store.has('item:d1'));
  await plan4.removeItem('d1');
  assert.ok(!e.store.has('plan:d1'));
  n += 1;
})();

test('details for the cards: a journey has a mode, a stop and a stay a type, any item a leg to it', () => {
  const f = lib.cleanItem({ id: 'f', kind: 'journey', title: 'LIS to FAO', mode: 'flight', operator: 'TAP', number: 'tp 1234', fromCode: 'lis!', toCode: 'fao', terminal: '1', seat: '12A', travelClass: 'economy' });
  assert.equal(f.mode, 'flight');
  assert.equal(f.fromCode, 'LIS');
  assert.equal(f.number, 'tp 1234');
  assert.equal(f.seat, '12A');
  assert.equal(lib.cleanItem({ id: 'j', kind: 'journey', title: 'x', mode: 'rocket' }).mode, 'other');
  assert.equal(lib.cleanItem({ id: 'j', kind: 'journey', title: 'x' }).mode, 'other');
  const t = lib.cleanItem({ id: 't', kind: 'journey', title: 'x', mode: 'train', operator: 'CP', platform: '4', carriage: '7' });
  assert.equal(t.platform, '4');
  assert.equal(t.carriage, '7');
  const c = lib.cleanItem({ id: 'c', kind: 'journey', title: 'x', mode: 'car', pickup: 'Airport', dropoff: 'Lisbon' });
  assert.equal(c.pickup, 'Airport');
  const meal = lib.cleanItem({ id: 'm', kind: 'stop', title: 'Dinner', type: 'restaurant', partySize: 4.4, reservationName: 'Ann', admissionCount: 0 });
  assert.equal(meal.type, 'restaurant');
  assert.equal(meal.partySize, 4);
  assert.equal(meal.reservationName, 'Ann');
  assert.equal(meal.admissionCount, null);
  assert.equal(lib.cleanItem({ id: 's', kind: 'stop', title: 'x', type: 'casino' }).type, null);
  assert.equal(lib.cleanItem({ id: 's', kind: 'stop', title: 'x', mode: 'flight' }).mode, undefined);
  const show = lib.cleanItem({ id: 'e', kind: 'stop', title: 'Fado', type: 'show', admissionCount: 2, gate: 'b' });
  assert.equal(show.admissionCount, 2);
  const stay = lib.cleanItem({ id: 'h', kind: 'stay', title: 'Hotel', type: 'hotel', roomType: 'double', guests: 2 });
  assert.equal(stay.type, 'hotel');
  assert.equal(stay.guests, 2);
  assert.equal(lib.cleanItem({ id: 'h', kind: 'stay', title: 'x', checkOutTime: '11:00' }).checkOutTime, '11:00');
  assert.equal(lib.cleanItem({ id: 'h', kind: 'stay', title: 'x', checkOutTime: '25:00' }).checkOutTime, null);
  assert.equal(lib.cleanItem({ id: 'h', kind: 'stay', title: 'x', type: 'igloo' }).type, null);
  const leg = lib.cleanItem({ id: 'l', kind: 'stop', title: 'x', travelMode: 'walk', travelMinutes: 12.4 });
  assert.equal(leg.travelMode, 'walk');
  assert.equal(leg.travelMinutes, 12);
  assert.equal(lib.cleanItem({ id: 'l', kind: 'stop', title: 'x', travelMode: 'teleport', travelMinutes: -5 }).travelMode, null);
  assert.equal(lib.cleanItem({ id: 'l', kind: 'stop', title: 'x', travelMode: 'teleport', travelMinutes: -5 }).travelMinutes, null);
  assert.equal(lib.MODES.length, 9);
  assert.ok(lib.STOP_TYPES.includes('cafe') && lib.STAY_TYPES.includes('camp') && lib.TRAVEL_MODES.includes('none'));
});

test('what an item is: its editor tile, the fields a tile decides, and its card', () => {
  const it = (o) => lib.cleanItem({ id: 'x', title: 't', ...o });
  assert.equal(lib.tileOf(it({ kind: 'journey', mode: 'flight' })), 'flight');
  assert.equal(lib.tileOf(it({ kind: 'journey' })), 'bus');
  assert.equal(lib.tileOf(it({ kind: 'stay' })), 'hotel');
  assert.equal(lib.tileOf(it({ kind: 'note' })), 'note');
  assert.equal(lib.tileOf(it({ kind: 'stop', type: 'cafe' })), 'cafe');
  assert.equal(lib.tileOf(it({ kind: 'stop', type: 'hike' })), 'tour');
  assert.equal(lib.tileOf(it({ kind: 'stop', category: 'eat' })), 'restaurant');
  assert.equal(lib.tileOf(it({ kind: 'stop', category: 'do' })), 'sight');
  assert.equal(lib.tileOf(null), 'sight');
  assert.deepEqual(lib.fromTile('flight'), { kind: 'journey', mode: 'flight', category: 'travel' });
  assert.deepEqual(lib.fromTile('cafe'), { kind: 'stop', type: 'cafe', category: 'eat' });
  assert.deepEqual(lib.fromTile('museum'), { kind: 'stop', type: 'museum', category: 'do' });
  assert.deepEqual(lib.fromTile('note'), { kind: 'note', category: 'other' });
  assert.equal(lib.fromTile('tour', it({ kind: 'stop', type: 'hike' })).type, 'hike');
  assert.equal(lib.fromTile('sight', it({ kind: 'stop', type: 'hike' })).type, 'sight');
  assert.equal(lib.fromTile('hotel', it({ kind: 'stay', type: 'camp' })).type, 'camp');
  assert.equal(lib.cardOf(it({ kind: 'journey', mode: 'train' })).template, 'train');
  assert.equal(lib.cardOf(it({ kind: 'journey', mode: 'ferry' })).template, 'transit');
  assert.equal(lib.cardOf(it({ kind: 'journey', mode: 'ferry' })).badge, 'ship');
  assert.equal(lib.cardOf(it({ kind: 'journey' })).family, 'bus');
  assert.equal(lib.cardOf(it({ kind: 'stay', type: 'hostel' })).kicker, 'Hostel');
  assert.equal(lib.cardOf(it({ kind: 'stop', type: 'bar' })).template, 'meal');
  assert.equal(lib.cardOf(it({ kind: 'stop', type: 'spa' })).family, 'sight');
  assert.equal(lib.cardOf(it({ kind: 'stop', type: 'show' })).template, 'show');
  assert.equal(lib.cardOf(it({ kind: 'stop', category: 'eat' })).family, 'restaurant');
  assert.equal(lib.cardOf(it({ kind: 'stop', category: 'other' })).kicker, 'Stop');
  assert.equal(lib.cardOf(it({ kind: 'note' })).template, 'note');
  assert.equal(lib.cardOf({ kind: 'link' }, { kind: 'place', title: 'x' }).template, 'place');
  assert.equal(lib.cardOf({ kind: 'link' }, { kind: 'event', title: 'x' }).template, 'link');
  assert.equal(lib.cardOf({ kind: 'link' }, { error: 'gone' }).template, 'link');
  assert.ok(lib.TILES.every((t) => lib.tileOf(it(lib.fromTile(t))) === t), 'every tile round-trips');
  assert.equal(lib.LEG_ICONS.walk, 'person-walking');
});

test('where the trip starts and ends: the first and last booked item', () => {
  const it = (o) => lib.cleanItem({ id: 'x', title: 't', order: 1, ...o });
  assert.equal(lib.tripBounds([]), null);
  assert.equal(lib.tripBounds([it({ id: 'n', kind: 'note', date: '2026-10-03' }), it({ id: 'u', kind: 'stop', date: '2026-10-03' })]), null, 'untimed stops and notes are not booked');
  const items = [
    it({ id: 'dinner', kind: 'stop', date: '2026-10-03', time: '20:00' }),
    it({ id: 'flight', kind: 'journey', mode: 'flight', date: '2026-10-03', time: '08:10', minutes: 65 }),
    it({ id: 'hotel', kind: 'stay', date: '2026-10-03', checkOut: '2026-10-05', checkOutTime: '11:00' }),
    it({ id: 'home', kind: 'journey', mode: 'flight', date: '2026-10-05', time: '15:00', minutes: 120 }),
    it({ id: 'idea', kind: 'stop', date: null, time: '01:00' }),
  ];
  const b = lib.tripBounds(items);
  assert.deepEqual(b.start, { id: 'flight', day: '2026-10-03', time: '08:10' });
  assert.deepEqual(b.end, { id: 'home', day: '2026-10-05', time: '17:00' });
  const stayLast = lib.tripBounds([items[2]]);
  assert.deepEqual(stayLast.end, { id: 'hotel', day: '2026-10-05', time: '11:00' });
  const fallback = lib.tripBounds([it({ id: 'a', kind: 'stop', date: '2026-10-04', time: '09:00' }), it({ id: 'b', kind: 'stop', date: '2026-10-04', time: '18:00', minutes: 30 })]);
  assert.equal(fallback.start.id, 'a');
  assert.deepEqual(fallback.end, { id: 'b', day: '2026-10-04', time: '18:30' });
  assert.equal(lib.tripBounds([it({ id: 'c', kind: 'stop', date: '2026-10-04', confirm: 'XY1' })]).start.id, 'c', 'anything with a confirmation is booked');
});

test('a time block is an item with a marker type and no place', () => {
  const b = lib.cleanItem({ id: 'b', kind: 'block', type: 'free-time', title: ' ', date: '2026-10-03', time: '14:00', minutes: 90 });
  assert.equal(b.kind, 'block');
  assert.equal(b.type, 'free-time');
  assert.equal(b.title, '');
  assert.equal(b.minutes, 90);
  assert.equal(lib.cleanItem({ id: 'b', kind: 'block', title: 'x' }), null, 'a block needs a type');
  assert.equal(lib.cleanItem({ id: 'b', kind: 'block', type: 'Bad Type' }), null);
  assert.equal(lib.tileOf(b), 'block:free-time');
  assert.deepEqual(lib.fromTile('block:rest'), { kind: 'block', type: 'rest', category: 'other' });
  assert.equal(lib.cardOf(b).template, 'block');
  assert.equal(lib.tripBounds([b, lib.cleanItem({ id: 'j', kind: 'journey', title: 'x', date: '2026-10-04', time: '09:00' })]).start.id, 'j', 'a block is never the start of the trip');
});

test('the kind picker shows each marker type once; Where decides block (a day) or lane (a joint)', () => {
  assert.equal(lib.kindOf('block:rest'), 'marker:rest');
  assert.equal(lib.kindOf('lane:rest'), 'marker:rest');
  assert.equal(lib.kindOf('flight'), 'flight');
  assert.equal(lib.kindOf(null), null);
  assert.equal(lib.tileAt('marker:rest', 'd:2026-10-04'), 'block:rest', 'a day stores a block');
  assert.equal(lib.tileAt('marker:rest', 'd:'), 'block:rest', 'no day yet is still in a day');
  assert.equal(lib.tileAt('marker:rest', 'j:2026-10-04'), 'lane:rest', 'a joint stores a lane');
  assert.equal(lib.tileAt('marker:rest', 'j:'), 'lane:rest', 'the head of the line is a joint');
  assert.equal(lib.tileAt('flight', 'j:'), 'flight', 'any other kind is itself wherever it is');
  for (const t of ['free-time', 'rest', 'buffer', 'meet-up', 'leave-by', 'travel-day', 'free-day']) {
    for (const where of ['d:2026-10-04', 'j:2026-10-04']) {
      const tile = lib.tileAt(lib.kindOf(`block:${t}`), where);
      assert.equal(lib.fromTile(tile).kind, where.startsWith('j:') ? 'lane' : 'block');
      assert.equal(lib.fromTile(tile).type, t);
      assert.equal(lib.kindOf(tile), `marker:${t}`, 'the picker shows one kind for both');
    }
  }
  const page = read('travel.js');
  assert.ok(/label: 'Markers', options: blockTypes\(\)\.map/.test(page), 'one Markers group of the types that are not automatic');
  assert.ok(!/addTileGroup|label: 'Between days', options/.test(page), 'the Time and Between days groups of the kind picker are gone (a menu of spots between days is another thing)');
  assert.ok(/onChange: \(id\) => applyType\(tileAt\(id, \$\('f-date'\)\.value\)\)/.test(page), 'a choice goes through tileAt with Where');
  assert.ok(/placeOptions\(\$\('f-date'\), \{ placedOnly: marker && !keepUnplaced \}\)/.test(page), 'with a marker chosen Where lists the days and the joints, not "Unscheduled"');
  assert.ok(/const keepUnplaced = Boolean\(ed\.id && ed\.unplaced\);/.test(page) && /unplaced: Boolean\(item && item\.kind === 'block' && !item\.date\)/.test(page), 'an existing block stored with no day keeps "Unscheduled", so its Where is never blank');
  assert.ok(/if \(kindField\) kindField\.remember\(kindOf\(ed\.tile\)\);/.test(page), 'the kind a new object is saved with is recent, also when the bar, the day\'s "..." or a joint\'s + chose it');
});

test('a marker between the days follows a day and has no time', () => {
  const l = lib.cleanItem({ id: 'l', kind: 'lane', type: 'free-time', title: '', after: '2026-10-04', date: '2026-10-09', time: '10:00', minutes: 30, notes: 'n' });
  assert.equal(l.kind, 'lane');
  assert.equal(l.after, '2026-10-04');
  assert.equal(l.date, null);
  assert.equal(l.time, null);
  assert.equal(l.minutes, null);
  assert.equal(lib.cleanItem({ id: 'l', kind: 'lane', type: 'rest', after: 'nope' }).after, '', 'the head of the line');
  assert.equal(lib.cleanItem({ id: 'l', kind: 'lane', type: 'rest', after: null }).after, '', 'a stored null reads as the head');
  assert.equal(lib.cleanItem({ id: 'l', kind: 'lane', title: 'x' }), null, 'a marker needs a type');
  assert.equal(lib.tileOf(l), 'lane:free-time');
  assert.deepEqual(lib.fromTile('lane:rest'), { kind: 'lane', type: 'rest', category: 'other' });
  assert.equal(lib.cardOf(l).template, 'lane');
});

test('an item is on a day or at a joint, never both; nothing is read as the head or the borrowed day', () => {
  assert.equal(lib.cleanItem({ id: 'a', title: 'x', date: '2026-10-01', after: '2026-10-01' }).after, null, 'a day clears the joint');
  assert.equal(lib.cleanItem({ id: 'a', title: 'x', after: '2026-10-01' }).after, '2026-10-01');
  assert.equal(lib.cleanItem({ id: 'a', title: 'x', after: '' }).after, '', 'the head');
  assert.equal(lib.cleanItem({ id: 'a', title: 'x' }).after, null, 'nowhere in particular');
  assert.equal(lib.cleanItem({ id: 'a', title: 'x', after: 'nope' }).after, null);
  assert.equal(lib.lineOf({ after: '2026-10-02' }, null), '2026-10-02');
  assert.equal(lib.lineOf({ after: '' }, null), '');
  assert.equal(lib.lineOf({ after: null, date: '2026-10-02' }, '2026-10-02'), null, 'on a day');
  assert.equal(lib.lineOf({ after: null }, '2026-10-02'), null, 'a pointer borrowing its day');
  assert.equal(lib.lineOf({ after: null }, null), '', 'an old idea is at the head');
  assert.deepEqual(lib.joints(['2026-10-01', '2026-10-02']), ['', '2026-10-01', '2026-10-02']);
  assert.deepEqual(lib.sortLine([{ id: 'b', after: '2026-10-01', order: 1000 }, { id: 'a', after: '', order: 2000 }, { id: 'c', after: '', order: 1000 }]).map((i) => i.id), ['c', 'a', 'b']);
  assert.deepEqual(lib.placeFields({ date: '2026-10-01' }), { date: '2026-10-01', after: null });
  assert.deepEqual(lib.placeFields({ after: '' }), { date: null, after: '' });
  assert.deepEqual(lib.placeFields({ after: '2026-10-01' }), { date: null, after: '2026-10-01' });
  assert.deepEqual(lib.placeFields(null), { date: null, after: null });
  assert.deepEqual(lib.placeFields({ date: 'nope', after: 'nope' }), { date: null, after: null });
});

test('an item dropped among others at a joint gets an order between its neighbours', () => {
  const others = [{ id: 'a', order: 1000 }, { id: 'b', order: 2000 }];
  assert.equal(lib.jointOrder([], null, null), 1000);
  assert.equal(lib.jointOrder(others, null, null), 3000, 'at the end');
  assert.equal(lib.jointOrder(others, 'a', 'before'), 0);
  assert.equal(lib.jointOrder(others, 'a', 'after'), 1500);
  assert.equal(lib.jointOrder(others, 'b', 'before'), 1500);
  assert.equal(lib.jointOrder(others, 'b', 'after'), 3000);
});

test('a length is typed as hours and minutes and stored as minutes, and shown as "8 h 15 min"', () => {
  assert.deepEqual(lib.splitMinutes(495), { hours: 8, minutes: 15 });
  assert.deepEqual(lib.splitMinutes(45), { hours: null, minutes: 45 });
  assert.deepEqual(lib.splitMinutes(120), { hours: 2, minutes: null });
  assert.deepEqual(lib.splitMinutes(null), { hours: null, minutes: null });
  assert.equal(lib.joinMinutes(8, 15), 495);
  assert.equal(lib.joinMinutes(8, null), 480);
  assert.equal(lib.joinMinutes(null, 90), 90, 'minutes past 59 still count');
  assert.equal(lib.joinMinutes(null, null), null, 'nothing entered');
  assert.equal(lib.joinMinutes(0, 0), null);
  assert.equal(lib.joinMinutes(24, 30), 24 * 60 + 30, 'a journey longer than a day keeps its length (#14)');
  assert.equal(lib.joinMinutes(26, 0), 26 * 60);
  assert.equal(lib.MAX_MINUTES, 7 * 24 * 60);
  assert.equal(lib.joinMinutes(200, 0), lib.MAX_MINUTES, 'at most 7 days, as cleanItem keeps');
  assert.equal(lib.gapText(495), '8 h 15 min');
  assert.equal(lib.gapText(480), '8 h');
  // A length saved before (whole minutes) reads back the same: the stored shape did not change.
  assert.equal(lib.cleanItem({ id: 'f', kind: 'journey', mode: 'flight', title: 'x', minutes: 495 }).minutes, 495);
  assert.equal(lib.cleanItem({ id: 'l', kind: 'stop', title: 'x', travelMode: 'taxi', travelMinutes: 20 }).travelMinutes, 20);
  assert.equal(lib.cleanItem({ id: 'f', kind: 'journey', mode: 'flight', title: 'x', minutes: 1470 }).minutes, 1470, '24 h 30 min is stored as it is');
  assert.equal(lib.cleanItem({ id: 'f', kind: 'journey', mode: 'ferry', title: 'x', minutes: 99999 }).minutes, lib.MAX_MINUTES);
});

// The page's own one-line helpers (`const name = ...;`), run with the model and a stand-in for host.util.time on either clock.
const pageLine = (name) => {
  const line = read('travel.js').split('\n').find((l) => l.trimStart().startsWith(`const ${name} = `));
  assert.ok(line, `travel.js has ${name}`);
  return line.trim();
};
const clockTime = (clock) => (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return hhmm || '';
  if (clock === '24') return `${m[1].padStart(2, '0')}:${m[2]}`;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};
const pageHelpers = (clock) => new Function('lib', 'host', 'parseYmd', `const { arrivalOf, laterText } = lib;\n${pageLine('tt')}\n${pageLine('arriveText')}\n${pageLine('dayTime')}\nreturn { tt, arriveText, dayTime };`)(lib, { util: { time: clockTime(clock) } }, parseYmd);

test('a journey arrives on the day it arrives: the next day, or +2 days (#14)', () => {
  const ferry = lib.cleanItem({ id: 'f', kind: 'journey', mode: 'ferry', title: 'Ferry', date: '2026-10-03', time: '08:00', minutes: 26 * 60 });
  assert.deepEqual(lib.arrivalOf(ferry), { day: '2026-10-04', time: '10:00', days: 1 });
  assert.deepEqual(lib.arrivalOf({ time: '22:30', minutes: 90 }), { day: null, time: '00:00', days: 1 });
  assert.deepEqual(lib.arrivalOf({ date: '2026-10-31', time: '20:00', minutes: 50 * 60 }), { day: '2026-11-02', time: '22:00', days: 2 });
  assert.deepEqual(lib.arrivalOf({ date: '2026-10-03', time: '09:00', minutes: 60 }), { day: '2026-10-03', time: '10:00', days: 0 });
  assert.equal(lib.arrivalOf({ time: '09:00' }), null);
  assert.equal(lib.laterText(0), '');
  assert.equal(lib.laterText(1), 'the next day');
  assert.equal(lib.laterText(3), '+3 days');
  const page = pageHelpers('12');
  assert.equal(page.arriveText(ferry), '10:00 AM the next day', 'the card and the time column say the day');
  assert.equal(page.arriveText({ date: '2026-10-03', time: '20:00', minutes: 50 * 60 }), '10:00 PM +2 days');
  assert.equal(page.arriveText({ date: '2026-10-03', time: '09:00', minutes: 40 }), '9:40 AM');
  // The trip ends when and where the last journey arrives.
  assert.deepEqual(lib.tripBounds([ferry]).end, { id: 'f', day: '2026-10-04', time: '10:00' });
  const js = read('travel.js');
  assert.ok(!/tt\(hm\(minutesOfDay\(item\.time\) \+ item\.minutes\)\)/.test(js), 'no arrival is worked out without its day');
  const html = read('travel.html');
  // One message for a length over 7 days: the form's own (no browser bubble from a max on the hours box).
  for (const id of ['f-hours', 'f-back-hours', 'f-travelHours']) assert.match(html, new RegExp(`id="${id}" name="\\w+" type="number" min="0" step="1"`), `${id} has no max of its own`);
  assert.ok(js.includes("fail('A length can be at most 7 days (168 hours).')"), 'the form says the longest length');
  // The narrow time column holds the whole arrival: the day on its own line, wrapping, never running under the card.
  assert.ok(js.includes("`→ ${arriveText(item, '\\n')}`"), 'the time column puts the arrival day on its own line');
  assert.match(read('travel-lib-cards.css'), /\.when small, \.row\.marker \.when b \{ white-space: pre-line; \}/, 'the time column keeps those lines and wraps');
  assert.equal(page.arriveText(ferry, '\n'), '10:00 AM\nthe next day');
});

test('Bookings and Money follow the environment\'s clock (#15)', () => {
  const flight = lib.cleanItem({ id: 'f', kind: 'journey', mode: 'flight', title: 'Flight', date: '2026-10-03', time: '09:40' });
  const day = parseYmd('2026-10-03').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  assert.equal(pageHelpers('12').dayTime(flight), `${day} 9:40 AM`);
  assert.equal(pageHelpers('24').dayTime(flight), `${day} 09:40`);
  assert.equal(pageHelpers('12').dayTime({ ...flight, date: null, time: '16:40' }), 'unscheduled 4:40 PM');
  // No stored time goes on the page as it is stored: Decisions' card times too.
  assert.ok(!/w\.time \? ' ' \+ w\.time/.test(read('travel.js')), 'Decisions shows a card\'s time on the clock');
});

test('taxi, ride share and shuttle are journeys with a tile and a card, and ride share is a way to a stop', () => {
  const it = (o) => lib.cleanItem({ id: 'x', title: 't', ...o });
  for (const mode of ['taxi', 'rideshare', 'shuttle']) {
    assert.ok(lib.MODES.includes(mode) && lib.JOURNEY_TILES.includes(mode) && lib.TILES.includes(mode), mode);
    assert.equal(it({ kind: 'journey', mode }).mode, mode);
    assert.equal(lib.tileOf(it({ kind: 'journey', mode })), mode);
    assert.deepEqual(lib.fromTile(mode), { kind: 'journey', mode, category: 'travel' });
    const c = lib.cardOf(it({ kind: 'journey', mode }));
    assert.equal(c.template, 'transit');
    assert.equal(c.family, mode);
    assert.ok(c.kicker && c.badge, mode);
  }
  assert.equal(lib.cardOf(it({ kind: 'journey', mode: 'rideshare' })).kicker, 'Ride share');
  assert.ok(lib.TRAVEL_MODES.includes('rideshare') && lib.LEG_ICONS.rideshare);
});

test('the page: every journey kind has its colours and is in the kind picker, lengths are hours and minutes, a stay checks out on any date', () => {
  const html = read('travel.html');
  const cardStyles = read('travel-lib-cards.css');
  const page = read('travel.js');
  assert.ok(html.includes('<div id="f-types"></div>') && !html.includes('class="tile"'), 'the kind picker (host.ui.kindPicker) is drawn into an empty #f-types; the tiles are gone');
  assert.ok(/host\.ui\.kindPicker\(box, \{/.test(page) && /label: 'What is it'/.test(page) && /recent: \{ key: 'add', max: 4 \}/.test(page), 'the Planner draws the kind picker with its label and a recent list');
  for (const t of lib.TILES) {
    assert.equal(typeof lib.TURNS[t], 'number', `a colour family (TURNS) for ${t}`);
    assert.match(cardStyles, new RegExp(`\\.entry\\[data-type="${t}"\\] \\{ --turn: ${lib.TURNS[t]}; \\}`), `the card's colour for ${t} is the picker's`);
  }
  for (const t of lib.JOURNEY_TILES) assert.ok(page.includes(`'Getting there', options: JOURNEY_TILES.map`), `a kind for ${t}`);
  for (const m of Object.keys(lib.LEG_ICONS)) assert.ok(html.includes(`data-mode="${m}"`), `a way-to-a-stop button for ${m}`);
  assert.ok(!/\(minutes\)|Minutes from/.test(html), 'no length is asked for in minutes alone');
  for (const id of ['f-hours', 'f-minutes', 'f-travelHours', 'f-travelMinutes']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /<span class="sdk-label" id="f-checkout-label">Check out<\/span><select id="f-checkout" name="checkOut" hidden><\/select><input id="f-checkout-input" type="date"[^>]*>[\s\S]*?<label class="sdk-field sdk-s" id="f-checkouttime-field" data-types="hotel"><span class="sdk-label">Check-out time<\/span><input id="f-checkOutTime" name="checkOutTime" type="time">/, 'check-out is a date field (the SDK date picker draws it, with the list of days behind it; the select holds the value) and a time, laid out as check-in is (#245)');
  assert.ok(html.includes('<span class="side">Departs</span>') && html.includes('<span class="side">Arrives</span>'), 'a flight card says which end departs and which arrives');
});

test('an empty day is a button that opens the day\'s add menu, worded for the pointer', () => {
  const html = read('travel.html');
  const js = read('travel.js');
  assert.match(html, /<template id="tpl-day-empty-add"><li class="day-empty-slot"><button class="sdk-day-empty" type="button" data-action="day-menu"/, 'the empty day uses the header\'s own day-menu action');
  assert.ok(js.includes("matchMedia('(pointer: coarse)')") && js.includes('Nothing planned yet. ${') && js.includes("'Tap' : 'Click'"), 'Click or Tap to add, chosen by the pointer');
  assert.ok(!js.includes('Add something below'), 'the old sentence pointing at a hidden row is gone');
});

// --- round trips (#9): two journeys, the return pointing at the outbound with `legOf` --------------------------------

const leg = (id, extra) => lib.cleanItem({ id, kind: 'journey', title: id, mode: 'flight', date: '2026-10-03', ...extra });

test('cleanItem keeps legOf on a journey that is not a car, and keeps the leg\'s own booking details', () => {
  const back = leg('b', { legOf: 'a', confirm: 'XYZ', cost: 300, paidBy: 'u1' });
  assert.equal(back.legOf, 'a');
  assert.equal(back.confirm, 'XYZ', 'set aside only where its outbound is found');
  assert.equal(back.cost, 300);
  assert.equal(leg('b', { mode: 'car', legOf: 'a' }).legOf, null, 'a car cannot be a round trip');
  assert.equal(leg('a', { legOf: 'a' }).legOf, null, 'never its own leg');
  assert.equal(leg('b', { legOf: 42 }).legOf, null);
  assert.equal(lib.cleanItem({ id: 's', kind: 'stop', title: 'x', legOf: 'a' }).legOf, undefined, 'only a journey');
  const old = leg('o', { confirm: 'ABC', cost: 120, paidBy: 'u1' });
  assert.equal(old.legOf, null, 'an existing one-way journey has none');
  assert.equal(old.confirm, 'ABC');
  assert.equal(old.cost, 120);
  assert.equal(leg('b', { mode: 'train', legOf: 'a' }).legOf, 'a');
  assert.equal(leg('b', { mode: 'taxi', legOf: 'a' }).legOf, 'a');
});

test('returnOf and outboundOf read the pair; a return with no outbound, or a second one, reads as one-way', () => {
  const out = leg('a', { confirm: 'XYZ', cost: 300, paidBy: 'u1' });
  const back = leg('b', { legOf: 'a', date: '2026-10-09', order: 1000 });
  const second = leg('c', { legOf: 'a', date: '2026-10-09', order: 2000 });
  const items = [out, back, second];
  assert.equal(lib.returnOf(items, 'a').id, 'b');
  assert.equal(lib.outboundOf(items, back).id, 'a');
  assert.equal(lib.outboundOf(items, second), null, 'the second return reads as a journey of its own');
  assert.deepEqual(lib.legsOf(items, 'a').map((i) => i.id), ['b', 'c']);
  assert.equal(lib.returnOf(items, 'b'), null);
  assert.equal(lib.outboundOf(items, out), null);
  assert.equal(lib.outboundOf([back], back), null, 'the outbound is gone');
  assert.equal(lib.returnOf([leg('a', { mode: 'car' }), back], 'a'), null, 'a car has no return');
});

test('Bookings lists a round trip once; Money counts its cost once', () => {
  const out = leg('a', { confirm: 'XYZ', cost: 300, paidBy: 'u1' });
  const back = leg('b', { legOf: 'a', date: '2026-10-09', cost: 300, paidBy: 'u2' });
  assert.deepEqual(lib.bookings([out, back]).map((i) => i.id), ['a']);
  assert.deepEqual(lib.bookings([back]).map((i) => i.id), ['b'], 'a return whose outbound is gone is its own row');
  assert.deepEqual(lib.costItems([out, back]).map((i) => i.id), ['a'], 'a return found with its outbound is not counted again');
  const b = lib.balances(lib.costItems([out, back]), ['u1', 'u2']);
  assert.equal(b.total, 300);
  assert.equal(b.paid.u1, 300);
  assert.equal(b.paid.u2 || 0, 0);
});

test('a return placed before its outbound is noticed', () => {
  const out = leg('a', { date: '2026-10-05', time: '10:00' });
  assert.equal(lib.returnBefore(leg('b', { date: '2026-10-04' }), out), true);
  assert.equal(lib.returnBefore(leg('b', { date: '2026-10-05', time: '09:00' }), out), true);
  assert.equal(lib.returnBefore(leg('b', { date: '2026-10-05' }), out), false);
  assert.equal(lib.returnBefore(leg('b', { date: '2026-10-09' }), out), false);
  assert.equal(lib.returnBefore(leg('b', { date: null }), out), false);
});

test('a journey with a leftover legOf (its outbound gone) keeps its own booking details, in Bookings and Money', () => {
  const orphan = leg('bus', { mode: 'bus', legOf: 'gone123', confirm: 'BUS-9', cost: 15, paidBy: 'u1' });
  assert.equal(orphan.confirm, 'BUS-9');
  assert.equal(orphan.cost, 15);
  assert.equal(orphan.paidBy, 'u1');
  assert.equal(lib.outboundOf([orphan], orphan), null);
  assert.deepEqual(lib.bookings([orphan]).map((i) => i.id), ['bus']);
  assert.deepEqual(lib.costItems([orphan]).map((i) => i.id), ['bus']);
  // the second return of a pair keeps its own too
  const out = leg('a');
  const back = leg('b', { legOf: 'a', order: 1 });
  const second = leg('c', { legOf: 'a', order: 2, confirm: 'C2', cost: 9, paidBy: 'u1' });
  assert.deepEqual(lib.costItems([out, back, second]).map((i) => i.id), ['c']);
});

const roundTrips = async () => {
  const f = fakeHost();
  const plan = lib.createPlan(f.t);
  await plan.load();
  await plan.saveTrip({ start: '2026-10-03', end: '2026-10-09' });
  await assert.rejects(() => plan.addRoundTrip({ title: 'Car', mode: 'car', date: '2026-10-03' }, { title: 'Back', date: '2026-10-09' }), /car/);
  assert.equal(plan.list().length, 0, 'nothing is added for a car');

  const { out, back } = await plan.addRoundTrip({ title: 'Flight to New York', mode: 'flight', date: '2026-10-03', fromCode: 'LHR', toCode: 'JFK', confirm: 'XYZ', cost: 800, paidBy: 'u1' }, { title: 'Flight to London', date: '2026-10-09', fromCode: 'JFK', toCode: 'LHR', confirm: 'NO', cost: 5 });
  assert.equal(back.legOf, out.id);
  assert.equal(back.mode, 'flight');
  assert.equal(back.cost, null);
  assert.equal(plan.returnFor(out.id).id, back.id);
  assert.equal(plan.outboundFor(back).id, out.id);
  assert.equal(plan.byDay().get('2026-10-03')[0].id, out.id, 'each leg on its own day');
  assert.equal(plan.byDay().get('2026-10-09')[0].id, back.id);
  assert.equal(lib.balances(lib.costItems(plan.list()), ['u1']).total, 800);
  // a return moved before its outbound is allowed
  await plan.moveTo(back.id, '2026-10-03', 0);
  assert.equal(plan.list().find((i) => i.id === back.id).date, '2026-10-03');
  await plan.moveTo(back.id, '2026-10-09', 0);
  // an orphan saved alone (its outbound gone) keeps its booking details
  const lone = await plan.addItem({ kind: 'journey', mode: 'bus', title: 'Old bus', date: '2026-10-05', legOf: 'gone123', confirm: 'BUS-9', cost: 15, paidBy: 'u1' });
  await plan.updateItem(lone.id, { notes: 'x' });
  const saved = f.store.get('plan:' + lone.id).value;
  assert.equal(saved.confirm, 'BUS-9');
  assert.equal(saved.cost, 15);
  await plan.removeItem(lone.id);
  n += 1;

  // deleting only the outbound: the return becomes one-way and keeps the booking details
  await plan.removeLeg(out.id, false);
  const alone = plan.list().find((i) => i.id === back.id);
  assert.equal(plan.list().some((i) => i.id === out.id), false);
  assert.equal(alone.legOf, null);
  assert.equal(alone.confirm, 'XYZ');
  assert.equal(alone.cost, 800);
  assert.equal(alone.paidBy, 'u1');
  n += 1;

  // deleting both legs, from the return; deleting only the return keeps the outbound as it was
  const p2 = await plan.addRoundTrip({ title: 'Train to Porto', mode: 'train', date: '2026-10-04', confirm: 'T1', cost: 40, paidBy: 'u1' }, { title: 'Train to Lisbon', date: '2026-10-06' });
  await plan.removeLeg(p2.back.id, true);
  assert.equal(plan.list().some((i) => i.id === p2.out.id || i.id === p2.back.id), false);
  const p3 = await plan.addRoundTrip({ title: 'Ferry', mode: 'ferry', date: '2026-10-04', confirm: 'F1', cost: 20, paidBy: 'u1' }, { title: 'Ferry back', date: '2026-10-05' });
  await plan.removeLeg(p3.back.id, false);
  const kept = plan.list().find((i) => i.id === p3.out.id);
  assert.equal(kept.confirm, 'F1');
  assert.equal(kept.cost, 20);
  assert.equal(plan.returnFor(p3.out.id), null);
  // a journey that is not a round trip is deleted alone
  await plan.removeLeg(p3.out.id, true);
  assert.equal(plan.list().some((i) => i.id === p3.out.id), false);
  n += 1;

  // two returns for one outbound (two people at once): the first by order is the return; the other is an extra
  const p4 = await plan.addRoundTrip({ title: 'Bus', mode: 'bus', date: '2026-10-04' }, { title: 'Bus back', date: '2026-10-07' });
  const extra = await plan.addItem({ kind: 'journey', mode: 'bus', title: 'Bus back again', date: '2026-10-07', legOf: p4.out.id });
  assert.equal(plan.returnFor(p4.out.id).id, p4.back.id);
  assert.deepEqual(plan.extraReturns(p4.out.id).map((i) => i.id), [extra.id]);
  assert.equal(plan.outboundFor(extra), null);
  n += 1;
};
await roundTrips();

const longNotes = async () => {
  const f = fakeHost();
  const plan = lib.createPlan(f.t);
  await plan.load();
  await plan.saveTrip({ title: 'Trip', start: '2026-10-01', end: '2026-10-03' });
  const fields = plan.fromSuggestion({ title: 'Hotel', content: 'x'.repeat(7000) });
  assert.equal(fields.notes.length, 7000);
  assert.equal(lib.cleanItem({ id: 'n', kind: 'stop', title: 'Hotel', notes: fields.notes }).notes.length, 7000);
  n += 1;
};
await longNotes();

const coverDates = async () => {
  const f = fakeHost();
  const plan = lib.createPlan(f.t);
  await plan.load();
  await plan.saveTrip({ title: 'Faro', start: '2026-10-03', end: '2026-10-05' });
  plan.provide();
  await f.provided.acceptSuggestion({ title: 'LIS to FAO', kind: 'flight', date: '2026-10-01' });
  assert.equal(plan.trip.start, '2026-10-01');
  assert.equal(plan.trip.end, '2026-10-05');
  assert.ok(plan.days().includes('2026-10-01'));
  await f.provided.acceptSuggestion({ title: 'Dinner in town', kind: 'restaurant', date: '2026-10-07' });
  assert.equal(plan.trip.start, '2026-10-01');
  assert.equal(plan.trip.end, '2026-10-07');
  await plan.addItem({ kind: 'stay', title: 'Seaside Inn', type: 'hotel', date: '2026-10-06', checkOut: '2026-10-09' });
  assert.equal(plan.trip.end, '2026-10-09');
  const dinner = plan.list().find((i) => i.title === 'Dinner in town');
  await plan.updateItem(dinner.id, { date: '2026-09-30' });
  assert.equal(plan.trip.start, '2026-09-30');
  assert.equal(plan.trip.end, '2026-10-09');
  const inside = plan.trip;
  await plan.addItem({ kind: 'stop', title: 'A walk', date: '2026-10-04' });
  assert.equal(plan.trip.start, inside.start);
  assert.equal(plan.trip.end, inside.end);
  await plan.addItem({ kind: 'note', title: 'Packing list' });
  assert.equal(plan.trip.start, inside.start);
  assert.equal(plan.trip.end, inside.end);
  n += 1;
};
await coverDates();

const TRAVEL_PHASES = [
  { id: 'planning', label: 'Planning' },
  { id: 'booking', label: 'Booking' },
  { id: 'trip', label: 'Trip', main: true },
  { id: 'post-trip', label: 'Post-trip' },
];

test('a phase keeps a sound id; a trip never keeps a `phases` of its own (the dates are the space\'s, plan-one-bar.md step 2)', () => {
  assert.equal(lib.cleanItem({ id: 'a', kind: 'stop', title: 'Pack', phase: 'pre-trip' }).phase, 'pre-trip');
  assert.equal(lib.cleanItem({ id: 'a', kind: 'stop', title: 'Pack', phase: 'Pre' }).phase, null);
  assert.equal(lib.cleanItem({ id: 'a', kind: 'stop', title: 'Pack' }).phase, null);
  const t = lib.cleanTrip({ title: 'Harbour', start: '2026-10-01', end: '2026-10-05', phases: { planning: { start: '2026-10-08' } } });
  assert.equal(t.v, 2);
  assert.equal(t.start, '2026-10-01', 'the plan\'s own dates stay in the record (a space without phases uses them)');
  assert.equal(t.end, '2026-10-05');
  assert.equal('phases' in t, false, 'a stored phases is dropped');
  assert.equal(lib.planName(null, { name: 'Harbour' }), 'Harbour');
  assert.equal(lib.planName({ title: '' }, { name: 'Harbour' }), 'Harbour');
  assert.equal(lib.planName({ title: 'Cabin' }, { name: 'Harbour' }), 'Cabin');
  assert.equal(lib.planName(null, null), '');
});

// The plan's days come from the main band of the space's timeline (public/phases.js timelineOf), as the SDK gives it.
const bandsFor = (dates, today, created = '2026-09-01') => Phases.timelineOf(TRAVEL_PHASES, dates, { today, created });

test('the plan\'s first and last day are the main band\'s with phases, the trip\'s own without', () => {
  const dates = { booking: { start: '2026-09-10' }, trip: { start: '2026-10-01', end: '2026-10-09' } };
  assert.deepEqual(lib.tripSpan({ start: '2026-01-01', end: '2026-01-05' }, bandsFor(dates, '2026-09-15')), { start: '2026-10-01', end: '2026-10-09' }, 'the stored dates are not read with phases');
  assert.deepEqual(lib.tripSpan(null, bandsFor(dates, '2026-09-15')), { start: '2026-10-01', end: '2026-10-09' }, 'no stored trip at all');
  assert.deepEqual(lib.tripSpan(null, bandsFor({ trip: { start: '2026-10-01' } }, '2026-09-15')), { start: '2026-10-01', end: '2026-10-01' }, 'open-ended: one day');
  assert.deepEqual(lib.tripSpan(null, bandsFor({ trip: { start: '2026-10-01' }, 'post-trip': { start: '2026-10-05' } }, '2026-09-15')), { start: '2026-10-01', end: '2026-10-04' }, 'ends the day before the next boundary');
  assert.deepEqual(lib.tripSpan({ start: '2026-01-01' }, bandsFor({}, '2026-09-15')), { start: null, end: null }, 'phases, but the main one has no start');
  assert.deepEqual(lib.tripSpan({ start: '2026-01-01', end: '2026-01-05' }, []), { start: '2026-01-01', end: '2026-01-05' }, 'no phases: the trip\'s own');
  assert.deepEqual(lib.tripSpan({ start: '2026-01-05', end: '2026-01-01' }, []), { start: '2026-01-05', end: '2026-01-05' });
  assert.deepEqual(lib.tripSpan(null, []), { start: null, end: null });
  assert.equal(lib.mainBand(bandsFor(dates, '2026-09-15')).id, 'trip');
  assert.equal(lib.mainBand([]), null);
});

test('the current phase is the last band that has started, else the first; an object is in its own phase when it is still listed', () => {
  const created = '2026-09-01';
  assert.equal(lib.currentBand(bandsFor({}, '2026-09-15', created), '2026-09-15').id, 'planning', 'nothing dated: the first phase from the created day');
  assert.equal(lib.currentBand(bandsFor({}, '2026-08-15', created), '2026-08-15').id, 'planning', 'before the created day: the first phase');
  const dates = { trip: { start: '2026-10-01', end: '2026-10-09' } };
  assert.equal(lib.currentBand(bandsFor(dates, '2026-09-15', created), '2026-09-15').id, 'planning', 'before the trip');
  assert.equal(lib.currentBand(bandsFor(dates, '2026-10-03', created), '2026-10-03').id, 'trip', 'during it');
  assert.equal(lib.currentBand(bandsFor(dates, '2026-10-15', created), '2026-10-15').id, 'trip', 'after it, nothing dated later: still the trip');
  const after = { ...dates, 'post-trip': { start: '2026-10-12' } };
  assert.equal(lib.currentBand(bandsFor(after, '2026-10-10', created), '2026-10-10').id, 'trip', 'in the gap after the trip\'s end');
  assert.equal(lib.currentBand(bandsFor(after, '2026-10-15', created), '2026-10-15').id, 'post-trip');
  const between = { booking: { start: '2026-09-11' }, ...dates };
  assert.equal(lib.currentBand(bandsFor(between, '2026-09-20', created), '2026-09-20').id, 'booking');
  const bands = bandsFor(dates, '2026-10-03', created);
  assert.equal(lib.phaseOf.length, 2, 'phaseOf takes the item and the bands, not a date');
  assert.equal(lib.phaseOf({ phase: 'planning' }, bands), 'planning');
  assert.equal(lib.phaseOf({ phase: 'gone' }, bands), null, 'a phase no longer listed: Unscheduled');
  assert.equal(lib.phaseOf({}, bands), null, 'no phase of its own: Unscheduled, not the current phase');
  assert.equal(lib.phaseOf({}, bands), null, 'and it does not move as the calendar does');
  assert.equal(lib.currentBand([], '2026-10-03'), null);
  assert.equal(lib.phaseOf({}, []), null);
});

test('a day wears its phase: the band it is in, its tint and name; nothing before, between or after', () => {
  const phases = [{ id: 'planning', label: 'Planning' }, { id: 'booking', label: 'Booking' }, { id: 'trip', label: 'Trip', main: true }, { id: 'after', label: 'After' }];
  // Planning from the 1st, Booking from the 10th, the trip 16th to 19th, After from the 25th (open-ended): the 20th to the 24th is a gap.
  const dates = { planning: { start: '2026-10-01' }, booking: { start: '2026-10-10' }, trip: { start: '2026-10-16', end: '2026-10-19' }, after: { start: '2026-10-25' } };
  const bands = Phases.timelineOf(phases, dates, { today: '2026-10-14', created: '2026-09-01' });
  const on = (day) => lib.phaseOnDay(bands, day);
  assert.equal(on('2026-09-30'), null, 'a day before the first phase starts has none');
  assert.deepEqual(on('2026-10-01'), { id: 'planning', label: 'Planning', tint: 'blue', first: true });
  assert.deepEqual(on('2026-10-09'), { id: 'planning', label: 'Planning', tint: 'blue', first: false }, 'inside the band, the last day of it');
  assert.deepEqual(on('2026-10-10'), { id: 'booking', label: 'Booking', tint: 'green', first: true }, 'the next band starts the day after the one before ends');
  assert.deepEqual(on('2026-10-19'), { id: 'trip', label: 'Trip', tint: 'teal', first: false }, 'the main band\'s last day');
  assert.equal(on('2026-10-20'), null, 'the gap after the main phase has none');
  assert.equal(on('2026-10-24'), null);
  assert.deepEqual(on('2026-10-25'), { id: 'after', label: 'After', tint: 'purple', first: true });
  assert.equal(on('2027-03-01').id, 'after', 'the open-ended last phase has no last day');
  // The tint is the band\'s own (Phases.tintOf): a phase after a dateless one keeps its place in the template.
  const skip = Phases.timelineOf(phases, { booking: { start: '2026-10-10' } }, { created: '2026-09-01' });
  assert.equal(lib.phaseOnDay(skip, '2026-10-12').tint, 'green', 'booking is second, so green, whatever else is dated');
  assert.equal(lib.phaseOnDay(skip, '2026-10-05').id, 'planning', 'the first phase starts on the created day');
  // Nothing drawn without phases, with an undated band, a bad day, or a tint the theme does not have.
  assert.equal(lib.phaseOnDay([], '2026-10-12'), null);
  assert.equal(lib.phaseOnDay(undefined, '2026-10-12'), null);
  assert.equal(lib.phaseOnDay(Phases.timelineOf(phases, {}, {}), '2026-10-12'), null, 'no dates, no created day: nothing is dated');
  assert.equal(on('nope'), null);
  assert.equal(lib.phaseOnDay([{ id: 'x', label: 'X', tint: 'chartreuse', start: '2026-10-01', end: null, dated: true }], '2026-10-02').tint, null, 'an unknown tint draws no colour');
});

test('the When choice reaches the whole timeline: a note dated before the trip is drawn, in its own phase', () => {
  const phases = [{ id: 'planning', label: 'Planning' }, { id: 'pre-trip', label: 'Pre-trip' }, { id: 'trip', label: 'Trip', main: true }, { id: 'post-trip', label: 'Post-trip' }];
  const dates = { planning: { start: '2026-10-11' }, 'pre-trip': { start: '2026-10-15' }, trip: { start: '2026-10-16', end: '2026-10-19' }, 'post-trip': { start: '2026-10-20', end: '2026-10-22' } };
  const bands = Phases.timelineOf(phases, dates, { today: '2026-10-14', created: '2026-09-01' });
  const span = lib.tripSpan(null, bands);
  const note = { id: 'n', kind: 'note', date: '2026-10-15' };
  const days = lib.planDays({ start: span.start, end: span.end }, [note]);
  assert.deepEqual([days[0], days[days.length - 1], days.length], ['2026-10-15', '2026-10-19', 5], 'the plan stretches to the note');
  assert.equal(lib.phaseOnDay(bands, '2026-10-15').label, 'Pre-trip', 'and the day wears the Pre-trip tint');
  assert.equal(lib.phaseOnDay(bands, '2026-10-21').label, 'Post-trip');
  const main = read('travel.js');
  const fn = main.slice(main.indexOf('function placeOptions'), main.indexOf('// The badge for a run of hidden days'));
  assert.match(fn, /plan\.bands\(\)\.filter\(\(b\) => b\.dated\)/, 'the day list reads the timeline');
  assert.match(fn, /before\.forEach/, 'days before the first drawn day are offered');
  assert.match(fn, /after\.forEach/, 'and days after the last');
});

test('the Planner draws a phase as a label in its tint on the day (no wash, design system step 34), the Calendar as a wash and a name, in theme tints', () => {
  const css = read('travel-lib-cards.css');
  for (const t of ['blue', 'green', 'teal', 'purple', 'orange', 'pink', 'gold', 'red']) assert.match(css, new RegExp(`\\.ph-${t} \\{ --ph: var\\(--tint-${t}\\); \\}`), `${t} is the theme's tint`);
  const rules = css.slice(css.indexOf('/* phases:'));
  assert.match(css, /\.sdk-day-labels > \.sdk-chip-tag\[data-tone="custom"\] \{ --chip-tone: var\(--ph\);/, 'the day\'s phase label takes the tint');
  assert.doesNotMatch(css, /\.sdk-day[^{]*\{[^}]*background: [^;]*var\(--ph\)|daychip[^{]*\{[^}]*background: [^;]*var\(--ph\)/, 'no wash on the day\'s head or the strip chip');
  assert.doesNotMatch(rules, /(border|outline|box-shadow)[^;]*var\(--ph\)/, 'a phase never draws a coloured border or outline');
  assert.doesNotMatch(css.slice(css.indexOf('/* phases:')), /#[0-9a-f]{3,8}\b|rgba?\(/i, 'no colour literals in the phase rules');
  assert.match(read('travel.js'), /phaseOnDay\(plan\.bands\(\), day\)/, 'the day header asks for its phase');
  assert.match(read('travel.js'), /phaseOnDay\(bandList, day\)/, 'and so does the strip chip (its name in the chip\'s label)');
});

test('days run from the earliest date to the latest, and there are none without one', () => {
  assert.deepEqual(lib.planDays(null, []), []);
  assert.deepEqual(lib.planDays({}, []), []);
  const one = lib.cleanItem({ id: 'a', kind: 'stop', title: 'Museum', date: '2026-10-04' });
  assert.deepEqual(lib.planDays(null, [one]), ['2026-10-04']);
  const pre = lib.cleanItem({ id: 'b', kind: 'stop', title: 'Pack', date: '2026-09-28', phase: 'planning' });
  assert.deepEqual(lib.planDays({ start: '2026-10-01', end: '2026-10-03' }, [pre]), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
});

test('coverTrip grows for the main phase and for no phase, and not for another phase or with no start', () => {
  const trip = { start: '2026-10-03', end: '2026-10-05' };
  assert.deepEqual(lib.coverTrip(trip, ['2026-10-01'], { phase: 'trip' }, TRAVEL_PHASES), { start: '2026-10-01', end: '2026-10-05' });
  assert.deepEqual(lib.coverTrip(trip, ['2026-10-01'], {}, TRAVEL_PHASES), { start: '2026-10-01', end: '2026-10-05' });
  assert.equal(lib.coverTrip(trip, ['2026-09-20'], { phase: 'planning' }, TRAVEL_PHASES), null);
  assert.equal(lib.coverTrip({}, ['2026-10-01'], { phase: 'trip' }, TRAVEL_PHASES), null);
  assert.equal(lib.coverTrip(null, ['2026-10-01'], { phase: 'trip' }, TRAVEL_PHASES), null);
});

// --- the plan on the space's timeline (plan-one-bar.md, step 2) ------------------------------------------------------
await (async () => {
  const created = '2026-09-01T12:00:00.000Z';
  const makeSpace = (phases) => ({ id: 'harbour', name: 'Harbour', createdAt: created, phases });
  const dated = { booking: { start: '2026-09-10' }, trip: { start: '2026-10-01', end: '2026-10-09' }, 'post-trip': { start: '2026-10-12' } };

  // An old trip:main (its own start, end and phases) is read without its dates: the days are the main band's, and the
  // next write drops the three keys and keeps everything else.
  const f = fakeHost({ phases: TRAVEL_PHASES, space: makeSpace(dated), today: '2026-09-15' });
  f.store.set(lib.TRIP_KEY, { value: { title: 'Old', destination: 'Faro', start: '2026-01-01', end: '2026-01-05', currency: 'EUR', phases: { planning: { start: '2026-08-01' } } }, version: 1 });
  f.store.set('plan:keep', { value: { kind: 'stop', title: 'Museum', date: '2026-10-02', order: 1000 }, version: 4 });
  const plan = lib.createPlan(f.t);
  await plan.load();
  assert.equal(plan.trip.start, '2026-10-01', 'the main band\'s start, not the stored one');
  assert.equal(plan.trip.end, '2026-10-09');
  assert.equal(plan.trip.title, 'Old');
  assert.deepEqual(plan.days(), lib.tripDays({ start: '2026-10-01', end: '2026-10-09' }), 'the days from the main band');
  assert.equal(f.store.get(lib.TRIP_KEY).version, 1, 'reading writes nothing');
  await plan.saveTrip({ title: 'Faro in October' });
  const saved = f.store.get(lib.TRIP_KEY).value;
  assert.deepEqual(Object.keys(saved).sort(), ['by', 'currency', 'destination', 'notes', 'title', 'v'], 'start, end and phases are dropped at the next write');
  assert.equal(saved.title, 'Faro in October');
  assert.equal(saved.currency, 'EUR');
  assert.equal(plan.trip.start, '2026-10-01', 'and the days are still the band\'s');
  assert.deepEqual(f.store.get('plan:keep'), { value: { kind: 'stop', title: 'Museum', date: '2026-10-02', order: 1000 }, version: 4 }, 'an object is not rewritten');
  assert.equal(plan.phased(), true);
  assert.equal(plan.bands().find((b) => b.main).start, '2026-10-01');
  n += 1;

  // Nothing stored yet, but the space's main phase is dated: the plan has days and a (nameless) trip.
  const g = fakeHost({ phases: TRAVEL_PHASES, space: makeSpace(dated), today: '2026-09-15' });
  const planG = lib.createPlan(g.t);
  await planG.load();
  assert.equal(planG.trip.start, '2026-10-01');
  assert.equal(planG.trip.title, '');
  assert.equal(lib.planName(planG.trip, g.t.space()), 'Harbour');
  assert.deepEqual(planG.days(), lib.tripDays({ start: '2026-10-01', end: '2026-10-09' }));
  assert.ok(!g.store.has(lib.TRIP_KEY), 'nothing written');
  n += 1;

  // Phases, but the main one has no start: no trip and no days until something is dated; an object does not cover.
  const u = fakeHost({ phases: TRAVEL_PHASES, space: makeSpace({}), today: '2026-09-15' });
  const planU = lib.createPlan(u.t);
  await planU.load();
  assert.equal(planU.trip, null);
  assert.deepEqual(planU.days(), []);
  await planU.addItem({ kind: 'stop', title: 'Idea', date: '2026-10-04', phase: 'trip' });
  assert.deepEqual(u.covered, [], 'no main start: nothing to cover');
  assert.deepEqual(planU.days(), ['2026-10-04']);
  assert.equal(planU.trip, null);
  await planU.saveTrip({ title: 'Faro', start: '2026-10-03', end: '2026-10-05' });
  assert.equal('start' in u.store.get(lib.TRIP_KEY).value, false, 'with phases the form\'s dates are never written');
  assert.equal(planU.trip.start, null);
  n += 1;

  // coverTrip through the cover route: a dated object past the main end moves the end (and the later boundary) through
  // host.phasesCover; one before the main start, or in another phase, moves nothing; the MAX_DAYS refusal stays.
  const c = fakeHost({ phases: TRAVEL_PHASES, space: makeSpace(dated), today: '2026-09-15' });
  const planC = lib.createPlan(c.t);
  await planC.load();
  await planC.addItem({ kind: 'stop', title: 'Fly home', date: '2026-10-11', phase: 'trip' });
  assert.deepEqual(c.covered, ['2026-10-11']);
  assert.equal(planC.trip.end, '2026-10-11', 'the main end moved');
  assert.equal(c.t.space().phases['post-trip'].start, '2026-10-14', 'the later boundary moved with it');
  assert.equal(planC.days().at(-1), '2026-10-11');
  await planC.addItem({ kind: 'stop', title: 'Pack', date: '2026-09-20', phase: 'planning' });
  await planC.addItem({ kind: 'stop', title: 'Early', date: '2026-09-28' });
  assert.deepEqual(c.covered, ['2026-10-11'], 'another phase, and a day before the main start: nothing asked of the host');
  assert.equal(planC.trip.start, '2026-10-01', 'the main start never moves from here');
  assert.equal(planC.days()[0], '2026-09-20', 'the days still reach the objects');
  await planC.addItem({ kind: 'stop', title: 'Later', date: '2026-10-20', phase: 'post-trip' });
  assert.deepEqual(c.covered, ['2026-10-11'], 'a phase that is not the main one does not cover');
  await assert.rejects(() => planC.addItem({ kind: 'stop', title: 'Far', date: '2027-01-15' }), (e) => e.message === 'A plan can be at most 60 days long, so that day is left off the plan.' && Boolean(e.item));
  assert.deepEqual(c.covered, ['2026-10-11'], 'refused before the host is asked');
  assert.deepEqual(await planC.coverDay('2026-10-13'), { ...c.t.space().phases }, 'coverDay answers the new phases');
  assert.equal(planC.trip.end, '2026-10-13');
  assert.equal(await planC.coverDay('2026-10-05'), null, 'already covered: nothing moved');
  n += 1;

  // Without phases: First day and Last day are the plan's own, written and grown as before.
  const p = fakeHost({ space: makeSpace({}) });
  const planP = lib.createPlan(p.t);
  await planP.load();
  assert.equal(planP.trip, null);
  assert.equal(planP.phased(), false);
  assert.deepEqual(planP.bands(), []);
  await planP.addItem({ kind: 'stop', title: 'Idea', date: '2026-10-04' });
  assert.equal(planP.trip, null, 'no start, so nothing is written');
  assert.deepEqual(planP.days(), ['2026-10-04']);
  await planP.saveTrip({ title: 'Faro', start: '2026-10-03', end: '2026-10-05' });
  assert.deepEqual([p.store.get(lib.TRIP_KEY).value.start, p.store.get(lib.TRIP_KEY).value.end], ['2026-10-03', '2026-10-05'], 'written with the trip');
  await planP.addItem({ kind: 'stop', title: 'Pack', date: '2026-09-20' });
  assert.equal(planP.trip.start, '2026-09-20', 'grows earlier too without phases');
  assert.equal(planP.trip.end, '2026-10-05');
  await planP.addItem({ kind: 'stop', title: 'Fly', date: '2026-10-08' });
  assert.equal(planP.trip.end, '2026-10-08');
  assert.deepEqual(p.covered, [], 'the host is never asked without phases');
  assert.equal(await planP.coverDay('2026-10-20'), null);
  n += 1;

  // A host without the rule (an older SDK): the plan runs as a space without phases would.
  const o = fakeHost({ phases: TRAVEL_PHASES, space: makeSpace(dated) });
  delete o.t.util.phaseTimeline;
  const planO = lib.createPlan(o.t);
  await planO.load();
  assert.deepEqual(planO.bands(), []);
  assert.equal(planO.trip, null);
  n += 1;
})();

test('the page: with phases there is no plan form (the dates are the bar\'s, the currency the budget\'s); without, a dates form', () => {
  const html = read('travel.html');
  const js = read('travel.js');
  assert.ok(!html.includes('tpl-phase-row'), 'the per-phase date rows are gone');
  assert.ok(!html.includes('id="f-phases"'));
  assert.ok(html.includes('id="f-start"') && html.includes('id="f-end"'), 'First day and Last day stay for a space without phases');
  assert.ok(!html.includes('id="f-destination"') && !html.includes('id="f-phase-note"'), 'Where is no longer asked');
  assert.ok(!/id="tpl-editor-trip"[\s\S]*?id="f-notes"[\s\S]*?<template id="tpl-editor2"/.test(html), 'nor Notes, in the plan form');
  assert.match(js, /if \(canEdit\) items\.push\(\{ id: 'edit-trip'/, 'the pencil is there with phases too: the time zone is the trip\'s own');
  assert.match(js, /function planCurrency\(\)/, 'the budget\'s currency wins');
  assert.match(js, /if \(!plan\.phased\(\)\) \{\s*const start = \$\('f-start'\)\.value;/, 'the form\'s dates are only read without phases');
  assert.ok(!js.includes('fillTripPhases'));
  assert.match(js, /host\.util\.phaseWords\(bands, ymd\(new Date\(\)\)\)/, 'the phase line is the chip\'s words');
  assert.match(read('travel-widget.js'), /host\.util\.phaseWords\(bands, today\)/, 'and so is the widget\'s');
  assert.match(js, /if \(canEdit && !plan\.phased\(\)\) wrap\.append\(buildEdge\('before'\)\);/, 'days are added before the first only without phases');
  assert.match(js, /if \(plan\.phased\(\)\) \{ attempt\(async \(\) => \{ await plan\.coverDay\(end\);/, 'days after go through cover');
  assert.ok(!read('travel-lib-plan.js').includes('_moved:phases') && !read('travel-lib.js').includes('_moved:phases'), 'the old phases migration is gone');
});

test('the page: the round trip switch, its mark on a card, and the delete question', () => {
  const html = read('travel.html');
  const js = read('travel.js');
  assert.match(html, /<div class="roundtrip" data-types="flight train ferry bus taxi rideshare shuttle">/, 'every journey but a car offers a round trip');
  assert.ok(html.includes('<label class="sdk-choice-row"><input id="f-roundtrip" name="roundtrip" type="checkbox" class="sdk-switch" role="switch"><span>Round trip</span></label>'), 'an on or off setting taken when the form is saved: the switch (fields and forms, Thomas 2026-10-18)');
  for (const id of ['f-return', 'f-back-date', 'f-back-time', 'f-back-hours', 'f-back-minutes', 'f-back-number', 'f-back-from', 'f-back-to', 'f-back-fromCode', 'f-back-toCode']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(html.includes('<template id="tpl-card-roundtrip">'));
  for (const words of ['Delete both legs', 'Delete only this leg', 'Remove the return leg', 'Return is before the outbound']) assert.ok(js.includes(words), words);
  assert.ok(!js.includes("e.target === $('editor')"), 'clicking the dimmed area does not close the editor');
});

// --- the SDK's host.util.plain and host.util.localWhen (public/sdk/host.js; plan-object-handoff.md, step 4) ---------------

test('host.util.plain: Markdown and HTML as plain text, lines kept or made one', () => {
  assert.equal(plain('**Southwest** 2483'), 'Southwest 2483');
  assert.equal(plain('# Flight ##\n- MDW to SJC\n* seat 12A\n1. board\n> a quote'), 'Flight\n- MDW to SJC\n- seat 12A\n1. board\na quote');
  assert.equal(plain('[Manage it](https://southwest.com/x) and ![a map](https://m.example/p.png) and [https://a.example](https://a.example)'), 'Manage it (https://southwest.com/x) and a map and https://a.example');
  assert.equal(plain('*one* _two_ `three` ~~four~~ __five__'), 'one two three four five');
  assert.equal(plain('\\*kept\\* and snake_case_word and 2*3*4 and a < b > c'), '*kept* and snake_case_word and 2*3*4 and a < b > c');
  assert.equal(plain('```\n**raw** in a fence\n```\n---\n|a|b|\n|---|:-:|\n|1|2|'), '**raw** in a fence\na|b\n1|2');
  assert.equal(plain('<p>Hi&nbsp;<b>there</b><br>next &amp; &#8594; &#x41; &bogus; <https://x.example></p><script>alert(1)</script><style>p{}</style>end'), 'Hi there\nnext & → A &bogus; https://x.example\nend');
  assert.equal(plain('<ul><li>one</li><li>two</li></ul>'), '- one\n- two');
  assert.equal(plain('a\n\n\n\n b  \n'), 'a\n\n b');
  assert.equal(plain('**Southwest**\n\n2483\u0007', { line: true }), 'Southwest 2483');
  assert.equal(plain(null), '');
  // An unclosed <script> or <style> loses only its tag, not the words after it; a closed one goes with what it holds.
  assert.equal(plain('a<script>b'), 'ab');
  assert.equal(plain('Use a<script> tag here'), 'Use a tag here');
  assert.equal(plain('x<style>p{}</style>y<script>z'), 'xyz');
  assert.equal(plain(2483), '2483');
});

test('host.util.plain takes linear time on long and crafted text (100 KB each)', () => {
  const crafted = ['*'.repeat(1e5), '_'.repeat(1e5), '['.repeat(1e5), '[a]('.repeat(25000), '!['.repeat(5e4), '<a'.repeat(5e4), '<'.repeat(1e5), '<a>'.repeat(33000), '<script>'.repeat(12500), '**a'.repeat(33000), '`'.repeat(1e5), '~~a'.repeat(33000), '&#'.repeat(5e4), '&amp'.repeat(25000), '#'.repeat(1e5), `# ${' '.repeat(1e5)}x`, `${' '.repeat(1e5)}x`, `x${' '.repeat(1e5)}#x`, `|${' '.repeat(1e5)}x`, `${'- '.repeat(5e4)}x`, '> '.repeat(5e4), '\n'.repeat(1e5), ' \n'.repeat(5e4), '\\*'.repeat(5e4), `${'-|'.repeat(5e4)}x`, 'a_'.repeat(5e4), '*a '.repeat(33000), '[a](b "'.repeat(14000), `${'a'.repeat(1e5)}`];
  plain('warm up **the** [engine](https://x.example)');
  for (const text of crafted) {
    const t = performance.now();
    plain(text);
    plain(text, { line: true });
    const ms = performance.now() - t;
    assert.ok(ms < 1500, `${JSON.stringify(text.slice(0, 10))} took ${Math.round(ms)} ms`);
  }
});

test('host.util.localWhen: a local day and time from a when, the clock as written', () => {
  assert.deepEqual(localWhen('2026-11-14T12:50'), { date: '2026-11-14', time: '12:50' });
  assert.deepEqual(localWhen('2026-11-14T12:50:30Z'), { date: '2026-11-14', time: '12:50' }, 'seconds and the zone dropped, the clock kept');
  assert.deepEqual(localWhen('2026-11-14T12:50+05:30'), { date: '2026-11-14', time: '12:50' });
  assert.deepEqual(localWhen('2026-11-14 3:25 PM'), { date: '2026-11-14', time: '15:25' });
  assert.deepEqual(localWhen('12:05 am'), { date: null, time: '00:05' });
  assert.deepEqual(localWhen('2026-11-14'), { date: '2026-11-14', time: null });
  assert.deepEqual(localWhen('15:25', '2026-11-14'), { date: '2026-11-14', time: '15:25' }, 'a time alone takes the object\'s day');
  assert.deepEqual(localWhen('2026-11-15T09:00', '2026-11-14'), { date: '2026-11-15', time: '09:00' }, 'its own day wins');
  assert.deepEqual(localWhen(undefined, '2026-11-14'), { date: '2026-11-14', time: null }, 'none given: the object\'s day');
  for (const bad of ['2026-02-30', '2026-11-14T25:00', '24:00', '13:00 PM', 'tomorrow', '', 7, null]) assert.equal(localWhen(bad), null, String(bad));
  assert.equal(localWhen('nonsense', '2026-11-14'), null, 'a when that cannot be read is no value');
  assert.equal(localWhen(`${'1'.repeat(1e5)}:00`), null, 'a long text is read only as far as a when can be');
});

test('host.util.markdown: the lines before a list are drawn before it, not after', () => {
  assert.equal(sdkText.markdown('Body\n\nLinks:\n- A: https://a.example\nExternal source'), '<p>Body</p><p>Links:</p><ul><li>A: <a href="https://a.example" target="_blank" rel="noopener">https://a.example</a></li></ul><p>External source</p>');
  assert.equal(sdkText.markdown('- one\n- two'), '<ul><li>one</li><li>two</li></ul>');
  assert.equal(sdkText.markdown('Para\n- a\nAfter'), '<p>Para</p><ul><li>a</li></ul><p>After</p>');
  assert.equal(sdkText.markdown('Pick:\n1. this\n2. that'), '<p>Pick:</p><ol><li>this</li><li>that</li></ol>');});
test('host.util.markdown: an underscore in a link never makes italics', () => {
  const link = (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`;
  assert.equal(sdkText.markdown('See https://en.wikipedia.org/wiki/Belem_Tower'), `<p>See ${link('https://en.wikipedia.org/wiki/Belem_Tower')}</p>`);
  assert.equal(sdkText.markdown('[Belem](https://x.example/Bel%C3%A9m_Tower)'), '<p><a href="https://x.example/Bel%C3%A9m_Tower" target="_blank" rel="noopener">Belem</a></p>');
  const two = sdkText.markdown('https://a.example/a_b and https://b.example/c_d');
  assert.equal(two, `<p>${link('https://a.example/a_b')} and ${link('https://b.example/c_d')}</p>`, 'two links on one line keep their href and target');
  assert.equal(sdkText.markdown('snake_case and a https://a.example/x_y'), `<p>snake_case and a ${link('https://a.example/x_y')}</p>`, 'a word with an underscore stays as written');
  assert.equal(sdkText.markdown('_this_ and *that*'), '<p><em>this</em> and <em>that</em></p>', 'real italics still work');
});

test('host.util.detailLines:details as "Label: value" lines, in the Planner\'s words (plan-object-handoff.md, step 6)', () => {
  const { detailLines } = sdkText;
  assert.deepEqual(detailLines({ cabin: '4B', minutes: 150, departs: '2026-11-14T12:50', from: { code: 'MDW', name: 'Chicago Midway' }, to: { code: 'SJC' }, allDay: true, options: ['Faro', 'Lagos'], guests: 2 }),
    ['Cabin: 4B', 'Length: 2 h 30 min', 'Departs: 2026-11-14 12:50', 'From: Chicago Midway (MDW)', 'To: SJC', 'All day: yes', 'Options: Faro, Lagos', 'People: 2']);
  assert.deepEqual(detailLines({ from: { name: 'Lisbon airport' }, to: 'Faro', departs: '2026-11-14T09:00', arrives: '2026-11-20T10:00' }, { kind: 'car' }), ['Pick up: Lisbon airport', 'Drop off: Faro', 'Pick-up time: 2026-11-14 09:00', 'Drop-off time: 2026-11-20 10:00'], 'a car\'s places and its times');
  assert.deepEqual(detailLines({ due: '2026-11-14T09:00', address: '**Rua** 1' }, { skip: ['due'] }), ['Address: Rua 1'], 'skip, and plain text');
  assert.deepEqual(detailLines({ upload: 'a'.repeat(24), name: 'beach.jpg' }), ['Booking name: beach.jpg'], 'a picture\'s file id is never shown');
  assert.deepEqual(detailLines({ boatName: 'Tejo', minutes: 45 }), ['Boat name: Tejo', 'Length: 45 min'], 'a field it has no word for: its name in words');
  for (const none of [null, undefined, 'x', ['a'], 7]) assert.deepEqual(detailLines(none), [], String(none));
  assert.deepEqual(detailLines({ seat: '', gate: null, '<b>': 'x', number: Infinity }), [], 'empty values and odd names are left out');
  assert.equal(detailLines({ address: 'x'.repeat(1000) })[0].length, 'Address: '.length + 300, 'a line is at most 300 characters of value');
});

// --- an object handed in (plan-object-handoff.md, step 5) ---------------------------------------------------------------

const util = { plain, localWhen };
// Thomas's Southwest flight (#182), as the bus hands it over (cleaned by server/object-format.js's cleanHandoff).
const SOUTHWEST = { kind: 'flight', icon: 'plane', title: 'Southwest **2483**, Chicago to San Jose', content: 'Booked with **points**.\n\n- Wanna Get Away', date: '2026-11-14', basis: 'imported', details: { airline: 'Southwest', number: '2483', from: { code: 'MDW', name: 'Chicago Midway' }, to: { code: 'SJC', name: 'San Jose' }, departs: '2026-11-14T12:50', arrives: '2026-11-14T15:25', minutes: 275, terminal: '1', gate: 'B12', seat: '12A', class: 'Wanna Get Away', reference: 'ABC123' } };

test('fromObject: Thomas\'s Southwest flight fills every flight field, the ticket\'s arrival beside the flight time', () => {
  const f = lib.objectFields(SOUTHWEST, util);
  const item = lib.cleanItem({ ...f, id: 'sw' });
  assert.equal(item.kind, 'journey');
  assert.equal(item.mode, 'flight');
  assert.equal(item.title, 'Southwest 2483, Chicago to San Jose', 'the title is plain text');
  assert.equal(item.operator, 'Southwest');
  assert.equal(item.number, '2483');
  assert.equal(item.fromCode, 'MDW');
  assert.equal(item.from, 'Chicago Midway');
  assert.equal(item.toCode, 'SJC');
  assert.equal(item.to, 'San Jose');
  assert.equal(item.date, '2026-11-14');
  assert.equal(item.time, '12:50');
  assert.equal(item.arrives, '2026-11-14T15:25');
  assert.equal(item.minutes, 275, 'the time in the air, which a ticket\'s two local times cannot give across zones');
  assert.equal(item.terminal, '1');
  assert.equal(item.gate, 'B12');
  assert.equal(item.seat, '12A');
  assert.equal(item.travelClass, 'Wanna Get Away');
  assert.equal(item.confirm, 'ABC123');
  assert.equal(item.notes, 'Booked with **points**.\n\n- Wanna Get Away\n\nExternal source', 'the notes keep their Markdown, which the plan draws');
  assert.deepEqual(lib.arrivalOf(item), { day: '2026-11-14', time: '15:25', days: 0, ticket: true });
  assert.equal(pageHelpers('12').arriveText(item), '3:25 PM', 'shown as on the ticket, not 12:50 plus 4 h 35 min');
  // Without a day: the times stay, the flight is under "Unscheduled".
  const undated = lib.cleanItem({ ...lib.objectFields({ ...SOUTHWEST, date: undefined, details: { ...SOUTHWEST.details, departs: '12:50', arrives: '15:25' } }, util), id: 'u' });
  assert.equal(undated.date, null);
  assert.equal(undated.time, '12:50');
  assert.equal(undated.arrives, '15:25');
  assert.deepEqual(lib.coverDaysOf(undated), [], 'no day of its own: it stretches nothing');
  // A time alone takes the object's own day; a ticket arriving across the date line says so.
  assert.equal(lib.objectFields({ ...SOUTHWEST, details: { departs: '12:50', arrives: '15:25' } }, util).arrives, '2026-11-14T15:25');
  const back = lib.cleanItem({ id: 'b', kind: 'journey', mode: 'flight', title: 'HNL', date: '2026-11-15', time: '01:00', arrives: '2026-11-14T13:00' });
  assert.equal(pageHelpers('12').arriveText(back), '1:00 PM the day before');
  assert.equal(lib.cleanItem({ id: 'c', kind: 'journey', mode: 'car', title: 'Car', arrives: '2026-11-14T15:25' }).arrives, null, 'not for a car');
  assert.equal(lib.cleanItem({ id: 'c', kind: 'journey', mode: 'flight', title: 'F', arrives: '2026-11-14T25:00' }).arrives, null);
});

test('fromObject: each kind\'s details in the plan\'s own fields, and what has no field as a notes line', () => {
  const at = (o) => lib.cleanItem({ ...lib.objectFields(o, util), id: 'x' });
  const train = at({ kind: 'train', title: 'To Porto', details: { operator: 'CP', number: '521', from: { code: 'LIS', name: 'Lisboa Santa Apolonia' }, to: 'Porto Campanha', departs: '2026-10-02T09:00', arrives: '2026-10-02T11:50', platform: '4', carriage: '21', seat: '55', class: 'First', reference: 'CP9' } });
  assert.deepEqual([train.mode, train.operator, train.number, train.from, train.to, train.date, train.time, train.arrives, train.platform, train.carriage, train.seat, train.travelClass, train.confirm], ['train', 'CP', '521', 'Lisboa Santa Apolonia (LIS)', 'Porto Campanha', '2026-10-02', '09:00', '2026-10-02T11:50', '4', '21', '55', 'First', 'CP9']);
  const bus = at({ kind: 'bus', title: 'Bus', details: { operator: 'Rede', number: '7', seat: '3', reference: 'R1', from: 'FAO' } });
  assert.deepEqual([bus.mode, bus.operator, bus.number, bus.seat, bus.confirm, bus.from], ['bus', 'Rede', '7', '3', 'R1', 'FAO']);
  const ferry = at({ kind: 'ferry', title: 'Ferry', content: 'Deck chairs', details: { operator: 'Naxos', cabin: '4B', seat: '9', departs: '2026-10-03T22:00', minutes: 600 } });
  assert.deepEqual([ferry.mode, ferry.seat, ferry.minutes, ferry.notes], ['ferry', '9', 600, 'Deck chairs\n\nCabin: 4B']);
  assert.deepEqual(lib.arrivalOf(ferry), { day: '2026-10-04', time: '08:00', days: 1 });
  const car = at({ kind: 'car', title: 'Car', details: { company: 'Hertz', from: { code: 'FAO', name: 'Faro airport' }, to: 'Lagos', departs: '2026-10-01T10:00', arrives: '2026-10-04T09:30', class: 'Compact', reference: 'H7' } });
  assert.deepEqual([car.mode, car.operator, car.pickup, car.dropoff, car.date, car.time, car.minutes, car.confirm, car.arrives, car.notes], ['car', 'Hertz', 'Faro airport (FAO)', 'Lagos', '2026-10-01', '10:00', 3 * 1440 - 30, 'H7', null, 'Class: Compact']);
  const longCar = at({ kind: 'car', title: 'Car', details: { departs: '2026-10-01T10:00', arrives: '2026-10-20T10:00' } });
  assert.deepEqual([longCar.minutes, longCar.notes], [null, 'Drop off: 2026-10-20 10:00'], 'more than 7 days: a notes line');
  const item = at({ kind: 'hotel', title: 'Seaside **Inn**', details: { address: '1 Beach Rd', checkIn: '2026-10-01T15:00', checkOut: '2026-10-04T11:00', roomType: 'Double', guests: 2, reference: 'B55' } });
  assert.deepEqual([item.kind, item.type, item.title, item.date, item.time, item.checkOut, item.checkOutTime, item.roomType, item.guests, item.address, item.confirm], ['stay', 'hotel', 'Seaside Inn', '2026-10-01', '15:00', '2026-10-04', '11:00', 'Double', 2, '1 Beach Rd', 'B55']);
  const badOut = at({ kind: 'hotel', title: 'Inn', date: '2026-10-05', details: { checkOut: '2026-10-03' } });
  assert.deepEqual([badOut.date, badOut.checkOut, badOut.notes], ['2026-10-05', null, 'Check out: 2026-10-03']);
  const dinner = at({ kind: 'restaurant', title: 'Ramiro', details: { starts: '2026-10-02T20:00', ends: '2026-10-02T22:15', address: 'Av. Almirante Reis', partySize: 4, name: 'Thomas', reference: 'T4' } });
  assert.deepEqual([dinner.kind, dinner.type, dinner.category, dinner.time, dinner.minutes, dinner.address, dinner.partySize, dinner.reservationName, dinner.confirm], ['stop', 'restaurant', 'eat', '20:00', 135, 'Av. Almirante Reis', 4, 'Thomas', 'T4']);
  for (const kind of ['cafe', 'bar']) assert.equal(at({ kind, title: 'x', details: { partySize: 2 } }).partySize, 2, kind);
  for (const kind of ['sight', 'museum', 'attraction', 'tour', 'show']) {
    const visit = at({ kind, title: 'x', details: { starts: '10:00', minutes: 90, tickets: 3, reference: 'V1', address: 'Here' }, date: '2026-10-03' });
    assert.deepEqual([visit.type, visit.category, visit.date, visit.time, visit.minutes, visit.admissionCount, visit.confirm, visit.address], [kind, 'do', '2026-10-03', '10:00', 90, 3, 'V1', 'Here'], kind);
  }
  const allDay = at({ kind: 'event', title: 'Festival', details: { starts: '2026-10-03T10:00', allDay: true, address: 'The square' } });
  assert.deepEqual([allDay.kind, allDay.type, allDay.date, allDay.time, allDay.address, allDay.notes], ['stop', 'other', '2026-10-03', null, 'The square', '']);
  const timed = at({ kind: 'event', title: 'Talk', details: { starts: '2026-10-03T18:00', ends: '2026-10-03T19:30' } });
  assert.deepEqual([timed.time, timed.minutes], ['18:00', 90]);
  const note = at({ kind: 'note', title: 'Pack', content: '- passport\n- **charger**', links: [{ title: 'List', url: 'https://x.example/list' }] });
  assert.deepEqual([note.kind, note.notes], ['note', '- passport\n- **charger**\n\nLinks:\n- List: https://x.example/list']);
  const none = at({ title: 'Something', content: 'words' });
  assert.deepEqual([none.kind, none.type, none.notes], ['stop', null, 'words']);
  assert.throws(() => lib.objectFields({ title: '** **' }, util), /title/);
  // The details win over the object's own date; the Planner's own drop wins over both.
  assert.equal(at({ kind: 'sight', title: 'x', date: '2026-10-01', details: { starts: '2026-10-02T09:00' } }).date, '2026-10-02');
  const dropped = lib.cleanItem({ ...lib.objectFields(SOUTHWEST, util, { date: '2026-11-13' }), id: 'd' });
  assert.deepEqual([dropped.date, dropped.time], ['2026-11-13', '12:50']);
  assert.deepEqual(lib.objectFields(SOUTHWEST, util, { after: '' }).after, '');
});

test('a relative arrival: kept while there is no day, dated on one', () => {
  assert.equal(lib.relativeArrives('2026-11-12', '2026-11-13T06:30'), '06:30+1');
  assert.equal(lib.relativeArrives('2026-11-14', '2026-11-13T13:00'), '13:00-1');
  assert.equal(lib.relativeArrives('2026-11-14', '2026-11-14T15:25'), '15:25');
  assert.equal(lib.datedArrives('2026-11-30', '06:30+1'), '2026-12-01T06:30');
  assert.equal(lib.datedArrives('2026-11-14', '15:25'), '2026-11-14T15:25');
  const kept = lib.cleanItem({ id: 'r', kind: 'journey', mode: 'flight', title: 'R', arrives: '06:30+1' });
  assert.equal(kept.arrives, '06:30+1');
  assert.deepEqual(lib.arrivalOf({ ...kept, time: '23:00' }), { day: null, time: '06:30', days: 1, ticket: true });
  assert.equal(lib.cleanItem({ ...kept, date: '2026-11-30' }).arrives, '2026-12-01T06:30', 'given a day, dated again');
  for (const bad of ['06:30+8', '06:30-2', '06:30+', '25:00', '06:30+1x']) assert.equal(lib.cleanItem({ ...kept, arrives: bad }).arrives, null, bad);
  assert.equal(lib.cleanItem({ ...kept, arrives: '06:30+0' }).arrives, '06:30');
  // The editor: an undated journey's relative arrival is dated on the day picked, and one moved off its days is kept relative
  // in the hidden field (and shown as "The next day" in the list).
  const js = read('travel.js');
  assert.ok(js.includes('arrival.value = datedArrives(day, arrival.value);'));
  assert.ok(js.includes("arrival.value = relativeArrives(was, arrival.value) || '';"));
  assert.ok(js.includes("v.arrives.length === 16 || !v.date ? v.arrives : datedArrives(v.date, v.arrives)"));
});

test('a ticket\'s arrival is at most 7 days after it leaves and at most a day before; else a notes line', () => {
  assert.equal(lib.arrivalFits('2026-11-14', '12:50', '2026-11-21T12:50'), true, 'exactly 7 days');
  assert.equal(lib.arrivalFits('2026-11-14', '12:50', '2026-11-21T12:51'), false);
  assert.equal(lib.arrivalFits('2026-11-14', '12:50', '2026-11-13T12:50'), true, 'a day before, across the date line');
  assert.equal(lib.arrivalFits('2026-11-14', '12:50', '2026-11-13T12:49'), false);
  assert.equal(lib.arrivalFits('2026-11-14', null, '2026-11-21T23:00'), true, 'no departure time: by days');
  assert.equal(lib.arrivalFits('2026-11-14', null, '2026-11-22T00:10'), false);
  assert.equal(lib.arrivalFits(null, null, '2027-11-22T00:10'), true, 'no day to leave on yet');
  const far = lib.cleanItem({ id: 'f', kind: 'journey', mode: 'flight', title: 'F', date: '2026-11-14', time: '12:50', arrives: '2027-01-01T15:25', notes: 'Booked' });
  assert.deepEqual([far.arrives, far.notes], [null, 'Booked\n\nArrives: 2027-01-01 15:25'], 'cleanItem: +46 days is a notes line');
  const before = lib.cleanItem({ id: 'f', kind: 'journey', mode: 'flight', title: 'F', date: '2026-11-14', time: '12:50', arrives: '2026-10-01T15:25' });
  assert.deepEqual([before.arrives, before.notes], [null, 'Arrives: 2026-10-01 15:25'], '-44 days too');
  const again = lib.cleanItem(far);
  assert.equal(again.notes, far.notes, 'cleaning again adds nothing');
  const odd = lib.cleanItem({ ...lib.objectFields({ ...SOUTHWEST, details: { ...SOUTHWEST.details, arrives: '2027-03-01T15:25' } }, util), id: 'o' });
  assert.equal(odd.arrives, null, 'objectFields: +107 days is not the ticket\'s arrival');
  assert.ok(odd.notes.includes('Arrives: 2027-03-01 15:25'));
  assert.deepEqual([...new Set(lib.coverDaysOf(odd))], ['2026-11-14'], 'so it stretches nothing (its flight time lands the same day)');
  const early = lib.objectFields({ kind: 'train', title: 'T', details: { departs: '2026-11-14T09:00', arrives: '2026-11-12T09:00' } }, util);
  assert.equal(early.arrives, undefined);
  assert.ok(early.notes.includes('Arrives: 2026-11-12 09:00'));
  const js = read('travel.js');
  assert.ok(js.includes("if (fields.arrives && !arrivalFits(fields.date, fields.time, fields.arrives)) return fail('The arrival on the ticket can be at most 7 days after it leaves, and at most a day before.');"), 'the editor refuses one');
  assert.ok(js.includes('arrival.value = shiftArrives(arrival.value'), 'and moves it along with the departure day');
});

test('fitsPlan: a day shows when the plan can stretch to it within 60 days', () => {
  const days = lib.tripDays({ start: '2026-11-10', end: '2026-11-14' });
  assert.equal(lib.fitsPlan([], '2027-06-01'), true, 'nothing yet: any day');
  assert.equal(lib.fitsPlan(days, '2026-11-12'), true);
  assert.equal(lib.fitsPlan(days, '2027-01-08'), true, 'the 60th day from the first');
  assert.equal(lib.fitsPlan(days, '2027-01-09'), false);
  assert.equal(lib.fitsPlan(days, '2026-09-16'), true, 'before, inside the 60');
  assert.equal(lib.fitsPlan(days, '2026-09-15'), false, 'before, past them');
  assert.equal(lib.fitsPlan(days, null), true);
});

const handedIn = async () => {
  // A full itinerary, as Keep sends it: 10 objects over 4 days, in no particular order, onto a plan with no dates yet.
  const f = fakeHost();
  const plan = lib.createPlan(f.t);
  await plan.load();
  const heard = [];
  plan.onSaid((text) => heard.push(text));
  plan.provide();
  const itinerary = [
    SOUTHWEST,
    { kind: 'hotel', title: 'Hotel Valencia', details: { checkIn: '2026-11-14T16:00', checkOut: '2026-11-17T11:00', address: '355 Santana Row' } },
    { kind: 'restaurant', title: 'Dinner at Lazy Dog', details: { starts: '2026-11-14T19:30', partySize: 2 } },
    { kind: 'museum', title: 'Tech Interactive', details: { starts: '2026-11-15T10:00', minutes: 180, tickets: 2 } },
    { kind: 'cafe', title: 'Coffee', date: '2026-11-15', details: { starts: '08:30' } },
    { kind: 'tour', title: 'Winchester House', details: { starts: '2026-11-16T13:00' } },
    { kind: 'car', title: 'Rental car', details: { company: 'Hertz', departs: '2026-11-16T09:00', arrives: '2026-11-17T09:00' } },
    { kind: 'show', title: 'Comedy night', details: { starts: '2026-11-16T20:00' } },
    { kind: 'event', title: 'Farmers market', date: '2026-11-15', details: { allDay: true } },
    { kind: 'flight', title: 'Southwest 1170 home', details: { airline: 'Southwest', number: '1170', from: 'SJC', to: 'MDW', departs: '2026-11-17T14:10', arrives: '2026-11-17T20:15' } },
  ];
  for (const object of itinerary) {
    const out = await f.provided.acceptSuggestion({ title: object.title, object });
    assert.ok(out.ref && out.ref.kind === 'plan', object.title);
  }
  assert.deepEqual(plan.days(), ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17']);
  const by = plan.byDay();
  const titles = (day) => by.get(day).map((i) => i.title);
  assert.deepEqual(titles('2026-11-14'), ['Southwest 2483, Chicago to San Jose', 'Hotel Valencia', 'Dinner at Lazy Dog']);
  assert.deepEqual(titles('2026-11-15'), ['Farmers market', 'Coffee', 'Tech Interactive'], 'the all-day one first, then by time');
  assert.deepEqual(titles('2026-11-16'), ['Rental car', 'Winchester House', 'Comedy night']);
  assert.deepEqual(titles('2026-11-17'), ['Southwest 1170 home']);
  assert.equal(by.get(null).length, 0, 'nothing left without a day');
  assert.deepEqual(heard, [], 'nothing to say');
  n += 1;

  // 90 days out: under "Unscheduled", its day in its notes, and the person told (decision 12).
  const far = await f.provided.acceptSuggestion({ title: 'x', object: { kind: 'hotel', title: 'Ski lodge', content: 'Two **nights**', details: { checkIn: '2027-02-12T15:00', checkOut: '2027-02-14T10:00' } } });
  const lodge = plan.list().find((i) => i.title === 'Ski lodge');
  assert.equal(lodge.date, null);
  assert.equal(lodge.after, null);
  assert.equal(lodge.notes.split('\n')[0], 'Dated 2027-02-12, outside the plan');
  assert.ok(lodge.notes.includes('Two **nights**'));
  assert.deepEqual(plan.days(), ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17'], 'the plan did not grow to its check-out');
  // No day and no place on the line is what the page lists under "Unscheduled" (undatedItems in travel.js).
  assert.match(far.data.note, /^Ski lodge is dated 2027-02-12, outside the plan's 60 days, so it is under Unscheduled\.$/);
  assert.deepEqual(heard, [far.data.note]);
  // The older flat fields go the same way.
  await f.provided.acceptSuggestion({ title: 'Far dinner', kind: 'restaurant', date: '2027-03-01' });
  assert.equal(plan.list().find((i) => i.title === 'Far dinner').date, null);
  assert.equal(heard.length, 2);
  // A day inside the 60 still stretches the plan, as adding by hand does.
  await f.provided.acceptSuggestion({ title: 'x', object: { kind: 'sight', title: 'Lick Observatory', date: '2026-11-20' } });
  assert.equal(plan.days().at(-1), '2026-11-20');
  n += 1;

  // With a trip set: the trip stretches to an object's day within 60 days; its check-out past them leaves the stay on its day.
  const g = fakeHost();
  const plan2 = lib.createPlan(g.t);
  await plan2.load();
  await plan2.saveTrip({ title: 'Bay', start: '2026-11-14', end: '2026-11-17' });
  const said2 = [];
  plan2.onSaid((text) => said2.push(text));
  plan2.provide();
  await g.provided.acceptSuggestion({ title: 'x', object: { kind: 'sight', title: 'Early', date: '2026-11-12' } });
  assert.equal(plan2.trip.start, '2026-11-12');
  const long = await g.provided.acceptSuggestion({ title: 'x', object: { kind: 'hotel', title: 'Long stay', details: { checkIn: '2026-11-17T15:00', checkOut: '2027-01-30T10:00' } } });
  const longStay = plan2.list().find((i) => i.title === 'Long stay');
  assert.equal(longStay.date, '2026-11-17', 'on its day');
  assert.deepEqual([longStay.checkOut, longStay.checkOutTime], [null, null], 'its check-out does not stretch the plan');
  assert.ok(longStay.notes.endsWith('Check out: 2027-01-30 10:00'), 'it is kept in its notes');
  assert.equal(long.data.note, "Long stay: its check-out, 2027-01-30, is outside the plan's 60 days, so it is in its notes.");
  assert.equal(plan2.days().length, 6, 'Nov 12 to Nov 17');
  assert.equal(said2.length, 1);
  n += 1;

  // QA: the same with NO trip set, where nothing used to say it and the plan quietly grew to 60 days of "Staying at".
  const h = fakeHost();
  const plan3 = lib.createPlan(h.t);
  await plan3.load();
  const said3 = [];
  plan3.onSaid((text) => said3.push(text));
  plan3.provide();
  await h.provided.acceptSuggestion({ title: 'x', object: { kind: 'sight', title: 'Pier', date: '2026-11-14' } });
  const lodge3 = await h.provided.acceptSuggestion({ title: 'x', object: { kind: 'hotel', title: 'Long stay', details: { checkIn: '2026-11-17T15:00', checkOut: '2027-01-30T10:00' } } });
  assert.equal(plan3.trip, null);
  assert.deepEqual(plan3.days(), ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17'], 'the plan stays small');
  assert.equal(plan3.list().find((i) => i.title === 'Long stay').checkOut, null);
  assert.match(lodge3.data.note, /its check-out, 2027-01-30, is outside the plan's 60 days/);
  assert.deepEqual(said3, [lodge3.data.note], 'and the person is told');
  // A check-out that fits is kept as it is.
  await h.provided.acceptSuggestion({ title: 'x', object: { kind: 'hotel', title: 'Short stay', details: { checkIn: '2026-11-17T15:00', checkOut: '2026-11-19T10:00' } } });
  assert.equal(plan3.list().find((i) => i.title === 'Short stay').checkOut, '2026-11-19');
  assert.equal(said3.length, 1);
  // A ticket's arrival past the 60 days (a long ferry from the plan's last day) is held the same way.
  const boat = await h.provided.acceptSuggestion({ title: 'x', object: { kind: 'ferry', title: 'Long ferry', details: { departs: '2027-01-12T09:00', arrives: '2027-01-15T09:00' } } });
  const ferry3 = plan3.list().find((i) => i.title === 'Long ferry');
  assert.deepEqual([ferry3.date, ferry3.arrives], ['2027-01-12', null]);
  assert.ok(ferry3.notes.endsWith('Arrives: 2027-01-15 09:00'));
  assert.match(boat.data.note, /its arrival, 2027-01-15, is outside the plan's 60 days/);
  assert.equal(plan3.days().at(-1), '2027-01-12');
  n += 1;

  // QA (must-fix): a move takes the ticket's dated arrival along, the same days later or earlier.
  const m = fakeHost();
  const plan4 = lib.createPlan(m.t);
  await plan4.load();
  await plan4.saveTrip({ start: '2026-11-10', end: '2026-11-20' });
  plan4.provide();
  await m.provided.acceptSuggestion({ title: 'x', object: SOUTHWEST });
  const red = await plan4.addItem({ kind: 'journey', mode: 'flight', title: 'Red-eye', date: '2026-11-12', time: '23:00', arrives: '2026-11-13T06:30' });
  const sw = () => plan4.list().find((i) => i.title.startsWith('Southwest'));
  await plan4.moveTo(sw().id, '2026-11-18', 0);
  assert.deepEqual([sw().date, sw().arrives], ['2026-11-18', '2026-11-18T15:25'], 'moveTo, four days later');
  assert.equal(pageHelpers('12').arriveText(sw()), '3:25 PM', 'not "-4 days"');
  await plan4.moveTo(red.id, '2026-11-10', 0);
  const redNow = plan4.list().find((i) => i.id === red.id);
  assert.deepEqual([redNow.date, redNow.arrives], ['2026-11-10', '2026-11-11T06:30'], 'earlier: still the next morning');
  await plan4.nudgeItem(sw().id, -1);
  assert.deepEqual([sw().date, sw().time, sw().arrives], ['2026-11-18', '12:20', '2026-11-18T15:25'], 'earlier in its day: the day stays');
  await plan4.applyChanges({ [sw().id]: { date: '2026-11-17', order: 1 } });
  assert.equal(sw().arrives, '2026-11-17T15:25', 'any change of day, as the drag of an untimed one makes');
  await plan4.updateItem(sw().id, { date: '2026-11-19', arrives: '2026-11-19T16:00' });
  assert.equal(sw().arrives, '2026-11-19T16:00', 'a change that says its own arrival (the editor) keeps it');
  await plan4.moveTo(sw().id, null, 0);
  assert.deepEqual([sw().date, sw().arrives], [null, '16:00'], 'to Unscheduled: kept relative to the day it left');
  // QA: a round trip through the line or "Unscheduled" keeps the arrival's offset from its departure.
  await plan4.moveTo(red.id, '2026-11-12', 0);
  await plan4.moveToJoint(red.id, '', 0);
  const onLine = plan4.list().find((i) => i.id === red.id);
  assert.deepEqual([onLine.date, onLine.arrives], [null, '06:30+1'], 'on the line: the next morning, whatever day it goes back on');
  await plan4.moveTo(red.id, '2026-11-15', 0);
  const back = plan4.list().find((i) => i.id === red.id);
  assert.deepEqual([back.date, back.arrives, back.notes], ['2026-11-15', '2026-11-16T06:30', ''], 'back on a day: dated again, one day after');
  assert.equal(pageHelpers('12').arriveText(back), '6:30 AM the next day', 'not "the day before"');
  await plan4.moveToJoint(red.id, '', 0);
  await plan4.moveTo(red.id, '2026-11-20', 0);
  const later = plan4.list().find((i) => i.id === red.id);
  assert.deepEqual([later.arrives, later.notes], ['2026-11-21T06:30', ''], 'more than 7 days on: no notes line, still the next morning');
  await plan4.moveTo(sw().id, '2026-11-11', 0);
  assert.equal(sw().arrives, '2026-11-11T16:00', 'from Unscheduled, the same');
  assert.equal(lib.objectFields(SOUTHWEST, util, { date: '2026-11-16' }).arrives, '2026-11-16T15:25', 'the Planner\'s own drop onto another day');
  assert.equal(lib.shiftArrives('15:25', 3), '15:25', 'a time alone follows its day already');
  // The Planner's own drop at a joint on the line: relative too.
  assert.equal(lib.objectFields({ kind: 'flight', title: 'Red-eye', details: { departs: '2026-11-12T23:00', arrives: '2026-11-13T06:30' } }, util, { after: '' }).arrives, '06:30+1');
  // Over a far day: under "Unscheduled" with the offset kept.
  const farFlight = await m.provided.acceptSuggestion({ title: 'x', object: { kind: 'flight', title: 'Far red-eye', details: { departs: '2027-06-01T23:00', arrives: '2027-06-02T06:30' } } });
  assert.ok(farFlight.data.note);
  assert.deepEqual(['date', 'arrives'].map((k) => plan4.list().find((i) => i.title === 'Far red-eye')[k]), [null, '06:30+1']);
  n += 1;
};
await handedIn();

test('Unscheduled is the default phase: the first group of the list, and the editor\'s default Phase (Thomas)', () => {
  const js = fs.readFileSync(new URL('../modules/travel/src/travel.js', import.meta.url), 'utf8');
  assert.ok(js.includes("[{ id: null, label: 'Unscheduled' }, ...bands]"), 'the Unscheduled group comes before the phases');
  assert.ok(!/phaseOf\([^)]*today/.test(js), 'the list does not read today\'s phase');
  assert.ok(js.includes("const groups = [{ id: null, label: 'Unscheduled' }, ...bands].map(") && js.includes("if (p.id === null) group.querySelector('h3').hidden = true;"), 'Unscheduled alone: its group heading is hidden (the area already says it); with phases beside it, every group keeps its heading');
  assert.ok(js.includes("[{ id: '', label: 'Unscheduled' }, ...phases]") && js.includes("select.value = item && item.phase && phases.some((p) => p.id === item.phase) ? item.phase : '';"), 'the editor\'s Phase starts on Unscheduled');
});

test('the page: the ticket\'s arrival field, and objects dated outside the plan under Unscheduled', () => {
  const html = read('travel.html');
  const js = read('travel.js');
  assert.ok(html.includes('<div class="sdk-form-row" data-types="flight train ferry bus">\n      <div class="sdk-field sdk-m" role="group" aria-labelledby="f-arrival-day-label"><span class="sdk-label" id="f-arrival-day-label">Arrival day</span><select id="f-arrival-day" name="arrivesDay" hidden></select><input id="f-arrival-day-input" type="date"'), 'the arrival is a day and a time like the departure (#241); f-arrival holds what is stored');
  assert.ok(html.includes('<span class="sdk-label">Seat</span><input id="f-seat"') && html.includes('data-types="flight train ferry bus"><span class="sdk-label">Seat'), 'a bus or ferry seat survives an edit');
  assert.ok(html.includes('data-types="flight train"><span class="sdk-label">Class</span><select id="f-travelClass"'), 'a train class survives an edit');
  assert.ok(js.includes("fields.arrives = get('f-arrival')"));
  assert.ok(js.includes('plan.onSaid((text) => note(text));'));
  assert.ok(js.includes('(!i.date || !shownDays.has(i.date))'), 'one saved before, dated past the plan, shows under Unscheduled');
  const manifest = JSON.parse(fs.readFileSync(new URL('../modules/travel/module.json', import.meta.url), 'utf8'));
  const accept = manifest.actions.provides.find((a) => a.name === 'acceptSuggestion');
  assert.equal(accept.input.object, 'object?', 'older callers still send the flat fields');
  assert.deepEqual(accept.takes.flatMap((e) => e.kinds).sort(), ['attraction', 'bar', 'bus', 'cafe', 'car', 'event', 'ferry', 'flight', 'hotel', 'museum', 'note', 'restaurant', 'show', 'sight', 'tour', 'train']);
});


// --- the flight lookup (plan-flight-lookup.md, steps 6 to 8) -------------------------------------------------------------

test('the flight lookup: a number cleans as the server cleans it', () => {
  for (const [raw, want] of [['wn 2483', 'WN 2483'], ['WN2483', 'WN 2483'], ['U2 8123', 'U2 8123'], ['ba117', 'BA 117'], ['AAL 100A', 'AAL 100A']]) assert.equal(lib.flightNumberOf(raw), want, raw);
  for (const raw of ['2483', 'Southwest 2483', 'WN 24835', '22 100', '', 'x'.repeat(41)]) assert.equal(lib.flightNumberOf(raw), null, raw);
  assert.equal(lib.flightNumberOf(null), null);
});

test('the flight lookup: a saved flight sends its schedule part and nothing else', () => {
  const saved = lib.cleanItem({ ...lib.objectFields(SOUTHWEST, util), id: 'sw', number: 'wn2483', title: 'Ana and Ben fly to San Jose', notes: 'Ana pays', cost: 312, paidBy: 'ana', owners: ['ana', 'ben'] });
  const o = lib.flightObject(saved);
  assert.deepEqual(o, { kind: 'flight', title: 'Flight WN 2483', date: '2026-11-14', details: { number: 'WN 2483', airline: 'Southwest', from: { code: 'MDW' }, to: { code: 'SJC' }, departs: '2026-11-14T12:50', arrives: '2026-11-14T15:25', minutes: 275, terminal: '1' } });
  const sent = JSON.stringify(o);
  for (const never of ['12A', 'B12', 'ABC123', 'Wanna Get Away', 'Ana', 'ana', '312', 'points', 'Chicago Midway', 'San Jose']) assert.equal(sent.includes(never), false, `${never} is not sent`);
  // Not a flight, or no number that cleans: nothing to send.
  assert.equal(lib.flightObject({ ...saved, mode: 'train' }), null);
  assert.equal(lib.flightObject({ ...saved, number: '2483' }), null);
  assert.equal(lib.flightObject(lib.cleanItem({ id: 's', kind: 'stop', title: 'Museum' })), null);
  // Without a day it has no departure to send (the server keeps nothing then).
  assert.equal(lib.flightObject({ ...saved, date: null }).details.departs, undefined);
});

test('the flight lookup: a found flight fills the schedule fields only', () => {
  // As the server answers a lookup of WN 2483 on a later week (plan-flight-lookup.md, "The server").
  const found = { kind: 'flight', title: 'Flight to San Jose', date: '2026-11-21', details: { airline: 'Southwest Airlines', number: 'WN 2483', from: { code: 'MDW', name: 'Chicago Midway' }, to: { code: 'SJC', name: 'San Jose' }, departs: '2026-11-21T12:50', arrives: '2026-11-21T15:25', minutes: 275, terminal: '1' } };
  const got = lib.lookupFill(lib.objectFields(found, util));
  assert.deepEqual(got, { date: '2026-11-21', time: '12:50', minutes: 275, arrives: '2026-11-21T15:25', operator: 'Southwest Airlines', number: 'WN 2483', fromCode: 'MDW', from: 'Chicago Midway', toCode: 'SJC', to: 'San Jose', terminal: '1' });
  for (const never of ['title', 'seat', 'travelClass', 'confirm', 'cost', 'paidBy', 'owners', 'notes', 'gate']) assert.equal(never in got, false, `${never} is not filled`);
  // A schedule with no terminal or airline leaves the form's own.
  const bare = lib.lookupFill(lib.objectFields({ ...found, details: { ...found.details, terminal: undefined, airline: undefined } }, util));
  assert.equal('terminal' in bare, false);
  assert.equal('operator' in bare, false);
  // Overnight: the ticket's arrival lands the next day.
  const late = lib.lookupFill(lib.objectFields({ ...found, details: { ...found.details, departs: '2026-11-21T23:10', arrives: '2026-11-22T06:05' } }, util));
  assert.equal(late.arrives, '2026-11-22T06:05');
});

test('the page: the lookup rows, their words, and remembering on Save', () => {
  const html = read('travel.html');
  const js = read('travel.js');
  for (const pre of ['f-', 'f-back-']) {
    for (const part of ['lookup', 'lookup-number', 'lookup-date', 'lookup-find', 'lookup-msg', 'lookup-list']) assert.ok(html.includes(`id="${pre}${part}"`), `${pre}${part}`);
    assert.ok(html.includes(pre === 'f-' ? '<fieldset class="sdk-section lookup" id="f-lookup" data-types="flight" aria-labelledby="f-lookup-title" hidden>' : '<div class="sdk-section lookup" id="f-back-lookup" data-types="flight" role="group" aria-label="Look up the return flight" hidden>'), `${pre}lookup is a flight's only, a section of the form (the return one under the Return heading), hidden until offered`);
    assert.ok(html.includes(`<p class="sdk-hint lookup-msg" id="${pre}lookup-msg" role="status" aria-live="polite"></p>`), 'its message is read out');
    assert.ok(html.includes(`id="${pre}lookup-find" title="Find the flight" aria-label="Find the flight">Find</button>`) && html.includes('class="sdk-btn" type="button" id="f-lookup-find"') && html.includes(`<input id="${pre}lookup-date" type="date"`), 'Find is a button in the number\'s field, the day a date field');
  }
  assert.ok(html.indexOf('id="f-lookup"') > html.indexOf('id="tpl-editor2"') && html.indexOf('id="f-lookup"') < html.indexOf('id="f-title"', html.indexOf('id="tpl-editor2"')), 'the row is at the top of the flight form');
  assert.ok(html.indexOf('id="f-back-lookup"') > html.indexOf('id="f-return"'), 'the return leg has its own row');
  assert.ok(html.includes('placeholder="WN 2483"') && html.includes('>Flight number<') && html.includes('>Day it leaves<') && html.includes('aria-label="Find the flight"'));
  assert.ok(html.includes('id="tpl-lookup-choice"'));
  for (const words of ['Enter the airline code and number, like WN 2483.', 'Choose the day it leaves.', 'saved here yet. Fill it in, and it will be suggested next time.', "Flight lookup isn't working right now. Fill it in by hand.", 'Filled in from a flight saved here before. Check it against your booking.', 'Which one?', 'flies on this day of the week', 'last seen ']) assert.ok(html.includes(words) || js.includes(words), words);
  assert.ok(js.includes('rememberFlights(fields, back);'), 'Save remembers both legs');
  assert.ok(js.includes("host.lookup.available('flight')"), 'the row follows the setting');
  assert.ok(js.includes('host.lookup.airport(code)'), 'a typed code fills its name');
  const css = read('travel-lib-editor.css');
  assert.ok(!css.includes('.lookup.on-type') && !/\.lookup-row|\.editor-card/.test(css), 'the row is a form section (the SDK draws it); the module sets no box for it');
  assert.equal(/#[0-9a-f]{3,8}\b|rgb\(/i.test(css.slice(css.indexOf('/* the flight lookup'))), false, 'its colours are the theme\'s');
});

test('the flight lookup (QA M9): only what the server keeps is sent, and the comment says so', () => {
  const o = lib.flightObject(lib.cleanItem({ id: 'k', kind: 'journey', mode: 'flight', title: 'Home', date: '2026-11-14', time: '07:00', number: 'WN 2484', fromCode: 'sjc', toCode: 'MDW', from: 'My airport', to: 'Midway, near home', operator: 'Southwest' }));
  assert.deepEqual(o.details.from, { code: 'SJC' });
  assert.deepEqual(o.details.to, { code: 'MDW' });
  assert.equal(JSON.stringify(o).includes('near home'), false, 'typed airport names stay on the page');
  assert.equal(o.details.airline, 'Southwest', 'the airline as typed is kept by the server, so it is sent');
  assert.equal(read('travel-lib-object.js').includes('Nothing else leaves the page'), false);
});

test('the flight lookup (QA M6): a flight number is saved cleaned, anything else as typed', () => {
  assert.equal(lib.numberToSave('flight', 'wn 2483'), 'WN 2483');
  assert.equal(lib.numberToSave('flight', 'ba117'), 'BA 117');
  assert.equal(lib.numberToSave('flight', 'Southwest 2483'), 'Southwest 2483', 'one that does not clean is kept as typed');
  assert.equal(lib.numberToSave('flight', ''), '');
  assert.equal(lib.numberToSave('train', 'ice 123'), 'ice 123', 'a train keeps its number as typed');
  const js = read('travel.js');
  assert.ok(js.includes('fields.number = numberToSave(fields.mode, fields.number);'), 'the outbound');
  assert.ok(js.includes("number: numberToSave(out.mode, get('f-back-number')),"), 'the return');
});

test('the flight lookup (QA M5): a second lookup replaces what the first filled, and never what the person typed', () => {
  const first = { date: '2026-11-14', time: '12:50', minutes: 275, arrives: '2026-11-14T15:25', operator: 'Southwest Airlines', number: 'WN 2483', fromCode: 'MDW', from: 'Chicago Midway', toCode: 'SJC', to: 'San Jose', terminal: '1', title: 'Flight to San Jose' };
  const a = lib.lookupApply(first, {}, { title: '', terminal: '', number: 'wn2483' });
  assert.deepEqual(a.set, first, 'the first fills everything, the empty title too');
  assert.deepEqual(a.filled, first);
  // The second answer has no terminal and another title: the lookup's own terminal is emptied and its title replaced.
  const second = { ...first, number: 'WN 1999', toCode: 'OAK', to: 'Oakland', title: 'Flight to Oakland' };
  delete second.terminal;
  const b = lib.lookupApply(second, a.filled, { ...first });
  assert.equal(b.set.title, 'Flight to Oakland');
  assert.equal(b.set.terminal, '');
  assert.equal('terminal' in b.filled, false);
  assert.equal(b.filled.toCode, 'OAK');
  // The person typed over the title and the terminal after the first lookup: both are left as they are.
  const c = lib.lookupApply(second, a.filled, { ...first, title: 'Ana flies home', terminal: 'B' });
  assert.equal('title' in c.set, false, 'a typed title is kept');
  assert.equal('terminal' in c.set, false, 'a typed terminal is kept');
  assert.equal('title' in c.filled, false);
  // A title typed before any lookup is never replaced.
  assert.equal('title' in lib.lookupApply(first, {}, { title: 'Our flight' }).set, false);
  // A lookup with no title to offer (the return leg) leaves the earlier one's.
  const { title, ...noTitle } = second;
  assert.equal('title' in lib.lookupApply(noTitle, {}, { title: 'Flight to San Jose' }).set, false);
  const js = read('travel.js');
  assert.ok(js.includes('const { set, filled } = lookupApply(got, ed.lookupFilled[leg], now);'));
});

test('the form standard (the Planner pilot): the forms are .sdk-form, every day is the SDK date picker with a list, the module sets only layout', () => {
  const html = read('travel.html');
  const js = read('travel.js');
  const css = read('travel.css') + read('travel-lib-editor.css');
  for (const id of ['form', 'day-form']) assert.ok(html.includes(`<form class="sdk-form" id="${id}">`), `${id} is a form of the standard`);
  for (const old of ['editor-card', 'editor-row', 'editor-buttons', 'editor-people', 'when-pick', 'when-btns', 'when-list', 'when-clear', 'when-phase', 'class="timing', 'class="pairing', 'fieldgroup', 'lenmode', 'dur-head', 'class="hm"', 'endbox', 'class="fl"', 'class="check"']) assert.ok(!html.includes(old), `the old ${old} is gone from the markup`);
  assert.equal((html.match(/<div class="sdk-editor-actions">/g) || []).length, 3, 'the item, plan and day forms\' button rows stick to the bottom');
  // Every day is a date field with host.ui.datePicker: the list (days by phase, the spots between days) and, where there is no day, its first entry.
  for (const pre of ['f-', 'f-back-']) {
    assert.match(html, new RegExp(`<select id="${pre}arrival-day" name="[a-zA-Z]+" hidden></select><input id="${pre}arrival-day-input" type="date"[^>]*><span class="sdk-hint" id="${pre}arrival-day-phase" role="status"></span>`), 'the arrival day: the hidden select keeps the value, a date field, its hint slot says the weekday and "Same day" or "The next day"');
  }
  for (const id of ['f-date', 'f-back-date', 'f-checkout']) assert.ok(html.includes(`<select id="${id}"`) && html.includes(`<input id="${id}-input" type="date"`) && html.includes(`id="${id}-phase" role="status"`), `${id} keeps its select for the value, with a date field and a hint slot`);
  assert.ok(!/id="f-(back-)?(date|arrival-day|checkout)-(list|clear)"/.test(html), 'no Pick from the list or Unscheduled button of the module\'s own: the picker draws the list button, and Unscheduled is its first entry and its Clear');
  assert.ok(js.includes("arrivalField($('f-arrival-day'));") && js.includes("arrivalField($('f-back-arrival-day'));"), 'both legs\' arrival days are wired when the form opens');
  assert.ok(js.includes('input.min = d[0]') && js.includes('input.max = d[d.length - 1]'), 'the date field is held to the days a ticket can arrive on (arrivalDays)');
  assert.equal((js.match(/host\.ui\.datePicker\(input,/g) || []).length, 3, 'the departure, check-out and arrival days and the look-up\'s day all use the SDK date picker');
  assert.ok(js.includes("get none() { return canNone() ? (checkout ? 'Not set' : 'Unscheduled') : ''; }") && js.includes('get clearable() { return canNone(); }'), 'Unscheduled (Not set for a check-out) is the list\'s first entry and the picker\'s Clear, only where there is a no-day value');
  assert.ok(js.includes("host.ui.datePicker($('f-start'), { clearable: true })") && js.includes('dayPicker = host.ui.datePicker($(\'day-to\'))'), 'the plan\'s dates and the day dialog use it too');
  // The module draws no field: no height, border, background, font or radius on anything in a form.
  assert.ok(!/--field-h|--label-h|\.editor-card|\.timing|\.when-|\.lenmode|\.lm\b|\.mode \{/.test(css), 'no field rules of the module\'s own');
  assert.ok(!/min-height: 30px/.test(css), 'no row of fields has its own height any more');
  assert.match(css, /@container \(max-width: 439px\) \{\s*#f-length-field, #f-back-length-field \{ grid-column: span 1; \}/, 'on the phone sheet the flight time shares a line with the time');
  for (const id of ['f-date-label', 'f-checkout-label', 'f-back-date-label', 'f-time-label', 'f-back-time-label']) assert.ok(html.includes(`class="sdk-label" id="${id}"`), `${id} is a label of the standard`);
  assert.ok(html.includes('<input id="f-lookup-date" type="date" aria-labelledby="f-lookup-date-label">'), 'the lookup\'s day is a field like the rest');
  // No Length | End time switch: a start and an end time, the length under the end; a flight keeps its flight time.
  assert.ok(!html.includes('data-lenmode') && !js.includes("querySelector('.lm')") && !js.includes("closest('.lm')"), 'the Length | End time switch is gone');
  assert.ok(html.includes('id="f-end-field" data-types="block car taxi rideshare shuttle restaurant cafe bar sight museum attraction tour show"') && html.includes('id="f-length-field" role="group" aria-labelledby="f-minutes-label" data-types="block flight'), 'an end time for a stop, a car, a ride or a marker; the flight time field stays for the length');
  assert.ok(js.includes('len.hidden = !tick || none;') && js.includes('end.hidden = tick || none;'), 'a flight, train, ferry or bus keeps its flight time and its ticket\'s arrival; the others show the end');
  assert.ok(js.includes("[lengthText(len), laterNote(e ? e.days : 0)].filter(Boolean).join(' · ')"), 'the length is said under the end time');
  // The time column reads from, to, (length): the end on its own line with an arrow, the length last in brackets.
  assert.ok(js.includes("sub = [endText(item).replace(/^– /, '→ '), item.minutes ? `(${lengthText(item.minutes)})` : ''].filter(Boolean).join('\\n')"), 'a stop\'s time column reads from, to, (length)');
  // Money is the amount with the currency as its unit; Paid by and Whose is it are chips.
  assert.ok(html.includes('<span class="sdk-group sdk-money"><input id="f-estimate" name="estimate" type="text" inputmode="decimal"') && html.includes('<span class="sdk-unit" data-slot="currency">'), 'the amounts are text with the currency as their unit');
  assert.ok(html.includes('<div class="sdk-people" id="f-paidBy">') && html.includes('<div class="sdk-people" id="f-owners">'), 'Paid by and Whose is it are people chips');
  assert.ok(html.includes('<span class="mf-switch" id="f-travelMode" role="radiogroup" aria-labelledby="f-travelMode-label">'), 'the ways to get there are the segmented switch, a radio group named by its label');
  assert.equal((html.match(/<button class="mf-switch-btn mode" type="button" role="radio" aria-checked="false" tabindex="-?[01]" data-mode="[a-z]+" aria-label="[A-Za-z ]+" data-tip="[A-Za-z ]+"><span class="ic" data-icon="[a-z-]+" aria-hidden="true"><\/span><\/button>/g) || []).length, 6, 'six ways, each a radio with its word as its name and tooltip');
  assert.ok(!/sdk-tabs-joined/.test(html + js), 'the old joined switch is gone');
  assert.ok(js.includes("const setModeOn = (b, on) => { b.setAttribute('aria-checked', String(on)); };") && (js.match(/roveModes\(\);/g) || []).length >= 2, 'the chosen way is checked and is the one Tab stop');
  assert.ok(js.includes("fieldError('f-title', 'Give it a title.')") && html.includes('<span class="sdk-error" id="f-title-error"></span>'), 'a missing title is said under the field');
});

test('the flight lookup (QA S2): the return leg has its own arrival on the ticket, stored as the outbound\'s', () => {
  const html = read('travel.html');
  const js = read('travel.js');
  assert.ok(html.includes('<div class="sdk-field sdk-m" role="group" aria-labelledby="f-back-arrival-day-label"><span class="sdk-label" id="f-back-arrival-day-label">Arrival day</span><select id="f-back-arrival-day" name="backArrivesDay" hidden></select>'));
  assert.match(html, /<input id="f-back-arrival-time" name="backArrivesTime" type="time"><span class="sdk-hint"><\/span><\/label>\s*<input id="f-back-arrival" name="backArrives" type="hidden">\s*<\/div>/);
  assert.ok(html.indexOf('id="f-back-arrival"') > html.indexOf('id="f-return"'), 'inside the return leg');
  assert.ok(js.includes("arrives: get('f-back-arrival') || null,"), 'stored as arrives, as the outbound\'s');
  assert.ok(js.includes("if (back && back.arrives && !arrivalFits(back.date, back.time, back.arrives)) return fail(\"The return's arrival on the ticket can be at most 7 days after it leaves, and at most a day before.\");"), 'the same 7-day and 1-day limit');
  assert.ok(js.includes("arrival: 'f-back-arrival', arrivalDay: 'f-back-arrival-day', arrivalTime: 'f-back-arrival-time', was: 'backDayWas'"), 'the lookup fills it, and it follows the return\'s day');
  assert.ok(js.includes("e.target.id === 'f-back-date' ? 'back'"), 'a change of the return\'s day moves it');
  // WN 2484 as the lookup answers it: SJC 07:00 to MDW 13:05 local, 245 minutes in the air. The return keeps the ticket's arrival.
  const found = { kind: 'flight', title: 'Flight to Chicago', date: '2026-11-21', details: { airline: 'Southwest Airlines', number: 'WN 2484', from: { code: 'SJC', name: 'San Jose' }, to: { code: 'MDW', name: 'Chicago Midway' }, departs: '2026-11-21T07:00', arrives: '2026-11-21T13:05', minutes: 245 } };
  const got = lib.lookupFill(lib.objectFields(found, util));
  assert.equal(got.arrives, '2026-11-21T13:05');
  const out = lib.cleanItem({ id: 'o', kind: 'journey', mode: 'flight', title: 'Flight to San Jose', date: '2026-11-14', time: '12:50', minutes: 275, arrives: '2026-11-14T15:25' });
  const back = lib.cleanItem({ id: 'r', kind: 'journey', mode: 'flight', title: 'Flight to Chicago', legOf: 'o', date: got.date, time: got.time, minutes: got.minutes, arrives: got.arrives, number: got.number, fromCode: got.fromCode, toCode: got.toCode });
  assert.equal(back.arrives, '2026-11-21T13:05', 'a return keeps its arrival as the outbound does');
  assert.equal(back.legOf, 'o');
  assert.deepEqual(lib.arrivalOf(back), { day: '2026-11-21', time: '13:05', days: 0, ticket: true }, 'its card shows 13:05, not 07:00 plus the flight time');
  assert.ok(out.arrives);
  // The same limit as the outbound: 8 days after is too late, a day before (across the date line) is fine.
  assert.equal(lib.arrivalFits('2026-11-21', '07:00', '2026-11-29T13:05'), false);
  assert.equal(lib.arrivalFits('2026-11-21', '07:00', '2026-11-20T13:05'), true);
  // An older return, saved before it had the field, still cleans the same.
  assert.equal(lib.cleanItem({ id: 'r', kind: 'journey', mode: 'flight', title: 'Flight to Chicago', legOf: 'o', date: '2026-11-21', time: '07:00', minutes: 245 }).arrives, null);
});

test('the flight lookup (QA M7): a four-letter ICAO code is looked up and shows as its IATA code', () => {
  const js = read('travel.js');
  assert.ok(js.includes('const icao = /^[A-Z0-9]{4}$/.test(code);'));
  assert.ok(js.includes('if (icao && /^[A-Z]{3}$/.test(airport.code || \'\')) codeInput.value = airport.code;'));
});

// The editor window (plan-editor-window.md, step 8): the form opens through host.ui.editor, large for an item and medium for the
// plan, asks "Discard your changes?" from Cancel as from Escape and Close, and the module keeps no overlay or Escape handler of its own.
test('the editor window: the form is the SDK\'s dialog, sized to what it edits, and Cancel asks as Close does', () => {
  const html = read('travel.html');
  const js = read('travel.js');
  const css = read('travel.css');
  assert.ok(html.includes('<dialog id="editor" class="sdk-editor"></dialog>'), 'the editor is the SDK\'s dialog, filled on each open');
  assert.equal((html.match(/<div class="sdk-editor-actions">/g) || []).length, 3, 'the item, plan and day forms\' button rows stick to the bottom');
  assert.ok(js.includes("const editor = host.ui.editor($('editor'), {") && js.includes("size: 'large',"), 'opened through host.ui.editor, large');
  assert.ok(js.includes("$('editor').classList.toggle('sdk-editor-large', mode !== 'trip');"), 'the plan\'s own form is medium');
  assert.ok(js.includes('isDirty: editorDirty,') && /editor\.open\(\{ focus: [^\n]*kindField\.input : \$\('f-title'\), returnTo: editorReturn \}\);/.test(js), 'the question after typing; focus starts in the kind field for a new object, else the title, and goes back on close');
  assert.ok(js.includes("if (b.id === 'f-cancel') return cancelEditor();"), 'Cancel asks as Close does');
  assert.equal(js.includes("$('editor').hidden"), false, 'nothing reads the old hidden flag');
  assert.equal(/\.editor\s*\{[^}]*position:\s*absolute/.test(css), false, 'no overlay of the module\'s own');
});

// --- the Planner's forms (#241, #242, #245, #246) ---------------------------------------------------------------------

test('a flight\'s arrival is a day and a time (#241), the same day as the departure until one is chosen (#242)', () => {
  // The days offered: the departure day first, then up to 7 days after, then the day before; as offsets with no day.
  assert.deepEqual(lib.arrivalDays('2026-10-03').map((d) => d.value), ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-02']);
  assert.deepEqual(lib.arrivalDays(null).map((d) => d.value), ['0', '1', '2', '3', '4', '5', '6', '7', '-1']);
  assert.deepEqual(lib.arrivalDays('2026-10-03').map((d) => d.n), [0, 1, 2, 3, 4, 5, 6, 7, -1]);
  // Nothing stored: the departure day (or the same day) and no time; the day follows the departure.
  assert.deepEqual(lib.arrivalParts('2026-10-03', ''), { day: '2026-10-03', time: '' });
  assert.deepEqual(lib.arrivalParts('2026-10-04', null), { day: '2026-10-04', time: '' });
  assert.deepEqual(lib.arrivalParts(null, ''), { day: '0', time: '' });
  // A dated arrival shows its own day; a relative one its day from the departure, or the offset with no day.
  assert.deepEqual(lib.arrivalParts('2026-10-03', '2026-10-04T06:30'), { day: '2026-10-04', time: '06:30' });
  assert.deepEqual(lib.arrivalParts('2026-10-03', '06:30+1'), { day: '2026-10-04', time: '06:30' });
  assert.deepEqual(lib.arrivalParts(null, '06:30+1'), { day: '1', time: '06:30' });
  assert.deepEqual(lib.arrivalParts(null, '23:10-1'), { day: '-1', time: '23:10' });
  assert.deepEqual(lib.arrivalParts(null, '15:25'), { day: '0', time: '15:25' });
  // Back to what is stored: a day and a time, or an offset and a time; no time is no arrival.
  assert.equal(lib.arrivalJoin('2026-10-04', '06:30'), '2026-10-04T06:30');
  assert.equal(lib.arrivalJoin('2026-10-04', ''), '');
  assert.equal(lib.arrivalJoin('0', '15:25'), '15:25');
  assert.equal(lib.arrivalJoin('1', '06:30'), '06:30+1');
  assert.equal(lib.arrivalJoin('-1', '23:10'), '23:10-1');
  assert.equal(lib.arrivalJoin('9', '06:30'), '', 'past the limit is nothing');
  assert.equal(lib.arrivalJoin('x', '06:30'), '');
  for (const d of lib.arrivalDays('2026-10-03')) assert.equal(lib.arrivalJoin(d.value, '12:00'), `${d.value}T12:00`);
  for (const d of lib.arrivalDays(null)) assert.equal(lib.arrivalParts(null, lib.arrivalJoin(d.value, '12:00')).day, d.value, `offset ${d.value} round-trips`);
  // Every day offered fits the ticket's limit, once the departure day is known.
  for (const d of lib.arrivalDays('2026-10-03')) assert.ok(lib.arrivalFits('2026-10-03', null, `${d.value}T12:00`), d.value);
  // The page: the two fields feed the hidden one, both legs, and a change of day rebuilds the list.
  const js = read('travel.js');
  assert.ok(js.includes("if (['f-arrival-day', 'f-arrival-time'].includes(e.target.id)) arrivalFieldsInto('out');"));
  assert.ok(js.includes("if (['f-back-arrival-day', 'f-back-arrival-time'].includes(e.target.id)) arrivalFieldsInto('back');"));
  assert.ok(js.includes("arrivalDay: 'f-arrival-day', arrivalTime: 'f-arrival-time'"));
  assert.ok(js.includes('arrivalFieldsFrom(leg);\n        showArrival();'), 'a change of the departure day redraws the arrival around it');
  assert.ok(!js.includes('arrivesKept') && !js.includes('datetime-local'), 'no arrival is kept aside any more: the hidden field holds the relative one');
  const html = read('travel.html');
  assert.ok(html.indexOf('id="f-arrival-day"') < html.indexOf('id="f-arrival-time"') && html.indexOf('id="f-time"') < html.indexOf('id="f-arrival-day"'), 'day then time, as the departure row');
});

test('a day that follows another until one is chosen: the arrival day and the check-out (#242, #245)', () => {
  assert.equal(lib.followDay('2026-10-03', undefined, 0), '2026-10-03', 'a flight arrives the day it leaves');
  assert.equal(lib.followDay('2026-10-03', null, 1), '2026-10-04', 'a stay checks out the day after');
  assert.equal(lib.followDay('2026-10-05', undefined, 1), '2026-10-06', 'and follows the check-in');
  assert.equal(lib.followDay('2026-10-03', '2026-10-07', 1), '2026-10-07', 'a chosen day is never written over');
  assert.equal(lib.followDay('2026-10-09', '2026-10-07', 1), '2026-10-07', 'not when the check-in moves either');
  assert.equal(lib.followDay('2026-10-03', '', 1), '', 'a chosen "none" stays none');
  assert.equal(lib.followDay(null, undefined, 1), '', 'nothing to follow');
  assert.equal(lib.followDay(null, '2026-10-07', 1), '2026-10-07');
  // The check-out days: the day after check-in and on, as many as a plan can be long; none without a check-in.
  const days = lib.checkoutDays('2026-10-03');
  assert.equal(days.length, 60);
  assert.deepEqual(days[0], { value: '2026-10-04', n: 1 });
  assert.deepEqual(days[59], { value: '2026-12-02', n: 60 });
  assert.deepEqual(lib.checkoutDays(null), []);
  assert.deepEqual(lib.checkoutDays(''), []);
  // The page: the check-out follows the check-in day until the person picks one; a pick (an empty one too) is kept.
  const js = read('travel.js');
  assert.ok(js.includes("setVal('f-checkout', followDay(date, car && ed.checkOut === undefined ? '' : ed.checkOut, 1));"));
  assert.ok(js.includes("if (e.target.id === 'f-checkout' && state.editing) state.editing.checkOut = e.target.value;"));
  assert.ok(js.includes("if (e.target.id === 'f-date') checkoutOptions();"));
  assert.ok(js.includes("checkOut: item && (item.kind === 'stay' || item.mode === 'car') ? item.checkOut || '' : undefined"), 'an existing stay keeps its own check-out, or its none');
  assert.ok(!js.includes('checkoutMin'), 'the old min on a date input is gone');
  assert.ok(js.includes("`${dayShort(value)} · ${n} night${n === 1 ? '' : 's'}`"), 'each day says how many nights');
});

test('Attraction is a kind of stop beside Sight, Museum, Tour and Show (#246), and stored kinds keep working', () => {
  assert.ok(lib.STOP_TYPES.includes('attraction') && lib.STOP_TILES.includes('attraction') && lib.TILES.includes('attraction'));
  assert.deepEqual(lib.STOP_TILES, ['restaurant', 'cafe', 'bar', 'sight', 'museum', 'attraction', 'tour', 'show']);
  const it = (o) => lib.cleanItem({ id: 'x', title: 't', ...o });
  assert.equal(it({ kind: 'stop', type: 'attraction' }).type, 'attraction');
  assert.equal(lib.tileOf(it({ kind: 'stop', type: 'attraction' })), 'attraction');
  assert.deepEqual(lib.fromTile('attraction'), { kind: 'stop', type: 'attraction', category: 'do' });
  const c = lib.cardOf(it({ kind: 'stop', type: 'attraction' }));
  assert.deepEqual(c, { template: 'activity', family: 'attraction', kicker: 'Attraction', badge: 'wand-magic-sparkles' });
  assert.equal(typeof lib.TURNS.attraction, 'number');
  assert.ok(Object.values(lib.TURNS).filter((t) => t === lib.TURNS.attraction).length === 1, 'a colour family of its own');
  assert.match(read('travel-lib-cards.css'), /\.entry\[data-type="attraction"\] \{ --turn: 240; \}/);
  // The kinds before it are as they were, so what is stored still reads the same.
  for (const t of ['sight', 'museum', 'tour', 'show']) {
    assert.equal(lib.tileOf(it({ kind: 'stop', type: t })), t);
    assert.equal(lib.cardOf(it({ kind: 'stop', type: t })).kicker, lib.KICKERS[t]);
  }
  assert.equal(lib.cardOf(it({ kind: 'stop', type: 'show' })).template, 'show');
  // The page: in the kind picker's See and do group, the day's add menu (STOP_TILES), a placeholder, words to find it by, and
  // every field a sight has.
  const js = read('travel.js');
  const html = read('travel.html');
  assert.ok(js.includes("{ label: 'See and do', options: ['sight', 'museum', 'attraction', 'tour', 'show'].map((t) => kindOption(t)) },"));
  assert.ok(js.includes("category('see', 'See and do', 'binoculars', STOP_TILES.filter((t) => !EAT.includes(t)));") && js.includes("/^[aeiou]/i.test(KICKERS[t]) ? 'an' : 'a'"), 'the day menu offers "Add an attraction", under See and do');
  // The day menu's categories (Thomas, 2026-10-13), in order, each a flyout of host.menu.show (`items`).
  // One builder (addKinds) feeds the day menu and the titlebar "+"; the day menu adds the markers after it.
  const addMenu = js.slice(js.indexOf('function addKinds('), js.indexOf('function buildEdge('));
  const order = ["category('travel', 'Travel'", "id: 'hotel', label: 'Add a stay'", "category('eat', 'Eat and drink'", "category('see', 'See and do'", "id: 'note', label: 'Add a note'", "category('mark', 'Mark the day'", "onLine ? 'Add between days' : 'Add at a time'"].map((n) => addMenu.indexOf(n));
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), 'the day menu: Travel, a stay, Eat and drink, See and do, a note, Mark the day, Add at a time');
  assert.ok(addMenu.includes("kinds.push({ id, label, icon, items: tiles.map(kindRow) })"), 'a category is a flyout of host.menu.show');
  assert.ok(addMenu.includes("label: KICKERS[t], icon: BADGES[t]") && addMenu.includes("tip: `Add ${/^[aeiou]/i"), 'a kind row reads short ("Flight"), its tip keeps "Add a flight"');
  assert.ok(js.includes('host.add.set(canEdit ? addKinds()') && !/markers?/.test(js.slice(js.indexOf('function addKinds('), js.indexOf('function openAddMenu('))), 'the titlebar + uses the same kinds, no markers');
  assert.ok(addMenu.includes("label: t.label, tip: `Mark the day: ") && addMenu.includes("label: t.label,\n      tip: onLine ?"), 'marker rows read short, tips keep the full wording');
  assert.ok(addMenu.includes("const EAT = ['restaurant', 'cafe', 'bar'];"));
  assert.ok(js.includes("attraction: 'Disneyland'"));
  assert.ok(js.includes("attraction: ['theme park', 'park', 'zoo', 'aquarium', 'disney', 'rides']"));
  assert.ok(!/data-types="[^"]*\bsight\b(?![^"]*\battraction\b)[^"]*"/.test(html), 'every field a sight has, an attraction has');
  assert.equal((html.match(/sight museum attraction tour show/g) || []).length, 8);
  assert.ok(fs.existsSync(new URL('../node_modules/@fortawesome/fontawesome-free/svgs/solid/wand-magic-sparkles.svg', import.meta.url)), 'its icon is in the set');
});

// The day menu's "Move all to..." and "Clear this day" (shiftDays and clearDay in travel-lib.js, applied by plan.moveDays and plan.clearDay).
const dayItems = () => [
  { id: 'a', kind: 'stop', date: '2026-10-12', time: '', order: 1000 },
  { id: 'b', kind: 'stop', date: '2026-10-12', time: '09:00', order: 0 },
  { id: 'c', kind: 'stay', date: '2026-10-12', checkOut: '2026-10-14', time: '', order: 2000 },
  { id: 'd', kind: 'stop', date: '2026-10-13', time: '', order: 1000 },
  { id: 'e', kind: 'stop', date: '2026-10-15', time: '', order: 1000 },
  { id: 'f', kind: 'stop', date: null, after: null, time: '', order: 5000 },
  { id: 'g', kind: 'lane', date: null, after: '2026-10-12', order: 1000 },
  { id: 'h', kind: 'stop', date: '2026-10-11', time: '', order: 1000 },
];
test('moving one day: its objects go to the picked day, the rest are left, undated and the line stay', () => {
  const r = lib.shiftDays(dayItems(), '2026-10-12', '2026-10-20', false);
  assert.deepEqual(Object.keys(r.changes).sort(), ['a', 'b', 'c']);
  assert.equal(r.moved, 3);
  assert.equal(r.days, 1);
  assert.equal(r.delta, 8);
  assert.deepEqual(r.changes.a, { date: '2026-10-20' }, 'no one on the new day: the order is kept');
  assert.deepEqual(r.changes.c, { date: '2026-10-20', checkOut: '2026-10-22' }, 'a stay takes its check-out along');
  assert.equal(r.changes.b.date, '2026-10-20');
  assert.ok(!('order' in r.changes.b), 'a timed object keeps its place by time');
});
test('moving into a day that has objects merges: the moved ones go after, none is lost', () => {
  const r = lib.shiftDays(dayItems(), '2026-10-12', '2026-10-13', false);
  assert.equal(r.moved, 3);
  assert.equal(r.changes.a.date, '2026-10-13');
  assert.equal(r.changes.a.order, 2000, 'after d (1000)');
  assert.equal(r.changes.c.order, 3000, 'then c, keeping a before c');
  assert.ok(!('d' in r.changes), 'what was there stays put');
  const same = lib.shiftDays(dayItems(), '2026-10-12', '2026-10-12', true);
  assert.deepEqual(same.changes, {}, 'the same day is no move');
});
test('sliding later: every day from this one on moves by the same days; earlier days are left', () => {
  const r = lib.shiftDays(dayItems(), '2026-10-12', '2026-10-15', true);
  assert.deepEqual(Object.keys(r.changes).sort(), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(r.delta, 3);
  assert.equal(r.days, 3);
  assert.equal(r.moved, 5);
  assert.equal(r.changes.d.date, '2026-10-16');
  assert.equal(r.changes.e.date, '2026-10-18');
  assert.equal(r.changes.a.date, '2026-10-15');
  assert.ok(!('h' in r.changes) && !('f' in r.changes) && !('g' in r.changes));
  assert.ok(!('order' in r.changes.a), 'e moves away from the 15th, so nobody is left there to merge with');
});
test('sliding earlier merges into the days before without losing anything', () => {
  const r = lib.shiftDays(dayItems(), '2026-10-12', '2026-10-11', true);
  assert.equal(r.delta, -1);
  assert.equal(r.changes.a.date, '2026-10-11');
  assert.equal(r.changes.a.order, 2000, 'after h on the 11th');
  assert.equal(r.changes.d.date, '2026-10-12');
  assert.equal(r.changes.e.date, '2026-10-14');
  assert.equal(r.changes.c.checkOut, '2026-10-13');
  assert.equal(lib.shiftDays(dayItems(), '2026-10-12', '2026-09-30', true).changes.a.date, '2026-09-30', 'across a month');
});
test('clearing a day takes its objects off it, keeps them, and leaves pointers and the line', () => {
  const items = [...dayItems(), { id: 'p', kind: 'link', date: '2026-10-12', ref: { module: 'calendar', kind: 'event', id: 'x' }, order: 4000 }];
  const r = lib.clearDay(items, '2026-10-12');
  assert.deepEqual(Object.keys(r.changes).sort(), ['a', 'b', 'c']);
  assert.equal(r.moved, 3);
  assert.equal(r.kept, 1, 'a pointer follows another module\'s object, so it stays');
  for (const c of Object.values(r.changes)) { assert.equal(c.date, null); assert.equal(c.after, null); }
  assert.ok(r.changes.b.order > 5000 && r.changes.a.order > 5000 && r.changes.c.order > r.changes.a.order, 'after the ones not on a day yet, in their order');
  assert.deepEqual(lib.clearDay(items, '2026-10-30').changes, {});
});
test('the day header: Add sits beside the "...", which opens Move all to... and Clear this day', () => {
  const html = read('travel.html');
  const js = read('travel.js');
  const head = html.slice(html.indexOf('<template id="tpl-day-head">'), html.indexOf('</template>', html.indexOf('<template id="tpl-day-head">')));
  assert.ok(/class="sdk-day-actions"><button[^>]*day-add[^>]*data-action="day-menu"[^>]*>[^]*Add<\/span><\/button><button[^>]*data-action="day-more"/.test(head), 'Add (the old per-day add action) then the "..."');
  assert.ok(js.includes("action === 'day-more'") && js.includes("label: 'Move all to…'") && js.includes("label: 'Clear this day'"));
  assert.ok(js.includes('host.menu.show({\n      id: `day-more-${day}`'), 'the shared menu');
  assert.ok(js.includes('Also move every day after this one by the same amount.') || html.includes('Also move every day after this one by the same amount.'));
  assert.ok(html.includes('id="day-dialog"') && js.includes("'Unschedule'") && js.includes("'Keep'"));
  assert.ok(js.includes('if (!canEdit) hide(head.querySelector(\'.sdk-day-actions\'), true);'), 'only people who can edit see them');
});

test('the titlebar names the module as this environment shows it (Itinerary), never the trip\'s name', () => {
  const js = read('travel.js');
  const titles = js.match(/host\.setTitle\([^)]*\)/g) || [];
  assert.ok(titles.length > 0 && titles.every((t) => t === 'host.setTitle(info.module.name)'), `every setTitle is the module's shown name: ${titles.join(', ')}`);
  assert.ok(!/hide\(slot\(head, 'title'\), true\)/.test(js), 'the trip name stays the heading in the page');
});

// Start and end time instead of start and length (#247): the end is worked out, only the length is stored.
test('lengthBetween and endOf turn a start and an end into a length and back, across midnight', () => {
  assert.equal(lib.lengthBetween('08:00', '15:00'), 420, 'same day');
  assert.equal(lib.lengthBetween('22:00', '01:30'), 210, 'an end before the start is the next day');
  assert.equal(lib.lengthBetween('08:00', '07:59'), 24 * 60 - 1, 'just under a day');
  assert.equal(lib.lengthBetween('08:00', '08:00'), 0, 'the same time is no length');
  assert.equal(lib.lengthBetween('', '08:00'), null);
  assert.equal(lib.lengthBetween('08:00', '24:00'), null, 'not a time');
  assert.equal(lib.lengthBetween('8:00', '09:00'), null, 'the 24-hour clock the time input stores');
  assert.deepEqual(lib.endOf('08:00', 420), { time: '15:00', days: 0 });
  assert.deepEqual(lib.endOf('22:00', 210), { time: '01:30', days: 1 });
  assert.deepEqual(lib.endOf('23:30', 24 * 60), { time: '23:30', days: 1 }, 'a full day ends at the same time');
  assert.deepEqual(lib.endOf('09:00', 50 * 60), { time: '11:00', days: 2 }, 'a long length says how many days later');
  assert.equal(lib.endOf('09:00', 0), null);
  assert.equal(lib.endOf(null, 60), null);
  assert.equal(lib.endOf('09:00', null), null);
  for (const [a, b] of [['00:00', '23:59'], ['13:15', '02:45'], ['06:00', '06:01']]) assert.equal(lib.endOf(a, lib.lengthBetween(a, b)).time, b, `${a} to ${b} comes back`);
  // the object keeps its length: arrivalOf, which Calendar and the journey card read, gives the same end
  assert.deepEqual(lib.arrivalOf({ time: '22:00', minutes: 210 }), { day: null, time: '01:30', days: 1 });
  assert.equal(lib.cleanItem({ id: 'x', kind: 'stop', type: 'sight', title: 'A', time: '22:00', minutes: 210 }).minutes, 210);
});

test('the editor offers a start and an end time (no Length | End time switch), keeps one stored length and says plainly what it refuses', () => {
  const html = read('travel.html');
  const js = read('travel.js');
  for (const p of ['', 'back-']) {
    assert.ok(html.includes(`<span class="sdk-label"${p ? '' : ' id="f-end-label"'}>End time</span><input id="f-${p}endTime" type="time" aria-describedby="f-${p}endNote">`), `${p}End time input, labelled End time`);
    assert.ok(html.includes(`id="f-${p}endNote" role="status"`), `${p}end note is announced`);
  }
  assert.ok(!html.includes('data-lenmode') && !html.includes('class="lenmode"'), 'no switch between Length and End time');
  assert.ok(!/name="endTime"|name="backEndTime"/.test(html), 'the end has no name: it is not a field of the object');
  assert.ok(!js.includes('planner-length-mode') && !js.includes('lenMode'), 'the old per-browser End time choice is no longer read: cards always show start to end');
  assert.ok(js.includes("const SAME_END = 'Same as the start, so there is no length.'"));
  assert.ok(js.includes("return 'The end time is the same as the start time. Pick a different end time.'"), 'an end equal to the start is refused in words');
  assert.ok(js.includes('const endSaid = endProblem();'), 'checked before saving');
  assert.ok(js.includes('minutes: lengthOf(\'f-hours\', \'f-minutes\')'), 'the length is what is stored');
  assert.ok(!/minutes:\s*lengthBetween|endTime:/.test(js), 'no end is stored');
  assert.ok(js.includes('time: spanText(item), minutes: duration') && js.includes('endText(item)].filter(Boolean).join'), 'the card and the day show start to end where the browser had chosen End time (unchanged)');
});

test('choosing a day: a date field, a grouped list through host.menu.show, Move to another day, Unscheduled (Thomas, 2026-10-14)', () => {
  const html = read('travel.html');
  const js = read('travel.js');
  for (const id of ['f-date', 'f-back-date', 'f-checkout']) {
    assert.ok(html.includes(`<select id="${id}"`) && /hidden><\/select>/.test(html), `${id}: the select stays as the value, hidden`);
    for (const part of ['input', 'phase']) assert.ok(html.includes(`id="${id}-${part}"`), `${id}-${part}`);
    assert.ok(html.includes(`<input id="${id}-input" type="date"`), `${id} has a date field`);
  }
  assert.ok(js.includes("label: 'Pick from the list'") && !html.includes('>Pick from the list</button>'), 'the list button is the date picker\'s (list option)');
  assert.ok(!html.includes('<select id="menu-day"') && !html.includes('id="item-menu"') && js.includes("id: 'move-to', label: 'Move to another day…'"), 'Move to another day opens the list; the item menu is host.menu.show, no markup of its own');
  assert.ok(js.includes("label: 'Move to unscheduled'") && !/Back to the line/.test(html + js), 'Back to the line is Move to unscheduled');
  assert.ok(js.includes(": 'Move up'") && js.includes(": 'Move down'"), 'Move up / Move down by default');
  assert.ok(js.includes("'30 minutes earlier'") && js.includes("'30 minutes later'") && js.includes('It stays on the same day.'), 'a timed object moves by half an hour, and the tooltip says it stays on its day');
  assert.ok(js.includes('function dayMenuItems(') && js.includes("{ id: 'pick-date', label: 'Pick a date…'"), 'the list ends with Pick a date');
  assert.ok(js.includes("const name = jointsOnly || !none ? 'Between days' : 'Unscheduled';") && js.includes("(checkout ? 'Not set' : 'Unscheduled')"), 'Unscheduled is the picker\'s own first entry and Clear (the list then holds the spots between days); Move to another day keeps its Unscheduled group; stored values are unchanged');
  assert.ok(js.includes('const DAY_NEST = 8;') && js.includes('items.push({ id: `group-${g.key}`, label: g.label, hint: g.range'), 'more than 8 days: a flyout per phase (the SDK menu\'s category), else a heading per phase');
  assert.ok(js.includes("items: () => {\n          const p = place();") && js.includes('host.ui.datePicker(input, {'), 'Pick from the list uses the SDK menu, through the date picker\'s list option');
  assert.ok(js.includes('input.min = b.min;') && js.includes('return { min: held && held < days[0] ? held : days[0]'), 'bounded by the timeline, never refusing the day it holds');
  assert.ok(js.includes('const month = ') === false && js.includes("parseYmd(d).toLocaleDateString([], { month: 'long', year: 'numeric' })"), 'without phases: by month');
  assert.ok(js.includes("dayField($('f-date'));") && js.includes("dayField($('f-checkout'), { checkout: true });"), 'the form sets the fields up');
  assert.ok(!/\.when-|aria-pressed.*clear/.test(read('travel.css') + read('travel-lib-editor.css')), 'no no-day button of the module\'s own to state');
});

test('every phase start and end is a marker of its own, and only the main phase\'s days are numbered', () => {
  const js = read('travel.js');
  assert.ok(js.includes('events.push({ day: back(b.start), ends: [], starts: [b] });') && js.includes('events.push({ day: b.end, ends: [b], starts: [] });'), 'one event each');
  assert.ok(!js.includes('--ph2') && !read('travel-lib-cards.css').includes('--ph2'), 'no blended tints');
  assert.ok(js.includes('y.ends.length - x.ends.length'), 'the ending marker comes first on a joint');
  assert.ok(js.includes('function numberedDays(days)') && js.includes("`Day ${dayNumber(day, days)} of ${numberedDays(days).length}` : ''"), 'a day outside the main phase has no number');
});

test('audit fixes: a trip keeps its time zone, a rental car its drop-off day, Money counts every cost', () => {
  assert.equal(lib.cleanTrip({ start: '2026-10-01', tz: 'Europe/Lisbon' }).tz, 'Europe/Lisbon', 'the trip keeps its zone');
  assert.equal(lib.cleanTrip({ start: '2026-10-01', tz: 'Not/AZone' }).tz, undefined, 'an unknown zone is dropped');
  assert.equal(lib.cleanTrip({ start: '2026-10-01' }).tz, undefined, 'no zone stays unset');
  const car = lib.cleanItem({ id: 'c', kind: 'journey', mode: 'car', title: 'Hire car', date: '2026-10-02', checkOut: '2026-10-05' });
  assert.equal(car.checkOut, '2026-10-05', 'a car has its drop-off day');
  assert.equal(lib.cleanItem({ id: 'c', kind: 'journey', mode: 'car', title: 'x', date: '2026-10-02', checkOut: '2026-10-02' }).checkOut, null, 'not on or before the pick-up day');
  assert.equal(lib.cleanItem({ id: 'f', kind: 'journey', mode: 'flight', title: 'x', date: '2026-10-02', checkOut: '2026-10-05' }).checkOut, null, 'only a car has one');
  assert.ok(lib.coverDaysOf(car).includes('2026-10-05'), 'the plan covers the drop-off day');
  const costs = [{ id: 'a', cost: 100, paidBy: 'u1', owners: [] }, { id: 'b', cost: 50.5, paidBy: '', owners: [] }];
  const b = lib.balances(costs, ['u1', 'u2']);
  assert.equal(b.total, 100, 'total is what was paid');
  assert.equal(b.planned, 150.5, 'planned counts every cost');
  const main = read('travel.js');
  assert.ok(main.includes('`Total ${money(b.planned)}`'), 'Money heads with the planned total');
});

test('audit fixes: Decisions follow the contract, Move to unscheduled goes to Unscheduled, the module has no card base of its own', () => {
  const main = read('travel.js');
  assert.ok(main.includes("poll: 'Polls to vote on', task: 'Tasks due before the trip'"), 'the contract\'s two groups');
  assert.ok(read('travel-lib-plan.js').includes("c.kind === 'poll' || (c.kind === 'task'"), 'open polls and tasks due before the trip');
  assert.ok(main.includes("label: 'Move to unscheduled', icon: 'lightbulb', onClick: () => attempt(() => plan.moveTo(id, null, 1e6))"), 'off the day into the Unscheduled area');
  assert.ok(!read('travel-lib-cards.css').includes('--card-head-base'), 'the shared banded card is the base');
  assert.ok(main.includes('host.objects.linksToAll') && main.includes("rows.push(['Linked from'"), 'one batched request, and Linked from is shown');
  assert.ok(main.includes("if (p.id === null) group.querySelector('h3').hidden = true;"), 'the default group has no heading repeating Unscheduled');
  const manifest = JSON.parse(read('../module.json'));
  assert.equal(manifest.guards.clear, 'clear', 'only who holds the clear permission may clear everything');
  const clear = manifest.permissions.find((p) => p.key === 'clear');
  assert.ok(clear && clear.default.moderator === true && clear.default.member === false && clear.default.guest === false, 'moderators by default, not members or guests');
});

console.log(`check-travel: OK (${n} checks)`);
