#!/usr/bin/env node
/*
 * check-whiteboard-fonts.mjs -- the Whiteboard's vertical align (valign) and the strip's fonts group rules.
 * Guards: valign is kept only as top, middle or bottom, and only on the block types that have it (note, shapes, table; not
 * text, frame, connector); a block without it reads as its type's look today (note top, shape middle, table top); a new
 * table has explicit centre and middle; wbFontsShown (which controls the strip's fonts group shows, and Mixed); changing
 * valign on several blocks in one turn is one undo step, and its undo puts back the absent field. No browser, no network.
 * Usage: node modules/whiteboard/test/check-whiteboard-fonts.mjs [path to the module's src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
const NAMES = ['createHistory', 'wbApplyChanges', 'wbClean', 'blockTypes', 'wbValignOf', 'wbFontsShown', 'wbNextWords', 'wbBearsWords', 'wbStripPlan'];
let passed = 0;
const fails = [];
const check = (ok, what) => { if (ok) passed += 1; else fails.push(what); };

let lib = {};
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-(a|e|g)-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  const grab = NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  lib = new Function(`${parts.join('\n')}\nreturn { ${grab} };`)();
} catch (err) {
  fails.push(`the libs do not load: ${err.message}`);
}
const missing = NAMES.filter((n) => typeof lib[n] === 'undefined');
if (missing.length) fails.push(`the libs have no ${missing.join(', ')}`);

if (!missing.length && !fails.length) {
  const { wbClean, blockTypes, wbValignOf, wbFontsShown, wbBearsWords, wbStripPlan } = lib;
  const make = (type, extra = {}) => wbClean({ ...blockTypes.get(type).create(), id: `${type}1`, type, x: 0, y: 0, ...extra });
  const defOf = (b) => blockTypes.get(b.type);

  // clean: valid values only, only where the type has it
  for (const type of ['note', 'rect', 'ellipse', 'table']) {
    check(make(type, { valign: 'bottom' }).valign === 'bottom', `${type}: bottom is kept`);
    check(!('valign' in make(type, { valign: 'sideways' })) && !('valign' in make(type, { valign: 5 })), `${type}: anything else is absent`);
  }
  for (const type of ['text', 'frame']) check(!('valign' in make(type, { valign: 'top' })), `${type}: has no valign`);

  // today's look when absent
  check(wbValignOf(make('note'), defOf(make('note'))) === 'top', 'a note without valign reads as top');
  check(wbValignOf(make('rect'), defOf(make('rect'))) === 'middle', 'a shape without valign reads as middle');
  const old = wbClean({ ...blockTypes.get('table').create(), id: 't', type: 'table', x: 0, y: 0, valign: undefined, align: 'left' });
  check(!('valign' in old) && wbValignOf(old, defOf(old)) === 'top' && old.align === 'left', 'an existing table (no valign, left) reads as top and left');
  check(wbValignOf(make('text'), defOf(make('text'))) === null, 'a text block has none');

  // a new table
  const fresh = make('table');
  check(fresh.align === 'center' && fresh.valign === 'middle', `a new table is centre and middle (got ${fresh.align}, ${fresh.valign})`);

  // the fonts group
  const n1 = make('note');
  const n2 = make('note', { id: 'n2', align: 'right', size: 'huge', valign: 'bottom' });
  const t1 = make('text');
  const pic = make('line', { dx: 10, dy: 0 });
  const both = wbFontsShown([n1, n2], defOf, null);
  check(both.align === undefined && both.size === undefined && both.valign === undefined, 'notes that differ: nothing agreed (Mixed)');
  const one = wbFontsShown([n2], defOf, null);
  check(one.align === 'right' && one.size === 'huge' && one.valign === 'bottom', 'one note: its own size, align and valign');
  check(wbFontsShown([n1], defOf, null).valign === 'top', 'a note without valign shows top pressed');
  check(wbFontsShown([t1], defOf, null).valign === null, 'a text block alone: no vertical align');
  check(wbFontsShown([pic], defOf, null) === null, 'a line alone: no fonts group');
  check(wbFontsShown([t1, n1], defOf, null).valign === 'top', 'text and a note: vertical align is the note\'s');
  check(wbFontsShown([], defOf, null) === null, 'nothing picked, no tool: no group');
  // One pattern for tools: words are borne by notes, text, closed shapes and tables, not strokes, lines, highlights, connectors, frames.
  for (const t of ['note', 'text', 'rect', 'ellipse', 'rounded', 'diamond', 'table']) check(wbBearsWords(blockTypes.get(t)), `${t} bears words`);
  for (const t of ['stroke', 'line', 'highlight', 'connector', 'frame', 'image']) check(!wbBearsWords(blockTypes.get(t)), `${t} bears no words`);
  check(wbFontsShown([], defOf, blockTypes.get('stroke')) === null && wbFontsShown([], defOf, blockTypes.get('line')) === null, 'the Pen and Line tools show no fonts group');
  const plan = (id, makes, extra = {}) => wbStripPlan({ id, ...extra }, makes ? blockTypes.get(makes) : null);
  check(plan('hand', null, { mode: true }) === null && plan('select', null) === null, 'Hand and Select: no strip with nothing picked');
  check(!plan('pen', 'stroke').fonts && plan('pen', 'stroke').colours, 'Pen: colours, no fonts');
  check(plan('text', 'text').fonts && plan('note', 'note').fonts && plan('table', 'table').fonts && plan('rect', 'rect').fonts, 'Text, Note, Table, Rectangle: fonts');
  check(!plan('arrow', 'line').fonts && !plan('highlight', 'highlight').fonts, 'Arrow and Highlighter: no fonts');
  check(plan('connector', 'connector').line && !plan('rect', 'rect').line, 'Connector: line group, Rectangle: none');
  check(plan('frame', 'frame').present && !plan('frame', 'frame').fonts && !plan('note', 'note').present, 'Frame: Present, no fonts');
  check(!plan('fill', null).fonts && plan('fill', null).colours, 'Fill: colours only');
  const shapeTool = wbFontsShown([], defOf, blockTypes.get('rect'), { align: 'right' });
  check(shapeTool.valign === null && shapeTool.align === 'right' && shapeTool.size === 'medium', 'a shape tool shows size and align of a new shape, no vertical');
  check(wbFontsShown([], defOf, blockTypes.get('text'), {}).valign === null, 'the Text tool: size and align, no vertical');

  // a new table ignores a remembered align; other types take it
  const next = { size: 'huge', align: 'right' };
  check(!('align' in lib.wbNextWords(blockTypes.get('table'), next)) && lib.wbNextWords(blockTypes.get('table'), next).size === 'huge', 'a new table takes no remembered align (size yes)');
  check(lib.wbNextWords(blockTypes.get('note'), next).align === 'right', 'a new note takes the remembered align');
  check(wbFontsShown([], defOf, blockTypes.get('table'), next).align === 'center', 'the Table tool shows centre whatever was remembered');

  // one history step, field-wise undo
  const history = lib.createHistory({ cap: 50 });
  const board = new Map([['a', make('note', { id: 'a' })], ['b', make('rect', { id: 'b' })]]);
  const set = (id, patch) => { const now = board.get(id); const next = wbClean({ ...now, ...patch }); history.record(id, now, next); board.set(id, next); };
  set('a', { valign: 'bottom' });
  set('b', { valign: 'top' });
  await new Promise((r) => { setImmediate(r); });
  check(board.get('a').valign === 'bottom' && board.get('b').valign === 'top', 'both blocks changed');
  const apply = (list) => lib.wbApplyChanges(list, {
    get: (id) => board.get(id) || null,
    remove: (id) => board.delete(id),
    put: (b) => { history.record(b.id, board.get(b.id) || null, b); board.set(b.id, b); },
    canChange: () => true,
    canCreate: () => true,
    clean: wbClean,
    linkedOf: (b) => (blockTypes.get(b.type) || {}).linked || [],
  });
  history.undo(apply);
  check(!('valign' in board.get('a')) && !('valign' in board.get('b')), 'one undo puts both back to absent');
  check(!history.canUndo(), 'that was one step');
  history.redo(apply);
  check(board.get('a').valign === 'bottom' && board.get('b').valign === 'top', 'redo sets both again');
}

if (fails.length) {
  console.error(`check-whiteboard-fonts: ${fails.length} failed, ${passed} passed`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-whiteboard-fonts: ${passed} checks passed`);
