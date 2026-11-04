#!/usr/bin/env node
/*
 * check-seed-demo.mjs -- the demo seeder (tools/seed-demo.mjs, `npm run seed:demo`).
 * Boots a throwaway server, seeds it twice with a faked "today" (the seeder takes the day as an argument; SEED_TODAY in use), and
 * asserts: the trip starts after that day; every Planner object kind, journey mode, stop type and marker appears, with a stay, a car
 * with different pick-up and drop-off days, an empty day, and unscheduled objects with and without a phase; every module has content;
 * the second run gives the same counts and a new space (the first is gone); another space, its data and another account are left
 * untouched; a wrong password and a missing server are refused in one plain sentence; the target URL follows SEED_URL, then PORT.
 * Also: every bundled module is on; the place search is chosen; each earlier phase holds dated Planner objects, to-dos, Calendar
 * events (and Planning, a dated Research object); a hosted install is refused without DEMO_ALLOW_HOSTED, DEMO_ENVIRONMENT and the
 * environment's own address (a fake hosted answer stands in for the server). No LiveKit and no browser are needed.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runSeed, resolveTarget, dayPlus, SPACE_NAME } from './seed-demo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASSWORD = 'testpass1234';
const TODAY = '2031-03-01'; // not the real day, so the seeder must use the day it is given

// The address it targets.
assert.equal(resolveTarget({ SEED_URL: 'http://example.test:9/' }), 'http://example.test:9');
assert.equal(resolveTarget({ PORT: '3100' }), 'http://localhost:3100');
assert.equal(resolveTarget({}), 'http://localhost:3000');
assert.equal(resolveTarget({ SEED_URL: 'http://a:1', PORT: '3100' }), 'http://a:1');

const port = await new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-demo-'));
const child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), DATA_DIR: dataDir, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ADMIN_PASSWORD: PASSWORD } });
let log = '';
child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
const base = `http://127.0.0.1:${port}`;
const stop = async () => { if (child.exitCode === null) { const gone = new Promise((r) => child.once('exit', r)); child.kill('SIGTERM'); await Promise.race([gone, new Promise((r) => setTimeout(r, 8000))]); } fs.rmSync(dataDir, { recursive: true, force: true }); };
let failed = null;
try {
  for (let i = 0; i < 150; i += 1) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(`the throwaway server did not start: ${log.slice(-400)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const quiet = () => {};
  const jar = {};
  const api = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(jar.c ? { cookie: jar.c } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (url === '/api/login') jar.c = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    return { status: r.status, json: await r.json().catch(() => null) };
  };

  // Refusals, in one plain sentence each.
  await assert.rejects(runSeed({ base: 'http://127.0.0.1:9', adminPassword: PASSWORD, today: TODAY, say: quiet }), /No server answered at http:\/\/127\.0\.0\.1:9\. Start it with npm run dev, or set SEED_URL\./);
  await assert.rejects(runSeed({ base, adminPassword: 'wrong-password', today: TODAY, say: quiet }), /Could not sign in as admin/);
  await assert.rejects(runSeed({ base, adminPassword: '', today: TODAY, say: quiet }), /Set ADMIN_PASSWORD/);
  await assert.rejects(runSeed({ base, adminPassword: PASSWORD, today: 'tomorrow', say: quiet }), /SEED_TODAY must be a day/);

  // A hosted install: refused unless allowed, named and addressed as that one environment (a stand-in server answers as hosted).
  const fake = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(req.url === '/api/branding' ? JSON.stringify({ hosted: true, phases: [] }) : '{}'); });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const hostedBase = `http://127.0.0.1:${fake.address().port}`;
  await assert.rejects(runSeed({ base: hostedBase, adminPassword: PASSWORD, today: TODAY, say: quiet }), /hosted install .* DEMO_ALLOW_HOSTED=1 and DEMO_ENVIRONMENT/);
  await assert.rejects(runSeed({ base: hostedBase, adminPassword: PASSWORD, today: TODAY, say: quiet, allowHosted: true }), /set DEMO_ENVIRONMENT/);
  await assert.rejects(runSeed({ base: hostedBase, adminPassword: PASSWORD, today: TODAY, say: quiet, allowHosted: true, demoEnvironment: 'demo' }), /SEED_URL must be the demo environment's own address \(demo\.<your domain>\).*nothing was changed/);
  fake.close();

  // Something else that must survive: a space with a task in it, and another account.
  await api('POST', '/api/login', { login: 'admin', password: PASSWORD });
  await api('PATCH', '/api/settings', { template: 'travel' });
  await api('PATCH', '/api/settings', { showCalendar: true });
  for (const id of ['todo']) { await api('POST', `/api/modules/bundled/${id}/install`); await api('PATCH', `/api/modules/${id}`, { enabled: true }); }
  const kim = (await api('POST', '/api/users', { login: 'kim', displayName: 'Kim Other', role: 'member', password: 'kim-password-1' })).json.user;
  const other = (await api('POST', '/api/spaces', { name: 'Other trip', description: 'Mine.', members: [kim.key] })).json.space;
  const put = await api('PUT', `/api/modules/todo/data/task:keep?scope=space&space=${other.id}`, { value: { id: 'keep', title: 'Keep me', notes: '', due: null, done: false, remind: false, doneAt: null, createdAt: 1, by: 'Kim', links: [] } });
  assert.equal(put.status, 200, 'the bystander task is written');

  const first = await runSeed({ base, adminPassword: PASSWORD, today: TODAY, say: quiet, noAi: true });
  const second = await runSeed({ base, adminPassword: PASSWORD, today: TODAY, say: quiet, noAi: true });
  assert.notEqual(first.space.id, second.space.id, 'the second run made a new demo space');
  assert.deepEqual(second.counts, first.counts, 'the same counts after a second run');

  // Only one demo space; the old one is gone; the other space and account are as they were.
  const spaces = (await api('GET', '/api/spaces')).json.spaces;
  assert.equal(spaces.filter((s) => s.name === SPACE_NAME).length, 1, 'exactly one demo space');
  assert.ok(spaces.some((s) => s.id === other.id && s.name === 'Other trip'), 'the other space is still there');
  const task = await api('GET', `/api/modules/todo/data/task:keep?scope=space&space=${other.id}`);
  assert.equal(task.json.item.value.title, 'Keep me', 'the other space keeps its data');
  const users = (await api('GET', '/api/users')).json.users;
  assert.ok(users.some((u) => u.login === 'kim' && u.displayName === 'Kim Other'), 'the other account is untouched');
  for (const login of ['mia', 'lee', 'sam']) assert.equal(users.filter((u) => u.login === login).length, 1, `one ${login}`);
  assert.ok(second.space.members.length >= 4, 'the three people and the admin are in the space');
  assert.ok(second.guestUrl && /\/guest\//.test(second.guestUrl), 'a guest link is made');
  assert.ok(second.pass.mia && second.pass.mia !== PASSWORD, 'a one-time password that is not the admin\'s');

  // The trip is in the future of the day it was given, ten days long, and the phases follow it.
  const trip = (await api('GET', `/api/modules/travel/data/trip:main?scope=space&space=${second.space.id}`)).json.item.value;
  assert.ok(trip.start > TODAY, 'the trip starts after today');
  assert.equal(trip.start, dayPlus(TODAY, 45));
  assert.equal(trip.end, dayPlus(trip.start, 9));
  const phases = (await api('GET', `/api/spaces/${second.space.id}`)).json.space.phases;
  assert.equal(Object.keys(phases).length, 6, 'dates on all six phases');
  assert.equal(phases.trip.start, trip.start);
  assert.ok(phases.planning.start <= TODAY && phases['pre-trip'].start < trip.start, 'the earlier phases are before the trip');

  // Every bundled module is on, and the place search is chosen.
  const mods = (await api('GET', '/api/modules')).json;
  for (const b of mods.bundled) assert.ok(mods.modules.some((m) => m.id === b.id && m.enabled), `the ${b.id} module is on`);
  assert.ok(first.configured.some((l) => /^Place search: Photon/.test(l)), 'the place search is set to Photon');
  const placesSet = (await api('GET', '/api/module-settings/environment')).json.modules.find((m) => m.id === 'places').settings;
  assert.equal(placesSet.find((x) => x.key === 'searchProvider').value, 'photon');

  // Every earlier phase holds dated content: Planner objects, to-dos, Calendar events (Planning also a Research object).
  const ids = Object.keys(phases);
  const order = ['planning', 'booking', 'buffer', 'pre-trip', 'trip'];
  const rangeOf = (id) => { const next = order[order.indexOf(id) + 1]; return [phases[id].start, dayPlus(phases[next].start, -1)]; };
  const within = (day, [a, b]) => Boolean(day) && String(day).slice(0, 10) >= a && String(day).slice(0, 10) <= b;
  const allTasks = (await api('GET', `/api/modules/todo/data?scope=space&space=${second.space.id}&prefix=task:`)).json.items.map((i) => i.value);
  const allEvents = (await api('GET', `/api/modules/calendar/data?scope=space&space=${second.space.id}&prefix=event:`)).json.items.map((i) => i.value);
  const research = (await api('GET', `/api/modules/research/data?scope=space&space=${second.space.id}&prefix=`)).json.items.map((i) => i.value);
  for (const id of order.slice(0, 4)) {
    assert.ok(ids.includes(id), `${id} is dated`);
    const r = rangeOf(id);
    assert.ok(r[1] >= r[0], `${id} has days`);
    assert.ok(second.planRows.filter((i) => i.kind !== 'lane' && within(i.date, r)).length >= 2, `${id} has dated Planner objects`);
    assert.ok(allTasks.some((t) => within(t.due, r)), `${id} has a dated to-do`);
    assert.ok(allEvents.some((e) => within(e.start, r)), `${id} has a Calendar event`);
  }
  assert.ok(research.some((v) => within(v.date, rangeOf('planning'))), 'a Research object is dated inside Planning');
  assert.ok(second.planRows.some((i) => i.confirm && within(i.date, rangeOf('booking'))), 'a booked reservation inside Booking');

  // Every kind of Planner object.
  const plan = second.planRows;
  const has = (f) => plan.some(f);
  for (const kind of ['stop', 'stay', 'journey', 'note', 'link', 'block', 'lane']) assert.ok(has((i) => i.kind === kind), `a ${kind}`);
  for (const mode of ['flight', 'train', 'car', 'taxi', 'rideshare']) assert.ok(has((i) => i.kind === 'journey' && i.mode === mode), `a ${mode}`);
  for (const type of ['restaurant', 'cafe', 'bar', 'sight', 'museum', 'attraction', 'tour', 'show', 'shop', 'other']) assert.ok(has((i) => i.kind === 'stop' && i.type === type), `a ${type} stop`);
  for (const type of ['meet-up', 'free-day', 'travel-day', 'free-time', 'leave-by']) assert.ok(has((i) => i.kind === 'block' && i.type === type), `a ${type} marker`);
  assert.ok(has((i) => i.kind === 'lane'), 'a marker between days');
  assert.ok(plan.length >= 55, `about sixty objects (${plan.length})`);
  assert.ok(plan.filter((i) => i.kind === 'stop' && ['restaurant', 'cafe'].includes(i.type)).length >= 8, 'eight or more places to eat');
  assert.ok(plan.filter((i) => i.kind === 'stop' && ['sight', 'museum', 'attraction', 'tour'].includes(i.type)).length >= 10, 'ten or more things to see');
  assert.equal(plan.filter((i) => i.kind === 'stay').length, 2, 'two hotels');
  for (const stay of plan.filter((i) => i.kind === 'stay')) assert.ok(stay.checkOut > stay.date, 'a stay with a check-out day');
  const car = plan.find((i) => i.kind === 'journey' && i.mode === 'car');
  assert.ok(car.minutes > 1440, 'the car is kept for more than a day: pick-up and drop-off on different days');
  assert.ok(has((i) => i.kind === 'journey' && i.mode === 'flight' && i.arrives && i.seat), 'a flight with times and seats');
  assert.ok(has((i) => i.kind !== 'lane' && !i.date && i.after == null && i.phase), 'unscheduled with a phase');
  assert.ok(has((i) => i.kind !== 'lane' && !i.date && i.after == null && !i.phase && i.kind === 'stop'), 'unscheduled with no phase');
  assert.ok(has((i) => i.kind === 'link' && i.ref.module === 'calendar'), 'rows from the Calendar');
  assert.ok(has((i) => i.kind === 'link' && i.ref.module === 'places'), 'rows pointing at places');
  const days = Array.from({ length: 10 }, (_, n) => dayPlus(trip.start, n));
  const stays = plan.filter((i) => i.kind === 'stay');
  const empty = days.filter((day) => !plan.some((i) => i.date === day) && stays.some((s) => s.date < day && s.checkOut > day));
  assert.ok(empty.length >= 1, 'a day with nothing on it but its hotel');

  // Every module has content.
  const c = second.counts;
  assert.ok(c.places >= 25, `25 or more places (${c.places})`);
  assert.ok(c.calendar >= 8, 'calendar events');
  assert.equal(c.todo, 16, 'sixteen tasks');
  assert.equal(c.polls, 3, 'three polls');
  assert.ok(c.budget >= 15, 'fifteen or more costs');
  assert.equal(c.research, 4, 'four research objects');
  assert.ok(c.chat >= 20, 'chat messages');
  const events = (await api('GET', `/api/modules/calendar/data?scope=space&space=${second.space.id}&prefix=event:`)).json.items.map((i) => i.value);
  assert.ok(events.some((e) => e.repeat), 'a repeating event');
  assert.ok(events.some((e) => e.allDay), 'an all-day event');
  assert.ok(events.some((e) => e.remind), 'an event with a reminder');
  assert.ok(events.some((e) => e.title === 'Portugal trip'), 'the trip\'s own event');
  const tasks = (await api('GET', `/api/modules/todo/data?scope=space&space=${second.space.id}&prefix=task:`)).json.items.map((i) => i.value);
  assert.ok(tasks.some((t) => t.done) && tasks.some((t) => !t.done), 'some tasks done, some open');
  assert.ok(tasks.every((t) => t.due && t.due < trip.start), 'every due date is before the trip');
  const polls = (await api('GET', `/api/modules/polls/data?scope=space&space=${second.space.id}&prefix=poll:`)).json.items.map((i) => i.value);
  assert.ok(polls.some((p) => p.closed) && polls.some((p) => !p.closed && !p.closesAt) && polls.some((p) => p.closesAt), 'a closed poll, an open one, one with a deadline');
  const costs = (await api('GET', `/api/modules/budget/data?scope=space&space=${second.space.id}&prefix=cost:`)).json.items.map((i) => i.value);
  assert.ok(costs.some((x) => x.actual && x.paidBy) && costs.some((x) => !x.actual), 'costs paid and costs still owed');
  const chat = (await api('GET', `/api/spaces/${second.space.id}/chat`)).json;
  assert.ok((chat.messages || []).some((m) => /\/modules\/travel\?space=/.test(m.text || '')), 'a shared object link in the chat');

  console.log('check-seed-demo: ok');
} catch (e) {
  failed = e;
} finally {
  await stop();
}
if (failed) { console.error(failed.stack || failed); console.error(log.slice(-600)); process.exit(1); }
