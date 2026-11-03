#!/usr/bin/env node
/*
 * check-object-handoff.mjs -- object handoff (documentation/plans/plan-object-handoff.md, GitHub #182 and #181), steps 2
 * and 3, and the bundled modules' side of steps 6 and 7. On their own: which `takes` entry takes which kind, the bus's
 * `object` input as the format's checker keeps it, the prompt's kinds for different sets of enabled modules, what the bundled
 * Research, To-do, Calendar and Polls declare, and how To-do, the Calendar and Polls map an object into their own fields
 * (Research's is in check-research.mjs). On a throwaway server with stand-in modules (none of this
 * repository's): `takes` and `may` on GET /api/spaces/:id/actions, an action's permission, the `object` input refused or
 * kept through POST /api/spaces/:id/action and /api/bus/actions/request, the copied instructions following the enabled
 * modules, and a request already waiting in bus.json from before still running. Step 9's server side: how a request went
 * (GET /api/spaces/:id/action/:requestId) for the person who asked only, a local request from Keep and Send to... handed
 * out for a minute only, and the upload sweep for a picture whose request never ran.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const PRODUCT = 'Testname';
process.env.PRODUCT_NAME = PRODUCT;
const { KINDS, TRAVEL_KINDS, cleanHandoff, takersOf, kindsTaken, instructions } = require('../server/object-format.js');
const { buildModule } = require('../server/module-build.js');

let n = 0;
const test = async (name, fn) => { await fn(); n += 1; };
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-object-handoff-'));
process.on('exit', () => fs.rmSync(base, { recursive: true, force: true })); // also when a check fails

// --- on their own -----------------------------------------------------------------------------------------------------

await test('which entry takes which kind: named kinds, "*" with except, "text" for no kind, a handoff kind only by name', () => {
  const calendarLike = [{ kinds: ['*', 'text'], except: TRAVEL_KINDS.slice(), as: 'an event' }];
  assert.equal(takersOf(calendarLike, 'event').length, 1);
  assert.equal(takersOf(calendarLike, 'task').length, 1, '"*" takes any kind it does not leave out');
  assert.equal(takersOf(calendarLike, undefined).length, 1, 'an object with no kind (a message\'s words)');
  for (const kind of TRAVEL_KINDS) assert.equal(takersOf(calendarLike, kind).length, 0, kind);
  assert.equal(takersOf(calendarLike, 'image').length, 0, '"*" never takes a picture');
  assert.equal(takersOf([{ kinds: ['image'], as: 'an image' }], 'image').length, 1);
  assert.equal(takersOf([{ kinds: ['text'], as: 'a note' }], undefined).length, 1);
  assert.equal(takersOf([{ kinds: ['text'], as: 'a note' }], 'note').length, 0, '"text" is words, not a kind');
  assert.equal(takersOf([{ kinds: ['note'], as: 'a note' }], undefined).length, 0);
  assert.deepEqual(takersOf(undefined, 'note'), [], 'an action without takes takes nothing');
});

await test('the bus\'s object: kept as the checker keeps it, a picture kept, no sources, basis only as given', () => {
  const flight = cleanHandoff({ kind: 'flight', title: 'Southwest 1234', content: '**Booked**\u0007', details: { airline: '**Southwest**', from: 'MDW', to: { code: 'sjc', name: 'San Jose' }, departs: '2026-11-14T12:50:00Z', seat: 12, wings: 2 }, sources: [1], basis: 'items', extra: 'x' });
  assert.deepEqual(flight, { icon: 'note', title: 'Southwest 1234', content: '**Booked**', basis: 'items', kind: 'flight', details: { airline: 'Southwest', from: { code: 'MDW' }, to: { code: 'SJC', name: 'San Jose' }, departs: '2026-11-14T12:50', seat: '12' } }, 'a whole number is read as its digits; an unknown field dropped');
  const words = cleanHandoff({ title: 'Dinner Friday', content: 'Dinner Friday at 7' });
  assert.equal('basis' in words, false, 'a chat message\'s words claim no basis');
  const park = cleanHandoff({ kind: 'attraction', title: 'Gilroy Gardens', details: { starts: '2026-11-15T10:00', minutes: 360, tickets: 4, reference: 'GG-77', partySize: 4 } });
  assert.deepEqual(park, { icon: 'note', title: 'Gilroy Gardens', kind: 'attraction', details: { starts: '2026-11-15T10:00', minutes: 360, tickets: 4, reference: 'GG-77' } }, 'an attraction keeps the sight-like details and no meal field');
  assert.equal(cleanHandoff({ kind: 'zoo', title: 'Zoo', details: { tickets: 4 } }), null, 'an unknown kind is no kind, so its details are nothing');
  assert.equal('kind' in cleanHandoff({ kind: 'zoo', title: 'Zoo', content: 'x' }), false);
  const picture = cleanHandoff({ kind: 'image', title: 'beach.jpg', details: { upload: 'a'.repeat(24), name: 'beach.jpg' } });
  assert.deepEqual(picture, { icon: 'note', title: 'beach.jpg', kind: 'image', details: { upload: 'a'.repeat(24), name: 'beach.jpg' } });
  assert.equal(cleanHandoff({ kind: 'image', title: 'x', details: { upload: '../../etc' } }), null, 'a picture with no file is nothing');
  assert.equal(cleanHandoff({ title: 'no content' }), null);
  assert.equal(cleanHandoff(null), null);
  assert.equal(cleanHandoff({ title: 'T', content: 'c', basis: 'imported' }).basis, 'imported');
});

// Stand-in manifests as the server keeps them (actions.provides[].takes).
const manifest = (id, provides) => ({ id, actions: { provides } });
const planner = manifest('stand-plans', [{ name: 'acceptSuggestion', takes: [{ kinds: ['flight', 'train', 'bus', 'ferry', 'car'], as: '{kind}' }, { kinds: ['hotel'], as: 'a stay' }, { kinds: ['restaurant', 'cafe', 'bar', 'sight', 'museum', 'attraction', 'tour', 'show', 'event'], as: '{kind}' }, { kinds: ['note'], as: 'a note' }] }]);
const todo = manifest('stand-tasks', [{ name: 'createTask', takes: [{ kinds: ['task', '*', 'text'], as: 'a task' }] }]);
const calendar = manifest('stand-days', [{ name: 'createEvent', takes: [{ kinds: ['*', 'text'], except: TRAVEL_KINDS.slice(), as: 'an event' }] }]);
const research = manifest('stand-notes', [{ name: 'saveNote', takes: [{ kinds: ['note', '*', 'text'], as: 'a note' }] }, { name: 'saveLink', takes: [{ kinds: ['link'], as: 'a link' }] }, { name: 'savePhoto', takes: [{ kinds: ['image'], as: 'an image' }] }]);
const polls = manifest('stand-polls', [{ name: 'draftPoll', takes: [{ kinds: ['poll', 'text'], as: 'a poll', permission: 'create' }] }]);
const older = manifest('stand-older', [{ name: 'acceptSuggestion', input: { title: 'string', kind: 'string?' } }]);
const notTyped = manifest('stand-other', [{ name: 'acceptSuggestion', input: { title: 'string' } }, { name: 'addStop', input: { title: 'string', kind: 'string?' } }]);

await test('the prompt\'s kinds: only those some enabled module names, in the catalogue\'s order', () => {
  const every = [planner, todo, calendar, research, polls];
  assert.deepEqual(kindsTaken(every), KINDS, 'every bundled-like module on: every kind');
  assert.ok(!kindsTaken([planner, calendar, research, polls]).includes('task'), 'To-do off: task is gone ("*" names no kind)');
  assert.deepEqual(kindsTaken([todo, calendar]), ['task'], '"*" and "text" name no kind, and except adds none');
  assert.deepEqual(kindsTaken([research]), ['note', 'link'], 'a handoff kind is never listed');
  assert.deepEqual(kindsTaken([older]), TRAVEL_KINDS, 'the typed keeper from before takes: the travel kinds, as before');
  assert.deepEqual(kindsTaken([older, todo]), [...TRAVEL_KINDS, 'task'], 'the old keeper still counts beside a module that declares takes');
  assert.deepEqual(kindsTaken([older, research]), [...TRAVEL_KINDS, 'note', 'link']);
  assert.deepEqual(kindsTaken([notTyped]), [], 'only that action, taking a title and a kind, counts');
  assert.deepEqual(kindsTaken([{ id: 'x', actions: { provides: [{ ...older.actions.provides[0], takes: [{ kinds: ['note'], as: 'a note' }] }] } }]), ['note'], 'once it declares takes, its takes count');
  assert.deepEqual(kindsTaken([]), [], 'nothing on: no kinds');
});

await test('the copied instructions for different sets of modules: each kind with every field of its details', () => {
  const every = instructions('object', { kinds: kindsTaken([planner, todo, calendar, research, polls]) });
  assert.ok(every.startsWith(`I keep my plans and research in ${PRODUCT}. `));
  assert.match(every, /Set "kind" to what the object is: flight, train, bus, ferry, car, hotel, restaurant, cafe, bar, sight, museum, attraction, tour, show, event, task, poll, note or link\. Leave it out only when none fits\./);
  assert.match(every, /One object per thing\. A whole itinerary is one object for each flight, train, stay, meal, visit and event, in the order they happen; a return flight is its own object\. Never fold several into one object's text\./);
  assert.match(every, /never guess a date or a year\. If something happens on a day you were not told, ask me for the date before you write the block; if I do not know, leave the date out\./);
  assert.match(every, /- flight: airline, number, from and to \(\{"code","name"\}\), departs, arrives, minutes \(time in the air\), terminal, gate, seat, class, reference\n/);
  assert.match(every, /\n- car: company, from \(pick-up\), to \(drop-off\), departs \(pick-up\), arrives \(drop-off\), class, reference\n/);
  assert.match(every, /\n- restaurant, cafe, bar: starts, ends, minutes, address, partySize, name \(the booking's name\), reference\n/);
  assert.match(every, /\n- sight, museum, attraction, tour, show: starts, ends, minutes, address, tickets, reference\n/);
  assert.match(every, /\n- note and link: no details; a link's address goes in "links"\.\n/);
  assert.ok(!every.includes('image'), 'a picture is never asked of an AI');
  assert.match(every, /\n- hotel \(any stay: hotel, rental, hostel\): address, checkIn/);
  assert.match(every, /Leave out tags, place and links when you have nothing for them, and content when "details" says it all\. Add no fields other than these\./);
  // Every field of every listed kind is named on its line.
  const { DETAILS } = require('../server/object-format.js');
  for (const kind of KINDS) {
    const line = every.split('\n').find((l) => l.startsWith('- ') && l.slice(2).split(/ \(|:/)[0].split(/, | and /).includes(kind));
    assert.ok(line, kind);
    for (const field of Object.keys(DETAILS[kind])) assert.ok(new RegExp(`[:,] ${field === 'to' ? '(?:from and )?to' : field}\\b`).test(line), `${kind}.${field}`);
  }
  const before = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/object-format/before-details.json'), 'utf8'));
  assert.equal(every, before.prompts.instructionsEveryKind);
  // The size the plan expects: about 1,500 characters over the instructions before details (1,895 with "Testname"),
  // plus room for the travel-kind sentence (a booking keeps its own kind rather than "event") Thomas asked for on 2026-10-04.
  assert.ok(every.length - 1895 < 2100, `the full instructions are ${every.length} characters, ${2100 - (every.length - 1895)} under the budget of 2100 over the 1,895 before details`);
  const travelOnly = instructions('object');
  // To-do off: no task line, no task in the kinds.
  const noTodo = instructions('object', { kinds: kindsTaken([planner, calendar, research, polls]) });
  assert.ok(!/\btask\b/.test(noTodo));
  // Only To-do and the Calendar: no flight example, no itinerary line, a plain example, task's line.
  const small = instructions('object', { kinds: kindsTaken([todo, calendar]) });
  assert.ok(!small.includes('flight') && !small.includes('itinerary'));
  assert.match(small, /\[\{"icon":"note","kind":"task","title":"<title>"/);
  assert.match(small, /Set "kind" to what the object is: task\. /);
  assert.match(small, /\n- task: due\n/);
  // Nothing named: no kind line and no details, only the date rule.
  const none = instructions('object', { kinds: [] });
  assert.ok(!none.includes('"kind"') && !none.includes('"details"'));
  assert.match(none, /never guess a date or a year\. .* Write a date as YYYY-MM-DD\.\n/);
  assert.match(none, /Leave out tags, place and links when you have nothing for them\. Add no fields/);
  assert.ok(travelOnly.includes('- hotel (any stay: hotel, rental, hostel): address, checkIn, checkOut, roomType, guests, reference'));
});

// --- the bundled modules (plan-object-handoff.md, steps 6 and 7) -------------------------------------------------------

const { cleanManifest, readZip } = require('../server/modules.js');
const bundled = async (id) => {
  const built = buildModule(path.join(ROOT, 'modules', id));
  return cleanManifest(built.manifest, new Set((await readZip(built.zip)).keys()));
};
const providesOf = (m, name) => m.actions.provides.find((a) => a.name === name);

await test('the bundled Research, To-do, Calendar and Polls declare what they take, and install', async () => {
  const research = await bundled('research');
  assert.deepEqual(providesOf(research, 'saveNote').takes, [{ kinds: ['note', '*', 'text'], as: 'a note' }]);
  assert.equal(providesOf(research, 'saveNote').input.object, 'object?', 'the flat fields still work');
  assert.deepEqual(providesOf(research, 'saveLink').takes, [{ kinds: ['link'], as: 'a link' }]);
  assert.equal(providesOf(research, 'saveLink').input.url, 'text', 'Chat\'s link keeper is found by its url, as before');
  assert.deepEqual(providesOf(research, 'savePhoto'), { name: 'savePhoto', label: 'Save this picture to research', input: { object: 'object' }, askerOnly: true, takes: [{ kinds: ['image'], as: 'an image' }] });
  // `askerOnly` (QA round 2, failure 1): true or false, and not with `local`, which is already for the asker only.
  const withAction = (a) => cleanManifest({ id: 'asker', name: 'Asker', version: '1.0.0', scope: ['space'], surfaces: { page: { entry: 'page.html' }, canvas: { entry: 'page.html' } }, actions: { provides: [{ name: 'make', input: {}, ...a }] } }, new Set(['page.html']));
  assert.equal(withAction({ askerOnly: true }).actions.provides[0].askerOnly, true);
  assert.equal('askerOnly' in withAction({ askerOnly: false }).actions.provides[0], false);
  assert.throws(() => withAction({ askerOnly: 'yes' }), { message: 'module.json: action "make" askerOnly must be true or false' });
  assert.throws(() => withAction({ askerOnly: true, local: true }), { message: 'module.json: action "make" is local, which is already for the asker only' });
  const todo = await bundled('todo');
  assert.deepEqual(providesOf(todo, 'createTask').takes, [{ kinds: ['task', '*', 'text'], as: 'a task' }]);
  assert.deepEqual(providesOf(todo, 'createTask').input, { title: 'string', notes: 'text?', ref: 'ref?', due: 'date?', object: 'object?' });
  const calendar = await bundled('calendar');
  assert.deepEqual(providesOf(calendar, 'createEvent').takes, [{ kinds: ['event', '*', 'text'], except: TRAVEL_KINDS.slice(), as: 'an event' }], 'events by name, and any other object or words, never a travel kind');
  assert.deepEqual(providesOf(calendar, 'createEvent').input, { title: 'string', date: 'date?', ref: 'ref?', object: 'object?' });
  assert.deepEqual(providesOf(calendar, 'createEvent').needs, ['date'], 'it needs a day: a module filling it in fills the date');
  const polls = await bundled('polls');
  assert.deepEqual(providesOf(polls, 'draftPoll'), { name: 'draftPoll', label: 'Draft a poll from it', input: { object: 'object' }, local: true, takes: [{ kinds: ['poll', 'text'], as: 'a poll', permission: 'create' }] });
  for (const kind of TRAVEL_KINDS) assert.equal(takersOf(providesOf(calendar, 'createEvent').takes, kind).length, 0, kind);
  for (const kind of ['event', 'task', 'poll', 'note', 'link', undefined]) assert.equal(takersOf(providesOf(calendar, 'createEvent').takes, kind).length, 1, String(kind));
  assert.equal(takersOf(providesOf(research, 'saveNote').takes, 'image').length, 0, 'a picture is only for savePhoto');
  // With every bundled module on, the prompt lists every kind; the Planner off, still every kind but the travel ones.
  const every = await Promise.all(['travel', 'research', 'todo', 'calendar', 'polls', 'places', 'maps', 'stream', 'assistant'].map(bundled));
  assert.deepEqual(kindsTaken(every), KINDS);
  assert.deepEqual(kindsTaken(every.filter((m) => m.id !== 'travel')), ['event', 'task', 'poll', 'note', 'link']);
  assert.deepEqual(kindsTaken([todo]), ['task']);
});

// The modules' own mapping, run on their own with the SDK's helpers, as their pages run it.
const sdkWin = { addEventListener() {}, location: { search: '' } };
sdkWin.parent = sdkWin;
new Function('window', 'document', fs.readFileSync(path.join(ROOT, 'public/sdk/host.js'), 'utf8'))(sdkWin, { createElement: (tag) => ({ tag }) });
const util = { ...sdkWin.hostText, time: (hhmm) => `at:${hhmm}` };
const modSrc = (id, file) => fs.readFileSync(path.join(ROOT, 'modules', id, 'src', file), 'utf8');
const { taskFromObject } = new Function(`${modSrc('todo', 'todo-lib.js')}\nreturn { taskFromObject };`)();
const { eventFromObject } = new Function('ymd', 'parseYmd', `${modSrc('calendar', 'calendar-lib.js')}\nreturn { eventFromObject };`)(() => '', (s) => new Date(s));
const { pollFromObject, pollFills } = new Function(`${modSrc('polls', 'polls-lib.js')}\nreturn { pollFromObject, pollFills };`)();
const LINKS = [{ title: 'Ticket', url: 'https://example.org/t' }];

await test('To-do: a task due on its day, a time in the notes; any other object a task named after it, with no due date', () => {
  assert.deepEqual(taskFromObject({ kind: 'task', title: 'Book **the** ferry', content: 'Before *Friday*.', details: { due: '2026-11-12T09:30' }, date: '2026-11-10', links: LINKS, basis: 'imported' }, util),
    { title: 'Book the ferry', notes: 'Before Friday.\n\nDue at at:09:30\n\nLinks:\n- Ticket: https://example.org/t\nExternal source', due: '2026-11-12' }, 'the details\' day wins; plain text');
  assert.equal(taskFromObject({ kind: 'task', title: 'Pack', content: 'x', date: '2026-11-10' }, util).due, '2026-11-10', 'no due: the object\'s own day');
  assert.deepEqual(taskFromObject({ kind: 'task', title: 'Pack', details: { due: '18:00' } }, util), { title: 'Pack', notes: 'Due: 18:00', due: null }, 'a time and no day: a line');
  assert.equal(taskFromObject({ kind: 'task', title: 'Pack', details: { due: '18:00' }, date: '2026-11-10' }, util).due, '2026-11-10', 'a time alone takes the object\'s day');
  const flight = taskFromObject({ kind: 'flight', title: 'Southwest 2483', date: '2026-11-14', details: { airline: 'Southwest', departs: '2026-11-14T12:50', seat: '12A' } }, util);
  assert.deepEqual(flight, { title: 'Southwest 2483', notes: 'Airline: Southwest\nDeparts: 2026-11-14 12:50\nSeat: 12A', due: null }, 'another kind: no due date, its details as lines');
  assert.deepEqual(taskFromObject({ title: 'Call the inn', content: 'Call the inn\nabout late check-in' }, util), { title: 'Call the inn', notes: 'about late check-in', due: null }, 'a message\'s words: the title is its first line');
  assert.deepEqual(taskFromObject({ title: 'Buy sunscreen', content: 'Buy sunscreen', place: { name: 'Pharmacy' } }, util), { title: 'Buy sunscreen', notes: 'Place: Pharmacy', due: null });
  const long = taskFromObject({ title: 'T', content: 'y'.repeat(3000), links: LINKS, basis: 'imported' }, util);
  assert.ok(long.notes.length <= 1000 && long.notes.endsWith('External source'), 'within To-do\'s 1000, the tail kept');
  assert.equal(taskFromObject({ title: 'y'.repeat(300), content: 'c' }, util).title.length, 200);
});

await test('Calendar: an event from starts to ends, or starts plus minutes; a day alone all day; anything else all day on its day', () => {
  const at = (s) => new Date(s).toISOString();
  assert.deepEqual(eventFromObject({ kind: 'event', title: 'Fado **night**', content: 'Bring *cash*.', details: { starts: '2026-11-15T20:00', ends: '2026-11-15T23:30', address: 'Rua 1' }, links: LINKS }, util),
    { title: 'Fado night', allDay: false, start: at('2026-11-15T20:00'), end: at('2026-11-15T23:30'), desc: 'Bring cash.\n\nAddress: Rua 1\n\nLinks:\n- Ticket: https://example.org/t' });
  assert.equal(eventFromObject({ kind: 'event', title: 'Tour', details: { starts: '2026-11-15T10:00', minutes: 90 } }, util).end, at('2026-11-15T11:30'), 'starts plus minutes');
  assert.deepEqual(eventFromObject({ kind: 'event', title: 'Festival', details: { starts: '2026-11-15', ends: '2026-11-17' } }, util), { title: 'Festival', allDay: true, start: '2026-11-15', end: '2026-11-17', desc: '' }, 'days alone: all day, the end its last day');
  assert.deepEqual(eventFromObject({ kind: 'event', title: 'Market', details: { starts: '2026-11-15T09:00', allDay: true } }, util), { title: 'Market', allDay: true, start: '2026-11-15', end: null, desc: '' }, 'allDay wins over a time');
  assert.equal(eventFromObject({ kind: 'event', title: 'Dinner', details: { starts: '19:00' }, date: '2026-11-15' }, util).start, at('2026-11-15T19:00'), 'a time alone on the object\'s day');
  assert.equal(eventFromObject({ kind: 'event', title: 'Dinner', details: { starts: '19:00' } }, util), null, 'no day: not on the calendar');
  assert.equal(eventFromObject({ kind: 'event', title: 'Late', details: { starts: '2026-11-15T22:00', ends: '2026-11-15T21:00' } }, util).desc, 'Ends: 2026-11-15 21:00', 'an end before the start is a line');
  assert.deepEqual(eventFromObject({ kind: 'task', title: 'Pay deposit', details: { due: '2026-11-12T17:00' } }, util), { title: 'Pay deposit', allDay: true, start: '2026-11-12', end: null, desc: 'Due at at:17:00' }, 'a task: all day on its due day');
  assert.deepEqual(eventFromObject({ kind: 'poll', title: 'Where to eat?', date: '2026-11-14', details: { options: ['Pier', 'Inn'] } }, util), { title: 'Where to eat?', allDay: true, start: '2026-11-14', end: null, desc: 'Options: Pier, Inn' });
  assert.deepEqual(eventFromObject({ title: 'Dinner Friday', content: 'Dinner Friday\nat the pier', date: '2026-11-13' }, util), { title: 'Dinner Friday', allDay: true, start: '2026-11-13', end: null, desc: 'at the pier' }, 'a message\'s words');
  assert.equal(eventFromObject({ title: 'Someday', content: 'x' }, util), null);
  assert.equal(eventFromObject({ title: 'Someday', content: 'x' }, util, '2026-11-20').start, '2026-11-20', 'the request\'s own date when the object has none');
  assert.equal(eventFromObject({ title: 'Dated', content: 'x', date: '2026-11-19' }, util, '2026-11-20').start, '2026-11-19', 'the object\'s own day first');
  assert.ok(eventFromObject({ kind: 'note', title: 'N', content: 'z'.repeat(900), date: '2026-11-14', basis: 'imported' }, util).desc.length <= 600);
  // Past midnight: an end with no day of its own that is not after the start is the next day's.
  assert.deepEqual(eventFromObject({ kind: 'event', title: 'Late show', details: { starts: '22:00', ends: '01:00' }, date: '2026-11-18' }, util),
    { title: 'Late show', allDay: false, start: at('2026-11-18T22:00'), end: at('2026-11-19T01:00'), desc: '' });
  assert.equal(eventFromObject({ kind: 'event', title: 'Late', details: { starts: '2026-11-18T22:00', ends: '01:00' } }, util).end, at('2026-11-19T01:00'), 'a start with its day, an end time alone');
  assert.equal(eventFromObject({ kind: 'event', title: 'Same', details: { starts: '22:00', ends: '22:00' }, date: '2026-11-18' }, util).end, at('2026-11-19T22:00'), 'an end time equal to the start: a day later');
  assert.equal(eventFromObject({ kind: 'event', title: 'Dated', details: { starts: '2026-11-18T22:00', ends: '2026-11-18T01:00' } }, util).end, null, 'an end with its own day before the start is not moved');
  assert.equal(eventFromObject({ kind: 'event', title: 'Dated', details: { starts: '2026-11-31T22:00', ends: '01:00' } }, util), null, 'an impossible day: no event');
  assert.equal(eventFromObject({ kind: 'event', title: 'Month end', details: { starts: '23:30', ends: '00:15' }, date: '2026-11-30' }, util).end, at('2026-12-01T00:15'), 'across a month');
});

await test('Polls: the form filled from a poll or a message\'s words; nothing saved', () => {
  assert.deepEqual(pollFromObject({ kind: 'poll', title: 'Where **to**?', details: { options: ['Faro', 'Lagos', 'faro'], closes: '2026-11-12T18:00', multiple: true } }, util), { title: 'Where to?', options: ['Faro', 'Lagos'], closes: '2026-11-12T18:00', multi: true });
  assert.deepEqual(pollFromObject({ kind: 'poll', title: 'Lunch?', details: { closes: '18:00' }, date: '2026-11-12' }, util), { title: 'Lunch?', options: [], closes: '2026-11-12T18:00', multi: false }, 'a time alone on its day');
  assert.equal(pollFromObject({ kind: 'poll', title: 'Lunch?', details: { closes: '2026-11-12' } }, util).closes, '2026-11-12T12:00', 'a day alone: noon, as /v');
  assert.equal(pollFromObject({ title: 'Lunch Friday?', content: 'Lunch Friday?', date: '2026-11-13' }, util).closes, '2026-11-13T12:00', 'a message\'s day: noon');
  assert.equal(pollFromObject({ kind: 'poll', title: 'Lunch?', details: { closes: '18:00' } }, util).closes, '', 'a time and no day: none');
  assert.deepEqual(pollFromObject({ title: 'Where to eat?', content: 'Where to eat?\n- Pier\n- **Inn**\n- Pier' }, util).options, ['Pier', 'Inn'], 'a message\'s short lines are its options');
  assert.deepEqual(pollFromObject({ title: 'Plans', content: 'Plans\nWe could go to the beach or stay in.' }, util).options, [], 'one line is no choice');
  assert.deepEqual(pollFromObject({ title: 'Q', content: `Q\n${'x'.repeat(120)}\ny` }, util).options, [], 'a paragraph is not an option');
  assert.equal(pollFromObject({ title: 'Q', content: Array.from({ length: 15 }, (_, i) => `- ${i}`).join('\n') }, util).options.length, 10);
  assert.deepEqual(pollFromObject({ kind: 'poll', title: 'Q', details: { options: [] } }, util).options, [], 'none');
  assert.deepEqual(pollFromObject({ kind: 'poll', title: 'Q', details: { options: ['Only'] } }, util).options, [], 'one is no choice');
  const fifty = Array.from({ length: 50 }, (_, i) => `Option ${i + 1}`);
  assert.deepEqual(pollFromObject({ kind: 'poll', title: 'Q', details: { options: fifty } }, util).options, fifty.slice(0, 10), 'fifty: the first ten');
  assert.deepEqual(pollFromObject({ kind: 'poll', title: 'Q', details: { options: ['Faro', 'FARO', 'faro', 'Lagos', 'lagos '] } }, util).options, ['Faro', 'Lagos'], 'duplicates that differ only in case: the first');
  assert.deepEqual(pollFromObject({ kind: 'poll', title: 'Q', details: { options: ['Faro', 'FARO'] } }, util).options, [], 'only one once duplicates go');
});

await test('Polls: a closed poll offers only the actions it can fill (title, notes, date, a pointer to it)', () => {
  const calendarLike = { input: { title: 'string', date: 'date?', ref: 'ref?', object: 'object?' }, needs: ['date'] };
  assert.equal(pollFills(calendarLike, true), true);
  assert.equal(pollFills(calendarLike, false), false, 'it needs a date the winner does not have');
  assert.equal(pollFills({ input: { title: 'string', notes: 'text?', ref: 'ref?' } }, false), true, 'a task');
  assert.equal(pollFills({ input: { url: 'text', title: 'string?', excerpt: 'text?', ref: 'ref?' } }, true), false, 'a link needs its address');
  assert.equal(pollFills({ input: { title: 'string', date: 'date' } }, false), false, 'a required date with none');
  assert.equal(pollFills({ input: { title: 'string', date: 'date' } }, true), true);
  assert.equal(pollFills({ input: { title: 'string', poll: 'ref:polls:poll' } }, false), false, 'a pointer under another name is not filled');
  assert.equal(pollFills({ input: { title: 'string', ref: 'ref:polls:poll' } }, false), true);
  assert.equal(pollFills({ input: { title: 'string', ref: 'ref:todo:task' } }, false), false, 'a pointer to another kind');
  assert.equal(pollFills({ input: { title: 'string', kind: 'string' } }, true), false);
  assert.equal(pollFills({ input: { text: 'string' } }, true), false, 'no title');
  assert.equal(pollFills({ input: { object: 'object' } }, true), false);
  assert.equal(pollFills(null, true), false);
});

// --- the bus on its own (step 9: how a request went, open-only requests, the upload sweep) ---------------------------

const { ModuleBus, BUS_LIMITS } = require('../server/module-bus.js');

await test('bus: an open-only request is handed out for a minute, then never; it reads as expired, then goes', () => {
  const bus = new ModuleBus(fs.mkdtempSync(path.join(base, 'bus-')));
  const r = bus.request({ from: 'p', provider: 'p', action: 'draftPoll', input: {}, scopeKey: 'space:abcd', by: 'u1', local: true, openOnly: true });
  assert.equal(r.expiresAt - r.at, BUS_LIMITS.openOnlyMs);
  assert.equal(bus.statusOf(r), 'pending');
  assert.equal(bus.pending('p', 'space:abcd').length, 1);
  r.expiresAt = Date.now() - 1;
  assert.equal(bus.statusOf(r), 'expired');
  assert.equal(bus.pending('p', 'space:abcd').length, 0, 'not handed out after its minute');
  assert.equal(bus.claim(r.id, 'p', 'space:abcd'), null, 'nor claimed');
  const plain = bus.request({ from: 'p', provider: 'p', action: 'addPoll', input: {}, scopeKey: 'space:abcd', by: 'u1', local: true });
  assert.equal('expiresAt' in plain, false, 'a command\'s request still waits for the module to be opened');
  plain.at = Date.now() - 6 * 24 * 3600 * 1000;
  assert.equal(bus.pending('p', 'space:abcd').length, 1);
  // Claimed in time, a page still finishes it after the minute.
  const late = bus.request({ from: 'p', provider: 'p', action: 'draftPoll', input: {}, scopeKey: 'space:abcd', by: 'u1', local: true, openOnly: true });
  assert.equal(bus.complete(r.id, 'p', 'space:abcd', { ok: true }), null, 'nor finished, unclaimed past its minute');
  assert.equal(bus.statusOf(r), 'expired');
  assert.ok(bus.claim(late.id, 'p', 'space:abcd'));
  late.expiresAt = Date.now() - 1;
  assert.equal(bus.statusOf(late), 'claimed');
  assert.ok(bus.complete(late.id, 'p', 'space:abcd', { ok: true }));
  assert.equal(bus.statusOf(late), 'done');
  assert.ok(late.doneAt >= late.at, 'when it finished is kept');
  // Past its result window an expired request is dropped, and said to have gone without being carried out.
  const dropped = [];
  bus.on('actionsDropped', (list) => dropped.push(...list.map((a) => a.id)));
  r.expiresAt = Date.now() - BUS_LIMITS.resultMs - 1;
  bus.request({ from: 'p', provider: 'p', action: 'addPoll', input: {}, scopeKey: 'space:abcd', by: 'u1', local: true });
  assert.equal(bus.actionById(r.id), null);
  assert.deepEqual(dropped, [r.id], 'a finished request is not announced');
});

await test('bus: a request dropped after seven days unclaimed is announced; a finished one is not', () => {
  const bus = new ModuleBus(fs.mkdtempSync(path.join(base, 'bus-')));
  const dropped = [];
  bus.on('actionsDropped', (list) => dropped.push(...list.map((a) => a.id)));
  const waiting = bus.request({ from: 'n', provider: 'n', action: 'savePhoto', input: {}, scopeKey: 'space:abcd', by: 'u1' });
  const ran = bus.request({ from: 'n', provider: 'n', action: 'savePhoto', input: {}, scopeKey: 'space:abcd', by: 'u1' });
  bus.claim(ran.id, 'n', 'space:abcd');
  bus.complete(ran.id, 'n', 'space:abcd', { ok: false, error: 'no' });
  waiting.at = Date.now() - BUS_LIMITS.actionAgeMs - 1;
  ran.at = Date.now() - BUS_LIMITS.actionAgeMs - 1;
  bus.publish({ module: 'n', name: 'x', scopeKey: 'space:abcd', by: 'u1' });
  assert.equal(bus.actionById(waiting.id), null);
  assert.equal(bus.actionById(ran.id), null);
  assert.deepEqual(dropped, [waiting.id]);
});

// --- a real server ------------------------------------------------------------------------------------------------

function writeModule(id, name, extra) {
  const root = path.join(base, 'mods', id);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'module.json'), JSON.stringify({
    id, name, version: '1.0.0', scope: ['environment', 'space'], icon: 'circle',
    surfaces: { page: { entry: `${id}.html` }, canvas: { entry: `${id}.html` } },
    ...extra,
  }));
  fs.writeFileSync(path.join(root, 'src', `${id}.html`), '<!DOCTYPE html><html><head><style>/*__CSS__*/</style></head><body><script>/*__JS__*/</script></body></html>');
  fs.writeFileSync(path.join(root, 'src', `${id}.css`), '');
  fs.writeFileSync(path.join(root, 'src', `${id}.js`), '');
  return buildModule(root).zip;
}
const writes = { permissions: [{ key: 'view', label: 'See it', default: { member: true, moderator: true, guest: true } }, { key: 'edit', label: 'Change it', default: { member: true, moderator: true, guest: false } }], access: { read: 'view', write: 'edit' } };
const zips = [
  writeModule('stand-days', 'Days', { ...writes, actions: { provides: [
    { name: 'createEvent', label: 'Add an event', input: { title: 'string?', date: 'date?', at: 'datetime?', object: 'object?' }, needs: ['date'], takes: [{ kinds: ['*', 'text'], except: TRAVEL_KINDS.slice(), as: 'an event' }] },
  ] } }),
  writeModule('stand-plans', 'Plans', { ...writes, actions: { provides: [
    { name: 'acceptSuggestion', label: 'Add it to the trip', input: { title: 'string', kind: 'string?', content: 'text?', place: 'string?', date: 'date?', object: 'object?' }, takes: planner.actions.provides[0].takes },
  ] } }),
  writeModule('stand-tasks', 'Tasks', { ...writes, actions: { provides: [
    { name: 'createTask', label: 'Add a task', input: { title: 'string?', object: 'object?' }, takes: [{ kinds: ['task', '*', 'text'], as: 'a task' }] },
  ] } }),
  writeModule('stand-notes', 'Notes', { ...writes, actions: { provides: [
    { name: 'savePhoto', label: 'Keep a photo', input: { object: 'object' }, takes: [{ kinds: ['image'], as: 'an image' }] },
  ] } }),
  writeModule('stand-polls', 'Votes', { permissions: [...writes.permissions, { key: 'create', label: 'Start polls', default: { member: false, moderator: true } }], access: writes.access, actions: { provides: [
    { name: 'draftPoll', label: 'Start a poll', local: true, input: { object: 'object' }, takes: [{ kinds: ['poll', 'text'], as: 'a poll', permission: 'create' }] },
    { name: 'noteVote', label: 'Note a vote', input: { object: 'object' }, takes: [{ kinds: ['poll'], as: 'a poll', permission: 'create' }, { kinds: ['text'], as: ' a \u0007 note ' }] },
    { name: 'addPoll', label: 'Start a poll', local: true, input: { text: 'string' } },
  ] } }),
  writeModule('stand-asker', 'Asker', { ...writes, actions: { uses: ['stand-days:createEvent', 'stand-polls:draftPoll', 'stand-polls:addPoll'] } }),
  writeModule('stand-older', 'Older', { ...writes, actions: { provides: [
    { name: 'acceptSuggestion', label: 'Add it, typed', input: { title: 'string', kind: 'string?' } },
  ] } }),
];

