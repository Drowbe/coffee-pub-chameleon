#!/usr/bin/env node
/*
 * check-links.mjs -- links between modules stay true (documentation/plans/plan-linked-objects.md).
 * Step 1: a write or delete of a linked object sends refchange on the module stream, and only to the
 * modules that point at it. The two modules are declared here; no bundled module is named.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { buildModule } = require('../server/module-build.js');
const objectSync = require('../server/object-sync.js');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-links: ${name}: ${err.stack || err.message}`); }
};

function startServer(dataDir) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, TZ: 'UTC', ADMIN_PASSWORD: 'admin-password-1', CLEAR_UNDO_SECONDS: '1' },
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

function call(server, method, urlPath, { body, type, cookie } = {}) {
  const payload = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  const headers = { host: `127.0.0.1:${server.port}`, accept: 'application/json' };
  if (payload) { headers['content-type'] = type || 'application/json'; headers['content-length'] = payload.length; }
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

function openStream(server, cookie, space) {
  const events = [];
  let buf = '';
  let res = null;
  const req = http.request({
    host: '127.0.0.1',
    port: server.port,
    path: `/api/modules/stream?space=${encodeURIComponent(space)}`,
    headers: { host: `127.0.0.1:${server.port}`, cookie, accept: 'text/event-stream' },
  }, (response) => {
    res = response;
    response.on('data', (c) => {
      buf += c.toString('utf8');
      const parts = buf.split(/\n\n/);
      buf = parts.pop();
      for (const part of parts) {
        let event = 'message';
        let data = '';
        for (const line of part.split(/\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data || data === '') continue;
        try { events.push({ event, data: JSON.parse(data) }); } catch { /* a comment or a ping */ }
      }
    });
  });
  req.end();
  const refchanges = () => events.filter((e) => e.event === 'refchange');
  const waitFor = async (count) => {
    for (let i = 0; i < 40 && refchanges().length < count; i += 1) await new Promise((r) => setTimeout(r, 50));
  };
  return { refchanges, waitFor, close: () => { req.destroy(); if (res) res.destroy(); } };
}

