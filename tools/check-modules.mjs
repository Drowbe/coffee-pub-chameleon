#!/usr/bin/env node
/*
 * check-modules.mjs -- run server/modules.js's manifest cleaning on its own (server/modules.js:cleanManifest), no server,
 * no filesystem beyond what it needs. Focused on the parts easy to get wrong by hand in a module.json.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// A made-up product name, set before server/modules.js is loaded, so a sentence that hard-codes the default fails here
// (plan-kind-names.md, The guard).
const PRODUCT = 'Testname';
process.env.PRODUCT_NAME = PRODUCT;
const { cleanManifest, cleanStorage, oldNameIn, OUTDATED, permissionDefaults, pendingWidensNothing, PERMISSION_KEY_RE, ModuleError, ModuleManager } = createRequire(import.meta.url)('../server/modules.js');
let n = 0;
const { ModuleData } = createRequire(import.meta.url)('../server/module-data.js');
const test = (name, fn) => { fn(); n += 1; };

// The smallest manifest cleanManifest will accept: an environment-scope module with one page.
const base = () => ({ id: 'thing', name: 'Thing', version: '1.0.0', scope: ['environment'], surfaces: { page: { entry: 'page.html' } } });
const files = new Set(['page.html', 'canvas.html']);

test('a setting keeps a help paragraph longer than a one-line hint', () => {
  const long = 'A world PMTiles file to cut a region from with "Add a region", below. the host reads only the part it cuts, over https range requests, never the whole file. Protomaps publishes a daily build at https://maps.protomaps.com/builds; its address is dated and changes most days (for example https://build.protomaps.com/20260921.pmtiles), so check that page for todays, or point this at your own stable copy. Left empty, cutting a region is off.';
  assert.ok(long.length > 200 && long.length <= 600, 'the fixture itself must sit between the old and new ceilings');
  const m = cleanManifest({ ...base(), settings: [{ key: 'worldSource', label: 'World file', type: 'url', scope: 'environment', default: '', help: long }] }, files);
  assert.equal(m.settings[0].help, long); // not cut off mid-sentence
});

test('an absurdly long help is still capped, not unbounded', () => {
  const m = cleanManifest({ ...base(), settings: [{ key: 'x', label: 'X', type: 'boolean', scope: 'environment', default: false, help: 'y'.repeat(1000) }] }, files);
  assert.equal(m.settings[0].help.length, 600);
});

test('line breaks in a setting\'s help are kept, not collapsed', () => {
  const m = cleanManifest({ ...base(), settings: [{ key: 'x', label: 'X', type: 'boolean', scope: 'environment', default: false, help: 'First line.\n\nSecond line.' }] }, files);
  assert.equal(m.settings[0].help, 'First line.\n\nSecond line.');
});

test('a choice option\'s own help is unaffected (already had the wider ceiling)', () => {
  const m = cleanManifest({ ...base(), settings: [{ key: 'x', label: 'X', type: 'choice', scope: 'environment', default: 'a', options: [{ value: 'a', label: 'A', help: 'z'.repeat(700) }, { value: 'b', label: 'B' }] }] }, files);
  assert.equal(m.settings[0].options[0].help.length, 600);
});

test('a manifest\'s scopes are environment, space and person', () => {
  const both = { page: { entry: 'page.html' }, canvas: { entry: 'canvas.html', width: 500, height: 9999, mode: ['dock', 'sideways'] } };
  const m = cleanManifest({ ...base(), scope: ['environment', 'space', 'person'], surfaces: both, settings: [{ key: 'a', label: 'A', type: 'boolean', scope: 'space' }, { key: 'b', label: 'B', type: 'boolean' }, { key: 'c', label: 'C', type: 'boolean', scope: 'person' }], install: { auto: true, settingsFrom: 'environment' } }, files);
  assert.deepEqual(m.scope, ['environment', 'space', 'person']);
  assert.deepEqual(m.surfaces.canvas, { entry: 'canvas.html', width: 500, height: 1000, mode: ['dock'], lobby: false, menu: true }, 'surfaces.canvas: its size kept within bounds, its modes only dock and float, not in the Lobby unless it says so, listed in the menu unless it says not');
  assert.equal(cleanManifest({ ...base(), scope: ['environment', 'space'], surfaces: { page: { entry: 'page.html' }, canvas: { entry: 'canvas.html', menu: false } } }, files).surfaces.canvas.menu, false);
  assert.throws(() => cleanManifest({ ...base(), scope: ['environment', 'space'], surfaces: { page: { entry: 'page.html' }, canvas: { entry: 'canvas.html', menu: 'no' } } }, files), /surfaces.canvas.menu must be true or false/);
  assert.deepEqual(m.settings.map((d) => d.scope), ['space', 'environment', 'person'], 'a setting with no scope is the environment\'s');
  assert.equal(m.install.settingsFrom, 'environment');
  assert.throws(() => cleanManifest({ ...base(), scope: ['nowhere'] }, files), /"scope" must include "environment", "space", or both/);
  assert.throws(() => cleanManifest({ ...base(), scope: ['space'] }, files), /the "space" scope needs a surfaces.canvas/);
  assert.throws(() => cleanManifest({ ...base(), settings: [{ key: 'f', label: 'F', type: 'file', scope: 'space' }] }, files), /its scope must be "environment"/);
});

// Plan-names step 5c, the hard break: each old name in a manifest is refused with its one sentence, naming the field
// and what to use instead.
const OLD_SURFACE = 'panel'; // surfaces.canvas before plan-names step 6
const OLD_SUMMARY = 'card'; // refs.produces[].summary before plan-names step 7
const OLD_MANIFESTS = [
  [{ scope: ['environment', 'room'] }, `module.json uses the old scope "room"; use "space" (${PRODUCT} renamed rooms to spaces).`],
  [{ scope: ['server'] }, `module.json uses the old scope "server"; use "environment" (${PRODUCT} renamed the server to the environment).`],
  [{ settings: [{ key: 'a', label: 'A', type: 'boolean', scope: 'room' }] }, `module.json: setting "a" uses the old scope "room"; use "space" (${PRODUCT} renamed rooms to spaces).`],
  [{ settings: [{ key: 'n', label: 'N', type: 'note', scope: 'server' }] }, `module.json: setting "n" uses the old scope "server"; use "environment" (${PRODUCT} renamed the server to the environment).`],
  [{ install: { auto: true, settingsFrom: 'server' } }, `module.json: install.settingsFrom uses the old name "server"; use "environment" (${PRODUCT} renamed the server to the environment).`],
  [{ permissions: [{ key: 'view', label: 'View', default: { user: true } }] }, `module.json: permission "view" names the old role "user" in its default; use "member" (${PRODUCT} renamed the user role to member).`],
  // Plan-names step 6: the canvas surface's old name.
  [{ scope: ['environment', 'space'], surfaces: { page: { entry: 'page.html' }, [OLD_SURFACE]: { entry: 'canvas.html' } } }, `module.json uses the old surfaces.panel; use surfaces.canvas (${PRODUCT} renamed a module's panel to its place on the canvas).`],
  // Plan-names step 7: a kind's summary was its card; refused even beside a summary.
  [{ refs: { produces: [{ kind: 'note', key: 'note:{id}', [OLD_SUMMARY]: { title: 'title' } }] } }, `module.json: refs kind "note" uses the old card; use summary (${PRODUCT} renamed an object's card to its summary).`],
  [{ refs: { produces: [{ kind: 'note', key: 'note:{id}', summary: { title: 'title' } }, { kind: 'memo', key: 'memo:{id}', summary: { title: 'title' }, [OLD_SUMMARY]: { title: 'title' } }] } }, `module.json: refs kind "memo" uses the old card; use summary (${PRODUCT} renamed an object's card to its summary).`],
];
test('a manifest with an old name is refused with a sentence naming the field and what to use', () => {
  for (const [part, sentence] of OLD_MANIFESTS) {
    assert.equal(oldNameIn({ ...base(), ...part }), sentence);
    assert.throws(() => cleanManifest({ ...base(), ...part }, files), (err) => err instanceof ModuleError && err.status === 400 && err.message === sentence, sentence);
  }
  assert.equal(oldNameIn(base()), null);
});

test('a kind of object names the stored fields of its summary, and only those', () => {
  const produces = (p) => cleanManifest({ ...base(), refs: { produces: [{ kind: 'note', key: 'note:{id}', ...p }] } }, files).refs.produces[0];
  const kind = produces({ name: 'Note', open: true, summary: { title: 'title', subtitle: 'body', when: 'due', done: 'done', nonsense: 'x' } });
  assert.deepEqual(kind, { kind: 'note', name: 'Note', key: 'note:{id}', summary: { title: 'title', subtitle: 'body', when: 'due', done: 'done' }, open: true, backlinks: false });
  assert.ok(!('card' in kind), 'no card');
  assert.throws(() => produces({ summary: { subtitle: 'body' } }), (err) => err instanceof ModuleError && err.message === 'module.json: refs "note" needs a summary.title');
  assert.throws(() => produces({ summary: { title: 'no spaces allowed' } }), (err) => err instanceof ModuleError && err.message === 'module.json: refs "note" summary.title must name a stored field');
});

test('a summary may name icon, visit and spaces (plan-places-library, step 1)', () => {
  const kind = cleanManifest({ ...base(), refs: { produces: [{ kind: 'place', key: 'place:{id}', summary: { title: 'title', icon: 'icon', visit: 'status', spaces: 'spaces' } }] } }, files).refs.produces[0];
  assert.deepEqual(kind.summary, { title: 'title', icon: 'icon', visit: 'status', spaces: 'spaces' });
});

test('the module build inlines a library JSON file as LIB_<NAME> before the library code, and refuses bad JSON', () => {
  const { buildModule } = createRequire(import.meta.url)('../server/module-build.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-lib-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'module.json'), JSON.stringify({ id: 'demo', name: 'Demo', version: '1.0.0', scope: ['environment'], surfaces: { page: { entry: 'demo.html' } } }));
    fs.writeFileSync(path.join(dir, 'src', 'demo.html'), '<script>/*__JS__*/</script>');
    fs.writeFileSync(path.join(dir, 'src', 'demo.css'), '');
    fs.writeFileSync(path.join(dir, 'src', 'demo.js'), '/*__LIB__*/\nuse(LIB_PLACE_TYPES);');
    fs.writeFileSync(path.join(dir, 'src', 'demo-lib.js'), 'function use(x) {}');
    fs.writeFileSync(path.join(dir, 'src', 'demo-lib-place-types.json'), '{ "types": [ { "id": "cafe", "x": "</script>" } ] }');
    const built = buildModule(dir);
    assert.equal(built.manifest.id, 'demo');
    // Entries are deflated, so read them back through the module installer's reader.
    const zlib = createRequire(import.meta.url)('node:zlib');
    const local = built.zip.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), built.zip.indexOf(Buffer.from('demo.html')) - 30);
    const nameLen = built.zip.readUInt16LE(local + 26);
    const extraLen = built.zip.readUInt16LE(local + 28);
    const size = built.zip.readUInt32LE(local + 18);
    const text = zlib.inflateRawSync(built.zip.subarray(local + 30 + nameLen + extraLen, local + 30 + nameLen + extraLen + size)).toString();
    assert.ok(text.includes('const LIB_PLACE_TYPES = {"types":[{"id":"cafe","x":"<\\/script>"}]};'), text);
    assert.ok(text.indexOf('const LIB_PLACE_TYPES') < text.indexOf('function use'), 'the data comes before the library code');
    fs.writeFileSync(path.join(dir, 'src', 'demo-lib-place-types.json'), '{ nope');
    assert.throws(() => buildModule(dir), /demo-lib-place-types\.json is not valid JSON/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('storage.renamed: key prefixes a module renamed, checked, each refusal one sentence', () => {
  assert.deepEqual(cleanManifest({ ...base(), storage: { renamed: [{ from: 'item:', to: 'plan:', extra: 1 }] } }, files).storage, { renamed: [{ from: 'item:', to: 'plan:' }] });
  assert.deepEqual(cleanManifest(base(), files).storage, { renamed: [] }, 'none: an empty list');
  const refused = [
    [[], 'module.json: "storage" must be an object, such as { "renamed": [{ "from": "item:", "to": "plan:" }] }.'],
    [{ renamed: 'item:' }, 'module.json: storage.renamed must be a list of at most 10 { "from", "to" } key prefixes.'],
    [{ renamed: Array(11).fill({ from: 'a:', to: 'b:' }) }, 'module.json: storage.renamed must be a list of at most 10 { "from", "to" } key prefixes.'],
    [{ renamed: [{ from: 'item:' }] }, 'module.json: each storage.renamed entry needs a "from" and a "to" key prefix.'],
    [{ renamed: [{ from: 'item :', to: 'plan:' }] }, 'module.json: storage.renamed "item :" to "plan:": a key prefix is 1 to 64 letters, digits and . _ : / -.'],
    [{ renamed: [{ from: '', to: 'plan:' }] }, 'module.json: storage.renamed "" to "plan:": a key prefix is 1 to 64 letters, digits and . _ : / -.'],
    [{ renamed: [{ from: 'item:', to: 'item:x' }] }, 'module.json: storage.renamed "item:" to "item:x": one prefix must not start with the other.'],
    [{ renamed: [{ from: 'a:', to: 'b:' }, { from: 'a:', to: 'c:' }] }, 'module.json: storage.renamed lists "a:" more than once.'],
    // A set that would move a key back: a:→b: with b:→a: (QA), and the same by a longer prefix.
    [{ renamed: [{ from: 'a:', to: 'b:' }, { from: 'b:', to: 'a:' }] }, 'module.json: storage.renamed "b:" to "a:" would move keys back under "a:", which an earlier entry renames from.'],
    [{ renamed: [{ from: 'a:', to: 'b:' }, { from: 'b:', to: 'a:x' }] }, 'module.json: storage.renamed "b:" to "a:x" would move keys back under "a:", which an earlier entry renames from.'],
  ];
  assert.deepEqual(cleanStorage({ renamed: [{ from: 'a:', to: 'b:' }, { from: 'b:', to: 'c:' }] }).renamed.map((r) => r.to), ['b:', 'c:'], 'a chain moves forward: allowed');
  for (const [storage, sentence] of refused) {
    assert.throws(() => cleanStorage(storage), (err) => err instanceof ModuleError && err.status === 400 && err.message === sentence, sentence);
    assert.throws(() => cleanManifest({ ...base(), storage }, files), (err) => err.message === sentence);
  }
});

test('a stored-key rename moves every key with the prefix in every scope, never overwrites a taken name, and does nothing twice', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-modules-rename-'));
  try {
    const data = path.join(dir, 'm', 'data');
    fs.mkdirSync(data, { recursive: true });
    const e = (title, version = 2) => ({ value: { title }, version, updatedAt: '2026-01-01T00:00:00.000Z', by: 'k' });
    fs.writeFileSync(path.join(data, 'environment.json'), JSON.stringify({ 'item:1': e('one'), 'itemish': e('not the prefix') }));
    fs.writeFileSync(path.join(data, 'space-abcd.json'), JSON.stringify({ 'item:2': e('two', 5), 'item:3': e('old three'), 'plan:3': e('new three') }));
    fs.writeFileSync(path.join(data, 'person-memberkey1.json'), JSON.stringify({ 'item:4': e('four') }));
    fs.writeFileSync(path.join(data, 'space-efgh.json'), JSON.stringify({ 'plan:5': e('already') }));
    fs.writeFileSync(path.join(data, 'notes.txt'), 'not a scope');
    const md = new ModuleData(dir);
    assert.equal(md.get('m', 'space:abcd', 'item:2').version, 5, 'read before, so the cache is warm');
    const untouched = fs.readFileSync(path.join(data, 'space-efgh.json'), 'utf8');
    assert.deepEqual(md.renamePrefix('m', 'item:', 'plan:'), { moved: 3, kept: 1, scopes: 3 });
    const read = (f) => JSON.parse(fs.readFileSync(path.join(data, f), 'utf8'));
    assert.deepEqual(Object.keys(read('environment.json')).sort(), ['itemish', 'plan:1']);
    assert.deepEqual(read('space-abcd.json'), { 'plan:2': e('two', 5), 'item:3': e('old three'), 'plan:3': e('new three') });
    assert.deepEqual(Object.keys(read('person-memberkey1.json')), ['plan:4']);
    assert.equal(fs.readFileSync(path.join(data, 'space-efgh.json'), 'utf8'), untouched, 'nothing to move: not written');
    assert.equal(md.get('m', 'space:abcd', 'plan:2').value.title, 'two', 'the cache follows');
    assert.equal(md.get('m', 'space:abcd', 'item:2'), null);
    assert.equal(new ModuleData(dir).get('m', 'person:memberkey1', 'plan:4').value.title, 'four', 'and the files');
    assert.deepEqual(md.renamePrefix('m', 'item:', 'plan:'), { moved: 0, kept: 1, scopes: 0 }, 'again: only the taken one, left as it is');
    assert.deepEqual(md.renamePrefix('none', 'item:', 'plan:'), { moved: 0, kept: 0, scopes: 0 }, 'a module with no data');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bad input still throws a ModuleError, same as before', () => {
  assert.throws(() => cleanManifest({ ...base(), id: '' }, files), ModuleError);
});

test('a permission\'s defaults are keyed by the editable roles: moderator, member, guest', () => {
  const perm = (d) => cleanManifest({ ...base(), permissions: [{ key: 'view', label: 'View', default: d }] }, files).permissions[0].default;
  assert.deepEqual(perm({ member: true, guest: true }), { member: true, guest: true, moderator: true });
  assert.deepEqual(perm({ member: true }), { member: true, guest: false, moderator: true });
  assert.deepEqual(perm({ member: true, moderator: false }), { member: true, guest: false, moderator: false });
  // What the Roles grid reads (ModuleManager.permissionList), from the stored manifest as its author wrote it.
  assert.deepEqual(permissionDefaults({ member: true, guest: true, moderator: true }), { moderator: true, member: true, guest: true });
  assert.deepEqual(permissionDefaults({ member: true }), { moderator: false, member: true, guest: false }, 'a missing moderator stays off, as before');
  assert.deepEqual(permissionDefaults(undefined), { moderator: false, member: false, guest: false });
});

// Every bundled module's own permissions (modules/<id>/module.json) against the rule install applies, so a key the
// server would refuse fails here rather than at install. Also: each listed once, and each access guard names one.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('every bundled module\'s manifest uses only the new names, and its permission keys pass the server\'s rule, once each, and its access guards name them', () => {
  const problems = [];
  const dirs = fs.readdirSync(path.join(ROOT, 'modules'), { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, 'modules', d.name, 'module.json')));
  assert.ok(dirs.length > 0, 'the bundled modules were found');
  for (const d of dirs) {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', d.name, 'module.json'), 'utf8'));
    const keys = (Array.isArray(manifest.permissions) ? manifest.permissions : []).map((p) => p && p.key);
    for (const key of keys) {
      if (typeof key !== 'string' || !PERMISSION_KEY_RE.test(key)) problems.push(`modules/${d.name}/module.json: permission key ${JSON.stringify(key)} must match ${PERMISSION_KEY_RE} (lowercase letters, digits and underscores)`);
    }
    const old = oldNameIn(manifest);
    if (old) problems.push(`modules/${d.name}/${old}`);
    for (const key of new Set(keys.filter((k, i) => keys.indexOf(k) !== i))) problems.push(`modules/${d.name}/module.json: permission "${key}" is listed twice`);
    for (const [kind, named] of Object.entries(manifest.access && typeof manifest.access === 'object' ? manifest.access : {})) {
      if (named && !keys.includes(named)) problems.push(`modules/${d.name}/module.json: access.${kind} names "${named}", which is not one of its permissions`);
    }
  }
  assert.deepEqual(problems, []);
  // The rule itself, as the server applies it.
  assert.throws(() => cleanManifest({ ...base(), permissions: [{ key: 'manageAny', label: 'x' }] }, files), /lowercase letters, digits or underscores/);
  assert.equal(cleanManifest({ ...base(), permissions: [{ key: 'manage_any', label: 'x' }] }, files).permissions[0].key, 'manage_any');
});

