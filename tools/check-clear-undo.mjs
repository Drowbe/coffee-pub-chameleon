#!/usr/bin/env node
/*
 * check-clear-undo.mjs -- Clear and its Undo (server/module-holds.js; DELETE /api/modules/:id/data and
 * POST /api/modules/:id/data/restore): a Clear holds what it took on the server for the undo time, and the Undo puts back
 * exactly that, whoever owned it, in one write.
 *   - The hold by itself (ModuleHolds): one per module and scope (a second is refused while it waits), the token, the
 *     time, why a token undoes nothing (undone, replaced, over), the sweep on start (a hold file it can't read is logged
 *     and set aside as .bad), stop() when the environment is set aside, a space deleted.
 *   - The data side (ModuleData): a batch above its size goes without values (`reload: true`); bookkeeping keys ("_...")
 *     written meanwhile keep their value and are not named as taken.
 *   - The code: a module's file setting can't name the host's folders (trash, data, uploads...); a set-aside environment
 *     stops its holds; the Undo counts against the write limit.
 *   - Live, against the travel seed (tools/shots.mjs) on a throwaway server with CLEAR_UNDO_SECONDS=3: Polls with every
 *     vote (keys that are their voters'), Research with a photo's file, a To-do of 300 objects (no 429), a restart between
 *     the clear and the undo (the page closed: the server still holds it), a write between the clear and the undo, a second
 *     clear refused while a hold is there (the time left said), each 410's own sentence, bookkeeping keys a page wrote
 *     meanwhile (not taken, not counted), the module turned off during the hold (its Calendar copies still go, and stay
 *     gone when it is on again), five clears a minute per module (429 with Retry-After), a hold file that can't be read
 *     (set aside on start, logged), the hold running out (its file goes, the undo is refused), who may undo (the clear's
 *     permission; a member, a guest), one 'changes' event on the stream for a clear and for its undo, the Planner's
 *     calendar copies kept through it, a held file not removable, and Clear never offered where it removes nothing (a
 *     library module, a module that holds nothing here).
 * No network beyond localhost, no LiveKit.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ModuleHolds } = require('../server/module-holds.js');
const { ModuleData } = require('../server/module-data.js');
const { buildModule } = require('../server/module-build.js');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    n += 1;
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}\n${err.stack || err}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- the hold by itself ------------------------------------------------------------------------------------------------
await test('holds: one per module and scope, its token, a second finishes the first, a restart re-arms it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-holds-'));
  try {
    const finished = [];
    const h = new ModuleHolds(dir, { holdSeconds: 1, graceMs: 200 });
    h.onExpire = (hold) => finished.push(hold.items.map((i) => i.key).join(','));
    const items = [{ key: 'a', value: 1, version: 1, updatedAt: 'x', by: 'k1' }];
    const one = h.hold('todo', 'space:abcd1234', { items, files: ['f1', 'f1'], by: 'k1' });
    assert.match(one.token, /^[a-f0-9]{32}$/);
    assert.equal(one.seconds, 1);
    assert.ok(fs.existsSync(path.join(dir, 'todo', 'trash', 'space-abcd1234.json')), 'kept on disk, under the module\'s trash');
    assert.deepEqual(h.read('todo', 'space:abcd1234').files, ['f1'], 'each file once');
    assert.ok(h.holdsFile('todo', 'space:abcd1234', 'f1'));
    assert.equal(h.take('todo', 'space:abcd1234', 'wrong'), null, 'not with another token');
    assert.equal(h.why('todo', 'space:abcd1234', 'wrong'), 'replaced', 'a token not known while another hold waits');
    assert.throws(() => h.hold('todo', 'space:abcd1234', { items, by: 'k1' }), /already waiting/, 'never a second hold over one that waits');
    assert.deepEqual(finished, [], 'and the first is not finished by it');
    assert.equal(h.take('todo', 'space:abcd1234', one.token).token, one.token, 'its own token takes it back');
    assert.equal(h.why('todo', 'space:abcd1234', one.token), 'undone');
    const two = h.hold('todo', 'space:abcd1234', { items: [{ key: 'b', value: 2, version: 1 }], by: 'k1' });
    assert.equal(h.why('todo', 'space:abcd1234', one.token), 'undone', 'still undone, with a new hold there');
    h.hold('todo', 'environment', { items, by: 'k1' });
    assert.equal(h.read('todo', 'space:abcd1234').items[0].key, 'b', 'another scope is another hold');
    // A restart (a new ModuleHolds over the same folder) still has both, and finishes them when their time is over.
    const again = new ModuleHolds(dir, { holdSeconds: 1, graceMs: 200 });
    const later = [];
    again.onExpire = (hold) => later.push(`${hold.scopeKey}:${hold.items[0].key}`);
    assert.equal(again.peek('todo', 'space:abcd1234').token, two.token, 'the hold outlives the process');
    for (const t of h.timers.values()) clearTimeout(t);
    await sleep(1400);
    assert.deepEqual(later.sort(), ['environment:a', 'space:abcd1234:b'], 'each finished once its time is over');
    assert.equal(again.take('todo', 'space:abcd1234', two.token), null);
    assert.equal(again.why('todo', 'space:abcd1234', two.token), 'over');
    assert.ok(!fs.existsSync(path.join(dir, 'todo', 'trash', 'space-abcd1234.json')), 'and gone from disk');
    // A deleted space takes its holds, unfinished.
    const three = new ModuleHolds(dir, { holdSeconds: 60 });
    three.onExpire = () => assert.fail('a deleted space\'s hold is not finished');
    three.hold('polls', 'space:abcd1234', { items, by: 'k1' });
    assert.equal(three.forgetSpace('abcd1234'), 1);
    assert.equal(three.read('polls', 'space:abcd1234'), null);
    for (const t of three.timers.values()) clearTimeout(t);
    assert.equal(h.fileFor('../x', 'environment'), null, 'a module id that is not one');
    assert.equal(h.fileFor('todo', 'space:../../x'), null, 'nor a scope');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('holds: a hold file that can\'t be read is logged and set aside on start; stop() stops every timer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-holds-'));
  try {
    fs.mkdirSync(path.join(dir, 'travel', 'trash'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'travel', 'trash', 'space-abcd1234.json'), '{"items":[{"key":"x"');
    fs.writeFileSync(path.join(dir, 'travel', 'trash', 'environment.json'), '{"no":"items"}');
    fs.writeFileSync(path.join(dir, 'travel', 'trash', 'notes.txt'), 'not a hold\'s name');
    const logged = [];
    const h = new ModuleHolds(dir, { holdSeconds: 1, graceMs: 0, log: (line) => logged.push(line) });
    const names = fs.readdirSync(path.join(dir, 'travel', 'trash')).sort();
    assert.deepEqual(names, ['environment.json.bad', 'notes.txt', 'space-abcd1234.json.bad'], 'both set aside; a file without a hold\'s name left alone');
    assert.equal(logged.length, 2);
    assert.match(logged.find((l) => l.includes('space-abcd1234')), /^A held clear of travel \(space-abcd1234\.json\) could not be read, so it was renamed space-abcd1234\.json\.bad\. What it took does not come back, and any files it named are left where they are\.$/);
    assert.equal(h.peek('travel', 'space:abcd1234'), null);
    // stop(): an environment set aside (deleted, or replaced by a backup) never finishes a hold with its old data.
    h.onExpire = () => assert.fail('a stopped hold is not finished');
    h.hold('travel', 'space:abcd1234', { items: [{ key: 'a', value: 1, version: 1 }], by: 'k1' });
    h.stop();
    assert.equal(h.timers.size, 0, 'no timer left');
    await sleep(1300);
    assert.ok(h.read('travel', 'space:abcd1234'), 'the hold stays on disk, for the environment built next from it');
    const next = new ModuleHolds(dir, { holdSeconds: 1, graceMs: 0, log: () => {} });
    const done = [];
    next.onExpire = (hold) => done.push(hold.items[0].key);
    await sleep(100);
    assert.deepEqual(done, ['a'], 'which finishes it');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('data: a big batch goes without values; bookkeeping keys written meanwhile are not taken', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-holds-data-'));
  try {
    const d = new ModuleData(dir);
    const events = [];
    d.on('changes', (b) => events.push(b));
    const big = 'x'.repeat(50 * 1024);
    for (let i = 0; i < 8; i += 1) d.put('todo', 'environment', `task:${i}`, { title: big });
    d.put('todo', 'environment', '_cursor:events', { id: 3 });
    const removed = d.removeAll('todo', 'environment');
    assert.equal(events[0].reload, undefined, 'a clear names keys only (no values to leave out)');
    d.put('todo', 'environment', '_cursor:events', { id: 9 });
    const back = d.restoreMany('todo', 'environment', removed);
    assert.deepEqual(back.taken, [], 'the bookkeeping key written meanwhile is not named');
    assert.equal(d.get('todo', 'environment', '_cursor:events').value.id, 9, 'and keeps what it holds now');
    assert.equal(back.restored.length, 8);
    const last = events[events.length - 1];
    assert.equal(last.reload, true, 'above the size: a reload hint');
    assert.ok(last.changes.length === 8 && last.changes.every((c) => !('value' in c) && c.key && c.version), 'keys and versions, no values');
    const small = new ModuleData(dir);
    const got = [];
    small.on('changes', (b) => got.push(b));
    small.put('polls', 'environment', 'poll:1', { q: 'small' });
    small.restoreMany('polls', 'environment', small.removeAll('polls', 'environment'));
    assert.ok(!got[1].reload && got[1].changes[0].value.q === 'small', 'a small batch keeps its values');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('code: reserved folders, a set-aside environment stops its holds, the Undo is a save', async () => {
  const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const { cleanManifest } = require('../server/modules.js');
  const manifest = (folder) => [{ id: 'mapsy', name: 'Mapsy', version: '1.0.0', sdk: 1, scope: ['environment'], surfaces: { page: { entry: 'index.html' } }, settings: [{ key: 'tiles', type: 'file', scope: 'environment', folder, label: 'Tiles' }] }, new Set(['index.html'])];
  for (const folder of ['trash', 'data', 'uploads', 'versions', 'library']) {
    assert.throws(() => cleanManifest(...manifest(folder)), (err) => /folder must be lowercase letters, digits and dashes, and not "versions", "library", "data", "uploads", "trash"$/.test(err.message), `"${folder}" refused`);
  }
  assert.doesNotThrow(() => cleanManifest(...manifest('map-tiles')), 'a folder of its own is fine');
  const modulesJs = fs.readFileSync(path.join(ROOT, 'server/modules.js'), 'utf8');
  assert.ok(modulesJs.includes("const RESERVED_FOLDERS = ['versions', 'library', 'data', 'uploads', 'trash'];"), 'the host\'s folders are reserved');
  const index = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
  assert.equal(index.match(/setAsideEnvironment\(env\); environments\.delete\(req\.params\.slug\)/g)?.length, 2, 'deleting an environment and restoring its backup both stop its holds');
  assert.ok(/env\.moduleHolds\.stop\(\)/.test(fs.readFileSync(path.join(ROOT, 'server/environment.js'), 'utf8')));
  const restore = index.slice(index.indexOf("app.post('/api/modules/:id/data/restore'"), index.indexOf('const UNDO_GONE'));
  assert.ok(restore.includes("overLimit(ctx.manifest.id, ctx.by, 'write')"), 'the Undo counts against the write limit');
});

// --- the page's side, read from its files ------------------------------------------------------------------------------
await test('pages: Clear asks the server to undo, the toast ends at the server\'s time, a batch is one event', () => {
  const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const host = read('public/module-host.js');
  const clear = host.slice(host.indexOf('export async function clearWithUndo'), host.indexOf('// Keeps what the page knows of a module'));
  assert.ok(clear.includes("api('POST', `${base}/restore?${query}`, { restoreToken: answer.restoreToken })"), 'Undo is the server\'s restore');
  assert.ok(!/'PUT'|'GET'/.test(clear), 'no copy taken by the page, nothing written back key by key');
  assert.ok(clear.includes('undo.until = Date.now() + seconds * 1000'), 'the undo time is the server\'s undoSeconds');
  assert.ok(host.includes('undoToast(`Cleared ${name}.`, undo, { until: undo.until })'), 'the toast lasts that long');
  assert.ok(host.includes('You can undo it for ${seconds} seconds, until you leave this page.') && !host.includes('Everything in it goes'), 'the dialog says what goes and for how long Undo lasts, from the server');
  assert.ok(host.includes("else if (type === 'changes') {") && host.includes("send('changes', { changes:"), 'a batch goes to the module as one event');
  for (const f of ['public/canvas.js', 'public/module.js']) assert.match(read(f), /^import \{[^}]*\bfollowClearable\b[^}]*\} from '\/module-host\.js';/m, `${f} imports followClearable`);
  const brand = read('public/brand.js');
  assert.ok(brand.includes('if (t.gone || fixed) return;'), 'a toast with an end time is not held by the pointer or the focus');
  assert.ok(brand.includes('if (busy || done || !note) return false;'), 'Undo is asked once at a time');
  assert.match(read('public/module-stream.js'), /STREAM_TYPES = Object\.freeze\(\[[^\]]*'changes'[^\]]*\]\)/, 'the shared stream listens for it');
  const sdk = read('public/sdk/host.js');
  assert.ok(sdk.includes("if (event === 'changes' && !(listeners.get(event) && listeners.get(event).size)) {"), 'the SDK hands a batch to a module that does not listen for it key by key');
});

// --- live, against the seed ----------------------------------------------------------------------------------------------
const UNDO = 3; // seconds; the grace on top is 5
const { bootSeeded, startServer, stopServer, freePort, encodePng } = await import('./shots.mjs');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-clear-undo-'));
let server;
try {
  const port = await freePort();
  const env = { CLEAR_UNDO_SECONDS: String(UNDO) };
  const boot = await bootSeeded('travel', dataDir, port, { env });
  server = boot.server;
  const { ctx, cookies } = boot;
  const jar = (as) => (cookies[as] || []).map((c) => `${c.name}=${c.value}`).join('; ');
  const call = async (method, url, body, as = 'admin') => {
    const headers = { 'content-type': 'application/json', accept: 'application/json' };
    if (cookies[as]) headers.cookie = jar(as);
    const r = await fetch(server.base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json, headers: r.headers };
  };
  const T = ctx.trip;
  const sp = `scope=space&space=${T}`;
  const data = (m, key) => `/api/modules/${m}/data${key ? `/${encodeURIComponent(key)}` : ''}?${sp}`;
  const restore = (m, token, as = 'admin') => call('POST', `/api/modules/${m}/data/restore?${sp}`, { restoreToken: token }, as);
  const list = async (m) => (await call('GET', data(m, ''))).json.items;
  const same = (a, b) => assert.deepEqual(a.map(({ key, value, by, updatedAt }) => ({ key, value, by, updatedAt })), b.map(({ key, value, by, updatedAt }) => ({ key, value, by, updatedAt })));

  await test('live: Polls comes back whole, every vote its voter\'s (QA 1)', async () => {
    const before = await list('polls');
    assert.ok(before.some((i) => i.key === `vote:q1:${ctx.mia}`) && before.some((i) => i.key === `vote:q1:${ctx.sam}`), 'the seed has votes');
    const cleared = await call('DELETE', data('polls', ''));
    assert.equal(cleared.status, 200);
    assert.deepEqual([cleared.json.cleared, cleared.json.undoSeconds], [before.length, UNDO]);
    assert.ok(Number.isFinite(Date.parse(cleared.json.undoUntil)), 'with the time it can be undone until');
    assert.deepEqual(await list('polls'), [], 'gone from reads at once');
    const back = await restore('polls', cleared.json.restoreToken);
    assert.deepEqual([back.status, back.json], [200, { restored: before.length, skipped: 0, taken: [] }]);
    const after = await list('polls');
    same(after, before);
    assert.ok(after.every((i, at) => i.version > before[at].version), 'at a version past the delete\'s');
    const twice = await restore('polls', cleared.json.restoreToken);
    assert.deepEqual([twice.status, twice.json.error], [410, 'That clear was already undone.'], 'an undo is done once, and says so');
    assert.equal((await call('PUT', data('polls', `vote:q1:${ctx.sam}`), { value: { options: ['o1'], name: 'x', at: 1 }, version: after.find((i) => i.key === `vote:q1:${ctx.sam}`).version }, 'sam')).status, 200, 'its voter writes it on from the version it has now');
  });

  // A picture uploaded to Research in the trip by `as`: its file id.
  const upload = async (as) => {
    const r = await fetch(`${server.base}/api/modules/research/uploads?${sp}&name=p.png`, { method: 'POST', headers: { 'content-type': 'image/png', cookie: jar(as) }, body: encodePng({ w: 2, h: 2, data: Buffer.alloc(16, 200) }) });
    const json = await r.json();
    assert.equal(r.status, 201, JSON.stringify(json));
    return json.file.id;
  };
  const fileThere = async (fid) => (await fetch(`${server.base}/api/modules/research/uploads/${fid}?${sp}`, { headers: { cookie: jar('admin') } })).status === 200;
  const photo = (fid) => ({ kind: 'photo', title: 'Sam\'s photo', tags: [], date: '', at: '2026-10-15T10:00:00.000Z', text: 'Sam\'s photo', sub: '', file: { id: fid, hasThumb: false } });

  await test('live: Research comes back with its photo\'s file; a held file can\'t be removed (QA 2)', async () => {
    const fid = await upload('sam');
    assert.equal((await call('PUT', data('research', 'photo:u1'), { value: photo(fid) }, 'sam')).status, 200);
    const before = await list('research');
    const cleared = await call('DELETE', data('research', ''));
    assert.equal(cleared.status, 200);
    assert.ok(await fileThere(fid), 'the file waits with the hold');
    const del = await call('DELETE', `/api/modules/research/uploads/${fid}?${sp}`, undefined, 'sam');
    assert.deepEqual([del.status, del.json.error], [409, 'That file can\'t be removed while the clear that took it can still be undone.']);
    const back = await restore('research', cleared.json.restoreToken);
    assert.deepEqual([back.status, back.json.restored, back.json.skipped], [200, before.length, 0]);
    same(await list('research'), before);
    assert.equal((await list('research')).find((i) => i.key === 'photo:u1').value.by, ctx.sam, 'the photo is still Sam\'s');
    assert.ok(await fileThere(fid), 'and its file is there');
  });

  await test('live: a To-do of 300 objects clears and comes back in one go, with no 429 (QA 3b)', async () => {
    const task = (i) => ({ id: `bulk${i}`, title: `Task ${i}`, remind: false, done: false, doneAt: null, createdAt: 1, links: [], autoDone: false });
    for (let i = 0; i < 300; i += 1) {
      const r = await call('PUT', data('todo', `task:bulk${i}`), { value: task(i) }, i % 2 ? 'sam' : 'admin');
      assert.equal(r.status, 200, `task ${i}: ${JSON.stringify(r.json)}`);
    }
    const before = await list('todo');
    assert.ok(before.length >= 300);
    const cleared = await call('DELETE', data('todo', ''), undefined, 'sam');
    assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
    const back = await restore('todo', cleared.json.restoreToken, 'sam');
    assert.deepEqual([back.status, back.json.restored, back.json.skipped], [200, before.length, 0], JSON.stringify(back.json));
    same(await list('todo'), before);
  });

  await test('live: one \'changes\' event on the stream for a clear and one for its undo, no \'change\' per key (QA 3c)', async () => {
    const ac = new AbortController();
    const r = await fetch(`${server.base}/api/modules/stream?space=${T}`, { headers: { cookie: jar('sam'), accept: 'text/event-stream' }, signal: ac.signal });
    assert.equal(r.status, 200);
    const reader = r.body.getReader();
    let text = '';
    const reading = (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; text += Buffer.from(value).toString('utf8'); } } catch { /* aborted */ } })();
    await sleep(300);
    const before = await list('todo');
    const cleared = await call('DELETE', data('todo', ''));
    await restore('todo', cleared.json.restoreToken);
    await sleep(500);
    ac.abort();
    await reading;
    const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => ({ type: m[1], data: JSON.parse(m[2]) })).filter((e) => e.data.module === 'todo');
    assert.deepEqual(events.map((e) => e.type), ['changes', 'changes'], 'two events, not one per key');
    assert.deepEqual([events[0].data.cleared, events[0].data.changes.length, events[0].data.changes.every((c) => c.deleted)], [true, before.length, true]);
    assert.deepEqual([events[1].data.restored, events[1].data.changes.length, events[1].data.changes.every((c) => !c.deleted && c.value)], [true, before.length, true]);
    assert.equal(events[1].data.scope, 'space');
  });

  await test('live: the Planner\'s copies on the Calendar stay through a clear and its undo', async () => {
    const copies = async () => (await list('calendar')).length;
    const had = await copies();
    const before = await list('travel');
    const cleared = await call('DELETE', data('travel', ''));
    assert.equal(cleared.status, 200);
    assert.equal(await copies(), had, 'nothing done to other modules while it can be undone');
    const back = await restore('travel', cleared.json.restoreToken);
    assert.equal(back.json.restored, before.length);
    same(await list('travel'), before);
    assert.equal(await copies(), had, 'and nothing to put back there');
  });

  await test('live: who may undo is who may clear; a member and a guest are refused', async () => {
    const cleared = await call('DELETE', data('polls', ''));
    const mia = await restore('polls', cleared.json.restoreToken, 'mia');
    assert.deepEqual([mia.status, mia.json.error], [403, 'Your role can\'t clear everything in this module.'], 'mia (a member) holding the token');
    const guestToken = (await call('POST', `/api/spaces/${T}/guest-link`)).json?.space?.guestToken || (await call('GET', `/api/spaces/${T}`)).json?.space?.guestToken;
    const g = await fetch(`${server.base}/api/modules/polls/data/restore?${sp}&guest=${encodeURIComponent(guestToken)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ restoreToken: cleared.json.restoreToken }) });
    assert.equal(g.status, 403, 'a guest');
    const none = await call('POST', `/api/modules/polls/data/restore?${sp}`, {});
    assert.deepEqual([none.status, none.json.error], [400, 'Say which clear to undo: send the restoreToken its answer gave.']);
    const wrong = await restore('polls', 'f'.repeat(32));
    assert.deepEqual([wrong.status, wrong.json.error], [410, 'A later clear replaced it.'], 'a token not known while another clear waits');
    const admin = await restore('polls', cleared.json.restoreToken);
    assert.deepEqual([admin.status, admin.json.skipped], [200, 0], `the admin still can: ${JSON.stringify(admin.json)}`);
  });

  await test('live: a write between the clear and the undo keeps its place, and is named', async () => {
    const before = await list('todo');
    const cleared = await call('DELETE', data('todo', ''));
    const kept = { id: 'bulk1', title: 'Written meanwhile', remind: false, done: false, doneAt: null, createdAt: 2, links: [], autoDone: false };
    assert.equal((await call('PUT', data('todo', 'task:bulk1'), { value: kept }, 'sam')).status, 200);
    assert.equal((await call('PUT', data('todo', 'task:fresh'), { value: { ...kept, id: 'fresh', title: 'New' } }, 'sam')).status, 200);
    const back = await restore('todo', cleared.json.restoreToken);
    assert.deepEqual([back.json.restored, back.json.skipped, back.json.taken], [before.length - 1, 1, ['task:bulk1']]);
    const after = await list('todo');
    assert.equal(after.find((i) => i.key === 'task:bulk1').value.title, 'Written meanwhile', 'the newer write is not overwritten');
    assert.ok(after.some((i) => i.key === 'task:fresh'), 'what was added meanwhile stays');
    assert.equal(after.length, before.length + 1);
  });

  await test('live: the page gone (a restart) between the clear and the undo: the server still has it', async () => {
    const before = await list('places');
    assert.ok(before.length, 'the seed has places');
    const cleared = await call('DELETE', data('places', ''));
    await stopServer(server);
    server = await startServer(dataDir, port, 'third', env);
    const back = await restore('places', cleared.json.restoreToken);
    assert.deepEqual([back.status, back.json.restored], [200, before.length], JSON.stringify(back.json));
    same(await list('places'), before);
  });

  await test('live: a second clear while one is held is refused, with the time left; Clear is not offered meanwhile (QA F4)', async () => {
    const fid = await upload('sam');
    assert.equal((await call('PUT', data('research', 'photo:u2'), { value: photo(fid) }, 'sam')).status, 200);
    const before = await list('research');
    const first = await call('DELETE', data('research', ''));
    assert.equal(first.status, 200);
    const offered = (await call('GET', `/api/modules/for-space?space=${T}`)).json.modules.find((m) => m.id === 'research');
    assert.deepEqual([offered.clear, offered.undoSeconds], [false, UNDO], 'not offered while it can be undone; the undo time is the server\'s');
    assert.equal((await call('PUT', data('research', 'note:after'), { value: { kind: 'note', title: 'After', body: '', tags: [], date: '', at: '', text: '', sub: '' } }, 'sam')).status, 200);
    const second = await call('DELETE', data('research', ''));
    assert.equal(second.status, 409);
    assert.match(second.json.error, /^.+ was just cleared\. You can undo that for [1-8] more seconds?, or clear it again after that\.$/);
    assert.ok(Number(second.headers.get('retry-after')) >= 1, 'with Retry-After');
    // The sentence counts to undoUntil (what the toast shows), not to the end of the grace (QA N8).
    const said = Number(/for (\d+) more second/.exec(second.json.error)[1]);
    const retry = Number(second.headers.get('retry-after'));
    assert.ok(said >= 1 && said <= UNDO, `the sentence says ${said} seconds; the toast has at most ${UNDO}`);
    assert.ok(retry - said >= 4 && retry - said <= 6, `Retry-After (${retry}) is when the 5 s grace is over too, ${said} seconds later`);
    assert.ok(await fileThere(fid), 'the first hold keeps its file');
    const back = await restore('research', first.json.restoreToken);
    assert.deepEqual([back.status, back.json.restored, back.json.skipped], [200, before.length, 0], 'the first comes back whole');
    assert.deepEqual((await list('research')).map((i) => i.key).sort(), [...before.map((i) => i.key), 'note:after'].sort());
    assert.ok(await fileThere(fid));
  });

  await test('live: bookkeeping keys a page wrote during the hold are not taken, and not counted (QA F3)', async () => {
    const before = await list('travel');
    const objects = before.filter((i) => !i.key.startsWith('_')).length;
    const cleared = await call('DELETE', data('travel', ''));
    assert.equal(cleared.json.cleared, objects);
    // What the SDK (events.subscribe) and the Planner write on opening.
    assert.equal((await call('PUT', data('travel', '_cursor:events'), { value: { id: 7 } }, 'mia')).status, 200);
    assert.equal((await call('PUT', data('travel', '_moved:plan-keys'), { value: true }, 'mia')).status, 200);
    const back = await restore('travel', cleared.json.restoreToken);
    assert.deepEqual([back.status, back.json], [200, { restored: objects, skipped: 0, taken: [] }], 'no "could not come back" for bookkeeping');
    const after = await list('travel');
    assert.equal(after.find((i) => i.key === '_cursor:events').value.id, 7, 'what the page wrote meanwhile stays');
    same(after.filter((i) => !i.key.startsWith('_')), before.filter((i) => !i.key.startsWith('_')));
    const again = await call('DELETE', data('travel', ''));
    assert.equal(again.json.cleared, objects, 'a clear counts objects, not bookkeeping keys');
    const back2 = await restore('travel', again.json.restoreToken);
    assert.deepEqual(back2.json, { restored: objects, skipped: 0, taken: [] });
  });

  await test('live: a hold that runs out takes its files, and the undo is refused', async () => {
    const fid = await upload('sam');
    assert.equal((await call('PUT', data('research', 'photo:u3'), { value: photo(fid) }, 'sam')).status, 200);
    const cleared = await call('DELETE', data('research', ''));
    assert.ok(await fileThere(fid));
    await sleep((UNDO + 5) * 1000 + 800);
    assert.equal(await fileThere(fid), false, 'the file went when the time was over');
    assert.ok(!fs.existsSync(path.join(dataDir, 'modules', 'research', 'trash', `space-${T}.json`)), 'and the hold');
    const late = await restore('research', cleared.json.restoreToken);
    assert.deepEqual([late.status, late.json.error], [410, 'The time to undo that clear is over.']);
  });

  await test('live: the module turned off during the hold: its Calendar copies still go, and stay gone when it is on again (QA F6)', async () => {
    const titles = new Set((await list('travel')).map((i) => i.value?.title).filter(Boolean));
    const copies = async () => (await list('calendar')).filter((i) => titles.has(i.value?.title)).length;
    assert.ok(await copies() > 0, 'the seed has the Planner\'s copies on the Calendar');
    const cleared = await call('DELETE', data('travel', ''));
    assert.equal(cleared.status, 200);
    const off = await call('PATCH', '/api/modules/travel', { enabled: false, force: true });
    assert.equal(off.status, 200, JSON.stringify(off.json));
    assert.equal(await copies(), 0, 'turning it off finishes the clear now: its copies go');
    assert.ok(!fs.existsSync(path.join(dataDir, 'modules', 'travel', 'trash', `space-${T}.json`)), 'and the hold');
    const late = await restore('travel', cleared.json.restoreToken);
    assert.ok([404, 410].includes(late.status), 'nothing to undo now');
    assert.equal((await call('PATCH', '/api/modules/travel', { enabled: true })).status, 200);
    await sleep((UNDO + 5) * 1000 + 500);
    assert.equal(await copies(), 0, 'and none come back when it is on again');
  });

  await test('live: five clears a minute per module; one person at most three, so a moderator still has her turn (QA F2, N7)', async () => {
    const before = await list('calendar');
    assert.ok(before.length, 'the seed has events');
    const cycle = async (as) => {
      const cleared = await call('DELETE', data('calendar', ''), undefined, as);
      if (cleared.status === 200) assert.equal((await restore('calendar', cleared.json.restoreToken, as)).status, 200);
      return cleared;
    };
    for (let i = 0; i < 3; i += 1) {
      const c = await cycle('sam');
      assert.equal(c.status, 200, `sam clear ${i + 1}: ${JSON.stringify(c.json)}`);
    }
    const fourth = await cycle('sam');
    assert.equal(fourth.status, 429, 'a person gets three of the five');
    assert.match(fourth.json.error, /^.+ was cleared too often just now\. Try again in \d+ seconds?\.$/);
    assert.ok(Number(fourth.headers.get('retry-after')) >= 1);
    for (let i = 0; i < 2; i += 1) {
      const c = await cycle('mia'); // moderates this trip: the last two are for her, the owner and the admin
      assert.equal(c.status, 200, `the moderator still has her turn (${i + 1}): ${JSON.stringify(c.json)}`);
    }
    const sixth = await cycle('admin');
    assert.equal(sixth.status, 429, 'five in all, everyone together');
    same(await list('calendar'), before);
  });

  await test('live: a hold file that can\'t be read is set aside on start and logged (QA F10)', async () => {
    const file = path.join(dataDir, 'modules', 'todo', 'trash', `space-${T}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"items":[{"key":"x"');
    await stopServer(server);
    server = await startServer(dataDir, port, 'fourth', env);
    assert.ok(!fs.existsSync(file) && fs.existsSync(`${file}.bad`), 'renamed .bad');
    assert.match(server.log(), new RegExp(`A held clear of todo \\(space-${T}\\.json\\) could not be read, so it was renamed`));
    const cleared = await call('DELETE', data('todo', ''));
    assert.equal(cleared.status, 200, 'the module clears as before');
    assert.equal((await restore('todo', cleared.json.restoreToken)).status, 200);
  });

  await test('live: Clear is offered only where it removes something: not a library module, not a module holding nothing', async () => {
    assert.ok([200, 201].includes((await call('POST', '/api/modules/bundled/vault/install')).status), 'the Vault installed');
    assert.equal((await call('PATCH', '/api/modules/vault', { enabled: true })).status, 200, 'the Vault turned on');
    const forSpace = Object.fromEntries((await call('GET', `/api/modules/for-space?space=${T}`)).json.modules.map((m) => [m.id, m.clear]));
    assert.equal(forSpace.vault, false, 'the Vault (its files are not module data)');
    for (const id of ['maps', 'assistant', 'research']) if (id in forSpace) assert.equal(forSpace[id], false, `${id} holds nothing here`);
    assert.equal(forSpace.polls, true, 'Polls holds something');
    const vault = await call('DELETE', data('vault', ''));
    assert.equal(vault.status, 400);
    assert.match(vault.json.error, / keeps files, not module data, so Clear has nothing to remove\.$/);
    assert.deepEqual((await call('DELETE', data('research', ''))).json, { cleared: 0 }, 'nothing to clear: no hold, no token');
  });

  await test('live: a clear and its undo of a 3 MB module with 20 streams open does not stall the server (QA N1)', async () => {
    await stopServer(server);
    const file = path.join(dataDir, 'modules', 'todo', 'data', `space-${T}.json`);
    const stored = {};
    for (let i = 0; i < 1500; i += 1) {
      stored[`task:big${i}`] = { value: { id: `big${i}`, title: `Task ${i}`, notes: 'x'.repeat(1900), remind: false, done: false, doneAt: null, createdAt: 1, links: [], autoDone: false }, version: 1, updatedAt: '2026-01-01T00:00:00.000Z', by: 'admin' };
    }
    fs.writeFileSync(file, JSON.stringify(stored));
    assert.ok(fs.statSync(file).size > 3 * 1024 * 1024, 'over 3 MB');
    server = await startServer(dataDir, port, 'fifth', env);
    const stop = path.join(dataDir, 'stop-poll');
    // Two clears and two undos (by `as`: a person may clear three times a minute) while a separate process asks /healthz as fast as it can; answers the slowest wait.
    const cycles = async (as) => {
      fs.rmSync(stop, { force: true });
      const poller = spawn(process.execPath, ['-e', `
        const fs = require('fs'); (async () => { let max = 0;
        while (!fs.existsSync(process.argv[2])) { const t = performance.now(); await fetch(process.argv[1] + '/healthz').then((r) => r.text()); max = Math.max(max, performance.now() - t); await new Promise((r) => setTimeout(r, 5)); }
        console.log(Math.round(max)); })();`, server.base, stop], { stdio: ['ignore', 'pipe', 'inherit'] });
      let out = '';
      poller.stdout.on('data', (d) => { out += d; });
      await sleep(300);
      try {
        for (let i = 0; i < 2; i += 1) {
          const cleared = await call('DELETE', data('todo', ''), undefined, as);
          assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
          assert.equal(cleared.json.cleared, 1500);
          const back = await restore('todo', cleared.json.restoreToken, as);
          assert.deepEqual([back.status, back.json.restored], [200, 1500]);
        }
      } finally {
        fs.writeFileSync(stop, '');
        await new Promise((r) => poller.once('exit', r));
      }
      return Number(out.trim());
    };
    const alone = await cycles('admin'); // the same work with nobody listening, for this machine's own speed
    const aborts = [];
    for (let i = 0; i < 20; i += 1) {
      const ac = new AbortController();
      aborts.push(ac);
      const r = await fetch(`${server.base}/api/modules/stream?space=${T}`, { headers: { cookie: jar(i % 2 ? 'sam' : 'admin'), accept: 'text/event-stream' }, signal: ac.signal });
      assert.equal(r.status, 200);
      (async () => { try { for await (const _ of r.body) { /* read and drop */ } } catch { /* closed */ } })();
    }
    await sleep(500);
    const heard = await cycles('mia');
    for (const ac of aborts) ac.abort();
    console.log(`  /healthz slowest wait: ${heard} ms with 20 streams open, ${alone} ms with none`);
    // 300 ms on a quiet machine; on a busy one, no worse than 2.5 times what the same work costs with nobody listening.
    assert.ok(Number.isFinite(heard) && heard < Math.max(300, alone * 2.5), `/healthz waited up to ${heard} ms with 20 streams open (${alone} ms with none) through 2 clears and 2 undos of 1500 objects`);
  });

  await test('live: an update that turns the Planner off (a new permission) during a clear finishes the clear first: the Calendar copies are cleaned (QA N5)', async () => {
    for (let i = 0; i < 3; i += 1) {
      const put = await call('PUT', data('travel', `plan:n5${i}`), { value: { kind: 'other', id: `n5${i}`, title: `N5 plan ${i}`, date: '2026-10-2' + i, time: '10:00', place: '', category: 'other', done: false } });
      assert.equal(put.status, 200, JSON.stringify(put.json));
    }
    const titles = new Set((await list('travel')).map((i) => i.value?.title).filter(Boolean));
    const copies = async () => (await list('calendar')).filter((i) => titles.has(i.value?.title)).length;
    assert.ok(await copies() > 0, 'the Planner\'s copies are on the Calendar');
    const cleared = await call('DELETE', data('travel', ''));
    assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
    assert.ok(await copies() > 0, 'a clear waiting for its undo leaves the copies');
    const src = path.join(dataDir, 'planner-next');
    fs.cpSync(path.join(process.cwd(), 'modules', 'travel'), src, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(src, 'module.json'), 'utf8'));
    manifest.version = '99.0.0';
    manifest.permissions.push({ key: 'extra', label: 'Something new', default: { member: false, guest: false, moderator: false } });
    fs.writeFileSync(path.join(src, 'module.json'), JSON.stringify(manifest));
    const zip = buildModule(src).zip;
    const r = await fetch(`${server.base}/api/modules`, { method: 'POST', headers: { 'content-type': 'application/zip', cookie: jar('admin') }, body: zip });
    const out = await r.json();
    assert.equal(r.status, 201, JSON.stringify(out));
    assert.deepEqual([out.module.enabled, out.module.needsApproval], [false, true], 'the update waits for approval, so the Planner is off');
    assert.equal(await copies(), 0, 'the clear was finished before it went off: its copies are gone now, not left behind');
    assert.ok(!fs.existsSync(path.join(dataDir, 'modules', 'travel', 'trash', `space-${T}.json`)), 'and the hold');
    fs.rmSync(src, { recursive: true, force: true });
  });
} catch (err) {
  failed += 1;
  console.error(`FAIL live: the seeded server\n${err.stack || err}`);
} finally {
  if (server) await stopServer(server);
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failed) {
  console.error(`check-clear-undo: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-clear-undo: OK (${n} checks)`);
