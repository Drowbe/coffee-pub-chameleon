#!/usr/bin/env node
/*
 * check-whiteboard-history.mjs -- the Whiteboard's undo and redo (modules/whiteboard/src/whiteboard-lib-g-history.js).
 * Guards: undo must put back only the fields the step changed and keep other people's changes (field-wise undo and redo,
 * wbMergeBack), with the fields a block type links (a line's ends, a box) going back together or not at all, so an undo
 * never makes a shape neither person made; plus one gesture being one step, merged nudges, the order an undo goes in, a
 * new step clearing Redo, the cap, and what the person is told (wbUndoNote). It runs the module's own code: the block
 * format and the block types (lib-a, lib-e-*: wbClean and each type's `linked`), and lib-g's createHistory and
 * wbApplyChanges, the same apply the page uses, against a board kept in a Map. No network, no sleeps.
 * Usage: node tools/check-whiteboard-history.mjs [path to whiteboard-lib-g-history.js; lib-a and lib-e-* are read from its
 * folder]. Exits 1 on any failure; a lib that lacks one of the functions fails every case that needs it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src/whiteboard-lib-g-history.js'));
const src = path.dirname(file); // the block format and block types are read from beside it
const NAMES = ['createHistory', 'wbMergeBack', 'wbApplyChanges', 'wbUndoNote', 'wbClean', 'blockTypes'];

let passed = 0;
const fails = [];
const check = (ok, what) => { if (ok) passed += 1; else fails.push(what); };

// The block format and block types, then the history lib, in one scope as the page has them (lib files in name order).
let lib = {};
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-(a|e)-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  parts.push(fs.readFileSync(file, 'utf8'));
  const grab = NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  lib = new Function(`${parts.join('\n')}\nreturn { ${grab} };`)();
} catch (err) {
  fails.push(`the libs do not load: ${err.message}`);
}
const need = (...names) => { const missing = names.filter((n) => typeof lib[n] === 'undefined'); if (missing.length) throw new Error(`the lib has no ${missing.join(', ')}`); };
const turn = () => new Promise((r) => { setImmediate(r); }); // the end of a turn: the step being gathered is closed

// A page in small: its board, a "persist" that records the change, and lib-g's own apply, as whiteboard.js hands it.
function page() {
  need('createHistory', 'wbApplyChanges', 'wbClean', 'blockTypes');
  const board = new Map();
  const history = lib.createHistory({ cap: 100 });
  const known = new Map();
  const order = []; // what the apply did, in order: ['put', id] / ['remove', id]
  let stamp = 0;
  const p = {
    board,
    history,
    order,
    // This person changes a block (a gesture): before is what this page last knew.
    mine(id, patch) {
      const now = board.get(id);
      const next = patch === null ? null : lib.wbClean({ ...(now || { id }), ...patch, by: 'a', at: String((stamp += 1)) });
      if (patch !== null && !next) throw new Error(`not a block: ${JSON.stringify(patch)}`);
      history.record(id, known.get(id) || null, next);
      if (next) { board.set(id, next); known.set(id, next); } else { board.delete(id); known.delete(id); }
    },
    // Someone else's change, heard.
    theirs(id, patch) {
      if (patch === null) { board.delete(id); known.delete(id); return; }
      const next = lib.wbClean({ ...board.get(id), id, ...patch, by: 'b' });
      if (!next) throw new Error(`not a block: ${JSON.stringify(patch)}`);
      board.set(id, next);
      known.set(id, next);
    },
    apply(list) {
      return lib.wbApplyChanges(list, {
        get: (id) => board.get(id) || null,
        remove: (id) => { order.push(['remove', id]); p.mine(id, null); },
        put: (b) => { order.push(['put', b.id]); const s = { ...b, by: 'a', at: String((stamp += 1)) }; history.record(b.id, known.get(b.id) || null, s); board.set(b.id, s); known.set(b.id, s); },
        canChange: () => true,
        canCreate: () => true,
        clean: lib.wbClean,
        linkedOf: (b) => { const def = lib.blockTypes.get(b.type); return (def && def.linked) || []; },
      });
    },
    undo: () => history.undo(p.apply),
    redo: () => history.redo(p.apply),
  };
  return p;
}
const note = (x, y, fill = 'gold') => ({ type: 'note', x, y, w: 180, h: 180, fill });
const line = (x, y, dx, dy) => ({ type: 'line', x, y, dx, dy });
const rect = (x, y, w, h) => ({ type: 'rect', x, y, w, h });
const pick = (b, ...f) => JSON.stringify(Object.fromEntries(f.map((k) => [k, b[k]])));

const cases = {
  async 'A moves, B recolours, A undoes: the place goes back, the fill stays B\'s; redo moves it again'() {
    const p = page();
    p.theirs('n', note(0, 0, 'gold'));
    p.mine('n', { x: 50, y: 60 });
    await turn();
    p.theirs('n', { fill: 'blue' });
    const r = p.undo();
    const b = p.board.get('n');
    check(b.x === 0 && b.y === 0 && b.fill === 'blue', `A moves, B recolours, A undoes: place back, fill stays B's (got ${pick(b, 'x', 'y', 'fill')})`);
    check(r.kept === 0 && r.left === 0, 'nothing reported left as it is');
    p.redo();
    const c = p.board.get('n');
    check(c.x === 50 && c.y === 60 && c.fill === 'blue', `redo after that: moved again, fill still B's (got ${pick(c, 'x', 'y', 'fill')})`);
  },
  async 'the same field changed by both: B\'s wins, the block is left as it is'() {
    const p = page();
    p.theirs('n', note(0, 0, 'gold'));
    p.mine('n', { fill: 'red' });
    await turn();
    p.theirs('n', { fill: 'blue' });
    const r = p.undo();
    check(p.board.get('n').fill === 'blue' && r.kept === 1, 'same field changed by both: B\'s wins, one block left as it is');
    const r2 = p.redo();
    check(p.board.get('n').fill === 'blue' && r2.kept === 1, 'redo of that: still B\'s, left as it is');
    check(p.history.canUndo() && !p.history.canRedo(), 'the step is back on the undo stack after redo');
  },
  async 'a move is one unit: B moves only x, A undoes its move: the note stays where B put it'() {
    const p = page();
    p.theirs('n', note(0, 0));
    p.mine('n', { x: 10, y: 10 });
    await turn();
    p.theirs('n', { x: 99 });
    const r = p.undo();
    const b = p.board.get('n');
    check(b.x === 99 && b.y === 10 && r.kept === 1, `part of a move changed by B: x and y stay as they are, reported (got ${pick(b, 'x', 'y')}, kept ${r.kept})`);
  },
  async 'linked: A drags a line\'s start, B moves the line, A undoes: no far-end jump'() {
    const p = page();
    p.theirs('l', line(300, 100, 100, 0)); // 300 -> 400
    p.mine('l', { x: 250, dx: 150 }); // A drags the start to 250 (the end stays at 400)
    await turn();
    p.theirs('l', { x: 300 }); // B moves the line 50 along: 300 -> 450
    const r = p.undo();
    const b = p.board.get('l');
    check(b.x === 300 && b.dx === 150 && r.kept === 1, `line start handle, B moves, A undoes: B's line 300 -> 450 stays (got ${b.x} -> ${b.x + b.dx}, kept ${r.kept})`);
  },
  async 'linked: A drags a line\'s far end, B moves the line, A undoes: the end goes back'() {
    const p = page();
    p.theirs('l', line(300, 100, 100, 0));
    p.mine('l', { dx: 200, dy: 40 }); // A drags the far end
    await turn();
    p.theirs('l', { x: 350, y: 120 }); // B moves the line
    p.undo();
    const b = p.board.get('l');
    check(b.x === 350 && b.y === 120 && b.dx === 100 && b.dy === 0, `line end handle, B moves, A undoes: the end goes back, B's place stays (got ${pick(b, 'x', 'y', 'dx', 'dy')})`);
  },
  async 'linked: A resizes a rectangle from its top-left, B moves it, A undoes: B\'s rectangle stays'() {
    const p = page();
    p.theirs('r', rect(100, 100, 200, 100));
    p.mine('r', { x: 50, y: 50, w: 250, h: 150 });
    await turn();
    p.theirs('r', { x: 80, y: 50 });
    const r = p.undo();
    const b = p.board.get('r');
    check(b.x === 80 && b.y === 50 && b.w === 250 && b.h === 150 && r.kept === 1, `rectangle top-left resize, B moves, A undoes: left as B has it (got ${pick(b, 'x', 'y', 'w', 'h')})`);
  },
  async 'linked: A resizes a picture from a corner, B moves it, A undoes: B\'s picture stays'() {
    const p = page();
    const pic = { type: 'image', x: 100, y: 100, w: 200, h: 100, upload: 'c'.repeat(24) };
    p.theirs('i', pic);
    p.mine('i', { x: 60, y: 80, w: 240, h: 120 }); // A drags the top-left corner (the shape kept)
    await turn();
    p.theirs('i', { x: 300, y: 80 }); // B moves it along
    const r = p.undo();
    const b = p.board.get('i');
    check(b.x === 300 && b.y === 80 && b.w === 240 && b.h === 120 && r.kept === 1, `picture corner resize, B moves, A undoes: left as B has it (got ${pick(b, 'x', 'y', 'w', 'h')}, kept ${r.kept})`);
  },
  async 'linked: A moves a note, B resizes it from the bottom-right, A undoes: the note goes back, B\'s size stays'() {
    const p = page();
    p.theirs('n', note(0, 0));
    p.mine('n', { x: 40, y: 40 });
    await turn();
    p.theirs('n', { w: 300, h: 260 });
    p.undo();
    const b = p.board.get('n');
    check(b.x === 0 && b.y === 0 && b.w === 300 && b.h === 260, `note moved by A, resized by B, A undoes: place back, B's size stays (got ${pick(b, 'x', 'y', 'w', 'h')})`);
  },
  async 'a group step with mixed outcomes; both notes are said'() {
    const p = page();
    for (const id of ['a', 'b', 'c', 'd']) p.theirs(id, note(0, 0, 'gold'));
    for (const id of ['a', 'b', 'c', 'd']) p.mine(id, { x: 5, y: 5 }); // one drag, one turn
    await turn();
    check(p.history.size === 1, 'one gesture over four blocks is one step');
    p.theirs('a', { x: 77, y: 77 }); // all the step's fields: left as it is
    p.theirs('b', { fill: 'blue' }); // another field: put back, the fill kept
    p.theirs('c', null); // deleted: left out
    const r = p.undo();
    check(p.board.get('a').x === 77 && p.board.get('a').y === 77, 'group: a block B moved stays where B put it');
    check(p.board.get('b').x === 0 && p.board.get('b').fill === 'blue', 'group: a block B recoloured goes back, keeps B\'s colour');
    check(!p.board.has('c'), 'group: a block B deleted is not brought back');
    check(p.board.get('d').x === 0, 'group: an untouched block goes back');
    check(r.kept === 1 && r.left === 1, `group: one left as it is, one left out (got ${JSON.stringify({ left: r.left, kept: r.kept })})`);
    need('wbUndoNote');
    const told = lib.wbUndoNote(r);
    check(/Left out a block someone else deleted/.test(told) && /Left a block as it is/.test(told), `both notes are said when both happened (got "${told}")`);
    check(lib.wbUndoNote({ left: 0, kept: 0 }) === '' && lib.wbUndoNote({ left: 2, kept: 0 }) === 'Left out 2 blocks someone else deleted.', 'no note when all went back; one note alone');
  },
  async 'create and delete stay whole'() {
    const p = page();
    p.theirs('n', note(1, 2, 'gold'));
    p.mine('n', null);
    await turn();
    p.undo();
    const b = p.board.get('n');
    check(b && b.x === 1 && b.y === 2 && b.fill === 'gold', 'undo of a delete: the whole block back');
    p.mine('m', note(3, 3, 'red'));
    await turn();
    p.theirs('m', { fill: 'blue' });
    p.undo();
    check(!p.board.has('m'), 'undo of a create takes the block away (whole), even if someone else changed it');
    p.redo();
    check(p.board.get('m') && p.board.get('m').fill === 'red', 'redo of a create puts the whole block back');
  },
  async 'an undo goes last change first, a redo first change first'() {
    const p = page();
    p.mine('a', note(0, 0));
    p.mine('b', note(10, 10));
    p.mine('c', note(20, 20));
    await turn();
    p.undo();
    check(JSON.stringify(p.order) === JSON.stringify([['remove', 'c'], ['remove', 'b'], ['remove', 'a']]), `undo: the last change first (got ${JSON.stringify(p.order)})`);
    p.order.length = 0;
    p.redo();
    check(JSON.stringify(p.order) === JSON.stringify([['put', 'a'], ['put', 'b'], ['put', 'c']]), `redo: the first change first (got ${JSON.stringify(p.order)})`);
  },
  async 'a new step clears what could be redone'() {
    const p = page();
    p.theirs('n', note(0, 0));
    p.mine('n', { x: 10 });
    await turn();
    p.undo();
    check(p.history.canRedo(), 'after an undo, redo is possible');
    p.mine('n', { y: 30 });
    await turn();
    check(!p.history.canRedo() && p.redo() === null, 'a new step clears Redo');
    check(p.board.get('n').x === 0 && p.board.get('n').y === 30, 'and the board is as the new step left it');
  },
  async 'a step keeps its own copy of the blocks (deep)'() {
    const p = page();
    const before = lib.wbClean({ id: 's', type: 'stroke', x: 0, y: 0, points: [0, 0, 10, 10] });
    p.board.set('s', before);
    const after = lib.wbClean({ ...before, points: [0, 0, 20, 20] });
    p.history.record('s', before, after);
    p.board.set('s', JSON.parse(JSON.stringify(after)));
    await turn();
    after.points[2] = 999; // the page changes its own object later
    before.points[2] = 777;
    p.undo();
    check(JSON.stringify(p.board.get('s').points) === '[0,0,10,10]', `undo puts back the points as they were when recorded (got ${JSON.stringify(p.board.get('s').points)})`);
    p.redo();
    check(JSON.stringify(p.board.get('s').points) === '[0,0,20,20]', `redo puts back the points as they were when recorded (got ${JSON.stringify(p.board.get('s').points)})`);
  },
  async 'merged nudges are one step'() {
    const p = page();
    p.theirs('n', note(0, 0, 'gold'));
    for (let i = 1; i <= 5; i += 1) { p.history.tag('nudge:n'); p.mine('n', { x: i * 10 }); await turn(); }
    check(p.history.size === 1, `five nudges are one step (got ${p.history.size})`);
    p.theirs('n', { fill: 'blue' });
    p.undo();
    check(p.board.get('n').x === 0 && p.board.get('n').fill === 'blue', 'undo of the nudges: back to the start, B\'s fill kept');
  },
  async 'pictures added at once are one step, however far apart they land; redo brings them all back'() {
    const p = page();
    const pic = (x) => ({ type: 'image', x, y: 0, w: 100, h: 80, upload: 'a'.repeat(24) });
    for (const id of ['p1', 'p2', 'p3']) { p.history.tag('pictures:1', { join: true }); p.mine(id, pic(id.length)); await turn(); }
    check(p.history.size === 1, `three pictures of one batch, each in its own turn: one step (got ${p.history.size})`);
    p.undo();
    check(!['p1', 'p2', 'p3'].some((id) => p.board.has(id)), 'one undo takes all three pictures away');
    check(!p.history.canUndo(), 'and nothing is left to undo');
    p.redo();
    check(['p1', 'p2', 'p3'].every((id) => p.board.has(id) && p.board.get(id).type === 'image'), 'one redo brings all three back');
  },
  async 'a picture batch with another step between: the step between is its own, the batch still one'() {
    const p = page();
    const pic = { type: 'image', x: 0, y: 0, w: 100, h: 80, upload: 'b'.repeat(24) };
    p.theirs('n', note(0, 0));
    p.history.tag('pictures:2', { join: true }); p.mine('p1', pic); await turn();
    p.mine('n', { x: 40, y: 40 }); await turn(); // the person moves a note while the rest upload
    p.history.tag('pictures:2', { join: true }); p.mine('p2', { ...pic, x: 32 }); await turn();
    p.history.tag('pictures:3', { join: true }); p.mine('q1', { ...pic, x: 64 }); await turn(); // another batch
    check(p.history.size === 3, `batch, move, other batch: three steps (got ${p.history.size})`);
    p.undo();
    check(!p.board.has('q1') && p.board.has('p1') && p.board.has('p2'), 'the first undo takes away only the other batch');
    p.undo();
    check(p.board.get('n').x === 0 && p.board.has('p1') && p.board.has('p2'), 'the second undo puts the note back, the pictures stay');
    p.undo();
    check(!p.board.has('p1') && !p.board.has('p2'), 'the third undo takes both pictures of the batch away');
    const q = page();
    q.history.tag('t', {}); q.mine('a', note(0, 0)); await turn();
    q.mine('b', note(1, 1)); await turn();
    q.history.tag('t', {}); q.mine('c', note(2, 2)); await turn();
    check(q.history.size === 3, `a tag without join joins only the step right before it (got ${q.history.size})`);
  },
  async 'the cap: the oldest steps go'() {
    const p = page();
    p.theirs('n', note(0, 0, 'gold'));
    for (let i = 1; i <= 105; i += 1) { p.mine('n', { x: i }); await turn(); }
    check(p.history.size === 100, `capped at 100 (got ${p.history.size})`);
  },
  async 'wbMergeBack on its own'() {
    need('wbMergeBack');
    check(lib.wbMergeBack({ x: 1 }, { target: { x: 0 }, source: { x: 2 }, fields: ['x'] }) === null, 'wbMergeBack: all changed since -> null');
    const m = lib.wbMergeBack({ x: 2, text: 'hi' }, { target: { x: 0 }, source: { x: 2, text: 'hi' }, fields: ['x', 'text'] });
    check(m && m.x === 0 && !('text' in m), 'wbMergeBack: a field the target lacks is taken away');
    const g = lib.wbMergeBack({ x: 5, w: 30, fill: 'red' }, { target: { x: 0, w: 10, fill: 'gold' }, source: { x: 1, w: 30, fill: 'red' }, fields: ['x', 'w', 'fill'] }, [['x', 'w']]);
    check(g && g.x === 5 && g.w === 30 && g.fill === 'gold', `wbMergeBack: a linked field changed since keeps the whole group (got ${JSON.stringify(g)})`);
  },
};

for (const [name, run] of Object.entries(cases)) {
  try { await run(); } catch (err) { fails.push(`${name}: ${err.message}`); }
}
if (fails.length) {
  for (const f of fails) console.error(`FAIL ${f}`);
  console.error(`check-whiteboard-history: ${fails.length} failed, ${passed} passed (${path.relative(root, file)})`);
  process.exit(1);
}
console.log(`check-whiteboard-history: OK, ${passed} cases`);
