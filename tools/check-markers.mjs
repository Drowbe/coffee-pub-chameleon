#!/usr/bin/env node
/*
 * check-markers.mjs -- markers on a calendar (documentation/plans/plan-calendar-markers.md, steps 1 to 3).
 *   - The manifest: "marker" is true or false, needs "dated", and is refused with "mirror" or "feed".
 *   - server/ics.js reads a number of milliseconds as an instant (a poll's closesAt).
 *   - A real single-environment server running from a copy of the app with stand-in modules bundled (tasks with a due
 *     day and a done switch, polls with a closing time in milliseconds, a calendar-like consumer approved for "*", one
 *     approved for tasks only, and one approved for nothing): GET /api/modules/:id/markers answers the shape; done
 *     tasks and polls closed by hand are left out; past markers say so; a member of space A sees A's and the
 *     environment's, not B's; a guest only their space's; without read, or with the module off in the space, none; a
 *     consumer without approval is refused, one approved for one kind sees that kind only; from and to checked (both
 *     needed, real days, at most 92 days apart counted to a date-only to's end, in order); at most 500; nothing written to the consumer's store and no twin made;
 *     the `markers` stream event, naming the modules that may hear it, and only where the listener reads.
 *   - The pages (steps 2 and 3, read as code): the Calendar draws markers as chips by the filter, "Closes" or "Closed",
 *     dimmed once past, in its module's tint; a switch per kind on the environment's page, in a space's toolbar menu and
 *     in /calendar's filter (remembered there; a space's menu per space). To-do's and Polls' manifests are in check-modules; the SDK and the host
 *     page's route and stream event in check-module-host.
 * No network beyond localhost, no LiveKit.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ics = require('../server/ics.js');
const { cleanManifest } = require('../server/modules.js');

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
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-markers-'));
const TZ = 'America/New_York';
const DAY = 86400000;
// Dates in next year, so nothing here is past whenever the check runs (except what is meant to be).
const Y = new Date().getUTCFullYear() + 1;

// --- the manifest ------------------------------------------------------------------------------------------------------
await test('manifest: "marker" is true or false, needs "dated", and never goes with "mirror" or "feed"', () => {
  const files = new Set(['page.html']);
  const manifest = (kind) => ({ id: 'thing', name: 'Thing', version: '1.0.0', scope: ['environment'], surfaces: { page: { entry: 'page.html' } }, refs: { produces: [{ kind: 'poll', key: 'poll:{id}', summary: { title: 'question' }, ...kind }] } });
  const dated = { title: 'question', start: 'closesAt' };
  assert.throws(() => cleanManifest(manifest({ marker: true }), files), { message: 'module.json: refs "poll" marker needs "dated"' });
  assert.throws(() => cleanManifest(manifest({ marker: 'yes', dated }), files), { message: 'module.json: refs "poll" marker must be true or false' });
  assert.throws(() => cleanManifest(manifest({ marker: true, dated, mirror: 'out' }), files), { message: 'module.json: refs "poll" marker can\'t be used with "mirror"' });
  assert.throws(() => cleanManifest(manifest({ marker: true, dated, feed: true }), files), { message: 'module.json: refs "poll" marker can\'t be used with "feed"' });
  const kept = cleanManifest(manifest({ marker: true, dated }), files).refs.produces[0];
  assert.deepEqual([kept.marker, kept.dated], [true, { form: 'instant', title: 'question', start: 'closesAt' }]);
  assert.equal('marker' in cleanManifest(manifest({ marker: false }), files).refs.produces[0], false, 'false is kept as nothing');
  assert.equal('marker' in cleanManifest(manifest({ dated }), files).refs.produces[0], false);
  const day = cleanManifest(manifest({ marker: true, dated: { title: 'question', day: 'due' } }), files).refs.produces[0];
  assert.deepEqual([day.marker, day.dated.form], [true, 'wall']);
});

await test('ics: an instant may be a number of milliseconds; null or junk is no date', () => {
  const dated = { form: 'instant', title: 'question', start: 'closesAt' };
  const at = Date.UTC(Y, 9, 9, 22);
  assert.deepEqual(ics.readDated({ question: 'Where?', closesAt: at }, dated, TZ), { title: 'Where?', allDay: false, start: at, end: null, repeat: null });
  assert.equal(ics.readDated({ question: 'Closed by hand', closesAt: null }, dated, TZ), null);
  assert.equal(ics.readDated({ question: 'Junk', closesAt: Number.NaN }, dated, TZ), null);
  assert.equal(ics.readDated({ question: 'Junk', closesAt: 1e20 }, dated, TZ), null);
  assert.equal(ics.readDated({ question: 'Text still', closesAt: new Date(at).toISOString() }, dated, TZ).start, at);
  const ended = { ...dated, end: 'endsAt' };
  assert.equal(ics.readDated({ question: 'E', closesAt: at, endsAt: at + 3600000 }, ended, TZ).end, at + 3600000);
});

// --- the pages (steps 2 and 3) -----------------------------------------------------------------------------------------
await test('pages: the Calendar draws markers as chips, by the filter, in every place it shows; /calendar\'s filter has a switch per kind, remembered', () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const js = read('modules/calendar/src/calendar.js');
  const css = read('modules/calendar/src/calendar.css');
  // Drawn with the events (inRange), so in Month, Week, Day and every list; a day marker in the day view's all-day row.
  assert.match(js, /for \(const x of markerItems\.values\(\)\) \{\n\s+if \(!markerShown\(x\)\) continue;/, 'inRange takes the markers the filter shows');
  assert.match(js, /if \(isMarker\(x\)\) return markerChipHtml\(x, start\);/, 'a chip of its own');
  assert.match(js, /isMarker\(x\) \? markerItemHtml\(x, start, agenda\)/, 'a row of its own in a list');
  assert.match(js, /if \(occ\.x\.ev\.allDay \|\| occ\.start < start\) allDay\.push/, 'a day marker is all-day (decision 4)');
  // Its words are the kind's (`due` from the host), never one marker's allDay: the title for a day a task is due,
  // "Closes" or "Closed" for a poll; past ones dimmed (decision 2).
  assert.match(js, /if \(x\.due\) return x\.ev\.allDay \? x\.ev\.title : `Due \$\{timeText\(start\)\}: \$\{x\.ev\.title\}`;/);
  assert.match(js, /return `\$\{past \? 'Closed' : 'Closes'\}\$\{x\.ev\.allDay \? '' : ` \$\{timeText\(start\)\}`\}: \$\{x\.ev\.title\}`;/);
  assert.match(js, /const said = x\.due \? \(past \? 'Overdue' : 'Due'\) : past \? 'Closed' : 'Closes';/, 'a list row says it the same way');
  assert.match(js, /const markerPast = \(x\) => \(x\.ev\.allDay \? x\.ev\.start < ymd\(new Date\(\)\) : x\.ev\.start <= Date\.now\(\)\);/);
  // A closed poll is dimmed once past; an overdue task is not dimmed but takes the danger tone (is-overdue, readable text).
  assert.match(js, /class="sdk-cal-event sdk-bar-kept is-marker\$\{past \? \(x\.due \? ' is-overdue' : ' is-past'\) : ''\}/, 'a chip with the kept bar, dimmed once past, or the danger tone when it is a task that is late');
  assert.match(js, /class="sdk-row sdk-bar-kept is-marker\$\{past \? \(x\.due \? ' is-overdue' : ' is-past'\) : ''\}/, 'and a row');
  assert.match(read('public/sdk/system.css'), /\.sdk-cal-event\.sdk-bar-kept\.is-marker\.is-overdue/, 'an overdue marker is in the danger tone, not dimmed');
  assert.match(read('public/sdk/system.css'), /:is\(\.sdk-cal-event, \.sdk-cal-agenda \.sdk-row\)\.is-past \{ opacity: var\(--cal-out\); \}/, 'past ones at 55% (the Calendar block)');
  // The module's tint on the edge and icon only (design-theme.md, "Tints"), from the eight, as the host sends it.
  assert.match(js, /const tint = TINTS\.includes\(m\.module\.color\) \? m\.module\.color : null;/);
  // The module's icon as the host sends it (a guest cannot ask the host for icons), asked for only when it is not.
  assert.match(js, /typeof m\.module\.svg === 'string' && m\.module\.svg\.includes\('<svg'\)[^\n]*markerIcons\.set\(m\.module\.icon, m\.module\.svg\);\n\s+else wantIcon\(m\.module\.icon\);/);
  for (const t of ['gold', 'blue', 'green', 'teal', 'purple', 'red', 'orange', 'pink']) assert.ok(css.includes(`.tint-${t} { --tint: var(--tint-${t}); }`), t);
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(css.slice(css.indexOf('/* Markers'))), 'no colour that is not a token');
  // The filter: a switch per kind in the row's Filters menu (its group "Markers": on the environment's page beside the spaces'
  // group, in a space alone; plan-unified-layout.md), a part takes the page's (markersOff), and only the space's own markers
  // in a space.
  assert.match(js, /options: kinds\.map\(\(k\) => \(\{ id: `marker:\$\{k\.id\}`, label: k\.label/, 'a switch per kind');
  assert.match(js, /\{ id: 'show-markers', label: 'Markers', options: kinds\.map/, 'in the Filters menu\'s Markers group');
  assert.match(js, /return groups\.filter\(\(g\) => g\.options\.length\)\.map\(\(g\) => \(\{ type: 'chips', \.\.\.g \}\)\);/, 'each group a chips item of the toolbar');
  assert.match(js, /if \(what === 'marker'\) return toggleMarkerKind\(id, Boolean\(e\.on\)\);/, 'a switch turns its kind on or off');
  const frameJs = read('public/module-frame.js');
  assert.match(frameJs, /on\.on = !isOn\(on\);\s*\n\s*pick\(`\$\{n\.id\}\\n\$\{on\.id\}`, on\.on\);\s*\n\s*fire\(\{ id: n\.id, value: on\.id, on: on\.on \}\);/, 'the frame sends the switch and its new state (on the entry shown now)');
  const hostPage = read('public/module-host.js');
  assert.match(hostPage, /for \(const k of \['value', 'on', 'submit'\]\) if \(e\[k\] !== undefined\) data\[k\] = e\[k\];/, 'and the host hands it to the module as it is');
  // A space's switches are remembered in this browser, per space, as /calendar remembers its filter.
  assert.match(js, /const MARKERS_OFF_KEY = inSpace && !part && info\.context\.spaceId \? `calendar-markers-off:\$\{info\.context\.spaceId\}` : '';/);
  assert.match(js, /JSON\.parse\(localStorage\.getItem\(MARKERS_OFF_KEY\) \|\| '\[\]'\)/, 'read when it opens');
  assert.match(js, /localStorage\.setItem\(MARKERS_OFF_KEY, JSON\.stringify\(\[\.\.\.hiddenMarkers\]\)\)/, 'and kept on each switch');
  // Closed: nothing more is drawn (a late icon or answer), and the timer that dims past markers stops.
  assert.match(js, /function render\(\) \{\n[^\n]*\n\s+if \(!\$\('app'\)\) return;/);
  assert.match(js, /const pastTimer = setInterval\(\(\) => \{\n\s+if \(!\$\('app'\)\) return void clearInterval\(pastTimer\);/);
  assert.match(js, /if \(Array\.isArray\(st\.markersOff\)\)/, 'a part takes the page\'s filter');
  assert.match(js, /host\.destination\.set\(\{ markerKinds:/, 'and tells the page which kinds it shows');
  assert.match(js, /if \(ref\.scope === 'space' && !inSpace\) return pickedSpaces \? pickedSpaces\.has\(ref\.space\) : !hiddenSpaces\.has\(ref\.space\);/, 'a space\'s markers follow its switch');
  assert.match(js, /const markerKindLabel = [^\n]*\$\{m\.due === true \? 'due' : 'closing'\}`;/, '"Tasks due", "Polls closing", by the kind');
  const dest = read('public/destination.js');
  assert.match(dest, /markers: true,/, '/calendar lists the kinds of markers');
  assert.match(dest, /const markers = kind\.markers \? markerKinds\.map\(\(k\) => \(\{ id: `\$\{MARKER\}\$\{k\.id\}`/, 'a switch per kind');
  assert.match(dest, /\{ id: 'dest-markers', label: 'Markers', options: markers \}/, 'in its own group of the Filters menu');
  assert.match(dest, /remember\(\{ off: \[\.\.\.off\][^\n]*markersOff: \[\.\.\.markersOff\]/, 'remembered as the filter is');
  assert.match(dest, /remember\(\{ markerKinds \}\);/, 'and the kinds, so the switches stay after a reload');
  assert.match(dest, /\.\.\.\(kind\.markers \? \{ markersOff: \[\.\.\.markersOff\] \} : \{\}\)/, 'and handed to the parts');
});

// --- a real server -----------------------------------------------------------------------------------------------------
function writeModule(dir, id, refs, { scope = ['environment', 'space'], color, guards } = {}) {
  const root = path.join(dir, id);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'module.json'), JSON.stringify({
    id, name: id, version: '1.0.0', scope, icon: 'circle', ...(color ? { color } : {}), description: 'A stand-in for check-markers.',
    surfaces: { page: { entry: `${id}.html` }, canvas: { entry: `${id}.html` } },
    permissions: [
      { key: 'view', label: 'See it', default: { member: true, moderator: true, guest: true } },
      { key: 'edit', label: 'Change it', default: { member: true, moderator: true, guest: false } },
    ],
    access: { read: 'view', write: 'edit' },
    refs,
    ...(guards ? { guards } : {}),
  }, null, 2));
  fs.writeFileSync(path.join(root, 'src', `${id}.html`), '<!DOCTYPE html><html><head><style>/*__CSS__*/</style></head><body><script>/*__JS__*/</script></body></html>');
  fs.writeFileSync(path.join(root, 'src', `${id}.css`), '');
  fs.writeFileSync(path.join(root, 'src', `${id}.js`), '');
}
const STAND_INS = ['mk-tasks', 'mk-polls', 'mk-calendar', 'mk-tasks-only', 'mk-unapproved', 'mk-secret'];
function appCopy(name) {
  const root = path.join(base, name);
  fs.mkdirSync(path.join(root, 'modules'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'server'), path.join(root, 'server'), { recursive: true });
  for (const link of ['public', 'templates', 'node_modules', 'package.json']) fs.symlinkSync(path.join(ROOT, link), path.join(root, link));
  for (const m of fs.readdirSync(path.join(ROOT, 'modules'))) fs.symlinkSync(path.join(ROOT, 'modules', m), path.join(root, 'modules', m));
  const mods = path.join(root, 'modules');
  writeModule(mods, 'mk-tasks', { produces: [{
    kind: 'task', name: 'Task', open: true, key: 'task:{id}', summary: { title: 'title', when: 'due', done: 'done' },
    dated: { title: 'title', day: 'due' }, marker: true,
  }] });
  writeModule(mods, 'mk-polls', { produces: [{
    kind: 'poll', name: 'Poll', open: true, key: 'poll:{id}', summary: { title: 'question', when: 'closesAt' },
    dated: { title: 'question', start: 'closesAt' }, marker: true,
  }] }, { color: 'purple' });
  // As the Calendar: it consumes "*" and takes twins of what sends them, so a marker kind making one would show here.
  writeModule(mods, 'mk-calendar', { produces: [{
    kind: 'event', name: 'Event', open: true, key: 'event:{id}', summary: { title: 'title', when: 'start', allDay: 'allDay' },
    dated: { title: 'title', start: 'start', allDay: 'allDay' }, mirror: 'in', create: { id: '{id}', by: '{by}' },
  }], consumes: ['*'] });
  writeModule(mods, 'mk-tasks-only', { consumes: ['mk-tasks:task'] });
  // A marker kind whose title is kept from guests (guards.hidden): a guest's marker is read without it.
  writeModule(mods, 'mk-secret', { produces: [{
    kind: 'plan', name: 'Plan', open: true, key: 'plan:{id}', summary: { title: 'title', when: 'due' },
    dated: { title: 'title', day: 'due' }, marker: true,
  }] }, { guards: { hidden: ['title'] } });
  writeModule(mods, 'mk-unapproved', {});
  return root;
}
async function startServer(root) {
  const child = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: path.join(root, 'data'), TZ, ADMIN_PASSWORD: 'testpass1234' },
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
  const call = (method, urlPath, { body, cookie } = {}) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { host: `localhost:${port}`, accept: 'application/json' };
    if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = payload.length; }
    if (cookie) headers.cookie = cookie;
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch { /* not JSON */ }
          resolve({ status: res.statusCode, text, json });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  };
  // A live stream: what it has heard so far, as { event, data }.
  const listen = (urlPath, cookie) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: urlPath, headers: { host: `localhost:${port}`, accept: 'text/event-stream', ...(cookie ? { cookie } : {}) } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('error', () => {});
      const heard = () => text.split('\n\n').map((block) => {
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        return event ? { event, data: data ? JSON.parse(data) : null } : null;
      }).filter(Boolean);
      resolve({ status: res.statusCode, heard, close: () => req.destroy() });
    });
    req.on('error', (err) => { if (err.code !== 'ECONNRESET') reject(err); });
    req.end();
  });
  const stop = () => new Promise((resolve) => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
  return { call, listen, stop, root, port, output: () => out };
}
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const servers = [];
try {
  const server = await startServer(appCopy('single'));
  servers.push(server);
  const { call, listen } = server;
  // Signing in keeps the session cookie (the call helper does not answer headers, so this one does).
  const signIn = (login, password) => new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify({ login, password }));
    const req = http.request({ host: '127.0.0.1', port: server.port, method: 'POST', path: '/api/login', headers: { host: `localhost:${server.port}`, 'content-type': 'application/json', 'content-length': payload.length } }, (res) => {
      res.resume();
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`${login} could not sign in (${res.statusCode})`));
        resolve([].concat(res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; '));
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
  const admin = await signIn('admin', 'testpass1234');
  const mk = async (login) => {
    const r = await call('POST', '/api/users', { cookie: admin, body: { login, displayName: login, role: 'member', password: 'memberpass1234' } });
    assert.equal(r.status, 201, r.text);
    return r.json.user.key;
  };
  const [alice, bob] = [await mk('alice'), await mk('bob')];
  const spaceA = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Keep', members: [alice] } })).json.space.id;
  const spaceB = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Tower', members: [bob] } })).json.space.id;
  const spaceC = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Crowded', members: [] } })).json.space.id;
  const guestToken = (await call('POST', `/api/spaces/${spaceA}/guest-link`, { cookie: admin, body: {} })).json.space.guestToken;
  const [aliceC, bobC] = [await signIn('alice', 'memberpass1234'), await signIn('bob', 'memberpass1234')];
  for (const id of STAND_INS) {
    const installed = await call('POST', `/api/modules/bundled/${id}/install`, { cookie: admin, body: {} });
    assert.equal(installed.status, 201, `${id}: ${installed.text}\n${server.output().slice(-1500)}`);
    const on = await call('PATCH', `/api/modules/${id}`, { cookie: admin, body: { enabled: true, allSpaces: true } });
    assert.equal(on.status, 200, `${id}: ${on.text}`);
  }
  const put = async (moduleId, key, value, where = 'environment') => {
    const q = where === 'environment' ? 'scope=environment' : `scope=space&space=${where}`;
    const r = await call('PUT', `/api/modules/${moduleId}/data/${encodeURIComponent(key)}?${q}`, { cookie: admin, body: { value } });
    assert.equal(r.status, 200, r.text);
  };
  const markers = (cookie, query, consumer = 'mk-calendar') => call('GET', `/api/modules/${consumer}/markers?${query}`, { cookie });
  const titles = (r) => r.json.markers.map((m) => m.title);
  const OCT = `from=${Y}-10-01&to=${Y}-10-31`;

  const pollAt = Date.UTC(Y, 9, 9, 22); // 18:00 in New York
  await put('mk-tasks', 'task:t1', { title: 'Pack the bags', due: `${Y}-10-09`, done: false }, spaceA);
  await put('mk-tasks', 'task:t2', { title: 'Done already', due: `${Y}-10-10`, done: true }, spaceA);
  await put('mk-tasks', 'task:t3', { title: 'No due day', due: null, done: false }, spaceA);
  await put('mk-tasks', 'task:t4', { title: 'In November', due: `${Y}-11-02`, done: false }, spaceA);
  await put('mk-tasks', 'task:b1', { title: 'Tower task', due: `${Y}-10-12`, done: false }, spaceB);
  await put('mk-tasks', 'task:e1', { title: 'Everyone\'s task', due: `${Y}-10-15`, done: false });
  await put('mk-polls', 'poll:p1', { question: 'Where for dinner?', closesAt: pollAt, closed: false }, spaceA);
  await put('mk-polls', 'poll:p2', { question: 'Closed by hand', closesAt: null, closed: true }, spaceA);
  await put('mk-polls', 'poll:b1', { question: 'Tower poll', closesAt: pollAt, closed: false }, spaceB);

  await test('server: the shape, a day marker and a timed marker; done tasks, undated ones and polls closed by hand left out', async () => {
    const r = await markers(aliceC, `scope=space&space=${spaceA}&${OCT}`);
    assert.equal(r.status, 200, r.text);
    // The module's icon comes as inline SVG, which a guest can show (it cannot ask /api/icons).
    const svgs = r.json.markers.map((m) => m.module.svg);
    for (const svg of svgs) assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
    for (const m of r.json.markers) delete m.module.svg;
    assert.deepEqual(r.json, { markers: [
      { ref: { module: 'mk-tasks', kind: 'task', scope: 'space', space: spaceA, id: 't1' }, kind: 'task', title: 'Pack the bags', start: `${Y}-10-09`, allDay: true, due: true, past: false, module: { id: 'mk-tasks', name: 'mk-tasks', icon: 'circle', color: null } },
      { ref: { module: 'mk-polls', kind: 'poll', scope: 'space', space: spaceA, id: 'p1' }, kind: 'poll', title: 'Where for dinner?', start: pollAt, allDay: false, due: false, past: false, module: { id: 'mk-polls', name: 'mk-polls', icon: 'circle', color: 'purple' } },
    ] });
  });

  await test('server: between from and to only; a date-only to takes its whole day', async () => {
    assert.deepEqual(titles(await markers(aliceC, `scope=space&space=${spaceA}&from=${Y}-10-10&to=${Y}-11-30`)), ['In November']);
    assert.deepEqual(titles(await markers(aliceC, `scope=space&space=${spaceA}&from=${Y}-10-09&to=${Y}-10-09`)), ['Pack the bags', 'Where for dinner?']);
    const before = new Date(pollAt - 1).toISOString();
    assert.deepEqual(titles(await markers(aliceC, `scope=space&space=${spaceA}&from=${Y}-10-09T00:00:00Z&to=${encodeURIComponent(before)}`)), ['Pack the bags'], 'a timed to is where the window ends');
  });

  await test('server: from and to are checked: both needed, real dates or times, in order, at most 92 days apart', async () => {
    const q = `scope=space&space=${spaceA}`;
    for (const [query, error] of [
      [`${q}&from=${Y}-10-01`, 'from and to are both needed, as dates or times, such as 2026-10-01 or 2026-10-01T18:00:00Z.'],
      [`${q}&from=soon&to=${Y}-10-01`, 'from and to are dates or times, such as 2026-10-01 or 2026-10-01T18:00:00Z.'],
      [`${q}&from=${Y}-10-31&to=${Y}-10-01`, 'to comes after from.'],
      [`${q}&from=${Y}-10-01&to=${Y + 1}-01-02`, 'from and to can be at most 92 days apart.'],
      // A date-only to takes in its whole day, so the 92 days are counted to its end: Oct 1 to Jan 1 is 93 days.
      [`${q}&from=${Y}-10-01&to=${Y + 1}-01-01`, 'from and to can be at most 92 days apart.'],
      // A day that does not exist is no date, never rolled over into the next month.
      [`${q}&from=${Y}-02-30&to=${Y}-03-05`, 'from and to are dates or times, such as 2026-10-01 or 2026-10-01T18:00:00Z.'],
      [`${q}&from=${Y}-03-01&to=${Y}-04-31`, 'from and to are dates or times, such as 2026-10-01 or 2026-10-01T18:00:00Z.'],
      [`${q}&from=${Y}-13-01T00:00:00Z&to=${Y}-12-05`, 'from and to are dates or times, such as 2026-10-01 or 2026-10-01T18:00:00Z.'],
    ]) {
      const r = await markers(aliceC, query);
      assert.deepEqual([r.status, r.json.error], [400, error], query);
    }
    assert.equal((await markers(aliceC, `${q}&from=${Y}-10-01&to=${Y}-12-31`)).status, 200, '92 days, to the end of Dec 31, is allowed');
    assert.equal((await markers(aliceC, `${q}&from=${Y}-10-01T00:00:00Z&to=${Y + 1}-01-01T00:00:00Z`)).status, 200, 'and 92 days to a time');
    assert.equal((await markers(aliceC, `${q}&from=2028-02-29&to=2028-03-01`)).status, 200, 'a leap day is a day');
    assert.equal((await markers(aliceC, `scope=person&${OCT}`)).status, 400, 'no person scope');
    assert.equal((await markers(aliceC, `scope=spaces&${OCT}`)).status, 400, 'no spaces scope');
  });

  await test('server: on an environment page, a member sees the environment\'s and their own spaces\', not another space\'s', async () => {
    const a = await markers(aliceC, OCT);
    assert.equal(a.status, 200, a.text);
    assert.deepEqual(titles(a), ['Pack the bags', 'Where for dinner?', 'Everyone\'s task']);
    assert.deepEqual(a.json.markers.map((m) => m.ref.scope), ['space', 'space', 'environment']);
    assert.deepEqual(titles(await markers(bobC, OCT)), ['Tower poll', 'Tower task', 'Everyone\'s task'], 'in time order');
    const notHis = await markers(bobC, `scope=space&space=${spaceA}&${OCT}`);
    assert.equal(notHis.status, 403, 'bob is not in space A');
    assert.equal(typeof notHis.json.error, 'string');
  });

  await test('server: a guest reads only their space\'s', async () => {
    assert.deepEqual(titles(await call('GET', `/api/modules/mk-calendar/markers?scope=space&space=${spaceA}&${OCT}&guest=${guestToken}`)), ['Pack the bags', 'Where for dinner?']);
    assert.equal((await call('GET', `/api/modules/mk-calendar/markers?scope=space&space=${spaceB}&${OCT}&guest=${guestToken}`)).status, 403);
    assert.equal((await call('GET', `/api/modules/mk-calendar/markers?${OCT}&guest=${guestToken}`)).status, 403);
    assert.equal((await call('GET', `/api/modules/mk-calendar/markers?${OCT}`)).status, 401, 'signed out');
  });

  await test('server: a guest\'s markers are read without the fields kept from guests (QA round 2, 12)', async () => {
    await put('mk-secret', 'plan:s1', { title: 'Surprise party', due: `${Y}-12-05` }, spaceA);
    const DEC = `from=${Y}-12-01&to=${Y}-12-31`;
    assert.deepEqual(titles(await markers(aliceC, `scope=space&space=${spaceA}&${DEC}`)), ['Surprise party'], 'a member sees the title');
    const guest = await call('GET', `/api/modules/mk-calendar/markers?scope=space&space=${spaceA}&${DEC}&guest=${guestToken}`);
    assert.equal(guest.status, 200, guest.text);
    assert.deepEqual(titles(guest), ['Untitled'], 'a guest does not');
    assert.doesNotMatch(guest.text, /Surprise/);
  });

  await test('server: a consumer without approval is refused; one approved for tasks sees tasks only', async () => {
    const r = await markers(aliceC, `scope=space&space=${spaceA}&${OCT}`, 'mk-unapproved');
    assert.equal(r.status, 403, r.text);
    assert.equal(r.json.error, 'This module has not been approved to link to other modules\' objects.');
    assert.deepEqual(titles(await markers(aliceC, `scope=space&space=${spaceA}&${OCT}`, 'mk-tasks-only')), ['Pack the bags']);
    assert.equal((await markers(aliceC, `scope=space&space=${spaceA}&${OCT}`, 'no-such-module')).status, 404);
  });

  await test('server: the person\'s current rights: without read, or with the module off, no markers', async () => {
    assert.equal((await call('PATCH', '/api/roles/member', { cookie: admin, body: { 'module.mk-polls.view': false } })).status, 200);
    assert.deepEqual(titles(await markers(aliceC, `scope=space&space=${spaceA}&${OCT}`)), ['Pack the bags']);
    assert.equal((await call('PATCH', '/api/roles/member', { cookie: admin, body: { 'module.mk-polls.view': true } })).status, 200);
    assert.equal((await call('PATCH', '/api/modules/mk-tasks', { cookie: admin, body: { enabled: false } })).status, 200);
    assert.deepEqual(titles(await markers(aliceC, OCT)), ['Where for dinner?'], 'tasks off');
    assert.equal((await call('PATCH', '/api/modules/mk-tasks', { cookie: admin, body: { enabled: true } })).status, 200);
    assert.deepEqual(titles(await markers(aliceC, OCT)), ['Pack the bags', 'Where for dinner?', 'Everyone\'s task']);
  });

  await test('server: past markers say so; a poll stays after its closing time', async () => {
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    await put('mk-polls', 'poll:old', { question: 'Closed an hour ago', closesAt: now - 3600000, closed: true }, spaceA);
    await put('mk-tasks', 'task:old', { title: 'Overdue', due: new Date(now - 3 * DAY).toISOString().slice(0, 10), done: false }, spaceA);
    const r = await markers(aliceC, `scope=space&space=${spaceA}&from=${new Date(now - 10 * DAY).toISOString().slice(0, 10)}&to=${today}`);
    const byTitle = Object.fromEntries(r.json.markers.map((m) => [m.title, m]));
    assert.deepEqual([byTitle['Closed an hour ago']?.past, byTitle.Overdue?.past], [true, true]);
  });

  await test('server: nothing is written to the consumer and no twin is made', async () => {
    for (const where of [`scope=space&space=${spaceA}`, `scope=space&space=${spaceB}`, 'scope=environment']) {
      const r = await call('GET', `/api/modules/mk-calendar/data?${where}`, { cookie: admin });
      assert.equal(r.status, 200, r.text);
      assert.deepEqual(r.json.items, [], where);
    }
  });

  await test('stream: a markers event names the approved modules, only where the listener reads, with no object data', async () => {
    const inA = await listen(`/api/modules/stream?space=${spaceA}`, aliceC);
    const page = await listen('/api/modules/stream', aliceC);
    const bobs = await listen('/api/modules/stream', bobC);
    const guest = await listen(`/api/modules/stream?space=${spaceA}&guest=${guestToken}`);
    assert.deepEqual([inA.status, page.status, bobs.status, guest.status], [200, 200, 200, 200]);
    await wait(150);
    await put('mk-tasks', 'task:live', { title: 'Heard live', due: `${Y}-10-20`, done: false }, spaceA);
    await call('DELETE', `/api/modules/mk-polls/data/${encodeURIComponent('poll:p2')}?scope=space&space=${spaceA}`, { cookie: admin });
    await put('mk-tasks', 'task:e2', { title: 'Environment, live', due: `${Y}-10-21`, done: false });
    await put('mk-calendar', 'note:x', { title: 'Not a marker kind' }, spaceA);
    await wait(300);
    const of = (s) => s.heard().filter((h) => h.event === 'markers').map((h) => h.data);
    const both = ['mk-calendar', 'mk-tasks-only'];
    assert.deepEqual(of(inA), [{ modules: both }, { modules: ['mk-calendar'] }], 'the space page: A\'s task, then A\'s poll deleted; not the environment\'s');
    assert.deepEqual(of(page), [{ modules: both }, { modules: ['mk-calendar'] }, { modules: both }], 'the environment page: A\'s and the environment\'s');
    assert.deepEqual(of(bobs), [{ modules: both }], 'bob: only the environment\'s, nothing from A');
    assert.deepEqual(of(guest), [{ modules: both }, { modules: ['mk-calendar'] }], 'a guest of A hears A\'s');
    for (const s of [inA, page, bobs, guest]) s.close();
  });
  // Writes are limited per module and person (240 a minute), so three people in space C write the 501 tasks.
  await test('server: at most 500 markers, the earliest', async () => {
    const writers = [];
    for (const login of ['crowd1', 'crowd2', 'crowd3']) writers.push(await mk(login));
    assert.equal((await call('PATCH', `/api/spaces/${spaceC}`, { cookie: admin, body: { members: [alice, ...writers] } })).status, 200);
    const cookies = [];
    for (const login of ['crowd1', 'crowd2', 'crowd3']) cookies.push(await signIn(login, 'memberpass1234'));
    for (let i = 0; i < 501; i += 1) {
      const r = await call('PUT', `/api/modules/mk-tasks/data/task:c${i}?scope=space&space=${spaceC}`, { cookie: cookies[i % 3], body: { value: { title: `Crowd ${String(i).padStart(3, '0')}`, due: `${Y}-12-${String(1 + Math.floor(i / 18)).padStart(2, '0')}`, done: false } } });
      assert.equal(r.status, 200, r.text);
    }
    const r = await markers(aliceC, `scope=space&space=${spaceC}&from=${Y}-12-01&to=${Y}-12-31`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.markers.length, 500);
    assert.ok(!r.json.markers.some((m) => m.title === 'Crowd 500'), 'the latest one is the one left out');
    assert.equal(r.json.markers.at(-1).start, `${Y}-12-28`);
  });
} finally {
  for (const s of servers) await s.stop();
  fs.rmSync(base, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-markers: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-markers: OK (${n} groups)`);