// ModuleManager.update against a throwaway registry (under the system temp folder): a refused update changes nothing,
// not the module and not the modules that need it, in memory or on disk (GitHub #17).
test('a refused module update changes nothing, including the modules that need it; a valid one still applies', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-modules-'));
  try {
    const put = (id, m) => {
      const d = path.join(dir, 'modules', id, 'versions', '1.0.0');
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'module.json'), JSON.stringify({ id, name: id, version: '1.0.0', ...m }));
    };
    const surfaces = { page: { entry: 'page.html' }, canvas: { entry: 'canvas.html' } };
    put('base', { scope: ['environment', 'space'], surfaces });
    put('child', { scope: ['environment'], requires: ['base'], surfaces: { page: { entry: 'page.html' } } });
    const entry = (id) => ({ id, versions: ['1.0.0'], version: '1.0.0', enabled: true, allSpaces: false, spaces: ['s1'], approved: { permissions: [], hooks: [], refs: [], events: [], actions: [] }, source: 'upload' });
    const file = path.join(dir, 'modules', 'registry.json');
    fs.writeFileSync(file, JSON.stringify({ modules: { base: entry('base'), child: entry('child') }, autoInstalled: [] }, null, 2));
    const before = fs.readFileSync(file, 'utf8');
    const mm = new ModuleManager(dir);
    const snapshot = () => JSON.stringify(mm.registry);
    const memory = snapshot();
    const refused = [
      [{ enabled: false, force: true, runMode: 'nowhere' }, /runMode must be "page" or "sandbox"/],
      [{ enabled: false, force: true, runMode: 'page' }, /accepting the risk/],
      [{ enabled: false }, /needs base; turn it off too\?/],
    ];
    for (const [patch, message] of refused) {
      assert.throws(() => mm.update('base', patch), message);
      assert.equal(snapshot(), memory, `refused ${JSON.stringify(patch)} left the registry as it was, in memory`);
      assert.equal(fs.readFileSync(file, 'utf8'), before, `refused ${JSON.stringify(patch)} left the registry as it was, on disk`);
    }
    // A valid update still applies all of it, dependents included.
    // allSpaces and spaces are accepted and ignored (any value, even a bad one): the stored ones stay as they were.
    const view = mm.update('base', { enabled: false, force: true, runMode: 'sandbox', allSpaces: true, spaces: 'not a list' });
    assert.deepEqual([view.enabled, view.runMode, view.allSpaces, view.spaces], [false, 'sandbox', true, []], 'the view fixes them');
    assert.equal(mm.registry.modules.child.enabled, false, 'what needs it went off with it');
    const disk = JSON.parse(fs.readFileSync(file, 'utf8')).modules;
    assert.deepEqual([disk.base.enabled, disk.base.runMode, disk.base.allSpaces, disk.base.spaces, disk.child.enabled], [false, 'sandbox', false, ['s1'], false], 'stored values untouched');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// An installed module whose stored manifest uses an old name (plan-names step 5c): kept and shown, but it can't run,
