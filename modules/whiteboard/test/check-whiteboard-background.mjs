#!/usr/bin/env node
/*
 * check-whiteboard-background.mjs -- the Whiteboard's background colour (#502): one setting for the whole board, saved
 * whole under _board:main:settings next to the blocks.
 * Guards: what is read is cleaned (an unknown colour, or no value at all, is Default; anything that is not the settings is
 * left out); the dots stay readable on every background (wbBackdrop: theme tokens only, a stronger dot on a wash than on
 * the plain page, the strongest on Ink); the sync takes the settings key like any key, and only its own keys (two pages:
 * a change, its undo and redo, a later change by the other page, a missed echo, a reload, a Clear that deletes the key);
 * undo and redo of a background are one step each and merge like a block's field: a background someone else changed since
 * is left as it is, with its own note.
 * It runs the module's own code (lib-a, lib-e-*, lib-c, lib-g, in one scope as the page has them) against a fake server
 * whose replies and change events the check hands over in an order it picks. The page glue is a small copy of
 * whiteboard.js's ("the board's background", applyChanges). No network, no sleeps.
 * Usage: node modules/whiteboard/test/check-whiteboard-background.mjs [path to the module's src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
const NAMES = ['WB_PALETTE', 'WB_BOARD_PREFIX', 'WB_BOARD_ID', 'WB_BOARD_STEP', 'WB_BOARD_USUAL', 'wbCleanBoard', 'wbBackdrop', 'wbContrast', 'wbContrastInk', 'wb', 'createSync', 'createHistory', 'wbApplyChanges', 'wbUndoNote', 'wbClean'];

let passed = 0;
const fails = [];
const check = (ok, what) => { if (ok) passed += 1; else fails.push(what); };

let lib = {};
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-(a|c|e|g)-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  const grab = NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  lib = new Function(`${parts.join('\n')}\nreturn { ${grab} };`)();
} catch (err) {
  fails.push(`the libs do not load: ${err.message}`);
}
const missing = NAMES.filter((n) => typeof lib[n] === 'undefined');
if (missing.length) fails.push(`the libs have no ${missing.join(', ')}`);
const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => { setImmediate(r); }); };

// ---- the format: the key, the clean ----
function format() {
  const { wbCleanBoard: clean, WB_BOARD_USUAL: usual } = lib;
  check(lib.WB_BOARD_PREFIX === '_board:main:' && lib.WB_BOARD_ID === 'settings', 'the key is _board:main:settings (a bookkeeping key, next to block:main:<id>)');
  check(lib.wb.id(lib.WB_BOARD_STEP) === null, 'the history id of the settings is no block id');
  check(usual.background === 'default', 'a new board is Default');
  check(clean({ id: 'settings', background: 'blue' }).background === 'blue', 'a palette colour is kept');
  check(clean({ id: 'settings', background: 'magenta' }).background === 'default', 'an unknown palette id falls back to Default');
  check(clean({ id: 'settings', background: '#ff0000' }).background === 'default', 'a raw colour falls back to Default');
  check(clean({ id: 'settings' }).background === 'default', 'no background is Default');
  check(clean({ id: 'settings', background: { a: 1 } }).background === 'default', 'a background that is not a string is Default');
  check(clean({ id: 'other', background: 'blue' }) === null, 'a value that is not the settings is left out');
  check(clean(null) === null && clean('blue') === null, 'what is not an object is left out');
  // Override theme: kept only when exactly true.
  check(usual.override === false, 'a new board has Override theme off');
  check(clean({ id: 'settings', override: true }).override === true, 'override true is kept');
  for (const v of [false, 'true', 1, null, undefined, {}, 'yes']) check(clean({ id: 'settings', override: v }).override === false, `override ${JSON.stringify(v)} reads as off`);
  check(clean({ id: 'settings' }).override === false, 'no override is off');
  check(clean({ id: 'settings', background: 'blue', override: true }).background === 'blue', 'override and background are independent');
  const c = clean({ id: 'settings', background: 'teal', by: 'x'.repeat(200), extra: 1 });
  check(c.type === 'board' && c.by.length === 64 && !('extra' in c), 'the clean keeps only its own fields');
}

// ---- the dots ----
function dots() {
  const { wbBackdrop: bd, WB_PALETTE: palette } = lib;
  const raw = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;
  const d = bd('default');
  check(d.id === 'default' && d.ground === 'var(--surface-page)', 'Default is the page colour');
  check(bd('nope').id === 'default' && bd(undefined).id === 'default', 'an unknown background draws as Default');
  for (const c of palette) {
    const x = bd(c.id);
    check(x.ground.includes(c.token) && x.ground.includes('var(--surface-page)'), `${c.id}: the ground is a wash of its token on the page`);
    check(!raw.test(x.ground) && !raw.test(x.dot), `${c.id}: theme tokens only`);
    check(x.dot.includes('var(--text-primary)') && x.dot.includes(`${x.strength}%`), `${c.id}: the dot is the words' colour at its strength`);
    check(x.strength > d.strength, `${c.id}: the dots are stronger on a wash than on the plain page`);
    if (c.id !== 'ink') check(bd('ink').strength > x.strength, `ink: the dots are strongest on Ink (vs ${c.id})`);
  }
  check(!raw.test(d.dot), 'Default: theme tokens only');
  // Override theme: the colour itself, the dots in the ink given.
  for (const c of palette) {
    const x = bd(c.id, true, 'var(--surface-page)');
    check(x.ground === c.token, `${c.id}: with override the ground is the token itself`);
    check(x.dot.includes('var(--surface-page)') && !raw.test(x.ground) && !raw.test(x.dot), `${c.id}: with override the dots take the ink given, tokens only`);
    check(bd(c.id, true).dot.includes('var(--text-primary)'), `${c.id}: the dots default to the words' colour`);
  }
  check(bd('default', true).ground === 'var(--surface-page)', 'Default stays the page colour with override');
  check(bd('blue', false).ground.includes('color-mix'), 'override off is the wash as before');
  // The contrast pick.
  const black = [0, 0, 0];
  const white = [255, 255, 255];
  check(Math.abs(lib.wbContrast(black, white) - 21) < 0.01, 'black on white is 21:1');
  check(lib.wbContrastInk([241, 230, 216], black, white) === 'dark', 'dark words on a light fill');
  check(lib.wbContrastInk([26, 18, 6], black, white) === 'light', 'light words on a dark fill');
  check(lib.wbContrastInk([0, 0, 0], white, black) === 'dark', 'the first candidate is "dark" whichever way round');
  check(lib.wbContrastInk(null, black, white) === null && lib.wbContrastInk([1, 2], black, white) === null && lib.wbContrastInk([NaN, 0, 0], black, white) === null, 'a colour that is not three numbers gives no answer');
  const themes = [
    { fills: [[217, 169, 60], [79, 191, 178], [111, 191, 115], [106, 166, 232], [224, 122, 110], [241, 230, 216]], dark: [26, 20, 16], light: [241, 230, 216] }, // the dark theme's tints and words
    { fills: [[148, 104, 10], [0, 121, 107], [42, 98, 176], [179, 55, 43], [46, 125, 50], [26, 20, 16]], dark: [26, 20, 16], light: [250, 248, 244] }, // the light theme's
  ];
  for (const t of themes) {
    for (const fill of t.fills) {
      const pick = lib.wbContrastInk(fill, t.dark, t.light);
      const best = Math.max(lib.wbContrast(fill, t.dark), lib.wbContrast(fill, t.light));
      check(lib.wbContrast(fill, pick === 'dark' ? t.dark : t.light) === best && best >= 4.5, `fill ${fill}: the pick has the better ratio, at least 4.5:1`);
    }
  }
}

// ---- a fake server (versions as server/module-data.js) and pages ----
function createServer() {
  const data = new Map();
  const pages = [];
  const emit = (change) => { for (const p of pages) p.inbox.push({ ...change, scope: 'space' }); };
  return {
    data,
    pages,
    set(key, value, by) {
      const was = data.get(key);
      const entry = { value: JSON.parse(JSON.stringify(value)), version: (was ? was.version : 0) + 1 };
      data.set(key, entry);
      emit({ key, value: entry.value, version: entry.version, deleted: false, by });
      return { key, ...entry, updatedAt: new Date().toISOString() };
    },
    // A Clear: every key goes, one 'changes' event.
    clear(by) {
      const changes = [...data].map(([key, e]) => ({ key, value: null, version: e.version + 1, deleted: true, by }));
      data.clear();
      for (const p of pages) p.inbox.push({ many: true, cleared: true, by, changes, scope: 'space' });
    },
  };
}

// A page in small: the board's settings as whiteboard.js keeps them, and a block sync beside it (it must not take the
// settings key, nor the settings sync a block's).
function createPage(server, name) {
  const page = { name, inbox: [], blocksHeard: [], settings: lib.WB_BOARD_USUAL, drop: 0, hold: false, held: [] };
  const host = {
    storage: {
      // The server takes a write at once; with page.hold its answer waits until the check lets it go (page.release).
      set: (key, value) => {
        const out = server.set(key, value, name);
        return page.hold ? new Promise((r) => { page.held.push(() => r(out)); }) : Promise.resolve(out);
      },
      delete: async () => { throw new Error('the settings are never deleted by a page'); },
      get: async (key) => { const e = server.data.get(key); return e ? { key, ...e } : null; },
      list: async (prefix) => [...server.data].filter(([k]) => k.startsWith(prefix)).map(([key, e]) => ({ key, ...e })),
    },
  };
  const history = lib.createHistory({ cap: 100 });
  const take = (change) => { page.settings = change.op === 'put' ? change.block : lib.WB_BOARD_USUAL; };
  const boardSync = lib.createSync({ host, board: 'main', prefix: lib.WB_BOARD_PREFIX, clean: lib.wbCleanBoard, me: name, onRemote: take, onReload: () => page.reload(), onRefused: () => {} });
  const blockSync = lib.createSync({ host, board: 'main', clean: lib.wbClean, me: name, onRemote: (c) => page.blocksHeard.push(c), onReload: () => {}, onRefused: () => {} });
  function commitBoard(next) {
    const stamped = { ...lib.wbCleanBoard(next), by: name, at: new Date().toISOString() };
    history.record(lib.WB_BOARD_STEP, page.settings, stamped);
    page.settings = stamped;
    boardSync.save(stamped);
  }
  const apply = (list) => lib.wbApplyChanges(list, {
    get: (id) => (id === lib.WB_BOARD_STEP ? page.settings : null),
    remove: () => {},
    put: (b) => commitBoard(b),
    canChange: () => true,
    canCreate: () => true,
    clean: (raw) => lib.wbCleanBoard(raw),
    linkedOf: () => [],
    isBoard: (id) => id === lib.WB_BOARD_STEP,
  });
  Object.assign(page, {
    history,
    boardSync,
    pick(id) { commitBoard({ ...page.settings, background: id }); },
    pick2(fields) { commitBoard({ ...page.settings, ...fields }); },
    undo() { return history.undo(apply); },
    redo() { return history.redo(apply); },
    async reload() { const list = await boardSync.load(); page.settings = list[0] || lib.WB_BOARD_USUAL; },
    // Hand over what came, in order; `drop` of them (the oldest) are lost on the way (a stream that reconnects).
    deliver() {
      const list = page.inbox.splice(0);
      for (const e of list) {
        if (page.drop > 0) { page.drop -= 1; continue; }
        if (e.many) { boardSync.handleMany(e); blockSync.handleMany(e); continue; }
        boardSync.handle(e);
        blockSync.handle(e);
      }
    },
  });
  server.pages.push(page);
  return page;
}
const bg = (p) => p.settings.background;

async function syncing() {
  const server = createServer();
  const a = createPage(server, 'ann');
  const b = createPage(server, 'bob');
  const KEY = `${lib.WB_BOARD_PREFIX}${lib.WB_BOARD_ID}`;

  // A picks Blue: one write, B sees it, A's echo changes nothing.
  a.pick('blue');
  await settle();
  check(server.data.get(KEY) && server.data.get(KEY).value.background === 'blue' && server.data.get(KEY).version === 1, 'a pick is one whole write of the settings key');
  a.deliver(); b.deliver();
  await settle();
  check(bg(a) === 'blue' && bg(b) === 'blue', 'a pick shows on both pages');
  check(a.blocksHeard.length === 0 && b.blocksHeard.length === 0, 'the block sync leaves the settings key alone');

  // A block's change is not the settings sync's.
  server.set('block:main:n1', { id: 'n1', type: 'note', x: 0, y: 0 }, 'bob');
  a.deliver(); b.deliver();
  await settle();
  check(bg(a) === 'blue' && bg(b) === 'blue', 'the settings sync leaves a block key alone');

  // Undo and redo on A: one step each, seen by B.
  await new Promise((r) => { setImmediate(r); }); // the step is closed at the end of the turn
  check(a.history.size === 1, 'a pick is one undo step');
  a.undo();
  await settle(); a.deliver(); b.deliver(); await settle();
  check(bg(a) === 'default' && bg(b) === 'default', 'undo puts the background back (Default) on both pages');
  a.redo();
  await settle(); a.deliver(); b.deliver(); await settle();
  check(bg(a) === 'blue' && bg(b) === 'blue', 'redo puts the pick back on both pages');

  // A later change by B: A takes it; A's undo now leaves it (someone else changed it since), with its note.
  b.pick('green');
  await settle(); a.deliver(); b.deliver(); await settle();
  check(bg(a) === 'green', 'a later change by the other page is taken');
  const r = a.undo();
  await settle(); a.deliver(); b.deliver(); await settle();
  check(r && r.board === true && r.kept === 0, 'undo of a background someone else changed since is left (board, not a block)');
  check(bg(a) === 'green' && bg(b) === 'green', 'their background stays');
  check(lib.wbUndoNote(r) === 'Left the background as it is: someone else changed it since.', 'the note says so in plain words');
  // B's own undo still works: back to Blue (what B changed from).
  b.undo();
  await settle(); a.deliver(); b.deliver(); await settle();
  check(bg(a) === 'blue' && bg(b) === 'blue', "the other page's undo puts back what it changed from");

  // A missed echo: A picks Red and its echo is lost; B then picks Teal: A takes it (a newer version), and is not stuck.
  a.pick('red');
  await settle();
  a.drop = 1; a.deliver(); b.deliver(); await settle();
  check(bg(b) === 'red', 'the other page sees the pick');
  b.pick('teal');
  await settle(); a.deliver(); b.deliver(); await settle();
  check(bg(a) === 'teal', 'after a missed echo, a later change is still taken');

  // A change heard while A's write is on its way waits for it (the deferred queue), then is judged: the newer one stands.
  a.hold = true;
  a.pick('pink'); // on the server first (version n), its answer held
  await settle();
  b.pick('purple'); // then B's (version n+1)
  await settle();
  a.deliver(); b.deliver(); await settle(); // A hears its own echo and B's change while its write is not answered
  check(bg(a) === 'pink', 'a change heard while writing the key waits');
  a.hold = false; a.held.splice(0).forEach((f) => f());
  await settle();
  check(bg(a) === 'purple' && bg(b) === 'purple' && server.data.get(KEY).value.background === 'purple', 'once the write is answered, what waited is taken: every page shows what the server holds');

  // A reload shows it.
  const c = createPage(server, 'cy');
  await c.reload();
  check(bg(c) === 'purple', 'a new page (a reload) shows the background');

  // A Clear takes the key: every page goes to Default (the page that cleared puts it back, whiteboard.js keepBackground).
  server.clear('ann');
  a.deliver(); b.deliver(); c.deliver();
  await settle();
  check(bg(a) === 'default' && bg(b) === 'default' && bg(c) === 'default', 'a deleted key is Default');
  server.data.set(KEY, { value: { id: 'settings', background: 'not-a-colour' }, version: 9 });
  await b.reload();
  check(bg(b) === 'default', 'a stored unknown colour reads as Default');
}

async function overriding() {
  const server = createServer();
  const a = createPage(server, 'ann');
  const b = createPage(server, 'bob');
  const KEY = `${lib.WB_BOARD_PREFIX}${lib.WB_BOARD_ID}`;
  const flip = (p, on) => p.pick2({ override: on });
  a.pick('blue');
  await settle(); a.deliver(); b.deliver(); await settle();
  await new Promise((r) => { setImmediate(r); });
  flip(a, true);
  await settle(); a.deliver(); b.deliver(); await settle();
  check(server.data.get(KEY).value.override === true && server.data.get(KEY).value.background === 'blue', 'switching on is one whole write that keeps the background');
  check(a.settings.override === true && b.settings.override === true && b.settings.background === 'blue', 'the other page sees it on');
  await new Promise((r) => { setImmediate(r); });
  a.undo();
  await settle(); a.deliver(); b.deliver(); await settle();
  check(a.settings.override === false && b.settings.override === false && a.settings.background === 'blue', 'undo switches it off and leaves the background');
  a.redo();
  await settle(); a.deliver(); b.deliver(); await settle();
  check(a.settings.override === true && b.settings.override === true, 'redo switches it on');
  // Field by field: B changes the background; A's undo of override still works (override not changed by B since)
  b.pick('green');
  await settle(); a.deliver(); b.deliver(); await settle();
  const r = a.undo();
  await settle(); a.deliver(); b.deliver(); await settle();
  check(r && r.board !== true && a.settings.override === false && a.settings.background === 'green' && b.settings.override === false, "undoing override leaves someone else's background");
  // B changes override after A: A's undo of it leaves B's value with the note
  a.redo();
  await settle(); a.deliver(); b.deliver(); await settle();
  b.pick2({ override: false });
  await settle(); a.deliver(); b.deliver(); await settle();
  const r2 = a.undo();
  await settle(); a.deliver(); b.deliver(); await settle();
  check(r2 && r2.board === true && a.settings.override === false && b.settings.override === false, 'an override someone else changed since is left as it is');
  const c = createPage(server, 'cy');
  b.pick2({ override: true });
  await settle(); await c.reload();
  check(c.settings.override === true, 'a reload shows it');
  server.clear('ann');
  a.deliver(); b.deliver(); c.deliver(); await settle();
  check(c.settings.override === false, 'a deleted key is off');
}

async function main() {
  if (!fails.length) {
    for (const [name, fn] of [['format', format], ['dots', dots], ['syncing', syncing], ['overriding', overriding]]) {
      try { await fn(); } catch (err) { fails.push(`${name}: ${err.stack || err.message}`); }
    }
  }
  if (fails.length) {
    console.error(`check-whiteboard-background: ${fails.length} failed, ${passed} passed`);
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`check-whiteboard-background: ${passed} passed`);
}
main();