const dataDir = path.join(base, 'data');
async function startServer() {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: base,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, TZ: 'UTC', PRODUCT_NAME: PRODUCT, ADMIN_PASSWORD: 'testpass1234' },
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
  const call = async (method, urlPath, { body, token, type } = {}) => {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = type || 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  const signIn = async (login, password) => {
    const r = await call('POST', '/api/login', { body: { login, password } });
    assert.equal(r.status, 200, `${login} signs in: ${r.text}`);
    return r.json.token;
  };
  const stop = () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
  return { call, signIn, stop };
}

let server = null;
try {
  server = await startServer();
  let { call, signIn } = server;
  const admin = await signIn('admin', 'testpass1234');
  const made = await call('POST', '/api/users', { token: admin, body: { login: 'pat', displayName: 'Pat', role: 'member', password: 'memberpass1234' } });
  assert.equal(made.status, 201, made.text);
  const S = (await call('POST', '/api/spaces', { token: admin, body: { name: 'Trip', members: [made.json.user.key] } })).json.space.id;
  for (const zip of zips) {
    const up = await call('POST', '/api/modules', { token: admin, body: zip, type: 'application/zip' });
    assert.equal(up.status, 201, up.text);
  }
  const turn = async (id, enabled) => assert.equal((await call('PATCH', `/api/modules/${id}`, { token: admin, body: { enabled, allSpaces: true } })).status, 200, id);
  for (const id of ['stand-days', 'stand-plans', 'stand-tasks', 'stand-notes', 'stand-polls', 'stand-asker']) await turn(id, true);
  const pat = await signIn('pat', 'memberpass1234');
  const actionsOf = async (token) => {
    const r = await call('GET', `/api/spaces/${S}/actions`, { token });
    assert.equal(r.status, 200, r.text);
    return Object.fromEntries(r.json.actions.filter((a) => a.module.startsWith('stand-')).map((a) => [a.action, a]));
  };
  const send = (token, action, input) => call('POST', `/api/spaces/${S}/action`, { token, body: { action, input } });
  const pending = async (id) => (await call('GET', `/api/bus/actions/pending?module=${id}&scope=space&space=${S}`, { token: admin })).json.actions;

  await test('live: GET .../actions returns takes as declared, and may honours the permission', async () => {
    const mine = await actionsOf(pat);
    assert.deepEqual(mine['stand-days:createEvent'].takes, [{ kinds: ['*', 'text'], except: TRAVEL_KINDS, as: 'an event', may: true }]);
    assert.deepEqual(mine['stand-polls:draftPoll'].takes, [{ kinds: ['poll', 'text'], as: 'a poll', permission: 'create', may: false }], 'each entry says may');
    assert.deepEqual(mine['stand-polls:noteVote'].takes, [{ kinds: ['poll'], as: 'a poll', permission: 'create', may: false }, { kinds: ['text'], as: 'a note', may: true }], 'one entry refused, one not; "as" with a control character keeps single spaces');
    assert.equal(mine['stand-polls:noteVote'].may, true, 'some entry may be used');
    assert.equal('takes' in mine['stand-polls:addPoll'], false, 'an action without takes says none');
    assert.deepEqual(mine['stand-days:createEvent'].needs, ['date'], 'needs, as the bus list says it: Keep leaves out an action needing a day the object lacks');
    assert.equal('needs' in mine['stand-polls:addPoll'], false, 'an action without needs says none');
    assert.equal(mine['stand-days:createEvent'].may, true);
    assert.equal(mine['stand-polls:draftPoll'].may, false, 'a member without Votes\' create');
    assert.equal(mine['stand-polls:addPoll'].may, true, 'a local action without takes: read is enough, as before');
    assert.equal((await actionsOf(admin))['stand-polls:draftPoll'].may, true, 'an owner has every permission');
    assert.equal((await actionsOf(admin))['stand-polls:draftPoll'].takes[0].may, true);
    // The module's own list (host.actions) leaves out an action whose every entry the viewer is refused.
    const busList = async (token) => (await call('GET', `/api/bus/actions?from=stand-asker&scope=space&space=${S}`, { token })).json.actions.map((a) => a.action);
    assert.ok(!(await busList(pat)).includes('stand-polls:draftPoll'), 'refused every entry: left out');
    assert.ok((await busList(pat)).includes('stand-polls:addPoll'), 'no takes: listed as before');
    assert.ok((await busList(admin)).includes('stand-polls:draftPoll'), 'the owner sees it');
    assert.equal((await call('PATCH', '/api/roles/member', { token: admin, body: { 'module.stand-polls.create': true } })).status, 200);
    assert.equal((await actionsOf(pat))['stand-polls:draftPoll'].may, true, 'granted to members');
    // The module's own list (host.actions) carries takes too.
    const bus = await call('GET', `/api/bus/actions?from=stand-asker&scope=space&space=${S}`, { token: pat });
    assert.equal(bus.status, 200, bus.text);
    assert.deepEqual(bus.json.actions.find((a) => a.action === 'stand-days:createEvent').takes, mine['stand-days:createEvent'].takes);
    assert.ok(bus.json.actions.some((a) => a.action === 'stand-polls:draftPoll'), 'granted: listed');
    assert.equal((await call('PATCH', '/api/roles/member', { token: admin, body: { 'module.stand-polls.create': false } })).status, 200);
  });

  await test('live: the object input is kept as the format keeps it, and refused with its sentence', async () => {
    const flight = { kind: 'flight', title: 'Southwest 1234', details: { airline: '**Southwest**', number: 1234, from: 'MDW', to: 'SJC', departs: '2026-11-14T12:50', arrives: '2026-11-14T15:25', reference: 'ABC123', wings: 2 }, sources: [1] };
    let r = await send(pat, 'stand-plans:acceptSuggestion', { title: 'Southwest 1234', object: flight });
    assert.equal(r.status, 200, r.text);
    const kept = (await pending('stand-plans')).find((a) => a.id === r.json.id);
    assert.deepEqual(kept.input, { title: 'Southwest 1234', object: { icon: 'note', title: 'Southwest 1234', kind: 'flight', details: { airline: 'Southwest', number: '1234', from: { code: 'MDW' }, to: { code: 'SJC' }, departs: '2026-11-14T12:50', arrives: '2026-11-14T15:25', reference: 'ABC123' } } });
    // An attraction (#246): a stop like a sight, with the same details, taken where the sight-like kinds are and not by Days.
    const park = { kind: 'attraction', title: 'Gilroy Gardens', date: '2026-11-15', details: { starts: '2026-11-15T10:00', ends: '2026-11-15T16:00', minutes: 360, address: '3050 Hecker Pass Hwy', tickets: 4, reference: 'GG-77', rides: 'all' } };
    r = await send(pat, 'stand-plans:acceptSuggestion', { title: 'Gilroy Gardens', object: park });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual((await pending('stand-plans')).find((a) => a.id === r.json.id).input.object, { icon: 'note', title: 'Gilroy Gardens', kind: 'attraction', date: '2026-11-15', details: { starts: '2026-11-15T10:00', ends: '2026-11-15T16:00', minutes: 360, address: '3050 Hecker Pass Hwy', tickets: 4, reference: 'GG-77' } });
    r = await send(pat, 'stand-days:createEvent', { object: park });
    assert.deepEqual([r.status, r.json], [400, { error: 'Days cannot take an attraction' }]);
    // A kind the catalogue does not know is no kind: the object is an object with no kind, which the typed keeper refuses.
    r = await send(pat, 'stand-plans:acceptSuggestion', { title: 'Zoo', object: { kind: 'zoo', title: 'Zoo', details: { tickets: 4 } } });
    assert.deepEqual([r.status, r.json], [400, { error: 'object needs a title, and content or details' }], 'an unknown kind has no details either');
    r = await send(pat, 'stand-plans:acceptSuggestion', { title: 'Zoo', object: { kind: 'zoo', title: 'Zoo', content: 'the zoo' } });
    assert.deepEqual([r.status, r.json], [400, { error: 'Plans cannot take an object with no kind' }]);
    r = await send(pat, 'stand-days:createEvent', { object: flight });
    assert.deepEqual([r.status, r.json], [400, { error: 'Days cannot take a flight' }]);
    r = await send(pat, 'stand-days:createEvent', { object: { kind: 'hotel', title: 'Casa', content: 'x' } });
    assert.deepEqual([r.status, r.json], [400, { error: 'Days cannot take a hotel' }]);
    r = await send(pat, 'stand-days:createEvent', { object: { kind: 'event', title: 'Concert', details: { starts: '2026-11-15T20:00', allDay: false } } });
    assert.equal(r.status, 200, 'an event');
    r = await send(pat, 'stand-days:createEvent', { object: { title: 'Dinner Friday', content: 'Dinner Friday at 7', date: '2026-11-13' } });
    assert.equal(r.status, 200, 'a message\'s words');
    assert.deepEqual((await pending('stand-days')).find((a) => a.id === r.json.id).input, { object: { icon: 'note', title: 'Dinner Friday', content: 'Dinner Friday at 7', date: '2026-11-13' } });
    r = await send(pat, 'stand-days:createEvent', { object: { kind: 'image', title: 'beach.jpg', details: { upload: 'a'.repeat(24) } } });
    assert.deepEqual([r.status, r.json], [400, { error: 'Days cannot take an image' }]);
    r = await send(pat, 'stand-notes:savePhoto', { object: { kind: 'image', title: 'beach.jpg', details: { upload: 'b'.repeat(24), name: 'beach.jpg' } } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual((await pending('stand-notes')).find((a) => a.id === r.json.id).input.object, { icon: 'note', title: 'beach.jpg', kind: 'image', details: { upload: 'b'.repeat(24), name: 'beach.jpg' } });
    for (const upload of ['../../etc/passwd', undefined, 12]) {
      r = await send(pat, 'stand-notes:savePhoto', { object: { kind: 'image', title: 'beach.jpg', content: 'a caption', details: { upload } } });
      assert.deepEqual([r.status, r.json], [400, { error: 'object is a picture, so its details.upload must be the id of a file uploaded to the module' }], String(upload));
    }
    r = await send(pat, 'stand-days:createEvent', { object: { title: 'T', content: 'x'.repeat(70000) } });
    assert.deepEqual([r.status, r.json], [413, { error: 'that request is over 64 KB' }]);
    r = await send(pat, 'stand-notes:savePhoto', { object: { title: 'Just words', content: 'x' } });
    assert.deepEqual([r.status, r.json], [400, { error: 'Notes cannot take an object with no kind' }]);
    r = await send(pat, 'stand-days:createEvent', { object: 'Concert' });
    assert.deepEqual([r.status, r.json], [400, { error: 'object must be an object' }]);
    r = await send(pat, 'stand-days:createEvent', { object: [{ title: 'T', content: 'c' }] });
    assert.deepEqual([r.status, r.json], [400, { error: 'object must be an object' }]);
    r = await send(pat, 'stand-days:createEvent', { object: { content: 'no title' } });
    assert.deepEqual([r.status, r.json], [400, { error: 'object needs a title, and content or details' }]);
    r = await send(pat, 'stand-notes:savePhoto', {});
    assert.deepEqual([r.status, r.json], [400, { error: 'object is needed' }], 'a required object');
    // Without an object, an action keeps working as before.
    r = await send(pat, 'stand-plans:acceptSuggestion', { title: 'Lunch', kind: 'restaurant' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual((await pending('stand-plans')).find((a) => a.id === r.json.id).input, { title: 'Lunch', kind: 'restaurant' });
  });

  await test('live: a takes permission is checked on the request too', async () => {
    let r = await send(pat, 'stand-polls:draftPoll', { object: { kind: 'poll', title: 'Where to?', details: { options: ['Faro', 'Lagos'] } } });
    assert.deepEqual([r.status, r.json], [403, { error: 'you may not add a poll to Votes here' }]);
    r = await send(pat, 'stand-polls:draftPoll', { object: { kind: 'task', title: 'Pack', content: 'x' } });
    assert.deepEqual([r.status, r.json], [400, { error: 'Votes cannot take a task' }], 'a kind not taken is said first');
    r = await send(admin, 'stand-polls:draftPoll', { object: { kind: 'poll', title: 'Where to?', details: { options: ['Faro', 'Lagos'] } } });
    assert.equal(r.status, 200, r.text);
  });

  await test('live: the person who asked reads how it went, and nobody else; only ok, error and note come back', async () => {
    const status = (token, id, space = S, q = '') => call('GET', `/api/spaces/${space}/action/${id}${q}`, { token });
    const finish = (id, result) => call('POST', '/api/bus/actions/complete', { token: admin, body: { module: 'stand-days', id, scope: 'space', space: S, result } });
    let r = await send(pat, 'stand-days:createEvent', { object: { kind: 'event', title: 'Concert', details: { starts: '2026-11-15T20:00' } } });
    assert.equal(r.status, 200, r.text);
    const id = r.json.id;
    r = await status(pat, id);
    assert.deepEqual([r.status, r.json], [200, { id, status: 'pending' }]);
    assert.equal((await call('POST', '/api/bus/actions/claim', { token: admin, body: { module: 'stand-days', id, scope: 'space', space: S } })).json.ok, true);
    assert.deepEqual((await status(pat, id)).json, { id, status: 'claimed' });
    const note = `Dated 2027-03-01, outside the plan: it is under Not on a day yet.\n\u0007${'x'.repeat(400)}`;
    assert.equal((await finish(id, { ok: true, data: { note, results: ['someone else\'s'] }, ref: { module: 'stand-days', kind: 'event', id: 'e1', scope: 'space', space: S } })).json.ok, true);
    r = await status(pat, id);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(Object.keys(r.json), ['id', 'status', 'ok', 'note'], 'nothing but the outcome');
    assert.equal(r.json.ok, true);
    assert.equal(r.json.note.length, 300, 'a note is cut to 300 characters');
    assert.ok(r.json.note.startsWith('Dated 2027-03-01, outside the plan: it is under Not on a day yet. x'), 'one line');
    // A refusal: the module's sentence; an empty one leaves error out.
    r = await send(pat, 'stand-days:createEvent', { object: { title: 'Pack', content: 'x' } });
    const failed = r.json.id;
    await call('POST', '/api/bus/actions/claim', { token: admin, body: { module: 'stand-days', id: failed, scope: 'space', space: S } });
    await finish(failed, { ok: false, error: 'that needs a day to go on the calendar' });
    assert.deepEqual((await status(pat, failed)).json, { id: failed, status: 'done', ok: false, error: 'that needs a day to go on the calendar' });
    // Nobody else, not even an owner, and not from another place; a guest is refused outright.
    assert.deepEqual([(await status(admin, id)).status, (await status(admin, id)).json], [404, { error: 'no such request' }], 'an owner reads only their own');
    const other = (await call('POST', '/api/spaces', { token: admin, body: { name: 'Elsewhere', members: [made.json.user.key] } })).json.space.id;
    assert.deepEqual((await status(pat, id, other)).json, { error: 'no such request' }, 'asked from another space');
    assert.equal((await status(pat, id, other)).status, 404);
    assert.deepEqual([(await status(pat, 99999)).status, (await status(pat, 99999)).json], [404, { error: 'no such request' }]);
    for (const bad of ['abc', '0', '-1', '1.5', '12345678901234567']) {
      r = await status(pat, bad);
      assert.deepEqual([r.status, r.json], [400, { error: 'a request id is a whole number' }], bad);
    }
    r = await call('GET', `/api/spaces/${S}/action/${id}`);
    assert.equal(r.status, 401, 'signed out');
    const link = await call('POST', `/api/spaces/${S}/guest-link`, { token: admin, body: {} });
    assert.equal(link.status, 200, link.text);
    r = await status(undefined, id, S, `?guest=${encodeURIComponent(link.json.space.guestToken)}`);
    assert.deepEqual([r.status, r.json], [403, { error: 'Guests can\'t see how a request went' }]);
    // A request the person made through a module (the bus) in this space is theirs too.
    r = await call('POST', '/api/bus/actions/request', { token: pat, body: { from: 'stand-asker', action: 'stand-days:createEvent', input: { title: 'Dinner' }, scope: 'space', space: S } });
    assert.deepEqual((await status(pat, r.json.id)).json, { id: r.json.id, status: 'pending' });
  });

  await test('live: Keep and Send to... asking a local action: handed out at once, with its minute (its end is below)', async () => {
    let r = await send(admin, 'stand-polls:draftPoll', { object: { kind: 'poll', title: 'Lunch?', details: { options: ['Yes', 'No'] } } });
    assert.equal(r.status, 200, r.text);
    const kept = (await pending('stand-polls')).find((a) => a.id === r.json.id);
    assert.ok(kept, 'handed out at once');
    assert.deepEqual((await call('GET', `/api/spaces/${S}/action/${r.json.id}`, { token: admin })).json, { id: r.json.id, status: 'pending' });
  });

  await test('live: one person asks Chat for at most 60 requests a minute, every module together; a refusal does not count', async () => {
    const lee = await call('POST', '/api/users', { token: admin, body: { login: 'lee', displayName: 'Lee', role: 'member', password: 'memberpass1234' } });
    assert.equal(lee.status, 201, lee.text);
    assert.equal((await call('PATCH', `/api/spaces/${S}`, { token: admin, body: { members: [made.json.user.key, lee.json.user.key] } })).status, 200);
    const leeToken = await signIn('lee', 'memberpass1234');
    let r = await send(leeToken, 'stand-days:createEvent', { object: 'not one' });
    assert.equal(r.status, 400, 'a refused input is not counted');
    for (let i = 0; i < 60; i += 1) {
      r = await send(leeToken, i % 2 ? 'stand-days:createEvent' : 'stand-tasks:createTask', { title: `Thing ${i}` });
      assert.equal(r.status, 200, `request ${i + 1}: ${r.text}`);
    }
    r = await send(leeToken, 'stand-plans:acceptSuggestion', { title: 'One more' });
    assert.deepEqual([r.status, r.json], [429, { error: 'too many requests in a minute, slow down' }], 'the 61st, to yet another module');
    assert.equal((await send(pat, 'stand-days:createEvent', { title: 'Someone else' })).status, 200, 'counted per person');
  });

  await test('live: a module asking through the bus is held to the same takes', async () => {
    const ask = (input) => call('POST', '/api/bus/actions/request', { token: pat, body: { from: 'stand-asker', action: 'stand-days:createEvent', input, scope: 'space', space: S } });
    let r = await ask({ object: { kind: 'flight', title: 'SW', details: { number: '1' } } });
    assert.deepEqual([r.status, r.json], [400, { error: 'Days cannot take a flight' }]);
    r = await ask({ object: { kind: 'task', title: 'Pack', details: { due: '2026-11-12' } } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual((await pending('stand-days')).find((a) => a.id === r.json.id).input, { object: { icon: 'note', title: 'Pack', kind: 'task', details: { due: '2026-11-12' } } });
  });

  await test('live: a date on the bus must be a day that exists; needs ["date"] with no ref input is kept', async () => {
    const ask = (input) => call('POST', '/api/bus/actions/request', { token: pat, body: { from: 'stand-asker', action: 'stand-days:createEvent', input, scope: 'space', space: S } });
    for (const date of ['2026-02-31', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00']) {
      const r = await ask({ title: 'Dinner', date });
      assert.deepEqual([r.status, r.json], [400, { error: 'date must be a date' }], date);
    }
    for (const at of ['2026-02-31T10:00', '2026-02-30T10:00:00Z', 'not a time']) {
      const r = await ask({ title: 'Dinner', at });
      assert.deepEqual([r.status, r.json], [400, { error: 'at must be a date and time' }], at);
    }
    let r = await ask({ title: 'Dinner', date: '2028-02-29', at: '2028-02-29T19:30:00Z' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual((await pending('stand-days')).find((a) => a.id === r.json.id).input, { title: 'Dinner', date: '2028-02-29', at: '2028-02-29T19:30:00.000Z' }, 'a leap day is a day');
    r = await ask({ title: 'Dinner' });
    assert.equal(r.status, 200, 'needs is for the asking side: the bus does not refuse a request without the optional date');
    const listed = await call('GET', `/api/bus/actions?from=stand-asker&scope=space&space=${S}`, { token: pat });
    assert.deepEqual(listed.json.actions.find((a) => a.action === 'stand-days:createEvent').needs, ['date']);
  });

  await test('live: the copied instructions list what the enabled modules take; the schema is the whole catalogue', async () => {
    const shown = async () => (await call('GET', '/api/objects/format', { token: pat })).json;
    let format = await shown();
    assert.match(format.instructions, /Set "kind" to what the object is: flight, train, bus, ferry, car, hotel, restaurant, cafe, bar, sight, museum, attraction, tour, show, event, task, poll or note\./);
    assert.match(format.instructions, /\n- task: due\n/);
    assert.deepEqual(format.schema.$defs.object.properties.kind.enum, KINDS);
    await turn('stand-polls', false);
    format = await shown();
    assert.ok(!/\bpoll\b/.test(format.instructions), 'Votes off: no poll');
    await turn('stand-plans', false);
    format = await shown();
    assert.match(format.instructions, /Set "kind" to what the object is: task\. /);
    assert.ok(!format.instructions.includes('flight'));
    assert.deepEqual(format.schema.$defs.object.properties.kind.enum, KINDS, 'the schema stays one schema');
    await turn('stand-older', true);
    format = await shown();
    assert.match(format.instructions, /Set "kind" to what the object is: flight, train, bus, ferry, car, hotel, restaurant, cafe, bar, sight, museum, attraction, tour, show or task\./, 'the old typed keeper beside Tasks: the travel kinds and task');
    await turn('stand-older', false);
    for (const id of ['stand-days', 'stand-tasks', 'stand-notes']) await turn(id, false);
    format = await shown();
    assert.ok(!format.instructions.includes('Set "kind"'), 'nothing takes a kind: no kind line');
    for (const id of ['stand-days', 'stand-plans', 'stand-tasks', 'stand-notes', 'stand-polls']) await turn(id, true);
  });

  await test('live: a request already waiting in bus.json from before still runs', async () => {
    await server.stop();
    const file = path.join(dataDir, 'modules', 'bus.json');
    const bus = JSON.parse(fs.readFileSync(file, 'utf8'));
    const old = { id: bus.seq + 1, at: Date.now() - 3600000, from: 'stand-plans', provider: 'stand-plans', action: 'acceptSuggestion', input: { title: 'Casa do Largo', kind: 'hotel', content: 'Stay.', date: '2026-11-14' }, scopeKey: `space:${S}`, by: made.json.user.key, status: 'pending', claimedAt: 0, result: null };
    bus.seq = old.id;
    bus.actions.push(old);
    fs.writeFileSync(file, JSON.stringify(bus));
    server = await startServer();
    ({ call, signIn } = server);
    const again = await signIn('admin', 'testpass1234');
    const waiting = (await call('GET', `/api/bus/actions/pending?module=stand-plans&scope=space&space=${S}`, { token: again })).json.actions.find((a) => a.id === old.id);
    assert.deepEqual(waiting.input, old.input, 'read as it was stored');
    const claimed = await call('POST', '/api/bus/actions/claim', { token: again, body: { module: 'stand-plans', id: old.id, scope: 'space', space: S } });
    assert.equal(claimed.json.ok, true, claimed.text);
    const done = await call('POST', '/api/bus/actions/complete', { token: again, body: { module: 'stand-plans', id: old.id, scope: 'space', space: S, result: { ok: true } } });
    assert.equal(done.json.ok, true, done.text);
  });

  await test('live: after its minute a local request is not handed out and reads expired; a finished one is read for ten minutes; a picture never added goes', async () => {
    await server.stop();
    const file = path.join(dataDir, 'modules', 'bus.json');
    const bus = JSON.parse(fs.readFileSync(file, 'utf8'));
    const poll = bus.actions.find((a) => a.action === 'draftPoll' && a.expiresAt && a.status === 'pending');
    assert.ok(poll, 'the request above carries its minute');
    poll.expiresAt = Date.now() - 1000;
    const patKey = made.json.user.key;
    const old = (id, extra) => ({ id, at: Date.now() - 8 * 24 * 3600 * 1000, from: 'stand-notes', provider: 'stand-notes', action: 'savePhoto', scopeKey: `space:${S}`, by: patKey, status: 'pending', claimedAt: 0, result: null, ...extra });
    const picture = (fid) => ({ object: { icon: 'note', title: 'beach.jpg', kind: 'image', details: { upload: fid, name: 'beach.jpg' } } });
    const [mine, theirs, used] = ['c', 'd', 'e'].map((ch) => ch.repeat(24));
    const uploads = path.join(dataDir, 'modules', 'stand-notes', 'uploads', `space-${S}`);
    fs.mkdirSync(uploads, { recursive: true });
    for (const [fid, by] of [[mine, patKey], [theirs, 'someoneelse'], [used, patKey]]) {
      fs.writeFileSync(path.join(uploads, `${fid}.bin`), 'x');
      fs.writeFileSync(path.join(uploads, `${fid}.json`), JSON.stringify({ id: fid, name: 'beach.jpg', type: 'image/jpeg', size: 1, by, at: new Date().toISOString(), thumb: false }));
    }
    const dataFile = path.join(dataDir, 'modules', 'stand-notes', 'data', `space-${S}.json`);
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify({ 'photo:1': { value: { file: used }, version: 1, updatedAt: new Date().toISOString(), by: patKey } }));
    let seq = bus.seq;
    bus.actions.push(old(++seq, { input: picture(mine) }), old(++seq, { input: picture(theirs) }), old(++seq, { input: picture(used) }));
    const finishedLongAgo = { ...old(++seq, { input: { title: 'Dinner' } }), at: Date.now() - 3600000, status: 'done', doneAt: Date.now() - BUS_LIMITS.resultMs - 1000, result: { ok: true } };
    const finishedNow = { ...finishedLongAgo, id: ++seq, doneAt: Date.now() - 60000, result: { ok: true, data: { note: 'Kept.' } } };
    const finishedBefore = { ...finishedLongAgo, id: ++seq, at: Date.now() - 60000, doneAt: undefined };
    bus.actions.push(finishedLongAgo, finishedNow, finishedBefore);
    bus.seq = seq;
    fs.writeFileSync(file, JSON.stringify(bus));
    server = await startServer();
    ({ call, signIn } = server);
    const owner = await signIn('admin', 'testpass1234');
    const pat2 = await signIn('pat', 'memberpass1234');
    const polls = (await call('GET', `/api/bus/actions/pending?module=stand-polls&scope=space&space=${S}`, { token: owner })).json.actions;
    assert.ok(!polls.some((a) => a.id === poll.id), 'not handed out after its minute');
    const claimed = await call('POST', '/api/bus/actions/claim', { token: owner, body: { module: 'stand-polls', id: poll.id, scope: 'space', space: S } });
    assert.equal(claimed.json.ok, false, 'nor claimed');
    assert.deepEqual((await call('GET', `/api/spaces/${S}/action/${poll.id}`, { token: owner })).json, { id: poll.id, status: 'expired' });
    const completed = await call('POST', '/api/bus/actions/complete', { token: owner, body: { module: 'stand-polls', id: poll.id, scope: 'space', space: S, result: { ok: true } } });
    assert.deepEqual([completed.status, completed.json], [200, { ok: false }], 'nor completed by a page that never claimed it');
    assert.deepEqual((await call('GET', `/api/spaces/${S}/action/${poll.id}`, { token: owner })).json, { id: poll.id, status: 'expired' }, 'still expired');
    const status = (id) => call('GET', `/api/spaces/${S}/action/${id}`, { token: pat2 });
    assert.deepEqual([(await status(finishedLongAgo.id)).status, (await status(finishedLongAgo.id)).json], [404, { error: 'no such request' }], 'finished more than ten minutes ago');
    assert.deepEqual((await status(finishedNow.id)).json, { id: finishedNow.id, status: 'done', ok: true, note: 'Kept.' });
    assert.deepEqual((await status(finishedBefore.id)).json, { id: finishedBefore.id, status: 'done', ok: true }, 'finished before doneAt was kept: read by when it was asked');
    // The next request prunes: the week-old picture requests go, and with them only the picture nobody else uploaded or used.
    const r = await call('POST', `/api/spaces/${S}/action`, { token: pat2, body: { action: 'stand-days:createEvent', input: { title: 'Lunch' } } });
    assert.equal(r.status, 200, r.text);
    assert.equal(fs.existsSync(path.join(uploads, `${mine}.bin`)) || fs.existsSync(path.join(uploads, `${mine}.json`)), false, 'the picture of a request that never ran is removed');
    assert.ok(fs.existsSync(path.join(uploads, `${theirs}.json`)), 'a file someone else uploaded stays');
    assert.ok(fs.existsSync(path.join(uploads, `${used}.json`)), 'a file the module\'s data names stays');
    const after = JSON.parse(fs.readFileSync(file, 'utf8')).actions.map((a) => a.id);
    assert.ok(!after.includes(seq - 3) && !after.includes(seq - 4) && !after.includes(seq - 5), 'the week-old requests are gone');
  });
} finally {
  if (server) await server.stop();
  fs.rmSync(base, { recursive: true, force: true });
}

console.log(`check-object-handoff: OK (${n} checks)`);
