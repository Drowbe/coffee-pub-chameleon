#!/usr/bin/env node
/*
 * check-whiteboard-boards.mjs -- several boards in one space: the storage and sync for each board
 * (modules/whiteboard/src/whiteboard-lib-s-boards.js, with lib-c; GitHub #555, job 1; plan-whiteboard-boards.md).
 * Guards, with no page (fake host storage, fake timers, a fake localStorage):
 *   - the pure rules: wbCleanBoardRecord (hostile input), wbBoardList (the implicit first board, the trash, order ties, more than
 *     10), wbNewBoardId, wbNextOrder, wbCanCreateBoard, wbLanding, the key builders;
 *   - the session of two boards on one server: a write for A never lands in B and a read on B shows only B; two boards keep the
 *     same block id; a late event from the old board is ignored; a read answered after a switch is told stale; the hard guard
 *     refuses a write whose key is not under the board's own prefix (and any write of a sync that was switched away from);
 *   - the kept writes (0.1.51): R1 a switch flushes the old board's waiting, refused (429) and parked writes, which land under
 *     the old board; R2 dropPending removes only that board's entries and nothing is sent for it afterwards; R3 the sweep removes
 *     entries of boards that are neither listed nor in the trash, keeps the others, and does nothing before the list is read;
 *     R4 a replay is for the board being opened only;
 *   - the board list is read and kept current by its own sync; the history is one for each board.
 * Usage: node modules/whiteboard/test/check-whiteboard-boards.mjs [path to the src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
let timers = [];
let seq = 0;
const fakeSetTimeout = (fn, ms) => { const id = ++seq; timers.push({ id, fn, ms }); return id; };
const fakeClearTimeout = (id) => { timers = timers.filter((t) => t.id !== id); };
const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => { setImmediate(r); }); };
async function runTimers() { for (let i = 0; i < 300 && timers.length; i += 1) { const t = timers.shift(); t.fn(); await settle(); } }

let passed = 0;
const fails = [];
const ok = (c, m) => { if (c) passed += 1; else fails.push(m); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const NAMES = ['createSync', 'createBoardSession', 'wbClean', 'wbCleanBoard', 'wbCleanBoardRecord', 'wbBoardList', 'wbKnownBoardIds', 'wbNewBoardId', 'wbNextOrder',
  'wbCanCreateBoard', 'wbLanding', 'wbBlockPrefix', 'wbSettingsPrefix', 'wbPresentKey', 'wbDropPending', 'wbSweepPending', 'wbPerBoard', 'createHistory',
  'WB_BOARD_MAX', 'wbBoardNameProblem', 'wbPurgePlan', 'WB_BOARD_FIRST', 'WB_BOARD_LAST', 'WB_BOARD_NAME_MAX', 'WB_BOARD_ID'];
let L = {};
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-[a-z]-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  const grab = NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  L = new Function('window', 'document', 'setTimeout', 'clearTimeout', `${parts.join('\n')}\nreturn { ${grab} };`)({ devicePixelRatio: 1 }, undefined, fakeSetTimeout, fakeClearTimeout);
} catch (err) { fails.push(`the libs do not load: ${err.message}`); }
const missing = NAMES.filter((n) => typeof L[n] === 'undefined');
if (missing.length) fails.push(`the libs have no ${missing.join(', ')}`);

function finish() {
  if (fails.length) { for (const f of fails) console.error(`FAIL ${f}`); console.error(`check-whiteboard-boards: ${fails.length} failed, ${passed} passed`); process.exit(1); }
  console.log(`check-whiteboard-boards: OK, ${passed} checks`);
}
if (missing.length || !L.createBoardSession) { finish(); process.exit(1); }

// ---- the pure rules --------------------------------------------------------------------------------------------------
const rec = (id, extra = {}) => ({ id, type: 'board-record', name: `Board ${id}`, order: 1, by: 'u1', at: '2026-11-12T10:00:00.000Z', ...extra });
{
  const c = L.wbCleanBoardRecord;
  const good = c(rec('b2'));
  ok(good && good.id === 'b2' && good.name === 'Board b2' && good.order === 1 && good.deleted === false && good.trashedAt === '' && good.type === 'board-record', 'a good record is kept as it is');
  ok(same(Object.keys(good), ['id', 'type', 'name', 'order', 'by', 'at', 'deleted', 'trashedAt']), 'its fields are exactly these');
  const hostile = [null, undefined, 0, 'x', [], [rec('b2')], {}, rec('B2'), rec('b2:x'), rec(''), rec('a'.repeat(17)), rec('b 2'), rec('b2\n'), rec('__proto__'), rec('b2', { name: '' }), rec('b2', { name: '   ' }),
    rec('b2', { name: '\u0000\u0007' }), rec('b2', { name: 5 }), rec('b2', { name: null }), rec('b2', { order: NaN }), rec('b2', { order: Infinity }), rec('b2', { order: '1' }), rec('b2', { order: null }), rec('b2', { order: undefined })];
  ok(hostile.every((h) => c(h) === null), 'hostile records (not an object, a bad id, no name, a name of only controls, an order that is not a finite number) are null');
  ok(c(rec('b2', { name: `  A\u0000 very\n\n long  ${'x'.repeat(80)}` })).name.length <= L.WB_BOARD_NAME_MAX, 'a long name is cut to the maximum');
  ok(c(rec('b2', { name: 'A\u0000B\tC D' })).name === 'A B C D', 'control characters become spaces and runs of spaces fold');
  ok(c(rec('b2', { name: '<b>x</b>' })).name === '<b>x</b>', 'the name is plain text (escaping is the drawing\'s)');
  ok(c(rec('b2', { order: 1e30 })).order === 1e9 && c(rec('b2', { order: -1e30 })).order === -1e9, 'an order is held within a range');
  ok(!('evil' in c({ ...rec('b2'), evil: 1, __proto__: { x: 1 } })), 'unknown fields are dropped');
  const t = c(rec('b2', { trashedAt: '2026-11-12T10:00:00Z' }));
  ok(t.deleted === true && t.trashedAt.startsWith('2026'), 'a trashedAt marks the record deleted');
  ok(c(rec('b2', { deleted: true })).deleted === true && c(rec('b2', { deleted: 'yes' })).deleted === false, '`deleted` is true only for true');
  ok(c(rec('b2', { by: 5, at: {} })).by === '' && c(rec('b2', { by: 5, at: {} })).at === '', 'by and at that are not text are empty');
  ok(c(rec('b2', { by: 'x'.repeat(500), trashedAt: 'y'.repeat(500) })).by.length === 64 && c(rec('b2', { trashedAt: 'y'.repeat(500) })).trashedAt.length === 40, 'by and trashedAt are cut');
  ok(L.wbCleanBoard({ id: 'settings', background: 'default' }).type === 'board' && c({ id: 'settings', name: 'x', order: 0 }).id === 'settings', 'the settings cleaner is its own (wbCleanBoard) and the record cleaner is wbCleanBoardRecord');
}
{
  const ids = (l) => l.map((r) => r.id).join(',');
  let l = L.wbBoardList([]);
  ok(l.length === 1 && l[0].id === 'main' && l[0].name === 'Board 1' && l[0].implicit === true, 'no records: one implicit board, main, "Board 1"');
  ok(same(L.wbBoardList(undefined).map((r) => r.id), ['main']) && same(L.wbBoardList('x').map((r) => r.id), ['main']), 'not a list: the same one board');
  l = L.wbBoardList([rec('main', { name: 'Plans', order: 0 })]);
  ok(l.length === 1 && l[0].name === 'Plans' && !l[0].implicit, 'a main record is the first board, not implicit');
  l = L.wbBoardList([rec('b2', { order: 1 })]);
  ok(ids(l) === 'main,b2' && l[0].implicit, 'a second board with no main record: the implicit main is first');
  l = L.wbBoardList([rec('main', { order: 0, trashedAt: '2026-11-12T10:00:00Z' }), rec('b2')]);
  ok(ids(l) === 'b2', 'main in the trash: it is not listed and not implied');
  l = L.wbBoardList([rec('b2', { trashedAt: '2026-11-12T10:00:00Z' })]);
  ok(ids(l) === 'main', 'a trashed second board is not listed');
  l = L.wbBoardList([rec('b3', { order: 2 }), rec('b2', { order: 1 }), rec('main', { order: 0 })]);
  ok(ids(l) === 'main,b2,b3', 'sorted by order');
  l = L.wbBoardList([rec('bb', { order: 1, at: '2026-11-12T10:00:02.000Z' }), rec('ba', { order: 1, at: '2026-11-12T10:00:01.000Z' }), rec('bz', { order: 1, at: '2026-11-12T10:00:01.000Z' })]);
  ok(ids(l) === 'main,ba,bz,bb', 'ties by order go by when made, then by id');
  l = L.wbBoardList([rec('b2', { order: 5 }), rec('b2', { order: 1 }), rec('b2', { order: 3 })]);
  ok(l.filter((r) => r.id === 'b2').length === 1, 'an id is listed once');
  l = L.wbBoardList(Array.from({ length: 14 }, (_, i) => rec(`x${i}`, { order: i + 1 })));
  ok(l.length === 15 && L.WB_BOARD_MAX === 10, 'more than 10 boards all stand (two people can pass the limit at once)');
  ok(L.wbBoardList([{ id: 'bad id', name: 'x', order: 1 }, null, 7, rec('b2')]).length === 2, 'records that are not boards are left out');
  ok(L.wbCanCreateBoard(L.wbBoardList([])) === true && L.wbCanCreateBoard(Array.from({ length: 9 }, (_, i) => ({ id: `a${i}` }))) === true
    && L.wbCanCreateBoard(Array.from({ length: 10 }, (_, i) => ({ id: `a${i}` }))) === false && L.wbCanCreateBoard(Array.from({ length: 12 }, () => ({}))) === false && L.wbCanCreateBoard(null) === true, 'a board may be made under 10, not at 10 or more');
  ok(L.wbNextOrder([]) === 0 && L.wbNextOrder(L.wbBoardList([])) === 1 && L.wbNextOrder(L.wbBoardList([rec('b2', { order: 7 })])) === 8 && L.wbNextOrder(null) === 0, 'the next order is after the last');
  ok(L.wbNextOrder([{ order: NaN }, { order: 3 }, null]) === 4, 'a bad order in the list is ignored');
  ok(L.wbLanding(L.wbBoardList([rec('b2')]), 'b2') === 'b2' && L.wbLanding(L.wbBoardList([rec('b2')]), 'gone') === 'main' && L.wbLanding(L.wbBoardList([rec('b2')]), null) === 'main'
    && L.wbLanding(L.wbBoardList([rec('b2'), rec('main', { trashedAt: 'x' })]), 'main') === 'b2' && L.wbLanding([], 'b2') === 'main' && L.wbLanding(L.wbBoardList([rec('b2')]), 5) === 'main',
  'landing: the last board if listed, else the first (never a trashed one)');
  let a = 12345;
  const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const seen = new Set();
  let good = true;
  for (let i = 0; i < 500; i += 1) { const id = L.wbNewBoardId(rnd, [...seen]); if (!/^[a-z0-9]{1,16}$/.test(id) || id === 'main' || seen.has(id)) good = false; seen.add(id); }
  ok(good, 'wbNewBoardId: 500 ids, each a plain id, never main, never taken');
  ok(L.wbNewBoardId(() => 0) === 'aaaaaaaa' && /^[a-z0-9]{8}$/.test(L.wbNewBoardId()) && /^[a-z0-9]{1,16}$/.test(L.wbNewBoardId(() => 5)) && /^[a-z0-9]{1,16}$/.test(L.wbNewBoardId(() => NaN)), 'wbNewBoardId copes with a random that is 0, out of range or not a number');
  ok(L.wbNewBoardId(() => 0, ['aaaaaaaa']) !== 'aaaaaaaa', 'a taken id is not given again, even when random repeats');
  ok(L.wbBlockPrefix('b2') === 'block:b2:' && L.wbSettingsPrefix('b2') === '_board:b2:' && L.wbPresentKey('b2') === '_present:b2:state' && L.WB_BOARD_LAST('sp1') === 'wb-board:sp1', 'the key builders');
  ok(L.WB_BOARD_FIRST === 'main', 'the first board is main');
  ok(L.wbKnownBoardIds([rec('b2'), rec('b3', { trashedAt: 'x' })]).has('b3') && L.wbKnownBoardIds([]).has('main') && !L.wbKnownBoardIds([rec('b2')]).has('zz'), 'known ids: listed, trashed and main');
}

// ---- a fake server and a fake localStorage ---------------------------------------------------------------------------
const makeStore = () => { const m = new Map(); return { m, get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; };
function makeServer() {
  const data = new Map();
  const log = [];
  let v = 0;
  const srv = {
    data,
    log,
    refuse: null, // (key) => boolean: answer 429
    failList: false,
    holdList: null, // a promise the next list waits for
    keys: (prefix = '') => [...data.keys()].filter((k) => k.startsWith(prefix)).sort(),
    host: {
      storage: {
        async set(key, value) { if (srv.refuse && srv.refuse(key)) throw Object.assign(new Error('busy'), { status: 429, retryAfter: 1 }); log.push(`set ${key}`); data.set(key, value); v += 1; return { version: v }; },
        async delete(key) { if (srv.refuse && srv.refuse(key)) throw Object.assign(new Error('busy'), { status: 429, retryAfter: 1 }); log.push(`delete ${key}`); const had = data.delete(key); v += 1; return { version: had ? v : 0 }; },
        async list(prefix = '') {
          if (srv.failList) throw new Error('down');
          const hold = srv.holdList; srv.holdList = null; if (hold) await hold;
          return [...data].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value, version: 1 }));
        },
        async get(key) { return data.has(key) ? { value: data.get(key), version: 1 } : null; },
      },
    },
  };
  return srv;
}
const blk = (id, extra = {}) => ({ id, type: 'note', x: 0, y: 0, z: 1, w: 180, h: 160, text: 'T', fill: 'gold', stroke: 'auto', ink: 'ink', weight: 1, ...extra });
const seedBlock = (srv, board, id, extra) => srv.data.set(`block:${board}:${id}`, blk(id, extra));
// A session over a fake server: what the page would draw is logged.
function open(srv, store, over = {}) {
  const log = { drawn: [], settings: [], lists: [], refused: [], reloads: 0 };
  const session = L.createBoardSession({
    host: srv.host, scope: 'sp1', me: 'u1', store, clean: L.wbClean, cleanSettings: L.wbCleanBoard,
    handlers: {
      onRemote: (c) => log.drawn.push(c), onReload: () => { log.reloads += 1; }, onSettings: (c) => log.settings.push(c), onSettingsReload() {},
      onList: (l) => log.lists.push(l.map((r) => r.id).join(',')), onRefused: (e, id) => log.refused.push([e && e.status, id]), onBusy() {},
    },
    ...over,
  });
  return { session, log, store, srv };
}
const shown = async (session) => (await session.sync.load()).map((b) => b.id).sort();

// ---- two boards on one server ----------------------------------------------------------------------------------------
{
  const srv = makeServer(); const store = makeStore();
  seedBlock(srv, 'main', 'a1'); seedBlock(srv, 'main', 'shared', { text: 'main one' });
  seedBlock(srv, 'b2', 'x1'); seedBlock(srv, 'b2', 'shared', { text: 'b2 one' });
  const { session, log } = open(srv, store);
  session.start('main');
  ok(session.id === 'main' && session.epoch === 0, 'a session starts on main, epoch 0');
  ok(same(await shown(session), ['a1', 'shared']), 'a read on main shows only main\'s blocks');
  const mainShared = (await session.sync.load()).find((b) => b.id === 'shared');
  ok(mainShared.text === 'main one', 'and main\'s own copy of a block id both boards have');
  session.sync.save(blk('m-new'));
  await settle();
  ok(srv.data.has('block:main:m-new') && !srv.keys('block:b2:').includes('block:b2:m-new'), 'a write for main lands under block:main: and not in b2');
  const before = srv.keys();
  ok(session.use('b2') === true && session.id === 'b2' && session.epoch === 1, 'use(b2): the board is b2, a new epoch');
  ok(same(await shown(session), ['shared', 'x1']), 'a read on b2 shows only b2\'s blocks');
  ok((await session.sync.load()).find((b) => b.id === 'shared').text === 'b2 one', 'two boards with the same block id keep both');
  session.sync.save(blk('b-new'));
  session.sync.save(blk('shared', { text: 'b2 edited' }));
  session.sync.remove('x1');
  await settle();
  const after = srv.keys();
  ok(same(after.filter((k) => k.startsWith('block:main:')), before.filter((k) => k.startsWith('block:main:'))), 'main\'s keys are the same after writes on b2');
  ok(srv.data.get('block:main:shared').text === 'main one', 'and main\'s block with the shared id is untouched');
  ok(same(srv.keys('block:b2:'), ['block:b2:b-new', 'block:b2:shared']), 'b2 holds its own keys (x1 deleted, b-new added)');
  ok(srv.log.every((e) => /^(set|delete) block:(main:m-new|b2:)/.test(e)), 'every write the server saw is under the board it was made for');
  session.boardSync.save({ id: 'settings', type: 'board', background: 'gold' });
  await settle();
  ok(srv.data.has('_board:b2:settings') && !srv.data.has('_board:main:settings'), 'the settings of b2 are written to _board:b2:settings only');
  ok(same((await session.boardSync.load()).map((b) => b.background), ['gold']), 'and read from it');
  session.use('main');
  ok((await session.boardSync.load()).length === 0, 'main has no settings: they read as the default');
  ok(session.use('main') === false && session.use('NOPE') === false && session.use('b2:x') === false && session.use('') === false && session.use(null) === false && session.id === 'main', 'use() of the board shown or of something that is not a board id does nothing');
  let threw = false; try { open(srv, store).session.start('b:2'); } catch { threw = true; }
  ok(threw, 'start() with a bad id throws');
}

// ---- a late event from the old board; a stale read; the hard guard ---------------------------------------------------
{
  const srv = makeServer(); const store = makeStore();
  seedBlock(srv, 'main', 'a1');
  const { session, log } = open(srv, store);
  session.start('main');
  const oldSync = session.sync; const oldSettings = session.boardSync;
  await session.sync.load();
  session.use('b2');
  const ev = (key, extra = {}) => ({ key, scope: 'space', version: 5, value: blk(key.split(':')[2]), by: 'u2', updatedAt: new Date().toISOString(), ...extra });
  session.handle(ev('block:main:late'));
  session.handle({ key: 'block:main:a1', scope: 'space', deleted: true, version: 6, by: 'u2' });
  session.handle(ev('_board:main:settings', { value: { id: 'settings', type: 'board', background: 'gold' } }));
  ok(log.drawn.length === 0 && log.settings.length === 0, 'a late change from the old board\'s keys is not drawn on the new board');
  oldSync.handle(ev('block:main:late2'));
  oldSync.handleMany({ scope: 'space', changes: [ev('block:main:late3')] });
  ok(log.drawn.length === 0, 'and the old sync itself, called late, reports nothing');
  session.handle(ev('block:b2:fresh'));
  ok(log.drawn.length === 1 && log.drawn[0].block.id === 'fresh', 'a change under the new board\'s prefix is drawn');
  session.handle(ev('block:b2x:other'));
  session.handle(ev('block:b22:other'));
  ok(log.drawn.length === 1, 'a board whose id only begins like this one\'s is not heard');
  session.handleMany({ scope: 'space', cleared: true });
  ok(log.reloads === 1, 'a Clear is heard once (the old sync does not ask for a reload)');
  // a refetch of the old board that answers after the switch draws nothing
  const srv2 = makeServer(); seedBlock(srv2, 'main', 'k1');
  const o2 = open(srv2, makeStore());
  o2.session.start('main');
  await o2.session.sync.load();
  o2.session.handle({ key: 'block:main:k1', scope: 'space', version: 9, by: 'u2' }); // no value: a refetch
  o2.session.use('b2'); // before the refetch answers
  await settle();
  ok(o2.log.drawn.length === 0, 'a refetch of the old board answered after the switch draws nothing');
  // a stale read: the caller holds the epoch
  const srv3 = makeServer(); seedBlock(srv3, 'main', 'k1');
  const o3 = open(srv3, makeStore());
  o3.session.start('main');
  let release; srv3.holdList = new Promise((r) => { release = r; });
  const my = o3.session.epoch; const pending = o3.session.sync.load();
  o3.session.use('b2');
  release(); const got = await pending;
  ok(got.length === 1 && o3.session.current(my) === false && o3.session.current(o3.session.epoch) === true, 'a read of the old board answered after a switch is told stale (current(epoch) is false), so the page drops it');
  // the hard guard
  const g = open(makeServer(), makeStore());
  g.session.start('b2');
  const s = g.session.sync;
  ok(s.owns('block:b2:x') && !s.owns('block:main:x') && !s.owns('block:b2:') && !s.owns('block:b2:x:y') && !s.owns('_board:b2:settings') && !s.owns(5) && !s.owns('block:b22:x'), 'a sync owns only keys under its prefix, one segment deep');
  ok(s.save(blk('ok1')) === true, 'a write under the prefix is accepted');
  for (const id of ['main:x', 'a:b', '', ':', undefined, null, 5, {}]) ok(s.save({ ...blk('x'), id }) === false && s.saveSoon({ ...blk('x'), id }) === false && s.remove(id) === false, `a write for the id ${JSON.stringify(id)} is refused`);
  await settle();
  ok(g.log.refused.length >= 8 * 3 && g.log.refused.every(([st]) => st === 0), 'each refusal is told to onRefused');
  ok(g.session.sync.pending() === 0, 'a refused write is not kept');
  const gsrv = g.session.sync; g.session.use('main');
  ok(gsrv.save(blk('late')) === false && gsrv.saveSoon(blk('late')) === false && gsrv.remove('late') === false, 'a sync that was switched away from takes no new write');
  await settle(); await runTimers();
  ok(g.srv.data.size === 1 && [...g.store.m.keys()].every((k) => !/wb-pending/.test(k)) , 'and nothing was kept for it');
  ok(oldSync.closed === true && session.sync.closed === false, 'close() marks the old sync closed');
}

// ---- R1: a switch sends what waits for the old board, under the old board's keys ------------------------------------------
const entryKey = (board, kind = 'block') => `wb-pending:sp1:${kind === 'block' ? `block:${board}:` : `_board:${board}:`}`;
{
  // (a) a write waiting on the 600 ms timer
  const srv = makeServer(); const store = makeStore();
  const { session } = open(srv, store);
  session.start('main');
  session.sync.saveSoon(blk('w1'));
  await settle();
  ok(!srv.data.has('block:main:w1'), 'setup: the write is waiting on the timer, not sent');
  session.use('b2');
  await settle();
  ok(srv.data.has('block:main:w1') && !srv.keys('block:b2:').length, 'R1 timer: a switch sends the waiting write, under main, and nothing under b2');
  ok(timers.length === 0 && !store.m.has(entryKey('main')), 'R1 timer: the timer is gone and nothing stays kept once it was accepted');
  session.sync.saveSoon(blk('w2'));
  session.use('main');
  await settle();
  ok(srv.data.has('block:b2:w2') && !srv.data.has('block:main:w2'), 'R1 timer: and the other way round');
}
{
  // (b) a 429 at the moment of the switch: the retry is on its wait
  timers = [];
  const srv = makeServer(); const store = makeStore();
  const { session } = open(srv, store);
  srv.refuse = (k) => k.startsWith('block:main:');
  session.start('main');
  session.sync.save(blk('p1'));
  session.boardSync.save({ id: 'settings', type: 'board', background: 'gold' });
  await settle();
  ok(session.sync.pending() === 1 && store.m.has(entryKey('main')), 'setup: the refused write is kept in the browser for main');
  session.use('b2');
  session.sync.save(blk('p2')); // b2 writes meanwhile
  await settle();
  ok(srv.data.has('block:b2:p2'), 'R1 429: b2 writes freely meanwhile');
  srv.refuse = null;
  await runTimers();
  ok(srv.data.has('block:main:p1') && !srv.data.has('block:b2:p1'), 'R1 429: the write parked at the switch lands under main and never under b2');
  ok(srv.data.has('_board:main:settings') && !srv.data.has('_board:b2:settings'), 'R1 429: so does the settings write');
  ok(!store.m.has(entryKey('main')) && !store.m.has(entryKey('main', 'settings')), 'R1 429: and the kept entry goes once the server accepted');
}
{
  // (c) parked for a minute (8 refusals) at the switch
  timers = [];
  const srv = makeServer(); const store = makeStore();
  const { session } = open(srv, store);
  srv.refuse = (k) => k.startsWith('block:main:');
  session.start('main');
  session.sync.save(blk('q1'));
  for (let i = 0; i < 12; i += 1) { await settle(); const t = timers.shift(); if (t) t.fn(); }
  await settle();
  ok(session.sync.pending() === 1, 'setup: the write is parked after its refusals, still kept');
  session.use('b2');
  const kept = JSON.parse(store.getItem(entryKey('main')));
  ok(kept && kept.items['block:main:q1'] && kept.items['block:main:q1'].op === 'put', 'R1 parked: the switch leaves it kept in the browser');
  srv.refuse = null;
  await runTimers();
  ok(srv.data.has('block:main:q1') && !srv.keys('block:b2:').length, 'R1 parked: after the minute it lands under main, nothing under b2');
  ok(!store.m.has(entryKey('main')), 'R1 parked: and is forgotten when accepted');
}
{
  // (d) the page is closed instead: the kept entry is replayed only when main is opened again (R4 below), never into b2
  timers = [];
  const srv = makeServer(); const store = makeStore();
  const { session } = open(srv, store);
  srv.refuse = (k) => k.startsWith('block:main:');
  session.start('main');
  session.sync.save(blk('r1'));
  await settle();
  session.use('b2');
  timers = []; // the page goes: its timers die
  const again = open(srv, store); srv.refuse = null;
  again.session.start('b2'); await again.session.sync.load(); again.session.sync.replay(); await settle();
  ok(!srv.data.has('block:main:r1') && !srv.keys('block:b2:').length && store.m.has(entryKey('main')), 'R1 reload: opening b2 does not send main\'s leftover, and it stays kept');
  again.session.use('main'); await again.session.sync.load(); const left = again.session.sync.replay(); await settle();
  ok(left.put.length === 1 && srv.data.has('block:main:r1') && !store.m.has(entryKey('main')), 'R1 reload: opening main sends it, under main');
}

// ---- R2: dropPending ---------------------------------------------------------------------------------------------------
{
  timers = [];
  const store = makeStore();
  const plant = (k) => store.setItem(k, JSON.stringify({ t: Date.now(), by: 'u1', items: {} }));
  const keys = [entryKey('b2'), entryKey('b2', 'settings'), entryKey('main'), entryKey('main', 'settings'), 'wb-pending:other:block:b2:', 'wb-pending:other:_board:b2:', 'wb-pending:sp1:board:', entryKey('b22'), entryKey('b3'), 'unrelated', 'wb-pending:sp1:block:b2'];
  keys.forEach(plant);
  const { session } = open(makeServer(), store);
  ok(session.dropPending('b2') === 2, 'R2: dropPending(b2) removes two entries (its blocks\' and its settings\')');
  ok(!store.m.has(entryKey('b2')) && !store.m.has(entryKey('b2', 'settings')), 'R2: those are gone');
  ok(keys.filter((k) => k !== entryKey('b2') && k !== entryKey('b2', 'settings')).every((k) => store.m.has(k)), 'R2: every other entry stays (main, b22, b3, another space, the list\'s, an unrelated key)');
  ok(session.dropPending('b2') === 0 && session.dropPending('zz') === 0, 'R2: dropping again, or an unknown board, removes nothing');
  // in memory too: nothing is sent afterwards
  const srv = makeServer(); const st2 = makeStore();
  const o = open(srv, st2);
  srv.refuse = (k) => k.startsWith('block:b2:');
  o.session.start('b2');
  o.session.sync.save(blk('d1'));
  o.session.sync.saveSoon(blk('d2'));
  await settle();
  o.session.use('main'); // d1 is parked on its 429 wait, d2 was sent (refused) by the flush
  await settle();
  ok(st2.m.has(entryKey('b2')), 'setup: b2 has kept writes');
  o.session.dropPending('b2');
  srv.refuse = null;
  await runTimers();
  ok(!srv.keys('block:b2:').length && !st2.m.has(entryKey('b2')), 'R2: the board is deleted: its parked writes are never sent and its entry is gone');
  o.session.sync.save(blk('ok-main')); await settle();
  ok(srv.data.has('block:main:ok-main'), 'R2: other boards go on writing');
  // the board shown
  const srv3 = makeServer(); const st3 = makeStore();
  const o3 = open(srv3, st3);
  srv3.refuse = (k) => k.startsWith('block:main:');
  o3.session.start('main');
  o3.session.sync.save(blk('e1')); o3.session.sync.saveSoon(blk('e2'));
  await settle();
  o3.session.dropPending('main'); srv3.refuse = null;
  await runTimers();
  ok(!srv3.keys('block:main:').length && !st3.m.has(entryKey('main')), 'R2: dropping the board shown throws away its waiting and parked writes too');
}

// ---- R3: the sweep after the list is read -----------------------------------------------------------------------------------
{
  timers = [];
  const srv = makeServer(); const store = makeStore();
  srv.data.set('board:b2', rec('b2')); srv.data.set('board:t1', rec('t1', { trashedAt: '2026-11-12T10:00:00Z' }));
  const plant = (k) => store.setItem(k, JSON.stringify({ t: Date.now(), by: 'u1', items: {} }));
  const gone = [entryKey('zz'), entryKey('zz', 'settings'), entryKey('q9')];
  const stays = [entryKey('main'), entryKey('b2'), entryKey('b2', 'settings'), entryKey('t1'), 'wb-pending:other:block:zz:', 'wb-pending:sp1:board:', 'unrelated'];
  [...gone, ...stays].forEach(plant);
  const { session, log } = open(srv, store);
  session.start('main');
  ok(session.listRead === false && session.sweep() === 0 && gone.every((k) => store.m.has(k)), 'R3: before the list is read the sweep removes nothing');
  srv.failList = true;
  let failed = false; try { await session.loadList(); } catch { failed = true; }
  srv.failList = false;
  ok(failed && session.listRead === false && session.sweep() === 0 && gone.every((k) => store.m.has(k)), 'R3: a list that could not be read sweeps nothing');
  const list = await session.loadList();
  ok(list.map((r) => r.id).join(',') === 'main,b2' && session.listRead === true, 'the list is read: main (implied) and b2; t1 is in the trash');
  ok(gone.every((k) => !store.m.has(k)), 'R3: entries of boards neither listed nor in the trash are removed');
  ok(stays.every((k) => store.m.has(k)), 'R3: entries of main, a listed board, a trashed board, another space, the list and others\' keys stay');
  ok(session.sweep() === 0, 'R3: a second sweep finds nothing');
  ok(log.lists.length >= 1, 'onList heard the list');
  // the board being opened is not swept before its list is known: a landing on a board not yet in the list keeps its leftover
  const store2 = makeStore(); const srv2 = makeServer();
  store2.setItem(entryKey('newb'), JSON.stringify({ t: Date.now(), by: 'u1', items: {} }));
  const o = open(srv2, store2);
  o.session.start('newb');
  ok(store2.m.has(entryKey('newb')), 'R3: starting on a board does not sweep (only the list read does)');
  srv2.data.set('board:newb', rec('newb'));
  await o.session.loadList();
  ok(store2.m.has(entryKey('newb')), 'R3: a board that is in the list is kept when the list is read');
}

// ---- R4: a replay is for the board being opened ---------------------------------------------------------------------------
{
  timers = [];
  const srv = makeServer(); const store = makeStore();
  const plant = (board, id, extra = {}) => store.setItem(entryKey(board), JSON.stringify({ t: Date.now(), by: 'u1', items: { [`block:${board}:${id}`]: { op: 'put', value: blk(id) }, ...extra } }));
  plant('main', 'm-left'); plant('b2', 'b-left');
  const { session } = open(srv, store);
  session.start('main');
  await session.sync.load();
  const left = session.sync.replay();
  await settle();
  ok(left.put.length === 1 && left.put[0].id === 'm-left', 'R4: opening main hands back main\'s leftover only');
  ok(srv.data.has('block:main:m-left') && !srv.data.has('block:b2:b-left') && !srv.keys().some((k) => k.includes('b-left')), 'R4: main\'s is sent; b2\'s is not sent');
  ok(store.m.has(entryKey('b2')) && JSON.parse(store.getItem(entryKey('b2'))).items['block:b2:b-left'], 'R4: b2\'s stays kept for when b2 is opened');
  session.use('b2'); await session.sync.load();
  const left2 = session.sync.replay(); await settle();
  ok(left2.put.length === 1 && srv.data.has('block:b2:b-left') && !srv.data.has('block:main:b-left'), 'R4: opening b2 sends b2\'s, under b2');
  // an entry that carries a key of another board is not replayed
  const store2 = makeStore(); const srv2 = makeServer();
  store2.setItem(entryKey('b2'), JSON.stringify({ t: Date.now(), by: 'u1', items: { 'block:main:evil': { op: 'put', value: blk('evil') }, 'block:b2:fine': { op: 'put', value: blk('fine') }, 'block:b2:x:y': { op: 'put', value: blk('x:y') }, 'block:b2:wrongid': { op: 'put', value: blk('other') } } }));
  const o = open(srv2, store2);
  o.session.start('b2'); await o.session.sync.load(); o.session.sync.replay(); await settle();
  ok(same(srv2.keys(), ['block:b2:fine']), 'R4: only a block under the board\'s own prefix whose id matches its key is replayed');
  // a delete intent of b2 is not replayed on main
  const store3 = makeStore(); const srv3 = makeServer(); seedBlock(srv3, 'main', 'keep'); seedBlock(srv3, 'b2', 'keep');
  store3.setItem(entryKey('b2'), JSON.stringify({ t: Date.now(), by: 'u1', items: { 'block:b2:keep': { op: 'del' } } }));
  const o3 = open(srv3, store3);
  o3.session.start('main'); await o3.session.sync.load(); o3.session.sync.replay(); await settle();
  ok(srv3.data.has('block:main:keep') && srv3.data.has('block:b2:keep'), 'R4: a kept delete of b2 is not replayed when main is opened');
  o3.session.use('b2'); await o3.session.sync.load(); o3.session.sync.replay(); await settle();
  ok(!srv3.data.has('block:b2:keep') && srv3.data.has('block:main:keep'), 'R4: it is replayed on b2, and main is untouched');
}

// ---- the board list ----------------------------------------------------------------------------------------------------------
{
  timers = [];
  const srv = makeServer(); const store = makeStore();
  seedBlock(srv, 'main', 'a1');
  const { session, log } = open(srv, store);
  ok(session.visible().map((r) => r.id).join() === 'main', 'before the list is read: one implicit board');
  const list = await session.loadList();
  session.start('main'); await session.sync.load(); session.sync.replay(); await session.boardSync.load(); session.boardSync.replay();
  await settle(); await runTimers();
  ok(list.length === 1 && list[0].implicit === true && list[0].name === 'Board 1', 'a space with no board records reads as "Board 1"');
  ok(srv.log.length === 0, 'opening a space writes nothing (no board record is made by opening)');
  ok(!srv.data.has('board:main'), 'and there is no board:main record');
  srv.data.set('board:b2', rec('b2')); srv.data.set('board:bad', { id: 'bad', name: 5 }); srv.data.set('board:b9', rec('b8')); srv.data.set('board:Z', rec('Z'));
  await session.loadList();
  ok(session.visible().map((r) => r.id).join() === 'main,b2', 'a record that is not a board, or whose id is not its key, is left out');
  session.handle({ key: 'board:b3', scope: 'space', version: 2, value: rec('b3', { order: 2 }), by: 'u2' });
  ok(session.visible().map((r) => r.id).join() === 'main,b2,b3' && log.lists[log.lists.length - 1] === 'main,b2,b3', 'a board made by someone else is heard and listed');
  session.handle({ key: 'board:b3', scope: 'space', version: 3, value: rec('b3', { order: 2, trashedAt: '2026-11-12T11:00:00Z' }), by: 'u2' });
  ok(session.visible().map((r) => r.id).join() === 'main,b2', 'a board put in the trash is no longer listed');
  session.handle({ key: 'board:b2', scope: 'space', version: 9, deleted: true, by: 'u2' });
  ok(session.visible().map((r) => r.id).join() === 'main', 'a record removed is no longer listed');
  session.handle({ key: 'board:main', scope: 'space', version: 1, value: rec('main', { name: 'Plans', order: 0 }), by: 'u2' });
  ok(session.visible()[0].name === 'Plans' && !session.visible()[0].implicit, 'a main record named Plans replaces the implicit board');
  session.handle({ key: 'block:main:z', scope: 'space', version: 1, value: blk('z'), by: 'u2' });
  ok(!session.records().some((r) => r.id === 'z'), 'a block change is not a board record');
  ok(log.drawn.length === 1 && log.drawn[0].block.id === 'z', 'and is drawn on the board shown');
  session.use('b2');
  session.handle({ key: 'board:b4', scope: 'space', version: 1, value: rec('b4', { order: 3 }), by: 'u2' });
  ok(session.visible().some((r) => r.id === 'b4'), 'the list is still heard after a switch');
  const lastList = session.listSync;
  ok(lastList.closed === false, 'the list\'s sync is not closed by a switch');
}

// ---- one history for each board -----------------------------------------------------------------------------------------------
{
  const h = L.wbPerBoard((id) => L.createHistory({ cap: 100, onChange() {} }));
  const a = h.get('main'); const b = h.get('b2');
  ok(a !== b && h.get('main') === a && h.has('b2') && h.size() === 2, 'wbPerBoard: one object for each board, the same one each time');
  a.record('x', null, blk('x')); a.close();
  ok(a.canUndo() && !h.get('b2').canUndo(), 'a step on main is not undoable on b2');
  ok(h.drop('b2') === true && !h.has('b2') && h.get('b2') !== b && h.get('main') === a, 'dropping a board\'s history leaves the others');
}

// ---- the list written by this page (job 2; the switcher's own checks are in check-whiteboard-boards-ui.mjs) -------------------------
{
  const srv = makeServer(); const store = makeStore();
  const { session, log } = open(srv, store);
  await session.loadList(); session.start('main');
  const c = session.saveRecord(rec('b7', { name: 'Seven', order: 1 }));
  await settle();
  ok(c && srv.data.has('board:b7') && log.lists[log.lists.length - 1] === 'main,b7' && session.visible().map((b) => b.id).join() === 'main,b7', 'saveRecord holds the record, reports the list and writes board:<id>');
  session.saveRecord({ ...rec('b7', { name: 'Seven', order: 1 }), deleted: true, trashedAt: '2026-11-12T10:00:00.000Z' });
  ok(session.visible().map((b) => b.id).join() === 'main' && L.wbBoardNameProblem('seven', session.visible()) === '', 'a trashed board leaves the list, and its name is free again');
  ok(L.wbPurgePlan(session.records(), Date.parse('2026-11-19T10:00:00.000Z')).join() === 'b7' && L.wbPurgePlan(session.records(), Date.parse('2026-11-19T09:59:00.000Z')).length === 0, 'the plan on the stored record: due at 7 days, not a minute before');
}

// ---- 0.1.57: a trash keeps the parked writes; replay of every board after the list ------------------------------------------
{
  // (a) parked writes of a board that is trashed: still sent under its prefix, entry kept until accepted, dropped at purge
  timers = [];
  const srv = makeServer(); const store = makeStore();
  srv.data.set('board:b2', rec('b2'));
  const o = open(srv, store);
  await o.session.loadList(); o.session.start('b2');
  srv.refuse = (k) => k.startsWith('block:b2:');
  for (let i = 0; i < 30; i += 1) o.session.sync.save(blk(`p${i}`));
  await settle();
  o.session.use('main'); // the board is left (a delete switches first) and then trashed
  o.session.saveRecord(rec('b2', { deleted: true, trashedAt: new Date().toISOString() }));
  await settle();
  ok(store.m.has(entryKey('b2')) && o.session.pending() >= 30, 'trash: the parked writes and the kept entry stay');
  srv.refuse = null;
  await runTimers(); await settle();
  ok(srv.keys('block:b2:').length === 30, `trash: all 30 parked writes land under the trashed board's prefix (${srv.keys('block:b2:').length})`);
  ok(!store.m.has(entryKey('b2')) && o.session.pending() === 0, 'trash: once accepted the entry is gone');
  ok(!srv.keys('block:main:').length, 'trash: nothing lands in another board');
  // purge drops what still waits
  const srv2 = makeServer(); const st2 = makeStore();
  const o2 = open(srv2, st2); o2.session.start('b2');
  srv2.refuse = (k) => k.startsWith('block:b2:');
  o2.session.sync.save(blk('q1')); await settle(); o2.session.use('main'); await settle();
  ok(st2.m.has(entryKey('b2')), 'purge setup: an entry is kept for the trashed board');
  o2.session.dropPending('b2'); srv2.refuse = null; await runTimers();
  ok(!st2.m.has(entryKey('b2')) && !srv2.keys('block:b2:').length, 'purge: dropPending removes the entry and nothing is sent');
  const page = fs.readFileSync(path.join(src, 'whiteboard.js'), 'utf8');
  ok(!/dropPending\(cur\.id\)/.test(page) && !/\.then\(\(\) => session\.dropPending\(gone\)\)/.test(page) && /r\.status === 'done' && r\.id\) session\.dropPending\(r\.id\)/.test(page), 'wbDropPending is called at purge, not at trash (page read as code)');
}
{
  // (b) leftovers of boards A, B, C replayed on a fresh load into their own prefixes, whichever board opens
  timers = [];
  const srv = makeServer(); const store = makeStore();
  srv.data.set('board:ba', rec('ba')); srv.data.set('board:bb', rec('bb', { deleted: true, trashedAt: new Date().toISOString() })); srv.data.set('board:bc', rec('bc'));
  const entry = (board, ids, extra = {}) => store.setItem(entryKey(board), JSON.stringify({ t: Date.now(), by: 'u1', items: Object.fromEntries(ids.map((i) => [`block:${board}:${i}`, { op: 'put', value: blk(i) }])), ...extra }));
  entry('ba', ['a1', 'a2']); entry('bb', ['b1']); entry('bc', ['c1'], { t: Date.now() - 3 * 3600000 }); // c: older than 10 minutes, never replayed
  store.setItem(entryKey('main'), JSON.stringify({ t: Date.now(), by: 'u1', items: Object.fromEntries([['block:main:m1', { op: 'put', value: blk('m1') }]]) }));
  // a hostile entry: under bc's entry, a key of ba
  store.setItem(entryKey('bc', 'settings'), JSON.stringify({ t: Date.now(), by: 'u1', items: { 'block:ba:evil': { op: 'put', value: blk('evil') }, '_board:ba:settings': { op: 'put', value: { id: 'settings', type: 'board', background: 'gold' } } } }));
  store.setItem(entryKey('zz'), JSON.stringify({ t: Date.now(), by: 'u1', items: { 'block:zz:z1': { op: 'put', value: blk('z1') } } })); // neither listed nor trashed
  store.setItem(entryKey('ba', 'x'), 'unrelated'); // not an entry of any board
  const o = open(srv, store);
  await o.session.loadList(); o.session.start('ba');
  await shown(o.session); o.session.sync.replay(); o.session.boardSync.replay();
  const tried = o.session.replayOthers();
  await settle(); await runTimers(); await settle();
  ok(same(srv.keys('block:ba:'), ['block:ba:a1', 'block:ba:a2']), 'replay: the board opened replays its own, and only its own');
  ok(same(srv.keys('block:bb:'), ['block:bb:b1']), 'replay: a trashed board\'s leftover lands under its own prefix');
  ok(same(srv.keys('block:bc:'), ['block:bc:c1']), 'replay: an entry older than 10 minutes that was never replayed is replayed once');
  ok(same(srv.keys('block:main:'), ['block:main:m1']), 'replay: main\'s too');
  ok(!srv.data.has('block:ba:evil') && !srv.data.has('_board:ba:settings'), 'replay: an entry holding another board\'s keys is refused');
  ok(!srv.data.has('block:zz:z1') && !store.m.has(entryKey('zz')), 'replay: a board neither listed nor trashed is swept, not replayed');
  ok(srv.log.every((l) => /^set (block:(ba|bb|bc|main):|board)/.test(l)) && tried.length === 3, `replay: every write is under its own board (${tried.join(',')})`);
  ok(o.log.drawn.length === 0 && o.session.id === 'ba' && o.session.epoch === 0, 'replay of the other boards draws nothing and does not switch the page');
  ok([...store.m.keys()].filter((k) => /block:(bb|bc|main):$/.test(k)).length === 0, 'and their entries are gone once accepted');
  // opening another board first: the same
  const srv2 = makeServer(); const st2 = makeStore();
  srv2.data.set('board:ba', rec('ba')); srv2.data.set('board:bc', rec('bc'));
  st2.setItem(entryKey('ba'), JSON.stringify({ t: Date.now(), by: 'u1', items: { 'block:ba:a1': { op: 'put', value: blk('a1') } } }));
  const o2 = open(srv2, st2); await o2.session.loadList(); o2.session.start('bc'); o2.session.replayOthers(); await settle();
  ok(srv2.data.has('block:ba:a1') && !srv2.keys('block:bc:').length, 'replay: opening C replays A into A and nothing into C');
  // 429: the background writer keeps retrying, the entry stays kept
  const srv3 = makeServer(); const st3 = makeStore(); srv3.data.set('board:ba', rec('ba'));
  st3.setItem(entryKey('ba'), JSON.stringify({ t: Date.now(), by: 'u1', items: { 'block:ba:a1': { op: 'put', value: blk('a1') } } }));
  srv3.refuse = () => true;
  const o3 = open(srv3, st3); await o3.session.loadList(); o3.session.start('main'); o3.session.replayOthers(); await settle();
  ok(st3.m.has(entryKey('ba')) && o3.session.pending() === 1, 'replay: refused (429) it stays kept and counted');
  srv3.refuse = null; await runTimers(); await settle();
  ok(srv3.data.has('block:ba:a1') && !st3.m.has(entryKey('ba')), 'replay: and lands when the server accepts');
}

finish();