function writeModule(dir, id, refs, scope = ['space']) {
  const root = path.join(dir, id);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'module.json'), JSON.stringify({
    id, name: id, version: '1.0.0', scope, icon: 'circle',
    surfaces: { canvas: { entry: `${id}.html`, menu: false } },
    refs,
  }));
  fs.writeFileSync(path.join(root, 'src', `${id}.html`), '<!DOCTYPE html><html><head><style>/*__CSS__*/</style></head><body><script>/*__JS__*/</script></body></html>');
  fs.writeFileSync(path.join(root, 'src', `${id}.css`), '');
  fs.writeFileSync(path.join(root, 'src', `${id}.js`), '');
  return root;
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-links-'));
let server = null;
let stream = null;
try {
  await test('an unknown time zone falls back, and a known one is kept', () => {
    assert.equal(objectSync.writerZone('Not/AZone'), objectSync.writerZone(''));
    assert.equal(objectSync.writerZone('UTC'), 'UTC');
    assert.equal(objectSync.writerZone('America/New_York'), 'America/New_York');
  });

  const mods = path.join(base, 'mods');
  const ownerDir = writeModule(mods, 'link-owner', {
    produces: [{ kind: 'note', name: 'Note', key: 'note:{id}', summary: { title: 'title', when: 'start' }, backlinks: true }],
    consumes: [],
  });
  const holderDir = writeModule(mods, 'link-holder', {
    produces: [{ kind: 'row', name: 'Row', key: 'row:{id}', summary: { title: 'title' } }],
    consumes: ['link-owner:note'],
  });
  const bystanderDir = writeModule(mods, 'link-bystander', {
    produces: [{ kind: 'mark', name: 'Mark', key: 'mark:{id}', summary: { title: 'title' } }],
    consumes: [],
  });
  const moverDir = writeModule(mods, 'link-mover', {
    produces: [{
      kind: 'row', name: 'Row', key: 'row:{id}', summary: { title: 'title' },
      holds: { field: 'ref', onDelete: 'remove', follow: { title: 'title', day: 'date', pin: 'pinned' } },
    }],
    consumes: ['link-owner:note'],
  });
  const markerDir = writeModule(mods, 'link-marker', {
    produces: [{
      kind: 'row', name: 'Row', key: 'row:{id}', summary: { title: 'title' },
      holds: { field: 'ref', onDelete: 'mark', markField: 'gone' },
    }],
    consumes: ['link-owner:note'],
  });

  server = await startServer(path.join(base, 'data'));
  const cookie = cookieOf(await call(server, 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
  const as = (method, url, body, type) => call(server, method, url, { cookie, body, type });
  const space = (await as('POST', '/api/spaces', { name: 'Side' })).json.space.id;
  for (const dir of [ownerDir, holderDir, bystanderDir, moverDir, markerDir]) {
    const up = await as('POST', '/api/modules', buildModule(dir).zip, 'application/zip');
    assert.equal(up.status, 201, up.text);
  }
  for (const id of ['link-owner', 'link-holder', 'link-bystander', 'link-mover', 'link-marker']) {
    assert.equal((await as('PATCH', `/api/modules/${id}`, { enabled: true, allSpaces: true })).status, 200, id);
  }
  const note = { module: 'link-owner', kind: 'note', id: 'a', scope: 'space', space };
  const put = (value, tz) => as('PUT', `/api/modules/link-owner/data/note:a?scope=space&space=${space}`, { value, ...(tz ? { tz } : {}) });
  assert.equal((await put({ title: 'One' }, 'Not/AZone')).status, 200, 'a zone the server does not know does not refuse the write');
  const linked = await as('POST', '/api/objects/links', {
    module: 'link-holder',
    from: { module: 'link-holder', kind: 'row', id: '1', scope: 'space', space },
    to: [note],
  });
  assert.equal(linked.status, 200, linked.text);
  assert.equal(linked.json.links, 1);

  stream = openStream(server, cookie, space);
  await new Promise((r) => setTimeout(r, 100));

  await test('a write to a linked object tells the module that points at it, and not one that does not', async () => {
    assert.equal((await put({ title: 'Two' })).status, 200);
    await stream.waitFor(1);
    const heard = stream.refchanges();
    assert.equal(heard.length, 1, JSON.stringify(heard));
    assert.equal(heard[0].data.change, 'updated');
    assert.deepEqual(heard[0].data.ref, note);
    assert.deepEqual(heard[0].data.modules, ['link-holder']);
  });

  await test('a write that leaves the summary the same sends nothing', async () => {
    assert.equal((await put({ title: 'Two', extra: 1 })).status, 200);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(stream.refchanges().length, 1);
  });

  await test('a delete sends deleted', async () => {
    assert.equal((await as('DELETE', `/api/modules/link-owner/data/note:a?scope=space&space=${space}`)).status, 200);
    await stream.waitFor(2);
    const heard = stream.refchanges();
    assert.equal(heard.length, 2, JSON.stringify(heard));
    assert.equal(heard[1].data.change, 'deleted');
    assert.deepEqual(heard[1].data.modules, ['link-holder']);
  });

  const noteRef = (id) => ({ module: 'link-owner', kind: 'note', id, scope: 'space', space });
  const putNote = (id, value, tz) => as('PUT', `/api/modules/link-owner/data/note:${id}?scope=space&space=${space}`, { value, ...(tz ? { tz } : {}) });
  const putRow = (mod, id, value) => as('PUT', `/api/modules/${mod}/data/row:${id}?scope=space&space=${space}`, { value });
  const getRow = async (mod, id) => (await as('GET', `/api/modules/${mod}/data/row:${id}?scope=space&space=${space}`)).json?.item;
  const linkTo = async (mod, id, to) => {
    const res = await as('POST', '/api/objects/links', {
      module: mod,
      from: { module: mod, kind: 'row', id, scope: 'space', space },
      to: [to],
    });
    assert.equal(res.status, 200, res.text);
  };
  const linksOf = () => JSON.parse(fs.readFileSync(path.join(base, 'data', 'modules', 'links.json'), 'utf8'));

  await test('a manifest with a bad holds is refused', async () => {
    const bad = async (id, holds) => {
      const dir = writeModule(mods, id, {
        produces: [{ kind: 'row', name: 'Row', key: 'row:{id}', summary: { title: 'title' }, holds }],
        consumes: [],
      });
      return as('POST', '/api/modules', buildModule(dir).zip, 'application/zip');
    };
    const wrong = await bad('link-bad-delete', { field: 'ref', onDelete: 'keep' });
    assert.equal(wrong.status, 400, wrong.text);
    assert.match(wrong.json.error, /holds\.onDelete/);
    const marked = await bad('link-bad-mark', { field: 'ref', onDelete: 'remove', markField: 'gone' });
    assert.equal(marked.status, 400, marked.text);
    assert.match(marked.json.error, /markField/);
    const named = await bad('link-bad-field', { field: 'not a field', onDelete: 'remove' });
    assert.equal(named.status, 400, named.text);
    assert.match(named.json.error, /holds\.field/);
  });

  const day = noteRef('day');
  await putNote('day', { title: 'Walk', start: '2026-06-14' });
  const rows = {
    placed: { title: 'Walk', date: '2026-06-14', pinned: false, ref: day },
    pinned: { title: 'Walk', date: '2026-06-14', pinned: true, ref: day },
    loose: { title: 'Walk', ref: day },
    other: { title: 'Walk', date: '2026-06-01', pinned: false, ref: day },
    elsewhere: { title: 'Walk', date: '2026-06-14', pinned: false, ref: { ...day, id: 'nope' } },
  };
  for (const [id, value] of Object.entries(rows)) {
    assert.equal((await putRow('link-mover', id, value)).status, 200, id);
    await linkTo('link-mover', id, day);
  }

  await test('a rename rewrites the followed title, and a pointer aimed elsewhere is left alone', async () => {
    assert.equal((await putNote('day', { title: 'Hike', start: '2026-06-14' })).status, 200);
    assert.equal((await getRow('link-mover', 'placed')).value.title, 'Hike');
    assert.equal((await getRow('link-mover', 'pinned')).value.title, 'Hike');
    assert.equal((await getRow('link-mover', 'loose')).value.title, 'Hike');
    assert.equal((await getRow('link-mover', 'other')).value.title, 'Hike');
    assert.equal((await getRow('link-mover', 'elsewhere')).value.title, 'Walk');
  });

  await test('a second identical write does not write the holder again', async () => {
    const version = (await getRow('link-mover', 'placed')).version;
    assert.equal((await putNote('day', { title: 'Hike', start: '2026-06-14' })).status, 200);
    assert.equal((await getRow('link-mover', 'placed')).version, version);
    assert.equal((await getRow('link-mover', 'elsewhere')).version, 1);
  });

  await test('a date change moves a placed holder, and leaves a pinned one, an unplaced one and one on another day', async () => {
    assert.equal((await putNote('day', { title: 'Hike', start: '2026-06-15' })).status, 200);
    assert.equal((await getRow('link-mover', 'placed')).value.date, '2026-06-15');
    assert.equal((await getRow('link-mover', 'pinned')).value.date, '2026-06-14');
    assert.equal((await getRow('link-mover', 'pinned')).value.pinned, true);
    assert.equal((await getRow('link-mover', 'loose')).value.date, undefined);
    assert.equal((await getRow('link-mover', 'other')).value.date, '2026-06-01');
  });

  await test('a time near midnight lands on the day of the person who entered it', async () => {
    const la = noteRef('la');
    await putNote('la', { title: 'Late', start: '2026-06-15T06:30:00.000Z' });
    assert.equal((await putRow('link-mover', 'la', { title: 'Late', date: '2026-06-14', pinned: false, ref: la })).status, 200);
    await linkTo('link-mover', 'la', la);
    assert.equal((await putNote('la', { title: 'Late', start: '2026-06-15T08:30:00.000Z' }, 'America/Los_Angeles')).status, 200);
    assert.equal((await getRow('link-mover', 'la')).value.date, '2026-06-15', 'Los Angeles is still on the 14th at 06:30Z and on the 15th at 08:30Z');

    const utc = noteRef('utc');
    await putNote('utc', { title: 'Late', start: '2026-06-15T23:30:00.000Z' });
    assert.equal((await putRow('link-mover', 'utc', { title: 'Late', date: '2026-06-15', pinned: false, ref: utc })).status, 200);
    await linkTo('link-mover', 'utc', utc);
    assert.equal((await putNote('utc', { title: 'Late', start: '2026-06-16T00:30:00.000Z' }, 'UTC')).status, 200);
    assert.equal((await getRow('link-mover', 'utc')).value.date, '2026-06-16');
  });

  await test('delete with remove removes the holder and its links', async () => {
    const gone = noteRef('gone');
    await putNote('gone', { title: 'Gone', start: '2026-06-14' });
    assert.equal((await putRow('link-mover', 'doomed', { title: 'Gone', date: '2026-06-14', ref: gone })).status, 200);
    await linkTo('link-mover', 'doomed', gone);
    assert.equal((await as('DELETE', `/api/modules/link-owner/data/note:gone?scope=space&space=${space}`)).status, 200);
    assert.equal((await as('GET', `/api/modules/link-mover/data/row:doomed?scope=space&space=${space}`)).status, 404);
    const left = linksOf();
    assert.equal(left.some((l) => l.from.module === 'link-mover' && l.from.id === 'doomed'), false);
    assert.equal(left.some((l) => l.to.id === 'gone'), false);
  });

  await test('delete with mark sets the mark and keeps the holder and its link', async () => {
    const stay = noteRef('stay');
    await putNote('stay', { title: 'Stay', start: '2026-06-14' });
    assert.equal((await putRow('link-marker', 'kept', { title: 'Stay', ref: stay })).status, 200);
    await linkTo('link-marker', 'kept', stay);
    assert.equal((await as('DELETE', `/api/modules/link-owner/data/note:stay?scope=space&space=${space}`)).status, 200);
    const kept = await getRow('link-marker', 'kept');
    assert.equal(kept.value.gone, true);
    assert.equal(kept.value.title, 'Stay');
    assert.equal(linksOf().some((l) => l.from.module === 'link-marker' && l.from.id === 'kept' && l.to.id === 'stay'), true);
  });

  const outDir = writeModule(mods, 'sync-out', {
    produces: [{
      kind: 'note', name: 'Note', key: 'note:{id}', summary: { title: 'title', when: 'date' },
      holds: { field: 'ref', onDelete: 'remove' },
      dated: { title: 'title', day: 'date', time: 'time', endDay: 'checkOut' },
      mirror: 'out',
    }],
    consumes: ['sync-in:mark', 'sync-off:mark'],
  }, ['space', 'person']);
  const inDated = {
    kind: 'mark', name: 'Mark', key: 'mark:{id}', summary: { title: 'title' },
    dated: { title: 'title', start: 'start', end: 'end', allDay: 'allDay' },
    mirror: 'in',
    create: { id: '{id}', desc: '', remind: null, repeat: null, by: '{by}' },
  };
  const inDir = writeModule(mods, 'sync-in', { produces: [inDated], consumes: [] });
  const offDir = writeModule(mods, 'sync-off', { produces: [{ ...inDated, kind: 'mark' }], consumes: [] });
  for (const dir of [outDir, inDir, offDir]) {
    const up = await as('POST', '/api/modules', buildModule(dir).zip, 'application/zip');
    assert.equal(up.status, 201, up.text);
  }
  assert.equal((await as('PATCH', '/api/modules/sync-out', { enabled: true, allSpaces: true })).status, 200);
  assert.equal((await as('PATCH', '/api/modules/sync-in', { enabled: true, allSpaces: true })).status, 200);
  // sync-off stays installed and off: a module is in every space once enabled, so off is the only way to be off in one.

  const putOut = (id, value, tz) => as('PUT', `/api/modules/sync-out/data/note:${id}?scope=space&space=${space}`, { value, ...(tz ? { tz } : {}) });
  const getOut = async (id) => (await as('GET', `/api/modules/sync-out/data/note:${id}?scope=space&space=${space}`)).json.item;
  const getIn = async (id) => as('GET', `/api/modules/sync-in/data/mark:${id}?scope=space&space=${space}`);
  const pairOf = (id) => linksOf().filter((l) => l.pair && l.from && l.from.module === 'sync-out' && l.from.id === id);
  const twinOf = async (id) => {
    const pair = pairOf(id).find((l) => l.pair === 'active');
    assert.ok(pair, `no active pair for ${id}`);
    const got = await getIn(pair.to.id);
    assert.equal(got.status, 200, got.text);
    return { pair, item: got.json.item };
  };

  await test('a dated sender makes one twin, and an undated one, a holding one, a personal one and an off receiver do not', async () => {
    const bad = writeModule(mods, 'sync-bad', {
      produces: [{ kind: 'note', name: 'Note', key: 'note:{id}', summary: { title: 'title' }, dated: { title: 'title', day: 'date', start: 'start' }, mirror: 'out' }],
      consumes: [],
    });
    const refused = await as('POST', '/api/modules', buildModule(bad).zip, 'application/zip');
    assert.equal(refused.status, 400, refused.text);

    assert.equal((await putOut('plain', { title: 'Plain' })).status, 200);
    assert.equal(pairOf('plain').length, 0);
    assert.equal((await putOut('held', { title: 'Held', date: '2026-06-15', ref: { module: 'sync-in', kind: 'mark', id: 'nope', scope: 'space', space } })).status, 200);
    assert.equal(pairOf('held').length, 0);
    assert.equal((await as('PUT', '/api/modules/sync-out/data/note:mine?scope=person', { value: { title: 'Mine', date: '2026-06-15' } })).status, 200);
    assert.equal(pairOf('mine').length, 0);

    assert.equal((await putOut('dated', { title: 'Walk', date: '2026-06-15', time: '09:30' }, 'UTC')).status, 200);
    const pairs = pairOf('dated');
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].pair, 'active');
    assert.equal(pairs[0].to.module, 'sync-in');
    const twin = await twinOf('dated');
    assert.equal(twin.item.value.title, 'Walk');
    assert.equal(twin.item.value.allDay, false);
    assert.equal(twin.item.value.start, '2026-06-15T09:30:00.000Z');
  });

  await test('title, day and time travel both ways, and a same write does not write again', async () => {
    const version = (await twinOf('dated')).item.version;
    assert.equal((await putOut('dated', { title: 'Walk', date: '2026-06-15', time: '09:30', notes: 'extra' }, 'UTC')).status, 200);
    assert.equal((await twinOf('dated')).item.version, version);

    assert.equal((await putOut('dated', { title: 'Hike', date: '2026-06-15', time: '09:30' }, 'UTC')).status, 200);
    assert.equal((await twinOf('dated')).item.value.title, 'Hike');
    assert.equal((await putOut('dated', { title: 'Hike', date: '2026-06-16', time: '09:30' }, 'UTC')).status, 200);
    assert.equal((await twinOf('dated')).item.value.start, '2026-06-16T09:30:00.000Z');
    assert.equal((await putOut('dated', { title: 'Hike', date: '2026-06-16', time: '10:00' }, 'UTC')).status, 200);
    assert.equal((await twinOf('dated')).item.value.start, '2026-06-16T10:00:00.000Z');

    const back = await twinOf('dated');
    const edited = { ...back.item.value, title: 'Return', start: '2026-06-17T15:00:00.000Z' };
    assert.equal((await as('PUT', `/api/modules/sync-in/data/mark:${back.pair.to.id}?scope=space&space=${space}`, { value: edited, tz: 'UTC' })).status, 200);
    const sender = await getOut('dated');
    assert.equal(sender.value.title, 'Return');
    assert.equal(sender.value.date, '2026-06-17');
    assert.equal(sender.value.time, '15:00');
  });

  await test('a stay with a time ends at its check-out; a whole-day stay ends on its check-out day', async () => {
    assert.equal((await putOut('span', { title: 'Stay', date: '2026-06-15', time: '09:30', checkOut: '2026-06-18' }, 'UTC')).status, 200);
    const timed = await twinOf('span');
    assert.equal(timed.item.value.end, '2026-06-18T09:30:00.000Z', 'no check-out time: the start\'s clock time');
    assert.equal((await putOut('span', { title: 'Stay', date: '2026-06-15', checkOut: '2026-06-18' }, 'UTC')).status, 200);
    const whole = await twinOf('span');
    assert.equal(whole.item.value.allDay, true);
    assert.equal(whole.item.value.start, '2026-06-15');
    assert.equal(whole.item.value.end, '2026-06-18');
    assert.equal((await getOut('span')).value.time ?? null, null);
  });

  await test('09:30 is the writer\'s instant in New York and in Tokyo, and reads back the same', async () => {
    assert.equal((await putOut('ny', { title: 'Morning', date: '2026-06-15', time: '09:30' }, 'America/New_York')).status, 200);
    assert.equal((await twinOf('ny')).item.value.start, '2026-06-15T13:30:00.000Z');
    const ny = await twinOf('ny');
    assert.equal((await as('PUT', `/api/modules/sync-in/data/mark:${ny.pair.to.id}?scope=space&space=${space}`, { value: ny.item.value, tz: 'America/New_York' })).status, 200);
    assert.equal((await getOut('ny')).value.time, '09:30');
    assert.equal((await getOut('ny')).value.date, '2026-06-15');

    assert.equal((await putOut('tokyo', { title: 'Morning', date: '2026-06-15', time: '09:30' }, 'Asia/Tokyo')).status, 200);
    assert.equal((await twinOf('tokyo')).item.value.start, '2026-06-15T00:30:00.000Z');
    const tokyo = await twinOf('tokyo');
    const asDay = { ...tokyo.item.value, allDay: true, start: '2026-06-15', end: null };
    assert.equal((await as('PUT', `/api/modules/sync-in/data/mark:${tokyo.pair.to.id}?scope=space&space=${space}`, { value: asDay, tz: 'Asia/Tokyo' })).status, 200);
    assert.equal((await getOut('tokyo')).value.time, '09:30', 'All day on a copy does not erase the object\'s time');
    assert.equal((await getOut('tokyo')).value.date, '2026-06-15');
    assert.equal((await twinOf('tokyo')).item.value.allDay, false, 'the copy says what the object says again');
  });

  await test('a receiver\'s own object makes no sender, a repeating twin keeps its pair, and setLinks leaves the pair', async () => {
    const before = (await as('GET', `/api/modules/sync-out/data?scope=space&space=${space}`)).json.items.map((it) => it.key);
    assert.equal((await as('PUT', `/api/modules/sync-in/data/mark:holiday?scope=space&space=${space}`, { value: { id: 'holiday', title: 'Holiday', start: '2026-12-25', allDay: true, desc: '', remind: null, repeat: null, by: 'me' } })).status, 200);
    const after = (await as('GET', `/api/modules/sync-out/data?scope=space&space=${space}`)).json.items.map((it) => it.key);
    assert.deepEqual(after, before);
    assert.equal(linksOf().some((l) => l.pair && l.to && l.to.id === 'holiday'), false);

    const twin = await twinOf('dated');
    const repeating = { ...twin.item.value, repeat: { every: 'week' } };
    assert.equal((await as('PUT', `/api/modules/sync-in/data/mark:${twin.pair.to.id}?scope=space&space=${space}`, { value: repeating, tz: 'UTC' })).status, 200);
    assert.equal((await putOut('dated', { title: 'Series', date: '2026-06-17', time: '15:00' }, 'UTC')).status, 200);
    const still = await twinOf('dated');
    assert.equal(still.pair.to.id, twin.pair.to.id);
    assert.equal(still.item.value.repeat.every, 'week');
    assert.equal(still.item.value.title, 'Series');

    const linked = await as('POST', '/api/objects/links', {
      module: 'sync-out',
      from: { module: 'sync-out', kind: 'note', id: 'dated', scope: 'space', space },
      to: [{ module: 'sync-in', kind: 'mark', id: 'holiday', scope: 'space', space }],
    });
    assert.equal(linked.status, 200, linked.text);
    const left = linksOf().filter((l) => l.from && l.from.module === 'sync-out' && l.from.id === 'dated');
    assert.equal(left.filter((l) => l.pair === 'active').length, 1);
    assert.equal(left.some((l) => !l.pair && l.to.id === 'holiday'), true);
  });

  await test('clearing the day deletes the twin, and deleting either side follows the rules', async () => {
    assert.equal((await putOut('clear', { title: 'Clear', date: '2026-06-15' }, 'UTC')).status, 200);
    const twin = await twinOf('clear');
    assert.equal((await putOut('clear', { title: 'Clear' }, 'UTC')).status, 200);
    assert.equal((await getIn(twin.pair.to.id)).status, 404);
    assert.equal(pairOf('clear').length, 0);

    assert.equal((await putOut('gone', { title: 'Gone', date: '2026-06-15' }, 'UTC')).status, 200);
    const gone = await twinOf('gone');
    assert.equal((await as('DELETE', `/api/modules/sync-out/data/note:gone?scope=space&space=${space}`)).status, 200);
    assert.equal((await getIn(gone.pair.to.id)).status, 404);
    assert.equal(pairOf('gone').length, 0);

    assert.equal((await putOut('detach', { title: 'Detach', date: '2026-06-15', time: '09:30' }, 'UTC')).status, 200);
    const detached = await twinOf('detach');
    assert.equal((await as('DELETE', `/api/modules/sync-in/data/mark:${detached.pair.to.id}?scope=space&space=${space}`)).status, 200);
    assert.equal((await getOut('detach')).value.date, '2026-06-15');
    assert.equal(pairOf('detach')[0].pair, 'detached');
    assert.equal((await putOut('detach', { title: 'Detach', date: '2026-06-15', time: '11:00' }, 'UTC')).status, 200);
    assert.equal(pairOf('detach')[0].pair, 'detached', 'a new time on the same day does not make a new twin');
    assert.equal((await putOut('detach', { title: 'Detach', date: '2026-06-20', time: '11:00' }, 'UTC')).status, 200);
    assert.equal(pairOf('detach').length, 1, 'moving the object does not bring the hidden copy back');
    assert.equal(pairOf('detach')[0].pair, 'detached');
    assert.equal((await getIn(detached.pair.to.id)).status, 404);
  });

  await test('clearing a module removes every key in that scope, and a dated twin goes with it once its Undo time is over', async () => {
    assert.equal((await putOut('wipe', { title: 'Wipe', date: '2026-06-15' }, 'UTC')).status, 200);
    const twin = await twinOf('wipe');
    const cleared = await as('DELETE', `/api/modules/sync-out/data?scope=space&space=${space}&tz=UTC`);
    assert.equal(cleared.status, 200, cleared.text);
    assert.ok(cleared.json.cleared >= 1);
    assert.equal((await as('GET', `/api/modules/sync-out/data?scope=space&space=${space}`)).json.items.length, 0);
    // The clear is held for its Undo (CLEAR_UNDO_SECONDS, 1 here, and 5 seconds' grace): the twin waits with it, then goes.
    assert.equal((await getIn(twin.pair.to.id)).status, 200, 'kept while the clear can be undone');
    for (let i = 0; i < 40 && (await getIn(twin.pair.to.id)).status !== 404; i += 1) await new Promise((r) => setTimeout(r, 250));
    assert.equal((await getIn(twin.pair.to.id)).status, 404);
    assert.equal(pairOf('wipe').filter((l) => l.pair === 'active').length, 0);
    assert.equal((await as('GET', '/api/modules/sync-out/data/note:mine?scope=person')).status, 200, 'another scope is left as it is');
    assert.equal((await putOut('after', { title: 'After' })).status, 200);
  });

  await test('a dated object with no pair gets its twin the next time the server starts, and not twice', async () => {
    if (stream) stream.close();
    stream = null;
    await server.stop();
    const file = path.join(base, 'data', 'modules', 'sync-out', 'data', `space-${space}.json`);
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    stored['note:backfill'] = { value: { title: 'Already', date: '2026-07-01', time: '09:30' }, version: 1, updatedAt: new Date().toISOString(), by: 'admin' };
    fs.writeFileSync(file, JSON.stringify(stored));
    server = await startServer(path.join(base, 'data'));
    const again = cookieOf(await call(server, 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
    const asAgain = (method, url) => call(server, method, url, { cookie: again });
    const pairs = () => JSON.parse(fs.readFileSync(path.join(base, 'data', 'modules', 'links.json'), 'utf8')).filter((l) => l.pair && l.from && l.from.id === 'backfill');
    assert.equal(pairs().length, 1);
    assert.equal(pairs()[0].pair, 'active');
    const twin = await asAgain('GET', `/api/modules/sync-in/data/mark:${pairs()[0].to.id}?scope=space&space=${space}`);
    assert.equal(twin.status, 200, twin.text);
    assert.equal(twin.json.item.value.start, '2026-07-01T09:30:00.000Z');
    assert.equal(twin.json.item.value.title, 'Already');
    const id = pairs()[0].to.id;
    await server.stop();
    server = await startServer(path.join(base, 'data'));
    const still = JSON.parse(fs.readFileSync(path.join(base, 'data', 'modules', 'links.json'), 'utf8')).filter((l) => l.pair && l.from && l.from.id === 'backfill');
    assert.equal(still.length, 1);
    assert.equal(still[0].to.id, id);
  });
} finally {
  if (stream) stream.close();
  if (server) await server.stop();
  fs.rmSync(base, { recursive: true, force: true });
}
if (failed) {
  console.error(`check-links: ${failed} failed`);
  process.exit(1);
}
console.log(`check-links: OK (${n})`);
process.exit(0);
