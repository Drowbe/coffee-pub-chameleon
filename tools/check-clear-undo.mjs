#!/usr/bin/env node
/*
 * check-clear-undo.mjs -- Clear and its Undo (server/module-holds.js; DELETE /api/modules/:id/data and
 * POST /api/modules/:id/data/restore): a Clear holds what it took on the server for the undo time, and the Undo puts back
 * exactly that, whoever owned it, in one write.
 *   - The hold by itself (ModuleHolds): one per module and scope, a second finishes the first, the token, the time, the
 *     sweep on start, a space deleted.
 *   - Live, against the travel seed (tools/shots.mjs) on a throwaway server with CLEAR_UNDO_SECONDS=3: Polls with every
 *     vote (keys that are their voters'), Research with a photo's file, a To-do of 300 objects (no 429), a restart between
 *     the clear and the undo (the page closed: the server still holds it), a write between the clear and the undo, a second
 *     clear while a hold is there, the hold running out (its file goes, the undo is refused), who may undo (the clear's
 *     permission; a member, a guest), one 'changes' event on the stream for a clear and for its undo, the Planner's
 *     calendar copies kept through it, a held file not removable, and Clear never offered where it removes nothing (a
 *     library module, a module that holds nothing here).
 * No network beyond localhost, no LiveKit.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ModuleHolds } = require('../server/module-holds.js');

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
    const two = h.hold('todo', 'space:abcd1234', { items: [{ key: 'b', value: 2, version: 1 }], by: 'k1' });
    assert.deepEqual(finished, ['a'], 'a second clear there finishes the first for good');
    assert.equal(h.take('todo', 'space:abcd1234', one.token), null, 'the first can\'t be undone now');
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

// --- the page's side, read from its files ------------------------------------------------------------------------------
await test('pages: Clear asks the server to undo, the toast ends at the server\'s time, a batch is one event', () => {
  const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const host = read('public/module-host.js');
  const clear = host.slice(host.indexOf('export async function clearWithUndo'), host.indexOf('// The lifts (editor.lift'));
  assert.ok(clear.includes("api('POST', `${base}/restore?${query}`, { restoreToken: answer.restoreToken })"), 'Undo is the server\'s restore');
  assert.ok(!/'PUT'|'GET'/.test(clear), 'no copy taken by the page, nothing written back key by key');
  assert.ok(clear.includes('undo.until = Date.now() + seconds * 1000'), 'the undo time is the server\'s undoSeconds');
  assert.ok(host.includes('undoToast(`Cleared ${name}.`, undo, { until: undo.until })'), 'the toast lasts that long');
  assert.ok(host.includes('You can undo it for ${UNDO_SECONDS} seconds.') && !host.includes('Everything in it goes'), 'the dialog says what goes and for how long Undo lasts');
  assert.ok(host.includes("else if (type === 'changes') send('changes',"), 'a batch goes to the module as one event');
  const brand = read('public/brand.js');
  assert.ok(brand.includes('if (t.gone || fixed) return;'), 'a toast with an end time is not held by the pointer or the focus');
  assert.ok(brand.includes('if (pressed) return true;'), 'Undo is pressed once');
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
    return { status: r.status, json };
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
    assert.equal((await restore('polls', cleared.json.restoreToken)).status, 410, 'an undo is done once');
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
    assert.deepEqual([wrong.status, wrong.json.error], [410, 'The time to undo that clear is over.']);
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

  await test('live: a second clear while one is held finishes the first for good', async () => {
    const fid = await upload('sam');
    assert.equal((await call('PUT', data('research', 'photo:u2'), { value: photo(fid) }, 'sam')).status, 200);
    const first = await call('DELETE', data('research', ''));
    assert.equal((await call('PUT', data('research', 'note:after'), { value: { kind: 'note', title: 'After', body: '', tags: [], date: '', at: '', text: '', sub: '' } }, 'sam')).status, 200);
    const second = await call('DELETE', data('research', ''));
    assert.equal(second.json.cleared, 1);
    assert.equal(await fileThere(fid), false, 'the first hold\'s file went with it');
    assert.equal((await restore('research', first.json.restoreToken)).status, 410, 'the first can\'t be undone');
    const back = await restore('research', second.json.restoreToken);
    assert.deepEqual([back.json.restored, (await list('research')).map((i) => i.key)], [1, ['note:after']]);
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
