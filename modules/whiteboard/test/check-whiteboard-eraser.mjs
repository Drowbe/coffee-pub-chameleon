#!/usr/bin/env node
/*
 * check-whiteboard-eraser.mjs -- the Whiteboard's Eraser (modules/whiteboard/src/whiteboard-lib-f-tool-eraser.js).
 * Guards: wbEraserHits (pure): the box test first, a stroke touched and not touched, a diagonal pass between two pointer
 * moves, brush widths, a highlight, locked blocks skipped and reported, frames, connectors and every other kind never hit,
 * an empty board, hostile numbers (NaN, Infinity, a huge radius, a 3000-point stroke: bounded work); the tool's cap of 100 a
 * drag and its one undo step (history.tag join across turns, undo and redo through wbApplyChanges as the page does it).
 * It runs the module's own code: lib-a, lib-e-*, lib-g and the tool file in one scope. No network, no sleeps.
 * Usage: node modules/whiteboard/test/check-whiteboard-eraser.mjs [path to whiteboard-lib-f-tool-eraser.js]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const file = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src/whiteboard-lib-f-tool-eraser.js'));
const src = path.dirname(file);
let passed = 0;
const fails = [];
const check = (ok, what) => { if (ok) passed += 1; else fails.push(what); };

let lib = {};
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-(a|e)-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  parts.push(fs.readFileSync(path.join(src, 'whiteboard-lib-g-history.js'), 'utf8'));
  parts.push(fs.readFileSync(file, 'utf8'));
  const names = ['wbEraserHits', 'WB_ERASER', 'wbClean', 'blockTypes', 'createHistory', 'wbApplyChanges', 'tools'];
  const grab = names.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  const raf = () => 0;
  lib = new Function('requestAnimationFrame', 'cancelAnimationFrame', `${parts.join('\n')}\nreturn { ${grab} };`)(raf, raf);
} catch (err) {
  fails.push(`the libs do not load: ${err.message}`);
}
const hits = (...a) => lib.wbEraserHits(...a);
const stroke = (id, x, y, points, extra = {}) => ({ id, type: 'stroke', x, y, points, weight: 3, brush: 'pen', stroke: 'ink', ...extra });
const ids = (r) => r.ids.slice().sort().join(',');
const at = (x, y) => ({ x, y });

const cases = {
  'the tool is registered as the Eraser: key e, edits, icon eraser'() {
    const t = lib.tools && lib.tools.get('eraser');
    check(Boolean(t) && t.key === 'e' && t.edits === true && t.icon === 'eraser', 'tools.register({ id: eraser, key e, edits true, icon eraser })');
    check(Boolean(t) && !t.makes && !t.mode && !t.apart, 'the Eraser makes no block and is not a mode or apart');
    check(lib.WB_ERASER && lib.WB_ERASER.cap === 100 && lib.WB_ERASER.diameter === 12, 'the cap is 100 and the circle 12 across');
  },
  'a stroke touched and not touched'() {
    const blocks = [stroke('a', 0, 0, [0, 0, 100, 0]), stroke('b', 0, 50, [0, 0, 100, 0])];
    check(ids(hits(blocks, at(50, 1), at(50, 1), 6)) === 'a', 'a point on the first line hits it alone');
    check(ids(hits(blocks, at(50, 25), at(50, 25), 6)) === '', 'a point between the two lines hits neither');
    check(ids(hits(blocks, at(50, 5), at(50, 5), 1)) === '' && ids(hits(blocks, at(50, 5), at(50, 5), 3.6)) === 'a', 'weight/2 counts: 5 away needs radius 3.5 with a width of 3');
  },
  'the box test comes first and the radius and half width grow it'() {
    const far = stroke('f', 1000, 1000, [0, 0, 10, 10]);
    check(ids(hits([far], at(0, 0), at(5, 5), 6)) === '', 'a box far away is not hit');
    const near = stroke('n', 0, 0, [0, 0, 10, 0], { weight: 10 });
    check(ids(hits([near], at(5, 8), at(5, 8), 4)) === 'n', 'radius 4 plus half width 5 reaches 9 > 8');
    check(ids(hits([near], at(5, 10), at(5, 10), 4)) === '', 'and not 10');
    // the box test must not walk the points: a block whose points getter is a trap is not touched when far
    let walked = 0;
    const trap = stroke('t', 5000, 5000, new Proxy([0, 0, 1, 1], { get(t, k, r) { if (/^\d+$/.test(String(k))) walked += 1; return Reflect.get(t, k, r); } }));
    hits([trap], at(0, 0), at(1, 1), 6);
    const first = walked;
    hits([trap], at(0, 0), at(1, 1), 6);
    check(walked === first, 'the extent is kept: a second far test reads no point');
  },
  'a diagonal pass between two moves crosses a line it never stopped on'() {
    const blocks = [stroke('v', 100, 0, [0, 0, 0, 200])];
    check(ids(hits(blocks, at(0, 100), at(200, 100), 6)) === 'v', 'a fast move across a vertical line hits it');
    check(ids(hits(blocks, at(0, 300), at(200, 300), 6)) === '', 'the same move below the line does not');
    const diag = [stroke('d', 0, 0, [0, 0, 200, 200])];
    check(ids(hits(diag, at(0, 200), at(200, 0), 2)) === 'd', 'two diagonals crossing');
    check(ids(hits(diag, at(10, 0), at(210, 200), 2)) === '', 'two parallel diagonals 7 apart, radius 2');
  },
  'a brush with widths uses the wide part'() {
    const brush = stroke('b', 0, 0, [0, 0, 100, 0], { brush: 'brush', weight: 40, widths: [100, 10] });
    check(ids(hits([brush], at(0, 15), at(0, 15), 2)) === 'b', 'wide end: 15 away, half width 20');
    const narrow = stroke('c', 0, 0, [0, 0, 100, 0, 200, 0], { brush: 'brush', weight: 40, widths: [10, 10, 10] });
    check(ids(hits([narrow], at(100, 15), at(100, 15), 2)) === '', 'all narrow (4 half width): 15 away is missed');
  },
  'a highlight is hit along its band'() {
    const h = { id: 'h', type: 'highlight', x: 0, y: 0, points: [0, 0, 300, 0], weight: 12, stroke: 'gold' };
    check(ids(hits([h], at(150, 4), at(150, 4), 3)) === 'h', 'on the band');
    check(ids(hits([h], at(150, 40), at(150, 40), 3)) === '', 'off the band');
  },
  'locked blocks are skipped and reported'() {
    const blocks = [stroke('l', 0, 0, [0, 0, 100, 0], { locked: true }), stroke('o', 0, 0, [0, 1, 100, 1])];
    const r = hits(blocks, at(50, 0), at(50, 0), 6);
    check(ids(r) === 'o' && r.locked.join() === 'l', 'the locked stroke is not in ids and is in locked');
  },
  'frames, connectors, notes and the rest are never hit, whatever kinds says'() {
    const blocks = [
      { id: 'fr', type: 'frame', x: 0, y: 0, w: 300, h: 300, points: [0, 0, 10, 10] },
      { id: 'cn', type: 'connector', x: 0, y: 0, points: [0, 0, 100, 0], weight: 4 },
      { id: 'nt', type: 'note', x: 0, y: 0, w: 200, h: 200 },
      { id: 'tb', type: 'table', x: 0, y: 0, w: 200, h: 200 },
    ];
    check(ids(hits(blocks, at(5, 5), at(5, 5), 6)) === '', 'default kinds');
    check(ids(hits(blocks, at(5, 5), at(5, 5), 6, ['frame', 'connector', 'note', 'table', 'stroke'])) === '', 'asked for frame, connector, note, table: still none');
  },
  'an empty board and hostile numbers'() {
    check(ids(hits([], at(0, 0), at(1, 1), 6)) === '', 'an empty board');
    for (const bad of [NaN, Infinity, -Infinity, -1, '6', null, undefined]) check(ids(hits([stroke('a', 0, 0, [0, 0, 5, 5])], at(1, 1), at(1, 1), bad)) === '', `radius ${String(bad)} hits nothing`);
    check(ids(hits([stroke('a', 0, 0, [0, 0, 5, 5])], at(NaN, 1), at(1, 1), 6)) === '', 'NaN point hits nothing');
    check(ids(hits([stroke('a', 0, 0, [0, 0, 5, 5])], null, at(1, 1), 6)) === '', 'no from');
    check(ids(hits(null, at(1, 1), at(1, 1), 6)) === '', 'blocks not a list');
    check(ids(hits([null, undefined, {}, { type: 'stroke' }, stroke('x', 0, 0, [0])], at(1, 1), at(1, 1), 6)) === '', 'broken blocks are skipped');
    check(ids(hits([stroke('a', 0, 0, [0, 0, NaN, 5, 5, 5])], at(5, 5), at(5, 5), 2)) === 'a', 'a NaN in the points is skipped, the rest still counts');
    check(ids(hits([stroke('a', 0, 0, [0, 0, 5, 5])], at(1e9, 1e9), at(1e9, 1e9), 1e12)) === '', 'a huge radius is held to its cap');
    check(ids(hits([stroke('a', 0, 0, [0, 0, 5, 5])], at(50000, 50000), at(50000, 50000), 1e12)) === '', 'huge radius, far point: held to its cap');
    check(ids(hits([stroke('a', 0, 0, [0, 0, 5, 5])], at(Number.MAX_VALUE, 0), at(Number.MAX_VALUE, 0), 6)) === '', 'MAX_VALUE point');
  },
  'a 3000-point stroke is bounded work'() {
    const pts = [];
    for (let i = 0; i < 3000; i += 1) pts.push(i, Math.sin(i / 10) * 50);
    const blocks = [stroke('big', 0, 0, pts)];
    let t = Date.now();
    for (let i = 0; i < 200; i += 1) hits(blocks, at(i * 15, 300), at(i * 15 + 10, 300), 6);
    check(Date.now() - t < 1000, `200 far moves over a 3000-point stroke took ${Date.now() - t} ms`);
    t = Date.now();
    const r = hits(blocks, at(1500, 0), at(1510, 10), 6);
    check(ids(r) === 'big' && Date.now() - t < 200, `one near move walks it once (${Date.now() - t} ms)`);
    const many = [];
    for (let i = 0; i < 5000; i += 1) many.push(stroke(`s${i}`, (i % 100) * 40, Math.floor(i / 100) * 40, [0, 0, 20, 20]));
    hits(many, at(0, 0), at(1, 1), 6);
    t = Date.now();
    for (let i = 0; i < 100; i += 1) hits(many, at(2000, 1000), at(2010, 1010), 6);
    check(Date.now() - t < 1000, `100 moves over 5000 strokes took ${Date.now() - t} ms`);
  },
  'a drag is one undo step, redo deletes again, at most 100 go'() {
    const board = new Map();
    const history = lib.createHistory({ cap: 100 });
    const known = new Map();
    let stamp = 0;
    for (let i = 0; i < 130; i += 1) {
      const b = lib.wbClean({ ...stroke(`s${i}`, i * 10, 0, [0, 0, 5, 5]), by: 'a', at: String(stamp += 1) });
      board.set(b.id, b); known.set(b.id, b);
    }
    const erase = (id, tag) => {
      const b = board.get(id);
      if (!b || b.locked) return false;
      history.tag(tag, { join: true });
      history.record(id, known.get(id) || b, null);
      board.delete(id); known.delete(id);
      return true;
    };
    // The tool's own drag, in its words: three moves, each a turn of its own, the cap at 100.
    const turn = () => new Promise((r) => { setImmediate(r); });
    return (async () => {
      const tag = 'erase:test-1';
      let erased = 0;
      let full = false;
      for (const [x0, x1] of [[0, 400], [400, 800], [800, 1300]]) {
        for (const id of hits([...board.values()], at(x0, 2), at(x1, 2), 6).ids) {
          if (erased >= lib.WB_ERASER.cap) { full = true; break; }
          if (erase(id, tag)) erased += 1;
        }
        await turn();
      }
      check(erased === 100 && full && board.size === 30, `100 erased and the 101st refused (erased ${erased}, left ${board.size})`);
      check(history.size === 1, `one undo step for the whole drag (got ${history.size})`);
      const p = {
        get: (id) => board.get(id) || null,
        remove: (id) => { history.record(id, known.get(id) || null, null); board.delete(id); known.delete(id); },
        put: (b) => { const s = { ...b, by: 'a', at: String(stamp += 1) }; history.record(b.id, known.get(b.id) || null, s); board.set(b.id, s); known.set(b.id, s); },
        canChange: () => true, canCreate: () => true, clean: lib.wbClean,
        linkedOf: (b) => { const d = lib.blockTypes.get(b.type); return (d && d.linked) || []; },
      };
      history.undo((list) => lib.wbApplyChanges(list, p));
      check(board.size === 130, `one undo brings all 100 back (board ${board.size})`);
      history.redo((list) => lib.wbApplyChanges(list, p));
      check(board.size === 30, `redo deletes the 100 again (board ${board.size})`);
    })();
  },
};

for (const [name, run] of Object.entries(cases)) {
  try { await run(); } catch (err) { fails.push(`${name}: ${err.message}`); }
}
if (fails.length) {
  for (const f of fails) console.error(`FAIL ${f}`);
  console.error(`check-whiteboard-eraser: ${fails.length} failed, ${passed} passed (${path.relative(root, file)})`);
  process.exit(1);
}
console.log(`check-whiteboard-eraser: OK, ${passed} cases`);
