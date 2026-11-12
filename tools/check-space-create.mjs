#!/usr/bin/env node
/*
 * check-space-create.mjs -- who is in a new space, and the Home cards (GitHub #239, #225, #226).
 * The creator becomes a member of the space they make (every path: the store and POST /api/spaces), once, with the
 * members asked for kept; the Lobby is untouched. The host admin's stand-in (hostAdmin: true) is the one creator that does
 * not join (#334), and can still be added on purpose. The Home card is one button by role, named for the space, with no
 * pop-out button. The routes run against a throwaway server.
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
const { Store } = require('../server/store.js');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// The page parts (#225, #226).
const html = read('public/space.html');
const js = read('public/space.js');
const css = read('public/style.css');
assert.ok(!/data-join-popout/.test(html + js), 'no pop-out button on a space card (#226)');
assert.ok(!/joinInPopout/.test(js), 'the card pop-out handler is gone (#226)');
assert.ok(/setAttribute\('role', 'button'\); card\.tabIndex = 0; card\.setAttribute\('aria-label', spaceDisplayName\(r\)\)/.test(js), 'a space card is a button named for the space (#225)');
assert.ok(/if \(r\.isAside \|\| joinable\) \{ card\.removeAttribute\('role'\)/.test(js), 'an aside card, and a card to Join, is not made a button (#225)');
assert.ok(/closest\('a, button:not\(\[data-join\]\)'\)\) return;/.test(js), 'the link and Set up do not also enter (#225)');
assert.ok(/matches\?\.\('\.space-choice\[role="button"\]'\)/.test(js) && /event\.key !== 'Enter' && event\.key !== ' '/.test(js), 'Enter and Space on the focused card enter (#225)');
const sysCss = read('public/sdk/system.css');
assert.ok(/\.space-choice\):is\(:has\(\.sdk-open\), a, button:not\(:disabled\), \[role="button"\][^{]*\):hover/.test(sysCss) && /\.space-choice\):is\(a, button, \[role="button"\][^{]*\):focus-visible/.test(sysCss), 'the card has hover and focus states, the Cards family\'s in system.css (#225)');
assert.ok(/\.space-choice\[role='button'\] \{\s*cursor: pointer;/.test(css), 'a space card shows a pointer (#225)');

// The store: the creator is a member, once.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-space-create-'));
  const store = new Store(dir);
  const a = store.addUser({ login: 'ann', displayName: 'Ann', role: 'owner', password: 'memberpass1234' });
  const b = store.addUser({ login: 'bo', displayName: 'Bo', role: 'member', password: 'memberpass1234' });
  assert.deepEqual(store.addSpace({ name: 'One', creator: a.key }).members, [a.key], 'the creator is a member of a new space');
  assert.deepEqual(store.addSpace({ name: 'Two', members: [b.key], creator: a.key }).members, [b.key, a.key], 'the asked-for members are kept, and the creator added');
  assert.deepEqual(store.addSpace({ name: 'Three', members: [a.key, b.key], creator: a.key }).members, [a.key, b.key], 'no duplicate');
  assert.deepEqual(store.addSpace({ name: 'Four', members: [b.key] }).members, [b.key], 'no creator, no change');
  assert.deepEqual(store.addSpace({ name: 'Five', creator: 'nobody' }).members, [], 'an unknown creator is not added');
  // The host admin's stand-in is the one exception (#334): it creates without joining, and can be added on purpose.
  const h = store.addUser({ login: 'boss', displayName: 'boss', role: 'admin', passwordHash: null, hostAdmin: true });
  assert.deepEqual(store.addSpace({ name: 'Six', creator: h.key }).members, [], 'the host admin stand-in does not join a space it creates');
  assert.deepEqual(store.addSpace({ name: 'Seven', members: [b.key], creator: h.key }).members, [b.key], 'the members asked for stay, the stand-in is not added');
  const eight = store.addSpace({ name: 'Eight', members: [h.key], creator: h.key });
  assert.deepEqual(eight.members, [h.key], 'asked for on purpose, the stand-in is a member');
  const nine = store.addSpace({ name: 'Nine', creator: a.key });
  assert.deepEqual(store.updateSpace(nine.id, { members: [a.key, h.key] }).members, [a.key, h.key], 'the stand-in can join explicitly later');
  fs.rmSync(dir, { recursive: true, force: true });
}

// The route.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-space-create-srv-'));
const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, ADMIN_PASSWORD: 'testpass1234' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
let port = 0;
try {
  port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the server did not start in time:\n${out}`)), 20000);
    const onData = (d) => { out += d; const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  const call = async (method, urlPath, { body, token } = {}) => {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  const signIn = async (login, password) => {
    const r = await call('POST', '/api/login', { body: { login, password } });
    assert.equal(r.status, 200, r.text);
    return r.json.token;
  };
  const admin = await signIn('admin', 'testpass1234');
  const adminKey = (await call('GET', '/api/me', { token: admin })).json.user.key;
  const mk = async (login, role) => {
    const r = await call('POST', '/api/users', { token: admin, body: { login, displayName: login, role, password: 'memberpass1234' } });
    assert.equal(r.status, 201, r.text);
    return r.json.user.key;
  };
  const olive = await mk('olive', 'owner');
  const mia = await mk('mia', 'member');
  const owner = await signIn('olive', 'memberpass1234');

  let r = await call('POST', '/api/spaces', { token: owner, body: { name: 'Trip', members: [] } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.space.members, [olive], 'an owner who adds a space is one of its members');
  r = await call('POST', '/api/spaces', { token: admin, body: { name: 'Admin trip', members: [] } });
  assert.deepEqual(r.json.space.members, [adminKey], 'the admin, in no space, becomes a member of the one they add');
  r = await call('POST', '/api/spaces', { token: owner, body: { name: 'With Mia', members: [mia] } });
  assert.deepEqual(r.json.space.members, [mia, olive], 'the members asked for are kept, plus the creator');
  r = await call('POST', '/api/spaces', { token: owner, body: { name: 'Twice', members: [olive, mia] } });
  assert.deepEqual(r.json.space.members, [olive, mia], 'a creator already listed is not added twice');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'app.json'), 'utf8').toString()).spaces?.find?.((x) => x.id === 'lobby')?.members ?? [], [], 'the stored Lobby is untouched');
  assert.equal((await call('POST', '/api/spaces', { token: await signIn('mia', 'memberpass1234'), body: { name: 'No' } })).status, 403, 'a member cannot add a space');
  console.log('check-space-create: ok');
} finally {
  await new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
  fs.rmSync(dataDir, { recursive: true, force: true });
}
