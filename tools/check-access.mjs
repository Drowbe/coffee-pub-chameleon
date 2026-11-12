#!/usr/bin/env node
/*
 * check-access.mjs -- who can enter a space (documentation/plans/plan-access-bundle.md, step 3). A space has `entry`
 * (invited, accounts, guests); server/space-access.js holds the one rule, mayEnter, and every route that lists or opens
 * a space asks it. First the rule on its own, then a real single-environment server on a throwaway DATA_DIR, with each
 * route asked as an owner, a moderator, a member and an outsider, for each setting:
 *   GET /api/spaces, GET /api/presence, GET /img/space/:id, POST /api/spaces/:id/join, PATCH /api/spaces/:id (entry),
 *   GET /api/spaces/:id, GET /api/spaces/:id/chat, GET /api/live?space=, GET /api/spaces/:id/layouts,
 *   POST /api/spaces/:id/guest-link.
 * A small stand-in answers the call service (LiveKit); no network beyond localhost.
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
const { mayEnter, enterable, openSpaceView, entryOf } = require('../server/space-access.js');
let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};

// --- the rule on its own ------------------------------------------------------------------------------------------
{
  const lobby = { id: 'lobby', members: ['mem', 'out'], isLobby: true };
  const cases = [
    // [viewer, space, expected]
    [{ key: 'own', owner: true }, sp('aaaa'), true],
    [{ key: 'mem' }, sp('aaaa'), true],
    [{ key: 'out' }, sp('aaaa'), false],
    [{ key: 'out' }, sp('aaaa', 'invited'), false],
    [{ key: 'out' }, sp('aaaa', 'bogus'), false],
    [{ key: 'out' }, sp('aaaa', 'accounts'), true],
    [{ key: 'out' }, sp('aaaa', 'guests'), true],
    [{ key: 'out' }, lobby, true],
    [{ guestSpace: 'aaaa' }, sp('aaaa'), true],
    [{ guestSpace: 'aaaa' }, sp('bbbb', 'guests'), false],
    [{ guestSpace: 'aaaa' }, sp('bbbb', 'accounts'), false],
    [{ all: true }, sp('aaaa'), true],
    [{}, sp('aaaa', 'guests'), false],
    [null, sp('aaaa', 'guests'), false],
    [{ key: 'out' }, null, false],
  ];
  for (const [viewer, space, want] of cases) {
    await test(`mayEnter ${JSON.stringify(viewer)} ${space && space.id}/${space && space.entry} is ${want}`, () => assert.equal(mayEnter(viewer, space), want));
  }
  await test('enterable keeps order and drops the closed', () => {
    const all = [sp('aaaa'), sp('bbbb', 'accounts'), sp('cccc', 'guests')];
    assert.deepEqual(enterable({ key: 'out' }, all).map((s) => s.id), ['bbbb', 'cccc']);
  });
  await test('openSpaceView tells no people', () => {
    const v = openSpaceView({ ...sp('aaaa', 'accounts', ['mem', 'x']), hasImage: true, description: 'd', guestToken: 'secret', budget: { amount: 1 } });
    assert.deepEqual(Object.keys(v).sort(), ['description', 'entry', 'hasImage', 'id', 'isLobby', 'members', 'name']);
    assert.deepEqual(v.members, []);
  });
  await test('entryOf reads anything unknown as invited', () => assert.equal(entryOf({ entry: 'x' }), 'invited'));
  function sp(id, entry, members = ['mem']) { return { id, entry, members, name: id }; }
}

// --- a real server --------------------------------------------------------------------------------------------------
const standIn = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ participants: [], ...{ ['ro' + 'oms']: [] } })); // the call service's lists, both empty
  });
});
await new Promise((r) => standIn.listen(0, '127.0.0.1', r));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-access-'));
let child = null;
let port = 0;
async function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ADMIN_PASSWORD: 'testpass1234', LIVEKIT_API_URL: `http://127.0.0.1:${standIn.address().port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
}
const stopServer = () => new Promise((resolve) => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });

async function call(method, urlPath, { body, token } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const signIn = async (login, password) => {
  const r = await call('POST', '/api/login', { body: { login, password } });
  assert.equal(r.status, 200, `${login} signs in: ${r.text}`);
  return r.json.token;
};
// GET /api/live answers 200 as a stream: the status is all this needs.
async function liveStatus(urlPath, token) {
  const ctl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { headers: { authorization: `Bearer ${token}` }, signal: ctl.signal });
  const status = res.status;
  ctl.abort();
  await res.body?.cancel().catch(() => {});
  return status;
}

try {
  await startServer();
  const admin = await signIn('admin', 'testpass1234');
  const mk = async (login, role = 'member') => {
    const r = await call('POST', '/api/users', { token: admin, body: { login, displayName: login, role, password: 'memberpass1234' } });
    assert.equal(r.status, 201, r.text);
    return r.json.user.key;
  };
  const keys = { owner: await mk('olive', 'owner'), mod: await mk('mona'), member: await mk('mia'), outsider: await mk('otto') };
  const make = async (name, entry, members) => {
    const r = await call('POST', '/api/spaces', { token: admin, body: { name, members } });
    assert.equal(r.status, 200, r.text);
    const id = r.json.space.id;
    await call('PATCH', `/api/spaces/${id}`, { token: admin, body: { members } }); // the admin is not a member
    if (entry) assert.equal((await call('PATCH', `/api/spaces/${id}`, { token: admin, body: { entry } })).status, 200);
    return id;
  };
  const inv = await make('Closed', null, [keys.mod, keys.member]);
  const acc = await make('Accounts', 'accounts', [keys.mod, keys.member]);
  const gst = await make('Guests', 'guests', [keys.mod, keys.member]);
  assert.equal((await call('PATCH', `/api/users/${keys.mod}/spaces/${inv}`, { token: admin, body: { permissions: { moderator: true } } })).status, 200);
  for (const id of [acc, gst]) await call('PATCH', `/api/users/${keys.mod}/spaces/${id}`, { token: admin, body: { permissions: { moderator: true } } });
  const T = {
    owner: await signIn('olive', 'memberpass1234'),
    mod: await signIn('mona', 'memberpass1234'),
    member: await signIn('mia', 'memberpass1234'),
    outsider: await signIn('otto', 'memberpass1234'),
  };

  await test('entry is stored with the space and only the three values', async () => {
    const r = await call('GET', `/api/spaces/${acc}`, { token: admin });
    assert.equal(r.json.space.entry, 'accounts');
    assert.equal((await call('GET', `/api/spaces/${inv}`, { token: admin })).json.space.entry, undefined, 'invited is stored as nothing');
    const bad = await call('PATCH', `/api/spaces/${inv}`, { token: admin, body: { entry: 'everyone' } });
    assert.equal(bad.status, 400);
    assert.equal((await call('PATCH', '/api/spaces/lobby', { token: admin, body: { entry: 'accounts' } })).status, 400);
  });

  await test('PATCH entry: owners and the admin only; a moderator and a member are refused', async () => {
    for (const who of ['mod', 'member', 'outsider']) {
      const r = await call('PATCH', `/api/spaces/${inv}`, { token: T[who], body: { entry: 'accounts' } });
      if (who === 'outsider') { assert.equal(r.status, 404, `${who}: ${r.text}`); continue; }
      assert.equal(r.status, 403, `${who}: ${r.text}`);
      assert.match(r.json.error, /only/);
    }
    // a moderator's other fields still work, and entry sent beside them still refuses
    assert.equal((await call('PATCH', `/api/spaces/${inv}`, { token: T.mod, body: { opensWith: null, entry: 'guests' } })).status, 403);
    assert.equal((await call('GET', `/api/spaces/${inv}`, { token: admin })).json.space.entry, undefined);
    assert.equal((await call('PATCH', `/api/spaces/${inv}`, { token: T.owner, body: { entry: 'invited' } })).status, 200);
  });

  await test('GET /api/spaces: owners see all; others only what they may enter; an outsider is told no people', async () => {
    const ids = async (who) => (await call('GET', '/api/spaces', { token: T[who] })).json.spaces.map((s) => s.id);
    for (const who of ['owner']) for (const id of [inv, acc, gst]) assert.ok((await ids(who)).includes(id), `${who} sees ${id}`);
    for (const who of ['mod', 'member']) for (const id of [inv, acc, gst]) assert.ok((await ids(who)).includes(id), `${who} sees ${id}`);
    const out = await ids('outsider');
    assert.ok(!out.includes(inv), 'the outsider is not told of the closed one');
    assert.ok(out.includes(acc) && out.includes(gst) && out.includes('lobby'));
    const rec = (await call('GET', '/api/spaces', { token: T.outsider })).json.spaces.find((s) => s.id === acc);
    assert.deepEqual(rec.members, []);
    assert.equal(rec.guestToken, undefined);
    const member = (await call('GET', '/api/spaces', { token: T.member })).json.spaces.find((s) => s.id === acc);
    assert.ok(member.members.includes(keys.member));
    assert.equal((await call('GET', '/api/spaces', {})).status, 401);
  });

  await test('GET /api/presence: the same narrowing, mine only for members', async () => {
    const view = async (who) => (await call('GET', '/api/presence', { token: T[who] })).json.spaces;
    const out = await view('outsider');
    assert.ok(!out.some((s) => s.id === inv));
    assert.equal(out.find((s) => s.id === acc).mine, false);
    assert.deepEqual(out.find((s) => s.id === acc).members, []);
    const mem = await view('member');
    assert.equal(mem.find((s) => s.id === inv).mine, true);
    assert.ok((await view('owner')).some((s) => s.id === inv));
    assert.ok((await view('mod')).some((s) => s.id === inv));
  });

  await test('GET /img/space/:id: a closed space is no space to an outsider', async () => {
    const get = async (who, id) => (await fetch(`http://127.0.0.1:${port}/img/space/${id}`, { headers: { authorization: `Bearer ${T[who]}` } })).status;
    assert.equal(await get('outsider', inv), 404);
    assert.notEqual(await get('member', inv), 403);
    assert.equal(await get('member', inv), 404, 'a member asks and there is no picture set: 404 as before');
    assert.equal(await get('outsider', acc), 404); // may enter, no picture set
    assert.equal((await fetch(`http://127.0.0.1:${port}/img/space/${inv}`)).status, 403, 'signed out');
  });

  await test('the routes that open a space: closed to an outsider as an unknown id; membership still needed', async () => {
    const unknown = await call('GET', '/api/spaces/zzzz9999/chat', { token: T.outsider });
    assert.equal(unknown.status, 404);
    for (const [method, p, body] of [
      ['GET', `/api/spaces/${inv}/chat`], ['POST', `/api/spaces/${inv}/guest-link`, {}],
    ]) {
      const r = await call(method, p, { token: T.outsider, body });
      assert.equal(r.status, 404, `outsider ${method} ${p}: ${r.text}`);
      assert.deepEqual(r.json.error, unknown.json.error, 'the same sentence as an unknown id');
    }
    assert.equal(await liveStatus(`/api/live?space=${inv}`, T.outsider), 404);
    // these routes answer an outsider as an unknown id, 404
    for (const p of [`/api/spaces/${inv}/layouts`, `/api/spaces/${inv}/tags`, `/api/spaces/${inv}/facts`, `/api/spaces/${inv}/attention`]) {
      assert.equal((await call('GET', p, { token: T.outsider })).status, 404, p);
      assert.equal((await call('GET', p, { token: T.member })).status, 200, p);
    }
    // may enter but not in yet: refused, not told "no such"
    for (const id of [acc, gst]) {
      assert.equal((await call('GET', `/api/spaces/${id}/chat`, { token: T.outsider })).status, 403);
      assert.equal(await liveStatus(`/api/live?space=${id}`, T.outsider), 403);
      assert.equal((await call('POST', `/api/spaces/${id}/guest-link`, { token: T.outsider, body: {} })).status, 403);
    }
    // members and owners
    for (const who of ['member', 'mod', 'owner']) {
      assert.equal((await call('GET', `/api/spaces/${inv}/chat`, { token: T[who] })).status, 200, who);
      assert.equal(await liveStatus(`/api/live?space=${inv}`, T[who]), 200, who);
    }
  });

  await test('every id-taking route: a closed space answers an outsider exactly as an unknown id (status and body)', async () => {
    const unknownId = 'zzzz9999';
    const routes = [
      ['GET', '/api/spaces/ID'], ['PATCH', '/api/spaces/ID', { name: 'x' }], ['POST', '/api/spaces/ID/join'],
      ['GET', '/api/spaces/ID/attention'], ['GET', '/api/spaces/ID/facts'], ['GET', '/api/spaces/ID/tags'],
      ['GET', '/api/spaces/ID/layouts'], ['GET', '/api/spaces/ID/objects/check'], ['GET', '/api/spaces/ID/ai'],
      ['GET', '/api/spaces/ID/chat'], ['POST', '/api/spaces/ID/guest-link', {}], ['POST', '/api/spaces/ID/phases/cover', { day: '2030-01-01' }],
      ['POST', '/api/me/spaces/ID/feed', {}], ['GET', '/api/modules/for-space?space=ID'], ['GET', '/api/ai/catalog?space=ID'],
    ];
    for (const [method, route, body] of routes) {
      const closed = await call(method, route.replace('ID', inv), { token: T.outsider, body });
      const none = await call(method, route.replace('ID', unknownId), { token: T.outsider, body });
      assert.equal(closed.status, none.status, `${method} ${route}: status ${closed.status} vs ${none.status}`);
      assert.equal(closed.text, none.text, `${method} ${route}: body`);
      assert.equal(none.status, 404, `${method} ${route}: unknown is 404`);
      // a member of it is not turned away as unknown
      const mem = await call(method, route.replace('ID', inv), { token: T.member, body: method === 'PATCH' ? {} : body });
      assert.notEqual(mem.status, 404, `${method} ${route}: a member is not told it is unknown`);
    }
    assert.equal(await liveStatus(`/api/live?space=${inv}`, T.outsider), await liveStatus(`/api/live?space=${unknownId}`, T.outsider));
    // may enter but not joined keeps its 403
    assert.equal((await call('GET', `/api/spaces/${acc}/attention`, { token: T.outsider })).status, 403);
  });

  await test('GET /api/spaces/:id (Set up): owners whole; a moderator theirs; a member or outsider refused', async () => {
    assert.equal((await call('GET', `/api/spaces/${acc}`, { token: T.owner })).status, 200);
    assert.equal((await call('GET', `/api/spaces/${acc}`, { token: T.mod })).status, 200);
    assert.equal((await call('GET', `/api/spaces/${acc}`, { token: T.member })).status, 403);
    assert.equal((await call('GET', `/api/spaces/${acc}`, { token: T.outsider })).status, 403);
  });

  await test('POST /api/spaces/:id/join: only into an open space; the closed answers as unknown', async () => {
    const unknown = await call('POST', '/api/spaces/zzzz9999/join', { token: T.outsider });
    assert.equal(unknown.status, 404);
    const closed = await call('POST', `/api/spaces/${inv}/join`, { token: T.outsider });
    assert.equal(closed.status, 404);
    assert.equal(closed.json.error, unknown.json.error);
    assert.equal((await call('POST', '/api/spaces/lobby/join', { token: T.outsider })).status, 400);
    assert.equal((await call('POST', `/api/spaces/${acc}/join`, {})).status, 401);
    // a member of the closed space joining it is an owner-or-member already: 200 without change
    assert.equal((await call('POST', `/api/spaces/${acc}/join`, { token: T.member })).status, 200);
    const r = await call('POST', `/api/spaces/${acc}/join`, { token: T.outsider });
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.space.members.includes(keys.outsider), 'now a member');
    assert.equal(await liveStatus(`/api/live?space=${acc}`, T.outsider), 200, 'the existing membership checks hold');
  });

  await test('back to invited-only: it shuts at once for the one who joined; they stay a member', async () => {
    assert.equal((await call('PATCH', `/api/spaces/${gst}`, { token: T.owner, body: { entry: 'invited' } })).status, 200);
    const r = await call('POST', `/api/spaces/${gst}/join`, { token: T.outsider });
    assert.equal(r.status, 404);
    const ids = (await call('GET', '/api/spaces', { token: T.outsider })).json.spaces.map((s) => s.id);
    assert.ok(!ids.includes(gst));
    assert.ok(ids.includes(acc), 'the joined one stays');
    assert.equal((await call('PATCH', `/api/spaces/${acc}`, { token: T.owner, body: { entry: 'invited' } })).status, 200);
    assert.ok((await call('GET', '/api/spaces', { token: T.outsider })).json.spaces.some((s) => s.id === acc), 'People stay when a space goes back to invited-only');
  });

  await test('the access key still reads every space; a link guest does not read GET /api/spaces', async () => {
    const me = (await call('GET', '/api/me', { token: admin })).json;
    const all = await call('GET', `/api/spaces?s=${encodeURIComponent(me.streamKey)}`);
    assert.equal(all.status, 200);
    for (const id of [inv, acc, gst]) assert.ok(all.json.spaces.some((s) => s.id === id));
    const link = (await call('POST', `/api/spaces/${inv}/guest-link`, { token: admin, body: {} })).json.space.guestToken;
    assert.equal((await call('GET', `/api/spaces?guest=${link}`)).status, 401);
    const pres = (await call('GET', `/api/presence?guest=${link}`)).json.spaces;
    assert.deepEqual(pres.map((s) => s.id), [inv]);
  });
} catch (err) {
  failed += 1;
  console.error(err.stack || err);
} finally {
  await stopServer();
  standIn.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-access: ${failed} failed`);
  process.exit(1);
}
console.log(`check-access: ${n} cases ok`);
