#!/usr/bin/env node
/*
 * check-first-password.mjs -- sign-up with no password, and the owner's first password chosen on the new environment's
 * own page through a one-time link (documentation/plans/plan-first-password.md). A real hosted server (BASE_DOMAIN and
 * SIGNUP=on) on a throwaway DATA_DIR, reached by Host header, plus a single-environment server:
 *   - sign-up refuses a posted password (400), a login of only spaces (400), an owner login or name that is not text
 *     (400), and an environment name that is not text (400), and leaves no environment and no folder behind;
 *   - a folder already on disk for the address with no registry entry (left behind) is refused as taken (409, the same
 *     answer), the address check says taken, and the folder is never touched: no data lost, none taken over, nothing added;
 *     it answers 201 with Cache-Control: no-store and <scheme>://<slug>.<base>:<port>/login/first-password#<43 characters>,
 *     with no login and no query in the address; only the token's SHA-256 is kept;
 *   - before the first password every other way in is shut: POST /api/login (as an unknown login, any password), a
 *     personal link, an invite, a guest link, /api/register (even with self sign-up on), the two-step routes;
 *   - the exchange (POST /api/login/first-password) works once; a used, random, empty, missing, malformed, other-type,
 *     text/plain, ended or other environment's token gets the same 401 and sentence; two at once: exactly one wins;
 *     failures count on the sign-in limit (429), shared with wrong passwords; a restart keeps the token working;
 *   - the set step (POST /api/login/first-password/set) needs the exchange's own pending cookie: none, another
 *     environment's, an enrol or verify one, or one from an older claim is 401; and the login the page names (`login`,
 *     compared cleaned): another owner's, none, or one that is not text is the same 401, counted on the sign-in limit;
 *     the password is 8 to 200 characters
 *     (400); then it signs in, or with a second step required, starts enrolment and gives no session;
 *   - after the password is set the token and the pending cookie are dead and POST /api/login works;
 *   - each use of a link is its own random claim: a step from an older claim never finishes a newer one, even when both
 *     were claimed in the same millisecond;
 *   - a first-password pending cookie opens neither the enrolment nor the verify step;
 *   - a cross-site POST with a cookie is refused (403), and a text/plain body is not read;
 *   - the token is never in the server's output, in clear in any file under DATA_DIR, or in any later answer (/api/me,
 *     /api/users, the console's list, the owner's export); the export leaves out its hash too, the host backup keeps it;
 *   - GET /login/first-password never redirects, signed in or not, and carries no-store, no-referrer and the
 *     framed-here headers, however the path is written (case, a trailing slash), as do the sign-in pages;
 *   - the page's file is never served by its file name (/login-first-password.html, however written): 404 everywhere,
 *     on an environment, the console, the product host and a single-environment install;
 *   - the console's list names the owners still waiting for their first password (awaitingFirstPassword, logins only);
 *   - the console's "New first-password link" (POST /api/host/environments/:slug/owners/:login/first-password): host
 *     admin only, refuses an owner with a password, lives 24 hours, used once, and ends any older link and any step
 *     begun from it;
 *   - without BASE_DOMAIN none of this exists: the new paths answer exactly as an unknown path does.
 * The page itself (public/login-first-password.html) is step 2 of the plan: until it exists, the page route answers 404
 * and this check says so on one line instead of asserting 200.
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

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auth = require('../server/auth.js');
const yauzl = require('yauzl');

const HOST_LOGIN = 'boss';
const HOST_PASSWORD = 'check-first-password-host-1';
const DEAD = 'This link has expired or was already used. Ask whoever runs this host for a new one.';
const NO_PASSWORD = "Sign-up takes no password. You choose it on your new environment's own page.";
const NO_LOGIN = "Sign-up needs the owner's login.";
const NO_NAME = "The owner's name must be text.";
const NO_ENV_NAME = "The environment's name must be text.";
const { Store } = require('../server/store.js');
const ORIGIN_SENTENCE = 'This request came from another site, so it was refused.';
const PAGE_BUILT = fs.existsSync(path.join(ROOT, 'public', 'login-first-password.html'));

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-first-password: ${name}: ${err.stack || err.message}`); }
};
// The page's file asked for by its file name, however written.
const FILE_PATHS = ['/login-first-password.html', '/Login-First-Password.HTML', '/LOGIN-FIRST-PASSWORD.HTML', '/login-first-password.html/', '/login-first-password.html?x=1', '//login-first-password.html', '/login-first-password%2ehtml', '/login-first-password%2Ehtml', '/%6Cogin-first-password.html', '/./login-first-password.html', '/login/../login-first-password.html'];
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// --- unit: the pending step names its purpose and its claim ---------------------------------------------------
await test('a pending token is read only for its own purpose, environment and claim', () => {
  const secret = crypto.randomBytes(32).toString('base64url');
  const fp = auth.issuePending(secret, { userKey: 'abcd1234', env: 'one', purpose: 'first-password', claim: '2026-01-01T00:00:00.000Z' });
  assert.equal(auth.readPending(secret, fp, { env: 'one', purpose: 'first-password' }).c, '2026-01-01T00:00:00.000Z');
  assert.equal(auth.readPending(secret, fp, { env: 'two', purpose: 'first-password' }), null, 'another environment');
  for (const purpose of ['enrol', 'verify']) {
    assert.equal(auth.readPending(secret, fp, { env: 'one', purpose }), null, `a first-password step is not a ${purpose} step`);
    const other = auth.issuePending(secret, { userKey: 'abcd1234', env: 'one', purpose });
    assert.equal(auth.readPending(secret, other, { env: 'one', purpose: 'first-password' }), null, `a ${purpose} step is not a first-password step`);
  }
  assert.equal(auth.readPending(crypto.randomBytes(32).toString('base64url'), fp, { env: 'one', purpose: 'first-password' }), null, 'another secret');
  const t = auth.oneTimeToken();
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(auth.tokenHash(t), sha256(t));
  assert.equal(auth.tokenHash(undefined), sha256(''), 'anything that is not a string hashes as the empty string');
});

// --- unit: each use of a link is its own random claim ------------------------------------------------------------
await test('a claim is random: a step from an older claim made in the same millisecond cannot finish a newer one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-first-password-store-'));
  try {
    const store = new Store(dir);
    const ends = new Date(Date.now() + 3600000).toISOString();
    const t1 = auth.oneTimeToken();
    const owner = store.addUser({ login: 'claimer', displayName: 'Claimer', role: 'owner', passwordHash: null, firstPassword: { hash: auth.tokenHash(t1), expiresAt: ends } });
    const now = Date.now();
    const one = store.claimFirstPassword(auth.tokenHash(t1), now);
    assert.ok(one, 'the first link is claimed');
    assert.match(String(one.claim), /^[0-9a-f]{32}$/, 'the claim is 128 random bits');
    assert.ok(!store.claimFirstPassword(auth.tokenHash(t1), now), 'a link is claimed once');
    // A newer link, claimed in the very same millisecond: the older claim must not finish it.
    const t2 = auth.oneTimeToken();
    store.setFirstPassword(owner.key, { hash: auth.tokenHash(t2), expiresAt: ends });
    const two = store.claimFirstPassword(auth.tokenHash(t2), now);
    assert.ok(two, 'the newer link is claimed');
    assert.notEqual(two.claim, one.claim, 'two claims in one millisecond differ');
    assert.equal(store.userByKey(owner.key).firstPassword.claim, two.claim, 'the newer claim is the one kept');
    assert.equal(store.finishFirstPassword(owner.key, one.claim, 'scrypt$x'), null, 'the older claim finishes nothing');
    assert.equal(store.finishFirstPassword(owner.key, one.claimedAt, 'scrypt$x'), null, 'nor does the claim time');
    assert.equal(store.finishFirstPassword(owner.key, undefined, 'scrypt$x'), null, 'nor does no claim');
    assert.ok(!store.userByKey(owner.key).passwordHash, 'no password yet');
    assert.ok(store.finishFirstPassword(owner.key, two.claim, 'scrypt$x'), 'the newer claim finishes it');
    assert.equal(store.userByKey(owner.key).firstPassword, undefined, 'and the link is gone');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- the server ----------------------------------------------------------------------------------------------------
async function startServer(dataDir, env) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 25000);
    const look = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', look);
    child.stderr.on('data', look);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  return { port, output: () => out, stop: () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); }) };
}

let server = null;
let ip = 0;
const nextIp = () => { ip += 1; return `198.51.100.${ip}`; };
// One request as `host` (a subdomain of localhost, or '' for the product host, the bare base). `from`: the address the
// one trusted proxy saw (X-Forwarded-For), so each test has its own count on the limits.
function call(host, method, urlPath, { body, type = 'application/json', cookie, bearer, from = '192.0.2.1', headers = {}, srv = server, base = 'localhost' } = {}) {
  const payload = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const h = { host: `${host ? `${host}.` : ''}${base}:${srv.port}`, accept: 'application/json', 'x-forwarded-for': from, ...headers };
  if (payload) { h['content-type'] = type; h['content-length'] = payload.length; }
  if (cookie) h.cookie = cookie;
  if (bearer) h.authorization = `Bearer ${bearer}`;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, method, path: urlPath, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(raw.toString('utf8')); } catch { json = null; }
        const setCookies = [].concat(res.headers['set-cookie'] || []);
        // name -> value, the last one set winning; a cleared cookie reads as ''.
        const jar = {};
        for (const c of setCookies) { const [pair] = c.split(';'); const eq = pair.indexOf('='); jar[pair.slice(0, eq)] = /expires=Thu, 01 Jan 1970/i.test(c) ? '' : pair.slice(eq + 1); }
        resolve({ status: res.statusCode, headers: res.headers, raw, text: raw.toString('utf8'), json, setCookies, jar });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const tokens = []; // every token handed out, for the leak checks at the end
async function signup(slug, login = `own${slug}`, extra = {}) {
  const res = await call('', 'POST', '/api/product/signup', { body: { slug, name: `Env ${slug}`, owner: { login, displayName: `Owner ${slug}` }, ...extra }, from: nextIp() });
  const token = typeof res.json?.url === 'string' ? res.json.url.split('#')[1] || null : null;
  if (token) tokens.push(token);
  return { res, token };
}
const exchange = (slug, token, opts = {}) => call(slug, 'POST', '/api/login/first-password', { body: token === undefined ? {} : { token }, from: opts.from || nextIp(), ...opts });
const pendingOf = (r) => (r.jar.mfa_pending ? `mfa_pending=${r.jar.mfa_pending}` : null);
// The set step, sending the login the page names: `own<slug>` unless `login` says otherwise (null: none sent).
const setPassword = (slug, cookie, password, { login = `own${slug}`, ...opts } = {}) => call(slug, 'POST', '/api/login/first-password/set', { body: login === null ? { password } : { login, password }, cookie, from: opts.from || nextIp(), ...opts });
const isDead = (r) => r.status === 401 && r.json?.error === DEAD && Object.keys(r.json).length === 1;
async function hostCookie() {
  const res = await call('admin', 'POST', '/api/host/login', { body: { login: HOST_LOGIN, password: HOST_PASSWORD }, from: nextIp() });
  assert.equal(res.status, 200, `host sign-in: ${res.text}`);
  return res.setCookies.map((c) => c.split(';')[0]).join('; ');
}
// The host admin's own sign-in at an environment (the cross sign-in): a bearer token with an owner's rights there.
async function crossSignIn(slug) {
  const res = await call(slug, 'POST', '/api/login', { body: { login: HOST_LOGIN, password: HOST_PASSWORD }, from: nextIp() });
  assert.equal(res.status, 200, `cross sign-in at ${slug}: ${res.text}`);
  return res.json.token;
}
function unzipEntries(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const files = new Map();
      zip.on('error', reject);
      zip.on('end', () => resolve(files));
      zip.on('entry', (entry) => {
        if (entry.fileName.endsWith('/')) return zip.readEntry();
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) return reject(streamErr);
          const chunks = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('error', reject);
          stream.on('end', () => { files.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}
function filesUnder(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.lstatSync(full);
    if (st.isDirectory()) filesUnder(full, out);
    else if (st.isFile()) out.push(full);
  }
  return out;
}
const appJson = (dataDir, slug) => JSON.parse(fs.readFileSync(path.join(dataDir, 'environments', slug, 'app.json'), 'utf8'));
const ownerOnDisk = (dataDir, slug, login = `own${slug}`) => appJson(dataDir, slug).users.find((u) => u.login === login);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-first-password-'));
const hostedEnv = { BASE_DOMAIN: 'localhost', SIGNUP: 'on', ADMIN_LOGIN: HOST_LOGIN, ADMIN_PASSWORD: HOST_PASSWORD };
const laterAnswers = []; // texts of answers given after sign-up, searched for any token at the end
let ownerSession = null; // envA's owner, signed in at the end of the flow
try {
  server = await startServer(dataDir, hostedEnv);
  const host = await hostCookie();

  await test('sign-up refuses a posted password with 400 and makes nothing', async () => {
    for (const [what, extra] of [['owner.password', { owner: { login: 'pw', password: 'longenough123' } }], ['an empty owner.password', { owner: { login: 'pw', password: '' } }], ['a password beside the owner', { owner: { login: 'pw' }, password: 'longenough123' }]]) {
      const res = await call('', 'POST', '/api/product/signup', { body: { slug: 'withpw', name: 'With pw', ...extra }, from: nextIp() });
      assert.deepEqual([res.status, res.json], [400, { error: NO_PASSWORD }], what);
    }
    assert.deepEqual((await call('', 'GET', '/api/product/address?slug=withpw')).json, { slug: 'withpw', free: true, reason: null });
    assert.ok(!fs.existsSync(path.join(dataDir, 'environments', 'withpw')));
  });

  await test('sign-up with a login of only spaces, or none, is 400 and leaves no environment behind', async () => {
    for (const owner of [{ login: '    ' }, { login: '\t \n' }, {}, undefined, 'owner']) {
      const res = await call('', 'POST', '/api/product/signup', { body: { slug: 'spaces', name: 'Spaces', owner }, from: nextIp() });
      assert.deepEqual([res.status, res.json], [400, { error: NO_LOGIN }], JSON.stringify(owner));
    }
    assert.deepEqual((await call('', 'GET', '/api/product/address?slug=spaces')).json, { slug: 'spaces', free: true, reason: null });
    assert.ok(!fs.existsSync(path.join(dataDir, 'environments', 'spaces')), 'no folder');
    const list = await call('admin', 'GET', '/api/host/environments', { cookie: host });
    assert.ok(!list.json.environments.some((e) => e.slug === 'spaces'), 'not in the registry');
  });

  await test('sign-up with an owner login or name that is not text is 400 and makes nothing', async () => {
    for (const owner of [{ login: { a: 1 } }, { login: ['x'] }, { login: 12345 }, { login: true }, { login: 'fine', displayName: { a: 1 } }, { login: 'fine', displayName: ['x'] }, { login: 'fine', displayName: 7 }]) {
      const res = await call('', 'POST', '/api/product/signup', { body: { slug: 'nottext', name: 'Not text', owner }, from: nextIp() });
      const error = typeof owner.login === 'string' ? NO_NAME : NO_LOGIN;
      assert.deepEqual([res.status, res.json], [400, { error }], JSON.stringify(owner));
    }
    assert.deepEqual((await call('', 'GET', '/api/product/address?slug=nottext')).json, { slug: 'nottext', free: true, reason: null });
    assert.ok(!fs.existsSync(path.join(dataDir, 'environments', 'nottext')), 'no folder');
  });

  await test("sign-up with an environment name that is not text is 400 and makes nothing", async () => {
    for (const name of [{ toString: 1 }, { toString: null }, { a: 1 }, ['x'], ['a', 'b'], 12345, true]) {
      const res = await call('', 'POST', '/api/product/signup', { body: { slug: 'namenottext', name, owner: { login: 'fine' } }, from: nextIp() });
      assert.deepEqual([res.status, res.json], [400, { error: NO_ENV_NAME }], JSON.stringify(name));
    }
    assert.deepEqual((await call('', 'GET', '/api/product/address?slug=namenottext')).json, { slug: 'namenottext', free: true, reason: null });
    assert.ok(!fs.existsSync(path.join(dataDir, 'environments', 'namenottext')), 'no folder');
    const list = await call('admin', 'GET', '/api/host/environments', { cookie: host });
    assert.ok(!list.json.environments.some((e) => e.slug === 'namenottext'), 'not in the registry');
  });

  const A = await signup('alpha');
  const B = await signup('bravo');

  await test("a folder left on disk with no registry entry is refused as taken, and is never touched", async () => {
    // A leftover: an environment's folder with data in it, but no entry in the registry.
    const left = path.join(dataDir, 'environments', 'leftover');
    fs.mkdirSync(path.join(left, 'notes'), { recursive: true });
    fs.copyFileSync(path.join(dataDir, 'environments', 'alpha', 'app.json'), path.join(left, 'app.json'));
    fs.writeFileSync(path.join(left, 'notes', 'keep.txt'), 'old data');
    const empty = path.join(dataDir, 'environments', 'emptyleft');
    fs.mkdirSync(empty);
    const snapshot = (dir) => filesUnder(dir).map((f) => [path.relative(dir, f), fs.readFileSync(f, 'utf8')]).sort();
    const listing = (dir) => fs.readdirSync(dir).sort();
    const before = snapshot(left);
    const taken = await call('', 'POST', '/api/product/signup', { body: { slug: 'alpha', name: 'Again', owner: { login: 'someone' } }, from: nextIp() });
    assert.deepEqual([taken.status, taken.json], [409, { error: '"alpha" is already in use' }], 'the taken answer');
    // The same login as the old data's owner (addUser would refuse it), a new login (it would take the old data over),
    // and an empty leftover folder.
    const answers = [];
    for (const [slug, login] of [['leftover', 'ownalpha'], ['leftover', 'newperson'], ['emptyleft', 'newperson']]) {
      answers.push([slug, login, await call('', 'POST', '/api/product/signup', { body: { slug, name: 'Take over', owner: { login } }, from: nextIp() })]);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500)); // anything begun in the background has had its time
    assert.ok(fs.existsSync(left), 'the old folder is still there');
    assert.deepEqual(snapshot(left), before, 'the old data is untouched');
    assert.deepEqual(listing(left), ['app.json', 'notes'], 'nothing added beside it (no modules folder)');
    assert.deepEqual(listing(empty), [], 'the empty folder stays empty');
    for (const [slug, login, res] of answers) {
      assert.deepEqual([res.status, res.json], [409, { error: `"${slug}" is already in use` }], `${slug} as ${login}: ${res.text}`);
      assert.equal(res.headers['content-type'], taken.headers['content-type']);
    }
    assert.deepEqual((await call('', 'GET', '/api/product/address?slug=leftover')).json, { slug: 'leftover', free: false, reason: 'taken' });
    const list = await call('admin', 'GET', '/api/host/environments', { cookie: host });
    assert.ok(!list.json.environments.some((e) => ['leftover', 'emptyleft'].includes(e.slug)), 'not in the registry');
    fs.rmSync(left, { recursive: true });
    fs.rmSync(empty, { recursive: true });
  });

  await test('a refused sign-up leaves no folder behind, not even an empty modules folder, after the background work', async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    for (const slug of ['withpw', 'spaces', 'nottext']) assert.ok(!fs.existsSync(path.join(dataDir, 'environments', slug)), `${slug}: no folder`);
  });
  await test('sign-up answers the first-password link: the token in the fragment only, no-store, only its hash kept', async () => {
    for (const [slug, s] of [['alpha', A], ['bravo', B]]) {
      assert.equal(s.res.status, 201, s.res.text);
      assert.equal(s.res.headers['cache-control'], 'no-store');
      assert.match(s.res.json.url, new RegExp(`^http://${slug}\\.localhost:${server.port}/login/first-password#[A-Za-z0-9_-]{43}$`));
      assert.ok(!s.res.json.url.includes('login=') && !s.res.json.url.includes('?'), 'no login and no query');
      assert.deepEqual(Object.keys(s.res.json), ['url']);
      const owner = ownerOnDisk(dataDir, slug);
      assert.deepEqual([owner.role, owner.passwordHash, owner.linkToken, owner.mfa], ['owner', null, null, null]);
      assert.deepEqual(Object.keys(owner.firstPassword).sort(), ['expiresAt', 'hash']);
      assert.equal(owner.firstPassword.hash, sha256(s.token), 'the SHA-256 of the token');
      const left = Date.parse(owner.firstPassword.expiresAt) - Date.now();
      assert.ok(left > 14 * 60000 && left <= 15 * 60000, `15 minutes (${left} ms)`);
    }
    assert.notEqual(A.token, B.token);
  });

  await test('before the first password, POST /api/login fails for the owner as for an unknown login, whatever the password', async () => {
    const from = nextIp();
    const unknown = await call('alpha', 'POST', '/api/login', { body: { login: 'nobodyhere', password: 'x' }, from });
    assert.equal(unknown.status, 401);
    for (const password of ['', 'x', 'longenough123', undefined]) {
      const res = await call('alpha', 'POST', '/api/login', { body: { login: 'ownalpha', password }, from });
      assert.deepEqual([res.status, res.text], [unknown.status, unknown.text], `password ${JSON.stringify(password)}`);
      assert.ok(!res.jar.app_session && !res.jar.mfa_pending);
    }
  });

  await test('before the first password, no other way in: personal link, invite, guest link, self sign-up, the two-step routes', async () => {
    const bearer = await crossSignIn('alpha');
    const users = await call('alpha', 'GET', '/api/users', { bearer });
    laterAnswers.push(users.text);
    const owner = users.json.users.find((u) => u.login === 'ownalpha');
    assert.deepEqual([owner.hasPassword, owner.link, 'firstPassword' in owner], [false, null, false]);
    assert.equal((await call('alpha', 'GET', `/j/${crypto.randomBytes(24).toString('base64url')}`, { headers: { accept: 'text/html' } })).status, 404);
    assert.equal((await call('alpha', 'POST', `/api/invites/${crypto.randomBytes(24).toString('base64url')}/accept`, { body: { login: 'x', password: 'longenough123' } })).status, 404);
    const disk = appJson(dataDir, 'alpha');
    assert.deepEqual(disk.invites || [], [], 'no invite exists');
    assert.ok(disk.spaces.every((s) => !s.guestToken), 'no space has a guest link');
    // Self sign-up, even turned on, is refused while the owner has not arrived.
    const on = await call('alpha', 'PATCH', '/api/settings', { bearer, body: { allowRegistration: true } });
    assert.equal(on.status, 200, on.text);
    const reg = await call('alpha', 'POST', '/api/register', { body: { login: 'early', password: 'longenough123' }, from: nextIp() });
    assert.deepEqual([reg.status, reg.json], [403, { error: 'sign-up is turned off' }]);
    assert.ok(!appJson(dataDir, 'alpha').users.some((u) => u.login === 'early'));
    for (const [method, p] of [['POST', '/api/me/mfa/start'], ['POST', '/api/me/mfa/enable'], ['POST', '/api/login/verify']]) {
      const res = await call('alpha', method, p, { body: { code: '123456' }, from: nextIp() });
      assert.equal(res.status, 401, `${p}: ${res.text}`);
    }
  });

  let pendingA = null;
  await test('the exchange works once; a used, random, empty, missing, malformed or other-type token gets the same 401', async () => {
    const from = nextIp();
    const ok = await exchange('alpha', A.token, { from });
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(ok.json, { login: 'ownalpha', displayName: 'Owner alpha', environmentName: 'Env alpha' });
    assert.equal(ok.headers['cache-control'], 'no-store');
    pendingA = pendingOf(ok);
    assert.ok(pendingA, 'the pending cookie is set');
    const pc = ok.setCookies.find((c) => c.startsWith('mfa_pending='));
    assert.match(pc, /HttpOnly/i);
    assert.match(pc, /Max-Age=600/i);
    assert.ok(!/Domain=/i.test(pc), 'host-only');
    assert.ok(!ok.jar.app_session, 'no session yet');
    assert.ok(!ok.text.includes(ok.jar.mfa_pending), 'the pending token is not in the body');
    const owner = ownerOnDisk(dataDir, 'alpha');
    assert.deepEqual(Object.keys(owner.firstPassword).sort(), ['claim', 'claimedAt', 'expiresAt'], 'the hash is gone once used');
    assert.match(owner.firstPassword.claim, /^[0-9a-f]{32}$/, 'the claim is random');
    const answers = [];
    for (const token of [A.token, crypto.randomBytes(32).toString('base64url'), '', undefined, 'not a token', 12345, { token: A.token }, [A.token], null, A.token.slice(0, 42), `${A.token}x`, 'x'.repeat(5000)]) {
      answers.push([JSON.stringify(token)?.slice(0, 30), await exchange('alpha', token, { from: nextIp() })]);
    }
    for (const [what, r] of answers) {
      assert.ok(isDead(r), `${what}: ${r.status} ${r.text}`);
      assert.equal(r.text, answers[0][1].text, `${what}: the same body`);
      assert.ok(!r.jar.mfa_pending && !r.jar.app_session, `${what}: no cookie`);
    }
  });

  await test("a token from one environment is refused at another, and still works at its own", async () => {
    const atAlpha = await exchange('alpha', B.token);
    assert.ok(isDead(atAlpha), atAlpha.text);
    assert.equal(ownerOnDisk(dataDir, 'bravo').firstPassword.hash, sha256(B.token), 'not spent by the try');
    const atConsole = await call('admin', 'POST', '/api/login/first-password', { body: { token: B.token } });
    assert.notEqual(atConsole.status, 200);
    const atProduct = await call('', 'POST', '/api/login/first-password', { body: { token: B.token } });
    assert.equal(atProduct.status, 404);
    assert.equal(ownerOnDisk(dataDir, 'bravo').firstPassword.hash, sha256(B.token));
  });

  await test('a cross-site POST with a cookie is refused, and a text/plain body is not read', async () => {
    const cross = await call('bravo', 'POST', '/api/login/first-password', { body: { token: B.token }, cookie: 'x=1', headers: { origin: `http://alpha.localhost:${server.port}`, 'sec-fetch-site': 'same-site' } });
    assert.deepEqual([cross.status, cross.json], [403, { error: ORIGIN_SENTENCE }]);
    const plain = await call('bravo', 'POST', '/api/login/first-password', { body: JSON.stringify({ token: B.token }), type: 'text/plain' });
    assert.ok(isDead(plain), plain.text);
    const form = await call('bravo', 'POST', '/api/login/first-password', { body: `token=${B.token}`, type: 'application/x-www-form-urlencoded' });
    assert.ok(isDead(form), form.text);
    assert.equal(ownerOnDisk(dataDir, 'bravo').firstPassword.hash, sha256(B.token), 'still unused');
  });

  let pendingB = null;
  await test('two exchanges of one token sent together: exactly one wins', async () => {
    const both = await Promise.all([exchange('bravo', B.token), exchange('bravo', B.token), exchange('bravo', B.token)]);
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 401, 401], both.map((r) => r.text).join(' | '));
    pendingB = pendingOf(both.find((r) => r.status === 200));
    for (const r of both.filter((x) => x.status !== 200)) assert.ok(isDead(r));
  });

  await test('failures count on the sign-in limit: ten, then 429, even for the right token, shared with wrong passwords', async () => {
    const C = await signup('charlie');
    const from = nextIp();
    const seen = [];
    for (let i = 0; i < 5; i += 1) seen.push((await call('charlie', 'POST', '/api/login', { body: { login: 'owncharlie', password: `wrong${i}` }, from })).status);
    for (let i = 0; i < 5; i += 1) seen.push((await exchange('charlie', crypto.randomBytes(32).toString('base64url'), { from })).status);
    const held = await exchange('charlie', crypto.randomBytes(32).toString('base64url'), { from });
    seen.push(held.status);
    assert.deepEqual(seen, [...Array(10).fill(401), 429], String(seen));
    assert.equal(held.json.error, 'too many attempts, try again in a few minutes');
    const right = await exchange('charlie', C.token, { from });
    assert.equal(right.status, 429, 'the right token too, while the address is held');
    assert.equal(ownerOnDisk(dataDir, 'charlie').firstPassword.hash, sha256(C.token), 'not spent');
    const set = await setPassword('charlie', 'mfa_pending=x.y', 'longenough123', { from });
    assert.equal(set.status, 429, 'and the set step');
    assert.equal((await exchange('charlie', C.token, { from: nextIp() })).status, 200, 'another address uses it');
  });

  await test('the set step needs this exchange\'s own pending cookie', async () => {
    assert.ok(pendingA && pendingB, 'the exchanges above');
    for (const [what, cookie] of [['none', undefined], ['garbage', 'mfa_pending=abc.def'], ["another environment's", pendingB]]) {
      const res = await setPassword('alpha', cookie, 'longenough123');
      assert.ok(isDead(res), `${what}: ${res.status} ${res.text}`);
    }
    // The pending token in the body, as /api/login/verify accepts it, is not read here.
    const inBody = await call('alpha', 'POST', '/api/login/first-password/set', { body: { password: 'longenough123', pending: pendingA.slice('mfa_pending='.length) }, from: nextIp() });
    assert.ok(isDead(inBody), inBody.text);
    assert.equal(ownerOnDisk(dataDir, 'alpha').passwordHash, null);
  });

  await test('the set step needs the login the page names to be the step\'s owner: another, none or not text is the same 401, counted on the limit', async () => {
    const from = '203.0.113.41';
    const refusals = [['another owner\'s', 'ownbravo'], ['an unknown one', 'nobody'], ['none', null], ['an empty one', ''], ['only spaces', '   '], ['a number', 12345678], ['a list', ['ownalpha']], ['an object', { login: 'ownalpha' }], ['a longer one', 'ownalpha2'], ['another owner\'s', 'ownbravo']];
    for (const [what, login] of refusals) {
      const res = await setPassword('alpha', pendingA, 'longenough123', { login, from });
      assert.ok(isDead(res), `${what}: ${res.status} ${res.text}`);
    }
    // Ten refusals: the address is held, even with the right login (the limit is the sign-in's).
    const held = await setPassword('alpha', pendingA, 'longenough123', { from });
    assert.equal(held.status, 429, held.text);
    assert.equal(ownerOnDisk(dataDir, 'alpha').passwordHash, null, 'nothing set');
    assert.ok(ownerOnDisk(dataDir, 'alpha').firstPassword?.claim, 'and the step is still open');
  });

  await test('a first-password pending cookie opens neither the enrolment nor the verify step', async () => {
    for (const p of ['/api/me/mfa/start', '/api/me/mfa/enable', '/api/login/verify']) {
      const res = await call('alpha', 'POST', p, { cookie: pendingA, body: { code: '123456' }, from: nextIp() });
      assert.equal(res.status, 401, `${p}: ${res.text}`);
    }
    assert.equal((await call('alpha', 'GET', '/api/me', { cookie: pendingA })).status, 401, 'nor is it a session');
  });

  await test('the password is 8 to 200 characters, checked on the server', async () => {
    for (const [password, error] of [['seven77', 'A password needs at least 8 characters.'], ['', 'A password needs at least 8 characters.'], [12345678, 'A password needs at least 8 characters.'], ['x'.repeat(201), 'A password can have at most 200 characters.']]) {
      const res = await setPassword('alpha', pendingA, password);
      assert.deepEqual([res.status, res.json], [400, { error }], String(password).slice(0, 20));
    }
    assert.equal(ownerOnDisk(dataDir, 'alpha').passwordHash, null, 'nothing set');
  });

  const PASSWORD_A = `${'p'.repeat(199)}!`; // 200 characters: the longest allowed
  await test('a good password signs the owner in; then the token and the pending cookie are dead and POST /api/login works', async () => {
    const res = await setPassword('alpha', pendingA, PASSWORD_A, { login: ' OwnAlpha ' }); // compared as cleaned
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.user.login, 'ownalpha');
    assert.equal(res.json.user.hasPassword, true);
    assert.ok(!('token' in res.json) && !('pending' in res.json));
    assert.ok(res.jar.app_session, 'a session');
    assert.equal(res.jar.mfa_pending, '', 'the pending cookie cleared');
    ownerSession = `app_session=${res.jar.app_session}`;
    const me = await call('alpha', 'GET', '/api/me', { cookie: ownerSession });
    assert.equal(me.status, 200);
    assert.equal(me.json.environment.owner, true);
    laterAnswers.push(me.text);
    const owner = ownerOnDisk(dataDir, 'alpha');
    assert.ok(!('firstPassword' in owner), 'the link record is removed');
    assert.ok(auth.verifyPassword(PASSWORD_A, owner.passwordHash), 'hashed as every password is');
    assert.ok(isDead(await exchange('alpha', A.token)), 'the token is dead');
    assert.ok(isDead(await setPassword('alpha', pendingA, 'anotherpassword1')), 'the pending cookie is dead');
    assert.ok(auth.verifyPassword(PASSWORD_A, ownerOnDisk(dataDir, 'alpha').passwordHash), 'and changed nothing');
    const login = await call('alpha', 'POST', '/api/login', { body: { login: 'ownalpha', password: PASSWORD_A }, from: nextIp() });
    assert.equal(login.status, 200, login.text);
    const users = await call('alpha', 'GET', '/api/users', { cookie: ownerSession });
    laterAnswers.push(users.text);
    // Self sign-up, still turned on, opens again once the owner has arrived.
    const reg = await call('alpha', 'POST', '/api/register', { body: { login: 'later', password: 'longenough123' }, from: nextIp() });
    assert.notEqual(reg.json?.error, 'sign-up is turned off', reg.text);
  });

  await test('with a second step required, the password leads to enrolment and no session; the other pending purposes are refused', async () => {
    const M = await signup('mike');
    const bearer = await crossSignIn('mike');
    assert.equal((await call('mike', 'PATCH', '/api/settings', { bearer, body: { mfaRequired: true } })).status, 200);
    const ex = await exchange('mike', M.token);
    assert.equal(ex.status, 200, ex.text);
    const set = await setPassword('mike', pendingOf(ex), 'mikepassword1');
    assert.equal(set.status, 200, set.text);
    assert.deepEqual(set.json, { mfaRequired: true, enrol: true });
    assert.ok(!set.jar.app_session, 'no session');
    const enrol = pendingOf(set);
    assert.ok(enrol && enrol !== pendingOf(ex), 'an enrol pending cookie');
    assert.equal((await call('mike', 'GET', '/api/me', { cookie: enrol })).status, 401, 'not signed in yet');
    // The enrol cookie is no first-password step.
    assert.ok(isDead(await setPassword('mike', enrol, 'otherpassword1')));
    const start = await call('mike', 'POST', '/api/me/mfa/start', { cookie: enrol, body: {} });
    assert.equal(start.status, 200, start.text);
    const enabled = await call('mike', 'POST', '/api/me/mfa/enable', { cookie: enrol, body: { code: auth.totpCode(start.json.secret) } });
    assert.equal(enabled.status, 200, enabled.text);
    assert.ok(enabled.jar.app_session, 'signed in once the second step is set up');
    // A verify step (the next sign-in) is no first-password step either.
    const again = await call('mike', 'POST', '/api/login', { body: { login: 'ownmike', password: 'mikepassword1' }, from: nextIp() });
    assert.equal(again.json?.mfaRequired, true, again.text);
    assert.ok(isDead(await setPassword('mike', `mfa_pending=${again.json.pending}`, 'otherpassword1')));
  });

  await test('a restart keeps an unused token working, and an ended one is refused', async () => {
    const K = await signup('kilo');
    const L = await signup('lima');
    await server.stop();
    const file = path.join(dataDir, 'environments', 'lima', 'app.json');
    const lima = JSON.parse(fs.readFileSync(file, 'utf8'));
    lima.users.find((u) => u.login === 'ownlima').firstPassword.expiresAt = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(file, JSON.stringify(lima));
    server = await startServer(dataDir, hostedEnv);
    assert.equal(ownerOnDisk(dataDir, 'kilo').firstPassword.hash, sha256(K.token), 'kept across the restart');
    assert.equal((await exchange('kilo', K.token)).status, 200);
    const ended = await exchange('lima', L.token);
    assert.ok(isDead(ended), ended.text);
  });

  await test('the console\'s "New first-password link": host admin only, 24 hours, once, and it ends any older link and step', async () => {
    const H = await signup('hotel');
    const hostNow = await hostCookie();
    // The console's list says which owners are still waiting for their first password: their logins only.
    const waiting = async () => Object.fromEntries((await call('admin', 'GET', '/api/host/environments', { cookie: hostNow })).json.environments.map((e) => [e.slug, e.awaitingFirstPassword]));
    const w0 = await waiting();
    assert.deepEqual([w0.hotel, w0.alpha], [['ownhotel'], []], JSON.stringify(w0));
    const make = (slug, login, opts = {}) => call('admin', 'POST', `/api/host/environments/${slug}/owners/${login}/first-password`, opts);
    assert.equal((await make('hotel', 'ownhotel')).status, 401, 'no session');
    assert.equal((await make('hotel', 'ownhotel', { cookie: ownerSession })).status, 401, "an environment owner's session is not the host admin's");
    assert.equal((await make('hotel', 'ownhotel', { bearer: ownerSession.slice('app_session='.length) })).status, 401, 'nor as a bearer');
    const cross = await make('hotel', 'ownhotel', { cookie: hostNow, headers: { origin: `http://hotel.localhost:${server.port}`, 'sec-fetch-site': 'same-site' } });
    assert.deepEqual([cross.status, cross.json], [403, { error: ORIGIN_SENTENCE }]);
    assert.deepEqual([(await make('nowhere', 'ownhotel', { cookie: hostNow })).status], [404]);
    assert.deepEqual((await make('hotel', 'nobody', { cookie: hostNow })).json, { error: 'no owner with that login there' });
    const hasPw = await make('alpha', 'ownalpha', { cookie: hostNow });
    assert.deepEqual([hasPw.status, hasPw.json], [400, { error: 'This owner has a password already, so there is no first password to set.' }]);
    assert.equal(ownerOnDisk(dataDir, 'hotel').firstPassword.hash, sha256(H.token), 'the refusals changed nothing');
    const one = await make('hotel', 'ownhotel', { cookie: hostNow });
    assert.equal(one.status, 200, one.text);
    assert.equal(one.headers['cache-control'], 'no-store');
    assert.match(one.json.url, new RegExp(`^http://hotel\\.localhost:${server.port}/login/first-password#[A-Za-z0-9_-]{43}$`));
    const t1 = one.json.url.split('#')[1];
    tokens.push(t1);
    const stored = ownerOnDisk(dataDir, 'hotel').firstPassword;
    assert.equal(stored.hash, sha256(t1));
    const left = Date.parse(stored.expiresAt) - Date.now();
    assert.ok(left > 23.9 * 3600000 && left <= 24 * 3600000, `24 hours (${left} ms)`);
    assert.ok(isDead(await exchange('hotel', H.token)), "sign-up's link ended when the new one was made");
    const claimed = await exchange('hotel', t1);
    assert.equal(claimed.status, 200, claimed.text);
    const step1 = pendingOf(claimed);
    const two = await make('hotel', 'ownhotel', { cookie: hostNow });
    const t2 = two.json.url.split('#')[1];
    tokens.push(t2);
    assert.ok(isDead(await setPassword('hotel', step1, 'hotelpassword1')), 'a step begun from the older link ends');
    assert.ok(isDead(await exchange('hotel', t1)), 'the older link stays dead');
    const claimed2 = await exchange('hotel', t2);
    assert.equal(claimed2.status, 200);
    assert.ok(isDead(await setPassword('hotel', step1, 'hotelpassword1')), 'the older step stays dead after the new claim');
    const done = await setPassword('hotel', pendingOf(claimed2), 'hotelpassword1');
    assert.equal(done.status, 200, done.text);
    assert.ok(isDead(await exchange('hotel', t2)));
    assert.equal((await make('hotel', 'ownhotel', { cookie: hostNow })).status, 400, 'once the password is set there is none to make');
    assert.deepEqual((await waiting()).hotel, [], 'and the list no longer names the owner');
  });

  await test('GET /login/first-password never redirects, signed in or not, and carries no-store, no-referrer and the framed-here headers', async () => {
    for (const [what, opts] of [['signed out', {}], ['signed in', { cookie: ownerSession }], ['with next', { cookie: ownerSession, path: '/login/first-password?next=/x' }], ['with a pending cookie', { cookie: pendingB }]]) {
      const res = await call('alpha', 'GET', opts.path || '/login/first-password', { cookie: opts.cookie, headers: { accept: 'text/html' } });
      assert.ok(!res.headers.location, `${what}: no Location`);
      assert.ok(res.status < 300 || res.status >= 400, `${what}: ${res.status}`);
      assert.equal(res.status, PAGE_BUILT ? 200 : 404, `${what}: ${res.status}`);
      assert.equal(res.headers['cache-control'], 'no-store', what);
      assert.equal(res.headers['referrer-policy'], 'no-referrer', what);
      assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN', what);
      assert.match(res.headers['content-security-policy'] || '', /frame-ancestors 'self'/, what);
    }
    assert.equal((await call('', 'GET', '/login/first-password', { headers: { accept: 'text/html' } })).status, 404, 'not at the product host');
    // The router ignores case and a trailing slash, so the framing headers must too: every way of writing the path
    // that reaches the page gets them.
    for (const p of ['/login/first-password/', '/Login/First-Password', '/LOGIN/FIRST-PASSWORD/', '/login/first-password/?x=1']) {
      const res = await call('alpha', 'GET', p, { headers: { accept: 'text/html' } });
      assert.equal(res.status, PAGE_BUILT ? 200 : 404, `${p}: ${res.status}`);
      assert.ok(!res.headers.location, `${p}: no Location`);
      assert.equal(res.headers['cache-control'], 'no-store', p);
      assert.equal(res.headers['referrer-policy'], 'no-referrer', p);
      assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN', p);
      assert.match(res.headers['content-security-policy'] || '', /frame-ancestors 'self'/, p);
    }
    for (const p of ['/login/', '/Login', '/LOGIN/', '/login/verify/', '/Login/Verify', '/login/enrol/', '/Login/ENROL', '/Register/', '/Profile/']) {
      const res = await call('alpha', 'GET', p, { headers: { accept: 'text/html' } });
      assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN', `${p}: ${res.status}`);
      assert.match(res.headers['content-security-policy'] || '', /frame-ancestors 'self'/, p);
    }
    // The page's own file, by its file name, is not a second way to the page: 404 wherever it is asked for.
    const unknown = await call('alpha', 'GET', '/no-such-file.html', { headers: { accept: 'text/html' } });
    for (const p of FILE_PATHS) {
      for (const where of ['alpha', 'admin', '']) {
        for (const method of ['GET', 'HEAD']) {
          const res = await call(where, method, p, { headers: { accept: 'text/html' } });
          assert.equal(res.status, 404, `${method} ${p} at ${where || 'the product host'}: ${res.status}`);
          assert.ok(!res.text.includes('fp-password'), `${p} at ${where || 'the product host'}: the page`);
          if (where === 'alpha' && method === 'GET') assert.equal(res.text.replaceAll(p.split('?')[0], ''), unknown.text.replaceAll('/no-such-file.html', ''), `${p}: answered as an unknown file is`);
        }
      }
    }
    if (!PAGE_BUILT) console.log('check-first-password: public/login-first-password.html is not built yet (plan step 2): the page route answers 404 until it is.');
  });

  await test("the token is in no later answer: /api/me, /api/users, the console's list, the owner's export; the backup keeps only its hash", async () => {
    const W = await signup('whiskey'); // waits: never exchanged
    const hostNow = await hostCookie();
    const list = await call('admin', 'GET', '/api/host/environments', { cookie: hostNow });
    laterAnswers.push(list.text);
    const bearer = await crossSignIn('whiskey');
    for (const p of ['/api/me', '/api/users', '/api/settings']) laterAnswers.push((await call('whiskey', 'GET', p, { bearer })).text);
    const exp = await call('whiskey', 'GET', '/api/environment/export', { bearer, accept: '*/*' });
    assert.equal(exp.status, 200, exp.text.slice(0, 200));
    const exported = await unzipEntries(exp.raw);
    const hash = sha256(W.token);
    for (const [name, bytes] of exported) {
      const text = bytes.toString('utf8');
      assert.ok(!text.includes(W.token) && !text.includes(hash), `the export's ${name} carries the link`);
      assert.ok(!text.includes('firstPassword'), `the export's ${name} names firstPassword`);
    }
    const backup = await call('admin', 'POST', '/api/host/environments/whiskey/backup', { cookie: hostNow, accept: '*/*' });
    assert.equal(backup.status, 200);
    const backed = JSON.parse((await unzipEntries(backup.raw)).get('app.json').toString('utf8'));
    assert.equal(backed.users.find((u) => u.login === 'ownwhiskey').firstPassword.hash, hash, 'the backup keeps the hash');
    assert.ok(!backup.raw.includes(W.token), 'and not the token');
    for (const text of laterAnswers) for (const t of tokens) assert.ok(!text.includes(t), 'a later answer carries a token');
    for (const text of laterAnswers) assert.ok(!text.includes('firstPassword'), 'a later answer names firstPassword');
  });

  await test('no token in clear in any file under DATA_DIR, or in the server output', async () => {
    assert.ok(tokens.length >= 8, `${tokens.length} tokens`);
    for (const file of filesUnder(dataDir)) {
      const text = fs.readFileSync(file).toString('latin1');
      for (const t of tokens) assert.ok(!text.includes(t), `${path.relative(dataDir, file)} carries a token`);
    }
    const out = server.output();
    for (const t of tokens) assert.ok(!out.includes(t) && !out.includes(sha256(t)), 'the server output carries a token or its hash');
  });
} finally {
  if (server) await server.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

// --- a single environment (no BASE_DOMAIN): nothing of this exists, as before ------------------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-first-password-single-'));
  let single = null;
  try {
    single = await startServer(dir, { ADMIN_PASSWORD: 'testpass1234' });
    await test('without BASE_DOMAIN the new paths answer exactly as an unknown path does', async () => {
      const at = (method, p, body) => call('', method, p, { srv: single, base: 'localhost', body, headers: { accept: method === 'GET' ? 'text/html' : 'application/json' } });
      for (const [method, p, other, body] of [
        ['GET', '/login/first-password', '/login/no-such-page'],
        ['POST', '/api/login/first-password', '/api/login/no-such-route', { token: 'x' }],
        ['POST', '/api/login/first-password/set', '/api/login/no-such-route/set', { password: 'longenough123' }],
      ]) {
        const a = await at(method, p, body);
        const b = await at(method, other, body);
        assert.deepEqual([a.status, a.headers.location, a.text.replaceAll(p, '')], [b.status, b.headers.location, b.text.replaceAll(other, '')], `${method} ${p}`);
        assert.ok(!a.headers['referrer-policy'], `${p}: no new header`);
      }
      assert.equal((await at('POST', '/api/product/signup', { slug: 'x', owner: { login: 'x' } })).status, 404, 'no sign-up');
      // The page's file is not served by its file name here either.
      const unknown = await at('GET', '/no-such-file.html');
      for (const p of FILE_PATHS) {
        const res = await at('GET', p);
        assert.equal(res.status, 404, `${p}: ${res.status}`);
        assert.equal(res.text.replaceAll(p.split('?')[0], ''), unknown.text.replaceAll('/no-such-file.html', ''), `${p}: answered as an unknown file is`);
        assert.ok(!res.headers['x-frame-options'] && !res.headers['referrer-policy'], `${p}: no page headers`);
      }
      // Self sign-up behaves as before: refused while it is turned off, whoever asks.
      assert.deepEqual((await at('POST', '/api/register', { login: 'x', password: 'longenough123' })).json, { error: 'sign-up is turned off' });
    });
  } finally {
    if (single) await single.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (failed) {
  console.error(`check-first-password: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-first-password: ${n} OK`);
