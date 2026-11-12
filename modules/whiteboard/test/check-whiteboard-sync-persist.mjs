#!/usr/bin/env node
/*
 * check-whiteboard-sync-persist.mjs -- writes the server has not accepted yet survive a reload or a closed tab
 * (modules/whiteboard/src/whiteboard-lib-c-sync.js, issue #693). Guards: after a big undo the module write limit (429)
 * parked writes in memory only, and a reload or a closed tab lost them for good. Runs the lib against a fake storage API
 * that refuses writes with 429, fake timers and a fake localStorage: pending intents are kept; a new sync on the same
 * store replays them and the server ends with the full set; a later local intent beats a kept one; the size cap; the
 * leave prompt only while writes are pending; nothing kept when nothing is pending; garbage in the store is ignored.
 * Usage: node modules/whiteboard/test/check-whiteboard-sync-persist.mjs [path to whiteboard-lib-c-sync.js]. Exits 1 on failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const file = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src/whiteboard-lib-c-sync.js'));
const src = fs.readFileSync(file, 'utf8');
let timers = [];
let seq = 0;
const fakeSetTimeout = (fn, ms) => { const id = ++seq; timers.push({ id, fn, ms }); return id; };
const fakeClearTimeout = (id) => { timers = timers.filter((t) => t.id !== id); };
const createSync = new Function('setTimeout', 'clearTimeout', `${src}\nreturn createSync;`)(fakeSetTimeout, fakeClearTimeout);
const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => { setImmediate(r); }); };
async function runTimers() { for (let i = 0; i < 200 && timers.length; i += 1) { const t = timers.shift(); t.fn(); await settle(); } }

let failed = 0;
const ok = (c, m) => { if (!c) { failed += 1; console.error(`FAIL ${m}`); } else console.log(`ok   ${m}`); };

const clean = (v) => (v && typeof v === 'object' && typeof v.id === 'string' ? { ...v } : null);
const makeStore = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; };
function makeServer({ refuseFirst = 0 } = {}) {
  const data = new Map();
  let refuse = refuseFirst;
  let v = 0;
  return {
    data,
    refuseMore(n) { refuse = n; },
    host: {
      storage: {
        async set(key, value) { if (refuse > 0) { refuse -= 1; throw Object.assign(new Error('busy'), { status: 429, retryAfter: 1 }); } data.set(key, value); v += 1; return { version: v }; },
        async delete(key) { if (refuse > 0) { refuse -= 1; throw Object.assign(new Error('busy'), { status: 429, retryAfter: 1 }); } const had = data.delete(key); v += 1; return { version: had ? v : 0 }; },
        async list() { return [...data].map(([key, value]) => ({ key, value, version: 1 })); },
        async get(key) { return data.has(key) ? { value: data.get(key), version: 1 } : null; },
      },
    },
  };
}
const blk = (i, extra = {}) => ({ id: `b${i}`, type: 'stroke', ...extra });
const mk = (server, store, over = {}) => {
  const log = { busy: 0, refused: 0, drawn: [] };
  const s = createSync({ host: server.host, board: 'main', clean, me: 'u1', scope: 'sp1', store, onRemote: (c) => log.drawn.push(c), onReload() {}, onRefused() { log.refused += 1; }, onBusy() { log.busy += 1; }, ...over });
  return { s, log };
};
const KEYSET = (n) => Array.from({ length: n }, (_, i) => `block:main:b${i}`).sort();

// 1. refused writes are kept; a reload replays them; the server ends with all
{
  const server = makeServer({ refuseFirst: 40 }); const store = makeStore();
  const { s, log } = mk(server, store);
  for (let i = 0; i < 100; i += 1) s.save(blk(i));
  await settle();
  ok(server.data.size === 60 && s.pending() === 40, `40 refused: server holds 60, pending ${s.pending()}`);
  ok(log.busy === 40, 'onBusy heard each refusal');
  const kept = JSON.parse(store.getItem([...store.m.keys()][0]));
  ok(Object.keys(kept.items).length === 40 && kept.by === 'u1', 'the 40 refused intents are kept in the store');
  // the page goes: a new sync on the same store, the old timers die with the page
  timers = [];
  const server2 = server; server2.refuseMore(0);
  const { s: s2 } = mk(server2, store);
  await s2.load();
  const left = s2.replay();
  ok(left.put.length === 40, 'replay hands back 40 blocks to draw');
  await settle();
  ok(KEYSET(100).every((k) => server.data.has(k)) && server.data.size === 100, 'the server ends with all 100');
  ok(s2.pending() === 0 && store.m.size === 0, 'nothing is kept once the server accepted them');
}
// 2. a later local intent beats a kept one; a kept delete replays
{
  const server = makeServer(); const store = makeStore();
  server.data.set('block:main:b5', blk(5, { v: 'old' }));
  store.setItem('wb-pending:sp1:block:main:', JSON.stringify({ t: Date.now(), by: 'u1', items: { 'block:main:b1': { op: 'put', value: blk(1, { v: 'kept' }) }, 'block:main:b2': { op: 'put', value: blk(2, { v: 'kept' }) }, 'block:main:b5': { op: 'del' } } }));
  const { s } = mk(server, store);
  s.save(blk(1, { v: 'new' }));
  const left = s.replay();
  await settle();
  ok(server.data.get('block:main:b1').v === 'new', 'a local intent made before the replay beats the kept one');
  ok(server.data.get('block:main:b2').v === 'kept' && left.put.length === 1, 'the other kept intent is sent');
  ok(!server.data.has('block:main:b5') && left.remove[0] === 'b5', 'a kept delete is sent');
}
// 3. nothing pending: nothing kept, no prompt
{
  const server = makeServer(); const store = makeStore();
  const { s } = mk(server, store);
  s.save(blk(1)); s.saveSoon(blk(2)); await settle();
  ok(s.pending() === 1 && s.beforeUnload({ preventDefault() {} }) === true, 'a block waiting on the timer counts as pending (prompt on)');
  s.flush(); await settle(); await runTimers();
  ok(s.pending() === 0 && store.m.size === 0, 'after everything is sent nothing is kept');
  let prevented = 0; const e = { preventDefault() { prevented += 1; }, returnValue: undefined };
  ok(s.beforeUnload(e) === false && prevented === 0 && e.returnValue === undefined, 'no prompt when nothing is pending');
}
// 4. the prompt while parked
{
  const server = makeServer({ refuseFirst: 1000 }); const store = makeStore();
  const { s } = mk(server, store);
  s.save(blk(1)); await settle();
  const e = { preventDefault() { e.p = true; }, returnValue: undefined };
  ok(s.beforeUnload(e) === true && e.p === true && e.returnValue === '', 'prompt while a write is parked');
}
// 5. the retry cap keeps the intent (parked, tried again later)
{
  const server = makeServer({ refuseFirst: 9 }); const store = makeStore();
  const { s, log } = mk(server, store);
  s.save(blk(1));
  await runTimers();
  ok(log.refused === 0, 'after the cap the write is not reported as refused for good');
  ok(server.data.has('block:main:b1') && s.pending() === 0, 'the parked intent is tried again later and lands');
}
// 6. the size cap: the newest intents are kept
{
  const server = makeServer({ refuseFirst: 1e6 }); const store = makeStore();
  const { s } = mk(server, store);
  const fat = 'x'.repeat(300000);
  for (let i = 0; i < 10; i += 1) s.save(blk(i, { fat }));
  await settle();
  const raw = [...store.m.values()][0];
  const items = Object.keys(JSON.parse(raw).items);
  ok(raw.length <= 2000000 && items.length === 6 && items.includes('block:main:b9') && !items.includes('block:main:b0'), `over the cap: the newest ${items.length} kept, the oldest left out`);
  ok(s.pending() === 10, 'all 10 still wait in memory');
}
// 7. hostile store content is ignored
{
  const garbage = ['not json', '{"t":1}', 'null', '[]', '"s"', JSON.stringify({ t: Date.now(), by: 'u1', items: [] }), JSON.stringify({ t: Date.now(), by: 'u1', items: { 'block:main:b1': 5, 'block:main:b2': { op: 'put', value: 7 }, 'block:main:b3': { op: 'put', value: blk(9) }, 'other:b4': { op: 'put', value: blk(4) }, 'block:main:b6': { op: 'zap' } } }),
    JSON.stringify({ t: Date.now(), by: 'someone', items: { 'block:main:b1': { op: 'put', value: blk(1) } } }), JSON.stringify({ t: Date.now() - 11 * 60000, by: 'u1', items: { 'block:main:b1': { op: 'put', value: blk(1) } } }), JSON.stringify({ t: Date.now() + 1e9, by: 'u1', items: {} })];
  for (const g of garbage) {
    const server = makeServer(); const store = makeStore();
    store.setItem('wb-pending:sp1:block:main:', g);
    const { s } = mk(server, store);
    let left; let threw = false;
    try { left = s.replay(); await settle(); } catch { threw = true; }
    ok(!threw && left.put.length === 0 && left.remove.length === 0 && server.data.size === 0 && store.m.size === 0, `garbage ignored and cleared: ${g.slice(0, 40)}`);
  }
  const server = makeServer(); const store = makeStore();
  store.getItem = () => { throw new Error('denied'); }; store.setItem = () => { throw new Error('full'); };
  const { s } = mk(server, store);
  s.save(blk(1)); const left = s.replay(); await settle();
  ok(left.put.length === 0 && server.data.size === 1, 'a store that throws never stops a save');
  const noStore = mk(makeServer(), null);
  noStore.s.save(blk(1)); await settle();
  ok(noStore.s.replay().put.length === 0, 'no store at all is fine');
}
// 8. another space or board does not see it
{
  const server = makeServer({ refuseFirst: 5 }); const store = makeStore();
  const { s } = mk(server, store);
  s.save(blk(1)); await settle();
  const { s: other } = mk(makeServer(), store, { scope: 'sp2' });
  ok(other.replay().put.length === 0, 'another space leaves the kept writes alone');
}
// 9. a board of the same space does not see it either (the entry is keyed by the board's prefix); a closed sync sends what waits
{
  const server = makeServer({ refuseFirst: 5 }); const store = makeStore();
  const { s } = mk(server, store);
  s.save(blk(1)); await settle();
  ok([...store.m.keys()].join() === 'wb-pending:sp1:block:main:', 'the kept entry is keyed by the space and the board\'s prefix');
  const { s: b2 } = mk(server, store, { board: 'b2' });
  ok(b2.replay().put.length === 0 && store.m.has('wb-pending:sp1:block:main:'), 'another board of the same space replays nothing and leaves the entry');
  timers = [];
  const srv2 = makeServer(); const st2 = makeStore();
  const { s: c } = mk(srv2, st2);
  c.saveSoon(blk(7));
  c.close(); await settle();
  ok(srv2.data.has('block:main:b7') && c.closed === true && c.save(blk(8)) === false && !srv2.data.has('block:main:b8'), 'close() sends what waits (R1), then takes no more writes');
  ok(c.owns('block:main:x') && !c.owns('block:b2:x'), 'a sync owns only its own board\'s keys');
}
if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('all ok');
