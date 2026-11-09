#!/usr/bin/env node
/*
 * check-whiteboard-sync.mjs -- the Whiteboard's sync (modules/whiteboard/src/whiteboard-lib-c-sync.js).
 * Guards: a Delete followed at once by an Undo left the block deleted on that page, and changes heard while a key's write
 * is on its way must not be lost (they are judged, in order, when the answer is in). It runs the lib against a fake server,
 * fake pages and fake timers: every reply and change event is handed over by the check in an order it picks, so nothing
 * depends on time. No network, no sleeps.
 * Usage: node tools/check-whiteboard-sync.mjs [path to whiteboard-lib-c-sync.js]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src/whiteboard-lib-c-sync.js'));
const src = fs.readFileSync(file, 'utf8');

// ---- fake timers ----
let timers = [];
let timerSeq = 0;
const fakeSetTimeout = (fn, ms) => { const id = ++timerSeq; timers.push({ id, fn, ms }); return id; };
const fakeClearTimeout = (id) => { timers = timers.filter((t) => t.id !== id); };
const createSync = new Function('setTimeout', 'clearTimeout', `${src}\nreturn createSync;`)(fakeSetTimeout, fakeClearTimeout);
const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => { setImmediate(r); }); };
async function runTimers() { while (timers.length) { const t = timers.shift(); t.fn(); await settle(); } }

const BOARD = 'main';
const KEY = (id) => `block:${BOARD}:${id}`;
const clean = (v) => (v && typeof v === 'object' && typeof v.id === 'string' ? { ...v } : null);

// ---- fake server: the same versions as server/module-data.js (a key starts at 1 again after a delete) ----
function createServer() {
  const data = new Map(); // key -> { value, version }
  const pages = [];
  const refuse = []; // errors to answer the next writes with
  function emit(change) { for (const p of pages) p.inbox.push({ ...change, scope: 'space' }); }
  return {
    data,
    pages,
    refuse,
    set(key, value) {
      if (refuse.length) throw refuse.shift();
      const was = data.get(key);
      const entry = { value: JSON.parse(JSON.stringify(value)), version: (was ? was.version : 0) + 1 };
      data.set(key, entry);
      emit({ key, value: entry.value, version: entry.version, deleted: false });
      return { key, ...entry };
    },
    delete(key) {
      if (refuse.length) throw refuse.shift();
      const was = data.get(key);
      if (!was) return { key, deleted: true, version: 0 };
      data.delete(key);
      emit({ key, value: null, version: was.version + 1, deleted: true });
      return { key, deleted: true, version: was.version + 1 };
    },
  };
}

// ---- a fake page: what it draws (dom), what it heard, its replies and its events, both handed over by the test ----
function createPage(server, name) {
  const page = { name, dom: new Map(), inbox: [], replies: [], remote: [], refused: 0, busy: 0 };
  const reply = (fn) => new Promise((resolve, reject) => {
    // The server applies the write now; the answer reaches the page when the test hands it over.
    let out; let err;
    try { out = fn(); } catch (e) { err = e; }
    page.replies.push(() => (err ? reject(err) : resolve(out)));
  });
  const host = {
    storage: {
      set: (key, value) => reply(() => server.set(key, value)),
      delete: (key) => reply(() => server.delete(key)),
      get: async (key) => { const e = server.data.get(key); return e ? { key, value: e.value, version: e.version } : null; },
      list: async (prefix) => [...server.data].filter(([k]) => k.startsWith(prefix)).map(([key, e]) => ({ key, value: e.value, version: e.version })),
    },
  };
  page.sync = createSync({
    host,
    board: BOARD,
    clean,
    onRemote: (c) => {
      page.remote.push(c);
      if (c.op === 'remove') page.dom.delete(c.id); else page.dom.set(c.block.id, c.block);
    },
    onReload: () => {},
    onRefused: () => { page.refused += 1; },
    onBusy: () => { page.busy += 1; },
  });
  page.load = async () => { for (const b of await page.sync.load()) page.dom.set(b.id, b); };
  page.put = (b) => { page.dom.set(b.id, b); page.sync.save(b); };
  page.del = (id) => { page.dom.delete(id); page.sync.remove(id); };
  page.reply = async () => { const r = page.replies.shift(); if (!r) throw new Error(`${name}: no reply waiting`); r(); await settle(); };
  page.event = async () => { const e = page.inbox.shift(); if (!e) throw new Error(`${name}: no event waiting`); page.sync.handle(e); await settle(); };
  page.flush = async () => {
    for (let i = 0; i < 200 && (page.replies.length || page.inbox.length); i += 1) {
      if (page.replies.length) await page.reply(); else await page.event();
    }
  };
  server.pages.push(page);
  return page;
}
async function flushAll(...pages) {
  for (let i = 0; i < 50; i += 1) {
    let any = false;
    for (const p of pages) if (p.replies.length || p.inbox.length) { any = true; await p.flush(); }
    if (!any) return;
  }
}

// ---- the tests ----
let failed = 0;
let passed = 0;
const fails = [];
function check(ok, what) {
  if (ok) { passed += 1; return; }
  failed += 1;
  fails.push(what);
}
const block = (id, x, extra = {}) => ({ id, type: 'note', x, y: 0, ...extra });

async function setup() {
  timers = [];
  const server = createServer();
  server.data.set(KEY('n1'), { value: block('n1', 0), version: 1 });
  const A = createPage(server, 'A');
  const B = createPage(server, 'B');
  await A.load();
  await B.load();
  return { server, A, B };
}

// (a) and (b): delete then an immediate re-create (an undo), then a remote edit is taken, and a remote delete removes it.
async function testDeleteUndoThenRemote() {
  const { server, A, B } = await setup();
  A.del('n1');
  A.put(block('n1', 0)); // Undo, before the delete is answered
  await flushAll(A, B);
  check(A.dom.has('n1') && B.dom.has('n1') && server.data.has(KEY('n1')), '(a) the block is back on A, B and the server after Delete + Undo');
  B.put(block('n1', 10));
  await flushAll(A, B);
  check(A.dom.get('n1') && A.dom.get('n1').x === 10, '(a) A takes B\'s edit after its own Delete + Undo');
  B.del('n1');
  await flushAll(A, B);
  check(!server.data.has(KEY('n1')) && !B.dom.has('n1') && !A.dom.has('n1'), '(b) B\'s later delete removes the block on A (no ghost)');
}

// (c) Two events during one busy lane are both judged, in the order they came.
async function testTwoDeferred() {
  const { A, B } = await setup();
  A.put(block('n1', 5)); // A's write of n1 is on its way (its answer is held)
  // B, which has not heard A's write yet, writes n1 twice; both reach A while A's lane for n1 is busy.
  B.put(block('n1', 20));
  await B.reply();
  B.put(block('n1', 30, { fill: 'gold' }));
  await B.reply();
  // A's inbox: its own echo (v2), B's v3, B's v4. Hand A every event before its own answer.
  while (A.inbox.length) await A.event();
  check(A.remote.filter((c) => c.op === 'put' && c.block.id === 'n1').length === 0, '(c) nothing is drawn on A while its own write of the key is on its way');
  await A.reply();
  const puts = A.remote.filter((c) => c.op === 'put' && c.block.id === 'n1').map((c) => c.block.x);
  check(JSON.stringify(puts) === '[20,30]', `(c) both changes heard meanwhile are judged in order (got ${JSON.stringify(puts)})`);
  check(A.dom.get('n1').x === 30, '(c) A ends with the newest');

  // A change and then a delete during one busy lane: the delete is not lost.
  const s2 = await setup();
  s2.A.put(block('n1', 5));
  s2.B.put(block('n1', 20));
  await s2.B.reply();
  s2.B.del('n1');
  await s2.B.reply();
  while (s2.A.inbox.length) await s2.A.event();
  await s2.A.reply();
  check(!s2.A.dom.has('n1') && !s2.server.data.has(KEY('n1')), '(c) a put then a delete heard meanwhile: the delete is taken');
}

// (d) The Delete + Undo race on A with B nudging, every order of A's answers and events.
async function testRaceAllOrders() {
  // A's deliveries: R1 (the delete's answer), R2 (the re-create's), E1 (the delete's echo), E2 (the re-create's), E3 (B's
  // nudge). The re-create is sent only once R1 is in, so R2 and E2 (and B's nudge, which comes after it) follow R1.
  const orders = [];
  const pick = (seq, r, e) => {
    if (r === 2 && e === 3) { orders.push(seq); return; }
    if (r < 2) pick(`${seq}R`, r + 1, e);
    if (e < 3 && (e === 0 || r >= 1)) pick(`${seq}E`, r, e + 1);
  };
  pick('', 0, 0);
  let bad = 0;
  for (const order of orders) {
    for (let round = 0; round < 2; round += 1) {
      const { server, A, B } = await setup();
      const nudged = 100 + round;
      A.del('n1');
      A.put(block('n1', 0, { fill: 'blue' })); // Undo at once
      let nudgedYet = false;
      for (const step of order) {
        if (step === 'R') await A.reply(); else await A.event();
        // B nudges once A's re-create has reached the server (B hears the delete and the re-create first).
        if (!nudgedYet && server.data.has(KEY('n1'))) {
          nudgedYet = true;
          await B.flush();
          B.put(block('n1', nudged, { fill: 'blue' }));
          await B.reply();
        }
      }
      await flushAll(A, B);
      const okEdit = A.dom.get('n1') && A.dom.get('n1').x === nudged;
      B.del('n1');
      await flushAll(A, B);
      const okGone = !A.dom.has('n1') && !B.dom.has('n1') && !server.data.has(KEY('n1'));
      if (!okEdit || !okGone) { bad += 1; fails.push(`(d) order ${order} round ${round}: ${okEdit ? '' : 'A missed B\'s nudge; '}${okGone ? '' : 'a ghost after B\'s delete'}`); }
    }
  }
  check(bad === 0, `(d) Delete + Undo race: ${orders.length} orders x 2 rounds`);

  // Delete + Undo + Delete again quickly: the block stays gone on A once all is heard.
  const { server, A, B } = await setup();
  A.del('n1');
  A.put(block('n1', 0));
  A.del('n1');
  await flushAll(A, B);
  check(!A.dom.has('n1') && !B.dom.has('n1') && !server.data.has(KEY('n1')), '(d) Delete, Undo, Delete again: gone everywhere');
  B.put(block('n1', 7)); // B brings it back (its own undo)
  await flushAll(A, B);
  check(A.dom.get('n1') && A.dom.get('n1').x === 7, '(d) and then a re-create by B is taken on A');
}

// (e) What the file header promises.
async function testGuarantees() {
  // Own echo skipped (answer first, then the echo; and the echo first, then the answer).
  for (const echoFirst of [false, true]) {
    const { A, B } = await setup();
    A.put(block('n1', 3));
    if (echoFirst) { await A.event(); await A.reply(); } else { await A.reply(); await A.event(); }
    check(A.remote.length === 0, `(e) own echo skipped (${echoFirst ? 'echo before answer' : 'answer before echo'})`);
    await flushAll(A, B);
  }
  // A repeat is skipped.
  {
    const { A, B } = await setup();
    B.put(block('n1', 9));
    await B.flush();
    const e = A.inbox[0];
    await A.event();
    A.inbox.push({ ...e });
    await A.event();
    check(A.remote.length === 1, '(e) a repeat is skipped');
  }
  // A late echo of an older write does not bring a deleted block back (the echo after the delete is answered).
  {
    const { A, B } = await setup();
    A.put(block('n1', 4));
    await A.reply(); // A's move is answered; its echo is still on its way
    A.del('n1');
    await A.reply(); // the delete is answered
    await A.event(); // the move's echo, late
    check(!A.dom.has('n1'), '(e) a late echo of an older write does not bring the deleted block back');
    await A.flush();
    check(!A.dom.has('n1'), '(e) still gone once the delete is heard');
    // And the key starts afresh: B brings it back with the same id.
    B.put(block('n1', 8));
    await flushAll(A, B);
    check(A.dom.get('n1') && A.dom.get('n1').x === 8, '(e) after the delete is heard, the same id is taken again');
  }
  // The same, with a re-create (Undo) in the lane: the old echo still does not count.
  {
    const { A, B } = await setup();
    A.put(block('n1', 4));
    await A.reply();
    A.del('n1');
    A.put(block('n1', 0)); // Undo
    await A.reply(); // delete answered
    await A.event(); // old move echo (v2, the old life)
    check(!A.remote.some((c) => c.op === 'put'), '(e) an old echo during Delete + Undo is not drawn');
    await flushAll(A, B);
    check(A.dom.get('n1') && A.dom.get('n1').x === 0, '(e) A shows its own re-created block');
    B.put(block('n1', 11));
    await flushAll(A, B);
    check(A.dom.get('n1').x === 11, '(e) and takes B\'s edit after');
  }
  // 429: sent again after the wait it names; onBusy hears it once.
  {
    const { server, A } = await setup();
    server.refuse.push(Object.assign(new Error('busy'), { status: 429, retryAfter: 2 }));
    A.put(block('n1', 6));
    await A.reply(); // refused
    check(A.busy === 1 && timers.length === 1 && timers[0].ms === 2000, '(e) 429: onBusy once, a wait of the time it names');
    await runTimers();
    await A.flush();
    check(server.data.get(KEY('n1')).value.x === 6 && A.refused === 0, '(e) 429: the write is sent again and saved');
  }
  // 429, with a newer write meanwhile: only the newer is sent.
  {
    const { server, A } = await setup();
    server.refuse.push(Object.assign(new Error('busy'), { status: 429, retryAfter: 1 }));
    A.put(block('n1', 6));
    await A.reply();
    A.put(block('n1', 7));
    await runTimers();
    await A.flush();
    check(server.data.get(KEY('n1')).value.x === 7 && server.data.get(KEY('n1')).version === 2, '(e) 429: a newer write meanwhile is sent instead');
  }
  // A refused delete: the block comes back, and later changes are taken.
  {
    const { server, A, B } = await setup();
    server.refuse.push(Object.assign(new Error('no'), { status: 403 }));
    A.del('n1');
    await A.reply();
    await A.flush();
    check(A.dom.has('n1') && A.refused === 1, '(e) a refused delete: the block is put back');
    B.put(block('n1', 12));
    await flushAll(A, B);
    check(A.dom.get('n1').x === 12, '(e) and later changes to it are taken');
  }
}

await testDeleteUndoThenRemote();
await testTwoDeferred();
await testRaceAllOrders();
await testGuarantees();
if (failed) {
  for (const f of fails) console.error(`FAIL ${f}`);
  console.error(`check-whiteboard-sync: ${failed} failed, ${passed} passed (${path.relative(root, file)})`);
  process.exit(1);
}
console.log(`check-whiteboard-sync: OK, ${passed} cases`);
