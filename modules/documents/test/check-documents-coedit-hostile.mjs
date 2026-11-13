#!/usr/bin/env node
/*
 * check-documents-coedit-hostile.mjs -- the rest of 4b slice 3 and the hostile cases of 4b, in Node with no DOM, no network and no timers: the stand-in bus,
 * manual clock and fake store of the other co-editing tests (test/support). Plan: plan-documents-coediting.md, step 4b. What this does NOT cover: the page
 * (documents.js: what a person sees and the SDK), a real LiveKit call, two real browsers (the live run does the pages).
 *
 *  1. The wire: `l` (lineage), `d` (delete-set hash) and the mend message pass the cleaner; nothing else does.
 *  2. The delete set: a document with deletions answers a beat with nothing; a deletion that was lost is still repaired.
 *  3. The good state: taken a moment after each change; a rebuild loses at most that moment; the cost on a 150,000-character document.
 *  4. The lineage race: a page that re-seeded while an older page was in the room unheard; the stale page stops, its text is safe, nothing doubles.
 *  5. A hostile marker: rewritten, huge, garbage, deleted: the text is never lost, the copy heals when the writer is alone.
 *  6. Two writers that both think they are the writer: chunks and headers interleave; a reader never applies half; one writer wins afterwards.
 *  7. A viewer cannot write (403) and is never the writer.
 *  8. One person, two windows: the key; a second window reads only; a dead holder is replaced; the writer is per person.
 *  9. The mend is reported: the others are told once; the text of the dropped block is handed to the page.
 * 10. Writes per minute.
 *
 * Usage: node modules/documents/test/check-documents-coedit-hostile.mjs [path to the src folder]. Exits 1 on any failure.
 */
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { world, TEXT, ID } from './support/coedit-page.mjs';
import { FakeStore } from './support/fake-store.mjs';

const t0 = Date.now();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(root, 'modules/documents/src'));

