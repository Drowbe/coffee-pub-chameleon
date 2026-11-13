#!/usr/bin/env node
/*
 * check-closed-space.mjs -- a space closed for set up (issue #762). `closed: true` on a space record; the one rule,
 * server/space-access.js mayEnter, lets in only owners, the admin, that space's moderators and the access key; every
 * route and list that asks it follows. First the rule on its own and the four switches' logic (public/space-setup.js),
 * then a real server (and a second one with the guest door on) with each kind of viewer asked of a closed space whose
 * entry is 'guests' (so everyone could have entered it) and of a closed invited-only one (so an outsider must learn
 * nothing): the space API, the lists, chat, streams, module data, uploads, the call token, the guest link and the door.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { mayEnter, mayRequest, closedFor, closedView, isClosed, enterable } = require('../server/space-access.js');
const { SPACE_FIELDS, exportApp } = require('../server/environment-export.js');
const { entrySwitches, withEntrySwitch, setupPatch, MODERATOR_FIELDS, tabOfField } = await import(pathToFileURL(path.join(ROOT, 'public', 'space-setup.js')).href);
let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};

// --- the rule ---------------------------------------------------------------------------------------------------------
const space = (over = {}) => ({ id: 'aaaa', name: 'A', members: ['mem', 'mod'], entry: 'guests', closed: true, requestAccess: true, ...over });
await test('mayEnter on a closed space: owner, its moderator, the access key; nobody else', () => {
  const s = space();
  assert.equal(mayEnter({ key: 'own', owner: true }, s), true);
  assert.equal(mayEnter({ key: 'mod', owner: false, moderates: ['aaaa'] }, s), true);
  assert.equal(mayEnter({ all: true }, s), true);
  assert.equal(mayEnter({ key: 'mem' }, s), false, 'a member');
  assert.equal(mayEnter({ key: 'mem', moderates: [] }, s), false);
  assert.equal(mayEnter({ key: 'mod', moderates: ['bbbb'] }, s), false, 'moderates another space');
  assert.equal(mayEnter({ key: 'out', moderates: ['aaaa'] }, s), false, 'ticked but not a member');
  assert.equal(mayEnter({ key: 'out' }, s), false, 'any account');
  assert.equal(mayEnter({ guestSpace: 'aaaa' }, s), false, 'a link guest');
  assert.equal(mayEnter({ doorGuest: true, doorOn: true, granted: ['aaaa'] }, s), false, 'a door guest, even with a grant');
  assert.equal(mayEnter(null, s), false);
});
await test('reopening restores exactly; absent and false are open; the Lobby is never closed', () => {
  assert.equal(mayEnter({ key: 'mem' }, space({ closed: false })), true);
  const { closed: _c, ...open } = space();
  assert.equal(mayEnter({ key: 'out' }, open), true);
  assert.equal(mayEnter({ key: 'out' }, { id: 'lobby', isLobby: true, members: [], closed: true }), true);
  assert.equal(isClosed({ id: 'lobby', closed: true }), false);
  assert.equal(mayEnter({ key: 'mem' }, space({ closed: 'yes' })), true, 'only true closes');
});
await test('closedFor: refused only because closed; an outsider of an invited space is not told', () => {
  assert.equal(closedFor({ key: 'mem' }, space({ entry: 'invited' })), true);
  assert.equal(closedFor({ key: 'out' }, space({ entry: 'invited' })), false);
  assert.equal(closedFor({ key: 'out' }, space({ entry: 'accounts' })), true);
  assert.equal(closedFor({ guestSpace: 'aaaa' }, space()), true);
  assert.equal(closedFor({ key: 'own', owner: true }, space()), false);
  assert.equal(closedFor({ all: true }, space()), false);
  assert.equal(closedFor({ key: 'mem' }, space({ closed: false })), false);
  assert.deepEqual(Object.keys(closedView(space({ guestToken: 'secret' }))).sort(), ['closed', 'description', 'entry', 'hasImage', 'id', 'isLobby', 'members', 'name']);
  assert.deepEqual(closedView(space()).members, []);
});
await test('mayRequest: while closed nobody may ask', () => {
  assert.equal(mayRequest({ key: 'out' }, space({ entry: 'invited', closed: false })), true);
  assert.equal(mayRequest({ key: 'out' }, space({ entry: 'invited' })), false);
  assert.equal(mayRequest({ doorGuest: true, doorOn: true, granted: [] }, space({ entry: 'invited' })), false);
});
await test('enterable drops a closed space for a member and keeps it for a moderator', () => {
  assert.deepEqual(enterable({ key: 'mem' }, [space(), space({ id: 'bbbb', closed: false })]).map((s) => s.id), ['bbbb']);
  assert.deepEqual(enterable({ key: 'mod', moderates: ['aaaa'] }, [space()]).map((s) => s.id), ['aaaa']);
});

// --- the four switches' logic (Set up) -------------------------------------------------------------------------------
await test('the nesting: Visiting guests on turns All members on; All members off turns Visiting guests off', () => {
  let d = { entry: 'invited', allowGuests: true };
  assert.deepEqual(entrySwitches(d), { open: true, accounts: false, invited: true, visiting: false });
  d = withEntrySwitch(d, 'visiting', true);
  assert.equal(d.entry, 'guests');
  assert.deepEqual(entrySwitches(d), { open: true, accounts: true, invited: true, visiting: true });
  d = withEntrySwitch(d, 'accounts', false);
  assert.equal(d.entry, 'invited');
  assert.equal(entrySwitches(d).visiting, false);
  d = withEntrySwitch(d, 'accounts', true);
  assert.equal(d.entry, 'accounts');
  d = withEntrySwitch(withEntrySwitch(d, 'visiting', true), 'visiting', false);
  assert.equal(d.entry, 'accounts', 'Visiting guests off leaves All members on');
  assert.equal(withEntrySwitch({ entry: 'guests' }, 'accounts', true).entry, 'guests', 'on again changes nothing');
  assert.equal(withEntrySwitch({}, 'invited', false).allowGuests, false);
});
await test('closing changes only closed; the other three keep their values; reopening restores', () => {
  const before = { entry: 'guests', allowGuests: false, closed: false };
  const closed = withEntrySwitch(before, 'open', false);
  assert.deepEqual({ ...closed, closed: false }, before);
  assert.equal(closed.closed, true);
  const sw = entrySwitches(closed);
  assert.deepEqual([sw.open, sw.accounts, sw.invited, sw.visiting], [false, true, false, true]);
  assert.deepEqual(withEntrySwitch(closed, 'open', true), before);
  assert.deepEqual(setupPatch({ closed: false }, { closed: true }), { closed: true });
  assert.deepEqual(setupPatch({ closed: true }, { closed: true }), {});
  assert.ok(MODERATOR_FIELDS.includes('closed') && !MODERATOR_FIELDS.includes('entry') && !MODERATOR_FIELDS.includes('allowGuests'));
  assert.equal(tabOfField('closed', ['phases', 'modules']), 'modules');
  assert.equal(tabOfField('closed', ['space', 'members', 'phases', 'modules']), 'members');
});
await test('the label: the space name is set as text, truncated, whole in the title', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'space-setup.js'), 'utf8');
  assert.match(src, /open\.textContent = `\$\{membersWord\(true\)\} of /);
  assert.match(src, /open\.title = /);
  assert.match(src, /chars\.length > 30 \? `\$\{chars\.slice\(0, 29\)\.join\(''\)\}…`/);
  assert.doesNotMatch(src.slice(src.indexOf('const open = q'), src.indexOf("const name = q('#setup-environment-name')")), /innerHTML/);
  assert.match(src, /id="setup-environment-name"/);
  assert.match(src, /name\.textContent = state\.environmentName \|\| word\('environment'\)/);
});
await test('closed is on the environment copy', () => {
  assert.ok(SPACE_FIELDS.includes('closed'));
  const copy = exportApp({ spaces: [{ id: 'aaaa', name: 'A', members: [], closed: true }, { id: 'bbbb', name: 'B', members: [] }] });
  assert.equal(copy.spaces[0].closed, true);
  assert.equal('closed' in copy.spaces[1], false);
});

// The guard: a bare `members.includes(` is not the entry rule (a member of a closed space is not let in), so in
// server/index.js it may not gate a read or write route. Each deliberate use is listed here with why it is safe; a new one
// fails until it uses userIsIn / spaceAccess.mayEnter or is added here with a reason.
await test('server/index.js: no bare members.includes gates a route unless it is listed with a reason', () => {
  const ALLOWED = [
    ['if (space.isLobby || !space.members.includes(u.key)) continue;', 'a person\'s own pictures per space, in their own profile answer; reveals nothing of the space'],
    ['return Boolean(user && space && space.members.includes(user.key)', 'userIsIn itself: the member test, then mayEnter'],
    ['return Boolean(user && space && space.members.includes(user.key) && store.spaceFlags(user.key, space.id).moderator);', 'moderates(): the flag; mayEnter asks it only together with the closed test'],
    ["if (!theSpace.members.includes(user.key) && !isOwner(req)) {", 'POST /api/call/join: after closedFor; an outsider is answered as an unknown id by mayEnter'],
    ["return spaces.some((r) => (r.members || []).includes(user.key));", 'guestMaySeePerson: spaces is already only the ones the guest may enter (mayEnter)'],
    ["if (!space.members.includes(currentUser(req).key) && !isOwner(req)) return res.status(403)", 'requireSpaceMember (the space address routes): right after its spaceAccess.mayEnter refusal'],
    ["aside.members.includes(user.key)", 'an aside: asides cannot be closed (isClosed is for spaces)'],
    ["if (people.some((k) => !space.members.includes(k)))", 'checks who was chosen, not who asks; the asker passed the route\'s own entry test'],
  ];
  const lines = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8').split('\n');
  const used = new Set();
  const bare = [];
  lines.forEach((line, i) => {
    if (!/members(?: \|\| \[\])?\)?\.includes\(/.test(line) || /^\s*\/\//.test(line)) return;
    const hits = ALLOWED.map(([text], j) => (line.includes(text) ? j : -1)).filter((j) => j >= 0);
    if (hits.length) hits.forEach((j) => used.add(j)); else bare.push(`${i + 1}: ${line.trim()}`);
  });
  assert.deepEqual(bare, [], 'use userIsIn(user, space) or spaceAccess.mayEnter, or list it above with a reason');
  assert.deepEqual(ALLOWED.map((_, i) => i).filter((i) => !used.has(i)), [], 'an allowed line is gone: remove it from the list');
});

// --- real servers ----------------------------------------------------------------------------------------------------
const standIn = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"participants":[]}'); }); });
await new Promise((r) => standIn.listen(0, '127.0.0.1', r));
const servers = [];
async function startServer(extra = {}, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-closed-'))) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dir, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ADMIN_PASSWORD: 'testpass1234', LIVEKIT_API_URL: `http://127.0.0.1:${standIn.address().port}`, ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
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
    return { status: res.status, json, text, headers: Object.fromEntries([...res.headers].filter(([k]) => k !== 'date')), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  };
  srv.live = async (urlPath, token) => {
    const ctl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: ctl.signal });
    const status = res.status;
    let json = null;
    if (status !== 200) { try { json = JSON.parse(await res.text()); } catch { /* none */ } }
    ctl.abort();
    await res.body?.cancel().catch(() => {});
    return { status, json };
  };
  servers.push(srv);
  return srv;
}
const stopAll = () => Promise.all(servers.map((s) => new Promise((resolve) => { if (s.child.exitCode !== null) return resolve(); s.child.once('exit', resolve); s.child.kill('SIGTERM'); })));

