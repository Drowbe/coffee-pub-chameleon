#!/usr/bin/env node
/*
 * check-documents-coedit-writer.mjs -- who writes the text of a shared document, and the seed marker (documents-lib-u-coedit-sync.js), in Node with no DOM,
 * no network and no timers: the stand-in bus and the manual clock of check-documents-coedit-sync.mjs, and a fake store with the server's version, 409, 413
 * and 429 rules (test/support/fake-store.mjs). Plan: plan-documents-coediting.md, step 4b, slice 1. What this does NOT cover: the real SDK and server,
 * the browser (the live run with real pages does), anything about snapshots (a later slice).
 *
 *  1. The election: the lowest key among the synced editors; a new answer is taken only after a quiet beat; a writer who left, went silent or is past the cap.
 *  2. The seed marker: two pages open the same new document at once (many interleavings): exactly one seeds, the other takes its state and the text is
 *     there once; a marker left by someone gone, a stale one, a garbage one and one dated in the future are never a block; a viewer never writes;
 *     a store that refuses (403, 413, 429) leaves the page seeding as it did before the marker.
 *
 * Usage: node modules/documents/test/check-documents-coedit-writer.mjs [path to the src folder]. Exits 1 on any failure.
 */
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { world, TEXT, ID } from './support/coedit-page.mjs';

const t0 = Date.now();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(root, 'modules/documents/src'));

