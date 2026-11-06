#!/usr/bin/env node
/*
 * check-vault-visibility.mjs -- who may see which Vault file (documentation/plans/plan-vault-privacy.md, slice 1).
 * Part 1, read from the files: every library route that names a file (`:fid`) goes through the one door (libraryFile),
 * every read of the records in server/index.js is filtered by the rule (fileSight), and the Vault declares `see_all`
 * ("See every file") off for every role.
 * Part 2, a throwaway server (DATA_DIR and VAULT_DIR under the temp folder, no LiveKit, a stand-in AI service on
 * 127.0.0.1) with the real Vault and a module that links to its files. Five files, each a picture with a small picture:
 * everyone, only-me, people [listed], people [listed, unlisted] then the unlisted one taken off the list, and one whose
 * adder then left the space. The viewers: signed out, a guest pass, the access key, an outsider, a member not listed, a
 * listed member, the adder, a moderator without and with See every file, an owner and the admin. The routes: list, usage,
 * content, download, thumbnail, uses, rename, who-sees change, remove, share create and list, resolve, citations, one
 * object by address, search, links (from and to), the links batch, the AI's object pool and both live streams. Each cell
 * asserts the status; a file hidden from someone answers exactly as a missing one (status, the headers that matter and
 * the body, byte for byte) on the library routes, and as `hidden` (403, never `gone`) on the object routes; no answer to
 * someone names a file hidden from them, nor its id unless they sent it. Also: the add and change requests checked (an
 * unknown visibility, someone not in the space or in another space, more than 200 people), no activity line for a file
 * not everyone sees, a removed hidden file's links told only to those who could see it.
 * Usage: node tools/check-vault-visibility.mjs. Every failure is one line: `check-vault-visibility: <what>`.
 */
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

let passed = 0;
const failures = [];
const expect = (cond, what) => { if (cond) passed += 1; else failures.push(what); };

// ---- Part 1: the files --------------------------------------------------------------------------------------------
{
  const src = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  // Each route registration that names a file, with its handler up to the next route.
  const chunks = src.split(/\napp\./).slice(1);
  const fidRoutes = chunks.filter((c) => /^\w+\('\/api\/modules\/:id\/library\/:fid/.test(c));
  expect(fidRoutes.length >= 6, `part 1: expected at least six :fid library routes in server/index.js, found ${fidRoutes.length}`);
  for (const c of fidRoutes) {
    const head = c.slice(0, c.indexOf(','));
    expect(/\blibraryFile\(req, res|\bsendLibraryFile\(req, res/.test(c.split('\n// ')[0]), `part 1: the route ${head} does not go through the one door (libraryFile)`);
  }
  const send = /function sendLibraryFile\([^)]*\) \{([\s\S]*?)\n\}/.exec(src);
  expect(send && /libraryFile\(req, res\)/.test(send[1]) && !/vault\.get\(/.test(send[1]), 'part 1: sendLibraryFile reads its record without the door');
  const door = /function libraryFile\([^)]*\) \{([\s\S]*?)\n\}/.exec(src);
  expect(door && /!ctx\.sees\(r\)/.test(door[1]), 'part 1: the door (libraryFile) does not ask the rule (ctx.sees)');
  // Every read of a record outside the door and the object chokepoint is after the door.
  const gets = src.split('\n').map((line, i) => ({ line, at: i + 1 })).filter((x) => /\bvault\.get\(/.test(x.line));
  for (const g of gets) {
    const before = src.split('\n').slice(0, g.at).join('\n');
    const fn = /\n(?:async )?function (\w+)|\napp\.(\w+)\('([^']+)'/g;
    let last = null;
    for (const m of before.matchAll(fn)) last = m;
    const where = last ? (last[1] || `${last[2]} ${last[3]}`) : '?';
    const ok = ['libraryFile', 'objectValue', 'refFileSeen'].includes(where) || /^patch \/api\/modules\/:id\/library\/:fid$/.test(where);
    expect(ok, `part 1: server/index.js:${g.at} reads a library record outside the door (${where})`);
  }
  for (const x of src.split('\n').map((line, i) => ({ line, at: i + 1 })).filter((y) => /\bvault\.list\(/.test(y.line))) {
    expect(/\.filter\((ctx|at)\.sees\)/.test(x.line), `part 1: server/index.js:${x.at} lists library records without the rule (.filter(ctx.sees))`);
  }
  expect(/function fileSight\(who, spaceId, moduleId\)/.test(src) && /const fileVisible = /.test(src) && /const fileManageable = /.test(src), 'part 1: fileSight, fileVisible and fileManageable are not all in server/index.js');
  const share = fs.readFileSync(path.join(ROOT, 'server', 'vault-share.js'), 'utf8');
  expect(/visible: ctx\.sees/.test(share) && (share.match(/seenShare\(ctx, /g) || []).length >= 2, 'part 1: share links are not made, changed and listed through the rule');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'vault', 'module.json'), 'utf8'));
  const seeAll = manifest.permissions.find((p) => p.key === 'see_all');
  expect(seeAll && seeAll.label === 'See every file', 'part 1: the Vault does not declare see_all, "See every file"');
  expect(seeAll && !seeAll.default.member && !seeAll.default.moderator && !seeAll.default.guest, 'part 1: see_all is on by default for some role');
  expect(require('../server/vault-types.js').GUEST_LOCKED.includes('see_all'), 'part 1: see_all can be turned on for guests (GUEST_LOCKED)');
}

// ---- Part 2: a server ---------------------------------------------------------------------------------------------
function startServer(dataDir, vaultDir) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, VAULT_DIR: vaultDir, TZ: 'UTC', ADMIN_PASSWORD: 'admin-password-1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  }).then((port) => ({ port, out: () => out, stop: () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); }) }));
}

function call(server, method, urlPath, { body, type, cookie, headers: extra } = {}) {
  const payload = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  const headers = { host: `127.0.0.1:${server.port}`, accept: 'application/json', ...(extra || {}) };
  if (payload) { headers['content-type'] = type || 'application/json'; headers['content-length'] = payload.length; }
  if (cookie) headers.cookie = cookie;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const bytes = Buffer.concat(chunks);
        const text = bytes.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, json, text, bytes, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const cookieOf = (res) => [].concat(res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');

// One live stream: every event it hears, with its raw text.
function openStream(server, urlPath, { cookie, headers: extra } = {}) {
  const events = [];
  let buf = '';
  let res = null;
  const req = http.request({ host: '127.0.0.1', port: server.port, path: urlPath, headers: { host: `127.0.0.1:${server.port}`, accept: 'text/event-stream', ...(cookie ? { cookie } : {}), ...(extra || {}) } }, (response) => {
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
        try { events.push({ event, data: JSON.parse(data), raw: data }); } catch { /* a ping */ }
      }
    });
  });
  req.on('error', () => {});
  req.end();
  return { events, of: (name) => events.filter((e) => e.event === name).map((e) => e.data), all: () => events.map((e) => e.raw).join('\n'), close: () => { req.destroy(); if (res) res.destroy(); } };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function writeModule(dir, id, extra) {
  const root = path.join(dir, id);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'module.json'), JSON.stringify({ id, name: id, version: '1.0.0', scope: ['space'], icon: 'circle', surfaces: { canvas: { entry: `${id}.html`, menu: false } }, ...extra }));
  fs.writeFileSync(path.join(root, 'src', `${id}.html`), '<!DOCTYPE html><html><head><style>/*__CSS__*/</style></head><body><script>/*__JS__*/</script></body></html>');
  fs.writeFileSync(path.join(root, 'src', `${id}.css`), '');
  fs.writeFileSync(path.join(root, 'src', `${id}.js`), '');
  return root;
}

