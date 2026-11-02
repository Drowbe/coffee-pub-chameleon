#!/usr/bin/env node
/*
 * check-destinations.mjs -- the top bar's destinations (documentation/plans/plan-calendar-destination.md, "Server" and
 * Verify step 1; shared with plan-map-destination.md, which adds the map's own cases in its step 1):
 *   - surfaces.destination in cleanManifest: a good list, and each refusal (an unknown destination, two mains, an entry
 *     missing from the zip, three parts, no environment scope); `map` is a known id;
 *   - one main per destination: the bundled module that declares it, else the first in id order; panels by `order`;
 *   - GET /api/destinations and /api/destinations/:id: nothing with the option off, with the main off or unreadable at
 *     environment level, for a guest or nobody signed in; the destination otherwise, without a panel that is off or
 *     unreadable; its spaces the union of its parts' readable spaces;
 *   - `write` in GET /api/modules/:id/spaces-data for a member with and without the module's edit permission;
 *   - an environment page's write into a space (scope=space) for data, schedule and notify: accepted for a member of
 *     that space with edit, refused for a non-member and for a member without edit;
 *   - an environment page's action on an object in a space (decision 21), listed, asked for and taken by that space's
 *     permissions: a member who may edit the To-do only in one space may set a task's due date there, not in another
 *     space nor at environment level; a reader, a non-member and a guest are refused; a page in a space as before;
 *   - /modules/<id> leading to /calendar while it is shown (not with ?space=, not with the option off), the tiles'
 *     `href` (a panel's with #panel=<module id>, a main's bare), and /calendar itself;
 *   - with no destination page built yet (public/destination.html), nothing leads to it;
 *   - Travel's template giving showCalendar: true, and a single install with nothing set behaving as before.
 * And the Map's (plan-map-destination.md, Verify step 1):
 *   - `map` shown only with Show Map on, its main enabled and readable at environment level, and a map file that is
 *     there (ticked on a single install); never for a guest; without its panel when that is unreadable; Manage's reason
 *     (GET /api/settings, topBarReasons) when its main is off or has no file;
 *   - the main's file route answering at environment scope (a range read);
 *   - GET /api/objects/search?scope=spaces&has=place: only the viewer's spaces where the provider is on and readable,
 *     each pointer with its space, only summaries with a place, and more than 50 of them; refused for a guest;
 *   - a place written into a space (scope=space) only by a member with edit there;
 *   - /modules/<id> leading to /map while it is shown, not with ?space=, not with the option off; the tile's href (#panel=);
 *   - Travel's template giving showMap: true.
 * And a destination as a view of one space (plan-calendar-todo.md and plan-map-places.md, step 1):
 *   - GET /api/destinations/:id?space=<id> and the page with ?space=: the parts whose module is on in that space and
 *     readable by the viewer there (a guest with the space's token included), `spaces` empty and `space` named,
 *     whatever the option says; 404 (one sentence) for anyone not in it and for an unknown id; the map's file still needed.
 * The server runs from a throwaway copy of the app whose public/ links to the real one's files, with or without a
 * stand-in destination.html, so the check does not depend on whether that page is built yet. No network beyond
 * localhost, no LiveKit.
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
const { cleanManifest, manifestTexts, readZip } = require('../server/modules.js');
const { buildModule, bundledModules } = require('../server/module-build.js');
const destinations = require('../server/destinations.js');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    n += 1;
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}\n${err.stack || err}`);
  }
};
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-destinations-'));

// --- the manifest field -------------------------------------------------------------------------------------------
{
  const files = new Map([['page.html', Buffer.from('')], ['canvas.html', Buffer.from('')]]);
  const manifest = (destination, scope = ['environment', 'space']) => ({
    id: 'dates', name: 'Dates', version: '1.0.0', scope,
    surfaces: { page: { entry: 'page.html' }, canvas: { entry: 'canvas.html' }, destination },
  });
  const refused = (destination, sentence, scope) => assert.throws(() => cleanManifest(manifest(destination, scope), files), (err) => {
    assert.equal(err.message, sentence);
    return true;
  });

  await test('manifest: a main and a panel for the calendar are kept, tidied', () => {
    const m = cleanManifest(manifest([
      { id: 'calendar', part: 'main', entry: 'page.html' },
      { id: 'calendar', part: 'panel', entry: 'page.html', label: '  Agenda ', order: 10.4 },
    ]), files);
    assert.deepEqual(m.surfaces.destination, [
      { id: 'calendar', part: 'main', entry: 'page.html' },
      { id: 'calendar', part: 'panel', entry: 'page.html', label: 'Agenda', order: 10 },
    ]);
    assert.equal(cleanManifest(manifest(undefined), files).surfaces.destination, undefined, 'none declared, none kept');
  });

  await test('manifest: map is a known destination', () => {
    const m = cleanManifest(manifest([{ id: 'map', part: 'panel', entry: 'page.html' }]), files);
    assert.deepEqual(m.surfaces.destination, [{ id: 'map', part: 'panel', entry: 'page.html' }]);
  });

  await test('manifest: each refusal says why', () => {
    refused([{ id: 'agenda', part: 'main', entry: 'page.html' }], 'module.json: surfaces.destination: "agenda" is not a destination; the destinations are calendar and map');
    refused([{ id: 'calendar', part: 'main', entry: 'page.html' }, { id: 'calendar', part: 'main', entry: 'canvas.html' }], 'module.json: surfaces.destination: only one main part for calendar');
    refused([{ id: 'calendar', part: 'main', entry: 'gone.html' }], "surfaces.destination (calendar main) entry gone.html isn't in the zip");
    refused([{ id: 'calendar', part: 'main', entry: 'page.html' }, { id: 'calendar', part: 'panel', entry: 'page.html' }, { id: 'map', part: 'panel', entry: 'page.html' }], 'module.json: surfaces.destination lists at most two parts');
    refused([{ id: 'calendar', part: 'side', entry: 'page.html' }], 'module.json: surfaces.destination: a part must be "main" or "panel"');
    refused({ id: 'calendar' }, 'module.json: surfaces.destination must be a list of parts');
    refused([{ id: 'calendar', part: 'main', entry: 'page.html', size: 'wide' }], 'module.json: surfaces.destination: "size" is not a part\'s field; the fields are id, part, entry, label, order');
    refused([{ id: 'calendar', part: 'panel', entry: 'page.html', order: 'first' }], 'module.json: surfaces.destination: a part\'s order must be a number');
    refused([{ id: 'calendar', part: 'main', entry: 'canvas.html' }], 'module.json: surfaces.destination needs the "environment" scope', ['space']);
  });

  await test('manifest: a part\'s label is manifest text, filled with the environment\'s words', () => {
    const m = cleanManifest(manifest([{ id: 'calendar', part: 'panel', entry: 'page.html', label: 'Per {space}' }]), files);
    assert.ok(manifestTexts(m).some(([o, k]) => o === m.surfaces.destination[0] && k === 'label'));
  });

  await test('manifest: every bundled module that declares a part builds and installs', async () => {
    for (const m of bundledModules(path.join(ROOT, 'modules')).filter((x) => x.surfaces?.destination)) {
      const zipped = await readZip(buildModule(path.join(ROOT, 'modules', m.id)).zip);
      assert.ok(cleanManifest(m, zipped).surfaces.destination.length, m.id);
    }
  });
}

// --- the rules on their own ---------------------------------------------------------------------------------------
{
  const mod = (id, parts, source = 'upload') => ({ manifest: { id, scope: ['environment'], surfaces: { destination: parts } }, entry: { id, source } });
  const main = { id: 'calendar', part: 'main', entry: 'p.html' };
  const panel = (order) => ({ id: 'calendar', part: 'panel', entry: 'p.html', ...(order === undefined ? {} : { order }) });
  const on = { showCalendar: true };
  const all = () => true;

  await test('rules: the bundled main wins, else the first in id order; panels by order, then id', () => {
    const enabled = [mod('zz', [main], 'bundled'), mod('aa', [main]), mod('pp', [panel(5)]), mod('bb', [panel()]), mod('cc', [panel(5)])];
    const d = destinations.resolveDestination('calendar', { settings: on, enabled, canRead: all });
    assert.equal(d.main.manifest.id, 'zz');
    assert.deepEqual(d.panels.map((p) => p.manifest.id), ['cc', 'pp', 'bb']);
    assert.equal(destinations.resolveDestination('calendar', { settings: on, enabled: enabled.slice(1), canRead: all }).main.manifest.id, 'aa');
  });

  await test('rules: the option off, no main, or a main the viewer cannot read: not shown; an unreadable panel left out', () => {
    const enabled = [mod('cal', [main, panel(1)]), mod('todo', [panel(2)])];
    assert.equal(destinations.resolveDestination('calendar', { settings: {}, enabled, canRead: all }), null);
    assert.equal(destinations.resolveDestination('calendar', { settings: { showCalendar: 'yes' }, enabled, canRead: all }), null, 'only true turns it on');
    assert.equal(destinations.resolveDestination('calendar', { settings: on, enabled: enabled.slice(1), canRead: all }), null, 'panels without a main');
    assert.equal(destinations.resolveDestination('calendar', { settings: on, enabled, canRead: (m) => m.id !== 'cal' }), null);
    const d = destinations.resolveDestination('calendar', { settings: on, enabled, canRead: (m) => m.id !== 'todo' });
    assert.deepEqual(d.panels.map((p) => p.manifest.id), ['cal']);
    assert.equal(destinations.destinationOfModule('todo', { settings: on, enabled, canRead: (m) => m.id !== 'todo' }), null);
    assert.equal(destinations.destinationOfModule('todo', { settings: on, enabled, canRead: all }).dest.path, '/calendar');
  });

  await test('rules: map needs Show Map and a file for its main; the calendar never asks for a file', () => {
    const mapMain = { id: 'map', part: 'main', entry: 'p.html' };
    const enabled = [mod('globe', [mapMain]), mod('pins', [{ id: 'map', part: 'panel', entry: 'p.html' }]), mod('cal', [main])];
    const ctx = (settings, hasFile) => ({ settings, enabled, canRead: all, hasFile });
    assert.deepEqual(destinations.DESTINATION_IDS, ['calendar', 'map']);
    assert.equal(destinations.resolveDestination('map', ctx({ showCalendar: true }, () => true)), null, 'Show Map off');
    assert.equal(destinations.resolveDestination('map', ctx({ showMap: true }, () => false)), null, 'no file');
    assert.equal(destinations.resolveDestination('map', { settings: { showMap: true }, enabled, canRead: all }), null, 'nobody said there is a file');
    const d = destinations.resolveDestination('map', ctx({ showMap: true }, (m) => m.id === 'globe'));
    assert.deepEqual([d.main.manifest.id, d.panels.map((p) => p.manifest.id), d.dest.path], ['globe', ['pins'], '/map']);
    assert.ok(destinations.resolveDestination('calendar', ctx({ showCalendar: true }, () => false)), 'the calendar needs no file');
    assert.deepEqual(destinations.shownDestinations(ctx({ showCalendar: true, showMap: true }, () => true)).map((x) => x.dest.id), ['calendar', 'map'], 'Map after Calendar');
    assert.equal(destinations.destinationOfModule('pins', ctx({ showMap: true }, () => true)).dest.path, '/map');
  });

  // plan-calendar-todo.md and plan-map-places.md, step 1: as a view of one space the option is not asked; `canRead` is
  // the caller's test for that space; a map still needs its file.
  await test('rules: in a space, the option is not asked, the parts are the ones readable there, a map still needs its file', () => {
    const mapMain = { id: 'map', part: 'main', entry: 'p.html' };
    const enabled = [mod('cal', [main, panel(1)]), mod('todo', [panel(2)]), mod('globe', [mapMain]), mod('pins', [{ id: 'map', part: 'panel', entry: 'p.html' }])];
    const d = destinations.resolveDestinationInSpace('calendar', { enabled, canRead: all });
    assert.deepEqual([d.dest.path, d.main.manifest.id, d.panels.map((p) => p.manifest.id)], ['/calendar', 'cal', ['cal', 'todo']]);
    assert.deepEqual(destinations.resolveDestinationInSpace('calendar', { enabled, canRead: (m) => m.id !== 'todo' }).panels.map((p) => p.manifest.id), ['cal'], 'a panel not readable there is left out');
    assert.equal(destinations.resolveDestinationInSpace('calendar', { enabled, canRead: (m) => m.id !== 'cal' }), null, 'no readable main there: nothing');
    assert.equal(destinations.resolveDestinationInSpace('agenda', { enabled, canRead: all }), null);
    assert.equal(destinations.resolveDestinationInSpace('map', { enabled, canRead: all }), null, 'no file');
    assert.equal(destinations.resolveDestinationInSpace('map', { enabled, canRead: all, hasFile: () => true }).main.manifest.id, 'globe');
    assert.equal(destinations.resolveDestination('calendar', { settings: {}, enabled, canRead: all }), null, 'the aggregate still asks the option');
  });

  await test('rules: what stands in a destination\'s way, whatever its option', () => {
    const mapMain = { id: 'map', part: 'main', entry: 'p.html' };
    assert.deepEqual(destinations.blockerOf('map', { enabled: [] }), { why: 'no-main' });
    const globe = mod('globe', [mapMain]);
    assert.deepEqual(destinations.blockerOf('map', { enabled: [globe], hasFile: () => false }), { why: 'no-file', manifest: globe.manifest });
    assert.equal(destinations.blockerOf('map', { enabled: [globe], hasFile: () => true }), null);
    assert.equal(destinations.blockerOf('calendar', { enabled: [mod('cal', [main])] }), null);
    assert.equal(destinations.blockerOf('agenda', { enabled: [] }), null);
  });
}

// --- a real server ------------------------------------------------------------------------------------------------
// A copy of the app whose public/ holds links to the real files, plus (or minus) a stand-in destination page.
const STAND_IN = '<!DOCTYPE html><title>stand-in destination</title>';
function appCopy(name, { page }) {
  const root = path.join(base, name);
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'server'), path.join(root, 'server'), { recursive: true });
  for (const link of ['modules', 'templates', 'node_modules', 'package.json']) fs.symlinkSync(path.join(ROOT, link), path.join(root, link));
  for (const f of fs.readdirSync(path.join(ROOT, 'public'))) if (f !== 'destination.html') fs.symlinkSync(path.join(ROOT, 'public', f), path.join(root, 'public', f));
  if (page) fs.writeFileSync(path.join(root, 'public', 'destination.html'), STAND_IN);
  return root;
}
async function startServer(root, extraEnv = {}) {
  const child = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: path.join(root, 'data'), TZ: 'UTC', ADMIN_PASSWORD: 'testpass1234', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  const call = async (method, urlPath, { body, token, type, headers: more } = {}) => {
    const headers = { accept: 'application/json', ...more };
    if (body !== undefined) headers['content-type'] = type || 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, redirect: 'manual', body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, location: res.headers.get('location'), headers: res.headers };
  };
  const signIn = async (login, password) => {
    const r = await call('POST', '/api/login', { body: { login, password } });
    assert.equal(r.status, 200, `${login} signs in: ${r.text}`);
    return r.json.token;
  };
  const stop = () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
  return { call, signIn, stop, root };
}

// Two stand-in modules: one with the calendar's main and a panel, one with a panel only, each with a page, a canvas
// and a tile, the edit permission guarding writes, and the schedule and notify hooks.
function writeModule(id, parts, { tile = true, ...extra } = {}) {
  const root = path.join(base, 'mods', id);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'module.json'), JSON.stringify({
    id, name: id, version: '1.0.0', scope: ['environment', 'space'], icon: 'circle',
    surfaces: { page: { entry: `${id}.html` }, canvas: { entry: `${id}.html` }, ...(tile ? { widget: { entry: 'widget.html', title: id } } : {}), destination: parts },
    ...extra,
    permissions: [
      { key: 'view', label: 'See it', default: { member: true, moderator: true, guest: true } },
      { key: 'edit', label: 'Change it', default: { member: true, moderator: true, guest: false } },
    ],
    access: { read: 'view', write: 'edit' },
    hooks: { schedule: true, notify: true },
  }));
  const html = '<!DOCTYPE html><html><head><style>/*__CSS__*/</style></head><body><script>/*__JS__*/</script></body></html>';
  for (const name of [id, `${id}-widget`]) {
    fs.writeFileSync(path.join(root, 'src', `${name}.html`), html);
    fs.writeFileSync(path.join(root, 'src', `${name}.css`), '');
    fs.writeFileSync(path.join(root, 'src', `${name}.js`), '');
  }
  return buildModule(root).zip;
}
// The calendar's main asks the panel to set a task's due date (as the Calendar asks To-do's setTaskDue on a drop).
const datesZip = writeModule('dest-dates', [{ id: 'calendar', part: 'main', entry: 'dest-dates.html' }, { id: 'calendar', part: 'panel', entry: 'dest-dates.html', label: 'Agenda', order: 10 }], {
  actions: { uses: ['dest-tasks:setTaskDue', 'dest-tasks:putAfter'] },
});
const tasksZip = writeModule('dest-tasks', [{ id: 'calendar', part: 'panel', entry: 'dest-tasks.html', label: 'To-do', order: 20 }], {
  refs: { produces: [{ kind: 'task', name: 'Task', key: 'task:{id}', summary: { title: 'title', when: 'due' } }] },
  actions: { provides: [
    { name: 'setTaskDue', label: 'Set this task\'s due date to its date', input: { task: 'ref:dest-tasks:task', date: 'date' } },
    { name: 'putAfter', label: 'Put this task after that one', input: { task: 'ref:dest-tasks:task', after: 'ref:dest-tasks:task' } },
  ] },
});
// The map's two: a main that draws from a map file (an environment `files` setting) and reads others' objects, with no
// tile; a panel that keeps pins (a kind with a place), with a tile.
const globeZip = writeModule('dest-globe', [{ id: 'map', part: 'main', entry: 'dest-globe.html' }], {
  tile: false,
  settings: [{ key: 'map', label: 'Map files', type: 'files', folder: 'map-tiles', scope: 'environment', default: [] }],
  refs: { consumes: ['*'] },
});
const pinsZip = writeModule('dest-pins', [{ id: 'map', part: 'panel', entry: 'dest-pins.html', label: 'Places' }], {
  scope: ['environment', 'space', 'person'],
  refs: { produces: [{ kind: 'pin', name: 'Pin', key: 'pin:{id}', summary: { title: 'title', place: 'point', category: 'cat', icon: 'icon', visit: 'visit', color: 'tint', spaces: 'marks', amount: 'cost', planned: 'estimate', paidBy: 'payer', sharedBy: 'sharers' } }] },
  // A place search, as Places has, for marking a result used.
  settings: [
    { key: 'searchProvider', label: 'Place search', type: 'choice', scope: 'environment', default: 'none', options: [{ value: 'none', label: 'None' }, { value: 'custom', label: 'Mine' }] },
    { key: 'search', label: 'Search address', type: 'url', scope: 'environment', default: '' },
  ],
  geocoder: { provider: 'searchProvider', address: 'search' },
});


