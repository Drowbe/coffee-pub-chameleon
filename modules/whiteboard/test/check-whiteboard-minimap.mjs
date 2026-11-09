#!/usr/bin/env node
/*
 * check-whiteboard-minimap.mjs -- the Whiteboard's overview, the small map of the whole board
 * (modules/whiteboard/src/whiteboard-lib-n-overview.js).
 * Guards:
 *   - what the map shows: the box round every block (frames too) and the view, with a margin (a share of the longer side,
 *     at least a few board units); nothing for an empty board; far-apart blocks all in it;
 *   - the map and the board, both ways (the board's shape kept, centred, inside the map's padding);
 *   - a press puts the middle of the view on the point pressed, at the same zoom;
 *   - dragging the view's rectangle keeps where it was grabbed and is held inside what the map shows;
 *   - at most 2000 boxes are drawn, the lowest by z first;
 *   - when it is hidden: off, presenting, a module narrower than 360 or shorter than 320 pixels, an empty board;
 *   - the choice kept in the browser's storage, off when there is none, and nothing thrown when storage throws.
 * It runs the module's own libs in one scope as the page has them (lib files in name order), with no page. No network.
 * Usage: node modules/whiteboard/test/check-whiteboard-minimap.mjs [path to the src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
const NAMES = ['WB_OVERVIEW', 'wbOverviewBounds', 'wbOverviewFit', 'wbOverviewToMap', 'wbOverviewToBoard', 'wbOverviewCentre', 'wbOverviewDrag',
  'wbOverviewInside', 'wbOverviewPick', 'wbOverviewHidden', 'wbOverviewSize', 'wbOverviewLoad', 'wbOverviewSave', 'createOverview', 'wbClean', 'wbRect', 'wbIsFrame'];

let passed = 0;
const fails = [];
let L = {};
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-[a-z]-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  const grab = NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  L = new Function(`${parts.join('\n')}\nreturn { ${grab} };`)();
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
const box = (x0, y0, x1, y1, more = {}) => ({ x0, y0, x1, y1, ...more });
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---- what the map shows ---------------------------------------------------------------------------------------------
await test('bounds: an empty board shows nothing', () => {
  assert.equal(L.wbOverviewBounds([], box(0, 0, 100, 100)), null, 'no blocks: no map, even with a view');
  assert.equal(L.wbOverviewBounds([], null), null);
});
await test('bounds: one block and the view, with the least margin', () => {
  const b = L.wbOverviewBounds([box(0, 0, 100, 50)], box(-200, -100, 300, 200));
  const m = L.WB_OVERVIEW.marginLeast;
  // The longer side is 500; 6% of it is 30, less than the least margin.
  assert.deepEqual(b, { x0: -200 - m, y0: -100 - m, x1: 300 + m, y1: 200 + m });
});
await test('bounds: far-apart blocks are all in it, the margin a share of the longer side', () => {
  const b = L.wbOverviewBounds([box(0, 0, 10, 10), box(9990, 4990, 10000, 5000)], box(0, 0, 200, 100));
  const m = 10000 * L.WB_OVERVIEW.margin;
  assert.ok(near(b.x0, -m) && near(b.y0, -m) && near(b.x1, 10000 + m) && near(b.y1, 5000 + m), JSON.stringify(b));
});
await test('bounds: the view counts when it is away from the blocks', () => {
  const b = L.wbOverviewBounds([box(0, 0, 100, 100)], box(5000, 5000, 5400, 5300));
  assert.ok(b.x1 > 5400 && b.y1 > 5300 && b.x0 < 0 && b.y0 < 0, JSON.stringify(b));
});
await test('bounds: frames are boxes like any block (from wbRect), and a connector has none', () => {
  const f = L.wbClean({ id: 'f', type: 'frame', x: -500, y: -300, w: 400, h: 300, z: 0 });
  const n = L.wbClean({ id: 'n', type: 'note', x: 100, y: 100, w: 100, h: 80, z: 1 });
  const c = L.wbClean({ id: 'c', type: 'connector', from: { block: 'f', side: 'auto' }, to: { block: 'n', side: 'auto' }, z: 2 });
  assert.equal(L.wbRect(c), null, 'a connector has no box');
  const rects = [f, n].map((b) => ({ ...L.wbRect(b), frame: L.wbIsFrame(b) }));
  assert.deepEqual(rects.map((r) => r.frame), [true, false]);
  const b = L.wbOverviewBounds(rects, null);
  const m = Math.max(L.WB_OVERVIEW.marginLeast, 700 * L.WB_OVERVIEW.margin); // the longer side: 700
  assert.ok([b.x0 + 500 + m, b.y0 + 300 + m, b.x1 - 200 - m, b.y1 - 180 - m].every((d) => near(d, 0)), JSON.stringify(b));
});
await test('bounds: boxes that are not numbers are left out', () => {
  assert.equal(L.wbOverviewBounds([box(NaN, 0, 1, 1)], null), null);
});

// ---- the map and the board ------------------------------------------------------------------------------------------
await test('fit: the board\'s shape kept, centred, inside the padding', () => {
  const W = 160; const H = 110; const pad = L.WB_OVERVIEW.pad;
  const f = L.wbOverviewFit(box(0, 0, 1000, 1000), W, H);
  assert.ok(near(f.s, (H - pad * 2) / 1000), `square board: the height decides (${f.s})`);
  const tl = L.wbOverviewToMap(f, { x: 0, y: 0 });
  const br = L.wbOverviewToMap(f, { x: 1000, y: 1000 });
  assert.ok(near(tl.y, pad) && near(br.y, H - pad), 'top and bottom at the padding');
  assert.ok(near(tl.x, W - br.x), 'centred across');
  const wide = L.wbOverviewFit(box(-100, 0, 1900, 100), W, H);
  assert.ok(near(L.wbOverviewToMap(wide, { x: -100, y: 0 }).x, pad) && near(L.wbOverviewToMap(wide, { x: 1900, y: 0 }).x, W - pad), 'a wide board: the width decides');
});
await test('map <-> board, both ways', () => {
  const f = L.wbOverviewFit(box(-300, 200, 2700, 1800), 120, 84);
  for (const p of [{ x: -300, y: 200 }, { x: 0, y: 0 }, { x: 1234.5, y: 987.25 }]) {
    const back = L.wbOverviewToBoard(f, L.wbOverviewToMap(f, p));
    assert.ok(near(back.x, p.x, 1e-6) && near(back.y, p.y, 1e-6), `${JSON.stringify(p)} -> ${JSON.stringify(back)}`);
  }
  const m = { x: 60, y: 42 };
  const there = L.wbOverviewToMap(f, L.wbOverviewToBoard(f, m));
  assert.ok(near(there.x, m.x) && near(there.y, m.y), 'the map\'s middle and back');
});

// ---- moving the view ------------------------------------------------------------------------------------------------
await test('a press: the view\'s middle goes to the point, at the same zoom', () => {
  const view = { x: 10, y: -40, s: 0.5 };
  const v = L.wbOverviewCentre({ x: 800, y: -200 }, view, 600, 400);
  assert.equal(v.s, 0.5, 'the zoom kept');
  assert.ok(near((300 - v.x) / v.s, 800) && near((200 - v.y) / v.s, -200), JSON.stringify(v));
});
await test('dragging the view\'s rectangle: where it was grabbed is kept, held inside the map', () => {
  const bounds = box(-100, -100, 1100, 700);
  const grab = { x: 30, y: -20 }; // pressed 30 right of and 20 above the view's middle
  assert.deepEqual(L.wbOverviewDrag({ x: 500, y: 300 }, grab, bounds), { x: 470, y: 320 }, 'the middle follows the pointer less the grab');
  assert.deepEqual(L.wbOverviewDrag({ x: 5000, y: 300 }, grab, bounds), { x: 1100, y: 320 }, 'held at the right edge');
  assert.deepEqual(L.wbOverviewDrag({ x: -5000, y: -5000 }, grab, bounds), { x: -100, y: -100 }, 'held at the top left');
  assert.deepEqual(L.wbOverviewDrag({ x: 500, y: 9000 }, { x: 0, y: 0 }, bounds), { x: 500, y: 700 }, 'held at the bottom');
  assert.ok(L.wbOverviewInside({ x: 0, y: 0 }, box(-1, -1, 1, 1)) && !L.wbOverviewInside({ x: 2, y: 0 }, box(-1, -1, 1, 1)), 'inside the view\'s box or not');
});

// ---- how much is drawn ----------------------------------------------------------------------------------------------
await test('the draw cap: at most 2000 boxes, the lowest by z, in z order', () => {
  const list = Array.from({ length: 2500 }, (_, i) => box(i, 0, i + 1, 1, { z: 2500 - i, id: `b${i}` }));
  const drawn = L.wbOverviewPick(list);
  assert.equal(L.WB_OVERVIEW.cap, 2000);
  assert.equal(drawn.length, 2000);
  assert.equal(drawn[0].z, 1, 'the lowest first');
  assert.equal(drawn[1999].z, 2000, 'the 2000th');
  assert.ok(drawn.every((b, i) => i === 0 || drawn[i - 1].z <= b.z), 'in z order');
  assert.equal(L.wbOverviewPick(list.slice(0, 5)).length, 5, 'fewer than the cap: all of them');
  assert.equal(list[0].z, 2500, 'the list handed in is left as it was');
});

// ---- when it is hidden ----------------------------------------------------------------------------------------------
await test('hidden: off, presenting, narrow, short, empty', () => {
  const ok = { on: true, width: 640, height: 520, count: 3, presenting: null };
  assert.equal(L.wbOverviewHidden(ok), false, 'shown');
  assert.equal(L.wbOverviewHidden({ ...ok, on: false }), true, 'turned off');
  assert.equal(L.wbOverviewHidden({ ...ok, presenting: { i: 0 } }), true, 'presenting');
  assert.equal(L.wbOverviewHidden({ ...ok, width: 359 }), true, 'narrower than 360');
  assert.equal(L.wbOverviewHidden({ ...ok, width: 360 }), false, '360 wide is enough');
  assert.equal(L.wbOverviewHidden({ ...ok, height: 319 }), true, 'shorter than 320');
  assert.equal(L.wbOverviewHidden({ ...ok, height: 320 }), false, '320 tall is enough');
  assert.equal(L.wbOverviewHidden({ ...ok, count: 0 }), true, 'an empty board');
  assert.equal(L.wbOverviewHidden({ ...ok, width: 0 }), true, 'not laid out yet');
  assert.deepEqual(L.wbOverviewSize(false), { w: 160, h: 110 });
  assert.deepEqual(L.wbOverviewSize(true), { w: 120, h: 84 });
});

// ---- the choice kept in the browser ---------------------------------------------------------------------------------
await test('the choice: kept in storage, off at first, nothing thrown when storage throws', () => {
  const mem = new Map();
  const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  assert.equal(L.wbOverviewLoad(() => store), false, 'off at first');
  assert.equal(L.wbOverviewSave(() => store, true), true);
  assert.equal(mem.get('whiteboard-overview'), '1');
  assert.equal(L.wbOverviewLoad(() => store), true, 'on after a reload');
  L.wbOverviewSave(() => store, false);
  assert.equal(L.wbOverviewLoad(() => store), false, 'off again');
  const blocked = () => { throw new Error('SecurityError'); };
  assert.equal(L.wbOverviewLoad(blocked), false, 'no storage at all: off');
  assert.equal(L.wbOverviewSave(blocked, true), false, 'not kept, and no throw');
  const broken = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('full'); } };
  assert.equal(L.wbOverviewLoad(() => broken), false);
  assert.equal(L.wbOverviewSave(() => broken, true), false);
  assert.equal(L.wbOverviewLoad(() => null), false, 'none');
  assert.equal(L.wbOverviewSave(() => null, true), false);
});

if (fails.length) {
  console.error(`check-whiteboard-minimap: ${fails.length} failed, ${passed} passed`);
  for (const f of fails) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(`check-whiteboard-minimap: OK (${passed} checks)`);
