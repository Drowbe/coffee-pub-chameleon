#!/usr/bin/env node
/*
 * check-last-layout.mjs -- Workspaces, step 11 (documentation/plans/plan-workspaces.md, decision 20, GitHub #744): the
 * layout each person last used in a space, kept on the server in DATA_DIR/layouts.json:
 *   "last": { "<user key>": { "layout": "<layout id>", "at": <ms> } }   one entry per person per space
 *   PUT /api/spaces/:id/last-layout { layout }   200 { layout }; the person comes from the session; the server writes `at`
 *   GET /api/spaces/:id/layouts                  carries the person's own `last`, only while it can still be opened
 * In-process: the Layouts class (round trip, bounds, hand-edited files, clean-up when a layout, a person or a space goes,
 * an unreadable file) and the environment copy (it leaves `last` out). Over HTTP, against a throwaway server: every kind
 * of viewer (admin, owner, moderator, member, someone outside, another space's moderator, a guest link, a door guest,
 * nobody), every bad shape, that nobody reads or writes another person's, that a hidden or gone layout is passed over
 * and comes back, the closed-space rules, and the file staying small.
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
const { Layouts, LayoutError } = require('../server/layouts.js');
const { exportEntries, exportLayouts } = require('../server/environment-export.js');

let n = 0;
const ok = (cond, label) => { assert.ok(cond, label); n += 1; };
const same = (got, want, label) => { assert.deepEqual(got, want, label); n += 1; };
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `check-last-layout-${name}-`));
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const blank = (name) => ({ name, modules: [] });

// --- the Layouts class ---------------------------------------------------------------------------------------------------
{
  const dir = tmp('class');
  const file = path.join(dir, 'layouts.json');
  const layouts = new Layouts(dir);
  const shared = layouts.add('s1', 'pat', { ...blank('Shared'), shared: true });
  const own = layouts.add('s1', 'pat', blank('Mine'));
  const sams = layouts.add('s1', 'sam', blank('Sams'));
  same(layouts.lastOf('s1', 'pat'), null, 'none to begin with');
  same(layouts.lastOf('s1', null), null, 'a guest has none');
  ok(!fs.readFileSync(file, 'utf8').includes('"last"'), 'nothing stored while nobody has one');
  // knows(): a fixed id, a saved layout the person can see; never another person's, never a long or odd id.
  ok(layouts.knows('s1', 'conference', 'pat') && layouts.knows('s1', 'workspace', 'pat'), 'a fixed id');
  ok(layouts.knows('s1', own.id, 'pat') && layouts.knows('s1', shared.id, 'sam'), 'their own layout, a shared one');
  ok(!layouts.knows('s1', own.id, 'sam'), "not another person's own layout");
  ok(!layouts.knows('s1', sams.id, 'pat'), "(and the other way)");
  for (const bad of ['', 'nosuch', 'x'.repeat(65), 7, null, undefined, ['map'], {}, '__proto__', 'constructor']) ok(!layouts.knows('s1', bad, 'pat'), `not ${JSON.stringify(bad)}`);
  // Round trip.
  const before = Date.now();
  same(layouts.setLast('s1', 'pat', 'conference'), 'conference', 'set');
  const rec = readJson(file).spaces.s1.last.pat;
  same(Object.keys(rec).sort(), ['at', 'layout'], 'the record is { layout, at }');
  ok(rec.layout === 'conference' && Number.isInteger(rec.at) && rec.at >= before && rec.at <= Date.now(), 'the server wrote `at`, in milliseconds');
  same(new Layouts(dir).lastOf('s1', 'pat'), 'conference', 'read back by a new instance');
  same(layouts.lastOf('s1', 'sam'), null, "another person's is not set by it");
  // The same layout again: no write, `at` stays.
  const stat = fs.statSync(file).mtimeMs;
  layouts.setLast('s1', 'pat', 'conference');
  same([readJson(file).spaces.s1.last.pat.at, fs.statSync(file).mtimeMs], [rec.at, stat], 'the same layout again writes nothing');
  layouts.setLast('s1', 'pat', own.id);
  same(layouts.lastOf('s1', 'pat'), own.id, 'a saved layout');
  // Bounds: many writes leave one entry per person.
  for (let i = 0; i < 200; i++) { layouts.setLast('s1', 'pat', i % 2 ? 'map' : 'calendar'); layouts.setLast('s1', 'sam', i % 3 ? 'workspace' : shared.id); }
  same(Object.keys(readJson(file).spaces.s1.last).sort(), ['pat', 'sam'], 'one entry per person');
  ok(JSON.stringify(readJson(file).spaces.s1.last).length < 200, 'about 100 bytes each');
  // Clean-up: deleting a layout clears the `last` that names it, for everyone; the rest stay.
  layouts.setLast('s1', 'pat', shared.id);
  layouts.setLast('s1', 'sam', shared.id);
  layouts.setLast('s1', 'bob', 'conference');
  layouts.remove('s1', shared.id, 'pat');
  same(Object.keys(readJson(file).spaces.s1.last), ['bob'], 'deleting a shared layout clears every last that names it');
  layouts.setLast('s1', 'pat', own.id);
  layouts.remove('s1', own.id, 'pat');
  same(layouts.lastOf('s1', 'pat'), null, 'and a person\'s own');
  layouts.setLast('s1', 'pat', 'map');
  layouts.setLast('s2', 'pat', 'map');
  layouts.forgetPerson('pat');
  same([layouts.lastOf('s1', 'pat'), layouts.lastOf('s2', 'pat'), layouts.lastOf('s1', 'bob')], [null, null, 'conference'], 'a removed person takes theirs in every space, nobody else\'s');
  layouts.forgetSpace('s1');
  ok(!readJson(file).spaces.s1, 'a removed space takes its entry');
  layouts.forgetPerson('bob');
  same(readJson(file), { spaces: {} }, 'nothing is left behind');
  // A space whose only record is a last layout is kept, and goes when it is the last one.
  layouts.setLast('s3', 'pat', 'workspace');
  same(Object.keys(readJson(file).spaces), ['s3'], 'a space with only a last layout has an entry');
  layouts.forgetPerson('pat');
  same(readJson(file), { spaces: {} }, 'and none after');

  // A hand-edited file is cleaned on read.
  const keep = layouts.add('s4', 'pat', blank('Keep'));
  const raw = readJson(file);
  raw.spaces.s4.last = {
    pat: { layout: keep.id, at: 5 }, sam: { layout: keep.id, at: 5 }, gone: { layout: 'lzzzzzz', at: 5 }, long: { layout: 'x'.repeat(65), at: 5 },
    noat: { layout: 'map' }, strat: { layout: 'map', at: '5' }, junk: 'map', list: ['map'], nolayout: { at: 1 }, num: { layout: 7, at: 1 }, fixed: { layout: 'documents', at: 9, extra: 1 },
  };
  fs.writeFileSync(file, JSON.stringify(raw));
  same(JSON.parse(JSON.stringify(new Layouts(dir).spaces.s4.last)), { pat: { layout: keep.id, at: 5 }, fixed: { layout: 'documents', at: 9 } }, 'a gone, long, unseen or malformed record is dropped, extra keys too');
  raw.spaces.s4.last = 'junk';
  fs.writeFileSync(file, JSON.stringify(raw));
  ok(!('last' in new Layouts(dir).spaces.s4), 'junk reads as none');
  fs.writeFileSync(file, '{"spaces": {"s5": {"shared": [], "people": {}, "last": {"pat": {"layout": "map", "at": 1}}}}}');
  same(new Layouts(dir).lastOf('s5', 'pat'), 'map', 'a file with only last is read');
  // A hand-edited or restored file whose keys are named like Object properties must boot (it crashed once: people["constructor"]
  // is a function): such a key in favorites or in last reads as a person with no saved layouts, and a fixed id still counts.
  fs.writeFileSync(file, '{"spaces": {"s6": {"shared": [], "people": {}, "favorites": {"constructor": ["map"], "toString": ["x"]}, "last": {"constructor": {"layout": "map", "at": 1}, "toString": {"layout": "nosuch", "at": 2}, "hasOwnProperty": {"layout": "calendar", "at": 3}}}}}');
  const odd = new Layouts(dir);
  same(odd.lastOf('s6', 'hasOwnProperty'), 'calendar', 'a key named hasOwnProperty is just a person: its fixed layout is kept');
  same(odd.lastOf('s6', 'toString'), null, 'and an unknown layout under such a key is dropped, not a crash');
  // An unreadable file is never written over.
  fs.writeFileSync(file, '{not json');
  const broken = new Layouts(dir);
  assert.throws(() => broken.setLast('s1', 'pat', 'map'), (e) => e instanceof LayoutError && e.status === 500);
  same(fs.readFileSync(file, 'utf8'), '{not json', 'and the file is as it was');
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- the environment copy leaves it out -------------------------------------------------------------------------------------
{
  const file = Buffer.from(JSON.stringify({ spaces: { s1: { shared: [{ id: 'labc', name: 'A', modules: [] }], people: {}, favorites: { pat: ['labc'] }, last: { pat: { layout: 'labc', at: 1 } } }, s2: { shared: [], people: {}, last: { pat: { layout: 'map', at: 1 } } } } }));
  const out = JSON.parse(exportLayouts(file).toString('utf8'));
  same(out.spaces.s1, { shared: [{ id: 'labc', name: 'A', modules: [] }], people: {}, favorites: { pat: ['labc'] } }, 'the copy keeps the layouts and favorites and drops last');
  ok(!JSON.stringify(out).includes('"last"'), 'no last anywhere in it');
  const entries = exportEntries([['layouts.json', file]], { settings: {}, users: [], spaces: [] });
  ok(!entries.find(([name]) => name === 'layouts.json')[1].toString().includes('"last"'), 'through exportEntries too');
  same(exportLayouts(Buffer.from('not json')).toString(), 'not json', 'a file that is not JSON is passed on as it is');
  // The restored copy reads back with nobody's last layout.
  const dir = tmp('restore');
  fs.writeFileSync(path.join(dir, 'layouts.json'), entries.find(([name]) => name === 'layouts.json')[1]);
  const back = new Layouts(dir);
  same([back.lastOf('s1', 'pat'), back.lastOf('s2', 'pat'), back.list('s1', 'pat').shared.length], [null, null, 1], 'a restored copy has the layouts and no last');
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- the routes, against a throwaway server ------------------------------------------------------------------------------
const dir = tmp('server');
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
  const call = async (method, urlPath, { body, token, cookie, raw, type } = {}) => {
    const headers = { accept: 'application/json' };
    let payload;
    if (raw !== undefined) { payload = raw; headers['content-type'] = type || 'application/json'; } else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    if (token) headers.authorization = `Bearer ${token}`;
    if (cookie) headers.cookie = cookie;
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: payload });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  };
  const expect = async (label, status, method, urlPath, options) => {
    const r = await call(method, urlPath, options);
    assert.equal(r.status, status, `${label}: ${method} ${urlPath} answered ${r.status} ${r.text}`);
    if (status >= 400) assert.match(r.json?.error || '', /^[A-Z"][^\n]*\.$/, `${label}: one plain sentence (${r.text})`);
    n += 1;
    return r;
  };
  const admin = (await call('POST', '/api/login', { body: { login: 'admin', password: 'testpass1234' } })).json.token;
  for (const m of ['calendar', 'documents']) {
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
  const LAST = (id) => `/api/spaces/${id}/last-layout`;
  const P = (id) => `/api/spaces/${id}`;
  const file = path.join(dir, 'layouts.json');
  const stored = () => (fs.existsSync(file) ? readJson(file) : { spaces: {} });
  const lastOf = (token, id = A) => call('GET', L(id), { token }).then((r) => r.json.last);
  const NONE = 'There is no such layout here.';

  // -- every kind of viewer ------------------------------------------------------------------------------------------------
  same(await lastOf(T.member), undefined, 'nobody has one to begin with: the key is left out');
  for (const [who, token, want] of [['admin', T.admin, 'conference'], ['owner', T.owner, 'calendar'], ['moderator', T.mod, 'documents'], ['member', T.member, 'workspace']]) {
    const r = await expect(`${who} sets theirs`, 200, 'PUT', LAST(A), { token, body: { layout: want } });
    same(r.json, { layout: want }, `${who}: 200 { layout }`);
  }
  for (const [who, token, want] of [['admin', T.admin, 'conference'], ['owner', T.owner, 'calendar'], ['moderator', T.mod, 'documents'], ['member', T.member, 'workspace']]) {
    same(await lastOf(token), want, `${who}: reads back their own`);
  }
  const at = stored().spaces[A].last;
  same(Object.keys(at).sort(), [keys.member, keys.mod, keys.owner].sort().concat([(await call('GET', '/api/users', { token: admin })).json.users.find((u) => u.login === 'admin')?.key].filter(Boolean)).sort(), 'one entry per person who set one');
  for (const rec of Object.values(at)) same(Object.keys(rec).sort(), ['at', 'layout'], 'each is { layout, at } and nothing else');
  // Nobody reads another's: the answer never names another person or their layout choice by key.
  for (const [who, token] of [['member', T.member], ['moderator', T.mod], ['owner', T.owner]]) {
    const text = (await call('GET', L(A), { token })).text;
    for (const k of Object.values(keys)) if (k !== keys[who === 'moderator' ? 'mod' : who]) ok(!text.includes(k), `${who}: another person's key is not in the answer`);
    ok(!/"at"\s*:\s*\d{12,}/.test(text), `${who}: no stored timestamps in the answer`);
  }
  // The person comes from the session: fields naming someone else are ignored.
  await expect('a member names the moderator', 200, 'PUT', LAST(A), { token: T.member, body: { layout: 'conference', key: keys.mod, user: keys.mod, userKey: keys.mod, at: 1 } });
  same([await lastOf(T.member), await lastOf(T.mod)], ['conference', 'documents'], "only the member's own changed");
  ok(stored().spaces[A].last[keys.member].at > 1e12, 'and `at` is the server\'s, not the request\'s');
  await expect('a member sets it back', 200, 'PUT', LAST(A), { token: T.member, body: { layout: 'workspace' } });
  // Not in, not a person.
  await expect('someone outside the space', 403, 'PUT', LAST(A), { token: T.other, body: { layout: 'workspace' } });
  await expect('the moderator of another space', 403, 'PUT', LAST(A), { token: T.modB, body: { layout: 'workspace' } });
  await expect('nobody signed in', 401, 'PUT', LAST(A), { body: { layout: 'workspace' } });
  let r = await expect('a guest link', 403, 'PUT', `${LAST(A)}${asGuest}`, { body: { layout: 'workspace' } });
  same(r.json.error, "Guests follow the owner's default layout, so nothing is remembered for them.", 'the sentence for a guest');
  await expect('a door guest', 403, 'PUT', `${LAST(A)}?space=${A}`, { cookie: doorCookie, body: { layout: 'workspace' } });
  await expect('a door guest with no space named', 403, 'PUT', LAST(A), { cookie: doorCookie, body: { layout: 'workspace' } });
  await expect('a guest link of this space on another', 403, 'PUT', `${LAST(B)}${asGuest}`, { body: { layout: 'workspace' } });
  for (const [who, query, extra] of [['guest link', asGuest, {}], ['door guest', `?space=${A}`, { cookie: doorCookie }]]) {
    const g = await call('GET', `${L(A)}${query}`, extra);
    same([g.status, 'last' in (g.json || {})], [200, false], `${who}: reads the layouts and has no last`);
  }
  await expect('an Aside id', 404, 'PUT', LAST('zzzz9999'), { token: T.owner, body: { layout: 'workspace' } });
  await expect('a space that is not there', 404, 'PUT', LAST('nosuchsp'), { token: T.admin, body: { layout: 'workspace' } });
  ok(!stored().spaces.zzzz9999 && !stored().spaces.nosuchsp, 'and nothing is stored for either');
  for (const method of ['DELETE', 'GET', 'POST']) ok((await call(method, LAST(A), { token: T.member })).status === 404, `no ${method} on it (the layouts answer carries it)`);
  const before = JSON.stringify(stored());

  // -- every bad shape: 400, one sentence, nothing changed ---------------------------------------------------------------
  const refused = async (label, opts) => {
    const res = await expect(label, 400, 'PUT', LAST(A), { token: T.member, ...opts });
    same(res.json.error, NONE, `${label}: the sentence`);
    same(JSON.stringify(stored()), before, `${label}: nothing changed`);
  };
  await refused('no body', {});
  await refused('an empty object', { body: {} });
  await refused('a list', { body: ['conference'] });
  // Text, null and broken JSON never reach the route: the server's JSON reader answers 400 for them (as for every route).
  for (const [label, raw] of [['text', '"conference"'], ['null', 'null'], ['broken JSON', '{"layout": ']]) {
    r = await call('PUT', LAST(A), { token: T.member, raw });
    ok(r.status === 400 && JSON.stringify(stored()) === before, `${label}: 400, nothing changed (${r.status})`);
  }
  await refused('a layout of null', { body: { layout: null } });
  await refused('a number', { body: { layout: 7 } });
  await refused('a list as the layout', { body: { layout: ['conference'] } });
  await refused('an object as the layout', { body: { layout: { id: 'conference' } } });
  await refused('an empty id', { body: { layout: '' } });
  await refused('an unknown id', { body: { layout: 'nosuch' } });
  await refused('a different case', { body: { layout: 'Conference' } });
  await refused('a space-padded id', { body: { layout: ' conference' } });
  await refused('__proto__', { body: { layout: '__proto__' } });
  await refused('constructor', { body: { layout: 'constructor' } });
  await refused('a fixed layout that is not on (Map, no Maps)', { body: { layout: 'map' } });
  await refused('64 characters that do not exist', { body: { layout: 'a'.repeat(64) } });
  await refused('65 characters', { body: { layout: 'a'.repeat(65) } });
  await refused('a long id', { body: { layout: 'a'.repeat(5000) } });
  ok((await call('PUT', LAST(A), { token: T.member, body: { layout: 'a'.repeat(100000) } })).status === 413, 'a body over 64 KB is the server\'s 413');
  r = await call('PUT', LAST(A), { token: T.member, raw: 'layout=conference', type: 'application/x-www-form-urlencoded' });
  ok(r.status === 400 && JSON.stringify(stored()) === before, `a form body is a 400 (${r.status})`);

  // -- a saved layout: only one the person can see ----------------------------------------------------------------------------
  const mine = (await expect('a member saves one', 201, 'POST', L(A), { token: T.member, body: blank('Mine') })).json.layout;
  const modsOwn = (await expect('a moderator saves one', 201, 'POST', L(A), { token: T.mod, body: blank('Mona') })).json.layout;
  const shared = (await expect('the owner shares one', 201, 'POST', L(A), { token: T.owner, body: { ...blank('Everyone'), shared: true } })).json.layout;
  await expect('a member sets their own saved layout', 200, 'PUT', LAST(A), { token: T.member, body: { layout: mine.id } });
  same(await lastOf(T.member), mine.id, 'read back');
  r = await expect("another person's own layout", 400, 'PUT', LAST(A), { token: T.member, body: { layout: modsOwn.id } });
  same(r.json.error, NONE, "it does not say the layout exists");
  await expect('the same id is unknown to a guest-side viewer', 403, 'PUT', `${LAST(A)}${asGuest}`, { body: { layout: shared.id } });
  await expect("an id from another space", 400, 'PUT', LAST(B), { token: T.member, body: { layout: shared.id } });
  await expect('a member sets a shared one', 200, 'PUT', LAST(A), { token: T.member, body: { layout: shared.id } });
  await expect('so does the moderator', 200, 'PUT', LAST(A), { token: T.mod, body: { layout: shared.id } });
  // Deleting the layout clears every last that names it; nothing else.
  await expect('the owner deletes the shared layout', 204, 'DELETE', `${L(A)}/${shared.id}`, { token: T.owner });
  same([await lastOf(T.member), await lastOf(T.mod), await lastOf(T.owner)], [undefined, undefined, 'calendar'], 'the ones that named it are gone, the owner\'s stays');
  ok(!JSON.stringify(stored()).includes(shared.id), 'and nothing in the file names it');
  await expect('a member sets their own again', 200, 'PUT', LAST(A), { token: T.member, body: { layout: mine.id } });
  await expect('and deletes it', 204, 'DELETE', `${L(A)}/${mine.id}`, { token: T.member });
  same(await lastOf(T.member), undefined, "a person's own layout deleted clears theirs");
  await expect('member back on conference', 200, 'PUT', LAST(A), { token: T.member, body: { layout: 'conference' } });

  // -- passed over, not rewritten: hidden by the owner, off, gone ------------------------------------------------------------
  await expect('the owner hides Conference', 200, 'PATCH', P(A), { token: T.owner, body: { tabs: { hide: ['conference'] } } });
  same([await lastOf(T.member), await lastOf(T.admin)], [undefined, undefined], "the owner's hide wins: it is passed over");
  same(stored().spaces[A].last[keys.member].layout, 'conference', 'the record is not rewritten');
  await expect('but it stays in the menu: choosing it sets the record', 200, 'PUT', LAST(A), { token: T.member, body: { layout: 'conference' } });
  await expect('the owner shows it again', 200, 'PATCH', P(A), { token: T.owner, body: { tabs: null } });
  same([await lastOf(T.member), await lastOf(T.admin)], ['conference', 'conference'], 'and it comes back by itself');
  await expect('members lose the conference', 200, 'PATCH', '/api/roles/member', { token: admin, body: { conference: false } });
  same([await lastOf(T.member), await lastOf(T.admin)], [undefined, 'conference'], 'a person who lost the permission passes it over, the admin does not');
  await expect('and cannot set it', 400, 'PUT', LAST(A), { token: T.member, body: { layout: 'conference' } });
  await expect('members get it back', 200, 'PATCH', '/api/roles/member', { token: admin, body: { conference: true } });
  same(await lastOf(T.member), 'conference', 'it is back');
  await expect('Documents on for the moderator', 200, 'PUT', LAST(A), { token: T.mod, body: { layout: 'documents' } });
  await expect('Documents off', 200, 'PATCH', '/api/modules/documents', { token: admin, body: { enabled: false } });
  same(await lastOf(T.mod), undefined, 'a module that is off is passed over');
  await expect('and cannot be set', 400, 'PUT', LAST(A), { token: T.owner, body: { layout: 'documents' } });
  await expect('Documents on again', 200, 'PATCH', '/api/modules/documents', { token: admin, body: { enabled: true } });
  same(await lastOf(T.mod), 'documents', 'and returns');

  // -- the spaces are separate -------------------------------------------------------------------------------------------------
  same(await lastOf(T.member, B), undefined, 'Beta has none for the member');
  await expect('member sets Beta', 200, 'PUT', LAST(B), { token: T.member, body: { layout: 'calendar' } });
  same([await lastOf(T.member, B), await lastOf(T.member, A)], ['calendar', 'conference'], 'one per space');
  r = await call('PUT', LAST(B), { token: T.mod, body: { layout: 'workspace' } });
  ok(r.status === 404 && same(await lastOf(T.member, B), 'calendar', 'untouched') === undefined, `a moderator of Alpha is not in Beta: it is not there for them (${r.status})`);

  // -- a closed space (#762): the rules are not weakened ---------------------------------------------------------------------------
  await expect('close Alpha', 200, 'PATCH', P(A), { token: T.mod, body: { closed: true } });
  const closedBefore = JSON.stringify(stored());
  for (const [who, token] of [['a member', T.member], ['someone outside', T.other]]) {
    r = await call('PUT', LAST(A), { token, body: { layout: 'workspace' } });
    ok(r.status === 403 || r.status === 404, `${who}: a closed space's last layout is not written (${r.status})`);
  }
  r = await call('PUT', `${LAST(A)}${asGuest}`, { body: { layout: 'workspace' } });
  ok(r.status === 401 || r.status === 403, `a guest link: refused (${r.status})`);
  r = await call('PUT', LAST(A), { cookie: doorCookie, body: { layout: 'workspace' } });
  ok(r.status !== 200, `a door guest: refused (${r.status})`);
  same(JSON.stringify(stored()), closedBefore, 'nothing changed');
  await expect('the space\'s moderator still may', 200, 'PUT', LAST(A), { token: T.mod, body: { layout: 'workspace' } });
  await expect('the owner still may', 200, 'PUT', LAST(A), { token: T.owner, body: { layout: 'workspace' } });
  await expect('reopen', 200, 'PATCH', P(A), { token: T.mod, body: { closed: false } });

  // -- the file stays small after many writes ------------------------------------------------------------------------------------
  for (let i = 0; i < 40; i++) await call('PUT', LAST(A), { token: T.member, body: { layout: ['workspace', 'calendar', 'conference'][i % 3] } });
  same(Object.keys(stored().spaces[A].last).length, 4, 'one entry per person after 40 writes');
  ok(JSON.stringify(stored().spaces[A].last).length < 4 * 130, 'and about 100 bytes each');

  // -- the person, the space ---------------------------------------------------------------------------------------------------------
  await expect('remove the member from the environment', 200, 'DELETE', `/api/users/${keys.member}`, { token: admin });
  ok(!JSON.stringify(stored()).includes(keys.member), 'a removed person leaves nothing behind');
  await expect('remove Alpha', 200, 'DELETE', P(A), { token: admin });
  ok(!stored().spaces[A], 'a removed space takes its entry');
  await expect('its route is gone', 404, 'PUT', LAST(A), { token: T.admin, body: { layout: 'workspace' } });
  console.log(`check-last-layout: OK (${n} checks)`);
} finally {
  await stop();
  fs.rmSync(dir, { recursive: true, force: true });
}
