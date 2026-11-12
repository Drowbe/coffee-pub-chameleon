#!/usr/bin/env node
/*
 * check-documents-coedit-sync.mjs -- the channel of a shared document (documents-lib-u-coedit-sync.js), in Node with no DOM, no network and no
 * timers: a stand-in for host.live (a bus that can drop, duplicate, reorder and refuse messages, with the server's seq and `from`) and a manual clock.
 * Plan: plan-documents-coediting.md, step 4a. What this does NOT cover: the editor's view (see check-documents-coedit-* with the stand-in view),
 * the real SDK and server (the live run with two browser pages does), and anything about storage (4b).
 *
 *  1. The pure pieces: the topic of a document (fits the rule, no collisions), base64, the state vector reader, the message cleaner, the roster and the cap.
 *  2. The switch: dlSyncEnabled is on only for a real `true`; module.json's live limits agree with the code's and pass the server's cleanLive.
 *  3. Two to eight sessions on the bus: typing converges; bytes per typed character; a dropped message is repaired by the vector exchange (virtual ms);
 *     a big update goes as the difference in pieces; duplicates and reordering are harmless; the channel down and back (offline merge).
 *  4. Hostile and odd messages are dropped and counted; the sender is the transport's `from`, never anything in the data; the quiet period asks again.
 *  5. The join: the state of a peer is taken before the document is seeded; two pages that seed at once do not double the text; the cap of eight.
 *
 * Usage: node modules/documents/test/check-documents-coedit-sync.mjs [path to the src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadRich } from './support/rich-corpus.mjs';

const t0 = Date.now();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(root, 'modules/documents/src'));
const NAMES = ['dlRichRead', 'dlCoeditGate', 'dlSyncSession', 'dlSyncTopic', 'dlSyncB64', 'dlSyncUnb64', 'dlSyncVector', 'dlSyncHasMore', 'dlSyncClean', 'dlSyncRoster', 'dlSyncEnabled', 'dlSyncSeed', 'dlSyncFullNote', 'DL_SYNC', 'DL_MARKED_MATH', 'DL_MARKED_HOOKS'];
const { PM, L, lex } = loadRich(src, NAMES);
const G = L.dlCoeditGate(PM);
const FRAG = G.limits.root;

let passed = 0; const fails = []; const facts = [];
async function test(name, fn) { try { await fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

// ---- the stand-ins --------------------------------------------------------------------------------------------------------------------
class Clock {
  constructor() { this.t = 1000; this.timers = []; this.n = 0; }
  now() { return this.t; }
  set(fn, ms) { const id = (this.n += 1); this.timers.push({ id, at: this.t + Math.max(0, ms), fn }); return id; }
  clear(id) { this.timers = this.timers.filter((x) => x.id !== id); }
  api() { return { now: () => this.now(), set: (f, ms) => this.set(f, ms), clear: (i) => this.clear(i) }; }
}
const micro = async (n = 6) => { for (let i = 0; i < n; i += 1) await Promise.resolve(); };
class Bus {
  constructor(clock, { bytes = 2048, paceMs = 0 } = {}) { this.paceMs = paceMs; this.clock = clock; this.members = new Map(); this.seq = 0; this.bytes = bytes; this.drop = () => false; this.dup = () => false; this.log = []; this.held = null; this.refuse = null; }
  connect(key, name = key) {
    const m = { key, name, subs: new Map(), people: [], state: 'open', ups: [] };
    this.members.set(key, m);
    const bus = this;
    const live = {
      get state() { return m.state; },
      subscribe(topic, fn) { m.subs.set(topic, fn); return () => m.subs.delete(topic); },
      on(ev, fn) {
        if (ev === 'state') { m.stateFn = fn; return () => { m.stateFn = null; }; }
        m.peopleFn = fn;
        Promise.resolve().then(() => fn({ joined: null, left: null, people: bus.people() }));
        return () => { m.peopleFn = null; };
      },
      publish(topic, data, opt) {
        if (m.state !== 'open') return Promise.reject(Object.assign(new Error('closed'), { status: 503 }));
        const n = JSON.stringify(data).length;
        if (n > bus.bytes) return Promise.reject(Object.assign(new Error('too big'), { status: 413 }));
        if (bus.refuse) { const r = bus.refuse(topic, data); if (r) return Promise.reject(r); }
        bus.seq += 1;
        const msg = { topic, data: JSON.parse(JSON.stringify(data)), from: { key: m.key, name: m.name, guest: false, tint: 'blue' }, seq: bus.seq, to: opt && opt.to ? opt.to : null, bytes: n };
        bus.log.push({ topic, bytes: n, from: key, to: msg.to, kind: Object.keys(data).join('') });
        // paceMs: the module's rate (30 messages a second is 33 ms): the publish is answered, and the message goes, after that long
        if (bus.paceMs) return new Promise((resolve) => { bus.clock.set(() => { bus.pending.push(msg); resolve(true); }, bus.paceMs); });
        bus.pending.push(msg);
        return Promise.resolve(true);
      },
    };
    this.pending = this.pending || [];
    m.live = live;
    for (const o of this.members.values()) if (o.peopleFn) o.peopleFn({ joined: o === m ? null : { key, name, guest: false, tint: 'blue' }, left: null, people: this.people() });
    return m;
  }
  people() { return [...this.members.values()].map((x) => ({ key: x.key, name: x.name, guest: false, tint: 'blue' })); }
  disconnect(key) { const m = this.members.get(key); this.members.delete(key); for (const o of this.members.values()) if (o.peopleFn) o.peopleFn({ joined: null, left: { key, name: key, guest: false, tint: 'blue' }, people: this.people() }); return m; }
  flush() {
    const out = this.pending.splice(0);
    let n = 0;
    for (const msg of out) {
      if (this.drop(msg)) continue;
      for (const [k, m] of this.members) {
        if (k === msg.from.key || (msg.to && !msg.to.includes(k)) || m.state !== 'open') continue;
        const fn = m.subs.get(msg.topic);
        if (!fn) continue;
        for (let c = this.dup(msg) ? 2 : 1; c > 0; c -= 1) fn(JSON.parse(JSON.stringify(msg.data)), { ...msg.from }, { topic: msg.topic, at: this.clock.now(), seq: msg.seq });
        n += 1;
      }
    }
    return n;
  }
}
// runs the clock forward, delivering as it goes
async function run(clock, bus, ms, step = 5) {
  const end = clock.t + ms;
  while (clock.t < end) {
    clock.t += step;
    for (const tm of clock.timers.filter((x) => x.at <= clock.t).sort((a, b) => a.at - b.at)) { clock.timers = clock.timers.filter((x) => x !== tm); tm.fn(); }
    await micro();
    bus.flush();
    await micro();
    bus.flush();
  }
}

const TEXT = 'Alpha one.\n\nBeta two.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nOmega.\n';
const pmDoc = () => L.dlRichRead(PM, TEXT, lex).doc;
const ID = 'doc12345';

function page(bus, clock, key, o = {}) {
  const m = bus.connect(key);
  const doc = new PM.Doc();
  const s = L.dlSyncSession(PM, {
    doc, lex, topic: L.dlSyncTopic(ID), me: key, live: m.live, editor: true, clock: clock.api(),
    seed: (d) => L.dlSyncSeed(PM, d, o.text ? L.dlRichRead(PM, o.text, lex).doc : pmDoc(), ID, o.text || TEXT),
    onRebuild: () => { m.rebuilt = (m.rebuilt || 0) + 1; },
    config: o.config,
  });
  m.session = s; m.doc = () => s.doc();
  s.start();
  let how = null;
  s.join((h) => { how = h; m.at = clock.now(); });
  m.how = () => how;
  return m;
}
const paragraph = (d, i) => d.getXmlFragment(FRAG).get(i);
function typeAt(d, i, text, at) { const para = paragraph(d, i); const t = para.get(0); d.transact(() => t.insert(at === undefined ? t.length : at, text), 'local'); }
const textOf = (d) => { let s = ''; const walk = (n) => { if (n.toDelta) { for (const x of n.toDelta()) s += x.insert; s += '|'; } else if (n.toArray) n.toArray().forEach(walk); }; walk(d.getXmlFragment(FRAG)); return s; };
const same = (...ms) => { const j = ms.map((m) => textOf(m.doc())); return j.every((x) => x === j[0]); };

// ---- 1. the pure pieces --------------------------------------------------------------------------------------------------------------------
await test('topic: fits the rule, plain ids stay readable, odd ids are hashed, no collisions', () => {
  const RULE = /^[a-z0-9._-]{1,40}$/;
  const ids = ['abc', 'doc12345', 'a'.repeat(30), 'a'.repeat(31), 'A', 'Abc', 'a.b', 'a b', 'é', '日本語', 'x', 'ydoc', '..', 'a'.repeat(200), '__proto__', 'constructor', 'a/b', 'a\u0000b', '0'];
  const seen = new Map();
  for (const id of ids) {
    const t = L.dlSyncTopic(id);
    assert.ok(RULE.test(t), `${JSON.stringify(id)} -> ${t}`);
    assert.ok(!seen.has(t), `${JSON.stringify(id)} and ${JSON.stringify(seen.get(t))} share ${t}`);
    seen.set(t, id);
  }
  assert.equal(L.dlSyncTopic('doc12345'), 'ydoc.doc12345');
  assert.equal(L.dlSyncTopic(''), ''); assert.equal(L.dlSyncTopic(null), ''); assert.equal(L.dlSyncTopic(7), '');
  // 20,000 random ids of every length: all fit, no two distinct ids share a topic
  let s = 7; const r = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const alpha = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456789-_. é日';
  const all = new Map();
  for (let i = 0; i < 20000; i += 1) {
    let id = ''; const n = 1 + Math.floor(r() * 45);
    for (let k = 0; k < n; k += 1) id += alpha[Math.floor(r() * alpha.length)];
    const t = L.dlSyncTopic(id);
    assert.ok(RULE.test(t), `${id} -> ${t}`);
    if (all.has(t)) assert.equal(all.get(t), id, `collision ${t}`);
    all.set(t, id);
  }
  facts.push(`topics: 20,000 random ids, ${all.size} distinct topics, 0 collisions`);
});
await test('base64 and the vector reader', () => {
  const bytes = new Uint8Array(70000).map((_, i) => (i * 31) & 255);
  assert.deepEqual(Array.from(L.dlSyncUnb64(L.dlSyncB64(bytes))), Array.from(bytes));
  for (const bad of ['a', 'abc', '@@@@', 'AAAA====', 'AA=A', 5, null, {}, 'A'.repeat(100000)]) assert.equal(L.dlSyncUnb64(bad, 100), null, String(bad).slice(0, 10));
  const d = new PM.Doc(); L.dlSyncSeed(PM, d, pmDoc(), ID, TEXT);
  const v = PM.encodeStateVector(d);
  const map = L.dlSyncVector(v);
  assert.ok(map && map.size === 1);
  assert.equal(L.dlSyncVector(v.subarray(0, v.length - 1)), null);
  assert.equal(L.dlSyncVector(new Uint8Array([200, 1])), null);
  assert.equal(L.dlSyncVector(new Uint8Array([2, 1, 1, 1, 1])), null, 'a writer twice');
  assert.equal(L.dlSyncVector(new Uint8Array([1, 1, 1, 9])), null, 'trailing bytes');
  assert.equal(L.dlSyncHasMore(new Map([[1, 5]]), new Map([[1, 5]])), false);
  assert.equal(L.dlSyncHasMore(new Map([[1, 6]]), new Map([[1, 5]])), true);
  assert.equal(L.dlSyncHasMore(new Map([[2, 1]]), new Map([[1, 5]])), true);
  assert.equal(L.dlSyncVector(PM.encodeStateVector(new PM.Doc())).size, 0);
});
await test('the message cleaner takes the four shapes and nothing else', () => {
  const c = (d) => L.dlSyncClean(d);
  assert.equal(c({ u: 'AAAA' }).t, 'u');
  assert.equal(c({ v: 'AAAA' }).t, 'v');
  assert.deepEqual([c({ v: 'AAAA', e: 0, a: 3 }).editor, c({ v: 'AAAA', e: 0, a: 3 }).admitted], [false, 3]);
  assert.equal(c({ k: 'abcd1234', i: 0, n: 2, c: 'AAAA' }).t, 'k');
  assert.equal(c({ x: 1 }).t, 'x');
  const bad = [null, undefined, 5, 'x', [], {}, { u: 5 }, { u: 'A'.repeat(5000) }, { u: 'AAAA', from: 'someone' }, { u: 'AAAA', v: 'AAAA' }, { v: 'AAAA', e: 2 }, { v: 'AAAA', a: -1 }, { v: 'AAAA', a: 1.5 }, { v: 'AAAA', who: 'x' },
    { k: 'abcd', i: 0, n: 0, c: 'AAAA' }, { k: 'abcd', i: 2, n: 2, c: 'AAAA' }, { k: 'abcd', i: 0, n: 100000, c: 'AAAA' }, { k: 'AB', i: 0, n: 1, c: 'AAAA' }, { k: 'abcd', i: 0, n: 1 }, { x: 2 }, { x: 1, u: 'AAAA' }, { k: 'abcd1234', i: 0, n: 1, c: 'AAAA', extra: 1 }, JSON.parse('{"__proto__":{"u":"AAAA"}}'), { toString: 1 }];
  for (const d of bad) assert.equal(c(d), null, String(JSON.stringify(d)).slice(0, 60));
});
await test('the roster: the cap and the order of a crowd', () => {
  const clock = new Clock();
  const r = L.dlSyncRoster({ now: () => clock.now() });
  for (let i = 0; i < 7; i += 1) r.hear(`p${i}`, { editor: true, admitted: i });
  assert.equal(r.admit(), true);
  r.hear('p7', { editor: true, admitted: 7 });
  assert.equal(r.admit(), false, '8 others: the 9th may not');
  // a 9th page and a 10th that joined at the same time (both counted 8 others): the one with the larger key is past the cap on every page
  const crowd = (me, mine) => { const x = L.dlSyncRoster({ now: () => clock.now() }); for (let i = 0; i < 7; i += 1) x.hear(`p${i}`, { editor: true, admitted: i }); x.hear(me === 'q1' ? 'q2' : 'q1', { editor: true, admitted: 7 }); return x.past(me, mine); };
  assert.equal(crowd('q1', 7), false); assert.equal(crowd('q2', 7), true);
  // eight older editors and two newcomers: both newcomers are past; an older editor never is
  const older = (me, mine) => { const x = L.dlSyncRoster({ now: () => clock.now() }); for (let i = 0; i < 8; i += 1) if (`p${i}` !== me) x.hear(`p${i}`, { editor: true, admitted: i }); x.hear('q1', { editor: true, admitted: 8 }); x.hear('q2', { editor: true, admitted: 8 }); return x.past(me, mine); };
  assert.equal(older('q1', 8), true); assert.equal(older('q2', 8), true);
  for (let i = 0; i < 8; i += 1) assert.equal(older(`p${i}`, i), false, `p${i}`);
  const x = L.dlSyncRoster({ now: () => clock.now() }); for (let i = 0; i < 8; i += 1) x.hear(`p${i}`, { editor: true, admitted: i });
  for (let i = 0; i < 8; i += 1) assert.equal(x.past(`p${i}`, i), i === 99, 'with 8 in all nobody is past');
  // someone not heard for presenceMs is gone; a person who left the module is gone; a reader (editor: false) is not counted
  clock.t += 41000; assert.equal(r.others().length, 0);
  r.hear('a', { editor: true, admitted: 0 }); r.hear('b', { editor: false, admitted: 0 }); assert.deepEqual(r.others().map((p) => p.key), ['a']);
  r.people(['b']); assert.equal(r.others().length, 0);
  assert.equal(L.dlSyncFullNote(8), 'Eight people are editing. You can read along.');
});

// ---- 2. the switch and the manifest ---------------------------------------------------------------------------------------------------
await test('the switch: on only for a real true', () => {
  assert.equal(L.dlSyncEnabled({ coediting: true }), true);
  for (const v of [undefined, null, {}, { coediting: false }, { coediting: 'true' }, { coediting: 1 }, { coediting: 'on' }, [], 'coediting', { Coediting: true }]) assert.equal(L.dlSyncEnabled(v), false, JSON.stringify(v));
});
await test('module.json: the live limits agree with the code and the setting is declared', () => {
  const m = JSON.parse(fs.readFileSync(path.join(src, '../module.json'), 'utf8'));
  assert.equal(m.live.bytes, L.DL_SYNC.messageBytes);
  assert.equal(m.live.perSecond, 30);
  const { cleanLive } = createRequire(import.meta.url)(path.join(root, 'server/modules.js'));
  const out = cleanLive(m.live, m.scope, m.permissions);
  assert.equal(out.bytes, 2048); assert.equal(out.perSecond, 30);
  const s = (m.settings || []).find((x) => x.key === 'coediting');
  assert.ok(s && s.type === 'boolean' && s.default === false && s.scope === 'environment', 'the switch is an owner setting, off by default');
  // the page reads the setting and touches nothing live without it: every use of the channel in documents.js sits behind coediting
  const page = fs.readFileSync(path.join(src, 'documents.js'), 'utf8');
  const uses = [...page.matchAll(/host\.live|dlSyncSession\(|dlSyncSeed\(|DlPM\.Doc\(\)/g)].map((x) => page.slice(0, x.index).split('\n').length);
  assert.ok(uses.length > 0 && uses.length < 12, `uses: ${uses.join(',')}`);
  const entry = page.indexOf('if (coediting && canEdit && host.live) { openCoEditor(id)');
  assert.ok(entry > 0, 'the one door into the shared editor is behind the switch');
  const code = page.split('\n').map((l) => l.replace(/\/\/.*$/, '').replace('coediting && canEdit && host.live', '')).join('\n');
  const firstUse = code.search(/host\.live|dlSyncSession\(|dlSyncSeed\(/);
  const fn = code.indexOf('async function openCoEditor');
  assert.ok(firstUse > fn, 'no use of the channel before the shared editor opens');
  assert.equal([...page.matchAll(/openCoEditor\(/g)].length, 2, 'openCoEditor is called once (and defined once)');
});

// ---- 3. sessions on the bus ------------------------------------------------------------------------------------------------------------
await test('two pages: the first seeds, the second takes the state; typing converges; bytes per typed character', async () => {
  const clock = new Clock(); const bus = new Bus(clock);
  const a = page(bus, clock, 'aaaa1111');
  await run(clock, bus, 100);
  assert.equal(a.how(), 'alone');
  const b = page(bus, clock, 'bbbb2222');
  await run(clock, bus, 600);
  assert.equal(b.how(), 'state', 'the second page took the first one\'s state');
  assert.ok(same(a, b));
  assert.equal(textOf(a.doc()).split('Alpha one.').length, 2, 'the text is there once');
  const before = bus.log.length;
  for (const ch of 'hello world') { typeAt(a.doc(), 0, ch); await run(clock, bus, 60); }
  assert.ok(same(a, b), 'b reads what a typed');
  const edits = bus.log.slice(before).filter((x) => x.kind === 'u');
  const bytes = edits.map((x) => x.bytes);
  assert.equal(edits.length, 11, 'one message per typed character');
  assert.ok(Math.max(...bytes) < 120, `a typed character is ${Math.max(...bytes)} bytes`);
  facts.push(`typing: ${edits.length} characters, ${edits.length} messages, ${Math.min(...bytes)} to ${Math.max(...bytes)} bytes of data each (mean ${Math.round(bytes.reduce((x, y) => x + y, 0) / bytes.length)})`);
  typeAt(b.doc(), 1, ' and more'); await run(clock, bus, 100);
  assert.ok(same(a, b));
  assert.equal(a.session.stats().refused, 0); assert.equal(b.session.stats().refused, 0);
});
await test('typing between sends is merged into one message (no update waits behind another)', async () => {
  const clock = new Clock(); const bus = new Bus(clock);
  const a = page(bus, clock, 'aaaa1111'); await run(clock, bus, 50); const b = page(bus, clock, 'bbbb2222'); await run(clock, bus, 600);
  const before = bus.log.length;
  for (let i = 0; i < 40; i += 1) typeAt(a.doc(), 0, 'x'); // 40 edits with no time between
  await run(clock, bus, 100);
  const edits = bus.log.slice(before).filter((x) => x.kind === 'u');
  assert.ok(edits.length <= 2, `${edits.length} messages for 40 edits in one tick`);
  assert.ok(same(a, b));
});
await test('three pages typing in one paragraph and in different blocks converge', async () => {
  const clock = new Clock(); const bus = new Bus(clock);
  const a = page(bus, clock, 'aaaa1111'); await run(clock, bus, 50);
  const b = page(bus, clock, 'bbbb2222'); const c = page(bus, clock, 'cccc3333'); await run(clock, bus, 800);
  assert.ok(same(a, b, c));
  for (let i = 0; i < 20; i += 1) { typeAt(a.doc(), 0, 'a', 2); typeAt(b.doc(), 0, 'b', 4); typeAt(c.doc(), 1, 'c'); await run(clock, bus, 40); }
  await run(clock, bus, 300);
  assert.ok(same(a, b, c), 'converged');
  assert.ok(textOf(a.doc()).includes('c'.repeat(20)));
});
await test('a dropped message is repaired by the vector exchange; the latency in virtual ms', async () => {
  const lat = [];
  for (const [label, drop] of [['dropped, more messages follow', true], ['dropped, gap repair off: only the 15 s beat', false]]) {
    const clock = new Clock(); const bus = new Bus(clock);
    // the second case turns the gap and quiet repairs off (one vector a year), so only the beat is left: the bound
    const cfg = drop ? undefined : { gapMinMs: 3.1e10 };
    const a = page(bus, clock, 'aaaa1111', { config: cfg }); await run(clock, bus, 50); const b = page(bus, clock, 'bbbb2222', { config: cfg }); await run(clock, bus, 3000); // the start-up traffic is over
    let n = 0;
    bus.drop = (m) => { if (m.data.u && m.from.key === 'aaaa1111' && n === 0 && (n += 1)) return true; return false; };
    typeAt(a.doc(), 0, 'X'); await run(clock, bus, 60);
    assert.notEqual(textOf(a.doc()), textOf(b.doc()), 'the message was lost');
    const t = clock.t; 
    if (drop) typeAt(a.doc(), 0, 'Y'); // the next message shows the gap
    let at = -1;
    for (let i = 0; i < 400 && at < 0; i += 1) { await run(clock, bus, 50); if (same(a, b)) at = clock.t - t; }
    assert.ok(at >= 0, `${label}: not repaired`);
    lat.push(`${label}: ${at} ms`);
    if (drop) assert.ok(at < 1500, `${at} ms`); else assert.ok(at <= 16000, `${at} ms`);
    assert.ok(a.session.stats().gaps + b.session.stats().gaps >= (drop ? 1 : 0));
  }
  facts.push(`repair after a drop (virtual clock): ${lat.join('; ')}`);
});
await test('duplicated, reordered and 25 percent dropped messages: pages converge after the exchange', async () => {
  const clock = new Clock(); const bus = new Bus(clock);
  const ps = ['aaaa1111', 'bbbb2222', 'cccc3333', 'dddd4444'].map((k) => page(bus, clock, k));
  await run(clock, bus, 1500);
  let s = 99; const r = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  bus.drop = () => r() < 0.25; bus.dup = () => r() < 0.1;
  for (let i = 0; i < 60; i += 1) { typeAt(ps[i % 4].doc(), i % 2, String.fromCharCode(97 + (i % 26))); await run(clock, bus, 30); }
  bus.drop = () => false;
  await run(clock, bus, 20000);
  assert.ok(same(...ps), 'converged');
  facts.push(`25% dropped, 10% duplicated, 4 pages, 60 edits: converged after the exchange (${ps.map((p) => p.session.stats().vectorsOut).join('/')} vectors sent)`);
});
await test('an edit too big for a message goes as the difference in pieces, paced', async () => {
  const clock = new Clock(); const bus = new Bus(clock);
  const a = page(bus, clock, 'aaaa1111'); await run(clock, bus, 50); const b = page(bus, clock, 'bbbb2222'); await run(clock, bus, 800);
  const before = bus.log.length;
  const big = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} of a long paste, with some more words to make it heavier.`).join('\n\n');
  const pm = L.dlRichRead(PM, big, lex).doc;
  a.doc().transact(() => { PM.prosemirrorToYXmlFragment(pm, a.doc().getXmlFragment(FRAG)); }, 'paste');
  await run(clock, bus, 6000);
  const sent = bus.log.slice(before);
  const pieces = sent.filter((x) => x.kind === 'kink'.slice(0, 0) + 'kink'.slice(0, 0) || /^k/.test(x.kind) || x.kind === 'kink');
  assert.ok(same(a, b), 'b has the paste');
  assert.equal(a.session.stats().big >= 1, true);
  const pcs = sent.filter((x) => x.kind === 'kink' || x.kind.startsWith('k'));
  assert.ok(pcs.length > 5, `${pcs.length} pieces`);
  assert.ok(Math.max(...sent.map((x) => x.bytes)) <= 2048);
  assert.equal(b.session.stats().assembled >= 1, true);
  facts.push(`big edit (${PM.encodeStateAsUpdate(a.doc()).length} B of state): ${pcs.length} pieces, largest message ${Math.max(...sent.map((x) => x.bytes))} B; the other page assembled ${b.session.stats().assembled}`);
  void pieces;
});
await test('a server that allows fewer bytes than the manifest: the pieces get smaller (413), nothing is lost', async () => {
  const clock = new Clock(); const bus = new Bus(clock, { bytes: 700 });
  const a = page(bus, clock, 'aaaa1111'); await run(clock, bus, 50); const b = page(bus, clock, 'bbbb2222'); await run(clock, bus, 3000);
  const big = Array.from({ length: 80 }, (_, i) => `Line ${i} with some words in it.`).join('\n\n');
  a.doc().transact(() => { PM.prosemirrorToYXmlFragment(L.dlRichRead(PM, big, lex).doc, a.doc().getXmlFragment(FRAG)); }, 'paste');
  await run(clock, bus, 30000);
  assert.ok(same(a, b), 'b has it');
  assert.ok(a.session.stats().resized + b.session.stats().resized >= 1, 'a message was refused as too big and the size came down');
});
await test('the channel down: both pages stay editable; on return the vectors merge both sides', async () => {
  const clock = new Clock(); const bus = new Bus(clock);
  const a = page(bus, clock, 'aaaa1111'); await run(clock, bus, 50); const b = page(bus, clock, 'bbbb2222'); await run(clock, bus, 800);
  bus.members.get('aaaa1111').state = 'closed'; bus.members.get('bbbb2222').state = 'closed';
  for (let i = 0; i < 5; i += 1) { typeAt(a.doc(), 0, 'A'); typeAt(b.doc(), 1, 'B'); await run(clock, bus, 100); }
  assert.ok(!same(a, b));
  assert.ok(textOf(a.doc()).includes('AAAAA') && textOf(b.doc()).includes('BBBBB'), 'edits stayed in the documents');
  bus.members.get('aaaa1111').state = 'open'; bus.members.get('bbbb2222').state = 'open';
  a.session.reconnected(); b.session.reconnected();
  await run(clock, bus, 3000);
  assert.ok(same(a, b), 'merged');
  const t = textOf(a.doc());
  assert.ok(t.includes('AAAAA') && t.includes('BBBBB'), 'nothing lost on either side');
  facts.push('offline merge (channel down both ways, 5 edits each, back): both kept all 10 edits, texts equal');
});
await test('undo is per person: yUndo of one page does not take the other page\'s text', async () => {
  // the stand-in view with the shared plugins: two views, two people, undo on one
  const schema = G.schema;
  const make = (doc) => {
    const frag = doc.getXmlFragment(FRAG);
    const state = PM.EditorState.create({ schema, plugins: G.plugins(frag, { base: [] }) });
    const view = { state, vs: [], hasFocus: () => false, dispatch(tr) { const prev = this.state; this.state = prev.apply(tr); for (const v of this.vs) if (v && v.update) v.update(this, prev); } };
    view.vs = state.plugins.map((p) => (p.spec.view ? p.spec.view(view) : null));
    return view;
  };
  const da = new PM.Doc(); const db = new PM.Doc();
  L.dlSyncSeed(PM, da, pmDoc(), ID, TEXT); PM.applyUpdate(db, PM.encodeStateAsUpdate(da));
  const va = make(da); const vb = make(db);
  da.on('update', (u, o) => { if (o !== 'net') PM.applyUpdate(db, u, 'net'); }); db.on('update', (u, o) => { if (o !== 'net') PM.applyUpdate(da, u, 'net'); });
  va.dispatch(va.state.tr.insertText('AAA', 2)); vb.dispatch(vb.state.tr.insertText('BBB', vb.state.doc.content.size - 3));
  assert.ok(va.state.doc.textContent.includes('AAA') && va.state.doc.textContent.includes('BBB'));
  assert.equal(PM.yUndo(va.state), true);
  assert.ok(!va.state.doc.textContent.includes('AAA'), 'a undid a');
  assert.ok(va.state.doc.textContent.includes('BBB'), 'a\'s undo left b\'s text');
  assert.ok(vb.state.doc.textContent.includes('BBB') && !vb.state.doc.textContent.includes('AAA'));
  assert.equal(PM.yRedo(va.state), true);
  assert.ok(va.state.doc.textContent.includes('AAA') && vb.state.doc.textContent.includes('AAA'));
  // the plugin list has no history and no appendTransaction of the grid
  const names = G.plugins(da.getXmlFragment(FRAG), { base: [] }).map((p) => String((p.spec.key && p.spec.key.key) || p.key));
  assert.ok(!names.some((n) => n.startsWith('history')));
});

// ---- 4. hostile and odd messages ---------------------------------------------------------------------------------------------------------
await test('hostile and odd messages are dropped and counted; a person named in the data is not a sender', async () => {
  const clock = new Clock(); const bus = new Bus(clock);
  const a = page(bus, clock, 'aaaa1111'); await run(clock, bus, 50); const b = page(bus, clock, 'bbbb2222'); await run(clock, bus, 800);
  const topic = L.dlSyncTopic(ID);
  const rogue = bus.connect('eeee5555');
  const before = textOf(a.doc());
  const bad = [{ u: 'not base64!' }, { u: 'AAAA' }, { u: L.dlSyncB64(new Uint8Array([1, 2, 3, 4, 5, 6])) }, { v: 'AAAA' }, { v: L.dlSyncB64(new Uint8Array([200, 1, 1])) }, { u: 'AAAA', from: 'aaaa1111' }, { from: 'aaaa1111', u: 'AAAA' },
    { k: 'abcd1234', i: 0, n: 2, c: '@@@@' }, { x: 5 }, 'a string', 12, [1, 2], { u: 'A'.repeat(3000) }];
  // a top-level text (the update that poisons a library alone)
  const poison = new PM.Doc(); poison.getXmlFragment(FRAG).insert(0, [new PM.XmlText('x')]); bad.push({ u: L.dlSyncB64(PM.encodeStateAsUpdate(poison)) });
  for (const d of bad) rogue.live.publish(topic, typeof d === 'object' && d !== null ? d : { z: d }).catch(() => {}); // the stand-in refuses what is over its size
  await run(clock, bus, 200);
  assert.equal(textOf(a.doc()), before, 'nothing was applied');
  const st = a.session.stats();
  assert.ok(st.bad + st.refused > 5, `dropped and counted: bad ${st.bad} refused ${st.refused}`);
  assert.ok(Object.keys(st.reasons).length > 0);
  facts.push(`hostile messages: ${bad.length} sent, ${st.bad} not messages, ${st.refused} refused by the gate (${Object.entries(st.reasons).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  // the sender the gate counts is the transport's: five bad updates from the rogue flag the rogue and not a
  const g = a.session.stats().guard;
  assert.ok(g.senders >= 1 && g.senders <= 2);
  assert.ok(same(a, b));
  // and a still works with b
  typeAt(a.doc(), 0, 'ok'); await run(clock, bus, 100); assert.ok(same(a, b));
});
await test('the quiet period: after a flood of refused updates the page asks for the state again', async () => {
  const clock = new Clock(); const bus = new Bus(clock);
  const a = page(bus, clock, 'aaaa1111'); await run(clock, bus, 50); const b = page(bus, clock, 'bbbb2222'); await run(clock, bus, 800);
  const poison = new PM.Doc(); poison.getXmlFragment(FRAG).insert(0, [new PM.XmlText('x')]);
  const hostile = { u: L.dlSyncB64(PM.encodeStateAsUpdate(poison)) };
  for (let i = 0; i < 90; i += 1) { const rogue = bus.connect(`rogue${String(i).padStart(4, '0')}`); for (let k = 0; k < 2; k += 1) rogue.live.publish(L.dlSyncTopic(ID), hostile); } // many senders: no one is flagged first, the page-wide budget is what trips
  await run(clock, bus, 300);
  const s1 = a.session.stats();
  assert.ok(s1.guard.quietEntered >= 1 && s1.quiet > 0, 'the page went quiet');
  const v0 = s1.vectorsOut;
  await run(clock, bus, 2500);
  assert.ok(a.session.stats().vectorsOut > v0, 'a vector went out after the quiet period');
  typeAt(b.doc(), 0, 'after'); await run(clock, bus, 200);
  assert.ok(same(a, b), 'the page works again');
});
await test('an honest typist during a quiet period: dropped as quiet, a vector goes to them afterwards, nobody honest is flagged', async () => {
  const clock = new Clock(); const bus = new Bus(clock);
  const a = page(bus, clock, 'aaaa1111'); await run(clock, bus, 50); const b = page(bus, clock, 'bbbb2222'); await run(clock, bus, 3000);
  const poison = new PM.Doc(); poison.getXmlFragment(FRAG).insert(0, [new PM.XmlText('x')]);
  const hostile = { u: L.dlSyncB64(PM.encodeStateAsUpdate(poison)) };
  for (let i = 0; i < 90; i += 1) { const rogue = bus.connect(`rogue${String(i).padStart(4, '0')}`); for (let k = 0; k < 2; k += 1) rogue.live.publish(L.dlSyncTopic(ID), hostile); }
  for (let i = 0; i < 6; i += 1) { typeAt(b.doc(), 0, String(i)); await run(clock, bus, 40); } // b types honestly while a is quiet
  await run(clock, bus, 300);
  assert.ok(a.session.stats().quiet > 0, 'a dropped some of it as quiet');
  assert.ok(!same(a, b), 'a missed b\'s typing');
  const v0 = b.session.stats().answers;
  await run(clock, bus, 4000);
  assert.ok(same(a, b), 'the vector after the quiet period brought it back');
  assert.ok(b.session.stats().answers > v0, 'b answered a vector');
  typeAt(b.doc(), 0, 'more'); await run(clock, bus, 200); assert.ok(same(a, b), 'and b is not flagged: its next typing arrives');
  assert.equal(a.session.stats().reasons.sender_flagged || 0, 0, 'no honest sender was flagged');
});
await test('a message with no sender from the transport is the one shared sender "unknown", and is flagged after three refusals', async () => {
  const clock = new Clock(); const bus = new Bus(clock);
  const a = page(bus, clock, 'aaaa1111'); await run(clock, bus, 50); const b = page(bus, clock, 'bbbb2222'); await run(clock, bus, 3000);
  const fn = bus.members.get('aaaa1111').subs.get(L.dlSyncTopic(ID));
  const poison = new PM.Doc(); poison.getXmlFragment(FRAG).insert(0, [new PM.XmlText('x')]);
  const hostile = { u: L.dlSyncB64(PM.encodeStateAsUpdate(poison)) };
  for (const from of [undefined, null, {}, { key: 5 }, { key: '' }, 'aaaa1111']) fn({ ...hostile }, from, { seq: 9999, topic: 'x' });
  const st = a.session.stats();
  assert.ok((st.reasons.top_level_text || 0) >= 3 && (st.reasons.sender_flagged || 0) >= 1, JSON.stringify(st.reasons));
  typeAt(b.doc(), 0, 'fine'); await run(clock, bus, 200); assert.ok(same(a, b), 'honest senders are not touched by the unknown one');
});
await test('a poisoned live document is rebuilt from the last good state, and the others give back what came after', async () => {
  const clock = new Clock(); const bus = new Bus(clock);
  const a = page(bus, clock, 'aaaa1111'); await run(clock, bus, 50); const b = page(bus, clock, 'bbbb2222'); await run(clock, bus, 800);
  typeAt(b.doc(), 0, 'kept'); await run(clock, bus, 100);
  await run(clock, bus, 16000); // a beat: the good state is taken
  typeAt(b.doc(), 0, 'later'); await run(clock, bus, 100);
  assert.ok(same(a, b));
  const oldDoc = a.session.doc();
  a.session.rebuild('test');
  assert.notEqual(a.session.doc(), oldDoc, 'a new document');
  assert.equal(a.rebuilt, 1);
  assert.ok(!textOf(a.session.doc()).includes('later'), 'the rebuilt state is the last good one');
  await run(clock, bus, 2000);
  assert.ok(same(a, b), 'the exchange gave back what came after');
  typeAt(a.session.doc(), 0, 'again'); await run(clock, bus, 100); assert.ok(same(a, b));
});

// ---- 5. the join and the cap -------------------------------------------------------------------------------------------------------------
await test('two pages that open the same text at once do not double it', async () => {
  const clock = new Clock(); const bus = new Bus(clock);
  const a = page(bus, clock, 'aaaa1111'); const b = page(bus, clock, 'bbbb2222'); const c = page(bus, clock, 'cccc3333');
  await run(clock, bus, 4000);
  assert.ok(same(a, b, c));
  assert.equal(textOf(a.doc()).split('Alpha one.').length, 2, 'the text is there once');
  assert.equal(textOf(a.doc()), textOf(c.doc()));
});
await test('the seed is the same bytes on every page that reads the same text, and differs for another text', () => {
  const mk = (id, text) => { const d = new PM.Doc(); L.dlSyncSeed(PM, d, L.dlRichRead(PM, text, lex).doc, id, text); return Buffer.from(PM.encodeStateAsUpdate(d)); };
  assert.ok(mk(ID, TEXT).equals(mk(ID, TEXT)));
  assert.ok(!mk(ID, TEXT).equals(mk(ID, `${TEXT}\nMore.\n`)));
  assert.ok(!mk(ID, TEXT).equals(mk('other', TEXT)));
  const d = new PM.Doc(); const id0 = d.clientID; L.dlSyncSeed(PM, d, pmDoc(), ID, TEXT); assert.equal(d.clientID, id0, 'the writer id is put back');
});
await test('the ninth page cannot join as an editor; when one leaves it can', async () => {
  const clock = new Clock(); const bus = new Bus(clock);
  const ps = [];
  for (let i = 0; i < 9; i += 1) { const p = page(bus, clock, `p${i}aaaa`); ps.push(p); await run(clock, bus, 1500); }
  const ninth = ps[8];
  assert.equal(ninth.session.roster.admit(), false, 'eight others are editing');
  assert.equal(ps[7].session.roster.admit(), true, 'the eighth saw seven');
  assert.ok(ps.slice(0, 8).every((p) => !p.session.roster.past(p.key, p.session.admitted())));
  bus.disconnect('p2aaaa');
  await run(clock, bus, 100);
  assert.equal(ninth.session.roster.admit(), true, 'a seat is free');
  // a reader never publishes
  const r = page(bus, clock, 'rrrr9999'); r.session.setEditor(false); await run(clock, bus, 1500);
  const before = bus.log.length;
  typeAt(r.doc(), 0, 'nope'); await run(clock, bus, 200);
  assert.equal(bus.log.slice(before).filter((x) => x.kind === 'u').length, 0, 'no edit from a page that is not an editor');
});
await test('stop: says goodbye, drops its timers, and is quiet after', async () => {
  const clock = new Clock(); const bus = new Bus(clock);
  const a = page(bus, clock, 'aaaa1111'); await run(clock, bus, 50); const b = page(bus, clock, 'bbbb2222'); await run(clock, bus, 800);
  assert.equal(b.session.roster.others().length, 1);
  a.session.stop(); await run(clock, bus, 100);
  assert.equal(b.session.roster.others().length, 0, 'the goodbye took a out of the roster');
  const n = bus.log.length; typeAt(a.doc(), 0, 'x'); await run(clock, bus, 20000);
  assert.equal(bus.log.slice(n).filter((x) => x.from === 'aaaa1111').length, 0, 'a stopped page sends nothing');
});

// ---- 6. the join never seeds beside a state that may be on its way; the pieces of one sender cannot starve another's -------------------------------
const bigText = (n) => Array.from({ length: n }, (_, i) => `Paragraph ${i} of a long document, with some more words in it to make it heavier.`).join('\n\n');
const fragLen = (d) => d.getXmlFragment(FRAG).length;
const ghostVector = () => { const d = new PM.Doc(); L.dlSyncSeed(PM, d, pmDoc(), ID, TEXT); return L.dlSyncB64(PM.encodeStateVector(d)); };
const fake = (rogue, id, i = 899) => { rogue.live.publish(L.dlSyncTopic(ID), { k: id, i, n: 900, c: 'AAAA' }).catch(() => {}); };
await test('a joiner takes a big state that arrives in more than 60 paced pieces (30 messages a second) and does not double it', async () => {
  const lens = [];
  for (const paras of [900, 1500]) {
    const clock = new Clock(); const bus = new Bus(clock, { paceMs: 33 });
    const a = page(bus, clock, 'aaaa1111', { text: 'Ann saved this.\n' }); await run(clock, bus, 100);
    assert.equal(a.how(), 'alone');
    a.doc().transact(() => { PM.prosemirrorToYXmlFragment(L.dlRichRead(PM, bigText(paras), lex).doc, a.doc().getXmlFragment(FRAG)); }, 'paste');
    await run(clock, bus, 4000);
    const before = bus.log.length;
    const t0 = clock.t;
    const b = page(bus, clock, 'bbbb2222', { text: 'Ben saved something else.\n' }); // the saved text differs from Ann's seed: a second seed would show
    for (let i = 0; i < 4000 && !b.how(); i += 1) await run(clock, bus, 20);
    const sentPieces = bus.log.slice(before).filter((x) => x.from === 'aaaa1111' && x.kind.startsWith('k')).length;
    assert.ok(sentPieces > 60, `${sentPieces} pieces`);
    assert.equal(b.how(), 'state', `joined by ${b.how()}`);
    assert.ok(b.at - t0 > cfgJoinWait(), `the join took ${b.at - t0} ms, longer than the old fixed wait`);
    await run(clock, bus, 3000);
    assert.equal(textOf(b.doc()), textOf(a.doc()), 'Ben ends with exactly Ann\'s text');
    assert.ok(!textOf(b.doc()).includes('Ben saved'), 'no second seed');
    assert.equal(fragLen(b.doc()), fragLen(a.doc()));
    assert.equal(b.session.stats().assembled >= 1, true);
    lens.push(`${paras} paragraphs: ${sentPieces} pieces, joined by state in ${b.at - t0} virtual ms, both ${textOf(a.doc()).length} characters`);
  }
  facts.push(`joiner on a 30-messages-per-second bus: ${lens.join('; ')}`);
});
function cfgJoinWait() { return L.DL_SYNC.joinWaitMs; }
await test('a joiner that is really alone seeds after the short wait', async () => {
  const clock = new Clock(); const bus = new Bus(clock);
  const b = page(bus, clock, 'bbbb2222'); await run(clock, bus, 3000);
  assert.ok(['alone', 'timeout'].includes(b.how()), String(b.how()));
  assert.ok(b.at - 1000 <= L.DL_SYNC.joinWaitMs + 50, `${b.at - 1000} ms`);
  assert.equal(textOf(b.doc()).split('Alpha one.').length, 2);
  // someone at the module who never speaks about this document is not a peer: still seeds at the short wait
  const clock2 = new Clock(); const bus2 = new Bus(clock2);
  bus2.connect('silent01');
  const c = page(bus2, clock2, 'cccc3333'); await run(clock2, bus2, 3000);
  assert.equal(c.how(), 'timeout'); assert.equal(textOf(c.doc()).split('Alpha one.').length, 2);
});
await test('a peer that is heard but never gives its state: the joiner stays read-only, does not seed, and keeps asking', async () => {
  const clock = new Clock(); const bus = new Bus(clock);
  const ghost = bus.connect('ghost000');
  const topic = L.dlSyncTopic(ID);
  const beat = () => { ghost.live.publish(topic, { v: ghostVector(), e: 1, a: 0 }).catch(() => {}); clock.set(beat, 10000); };
  clock.set(beat, 300);
  const b = page(bus, clock, 'bbbb2222');
  await run(clock, bus, 70000, 20);
  assert.equal(b.how(), null, 'still joining after 70 s');
  assert.equal(fragLen(b.doc()), 0, 'nothing was seeded');
  assert.equal(b.session.stats().joinedBy, undefined);
  const asks = bus.log.filter((x) => x.from === 'bbbb2222' && x.kind.startsWith('v')).length;
  assert.ok(asks >= 4, `${asks} vectors from the joiner in 70 s`);
  // when the state does come, it is taken and still not seeded
  const a = new PM.Doc(); L.dlSyncSeed(PM, a, pmDoc(), ID, TEXT);
  ghost.live.publish(topic, { u: L.dlSyncB64(PM.encodeStateAsUpdate(a)) }); await run(clock, bus, 1500, 20);
  assert.equal(b.how(), 'state'); assert.equal(textOf(b.doc()).split('Alpha one.').length, 2);
});
await test('a joiner seeds after the peer left, once nothing has come for the quiet window and the hard cap has passed', async () => {
  const out = [];
  for (const how of ['left', 'silent']) {
    const clock = new Clock(); const bus = new Bus(clock);
    const ghost = bus.connect('ghost000');
    const topic = L.dlSyncTopic(ID);
    clock.set(() => ghost.live.publish(topic, { v: ghostVector(), e: 1, a: 0 }).catch(() => {}), 300);
    const b = page(bus, clock, 'bbbb2222');
    await run(clock, bus, 2000, 20);
    if (how === 'left') { ghost.live.publish(topic, { x: 1 }).catch(() => {}); bus.disconnect('ghost000'); }
    const t0 = 1000;
    for (let i = 0; i < 4000 && !b.how(); i += 1) await run(clock, bus, 20);
    const took = b.at - t0;
    assert.equal(b.how(), 'timeout');
    assert.ok(took >= L.DL_SYNC.joinMaxMs, `not before the hard cap: ${took}`);
    if (how === 'left') assert.ok(took < L.DL_SYNC.joinMaxMs + 1500, `after the cap: ${took}`);
    else assert.ok(took <= L.DL_SYNC.presenceMs + L.DL_SYNC.joinQuietMs + 2000, `a peer that stopped answering counts as gone after the presence time: ${took}`);
    assert.equal(textOf(b.doc()).split('Alpha one.').length, 2, 'seeded once');
    out.push(`${how}: ${took} ms`);
  }
  facts.push(`joiner after a peer that gave no state (virtual): ${out.join('; ')}`);
});
await test('a joiner never seeds while pieces are still coming, even past the hard cap', async () => {
  const clock = new Clock(); const bus = new Bus(clock);
  const ghost = bus.connect('ghost000'); const topic = L.dlSyncTopic(ID);
  const b = page(bus, clock, 'bbbb2222', { config: { joinMaxMs: 3000, joinQuietMs: 1500 } });
  let n = 0;
  const drip = () => { ghost.live.publish(topic, { k: 'abcd0001', i: n % 400, n: 400, c: 'AAAA' }).catch(() => {}); n += 1; if (n < 300) clock.set(drip, 100); };
  clock.set(drip, 100); // a piece every 100 ms for 30 s, never completing
  await run(clock, bus, 25000, 20);
  assert.equal(b.how(), null); assert.equal(fragLen(b.doc()), 0);
});
await test('pieces of one sender cannot starve another: four made-up sets of 900, then an honest transfer of 28+ pieces completes', async () => {
  const clock = new Clock(); const bus = new Bus(clock);
  const a = page(bus, clock, 'aaaa1111'); await run(clock, bus, 50); const b = page(bus, clock, 'bbbb2222'); await run(clock, bus, 1500);
  const rogue = bus.connect('rogue001');
  for (let i = 1; i <= 4; i += 1) fake(rogue, `fake000${i}`);
  await run(clock, bus, 200);
  const st = b.session.stats();
  assert.equal(st.assembling, 2, 'the rogue holds two slots, not all');
  assert.equal(st.reasons.too_many_assemblies || 0, 0);
  const big = bigText(500);
  a.doc().transact(() => { PM.prosemirrorToYXmlFragment(L.dlRichRead(PM, big, lex).doc, a.doc().getXmlFragment(FRAG)); }, 'paste');
  await run(clock, bus, 6000);
  assert.ok(same(a, b), 'the honest transfer arrived');
  assert.ok(b.session.stats().assembled >= 1);
  assert.equal(b.session.stats().reasons.too_many_assemblies || 0, 0);
});
await test('an assembly that has stalled is dropped after its time and frees the slot', async () => {
  const clock = new Clock(); const bus = new Bus(clock);
  const a = page(bus, clock, 'aaaa1111'); await run(clock, bus, 50); const b = page(bus, clock, 'bbbb2222'); await run(clock, bus, 1500);
  const rogue = bus.connect('rogue001');
  fake(rogue, 'fake0001'); fake(rogue, 'fake0002'); await run(clock, bus, 200);
  assert.equal(b.session.stats().assembling, 2);
  const lost0 = b.session.stats().assemblyLost;
  await run(clock, bus, L.DL_SYNC.assemblyMs - 1000, 50);
  fake(rogue, 'fake0002', 898); await run(clock, bus, 200); // a new piece of the second set keeps that one alive
  await run(clock, bus, 2000, 50);
  fake(rogue, 'fake0003'); await run(clock, bus, 200);
  const st = b.session.stats();
  assert.ok(st.assemblyLost >= lost0 + 1, 'the stalled set was dropped');
  assert.equal(st.assembling, 2, 'the live set and the new one');
  await run(clock, bus, L.DL_SYNC.assemblyMs + 1000, 50);
  fake(rogue, 'fake0004'); await run(clock, bus, 200);
  assert.equal(b.session.stats().assembling, 1, 'both older sets expired');
});
await test('the caps: two assemblies per sender (the oldest goes), eight in all (the oldest of whoever holds most, another sender, goes)', async () => {
  const clock = new Clock(); const bus = new Bus(clock);
  const a = page(bus, clock, 'aaaa1111'); await run(clock, bus, 50); const b = page(bus, clock, 'bbbb2222'); await run(clock, bus, 1500);
  const one = bus.connect('rogue001');
  fake(one, 'fake0001'); fake(one, 'fake0002'); fake(one, 'fake0003'); await run(clock, bus, 200);
  let st = b.session.stats();
  assert.equal(st.assembling, 2); assert.equal(st.assemblyLost, 1);
  const rogues = [2, 3, 4, 5].map((i) => bus.connect(`rogue00${i}`));
  for (const r of rogues) { fake(r, 'fake0001'); fake(r, 'fake0002'); }
  await run(clock, bus, 300);
  st = b.session.stats();
  assert.equal(st.assembling, 8, 'eight at most');
  assert.equal(st.reasons.too_many_assemblies || 0, 0, 'a new sender is never turned away: a slot of the fullest is given');
  const sixth = bus.connect('rogue006'); fake(sixth, 'fake0001'); await run(clock, bus, 200);
  assert.equal(b.session.stats().assembling, 8);
  const big = bigText(400);
  a.doc().transact(() => { PM.prosemirrorToYXmlFragment(L.dlRichRead(PM, big, lex).doc, a.doc().getXmlFragment(FRAG)); }, 'paste');
  await run(clock, bus, 6000);
  assert.ok(same(a, b), 'an honest sender still gets through a full table');
  facts.push('assembly caps: 2 per sender, 8 in all, 30 s to expire; made-up pieces from 6 senders did not stop an honest transfer');
});

console.log(`documents coedit sync: ${passed} tests passed in ${((Date.now() - t0) / 1000).toFixed(1)} s${facts.length ? ` (${facts.join('; ')})` : ''}`);
if (fails.length) { console.error(`\n${fails.length} failed:\n- ${fails.join('\n- ')}`); process.exit(1); }