let server = null;
try {
  server = await startServer(appCopy('with-page', { page: true }));
  const { call, signIn } = server;
  const admin = await signIn('admin', 'testpass1234');
  const mk = async (login) => {
    const r = await call('POST', '/api/users', { token: admin, body: { login, displayName: login, role: 'member', password: 'memberpass1234' } });
    assert.equal(r.status, 201, r.text);
    return r.json.user.key;
  };
  const [alice, bob] = [await mk('alice'), await mk('bob'), await mk('carol')];
  const keep = (await call('POST', '/api/spaces', { token: admin, body: { name: 'Keep', members: [alice, bob] } })).json.space.id;
  const tower = (await call('POST', '/api/spaces', { token: admin, body: { name: 'Tower', members: [alice] } })).json.space.id;
  // A creator is a member of the space they make (GitHub #239); these cases want the admin outside both.
  await call('PATCH', `/api/spaces/${keep}`, { token: admin, body: { members: [alice, bob] } });
  await call('PATCH', `/api/spaces/${tower}`, { token: admin, body: { members: [alice] } });
  const guest = (await call('POST', `/api/spaces/${keep}/guest-link`, { token: admin, body: {} })).json.space.guestToken;
  assert.ok(guest, 'the Keep has a guest link');
  for (const zip of [datesZip, tasksZip, globeZip, pinsZip]) {
    const up = await call('POST', '/api/modules', { token: admin, body: zip, type: 'application/zip' });
    assert.equal(up.status, 201, up.text);
  }
  const turn = async (id, enabled) => assert.equal((await call('PATCH', `/api/modules/${id}`, { token: admin, body: { enabled, allSpaces: true } })).status, 200);
  await turn('dest-dates', true);
  await turn('dest-tasks', true);
  const [aliceT, bobT, carolT] = [await signIn('alice', 'memberpass1234'), await signIn('bob', 'memberpass1234'), await signIn('carol', 'memberpass1234')];
  const role = async (patch) => assert.equal((await call('PATCH', '/api/roles/member', { token: admin, body: patch })).status, 200);
  const shown = async (token) => (await call('GET', '/api/destinations', { token })).json.destinations.map((d) => d.id);
  const hrefs = async (token) => Object.fromEntries((await call('GET', '/api/modules/widgets', { token })).json.widgets.map((w) => [w.id, w.href]));
  const goes = async (urlPath, token) => {
    const r = await call('GET', urlPath, { token });
    return r.status === 302 ? r.location : r.status;
  };
  const setOption = async (value) => {
    const r = await call('PATCH', '/api/settings', { token: admin, body: { showCalendar: value } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.settings.showCalendar, value);
  };

  await test('live: with nothing set, nothing changes -- no destination, no redirect, the tiles\' own links', async () => {
    assert.equal((await call('GET', '/api/settings', { token: admin })).json.settings.showCalendar, false, 'off by default');
    assert.deepEqual(await shown(admin), []);
    assert.deepEqual(await shown(aliceT), []);
    assert.equal((await call('GET', '/api/destinations/calendar', { token: aliceT })).status, 404);
    assert.equal(await goes('/modules/dest-dates', aliceT), 200);
    assert.equal(await goes('/modules/dest-tasks', aliceT), 200);
    assert.deepEqual(await hrefs(aliceT), { 'dest-dates': '/modules/dest-dates', 'dest-tasks': '/modules/dest-tasks' });
    assert.equal(await goes('/calendar', aliceT), '/');
    assert.equal(await goes('/map', aliceT), '/', 'Show Map is off');
    const settings = (await call('GET', '/api/settings', { token: admin })).json.settings;
    assert.equal(settings.showMap, false, 'Show Map off by default');
    assert.deepEqual(settings.topBarReasons, { calendar: null, map: 'Turn on dest-globe on the Modules tab first.' });
  });

  // plan-calendar-todo.md and plan-map-places.md, step 1: the destination as a view of one space (?space=<id>), with the
  // option still off: the parts on in that space and readable by the viewer there, `spaces` empty, 404 for anyone not
  // in it (one sentence for an outsider and an unknown id alike, so nothing says which spaces exist).
  await test('live: in a space, with the option off: the parts readable there, spaces empty, 404 for anyone not in it', async () => {
    const inSpace = (space, token) => call('GET', `/api/destinations/calendar?space=${space}`, { token });
    const r = await inSpace(keep, aliceT);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.id, r.json.name, r.json.main.module.id, r.json.main.part, r.json.panels.map((p) => [p.module.id, p.label])], ['calendar', 'dest-dates', 'dest-dates', 'main', [['dest-dates', 'Agenda'], ['dest-tasks', 'To-do']]]);
    assert.deepEqual(r.json.spaces, [], 'no spaces to filter in a space');
    assert.deepEqual([r.json.space.id, r.json.space.name, typeof r.json.space.svg], [keep, 'Keep', 'string'], 'the space it is a view of');
    assert.equal((await inSpace(tower, aliceT)).status, 200, 'Alice is in the Tower too');
    const refusal = 'That page is not available in that space for you.';
    const bob = await inSpace(tower, bobT);
    assert.deepEqual([bob.status, bob.json.error], [404, refusal], 'Bob is not in the Tower');
    assert.equal((await inSpace(keep, bobT)).status, 200);
    assert.equal((await inSpace(keep, carolT)).status, 404, 'Carol is in no space');
    const unknown = await inSpace('no-such-space', aliceT);
    assert.deepEqual([unknown.status, unknown.json.error], [404, refusal], 'an unknown id reads as a space one is not in');
    assert.equal((await inSpace(keep, admin)).status, 200, 'the admin, who may enter any space');
    assert.equal((await call('GET', `/api/destinations/calendar?space=${keep}`)).status, 404, 'nobody signed in');
    // A guest, by the space's link token: that space only.
    const g = await call('GET', `/api/destinations/calendar?space=${keep}&guest=${encodeURIComponent(guest)}`);
    assert.equal(g.status, 200, g.text);
    assert.deepEqual([g.json.main.module.id, g.json.panels.map((p) => p.module.id), g.json.spaces], ['dest-dates', ['dest-dates', 'dest-tasks'], []]);
    assert.equal((await call('GET', `/api/destinations/calendar?space=${tower}&guest=${encodeURIComponent(guest)}`)).status, 404, 'not another space');
    assert.equal((await call('GET', `/api/destinations/map?space=${keep}`, { token: aliceT })).status, 404, 'no map there yet');
    // The page: served on the same rule; a guest's link without a space goes home as before.
    const page = await call('GET', `/calendar?space=${keep}`, { token: aliceT });
    assert.deepEqual([page.status, page.text], [200, STAND_IN]);
    assert.deepEqual([(await call('GET', `/calendar?space=${keep}&guest=${encodeURIComponent(guest)}`)).status], [200], 'a guest, in their space');
    assert.equal(await goes(`/calendar?space=${tower}&guest=${encodeURIComponent(guest)}`), `/guest/${encodeURIComponent(guest)}`, 'a guest, another space: home');
    assert.equal(await goes(`/calendar?guest=${encodeURIComponent(guest)}`), `/guest/${encodeURIComponent(guest)}`, 'a guest with no space: home, as before');
    assert.equal(await goes(`/calendar?space=${tower}`, bobT), '/', 'not in it: home');
    assert.equal(await goes(`/calendar?space=${keep}`), `/login?next=${encodeURIComponent(`/calendar?space=${keep}`)}`, 'nobody signed in signs in first');
    assert.equal(await goes(`/map?space=${keep}`, aliceT), '/', 'no map there yet');
    assert.equal(await goes('/calendar', aliceT), '/', 'the aggregate still needs the option');
  });

  await test('live: in a space, a part is there only while its module is on and readable there', async () => {
    const panels = async (space, token) => (await call('GET', `/api/destinations/calendar?space=${space}`, { token })).json.panels.map((p) => p.module.id);
    // The To-do, on, is in every space; sending the old availability fields changes nothing.
    assert.equal((await call('PATCH', '/api/modules/dest-tasks', { token: admin, body: { enabled: true, allSpaces: false, spaces: [keep] } })).status, 200);
    assert.deepEqual(await panels(keep, aliceT), ['dest-dates', 'dest-tasks']);
    assert.deepEqual(await panels(tower, aliceT), ['dest-dates', 'dest-tasks']);
    await turn('dest-tasks', true);
    // Members may not read the To-do: the panel is left out for Alice, not for the admin.
    await role({ 'module.dest-tasks.view': false });
    assert.deepEqual(await panels(keep, aliceT), ['dest-dates']);
    assert.deepEqual(await panels(keep, admin), ['dest-dates', 'dest-tasks']);
    await role({ 'module.dest-tasks.view': true });
    // Members may not read the main: no view for Alice; the admin still has it.
    await role({ 'module.dest-dates.view': false });
    assert.equal((await call('GET', `/api/destinations/calendar?space=${keep}`, { token: aliceT })).status, 404);
    assert.equal(await goes(`/calendar?space=${keep}`, aliceT), '/');
    assert.equal((await call('GET', `/api/destinations/calendar?space=${keep}`, { token: admin })).status, 200);
    await role({ 'module.dest-dates.view': true });
    // The main off: no view in either space.
    assert.equal((await call('PATCH', '/api/modules/dest-dates', { token: admin, body: { enabled: false } })).status, 200);
    assert.equal((await call('GET', `/api/destinations/calendar?space=${keep}`, { token: aliceT })).status, 404);
    assert.equal((await call('GET', `/api/destinations/calendar?space=${tower}`, { token: aliceT })).status, 404);
    await turn('dest-dates', true);
  });

  await test('live: only an owner turns Show Calendar on', async () => {
    const r = await call('PATCH', '/api/settings', { token: aliceT, body: { showCalendar: true } });
    assert.equal(r.status, 403, r.text);
    await setOption(true);
  });

  await test('live: on, a member and the admin see Calendar under its main module\'s display name; a guest and nobody see none', async () => {
    const r = await call('GET', '/api/destinations', { token: aliceT });
    assert.deepEqual(r.json.destinations, [{ id: 'calendar', name: 'dest-dates', icon: 'circle', href: '/calendar', content: 'padded' }]);
    assert.deepEqual(await shown(admin), ['calendar']);
    assert.equal((await call('PATCH', '/api/modules/dest-dates', { token: admin, body: { displayName: 'Dates' } })).status, 200);
    assert.deepEqual((await call('GET', '/api/destinations', { token: aliceT })).json.destinations[0], { id: 'calendar', name: 'Dates', icon: 'circle', href: '/calendar', content: 'padded' });
    assert.deepEqual((await call('GET', `/api/destinations?guest=${encodeURIComponent(guest)}`)).json.destinations, []);
    assert.deepEqual((await call('GET', '/api/destinations')).json.destinations, []);
    assert.equal((await call('GET', `/api/destinations/calendar?guest=${encodeURIComponent(guest)}`)).status, 404);
  });

  await test('live: the destination\'s parts and spaces', async () => {
    const r = await call('GET', '/api/destinations/calendar', { token: aliceT });
    assert.equal(r.status, 200, r.text);
    const part = (id, label, entry) => ({ module: { id, version: '1.0.0', scope: ['environment', 'space'], name: id === 'dest-dates' ? 'Dates' : id, icon: 'circle', content: 'padded' }, entry, runMode: 'sandbox', label });
    assert.deepEqual([r.json.id, r.json.name, r.json.icon], ['calendar', 'Dates', 'circle']);
    assert.deepEqual(r.json.main, { part: 'main', ...part('dest-dates', 'Dates', 'dest-dates.html') });
    assert.deepEqual(r.json.panels, [{ part: 'panel', ...part('dest-dates', 'Agenda', 'dest-dates.html') }, { part: 'panel', ...part('dest-tasks', 'To-do', 'dest-tasks.html') }]);
    assert.deepEqual(r.json.spaces.map((s) => [s.id, s.name, typeof s.svg]), [[keep, 'Keep', 'string'], [tower, 'Tower', 'string']]);
    assert.deepEqual((await call('GET', '/api/destinations/calendar', { token: bobT })).json.spaces.map((s) => s.id), [keep], 'only the spaces Bob is in');
    assert.deepEqual((await call('GET', '/api/destinations/calendar', { token: carolT })).json.spaces, [], 'Carol is in none');
    assert.equal((await call('GET', '/api/destinations/map', { token: aliceT })).status, 404);
    assert.equal((await call('GET', '/api/destinations/agenda', { token: aliceT })).json.error, 'That page is not in this top bar.');
  });

  await test('live: the app shell refuses frames; the pages we frame ourselves are framed by this site only', async () => {
    const refuses = (r, what) => {
      assert.equal(r.status, 200, `${what} is served`);
      assert.equal(r.headers.get('content-security-policy'), "frame-ancestors 'none'", `${what} refuses frames`);
      assert.equal(r.headers.get('x-frame-options'), 'DENY', `${what} refuses frames (old browsers)`);
    };
    refuses(await call('GET', '/', { token: aliceT }), '/');
    refuses(await call('GET', `/guest/${encodeURIComponent(guest)}`), 'the guest page');
    refuses(await call('GET', '/space.html'), "the shell's own file");
    // Our overlay (space.js openOverlay: /profile, /admin and Manage's pages), the composites (canvas.js compositeSrc:
    // /calendar?space=, /map?space=), the module pages and the sign-in pages: frame-ancestors 'self'.
    const sameSite = async (url, token, statuses = [200, 302]) => {
      const r = await call('GET', url, { token });
      assert.ok(statuses.includes(r.status), `${url} answers (${r.status})`);
      assert.equal(r.headers.get('content-security-policy'), "frame-ancestors 'self'", `${url} is framed by this site only`);
      assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN', `${url} is framed by this site only (old browsers)`);
    };
    for (const url of ['/calendar', `/calendar?space=${keep}`, '/profile', '/modules/dest-dates', `/modules/dest-dates?space=${keep}`, `/modules/dest-dates?space=${keep}&guest=${encodeURIComponent(guest)}`]) await sameSite(url, aliceT);
    for (const url of ['/admin', '/profile/x', '/admin.html', '/module-config.html?id=dest-dates', '/profile.html', '/module.html', '/destination.html', '/map']) await sameSite(url, admin, [200, 302, 404]);
    for (const url of ['/login', '/login/verify', '/login/enrol', '/register', '/login.html', '/invite/abc']) await sameSite(url, null);
    // Left alone: a module's own files (they say frame-ancestors 'self' in their own sandbox policy), the access key's
    // pages, and anything else.
    const key = (await call('GET', '/api/settings', { token: admin })).json.streamKey;
    const keyed = await call('GET', `/modules/dest-dates?s=${encodeURIComponent(key)}`);
    assert.equal(keyed.headers.get('x-frame-options'), null, 'a module page with the access key is left as it was');
    for (const url of ['/healthz', '/theme.css', '/style.css']) {
      const r = await call('GET', url);
      assert.ok(!/frame-ancestors/.test(r.headers.get('content-security-policy') || '') && r.headers.get('x-frame-options') === null, `${url} sets no frame rule`);
    }
  });

  await test('live: a framed destination never redirects into a page that refuses frames', async () => {
    const framed = { 'sec-fetch-dest': 'iframe' };
    for (const url of [`/calendar?guest=${encodeURIComponent(guest)}`, '/calendar?guest=not-a-link', `/map?guest=${encodeURIComponent(guest)}`]) {
      const r = await call('GET', url, { headers: framed });
      assert.equal(r.status, 401, `${url}, framed: ${r.status}`);
      assert.match(r.text, /Sign in again\./, `${url}, framed: says so`);
      assert.equal(r.headers.get('content-security-policy'), "frame-ancestors 'self'");
    }
    // Not framed: as before (a guest goes home; the next test pins the redirects).
    assert.equal(await goes('/calendar?guest=not-a-link'), '/');
  });

  await test('live: /calendar, the module pages leading to it, pop-outs left alone, and the tiles\' href', async () => {
    const page = await call('GET', '/calendar', { token: aliceT });
    assert.deepEqual([page.status, page.text], [200, STAND_IN]);
    assert.equal(await goes('/calendar'), '/login?next=%2Fcalendar', 'nobody signed in signs in first');
    assert.equal(await goes(`/calendar?guest=${encodeURIComponent(guest)}`), `/guest/${encodeURIComponent(guest)}`, 'a guest goes home, to their space');
    assert.equal(await goes(`/map?guest=${encodeURIComponent(guest)}`), `/guest/${encodeURIComponent(guest)}`);
    assert.equal(await goes('/calendar?guest=not-a-link'), '/', 'a dead guest link goes to /');
    assert.equal(await goes('/modules/dest-dates', aliceT), '/calendar');
    // The query goes with it (the page's "Back to" link); the path stays the destination's, whatever the query holds.
    assert.equal(await goes('/modules/dest-dates?from=space&spaceName=Keep%2C%20East', aliceT), '/calendar?from=space&spaceName=Keep%2C%20East');
    for (const sneaky of ['?next=//evil.example/x', '?a=1%0d%0aLocation:%20https://evil.example', '?@evil.example']) {
      const to = await goes(`/modules/dest-dates${sneaky}`, aliceT);
      assert.ok(typeof to === 'string' && to.startsWith('/calendar?') && !/[\r\n]/.test(to), `${sneaky} -> ${to}`);
      assert.equal(new URL(to, 'http://same.origin').origin, 'http://same.origin', `${sneaky} stays on this site`);
      assert.equal(new URL(to, 'http://same.origin').pathname, '/calendar');
    }
    assert.equal(await goes('/modules/dest-tasks', aliceT), '/calendar');
    assert.equal(await goes(`/modules/dest-dates?space=${keep}`, aliceT), 200);
    assert.equal(await goes(`/modules/dest-tasks?space=${keep}&popout=1`, aliceT), 200);
    assert.equal(await goes(`/modules/dest-dates?space=${keep}&guest=${encodeURIComponent(guest)}`), 200, 'a guest\'s pop-out');
    // A main keeps the bare address (dest-dates is the main and a panel too); a panel's tile names it: #panel=<module id>.
    // The redirect itself carries no hash, so the browser keeps the address's own (#day=, #ref=).
    assert.deepEqual(await hrefs(aliceT), { 'dest-dates': '/calendar', 'dest-tasks': '/calendar#panel=dest-tasks' });
  });

  await test('live: a panel off or unreadable at environment level is left out, and its page stays its own', async () => {
    await role({ 'module.dest-tasks.view': false });
    assert.deepEqual((await call('GET', '/api/destinations/calendar', { token: aliceT })).json.panels.map((p) => p.module.id), ['dest-dates']);
    assert.equal(await goes('/modules/dest-tasks', aliceT), 200);
    assert.deepEqual((await call('GET', '/api/destinations/calendar', { token: admin })).json.panels.map((p) => p.module.id), ['dest-dates', 'dest-tasks'], 'the admin still reads it');
    await role({ 'module.dest-tasks.view': true });
    await turn('dest-tasks', false);
    assert.deepEqual((await call('GET', '/api/destinations/calendar', { token: admin })).json.panels.map((p) => p.module.id), ['dest-dates']);
    await turn('dest-tasks', true);
  });

  await test('live: the main unreadable or off: no destination, and nothing leads to it', async () => {
    await role({ 'module.dest-dates.view': false });
    assert.deepEqual(await shown(aliceT), []);
    assert.equal((await call('GET', '/api/destinations/calendar', { token: aliceT })).status, 404);
    assert.equal(await goes('/calendar', aliceT), '/');
    const inFrame = await call('GET', '/calendar', { token: aliceT, headers: { 'sec-fetch-dest': 'iframe' } });
    assert.deepEqual([inFrame.status, /not shown here any more/.test(inFrame.text)], [403, true], 'framed, not redirected to / (which refuses frames)');
    assert.equal(await goes('/modules/dest-tasks', aliceT), 200, 'To-do on but Calendar unreadable: no destination (decision 17)');
    assert.deepEqual(await shown(admin), ['calendar']);
    await role({ 'module.dest-dates.view': true });
    await turn('dest-dates', false);
    assert.deepEqual(await shown(admin), []);
    assert.equal(await goes('/modules/dest-tasks', admin), 200);
    await turn('dest-dates', true);
    assert.deepEqual(await shown(aliceT), ['calendar']);
  });

  await test('live: spaces-data says where the viewer may write', async () => {
    const write = async (token, info = '?info=1') => (await call('GET', `/api/modules/dest-tasks/spaces-data${info}`, { token })).json.spaces.map((s) => [s.id, s.write]);
    assert.deepEqual(await write(aliceT), [[keep, true], [tower, true]]);
    assert.deepEqual(await write(aliceT, ''), [[keep, true], [tower, true]], 'with the data too');
    await role({ 'module.dest-tasks.edit': false });
    assert.deepEqual(await write(aliceT), [[keep, false], [tower, false]], 'a member who may only read');
    assert.deepEqual(await write(admin), [], 'the admin is in neither space');
    await role({ 'module.dest-tasks.edit': true });
    assert.equal((await call('GET', `/api/modules/dest-tasks/spaces-data?info=1&guest=${encodeURIComponent(guest)}`)).status, 403, 'a guest reads no spaces-data, as before');
  });

  await test('live: an environment page writes into a space (scope=space) only where the viewer may', async () => {
    const at = `scope=space&space=${keep}`;
    const put = (token) => call('PUT', `/api/modules/dest-tasks/data/task:one?${at}`, { token, body: { value: { title: 'Pack' } } });
    const schedule = (token) => call('POST', `/api/modules/dest-tasks/schedule?${at}`, { token, body: { key: 'remind:one', at: Date.now() + 3600000, notify: { to: 'space', title: 'Pack' } } });
    const notify = (token) => call('POST', `/api/modules/dest-tasks/notify?${at}`, { token, body: { to: 'space', title: 'Packed' } });
    const ok = [await put(aliceT), await schedule(aliceT), await notify(aliceT)];
    assert.deepEqual(ok.map((r) => r.status), [200, 200, 200], ok.map((r) => r.text).join(' | '));
    assert.equal(ok[2].json.delivered, 2, 'to: space means that space: Alice and Bob');
    const bobs = (await call('GET', '/api/notifications', { token: bobT })).json.notifications.filter((x) => x.module === 'dest-tasks');
    assert.deepEqual(bobs.map((x) => [x.title, x.spaceId]), [['Packed', keep]]);
    const stored = await call('GET', `/api/modules/dest-tasks/data/task:one?${at}`, { token: bobT });
    assert.equal(stored.json.item.value.title, 'Pack', 'kept in the Keep\'s own data');
    assert.equal((await call('GET', '/api/modules/dest-tasks/data/task:one', { token: aliceT })).status, 404, 'not in the environment\'s');
    const outsider = [await put(carolT), await schedule(carolT), await notify(carolT)];
    assert.deepEqual(outsider.map((r) => r.status), [403, 403, 403], 'Carol is not in the Keep');
    assert.equal(outsider[0].json.error, 'this module is not available in that space for you');
    await role({ 'module.dest-tasks.edit': false });
    const reader = [await put(aliceT), await schedule(aliceT), await notify(aliceT)];
    assert.deepEqual(reader.map((r) => r.status), [403, 403, 403], 'Alice may only read now');
    assert.equal(reader[0].json.error, "your role can't do that in this module");
    await role({ 'module.dest-tasks.edit': true });
  });

  // plan-calendar-destination decision 21: from the environment-scope Calendar, an action on a task is checked in the
  // task's own place. The Keep stands for Lisbon (Alice may edit the To-do there), the Tower for Porto (she may not).
  await test('live: an environment page\'s action on an object in a space is checked by that space\'s permissions', async () => {
    const task = (id, space) => ({ module: 'dest-tasks', kind: 'task', id, ...(space ? { scope: 'space', space } : { scope: 'environment' }) });
    const lisbon = task('one', keep); // made by the test above
    const porto = task('two', tower);
    const home = task('three');
    assert.equal((await call('PUT', `/api/modules/dest-tasks/data/task:two?scope=space&space=${tower}`, { token: aliceT, body: { value: { title: 'Ferry' } } })).status, 200);
    assert.equal((await call('PUT', '/api/modules/dest-tasks/data/task:three', { token: aliceT, body: { value: { title: 'Passport' } } })).status, 200);
    // Members may only read the To-do; Alice moderates the Keep, where the moderator's column may edit.
    await role({ 'module.dest-tasks.edit': false });
    assert.equal((await call('PATCH', `/api/users/${alice}/spaces/${keep}`, { token: admin, body: { permissions: { moderator: true } } })).status, 200);
    try {
      const ask = (token, ref, body = {}) => call('POST', `/api/bus/actions/request${body.guest ? `?guest=${encodeURIComponent(body.guest)}` : ''}`, { token, body: { from: 'dest-dates', action: 'dest-tasks:setTaskDue', input: { task: ref, date: '2026-10-05' }, scope: 'environment', ...body, guest: undefined } });
      const listed = async (token, ref) => {
        const r = await call('GET', `/api/bus/actions?from=dest-dates&scope=environment&accepts=dest-tasks:task${ref ? `&ref=${encodeURIComponent(JSON.stringify(ref))}` : ''}`, { token });
        assert.equal(r.status, 200, r.text);
        return r.json.actions.map((a) => a.action);
      };
      const refused = (r, status, sentence) => assert.deepEqual([r.status, r.json?.error], [status, sentence], r.text);

      // Listing: by the dropped task's place when it is named; else where the viewer may edit it anywhere.
      assert.ok((await listed(aliceT)).includes('dest-tasks:setTaskDue'), 'Alice may edit tasks in the Keep');
      assert.ok((await listed(aliceT, lisbon)).includes('dest-tasks:setTaskDue'));
      assert.ok(!(await listed(aliceT, porto)).includes('dest-tasks:setTaskDue'), 'not for a Tower task');
      assert.ok(!(await listed(aliceT, home)).includes('dest-tasks:setTaskDue'), 'nor the environment\'s own, where she may only read');
      assert.ok(!(await listed(bobT)).includes('dest-tasks:setTaskDue'), 'Bob may only read everywhere');
      assert.ok(!(await listed(bobT, lisbon)).includes('dest-tasks:setTaskDue'));
      assert.ok(!(await listed(carolT, lisbon)).includes('dest-tasks:setTaskDue'), 'Carol is in no space');
      refused(await call('GET', '/api/bus/actions?from=dest-dates&scope=environment&ref=nope', { token: aliceT }), 400, 'that is not a valid reference');

      // Asking: the Keep's task by Alice is queued; the Tower's, the environment's own, a reader's and an outsider's are refused.
      const ok = await ask(aliceT, lisbon);
      assert.equal(ok.status, 200, ok.text);
      assert.equal(ok.json.status, 'pending');
      refused(await ask(aliceT, porto), 403, "your role can't do that in this module");
      refused(await ask(aliceT, home), 403, "your role can't do that in this module");
      refused(await ask(bobT, lisbon), 403, "your role can't do that in this module");
      refused(await ask(carolT, lisbon), 403, 'that module is not available in that space for you');
      refused(await ask(null, lisbon, { guest }), 403, 'guests can only use a module in a space');
      refused(await call('POST', '/api/bus/actions/request', { token: aliceT, body: { from: 'dest-dates', action: 'dest-tasks:putAfter', input: { task: lisbon, after: porto }, scope: 'environment' } }), 400, 'an action can change objects in only one place at a time');

      // Taking it: it waits at environment level, for someone who may edit the To-do in the Keep.
      const pending = async (token) => (await call('GET', '/api/bus/actions/pending?module=dest-tasks&scope=environment', { token })).json.actions.map((a) => a.id);
      assert.ok((await pending(aliceT)).includes(ok.json.id));
      assert.ok(!(await pending(bobT)).includes(ok.json.id), 'Bob may not change it');
      assert.ok(!(await pending(carolT)).includes(ok.json.id));
      refused(await call('POST', '/api/bus/actions/claim', { token: bobT, body: { module: 'dest-tasks', id: ok.json.id, scope: 'environment' } }), 403, "your role can't do that in this module");
      const claim = await call('POST', '/api/bus/actions/claim', { token: aliceT, body: { module: 'dest-tasks', id: ok.json.id, scope: 'environment' } });
      assert.deepEqual([claim.status, claim.json.ok, claim.json.action?.input], [200, true, { task: lisbon, date: '2026-10-05' }], claim.text);
      const done = await call('POST', '/api/bus/actions/complete', { token: aliceT, body: { module: 'dest-tasks', id: ok.json.id, scope: 'environment', result: { ok: true } } });
      assert.equal(done.json.ok, true, done.text);
      assert.equal((await call('GET', `/api/bus/actions/status?from=dest-dates&scope=environment&id=${ok.json.id}`, { token: aliceT })).json.status, 'done');

      // A page in a space keeps its own place, as before.
      assert.equal((await ask(aliceT, lisbon, { scope: 'space', space: keep })).status, 200);
      refused(await ask(bobT, lisbon, { scope: 'space', space: keep }), 403, "your role can't do that in this module");
    } finally {
      assert.equal((await call('PATCH', `/api/users/${alice}/spaces/${keep}`, { token: admin, body: { permissions: { moderator: false } } })).status, 200);
      await role({ 'module.dest-tasks.edit': true });
    }
  });

  await test('live: the option off again: everything as before', async () => {
    await setOption(false);
    assert.deepEqual(await shown(aliceT), []);
    assert.equal(await goes('/modules/dest-dates', aliceT), 200);
    assert.equal(await goes('/calendar', aliceT), '/');
    assert.deepEqual(await hrefs(aliceT), { 'dest-dates': '/modules/dest-dates', 'dest-tasks': '/modules/dest-tasks' });
  });

  // --- the Map (plan-map-destination.md, Verify step 1) ---
  const mapFile = path.join(server.root, 'data', 'modules', 'dest-globe', 'map-tiles', 'world.pmtiles');
  const reasons = async () => (await call('GET', '/api/settings', { token: admin })).json.settings.topBarReasons;
  const setMap = async (value) => {
    const r = await call('PATCH', '/api/settings', { token: admin, body: { showMap: value } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.settings.showMap, value);
  };
  const tick = async (names) => {
    const r = await call('PUT', '/api/modules/dest-globe/settings/environment', { token: admin, body: { values: { map: names } } });
    assert.equal(r.status, 200, r.text);
  };

  await test('map: the modules on, Show Map off: nothing shown, nothing leads to /map', async () => {
    await turn('dest-globe', true);
    await turn('dest-pins', true);
    assert.deepEqual(await shown(aliceT), []);
    assert.equal((await call('GET', '/api/destinations/map', { token: aliceT })).status, 404);
    assert.equal(await goes('/map', aliceT), '/');
    assert.equal(await goes('/modules/dest-globe', aliceT), 200);
    assert.equal(await goes('/modules/dest-pins', aliceT), 200);
    assert.equal((await hrefs(aliceT))['dest-pins'], '/modules/dest-pins');
  });

  await test('map: only an owner turns Show Map on; with no map file it still does not show, and Manage says why', async () => {
    assert.equal((await call('PATCH', '/api/settings', { token: aliceT, body: { showMap: true } })).status, 403);
    await setMap(true);
    assert.deepEqual(await shown(aliceT), []);
    assert.deepEqual(await shown(admin), []);
    assert.equal(await goes('/map', aliceT), '/');
    assert.equal(await goes('/modules/dest-globe', aliceT), 200);
    assert.deepEqual(await reasons(), { calendar: null, map: 'Choose a file for "Map files" in dest-globe\'s settings first.' });
    fs.mkdirSync(path.dirname(mapFile), { recursive: true });
    fs.writeFileSync(mapFile, Buffer.from('PMTiles stand-in, not a real map'));
    assert.deepEqual(await shown(aliceT), [], 'a file in the folder, not ticked: still none on a single install');
    await tick(['world.pmtiles']);
    assert.deepEqual(await reasons(), { calendar: null, map: null });
  });

  await test('map: with a file ticked it shows, under its main module\'s name, with its panel', async () => {
    assert.deepEqual((await call('GET', '/api/destinations', { token: aliceT })).json.destinations, [{ id: 'map', name: 'dest-globe', icon: 'circle', href: '/map', content: 'padded' }]);
    assert.deepEqual(await shown(admin), ['map']);
    const r = await call('GET', '/api/destinations/map', { token: aliceT });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.id, r.json.main.module.id, r.json.panels.map((p) => [p.module.id, p.label])], ['map', 'dest-globe', [['dest-pins', 'Places']]]);
    assert.deepEqual(r.json.spaces.map((x) => x.id), [keep, tower]);
    const page = await call('GET', '/map', { token: aliceT });
    assert.deepEqual([page.status, page.text], [200, STAND_IN]);
    // As a view of one space: the same file condition (the environment's, or the host's, map file; a space has none).
    const inKeep = await call('GET', `/api/destinations/map?space=${keep}`, { token: aliceT });
    assert.equal(inKeep.status, 200, inKeep.text);
    assert.deepEqual([inKeep.json.main.module.id, inKeep.json.panels.map((p) => p.module.id), inKeep.json.spaces, inKeep.json.space.id], ['dest-globe', ['dest-pins'], [], keep]);
    assert.equal((await call('GET', `/map?space=${keep}`, { token: aliceT })).text, STAND_IN);
    assert.equal((await call('GET', `/api/destinations/map?space=${keep}&guest=${encodeURIComponent(guest)}`)).status, 200, 'a guest in the Keep');
    assert.equal((await call('GET', `/api/destinations/map?space=${tower}`, { token: bobT })).status, 404);
    await setOption(true);
    assert.deepEqual(await shown(aliceT), ['calendar', 'map'], 'Map after Calendar');
    await setOption(false);
  });

  await test('map: a guest and nobody signed in see none', async () => {
    assert.deepEqual((await call('GET', `/api/destinations?guest=${encodeURIComponent(guest)}`)).json.destinations, []);
    assert.equal((await call('GET', `/api/destinations/map?guest=${encodeURIComponent(guest)}`)).status, 404);
    assert.equal(await goes('/map'), '/login?next=%2Fmap');
  });

  await test('map: the module pages lead to /map, pop-outs left alone, and the tile\'s href', async () => {
    assert.equal(await goes('/modules/dest-globe', aliceT), '/map');
    assert.equal(await goes('/modules/dest-pins', aliceT), '/map');
    assert.equal(await goes(`/modules/dest-globe?space=${keep}`, aliceT), 200);
    assert.equal(await goes(`/modules/dest-pins?space=${keep}&popout=1`, aliceT), 200);
    assert.equal((await hrefs(aliceT))['dest-pins'], '/map#panel=dest-pins');
    assert.equal((await hrefs(aliceT))['dest-dates'], '/modules/dest-dates', 'the calendar\'s tiles are their own while it is off');
  });

  await test('map: the main\'s map file answers at environment scope, by range', async () => {
    const r = await call('GET', '/api/modules/dest-globe/files/world.pmtiles', { token: aliceT, headers: { range: 'bytes=0-6' } });
    assert.deepEqual([r.status, r.text], [206, 'PMTiles']);
    assert.equal((await call('GET', '/api/modules/dest-globe/files/world.pmtiles', { token: carolT })).status, 200, 'any member who reads it, in no space at all');
    assert.equal((await call('GET', `/api/modules/dest-globe/files/world.pmtiles?guest=${encodeURIComponent(guest)}`)).status, 403, 'not a guest, at environment scope');
  });

  await test('map: the panel unreadable at environment level is left out and its page stays its own', async () => {
    await role({ 'module.dest-pins.view': false });
    assert.deepEqual((await call('GET', '/api/destinations/map', { token: aliceT })).json.panels, []);
    assert.equal(await goes('/modules/dest-pins', aliceT), 200);
    assert.equal(await goes('/modules/dest-globe', aliceT), '/map');
    await role({ 'module.dest-pins.view': true });
  });

  await test('map: a member with no environment-level read of the main sees none; the admin still does', async () => {
    await role({ 'module.dest-globe.view': false });
    assert.deepEqual(await shown(aliceT), []);
    assert.equal(await goes('/map', aliceT), '/');
    assert.equal(await goes('/modules/dest-pins', aliceT), 200);
    assert.deepEqual(await shown(admin), ['map']);
    await role({ 'module.dest-globe.view': true });
  });

  await test('map: the map file gone from the folder hides it again', async () => {
    fs.renameSync(mapFile, `${mapFile}.away`);
    assert.deepEqual(await shown(aliceT), []);
    assert.equal(await goes('/modules/dest-globe', aliceT), 200);
    assert.match((await reasons()).map, /^Choose a file for "Map files"/);
    fs.renameSync(`${mapFile}.away`, mapFile);
    assert.deepEqual(await shown(aliceT), ['map']);
  });

  await test('map: a place written into a space (scope=space) only by a member with edit there', async () => {
    const put = (token, id = 'w1') => call('PUT', `/api/modules/dest-pins/data/pin:${id}?scope=space&space=${keep}`, { token, body: { value: { title: 'Harbour', point: { lat: 1, lng: 2 } } } });
    assert.equal((await put(aliceT)).status, 200);
    const outsider = await put(carolT);
    assert.deepEqual([outsider.status, outsider.json.error], [403, 'this module is not available in that space for you']);
    await role({ 'module.dest-pins.edit': false });
    const reader = await put(aliceT, 'w2');
    assert.deepEqual([reader.status, reader.json.error], [403, "your role can't do that in this module"]);
    await role({ 'module.dest-pins.edit': true });
    assert.equal((await call('DELETE', `/api/modules/dest-pins/data/pin:w1?scope=space&space=${keep}`, { token: aliceT })).status, 200);
  });

  // The Map page saves a search result into a space, then marks it used in the environment's place collection: that
  // needs only read there (it reveals nothing a search does not, and only keeps the place from an "unused" purge).
  await test('map: marking a place search result used needs only read at environment level', async () => {
    const file = path.join(server.root, 'data', 'modules', 'dest-pins', 'geocode.json');
    fs.writeFileSync(file, JSON.stringify({ places: [{ key: 'N1', name: 'Harbour', address: '', lat: 1, lng: 2, category: 'amenity:cafe', seen: 1, used: false }] }));
    const use = (token, key = 'N1', query = 'scope=environment') => call('POST', `/api/modules/dest-pins/geocode/use?${query}`, { token, body: { key } });
    try {
      await role({ 'module.dest-pins.edit': false });
      const reader = await use(aliceT);
      assert.deepEqual([reader.status, reader.json?.ok], [200, true], `a member without edit: ${reader.text}`);
      assert.deepEqual((await use(aliceT, 'nothing')).json, { ok: false }, 'an unknown key');
      await role({ 'module.dest-pins.edit': true, 'module.dest-pins.view': false });
      assert.equal((await use(aliceT)).status, 403, 'a member who may not read it');
    } finally {
      await role({ 'module.dest-pins.edit': true, 'module.dest-pins.view': true });
    }
    assert.equal((await use(null, 'N1', `scope=environment&guest=${encodeURIComponent(guest)}`)).status, 403, 'a guest, at environment level');
  });

  // plan-places-library.md, step 4: a search result carries its OpenStreetMap tag as `osm`, so a saved result gets a type.
  await test('map: a place search result carries its OpenStreetMap tag as osm', async () => {
    const photon = (await import('node:http')).createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ features: [
        { geometry: { type: 'Point', coordinates: [2, 1] }, properties: { name: 'Blue Cup', osm_type: 'N', osm_id: 7, osm_key: 'amenity', osm_value: 'cafe' } },
        { geometry: { type: 'Point', coordinates: [4, 3] }, properties: { name: 'Blank Spot', osm_type: 'N', osm_id: 8 } },
      ] }));
    });
    await new Promise((ok) => photon.listen(0, '127.0.0.1', ok));
    try {
      const set = await call('PUT', '/api/modules/dest-pins/settings/environment', { token: admin, body: { values: { searchProvider: 'custom', search: `http://127.0.0.1:${photon.address().port}/api` } } });
      assert.equal(set.status, 200, set.text);
      const r = await call('GET', '/api/modules/dest-pins/geocode?q=blue&scope=environment', { token: aliceT });
      assert.equal(r.status, 200, r.text);
      const by = Object.fromEntries(r.json.results.map((x) => [x.title, x]));
      assert.equal(by['Blue Cup'].osm, 'amenity:cafe', 'the tag is passed');
      assert.equal('osm' in by['Blank Spot'], false, 'no tag, no field');
    } finally {
      photon.close();
      await call('PUT', '/api/modules/dest-pins/settings/environment', { token: admin, body: { values: { searchProvider: 'none' } } });
    }
  });

  await test('map: summaries across the viewer\'s spaces, only with a place, more than 50', async () => {
    const pin = async (space, id, point) => {
      const r = await call('PUT', `/api/modules/dest-pins/data/pin:${id}?scope=space&space=${space}`, { token: aliceT, body: { value: { title: `Pin ${id}`, ...(point ? { point } : {}) } } });
      assert.equal(r.status, 200, r.text);
    };
    for (let i = 0; i < 55; i += 1) await pin(keep, `k${i}`, { lat: 10 + i / 100, lng: 20 });
    for (let i = 0; i < 3; i += 1) await pin(tower, `t${i}`, { lat: -10, lng: -20 - i });
    await pin(keep, 'nowhere', null);
    await pin(tower, 'nowhere', null);
    const r = await call('PUT', '/api/modules/dest-pins/data/pin:home', { token: aliceT, body: { value: { title: 'Home', point: { lat: 0, lng: 0 } } } });
    assert.equal(r.status, 200, 'one in the environment\'s own, not part of scope=spaces');
    const search = async (token, query = 'scope=spaces&has=place') => {
      const res = await call('GET', `/api/objects/search?from=dest-globe&${query}`, { token });
      assert.equal(res.status, 200, res.text);
      return res.json.summaries;
    };
    const alices = await search(aliceT);
    assert.equal(alices.length, 58, 'all 58 pins with a place, past the old cap of 50');
    assert.ok(alices.every((x) => x.place && x.ref.scope === 'space' && x.ref.module === 'dest-pins' && x.ref.kind === 'pin'));
    assert.deepEqual([...new Set(alices.map((x) => x.ref.space))].sort(), [keep, tower].sort());
    assert.equal(alices.filter((x) => x.ref.space === tower).length, 3);
    const unplaced = await search(aliceT, 'scope=spaces');
    assert.equal(unplaced.length, 50, 'without has=place: the cap of 50 as before');
    assert.equal((await search(aliceT, 'scope=spaces&q=pin%20nowhere')).length, 2, 'without has=place the ones with no place are there too');
    assert.equal((await search(aliceT, 'scope=spaces&has=place&q=pin%20t')).length, 3, 'q still filters');
    assert.deepEqual([...new Set((await search(bobT)).map((x) => x.ref.space))], [keep], 'Bob is in the Keep only');
    assert.equal((await search(bobT)).length, 55);
    assert.deepEqual(await search(carolT), [], 'Carol is in no space');
    assert.deepEqual(await search(admin), [], 'the admin belongs to no space (the spaces-data rule)');
    assert.equal((await search(aliceT, `scope=space&space=${keep}&has=place`)).length, 55, 'has=place in one scope too');
    assert.equal((await search(aliceT, 'has=place')).length, 1, 'and in the environment\'s own');
    // The old availability fields change nothing: the provider is in both spaces.
    assert.equal((await call('PATCH', '/api/modules/dest-pins', { token: admin, body: { enabled: true, allSpaces: false, spaces: [keep] } })).status, 200);
    assert.deepEqual([...new Set((await search(aliceT)).map((x) => x.ref.space))].sort(), [keep, tower].sort(), 'ignored');
    // The provider unreadable: none.
    await role({ 'module.dest-pins.view': false });
    assert.deepEqual(await search(aliceT), [], 'not where the viewer may not read the provider');
    await role({ 'module.dest-pins.view': true });
    const g = await call('GET', `/api/objects/search?from=dest-globe&scope=spaces&has=place&guest=${encodeURIComponent(guest)}`);
    assert.deepEqual([g.status, g.json.error], [403, 'guests can only search one space']);
    const bad = await call('GET', '/api/objects/search?from=dest-globe&scope=spaces&has=date', { token: aliceT });
    assert.deepEqual([bad.status, bad.json.error], [400, 'has must be place or amount']);
  });

  // plan-budget-module.md, step 3: a summary may carry amount, paidBy and sharedBy, and has=amount lists only priced objects.
  await test('search: amount, paidBy and sharedBy kept when valid, left out when not; has=amount lists only priced objects', async () => {
    const put = async (id, value) => {
      const r = await call('PUT', `/api/modules/dest-pins/data/pin:${id}?scope=space&space=${keep}`, { token: aliceT, body: { value: { title: `Cost ${id}`, ...value } } });
      assert.equal(r.status, 200, r.text);
    };
    await put('c-ok', { cost: 12.345, payer: 'alice-key', sharers: ['a', 'b', 'a', '', 7] });
    await put('c-big', { cost: 1e12 });
    await put('c-zero', { cost: 0 });
    await put('c-neg', { cost: -5 });
    await put('c-text', { cost: '40', payer: 12, sharers: 'everyone' });
    await put('c-long', { cost: 3, payer: 'x'.repeat(65), sharers: [`${'y'.repeat(65)}`] });
    await put('c-est', { estimate: 20.555 });
    await put('c-estbad', { estimate: 1e12 });
    await put('c-none', {});
    const search = async (token, query) => {
      const res = await call('GET', `/api/objects/search?from=dest-globe&scope=space&space=${keep}&${query}`, { token });
      assert.equal(res.status, 200, res.text);
      return res.json.summaries;
    };
    const all = Object.fromEntries((await search(aliceT, 'q=cost%20c-')).map((s) => [s.ref.id, s]));
    assert.deepEqual([all['c-ok'].amount, all['c-ok'].paidBy, all['c-ok'].sharedBy], [12.35, 'alice-key', ['a', 'b']], 'valid ones kept, rounded to cents, keys cleaned');
    for (const id of ['c-big', 'c-zero', 'c-neg', 'c-text', 'c-none']) assert.equal(all[id].amount, undefined, `${id}: no amount`);
    assert.deepEqual([all['c-text'].paidBy, all['c-text'].sharedBy, all['c-long'].paidBy, all['c-long'].sharedBy, all['c-long'].amount], [undefined, undefined, undefined, undefined, 3], 'bad keys left out');
    assert.deepEqual((await search(aliceT, 'has=amount')).map((s) => s.ref.id).sort(), ['c-est', 'c-long', 'c-ok'], 'only priced objects: an amount or a planned amount');
    assert.deepEqual([all['c-est'].planned, all['c-est'].amount, all['c-estbad'].planned, all['c-ok'].planned], [20.56, undefined, undefined, undefined], 'planned: rounded to cents, the same limits as amount');
    assert.deepEqual((await search(aliceT, 'has=amount&q=cost%20c-ok')).map((s) => s.ref.id), ['c-ok'], 'q still filters');
    const counted = async (token, query = 'has=amount') => (await call('GET', `/api/objects/search?from=dest-globe&scope=space&space=${keep}&${query}`, { token })).json;
    assert.equal((await counted(aliceT)).withheld, 0, 'a person who may view it: nothing withheld');
    assert.equal('withheld' in (await counted(aliceT, 'q=cost')), false, 'the count comes only with has=amount');
    assert.deepEqual(await search(carolT, 'has=amount'), [], 'a person outside the space gets none');
    assert.equal((await counted(carolT)).withheld, 0, 'and is told of none: it is not their space');
    const guestSearch = (query) => call('GET', `/api/objects/search?from=dest-globe&${query}&guest=${encodeURIComponent(guest)}`);
    const guestRole = async (view) => assert.equal((await call('PATCH', '/api/roles/guest', { token: admin, body: { 'module.dest-pins.view': view } })).status, 200);
    await role({ 'module.dest-pins.view': false });
    await guestRole(false);
    assert.deepEqual(await search(aliceT, 'has=amount'), [], 'a person who may not view the module gets none');
    assert.deepEqual(await counted(aliceT), { summaries: [], withheld: 3 }, 'only a count of the priced objects held back, no titles or figures');
    // Costs are kept from guests (server/module-guards.js; check-module-guards has the space's guestsSeeHidden opening them).
    const refusedGuest = await guestSearch(`scope=space&space=${keep}&has=amount`);
    assert.equal(refusedGuest.status, 403, 'a guest is refused has=amount');
    assert.match(refusedGuest.json.error, /^Guests can't see costs in this \w+\.$/);
    assert.equal('withheld' in refusedGuest.json, false, 'and is told of none');
    await guestRole(true);
    assert.equal((await guestSearch(`scope=space&space=${keep}&has=amount`)).status, 403, 'even one who may view the module');
    await role({ 'module.dest-pins.view': true });
    assert.deepEqual([(await guestSearch('scope=spaces&has=amount')).status], [403], 'a guest cannot search across spaces');
    const anon = await call('GET', `/api/objects/search?from=dest-globe&scope=space&space=${keep}&has=amount`);
    assert.equal(anon.status, 401, 'nobody signed in');
    for (const id of ['c-ok', 'c-big', 'c-zero', 'c-neg', 'c-text', 'c-long', 'c-none']) await call('DELETE', `/api/modules/dest-pins/data/pin:${id}?scope=space&space=${keep}`, { token: aliceT });
  });

  // plan-places-library.md, step 1: a summary may carry icon, visit and spaces, the category id may run to 30 characters,
  // and the environment can be searched for the objects marked into one space.
  await test('search: icon, visit, spaces and a 30-character category; in=<space> finds the environment objects marked for it', async () => {
    const putEnv = async (id, value) => {
      const r = await call('PUT', `/api/modules/dest-pins/data/pin:${id}?scope=environment`, { token: aliceT, body: { value: { title: `Mark ${id}`, ...value } } });
      assert.equal(r.status, 200, r.text);
    };
    const long30 = 'a'.repeat(30);
    await putEnv('m-ok', { icon: 'mug-hot', visit: 'booked', cat: 'Eat-Out', marks: [keep, tower, keep, 'nowhere', 7] });
    await putEnv('m-bad', { icon: 'no-such-icon-at-all', visit: 'maybe', cat: 'a'.repeat(31), marks: 'all' });
    await putEnv('m-shape', { icon: 'Mug Hot', visit: 5, cat: long30, marks: [] });
    await putEnv('m-many', { marks: [keep] });
    await putEnv('m-tint', { tint: 'teal' });
    await putEnv('m-tint-bad', { tint: '#00ff00' });
    await putEnv('m-tint-name', { tint: 'magenta' });
    for (const v of ['want', 'booked', 'visited', 'favorite']) await putEnv(`m-${v}`, { visit: v, marks: [tower] });
    const manyIds = [];
    for (let i = 0; i < 22; i += 1) {
      const r = await call('POST', '/api/spaces', { token: admin, body: { name: `Many ${i}`, members: [alice] } });
      manyIds.push(r.json.space.id);
    }
    await putEnv('m-twenty', { marks: manyIds });
    const search = async (token, query) => {
      const res = await call('GET', `/api/objects/search?from=dest-globe&scope=environment&${query}`, { token });
      assert.equal(res.status, 200, res.text);
      return Object.fromEntries(res.json.summaries.map((x) => [x.ref.id, x]));
    };
    const all = await search(aliceT, 'q=mark%20m-');
    assert.deepEqual([all['m-ok'].icon, all['m-ok'].visit, all['m-ok'].category, all['m-ok'].spaces], ['mug-hot', 'booked', 'eat-out', [keep, tower]], 'valid ones kept; spaces repeated, unknown or not ids dropped');
    assert.deepEqual([all['m-bad'].icon, all['m-bad'].visit, all['m-bad'].category, all['m-bad'].spaces], [undefined, undefined, undefined, undefined], 'an unknown icon, an unknown state, a 31-character category and a non-list are dropped');
    assert.deepEqual([all['m-shape'].icon, all['m-shape'].visit, all['m-shape'].category, all['m-shape'].spaces], [undefined, undefined, long30, undefined], 'a bad icon name and a number are dropped; 30 characters of category is kept; an empty list is left out');
    for (const v of ['want', 'booked', 'visited', 'favorite']) assert.equal(all[`m-${v}`].visit, v, `${v} is kept`);
    assert.deepEqual([all['m-tint'].color, all['m-tint-bad'].color, all['m-tint-name'].color, all['m-ok'].color], ['teal', undefined, undefined, undefined], 'a place\'s own colour is kept only as one of the eight tint names');
    assert.equal(all['m-twenty'].spaces.length, 20, 'at most 20 spaces');
    // Searching by space.
    const inKeep = await search(aliceT, `in=${keep}`);
    assert.deepEqual(Object.keys(inKeep).sort(), ['m-many', 'm-ok'], 'a member finds the objects marked into the space');
    assert.deepEqual(Object.keys(await search(aliceT, `in=${tower}`)).sort(), ['m-booked', 'm-favorite', 'm-ok', 'm-visited', 'm-want'], 'and only that space\'s');
    assert.deepEqual(Object.keys(await search(aliceT, `in=${keep}&q=many`)), ['m-many'], 'q still filters');
    assert.deepEqual(Object.keys(await search(bobT, `in=${keep}`)).sort(), ['m-many', 'm-ok'], 'another member of the space finds them too');
    const refuse = async (token, query) => {
      const r = await call('GET', `/api/objects/search?from=dest-globe&${query}`, { token });
      return [r.status, r.json.error];
    };
    assert.deepEqual(await refuse(bobT, `scope=environment&in=${tower}`), [403, 'you are not in that space'], 'someone outside the space finds none');
    assert.deepEqual(await refuse(carolT, `scope=environment&in=${keep}`), [403, 'you are not in that space']);
    assert.deepEqual(await refuse(aliceT, 'scope=environment&in=nowhere'), [404, 'no such space']);
    assert.deepEqual(await refuse(aliceT, `scope=space&space=${keep}&in=${keep}`), [400, 'in works only with the environment scope']);
    assert.deepEqual(await refuse(undefined, `scope=environment&in=${keep}&guest=${encodeURIComponent(guest)}`), [403, 'guests can only search one space'], 'a guest link has no environment objects');
    assert.equal((await call('GET', `/api/objects/search?from=dest-globe&scope=environment&in=${keep}`)).status, 401, 'nobody signed in');
    assert.ok(Object.keys(await search(aliceT, '')).includes('m-ok'), 'without in, the whole environment as before');
    assert.deepEqual(Object.keys(await search(aliceT, 'in=')).includes('m-bad'), true, 'an empty in is no in');
    for (const id of ['m-ok', 'm-bad', 'm-shape', 'm-many', 'm-want', 'm-booked', 'm-visited', 'm-favorite', 'm-twenty']) await call('DELETE', `/api/modules/dest-pins/data/pin:${id}?scope=environment`, { token: aliceT });
  });

  // plan-places-library.md, step 3: one home, marks, a private list. The store alone decides who reads a place: a person's
  // private one is nobody else's until it moves out (new home first, then a forward with the title only); marks only filter.
  await test('places step 3: a private place stays private until shared; a forward names the title only; marks never widen who reads', async () => {
    const put = (token, query, id, value, version) => call('PUT', `/api/modules/dest-pins/data/pin:${id}?${query}`, { token, body: { value, ...(version !== undefined ? { version } : {}) } });
    const get = (token, query, id) => call('GET', `/api/modules/dest-pins/data/pin:${id}?${query}`, { token });
    const resolveAs = async (token, ref) => (await call('POST', '/api/objects/resolve', { token, body: { from: 'dest-globe', refs: [ref] } })).json.summaries[0];
    const mine = { module: 'dest-pins', kind: 'pin', id: 'h1', scope: 'person' };
    const record = { title: 'Hideaway', notes: 'the code is 1234', point: { lat: 38.7, lng: -9.1 } };
    assert.equal((await put(aliceT, 'scope=person', 'h1', record)).status, 200);
    // Bob: his own store has none, the environment has none, and a pointer to Alice's is nothing to him
    assert.equal((await get(bobT, 'scope=person', 'h1')).status, 404);
    assert.equal((await get(bobT, 'scope=environment', 'h1')).status, 404);
    assert.equal((await resolveAs(bobT, mine)).state, 'gone');
    assert.equal((await resolveAs(aliceT, mine)).place.lat, 38.7, 'Alice reads her own');
    // Shared to Everyone and Keep: written only over nothing (version 0), then the forward in her store
    assert.equal((await put(aliceT, 'scope=environment', 'h1', { ...record, marks: [keep] }, 0)).status, 200);
    assert.equal((await put(aliceT, 'scope=environment', 'h1', { title: 'Another' }, 0)).status, 409, 'a move never writes over a place that is there');
    assert.equal((await put(aliceT, 'scope=person', 'h1', { title: 'Hideaway', movedTo: { scope: 'environment' } })).status, 200);
    const shared = await get(bobT, 'scope=environment', 'h1');
    assert.deepEqual([shared.status, shared.json.item.value.notes], [200, 'the code is 1234'], 'shared, Bob reads it, notes too');
    const fwd = await resolveAs(aliceT, mine);
    assert.deepEqual([fwd.title, fwd.place, fwd.subtitle, fwd.spaces, fwd.icon], ['Hideaway', undefined, undefined, undefined, undefined], 'the old pointer resolves to the forward: its title only');
    // Marks filter, they do not widen: Bob (in Keep) finds it by in=Keep; Carol (in no space) reads it as everyone's, but
    // may not ask by Keep; the summary names space ids and nothing else of a space.
    const inKeep = await call('GET', `/api/objects/search?from=dest-globe&scope=environment&in=${keep}&q=hideaway`, { token: bobT });
    assert.deepEqual(inKeep.json.summaries.map((x) => [x.ref.id, x.spaces]), [['h1', [keep]]], 'once, with its marks');
    assert.equal((await call('GET', `/api/objects/search?from=dest-globe&scope=environment&in=${keep}`, { token: carolT })).status, 403);
    const carol = await call('GET', '/api/objects/search?from=dest-globe&scope=environment&q=hideaway', { token: carolT });
    assert.deepEqual(carol.json.summaries[0].spaces, [keep]);
    assert.ok(carol.json.summaries[0].spaces.every((x) => typeof x === 'string'), 'ids only: no members, no names');
    // Alice is in Keep and Tower: marked into both, each search finds it once
    assert.equal((await put(aliceT, 'scope=environment', 'h1', { ...record, marks: [keep, tower] })).status, 200);
    for (const sp of [keep, tower]) assert.deepEqual((await call('GET', `/api/objects/search?from=dest-globe&scope=environment&in=${sp}&q=hideaway`, { token: aliceT })).json.summaries.map((x) => x.ref.id), ['h1']);
    // A guest on Keep's link reads none of the environment's places, marked or not, and has no list of their own
    assert.equal((await call('GET', `/api/modules/dest-pins/data?scope=environment&guest=${encodeURIComponent(guest)}`)).status, 403);
    assert.equal((await call('GET', `/api/modules/dest-pins/data?scope=person&guest=${encodeURIComponent(guest)}`)).status, 403);
    // A member never writes into a space he is not in: Bob is not in Tower
    assert.equal((await put(bobT, `scope=space&space=${tower}`, 'x1', { title: 'Sneaky' })).status, 403);
    for (const [q, id] of [['scope=environment', 'h1'], ['scope=person', 'h1']]) await call('DELETE', `/api/modules/dest-pins/data/pin:${id}?${q}`, { token: aliceT });
  });

  await test('map: Show Map off again: everything as before', async () => {
    await setMap(false);
    assert.deepEqual(await shown(aliceT), []);
    assert.equal(await goes('/map', aliceT), '/');
    assert.equal((await call('GET', `/api/destinations/map?space=${keep}`, { token: aliceT })).status, 200, 'the view of a space does not ask the option');
    fs.renameSync(mapFile, `${mapFile}.away`);
    assert.equal((await call('GET', `/api/destinations/map?space=${keep}`, { token: aliceT })).status, 404, 'but still needs the file');
    assert.equal(await goes(`/map?space=${keep}`, aliceT), '/');
    fs.renameSync(`${mapFile}.away`, mapFile);
    assert.equal(await goes('/modules/dest-globe', aliceT), 200);
    assert.equal(await goes('/modules/dest-pins', aliceT), 200);
    assert.equal((await hrefs(aliceT))['dest-pins'], '/modules/dest-pins');
  });
} finally {
  await server?.stop();
}

