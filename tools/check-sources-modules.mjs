#!/usr/bin/env node
/*
 * check-sources-modules.mjs -- a change inside modules/<id>/ must not change public/design-system/sources.js.
 *
 * That file is committed and generated (node tools/design-system-snapshot.mjs --sources); if it depended on module sources, every
 * module change would make it stale and unrelated pull requests would conflict on it. The Design System pages get the modules'
 * stylesheets and icons from module-sources.js at run time instead (server/design-system-modules.js).
 *
 * Runs the generator in a scratch copy of the repository (public/ without design-system/, server/, modules/, the generator),
 * before and after changing modules there: a new icon in a module page, a new rule in a module stylesheet, an edited
 * module.json and a whole new module. The output must be identical. As a control, a new icon in public/ must change it.
 * Also fails when the committed file holds a module's text.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import vm from 'node:vm';
import { createRequire } from 'node:module';
let failed = 0;
const fail = (m) => { failed += 1; console.error(`check-sources-modules: FAIL ${m}`); };

// The run-time script the pages load after sources.js: it must run, and add every module's stylesheets and the modules' icons.
try {
  const { moduleSourcesJs } = createRequire(import.meta.url)('../server/design-system-modules.js');
  const ctx = { window: {} }; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'design-system', 'sources.js'), 'utf8'), ctx);
  const base = ctx.window.DS_SOURCES.icons.length;
  vm.runInContext(moduleSourcesJs(ROOT, path.dirname(createRequire(import.meta.url).resolve('@fortawesome/fontawesome-free/package.json'))), ctx);
  const S = ctx.window.DS_SOURCES;
  if (!S.modules || !S.modules.travel || !S.modules.travel.files.some((f) => f.page)) fail('module-sources.js does not add the Itinerary\'s stylesheets (the Prototype page needs them)');
  if (S.icons.length < base) fail('module-sources.js lost icons');
  if (S.icons.some((i) => !S.svgs[i.name])) fail('an icon in the list has no drawing in svgs');
} catch (err) { fail(`module-sources.js does not run: ${err.message}`); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-sources-modules-'));
try {
  const cp = (rel, filter) => fs.cpSync(path.join(ROOT, rel), path.join(tmp, rel), { recursive: true, filter });
  cp('public', (src) => path.relative(path.join(ROOT, 'public'), src).split(path.sep)[0] !== 'design-system');
  fs.mkdirSync(path.join(tmp, 'public', 'design-system'), { recursive: true });
  cp('server'); cp('modules', (src) => !/[\\/]dist([\\/]|$)/.test(src));
  fs.mkdirSync(path.join(tmp, 'tools'));
  fs.copyFileSync(path.join(ROOT, 'tools', 'design-system-snapshot.mjs'), path.join(tmp, 'tools', 'design-system-snapshot.mjs'));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'));
  fs.writeFileSync(path.join(tmp, 'package.json'), fs.readFileSync(path.join(ROOT, 'package.json')));

  const generate = () => {
    const r = spawnSync(process.execPath, ['tools/design-system-snapshot.mjs', '--sources'], { cwd: tmp, encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0) { fail(`the generator exited ${r.status}: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}`); return null; }
    return fs.readFileSync(path.join(tmp, 'public', 'design-system', 'sources.js'), 'utf8');
  };

  const committed = fs.readFileSync(path.join(ROOT, 'public', 'design-system', 'sources.js'), 'utf8');
  const before = generate();
  if (before !== null) {
    if (before !== committed) fail('public/design-system/sources.js is not what the generator writes. Run: node tools/design-system-snapshot.mjs --sources');
    const mods = fs.readdirSync(path.join(tmp, 'modules')).filter((m) => fs.existsSync(path.join(tmp, 'modules', m, 'src')));
    if (!mods.length) fail('no bundled module with a src/ folder to change');
    for (const m of mods) {
      const src = path.join(tmp, 'modules', m, 'src');
      const css = fs.readdirSync(src).find((f) => f.endsWith('.css'));
      if (css && /modules\/[a-z]/.test(committed) && committed.includes(`modules/${m}/src/${css}`)) fail(`the committed sources.js names modules/${m}/src/${css}`);
    }
    const target = mods[0];
    const srcDir = path.join(tmp, 'modules', target, 'src');
    const js = fs.readdirSync(srcDir).find((f) => f.endsWith('.js') && !/-lib-/.test(f));
    const css = fs.readdirSync(srcDir).find((f) => f.endsWith('.css') && !/-lib-/.test(f));
    if (js) fs.appendFileSync(path.join(srcDir, js), "\n// scratch: ui.icon('skull'); data-icon=\"dragon\"; <i class=\"fa-solid fa-hippo\"></i>\n");
    if (css) fs.appendFileSync(path.join(srcDir, css), '\n.scratch-rule { color: red; }\n.fa-otter::before { content: "x"; }\n');
    fs.appendFileSync(path.join(tmp, 'modules', target, 'module.json'), '\n');
    fs.mkdirSync(path.join(tmp, 'modules', 'zz-scratch', 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'modules', 'zz-scratch', 'src', 'zz-scratch.css'), '.zz { padding: 1px; }\n');
    fs.writeFileSync(path.join(tmp, 'modules', 'zz-scratch', 'src', 'zz-scratch.html'), '<i class="fa-solid fa-frog"></i>\n');
    const after = generate();
    if (after !== null && after !== before) fail('changing files under modules/ changed the generated sources.js; it must not depend on module sources');

    // The control: the same kind of change in public/ does change it, so the comparison can fail.
    fs.writeFileSync(path.join(tmp, 'public', 'scratch-control.html'), '<i class="fa-solid fa-hippo"></i>\n');
    const control = generate();
    if (control !== null && control === before) fail('the control did not work: a new icon in public/ left sources.js unchanged, so this check proves nothing');
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (failed) process.exit(1);
console.log('check-sources-modules: OK (module changes leave public/design-system/sources.js unchanged; a change in public/ changes it)');
