#!/usr/bin/env node
/*
 * check-fixed-workspaces.mjs -- Workspaces, step 12, the server half (documentation/plans/plan-workspaces.md, decisions
 * 33 to 35, GitHub #744): the schema of the Fixed Workspaces, server/fixed-workspaces.js, and what GET
 * /api/spaces/:id/layouts answers from it.
 *   1. The list. Every Fixed Workspace (every system layout but the Workspace) is a key of the schema and nothing else is;
 *      each entry is { module, setting } and nothing more; the module is a bundled one that can be on in a space; the
 *      setting exists in its manifest, is a boolean, and its scope is one the module has; a `needsModule` it names is a
 *      bundled module too; no setting is listed twice for one workspace. The check is run against the real list and
 *      against bad lists (the validator must refuse each).
 *   2. The answer. In each Fixed Workspace's entry `settings` is an array: one switch for Calendar (the To-do's
 *      `inCalendar`), [] for the rest; the Workspace has no `settings`. Only while the setting is offered (the module is
 *      on, readable by the viewer, its `needsModule` on). Every kind of viewer: admin, owner, moderator, member, a guest
 *      link, a door guest, nobody. The switch writes as an ordinary module setting; the closed-space rules are as before.
 * The list is checked in-process; the answer against a throwaway server.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { SYSTEM_IDS } = require('../server/layouts.js');
const { FIXED_WORKSPACE_SETTINGS } = require('../server/fixed-workspaces.js');

let n = 0;
const ok = (cond, label) => { assert.ok(cond, label); n += 1; };
const same = (got, want, label) => { assert.deepEqual(got, want, label); n += 1; };
const FIXED = SYSTEM_IDS.filter((id) => id !== 'workspace');

const manifestOf = (id) => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', id, 'module.json'), 'utf8')); } catch { return null; }
};

// The problems of a schema, one sentence each (none: it is sound). `manifests(id)` answers a module's manifest or null.
function problems(table, manifests = manifestOf) {
  const out = [];
  if (!table || typeof table !== 'object' || Array.isArray(table)) return ['the schema is not an object'];
  for (const id of FIXED) if (!(id in table)) out.push(`${id} is a Fixed Workspace and has no entry (an empty list says it offers nothing)`);
  for (const id of Object.keys(table)) if (!FIXED.includes(id)) out.push(`${id} is not a Fixed Workspace`);
  for (const [id, list] of Object.entries(table)) {
    if (!Array.isArray(list)) { out.push(`${id}: its entry is not a list`); continue; }
    const seen = new Set();
    for (const item of list) {
      const what = `${id}: ${JSON.stringify(item)}`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) { out.push(`${what} is not { module, setting }`); continue; }
      const extra = Object.keys(item).find((k) => k !== 'module' && k !== 'setting');
      if (extra) out.push(`${what} has "${extra}": only module and setting`);
      if (typeof item.module !== 'string' || typeof item.setting !== 'string') { out.push(`${what} needs a module and a setting, both text`); continue; }
      if (seen.has(`${item.module}/${item.setting}`)) out.push(`${what} is listed twice`);
      seen.add(`${item.module}/${item.setting}`);
      const manifest = manifests(item.module);
      if (!manifest) { out.push(`${what}: there is no bundled module ${item.module}, so it can never be on`); continue; }
      if (!Array.isArray(manifest.scope) || !manifest.scope.includes('space')) out.push(`${what}: ${item.module} has no space scope, so it cannot be on in a space`);
      const def = (manifest.settings || []).find((d) => d.key === item.setting);
      if (!def) { out.push(`${what}: ${item.module} has no setting ${item.setting}`); continue; }
      if (def.type !== 'boolean') out.push(`${what}: ${item.setting} is ${def.type}, not a boolean`);
      if (!['environment', 'space', 'person'].includes(def.scope) || !manifest.scope.includes(def.scope === 'person' ? 'environment' : def.scope)) out.push(`${what}: its scope ${def.scope} is not one ${item.module} has`);
      if (def.needsModule && !manifests(def.needsModule)) out.push(`${what}: it needs the module ${def.needsModule}, which there is not`);
    }
  }
  return out;
}

// --- 1. the list ---------------------------------------------------------------------------------------------------------------
{
  same(problems(FIXED_WORKSPACE_SETTINGS), [], 'the schema in server/fixed-workspaces.js is sound');
  same(Object.keys(FIXED_WORKSPACE_SETTINGS), FIXED, 'one entry per Fixed Workspace, in the default order, and none for the Workspace');
  same(FIXED_WORKSPACE_SETTINGS.calendar, [{ module: 'todo', setting: 'inCalendar' }], 'Calendar offers the To-do switch');
  same(FIXED.filter((id) => FIXED_WORKSPACE_SETTINGS[id].length), ['calendar'], 'and it is the only one that offers anything');
  ok(Object.isFrozen(FIXED_WORKSPACE_SETTINGS) && Object.isFrozen(FIXED_WORKSPACE_SETTINGS.calendar) && Object.isFrozen(FIXED_WORKSPACE_SETTINGS.calendar[0]), 'the list cannot be changed while the server runs');
  // The To-do's own panel flag names the same setting, so the switch and the panel are one thing.
  const todo = manifestOf('todo');
  same(todo.surfaces.destination.find((p) => p.id === 'calendar').showWhenSetting, 'inCalendar', "the To-do panel's showWhenSetting is the setting the Calendar offers");
  same(todo.settings.find((d) => d.key === 'inCalendar').needsModule, 'calendar', 'and it needs the Calendar');

  // The validator refuses every kind of bad list.
  const good = JSON.parse(JSON.stringify(FIXED_WORKSPACE_SETTINGS));
  const bad = (label, change, pattern) => {
    const table = JSON.parse(JSON.stringify(good));
    change(table);
    const found = problems(table);
    ok(found.length > 0 && found.some((p) => pattern.test(p)), `${label} fails the check (${found.join('; ') || 'passed'})`);
  };
  bad('a Fixed Workspace missing', (t) => { delete t.map; }, /map is a Fixed Workspace and has no entry/);
  bad('every one missing', (t) => { delete t.documents; delete t.whiteboard; }, /whiteboard is a Fixed Workspace/);
  bad('an unknown key', (t) => { t.nosuch = []; }, /nosuch is not a Fixed Workspace/);
  bad('the Workspace given an entry', (t) => { t.workspace = []; }, /workspace is not a Fixed Workspace/);
  bad('an entry that is not a list', (t) => { t.map = { module: 'todo' }; }, /map: its entry is not a list/);
  bad('a setting that does not exist', (t) => { t.map = [{ module: 'todo', setting: 'nosuch' }]; }, /no setting nosuch/);
  bad('a setting that is not a boolean', (t) => { t.map = [{ module: 'todo', setting: 'inCalendar' }]; t.documents = [{ module: 'maps', setting: 'mapFiles' }]; }, /not a boolean|no setting/);
  bad('a module that is not there', (t) => { t.map = [{ module: 'nosuchmodule', setting: 'x' }]; }, /no bundled module nosuchmodule/);
  bad('a module with no space scope', (t) => { t.map = [{ module: 'nospace', setting: 'x' }]; }, /nospace/);
  bad('an extra key', (t) => { t.calendar[0].label = 'x'; }, /only module and setting/);
  bad('a setting listed twice', (t) => { t.calendar.push({ module: 'todo', setting: 'inCalendar' }); }, /listed twice/);
  bad('an entry that is text', (t) => { t.calendar = ['todo']; }, /not \{ module, setting \}/);
  // A non-boolean, a module that cannot be on and a needsModule with no module, against stand-in manifests.
  const fake = {
    todo: { scope: ['environment', 'space'], settings: [{ key: 'flag', type: 'boolean', scope: 'environment' }, { key: 'text', type: 'string', scope: 'environment' }, { key: 'needy', type: 'boolean', scope: 'environment', needsModule: 'ghost' }, { key: 'spacey', type: 'boolean', scope: 'space' }] },
    envonly: { scope: ['environment'], settings: [{ key: 'flag', type: 'boolean', scope: 'environment' }] },
  };
  const stand = (id) => fake[id] || null;
  const one = (item) => problems({ calendar: [item], map: [], conference: [], whiteboard: [], documents: [] }, stand);
  same(one({ module: 'todo', setting: 'flag' }), [], 'a boolean of a module that can be on passes');
  same(one({ module: 'todo', setting: 'spacey' }), [], 'a space setting of a module with space scope passes');
  ok(one({ module: 'todo', setting: 'text' }).some((p) => /not a boolean/.test(p)), 'a string setting fails');
  ok(one({ module: 'envonly', setting: 'flag' }).some((p) => /cannot be on in a space/.test(p)), 'a module with no space scope fails');
  ok(one({ module: 'todo', setting: 'needy' }).some((p) => /needs the module ghost/.test(p)), 'a needsModule that is not there fails');
  ok(one({ module: 'todo', setting: 'flag', extra: 1 }).length > 0, 'an extra key fails');
}

// --- 2. the answer, against a throwaway server ---------------------------------------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-fixed-workspaces-'));
const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dir, ADMIN_PASSWORD: 'testpass1234', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ENABLE_GUEST_DOOR: 'true' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
const stop = () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
try {
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 25000);
    const onData = (d) => { out += d; const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  const call = async (method, urlPath, { body, token, cookie } = {}) => {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    if (cookie) headers.cookie = cookie;
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  };
  const expect = async (label, status, method, urlPath, options) => {
    const r = await call(method, urlPath, options);
    assert.equal(r.status, status, `${label}: ${method} ${urlPath} answered ${r.status} ${r.text}`);
    n += 1;
    return r;
  };
  const admin = (await call('POST', '/api/login', { body: { login: 'admin', password: 'testpass1234' } })).json.token;
  for (const m of ['calendar', 'todo', 'whiteboard', 'documents']) {
    await expect(`${m} installs`, 201, 'POST', `/api/modules/bundled/${m}/install`, { token: admin, body: {} });
    await expect(`${m} turns on`, 200, 'PATCH', `/api/modules/${m}`, { token: admin, body: { enabled: true } });
  }
  const mk = async (login, role = 'member') => (await expect(`make ${login}`, 201, 'POST', '/api/users', { token: admin, body: { login, displayName: login, role, password: 'memberpass1234' } })).json.user.key;
  const keys = { owner: await mk('olive', 'owner'), mod: await mk('mona'), member: await mk('mia'), other: await mk('otto') };
  const A = (await expect('space', 200, 'POST', '/api/spaces', { token: admin, body: { name: 'Alpha', members: [keys.mod, keys.member] } })).json.space.id;
  await expect('members', 200, 'PATCH', `/api/spaces/${A}`, { token: admin, body: { members: [keys.mod, keys.member], entry: 'guests' } });
  await expect('mona moderates', 200, 'PATCH', `/api/users/${keys.mod}/spaces/${A}`, { token: admin, body: { permissions: { moderator: true } } });
  const T = { admin };
  for (const [who, login] of [['owner', 'olive'], ['mod', 'mona'], ['member', 'mia'], ['other', 'otto']]) T[who] = (await call('POST', '/api/login', { body: { login, password: 'memberpass1234' } })).json.token;
  const link = (await expect('guest link', 200, 'POST', `/api/spaces/${A}/guest-link`, { token: admin, body: {} })).json.space.guestToken;
  const asGuest = `?guest=${encodeURIComponent(link)}`;
  const doorCookie = (await expect('door guest', 201, 'POST', '/api/guest-door', { body: { name: 'Sam' } })).cookie;
  const L = `/api/spaces/${A}/layouts`;
  const system = async (token) => (await expect('layouts', 200, 'GET', L, { token })).json.system;
  const entry = (list, id) => list.find((l) => l.id === id);
  const offered = (canChange, value = true) => [{ module: 'todo', moduleName: 'To-do', key: 'inCalendar', label: 'Show in the Calendar', type: 'boolean', scope: 'environment', value, canChange, help: "The list also appears in the Calendar's side panel. Dated tasks stay on the Calendar's days either way." }];

  // Every viewer who has layouts gets the same list for the schema; canChange follows who may write the environment's setting.
  for (const [who, token, canChange] of [['admin', T.admin, true], ['owner', T.owner, true], ['moderator', T.mod, false], ['member', T.member, false]]) {
    const list = await system(token);
    same(entry(list, 'calendar').settings, offered(canChange), `${who}: Calendar offers the To-do switch (canChange ${canChange})`);
    for (const id of ['conference', 'whiteboard', 'documents']) same(entry(list, id).settings, [], `${who}: ${id} offers nothing: an empty list`);
    ok(!('settings' in entry(list, 'workspace')), `${who}: the Workspace has no settings: its Modules tab is the canvas menu`);
    same(list.map((l) => l.id), ['workspace', 'calendar', 'conference', 'whiteboard', 'documents'], `${who}: the layouts are as before`);
  }
  for (const [who, query, extra] of [['guest link', asGuest, {}], ['door guest', `?space=${A}`, { cookie: doorCookie }]]) {
    const g = await expect(who, 200, 'GET', `${L}${query}`, extra);
    same(g.json.system, [], `${who}: no layouts, so no settings`);
  }
  await expect('nobody signed in', 401, 'GET', L);

  // The value is the module's ordinary setting: the switch writes it, the answer follows, for everyone.
  await expect('a member cannot write the setting', 403, 'PUT', '/api/modules/todo/settings/environment', { token: T.member, body: { values: { inCalendar: false } } });
  await expect('a moderator cannot write the environment\'s setting', 403, 'PUT', '/api/modules/todo/settings/environment', { token: T.mod, body: { values: { inCalendar: false } } });
  same(entry(await system(T.member), 'calendar').settings[0].value, true, 'refused writes change nothing');
  await expect('the owner switches it off', 200, 'PUT', '/api/modules/todo/settings/environment', { token: T.owner, body: { values: { inCalendar: false } } });
  for (const [who, token] of [['admin', T.admin], ['owner', T.owner], ['moderator', T.mod], ['member', T.member]]) {
    same(entry(await system(token), 'calendar').settings[0].value, false, `${who}: the value follows the setting`);
  }
  same((await call('GET', '/api/modules/todo/settings/values?scope=space&space=' + A, { token: T.member })).json.values.inCalendar, false, 'and it is what the module itself reads');
  await expect('and on', 200, 'PUT', '/api/modules/todo/settings/environment', { token: T.owner, body: { values: { inCalendar: true } } });
  same(entry(await system(T.member), 'calendar').settings[0].value, true, 'back on');

  // Only while the setting is offered: the module is on, readable by the viewer, its needsModule is on.
  await expect('members lose the To-do', 200, 'PATCH', '/api/roles/member', { token: admin, body: { 'module.todo.view': false } });
  same(entry(await system(T.member), 'calendar').settings, [], 'a person who cannot read the To-do is not offered its switch');
  same(entry(await system(T.owner), 'calendar').settings.length, 1, 'the owner still is');
  await expect('members get it back', 200, 'PATCH', '/api/roles/member', { token: admin, body: { 'module.todo.view': true } });
  same(entry(await system(T.member), 'calendar').settings.length, 1, 'and so is the member again');
  await expect('the To-do turns off', 200, 'PATCH', '/api/modules/todo', { token: admin, body: { enabled: false } });
  for (const [who, token] of [['owner', T.owner], ['member', T.member]]) same(entry(await system(token), 'calendar').settings, [], `${who}: no switch for a module that is off`);
  await expect('the To-do on again', 200, 'PATCH', '/api/modules/todo', { token: admin, body: { enabled: true } });
  same(entry(await system(T.member), 'calendar').settings.length, 1, 'back with the module');
  await expect('the Calendar turns off', 200, 'PATCH', '/api/modules/calendar', { token: admin, body: { enabled: false } });
  same((await system(T.owner)).map((l) => l.id), ['workspace', 'conference', 'whiteboard', 'documents'], 'no Calendar: no Calendar entry, so no switch');
  await expect('the Calendar on again', 200, 'PATCH', '/api/modules/calendar', { token: admin, body: { enabled: true } });
  same(entry(await system(T.owner), 'calendar').settings.length, 1, 'back');

  // The person's own routes answer it too, and the owner's hide does not remove it.
  const patched = (await expect('rename Calendar', 200, 'PATCH', `${L}/system/calendar`, { token: T.member, body: { name: 'Plans' } })).json.layout;
  same(patched.settings, offered(false), "a person's own change answers the layout with its settings");
  await expect('the owner hides Calendar', 200, 'PATCH', `/api/spaces/${A}`, { token: T.owner, body: { tabs: { hide: ['calendar'] } } });
  same(entry(await system(T.member), 'calendar').settings.length, 1, 'a hidden tab still has its Modules tab');
  await expect('and shows it', 200, 'PATCH', `/api/spaces/${A}`, { token: T.owner, body: { tabs: null } });

  // The closed-space rules (#762) are as before: a closed space's layouts are not read by those outside it.
  await expect('close Alpha', 200, 'PATCH', `/api/spaces/${A}`, { token: T.mod, body: { closed: true } });
  for (const [who, token] of [['a member', T.member], ['someone outside', T.other]]) {
    const r = await call('GET', L, { token });
    ok(r.status === 403 && !r.text.includes('inCalendar'), `${who}: a closed space's layouts are not read, and nothing of the settings leaks (${r.status})`);
  }
  const closedGuest = await call('GET', `${L}${asGuest}`);
  ok(closedGuest.status !== 200 && !closedGuest.text.includes('inCalendar'), `a guest link: refused (${closedGuest.status})`);
  same(entry(await system(T.mod), 'calendar').settings.length, 1, 'the moderator still reads it');
  await expect('reopen', 200, 'PATCH', `/api/spaces/${A}`, { token: T.mod, body: { closed: false } });

  // The Aside.
  await expect('an Aside id', 404, 'GET', '/api/spaces/zzzz9999/layouts', { token: T.owner });
  console.log(`check-fixed-workspaces: OK (${n} checks)`);
} finally {
  await stop();
  fs.rmSync(dir, { recursive: true, force: true });
}