// Made from Travel, with no destination page built: the option is on, the destination is listed, but nothing leads to
// a page that is not there.
try {
  server = await startServer(appCopy('travel-no-page', { page: false }), { TEMPLATE: 'travel' });
  const { call, signIn } = server;
  const admin = await signIn('admin', 'testpass1234');
  await test('travel: an environment made from Travel has Show Calendar and Show Map on', async () => {
    const settings = (await call('GET', '/api/settings', { token: admin })).json.settings;
    assert.deepEqual([settings.showCalendar, settings.showMap], [true, true]);
  });
  // Whichever module is the calendar's main by then (the bundled Calendar once it declares one, else a stand-in).
  if (!(await call('GET', '/api/destinations/calendar', { token: admin })).json?.main) {
    assert.equal((await call('POST', '/api/modules', { token: admin, body: datesZip, type: 'application/zip' })).status, 201);
    assert.equal((await call('PATCH', '/api/modules/dest-dates', { token: admin, body: { enabled: true, allSpaces: true } })).status, 200);
  }
  await test('travel: with no destination page yet, /calendar goes home and module pages and tiles stay their own', async () => {
    const d = await call('GET', '/api/destinations/calendar', { token: admin });
    assert.equal(d.status, 200, d.text);
    const id = d.json.main.module.id;
    const page = await call('GET', '/calendar', { token: admin });
    assert.deepEqual([page.status, page.location], [302, '/']);
    assert.equal((await call('GET', `/modules/${id}`, { token: admin })).status, 200);
    const tiles = (await call('GET', '/api/modules/widgets', { token: admin })).json.widgets;
    assert.ok(tiles.length && tiles.every((w) => w.href === `/modules/${w.id}`), JSON.stringify(tiles.map((w) => w.href)));
  });
} finally {
  await server?.stop();
  fs.rmSync(base, { recursive: true, force: true });
}

