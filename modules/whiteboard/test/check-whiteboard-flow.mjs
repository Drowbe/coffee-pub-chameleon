#!/usr/bin/env node
/*
 * check-whiteboard-flow.mjs -- Flowchart auto-connect (wbAutoConnect) and the Table properties menu's model (wbTableProps).
 * Guards: a new shape in line with the last one (centre within 45 degrees of an axis, exactly 45 counts as across, gap
 * above 0 and at most 4 times the larger width or height) gets the facing sides; too far, touching, overlapping or
 * diagonal gets none; sizes may differ. wbTableProps: the one value the picked tables share, Mixed (undefined) when they
 * differ, the defaults for new tables when none is picked. No browser, no network.
 * Usage: node modules/whiteboard/test/check-whiteboard-flow.mjs [path to the module's src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
const NAMES = ['wbAutoConnect', 'wbTableProps', 'wbClean', 'blockTypes'];
let passed = 0;
const fails = [];
const check = (ok, what) => { if (ok) passed += 1; else fails.push(what); };
let lib = {};
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-(a|e)-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  const grab = NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  lib = new Function(`${parts.join('\n')}\nreturn { ${grab} };`)();
} catch (err) { fails.push(`the libs do not load: ${err.message}`); }
const missing = NAMES.filter((n) => typeof lib[n] === 'undefined');
if (missing.length) fails.push(`the libs have no ${missing.join(', ')}`);

if (!missing.length && !fails.length) {
  const { wbAutoConnect: ac, wbTableProps: tp } = lib;
  const box = (x, y, w = 100, h = 60) => ({ x, y, w, h });
  const last = box(0, 0);
  const sides = (n) => { const r = ac(last, n); return r ? `${r.from}>${r.to}` : null; };
  check(sides(box(160, 0)) === 'right>left', 'to the right: right side to left side');
  check(sides(box(-160, 5)) === 'left>right', 'to the left: left side to right side');
  check(sides(box(0, 120)) === 'bottom>top', 'below: bottom to top');
  check(sides(box(10, -120)) === 'top>bottom', 'above: top to bottom');
  check(sides(box(500, 0)) === 'right>left', 'gap of 4 widths (400) is still in range');
  check(sides(box(501, 0)) === null, 'a gap past 4 widths is too far');
  check(sides(box(0, 60 + 241)) === null && sides(box(0, 60 + 240)) === 'bottom>top', 'below: the range is 4 times the height');
  check(sides(box(100, 0)) === null && sides(box(50, 10)) === null, 'touching or overlapping: none');
  check(sides(box(300, 520)) === null, 'diagonal and far: none');
  check(sides(box(200, 200)) === 'right>left' && sides(box(200, 199)) === 'right>left', 'exactly 45 degrees counts as across');
  check(sides(box(200, 201)) === 'bottom>top', 'just past 45 degrees is down');
  check(ac(last, box(0, 0)) === null && ac(null, last) === null, 'same place or no last shape: none');
  check(ac(box(0, 0, 40, 40), box(540, 0, 200, 40)) !== null && ac(box(0, 0, 40, 40), box(1000, 0, 200, 40)) === null, 'different sizes: the larger width sets the range');
  check(ac(box(0, 0, 200, 40), box(0, 100, 40, 40)).from === 'bottom', 'different sizes: below, centres lined up');

  const tbl = (extra) => lib.wbClean({ ...lib.blockTypes.get('table').create(), id: 't', type: 'table', x: 0, y: 0, ...extra });
  const next = { align: 'center', valign: 'middle', head: true, size: 'small' };
  check(JSON.stringify(tp([], next)) === JSON.stringify(next), 'no table picked: the defaults for new tables');
  check(tp([tbl({ align: 'left' })], next).align === 'left', 'one table: its own align');
  const mixed = tp([tbl({ align: 'left', head: true }), tbl({ align: 'right', head: false })], next);
  check(mixed.align === undefined && mixed.head === undefined, 'tables that differ: Mixed');
  check(tp([tbl({ head: false })], next).head === false, 'header row off reads off');
  check(tp([tbl({ valign: undefined })], next).valign !== undefined, 'a table without valign reads as its type\'s own');
}

if (fails.length) {
  console.error(`check-whiteboard-flow: ${fails.length} failed, ${passed} passed`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-whiteboard-flow: ${passed} checks passed`);
