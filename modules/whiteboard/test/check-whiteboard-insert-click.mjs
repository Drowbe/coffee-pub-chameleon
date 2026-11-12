#!/usr/bin/env node
/*
 * check-whiteboard-insert-click.mjs -- a click on a block with an insert tool on (modules/whiteboard/src/whiteboard-lib-f-tool-insert.js).
 * Guards: wbTakesText and wbInsertClickAction (pure) for every block type x every insert tool, the empty board, frames, a
 * locked block, someone who may not change, tools that are not insert tools, and hostile input (null, unknown type, junk).
 * It runs the module's own code: lib-a, lib-e-* and the tool file in one scope. No network.
 * Usage: node modules/whiteboard/test/check-whiteboard-insert-click.mjs [path to the tool file]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const file = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src/whiteboard-lib-f-tool-insert.js'));
const src = path.dirname(file);
let passed = 0;
const fails = [];
const check = (ok, what) => { if (ok) passed += 1; else fails.push(what); };

let lib = {};
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-(a|e)-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  parts.push(fs.readFileSync(file, 'utf8'));
  lib = new Function(`${parts.join('\n')}\nreturn { wbTakesText, wbInsertClickAction, WB_INSERT_TOOLS, blockTypes };`)();
} catch (e) { fails.push(`the code does not load: ${e.message}`); }

if (lib.wbInsertClickAction) {
  const { wbTakesText, wbInsertClickAction: act, WB_INSERT_TOOLS: tools, blockTypes } = lib;
  const can = { canChange: (b) => b.locked !== true };
  const types = [...blockTypes.list ? blockTypes.list().map((d) => d.type) : []];
  check(types.length >= 10, `block types found (${types.length})`);
  const WORDS = ['note', 'text', 'rect', 'ellipse', 'rounded', 'diamond', 'pill', 'parallelogram', 'table', 'image'];
  const SELECT = ['stroke', 'highlight', 'line', 'connector'];
  for (const t of tools) {
    const tool = { id: t, edits: true };
    for (const ty of types) {
      const want = ty === 'frame' ? 'place' : WORDS.includes(ty) ? 'edit' : 'select';
      const got = act({ type: ty, id: 'a' }, tool, can);
      if (ty === 'timer') continue; // a clock over the board, not a drawn block: whatever the type says
      check(got === want, `${t} on ${ty}: ${got} (want ${want})`);
      check(act({ type: ty, id: 'a', locked: true }, tool, can) === (ty === 'frame' ? 'place' : 'select'), `${t} on locked ${ty}`);
      check(act({ type: ty }, tool, { canChange: () => false }) === (ty === 'frame' ? 'place' : 'place'), `${t} on ${ty} when it may not be changed`);
    }
    check(act(null, tool, can) === 'place', `${t} on the empty board`);
    check(act(undefined, tool, can) === 'place', `${t} undefined block`);
    check(act({ type: 'nonsense' }, tool, can) === 'select', `${t} unknown type is picked`);
    check(act({ type: 5 }, tool, can) === 'select', `${t} numeric type`);
    check(act({ type: 'note' }, tool, null) === 'place', `${t} no ctx`);
    check(act({ type: 'note' }, tool, {}) === 'place', `${t} ctx without canChange`);
    check(act('x', tool, can) === 'place', `${t} string block`);
  }
  for (const id of ['select', 'pen', 'highlight', 'eraser', 'fill', 'hand', 'connector', 'line', 'arrow', 'frame', 'timer', '', 'nope']) {
    check(act({ type: 'note' }, { id }, can) === 'place', `${id} is not an insert tool`);
  }
  check(act({ type: 'note' }, null, can) === 'place', 'no tool');
  for (const ty of SELECT) check(!wbTakesText({ type: ty }), `${ty} takes no words`);
  for (const ty of WORDS) check(wbTakesText({ type: ty }), `${ty} takes words`);
  check(!wbTakesText({ type: 'frame' }), 'a frame is put into');
  check(!wbTakesText(null) && !wbTakesText(7) && !wbTakesText({}) && !wbTakesText({ type: '__proto__' }) && !wbTakesText({ type: 'constructor' }), 'hostile input takes no words');
}

if (fails.length) { console.error(`check-whiteboard-insert-click: ${fails.length} failed, ${passed} passed`); for (const f of fails) console.error(`  - ${f}`); process.exit(1); }
console.log(`check-whiteboard-insert-click: all ${passed} checks passed`);