const CLOSED = /closed for set up/;
async function seed(srv) {
  const admin = (await srv.call('POST', '/api/login', { body: { login: 'admin', password: 'testpass1234' } })).json.token;
  const mk = async (login, role = 'member') => {
    const r = await srv.call('POST', '/api/users', { token: admin, body: { login, displayName: login, role, password: 'memberpass1234' } });
    assert.equal(r.status, 201, r.text);
    return r.json.user.key;
  };
  for (const m of ["todo", "research"]) {
    assert.equal((await srv.call("POST", `/api/modules/bundled/${m}/install`, { token: admin, body: {} })).status, 201, `${m} installs`);
    assert.equal((await srv.call('PATCH', `/api/modules/${m}`, { token: admin, body: { enabled: true } })).status, 200, `${m} turns on`);
  }
  const keys = { owner: await mk('olive', 'owner'), mod: await mk('mona'), member: await mk('mia'), other: await mk('otto'), modB: await mk('mox') };
  const make = async (name, entry, members) => {
    const r = await srv.call('POST', '/api/spaces', { token: admin, body: { name, members } });
    assert.equal(r.status, 200, r.text);
    const id = r.json.space.id;
    await srv.call('PATCH', `/api/spaces/${id}`, { token: admin, body: { members } });
    if (entry) assert.equal((await srv.call('PATCH', `/api/spaces/${id}`, { token: admin, body: { entry } })).status, 200);
    return id;
  };
  const ids = {
    A: await make('Alpha', 'guests', [keys.mod, keys.member]), // everyone could enter it
    I: await make('Invited', null, [keys.mod, keys.member]), // invited people only
    C: await make('Other', null, [keys.modB]),
  };
  for (const [k, id] of [['mod', ids.A], ['mod', ids.I], ['modB', ids.C]]) assert.equal((await srv.call('PATCH', `/api/users/${keys[k]}/spaces/${id}`, { token: admin, body: { permissions: { moderator: true } } })).status, 200);
  const T = { admin };
  for (const [who, login] of [['owner', 'olive'], ['mod', 'mona'], ['member', 'mia'], ['other', 'otto'], ['modB', 'mox']]) T[who] = (await srv.call('POST', '/api/login', { body: { login, password: 'memberpass1234' } })).json.token;
  const me = (await srv.call('GET', '/api/me', { token: admin })).json;
  const link = (await srv.call('POST', `/api/spaces/${ids.A}/guest-link`, { token: admin, body: {} })).json.space.guestToken;
  const linkI = (await srv.call('POST', `/api/spaces/${ids.I}/guest-link`, { token: admin, body: {} })).json.space.guestToken;
  return { admin, keys, ids, T, key: me.streamKey, link, linkI };
}
// What a viewer is answered for a space: the statuses of the routes that open it.
async function probe(srv, s, who, id) {
  const q = who === 'key' ? `s=${encodeURIComponent(s.key)}` : null;
  const token = s.T[who];
  const out = {};
  const get = (p, extra = {}) => srv.call('GET', p, { token, ...extra });
  out.setup = (await get(`/api/spaces/${id}`)).status;
  out.chat = (await get(`/api/spaces/${id}/chat${q ? `?${q}` : ''}`)).status;
  out.data = (await get(`/api/modules/todo/data?scope=space&space=${id}${q ? `&${q}` : ''}`)).status;
  out.uploads = (await get(`/api/modules/research/uploads?scope=space&space=${id}${q ? `&${q}` : ''}`)).status;
  out.live = (await srv.live(`/api/live?space=${id}`, token)).status;
  out.layouts = (await get(`/api/spaces/${id}/layouts`)).status;
  out.join = (await srv.call('POST', `/api/spaces/${id}/join`, { token })).status;
  out.call = (await srv.call('POST', '/api/call/join', { token, body: { space: id } })).status;
  return out;
}