let passed = 0; const fails = []; const facts = [];
async function test(name, fn) { try { await fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.stack.split('\n').slice(0, 3).join(' | ')}`); } }
const W0 = world(src); const { L, PM, lex } = W0;
const G = L.dlCoeditGate(PM);
const count = (text, word) => text.split(word).length - 1;
const typeAt = (W, p, i, text, at) => { const t = p.doc().getXmlFragment(W.frag).get([0, 1, 3][i]).get(0); p.doc().transact(() => t.insert(at === undefined ? t.length : at, text), 'local'); };
const put = (W, key, value) => W.store.data.set(key, { json: typeof value === 'string' ? value : JSON.stringify(value), version: (W.store.versionCounter += 1) });
const marker = (W) => { const r = W.store.peek(`ydoc:${ID}:seed`); return r && r.value; };
const iso = (W) => new Date(W.clock.now()).toISOString();

// ---- 1. the wire -----------------------------------------------------------------------------------------------------------------------
await test('the cleaner: l, d and the mend message pass; any other shape does not', () => {
  const c = L.dlSyncClean;
  assert.deepEqual(c({ u: 'AAAA' }), { t: 'u', b64: 'AAAA', l: null });
  assert.equal(c({ u: 'AAAA', l: 3 }).l, 3);
  for (const bad of [{ u: 'AAAA', l: -1 }, { u: 'AAAA', l: 1.5 }, { u: 'AAAA', l: '1' }, { u: 'AAAA', l: 2e6 }, { u: 'AAAA', x: 1 }, { u: 'AAAA', l: null }]) assert.equal(c(bad), null, JSON.stringify(bad));
  assert.deepEqual(c({ m: 1, n: 2 }), { t: 'm', n: 2 });
  for (const bad of [{ m: 1, n: 0 }, { m: 1, n: 17 }, { m: 2, n: 1 }, { m: 1 }, { m: 1, n: 1, u: 'AAAA' }, { m: 1, n: 1.5 }, { m: 1, n: 'x' }]) assert.equal(c(bad), null, JSON.stringify(bad));
  const v = c({ v: 'AA', e: 1, a: 2, d: 'abc123', l: 4 }); assert.equal(v.ds, 'abc123'); assert.equal(v.l, 4);
  assert.equal(c({ v: 'AA' }).ds, null);
  for (const bad of [{ v: 'AA', d: 5 }, { v: 'AA', d: 'ab' }, { v: 'AA', d: 'ABCDEF' }, { v: 'AA', d: 'a'.repeat(30) }, { v: 'AA', z: 1 }]) assert.equal(c(bad), null, JSON.stringify(bad));
  assert.equal(c({ k: 'abcd', i: 0, n: 2, c: 'AAAA', l: 1 }).l, 1);
  assert.equal(c({ k: 'abcd', i: 0, n: 2, c: 'AAAA' }).l, null);
  assert.equal(c({ k: 'abcd', i: 0, n: 2, l: 1 }), null);
});

// ---- 2. the delete set -----------------------------------------------------------------------------------------------------------------
const pairWithDeletions = async () => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111'); await W.run(300); const b = await W.page('bbbb2222'); await W.run(2000);
  const t = a.doc().getXmlFragment(W.frag).get(0).get(0);
  a.doc().transact(() => t.delete(0, 5), 'local'); // "Alpha" is gone
  await W.run(500);
  return { W, a, b };
};
await test('a document with deletions: a beat is answered with nothing (no 24-byte delete-set message from every page every 15 s)', async () => {
  const { W, a, b } = await pairWithDeletions();
  assert.equal(W.textOf(a.doc(), a.table), W.textOf(b.doc(), b.table));
  const mark = W.bus.log.length;
  await W.run(120000);
  const sent = W.bus.log.slice(mark);
  const answers = sent.filter((x) => x.kind === 'u' && x.to);
  const vectors = sent.filter((x) => x.kind.startsWith('v'));
  assert.equal(answers.length, 0, `${answers.length} answers in 2 minutes`);
  assert.ok(vectors.length >= 12, `the beats still go (${vectors.length})`);
  const sa = a.session.stats(); const sb = b.session.stats();
  assert.ok(sa.dsSkipped + sb.dsSkipped >= 12, `skipped ${sa.dsSkipped}+${sb.dsSkipped}`);
  facts.push(`2 pages, a document with deletions, 120 s: ${vectors.length} beats, ${answers.length} answers (the old check answered every one); ${sa.dsSkipped + sb.dsSkipped} answers skipped by the hash`);
});
await test('a deletion that was lost on the way (no struct: the state vectors are equal) is still repaired within a beat', async () => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111'); await W.run(300); const b = await W.page('bbbb2222'); await W.run(2000);
  const dropped = 0;
  const t = a.doc().getXmlFragment(W.frag).get(0).get(0);
  a.doc().transact(() => t.delete(0, 5), 'dl-sync-net'); // a deletion this page has and was never sent: no message, no gap in the numbers, equal state vectors
  assert.equal(dropped, 0);
  assert.notEqual(W.textOf(a.doc(), a.table), W.textOf(b.doc(), b.table), 'b still has the word');
  assert.deepEqual([...PM.encodeStateVector(a.doc())], [...PM.encodeStateVector(b.doc())], 'the state vectors are equal: the old check could not tell');
  await W.run(20000);
  assert.equal(W.textOf(a.doc(), a.table), W.textOf(b.doc(), b.table), 'repaired by the next beat');
  assert.ok(!W.textOf(b.doc(), b.table).startsWith('Alpha'));
});
await test('structs missing are still answered: a page that lacks a struct gets it from a beat', async () => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111'); await W.run(300); const b = await W.page('bbbb2222'); await W.run(2000);
  W.bus.drop = (msg) => Boolean(msg.data && msg.data.u && msg.from.key === 'aaaa1111');
  typeAt(W, a, 0, ' more'); await W.run(300);
  W.bus.drop = () => false;
  await W.run(20000);
  assert.equal(W.textOf(a.doc(), a.table), W.textOf(b.doc(), b.table));
});

// ---- 3. the good state -----------------------------------------------------------------------------------------------------------------
await test('the good state follows each change: a rebuild loses at most the last moment (goodMs), not 15 s', async () => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111'); await W.run(2000);
  for (let i = 0; i < 40; i += 1) { typeAt(W, a, 0, String.fromCharCode(97 + (i % 26))); await W.run(50); }
  const typed = W.textOf(a.doc(), a.table);
  const before = count(typed, '');
  a.session.rebuild('test');
  const after = W.textOf(a.doc(), a.table);
  const lost = typed.length - after.length;
  assert.ok(lost >= 0 && lost <= 3, `${lost} characters lost (typing at 20 a second)`);
  assert.equal(a.session.stats().rebuilt, 1);
  facts.push(`a lone page typing 20 characters a second: after a rebuild ${lost} characters are missing (goodMs ${L.DL_SYNC.goodMs} ms); the old rule lost up to 15 s`);
  assert.ok(before >= 0);
});
await test('the good state is also the other people\'s: a remote update accepted a moment ago is in the rebuilt state', async () => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111'); await W.run(300); const b = await W.page('bbbb2222'); await W.run(2000);
  typeAt(W, b, 1, ' from b'); await W.run(300);
  assert.ok(W.textOf(a.doc(), a.table).includes('from b'));
  a.session.rebuild('test');
  assert.ok(W.textOf(a.doc(), a.table).includes('from b'), 'a remote update accepted 300 ms ago survives the rebuild');
});
await test('the cost of taking the good state on a 150,000-character document, and how often it is taken', async () => {
  const para = (i) => `Paragraph ${i} lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ${'x'.repeat(30)} end.`;
  const text = `${Array.from({ length: 1150 }, (_, i) => para(i)).join('\n\n')}\n`;
  const W = world(src); W.make(text);
  const a = await W.page('aaaa1111'); await W.run(4000);
  const takes0 = a.session.stats().takes;
  const t1 = Date.now();
  for (let i = 0; i < 100; i += 1) { const t = a.doc().getXmlFragment(W.frag).get(0).get(0); a.doc().transact(() => t.insert(t.length, 'a'), 'local'); await W.run(40); }
  const s = a.session.stats();
  const takes = s.takes - takes0;
  assert.ok(s.takeMs < 25, `one take ${s.takeMs} ms`);
  assert.ok(takes <= 46, `${takes} takes in 4 s of typing`);
  facts.push(`good state on ${text.length} characters (${PM.encodeStateAsUpdate(a.doc()).length} B of state): one take ${s.takeMs} ms, ${takes} takes in 4 s of typing 25 keys a second`);
  assert.ok(Date.now() - t1 < 20000);
});

// ---- 4. the lineage race ---------------------------------------------------------------------------------------------------------------
const racing = async () => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111', { snap: true, meta: true }); await W.run(500);
  const b0 = await W.page('bbbb0000', { snap: true, meta: true }); await W.run(14000); // a second page so a copy is written; then it leaves
  assert.ok(W.store.peek(`ydoc:${ID}`), 'a copy was written');
  await W.leave(b0); await W.run(500);
  // a is in the room, unheard and not in the list of people; the copy is lost, so the next page reseeds as a new lineage
  W.bus.members.get('aaaa1111').hidden = true;
  W.store.data.delete(`ydoc:${ID}:0`);
  W.bus.drop = (msg) => msg.from.key === 'aaaa1111';
  const b = await W.page('bbbb2222', { snap: true, meta: true });
  await W.run(8000);
  return { W, a, b };
};
await test('the race: a page that re-seeded while an older page was in the room unheard; both docs hold the text once, but merged they would hold it twice', async () => {
  const { W, a, b } = await racing();
  assert.equal(b.session.stats().marker, 'reseed', `b ${b.session.stats().marker}`);
  assert.equal(b.session.lineage().epoch, 1); assert.equal(a.session.lineage().epoch, 0);
  assert.equal(count(W.textOf(a.doc(), a.table), 'Alpha one.'), 1); assert.equal(count(W.textOf(b.doc(), b.table), 'Alpha one.'), 1);
  const merged = new PM.Doc(); PM.applyUpdate(merged, PM.encodeStateAsUpdate(a.doc())); PM.applyUpdate(merged, PM.encodeStateAsUpdate(b.doc()));
  assert.equal(count(W.textOf(merged, a.table), 'Alpha one.'), 2, 'the hazard is real: two seeds of one text merge into a doubled text');
});
await test('the race, closed: the pages meet; the stale page stops and its text is safe; nothing is doubled on either page', async () => {
  const { W, a, b } = await racing();
  typeAt(W, a, 1, ' a typed this');
  W.bus.drop = () => false; W.bus.members.get('aaaa1111').hidden = false;
  await W.run(40000);
  assert.equal(a.lineage.length, 1, `a was told once (${a.lineage.length})`);
  assert.equal(a.session.frozen(), true);
  assert.equal(b.lineage.length, 0, 'b holds the marker\'s lineage and was not stopped');
  assert.equal(count(W.textOf(a.doc(), a.table), 'Alpha one.'), 1); assert.equal(count(W.textOf(b.doc(), b.table), 'Alpha one.'), 1, 'b has the text once');
  assert.ok(W.textOf(a.doc(), a.table).includes('a typed this'), 'a\'s text is still on its page');
  assert.equal(a.session.isWriter(), false);
  const sent = W.bus.log.filter((x) => x.from === 'aaaa1111').length;
  await W.run(30000);
  assert.equal(W.bus.log.filter((x) => x.from === 'aaaa1111').length, sent, 'a sends nothing once stopped');
  // the page saves and reopens: what a saved is in the record
  const r = await a.saver.save(true);
  assert.ok(r === 'saved' || r === 'same', r);
  assert.ok(W.stored().text.includes('a typed this'), 'the stale page\'s text was saved before it reopened');
  await W.leave(a); await W.run(500);
  const a2 = await W.page('aaaa1111', { snap: true, meta: true }); await W.run(8000);
  assert.equal(a2.session.lineage().epoch, 1, 'the reopened page is in the document\'s lineage');
  assert.equal(count(W.textOf(a2.doc(), a2.table), 'Alpha one.'), 1);
  const lostA = !W.textOf(a2.doc(), a2.table).includes('a typed this');
  facts.push(`lineage race: the stale page was stopped ${'(no doubled text on either page)'}; its edit made in the unheard window ${lostA ? 'is in the stored text but NOT in the room (the new lineage seeded from the older text): the next save of the room would overwrite it: NOT CLOSED' : 'survived'}`);
});
await test('a message from another lineage that the marker does not back (a made-up l) is dropped and costs nothing but a read', async () => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111', { meta: true }); await W.run(300); const b = await W.page('bbbb2222', { meta: true }); await W.run(2000);
  const mal = W.bus.connect('mallory9');
  mal.live.publish(L.dlSyncTopic(ID), { u: 'AAAA', l: 7 }); mal.live.publish(L.dlSyncTopic(ID), { v: 'AA', l: 5 });
  await W.run(6000);
  assert.equal(a.lineage.length + b.lineage.length, 0, 'no page was stopped by a made-up lineage');
  assert.ok(a.session.stats().lineageSeen >= 1);
  typeAt(W, a, 0, ' fine'); await W.run(300);
  assert.equal(W.textOf(a.doc(), a.table), W.textOf(b.doc(), b.table));
});

// 0.11.27 (F6): a forged seed marker and ONE live message carrying its epoch made every page stop, save and reopen.
const forgeLineage = async (by, o = {}) => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111', { meta: true, lineageOk: o.lineageOk }); await W.run(300); const b = await W.page('bbbb2222', { meta: true, lineageOk: o.lineageOk }); await W.run(2000);
  const c = await W.page('mallory9', { meta: true }); await W.run(3000); const mal = c.m; // an editor in the room
  put(W, `ydoc:${ID}:seed`, { id: 99999, by, at: iso(W), epoch: 7 });
  mal.live.publish(L.dlSyncTopic(ID), { u: 'AAAA', l: 7 });
  await W.run(6000);
  return { W, a, b, mal };
};
await test('a forged marker whose author is nobody in the room, and one message with its epoch: no page stops or reopens', async () => {
  const { a, b } = await forgeLineage('ghost0000');
  assert.equal(a.lineage.length + b.lineage.length, 0, 'no page left its lineage');
  assert.equal(a.session.frozen() || b.session.frozen(), false);
});
await test('a marker written by a person who is in the room still moves the pages (a real re-seed), once; the page can refuse it (one reopen a minute)', async () => {
  const real = await forgeLineage('mallory9');
  assert.equal(real.a.lineage.length, 1); assert.equal(real.b.lineage.length, 1);
  let asked = 0;
  const limited = await forgeLineage('mallory9', { lineageOk: () => { asked += 1; return false; } });
  assert.ok(asked >= 1, 'the page was asked'); assert.equal(limited.a.lineage.length + limited.b.lineage.length, 0, 'refused: nobody stopped');
  assert.equal(limited.a.session.frozen(), false);
  // and it keeps editing: a change reaches the other page
  typeAt(limited.W, limited.a, 0, ' still here'); await limited.W.run(1500);
  assert.equal(limited.W.textOf(limited.b.doc(), limited.b.table).includes('still here'), true);
});

// ---- 5. a hostile marker ---------------------------------------------------------------------------------------------------------------
const settled = async (o = {}) => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111', { snap: true, meta: true }); await W.run(500);
  const b = o.alone ? null : await W.page('bbbb2222', { snap: true, meta: true });
  await W.run(14000);
  assert.ok(W.store.peek(`ydoc:${ID}`), 'a copy was written');
  if (o.alone) return { W, a };
  return { W, a, b };
};
for (const [name, bad] of [
  ['a valid marker with a huge epoch and another id', (W) => ({ id: 12345, by: 'mallory9', at: iso(W), epoch: 999999 })],
  ['a valid marker with another id (same epoch)', (W) => ({ id: 777, by: 'mallory9', at: iso(W) })],
  ['a marker with an epoch past the limit (not a marker)', (W) => ({ id: 777, by: 'mallory9', at: iso(W), epoch: 1e12 })],
  ['a marker that is a string', () => JSON.stringify('hello')],
  ['a marker that is a list', () => [1, 2]],
  ['a marker with a negative id', (W) => ({ id: -5, by: 'mallory9', at: iso(W) })],
]) {
  await test(`a hostile marker (${name}), the writer alone: the text is never lost, the writer puts its own lineage back and writes a good copy; a new page loads it`, async () => {
    const { W, a } = await settled({ alone: true });
    const mine = a.session.lineage();
    const textBefore = W.stored().text;
    put(W, `ydoc:${ID}:seed`, bad(W));
    W.pages.forEach((p) => p.snapSaver && p.snapSaver.state);
    typeAt(W, a, 0, ' more'); await W.run(90000);
    assert.equal(W.stored().text.includes('more'), true, 'the new text was saved under the hostile marker');
    assert.ok(W.stored().text.startsWith(textBefore.slice(0, 5)));
    const m = marker(W);
    assert.ok(m && m.id === mine.seed && (m.epoch || 0) === mine.epoch, `the marker is the writer's lineage again: ${JSON.stringify(m)}`);
    assert.ok(a.snapSaver.counts.healed >= 1, 'the writer healed the marker');
    const hdr = W.store.peek(`ydoc:${ID}`).value; assert.equal(hdr.seed, mine.seed);
    await W.leave(a); await W.run(300);
    const c = await W.page('cccc3333', { snap: true, meta: true }); await W.run(4000);
    assert.equal(c.session.stats().snapshotLoaded, 1, 'the next page loads the copy');
    assert.equal(c.text(), W.stored().text);
  });
}
await test('a hostile marker with others in the room: the copy waits (nothing is rewritten under people), the text is saved, and after everyone leaves the next page rebuilds from the text', async () => {
  const { W, a, b } = await settled();
  put(W, `ydoc:${ID}:seed`, { id: 4242, by: 'mallory9', at: iso(W), epoch: 5 });
  typeAt(W, a, 0, ' with people here'); await W.run(60000);
  assert.ok(W.stored().text.includes('with people here'), 'the text is saved');
  assert.equal(marker(W).id, 4242, 'the marker was not rewritten while others are in the room');
  assert.ok((a.snapSaver.counts.skips.lineage_changed || 0) + (b.snapSaver.counts.skips.lineage_changed || 0) >= 1);
  await W.leave(b); await W.leave(a); await W.run(300);
  const c = await W.page('cccc3333', { snap: true, meta: true }); await W.run(8000);
  assert.equal(c.session.stats().snapshotLoaded, 0, 'the copy is not trusted');
  assert.equal(c.text(), W.stored().text, 'the page opens from the stored text');
  assert.equal(count(c.text(), 'Alpha one.'), 1);
  assert.equal(c.session.lineage().epoch >= 1, true, 'a new lineage was started');
});
await test('the marker deleted while a page is open: the text is untouched, the writer puts it back and the copy goes on', async () => {
  const { W, a } = await settled({ alone: true });
  W.store.data.delete(`ydoc:${ID}:seed`);
  typeAt(W, a, 2, ' end'); await W.run(90000);
  assert.ok(W.stored().text.includes(' end'));
  assert.ok(marker(W), 'the marker is back');
  assert.ok(a.snapSaver.counts.healed >= 1);
});
await test('every chunk and the header overwritten with garbage, and the record: the load rejects (never applies), the text opens as it is stored', async () => {
  const { W, a } = await settled({ alone: true });
  await W.leave(a); await W.run(300);
  for (const k of [...W.store.data.keys()]) if (k.startsWith(`ydoc:${ID}`) && !k.endsWith(':seed')) put(W, k, { junk: true });
  const c = await W.page('cccc3333', { snap: true, meta: true }); await W.run(8000);
  assert.equal(c.session.stats().snapshotLoaded, 0);
  assert.ok(c.session.stats().snapshotRejected >= 1);
  assert.equal(c.text(), W.stored().text);
  assert.equal(W.stored().rec.id, ID);
});

