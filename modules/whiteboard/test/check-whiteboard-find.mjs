#!/usr/bin/env node
/*
 * check-whiteboard-find.mjs -- Find in the board (modules/whiteboard/src/whiteboard-lib-o-find.js).
 * Guards:
 *   - the words each block type is searched by: notes, text and shapes as plain words (their markup read by the SDK's own
 *     host.util.plain, as the page has it), a table cell by cell, a frame's title, a connector's label, a picture's
 *     description; nothing of a timer or a drawing;
 *   - matching: case and accents aside (both ways), nothing for nothing typed, no matches, a block counted once however
 *     often the words are in it, at most 100 characters searched for, never across two cells;
 *   - reading order: top to bottom, then left to right; a block that is not drawn is left out;
 *   - next and previous, round at both ends; the count ("No matches", "2 of 7") and what is read out;
 *   - the matches found again while the board changes: the one shown kept, else the one in its place, held to the end;
 *   - the / key: opens Find on the board, never while words are edited (a note, a cell, a frame's title, the formatting
 *     bar), while presenting, with Ctrl, Cmd or Alt, or while a character is composed;
 *   - where the view goes: nowhere for a match in sight, its middle at the same zoom, zoomed out only for one too big.
 * It runs the module's own libs in one scope as the page has them (lib files in name order), with no page. No network.
 * Usage: node modules/whiteboard/test/check-whiteboard-find.mjs [path to the src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
const NAMES = ['WB_FIND', 'wbFindFold', 'wbFindQuery', 'wbFindWords', 'wbFindMatches', 'wbFindStep', 'wbFindCount', 'wbFindWordsSaid', 'wbFindFollow',
  'wbFindKey', 'wbFindView', 'wbClean', 'wbMarkup'];

let passed = 0;
const fails = [];
let L = {};
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-[a-z]-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  const grab = NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  L = new Function(`${parts.join('\n')}\nreturn { ${grab} };`)();
  // The page hands the board the SDK's plain text of markup (host.util.plain); so does this.
  const sdk = fs.readFileSync(path.join(root, 'public/sdk/host.js'), 'utf8');
  const win = { addEventListener() {}, location: { search: '' } };
  win.parent = win;
  new Function('window', 'document', sdk)(win, { createElement: (tag) => ({ tag }) });
  if (L.wbMarkup) L.wbMarkup.plain = win.hostText.plain;
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
const clean = (raw) => { const b = L.wbClean({ z: 1, ...raw }); if (!b) throw new Error(`not a block: ${JSON.stringify(raw)}`); return b; };
const note = (id, x, y, text, more = {}) => clean({ id, type: 'note', x, y, w: 100, h: 80, text, ...more });
const at = (b) => ({ x: b.x || 0, y: b.y || 0 });

// ---- the words searched -----------------------------------------------------------------------------------------------
await test('words: notes, text and shapes as plain words', () => {
  assert.equal(L.wbFindWords(note('n', 0, 0, '**Bold** and _slanted_ with [a link](https://x.example)')), 'Bold and slanted with a link (https://x.example)');
  assert.equal(L.wbFindWords(clean({ id: 't', type: 'text', x: 0, y: 0, w: 200, text: '# Heading\n\n- one\n- `two`' })), 'Heading - one - two');
  assert.equal(L.wbFindWords(clean({ id: 'r', type: 'rect', x: 0, y: 0, w: 100, h: 60, text: '~~old~~ new' })), 'old new');
});
await test('words: a table cell by cell, markup read', () => {
  const t = clean({ id: 'g', type: 'table', x: 0, y: 0, cols: [100, 100], rows: [40, 40], cells: [['**Name**', 'Café'], ['', 'last']] });
  assert.equal(L.wbFindWords(t), 'Name\nCafé\nlast');
});
await test('words: a frame\'s title, a connector\'s label, a picture\'s description', () => {
  assert.equal(L.wbFindWords(clean({ id: 'f', type: 'frame', x: 0, y: 0, w: 400, h: 300, title: 'Plan for Monday' })), 'Plan for Monday');
  assert.equal(L.wbFindWords(clean({ id: 'c', type: 'connector', from: { block: 'a', side: 'auto' }, to: { block: 'b', side: 'auto' }, label: 'leads to' })), 'leads to');
  assert.equal(L.wbFindWords(clean({ id: 'i', type: 'image', x: 0, y: 0, w: 100, h: 100, upload: 'c'.repeat(24), alt: 'A map of the town' })), 'A map of the town');
});
await test('words: nothing of a timer or a drawing', () => {
  assert.equal(L.wbFindWords(clean({ id: 'y', type: 'timer', x: 0, y: 0 })), '');
  assert.equal(L.wbFindWords(clean({ id: 's', type: 'stroke', x: 0, y: 0, points: [0, 0, 10, 10, 20, 5] })), '');
  assert.equal(L.wbFindWords(null), '');
  assert.equal(L.wbFindWords({ id: 'z', type: 'nothing-like-it' }), '');
});

// ---- matching -----------------------------------------------------------------------------------------------------------
const board = [
  note('a', 0, 0, 'Café au lait'),
  note('b', 300, 0, 'cafe CAFE cafe'),
  note('c', 0, 200, 'Tea'),
  clean({ id: 'g', type: 'table', x: 300, y: 200, cols: [100, 100], rows: [40, 40], cells: [['red', 'apple'], ['', '']] }),
  clean({ id: 'f', type: 'frame', x: -100, y: -100, w: 900, h: 600, title: 'Crème brûlée', z: 0 }),
];
await test('matching: case and accents aside, both ways', () => {
  assert.deepEqual(L.wbFindMatches(board, 'cafe', { at }), ['a', 'b']);
  assert.deepEqual(L.wbFindMatches(board, 'CAFÉ', { at }), ['a', 'b']);
  assert.deepEqual(L.wbFindMatches(board, 'creme BRULEE', { at }), ['f']);
  assert.equal(L.wbFindFold('Ça Ñandú Øre'), 'ca nandu øre', 'marks go, letters stay');
});
await test('matching: nothing typed, nothing found; no matches', () => {
  assert.deepEqual(L.wbFindMatches(board, '', { at }), []);
  assert.deepEqual(L.wbFindMatches(board, '   ', { at }), []);
  assert.deepEqual(L.wbFindMatches(board, 'coffee', { at }), []);
});
await test('matching: a block once however often the words are in it', () => {
  assert.deepEqual(L.wbFindMatches([note('b', 0, 0, 'cafe CAFE cafe café')], 'cafe', { at }), ['b']);
});
await test('matching: at most 100 characters; never across two cells; spaces run together', () => {
  const long = 'x'.repeat(100);
  assert.equal(L.wbFindQuery(`${long}yyyy`), long, 'cut at 100');
  assert.deepEqual(L.wbFindMatches([note('l', 0, 0, long)], `${long}zzz`, { at }), ['l'], 'what is past 100 is not searched for');
  assert.deepEqual(L.wbFindMatches(board, 'red apple', { at }), [], 'two cells are not one');
  assert.deepEqual(L.wbFindMatches(board, 'apple', { at }), ['g']);
  assert.deepEqual(L.wbFindMatches(board, 'au    lait', { at }), ['a']);
});

// ---- reading order ------------------------------------------------------------------------------------------------------
await test('reading order: top to bottom, then left to right; one not drawn left out', () => {
  const list = [note('d', 500, 300, 'x'), note('a', 0, 0, 'x'), note('c', 0, 300, 'x'), note('b', 400, 0, 'x'), note('e', 10, 900, 'x')];
  assert.deepEqual(L.wbFindMatches(list, 'x', { at }), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(L.wbFindMatches(list, 'x', { at: (b) => (b.id === 'c' ? null : at(b)) }), ['a', 'b', 'd', 'e']);
  const same = [note('q', 0, 0, 'x'), note('p', 0, 0, 'x')];
  assert.deepEqual(L.wbFindMatches(same, 'x', { at }), ['p', 'q'], 'the same place: by id, so every page agrees');
});

// ---- going through them -------------------------------------------------------------------------------------------------
await test('next and previous, round at both ends', () => {
  assert.equal(L.wbFindStep(0, 3, 1), 1);
  assert.equal(L.wbFindStep(2, 3, 1), 0, 'next after the last: the first');
  assert.equal(L.wbFindStep(0, 3, -1), 2, 'previous before the first: the last');
  assert.equal(L.wbFindStep(-1, 3, 1), 0, 'none shown yet: next is the first');
  assert.equal(L.wbFindStep(-1, 3, -1), 2, 'none shown yet: previous is the last');
  assert.equal(L.wbFindStep(7, 3, 1), 0, 'past the end (the matches went): the first');
  assert.equal(L.wbFindStep(0, 0, 1), -1, 'no matches');
  assert.equal(L.wbFindStep(0, 1, 1), 0, 'one match: stays');
});
await test('the count and what is read out', () => {
  assert.equal(L.wbFindCount('', 0, 0), '', 'nothing typed: nothing said');
  assert.equal(L.wbFindCount('tea', -1, 0), 'No matches');
  assert.equal(L.wbFindCount('tea', 1, 7), '2 of 7');
  assert.equal(L.wbFindCount('tea', -1, 4), '1 of 4');
  assert.equal(L.wbFindWordsSaid(1, 7, 'Café  au\nlait'), 'Match 2 of 7: Café au lait');
  assert.equal(L.wbFindWordsSaid(0, 0, 'x'), 'No matches');
  const said = L.wbFindWordsSaid(0, 1, 'w'.repeat(200));
  assert.ok(said.length <= 'Match 1 of 1: '.length + L.WB_FIND.say && said.endsWith('…'), said);
  assert.equal(L.wbFindWordsSaid(0, 2, ''), 'Match 1 of 2', 'a block without words');
});
await test('found again while the board changes: kept, else the one in its place', () => {
  assert.equal(L.wbFindFollow(['a', 'b', 'c'], 1, ['x', 'a', 'b', 'c']), 2, 'the one shown kept, wherever it now is');
  assert.equal(L.wbFindFollow(['a', 'b', 'c'], 1, ['a', 'c']), 1, 'gone: the one now in its place');
  assert.equal(L.wbFindFollow(['a', 'b', 'c'], 2, ['a', 'b']), 1, 'the last gone: held to the new last');
  assert.equal(L.wbFindFollow(['a', 'b'], 0, []), -1, 'none left');
  assert.equal(L.wbFindFollow([], -1, ['a']), 0, 'one appears: it is the one shown');
});

// ---- the / key ----------------------------------------------------------------------------------------------------------
await test('the / key: on the board only, never while words are edited', () => {
  const inside = (sel) => ({ closest: (q) => (q.split(',').map((x) => x.trim()).some((x) => x === sel) ? {} : null) });
  const board = { closest: () => null };
  const key = (k, more = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, target: board, ...more });
  assert.equal(L.wbFindKey(key('/')), true);
  assert.equal(L.wbFindKey(key('/', { shiftKey: true })), true, 'Shift is allowed (some keyboards need it)');
  assert.equal(L.wbFindKey(key('?')), false);
  assert.equal(L.wbFindKey(key('f')), false);
  for (const m of ['ctrlKey', 'metaKey', 'altKey', 'isComposing']) assert.equal(L.wbFindKey(key('/', { [m]: true })), false, m);
  assert.equal(L.wbFindKey(key('/'), { editing: true }), false, 'while words are edited');
  assert.equal(L.wbFindKey(key('/'), { presenting: true }), false, 'while presenting');
  for (const sel of ['.wb-text-edit', '.wb-format', '.wb-find', 'input', 'textarea']) assert.equal(L.wbFindKey(key('/', { target: inside(sel) })), false, `in ${sel}`);
  assert.equal(L.wbFindKey(null), false);
});

// ---- where the view goes ------------------------------------------------------------------------------------------------
await test('the view: nowhere when in sight; its middle at the same zoom; zoomed out only for one too big', () => {
  const view = { x: 0, y: 0, s: 1 };
  assert.equal(L.wbFindView({ x0: 100, y0: 100, x1: 200, y1: 200 }, view, 800, 600), null, 'in sight');
  const v = L.wbFindView({ x0: 2000, y0: 1000, x1: 2100, y1: 1080 }, view, 800, 600);
  assert.equal(v.s, 1, 'the zoom kept');
  assert.ok(Math.abs((400 - v.x) / v.s - 2050) < 1e-9 && Math.abs((300 - v.y) / v.s - 1040) < 1e-9, `centred: ${JSON.stringify(v)}`);
  const half = L.wbFindView({ x0: 790, y0: 100, x1: 900, y1: 200 }, view, 800, 600);
  assert.ok(half && half.s === 1, 'partly out of sight: moved');
  const big = L.wbFindView({ x0: 0, y0: 0, x1: 3000, y1: 500 }, view, 800, 600);
  assert.ok(big.s < 1 && Math.abs(big.s - (800 - 48) / 3000) < 1e-9, `too big: fitted (${big.s})`);
  const zoomedOut = L.wbFindView({ x0: 5000, y0: 0, x1: 5100, y1: 50 }, { x: 0, y: 0, s: 0.3 }, 800, 600);
  assert.equal(zoomedOut.s, 0.3, 'never zooms in');
  const huge = L.wbFindView({ x0: 0, y0: 0, x1: 100000, y1: 100 }, view, 800, 600, { min: 0.2 });
  assert.equal(huge.s, 0.2, 'never under the least zoom');
});

if (fails.length) {
  console.error(`check-whiteboard-find: ${fails.length} failed, ${passed} passed`);
  for (const f of fails) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(`check-whiteboard-find: OK (${passed} checks)`);
