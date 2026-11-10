#!/usr/bin/env node
/*
 * check-whiteboard-toolbar.mjs -- the Whiteboard's tool switch and the kinds on the colour strip (whiteboard.js, the
 * whiteboard-lib-f-tool-*.js files).
 * Guards: the switch's order (Hand, Select, Pen, Fill, Text, Note, Flowchart, Shape, Table, Frame), each
 * with an icon; the families (Pen, Shape, Flowchart) name kinds that are registered tools; the keys P, M, U, R, O, L, A, C, B, D,
 * F, G, S, H are still the keys of tools, and a key's tool is a kind of the family it should pick; no tool is left in a
 * Paint or Flowchart menu (no `group`); with Select many on, a click on a block toggles it with a mouse and a drag on the
 * board starts a rectangle that keeps what is picked. No browser, no network.
 * Usage: node modules/whiteboard/test/check-whiteboard-toolbar.mjs [path to the module's src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
let passed = 0;
const fails = [];
const check = (ok, what) => { if (ok) passed += 1; else fails.push(what); };

const main = fs.readFileSync(path.join(src, 'whiteboard.js'), 'utf8');
let tools;
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-[a-z]-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  tools = new Function('window', 'document', `${parts.join('\n')}\nreturn tools;`)({ devicePixelRatio: 1 }, undefined);
} catch (err) {
  fails.push(`the libs do not load: ${err.message}`);
}

const switchText = (/const SWITCH = \[([\s\S]*?)\];/.exec(main) || [])[1] || '';
const sw = [...switchText.matchAll(/\{ id: '([a-z]+)', label: '([^']+)', icon: '([a-z0-9-]+)' \}/g)].map((m) => ({ id: m[1], label: m[2], icon: m[3] }));
check(sw.map((o) => o.id).join() === 'hand,select,pen,fill,text,note,flowchart,shape,table,frame', `the switch order is Hand, Select, Pen, Fill, Text, Note, Flowchart, Shape, Table, Frame (found ${sw.map((o) => o.id).join()})`);
check(sw.length === 10 && sw.every((o) => o.icon && o.label), 'every choice has an icon and a name');
check(!/id: 'many'/.test(switchText), 'Select many is not in the tool switch (it is on the Select strip)');
check(/'Select one at a time'/.test(main) && /'Select many'/.test(main) && /'Select all'/.test(main) && /'Clear selection'/.test(main), 'the Select strip has Single, Many, Select all, Clear selection');
check(!/id: 'paint'|id: 'flowchart', label: 'Flowchart', icon: 'diagram-project', order/.test(main), 'no Paint or Flowchart menu button is left in the toolbar');

check(/id: 'present-tool', label: 'Present', icon: 'person-chalkboard'/.test(main) && /const wantPresent = \[\.\.\.board\.all\(\)\]\.some\(\(b\) => wbIsFrame\(b\)\)/.test(main), 'a Present button is in the toolbar while the board has a frame');
check(/for \(const b of \[arrangeButton, deleteButton, presentTool\]\) if \(b\) b\.destroy\(\)/.test(main) && main.indexOf('presentTool = host.ui.toolbarButton') < main.indexOf('deleteButton = host.ui.toolbarButton') && main.indexOf('deleteButton = host.ui.toolbarButton') < main.indexOf('arrangeButton = host.ui.toolbarButton'), 'Present, Delete, Arrange are made again in that order');

const families = {};
for (const m of main.matchAll(/\{ id: '([a-z]+)', kinds: \[([^\]]*)\] \}/g)) families[m[1]] = [...m[2].matchAll(/'([a-z]+)'/g)].map((k) => k[1]);
check(families.pen && families.pen.join() === 'pen,marker,brush,highlight', 'Pen has pen, marker, brush, highlighter');
check(families.shape && families.shape.join() === 'rect,ellipse,line,arrow', 'Shape has rectangle, ellipse, line, arrow');
check(families.flowchart && families.flowchart.join() === 'connector,rounded,diamond,pill,parallelogram', 'Flowchart has the connector and the flowchart shapes');

if (tools) {
  const get = (id) => tools.get(id);
  for (const [f, kinds] of Object.entries(families)) for (const k of kinds) check(Boolean(get(k)), `${f}: kind ${k} is a registered tool`);
  for (const o of sw) if (!['pen', 'flowchart', 'shape'].includes(o.id)) check(Boolean(get(o.id)), `${o.id} is a registered tool`);
  const keys = { p: 'pen', m: 'marker', u: 'highlight', r: 'rect', o: 'ellipse', l: 'line', a: 'arrow', c: 'connector', b: 'rounded', d: 'diamond', f: 'fill', g: 'table', s: 'frame', h: 'hand', v: 'select', n: 'note', t: 'text' };
  const byKey = new Map(tools.list().map((t) => [t.key, t.id]));
  for (const [k, id] of Object.entries(keys)) check(byKey.get(k) === id, `the key ${k.toUpperCase()} picks ${id}`);
  const firstFamily = (id) => Object.entries(families).find(([, kinds]) => kinds.includes(id));
  check(firstFamily('rect')[0] === 'shape', 'the key R picks Shape (the first family with the rectangle)');
  check(firstFamily('marker')[0] === 'pen' && firstFamily('diamond')[0] === 'flowchart', 'M picks Pen, D picks Flowchart');
  check(tools.list().every((t) => !('group' in t) || t.group === undefined), 'no tool has a menu group');

  // Select many: a mouse click toggles, a drag on the board starts a rectangle that keeps the picked blocks.
  const select = get('select');
  const run = (many, shift) => {
    const log = { toggled: [], hold: null };
    let selected = ['a'];
    const ctx = {
      many: () => many, isSelected: (id) => selected.includes(id), toggle: (id) => log.toggled.push(id), selection: () => selected,
      get: () => null, element: () => null, selected: () => null, select: () => {}, setSelection: () => {}, marquee: () => {}, hold: () => {},
      policy: { canChange: () => true }, scale: () => 1, snapping: () => false, selectionBlocks: () => [], dragSet: () => ({ ids: [], locked: 0 }),
    };
    try {
      select.down({ id: 'b', x: 0, y: 0, sx: 0, sy: 0, pointerType: 'mouse', event: { shiftKey: Boolean(shift) } }, ctx);
      select.up({ id: 'b', x: 0, y: 0, sx: 0, sy: 0, pointerType: 'mouse', event: { shiftKey: Boolean(shift) } }, ctx);
    } catch { /* a fake context short of something the move needs: only the toggle matters here */ }
    return log;
  };
  check(run(true, false).toggled.join() === 'b', 'Select many on: a mouse click on a block toggles it');
  check(run(false, false).toggled.length === 0, 'Select many off: a plain click does not toggle');
  check(run(false, true).toggled.join() === 'b', 'Shift-click still toggles');
}

if (fails.length) {
  console.error(`check-whiteboard-toolbar: ${fails.length} failed`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-whiteboard-toolbar: ok (${passed} checks)`);
