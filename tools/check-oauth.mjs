#!/usr/bin/env node
/*
 * check-oauth.mjs -- the sign-in server for apps (server/oauth.js; documentation/plans/plan-mcp-oauth.md, step 1), against
 * real servers on throwaway DATA_DIRs, through real HTTP, the script playing the app:
 *   - AGENT_TOKENS unset: every sign-in route answers as an unknown path does;
 *   - the metadata (RFC 9728, RFC 8414): issuer and resource per environment, S256 only, offline_access offered, no client
 *     ID metadata documents; the 401 on /mcp names resource_metadata (no token, a bad one, a revoked one); a REST 401 does not;
 *   - registration: the return address rules (https, loopback; never http elsewhere, a custom scheme or a fragment; 1 to 5),
 *     a cleaned name, a secret only when asked for and only its hash kept, 10 an hour per address;
 *   - authorize: an unknown client or a return address it did not register stops at an error page and never redirects; a
 *     loopback address matches on any port with its exact path; no PKCE, plain, a foreign resource or a bad response_type go
 *     back to the app with state and iss; an unknown scope is passed over; 30 a minute per address;
 *   - the request routes: an owner and the admin may allow; a member and a moderator are told only an owner can, signed out
 *     is 401, an agent's token is the gate's 403, an access token 401; another site's Origin, a missing or another session's
 *     form value are refused; the page's answers are not framed or cached; Don't allow goes back with access_denied;
 *   - the code: one use, 60 seconds, bound to the client, the redirect and the verifier; a second use after it was traded
 *     ends the connection; the resource must match;
 *   - tokens: an access token works at /mcp and its tool calls run through the gate (counted and logged as the route, with
 *     the connection's id); on a REST route it is 401; refresh rotates, and an old refresh token used again ends the
 *     connection; Revoke, Turn off and Agents off stop it on the next call; a connection past its end is refused;
 *     offline_access is echoed; a secret client must send its secret;
 *   - one way in: allowing ends a pasted token; making a token ends a connection; the agent page reads `connection`;
 *   - the set-up kind only when AGENT_SETUP and Set-up agents are on;
 *   - five wrong token requests in a row block the address (429, Retry-After);
 *   - hosted: an app and a token of one environment are unknown at another; the product host and the console have none;
 *   - nothing in the clear: no token, code, verifier or secret in DATA_DIR or the server's output.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVALID = 'That agent token is not valid.';
const CANT = "An agent can't do that.";
const FORM_WRONG = 'This page is out of date. Open it again from the app.';
const LIVEKIT = { LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret' };

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

const servers = [];
async function startServer(dataDir, env = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, ...LIVEKIT, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const server = { child, out: '', port: 0, dataDir };
  child.stdout.on('data', (d) => { server.out += d; });
  child.stderr.on('data', (d) => { server.out += d; });
  server.port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${server.out}`)); }, 25000);
    const onData = () => { const m = /listening on :(\d+)/.exec(server.out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${server.out}`)); });
  });
  server.stop = () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
  servers.push(server);
  return server;
}

// One request. `host`: a hosted environment's slug (or "admin"); `form`: a body sent as a form; `ip`: X-Forwarded-For.
function call(server, method, urlPath, { body, form, cookie, token, host, raw, headers: extra, ip } = {}) {
  let payload = null;
  const headers = { host: host ? `${host}.localhost:${server.port}` : `127.0.0.1:${server.port}`, accept: 'application/json', ...(extra || {}) };
  if (raw !== undefined) payload = raw;
  else if (form !== undefined) { payload = Buffer.from(new URLSearchParams(form).toString()); headers['content-type'] = 'application/x-www-form-urlencoded'; }
  else if (body !== undefined) payload = Buffer.from(JSON.stringify(body));
  if (payload) { headers['content-type'] = headers['content-type'] || 'application/json'; headers['content-length'] = payload.length; }
  if (cookie) headers.cookie = cookie;
  if (token) headers.authorization = `Bearer ${token}`;
  if (ip) headers['x-forwarded-for'] = ip;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, json, text, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const cookieOf = (res) => [].concat(res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
async function signIn(server, login, password, host) {
  const r = await call(server, 'POST', host === 'admin' ? '/api/host/login' : '/api/login', { body: { login, password }, host });
  assert.equal(r.status, 200, `${login} signs in: ${r.text}`);
  return cookieOf(r);
}
const ok = (r, what, status = 200) => assert.equal(r.status, status, `${what}: ${r.status} ${r.text.slice(0, 300)}`);
const dayToday = () => new Date().toISOString().slice(0, 10);
const logLines = (dir, key) => {
  const file = path.join(dir, 'agent-log', key, `${dayToday()}.jsonl`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const origin = (server, host) => (host ? `http://${host}.localhost:${server.port}` : `http://127.0.0.1:${server.port}`);

// Everything secret the script was given, to look for later.
const secrets = new Set();
const keep = (v) => { if (typeof v === 'string' && v.length >= 20) secrets.add(v); return v; };

const pkce = () => {
  const verifier = keep(crypto.randomBytes(40).toString('base64url'));
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};
let ipCount = 0;
const freshIp = () => { ipCount += 1; return `10.9.${Math.floor(ipCount / 250)}.${(ipCount % 250) + 1}`; };

async function register(server, body, opts = {}) {
  const r = await call(server, 'POST', '/oauth/register', { body, ip: opts.ip || freshIp(), host: opts.host });
  if (r.json?.client_secret) keep(r.json.client_secret);
  return r;
}
async function newClient(server, redirect = 'https://app.example/callback', extra = {}, opts = {}) {
  const r = await register(server, { client_name: 'Test App', redirect_uris: [].concat(redirect), token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], ...extra }, opts);
  ok(r, 'registers', 201);
  return r.json;
}
// GET /oauth/authorize; answers the response and, for a redirect, its Location as a URL.
async function authorize(server, params, opts = {}) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined)).toString();
  const r = await call(server, 'GET', `/oauth/authorize?${q}`, { ip: opts.ip || freshIp(), host: opts.host, headers: { accept: 'text/html' } });
  const loc = r.headers.location ? new URL(r.headers.location, origin(server, opts.host)) : null;
  return { ...r, loc };
}
// A sign-in up to the approval page: { requestId, pk }.
async function startSignIn(server, client, { redirect = client.redirect_uris[0], scope, resource, state = 'st-1', host } = {}) {
  const pk = pkce();
  const a = await authorize(server, { response_type: 'code', client_id: client.client_id, redirect_uri: redirect, code_challenge: pk.challenge, code_challenge_method: 'S256', state, scope, resource }, { host });
  assert.equal(a.status, 302, `authorize redirects: ${a.status} ${a.text.slice(0, 200)}`);
  assert.equal(a.loc.pathname, '/connect-app', `to the approval page: ${a.loc}`);
  return { requestId: a.loc.searchParams.get('request'), pk };
}
// Opens the approval page's request as `cookie` and allows: the redirect's URL.
async function allow(server, cookie, requestId, choice, { host } = {}) {
  const view = await call(server, 'GET', `/api/oauth/requests/${requestId}`, { cookie, host });
  ok(view, 'the request reads');
  assert.equal(typeof view.json.form, 'string', 'a form value');
  const r = await call(server, 'POST', `/api/oauth/requests/${requestId}/allow`, { cookie, host, body: { form: view.json.form, ...choice } });
  ok(r, 'allowed');
  const to = new URL(r.json.redirect);
  keep(to.searchParams.get('code'));
  return to;
}
async function exchange(server, client, code, verifier, extra = {}, opts = {}) {
  const r = await call(server, 'POST', '/oauth/token', { form: { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id, redirect_uri: client.redirect_uris[0], ...extra }, ip: opts.ip || freshIp(), host: opts.host, headers: opts.headers });
  keep(r.json?.access_token);
  keep(r.json?.refresh_token);
  return r;
}
async function refresh(server, client, refreshToken, extra = {}, opts = {}) {
  const r = await call(server, 'POST', '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: client.client_id, ...extra }, ip: opts.ip || freshIp(), host: opts.host });
  keep(r.json?.access_token);
  keep(r.json?.refresh_token);
  return r;
}
// A whole sign-in: { tokens, client, agentKey, connectionTo }.
async function connect(server, cookie, choice = { agent: 'new', spaces: [] }, { client, scope, host } = {}) {
  const c = client || await newClient(server, undefined, {}, { host });
  const { requestId, pk } = await startSignIn(server, c, { scope, host });
  const to = await allow(server, cookie, requestId, choice, { host });
  const t = await exchange(server, c, to.searchParams.get('code'), pk.verifier, {}, { host });
  ok(t, 'the code is traded');
  return { tokens: t.json, client: c, to };
}

let nextId = 1;
const rpc = (server, method, params, opts = {}) => call(server, 'POST', '/mcp', { ...opts, headers: { accept: 'application/json, text/event-stream', ...(opts.headers || {}) }, body: { jsonrpc: '2.0', id: nextId++, method, ...(params === undefined ? {} : { params }) } });
const tool = (server, name, args, opts) => rpc(server, 'tools/call', { name, arguments: args }, opts);
const toolJson = (r) => { assert.equal(r.status, 200, `a tool answer: ${r.text.slice(0, 200)}`); assert.ok(!r.json.result.isError, `no tool error: ${r.text.slice(0, 300)}`); return JSON.parse(r.json.result.content[0].text); };

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-oauth-'));
const single = path.join(base, 'single');

try {
  // --- AGENT_TOKENS off ----------------------------------------------------------------------------------------------
  await test('with AGENT_TOKENS off, every sign-in route answers as an unknown path', async () => {
    const off = await startServer(path.join(base, 'off'), { ADMIN_PASSWORD: 'admin-password-1' });
    const unknown = await call(off, 'GET', '/no-such-path-7731');
    for (const [method, p, opts] of [
      ['GET', '/.well-known/oauth-protected-resource/mcp'], ['GET', '/.well-known/oauth-protected-resource'], ['GET', '/.well-known/oauth-authorization-server'],
      ['POST', '/oauth/register', { body: { redirect_uris: ['https://a.example/cb'] } }], ['GET', '/oauth/authorize?client_id=x'],
      ['POST', '/oauth/token', { form: { grant_type: 'refresh_token' } }], ['GET', '/api/oauth/requests/aaaaaaaaaaaaaaaaaaaaaa'],
      ['POST', '/api/oauth/requests/aaaaaaaaaaaaaaaaaaaaaa/allow', { body: {} }], ['POST', '/api/oauth/requests/aaaaaaaaaaaaaaaaaaaaaa/deny', { body: {} }],
    ]) {
      const r = await call(off, method, p, opts);
      assert.equal(r.status, method === 'GET' ? unknown.status : 404, `${method} ${p}: ${r.status}`);
      assert.ok(!r.text.includes('authorization_endpoint') && !r.text.includes('resource_metadata'), `${p} says nothing of sign-in`);
    }
    const mcp = await rpc(off, 'ping', undefined);
    assert.equal(mcp.headers['www-authenticate'], undefined, '/mcp is an unknown path, no challenge');
    await off.stop();
  });

  const server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1', AGENT_TOKENS: 'true' });
  const O = origin(server);
  const admin = await signIn(server, 'admin', 'admin-password-1');
  ok(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { agents: true } }), 'Agents on');
  const envName = (await call(server, 'GET', '/api/branding', { cookie: admin })).json?.environmentName;
  ok(await call(server, 'POST', '/api/users', { cookie: admin, body: { login: 'olga', displayName: 'Olga', password: 'olga-password-1', role: 'owner' } }), 'an owner', 201);
  const mia = (await call(server, 'POST', '/api/users', { cookie: admin, body: { login: 'mia', displayName: 'Mia', password: 'mia-password-1', role: 'member' } })).json.user;
  const max = (await call(server, 'POST', '/api/users', { cookie: admin, body: { login: 'max', displayName: 'Max', password: 'max-password-1', role: 'member' } })).json.user;
  const S1 = (await call(server, 'POST', '/api/spaces', { cookie: admin, body: { name: 'Camp', members: [mia.key, max.key] } })).json.space.id;
  const S2 = (await call(server, 'POST', '/api/spaces', { cookie: admin, body: { name: 'Elsewhere', members: [mia.key] } })).json.space.id;
  // Max moderates Camp.
  ok(await call(server, 'PATCH', `/api/users/${max.key}/spaces/${S1}`, { cookie: admin, body: { permissions: { moderator: true } } }), 'Max moderates Camp');
  const olga = await signIn(server, 'olga', 'olga-password-1');
  const miaC = await signIn(server, 'mia', 'mia-password-1');
  const maxC = await signIn(server, 'max', 'max-password-1');

  // A code got early and traded only after its 60 seconds (the expired-code case, below).
  const lateClient = await newClient(server);
  const late = await startSignIn(server, lateClient);
  const lateTo = await allow(server, admin, late.requestId, { agent: 'new', name: 'Late', spaces: [] });
  const lateAt = Date.now();

  await test('the metadata: issuer and resource are this address; S256 only; offline_access; no client ID metadata documents', async () => {
    for (const p of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
      const r = await call(server, 'GET', p);
      ok(r, p);
      assert.deepEqual({ ...r.json, resource_name: undefined }, { resource: `${O}/mcp`, authorization_servers: [O], bearer_methods_supported: ['header'], scopes_supported: ['agent', 'offline_access'], resource_name: undefined });
    }
    const m = (await call(server, 'GET', '/.well-known/oauth-authorization-server')).json;
    assert.equal(m.issuer, O);
    assert.equal(m.authorization_endpoint, `${O}/oauth/authorize`);
    assert.equal(m.token_endpoint, `${O}/oauth/token`);
    assert.equal(m.registration_endpoint, `${O}/oauth/register`);
    assert.deepEqual(m.code_challenge_methods_supported, ['S256']);
    assert.deepEqual(m.response_types_supported, ['code']);
    assert.deepEqual(m.grant_types_supported, ['authorization_code', 'refresh_token']);
    assert.deepEqual(m.token_endpoint_auth_methods_supported, ['none', 'client_secret_basic', 'client_secret_post']);
    assert.deepEqual(m.scopes_supported, ['agent', 'offline_access']);
    assert.equal(m.authorization_response_iss_parameter_supported, true);
    assert.equal(m.client_id_metadata_document_supported, undefined, 'no client ID metadata documents yet');
    // Another name for the same server is its own issuer (decision 3: the request's address).
    const other = await call(server, 'GET', '/.well-known/oauth-authorization-server', { headers: { host: `localhost:${server.port}` } });
    assert.equal(other.json.issuer, `http://localhost:${server.port}`);
  });

  await test('the 401 on /mcp names the metadata; a REST 401 does not', async () => {
    const want = `Bearer resource_metadata="${O}/.well-known/oauth-protected-resource/mcp", scope="agent"`;
    assert.equal((await rpc(server, 'ping')).headers['www-authenticate'], want, 'no token');
    assert.equal((await rpc(server, 'ping', undefined, { token: `agt_${'x'.repeat(43)}` })).headers['www-authenticate'], want, 'an unknown agent token');
    assert.equal((await rpc(server, 'ping', undefined, { token: `oat_${'x'.repeat(43)}` })).headers['www-authenticate'], want, 'an unknown access token');
    const rest = await call(server, 'GET', '/api/agent/me', { token: `agt_${'x'.repeat(43)}` });
    assert.equal(rest.status, 401);
    assert.equal(rest.headers['www-authenticate'], 'Bearer');
  });

  await test('registration: the return address rules, a cleaned name, a secret only when asked for and only its hash kept', async () => {
    for (const [uris, what] of [
      [['http://app.example/cb'], 'http elsewhere'], [['myapp://cb'], 'a custom scheme'], [['https://app.example/cb#x'], 'a fragment'],
      [['https://user:pw@app.example/cb'], 'a user name'], [[], 'none'], [Array.from({ length: 6 }, (_, i) => `https://app.example/${i}`), 'six'],
      [['not an address'], 'not an address'], ['https://app.example/cb', 'not a list'],
    ]) {
      const r = await register(server, { client_name: 'X', redirect_uris: uris, token_endpoint_auth_method: 'none' });
      assert.equal(r.status, 400, `${what}: ${r.text}`);
      assert.equal(r.json.error, 'invalid_redirect_uri', what);
      assert.equal(typeof r.json.error_description, 'string');
    }
    for (const uri of ['https://claude.ai/api/mcp/auth_callback', 'http://127.0.0.1/callback', 'http://127.0.0.1:33418/cb', 'http://localhost:9/cb', 'http://[::1]/cb']) {
      ok(await register(server, { redirect_uris: [uri], token_endpoint_auth_method: 'none' }), uri, 201);
    }
    assert.equal((await register(server, { redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'private_key_jwt' })).json.error, 'invalid_client_metadata');
    assert.equal((await register(server, { redirect_uris: ['https://a.example/cb'], grant_types: ['implicit'] })).json.error, 'invalid_client_metadata');
    const named = await register(server, { client_name: `  Evil${String.fromCharCode(7)} <b>App</b>${String.fromCodePoint(0x202e)}${'z'.repeat(80)}`, redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'none', software_id: 'ignored' });
    ok(named, 'registered', 201);
    assert.ok(named.json.client_name.length <= 60, 'at most 60 characters');
    assert.ok(![...named.json.client_name].some((ch) => ch.codePointAt(0) < 32 || ch === '<' || ch === '>' || ch.codePointAt(0) === 0x202e), `plain text: ${named.json.client_name}`);
    assert.equal(named.json.client_secret, undefined, 'no secret for "none"');
    assert.equal(named.headers['cache-control'], 'no-store');
    const basic = await register(server, { client_name: 'Basic', redirect_uris: ['https://a.example/cb'] });
    assert.equal(basic.json.token_endpoint_auth_method, 'client_secret_basic', 'no method named is basic (RFC 7591)');
    assert.match(basic.json.client_secret, /^ocs_[A-Za-z0-9_-]{43}$/);
    const post = await register(server, { client_name: 'Post', redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'client_secret_post' });
    assert.ok(post.json.client_secret);
    const file = fs.readFileSync(path.join(single, 'oauth-clients.json'), 'utf8');
    assert.ok(!file.includes(basic.json.client_secret) && !file.includes(post.json.client_secret), 'no secret kept');
    assert.ok(file.includes(crypto.createHash('sha256').update(basic.json.client_secret).digest('hex')), 'its hash kept');
    assert.equal(fs.statSync(path.join(single, 'oauth-clients.json')).mode & 0o777, 0o600, 'private');
  });

  await test('registration: 10 an hour per address, then 429 with Retry-After', async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i += 1) ok(await register(server, { redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'none' }, { ip }), `registration ${i}`, 201);
    const over = await register(server, { redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'none' }, { ip });
    assert.equal(over.status, 429);
    assert.ok(Number(over.headers['retry-after']) > 0);
    ok(await register(server, { redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'none' }), 'another address', 201);
  });

  await test('authorize: an unknown client or a return address it did not register stops here and never redirects', async () => {
    const client = await newClient(server, ['https://app.example/callback', 'https://app.example/other']);
    const pk = pkce();
    const good = { response_type: 'code', client_id: client.client_id, code_challenge: pk.challenge, code_challenge_method: 'S256', state: 's' };
    for (const [params, what] of [
      [{ ...good, client_id: 'nobody-knows-this' }, 'an unknown client'],
      [{ ...good, redirect_uri: 'https://evil.example/callback' }, 'another host'],
      [{ ...good, redirect_uri: 'https://app.example/callback/more' }, 'a longer path'],
      [{ ...good, redirect_uri: 'https://app.example/callback?x=1' }, 'a query added'],
      [good, 'two registered, none named'],
    ]) {
      const r = await authorize(server, params);
      assert.equal(r.status, 400, `${what}: ${r.status}`);
      assert.equal(r.headers.location, undefined, `${what}: no redirect`);
      assert.match(r.headers['content-security-policy'] || '', /frame-ancestors 'none'/);
      assert.ok(r.text.length > 10 && !r.text.includes('<'), `${what}: a sentence: ${r.text}`);
    }
  });

  await test('authorize: what is wrong goes back to the app, with state and iss', async () => {
    const client = await newClient(server);
    const pk = pkce();
    const good = { response_type: 'code', client_id: client.client_id, redirect_uri: client.redirect_uris[0], code_challenge: pk.challenge, code_challenge_method: 'S256', state: 'abc 123' };
    for (const [params, error, what] of [
      [{ ...good, code_challenge: undefined, code_challenge_method: undefined }, 'invalid_request', 'no PKCE'],
      [{ ...good, code_challenge_method: 'plain' }, 'invalid_request', 'plain'],
      [{ ...good, code_challenge_method: undefined }, 'invalid_request', 'no method'],
      [{ ...good, resource: 'https://elsewhere.example/mcp' }, 'invalid_target', 'a foreign resource'],
      [{ ...good, response_type: 'token' }, 'unsupported_response_type', 'response_type token'],
    ]) {
      const r = await authorize(server, params);
      assert.equal(r.status, 302, what);
      assert.equal(`${r.loc.origin}${r.loc.pathname}`, client.redirect_uris[0], `${what}: back to the app`);
      assert.equal(r.loc.searchParams.get('error'), error, what);
      assert.equal(r.loc.searchParams.get('state'), 'abc 123', `${what}: state as given`);
      assert.equal(r.loc.searchParams.get('iss'), O, `${what}: iss`);
      assert.equal(r.loc.searchParams.get('code'), null);
    }
    // An unknown scope is passed over; this environment's own resource, with or without its slash, is fine.
    for (const extra of [{ scope: 'agent profile email' }, { resource: `${O}/mcp` }, { resource: `${O}/mcp/` }, { scope: 'offline_access' }]) {
      const r = await authorize(server, { ...good, ...extra });
      assert.equal(r.status, 302);
      assert.equal(r.loc.pathname, '/connect-app', JSON.stringify(extra));
    }
  });

  await test('authorize: a loopback address matches on any port, with its exact path (RFC 8252)', async () => {
    const loop = await newClient(server, ['http://127.0.0.1/callback', 'http://127.0.0.1/callback/srv-41a9', 'http://localhost/cb', 'http://[::1]/cb']);
    for (const [uri, good] of [
      ['http://127.0.0.1:53111/callback', true], ['http://127.0.0.1/callback', true], ['http://127.0.0.1:8080/callback/srv-41a9', true],
      ['http://localhost:4000/cb', true], ['http://[::1]:4000/cb', true],
      ['http://127.0.0.1:53111/callback/other', false], ['http://127.0.0.1:53111/callbackx', false], ['http://127.0.0.2:53111/callback', false],
      ['https://127.0.0.1:53111/callback', false], ['http://127.0.0.1:53111/callback/srv-41a9/x', false],
    ]) {
      const pk = pkce();
      const r = await authorize(server, { response_type: 'code', client_id: loop.client_id, redirect_uri: uri, code_challenge: pk.challenge, code_challenge_method: 'S256' });
      if (good) {
        assert.equal(r.status, 302, uri);
        assert.equal(r.loc.pathname, '/connect-app', uri);
      } else {
        assert.equal(r.status, 400, `${uri}: refused`);
        assert.equal(r.headers.location, undefined, `${uri}: never redirected`);
      }
    }
    // The whole way round with a port of its own: the code goes back to that very address, and is traded with it.
    const pk = pkce();
    const at = 'http://127.0.0.1:61234/callback/srv-41a9';
    const a = await authorize(server, { response_type: 'code', client_id: loop.client_id, redirect_uri: at, code_challenge: pk.challenge, code_challenge_method: 'S256', state: 'loop' });
    const to = await allow(server, admin, a.loc.searchParams.get('request'), { agent: 'new', name: 'Loop', spaces: [] });
    assert.equal(`${to.origin}${to.pathname}`, at);
    const wrong = await exchange(server, loop, to.searchParams.get('code'), pk.verifier, { redirect_uri: 'http://127.0.0.1:61234/callback' });
    assert.equal(wrong.json.error, 'invalid_grant', 'another redirect at the token');
    const a2 = await authorize(server, { response_type: 'code', client_id: loop.client_id, redirect_uri: at, code_challenge: pk.challenge, code_challenge_method: 'S256' });
    const to2 = await allow(server, admin, a2.loc.searchParams.get('request'), { agent: 'new', name: 'Loop 2', spaces: [] });
    ok(await exchange(server, loop, to2.searchParams.get('code'), pk.verifier, { redirect_uri: at }), 'traded with its address');
  });

  await test('authorize: 30 a minute per address', async () => {
    const client = await newClient(server);
    const ip = freshIp();
    const pk = pkce();
    for (let i = 0; i < 30; i += 1) assert.equal((await authorize(server, { response_type: 'code', client_id: client.client_id, code_challenge: pk.challenge, code_challenge_method: 'S256' }, { ip })).status, 302, `authorize ${i}`);
    const over = await authorize(server, { response_type: 'code', client_id: client.client_id, code_challenge: pk.challenge, code_challenge_method: 'S256' }, { ip });
    assert.equal(over.status, 429);
    assert.ok(Number(over.headers['retry-after']) > 0);
    assert.equal(over.headers.location, undefined);
  });

  await test('the request routes: who may allow, and what the page reads', async () => {
    const client = await newClient(server);
    const { requestId } = await startSignIn(server, client);
    const out = await call(server, 'GET', `/api/oauth/requests/${requestId}`);
    assert.equal(out.status, 401, 'signed out');
    for (const [cookie, who] of [[miaC, 'a member'], [maxC, 'a moderator']]) {
      const v = await call(server, 'GET', `/api/oauth/requests/${requestId}`, { cookie });
      ok(v, who);
      assert.equal(v.json.mayApprove, false, who);
      assert.equal(v.json.form, undefined, `${who}: nothing to approve`);
      assert.equal(v.json.agents, undefined);
      const r = await call(server, 'POST', `/api/oauth/requests/${requestId}/allow`, { cookie, body: { form: 'x', agent: 'new', spaces: [] } });
      assert.equal(r.status, 403, who);
      assert.equal(r.json.error, `Only an owner can connect an app to ${envName}.`, who);
      assert.equal((await call(server, 'POST', `/api/oauth/requests/${requestId}/deny`, { cookie, body: { form: 'x' } })).status, 403, `${who} can't deny either`);
    }
    for (const [cookie, who] of [[admin, 'the admin'], [olga, 'an owner']]) {
      const v = await call(server, 'GET', `/api/oauth/requests/${requestId}`, { cookie });
      ok(v, who);
      assert.equal(v.json.mayApprove, true);
      assert.deepEqual(v.json.app, { name: 'Test App', returnsTo: 'app.example' });
      assert.equal(v.json.environment, envName);
      assert.equal(v.json.agentsOn, true);
      assert.deepEqual(v.json.kinds, ['agent'], 'no set-up kind on this server');
      assert.ok(v.json.spaces.some((s) => s.id === S1) && !v.json.spaces.some((s) => s.id === 'lobby'), 'its spaces, never the Lobby');
      assert.deepEqual(v.json.lifetimes, ['30d', '60d', '90d', '1y', 'never']);
      assert.equal(v.json.defaultLifetime, '30d');
      assert.match(v.headers['content-security-policy'], /frame-ancestors 'none'/);
      assert.equal(v.headers['x-frame-options'], 'DENY');
      assert.equal(v.headers['cache-control'], 'no-store');
    }
    // An agent's token reaches none of it (the gate's 403); an access token is 401.
    const agent = (await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true, displayName: 'Pasted' } })).json.user;
    const pasted = (await call(server, 'POST', `/api/users/${agent.key}/token`, { cookie: admin })).json.token;
    keep(pasted);
    const byAgent = await call(server, 'GET', `/api/oauth/requests/${requestId}`, { token: pasted });
    assert.equal(byAgent.status, 403);
    assert.equal(byAgent.json.error, CANT);
    const c = await connect(server, admin);
    const byAccess = await call(server, 'GET', `/api/oauth/requests/${requestId}`, { token: c.tokens.access_token });
    assert.equal(byAccess.status, 401);
    assert.equal(byAccess.json.error, INVALID);
    const unknown = await call(server, 'GET', '/api/oauth/requests/AAAAAAAAAAAAAAAAAAAAAA', { cookie: admin });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.json.error, 'This sign-in has ended. Start again from the app.');
  });

  await test('Allow needs this origin and the form value of this very session; Don\'t allow goes back with access_denied', async () => {
    const client = await newClient(server);
    const { requestId } = await startSignIn(server, client, { state: 'deny-me' });
    const adminView = (await call(server, 'GET', `/api/oauth/requests/${requestId}`, { cookie: admin })).json;
    const evil = await call(server, 'POST', `/api/oauth/requests/${requestId}/allow`, { cookie: admin, headers: { origin: 'https://evil.example' }, body: { form: adminView.form, agent: 'new', spaces: [] } });
    assert.equal(evil.status, 403, 'another site');
    assert.equal(evil.json.error, 'This request came from another site, so it was refused.');
    const site = await call(server, 'POST', `/api/oauth/requests/${requestId}/allow`, { cookie: admin, headers: { 'sec-fetch-site': 'cross-site' }, body: { form: adminView.form, agent: 'new', spaces: [] } });
    assert.equal(site.status, 403, 'a cross-site fetch');
    for (const form of [undefined, '', 'x'.repeat(43)]) {
      const r = await call(server, 'POST', `/api/oauth/requests/${requestId}/allow`, { cookie: admin, body: { form, agent: 'new', spaces: [] } });
      assert.equal(r.status, 403, `form ${form}`);
      assert.equal(r.json.error, FORM_WRONG);
    }
    // Olga opens it after the admin: the admin's value no longer works, and hers works only with her session.
    const olgaView = (await call(server, 'GET', `/api/oauth/requests/${requestId}`, { cookie: olga })).json;
    assert.equal((await call(server, 'POST', `/api/oauth/requests/${requestId}/allow`, { cookie: admin, body: { form: adminView.form, agent: 'new', spaces: [] } })).json.error, FORM_WRONG, 'an older value');
    assert.equal((await call(server, 'POST', `/api/oauth/requests/${requestId}/allow`, { cookie: admin, body: { form: olgaView.form, agent: 'new', spaces: [] } })).json.error, FORM_WRONG, 'another session\'s value');
    const olga2 = await signIn(server, 'olga', 'olga-password-1');
    assert.equal((await call(server, 'POST', `/api/oauth/requests/${requestId}/allow`, { cookie: olga2, body: { form: olgaView.form, agent: 'new', spaces: [] } })).json.error, FORM_WRONG, 'the same person, another session');
    const denied = await call(server, 'POST', `/api/oauth/requests/${requestId}/deny`, { cookie: olga, body: { form: olgaView.form } });
    ok(denied, 'denied');
    const to = new URL(denied.json.redirect);
    assert.equal(`${to.origin}${to.pathname}`, client.redirect_uris[0]);
    assert.equal(to.searchParams.get('error'), 'access_denied');
    assert.equal(to.searchParams.get('state'), 'deny-me');
    assert.equal(to.searchParams.get('iss'), O);
    const after = await call(server, 'GET', `/api/oauth/requests/${requestId}`, { cookie: olga });
    assert.equal(after.status, 404);
    assert.equal(after.json.error, 'This sign-in has ended. Start again from Test App.');
  });

  await test('the full flow: the code for tokens, the access token at /mcp through the gate, logged as the connection', async () => {
    const client = await newClient(server);
    const { requestId, pk } = await startSignIn(server, client, { scope: 'agent offline_access' });
    const to = await allow(server, olga, requestId, { agent: 'new', name: 'Planner bot', spaces: [S1], expires: '90d' });
    assert.equal(`${to.origin}${to.pathname}`, client.redirect_uris[0]);
    assert.equal(to.searchParams.get('state'), 'st-1');
    assert.equal(to.searchParams.get('iss'), O);
    const t = await exchange(server, client, to.searchParams.get('code'), pk.verifier, { resource: `${O}/mcp` });
    ok(t, 'traded');
    assert.equal(t.headers['cache-control'], 'no-store');
    assert.equal(t.json.token_type, 'Bearer');
    assert.ok(t.json.expires_in > 3500 && t.json.expires_in <= 3600, `an hour: ${t.json.expires_in}`);
    assert.match(t.json.access_token, /^oat_[A-Za-z0-9_-]{43}$/);
    assert.match(t.json.refresh_token, /^ort_[A-Za-z0-9_-]{43}$/);
    assert.equal(t.json.scope, 'agent offline_access', 'offline_access echoed');
    const me = toolJson(await tool(server, 'me', {}, { token: t.json.access_token }));
    assert.equal(me.agent.name, 'Planner bot');
    assert.deepEqual(me.spaces, [{ id: S1, name: 'Camp' }], 'the ticked space');
    assert.ok(Date.parse(me.expiresAt) > Date.now() + 89 * 86400000, 'the connection\'s chosen life');
    toolJson(await tool(server, 'read_chat', { space: S1 }, { token: t.json.access_token }));
    const view = (await call(server, 'GET', `/api/users/${me.agent.key}/token`, { cookie: admin })).json;
    assert.equal(view.token, null);
    const users = (await call(server, 'GET', '/api/users', { cookie: admin })).json.users;
    assert.equal(view.connection.app, 'Test App');
    assert.equal(view.connection.returnsTo, 'app.example');
    assert.deepEqual(view.connection.allowedBy, { key: users.find((u) => u.login === 'olga').key, name: 'Olga' });
    assert.equal(view.connection.lifetime, '90d');
    assert.ok(view.connection.lastUsedAt, 'last used');
    const lines = logLines(single, me.agent.key);
    assert.ok(lines.some((l) => l.event === 'connected' && l.app === 'Test App' && l.token === view.connection.id), 'the connected line');
    assert.ok(lines.some((l) => l.route === '/api/agent/me' && l.token === view.connection.id && l.kind === 'read'), 'a tool call logged as its route, with the connection');
    assert.ok(lines.some((l) => l.route === '/api/spaces/:id/chat' && l.space === S1));
    const log = (await call(server, 'GET', `/api/users/${me.agent.key}/agent-log`, { cookie: admin })).json.entries;
    assert.deepEqual(log.find((e) => e.event === 'connected').by, { key: view.connection.allowedBy.key, name: 'Olga' });
    // The access token on a REST route, even one on the gate's list, is 401: its audience is /mcp.
    for (const p of ['/api/agent/me', `/api/spaces/${S1}/chat`, '/api/users']) {
      const r = await call(server, 'GET', p, { token: t.json.access_token });
      assert.equal(r.status, 401, p);
      assert.equal(r.json.error, INVALID);
    }
    // At another name for the same server it is 401 too (bound to the address it was issued at).
    const elsewhere = await tool(server, 'me', {}, { token: t.json.access_token, headers: { host: `localhost:${server.port}` } });
    assert.equal(elsewhere.status, 401, 'another address');
  });

  await test('the code: wrong verifier, wrong client, reuse, resource; a second use after it was traded ends the connection', async () => {
    const client = await newClient(server);
    const other = await newClient(server);
    let s = await startSignIn(server, client);
    let to = await allow(server, admin, s.requestId, { agent: 'new', name: 'Codes', spaces: [] });
    const wrong = await exchange(server, client, to.searchParams.get('code'), pkce().verifier);
    assert.equal(wrong.json.error, 'invalid_grant', 'a wrong verifier');
    assert.equal((await exchange(server, client, to.searchParams.get('code'), s.pk.verifier)).json.error, 'invalid_grant', 'used, even by the right verifier');
    s = await startSignIn(server, client);
    to = await allow(server, admin, s.requestId, { agent: 'new', name: 'Codes 2', spaces: [] });
    const byOther = await call(server, 'POST', '/oauth/token', { form: { grant_type: 'authorization_code', code: to.searchParams.get('code'), code_verifier: s.pk.verifier, client_id: other.client_id, redirect_uri: client.redirect_uris[0] } });
    assert.equal(byOther.json.error, 'invalid_grant', 'another client');
    s = await startSignIn(server, client);
    to = await allow(server, admin, s.requestId, { agent: 'new', name: 'Codes 3', spaces: [] });
    assert.equal((await exchange(server, client, to.searchParams.get('code'), s.pk.verifier, { resource: 'https://elsewhere.example/mcp' })).json.error, 'invalid_target', 'another resource');
    s = await startSignIn(server, client);
    to = await allow(server, admin, s.requestId, { agent: 'new', name: 'Codes 4', spaces: [] });
    assert.equal((await exchange(server, client, to.searchParams.get('code'), s.pk.verifier, { redirect_uri: 'https://app.example/other' })).json.error, 'invalid_grant', 'another redirect');
    s = await startSignIn(server, client);
    to = await allow(server, admin, s.requestId, { agent: 'new', name: 'Codes 5', spaces: [] });
    const good = await exchange(server, client, to.searchParams.get('code'), s.pk.verifier);
    ok(good, 'traded');
    const key = toolJson(await tool(server, 'me', {}, { token: good.json.access_token })).agent.key;
    const again = await exchange(server, client, to.searchParams.get('code'), s.pk.verifier);
    assert.equal(again.json.error, 'invalid_grant');
    assert.match(again.json.error_description, /connection it made has ended/);
    assert.equal((await tool(server, 'me', {}, { token: good.json.access_token })).status, 401, 'the connection ended');
    assert.equal((await refresh(server, client, good.json.refresh_token)).json.error, 'invalid_grant', 'its refresh token too');
    assert.ok(logLines(single, key).some((l) => l.event === 'reused'), 'the reused line');
    assert.equal((await call(server, 'GET', `/api/users/${key}/token`, { cookie: admin })).json.connection, null);
    assert.equal((await exchange(server, client, 'A'.repeat(43), s.pk.verifier)).json.error, 'invalid_grant', 'an unknown code');
    assert.equal((await call(server, 'POST', '/oauth/token', { form: { grant_type: 'password', client_id: client.client_id } })).json.error, 'unsupported_grant_type');
  });

  await test('refresh rotates; an old refresh token used again ends the connection', async () => {
    const c = await connect(server, admin, { agent: 'new', name: 'Rotor', spaces: [S1] });
    const key = toolJson(await tool(server, 'me', {}, { token: c.tokens.access_token })).agent.key;
    const r1 = await refresh(server, c.client, c.tokens.refresh_token, { resource: `${O}/mcp` });
    ok(r1, 'refreshed');
    assert.notEqual(r1.json.refresh_token, c.tokens.refresh_token);
    assert.notEqual(r1.json.access_token, c.tokens.access_token);
    assert.equal((await tool(server, 'me', {}, { token: c.tokens.access_token })).status, 401, 'the old access token ended');
    toolJson(await tool(server, 'me', {}, { token: r1.json.access_token }));
    assert.equal((await refresh(server, c.client, r1.json.refresh_token, { resource: 'https://elsewhere.example/mcp' })).json.error, 'invalid_target', 'another resource');
    const other = await newClient(server);
    assert.equal((await refresh(server, other, r1.json.refresh_token)).json.error, 'invalid_grant', 'another client');
    const r2 = await refresh(server, c.client, r1.json.refresh_token);
    ok(r2, 'refreshed again');
    const reuse = await refresh(server, c.client, c.tokens.refresh_token);
    assert.equal(reuse.json.error, 'invalid_grant');
    assert.match(reuse.json.error_description, /connection has ended/);
    assert.equal((await tool(server, 'me', {}, { token: r2.json.access_token })).status, 401, 'the newest access token ended with it');
    assert.equal((await refresh(server, c.client, r2.json.refresh_token)).json.error, 'invalid_grant', 'and the newest refresh token');
    assert.ok(logLines(single, key).some((l) => l.event === 'reused' && l.by === null));
  });

  await test('Revoke, Turn off and Agents off stop it on the next call', async () => {
    const c = await connect(server, admin, { agent: 'new', name: 'Stopper', spaces: [S1] });
    const key = toolJson(await tool(server, 'me', {}, { token: c.tokens.access_token })).agent.key;
    ok(await call(server, 'PATCH', `/api/users/${key}`, { cookie: admin, body: { off: true } }), 'turned off');
    assert.equal((await tool(server, 'me', {}, { token: c.tokens.access_token })).status, 401, 'off');
    assert.equal((await refresh(server, c.client, c.tokens.refresh_token)).json.error, 'invalid_grant', 'no token for an agent turned off');
    ok(await call(server, 'PATCH', `/api/users/${key}`, { cookie: admin, body: { off: false } }), 'on again');
    toolJson(await tool(server, 'me', {}, { token: c.tokens.access_token }));
    ok(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { agents: false } }), 'Agents off');
    assert.equal((await tool(server, 'me', {}, { token: c.tokens.access_token })).status, 401, 'Agents off');
    ok(await call(server, 'GET', '/.well-known/oauth-authorization-server'), 'the metadata still answers');
    const { requestId } = await startSignIn(server, c.client);
    const v = (await call(server, 'GET', `/api/oauth/requests/${requestId}`, { cookie: admin })).json;
    assert.equal(v.agentsOn, false);
    assert.equal(v.form, undefined, 'nothing to approve while agents are off');
    ok(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { agents: true } }), 'Agents on');
    toolJson(await tool(server, 'me', {}, { token: c.tokens.access_token }));
    const revoked = await call(server, 'DELETE', `/api/users/${key}/token`, { cookie: admin });
    ok(revoked, 'revoked');
    assert.equal(revoked.json.revoked, true);
    const r = await tool(server, 'me', {}, { token: c.tokens.access_token });
    assert.equal(r.status, 401);
    assert.equal(r.json.error, INVALID);
    assert.equal((await refresh(server, c.client, c.tokens.refresh_token)).json.error, 'invalid_grant');
    assert.ok(logLines(single, key).some((l) => l.event === 'ended' && typeof l.by === 'string'), 'the ended line');
  });

  await test('one way in per agent: allowing ends a pasted token; making a token ends the connection', async () => {
    const agent = (await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true, displayName: 'Both' } })).json.user;
    const pasted = keep((await call(server, 'POST', `/api/users/${agent.key}/token`, { cookie: admin })).json.token);
    ok(await call(server, 'GET', '/api/agent/me', { token: pasted }), 'the pasted token works');
    const client = await newClient(server);
    const { requestId, pk } = await startSignIn(server, client);
    const v = (await call(server, 'GET', `/api/oauth/requests/${requestId}`, { cookie: admin })).json;
    assert.deepEqual(v.agents.find((a) => a.key === agent.key), { key: agent.key, name: 'Both', kind: 'agent', hasToken: true, connected: false });
    const bad = await call(server, 'POST', `/api/oauth/requests/${requestId}/allow`, { cookie: admin, body: { form: v.form, agent: agent.key, name: 'Renamed', spaces: [] } });
    assert.equal(bad.status, 400, 'an existing agent keeps its name');
    const nobody = await call(server, 'POST', `/api/oauth/requests/${requestId}/allow`, { cookie: admin, body: { form: v.form, agent: 'zzzz9999', spaces: [] } });
    assert.equal(nobody.status, 404);
    const person = await call(server, 'POST', `/api/oauth/requests/${requestId}/allow`, { cookie: admin, body: { form: v.form, agent: mia.key, spaces: [] } });
    assert.equal(person.status, 400);
    assert.equal(person.json.error, 'That account is not an agent.');
    const extra = await call(server, 'POST', `/api/oauth/requests/${requestId}/allow`, { cookie: admin, body: { form: v.form, agent: agent.key, spaces: [], scope: 'everything' } });
    assert.equal(extra.status, 400, 'the app\'s request never chooses: no other field');
    assert.equal((await call(server, 'POST', `/api/oauth/requests/${requestId}/allow`, { cookie: admin, body: { form: v.form, agent: agent.key, spaces: ['lobby'] } })).status, 404, 'never the Lobby');
    assert.equal((await call(server, 'POST', `/api/oauth/requests/${requestId}/allow`, { cookie: admin, body: { form: v.form, agent: agent.key, spaces: [], expires: '5y' } })).status, 400, 'a lifetime of the list');
    const r = await call(server, 'POST', `/api/oauth/requests/${requestId}/allow`, { cookie: admin, body: { form: v.form, agent: agent.key, spaces: [S2] } });
    ok(r, 'allowed for the existing agent');
    const t = await exchange(server, client, new URL(r.json.redirect).searchParams.get('code'), pk.verifier);
    ok(t, 'traded');
    keep(t.json.access_token); keep(t.json.refresh_token);
    assert.equal((await call(server, 'GET', '/api/agent/me', { token: pasted })).status, 401, 'the pasted token ended');
    assert.deepEqual(toolJson(await tool(server, 'me', {}, { token: t.json.access_token })).spaces, [{ id: S2, name: 'Elsewhere' }]);
    const view = (await call(server, 'GET', `/api/users/${agent.key}/token`, { cookie: admin })).json;
    assert.equal(view.token, null);
    assert.ok(view.connection);
    const fresh = keep((await call(server, 'POST', `/api/users/${agent.key}/token`, { cookie: admin })).json.token);
    assert.equal((await tool(server, 'me', {}, { token: t.json.access_token })).status, 401, 'making a token ends the connection');
    assert.equal((await refresh(server, client, t.json.refresh_token)).json.error, 'invalid_grant');
    ok(await call(server, 'GET', '/api/agent/me', { token: fresh }), 'the new token works');
    const after = (await call(server, 'GET', `/api/users/${agent.key}/token`, { cookie: admin })).json;
    assert.equal(after.connection, null);
    assert.ok(after.token);
    // Connecting it again ends that token, and an earlier connection too.
    const c1 = await connect(server, admin, { agent: agent.key, spaces: [] });
    assert.equal((await call(server, 'GET', '/api/agent/me', { token: fresh })).status, 401);
    const c2 = await connect(server, admin, { agent: agent.key, spaces: [] });
    assert.equal((await tool(server, 'me', {}, { token: c1.tokens.access_token })).status, 401, 'the earlier connection ended');
    toolJson(await tool(server, 'me', {}, { token: c2.tokens.access_token }));
  });

  await test('a secret client must send its secret, the way it registered', async () => {
    const reg = await register(server, { client_name: 'Secret', redirect_uris: ['https://s.example/cb'] });
    const client = reg.json;
    const s = await startSignIn(server, client);
    const to = await allow(server, admin, s.requestId, { agent: 'new', name: 'Secret', spaces: [] });
    const code = to.searchParams.get('code');
    const none = await exchange(server, client, code, s.pk.verifier);
    assert.equal(none.status, 401);
    assert.equal(none.json.error, 'invalid_client');
    const s2 = await startSignIn(server, client);
    const to2 = await allow(server, admin, s2.requestId, { agent: 'new', name: 'Secret 2', spaces: [] });
    const basic = `Basic ${Buffer.from(`${encodeURIComponent(client.client_id)}:${encodeURIComponent(client.client_secret)}`).toString('base64')}`;
    const wrongSecret = `Basic ${Buffer.from(`${client.client_id}:nope`).toString('base64')}`;
    assert.equal((await exchange(server, client, to2.searchParams.get('code'), s2.pk.verifier, {}, { headers: { authorization: wrongSecret } })).status, 401, 'a wrong secret');
    const s3 = await startSignIn(server, client);
    const to3 = await allow(server, admin, s3.requestId, { agent: 'new', name: 'Secret 3', spaces: [] });
    ok(await exchange(server, client, to3.searchParams.get('code'), s3.pk.verifier, {}, { headers: { authorization: basic } }), 'with its secret');
  });

  await test('five wrong token requests in a row block the address', async () => {
    const client = await newClient(server);
    const ip = freshIp();
    for (let i = 0; i < 5; i += 1) assert.equal((await refresh(server, client, `ort_${'q'.repeat(43)}`, {}, { ip })).status, 400, `wrong ${i}`);
    const blocked = await refresh(server, client, `ort_${'q'.repeat(43)}`, {}, { ip });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers['retry-after']) > 0);
    assert.equal(blocked.json.error, 'invalid_request');
  });

  await test('a connection past its end is refused', async () => {
    const c = await connect(server, admin, { agent: 'new', name: 'Ending', spaces: [] });
    const key = toolJson(await tool(server, 'me', {}, { token: c.tokens.access_token })).agent.key;
    await server.stop();
    const file = path.join(single, 'tokens.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const conn = data.tokens.find((t) => t.kind === 'connection' && t.user === key);
    // One clock read: two reads a millisecond apart make a life of 30 days and a millisecond, which the server rightly
    // refuses to load as a hand-made record (the connection is then gone, not ended).
    const now = Date.now();
    conn.createdAt = new Date(now - 31 * 86400000).toISOString();
    conn.expiresAt = new Date(now - 86400000).toISOString();
    fs.writeFileSync(file, JSON.stringify(data));
    const again = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1', AGENT_TOKENS: 'true' });
    server.port = again.port;
    server.child = again.child;
    server.stop = again.stop;
    assert.equal((await tool(server, 'me', {}, { token: c.tokens.access_token })).status, 401, 'past its end');
    assert.equal((await refresh(server, c.client, c.tokens.refresh_token)).json.error, 'invalid_grant');
    const view = (await call(server, 'GET', `/api/users/${key}/token`, { cookie: admin })).json.connection;
    assert.ok(view && Date.parse(view.expiresAt) < Date.now(), `shown as ended: ${JSON.stringify(view)}`);
  });

  await test('an expired code (60 seconds) is refused', async () => {
    const left = 61000 - (Date.now() - lateAt);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
    // The server restarted above, which ends every code in memory; this one was kept by nothing but memory either way, so
    // it is refused. The 60 seconds are checked on a fresh code below.
    assert.equal((await exchange(server, lateClient, lateTo.searchParams.get('code'), late.pk.verifier)).json.error, 'invalid_grant');
    const s = await startSignIn(server, lateClient);
    const to = await allow(server, admin, s.requestId, { agent: 'new', name: 'Late 2', spaces: [] });
    await new Promise((r) => setTimeout(r, 61000));
    const r = await exchange(server, lateClient, to.searchParams.get('code'), s.pk.verifier);
    assert.equal(r.json.error, 'invalid_grant');
    assert.match(r.json.error_description, /expired/);
  });

  // --- set-up agents ------------------------------------------------------------------------------------------------
  await test('the set-up kind only when AGENT_SETUP and Set-up agents are on', async () => {
    const c = await connect(server, admin, { agent: 'new', name: 'Ordinary', spaces: [] });
    const { requestId } = await startSignIn(server, c.client);
    const v = (await call(server, 'GET', `/api/oauth/requests/${requestId}`, { cookie: admin })).json;
    const no = await call(server, 'POST', `/api/oauth/requests/${requestId}/allow`, { cookie: admin, body: { form: v.form, agent: 'new', kind: 'setup', spaces: [] } });
    assert.equal(no.status, 403);
    assert.equal(no.json.error, 'Set-up agents are off on this server.');
    const setupDir = path.join(base, 'setup');
    const sv = await startServer(setupDir, { ADMIN_PASSWORD: 'admin-password-1', AGENT_TOKENS: 'true', AGENT_SETUP: 'true' });
    const sAdmin = await signIn(sv, 'admin', 'admin-password-1');
    ok(await call(sv, 'PATCH', '/api/settings', { cookie: sAdmin, body: { agents: true } }), 'Agents on');
    const client = await newClient(sv);
    let s = await startSignIn(sv, client);
    let view = (await call(sv, 'GET', `/api/oauth/requests/${s.requestId}`, { cookie: sAdmin })).json;
    assert.deepEqual(view.kinds, ['agent'], 'Set-up agents off in the environment');
    const off = await call(sv, 'POST', `/api/oauth/requests/${s.requestId}/allow`, { cookie: sAdmin, body: { form: view.form, agent: 'new', kind: 'setup', spaces: [] } });
    assert.equal(off.status, 403);
    assert.match(off.json.error, /^Set-up agents are off in this .+\. Turn on Set-up agents in Manage first\.$/);
    ok(await call(sv, 'PATCH', '/api/settings', { cookie: sAdmin, body: { setupAgents: true } }), 'Set-up agents on');
    view = (await call(sv, 'GET', `/api/oauth/requests/${s.requestId}`, { cookie: sAdmin })).json;
    assert.deepEqual(view.kinds, ['agent', 'setup']);
    const sp = (await call(sv, 'POST', '/api/spaces', { cookie: sAdmin, body: { name: 'Any' } })).json.space.id;
    const withSpaces = await call(sv, 'POST', `/api/oauth/requests/${s.requestId}/allow`, { cookie: sAdmin, body: { form: view.form, agent: 'new', kind: 'setup', spaces: [sp] } });
    assert.equal(withSpaces.status, 400, 'a set-up agent takes no spaces');
    const r = await call(sv, 'POST', `/api/oauth/requests/${s.requestId}/allow`, { cookie: sAdmin, body: { form: view.form, agent: 'new', kind: 'setup', spaces: [] } });
    ok(r, 'a set-up agent connected');
    const t = await exchange(sv, client, new URL(r.json.redirect).searchParams.get('code'), s.pk.verifier);
    ok(t, 'traded');
    keep(t.json.access_token); keep(t.json.refresh_token);
    const tools = (await rpc(sv, 'tools/list', {}, { token: t.json.access_token })).json.result.tools.map((x) => x.name);
    assert.ok(tools.includes('make_space') && !tools.includes('read_chat'), 'its own tools');
    assert.equal(toolJson(await tool(sv, 'me', {}, { token: t.json.access_token })).kind, 'setup');
    ok(await call(sv, 'PATCH', '/api/settings', { cookie: sAdmin, body: { setupAgents: false } }), 'Set-up agents off');
    assert.equal((await tool(sv, 'me', {}, { token: t.json.access_token })).status, 401, 'stops it');
    s = await startSignIn(sv, client);
    view = (await call(sv, 'GET', `/api/oauth/requests/${s.requestId}`, { cookie: sAdmin })).json;
    assert.ok(!view.agents.some((a) => a.kind === 'setup'), 'no set-up agent to pick while they are off');
    await sv.stop();
    for (const [file, text] of filesOf(setupDir)) for (const sec of secrets) assert.ok(!text.includes(sec), `no secret in ${file}`);
  });

  await test('nothing in the clear: no token, code, verifier or secret in DATA_DIR or the server\'s output', async () => {
    assert.ok(secrets.size > 20, `secrets to look for: ${secrets.size}`);
    const all = servers.map((s) => s.out).join('\n');
    for (const sec of secrets) assert.ok(!all.includes(sec), `not in the output: ${sec.slice(0, 8)}...`);
    for (const [file, text] of filesOf(single)) for (const sec of secrets) assert.ok(!text.includes(sec), `not in ${file}: ${sec.slice(0, 8)}...`);
  });
  await server.stop();

  // --- hosted ---------------------------------------------------------------------------------------------------------
  await test('hosted: each environment its own issuer, apps and tokens; the product host and the console have none', async () => {
    const hostedDir = path.join(base, 'hosted');
    const hosted = await startServer(hostedDir, { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-1', AGENT_TOKENS: 'true' });
    const host = await signIn(hosted, 'boss', 'host-password-1', 'admin');
    for (const slug of ['acme', 'beta']) ok(await call(hosted, 'POST', '/api/host/environments', { host: 'admin', cookie: host, body: { slug, name: slug, owner: { login: 'owner', password: 'owner-password-1' } } }), `${slug} made`, 201);
    const acme = await signIn(hosted, 'owner', 'owner-password-1', 'acme');
    const beta = await signIn(hosted, 'owner', 'owner-password-1', 'beta');
    for (const [slug, cookie] of [['acme', acme], ['beta', beta]]) ok(await call(hosted, 'PATCH', '/api/settings', { host: slug, cookie, body: { agents: true } }), `${slug} Agents on`);
    assert.equal((await call(hosted, 'GET', '/.well-known/oauth-authorization-server', { host: 'acme' })).json.issuer, origin(hosted, 'acme'));
    assert.equal((await call(hosted, 'GET', '/.well-known/oauth-authorization-server', { host: 'beta' })).json.issuer, origin(hosted, 'beta'));
    assert.equal((await call(hosted, 'GET', '/.well-known/oauth-protected-resource/mcp', { host: 'beta' })).json.resource, `${origin(hosted, 'beta')}/mcp`);
    for (const h of ['admin', undefined]) {
      const r = await call(hosted, 'GET', '/.well-known/oauth-authorization-server', { headers: { host: h ? `${h}.localhost:${hosted.port}` : `localhost:${hosted.port}` } });
      assert.ok(!r.text.includes('authorization_endpoint'), `${h || 'the product host'} has no sign-in`);
    }
    const c = await connect(hosted, acme, { agent: 'new', name: 'Acme bot', spaces: [] }, { host: 'acme' });
    toolJson(await tool(hosted, 'me', {}, { host: 'acme', token: c.tokens.access_token }));
    const there = await tool(hosted, 'me', {}, { host: 'beta', token: c.tokens.access_token });
    assert.equal(there.status, 401, 'an acme token at beta');
    assert.equal(there.json.error, INVALID);
    assert.equal(there.headers['www-authenticate'], `Bearer resource_metadata="${origin(hosted, 'beta')}/.well-known/oauth-protected-resource/mcp", scope="agent"`);
    const pk = pkce();
    const unknown = await authorize(hosted, { response_type: 'code', client_id: c.client.client_id, redirect_uri: c.client.redirect_uris[0], code_challenge: pk.challenge, code_challenge_method: 'S256' }, { host: 'beta' });
    assert.equal(unknown.status, 400, 'an acme app is unknown at beta');
    assert.equal(unknown.headers.location, undefined);
    assert.equal((await refresh(hosted, c.client, c.tokens.refresh_token, {}, { host: 'beta' })).json.error, 'invalid_client', 'and at its token route');
    assert.ok(fs.existsSync(path.join(hostedDir, 'environments', 'acme', 'oauth-clients.json')));
    assert.ok(!fs.existsSync(path.join(hostedDir, 'environments', 'beta', 'oauth-clients.json')), 'nothing registered at beta');
    await hosted.stop();
    for (const [file, text] of filesOf(hostedDir)) for (const sec of secrets) assert.ok(!text.includes(sec), `no secret in ${file}`);
  });
} catch (err) {
  failed += 1;
  console.error(err.stack || err);
} finally {
  await Promise.all(servers.map((s) => s.stop()));
  fs.rmSync(base, { recursive: true, force: true });
}

// Every file under a folder, as text.
function filesOf(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push([path.relative(dir, p), fs.readFileSync(p).toString('latin1')]);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

if (failed) {
  console.error(`check-oauth: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-oauth: ${n} passed`);