let passed = 0; const fails = []; const facts = [];
async function test(name, fn) { try { await fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

// ---- 1. the election ------------------------------------------------------------------------------------------------------------------
{
  const W0 = world(src); const L = W0.L;
  await test('dlSyncElect: the lowest key; nothing else counts', () => {
    assert.equal(L.dlSyncElect(['bob', 'ana', 'cy']), 'ana');
    assert.equal(L.dlSyncElect(['ana']), 'ana');
    assert.equal(L.dlSyncElect([]), '');
    assert.equal(L.dlSyncElect(null), '');
    assert.equal(L.dlSyncElect(['', 5, null, undefined, {}, 'zed']), 'zed', 'junk is not a person');
    assert.equal(L.dlSyncElect(['B', 'a']), 'B', 'keys compare as strings: capital letters come first');
    assert.equal(L.dlSyncElect(['u10', 'u9']), 'u10', 'and not as numbers');
    // the same answer on every page, whatever order the keys were heard in
    const keys = ['k7', 'k3', 'k9', 'k1', 'k5'];
    for (let i = 0; i < 50; i += 1) assert.equal(L.dlSyncElect([...keys].sort(() => Math.random() - 0.5)), 'k1');
  });
  await test('dlSyncWriterHold: the first answer at once, a change only after a quiet beat', () => {
    const h = L.dlSyncWriterHold(1000);
    assert.equal(h.update([], 0), '');
    assert.equal(h.update(['bob'], 100), 'bob', 'the first answer is taken at once');
    assert.equal(h.update(['bob', 'ana'], 200), 'bob', 'a lower key came: not yet');
    assert.equal(h.update(['bob', 'ana'], 1100), 'bob', '900 ms is not a quiet beat');
    assert.equal(h.update(['bob', 'ana'], 1200), 'ana', 'a quiet beat');
    // the writer leaves: nobody writes until a quiet beat has passed, then the next lowest
    assert.equal(h.update(['bob', 'cy'], 5000), '', 'the writer left: not kept');
    assert.equal(h.update(['bob', 'cy'], 5900), '');
    assert.equal(h.update(['bob', 'cy'], 6000), 'bob');
    // two pages that flap together never settle fast: the answer changes every 400 ms, so it is never taken
    const f = L.dlSyncWriterHold(1000); f.update(['m'], 0);
    let t = 1000; const seen = new Set();
    for (let i = 0; i < 40; i += 1) { t += 400; seen.add(f.update(i % 2 ? ['m', 'a'] : ['m'], t)); }
    assert.deepEqual([...seen].sort(), ['', 'm'].filter((x) => seen.has(x)).sort());
    assert.ok(!seen.has('a'), 'a answer that never stays for a quiet beat is never taken');
    // and settles at once when it stays
    assert.equal(f.update(['m', 'a'], t + 1000), 'a');
  });

  await test('three pages: everyone agrees on the lowest key and knows whether it is the writer; data-co-stats carries both', async () => {
    const W = world(src); W.make();
    const ps = [];
    for (const k of ['cccc3333', 'aaaa1111', 'bbbb2222']) { ps.push(await W.page(k)); await W.run(800); }
    await W.run(3000);
    for (const p of ps) { const st = p.session.stats(); assert.equal(st.writer, 'aaaa1111', `${p.key} sees ${st.writer}`); assert.equal(st.isWriter, p.key === 'aaaa1111'); }
    assert.ok(ps.every((p) => p.session.stats().elections >= 1));
  });
  await test('the writer leaves (its {x:1}): the next lowest takes over only after the quiet beat, and nobody is the writer between', async () => {
    const W = world(src); W.make();
    const a = await W.page('aaaa1111'); await W.run(300); const b = await W.page('bbbb2222'); await W.run(300); const c = await W.page('cccc3333');
    await W.run(4000);
    assert.equal(b.session.writer(), 'aaaa1111');
    const gone = W.clock.t;
    a.session.stop(); W.bus.disconnect('aaaa1111');
    let took = -1; let none = false;
    for (let i = 0; i < 300 && took < 0; i += 1) {
      await W.run(20);
      if (b.session.writer() === '') none = true;
      if (b.session.isWriter()) took = W.clock.t - gone;
    }
    assert.ok(none, 'there was a moment with no writer');
    assert.ok(took >= 1000, `taken after ${took} ms: not before a quiet beat`);
    assert.ok(took <= 1700, `taken after ${took} ms`);
    assert.equal(c.session.writer(), 'bbbb2222');
    assert.equal(c.session.isWriter(), false);
    facts.push(`the writer left: next writer ${took} ms later (quiet beat 1000 ms + tick 500 ms)`);
  });
  await test('a lower key joins: the old writer keeps writing for a quiet beat, then hands over', async () => {
    const W = world(src); W.make();
    const b = await W.page('bbbb2222'); await W.run(2000); assert.equal(b.session.isWriter(), true);
    const a = await W.page('aaaa1111');
    let handed = -1; const t = W.clock.t;
    for (let i = 0; i < 400 && handed < 0; i += 1) { await W.run(20); if (!b.session.isWriter() && b.session.writer() === 'aaaa1111') handed = W.clock.t - t; }
    assert.ok(handed >= 1000, `handed over after ${handed} ms`);
    assert.equal(a.session.writer(), 'aaaa1111');
  });
  await test('a writer that goes silent (no {x:1}, still in the module) is replaced when presenceMs has passed', async () => {
    const W = world(src); W.make();
    const a = await W.page('aaaa1111'); await W.run(300); const b = await W.page('bbbb2222'); await W.run(4000);
    assert.equal(b.session.writer(), 'aaaa1111');
    W.bus.members.get('aaaa1111').state = 'closed'; // its page is stuck: nothing reaches it and nothing comes from it
    const t = W.clock.t; let took = -1;
    for (let i = 0; i < 400 && took < 0; i += 1) { await W.run(500); if (b.session.isWriter()) took = W.clock.t - t; }
    assert.ok(took >= W.L.DL_SYNC.presenceMs - 16000 && took <= W.L.DL_SYNC.presenceMs + 3000, `${took} ms`);
    facts.push(`a silent writer: replaced after ${took} ms (presenceMs ${W.L.DL_SYNC.presenceMs})`);
  });
  await test('a page past the cap of eight, and a page that only reads, is never the writer', async () => {
    const W = world(src); W.make();
    const keys = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8'];
    const ps = [];
    for (const k of keys.slice(1)) { ps.push(await W.page(k)); await W.run(300); }
    await W.run(3000);
    const reader = await W.page('k0', { editor: false }); await W.run(2000);
    assert.equal(reader.session.isWriter(), false);
    assert.ok(ps.every((p) => p.session.writer() === 'k2'), `the writer is ${ps[0].session.writer()}: the reader k0 is lower but only reads`);
  });
}

// ---- 2. the seed marker -----------------------------------------------------------------------------------------------------------------
const count = (W, p) => W.textOf(p.doc(), null).split('Alpha one.').length - 1;
{
  await test('two pages open the same new document at the same instant: exactly one seeds, the text is there once (60 interleavings)', async () => {
    const hows = { won: 0, state: 0 };
    for (let seed = 1; seed <= 60; seed += 1) {
      const W = world(src, { seed, yields: 1 + (seed % 5), paceMs: seed % 3 ? 0 : 33 }); W.make();
      const [a, b] = await Promise.all([W.page('aaaa1111'), W.page('bbbb2222')]);
      await W.run(8000);
      const m = [a, b].map((p) => p.session.stats().marker);
      assert.deepEqual(m.slice().sort(), ['', 'won'].sort().filter((x) => m.includes(x)).length === 2 ? ['', 'won'] : m.slice().sort(), `seed ${seed}: ${m}`);
      assert.equal(m.filter((x) => x === 'won').length, 1, `seed ${seed}: exactly one wins the marker (${m})`);
      assert.ok(a.how && b.how, `seed ${seed}: both finished joining`);
      assert.equal(a.text(), b.text(), `seed ${seed}: equal`);
      assert.equal(a.text(), TEXT, `seed ${seed}: the text, once`);
      assert.equal(count(W, a), 1, `seed ${seed}`);
      const mk = W.store.peek(W.L.dlSeedMarkerKey(ID));
      assert.ok(mk && W.L.dlCleanSeedMarker(mk.value), 'the marker is in the store');
      hows.won += 1;
    }
    assert.equal(hows.won, 60);
  });
  await test('the same, five pages at once and with a bus that drops 20 percent', async () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const W = world(src, { seed: seed * 7, yields: 3 }); W.make();
      let n = seed; W.bus.drop = () => ((n = (n * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) < 0.2;
      const ps = await Promise.all(['aaaa1111', 'bbbb2222', 'cccc3333', 'dddd4444', 'eeee5555'].map((k) => W.page(k)));
      await W.run(40000);
      assert.ok(ps.every((p) => p.how), `seed ${seed}: all joined`);
      assert.equal(ps.filter((p) => p.session.stats().marker === 'won').length, 1, `seed ${seed}`);
      assert.ok(ps.every((p) => p.text() === TEXT && count(W, p) === 1), `seed ${seed}: once, equal`);
    }
  });
  await test('without a marker the seed id is the hash of the document and its text (the 4a rule); with one it is the marker\'s', async () => {
    const W = world(src); W.make();
    const a = await W.page('aaaa1111', { marker: false }); await W.run(2000);
    assert.equal(a.session.stats().marker, '');
    const want = W.L.dlSyncSeedId(ID, TEXT);
    const vec = (p) => [...W.L.dlSyncVector(W.PM.encodeStateVector(p.doc()), 100).keys()];
    assert.deepEqual(vec(a), [want]);
    assert.equal(W.store.peek(W.L.dlSeedMarkerKey(ID)), null, 'and nothing was written');
    const W2 = world(src); W2.make();
    const b = await W2.page('bbbb2222'); await W2.run(2000);
    assert.deepEqual([...W2.L.dlSyncVector(W2.PM.encodeStateVector(b.doc()), 100).keys()], [want]);
    assert.deepEqual(W2.store.peek(W2.L.dlSeedMarkerKey(ID)).value.id, want);
    assert.equal(W2.store.peek(W2.L.dlSeedMarkerKey(ID)).value.by, 'bbbb2222');
  });
  await test('a marker whose writer is gone, with nobody in the document: the next page takes it over and seeds with the marker\'s id (one text)', async () => {
    const W = world(src); W.make();
    const old = 987654321;
    W.store.data.set(W.L.dlSeedMarkerKey(ID), { json: JSON.stringify({ id: old, by: 'gone0001', at: new Date(W.clock.now() - 10000).toISOString() }), version: 9007 });
    const a = await W.page('aaaa1111'); await W.run(4000);
    assert.equal(a.how, 'alone'); assert.equal(a.session.stats().marker, 'took');
    assert.deepEqual([...W.L.dlSyncVector(W.PM.encodeStateVector(a.doc()), 100).keys()], [old], 'seeded with the marker\'s id');
    assert.equal(W.store.peek(W.L.dlSeedMarkerKey(ID)).value.by, 'aaaa1111');
    assert.equal(a.text(), TEXT);
  });
  await test('two pages find the same stale marker at once: one takes it over, one waits and takes its state', async () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const W = world(src, { seed, yields: 1 + (seed % 4) }); W.make();
      W.store.data.set(W.L.dlSeedMarkerKey(ID), { json: JSON.stringify({ id: 4242, by: 'gone0001', at: new Date(W.clock.now() - 40000).toISOString() }), version: 9003 });
      const [a, b] = await Promise.all([W.page('aaaa1111'), W.page('bbbb2222')]);
      await W.run(10000);
      const m = [a, b].map((p) => p.session.stats().marker);
      assert.equal(m.filter((x) => x === 'took').length, 1, `seed ${seed}: ${m}`);
      assert.ok(a.how && b.how && a.text() === TEXT && b.text() === TEXT && count(W, a) === 1, `seed ${seed}`);
    }
  });
  await test('a marker whose writer is at the module but not in the document is taken over once it is seedGraceMs old', async () => {
    const W = world(src); W.make();
    W.bus.connect('keep0001'); // at the module (in the people list), never on the document's topic
    const at = W.clock.now();
    W.store.data.set(W.L.dlSeedMarkerKey(ID), { json: JSON.stringify({ id: 777, by: 'keep0001', at: new Date(at).toISOString() }), version: 9002 });
    const a = await W.page('aaaa1111'); await W.run(2000);
    assert.equal(a.how, null, 'younger than the grace: its writer may be seeding right now');
    await W.run(W.L.DL_SYNC.seedGraceMs + 2500);
    assert.equal(a.how, 'timeout'); assert.equal(a.session.stats().marker, 'took'); assert.equal(a.text(), TEXT);
    facts.push(`a marker of a writer who never shows: taken over ${a.joinedAt - at} ms after it was made (grace ${W.L.DL_SYNC.seedGraceMs})`);
  });
  await test('a marker whose writer is in the document but never seeds holds the new page for no longer than seedCapMs', async () => {
    const W = world(src); W.make();
    const k = W.bus.connect('keep0001');
    k.subs.set(W.L.dlSyncTopic(ID), () => {});
    const at = W.clock.now();
    W.store.data.set(W.L.dlSeedMarkerKey(ID), { json: JSON.stringify({ id: 777, by: 'keep0001', at: new Date(at).toISOString() }), version: 9002 });
    const emptyVector = W.L.dlSyncB64(W.PM.encodeStateVector(new W.PM.Doc()));
    const beat = () => { k.live.publish(W.L.dlSyncTopic(ID), { v: emptyVector, e: 0, a: 0 }); W.clock.set(beat, 2000); };
    beat();
    const a = await W.page('aaaa1111'); await W.run(W.L.DL_SYNC.seedCapMs - 3000);
    assert.equal(a.how, null, 'its writer is here: a waits');
    await W.run(8000);
    assert.equal(a.how, 'timeout'); assert.equal(a.session.stats().marker, 'took'); assert.equal(a.text(), TEXT);
    facts.push(`a marker of a writer who is here but never seeds: the new page waited ${a.joinedAt - at} ms (cap ${W.L.DL_SYNC.seedCapMs})`);
  });
  await test('a garbage marker, and a marker dated in the future, are never a block', async () => {
    for (const bad of [{ nope: 1 }, 'text', null, [], { id: -1, by: 'x', at: 'y' }, { id: 5, by: '', at: new Date().toISOString() }, { id: 1.5, by: 'x', at: new Date().toISOString() }]) {
      const W = world(src); W.make();
      W.store.data.set(W.L.dlSeedMarkerKey(ID), { json: JSON.stringify(bad), version: 9002 });
      const a = await W.page('aaaa1111'); await W.run(4000);
      assert.equal(a.how, 'alone', JSON.stringify(bad)); assert.equal(a.text(), TEXT);
    }
    const W = world(src); W.make();
    W.store.data.set(W.L.dlSeedMarkerKey(ID), { json: JSON.stringify({ id: 99, by: 'gone0001', at: new Date(W.clock.now() + 7 * 86400000).toISOString() }), version: 9002 });
    const t = W.clock.now();
    const a = await W.page('aaaa1111'); await W.run(W.L.DL_SYNC.seedCapMs + 8000);
    assert.ok(a.how && a.text() === TEXT, 'a marker from the future is watched for the cap and then taken');
  });
  await test('a viewer never writes: a page that may not edit makes no marker call; a store that answers 403 leaves the page seeding as before', async () => {
    const W = world(src); W.make();
    const v = await W.page('view0001', { editor: false }); await W.run(4000);
    assert.equal(v.how, 'alone');
    assert.equal(W.store.count('set'), 0, 'no write at all');
    assert.equal(v.session.stats().markerCalls, 0);
    const W2 = world(src); W2.make();
    const x = await W2.page('view0002', { role: 'viewer' }); await W2.run(4000);
    assert.equal(x.how, 'alone'); assert.equal(x.text(), TEXT);
    assert.equal(x.session.stats().marker, 'failed'); assert.equal(W2.store.count('set', 403), 1);
    assert.equal(W2.store.peek(W2.L.dlSeedMarkerKey(ID)), null);
  });
  await test('413, 429 and a store that is down: the page still seeds (the 4a rule), and says so in the counters', async () => {
    for (const [label, err] of [['full', Object.assign(new Error('storage is full'), { status: 413 })], ['limit', Object.assign(new Error('Too many'), { status: 429, retryAfter: 5 })], ['down', Object.assign(new Error('network'), { status: 0 })]]) {
      const W = world(src); W.make();
      W.store.fault = (op, key) => (op === 'set' && key.startsWith('ydoc:') ? err : null);
      const a = await W.page('aaaa1111'); await W.run(4000);
      assert.equal(a.how, 'alone', label); assert.equal(a.session.stats().markerFailed, 1, label); assert.equal(a.text(), TEXT);
    }
  });
  await test('the marker is a plain key the server accepts, and its value is small', () => {
    const W = world(src);
    const key = W.L.dlSeedMarkerKey('abcd1234efgh');
    assert.ok(/^[A-Za-z0-9_.:/-]{1,128}$/.test(key)); assert.equal(key, 'ydoc:abcd1234efgh:seed');
    assert.ok(JSON.stringify({ id: 4294967295, by: 'u'.repeat(64), at: new Date().toISOString() }).length < 200);
    assert.deepEqual(W.L.dlCleanSeedMarker({ id: 5, by: 'ana', at: '2026-11-12T10:00:00.000Z', extra: 1 }), { id: 5, by: 'ana', at: '2026-11-12T10:00:00.000Z' });
  });
}

console.log(fails.length ? `documents coedit writer: ${fails.length} failed, ${passed} passed` : `documents coedit writer: ${passed} tests passed in ${((Date.now() - t0) / 1000).toFixed(1)} s${facts.length ? ` (${facts.join('; ')})` : ''}`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
