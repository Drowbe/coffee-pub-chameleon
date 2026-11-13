#!/usr/bin/env node
/*
 * check-documents-coedit-meta.mjs -- the title, page colour and page layout that travel with a shared document (documents-lib-x-coedit-meta.js, the gate's
 * checkMeta, the save and the copy), in Node with no DOM, no network and no timers: the stand-in bus, manual clock and fake store of the other co-editing
 * tests. Plan: plan-documents-coediting.md, step 4b, slice 3. What this does NOT cover: the page's controls and the title field's caret rule, the
 * 'changes' event that tells a page its document was deleted (the live run with two real pages does).
 *
 *  1. The gate: the meta map is checked in every update (live check and reference check agree): the five keys with plain values pass; any other key,
 *     type, length or value is refused as `attrs`; a root type other than the text and the map is still refused.
 *  2. The map: set, read with fallbacks, fill what is missing, compare with a record.
 *  3. Travelling: a rename, a colour and a layout set on one page reach the other and the stored record, from the map and not from a page's own state; a
 *     stale page never puts an old title back; a save that finds nothing to write takes the fields as read.
 *  4. A deleted document is never written back; the copy: a copy whose settings differ from the saved record is rejected, one that matches is loaded.
 *
 * Usage: node modules/documents/test/check-documents-coedit-meta.mjs [path to the src folder]. Exits 1 on any failure.
 */
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { world, TEXT, ID } from './support/coedit-page.mjs';

const t0 = Date.now();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(root, 'modules/documents/src'));

