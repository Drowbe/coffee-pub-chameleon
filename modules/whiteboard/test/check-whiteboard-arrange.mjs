#!/usr/bin/env node
/*
 * check-whiteboard-arrange.mjs -- the Whiteboard's align, distribute, guides, locks and groups
 * (modules/whiteboard/src/whiteboard-lib-m-arrange.js, and their parts of lib-a, lib-b, lib-f-tool-select, lib-g and lib-h).
 * Guards:
 *   - align (all six) lines the boxes up to the box round them; distribute (both ways) spaces three or more evenly and
 *     leaves the ends; both leave locked blocks and connectors as they are, and a block whose height follows its words
 *     is measured;
 *   - the guides' snap (wbGuideSnap): within the tolerance and not past it, the nearest wins, ties go to the first found,
 *     no candidates is no snap, and the lines drawn run past both boxes; the Select tool uses it only with Snap to grid
 *     off, and a locked block in a drag is not moved (the person is told);
 *   - locks: a locked block may not be changed or deleted, may be locked and unlocked (lib-b); Lock locks all when any is
 *     unlocked, else unlocks; a copy is never locked; a delete leaves locked blocks and still takes every connector of a
 *     block it deletes, locked or not;
 *   - groups: wbClean keeps only a short [a-z0-9] id; a group of one is no group; picking one picks all; Group merges
 *     the groups it touches and leaves locked blocks; Ungroup empties every group touched; a copy of a group is a new
 *     group, a copy of one block of a group is in none;
 *   - undo and redo (lib-g's createHistory and wbApplyChanges, as the page hands them): each command is one step; a lock
 *     is undone on a locked block, nothing else is (counted, and said); a field-wise merge with someone else's change to
 *     `locked` or `group`.
 * It runs the module's own libs in one scope as the page has them (lib files in name order), with no page. No network.
 * Usage: node modules/whiteboard/test/check-whiteboard-arrange.mjs [path to the src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
const NAMES = ['wbClean', 'blockTypes', 'tools', 'wbMoved', 'wbCopies', 'createPolicy', 'createHistory', 'wbApplyChanges', 'wbUndoNote',
  'wbGroupsOf', 'wbGroupId', 'WB_ARRANGE', 'wbRect', 'wbAlignMoves', 'wbDistributeMoves', 'wbArrangeChanges', 'wbGuideSnap',
  'wbExpandGroups', 'wbGroupChanges', 'wbUngroupChanges', 'wbLockChanges', 'wbDeleteSet', 'wbLockedNote'];

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
const note = (id, x, y, more = {}) => clean({ id, type: 'note', x, y, w: 100, h: 80, ...more });
const textBlock = (id, x, y, more = {}) => clean({ id, type: 'text', x, y, w: 200, text: 'hi', ...more }); // its height follows its words
const conn = (id, a, b, more = {}) => clean({ id, type: 'connector', from: { block: a, side: 'auto' }, to: { block: b, side: 'auto' }, ...more });
const apply = (blocks, changes) => {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  for (const c of changes) byId.set(c.id, clean({ ...byId.get(c.id), ...c.fields }));
  return byId;
};
const TEXT_H = 50; // what the page measures a text block's height as, here
const measure = (b) => (b.type === 'text' ? TEXT_H : 0);
const rectOf = (b) => L.wbRect(b, measure);

// ---- align ----------------------------------------------------------------------------------------------------------
await test('align: all six line the boxes up to the box round them (a text block measured, a line by its box)', () => {
  const a = note('a', 10, 20); // 10..110, 20..100
  const t = textBlock('t', 300, 200); // 300..500, 200..250 (measured)
  const ln = clean({ id: 'l', type: 'line', x: 100, y: 400, dx: 100, dy: 0, weight: 3 }); // box: pad 12 -> 88..212, 388..412
  const blocks = [a, t, ln];
  const box = { x0: 10, x1: 500, y0: 20, y1: 412 };
  assert.deepEqual(rectOf(ln), { id: 'l', x0: 88, y0: 388, x1: 212, y1: 412 }, 'a line is aligned by its box (with its pad)');
  assert.deepEqual(rectOf(t), { id: 't', x0: 300, y0: 200, x1: 500, y1: 250 }, 'a text block is as tall as measured');
  const want = {
    left: (r) => [box.x0, r.y0], right: (r) => [box.x1 - (r.x1 - r.x0), r.y0], center: (r) => [(box.x0 + box.x1) / 2 - (r.x1 - r.x0) / 2, r.y0],
    top: (r) => [r.x0, box.y0], bottom: (r) => [r.x0, box.y1 - (r.y1 - r.y0)], middle: (r) => [r.x0, (box.y0 + box.y1) / 2 - (r.y1 - r.y0) / 2],
  };
  for (const how of ['left', 'center', 'right', 'top', 'middle', 'bottom']) {
    const r = L.wbArrangeChanges(blocks, how, { measure });
    assert.ok(r.enough && r.locked === 0, `${how}: done`);
    const now = apply(blocks, r.changes);
    for (const b of blocks) {
      const before = rectOf(b);
      const after = rectOf(now.get(b.id));
      assert.deepEqual([after.x0, after.y0], want[how](before), `${how}: ${b.id} lands at its place (got ${after.x0}, ${after.y0})`);
    }
    for (const c of r.changes) assert.ok(c.fields.x !== undefined || c.fields.y !== undefined, `${how}: a move is x, y`);
  }
});

await test('align: a locked block and a connector are left out; fewer than two to move is not enough', () => {
  const a = note('a', 0, 0);
  const b = note('b', 100, 50);
  const k = note('k', 500, 500, { locked: true });
  const c = conn('c', 'a', 'b');
  const r = L.wbArrangeChanges([a, b, k, c], 'left', { measure });
  assert.equal(r.locked, 1, 'one locked block counted');
  assert.deepEqual(r.changes.map((x) => x.id), ['b'], 'only b moves (to a\'s left edge, not counting the locked one)');
  assert.deepEqual(r.changes[0].fields, { x: 0, y: 50 });
  assert.ok(!r.changes.some((x) => x.id === 'c' || x.id === 'k'), 'the connector and the locked block are untouched');
  const lone = L.wbArrangeChanges([a, k], 'left', { measure });
  assert.ok(!lone.enough && lone.changes.length === 0 && lone.locked === 1, 'one free block and one locked: not enough');
  const aligned = L.wbArrangeChanges([note('p', 0, 0), note('q', 0, 90)], 'left', { measure });
  assert.ok(aligned.enough && aligned.changes.length === 0, 'already aligned: nothing to change');
});

// ---- distribute -----------------------------------------------------------------------------------------------------
await test('distribute: equal gaps across and down, the ends stay; locked blocks left out', () => {
  // widths 100 each; at 0, 130, 400 -> the middle one goes to 200 (gaps of 100)
  const xs = [note('a', 0, 0), note('b', 130, 7), note('c', 400, 3)];
  const r = L.wbArrangeChanges(xs, 'horizontal', { measure });
  assert.ok(r.enough);
  assert.deepEqual(r.changes, [{ id: 'b', fields: { x: 200, y: 7 } }], 'only the middle one moves, across only');
  // down, with a text block (measured 50) and unequal heights: tops at 0 (h 80), 90 (h 50), 400 (h 80): gap (480 - 210) / 2 = 135
  const ys = [note('a', 0, 0), textBlock('t', 5, 90), note('c', 9, 400)];
  const v = L.wbArrangeChanges(ys, 'vertical', { measure });
  assert.deepEqual(v.changes, [{ id: 't', fields: { x: 5, y: 215 } }], 'the text block goes to 80 + 135');
  // a locked block in the middle is left out: only two free blocks, not enough
  const mixed = [note('a', 0, 0), note('k', 130, 0, { locked: true }), note('c', 400, 0)];
  const m = L.wbArrangeChanges(mixed, 'horizontal', { measure });
  assert.ok(!m.enough && m.locked === 1 && !m.changes.length, 'two free and one locked: not enough, nothing moves');
  // four with one locked: the three free ones are spaced, the locked one stays
  const four = [note('a', 0, 0), note('b', 50, 0), note('k', 260, 0, { locked: true }), note('c', 600, 0)];
  const f = L.wbArrangeChanges(four, 'horizontal', { measure });
  assert.equal(f.locked, 1);
  assert.deepEqual(f.changes, [{ id: 'b', fields: { x: 300, y: 0 } }], 'b goes half way (gap 200), k stays');
  // the order is by middles; ends stay even when the widest is not first
  const order = L.wbDistributeMoves([{ id: 'x', x0: 0, x1: 10, y0: 0, y1: 1 }, { id: 'y', x0: 100, x1: 110, y0: 0, y1: 1 }, { id: 'z', x0: 30, x1: 40, y0: 0, y1: 1 }], 'horizontal');
  assert.deepEqual(order, [{ id: 'z', dx: 20, dy: 0 }], 'the middle one by its middle goes to 50');
  assert.deepEqual(L.wbDistributeMoves([{ id: 'x', x0: 0, x1: 1, y0: 0, y1: 1 }, { id: 'y', x0: 5, x1: 6, y0: 0, y1: 1 }], 'horizontal'), [], 'two: nothing');
});

// ---- guides -----------------------------------------------------------------------------------------------------------
await test('guides: the nearest edge or middle within the tolerance wins; past it, or no candidates, no snap', () => {
  const moving = { x0: 103, y0: 500, x1: 203, y1: 580 };
  const other = { x0: 100, y0: 0, x1: 200, y1: 80 };
  const r = L.wbGuideSnap(moving, [other], 6);
  assert.deepEqual([r.dx, r.dy], [-3, 0], 'left onto left (3 away), nothing near down');
  assert.equal(r.lines.length, 3, 'its left, middle and right all line up now: three lines');
  const left = r.lines.find((l) => l.at === 100);
  assert.deepEqual(left, { axis: 'x', at: 100, from: 0, to: 580 }, 'a line runs past both boxes');
  assert.deepEqual(L.wbGuideSnap(moving, [other], 3), { dx: -3, dy: 0, lines: r.lines }, 'exactly at the tolerance: snaps');
  assert.deepEqual(L.wbGuideSnap(moving, [other], 2.9), { dx: 0, dy: 0, lines: [] }, 'just past it: no snap, no lines');
  assert.deepEqual(L.wbGuideSnap(moving, [], 6), { dx: 0, dy: 0, lines: [] }, 'no candidates: no snap');
  // the middle of the moving box onto another's edge, both axes at once
  const m2 = { x0: 0, y0: 0, x1: 40, y1: 40 }; // middle 20, 20
  const r2 = L.wbGuideSnap(m2, [{ x0: 24, y0: 100, x1: 70, y1: 120 }, { x0: 300, y0: 10, x1: 340, y1: 25 }], 6);
  assert.deepEqual([r2.dx, r2.dy], [4, -2.5], 'middle onto the left edge (4), middle onto a middle (-2.5)');
  assert.ok(r2.lines.some((l) => l.axis === 'x' && l.at === 24) && r2.lines.some((l) => l.axis === 'y' && l.at === 17.5), 'a line each way');
});

await test('guides: of two as near, the first found wins; a nearer one later still wins', () => {
  const moving = { x0: 50, y0: 0, x1: 100, y1: 10 }; // its left 50, its middle 75, its right 100
  const a = { x0: 47, y0: 100, x1: 47, y1: 101 }; // 3 left of its left
  const b = { x0: 53, y0: 200, x1: 53, y1: 201 }; // 3 right of it: as near, found later
  assert.equal(L.wbGuideSnap(moving, [a, b], 6).dx, -3, 'tie: the first candidate');
  assert.equal(L.wbGuideSnap(moving, [b, a], 6).dx, 3, 'tie the other way round: the first candidate');
  const c = { x0: 51, y0: 300, x1: 51, y1: 301 }; // 1 away
  assert.equal(L.wbGuideSnap(moving, [a, b, c], 6).dx, 1, 'the nearest wins wherever it is');
});

// The Select tool, with a page in small: guides only with Snap to grid off; a locked block is not dragged.
function dragWith({ snap, guiding, blocks, pick, near = [] }) {
  const select = L.tools.get('select');
  const board = new Map(blocks.map((b) => [b.id, b]));
  const out = { guides: [], notes: [], saved: [] };
  const ctx = {
    policy: L.createPolicy({ can: () => true }),
    selected: () => (pick.length === 1 ? pick[0] : null), selection: () => pick.slice(), isSelected: (id) => pick.includes(id),
    get: (id) => board.get(id) || null, hold() {}, scale: () => 2, many: () => false, element: () => null,
    snapping: () => snap, guiding: () => guiding,
    guideBoxes: (ids) => ({ box: ids.map((id) => L.wbRect(board.get(id))).reduce((a, r) => (a ? { x0: Math.min(a.x0, r.x0), y0: Math.min(a.y0, r.y0), x1: Math.max(a.x1, r.x1), y1: Math.max(a.y1, r.y1) } : r), null), near }),
    guides: (lines) => out.guides.push(lines),
    lockedNote: (n, of) => out.notes.push([n, of]),
    change(id, fields) { board.set(id, clean({ ...board.get(id), ...fields })); },
    save: (id) => out.saved.push(id), select() {}, toggle() {}, edit() {},
  };
  const at = (sx, sy) => ({ x: sx / 2, y: sy / 2, sx, sy, id: pick[0], handle: null, pointerType: 'mouse', event: {} });
  select.down(at(0, 0), ctx);
  select.move(at(2 * 47, 2 * 3), ctx); // 47, 3 board units
  select.up(at(2 * 47, 2 * 3), ctx);
  out.board = board;
  return out;
}
await test('the Select tool: guides with Snap to grid off, the grid alone with it on; a locked block stays', () => {
  const near = [{ x0: 150, y0: 400, x1: 250, y1: 480 }];
  const g = dragWith({ snap: false, guiding: true, blocks: [note('a', 100, 0)], pick: ['a'], near });
  assert.deepEqual([g.board.get('a').x, g.board.get('a').y], [150, 3], 'dragged 47 across: its left goes onto the other\'s (3 away at 2x: 6 px)');
  assert.ok(g.guides.some((l) => l.length > 0), 'guides drawn while snapped');
  assert.deepEqual(g.guides[g.guides.length - 1], [], 'and taken away on the drop');
  const grid = dragWith({ snap: true, guiding: false, blocks: [note('a', 100, 0)], pick: ['a'], near });
  assert.deepEqual([grid.board.get('a').x, grid.board.get('a').y], [144, 0], 'on the grid instead');
  assert.ok(grid.guides.every((l) => l.length === 0), 'no guides with Snap to grid on');
  const free = dragWith({ snap: false, guiding: false, blocks: [note('a', 100, 0)], pick: ['a'], near });
  assert.deepEqual([free.board.get('a').x, free.board.get('a').y], [147, 3], 'no guides (Alt): where it was let go');
  const locked = dragWith({ snap: false, guiding: true, blocks: [note('a', 100, 0), note('k', 400, 0, { locked: true })], pick: ['a', 'k'], near: [] });
  assert.deepEqual([locked.board.get('k').x, locked.board.get('a').x], [400, 147], 'the locked one stays, the other moves');
  assert.deepEqual(locked.notes, [[1, 2]], 'the person is told once: one of two left');
  assert.deepEqual(locked.saved, ['a'], 'only the moved one is saved');
});

// ---- locks ------------------------------------------------------------------------------------------------------------
await test('locks: cleaning; lib-b refuses a change and a delete, allows a lock; Lock and Unlock', () => {
  assert.equal(note('a', 0, 0, { locked: true }).locked, true);
  for (const v of [false, 'yes', 1, null]) assert.ok(!('locked' in note('a', 0, 0, { locked: v })), `locked: ${JSON.stringify(v)} is no lock`);
  const edit = L.createPolicy({ can: (p) => p === 'edit' });
  const look = L.createPolicy({ can: () => false });
  const k = note('k', 0, 0, { locked: true });
  const a = note('a', 0, 0);
  assert.deepEqual([edit.canChange(k), edit.canDelete(k), edit.canLock(k)], [false, false, true], 'a locked block: no change, no delete, may be unlocked');
  assert.deepEqual([edit.canChange(a), edit.canDelete(a), edit.canLock(a)], [true, true, true], 'an unlocked block: all three');
  assert.deepEqual([look.canChange(a), look.canDelete(a), look.canLock(a), look.canLock(k)], [false, false, false, false], 'someone who may only look: none');
  const some = L.wbLockChanges(['a', 'k'], [a, k]);
  assert.deepEqual(some, { on: true, changes: [{ id: 'a', fields: { locked: true } }] }, 'any unlocked: Lock, only the unlocked ones change');
  const all = L.wbLockChanges(['k', 'j'], [k, note('j', 0, 0, { locked: true })]);
  assert.deepEqual(all, { on: false, changes: [{ id: 'k', fields: { locked: undefined } }, { id: 'j', fields: { locked: undefined } }] }, 'all locked: Unlock');
  assert.ok(!('locked' in clean({ ...k, ...all.changes[0].fields })), 'unlocked: the field is gone');
  assert.equal(L.wbLockedNote(2, 5), 'Left 2 locked blocks as they are.');
  assert.equal(L.wbLockedNote(1, 3), 'Left a locked block as it is.');
  assert.equal(L.wbLockedNote(1, 1), 'This block is locked.');
  assert.equal(L.wbLockedNote(0, 3), '');
});

await test('locks: a copy is not locked; a delete leaves locked blocks and takes every connector of what it deletes', () => {
  let n = 0;
  const copies = L.wbCopies([note('k', 0, 0, { locked: true })], { newId: () => `c${(n += 1)}`, dx: 24, dy: 24 });
  assert.ok(!('locked' in copies[0]) && copies[0].x === 24, 'the copy is unlocked, a step along');
  const a = note('a', 0, 0);
  const b = note('b', 200, 0);
  const k = note('k', 400, 0, { locked: true });
  const ab = conn('ab', 'a', 'b', { locked: true }); // a locked connector
  const bk = conn('bk', 'b', 'k');
  const all = [a, b, k, ab, bk];
  const refsOf = (x) => { const d = L.blockTypes.get(x.type); return d.refs ? d.refs(x) : []; };
  const r = L.wbDeleteSet(['a', 'k'], all, { refsOf });
  assert.deepEqual(r, { ids: ['a', 'ab'], locked: 1 }, 'a goes with its locked connector; k stays (one locked)');
  const lone = L.wbDeleteSet(['ab'], all, { refsOf });
  assert.deepEqual(lone, { ids: [], locked: 1 }, 'a locked connector picked alone stays');
  const viaB = L.wbDeleteSet(['b'], all, { refsOf });
  assert.deepEqual(viaB.ids.sort(), ['ab', 'b', 'bk'], 'deleting b takes both its connectors, the locked one too');
});

// ---- groups -----------------------------------------------------------------------------------------------------------
await test('groups: cleaning, a group of one is none, picking expands to the group', () => {
  assert.equal(note('a', 0, 0, { group: 'g1abc' }).group, 'g1abc');
  for (const v of ['G1', 'a-b', '', 'x'.repeat(25), 7, null]) assert.ok(!('group' in note('a', 0, 0, { group: v })), `group ${JSON.stringify(v)} is cleaned away`);
  assert.equal(note('a', 0, 0, { group: 'x'.repeat(24) }).group, 'x'.repeat(24), '24 characters is fine');
  assert.match(L.wbGroupId(), /^[a-z0-9]{12}$/, 'a new id is 12 letters and digits');
  const blocks = [note('a', 0, 0, { group: 'g' }), note('b', 0, 0, { group: 'g' }), note('c', 0, 0, { group: 'h' }), note('d', 0, 0)];
  assert.deepEqual([...L.wbGroupsOf(blocks)], [['g', ['a', 'b']]], 'h has one block: no group');
  assert.deepEqual(L.wbExpandGroups(['b'], blocks), ['b', 'a'], 'picking b picks a');
  assert.deepEqual(L.wbExpandGroups(['c', 'd'], blocks), ['c', 'd'], 'a group of one picks only itself');
  assert.deepEqual(L.wbExpandGroups([], blocks), []);
});

await test('groups: Group merges the groups it touches and leaves locked blocks; Ungroup empties them', () => {
  const blocks = [note('a', 0, 0, { group: 'g' }), note('b', 0, 0, { group: 'g' }), note('c', 0, 0, { group: 'h' }), note('d', 0, 0, { group: 'h' }),
    note('e', 0, 0), note('k', 0, 0, { group: 'h', locked: true })];
  const r = L.wbGroupChanges(['a', 'c', 'e'], blocks, { newGroup: () => 'new1' });
  assert.deepEqual(r.changes.map((c) => c.id).sort(), ['a', 'b', 'c', 'd', 'e'], 'every block of g and h, and e');
  assert.ok(r.changes.every((c) => c.fields.group === 'new1'), 'one new id');
  assert.equal(r.locked, 1, 'k (locked) is left in h');
  assert.deepEqual(L.wbGroupChanges(['a'], blocks, { newGroup: () => 'z' }).changes, [], 'one group picked whole: nothing to do');
  assert.deepEqual(L.wbGroupChanges(['e'], blocks, { newGroup: () => 'z' }).changes, [], 'one block: nothing to group');
  assert.deepEqual(L.wbGroupChanges(['e', 'j'], [...blocks, note('j', 0, 0, { locked: true })], { newGroup: () => 'z' }), { changes: [], locked: 1 }, 'one free and one locked: no group, the locked one counted');
  assert.equal(L.wbGroupChanges(['e', 'k'], blocks, { newGroup: () => 'z' }).changes.length, 3, 'picking k (locked) still brings in its group\'s free blocks');
  const u = L.wbUngroupChanges(['c'], blocks);
  assert.deepEqual(u.changes.map((c) => c.id), ['c', 'd'], 'every block of h leaves it');
  assert.equal(u.locked, 1, 'the locked one stays');
  assert.ok(!('group' in clean({ ...blocks[2], ...u.changes[0].fields })), 'the field is gone');
});

await test('groups: a copy of a group is a new group; a copy of one block of a group is in none', () => {
  let n = 0;
  let g = 0;
  const opts = { newId: () => `c${(n += 1)}`, newGroup: () => `ng${(g += 1)}` };
  const two = L.wbCopies([note('a', 0, 0, { group: 'g' }), note('b', 0, 0, { group: 'g' })], opts);
  assert.deepEqual(two.map((c) => c.group), ['ng1', 'ng1'], 'one new group id for the copies');
  const groups = L.wbCopies([note('a', 0, 0, { group: 'g' }), note('b', 0, 0, { group: 'g' }), note('c', 0, 0, { group: 'h' }), note('d', 0, 0, { group: 'h' })], opts);
  assert.deepEqual(groups.map((c) => c.group), ['ng2', 'ng2', 'ng3', 'ng3'], 'two groups copied: two new groups');
  const one = L.wbCopies([note('a', 0, 0, { group: 'g' })], opts);
  assert.ok(!('group' in one[0]), 'one block of a group: its copy is in none');
  const usual = L.wbCopies([note('a', 0, 0, { group: 'g' }), note('b', 0, 0, { group: 'g' })], { newId: () => `c${(n += 1)}` });
  assert.match(usual[0].group, /^[a-z0-9]{12}$/, 'with no newGroup given, a new id of its own');
  assert.notEqual(usual[0].group, 'g');
});

// ---- undo and redo -----------------------------------------------------------------------------------------------------
// A page in small, as check-whiteboard-history's, with the page's own rules for a lock (whiteboard.js, applyChanges).
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

await test('undo and redo: lock, group and align are one step each', async () => {
  const p = page();
  p.theirs('a', note('a', 0, 0));
  p.theirs('b', note('b', 200, 40));
  p.theirs('c', note('c', 400, 90));
  await turn();
  // Align top: one step for all of them.
  const r = L.wbArrangeChanges([...p.board.values()], 'top', { measure });
  for (const c of r.changes) p.mine(c.id, c.fields);
  await turn();
  assert.equal(p.history.size, 1, 'align: one step');
  assert.deepEqual([...p.board.values()].map((b) => b.y), [0, 0, 0]);
  // Group: one step.
  for (const c of L.wbGroupChanges(['a', 'b', 'c'], [...p.board.values()], { newGroup: () => 'gg' }).changes) p.mine(c.id, c.fields);
  await turn();
  // Lock: one step.
  for (const c of L.wbLockChanges(['a', 'b'], [...p.board.values()]).changes) p.mine(c.id, c.fields);
  await turn();
  assert.equal(p.history.size, 3, 'three commands, three steps');
  p.undo(); // the lock
  assert.ok(!p.board.get('a').locked && !p.board.get('b').locked, 'undo of a lock unlocks, though the blocks are locked');
  p.redo();
  assert.ok(p.board.get('a').locked && p.board.get('b').locked, 'redo locks again');
  p.undo();
  p.undo(); // the group
  assert.ok([...p.board.values()].every((b) => !('group' in b)), 'undo of the group');
  p.redo();
  assert.ok([...p.board.values()].every((b) => b.group === 'gg'), 'redo of the group');
  p.undo();
  p.undo(); // the align
  assert.deepEqual([...p.board.values()].map((b) => b.y), [0, 40, 90], 'undo of the align puts each back');
  p.redo();
  assert.deepEqual([...p.board.values()].map((b) => b.y), [0, 0, 0], 'redo of the align');
});

await test('undo: a move of a block someone has locked since is left, and said; my undo of a move does not unlock', async () => {
  const p = page();
  p.theirs('a', note('a', 0, 0));
  p.theirs('b', note('b', 0, 300));
  p.mine('a', { x: 50 });
  p.mine('b', { x: 60 });
  await turn();
  p.theirs('a', { locked: true });
  const r = p.undo();
  assert.equal(p.board.get('a').x, 50, 'the locked one stays where it is');
  assert.equal(p.board.get('a').locked, true, 'and stays locked');
  assert.equal(p.board.get('b').x, 0, 'the other goes back');
  assert.equal(r.locked, 1, 'one counted');
  assert.equal(L.wbUndoNote(r), 'Left a locked block as it is.', 'and said');
  // an undo of a block made, now locked: it stays
  const q = page();
  q.mine('n', note('n', 0, 0));
  await turn();
  q.theirs('n', { locked: true });
  const r2 = q.undo();
  assert.ok(q.board.has('n') && r2.locked === 1, 'an undo of a block made, locked since: it stays, counted');
});

await test('undo: field by field with someone else\'s lock or group', async () => {
  // I group; someone else locks one of them; my undo of the group: the locked one keeps its group (left, said), the
  // other leaves the group.
  const p = page();
  p.theirs('a', note('a', 0, 0));
  p.theirs('b', note('b', 0, 300));
  p.mine('a', { group: 'gg' });
  p.mine('b', { group: 'gg' });
  await turn();
  p.theirs('b', { locked: true });
  const r = p.undo();
  assert.ok(!('group' in p.board.get('a')) && p.board.get('b').group === 'gg' && r.locked === 1, 'the unlocked one leaves the group; the locked one is left');
  // I lock; someone else moves it before (no, they cannot after): they recolour while I lock; my undo of the lock keeps
  // their colour.
  const q = page();
  q.theirs('a', note('a', 0, 0));
  q.mine('a', { locked: true });
  await turn();
  q.theirs('a', { fill: 'blue' }); // a change that came in from before the lock reached them
  q.undo();
  assert.ok(!q.board.get('a').locked && q.board.get('a').fill === 'blue', 'undo of my lock: unlocked, their colour stays');
  // Someone else unlocks what I locked: my undo of the lock leaves it as it is.
  const s = page();
  s.theirs('a', note('a', 0, 0));
  s.mine('a', { locked: true });
  await turn();
  s.theirs('a', { locked: undefined });
  const r3 = s.undo();
  assert.ok(!s.board.get('a').locked && r3.kept === 1, 'they unlocked it since: left as it is (kept)');
  // Someone else changes the group of a block I moved: my undo of the move keeps their group.
  const t = page();
  t.theirs('a', note('a', 0, 0));
  t.mine('a', { x: 40 });
  await turn();
  t.theirs('a', { group: 'theirs' });
  t.undo();
  assert.ok(t.board.get('a').x === 0 && t.board.get('a').group === 'theirs', 'undo of my move: back, their group stays');
});

if (fails.length) {
  for (const f of fails) console.error(`FAIL ${f}`);
  console.error(`check-whiteboard-arrange: ${fails.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`check-whiteboard-arrange: OK, ${passed} cases`);
