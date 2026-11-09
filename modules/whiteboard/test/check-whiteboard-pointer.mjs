#!/usr/bin/env node
/*
 * check-whiteboard-pointer.mjs -- the Whiteboard's note pointer (whiteboard-lib-e-block-note.js: a tail whose tip is
 * dragged to point at things) and the Highlighter (whiteboard-lib-e-block-highlight.js, whiteboard-lib-f-tool-highlight.js).
 * Guards: the pointer's base on the side facing its tip, clear of the corners, one closed outline; its tip clamped out of
 * the note and not too far; clean data (kept, pushed out on a resize, junk dropped); the note's box stays its body while
 * its reach takes in the tip; dragging the tip (and, with Snap to grid, the tip on the grid; not without it); a move and a
 * copy keep it; Add pointer and Remove pointer. The highlight's clean data (Yellow, Extra heavy, no brush), its box, a
 * straight band, thinning, its tool (Paint menu, key U, no key twice), copies, and its linked fields.
 * It runs the module's own libs in one scope as the page has them, with a fake page for the Select tool. No network.
 * Usage: node modules/whiteboard/test/check-whiteboard-pointer.mjs [path to the module's src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
const NAMES = ['wbPointerClamp', 'wbPointerStart', 'wbPointerShape', 'WB_POINTER', 'WB_GRID', 'wbClean', 'blockTypes', 'tools', 'wbCopies', 'wbMoved'];
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
const test = (name, fn) => { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } };
const { wbPointerClamp: clamp, wbPointerShape: shape, WB_POINTER } = L;

test('the note pointer: its shape, clamp, clean data, reach, grip, copies and actions', () => {
  const W = 180, H = 120;
  // side choice for tips at every side and corner
  const cases = [
    [[0, -150], 'top'], [[0, 150], 'bottom'], [[200, 0], 'right'], [[-200, 0], 'left'],
    [[150, -120], 'right'], [[150, 120], 'right'], [[-150, 120], 'left'], [[-150, -120], 'left'],
    [[100, -200], 'top'], [[-100, 200], 'bottom'], [[-45, 108], 'bottom'],
  ];
  for (const [[dx, dy], side] of cases) {
    const s = shape(W, H, { dx, dy }, 3, 0.5);
    assert.strictEqual(s.side, side, `tip ${dx},${dy}`);
    const [a, b] = s.base;
    const len = side === 'top' || side === 'bottom' ? W : H;
    assert.ok(a >= 0.5 + 2.5 - 1e-9 && b <= len - 3 + 1e-9 && b > a, `base inside the side clear of corners ${a},${b}`);
    assert.ok(/Z$/.test(s.path) && s.path.split('L').length >= 8, 'one closed outline');
  }
  // base width scales with size and narrows for close tips
  const big = shape(400, 400, { dx: 0, dy: 400 }); const small = shape(60, 60, { dx: 0, dy: 200 });
  assert.ok(big.base[1] - big.base[0] > small.base[1] - small.base[0]);
  assert.strictEqual(big.base[1] - big.base[0], 56);
  const near = shape(400, 400, { dx: 0, dy: 212 });
  assert.ok(near.base[1] - near.base[0] <= 18 + 1e-9, 'close tip narrows');
  // clamping: inside pushed out to the nearest edge
  assert.deepStrictEqual(clamp(W, H, 0, 0), { dx: 0, dy: H / 2 + WB_POINTER.min });
  assert.deepStrictEqual(clamp(W, H, 80, 10), { dx: 90 + WB_POINTER.min, dy: 10 });
  assert.deepStrictEqual(clamp(W, H, -10, -55), { dx: -10, dy: -60 - WB_POINTER.min });
  // too close outside: out to min; too far: in to max
  let c = clamp(W, H, 0, 62); assert.deepStrictEqual(c, { dx: 0, dy: 72 });
  c = clamp(W, H, 0, 5000); assert.deepStrictEqual(c, { dx: 0, dy: 60 + WB_POINTER.max });
  c = clamp(W, H, 92, 62); assert.ok(Math.abs(Math.hypot(c.dx - 90, c.dy - 60) - 12) < 0.1, 'corner pushed out diagonally');
  // stable when read again
  for (const [dx, dy] of [[3.3, 71.9], [92, 62], [-91.7, 3], [0, 5000]]) { const a = clamp(W, H, dx, dy); assert.deepStrictEqual(clamp(W, H, a.dx, a.dy), a); }
  // start: below-left
  const st = L.wbPointerStart(180, 180); assert.ok(st.dx < 0 && st.dy > 90);
  // clean: pointer kept, resize pushes out, junk dropped
  const note = L.wbClean({ id: 'n1', type: 'note', x: 10, y: 20, w: 180, h: 180, pointer: { dx: -45, dy: 138 } });
  assert.deepStrictEqual(note.pointer, { dx: -45, dy: 138 });
  const grown = L.wbClean({ ...note, w: 400, h: 400 });
  assert.deepStrictEqual(grown.pointer, { dx: -45, dy: 212 }, 'resize pushes tip out past the nearest edge');
  assert.strictEqual(L.wbClean({ ...note, pointer: { dx: 'x' } }).pointer, null);
  assert.strictEqual(L.wbClean({ id: 'n2', type: 'note', x: 0, y: 0 }).pointer, null);
  // reach includes the pointer; box stays the body
  const def = L.blockTypes.get('note');
  assert.deepStrictEqual(def.box(note), { x: 0, y: 0, w: 180, h: 180 });
  const r = def.reach(note); assert.ok(r.y + r.h >= 90 + 138 && r.x <= 0 && r.w >= 180);
  // group box of two notes includes the pointer
  const other = L.wbClean({ id: 'n3', type: 'note', x: 300, y: 0, w: 100, h: 100 });
  const ext = [note, other].map((b) => { const q = def.reach(b); return { x0: b.x + q.x, y0: b.y + q.y, x1: b.x + q.x + q.w, y1: b.y + q.y + q.h }; });
  assert.ok(Math.max(...ext.map((e) => e.y1)) >= 20 + 90 + 138, 'group box reaches the tip');
  // grip: drag the tip to a board point
  assert.deepStrictEqual(def.grip(note, 'tip', { x: 10 + 90 + 300, y: 20 + 90 }), { pointer: { dx: 300, dy: 0 } });
  // moving the note keeps the offset; copies keep the pointer
  assert.deepStrictEqual(L.wbClean({ ...note, ...L.wbMoved(note, 50, 50) }).pointer, note.pointer);
  let n = 0; const copies = L.wbCopies([note], { newId: () => `c${n++}`, dx: 24, dy: 24 });
  assert.deepStrictEqual(L.wbClean(copies[0]).pointer, note.pointer); assert.strictEqual(copies[0].x, 34);
  // actions
  assert.strictEqual(def.actions(note)[0].id, 'pointer-remove');
  assert.deepStrictEqual(def.actions({ ...note, pointer: null })[0].fields.pointer, L.wbPointerStart(180, 180));

});

test('the highlight: clean data, box, straight band, thinning, its tool and copies', () => {
  const def = L.blockTypes.get('highlight');
  // clean defaults: Yellow (gold), Extra heavy, no brush field
  const h = L.wbClean({ id: 'h1', type: 'highlight', x: 5, y: 6, points: [0, 0, 10, 2] });
  assert.deepStrictEqual({ stroke: h.stroke, weight: h.weight, brush: h.brush }, { stroke: 'gold', weight: 12, brush: undefined });
  assert.strictEqual(L.wbClean({ ...h, stroke: '#ff0' }).stroke, 'gold', 'raw colour refused');
  assert.strictEqual(L.wbClean({ ...h, weight: 7 }).weight, 12, 'weight off the list falls back');
  assert.strictEqual(L.wbClean({ ...h, brush: 'marker' }).brush, undefined, 'no brush kept');
  assert.strictEqual(L.wbClean({ ...h, points: [0] }), null);
  assert.strictEqual(L.wbClean({ ...h, points: [0, 'x'] }), null);
  assert.strictEqual(L.wbClean({ ...h, points: new Array(6002).fill(0) }), null);
  // box padded by half the width
  assert.deepStrictEqual(def.box(h), { x: -14, y: -14, w: 38, h: 30 });
  // straight snap to the dominant axis
  assert.deepStrictEqual(def.straight(100, 20), [0, 0, 100, 0]);
  assert.deepStrictEqual(def.straight(-30, 80.04), [0, 0, 0, 80]);
  assert.deepStrictEqual(def.straight(-50, 50), [0, 0, -50, 0]);
  // thinning the same as a drawing: a straight run of many points keeps its ends
  const pts = []; for (let i = 0; i <= 100; i += 1) pts.push(i * 3, Math.round(Math.sin(i / 100) * 0.2 * 10) / 10);
  const thin = L.blockTypes.get('stroke').simplify(pts).points;
  assert.ok(thin.length < 10 && thin[0] === 0 && thin[thin.length - 2] === 300, `thinned ${thin.length}`);
  // tool registration: a kind of the Pen tool, key U, not H
  const t = L.tools.get('highlight');
  assert.deepStrictEqual([t.group, t.key, t.makes, t.usual.weight], [undefined, 'u', 'highlight', 12]);
  assert.strictEqual(L.tools.list().filter((x) => x.key === 'u').length, 1);
  // keys unique across tools
  const keys = L.tools.list().map((x) => x.key).filter(Boolean); assert.strictEqual(new Set(keys).size, keys.length, 'no key twice');
  // copy/move keep the points, shift x/y
  let n = 0; const c = L.wbCopies([h], { newId: () => `c${n++}`, dx: 24, dy: 24 })[0];
  assert.deepStrictEqual([c.x, c.y, c.points], [29, 30, h.points]);
  assert.ok(L.wbClean(c));

  assert.ok(def.linked.some((g) => ['x', 'y', 'points'].every((f) => g.includes(f))), 'linked: where it is and its band');
});

test('dragging the tip with Snap to grid puts it on the grid, and only then', () => {
  const select = L.tools.get('select');
  const g = L.WB_GRID;
  for (const snap of [true, false]) {
    let note = L.wbClean({ id: 'n1', type: 'note', x: 10, y: 20, w: 180, h: 180, z: 1, pointer: { dx: -45, dy: 138 } });
    let saved = 0;
    const base = {
      selected: () => 'n1', selection: () => ['n1'], isSelected: (id) => id === 'n1', get: (id) => (id === 'n1' ? note : null),
      policy: { canChange: () => true, canEdit: true }, snapping: () => snap, scale: () => 1,
      change(id, fields) { note = { ...note, ...fields }; }, save: () => { saved += 1; },
    };
    const ctx = new Proxy(base, { get: (t, k) => (k in t ? t[k] : () => undefined) });
    const at = (x, y) => ({ x, y, sx: x, sy: y, id: null, handle: 'tip', pointerType: 'mouse', event: {} });
    select.down(at(10 + 45, 20 + 228), ctx);
    select.move(at(10 + 90 + 301, 20 + 90 + 13), ctx);
    select.up(at(10 + 90 + 301, 20 + 90 + 13), ctx);
    const tip = { x: note.x + note.w / 2 + note.pointer.dx, y: note.y + note.h / 2 + note.pointer.dy };
    assert.equal(saved, 1, 'saved once, on the drop');
    if (snap) assert.deepEqual([tip.x % g, tip.y % g], [0, 0], `the tip is on the grid (${JSON.stringify(tip)})`);
    else assert.deepEqual(tip, { x: 401, y: 123 }, 'the tip is where it was let go');
  }
});

if (fails.length) {
  for (const f of fails) console.error(`FAIL ${f}`);
  console.error(`check-whiteboard-pointer: ${fails.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`check-whiteboard-pointer: OK, ${passed} cases`);
