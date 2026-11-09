#!/usr/bin/env node
/*
 * check-whiteboard-table.mjs -- the Whiteboard's table block (whiteboard-lib-e-block-table.js), its tool
 * (whiteboard-lib-f-tool-table.js) and rows pasted from a spreadsheet (whiteboard-lib-k-table.js).
 * Guards: a table's clean data (defaults, unknown fields dropped, widths and counts limited, cells cleaned and trimmed,
 * the worst table under the 60 KB a value may be, cleaning twice changes nothing), inserting and deleting rows and
 * columns (and refusing past the limits), the order Tab and the arrow keys go in, scaling by a corner and dragging a
 * line, a cell kept written into the newest table (other people's cells stay; a full table cuts only the edited cell),
 * the words read out, tab-separated rows read as a table, the table tool's corners on the grid with Snap to grid (and
 * not without it), and its linked fields. It runs the module's own libs in one scope as the page has them. No network.
 * Usage: node modules/whiteboard/test/check-whiteboard-table.mjs [path to the module's src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
const NAMES = ['WB_TABLE', 'WB_GRID', 'wbClean', 'wbTableInsertRow', 'wbTableDeleteRow', 'wbTableInsertCol', 'wbTableDeleteCol', 'wbTableSetCell', 'wbTableStep', 'wbTableScale', 'wbTableColTo', 'wbTableRowTo', 'wbTableName', 'wbLooksTabular', 'wbParseTsv', 'wbTableFromGrid', 'blockTypes', 'tools'];
const fails = [];
let passed = 0;
let L = {};
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-[a-z]-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  const grab = NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  L = new Function('window', 'document', `${parts.join('\n')}\nreturn { ${grab} };`)({ devicePixelRatio: 1 }, undefined);
} catch (err) {
  fails.push(`the libs do not load: ${err.message}`);
}
const t = (name, fn) => { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } };
const { WB_TABLE: T } = L;
const tbl = (o = {}) => L.wbClean({ id: 'a1', type: 'table', x: 0, y: 0, ...o });

t('defaults', () => {
  const b = tbl();
  assert.deepEqual(b.cols, [120, 120, 120]); assert.deepEqual(b.rows, [null, null, null]);
  assert.deepEqual(b.cells, []); assert.equal(b.head, true); assert.equal(b.w, 360);
  assert.equal(b.fill, 'none'); assert.equal(b.stroke, 'ink'); assert.equal(b.ink, 'ink'); assert.equal(b.weight, 1);
  assert.equal(b.size, 'small'); assert.equal(b.align, 'center'); assert.ok(!('valign' in b)); // a stored table without valign reads as top (fonts check: a new table is centre and middle)
});
t('clean drops unknown, falls back', () => {
  const b = tbl({ cols: 'x', rows: [], cells: 'nope', head: 'yes', evil: 1, fill: '#f00', stroke: 'red', weight: 7, w: 9999 });
  assert.equal(b.evil, undefined); assert.deepEqual(b.cols, [120, 120, 120]); assert.deepEqual(b.rows, [null, null, null]);
  assert.equal(b.head, true); assert.equal(b.fill, 'none'); assert.equal(b.stroke, 'red'); assert.equal(b.weight, 1); assert.equal(b.w, 360);
});
t('clean limits widths and counts', () => {
  const b = tbl({ cols: [1, 5000, NaN, 'a', 100.04], rows: [1, null, 99999, 'x'] });
  assert.deepEqual(b.cols, [60, 800, 120, 120, 100]); assert.deepEqual(b.rows, [32, null, 800, null]);
  const big = tbl({ cols: Array(40).fill(70), rows: Array(80).fill(null) });
  assert.equal(big.cols.length, 20); assert.equal(big.rows.length, 50);
});
t('cells cleaned, trimmed, shaped', () => {
  const b = tbl({ cols: [100, 100], rows: [null, null, null], cells: [['a\tb', 'x\r\ny\u0001', 'beyond'], [5, ''], ['', ''], ['outside']] });
  assert.deepEqual(b.cells, [['a b', 'x\ny']]);
  const long = tbl({ cells: [['z'.repeat(900)]] });
  assert.equal(long.cells[0][0].length, 500);
});
t('max grid stays under the storage limit', () => {
  const hard = '"\\'.repeat(250); // escapes to double
  const b = tbl({ cols: Array(20).fill(800), rows: Array(50).fill(800), cells: Array.from({ length: 50 }, () => Array(20).fill(hard)) });
  const size = JSON.stringify({ ...b, by: 'x'.repeat(64), at: new Date().toISOString() }).length;
  assert.ok(JSON.stringify(b.cells).length <= T.textMax);
  assert.ok(size < 60 * 1024, `size ${size}`);
  const plain = tbl({ cols: Array(20).fill(800), rows: Array(50).fill(800), cells: Array.from({ length: 50 }, () => Array(20).fill('w'.repeat(500))) });
  assert.ok(JSON.stringify(plain).length < 60 * 1024);
  // cleaning again changes nothing (stable)
  assert.deepEqual(tbl(b), tbl(tbl(b)));
  const full = tbl({ cols: Array(20).fill(60), rows: Array(50).fill(null), cells: Array.from({ length: 50 }, () => Array(20).fill('')) });
  assert.deepEqual(full.cells, []);
});
t('insert and delete rows and columns', () => {
  const b = tbl({ cells: [['h1', 'h2', 'h3'], ['a', 'b', 'c'], ['d', '', 'f']] });
  let f = L.wbTableInsertRow(b, 1); let x = tbl({ ...b, ...f });
  assert.deepEqual(x.rows.length, 4); assert.deepEqual(x.cells, [['h1', 'h2', 'h3'], [], ['a', 'b', 'c'], ['d', '', 'f']]);
  f = L.wbTableDeleteRow(x, 0); x = tbl({ ...x, ...f }); assert.deepEqual(x.cells, [[], ['a', 'b', 'c'], ['d', '', 'f']]);
  f = L.wbTableInsertCol(x, 1); x = tbl({ ...x, ...f }); assert.deepEqual(x.cols, [120, 120, 120, 120]); assert.equal(x.w, 480);
  assert.deepEqual(x.cells, [[], ['a', '', 'b', 'c'], ['d', '', '', 'f']]);
  f = L.wbTableDeleteCol(x, 3); x = tbl({ ...x, ...f }); assert.deepEqual(x.cells, [[], ['a', '', 'b'], ['d']]);
  const one = tbl({ cols: [100], rows: [null] });
  assert.ok(L.wbTableDeleteRow(one, 0).refuse); assert.ok(L.wbTableDeleteCol(one, 0).refuse);
  const max = tbl({ cols: Array(20).fill(60), rows: Array(50).fill(null) });
  assert.match(L.wbTableInsertRow(max, 0).refuse, /50 rows/); assert.match(L.wbTableInsertCol(max, 0).refuse, /20 columns/);
  // header toggle is a field
  assert.equal(tbl({ ...b, head: false }).head, false);
});
t('tab order', () => {
  const b = tbl({ cols: [100, 100], rows: [null, null] });
  assert.deepEqual(L.wbTableStep(b, 0, 0, 'next'), { r: 0, c: 1 });
  assert.deepEqual(L.wbTableStep(b, 0, 1, 'next'), { r: 1, c: 0 });
  assert.deepEqual(L.wbTableStep(b, 1, 1, 'next'), { r: 2, c: 0, grow: true });
  assert.deepEqual(L.wbTableStep(b, 1, 0, 'prev'), { r: 0, c: 1 });
  assert.equal(L.wbTableStep(b, 0, 0, 'prev'), null);
  assert.deepEqual(L.wbTableStep(b, 0, 1, 'down'), { r: 1, c: 1 });
  assert.equal(L.wbTableStep(b, 1, 1, 'down'), null);
  assert.equal(L.wbTableStep(tbl({ cols: [100], rows: Array(50).fill(null) }), 49, 0, 'next'), null);
  assert.deepEqual(L.wbTableStep(b, 1, 1, 'up'), { r: 0, c: 1 });
  assert.equal(L.wbTableStep(b, 0, 0, 'left'), null);
});
t('scale and dividers', () => {
  const b = tbl({ x: 100, y: 50, cols: [100, 200], rows: [null, 40] });
  const start = { ...b, h: 80, heights: [40, 40] };
  // se corner: x, y stay; double
  let f = L.wbTableScale(start, { x: 100, y: 50, w: 600, h: 160 });
  assert.deepEqual(f, { x: 100, y: 50, cols: [200, 400], w: 600, rows: [80, 80] });
  // nw corner shrinking below minimums: right/bottom edges stay
  f = L.wbTableScale(start, { x: 390, y: 120, w: 10, h: 10 });
  assert.deepEqual(f.cols, [60, 60]); assert.equal(f.x, 100 + 300 - 120); assert.deepEqual(f.rows, [32, 32]); assert.equal(f.y, 50 + 80 - 64);
  // width only: rows untouched (auto stays auto)
  f = L.wbTableScale(start, { x: 100, y: 50, w: 450, h: 80 }); assert.deepEqual(f.rows, [null, 40]); assert.deepEqual(f.cols, [150, 300]);
  assert.deepEqual(L.wbTableColTo(b, 1, 100 + 100 + 30), { cols: [100, 60], w: 160 });
  assert.deepEqual(L.wbTableColTo(b, 0, 100 + 150.04), { cols: [150, 200], w: 350 });
  assert.deepEqual(L.wbTableRowTo(b, 0, 200, 50), { rows: [150, 40] });
  assert.deepEqual(L.wbTableRowTo(b, 1, 10, 50), { rows: [null, 32] });
});
t('cell-level merge on commit', () => {
  // A and B start from the same table; B (remote) changes (0,1) and adds a column; A commits (0,0) onto the newest.
  const base = tbl({ cells: [['h1', 'h2'], ['x']] });
  const remote = tbl({ ...base, ...L.wbTableInsertCol(base, 3), cells: [['h1', 'theirs', '', 'new col']] });
  const put = L.wbTableSetCell(remote, 0, 0, 'mine');
  const merged = tbl({ ...remote, cells: put.cells });
  assert.deepEqual(merged.cells, [['mine', 'theirs', '', 'new col']]);
  assert.equal(merged.cols.length, 4);
  // a cell no longer there
  assert.equal(L.wbTableSetCell(tbl({ cols: [100], rows: [null] }), 2, 0, 'gone'), null);
  // a full table cuts only the edited cell, never someone else's
  const fullCells = Array.from({ length: 50 }, () => Array(20).fill('q'.repeat(47)));
  const full = tbl({ cols: Array(20).fill(60), rows: Array(50).fill(null), cells: fullCells });
  const before = JSON.stringify(full.cells);
  const p = L.wbTableSetCell(full, 49, 19, 'Z'.repeat(500));
  const after = tbl({ ...full, cells: p.cells });
  assert.equal(p.cut, true);
  assert.ok(JSON.stringify(after.cells).length <= T.textMax);
  for (let r = 0; r < 49; r += 1) assert.deepEqual(after.cells[r], full.cells[r]);
  assert.ok(before.length <= T.textMax);
});
t('describe', () => {
  assert.equal(L.wbTableName(tbl()), 'Table, 3 rows by 3 columns');
  assert.equal(L.wbTableName(tbl({ cells: [['Name', '', 'Cost']] })), 'Table, 3 rows by 3 columns: Name, Cost');
  assert.equal(L.wbTableName(tbl({ head: false, cols: [90], rows: [null], cells: [['Name']] })), 'Table, 1 row by 1 column');
});
t('tsv', () => {
  assert.equal(L.wbLooksTabular('a\tb\nc\td\n'), true);
  assert.equal(L.wbLooksTabular('just words\nmore words'), false);
  assert.equal(L.wbLooksTabular('one\ttab\nno\nno\nno'), false);
  assert.equal(L.wbLooksTabular('a\tb'), true);
  assert.deepEqual(L.wbParseTsv('a\tb\r\nc\td\r\n'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(L.wbParseTsv('"multi\nline"\t"say ""hi"""\nx\t'), [['multi\nline', 'say "hi"'], ['x', '']]);
  assert.deepEqual(L.wbParseTsv('"open\tb'), [['"open', 'b']]);
  const huge = Array.from({ length: 300 }, (_, r) => Array.from({ length: 60 }, (_, c) => `${r}:${c}`).join('\t')).join('\n');
  const g = L.wbParseTsv(huge);
  assert.equal(g.length, 51); assert.equal(g[0].length, 21);
  const tf = L.wbTableFromGrid(g);
  assert.equal(tf.rows.length, 50); assert.equal(tf.cols.length, 20); assert.equal(tf.cut, true);
  const ok = L.wbTableFromGrid([['Name', 'Cost'], ['Tea', '3']]);
  assert.equal(ok.cut, false); assert.deepEqual(ok.cells, [['Name', 'Cost'], ['Tea', '3']]); assert.equal(ok.head, true);
  assert.ok(ok.cols.every((w) => w >= 80 && w <= 280));
  const longCell = L.wbTableFromGrid([['x'.repeat(2000)]]);
  assert.equal(longCell.cut, true); assert.equal(longCell.cells[0][0].length, 500);
});
t('the table tool puts its corners on the grid with Snap to grid, and only then', () => {
  const tool = L.tools.get('table');
  const g = L.WB_GRID;
  for (const snap of [true, false]) {
    let b = null;
    const ctx = new Proxy({
      snapping: () => snap,
      draft(type, fields) { b = L.wbClean({ id: 'g1', type, z: 1, ...fields }); return b; },
      change(id, fields) { b = L.wbClean({ ...b, ...fields }); },
      get: () => b,
    }, { get: (o, k) => (k in o ? o[k] : () => undefined) });
    const at = (x, y) => ({ x, y, sx: x, sy: y, event: {} });
    tool.down(at(13, 37), ctx);
    tool.move(at(13 + 400, 37 + 170), ctx);
    tool.up(at(13 + 400, 37 + 170), ctx);
    const right = b.x + b.cols.reduce((a, n) => a + n, 0);
    if (snap) {
      assert.deepEqual([b.x % g, b.y % g], [0, 0], `its corner on the grid (${b.x}, ${b.y})`);
      assert.ok(Math.abs(right - Math.round(right / g) * g) < 0.2, `its right edge on the grid (${right})`);
    } else {
      assert.deepEqual([b.x, b.y], [13, 37], 'where it was pressed');
    }
  }
});
t('a table\'s fields go back together on an undo', () => {
  const linked = L.blockTypes.get('table').linked || [];
  assert.ok(linked.some((g) => ['x', 'y', 'w', 'cols', 'rows', 'cells'].every((f) => g.includes(f))));
});

if (fails.length) {
  for (const f of fails) console.error(`FAIL ${f}`);
  console.error(`check-whiteboard-table: ${fails.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`check-whiteboard-table: OK, ${passed} cases`);
