#!/usr/bin/env node
// Proves what the drift guards leave out is only what they should (tools/lib/drift.mjs):
//   - no page is left out: the start page (public/start.css) fails those checks like any other file;
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
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(root, rel), text);
  const r = spawnSync(process.execPath, [path.join(tools, `${check}.mjs`)], { env: { ...process.env, DRIFT_ROOT: root, DRIFT_ALLOW_DIR: allowDir }, encoding: 'utf8' });
  return { ok: r.status === 0, out: r.stdout + r.stderr };
}

for (const check of ['check-no-raw-colours', 'check-type-scale', 'check-breakpoints', 'check-spacing']) {
  for (const file of ['public/start.css', 'public/other.css']) assert.ok(!run(check, { [file]: BAD }).ok, `${check}: ${file} is read like any other file`);
}

const FACE = '@font-face { font-family: "F"; font-weight: 100 900; src: local("Arial"); }\n@font-face { font-family: "G"; font-weight: 300; src: local("Arial"); }\n';
assert.ok(run('check-type-scale', { 'public/sdk/system.css': FACE }).ok, 'font-weight inside @font-face is not read');
const real = run('check-type-scale', { 'public/sdk/system.css': `${FACE}.x { font-weight: 300; }\n` });
assert.ok(!real.ok && /weight 300/.test(real.out), `a real font-weight 300 outside @font-face still fails\n${real.out}`);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('check-drift-scope: OK (no page is left out; @font-face ignored; planted offenders fail)');
