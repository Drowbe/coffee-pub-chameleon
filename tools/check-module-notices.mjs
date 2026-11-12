#!/usr/bin/env node
/*
 * check-module-notices.mjs -- the bell's notice about the bundled modules (server/module-notices.js).
 *   - The rule on its own: a brand new environment is told nothing and records every bundled module; one that existed
 *     before is told the bundled modules it has not installed; an installed, up to date module is never announced; an
 *     update waiting is announced once with its from and to versions; the same version is never announced twice; a module
 *     outside the plan is skipped.
 *   - A real server: a fresh data directory announces nothing; with the record removed (an environment from before this
 *     shipped) the admin gets one notice per module not installed, carrying the host's own name and icon; a restart does
 *     not repeat them; marking them read works and they stay read; a member gets none; a guest cannot ask; a module
 *     installed and current gives none.
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
const { plan, noticeText } = require('../server/module-notices.js');
const { compareVersions } = require('../server/modules.js');

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

// --- the rule on its own -------------------------------------------------------------------------------------------
const bundled = [
  { id: 'polls', name: 'Polls', version: '1.15.5', description: 'Ask a question.' },
  { id: 'budget', name: 'Budget', version: '0.1.1', description: 'Track what a trip costs.' },
];
const base = { bundled, installed: {}, record: null, fresh: false, waiting: () => false, allowed: () => true, compare: compareVersions };

await test('rule: a brand new environment is told nothing and records every bundled module', () => {
  const out = plan({ ...base, fresh: true });
  assert.deepEqual(out.notices, []);
  assert.deepEqual(out.record.announced, { polls: '1.15.5', budget: '0.1.1' });
});
await test('rule: an environment from before is told the modules it has not installed, once', () => {
  const out = plan({ ...base, installed: { polls: '1.15.5' } });
  assert.deepEqual(out.notices.map((x) => [x.kind, x.id]), [['new', 'budget']]);
  assert.equal(noticeText(out.notices[0], 'Budget').title, 'Budget is available');
  assert.equal(noticeText(out.notices[0], 'Budget').body, 'Track what a trip costs.');
  const again = plan({ ...base, installed: { polls: '1.15.5' }, record: out.record });
  assert.deepEqual(again.notices, []);
});
await test('rule: an installed, up to date module gets none, even with no record', () => {
  const out = plan({ ...base, installed: { polls: '1.15.5', budget: '0.1.1' } });
  assert.deepEqual(out.notices, []);
});
await test('rule: an update waiting is announced once, with from and to', () => {
  const state = { ...base, installed: { polls: '1.15.4', budget: '0.1.1' }, waiting: (id) => id === 'polls', record: { announced: { polls: '1.15.4', budget: '0.1.1' } } };
  const out = plan(state);
  assert.equal(out.notices.length, 1);
  const [u] = out.notices;
  assert.deepEqual([u.kind, u.id, u.from, u.version], ['update', 'polls', '1.15.4', '1.15.5']);
  assert.deepEqual(noticeText(u, 'Polls'), { title: 'Polls has an update (1.15.5)', body: 'From 1.15.4 to 1.15.5' });
  assert.deepEqual(plan({ ...state, record: out.record }).notices, [], 'the same version is not announced again');
  const next = plan({ ...state, bundled: [{ ...bundled[0], version: '1.15.6' }, bundled[1]], record: out.record });
  assert.deepEqual(next.notices.map((x) => x.version), ['1.15.6'], 'a newer version is announced');
});
await test('rule: a module not installed is announced as available once, not again for each version', () => {
  const out = plan({ ...base, installed: { polls: '1.15.5' }, record: { announced: { budget: '0.1.0' } } });
  assert.deepEqual(out.notices, []);
});
await test('rule: a module the plan leaves out is skipped', () => {
  const out = plan({ ...base, allowed: (id) => id !== 'budget' });
  assert.deepEqual(out.notices.map((x) => x.id), ['polls']);
});

// --- a real server ------------------------------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-module-notices-'));
async function startServer(dataDir) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, TZ: 'UTC', ADMIN_PASSWORD: 'testpass1234' },
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
  return { port, output: () => out, stop: () => new Promise((resolve) => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); }) };
}
function call(server, method, urlPath, { body, cookie } = {}) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { host: `localhost:${server.port}`, accept: 'application/json' };
  if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = payload.length; }
  if (cookie) headers.cookie = cookie;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const cookieOf = (res) => [].concat(res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
const login = async (server, who, password) => cookieOf(await call(server, 'POST', '/api/login', { body: { login: who, password } }));
// The host's own notices in a list.
const hostNotices = (res) => (res.json?.notifications || []).filter((x) => x.module === '$modules');
// Waits for the start-up announcement to be settled (it runs after the installs, a moment after listening).
const settled = async (dir) => {
  for (let i = 0; i < 100; i += 1) {
    if (fs.existsSync(path.join(dir, 'modules', 'announced.json'))) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the record of announced modules was never written');
};
const pause = () => new Promise((r) => setTimeout(r, 400));

const dir = path.join(tmp, 'data');
const ledger = path.join(dir, 'modules', 'announced.json');
let server;
try {
  await test('live: a brand new environment announces nothing and records the bundled modules', async () => {
    server = await startServer(dir);
    await settled(dir);
    await pause();
    const admin = await login(server, 'admin', 'testpass1234');
    assert.ok(admin, 'the admin signs in');
    const list = await call(server, 'GET', '/api/notifications', { cookie: admin });
    assert.equal(list.status, 200);
    assert.deepEqual(hostNotices(list), []);
    const record = JSON.parse(fs.readFileSync(ledger, 'utf8'));
    assert.ok(Object.keys(record.announced).length >= 5, 'every bundled module is recorded');
  });

  let available = [];
  await test('live: an environment from before is told each module it has not installed, once, as Modules', async () => {
    const admin = await login(server, 'admin', 'testpass1234');
    const state = (await call(server, 'GET', '/api/modules', { cookie: admin })).json;
    // One module is left uninstalled; the rest are installed and current.
    available = state.bundled.filter((b) => !b.installed).map((b) => b.id);
    for (const id of available.slice(1)) assert.equal((await call(server, 'POST', `/api/modules/bundled/${id}/install`, { cookie: admin, body: {} })).status, 201);
    const member = await call(server, 'POST', '/api/users', { cookie: admin, body: { login: 'maria', displayName: 'Maria', role: 'member', password: 'member-password-1' } });
    assert.equal(member.status, 201);
    await server.stop();
    fs.rmSync(ledger); // as an environment that has never been told
    server = await startServer(dir);
    await settled(dir);
    await pause();
    const cookie = await login(server, 'admin', 'testpass1234');
    const list = await call(server, 'GET', '/api/notifications', { cookie });
    const notes = hostNotices(list);
    assert.equal(notes.length, 1, `one notice for the one module left (${server.output()})`);
    const [note] = notes;
    const name = state.bundled.find((b) => b.id === available[0]).displayName || state.bundled.find((b) => b.id === available[0]).name;
    assert.equal(note.title, `${name} is available`);
    assert.ok(note.body.length > 0, 'one plain line about it');
    assert.equal(note.moduleName, 'Modules');
    assert.equal(note.icon, 'puzzle-piece');
    assert.equal(note.href, '/admin#modules');
    assert.equal(note.read, false);
    assert.equal(list.json.unread, 1);
  });

  await test('live: a restart does not repeat it, and marking it read keeps it read', async () => {
    let cookie = await login(server, 'admin', 'testpass1234');
    assert.equal((await call(server, 'POST', '/api/notifications/read', { cookie, body: {} })).status, 200);
    let list = await call(server, 'GET', '/api/notifications', { cookie });
    assert.equal(list.json.unread, 0);
    assert.equal(hostNotices(list).length, 1);
    await server.stop();
    server = await startServer(dir);
    await pause();
    cookie = await login(server, 'admin', 'testpass1234');
    list = await call(server, 'GET', '/api/notifications', { cookie });
    assert.equal(hostNotices(list).length, 1, 'still the one, not a second');
    assert.equal(list.json.unread, 0, 'and still read');
  });

  await test('live: a member sees none, a guest cannot ask', async () => {
    const maria = await login(server, 'maria', 'member-password-1');
    assert.ok(maria, 'the member signs in');
    const list = await call(server, 'GET', '/api/notifications', { cookie: maria });
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.notifications, []);
    assert.equal(list.json.unread, 0);
    assert.equal((await call(server, 'GET', '/api/notifications')).status, 401);
  });

  await test('live: with every module installed and current there is nothing to announce', async () => {
    let cookie = await login(server, 'admin', 'testpass1234');
    assert.equal((await call(server, 'POST', `/api/modules/bundled/${available[0]}/install`, { cookie, body: {} })).status, 201);
    await server.stop();
    fs.rmSync(ledger);
    fs.writeFileSync(path.join(dir, 'modules', 'notifications.json'), '{}');
    server = await startServer(dir);
    await settled(dir);
    await pause();
    cookie = await login(server, 'admin', 'testpass1234');
    const list = await call(server, 'GET', '/api/notifications', { cookie });
    assert.deepEqual(hostNotices(list), []);
  });
} finally {
  if (server) await server.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
}

// Every bell entry that does something (brand.js marks it data-manage or data-setup, with a role and a tab stop) shows it:
// a pointer, a hover state and a keyboard focus state in style.css.
await test('a clickable bell notice has a pointer, a hover and a focus-visible rule', () => {
  const brand = fs.readFileSync(path.join(ROOT, 'public', 'brand.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(brand, /data-manage="[^`]*role="link" tabindex="0"/);
  assert.match(brand, /data-setup="[^`]*role="link" tabindex="0"/);
  for (const attr of ['data-manage', 'data-setup']) {
    const rules = (css.match(/[^{}]+\{[^}]*\}/g) || []).filter((r) => r.split('{')[0].includes(`.bell-notice[${attr}]`));
    const has = (pseudo, prop) => rules.some((r) => r.split('{')[0].includes(pseudo) && prop.test(r.split('{')[1]));
    assert.ok(rules.some((r) => !r.split('{')[0].includes(':') && /cursor:\s*pointer/.test(r)), `${attr}: cursor pointer`);
    assert.ok(has(':hover', /background:/), `${attr}: hover background`);
    assert.ok(has(':focus-visible', /background:|box-shadow:|outline:\s*2px/), `${attr}: focus-visible state`);
  }
});

if (failed) {
  console.error(`${failed} of ${n + failed} module notice checks failed`);
  process.exit(1);
}
console.log(`module notices: ${n} checks passed`);
