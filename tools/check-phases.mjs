#!/usr/bin/env node
/*
 * check-phases.mjs -- the phase timeline (documentation/plans/plan-one-bar.md, step 1): the pure rule in
 * public/phases.js run in node (contiguity refusals, a skipped undated phase, coverMain shifting later boundaries by
 * the same days and never moving an earlier one, chipWords before, during and after the main phase, no phases at
 * all, the status strip's storyWords for each row of plan-space-story-strip.md's words table, and countdown), then the routes on a throwaway server (PORT=0, DATA_DIR under the system tmpdir, stopped by its pid): a space
 * carries `phases`, PATCH /api/spaces/:id { phases } for the admin and a moderator (and, for Set up, step 4, a
 * moderator's `opensWith` and `defaultLayout` and nothing else), refused for a member, each refusal
 * with its sentence, POST /api/spaces/:id/phases/cover for a member who can write in a module on in the space, and
 * the stored key.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Days are counted in UTC here and on the server it starts, so the created day is the same on both sides.
process.env.TZ = 'UTC';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const P = require('../public/phases.js');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-phases: ${name}: ${err.stack || err.message}`); }
};

// The travel template's phases, as server/templates.js gives them.
const TRAVEL = [
  { id: 'planning', label: 'Planning' }, { id: 'booking', label: 'Booking' }, { id: 'buffer', label: 'Buffer' },
  { id: 'pre-trip', label: 'Pre-trip' }, { id: 'trip', label: 'Trip', main: true }, { id: 'post-trip', label: 'Post-trip' },
];
const CREATED = '2026-09-01T12:00:00.000Z';
const band = (b) => [b.id, b.start, b.end, b.dated, b.current];

// --- the pure rule ------------------------------------------------------------------------------------------------

await test('days: real days only, arithmetic, a moment read as its UTC day', () => {
  assert.deepEqual(['2026-02-29', '2026-13-01', '2026-2-1', 20260201, '', null].map(P.isDay), [false, false, false, false, false, false]);
  assert.deepEqual(['2024-02-29', '2026-10-13'].map(P.isDay), [true, true]);
  assert.equal(P.addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(P.daysBetween('2026-10-01', '2026-10-13'), 12);
  assert.equal(P.daysBetween('2026-10-13', '2026-10-01'), -12);
  assert.equal(P.dayOf('2026-09-01'), '2026-09-01');
  assert.equal(P.dayOf(CREATED), P.dayOf(new Date(CREATED)), 'a moment, as a day');
  assert.equal(P.dayOf('nope'), null);
  assert.equal(P.dayOf('2026-10-14T03:00:00.000Z'), '2026-10-14', 'the UTC day');
  assert.equal(P.dayOf(new Date('2026-10-14T23:30:00.000Z')), '2026-10-14', 'a Date, the UTC day');
});

// The created day is the same for the server and every viewer, whatever the process timezone: the pure rule run in
// node under several zones (TZ is read when the process starts, so each zone is its own process) for spaces created
// near midnight UTC gives the same answers, and the first phase starts on the UTC day.
await test('the created day does not depend on the timezone', () => {
  const script = `
    const P = require(${JSON.stringify(path.join(ROOT, 'public', 'phases.js'))});
    const T = ${JSON.stringify(TRAVEL)};
    const out = {};
    for (const created of ['2026-10-14T03:00:00.000Z', '2026-10-14T07:54:00.000Z', '2026-10-14T23:30:00.000Z']) {
      out[created] = {
        day: P.dayOf(created),
        dayOfDate: P.dayOf(new Date(created)),
        first: P.timelineOf(T, {}, { created })[0].start,
        sameDay: P.problemOf(T, { booking: { start: '2026-10-14' } }, { created }),
        nextDay: P.problemOf(T, { booking: { start: '2026-10-15' } }, { created }),
        add: P.addDatesFor(T, {}, 'booking', { created, today: '2026-10-14' }),
      };
    }
    process.stdout.write(JSON.stringify(out));`;
  const zones = ['UTC', 'America/Los_Angeles', 'Etc/GMT+12', 'Etc/GMT-14', 'Asia/Kolkata'];
  const runs = zones.map((TZ) => [TZ, JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { PATH: process.env.PATH, TZ }, encoding: 'utf8' }))]);
  for (const [TZ, got] of runs) assert.deepEqual(got, runs[0][1], `${TZ} answers as UTC does`);
  for (const at of Object.values(runs[0][1])) {
    assert.deepEqual([at.day, at.dayOfDate, at.first], ['2026-10-14', '2026-10-14', '2026-10-14']);
    assert.equal(at.sameDay, 'Booking must start after Planning starts, 2026-10-14.');
    assert.equal(at.nextDay, null);
  }
});

await test('timelineOf: the first phase starts on the created day, a boundary is the first day of the next phase, the last dated band is open-ended unless it is main', () => {
  const bands = P.timelineOf(TRAVEL, { booking: { start: '2026-09-10' }, trip: { start: '2026-10-01', end: '2026-10-07' } }, { today: '2026-09-12', created: CREATED });
  assert.deepEqual(bands.map(band), [
    ['planning', P.dayOf(CREATED), '2026-09-09', true, false],
    ['booking', '2026-09-10', '2026-09-30', true, true],
    ['buffer', null, null, false, false],
    ['pre-trip', null, null, false, false],
    ['trip', '2026-10-01', '2026-10-07', true, false],
    ['post-trip', null, null, false, false],
  ]);
  assert.deepEqual(bands.map((b) => [b.label, b.main]), [['Planning', false], ['Booking', false], ['Buffer', false], ['Pre-trip', false], ['Trip', true], ['Post-trip', false]]);
  // Booking's band runs to the day before Trip starts: the undated Buffer and Pre-trip have zero width and are skipped.
  // A dated last phase that is not main is open-ended; a main last phase without an end is open-ended too.
  const open = P.timelineOf(TRAVEL, { trip: { start: '2026-10-01', end: '2026-10-07' }, 'post-trip': { start: '2026-10-08' } }, { today: '2026-10-20', created: CREATED });
  assert.deepEqual(open.map(band).filter((b) => b[3]), [['planning', P.dayOf(CREATED), '2026-09-30', true, false], ['trip', '2026-10-01', '2026-10-07', true, false], ['post-trip', '2026-10-08', null, true, true]]);
  const mainLast = P.timelineOf([{ id: 'plan', label: 'Plan' }, { id: 'go', label: 'Go', main: true }], { go: { start: '2026-10-01' } }, { today: '2026-12-01', created: CREATED });
  assert.deepEqual(mainLast.map(band), [['plan', P.dayOf(CREATED), '2026-09-30', true, false], ['go', '2026-10-01', null, true, true]]);
  // Nothing dated: the first phase from the created day, open-ended; without a created day nothing is dated.
  assert.deepEqual(P.timelineOf(TRAVEL, {}, { today: '2026-10-01', created: CREATED }).map(band)[0], ['planning', P.dayOf(CREATED), null, true, true]);
  assert.deepEqual(P.timelineOf(TRAVEL, {}, { today: '2026-10-01' }).map((b) => b.dated), [false, false, false, false, false, false]);
  assert.deepEqual(P.timelineOf([], {}, { today: '2026-10-01', created: CREATED }), [], 'no phases, no bands');
  assert.deepEqual(P.timelineOf(TRAVEL, { trip: { start: '2026-10-01' } }, { created: CREATED }).map((b) => b.current), [false, false, false, false, false, false], 'no today, nothing current');
});

await test('problemOf: the refusals, each one sentence', () => {
  const problem = (dates, extra) => P.problemOf(TRAVEL, dates, { created: CREATED, ...extra });
  assert.equal(problem({}), null);
  assert.equal(problem({ booking: { start: '2026-09-10' }, trip: { start: '2026-10-01', end: '2026-10-07' }, 'post-trip': { start: '2026-10-08' } }), null);
  assert.equal(problem({ nope: { start: '2026-09-10' } }), 'There is no phase called "nope".');
  assert.equal(problem(JSON.parse('{"__proto__":{"start":"2026-09-10"}}')), 'There is no phase called "__proto__".', 'an own key named like a built-in');
  assert.equal(problem(JSON.parse('{"constructor":{"start":"2026-09-10"}}')), 'There is no phase called "constructor".');
  assert.equal(problem({ booking: { start: '2026-09-10', end: '2026-09-20' } }), 'Only Trip, the main phase, and the last phase have an end.');
  assert.equal(P.problemOf([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], { a: { end: '2026-09-20' } }, { created: CREATED }), 'Only the last phase has an end.');
  assert.equal(P.problemOf([{ id: 'a', label: 'A' }], { a: { end: '2026-09-20' } }, { created: CREATED }), null, 'the only phase is the last one: it may have an end');
  // The last phase may have an end of its own, after its start, and nothing may follow it.
  assert.equal(problem({ trip: { start: '2026-10-01', end: '2026-10-07' }, 'post-trip': { start: '2026-10-08', end: '2026-10-25' } }), null, 'Post-trip given an end');
  assert.equal(problem({ trip: { start: '2026-10-01', end: '2026-10-07' }, 'post-trip': { start: '2026-10-08', end: '2026-10-07' } }), 'Post-trip can\'t end before it starts, 2026-10-08.');
  assert.equal(problem({ booking: { start: '10/09/2026' } }), 'Booking\'s start must be a day written as YYYY-MM-DD.');
  assert.equal(problem({ trip: { start: '2026-10-01', end: '2026-02-30' } }), 'Trip\'s end must be a day written as YYYY-MM-DD.');
  assert.equal(problem({ booking: { begins: '2026-09-10' } }), 'Booking\'s dates are start and end.');
  assert.equal(problem({ booking: 'soon' }), 'Booking\'s dates are start and end.');
  assert.equal(problem('soon'), 'Phases must be a set of dates by phase id.');
  assert.equal(problem({ trip: { end: '2026-10-07' } }), 'Set when Trip starts before its end.');
  assert.equal(problem({ trip: { start: '2026-10-07', end: '2026-10-01' } }), 'Trip can\'t end before it starts, 2026-10-07.');
  assert.equal(problem({ trip: { start: '2026-10-01', end: '2026-10-01' } }), null, 'a one-day main phase');
  // Not after the previous boundary: the same day, or earlier.
  assert.equal(problem({ booking: { start: '2026-09-10' }, buffer: { start: '2026-09-10' } }), 'Buffer must start after Booking starts, 2026-09-10.');
  assert.equal(problem({ booking: { start: '2026-09-10' }, trip: { start: '2026-09-05' } }), 'Trip must start after Booking starts, 2026-09-10.');
  assert.equal(problem({ planning: { start: '2026-09-20' }, booking: { start: '2026-09-10' } }), 'Booking must start after Planning starts, 2026-09-20.');
  assert.equal(problem({ trip: { start: '2026-10-01', end: '2026-10-07' }, 'post-trip': { start: '2026-10-07' } }), 'Post-trip must start after Trip ends, 2026-10-07.');
  // The first phase's start may be before the created day (there is no boundary before it).
  assert.equal(problem({ planning: { start: '2026-08-01' } }), null);
  // Read from the moved phase's side: not before the next.
  assert.equal(problem({ booking: { start: '2026-09-10' }, trip: { start: '2026-09-05' } }, { moved: 'booking' }), 'Booking must start before Trip starts, 2026-09-05.');
  assert.equal(problem({ trip: { start: '2026-10-01', end: '2026-10-09' }, 'post-trip': { start: '2026-10-08' } }, { moved: 'trip' }), 'Trip must end before Post-trip starts, 2026-10-08.');
  assert.equal(P.problemOf([], { trip: { start: '2026-10-01' } }, { created: CREATED }), 'There is no phase called "trip".', 'a space whose template has no phases');
});

await test('moveBoundary: a start or the main end, refused with the sentence and nothing changed, cleared with null', () => {
  const dates = { booking: { start: '2026-09-10' }, trip: { start: '2026-10-01', end: '2026-10-07' } };
  const ok = P.moveBoundary(TRAVEL, dates, { id: 'booking' }, '2026-09-12', { created: CREATED });
  assert.deepEqual(ok, { ok: true, dates: { booking: { start: '2026-09-12' }, trip: { start: '2026-10-01', end: '2026-10-07' } } });
  assert.deepEqual(P.moveBoundary(TRAVEL, dates, 'booking', '2026-10-01', { created: CREATED }), { ok: false, problem: 'Booking must start before Trip starts, 2026-10-01.' });
  assert.deepEqual(P.moveBoundary(TRAVEL, dates, { id: 'booking' }, P.dayOf(CREATED), { created: CREATED }), { ok: false, problem: `Booking must start after Planning starts, ${P.dayOf(CREATED)}.` });
  assert.deepEqual(P.moveBoundary(TRAVEL, dates, { id: 'trip', edge: 'end' }, '2026-10-20', { created: CREATED }).dates.trip, { start: '2026-10-01', end: '2026-10-20' });
  assert.deepEqual(P.moveBoundary(TRAVEL, dates, { id: 'booking', edge: 'end' }, '2026-09-20', { created: CREATED }), { ok: false, problem: 'Only Trip, the main phase, and the last phase have an end.' });
  assert.deepEqual(P.moveBoundary(TRAVEL, dates, { id: 'booking' }, null, { created: CREATED }).dates, { trip: { start: '2026-10-01', end: '2026-10-07' } }, 'cleared');
  assert.deepEqual(P.moveBoundary(TRAVEL, dates, { id: 'trip', edge: 'end' }, null, { created: CREATED }).dates.trip, { start: '2026-10-01' });
  assert.deepEqual(dates, { booking: { start: '2026-09-10' }, trip: { start: '2026-10-01', end: '2026-10-07' } }, 'the given dates are not touched');
});

await test('moveBoundary keeps the timeline contiguous: the main end and the next dated start are one boundary', () => {
  const dates = { trip: { start: '2026-10-01', end: '2026-10-07' }, 'post-trip': { start: '2026-10-08' } };
  // The main end moved: the next dated phase starts the day after, later or earlier.
  assert.deepEqual(P.moveBoundary(TRAVEL, dates, { id: 'trip', edge: 'end' }, '2026-10-12', { created: CREATED }).dates, { trip: { start: '2026-10-01', end: '2026-10-12' }, 'post-trip': { start: '2026-10-13' } });
  assert.deepEqual(P.moveBoundary(TRAVEL, dates, { id: 'trip', edge: 'end' }, '2026-10-03', { created: CREATED }).dates, { trip: { start: '2026-10-01', end: '2026-10-03' }, 'post-trip': { start: '2026-10-04' } });
  // The next dated start moved: the main phase ends the day before.
  assert.deepEqual(P.moveBoundary(TRAVEL, dates, { id: 'post-trip' }, '2026-10-20', { created: CREATED }).dates, { trip: { start: '2026-10-01', end: '2026-10-19' }, 'post-trip': { start: '2026-10-20' } });
  // Moved onto the main phase's first day: the end would come before the start, refused.
  assert.deepEqual(P.moveBoundary(TRAVEL, dates, { id: 'post-trip' }, '2026-10-01', { created: CREATED }), { ok: false, problem: 'Trip can\'t end before it starts, 2026-10-01.' });
  // A later phase dated for the first time: the main end follows it too (the moved side wins).
  assert.deepEqual(P.moveBoundary(TRAVEL, { trip: { start: '2026-10-01', end: '2026-10-07' } }, { id: 'post-trip' }, '2026-10-20', { created: CREATED }).dates, { trip: { start: '2026-10-01', end: '2026-10-19' }, 'post-trip': { start: '2026-10-20' } });
  // An earlier boundary moved: the shared boundary stays as it is.
  assert.deepEqual(P.moveBoundary(TRAVEL, dates, { id: 'booking' }, '2026-09-10', { created: CREATED }).dates, { booking: { start: '2026-09-10' }, ...dates });
  // The phase after the main one cleared: the next dated phase after it takes the shared boundary.
  const three = { trip: { start: '2026-10-01', end: '2026-10-07' }, 'post-trip': { start: '2026-10-08' } };
  const twoMain = [{ id: 'go', label: 'Go', main: true }, { id: 'rest', label: 'Rest' }, { id: 'after', label: 'After' }];
  const cleared = P.moveBoundary(twoMain, { go: { end: '2026-10-07' }, rest: { start: '2026-10-08' }, after: { start: '2026-10-20' } }, { id: 'rest' }, null, { created: CREATED });
  assert.deepEqual(cleared, { ok: true, dates: { go: { end: '2026-10-07' }, after: { start: '2026-10-08' } } });
  // Without a main end the next start is the only boundary and moves on its own.
  const noEnd = { trip: { start: '2026-10-01' }, 'post-trip': { start: '2026-10-08' } };
  assert.deepEqual(P.moveBoundary(TRAVEL, noEnd, { id: 'post-trip' }, '2026-10-20', { created: CREATED }).dates, { trip: { start: '2026-10-01' }, 'post-trip': { start: '2026-10-20' } });
  for (const d of [three, noEnd]) assert.equal(P.problemOf(TRAVEL, d, { created: CREATED }), null);
});

// The sheet's rows (public/phase-sheet.js): setPhaseDate, addDatesFor and skipPhase, each pure, each keeping the
// timeline contiguous and refusing with one sentence.
const c0 = P.dayOf(CREATED); // 2026-09-01, the first phase's own start when it has none
const setDate = (dates, id, edge, day) => P.setPhaseDate(TRAVEL, dates, id, edge, day, { created: CREATED });
const contiguous = (dates) => {
  assert.equal(P.problemOf(TRAVEL, dates, { created: CREATED }), null, 'the server takes it');
  const bands = P.timelineOf(TRAVEL, dates, { created: CREATED }).filter((b) => b.dated);
  for (let i = 1; i < bands.length; i += 1) assert.equal(bands[i].start, P.addDays(bands[i - 1].end, 1), `${bands[i].label} starts the day after ${bands[i - 1].label} ends`);
};

await test('setPhaseDate: an end moved moves the next dated start to the day after; the main end the same way', () => {
  const dates = { booking: { start: '2026-09-10' }, trip: { start: '2026-10-01', end: '2026-10-07' }, 'post-trip': { start: '2026-10-08' } };
  // Planning's end (Sep 9) moved to Sep 14: Booking starts Sep 15.
  let r = setDate(dates, 'planning', 'end', '2026-09-14');
  assert.deepEqual(r, { ok: true, dates: { ...dates, booking: { start: '2026-09-15' } } });
  contiguous(r.dates);
  // Booking's end (Sep 30) moved earlier to Sep 20: Trip starts Sep 21, its end stays.
  r = setDate(dates, 'booking', 'end', '2026-09-20');
  assert.deepEqual(r.dates, { ...dates, trip: { start: '2026-09-21', end: '2026-10-07' } });
  contiguous(r.dates);
  // Trip's end (main) moved to Oct 12: Post-trip starts Oct 13.
  r = setDate(dates, 'trip', 'end', '2026-10-12');
  assert.deepEqual(r.dates, { ...dates, trip: { start: '2026-10-01', end: '2026-10-12' }, 'post-trip': { start: '2026-10-13' } });
  contiguous(r.dates);
  // Skipped phases between stay skipped: Booking's end moved with Buffer and Pre-trip undated moves Trip, not them.
  assert.deepEqual(Object.keys(setDate(dates, 'booking', 'end', '2026-09-25').dates).sort(), ['booking', 'post-trip', 'trip']);
  assert.deepEqual(dates, { booking: { start: '2026-09-10' }, trip: { start: '2026-10-01', end: '2026-10-07' }, 'post-trip': { start: '2026-10-08' } }, 'the given dates are not touched');
});

await test('setPhaseDate: a start moved moves the previous dated end to the day before; the first start is its own', () => {
  const dates = { booking: { start: '2026-09-10' }, trip: { start: '2026-10-01', end: '2026-10-07' }, 'post-trip': { start: '2026-10-08' } };
  // Booking starts Sep 12: Planning ends Sep 11 (derived; nothing else stored).
  let r = setDate(dates, 'booking', 'start', '2026-09-12');
  assert.deepEqual(r.dates, { ...dates, booking: { start: '2026-09-12' } });
  assert.equal(P.timelineOf(TRAVEL, r.dates, { created: CREATED })[0].end, '2026-09-11');
  // Post-trip starts Oct 10: Trip (main, the previous dated phase) ends Oct 9.
  r = setDate(dates, 'post-trip', 'start', '2026-10-10');
  assert.deepEqual(r.dates, { ...dates, trip: { start: '2026-10-01', end: '2026-10-09' }, 'post-trip': { start: '2026-10-10' } });
  contiguous(r.dates);
  // The first phase's start is its own: set to Aug 20, before the created day; nothing else moves.
  r = setDate(dates, 'planning', 'start', '2026-08-20');
  assert.deepEqual(r.dates, { planning: { start: '2026-08-20' }, ...dates });
  contiguous(r.dates);
  assert.equal(P.timelineOf(TRAVEL, {}, { created: CREATED })[0].start, c0, 'with none of its own it starts on the created day');
});

await test('setPhaseDate: the refusals, each one sentence and nothing changed', () => {
  const dates = { booking: { start: '2026-09-10' }, trip: { start: '2026-10-01', end: '2026-10-07' }, 'post-trip': { start: '2026-10-08' } };
  const refused = (id, edge, day, problem) => assert.deepEqual(setDate(dates, id, edge, day), { ok: false, problem }, `${id} ${edge} ${day}`);
  refused('booking', 'end', '2026-09-09', 'Booking can\'t end before it starts, 2026-09-10.');
  refused('trip', 'end', '2026-09-30', 'Trip can\'t end before it starts, 2026-10-01.');
  refused('booking', 'start', '2026-10-01', 'Booking can\'t start after it ends, 2026-09-30.');
  refused('trip', 'start', '2026-10-08', 'Trip can\'t start after it ends, 2026-10-07.');
  refused('booking', 'start', '2026-09-01', 'Booking must start after Planning starts, 2026-09-01.');
  refused('booking', 'start', '2026-08-20', 'Booking must start after Planning starts, 2026-09-01.');
  // An end that would push the next phase past its own end.
  refused('booking', 'end', '2026-10-07', 'Trip can\'t start after it ends, 2026-10-07.');
  refused('planning', 'end', '2026-09-30', 'Booking can\'t start after it ends, 2026-09-30.');
  refused('post-trip', 'end', '2026-10-07', 'Post-trip can\'t end before it starts, 2026-10-08.');
  refused('booking', 'end', null, 'Booking ends the day before the next phase starts.');
  refused('buffer', 'end', '2026-09-20', 'Set when Buffer starts first.');
  refused('booking', 'end', 'soon', 'Booking\'s end must be a day written as YYYY-MM-DD.');
  refused('nope', 'start', '2026-09-20', 'There is no phase called "nope".');
  assert.equal(setDate(dates, 'trip', 'end', '2026-10-01').ok, true, 'a one-day main phase');
  assert.equal(setDate(dates, 'booking', 'end', '2026-09-10').ok, true, 'a one-day phase');
});

await test('setPhaseDate: the last phase takes an end of its own, and gives it up again; the timeline stays contiguous', () => {
  const dates = { booking: { start: '2026-09-10' }, trip: { start: '2026-10-01', end: '2026-10-07' }, 'post-trip': { start: '2026-10-08' } };
  const ended = setDate(dates, 'post-trip', 'end', '2026-10-25');
  assert.deepEqual(ended, { ok: true, dates: { ...dates, 'post-trip': { start: '2026-10-08', end: '2026-10-25' } } });
  contiguous(ended.dates);
  const bands = P.timelineOf(TRAVEL, ended.dates, { created: CREATED, today: '2026-10-12' });
  assert.deepEqual(bands.map(band).filter((b) => b[3]).pop(), ['post-trip', '2026-10-08', '2026-10-25', true, true], 'Post-trip now runs to its end');
  assert.equal(P.setPhaseDate(TRAVEL, ended.dates, 'post-trip', 'end', '2026-10-08', { created: CREATED }).ok, true, 'a one-day last phase');
  // The main end moved later moves Post-trip's start, its own end kept; moved past it, refused.
  assert.deepEqual(setDate(ended.dates, 'trip', 'end', '2026-10-09').dates['post-trip'], { start: '2026-10-10', end: '2026-10-25' });
  assert.deepEqual(setDate(ended.dates, 'trip', 'end', '2026-10-25'), { ok: false, problem: 'Post-trip can\'t start after it ends, 2026-10-25.' });
  // The start of the last phase may not pass its end.
  assert.deepEqual(setDate(ended.dates, 'post-trip', 'start', '2026-10-26'), { ok: false, problem: 'Post-trip can\'t start after it ends, 2026-10-25.' });
  // Cleared: back to open-ended, nothing else touched; clearing an open one changes nothing.
  const cleared = P.setPhaseDate(TRAVEL, ended.dates, 'post-trip', 'end', '', { created: CREATED });
  assert.deepEqual(cleared, { ok: true, dates });
  assert.deepEqual(P.setPhaseDate(TRAVEL, ended.dates, 'post-trip', 'end', null, { created: CREATED }), cleared);
  assert.deepEqual(P.setPhaseDate(TRAVEL, dates, 'post-trip', 'end', '', { created: CREATED }), { ok: true, dates });
  // The main phase's end clears too (open-ended again), Post-trip's start staying.
  assert.deepEqual(P.setPhaseDate(TRAVEL, dates, 'trip', 'end', '', { created: CREATED }).dates, { booking: { start: '2026-09-10' }, trip: { start: '2026-10-01' }, 'post-trip': { start: '2026-10-08' } });
  // A last phase that is main keeps working, and a last phase with no start of its own can't take an end first.
  const mainLast = [{ id: 'plan', label: 'Plan' }, { id: 'go', label: 'Go', main: true }];
  assert.deepEqual(P.setPhaseDate(mainLast, { go: { start: '2026-10-01' } }, 'go', 'end', '2026-10-05', { created: CREATED }).dates, { go: { start: '2026-10-01', end: '2026-10-05' } });
  assert.deepEqual(setDate({ trip: { start: '2026-10-01', end: '2026-10-07' } }, 'post-trip', 'end', '2026-10-25'), { ok: false, problem: 'Set when Post-trip starts first.' });
  // The server's rule (problemOf) takes the same dates.
  assert.equal(P.problemOf(TRAVEL, ended.dates, { created: CREATED }), null);
  // Skipping the ended last phase drops its end with its start.
  const { 'post-trip': _gone, ...without } = dates;
  assert.deepEqual(P.skipPhase(TRAVEL, ended.dates, 'post-trip', { created: CREATED }), { ok: true, dates: without });
});

await test('the phases\' colours: one name per place in the template, on every band', () => {
  assert.deepEqual(P.TINTS, ['blue', 'green', 'teal', 'purple', 'orange', 'pink', 'gold', 'red']);
  assert.deepEqual([0, 7, 8, -1].map(P.tintOf), ['blue', 'red', 'blue', 'red']);
  const bands = P.timelineOf(TRAVEL, { trip: { start: '2026-10-01' } }, { created: CREATED });
  assert.deepEqual(bands.map((b) => b.tint), ['blue', 'green', 'teal', 'purple', 'orange', 'pink'], 'dated or not, a phase keeps its colour');
});

await test('setPhaseDate: an end on the last dated phase starts the next phase in order; all six Travel phases dated in one pass', () => {
  // From nothing: Planning starts on the created day; its end starts Booking the day after, and so on down the list.
  let dates = {};
  dates = setDate(dates, 'planning', 'end', '2026-09-10').dates;
  assert.deepEqual(dates, { booking: { start: '2026-09-11' } });
  dates = setDate(dates, 'booking', 'end', '2026-09-20').dates;
  dates = setDate(dates, 'buffer', 'end', '2026-09-25').dates;
  dates = setDate(dates, 'pre-trip', 'end', '2026-09-30').dates;
  assert.deepEqual(dates, { booking: { start: '2026-09-11' }, buffer: { start: '2026-09-21' }, 'pre-trip': { start: '2026-09-26' }, trip: { start: '2026-10-01' } });
  dates = setDate(dates, 'trip', 'end', '2026-10-07').dates;
  assert.deepEqual(dates.trip, { start: '2026-10-01', end: '2026-10-07' });
  assert.deepEqual(dates['post-trip'], { start: '2026-10-08' }, 'the main end set starts Post-trip too');
  contiguous(dates);
  const bands = P.timelineOf(TRAVEL, dates, { created: CREATED, today: '2026-10-03' });
  assert.deepEqual(bands.map(band), [
    ['planning', c0, '2026-09-10', true, false], ['booking', '2026-09-11', '2026-09-20', true, false], ['buffer', '2026-09-21', '2026-09-25', true, false],
    ['pre-trip', '2026-09-26', '2026-09-30', true, false], ['trip', '2026-10-01', '2026-10-07', true, true], ['post-trip', '2026-10-08', null, true, false],
  ]);
  assert.equal(P.chipWords(bands, '2026-10-03'), 'Trip · day 3 of 7');
  // The main end moved later afterwards keeps Post-trip on it, and coverMain still works on the result.
  const later = setDate(dates, 'trip', 'end', '2026-10-09').dates;
  assert.deepEqual(later['post-trip'], { start: '2026-10-10' });
  assert.deepEqual(P.coverMain(TRAVEL, later, '2026-10-15', { created: CREATED }).dates['post-trip'], { start: '2026-10-16' });
  // The first start set first, then the ends: the same.
  let own = setDate({}, 'planning', 'start', '2026-09-05').dates;
  own = setDate(own, 'planning', 'end', '2026-09-10').dates;
  assert.deepEqual(own, { planning: { start: '2026-09-05' }, booking: { start: '2026-09-11' } });
  // An undated phase given a start directly is dated from it (the rule holds the order).
  assert.deepEqual(setDate({ trip: { start: '2026-10-01', end: '2026-10-07' } }, 'booking', 'start', '2026-09-20').dates, { booking: { start: '2026-09-20' }, trip: { start: '2026-10-01', end: '2026-10-07' } });
  assert.equal(setDate({ trip: { start: '2026-10-01', end: '2026-10-07' } }, 'booking', 'start', '2026-10-01').ok, false);
});

await test('skipPhase: the dates cleared, the neighbours joined, the first phase never', () => {
  const dates = { booking: { start: '2026-09-10' }, buffer: { start: '2026-09-20' }, trip: { start: '2026-10-01', end: '2026-10-07' }, 'post-trip': { start: '2026-10-08' } };
  let r = P.skipPhase(TRAVEL, dates, 'buffer', { created: CREATED });
  assert.deepEqual(r, { ok: true, dates: { booking: { start: '2026-09-10' }, trip: { start: '2026-10-01', end: '2026-10-07' }, 'post-trip': { start: '2026-10-08' } } });
  assert.equal(P.timelineOf(TRAVEL, r.dates, { created: CREATED })[1].end, '2026-09-30', 'Booking now runs to the day before Trip');
  contiguous(r.dates);
  // The main phase skipped: its end goes too; Buffer runs to the day before Post-trip.
  r = P.skipPhase(TRAVEL, dates, 'trip', { created: CREATED });
  assert.deepEqual(r.dates, { booking: { start: '2026-09-10' }, buffer: { start: '2026-09-20' }, 'post-trip': { start: '2026-10-08' } });
  assert.equal(P.timelineOf(TRAVEL, r.dates, { created: CREATED })[2].end, '2026-10-07');
  contiguous(r.dates);
  // The phase after the main one skipped: the main end stays, and the next dated phase after it starts the day after.
  const six = { ...dates, 'post-trip': { start: '2026-10-08' } };
  const twoAfter = [{ id: 'go', label: 'Go', main: true }, { id: 'rest', label: 'Rest' }, { id: 'after', label: 'After' }];
  assert.deepEqual(P.skipPhase(twoAfter, { go: { end: '2026-10-07' }, rest: { start: '2026-10-08' }, after: { start: '2026-10-20' } }, 'rest', { created: CREATED }).dates, { go: { end: '2026-10-07' }, after: { start: '2026-10-08' } });
  assert.deepEqual(P.skipPhase(TRAVEL, six, 'post-trip', { created: CREATED }).dates.trip, { start: '2026-10-01', end: '2026-10-07' }, 'the last phase skipped: the main end stays');
  assert.deepEqual(P.skipPhase(TRAVEL, dates, 'planning', { created: CREATED }), { ok: false, problem: 'Planning is the first phase and can\'t be skipped.' });
  assert.deepEqual(P.skipPhase(TRAVEL, dates, 'pre-trip', { created: CREATED }), { ok: true, dates }, 'already skipped: nothing changes');
  assert.deepEqual(P.skipPhase(TRAVEL, dates, 'nope', { created: CREATED }).ok, false);
});

await test('addDatesFor: a skipped phase given dates, nothing else shifted', () => {
  const dates = { booking: { start: '2026-09-10' }, trip: { start: '2026-10-01', end: '2026-10-07' }, 'post-trip': { start: '2026-10-08' } };
  const add = (d, id, extra) => P.addDatesFor(TRAVEL, d, id, { created: CREATED, today: '2026-10-13', ...extra });
  // Before a later dated phase: the seven days just before Trip; Booking keeps the rest.
  let r = add(dates, 'buffer');
  assert.deepEqual(r, { ok: true, dates: { ...dates, buffer: { start: '2026-09-24' } } });
  assert.deepEqual(P.timelineOf(TRAVEL, r.dates, { created: CREATED }).slice(1, 3).map(band), [['booking', '2026-09-10', '2026-09-23', true, false], ['buffer', '2026-09-24', '2026-09-30', true, false]]);
  contiguous(r.dates);
  assert.equal(add(dates, 'buffer', { days: 3 }).dates.buffer.start, '2026-09-28', 'a length of its own');
  // The previous phase keeps at least one day: Booking Sep 10, Trip Oct 1 leaves 20 days; with Trip on Sep 12, 1 day.
  assert.equal(add({ booking: { start: '2026-09-10' }, trip: { start: '2026-09-12', end: '2026-09-20' } }, 'buffer').dates.buffer.start, '2026-09-11');
  assert.deepEqual(add({ booking: { start: '2026-09-10' }, trip: { start: '2026-09-11', end: '2026-09-20' } }, 'buffer'), { ok: false, problem: 'There are no free days for Buffer between Booking and Trip.' });
  // After the main phase's end, nothing dated after it: the day after the end, open-ended.
  r = add({ trip: { start: '2026-10-01', end: '2026-10-07' } }, 'post-trip');
  assert.deepEqual(r.dates['post-trip'], { start: '2026-10-08' });
  contiguous(r.dates);
  // After an open-ended phase that has begun: from today; one not begun: a week after it starts.
  assert.deepEqual(add({}, 'booking').dates, { booking: { start: '2026-10-13' } }, 'Planning began on the created day: Booking from today');
  assert.deepEqual(add({ planning: { start: '2026-11-01' } }, 'booking').dates.booking, { start: '2026-11-08' });
  assert.deepEqual(add({}, 'booking', { today: null }).dates.booking, { start: '2026-09-08' }, 'no today: a week after');
  // The main phase: an end too, a week long, or up to the next dated phase.
  r = add({ booking: { start: '2026-09-10' } }, 'trip');
  assert.deepEqual(r.dates.trip, { start: '2026-10-13', end: '2026-10-19' });
  contiguous(r.dates);
  r = add({ booking: { start: '2026-09-10' }, 'post-trip': { start: '2026-10-08' } }, 'trip');
  assert.deepEqual(r.dates.trip, { start: '2026-10-01', end: '2026-10-07' });
  contiguous(r.dates);
  // Right after the main phase when a later phase is dated: the main end gives way (it is the previous phase's end).
  const main = { trip: { start: '2026-10-01', end: '2026-10-07' }, 'post-trip': { start: '2026-10-08' } };
  const three = [{ id: 'go', label: 'Go', main: true }, { id: 'rest', label: 'Rest' }, { id: 'after', label: 'After' }];
  r = P.addDatesFor(three, { go: { end: '2026-10-07' }, after: { start: '2026-10-08' } }, 'rest', { created: CREATED, today: '2026-10-13' });
  assert.deepEqual(r.dates, { go: { end: '2026-09-30' }, rest: { start: '2026-10-01' }, after: { start: '2026-10-08' } });
  assert.equal(P.problemOf(three, r.dates, { created: CREATED }), null);
  assert.deepEqual(add(main, 'trip'), { ok: false, problem: 'Trip has dates already.' });
  assert.deepEqual(add(dates, 'buffer', { days: 'lots' }).dates.buffer.start, '2026-09-24', 'an odd length is a week');
  assert.equal(add(dates, 'nope').ok, false);
});

await test('coverMain: the main end later, later boundaries shifted by the same days, earlier ones never moved', () => {
  const dates = { booking: { start: '2026-09-10' }, trip: { start: '2026-10-01', end: '2026-10-07' }, 'post-trip': { start: '2026-10-08' } };
  const r = P.coverMain(TRAVEL, dates, '2026-10-10', { created: CREATED });
  assert.deepEqual(r, { moved: true, dates: { booking: { start: '2026-09-10' }, trip: { start: '2026-10-01', end: '2026-10-10' }, 'post-trip': { start: '2026-10-11' } } });
  assert.equal(P.problemOf(TRAVEL, r.dates, { created: CREATED }), null, 'still contiguous');
  // Covered already, before the main phase, on its first day: nothing moves.
  for (const day of ['2026-10-07', '2026-10-03', '2026-09-15', '2026-10-01']) assert.deepEqual(P.coverMain(TRAVEL, dates, day, { created: CREATED }), { moved: false, dates }, day);
  // No end yet: the main phase ends the day before the next boundary, and that boundary shifts.
  const noEnd = { trip: { start: '2026-10-01' }, 'post-trip': { start: '2026-10-05' } };
  assert.deepEqual(P.coverMain(TRAVEL, noEnd, '2026-10-09', { created: CREATED }).dates, { trip: { start: '2026-10-01', end: '2026-10-09' }, 'post-trip': { start: '2026-10-10' } });
  // No end and no later boundary: the end is set.
  assert.deepEqual(P.coverMain(TRAVEL, { trip: { start: '2026-10-01' } }, '2026-10-09', { created: CREATED }).dates, { trip: { start: '2026-10-01', end: '2026-10-09' } });
  // No dated main phase, no main phase, a day that is not a day: nothing moves.
  assert.equal(P.coverMain(TRAVEL, { booking: { start: '2026-09-10' } }, '2026-10-09', { created: CREATED }).moved, false);
  assert.equal(P.coverMain([{ id: 'a', label: 'A' }], { a: { start: '2026-09-10' } }, '2026-10-09', { created: CREATED }).moved, false);
  assert.equal(P.coverMain(TRAVEL, dates, 'tomorrow', { created: CREATED }).moved, false);
  // The main phase is the first phase: it starts on the created day.
  const mainFirst = [{ id: 'go', label: 'Go', main: true }, { id: 'after', label: 'After' }];
  const c = P.dayOf(CREATED);
  assert.deepEqual(P.coverMain(mainFirst, { after: { start: P.addDays(c, 3) } }, P.addDays(c, 5), { created: CREATED }).dates, { go: { end: P.addDays(c, 5) }, after: { start: P.addDays(c, 6) } });
});

await test('chipWords: day N of M in a band with an end, days to go before the next band, else the label', () => {
  const dates = { booking: { start: '2026-09-10' }, trip: { start: '2026-10-01', end: '2026-10-07' } };
  const words = (today, d = dates, phases = TRAVEL) => P.chipWords(P.timelineOf(phases, d, { today, created: CREATED }), today);
  assert.equal(words('2026-10-02'), 'Trip · day 2 of 7', 'during the main phase');
  assert.equal(words('2026-10-07'), 'Trip · day 7 of 7');
  assert.equal(words('2026-09-11'), 'Booking · day 2 of 21', 'before the main phase, in a band with an end');
  assert.equal(words('2026-10-08'), 'Trip', 'after the main phase, nothing dated after it: the last band\'s label');
  assert.equal(words('2026-10-08', { ...dates, 'post-trip': { start: '2026-10-08' } }), 'Post-trip', 'an open-ended band');
  assert.equal(words('2026-10-20', { ...dates, 'post-trip': { start: '2026-10-08' } }), 'Post-trip');
  assert.equal(words('2026-08-20', { planning: { start: '2026-09-01' }, ...dates }), 'Planning · 12 days to go', 'not started');
  assert.equal(words('2026-08-31', { planning: { start: '2026-09-01' }, ...dates }), 'Planning · 1 day to go');
  assert.equal(words('2026-10-09', { trip: { start: '2026-10-01', end: '2026-10-07' }, 'post-trip': { start: '2026-10-12' } }), 'Post-trip · 3 days to go', 'in a gap');
  assert.equal(words('2026-10-01', {}), 'Planning', 'nothing dated: the first phase, open-ended from the created day');
  assert.equal(words('2026-10-01', {}, []), '', 'no phases');
  assert.equal(P.chipWords(P.timelineOf(TRAVEL, dates, { created: CREATED }), null), 'Trip', 'no today: the last dated band');
});

await test('storyWords: where we are, what is next and how far to the main phase, in the template\'s labels only', () => {
  // Planning from the created day (09-01), Booking 09-10, Buffer 09-25, Pre-trip 09-28, Trip 10-05 to 10-14, Post-trip 10-15.
  const dates = { booking: { start: '2026-09-10' }, buffer: { start: '2026-09-25' }, 'pre-trip': { start: '2026-09-28' }, trip: { start: '2026-10-05', end: '2026-10-14' }, 'post-trip': { start: '2026-10-15' } };
  const story = (today, d = dates, phases = TRAVEL, created = CREATED) => P.storyWords(P.timelineOf(phases, d, { today, created }), today);
  const parts = (today, d = dates) => P.storyParts(P.timelineOf(TRAVEL, d, { today, created: CREATED }), today);
  // Inside a phase, the next more than a day away: the phase, the next, the main phase.
  assert.equal(story('2026-09-04'), 'Planning · Booking in 6 days');
  assert.deepEqual(parts('2026-09-04'), ['Planning', 'Booking in 6 days'], 'the clauses, in reading order; the main phase ahead is the countdown\'s');
  // The day before a boundary.
  assert.equal(story('2026-09-09'), 'Booking starts tomorrow', 'Thomas\'s "day 20 of 20"');
  assert.equal(story('2026-10-04'), 'Trip starts tomorrow', 'the next is the main phase: said once');
  assert.equal(story('2026-09-30'), 'Pre-trip', 'the main phase ahead is not in the sentence');
  // Inside the main phase, and its last day.
  assert.equal(story('2026-10-07'), 'Trip · day 3 of 10');
  assert.equal(story('2026-10-14'), 'Trip · last day', 'the last day wins over the boundary tomorrow');
  assert.equal(story('2026-10-07', { trip: { start: '2026-10-05' } }), 'Trip · day 3', 'a main phase with no end');
  // After the main phase.
  assert.equal(story('2026-10-16'), 'Post-trip · back 2 days');
  assert.equal(story('2026-10-15'), 'Post-trip · back 1 day');
  assert.equal(story('2026-10-20', { trip: { start: '2026-10-05', end: '2026-10-14' } }), 'Trip · back 6 days', 'after the last dated phase: nothing current');
  // The last phase given an end: inside it, the day it ends, and once it is over everything is finished.
  const ended = { ...dates, 'post-trip': { start: '2026-10-15', end: '2026-10-25' } };
  assert.equal(story('2026-10-20', ended), 'Post-trip · back 6 days', 'inside an ended last phase: as when it is open-ended');
  assert.equal(story('2026-10-25', ended), 'Post-trip · back 11 days', 'its last day');
  assert.equal(story('2026-10-26', ended), 'Trip finished', 'past the last phase\'s end: the main phase\'s name');
  assert.equal(story('2026-11-30', { 'post-trip': { start: '2026-10-15', end: '2026-10-25' } }, TRAVEL.filter((p) => !p.main)), 'Post-trip finished', 'no main phase: the last phase\'s');
  assert.equal(P.chipWords(P.timelineOf(TRAVEL, ended, { today: '2026-10-26', created: CREATED }), '2026-10-26'), 'Trip finished', 'the chip says the same');
  // Before the first phase, and in a gap.
  assert.equal(story('2026-08-20', { planning: { start: '2026-09-01' }, ...dates }), 'Planning starts in 12 days', 'before the first phase');
  assert.equal(story('2026-08-31', { planning: { start: '2026-09-01' }, ...dates }), 'Planning starts tomorrow');
  assert.equal(story('2026-10-17', { trip: { start: '2026-10-05', end: '2026-10-14' }, 'post-trip': { start: '2026-10-20' } }), 'Post-trip starts in 3 days', 'in a gap after the main phase');
  const mainFirst = [{ id: 'go', label: 'Go', main: true }, { id: 'after', label: 'After' }];
  assert.equal(story('2026-08-25', { go: { start: '2026-09-01', end: '2026-09-03' } }, mainFirst), 'Go starts in 7 days', 'before a main phase that is first: said once');
  // No main phase: the phase, its day, the next only.
  const BUILD = [{ id: 'build', label: 'Build' }, { id: 'launch', label: 'Launch' }];
  assert.equal(story('2026-09-04', { launch: { start: '2026-09-13' } }, BUILD), 'Build · day 4 of 12 · Launch in 9 days');
  assert.equal(story('2026-09-12', { launch: { start: '2026-09-13' } }, BUILD), 'Launch starts tomorrow');
  assert.equal(story('2026-09-20', { launch: { start: '2026-09-13' } }, BUILD), 'Launch', 'the last, open-ended phase');
  // A one-day phase.
  assert.equal(story('2026-09-27', { ...dates, buffer: { start: '2026-09-27' } }), 'Pre-trip starts tomorrow', 'a one-day phase on its day: the next starts tomorrow');
  // No dates, no day, no phases.
  assert.equal(story('2026-09-04', {}), 'Planning', 'nothing dated but the first phase, open-ended');
  assert.equal(story('2026-09-04', {}, TRAVEL, null), 'Planning', 'nothing dated at all: the first phase');
  assert.equal(P.storyWords(P.timelineOf(TRAVEL, dates, { created: CREATED }), null), 'Post-trip', 'no day: the last dated band, as the chip\'s words');
  assert.equal(story('2026-09-04', {}, []), '', 'no phases');
  assert.deepEqual(P.storyParts([], '2026-09-04'), []);
  // Only the template's labels: a template whose main phase is "Session" reads the same way.
  const GAME = [{ id: 'prep', label: 'Prep' }, { id: 'session', label: 'Session', main: true }];
  assert.equal(story('2026-09-04', { session: { start: '2026-09-11', end: '2026-09-11' } }, GAME), 'Prep');
});

await test('countdown: days to the main phase, "starts today", nothing once it is under way or over', () => {
  const dates = { trip: { start: '2026-10-05', end: '2026-10-14' }, 'post-trip': { start: '2026-10-15' } };
  const togo = (today, d = dates) => P.countdown(P.timelineOf(TRAVEL, d, { today, created: CREATED }), today);
  assert.deepEqual(togo('2026-09-30'), { days: 5, words: '5 days to Trip' });
  assert.deepEqual(togo('2026-10-04'), { days: 1, words: '1 day to Trip' });
  assert.deepEqual(togo('2026-10-05'), { days: 0, words: 'Trip starts today' }, 'its first day');
  assert.equal(togo('2026-10-06'), null, 'under way: the sentence says the day');
  assert.equal(togo('2026-10-14'), null, 'its last day');
  assert.equal(togo('2026-10-15'), null, 'after the main phase');
  assert.equal(togo('2026-10-07', { trip: { start: '2026-10-05' } }), null, 'in a main phase with no end');
  assert.equal(togo('2026-09-30', {}), null, 'no dated main phase');
  assert.equal(P.countdown(P.timelineOf(TRAVEL, dates, { created: CREATED }), null), null, 'no day');
});

// --- the routes -----------------------------------------------------------------------------------------------------

const PRODUCT = 'Testname';
let child = null;
function startServer(dataDir, env = {}) {
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, TZ: 'UTC', PRODUCT_NAME: PRODUCT, ADMIN_PASSWORD: 'admin-password-1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve({ port: Number(m[1]), output: () => out }); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
}
// Stopped by its own pid (child.kill sends SIGTERM to that process only), never by name.
const stopServer = () => new Promise((resolve) => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
function call(server, method, urlPath, { body, cookie } = {}) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { host: `127.0.0.1:${server.port}`, accept: 'application/json' };
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
        resolve({ status: res.statusCode, json, text, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const cookieOf = (res) => [].concat(res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
const answer = (r) => [r.status, r.json];

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-phases-'));
const dataDir = path.join(base, 'data');
try {
  const server = await startServer(dataDir);
  const admin = cookieOf(await call(server, 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
  const asAdmin = (method, url, body) => call(server, method, url, { cookie: admin, body });
  const makeUser = async (login) => {
    const made = await asAdmin('POST', '/api/users', { login, displayName: login, role: 'member', password: `${login}-password-1` });
    assert.equal(made.status, 201, made.text);
    return { key: made.json.user.key, cookie: cookieOf(await call(server, 'POST', '/api/login', { body: { login, password: `${login}-password-1` } })) };
  };
  const mia = await makeUser('mia'); // a member of the trip
  const mo = await makeUser('mo'); // a member who moderates the trip
  const outsider = await makeUser('ola'); // not in the trip
  const asMember = (method, url, body) => call(server, method, url, { cookie: mia.cookie, body });
  const asModerator = (method, url, body) => call(server, method, url, { cookie: mo.cookie, body });
  const made = await asAdmin('POST', '/api/spaces', { name: 'Lisbon', members: [mia.key, mo.key] });
  assert.equal(made.status, 200, made.text);
  const trip = made.json.space;
  assert.equal((await asAdmin('PATCH', `/api/users/${mo.key}/spaces/${trip.id}`, { permissions: { moderator: true } })).status, 200);
  const stored = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'app.json'), 'utf8')).spaces.find((s) => s.id === trip.id);
  const ownersOnly = { error: 'owners only' };

  await test('a space carries phases, {} while none is set and no key stored; a template with none refuses any phase', async () => {
    assert.deepEqual(trip.phases, {}, 'on the space as made');
    assert.deepEqual((await asAdmin('GET', `/api/spaces/${trip.id}`)).json.space.phases, {});
    assert.deepEqual((await asAdmin('GET', '/api/spaces')).json.spaces.find((s) => s.id === trip.id).phases, {}, 'on the list');
    assert.equal('phases' in stored(), false, 'nothing stored');
    assert.deepEqual(answer(await asAdmin('PATCH', `/api/spaces/${trip.id}`, { phases: { trip: { start: '2026-10-01' } } })), [400, { error: 'There is no phase called "trip".' }]);
    assert.deepEqual(answer(await asAdmin('PATCH', `/api/spaces/${trip.id}`, { phases: {} })), [200, { space: { ...trip, phases: {} } }], 'an empty set is allowed and stores nothing');
    assert.equal('phases' in stored(), false);
    assert.equal((await asAdmin('POST', `/api/spaces/${trip.id}/phases/cover`, { day: '2026-10-09' })).status, 204, 'nothing to move without phases');
  });

  await test('branding carries the template\'s phases for the chip (step 3): [] with no template, the ordered list with one', async () => {
    assert.deepEqual((await call(server, 'GET', '/api/branding')).json.phases, [], 'no template: an empty list, not missing');
    assert.deepEqual((await asAdmin('GET', '/api/config')).json.phases, [], 'the same through /api/config');
    assert.equal((await asAdmin('PATCH', '/api/settings', { template: 'travel' })).status, 200);
    const ICONS = { planning: 'clipboard-list', booking: 'ticket', buffer: 'hourglass-half', 'pre-trip': 'suitcase-rolling', trip: 'plane', 'post-trip': 'camera' };
    const expected = TRAVEL.map((p) => ({ id: p.id, label: p.label, ...(p.main ? { main: true } : {}), icon: ICONS[p.id] }));
    assert.deepEqual((await call(server, 'GET', '/api/branding')).json.phases, expected, 'the travel template\'s phases, in order, main marked, with no restart');
    assert.deepEqual((await asAdmin('GET', '/api/config')).json.phases, expected);
    assert.deepEqual(P.cleanPhases(expected), TRAVEL.map((p) => ({ id: p.id, label: p.label, main: p.main === true, icon: ICONS[p.id] })), 'the shape the chip cleans');
    assert.equal((await asAdmin('PATCH', '/api/settings', { template: null })).status, 200);
    assert.deepEqual((await call(server, 'GET', '/api/branding')).json.phases, [], 'back to none when the template is dropped');
  });

  // The travel template, for its phases; To-do on in the trip, for a member with write there.
  assert.equal((await asAdmin('PATCH', '/api/settings', { template: 'travel' })).status, 200);
  assert.equal((await asAdmin('POST', '/api/modules/bundled/todo/install')).status, 201);
  assert.equal((await asAdmin('PATCH', '/api/modules/todo', { enabled: true, spaces: [trip.id] })).status, 200);

  // The first phase starts on the day the space was created (today), so every date is counted from it.
  const c = P.dayOf(trip.createdAt);
  const d = (n) => P.addDays(c, n);
  const dates = { booking: { start: d(10) }, trip: { start: d(30), end: d(36) }, 'post-trip': { start: d(37) } };

  await test('PATCH phases: the admin sets the dates, each refusal is 400 with its sentence and changes nothing', async () => {
    const set = await asAdmin('PATCH', `/api/spaces/${trip.id}`, { phases: dates });
    assert.deepEqual([set.status, set.json.space.phases], [200, dates], set.text);
    assert.deepEqual(stored().phases, dates, 'stored under phases on the space record');
    assert.deepEqual((await asAdmin('GET', `/api/spaces/${trip.id}`)).json.space.phases, dates);
    const refused = [
      [{ nope: { start: d(10) } }, 'There is no phase called "nope".'],
      [{ ['__proto__']: { start: d(10) } }, 'There is no phase called "__proto__".'],
      [{ booking: { start: d(10), end: d(20) } }, 'Only Trip, the main phase, and the last phase have an end.'],
      [{ booking: { start: d(10) }, buffer: { start: d(10) } }, `Buffer must start after Booking starts, ${d(10)}.`],
      [{ booking: { start: d(10) }, trip: { start: d(5) } }, `Trip must start after Booking starts, ${d(10)}.`],
      [{ booking: { start: d(-5) } }, `Booking must start after Planning starts, ${c}.`],
      [{ trip: { start: d(30), end: d(36) }, 'post-trip': { start: d(36) } }, `Post-trip must start after Trip ends, ${d(36)}.`],
      [{ trip: { start: d(36), end: d(30) } }, `Trip can't end before it starts, ${d(36)}.`],
      [{ trip: { start: 'October 1' } }, 'Trip\'s start must be a day written as YYYY-MM-DD.'],
      [{ trip: { end: d(36) } }, 'Set when Trip starts before its end.'],
      ['soon', 'Phases must be a set of dates by phase id.'],
    ];
    for (const [phases, error] of refused) assert.deepEqual(answer(await asAdmin('PATCH', `/api/spaces/${trip.id}`, { phases })), [400, { error }], JSON.stringify(phases));
    assert.deepEqual(stored().phases, dates, 'a refused set changes nothing');
    // A body over the JSON limit is a request too large, not an image (the 413 handler's sentence for an image upload).
    const big = await asAdmin('PATCH', `/api/spaces/${trip.id}`, { name: 'Lisbon', description: 'x'.repeat(70 * 1024) });
    assert.deepEqual(answer(big), [413, { error: 'that request is over 64 KB' }], big.text);
    assert.equal((await asAdmin('PATCH', `/api/spaces/${trip.id}`, { name: 'Lisbon in May', phases: 'soon' })).status, 400, 'a refused set refuses the whole change');
    assert.equal(stored().name, 'Lisbon');
    // Planning given a start before the created day: allowed, there is no boundary before the first phase.
    assert.equal((await asAdmin('PATCH', `/api/spaces/${trip.id}`, { phases: { planning: { start: d(-20) }, booking: { start: d(-5) }, ...dates, booking: { start: d(-5) } } })).status, 200);
    // The whole set replaces what is stored; null clears it.
    const less = await asAdmin('PATCH', `/api/spaces/${trip.id}`, { phases: { trip: { start: d(30), end: d(36) } } });
    assert.deepEqual([less.status, less.json.space.phases], [200, { trip: { start: d(30), end: d(36) } }]);
    assert.deepEqual((await asAdmin('PATCH', `/api/spaces/${trip.id}`, { phases: null })).json.space.phases, {});
    assert.equal('phases' in stored(), false, 'cleared, no key stored');
    // The last phase may be given an end, and kept; one before its start is refused.
    const endedLast = { ...dates, 'post-trip': { start: d(37), end: d(45) } };
    const kept = await asAdmin('PATCH', `/api/spaces/${trip.id}`, { phases: endedLast });
    assert.deepEqual([kept.status, kept.json.space.phases], [200, endedLast], kept.text);
    assert.deepEqual(stored().phases, endedLast);
    assert.deepEqual(answer(await asAdmin('PATCH', `/api/spaces/${trip.id}`, { phases: { ...dates, 'post-trip': { start: d(37), end: d(36) } } })), [400, { error: `Post-trip can't end before it starts, ${d(37)}.` }]);
    assert.equal((await asAdmin('PATCH', `/api/spaces/${trip.id}`, { phases: dates })).status, 200);
  });

  await test('PATCH phases: a moderator may, a member and an outsider may not, a moderator may send nothing else', async () => {
    const moved = { ...dates, booking: { start: d(12) } };
    const r = await asModerator('PATCH', `/api/spaces/${trip.id}`, { phases: moved });
    assert.deepEqual([r.status, r.json.space.phases], [200, moved], r.text);
    assert.deepEqual(answer(await asModerator('PATCH', `/api/spaces/${trip.id}`, { phases: { ...dates, booking: { start: d(30) } } })), [400, { error: `Trip must start after Booking starts, ${d(30)}.` }], 'the same rule for a moderator');
    assert.deepEqual(answer(await asModerator('PATCH', `/api/spaces/${trip.id}`, { name: 'Porto' })), [403, ownersOnly], 'the name is not a moderator\'s');
    assert.deepEqual(answer(await asModerator('PATCH', `/api/spaces/${trip.id}`, { name: 'Porto', phases: moved })), [403, ownersOnly], 'not with phases beside it either');
    assert.deepEqual(answer(await asMember('PATCH', `/api/spaces/${trip.id}`, { phases: moved })), [403, ownersOnly], 'a member');
    assert.deepEqual(answer(await call(server, 'PATCH', `/api/spaces/${trip.id}`, { cookie: outsider.cookie, body: { phases: moved } })), [404, { error: 'no such trip' }], 'someone not in the space');
    assert.deepEqual(answer(await call(server, 'PATCH', `/api/spaces/${trip.id}`, { body: { phases: moved } })), [401, { error: 'sign in first' }]);
    assert.deepEqual(answer(await asModerator('PATCH', '/api/spaces/nope', { phases: moved })), [404, { error: 'no such trip' }]);
    assert.equal(stored().name, 'Lisbon');
    assert.deepEqual(stored().phases, moved);
  });

  await test('PATCH opensWith and defaultLayout (Set up, step 4): a moderator may, with the same rules as an owner; nothing else; a member may not', async () => {
    const url = `/api/spaces/${trip.id}`;
    const r = await asModerator('PATCH', url, { opensWith: ['todo', 'calendar'] });
    assert.deepEqual([r.status, r.json.space.opensWith], [200, ['todo', 'calendar']], r.text);
    assert.deepEqual(stored().opensWith, ['todo', 'calendar']);
    assert.deepEqual(answer(await asModerator('PATCH', url, { opensWith: 'todo' })), [400, { error: 'Opens with must be a list of modules.' }], 'the store\'s own rule');
    // A shared layout, made by the moderator (they may), then set as the default: Opens with does not follow it (plan-layout-views.md, step 5).
    const made = await asModerator('POST', `${url}/layouts`, { name: 'Planning', shared: true, modules: [{ id: 'conference', mode: 'dock' }, { id: 'todo', mode: 'dock', dockW: 360 }] });
    assert.equal(made.status, 201, made.text);
    const layout = made.json.layout;
    const set = await asModerator('PATCH', url, { defaultLayout: layout.id });
    assert.deepEqual([set.status, set.json.space.defaultLayout, set.json.space.opensWith], [200, layout.id, ['todo', 'calendar']], set.text);
    assert.deepEqual([stored().defaultLayout, stored().opensWith], [layout.id, ['todo', 'calendar']]);
    assert.deepEqual(answer(await asModerator('PATCH', url, { defaultLayout: 'lnope00' })), [404, { error: 'This trip has no shared layout with that id.' }]);
    const bothSet = await asModerator('PATCH', url, { defaultLayout: layout.id, opensWith: ['conference', 'todo'] });
    assert.deepEqual([bothSet.status, bothSet.json.space.defaultLayout, bothSet.json.space.opensWith], [200, layout.id, ['conference', 'todo']], 'both at once are fine: independent fields');
    const listOnly = await asModerator('PATCH', url, { opensWith: ['todo', 'calendar'] });
    assert.deepEqual([listOnly.json.space.defaultLayout, listOnly.json.space.opensWith], [layout.id, ['todo', 'calendar']], 'changing Opens with keeps the default layout');
    await asModerator('PATCH', url, { opensWith: ['conference', 'todo'] });
    assert.deepEqual((await asModerator('PATCH', url, { defaultLayout: null })).json.space.defaultLayout, undefined, 'null stops using it');
    assert.equal('defaultLayout' in stored(), false);
    assert.deepEqual(stored().opensWith, ['conference', 'todo'], 'Opens with stays');
    // Together with phases, fine; anything else beside them, or alone, is the owners'.
    const both = await asModerator('PATCH', url, { phases: stored().phases, opensWith: ['todo'] });
    assert.deepEqual([both.status, both.json.space.opensWith], [200, ['todo']], both.text);
    for (const body of [{ name: 'Porto' }, { name: 'Porto', opensWith: ['todo'] }, { description: 'x', defaultLayout: layout.id }, { allowGuests: true }, { profile: 'characters' }, { members: [mo.key] }]) {
      assert.deepEqual(answer(await asModerator('PATCH', url, body)), [403, ownersOnly], JSON.stringify(body));
    }
    assert.deepEqual(answer(await asMember('PATCH', url, { opensWith: ['todo'] })), [403, ownersOnly], 'a member: Opens with');
    assert.deepEqual(answer(await asMember('PATCH', url, { defaultLayout: layout.id })), [403, ownersOnly], 'a member: the default layout');
    assert.deepEqual(answer(await call(server, 'PATCH', url, { cookie: outsider.cookie, body: { opensWith: ['todo'] } })), [404, { error: 'no such trip' }], 'someone not in the space');
    assert.deepEqual([stored().name, stored().opensWith, 'defaultLayout' in stored()], ['Lisbon', ['todo'], false], 'the refusals changed nothing');
    // The admin, unchanged: anything at once.
    const own = await asAdmin('PATCH', url, { description: 'May', opensWith: null });
    assert.deepEqual([own.status, own.json.space.description, own.json.space.opensWith], [200, 'May', undefined], own.text);
    // What tells the page the caller's rights: /api/me's user.spaces[<id>].permissions.moderator (and hasOwnerRights for the rest).
    assert.equal((await asModerator('GET', '/api/me')).json.user.spaces[trip.id].permissions.moderator, true);
    assert.equal(Boolean((await asMember('GET', '/api/me')).json.user.spaces[trip.id].permissions.moderator), false);
  });

  await test('the module context\'s space carries phases, for a member too', async () => {
    const ctx = await asMember('GET', `/api/modules/todo/context?scope=space&space=${trip.id}`);
    assert.equal(ctx.status, 200, ctx.text);
    assert.deepEqual(ctx.json.space, { id: trip.id, name: 'Lisbon', createdAt: trip.createdAt, phases: stored().phases, budget: null, guestsSeeHidden: false }, 'no budget target set: null (#216)');
    assert.deepEqual(ctx.json.phases.map((p) => p.id), ['planning', 'booking', 'buffer', 'pre-trip', 'trip', 'post-trip'], 'the template\'s phases, as before');
  });

  await test('cover: a member who can write in a module on in the space moves the main end later and the later boundaries with it', async () => {
    const refusal = { error: 'Only someone who can write in a module that is on in this trip can move its dates.' };
    const r = await asMember('POST', `/api/spaces/${trip.id}/phases/cover`, { day: d(39) });
    assert.deepEqual(answer(r), [200, { phases: { booking: { start: d(12) }, trip: { start: d(30), end: d(39) }, 'post-trip': { start: d(40) } } }], r.text);
    assert.deepEqual(stored().phases, r.json.phases);
    for (const day of [d(39), d(33), d(20), d(30)]) {
      const again = await asMember('POST', `/api/spaces/${trip.id}/phases/cover`, { day });
      assert.deepEqual([again.status, again.text], [204, ''], `${day}: nothing moved`);
    }
    assert.deepEqual(stored().phases, r.json.phases, 'nothing moved');
    assert.deepEqual(answer(await asMember('POST', `/api/spaces/${trip.id}/phases/cover`, { day: 'tomorrow' })), [400, { error: 'Send the day to cover as YYYY-MM-DD.' }]);
    assert.deepEqual(answer(await asMember('POST', `/api/spaces/${trip.id}/phases/cover`, {})), [400, { error: 'Send the day to cover as YYYY-MM-DD.' }]);
    assert.deepEqual(answer(await call(server, 'POST', `/api/spaces/${trip.id}/phases/cover`, { cookie: outsider.cookie, body: { day: d(50) } })), [404, { error: 'no such trip' }]);
    assert.deepEqual(answer(await call(server, 'POST', `/api/spaces/${trip.id}/phases/cover`, { body: { day: d(50) } })), [401, { error: 'sign in first' }]);
    assert.deepEqual(answer(await asMember('POST', '/api/spaces/nope/phases/cover', { day: d(50) })), [404, { error: 'no such trip' }]);
    assert.equal((await asAdmin('PATCH', '/api/modules/todo', { enabled: false })).status, 200, 'To-do off');
    assert.deepEqual(answer(await asMember('POST', `/api/spaces/${trip.id}/phases/cover`, { day: d(45) })), [403, refusal], 'no module on in the space');
    assert.equal((await asAdmin('POST', `/api/spaces/${trip.id}/phases/cover`, { day: d(45) })).status, 200, 'the admin, with no module on');
    assert.equal(stored().phases.trip.end, d(45));
    assert.equal(stored().phases['post-trip'].start, d(46));
  });

  await test('the app keeps behaving as before: a space without the key reads as {} and a stored set survives a restart', async () => {
    await stopServer();
    const again = await startServer(dataDir);
    const cookie = cookieOf(await call(again, 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
    const got = await call(again, 'GET', `/api/spaces/${trip.id}`, { cookie });
    assert.deepEqual(got.json.space.phases, stored().phases);
    assert.deepEqual((await call(again, 'GET', '/api/spaces/lobby', { cookie })).json.space.phases, {});
    await stopServer();
  });
} finally {
  await stopServer();
  fs.rmSync(base, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-phases: ${failed} of ${n + failed} failed`);
  process.exit(1);
}
console.log(`check-phases: OK (${n} checks)`);
