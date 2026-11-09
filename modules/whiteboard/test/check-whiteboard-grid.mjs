#!/usr/bin/env node
/*
 * check-whiteboard-grid.mjs -- the Grid button's rules (modules/whiteboard/src/whiteboard-lib-a-core.js).
 * Guards: the saved grid is read and cleaned (bad JSON, out-of-range size, unknown style or colour, opacity bounds, storage that
 * throws or is missing); wbSnap uses the pitch (the live one, or one given); the dots sit half a step back and the lines on
 * whole pixels; the colour (automatic, chosen, with and without a set opacity). Runs the lib with no page. No network.
 * Usage: node modules/whiteboard/test/check-whiteboard-grid.mjs [path to the src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
const NAMES = ['wbGrid', 'wbGridClean', 'wbGridLoad', 'wbGridSave', 'wbGridPaint', 'wbGridOffset', 'wbSnap', 'wbBackdrop', 'WB_GRID', 'WB_GRID_KEY'];
let passed = 0;
const fails = [];
const check = (ok, what) => { if (ok) passed += 1; else fails.push(what); };

let L = {};
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-a-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  const grab = NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  L = new Function(`${parts.join('\n')}\nreturn { ${grab} };`)();
} catch (err) { fails.push(`the lib does not load: ${err.message}`); }
const missing = NAMES.filter((n) => typeof L[n] === 'undefined');
if (missing.length) fails.push(`the lib has no ${missing.join(', ')}`);

if (!missing.length) {
  const usual = { style: 'dots', size: 24, color: 'auto', opacity: null };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const store = (v) => () => ({ getItem: (k) => (k === L.WB_GRID_KEY ? v : null), setItem: () => {} });
  check(same(L.wbGridLoad(store(null)), usual), 'nothing saved: the usual');
  check(same(L.wbGridLoad(store('{bad')), usual), 'bad JSON: the usual');
  check(same(L.wbGridLoad(() => { throw new Error('no storage'); }), usual), 'storage that throws: the usual');
  check(same(L.wbGridLoad(() => null), usual), 'no storage: the usual');
  check(same(L.wbGridLoad(store(JSON.stringify({ style: 'lines', size: 48, color: 'blue', opacity: 0.5 }))), { style: 'lines', size: 48, color: 'blue', opacity: 0.5 }), 'a good grid is kept');
  for (const size of [7, 97, 24.5, '24', null, NaN]) check(L.wbGridClean({ size }).size === 24, `size ${JSON.stringify(size)}: 24`);
  for (const size of [8, 96]) check(L.wbGridClean({ size }).size === size, `size ${size} is kept`);
  check(L.wbGridClean({ style: 'grid' }).style === 'dots' && L.wbGridClean({ style: 'off' }).style === 'off', 'an unknown style is dots; off is kept');
  check(L.wbGridClean({ color: '#ff0000' }).color === 'auto' && L.wbGridClean({ color: 'accent' }).color === 'accent', 'an unknown colour is automatic');
  check(L.wbGridClean({ color: 'ink' }).color === 'auto', 'Charcoal is not a grid colour');
  for (const o of [-0.1, 1.1, '0.5', NaN, undefined]) check(L.wbGridClean({ opacity: o }).opacity === null, `opacity ${String(o)}: automatic`);
  check(L.wbGridClean({ opacity: 0 }).opacity === 0 && L.wbGridClean({ opacity: 1 }).opacity === 1, 'opacity 0 and 1 are kept');
  check(same(L.wbGridClean([1, 2]), usual) && same(L.wbGridClean('x'), usual), 'what is not an object: the usual');
  let kept = null;
  check(L.wbGridSave(() => ({ setItem: (k, v) => { kept = [k, v]; } }), { style: 'off', size: 1 }) && kept[0] === 'whiteboard-grid' && JSON.parse(kept[1]).size === 24, 'saved cleaned under one key');
  check(L.wbGridSave(() => { throw new Error('full'); }, usual) === false, 'a store that throws is told, not thrown');

  check(L.wbSnap(30) === 24 && L.wbSnap(37) === 48, 'snaps to 24 by default');
  check(L.wbSnap(30, 8) === 32 && L.wbSnap(100, 48) === 96 && L.wbSnap(-30, 20) === -20, 'snaps to the pitch given');
  L.wbGrid.size = 40;
  check(L.wbSnap(59) === 40 && L.wbSnap(61) === 80, 'snaps to the live pitch');
  L.wbGrid.size = L.WB_GRID;

  const o = L.wbGridOffset('dots', { x: 100, y: 7.5 }, 24);
  check(o.x === 88 && o.y === -4.5, 'dots: half a step back');
  const l = L.wbGridOffset('lines', { x: 100.4, y: 7.5 }, 24);
  check(l.x === 100 && l.y === 8, 'lines: at the origin, whole pixels');

  const d = L.wbBackdrop('default');
  check(L.wbGridPaint(d, usual) === d.dot, 'automatic is the background\'s own dot colour');
  check(L.wbGridPaint(d, { ...usual, opacity: 0.4 }) === 'color-mix(in srgb, var(--text-primary) 40%, transparent)', 'automatic at a set opacity');
  check(L.wbGridPaint(d, { ...usual, color: 'accent' }) === `color-mix(in srgb, var(--accent) ${d.strength}%, transparent)`, 'a chosen colour at the background\'s strength');
  check(L.wbGridPaint(d, { ...usual, color: 'blue', opacity: 0 }) === 'color-mix(in srgb, var(--tint-blue) 0%, transparent)', 'opacity 0');
  const fx = L.wbBackdrop('dark-black');
  check(L.wbGridPaint(fx, { ...usual, opacity: 0.5 }).includes('--wb-fixed-ink-dark'), 'on a fixed dark background the ink is the fixed one');
}

if (fails.length) { console.error(`check-whiteboard-grid: ${fails.length} failed (${passed} passed)\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log(`check-whiteboard-grid: ok (${passed} checks)`);