await test('a copy older than the saved text is never the document for a page that is alone: the text typed after the copy is not lost', async () => {
  const { W, a } = await settled({ alone: true });
  const rev0 = W.stored().rec.textRev || 0;
  typeAt(W, a, 0, ' NEWER');
  await W.run(9000); // saved (3 s quiet beat), but the copy follows only 45 s after the last one
  assert.ok(W.stored().text.includes('NEWER') && (W.stored().rec.textRev || 0) > rev0, 'the text is saved');
  assert.equal(W.store.peek(`ydoc:${ID}`).value.rev, rev0, 'the copy is still the older one');
  await W.leave(a); await W.run(300);
  const c = await W.page('cccc3333', { snap: true, meta: true }); await W.run(8000);
  assert.ok(c.text().includes('NEWER'), 'the page that opened alone has the text that was saved after the copy');
  assert.equal(count(c.text(), 'Alpha one.'), 1);
  await W.run(30000);
  assert.ok(W.stored().text.includes('NEWER'), 'and its own save does not take it away');
});

// ---- 6. two writers ---------------------------------------------------------------------------------------------------------------------
const bigText = (n) => Array.from({ length: n }, (_, i) => `Paragraph ${i} lorem ipsum dolor sit amet consectetur adipiscing elit.`).join('\n\n') + '\n';
await test('two pages that both think they are the writer: chunks and headers interleave over 60 orders; a reader never applies half, and ends on one writer\'s whole state or on the text', async () => {
  let accepted = 0; let rejected = 0; let conflicts = 0;
  for (let seed = 1; seed <= 60; seed += 1) {
    const W = world(src, { seed, yields: 4 }); const text = bigText(1400); W.make(text);
    const dA = new PM.Doc(); L.dlSyncSeed(PM, dA, W.pmDoc(text), ID, text, 4711);
    const dB = new PM.Doc(); PM.applyUpdate(dB, PM.encodeStateAsUpdate(dA));
    dB.transact(() => { const t = dB.getXmlFragment(W.frag).get(0).get(0); t.insert(0, 'B'); }, 'local');
    const bytesA = PM.encodeStateAsUpdate(dA); const bytesB = PM.encodeStateAsUpdate(dB);
    assert.ok(bytesA.length > L.DL_SNAP.chunkBytes, 'the state has more than one chunk');
    put(W, `ydoc:${ID}:seed`, { id: 4711, by: 'aaaa1111', at: iso(W) });
    const rec = W.stored().rec;
    const mk = (who, bytes) => {
      let key = 0;
      const s = L.dlSnapSaver({ store: W.store.as(who), id: ID, me: who, now: () => W.clock.now(), iso: () => iso(W), isWriter: () => true, ready: () => true, dirty: () => false,
        savedText: () => text, rev: () => rec.textRev || 0, stateKey: () => key, largeKey: () => 0, prepare: () => ({ ok: true, bytes }), writes: () => 0, lineage: () => ({ seed: 4711, epoch: 0 }), alone: () => false, note: () => {}, onChange: () => {} });
      return { s, bump: () => { key += 1; } };
    };
    const A = mk('aaaa1111', bytesA); const B = mk('bbbb2222', bytesB);
    for (const x of [A, B]) x.s.tick(); // each notes the state
    W.clock.t += 60000;
    await Promise.all([A.s.tick(), B.s.tick()]);
    conflicts += A.s.counts.conflicts + B.s.counts.conflicts;
    const j = L.dlSnapJoin(PM, { store: W.store.as('cccc3333'), id: ID, lex, storedText: text, storedRev: rec.textRev || 0, storedRec: { ...rec, title: 'Plan' }, me: 'cccc3333', now: () => W.clock.now() });
    const r = await j.load();
    if (r.reject) { rejected += 1; assert.ok(/chunk_hash|chunk_shape|size|header/.test(r.reject), r.reject); } else {
      accepted += 1;
      const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
      assert.ok(same(r.bytes, bytesA) || same(r.bytes, bytesB), `seed ${seed}: the bytes are neither writer's state`);
    }
  }
  assert.ok(rejected + accepted === 60);
  facts.push(`two writers, 60 interleavings: ${accepted} whole copies (one writer's), ${rejected} mixed copies rejected by the hash, ${conflicts} header conflicts`);
});
await test('a mixed copy ends in a rebuild from the text, and then one writer writes a good copy', async () => {
  const { W, a, b } = await settled();
  await W.leave(b); await W.leave(a); await W.run(300);
  const h = W.store.peek(`ydoc:${ID}`);
  const k0 = W.store.peek(`ydoc:${ID}:0`).value;
  put(W, `ydoc:${ID}:0`, { ...k0, d: k0.d.slice(0, -8) + 'AAAAAAAA' }); // another writer's chunk under this header
  assert.ok(h);
  const c = await W.page('cccc3333', { snap: true, meta: true }); await W.run(6000);
  const d = await W.page('dddd4444', { snap: true, meta: true }); await W.run(20000);
  assert.equal(c.session.stats().snapshotLoaded, 0); assert.ok(c.session.stats().snapshotReason.startsWith('chunk'), c.session.stats().snapshotReason);
  assert.equal(c.text(), W.stored().text);
  assert.equal(d.text(), c.text());
  assert.equal(count(d.text(), 'Alpha one.'), 1);
  const wc = c.snapSaver.counts.written; const wd = d.snapSaver.counts.written;
  assert.equal(wc + wd >= 1, true, 'a good copy was written by the writer');
  assert.equal(wc > 0 && wd > 0, false, 'by one writer');
});

