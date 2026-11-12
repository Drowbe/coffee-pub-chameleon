#!/usr/bin/env node
/*
 * check-request-access.mjs -- request access (documentation/plans/plan-access-bundle.md, step 6; server/access-requests.js,
 * the routes after "request access" in server/index.js). Two parts:
 *   1. the pieces on their own: the rules for who may request, what a stranger is told of a space (four fields and their own
 *      request's state), the request store (one pending, daily limit, pending cap, expiry, answers, idempotence, grants
 *      that never outlive a guest's session, a file that cannot be read, a bounded file);
 *   2. real servers on throwaway data folders, asked as every kind of actor (admin, owner, moderator, member, outsider, door
 *      guest, link guest, signed out): the setting (owners only, 400 on bad values, never the Lobby); a closed space without
 *      the switch is told exactly as an unknown id; a request-access space shows only its id, name, picture flag and
 *      description; asking, withdrawing, the owners' list, answering, two answers at once, the limits, the notices (a
 *      hostile name stays text), a guest's approval and its end, switching it off, deleting the space.
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
const door = require('../server/guest-door.js');
const spaceAccess = require('../server/space-access.js');
const { AccessRequests, AccessRequestError, readLimits } = require('../server/access-requests.js');
let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-request-access-'));

// --- 1. the pieces ------------------------------------------------------------------------------------------------
{
  const { mayEnter, mayRequest, requestView } = spaceAccess;
  const sp = (extra = {}) => ({ id: 'sp1', name: 'Secret', description: 'About it', hasImage: true, members: ['mem'], phases: [{ x: 1 }], requestAccess: true, ...extra });
  await test('mayRequest: accounts and door guests, never the key, a link guest, the Lobby or a space with the switch off', () => {
    assert.equal(mayRequest({ key: 'out' }, sp()), true);
    assert.equal(mayRequest({ key: 'out' }, sp({ requestAccess: undefined })), false);
    assert.equal(mayRequest({ key: 'out' }, sp({ requestAccess: 'true' })), false, 'only true');
    assert.equal(mayRequest({ key: 'mem' }, sp()), false, 'a member can enter');
    assert.equal(mayRequest({ key: 'out' }, sp({ entry: 'accounts' })), false, 'can enter already');
    assert.equal(mayRequest({ key: 'out', owner: true }, sp()), false);
    assert.equal(mayRequest({ all: true }, sp()), false);
    assert.equal(mayRequest({ guestSpace: 'sp9' }, sp()), false);
    assert.equal(mayRequest({ key: 'out' }, sp({ id: 'lobby' })), false);
    assert.equal(mayRequest({ key: 'out' }, sp({ isLobby: true })), false);
    assert.equal(mayRequest({ doorGuest: true, doorOn: true }, sp()), true);
    assert.equal(mayRequest({ doorGuest: true, doorOn: false }, sp()), false);
    assert.equal(mayRequest({ doorGuest: true }, sp()), false);
    assert.equal(mayRequest({ doorGuest: true, doorOn: true, granted: ['sp1'] }, sp()), false, 'a grant is entry');
    assert.equal(mayRequest(null, sp()), false);
    assert.equal(mayRequest({ key: 'out' }, null), false);
  });
  await test('a grant lets a door guest in while the door is on, never the Lobby, never another space', () => {
    assert.equal(mayEnter({ doorGuest: true, doorOn: true, granted: ['sp1'] }, sp({ requestAccess: undefined })), true);
    assert.equal(mayEnter({ doorGuest: true, doorOn: false, granted: ['sp1'] }, sp()), false);
    assert.equal(mayEnter({ doorGuest: true, doorOn: true, granted: ['sp2'] }, sp()), false);
    assert.equal(mayEnter({ doorGuest: true, doorOn: true, granted: ['lobby'] }, { id: 'lobby', members: [] }), false);
    assert.equal(mayEnter({ doorGuest: true, doorOn: true, granted: 'sp1' }, sp()), false, 'a list only');
  });
  await test('requestView tells four fields and the asker\'s own state, and nothing else', () => {
    const v = requestView(sp());
    assert.deepEqual(Object.keys(v).sort(), ['description', 'hasImage', 'id', 'name', 'request']);
    assert.deepEqual(v, { id: 'sp1', name: 'Secret', description: 'About it', hasImage: true, request: 'request' });
    assert.equal(requestView(sp(), true).request, 'pending');
    assert.equal(JSON.stringify(v).includes('mem'), false);
    assert.equal(requestView(sp({ description: undefined })).description, '');
  });

  const who = (k) => ({ key: k });
  const guest = (g, until) => ({ guest: g, name: 'Gus', until });
  const mk = (name, over = {}, limits = {}) => new AccessRequests(path.join(tmp, name), { log() {}, limits: { ...readLimits({}), ...limits }, ...over });
  const DAY = 24 * 3600000;
  await test('limits read from the environment with the decided defaults', () => {
    assert.deepEqual(readLimits({}), { perDay: 5, perAddress: 20, pendingPerSpace: 50, days: 7 });
    assert.deepEqual(readLimits({ ACCESS_REQUESTS_PER_DAY: '2', ACCESS_REQUEST_DAYS: '3' }), { perDay: 2, perAddress: 20, pendingPerSpace: 50, days: 3 });
    assert.equal(readLimits({ ACCESS_REQUESTS_PER_DAY: '0', ACCESS_REQUEST_DAYS: 'x' }).perDay, 5);
  });
  await test('one pending request per person per space; another space is fine; 409 with a sentence', () => {
    const a = mk('one');
    a.create('s1', who('k1'));
    assert.throws(() => a.create('s1', who('k1')), (e) => e instanceof AccessRequestError && e.status === 409 && /asked already/.test(e.message));
    a.create('s2', who('k1'));
    a.create('s1', who('k2'));
    assert.equal(a.pendingFor('s1').length, 2);
  });
  await test('the daily limit counts every state, then lifts after a day', () => {
    const a = mk('day', {}, { perDay: 3 });
    const t0 = 1_000_000_000_000;
    for (let i = 0; i < 3; i += 1) { a.create('s1', who('k1'), t0 + i); a.withdraw('s1', who('k1'), t0 + i); }
    assert.throws(() => a.create('s1', who('k1'), t0 + 10), (e) => e.status === 429 && /today/.test(e.message));
    a.create('s1', who('k2'), t0 + 10);
    a.create('s1', who('k1'), t0 + DAY + 5);
  });
  await test('the pending cap per space bounds what an owner is shown', () => {
    const a = mk('cap', {}, { pendingPerSpace: 2 });
    a.create('s1', who('k1')); a.create('s1', who('k2'));
    assert.throws(() => a.create('s1', who('k3')), (e) => e.status === 429);
    a.create('s2', who('k3'));
  });
  await test('a request ends after its days; a guest\'s after their session', () => {
    const a = mk('expiry', {}, { days: 7 });
    const t0 = 1_000_000_000_000;
    const r = a.create('s1', who('k1'), t0);
    assert.equal(a.pendingFor('s1', t0 + 7 * DAY - 1).length, 1);
    assert.equal(a.pendingFor('s1', t0 + 7 * DAY).length, 0);
    assert.throws(() => a.decide('s1', r.id, 'approve', 'o', t0 + 7 * DAY), (e) => e.status === 409 && /run out/.test(e.message));
    assert.equal(a.find('s1', r.id).state, 'expired');
    a.create('s1', who('k1'), t0 + 8 * DAY); // an ended request is no longer pending
    const g = a.create('s2', guest('guest-aaaa1111', t0 + 3600000), t0);
    assert.equal(a.pendingFor('s2', t0 + 3600000 - 1).length, 1);
    assert.equal(a.pendingFor('s2', t0 + 3600000).length, 0, 'the guest has left');
    assert.throws(() => a.decide('s2', g.id, 'approve', 'o', t0 + 3600000), (e) => e.status === 409);
    assert.deepEqual(a.grantedSpaces('guest-aaaa1111', t0 + 3600000), []);
  });
  await test('answers: idempotent, the other answer is 409, unknown is 404, a withdrawn one is over', () => {
    const a = mk('answers');
    const r = a.create('s1', who('k1'));
    assert.throws(() => a.decide('s2', r.id, 'approve', 'o'), (e) => e.status === 404, 'another space\'s id');
    assert.throws(() => a.decide('s1', 'f'.repeat(16), 'approve', 'o'), (e) => e.status === 404);
    assert.equal(a.decide('s1', r.id, 'approve', 'o').changed, true);
    assert.equal(a.decide('s1', r.id, 'approve', 'o').changed, false);
    assert.throws(() => a.decide('s1', r.id, 'deny', 'o'), (e) => e.status === 409 && /answered/.test(e.message));
    const w = a.create('s2', who('k1'));
    a.withdraw('s2', who('k1'));
    assert.throws(() => a.decide('s2', w.id, 'approve', 'o'), (e) => e.status === 409 && /over/.test(e.message));
    assert.equal(a.withdraw('s2', who('k1')), null);
  });
  await test('a guest\'s approval is a grant that ends with their session; deleting the space takes both', () => {
    const a = mk('grant');
    const t0 = Date.now();
    const r = a.create('s1', guest('guest-bbbb2222', t0 + 3600000));
    a.decide('s1', r.id, 'approve', 'o');
    assert.deepEqual(a.grantedSpaces('guest-bbbb2222'), ['s1']);
    assert.deepEqual(a.grantedSpaces('guest-bbbb2222', t0 + 3600001), []);
    assert.deepEqual(a.grantedSpaces('guest-cccc3333'), []);
    assert.equal(a.grants[0].until, t0 + 3600000);
    a.forgetSpace('s1');
    assert.deepEqual([a.requests.length, a.grants.length], [0, 0]);
  });
  await test('the file: written whole and private, read back, a bad file set aside, the size bounded', () => {
    const a = mk('file');
    const r = a.create('s1', who('k1'));
    a.decide('s1', r.id, 'approve', 'o');
    const file = path.join(tmp, 'file', 'access.json');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const b = new AccessRequests(path.join(tmp, 'file'), { log() {} });
    assert.equal(b.find('s1', r.id).state, 'approved');
    fs.writeFileSync(file, '{not json');
    let said = '';
    const c = new AccessRequests(path.join(tmp, 'file'), { log: (m) => { said += m; } });
    assert.equal(c.requests.length, 0);
    assert.match(said, /could not be read/);
    assert.ok(fs.readdirSync(path.join(tmp, 'file')).some((f) => /^access\.unreadable-/.test(f)), 'kept, not written over');
    fs.writeFileSync(file, JSON.stringify({ requests: [{ id: 'zz', space: 's1', key: 'k', at: 1, state: 'pending' }, { id: 'a'.repeat(16), space: '../x', key: 'k', at: 1, state: 'pending' }, 'x', { id: 'b'.repeat(16), space: 's1', guest: 'nope', name: 'x', at: 1, state: 'pending' }], grants: [{ guest: 'nope', space: 's', until: 1 }] }));
    const d = new AccessRequests(path.join(tmp, 'file'), { log() {} });
    assert.deepEqual([d.requests.length, d.grants.length], [0, 0], 'malformed records are dropped');
    const small = mk('small', { max: 2 });
    small.create('s1', who('k1')); small.create('s1', who('k2'));
    assert.throws(() => small.create('s1', who('k3')), (e) => e.status === 503);
  });
}

// --- 2. real servers ----------------------------------------------------------------------------------------------
const standIn = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ participants: [] })); });
});
await new Promise((r) => standIn.listen(0, '127.0.0.1', r));
const servers = [];
async function startServer(name, env = {}) {
  const dataDir = path.join(tmp, name);
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ADMIN_PASSWORD: 'testpass1234', LIVEKIT_API_URL: `http://127.0.0.1:${standIn.address().port}`, ENABLE_GUEST_DOOR: 'true', GUEST_DOOR_PER_ADDRESS: '1000', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 25000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  const srv = { child, port, dataDir };
  servers.push(srv);
  srv.call = (method, urlPath, opts) => call(srv, method, urlPath, opts);
  srv.secret = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'app.json'), 'utf8')).secrets.session;
  srv.access = () => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'access.json'), 'utf8')); } catch { return { requests: [], grants: [] }; } };
  return srv;
}
const stopAll = () => Promise.all(servers.map((s) => new Promise((resolve) => { if (s.child.exitCode !== null) return resolve(); s.child.once('exit', resolve); s.child.kill('SIGTERM'); })));
async function call(srv, method, urlPath, { body, token, cookie, headers: extra = {} } = {}) {
  const headers = { accept: 'application/json', ...extra };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`http://127.0.0.1:${srv.port}${urlPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(6000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, ctype: res.headers.get('content-type') || '' };
}
const login = async (srv, l, p) => (await srv.call('POST', '/api/login', { body: { login: l, password: p } })).json.token;
const guestCookie = (srv, id, name, at = Date.now()) => `guest_session=${door.issue(srv.secret(), { slug: '', id, name, versions: {}, epoch: 0, at })}`;

async function world(srv) {
  const admin = await login(srv, 'admin', 'testpass1234');
  const mk = async (l, displayName, role = 'member') => {
    const r = await srv.call('POST', '/api/users', { token: admin, body: { login: l, displayName, role, password: 'memberpass1234' } });
    assert.equal(r.status, 201, r.text);
    return r.json.user.key;
  };
  const keys = { owner: await mk('olga', 'Olga Owner', 'owner'), mod: await mk('milo', 'Milo Moderator'), member: await mk('mia', 'Mia Member'), out1: await mk('otto', 'Otto Outside'), out2: await mk('pia', 'Pia Outside'), out3: await mk('quinn', 'Quinn Outside'), out4: await mk('rae', 'Rae Outside') };
  const tokens = { admin };
  for (const [k, l] of [['owner', 'olga'], ['mod', 'milo'], ['member', 'mia'], ['out1', 'otto'], ['out2', 'pia'], ['out3', 'quinn'], ['out4', 'rae']]) tokens[k] = await login(srv, l, 'memberpass1234');
  const space = async (name, description, patch = {}) => {
    const r = await srv.call('POST', '/api/spaces', { token: admin, body: { name, description, members: [keys.mod, keys.member] } });
    assert.equal(r.status, 200, r.text);
    const id = r.json.space.id;
    const p = await srv.call('PATCH', `/api/spaces/${id}`, { token: admin, body: { members: [keys.mod, keys.member], description, ...patch } });
    assert.equal(p.status, 200, p.text);
    return id;
  };
  const ids = {
    req: await space('Secret Trip', '<img src=x onerror=alert(1)> Where we go', { requestAccess: true }),
    closed: await space('Hidden Trip', 'Nobody knows'),
    open: await space('Open Trip', 'For guests', { entry: 'guests' }),
  };
  assert.equal((await srv.call('PATCH', '/api/settings', { token: admin, body: { guestDoor: true } })).status, 200);
  assert.equal((await srv.call('PATCH', `/api/users/${keys.mod}/spaces/${ids.req}`, { token: admin, body: { permissions: { moderator: true } } })).status, 200);
  return { admin, keys, tokens, ids };
}

let A = null;
let C = null;
try {
  A = await startServer('a', { ACCESS_REQUESTS_PER_DAY: '3' });
  const a = await world(A);
  const { ids, keys, tokens } = a;
  const UNKNOWN = 'nosuchspace';
  const who = {
    admin: { token: tokens.admin }, owner: { token: tokens.owner }, moderator: { token: tokens.mod }, member: { token: tokens.member },
    outsider: { token: tokens.out1 }, none: {},
  };

  await test('the setting: owners and the admin only, true or false only, never the Lobby', async () => {
    const patch = (opts, body, id = ids.req) => A.call('PATCH', `/api/spaces/${id}`, { ...opts, body });
    assert.equal((await A.call('GET', `/api/spaces/${ids.req}`, { token: tokens.admin })).json.space.requestAccess, true);
    assert.equal((await A.call('GET', `/api/spaces/${ids.closed}`, { token: tokens.admin })).json.space.requestAccess, undefined, 'absent while off');
    assert.equal((await patch(who.owner, { requestAccess: false })).status, 200);
    assert.equal((await A.call('GET', `/api/spaces/${ids.req}`, { token: tokens.admin })).json.space.requestAccess, undefined);
    assert.equal((await patch(who.owner, { requestAccess: true })).status, 200);
    for (const bad of ['true', 1, 0, null, {}, [], 'yes']) {
      const r = await patch(who.admin, { requestAccess: bad });
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.match(r.json.error, /true or false/);
    }
    assert.equal((await A.call('GET', `/api/spaces/${ids.req}`, { token: tokens.admin })).json.space.requestAccess, true, 'a refused value changes nothing');
    const lobby = (await A.call('GET', '/api/spaces', { token: tokens.admin })).json.spaces.find((s) => s.isLobby);
    const l = await patch(who.admin, { requestAccess: true }, lobby.id);
    assert.equal(l.status, 400);
    assert.match(l.json.error, /Lobby/);
    const mod = await patch(who.moderator, { requestAccess: false });
    assert.equal(mod.status, 403, 'a moderator may not');
    assert.match(mod.json.error, /only/);
    assert.equal((await patch(who.member, { requestAccess: false })).status, 403);
    assert.equal((await patch(who.outsider, { requestAccess: false })).status, 404, 'a stranger is told nothing of the space');
    assert.equal((await patch(who.none, { requestAccess: false })).status, 401);
    assert.equal((await patch({ cookie: guestCookie(A, 'guest-patch0001', 'Pat') }, { requestAccess: false })).status, 401, 'a door guest is not a person');
    assert.equal((await A.call('GET', `/api/spaces/${ids.req}`, { token: tokens.admin })).json.space.requestAccess, true);
  });

  const cookies = new Map();
  const asGuest = (id, name) => { if (!cookies.has(id)) cookies.set(id, { cookie: guestCookie(A, id, name) }); return cookies.get(id); };
  await test('a closed space without the switch is told exactly as an unknown id, to every stranger', async () => {
    const link = (await A.call('POST', `/api/spaces/${ids.closed}/guest-link`, { token: tokens.admin })).json;
    const strangers = {
      outsider: { token: tokens.out1 }, 'door guest': asGuest('guest-leak00001', 'Lee'), 'signed out': {},
    };
    const asks = [
      ['GET', (id) => `/api/spaces/${id}`], ['POST', (id) => `/api/spaces/${id}/request`], ['DELETE', (id) => `/api/spaces/${id}/request`],
      ['GET', (id) => `/api/spaces/${id}/access-requests`], ['POST', (id) => `/api/spaces/${id}/access-requests/${'a'.repeat(16)}`], ['POST', (id) => `/api/spaces/${id}/join`],
    ];
    for (const [name, opts] of Object.entries(strangers)) {
      for (const [method, url] of asks) {
        const body = method === 'POST' ? { decision: 'approve' } : undefined;
        const closed = await A.call(method, url(ids.closed), { ...opts, body });
        const unknown = await A.call(method, url(UNKNOWN), { ...opts, body });
        assert.equal(closed.status, unknown.status, `${name} ${method} ${url(':id')}`);
        assert.equal(closed.text.replace(ids.closed, UNKNOWN), unknown.text, `${name} ${method} ${url(':id')} words`);
        assert.equal(closed.text.includes('Hidden'), false);
      }
    }
    assert.ok(link, 'the closed space is a real one');
    const list = await A.call('GET', '/api/spaces', { token: tokens.out1 });
    assert.equal(list.text.includes('Hidden Trip') || list.text.includes(ids.closed), false, 'not in the outsider\'s list');
    const pres = await A.call('GET', '/api/presence', { token: tokens.out1 });
    assert.equal(pres.text.includes('Hidden Trip') || pres.text.includes(ids.closed), false, 'nor in presence');
    const gl = await A.call('GET', '/api/guest-door', asGuest('guest-leak00001', 'Lee'));
    assert.equal(gl.text.includes('Hidden Trip') || gl.text.includes(ids.closed), false, 'nor in a guest\'s');
  });

  await test('a request-access space shows a stranger its id, name, picture flag and description, and nothing else', async () => {
    const expect = { id: ids.req, name: 'Secret Trip', description: '<img src=x onerror=alert(1)> Where we go', hasImage: false, request: 'request' };
    const list = await A.call('GET', '/api/spaces', { token: tokens.out1 });
    assert.equal(list.status, 200);
    const mine = list.json.spaces.filter((s) => s.id === ids.req);
    assert.equal(mine.length, 1);
    assert.deepEqual(mine[0], expect, 'exactly these fields');
    assert.equal(JSON.stringify(mine[0]).includes(keys.member) || JSON.stringify(mine[0]).includes(keys.mod), false, 'no member\'s key in the space\'s entry');
    assert.equal(list.json.spaces.some((s) => s.id === ids.closed), false);
    const pres = await A.call('GET', '/api/presence', { token: tokens.out1 });
    assert.deepEqual(pres.json.spaces.filter((s) => s.id === ids.req), [expect], 'presence says the same and no more');
    const g = await A.call('GET', '/api/guest-door', asGuest('guest-show00001', 'Lee'));
    assert.equal(g.status, 200);
    assert.deepEqual(g.json.spaces.find((s) => s.id === ids.req), { id: ids.req, name: 'Secret Trip', hasImage: false, description: expect.description, state: 'request' });
    assert.deepEqual(Object.keys(g.json.spaces.find((s) => s.id === ids.open)).sort(), ['hasImage', 'id', 'name', 'state'], 'an open space carries no description');
    assert.equal(g.text.includes(keys.member), false);
    assert.equal(g.json.spaces.some((s) => s.id === ids.closed), false);
    // The same space to its own people and to owners is the full record, unchanged.
    assert.deepEqual(Object.keys((await A.call('GET', '/api/spaces', { token: tokens.member })).json.spaces.find((s) => s.id === ids.req)).includes('members'), true);
    assert.equal((await A.call('GET', '/api/spaces', { token: tokens.admin })).json.spaces.find((s) => s.id === ids.req).request, undefined);
    // What a stranger cannot reach by the id.
    for (const url of [`/api/spaces/${ids.req}`, `/api/spaces/${ids.req}/chat`, `/api/spaces/${ids.req}/tags`, `/api/spaces/${ids.req}/layouts`, `/img/space/${ids.req}`]) {
      assert.notEqual((await A.call('GET', url, { token: tokens.out1 })).status, 200, `outsider ${url}`);
      assert.notEqual((await A.call('GET', url, asGuest('guest-show00001', 'Lee'))).status, 200, `guest ${url}`);
    }
    assert.equal((await A.call('POST', `/api/spaces/${ids.req}/join`, { token: tokens.out1 })).status, 404, 'asking is not joining');
  });

  const note = async (token) => (await A.call('GET', '/api/notifications', { token })).json.notifications;
  let otto = null;
  await test('asking: an outsider 201, again 409; a member, the admin 409; a link guest 403; signed out 401; a closed space 404', async () => {
    const r = await A.call('POST', `/api/spaces/${ids.req}/request`, who.outsider);
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(r.json, { ok: true, state: 'pending' });
    const again = await A.call('POST', `/api/spaces/${ids.req}/request`, who.outsider);
    assert.equal(again.status, 409);
    assert.match(again.json.error, /asked already/);
    for (const k of ['member', 'moderator', 'owner', 'admin']) {
      const m = await A.call('POST', `/api/spaces/${ids.req}/request`, who[k]);
      assert.equal(m.status, 409, k);
      assert.match(m.json.error, /already/);
    }
    assert.equal((await A.call('POST', `/api/spaces/${ids.req}/request`, who.none)).status, 401);
    const link = (await A.call('POST', `/api/spaces/${ids.open}/guest-link`, { token: tokens.admin })).json;
    const token = link.guestToken || link.token || link.space?.guestToken;
    assert.ok(token, JSON.stringify(link));
    const viaLink = await A.call('POST', `/api/spaces/${ids.req}/request?guest=${token}`, {});
    assert.equal(viaLink.status, 403, 'a guest link opens one space only');
    assert.equal(viaLink.json.error.includes('Secret'), false);
    assert.equal((await A.call('POST', `/api/spaces/${ids.req}/request`, { cookie: guestCookie(A, 'guest-badsig001', 'X').replace(/.$/, 'A') })).status, 401, 'a forged guest session is nobody');
    assert.equal((await A.call('POST', `/api/spaces/${ids.req}/request?s=nope`, {})).status, 401);
    assert.equal(A.access().requests.filter((x) => x.state === 'pending').length, 1);
    otto = A.access().requests[0];
    assert.equal(otto.key, keys.out1);
  });

  await test('the owners are told (a bell notice), the asker is not', async () => {
    for (const k of ['owner', 'admin']) {
      const mine = (await note(tokens[k])).filter((x) => /Secret Trip/.test(x.title));
      assert.equal(mine.length, 1, k);
      assert.match(mine[0].body, /Otto Outside asks to enter Secret Trip/);
    }
    for (const k of ['member', 'mod', 'out1']) assert.equal((await note(tokens[k])).some((x) => /Secret Trip/.test(x.title)), false, `${k} is not told`);
  });

  await test('the owners\' list: owners and the admin read it; nobody else', async () => {
    const url = `/api/spaces/${ids.req}/access-requests`;
    for (const k of ['admin', 'owner']) {
      const r = await A.call('GET', url, who[k]);
      assert.equal(r.status, 200, k);
      assert.equal(r.json.requests.length, 1);
      assert.deepEqual(Object.keys(r.json.requests[0]).sort(), ['at', 'expiresAt', 'id', 'kind', 'name'], 'no key, no address');
      assert.equal(r.json.requests[0].name, 'Otto Outside');
      assert.equal(r.json.requests[0].kind, 'account');
      assert.equal(r.json.requests[0].expiresAt - r.json.requests[0].at, 7 * 24 * 3600000);
    }
    for (const k of ['moderator', 'member']) {
      const r = await A.call('GET', url, who[k]);
      assert.equal(r.status, 403, k);
      assert.match(r.json.error, /only/);
    }
    assert.equal((await A.call('GET', url, who.outsider)).status, 404);
    assert.equal((await A.call('GET', url, who.none)).status, 401);
    assert.equal((await A.call('GET', url, asGuest('guest-list000001', 'Lee'))).status, 401);
    assert.equal((await A.call('GET', `/api/spaces/${UNKNOWN}/access-requests`, who.admin)).status, 404);
  });

  await test('answering: owners and the admin only; bad decisions 400; unknown request 404', async () => {
    const id = otto.id;
    const url = `/api/spaces/${ids.req}/access-requests/${id}`;
    for (const k of ['moderator', 'member']) assert.equal((await A.call('POST', url, { ...who[k], body: { decision: 'approve' } })).status, 403, k);
    assert.equal((await A.call('POST', url, { ...who.outsider, body: { decision: 'approve' } })).status, 404, 'the asker cannot answer their own');
    assert.equal((await A.call('POST', url, { ...who.none, body: { decision: 'approve' } })).status, 401);
    assert.equal((await A.call('POST', url, { cookie: guestCookie(A, 'guest-ans0000001', 'Lee'), body: { decision: 'approve' } })).status, 401);
    for (const bad of [undefined, 'yes', 'approved', 'decline', 1, null]) {
      const r = await A.call('POST', url, { ...who.owner, body: { decision: bad } });
      assert.equal(r.status, 400, String(bad));
      assert.match(r.json.error, /approve or deny/);
    }
    assert.equal((await A.call('POST', `/api/spaces/${ids.req}/access-requests/${'e'.repeat(16)}`, { ...who.owner, body: { decision: 'approve' } })).status, 404);
    assert.equal((await A.call('POST', `/api/spaces/${ids.open}/access-requests/${id}`, { ...who.owner, body: { decision: 'approve' } })).status, 404, 'the id belongs to one space');
    assert.equal(A.access().requests.find((x) => x.id === id).state, 'pending', 'nothing above changed it');
    assert.equal((await A.call('GET', `/api/spaces/${ids.req}`, who.outsider)).status, 404, 'still a stranger');
  });

  await test('two approvals at once make one member and one change; later answers are idempotent or 409', async () => {
    const url = `/api/spaces/${ids.req}/access-requests/${otto.id}`;
    const both = await Promise.all([A.call('POST', url, { ...who.owner, body: { decision: 'approve' } }), A.call('POST', url, { ...who.admin, body: { decision: 'approve' } }), A.call('POST', url, { ...who.owner, body: { decision: 'approve' } })]);
    assert.deepEqual(both.map((r) => r.status), [200, 200, 200]);
    assert.equal(both.filter((r) => r.json.changed).length, 1, 'exactly one made the change');
    const space = (await A.call('GET', `/api/spaces/${ids.req}`, { token: tokens.admin })).json.space;
    assert.equal(space.members.filter((k) => k === keys.out1).length, 1, 'a member once');
    const stored = JSON.parse(fs.readFileSync(path.join(A.dataDir, 'app.json'), 'utf8')).users.find((u) => u.key === keys.out1);
    assert.equal(stored.spaces[ids.req].joined.by, 'request', 'marked as entered by request, not on their own');
    assert.equal((await A.call('GET', `/api/spaces/${ids.req}/chat`, who.outsider)).status, 200, 'now in');
    const deny = await A.call('POST', url, { ...who.owner, body: { decision: 'deny' } });
    assert.equal(deny.status, 409);
    assert.match(deny.json.error, /answered/);
    assert.equal((await A.call('POST', url, { ...who.owner, body: { decision: 'approve' } })).json.changed, false);
    const list = await A.call('GET', '/api/spaces', who.outsider);
    assert.ok(list.json.spaces.find((s) => s.id === ids.req).members, 'told as a member now, not as a request');
    assert.equal((await note(tokens.out1)).filter((x) => /You can enter Secret Trip/.test(x.title)).length, 1, 'told once, in the bell');
    assert.equal((await A.call('POST', `/api/spaces/${ids.req}/request`, who.outsider)).status, 409, 'a member cannot ask');
  });

  await test('deny, ask again, withdraw, and the daily limit (3 here)', async () => {
    const asker = { token: tokens.out2 };
    const first = await A.call('POST', `/api/spaces/${ids.req}/request`, asker);
    assert.equal(first.status, 201);
    const pending = (await A.call('GET', `/api/spaces/${ids.req}/access-requests`, who.owner)).json.requests.find((r) => r.name === 'Pia Outside');
    assert.equal((await A.call('POST', `/api/spaces/${ids.req}/access-requests/${pending.id}`, { ...who.owner, body: { decision: 'deny' } })).status, 200);
    assert.equal((await A.call('GET', `/api/spaces/${ids.req}`, asker)).status, 404, 'declined: still a stranger');
    assert.equal((await note(tokens.out2)).some((x) => /declined/.test(x.title)), true, 'told');
    assert.equal((await A.call('GET', '/api/spaces', asker)).json.spaces.find((s) => s.id === ids.req).request, 'request', 'may ask again');
    assert.equal((await A.call('POST', `/api/spaces/${ids.req}/request`, asker)).status, 201);
    assert.equal((await A.call('GET', '/api/spaces', asker)).json.spaces.find((s) => s.id === ids.req).request, 'pending');
    assert.equal((await A.call('DELETE', `/api/spaces/${ids.req}/request`, asker)).status, 200, 'withdrawn');
    const gone = await A.call('DELETE', `/api/spaces/${ids.req}/request`, asker);
    assert.equal(gone.status, 404);
    assert.equal((await A.call('GET', `/api/spaces/${ids.req}/access-requests`, who.owner)).json.requests.some((r) => r.name === 'Pia Outside'), false);
    assert.equal((await A.call('POST', `/api/spaces/${ids.req}/request`, asker)).status, 201, 'the third in a day');
    const fourth = await A.call('DELETE', `/api/spaces/${ids.req}/request`, asker);
    assert.equal(fourth.status, 200);
    const over = await A.call('POST', `/api/spaces/${ids.req}/request`, asker);
    assert.equal(over.status, 429);
    assert.match(over.json.error, /today/);
    assert.equal((await A.call('DELETE', `/api/spaces/${UNKNOWN}/request`, asker)).json.error, gone.json.error, 'withdrawing from nothing and from a non-space read alike');
    assert.equal((await A.call('DELETE', `/api/spaces/${ids.closed}/request`, asker)).json.error, gone.json.error);
    assert.equal((await A.call('DELETE', `/api/spaces/${ids.req}/request`, { ...who.none })).status, 401);
  });

  const hostile = '<script>alert(1)</script>"&';
  let gus = null;
  await test('a door guest asks; the owners see the typed name as text, marked as a guest; the guest reads their state', async () => {
    const g = asGuest('guest-gus00001', hostile);
    const r = await A.call('POST', `/api/spaces/${ids.req}/request`, g);
    assert.equal(r.status, 201, r.text);
    assert.equal((await A.call('POST', `/api/spaces/${ids.req}/request`, g)).status, 409, 'one pending');
    assert.equal((await A.call('GET', '/api/guest-door', g)).json.spaces.find((s) => s.id === ids.req).state, 'pending');
    const list = await A.call('GET', `/api/spaces/${ids.req}/access-requests`, who.owner);
    assert.match(list.ctype, /^application\/json/, 'JSON, never a page');
    gus = list.json.requests.find((x) => x.kind === 'guest');
    assert.equal(gus.name, hostile, 'verbatim, as text');
    assert.deepEqual(Object.keys(gus).sort(), ['at', 'expiresAt', 'id', 'kind', 'name']);
    const bell = (await note(tokens.owner)).find((x) => x.body.includes(hostile));
    assert.ok(bell, 'the bell carries the typed name');
    assert.equal(bell.body, `${hostile} (guest) asks to enter Secret Trip.`);
    // The bell draws the title and body through escapeHtml (read as code).
    const brand = fs.readFileSync(path.join(ROOT, 'public', 'brand.js'), 'utf8');
    assert.match(brand, /<strong>\$\{escapeHtml\(n\.title \|\| ''\)\}<\/strong>\$\{n\.body \? `<span class="bell-notice-body">\$\{escapeHtml\(n\.body\)\}<\/span>`/);
    assert.equal((await A.call('GET', `/api/spaces/${ids.req}/chat`, g)).status === 200, false, 'asking is not entering');
  });

  await test('approving a guest lets them into that one space, until their session ends; others are not let in', async () => {
    const g = asGuest('guest-gus00001', hostile);
    const other = asGuest('guest-oth00001', 'Olive');
    const url = `/api/spaces/${ids.req}/access-requests/${gus.id}`;
    assert.equal((await A.call('POST', url, { ...who.owner, body: { decision: 'approve' } })).status, 200);
    assert.equal((await A.call('POST', url, { ...who.owner, body: { decision: 'approve' } })).json.changed, false);
    assert.equal((await A.call('GET', `/api/spaces/${ids.req}/chat`, g)).status, 200, 'in');
    assert.equal((await A.call('GET', `/api/spaces/${ids.closed}/chat`, g)).status === 200, false, 'not another space');
    assert.equal((await A.call('GET', `/api/spaces/${ids.req}/chat`, other)).status === 200, false, 'not another guest');
    const door1 = (await A.call('GET', '/api/guest-door', g)).json;
    assert.equal(door1.spaces.find((s) => s.id === ids.req).state, 'open');
    assert.equal('description' in door1.spaces.find((s) => s.id === ids.req), false);
    assert.equal((await A.call('POST', `/api/spaces/${ids.req}/request`, g)).status, 409, 'in already');
    const grant = A.access().grants.find((x) => x.guest === 'guest-gus00001');
    assert.ok(grant && grant.space === ids.req);
    const session = door.read(A.secret(), g.cookie.slice('guest_session='.length), { slug: '', epoch: 0, hours: 24 });
    assert.equal(grant.until, session.at + 24 * 3600000, 'ends with the guest\'s session');
    // A session issued 25 hours ago is over: it reads as nobody, and its grant is never read.
    const old = { cookie: guestCookie(A, 'guest-gus00001', hostile, Date.now() - 25 * 3600000) };
    assert.equal((await A.call('GET', `/api/spaces/${ids.req}/chat`, old)).status, 401);
    // The door off ends it at once; on again, the grant still holds.
    assert.equal((await A.call('PATCH', '/api/settings', { token: tokens.admin, body: { guestDoor: false } })).status, 200);
    assert.equal((await A.call('GET', `/api/spaces/${ids.req}/chat`, g)).status === 200, false, 'door off');
    assert.equal((await A.call('POST', `/api/spaces/${ids.req}/request`, other)).status, 401, 'no asking at a closed door');
    assert.equal((await A.call('PATCH', '/api/settings', { token: tokens.admin, body: { guestDoor: true } })).status, 200);
    assert.equal((await A.call('GET', `/api/spaces/${ids.req}/chat`, g)).status, 200);
    // A new epoch ends every guest session, and with it the grant's use.
    assert.equal((await A.call('POST', '/api/guest-door/end-all', { token: tokens.admin })).status, 200);
    assert.equal((await A.call('GET', `/api/spaces/${ids.req}/chat`, g)).status, 401);
  });

  await test('a door guest\'s denial is told to them; they may ask again; link and unknown ids are the same refusal', async () => {
    const g = { cookie: `guest_session=${door.issue(A.secret(), { slug: '', id: 'guest-den00001', name: 'Dana', versions: {}, epoch: 1 })}` };
    assert.equal((await A.call('POST', `/api/spaces/${ids.req}/request`, g)).status, 201);
    const id = (await A.call('GET', `/api/spaces/${ids.req}/access-requests`, who.owner)).json.requests.find((x) => x.name === 'Dana').id;
    assert.equal((await A.call('POST', `/api/spaces/${ids.req}/access-requests/${id}`, { ...who.admin, body: { decision: 'deny' } })).status, 200);
    const s = (await A.call('GET', '/api/guest-door', g)).json.spaces.find((x) => x.id === ids.req);
    assert.deepEqual([s.state, s.answer], ['request', 'denied']);
    assert.equal((await A.call('GET', `/api/spaces/${ids.req}/chat`, g)).status === 200, false);
    assert.equal(A.access().grants.some((x) => x.guest === 'guest-den00001'), false);
    assert.equal((await A.call('POST', `/api/spaces/${ids.req}/request`, g)).status, 201, 'again');
  });

  await test('turning the switch off: the space leaves the stranger\'s list and asking is 404; a granted guest and members stay in', async () => {
    assert.equal((await A.call('PATCH', `/api/spaces/${ids.req}`, { ...who.owner, body: { requestAccess: false } })).status, 200);
    assert.equal((await A.call('GET', '/api/spaces', { token: tokens.out3 })).json.spaces.some((s) => s.id === ids.req), false);
    assert.equal((await A.call('GET', '/api/presence', { token: tokens.out3 })).json.spaces.some((s) => s.id === ids.req), false);
    const closed = await A.call('POST', `/api/spaces/${ids.req}/request`, { token: tokens.out3 });
    const unknown = await A.call('POST', `/api/spaces/${UNKNOWN}/request`, { token: tokens.out3 });
    assert.equal(closed.status, 404);
    assert.equal(closed.text, unknown.text);
    assert.equal((await A.call('GET', `/api/spaces/${ids.req}/access-requests`, who.owner)).status, 200, 'owners still see what waits');
    assert.equal((await A.call('GET', `/api/spaces/${ids.req}/chat`, who.member)).status, 200);
    assert.equal((await A.call('PATCH', `/api/spaces/${ids.req}`, { ...who.owner, body: { requestAccess: true } })).status, 200);
  });

  await test('deleting the space takes its requests and approvals', async () => {
    assert.ok(A.access().requests.some((x) => x.space === ids.req));
    assert.equal((await A.call('DELETE', `/api/spaces/${ids.req}`, who.admin)).status, 200);
    const file = A.access();
    assert.equal(file.requests.some((x) => x.space === ids.req) || file.grants.some((x) => x.space === ids.req), false);
    assert.equal(fs.statSync(path.join(A.dataDir, 'access.json')).mode & 0o777, 0o600);
  });

  // Server C: the address limit and the pending cap, with the per-person limit out of the way.
  C = await startServer('c', { ACCESS_REQUESTS_PER_ADDRESS: '2', ACCESS_REQUESTS_PENDING_PER_SPACE: '3', ACCESS_REQUESTS_PER_DAY: '50' });
  const c = await world(C);
  await test('the limit per address (2 here) holds across people and guests; the pending cap (3) is per space', async () => {
    assert.equal((await C.call('POST', `/api/spaces/${c.ids.req}/request`, { token: c.tokens.out1 })).status, 201);
    assert.equal((await C.call('POST', `/api/spaces/${c.ids.req}/request`, { cookie: guestCookie(C, 'guest-addr0001', 'Ann') })).status, 201);
    const third = await C.call('POST', `/api/spaces/${c.ids.req}/request`, { token: c.tokens.out2 });
    assert.equal(third.status, 429);
    assert.match(third.json.error, /address/);
    assert.equal(C.access().requests.length, 2, 'a refused request leaves no record');
    assert.equal((await C.call('DELETE', `/api/spaces/${c.ids.req}/request`, { token: c.tokens.out1 })).status, 200, 'withdrawing is never limited');
  });
  await test('the notices an owner gets are bounded by the pending cap', async () => {
    const C2 = await startServer('c2', { ACCESS_REQUESTS_PENDING_PER_SPACE: '2', ACCESS_REQUESTS_PER_ADDRESS: '100' });
    const w = await world(C2);
    const codes = [];
    for (const k of ['out1', 'out2', 'out3', 'out4']) codes.push((await C2.call('POST', `/api/spaces/${w.ids.req}/request`, { token: w.tokens[k] })).status);
    assert.deepEqual(codes, [201, 201, 429, 429]);
    const told = (await C2.call('GET', '/api/notifications', { token: w.tokens.owner })).json.notifications.filter((x) => /Secret Trip/.test(x.title));
    assert.equal(told.length, 2, 'a refused request tells nobody');
  });
  await test('a restart keeps requests, approvals and the asker\'s pending state', async () => {
    const before = C.access();
    assert.equal(before.requests.length, 2);
    const raw = fs.readFileSync(path.join(C.dataDir, 'access.json'), 'utf8');
    const reread = new AccessRequests(C.dataDir, { log() {} });
    assert.deepEqual(JSON.parse(JSON.stringify({ requests: reread.requests, grants: reread.grants })), JSON.parse(raw));
  });
} catch (err) {
  failed += 1;
  console.error(err.stack || err);
} finally {
  await stopAll();
  standIn.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (failed) { console.error(`check-request-access: ${failed} failed, ${n} passed`); process.exit(1); }
console.log(`check-request-access: ${n} passed`);
