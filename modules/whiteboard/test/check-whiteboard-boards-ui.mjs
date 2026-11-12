#!/usr/bin/env node
/*
 * check-whiteboard-boards-ui.mjs -- several boards in one space: the switcher's rules, create / rename / delete / restore, the purge
 * of boards 7 days in Deleted boards, and what a switch does to work in flight (modules/whiteboard/src/whiteboard-lib-s-boards.js;
 * GitHub #555, job 2; plan-whiteboard-boards.md). No page, no network: a fake host storage with versions, fake timers.
 * Guards:
 *   - the Boards… menu for a viewer (none), an editor, the last board (Delete off), 10 boards (New off); the tabs for a viewer of
 *     one board (none), of two, and an editor of one;
 *   - names: empty, spaces only, a duplicate in either case, its own name on rename, too long, hostile characters;
 *   - wbPurgePlan at the boundary (6 d 23 h 59 m no, 7 d yes); the trash list with days left, a due board not offered;
 *   - the purge runner: 250 blocks, never above N deletes a tick, only that board's keys, the record last; the shown board, a
 *     restored one and a record with no time are left alone; two runners: one proceeds, a stale claim is taken over;
 *   - create at the limit refused, the last board not deleted, restore (the list, the order, the implicit first board);
 *   - a picture that finishes after a switch is written under the board it began on, never under the one shown (and dropped when
 *     that board is gone); a stroke in progress at a switch is finished on the old board; a closed page right after a switch still
 *     warns while the board left has unsent writes.
 * Usage: node modules/whiteboard/test/check-whiteboard-boards-ui.mjs [path to the src folder]. Exits 1 on any failure.
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
let passed = 0;
const fails = [];
const ok = (c, m) => { if (c) passed += 1; else fails.push(m); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const NAMES = ['createSync', 'createBoardSession', 'createBoardPurge', 'wbClean', 'wbCleanBoard', 'wbCleanBoardRecord', 'wbCleanBoardName', 'wbBoardList', 'wbBoardNameProblem',
  'wbDefaultBoardName', 'wbShowTabs', 'wbBoardsMenu', 'wbBoardsStrip', 'wbBoardList', 'wbTrashedBoards', 'wbDaysLeftWord', 'wbPurgePlan', 'wbPurgeOwns', 'wbLateHome', 'wbWriteThere', 'wbEndGesture',
  'wbCanCreateBoard', 'wbNextOrder', 'wbNewBoardId', 'WB_BOARD_MAX', 'WB_BOARD_NAME_MAX', 'WB_TRASH_MS', 'WB_PURGE', 'tools'];
let L = {};
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-[a-z]-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  const grab = NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  L = new Function('window', 'document', 'setTimeout', 'clearTimeout', `${parts.join('\n')}\nreturn { ${grab} };`)({ devicePixelRatio: 1 }, undefined, fakeSetTimeout, fakeClearTimeout);
} catch (err) { fails.push(`the libs do not load: ${err.message}`); }
const missing = NAMES.filter((n) => typeof L[n] === 'undefined');
if (missing.length) fails.push(`the libs have no ${missing.join(', ')}`);
function finish() {
  if (fails.length) { for (const f of fails) console.error(`FAIL ${f}`); console.error(`check-whiteboard-boards-ui: ${fails.length} failed, ${passed} passed`); process.exit(1); }
  console.log(`check-whiteboard-boards-ui: OK, ${passed} checks`);
}
if (missing.length) { finish(); process.exit(1); }

const DAY = 86400000;
const T0 = Date.parse('2026-11-12T12:00:00.000Z');
const rec = (id, extra = {}) => ({ id, type: 'board-record', name: `Board ${id}`, order: 1, by: 'u1', at: '2026-11-01T10:00:00.000Z', deleted: false, trashedAt: '', ...extra });
const trashed = (id, ago, extra = {}) => rec(id, { deleted: true, trashedAt: new Date(T0 - ago).toISOString(), ...extra });

// ---- the menu and the tabs ---------------------------------------------------------------------------------------------
{
  ok(same(L.wbBoardsMenu({ canEdit: false, count: 3 }), []), 'a viewer has no Boards… entries');
  const e = L.wbBoardsMenu({ canEdit: true, count: 3, trashed: 2 });
  ok(same(e.map((x) => x.id), ['new', 'rename', 'delete', 'deleted']) && e.every((x) => !x.disabled), 'an editor has New, Rename, Delete, Deleted boards, all on');
  ok(e.find((x) => x.id === 'deleted').hint === '2', 'Deleted boards shows how many');
  const last = L.wbBoardsMenu({ canEdit: true, count: 1 });
  ok(last.find((x) => x.id === 'delete').disabled === true && /last/i.test(last.find((x) => x.id === 'delete').hint) && !last.find((x) => x.id === 'new').disabled, 'with one board Delete is off with a hint, New is on');
  const ten = L.wbBoardsMenu({ canEdit: true, count: 10 });
  ok(ten.find((x) => x.id === 'new').disabled === true && /10/.test(ten.find((x) => x.id === 'new').hint) && !ten.find((x) => x.id === 'delete').disabled, 'with 10 boards New is off with a hint, Delete is on');
  ok(!L.wbBoardsMenu({ canEdit: true, count: 9 }).find((x) => x.id === 'new').disabled, 'with 9 boards New is on');
  ok(L.wbShowTabs({ canEdit: false, count: 1 }) === false && L.wbShowTabs({ canEdit: false, count: 2 }) === true && L.wbShowTabs({ canEdit: true, count: 1 }) === true, 'tabs: none for a viewer of one board, shown for two, shown to an editor of one');
}

// ---- names -------------------------------------------------------------------------------------------------------------
{
  const list = [{ id: 'main', name: 'Board 1' }, { id: 'b2', name: 'Plan B' }];
  const p = (n, except) => L.wbBoardNameProblem(n, list, except);
  ok(p('') && p('   ') && p(null) && p(undefined), 'an empty name, spaces only, or no text is refused');
  ok(p('plan b') && p('PLAN B') && p('  Plan B  '), 'a duplicate is refused in either case, and with spaces round it');
  ok(p('Plan B', 'b2') === '', 'a board keeps its own name on rename');
  ok(p('Board 1', 'b2') !== '', 'a rename to another board\'s name is refused');
  ok(p('x'.repeat(40)) === '' && p('x'.repeat(41)) !== '', '40 characters pass, 41 are refused');
  ok(p('‮​\u0007') !== '', 'a name of direction and control characters only is refused');
  ok(L.wbCleanBoardName('A‮B\u0007C​D\n E') === 'A B C D E' && !/[‮\u0007​]/.test(L.wbCleanBoardName('‮hello')), 'direction and control characters are taken out of a name');
  ok(L.wbCleanBoardName('<img src=x onerror=alert(1)>') === '<img src=x onerror=alert(1)>' && L.wbCleanBoardRecord(rec('b9', { name: '<b>x</b>' })).name === '<b>x</b>', 'markup stays plain text (the page draws names as text)');
  ok(L.wbCleanBoardRecord(rec('b9', { name: '‮\u0007' })) === null, 'a record whose name is only hostile characters is not a board');
  ok(L.wbDefaultBoardName(list) === 'Board 3' && L.wbDefaultBoardName([{ id: 'main', name: 'Board 1' }, { id: 'x', name: 'board 2' }]) === 'Board 3' && L.wbDefaultBoardName([]) === 'Board 1', 'the new board starts as Board N, the first number not used (either case)');
}

// ---- the trash and the plan -----------------------------------------------------------------------------------------------
{
  const plan = (rs) => L.wbPurgePlan(rs, T0);
  ok(same(plan([trashed('a1', 7 * DAY - 60000)]), []), 'a board in the trash 6 days 23 hours 59 minutes is not purged');
  ok(same(plan([trashed('a1', 7 * DAY)]), ['a1']), 'a board in the trash exactly 7 days is purged');
  ok(same(plan([trashed('a1', 7 * DAY + 1)]), ['a1']), 'and one past 7 days');
  ok(same(plan([trashed('a2', 8 * DAY), trashed('a1', 9 * DAY), trashed('a3', 1 * DAY)]), ['a1', 'a2']), 'the oldest is first, the young one stays');
  ok(same(plan([rec('a1', { deleted: true, trashedAt: '' }), rec('a2', { deleted: true, trashedAt: 'not a date' }), rec('a3', { at: '2020-01-01T00:00:00.000Z' })]), []), 'a record with no time, a bad time, or not deleted is never purged');
  ok(same(plan('x'), []) && same(plan(null), []), 'no list, no plan');
  const tr = L.wbTrashedBoards([trashed('a1', 1 * DAY + 3600000), trashed('a2', 6 * DAY + 1000), trashed('a3', 7 * DAY), rec('a4')], T0);
  ok(same(tr.map((t) => [t.id, t.left]), [['a1', 6], ['a2', 1]]), `the Deleted boards list shows the days left and not a due board (${JSON.stringify(tr.map((t) => [t.id, t.left]))})`);
  ok(L.wbDaysLeftWord(1) === '1 day left' && L.wbDaysLeftWord(5) === '5 days left', 'the days-left words');
  ok(L.WB_PURGE.perTick * (60000 / L.WB_PURGE.everyMs) <= 100, 'the default pace is at most 100 deletes a minute');
}

// ---- a fake storage with versions -----------------------------------------------------------------------------------------
function makeStore() {
  const data = new Map(); // key -> { value, version }
  const log = [];
  const err = (status, msg) => Object.assign(new Error(msg), { status });
  return {
    data, log,
    keys: (prefix = '') => [...data.keys()].filter((k) => k.startsWith(prefix)).sort(),
    put(key, value) { data.set(key, { value, version: 1 }); },
    host: { storage: {
      async list(prefix = '') { return [...data].filter(([k]) => k.startsWith(prefix)).map(([key, e]) => ({ key, value: e.value, version: e.version })); },
      async set(key, value, o) {
        await Promise.resolve();
        const cur = data.get(key);
        if (o && o.version !== undefined && (cur ? cur.version : 0) !== o.version) throw err(409, 'conflict');
        log.push(`set ${key}`);
        data.set(key, { value, version: (cur ? cur.version : 0) + 1 });
        return { version: (cur ? cur.version : 0) + 1 };
      },
      async delete(key) { await Promise.resolve(); if (!data.has(key)) throw err(404, 'none'); log.push(`delete ${key}`); data.delete(key); return { deleted: true }; },
    } },
  };
}
function seedBoard(st, id, blocks, extra = {}) {
  for (let i = 0; i < blocks; i += 1) st.put(`block:${id}:k${i}`, { id: `k${i}`, type: 'note' });
  st.put(`_board:${id}:settings`, { id: 'settings', type: 'board' });
  st.put(`_present:${id}:state`, { id: 'state' });
  st.put(`board:${id}`, trashed(id, 8 * DAY, extra));
}
const records = (st) => st.keys('board:').map((k) => st.data.get(k).value);

// ---- the purge ---------------------------------------------------------------------------------------------------------------
{
  const st = makeStore();
  seedBoard(st, 'old', 250);
  st.put('block:main:keep', { id: 'keep', type: 'note' }); st.put('block:ol:other', { id: 'other' }); st.put('block:olda:other', { id: 'other' }); st.put('_board:main:settings', { id: 'settings' });
  st.put('board:main', rec('main', { name: 'Board 1', order: 0 }));
  const other = st.keys().filter((k) => !/^(block:old:|_board:old:|_present:old:|board:old$)/.test(k));
  const purge = L.createBoardPurge({ host: st.host, me: 'u1', now: () => T0, perTick: 25 });
  const perTick = [];
  let status = '';
  for (let i = 0; i < 40 && status !== 'done'; i += 1) {
    const before = st.log.filter((l) => l.startsWith('delete ')).length;
    const r = await purge.tick(records(st), 'main');
    perTick.push(st.log.filter((l) => l.startsWith('delete ')).length - before);
    status = r.status;
  }
  ok(status === 'done', `a 250-block board is purged in ticks (status ${status}, ${perTick.length} ticks)`);
  ok(Math.max(...perTick) <= 25, `no tick deletes more than 25 (largest ${Math.max(...perTick)})`);
  ok(perTick.reduce((a, b) => a + b, 0) === 250 + 3, `253 deletes in all: 250 blocks, the settings, the presentation and the record (${perTick.reduce((a, b) => a + b, 0)})`);
  ok(st.keys('block:old:').length === 0 && st.keys('_board:old:').length === 0 && !st.data.has('_present:old:state') && !st.data.has('board:old'), 'every key of that board is gone');
  ok(same(st.keys().filter((k) => !k.startsWith('_purge:')), other), 'no other key was touched (main, a board whose id starts the same, other prefixes)');
  const dels = st.log.filter((l) => l.startsWith('delete '));
  ok(dels[dels.length - 1] === 'delete board:old', 'the record is deleted last');
  ok(dels.every((l) => /^delete (block:old:|_board:old:|_present:old:state|board:old$)/.test(l)), 'every delete is of that board\'s keys');
  ok(L.wbPurgeOwns('old', 'block:olda:x') === false && L.wbPurgeOwns('old', 'block:old:x') && L.wbPurgeOwns('old', 'board:old') && !L.wbPurgeOwns('old', 'board:olda') && !L.wbPurgeOwns('old', '_purge:lock') && !L.wbPurgeOwns('BAD:', 'block:BAD::x'), 'wbPurgeOwns is exact about the prefix');
  ok((await purge.tick(records(st), 'main')).status === 'idle', 'with nothing due, a tick is idle');
}
{
  // the shown board, a young board, and a restore in the middle
  const st = makeStore();
  seedBoard(st, 'shown', 5); seedBoard(st, 'mid', 60);
  const purge = L.createBoardPurge({ host: st.host, me: 'u1', now: () => T0, perTick: 20 });
  let r = await purge.tick(records(st), 'shown');
  ok(st.keys('block:shown:').length === 5 && r.id === 'mid', 'the board shown is never purged (the other one is taken)');
  st.put('board:mid', rec('mid')); // restored by someone, after the first tick
  const left = st.keys('block:mid:').length;
  r = await purge.tick(records(st), 'shown');
  ok(r.status === 'idle' || r.status === 'skipped', `a board restored meanwhile is dropped from the plan (${r.status})`);
  ok(st.keys('block:mid:').length === left && st.data.has('board:mid'), 'and nothing more of it is deleted');
  // stale view: this page still thinks it is trashed, the server record says restored
  const stale = [trashed('mid', 8 * DAY)];
  r = await purge.tick(stale, 'x');
  ok(r.status === 'skipped' && st.keys('block:mid:').length === left, 'a page with an old list reads the record again and skips a restored board');
  // active board becomes the working one: stop
  seedBoard(st, 'w', 50);
  const p2 = L.createBoardPurge({ host: st.host, me: 'u1', now: () => T0, perTick: 10 });
  await p2.tick(records(st).filter((x) => x.id === 'w'), 'x');
  const k1 = st.keys('block:w:').length;
  r = await p2.tick(records(st).filter((x) => x.id === 'w'), 'w');
  ok(st.keys('block:w:').length === k1 && r.status === 'idle', 'when the person switches onto the board being purged, the purge stops');
}
{
  // the claim
  const st = makeStore(); seedBoard(st, 'o1', 10);
  let clock = T0;
  const mk = (me) => L.createBoardPurge({ host: st.host, me, now: () => clock, perTick: 4 });
  const A = mk('ua'); const B = mk('ub');
  const [ra, rb] = await Promise.all([A.tick(records(st), 'main'), B.tick(records(st), 'main')]);
  ok([ra.status, rb.status].sort().join() === 'busy,working', `two runners at once: one proceeds, one waits (${ra.status}, ${rb.status})`);
  const winner = ra.status === 'working' ? A : B; const loser = winner === A ? B : A;
  ok((await loser.tick(records(st), 'main')).status === 'busy' && (await winner.tick(records(st), 'main')).status === 'working', 'the loser stays out, the winner carries on');
  ok(st.data.get('_purge:lock').value.holder === winner.holder, 'the lock names the winner');
  clock += 119000;
  ok((await loser.tick(records(st), 'main')).status === 'busy', 'a claim 119 seconds old still holds');
  clock += 2000; // 121 s since the winner's last tick
  const took = await loser.tick(records(st), 'main');
  ok(took.status === 'working' && st.data.get('_purge:lock').value.holder === loser.holder, 'a claim older than 2 minutes is taken over');
  const dead = L.createBoardPurge({ host: st.host, me: 'ub', now: () => clock, perTick: 4 });
  void dead;
  // finish
  let s = ''; for (let i = 0; i < 20 && s !== 'done'; i += 1) s = (await loser.tick(records(st), 'main')).status;
  ok(s === 'done' && st.keys('block:o1:').length === 0, 'the new holder finishes the board');
  // errors: a refused delete (429) stops the tick and the next one carries on
  const st2 = makeStore(); seedBoard(st2, 'e1', 6);
  let refuse = true; const realDelete = st2.host.storage.delete;
  st2.host.storage.delete = async (k) => { if (refuse) throw Object.assign(new Error('busy'), { status: 429 }); return realDelete(k); };
  const E = L.createBoardPurge({ host: st2.host, me: 'ue', now: () => T0, perTick: 3 });
  ok((await E.tick(records(st2), 'main')).status === 'error' && st2.keys('block:e1:').length === 6, 'a refused delete ends the tick with nothing lost');
  refuse = false; let es = ''; for (let i = 0; i < 10 && es !== 'done'; i += 1) es = (await E.tick(records(st2), 'main')).status;
  ok(es === 'done' && st2.keys('e1').length === 0 && st2.keys('block:e1:').length === 0, 'and the next ticks finish it');
}

// ---- a session with the list: create, limit, delete, restore -----------------------------------------------------------
const makeFileStore = () => { const m = new Map(); return { m, get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; };
function open(st, store = makeFileStore(), over = {}) {
  const lists = [];
  const session = L.createBoardSession({ host: st.host, scope: 'sp1', me: 'u1', store, clean: L.wbClean, cleanSettings: L.wbCleanBoard, handlers: { onList: (l) => lists.push(l.map((r) => r.id)), ...over } });
  return { session, store, lists };
}
const note = (id, extra = {}) => ({ id, type: 'note', x: 0, y: 0, z: 1, w: 180, h: 160, text: 'T', fill: 'gold', stroke: 'auto', ink: 'ink', weight: 1, ...extra });
{
  const st = makeStore();
  const { session } = open(st);
  await session.loadList(); session.start('main');
  ok(same(session.visible().map((b) => b.id), ['main']) && session.visible()[0].implicit === true, 'a new space has the implicit first board only');
  // create: the implicit main stays implicit; the new record goes last
  const list = session.visible();
  const made = session.saveRecord({ id: 'plan1', type: 'board-record', name: 'Plan B', order: L.wbNextOrder(list), by: 'u1', at: '2026-11-12T10:00:00.000Z', deleted: false, trashedAt: '' });
  await settle();
  ok(made && st.data.has('board:plan1') && !st.data.has('board:main'), 'creating a second board writes its record and not main\'s');
  ok(same(st.data.get('board:plan1').value, { id: 'plan1', type: 'board-record', name: 'Plan B', order: 1, by: 'u1', at: '2026-11-12T10:00:00.000Z', deleted: false, trashedAt: '' }), 'the record written has exactly the fields id, type, name, order, by, at, deleted, trashedAt');
  ok(same(session.visible().map((b) => b.id), ['main', 'plan1']), 'the list: implicit main first, then by order');
  // rename the implicit main: its record is written the first time, order 0
  session.saveRecord({ id: 'main', type: 'board-record', name: 'Map', order: 0, by: 'u1', at: '2026-11-12T10:01:00.000Z', deleted: false, trashedAt: '' });
  await settle();
  ok(st.data.get('board:main').value.name === 'Map' && st.data.get('board:main').value.order === 0 && session.visible()[0].name === 'Map' && !session.visible()[0].implicit, 'renaming the implicit board writes board:main with order 0');
  ok(session.saveRecord({ id: 'BAD ID', name: 'x', order: 1 }) === null && session.saveRecord(null) === null, 'a record that is not one is not saved');
  // the limit
  for (let i = 0; i < 8; i += 1) session.saveRecord({ id: `x${i}`, type: 'board-record', name: `X ${i}`, order: L.wbNextOrder(session.visible()), by: 'u1', at: `2026-11-12T11:0${i}:00.000Z`, deleted: false, trashedAt: '' });
  ok(session.visible().length === 10 && L.wbCanCreateBoard(session.visible()) === false, 'at 10 boards a new one is refused (wbCanCreateBoard)');
  ok(L.wbCanCreateBoard(session.visible().slice(1)) === true, 'at 9 it is allowed');
  // delete (to the trash) and restore
  const base = session.records().find((r) => r.id === 'plan1');
  session.saveRecord({ ...base, deleted: true, trashedAt: new Date(T0).toISOString() });
  ok(!session.visible().some((b) => b.id === 'plan1') && session.visible().length === 9, 'a trashed board leaves the tabs');
  await settle();
  ok(st.data.get('board:plan1').value.deleted === true && st.data.get('board:plan1').value.trashedAt && L.wbTrashedBoards(session.records(), T0 + DAY).map((t) => `${t.id}:${t.left}`).join() === 'plan1:6', 'its record has deleted and trashedAt, and it is in the Deleted boards list');
  st.put('block:plan1:b1', note('b1'));
  session.saveRecord({ ...session.records().find((r) => r.id === 'plan1'), deleted: false, trashedAt: '' });
  await settle();
  ok(session.visible().some((b) => b.id === 'plan1') && session.visible().findIndex((b) => b.id === 'plan1') === 1 && st.keys('block:plan1:').length === 1, 'a restored board is back in its place with its blocks');
  ok(L.wbTrashedBoards(session.records(), T0).length === 0, 'and out of the Deleted boards list');
  // main trashed: no implicit main comes back
  const s2 = open(makeStore()); await s2.session.loadList();
  s2.session.saveRecord({ id: 'b2', type: 'board-record', name: 'B', order: 1, by: 'u', at: 'a', deleted: false, trashedAt: '' });
  s2.session.saveRecord({ id: 'main', type: 'board-record', name: 'Board 1', order: 0, by: 'u', at: 'a', deleted: true, trashedAt: new Date(T0).toISOString() });
  ok(same(s2.session.visible().map((b) => b.id), ['b2']), 'with main in the trash the list is the other board only (no implicit first board)');
}
{
  // the page's own guards, read as code
  const page = fs.readFileSync(path.join(src, 'whiteboard.js'), 'utf8');
  ok((page.match(/wbCanCreateBoard\(/g) || []).length >= 3, 'the page checks the limit when the menu opens, before the question and again after it');
  ok(/if \(!cur \|\| list\.length <= 1\) return;/.test(page), 'the page does not delete the last board');
  ok(!/session\.dropPending\(cur\.id\)/.test(page) && /deleted: true, trashedAt: iso\(\)/.test(page), 'delete sets deleted and trashedAt and keeps the kept writes of the board (a purge drops them)');
  ok(/title: 'New board', label: 'Name'[^}]*action: 'Create'[^}]*validate/.test(page) && /title: 'Delete board\?'/.test(page) && /action: 'Delete'/.test(page), 'New board and Delete board? are the shared prompt and confirm');
  ok(/boardsSwitch = host\.ui\.viewSwitch\(\{ id: 'boards'/.test(page) && page.indexOf("id: 'boards', label: 'Boards'") < page.indexOf("id: 'tool', label: 'Tools'"), 'the boards switch is made before the Tools switch');
  ok(/\{ id: 'boards', icon: 'layer-group', title: 'Boards…', overflow: true \}/.test(page), 'one title-bar entry, Boards…');
}

// ---- work in flight at a switch ----------------------------------------------------------------------------------------------
{
  // (a) a picture whose upload finishes after a switch
  const st = makeStore();
  const { session } = open(st);
  st.put('board:b2', rec('b2', { name: 'Second' }));
  await session.loadList(); session.start('main');
  const home = { board: session.id, epoch: session.epoch };
  let finish; const slowUpload = new Promise((r) => { finish = r; });
  session.use('b2');
  const keysBefore = st.keys();
  await settle();
  const file = { id: 'up1' };
  finish(file);
  await slowUpload;
  const where = L.wbLateHome(home, session);
  ok(where === 'there', `an upload that finishes after a switch is for the board it began on (${where})`);
  await L.wbWriteThere(st.host, home, note('pic1', { type: 'image', upload: file.id }));
  ok(st.data.has('block:main:pic1') && !st.keys().some((k) => k.includes(':b2:pic1')), 'it is written under block:main:, never under the board shown (b2)');
  ok(same(st.keys().filter((k) => !k.startsWith('block:main:')), keysBefore.filter((k) => !k.startsWith('block:main:'))), 'and no other key changed');
  ok(L.wbLateHome({ board: 'main', epoch: session.epoch }, session) === 'here' && L.wbLateHome({ board: 'b2', epoch: session.epoch }, session) === 'here' && L.wbLateHome(undefined, session) === 'here', 'on the board shown (or with no home) it is placed as always');
  session.use('main');
  ok(L.wbLateHome(home, session) === 'here', 'switched away and back: the board is shown again, so it is placed as always');
  session.use('b2');
  // its board is deleted meanwhile
  session.saveRecord({ ...session.records().find((r) => r.id === 'b2'), deleted: true, trashedAt: new Date(T0).toISOString() });
  ok(L.wbLateHome({ board: 'b2', epoch: 0 }, session) === 'here', 'a picture begun on the board now shown is placed here');
  session.use('main');
  ok(L.wbLateHome({ board: 'b2', epoch: 1 }, session) === 'drop', 'a picture for a board that is in the trash is dropped, not written');
  ok(L.wbLateHome({ board: 'zz', epoch: 0 }, session) === 'drop', 'and for one that is not listed');
}
{
  // (b) a stroke in progress at the switch
  const st = makeStore();
  const { session } = open(st);
  await session.loadList(); session.start('main');
  const drafts = new Set(); const blocks = new Map();
  const ctx = {
    scale: () => 1, get: (id) => blocks.get(id),
    draft(type, f) { const b = L.wbClean({ ...f, id: `s${blocks.size}`, type, z: 1, x: f.x, y: f.y, points: f.points }); blocks.set(b.id, b); drafts.add(b.id); return b; },
    change(id, patch, o) { const b = blocks.get(id); const n = L.wbClean({ ...b, ...patch }); blocks.set(id, n); if (o && o.save) { drafts.delete(id); session.sync.save({ ...n, by: 'u1', at: 'now' }); } },
    discard(id) { blocks.delete(id); drafts.delete(id); },
  };
  const pen = L.tools.get('pen');
  const p = (x, y) => ({ x, y });
  pen.down(p(10, 10), ctx); pen.move(p(60, 40), ctx); pen.move(p(120, 20), ctx);
  const last = p(200, 60);
  const verdict = L.wbEndGesture({ tool: pen, point: last, ctx });
  ok(verdict === 'up', 'a stroke in progress is finished at its last point');
  session.use('b2'); // the switch sends the old board's save first
  await settle();
  const strokes = st.keys('block:').filter((k) => /^block:main:s/.test(k));
  ok(strokes.length === 1 && st.keys('block:b2:').length === 0, `the stroke is saved under block:main: and nothing is under b2 (${strokes.join(',')})`);
  ok(st.data.get(strokes[0]).value.type === 'stroke' && st.data.get(strokes[0]).value.points.length >= 4, 'with its points');
  // a late pointer-up for the old press finds nothing (the page cleared `down`); pen.up with no drawing does nothing
  const n = st.log.length; pen.up(last, ctx); await settle();
  ok(st.log.length === n, 'a second up does nothing');
  // cancelled when there is no point
  pen.down(p(1, 1), ctx); pen.move(p(50, 50), ctx);
  const count = blocks.size;
  ok(L.wbEndGesture({ tool: pen, point: undefined, ctx }) === 'cancel' && blocks.size === count - 1, 'with no last point the stroke is cancelled and removed');
  ok(L.wbEndGesture({ tool: null, point: null, ctx }) === 'none', 'no tool, nothing to end');
}
{
  // (c) the leave prompt counts the boards switched away from
  const st = makeStore();
  const refuse = new Set();
  const origSet = st.host.storage.set;
  st.host.storage.set = async (k, v, o) => { if (refuse.has('all')) { await new Promise(() => {}); } return origSet(k, v, o); };
  const { session, store } = open(st);
  await session.loadList(); session.start('main');
  session.sync.save(note('w1'));
  await settle();
  ok(session.pending() === 0, 'a write the server accepted is not pending');
  refuse.add('all'); // the server goes quiet
  session.sync.save(note('w2'));
  session.use('b2');
  await settle();
  ok(session.sync.pending() === 0 && session.pending() >= 1, `after the switch the board shown has none, but the session still counts the one left behind (${session.pending()})`);
  const ev = { prevented: false, preventDefault() { this.prevented = true; }, returnValue: undefined };
  ok(session.beforeUnload(ev) === true && ev.prevented && ev.returnValue === '', 'a close right after the switch asks the browser\'s prompt');
  ok([...store.m.keys()].some((k) => k.endsWith('block:main:')), 'and the kept entry is still there for the next page');
  const quiet = open(makeStore()); await quiet.session.loadList(); quiet.session.start('main'); quiet.session.use('b2'); await settle();
  const ev2 = { preventDefault() { throw new Error('no prompt'); }, returnValue: undefined };
  ok(quiet.session.beforeUnload(ev2) === false && ev2.returnValue === undefined, 'with nothing unsent there is no prompt');
  session.dropPending('main');
  ok(session.pending() === 0, 'a deleted board\'s unsent writes are dropped, and then the count is clear');
}

// ---- 0.1.57: the strip, and purging main -------------------------------------------------------------------------------------
{
  const mkList = (n) => Array.from({ length: n }, (_, i) => ({ id: i ? `b${i}` : 'main', name: i ? `Plan ${i}` : 'Board 1' }));
  const S = (n, active, narrow, canEdit) => L.wbBoardsStrip(mkList(n), active, narrow, canEdit);
  for (const n of [1, 3, 10, 11]) {
    const wide = S(n, 'main', false, true);
    ok(wide.tabs.length === n && wide.rows.length === 0 && wide.viewerMenu === false, `wide, editor, ${n} boards: every board a tab, no rows, no viewer menu`);
    const nar = S(n, n > 1 ? 'b1' : 'main', true, true);
    ok(nar.tabs.length === 1 && nar.tabs[0].id === (n > 1 ? 'b1' : 'main') && nar.rows.length === n && nar.rows.filter((r) => r.current).length === 1 && nar.rows.find((r) => r.current).id === nar.tabs[0].id && nar.viewerMenu === false, `narrow, editor, ${n} boards: the current tab only, ${n} rows with the current marked, no viewer menu`);
  }
  ok(same(S(1, 'main', true, false), { tabs: [], rows: [], viewerMenu: false }) && same(S(1, 'main', false, false), { tabs: [], rows: [], viewerMenu: false }), 'a viewer of one board: no strip, no menu, wide or narrow');
  const vn = S(3, 'b2', true, false);
  ok(vn.tabs.length === 1 && vn.tabs[0].id === 'b2' && vn.rows.length === 3 && vn.viewerMenu === true, 'narrow viewer, 3 boards: the current tab, the rows, the title bar Boards menu');
  const vw = S(3, 'b2', false, false);
  ok(vw.tabs.length === 3 && vw.rows.length === 0 && vw.viewerMenu === false, 'wide viewer, 3 boards: all tabs, as before, no menu');
  ok(S(3, 'gone', true, true).tabs.length === 1 && S(3, 'gone', true, true).tabs[0].id === 'main', 'narrow with an unknown active board: the first board');
  ok(same(L.wbBoardsStrip(null, 'main', true, true), { tabs: [], rows: [], viewerMenu: false }) || L.wbBoardsStrip(null, 'main', true, true).tabs.length === 0, 'no list, no tabs');
}
{
  // (c) purging main: its keys go, then board:main is written again live and empty with its old name
  const st = makeStore();
  seedBoard(st, 'main', 40, { name: 'Home', order: 0 });
  for (let i = 1; i <= 9; i += 1) st.put(`board:x${i}`, rec(`x${i}`, { order: i }));
  st.put('block:x1:keep', { id: 'keep', type: 'note' });
  const purge = L.createBoardPurge({ host: st.host, me: 'u1', now: () => T0, perTick: 25 });
  let status = ''; let last = null;
  for (let i = 0; i < 20 && status !== 'done'; i += 1) { last = await purge.tick(records(st), 'x1'); status = last.status; }
  const r = st.data.get('board:main').value;
  ok(status === 'done' && st.keys('block:main:').length === 0 && st.keys('_board:main:').length === 0 && !st.data.has('_present:main:state'), 'purging main deletes its blocks, settings and presentation');
  ok(r.id === 'main' && r.deleted === false && r.trashedAt === '' && r.name === 'Home' && r.order === 0, `and the final write is board:main, live, with its old name (${JSON.stringify(r)})`);
  const dels = st.log.filter((l) => l.startsWith('delete ')); const sets = st.log.filter((l) => l.startsWith('set board:main'));
  ok(!dels.includes('delete board:main') && sets.length === 1 && st.log[st.log.length - 1] === 'set board:main', 'the record is never deleted, and written once, last');
  const list = L.wbBoardList(records(st));
  ok(list.filter((b) => b.id === 'main').length === 1 && !list.find((b) => b.id === 'main').implicit && list.find((b) => b.id === 'main').name === 'Home' && list.length === 10, `exactly one main, named Home, and 10 boards in all (${list.length})`);
  ok(st.data.has('block:x1:keep') && st.keys('board:').length === 10, 'other boards are untouched');
  ok((await purge.tick(records(st), 'x1')).status === 'idle', 'and main is not due again');
}

finish();