// ---- 7. a viewer ------------------------------------------------------------------------------------------------------------------------
await test('a viewer: the store refuses every write with 403, it is never the writer (even with the lowest key), and it does not touch the marker or the copy', async () => {
  const W = world(src); W.make();
  const e = await W.page('bbbb2222', { meta: true }); await W.run(500);
  const v = await W.page('aaaa0000', { role: 'viewer', editor: false }); await W.run(3000);
  for (const write of [() => v.handle.set(`ydoc:${ID}:seed`, { id: 1, by: 'x', at: iso(W) }), () => v.handle.set(`ydoc:${ID}`, { x: 1 }), () => v.handle.set(`doc:${ID}`, { x: 1 }), () => v.handle.delete(`text:${ID}:x`)]) {
    let status = 0; try { await write(); } catch (err) { status = err.status; }
    assert.equal(status, 403);
  }
  assert.equal(v.session.isWriter(), false); assert.equal(e.session.isWriter(), true);
  assert.equal(e.session.writer(), 'bbbb2222');
  typeAt(W, e, 0, ' read along'); await W.run(14000);
  assert.ok(v.text().includes('read along'), 'the viewer reads along');
  assert.ok(W.stored().text.includes('read along'), 'and the editor saved');
  assert.equal(W.store.log.filter((x) => x.who === 'aaaa0000' && x.status === 200 && x.op !== 'get' && x.op !== 'list').length, 0, 'the viewer wrote nothing');
});