let passed = 0; const fails = []; const facts = [];
async function test(name, fn) { try { await fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.stack.split('\n').slice(0, 3).join(' | ')}`); } }
const W0 = world(src); const { L, PM, lex } = W0;
const G = L.dlCoeditGate(PM);
const seeded = () => { const d = new PM.Doc(); L.dlSyncSeed(PM, d, W0.pmDoc(TEXT), ID, TEXT); d.getMap('meta'); return d; };
const fresh = (from) => { const d = new PM.Doc(); PM.applyUpdate(d, PM.encodeStateAsUpdate(from)); d.getMap('meta'); return d; };
// the update a mutation of `mut` (on a copy of `live`) makes
function updateOf(live, mut) {
  const d = fresh(live);
  const before = PM.encodeStateVector(live);
  d.transact(() => mut(d), 'test');
  return PM.encodeStateAsUpdate(d, before);
}
const GOOD = { title: 'Session notes', paper: 'dark-blue', layout: 'paper', pageSize: 'a4', pageNumbers: true };

// ---- 1. the gate -----------------------------------------------------------------------------------------------------------------------
const CASES = [
  ['all five keys, plain values', (d) => { const m = d.getMap('meta'); for (const [k, v] of Object.entries(GOOD)) m.set(k, v); }, ''],
  ['a title of exactly the longest allowed', (d) => d.getMap('meta').set('title', 'x'.repeat(L.DL.titleMax)), ''],
  ['an empty title (a person cleared the field)', (d) => d.getMap('meta').set('title', ''), ''],
  ['a title one longer than the record allows', (d) => d.getMap('meta').set('title', 'x'.repeat(L.DL.titleMax + 1)), 'attrs'],
  ['a title of 30,000 characters', (d) => d.getMap('meta').set('title', 'x'.repeat(30000)), 'attrs'],
  ['a title with a line break', (d) => d.getMap('meta').set('title', 'a\nb'), 'attrs'],
  ['a title with a control character', (d) => d.getMap('meta').set('title', 'a\u0001b'), 'attrs'],
  ['a title that is a number', (d) => d.getMap('meta').set('title', 5), 'attrs'],
  ['a title that is an object', (d) => d.getMap('meta').set('title', { a: 1 }), 'attrs'],
  ['a title that is a list', (d) => d.getMap('meta').set('title', ['a']), 'attrs'],
  ['a title that is a shared map', (d) => { const m = d.getMap('meta'); m.set('title', new m.constructor()); }, 'attrs'],
  ['a title that is null', (d) => d.getMap('meta').set('title', null), 'attrs'],
  ['a colour that is not one of the fixed ones', (d) => d.getMap('meta').set('paper', 'neon'), 'attrs'],
  ['a colour called __proto__', (d) => d.getMap('meta').set('paper', '__proto__'), 'attrs'],
  ['a layout that is not fluid or paper', (d) => d.getMap('meta').set('layout', 'grid'), 'attrs'],
  ['a page size that is not letter or a4', (d) => d.getMap('meta').set('pageSize', 'a5'), 'attrs'],
  ['page numbers that are a word', (d) => d.getMap('meta').set('pageNumbers', 'yes'), 'attrs'],
  ['a sixth key', (d) => d.getMap('meta').set('evil', 'x'), 'attrs'],
  ['a key called __proto__', (d) => d.getMap('meta').set('__proto__', 'x'), 'attrs'],
  ['a key called constructor', (d) => d.getMap('meta').set('constructor', 'x'), 'attrs'],
  ['a root type of another name', (d) => d.getMap('other').set('a', 1), 'unknown_root'],
  ['a root list of another name', (d) => d.getArray('list').push([1]), 'unknown_root'],
];
for (const [name, mut, want] of CASES) {
  await test(`the gate, ${name}: ${want ? `refused as ${want}` : 'accepted'}, by the live check and by the reference check`, () => {
    const live = seeded();
    const u = updateOf(live, mut);
    const ref = G.gateUpdate(live, u, undefined, { lex });
    assert.equal(ref.ok, !want, `reference check: ${JSON.stringify(ref).slice(0, 200)}`);
    if (want) assert.equal(ref.reason, want);
    const g = G.guard(live, undefined, { lex, origin: 'net' });
    g.prime();
    const r = g.receive(u, 'p1');
    assert.equal(r.ok, !want, `live check: ${JSON.stringify(r).slice(0, 200)}`);
    if (want) { assert.equal(r.reason, want); assert.equal(live.getMap('meta').size, 0, 'nothing was applied to the live document'); } else if (name.startsWith('all five')) {
      assert.equal(live.getMap('meta').get('title'), 'Session notes');
    }
    g.destroy();
  });
}
await test('a meta change touches no block: the text is the same and the totals are unchanged; a later text update is still checked', () => {
  const live = seeded();
  const g = G.guard(live, undefined, { lex, origin: 'net' }); g.prime();
  const before = g.stats();
  const a = fresh(live); const va = PM.encodeStateVector(live);
  a.transact(() => { for (const [k, v] of Object.entries(GOOD)) a.getMap('meta').set(k, v); }, 'x');
  assert.ok(g.receive(PM.encodeStateAsUpdate(a, va), 'p1').ok);
  const mid = g.stats();
  assert.equal(mid.nodes, before.nodes); assert.equal(mid.text, before.text);
  const vb = PM.encodeStateVector(live);
  a.transact(() => { const t = a.getXmlFragment(G.limits.root).get(0).get(0); t.insert(0, 'Hi '); }, 'x');
  assert.ok(g.receive(PM.encodeStateAsUpdate(a, vb), 'p1').ok);
  const hostile = fresh(live); const vh = PM.encodeStateVector(live);
  hostile.transact(() => { hostile.getXmlFragment(G.limits.root).get(0).get(0).insert(0, 'a\u0000b'); }, 'x');
  assert.equal(g.receive(PM.encodeStateAsUpdate(hostile, vh), 'p2').reason, 'chars', 'a bad text is still refused after meta updates');
  g.destroy();
});
await test('the copy and a rebuild go through the same check: a state with a bad map is not rebuilt, one with a good map is (and keeps it)', () => {
  const good = seeded(); for (const [k, v] of Object.entries(GOOD)) good.getMap('meta').set(k, v);
  const r = G.rebuildFromGood(PM.encodeStateAsUpdate(good), undefined);
  assert.ok(r.ok, r.reason); assert.equal(r.doc.getMap('meta').get('title'), 'Session notes');
  const bad = seeded(); bad.getMap('meta').set('paper', 'neon');
  const r2 = G.rebuildFromGood(PM.encodeStateAsUpdate(bad), undefined);
  assert.equal(r2.ok, false); assert.equal(r2.reason, 'attrs');
  const v = G.verifyBeforeSnapshot(lex, bad, TEXT); assert.equal(v.ok, false); assert.equal(v.reason, 'attrs', 'the writer does not copy a state with a bad map');
  assert.ok(G.verifyBeforeSnapshot(lex, good, TEXT).ok, 'and does copy one with a good map');
});

// ---- 2. the map ------------------------------------------------------------------------------------------------------------------------
const REC = { title: 'Plan', paper: 'light-creme', layout: 'paper', pageSize: 'a4', pageNumbers: true };
await test('dlMetaOf, dlMetaFill, dlMetaRead, dlMetaSet, dlMetaSame', () => {
  const d = new PM.Doc();
  assert.deepEqual(L.dlMetaRead(d, { title: 'T', paper: 'dark-slate', page: { layout: 'paper' } }).missing, [...L.DL_META.keys]);
  const m0 = L.dlMetaRead(d, { title: 'T', paper: 'dark-slate', page: { layout: 'paper' } });
  assert.equal(m0.title, 'T'); assert.equal(m0.paper, 'dark-slate'); assert.equal(m0.page.layout, 'paper', 'a missing key reads as the fallback');
  assert.equal(L.dlMetaFill(d, REC), 5, 'a document without the keys gets all five from the record');
  assert.equal(L.dlMetaFill(d, { ...REC, title: 'Other' }), 0, 'and a second fill changes nothing');
  assert.equal(L.dlMetaRead(d).title, 'Plan');
  assert.ok(L.dlMetaSame(d, REC)); assert.ok(!L.dlMetaSame(d, { ...REC, title: 'x' }));
  assert.equal(L.dlMetaSet(d, { title: 'Plan', paper: 'light-creme' }), 0, 'a key that holds the value is not set again (no update)');
  assert.equal(L.dlMetaSet(d, { title: 'New', evil: 1, paper: 'neon' }), 1, 'only a valid key with a valid value is set');
  assert.equal(L.dlMetaRead(d).title, 'New'); assert.equal(L.dlMetaRead(d).paper, 'light-creme');
  assert.equal(L.dlMetaProblem(d.getMap('meta')), '');
});
await test('the meta map cannot be turned into a store: more than five keys is refused whatever they hold', () => {
  const d = new PM.Doc(); const m = d.getMap('meta');
  for (let i = 0; i < 6; i += 1) m.set(`k${i}`, 'x');
  assert.ok(L.dlMetaProblem(m));
});

// ---- 3. travelling ---------------------------------------------------------------------------------------------------------------------
const twoPages = async (o = {}) => {
  const W = world(src); W.make(TEXT, 'Plan');
  const a = await W.page('aaaa1111', { meta: true, ...o }); await W.run(500);
  const b = await W.page('bbbb2222', { meta: true, ...o }); await W.run(2500);
  return { W, a, b };
};
await test('the seed puts the record\'s title, colour and layout into the map; the second page has them from the first', async () => {
  const { W, a, b } = await twoPages();
  for (const p of [a, b]) { const m = L.dlMetaRead(p.doc()); assert.deepEqual(m.missing, []); assert.equal(m.title, 'Plan'); assert.equal(m.paper, 'light-white'); assert.equal(m.page.layout, 'fluid'); }
  assert.equal(b.session.stats().isWriter, false);
});
await test('a rename, a colour and a layout travel to the other page and into the stored record, and again after both leave', async () => {
  const { W, a, b } = await twoPages();
  L.dlMetaSet(a.doc(), { title: 'New name' }, 'dl-meta');
  await W.run(400);
  assert.equal(L.dlMetaRead(b.doc()).title, 'New name', 'the other page has the title within 400 ms');
  L.dlMetaSet(b.doc(), { paper: 'dark-blue', layout: 'paper', pageSize: 'a4', pageNumbers: true }, 'dl-meta');
  await W.run(400);
  const ma = L.dlMetaRead(a.doc()); assert.equal(ma.paper, 'dark-blue'); assert.equal(ma.page.layout, 'paper'); assert.equal(ma.page.pageSize, 'a4'); assert.equal(ma.page.pageNumbers, true);
  assert.equal(ma.title, 'New name', 'two different keys changed by two people both stay');
  await W.run(14000);
  const st = W.stored().rec;
  assert.equal(st.title, 'New name'); assert.equal(st.paper, 'dark-blue'); assert.equal(st.layout, 'paper'); assert.equal(st.pageSize, 'a4'); assert.equal(st.pageNumbers, true);
  assert.equal(W.stored().text, TEXT, 'the text is untouched by the settings');
  await W.leave(b); await W.leave(a); await W.run(200);
  assert.equal(W.stored().rec.title, 'New name');
  facts.push('a title, colour and layout set on two pages: on the other page 400 ms later; in the stored record within 14 s; the text untouched');
});
await test('the same key changed on two pages at once: one value wins, the same on both pages and in the record', async () => {
  const { W, a, b } = await twoPages();
  L.dlMetaSet(a.doc(), { title: 'From A' }, 'dl-meta'); L.dlMetaSet(b.doc(), { title: 'From B' }, 'dl-meta');
  await W.run(600);
  const ta = L.dlMetaRead(a.doc()).title; const tb = L.dlMetaRead(b.doc()).title;
  assert.equal(ta, tb); assert.ok(ta === 'From A' || ta === 'From B');
  await W.run(14000);
  assert.equal(W.stored().rec.title, ta);
});
await test('a page that left the room before the rename (so its map is old) does not put the old title back when it saves', async () => {
  const { W, a, b } = await twoPages();
  b.m.state = 'closed'; // b hears nothing from here on
  L.dlMetaSet(a.doc(), { title: 'Renamed' }, 'dl-meta');
  await W.run(14000);
  assert.equal(W.stored().rec.title, 'Renamed');
  W.type(b, 0, ' typed on a stale page');
  const r = await b.saver.save(true);
  assert.ok(r === 'saved' || r === 'busy', r);
  assert.equal(W.stored().rec.title, 'Renamed', 'the stored title stays; the stale page did not change it');
  assert.ok(W.stored().text.includes('typed on a stale page'));
});
await test('dlCoeditSave: a save that finds nothing to write takes the fields it compared as read (a page that heard a rename is not unsaved for ever)', async () => {
  const W = world(src); const rec = W.make(TEXT, 'Plan');
  const h = W.store.as('aaaa1111');
  const read = await L.dlCoReadStored(h, ID);
  const st = { id: ID, rec: read.rec, docVersion: read.version, old: read.parts, saved: { text: read.text, title: 'Old', paper: read.rec.paper, page: L.dlCleanPage(read.rec) }, log: [], stray: [] };
  const io = { current: () => ({ text: read.text, title: 'Plan', paper: read.rec.paper, page: L.dlCleanPage(read.rec), rev: 1 }), me: 'aaaa1111', name: 'Ana', now: () => new Date(W.clock.now()).toISOString(), nowMs: () => W.clock.now(), fresh: () => L.dlNewId(Math.random), lex, sleep: async () => {} };
  const out = await L.dlCoeditSave(h, st, io);
  assert.equal(out.status, 'same');
  assert.equal(st.saved.title, 'Plan', 'the title counts as read: the next test of "unsaved" finds nothing');
  assert.equal(W.store.log.filter((x) => x.op === 'set' && x.status === 200 && x.who === 'aaaa1111' && x.key.startsWith('text:')).length, 0, 'nothing was written');
  assert.equal(W.stored().rec.rev, rec.rev);
});
await test('an idle shared document with a rename in it does not save in a loop: after the settings are stored the store sees no more writes', async () => {
  const { W, a, b } = await twoPages();
  L.dlMetaSet(a.doc(), { title: 'Quiet', paper: 'dark-slate' }, 'dl-meta');
  await W.run(20000);
  const writes = () => W.store.log.filter((x) => x.op === 'set' && x.status === 200 && x.key.startsWith('doc:')).length;
  const w1 = writes();
  await W.run(60000);
  assert.equal(writes(), w1, 'no record writes while nothing changes');
});

// ---- 4. a deleted document, and the copy ----------------------------------------------------------------------------------------------
await test('a deleted document is never written back: the saver says gone, the stored record stays deleted, the text stays in the page', async () => {
  const { W, a, b } = await twoPages();
  W.type(a, 0, ' before the delete'); await W.run(300);
  for (const k of [...W.store.data.keys()]) if (k === `doc:${ID}` || k.startsWith(`text:${ID}:`)) W.store.data.delete(k);
  W.type(b, 2, ' typed after the delete'); await W.run(400);
  await W.run(20000);
  assert.ok(W.pages.some((p) => p.refused.includes('gone')), 'a page found the document gone');
  const r = await b.saver.save(true);
  assert.equal(r, 'gone');
  assert.equal(W.store.peek(`doc:${ID}`), null, 'the record was not written back');
  assert.ok(b.text().includes('typed after the delete'), 'the text is still in the page');
  const afterRecord = W.store.log.filter((x) => x.op === 'set' && x.status === 200 && (x.key === `doc:${ID}` || x.key.startsWith(`text:${ID}`)));
  const lastAt = Math.max(...afterRecord.map((x) => x.at));
  assert.ok(lastAt < W.clock.now() - 15000, 'the last record or text write was long before the end of the run');
});
await test('the copy carries the settings: a copy whose settings match the saved record is loaded; one that does not is rejected (meta_differs) and the page opens from the text with the record\'s settings', async () => {
  const W = world(src); W.make(TEXT, 'Plan');
  const a = await W.page('aaaa1111', { snap: true }); await W.run(500); const b = await W.page('bbbb2222', { snap: true }); await W.run(14000);
  assert.ok(W.store.peek(`ydoc:${ID}`), 'a copy was written');
  await W.leave(b); await W.leave(a); await W.run(200);
  const c = await W.page('cccc3333', { snap: true }); await W.run(4000);
  assert.equal(c.session.stats().snapshotLoaded, 1, 'the copy was loaded');
  assert.equal(L.dlMetaRead(c.doc()).title, 'Plan');
  await W.leave(c); await W.run(200);
  // the record is renamed outside the shared document (the switch was off for a moment): same text, same textRev, another title
  const cur = W.store.peek(`doc:${ID}`);
  W.store.data.set(`doc:${ID}`, { json: JSON.stringify({ ...cur.value, title: 'Renamed elsewhere' }), version: (W.store.versionCounter += 1) });
  const d = await W.page('dddd4444', { snap: true }); await W.run(6000);
  assert.equal(d.session.stats().snapshotLoaded, 0, 'the copy was not loaded');
  assert.equal(d.session.stats().snapshotReason, 'meta_differs');
  assert.equal(d.text(), TEXT); assert.equal(L.dlMetaRead(d.doc()).title, 'Renamed elsewhere', 'the page has the record\'s title');
  assert.equal(L.dlMetaRead(d.doc()).missing.length, 0);
});

const failedTotal = fails.length;
console.log(`documents coedit meta: ${passed} tests passed in ${((Date.now() - t0) / 1000).toFixed(1)} s${facts.length ? ` (${facts.join('; ')})` : ''}`);
if (failedTotal) { console.log(`\n${failedTotal} failed:`); for (const f of fails) console.log(`- ${f}`); process.exit(1); }
