#!/usr/bin/env node
/*
 * check-calendar-twins.mjs -- the Itinerary's copies in the Calendar (documentation/plans/plan-plan-calendar-sync.md), live, with
 * the bundled Itinerary (travel) and Calendar modules: the pair is flagged and offered once, a copy carries the span and the
 * trip's own zone, "All day" on a copy keeps the object's time, deleting a copy hides it for good, and a panel's address opens on it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-calendar-twins: ${name}: ${err.stack || err.message}`); }
};

function startServer(dataDir) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, TZ: 'UTC', ADMIN_PASSWORD: 'admin-password-1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const portPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  return portPromise.then((port) => ({ port, stop: () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); }) }));
}

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

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-calendar-twins-'));
let server = null;
try {
  server = await startServer(path.join(base, 'data'));
  const cookie = cookieOf(await call(server, 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
  const as = (method, url, body) => call(server, method, url, { cookie, body });
  const space = (await as('POST', '/api/spaces', { name: 'Lisbon' })).json.space.id;
  for (const id of ['travel', 'calendar', 'todo']) assert.equal((await as('POST', `/api/modules/bundled/${id}/install`, {})).status, 201, `${id} installs`);
  for (const id of ['travel', 'calendar', 'todo']) assert.equal((await as('PATCH', `/api/modules/${id}`, { enabled: true, allSpaces: true })).status, 200, id);

  const q = `scope=space&space=${space}`;
  const put = (module, key, value, tz) => as('PUT', `/api/modules/${module}/data/${encodeURIComponent(key)}?${q}`, { value, ...(tz ? { tz } : {}) });
  const get = async (module, key) => (await as('GET', `/api/modules/${module}/data/${encodeURIComponent(key)}?${q}`));
  const links = () => JSON.parse(fs.readFileSync(path.join(base, 'data', 'modules', 'links.json'), 'utf8'));
  const pairOf = (id) => links().filter((l) => l.pair && l.from.module === 'travel' && l.from.id === id);
  const copyOf = async (id) => {
    const pair = pairOf(id).find((l) => l.pair === 'active');
    assert.ok(pair, `no active copy for ${id}`);
    const got = await get('calendar', `event:${pair.to.id}`);
    assert.equal(got.status, 200, got.text);
    return { pair, value: got.json.item.value };
  };
  const search = async (from, text = '') => (await as('GET', `/api/objects/search?from=${from}&scope=space&space=${space}&q=${encodeURIComponent(text)}`)).json.summaries;

  // The trip keeps its zone; the writer (New York) is somewhere else.
  assert.equal((await put('travel', 'trip:main', { title: 'Lisbon', start: '2026-10-18', end: '2026-10-23', tz: 'Europe/Lisbon' })).status, 200);
  assert.equal((await put('travel', 'plan:flight', { kind: 'journey', mode: 'flight', title: 'Flight to Lisbon', date: '2026-10-18', time: '07:40', minutes: 175 }, 'America/New_York')).status, 200);
  assert.equal((await put('travel', 'plan:hotel', { kind: 'stay', type: 'hotel', title: 'Hotel Baixa', date: '2026-10-18', time: '15:00', checkOut: '2026-10-23', checkOutTime: '11:00' }, 'America/New_York')).status, 200);
  assert.equal((await put('travel', 'plan:fado', { kind: 'stop', title: 'Fado night', date: '2026-10-19', time: '20:00' }, 'America/New_York')).status, 200);

  await test('a 07:40 flight copy is the trip\'s own time, with the zone, and a 175-minute flight has an end', async () => {
    const { value } = await copyOf('flight');
    assert.equal(value.start, '2026-10-18T06:40:00.000Z', '07:40 in Lisbon (UTC+1 on 18 October)');
    assert.equal(value.end, '2026-10-18T09:35:00.000Z');
    assert.equal(value.tz, 'Europe/Lisbon');
    assert.equal(value.allDay, false);
    // A viewer elsewhere can be shown the same wall time and told the zone: it is representable from the stored values.
    const wall = (zone) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value.start));
    assert.equal(wall(value.tz), '07:40');
    assert.notEqual(wall('America/New_York'), '07:40', 'the viewer\'s own zone differs, so the zone note applies');
  });

  await test('a 5-night stay copy ends at its check-out', async () => {
    const { value } = await copyOf('hotel');
    assert.equal(value.start, '2026-10-18T14:00:00.000Z');
    assert.equal(value.end, '2026-10-23T10:00:00.000Z');
  });

  await test('the pair is flagged: a copy says copy and twinOf, its original lists twins', async () => {
    const { pair } = await copyOf('fado');
    const calendarRef = { module: 'calendar', kind: 'event', id: pair.to.id, scope: 'space', space };
    const planRef = { module: 'travel', kind: 'plan', id: 'fado', scope: 'space', space };
    const resolved = (await as('POST', `/api/objects/resolve?${q}`, { from: 'todo', refs: [calendarRef, planRef] })).json.summaries;
    assert.equal(resolved[0].copy, true);
    assert.deepEqual(resolved[0].twinOf, planRef);
    assert.equal(resolved[0].twins, undefined);
    assert.equal(resolved[1].copy, undefined);
    assert.deepEqual(resolved[1].twins, [calendarRef]);
  });

  await test('search offers each pair once, and the Itinerary is not offered its own objects through the Calendar', async () => {
    const forTodo = (await search('todo', 'Fado')).filter((s) => s.title === 'Fado night');
    assert.equal(forTodo.length, 1, 'once');
    assert.equal(forTodo[0].module.id, 'travel', 'the original');
    assert.equal(forTodo[0].twins.length, 1, 'with a flag that a copy exists');
    const forTravel = await search('travel');
    assert.equal(forTravel.filter((s) => s.copy).length, 0);
    assert.equal(forTravel.filter((s) => s.title === 'Fado night').length, 0, 'the Itinerary is not offered Fado night');
  });

  await test('All day on a copy keeps the object\'s time, and the copy says what the object says again', async () => {
    const { pair, value } = await copyOf('fado');
    assert.equal(value.start, '2026-10-19T19:00:00.000Z');
    const asDay = { ...value, allDay: true, start: '2026-10-19', end: null, tz: null };
    assert.equal((await put('calendar', `event:${pair.to.id}`, asDay, 'America/New_York')).status, 200);
    assert.equal((await get('travel', 'plan:fado')).json.item.value.time, '20:00');
    const after = await copyOf('fado');
    assert.equal(after.value.allDay, false);
    assert.equal(after.value.start, '2026-10-19T19:00:00.000Z');
  });

  await test('a time moved in the Calendar is read in the trip\'s zone, whoever moved it', async () => {
    const { pair, value } = await copyOf('fado');
    assert.equal((await put('calendar', `event:${pair.to.id}`, { ...value, start: '2026-10-19T20:30:00.000Z' }, 'America/New_York')).status, 200);
    assert.equal((await get('travel', 'plan:fado')).json.item.value.time, '21:30');
  });

  await test('deleting a copy hides it for good: the object stays and moving it does not make a copy again', async () => {
    const { pair } = await copyOf('fado');
    assert.equal((await as('DELETE', `/api/modules/calendar/data/${encodeURIComponent(`event:${pair.to.id}`)}?${q}`)).status, 200);
    assert.equal((await get('travel', 'plan:fado')).status, 200, 'the Itinerary keeps it');
    assert.equal(pairOf('fado')[0].pair, 'detached');
    const events = () => as('GET', `/api/modules/calendar/data?${q}`).then((r) => r.json.items.filter((i) => i.value && i.value.title === 'Fado night'));
    assert.equal((await events()).length, 0);
    assert.equal((await put('travel', 'plan:fado', { kind: 'stop', title: 'Fado night', date: '2026-10-20', time: '21:00' })).status, 200);
    assert.equal((await events()).length, 0, 'moved to another day: still hidden');
    assert.equal((await put('travel', 'plan:fado', { kind: 'stop', title: 'Fado night' })).status, 200);
    assert.equal((await put('travel', 'plan:fado', { kind: 'stop', title: 'Fado night', date: '2026-10-21' })).status, 200);
    assert.equal((await events()).length, 0, 'a day cleared and given back: still hidden');
    assert.equal(pairOf('fado').length, 1);
    const hidden = await search('todo', 'Fado');
    assert.equal(hidden.filter((s) => s.title === 'Fado night').length, 1);
    assert.equal(hidden.find((s) => s.title === 'Fado night').twins, undefined, 'a hidden copy is not a copy that exists');
  });

  await test('the panel\'s address opens on the panel: /modules/todo goes to the destination with #panel=todo', async () => {
    assert.equal((await as('PATCH', '/api/settings', { showCalendar: true })).status, 200);
    const r = await as('GET', '/modules/todo');
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/calendar#panel=todo');
    const main = await as('GET', '/modules/calendar');
    assert.equal(main.headers.location, '/calendar', 'the main keeps the bare address');
  });
} finally {
  if (server) await server.stop();
  fs.rmSync(base, { recursive: true, force: true });
}
if (failed) {
  console.error(`check-calendar-twins: ${failed} failed`);
  process.exit(1);
}
console.log(`check-calendar-twins: OK (${n})`);
process.exit(0);
