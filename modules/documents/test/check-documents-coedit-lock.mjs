#!/usr/bin/env node
/*
 * check-documents-coedit-lock.mjs -- the document lock, the editors list and a rename from the list (documents-lib-x-coedit-meta.js, the gate's checkMeta,
 * the record, the save), in Node with no DOM, no network and no timers: the stand-in bus, manual clock and fake store of the other co-editing tests.
 * Plan: plan-documents-coediting.md, step 4c. What this does NOT cover: the Page menu entry, the banner, the editor refusing a typed key, the chips as drawn
 * (the live run in real Chromium does).
 *
 *  1. The gate: the lock key (by, name, at) passes; any other shape is refused as `attrs`; the map still holds at most six keys.
 *  2. The rules: who may lock and who may unlock (owner and admin always, the person who locked, nobody else), with the reason in plain words.
 *  3. The record: a lock round-trips; the reader that does not know the field (the switch off) reads the same record; a bad lock is dropped.
 *  4. Two pages: a lock reaches the other page and the stored record; an unlock too; a fresh opener takes the record's lock, but never gives back a lock that
 *     was removed; a copy of the state whose lock differs from the record is not trusted.
 *  5. The editors list: colours are the host's rule, the order is the same everywhere, a name that is not known falls back to initials, readers are not in it.
 *  6. A rename from the list: the writer puts the record's title into the shared settings; the other page shows it; nothing loops.
 *
 * Usage: node modules/documents/test/check-documents-coedit-lock.mjs [path to the src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
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
function updateOf(live, mut) { const d = fresh(live); const before = PM.encodeStateVector(live); d.transact(() => mut(d), 'test'); return PM.encodeStateAsUpdate(d, before); }
const LOCK = { by: 'aaaa1111', name: 'Ana', at: 1760000000000 };

// ---- 1. the gate ----------------------------------------------------------------------------------------------------------------------
const CASES = [
  ['a good lock', (d) => d.getMap('meta').set('lock', { ...LOCK }), ''],
  ['a lock with the five other keys', (d) => { const m = d.getMap('meta'); m.set('title', 'T'); m.set('paper', 'dark-blue'); m.set('layout', 'paper'); m.set('pageSize', 'a4'); m.set('pageNumbers', true); m.set('lock', { ...LOCK }); }, ''],
  ['a name of exactly 60 characters', (d) => d.getMap('meta').set('lock', { ...LOCK, name: 'n'.repeat(60) }), ''],
  ['a name of 61 characters', (d) => d.getMap('meta').set('lock', { ...LOCK, name: 'n'.repeat(61) }), 'attrs'],
  ['a name with a line break', (d) => d.getMap('meta').set('lock', { ...LOCK, name: 'a\nb' }), 'attrs'],
  ['a name with a control character', (d) => d.getMap('meta').set('lock', { ...LOCK, name: 'a\u0001' }), 'attrs'],
  ['a name that is a number', (d) => d.getMap('meta').set('lock', { ...LOCK, name: 5 }), 'attrs'],
  ['a person key with a space', (d) => d.getMap('meta').set('lock', { ...LOCK, by: 'a b' }), 'attrs'],
  ['a person key of 65 characters', (d) => d.getMap('meta').set('lock', { ...LOCK, by: 'k'.repeat(65) }), 'attrs'],
  ['an empty person key', (d) => d.getMap('meta').set('lock', { ...LOCK, by: '' }), 'attrs'],
  ['a time that is text', (d) => d.getMap('meta').set('lock', { ...LOCK, at: 'now' }), 'attrs'],
  ['a time that is not finite (NaN)', (d) => d.getMap('meta').set('lock', { ...LOCK, at: NaN }), 'attrs'],
  ['a time that is infinite', (d) => d.getMap('meta').set('lock', { ...LOCK, at: Infinity }), 'attrs'],
  ['a lock with a fourth key', (d) => d.getMap('meta').set('lock', { ...LOCK, extra: 1 }), 'attrs'],
  ['a lock missing its time', (d) => d.getMap('meta').set('lock', { by: LOCK.by, name: LOCK.name }), 'attrs'],
  ['a lock that is a text', (d) => d.getMap('meta').set('lock', 'locked'), 'attrs'],
  ['a lock that is true', (d) => d.getMap('meta').set('lock', true), 'attrs'],
  ['a lock that is a list', (d) => d.getMap('meta').set('lock', [LOCK.by, LOCK.name, LOCK.at]), 'attrs'],
  ['a lock that is null', (d) => d.getMap('meta').set('lock', null), 'attrs'],
  ['a lock that is a shared map', (d) => { const m = d.getMap('meta'); m.set('lock', new m.constructor()); }, 'attrs'],
  ['a lock with a __proto__ key', (d) => d.getMap('meta').set('lock', JSON.parse('{"by":"a","name":"b","at":1,"__proto__":{"x":1}}')), 'attrs'],
  ['a seventh key beside the lock', (d) => { const m = d.getMap('meta'); m.set('lock', { ...LOCK }); m.set('evil', 1); }, 'attrs'],
  ['a key called locked', (d) => d.getMap('meta').set('locked', { ...LOCK }), 'attrs'],
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
    if (want) { assert.equal(r.reason, want); assert.equal(live.getMap('meta').has('lock'), false, 'nothing was applied'); } else assert.deepEqual(live.getMap('meta').get('lock'), name === 'a name of exactly 60 characters' ? { ...LOCK, name: 'n'.repeat(60) } : { ...LOCK });
    g.destroy();
  });
}
await test('removing the lock (an unlock) passes the gate', () => {
  const live = seeded(); live.getMap('meta').set('lock', { ...LOCK });
  const u = updateOf(live, (d) => d.getMap('meta').delete('lock'));
  assert.equal(G.gateUpdate(live, u, undefined, { lex }).ok, true);
});

// ---- 2. the rules ---------------------------------------------------------------------------------------------------------------------
await test('who may lock and who may unlock', () => {
  const R = (o) => L.dlCoLockRules({ me: 'bbbb2222', role: 'member', canType: true, lock: null, ownerWord: 'an owner', ...o });
  assert.deepEqual(R({}), { lock: true, unlock: false, reason: '' }, 'an editor can lock');
  assert.deepEqual(R({ canType: false }), { lock: false, unlock: false, reason: '' }, 'a reader (the ninth person) can neither');
  const locked = { by: 'aaaa1111', name: 'Ana', at: 1 };
  assert.deepEqual(R({ lock: locked }), { lock: false, unlock: false, reason: 'Only Ana or an owner can unlock.' }, 'another member cannot unlock, and is told why');
  assert.equal(R({ lock: locked, role: 'owner' }).unlock, true, 'an owner always can');
  assert.equal(R({ lock: locked, role: 'admin' }).unlock, true, 'an admin always can');
  assert.equal(R({ lock: locked, me: 'aaaa1111' }).unlock, true, 'the person who locked can');
  assert.equal(R({ lock: locked, role: 'moderator' }).unlock, false, 'the host gives a module no space role: a moderator is not an owner here');
  assert.equal(R({ lock: locked, role: 'guest' }).unlock, false);
  assert.equal(R({ lock: locked, ownerWord: 'a captain' }).reason, 'Only Ana or a captain can unlock.', 'the word for an owner is the environment\'s');
  assert.equal(R({ lock: locked, canType: false, role: 'owner' }).unlock, false, 'a reader does not unlock even as an owner (they are not editing)');
});

// ---- 3. the record --------------------------------------------------------------------------------------------------------------------
const REC = { id: ID, type: 'doc', title: 'Plan', rev: 2, chunks: ['aaaa1111'], size: 10, excerpt: 'Hi', paper: 'light-white', layout: 'fluid', pageSize: 'letter', pageNumbers: false, by: 'u1', at: '2026-11-11T10:00:00.000Z', editedBy: 'u1', editedByName: 'Ana', editedAt: '2026-11-11T10:00:00.000Z' };
await test('the record carries the lock: it round-trips; a bad lock is dropped; the reader that ignores unknown fields reads the record the same', () => {
  assert.deepEqual(L.dlCleanDoc({ ...REC, lock: LOCK }).lock, LOCK);
  assert.equal(Object.prototype.hasOwnProperty.call(L.dlCleanDoc(REC), 'lock'), false, 'a record without a lock has none');
  for (const bad of [{ ...LOCK, extra: 1 }, { by: 'a' }, 'x', 5, [], { ...LOCK, at: 'now' }, { ...LOCK, name: 'x'.repeat(61) }]) assert.equal(L.dlCleanDoc({ ...REC, lock: bad }).lock, undefined, JSON.stringify(bad));
  // the old reader (the switch off) is dlCleanDoc as it was: it never looked at `lock`; every other field is the same with or without it
  const a = L.dlCleanDoc(REC); const b = L.dlCleanDoc({ ...REC, lock: LOCK }); delete b.lock;
  assert.deepEqual(a, b);
  const textRev = L.dlCleanDoc({ ...REC, textRev: 3 }); assert.equal(textRev.textRev, 3);
});
await test('a save without a lock argument leaves the stored lock alone; null removes it; an object sets it', () => {
  const plan = (lock) => L.dlPlanSave({ old: [{ id: 'aaaa1111', text: 'Hi\n' }], text: 'Hi there\n', title: 'Plan', paper: 'light-white', page: undefined, rec: L.dlCleanDoc({ ...REC, lock: LOCK }), me: 'u1', name: 'Ana', now: '2026-11-11T11:00:00.000Z', fresh: () => 'bbbb2222', lex, lock }).record;
  assert.deepEqual(plan(undefined).lock, LOCK);
  assert.equal('lock' in plan(null), false);
  assert.deepEqual(plan({ by: 'z', name: 'Z', at: 5 }).lock, { by: 'z', name: 'Z', at: 5 });
});

// ---- 4. two pages ---------------------------------------------------------------------------------------------------------------------
const twoPages = async (o = {}) => {
  const W = world(src); W.make(TEXT, 'Plan');
  const a = await W.page('aaaa1111', { meta: true, ...o }); await W.run(500);
  const b = await W.page('bbbb2222', { meta: true, ...o }); await W.run(2500);
  return { W, a, b };
};
await test('a lock set on one page is on the other within a second and in the stored record within 14 s; an unlock too', async () => {
  const { W, a, b } = await twoPages();
  assert.equal(L.dlMetaSet(a.doc(), { lock: { ...LOCK } }, 'dl-meta'), 1);
  assert.equal(L.dlMetaSet(a.doc(), { lock: { ...LOCK } }, 'dl-meta'), 0, 'the same lock is not set again');
  await W.run(600);
  assert.deepEqual(L.dlMetaRead(b.doc()).lock, LOCK);
  await W.run(14000);
  assert.deepEqual(W.stored().rec.lock, LOCK);
  assert.equal(W.stored().text, TEXT);
  L.dlMetaSet(b.doc(), { lock: null }, 'dl-meta');
  await W.run(600);
  assert.equal(L.dlMetaRead(a.doc()).lock, null);
  await W.run(14000);
  assert.equal(W.stored().rec.lock, undefined, 'the unlock is stored');
  await W.leave(b); await W.leave(a); await W.run(200);
  facts.push('a lock reached the other page in 600 ms and the record within 14 s; the unlock the same');
});
await test('the lock survives everyone leaving: a fresh opener takes the record\'s lock', async () => {
  const { W, a, b } = await twoPages();
  L.dlMetaSet(a.doc(), { lock: { ...LOCK } }, 'dl-meta');
  await W.run(14000);
  await W.leave(b); await W.leave(a); await W.run(200);
  assert.deepEqual(W.stored().rec.lock, LOCK);
  const c = await W.page('cccc3333', { meta: true }); await W.run(3000);
  assert.deepEqual(L.dlMetaRead(c.doc()).lock, LOCK, 'a new opener sees it');
  await W.leave(c);
});
await test('the last editor who locks and leaves at once still stores the lock', async () => {
  const W = world(src); W.make(TEXT, 'Plan');
  const a = await W.page('aaaa1111', { meta: true }); await W.run(3000);
  L.dlMetaSet(a.doc(), { lock: { ...LOCK } }, 'dl-meta'); a.saver.changed();
  const left = W.leave(a); await W.run(20000);
  const r = await left;
  assert.ok(r === 'go' || r === 'stay', r);
  assert.deepEqual(W.stored().rec.lock, LOCK);
});
await test('fill: a document made from a locked record takes the lock; a document that has its keys but no lock is not given a removed lock back', async () => {
  const d = new PM.Doc(); const rec = L.dlCleanDoc({ ...REC, lock: LOCK });
  assert.equal(L.dlMetaFill(d, rec), 6, 'five keys and the lock');
  assert.deepEqual(L.dlMetaRead(d).lock, LOCK);
  const e = new PM.Doc(); L.dlMetaFill(e, L.dlCleanDoc(REC)); // a document with all five keys and no lock (it was unlocked)
  assert.equal(L.dlMetaFill(e, rec), 0, 'a stale record does not lock it again');
  assert.equal(L.dlMetaRead(e).lock, null);
  assert.ok(L.dlMetaSame(d, rec) && !L.dlMetaSame(e, rec) && L.dlMetaSame(e, L.dlCleanDoc(REC)));
});
await test('a copy of the state whose lock differs from the saved record is not trusted (meta_differs); one that matches is loaded', async () => {
  const W = world(src); W.make(TEXT, 'Plan');
  const a = await W.page('aaaa1111', { snap: true }); await W.run(500); const b = await W.page('bbbb2222', { snap: true }); await W.run(3000);
  L.dlMetaSet(a.doc(), { lock: { ...LOCK } }, 'dl-meta'); a.saver.changed(); b.saver.changed();
  await W.run(70000); // the copy is paced (about 45 s): it follows the saved record
  assert.deepEqual(W.stored().rec.lock, LOCK);
  await W.leave(b); await W.leave(a); await W.run(200);
  const c = await W.page('cccc3333', { snap: true }); await W.run(4000);
  assert.equal(c.session.stats().snapshotLoaded, 1, 'the copy with the same lock was loaded');
  assert.deepEqual(L.dlMetaRead(c.doc()).lock, LOCK);
  await W.leave(c); await W.run(200);
  const cur = W.store.peek(`doc:${ID}`);
  const { lock, ...noLock } = cur.value;
  W.store.data.set(`doc:${ID}`, { json: JSON.stringify(noLock), version: (W.store.versionCounter += 1) });
  const d = await W.page('dddd4444', { snap: true }); await W.run(6000);
  assert.equal(d.session.stats().snapshotLoaded, 0); assert.equal(d.session.stats().snapshotReason, 'meta_differs');
  assert.equal(L.dlMetaRead(d.doc()).lock, null, 'the record says unlocked');
});
await test('a stale page that never heard the lock does not remove it when it saves', async () => {
  const { W, a, b } = await twoPages();
  b.m.state = 'closed';
  L.dlMetaSet(a.doc(), { lock: { ...LOCK } }, 'dl-meta');
  await W.run(14000);
  assert.deepEqual(W.stored().rec.lock, LOCK);
  W.type(b, 0, ' typed on a stale page');
  await b.saver.save(true);
  assert.deepEqual(W.stored().rec.lock, LOCK, 'the stale page did not unlock');
});

// ---- 5. the editors list --------------------------------------------------------------------------------------------------------------
await test('the colours are the host\'s rule (the same function), stable, one of the eight', () => {
  const host = fs.readFileSync(path.join(root, 'public/sdk/host.js'), 'utf8');
  const m = host.match(/const PERSON_TINTS = Object\.freeze\((\[[^\]]*\])\);\s*function personTint\(key\) \{([\s\S]*?)\n  \}/);
  assert.ok(m, 'found the host\'s rule');
  const hostTint = new Function(`const PERSON_TINTS = ${m[1]}; return function personTint(key) {${m[2]}\n}`)();
  for (const k of ['aaaa1111', 'bbbb2222', 'u1', 'mia', 'admin', 'x'.repeat(40), '', 'ß-ü']) assert.equal(L.dlCoTintOf(k), hostTint(k), k);
  assert.deepEqual([...L.DL_TINTS], ['blue', 'green', 'teal', 'purple', 'orange', 'pink', 'gold', 'red']);
});
await test('the list: this person first, the others by key, names with a fallback to initials, readers left out, at most eight', () => {
  const base = { me: 'mmmm0000', myName: 'Mia Ray', meEditor: true, others: ['zzzz9999', 'aaaa1111', 'aaaa1111', 'mmmm0000'], names: { aaaa1111: 'Ana Bell', zzzz9999: '' }, lockBy: 'aaaa1111', lockNote: 'locked it' };
  const out = L.dlCoEditorsList(base);
  assert.deepEqual(out.map((x) => x.key), ['mmmm0000', 'aaaa1111', 'zzzz9999'], 'me first, then by key, no twice');
  assert.deepEqual(out.map((x) => x.initials), ['MR', 'AB', 'ZZ'], 'the third has no name: the key\'s first two');
  assert.equal(out[1].label, 'Ana Bell, locked it'); assert.equal(out[0].label, 'Mia Ray (you)'); assert.equal(out[2].name, 'Someone');
  assert.ok(out[1].locker && !out[0].locker);
  assert.deepEqual(out.map((x) => x.tint), out.map((x) => L.dlCoTintOf(x.key)));
  assert.deepEqual(L.dlCoEditorsList({ ...base, others: ['aaaa1111'] }), L.dlCoEditorsList({ ...base, others: ['aaaa1111', 'aaaa1111'] }));
  assert.deepEqual(L.dlCoEditorsList({ ...base, meEditor: false }).map((x) => x.key), ['aaaa1111', 'zzzz9999'], 'a reader is not listed');
  const crowd = L.dlCoEditorsList({ ...base, others: Array.from({ length: 12 }, (_, i) => `k${String(i).padStart(2, '0')}`) });
  assert.equal(crowd.length, 8);
  assert.deepEqual(L.dlCoEditorsList({ ...base, others: ['k1', 'k2', 'k3'] }).map((x) => x.key), L.dlCoEditorsList({ ...base, others: ['k3', 'k2', 'k1'] }).map((x) => x.key), 'the order does not depend on who was heard first');
  assert.equal(L.dlCoInitials('  ', 'zq'), 'ZQ'); assert.equal(L.dlCoInitials('jean-luc picard', 'k'), 'JP'); assert.equal(L.dlCoInitials('Émile', 'k'), 'É');
});

// ---- 6. a rename from the list --------------------------------------------------------------------------------------------------------
await test('the rename rule: only the writer, only a title that is new to this page, once', () => {
  const o = { recTitle: 'New', savedTitle: 'Old', metaTitle: 'Old', applied: undefined, writer: true, editor: true };
  assert.equal(L.dlCoRenamePlan(o), 'New');
  assert.equal(L.dlCoRenamePlan({ ...o, writer: false }), '', 'not the writer');
  assert.equal(L.dlCoRenamePlan({ ...o, editor: false }), '');
  assert.equal(L.dlCoRenamePlan({ ...o, recTitle: 'Old' }), '', 'the record still says what the page saved');
  assert.equal(L.dlCoRenamePlan({ ...o, metaTitle: 'New' }), '', 'the page shows it already');
  assert.equal(L.dlCoRenamePlan({ ...o, applied: 'New' }), '', 'applied once');
  assert.equal(L.dlCoRenamePlan({ ...o, recTitle: 'x'.repeat(L.DL.titleMax + 1) }), '');
  assert.equal(L.dlCoRenamePlan({ ...o, recTitle: '' }), '');
});
await test('a record renamed from the list: the writer puts the title into the settings, the other page shows it, the record keeps it and nothing loops', async () => {
  const { W, a, b } = await twoPages();
  const writer = [a, b].find((p) => p.session.isWriter()); const other = writer === a ? b : a;
  // the rename of the list: the record's title, under the version, as startRename writes it
  const cur = W.store.peek(`doc:${ID}`);
  W.store.data.set(`doc:${ID}`, { json: JSON.stringify({ ...cur.value, title: 'Renamed from the list', rev: cur.value.rev + 1 }), version: (W.store.versionCounter += 1) });
  // the 'changes' event: the writer hears the record
  let applied;
  const hear = (p) => { const rec = L.dlCleanDoc(W.store.peek(`doc:${ID}`).value); const title = L.dlCoRenamePlan({ recTitle: rec.title, savedTitle: p.st.saved.title, metaTitle: L.dlMetaRead(p.doc()).title, applied, writer: p.session.isWriter(), editor: true }); if (title) { applied = title; L.dlMetaSet(p.doc(), { title }, 'dl-meta'); p.saver.changed(); } return title; };
  assert.equal(hear(other), '', 'the other page does nothing');
  assert.equal(hear(writer), 'Renamed from the list');
  await W.run(800);
  assert.equal(L.dlMetaRead(other.doc()).title, 'Renamed from the list', 'the other page has it within a second');
  await W.run(20000);
  assert.equal(W.stored().rec.title, 'Renamed from the list');
  assert.equal(hear(writer), '', 'heard again: no second change');
  const writes = () => W.store.log.filter((x) => x.op === 'set' && x.status === 200 && x.key.startsWith('doc:')).length;
  const w1 = writes(); await W.run(60000);
  assert.equal(writes(), w1, 'no record writes while nothing changes');
  assert.equal(W.stored().text, TEXT);
  facts.push('a rename from the list reached the other page in under 1 s');
});

console.log(`documents coedit lock: ${passed} tests passed in ${((Date.now() - t0) / 1000).toFixed(1)} s${facts.length ? ` (${facts.join('; ')})` : ''}`);
if (fails.length) { console.log(`\n${fails.length} failed:`); for (const f of fails) console.log(`- ${f}`); process.exit(1); }
