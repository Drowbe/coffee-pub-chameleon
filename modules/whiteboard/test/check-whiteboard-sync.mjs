#!/usr/bin/env node
/*
 * check-whiteboard-sync.mjs -- the Whiteboard's sync (modules/whiteboard/src/whiteboard-lib-c-sync.js).
 * Guards: a Delete followed at once by an Undo left the block deleted on that page; changes heard while a key's write
 * is on its way must not be lost (they are judged, in order, when the answer is in); a page that missed the echo of its
 * own delete (the stream reconnects without what it missed) must not stop taking that block, nor be blind to it while it
 * waits; a delete by someone else is never taken for its own. It runs the lib against a
 * fake server, fake pages and fake timers: every reply and change event is handed over by the check in an order it picks,
 * so nothing depends on time; then a fuzz over fixed seeds (three pages, random writes, deletes, undos, reloads, delivery
 * orders and missed own-delete echoes) must end with every page showing what the server holds. No network, no sleeps.
 * Usage: node modules/whiteboard/test/check-whiteboard-sync.mjs [path to whiteboard-lib-c-sync.js]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
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
  const versions = new Map(); // key -> the highest version it ever had (for the fuzz)
  function emit(change) {
    versions.set(change.key, Math.max(versions.get(change.key) || 0, change.version));
    for (const p of pages) p.inbox.push({ ...change, scope: 'space' });
  }
  return {
    data,
    pages,
    refuse,
    versions,
    set(key, value, by = '') {
      if (refuse.length) throw refuse.shift();
      const was = data.get(key);
      const entry = { value: JSON.parse(JSON.stringify(value)), version: (was ? was.version : 0) + 1 };
      data.set(key, entry);
      emit({ key, value: entry.value, version: entry.version, deleted: false, by });
      return { key, ...entry };
    },
    delete(key, by = '') {
      if (refuse.length) throw refuse.shift();
      const was = data.get(key);
      if (!was) return { key, deleted: true, version: 0 };
      data.delete(key);
      emit({ key, value: null, version: was.version + 1, deleted: true, by });
      return { key, deleted: true, version: was.version + 1 };
    },
  };
}

// ---- a fake page: what it draws (dom), what it heard, its replies and its events, both handed over by the test ----
function createPage(server, name) {
  const page = { name, dom: new Map(), inbox: [], replies: [], remote: [], refused: 0, busy: 0, holdReads: false, reads: [] };
  const reply = (fn) => new Promise((resolve, reject) => {
    // The server applies the write now; the answer reaches the page when the test hands it over.
    let out; let err;
    try { out = fn(); } catch (e) { err = e; }
    page.replies.push(() => (err ? reject(err) : resolve(out)));
  });
  const host = {
    storage: {
      set: (key, value) => reply(() => server.set(key, value, name)),
      delete: (key) => reply(() => server.delete(key, name)),
      // A read sees the server as it is when asked; with page.holdReads on, its answer waits until the test hands it over.
      get: (key) => {
        const e = server.data.get(key);
        const out = e ? { key, value: JSON.parse(JSON.stringify(e.value)), version: e.version } : null;
        if (!page.holdReads) return Promise.resolve(out);
        return new Promise((resolve) => { page.reads.push(() => resolve(out)); });
      },
      list: async (prefix) => [...server.data].filter(([k]) => k.startsWith(prefix)).map(([key, e]) => ({ key, value: e.value, version: e.version })),
    },
  };
  page.sync = createSync({
    host,
    board: BOARD,
    clean,
    me: name, // the server's change says who made it (by)
    onRemote: (c) => {
      page.remote.push(c);
      if (c.op === 'remove') page.dom.delete(c.id); else page.dom.set(c.block.id, c.block);
    },
    onReload: () => {},
    onRefused: () => { page.refused += 1; },
    onBusy: () => { page.busy += 1; },
  });
  // Reading the board again: the page shows what the server holds, nothing else.
  page.load = async () => { const list = await page.sync.load(); page.dom.clear(); for (const b of list) page.dom.set(b.id, b); };
  page.put = (b) => { page.dom.set(b.id, b); page.sync.save(b); };
  page.del = (id) => { page.dom.delete(id); page.sync.remove(id); };
  page.reply = async () => { const r = page.replies.shift(); if (!r) throw new Error(`${name}: no reply waiting`); r(); await settle(); };
  page.event = async () => { const e = page.inbox.shift(); if (!e) throw new Error(`${name}: no event waiting`); page.sync.handle(e); await settle(); };
  // The next event never reaches the page (the stream reconnected without it).
  page.drop = () => { const e = page.inbox.shift(); if (!e) throw new Error(`${name}: no event to drop`); return e; };
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

// (f) The wait after this page's own delete: what ends it, and what does not.
async function testWait() {
  const putsOf = (P, id) => P.remote.filter((c) => c.op === 'put' && c.block.id === id);
  // After Delete + Undo, nothing more is drawn or taken away on A: not its own delete's echo, not its re-create's
  // (whichever comes first, the re-create's answer or the delete's echo).
  for (const answerFirst of [true, false]) {
    const { A, B } = await setup();
    A.del('n1');
    A.put(block('n1', 0, { fill: 'blue' })); // Undo at once
    await A.reply(); // the delete's answer
    if (answerFirst) { await A.reply(); await A.event(); } else { await A.event(); await A.reply(); }
    await A.event(); // the re-create's echo
    check(A.remote.length === 0, `(f) Delete + Undo: A's own echoes draw nothing again (${answerFirst ? 'answer' : 'echo'} first; got ${JSON.stringify(A.remote)})`);
    await flushAll(A, B);
    B.put(block('n1', 21));
    await flushAll(A, B);
    check(A.dom.get('n1') && A.dom.get('n1').x === 21, '(f) and B\'s edit after is taken');
  }
  // An old echo heard while waiting (before the re-create's answer) does not end the wait early.
  {
    const { A, B } = await setup();
    A.put(block('n1', 4));
    await A.reply(); // the move is answered (v2); its echo is still on its way
    A.del('n1');
    A.put(block('n1', 0, { fill: 'blue' })); // Undo
    await A.reply(); // the delete's answer (v3)
    await A.event(); // the move's echo, v2: old
    await A.reply(); // the re-create's answer (v1)
    await A.event(); // the delete's echo, v3
    await A.event(); // the re-create's echo, v1
    check(A.remote.length === 0 && A.dom.get('n1') && A.dom.get('n1').fill === 'blue', `(f) an old echo while waiting: nothing drawn or taken away (got ${JSON.stringify(A.remote.map((c) => c.op))})`);
    await flushAll(A, B);
  }
  // A delete with another version while waiting: an older one (B's, from before A's delete) keeps the wait; B's older
  // writes after it are not drawn either.
  {
    const { server, A, B } = await setup();
    B.del('n1'); await B.reply(); // v2, a delete
    B.put(block('n1', 50)); await B.reply(); // v1
    B.put(block('n1', 51)); await B.reply(); // v2
    B.put(block('n1', 52)); await B.reply(); // v3
    // A has heard none of it yet, still shows n1, and deletes it (v4), then undoes (v1).
    A.del('n1');
    await A.reply();
    A.put(block('n1', 0, { fill: 'blue' }));
    await A.reply();
    await A.flush(); // B's older delete, B's three writes, A's delete, A's re-create, in that order
    check(A.remote.length === 0, `(f) an older delete while waiting keeps the wait: nothing of B's older life is drawn (got ${JSON.stringify(A.remote.map((c) => (c.op === 'put' ? c.block.x : c.op)))})`);
    check(A.dom.get('n1') && A.dom.get('n1').fill === 'blue' && server.data.get(KEY('n1')).value.fill === 'blue', '(f) A shows its own re-created block');
    await flushAll(A, B);
    B.put(block('n1', 53, { fill: 'blue' }));
    await flushAll(A, B);
    check(A.dom.get('n1') && A.dom.get('n1').x === 53, '(f) and takes B\'s edit after');
  }
  // F2: A misses the echo of its own delete; B brings the block back and edits it, then deletes it: that later delete
  // ends A's wait, and what B does next is taken.
  for (const life of [1, 3]) {
    const { server, A, B } = await setup();
    A.del('n1');
    await A.reply(); // v2
    A.drop(); // the delete's echo never reaches A
    await B.flush();
    for (let i = 0; i < life; i += 1) { B.put(block('n1', 60 + i)); await B.reply(); } // v1 .. v<life>
    await flushAll(A, B);
    B.del('n1'); await B.reply(); // v<life + 1>: the same version as A's own delete, or a higher one
    await flushAll(A, B);
    check(!A.dom.has('n1'), `(f) a missed own delete echo, then B's later delete (${life + 1}): gone on A`);
    B.put(block('n1', 70)); await B.reply();
    B.put(block('n1', 71)); await B.reply();
    await flushAll(A, B);
    check(A.dom.get('n1') && A.dom.get('n1').x === 71 && server.data.get(KEY('n1')).value.x === 71, `(f) a missed own delete echo recovers on a later delete (${life + 1}): A follows B again`);
  }
  // A misses the echo of its own delete of a block it had edited a lot (the delete's version, 7, above anything the next
  // life of the key reaches); B brings the block back, edits it and deletes it (version 3, lower than A's): A is never
  // blind to the key. It shows B's block while it is there, takes it away on B's delete, and follows B after.
  {
    const { server, A, B } = await setup();
    for (let i = 1; i <= 5; i += 1) { A.put(block('n1', i)); await A.reply(); } // v2 .. v6
    A.del('n1');
    await A.reply(); // v7
    await flushAll(B);
    while (A.inbox.length && !A.inbox[0].deleted) await A.event();
    A.drop(); // the delete's echo (7) never reaches A
    B.put(block('n1', 60)); await B.reply(); // v1
    B.put(block('n1', 61)); await B.reply(); // v2
    await flushAll(A, B);
    check(A.dom.get('n1') && A.dom.get('n1').x === 61, `(f) a missed own delete at 7: B's block back at 1 and 2 is shown on A (got ${JSON.stringify(A.dom.get('n1'))})`);
    B.del('n1'); await B.reply(); // v3: lower than A's 7
    await flushAll(A, B);
    check(!A.dom.has('n1') && !server.data.has(KEY('n1')), '(f) a missed own delete at 7, then B\'s delete at 3: gone on A');
    B.put(block('n1', 70)); await B.reply();
    B.put(block('n1', 71)); await B.reply();
    await flushAll(A, B);
    check(A.dom.get('n1') && A.dom.get('n1').x === 71, `(f) and A follows B after (got ${JSON.stringify(A.dom.get('n1'))})`);
    B.put(block('n1', 72)); await B.reply();
    await flushAll(A, B);
    check(A.dom.get('n1') && A.dom.get('n1').x === 72, '(f) and keeps following B');
  }
  // A misses the echoes of two deletes of its own (Delete, Undo, Delete again), with or without the Undo's echo too; B
  // brings the block back, deletes it and brings it back again: A follows every step.
  for (const missUndo of [false, true]) {
    const { server, A, B } = await setup();
    A.del('n1'); await A.reply(); // v2
    A.put(block('n1', 0, { fill: 'blue' })); await A.reply(); // Undo: v1
    A.del('n1'); await A.reply(); // v2 again
    A.drop(); // the first delete's echo
    if (missUndo) A.drop(); else await A.event(); // the Undo's echo
    A.drop(); // the second delete's echo
    await flushAll(B);
    B.put(block('n1', 80)); await B.reply(); // v1
    await flushAll(A, B);
    check(A.dom.get('n1') && A.dom.get('n1').x === 80, `(f) two missed own delete echoes${missUndo ? ' and the Undo\'s' : ''}: B's re-create is shown on A`);
    B.del('n1'); await B.reply(); // v2: the same version as both of A's deletes
    await flushAll(A, B);
    check(!A.dom.has('n1') && !server.data.has(KEY('n1')), `(f) two missed own delete echoes${missUndo ? ' and the Undo\'s' : ''}: B's delete at A's version is taken`);
    B.put(block('n1', 81)); await B.reply();
    B.put(block('n1', 82)); await B.reply();
    await flushAll(A, B);
    check(A.dom.get('n1') && A.dom.get('n1').x === 82, `(f) two missed own delete echoes${missUndo ? ' and the Undo\'s' : ''}: A follows B after`);
  }
  // Someone else's older delete numbered the same as this page's (the key started afresh in between): not taken for A's
  // own. C deletes n1 (2); A, not having heard it, writes n1 (a new life, 1) and deletes it (2); A's own echo is missed.
  // A must not draw its own older write again.
  {
    const { server, A, B } = await setup();
    const C = createPage(server, 'C');
    await C.load();
    C.del('n1'); await C.reply(); // v2, by C
    A.put(block('n1', 13)); await A.reply(); // v1 of a new life
    A.del('n1'); await A.reply(); // v2, by A
    await A.event(); // C's delete (2): the same version as A's, someone else's
    await A.event(); // A's own write (1), older than its delete
    A.drop(); // A's own delete (2), missed
    await flushAll(A, B, C);
    check(!A.dom.has('n1') && !server.data.has(KEY('n1')), `(f) someone else's delete with this page's version is not taken for its own: no ghost of A's older write (got ${JSON.stringify(A.dom.get('n1'))})`);
    B.put(block('n1', 90)); await B.reply();
    await flushAll(A, B, C);
    check(A.dom.get('n1') && A.dom.get('n1').x === 90, '(f) and B\'s re-create after is taken');
  }
  // Reads answered out of order while waiting: the older answer, coming last, is not used.
  {
    const { server, A, B } = await setup();
    A.del('n1'); await A.reply(); A.drop(); // A waits, its echo missed
    await flushAll(B);
    A.holdReads = true;
    B.put(block('n1', 30)); await B.reply();
    await A.event(); // a read of the key (it sees 30)
    B.put(block('n1', 31)); await B.reply();
    await A.event(); // another (it sees 31)
    check(A.reads.length === 2, `(f) setup: two reads on their way (got ${A.reads.length})`);
    while (A.reads.length) { A.reads.pop()(); await settle(); } // the newer answer first, then the older
    A.holdReads = false;
    check(A.dom.get('n1') && A.dom.get('n1').x === 31 && server.data.get(KEY('n1')).value.x === 31, `(f) reads answered out of order: the older answer is not used (got ${JSON.stringify(A.dom.get('n1'))})`);
  }
  // A delete by this same person from another page, with another version, is not this page's own: A deletes n1 at 3;
  // the person's other page had deleted it at 2 before (A had not heard): A must not end its wait on that one and draw its
  // own older writes again.
  {
    const { server, A, B } = await setup();
    const A2 = createPage(server, 'A'); // the same person, another page
    await A2.load();
    A2.del('n1'); await A2.reply(); // v2, by A
    A.put(block('n1', 13)); await A.reply(); // v1 of a new life
    A.put(block('n1', 14)); await A.reply(); // v2
    A.del('n1'); await A.reply(); // v3
    await A.event(); // the other page's delete (2)
    await A.event(); // A's own writes (1, 2), older than its delete
    await A.event();
    A.drop(); // A's own delete (3), missed
    await flushAll(A, A2, B);
    check(!A.dom.has('n1') && !server.data.has(KEY('n1')), `(f) the same person's other delete, at another version, is not taken for this page's own (got ${JSON.stringify(A.dom.get('n1'))})`);
  }
  // A misses its delete's echo, then undoes: the echo of its own re-create ends the wait, and B's edit after is taken.
  {
    const { A, B } = await setup();
    A.del('n1');
    await A.reply();
    A.drop();
    A.put(block('n1', 0, { fill: 'blue' }));
    await A.reply();
    await A.event(); // the re-create's echo
    check(A.remote.length === 0, '(f) a missed delete echo, then Undo: A\'s own re-create echo is not drawn again');
    await flushAll(A, B);
    B.put(block('n1', 80, { fill: 'blue' }));
    await flushAll(A, B);
    check(A.dom.get('n1') && A.dom.get('n1').x === 80, '(f) a missed delete echo, then Undo: the echo of its own write ends the wait');
  }
  // A misses the echoes of its delete and of its undo; B edits the block and deletes it: that later delete takes A's
  // block away too (it is gone on the server), and what B does next is taken.
  {
    const { server, A, B } = await setup();
    A.del('n1');
    await A.reply(); // v2
    A.put(block('n1', 0, { fill: 'blue' })); // Undo (v1)
    await A.reply();
    A.drop(); A.drop(); // both echoes missed
    await B.flush();
    B.put(block('n1', 40)); await B.reply(); // v2: not taken on A, which still waits
    B.put(block('n1', 41)); await B.reply(); // v3
    B.del('n1'); await B.reply(); // v4: later than A's delete
    await flushAll(A, B);
    check(!A.dom.has('n1') && !server.data.has(KEY('n1')), '(f) missed echoes, then B\'s later delete: the block is gone on A too');
    B.put(block('n1', 42)); await B.reply();
    await flushAll(A, B);
    check(A.dom.get('n1') && A.dom.get('n1').x === 42, '(f) and B\'s re-create after is taken');
  }
  // load() while waiting: what B does next is taken.
  {
    const { A, B } = await setup();
    A.del('n1');
    await A.reply();
    A.drop();
    await A.load();
    await B.flush();
    B.put(block('n1', 90)); await B.reply();
    await flushAll(A, B);
    check(A.dom.get('n1') && A.dom.get('n1').x === 90, '(f) load() while waiting: B\'s re-create is taken');
  }
  // F3: a delete answered with version 0 (gone already) waits for nothing.
  {
    const { A, B } = await setup();
    B.del('n1'); await B.reply();
    await A.flush(); // A hears B's delete
    A.sync.remove('n1'); // a delete of A's racing it
    await A.reply();
    check(A.replies.length === 0, '(f) setup: the delete is answered');
    B.put(block('n1', 95)); await B.reply();
    await flushAll(A, B);
    check(A.dom.get('n1') && A.dom.get('n1').x === 95, '(f) a delete answered with version 0 leaves no wait: B\'s re-create is taken');
  }
  // A refused delete ends a wait left from an earlier delete, even when its echoes were missed.
  {
    const { server, A, B } = await setup();
    A.del('n1');
    await A.reply(); // deleted (v2): A waits
    A.put(block('n1', 0, { fill: 'blue' })); // Undo: sent at once (v1)
    A.del('n1'); // and Delete again, waiting behind it
    server.refuse.push(Object.assign(new Error('no'), { status: 403 }));
    await A.reply(); // the re-create's answer; the second delete goes and is refused
    await A.reply(); // refused: the block is read again and put back
    check(A.dom.has('n1') && A.refused === 1, '(f) setup: the second delete is refused and the block put back');
    A.drop(); A.drop(); // the first delete's echo and the re-create's: missed
    await B.flush();
    B.put(block('n1', 99, { fill: 'blue' })); await B.reply();
    await flushAll(A, B);
    check(A.dom.get('n1') && A.dom.get('n1').x === 99, '(f) a refused delete ends the wait: B\'s edit after is taken');
  }
  // A read while waiting (after a refused write) counts as seen for when the wait ends: B's block is drawn once.
  {
    const { server, A, B } = await setup();
    A.del('n1');
    await A.reply(); // A waits
    await B.flush();
    B.put(block('n1', 30)); await B.reply(); // B brings it back (v1)
    server.refuse.push(Object.assign(new Error('no'), { status: 403 }));
    A.put(block('n1', 0)); // A's undo, refused: A reads the key again and shows B's
    await A.reply();
    await flushAll(A, B);
    check(A.dom.get('n1') && A.dom.get('n1').x === 30, '(f) a refused write while waiting: A shows what the server holds');
    check(putsOf(A, 'n1').length === 1, `(f) and B's block is drawn once, not again when its echo comes (got ${putsOf(A, 'n1').length})`);
  }
}

// (g) Lanes: what is heard while this page is writing, or about to.
async function testLanes() {
  // A change heard while a write is waiting to go (saveSoon) is not drawn over it when an earlier write ends.
  {
    const { server, A, B } = await setup();
    A.put(block('n1', 5)); // on its way
    B.put(block('n1', 20)); await B.reply();
    await A.event(); await A.event(); // A's own echo and B's, both wait for A's write
    A.sync.saveSoon(block('n1', 6)); A.dom.set('n1', block('n1', 6)); // a nudge, sent in a moment
    await A.reply(); // the first write is answered; the nudge is still waiting
    check(!A.remote.some((c) => c.op === 'put'), '(g) what was heard is not judged while a write still waits to go');
    await runTimers();
    await flushAll(A, B);
    check(A.dom.get('n1').x === 6 && B.dom.get('n1').x === 6 && server.data.get(KEY('n1')).value.x === 6, '(g) A\'s nudge is the last write: everyone shows it');
  }
  // load() with a write of this page's waiting to go: the page keeps showing it, and it lands.
  {
    const { server, A, B } = await setup();
    A.sync.saveSoon(block('n1', 44)); A.dom.set('n1', block('n1', 44));
    await A.load();
    check(A.dom.get('n1') && A.dom.get('n1').x === 44, '(g) load() keeps this page\'s own write that has not gone yet');
    await runTimers();
    await flushAll(A, B);
    check(A.dom.get('n1').x === 44 && B.dom.get('n1').x === 44 && server.data.get(KEY('n1')).value.x === 44, '(g) and it lands everywhere');
  }
  // flush() sends what is waiting at once.
  {
    const { server, A } = await setup();
    A.sync.saveSoon(block('n1', 9));
    A.sync.flush();
    check(A.replies.length === 1 && timers.length === 0, '(g) flush() sends a waiting write at once');
    await A.flush();
    check(server.data.get(KEY('n1')).value.x === 9, '(g) and it is saved');
  }
}

// (h) The fuzz: three pages, fixed seeds. Random creates, edits (now or soon), deletes, undos (the same id back), reloads
// (while none of the page's own writes is on its way),
// and random delivery: each page's answers and events come in their own order, interleaved at random, and on some seeds a
// page misses the echo of its own delete now and then. Every page must show what the server holds once everything is
// delivered, missed echoes or not; and still after each key has had a later delete (a version past any it had) and come
// back. SEEDS=n in the environment runs n seeds (3000 unless given).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
async function testFuzz(seeds) {
  const same = (P, server) => {
    const want = new Map([...server.data].map(([k, e]) => [k.slice(KEY('').length), JSON.stringify(e.value)]));
    if (P.dom.size !== want.size) return false;
    for (const [id, b] of P.dom) if (want.get(id) !== JSON.stringify(b)) return false;
    return true;
  };
  let bad = 0;
  for (let seed = 1; seed <= seeds; seed += 1) {
    const r = rng(seed);
    const pick = (list) => list[Math.floor(r() * list.length)];
    timers = [];
    const server = createServer();
    const pages = ['A', 'B', 'C'].map((n) => createPage(server, n));
    const drops = seed % 2 === 0; // even seeds miss own-delete echoes now and then
    const deletedBy = pages.map(() => new Map()); // page -> id -> the block as it was before this page deleted it
    let n = 0;
    const make = (P, id, from = {}) => ({ ...from, id, type: 'note', x: (n += 1), y: 0, by: P.name });
    const deliver = async (P) => {
      if (P.replies.length && (!P.inbox.length || r() < 0.5)) { await P.reply(); return; }
      if (!P.inbox.length) return;
      const e = P.inbox[0];
      if (drops && e.deleted && e.by === P.name && r() < 0.3) { P.drop(); return; }
      await P.event();
    };
    try {
      for (let step = 0; step < 60; step += 1) {
        const i = Math.floor(r() * 3);
        const P = pages[i];
        const roll = r();
        const ids = [...P.dom.keys()];
        if (roll < 0.12) P.put(make(P, `b${(n += 1)}`));
        else if (roll < 0.25 && ids.length) { const id = pick(ids); P.put(make(P, id, P.dom.get(id))); }
        else if (roll < 0.30 && ids.length) { const id = pick(ids); const b = make(P, id, P.dom.get(id)); P.dom.set(id, b); P.sync.saveSoon(b); }
        else if (roll < 0.40 && ids.length) { const id = pick(ids); deletedBy[i].set(id, P.dom.get(id)); P.del(id); }
        else if (roll < 0.47 && deletedBy[i].size) { const id = pick([...deletedBy[i].keys()]); const was = deletedBy[i].get(id); deletedBy[i].delete(id); if (!P.dom.has(id)) P.put(make(P, id, was)); }
        else if (roll < 0.50 && timers.length) { const t = timers.shift(); t.fn(); await settle(); }
        else if (roll < 0.52 && !P.replies.length) await P.load(); // a read again with no write of its own on its way
        else if (roll < 0.53) P.sync.flush();
        else await deliver(P);
      }
      // Everything still on its way is delivered (in a random order, still with missed own-delete echoes).
      for (let k = 0; k < 2000; k += 1) {
        if (timers.length && r() < 0.2) { const t = timers.shift(); t.fn(); await settle(); continue; }
        const busy = pages.filter((P) => P.replies.length || P.inbox.length);
        if (!busy.length) { if (!timers.length) break; continue; }
        await deliver(pick(busy));
      }
      // Every page shows what the server holds, missed echoes or not: no page is ever left blind to a key.
      const now = pages.every((P) => same(P, server));
      let ok = now;
      if (now) {
        // Each key gets a later delete (a version past any it had), then comes back: every page must follow.
        for (const [key, top] of [...server.versions]) {
          const id = key.slice(KEY('').length);
          const W = pick(pages);
          W.put(make(W, id));
          await W.flush();
          while (server.data.get(key).version <= top) { W.put(make(W, id)); await W.flush(); }
          W.del(id);
          await flushAll(...pages);
          W.put(make(W, id));
          await flushAll(...pages);
        }
        ok = pages.every((P) => same(P, server));
      }
      if (!ok) { bad += 1; if (bad <= 5) fails.push(`(h) fuzz seed ${seed}: ${pages.filter((P) => !same(P, server)).map((P) => P.name).join(', ')} differ from the server${now ? ' after a later delete and a re-create of each key' : ' once everything is delivered'}`); }
    } catch (err) {
      bad += 1;
      if (bad <= 5) fails.push(`(h) fuzz seed ${seed}: ${err.message}`);
    }
  }
  check(bad === 0, `(h) fuzz: ${bad} of ${seeds} seeds end with a page that differs from the server`);
}

const SEEDS = Number(process.env.SEEDS) || 3000;
const started = Date.now();
await testDeleteUndoThenRemote();
await testTwoDeferred();
await testRaceAllOrders();
await testGuarantees();
await testWait();
await testLanes();
await testFuzz(SEEDS);
if (failed) {
  for (const f of fails) console.error(`FAIL ${f}`);
  console.error(`check-whiteboard-sync: ${failed} failed, ${passed} passed (${path.relative(root, file)})`);
  process.exit(1);
}
console.log(`check-whiteboard-sync: OK, ${passed} cases (the fuzz: ${SEEDS} seeds), ${((Date.now() - started) / 1000).toFixed(1)} s`);
