#!/usr/bin/env node
/*
 * check-layout-tabs.mjs -- Workspaces, steps 1 and 2 (documentation/plans/plan-workspaces.md, GitHub #744):
 *   1. The ids. The fixed set is workspace, calendar, map, conference, whiteboard, documents. The code lists that name
 *      them agree (server/layouts.js SYSTEM_IDS and SYSTEM_ICONS, server/store.js SYSTEM_DEFAULTS, public/primary-nav.js
 *      SYSTEM_TAB_DEFAULTS, public/opens-with.js SYSTEM_TABS). Conference, Whiteboards and Documents come and go with the
 *      call service, the environment's switch, the permission and their module; a space's defaultLayout accepts them
 *      while they are on, and is refused (400) after.
 *   2. The owner's tabs. A space's `tabs` { order?, hide? }: the shape check (cleanTabs, strict for a PATCH, lenient on
 *      read), the space record, who may write it (owners, the admin and a moderator of that space), what GET
 *      .../layouts answers for each kind of viewer (the order, `shown`, `tabs` only for who may set them, a guest none),
 *      the precedence with a person's own tab (the owner's hide wins; a person may hide more, rename and re-icon), the
 *      closed-space rules, and the environment export and import round trip.
 * The shape checks and the lists run in-process; the routes run against throwaway servers.
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
const { cleanTabs, tabsOf, SYSTEM_IDS, SYSTEM_ICONS } = require('../server/layouts.js');
const { Store } = require('../server/store.js');
const { exportApp, SPACE_FIELDS } = require('../server/environment-export.js');

let n = 0;
const ok = (cond, label) => { assert.ok(cond, label); n += 1; };
const same = (got, want, label) => { assert.deepEqual(got, want, label); n += 1; };
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `check-layout-tabs-${name}-`));

const IDS = ['workspace', 'calendar', 'map', 'conference', 'whiteboard', 'documents'];

// --- the four code lists name the same ids ------------------------------------------------------------------------
{
  same([...SYSTEM_IDS], IDS, 'server/layouts.js SYSTEM_IDS');
  same(Object.keys(SYSTEM_ICONS), IDS, 'SYSTEM_ICONS names the same ids, in the same order');
  same([SYSTEM_ICONS.conference, SYSTEM_ICONS.whiteboard, SYSTEM_ICONS.documents], ['video', 'chalkboard', 'file-lines'], 'a video glyph for Conference, the modules\' own icons');
  const nav = fs.readFileSync(path.join(ROOT, 'public/primary-nav.js'), 'utf8');
  const body = /const SYSTEM_TAB_DEFAULTS = \{([^}]*)\};/.exec(nav)?.[1] || '';
  const tabs = [...body.matchAll(/(\w+): \['([^']+)', '([^']+)'\]/g)];
  same(tabs.map((m) => m[1]), IDS, 'public/primary-nav.js SYSTEM_TAB_DEFAULTS');
  same(Object.fromEntries(tabs.map((m) => [m[1], m[3]])), { ...SYSTEM_ICONS }, 'and its glyphs are the server\'s');
  const opens = fs.readFileSync(path.join(ROOT, 'public/opens-with.js'), 'utf8');
  const list = /export const SYSTEM_TABS = Object\.freeze\(\[([^\]]*)\]\)/.exec(opens)?.[1] || '';
  same([...list.matchAll(/'([^']+)'/g)].map((m) => m[1]), IDS.filter((id) => id !== 'workspace'), 'public/opens-with.js SYSTEM_TABS (every fixed layout but the Workspace)');
  const store = fs.readFileSync(path.join(ROOT, 'server/store.js'), 'utf8');
  ok(/const SYSTEM_DEFAULTS = LAYOUT_SYSTEM_IDS\.filter\(\(id\) => id !== 'workspace'\);/.test(store), 'server/store.js SYSTEM_DEFAULTS is derived from SYSTEM_IDS, so it cannot drift');
  const words = [...store.matchAll(/const SYSTEM_DEFAULT_WORDS = \{([^}]*)\}/g)][0]?.[1] || '';
  same([...words.matchAll(/(\w+): '/g)].map((m) => m[1]), IDS.filter((id) => id !== 'workspace'), 'and has a word for each');
}

// --- cleanTabs: the shape ---------------------------------------------------------------------------------------------
{
  const strict = (v) => cleanTabs(v, { strict: true });
  const refused = (v, pattern, label) => {
    const out = strict(v);
    ok(out.error && !out.tabs, `${label}: refused (${JSON.stringify(out)})`);
    assert.match(out.error, pattern, label);
    assert.match(out.error, /^[A-Z"][^\n]*\.$/, `${label}: one plain sentence`);
  };
  same(strict(null), { tabs: null }, 'null clears');
  same(strict({}), { tabs: null }, '{} clears');
  same(strict({ order: IDS }), { tabs: null }, 'the default order is nothing stored');
  same(strict({ order: [], hide: [] }), { tabs: null }, 'empty lists are nothing stored');
  same(strict({ order: ['conference', 'workspace'] }).tabs, { order: ['conference', 'workspace', 'calendar', 'map', 'whiteboard', 'documents'] }, 'a missing id is added at the end, in the default order');
  same(strict({ hide: ['documents', 'conference'] }).tabs, { hide: ['conference', 'documents'] }, 'hide is kept in the default order');
  same(strict({ order: ['documents'], hide: ['map'] }).tabs, { order: ['documents', 'workspace', 'calendar', 'map', 'conference', 'whiteboard'], hide: ['map'] });
  same(strict({ order: null, hide: ['map'] }).tabs, { hide: ['map'] }, 'null for a list is none');
  refused('map', /\{ order, hide \}/, 'text');
  refused([], /\{ order, hide \}/, 'a list');
  refused(7, /\{ order, hide \}/, 'a number');
  refused({ order: IDS, shown: [] }, /"shown"/, 'a key it does not take');
  refused({ order: 'workspace' }, /order must be a list/, 'order not a list');
  refused({ hide: { 0: 'map' } }, /hide must be a list/, 'hide not a list');
  refused({ order: ['nosuch'] }, /^There is no such layout here\.$/, 'an unknown id');
  refused({ hide: ['nosuch'] }, /^There is no such layout here\.$/, 'an unknown id in hide');
  refused({ order: [7] }, /^There is no such layout here\.$/, 'a number as an id');
  refused({ order: [null] }, /^There is no such layout here\.$/, 'null as an id');
  refused({ order: [['map']] }, /^There is no such layout here\.$/, 'a list as an id');
  refused({ order: [{ id: 'map' }] }, /^There is no such layout here\.$/, 'an object as an id');
  refused({ order: ['__proto__'] }, /^There is no such layout here\.$/, '__proto__');
  refused({ order: ['constructor'] }, /^There is no such layout here\.$/, 'constructor');
  refused({ order: ['Map'] }, /^There is no such layout here\.$/, 'a different case');
  refused({ hide: ['workspace'] }, /^The Workspace is always shown\.$/, 'the Workspace in hide');
  refused({ order: ['map', 'map'] }, /listed twice/, 'an id twice');
  refused({ hide: ['map', 'map'] }, /listed twice/, 'an id twice in hide');
  refused({ order: [...IDS, 'map'] }, /at most 6/, 'more than there are layouts');
  refused({ order: Array.from({ length: 5000 }, () => 'x') }, /at most 6/, 'a long list is cut off before it is read');
  ok(strict({ order: ['workspace'], hide: ['workspace'].slice(1) }).tabs === null, 'Workspace in order alone is the default');
  // Read (lenient): the file or an import is cleaned, never refused.
  const lenient = (v) => cleanTabs(v).tabs;
  same(lenient({ order: ['nosuch', 'map', 'map', 7, 'workspace'], hide: ['workspace', 'nosuch', 'documents', 'documents'], extra: 1 }), { order: ['map', 'workspace', 'calendar', 'conference', 'whiteboard', 'documents'], hide: ['documents'] }, 'unknown ids, repeats, the Workspace in hide and other keys are dropped');
  same(lenient('junk'), null, 'junk reads as nothing');
  same(lenient(['map']), null, 'a list reads as nothing');
  same(lenient({ order: 'map', hide: 5 }), null, 'lists that are not lists read as nothing');
  same(tabsOf(undefined), { order: IDS, hide: [] }, 'unset reads as the defaults');
  same(tabsOf({ order: ['conference'], hide: ['map'] }), { order: ['conference', 'workspace', 'calendar', 'map', 'whiteboard', 'documents'], hide: ['map'] }, 'tabsOf is whole');
  const t = tabsOf(undefined);
  t.order.push('x');
  same(tabsOf(undefined).order, IDS, 'and a copy, not the list itself');
  ok(JSON.stringify(strict({ order: [...IDS].reverse(), hide: IDS.slice(1) })).length < 400, 'the largest record is small (at most 12 ids)');
}

// --- the store: the space record --------------------------------------------------------------------------------------
{
  const dir = tmp('store');
  const store = new Store(dir);
  const a = store.addSpace({ name: 'Alpha', creator: null });
  ok(!('tabs' in a), 'a new space has no tabs');
  let space = store.updateSpace(a.id, { tabs: { order: ['conference'], hide: ['documents'] } });
  same(space.tabs, { order: ['conference', 'workspace', 'calendar', 'map', 'whiteboard', 'documents'], hide: ['documents'] }, 'kept whole');
  same(new Store(dir).spaceById(a.id).tabs, space.tabs, 'read back as written');
  space = store.updateSpace(a.id, { name: 'Alpha 2' });
  same(space.tabs, new Store(dir).spaceById(a.id).tabs, 'another field leaves it');
  assert.throws(() => store.updateSpace(a.id, { tabs: { hide: ['workspace'] } }), (e) => e.status === 400 && e.message === 'The Workspace is always shown.');
  assert.throws(() => store.updateSpace(a.id, { tabs: { order: ['nosuch'] }, name: 'Changed' }), (e) => e.status === 400);
  same([store.spaceById(a.id).name, store.spaceById(a.id).tabs.hide], ['Alpha 2', ['documents']], 'a refused change changes nothing (the name in the same body too)');
  n += 1;
  space = store.updateSpace(a.id, { tabs: { hide: ['map'] } });
  same(space.tabs, { hide: ['map'] }, 'the whole set replaces what was there');
  space = store.updateSpace(a.id, { tabs: null });
  ok(!('tabs' in space) && !('tabs' in new Store(dir).spaceById(a.id)), 'null clears it, and nothing is stored');
  store.updateSpace(a.id, { tabs: { hide: ['map'] } });
  store.updateSpace(a.id, { tabs: {} });
  ok(!('tabs' in store.spaceById(a.id)), '{} clears it');
  // A hand-edited file is cleaned on read.
  const file = path.join(dir, 'app.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.spaces.find((s) => s.id === a.id).tabs = { order: ['nosuch', 'documents', 'documents'], hide: ['workspace', 'map', 'x'], extra: 1 };
  fs.writeFileSync(file, JSON.stringify(raw));
  same(new Store(dir).spaceById(a.id).tabs, { order: ['documents', 'workspace', 'calendar', 'map', 'conference', 'whiteboard'], hide: ['map'] }, 'a stored record is cleaned on read');
  raw.spaces.find((s) => s.id === a.id).tabs = 'junk';
  fs.writeFileSync(file, JSON.stringify(raw));
  ok(!('tabs' in new Store(dir).spaceById(a.id)), 'junk reads as none');
  // defaultLayout: a fixed layout's id is accepted while it is on, refused (400) after; the stand-in says what is on.
  store.systemLayoutOn = (spaceId, id) => id === 'conference' || id === 'documents';
  same(store.updateSpace(a.id, { defaultLayout: 'conference' }).defaultLayout, 'conference', 'conference accepted while on');
  same(store.updateSpace(a.id, { defaultLayout: 'documents' }).defaultLayout, 'documents');
  assert.throws(() => store.updateSpace(a.id, { defaultLayout: 'whiteboard' }), (e) => e.status === 400 && e.message === "Whiteboards is not on in this space, so it can't be the first visit.");
  assert.throws(() => store.updateSpace(a.id, { defaultLayout: 'map' }), (e) => e.status === 400 && /^Map is not on/.test(e.message));
  same(store.spaceById(a.id).defaultLayout, 'documents', 'a refusal leaves the default');
  same(store.defaultLayoutOf(a.id), null, 'a fixed layout is not a shared layout: defaultLayoutOf answers null');
  store.updateSpace(a.id, { defaultLayout: 'workspace' });
  ok(!('defaultLayout' in store.spaceById(a.id)), 'workspace still means none');
  store.updateSpace(a.id, { defaultLayout: 'conference' });
  store.syncDefaultLayout(a.id);
  same(store.spaceById(a.id).defaultLayout, 'conference', 'a layout clean-up leaves a fixed id');
  // Removing the space takes its record (tabs live on it).
  store.removeSpace(a.id);
  ok(!store.spaceById(a.id), 'the space and its tabs go together');
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- the environment copy -----------------------------------------------------------------------------------------------
{
  ok(SPACE_FIELDS.includes('tabs'), 'tabs is on the environment copy');
  const copy = exportApp({ spaces: [{ id: 'aaaa', name: 'A', members: [], tabs: { order: ['conference'], hide: ['map'] } }, { id: 'bbbb', name: 'B', members: [] }] });
  same(copy.spaces[0].tabs, { order: ['conference'], hide: ['map'] }, 'copied');
  ok(!('tabs' in copy.spaces[1]), 'and absent where unset');
  const dir = tmp('import');
  const source = new Store(dir);
  const sp = source.addSpace({ name: 'Trip', creator: null });
  source.updateSpace(sp.id, { tabs: { order: ['documents', 'conference'], hide: ['whiteboard'] } });
  const exported = exportApp(JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8')));
  const dir2 = tmp('import2');
  fs.writeFileSync(path.join(dir2, 'app.json'), JSON.stringify({ ...exported, spaces: exported.spaces.map((s) => (s.id === sp.id ? { ...s, tabs: { ...s.tabs, order: [...s.tabs.order, 'nosuch'] } } : s)) }));
  same(new Store(dir2).spaceById(sp.id).tabs, source.spaceById(sp.id).tabs, 'an imported copy reads back the same (an unknown id in it dropped)');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
}

// --- the routes, against throwaway servers ----------------------------------------------------------------------------
const servers = [];
async function startServer(extra = {}, dir = tmp('server')) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dir, ADMIN_PASSWORD: 'testpass1234', ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 25000);
    const onData = (d) => { out += d; const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  const srv = { child, dir, port };
  srv.call = async (method, urlPath, { body, token, cookie } = {}) => {
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
  srv.expect = async (label, status, method, urlPath, options) => {
    const r = await srv.call(method, urlPath, options);
    assert.equal(r.status, status, `${label}: ${method} ${urlPath} answered ${r.status} ${r.text}`);
    if (status >= 400) assert.match(r.json?.error || '', /^[A-Z"].*\.$|^[a-z].*$/, `${label}: a sentence (${r.text})`);
    n += 1;
    return r;
  };
  servers.push(srv);
  return srv;
}
const stopAll = () => Promise.all(servers.map((s) => new Promise((resolve) => { if (s.child.exitCode !== null) return resolve(); s.child.once('exit', resolve); s.child.kill('SIGTERM'); })));

try {
  const srv = await startServer({ LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ENABLE_GUEST_DOOR: 'true' });
  const { call, expect } = srv;
  const admin = (await call('POST', '/api/login', { body: { login: 'admin', password: 'testpass1234' } })).json.token;
  for (const m of ['calendar', 'whiteboard', 'documents']) {
    await expect(`${m} installs`, 201, 'POST', `/api/modules/bundled/${m}/install`, { token: admin, body: {} });
    await expect(`${m} turns on`, 200, 'PATCH', `/api/modules/${m}`, { token: admin, body: { enabled: true } });
  }
  const mk = async (login, role = 'member') => (await expect(`make ${login}`, 201, 'POST', '/api/users', { token: admin, body: { login, displayName: login, role, password: 'memberpass1234' } })).json.user.key;
  const keys = { owner: await mk('olive', 'owner'), mod: await mk('mona'), member: await mk('mia'), other: await mk('otto'), modB: await mk('mox') };
  const space = async (name, members, entry) => {
    const id = (await expect(`space ${name}`, 200, 'POST', '/api/spaces', { token: admin, body: { name, members } })).json.space.id;
    await expect('members', 200, 'PATCH', `/api/spaces/${id}`, { token: admin, body: { members } });
    if (entry) await expect('entry', 200, 'PATCH', `/api/spaces/${id}`, { token: admin, body: { entry } });
    return id;
  };
  const A = await space('Alpha', [keys.mod, keys.member], 'guests');
  const B = await space('Beta', [keys.modB, keys.member]);
  await expect('mona moderates Alpha', 200, 'PATCH', `/api/users/${keys.mod}/spaces/${A}`, { token: admin, body: { permissions: { moderator: true } } });
  await expect('mox moderates Beta', 200, 'PATCH', `/api/users/${keys.modB}/spaces/${B}`, { token: admin, body: { permissions: { moderator: true } } });
  const T = { admin };
  for (const [who, login] of [['owner', 'olive'], ['mod', 'mona'], ['member', 'mia'], ['other', 'otto'], ['modB', 'mox']]) T[who] = (await call('POST', '/api/login', { body: { login, password: 'memberpass1234' } })).json.token;
  const link = (await expect('guest link', 200, 'POST', `/api/spaces/${A}/guest-link`, { token: admin, body: {} })).json.space.guestToken;
  const asGuest = `?guest=${encodeURIComponent(link)}`;
  const doorCookie = (await expect('door guest', 201, 'POST', '/api/guest-door', { body: { name: 'Sam' } })).cookie;
  const L = (id) => `/api/spaces/${id}/layouts`;
  const P = (id) => `/api/spaces/${id}`;
  const idsOf = async (id, token) => (await expect('ids', 200, 'GET', L(id), { token })).json.system.map((l) => l.id);

  // -- step 1: the ids come and go ---------------------------------------------------------------------------------
  same(await idsOf(A, T.member), ['workspace', 'calendar', 'conference', 'whiteboard', 'documents'], 'a member: the default order, with Map left out (no Maps)');
  let got = (await call('GET', L(A), { token: T.member })).json;
  const byId = Object.fromEntries(got.system.map((l) => [l.id, l]));
  same([byId.conference.icon, byId.whiteboard.icon, byId.documents.icon], ['video', 'chalkboard', 'file-lines'], 'icons');
  same([byId.conference.modules, byId.whiteboard.modules, byId.documents.modules], [[], [{ id: 'whiteboard', mode: 'dock' }], [{ id: 'documents', mode: 'dock' }]], 'Conference loads an empty layout; the others dock their module');
  same(got.system.map((l) => [l.tab, l.shown]), got.system.map(() => [true, true]), 'all shown, all tabs, on day one');
  same([byId.conference.defaultName, byId.whiteboard.defaultName, byId.documents.defaultName], ['Conference', 'Whiteboard', 'Documents'], 'names: the module\'s own, as the environment shows it');
  ok(!('tabs' in got), 'a member is not given the tabs');
  ok(got.canSetDefault === false, 'and cannot set them');
  for (const [who, token] of [['admin', T.admin], ['owner', T.owner], ['moderator of the space', T.mod]]) {
    const r = (await call('GET', L(A), { token })).json;
    same([r.canSetDefault, r.tabs], [true, { order: IDS, hide: [] }], `${who}: canSetDefault and the tabs, whole`);
  }
  // No existence leaks and no tabs for a guest: system is [] and nothing about tabs.
  for (const [who, query, extra] of [['guest link', asGuest, {}], ['door guest', `?space=${A}`, { cookie: doorCookie }]]) {
    const r = await call('GET', `${L(A)}${query}`, extra);
    same([r.status, r.json?.system, 'tabs' in (r.json || {}), r.json?.canSetDefault], [200, [], false, false], `${who}: no layouts, no tabs, cannot set them`);
  }
  await expect('someone not in the space', 403, 'GET', L(A), { token: T.other }); // open to guests, not to otto: he is not in it
  await expect('moderator of another space', 403, 'GET', L(A), { token: T.modB });
  await expect('nobody', 401, 'GET', L(A));
  // The module and the permission: Whiteboards and Documents follow their module and read permission; Conference the
  // permission and the environment's switch.
  await expect('members lose the whiteboard', 200, 'PATCH', '/api/roles/member', { token: admin, body: { 'module.whiteboard.view': false } });
  same(await idsOf(A, T.member), ['workspace', 'calendar', 'conference', 'documents'], 'Whiteboards is not listed without the read permission');
  same(await idsOf(A, T.mod), ['workspace', 'calendar', 'conference', 'whiteboard', 'documents'], 'a moderator also has the moderator role\'s grants, so keeps it');
  same(await idsOf(A, T.owner), IDS.filter((id) => id !== 'map'), 'the owner still has it');
  await expect('members get it back', 200, 'PATCH', '/api/roles/member', { token: admin, body: { 'module.whiteboard.view': true } });
  await expect('members lose the conference', 200, 'PATCH', '/api/roles/member', { token: admin, body: { conference: false } });
  same(await idsOf(A, T.member), ['workspace', 'calendar', 'whiteboard', 'documents'], 'Conference is not listed without the permission');
  same((await idsOf(A, T.owner)).includes('conference'), true, 'the owner keeps it');
  await expect('members get the conference back', 200, 'PATCH', '/api/roles/member', { token: admin, body: { conference: true } });
  await expect('the module turns off', 200, 'PATCH', '/api/modules/documents', { token: admin, body: { enabled: false } });
  same(await idsOf(A, T.member), ['workspace', 'calendar', 'conference', 'whiteboard'], 'Documents goes with its module');
  same(await idsOf(A, T.owner), ['workspace', 'calendar', 'conference', 'whiteboard'], 'for the owner too');
  await expect('default Documents while off', 400, 'PATCH', P(A), { token: T.owner, body: { defaultLayout: 'documents' } });
  await expect('and back on', 200, 'PATCH', '/api/modules/documents', { token: admin, body: { enabled: true } });
  await expect('the switch', 200, 'PATCH', '/api/settings', { token: admin, body: { conferenceEnabled: false } });
  same(await idsOf(A, T.owner), ['workspace', 'calendar', 'whiteboard', 'documents'], 'the environment\'s switch takes Conference from everyone, the owner included');
  let r = await expect('default conference with the switch off', 400, 'PATCH', P(A), { token: T.owner, body: { defaultLayout: 'conference' } });
  same(r.json.error, "Conference is not on in this space, so it can't be the first visit.", 'the sentence');
  await expect('the switch back', 200, 'PATCH', '/api/settings', { token: admin, body: { conferenceEnabled: true } });

  // defaultLayout accepts the new ids while they are on, and the first visit says so (a guest follows to the Workspace).
  for (const id of ['conference', 'whiteboard', 'documents']) {
    r = await expect(`default ${id}`, 200, 'PATCH', P(A), { token: T.owner, body: { defaultLayout: id } });
    same(r.json.space.defaultLayout, id, `${id} accepted`);
    same((await call('GET', L(A), { token: T.member })).json.firstVisit.layout, id, `${id}: the first visit`);
    same((await call('GET', `${L(A)}${asGuest}`)).json.firstVisit.layout, 'workspace', `${id}: a guest has no layouts, so the Workspace`);
  }
  await expect('default Map, no Maps', 400, 'PATCH', P(A), { token: T.owner, body: { defaultLayout: 'map' } });
  await expect('default nonsense', 404, 'PATCH', P(A), { token: T.owner, body: { defaultLayout: 'nosuch' } });
  await expect('default a number', 400, 'PATCH', P(A), { token: T.owner, body: { defaultLayout: 7 } });
  await expect('a member sets the default', 403, 'PATCH', P(A), { token: T.member, body: { defaultLayout: 'conference' } });
  await expect('null clears', 200, 'PATCH', P(A), { token: T.owner, body: { defaultLayout: null } });

  // -- step 2: who may write tabs -----------------------------------------------------------------------------------
  const tabs = { order: ['conference', 'workspace', 'calendar', 'map', 'whiteboard', 'documents'], hide: ['documents'] };
  for (const [who, token] of [['owner', T.owner], ['admin', T.admin], ['moderator of the space', T.mod]]) {
    r = await expect(`${who} writes tabs`, 200, 'PATCH', P(A), { token, body: { tabs: { order: ['documents'], hide: ['map'] } } });
    same(r.json.space.tabs, { order: ['documents', 'workspace', 'calendar', 'map', 'conference', 'whiteboard'], hide: ['map'] }, `${who}: stored whole`);
  }
  for (const [who, token, status] of [['a member', T.member, 403], ['a moderator of another space', T.modB, 404], ['someone not in the space', T.other, 403], ['nobody', undefined, 401]]) {
    r = await call('PATCH', P(A), { token, body: { tabs } });
    ok(r.status === status || (who === 'a moderator of another space' && r.status === 403), `${who} is refused (${r.status})`);
    ok(!JSON.stringify(r.json).includes('conference'), `${who}: the answer says nothing of the tabs`);
  }
  same((await call('GET', P(A), { token: T.admin })).json.space.tabs, { order: ['documents', 'workspace', 'calendar', 'map', 'conference', 'whiteboard'], hide: ['map'] }, 'refusals changed nothing');
  await expect('a guest link writes tabs', 401, 'PATCH', `${P(A)}${asGuest}`, { body: { tabs } });
  await expect('a door guest writes tabs', 401, 'PATCH', P(A), { cookie: doorCookie, body: { tabs } });
  // A moderator may send tabs with the other moderator fields, and not with an owners-only field.
  await expect('a moderator: tabs with opensWith', 200, 'PATCH', P(A), { token: T.mod, body: { tabs, opensWith: ['chat'] } });
  await expect('a moderator: tabs with a name', 403, 'PATCH', P(A), { token: T.mod, body: { tabs: null, name: 'Mine' } });
  same((await call('GET', P(A), { token: T.admin })).json.space.name, 'Alpha', 'and nothing of it applied');
  r = (await expect('the moderator\'s Set up read carries the tabs', 200, 'GET', P(A), { token: T.mod })).json.space;
  same(r.tabs, tabs.order && { order: tabs.order, hide: tabs.hide }, 'tabs is a moderator\'s field');
  ok(!('name' in r), 'and only the moderator\'s fields');
  await expect('the other space\'s moderator reads Set up', 403, 'GET', P(A), { token: T.modB });

  // -- bad shapes: 400, one sentence, nothing changed ---------------------------------------------------------------
  const bad = async (label, body, sentence) => {
    const res = await expect(label, 400, 'PATCH', P(A), { token: T.owner, body: { tabs: body } });
    if (sentence) assert.match(res.json.error, sentence, label);
    same((await call('GET', P(A), { token: T.admin })).json.space.tabs, tabs, `${label}: nothing changed`);
  };
  await bad('text', 'map', /\{ order, hide \}/);
  await bad('a list', ['map'], /\{ order, hide \}/);
  await bad('a number', 5, /\{ order, hide \}/);
  await bad('an unknown key', { order: IDS, shown: [] }, /"shown"/);
  await bad('order not a list', { order: 'map' }, /order must be a list/);
  await bad('an unknown id', { order: ['nosuch'] }, /^There is no such layout here\.$/);
  await bad('an id that is Object prototype', { hide: ['__proto__'] }, /^There is no such layout here\.$/);
  await bad('workspace in hide', { hide: ['workspace'] }, /^The Workspace is always shown\.$/);
  await bad('an id twice', { order: ['map', 'map'] }, /listed twice/);
  await bad('too many', { order: [...IDS, ...IDS] }, /at most 6/);
  await bad('hide with objects', { hide: [{ id: 'map' }] }, /^There is no such layout here\.$/);
  // Bounds: the largest body a person can make is small and stored whole.
  r = await expect('the largest', 200, 'PATCH', P(A), { token: T.owner, body: { tabs: { order: [...IDS].reverse(), hide: IDS.slice(1) } } });
  same(r.json.space.tabs, { order: [...IDS].reverse(), hide: IDS.slice(1) }, 'every layout but the Workspace hidden is allowed');
  r = await expect('null', 200, 'PATCH', P(A), { token: T.owner, body: { tabs: null } });
  ok(!('tabs' in r.json.space) && !('tabs' in (await call('GET', P(A), { token: T.admin })).json.space), 'null clears it: nothing is stored');
  await expect('the default order is nothing', 200, 'PATCH', P(A), { token: T.owner, body: { tabs: { order: IDS } } });
  ok(!('tabs' in (await call('GET', P(A), { token: T.admin })).json.space), 'the default order stores nothing');
  await expect('an Aside id', 404, 'PATCH', '/api/spaces/zzzz9999', { token: T.owner, body: { tabs } });
  await expect('tabs on an Aside\'s layouts', 404, 'GET', L('zzzz9999'), { token: T.owner });

  // -- GET: the owner's order, `shown`, and the person's own tab ----------------------------------------------------
  await expect('the owner sets the tabs', 200, 'PATCH', P(A), { token: T.owner, body: { tabs } });
  got = (await expect('member reads', 200, 'GET', L(A), { token: T.member })).json;
  same(got.system.map((l) => [l.id, l.shown, l.tab]), [['conference', true, true], ['workspace', true, true], ['calendar', true, true], ['whiteboard', true, true], ['documents', false, false]], 'the owner\'s order, and Documents hidden: shown false and no tab');
  same(got.system[3].modules, [{ id: 'whiteboard', mode: 'dock' }], 'the layout itself is still listed with its modules');
  ok(!('tabs' in got), 'a member still gets no tabs');
  same((await call('GET', L(A), { token: T.mod })).json.tabs, { order: tabs.order, hide: tabs.hide }, 'a moderator gets the owner\'s record');
  same((await call('GET', `${L(A)}${asGuest}`)).json.system, [], 'a guest still has none');
  // The person's own choices: rename and re-icon any tab; hide more; not hide what is already hidden; not reorder.
  const SYS = `${L(A)}/system`;
  r = await expect('rename Documents (hidden)', 200, 'PATCH', `${SYS}/documents`, { token: T.member, body: { name: 'Papers', icon: 'couch' } });
  same([r.json.layout.name, r.json.layout.icon, r.json.layout.shown, r.json.layout.tab], ['Papers', 'couch', false, false], 'a person may rename and re-icon a hidden tab; it stays hidden');
  r = await expect('rename Conference', 200, 'PATCH', `${SYS}/conference`, { token: T.member, body: { name: 'Call page' } });
  same(r.json.layout.name, 'Call page', 'rename a shown one');
  r = await expect('hide more', 200, 'PATCH', `${SYS}/whiteboard`, { token: T.member, body: { tab: false } });
  same([r.json.layout.tab, r.json.layout.shown], [false, true], 'a person may hide more for themselves: tab off, but not hidden by the owner');
  same((await call('GET', L(A), { token: T.mod })).json.system.find((l) => l.id === 'whiteboard').tab, true, "and it is only theirs: the moderator's tab is on");
  r = await expect('tab on for a hidden one', 409, 'PATCH', `${SYS}/documents`, { token: T.member, body: { tab: true } });
  same(r.json.error, 'The owner has hidden this layout.', 'the sentence');
  await expect('tab off for a hidden one', 409, 'PATCH', `${SYS}/documents`, { token: T.member, body: { tab: false } });
  await expect('tab with a name, hidden', 409, 'PATCH', `${SYS}/documents`, { token: T.member, body: { tab: true, name: 'x' } });
  same((await call('GET', L(A), { token: T.member })).json.system.find((l) => l.id === 'documents').name, 'Papers', 'a refusal changes nothing');
  r = await expect('favorite a hidden one', 409, 'PUT', `${L(A)}/documents/favorite`, { token: T.member });
  same(r.json.error, 'The owner has hidden this layout.');
  await expect('unfavorite a hidden one', 409, 'DELETE', `${L(A)}/documents/favorite`, { token: T.member });
  await expect('favorite a shown one', 200, 'PUT', `${L(A)}/whiteboard/favorite`, { token: T.member });
  await expect('favorite a missing one (Map, no Maps)', 404, 'PUT', `${L(A)}/map/favorite`, { token: T.member });
  await expect('Workspace is always shown', 400, 'DELETE', `${L(A)}/workspace/favorite`, { token: T.member });
  // The precedence: the owner shows a tab again; the person's own hide (stored before) is still theirs, and a hide the
  // person made while it was hidden never happened.
  await expect('the owner shows Documents again', 200, 'PATCH', P(A), { token: T.owner, body: { tabs: { order: tabs.order } } });
  got = (await call('GET', L(A), { token: T.member })).json;
  same(got.system.map((l) => [l.id, l.tab]), [['conference', true], ['workspace', true], ['calendar', true], ['whiteboard', true], ['documents', true]], 'shown again; the person\'s whiteboard tab was turned back on by the favorite');
  same(got.system.find((l) => l.id === 'documents').name, 'Papers', 'their name for it is still theirs');
  // A person's own hide survives the owner's change of order, and is not the owner's.
  await expect('hide Calendar for me', 200, 'PATCH', `${SYS}/calendar`, { token: T.member, body: { tab: false } });
  await expect('the owner reorders', 200, 'PATCH', P(A), { token: T.owner, body: { tabs: { order: ['calendar', 'documents'] } } });
  same((await call('GET', L(A), { token: T.member })).json.system.map((l) => [l.id, l.tab]), [['calendar', false], ['documents', true], ['workspace', true], ['conference', true], ['whiteboard', true]], 'the order is the owner\'s; Calendar stays hidden for that person only');
  same((await call('GET', L(A), { token: T.mod })).json.system.find((l) => l.id === 'calendar').tab, true, 'and not for others');
  // Workspace can be anywhere in the order, and is never hidden.
  same((await call('GET', L(A), { token: T.mod })).json.tabs.hide, [], 'nothing hidden');

  // -- closed spaces: the rules of #762 are not weakened ------------------------------------------------------------
  await expect('close Alpha', 200, 'PATCH', P(A), { token: T.mod, body: { closed: true } });
  for (const [who, token, status] of [['a member', T.member, 403], ['someone outside', T.other, 403]]) {
    r = await call('GET', L(A), { token });
    ok(r.status === status && !JSON.stringify(r.json).includes('"system"'), `${who}: a closed space's layouts are not read (${r.status} ${r.text})`);
    r = await call('PATCH', P(A), { token, body: { tabs } });
    ok(r.status === 403 || r.status === 404, `${who}: a closed space's tabs are not written (${r.status})`);
    ok(!JSON.stringify(r.json).includes('conference'), `${who}: and the refusal says nothing of them`);
  }
  r = await call('GET', `${L(A)}${asGuest}`);
  ok(r.status === 401 && !('system' in r.json), `a guest link: not signed in to a closed space, no layouts (${r.status} ${r.text})`);
  r = await call('GET', L(A), { cookie: doorCookie });
  ok(r.status !== 200 && !('system' in (r.json || {})), `a door guest: no layouts of a closed space (${r.status})`);
  r = await call('PATCH', P(A), { cookie: doorCookie, body: { tabs } });
  ok(r.status !== 200, `a door guest: no tabs written (${r.status})`);
  ok((await call('GET', L(A), { token: T.mod })).status === 200 && (await call('GET', L(A), { token: T.owner })).status === 200, 'the space\'s moderator and the owner still read it');
  await expect('a moderator writes tabs of a closed space', 200, 'PATCH', P(A), { token: T.mod, body: { tabs: { hide: ['map'] } } });
  await expect('another space\'s moderator', 403, 'PATCH', P(A), { token: T.modB, body: { tabs: null } });
  await expect('reopen', 200, 'PATCH', P(A), { token: T.mod, body: { closed: false } });

  // -- the spaces are separate, and a removed space takes its tabs ---------------------------------------------------
  await expect('Beta tabs', 200, 'PATCH', P(B), { token: T.modB, body: { tabs: { hide: ['conference'] } } });
  const conferenceIn = async (id) => (await call('GET', L(id), { token: T.member })).json.system.find((l) => l.id === 'conference');
  same((await conferenceIn(B)).shown, false, 'Beta hides Conference (still listed, not shown)');
  same((await conferenceIn(A)).shown, true, 'Alpha does not');
  await expect('a moderator of Beta writes Alpha', 403, 'PATCH', P(A), { token: T.modB, body: { tabs: null } });
  await expect('remove Beta', 200, 'DELETE', P(B), { token: admin });
  await expect('and its layouts are gone', 404, 'GET', L(B), { token: T.admin });

  // -- the environment copy round trip over the server's own export -------------------------------------------------
  await expect('the owner sets Alpha\'s tabs', 200, 'PATCH', P(A), { token: T.owner, body: { tabs } });
  const spaceNow = (await call('GET', P(A), { token: T.admin })).json.space;
  same(spaceNow.tabs, { order: tabs.order, hide: tabs.hide }, 'the record at rest');
  const saved = JSON.parse(fs.readFileSync(path.join(srv.dir, 'app.json'), 'utf8')).spaces.find((s) => s.id === A);
  same(saved.tabs, spaceNow.tabs, 'stored in app.json on the space');
  same(exportApp(JSON.parse(fs.readFileSync(path.join(srv.dir, 'app.json'), 'utf8'))).spaces.find((s) => s.id === A).tabs, spaceNow.tabs, 'and carried by the environment copy');
  console.log(`check-layout-tabs: OK (${n} checks)`);
} finally {
  await stopAll();
}
