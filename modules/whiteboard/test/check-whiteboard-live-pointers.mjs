#!/usr/bin/env node
/*
 * check-whiteboard-live-pointers.mjs -- other people's pointers on the Whiteboard (modules/whiteboard/src/whiteboard-lib-p-pointers.js).
 * Guards:
 *   - what is sent: whole board units, held to the range, the tool only when it is one of the board's own, always far
 *     under the 256 bytes a live message may be; nothing for a place that is not a number;
 *   - the sender: the first place at once, then at most one every 50 ms with the last place always sent, no timer while
 *     resting, one { gone: true } after a place went (never twice, never with nothing shown), a refusal or a throw from
 *     publish dropped quietly and never tried again; at most 20 a second under any amount of motion;
 *   - when the page sends: open, in sight, not presenting, over the board;
 *   - what is heard: only x, y, tool and gone are read, each checked; bad numbers, far places, __proto__ and
 *     constructor keys, a missing or odd sender, this person's own key, an unknown tool; the name cut to 24 characters,
 *     a guest marked; a colour only one of the eight;
 *   - the pointers kept: by key in a Map, the newest last, at most 50 (the oldest goes), dimmed after 5 s, gone after
 *     20 s, gone at once on { gone: true }, on a leave and when cleared; drawn only when shown and open;
 *   - the choice kept in the browser's storage: shown when there is none, and nothing thrown when storage throws.
 * It runs the module's own libs in one scope as the page has them (lib files in name order), with no page. No network.
 * Usage: node modules/whiteboard/test/check-whiteboard-live-pointers.mjs [path to the src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
const NAMES = ['WB_LIVE', 'wbLivePayload', 'wbLiveMaySend', 'createWbLiveSender', 'wbLiveRead', 'wbLiveLabel', 'createWbLiveStore', 'wbLiveDrawn',
  'wbLiveLoad', 'wbLiveSave', 'tools'];

let passed = 0;
const fails = [];
let L = {};
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-[a-z]-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  const grab = NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  L = new Function('window', 'document', `${parts.join('\n')}\nreturn { ${grab} };`)({ devicePixelRatio: 1 }, undefined);
} catch (err) {
  fails.push(`the libs do not load: ${err.message}`);
}
const missing = NAMES.filter((n) => typeof L[n] === 'undefined');
async function test(name, fn) {
  try {
    if (missing.length) throw new Error(`the libs have no ${missing.join(', ')}`);
    await fn();
    passed += 1;
  } catch (err) {
    fails.push(`${name}: ${err.message}`);
  }
}

// A clock and timers by hand: run(ms) moves time on and fires what is due, in order.
function fakeClock() {
  let t = 1000;
  let n = 0;
  const due = new Map();
  return {
    now: () => t,
    later: (fn, ms) => { n += 1; due.set(n, { at: t + Math.max(0, ms), fn }); return n; },
    cancel: (id) => { due.delete(id); },
    pending: () => due.size,
    run(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [id, d] of due) if (d.at <= end && (!next || d.at < next[1].at)) next = [id, d];
        if (!next) break;
        due.delete(next[0]);
        t = next[1].at;
        next[1].fn();
      }
      t = end;
    },
  };
}
function senderWith(clock, send) {
  return L.createWbLiveSender({ send, now: clock.now, later: clock.later, cancel: clock.cancel });
}
const tint = (k) => ({ ann1: 'blue', bob1: 'pink' }[k] || 'teal');

// ---- what is sent ---------------------------------------------------------------------------------------------------
await test('a place: whole board units, the tool when it is one of the board\'s', () => {
  assert.deepEqual(L.wbLivePayload({ x: 12.4, y: -7.6 }, 'pen'), { x: 12, y: -8, tool: 'pen' });
  assert.deepEqual(L.wbLivePayload({ x: 0.5, y: 3 }, 'nope'), { x: 1, y: 3 }, 'an unknown tool is left out');
  assert.deepEqual(L.wbLivePayload({ x: 1, y: 2 }, 'x'.repeat(30)), { x: 1, y: 2 });
  assert.deepEqual(L.wbLivePayload({ x: 5e9, y: -5e9 }, 'select'), { x: 1e6, y: -1e6, tool: 'select' }, 'held to the range');
  assert.equal(L.wbLivePayload({ x: NaN, y: 1 }, 'pen'), null);
  assert.equal(L.wbLivePayload({ x: 1, y: Infinity }, 'pen'), null);
  assert.equal(L.wbLivePayload({ x: '1', y: 1 }, 'pen'), null, 'a string is not a number');
  assert.equal(L.wbLivePayload(null, 'pen'), null);
});
await test('every message is far under 256 bytes', () => {
  let most = 0;
  for (const t of [...L.WB_LIVE.tools, null]) {
    for (const v of [-1e6, -123456.7, 0, 999999.9, 1e6, 5e12]) {
      const d = L.wbLivePayload({ x: v, y: v }, t);
      most = Math.max(most, JSON.stringify(d).length);
    }
  }
  most = Math.max(most, JSON.stringify({ gone: true }).length);
  assert.ok(most < 64, `the longest is ${most} bytes`);
});
await test('every tool on the board is one a pointer may name, and only those', () => {
  const ids = L.tools.list().map((t) => t.id);
  assert.ok(ids.length > 10);
  for (const id of ids) assert.ok(L.WB_LIVE.tools.includes(id), `${id} is missing from WB_LIVE.tools`);
  for (const id of L.WB_LIVE.tools) assert.ok(L.tools.get(id), `${id} is not a tool`);
  for (const id of L.WB_LIVE.tools) assert.ok(id.length <= 20);
});

// ---- the sender -----------------------------------------------------------------------------------------------------
await test('the first place goes at once; then one every 50 ms, the last one always', () => {
  const c = fakeClock();
  const sent = [];
  const s = senderWith(c, (d) => { sent.push({ at: c.now(), d }); });
  s.move({ x: 1, y: 1 });
  assert.equal(sent.length, 1, 'at once');
  s.move({ x: 2, y: 2 });
  s.move({ x: 3, y: 3 });
  assert.equal(sent.length, 1, 'waits for the gap');
  c.run(49);
  assert.equal(sent.length, 1);
  c.run(1);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].d, { x: 3, y: 3 }, 'only the newest waited');
  c.run(500);
  assert.equal(sent.length, 2, 'nothing more while resting');
  assert.equal(c.pending(), 0, 'no timer while resting');
  assert.equal(s.busy, false);
  s.move({ x: 4, y: 4 });
  assert.equal(sent.length, 3, 'after a rest, at once again');
});
await test('at most 20 a second under any motion, and the final place goes', () => {
  const c = fakeClock();
  const sent = [];
  const s = senderWith(c, (d) => { sent.push({ at: c.now(), d }); });
  for (let i = 0; i < 2000; i += 1) { s.move({ x: i, y: i }); c.run(1); } // a move every millisecond for 2 s
  c.run(100);
  assert.ok(sent.length <= 41, `${sent.length} in 2 seconds`);
  assert.ok(sent.length >= 39, `${sent.length} in 2 seconds: too few`);
  for (let i = 1; i < sent.length; i += 1) assert.ok(sent[i].at - sent[i - 1].at >= 50, `two only ${sent[i].at - sent[i - 1].at} ms apart`);
  assert.deepEqual(sent[sent.length - 1].d, { x: 1999, y: 1999 }, 'the last place');
});
await test('leave: one { gone: true } after a place went, in place of a waiting place, never twice', () => {
  const c = fakeClock();
  const sent = [];
  const s = senderWith(c, (d) => { sent.push(d); });
  s.leave();
  c.run(200);
  assert.equal(sent.length, 0, 'nothing shown: nothing to take away');
  s.move({ x: 1, y: 1 });
  s.move({ x: 2, y: 2 });
  s.leave();
  s.leave();
  c.run(200);
  assert.deepEqual(sent, [{ x: 1, y: 1 }, { gone: true }]);
  s.leave();
  c.run(200);
  assert.equal(sent.length, 2, 'once');
  // Back on the board before the leave went: the place goes, not the leave.
  c.run(1000);
  s.move({ x: 5, y: 5 });
  s.leave();
  s.move({ x: 6, y: 6 });
  c.run(200);
  assert.deepEqual(sent.slice(2), [{ x: 5, y: 5 }, { x: 6, y: 6 }]);
  assert.equal(s.shown, true);
});
await test('a place worked out only when it goes', () => {
  const c = fakeClock();
  const sent = [];
  let asked = 0;
  const s = senderWith(c, (d) => { sent.push(d); });
  s.move(() => { asked += 1; return { x: 1, y: 1 }; });
  for (let i = 0; i < 10; i += 1) s.move(() => { asked += 1; return { x: 2, y: 2 }; });
  c.run(100);
  assert.equal(asked, 2);
  assert.equal(sent.length, 2);
  s.move(() => null);
  assert.equal(sent.length, 2, 'no place: nothing goes');
});
await test('a refusal or a throw is dropped quietly, never tried again', async () => {
  const c = fakeClock();
  let calls = 0;
  const unhandled = [];
  const onUn = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUn);
  const s = senderWith(c, () => { calls += 1; if (calls % 2) throw new Error('refused'); return Promise.reject(Object.assign(new Error('slow down'), { status: 429 })); });
  s.move({ x: 1, y: 1 });
  s.move({ x: 2, y: 2 });
  c.run(1000);
  s.leave();
  c.run(1000);
  await new Promise((r) => setTimeout(r, 10));
  process.off('unhandledRejection', onUn);
  assert.equal(calls, 3, 'one call for each message, no retry');
  assert.equal(unhandled.length, 0, 'no unhandled rejection');
  assert.equal(c.pending(), 0);
});
await test('when the page sends: open, in sight, not presenting, over the board', () => {
  const ok = { state: 'open', hidden: false, presenting: null, over: true };
  assert.equal(L.wbLiveMaySend(ok), true);
  assert.equal(L.wbLiveMaySend({ ...ok, state: 'connecting' }), false);
  assert.equal(L.wbLiveMaySend({ ...ok, state: 'closed' }), false);
  assert.equal(L.wbLiveMaySend({ ...ok, hidden: true }), false);
  assert.equal(L.wbLiveMaySend({ ...ok, presenting: { i: 0 } }), false);
  assert.equal(L.wbLiveMaySend({ ...ok, over: false }), false);
});

// ---- what is heard --------------------------------------------------------------------------------------------------
const ann = { key: 'ann1', name: 'Ann', guest: false, tint: 'blue' };
await test('a place heard: only the known fields, checked', () => {
  const m = L.wbLiveRead({ x: 10, y: -20.5, tool: 'pen', extra: 'x', name: 'Mallory' }, ann, { me: 'me12', tint });
  assert.deepEqual(m, { key: 'ann1', name: 'Ann', guest: false, tint: 'blue', x: 10, y: -20.5, tool: 'pen' });
  assert.deepEqual(L.wbLiveRead({ gone: true, x: 1, y: 1 }, ann, { tint }), { key: 'ann1', name: 'Ann', guest: false, tint: 'blue', gone: true });
  assert.equal(L.wbLiveRead({ gone: 'yes' }, ann, { tint }), null, 'gone must be true');
});
await test('bad numbers and far places', () => {
  for (const bad of [{ x: NaN, y: 1 }, { x: 1, y: null }, { x: '5', y: 5 }, { x: 1 }, { y: 1 }, { x: [1], y: 1 }, { x: { valueOf: () => 1 }, y: 1 }]) {
    assert.equal(L.wbLiveRead(bad, ann, { tint }), null, JSON.stringify(bad));
  }
  const far = L.wbLiveRead({ x: 1e300, y: -1e300 }, ann, { tint });
  assert.equal(far.x, 1e6);
  assert.equal(far.y, -1e6);
  for (const odd of [null, 5, 'x', [1, 2], true]) assert.equal(L.wbLiveRead(odd, ann, { tint }), null);
});
await test('__proto__ and constructor keys change nothing', () => {
  const evil = JSON.parse('{"__proto__": {"x": 5, "y": 6, "polluted": 1}, "constructor": {"prototype": {"polluted": 1}}}');
  assert.equal(L.wbLiveRead(evil, ann, { tint }), null, 'x and y only from the data itself');
  const evil2 = JSON.parse('{"x": 1, "y": 2, "__proto__": {"tool": "pen"}, "constructor": "hand"}');
  const m = L.wbLiveRead(evil2, ann, { tint });
  assert.equal(m.tool, null);
  assert.equal(Object.getPrototypeOf(m), Object.prototype);
  assert.equal(({}).polluted, undefined);
  const fromEvil = JSON.parse('{"key": "bob1", "name": "Bob", "__proto__": {"guest": true}}');
  assert.equal(L.wbLiveRead({ x: 1, y: 1 }, fromEvil, { tint }).guest, false);
});
await test('a missing or odd sender, and this person\'s own key, are ignored', () => {
  for (const from of [undefined, null, 'ann1', 5, [], {}, { key: 5 }, { key: '' }, { key: 'k'.repeat(65) }]) {
    assert.equal(L.wbLiveRead({ x: 1, y: 1 }, from, { tint }), null, JSON.stringify(from));
  }
  assert.equal(L.wbLiveRead({ x: 1, y: 1 }, ann, { me: 'ann1', tint }), null);
  assert.equal(L.wbLiveRead({ gone: true }, ann, { me: 'ann1', tint }), null);
});
await test('an unknown tool is dropped', () => {
  for (const t of ['laser', '', 5, null, { id: 'pen' }, 'pen'.repeat(10), '__proto__', 'constructor', 'toString']) {
    assert.equal(L.wbLiveRead({ x: 1, y: 1, tool: t }, ann, { tint }).tool, null, String(t));
  }
});
await test('the name: cut to 24 characters (… at the end), one line, a guest marked', () => {
  const long = L.wbLiveRead({ x: 1, y: 1 }, { key: 'ann1', name: `  ${'A'.repeat(40)}  ` }, { tint });
  assert.equal(long.name.length, 24);
  assert.equal(long.name, `${'A'.repeat(23)}…`, 'a cut name ends in …');
  assert.equal(L.wbLiveRead({ x: 1, y: 1 }, { key: 'ann1', name: 'B'.repeat(24) }, { tint }).name, 'B'.repeat(24), '24 fit whole');
  const emoji = L.wbLiveRead({ x: 1, y: 1 }, { key: 'ann1', name: '😀'.repeat(30) }, { tint });
  assert.equal(Array.from(emoji.name).length, 24, 'cut by characters, not halves of one');
  assert.equal(L.wbLiveRead({ x: 1, y: 1 }, { key: 'ann1', name: 'Ann\n\tLee' }, { tint }).name, 'Ann Lee');
  assert.equal(L.wbLiveRead({ x: 1, y: 1 }, { key: 'ann1', name: '<b>x</b>' }, { tint }).name, '<b>x</b>', 'kept as words (drawn as text)');
  assert.equal(L.wbLiveRead({ x: 1, y: 1 }, { key: 'ann1' }, { tint }).name, 'Someone');
  const g = L.wbLiveRead({ x: 1, y: 1 }, { key: 'guest-abcd1234', name: 'Gil', guest: true }, { tint });
  assert.equal(g.guest, true);
  assert.equal(L.wbLiveLabel(g), 'Gil (guest)');
  assert.equal(L.wbLiveLabel(L.wbLiveRead({ x: 1, y: 1 }, { key: 'guest-abcd1234', guest: true }, { tint })), 'Guest (guest)');
  assert.equal(L.wbLiveRead({ x: 1, y: 1 }, { key: 'ann1', name: 'Ann', guest: 'true' }, { tint }).guest, false, 'only true is a guest');
  assert.equal(L.wbLiveLabel(long), long.name);
});
await test('a colour is one of the eight, else none', () => {
  assert.equal(L.wbLiveRead({ x: 1, y: 1 }, ann, { tint }).tint, 'blue');
  assert.equal(L.wbLiveRead({ x: 1, y: 1 }, ann, { tint: () => 'red); background: url(x' }).tint, null);
  assert.equal(L.wbLiveRead({ x: 1, y: 1 }, ann, { tint: () => { throw new Error('no'); } }).tint, null);
  assert.equal(L.wbLiveRead({ x: 1, y: 1 }, ann, {}).tint, null);
});

// ---- the pointers kept ----------------------------------------------------------------------------------------------
const at = (key, x = 1, y = 1, more = {}) => L.wbLiveRead({ x, y, ...more }, { key, name: key }, { tint });
await test('a Map by key, the newest last, at most 50', () => {
  const st = L.createWbLiveStore();
  for (let i = 0; i < 60; i += 1) st.put(at(`p${String(i).padStart(3, '0')}`), 1000 + i);
  assert.equal(st.size, 50);
  assert.equal(st.get('p000'), undefined, 'the oldest went');
  assert.equal(st.get('p009'), undefined);
  assert.ok(st.get('p010'));
  st.put(at('p010', 9, 9), 2000); // heard again: the newest now
  st.put(at('n999'), 2001);
  assert.ok(st.get('p010'), 'heard again, so kept');
  assert.equal(st.get('p011'), undefined, 'the oldest now went');
  assert.equal(st.list()[st.size - 2].key, 'p010');
  assert.deepEqual([st.get('p010').x, st.get('p010').y], [9, 9]);
  st.put(at('__proto__'), 3000);
  assert.ok(st.get('__proto__'), 'any key is only a key');
  assert.equal(({}).x, undefined);
});
await test('dimmed after 5 s, gone after 20 s', () => {
  const st = L.createWbLiveStore();
  st.put(at('ann1'), 0);
  const p = st.get('ann1');
  assert.equal(st.faded(p, 4999), false);
  assert.equal(st.faded(p, 5000), true);
  assert.equal(st.sweep(19999), false);
  assert.equal(st.size, 1);
  st.put(at('bob1'), 15000);
  assert.equal(st.sweep(20000), true);
  assert.equal(st.get('ann1'), undefined);
  assert.ok(st.get('bob1'));
  assert.equal(st.faded(st.get('bob1'), 20000), true);
});
await test('gone at once: { gone: true }, a leave, cleared', () => {
  const st = L.createWbLiveStore();
  st.put(at('ann1'), 0);
  st.put(at('bob1'), 0);
  st.put(L.wbLiveRead({ gone: true }, { key: 'ann1', name: 'Ann' }, { tint }), 1);
  assert.equal(st.get('ann1'), undefined);
  assert.equal(st.remove('bob1'), true);
  assert.equal(st.size, 0);
  st.put(at('ann1'), 0);
  assert.equal(st.clear(), true);
  assert.equal(st.size, 0);
  assert.equal(st.put(null, 0), null);
});
await test('drawn only when shown and open', () => {
  assert.equal(L.wbLiveDrawn({ on: true, state: 'open' }), true);
  assert.equal(L.wbLiveDrawn({ on: false, state: 'open' }), false);
  assert.equal(L.wbLiveDrawn({ on: true, state: 'connecting' }), false);
  assert.equal(L.wbLiveDrawn({ on: true, state: 'closed' }), false);
  assert.equal(L.wbLiveDrawn({ on: true, state: undefined }), false);
});

// ---- the choice -----------------------------------------------------------------------------------------------------
await test('the choice: shown at first, kept, and no throw when storage throws', () => {
  const mem = new Map();
  const store = () => ({ getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); } });
  assert.equal(L.wbLiveLoad(store), true, 'shown when nothing is kept');
  assert.equal(L.wbLiveSave(store, false), true);
  assert.equal(L.wbLiveLoad(store), false);
  assert.equal(L.wbLiveSave(store, true), true);
  assert.equal(L.wbLiveLoad(store), true);
  const broken = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('full'); } };
  assert.equal(L.wbLiveLoad(() => broken), true);
  assert.equal(L.wbLiveSave(() => broken, false), false);
  const blocked = () => { throw new Error('SecurityError'); };
  assert.equal(L.wbLiveLoad(blocked), true);
  assert.equal(L.wbLiveSave(blocked, false), false);
  assert.equal(L.wbLiveLoad(() => null), true);
  assert.equal(L.wbLiveSave(() => null, false), false);
});

if (fails.length) {
  console.error(`check-whiteboard-live-pointers: ${fails.length} failed, ${passed} passed`);
  for (const f of fails) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(`check-whiteboard-live-pointers: OK (${passed} checks)`);
