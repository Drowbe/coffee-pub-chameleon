#!/usr/bin/env node
/*
 * check-documents-coedit-snapshot.mjs -- the copy of a shared document's state in storage (documents-lib-w-coedit-snapshot.js, and the join in
 * documents-lib-u-coedit-sync.js), in Node with no DOM, no network and no timers: the stand-in bus and manual clock, and a fake store with the server's
 * version, 409, 413 and 429 rules (test/support/fake-store.mjs). Plan: plan-documents-coediting.md, step 4b, slice 2. What this does NOT cover: the real
 * server and SDK, the browser, the 'changes' events each write sends (the live run counts the writes per minute).
 *
 *  1. The pure pieces: chunks and hashes, the header and chunk checks against hostile values, the compaction decision, the keys never collide.
 *  2. Writing: the header goes last; only changed chunks are written; pacing; nobody but the writer writes; 413 keeps the old copy and says so; a crash
 *     between the chunks and the header leaves a copy that is REJECTED (never applied half).
 *  3. Loading: a late joiner opens from the copy and does not seed or double; a copy older than the text is a starting point; every bad copy is rejected
 *     with a reason and the page opens from the stored text, ends equal to it, and its writer then writes a good copy.
 *  4. Compaction: alone and too big -> a new epoch and a fresh seed id, the old chunks deleted; not alone -> no.
 *  5. Clean-up with the document; the join time with and without a copy.
 *
 * Usage: node modules/documents/test/check-documents-coedit-snapshot.mjs [path to the src folder]. Exits 1 on any failure.
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
const W0 = world(src); const L = W0.L; const PM = W0.PM;
const big = (n, word = 'lorem ipsum dolor sit amet consectetur') => Array.from({ length: n }, (_, i) => `Paragraph ${i} ${word} ${word}.`).join('\n\n') + '\n';
const keysOf = (W, prefix = `ydoc:${ID}`) => [...W.store.data.keys()].filter((k) => k === prefix || k.startsWith(`${prefix}:`)).sort();
const header = (W) => { const r = W.store.peek(`ydoc:${ID}`); return r && r.value; };
const put = (W, key, value) => W.store.data.set(key, { json: typeof value === 'string' ? value : JSON.stringify(value), version: (W.store.versionCounter += 1) });
const typeAt = (W, p, i, text) => { const t = p.doc().getXmlFragment(W.frag).get(i).get(0); p.doc().transact(() => t.insert(t.length, text), 'local'); };
const sets = (W, who) => W.store.log.filter((x) => x.op === 'set' && x.status === 200 && (!who || x.who === who));

// two pages open the document and a copy is written; both leave. -> the world
async function withCopy(text = TEXT, o = {}) {
  const W = world(src, { paceMs: o.paceMs || 0 }); W.make(text);
  const a = await W.page('aaaa1111', { snap: true }); await W.run(500); const b = await W.page('bbbb2222', { snap: true });
  await W.run(o.wait || 12000);
  assert.ok(header(W), 'a copy was written');
  W.a = a; W.b = b;
  if (!o.stay) { await W.leave(b); await W.leave(a); await W.run(200); }
  return W;
}
// a page opens the document alone and runs until it is ready (and a little longer)
async function openAlone(W, key = 'cccc3333', ms = 6000) { const p = await W.page(key, { snap: true }); await W.run(ms); return p; }
const stats = (p) => p.session.stats();

// ---- 1. the pure pieces -----------------------------------------------------------------------------------------------------------------
await test('chunks and hashes: a state splits at 36,000 bytes, every chunk fits a value, the hash names the text', () => {
  const bytes = new Uint8Array(100000).map((_, i) => (i * 7 + 3) & 255);
  const cs = L.dlSnapSplit(bytes);
  assert.equal(cs.length, 3); assert.deepEqual(cs.map((c) => c.n), [0, 1, 2]);
  for (const c of cs) { assert.ok(JSON.stringify({ n: c.n, d: c.d, h: c.h }).length < 60 * 1024, 'under the 60 KB value'); assert.equal(L.dlSnapHash(c.d), c.h); }
  assert.equal(cs[0].d.length, 48000);
  const back = new Uint8Array(100000); let at = 0;
  for (const c of cs) { const b = L.dlSyncUnb64(c.d, 36000); back.set(b, at); at += b.length; }
  assert.deepEqual(back, bytes);
  assert.notEqual(L.dlSnapHash('abc'), L.dlSnapHash('abd'));
  assert.equal(L.dlSnapSplit(new Uint8Array(10)).length, 1);
});
await test('the keys never collide: a chunk is a number, the marker is seed, the header has no suffix', () => {
  assert.equal(L.dlSnapHeaderKey('d1'), 'ydoc:d1'); assert.equal(L.dlSnapChunkKey('d1', 3), 'ydoc:d1:3'); assert.equal(L.dlSeedMarkerKey('d1'), 'ydoc:d1:seed');
  for (let n = 0; n < L.DL_SNAP.maxChunks; n += 1) assert.notEqual(L.dlSnapChunkKey('d1', n), L.dlSeedMarkerKey('d1'));
  assert.ok(/^[A-Za-z0-9_.:/-]{1,128}$/.test(L.dlSnapChunkKey('x'.repeat(50), 39)));
});
const goodHeader = () => ({ v: 1, rev: 3, n: 2, bytes: 40000, hashes: ['abc123', 'def456'], seed: 77, epoch: 0, at: '2026-11-13T10:00:00.000Z' });
await test('the header check: good passes; every hostile shape is refused before anything is looped over', () => {
  const ok = L.dlSnapCleanHeader(goodHeader()); assert.ok(!ok.bad); assert.equal(ok.n, 2);
  const bad = (mut, why) => { const h = goodHeader(); mut(h); const r = L.dlSnapCleanHeader(h); assert.ok(r.bad, `${why} refused`); };
  bad((h) => { h.n = 1e9; }, 'n 1e9'); bad((h) => { h.n = 41; h.hashes = new Array(41).fill('abc123'); }, 'n 41'); bad((h) => { h.n = 0; }, 'n 0');
  bad((h) => { h.hashes = new Array(1e6).fill('abc123'); }, 'a huge hashes array'); bad((h) => { h.hashes = ['abc123']; }, 'hashes shorter than n'); bad((h) => { h.hashes = ['abc123', 5]; }, 'a non-string hash');
  bad((h) => { h.hashes = ['abc123', 'X'.repeat(30)]; }, 'a long hash'); bad((h) => { h.bytes = 5e6; }, 'bytes over 1.5 MB'); bad((h) => { h.bytes = 100000; }, 'bytes more than n chunks hold');
  bad((h) => { h.bytes = -1; }, 'negative'); bad((h) => { h.rev = 1.5; }, 'a fraction'); bad((h) => { h.seed = 0; }, 'seed 0'); bad((h) => { h.epoch = -1; }, 'epoch -1'); bad((h) => { h.at = 'x'.repeat(100); }, 'time'); bad((h) => { h.extra = 1; }, 'extra key');
  bad((h) => { delete h.at; }, 'missing key'); bad((h) => { h.v = 2; }, 'version');
  const p = JSON.parse('{"v":1,"rev":3,"n":2,"bytes":40000,"hashes":["abc123","def456"],"seed":77,"epoch":0,"at":"2026-11-13T10:00:00.000Z","__proto__":{"x":1}}');
  assert.ok(L.dlSnapCleanHeader(p).bad, '__proto__ key refused');
  for (const v of [null, 5, 'x', [], [1, 2]]) assert.ok(L.dlSnapCleanHeader(v).bad);
});
await test('the chunk check: shape, number, hash and base64', () => {
  const c = L.dlSnapSplit(new Uint8Array([1, 2, 3, 4]))[0];
  assert.ok(L.dlSnapCleanChunk(c, 0, c.h) instanceof Uint8Array);
  for (const v of [{ ...c, n: 1 }, { ...c, h: 'zzzz' }, { ...c, d: `${c.d}AAAA` }, { ...c, extra: 1 }, { n: 0, d: c.d }, null, [], { ...c, d: 5 }, { ...c, d: '!!!!'.repeat(3), h: L.dlSnapHash('!!!!'.repeat(3)) }]) assert.ok(L.dlSnapCleanChunk(v, 0, c.h).bad, JSON.stringify(v).slice(0, 40));
  assert.ok(L.dlSnapCleanChunk({ ...c, d: 'A'.repeat(60000), h: L.dlSnapHash('A'.repeat(60000)) }, 0, L.dlSnapHash('A'.repeat(60000))).bad, 'too long');
});
await test('the compaction decision (pure)', () => {
  const h = (bytes) => ({ ...goodHeader(), bytes, n: Math.ceil(bytes / 36000) });
  const c = (bytes, textLen, vectorBytes) => L.dlSnapCompaction({ header: h(bytes), textLen, vectorBytes });
  assert.equal(c(5000, 100).compact, false, 'a small state is never compacted, whatever the ratio');
  assert.equal(c(30000, 20000).compact, false, '1.5 x the text');
  assert.equal(c(70000, 20000).compact, true); assert.equal(c(70000, 20000).why, 'history');
  assert.equal(c(30000, 9000).compact, true, 'over 3 x the text and over 8,000');
  assert.equal(c(500000, 400000).compact, true); assert.equal(c(500000, 400000).why, 'bytes');
  assert.equal(c(30000, 20000, 1001).compact, true); assert.equal(c(30000, 20000, 1001).why, 'writers');
  assert.equal(c(30000, 20000, 1000).compact, false);
  assert.equal(c(30000, 0).compact, true, 'an empty text with a big state');
});

// ---- 2. writing ---------------------------------------------------------------------------------------------------------------------------
await test('the writer writes a copy: chunks, then the header last; the keys, sizes and fields are as documented; nobody else writes it', async () => {
  const W = world(src); W.make(big(300));
  const a = await W.page('aaaa1111', { snap: true }); await W.run(400); const b = await W.page('bbbb2222', { snap: true }); await W.run(12000);
  const h = header(W);
  assert.deepEqual(Object.keys(h).sort(), ['at', 'bytes', 'epoch', 'hashes', 'n', 'rev', 'seed', 'v']);
  assert.equal(h.v, 1); assert.equal(h.n, h.hashes.length); assert.ok(h.n >= 2, `a document of 300 paragraphs has ${h.n} chunks`);
  const mk = W.store.peek(`ydoc:${ID}:seed`).value;
  assert.equal(h.seed, mk.id); assert.equal(h.epoch, 0);
  for (let n = 0; n < h.n; n += 1) { const e = W.store.data.get(`ydoc:${ID}:${n}`); assert.ok(e.json.length < 60 * 1024, `chunk ${n}: ${e.json.length} B`); const v = JSON.parse(e.json); assert.equal(v.n, n); assert.equal(v.h, h.hashes[n]); }
  assert.deepEqual(keysOf(W), ['ydoc:doc12345', ...Array.from({ length: h.n }, (_, i) => `ydoc:${ID}:${i}`), `ydoc:${ID}:seed`].sort());
  // the header is the LAST write of the cycle
  const ys = sets(W).filter((x) => x.key.startsWith('ydoc:') && !x.key.endsWith(':seed'));
  assert.equal(ys[ys.length - 1].key, `ydoc:${ID}`, 'header last');
  assert.ok(ys.slice(0, -1).every((x) => /:\d+$/.test(x.key)));
  for (const x of sets(W)) if (x.key.startsWith('ydoc:') && !x.key.endsWith(':seed')) assert.equal(x.who, 'aaaa1111', 'only the writer writes the copy');
  assert.equal(b.snapSaver.counts.written, 0, 'a page that is not the writer wrote nothing');
  assert.equal(h.rev, W.stored().rec.textRev || 0);
  facts.push(`300 paragraphs (${big(300).length} characters): ${h.bytes} bytes of state in ${h.n} chunks, ${Math.max(...[...Array(h.n).keys()].map((n) => W.store.data.get(`ydoc:${ID}:${n}`).json.length))} B the biggest value`);
});
await test('only changed chunks are written; pacing: one copy per 45 s, a quiet beat first, and a large change shortens the wait', async () => {
  const W = world(src); W.make(big(300));
  const a = await W.page('aaaa1111', { snap: true }); await W.run(400); const b = await W.page('bbbb2222', { snap: true }); await W.run(12000);
  const first = a.snapSaver.counts.written; const h1 = header(W);
  assert.equal(first, 1);
  const chunksBefore = a.snapSaver.counts.chunks;
  typeAt(W, b, 299, ' end'); await W.run(9000); // saved by the writer; 10 s after the first copy: inside the 45 s gap
  assert.equal(a.snapSaver.counts.written, 1, 'no second copy inside 45 s');
  await W.run(40000);
  assert.equal(a.snapSaver.counts.written, 2, 'one more after the gap');
  const wrote = a.snapSaver.counts.chunks - chunksBefore;
  assert.ok(wrote <= header(W).n, `${wrote} chunks written of ${header(W).n}`);
  assert.equal(a.snapSaver.counts.lastWrote, wrote);
  assert.ok(header(W).rev > h1.rev, 'the second copy names the newer textRev');
  facts.push(`one word typed at the end of a 300-paragraph document: ${wrote} of ${header(W).n} chunks written`);
  // no change: no copy
  const n1 = a.snapSaver.counts.written; await W.run(120000); assert.equal(a.snapSaver.counts.written, n1, 'nothing changed: nothing written');
  // never inside a burst: typing every second for 30 s writes no copy until it stops
  const w0 = a.snapSaver.counts.written;
  for (let i = 0; i < 30; i += 1) { typeAt(W, b, 0, 'x'); await W.run(1000); }
  assert.equal(a.snapSaver.counts.written, w0, 'no copy inside a burst');
  await W.run(60000); assert.ok(a.snapSaver.counts.written > w0, 'a copy after the burst');
});
await test('a large change (a big paste) gets a copy within about 10 s', async () => {
  const W = world(src); W.make(big(100));
  const a = await W.page('aaaa1111', { snap: true }); await W.run(400); const b = await W.page('bbbb2222', { snap: true }); await W.run(12000);
  const w0 = a.snapSaver.counts.written; const t0 = W.clock.now();
  const frag = a.doc().getXmlFragment(W.frag);
  a.doc().transact(() => { const p = new PM.XmlElement('paragraph'); const t = new PM.XmlText(); t.insert(0, 'pasted words '.repeat(300).trim()); p.insert(0, [t]); frag.insert(1, [p]); }, 'local');
  let at = -1;
  for (let i = 0; i < 60 && at < 0; i += 1) { await W.run(1000); if (a.snapSaver.counts.written > w0) at = W.clock.now() - t0; }
  assert.ok(at > 0 && at <= 20000, `copy after ${at} ms`);
  facts.push(`a 3,900-character paste: the copy followed ${at} ms later`);
});
await test('413 keeps the old copy, says so once in plain words, the text still saves; 429 waits; a failed header write keeps the old header', async () => {
  const W = world(src); W.make(big(300));
  const a = await W.page('aaaa1111', { snap: true }); await W.run(400); const b = await W.page('bbbb2222', { snap: true }); await W.run(12000);
  const h1 = JSON.stringify(header(W)); const rev0 = W.stored().rec.textRev || 0;
  W.store.fault = (op, key) => (op === 'set' && /^ydoc:doc12345(:\d+)?$/.test(key) ? Object.assign(new Error('storage is full'), { status: 413 }) : null);
  typeAt(W, b, 299, ' more'); await W.run(60000);
  assert.equal(JSON.stringify(header(W)), h1, 'the old header is untouched');
  assert.ok(a.snapSaver.counts.full >= 1);
  assert.deepEqual(a.notes.filter((n) => /saved copy/.test(n)), ['The saved copy for faster opening is full. Your text is safe.']);
  assert.ok(!a.notes.concat(b.notes).some((n) => /\b(level|epoch|snapshot|chunk)\b/i.test(n)), 'no banned words');
  assert.ok((W.stored().rec.textRev || 0) > rev0, 'the text itself was saved meanwhile');
  assert.ok(W.stored().text.includes(' more'));
  W.store.fault = null; await W.run(310000);
  assert.ok(header(W).rev > JSON.parse(h1).rev, 'space is back: a copy is written');
  // 429
  const w = a.snapSaver.counts.limited; W.store.fault = (op, key) => (op === 'set' && key === `ydoc:${ID}` ? Object.assign(new Error('Too many changes. Wait a moment and try again.'), { status: 429, retryAfter: 5 }) : null);
  typeAt(W, b, 299, ' again'); await W.run(80000); assert.ok(a.snapSaver.counts.limited > w, 'a 429 is counted'); W.store.fault = null;
});
await test('a crash between the chunks and the header: the old header stays, the copy no longer matches, a reader REJECTS it and opens from the text', async () => {
  const W = await withCopy(big(300), { stay: true });
  const hOld = JSON.stringify(header(W));
  let crash = true;
  W.store.fault = (op, key) => (crash && op === 'set' && key === `ydoc:${ID}` ? Object.assign(new Error('gone'), { status: 500 }) : null);
  typeAt(W, W.b, 5, ' typed while the header cannot be written'); await W.run(70000);
  crash = false; W.store.fault = null;
  assert.equal(JSON.stringify(header(W)), hOld, 'the header was not touched');
  await W.leave(W.b); await W.leave(W.a); await W.run(200);
  const c = await openAlone(W, 'cccc3333', 8000);
  const st = stats(c);
  assert.equal(st.snapshotLoaded, 0); assert.equal(st.snapshotRejected, 1); assert.match(st.snapshotReason, /chunk_hash|size/);
  assert.equal(c.text(), W.stored().text, 'opened from the stored text and equal to it');
  assert.equal(st.rebuiltFromText, 1);
});

// ---- 3. loading -----------------------------------------------------------------------------------------------------------------------
await test('a page alone opens from the copy: no seed, no marker call, the text equal to the stored text', async () => {
  const W = await withCopy(big(300));
  const c = await openAlone(W);
  const st = stats(c);
  assert.equal(st.snapshotLoaded, 1); assert.equal(st.snapshotRejected, 0); assert.equal(st.markerCalls, 0, 'it did not seed'); assert.equal(st.compacted, 0);
  assert.equal(c.text(), W.stored().text); assert.equal(c.how, 'state');
  assert.equal(c.ydoc === c.doc(), false, 'the page holds the document made from the copy');
  assert.equal(c.doc().getXmlFragment(W.frag).length, 300);
});
await test('a late joiner next to a writer loads the copy and the small difference: not doubled, equal to the others', async () => {
  const W = await withCopy(big(300), { stay: true });
  typeAt(W, W.b, 10, ' newer than the copy'); await W.run(9000); // saved (textRev up), the next copy is 45 s away
  const rev = W.stored().rec.textRev;
  assert.ok(rev > header(W).rev, 'the copy is older than the text');
  const c = await W.page('cccc3333', { snap: true }); await W.run(8000);
  const st = stats(c);
  assert.equal(st.snapshotLoaded, 1); assert.equal(st.markerCalls, 0);
  assert.equal(c.doc().getXmlFragment(W.frag).length, 300, 'not doubled');
  assert.equal(c.text(), W.a.text()); assert.equal(c.text(), W.b.text()); assert.ok(c.text().includes('newer than the copy'));
  typeAt(W, c, 20, ' from the late joiner'); await W.run(4000);
  assert.equal(W.a.text(), c.text()); assert.equal(W.b.text(), c.text());
  assert.equal(c.snapSaver.counts.written, 0);
});

const corruptions = [
  ['a changed chunk (the hash no longer matches)', (W, h) => { const k = `ydoc:${ID}:0`; const v = JSON.parse(W.store.data.get(k).json); v.d = `${v.d.slice(0, 20)}${v.d[20] === 'A' ? 'B' : 'A'}${v.d.slice(21)}`; put(W, k, v); }, /chunk_hash/],
  ['a chunk with a wrong hash field', (W) => { const k = `ydoc:${ID}:1`; const v = JSON.parse(W.store.data.get(k).json); v.h = 'abcd1234'; put(W, k, v); }, /chunk_hash/],
  ['a missing chunk', (W) => { W.store.data.delete(`ydoc:${ID}:1`); }, /chunk_missing/],
  ['a chunk that is not an object', (W) => { put(W, `ydoc:${ID}:0`, '"hello"'); }, /chunk_shape/],
  ['a header that says n 1e9', (W, h) => { put(W, `ydoc:${ID}`, { ...h, n: 1e9 }); }, /header_numbers/],
  ['a header with a huge hashes array', (W, h) => { put(W, `ydoc:${ID}`, { ...h, hashes: new Array(50000).fill('abcd12') }); }, /header_hashes/],
  ['a hostile header with __proto__', (W, h) => { put(W, `ydoc:${ID}`, `${JSON.stringify(h).slice(0, -1)},"__proto__":{"polluted":1}}`); }, /header_shape/],
  ['a header that is not an object', (W) => { put(W, `ydoc:${ID}`, '[1,2,3]'); }, /header_shape/],
  ['a header ahead of the text', (W, h) => { put(W, `ydoc:${ID}`, { ...h, rev: h.rev + 5 }); }, /rev_ahead/],
  ['a header of another lineage (seed)', (W, h) => { put(W, `ydoc:${ID}`, { ...h, seed: h.seed + 1 }); }, /lineage/],
  ['a header of another lineage (epoch)', (W, h) => { put(W, `ydoc:${ID}`, { ...h, epoch: 3 }); }, /lineage/],
  ['a missing marker', (W) => { W.store.data.delete(`ydoc:${ID}:seed`); }, /no_marker/],
  ['sizes that do not add up', (W, h) => { put(W, `ydoc:${ID}`, { ...h, bytes: h.bytes - 1 }); }, /size/],
  ['hashed garbage (the gate refuses it)', (W, h) => {
    const bytes = new Uint8Array(h.bytes).map((_, i) => (i * 31 + 7) & 255); const cs = L.dlSnapSplit(bytes);
    cs.forEach((c) => put(W, `ydoc:${ID}:${c.n}`, c)); put(W, `ydoc:${ID}`, { ...h, n: cs.length, hashes: cs.map((c) => c.h) });
  }, /gate_/],
];
for (const [name, mutate, want] of corruptions) {
  await test(`rejected: ${name}; the page opens from the text, ends equal to it, and its writer writes a good copy`, async () => {
    const W = await withCopy(big(300));
    const h = header(W); const text = W.stored().text;
    mutate(W, h);
    const c = await openAlone(W, 'cccc3333', 5000);
    const st = stats(c);
    assert.equal(st.snapshotLoaded, 0, 'never applied'); assert.equal(st.snapshotRejected, 1, `rejected: ${st.snapshotReason}`);
    assert.match(st.snapshotReason, want);
    assert.equal(st.rebuiltFromText, 1); assert.equal(c.text(), text); assert.equal(c.text(), W.stored().text);
    assert.equal(c.doc().getXmlFragment(W.frag).length, 300);
    assert.ok(Object.keys(Object.prototype).length === 0 && !({}).polluted, 'no pollution');
    await W.run(8000);
    const h2 = header(W); assert.ok(h2 && !L.dlSnapCleanHeader(h2).bad, 'the writer wrote a good header');
    assert.equal(h2.epoch, 1, 'a new lineage');
    await W.leave(c); await W.run(200);
    const d = await openAlone(W, 'dddd4444', 5000);
    assert.equal(stats(d).snapshotLoaded, 1, 'and the next page loads it'); assert.equal(stats(d).snapshotRejected, 0); assert.equal(d.text(), text);
  });
}
await test('rejected: a good state of ANOTHER text with correct hashes (the verify refuses it)', async () => {
  const W = await withCopy(big(300));
  const h = header(W); const text = W.stored().text;
  const other = new PM.Doc(); L.dlSyncSeed(PM, other, W.pmDoc(big(300).replace('Paragraph 5 ', 'Paragraph FIVE ')), ID, 'x', h.seed);
  const cs = L.dlSnapSplit(PM.encodeStateAsUpdate(other));
  for (let n = 0; n < Math.max(cs.length, h.n); n += 1) { if (cs[n]) put(W, `ydoc:${ID}:${n}`, cs[n]); else W.store.data.delete(`ydoc:${ID}:${n}`); }
  put(W, `ydoc:${ID}`, { ...h, n: cs.length, bytes: PM.encodeStateAsUpdate(other).length, hashes: cs.map((c) => c.h) });
  const c = await openAlone(W);
  const st = stats(c);
  assert.equal(st.snapshotLoaded, 0); assert.equal(st.snapshotRejected, 1); assert.match(st.snapshotReason, /text_differs|verify_/);
  assert.equal(c.text(), text);
});
await test('a copy older than the saved text, for a page that is alone, is not the document (4b slice 3: it would show the older text and its save would take the newer away): the page opens from the text', async () => {
  const W = await withCopy(big(300), { stay: true });
  typeAt(W, W.b, 7, ' later'); await W.run(9000); await W.leave(W.b); await W.leave(W.a); await W.run(200);
  assert.ok(W.stored().rec.textRev > header(W).rev);
  const c = await openAlone(W, 'cccc3333', 8000);
  assert.equal(stats(c).snapshotLoaded, 0); assert.equal(stats(c).snapshotReason, 'rev_old');
  assert.ok(c.text().includes(' later'), 'the text saved after the copy is in the page');
});

// ---- 4. compaction -----------------------------------------------------------------------------------------------------------------------
await test('alone and too big: a new epoch and a fresh seed id, equal to the stored text, a new copy, the old chunks gone; not alone: no compaction', async () => {
  const W = world(src); W.make(`${big(3)}`);
  const a = await W.page('aaaa1111', { snap: true }); await W.run(2500);
  // a long edit history in a short text: many small inserts and deletes in separate transactions
  const para = () => a.doc().getXmlFragment(W.frag).get(0).get(0);
  for (let i = 0; i < 1500; i += 1) { a.doc().transact(() => para().insert(3, 'ab'), 'local'); a.doc().transact(() => para().delete(3, 1), 'local'); if (i % 100 === 0) await W.run(10); }
  await W.run(30000);
  const h = header(W); const textLen = W.stored().text.length;
  facts.push(`a ${textLen}-character text after 3,000 small edits: ${h.bytes} bytes of state in ${h.n} chunks`);
  assert.ok(h.bytes > 3 * textLen && h.bytes > 8000, `history built up: ${h.bytes} bytes for ${textLen} characters`);
  const seed0 = W.store.peek(`ydoc:${ID}:seed`).value.id;
  const oldKeys = keysOf(W).length;
  // another page opens while a is still here: it is NOT alone, so no compaction
  const b = await W.page('bbbb2222', { snap: true }); await W.run(6000);
  assert.equal(stats(b).compacted, 0); assert.equal(W.store.peek(`ydoc:${ID}:seed`).value.id, seed0, 'the marker is as it was'); assert.equal(b.text(), a.text());
  await W.leave(b); await W.leave(a); await W.run(200);
  const c = await openAlone(W, 'cccc3333', 8000);
  const st = stats(c);
  assert.equal(st.compacted, 1); assert.ok(['history', 'bytes', 'writers'].includes(st.compactWhy)); assert.equal(st.snapshotLoaded, 0); assert.equal(st.rebuiltFromText, 1);
  const mk = W.store.peek(`ydoc:${ID}:seed`).value; assert.equal(mk.epoch, 1); assert.notEqual(mk.id, seed0);
  assert.equal(c.text(), W.stored().text);
  await W.run(10000);
  const h2 = header(W);
  assert.equal(h2.epoch, 1); assert.equal(h2.seed, mk.id); assert.ok(h2.bytes < h.bytes / 2, `smaller: ${h2.bytes} against ${h.bytes}`);
  assert.deepEqual(keysOf(W).filter((k) => /:\d+$/.test(k)).length, h2.n, 'the old chunks beyond the new count are gone');
  facts.push(`compaction by re-seed: ${h.bytes} bytes (${h.n} chunks) became ${h2.bytes} bytes (${h2.n} chunks); ${oldKeys} keys before, ${keysOf(W).length} after`);
  await W.leave(c); await W.run(200);
  const d = await openAlone(W, 'dddd4444', 5000); assert.equal(stats(d).snapshotLoaded, 1); assert.equal(stats(d).compacted, 0); assert.equal(d.text(), W.stored().text);
});
await test('two pages that open alone at the same time on a too-big copy: one re-seed wins, one document, no doubled text', async () => {
  for (let seed = 1; seed <= 12; seed += 1) {
    const W = world(src, { seed }); W.make(big(3));
    const a = await W.page('aaaa1111', { snap: true }); await W.run(2500);
    const para = () => a.doc().getXmlFragment(W.frag).get(0).get(0);
    for (let i = 0; i < 1500; i += 1) { a.doc().transact(() => para().insert(3, 'ab'), 'local'); a.doc().transact(() => para().delete(3, 1), 'local'); }
    await W.run(30000); await W.leave(a); await W.run(200);
    const text = W.stored().text;
    const [c, d] = await Promise.all([W.page('cccc3333', { snap: true }), W.page('dddd4444', { snap: true })]);
    await W.run(10000);
    assert.equal(c.text(), text, `seed ${seed}`); assert.equal(d.text(), text, `seed ${seed}`);
    assert.equal(c.doc().getXmlFragment(W.frag).length, 3); assert.equal(d.doc().getXmlFragment(W.frag).length, 3);
  }
});

// ---- 5. clean-up and the join time ------------------------------------------------------------------------------------------------------
await test('removeForGood takes the header, the chunks and the marker with the document (the page code, run over the fake store)', async () => {
  const W = await withCopy(big(300));
  assert.ok(keysOf(W).length >= 4);
  const code = fs.readFileSync(path.join(src, 'documents.js'), 'utf8');
  const m = code.match(/async function removeForGood\(id, quiet\) \{[\s\S]*?\n  \}/);
  assert.ok(m && m[0].includes('host.storage.list(`ydoc:${id}:`)') && m[0].includes('host.storage.delete(`ydoc:${id}`)'), 'documents.js removes ydoc:<id>:* and ydoc:<id>');
  const store = W.store.as('aaaa1111');
  const id = ID; const host = { storage: { ...store, delete: (k) => store.delete(k).catch((e) => (e.status === 404 ? true : Promise.reject(e))) } }; // the server takes a delete of an absent key; the stand-in says 404
  const run = new Function('host', 'id', 'dlTagsKey', 'dlTrashKey', 'tagsOf', 'trash', 'render', `return (${m[0].replace('async function removeForGood', 'async function')})(id, true);`);
  await run(host, id, (x) => `tags:${x}`, (x) => `trash:${x}`, new Map(), new Map(), () => {});
  assert.deepEqual(keysOf(W), [], 'nothing of the state is left');
});
await test('the join of a late page on a 72,000-character document: with a copy against the pieces', async () => {
  const text = big(900, 'lorem ipsum dolor sit amet');
  const out = {};
  for (const withCopyKey of [true, false]) {
    const W = world(src, { paceMs: 33 }); W.make(text);
    const a = await W.page('aaaa1111', { snap: withCopyKey }); await W.run(400); const b = await W.page('bbbb2222', { snap: withCopyKey });
    await W.run(withCopyKey ? 30000 : 12000);
    if (withCopyKey) assert.ok(header(W), 'a copy exists');
    const c = await W.page('cccc3333', { snap: true }); const t = W.clock.now();
    for (let i = 0; i < 400 && !c.ready; i += 1) await W.run(50);
    out[withCopyKey ? 'with' : 'without'] = c.joinedAt - t;
    await W.run(2000);
    assert.equal(c.text(), a.text()); assert.equal(c.doc().getXmlFragment(W.frag).length, 900, 'not doubled');
    if (withCopyKey) assert.equal(stats(c).snapshotLoaded, 1); else assert.equal(stats(c).snapshotLoaded, 0);
    out[`${withCopyKey ? 'with' : 'without'}Info`] = withCopyKey ? `${header(W).bytes} B in ${header(W).n} chunks` : '';
  }
  assert.ok(out.with < out.without, `with ${out.with} ms, without ${out.without} ms`);
  facts.push(`Ben's join on ${text.length} characters (virtual clock, 30 messages a second): ${out.with} ms from the copy (${out.withInfo}), ${out.without} ms by pieces`);
});

console.log(`documents coedit snapshot: ${passed} tests passed in ${((Date.now() - t0) / 1000).toFixed(1)} s${facts.length ? ` (${facts.join('; ')})` : ''}`);
if (fails.length) { console.error(`${fails.length} FAILED:\n- ${fails.join('\n- ')}`); process.exit(1); }
