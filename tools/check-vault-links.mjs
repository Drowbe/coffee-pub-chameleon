#!/usr/bin/env node
/*
 * check-vault-links.mjs -- how a module points at a library file (documentation/plans/plan-attachments-vault.md, step 4).
 * A throwaway server (DATA_DIR and VAULT_DIR under the temp folder, no LiveKit) with a module that declares `library` (the
 * Vault's shape, under another name) and a module that links to its files. Checked:
 *  - a `file` pointer resolves like any object: the title is the file's name, the icon its type's, the subtitle its size and
 *    type; a PDF kept as download only says so; a record whose bytes are gone says `missing`; a removed file is `gone`;
 *  - permissions per reader: a member of the space sees it, a member without `view` and an outsider have it hidden, a guest
 *    pass and a stranger's space ask hidden/refused, and the access key is refused; a module that was not approved to link
 *    to files is refused;
 *  - search finds files (by name) for an approved module, never for a guest, an outsider or another space;
 *  - setLinks takes file pointers as targets, `kind` replaces only the links to files and keeps the others, a removed file's
 *    link is kept and listed as "File removed", GET .../uses lists the real linking objects, and the count in the view;
 *  - removing a file tells the stream's `links` event and the `library` event; adds, renames, thumbnails and removals send
 *    `library` events to a viewer who may read the library, to the modules approved to link, and not to an outsider.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { buildModule } = require('../server/module-build.js');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-vault-links: ${name}: ${err.stack || err.message}`); }
};

function startServer(dataDir, vaultDir) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, VAULT_DIR: vaultDir, TZ: 'UTC', ADMIN_PASSWORD: 'admin-password-1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const portPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  return portPromise.then((port) => ({ port, out: () => out, stop: () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); }) }));
}

function call(server, method, urlPath, { body, type, cookie } = {}) {
  const payload = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  const headers = { host: `127.0.0.1:${server.port}`, accept: 'application/json' };
  if (payload) { headers['content-type'] = type || 'application/json'; headers['content-length'] = payload.length; }
  if (cookie) headers.cookie = cookie;
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

// The module stream of one viewer: every event it hears, by name.
function openStream(server, cookie, space) {
  const events = [];
  let buf = '';
  let res = null;
  const req = http.request({ host: '127.0.0.1', port: server.port, path: `/api/modules/stream?space=${encodeURIComponent(space)}`, headers: { host: `127.0.0.1:${server.port}`, cookie, accept: 'text/event-stream' } }, (response) => {
    res = response;
    response.on('data', (c) => {
      buf += c.toString('utf8');
      const parts = buf.split(/\n\n/);
      buf = parts.pop();
      for (const part of parts) {
        let event = 'message';
        let data = '';
        for (const line of part.split(/\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;
        try { events.push({ event, data: JSON.parse(data) }); } catch { /* a ping */ }
      }
    });
  });
  req.end();
  const of = (name) => events.filter((e) => e.event === name).map((e) => e.data);
  const waitFor = async (name, count) => { for (let i = 0; i < 60 && of(name).length < count; i += 1) await new Promise((r) => setTimeout(r, 50)); };
  return { of, waitFor, close: () => { req.destroy(); if (res) res.destroy(); } };
}

function writeModule(dir, id, extra) {
  const root = path.join(dir, id);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'module.json'), JSON.stringify({ id, name: id, version: '1.0.0', scope: ['space'], icon: 'circle', surfaces: { canvas: { entry: `${id}.html`, menu: false } }, ...extra }));
  fs.writeFileSync(path.join(root, 'src', `${id}.html`), '<!DOCTYPE html><html><head><style>/*__CSS__*/</style></head><body><script>/*__JS__*/</script></body></html>');
  fs.writeFileSync(path.join(root, 'src', `${id}.css`), '');
  fs.writeFileSync(path.join(root, 'src', `${id}.js`), '');
  return root;
}

