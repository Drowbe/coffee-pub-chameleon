#!/usr/bin/env node
/*
 * check-space-erase.mjs -- deleting a space deletes everything kept for it (GitHub #337), and who may set one up (#285).
 * Part 1 builds an environment, fills one space with module data, uploads, links, requests, schedules, notifications,
 * settings, chat, facts and attention (and a second space that must be left whole), deletes the first through
 * server/space-erase.js and asserts no file under the data folder names it any more. A step that cannot finish refuses
 * with 500 and leaves the space in place. Part 2 runs a throwaway server: DELETE /api/spaces/:id, and the setup rule --
 * owners and the admin set up any space, a moderator only the spaces they belong to, a member never.
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
const { buildEnvironment, flushEnvironment } = require('../server/environment.js');
const { eraseSpace } = require('../server/space-erase.js');

// Every file under a folder that names `id`, in its path or its text.
function leftovers(dir, id) {
  const found = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (p.includes(id)) found.push(p);
      if (e.isDirectory()) walk(p);
      else if (!/\.(bin|thumb)$/.test(e.name) && fs.readFileSync(p, 'utf8').includes(id)) found.push(p);
    }
  };
  walk(dir);
  return found;
}

// Part 1: the environment.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-space-erase-'));
  const env = buildEnvironment(dir, { log: () => {} });
  const { store } = env;
  const ann = store.addUser({ login: 'ann', displayName: 'Ann', role: 'owner', password: 'memberpass1234' });
  const bo = store.addUser({ login: 'bo', displayName: 'Bo', role: 'member', password: 'memberpass1234' });
  const gone = store.addSpace({ name: 'Doomed', members: [bo.key], creator: ann.key }).id;
  const kept = store.addSpace({ name: 'Kept', members: [bo.key], creator: ann.key }).id;
  const MOD = 'notes';
  const fill = (id) => {
    env.moduleData.put(MOD, `space:${id}`, 'a', { text: 'private' }, { by: ann.key });
    env.moduleData.put(MOD, `space:${id}`, 'b', { text: 'more' }, { by: ann.key });
    env.moduleData.put('other', `space:${id}`, 'a', { text: 'in another module' }, { by: ann.key });
    const up = env.moduleUploads.scopeDir(MOD, `space:${id}`);
    fs.mkdirSync(up, { recursive: true });
    const fid = 'a'.repeat(24);
    fs.writeFileSync(path.join(up, `${fid}.bin`), Buffer.from('file bytes'));
    fs.writeFileSync(path.join(up, `${fid}.thumb`), Buffer.from('thumb'));
    fs.writeFileSync(path.join(up, `${fid}.json`), JSON.stringify({ id: fid, name: 'x.png', type: 'image/png', at: new Date().toISOString() }));
    // A library module's file: its bytes in the vault folder, its record beside the module's data (server/vault-store.js).
    const part = env.vault.newPart(id);
    fs.writeFileSync(part, Buffer.from('%PDF-1.4 ticket'));
    const libId = env.vault.newId();
    env.vault.commit(MOD, id, part, { id: libId, name: 'ticket.pdf', type: 'application/pdf', group: 'document', size: 15, by: ann.key, at: new Date().toISOString(), thumb: null });
    env.vault.putThumb(MOD, id, libId, Buffer.from('tiny'), 'image/png'); // its small picture
    env.vault.createShare(MOD, id, { name: 'For the family', files: [libId], by: ann.key }); // and a share link: space-<id>.shares.json
    env.moduleLinks.set({ module: MOD, kind: 'note', id: '1', scope: 'space', space: id }, [{ module: 'other', kind: 'note', id: '2', scope: 'space', space: id }], ann.key);
    env.moduleBus.publish({ module: MOD, name: 'changed', ref: null, data: null, scopeKey: `space:${id}`, by: ann.key });
    env.moduleBus.request({ from: MOD, provider: 'other', action: 'add', input: {}, scopeKey: `space:${id}`, by: ann.key, space: id });
    env.moduleHooks.schedules.push({ id: `${MOD}|space:${id}|k`, module: MOD, scopeKey: `space:${id}`, spaceId: id, key: 'k', at: Date.now() + 1e9, payload: null, notify: null, repeat: null, by: ann.key });
    env.moduleHooks.write(env.moduleHooks.schedulesFile, env.moduleHooks.schedules);
    env.moduleHooks.put({ module: MOD, scopeKey: `space:${id}`, spaceId: id }, [bo.key], { title: 'Hello', body: 'x' }, ann.key);
    env.moduleSettings.data.spaces[id] = { [MOD]: { colour: 'red' } };
    env.moduleSettings.save();
    env.chatHistory.add(id, { by: ann.key, who: 'Ann', text: 'hello there', visibility: 'public' });
    env.chatHistory.add(id, { by: bo.key, who: 'Bo', text: 'a private word', visibility: 'private' });
    assert.ok(env.facts.set(id, MOD, [{ id: 'f', icon: 'star', text: 'a fact' }]));
    env.attention.set(id, bo.key, MOD, { count: 2, text: 'look' });
    env.noteActivity(MOD, 'saved a', ann.key, `space:${id}`);
    env.invites.set(`${id}-i`, { id: `${id}-i`, from: ann.key, to: bo.key, spaceId: id, at: Date.now() });
    store.setSpacePrefs(bo.key, id, { permissions: { moderator: true } });
    const pics = store.imageDir(bo.key, id);
    fs.mkdirSync(pics, { recursive: true });
    fs.writeFileSync(path.join(pics, 'picture.png'), 'x');
    store.createInvite([id]);
  };
  fill(gone);
  fill(kept);
  // A space with a hundred files, so a big one is erased whole (bytes, thumbnails, records, quota).
  for (let i = 0; i < 100; i += 1) {
    const part = env.vault.newPart(gone);
    fs.writeFileSync(part, Buffer.alloc(100, i));
    const id = env.vault.newId();
    env.vault.commit(MOD, gone, part, { id, name: `f${i}.pdf`, type: 'application/pdf', group: 'document', size: 100, by: i % 2 ? ann.key : bo.key, at: new Date().toISOString(), thumb: null });
    if (i % 10 === 0) env.vault.putThumb(MOD, gone, id, Buffer.from('tn'), 'image/png');
  }
  const keptBytes = env.vault.usage().spaces.get(kept);
  assert.ok(fs.existsSync(env.vault.sharesFile(MOD, gone)) && env.vault.usage().spaces.get(gone) > 10000, 'the space has files, thumbnails and a share file before it is deleted');
  const totalBefore = env.vault.usage().all;
  flushEnvironment(env);
  assert.ok(leftovers(dir, gone).length >= 12, `the space has files on disk before it is deleted (${leftovers(dir, gone).length})`);

  // A step that cannot finish: refused with 500, the space still there, nothing said to be gone.
  const was = env.moduleUploads.forgetSpace;
  env.moduleUploads.forgetSpace = () => { throw new Error('disk says no'); };
  const origError = console.error;
  console.error = () => {};
  assert.throws(() => eraseSpace(env, gone), (e) => e.status === 500 && /was not deleted: its module files could not be removed/.test(e.message), 'a failing step fails loudly');
  console.error = origError;
  assert.ok(store.spaceById(gone), 'and the space is still there to delete again');
  env.moduleUploads.forgetSpace = was;

  assert.throws(() => eraseSpace(env, 'lobby'), (e) => e.status === 400 && /Lobby/.test(e.message), 'the Lobby cannot be deleted');
  assert.throws(() => eraseSpace(env, 'nosuch1'), (e) => e.status === 404, 'a space that is not there is a 404');

  const done = eraseSpace(env, gone);
  assert.ok(done['module files'] === 1 && done['library files'] === 101 && done['module links'] >= 1 && done['module requests'] >= 2, JSON.stringify(done));
  flushEnvironment(env);
  assert.equal(store.spaceById(gone), null, 'the space is gone');
  assert.deepEqual(leftovers(dir, gone), [], 'nothing under the data folder names the deleted space');
  assert.equal(done['library files'], 101, 'all 101 library files of the space were counted as gone');
  assert.ok(!fs.existsSync(env.vault.spaceDir(gone)) && !fs.existsSync(env.vault.sharesFile(MOD, gone)) && !fs.existsSync(env.vault.recordFile(MOD, gone)), 'its bytes folder, share file and records are gone');
  assert.equal(env.vault.usage().spaces.get(gone), undefined, 'the quota no longer counts the space');
  assert.equal(env.vault.usage().all, keptBytes, 'the total counts only the space that is left');
  assert.ok(env.vault.usage().all < totalBefore && env.vault.usage().people.get(bo.key) === undefined, 'and each person\'s total fell with it');
  assert.equal(new (require('../server/vault-store.js').VaultStore)({ bytesDir: env.vault.bytesDir, modulesDir: env.vault.modulesDir }).usage().all, keptBytes, 'counted again from disk, the same');
  assert.ok(fs.existsSync(env.vault.sharesFile(MOD, kept)), 'the other space keeps its share link');
  assert.ok(env.moduleData.get(MOD, `space:${kept}`, 'a'), 'the other space keeps its module data');
  assert.equal(env.moduleUploads.list(MOD, `space:${kept}`).length, 1, 'and its files');
  assert.equal(env.vault.list(MOD, kept).length, 1, 'and its library file');
  assert.ok(fs.existsSync(env.vault.filePath(kept, env.vault.list(MOD, kept)[0].id)), 'with its bytes');
  assert.ok(env.facts.list(kept).length && env.attention.list(kept, bo.key), 'and its facts and attention');
  assert.ok(env.chatHistory.list(kept, ann.key).length, 'and its chat');
  assert.equal(eraseSpace.length, 2);
  assert.equal(leftovers(dir, kept).length > 10, true, 'the other space is still on disk');
  fs.rmSync(dir, { recursive: true, force: true });
}

// Part 2: the routes.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-space-erase-srv-'));
const upDirOf = (id) => path.join(dataDir, 'modules', 'notes', 'uploads', `space-${id}`);

const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, ADMIN_PASSWORD: 'testpass1234' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
try {
  const port = await new Promise((resolve, reject) => {
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
  const mk = async (login, role) => {
    const r = await call('POST', '/api/users', { token: admin, body: { login, displayName: login, role, password: 'memberpass1234' } });
    assert.equal(r.status, 201, r.text);
    return r.json.user.key;
  };
  const makeSpace = async (name, members) => {
    const r = await call('POST', '/api/spaces', { token: admin, body: { name, members } });
    assert.equal(r.status, 200, r.text);
    return r.json.space.id;
  };
  await mk('olive', 'owner');
  const modA = await mk('mona', 'member');
  const modB = await mk('mick', 'member');
  const plain = await mk('mia', 'member');
  const spaceA = await makeSpace('A', [modA, plain]);
  const spaceB = await makeSpace('B', [modB]);
  const spaceC = await makeSpace('C', []);
  for (const [key, id] of [[modA, spaceA], [modB, spaceB]]) {
    const r = await call('PATCH', `/api/users/${key}/spaces/${id}`, { token: admin, body: { permissions: { moderator: true } } });
    assert.equal(r.status, 200, r.text);
  }
  const upDir = upDirOf(spaceC);
  fs.mkdirSync(upDir, { recursive: true });
  fs.writeFileSync(path.join(upDir, `${'b'.repeat(24)}.bin`), 'x');
  const olive = await signIn('olive', 'memberpass1234');
  const mona = await signIn('mona', 'memberpass1234');
  const mia = await signIn('mia', 'memberpass1234');

  // Setup (#285): the read and the change.
  for (const [who, token] of [['an owner', olive], ['the admin', admin]]) {
    for (const id of [spaceA, spaceB, spaceC]) {
      let r = await call('GET', `/api/spaces/${id}`, { token });
      assert.equal(r.status, 200, `${who} reads set up for a space they are not in`);
      assert.equal(r.json.space.id, id);
      r = await call('PATCH', `/api/spaces/${id}`, { token, body: { description: `by ${who}` } });
      assert.equal(r.status, 200, `${who} sets up a space they are not in: ${r.text}`);
    }
  }
  let r = await call('GET', `/api/spaces/${spaceA}`, { token: mona });
  assert.equal(r.status, 200, 'a moderator reads their own space');
  assert.ok(!('name' in r.json.space) && r.json.space.id === spaceA, 'and only the fields a moderator may change');
  r = await call('PATCH', `/api/spaces/${spaceA}`, { token: mona, body: { defaultLayout: null } });
  assert.equal(r.status, 200, `a moderator sets up their own space: ${r.text}`);
  r = await call('GET', `/api/spaces/${spaceB}`, { token: mona });
  assert.equal(r.status, 403, 'a moderator of A cannot read set up for B');
  assert.match(r.json.error, /only/);
  r = await call('PATCH', `/api/spaces/${spaceB}`, { token: mona, body: { defaultLayout: null } });
  assert.equal(r.status, 403, 'a moderator of A cannot set up B');
  r = await call('PATCH', `/api/spaces/${spaceC}`, { token: mona, body: { phases: [] } });
  assert.equal(r.status, 403, 'nor a space with no members');
  r = await call('PATCH', `/api/spaces/${spaceA}`, { token: mona, body: { name: 'Mine now' } });
  assert.equal(r.status, 403, 'a moderator does not change the owner-only fields of their own space');
  r = await call('GET', `/api/spaces/${spaceA}`, { token: mia });
  assert.equal(r.status, 403, 'a member cannot read set up, even of their own space');
  r = await call('PATCH', `/api/spaces/${spaceA}`, { token: mia, body: { defaultLayout: null } });
  assert.equal(r.status, 403, 'a member cannot set up their own space');
  assert.equal((await call('PATCH', `/api/spaces/${spaceA}`, { body: {} })).status, 401, 'nobody signed in is refused');

  // Delete (#337).
  assert.equal((await call('DELETE', `/api/spaces/${spaceC}`, { token: mona })).status, 403, 'a moderator cannot delete a space');
  r = await call('DELETE', `/api/spaces/${spaceC}`, { token: olive });
  assert.equal(r.status, 200, r.text);
  assert.ok(!fs.existsSync(upDir), 'the deleted space\'s uploads are gone');
  assert.equal((await call('GET', `/api/spaces/${spaceC}`, { token: olive })).status, 404);
  assert.equal((await call('DELETE', `/api/spaces/${spaceC}`, { token: olive })).status, 404, 'deleting it again is a 404');
  assert.equal((await call('DELETE', '/api/spaces/lobby', { token: admin })).status, 400, 'the Lobby stays');
  console.log('check-space-erase: ok');
} finally {
  await new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
  fs.rmSync(dataDir, { recursive: true, force: true });
}
process.exit(0);
