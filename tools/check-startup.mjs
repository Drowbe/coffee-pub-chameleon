#!/usr/bin/env node
/*
 * check-startup.mjs -- the server starts with or without LiveKit (documentation/plans/plan-realtime-optional-livekit.md,
 * step 6, Verify point 6). Throwaway servers (PORT=0, a DATA_DIR under the temp folder), none with a LiveKit server:
 *   1. no LIVEKIT_ variable at all, only ADMIN_PASSWORD and DATA_DIR: it starts and says once "No LiveKit: voice and video
 *      are off"; branding().callService is false and no LiveKit address is handed out; the Conference card on Manage >
 *      Modules is off with "Voice and video are not set up on this server." and can't be switched on (503); the Conference
 *      is refused for a guest; spaces are made, a bundled module installs and opens on a space's canvas; POST
 *      /api/call/join answers 503.
 *   2. only one of the two keys: the same, with a warning naming the one missing.
 *   3. both (dummy) keys: as before -- callService true, the card on with no such sentence, the switch turned off and on
 *      again, and POST /api/call/join minting a token (no LiveKit server is needed to mint one).
 *   4. several environments (BASE_DOMAIN) and no keys: it starts and says there is no LiveKit.
 * The page side is read from the files: the card draws `unavailable` with its switch disabled, and the space page and the
 * profile read branding.callService (check-canvas and check-nav run the rules themselves).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NO = 'voice and video are not set up on this server';
const CARD = 'Voice and video are not set up on this server.';
let n = 0;
const same = (a, b, msg) => { assert.deepEqual(a, b, msg); n += 1; };
const ok = (cond, msg) => { assert.ok(cond, msg); n += 1; };

// A server with only the settings given (nothing from this shell's environment but PATH and HOME).
async function withServer(env, fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-startup-'));
  let out = '';
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, ADMIN_PASSWORD: 'testpass1234', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`the server did not start in time:\n${out}`)), 25000);
      const look = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
      child.stdout.on('data', look);
      child.stderr.on('data', look);
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
    });
    const call = async (method, urlPath, { body, cookie } = {}) => {
      const headers = { accept: 'application/json' };
      if (cookie) headers.cookie = `app_session=${cookie}`;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, json, text };
    };
    await fn({ call, log: () => out });
  } finally {
    if (child.exitCode === null) await new Promise((resolve) => { child.once('exit', resolve); child.kill('SIGTERM'); });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

const login = async (call) => (await call('POST', '/api/login', { body: { login: 'admin', password: 'testpass1234' } })).json.token;
const conferenceCard = async (call, cookie) => (await call('GET', '/api/modules', { cookie })).json.builtin.find((b) => b.id === 'conference');

// 1. No LiveKit at all.
await withServer({}, async ({ call, log }) => {
  same((log().match(/No LiveKit: voice and video are off\./g) || []).length, 1, `the log says once that there is no LiveKit:\n${log()}`);
  ok(/listening on :\d+, no LiveKit, data in/.test(log()), 'the start line says no LiveKit');
  const branding = (await call('GET', '/api/branding')).json;
  same(branding.callService, false, 'branding().callService is false');
  same((await call('GET', '/api/config')).json.livekitUrl, null, 'no LiveKit address in /api/config');
  const owner = await login(call);
  ok(owner, 'the admin signs in');
  const card = await conferenceCard(call, owner);
  same([card.enabled, card.unavailable], [false, CARD], 'the Conference card: off, with the sentence');
  same((await call('PATCH', '/api/settings', { cookie: owner, body: { conferenceEnabled: false } })).status, 200, 'switching it off is allowed');
  const on = await call('PATCH', '/api/settings', { cookie: owner, body: { conferenceEnabled: true } });
  same([on.status, on.json.error], [503, NO], 'switching it on is refused (503)');
  const made = await call('POST', '/api/spaces', { cookie: owner, body: { name: 'Hall' } });
  same(made.status, 200, `a space is made: ${made.text}`);
  const hall = made.json.space;
  const installed = (await call('GET', '/api/modules', { cookie: owner })).json.modules;
  ok(installed.some((m) => m.id === 'stream' && m.enabled), 'the Stream module installs itself and is on');
  const todo = await call('POST', '/api/modules/bundled/todo/install', { cookie: owner });
  ok([200, 201].includes(todo.status), `To-do installs: ${todo.text}`);
  if (!todo.json.module?.enabled) same((await call('PATCH', '/api/modules/todo', { cookie: owner, body: { enabled: true } })).status, 200, 'To-do is turned on');
  const canvas = await call('GET', `/api/modules/for-space?space=${hall.id}`, { cookie: owner });
  same(canvas.status, 200, 'the canvas lists its modules');
  ok(canvas.json.modules.some((m) => m.id === 'todo'), 'To-do opens on the canvas');
  const join = await call('POST', '/api/call/join', { cookie: owner, body: { space: hall.id } });
  same([join.status, join.json.error], [503, NO], 'POST /api/call/join: 503');
  const link = (await call('POST', `/api/spaces/${hall.id}/guest-link`, { cookie: owner, body: {} })).json.space.guestToken;
  const guest = await call('POST', '/api/guest-join', { body: { token: link, name: 'Kit' } });
  same([guest.status, guest.json.permissions.conference], [200, false], 'a guest enters, and the conference is refused');
  for (const page of ['/', '/admin', '/profile']) same((await fetch(`http://127.0.0.1:${(/listening on :(\d+)/.exec(log()))[1]}${page}`)).status, 200, `${page} is served`);
  ok(!/TypeError|ReferenceError|Unhandled/.test(log()), `nothing failed:\n${log()}`);
});

// 2. Only one of the two keys: no call service, and a warning naming the missing one.
await withServer({ LIVEKIT_API_KEY: 'devkey' }, async ({ call, log }) => {
  ok(/No LiveKit: LIVEKIT_API_SECRET is not set, so voice and video are off\./.test(log()), `the log names the missing secret:\n${log()}`);
  same((await call('GET', '/api/branding')).json.callService, false, 'callService false');
});

// 3. Both keys (no LiveKit server running): as before.
await withServer({ LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret' }, async ({ call, log }) => {
  ok(!/No LiveKit/.test(log()), 'nothing said about no LiveKit');
  ok(/listening on :\d+, LiveKit at localhost:7880, data in/.test(log()), 'the start line names LiveKit');
  same((await call('GET', '/api/branding')).json.callService, true, 'callService true');
  ok(typeof (await call('GET', '/api/config')).json.livekitUrl === 'string', 'a LiveKit address in /api/config');
  const owner = await login(call);
  const card = await conferenceCard(call, owner);
  same([card.enabled, card.unavailable], [true, undefined], 'the Conference card: on, no sentence');
  same((await call('PATCH', '/api/settings', { cookie: owner, body: { conferenceEnabled: false } })).status, 200, 'switched off');
  same((await call('PATCH', '/api/settings', { cookie: owner, body: { conferenceEnabled: true } })).status, 200, 'and on again');
  const join = await call('POST', '/api/call/join', { cookie: owner, body: { space: 'lobby' } });
  same(join.status, 200, `POST /api/call/join mints a token: ${join.text}`);
  ok(typeof join.json.token === 'string' && typeof join.json.livekitUrl === 'string', 'with the token and the address');
});

// 4. Several environments, no keys.
await withServer({ BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'host' }, async ({ log }) => {
  ok(/No LiveKit: voice and video are off\./.test(log()) && /listening on :\d+, no LiveKit, base domain localhost/.test(log()), `a hosted server starts with no LiveKit:\n${log()}`);
});

// The pages, read from the files.
const admin = fs.readFileSync(path.join(ROOT, 'public/admin.js'), 'utf8');
ok(/on: b\.enabled && !b\.unavailable, disabled: Boolean\(b\.unavailable\)/.test(admin), 'admin.js: the card\'s switch is off and disabled when the conference is unavailable');
ok(/b\.unavailable \? `<p><span class="sdk-status" data-tone="warn">\$\{escapeHtml\(b\.unavailable\)\}<\/span><\/p>`/.test(admin), 'admin.js: the card says why, once');
const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
ok(/callService: branding\.callService !== false/.test(space), 'space.js reads branding.callService');
ok(/const canInvite = features\.callService && features\.conferenceEnabled && features\.allowPrivate;/.test(space), 'space.js: Home offers no invitation to a private conversation with no call');
const profile = fs.readFileSync(path.join(ROOT, 'public/profile.js'), 'utf8');
ok(/conferenceOn = branding\.conferenceEnabled !== false && branding\.callService !== false;/.test(profile), 'profile.js: no Conference tab with no call service');
const host = fs.readFileSync(path.join(ROOT, 'public/module-host.js'), 'utf8');
ok(/if \(\(await brandingOnce\(\)\)\.callService === false\) \{/.test(host), 'module-host.js: host.media.watch answers unavailable with no call service, before loading LiveKit');

// 5. the port is taken: one plain sentence naming it, a non-zero exit, no TypeError.
await withServer({}, async ({ log }) => {
  const taken = Number(/listening on :(\d+)/.exec(log())[1]);
  const second = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(taken), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'check-startup-')), ADMIN_PASSWORD: 'testpass1234' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let said = '';
  second.stdout.on('data', (d) => { said += d; });
  second.stderr.on('data', (d) => { said += d; });
  const code = await new Promise((resolve) => second.once('exit', resolve));
  ok(code !== 0 && code !== null, `a taken port must exit non-zero (got ${code})`);
  ok(said.includes(`Port ${taken} is already in use. Another copy of the server may still be running`), `the taken port is named in a plain sentence:\n${said}`);
  ok(!/TypeError|at .*\.js:\d+/.test(said), `no TypeError or stack:\n${said}`);
});

console.log(`check-startup: ${n} checks passed`);
