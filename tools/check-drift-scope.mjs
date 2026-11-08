#!/usr/bin/env node
// Proves what the drift guards leave out is only what they should (tools/lib/drift.mjs):
//   - no page is left out: the start page (public/start.css) fails those checks like any other file; its one allowance is the raw colours in its
//     own :root blocks (the studio's palette, light and dark), nothing else in the file and no other file;
//   - an @font-face block (weight ranges such as 100 900) is not read, but a real font-weight 300 elsewhere still fails.
// Each case runs the real check on a throwaway tree (DRIFT_ROOT) with an empty allow-list (DRIFT_ALLOW_DIR).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tools = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-scope-'));
const allowDir = path.join(tmp, 'allow');
fs.mkdirSync(allowDir);
for (const n of ['check-no-raw-colours', 'check-type-scale', 'check-breakpoints', 'check-spacing']) {
  fs.writeFileSync(path.join(allowDir, `${n}-allow.json`), '{"about":"test","counts":{}}\n');
}

const BAD = '.a { color: #123456; font-size: 15px; font-weight: 300; padding: 7px; }\n@media (max-width: 500px) { .a { margin: 0; } }\n';
function run(check, files) {
  const root = fs.mkdtempSync(path.join(tmp, 'tree-'));
  fs.mkdirSync(path.join(root, 'public', 'sdk'), { recursive: true });
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); }
  const r = spawnSync(process.execPath, [path.join(tools, `${check}.mjs`)], { env: { ...process.env, DRIFT_ROOT: root, DRIFT_ALLOW_DIR: allowDir }, encoding: 'utf8' });
  return { ok: r.status === 0, out: r.stdout + r.stderr };
}

for (const check of ['check-no-raw-colours', 'check-type-scale', 'check-breakpoints', 'check-spacing']) {
  for (const file of ['public/start.css', 'public/other.css']) assert.ok(!run(check, { [file]: BAD }).ok, `${check}: ${file} is read like any other file`);
}

// The start page's palette: raw colours in start.css's :root blocks (also the browser's dark in a media query) pass; the same colour in a rule, or in another file's :root, fails.
const PALETTE = ':root { --sp-bg: #FBF6EC; }\n:root[data-theme-mode="dark"] { --sp-bg: #0E1A2B; }\n@media (prefers-color-scheme: dark) { :root:not([data-theme-mode="light"]) { --sp-bg: #0E1A2B; } }\n';
assert.ok(run('check-no-raw-colours', { 'public/start.css': PALETTE }).ok, 'the start page\'s palette blocks are allowed');
assert.ok(!run('check-no-raw-colours', { 'public/start.css': `${PALETTE}.a { color: #123456; }\n` }).ok, 'a raw colour in a start.css rule still fails');
assert.ok(!run('check-no-raw-colours', { 'public/other.css': PALETTE }).ok, 'the same blocks in another file still fail');

// The Whiteboard keeps a block's palette name as data ({ fill: 'gold' }). That is allowed only in modules/whiteboard/src/, only for a name
// in its WB_PALETTE table; every other file and every other colour is read as always.
const WB_CORE = "const WB_PALETTE = [\n  { id: 'ink', token: 'var(--text-primary)' },\n  { id: 'gold', token: 'var(--tint-gold)' },\n];\n";
const WB = (rel, body) => ({ 'modules/whiteboard/src/whiteboard-lib-a-core.js': WB_CORE, [rel]: body });
const wbOk = (body) => run('check-no-raw-colours', WB('modules/whiteboard/src/whiteboard-lib-e-block-note.js', body)).ok;
for (const [where, rel] of [['public/', 'public/page.js'], ['another module', 'modules/other/src/other.js']]) {
  for (const body of ["const a = { color: 'red' };\n", "const a = { fill: 'gold' };\n", "const a = { background: 'white' };\n"]) {
    const r = run('check-no-raw-colours', WB(rel, body));
    assert.ok(!r.ok, `${body.trim()} in ${where} still fails`);
  }
}
assert.ok(wbOk("const a = { fill: 'gold' };\n"), 'a name from the Whiteboard palette, as data in the Whiteboard source, passes');
assert.ok(!wbOk("const a = { fill: 'tomato' };\n"), 'a name not in the Whiteboard palette fails in the Whiteboard source');
assert.ok(!wbOk("const a = { fill: '#ffd24a' };\n"), 'a hex in the Whiteboard source fails');
assert.ok(!wbOk("el.style.fill = 'gold';\n"), 'an assignment of a palette name in the Whiteboard source fails');
assert.ok(!wbOk("const a = { border: '1px solid gold' };\n"), 'a name inside a longer value fails');
const noTable = run('check-no-raw-colours', { 'modules/whiteboard/src/whiteboard.js': "const a = { fill: 'gold' };\n" });
assert.ok(!noTable.ok && /WB_PALETTE/.test(noTable.out), 'the Whiteboard source without its palette table fails clearly');

const FACE = '@font-face { font-family: "F"; font-weight: 100 900; src: local("Arial"); }\n@font-face { font-family: "G"; font-weight: 300; src: local("Arial"); }\n';
assert.ok(run('check-type-scale', { 'public/sdk/system.css': FACE }).ok, 'font-weight inside @font-face is not read');
const real = run('check-type-scale', { 'public/sdk/system.css': `${FACE}.x { font-weight: 300; }\n` });
assert.ok(!real.ok && /weight 300/.test(real.out), `a real font-weight 300 outside @font-face still fails\n${real.out}`);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('check-drift-scope: OK (no page is left out; @font-face ignored; planted offenders fail)');