// --- the page's layout: tabs only on a phone, the panel stacked below when it does not fit ---------------------------
await test('layout: a frame is never a phone; a narrow page stacks the panel below, with no bottom tabs', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/destination.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/destination.css'), 'utf8');
  assert.match(js, /const onPhone = \(\) => !embedded && phoneQuery\.matches;/, 'tabs only on a top-level phone');
  const stacked = css.match(/@media \(max-width: 900px\) \{([\s\S]*?)\n\}\n/);
  assert.ok(stacked, 'a stacked layout under 900px');
  assert.match(stacked[1], /body\.destination-page:not\(\.dest-has-tabs\)[^{]*\.dest \{\s*flex-direction: column;\s*overflow-y: auto;/, 'the page scrolls, main then panel');
  assert.match(stacked[1], /\.dest-side \{\s*flex: none;\s*height: 460px;/, 'the stacked panel has its own height');
  assert.ok(css.includes('@media (max-width: 640px)') && /\.dest-tabs \{\s*display: flex;/.test(css), 'the phone keeps its tabs');
  // One scroll when stacked: a part that reports its height is as tall as its content, so the grid and the Agenda (or the
  // To-do) follow each other in the page's scroll, with no scroll of their own and no fixed split.
  assert.match(css, /\.dest-main\.sized \{\s*height: auto;/, 'a sized main part takes its content height');
  assert.match(css, /\.dest-side\.sized \{\s*flex: none;\s*height: auto;/, 'a sized panel takes its content height');
  assert.match(css, /\.sized > \.dest-part-frame,[\s\S]*?height: var\(--part-h\);/, 'a sized part is as tall as it said');
  assert.match(js, /onResize: \(\{ height \} = \{\}\) => \{[\s\S]*?--part-h[\s\S]*?classList\.add\('sized'\)/, 'a part saying its height sizes it');
  for (const f of ['modules/calendar/src/calendar.js', 'modules/todo/src/todo.js']) {
    assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /if \(part\) \{\s*let told = -1;[\s\S]*?host\.resize\(\{ height: h \}\)/, `${f}: as a destination part it says how tall its content is`);
  }
});

if (failed) {
  console.error(`check-destinations: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-destinations: OK (${n} groups)`);
