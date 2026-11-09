#!/usr/bin/env node
/*
 * check-module.mjs -- the checks for a change confined to one bundled module (the "module lane").
 *
 *   npm run check:module -- <id>        (node tools/check-module.mjs <id>)
 *
 * <id> must be a bundled module: a folder modules/<id>/ with a module.json. Otherwise it says so and exits 2.
 * Each check runs on its own, one after another, in its own `node` process; every result is printed, then the total time.
 * Exit 0 when all pass, 1 when any fails. (As root in a container, check-names fails its two --migration read-only cases; that is not a defect.) A check that needs Chromium says SKIPPED and passes when there is none (as in `npm run check`).
 *
 * THE SET, in the order it runs
 *
 *  1. The core lint that reads module sources (a few seconds in all; no browser, no server except where noted):
 *       check-syntax            every modules/*\/src script, page and stylesheet parses; the build's splice of a module page runs
 *       check-module-versions   a changed module has a bumped version (tools/module-versions.json)
 *       check-modules           the manifest rules every module.json meets; every bundled module's zip is made without its test/
 *       check-module-host       the pointer shape modules and the host agree on
 *       check-module-guards     each module's guards and permissions, against the server's real routes (starts a throwaway server)
 *       check-module-layout     a module lays out its own content and draws none of the shared window
 *       check-no-raw-colours    no hard-coded colour in modules/*\/src
 *       check-names             the level and role names, and the words, in modules/*\/src and module.json
 *       check-spacing           off-scale spacing in modules/*\/src
 *       check-radius            corner radii in modules/*\/src
 *       check-type-scale        off-scale type sizes in modules/*\/src
 *       check-icons             icon styles and sizes in modules/*\/src
 *       check-system-css        the shared tokens are not redefined in a module stylesheet
 *       check-sources-modules   a change inside modules/<id>/ leaves public/design-system/sources.js unchanged
 *  2. That module's own tests: modules/<id>/test/*.mjs (tools/check-module-tests.mjs <id>).
 *  3. Its older checks in tools/, matched by file name: tools/check-<id>.mjs and tools/check-<id>-*.mjs, plus the ALSO table below
 *     for the modules whose check is named for something else. HELPERS lists the files that match but are not checks.
 *
 * WHY THE REST CANNOT BE AFFECTED by a change confined to modules/<id>/ (src/, test/, module.json, design/, notes)
 *
 *  - Every other check reads server/, public/, templates/, documentation/ or tools/ only: the server's routes and stores, the
 *    pages and the SDK, the themes, the auth rules, the documentation. A module is installed by the server as a zip and talks to
 *    the host only through host.* (the SDK); nothing in the server or the pages reads a module's files, except the checks above and
 *    those matched in step 3 (check-modules, check-module-guards, check-travel...).
 *  - The generated public/design-system/sources.js no longer holds anything from modules/ (check-sources-modules proves it), so
 *    check-prototype-parity's comparison of that file cannot change with a module. The Design System pages read the modules'
 *    stylesheets and icons at run time (/design-system/module-sources.js).
 *  - Left out on purpose, because they drive a browser over the whole product (minutes each) and read no module file except
 *    through the running product: check-design-system, check-prototype-parity (its Travel template comparison reads
 *    modules/travel/src/travel.html; run it by hand after a change to the Itinerary's cards), check-titles-ink, check-conformance,
 *    check-canvas, check-narrow, check-touch, check-theme-contrast and the like. Any module whose own checks (step 3) drive a browser
 *    stay in the set; they say SKIPPED with no Chromium.
 *  - Not module-scoped but still worth running when the module is used by the rest of the product: the server-side checks that
 *    start a throwaway server with the bundled modules (check-seed-demo, check-templates). They read module.json through the
 *    server's cleaning (check-modules covers that rule) and do not read src/.
 *
 * Adding a module's own check: put a node script in modules/<id>/test/<name>.mjs (exit 0/1). It is in this lane and in `npm run check`
 * with no other change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runModuleTests } from './check-module-tests.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = Number(process.env.MODULE_CHECK_TIMEOUT_MS) || 600000;

const CORE = ['syntax', 'module-versions', 'modules', 'module-host', 'module-guards', 'module-layout', 'no-raw-colours', 'names', 'spacing', 'radius', 'type-scale', 'icons', 'system-css', 'sources-modules'];
// Modules whose older check is not named for the module id.
const ALSO = {
  stream: ['check-streams.mjs'],
  todo: ['check-calendar-todo.mjs'],
  travel: ['check-calendar-twins.mjs'],
};
// Files that match a module's name but are helpers another check imports, not checks.
const HELPERS = new Set(['check-vault-viewer-cases.mjs']);

export function legacyChecks(id) {
  const names = fs.readdirSync(path.join(ROOT, 'tools')).filter((f) => f === `check-${id}.mjs` || (f.startsWith(`check-${id}-`) && f.endsWith('.mjs')));
  return [...new Set([...names, ...(ALSO[id] || [])])].filter((f) => !HELPERS.has(f) && fs.existsSync(path.join(ROOT, 'tools', f))).sort();
}

const id = process.argv[2];
if (!id) { console.error('usage: npm run check:module -- <module id>   (a folder under modules/ with a module.json)'); process.exit(2); }
if (!/^[a-z][a-z0-9-]{1,31}$/.test(id) || !fs.existsSync(path.join(ROOT, 'modules', id, 'module.json'))) {
  const have = fs.readdirSync(path.join(ROOT, 'modules'), { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(ROOT, 'modules', e.name, 'module.json'))).map((e) => e.name);
  console.error(`check-module: "${id}" is not a bundled module; use one of: ${have.join(', ')}.`);
  process.exit(2);
}

const t0 = Date.now();
const results = [];
const run = (label, file) => {
  const s = Date.now();
  const r = spawnSync(process.execPath, [path.join('tools', file)], { cwd: ROOT, encoding: 'utf8', timeout: LIMIT, maxBuffer: 64 * 1024 * 1024 });
  const secs = (Date.now() - s) / 1000;
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  const ok = r.status === 0;
  results.push({ label, ok, secs });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} (${secs.toFixed(1)} s)${ok ? `: ${out.split('\n').pop()}` : ''}`);
  if (!ok) console.error(out.split('\n').map((l) => `  ${l}`).join('\n'));
};

console.log(`check-module: ${id}`);
for (const c of CORE) run(`check-${c}`, `check-${c}.mjs`);
const legacy = legacyChecks(id);
for (const f of legacy) run(f.replace(/\.mjs$/, ''), f);
const s = Date.now();
const tests = runModuleTests([id]);
if (tests.count) results.push({ label: `modules/${id}/test (${tests.count})`, ok: !tests.failed, secs: (Date.now() - s) / 1000 });
else console.log(`none  modules/${id}/test/*.mjs (this module has no tests of its own yet)`);

const failed = results.filter((r) => !r.ok);
const total = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`check-module: ${id}: ${results.length - failed.length} of ${results.length} passed in ${total} s (core ${CORE.length}, tools/ ${legacy.length}${legacy.length ? `: ${legacy.join(', ')}` : ''}, module tests ${tests.count})`);
if (failed.length) { console.error(`check-module: failed: ${failed.map((r) => r.label).join(', ')}`); process.exit(1); }
