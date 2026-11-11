#!/usr/bin/env node
/*
 * check-whiteboard-present.mjs -- presenting to everyone (modules/whiteboard/src/whiteboard-lib-q-present.js).
 * Guards: the record's validator (unknown fields dropped, move and dim checked, ids plain, name cut); when a record is stale
 * (the first-read rule and the 35 s rule); the start decision (none: start, a live other: follow, stale: start, 409: follow,
 * a view-only person or guest: denied); take over; what a page does when the record is heard; a live message counts only
 * from the stored presenter; the sender (coalesced writes, a heartbeat every 10 s, the version carried, a 409 ends it, a
 * 429 is tried again at the next beat). Runs the libs in one scope with no page and no network.
 * Usage: node modules/whiteboard/test/check-whiteboard-present.mjs [path to the src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
const NAMES = ['WB_PRESENT', 'wbCleanPresent', 'wbPresentSeenAt', 'wbPresentStale', 'wbPresentStartPlan', 'wbPresentStartResult',
  'wbPresentCanTakeOver', 'wbPresentAcceptLive', 'wbPresentHear', 'wbPresentNext', 'createWbPresentSender', 'wbPresentMenu', 'wbPresentGo'];
let passed = 0;
const fails = [];
let L = {};
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-[a-z]-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  const grab = NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  L = new Function('window', 'document', `${parts.join('\n')}\nreturn { ${grab} };`)({ devicePixelRatio: 1 }, undefined);
} catch (err) { fails.push(`the libs do not load: ${err.message}`); }
const missing = NAMES.filter((n) => typeof L[n] === 'undefined');
async function test(name, fn) {
  try { if (missing.length) throw new Error(`the libs have no ${missing.join(', ')}`); await fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); }
}
const good = { id: 'state', type: 'present', presenter: 'ab12cd34', name: 'Ana', frame: 'F1', move: 'fade', dim: 40, seq: 3, at: '2026-11-10T10:00:00.000Z', by: 'ab12cd34' };

await test('the key is a bookkeeping key outside the blocks and the settings', () => {
  assert.equal(L.WB_PRESENT.key, '_present:main:state');
  assert.ok(L.WB_PRESENT.key.startsWith('_') && !L.WB_PRESENT.key.startsWith('block:main:') && !L.WB_PRESENT.key.startsWith('_board:main:'));
});
await test('wbCleanPresent keeps a good record and drops unknown fields', () => {
  assert.deepEqual(L.wbCleanPresent({ ...good, extra: 1, __proto__: { x: 1 } }), good);
});
await test('wbCleanPresent refuses what is not a record', () => {
  for (const v of [null, 5, 'x', [], {}, { ...good, type: 'note' }, { ...good, id: 'other' }, { ...good, presenter: '' }, { ...good, presenter: 'a b' },
    { ...good, frame: 'x'.repeat(65) }, { ...good, frame: 7 }, { ...good, frame: '<b>' }]) assert.equal(L.wbCleanPresent(v), null, JSON.stringify(v));
});
await test('wbCleanPresent checks move, dim, seq, at and cuts the name', () => {
  const c = L.wbCleanPresent({ ...good, move: 'spin', dim: 999, seq: -1, at: 'soon', name: `  ${'N'.repeat(60)}\n` });
  assert.equal(c.move, 'pan');
  assert.equal(c.dim, 60);
  assert.equal(c.seq, 0);
  assert.equal(c.at, '');
  assert.equal(c.name.length, 40);
  assert.equal(L.wbCleanPresent({ ...good, dim: 33 }).dim, 35);
  assert.equal(L.wbCleanPresent({ ...good, name: '' }).name, 'Someone');
  assert.equal(L.wbCleanPresent({ ...good, by: '' }).by, good.presenter);
});
await test('stale: seen within 35 s is fresh, 35 s or more is stale, never seen is stale', () => {
  assert.equal(L.wbPresentStale(1000, 1000 + 34999), false);
  assert.equal(L.wbPresentStale(1000, 1000 + 35000), true);
  assert.equal(L.wbPresentStale(NaN, 5), true);
});
await test('first read: a record younger than 35 s counts from its age; an old or unknown one gets 12 s to change', () => {
  assert.equal(L.wbPresentSeenAt(100000, 5000), 95000);
  assert.equal(L.wbPresentSeenAt(100000, -3000), 100000);
  for (const age of [60000, NaN, undefined]) {
    const seen = L.wbPresentSeenAt(100000, age);
    assert.equal(L.wbPresentStale(seen, 100000 + 11999), false);
    assert.equal(L.wbPresentStale(seen, 100000 + 12000), true);
  }
  assert.equal(L.wbPresentStale(L.wbPresentSeenAt(100000, 30000), 100000 + 5000), true, '30 s old and 5 s later: stale');
});
await test('start decision', () => {
  const rec = L.wbCleanPresent(good);
  const me = 'zz99';
  assert.equal(L.wbPresentStartPlan({ canEdit: true, me, rec: null, fresh: false }), 'start');
  assert.equal(L.wbPresentStartPlan({ canEdit: true, me, rec, fresh: true }), 'follow');
  assert.equal(L.wbPresentStartPlan({ canEdit: true, me, rec, fresh: false }), 'start');
  assert.equal(L.wbPresentStartPlan({ canEdit: true, me: good.presenter, rec, fresh: true }), 'follow', 'a second page of the presenter follows');
  assert.equal(L.wbPresentStartPlan({ canEdit: false, me, rec: null, fresh: false }), 'denied', 'view only');
  assert.equal(L.wbPresentStartPlan({ canEdit: true, me: '', rec: null, fresh: false }), 'denied', 'a guest has no key');
  assert.equal(L.wbPresentStartResult({ status: 409 }), 'follow');
  assert.equal(L.wbPresentStartResult({ status: 500 }), 'failed');
  assert.equal(L.wbPresentStartResult(null), 'failed');
});
await test('take over: an editor, someone else live', () => {
  const rec = L.wbCleanPresent(good);
  assert.equal(L.wbPresentCanTakeOver({ canEdit: true, me: 'zz99', rec, fresh: true }), true);
  assert.equal(L.wbPresentCanTakeOver({ canEdit: false, me: 'zz99', rec, fresh: true }), false);
  assert.equal(L.wbPresentCanTakeOver({ canEdit: true, me: '', rec, fresh: true }), false);
  assert.equal(L.wbPresentCanTakeOver({ canEdit: true, me: good.presenter, rec, fresh: true }), false);
  assert.equal(L.wbPresentCanTakeOver({ canEdit: true, me: 'zz99', rec, fresh: false }), false);
  assert.equal(L.wbPresentCanTakeOver({ canEdit: true, me: 'zz99', rec: null, fresh: false }), false);
});
await test('a live message counts only from the stored presenter', () => {
  const rec = L.wbCleanPresent(good);
  assert.equal(L.wbPresentAcceptLive(rec, { key: good.presenter }), true);
  assert.equal(L.wbPresentAcceptLive(rec, { key: 'someone' }), false);
  assert.equal(L.wbPresentAcceptLive(rec, { key: '' }), false);
  assert.equal(L.wbPresentAcceptLive(rec, null), false);
  assert.equal(L.wbPresentAcceptLive(null, { key: good.presenter }), false);
});
await test('what a page does when the record is heard', () => {
  const rec = L.wbCleanPresent(good);
  const h = (o) => L.wbPresentHear({ rec, fresh: true, me: 'zz99', mode: 'none', sending: false, left: false, offered: false, ...o });
  assert.equal(h({}), 'follow');
  assert.equal(h({ mode: 'follow' }), 'update');
  assert.equal(h({ left: true }), 'none');
  assert.equal(h({ mode: 'personal' }), 'offer');
  assert.equal(h({ mode: 'personal', offered: true }), 'none');
  assert.equal(h({ rec: null }), 'none');
  assert.equal(h({ rec: null, mode: 'follow' }), 'end');
  assert.equal(h({ fresh: false, mode: 'follow' }), 'end');
  assert.equal(h({ fresh: false }), 'none');
  assert.equal(h({ me: good.presenter, sending: true, mode: 'personal' }), 'none');
});
await test('the next record: the sequence moves only when something changed', () => {
  const rec = L.wbCleanPresent(good);
  assert.equal(L.wbPresentNext(rec, { frame: 'F2' }, 'T', 'k').seq, 4);
  assert.equal(L.wbPresentNext(rec, { frame: 'F1', dim: 40 }, 'T', 'k').seq, 3);
  assert.equal(L.wbPresentNext(rec, null, 'T', 'k').at, 'T');
});

// timers by hand
function clock() {
  let t = 0; let n = 0; const due = new Map();
  return {
    later: (fn, ms) => { n += 1; due.set(n, { at: t + ms, fn }); return n; },
    cancel: (id) => { due.delete(id); },
    async run(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [id, d] of due) if (d.at <= end && (!next || d.at < next[1].at)) next = [id, d];
        if (!next) break;
        due.delete(next[0]); t = next[1].at; next[1].fn();
        for (let i = 0; i < 5; i += 1) await Promise.resolve();
      }
      t = end;
    },
    pending: () => due.size,
  };
}
function rig(put) {
  const c = clock(); const log = []; const lost = [];
  const sender = L.createWbPresentSender({ put: async (v, ver) => { log.push({ v, ver }); return put(v, ver, log.length); }, later: c.later, cancel: c.cancel, stamp: () => 'T', by: good.presenter, onLost: (a, b) => lost.push([a, b]) });
  return { c, log, lost, sender };
}
await test('sender: rapid changes are one write; the version is carried; a heartbeat every 10 s', async () => {
  const r = rig(async (v, ver, n) => ({ version: 10 + n }));
  r.sender.start(L.wbCleanPresent(good), 10);
  r.sender.change({ frame: 'F2' }); await r.c.run(50); r.sender.change({ frame: 'F3' }); await r.c.run(50); r.sender.change({ frame: 'F4' });
  await r.c.run(149);
  assert.equal(r.log.length, 0);
  await r.c.run(2);
  assert.equal(r.log.length, 1);
  assert.equal(r.log[0].v.frame, 'F4');
  assert.equal(r.log[0].v.seq, 4);
  assert.equal(r.log[0].ver, 10);
  await r.c.run(10000);
  assert.equal(r.log.length, 2, 'the heartbeat');
  assert.equal(r.log[1].ver, 11, 'the version the last write answered');
  assert.equal(r.log[1].v.seq, 4, 'a heartbeat keeps the sequence');
  await r.c.run(60000);
  assert.equal(r.log.length, 8, 'one every 10 s: a minute is six');
  r.sender.stop();
  assert.equal(r.c.pending(), 0);
  assert.equal(r.sender.active, false);
});
await test('sender: a 409 names another presenter: it stops and says so; no more writes', async () => {
  const taken = { ...good, presenter: 'zz99', name: 'Zed', by: 'zz99' };
  const r = rig(async () => { const e = new Error('x'); e.status = 409; e.current = { value: taken, version: 12 }; throw e; });
  r.sender.start(L.wbCleanPresent(good), 10);
  r.sender.change({ dim: 80 });
  await r.c.run(200);
  assert.equal(r.lost.length, 1);
  assert.equal(r.lost[0][0].presenter, 'zz99');
  assert.equal(r.sender.active, false);
  await r.c.run(60000);
  assert.equal(r.log.length, 1);
});
await test('sender: a 409 from this person\'s own other page carries on from it', async () => {
  let n = 0;
  const own = { ...good, seq: 9 };
  const r = rig(async () => { n += 1; if (n === 1) { const e = new Error('x'); e.status = 409; e.current = { value: own, version: 20 }; throw e; } return { version: 21 }; });
  r.sender.start(L.wbCleanPresent(good), 10);
  r.sender.change({ frame: 'F5' });
  await r.c.run(400);
  assert.equal(r.lost.length, 0);
  assert.equal(r.log.length, 2);
  assert.equal(r.log[1].ver, 20);
  assert.equal(r.log[1].v.frame, 'F5');
});
await test('sender: a 429 is tried again at the next beat and keeps the change', async () => {
  let n = 0;
  const r = rig(async () => { n += 1; if (n === 1) { const e = new Error('busy'); e.status = 429; throw e; } return { version: 11 }; });
  r.sender.start(L.wbCleanPresent(good), 10);
  r.sender.change({ move: 'immediate' });
  await r.c.run(200);
  assert.equal(r.log.length, 1);
  assert.equal(r.sender.active, true);
  await r.c.run(10000);
  assert.equal(r.log.length, 2);
  assert.equal(r.log[1].v.move, 'immediate');
});
await test('sender: a 403 stops it', async () => {
  const r = rig(async () => { const e = new Error('no'); e.status = 403; throw e; });
  r.sender.start(L.wbCleanPresent(good), 10);
  r.sender.change({ dim: 5 });
  await r.c.run(200);
  assert.equal(r.sender.active, false);
  assert.equal(r.lost.length, 1);
});

await test('wbPresentMenu lists frames in order, names or Frame N, marks the current', () => {
  const st = { order: ['a', 'b', 'c'], i: 1 };
  const m = L.wbPresentMenu(st, (id) => ({ a: 'Intro', b: '  ', c: undefined })[id]);
  assert.deepEqual(m.map((x) => x.label), ['Intro', 'Frame 2', 'Frame 3']);
  assert.deepEqual(m.map((x) => x.current), [false, true, false]);
  assert.deepEqual(L.wbPresentMenu(null, () => ''), []);
});
await test('Restart goes to the first frame, and stays when already there', () => {
  assert.equal(L.wbPresentGo({ order: ['a', 'b'], i: 1 }, 'first').i, 0);
  assert.equal(L.wbPresentGo({ order: ['a', 'b'], i: 0 }, 'first').i, 0);
});
if (fails.length) {
  console.error(`check-whiteboard-present: ${fails.length} failed, ${passed} passed`);
  for (const f of fails) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(`check-whiteboard-present: OK (${passed} checks)`);
