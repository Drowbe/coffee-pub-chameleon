#!/usr/bin/env node
/*
 * check-whiteboard-frames.mjs -- the Whiteboard's frames and presenting them
 * (modules/whiteboard/src/whiteboard-lib-e-block-frame.js, the Frame tool, and their parts of lib-a, lib-g, lib-h, lib-l and
 * lib-m).
 * Guards:
 *   - a frame's clean: a title of one line, at most 80 characters; the least size 80 x 60; its colours 'usual' until one
 *     is picked; no connector attaches to it; the Frame tool's key is its own;
 *   - containment: a block is inside when its whole box is (touching an edge is inside; partly is not); a frame inside a
 *     frame counts, with what is in it; a block whose height follows its words is measured;
 *   - the changes a move makes: the frame and every block inside it by the same amount, a locked block inside left (and
 *     counted), a locked frame takes nothing, a block inside two moving frames goes with the nearer, a picked block is not
 *     moved twice; align takes a frame's blocks along;
 *   - a copy takes the blocks inside (locked ones too, the copies not locked), keeps where they are against the frame,
 *     gives a group a new id and keeps the connectors between them; a delete takes the frame alone;
 *   - the rectangle that picks blocks takes a frame only whole; where a point is for a frame (tab, border at any zoom,
 *     inside, outside); a new frame's z (under the blocks, over the frames there);
 *   - reading order (rows by half the first frame's height, left to right, ties); presenting as plain state (start, the
 *     steps held at the ends, frames added and deleted meanwhile, the view put back); the fitted view within the zoom's
 *     limits, clear of the bar;
 *   - undo and redo (lib-g, as the page hands them): a frame moved with its blocks is one step, undone and redone whole;
 *     a block someone else moved since is left as it is (and said), field by field.
 * It runs the module's own libs in one scope as the page has them (lib files in name order), with no page. No network.
 * Usage: node modules/whiteboard/test/check-whiteboard-frames.mjs [path to the src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
const NAMES = ['wbClean', 'blockTypes', 'tools', 'wbAttachable', 'wbMoved', 'wbCopies', 'wbDeleteSet', 'createPolicy', 'createHistory',
  'wbApplyChanges', 'wbUndoNote', 'wbArrangeChanges', 'wbExportPick', 'wbExportExtent', 'wbExportSize',
  'WB_FRAME', 'wbFrameTitle', 'wbIsFrame', 'wbFrameContents', 'wbFrameFollow', 'wbFrameMoveChanges', 'wbFrameInRect', 'wbFrameHit',
  'wbFrameZ', 'wbFrameOrder', 'wbFitView', 'wbPresentStart', 'wbPresentGo', 'wbPresentSync', 'wbPresentWords', 'WB_DIM', 'wbDimValue', 'wbDimLoad', 'wbDimSave', 'wbDimStrength', 'wbRoundRect'];

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
const turn = () => new Promise((r) => { setImmediate(r); });
const clean = (raw) => { const b = L.wbClean({ z: 1, ...raw }); if (!b) throw new Error(`not a block: ${JSON.stringify(raw)}`); return b; };
const frame = (id, x, y, w, h, more = {}) => clean({ id, type: 'frame', x, y, w, h, title: id, z: 0, ...more });
const note = (id, x, y, more = {}) => clean({ id, type: 'note', x, y, w: 100, h: 80, ...more });
const textBlock = (id, x, y, more = {}) => clean({ id, type: 'text', x, y, w: 200, text: 'hi', ...more });
const conn = (id, a, b, more = {}) => clean({ id, type: 'connector', from: { block: a, side: 'auto' }, to: { block: b, side: 'auto' }, ...more });
const TEXT_H = 50; // what the page measures a text block's height as, here
const measure = (b) => (b.type === 'text' ? TEXT_H : 0);
const ids = (list) => list.map((m) => m.id).sort();

// ---- the block ------------------------------------------------------------------------------------------------------
await test('clean: one line of at most 80 characters, at least 80 x 60, usual colours until one is picked', () => {
  const f = clean({ id: 'f', type: 'frame', x: 0, y: 0, w: 10, h: 5, title: `Plan\nfor\r\nthe\tday ${'x'.repeat(200)}` });
  assert.equal(f.w, 80, 'the least width');
  assert.equal(f.h, 60, 'the least height');
  assert.ok(!/[\r\n\t]/.test(f.title), 'one line');
  assert.ok(f.title.startsWith('Plan for the day '), 'line breaks and tabs are spaces');
  assert.equal(f.title.length, 80, 'at most 80 characters');
  const usual = clean({ id: 'u', type: 'frame', x: 0, y: 0 });
  assert.deepEqual([usual.w, usual.h, usual.title, usual.fill, usual.stroke, usual.ink], [480, 320, '', 'usual', 'usual', 'usual'], 'a stored frame without its fields');
  assert.equal(L.blockTypes.get('frame').create().title, 'Frame', 'a new frame is called Frame');
  const tinted = clean({ id: 't', type: 'frame', x: 0, y: 0, fill: 'blue', stroke: 'none', ink: 'red' });
  assert.deepEqual([tinted.fill, tinted.stroke, tinted.ink], ['blue', 'none', 'red'], 'a palette colour, or none for its border');
  const odd = clean({ id: 'o', type: 'frame', x: 0, y: 0, fill: '#ff0000', ink: 'none', title: 42 });
  assert.deepEqual([odd.fill, odd.ink, odd.title], ['usual', 'usual', ''], 'anything else is the usual (the title has no None)');
  assert.ok(L.wbIsFrame(f) && !L.wbIsFrame(note('n', 0, 0)), 'a frame is a container; a note is not');
  assert.equal(L.wbAttachable(L.blockTypes.get('frame')), false, 'no connector attaches to a frame');
  assert.equal(L.wbAttachable(L.blockTypes.get('rect')), true, 'one still attaches to a rectangle');
  assert.deepEqual(L.blockTypes.get('frame').linked, [['x', 'y', 'w', 'h']], 'its box is linked for undo');
});

await test('the Frame tool: a tool of its own, key S, the only tool with it', () => {
  const t = L.tools.get('frame');
  assert.ok(t && !t.group && t.makes === 'frame' && t.edits, 'registered');
  assert.equal(t.key, 's');
  const keys = L.tools.list().filter((x) => x.key).map((x) => x.key);
  assert.equal(new Set(keys).size, keys.length, `no two tools share a key: ${keys.join(' ')}`);
});

// ---- containment ------------------------------------------------------------------------------------------------------
await test('containment: wholly inside, touching an edge, partly, nested, measured', () => {
  const F = frame('F', 0, 0, 400, 300);
  const inside = note('in', 50, 50);
  const edge = note('edge', 300, 220); // 300..400, 220..300: on the right and bottom edges
  const part = note('part', 350, 50); // 350..450: partly
  const out = note('out', 500, 50);
  const t = textBlock('t', 100, 240); // 240..290 measured: inside; 240 + 0 without the measure would be too
  const tall = textBlock('tall', 100, 260); // 260..310 measured: partly
  const G = frame('G', 20, 20, 200, 150); // a frame inside the frame
  const inG = note('inG', 40, 40);
  const blocks = [F, inside, edge, part, out, t, tall, G, inG];
  const got = L.wbFrameContents(F, blocks, measure).sort();
  assert.deepEqual(got, ['G', 'edge', 'in', 'inG', 't'], 'inside: wholly, on the edge, the nested frame and what is in it, the measured text');
  assert.deepEqual(L.wbFrameContents(G, blocks, measure).sort(), ['in', 'inG'], 'the inner frame holds its own');
  const c = conn('c', 'in', 'edge');
  assert.ok(!L.wbFrameContents(F, [...blocks, c], measure).includes('c'), 'a connector is never inside: it follows its blocks');
});

// ---- moving -------------------------------------------------------------------------------------------------------------
await test('a move: the frame and what is inside by the same amount; a locked block inside stays and is counted', () => {
  const F = frame('F', 0, 0, 400, 300);
  const a = note('a', 10, 10);
  const lk = note('lk', 200, 100, { locked: true });
  const out = note('out', 600, 0);
  const G = frame('G', 150, 150, 200, 120);
  const inG = note('inG', 160, 160);
  const blocks = [F, a, lk, out, G, inG];
  const r = L.wbFrameMoveChanges([{ id: 'F', dx: 30, dy: -10 }], blocks, { measure });
  assert.deepEqual(ids(r.changes), ['F', 'G', 'a', 'inG'], 'the frame, the frame inside it and both their blocks');
  for (const ch of r.changes) {
    const b = blocks.find((x) => x.id === ch.id);
    assert.deepEqual(ch.fields, { x: b.x + 30, y: b.y - 10 }, `${ch.id} by the same amount`);
  }
  assert.equal(r.locked, 1, 'the locked block inside is left, and counted');
  // A locked frame takes nothing (the page does not move it either).
  const locked = L.wbFrameFollow([{ id: 'F', dx: 5, dy: 5 }], [{ ...F, locked: true }, a], { measure });
  assert.deepEqual([locked.moves, locked.locked], [[], 0], 'a locked frame takes nothing along');
  // A block picked as well is moved once, by its own amount.
  const both = L.wbFrameMoveChanges([{ id: 'F', dx: 5, dy: 0 }, { id: 'a', dx: 7, dy: 0 }], blocks, { measure });
  assert.equal(both.changes.filter((c) => c.id === 'a').length, 1, 'once');
  assert.equal(both.changes.find((c) => c.id === 'a').fields.x, 17, 'by its own amount');
  // A block inside two moving frames goes with the nearer (the smaller).
  const two = L.wbFrameFollow([{ id: 'F', dx: 1, dy: 0 }, { id: 'G', dx: 9, dy: 0 }], blocks, { measure });
  assert.equal(two.moves.find((m) => m.id === 'inG').dx, 9, 'with the inner frame');
  assert.equal(two.moves.find((m) => m.id === 'a').dx, 1, 'the rest with the outer one');
  // Moving a block that is not a frame takes nothing.
  assert.deepEqual(L.wbFrameFollow([{ id: 'a', dx: 1, dy: 1 }], blocks).moves, [], 'a note takes nothing');
  // The contents are those at the moment of the move: after it, the same blocks are still inside.
  const moved = blocks.map((b) => { const ch = r.changes.find((c) => c.id === b.id); return ch ? clean({ ...b, ...ch.fields }) : b; });
  assert.deepEqual(L.wbFrameContents(moved.find((b) => b.id === 'F'), moved, measure).sort(), ['G', 'a', 'inG', 'lk'], 'still inside after the move (the locked one, left, still is here)');
});

await test('align: a frame lined up takes the blocks inside it along', () => {
  const F = frame('F', 100, 0, 200, 200);
  const a = note('a', 120, 20);
  const n = note('n', 0, 400);
  const r = L.wbArrangeChanges([F, n], 'left', { measure });
  assert.deepEqual(r.moves, [{ id: 'F', dx: -100, dy: 0 }], 'align says how far');
  const f = L.wbFrameMoveChanges(r.moves, [F, a, n], { measure });
  assert.deepEqual(f.changes, [{ id: 'F', fields: { x: 0, y: 0 } }, { id: 'a', fields: { x: 20, y: 20 } }], 'the note inside went along');
});

// ---- copy and delete ----------------------------------------------------------------------------------------------------
await test('a copy takes the blocks inside: places kept against the frame, a new group, the connectors between them', () => {
  const F = frame('F', 0, 0, 400, 300, { z: -1 });
  const a = note('a', 10, 10, { group: 'g1', z: 2 });
  const b = note('b', 200, 100, { group: 'g1', locked: true, z: 3 });
  const out = note('out', 600, 0, { z: 4 });
  const c = conn('c', 'a', 'b', { z: 5 });
  const c2 = conn('c2', 'a', 'out', { z: 6 });
  const blocks = [F, a, b, out, c, c2];
  // What the page copies: the picked frame, the blocks inside (locked ones too), then the connectors whose blocks are all in.
  const along = L.wbFrameFollow([{ id: 'F', dx: 0, dy: 0 }], blocks, { measure, keepLocked: true });
  assert.deepEqual(ids(along.moves), ['a', 'b'], 'the copy takes the locked block too');
  const take = new Set(['F', ...along.moves.map((m) => m.id)]);
  for (const x of blocks) { const d = L.blockTypes.get(x.type); if (d.refs && d.refs(x).every((r) => take.has(r))) take.add(x.id); }
  assert.deepEqual([...take].sort(), ['F', 'a', 'b', 'c'], 'the connector between them comes, the one to a block outside does not');
  let n = 0;
  const copies = L.wbCopies(blocks.filter((x) => take.has(x.id)), { newId: () => `k${(n += 1)}`, dx: 24, dy: 24, newGroup: () => 'g2' });
  const byOld = new Map(blocks.filter((x) => take.has(x.id)).sort((p, q) => p.z - q.z).map((x, i) => [x.id, copies[i]]));
  const cf = byOld.get('F');
  for (const id of ['a', 'b']) {
    const o = blocks.find((x) => x.id === id);
    assert.deepEqual([byOld.get(id).x - cf.x, byOld.get(id).y - cf.y], [o.x - F.x, o.y - F.y], `${id} keeps its place against the frame`);
  }
  assert.equal(copies[0].type, 'frame', 'the frame first (lowest), so it is pasted under its blocks');
  assert.ok(byOld.get('a').group === 'g2' && byOld.get('b').group === 'g2', 'the group copied is a new group');
  assert.ok(!('locked' in byOld.get('b')), 'a copy is never locked');
  assert.deepEqual([byOld.get('c').from.block, byOld.get('c').to.block], [byOld.get('a').id, byOld.get('b').id], 'the connector joins the copies');
});

await test('a delete takes the frame alone', () => {
  const F = frame('F', 0, 0, 400, 300);
  const a = note('a', 10, 10);
  const b = note('b', 200, 100);
  const c = conn('c', 'a', 'b');
  const r = L.wbDeleteSet(['F'], [F, a, b, c], { refsOf: (x) => { const d = L.blockTypes.get(x.type); return d.refs ? d.refs(x) : []; } });
  assert.deepEqual(r.ids, ['F'], 'only the frame');
});

// ---- picking and the stack -----------------------------------------------------------------------------------------------
await test('the rectangle takes a frame only whole; where a point is for a frame, at any zoom', () => {
  const box = { x0: 0, y0: 0, x1: 400, y1: 300 };
  assert.equal(L.wbFrameInRect(box, { x0: 50, y0: 50, x1: 200, y1: 200 }), false, 'a rectangle inside it: not the frame');
  assert.equal(L.wbFrameInRect(box, { x0: 350, y0: 250, x1: 600, y1: 600 }), false, 'one over its corner: not');
  assert.equal(L.wbFrameInRect(box, { x0: 500, y0: 400, x1: -10, y1: -10 }), true, 'one round it (any two corners): yes');
  assert.equal(L.wbFrameInRect(box, { x0: 0, y0: 0, x1: 400, y1: 300 }), true, 'exactly its box: yes');
  const F = frame('F', 100, 100, 400, 300);
  const tab = { w: 80, h: 24 };
  const at = (x, y, scale = 1) => L.wbFrameHit(F, { x, y }, { scale, tab });
  assert.equal(at(120, 85), 'tab', 'on the tab, above the top left corner');
  assert.equal(at(250, 85), 'outside', 'above the frame past the tab');
  assert.equal(at(102, 300), 'border', 'just inside the left edge');
  assert.equal(at(97, 300), 'border', 'just outside the left edge');
  assert.equal(at(300, 403), 'border', 'just under the bottom edge');
  assert.equal(at(300, 250), 'inside', 'the middle is not the frame');
  assert.equal(at(108, 300), 'inside', '8 units in at 100%: inside');
  assert.equal(at(108, 300, 0.25), 'border', 'the same point at 25%: the strip is 8 screen pixels, so it is the border');
  assert.equal(at(102, 300, 4), 'inside', 'at 400% the strip is narrow on the board (1 unit each side)');
  assert.equal(at(100.5, 300, 4), 'border', 'and still there');
  assert.equal(at(50, 50), 'outside');
  assert.equal(L.wbFrameHit(F, { x: 102, y: 300 }, { hit: 16, scale: 1 }), 'border', 'a finger: a wider strip');
});

await test('a new frame goes under the blocks and over the frames there', () => {
  assert.equal(L.wbFrameZ([]), 0, 'an empty board');
  const a = note('a', 0, 0, { z: 3 });
  const b = note('b', 0, 0, { z: 7 });
  assert.equal(L.wbFrameZ([a, b]), 2, 'under every block');
  const F = frame('F', 0, 0, 100, 100, { z: 1 });
  const z = L.wbFrameZ([a, b, F]);
  assert.ok(z > 1 && z < 3, `over the frame there, under the blocks (${z})`);
  const top = frame('T', 0, 0, 100, 100, { z: 10 }); // a frame someone brought to the front stays there
  const z2 = L.wbFrameZ([a, b, F, top]);
  assert.ok(z2 > 1 && z2 < 3, 'a frame above the blocks does not count');
  assert.ok(L.wbFrameZ([F, top]) > 10, 'only frames: on top of them');
});

// ---- presenting ------------------------------------------------------------------------------------------------------------
await test('reading order: rows by half the first frame\'s height, left to right, ties', () => {
  const f = (id, x, y, h = 200) => frame(id, x, y, 300, h);
  // Row 1: A (0,0 h200) reaches y 100: B at y 90 is in the row, C at y 110 is not.
  const list = [f('C', 0, 110), f('B', 50, 90), f('A', 500, 0), f('D', -400, 400), f('E', 600, 380), f('F', 600, 380)];
  assert.deepEqual(L.wbFrameOrder(list), ['B', 'A', 'C', 'D', 'E', 'F'], 'B and A one row (left to right), then C, then D, E, F');
  // The row is measured from its first (topmost) frame, not from each frame.
  const chain = [f('a', 0, 0, 100), f('b', 100, 40, 100), f('c', 200, 80, 100)];
  assert.deepEqual(L.wbFrameOrder(chain), ['a', 'b', 'c'], 'b in a\'s row; c (80 > 50) starts the next');
  assert.deepEqual(L.wbFrameOrder([f('x', 0, 0), f('w', 0, 0)]), ['w', 'x'], 'the same place: by id');
  assert.deepEqual(L.wbFrameOrder([]), []);
});

await test('presenting: start, the steps held at the ends, frames changed meanwhile, the view put back', () => {
  const view = { x: 10, y: 20, s: 1.5 };
  const n = note('n', 0, 0);
  assert.equal(L.wbPresentStart([n], view), null, 'no frame: nothing to present');
  const A = frame('A', 0, 0, 300, 200);
  const B = frame('B', 400, 0, 300, 200);
  const C = frame('C', 0, 400, 300, 200);
  let s = L.wbPresentStart([C, n, B, A], view);
  assert.deepEqual([s.order, s.i], [['A', 'B', 'C'], 0], 'in reading order, at the first');
  view.s = 3; // the view moves while presenting
  assert.deepEqual(s.view, { x: 10, y: 20, s: 1.5 }, 'the view to put back is the one there was');
  assert.equal(L.wbPresentStart([A, B, C], view, 'B').i, 1, 'from a frame');
  assert.equal(L.wbPresentStart([A, B, C], view, 'zz').i, 0, 'an unknown frame: the first');
  s = L.wbPresentGo(s, 'back');
  assert.equal(s.i, 0, 'back at the first stays');
  s = L.wbPresentGo(L.wbPresentGo(s, 'next'), 'next');
  assert.equal(s.i, 2);
  assert.equal(L.wbPresentGo(s, 'next').i, 2, 'next at the last stays');
  assert.equal(L.wbPresentGo(s, 'first').i, 0);
  assert.equal(L.wbPresentGo(L.wbPresentGo(s, 'first'), 'last').i, 2);
  assert.equal(L.wbPresentWords(s, 'Plan'), 'Frame 3 of 3: Plan', 'what is said');
  assert.equal(L.wbPresentWords(s, '  '), 'Frame 3 of 3', 'an untitled frame');
  // Someone adds a frame before the one shown: it stays shown.
  const s1 = L.wbPresentGo(L.wbPresentStart([A, B, C], { x: 10, y: 20, s: 1.5 }), 'next'); // at B
  const Z = frame('Z', -500, -500, 100, 100);
  const s2 = L.wbPresentSync(s1, [A, B, C, Z]);
  assert.deepEqual([s2.order[s2.i], s2.i, s2.order.length, s2.same], ['B', 2, 4, true], 'still B, now 3 of 4');
  // Someone deletes the frame shown: the one now in its place.
  const s3 = L.wbPresentSync(s1, [A, C]);
  assert.deepEqual([s3.order[s3.i], s3.same], ['C', false], 'B gone: C, in its place');
  const s4 = L.wbPresentSync(L.wbPresentGo(s1, 'last'), [A, B]);
  assert.equal(s4.order[s4.i], 'B', 'the last gone: the new last');
  assert.equal(L.wbPresentSync(s1, [n]), null, 'none left: it stops');
  assert.deepEqual(s4.view, { x: 10, y: 20, s: 1.5 }, 'the view to put back goes along');
});

await test('the view fitted to a frame: whole, in the middle, clear of the bar, within 20% to 400%', () => {
  const v = L.wbFitView({ x: 100, y: 50, w: 400, h: 200 }, 1000, 656, { margin: 48, bottom: 56, min: 0.2, max: 4 });
  // The room: 1000 x 600 less 48 round it: 904 / 400 = 2.26, 504 / 200 = 2.52: 2.26.
  assert.ok(Math.abs(v.s - 2.26) < 1e-9, `the scale (${v.s})`);
  const mid = { x: (500 - v.x) / v.s, y: (300 - v.y) / v.s };
  assert.ok(Math.abs(mid.x - 300) < 1e-9 && Math.abs(mid.y - 150) < 1e-9, 'the frame\'s middle in the middle above the bar');
  const tiny = L.wbFitView({ x: 0, y: 0, w: 10, h: 10 }, 1000, 600, { min: 0.2, max: 4 });
  assert.equal(tiny.s, 4, 'a small frame at 400% at most');
  const huge = L.wbFitView({ x: 0, y: 0, w: 40000, h: 30000 }, 1000, 600, { min: 0.2, max: 4 });
  assert.equal(huge.s, 0.2, 'a huge one at 20% at least');
  const phone = L.wbFitView({ x: 0, y: 0, w: 480, h: 320 }, 390, 500, { margin: 48, bottom: 56 });
  assert.ok(phone.s > 0 && 480 * phone.s <= 390, 'a phone: it fits across');
});

// ---- export ----------------------------------------------------------------------------------------------------------------
await test('Save frame as image: the frame\'s box, every block it overlaps, its size in pixels', () => {
  const list = [
    { id: 'F', rect: { x0: 0, y0: -28, x1: 400, y1: 300 }, refs: [] },
    { id: 'a', rect: { x0: 10, y0: 10, x1: 110, y1: 90 }, refs: [] },
    { id: 'half', rect: { x0: 350, y0: 10, x1: 450, y1: 90 }, refs: [] },
    { id: 'out', rect: { x0: 500, y0: 10, x1: 600, y1: 90 }, refs: [] },
  ];
  const box = { x0: 0, y0: 0, x1: 400, y1: 300 };
  assert.deepEqual(L.wbExportPick('frame', list, { view: box }), ['F', 'a', 'half'], 'what it overlaps, the frame too');
  const ext = L.wbExportExtent('frame', [], { view: box });
  assert.deepEqual(ext, { x: 0, y: 0, w: 400, h: 300 }, 'the frame\'s box, no margin');
  const size = L.wbExportSize(ext, 1);
  assert.deepEqual([size.width, size.height], [400, 300], 'a PNG the frame\'s size');
});

// ---- undo and redo -------------------------------------------------------------------------------------------------------
// A page in small, as check-whiteboard-arrange's.
function page() {
  const board = new Map();
  const policy = L.createPolicy({ can: () => true });
  const history = L.createHistory({ cap: 100 });
  const known = new Map();
  let stamp = 0;
  const p = {
    board,
    history,
    mine(id, patch) {
      const next = patch === null ? null : clean({ ...(board.get(id) || { id }), ...patch, by: 'a', at: String((stamp += 1)) });
      history.record(id, known.get(id) || null, next);
      if (next) { board.set(id, next); known.set(id, next); } else { board.delete(id); known.delete(id); }
    },
    theirs(id, patch) {
      const next = clean({ ...board.get(id), id, ...patch, by: 'b' });
      board.set(id, next);
      known.set(id, next);
    },
    apply(list) {
      return L.wbApplyChanges(list, {
        get: (id) => board.get(id) || null,
        remove: (id) => p.mine(id, null),
        put: (b) => { const s = { ...b, by: 'a', at: String((stamp += 1)) }; history.record(b.id, known.get(b.id) || null, s); board.set(b.id, s); known.set(b.id, s); },
        canChange: (b, fields) => (fields && fields.length && fields.every((f) => f === 'locked') ? policy.canLock(b) : policy.canChange(b)),
        canRemove: (b) => policy.canDelete(b),
        locked: (b) => Boolean(b && b.locked),
        canCreate: () => true,
        clean: L.wbClean,
        linkedOf: (b) => { const def = L.blockTypes.get(b.type); return (def && def.linked) || []; },
      });
    },
    undo: () => history.undo(p.apply),
    redo: () => history.redo(p.apply),
  };
  return p;
}
const place = (p) => Object.fromEntries([...p.board.values()].map((b) => [b.id, [b.x, b.y]]));

await test('undo and redo: a frame moved with its blocks is one step, put back and done again whole', async () => {
  const p = page();
  p.theirs('F', frame('F', 0, 0, 400, 300));
  p.theirs('a', note('a', 10, 10));
  p.theirs('b', note('b', 200, 100));
  p.theirs('o', note('o', 600, 0));
  await turn();
  const before = place(p);
  const r = L.wbFrameMoveChanges([{ id: 'F', dx: 50, dy: 40 }], [...p.board.values()], { measure });
  for (const c of r.changes) p.mine(c.id, c.fields); // the page saves them in one turn
  await turn();
  assert.equal(p.history.size, 1, 'one step');
  const after = place(p);
  assert.deepEqual([after.F, after.a, after.b, after.o], [[50, 40], [60, 50], [250, 140], [600, 0]]);
  p.undo();
  assert.deepEqual(place(p), before, 'undo puts them all back');
  p.redo();
  assert.deepEqual(place(p), after, 'redo moves them all again');
});

await test('undo: field by field, a block someone else moved since is left (and said); a frame they resized keeps its box', async () => {
  const p = page();
  p.theirs('F', frame('F', 0, 0, 400, 300));
  p.theirs('a', note('a', 10, 10));
  p.theirs('b', note('b', 200, 100));
  await turn();
  for (const c of L.wbFrameMoveChanges([{ id: 'F', dx: 50, dy: 0 }], [...p.board.values()], { measure }).changes) p.mine(c.id, c.fields);
  await turn();
  p.theirs('b', { x: 900 }); // someone else moved b since
  p.theirs('a', { fill: 'blue' }); // and recoloured a: its place is still mine
  const r = p.undo();
  assert.deepEqual([p.board.get('F').x, p.board.get('a').x, p.board.get('b').x], [0, 10, 900], 'the frame and a go back; b is theirs');
  assert.equal(p.board.get('a').fill, 'blue', 'their colour stays');
  assert.equal(r.kept, 1, 'one left');
  assert.equal(L.wbUndoNote(r), 'Left a block as it is: someone else changed it since.', 'and said');
  // A frame resized by someone else after my move: its box is linked, so my undo leaves it all.
  const q = page();
  q.theirs('F', frame('F', 0, 0, 400, 300));
  await turn();
  q.mine('F', { x: 50 });
  await turn();
  q.theirs('F', { w: 600 });
  q.undo();
  assert.deepEqual([q.board.get('F').x, q.board.get('F').w], [50, 600], 'the box stays as they left it');
});

await test('present dim: 0 to 100 in fives, 60 at first, bad values and broken storage give 60, never throws', () => {
  const mem = (v) => () => ({ getItem: () => v, setItem(k, x) { this.set = [k, x]; } });
  assert.equal(L.wbDimLoad(mem(null)), 60, 'nothing saved');
  assert.equal(L.wbDimLoad(mem('35')), 35);
  assert.equal(L.wbDimLoad(mem('0')), 0, '0 is no dim');
  for (const bad of ['abc', '-5', '101', '1e2', '', '5.5', 'NaN']) assert.equal(L.wbDimLoad(mem(bad)), 60, `bad ${bad}`);
  assert.equal(L.wbDimLoad(() => { throw new Error('no storage'); }), 60, 'storage throws');
  assert.equal(L.wbDimLoad(() => null), 60, 'no storage');
  assert.equal(L.wbDimValue(62), 60, 'steps of five');
  const m = mem(null)(); 
  assert.equal(L.wbDimSave(() => m, 45), true);
  assert.deepEqual(m.set, ['whiteboard-present-dim', '45']);
  assert.equal(L.wbDimSave(() => { throw new Error('x'); }, 45), false, 'a failed save is said, not thrown');
  assert.equal(L.wbDimStrength(0), 0, 'no dim, no scrim');
  assert.equal(L.wbDimStrength(100), 1, 'full dim is completely black');
  assert.equal(L.wbDimStrength(60), 0.6, 'linear');
});

await test('round rect path: square without radii, arcs per corner, radii held to half the shorter side', () => {
  assert.ok(L.wbRoundRect(0, 0, 100, 50, null).includes('A0 0'), 'square corners are zero arcs');
  const p = L.wbRoundRect(10, 20, 100, 50, [8, 0, 0, 100]);
  assert.ok(p.startsWith('M18 20H110'), 'top left 8, top right square');
  assert.ok(p.includes('A25 25 0 0 1 10 45'), 'bottom left held to 25');
  assert.equal((p.match(/Z/g) || []).length, 1, 'one closed segment');
});

if (fails.length) {
  for (const f of fails) console.error(`FAIL ${f}`);
  console.error(`check-whiteboard-frames: ${fails.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`check-whiteboard-frames: OK, ${passed} cases`);