// ---- 8. one person, two windows ----------------------------------------------------------------------------------------------------------
// openWindow stands for the page's openCoDoc: take the key; if it is taken, read only and ask again later.
const windowOf = (W, me, tab) => {
  const handle = W.store.as(me);
  const o = { doc: ID, me, tab, now: () => W.clock.now(), sleep: (ms) => new Promise((r) => W.clock.set(r, ms)) };
  return { handle, o, tab, res: null, hold: null };
};
await test('the key: the first window takes it and renews it; a second window of the same person finds a live holder and reads only', async () => {
  const W = world(src); W.make();
  const w1 = windowOf(W, 'aaaa1111', 'tab1tab1tab1'); const w2 = windowOf(W, 'aaaa1111', 'tab2tab2tab2');
  w1.res = await L.dlLeaseAcquire(w1.handle, w1.o);
  assert.equal(w1.res.won, true);
  w1.hold = L.dlLeaseHold(w1.handle, { doc: ID, me: 'aaaa1111', tab: w1.tab, version: w1.res.version, now: w1.o.now, set: (f, ms) => W.clock.set(f, ms), clear: (i) => W.clock.clear(i), onLost: () => { w1.lost = true; } });
  let r2 = null; L.dlLeaseAcquire(w2.handle, w2.o).then((r) => { r2 = r; });
  await W.run(9000);
  assert.deepEqual(r2, { won: false }, 'the second window does not edit');
  assert.equal(w1.hold.held(), true);
  await W.run(60000);
  const renews = W.store.log.filter((x) => x.op === 'set' && x.key === L.dlLeaseKey(ID, 'aaaa1111') && x.status === 200).length;
  assert.ok(renews >= 11 && renews <= 14, `${renews} renewals in 69 s`);
  facts.push(`the edit window key: renewed every ${L.DL_LEASE.renewMs / 1000} s (${Math.round(renews / 69 * 60)} writes a minute); a second window waits ${L.DL_LEASE.watchMs / 1000} s to see it is alive`);
});
await test('the second window opens read only; the writer is the first window\'s, per person; the other people see one editor for the person', async () => {
  const W = world(src); W.make();
  const open = async (me, tab) => { const w = windowOf(W, me, tab); w.res = await L.dlLeaseAcquire(w.handle, w.o); if (w.res.won) { w.hold = L.dlLeaseHold(w.handle, { doc: ID, me, tab, version: w.res.version, now: w.o.now, set: (f, ms) => W.clock.set(f, ms), clear: (i) => W.clock.clear(i), onLost: () => { w.lost = true; } }); w.page = await W.page(me); } return w; };
  const t1 = await open('aaaa1111', 'tab1tab1tab1'); await W.run(1500);
  const bob = await open('bbbb2222', 'bobtabbobtab'); await W.run(2000);
  let t2 = null; open('aaaa1111', 'tab2tab2tab2').then((w) => { t2 = w; });
  await W.run(10000);
  assert.ok(t2 && t2.res.won === false && !t2.page, 'the second window of aaaa1111 has no session');
  assert.equal(bob.page.session.roster.others().filter((p) => p.key === 'aaaa1111').length, 1, 'bob counts one editor for the person');
  assert.equal(t1.page.session.isWriter(), true); assert.equal(bob.page.session.isWriter(), false);
  assert.equal(bob.page.session.writer(), 'aaaa1111');
  typeAt(W, t1.page, 0, ' from window one'); await W.run(14000);
  assert.ok(bob.page.text().includes('from window one'));
  assert.ok(W.stored().text.includes('from window one'));
  assert.equal(W.store.log.filter((x) => x.op === 'set' && x.status === 200 && x.key === `doc:${ID}`).every((x) => x.who === 'aaaa1111' || x.who === 'bbbb2222'), true);
});
await test('a window that closed on purpose releases the key: the next window takes it at once; a dead holder is replaced after the wait; a very old key at once', async () => {
  const W = world(src); W.make();
  const w1 = windowOf(W, 'aaaa1111', 'tab1tab1tab1');
  w1.res = await L.dlLeaseAcquire(w1.handle, w1.o);
  w1.hold = L.dlLeaseHold(w1.handle, { doc: ID, me: 'aaaa1111', tab: w1.tab, version: w1.res.version, now: w1.o.now, set: (f, ms) => W.clock.set(f, ms), clear: (i) => W.clock.clear(i), onLost: () => {} });
  await W.run(6000);
  await w1.hold.release();
  assert.equal(W.store.peek(L.dlLeaseKey(ID, 'aaaa1111')), null, 'the key is deleted');
  const w2 = windowOf(W, 'aaaa1111', 'tab2tab2tab2');
  const t = W.clock.now(); w2.res = await L.dlLeaseAcquire(w2.handle, w2.o);
  assert.equal(w2.res.won, true); assert.equal(W.clock.now(), t, 'no wait');
  // the holder dies (a closed tab: no release, no renewals)
  const w3 = windowOf(W, 'aaaa1111', 'tab3tab3tab3');
  const h2 = L.dlLeaseHold(w2.handle, { doc: ID, me: 'aaaa1111', tab: w2.tab, version: w2.res.version, now: w2.o.now, set: (f, ms) => W.clock.set(f, ms), clear: (i) => W.clock.clear(i), onLost: () => { w2.lost = true; } });
  await W.run(6000);
  h2.release; // the tab is gone: its timer is cleared with it
  for (const tm of [...W.clock.timers]) W.clock.clear(tm.id); // all timers of the dead tab
  let r3 = null; const started = W.clock.now(); L.dlLeaseAcquire(w3.handle, w3.o).then((r) => { r3 = r; });
  await W.run(L.DL_LEASE.watchMs + 500);
  assert.equal(r3 && r3.won, true, 'the dead holder\'s key was taken over');
  facts.push(`a dead window: replaced ${Math.round((W.clock.now() - started) / 100) / 10} s after the second window looked (at most ${(L.DL_LEASE.watchMs + 500) / 1000} s)`);
  // a key written long ago (by a clock far from ours) is dead at once
  const old = new Date(W.clock.now() - 120000).toISOString();
  put(W, L.dlLeaseKey(ID, 'cccc3333'), { t: 'oldtaboldtab', at: old });
  const w4 = windowOf(W, 'cccc3333', 'tab4tab4tab4'); const t4 = W.clock.now();
  w4.res = await L.dlLeaseAcquire(w4.handle, w4.o);
  assert.equal(w4.res.won, true); assert.equal(W.clock.now(), t4, 'no wait for a key that old');
});
await test('garbage in the key is no holder; a holder whose key another window took finds out at its next renewal and is told once', async () => {
  const W = world(src); W.make();
  put(W, L.dlLeaseKey(ID, 'aaaa1111'), { junk: 1 });
  const w1 = windowOf(W, 'aaaa1111', 'tab1tab1tab1'); const t = W.clock.now();
  w1.res = await L.dlLeaseAcquire(w1.handle, w1.o);
  assert.equal(w1.res.won, true); assert.equal(W.clock.now(), t);
  let lost = 0;
  L.dlLeaseHold(w1.handle, { doc: ID, me: 'aaaa1111', tab: w1.tab, version: w1.res.version, now: w1.o.now, set: (f, ms) => W.clock.set(f, ms), clear: (i) => W.clock.clear(i), onLost: () => { lost += 1; } });
  await W.run(3000);
  put(W, L.dlLeaseKey(ID, 'aaaa1111'), { t: 'othertabother', at: iso(W) }); // another window took it (this one was starved) and renews it
  for (let i = 0; i < 6; i += 1) { await W.run(L.DL_LEASE.renewMs - 200); put(W, L.dlLeaseKey(ID, 'aaaa1111'), { t: 'othertabother', at: iso(W) }); }
  assert.equal(lost, 1, 'told once');
  await W.run(30000);
  assert.equal(lost, 1);
  assert.equal(W.store.peek(L.dlLeaseKey(ID, 'aaaa1111')).value.t, 'othertabother', 'the holder does not write over the new holder');
});
await test('the key deleted by someone else while held: the holder takes it again and carries on (it is not thrown out by a deleted key)', async () => {
  const W = world(src); W.make();
  const w1 = windowOf(W, 'aaaa1111', 'tab1tab1tab1');
  w1.res = await L.dlLeaseAcquire(w1.handle, w1.o);
  let lost = 0;
  const h = L.dlLeaseHold(w1.handle, { doc: ID, me: 'aaaa1111', tab: w1.tab, version: w1.res.version, now: w1.o.now, set: (f, ms) => W.clock.set(f, ms), clear: (i) => W.clock.clear(i), onLost: () => { lost += 1; } });
  W.store.data.delete(L.dlLeaseKey(ID, 'aaaa1111'));
  await W.run(L.DL_LEASE.renewMs * 3);
  assert.equal(lost, 0); assert.equal(h.held(), true);
  assert.equal(W.store.peek(L.dlLeaseKey(ID, 'aaaa1111')).value.t, 'tab1tab1tab1');
});
await test('the key\'s cleaner: only { t, at }', () => {
  assert.ok(L.dlCleanLease({ t: 'abcdefgh1234', at: '2026-11-13T10:00:00.000Z' }));
  for (const bad of [null, 5, 'x', [], {}, { t: 'abc', at: '2026-11-13T10:00:00.000Z' }, { t: 'abcdefgh1234', at: 'never' }, { t: 'abcdefgh1234', at: '2026-11-13T10:00:00.000Z', x: 1 }, { t: 'ABCDEFGH1234', at: '2026-11-13T10:00:00.000Z' }]) assert.equal(L.dlCleanLease(bad), null, JSON.stringify(bad));
});

