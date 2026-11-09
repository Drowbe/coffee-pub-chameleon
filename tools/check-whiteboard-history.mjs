#!/usr/bin/env node
/*
 * check-whiteboard-history.mjs -- the Whiteboard's undo and redo (modules/whiteboard/src/whiteboard-lib-g-history.js).
 * Guards: undo must put back only the fields the step changed and keep other people's changes (field-wise undo and redo,
 * wbMergeBack), plus one gesture being one step, merged nudges and the cap. The page's apply is copied in small
 * (whiteboard.js applyChanges): a board as a Map, other people's changes written straight into it. No network, no sleeps.
 * Usage: node tools/check-whiteboard-history.mjs [path to whiteboard-lib-g-history.js]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src/whiteboard-lib-g-history.js'));
const src = fs.readFileSync(file, 'utf8');
const lib = new Function(`${src}\nreturn { createHistory, wbMergeBack };`)();
const { createHistory, wbMergeBack } = lib;
const turn = () => new Promise((r) => { setImmediate(r); }); // the end of a turn: the step being gathered is closed

let passed = 0;
const fails = [];
const check = (ok, what) => { if (ok) passed += 1; else fails.push(what); };

// A page in small: its board, a "persist" that records the change, and the same apply as whiteboard.js.
function page() {
  const board = new Map();
  const history = createHistory({ cap: 100 });
  const known = new Map();
  const p = {
    board,
    history,
    // This person changes a block (a gesture): before is what this page last knew.
    mine(id, patch) {
      const now = board.get(id);
      const next = patch === null ? null : { ...(now || { id }), ...patch, by: 'a', at: String(Math.random()) };
      history.record(id, known.get(id) || null, next);
      if (next) { board.set(id, next); known.set(id, next); } else { board.delete(id); known.delete(id); }
    },
    // Someone else's change, heard.
    theirs(id, patch) {
      if (patch === null) { board.delete(id); known.delete(id); return; }
      const next = { ...board.get(id), ...patch, by: 'b' };
      board.set(id, next);
      known.set(id, next);
    },
    apply(list) {
      let left = 0;
      let kept = 0;
      for (const { id, target, source, fields } of list) {
        const now = board.get(id);
        if (!target) { if (now) p.mine(id, null); continue; }
        if (!now && source) { left += 1; continue; }
        const merged = now && fields ? wbMergeBack(now, { target, source, fields }) : target;
        if (!merged) { kept += 1; continue; }
        const { by, at, ...rest } = merged;
        board.set(id, { ...rest, by: 'a' });
        known.set(id, board.get(id));
      }
      return { left, kept };
    },
    undo: () => history.undo(p.apply),
    redo: () => history.redo(p.apply),
  };
  return p;
}
const note = (x, y, fill) => ({ type: 'note', x, y, fill });

async function main() {
  // A moves, B recolours, A undoes: the fill stays B's, the place goes back.
  {
    const p = page();
    p.theirs('n', note(0, 0, 'gold'));
    p.mine('n', { x: 50, y: 60 });
    await turn();
    p.theirs('n', { fill: 'blue' });
    const r = p.undo();
    const b = p.board.get('n');
    check(b.x === 0 && b.y === 0 && b.fill === 'blue', `A moves, B recolours, A undoes: place back, fill stays B's (got ${JSON.stringify(b)})`);
    check(r.kept === 0 && r.left === 0, 'nothing reported left as it is');
    // Redo: the move again, the fill still B's.
    p.redo();
    const c = p.board.get('n');
    check(c.x === 50 && c.y === 60 && c.fill === 'blue', `redo after that: moved again, fill still B's (got ${JSON.stringify(c)})`);
  }
  // The same field changed by both: B's wins, and the step is a no-op for that block (reported).
  {
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
  }
  // A moves; B moves only x; A undoes: y goes back, x stays B's; redo: y moved again, x still B's.
  {
    const p = page();
    p.theirs('n', note(0, 0, 'gold'));
    p.mine('n', { x: 10, y: 10 });
    await turn();
    p.theirs('n', { x: 99 });
    p.undo();
    const b = p.board.get('n');
    check(b.x === 99 && b.y === 0, `part of a move changed by B: B's x stays, y goes back (got ${b.x},${b.y})`);
    p.redo();
    const c = p.board.get('n');
    check(c.x === 99 && c.y === 10, `redo: y moved again, x still B's (got ${c.x},${c.y})`);
  }
  // A group step with mixed outcomes: three blocks moved together; B moves one, recolours one, deletes one.
  {
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
    check(r.kept === 1 && r.left === 1, `group: one left as it is, one left out (got ${JSON.stringify(r)})`);
  }
  // Create and delete stay whole: undo of a delete brings the whole block back; undo of a create takes it away.
  {
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
  }
  // Merged nudges (tagged, within a moment) are one step; the undo puts back the place before the first.
  {
    const p = page();
    p.theirs('n', note(0, 0, 'gold'));
    for (let i = 1; i <= 5; i += 1) { p.history.tag('nudge:n'); p.mine('n', { x: i * 10 }); await turn(); }
    check(p.history.size === 1, `five nudges are one step (got ${p.history.size})`);
    p.theirs('n', { fill: 'blue' });
    p.undo();
    check(p.board.get('n').x === 0 && p.board.get('n').fill === 'blue', 'undo of the nudges: back to the start, B\'s fill kept');
  }
  // The cap: the oldest steps go.
  {
    const p = page();
    p.theirs('n', note(0, 0, 'gold'));
    for (let i = 1; i <= 105; i += 1) { p.mine('n', { x: i }); await turn(); }
    check(p.history.size === 100, `capped at 100 (got ${p.history.size})`);
  }
  // wbMergeBack on its own: nothing to put back gives null; a field that was absent is taken away again.
  {
    check(wbMergeBack({ x: 1 }, { target: { x: 0 }, source: { x: 2 }, fields: ['x'] }) === null, 'wbMergeBack: all changed since -> null');
    const m = wbMergeBack({ x: 2, text: 'hi' }, { target: { x: 0 }, source: { x: 2, text: 'hi' }, fields: ['x', 'text'] });
    check(m && m.x === 0 && !('text' in m), 'wbMergeBack: a field the target lacks is taken away');
  }
  if (fails.length) {
    for (const f of fails) console.error(`FAIL ${f}`);
    console.error(`check-whiteboard-history: ${fails.length} failed, ${passed} passed (${path.relative(root, file)})`);
    process.exit(1);
  }
  console.log(`check-whiteboard-history: OK, ${passed} cases`);
}
main().catch((e) => { console.error(`check-whiteboard-history: ${e.message}`); process.exit(1); });