// can't be turned on, and no version of it in the old names can be rolled back to. The registry keeps the owner's
// choice, so a fixed version runs again as it was.
test('an installed module with an old manifest does not run, says why, and cannot be turned on', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-modules-'));
  try {
    const put = (id, version, m) => {
      const d = path.join(dir, 'modules', id, 'versions', version);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'module.json'), JSON.stringify({ id, name: id, version, ...m }));
    };
    const surfaces = { page: { entry: 'page.html' }, canvas: { entry: 'canvas.html' } };
    put('old', '1.0.0', { scope: ['environment', 'space'], surfaces });
    put('old', '0.9.0', { scope: ['server', 'room'], surfaces });
    put('needer', '1.0.0', { scope: ['environment'], requires: ['old'], surfaces: { page: { entry: 'page.html' } } });
    const entry = (id, version, versions) => ({ id, versions, version, enabled: true, allSpaces: true, spaces: [], approved: { permissions: [], hooks: [], refs: [], events: [], actions: [] }, source: 'upload' });
    const file = path.join(dir, 'modules', 'registry.json');
    fs.writeFileSync(file, JSON.stringify({ modules: { old: entry('old', '0.9.0', ['0.9.0', '1.0.0']), needer: entry('needer', '1.0.0', ['1.0.0']) }, autoInstalled: [] }, null, 2));
    const before = fs.readFileSync(file, 'utf8');
    const mm = new ModuleManager(dir);
    assert.equal(mm.enabled('old'), null, 'it does not run');
    assert.equal(mm.resolveFile('old', '0.9.0', 'page.html'), null, 'its files are not served');
    const view = mm.view('old');
    assert.deepEqual(view.outdatedVersions, ['0.9.0'], 'the installed versions in the old names');
    assert.deepEqual([view.enabled, view.outdated, view.outdatedWhy], [false, OUTDATED, `module.json uses the old scope "server"; use "environment" (${PRODUCT} renamed the server to the environment).`]);
    // What requires it does not run either, and says it waits on an update rather than on being turned on.
    assert.equal(mm.enabled('needer'), null, 'what requires it does not run');
    assert.deepEqual(mm.enabledAll().map(({ manifest }) => manifest.id), []);
    const needer = mm.view('needer');
    assert.deepEqual([needer.enabled, needer.needsUpdate, needer.missing, needer.outdated], [false, ['old'], [], null]);
    assert.throws(() => mm.update('needer', { enabled: true }), (err) => err.status === 409 && err.message === 'needer needs old, which needs an update from its author.');
    assert.throws(() => mm.update('old', { enabled: true }), (err) => err.status === 409 && err.message === `old was built for an older version of ${PRODUCT} and needs an update from its author.`);
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'nothing was written at start or by the refused updates');
    // Turning the outdated one off does not ask about what requires it: that is not running.
    assert.equal(mm.update('old', { enabled: false }).enabled, false);
    assert.equal(mm.registry.modules.needer.enabled, true, 'its own choice kept');
    // QA's case: the fixed version arrives while the requirement is off. What requires it still does not run (its own
    // choice kept), and says what is missing; turning the requirement on runs both.
    assert.equal(mm.rollback('old', '1.0.0').enabled, false);
    assert.equal(mm.enabled('needer'), null, 'a module whose requirement is off never runs');
    assert.deepEqual([mm.view('needer').enabled, mm.view('needer').needsUpdate, mm.view('needer').missing], [false, [], ['old']]);
    assert.deepEqual(mm.enabledAll().map(({ manifest }) => manifest.id), []);
    assert.equal(mm.update('old', { enabled: true }).enabled, true);
    assert.deepEqual([mm.view('needer').enabled, mm.view('needer').needsUpdate, mm.view('needer').missing], [true, [], []]);
    assert.deepEqual([mm.view('old').outdated, mm.view('old').outdatedVersions], [null, ['0.9.0']], 'the old version is still marked while it is kept');
    assert.throws(() => mm.rollback('old', '0.9.0'), (err) => err.status === 409 && err.message === `old 0.9.0 was built for an older version of ${PRODUCT}, so it can't be rolled back to.`);
    assert.equal(mm.registry.modules.old.version, '1.0.0');
    // Uninstalling what it requires turns it off, as before.
    mm.uninstall('old');
    assert.equal(mm.registry.modules.needer.enabled, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The bundled update at start (index.js, updateOutdatedBundled) keeps a module on when all it newly asks for is
// permissions off for every role: those give nobody but owners anything. Anything else still waits for approval.
test('a bundled update widens nothing only when every new request is a permission off for every role', () => {
  const none = { permissions: [], hooks: [], refs: [], events: [], actions: [] };
  const perms = [{ key: 'view_page', default: { member: false, moderator: false, guest: false } }, { key: 'closed', default: {} }, { key: 'open', default: { member: true } }, { key: 'mods', default: { moderator: true } }, { key: 'guests', default: { guest: true } }];
  assert.equal(pendingWidensNothing(none, perms), true, 'nothing new');
  assert.equal(pendingWidensNothing({ ...none, permissions: ['view_page', 'closed'] }, perms), true, 'permissions off for every role');
  for (const key of ['open', 'mods', 'guests']) assert.equal(pendingWidensNothing({ ...none, permissions: ['view_page', key] }, perms), false, `${key} is on for a role`);
  assert.equal(pendingWidensNothing({ ...none, permissions: ['unknown'] }, perms), false, 'a permission it cannot read');
  for (const kind of ['hooks', 'refs', 'events', 'actions']) assert.equal(pendingWidensNothing({ ...none, [kind]: ['x'] }, perms), false, `a new ${kind} request`);
});

// A permission an author renamed says so (`replaces`), and each role's own choice for the old key is carried to the new
// one once (Store.carryRoleGrant, run by index.js's carryReplacedGrants after any install and at start).
test('a renamed permission carries each role\'s choice for its old key over once, and replaces is checked', () => {
  const m = cleanManifest({ ...base(), permissions: [{ key: 'view_page', label: 'See the page', replaces: 'links', default: {} }] }, files);
  assert.equal(m.permissions[0].replaces, 'links');
  const sentence = 'module.json: permission "view_page" replaces must name a key this module no longer uses';
  assert.throws(() => cleanManifest({ ...base(), permissions: [{ key: 'view_page', label: 'x', replaces: 'links' }, { key: 'see', label: 'y', replaces: 'links' }] }, files), (err) => err.message === 'module.json: permission "see" replaces "links", which permission "view_page" already replaces');
  for (const replaces of ['view_page', 'Bad-Key', 7, 'edit']) {
    assert.throws(() => cleanManifest({ ...base(), permissions: [{ key: 'view_page', label: 'x', replaces }, { key: 'edit', label: 'y' }] }, files), (err) => err.message === sentence, String(replaces));
  }
  const { Store } = createRequire(import.meta.url)('../server/store.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-modules-store-'));
  try {
    const store = new Store(dir);
    store.data.settings.roles = { member: { 'module.stream.links': true, chat: false }, moderator: { 'module.stream.links': false, 'module.stream.view_page': true }, guest: { react: false } };
    store.save();
    assert.deepEqual(store.carryRoleGrant('module.stream.links', 'module.stream.view_page'), ['member'], 'carried where there was no choice for the new key yet');
    const roles = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8')).settings.roles;
    assert.deepEqual(roles, { member: { chat: false, 'module.stream.view_page': true }, moderator: { 'module.stream.view_page': true }, guest: { react: false } }, 'the old key gone everywhere; a choice already made for the new key kept');
    assert.deepEqual(store.carryRoleGrant('module.stream.links', 'module.stream.view_page'), [], 'once: nothing left to carry');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a manifest\'s text a person reads is filled with the environment\'s words; one with no placeholder is the same object', () => {
  const { fillManifest, manifestTexts } = createRequire(import.meta.url)('../server/modules.js');
  const { resolve } = createRequire(import.meta.url)('../server/words.js');
  const words = resolve({ space: { one: 'trip', many: 'trips' }, module: { one: 'tool', many: 'tools' } }, null);
  const plain = { id: 'p', name: 'Plain', description: 'No placeholders here.', permissions: [{ key: 'v', label: 'View' }] };
  assert.equal(fillManifest(plain, words), plain);
  const m = {
    id: 'demo', name: 'The {Space} Tool', description: 'For every {space}.',
    surfaces: { widget: { title: '{Spaces}' } },
    permissions: [{ key: 'edit', label: 'Edit {a space}' }],
    settings: [{ key: 'k', label: 'Per {module}', help: 'Each {space} {x}', options: [{ value: 'a', label: '{Modules}', help: '{an space}' }] }],
    events: { publishes: [{ name: 'e', label: 'In {a space}' }] },
    actions: { provides: [{ name: 'a', label: 'Open {a module}' }] },
    refs: { produces: [{ kind: 'note', name: '{Space} note' }] },
  };
  const f = fillManifest(m, words);
  assert.notEqual(f, m);
  assert.equal(m.description, 'For every {space}.', 'the stored manifest is untouched');
  assert.deepEqual(manifestTexts(f).map(([o, k]) => o[k]), ['For every trip.', 'Trips', 'Edit a trip', 'Per tool', 'Each trip {x}', 'Tools', 'a trip', 'In a trip', 'Open a tool', 'Trip note']);
  assert.equal(f.name, 'The {Space} Tool', 'a name is a name, never filled');
  assert.equal(fillManifest(m, null).description, 'For every space.', 'no words: the defaults');
});

test('a kind\'s {name} is the module\'s shown name, never a word: the words leave it as it is', () => {
  const { fillManifest } = createRequire(import.meta.url)('../server/modules.js');
  const { resolve } = createRequire(import.meta.url)('../server/words.js');
  const words = resolve({ space: { one: 'trip', many: 'trips' } }, null);
  const only = { id: 'p', name: 'Planner', refs: { produces: [{ kind: 'plan', name: '{name}' }] } };
  assert.equal(fillManifest(only, words), only, 'a {name} alone is no words placeholder: the manifest itself');
  const both = { id: 'p', name: 'Planner', refs: { produces: [{ kind: 'plan', name: '{name} in the {space}' }] } };
  assert.equal(fillManifest(both, words).refs.produces[0].name, '{name} in the trip');
  assert.equal(cleanManifest({ ...base(), refs: { produces: [{ kind: 'plan', key: 'plan:{id}', name: '{name}', summary: { title: 'title' } }] } }, files).refs.produces[0].name, '{name}', 'kept for the server to fill');
});

test('a display name and icon are checked before anything is saved, each with one sentence', () => {
  const { Store } = createRequire(import.meta.url)('../server/store.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-modules-display-'));
  try {
    const store = new Store(dir);
    assert.deepEqual(store.moduleDisplay('travel'), { name: null, icon: null, ownName: null, ownIcon: null, templateName: null, templateIcon: null });
    assert.deepEqual(store.checkModuleDisplay('travel', { displayName: '  Trip   planner ', displayIcon: 'compass' }), { name: 'Trip planner', icon: 'compass' });
    assert.deepEqual(store.checkModuleDisplay('travel', { displayName: '', displayIcon: null }), { name: null, icon: null });
    assert.deepEqual(store.checkModuleDisplay('travel', {}), {});
    assert.deepEqual(store.checkModuleDisplay('travel', { displayName: 'Trip\tplanner\n' }), { name: 'Trip planner' }, 'tabs and new lines read as spaces');
    // Only an icon the pages draw as a module's (fa-solid fa-<id>): a brands or regular one on the list is refused.
    store.updateSettings({ icons: [...store.settings.icons, { id: 'discord', classes: 'fa-brands fa-discord' }, { id: 'my-star', classes: 'fa-regular fa-star' }, { id: 'odd', classes: 'fa-solid fa-star' }] });
    for (const icon of ['discord', 'my-star', 'odd']) assert.throws(() => store.checkModuleDisplay('travel', { displayIcon: icon }), (err) => err.status === 400 && err.message === `The icon ${icon} is not a solid Font Awesome icon, so it can't be a module's icon.`, icon);
    for (const [patch, sentence] of [
      [{ displayName: '<i>x</i>' }, 'A display name is plain text, without < or >.'],
      [{ displayName: 'a\u0007b' }, "A display name can't hold control or text-direction characters."],
      [{ displayName: 'Trip\u202eplanner' }, "A display name can't hold control or text-direction characters."],
      [{ displayName: '\u2066Trips\u2069' }, "A display name can't hold control or text-direction characters."],
      [{ displayName: 'a\u061cb' }, "A display name can't hold control or text-direction characters."],
      [{ displayName: 'x'.repeat(41) }, 'A display name can be at most 40 characters.'],
      [{ displayName: ['x'] }, "A display name must be text, or null to use the module's own name."],
      [{ displayIcon: 3 }, "An icon must be one of this environment's icons, or null to use the module's own."],
      [{ displayIcon: 'unicorn-rocket' }, "There is no icon called unicorn-rocket in this environment's icons."],
    ]) assert.throws(() => store.checkModuleDisplay('travel', patch), (err) => err.status === 400 && err.message === sentence, JSON.stringify(patch));
    store.applyModuleDisplay('travel', { name: 'Itinerary', icon: 'compass' });
    assert.deepEqual(store.moduleDisplay('travel'), { name: 'Itinerary', icon: 'compass', ownName: 'Itinerary', ownIcon: 'compass', templateName: null, templateIcon: null });
    store.templateModuleNames = { travel: 'Journey', places: 'Stops' };
    store.templateModuleIcons = { places: 'map', calendar: 'not-in-the-list' };
    assert.equal(store.moduleDisplay('travel').name, 'Itinerary', 'the owner\'s, over the template\'s');
    assert.deepEqual(store.moduleDisplay('places'), { name: 'Stops', icon: 'map', ownName: null, ownIcon: null, templateName: 'Stops', templateIcon: 'map' }, 'else the template\'s');
    assert.equal(store.moduleDisplay('calendar').icon, 'not-in-the-list', 'a template\'s icon counts as drawable: server/templates.js takes only Font Awesome Free solid icons');
    assert.deepEqual(store.checkModuleDisplay('travel', { displayIcon: 'map' }), { icon: 'map' }, 'and the owner may pick a template\'s icon');
    // Any installed or built-in module's own icon is allowed too, though it is not in the environment's icon list.
    assert.throws(() => store.checkModuleDisplay('travel', { displayIcon: 'suitcase-rolling' }), /There is no icon called suitcase-rolling/);
    store.moduleIconIds = () => ['suitcase-rolling', 'video'];
    assert.deepEqual(store.checkModuleDisplay('travel', { displayIcon: 'suitcase-rolling' }), { icon: 'suitcase-rolling' });
    // Another module's own icon, chosen, then that module gone: kept as the owner's, not drawn, and accepted back as it is.
    store.applyModuleDisplay('places', { icon: 'suitcase-rolling' });
    store.moduleIconIds = () => ['video'];
    assert.deepEqual([store.moduleDisplay('places').icon, store.moduleDisplay('places').ownIcon], ['map', 'suitcase-rolling'], 'the next one down (the template\'s) is shown');
    assert.deepEqual(store.checkModuleDisplay('places', { displayName: 'Stops', displayIcon: 'suitcase-rolling' }), { name: 'Stops', icon: 'suitcase-rolling' }, 'saving only the name keeps it');
    assert.throws(() => store.checkModuleDisplay('travel', { displayIcon: 'suitcase-rolling' }), /There is no icon called suitcase-rolling/, 'but not for another module');
    store.moduleIconIds = () => ['suitcase-rolling', 'video'];
    assert.equal(store.moduleDisplay('places').icon, 'suitcase-rolling', 'and it draws again once that module is back');
    store.applyModuleDisplay('places', { icon: null });
    store.templateModuleIcons = { calendar: 'video' };
    assert.equal(store.moduleDisplay('calendar').icon, 'video', 'a template\'s module icon that is a module\'s own');
    assert.throws(() => store.checkModuleDisplay('travel', { displayIcon: 'unicorn-rocket' }), /There is no icon called unicorn-rocket/);
    store.applyModuleDisplay('travel', { name: null, icon: null });
    assert.equal(store.moduleDisplay('travel').name, 'Journey');
    assert.equal('moduleNames' in store.settings, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The Lobby is for being together (plan-modules, GitHub #63): surfaces.canvas.lobby, the one check, and the start-up
// sync that takes the Lobby out of a module's spaces when it isn't made for it, keeping its data.
test('the Lobby: surfaces.canvas.lobby is checked, the one check keeps other modules out, and the sync switches them off there only', () => {
  const canvas = (lobby) => ({ ...base(), scope: ['space'], surfaces: { canvas: { entry: 'canvas.html', ...(lobby === undefined ? {} : { lobby }) } } });
  assert.equal(cleanManifest(canvas(true), files).surfaces.canvas.lobby, true);
  assert.equal(cleanManifest(canvas(undefined), files).surfaces.canvas.lobby, false, 'absent: never in the Lobby');
  assert.throws(() => cleanManifest(canvas('yes'), files), (err) => err instanceof ModuleError && err.message === 'module.json: surfaces.canvas.lobby must be true or false');
  const bundledLobby = fs.readdirSync(path.join(ROOT, 'modules')).filter((id) => {
    const f = path.join(ROOT, 'modules', id, 'module.json');
    return fs.existsSync(f) && JSON.parse(fs.readFileSync(f, 'utf8')).surfaces?.canvas?.lobby === true;
  });
  assert.deepEqual(bundledLobby, ['calendar'], 'the Calendar declares it, and no other bundled module');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-modules-lobby-'));
  try {
    const put = (id, lobby) => {
      const d = path.join(dir, 'modules', id, 'versions', '1.0.0');
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'module.json'), JSON.stringify({ id, name: id, version: '1.0.0', scope: ['space'], surfaces: { canvas: { entry: 'canvas.html', ...(lobby ? { lobby: true } : {}) } } }));
    };
    put('tasks', false);
    put('every', false);
    put('dates', true);
    const entry = (id, allSpaces, spaces) => ({ id, versions: ['1.0.0'], version: '1.0.0', enabled: true, allSpaces, spaces, approved: { permissions: [], hooks: [], refs: [], events: [], actions: [] }, source: 'upload' });
    const file = path.join(dir, 'modules', 'registry.json');
    fs.writeFileSync(file, JSON.stringify({ modules: { tasks: entry('tasks', false, ['lobby', 's1']), every: entry('every', true, []), dates: entry('dates', true, []) }, autoInstalled: [] }));
    const lobbyData = path.join(dir, 'modules', 'tasks', 'data', 'space-lobby.json');
    fs.mkdirSync(path.dirname(lobbyData), { recursive: true });
    fs.writeFileSync(lobbyData, '{"task:a":{"value":1}}');
    const mm = new ModuleManager(dir);
    const on = (id) => ['lobby', 's1', 's2'].filter((sp) => mm.isOnIn(id, sp));
    assert.deepEqual(on('tasks'), ['s1', 's2'], 'an enabled module is in every space, whatever allSpaces and spaces stored');
    assert.deepEqual(on('every'), ['s1', 's2'], 'the Lobby stays out for a module not made for it');
    assert.deepEqual(on('dates'), ['lobby', 's1', 's2'], 'a module made for the Lobby is in it too');
    assert.equal(mm.isOnIn('offmod', 's1'), false);
    assert.equal(mm.view('tasks').lobby, false);
    assert.equal(mm.view('dates').lobby, true);
    assert.deepEqual([mm.view('tasks').allSpaces, mm.view('tasks').spaces], [true, []], 'the view no longer shows the stored settings');
    assert.equal(typeof mm.lobbySync, 'undefined', 'nothing rewrites the stored lists');
    const disk = JSON.parse(fs.readFileSync(file, 'utf8')).modules;
    assert.deepEqual([disk.tasks.spaces, disk.tasks.allSpaces], [['lobby', 's1'], false], 'stored fields kept, unread');
    assert.equal(fs.readFileSync(lobbyData, 'utf8'), '{"task:a":{"value":1}}', 'its Lobby data kept, untouched');
    mm.update('tasks', { allSpaces: false, spaces: [] });
    assert.deepEqual(on('tasks'), ['s1', 's2'], 'a patch sending them changes nothing');
    mm.update('tasks', { enabled: false });
    assert.deepEqual(on('tasks'), [], 'a disabled module is nowhere');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('commands must name a local action that takes text, and cannot be ai', () => {
  const both = { page: { entry: 'page.html' }, canvas: { entry: 'canvas.html' } };
  const local = [{ name: 'addNote', label: 'Add a note', local: true, input: { text: 'string' } }];
  const ok = cleanManifest({ ...base(), scope: ['environment', 'space'], surfaces: both, actions: { provides: local }, commands: [{ name: 'r', label: 'Add a research note', action: 'addNote', hint: "the note's text" }] }, files);
  assert.deepEqual(ok.commands, [{ name: 'r', label: 'Add a research note', action: 'addNote', hint: "the note's text" }]);
  assert.deepEqual(cleanManifest({ ...base(), scope: ['environment', 'space'], surfaces: both }, files).commands, []);
  const refuse = (commands, actions, re) => {
    assert.throws(() => cleanManifest({ ...base(), scope: ['environment', 'space'], surfaces: both, actions: { provides: actions || local }, commands }, files), re);
  };
  refuse([{ name: 'Research', action: 'addNote' }], local, /1 to 12 lowercase letters or digits/);
  refuse([{ name: 'ai', action: 'addNote' }], local, /reserved/);
  refuse([{ name: 'r', action: 'missing' }], local, /not in actions.provides/);
  refuse([{ name: 'r', action: 'saveNote' }], [{ name: 'saveNote', input: { title: 'string' } }], /must be local/);
  refuse([{ name: 'r', action: 'addNote' }], [{ name: 'addNote', local: true, input: { title: 'string' } }], /must accept/);
});

// `needs` means two things: with a `ref` input, what the object pointed at must have; on any action, what the request
// must carry (the Calendar's createEvent needs ["date"]). Kept either way, with or without a `ref` input or `takes`.
test('needs: kept on an action with no ref input, with or without takes; unknown words dropped', () => {
  const both = { page: { entry: 'page.html' }, canvas: { entry: 'canvas.html' } };
  const make = (provides) => cleanManifest({ ...base(), scope: ['environment', 'space'], surfaces: both, actions: { provides } }, files).actions.provides;
  const [flat, taking, pointing, odd] = make([
    { name: 'flat', input: { title: 'string', date: 'date?' }, needs: ['date'] },
    { name: 'taking', input: { title: 'string?', date: 'date?', object: 'object?' }, needs: ['date', 'date'], takes: [{ kinds: ['event', '*', 'text'], as: 'an event' }] },
    { name: 'pointing', input: { ref: 'ref' }, needs: ['place'] },
    { name: 'odd', input: { title: 'string' }, needs: ['colour', 7] },
  ]);
  assert.deepEqual(flat.needs, ['date'], 'no ref input: kept');
  assert.deepEqual(taking.needs, ['date'], 'beside takes: kept once');
  assert.deepEqual(pointing.needs, ['place']);
  assert.equal('needs' in odd, false, 'nothing it knows: none');
  assert.deepEqual(make(make([{ name: 'flat', input: { title: 'string', date: 'date?' }, needs: ['date'] }]))[0].needs, ['date'], 'cleaned again on start: the same');
});

// plan-object-handoff.md, step 2: an action declares the objects it takes, with an `object` input. Stand-in manifests,
// no module of this repository's.
test('takes: kinds from the catalogue, "*" with except, "text", "as", a permission of its own; an object input with it', () => {
  const both = { page: { entry: 'page.html' }, canvas: { entry: 'canvas.html' } };
  const perms = [{ key: 'create', label: 'Create', default: { member: false } }];
  const make = (provides) => cleanManifest({ ...base(), scope: ['environment', 'space'], surfaces: both, permissions: perms, actions: { provides } }, files);
  const travel = ['flight', 'train', 'bus', 'ferry', 'car', 'hotel', 'restaurant', 'cafe', 'bar', 'sight', 'museum', 'attraction', 'tour', 'show'];
  const ok = make([
    { name: 'createEvent', label: 'Add an event', input: { title: 'string', date: 'date?', object: 'object?' }, takes: [{ kinds: ['*', 'text', '*'], except: travel, as: 'an event' }, { kinds: ['event'], as: 'an event' }] },
    { name: 'savePhoto', label: 'Keep a photo', input: { object: 'object' }, takes: [{ kinds: ['image'], as: 'an image' }] },
    { name: 'draftPoll', label: 'Start a poll', local: true, input: { object: 'object' }, takes: [{ kinds: ['poll', 'text'], as: ' a\tpoll ', permission: 'create' }] },
    { name: 'old', label: 'An action from before', input: { title: 'string' } },
  ]);
  const [event, photo, poll, old] = ok.actions.provides;
  assert.deepEqual(event.takes, [{ kinds: ['*', 'text'], except: travel, as: 'an event' }, { kinds: ['event'], as: 'an event' }], 'duplicates dropped, kept as declared');
  assert.deepEqual(event.input.object, 'object?');
  assert.deepEqual(photo.takes, [{ kinds: ['image'], as: 'an image' }], 'a handoff kind may be named');
  assert.deepEqual(poll.takes, [{ kinds: ['poll', 'text'], as: 'a poll', permission: 'create' }], '"as" cleaned of control characters');
  assert.equal('takes' in old, false, 'an action without takes has none');
  // A stored manifest cleaned again on start reads the same.
  assert.deepEqual(cleanManifest({ ...base(), scope: ['environment', 'space'], surfaces: both, permissions: perms, actions: { provides: ok.actions.provides } }, files).actions.provides, ok.actions.provides);
  const refuse = (provides, sentence) => assert.throws(() => make(provides), (err) => err instanceof ModuleError && err.message === sentence, sentence);
  const one = (takes, input = { object: 'object' }) => [{ name: 'take', input, takes }];
  refuse(one([{ kinds: ['spaceship'], as: 'a ship' }]), 'module.json: action "take" takes "spaceship", which is not a kind of object, "*" or "text"');
  refuse(one([{ kinds: [], as: 'a ship' }]), 'module.json: action "take" takes needs "kinds": a list of kinds of object, "*" or "text"');
  refuse(one([]), 'module.json: action "take" takes must be a list of 1 to 10 entries, such as { "kinds": ["note"], "as": "a note" }');
  refuse(one({ kinds: ['note'] }), 'module.json: action "take" takes must be a list of 1 to 10 entries, such as { "kinds": ["note"], "as": "a note" }');
  refuse(one(['note']), 'module.json: action "take" takes entries must each be an object with "kinds" and "as"');
  refuse(one([{ kinds: ['note'] }]), 'module.json: action "take" takes needs "as": the words after "Add to <module> as", up to 40 characters');
  refuse(one([{ kinds: ['note'], as: 'x'.repeat(41) }]), 'module.json: action "take" takes needs "as": the words after "Add to <module> as", up to 40 characters');
  refuse(one([{ kinds: ['note'], except: ['flight'], as: 'a note' }]), 'module.json: action "take" takes "except" needs "*" in its kinds');
  refuse(one([{ kinds: ['*'], except: ['image'], as: 'a note' }]), 'module.json: action "take" takes except "image", which is not a kind of object "*" can take');
  refuse(one([{ kinds: ['*'], except: 'flight', as: 'a note' }]), 'module.json: action "take" takes "except" must be a list of kinds of object');
  refuse(one([{ kinds: ['*', 'note'], except: ['note'], as: 'a note' }]), 'module.json: action "take" takes both lists and leaves out "note"');
  refuse(one([{ kinds: ['note'], as: 'a note', permission: 'nope' }]), 'module.json: action "take" takes permission "nope" must name one of the module\'s own permissions');
  refuse(one([{ kinds: ['note'], as: 'a note' }], { title: 'string' }), 'module.json: action "take" takes objects, so it needs an input of type "object"');
  refuse([{ name: 'take', input: { thing: 'object?' } }], 'module.json: action "take" input "thing" is an object, so the action needs "takes"');
  refuse(one([{ kinds: ['note'], as: 'a note' }], { a: 'object', b: 'object?' }), 'module.json: action "take" can have only one input of type "object"');
  // Event data has no object type.
  assert.throws(() => cleanManifest({ ...base(), events: { publishes: [{ name: 'moved', data: { what: 'object' } }] } }, files), /event "moved" data "what" must be one of string, text, date, datetime, boolean, number, ref /);
});

test('polls ships /p (and /poll) as a local addPoll command', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules/polls/module.json'), 'utf8'));
  assert.deepEqual(raw.commands, [{ name: 'p', word: 'poll', label: 'Start a poll', action: 'addPoll', hint: 'the question' }]);
  assert.equal(raw.actions.provides.find((a) => a.name === 'addPoll')?.local, true);
});

test('a command\'s full word: lowercase letters, 2 to 12, starting with its short name', () => {
  const mk = (word) => ({ ...base(), actions: { provides: [{ name: 'add', local: true, input: { text: 'string' } }] }, commands: [{ name: 't', ...(word === undefined ? {} : { word }), label: 'Add a to-do', action: 'add' }] });
  assert.equal(cleanManifest(mk('todo'), files).commands[0].word, 'todo');
  assert.equal(cleanManifest(mk(), files).commands[0].word, undefined, 'the word is optional');
  for (const bad of ['event', 't', 'To-do', 'tooooooooooooo', 't0do', 7]) assert.throws(() => cleanManifest(mk(bad), files), /command "t" word must be 2 to 12 lowercase letters and start with "t"/, String(bad));
});

test('calendar: phases come from host.on(\'phases\'), with a slow fallback, and no host.spaces() read', () => {
  const js = fs.readFileSync(path.join(ROOT, 'modules/calendar/src/calendar.js'), 'utf8');
  assert.match(js, /host\.on\('phases', \(e\) => \{ if \(\$\('app'\)\) lookAtPhases\(e && e\.timeline\); \}\);/, 'redraws when the host says');
  assert.match(js, /lookAtPhases\(\); \}, 300000\)/, 'a five-minute fallback');
  assert.match(js, /loaded = true;\n  \/\/ The host says when the phases change[^\n]*\n  host\.on\('phases'/, 'subscribed in the load, not loose at the top of the file');
  assert.ok(js.startsWith('// Calendar module.'), 'the file opens with its own header');
  const part = js.slice(js.indexOf('let phaseBands'), js.indexOf('function phaseFor'));
  assert.ok(!/host\.spaces\(/.test(part), 'phases do not read host.spaces()');
  assert.ok(!/30000\)/.test(js.slice(js.indexOf("host.on('phases'"), js.indexOf("host.on('phases'") + 400)), 'no 30 s poll');
});

test('calendar: a day wears its phase (the same rule as the Planner): inside, first day, gap, open end, before', () => {
  const src = (name) => fs.readFileSync(path.join(ROOT, 'modules/calendar/src', name), 'utf8');
  const lib = new Function('ymd', 'parseYmd', `${src('calendar-lib.js')}\nreturn { phaseOnDay };`)(() => '', () => new Date());
  const Phases = new Function('module', fs.readFileSync(path.join(ROOT, 'public/phases.js'), 'utf8') + '\nreturn module.exports;')({ exports: {} });
  const phases = [{ id: 'planning', label: 'Planning' }, { id: 'trip', label: 'Trip', main: true }, { id: 'after', label: 'After' }];
  const bands = Phases.timelineOf(phases, { planning: { start: '2026-10-01' }, trip: { start: '2026-10-10', end: '2026-10-12' }, after: { start: '2026-10-20' } }, { created: '2026-09-01' });
  assert.equal(lib.phaseOnDay(bands, '2026-09-30'), null, 'before the first phase');
  assert.deepEqual(lib.phaseOnDay(bands, '2026-10-01'), { id: 'planning', label: 'Planning', tint: 'blue', first: true });
  assert.deepEqual(lib.phaseOnDay(bands, '2026-10-05'), { id: 'planning', label: 'Planning', tint: 'blue', first: false });
  assert.deepEqual(lib.phaseOnDay(bands, '2026-10-12'), { id: 'trip', label: 'Trip', tint: 'green', first: false });
  assert.equal(lib.phaseOnDay(bands, '2026-10-15'), null, 'in the gap after the main phase');
  assert.deepEqual(lib.phaseOnDay(bands, '2028-01-01'), { id: 'after', label: 'After', tint: 'teal', first: false }, 'the last phase is open-ended');
  assert.equal(lib.phaseOnDay([], '2026-10-05'), null, 'no phases, nothing');
  const css = fs.readFileSync(path.join(ROOT, 'modules/calendar/src/calendar.css'), 'utf8');
  for (const t of ['blue', 'green', 'teal', 'purple', 'orange', 'pink', 'gold', 'red']) assert.match(css, new RegExp(`\\.ph-${t} \\{ --ph: var\\(--tint-${t}\\); \\}`), `${t} is the theme's tint`);
  assert.match(css, /\.sdk-cal-cell\.ph \{ --cal-wash: [^;]*var\(--ph\)/, 'a wash of the tint, under the cell');
  assert.match(css, /\.phasehead\.ph \{ background: [^;]*var\(--ph\)/, 'and under the day view\'s phase bar');
  assert.doesNotMatch(css.slice(css.indexOf('/* phases:'), css.indexOf('/* list */')), /(border|outline|box-shadow)[^;]*var\(--ph\)/, 'a phase never draws a coloured border or outline');
  assert.doesNotMatch(css.slice(css.indexOf('/* phases:'), css.indexOf('/* list */')), /#[0-9a-f]{3,8}\b|rgba?\(/i, 'no colour literals in the phase rules');
});

test('calendar: the Day view\'s phase bar and all-day row stick to the top of the scroll, and the auto-scroll stops beneath them (not under them)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'modules/calendar/src/calendar.css'), 'utf8');
  assert.match(css, /\.dayview \.daytop \{[^}]*position: sticky;[^}]*top: 0;[^}]*z-index: \d+;/, 'sticky at the top of the day\'s scroller (the phase bar and the all-day row are one block)');
  assert.doesNotMatch(css, /(^|\n)\.phasehead[^{]*\{[^}]*position: sticky/, 'only in the Day view: Week and Month have no bar to stick');
  const js = fs.readFileSync(path.join(ROOT, 'modules/calendar/src/calendar.js'), 'utf8');
  const fn = js.slice(js.indexOf('function scrollDay()'), js.indexOf('// Month / Week / Day / Agenda is'));
  assert.match(fn, /querySelector\('\.daytop'\)/, 'scrollDay finds the block');
  assert.match(fn, /body\.scrollTop = Math\.max\(0, [^;]*- \(top \? top\.offsetHeight \+ \d+ : 0\)\)/, 'and offsets the target by its height');
});

test('calendar: an event in a list is a full-width row with a time that never wraps', () => {
  const src = (name) => fs.readFileSync(path.join(ROOT, 'modules/calendar/src', name), 'utf8');
  const lib = new Function(`${src('calendar-lib.js')}\nreturn { whenText };`)();
  const at = (h, m) => new Date(2026, 9, 15, h, m);
  const ev = { allDay: false, start: '2026-10-15T23:00', end: '2026-10-15T23:00' };
  assert.equal(lib.whenText({ allDay: true, start: '2026-10-15' }, new Date(2026, 9, 15), new Date(2026, 9, 16)), 'All day');
  assert.equal(lib.whenText(ev, at(23, 0), at(23, 0)), '11:00 PM', 'a start that equals its end shows one time');
  assert.equal(lib.whenText({ ...ev, end: 'x' }, at(11, 0), at(11, 30)), '11:00 AM \u2013 11:30 AM');
  assert.equal(lib.whenText({ ...ev, end: 'x' }, at(11, 0), at(11, 30), true), '11 AM \u2013 11:30 AM', 'narrow: minutes drop only when they are 00');
  assert.equal(lib.whenText({ ...ev, end: 'x' }, at(20, 25), at(21, 50), true), '8:25 PM \u2013 9:50 PM');
  // The row is the Cards row (system.css) with the Calendar's kept bar; its time is the row's meta, its title the row's title.
  const sys = fs.readFileSync(path.join(ROOT, 'public/sdk/system.css'), 'utf8');
  const js = src('calendar.js');
  assert.match(js, /<div class="sdk-cal-agenda">\$\{g\.map/, 'a day\'s events are the agenda\'s rows');
  assert.match(js, /class="sdk-row sdk-bar-kept\$\{isExternal\(x\)/, 'each a Cards row with the kept bar');
  assert.match(sys, /\.sdk-row-meta \{[^}]*white-space: nowrap;/, 'the time never wraps');
  assert.match(sys, /\.sdk-row-title \{[^}]*text-overflow: ellipsis; white-space: nowrap;/, 'the title is one line with an ellipsis');
});

test('calendar: the views are Month, Week, Day and Agenda; an old stored "Open on" still opens', () => {
  const src = (name) => fs.readFileSync(path.join(ROOT, 'modules/calendar/src', name), 'utf8');
  const lib = new Function('ymd', 'parseYmd', `${src('calendar-lib.js')}\nreturn { VIEW_IDS, openView, listUnder };`)(() => '', () => new Date());
  assert.deepEqual(lib.VIEW_IDS, ['month', 'week', 'day', 'list']);
  // What a person stored keeps working: the old Month + list ("both") opens on Month, which now lists; List is the Agenda.
  for (const [stored, opens] of [['month', 'month'], ['week', 'week'], ['day', 'day'], ['list', 'list'], ['both', 'month'], [undefined, 'month'], ['', 'month'], ['nope', 'month']]) {
    assert.equal(lib.openView(stored), opens, `"Open on" stored as ${JSON.stringify(stored)} opens on ${opens}`);
  }
  // Month and Week list under the grid, Day and the Agenda do not, and the destination's parts never do (its Agenda is the list).
  assert.deepEqual(['month', 'week', 'day', 'list'].map((v) => lib.listUnder(v, null)), [true, true, false, false]);
  assert.deepEqual(['month', 'week', 'day', 'list'].map((v) => lib.listUnder(v, 'main')), [false, false, false, false]);
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules/calendar/module.json'), 'utf8'));
  const openOn = raw.settings.find((d) => d.key === 'defaultView');
  assert.deepEqual(openOn.options.map((o) => [o.value, o.label]), [['month', 'Month'], ['week', 'Week'], ['day', 'Day'], ['list', 'Agenda']], '"Open on" offers Month, Week, Day and Agenda');
  assert.equal(openOn.default, 'month');
  const js = src('calendar.js');
  assert.match(js, /view = openView\(prefs\.defaultView\)/, 'the calendar opens on openView of "Open on"');
  assert.match(js, /\{ id: 'list', label: 'Agenda'(, icon: '[a-z0-9-]+')? \},\n\s*\];/, 'the view switch ends with Agenda');
  assert.doesNotMatch(js, /id: 'both'|Month \+ list'/, 'no Month + list view');
  assert.equal((js.match(/listUnder\(view, part\)/g) || []).length, 2, 'Month and Week both ask listUnder');
  // The Calendar destination's first view from "Open on": Month, Week or Day; the Agenda and an old Month + list open on Month.
  const dest = fs.readFileSync(path.join(ROOT, 'public/destination.js'), 'utf8').match(/firstView: (\(values\) => .*),\n/);
  assert.ok(dest, 'public/destination.js: KINDS.calendar.firstView');
  const firstView = new Function(`return ${dest[1]};`)();
  for (const [stored, opens] of [['month', 'month'], ['week', 'week'], ['day', 'day'], ['list', 'month'], ['both', 'month'], [undefined, 'month']]) {
    assert.equal(firstView({ defaultView: stored }), opens, `/calendar with "Open on" ${JSON.stringify(stored)} opens on ${opens}`);
  }
});

test('calendar offers its events to calendar feeds, with its repeat field; the Planner\'s plans are not offered (plan-google-calendar.md)', () => {
  const cleaned = (id) => {
    return cleanManifest(JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', id, 'module.json'), 'utf8')), { has: () => true }); // its pages are built into the zip from src/
  };
  const event = cleaned('calendar').refs.produces.find((p) => p.kind === 'event');
  assert.equal(event.feed, true, 'the event kind has "feed": true');
  assert.equal(event.dated.repeat, 'repeat', 'its "dated" names the stored repeat field');
  assert.ok('repeat' in event.create, 'the field the Calendar stores ({ every, until }) is called repeat');
  assert.match(fs.readFileSync(path.join(ROOT, 'modules/calendar/src/calendar-lib.js'), 'utf8'), /ev\.repeat\.every/, 'and the Calendar reads it as ev.repeat');
  const offered = fs.readdirSync(path.join(ROOT, 'modules')).filter((id) => fs.existsSync(path.join(ROOT, 'modules', id, 'module.json')))
    .flatMap((id) => (cleaned(id).refs?.produces || []).filter((p) => p.feed).map((p) => `${id}:${p.kind}`));
  assert.deepEqual(offered, ['calendar:event'], 'only the Calendar\'s events are offered; a Planner object reaches the feed as its twin');
});

test('calendar asks for the person\'s other calendars with the `external` hook, and is the only bundled module that does (plan-google-calendar.md, Part 2)', () => {
  const cleaned = (id) => cleanManifest(JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', id, 'module.json'), 'utf8')), { has: () => true });
  assert.equal(cleaned('calendar').hooks.external, true, 'the Calendar declares "hooks": { "external": true }');
  assert.equal(cleanManifest({ ...base(), hooks: { external: true } }, files).hooks.external, true, 'cleanManifest keeps the hook');
  const asking = fs.readdirSync(path.join(ROOT, 'modules')).filter((id) => fs.existsSync(path.join(ROOT, 'modules', id, 'module.json')) && cleaned(id).hooks.external);
  assert.deepEqual(asking, ['calendar']);
  const js = fs.readFileSync(path.join(ROOT, 'modules/calendar/src/calendar.js'), 'utf8');
  assert.match(js, /host\.external\.events\(\{ from: ymd\(want\.from\), to: ymd\(want\.to\) \}\)/, 'the Calendar asks for the period it shows');
  assert.match(js, /host\.on\('external', \(\) => askExternal\(true\)\)/, 'and asks again on the external event');
  assert.match(js, /const showsExternal = info\.context\.scope === 'environment'/, 'only on the environment\'s page and the destination, never in a space');
  assert.match(js, /if \(!editing \|\| editing\.scope === 'external'\) return;/, 'another calendar\'s event is never saved');
  assert.match(js, /return x && !isExternal\(x\) \?/, 'nor dragged to another module');
});

test('To-do\'s tasks and Polls\' polls are markers on a calendar, read from the fields each stores; only they are (plan-calendar-markers.md)', () => {
  const cleaned = (id) => cleanManifest(JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', id, 'module.json'), 'utf8')), { has: () => true });
  const task = cleaned('todo').refs.produces.find((p) => p.kind === 'task');
  assert.equal(task.marker, true, 'the task kind has "marker": true');
  assert.deepEqual(task.dated, { form: 'wall', title: 'title', day: 'due' }, 'a task is a day marker: its title on its due day (YYYY-MM-DD)');
  assert.equal(task.summary.done, 'done', 'a task ticked done leaves the grid');
  const poll = cleaned('polls').refs.produces.find((p) => p.kind === 'poll');
  assert.equal(poll.marker, true, 'the poll kind has "marker": true');
  assert.deepEqual(poll.dated, { form: 'instant', title: 'question', start: 'closesAt' }, 'a poll is a timed marker: its question at closesAt (milliseconds)');
  assert.equal(poll.summary.done, 'closed', 'a poll closed by hand (closed: true) has no marker; one closed by its time stays');
  const todoJs = fs.readFileSync(path.join(ROOT, 'modules/todo/src/todo.js'), 'utf8');
  assert.match(todoJs, /id: newId\(\), title, notes: made \? made\.notes : input\.notes \|\| '', due: input\.due \|\| \(made && made\.due\) \|\| null, remind: false, done: false/, 'To-do stores title, due (a day, YYYY-MM-DD) and done');
  const pollsJs = fs.readFileSync(path.join(ROOT, 'modules/polls/src/polls.js'), 'utf8');
  assert.match(pollsJs, /closed: closing, closesAt: closing \? x\.p\.closesAt : null/, 'Polls stores closed and closesAt; closing by hand sets closed');
  assert.match(pollsJs, /const p = \{\n\s+id: newId\(\),\n\s+question,/, 'and the question as question');
  const marked = fs.readdirSync(path.join(ROOT, 'modules')).filter((id) => fs.existsSync(path.join(ROOT, 'modules', id, 'module.json')))
    .flatMap((id) => (cleaned(id).refs?.produces || []).filter((p) => p.marker).map((p) => `${id}:${p.kind}`)).sort();
  assert.deepEqual(marked, ['polls:poll', 'todo:task']);
  // The Calendar draws them and never treats one as its own event: not opened in its editor, not dragged, not stored.
  const js = fs.readFileSync(path.join(ROOT, 'modules/calendar/src/calendar.js'), 'utf8');
  assert.match(js, /host\.objects\.markers\(\{ from: ymd\(want\.from\), to: ymd\(addDays\(want\.to, -1\)\) \}\)/, 'the Calendar asks for the period it shows');
  assert.match(js, /host\.on\('markers', \(\) => askMarkers\(true\)\)/, 'and asks again on the markers event');
  assert.match(js, /if \(want\.to - want\.from > 90 \* DAY\) want = need;/, 'never more than the host answers (92 days)');
  assert.match(js, /host\.objects\.open\(x\.marker\.ref/, 'a marker opens its object in its own module');
  assert.ok(!/markerItems\.get\([^)]*\)[^;]*openEditor|openEditor\(markerItems/.test(js), 'never in the event editor');
  assert.ok(!/data-open="\$\{esc\(x\.key\)\}"[^`]*class="sdk-cal-event sdk-bar-kept is-marker/.test(js) && /class="sdk-cal-event sdk-bar-kept is-marker[^`]*data-marker=/.test(js), 'a marker chip is data-marker, never data-open (so never dragged or dropped on as an event)');
  assert.ok(!/host\.storage\.set\([^)]*marker/i.test(js), 'nothing about a marker is stored');
});

test('a manifest\'s color is one of the eight tints, or none; anything else refuses the install (plan-chat-model.md)', () => {
  const { TINTS } = createRequire(import.meta.url)('../server/modules.js');
  for (const tint of TINTS) assert.equal(cleanManifest({ ...base(), color: tint }, files).color, tint);
  assert.equal(cleanManifest(base(), files).color, null);
  for (const bad of ['mauve', '#00ff00', '', 1]) {
    assert.throws(() => cleanManifest({ ...base(), color: bad }, files), (err) => err instanceof ModuleError && err.message === `module.json: "color" must be one of ${TINTS.join(', ')}`);
  }
});

test('a module\'s timer stops once the module is closed (in the page its elements go, and the timer would draw into nothing)', () => {
  // Every setInterval in a module's own code is kept and cleared by itself when the module's elements are gone (the
  // Polls pattern: `const t = setInterval(() => { if (!$('app')) return void clearInterval(t); ... })`). The home
  // page's widgets and a keyed page are left out: they live as long as their page.
  const dir = path.join(ROOT, 'modules');
  const found = [];
  for (const id of fs.readdirSync(dir)) {
    const src = path.join(dir, id, 'src');
    if (!fs.existsSync(src)) continue;
    for (const f of fs.readdirSync(src).filter((x) => x.endsWith('.js') && !/-(widget|keyed)\.js$/.test(x))) {
      const lines = fs.readFileSync(path.join(src, f), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/\bsetInterval\(/.test(line)) return;
        const kept = /\bconst (\w+) = setInterval\(/.exec(line);
        // The guard is at the top of the timer's function: on its line or the next.
        if (!kept || !lines.slice(i, i + 2).join('\n').includes(`clearInterval(${kept[1]})`)) found.push(`modules/${id}/src/${f}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(found, [], 'a timer never cleared');
});

test('the manifest field content is padded or flush, and nothing else', () => {
  assert.equal(cleanManifest(base(), files).content, 'padded', 'padded when it says nothing');
  assert.equal(cleanManifest({ ...base(), content: 'padded' }, files).content, 'padded');
  assert.equal(cleanManifest({ ...base(), content: 'flush' }, files).content, 'flush');
  for (const bad of ['full', '', true, 1, null]) assert.throws(() => cleanManifest({ ...base(), content: bad }, files), /content must be "padded" or "flush"/);
});

// An uploaded module that draws what the host draws is installed with a plain warning in the answer; a bundled one, or a clean one, has none.
{
  const { zipFiles } = createRequire(import.meta.url)('../server/module-build.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-warn-'));
  try {
    const mm = new ModuleManager(dir);
    const page = (html, css = '') => Buffer.from(`<!doctype html><style>${css}</style><body>${html}</body>`);
    const zip = (id, html, css) => zipFiles([['module.json', Buffer.from(JSON.stringify({ id, name: id, version: '1.0.0', scope: ['environment'], surfaces: { page: { entry: 'page.html' } } }))], ['page.html', page(html, css)]]);
    const bad = await mm.install(zip('badlook', '<header class="bar"></header>', '.sdk-card { padding: 2px }'));
    assert.match(bad.layoutWarning, /draws or restyles parts the host draws \(markup: <header>, \.sdk-card\)/, 'the warning names what it breaks');
    assert.equal(bad.version, '1.0.0', 'it is still installed');
    assert.equal((await mm.install(zip('goodlook', '<div class="sdk-card"></div>', '.pin { padding: 2px }'))).layoutWarning, undefined, 'a clean module has no warning');
    assert.equal((await mm.install(zip('shipped', '<header></header>'), { source: 'bundled' })).layoutWarning, undefined, 'a bundled module is held by check-module-layout, not warned');
    n += 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// A module's `ai` hook: true needs the AI service, "optional" uses it when it is on, anything else is refused.
test('hooks.ai: true or "optional" only; required waits on the AI service, optional does not, and turning the service off keeps optional users on', () => {
  for (const bad of ['yes', 'required', false, 1, null, {}, ['optional']]) {
    assert.throws(() => cleanManifest({ ...base(), hooks: { ai: bad } }, files), (err) => err instanceof ModuleError && /hooks\.ai must be true .* or "optional"/.test(err.message), `refused: ${JSON.stringify(bad)}`);
  }
  assert.equal(cleanManifest(base(), files).hooks.ai, false, 'absent: no AI use');
  assert.equal(cleanManifest({ ...base(), hooks: { ai: true } }, files).hooks.ai, true);
  assert.equal(cleanManifest({ ...base(), hooks: { ai: 'optional' } }, files).hooks.ai, 'optional');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-modules-'));
  try {
    for (const [id, ai] of [['needs-ai', true], ['uses-ai', 'optional']]) {
      const d = path.join(dir, 'modules', id, 'versions', '1.0.0');
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'module.json'), JSON.stringify({ id, name: id, version: '1.0.0', scope: ['environment'], surfaces: { page: { entry: 'page.html' } }, hooks: { ai } }));
      fs.writeFileSync(path.join(d, 'page.html'), '<p>x</p>');
    }
    const entry = (id) => ({ id, versions: ['1.0.0'], version: '1.0.0', enabled: false, allSpaces: true, spaces: [], approved: { permissions: [], hooks: ['ai'], refs: [], events: [], actions: [] }, source: 'upload' });
    fs.writeFileSync(path.join(dir, 'modules', 'registry.json'), JSON.stringify({ modules: { 'needs-ai': entry('needs-ai'), 'uses-ai': entry('uses-ai') }, autoInstalled: [] }));
    const mm = new ModuleManager(dir);
    let on = false;
    mm.aiReady = () => on;
    assert.deepEqual([mm.view('needs-ai').missing, mm.view('uses-ai').missing], [['ai'], []], 'only the required one waits on the service');
    assert.throws(() => mm.update('needs-ai', { enabled: true }), (err) => /needs the AI service installed and turned on first/.test(err.message), 'required: refused with the service off');
    assert.equal(mm.update('uses-ai', { enabled: true }).enabled, true, 'optional: on with the service off');
    on = true;
    assert.equal(mm.update('needs-ai', { enabled: true }).enabled, true);
    assert.deepEqual(mm.aiDependents().map((m) => m.id), ['needs-ai'], 'the service lists only the required one');
    on = false;
    assert.equal(mm.enabled('uses-ai') !== null, true, 'the optional one keeps running with the service off');
    assert.deepEqual(mm.view('uses-ai').missing, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a bundled module that stores objects and may point at other modules\' tells the host what its objects point at (setLinks)', () => {
  // Without it the object pointed at (a place) shows no "Used by", and deleting it warns of nothing (the Planner once did not).
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'modules');
  const missing = [];
  let seen = 0;
  for (const id of fs.readdirSync(root)) {
    const manifest = path.join(root, id, 'module.json');
    const src = path.join(root, id, 'src');
    if (!fs.existsSync(manifest) || !fs.existsSync(src)) continue;
    const consumes = (JSON.parse(fs.readFileSync(manifest, 'utf8')).refs || {}).consumes || [];
    const code = fs.readdirSync(src).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(src, f), 'utf8')).join('\n');
    if (!consumes.length || !/storage\.set\(/.test(code)) continue;
    seen += 1;
    if (!/objects\.setLinks\(/.test(code)) missing.push(id);
  }
  assert.ok(seen >= 6, 'the modules that keep objects were found');
  assert.deepEqual(missing, [], `these modules store objects and consume other modules' kinds but never call host.objects.setLinks: ${missing.join(', ')}`);
});

test('a module\'s test/ folder (modules/<id>/test/*.mjs, run by tools/check-module-tests.mjs) never goes into its zip', () => {
  const { buildModule, bundledModules } = createRequire(import.meta.url)('../server/module-build.js');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'modules');
  const ids = bundledModules(root).map((m) => m.id);
  assert.ok(ids.length >= 6, 'the bundled modules were found');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-modules-zip-'));
  try {
    for (const id of ids) {
      const copy = path.join(tmp, id);
      fs.cpSync(path.join(root, id), copy, { recursive: true });
      const plain = buildModule(copy);
      fs.mkdirSync(path.join(copy, 'test'), { recursive: true });
      fs.writeFileSync(path.join(copy, 'test', 'zz-scratch-test.mjs'), 'process.exit(0);\n');
      const withTest = buildModule(copy);
      assert.equal(withTest.fileCount, plain.fileCount, `${id}: a test/ folder changed the number of files in the zip`);
      assert.ok(!withTest.zip.includes('zz-scratch-test') && !withTest.zip.includes('test/'), `${id}: the zip has a test/ entry`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

console.log(`check-modules: ${n} groups OK`);