const fixture = (name) => fs.readFileSync(path.join(ROOT, 'tools', 'fixtures', 'vault', name));
const pdf = fixture('plain.pdf');
const jpegBytes = fixture('photo.jpg');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-vault-links-'));
let server = null;
const streams = [];
try {
  const mods = path.join(base, 'mods');
  const shelfDir = writeModule(mods, 'shelf', {
    library: true,
    permissions: [
      { key: 'view', label: 'See the files', default: { member: true, moderator: true, guest: true } },
      { key: 'add', label: 'Add files', default: { member: true, moderator: true, guest: true } },
      { key: 'download', label: 'Download files', default: { member: true, moderator: true, guest: true } },
      { key: 'remove_any', label: 'Remove files other people added', default: { member: false, moderator: true } },
    ],
    access: { read: 'view', write: 'add' },
    refs: { produces: [{ kind: 'file', name: 'File', key: 'file:{id}', summary: { title: 'name', category: 'group' }, open: true, backlinks: true }], consumes: [] },
  });
  const holderDir = writeModule(mods, 'holder', { refs: { produces: [{ kind: 'row', name: 'Row', key: 'row:{id}', summary: { title: 'title' } }], consumes: ['shelf:file', 'thing:other'] } });
  const thingDir = writeModule(mods, 'thing', { refs: { produces: [{ kind: 'other', name: 'Other', key: 'other:{id}', summary: { title: 'title' } }], consumes: [] } });
  const strangerDir = writeModule(mods, 'stranger', { refs: { produces: [{ kind: 'row', name: 'Row', key: 'row:{id}', summary: { title: 'title' } }], consumes: [] } });

  server = await startServer(path.join(base, 'data'), path.join(base, 'vault'));
  const login = async (who, password) => cookieOf(await call(server, 'POST', '/api/login', { body: { login: who, password } }));
  const admin = await login('admin', 'admin-password-1');
  const as = (cookie, method, url, body, type) => call(server, method, url, { cookie, body, type });
  const people = {};
  for (const who of ['pat', 'sam', 'lou']) {
    const r = await as(admin, 'POST', '/api/users', { login: who, displayName: who, role: 'member', password: 'memberpass1234' });
    assert.equal(r.status, 201, r.text);
    people[who] = { key: r.json.user.key, cookie: await login(who, 'memberpass1234') };
  }
  const space = (await as(admin, 'POST', '/api/spaces', { name: 'Rome', members: [people.pat.key, people.sam.key] })).json.space;
  const other = (await as(admin, 'POST', '/api/spaces', { name: 'Oslo', members: [people.pat.key] })).json.space;
  await as(admin, 'PATCH', `/api/spaces/${space.id}`, { members: [people.pat.key, people.sam.key] });
  await as(admin, 'PATCH', `/api/spaces/${other.id}`, { members: [people.pat.key] });
  for (const dir of [shelfDir, thingDir, holderDir, strangerDir]) { const up = await as(admin, 'POST', '/api/modules', buildModule(dir).zip, 'application/zip'); assert.equal(up.status, 201, up.text); }
  for (const id of ['shelf', 'thing', 'holder', 'stranger']) assert.equal((await as(admin, 'PATCH', `/api/modules/${id}`, { enabled: true, allSpaces: true })).status, 200, id);
  // Turning a module on approves what it declares: the holder consumes shelf:file, the stranger consumes nothing.
  const guestToken = (await as(admin, 'POST', `/api/spaces/${space.id}/guest-link`, {})).json.space.guestToken;

  const lib = (q = '') => `/api/modules/shelf/library?space=${space.id}${q}`;
  const add = async (cookie, name, bytes, type, spaceId = space.id) => (await call(server, 'POST', `/api/modules/shelf/library?space=${spaceId}&name=${encodeURIComponent(name)}`, { cookie, body: bytes, type }));
  const ref = (id, spaceId = space.id) => ({ module: 'shelf', kind: 'file', id, scope: 'space', space: spaceId });
  const resolve = (cookie, refs, from = 'holder', query = '') => as(cookie, 'POST', `/api/objects/resolve${query}`, { from, refs });

  // The linking module's own objects (a link is from one that exists).
  for (const id of ['1', '2', '3', '4']) assert.equal((await as(people.pat.cookie, 'PUT', `/api/modules/holder/data/row:${id}?scope=space&space=${space.id}`, { value: { title: `Stay ${id}` } })).status, 200);
  streams.push(openStream(server, people.pat.cookie, space.id));
  const patStream = streams[0];
  streams.push(openStream(server, people.lou.cookie, space.id)); // not in the space
  const louStream = streams[1];
  await new Promise((r) => setTimeout(r, 150));

  const doc = (await add(people.pat.cookie, 'booking.pdf', pdf, 'application/pdf')).json?.file;
  const pic = (await add(people.pat.cookie, 'beach.jpg', jpegBytes, 'image/jpeg')).json?.file;
  assert.ok(doc && pic, `two files are kept: ${JSON.stringify(doc)} ${JSON.stringify(pic)}`);
  await patStream.waitFor('library', 2);

  await test('adding a file sends a library event to a reader, naming no file, and not to someone outside the space', async () => {
    const heard = patStream.of('library');
    assert.deepEqual(heard.map((e) => [e.op, e.id, e.module, e.spaceId]), [['added', doc.id, 'shelf', space.id], ['added', pic.id, 'shelf', space.id]]);
    assert.ok(heard[0].modules.includes('shelf') && heard[0].modules.includes('holder'), `the library and the module approved to link hear it: ${heard[0].modules}`);
    assert.ok(!heard[0].modules.includes('stranger'), 'a module that does not link to files does not');
    assert.ok(!JSON.stringify(heard).includes('booking'), 'and no name travels');
    assert.equal(louStream.of('library').length, 0, 'someone outside the space hears nothing');
  });

  await test('a file pointer resolves like any object, for the reader', async () => {
    const out = (await resolve(people.pat.cookie, [ref(doc.id), ref(pic.id)])).json.summaries;
    assert.equal(out[0].title, 'booking.pdf');
    assert.equal(out[0].kind, 'file');
    assert.equal(out[0].icon, 'file-pdf');
    assert.match(out[0].subtitle, /^\d+(\.\d)? (KB|MB) · PDF$/);
    assert.equal(out[0].group, 'document');
    assert.equal(out[0].open, true);
    assert.equal(out[0].module.id, 'shelf');
    assert.deepEqual(out[0].ref, ref(doc.id));
    assert.equal(out[1].icon, 'file-image');
    assert.equal(out[1].category, 'image');
    assert.ok(!out[0].missing && !out[0].removed, 'neither flag on a file that is there');
  });

  await test('another reader of the space sees it; an outsider, a guest pass and a module not approved do not', async () => {
    assert.equal((await resolve(people.sam.cookie, [ref(doc.id)])).json.summaries[0].title, 'booking.pdf');
    const outsider = (await resolve(people.lou.cookie, [ref(doc.id)])).json.summaries[0];
    assert.equal(outsider.state, 'gone', 'a space they may not enter is an unknown id to them');
    assert.ok(!JSON.stringify(outsider).includes('booking'), 'and says nothing of it');
    const guest = await resolve('', [ref(doc.id)], 'holder', `?guest=${guestToken}`);
    assert.equal(guest.json.summaries[0].state, 'hidden', 'a guest pass resolves it as hidden, always');
    assert.equal((await resolve(people.pat.cookie, [ref(doc.id)], 'stranger')).json.summaries[0].status, 403, 'a module that was not approved is refused');
    assert.equal((await resolve(people.pat.cookie, [ref(doc.id, other.id)])).json.summaries[0].state, 'gone', 'a file is not in another space (a pointer to the wrong space finds nothing)');
    assert.equal((await resolve(people.pat.cookie, [{ ...ref(doc.id), space: 'zzzz9999' }])).json.summaries[0].status, 404, 'a space that is not there');
  });

  await test('a reader who lost `view` in the space has it hidden', async () => {
    assert.equal((await as(admin, 'PATCH', '/api/roles/member', { 'module.shelf.view': false })).status, 200);
    const seen = (await resolve(people.sam.cookie, [ref(doc.id)])).json.summaries[0];
    assert.equal(seen.state, 'hidden');
    assert.equal((await as(admin, 'PATCH', '/api/roles/member', { 'module.shelf.view': true })).status, 200);
  });

  await test('search finds files by name for an approved module, in the space and nowhere else', async () => {
    const find = (cookie, q, scopeSpace = space.id, from = 'holder') => as(cookie, 'GET', `/api/objects/search?from=${from}&scope=space&space=${scopeSpace}&q=${encodeURIComponent(q)}`);
    const found = (await find(people.pat.cookie, 'booking')).json.summaries;
    assert.deepEqual(found.map((s) => s.title), ['booking.pdf']);
    assert.equal(found[0].icon, 'file-pdf');
    assert.deepEqual((await find(people.pat.cookie, '')).json.summaries.map((s) => s.title).sort(), ['beach.jpg', 'booking.pdf']);
    assert.deepEqual((await find(people.pat.cookie, 'booking', other.id)).json.summaries, [], 'the other space has none');
    assert.deepEqual((await find(people.lou.cookie, 'booking')).json?.summaries || [], [], 'an outsider finds none');
    assert.deepEqual((await find(people.pat.cookie, 'booking', space.id, 'stranger')).json.summaries, [], 'a module not approved finds none');
    const guest = await as('', 'GET', `/api/objects/search?from=holder&scope=space&space=${space.id}&q=booking&guest=${guestToken}`);
    assert.deepEqual(guest.json.summaries, [], 'a guest finds none');
  });

  await test('setLinks takes file pointers; the object\'s other links stay when only files are replaced', async () => {
    const row = (id) => ({ module: 'holder', kind: 'row', id, scope: 'space', space: space.id });
    const first = await as(people.pat.cookie, 'POST', '/api/objects/links', { module: 'holder', from: row('1'), to: [ref(doc.id), ref(pic.id)] });
    assert.equal(first.status, 200, first.text);
    assert.equal(first.json.links, 2);
    assert.equal((await as(people.pat.cookie, 'POST', '/api/objects/links', { module: 'holder', from: row('2'), to: [ref(doc.id)] })).json.links, 1);
    // A link to another of its own objects, then only the files replaced.
    const otherRef = { module: 'thing', kind: 'other', id: 'o1', scope: 'space', space: space.id };
    assert.equal((await as(people.pat.cookie, 'PUT', `/api/modules/thing/data/other:o1?scope=space&space=${space.id}`, { value: { title: 'Thing' } })).status, 200);
    assert.equal((await as(people.pat.cookie, 'POST', '/api/objects/links', { module: 'holder', from: row('1'), to: [otherRef, ref(doc.id), ref(pic.id)] })).json.links, 3);
    const kept = await as(people.pat.cookie, 'POST', '/api/objects/links', { module: 'holder', from: row('1'), to: [ref(doc.id)], kind: 'file' });
    assert.equal(kept.status, 200, kept.text);
    const from = (await as(people.pat.cookie, 'GET', `/api/objects/links?from=holder&dir=from&ref=${encodeURIComponent(JSON.stringify(row('1')))}`)).json.summaries;
    assert.deepEqual(from.map((s) => s.title).sort(), ['Thing', 'booking.pdf'], 'one file and the other object');
    const wrong = await as(people.pat.cookie, 'POST', '/api/objects/links', { module: 'holder', from: row('1'), to: [otherRef], kind: 'file' });
    assert.equal(wrong.status, 400, 'every link must be to the kind named');
    assert.equal((await as(people.pat.cookie, 'POST', '/api/objects/links', { module: 'holder', from: row('1'), to: [ref(doc.id)], kind: 'no kind!' })).status, 400);
    // A stranger module can't link to files.
    assert.equal((await as(people.pat.cookie, 'POST', '/api/objects/links', { module: 'stranger', from: { module: 'stranger', kind: 'row', id: '1', scope: 'space', space: space.id }, to: [ref(doc.id)] })).json.links, 0, 'a module that was not approved links to nothing');
  });

  await test('op add and remove change only the file links, never replace, and need a kind', async () => {
    const row = { module: 'holder', kind: 'row', id: '4', scope: 'space', space: space.id };
    const post = (body) => as(people.pat.cookie, 'POST', '/api/objects/links', { module: 'holder', from: row, ...body });
    assert.equal((await post({ to: [ref(doc.id)], kind: 'file', op: 'add' })).json.links, 1);
    assert.equal((await post({ to: [ref(pic.id)], kind: 'file', op: 'add' })).json.links, 2, 'a second file is added to the first');
    assert.equal((await post({ to: [ref(doc.id)], kind: 'file', op: 'add' })).json.links, 2, 'the same file twice is one link');
    assert.equal((await post({ to: [ref(doc.id)], kind: 'file', op: 'remove' })).json.links, 1, 'remove takes one out');
    assert.equal((await post({ to: [ref(doc.id)], op: 'add' })).status, 400, 'op needs a kind');
    assert.equal((await post({ to: [], kind: 'file', op: 'dance' })).status, 400, 'and is add or remove');
    assert.equal((await post({ to: [ref(pic.id)], kind: 'file', op: 'remove' })).json.links, 0);
  });

  await test('"where it is used" is the real link records, and the view counts them', async () => {
    const uses = (await as(people.pat.cookie, 'GET', `/api/modules/shelf/library/${doc.id}/uses?space=${space.id}`)).json;
    assert.deepEqual(uses.uses.map((u) => u.ref.id).sort(), ['1', '2']);
    assert.equal(uses.hidden, 0);
    const files = (await as(people.pat.cookie, 'GET', lib())).json.files;
    assert.equal(files.find((f) => f.id === doc.id).uses, 2);
    assert.equal(files.find((f) => f.id === pic.id).uses, 0, 'the picture was unlinked from row 1');
  });

  await test('a file whose bytes are gone resolves with missing; a removed one is gone, and its links stay and read removed', async () => {
    const miss = (await add(people.pat.cookie, 'lost.pdf', pdf, 'application/pdf')).json.file;
    const row = { module: 'holder', kind: 'row', id: '3', scope: 'space', space: space.id };
    assert.equal((await as(people.pat.cookie, 'POST', '/api/objects/links', { module: 'holder', from: row, to: [ref(miss.id), ref(doc.id)], kind: 'file' })).json.links, 2);
    const bin = path.join(base, 'vault', '_default', `space-${space.id}`, `${miss.id}.bin`);
    fs.rmSync(bin);
    const s = (await resolve(people.pat.cookie, [ref(miss.id)])).json.summaries[0];
    assert.equal(s.missing, true, 'the record is there and the bytes are not: File missing');
    assert.equal(s.title, 'lost.pdf');
    const before = patStream.of('links').length;
    const gone = await as(people.pat.cookie, 'DELETE', `/api/modules/shelf/library/${miss.id}?space=${space.id}`);
    assert.equal(gone.status, 200, gone.text);
    const after = (await resolve(people.pat.cookie, [ref(miss.id)])).json.summaries[0];
    assert.deepEqual([after.state, after.status], ['gone', 404], 'a removed file is gone');
    await patStream.waitFor('links', before + 1);
    assert.ok(patStream.of('links').length > before, 'the objects that linked to it are told');
    const from = (await as(people.pat.cookie, 'GET', `/api/objects/links?from=holder&dir=from&ref=${encodeURIComponent(JSON.stringify(row))}`)).json.summaries;
    assert.deepEqual(from.map((x) => [x.title, !!x.removed]).sort(), [['File removed', true], ['booking.pdf', false]], 'the link to the removed file is kept and says so');
    // Telling the host the same list again keeps it.
    const again = await as(people.pat.cookie, 'POST', '/api/objects/links', { module: 'holder', from: row, to: [ref(miss.id), ref(doc.id)], kind: 'file' });
    assert.equal(again.json.links, 2, 'a removed file\'s link is kept when the module says it again');
    const links = JSON.parse(fs.readFileSync(path.join(base, 'data', 'modules', 'links.json'), 'utf8'));
    assert.ok(links.some((l) => l.to.id === miss.id), 'the record is still in links.json');
    // A removed file cannot be newly linked.
    const other3 = { module: 'holder', kind: 'row', id: '4', scope: 'space', space: space.id };
    assert.equal((await as(people.pat.cookie, 'POST', '/api/objects/links', { module: 'holder', from: other3, to: [ref(miss.id)], kind: 'file' })).json.links, 0);
  });

  await test('rename, thumbnail and removal each send a library event, in order', async () => {
    const start = patStream.of('library').length;
    const thumb = await as(people.pat.cookie, 'PUT', `/api/modules/shelf/library/${pic.id}/thumb?space=${space.id}`, fixture('pic.png'), 'image/png');
    assert.equal(thumb.status, 200, thumb.text);
    await patStream.waitFor('library', start + 1);
    assert.equal(patStream.of('library')[start].op, 'thumb', 'a thumbnail sends thumb');
    assert.equal((await as(people.pat.cookie, 'PATCH', `/api/modules/shelf/library/${pic.id}?space=${space.id}`, { name: 'shore.jpg' })).status, 200);
    await patStream.waitFor('library', start + 2);
    assert.equal((await resolve(people.pat.cookie, [ref(pic.id)])).json.summaries[0].title, 'shore.jpg', 'and the summary has the new name at once');
    assert.equal((await as(people.pat.cookie, 'DELETE', `/api/modules/shelf/library/${pic.id}?space=${space.id}`)).status, 200);
    await patStream.waitFor('library', start + 3);
    const ops = patStream.of('library').slice(start).map((e) => e.op);
    assert.deepEqual(ops, ['thumb', 'renamed', 'removed'], 'a thumbnail, a rename and a removal each send one');
    assert.equal(louStream.of('library').length, 0, 'an outsider still hears nothing');
  });

  await test('a link to a file not shared with the reader reads hidden, never gone, and says nothing of it (plan-vault-privacy.md)', async () => {
    const mine = (await add(people.pat.cookie, 'secret-plan.pdf', pdf, 'application/pdf', space.id)).json?.file;
    assert.ok(mine, 'an only-me file is kept');
    const set = await as(people.pat.cookie, 'PATCH', `/api/modules/shelf/library/${mine.id}?space=${space.id}`, { visibility: 'only-me' });
    assert.equal(set.status, 200, set.text);
    const row = { module: 'holder', kind: 'row', id: '2', scope: 'space', space: space.id };
    assert.equal((await as(people.pat.cookie, 'POST', '/api/objects/links', { module: 'holder', from: row, to: [ref(mine.id)], kind: 'file', op: 'add' })).json.links, 2, 'its adder links it');
    const seen = (await resolve(people.sam.cookie, [ref(mine.id)])).json.summaries[0];
    assert.deepEqual([seen.state, seen.status], ['hidden', 403], 'another member: hidden, not gone');
    assert.ok(!JSON.stringify(seen).includes('secret-plan'), 'and no name');
    const from = await as(people.sam.cookie, 'GET', `/api/objects/links?from=holder&dir=from&ref=${encodeURIComponent(JSON.stringify(row))}`);
    assert.ok(!from.text.includes('secret-plan') && !from.text.includes(mine.id) && !from.json.summaries.some((s) => s.removed), 'the object it is on shows nothing of it to them, not "File removed"');
    assert.equal((await resolve(people.pat.cookie, [ref(mine.id)])).json.summaries[0].title, 'secret-plan.pdf', 'its adder still sees it');
    const replaced = await as(people.sam.cookie, 'POST', '/api/objects/links', { module: 'holder', from: row, to: [ref(doc.id)], kind: 'file' });
    assert.equal(replaced.json.links, 1, 'a reader who replaces the object\'s file links is told only of the one they can see');
    const kept = await as(people.pat.cookie, 'GET', `/api/objects/links?from=holder&dir=from&ref=${encodeURIComponent(JSON.stringify(row))}`);
    assert.ok(kept.json.summaries.some((s) => s.ref.id === mine.id), 'and the one they can\'t see is kept');
    assert.equal((await as(people.pat.cookie, 'DELETE', `/api/modules/shelf/library/${mine.id}?space=${space.id}`)).status, 200);
  });

  await test('the access key and a stranger to the session are refused', async () => {
    assert.equal((await call(server, 'POST', '/api/objects/resolve', { body: { from: 'holder', refs: [ref(doc.id)] } })).status, 401);
  });
} catch (err) {
  failed += 1;
  console.error(err);
  if (server) console.error(server.out().slice(-2000));
} finally {
  for (const s of streams) s.close();
  if (server) await server.stop();
  fs.rmSync(base, { recursive: true, force: true });
}
if (failed) { console.error(`check-vault-links: ${failed} failed`); process.exit(1); }
console.log(`check-vault-links: ${n} checks OK`);
