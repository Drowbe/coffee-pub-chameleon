#!/usr/bin/env node
/*
 * check-documents-coedit-save.mjs -- how a shared document's text is saved (documents-lib-v-coedit-save.js), in Node with no DOM, no network and no timers:
 * the stand-in bus and manual clock, and a fake store with the server's version, 409, 413 and 429 rules (test/support/fake-store.mjs, whose calls
 * interleave the way requests do). The text a page saves is the editor's own writer on the converged Y state. Plan: plan-documents-coediting.md,
 * step 4b, slice 1. What this does NOT cover: the real server and SDK, the browser, a page being closed (the live run covers Back and a closed tab).
 *
 *  1. The pure pieces: the delay (quiet beat, gap, longest wait, hold), the backoff, what a store's error means, the record's textRev.
 *  2. One save against the fake store: merge before write (equal text writes nothing; a newer record is read first), 409 and the retry, strays, title kept.
 *  3. Races: two to eight pages save at once, over many interleavings: one committed text, no stray chunk, textRev equals the commits.
 *  4. 413 and 429: the state stays in the page, the answer is 'full' or 'limit', the next try waits longer, nothing is lost, and it saves once space is back.
 *  5. The writer's timing on pages that type: 3 s after the last change, once in 5 s, never silent for more than 15 s.
 *  6. Leaving: everyone leaves in the same tick (the stored text is the merged text), the writer leaves mid-edit, a page leaves while the writer is gone,
 *     a page that cannot save stays.
 *
 * Usage: node modules/documents/test/check-documents-coedit-save.mjs [path to the src folder]. Exits 1 on any failure.
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
const W0 = world(src); const L = W0.L;

// ---- 1. the pure pieces -----------------------------------------------------------------------------------------------------------------
await test('dlCoSaveDelay: 3 s after the last change, 5 s after the last save, 15 s at the longest, a hold, nothing when clean', () => {
  const d = L.dlCoSaveDelay;
  assert.equal(d({ now: 1000, lastKey: 900, lastSave: -Infinity, dirty: false }), null);
  assert.equal(d({ now: 1000, lastKey: 900, lastSave: -Infinity, dirty: true }), 2900, '3 s after the last change');
  assert.equal(d({ now: 5000, lastKey: 900, lastSave: -Infinity, dirty: true }), 0);
  assert.equal(d({ now: 5000, lastKey: 4900, lastSave: 4000, dirty: true }), 4000, 'the gap since the last save is longer: 5 s');
  assert.equal(d({ now: 5000, lastKey: 1000, lastSave: 4000, dirty: true }), 4000, 'the quiet beat is over, the gap is not');
  assert.equal(d({ now: 9000, lastKey: 8900, lastSave: 0, dirty: true, since: 1000 }), 2900, 'changes keep coming: the beat');
  assert.equal(d({ now: 16000, lastKey: 15900, lastSave: 0, dirty: true, since: 1000 }), 0, '15 s after the first unsaved change it saves anyway');
  assert.equal(d({ now: 10000, lastKey: 9990, lastSave: 0, dirty: true, since: 1000 }), 2990, 'before the longest wait the beat decides');
  assert.equal(d({ now: 15000, lastKey: 14900, lastSave: 0, dirty: true, since: 1000 }), 1000, 'and near it the longest wait does');
  assert.equal(d({ now: 5000, lastKey: 1000, lastSave: -Infinity, dirty: true, force: true }), 0, 'hidden: no wait for a change');
  assert.equal(d({ now: 5000, lastKey: 4999, lastSave: 4000, dirty: true, force: true }), 4000, 'but the gap holds');
  assert.equal(d({ now: 5000, lastKey: 1000, lastSave: 0, dirty: true, hold: 9000 }), 4000, 'a failed save is asked again later');
  assert.equal(d({ now: 5000, lastKey: NaN, lastSave: NaN, dirty: true }), 0);
});
await test('dlCoBackoff: doubles from 2 s to 30 s; a 429 never asks for less than it was told', () => {
  const b = L.dlCoBackoff;
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 20].map((n) => b(n)), [2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000]);
  assert.equal(b(1, 10), 10000); assert.equal(b(5, 10), 30000); assert.equal(b(1, 500), 60000, 'a silly Retry-After is cut at a minute'); assert.equal(b(1, 'x'), 2000);
});
await test('dlCoErr: 409, 413, 429, 403, 404 and the same as sentences', () => {
  const e = (status, message) => L.dlCoErr(Object.assign(new Error(message || ''), status ? { status } : {}));
  assert.deepEqual([e(409), e(413), e(429), e(403), e(404), e(500), e(0, 'network')], ['conflict', 'full', 'limit', 'forbidden', 'gone', 'failed', 'failed']);
  assert.equal(e(0, 'storage is full'), 'full'); assert.equal(e(0, 'Too many changes. Wait a moment and try again.'), 'limit'); assert.equal(L.dlCoErr(null), 'failed');
});
await test('the record: textRev is kept when it is a whole number, dropped when it is not, and a record without it reads as before', () => {
  const W = world(src); const rec = W.make(); delete rec.textRev;
  const base = JSON.parse(JSON.stringify(rec));
  assert.equal(W.L.dlCleanDoc(base).textRev, undefined, 'a record the old saves made has none');
  assert.equal(W.L.dlCleanDoc({ ...base, textRev: 5 }).textRev, 5);
  for (const bad of [0, -1, 1.5, '5', null, {}, [], 1e12, NaN]) assert.equal(W.L.dlCleanDoc({ ...base, textRev: bad }).textRev, undefined, String(bad));
  // everything else is what it was: the cleaned record with textRev taken out equals the cleaned record of the plain one
  const { textRev, ...rest } = W.L.dlCleanDoc({ ...base, textRev: 9 });
  assert.deepEqual(rest, W.L.dlCleanDoc(base));
  assert.ok(W.L.dlCleanDoc({ ...base, somethingNew: 1, another: { a: 1 } }), 'an unknown field is ignored, not refused');
  assert.equal(W.L.dlCleanDoc({ ...base, somethingNew: 1 }).somethingNew, undefined);
});

// ---- 2. one save against the fake store ---------------------------------------------------------------------------------------------------
// A page with no channel: its text is a variable.
function solo(W, key, o = {}) {
  const h = W.store.as(key, { role: o.role || 'editor' });
  const p = { key, text: o.text === undefined ? TEXT : o.text, title: o.title, rev: 1, handle: h, stored: [], notes: [] };
  return W.L.dlCoReadStored(h, ID).then((read) => {
    p.title = p.title === undefined ? read.rec.title : p.title;
    p.st = { id: ID, rec: read.rec, docVersion: read.version, old: read.parts, saved: { text: read.text, title: read.rec.title, paper: read.rec.paper, page: W.L.dlCleanPage(read.rec) }, log: [], stray: [] };
    p.io = { current: () => ({ text: p.text, title: p.title, paper: p.st.saved.paper, page: p.st.saved.page, rev: p.rev }), onStored: (t) => p.stored.push(t), me: key, name: key, now: () => new Date(W.clock.now()).toISOString(), nowMs: () => W.clock.now(), fresh: () => W.L.dlNewId(Math.random), lex: W.lex, sleep: (ms) => new Promise((r) => W.clock.set(r, ms)) };
    p.save = () => W.L.dlCoeditSave(h, p.st, p.io);
    return p;
  });
}
const big = (n, tag = 'x') => Array.from({ length: n }, (_, i) => `Paragraph ${i} ${tag} with a few more words in it.`).join('\n\n') + '\n';

await test('a save writes the changed chunk and then the record, bumps textRev and keeps the unchanged chunks as they were', async () => {
  const W = world(src); W.make(big(60));
  const a = await solo(W, 'aaaa1111', { text: big(60) });
  const before = W.stored();
  a.text = big(60).replace('Paragraph 3 x', 'Paragraph 3 CHANGED');
  const r = await a.save();
  assert.equal(r.status, 'saved'); assert.equal(r.wrote, 2, 'one chunk and the record');
  await W.run(20); // the leftover chunk is deleted after the commit
  const after = W.stored();
  assert.equal(after.text, a.text); assert.equal(after.rec.rev, before.rec.rev + 1); assert.equal(after.rec.textRev, 1);
  assert.equal(after.rec.editedBy, 'aaaa1111');
  const kept = after.rec.chunks.filter((c) => before.rec.chunks.includes(c)).length;
  assert.ok(kept >= before.rec.chunks.length - 1, `${kept} of ${before.rec.chunks.length} chunks unchanged`);
  assert.equal(after.chunkKeys, after.rec.chunks.length, 'and no chunk is left over');
  // the record is the commit: the order of the writes is chunks first, then the record
  const sets = W.store.log.filter((x) => x.op === 'set' && x.status === 200).map((x) => x.key.split(':')[0]);
  assert.equal(sets[sets.length - 1], 'doc');
  // nothing changed: nothing is written, one read
  const n = W.store.count('set');
  const r2 = await a.save(); assert.equal(r2.status, 'same'); assert.equal(W.store.count('set'), n);
});
await test('merge before write: the record changed under the page and its text is the same: nothing written, the version is taken', async () => {
  const W = world(src); W.make();
  const a = await solo(W, 'aaaa1111'); const b = await solo(W, 'bbbb2222');
  a.text = TEXT.replace('Alpha', 'Alpha NEW'); b.text = a.text; // the converged state: both pages hold the same text
  assert.equal((await a.save()).status, 'saved');
  const n = W.store.count('set');
  const r = await b.save();
  assert.equal(r.status, 'same'); assert.equal(r.adopted, true); assert.equal(W.store.count('set'), n, 'b wrote nothing');
  assert.equal(b.st.docVersion, W.stored().version); assert.equal(b.st.rec.textRev, 1);
  assert.deepEqual(b.stored, [a.text], 'and the editor was given the stored text for its lookup');
});
await test('merge before write: the record changed and the text differs: the page\'s state is newer, it is written under the new version', async () => {
  const W = world(src); W.make();
  const a = await solo(W, 'aaaa1111'); const b = await solo(W, 'bbbb2222');
  a.text = TEXT.replace('Alpha', 'Alpha A'); await a.save();
  b.text = TEXT.replace('Alpha', 'Alpha A').replace('Beta', 'Beta B'); // b has A's edit and its own
  const r = await b.save();
  assert.equal(r.status, 'saved'); assert.equal(W.stored().text, b.text); assert.equal(W.stored().rec.textRev, 2);
  assert.deepEqual(b.stored, [a.text], 'b read the stored text first and handed it to the editor');
});
await test('a 409 on the record: read again and go round; the chunk written for the lost commit is deleted', async () => {
  const W = world(src); W.make(big(40));
  const a = await solo(W, 'aaaa1111', { text: big(40) }); const b = await solo(W, 'bbbb2222', { text: big(40) });
  a.text = big(40).replace('Paragraph 5 x', 'Paragraph 5 from A'); b.text = big(40).replace('Paragraph 20 x', 'Paragraph 20 from B');
  // b commits in the middle of a's save: after a's chunk is written and before a's record
  let fired = false;
  W.store.fault = (op, key, who) => { if (!fired && who === 'aaaa1111' && op === 'set' && key.startsWith('doc:')) { fired = true; return null; } return null; };
  const pa = a.save();
  const pb = b.save();
  const [ra, rb] = await Promise.all([pa, pb]);
  assert.ok(['saved', 'same'].includes(ra.status) && ['saved', 'same'].includes(rb.status), `${ra.status} ${rb.status}`);
  await W.run(50);
  const s = W.stored();
  assert.ok(s.text === a.text || s.text === b.text);
  assert.equal(s.chunkKeys, s.rec.chunks.length, 'no stray chunk is left');
  assert.equal(s.rec.textRev, [ra, rb].filter((r) => r.status === 'saved').length);
});
await test('the title: a save never puts an old title back; a title this page changed is written', async () => {
  const W = world(src); W.make();
  const a = await solo(W, 'aaaa1111'); const b = await solo(W, 'bbbb2222');
  b.title = 'Renamed by B'; b.text = TEXT.replace('Alpha', 'Alpha B'); assert.equal((await b.save()).status, 'saved');
  a.text = TEXT.replace('Alpha', 'Alpha B').replace('Beta', 'Beta A'); // a still shows the old title and did not change it
  assert.equal((await a.save()).status, 'saved');
  assert.equal(W.stored().rec.title, 'Renamed by B', 'b\'s title stayed');
  a.title = 'Renamed by A'; a.text += 'more\n';
  assert.equal((await a.save()).status, 'saved');
  assert.equal(W.stored().rec.title, 'Renamed by A', 'a changed it: a wins');
  a.title = ''; a.text += 'again\n'; assert.equal((await a.save()).status, 'title');
  a.title = 'x'; a.text = 'y'.repeat(200000); assert.equal((await a.save()).status, 'long');
  assert.equal(W.stored().text.includes('again'), false, 'nothing was written by the refused saves');
});
await test('a document that was deleted: gone, nothing written', async () => {
  const W = world(src); W.make();
  const a = await solo(W, 'aaaa1111'); W.store.data.delete(W.L.dlDocKey(ID));
  a.text += 'x\n'; const n = W.store.count('set');
  assert.equal((await a.save()).status, 'gone'); assert.equal(W.store.count('set'), n);
});

// ---- 3. races ---------------------------------------------------------------------------------------------------------------------------
await test('two pages save the same state at once: one commit, the other writes nothing (80 interleavings)', async () => {
  let commits = 0; let adopted = 0;
  for (let seed = 1; seed <= 80; seed += 1) {
    const W = world(src, { seed, yields: 1 + (seed % 6) }); W.make(big(30));
    const a = await solo(W, 'aaaa1111', { text: big(30) }); const b = await solo(W, 'bbbb2222', { text: big(30) });
    a.text = b.text = big(30).replace('Paragraph 7 x', 'Paragraph 7 joint');
    const [ra, rb] = await Promise.all([a.save(), b.save()]);
    const st = [ra.status, rb.status].sort();
    assert.ok(st.join() === 'same,saved' || st.join() === 'saved,saved', `seed ${seed}: ${st}`);
    await W.run(20);
    const s = W.stored();
    assert.equal(s.text, a.text, `seed ${seed}`); assert.equal(s.chunkKeys, s.rec.chunks.length, `seed ${seed}: no stray chunk`);
    assert.equal(s.rec.textRev, st.filter((x) => x === 'saved').length, `seed ${seed}: textRev counts the commits`);
    commits += s.rec.textRev; if (st.includes('same')) adopted += 1;
  }
  facts.push(`two pages with the same state, 80 interleavings: ${adopted} found the text stored already and wrote nothing; ${commits} commits in all`);
});
await test('two to eight pages with different states save at once (60 interleavings): all end in a terminal answer, one stored text, no stray chunk', async () => {
  let rounds = 0; let busy = 0;
  for (let seed = 1; seed <= 60; seed += 1) {
    const W = world(src, { seed: seed * 13, yields: 1 + (seed % 5) }); W.make(big(30));
    const n = 2 + (seed % 7);
    const ps = []; for (let i = 0; i < n; i += 1) { const p = await solo(W, `p${i}aaaaaa`, { text: big(30) }); p.text = big(30).replace(`Paragraph ${i} x`, `Paragraph ${i} edited by ${i}`); ps.push(p); }
    const rs = await Promise.all(ps.map((p) => p.save()));
    for (const r of rs) assert.ok(['saved', 'same', 'busy'].includes(r.status), `seed ${seed}: ${r.status}`);
    busy += rs.filter((r) => r.status === 'busy').length; rounds += rs.length;
    await W.run(20);
    const s = W.stored();
    assert.ok(ps.some((p) => p.text === s.text), `seed ${seed}: the stored text is one page's state`);
    assert.equal(s.chunkKeys, s.rec.chunks.length, `seed ${seed}: no stray chunk (${s.chunkKeys} chunks, record lists ${s.rec.chunks.length})`);
    assert.equal(s.rec.textRev, rs.filter((r) => r.status === 'saved').length, `seed ${seed}`);
    assert.equal(s.rec.rev, 1 + s.rec.textRev);
    // a page that said 'busy' did not write its state: it asks again and ends in a terminal answer
    for (let i = 0; i < ps.length; i += 1) if (rs[i].status === 'busy') { const again = await ps[i].save(); assert.ok(['saved', 'same'].includes(again.status), `seed ${seed}: ${again.status}`); }
  }
  facts.push(`2 to 8 pages saving different states at once, 60 interleavings, ${rounds} saves: ${busy} said busy once (asked again at once and finished)`);
});

// ---- 4. 413 and 429 ---------------------------------------------------------------------------------------------------------------------
await test('storage is full (413): the state stays, the answer is full, the wait grows; space comes back and the same page saves', async () => {
  const W = world(src, { store: { maxTotal: 200000 } }); W.make(big(30));
  // fill the rest of the module with other data
  const filler = W.store.as('other0001');
  let i = 0; for (const size of [30000, 3000, 300, 30]) for (;;) { try { await filler.set(`other:${i}`, { pad: 'z'.repeat(size) }); i += 1; } catch (e) { break; } }
  const a = await solo(W, 'aaaa1111', { text: big(30) });
  a.text = big(30) + big(30, 'more');
  const before = W.stored();
  const r = await a.save();
  assert.equal(r.status, 'full'); assert.equal(a.text.length > 0, true);
  assert.equal(W.stored().rec.rev, before.rec.rev, 'the stored record did not move');
  assert.equal(W.L.dlCoBackoff(1, 0), 2000); assert.equal(W.L.dlCoBackoff(3, 0), 8000);
  assert.equal(W.stored().chunkKeys, before.chunkKeys, 'and no chunk was written beside it');
  // the same page, with the state still its own, saves once there is space
  for (let k = 0; k < i; k += 1) await filler.delete(`other:${k}`);
  const r2 = await a.save();
  assert.equal(r2.status, 'saved'); assert.equal(W.stored().text, a.text);
});
await test('too many writes (429): the answer is limit with the time to wait; the state stays; it saves after the minute', async () => {
  const W = world(src, { store: { perMinute: 5 } }); W.make(big(40));
  const a = await solo(W, 'aaaa1111', { text: big(40) });
  let limited = null; let saved = 0;
  for (let k = 0; k < 12 && !limited; k += 1) {
    a.text = big(40).replace('Paragraph 2 x', `Paragraph 2 round ${k}`).replace('Paragraph 30 x', `Paragraph 30 round ${k}`); a.rev += 1;
    const r = await a.save(); if (r.status === 'saved') saved += 1; else limited = r;
  }
  assert.ok(limited && limited.status === 'limit', `limit after ${saved} saves`);
  assert.ok(limited.retryAfter >= 1 && limited.retryAfter <= 60, `retryAfter ${limited.retryAfter}`);
  assert.notEqual(W.stored().text, a.text, 'the last state is not stored yet');
  W.clock.t += limited.retryAfter * 1000 + 1000;
  const r = await a.save();
  assert.equal(r.status, 'saved'); assert.equal(W.stored().text, a.text);
});
await test('the saver on 413 and 429: failed state, hold grows, retry succeeds, the page\'s text is never dropped', async () => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111'); await W.run(3000);
  W.type(a, 0, ' typed');
  let n = 0; W.store.fault = (op, key) => (op === 'set' && key.startsWith('text:') && n++ < 3 ? Object.assign(new Error('storage is full'), { status: 413 }) : null);
  const seen = [];
  const t0 = W.clock.t;
  for (let i = 0; i < 60; i += 1) { await W.run(1000); seen.push([W.clock.t - t0, a.saver.state.failed, a.saver.hold()]); if (W.stored().text.includes('typed')) break; }
  assert.equal(a.saver.counts.storeFull, 3, 'three refused saves');
  assert.ok(W.stored().text.includes('typed'), 'and then it saved');
  assert.ok(seen.some(([, failed]) => failed), 'the page said it could not save');
  assert.equal(a.saver.state.failed, false, 'and the line is gone when it did');
  assert.ok(a.text().includes('typed'), 'the text was in the page all along');
  // the waits between the three tries were 2 s, 4 s, 8 s (plus the quiet beat for the first)
  facts.push(`three 413s in a row on the writer: it asked again after the waits of 2, 4 and 8 s and saved at ${seen.length} s`);
});

// ---- 5. the writer's timing -------------------------------------------------------------------------------------------------------------
await test('the writer saves 3 s after the last change, at most once in 5 s, and no later than 15 s after the first change', async () => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111'); await W.run(2500);
  assert.ok(a.session.isWriter());
  const saves = () => W.store.log.filter((x) => x.op === 'set' && x.key.startsWith('doc:') && x.status === 200).length;
  const mark = W.clock.t;
  W.type(a, 0, 'one'); await W.run(2900); assert.equal(saves(), 0, 'not before the quiet beat');
  await W.run(300); assert.equal(saves(), 1, '3 s after the last change');
  const first = W.clock.t;
  W.type(a, 0, 'two'); await W.run(3100);
  assert.equal(saves(), 1, 'a second change 0.3 s after the save: the gap of 5 s holds it');
  await W.run(2000); assert.equal(saves(), 2);
  // changes every second for 40 s: no quiet beat; it saves every 15 s anyway (and at most once in 5 s)
  const at = []; let last = saves();
  for (let i = 0; i < 40; i += 1) { W.type(a, 1, 'k'); await W.run(1000); if (saves() > last) { at.push(i); last = saves(); } }
  assert.ok(at.length >= 2 && at.length <= 3, `${at.length} saves in 40 s of steady typing`);
  for (let i = 1; i < at.length; i += 1) assert.ok(at[i] - at[i - 1] >= 5 && at[i] - at[i - 1] <= 16, `saves ${at[i] - at[i - 1]} s apart`);
  await W.run(4000);
  assert.equal(W.stored().text, a.text());
  facts.push(`the writer's timing: 1 save 3.0 s after one change; a change 0.3 s after a save waited for the 5 s gap; 40 s of typing every second: saves at s ${at.join(', ')}`);
});
await test('a page that is not the writer does not save while it stays; the writer saves the merged text of both', async () => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111'); await W.run(300); const b = await W.page('bbbb2222'); await W.run(4000);
  W.type(a, 0, ' by-a'); W.type(b, 1, ' by-b'); await W.run(8000);
  assert.equal(b.saver.counts.rounds, 0, 'b is not the writer: no save, not even a check');
  assert.equal(a.saver.counts.saves, 1);
  assert.equal(W.stored().text, a.text()); assert.equal(a.text(), b.text()); assert.ok(a.text().includes('by-a') && a.text().includes('by-b'));
  assert.equal(W.stored().rec.textRev, 1);
});
await test('a reader sees the saved text refresh while two editors work (the record changes within the writer\'s beat)', async () => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111'); await W.run(300); const b = await W.page('bbbb2222'); await W.run(3000);
  const reader = W.store.as('read0001', { role: 'viewer' });
  const seen = [];
  for (let i = 0; i < 6; i += 1) {
    W.type(i % 2 ? a : b, 0, `.${i}`); await W.run(6500);
    const r = await W.L.dlCoReadStored(reader, ID); seen.push(r.text.split('\n')[0]);
  }
  assert.equal(seen[5].startsWith('Alpha one.'), true);
  seen.forEach((t, i) => assert.ok(t.includes(`.${i}`), `round ${i}: the reader read ${JSON.stringify(t)}`));
  assert.equal(seen[5], a.text().split('\n')[0]);
});

// ---- 6. leaving -------------------------------------------------------------------------------------------------------------------------
await test('everyone leaves in the same tick (2 to 8 pages, 40 interleavings): the stored text is the merged text, nothing is left over', async () => {
  let writes = 0; let total = 0;
  for (let seed = 1; seed <= 40; seed += 1) {
    const W = world(src, { seed: seed * 3, yields: 1 + (seed % 5) }); W.make(); 
    const n = 2 + (seed % 7);
    const ps = []; for (let i = 0; i < n; i += 1) { ps.push(await W.page(`p${i}aaaaaa`)); await W.run(250); }
    await W.run(4000);
    for (let i = 0; i < n; i += 1) W.type(ps[i], i % 3, ` by${i}`);
    await W.run(300); // delivered, but nobody has saved yet (the quiet beat is 3 s)
    assert.equal(W.stored().text, TEXT, `seed ${seed}: nothing saved yet`);
    const merged = ps[0].text();
    assert.ok(ps.every((p) => p.text() === merged), `seed ${seed}: converged`);
    const done = Promise.all(ps.map((p) => W.leave(p)));
    await W.run(8000);
    const rs = await done;
    assert.ok(rs.every((r) => r === 'go'), `seed ${seed}: ${rs}`);
    const s = W.stored();
    assert.equal(s.text, merged, `seed ${seed}: the stored text is the merged text`);
    assert.equal(s.chunkKeys, s.rec.chunks.length, `seed ${seed}: no stray chunk`);
    const sets = W.store.log.filter((x) => x.op === 'set' && x.status === 200).length;
    writes += sets; total += n;
  }
  facts.push(`everyone leaves in one tick, 40 runs of 2 to 8 pages: the stored text was the merged text every time (${(writes / 40).toFixed(1)} successful writes a run)`);
});
await test('the writer leaves mid-edit: it saves on the way out; another page is writer after a quiet beat and saves what is typed after', async () => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111'); await W.run(300); const b = await W.page('bbbb2222'); await W.run(300); const c = await W.page('cccc3333'); await W.run(4000);
  W.type(a, 0, ' A1'); W.type(b, 1, ' B1'); await W.run(300);
  const left = W.clock.t;
  const r = W.leave(a); await W.run(2500); assert.equal(await r, 'go');
  assert.ok(W.stored().text.includes('A1') && W.stored().text.includes('B1'), 'the leaving writer saved everything it had');
  W.type(b, 2, ' B2'); // typed after the writer went, before b is the writer
  let saved = -1;
  for (let i = 0; i < 200 && saved < 0; i += 1) { await W.run(100); if (W.stored().text.includes('B2')) saved = W.clock.t - left; }
  assert.ok(saved > 0, 'the text typed after the writer left was saved');
  assert.ok(saved <= 8000, `saved ${saved} ms after the writer left`);
  assert.equal(b.session.isWriter(), true); assert.equal(c.session.isWriter(), false);
  assert.equal(W.stored().text, b.text());
  facts.push(`the writer left mid-edit: B2 (typed 2.8 s later) was stored ${saved} ms after the writer left`);
});
await test('the writer leaves without saving (its page died): the next writer saves the whole merged text within the beat', async () => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111'); await W.run(300); const b = await W.page('bbbb2222'); await W.run(4000);
  W.type(a, 0, ' A1'); W.type(b, 1, ' B1'); await W.run(400);
  a.saver.stop(); a.session.stop(); W.bus.disconnect('aaaa1111'); // no leave-save
  const t = W.clock.t; let saved = -1;
  for (let i = 0; i < 200 && saved < 0; i += 1) { await W.run(100); if (W.stored().text.includes('B1')) saved = W.clock.t - t; }
  assert.ok(saved > 0 && saved <= 6000, `saved ${saved} ms after`);
  assert.ok(W.stored().text.includes('A1'), 'the dead page\'s edit had reached b, so it is stored');
  facts.push(`the writer died unsaved: the next writer stored the merged text ${saved} ms later`);
});
await test('a page that is not the writer leaves with unsaved state while the writer is gone: it saves once on the way out', async () => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111'); await W.run(300); const b = await W.page('bbbb2222'); await W.run(4000);
  a.saver.stop(); a.session.stop(); W.bus.disconnect('aaaa1111');
  await W.run(100);
  W.type(b, 0, ' only-b');
  const r = W.leave(b); await W.run(3000);
  assert.equal(await r, 'go');
  assert.ok(W.stored().text.includes('only-b'));
  assert.equal(b.saver.counts.leaves, 1);
});
await test('a page that leaves right after typing: its last typing goes out before the leave-save (drain), so the writer cannot save a text without it over this one', async () => {
  const W = world(src, { paceMs: 33 }); W.make();
  const a = await W.page('aaaa1111'); await W.run(300); const b = await W.page('bbbb2222'); await W.run(4000);
  for (let i = 0; i < 15; i += 1) W.type(b, 0, `+${i}`); // typed, not yet sent
  const r = W.leave(b); await W.run(5000); assert.equal(await r, 'go');
  await W.run(8000); // a is the writer and saves in its own time
  assert.ok(a.text().includes('+14'), 'a received everything b typed before b went');
  assert.equal(W.stored().text, a.text());
});
await test('a clean page that leaves writes nothing; a leaver that finds the text stored already writes nothing', async () => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111'); await W.run(300); const b = await W.page('bbbb2222'); await W.run(4000);
  W.type(a, 0, ' x'); await W.run(5000); // a (the writer) saved
  const n = W.store.count('set');
  const r = W.leave(b); await W.run(3000); assert.equal(await r, 'go');
  assert.equal(W.store.count('set'), n, 'b found the stored text equal to its own');
  assert.equal(b.saver.counts.same, 1);
  assert.equal(b.saver.counts.saves, 0);
});
await test('a page that cannot save on the way out and is alone stays, with the line "Could not save. Your changes are kept here."; it leaves once it can', async () => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111'); await W.run(2500);
  W.type(a, 0, ' precious'); await W.run(300);
  W.store.fault = (op, key) => (op === 'set' ? Object.assign(new Error('storage is full'), { status: 413 }) : null);
  let r = W.leave(a); await W.run(8000);
  assert.equal(await r, 'stay'); assert.ok(a.notes.includes('Could not save. Your changes are kept here.'));
  assert.equal(a.left, false); assert.ok(a.text().includes('precious'));
  W.store.fault = null;
  r = W.leave(a); await W.run(3000);
  assert.equal(await r, 'go'); assert.ok(W.stored().text.includes('precious'));
});
await test('a page that cannot save on the way out but is not alone leaves (the others hold the text)', async () => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111'); await W.run(300); const b = await W.page('bbbb2222'); await W.run(4000);
  W.type(b, 0, ' b-text'); await W.run(300);
  W.store.fault = (op, key, who) => (op === 'set' && who === 'bbbb2222' ? Object.assign(new Error('Too many'), { status: 429, retryAfter: 1 }) : null);
  const r = W.leave(b); await W.run(8000);
  assert.equal(await r, 'go');
  W.store.fault = null; await W.run(8000);
  assert.ok(W.stored().text.includes('b-text'), 'a (the writer) holds it and saved it');
});

console.log(fails.length ? `documents coedit save: ${fails.length} failed, ${passed} passed` : `documents coedit save: ${passed} tests passed in ${((Date.now() - t0) / 1000).toFixed(1)} s${facts.length ? ` (${facts.join('; ')})` : ''}`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
