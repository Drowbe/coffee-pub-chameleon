#!/usr/bin/env node
/*
 * check-whiteboard-escape-key.mjs -- which Escape goes where (whiteboard-lib-t-escape-key.js) and that the page uses it.
 * Guards: wbEscapeRoute for every place a key can start (board, text edit, popup, bars, outside) with and without
 * present mode and a handled key; wbFocusBoardAfterChange (a mouse pick gives the board the focus, a keyboard one does not);
 * and in whiteboard.js: the frame's handler is on the frame element (never the document), the board's Escape and the frame's
 * share escapeToSelect, and a tool picked by the mouse calls boardAfterPointer.
 * Usage: node modules/whiteboard/test/check-whiteboard-escape-key.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.join(root, 'modules/whiteboard/src');
let passed = 0;
const fails = [];
const check = (ok, what) => { if (ok) passed += 1; else fails.push(what); };

const lib = new Function(`${fs.readFileSync(path.join(src, 'whiteboard-lib-t-escape-key.js'), 'utf8')}\nreturn { wbEscapeRoute, wbFocusBoardAfterChange };`)();
const r = (o) => lib.wbEscapeRoute(o);
check(r({ from: 'board' }) === 'board', 'on the board: the board handles it');
check(r({ from: 'bars' }) === 'select', 'on the toolbar or title bar: back to Select');
check(r({ from: 'edit' }) === 'none', 'in a text edit: its own');
check(r({ from: 'popup' }) === 'none', 'in a menu, dialog or panel: its own');
check(r({ from: 'other' }) === 'none' && r({}) === 'none' && r() === 'none' && r({ from: 'document' }) === 'none', 'anywhere else, or nothing said: not ours');
for (const from of ['board', 'bars', 'edit', 'popup', 'other']) {
  check(r({ from, presenting: true }) === 'none', `${from}: present mode keeps its own Escape`);
  check(r({ from, handled: true }) === 'none', `${from}: a key already handled is left alone`);
}
const f = lib.wbFocusBoardAfterChange;
check(f(1000, 1100) === true && f(1000, 1700) === true, 'a pick right after a press: the board takes the focus');
check(f(1000, 1701) === false && f(-Infinity, 5) === false, 'a pick long after a press, or none: the focus stays (a keyboard pick)');
check(f(2000, 1000) === false && f(undefined, 1) === false && f(1, undefined) === false && f('1', 2) === false, 'bad input: no');

const js = fs.readFileSync(path.join(src, 'whiteboard.js'), 'utf8');
check(/const frameEl = \(host\.rootElement\.closest && host\.rootElement\.closest\('\.mf'\)\) \|\| host\.rootElement;/.test(js), 'the frame element is the module frame (.mf) or the module\'s own element');
check(/frameEl\.addEventListener\('keydown'/.test(js) && !/document\.addEventListener\('keydown', \(e\) => \{\s*if \(e\.key !== 'Escape'/.test(js), 'the frame handler is on the frame, not the document');
check(/wbEscapeRoute\(\{ from, handled: e\.defaultPrevented, presenting: Boolean\(presenting\) \}\) !== 'select'/.test(js), 'the frame handler asks wbEscapeRoute');
check(/if \(k === 'Escape'\) \{ escapeToSelect\(\); return; \}/.test(js) && /function escapeToSelect\(\) \{\s*select\(null\);/.test(js), 'the board and the frame share escapeToSelect');
check((js.match(/boardAfterPointer\(\)/g) || []).length >= 2, 'the Tools switch and the apart buttons give the board the focus after a mouse pick');

if (fails.length) { console.error(`check-whiteboard-escape-key: ${fails.length} failed\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log(`check-whiteboard-escape-key: ${passed} checks passed`);
