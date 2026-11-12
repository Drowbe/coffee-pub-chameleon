#!/usr/bin/env node
/*
 * check-attention.mjs -- the attention store (documentation/plans/plan-space-status-strip.md, "Attention, the
 * contract", step 2): the shape check cleanReport(), the store (DATA_DIR/attention.json, atomic, the 7-day drop, the
 * clean-up for a space, a person and a module), and the routes PUT/DELETE /api/spaces/:id/attention/:module and GET
 * /api/spaces/:id/attention with their codes for a member, someone not in the space, a guest, nobody signed in and a
 * role without `write` in the module. The first two run in-process; the routes run against a throwaway server.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { Attention, cleanReport, LIMITS, MAX_AGE } = require('../server/attention.js');

let n = 0;
const ok = (cond, label) => { assert.ok(cond, label); n += 1; };
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `check-attention-${name}-`));
const DAY = 24 * 60 * 60 * 1000;

// --- the shape check ----------------------------------------------------------------------------------------------
{
  const refused = (body, label) => {
    const out = cleanReport(body);
    assert.ok(out.error && !out.report, `${label}: refused (${JSON.stringify(out)})`);
    assert.match(out.error, /^[A-Z][^\n]+\.$/, `${label}: one plain sentence (${out.error})`);
    n += 1;
  };
  assert.deepEqual(cleanReport({ count: 2, label: ' polls to vote in ', items: [{ title: 'Lunch?' }, { title: 'Dinner?', object: { module: 'polls', kind: 'poll', id: 'p1' } }] }).report,
    { count: 2, label: 'polls to vote in', items: [{ title: 'Lunch?' }, { title: 'Dinner?', object: { module: 'polls', kind: 'poll', id: 'p1' } }] });
  assert.deepEqual(cleanReport({ count: 0 }).report, { count: 0, label: '', items: [] }, 'count alone is a report');
  assert.equal(cleanReport({ count: 99 }).report.count, 99);
  assert.equal(cleanReport({ count: 1, label: 'x'.repeat(40) }).report.label.length, 40);
  assert.equal(cleanReport({ count: 1, items: Array.from({ length: 20 }, (_, i) => ({ title: `t${i}` })) }).report.items.length, 20);
  n += 5;
  refused(null, 'no body');
  refused([], 'an array');
  refused({}, 'no count');
  refused({ count: -1 }, 'negative');
  refused({ count: 100 }, 'over 99');
  refused({ count: 1.5 }, 'fraction');
  refused({ count: '3' }, 'text count');
  refused({ count: 1, label: 5 }, 'label not text');
  refused({ count: 1, label: 'x'.repeat(41) }, 'label over 40');
  refused({ count: 1, items: 'a' }, 'items not a list');
  refused({ count: 1, items: Array.from({ length: 21 }, () => ({ title: 'a' })) }, 'over 20 items');
  refused({ count: 1, items: [{}] }, 'item without a title');
  refused({ count: 1, items: [{ title: '  ' }] }, 'blank title');
  refused({ count: 1, items: [{ title: 'a', object: 'p1' }] }, 'object not an object');
  assert.equal(LIMITS.count, 99);
  assert.equal(MAX_AGE, 7 * DAY);
}

// --- the store ----------------------------------------------------------------------------------------------------
{
  const dir = tmp('store');
  let now = Date.UTC(2026, 9, 14);
  const a = new Attention(dir, () => now);
  a.set('s1', 'pat', 'polls', { count: 2, label: 'polls', items: [] });
  a.set('s1', 'pat', 'todo', { count: 3, label: 'due', items: [] });
  a.set('s1', 'sam', 'polls', { count: 1, label: 'polls', items: [] });
  a.set('s2', 'pat', 'polls', { count: 4, label: 'polls', items: [] });
  assert.deepEqual(a.list('s1', 'pat').map((r) => [r.module, r.count, r.at]), [['polls', 2, now], ['todo', 3, now]]);
  assert.deepEqual(a.list('s1', 'sam').map((r) => r.count), [1], 'another person has their own');
  assert.deepEqual(a.list('s1', 'nobody'), []);
  assert.ok(!fs.existsSync(path.join(dir, 'attention.json.tmp')), 'written by rename, no temp file left');
  n += 4;
  // Set again replaces; count 0 clears and leaves no empty entry in the file.
  a.set('s1', 'pat', 'polls', { count: 5, label: 'polls', items: [] });
  assert.equal(a.list('s1', 'pat').find((r) => r.module === 'polls').count, 5);
  a.set('s1', 'sam', 'polls', { count: 0, label: '', items: [] });
  assert.deepEqual(a.list('s1', 'sam'), []);
  assert.ok(!('sam' in JSON.parse(fs.readFileSync(path.join(dir, 'attention.json'), 'utf8')).spaces.s1), 'a cleared person leaves no entry');
  n += 3;
  // A fresh load reads the same; seven days on, reports are dropped on read (and not counted).
  const b = new Attention(dir, () => now);
  assert.deepEqual(b.list('s1', 'pat'), a.list('s1', 'pat'));
  now += 7 * DAY - 1000;
  assert.equal(b.list('s1', 'pat').length, 2, 'just under 7 days is kept');
  now += 2000;
  assert.deepEqual(b.list('s1', 'pat'), [], 'over 7 days is dropped');
  assert.deepEqual(new Attention(dir, () => now).list('s2', 'pat'), [], 'and dropped on load');
  n += 4;
  // Clean-up.
  now = Date.UTC(2026, 9, 14);
  const c = new Attention(dir, () => now);
  c.set('s1', 'pat', 'polls', { count: 1, label: '', items: [] });
  c.set('s1', 'pat', 'todo', { count: 1, label: '', items: [] });
  c.set('s2', 'pat', 'polls', { count: 1, label: '', items: [] });
  c.set('s2', 'sam', 'polls', { count: 1, label: '', items: [] });
  c.forgetModule('todo');
  assert.deepEqual(c.list('s1', 'pat').map((r) => r.module), ['polls']);
  c.forgetSpace('s1');
  assert.deepEqual(c.list('s1', 'pat'), []);
  c.forgetPerson('pat');
  assert.deepEqual(c.list('s2', 'pat'), []);
  assert.equal(c.list('s2', 'sam').length, 1, 'another person stays');
  n += 4;
  // A damaged or odd file reads as nothing, and a stored entry that is not a report is ignored.
  fs.writeFileSync(path.join(dir, 'attention.json'), '{ not json');
  assert.deepEqual(new Attention(dir, () => now).list('s1', 'pat'), []);
  fs.writeFileSync(path.join(dir, 'attention.json'), JSON.stringify({ spaces: { s1: { pat: { polls: { count: 'x', at: now }, todo: 7 } } } }));
  assert.deepEqual(new Attention(dir, () => now).list('s1', 'pat'), []);
  n += 2;
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- the routes, against a throwaway server -----------------------------------------------------------------------
const dataDir = tmp('server');
let child = null;
let port = 0;
let serverOut = '';
async function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir,
      ADMIN_PASSWORD: 'testpass1234',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverOut = '';
  child.stdout.on('data', (d) => { serverOut += d; });
  child.stderr.on('data', (d) => { serverOut += d; });
  port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${serverOut}`)); }, 25000);
    const onData = () => { const m = /listening on :(\d+)/.exec(serverOut); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${serverOut}`)); });
  });
}
const stopServer = () => new Promise((resolve) => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });

async function call(method, urlPath, { body, cookie } = {}) {
  const headers = { accept: 'application/json' };
  if (cookie) headers.cookie = `app_session=${cookie}`;
  let payload;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const expect = async (label, status, method, urlPath, options) => {
  const r = await call(method, urlPath, options);
  assert.equal(r.status, status, `${label}: ${method} ${urlPath} answered ${r.status} ${r.text}`);
  if (status >= 400) assert.match(r.json?.error || '', /^[A-Z].*\.$/, `${label}: one plain sentence (${r.text})`);
  n += 1;
  return r;
};

await startServer();
try {
  const login = async (name, password) => {
    const r = await call('POST', '/api/login', { body: { login: name, password } });
    assert.equal(r.status, 200, `${name} signs in: ${r.text}`);
    return r.json.token;
  };
  const owner = await login('admin', 'testpass1234');
  const mk = async (name) => (await call('POST', '/api/users', { cookie: owner, body: { login: name, displayName: name, role: 'member', password: 'memberpass1234' } })).json.user;
  const patUser = await mk('pat');
  const samUser = await mk('sam');
  await mk('out');
  // Bundled Polls (write is "vote") and To-do (write is "edit"), turned on for the environment.
  for (const id of ['polls', 'todo']) {
    const r = await call('POST', `/api/modules/bundled/${id}/install`, { cookie: owner });
    assert.ok(r.status === 201 || r.status === 200, `${id} installs: ${r.status} ${r.text}`);
    if (!r.json.module?.enabled) await expect(`${id} on`, 200, 'PATCH', `/api/modules/${id}`, { cookie: owner, body: { enabled: true } });
  }
  const S = (await call('POST', '/api/spaces', { cookie: owner, body: { name: 'Trip', members: [patUser.key, samUser.key] } })).json.space.id;
  const pat = await login('pat', 'memberpass1234');
  const sam = await login('sam', 'memberpass1234');
  const out = await login('out', 'memberpass1234');
  await expect('guests allowed', 200, 'PATCH', `/api/spaces/${S}`, { cookie: owner, body: { allowGuests: true } });
  const guestToken = (await expect('guest link', 200, 'POST', `/api/spaces/${S}/guest-link`, { cookie: owner, body: {} })).json.space.guestToken;
  const asGuest = `?guest=${encodeURIComponent(guestToken)}`;
  const A = `/api/spaces/${S}/attention`;
  const good = { count: 2, label: 'polls to vote in', items: [{ title: 'Lunch?', object: { module: 'polls', kind: 'poll', id: 'p1' } }, { title: 'Dinner?' }] };

  // Nothing yet.
  assert.deepEqual((await expect('empty', 200, 'GET', A, { cookie: pat })).json, { modules: [], total: 0 });

  // A member reports for a module they can write in; the answer carries the module's shown name.
  await expect('member reports', 200, 'PUT', `${A}/polls`, { cookie: pat, body: good });
  const one = (await expect('member reads', 200, 'GET', A, { cookie: pat })).json;
  assert.equal(one.total, 2);
  assert.equal(one.modules.length, 1);
  const m = one.modules[0];
  assert.deepEqual({ module: m.module, name: m.name, count: m.count, label: m.label, items: m.items }, { module: 'polls', name: 'Polls', count: 2, label: 'polls to vote in', items: good.items });
  ok(Number.isFinite(m.at) && Math.abs(Date.now() - m.at) < 60000, 'at is when it was reported');

  // Total sums across modules.
  await expect('second module', 200, 'PUT', `${A}/todo`, { cookie: pat, body: { count: 3, label: 'tasks due', items: [] } });
  const two = (await expect('two modules', 200, 'GET', A, { cookie: pat })).json;
  assert.equal(two.modules.length, 2);
  assert.equal(two.total, 5, 'the total is the sum of every module');

  // Another person's reports are not visible; a person not in the space and nobody signed in are refused.
  assert.deepEqual((await expect('sam sees none of pat\'s', 200, 'GET', A, { cookie: sam })).json, { modules: [], total: 0 });
  await expect('sam reports', 200, 'PUT', `${A}/polls`, { cookie: sam, body: { count: 7, label: 'polls', items: [] } });
  assert.equal((await call('GET', A, { cookie: sam })).json.total, 7, 'sam sees only his own');
  assert.equal((await call('GET', A, { cookie: pat })).json.total, 5, 'and pat is unchanged');
  n += 2;
  await expect('not in the space reads', 404, 'GET', A, { cookie: out });
  await expect('not in the space reports', 404, 'PUT', `${A}/polls`, { cookie: out, body: good });
  await expect('nobody signed in reads', 401, 'GET', A);
  await expect('nobody signed in reports', 401, 'PUT', `${A}/polls`, { body: good });
  await expect('no such space', 404, 'GET', '/api/spaces/nope/attention', { cookie: pat });
  await expect('no such module', 404, 'PUT', `${A}/nothing`, { cookie: pat, body: good });
  // A module kept out of the Lobby: one sentence that names no space word, since the Lobby is not one of the spaces.
  for (const method of ['PUT', 'DELETE']) {
    const lobby = await expect(`${method} in the Lobby`, 403, method, '/api/spaces/lobby/attention/polls', { cookie: owner, body: method === 'PUT' ? good : undefined });
    assert.equal(lobby.json.error, 'That module is not available here for you.');
  }

  // A guest has no person to keep it for: refused to read and to report.
  const g = await expect('guest reads', 403, 'GET', `${A}${asGuest}`);
  assert.match(g.json.error, /^Guests have no/);
  await expect('guest reports', 403, 'PUT', `${A}/polls${asGuest}`, { body: good });
  await expect('guest clears', 403, 'DELETE', `${A}/polls${asGuest}`);

  // A bad shape is a 400 with one sentence.
  for (const [label, body] of [
    ['count over 99', { count: 100, label: 'x', items: [] }],
    ['count negative', { count: -1 }],
    ['count text', { count: '3' }],
    ['count missing', { label: 'x' }],
    ['label too long', { count: 1, label: 'x'.repeat(41) }],
    ['too many items', { count: 1, items: Array.from({ length: 21 }, () => ({ title: 'a' })) }],
    ['item without a title', { count: 1, items: [{ object: { id: 1 } }] }],
    ['items not a list', { count: 1, items: {} }],
  ]) await expect(label, 400, 'PUT', `${A}/polls`, { cookie: pat, body });
  await expect('body not an object', 400, 'PUT', `${A}/polls`, { cookie: pat, body: [1] });
  assert.equal((await call('GET', A, { cookie: pat })).json.total, 5, 'a refused report changes nothing');
  n += 1;

  // Count 0 and DELETE clear one module's report.
  await expect('count 0 clears', 200, 'PUT', `${A}/todo`, { cookie: pat, body: { count: 0 } });
  const cleared = (await call('GET', A, { cookie: pat })).json;
  assert.deepEqual(cleared.modules.map((r) => r.module), ['polls']);
  assert.equal(cleared.total, 2);
  await expect('delete clears', 200, 'DELETE', `${A}/polls`, { cookie: pat });
  assert.deepEqual((await call('GET', A, { cookie: pat })).json, { modules: [], total: 0 });
  await expect('delete again is fine', 200, 'DELETE', `${A}/polls`, { cookie: pat });
  n += 3;

  // Without `write` in the module (Polls' "vote") a person cannot report for it, though they can still read.
  await expect('take vote from members', 200, 'PATCH', '/api/roles/member', { cookie: owner, body: { 'module.polls.vote': false } });
  const noWrite = await expect('no write', 403, 'PUT', `${A}/polls`, { cookie: sam, body: good });
  assert.match(noWrite.json.error, /^Your role can't do that in this module\.$/);
  await expect('no write clears', 403, 'DELETE', `${A}/polls`, { cookie: sam });
  await expect('still reads', 200, 'GET', A, { cookie: sam });
  await expect('write in another module', 200, 'PUT', `${A}/todo`, { cookie: sam, body: { count: 1, label: 'tasks', items: [] } });
  await expect('give vote back', 200, 'PATCH', '/api/roles/member', { cookie: owner, body: { 'module.polls.vote': true } });

  // Stale: reports older than 7 days are dropped. Stop the server, age one of pat's reports in the file, start again.
  await expect('pat reports again', 200, 'PUT', `${A}/polls`, { cookie: pat, body: { count: 4, label: 'polls', items: [] } });
  await expect('pat reports todo', 200, 'PUT', `${A}/todo`, { cookie: pat, body: { count: 6, label: 'tasks', items: [] } });
  await stopServer();
  const file = path.join(dataDir, 'attention.json');
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(Object.keys(stored.spaces[S][patUser.key]).sort().join(), 'polls,todo', 'stored per space, person and module');
  stored.spaces[S][patUser.key].polls.at = Date.now() - 8 * DAY;
  stored.spaces[S][patUser.key].todo.at = Date.now() - 6 * DAY;
  fs.writeFileSync(file, JSON.stringify(stored));
  n += 1;
  await startServer();
  const patAgain = await login('pat', 'memberpass1234');
  const fresh = (await expect('after 8 days', 200, 'GET', A, { cookie: patAgain })).json;
  assert.deepEqual(fresh.modules.map((r) => r.module), ['todo'], 'the 8-day-old report is dropped, the 6-day-old kept');
  assert.equal(fresh.total, 6);

  // A removed person's and a removed space's reports go with them.
  await expect('remove sam', 200, 'DELETE', `/api/users/${samUser.key}`, { cookie: owner });
  await expect('remove the space', 200, 'DELETE', `/api/spaces/${S}`, { cookie: owner });
  await stopServer();
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(after.spaces, {}, 'nothing is left of that space');
  n += 1;
} finally {
  await stopServer();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(`check-attention: ${n} checks passed`);
