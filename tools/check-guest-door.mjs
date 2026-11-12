#!/usr/bin/env node
/*
 * check-guest-door.mjs -- the guest door (documentation/plans/plan-access-bundle.md, step 4; server/guest-door.js, the one
 * resolver guestOf in server/index.js, the door routes). Three parts:
 *   1. the pieces on their own: the session token (tamper, another secret or environment, expiry, epoch), the register, the
 *      per-address limiter, name comparison, and mayEnter for every kind of actor;
 *   2. real servers on throwaway data folders: the two switches, the cookie's flags (HttpOnly, SameSite, Secure over https),
 *      the agreements and what is recorded, name collisions, the limits (per address, per space, per environment), expiry,
 *      the epoch, what a guest sees and reaches, pictures, a guest link's pass (versions, address limit, expiry);
 *   3. the enumeration: every route the server registers (read from server/index.js), asked as a guest from the door with
 *      its cookie, and none answers 2xx unless it is in ALLOWED below, each with its expected status.
 * A small stand-in answers the call service (LiveKit); no network beyond localhost.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const door = require('../server/guest-door.js');
const { mayEnter } = require('../server/space-access.js');
const agreements = require('../server/agreements.js');
let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};

// --- 1. the pieces ------------------------------------------------------------------------------------------------
{
  const SECRET = 'secret-one';
  const base = { slug: 'acme', id: 'guest-abcd1234', name: 'Sam', versions: { terms: 'a'.repeat(16) }, epoch: 0 };
  const rd = (token, over = {}) => door.read(SECRET, token, { slug: 'acme', epoch: 0, hours: 24, ...over });
  await test('a session reads back as issued', () => {
    const got = rd(door.issue(SECRET, base));
    assert.equal(got.id, base.id);
    assert.equal(got.name, 'Sam');
    assert.deepEqual(got.versions, base.versions);
  });
  await test('a tampered, truncated, foreign or malformed session is nobody', () => {
    const token = door.issue(SECRET, base);
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), n: 'Admin' })).toString('base64url');
    for (const bad of [`${forged}.${sig}`, `${payload}.${sig.slice(1)}`, `${payload}`, '', '.', `${payload}.${sig}.x`, 'x'.repeat(2000), null, undefined, 7, {}]) assert.equal(rd(bad), null, String(bad).slice(0, 30));
    assert.equal(door.read('secret-two', token, { slug: 'acme', epoch: 0, hours: 24 }), null, 'another secret (another environment) never reads it');
    assert.equal(rd(token, { slug: 'other' }), null, 'another environment slug');
    assert.equal(rd(token, { slug: '' }), null);
  });
  await test('the account session and the guest session are different keys and shapes', () => {
    const auth = require('../server/auth.js');
    const account = auth.issueSession(SECRET, { key: 'k1', passwordHash: 'x' });
    assert.equal(rd(account), null, 'an account session never reads as a guest');
    assert.equal(auth.readSession(SECRET, door.issue(SECRET, base), () => ({ key: base.id, passwordHash: 'x' })), null, 'a guest session never reads as an account');
    assert.equal(auth.sessionToken({ get: (h) => (h === 'cookie' ? `guest_session=${door.issue(SECRET, base)}` : '') }), null, 'app_session reader ignores the guest cookie');
    assert.equal(auth.sessionToken({ get: (h) => (h === 'authorization' ? `Bearer ${door.issue(SECRET, base)}` : '') }) !== null, true, 'the bearer is read as an account token, which then fails (above)');
  });
  await test('expiry: in date for GUEST_SESSION_HOURS, then nobody', () => {
    const now = Date.now();
    assert.ok(rd(door.issue(SECRET, { ...base, at: now - 23 * 3600000 })));
    assert.equal(rd(door.issue(SECRET, { ...base, at: now - 24 * 3600000 - 1000 })), null);
    assert.ok(rd(door.issue(SECRET, { ...base, at: now - 25 * 3600000 }), { hours: 48 }), 'the hours are the limit');
    assert.equal(rd(door.issue(SECRET, { ...base, at: now + 3600000 })), null, 'issued in the future');
  });
  await test('the epoch ends every session at once', () => {
    assert.ok(rd(door.issue(SECRET, base)));
    assert.equal(rd(door.issue(SECRET, base), { epoch: 1 }), null);
  });
  await test('a bad guest id is nobody', () => {
    assert.equal(rd(door.issue(SECRET, { ...base, id: 'someone' })), null);
    assert.equal(rd(door.issue(SECRET, { ...base, id: 'guest-../x' })), null);
  });
  await test('the register counts who is here and forgets the idle and the ended', () => {
    const r = new door.GuestRegister({ activeMs: 1000 });
    const t = 1000000;
    r.touch('guest-aaaa', 'A', t);
    r.touch('guest-bbbb', 'B', t);
    r.touch('guest-aaaa', 'A', t + 10);
    assert.equal(r.inEnvironment(t + 10), 2);
    assert.equal(r.inEnvironment(t + 1500), 0, 'idle past the window');
    r.touch('guest-aaaa', 'A', t + 2000);
    r.end('guest-aaaa');
    assert.equal(r.inEnvironment(t + 2000), 0, 'ended');
  });
  await test('the address limiter: N in the window, then blocked, then free again', () => {
    const l = new door.NewSessionLimiter(5, 1000);
    for (let i = 0; i < 5; i += 1) { assert.equal(l.blocked('a', 10), false); l.count('a', 10); }
    assert.equal(l.blocked('a', 10), true, 'the sixth');
    assert.equal(l.blocked('b', 10), false, 'another address');
    assert.equal(l.blocked('a', 1011), false, 'after the window');
  });
  await test('limits come from the variables, at the decided defaults', () => {
    assert.deepEqual(door.readLimits({}), { hours: 24, perAddress: 5, perSpace: 10, perEnvironment: 50 });
    assert.deepEqual(door.readLimits({ GUEST_SESSION_HOURS: '2', GUEST_DOOR_PER_ADDRESS: '7', GUESTS_PER_SPACE: '3', GUESTS_PER_ENVIRONMENT: '9' }), { hours: 2, perAddress: 7, perSpace: 3, perEnvironment: 9 });
    assert.deepEqual(door.readLimits({ GUEST_SESSION_HOURS: '0', GUESTS_PER_SPACE: 'x', GUEST_DOOR_PER_ADDRESS: '-1' }), { hours: 24, perAddress: 5, perSpace: 10, perEnvironment: 50 });
  });
  await test('names: case, accents of composition and spacing do not make another name', () => {
    assert.equal(door.nameKey('  Olive   Smith '), door.nameKey('olive smith'));
    assert.equal(door.nameKey('Ｏlive'), door.nameKey('olive'), 'width variants');
    assert.notEqual(door.nameKey('Olive'), door.nameKey('Olivia'));
  });
  // mayEnter for every kind of actor, against every entry, with the door on and off.
  const space = (entry, extra = {}) => ({ id: 'sp1', entry, members: ['mem'], ...extra });
  const actors = {
    nobody: null,
    'empty viewer': {},
    'access key': { all: true },
    owner: { key: 'own', owner: true },
    member: { key: 'mem' },
    'other account': { key: 'out' },
    'link guest of it': { guestSpace: 'sp1' },
    'link guest of another': { guestSpace: 'sp9' },
    'door guest, door on': { doorGuest: true, doorOn: true },
    'door guest, door off': { doorGuest: true, doorOn: false },
    'door guest, door unsaid': { doorGuest: true },
  };
  const want = {
    // actor -> [invited, accounts, guests]
    nobody: [false, false, false], 'empty viewer': [false, false, false], 'access key': [true, true, true], owner: [true, true, true],
    member: [true, true, true], 'other account': [false, true, true], 'link guest of it': [true, true, true], 'link guest of another': [false, false, false],
    'door guest, door on': [false, false, true], 'door guest, door off': [false, false, false], 'door guest, door unsaid': [false, false, false],
  };
  for (const [name, viewer] of Object.entries(actors)) {
    await test(`mayEnter: ${name}`, () => {
      assert.deepEqual(['invited', 'accounts', 'guests'].map((e) => mayEnter(viewer, space(e))), want[name]);
      assert.equal(mayEnter(viewer, space(undefined)), want[name][0], 'no entry is invited');
      assert.equal(mayEnter(viewer, space('guests', { isLobby: true })), name === 'door guest, door on' ? false : name === 'link guest of it' || ['access key', 'owner', 'member', 'other account'].includes(name), 'the Lobby is never a door guest\'s');
    });
  }
  await test('a door guest is never let into the Lobby, however it is written', () => {
    for (const lobby of [{ id: 'lobby', entry: 'guests', members: [] }, { id: 'x', isLobby: true, entry: 'guests', members: [] }]) assert.equal(mayEnter({ doorGuest: true, doorOn: true }, lobby), false);
  });
}

// --- 2. real servers ----------------------------------------------------------------------------------------------
const standIn = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ participants: [], ...{ ['ro' + 'oms']: [] } })); });
});
await new Promise((r) => standIn.listen(0, '127.0.0.1', r));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-guest-door-'));
const TERMS = path.join(tmp, 'terms.md');
fs.writeFileSync(TERMS, 'Terms of service\n\nBe kind.\n');
const termsVersion = agreements.readTexts({ TERMS_FILE: TERMS }).docs[0].version;
const servers = [];
async function startServer(name, env = {}) {
  const dataDir = path.join(tmp, name);
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ADMIN_PASSWORD: 'testpass1234', LIVEKIT_API_URL: `http://127.0.0.1:${standIn.address().port}`, ...env },
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
  const srv = { child, port, dataDir, secret: null };
  servers.push(srv);
  srv.call = (method, urlPath, opts) => call(srv, method, urlPath, opts);
  srv.secret = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'app.json'), 'utf8')).secrets.session;
  return srv;
}
const stopAll = () => Promise.all(servers.map((s) => new Promise((resolve) => { if (s.child.exitCode !== null) return resolve(); s.child.once('exit', resolve); s.child.kill('SIGTERM'); })));

async function call(srv, method, urlPath, { body, token, cookie, headers: extra = {}, raw } = {}) {
  const headers = { accept: 'application/json', ...extra };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`http://127.0.0.1:${srv.port}${urlPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(6000) }).catch((err) => ({ timedOut: err }));
  if (res.timedOut) return { status: 0, json: null, text: 'timed out (a stream?)', setCookie: [], headers: new Headers(), cookie: null };
  const text = await Promise.race([res.text(), new Promise((r) => setTimeout(() => r('(stream)'), 3000))]);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  const setCookie = res.headers.getSetCookie();
  return { status: res.status, json, text, setCookie, headers: res.headers, cookie: setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('guest_session=') && c !== 'guest_session=') || null };
}
async function streamStatus(srv, urlPath, { cookie, token } = {}) {
  const ctl = new AbortController();
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${srv.port}${urlPath}`, { headers, signal: ctl.signal });
  const status = res.status;
  ctl.abort();
  await res.body?.cancel().catch(() => {});
  return status;
}
const adminToken = async (srv) => (await srv.call('POST', '/api/login', { body: { login: 'admin', password: 'testpass1234' } })).json.token;
async function seed(srv, texts = false) {
  const admin = await adminToken(srv);
  if (texts) assert.equal((await srv.call('POST', '/api/agreements/accept', { token: admin, body: { versions: { terms: termsVersion } } })).status, 200);
  const mk = async (login, displayName, role = 'member') => {
    const r = await srv.call('POST', '/api/users', { token: admin, body: { login, displayName, role, password: 'memberpass1234' } });
    assert.equal(r.status, 201, r.text);
    return r.json.user.key;
  };
  const keys = { member: await mk('mia', 'Mia Member'), outsider: await mk('otto', 'Otto Outside') };
  const space = async (name, entry, members) => {
    const r = await srv.call('POST', '/api/spaces', { token: admin, body: { name, members } });
    assert.equal(r.status, 200, r.text);
    const id = r.json.space.id;
    await srv.call('PATCH', `/api/spaces/${id}`, { token: admin, body: { members } });
    if (entry) assert.equal((await srv.call('PATCH', `/api/spaces/${id}`, { token: admin, body: { entry } })).status, 200);
    return id;
  };
  const ids = { open: await space('Open', 'guests', [keys.member]), accounts: await space('Accounts', 'accounts', [keys.member]), closed: await space('Closed', null, [keys.member]) };
  return { admin, keys, ids };
}
const enterDoor = (srv, name = 'Sam', over = {}) => srv.call('POST', '/api/guest-door', { body: { name, versions: { terms: termsVersion } }, ...over });

let A = null;
let B = null;
try {
  // Server A: texts set, the host's switch on, the owner's not yet; the default limits.
  A = await startServer('a', { ENABLE_GUEST_DOOR: 'true', TERMS_FILE: TERMS });
  const a = await seed(A, true);
  // Server O: no switch at all: the door never opens.
  const O = await startServer('off', { TERMS_FILE: TERMS });
  const o = await seed(O, true);

  await test('one switch, the host\'s: on, the button shows with no owner step; off, the door is shut whatever the spaces say', async () => {
    assert.equal((await A.call('GET', '/api/branding')).json.guestDoor, true, 'host on: the button shows');
    assert.equal((await O.call('GET', '/api/branding')).json.guestDoor, false, 'host off: no button');
    // The owner has no switch any more: the old key is ignored, never stored, never read.
    const ignored = await O.call('PATCH', '/api/settings', { token: o.admin, body: { guestDoor: true } });
    assert.equal(ignored.status, 200);
    assert.equal(ignored.json.settings.guestDoor, false, 'the old owner key is not a setting: this is only the host\'s switch, off here');
    assert.equal((await O.call('GET', '/api/branding')).json.guestDoor, false, 'the old owner key opens nothing');
    assert.equal((await enterDoor(O)).status, 403);
    assert.match((await enterDoor(O)).json.error, /closed/);
    const view = await A.call('GET', '/api/settings', { token: a.admin });
    assert.equal(view.json.settings.guestDoorHost, true);
    assert.equal(view.json.settings.guestDoor, true, 'the same as the host\'s switch; no owner key');
    assert.equal(view.json.settings.guestHours, 24);
    assert.equal(view.json.settings.guestDoorOpen, true, 'a space is open to guests');
    assert.equal((await O.call('GET', '/api/settings', { token: o.admin })).json.settings.guestDoorHost, false);
    // Host off: even a space set to guests lets nobody in.
    assert.equal((await O.call('GET', '/api/spaces', { token: o.admin })).json.spaces.some((r) => r.entry === 'guests'), true, 'O has a space set to guests');
    assert.equal((await enterDoor(O)).status, 403, 'door shut regardless of spaces');
  });

  let sam = null;
  await test('entering: texts and a name are required, a wrong version is 409, names get the guest mark, mixed alphabets are 400', async () => {
    const none = await A.call('POST', '/api/guest-door', { body: { name: 'Sam' } });
    assert.equal(none.status, 403);
    assert.equal(none.json.agreementRequired, true);
    const stale = await A.call('POST', '/api/guest-door', { body: { name: 'Sam', versions: { terms: '0'.repeat(16) } } });
    assert.equal(stale.status, 409);
    assert.match(stale.json.error, /changed/);
    for (const extra of [{ terms: termsVersion, nda: termsVersion }, {}, { terms: [termsVersion] }]) assert.equal((await A.call('POST', '/api/guest-door', { body: { name: 'Sam', versions: extra } })).status, 409);
    assert.equal((await A.call('POST', '/api/guest-door', { body: { versions: { terms: termsVersion } } })).status, 400);
    assert.equal((await A.call('POST', '/api/guest-door', { body: { name: '   ', versions: { terms: termsVersion } } })).status, 400);
    sam = await enterDoor(A, 'Sam');
    assert.equal(sam.status, 201, sam.text);
    assert.equal(sam.json.guest.name, 'Sam (Guest)', 'stored and shown with the mark');
    assert.match(sam.json.guest.id, /^guest-/);
    assert.ok(sam.cookie, 'a guest_session cookie');
  });

  // Server N: the same, with room for many sessions from one address, for the names.
  const N = await startServer('names', { ENABLE_GUEST_DOOR: 'true', TERMS_FILE: TERMS, GUEST_DOOR_PER_ADDRESS: '100' });
  {
    const n0 = await seed(N, true);
    await test('a member\'s display name may not end in the guest mark (any case), so no one passes as a guest', async () => {
      const bad = await N.call('PATCH', `/api/users/${n0.keys.member}`, { token: n0.admin, body: { displayName: 'Mia Member (GUEST)' } });
      assert.equal(bad.status, 400, bad.text);
      assert.match(bad.json.error, /can't end in \(guest\)/);
      const made = await N.call('POST', '/api/users', { token: n0.admin, body: { login: 'zed', displayName: 'Zed (guest)', role: 'member', password: 'memberpass1234' } });
      assert.equal(made.status, 400, made.text);
      assert.equal((await N.call('PATCH', `/api/users/${n0.keys.member}`, { token: n0.admin, body: { displayName: 'Mia Guest' } })).status, 200, 'a name that only contains the word is fine');
      assert.equal((await N.call('PATCH', `/api/users/${n0.keys.member}`, { token: n0.admin, body: { displayName: 'Mia Member' } })).status, 200);
    });
    await test('a guest\'s name: the typed name and the mark once, never doubled; a member\'s name is not refused; mixed alphabets are', async () => {
      const enter = (name) => enterDoor(N, name);
    // A member's name is no longer refused: every guest name carries the mark, so no guest passes as a member.
    for (const same of ['Mia Member', 'mia', 'admin']) {
      const r = await enter( same);
      assert.equal(r.status, 201, same);
      assert.equal(r.json.guest.name, `${same} (Guest)`, 'the typed name and the mark, once');
    }
    for (const typed of ['Thomas (Guest)', 'Thomas (guest)', 'Thomas (GUEST) ', 'Thomas  (Guest) (Guest)']) {
      const r = await enter( typed);
      assert.equal(r.status, 201, typed);
      assert.equal(r.json.guest.name, 'Thomas (Guest)', `${typed}: never doubled`);
    }
    assert.equal((await enter( '(Guest)')).status, 400, 'only the mark typed is no name');
    for (const mixed of ['M\u0430ry Jones', 'Sam \u03bflive', 'Jon \u0531nna']) {
      const r = await enter( mixed);
      assert.equal(r.status, 400, mixed);
      assert.match(r.json.error, /mix alphabets/);
    }
    const long = await enter( 'x'.repeat(41));
    assert.equal(long.status, 400);
    assert.match(long.json.error, /at most 40/);
    assert.equal((await enter( 'x'.repeat(40))).status, 201, '40 typed characters are allowed (the mark is not counted)');
    assert.equal((await enter( `${'y'.repeat(40)} (Guest)`)).status, 201, 'a typed mark is not counted either');
    assert.equal((await enter( `${'z'.repeat(41)} (Guest)`)).status, 400);
    for (const real of ['\u0418\u0432\u0430\u043d', '\u03a3\u03bf\u03c6\u03af\u03b1']) assert.equal(door.mixesScripts(real), false, real);
    });
  }

  await test('the cookie: HttpOnly, SameSite, no Domain, Secure only over https, 24 hours', async () => {
    const flags = sam.setCookie.find((c) => c.startsWith('guest_session='));
    assert.match(flags, /HttpOnly/i);
    assert.match(flags, /SameSite=Lax/i);
    assert.doesNotMatch(flags, /Domain=/i);
    assert.doesNotMatch(flags, /;\s*Secure/i, 'plain http');
    assert.match(flags, /Max-Age=86400/);
    assert.match(flags, /Path=\//);
    const tls = await A.call('POST', '/api/guest-door', { body: { name: 'Tess', versions: { terms: termsVersion } }, headers: { 'x-forwarded-proto': 'https' } });
    assert.equal(tls.status, 201);
    assert.match(tls.setCookie.find((c) => c.startsWith('guest_session=')), /;\s*Secure/i, 'over https');
    assert.equal(sam.setCookie.some((c) => c.startsWith('app_session=')), false, 'never an account cookie');
  });

  await test('what is recorded: the typed name, the version, the date, for that guest', async () => {
    const records = JSON.parse(fs.readFileSync(path.join(A.dataDir, 'agreements.json'), 'utf8')).agreements.filter((r) => r.guest === sam.json.guest.id);
    assert.equal(records.length, 1);
    assert.equal(records[0].name, 'Sam');
    assert.equal(records[0].doc, 'terms');
    assert.equal(records[0].version, termsVersion);
    assert.ok(!Number.isNaN(Date.parse(records[0].at)));
    assert.equal(fs.existsSync(path.join(A.dataDir, 'agreements.json')) && (fs.statSync(path.join(A.dataDir, 'agreements.json')).mode & 0o077), 0, 'private to the server');
  });

  await test('the guest is not an account: no account route reads the cookie, and the bearer header never carries it', async () => {
    const cookie = sam.cookie;
    for (const p of ['/api/me', '/api/users', '/api/spaces', '/api/settings']) assert.equal((await A.call('GET', p, { cookie })).status, 401, p);
    const token = cookie.slice('guest_session='.length);
    for (const p of ['/api/me', '/api/spaces', '/api/users']) assert.equal((await A.call('GET', p, { token })).status, 401, `bearer ${p}`);
    assert.equal((await A.call('GET', '/api/guest-door', { token })).status, 401, 'the door reads only the cookie');
    assert.equal((await A.call('GET', '/api/guest-door', { cookie: `app_session=${token}` })).status, 401);
  });

  await test('GET /api/guest-door: only the spaces open to guests, marked as a guest, with the refusals', async () => {
    const r = await A.call('GET', '/api/guest-door', { cookie: sam.cookie });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.spaces.map((s) => s.id), [a.ids.open]);
    assert.deepEqual(Object.keys(r.json.spaces[0]).sort(), ['hasImage', 'id', 'name', 'state']);
    assert.equal(r.json.spaces[0].state, 'open');
    assert.equal(r.json.guest.name, 'Sam (Guest)');
    assert.ok(r.json.unavailable.length > 3);
    assert.match(r.json.none, /No spaces are open to guests at this time\./);
    // The guest role's permissions, exactly what a guest link's join answers with (the page shows chat and the call by them; a guest link's join answers the same).
    const roles = await A.call('GET', '/api/roles', { token: a.admin });
    assert.ok(r.json.permissions && typeof r.json.permissions === 'object');
    assert.deepEqual(r.json.permissions, roles.json.roles.guest, 'the door answers exactly the guest role set');
    const nocookie = await A.call('GET', '/api/guest-door');
    assert.equal(nocookie.json.permissions, undefined, 'no cookie, no permissions');
    assert.equal((await A.call('GET', '/api/guest-door')).status, 401, 'no cookie');
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  await test('a guest reaches the open space, and no other', async () => {
    const cookie = sam.cookie;
    const o = a.ids.open;
    assert.equal((await A.call('GET', `/api/spaces/${o}/chat`, { cookie })).status, 200);
    assert.equal(await streamStatus(A, `/api/live?space=${o}`, { cookie }), 200);
    for (const id of [a.ids.accounts, a.ids.closed, 'lobby', 'nosuch']) {
      for (const p of [`/api/spaces/${id}/chat`, `/api/live?space=${id}`]) {
        const s = p.startsWith('/api/live') ? await streamStatus(A, p, { cookie }) : (await A.call('GET', p, { cookie })).status;
        assert.ok([401, 403, 404].includes(s), `${p} -> ${s}`);
      }
    }
    // chat: posts under the typed name, never one sent; limited like a guest
    const post = await A.call('POST', `/api/spaces/${o}/chat`, { cookie, body: { text: 'hello', name: 'Admin' } });
    assert.equal(post.status, 200, post.text);
    const history = (await A.call('GET', `/api/spaces/${o}/chat`, { cookie })).json;
    const last = (history.messages || []).slice(-1)[0];
    assert.ok(last, 'the message is there');
    assert.notEqual(last.name, 'Admin');
    assert.equal(last.who, 'Sam (Guest)', 'the chat sender is the typed name and the mark, once (the page adds nothing)');
    assert.equal(last.by, 'guest');
    assert.equal(/\(guest\).*\(guest\)/i.test(JSON.stringify(last)), false, 'never doubled');
    assert.equal((await A.call('POST', `/api/spaces/${a.ids.closed}/chat`, { cookie, body: { text: 'x' } })).status >= 400, true);
  });

  await test('the guest list is the door\'s own: a member\'s lists and creating are denied', async () => {
    const cookie = sam.cookie;
    assert.equal((await A.call('POST', '/api/spaces', { cookie, body: { name: 'Mine' } })).status, 401);
    assert.equal((await A.call('GET', '/api/presence', { cookie })).status, 401, 'no space asked: no list');
    assert.equal((await A.call('GET', `/api/presence?space=${a.ids.closed}`, { cookie })).status, 401);
    const p = await A.call('GET', `/api/presence?space=${a.ids.open}`, { cookie });
    assert.equal(p.status, 200);
    assert.deepEqual(p.json.spaces.map((s) => s.id), [a.ids.open], 'presence names only the open space');
    assert.equal(/"guestToken":"/.test(JSON.stringify(p.json)), false, 'no guest link in a guest\'s answer');
  });

  await test('#741: a module window (a frame) never gets the sign-in page: a guest is told it is not for them, a stale session is told it ended; a page of its own still goes to sign in', async () => {
    const framed = { 'sec-fetch-dest': 'iframe' };
    const cookie = sam.cookie;
    for (const url of [`/calendar?space=${a.ids.closed}`, `/map?space=${a.ids.closed}`, `/calendar?space=${a.ids.open}`, `/map?space=${a.ids.open}`]) {
      const r = await A.call('GET', url, { cookie, headers: framed });
      assert.notEqual(r.status, 302, `${url}: never a redirect to the sign-in page`);
      assert.doesNotMatch(String(r.headers.get('location') || ''), /login/);
      if (r.status >= 400) assert.match(r.text, /Not available to guests\./, url);
    }
    const stale = { cookie: `guest_session=${door.issue(A.secret(), { slug: '', id: 'guest-old00001', name: 'Old (Guest)', versions: {}, epoch: 0, at: Date.now() - 25 * 3600000 })}` };
    for (const who of [stale, {}]) {
      for (const url of [`/calendar?space=${a.ids.open}`, `/map?space=${a.ids.open}`, '/modules/todo?space=' + a.ids.open]) {
        const r = await A.call('GET', url, { ...who, headers: framed });
        assert.equal(r.status, 401, `${url}: a stale or missing session in a frame`);
        assert.match(r.text, /Your session has ended\. Reload the page\./);
        assert.doesNotMatch(r.text, /<form|password/i, 'not the sign-in page');
      }
      const page = await A.call('GET', `/calendar?space=${a.ids.open}`, who);
      assert.equal(page.status, 302, 'a page of its own (not framed) still goes to sign in');
      assert.match(page.headers.get('location'), /^\/login/);
    }
    // The frame's page itself draws no sign-in redirect for a guest of the door (read as code: destination.js).
    const dest = fs.readFileSync(path.join(ROOT, 'public', 'destination.js'), 'utf8');
    assert.match(dest, /api\('GET', '\/api\/guest-door'\); guestMode = true;/);
    assert.match(dest, /if \(embedded\) \{ missing\('Your session has ended\. Reload the page\.'\); return; \}/);
  });

  await test('pictures: a guest sees a person only from a space they may enter, and only an open space\'s picture', async () => {
    const cookie = sam.cookie;
    assert.equal((await A.call('GET', `/img/${a.keys.member}/profile`, { cookie })).status, 200, 'a member of the open space');
    assert.equal((await A.call('GET', `/img/${a.keys.member}/profile?space=${a.ids.open}`, { cookie })).status, 200);
    assert.equal((await A.call('GET', `/img/${a.keys.member}/profile?space=${a.ids.closed}`, { cookie })).status, 404, 'asked through a closed space');
    assert.equal((await A.call('GET', `/img/${a.keys.outsider}/profile`, { cookie })).status, 404, 'a person in no open space');
    assert.equal((await A.call('GET', '/img/nosuchkey/profile', { cookie })).status, 404);
    assert.equal((await A.call('GET', `/img/space/${a.ids.closed}`, { cookie })).status, 404);
    assert.ok([200, 404].includes((await A.call('GET', `/img/space/${a.ids.open}`, { cookie })).status), 'the open one: its picture or none');
    assert.equal((await A.call('GET', `/img/${a.keys.member}/profile`)).status, 403, 'no cookie');
  });

  await test('a call: the guest asks for a space they may enter; the others are no such space', async () => {
    const cookie = sam.cookie;
    assert.equal((await A.call('POST', '/api/call/join', { cookie, body: { space: a.ids.closed } })).status, 404);
    assert.equal((await A.call('POST', '/api/call/join', { cookie, body: { space: 'lobby' } })).status, 404);
    assert.equal((await A.call('POST', '/api/call/join', { cookie, body: {} })).status, 404, 'says which');
    const open = await A.call('POST', '/api/call/join', { cookie, body: { space: a.ids.open } });
    assert.ok([200, 403, 503].includes(open.status), `open: ${open.status} ${open.text}`);
    assert.equal((await A.call('POST', '/api/call/join', { body: { space: a.ids.open } })).status, 401);
  });

  // Server E: the host's switch on and no space open to guests yet; the owner has no switch of their own.
  const E = await startServer('empty', { ENABLE_GUEST_DOOR: 'true', TERMS_FILE: TERMS });
  const e = await seed(E, true);
  await E.call('PATCH', `/api/spaces/${e.ids.open}`, { token: e.admin, body: { entry: 'invited' } });
  await test('host on, no space open to guests: the button shows, a guest gets into nothing and is told so; opening a space lets them in with no owner step; closing it shuts it', async () => {
    assert.equal((await E.call('GET', '/api/branding')).json.guestDoor, true, 'the button still shows');
    assert.equal((await E.call('GET', '/api/settings', { token: e.admin })).json.settings.guestDoorOpen, false, 'the owner is told no space is open');
    const entered = await enterDoor(E, 'Nina');
    assert.equal(entered.status, 201, entered.text);
    const cookie = entered.cookie;
    const home = await E.call('GET', '/api/guest-door', { cookie });
    assert.equal(home.status, 200);
    assert.deepEqual(home.json.spaces, [], 'no spaces');
    assert.equal(home.json.none, 'No spaces are open to guests at this time.');
    for (const id of [...Object.values(e.ids), 'lobby']) {
      assert.equal((await E.call('POST', '/api/call/join', { cookie, body: { space: id } })).status, 404, `${id}: no such space`);
      assert.ok([401, 403, 404].includes((await E.call('GET', `/api/spaces/${id}/chat`, { cookie })).status), `${id}: chat refused`);
    }
    // The owner opens a space: Who can enter, Anyone including guests. Nothing else is needed.
    assert.equal((await E.call('PATCH', `/api/spaces/${e.ids.open}`, { token: e.admin, body: { entry: 'guests' } })).status, 200);
    assert.equal((await E.call('GET', '/api/settings', { token: e.admin })).json.settings.guestDoorOpen, true);
    const after = await E.call('GET', '/api/guest-door', { cookie });
    assert.deepEqual(after.json.spaces.map((x) => x.id), [e.ids.open]);
    assert.equal((await E.call('GET', `/api/spaces/${e.ids.open}/chat`, { cookie })).status, 200, 'in');
    assert.notEqual((await E.call('GET', `/api/spaces/${e.ids.accounts}/chat`, { cookie })).status, 200, 'a space open to accounts only: not for a guest');
    assert.notEqual((await E.call('GET', `/api/spaces/${e.ids.closed}/chat`, { cookie })).status, 200, 'a closed one: not for a guest');
    assert.notEqual((await E.call('GET', '/api/spaces/lobby/chat', { cookie })).status, 200, 'never the Lobby');
    assert.equal((await E.call('PATCH', `/api/spaces/${e.ids.open}`, { token: e.admin, body: { entry: 'accounts' } })).status, 200);
    assert.notEqual((await E.call('GET', `/api/spaces/${e.ids.open}/chat`, { cookie })).status, 200, 'closed again: shut at once');
    assert.deepEqual((await E.call('GET', '/api/guest-door', { cookie })).json.spaces, []);
  });

  await test('#743: a door guest asks to enter; the owner approves and the guest can enter (their next read shows it open); withdrawing an approved request is a plain 404 and changes nothing; a denial shows as an answer', async () => {
    const asked = await E.call('POST', '/api/spaces', { token: e.admin, body: { name: 'Askable', members: [] } });
    const id = asked.json.space.id;
    assert.equal((await E.call('PATCH', `/api/spaces/${id}`, { token: e.admin, body: { entry: 'invited', requestAccess: true } })).status, 200);
    const cookie = (await enterDoor(E, 'Ria')).cookie;
    const stateOf = async () => (await E.call('GET', '/api/guest-door', { cookie })).json.spaces.find((s) => s.id === id);
    assert.equal((await stateOf()).state, 'request');
    assert.equal((await E.call('POST', `/api/spaces/${id}/request`, { cookie })).status, 201);
    assert.equal((await stateOf()).state, 'pending');
    assert.notEqual((await E.call('GET', `/api/spaces/${id}/chat`, { cookie })).status, 200, 'not in yet');
    const list = (await E.call('GET', `/api/spaces/${id}/access-requests`, { token: e.admin })).json.requests;
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Ria (Guest)', 'the owner reads the name once marked');
    assert.equal((await E.call('POST', `/api/spaces/${id}/access-requests/${list[0].id}`, { token: e.admin, body: { decision: 'approve' } })).status, 200);
    assert.equal((await stateOf()).state, 'open', 'the next read of the landing shows it open');
    assert.equal((await E.call('GET', `/api/spaces/${id}/chat`, { cookie })).status, 200, 'the guest can enter');
    const withdraw = await E.call('DELETE', `/api/spaces/${id}/request`, { cookie });
    assert.equal(withdraw.status, 404, 'nothing to take back once approved');
    assert.equal((await stateOf()).state, 'open', 'still open after Withdraw');
    // A denial
    const denied = (await E.call('POST', '/api/spaces', { token: e.admin, body: { name: 'Declined', members: [] } })).json.space.id;
    await E.call('PATCH', `/api/spaces/${denied}`, { token: e.admin, body: { entry: 'invited', requestAccess: true } });
    assert.equal((await E.call('POST', `/api/spaces/${denied}/request`, { cookie })).status, 201);
    const dl = (await E.call('GET', `/api/spaces/${denied}/access-requests`, { token: e.admin })).json.requests;
    assert.equal((await E.call('POST', `/api/spaces/${denied}/access-requests/${dl[0].id}`, { token: e.admin, body: { decision: 'deny' } })).status, 200);
    const after = (await E.call('GET', '/api/guest-door', { cookie })).json.spaces.find((s) => s.id === denied);
    assert.deepEqual([after.state, after.answer], ['request', 'denied']);
    assert.notEqual((await E.call('GET', `/api/spaces/${denied}/chat`, { cookie })).status, 200);
  });

  await test('Set up\'s entry choices: a space switched back to invited-only shuts at once', async () => {
    const cookie = sam.cookie;
    const extra = await (async () => { const r = await A.call('POST', '/api/spaces', { token: a.admin, body: { name: 'Flip', members: [] } }); await A.call('PATCH', `/api/spaces/${r.json.space.id}`, { token: a.admin, body: { entry: 'guests' } }); return r.json.space.id; })();
    assert.equal((await A.call('GET', `/api/spaces/${extra}/chat`, { cookie })).status, 200);
    await A.call('PATCH', `/api/spaces/${extra}`, { token: a.admin, body: { entry: 'accounts' } });
    assert.ok([401, 403, 404].includes((await A.call('GET', `/api/spaces/${extra}/chat`, { cookie })).status));
    assert.equal((await A.call('GET', '/api/guest-door', { cookie })).json.spaces.some((s) => s.id === extra), false);
  });

  await test('the new session limit: 5 in 15 minutes from one address, then 429', async () => {
    // Sam, Tess are two; three more fit, the next is refused. Refusals (a name, a version) do not count.
    for (const nm of ['Ann', 'Bo', 'Cy']) assert.equal((await enterDoor(A, nm)).status, 201, nm);
    const sixth = await enterDoor(A, 'Di');
    assert.equal(sixth.status, 429);
    assert.match(sixth.json.error, /Too many/);
    assert.equal(sixth.cookie, null);
  });

  await test('expiry, the epoch, a changed text and the door switch end a session', async () => {
    const secret = A.secret();
    const forge = (over) => `guest_session=${door.issue(secret, { slug: '', id: 'guest-forged01', name: 'Forge', versions: { terms: termsVersion }, epoch: 0, ...over })}`;
    assert.equal((await A.call('GET', '/api/guest-door', { cookie: forge({}) })).status, 200, 'the forged-but-valid control');
    assert.equal((await A.call('GET', '/api/guest-door', { cookie: forge({ at: Date.now() - 25 * 3600000 }) })).status, 401, 'expired');
    assert.equal((await A.call('GET', '/api/guest-door', { cookie: forge({ epoch: 3 }) })).status, 401, 'another epoch');
    const old = forge({ versions: { terms: '1'.repeat(16) } });
    const stale = await A.call('GET', '/api/guest-door', { cookie: old });
    assert.equal(stale.status, 403, 'an old text asks again');
    assert.equal(stale.json.agreementRequired, true);
    const page = await A.call('GET', '/guest', { cookie: old, headers: { accept: 'text/html' } });
    assert.equal(page.status, 302);
    assert.match(page.headers.get('location'), /^\/agree\?next=/);
    assert.equal((await A.call('POST', '/api/guest-door', { cookie: old, body: { name: 'Sam', versions: { terms: termsVersion } } })).status, 429, 'the door itself stays open to a stale session (limited by address now)');
    // end-all (owner): every session of this environment
    assert.equal((await A.call('POST', '/api/guest-door/end-all', { cookie: sam.cookie })).status, 401, 'a guest cannot');
    assert.equal((await A.call('POST', '/api/guest-door/end-all', { token: a.admin })).status, 200);
    assert.equal((await A.call('GET', '/api/guest-door', { cookie: sam.cookie })).status, 401, 'ended by the epoch');
    assert.equal((await A.call('GET', '/api/guest-door', { cookie: forge({ epoch: 1 }) })).status, 200, 'a session of the new epoch reads');
    // The host's switch off: every session stops reading, even a validly signed one (server O has no ENABLE_GUEST_DOOR).
    const lateCookie = `guest_session=${door.issue(O.secret(), { slug: '', id: 'guest-late0001', name: 'Late (Guest)', versions: { terms: termsVersion }, epoch: 0 })}`;
    assert.equal((await O.call('GET', '/api/guest-door', { cookie: lateCookie })).status, 401, 'host off: a signed session reads as nobody');
  });

  await test('signing out of the door clears the cookie and the session is not the account\'s', async () => {
    const secret = A.secret();
    const cookie = `guest_session=${door.issue(secret, { slug: '', id: 'guest-bye00001', name: 'Bye', versions: { terms: termsVersion }, epoch: 1 })}`;
    const r = await A.call('DELETE', '/api/guest-door', { cookie });
    assert.equal(r.status, 200);
    assert.match(r.setCookie.find((c) => c.startsWith('guest_session=')), /guest_session=;|Expires=Thu, 01 Jan 1970/);
  });

  await test('the write guard: a guest\'s write from another site is refused', async () => {
    const r = await A.call('POST', '/api/guest-door', { body: { name: 'X', versions: { terms: termsVersion } }, cookie: 'guest_session=x', headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(r.status, 403);
  });

  await test('a guest link: the address limit and the texts count, a pass carries its versions and runs out', async () => {
    const link = await A.call('POST', `/api/spaces/${a.ids.closed}/guest-link`, { token: a.admin, body: {} });
    assert.equal(link.status, 200, link.text);
    const token = link.json.guestUrl.split('/guest/')[1];
    // five sessions already came from this address; the link's guest-join is limited the same way
    const blocked = await A.call('POST', '/api/guest-join', { body: { token, name: 'Link', versions: { terms: termsVersion } } });
    assert.equal(blocked.status, 429);
  });

  // Server B: bigger address limit, small caps, no texts.
  B = await startServer('b', { ENABLE_GUEST_DOOR: 'true', GUEST_DOOR_PER_ADDRESS: '100', GUESTS_PER_SPACE: '2', GUESTS_PER_ENVIRONMENT: '4', GUEST_SESSION_HOURS: '2' });
  const b = await seed(B);
  await B.call('PATCH', '/api/settings', { token: b.admin, body: { guestDoor: true } });
  const enterB = (name) => B.call('POST', '/api/guest-door', { body: { name } });
  await test('no texts set: the door needs only a name', async () => {
    const r = await enterB('NoTexts');
    assert.equal(r.status, 201, r.text);
    assert.equal((await B.call('GET', '/api/agreements')).json.mode, 'guest');
    assert.match(r.setCookie.find((c) => c.startsWith('guest_session=')), /Max-Age=7200/, 'GUEST_SESSION_HOURS');
    assert.equal(fs.existsSync(path.join(B.dataDir, 'agreements.json')), false, 'nothing recorded when there is nothing to agree to');
  });
  await test('caps: GUESTS_PER_SPACE on the stream and the call, GUESTS_PER_ENVIRONMENT at the door', async () => {
    const g = [];
    for (const nm of ['G1', 'G2', 'G3']) { const r = await enterB(nm); assert.equal(r.status, 201, `${nm} ${r.text}`); g.push(r.cookie); }
    // NoTexts + G1..G3 = 4 here now (the environment cap)
    const full = await enterB('G4');
    assert.equal(full.status, 403);
    assert.match(full.json.error, /as many guests as it can take/);
    // the space cap of 2: two guests join, a third is refused
    const live = `/api/live?space=${b.ids.open}`;
    const ctl = [];
    const hold = async (cookie) => {
      const c = new AbortController();
      ctl.push(c);
      const res = await fetch(`http://127.0.0.1:${B.port}${live}`, { headers: { cookie }, signal: c.signal });
      return res.status;
    };
    assert.equal(await hold(g[0]), 200);
    assert.equal(await hold(g[1]), 200);
    assert.equal(await hold(g[2]), 403, 'the third guest in a space of two');
    const call3 = await B.call('POST', '/api/call/join', { cookie: g[2], body: { space: b.ids.open } });
    assert.equal(call3.status, 403);
    assert.match(call3.json.error, /as many guests/);
    for (const c of ctl) c.abort();
    // a guest already in is not refused on a second stream (their own tab)
    const ctl2 = new AbortController();
    const again = await fetch(`http://127.0.0.1:${B.port}${live}`, { headers: { cookie: g[0] }, signal: ctl2.signal });
    assert.equal(again.status, 200);
    ctl2.abort();
  });
  await test('a signed-in person cannot use the door', async () => {
    const r = await B.call('POST', '/api/guest-door', { token: b.admin, body: { name: 'Zed' } });
    assert.equal(r.status, 409);
  });

  // Server C: texts, a big address limit: a guest link's guests.
  const C = await startServer('c', { TERMS_FILE: TERMS, GUEST_DOOR_PER_ADDRESS: '100' });
  const c = await seed(C, true);
  await test('a guest link: the texts, the name rule, a pass that carries its versions, runs out and ends with the epoch', async () => {
    const link = await C.call('POST', `/api/spaces/${c.ids.closed}/guest-link`, { token: c.admin, body: {} });
    assert.equal(link.status, 200, link.text);
    const token = link.json.guestUrl.split('/guest/')[1];
    const join = (over) => C.call('POST', '/api/guest-join', { body: { token, name: 'Link', versions: { terms: termsVersion }, ...over } });
    const bare = await C.call('POST', '/api/guest-join', { body: { token, name: 'Link' } });
    assert.equal(bare.status, 403);
    assert.equal(bare.json.agreementRequired, true);
    assert.equal((await join({ versions: { terms: '2'.repeat(16) } })).status, 409);
    const same = await join({ name: 'Mia Member' });
    assert.equal(same.status, 200, 'a member\'s name is no longer refused: the mark tells them apart');
    assert.equal(same.json.guest.name, 'Mia Member (Guest)');
    assert.equal((await join({ name: 'Link (guest)' })).json.guest.name, 'Link (Guest)', 'never doubled');
    const ok = await join({});
    assert.equal(ok.status, 200, ok.text);
    const pass = ok.json.guest.pass;
    const records = JSON.parse(fs.readFileSync(path.join(C.dataDir, 'agreements.json'), 'utf8')).agreements.filter((r) => r.guest === ok.json.guest.id);
    assert.equal(records.length, 1, 'the link guest\'s agreement is recorded too');
    const q = (p) => `/api/live?space=${c.ids.closed}&guest=${token}&pass=${encodeURIComponent(p)}`;
    assert.equal(await streamStatus(C, q(pass)), 200);
    assert.equal(await streamStatus(C, `/api/live?space=${c.ids.closed}&guest=${token}`), 403, 'no pass');
    assert.equal(await streamStatus(C, `/api/live?space=${c.ids.open}&guest=${token}&pass=${encodeURIComponent(pass)}`) >= 400, true, 'another space');
    // forged passes with the install's own key: a control, an expired one, an old epoch and a pass of older texts
    const keyHex = fs.readFileSync(path.join(C.dataDir, 'secrets.key'), 'utf8').trim();
    const passKey = crypto.createHmac('sha256', Buffer.from(keyHex, 'hex')).update('pass').digest();
    const forge = (over) => {
      const what = Buffer.from(JSON.stringify({ id: 'guest-forged02', name: 'F', t: Date.now(), v: { terms: termsVersion }, e: 0, ...over })).toString('base64url');
      return `${what}.${crypto.createHmac('sha256', passKey).update(`\n${token}\n${what}`).digest('base64url')}`;
    };
    assert.equal(await streamStatus(C, q(forge({}))), 200, 'the forged control reads');
    assert.equal(await streamStatus(C, q(forge({ t: Date.now() - 25 * 3600000 }))), 403, 'expired');
    assert.equal(await streamStatus(C, q(forge({ e: 7 }))), 403, 'another epoch');
    assert.equal(await streamStatus(C, q(forge({ v: { terms: '3'.repeat(16) } }))), 403, 'older texts');
    assert.equal(await streamStatus(C, q(forge({ v: undefined, t: undefined }))), 403, 'a pass without them: enter again');
    // pictures: only people in the link's space
    const pic = (key) => C.call('GET', `/img/${key}/profile?guest=${token}&pass=${encodeURIComponent(pass)}`);
    assert.equal((await pic(c.keys.member)).status, 200);
    assert.equal((await pic(c.keys.outsider)).status, 404);
    // the epoch ends link passes too
    assert.equal((await C.call('POST', '/api/guest-door/end-all', { token: c.admin })).status, 200);
    assert.equal(await streamStatus(C, q(pass)), 403);
  });

  // --- 3. the enumeration -----------------------------------------------------------------------------------------
  // Every route index.js registers with app.<method>('...'), asked by a guest from the door (cookie, ?space= of the open
  // space) with the owner's other settings at their defaults. Nothing answers 2xx but what is listed here, with the status.
  const source = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  const routes = [...source.matchAll(/^\s*app\.(get|post|put|patch|delete)\(\s*'([^']+)'/gm)].map((m) => ({ method: m[1].toUpperCase(), route: m[2] }));
  // [method route] -> the statuses a door guest may get. Everything not here must be 3xx/4xx/5xx.
  const PUBLIC = {
    'GET /api/branding': [200], 'GET /api/agreements': [200], 'GET /healthz': [200], 'POST /api/login': [400, 401, 429], 'POST /api/logout': [200],
    'GET /api/guest-link/:token': [404], 'POST /api/guest-join': [404], 'GET /api/product': [200, 404], 'GET /api/version': [200],
    'GET /api/config': [200], 'GET /api/objects/format': [200], 'GET /api/objects/format/schema': [200],
    // Pages and files that hold nothing of anyone's: the sign-in and agreement pages, the guest landing, the shells.
    'GET /design-system/module-sources.js': [200], 'GET /guest': [200], 'GET /guest/:token': [200], 'GET /login': [200], 'GET /login/verify': [200],
    'GET /login/enrol': [200], 'GET /agree': [200], 'GET /register': [200], 'GET /invite/:token': [200], 'GET /img/site/icon': [200], 'GET /favicon.ico': [200],
    'GET /manifest.webmanifest': [200], 'GET /theme.css': [200],
  };
  const GUEST_ROUTES = {
    'GET /api/guest-door': [200], 'POST /api/guest-door': [201, 400, 403, 409, 429], 'DELETE /api/guest-door': [200],
    'GET /api/spaces/:id/chat': [200], 'POST /api/spaces/:id/chat': [200, 400, 429], 'GET /api/live': [200],
    'GET /api/presence': [200], 'POST /api/call/join': [200, 403, 404, 503],
    // What a guest link's guest reaches the same way (through moduleViewer, the space asked for being one the guest may
    // enter), each answering the guest role's share: read-only lists, the guest's refusals ("Guests can't use AI"), or nothing.
    'GET /api/spaces/:id/tags': [200], 'GET /api/spaces/:id/layouts': [200], 'GET /api/spaces/:id/ai': [200], 'GET /api/spaces/:id/objects/check': [200],
    'GET /api/spaces/:id/actions': [200], 'POST /api/objects/resolve': [200], 'POST /api/chat/citations': [200], 'GET /api/objects/kinds': [200],
    'GET /api/modules/nav': [200], 'GET /api/modules/widgets': [200], 'GET /api/destinations': [200], 'GET /api/modules/for-space': [200],
    'GET /api/modules/stream': [200, 0], 'GET /modules/:id': [200],
    'GET /img/:key/:slot': [200, 404], 'GET /img/space/:id': [200, 404], 'GET /img/guest/:slot': [200, 404], 'GET /img/default/:slot': [200, 404],
  };
  await test('the enumeration: no route a door guest can reach but the ones named', async () => {
    const secret = B.secret();
    const cookie = `guest_session=${door.issue(secret, { slug: '', id: 'guest-enum0001', name: 'Enum', versions: {}, epoch: 0 })}`;
    const open = b.ids.open;
    const surprises = [];
    const seen = [];
    for (const { method, route } of routes) {
      if (route === '/api/live') continue; // a stream: asked above
      const url = route
        .replace(/:id\b/, route.startsWith('/api/spaces/') ? open : 'nosuch')
        .replace(/:key\b/, b.keys.member)
        .replace(/:slot\b/, 'profile')
        .replace(/:[A-Za-z]+/g, 'x');
      const sep = url.includes('?') ? '&' : '?';
      const r = await B.call(method, `${url}${sep}space=${open}`, { cookie, body: ['GET', 'DELETE'].includes(method) ? undefined : {} });
      seen.push(`${method} ${route} -> ${r.status}`);
      const key = `${method} ${route}`;
      const allowed = GUEST_ROUTES[key] || PUBLIC[key];
      if (allowed) { if (!allowed.includes(r.status)) surprises.push(`${key}: ${r.status} not in ${allowed}`); continue; }
      if (r.status < 300 || r.status === 304) surprises.push(`${key}: ${r.status} ${r.text.slice(0, 80)}`);
    }
    assert.ok(routes.length > 200, `read ${routes.length} routes`);
    assert.deepEqual(surprises, [], `a door guest reached routes that are not named:\n${surprises.join('\n')}`);
    fs.writeFileSync(path.join(tmp, 'enumeration.txt'), seen.join('\n'));
  });
  await test('the same routes with no session at all: only the public ones answer', async () => {
    const open = b.ids.open;
    const surprises = [];
    for (const { method, route } of routes) {
      if (route === '/api/live') continue;
      const key = `${method} ${route}`;
      if (PUBLIC[key]) continue;
      const url = route.replace(/:id\b/, route.startsWith('/api/spaces/') ? open : 'nosuch').replace(/:key\b/, b.keys.member).replace(/:slot\b/, 'profile').replace(/:[A-Za-z]+/g, 'x');
      const r = await B.call(method, `${url}${url.includes('?') ? '&' : '?'}space=${open}`, { body: ['GET', 'DELETE'].includes(method) ? undefined : {} });
      // Pages, files and the like are outside /api and /img; the API and the pictures must refuse.
      if ((route.startsWith('/api/') || route.startsWith('/img/')) && r.status < 300 && !['GET /api/guest-door', 'DELETE /api/guest-door', 'POST /api/guest-door', 'GET /img/site/icon', 'GET /img/site/background'].includes(key)) surprises.push(`${key}: ${r.status}`);
    }
    assert.deepEqual(surprises.filter((s) => !/^(GET \/api\/(config|destinations|modules\/(nav|widgets)|product|agreements|branding|version|status|templates|currencies|words|oembed|geocode|preview)|POST \/api\/(register|signup|invite|first|billing|webhooks?|product))/.test(s)), [], 'unnamed routes answered a stranger');
  });
} catch (err) {
  failed += 1;
  console.error(err.stack || err);
} finally {
  await stopAll();
  standIn.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (failed) { console.error(`check-guest-door: ${failed} failed, ${n} passed`); process.exit(1); }
console.log(`check-guest-door: ${n} passed`);