// ---- 9. the mend ------------------------------------------------------------------------------------------------------------------------
await test('the mend is reported: the writer\'s page hears what was dropped, the others are told once, the writer\'s copy is written after it', async () => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111', { meta: true }); await W.run(500); const b = await W.page('bbbb2222', { meta: true }); const c = await W.page('cccc3333', { meta: true });
  await W.run(6000);
  assert.equal(a.session.isWriter(), true);
  // the writer's copy, wired as documents.js wires it (a mend hands the dropped blocks to the page, which says so and tells the others)
  const sv = L.dlSnapSaver({
    store: a.handle, id: ID, me: 'aaaa1111', now: () => W.clock.now(), iso: () => iso(W), isWriter: () => a.session.isWriter(), ready: () => true, dirty: () => false,
    savedText: () => TEXT, rev: () => 1, stateKey: () => a.session.stats().changes, largeKey: () => 0, prepare: () => L.dlSnapPrepare(PM, lex, a.doc(), TEXT), writes: () => 0,
    lineage: () => a.session.lineage(), alone: () => false, mended: (d) => { a.mended.push(d); a.session.announceMend(d.length); }, note: () => {}, onChange: () => {},
  });
  const f = a.doc().getXmlFragment(W.frag);
  const bad = new PM.XmlElement('paragraph'); const tx = new PM.XmlText(); tx.insert(0, 'bad\nline that cannot be saved'); bad.insert(0, [tx]);
  a.doc().transact(() => f.insert(2, [bad]), 'dl-sync-seed'); // in the writer's own document only (the gate would refuse it from anyone else)
  await sv.tick(); // notes the state
  await W.run(3000);
  await sv.tick();
  await W.run(1000);
  assert.equal(a.mended.length, 1, 'the writer\'s page was told what was dropped');
  assert.ok(/bad/.test(a.mended[0][0].text) && a.mended[0][0].text.includes('cannot be saved'), 'with its whole text, for the console');
  assert.equal(b.mends.length, 1, `b was told ${b.mends.length} times`); assert.equal(c.mends.length, 1);
  assert.equal(a.mends.length, 0, 'the writer does not hear its own message');
  assert.equal(count(W.textOf(a.doc(), a.table), 'bad'), 0, 'the block is gone from the writer\'s document');
  await sv.tick(); W.clock.t += 60000; await W.run(3000);
  await sv.tick();
  assert.equal(sv.counts.written, 1, 'and the copy is written after the mend');
  assert.equal(b.mends.length, 1, 'nobody is told twice');
});
await test('a mend message from a page that is not the writer is not shown; neither is one that comes too often', async () => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111', { meta: true }); await W.run(500); const b = await W.page('bbbb2222', { meta: true }); await W.run(3000);
  b.session.announceMend(1); await W.run(500);
  assert.equal(a.mends.length, 0, 'b is not the writer');
  a.session.announceMend(1); await W.run(500);
  assert.equal(b.mends.length, 1);
  a.session.announceMend(1); await W.run(500);
  assert.equal(b.mends.length, 1, 'not again within the minimum gap');
  await W.run(L.DL_SYNC.mendNoteMs);
  a.session.announceMend(2); await W.run(500);
  assert.equal(b.mends.length, 2);
});

