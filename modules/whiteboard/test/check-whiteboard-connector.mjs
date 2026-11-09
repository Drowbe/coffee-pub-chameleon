#!/usr/bin/env node
/*
 * check-whiteboard-connector.mjs -- the Whiteboard's flowchart shapes and connectors (whiteboard-lib-e-block-shape.js,
 * whiteboard-lib-e-block-connector.js, whiteboard-lib-f-tool-connector.js, and their parts of lib-a, lib-g and lib-h).
 * Guards: the elbow router (every pair of sides, in every place, leaves straight out, arrives straight in, crosses neither
 * block, at most four bends), the straight route, sides chosen automatically, a parallelogram's slanted sides, attaching
 * an end to the block under it, hit-testing a path, a connector's clean data (no place of its own; only its free ends
 * move), the flowchart shapes' sizes, copies (connectors between copied blocks point at the copies; a loose end becomes a
 * point), a delete and its connectors as one undo step put back block first, and the Connector tool's free ends on the
 * grid with Snap to grid (and not without it). It runs the module's own libs in one scope as the page has them, with fakes.
 * No network, no sleeps.
 * Usage: node modules/whiteboard/test/check-whiteboard-connector.mjs [path to the module's src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
const libs = fs.readdirSync(SRC).filter((f) => /^whiteboard-lib-[a-z]-.*\.js$/.test(f)).sort();
const code = libs.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
const names = ['blockTypes', 'tools', 'wbClean', 'wbCopies', 'wbMoved', 'wbAttachable', 'createHistory', 'wbRoute', 'wbSides', 'wbTidy', 'wbAttachAt', 'wbPathTouches', 'wbNearPath', 'wbPathDistance', 'wbMidpoint', 'wbSidePoint', 'WB_ROUTE', 'WB_GRID'];
const grab = names.map((k) => `${k}: typeof ${k} === 'undefined' ? undefined : ${k}`).join(', ');
const fails = [];
let passed = 0;
let lib = {};
try {
  lib = new Function('window', `${code}\nreturn { ${grab} };`)({ devicePixelRatio: 1 });
} catch (err) {
  fails.push(`the libs do not load: ${err.message}`);
}
const test = async (name, fn) => { try { await fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } };

const box = (x, y, w, h) => ({ x, y, w, h });
const end = (id, b, side = 'auto') => ({ id, box: b, side });
const pt = (x, y) => ({ point: { x, y } });

// A route is good when: at least 2 points; each run is across or down only (elbow); no run has no length; no two runs in a
// row go the same way or straight back; it starts and ends where it should.
function checkElbow(pts, what) {
  assert.ok(pts.length >= 2, `${what}: at least two points`);
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const dx = pts[i + 1].x - pts[i].x; const dy = pts[i + 1].y - pts[i].y;
    assert.ok(Math.abs(dx) < 1e-9 || Math.abs(dy) < 1e-9, `${what}: run ${i} is across or down (${dx}, ${dy})`);
    assert.ok(Math.abs(dx) + Math.abs(dy) > 0.01, `${what}: run ${i} has length`);
  }
  for (let i = 1; i + 1 < pts.length; i += 1) {
    const a = [Math.sign(pts[i].x - pts[i - 1].x), Math.sign(pts[i].y - pts[i - 1].y)];
    const b = [Math.sign(pts[i + 1].x - pts[i].x), Math.sign(pts[i + 1].y - pts[i].y)];
    assert.ok(!(a[0] === b[0] && a[1] === b[1]), `${what}: no point in the middle of a straight run`);
    assert.ok(!(a[0] === -b[0] && a[1] === -b[1]), `${what}: never straight back`);
  }
}
const inside = (p, q, r) => Math.min(p.x, q.x) < r.x + r.w - 0.5 && Math.max(p.x, q.x) > r.x + 0.5 && Math.min(p.y, q.y) < r.y + r.h - 0.5 && Math.max(p.y, q.y) > r.y + 0.5;
const crossesAny = (pts, boxes) => pts.slice(1).some((q, i) => boxes.some((r) => inside(pts[i], q, r)));
const DIR = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
const leaves = (pts, side) => { const d = DIR[side]; return Math.sign(pts[1].x - pts[0].x) === d[0] && Math.sign(pts[1].y - pts[0].y) === d[1]; };
const arrives = (pts, side) => { const d = DIR[side]; const k = pts.length - 1; return Math.sign(pts[k - 1].x - pts[k].x) === d[0] && Math.sign(pts[k - 1].y - pts[k].y) === d[1]; };

await test('auto sides face each other', () => {
  const a = box(0, 0, 100, 60);
  assert.deepEqual(lib.wbSides(end('a', a), end('b', box(300, 10, 100, 60))), { sa: 'right', sb: 'left' });
  assert.deepEqual(lib.wbSides(end('a', a), end('b', box(-300, 10, 100, 60))), { sa: 'left', sb: 'right' });
  assert.deepEqual(lib.wbSides(end('a', a), end('b', box(10, 300, 100, 60))), { sa: 'bottom', sb: 'top' });
  assert.deepEqual(lib.wbSides(end('a', a), end('b', box(10, -300, 100, 60))), { sa: 'top', sb: 'bottom' });
  // Up and to the right, further across than up: across.
  assert.deepEqual(lib.wbSides(end('a', a), end('b', box(250, -90, 100, 60))), { sa: 'right', sb: 'left' });
  // A free point: the side towards it.
  assert.equal(lib.wbSides(end('a', a), pt(50, 400)).sa, 'bottom');
  assert.equal(lib.wbSides(end('a', a), pt(50, 400)).sb, null);
  // A named side is kept; the other faces its point.
  assert.deepEqual(lib.wbSides(end('a', a, 'top'), end('b', box(300, 10, 100, 60))), { sa: 'top', sb: 'left' });
  // One block at both ends: out of its right, into its top.
  assert.deepEqual(lib.wbSides(end('a', a), end('a', a)), { sa: 'right', sb: 'top' });
});

await test('elbow: every pair of sides, in every place, is clean and leaves straight out', () => {
  const A = box(0, 0, 120, 80);
  const places = [];
  for (const x of [-400, -110, -60, 0, 60, 130, 400]) for (const y of [-300, -80, -40, 0, 40, 90, 300]) places.push(box(x, y, 100, 70));
  let count = 0;
  for (const B of places) {
    const overlap = !(B.x >= A.x + A.w || B.x + B.w <= A.x || B.y >= A.y + A.h || B.y + B.h <= A.y);
    for (const sa of ['top', 'right', 'bottom', 'left', 'auto']) for (const sb of ['top', 'right', 'bottom', 'left', 'auto']) {
      const pts = lib.wbRoute(end('a', A, sa), end('b', B, sb), 'elbow');
      const what = `${sa}->${sb} to ${JSON.stringify(B)}`;
      checkElbow(pts, what);
      const { sa: ra, sb: rb } = lib.wbSides(end('a', A, sa), end('b', B, sb));
      const p0 = lib.wbSidePoint(A, ra);
      // Starts on its side (a snapped straight line may slide along it) and, apart from overlapping blocks, leaves
      // straight out of it, arrives straight into the other, and crosses neither block.
      if (ra === 'left' || ra === 'right') assert.equal(pts[0].x, p0.x, what); else assert.equal(pts[0].y, p0.y, what);
      if (!overlap) {
        assert.ok(leaves(pts, ra), `${what}: leaves ${ra}`);
        assert.ok(arrives(pts, rb), `${what}: arrives at ${rb}`);
        assert.ok(!crossesAny(pts, [A, B]), `${what}: crosses neither block ${JSON.stringify(pts)}`);
        assert.ok(pts.length - 2 <= 4, `${what}: at most four bends`);
        if (sa === 'auto' && sb === 'auto') assert.ok(pts.length - 2 <= 2, `${what}: auto sides take at most two bends`);
      }
      count += 1;
    }
  }
  assert.ok(count > 1000, 'every route was tried');
});

await test('elbow: the reference picture (side by side straight; a split to two options)', () => {
  const one = box(65, 163, 195, 129);
  const two = box(400, 171, 194, 117);
  const s = lib.wbRoute(end('1', one), end('2', two), 'elbow');
  assert.equal(s.length, 2, 'middles 2 apart: one straight line');
  assert.equal(s[0].y, s[1].y);
  assert.equal(s[0].x, 260);
  assert.equal(s[1].x, 400);
  const o1 = box(780, 111, 185, 95);
  const o2 = box(780, 278, 178, 96);
  const r1 = lib.wbRoute(end('2', two), end('o1', o1), 'elbow');
  const r2 = lib.wbRoute(end('2', two), end('o2', o2), 'elbow');
  checkElbow(r1, 'to option 1'); checkElbow(r2, 'to option 2');
  assert.equal(r1.length, 4, 'two bends');
  assert.equal(r2.length, 4, 'two bends');
  assert.equal(r1[1].x, r2[1].x, 'one trunk: both turn at the same place');
  assert.equal(r1[1].x, (594 + 780) / 2, 'halfway between');
});

await test('elbow: touching, overlapping and one block at both ends', () => {
  const A = box(0, 0, 100, 60);
  // Touching side by side, middles level: no route of length worth drawing, but nothing broken.
  const t = lib.wbRoute(end('a', A), end('b', box(100, 0, 100, 60)), 'elbow');
  checkElbow(t.length === 2 && t[0].x === t[1].x && t[0].y === t[1].y ? [t[0], { x: t[0].x + 1, y: t[0].y }] : t, 'touching');
  // Touching, middles apart.
  checkElbow(lib.wbRoute(end('a', A), end('b', box(100, 30, 100, 60)), 'elbow'), 'touching, offset');
  // Overlapping.
  checkElbow(lib.wbRoute(end('a', A), end('b', box(50, 20, 100, 60)), 'elbow'), 'overlapping');
  // The same block: a loop outside it.
  const loop = lib.wbRoute(end('a', A), end('a', A), 'elbow');
  checkElbow(loop, 'loop');
  assert.ok(!crossesAny(loop, [A]), 'the loop stays outside');
  assert.ok(leaves(loop, 'right') && arrives(loop, 'top'));
  for (const sa of ['top', 'right', 'bottom', 'left']) for (const sb of ['top', 'right', 'bottom', 'left']) {
    if (sa === sb) continue;
    const r = lib.wbRoute(end('a', A, sa), end('a', A, sb), 'elbow');
    checkElbow(r, `loop ${sa}->${sb}`);
    assert.ok(!crossesAny(r, [A]), `loop ${sa}->${sb} stays outside`);
  }
});

await test('elbow and straight with free ends', () => {
  const A = box(0, 0, 100, 60);
  const r = lib.wbRoute(end('a', A), pt(300, 200), 'elbow');
  checkElbow(r, 'block to point');
  assert.deepEqual(r[r.length - 1], { x: 300, y: 200 });
  assert.ok(r.length <= 3, 'one bend to a free point');
  const f = lib.wbRoute(pt(0, 0), pt(100, 50), 'elbow');
  checkElbow(f, 'point to point');
  assert.equal(f.length, 3);
  assert.equal(lib.wbRoute(pt(0, 0), pt(100, 0), 'elbow').length, 2);
  // Straight: from where the line between the middles leaves each box.
  const s = lib.wbRoute(end('a', A), end('b', box(300, 0, 100, 60)), 'straight');
  assert.deepEqual(s, [{ x: 100, y: 30 }, { x: 300, y: 30 }]);
  const d = lib.wbRoute(end('a', A), end('b', box(300, 200, 100, 60)), 'straight');
  assert.equal(d.length, 2);
  assert.ok(Math.abs(d[0].x - 100) < 1e-9 || Math.abs(d[0].y - 60) < 1e-9, 'on the edge of A');
  // A named side: its middle.
  assert.deepEqual(lib.wbRoute(end('a', A, 'top'), pt(50, -100), 'straight')[0], { x: 50, y: 0 });
});

await test('a parallelogram\'s slanted sides take the end on the outline', () => {
  const p = { x: 0, y: 0, w: 180, h: 100, in: { left: 17.5, right: 17.5 } };
  assert.deepEqual(lib.wbSidePoint(p, 'left'), { x: 17.5, y: 50 });
  assert.deepEqual(lib.wbSidePoint(p, 'right'), { x: 162.5, y: 50 });
  assert.deepEqual(lib.wbSidePoint(p, 'top'), { x: 90, y: 0 });
});

await test('attaching an end: the block under it, a side when near its middle', () => {
  const boxes = [{ id: 'top', ...box(50, 50, 100, 60) }, { id: 'under', ...box(0, 0, 300, 300) }];
  assert.deepEqual(lib.wbAttachAt(boxes, { x: 100, y: 80 }, 12), { block: 'top', side: 'auto' });
  assert.deepEqual(lib.wbAttachAt(boxes, { x: 149, y: 81 }, 12), { block: 'top', side: 'right' });
  assert.deepEqual(lib.wbAttachAt(boxes, { x: 100, y: 45 }, 12), { block: 'top', side: 'top' }, 'just outside, near the middle');
  assert.deepEqual(lib.wbAttachAt(boxes, { x: 250, y: 250 }, 12), { block: 'under', side: 'auto' });
  assert.equal(lib.wbAttachAt(boxes, { x: 400, y: 400 }, 12), null);
  assert.deepEqual(lib.wbAttachAt(boxes, { x: 309, y: 150 }, 12), { block: 'under', side: 'right' });
});

await test('hit-testing a path and a rectangle touching it', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  assert.ok(lib.wbNearPath(pts, { x: 50, y: 6 }, 8));
  assert.ok(!lib.wbNearPath(pts, { x: 50, y: 20 }, 8));
  assert.ok(lib.wbNearPath(pts, { x: 106, y: 60 }, 8));
  assert.ok(!lib.wbNearPath(pts, { x: 50, y: 50 }, 8), 'the inside of the bend is not the path');
  assert.equal(lib.wbPathDistance(pts, { x: -3, y: -4 }), 5);
  assert.ok(lib.wbPathTouches(pts, { x0: 40, y0: -10, x1: 60, y1: 10 }), 'across a run');
  assert.ok(lib.wbPathTouches(pts, { x0: 60, y0: 10, x1: 40, y1: -10 }), 'any two corners');
  assert.ok(!lib.wbPathTouches(pts, { x0: 20, y0: 20, x1: 80, y1: 80 }), 'inside the bend');
  assert.ok(lib.wbPathTouches([{ x: 0, y: 0 }, { x: 100, y: 100 }], { x0: 40, y0: 40, x1: 45, y1: 45 }), 'a slanted line');
  assert.ok(!lib.wbPathTouches([{ x: 0, y: 0 }, { x: 100, y: 100 }], { x0: 60, y0: 0, x1: 100, y1: 30 }));
  assert.deepEqual(lib.wbMidpoint(pts), { x: 100, y: 0 });
});

await test('a connector is clean data, with no place of its own', () => {
  const c = lib.wbClean({ id: 'c1', type: 'connector', from: { block: 'a', side: 'left' }, to: { x: 10, y: 20 }, z: 3, style: 'straight', head: 'both', label: 'yes\nno', stroke: 'red', weight: 4, x: 5, y: 9 });
  assert.deepEqual(c, { from: { block: 'a', side: 'left' }, to: { x: 10, y: 20 }, style: 'straight', head: 'both', label: 'yes no', stroke: 'red', weight: 4, id: 'c1', type: 'connector', z: 3, by: '', at: '' });
  const d = lib.wbClean({ id: 'c2', type: 'connector', from: { block: 'a', side: 'middle' }, to: { block: 'b' }, style: 'curvy', head: 'x' });
  assert.deepEqual([d.from, d.to, d.style, d.head, d.stroke, d.weight], [{ block: 'a', side: 'auto' }, { block: 'b', side: 'auto' }, 'elbow', 'end', 'ink', 2]);
  assert.equal(lib.wbClean({ id: 'c3', type: 'connector', from: { block: 'a' } }), null, 'two ends');
  assert.equal(lib.wbClean({ id: 'c3', type: 'connector', from: { block: '../x' }, to: { x: 0, y: 0 } }), null);
  assert.equal(lib.wbClean({ id: 'c3', type: 'connector', from: { x: 'a', y: 0 }, to: { x: 0, y: 0 } }), null);
  const def = lib.blockTypes.get('connector');
  assert.ok(def.attached && !lib.wbAttachable(def));
  assert.ok(lib.wbAttachable(lib.blockTypes.get('rounded')) && lib.wbAttachable(lib.blockTypes.get('note')) && lib.wbAttachable(lib.blockTypes.get('text')));
  assert.ok(!lib.wbAttachable(lib.blockTypes.get('line')) && !lib.wbAttachable(lib.blockTypes.get('stroke')));
  assert.deepEqual(def.refs(c), ['a']);
  // Moving it moves only its free end.
  assert.deepEqual(lib.wbMoved(c, 5, 5), { from: { block: 'a', side: 'left' }, to: { x: 15, y: 25 } });
  // Other blocks keep x, y.
  assert.deepEqual(lib.wbMoved({ type: 'rect', x: 1, y: 2 }, 3, 4), { x: 4, y: 6 });
});

await test('the flowchart shapes are block types with sizes that fit words', () => {
  for (const [t, minW, minH] of [['rounded', 40, 28], ['diamond', 64, 48], ['pill', 56, 28], ['parallelogram', 64, 32]]) {
    const def = lib.blockTypes.get(t);
    assert.ok(def, t);
    assert.deepEqual(def.resize.min, { w: minW, h: minH });
    const b = lib.wbClean({ id: 'x', type: t, x: 0, y: 0, w: 2, h: 2, text: 'Yes' });
    assert.deepEqual([b.w, b.h], [minW, minH], `${t} is never smaller than its words need`);
    assert.equal(def.describe({ text: 'Go' }), `${def.label}: Go`);
  }
  assert.deepEqual(lib.blockTypes.get('parallelogram').anchorIn({ w: 180, h: 100 }), { left: 17.5, right: 17.5 });
});

await test('copies: connectors between copied blocks are remapped; a loose end becomes a point', () => {
  const a = lib.wbClean({ id: 'a', type: 'rect', x: 0, y: 0, z: 1 });
  const b = lib.wbClean({ id: 'b', type: 'rect', x: 300, y: 0, z: 2 });
  const c = lib.wbClean({ id: 'c', type: 'connector', from: { block: 'a', side: 'auto' }, to: { block: 'b', side: 'right' }, z: 3, label: 'go' });
  let k = 0;
  const copies = lib.wbCopies([c, a, b], { newId: () => `n${(k += 1)}`, dx: 24, dy: 24 });
  const byType = (t) => copies.filter((x) => x.type === t);
  const [ca, cb] = byType('rect');
  const [cc] = byType('connector');
  assert.equal(new Set(copies.map((x) => x.id)).size, 3);
  assert.ok(!copies.some((x) => ['a', 'b', 'c'].includes(x.id)), 'all new ids');
  assert.deepEqual(cc.from, { block: ca.id, side: 'auto' });
  assert.deepEqual(cc.to, { block: cb.id, side: 'right' });
  assert.equal(cc.label, 'go');
  assert.ok(!('x' in cc), 'a connector copy has no place');
  assert.deepEqual([ca.x, ca.y], [24, 24]);
  // A connector copied without its block "b": that end becomes a free point where it is drawn now, and moves with the paste.
  const def = lib.blockTypes.get('connector');
  const loose = { ...c, ...def.loosen(c, new Set(['a', 'c']), (which) => (which === 'to' ? { x: 400, y: 50 } : null)) };
  assert.deepEqual(loose.from, { block: 'a', side: 'auto' });
  assert.deepEqual(loose.to, { x: 400, y: 50 });
  const [lc, la] = lib.wbCopies([loose, a], { newId: () => `m${(k += 1)}`, dx: 10, dy: 0 }).sort((x, y) => (x.type < y.type ? -1 : 1));
  assert.equal(lc.type, 'connector');
  assert.deepEqual(lc.from, { block: la.id, side: 'auto' });
  assert.deepEqual(lc.to, { x: 410, y: 50 });
  assert.ok(lib.wbClean(lc), 'the copy is a block');
});

await test('a delete and its connectors in one turn are one undo step, put back block first, same ids', async () => {
  const h = lib.createHistory();
  const A = { id: 'a', type: 'rect', x: 0, y: 0, w: 10, h: 10 };
  const C = { id: 'c', type: 'connector', from: { block: 'a', side: 'auto' }, to: { x: 1, y: 1 } };
  // The page records the connector first, then the block (whiteboard.js remove).
  h.record('c', C, null);
  h.record('a', A, null);
  await Promise.resolve();
  assert.equal(h.size, 1, 'one step');
  let got = null;
  h.undo((list) => { got = list; });
  assert.deepEqual(got.map((x) => x.id), ['a', 'c'], 'the block comes back first');
  assert.deepEqual(got.map((x) => x.target.id), ['a', 'c'], 'with the same ids');
  h.redo((list) => { got = list; });
  assert.deepEqual(got.map((x) => [x.id, x.target]), [['c', null], ['a', null]]);
});


await test('the Connector tool puts free ends on the grid with Snap to grid, and not without it', () => {
  const tool = lib.tools.get('connector');
  assert.ok(tool, 'the Connector tool is registered');
  for (const snap of [true, false]) {
    const board = new Map();
    let saved = null;
    const ctx = {
      snapping: () => snap,
      attachAt: () => null,
      ports: () => {},
      scale: () => 1,
      draft(type, fields) { const b = { id: 'k', type, ...fields }; board.set('k', b); return b; },
      change(id, fields) { board.set(id, { ...board.get(id), ...fields }); },
      get: (id) => board.get(id),
      discard: (id) => board.delete(id),
      save: (id) => { saved = id; },
      select: () => {},
      setTool: () => {},
    };
    const g = lib.WB_GRID;
    tool.down({ x: 10, y: 13, sx: 10, sy: 13, event: {} }, ctx);
    tool.move({ x: 130, y: 61, sx: 130, sy: 61, event: {} }, ctx);
    tool.up({ x: 130, y: 61, sx: 130, sy: 61, event: {} }, ctx);
    const c = board.get('k');
    assert.equal(saved, 'k', 'saved once');
    if (snap) {
      assert.deepEqual([c.from, c.to], [{ x: 0, y: g }, { x: Math.round(130 / g) * g, y: Math.round(61 / g) * g }], 'on the grid');
    } else {
      assert.deepEqual([c.from, c.to], [{ x: 10, y: 13 }, { x: 130, y: 61 }], 'where the pointer was');
    }
  }
});

await test('every flowchart shape and the connector declare linked fields for undo', () => {
  for (const t of ['rounded', 'diamond', 'pill', 'parallelogram']) assert.ok(lib.blockTypes.get(t).linked.some((g) => ['x', 'y', 'w', 'h'].every((f) => g.includes(f))), `${t}: its box`);
  assert.ok(lib.blockTypes.get('connector').linked.some((g) => g.includes('from') && g.includes('to')), 'connector: its two ends');
});

if (fails.length) {
  for (const f of fails) console.error(`FAIL ${f}`);
  console.error(`check-whiteboard-connector: ${fails.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`check-whiteboard-connector: OK, ${passed} cases`);
