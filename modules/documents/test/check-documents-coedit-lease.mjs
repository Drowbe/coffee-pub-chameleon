#!/usr/bin/env node
/*
 * check-documents-coedit-lease.mjs -- the edit window key (documents-lib-x-coedit-meta.js: dlLeaseHold, dlLeaseAcquire) when the network fails and when someone
 * forges the key, in Node with a manual clock and the fake store. Co-editing fixes of 0.11.27 (F1, F3). What this does NOT cover: the editor turning read only
 * (the page does that on onLost; the live run in real Chromium does).
 *
 *  1. An outage of 25 s (every call fails) is not "another window": the holder stays, says it is offline after failMs, takes the key again and says it is back;
 *     a page typing through the outage keeps every word and the text is saved after the network returns.
 *  2. A real second window (it renews its token) still wins: the holder is told once.
 *  3. A token written once and never renewed (forged, or left by a dead window) is taken back by compare-and-set after forgeMs, never makes the page read only;
 *     garbage in the key at once; at most 3 takeovers in 60 s, then it stays as it is and says so once.
 *  4. A window that waits to see whether the key is alive says so while it waits (and says nothing when the key is free).
 *
 * Usage: node modules/documents/test/check-documents-coedit-lease.mjs [path to the src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { world, ID } from './support/coedit-page.mjs';

const t0 = Date.now();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(root, 'modules/documents/src'));
let passed = 0; const fails = []; const facts = [];
async function test(name, fn) { try { await fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.stack.split('\n').slice(0, 3).join(' | ')}`); } }
const { L } = world(src);
const KEY = L.dlLeaseKey(ID, 'aaaa1111');
const put = (W, key, value) => W.store.data.set(key, { json: JSON.stringify(value), version: (W.store.versionCounter += 1) });
const iso = (W) => new Date(W.clock.now()).toISOString();
const windowOf = (W, me, tab) => ({ handle: W.store.as(me), tab, o: { doc: ID, me, tab, now: () => W.clock.now(), sleep: (ms) => new Promise((r) => W.clock.set(r, ms)) } });
// A window that holds the key, as openCoEditor wires it.
async function holder(W, me = 'aaaa1111', tab = 'tab1tab1tab1') {
  const w = windowOf(W, me, tab); w.lost = 0; w.offline = []; w.notes = [];
  w.res = await L.dlLeaseAcquire(w.handle, w.o);
  assert.equal(w.res.won, true);
  w.hold = L.dlLeaseHold(w.handle, { doc: ID, me, tab, version: w.res.version, now: w.o.now, set: (f, ms) => W.clock.set(f, ms), clear: (i) => W.clock.clear(i), onLost: () => { w.lost += 1; }, onOffline: (v) => w.offline.push(v), onNote: () => w.notes.push('said') });
  return w;
}
const down = (W, who) => { W.store.fault = (op, key, by) => (by === who ? Object.assign(new Error('Failed to fetch'), { status: 0 }) : null); };
const up = (W) => { W.store.fault = null; };

await test('an outage of 25 s is not another window: the holder stays, says offline, and takes the key again when the network is back', async () => {
  const W = world(src); W.make();
  const w = await holder(W);
  await W.run(6000);
  down(W, 'aaaa1111'); await W.run(25000);
  assert.equal(w.lost, 0, 'not thrown out by an outage'); assert.equal(w.hold.held(), true);
  assert.deepEqual(w.offline, [true], 'said offline once, after failMs');
  up(W); await W.run(12000);
  assert.equal(w.lost, 0); assert.equal(w.hold.held(), true);
  assert.deepEqual(w.offline, [true, false], 'and back');
  const k = W.store.peek(KEY); assert.equal(k.value.t, 'tab1tab1tab1');
  const before = W.store.log.filter((x) => x.key === KEY && x.op === 'set' && x.status === 200).length;
  await W.run(20000);
  assert.ok(W.store.log.filter((x) => x.key === KEY && x.op === 'set' && x.status === 200).length > before, 'it keeps renewing');
  await W.run(120000);
  assert.equal(w.lost, 0);
});
await test('a long outage (3 minutes) and the network back with the key still its own or gone: the holder carries on', async () => {
  const W = world(src); W.make();
  const w = await holder(W);
  down(W, 'aaaa1111'); await W.run(60000); W.store.data.delete(KEY); await W.run(120000); up(W); await W.run(12000);
  assert.equal(w.lost, 0); assert.equal(W.store.peek(KEY).value.t, 'tab1tab1tab1', 'the key was made again');
});
await test('a page typing through a 25 s outage keeps every word: the editor stays editable (the key is held), and the text is saved after the network is back', async () => {
  const W = world(src); W.make();
  const w = await holder(W);
  const p = await W.page('aaaa1111'); await W.run(2500);
  const words = [];
  const say = (i) => { words.push(`w${i}`); W.type(p, 1, ` w${i}`); };
  say(0); await W.run(3000); down(W, 'aaaa1111');
  for (let i = 1; i <= 8; i += 1) { await W.run(2800); say(i); } // 22 s of typing offline
  await W.run(5000); assert.equal(w.lost, 0, 'the editor was never told "another window"'); assert.equal(w.hold.held(), true);
  up(W);
  say(9); await W.run(40000);
  const stored = W.stored().text;
  for (const x of words) assert.ok(stored.includes(x), `${x} is saved (${stored.slice(0, 80)})`);
  assert.equal(w.lost, 0);
  facts.push(`25 s outage: ${words.length} words typed before, during and after, all ${words.filter((x) => stored.includes(x)).length} saved; the holder was never lost`);
});
await test('a real second window (it renews its own token) still wins: the holder is told once, and does not write over it', async () => {
  const W = world(src); W.make();
  const w = await holder(W);
  await W.run(3000);
  put(W, KEY, { t: 'othertabother', at: iso(W) });
  for (let i = 0; i < 6; i += 1) { await W.run(L.DL_LEASE.renewMs - 300); put(W, KEY, { t: 'othertabother', at: iso(W) }); }
  assert.equal(w.lost, 1, 'told once'); await W.run(30000); assert.equal(w.lost, 1);
  assert.equal(W.store.peek(KEY).value.t, 'othertabother');
});
await test('a holder offline for 90 s whose key a real second window took meanwhile: the network is back, the window renews, the holder goes read only (told once)', async () => {
  const W = world(src); W.make();
  const w = await holder(W);
  down(W, 'aaaa1111'); await W.run(90000);
  put(W, KEY, { t: 'othertabother', at: iso(W) }); up(W);
  for (let i = 0; i < 6; i += 1) { await W.run(L.DL_LEASE.renewMs - 300); put(W, KEY, { t: 'othertabother', at: iso(W) }); }
  assert.equal(w.lost, 1);
});
await test('a forged token written once and never renewed is taken back after forgeMs: the page never goes read only', async () => {
  const W = world(src); W.make();
  const w = await holder(W);
  await W.run(3000);
  put(W, KEY, { t: 'forgedtoken1', at: iso(W) });
  const t = W.clock.now(); let back = 0;
  for (let i = 0; i < 40 && !back; i += 1) { await W.run(500); if (W.store.peek(KEY).value.t === 'tab1tab1tab1') back = W.clock.now() - t; }
  assert.ok(back > 0 && back <= L.DL_LEASE.renewMs * 3 + L.DL_LEASE.forgeMs, `taken back after ${back} ms`);
  await W.run(30000); assert.equal(w.lost, 0); assert.equal(w.hold.held(), true);
  facts.push(`a forged window key is taken back ${Math.round(back / 100) / 10} s after it is written`);
});
await test('a token the page cannot hear renew (unchanged for a long time, even a fresh one) never makes it read only', async () => {
  const W = world(src); W.make();
  const w = await holder(W);
  put(W, KEY, { t: 'forgedtoken1', at: iso(W) });
  await W.run(120000);
  assert.equal(w.lost, 0);
});
await test('garbage in the key is taken back at the next renewal', async () => {
  const W = world(src); W.make();
  const w = await holder(W);
  put(W, KEY, { junk: 1 }); await W.run(L.DL_LEASE.renewMs + 500);
  assert.equal(W.store.peek(KEY).value.t, 'tab1tab1tab1'); assert.equal(w.lost, 0);
});
await test('takeovers are limited to 3 in 60 s: then the page stays as it is, editable, and says so once', async () => {
  const W = world(src); W.make();
  const w = await holder(W);
  let forged = 0;
  for (let i = 0; i < 24; i += 1) { // a hostile editor forges again as soon as the key is taken back
    await W.run(2500);
    if (W.store.peek(KEY).value.t === 'tab1tab1tab1') { put(W, KEY, { t: `forgedtoken${i}`.slice(0, 12).padEnd(12, 'x'), at: iso(W) }); forged += 1; }
  }
  assert.ok(forged >= 4, `${forged} forgeries`);
  assert.equal(w.lost, 0, 'never read only');
  assert.equal(w.hold.held(), true);
  assert.deepEqual(w.notes, ['said'], 'said once');
  const mine = W.store.log.filter((x) => x.key === KEY && x.op === 'set' && x.status === 200 && x.who === 'aaaa1111').length;
  assert.ok(mine > 0);
});
await test('a window that waits to see if the key is alive says so; one that finds the key free says nothing', async () => {
  const W = world(src); W.make();
  const free = windowOf(W, 'aaaa1111', 'tab1tab1tab1'); let said = 0;
  const r = await L.dlLeaseAcquire(free.handle, { ...free.o, checking: () => { said += 1; } });
  assert.equal(r.won, true); assert.equal(said, 0, 'nothing said for a free key');
  const second = windowOf(W, 'aaaa1111', 'tab2tab2tab2'); let at = -1; const t = W.clock.now();
  let res = null; L.dlLeaseAcquire(second.handle, { ...second.o, checking: () => { at = W.clock.now() - t; } }).then((x) => { res = x; });
  await W.run(300);
  assert.equal(at >= 0 && at < 300, true, 'said at once, before the wait');
  await W.run(9000); assert.equal(res && res.won, true, 'a key nobody renews is taken over after the wait');
});

await test('Rename and Delete with the switch on (F4): who may, the locked rule, and where the entries are (source read: this is not the page running)', () => {
  const R = (o) => L.dlCoRemoveRules({ me: 'bbbb2222', role: 'member', ownerWord: 'a Keeper', ...o });
  assert.deepEqual(R({ lock: null }), { off: false, reason: '' }, 'a document that is not locked: anyone who may edit');
  const lock = { by: 'aaaa1111', name: 'Ana', at: 1 };
  assert.equal(R({ lock }).off, true); assert.equal(R({ lock }).reason, 'Only Ana or a Keeper can unlock.');
  assert.equal(R({ lock, me: 'aaaa1111' }).off, false, 'the person who locked it');
  assert.equal(R({ lock, role: 'owner' }).off, false); assert.equal(R({ lock, role: 'admin' }).off, false);
  const page = fs.readFileSync(path.join(src, 'documents.js'), 'utf8');
  assert.ok(page.includes("if (v === 'rename') { if (!canEdit) return; if (ed && ed.co) coRename();") && page.includes("if (ed && ed.co) coRemove();"), 'the title bar\'s select holds them (the shared paths coRename and coRemove)');
  assert.ok(!page.includes("coEntries(coLockNow()).map((e) => ({ ...e, onClick: () => (e.id === 'rename'"), 'the Page menu no longer repeats them');
  assert.ok(/function coRowMore\(li, rec\) \{\n    if \(!coediting \|\| !canEdit\) return;/.test(page), 'the list\'s More button exists only with the switch on');
});

console.log(`documents coedit lease: ${passed} tests passed in ${((Date.now() - t0) / 1000).toFixed(1)} s${facts.length ? ` (${facts.join('; ')})` : ''}`);
if (fails.length) { console.log(`${fails.length} failed:\n- ${fails.join('\n- ')}`); process.exit(1); }
