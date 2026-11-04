#!/usr/bin/env node
/*
 * check-flight-lookup.mjs -- steps 1 and 2 of documentation/plans/plan-flight-lookup.md, on their own, with no network:
 *
 *   - the airport list (server/airports.json, server/airports.js): MDW, SJC, LHR and NRT with the right time zones, a code
 *     by IATA or ICAO, the display name, the MIT notice beside it naming the pinned commit, and its size;
 *   - local times across zones: minutes across zones, overnight, across the date line (landing the day before) and across
 *     a change of clocks;
 *   - cleaning flight numbers and dates, with long hostile input answered at once;
 *   - the shared schedule (server/flight-lookup.js): remembering a flight and finding it on another day, a save with an
 *     unknown airport or no time kept nowhere, two schedules ranked by weekday then recency, the sixth dropping the one seen
 *     least recently, the 20,000-number cap, forgetting one number and clearing all, safe writes, and, after saving a
 *     flight with every field filled, that the file holds only the listed fields.
 *
 * And steps 3 and 4, against real servers on throwaway DATA_DIRs (localhost only, no LiveKit, no outside service):
 *
 *   - the manifest's `lookups` (only "flight"), and the Planner declaring it with its Suggest flights setting, on by default;
 *   - a single install: a module without `lookups` gets 404; a guest gets 403; bad number and bad date give 400; a remembered
 *     flight comes back on another day; an airport by its code; with the setting off nothing is suggested or kept while
 *     the airport list still answers; the owner's /api/flight-schedule counts, forgets one number and clears all, while
 *     the host's routes answer 404; the file in DATA_DIR; the `search` limit gives 429; and the schedule staying at the
 *     root when the install is moved into an environment of a hosted server;
 *   - a hosted server (BASE_DOMAIN, two environments): a flight saved in one is found from the other; the file in the root
 *     DATA_DIR and in neither environment's folder; with the setting off in one, its saves are not kept and its lookups
 *     answer nothing while the other still works; an owner's /api/flight-schedule is 404 and the host admin's
 *     /api/host/flight-schedule counts, forgets and clears.
 *
 * And step 5's page parts: the Flight schedule section on the host console and on the admin page, its words and routes
 * (checked in a browser too).
 *
 * And steps 6 to 8 where a tool can reach them: host.lookup in the SDK and its handlers in public/module-host.js, and the
 * Planner's own library (flightObject, lookupFill) against the single install: what Save sends is kept, and a lookup on
 * another day fills only the form's schedule fields. The page itself is checked in tools/check-travel.mjs and in a browser.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const airports = require('../server/airports.js');
const {
  FlightSchedule, FlightLookupError, findFlights, cleanNumber, cleanDate, FILE_NAME, MAX_NUMBERS, MAX_SCHEDULES,
} = require('../server/flight-lookup.js');

let n = 0;
const failures = [];
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failures.push(`${name}: ${err.message}`); }
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'flight-lookup-'));
const SCHEDULE_FIELDS = ['airline', 'from', 'to', 'departs', 'arrives', 'days', 'minutes', 'terminal', 'weekdays', 'lastSeen'];

// A flight as the Planner would save it, in the objects format.
const flight = (over = {}, details = {}) => ({
  icon: 'plane', kind: 'flight', title: 'Flight to San Jose', date: '2026-11-14', ...over,
  details: { airline: 'Southwest Airlines', number: 'WN 2483', from: { code: 'MDW', name: 'Chicago Midway' }, to: { code: 'SJC', name: 'San Jose' }, departs: '2026-11-14T12:50', arrives: '2026-11-14T15:25', terminal: '1', ...details },
});

// --- step 1: the airport list ---------------------------------------------------------------------------------------

await test('the airport list has MDW, SJC, LHR and NRT with their time zones', () => {
  const want = { MDW: ['KMDW', 'America/Chicago', 'Chicago Midway'], SJC: ['KSJC', 'America/Los_Angeles', 'Norman Y. Mineta San Jose'], LHR: ['EGLL', 'Europe/London', 'London Heathrow'], NRT: ['RJAA', 'Asia/Tokyo', 'Narita'] };
  for (const [code, [icao, tz, shown]] of Object.entries(want)) {
    const a = airports.airport(code);
    assert.ok(a, `${code} is in the list`);
    assert.equal(a.code, code);
    assert.equal(a.icao, icao, `${code}'s ICAO code`);
    assert.equal(a.tz, tz, `${code}'s time zone`);
    assert.equal(airports.displayName(a), shown, `${code}'s display name`);
    assert.equal(airports.airport(icao), a, `${icao} finds the same airport`);
    assert.equal(airports.airport(code.toLowerCase()), a, 'any case');
  }
  assert.equal(airports.airport('MDW').city, 'Chicago');
  assert.equal(airports.airport('ZZZ'), null);
  assert.equal(airports.airport(''), null);
  assert.equal(airports.airport('MD'), null);
  assert.equal(airports.airport(null), null);
  assert.equal(airports.airport({ code: 'MDW' }), null);
  assert.equal(airports.airport('M'.repeat(100000)), null);
  assert.equal(airports.displayName({ name: 'Amsterdam Airport Schiphol' }), 'Amsterdam Airport Schiphol', 'only a trailing word goes');
  assert.equal(airports.displayName({ name: 'Airport' }), 'Airport', 'never empty');
});

await test('the airport list: every entry, its size, and its notice', () => {
  const file = path.join(ROOT, 'server', 'airports.json');
  const size = fs.statSync(file).size;
  assert.ok(size < 1.5 * 1024 * 1024, `server/airports.json is ${size} bytes; cut to airports with an IATA code it stays under 1.5 MB`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const codes = Object.keys(raw);
  assert.ok(codes.length > 7000, `${codes.length} airports`);
  assert.equal(airports.count(), codes.length);
  for (const code of codes) {
    assert.match(code, /^[A-Z]{3}$/, `${code} is an IATA code`);
    assert.deepEqual(Object.keys(raw[code]), ['icao', 'name', 'city', 'country', 'tz'], `${code} holds only icao, name, city, country, tz`);
    assert.ok(raw[code].name, `${code} has a name`);
    if (raw[code].tz) new Intl.DateTimeFormat('en-US', { timeZone: raw[code].tz }); // a zone this Node knows, or it throws
  }
  const notice = fs.readFileSync(path.join(ROOT, 'server', 'airports-LICENSE'), 'utf8');
  assert.match(notice, /The MIT License/);
  assert.match(notice, /Copyright \(c\) 2014 mwgg/);
  const tool = fs.readFileSync(path.join(ROOT, 'tools', 'build-airports.mjs'), 'utf8');
  const pin = /SOURCE_COMMIT = '([0-9a-f]{40})'/.exec(tool);
  assert.ok(pin, 'the build tool pins one commit');
  assert.ok(notice.includes(pin[1]), 'the notice names the pinned commit');
});

await test('minutes across zones, overnight, across the date line and across a change of clocks', () => {
  const tz = (c) => airports.airport(c).tz;
  const between = (a, d, b, r) => airports.minutesBetween(d, tz(a), r, tz(b));
  assert.equal(between('MDW', '2026-11-14T12:50', 'SJC', '2026-11-14T15:25'), 275, 'Chicago to San Jose');
  assert.equal(between('LAX', '2026-11-14T22:00', 'JFK', '2026-11-15T06:20'), 320, 'overnight');
  assert.equal(between('NRT', '2026-11-14T21:00', 'HNL', '2026-11-14T09:00'), 420, 'across the date line, landing earlier the same day');
  assert.equal(between('AKL', '2026-11-15T00:30', 'HNL', '2026-11-14T06:30'), 300, 'across the date line, landing the day before');
  // The United States moves its clocks on 2026-03-08, Britain on 2026-03-29: the same clock times are an hour apart.
  assert.equal(between('LHR', '2026-03-01T10:00', 'JFK', '2026-03-01T13:00'), 480, 'before the change');
  assert.equal(between('LHR', '2026-03-15T10:00', 'JFK', '2026-03-15T13:00'), 420, 'between the two changes');
  // A night flight across Chicago's clocks going back (2026-11-01, 02:00 becomes 01:00).
  assert.equal(between('ORD', '2026-10-31T23:30', 'ORD', '2026-11-01T03:30'), 300, 'a night with an extra hour');
  // A skipped clock time reads an hour later; a doubled one is the first.
  const chi = tz('ORD');
  assert.equal(airports.utcToLocal(airports.localToUtc('2026-03-08T02:30', chi), chi), '2026-03-08T03:30');
  assert.equal(airports.localToUtc('2026-11-01T01:30', chi), Date.UTC(2026, 10, 1, 6, 30));
  assert.equal(airports.arrivalFrom('2026-11-14T12:50', tz('MDW'), 275, tz('SJC')), '2026-11-14T15:25');
  assert.equal(airports.arrivalFrom('2026-11-15T00:30', tz('AKL'), 300, tz('HNL')), '2026-11-14T06:30');
  assert.equal(airports.localToUtc('2026-02-30T10:00', chi), null, 'not a real day');
  assert.equal(airports.localToUtc('2026-11-14T24:00', chi), null, 'not a real time');
  assert.equal(airports.localToUtc('2026-11-14T10:00', 'Not/AZone'), null, 'not a zone');
  assert.equal(airports.minutesBetween('2026-11-14T10:00', '', '2026-11-14T12:00', chi), null, 'a zone missing');
});

// --- step 2: numbers, dates, the schedule and findFlights -------------------------------------------------------------

await test('cleaning flight numbers and dates', () => {
  for (const [typed, key] of [['wn 2483', 'WN2483'], ['WN2483', 'WN2483'], ['U2 8123', 'U28123'], ['BA 117', 'BA117'], ['SWA2483', 'SWA2483'], ['9W 1A', '9W1A'], [' ba  117 ', 'BA117']]) {
    assert.equal(cleanNumber(typed), key, `${typed} is taken`);
  }
  for (const typed of ['2483', 'Southwest 2483', 'WN 24835', '', 'WN', '24 83', 'WN-2483', 'W', 'WN 2483AB', null, 2483, { number: 'WN2483' }]) {
    assert.equal(cleanNumber(typed), null, `${JSON.stringify(typed)} is refused`);
  }
  assert.equal(cleanDate('2026-11-14'), '2026-11-14');
  for (const d of ['2026-02-30', '2026-13-01', '14/11/2026', '2026-11-14T10:00', '', null]) assert.equal(cleanDate(d), null, `${d} is refused`);
  // Bounded: long hostile text is refused at once, whatever its shape.
  const t0 = Date.now();
  for (const s of ['W'.repeat(200000), `WN ${'1'.repeat(200000)}`, ' '.repeat(200000), `${'1'.repeat(100000)}-`]) {
    assert.equal(cleanNumber(s), null);
    assert.equal(cleanDate(s), null);
  }
  assert.ok(Date.now() - t0 < 200, 'long input answered at once');
});

await test('remembering a flight and finding it on another day', async () => {
  const dir = tmp();
  const s = new FlightSchedule(dir);
  assert.equal(s.file, path.join(dir, FILE_NAME), 'the file sits in the directory it is given (the root DATA_DIR)');
  assert.equal(s.remember(flight()), true);
  assert.deepEqual(s.stats(), { numbers: 1, schedules: 1 });
  // A Saturday, four weeks on.
  const found = await findFlights({ number: 'wn2483', date: '2026-12-12', schedule: s });
  assert.equal(found.length, 1);
  assert.deepEqual(found[0], {
    object: {
      icon: 'plane', title: 'Flight to San Jose', basis: 'general', kind: 'flight', date: '2026-12-12',
      details: { airline: 'Southwest Airlines', number: 'WN 2483', from: { code: 'MDW', name: 'Chicago Midway' }, to: { code: 'SJC', name: 'Norman Y. Mineta San Jose' }, departs: '2026-12-12T12:50', arrives: '2026-12-12T15:25', minutes: 275, terminal: '1' },
    },
    line: 'MDW 12:50 to SJC 15:25',
    sameWeekday: true,
    lastSeen: '2026-11',
  });
  // A Monday: still found, not on its weekday.
  const monday = await findFlights({ number: 'WN 2483', date: '2026-12-14', schedule: s });
  assert.equal(monday[0].sameWeekday, false);
  assert.deepEqual(await findFlights({ number: 'WN 9999', date: '2026-12-14', schedule: s }), [], 'not found is an empty answer');
  await assert.rejects(findFlights({ number: '2483', date: '2026-12-14', schedule: s }), (e) => e instanceof FlightLookupError && e.message === 'bad number');
  await assert.rejects(findFlights({ number: 'WN 2483', date: '2026-02-30', schedule: s }), (e) => e instanceof FlightLookupError && e.message === 'bad date');
  s.flush();
  // Read back by a new start.
  const again = new FlightSchedule(dir);
  assert.deepEqual(again.stats(), { numbers: 1, schedules: 1 });
  assert.equal(fs.existsSync(`${s.file}.tmp`), false, 'no temporary file left');
  assert.equal(fs.statSync(s.file).mode & 0o777, 0o600, 'private to the server');
});

await test('the flight time is worked out again for the asked date, and an arrival from the flight time', async () => {
  const s = new FlightSchedule(tmp());
  // London to New York saved on 2026-03-01 (480 minutes, before the US clocks change); asked for 2026-03-15.
  assert.equal(s.remember(flight({ title: 'Flight to New York' }, { airline: 'British Airways', number: 'BA 117', from: { code: 'LHR' }, to: { code: 'JFK' }, departs: '2026-03-01T10:00', arrives: '2026-03-01T13:00', terminal: '5' })), true);
  const [later] = await findFlights({ number: 'BA117', date: '2026-03-15', schedule: s });
  assert.equal(later.object.details.minutes, 420);
  // No arrival, only a flight time: the arrival is worked out from the two zones.
  assert.equal(s.remember(flight({}, { number: 'NZ 10', from: { code: 'AKL' }, to: { code: 'HNL' }, departs: '2026-11-15T00:30', arrives: undefined, minutes: 300 })), true);
  const [nz] = await findFlights({ number: 'NZ10', date: '2026-11-22', schedule: s });
  assert.equal(nz.object.details.arrives, '2026-11-21T06:30', 'lands the day before');
  assert.equal(nz.line, 'AKL 00:30 to HNL 06:30');
  assert.equal(nz.object.title, 'Flight to Honolulu');
});

await test('a save with an unknown airport, no time, or no arrival is kept nowhere', () => {
  const dir = tmp();
  const s = new FlightSchedule(dir);
  const refused = [
    flight({}, { to: { code: 'ZZZ', name: 'Nowhere' } }),
    flight({}, { from: { name: 'Chicago Midway' } }),
    flight({}, { departs: '2026-11-14' }),
    flight({}, { departs: undefined }),
    flight({}, { arrives: undefined }),
    flight({}, { arrives: '15:25' }),
    flight({}, { arrives: '2026-11-14T10:00' }), // lands before it leaves (10:00 Pacific is 11:50 Central)
    flight({}, { arrives: '2026-11-24T11:00' }), // more than 7 days later
    flight({}, { number: '2483' }),
    flight({}, { number: 'Southwest 2483' }),
    flight({ kind: 'train' }),
    flight({ title: '' }),
    null, 'WN 2483', [], { kind: 'flight' },
  ];
  for (const o of refused) assert.equal(s.remember(o), false, JSON.stringify(o && o.details));
  assert.deepEqual(s.stats(), { numbers: 0, schedules: 0 });
  s.flush();
  assert.equal(fs.existsSync(path.join(dir, FILE_NAME)), false, 'nothing written');
});

await test('two schedules under one number, ranked by weekday, then recency', async () => {
  const s = new FlightSchedule(tmp());
  // Saturday 2026-11-14 to San Jose; Monday 2026-11-16 to Denver, seen later; Monday 2026-11-02 to Denver again (older).
  s.remember(flight());
  s.remember(flight({}, { to: { code: 'DEN' }, departs: '2026-11-16T07:00', arrives: '2026-11-16T08:45' }));
  s.remember(flight({}, { to: { code: 'DEN' }, departs: '2026-11-02T07:00', arrives: '2026-11-02T08:45', terminal: '' }));
  assert.deepEqual(s.stats(), { numbers: 1, schedules: 2 }, 'the same airports and clock times are one schedule');
  const den = s.schedulesFor('WN2483').find((x) => x.to === 'DEN');
  assert.deepEqual(den.weekdays, [1]);
  assert.equal(den.lastSeen, '2026-11-16', 'an older save does not move lastSeen back');
  assert.equal(den.terminal, '1', 'a save without a terminal keeps the one known');
  // Thursday: neither flies that day, so the most recently seen (Denver) first.
  assert.deepEqual((await findFlights({ number: 'WN2483', date: '2026-12-03', schedule: s })).map((e) => e.line), ['MDW 07:00 to DEN 08:45', 'MDW 12:50 to SJC 15:25']);
  // Saturday: San Jose flies that day, so first.
  const sat = await findFlights({ number: 'WN2483', date: '2026-12-05', schedule: s });
  assert.deepEqual(sat.map((e) => [e.line, e.sameWeekday]), [['MDW 12:50 to SJC 15:25', true], ['MDW 07:00 to DEN 08:45', false]]);
  // A save on a Wednesday adds the day; a newer airline name replaces the old.
  s.remember(flight({}, { airline: 'Southwest', departs: '2026-11-18T12:50', arrives: '2026-11-18T15:25', terminal: '2' }));
  const sjc = s.schedulesFor('WN2483').find((x) => x.to === 'SJC');
  assert.deepEqual([sjc.weekdays, sjc.lastSeen, sjc.airline, sjc.terminal], [[3, 6], '2026-11-18', 'Southwest', '2']);
});

await test('the sixth schedule drops the one seen least recently', () => {
  const s = new FlightSchedule(tmp());
  const days = ['2026-11-10', '2026-11-03', '2026-11-12', '2026-11-11', '2026-11-13'];
  days.forEach((d, i) => assert.equal(s.remember(flight({}, { departs: `${d}T0${i}:00`, arrives: `${d}T0${i + 4}:00` })), true));
  assert.equal(s.schedulesFor('WN2483').length, MAX_SCHEDULES);
  s.remember(flight({}, { departs: '2026-11-14T09:00', arrives: '2026-11-14T13:00' }));
  const kept = s.schedulesFor('WN2483');
  assert.equal(kept.length, MAX_SCHEDULES);
  assert.deepEqual(kept.map((x) => x.lastSeen).sort(), ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'], 'the one last seen on 2026-11-03 went');
});

await test('at most 20,000 numbers, the one seen least recently dropped first', () => {
  const s = new FlightSchedule(tmp());
  // The oldest is saved first and seen earliest; the rest after it.
  assert.equal(s.remember(flight({}, { number: 'AA 1', departs: '2026-01-01T10:00', arrives: '2026-01-01T13:00' })), true);
  const t0 = Date.now();
  for (let i = 0; s.stats().numbers < MAX_NUMBERS; i += 1) {
    const code = `${String.fromCharCode(66 + (i % 20))}${String.fromCharCode(65 + Math.floor(i / 20) % 26)}`;
    s.remember(flight({}, { number: `${code} ${1 + Math.floor(i / 520)}`, departs: '2026-06-01T10:00', arrives: '2026-06-01T13:00' }));
  }
  assert.equal(s.stats().numbers, MAX_NUMBERS);
  assert.equal(s.remember(flight({}, { number: 'ZZ 9999', departs: '2026-07-01T10:00', arrives: '2026-07-01T13:00' })), true);
  assert.equal(s.stats().numbers, MAX_NUMBERS, 'still at the cap');
  assert.equal(s.schedulesFor('AA1').length, 0, 'the least recently seen went');
  assert.equal(s.schedulesFor('ZZ9999').length, 1, 'the new one is kept');
  assert.ok(Date.now() - t0 < 20000, `filling 20,000 numbers took ${Date.now() - t0} ms`);
  clearTimeout(s.timer);
});

await test('forgetting one number and clearing all', () => {
  const dir = tmp();
  const s = new FlightSchedule(dir);
  s.remember(flight());
  s.remember(flight({}, { number: 'BA 117', from: { code: 'LHR' }, to: { code: 'JFK' }, departs: '2026-03-01T10:00', arrives: '2026-03-01T13:00' }));
  assert.deepEqual(s.stats(), { numbers: 2, schedules: 2 });
  assert.equal(s.forget('wn 2483'), true);
  assert.equal(s.forget('WN2483'), false, 'already gone');
  assert.equal(s.forget('not a number'), false);
  assert.deepEqual(s.stats(), { numbers: 1, schedules: 1 });
  s.flush();
  assert.deepEqual(new FlightSchedule(dir).stats(), { numbers: 1, schedules: 1 }, 'forgetting is written');
  assert.equal(s.clear(), 1);
  assert.deepEqual(s.stats(), { numbers: 0, schedules: 0 });
  s.flush();
  assert.deepEqual(new FlightSchedule(dir).stats(), { numbers: 0, schedules: 0 }, 'clearing is written');
});

await test('after saving a flight with every field filled, the file holds only the listed fields', () => {
  const dir = tmp();
  const s = new FlightSchedule(dir);
  const full = flight({
    title: 'Ada Lovelace flies to San Jose', content: 'Window seat for Ada; bring the charger',
    tags: ['ada'], place: { name: 'Ada house', lat: 1, lng: 2 }, links: [{ title: 'Booking', url: 'https://example.com/booking/ADA123' }],
    people: ['ada', 'bob'], cost: 412.5, paidBy: 'bob', notes: 'secret note', space: 'trip-one', environment: 'acme', author: 'ada',
  }, { seat: '14A', class: 'Business', reference: 'ADA123', gate: 'B12', cost: 412.5, passenger: 'Ada Lovelace' });
  assert.equal(s.remember(full), true);
  s.flush();
  const text = fs.readFileSync(path.join(dir, FILE_NAME), 'utf8');
  const saved = JSON.parse(text);
  assert.deepEqual(Object.keys(saved), ['numbers']);
  assert.deepEqual(Object.keys(saved.numbers), ['WN2483']);
  for (const rec of saved.numbers.WN2483) {
    for (const key of Object.keys(rec)) assert.ok(SCHEDULE_FIELDS.includes(key), `${key} is a listed field`);
  }
  assert.deepEqual(saved.numbers.WN2483[0], { airline: 'Southwest Airlines', from: 'MDW', to: 'SJC', departs: '12:50', arrives: '15:25', days: 0, minutes: 275, terminal: '1', weekdays: [6], lastSeen: '2026-11-14' });
  for (const never of ['Ada', 'Lovelace', 'charger', '14A', 'Business', 'ADA123', 'B12', '412', 'bob', 'secret', 'trip-one', 'acme', 'example.com']) {
    assert.ok(!text.includes(never), `the file never holds "${never}"`);
  }
});

await test('a hand-edited file is read through the same rules', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, FILE_NAME), JSON.stringify({ numbers: {
    WN2483: [{ from: 'MDW', to: 'SJC', departs: '12:50', arrives: '15:25', days: 0, minutes: 275, weekdays: [6, 9], lastSeen: '2026-11-14', seat: '14A', who: 'ada' }, { from: 'MDW', to: 'SJC', departs: '25:00', arrives: '15:25', days: 0, lastSeen: '2026-11-14' }],
    'not a number': [{ from: 'MDW', to: 'SJC', departs: '12:50', arrives: '15:25', days: 0, lastSeen: '2026-11-14' }],
    __proto__: [],
  } }));
  const s = new FlightSchedule(dir);
  assert.deepEqual(s.stats(), { numbers: 1, schedules: 1 });
  assert.deepEqual(s.schedulesFor('WN2483')[0], { from: 'MDW', to: 'SJC', departs: '12:50', arrives: '15:25', days: 0, minutes: 275, weekdays: [6], lastSeen: '2026-11-14' });
  fs.writeFileSync(path.join(dir, FILE_NAME), '{ not json');
  const logged = [];
  const error = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try { assert.deepEqual(new FlightSchedule(dir).stats(), { numbers: 0, schedules: 0 }, 'a broken file starts empty'); } finally { console.error = error; }
  assert.match(logged.join('\n'), /could not read flight-schedule\.json/, 'and says so in the log');
});

// The day the next checks take as today: Sunday 2026-10-04.
const NOW = Date.UTC(2026, 9, 4, 12);
const at = (dir) => new FlightSchedule(dir, { now: () => NOW });
const quietly = (fn) => {
  const logged = [];
  const error = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try { return { result: fn(), logged: logged.join('\n') }; } finally { console.error = error; }
};

await test('a save more than 400 days ahead or 3 years back is not kept; read from the file it is clamped or dropped', () => {
  const dir = tmp();
  const s = at(dir);
  const on = (d, number = 'WN 2483') => s.remember(flight({}, { number, departs: `${d}T12:50`, arrives: `${d}T15:25` }));
  assert.equal(on('2099-12-31'), false, '2099 is not kept');
  assert.equal(on('9999-12-31'), false, '9999 is not kept');
  assert.equal(on('2027-11-08'), true, '400 days ahead is kept');
  assert.equal(on('2027-11-09', 'AA 2'), false, '401 days ahead is not');
  assert.equal(on('2023-10-05', 'AA 3'), true, '3 years back is kept');
  assert.equal(on('2023-10-04', 'AA 4'), false, 'a day more is not');
  assert.equal(on('2001-01-01', 'AA 5'), false, '2001 is not kept');
  assert.deepEqual(s.stats(), { numbers: 2, schedules: 2 });
  assert.equal(s.schedulesFor('WN2483')[0].lastSeen, '2027-11-08', 'the far save did not move lastSeen');
  clearTimeout(s.timer);
  const file = path.join(tmp(), FILE_NAME);
  const rec = (lastSeen, departs = '12:50') => ({ from: 'MDW', to: 'SJC', departs, arrives: '15:25', days: 0, weekdays: [6], lastSeen });
  fs.writeFileSync(file, JSON.stringify({ numbers: { WN2483: [rec('9999-12-31'), rec('2026-11-14', '09:00')], BA117: [rec('2001-01-01')], UA100: [rec('2027-11-01')] } }));
  const r = at(path.dirname(file));
  assert.deepEqual(r.stats(), { numbers: 2, schedules: 3 }, 'the one from 2001 is dropped');
  assert.deepEqual(r.schedulesFor('WN2483').map((x) => x.lastSeen), ['2027-11-08', '2026-11-14'], '9999 is read as 400 days ahead');
  assert.equal(r.schedulesFor('UA100')[0].lastSeen, '2027-11-01', 'within the window it stays as it is');
});

await test('an older save adds its weekday but does not overwrite the newer airline, terminal, day count or flight time', () => {
  const s = at(tmp());
  s.remember(flight({}, { airline: 'Southwest', terminal: '2', departs: '2026-11-18T12:50', arrives: '2026-11-18T15:25' }));
  s.remember(flight({}, { airline: 'Old Name', terminal: 'A', departs: '2026-11-14T12:50', arrives: '2026-11-15T15:25' }));
  const [x] = s.schedulesFor('WN2483');
  assert.deepEqual(x.weekdays, [3, 6], 'the older save\'s weekday is added');
  assert.deepEqual([x.lastSeen, x.airline, x.terminal, x.days, x.minutes], ['2026-11-18', 'Southwest', '2', 0, 275]);
  s.remember(flight({}, { airline: 'Same Day', terminal: '3', departs: '2026-11-18T12:50', arrives: '2026-11-18T15:25' }));
  assert.deepEqual([s.schedulesFor('WN2483')[0].airline, s.schedulesFor('WN2483')[0].terminal], ['Same Day', '3'], 'a save for the same day does');
  clearTimeout(s.timer);
});

await test('a corrupt file is moved aside (mode 600) and the schedule starts empty, saying so', () => {
  for (const text of ['{ not json', '[]', 'null', '{"numbers":[]}']) {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, FILE_NAME), text);
    const { result: s, logged } = quietly(() => at(dir));
    assert.deepEqual(s.stats(), { numbers: 0, schedules: 0 }, `${text}: starts empty`);
    const aside = fs.readdirSync(dir).filter((f) => f.startsWith(`${FILE_NAME}.bad-`));
    assert.deepEqual(aside, [`${FILE_NAME}.bad-20261004T120000Z`], `${text}: moved aside`);
    assert.equal(fs.readFileSync(path.join(dir, aside[0]), 'utf8'), text, 'as it was');
    assert.equal(fs.statSync(path.join(dir, aside[0])).mode & 0o777, 0o600, 'mode 600');
    assert.ok(!fs.existsSync(path.join(dir, FILE_NAME)), 'nothing left under the name');
    assert.match(logged, /it was moved to flight-schedule\.json\.bad-20261004T120000Z/, 'the log says where');
    assert.equal(s.remember(flight()), true, 'and it learns again');
    s.flush();
    assert.equal(at(dir).stats().numbers, 1);
  }
});

await test('an oversized file: nothing is learned; Clear all replaces it with an empty schedule', async () => {
  const dir = tmp();
  const file = path.join(dir, FILE_NAME);
  fs.writeFileSync(file, '');
  fs.truncateSync(file, 41 * 1024 * 1024);
  const { result: s, logged } = quietly(() => at(dir));
  assert.match(logged, /larger than expected/);
  assert.equal(s.remember(flight()), false, 'remember keeps nothing');
  assert.deepEqual(s.stats(), { numbers: 0, schedules: 0 });
  assert.equal((await findFlights({ number: 'WN2483', date: '2026-11-21', schedule: s })).length, 0, 'a lookup finds nothing');
  assert.equal(s.timer, null, 'no write is waiting');
  assert.equal(fs.statSync(file).size, 41 * 1024 * 1024, 'the file is left as it is');
  assert.equal(s.clear(), 0, 'Clear all');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { numbers: {} }, 'the file is replaced by an empty schedule');
  assert.equal(s.remember(flight()), true, 'after clearing it learns again');
  s.flush();
  assert.equal(at(dir).stats().numbers, 1);
});

await test('Suggest flights is the environment\'s choice: any module declaring the lookup with it off turns it off for all', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  const fn = /function flightSuggestionsOn\(\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(fn, 'flightSuggestionsOn takes no module');
  assert.ok(fn[0].includes('for (const { id, version } of modules.list())') && fn[0].includes("suggestFlights !== true) return false"), 'it reads every installed module');
  assert.ok(!/flightSuggestionsOn\(ctx/.test(src), 'no route asks one module alone');
});

await test('no environment variable and no outside service', () => {
  for (const f of ['server/airports.js', 'server/flight-lookup.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/process\.env/.test(src), `${f} reads no environment variable`);
    assert.ok(!/\bfetch\(|require\(['"]https?['"]\)/.test(src), `${f} asks nothing outside`);
  }
});

// --- step 3: the manifest's declaration ------------------------------------------------------------------------------

const { cleanManifest, ModuleError } = require('../server/modules.js');

await test('the manifest: `lookups` takes "flight" and refuses anything else, saying why', () => {
  const files = new Map([['page.html', Buffer.from('')]]);
  const manifest = (lookups) => ({ id: 'trips', name: 'Trips', version: '1.0.0', scope: ['environment'], surfaces: { page: { entry: 'page.html' } }, ...(lookups === undefined ? {} : { lookups }) });
  assert.deepEqual(cleanManifest(manifest(['flight', 'flight']), files).lookups, ['flight']);
  assert.deepEqual(cleanManifest(manifest(undefined), files).lookups, [], 'none declared, none kept');
  assert.throws(() => cleanManifest(manifest(['train']), files), (err) => err instanceof ModuleError && err.message === 'module.json: lookups: "train" is not a lookup; the lookups are flight');
  assert.throws(() => cleanManifest(manifest('flight'), files), (err) => err instanceof ModuleError && err.message === 'module.json: lookups must be a list; the lookups are flight');
});

await test('the Planner declares the flight lookup and Suggest flights from earlier trips, on by default', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'travel', 'module.json'), 'utf8'));
  assert.deepEqual(m.lookups, ['flight']);
  const setting = m.settings.find((d) => d.key === 'suggestFlights');
  assert.ok(setting, 'the setting is declared');
  assert.deepEqual({ label: setting.label, type: setting.type, scope: setting.scope, default: setting.default }, { label: 'Suggest flights from earlier trips', type: 'boolean', scope: 'environment', default: true });
  assert.equal(setting.help, 'Fill a flight from the same flight number saved before on this server. Flights saved here also help others; turn this off to keep them out.');
});

// --- steps 6 to 8: the SDK and the Planner ---------------------------------------------------------------------------

// The Planner's library, loaded as check-travel loads it, with the SDK's own text and time helpers.
const plannerLib = (() => {
  const read = (name) => fs.readFileSync(path.join(ROOT, 'modules', 'travel', 'src', name), 'utf8');
  const pad = (v) => String(v).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (t) => { const [y, m, d] = String(t).split('-').map(Number); return new Date(y, m - 1, d); };
  const src = `${read('travel-lib.js')}\n${read('travel-lib-object.js')}\n${read('travel-lib-plan.js')}`;
  const lib = new Function('ymd', 'parseYmd', `${src}\nreturn { cleanItem, objectFields, flightObject, lookupFill };`)(ymd, parseYmd);
  const win = { addEventListener() {}, location: { search: '' } };
  win.parent = win;
  new Function('window', 'document', fs.readFileSync(path.join(ROOT, 'public', 'sdk', 'host.js'), 'utf8'))(win, { createElement: (tag) => ({ tag }) });
  return { ...lib, util: { plain: win.hostText.plain, localWhen: win.hostText.localWhen } };
})();

await test('the SDK offers host.lookup, and the page that hosts a module answers it on the module routes', () => {
  const sdk = fs.readFileSync(path.join(ROOT, 'public', 'sdk', 'host.js'), 'utf8');
  const page = fs.readFileSync(path.join(ROOT, 'public', 'module-host.js'), 'utf8');
  for (const [name, method] of [['flight', 'lookup.flight'], ['airport', 'lookup.airport'], ['available', 'lookup.available'], ['remember', 'lookup.remember']]) {
    assert.ok(sdk.includes(`      ${name}: (`) && sdk.includes(`call('${method}'`), `host.lookup.${name}`);
    assert.ok(page.includes(`async '${method}'(`), `module-host.js answers ${method}`);
  }
  assert.ok(sdk.includes("call('lookup.remember', { kind: kind || 'flight', object }).then(() => undefined, () => undefined)"), 'remember never throws');
  assert.ok(sdk.includes("call('lookup.available', { kind: kind || 'flight' }).then((r) => r === true, () => false)"), 'available answers true or false');
  assert.ok(page.includes("url('/flight-lookup/remember', scopeOf())") && page.includes("url('/flight-lookup', scopeOf(), { code: c })"), 'the module routes, in the module\'s own scope');
  assert.ok(page.includes('if (err.status === 404) return null;'), 'no such airport is null');
});

// --- step 5: the admin's Flight schedule section, on the host console and on the admin page ---
await test("the admin's Flight schedule section: the same parts on the host console and the admin page, each on its own route", () => {
  const read = (name) => fs.readFileSync(path.join(ROOT, 'public', name), 'utf8');
  const shared = read('flight-schedule.js');
  assert.ok(shared.includes("title: 'Clear all learned flights?'") && shared.includes("message: 'Lookups will find nothing until people save flights again.'") && shared.includes('await confirmDialog(CLEAR_CONFIRM)'), 'Clear all asks first, in the plan\'s words');
  assert.ok(shared.includes('if (!await confirmDialog(CLEAR_CONFIRM)) return;'), 'Clear all waits for the answer');
  assert.ok(shared.includes('`This server has learned ${flights(n)} from saved trips.`'), 'the count, in the plan\'s words');
  assert.ok(shared.includes('`${route}?number=${encodeURIComponent(typed)}`'), 'Forget sends one number');
  assert.ok(/catch \(err\) \{\s*say\(err\.message, true\)/.test(shared), 'the server\'s own sentence is shown');
  assert.ok(/catch \(err\) \{\s*section\.hidden = true;/.test(shared), 'no section when the route refuses');
  for (const page of ['host.html', 'admin.html']) {
    const html = read(page);
    for (const id of ['flight-schedule-section', 'flight-schedule-count', 'flight-schedule-status', 'flight-forget-form', 'flight-forget-number', 'flight-clear']) {
      assert.equal(html.split(`id="${id}"`).length - 1, 1, `${page} has #${id} once`);
    }
    assert.ok(/id="flight-schedule-section" hidden>/.test(html), `${page}: hidden until the route answers`);
    assert.ok(html.includes('<h2>Flight schedule</h2>') && html.includes('>Forget a flight</button>') && html.includes('>Clear all</button>'), `${page}: the plan's labels`);
    assert.ok(html.includes('<label class="field-label" for="flight-forget-number">'), `${page}: the number field has a label`);
  }
  const host = read('host.js');
  const admin = read('admin.js');
  assert.ok(host.includes("wireFlightSchedule('/api/host/flight-schedule')"), 'the host console uses the host\'s route');
  assert.ok(admin.includes("wireFlightSchedule('/api/flight-schedule')"), 'the admin page uses the single install\'s route');
  assert.ok(admin.includes('if (!environment.hosted) await flightSchedule.load();'), 'a hosted environment\'s admin page shows no section');
});

// --- steps 3 and 4: real servers ----------------------------------------------------------------------------------

const servers = [];
async function startServer(dataDir, extraEnv) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, TZ: 'UTC', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  const server = {
    port,
    output: () => out,
    stop: () => new Promise((resolve) => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); }),
  };
  servers.push(server);
  return server;
}
function call(server, host, method, urlPath, { body, cookie } = {}) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { host: `${host ? `${host}.` : ''}localhost:${server.port}`, accept: 'application/json' };
  if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = payload.length; }
  if (cookie) headers.cookie = cookie;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const cookieOf = (res) => [].concat(res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
const expect = (r, status, what) => assert.equal(r.status, status, `${what}: ${r.status} ${r.text}`);
const later = (ms) => new Promise((r) => setTimeout(r, ms));
const SAVE_WAIT = 2600; // the schedule is written a moment (2 s) after a change
// Every file called flight-schedule.json under a folder.
const schedulesUnder = (dir) => {
  const found = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name === FILE_NAME) found.push(f); } };
  if (fs.existsSync(dir)) walk(dir);
  return found;
};
// Install the Planner (and the To-do, which has no lookup) and turn both on everywhere.
async function planner(server, host, cookie) {
  for (const id of ['travel', 'todo']) {
    expect(await call(server, host, 'POST', `/api/modules/bundled/${id}/install`, { cookie, body: {} }), 201, `install ${id}`);
    expect(await call(server, host, 'PATCH', `/api/modules/${id}`, { cookie, body: { enabled: true, allSpaces: true } }), 200, `enable ${id}`);
  }
}
const lookup = (server, host, cookie, q, scope = 'scope=environment') => call(server, host, 'GET', `/api/modules/travel/flight-lookup?${scope}${q ? `&${q}` : ''}`, { cookie });
const remember = (server, host, cookie, object, scope = 'scope=environment') => call(server, host, 'POST', `/api/modules/travel/flight-lookup/remember?${scope}`, { cookie, body: { object } });
const setSuggest = async (server, host, cookie, on) => expect(await call(server, host, 'PUT', '/api/modules/travel/settings/environment', { cookie, body: { values: { suggestFlights: on } } }), 200, `Suggest flights ${on ? 'on' : 'off'}`);

const base = tmp();
try {
  // --- a single install ---
  const singleDir = path.join(base, 'single');
  let single = await startServer(singleDir, { ADMIN_PASSWORD: 'testpass1234' });
  const owner = cookieOf(await call(single, '', 'POST', '/api/login', { body: { login: 'admin', password: 'testpass1234' } }));
  assert.ok(owner, 'the admin signs in');
  const made = await call(single, '', 'POST', '/api/users', { cookie: owner, body: { login: 'pat', displayName: 'Pat', role: 'member', password: 'memberpass1234' } });
  expect(made, 201, 'a member is made');
  const madeSam = await call(single, '', 'POST', '/api/users', { cookie: owner, body: { login: 'sam', displayName: 'Sam', role: 'member', password: 'memberpass1234' } });
  expect(madeSam, 201, 'another member is made');
  const space = (await call(single, '', 'POST', '/api/spaces', { cookie: owner, body: { name: 'Trip', members: [made.json.user.key, madeSam.json.user.key] } })).json.space;
  await planner(single, '', owner);
  const pat = cookieOf(await call(single, '', 'POST', '/api/login', { body: { login: 'pat', password: 'memberpass1234' } }));
  const sam = cookieOf(await call(single, '', 'POST', '/api/login', { body: { login: 'sam', password: 'memberpass1234' } }));
  const guestToken = (await call(single, '', 'POST', `/api/spaces/${space.id}/guest-link`, { cookie: owner, body: {} })).json.space.guestToken;
  const inSpace = `scope=space&space=${encodeURIComponent(space.id)}`;

  await test('single install: a module without `lookups` answers 404, saying why', async () => {
    const r = await call(single, '', 'GET', '/api/modules/todo/flight-lookup?scope=environment', { cookie: owner });
    expect(r, 404, 'the To-do');
    assert.equal(r.json.error, 'This module has no flight lookup.');
    expect(await call(single, '', 'POST', '/api/modules/todo/flight-lookup/remember?scope=environment', { cookie: owner, body: { object: flight() } }), 404, 'the To-do remembering');
  });

  await test('single install: a guest may not look up or remember; nobody signed in neither', async () => {
    const guest = `${inSpace}&guest=${encodeURIComponent(guestToken)}`;
    const r = await lookup(single, '', null, 'number=WN2483&date=2026-11-21', guest);
    expect(r, 403, 'a guest looking up');
    assert.equal(r.json.error, "your role can't do that in this module");
    expect(await remember(single, '', null, flight(), guest), 403, 'a guest remembering');
    expect(await lookup(single, '', null, 'code=MDW', guest), 403, 'a guest asking for an airport');
    expect(await lookup(single, '', null, 'number=WN2483&date=2026-11-21'), 401, 'nobody signed in');
  });

  await test('single install: available, bad number and bad date', async () => {
    const a = await lookup(single, '', pat, '', inSpace);
    expect(a, 200, 'available');
    assert.deepEqual(a.json, { available: true });
    for (const [q, error] of [['number=2483&date=2026-11-21', 'bad number'], ['number=Southwest%202483&date=2026-11-21', 'bad number'], ['number=WN%2024835&date=2026-11-21', 'bad number'], ['number=WN2483', 'bad date'], ['number=WN2483&date=2026-02-30', 'bad date'], ['number=WN2483&date=14%2F11%2F2026', 'bad date']]) {
      const r = await lookup(single, '', pat, q, inSpace);
      expect(r, 400, q);
      assert.deepEqual(r.json, { error }, q);
    }
    const nothing = await lookup(single, '', pat, 'number=WN2483&date=2026-11-21', inSpace);
    expect(nothing, 200, 'nothing known');
    assert.deepEqual(nothing.json, { flights: [] }, 'not found is an answer, not an error');
  });

  await test('single install: a remembered flight comes back on another day; what cannot be kept answers 204 too', async () => {
    const r = await remember(single, '', pat, flight({ title: 'Ada flies home' }, { seat: '14A', gate: 'B12', reference: 'ADA123' }), inSpace);
    expect(r, 204, 'remember');
    assert.equal(r.text, '');
    expect(await remember(single, '', pat, flight({}, { number: 'XX 1', from: { code: 'ZZZ' } }), inSpace), 204, 'an unknown airport');
    expect(await remember(single, '', pat, 'not an object', inSpace), 204, 'not an object');
    expect(await call(single, '', 'POST', `/api/modules/travel/flight-lookup/remember?${inSpace}`, { cookie: pat }), 204, 'no body');
    const found = await lookup(single, '', pat, 'number=wn%202483&date=2026-11-21', inSpace);
    expect(found, 200, 'look up');
    assert.equal(found.json.flights.length, 1);
    const [f] = found.json.flights;
    assert.deepEqual(f.object.details, { airline: 'Southwest Airlines', number: 'WN 2483', from: { code: 'MDW', name: 'Chicago Midway' }, to: { code: 'SJC', name: 'Norman Y. Mineta San Jose' }, departs: '2026-11-21T12:50', arrives: '2026-11-21T15:25', minutes: 275, terminal: '1' });
    assert.equal(f.object.kind, 'flight');
    assert.equal(f.object.date, '2026-11-21');
    assert.equal(f.object.title, 'Flight to San Jose');
    assert.equal(f.line, 'MDW 12:50 to SJC 15:25');
    assert.equal(f.sameWeekday, true);
    assert.equal(f.lastSeen, '2026-11');
    assert.ok(!found.text.includes('14A') && !found.text.includes('B12') && !found.text.includes('ADA123') && !found.text.includes('Ada'), 'nothing of the person comes back');
    const other = await lookup(single, '', sam, 'number=WN2483&date=2026-11-23', 'scope=environment');
    expect(other, 200, 'another member, at environment level');
    assert.equal(other.json.flights[0].sameWeekday, false, 'a Monday');
  });

  await test("single install: the Planner's own Save is kept, and a lookup fills its form's schedule fields only", async () => {
    const L = plannerLib;
    const saved = L.cleanItem({ id: 'p1', kind: 'journey', mode: 'flight', title: 'Pat flies to New York', date: '2026-11-14', time: '08:20', arrives: '2026-11-14T11:15', operator: 'British Airways', number: 'ba117', fromCode: 'lhr', from: 'London Heathrow', toCode: 'JFK', to: 'New York JFK', terminal: '5', gate: 'A10', seat: '22K', travelClass: 'Business', confirm: 'PAT999', cost: 900, notes: 'window please', owners: ['pat'] });
    expect(await remember(single, '', pat, L.flightObject(saved), inSpace), 204, 'what Save sends');
    const r = await lookup(single, '', pat, 'number=BA117&date=2026-11-28', inSpace);
    expect(r, 200, 'BA 117 a fortnight later');
    assert.equal(r.json.flights.length, 1);
    const got = L.lookupFill(L.objectFields(r.json.flights[0].object, L.util));
    assert.deepEqual(got, { date: '2026-11-28', time: '08:20', minutes: 475, arrives: '2026-11-28T11:15', operator: 'British Airways', number: 'BA 117', fromCode: 'LHR', from: 'London Heathrow', toCode: 'JFK', to: 'John F Kennedy', terminal: '5' });
    for (const never of ['A10', '22K', 'Business', 'PAT999', '900', 'window', 'Pat']) assert.equal(r.text.includes(never), false, `${never} never comes back`);
    // Leave the schedule as the tests after this one expect it.
    expect(await call(single, '', 'DELETE', '/api/flight-schedule?number=BA117', { cookie: owner }), 200, 'forget BA 117 again');
  });

  await test('single install: an airport by its code', async () => {
    const r = await lookup(single, '', pat, 'code=mdw', inSpace);
    expect(r, 200, 'MDW');
    assert.deepEqual(r.json, { airport: { code: 'MDW', name: 'Chicago Midway', city: 'Chicago', tz: 'America/Chicago' } });
    const none = await lookup(single, '', pat, 'code=ZZZ', inSpace);
    expect(none, 404, 'ZZZ');
    assert.equal(none.json.error, 'There is no airport with that code.');
  });

  await test('single install: with Suggest flights off nothing is suggested or kept, and the airport list still answers', async () => {
    await setSuggest(single, '', owner, false);
    try {
      assert.deepEqual((await lookup(single, '', pat, '', inSpace)).json, { available: false });
      const r = await lookup(single, '', pat, 'number=WN2483&date=2026-11-21', inSpace);
      expect(r, 200, 'look up with it off');
      assert.deepEqual(r.json, { flights: [] }, 'the schedule is not read');
      assert.deepEqual((await lookup(single, '', pat, 'number=2483&date=2026-11-21', inSpace)).json, { error: 'bad number' }, 'a bad number is still said');
      expect(await remember(single, '', pat, flight({}, { number: 'UA 100', from: { code: 'ORD' }, to: { code: 'LHR' }, departs: '2026-11-14T18:00', arrives: '2026-11-15T08:10' }), inSpace), 204, 'remember with it off');
      expect(await lookup(single, '', pat, 'code=LHR', inSpace), 200, 'an airport with it off');
    } finally {
      await setSuggest(single, '', owner, true);
    }
    assert.deepEqual((await lookup(single, '', pat, 'number=UA100&date=2026-11-21', inSpace)).json, { flights: [] }, 'the flight saved while off was not kept');
    assert.equal((await lookup(single, '', pat, 'number=WN2483&date=2026-11-21', inSpace)).json.flights.length, 1, 'on again, it suggests');
  });

  await test('single install: the file is in DATA_DIR, holding only the schedule', async () => {
    await later(SAVE_WAIT);
    assert.deepEqual(schedulesUnder(singleDir), [path.join(singleDir, FILE_NAME)]);
    const text = fs.readFileSync(path.join(singleDir, FILE_NAME), 'utf8');
    assert.deepEqual(Object.keys(JSON.parse(text).numbers), ['WN2483']);
    for (const never of ['14A', 'B12', 'ADA123', 'Ada', 'pat', space.id]) assert.ok(!text.includes(never), `never "${never}"`);
  });

  await test("single install: the owner's /api/flight-schedule counts, forgets one number and clears all; the host's answer 404", async () => {
    expect(await call(single, '', 'GET', '/api/flight-schedule', { cookie: pat }), 403, 'a member');
    expect(await call(single, '', 'DELETE', '/api/flight-schedule', { cookie: pat }), 403, 'a member clearing');
    expect(await call(single, '', 'GET', '/api/flight-schedule'), 401, 'nobody signed in');
    const counts = await call(single, '', 'GET', '/api/flight-schedule', { cookie: owner });
    expect(counts, 200, 'counts');
    assert.deepEqual(counts.json, { numbers: 1, schedules: 1 });
    for (const method of ['GET', 'DELETE']) {
      const r = await call(single, '', method, '/api/host/flight-schedule', { cookie: owner });
      expect(r, 404, `${method} /api/host/flight-schedule`);
      assert.equal(r.json.error, 'This server has no host console; its flight schedule is at /api/flight-schedule.');
    }
    const bad = await call(single, '', 'DELETE', '/api/flight-schedule?number=Southwest', { cookie: owner });
    expect(bad, 400, 'not a number');
    assert.equal(bad.json.error, 'That is not a flight number; enter the airline code and number, like WN 2483.');
    const unknown = await call(single, '', 'DELETE', '/api/flight-schedule?number=BA%20117', { cookie: owner });
    expect(unknown, 404, 'a number not saved');
    assert.equal(unknown.json.error, 'No flight BA 117 is saved on this server.', 'the number as people write it');
    const forgot = await call(single, '', 'DELETE', '/api/flight-schedule?number=wn%202483', { cookie: owner });
    expect(forgot, 200, 'forget one');
    assert.deepEqual(forgot.json, { removed: 1, numbers: 0, schedules: 0 });
    assert.deepEqual((await lookup(single, '', pat, 'number=WN2483&date=2026-11-21', inSpace)).json, { flights: [] }, 'forgotten');
    expect(await remember(single, '', pat, flight(), inSpace), 204, 'remember again');
    expect(await remember(single, '', pat, flight({}, { number: 'BA 117', from: { code: 'LHR' }, to: { code: 'JFK' }, departs: '2026-11-14T08:20', arrives: '2026-11-14T11:15' }), inSpace), 204, 'and another');
    const cleared = await call(single, '', 'DELETE', '/api/flight-schedule', { cookie: owner });
    expect(cleared, 200, 'clear all');
    assert.deepEqual(cleared.json, { removed: 2, numbers: 0, schedules: 0 });
  });

  await test("single install: past the module's search limit, 429 with the limit's sentence", async () => {
    let r;
    for (let i = 0; i < 41; i += 1) r = await lookup(single, '', sam, 'number=WN2483&date=2026-11-21', inSpace);
    expect(r, 429, 'the 41st lookup in a minute');
    assert.match(r.json.error, /^.+ is busy\. Wait \d+ seconds? and it will carry on\.$/);
    expect(await lookup(single, '', pat, 'number=WN2483&date=2026-11-21', inSpace), 200, 'someone else is not slowed');
  });

  // Moving the install into an environment of a hosted server leaves the schedule at the root, the host's.
  expect(await remember(single, '', pat, flight(), inSpace), 204, 'remember before the move');
  await single.stop();
  await test('a single install moved into a hosted environment keeps its schedule at the root', async () => {
    assert.ok(fs.existsSync(path.join(singleDir, FILE_NAME)), 'written at shutdown');
    const moved = await startServer(singleDir, { BASE_DOMAIN: 'localhost', MIGRATE_ENVIRONMENT_SLUG: 'first', ADMIN_LOGIN: 'host', ADMIN_PASSWORD: 'host-password-1' });
    try {
      assert.deepEqual(schedulesUnder(singleDir), [path.join(singleDir, FILE_NAME)], 'still at the root, not in environments/first');
      const hostCookie = cookieOf(await call(moved, 'admin', 'POST', '/api/host/login', { body: { login: 'host', password: 'host-password-1' } }));
      const counts = await call(moved, 'admin', 'GET', '/api/host/flight-schedule', { cookie: hostCookie });
      expect(counts, 200, 'the host admin counts');
      assert.deepEqual(counts.json, { numbers: 1, schedules: 1 });
    } finally {
      await moved.stop();
    }
  });

  // --- a hosted server, two environments ---
  const hostedDir = path.join(base, 'hosted');
  const hosted = await startServer(hostedDir, { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'host', ADMIN_PASSWORD: 'host-password-1' });
  const hostCookie = cookieOf(await call(hosted, 'admin', 'POST', '/api/host/login', { body: { login: 'host', password: 'host-password-1' } }));
  const owners = {};
  for (const slug of ['acme', 'beta']) {
    const r = await call(hosted, 'admin', 'POST', '/api/host/environments', { cookie: hostCookie, body: { slug, name: slug, owner: { login: 'owner', password: 'owner-password-1' } } });
    expect(r, 201, `make ${slug}`);
    owners[slug] = cookieOf(await call(hosted, slug, 'POST', '/api/login', { body: { login: 'owner', password: 'owner-password-1' } }));
    await planner(hosted, slug, owners[slug]);
  }

  await test('hosted: a flight saved in one environment is found from the other, and the file is the host\'s', async () => {
    expect(await remember(hosted, 'acme', owners.acme, flight()), 204, 'remember in acme');
    const r = await lookup(hosted, 'beta', owners.beta, 'number=WN2483&date=2026-11-21');
    expect(r, 200, 'look up in beta');
    assert.equal(r.json.flights.length, 1);
    assert.equal(r.json.flights[0].line, 'MDW 12:50 to SJC 15:25');
    await later(SAVE_WAIT);
    assert.deepEqual(schedulesUnder(hostedDir), [path.join(hostedDir, FILE_NAME)], 'in the root DATA_DIR, beside host.json, and in neither environment\'s folder');
    assert.ok(fs.existsSync(path.join(hostedDir, 'host.json')));
  });

  await test('hosted: with the setting off in one environment, its saves are not kept and its lookups answer nothing; the other still works', async () => {
    await setSuggest(hosted, 'beta', owners.beta, false);
    assert.deepEqual((await lookup(hosted, 'beta', owners.beta, '')).json, { available: false });
    assert.deepEqual((await lookup(hosted, 'acme', owners.acme, '')).json, { available: true });
    assert.deepEqual((await lookup(hosted, 'beta', owners.beta, 'number=WN2483&date=2026-11-21')).json, { flights: [] });
    expect(await remember(hosted, 'beta', owners.beta, flight({}, { number: 'BA 117', from: { code: 'LHR' }, to: { code: 'JFK' }, departs: '2026-11-14T08:20', arrives: '2026-11-14T11:15' })), 204, 'remember in beta');
    assert.deepEqual((await lookup(hosted, 'acme', owners.acme, 'number=BA117&date=2026-11-21')).json, { flights: [] }, 'beta taught nothing');
    assert.equal((await lookup(hosted, 'acme', owners.acme, 'number=WN2483&date=2026-11-21')).json.flights.length, 1, 'acme still finds');
    expect(await lookup(hosted, 'beta', owners.beta, 'code=JFK'), 200, 'the airport list still answers in beta');
  });

  await test("hosted: an owner's /api/flight-schedule is 404; the host admin's /api/host/flight-schedule counts, forgets and clears", async () => {
    for (const method of ['GET', 'DELETE']) {
      const r = await call(hosted, 'acme', method, '/api/flight-schedule', { cookie: owners.acme });
      expect(r, 404, `an owner's ${method}`);
      assert.equal(r.json.error, 'On a hosted server the flight schedule is shared by every environment, so only the host console can see or clear it.');
      const there = await call(hosted, 'acme', method, '/api/host/flight-schedule', { cookie: owners.acme });
      expect(there, 404, `${method} /api/host/flight-schedule at an environment's address`);
      assert.equal(there.json.error, 'The flight schedule is cleared from the host console.');
    }
    expect(await call(hosted, 'admin', 'GET', '/api/host/flight-schedule'), 401, 'nobody signed in at the console');
    assert.deepEqual((await call(hosted, 'admin', 'GET', '/api/host/flight-schedule', { cookie: hostCookie })).json, { numbers: 1, schedules: 1 });
    expect(await remember(hosted, 'acme', owners.acme, flight({}, { number: 'BA 117', from: { code: 'LHR' }, to: { code: 'JFK' }, departs: '2026-11-14T08:20', arrives: '2026-11-14T11:15' })), 204, 'remember in acme');
    const forgot = await call(hosted, 'admin', 'DELETE', '/api/host/flight-schedule?number=WN2483', { cookie: hostCookie });
    expect(forgot, 200, 'forget one');
    assert.deepEqual(forgot.json, { removed: 1, numbers: 1, schedules: 1 });
    expect(await call(hosted, 'admin', 'DELETE', '/api/host/flight-schedule?number=WN2483', { cookie: hostCookie }), 404, 'forgotten already');
    const cleared = await call(hosted, 'admin', 'DELETE', '/api/host/flight-schedule', { cookie: hostCookie });
    expect(cleared, 200, 'clear all');
    assert.deepEqual(cleared.json, { removed: 1, numbers: 0, schedules: 0 });
    assert.deepEqual((await lookup(hosted, 'acme', owners.acme, 'number=BA117&date=2026-11-21')).json, { flights: [] });
  });
} catch (err) {
  failures.push(`the servers: ${err.stack || err.message}`);
} finally {
  for (const s of servers) await s.stop();
  fs.rmSync(base, { recursive: true, force: true });
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`check-flight-lookup: ${failures.length} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-flight-lookup: ${n} checks passed`);