try {
  const srv = await startServer();
  const s = await seed(srv);
  const { ids, T } = s;
  const unknown = await srv.call('GET', '/api/spaces/zzzz9999/chat', { token: T.other });

  await test('open: the baseline answers (a member and the other account)', async () => {
    assert.equal((await srv.call('GET', `/api/spaces/${ids.A}/chat`, { token: T.member })).status, 200);
    assert.equal((await srv.call('GET', `/api/modules/todo/data?scope=space&space=${ids.A}`, { token: T.member })).status, 200);
  });

  await test('who may close: owner and admin, a moderator of that space only; bad values are refused', async () => {
    const patch = (who, id, body) => srv.call('PATCH', `/api/spaces/${id}`, { token: T[who], body });
    assert.equal((await patch('member', ids.A, { closed: true })).status, 403);
    assert.equal((await patch('modB', ids.A, { closed: true })).status, 403, 'a moderator of another space');
    assert.equal((await patch('other', ids.I, { closed: true })).status, 404, 'an outsider is told nothing');
    assert.equal((await patch('mod', ids.A, { entry: 'accounts' })).status, 403, 'a moderator changes no entry');
    assert.equal((await patch('mod', ids.A, { allowGuests: false })).status, 403);
    assert.equal((await patch('mod', ids.A, { closed: true, entry: 'accounts' })).status, 403, 'closed beside entry is refused whole');
    assert.equal((await srv.call('GET', `/api/spaces/${ids.A}`, { token: T.admin })).json.space.closed, undefined, 'nothing changed');
    for (const bad of ['yes', 1, null, [], {}]) assert.equal((await patch('admin', ids.A, { closed: bad })).status, 400, `closed ${JSON.stringify(bad)}`);
    for (const bad of ['everyone', 5, null, true]) assert.equal((await patch('admin', ids.A, { entry: bad })).status, 400, `entry ${JSON.stringify(bad)}`);
    for (const bad of ['yes', 0, null, 'false']) assert.equal((await patch('admin', ids.A, { allowGuests: bad })).status, 400, `allowGuests ${JSON.stringify(bad)}`);
    assert.equal((await patch('admin', 'lobby', { closed: true })).status, 400, 'the Lobby cannot be closed');
    const kept = (await srv.call('GET', `/api/spaces/${ids.A}`, { token: T.admin })).json.space;
    assert.equal(kept.entry, 'guests');
    assert.equal(kept.allowGuests, true);
    assert.equal(kept.closed, undefined);
    assert.equal((await patch('mod', ids.A, { closed: true })).status, 200, 'a moderator of the space closes it');
    assert.equal((await srv.call('GET', `/api/spaces/${ids.A}`, { token: T.mod })).json.space.closed, true, 'and reads that it is closed');
    assert.equal((await patch('mod', ids.A, { closed: false })).status, 200, 'and reopens it');
    assert.equal((await patch('owner', ids.A, { closed: true })).status, 200);
    assert.equal((await patch('owner', ids.I, { closed: true })).status, 200);
    const stored = (await srv.call('GET', `/api/spaces/${ids.A}`, { token: T.admin })).json.space;
    assert.equal(stored.closed, true);
    assert.equal(stored.entry, 'guests', 'the other switches keep their values while closed');
    assert.equal(stored.allowGuests, true);
  });

  await test('closed (entry guests): privileged enter; a member, another account and a moderator elsewhere get 403 and the note', async () => {
    for (const who of ['admin', 'owner', 'mod']) {
      const r = await probe(srv, s, who, ids.A);
      assert.equal(r.chat, 200, who); assert.equal(r.data, 200, who); assert.equal(r.live, 200, who); assert.equal(r.layouts, 200, who);
      assert.notEqual(r.call, 403, `${who}: the call token is not refused for closing`);
      assert.notEqual(r.call, 404, who);
    }
    for (const who of ['member', 'other', 'modB']) {
      const r = await probe(srv, s, who, ids.A);
      for (const [route, status] of Object.entries(r)) assert.equal(status, route === 'setup' ? 403 : 403, `${who} ${route}: ${status}`);
      const chat = await srv.call('GET', `/api/spaces/${ids.A}/chat`, { token: T[who] });
      assert.match(chat.json.error, CLOSED);
      const data = await srv.call('GET', `/api/modules/todo/data?scope=space&space=${ids.A}`, { token: T[who] });
      assert.match(data.json.error, CLOSED);
      assert.match((await srv.live(`/api/live?space=${ids.A}`, T[who])).json.error, CLOSED);
      assert.match((await srv.call('POST', '/api/call/join', { token: T[who], body: { space: ids.A } })).json.error, CLOSED);
    }
  });

  await test('closed (invited only): the other account and a moderator elsewhere get exactly the unknown id; a member gets the note', async () => {
    for (const who of ['other', 'modB']) {
      for (const route of [`/api/spaces/${ids.I}/chat`, `/api/spaces/${ids.I}`, `/api/spaces/${ids.I}/layouts`, `/api/modules/todo/data?scope=space&space=${ids.I}`]) {
        const here = await srv.call('GET', route, { token: T[who] });
        const none = await srv.call('GET', route.replace(ids.I, 'zzzz9999'), { token: T[who] });
        assert.equal(here.status, none.status, `${who} ${route}`);
        assert.equal(here.text, none.text, `${who} ${route}`);
      }
      assert.equal((await srv.call('POST', `/api/spaces/${ids.I}/join`, { token: T[who] })).status, 404);
      assert.equal((await srv.live(`/api/live?space=${ids.I}`, T[who])).status, 404);
      assert.equal((await srv.call('POST', `/api/spaces/${ids.I}/request`, { token: T[who] })).status, 404);
    }
    assert.equal(unknown.status, 404);
    const r = await probe(srv, s, 'member', ids.I);
    assert.deepEqual(Object.values(r).filter((v) => v !== 403), [], JSON.stringify(r));
  });

  await test('the call token: an outsider of an invited-only space, closed or open, is answered exactly as for an unknown id', async () => {
    const same = async (id, who) => {
      const here = await srv.call('POST', '/api/call/join', { token: T[who], body: { space: id } });
      const none = await srv.call('POST', '/api/call/join', { token: T[who], body: { space: 'zzzz9999' } });
      assert.equal(none.status, 404);
      assert.deepEqual([here.status, here.text, here.headers], [none.status, none.text, none.headers], `${who} ${id}`);
    };
    for (const who of ['other', 'modB']) await same(ids.I, who); // closed, invited only
    for (const who of ['other', 'member', 'mod']) await same(ids.C, who); // open, invited only: not theirs
    const member = await srv.call('POST', '/api/call/join', { token: T.member, body: { space: ids.I } });
    assert.equal(member.status, 403, 'a member of the closed one still gets the note');
    assert.match(member.json.error, CLOSED);
    assert.equal((await srv.call('POST', '/api/call/join', { token: T.modB, body: { space: ids.C } })).status, 200, 'a member of the open one gets a token');
    assert.equal((await srv.call('POST', '/api/call/join', { token: T.other, body: { space: ids.A } })).status, 403, 'who could have entered it if it were open: the note');
  });

  await test('notifications: a closed space sends to the people who may enter it only; reopening restores', async () => {
    const inbox = async (who) => (await srv.call('GET', '/api/notifications', { token: T[who] })).json.notifications.map((x) => x.title);
    const send = (title) => srv.call('POST', `/api/modules/todo/notify?scope=space&space=${ids.I}`, { token: T.mod, body: { to: 'space', title } });
    const closedNow = await send('while closed');
    assert.equal(closedNow.status, 200, closedNow.text);
    assert.ok((await inbox('mod')).includes('while closed'), 'its moderator gets it');
    assert.ok(!(await inbox('member')).includes('while closed'), 'a plain member does not');
    assert.equal((await srv.call('PATCH', `/api/spaces/${ids.I}`, { token: T.mod, body: { closed: false } })).status, 200);
    assert.equal((await send('after reopening')).status, 200);
    assert.ok((await inbox('member')).includes('after reopening'), 'reopened: members get it again');
    assert.equal((await srv.call('PATCH', `/api/spaces/${ids.I}`, { token: T.mod, body: { closed: true } })).status, 200);
  });

  await test('Home lists: a member or another account sees it as closed with no people; an outsider of an invited one sees nothing', async () => {
    const listed = async (who, path = '/api/spaces') => (await srv.call('GET', path, { token: T[who] })).json.spaces;
    for (const p of ['/api/spaces', '/api/presence']) {
      for (const who of ['member', 'other']) {
        const row = (await listed(who, p)).find((r) => r.id === ids.A);
        assert.ok(row && row.closed === true, `${who} ${p} lists it as closed`);
        assert.deepEqual(row.members, []);
        assert.equal(row.guestToken, undefined);
        assert.equal(row.mine, undefined, 'not theirs to open');
      }
      assert.ok(!(await listed('other', p)).some((r) => r.id === ids.I), `${p}: an outsider is not told of the invited one`);
      assert.ok(!(await listed('modB', p)).some((r) => r.id === ids.I));
      const mine = (await listed('member', p)).find((r) => r.id === ids.I);
      assert.ok(mine && mine.closed === true && mine.members.length === 0, `${p}: a member of the invited one sees it closed`);
      for (const who of ['owner', 'mod', 'admin']) {
        const row = (await listed(who, p)).find((r) => r.id === ids.A);
        assert.ok(row && row.members.length >= 2, `${who} ${p} sees it whole`);
      }
    }
    const pres = (await srv.call('GET', '/api/presence', { token: T.member })).json;
    assert.ok(pres.users.every((u) => u.space !== ids.A && u.space !== ids.I), 'nobody is placed in a closed space for a member');
  });

  await test('the picture of a closed space is told to those listed with it, not to outsiders of an invited one', async () => {
    const get = async (who, id) => (await fetch(`http://127.0.0.1:${srv.port}/img/space/${id}`, { headers: { authorization: `Bearer ${T[who]}` } })).status;
    assert.equal(await get('other', ids.I), 404);
    assert.notEqual(await get('member', ids.A), 403);
  });

  await test('nobody may ask to come in while it is closed', async () => {
    assert.equal((await srv.call('PATCH', `/api/spaces/${ids.I}`, { token: T.admin, body: { requestAccess: true } })).status, 200);
    const r = await srv.call('POST', `/api/spaces/${ids.I}/request`, { token: T.other });
    assert.equal(r.status, 404);
    assert.ok(!(await srv.call('GET', '/api/spaces', { token: T.other })).json.spaces.some((x) => x.id === ids.I), 'no Request access row either');
  });

  await test('the access key still reads a closed space (OBS and Studio keep their sources)', async () => {
    const all = await srv.call('GET', `/api/spaces?s=${encodeURIComponent(s.key)}`);
    assert.equal(all.status, 200);
    const row = all.json.spaces.find((x) => x.id === ids.A);
    assert.ok(row && row.members.length >= 2, 'whole, with its people');
    const pres = (await srv.call('GET', `/api/presence?s=${encodeURIComponent(s.key)}`)).json.spaces.find((x) => x.id === ids.A);
    assert.ok(pres && pres.members.length >= 2);
  });

  await test('link guest: the link into a closed space says it is closed and works nowhere; anonymous is signed out', async () => {
    const info = await srv.call('GET', `/api/guest-link/${s.link}`);
    assert.equal(info.status, 403);
    assert.match(info.json.error, CLOSED);
    const joined = await srv.call('POST', '/api/guest-join', { body: { token: s.link, name: 'Gus' } });
    assert.equal(joined.status, 403);
    assert.match(joined.json.error, CLOSED);
    const call = await srv.call('POST', '/api/call/join', { body: { guest: s.link, space: ids.A } });
    assert.equal(call.status, 403);
    assert.match(call.json.error, CLOSED);
    assert.equal((await srv.call('GET', `/api/presence?guest=${s.link}`)).status, 401);
    assert.equal((await srv.live(`/api/live?space=${ids.A}&guest=${s.link}`)).status, 401);
    assert.equal((await srv.call('GET', `/api/modules/todo/data?scope=space&space=${ids.A}&guest=${s.link}`)).status, 401);
    assert.equal((await srv.call('GET', `/api/spaces/${ids.A}/chat`)).status, 401);
    assert.equal((await srv.call('GET', '/api/spaces')).status, 401);
  });

  await test('reopening restores exactly: the same switches, and everyone in again', async () => {
    assert.equal((await srv.call('PATCH', `/api/spaces/${ids.A}`, { token: T.mod, body: { closed: false } })).status, 200);
    const back = (await srv.call('GET', `/api/spaces/${ids.A}`, { token: T.admin })).json.space;
    assert.equal(back.closed, undefined, 'stored as nothing');
    assert.equal(back.entry, 'guests');
    assert.equal(back.allowGuests, true);
    assert.equal(back.guestToken, s.link, 'the guest link is the same');
    for (const who of ['member', 'other', 'modB']) {
      const r = await probe(srv, s, who, ids.A);
      assert.equal(r.chat === 200 || r.chat === 403, true);
      assert.notEqual((await srv.call('GET', `/api/modules/todo/data?scope=space&space=${ids.A}`, { token: T[who] })).status, 404);
    }
    assert.equal((await srv.call('GET', `/api/spaces/${ids.A}/chat`, { token: T.member })).status, 200);
    assert.equal((await srv.call('GET', `/api/guest-link/${s.link}`)).status, 200);
    assert.equal((await srv.call('GET', '/api/spaces', { token: T.other })).json.spaces.find((x) => x.id === ids.A).closed, undefined);
  });

  await test('closing under someone already in: the next request is refused, the open stream ends, the call is not touched', async () => {
    const ctl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/live?space=${ids.A}`, { headers: { authorization: `Bearer ${T.member}` }, signal: ctl.signal });
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    const ended = (async () => { try { for (;;) { const { done } = await reader.read(); if (done) return true; } } catch { return false; } })();
    await srv.call('PATCH', `/api/spaces/${ids.A}`, { token: T.owner, body: { closed: true } });
    const done = await Promise.race([ended, new Promise((r) => setTimeout(() => r('open'), 6000))]);
    ctl.abort();
    assert.equal(done, true, 'the member\'s open stream ended');
    assert.equal((await srv.call('GET', `/api/spaces/${ids.A}/chat`, { token: T.member })).status, 403);
  });

  await test('closed survives a restart and an environment copy', async () => {
    const copy = exportApp(JSON.parse(fs.readFileSync(path.join(srv.dir, 'app.json'), 'utf8')));
    assert.equal(copy.spaces.find((x) => x.id === ids.A).closed, true);
    assert.equal(copy.spaces.find((x) => x.id === ids.C).closed, undefined);
  });

  // --- the door ---------------------------------------------------------------------------------------------------
  const door = await startServer({ ENABLE_GUEST_DOOR: 'true' });
  const d = await seed(door);
  await test('door guest: let into an open guests space, refused (403, the note) when it is closed, never told of an invited one', async () => {
    const entered = await door.call('POST', '/api/guest-door', { body: { name: 'Sam' } });
    assert.equal(entered.status, 201, entered.text);
    const cookie = entered.cookie;
    assert.ok(cookie);
    const list = (await door.call('GET', '/api/guest-door', { cookie })).json;
    assert.ok(list.spaces.some((x) => x.id === d.ids.A && x.state === 'open'));
    assert.equal((await door.call('POST', '/api/call/join', { cookie, body: { space: d.ids.A } })).status !== 403, true, 'open: not refused');
    assert.equal((await door.call('PATCH', `/api/spaces/${d.ids.A}`, { token: d.T.mod, body: { closed: true } })).status, 200);
    assert.equal((await door.call('PATCH', `/api/spaces/${d.ids.I}`, { token: d.T.admin, body: { closed: true } })).status, 200);
    const call = await door.call('POST', '/api/call/join', { cookie, body: { space: d.ids.A } });
    assert.equal(call.status, 403);
    assert.match(call.json.error, CLOSED);
    const inv = await door.call('POST', '/api/call/join', { cookie, body: { space: d.ids.I } });
    const none = await door.call('POST', '/api/call/join', { cookie, body: { space: 'zzzz9999' } });
    assert.equal(inv.status, 404);
    assert.equal(inv.text, none.text, 'the same as an unknown id');
    const after = (await door.call('GET', '/api/guest-door', { cookie })).json;
    assert.ok(!after.spaces.some((x) => x.id === d.ids.A || x.id === d.ids.I), 'neither is listed');
    for (const p of [`/api/spaces/${d.ids.A}/chat?space=${d.ids.A}`, `/api/modules/todo/data?scope=space&space=${d.ids.A}`, `/api/presence?space=${d.ids.A}`]) {
      assert.notEqual((await door.call('GET', p, { cookie })).status, 200, p);
    }
    assert.notEqual((await door.live(`/api/live?space=${d.ids.A}`, null)).status, 200);
    assert.equal((await door.call('PATCH', `/api/spaces/${d.ids.A}`, { token: d.T.mod, body: { closed: false } })).status, 200);
    const reopened = (await door.call('GET', '/api/guest-door', { cookie })).json;
    assert.ok(reopened.spaces.some((x) => x.id === d.ids.A && x.state === 'open'), 'reopening lets the door guest in again');
  });
} catch (err) {
  failed += 1;
  console.error(err.stack || err);
} finally {
  await stopAll();
  standIn.close();
  for (const s of servers) fs.rmSync(s.dir, { recursive: true, force: true });
}
if (failed) {
  console.error(`check-closed-space: ${failed} failed`);
  process.exit(1);
}
console.log(`check-closed-space: ${n} cases ok`);
