#!/usr/bin/env node
/*
 * check-flag.mjs -- the two small core fields of documentation/plans/plan-todo-list.md (step J4):
 *   - a destination panel part's `showWhenSetting`: the key of one boolean environment setting of the part's own module; the
 *     panel is hidden while that setting is false (server/destinations.js, panelsOf), and a part without it is unchanged;
 *   - a setting's `needsModule`: the id of another module; the setting is offered, saved and counted only while that module
 *     is installed and on.
 * Manifest cases (good and hostile), the rules on their own, then a real server (the bundled Calendar and To-do, and a
 * hostile upload). No network beyond localhost, no LiveKit, no browser.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { cleanManifest } = require('../server/modules.js');
const { buildModule, bundledModules } = require('../server/module-build.js');
const destinations = require('../server/destinations.js');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};

// --- the manifest fields ---------------------------------------------------------------------------------------------
{
  const files = new Map([['page.html', Buffer.from('')], ['canvas.html', Buffer.from('')]]);
  const setting = (extra = {}) => ({ key: 'inCalendar', label: 'In the Calendar', type: 'boolean', scope: 'environment', default: true, ...extra });
  const manifest = (parts, settings, extra = {}) => ({
    id: 'lister', name: 'Lister', version: '1.0.0', scope: ['environment', 'space'],
    surfaces: { page: { entry: 'page.html' }, canvas: { entry: 'canvas.html' }, destination: parts }, settings, ...extra,
  });
  const second = (extra = {}) => ({ id: 'calendar', part: 'panel', entry: 'page.html', ...extra });
  const refused = (m, sentence) => assert.throws(() => cleanManifest(m, files), (err) => {
    assert.equal(err.status, 400);
    assert.match(err.message, sentence);
    return true;
  });

  await test('manifest: a panel names its own boolean setting; a setting needs another module', () => {
    const m = cleanManifest(manifest([second({ showWhenSetting: 'inCalendar' })], [setting({ needsModule: 'calendar' })]), files);
    assert.equal(m.surfaces.destination[0].showWhenSetting, 'inCalendar');
    assert.equal(m.settings[0].needsModule, 'calendar');
    assert.equal(m.settings[0].default, true);
  });
  await test('manifest: without the fields, nothing is added', () => {
    const m = cleanManifest(manifest([second()], [setting()]), files);
    assert.deepEqual(m.surfaces.destination, [{ id: 'calendar', part: 'panel', entry: 'page.html' }]);
    assert.equal('needsModule' in m.settings[0], false);
  });
  await test('manifest: showWhenSetting, hostile shapes', () => {
    const flagged = (v, settings = [setting()]) => manifest([second({ showWhenSetting: v })], settings);
    refused(flagged('nothere'), /showWhenSetting "nothere" must name a boolean setting of this module/);
    refused(flagged('inCalendar', []), /must name a boolean setting of this module/);
    refused(flagged('inCalendar', [setting({ type: 'text', default: '' })]), /must name a boolean setting/);
    refused(flagged('inCalendar', [setting({ scope: 'space' })]), /with the "environment" scope/);
    refused(flagged('inCalendar', [setting({ scope: 'person' })]), /with the "environment" scope/);
    refused(flagged(true), /showWhenSetting belongs on a panel and must name one of its own settings/);
    refused(flagged(['inCalendar']), /showWhenSetting belongs on a panel/);
    refused(flagged({ module: 'todo', key: 'inCalendar' }), /showWhenSetting belongs on a panel/);
    refused(flagged(''), /showWhenSetting belongs on a panel/);
    refused(flagged('In Calendar'), /showWhenSetting belongs on a panel/);
    refused(flagged('todo.inCalendar'), /showWhenSetting belongs on a panel/);
    refused(flagged('__proto__'), /showWhenSetting belongs on a panel/);
    refused(manifest([{ id: 'calendar', part: 'main', entry: 'page.html', showWhenSetting: 'inCalendar' }], [setting()]), /showWhenSetting belongs on a panel/);
    refused(manifest([second({ showWhenSetting: null })], [setting()]), /showWhenSetting belongs on a panel/);
  });
  await test('manifest: needsModule, hostile shapes', () => {
    const needs = (v) => manifest([], [setting({ needsModule: v })]);
    refused(needs(5), /needsModule must be the id of another module/);
    refused(needs(['calendar']), /needsModule must be the id of another module/);
    refused(needs({ id: 'calendar' }), /needsModule must be the id of another module/);
    refused(needs(''), /needsModule must be the id of another module/);
    refused(needs('Calendar'), /needsModule must be the id of another module/);
    refused(needs('../calendar'), /needsModule must be the id of another module/);
    refused(needs('a'.repeat(40)), /needsModule must be the id of another module/);
    refused(needs(null), /needsModule must be the id of another module/);
    refused(needs('lister'), /needsModule must be another module/);
  });
  await test('manifest: every bundled needsModule names another bundled module; every bundled flag names its own boolean', () => {
    const all = bundledModules(path.join(ROOT, 'modules'));
    const ids = new Set(all.map((m) => m.id));
    for (const m of all) {
      for (const d of m.settings || []) if (d.needsModule) assert.ok(ids.has(d.needsModule) && d.needsModule !== m.id, `${m.id}.${d.key} needs ${d.needsModule}`);
      for (const p of m.surfaces?.destination || []) if (p.showWhenSetting) {
        const d = (m.settings || []).find((s) => s.key === p.showWhenSetting);
        assert.ok(d && d.type === 'boolean' && (d.scope || 'environment') === 'environment' && p.part === 'panel', `${m.id} flag ${p.showWhenSetting}`);
      }
    }
    const calendar = all.find((m) => m.id === 'calendar');
    assert.ok(calendar.surfaces.destination.every((p) => p.showWhenSetting === undefined), 'the Calendar\'s own parts carry no flag');
    const todo = all.find((m) => m.id === 'todo');
    assert.equal(todo.surfaces.destination[0].showWhenSetting, 'inCalendar');
    assert.equal(todo.settings.find((d) => d.key === 'inCalendar').needsModule, 'calendar');
  });
}

// --- the rules on their own ----------------------------------------------------------------------------------------------
{
  const def = (extra = {}) => ({ key: 'inCalendar', type: 'boolean', scope: 'environment', default: true, ...extra });
  const mod = (id, parts, settings = [], source = 'upload') => ({ manifest: { id, scope: ['environment'], settings, surfaces: { destination: parts } }, entry: { id, source } });
  const main = { id: 'calendar', part: 'main', entry: 'p.html' };
  const second = (extra = {}) => ({ id: 'calendar', part: 'panel', entry: 'p.html', ...extra });
  const ctx = (enabled, values) => ({ settings: { showCalendar: true }, enabled, canRead: () => true, values });
  const ids = (d) => d.panels.map((p) => p.manifest.id);

  await test('rules: a flagged panel is hidden only while its setting is false; the Agenda stays when the flag is absent', () => {
    const enabled = [mod('cal', [main, second({ order: 10 })], [], 'bundled'), mod('todo', [second({ order: 20, showWhenSetting: 'inCalendar' })], [def()])];
    const flag = { todo: true };
    const values = (m) => ({ inCalendar: flag[m.id] });
    assert.deepEqual(ids(destinations.resolveDestination('calendar', ctx(enabled, values))), ['cal', 'todo']);
    flag.todo = false;
    assert.deepEqual(ids(destinations.resolveDestination('calendar', ctx(enabled, values))), ['cal'], 'off hides the To-do panel only');
    assert.deepEqual(ids(destinations.resolveDestinationInSpace('calendar', { enabled, canRead: () => true, values })), ['cal'], 'the same in a space');
    assert.equal(destinations.resolveDestination('calendar', ctx(enabled, values)).main.manifest.id, 'cal');
    flag.todo = undefined;
    assert.deepEqual(ids(destinations.resolveDestination('calendar', ctx(enabled, values))), ['cal', 'todo'], 'no stored value: the default (on)');
    for (const v of [0, null, 'false', '']) {
      assert.deepEqual(ids(destinations.resolveDestination('calendar', ctx(enabled, () => ({ inCalendar: v })))), ['cal', 'todo'], `${JSON.stringify(v)} is not false`);
    }
    assert.deepEqual(ids(destinations.resolveDestination('calendar', ctx(enabled))), ['cal', 'todo'], 'no values reader: the defaults');
    assert.deepEqual(ids(destinations.resolveDestination('calendar', ctx(enabled, () => ({ inCalendar: false })))), ['cal'], 'the Calendar\'s own panel has no flag, so it stays');
  });
  await test('rules: a default of off hides the panel until it is turned on', () => {
    const enabled = [mod('cal', [main, second({ order: 10 })]), mod('todo', [second({ showWhenSetting: 'inCalendar' })], [def({ default: false })])];
    assert.deepEqual(ids(destinations.resolveDestination('calendar', ctx(enabled, () => ({})))), ['cal']);
    assert.deepEqual(ids(destinations.resolveDestination('calendar', ctx(enabled, () => ({ inCalendar: true })))), ['cal', 'todo']);
  });
  await test('rules: a setting that needs a module that is not on is ignored, its default counts', () => {
    const needy = mod('todo', [second({ showWhenSetting: 'inCalendar' })], [def({ needsModule: 'calendar' })]);
    const enabled = [mod('calendar', [main, second({ order: 10 })], [], 'bundled'), needy];
    assert.deepEqual(ids(destinations.resolveDestination('calendar', ctx(enabled, () => ({ inCalendar: false })))), ['calendar'], 'calendar is on: the value counts');
    const other = [mod('dates', [main]), needy];
    assert.deepEqual(ids(destinations.resolveDestination('calendar', ctx(other, () => ({ inCalendar: false })))), ['todo'], 'calendar is not on: false is ignored');
  });
  await test('rules: a module can hide only its own part, whatever it names', () => {
    // Hostile: a stored manifest whose flag names a setting another module has, or one of its own that is not boolean.
    const victim = mod('cal', [main, second({ order: 10 })], [def({ key: 'agenda' })]);
    const attacker = mod('evil', [second({ showWhenSetting: 'agenda' })], []);
    const seen = [];
    const values = (m) => { seen.push(m.id); return { agenda: false }; };
    assert.deepEqual(ids(destinations.resolveDestination('calendar', ctx([victim, attacker], values))), ['cal', 'evil'], 'no such setting of its own: shown');
    assert.ok(!seen.includes('cal'), 'the victim\'s settings were never read for another module\'s part');
    const wrongType = mod('evil', [second({ showWhenSetting: 'inCalendar' })], [def({ type: 'text', default: '' })]);
    assert.deepEqual(ids(destinations.resolveDestination('calendar', ctx([victim, wrongType], () => ({ inCalendar: false })))), ['cal', 'evil']);
    assert.deepEqual(ids(destinations.resolveDestination('calendar', ctx([victim, mod('evil', [second({ showWhenSetting: 'inCalendar' })], [def()])], (m) => ({ inCalendar: m.id === 'evil' })))), ['cal', 'evil'], 'its own on');
    assert.deepEqual(ids(destinations.resolveDestination('calendar', ctx([victim, mod('evil', [second({ showWhenSetting: 'inCalendar' })], [def()])], () => ({ inCalendar: false })))), ['cal'], 'its own off hides only itself');
  });
}

// --- a real server ---------------------------------------------------------------------------------------------------------
const base = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'check-flag-'));
async function startServer() {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: path.join(base, 'data'), TZ: 'UTC', ADMIN_PASSWORD: 'testpass1234' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 30000);
    const onData = (d) => { out += d; const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  const call = async (method, urlPath, { body, token, type } = {}) => {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = type || 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  const stop = () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
  return { call, stop };
}
// A throwaway upload: a module with a panel in the Calendar, optionally flagged, and settings.
function uploadZip(id, { parts, settings }) {
  const root = path.join(base, 'mods', id);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'module.json'), JSON.stringify({
    id, name: id, version: '1.0.0', scope: ['environment'], icon: 'circle',
    surfaces: { page: { entry: `${id}.html` }, destination: parts }, ...(settings ? { settings } : {}),
    permissions: [{ key: 'view', label: 'See it', default: { member: true, moderator: true, guest: true } }], access: { read: 'view' },
  }));
  fs.writeFileSync(path.join(root, 'src', `${id}.html`), '<!DOCTYPE html><html><head><style>/*__CSS__*/</style></head><body><script>/*__JS__*/</script></body></html>');
  fs.writeFileSync(path.join(root, 'src', `${id}.css`), '');
  fs.writeFileSync(path.join(root, 'src', `${id}.js`), '');
  return buildModule(root).zip;
}