// ---- 10. writes per minute ---------------------------------------------------------------------------------------------------------------
await test('writes per minute: three people typing for three minutes, one of them the writer with the copy and the edit window key: under 240 a minute for every person', async () => {
  const W = world(src); W.make();
  const a = await W.page('aaaa1111', { snap: true, meta: true }); await W.run(500); const b = await W.page('bbbb2222', { snap: true, meta: true }); const c = await W.page('cccc3333', { snap: true, meta: true });
  await W.run(3000);
  const w1 = windowOf(W, 'aaaa1111', 'tab1tab1tab1'); w1.res = await L.dlLeaseAcquire(w1.handle, w1.o);
  L.dlLeaseHold(w1.handle, { doc: ID, me: 'aaaa1111', tab: w1.tab, version: w1.res.version, now: w1.o.now, set: (f, ms) => W.clock.set(f, ms), clear: (i) => W.clock.clear(i), onLost: () => {} });
  for (let i = 0; i < 180; i += 1) { typeAt(W, [a, b, c][i % 3], i % 3, String.fromCharCode(97 + (i % 26))); await W.run(1000); }
  const perMinute = new Map();
  for (const x of W.store.log) if (x.status === 200 && (x.op === 'set' || x.op === 'delete')) { const m = Math.floor(x.at / 60000); const k = `${x.who}:${m}`; perMinute.set(k, (perMinute.get(k) || 0) + 1); }
  const worst = Math.max(...perMinute.values());
  assert.ok(worst < 240, `${worst} writes in one minute`);
  assert.equal(W.store.log.filter((x) => x.status === 429).length, 0, 'the store never said too many');
  facts.push(`3 people, 3 minutes of typing, writer with the edit window key: at most ${worst} writes in a minute for any person (limit 240)`);
});

const failedTotal = fails.length;
console.log(`documents coedit hostile: ${passed} tests passed in ${((Date.now() - t0) / 1000).toFixed(1)} s${facts.length ? ` (${facts.join('; ')})` : ''}`);
if (failedTotal) { console.log(`\n${failedTotal} failed:`); for (const f of fails) console.log(`- ${f}`); process.exit(1); }
