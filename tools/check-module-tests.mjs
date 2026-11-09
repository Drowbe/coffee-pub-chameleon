#!/usr/bin/env node
/*
 * check-module-tests.mjs -- run every bundled module's own checks.
 *
 * The convention: a module keeps its own checks in modules/<id>/test/*.mjs, node scripts that exit 0 when they pass and 1 when they
 * fail, like tools/check-*.mjs. This finds every modules/<id>/test/*.mjs, runs each on its own, one after another, in its own `node`
 * process (cwd the repository root) with a time limit, prints each result and exits 1 if any failed. With none, it says so in one
 * line and exits 0. It is in `npm run check` once, so a new module test needs no new line in package.json.
 *
 * A test/ folder is not module code: it is not in the module's zip (server/module-build.js builds from module.json and src/ only),
 * not in the version fingerprint (tools/check-module-versions.mjs) and not scanned as shipped source by the style checks.
 *
 *   node tools/check-module-tests.mjs                 every module
 *   node tools/check-module-tests.mjs <id>            one module (used by tools/check-module.mjs)
 *   MODULE_TEST_TIMEOUT_MS=60000                      the limit for one test file (default 120000)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = Number(process.env.MODULE_TEST_TIMEOUT_MS) || 120000;
const only = process.argv[2] || null;

export function moduleTests(id) {
  const dir = path.join(ROOT, 'modules', id, 'test');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.mjs')).map((e) => `modules/${id}/test/${e.name}`).sort();
}

export function runModuleTests(ids) {
  const files = ids.flatMap(moduleTests);
  let failed = 0;
  for (const f of files) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [f], { cwd: ROOT, encoding: 'utf8', timeout: LIMIT, maxBuffer: 64 * 1024 * 1024 });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
    if (r.status === 0) {
      console.log(`ok   ${f} (${secs} s)${out ? `: ${out.split('\n').pop()}` : ''}`);
    } else {
      failed += 1;
      const why = r.error && r.error.code === 'ETIMEDOUT' ? `took longer than ${LIMIT / 1000} s` : `exited ${r.status === null ? r.signal : r.status}`;
      console.error(`FAIL ${f} (${secs} s): ${why}${out ? `\n${out.split('\n').map((l) => `  ${l}`).join('\n')}` : ''}`);
    }
  }
  return { count: files.length, failed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const all = fs.readdirSync(path.join(ROOT, 'modules'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  if (only && !all.includes(only)) { console.error(`check-module-tests: there is no folder modules/${only}.`); process.exit(2); }
  const { count, failed } = runModuleTests(only ? [only] : all);
  if (!count) { console.log(`check-module-tests: no module tests (modules/${only || '*'}/test/*.mjs)`); process.exit(0); }
  if (failed) { console.error(`check-module-tests: ${failed} of ${count} failed`); process.exit(1); }
  console.log(`check-module-tests: OK (${count} test${count === 1 ? '' : 's'})`);
}