// A stand-in AI service (OpenAI-compatible): it keeps what it is sent and answers a plain sentence.
const aiSeen = [];
const aiStub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'stub-model' }] }));
    aiSeen.push(body);
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'A plain stub answer.' }, finish_reason: 'stop' }], usage: { total_tokens: 10 } }));
  });
});
await new Promise((r) => aiStub.listen(0, '127.0.0.1', r));

const fixture = (name) => fs.readFileSync(path.join(ROOT, 'tools', 'fixtures', 'vault', name));
const jpeg = fixture('photo.jpg');
const png = fixture('pic.png');
const MISSING = 'ffffffffffffffffffffffff';
const MATTERS = ['content-type', 'content-length', 'etag', 'cache-control', 'content-disposition', 'x-content-type-options'];
const shape = (r) => JSON.stringify([r.status, ...MATTERS.map((h) => r.headers[h] ?? null), r.text]);
// An answer in a failure line: its text when it is JSON, else its type and size (never a file's bytes).
const brief = (r) => `${r.status} ${r.json ? r.text.slice(0, 120) : `<${r.headers['content-type'] || 'no type'}, ${r.bytes.length} bytes>`}`;

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-vault-visibility-'));
let server = null;
const streams = [];
try {
  const mods = path.join(base, 'mods');
  const holderDir = writeModule(mods, 'holder', { refs: { produces: [{ kind: 'row', name: 'Row', key: 'row:{id}', summary: { title: 'title' }, backlinks: true }], consumes: ['vault:file'] } });
  server = await startServer(path.join(base, 'data'), path.join(base, 'vault'));
  const login = async (who, password) => cookieOf(await call(server, 'POST', '/api/login', { body: { login: who, password } }));
  const admin = await login('admin', 'admin-password-1');
  const as = (cookie, method, url, body, type) => call(server, method, url, { cookie, body, type });
  const must = (r, status, what) => { if (r.status !== status && !(status === 201 && r.status === 200)) throw new Error(`${what}: ${r.status} ${r.text}`); return r; };
  const people = {};
  for (const [who, role] of [['ola', 'owner'], ['ada', 'member'], ['lis', 'member'], ['nol', 'member'], ['mod', 'member'], ['out', 'member'], ['tmp', 'member']]) {
    const r = must(await as(admin, 'POST', '/api/users', { login: who, displayName: who, role, password: 'memberpass1234' }), 201, `make ${who}`);
    people[who] = { key: r.json.user.key, cookie: await login(who, 'memberpass1234') };
  }
  const K = (w) => people[w].key;
  const A = must(await as(admin, 'POST', '/api/spaces', { name: 'Rome', members: ['ada', 'lis', 'nol', 'mod', 'tmp'].map(K) }), 201, 'space A').json.space;
  const B = must(await as(admin, 'POST', '/api/spaces', { name: 'Oslo', members: ['out', 'tmp'].map(K) }), 201, 'space B').json.space;
  must(await as(admin, 'PATCH', `/api/spaces/${A.id}`, { members: ['ada', 'lis', 'nol', 'mod', 'tmp'].map(K) }), 200, 'members of A');
  must(await as(admin, 'PATCH', `/api/spaces/${B.id}`, { members: ['out', 'tmp'].map(K) }), 200, 'members of B');
  must(await as(admin, 'PATCH', `/api/users/${K('mod')}/spaces/${A.id}`, { permissions: { moderator: true } }), 200, 'mod moderates A');
  for (const dir of [path.join(ROOT, 'modules', 'vault'), holderDir]) must(await as(admin, 'POST', '/api/modules', buildModule(dir).zip, 'application/zip'), 201, `install ${dir}`);
  for (const id of ['vault', 'holder']) must(await as(admin, 'PATCH', `/api/modules/${id}`, { enabled: true, allSpaces: true }), 200, `turn on ${id}`);
  const guestToken = must(await as(admin, 'POST', `/api/spaces/${A.id}/guest-link`, {}), 200, 'guest link').json.space.guestToken;
  const streamKey = (await as(admin, 'GET', '/api/me')).json.streamKey;
  must(await as(admin, 'PUT', '/api/ai', { source: 'custom', provider: 'compatible', address: `http://127.0.0.1:${aiStub.address().port}/v1`, model: 'stub-model', key: 'sk-test', enabled: true }), 200, 'point the AI at the stand-in');
  must(await as(admin, 'PATCH', '/api/roles/member', { useAi: true }), 200, 'members use AI');

  // The see_all permission: off for each role, never for guests.
  {
    const roles = (await as(admin, 'GET', '/api/roles')).json;
    expect(roles.permissions.some((p) => p.key === 'module.vault.see_all' && /See every file/.test(p.label)), 'Roles does not list "See every file"');
    for (const r of ['member', 'moderator', 'guest']) expect(roles.roles[r]['module.vault.see_all'] === false, `see_all is on for ${r} by default`);
    expect(roles.roles.owner['module.vault.see_all'] === true, 'an owner does not have see_all');
    const g = await as(admin, 'PATCH', '/api/roles/guest', { 'module.vault.see_all': true });
    expect(g.status === 400, `see_all could be turned on for guests (${g.status})`);
  }

  // The viewers. The access key and a guest pass ride on the query or a header.
  const V = {
    'signed out': {},
    'a guest pass': { q: `&guest=${guestToken}` },
    'the access key': { headers: { 'x-stream-key': streamKey } },
    'an outsider': { cookie: people.out.cookie },
    'a member not listed': { cookie: people.nol.cookie, key: K('nol') },
    'a listed member': { cookie: people.lis.cookie, key: K('lis') },
    'the adder': { cookie: people.ada.cookie, key: K('ada') },
    'a moderator': { cookie: people.mod.cookie, key: K('mod'), mod: true },
    'a moderator with See every file': { cookie: people.mod.cookie, key: K('mod'), mod: true, all: true },
    'an owner': { cookie: people.ola.cookie, key: K('ola'), owner: true },
    'the admin': { cookie: admin, owner: true },
  };
  const ask = (v, method, url, body) => call(server, method, url.includes('?') ? `${url}${v.q || ''}` : `${url}${v.q ? `?${v.q.slice(1)}` : ''}`, { cookie: v.cookie, headers: v.headers, body });

  // Both live streams of each viewer, open before any file is added.
  const live = {};
  for (const [name, v] of Object.entries(V)) {
    if (v.all) continue; // the same person as 'a moderator'; checked on their own below
    const s1 = openStream(server, `/api/modules/stream?space=${A.id}${v.q || ''}`, { cookie: v.cookie, headers: v.headers });
    const s2 = openStream(server, `/api/modules/vault/events?scope=space&space=${A.id}${v.q || ''}`, { cookie: v.cookie, headers: v.headers });
    streams.push(s1, s2);
    live[name] = [s1, s2];
  }
  const tmpStreams = [openStream(server, `/api/modules/stream?space=${A.id}`, { cookie: people.tmp.cookie })];
  streams.push(...tmpStreams);
  await sleep(300);

  // Adding: the request checked before a byte is kept.
  const lib = (q = '') => `/api/modules/vault/library?space=${A.id}${q}`;
  const add = (cookie, name, q = '') => call(server, 'POST', lib(`&name=${encodeURIComponent(name)}${q}`), { cookie, body: jpeg, type: 'image/jpeg' });
  for (const [q, want, what] of [
    ['&visibility=secret', 'Who can see a file is everyone, only-me or people.', 'an unknown visibility'],
    [`&visibility=people&people=${K('out')}`, `Everyone chosen must be in this space.`, 'someone from another space'],
    ['&visibility=people&people=nobody00', 'Everyone chosen must be in this space.', 'a key that is nobody'],
    ['&visibility=people', 'Choose the people who can see it.', 'people with nobody chosen'],
    [`&visibility=only-me&people=${K('lis')}`, 'People are chosen only when a file is shown to chosen people.', 'people with only-me'],
    [`&visibility=people&people=${Array.from({ length: 201 }, (_, i) => `k${i}`).join(',')}`, 'A file can be shown to at most 200 people.', '201 people'],
  ]) {
    const r = await add(people.ada.cookie, 'refused.jpg', q);
    expect(r.status === 400 && r.json?.error === want, `add with ${what}: ${r.status} ${r.text} (wanted 400 "${want}")`);
  }
  const files = {};
  const addAs = async (key, who, name, q) => {
    const r = must(await add(people[who].cookie, name, q), 201, `add ${name}`);
    must(await call(server, 'PUT', `/api/modules/vault/library/${r.json.file.id}/thumb?space=${A.id}`, { cookie: people[who].cookie, body: png, type: 'image/png' }), 200, `thumb of ${name}`);
    files[key] = { id: r.json.file.id, name: r.json.file.name, by: who, view: r.json.file };
  };
  await addAs('everyone', 'ada', 'lantern-everyone.jpg', '');
  await addAs('only-me', 'ada', 'lantern-zebra.jpg', '&visibility=only-me');
  await addAs('people', 'ada', 'lantern-quokka.jpg', `&visibility=people&people=${K('lis')}`);
  await addAs('people-then-removed', 'ada', 'lantern-ibis.jpg', `&visibility=people&people=${K('lis')},${K('nol')},${K('lis')}`);
  await addAs('adder-left', 'tmp', 'lantern-okapi.jpg', `&visibility=people&people=${K('lis')}`);
  expect(files['only-me'].view.visibility === 'only-me' && !('people' in files['only-me'].view), `the adder's view of an only-me file: ${JSON.stringify(files['only-me'].view)}`);
  expect(JSON.stringify(files['people-then-removed'].view.people) === JSON.stringify([K('lis'), K('nol')]), `the people list is kept once each: ${JSON.stringify(files['people-then-removed'].view.people)}`);
  const recs = JSON.parse(fs.readFileSync(path.join(base, 'data', 'modules', 'vault', 'library', `space-${A.id}.json`), 'utf8'));
  expect(!('visibility' in recs[files.everyone.id]) && recs[files['only-me'].id].visibility === 'only-me', 'an everyone file is stored without the field; only-me is stored');
  await sleep(300);
  // What the streams heard of the adds: each viewer only the files they may see then.
  const heardAdds = {};
  for (const [name, pair] of Object.entries(live)) heardAdds[name] = pair.map((s) => s.of('library').filter((e) => e.op === 'added').map((e) => e.id));
  const tmpHeard = tmpStreams[0].of('library').map((e) => e.id);

  // An object that links to every file (the admin sees them all), and a share link holding them all (the owner).
  must(await as(admin, 'PUT', `/api/modules/holder/data/row:r1?scope=space&space=${A.id}`, { value: { title: 'Booking' } }), 200, 'row r1');
  const ref = (id, space = A.id) => ({ module: 'vault', kind: 'file', id, scope: 'space', space });
  const row = { module: 'holder', kind: 'row', id: 'r1', scope: 'space', space: A.id };
  const linked = must(await as(admin, 'POST', '/api/objects/links', { module: 'holder', from: row, to: Object.values(files).map((f) => ref(f.id)) }), 200, 'link r1');
  expect(linked.json.links === 5, `the admin links all five files: ${linked.text}`);
  must(await as(people.ola.cookie, 'POST', `/api/modules/vault/library/shares?space=${A.id}`, { name: 'All five', files: Object.values(files).map((f) => f.id) }), 201, 'owner shares all five');

  // The changes: one person taken off a list, and an adder who leaves the space.
  const before = live['a member not listed'][0].of('library').length;
  must(await as(people.ada.cookie, 'PATCH', `/api/modules/vault/library/${files['people-then-removed'].id}?space=${A.id}`, { people: [K('lis')] }), 200, 'take nol off the list');
  must(await as(admin, 'PATCH', `/api/spaces/${A.id}`, { members: ['ada', 'lis', 'nol', 'mod'].map(K) }), 200, 'tmp leaves A');
  await sleep(400);

  // What each viewer may see now, worked out here on its own.
  const SEES = {
    'signed out': [], 'a guest pass': [], 'the access key': [], 'an outsider': [],
    'a member not listed': ['everyone'],
    'a listed member': ['everyone', 'people', 'people-then-removed', 'adder-left'],
    'the adder': ['everyone', 'only-me', 'people', 'people-then-removed'],
    'a moderator': ['everyone'],
    'a moderator with See every file': Object.keys(files),
    'an owner': Object.keys(files),
    'the admin': Object.keys(files),
  };
  const ADDS_HEARD = { ...SEES, 'a member not listed': ['everyone', 'people-then-removed'] }; // nol was on that list when it was added

  // The streams, so far.
  for (const [name, pair] of Object.entries(live)) {
    const want = ADDS_HEARD[name].map((k) => files[k].id).sort();
    for (const [i, s] of pair.entries()) {
      const got = [...new Set(heardAdds[name][i])].sort();
      expect(JSON.stringify(got) === JSON.stringify(want), `${name}, ${i ? 'the Vault\'s own stream' : 'the shared stream'}: heard of adds ${JSON.stringify(got.map((id) => Object.keys(files).find((k) => files[k].id === id)))}, wanted ${JSON.stringify(ADDS_HEARD[name])}`);
      for (const f of Object.values(files)) expect(!s.all().includes(f.name), `${name}: a stream carried the name ${f.name}`);
    }
  }
  expect(tmpHeard.includes(files['adder-left'].id), 'the adder (before leaving) heard their own file arrive');
  {
    const nolAfter = live['a member not listed'][0].of('library').slice(before);
    expect(nolAfter.some((e) => e.id === files['people-then-removed'].id && e.op === 'removed'), `taken off the list: the member hears it as removed (${JSON.stringify(nolAfter)})`);
    const lisAfter = live['a listed member'][0].of('library');
    expect(lisAfter.some((e) => e.id === files['people-then-removed'].id && e.op === 'visibility'), 'still on the list: the listed member hears the change');
    expect(!live['a moderator'][0].of('library').some((e) => e.id === files['people-then-removed'].id), 'never on the list: the moderator hears nothing of it');
  }

  // The matrix.
  const secrets = (name) => Object.keys(files).filter((k) => !SEES[name].includes(k)).map((k) => files[k]);
  const leakFree = (name, r, sentIds = []) => {
    for (const f of secrets(name)) {
      expect(!r.text.includes(f.name) && !r.text.includes(f.name.replace(/\.jpg$/, '')), `${name}: an answer names the hidden file ${f.name}`);
      if (!sentIds.includes(f.id)) expect(!r.text.includes(f.id), `${name}: an answer carries the id of the hidden file ${f.name}`);
    }
  };
  const fileBytes = (id) => ['bin', 'thumb'].reduce((sum, ext) => { try { return sum + fs.statSync(path.join(base, 'vault', '_default', `space-${A.id}`, `${id}.${ext}`)).size; } catch { return sum; } }, 0);
  const shares = ['a moderator', 'a moderator with See every file', 'an owner', 'the admin'];
  const removers = (name, k) => SEES[name].includes(k) && (files[k].by === 'ada' && name === 'the adder' || V[name].mod || V[name].owner);
  const managers = (name, k) => SEES[name].includes(k) && ((files[k].by === 'ada' && name === 'the adder') || V[name].owner);
  const signedIn = (name) => !['signed out', 'the access key'].includes(name);

  async function row1(name) {
    const v = V[name];
    const sees = SEES[name];
    // The list and its usage numbers.
    const list = await ask(v, 'GET', lib());
    leakFree(name, list);
    if (sees.length) {
      const ids = (list.json?.files || []).map((f) => f.id).sort();
      expect(list.status === 200 && JSON.stringify(ids) === JSON.stringify(sees.map((k) => files[k].id).sort()), `${name}: list: ${list.status}, ${ids.length} files, wanted ${sees.length}`);
      const bytes = sees.reduce((sum, k) => sum + fileBytes(files[k].id), 0);
      expect(list.json?.usage?.bytes === bytes, `${name}: usage shows ${list.json?.usage?.bytes} bytes, wanted the ${bytes} of the files they see`);
    } else expect(list.status !== 200 || (list.json?.files || []).length === 0, `${name}: list answered ${list.status} with files`);
    // Each file route, for each file and for one that is not there.
    const routes = {
      content: (id) => ask(v, 'GET', `/api/modules/vault/library/${id}/content?space=${A.id}`),
      download: (id) => ask(v, 'GET', `/api/modules/vault/library/${id}/content?space=${A.id}&download=1`),
      thumbnail: (id) => ask(v, 'GET', `/api/modules/vault/library/${id}/thumb?space=${A.id}`),
      uses: (id) => ask(v, 'GET', `/api/modules/vault/library/${id}/uses?space=${A.id}`),
      rename: (id) => ask(v, 'PATCH', `/api/modules/vault/library/${id}?space=${A.id}`, { name: Object.values(files).find((f) => f.id === id)?.name || 'x.jpg' }),
      'who-sees change': (id) => { const r = recs[id]; return ask(v, 'PATCH', `/api/modules/vault/library/${id}?space=${A.id}`, { visibility: r?.visibility || 'everyone', ...(r?.visibility === 'people' ? { people: [K('lis')] } : {}) }); },
      remove: (id) => ask(v, 'DELETE', `/api/modules/vault/library/${id}?space=${A.id}`),
      'share create': (id) => ask(v, 'POST', `/api/modules/vault/library/shares?space=${A.id}`, { name: 'One', files: [id] }),
    };
    for (const [route, go] of Object.entries(routes)) {
      const missing = await go(MISSING);
      expect(missing.status >= 400, `${name}: ${route} of a file that is not there answered ${missing.status}`);
      for (const [k, f] of Object.entries(files)) {
        if (route === 'remove' && removers(name, k)) continue; // allowed: done once at the end
        const r = await go(f.id);
        leakFree(name, r, [f.id]);
        if (!sees.includes(k)) {
          expect(shape(r) === shape(missing), `${name}: ${route} of the ${k} file differs from a missing file: ${brief(r)} vs ${brief(missing)}`);
          expect(!r.text.includes(f.id) && !r.text.includes(f.name), `${name}: ${route} refusal names the ${k} file`);
          continue;
        }
        let want = 200;
        if (route === 'rename') want = (f.by === 'ada' && name === 'the adder') || v.mod || v.owner ? 200 : 403;
        if (route === 'who-sees change') want = managers(name, k) ? 200 : 403;
        if (route === 'remove') want = 403;
        if (route === 'share create') want = shares.includes(name) ? 201 : 403;
        expect(r.status === want, `${name}: ${route} of the ${k} file answered ${brief(r)}, wanted ${want}`);
      }
    }
    // The share links they are shown name no file hidden from them.
    if (shares.includes(name)) {
      const s = await ask(v, 'GET', `/api/modules/vault/library/shares?space=${A.id}`);
      expect(s.status === 200 && s.json.shares.some((x) => x.name === 'All five'), `${name}: share list ${s.status}`);
      leakFree(name, s);
    }
    // The object routes.
    const resolve = await ask(v, 'POST', '/api/objects/resolve', { from: 'holder', refs: Object.values(files).map((f) => ref(f.id)) });
    const cites = await ask(v, 'POST', '/api/chat/citations', { refs: Object.values(files).map((f) => ref(f.id)) });
    for (const [label, r] of [['resolve', resolve], ['citations', cites]]) {
      leakFree(name, r, Object.values(files).map((f) => f.id));
      if (!signedIn(name)) { expect(r.status === 401, `${name}: ${label} answered ${r.status}`); continue; }
      Object.keys(files).forEach((k, i) => {
        const s = r.json?.summaries?.[i] || {};
        if (sees.includes(k)) expect(s.title === files[k].name, `${name}: ${label} of the ${k} file: ${JSON.stringify(s).slice(0, 160)}`);
        else expect(s.state === 'hidden' && s.status === 403 && !s.title, `${name}: ${label} of the hidden ${k} file is ${s.state}/${s.status}, wanted hidden/403`);
      });
    }
    for (const [k, f] of Object.entries(files)) {
      const one = await ask(v, 'GET', `/api/modules/vault/objects/file/${f.id}?scope=space&space=${A.id}&from=holder`);
      leakFree(name, one);
      if (!signedIn(name)) expect(one.status === 401, `${name}: one object answered ${one.status}`);
      else if (sees.includes(k)) expect(one.status === 200 && one.json.summary.title === f.name, `${name}: one object, ${k}: ${one.status}`);
      else expect(one.status === 403 && one.json.state === 'hidden', `${name}: one object, hidden ${k}: ${one.status} ${one.json?.state}`);
      if (!sees.includes(k) && signedIn(name) && name !== 'a guest pass' && name !== 'an outsider') {
        expect(one.json?.error === 'that file is not shared with you', `${name}: one object, hidden ${k}, says "${one.json?.error}"`);
      }
    }
    const search = await ask(v, 'GET', `/api/objects/search?from=holder&scope=space&space=${A.id}&q=lantern`);
    leakFree(name, search);
    if (signedIn(name)) {
      const ids = (search.json?.summaries || []).filter((s) => s.ref.module === 'vault').map((s) => s.ref.id).sort();
      expect(JSON.stringify(ids) === JSON.stringify(sees.map((k) => files[k].id).sort()), `${name}: search found ${ids.length} files, wanted ${sees.length}`);
    }
    const from = await ask(v, 'GET', `/api/objects/links?from=holder&dir=from&ref=${encodeURIComponent(JSON.stringify(row))}`);
    leakFree(name, from);
    if (from.status === 200) {
      const ids = from.json.summaries.filter((s) => s.ref.module === 'vault').map((s) => s.ref.id).sort();
      expect(JSON.stringify(ids) === JSON.stringify(sees.map((k) => files[k].id).sort()), `${name}: links from the booking show ${ids.length} files, wanted ${sees.length}`);
    } else expect(!sees.length, `${name}: links from the booking answered ${from.status}`);
    for (const [k, f] of Object.entries(files)) {
      const to = await ask(v, 'GET', `/api/objects/links?from=vault&dir=to&ref=${encodeURIComponent(JSON.stringify(ref(f.id)))}`);
      leakFree(name, to);
      if (sees.includes(k)) expect(to.status === 200 && to.json.summaries.some((s) => s.ref.id === 'r1'), `${name}: backlinks of the ${k} file: ${to.status}`);
      else expect(to.status >= 400 && !to.text.includes(f.name), `${name}: backlinks of the hidden ${k} file answered ${to.status}`);
    }
    const batch = await ask(v, 'POST', '/api/objects/links/batch', { module: 'vault', refs: Object.values(files).map((f) => ref(f.id)) });
    leakFree(name, batch, Object.values(files).map((f) => f.id));
    if (signedIn(name)) {
      const ids = (batch.json?.links || []).map((l) => l.ref.id).sort();
      expect(JSON.stringify(ids) === JSON.stringify(sees.map((k) => files[k].id).sort()), `${name}: the links batch answered for ${ids.length} files, wanted ${sees.length}`);
    }
    // The AI's object pool, for those who may ask: the question matches every file's name.
    if (v.key && v.cookie) {
      const at = aiSeen.length;
      const r = await ask(v, 'POST', `/api/spaces/${A.id}/ai`, { question: 'which lantern pictures do we have' });
      const sent = aiSeen.slice(at).join('\n');
      expect(r.status === 200, `${name}: asking the AI answered ${r.status} ${r.text.slice(0, 120)}`);
      for (const [k, f] of Object.entries(files)) {
        const there = sent.includes(f.name.replace(/\.jpg$/, ''));
        expect(there === sees.includes(k), `${name}: the AI ${there ? 'was sent' : 'was not sent'} the ${k} file`);
      }
    }
  }

  for (const name of Object.keys(V)) {
    if (V[name].all) continue;
    await row1(name);
  }
  // The moderator with See every file: the role's permission on, the same person again, and their streams.
  must(await as(admin, 'PATCH', '/api/roles/moderator', { 'module.vault.see_all': true }), 200, 'see_all on for moderators');
  {
    const s = openStream(server, `/api/modules/stream?space=${A.id}`, { cookie: people.mod.cookie });
    streams.push(s);
    await sleep(200);
    must(await as(people.ada.cookie, 'PATCH', `/api/modules/vault/library/${files['only-me'].id}?space=${A.id}`, { visibility: 'only-me' }), 200, 'the adder sets only-me again');
    await sleep(300);
    expect(s.of('library').some((e) => e.id === files['only-me'].id), 'a moderator with See every file hears of an only-me file');
    expect(!live['a member not listed'][0].of('library').some((e) => e.id === files['only-me'].id), 'a member not listed hears nothing of an only-me file');
  }
  await row1('a moderator with See every file');
  must(await as(admin, 'PATCH', '/api/roles/moderator', { 'module.vault.see_all': false }), 200, 'see_all off again');

  // The adder who left: their file stays, with its list; they see nothing of the space now.
  {
    const r = await as(people.tmp.cookie, 'GET', `/api/modules/vault/library/${files['adder-left'].id}/content?space=${A.id}`);
    const m = await as(people.tmp.cookie, 'GET', `/api/modules/vault/library/${MISSING}/content?space=${A.id}`);
    expect(shape(r) === shape(m), 'the adder who left: their file answers as a missing one');
    const other = (await as(people.tmp.cookie, 'POST', '/api/objects/resolve', { from: 'holder', refs: [ref(files['adder-left'].id, B.id)] })).json.summaries[0];
    expect(other.state === 'gone', `a pointer to the file in the space they are in now finds nothing (${other.state})`);
    const owner = (await as(people.ola.cookie, 'GET', lib())).json.files.find((f) => f.id === files['adder-left'].id);
    expect(owner && owner.by === K('tmp') && owner.visibility === 'people' && JSON.stringify(owner.people) === JSON.stringify([K('lis')]), `the file stays, its adder and list as they were: ${JSON.stringify(owner)}`);
  }
  // Change requests checked.
  {
    const f = files.people.id;
    const r1 = await as(people.ada.cookie, 'PATCH', `/api/modules/vault/library/${f}?space=${A.id}`, { visibility: 'people', people: [K('out')] });
    expect(r1.status === 400, `a who-sees change to someone of another space answered ${r1.status}`);
    const r2 = await as(people.ada.cookie, 'PATCH', `/api/modules/vault/library/${f}?space=${A.id}`, { visibility: 'people', people: Array.from({ length: 201 }, (_, i) => `k${i}`) });
    expect(r2.status === 400 && /200/.test(r2.json?.error), `201 people answered ${r2.status}`);
    const r3 = await as(people.mod.cookie, 'PATCH', `/api/modules/vault/library/${files.everyone.id}?space=${A.id}`, { visibility: 'only-me' });
    expect(r3.status === 403 && /who can see it/.test(r3.json?.error), `a moderator changing who sees someone's file answered ${r3.status} ${r3.json?.error}`);
    const r4 = await as(people.ola.cookie, 'PATCH', `/api/modules/vault/library/${f}?space=${A.id}`, { visibility: 'people', people: [K('lis'), K('nol')] });
    expect(r4.status === 200 && r4.json.file.visibility === 'people', `an owner may change who sees someone's file (${r4.status})`);
    const nolSees = (await as(people.nol.cookie, 'GET', lib())).json.files.map((x) => x.id);
    expect(nolSees.includes(f) && !('visibility' in (await as(people.nol.cookie, 'GET', lib())).json.files.find((x) => x.id === f)), 'added to the list, the member sees it, without who else does');
    must(await as(people.ola.cookie, 'PATCH', `/api/modules/vault/library/${f}?space=${A.id}`, { visibility: 'people', people: [K('lis')] }), 200, 'back');
  }
  // A link the person can't see stays when they replace an object's links.
  {
    must(await as(people.nol.cookie, 'POST', '/api/objects/links', { module: 'holder', from: row, to: [ref(files.everyone.id)], kind: 'file' }), 200, 'nol replaces the booking\'s files');
    const held = (await as(admin, 'GET', `/api/objects/links?from=holder&dir=from&ref=${encodeURIComponent(JSON.stringify(row))}`)).json.summaries.filter((s) => s.ref.module === 'vault').length;
    expect(held === 5, `a member who replaces the links keeps the four files they can't see (${held} left)`);
    const add = await as(people.nol.cookie, 'POST', '/api/objects/links', { module: 'holder', from: { ...row, id: 'r2' }, to: [ref(files['only-me'].id)], kind: 'file', op: 'add' });
    expect(add.json?.links === 0, 'nobody links a file they can\'t see');
  }
  // Who sees a change: only a strict word changes it (null, empty, other types, padded or capitalised words are refused and
  // leave the record as it was), on a change and on an upload.
  {
    const mine = must(await add(people.ada.cookie, 'strict-probe.jpg', '&visibility=only-me'), 201, 'add the strict probe').json.file;
    const url = `/api/modules/vault/library/${mine.id}?space=${A.id}`;
    const viewOf = async () => (await as(people.ada.cookie, 'GET', lib())).json.files.find((x) => x.id === mine.id);
    const odd = [['visibility null', { visibility: null }], ['visibility empty', { visibility: '' }], ['visibility a number', { visibility: 0 }], ['visibility a list', { visibility: [] }], ['visibility an object', { visibility: {} }], ['visibility Everyone', { visibility: 'Everyone' }], ['visibility padded before', { visibility: ' only-me' }], ['visibility padded after', { visibility: 'everyone ' }], ['people null', { people: null }], ['people empty', { people: '' }], ['people a number', { people: 5 }], ['people null with people', { visibility: 'people', people: null }], ['people a list of numbers', { visibility: 'people', people: [1] }]];
    for (const [what, b] of odd) {
      const r = await as(people.ada.cookie, 'PATCH', url, b);
      const now = await viewOf();
      expect(r.status === 400 && typeof r.json?.error === 'string', `a change with ${what} answered ${r.status} ${r.text} (wanted 400)`);
      expect(now && now.visibility === 'only-me' && !('people' in now), `a change with ${what} left the file as ${JSON.stringify(now && [now.visibility, now.people])}`);
    }
    const up = await add(people.ada.cookie, 'strict-empty.jpg', '&visibility=');
    expect(up.status === 400, `an upload with an empty visibility answered ${up.status}`);
    must(await as(people.ada.cookie, 'DELETE', url), 200, 'remove the strict probe');
  }
  // The links of a hidden file: its id reaches no stream of someone who can't see it, whichever way it was linked or unlinked;
  // the holder's own pointer still reaches everyone who can see the holder; a file someone can see is told as before.
  {
    must(await as(admin, 'PUT', `/api/modules/holder/data/row:r3?scope=space&space=${A.id}`, { value: { title: 'Hotel' } }), 200, 'row r3');
    const row3 = { ...row, id: 'r3' };
    const hid = files['only-me'].id;
    const vis = files.everyone.id;
    const ppl = files.people.id;
    const link = (cookie, to, op) => as(cookie, 'POST', '/api/objects/links', { module: 'holder', from: row3, to, kind: 'file', ...(op ? { op } : {}) });
    const marks = Object.fromEntries(Object.entries(live).map(([n, p]) => [n, p.map((s) => s.events.length)]));
    must(await link(people.ada.cookie, [ref(hid)], 'add'), 200, 'add the hidden file');
    must(await link(people.ada.cookie, [ref(vis)], 'add'), 200, 'add the visible file');
    must(await link(people.ada.cookie, [ref(hid)], 'remove'), 200, 'remove the hidden file');
    must(await link(people.ada.cookie, [ref(hid)], 'add'), 200, 'add the hidden file again');
    must(await link(people.ada.cookie, [ref(vis)]), 200, 'replace with the visible file');
    await sleep(500);
    for (const [n, pair] of Object.entries(live)) {
      const after = pair.map((s, i) => s.events.slice(marks[n][i]));
      const told = after[0].filter((e) => e.event === 'links');
      if (!SEES[n].includes('only-me')) expect(!after.flat().some((e) => e.raw.includes(hid)), `${n}: a stream carried the id of a hidden file that was linked and unlinked`);
      if (SEES[n].includes('only-me')) expect(told.some((e) => e.data.ref?.id === hid), `${n}: was not told of a file it can see being linked`);
      if (SEES[n].includes('everyone')) {
        expect(told.some((e) => e.data.ref?.id === 'r3'), `${n}: was not told of the object a hidden file was linked to`);
        expect(told.some((e) => e.data.ref?.id === vis), `${n}: was not told of a visible file being linked`);
      }
    }
    // What a viewer is counted and may take out: only what they can see.
    must(await link(people.ada.cookie, [ref(hid), ref(ppl)], 'add'), 200, 'add the hidden and the listed file');
    const heldNow = async () => (await as(admin, 'GET', `/api/objects/links?from=holder&dir=from&ref=${encodeURIComponent(JSON.stringify(row3))}`)).json.summaries.filter((s) => s.ref.module === 'vault').map((s) => s.ref.id).sort();
    expect(JSON.stringify(await heldNow()) === JSON.stringify([vis, hid, ppl].sort()), `the object holds the three files: ${JSON.stringify(await heldNow())}`);
    const count = await link(people.nol.cookie, [ref(vis)], 'add');
    expect(count.status === 200 && count.json?.links === 1, `a member who sees one of three linked files is told ${count.text} (wanted links 1)`);
    const countLis = await link(people.lis.cookie, [ref(vis)], 'add');
    expect(countLis.status === 200 && countLis.json?.links === 2, `a member who sees two of three is told ${countLis.text} (wanted links 2)`);
    const gone = await link(people.nol.cookie, [ref(hid)], 'remove');
    expect(gone.status === 404 && gone.json?.error === 'There is no such file.', `taking out a link to a hidden file answered ${gone.status} ${gone.text} (wanted 404 as missing)`);
    expect((await heldNow()).includes(hid), 'a member who cannot see a file took its link off an object');
    const goneBoth = await link(people.nol.cookie, [ref(vis), ref(hid)], 'remove');
    expect(goneBoth.status === 404 && (await heldNow()).includes(vis), `a removal naming a hidden file changed something anyway (${goneBoth.status})`);
    const mine = await link(people.nol.cookie, [ref(vis)], 'remove');
    expect(mine.status === 200 && mine.json?.links === 0 && !(await heldNow()).includes(vis), `taking out a visible link answered ${mine.text}`);
    const own = await link(people.ada.cookie, [ref(hid)], 'remove');
    expect(own.status === 200 && !(await heldNow()).includes(hid), `the adder taking out their own file's link answered ${own.status}`);
    // The share links: one holding only files hidden from someone is not theirs to see or turn off.
    const sh = (await as(people.ola.cookie, 'POST', `/api/modules/vault/library/shares?space=${A.id}`, { name: 'Hidden only', files: [hid] })).json.share;
    const mixed = (await as(people.ola.cookie, 'POST', `/api/modules/vault/library/shares?space=${A.id}`, { name: 'Mixed', files: [hid, vis] })).json.share;
    expect(sh && mixed, 'the owner makes two share links');
    const list = await as(people.mod.cookie, 'GET', `/api/modules/vault/library/shares?space=${A.id}`);
    expect(!list.text.includes(sh.id) && !list.text.includes('Hidden only') && !list.text.includes(hid), `a moderator's share list shows a link of hidden files: ${list.text.slice(0, 200)}`);
    const seenMixed = list.json.shares.find((s) => s.id === mixed.id);
    expect(seenMixed && JSON.stringify(seenMixed.files) === JSON.stringify([vis]), `a link of a hidden and a visible file lists only the visible: ${JSON.stringify(seenMixed)}`);
    const off = await as(people.mod.cookie, 'DELETE', `/api/modules/vault/library/shares/${sh.id}?space=${A.id}`);
    expect(off.status === 404 && off.json?.error === 'There is no such share link.', `turning off a link of hidden files answered ${off.status} ${off.text} (wanted 404 as missing)`);
    const edit = await as(people.mod.cookie, 'PATCH', `/api/modules/vault/library/shares/${sh.id}?space=${A.id}`, { name: 'Renamed' });
    expect(edit.status === 404, `changing a link of hidden files answered ${edit.status} (wanted 404 as missing)`);
    const ownerList = await as(people.ola.cookie, 'GET', `/api/modules/vault/library/shares?space=${A.id}`);
    expect(ownerList.json.shares.some((s) => s.id === sh.id && s.name === 'Hidden only'), 'the owner still sees and keeps the link of hidden files');
    for (const s of [sh, mixed]) await as(people.ola.cookie, 'DELETE', `/api/modules/vault/library/shares/${s.id}?space=${A.id}`);
  }
  // Removing: a hidden file's links are told only to those who could see it; no activity line for a file not everyone sees.
  {
    const marks = Object.fromEntries(Object.entries(live).map(([n, p]) => [n, p.map((s) => s.events.length)]));
    must(await as(people.ola.cookie, 'DELETE', `/api/modules/vault/library/${files['only-me'].id}?space=${A.id}`), 200, 'the owner removes the only-me file');
    must(await as(people.ada.cookie, 'DELETE', `/api/modules/vault/library/${files.everyone.id}?space=${A.id}`), 200, 'the adder removes the everyone file');
    await sleep(400);
    for (const [n, pair] of Object.entries(live)) {
      const after = pair.map((s, i) => s.events.slice(marks[n][i]));
      if (SEES[n].includes('only-me')) expect(after[0].some((e) => e.event === 'library' && e.data.id === files['only-me'].id && e.data.op === 'removed'), `${n}: did not hear the only-me file removed`);
      else expect(!after.flat().some((e) => e.raw.includes(files['only-me'].id)), `${n}: heard of the removed only-me file`);
      // The booking that linked both is told once per removal its viewer could see: twice, once, or not at all.
      const want = SEES[n].includes('everyone') ? (SEES[n].includes('only-me') ? 2 : 1) : 0;
      const got = after[0].filter((e) => e.event === 'links' && e.data.ref?.id === 'r1').length;
      expect(got === want, `${n}: the booking's links were told ${got} times, wanted ${want} (a hidden file's removal must not reach them)`);
    }
    const activity = (await as(admin, 'GET', '/api/modules/activity')).json.activity.filter((a) => a.module === 'vault').map((a) => a.what);
    expect(activity.filter((w) => /^added a file/.test(w)).length === 1, `one activity line for five files added, only the everyone one: ${JSON.stringify(activity)}`);
    expect(activity.filter((w) => /^removed a file/.test(w)).length === 1, `one removal line, the everyone one's: ${JSON.stringify(activity)}`);
  }
} catch (err) {
  failures.push(`stopped: ${err.stack || err.message}`);
  if (server) console.error(server.out().slice(-2000));
} finally {
  for (const s of streams) s.close();
  aiStub.close();
  if (server) await server.stop();
  fs.rmSync(base, { recursive: true, force: true });
}
for (const f of failures) console.error(`check-vault-visibility: ${f}`);
if (failures.length) { console.error(`check-vault-visibility: ${failures.length} failed, ${passed} passed`); process.exit(1); }
console.log(`check-vault-visibility: ${passed} checks OK`);
