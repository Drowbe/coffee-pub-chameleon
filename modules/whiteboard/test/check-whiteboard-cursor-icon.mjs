#!/usr/bin/env node
/*
 * check-whiteboard-cursor-icon.mjs -- the tool icon beside the mouse pointer (whiteboard-lib-t-cursor-icon.js).
 * Guards: wbToolCursorIcon for every tool the registry holds (a new tool without a decision fails), the null cases
 * (Select, Hand, Eraser, cannot edit, presenting), and the CSS: moved by transform, no left/top change, no raw colours.
 * Usage: node modules/whiteboard/test/check-whiteboard-cursor-icon.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.join(root, 'modules/whiteboard/src');
let passed = 0;
const fails = [];
const check = (ok, what) => { if (ok) passed += 1; else fails.push(what); };

const files = fs.readdirSync(src).filter((f) => /^whiteboard-lib-(a|f|t)-.*\.js$/.test(f)).sort();
const code = files.map((f) => fs.readFileSync(path.join(src, f), 'utf8')).join('\n');
const lib = new Function(`${code}\nreturn { tools, wbToolCursorIcon };`)();
const edit = { canEdit: true, presenting: false };
const none = new Set(['select', 'hand', 'eraser']);
const list = lib.tools.list();
check(list.length >= 20, `the registry holds the tools (${list.length})`);
for (const t of list) {
  const got = lib.wbToolCursorIcon(t.id, t.icon, edit);
  if (none.has(t.id)) check(got === null, `${t.id}: no icon`);
  else check(got === t.icon && typeof got === 'string', `${t.id}: icon ${t.icon}`);
  check(lib.wbToolCursorIcon(t.id, t.icon, { canEdit: false, presenting: false }) === null, `${t.id}: none when the person cannot edit`);
  check(lib.wbToolCursorIcon(t.id, t.icon, { canEdit: true, presenting: true }) === null, `${t.id}: none while presenting`);
}
for (const id of ['pen', 'marker', 'brush', 'highlight', 'rect', 'ellipse', 'line', 'arrow', 'connector', 'rounded', 'diamond', 'pill', 'parallelogram', 'fill', 'text', 'note', 'table', 'frame']) {
  check(list.some((t) => t.id === id), `${id} is registered`);
}
check(lib.wbToolCursorIcon('x', '', edit) === null && lib.wbToolCursorIcon('', 'pen', edit) === null && lib.wbToolCursorIcon('pen', 'pen', null) === null, 'bad input gives null');

const css = fs.readFileSync(path.join(src, 'whiteboard.css'), 'utf8');
const m = css.match(/\.wb-tool-cursor \{[^}]*\}/);
check(Boolean(m), 'the .wb-tool-cursor rule exists');
const rule = m ? m[0] : '';
check(/will-change: transform/.test(rule) && /contain: layout style/.test(rule) && /pointer-events: none/.test(rule), 'moved by transform, contained, no pointer events');
check(/left: 0;/.test(rule) && /top: 0;/.test(rule) && !/transition/.test(rule), 'left/top fixed at 0, never animated');
check(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(rule), 'no raw colours');
check(/var\(--text-primary\)/.test(rule) && /var\(--surface-card\)/.test(rule), 'theme tokens');
const js = fs.readFileSync(path.join(src, 'whiteboard-lib-d-render.js'), 'utf8');
const fn = js.slice(js.indexOf('function cursorIcon'), js.indexOf('let ringEl'));
check(/translate3d/.test(fn) && !/style\.(left|top)\b/.test(fn), 'cursorIcon moves by transform, not left/top');

if (fails.length) { console.error(`check-whiteboard-cursor-icon: ${fails.length} failed\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log(`check-whiteboard-cursor-icon: ${passed} checks passed`);
