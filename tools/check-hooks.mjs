#!/usr/bin/env node
/*
 * check-hooks.mjs -- a module's schedule firing from the server's timer, outside any request.
 *   - ModuleHooks on its own: the tick runs inside its environment (runIn); a listener that throws is logged, the other
 *     listeners still hear, and the notification is stored all the same; a schedule that cannot be delivered does not
 *     stop the others.
 *   - A real server, a single install and one with BASE_DOMAIN: a person has /api/notifications/stream and
 *     /api/modules/stream open while the Calendar's reminder fires. The server stays up, the stream carries the
 *     notification, and it is stored (GET /api/notifications). This used to stop the process: the stream's listener
 *     read the environment's services from the timer, where there is no environment.
 *   - The same notifications stream carries a bare `modules` event when a module is turned off or on in Manage > Modules
 *     (a space's bar asks again, no reload), in both installs, and never to a person in another environment.
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
const { ModuleHooks } = require('../server/module-hooks.js');

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
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-hooks-'));

// --- ModuleHooks on its own ---------------------------------------------------------------------------------------
await test('hooks: the tick runs in its environment; a throwing listener loses nothing and the others still hear', () => {
  const hooks = new ModuleHooks(path.join(base, 'unit'), { resolveRecipients: () => ['ann', 'bo'] });
  const ctx = { manifest: { id: 'cal', hooks: { notify: true } }, scope: 'environment', scopeKey: 'environment', spaceId: null, by: 'ann' };
  hooks.schedule(ctx, { key: 'a', at: Date.now(), notify: { title: 'Pack' } });
  let ranIn = 0;
  hooks.runIn = (fn) => { ranIn += 1; return fn(); };
  const heard = [];
  const quiet = console.error;
  const logged = [];
  console.error = (line) => logged.push(String(line));
  try {
    hooks.on('notification', () => { throw new Error('no environment resolved for this request'); });
    hooks.on('notification', ({ userKey }) => heard.push(userKey));
    hooks.on('fire', () => { throw new Error('a fire listener broke'); });
    hooks.on('fire', ({ key }) => heard.push(`fire:${key}`));
    hooks.safeTick();
  } finally {
    console.error = quiet;
  }
  assert.equal(ranIn, 1, 'the tick ran through runIn');
  assert.deepEqual(heard, ['ann', 'bo', 'fire:a']);
  assert.deepEqual([hooks.list('ann').map((x) => x.title), hooks.list('bo').map((x) => x.title)], [['Pack'], ['Pack']]);
  const stored = JSON.parse(fs.readFileSync(path.join(base, 'unit', 'notifications.json'), 'utf8'));
  assert.deepEqual(Object.keys(stored).sort(), ['ann', 'bo'], 'written to disk');
  assert.equal(hooks.schedules.length, 0);
  assert.equal(logged.length, 3, logged.join('\n'));
});

await test('hooks: one schedule that cannot be delivered does not stop the others, and a failing tick does not throw', () => {
  let calls = 0;
  const hooks = new ModuleHooks(path.join(base, 'unit2'), { resolveRecipients: () => { calls += 1; if (calls === 1) throw new Error('broken'); return ['ann']; } });
  const ctx = { manifest: { id: 'cal', hooks: { notify: true } }, scope: 'environment', scopeKey: 'environment', spaceId: null, by: 'ann' };
  hooks.schedule(ctx, { key: 'a', at: Date.now(), notify: { title: 'One' } });
  hooks.schedule(ctx, { key: 'b', at: Date.now(), notify: { title: 'Two' } });
  const quiet = console.error;
  console.error = () => {};
  try {
    hooks.safeTick();
    hooks.runIn = () => { throw new Error('no environment'); };
    assert.doesNotThrow(() => hooks.safeTick());
  } finally {
    console.error = quiet;
  }
  assert.deepEqual(hooks.list('ann').map((x) => x.title), ['Two']);
});

// --- a real server ------------------------------------------------------------------------------------------------
async function startServer(dataDir, extraEnv) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, TZ: 'UTC', ...extraEnv },
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
  return {
    port,
    alive: () => child.exitCode === null && child.signalCode === null,
    output: () => out,
    stop: () => new Promise((resolve) => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); }),
  };
}
function call(server, host, method, urlPath, { body, cookie } = {}) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { host: `${host ? `${host}.` : ''}localhost:${server.port}`, accept: 'application/json' };
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
function openStream(server, host, urlPath, cookie) {
  let text = '';
  const req = http.request({ host: '127.0.0.1', port: server.port, path: urlPath, headers: { host: `${host ? `${host}.` : ''}localhost:${server.port}`, cookie, accept: 'text/event-stream' } }, (res) => {
    res.on('data', (c) => { text += c.toString('utf8'); });
    res.on('error', () => {});
  });
  req.on('error', () => {});
  req.end();
  return { text: () => text, close: () => req.destroy() };
}

// Signs in, turns the Calendar on, opens both streams and schedules a reminder a second away. Answers what to look at.
async function arm(server, host, cookie, title) {
  assert.equal((await call(server, host, 'POST', '/api/modules/bundled/calendar/install', { cookie, body: {} })).status, 201);
  assert.equal((await call(server, host, 'PATCH', '/api/modules/calendar', { cookie, body: { enabled: true, allSpaces: true } })).status, 200);
  const notes = openStream(server, host, '/api/notifications/stream', cookie);
  const mods = openStream(server, host, '/api/modules/stream', cookie);
  await new Promise((r) => setTimeout(r, 300));
  const r = await call(server, host, 'POST', '/api/modules/calendar/schedule?scope=environment', { cookie, body: { key: 'remind:check', at: Date.now() + 1000, notify: { to: 'environment', title } } });
  assert.equal(r.status, 200, r.text);
  return { notes, mods };
}

const servers = [];
try {
  const single = await startServer(path.join(base, 'single'), { ADMIN_PASSWORD: 'testpass1234' });
  servers.push(single);
  const hosted = await startServer(path.join(base, 'hosted'), { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'host', ADMIN_PASSWORD: 'host-password-1' });
  servers.push(hosted);

  const singleCookie = cookieOf(await call(single, '', 'POST', '/api/login', { body: { login: 'admin', password: 'testpass1234' } }));
  const hostCookie = cookieOf(await call(hosted, 'admin', 'POST', '/api/host/login', { body: { login: 'host', password: 'host-password-1' } }));
  const made = await call(hosted, 'admin', 'POST', '/api/host/environments', { cookie: hostCookie, body: { slug: 'acme', name: 'Acme', owner: { login: 'owner', password: 'owner-password-1' } } });
  assert.equal(made.status, 201, made.text);
  const ownerCookie = cookieOf(await call(hosted, 'acme', 'POST', '/api/login', { body: { login: 'owner', password: 'owner-password-1' } }));

  const cases = [
    { name: 'a single install', server: single, host: '', cookie: singleCookie, title: 'Single reminder' },
    { name: 'BASE_DOMAIN', server: hosted, host: 'acme', cookie: ownerCookie, title: 'Hosted reminder' },
  ];
  for (const c of cases) c.armed = await arm(c.server, c.host, c.cookie, c.title);
  // The schedules' timer ticks every ten seconds.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !cases.every((c) => c.armed.notes.text().includes(c.title) || !c.server.alive())) await new Promise((r) => setTimeout(r, 250));

  for (const c of cases) {
    await test(`live, ${c.name}: a reminder firing with the streams open leaves the server up, sent and stored`, async () => {
      assert.ok(c.server.alive(), `the server stopped:\n${c.server.output().slice(-2000)}`);
      assert.ok(c.armed.notes.text().includes(`"title":"${c.title}"`), `the stream carried it:\n${c.armed.notes.text()}`);
      const list = await call(c.server, c.host, 'GET', '/api/notifications', { cookie: c.cookie });
      assert.equal(list.status, 200);
      assert.deepEqual(list.json.notifications.filter((x) => x.title === c.title).map((x) => [x.module, x.moduleName]), [['calendar', 'Calendar']]);
      assert.ok(!/no environment resolved/.test(c.server.output()), c.server.output().slice(-2000));
    });
  }
  const beta = await call(hosted, 'admin', 'POST', '/api/host/environments', { cookie: hostCookie, body: { slug: 'beta', name: 'Beta', owner: { login: 'owner', password: 'owner-password-1' } } });
  assert.equal(beta.status, 201, beta.text);
  const betaCookie = cookieOf(await call(hosted, 'beta', 'POST', '/api/login', { body: { login: 'owner', password: 'owner-password-1' } }));
  const betaNotes = openStream(hosted, 'beta', '/api/notifications/stream', betaCookie);
  for (const c of cases) {
    await test(`live, ${c.name}: turning a module off, then on, tells the open pages (a bare modules event), nobody in another environment`, async () => {
      const mine = openStream(c.server, c.host, '/api/notifications/stream', c.cookie);
      await new Promise((r) => setTimeout(r, 300));
      const count = (t) => (t.match(/^event: modules$/gm) || []).length;
      const was = count(mine.text());
      for (const [enabled, seen] of [[false, was + 1], [true, was + 2]]) {
        assert.equal((await call(c.server, c.host, 'PATCH', '/api/modules/calendar', { cookie: c.cookie, body: { enabled } })).status, 200);
        const until = Date.now() + 3000;
        while (Date.now() < until && count(mine.text()) < seen) await new Promise((r) => setTimeout(r, 50));
        assert.equal(count(mine.text()), seen, `enabled=${enabled}:\n${mine.text()}`);
      }
      assert.match(mine.text(), /event: modules\ndata: \{\}\n\n/, 'no module id goes with it');
      if (c.host) assert.equal(betaNotes.text().includes('event: modules'), false, 'the other environment heard it');
      mine.close();
    });
  }
  betaNotes.close();
  for (const c of cases) { c.armed.notes.close(); c.armed.mods.close(); }
} finally {
  for (const s of servers) await s.stop();
  fs.rmSync(base, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-hooks: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-hooks: OK (${n} groups)`);
