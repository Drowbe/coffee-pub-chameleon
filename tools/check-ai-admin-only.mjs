#!/usr/bin/env node
/*
 * check-ai-admin-only.mjs -- the AI service's keys and settings are set only on the host console's AI tab (the host's
 * saved settings), never through environment variables.
 *   1. Nothing in server/, public/ or docker-compose.yml names the old variables (or the code that only read them).
 *   2. A single-environment server started WITH those variables set ignores them: the AI view offers nothing managed, has
 *      no key, and the start-up log is the same as without them.
 *   3. A hosted server started with them set offers nothing until the host admin saves a key on the AI tab (PUT
 *      /api/host/ai); then that company is offered, the key is never shown, and an environment sees it as Managed.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
const same = (a, b, msg) => { assert.deepEqual(a, b, msg); n += 1; };
const ok = (c, msg) => { assert.ok(c, msg); n += 1; };

// 1. The names, spelled in pieces so this file does not hold them as a block of its own.
const P = 'AI_';
const VARIABLES = ['OPENAI_KEY', 'ANTHROPIC_KEY', 'ANTHROPIC_WORKSPACE', 'KEY', 'PROVIDER', 'ADDRESS', 'MODEL'].map((v) => P + v);
const CODE = ['aiKey' + 'FromEnv', 'managed' + 'Slot', 'ai' + 'Seed', 'seed' + 'ManagedAi', 'key' + 'FromEnvironment', 'fromOneCompany' + 'Form', 'migration' + 'Seed'];
// managedSlot is the saved-only slot reader now; it stays, so it is not on this list.
CODE.splice(1, 1);
const pattern = new RegExp(`(?<![A-Za-z])(${VARIABLES.join('|')})\\b|\\b(${CODE.join('|')})\\b`);
const files = [];
const walk = (p) => {
  const st = fs.statSync(p);
  if (st.isDirectory()) { for (const f of fs.readdirSync(p)) walk(path.join(p, f)); return; }
  if (/\.(js|mjs|cjs|html|css|json|yml|yaml|svg)$/.test(p)) files.push(p);
};
for (const d of ['server', 'public']) walk(path.join(ROOT, d));
files.push(path.join(ROOT, 'docker-compose.yml'));
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => { if (pattern.test(line)) assert.fail(`${path.relative(ROOT, f)}:${i + 1} names a removed AI variable: ${line.trim().slice(0, 120)}`); });
}
n += files.length;

// Servers.
const SET = Object.fromEntries(VARIABLES.map((v) => [v, v === P + 'PROVIDER' ? 'openai' : v === P + 'ADDRESS' ? 'http://127.0.0.1:9' : 'sk-from-the-environment-0000']));
async function start(env) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-ai-admin-only-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, ADMIN_PASSWORD: 'testpass1234', ...env },
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
  const call = (host, method, urlPath, { body, cookie } = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { accept: 'application/json' };
    if (host) headers.host = `${host}.localhost:${port}`;
    if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = payload.length; }
    if (cookie) headers.cookie = cookie;
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
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
  const stop = async () => { if (child.exitCode === null) await new Promise((r) => { child.once('exit', r); child.kill('SIGTERM'); }); fs.rmSync(dataDir, { recursive: true, force: true }); };
  return { call, log: () => out, stop, dataDir };
}
// The start-up log without what differs between two runs (the port, the data folder).
const plain = (log, dataDir) => log.split(dataDir).join('<data>').replace(/:\d+/g, ':<port>').replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<time>');
const cookieOf = (res) => [].concat(res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');

// 2. A single-environment install, with and without the variables.
const baseline = await start({});
const withVars = await start(SET);
try {
  for (const s of [baseline, withVars]) {
    const login = await s.call('', 'POST', '/api/login', { body: { login: 'admin', password: 'testpass1234' } });
    same(login.status, 200, 'the admin signs in');
    const cookie = cookieOf(login);
    const view = (await s.call('', 'GET', '/api/ai', { cookie })).json.ai;
    same([view.source, view.managed.available, view.keySet, view.provider, view.active.provider], ['custom', false, false, 'none', 'none'], 'the AI view: nothing managed, no key, no service');
    ok(!('keyFromEnvironment' in view), 'the AI view has no keyFromEnvironment');
    // The page that sets it works: the admin saves a service and key in the app.
    const saved = await s.call('', 'PUT', '/api/ai', { cookie, body: { enabled: true, provider: 'compatible', address: 'http://127.0.0.1:9', model: 'm', key: 'typed-in-the-app' } });
    same(saved.status, 200, `the admin saves the AI setting: ${saved.text}`);
    same([saved.json.ai.keySet, saved.json.ai.active.provider], [true, 'compatible'], 'it is saved and in use');
    ok(!saved.text.includes('typed-in-the-app') && !saved.text.includes('from-the-environment'), 'no key is shown');
  }
  await new Promise((r) => setTimeout(r, 500)); // the first start's auto-install lines have landed
  same(plain(withVars.log(), withVars.dataDir), plain(baseline.log(), baseline.dataDir), 'the start-up log is the same with the variables set');
} finally {
  await baseline.stop();
  await withVars.stop();
}

// 3. A host with environments, with the variables set: the host console decides.
const host = await start({ ...SET, BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss' });
try {
  const login = await host.call('admin', 'POST', '/api/host/login', { body: { login: 'boss', password: 'testpass1234' } });
  same(login.status, 200, `host sign-in: ${login.text}`);
  const cookie = cookieOf(login);
  const before = (await host.call('admin', 'GET', '/api/host/ai', { cookie })).json.services;
  same(before.map((s) => [s.provider, s.keySet, s.offered]), [['openai', false, false], ['anthropic', false, false], ['compatible', false, false]], 'nothing is offered until a key is saved on the host');
  ok(before.every((s) => !('keyFromEnvironment' in s)), 'the host console rows have no keyFromEnvironment');
  const put = await host.call('admin', 'PUT', '/api/host/ai', { cookie, body: { provider: 'openai', key: 'sk-saved-on-the-host-1234' } });
  same(put.status, 200, `the key is saved on the host: ${put.text}`);
  const row = put.json.services.find((s) => s.provider === 'openai');
  same([row.keySet, row.offered], [true, true], 'OpenAI is offered, with a model chosen for it');
  ok(row.model, 'a model is chosen');
  ok(!put.text.includes('sk-saved-on-the-host-1234'), 'the key is never shown');
  const made = await host.call('admin', 'POST', '/api/host/environments', { cookie, body: { slug: 'beta', name: 'Beta', owner: { login: 'owner', password: 'owner-password-1' } } });
  same(made.status, 201, `an environment is made: ${made.text}`);
  const owner = await host.call('beta', 'POST', '/api/login', { body: { login: 'owner', password: 'owner-password-1' } });
  same(owner.status, 200, 'the owner signs in');
  const viewRes = await host.call('beta', 'GET', '/api/ai', { cookie: cookieOf(owner) });
  const view = viewRes.json.ai;
  same([view.source, view.managed.available, view.managed.services.map((s) => s.provider)], ['managed', true, ['openai']], 'the environment sees the host\'s service as Managed');
  ok(!viewRes.text.includes('sk-saved-on-the-host-1234') && !viewRes.text.includes('from-the-environment'), 'the environment never sees a key');
} finally {
  await host.stop();
}
console.log(`check-ai-admin-only: ${n} checks passed`);