let server = null;
try {
  server = await startServer();
  const { call } = server;
  const login = await call('POST', '/api/login', { body: { login: 'admin', password: 'testpass1234' } });
  assert.equal(login.status, 200);
  const admin = login.json.token;
  const install = async (id) => assert.equal((await call('POST', `/api/modules/bundled/${id}/install`, { token: admin })).status, 201);
  const turn = async (id, enabled) => { const r = await call('PATCH', `/api/modules/${id}`, { token: admin, body: { enabled, allSpaces: true } }); assert.equal(r.status, 200, r.text); };
  const panels = async () => {
    const r = await call('GET', '/api/destinations/calendar', { token: admin });
    assert.equal(r.status, 200, r.text);
    return r.json.panels.map((p) => p.module.id);
  };
  const offered = async () => (await call('GET', '/api/module-settings/environment', { token: admin })).json.modules.find((m) => m.id === 'todo')?.settings.map((d) => d.key) ?? null;
  const save = (values) => call('PUT', '/api/modules/todo/settings/environment', { token: admin, body: { values } });
  const values = async () => (await call('GET', '/api/modules/todo/settings/values', { token: admin })).json.values;

  await install('calendar');
  await install('todo');
  await turn('calendar', true);
  await turn('todo', true);
  assert.equal((await call('PATCH', '/api/settings', { token: admin, body: { showCalendar: true } })).status, 200);

  await test('live: by default the To-do panel and the Agenda are both in the Calendar', async () => {
    assert.deepEqual(await panels(), ['calendar', 'todo']);
    assert.deepEqual(await offered(), ['inCalendar']);
    assert.equal((await values()).inCalendar, true);
  });
  await test('live: turning Show in the Calendar off hides the To-do panel only, in the aggregate and in a space', async () => {
    const r = await save({ inCalendar: false });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.settings.find((d) => d.key === 'inCalendar').value, false);
    assert.deepEqual(await panels(), ['calendar'], 'the Calendar\'s Agenda stays');
    const space = (await call('POST', '/api/spaces', { token: admin, body: { name: 'Keep' } })).json.space.id;
    const inSpace = await call('GET', `/api/destinations/calendar?space=${space}`, { token: admin });
    assert.deepEqual(inSpace.json.panels.map((p) => p.module.id), ['calendar']);
    const widgets = (await call('GET', '/api/modules/widgets', { token: admin })).json.widgets;
    assert.equal(widgets.find((w) => w.id === 'todo').href, '/modules/todo', 'the tile leads to the To-do\'s own page, not the Calendar');
    assert.equal((await save({ inCalendar: true })).status, 200);
    assert.deepEqual(await panels(), ['calendar', 'todo']);
  });
  await test('live: the setting is offered, saved and counted only while the Calendar is on', async () => {
    assert.equal((await save({ inCalendar: false })).status, 200);
    await turn('calendar', false);
    assert.equal(await offered(), null, 'not offered: the To-do has no setting left to show');
    const refusal = await save({ inCalendar: true });
    assert.equal(refusal.status, 400);
    assert.equal(refusal.json.error, 'Show in the Calendar needs the Calendar module to be on');
    assert.equal((await values()).inCalendar, true, 'its stored false is ignored: the default');
    assert.equal((await save({})).status, 200, 'saving nothing is fine');
    await turn('calendar', true);
    assert.deepEqual(await offered(), ['inCalendar']);
    assert.equal((await values()).inCalendar, false, 'the stored choice is back');
    assert.equal((await save({ inCalendar: true })).status, 200);
  });
  await test('live: an uploaded module cannot hide another module\'s panel', async () => {
    // Refused at upload: a flag naming a setting it does not have (the To-do's), a wrong type, a main part, a bad shape.
    const attempt = async (id, parts, settings) => call('POST', '/api/modules', { token: admin, body: uploadZip(id, { parts, settings }), type: 'application/zip' });
    const panelOf = (extra) => [{ id: 'calendar', part: 'panel', entry: 'page-x.html', ...extra }];
    for (const [id, parts, settings, why] of [
      ['evil-a', panelOf({ showWhenSetting: 'inCalendar' }), undefined, /must name a boolean setting of this module/],
      ['evil-b', panelOf({ showWhenSetting: 'todo.inCalendar' }), undefined, /belongs on a panel/],
      ['evil-c', panelOf({ showWhenSetting: 'note' }), [{ key: 'note', label: 'Note', type: 'text', scope: 'environment' }], /must name a boolean setting/],
      ['evil-d', panelOf({ showWhenSetting: { module: 'todo', key: 'inCalendar' } }), undefined, /belongs on a panel/],
    ]) {
      const r = await attempt(id, parts.map((p) => ({ ...p, entry: `${id}.html` })), settings);
      assert.equal(r.status, 400, `${id}: ${r.text}`);
      assert.match(r.json.error, why, id);
    }
    // Accepted: its own flag hides its own panel and nothing else.
    const ok = await attempt('mine-x', [{ id: 'calendar', part: 'panel', entry: 'mine-x.html', showWhenSetting: 'show' }], [{ key: 'show', label: 'Show', type: 'boolean', scope: 'environment', default: true }]);
    assert.equal(ok.status, 201, ok.text);
    await turn('mine-x', true);
    assert.deepEqual(await panels(), ['calendar', 'todo', 'mine-x']);
    assert.equal((await call('PUT', '/api/modules/mine-x/settings/environment', { token: admin, body: { values: { show: false } } })).status, 200);
    assert.deepEqual(await panels(), ['calendar', 'todo'], 'only its own panel is gone');
    // And a setting of another module's name cannot be reached through its settings route.
    const cross = await call('PUT', '/api/modules/mine-x/settings/environment', { token: admin, body: { values: { inCalendar: false } } });
    assert.equal(cross.status, 400, 'a key the module does not declare is refused');
    assert.deepEqual(await panels(), ['calendar', 'todo']);
  });
  await test('live: a needsModule naming a module that is not installed is never offered', async () => {
    const r = await call('POST', '/api/modules', { token: admin, body: uploadZip('lonely', { parts: [], settings: [{ key: 'x', label: 'X', type: 'boolean', scope: 'environment', default: false, needsModule: 'nothing-here' }] }), type: 'application/zip' });
    assert.equal(r.status, 201, r.text);
    await turn('lonely', true);
    const list = (await call('GET', '/api/module-settings/environment', { token: admin })).json.modules;
    assert.equal(list.find((m) => m.id === 'lonely'), undefined);
    const put = await call('PUT', '/api/modules/lonely/settings/environment', { token: admin, body: { values: { x: true } } });
    assert.equal(put.status, 400);
    assert.equal(put.json.error, 'X needs the nothing-here module to be on');
    assert.equal((await call('GET', '/api/modules/lonely/settings/values', { token: admin })).json.values.x, false);
  });
} finally {
  await server?.stop();
  fs.rmSync(base, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-flag: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-flag: OK (${n} groups)`);
