#!/usr/bin/env node
/*
 * check-secret-setting.mjs -- the `secret` module setting type (plan-ai-assistant.md, J1; GitHub #731): a write-only value
 * the owner sets and clears and nothing ever reads back. Two parts:
 *   - server/module-settings.js on its own: sealed in modules/secrets.json (mode 600), never in settings.json, never in
 *     `values`, `effective` or a change event; the server-side accessor; a wrong key; no key; forgetting a module;
 *   - a real single-environment server on a throwaway DATA_DIR, with a fixture module declaring a secret: who may set it
 *     (owner only), what every read answers ({ set } and nothing else), what a hostile value does, that the plain value is
 *     in no file of the data folder, no answer and no log line, and that an owner's copy leaves the file out.
 * Every key here is an obviously fake test value. No network beyond localhost.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { buildModule } = require('../server/module-build.js');
const { ModuleSettings, SettingError } = require('../server/module-settings.js');
const { cleanManifest } = require('../server/modules.js');
const exportLib = require('../server/environment-export.js');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};

const FAKE = 'FAKE-test-key-0000-not-a-real-key';
const FAKE2 = 'FAKE-second-key-1111-not-real';
const files = new Set(['page.html']);
const manifestOf = (settings, id = 'fixture') => cleanManifest({ id, name: 'Fixture', version: '1.0.0', scope: ['environment'], surfaces: { page: { entry: 'page.html' } }, settings }, files);
const SECRET_DEF = { key: 'apiKey', label: 'Key', type: 'secret' };

// --- the class on its own ------------------------------------------------------------------------------------------------
await test('a secret is sealed in its own file, and nothing else holds or says it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-secret-unit-'));
  const key = crypto.randomBytes(32);
  const ms = new ModuleSettings(dir, () => key);
  const manifest = manifestOf([SECRET_DEF, { key: 'label', label: 'Label', type: 'text' }]);
  const events = [];
  ms.on('change', (c) => events.push(c));
  assert.deepEqual(ms.values(manifest, 'environment', {}).apiKey, { set: false });
  const done = ms.set(manifest, 'environment', {}, { apiKey: `  ${FAKE}\n`, label: 'x' }, 'owner');
  assert.deepEqual(done.values.apiKey, { set: true }, 'the answer is { set } only');
  assert.deepEqual(done.changed.sort(), ['apiKey', 'label']);
  assert.deepEqual(ms.effective(manifest, {}).apiKey, { set: true });
  assert.equal(ms.secret(manifest, 'apiKey'), FAKE, 'the server-side accessor gives it, trimmed');
  assert.ok(!JSON.stringify(events).includes(FAKE), 'a change event names the setting, never the value');
  assert.ok(!JSON.stringify(done).includes(FAKE) && !JSON.stringify(ms.data).includes(FAKE) && !JSON.stringify(ms).includes(FAKE), 'not in the class\'s own data');
  const settingsFile = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  assert.ok(!settingsFile.includes(FAKE) && !settingsFile.includes('aesgcm'), 'settings.json holds neither the value nor the sealed form');
  const sealed = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8');
  assert.ok(!sealed.includes(FAKE) && sealed.includes('aesgcm$'), 'secrets.json holds it sealed');
  assert.equal(fs.statSync(path.join(dir, 'secrets.json')).mode & 0o777, 0o600, 'private to the server\'s user');
  // A new object over the same folder reads it again; with another key it is unreadable and says so.
  assert.equal(new ModuleSettings(dir, () => key).secret(manifest, 'apiKey'), FAKE);
  const other = new ModuleSettings(dir, () => crypto.randomBytes(32));
  assert.deepEqual(other.values(manifest, 'environment', {}).apiKey, { set: false, unreadable: true });
  assert.equal(other.secret(manifest, 'apiKey'), null);
  // The accessor gives a secret only to a module that declares that key as a secret.
  assert.equal(ms.secret(manifestOf([{ key: 'apiKey', label: 'Key', type: 'text' }]), 'apiKey'), null, 'a text setting of the same name is not a secret');
  assert.equal(ms.secret(manifestOf([SECRET_DEF], 'other'), 'apiKey'), null, 'another module has its own, empty');
  assert.equal(ms.secret(manifest, 'label'), null);
  // An empty save of the other settings leaves it; '' clears it, and clearing twice is no change.
  events.length = 0;
  ms.set(manifest, 'environment', {}, { label: 'y' }, 'owner');
  assert.equal(ms.secret(manifest, 'apiKey'), FAKE);
  ms.set(manifest, 'environment', {}, { apiKey: FAKE2 }, 'owner');
  assert.equal(ms.secret(manifest, 'apiKey'), FAKE2, 'replaced');
  ms.set(manifest, 'environment', {}, { apiKey: '' }, 'owner');
  assert.deepEqual(ms.values(manifest, 'environment', {}).apiKey, { set: false });
  assert.equal(ms.secret(manifest, 'apiKey'), null);
  assert.ok(!fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8').includes('aesgcm'), 'cleared from the file');
  const before = events.length;
  ms.set(manifest, 'environment', {}, { apiKey: '' }, 'owner');
  assert.equal(events.length, before, 'clearing what is not set changes nothing');
  assert.ok(!JSON.stringify(events).includes(FAKE2));
  // Forgetting the module takes it too.
  ms.set(manifest, 'environment', {}, { apiKey: FAKE }, 'owner');
  ms.forgetModule('fixture');
  assert.equal(ms.secret(manifest, 'apiKey'), null);
  assert.ok(!fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8').includes('aesgcm'));
  fs.rmSync(dir, { recursive: true, force: true });
});

await test('refusals say why and never repeat the value; with no key to seal it nothing is kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-secret-unit-'));
  const manifest = manifestOf([{ ...SECRET_DEF, maxLength: 20 }]);
  const ms = new ModuleSettings(dir, () => crypto.randomBytes(32));
  const hostile = [['<img src=x onerror=alert(1)>'.repeat(3), 413], ['line\nbreak', 400], ['tab\there', 400], ['nul\u0000byte', 400], [12345, 400], [['a'], 400], [null, 400], [{ a: 1 }, 400]];
  for (const [raw, status] of hostile) {
    try { ms.set(manifest, 'environment', {}, { apiKey: raw }, 'o'); assert.fail(`${JSON.stringify(raw)} was taken`); } catch (err) {
      assert.ok(err instanceof SettingError, String(err));
      assert.equal(err.status, status, JSON.stringify(raw));
      assert.ok(!err.message.includes(String(raw)) && !/onerror|\u0000/.test(err.message), 'the sentence does not repeat it');
    }
  }
  assert.equal(ms.secret(manifest, 'apiKey'), null, 'nothing was kept');
  assert.throws(() => ms.set(manifest, 'space', { spaceId: 'x' }, { apiKey: FAKE }, 'o'), /has no space setting "apiKey"/);
  assert.throws(() => ms.set(manifest, 'person', { userKey: 'x' }, { apiKey: FAKE }, 'o'), /has no person setting "apiKey"/);
  const keyless = new ModuleSettings(dir);
  assert.throws(() => keyless.set(manifest, 'environment', {}, { apiKey: 'FAKE-short' }, 'o'), (e) => e.status === 503 && !e.message.includes('FAKE-short'));
  assert.equal(fs.existsSync(path.join(dir, 'secrets.json')), false, 'no file was made');
  fs.rmSync(dir, { recursive: true, force: true });
});

await test('an owner\'s copy leaves the secrets file out, whatever else is in the folder', () => {
  assert.equal(exportLib.fileAllowed('modules/secrets.json'), false);
  assert.equal(exportLib.fileLeftOut('modules/secrets.json'), true);
  const out = exportLib.exportEntries([['modules/secrets.json', Buffer.from('aesgcm$x')], ['modules/settings.json', Buffer.from('{}')], ['app.json', Buffer.from('{}')]], { settings: {}, users: [], spaces: [] });
  assert.deepEqual(out.map(([name]) => name).sort(), ['app.json', 'modules/settings.json']);
});

await test('the settings form draws a secret as an empty password box, never from the value (read as source; no browser)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'module-settings.js'), 'utf8');
  const fn = /function secretControl[\s\S]*?\n}\n/.exec(src)[0];
  assert.match(fn, /type="password"/);
  assert.match(fn, /autocomplete="new-password"/);
  assert.match(fn, /value=""/);
  assert.ok(!/def\.value\b(?!\s*&&)/.test(fn.replace(/def\.value && def\.value\.(set|unreadable)/g, '')), 'only whether it is set is read from the answer');
  assert.match(src, /if \(def\.type === 'secret'\) \{[^}]*typed/, 'an empty box sends nothing');
});

// --- a real server ---------------------------------------------------------------------------------------------------------
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-secret-setting-'));
let child = null;
let port = 0;
let log = '';
async function startServer() {
  const earlier = log.length; // the port is read from what this start prints
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, ADMIN_PASSWORD: 'testpass1234' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${log}`)); }, 20000);
    const onData = () => { const m = /listening on :(\d+)/.exec(log.slice(earlier)); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${log}`)); });
  });
}
const stopServer = () => new Promise((resolve) => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });

async function call(method, urlPath, { body, token, cookie, raw } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = `app_session=${cookie}`;
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

function moduleZip(id, settings, scope = ['environment']) {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'check-secret-module-'));
  try {
    fs.mkdirSync(path.join(src, 'src'));
    fs.writeFileSync(path.join(src, 'module.json'), JSON.stringify({ id, name: id, version: '1.0.0', scope, surfaces: { page: { entry: `${id}.html` }, ...(scope.includes('space') ? { canvas: { entry: `${id}-canvas.html` } } : {}) }, settings }));
    for (const f of [`${id}.html`, ...(scope.includes('space') ? [`${id}-canvas.html`] : [])]) fs.writeFileSync(path.join(src, 'src', f), '<!DOCTYPE html><html><head><style>/*__CSS__*/</style></head><body><script>/*__JS__*/</script></body></html>');
    fs.writeFileSync(path.join(src, 'src', `${id}.css`), '');
    fs.writeFileSync(path.join(src, 'src', `${id}.js`), '');
    return buildModule(src).zip;
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
  }
}
const upload = (owner, zip) => fetch(`http://127.0.0.1:${port}/api/modules`, { method: 'POST', headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/zip' }, body: zip });

// Every file under the data folder that holds `needle`, by its path.
function filesHolding(needle, dir = dataDir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) filesHolding(needle, full, out);
    else if (e.isFile() && fs.readFileSync(full).includes(needle)) out.push(path.relative(dataDir, full));
  }
  return out;
}

await startServer();
try {
  const signIn = async (login, password) => {
    const r = await call('POST', '/api/login', { body: { login, password } });
    assert.equal(r.status, 200, `${login} signs in: ${r.text}`);
    return r.json.token;
  };
  const owner = await signIn('admin', 'testpass1234');
  const mk = async (login, role) => (await call('POST', '/api/users', { token: owner, body: { login, displayName: login, role, password: 'memberpass1234', passwordless: true } })).json.user;
  const alice = await mk('alice', 'member');
  const mod = await mk('mod', 'member');
  const space = (await call('POST', '/api/spaces', { token: owner, body: { name: 'One', members: [alice.key, mod.key] } })).json.space;
  await call('PATCH', `/api/users/${mod.key}/spaces/${space.id}`, { token: owner, body: { permissions: { moderator: true } } });
  const aliceT = await signIn('alice', 'memberpass1234');
  const modT = await signIn('mod', 'memberpass1234');
  const stream = (await call('GET', '/api/me', { token: owner })).json.streamKey;

  const SETTINGS = [{ key: 'apiKey', label: 'Service key', type: 'secret', help: 'A fake key for the check.' }, { key: 'label', label: 'Label', type: 'text' }];
  await test('a module declaring a secret installs; one declaring it for a space or a person is refused with the reason', async () => {
    let up = await upload(owner, moduleZip('secret-fixture', SETTINGS));
    assert.equal(up.status, 201, await up.text());
    assert.equal((await call('PATCH', '/api/modules/secret-fixture', { token: owner, body: { enabled: true } })).status, 200);
    for (const scope of ['space', 'person']) {
      up = await upload(owner, moduleZip('secret-bad', [{ key: 'apiKey', label: 'Key', type: 'secret', scope }], ['environment', 'space']));
      assert.equal(up.status, 400);
      assert.match(await up.text(), /setting \\?"apiKey\\?" is a secret, so its scope must be \\?"environment\\?"/);
    }
    up = await upload(owner, moduleZip('secret-other', [{ key: 'label', label: 'Label', type: 'text' }]));
    assert.equal(up.status, 201);
    assert.equal((await call('PATCH', '/api/modules/secret-other', { token: owner, body: { enabled: true } })).status, 200);
  });

  const put = (token, values, id = 'secret-fixture', scope = 'environment', extra = '') => call('PUT', `/api/modules/${id}/settings/${scope}${extra}`, { token, body: { values } });
  const getSetting = (token) => call('GET', '/api/module-settings/environment', { token });
  const apiKeyOf = (r) => r.json.modules.find((m) => m.id === 'secret-fixture').settings.find((d) => d.key === 'apiKey');

  await test('only an owner sets it: nobody signed out, no member, no moderator, not the access key', async () => {
    assert.equal((await put(null, { apiKey: FAKE })).status, 401);
    for (const t of [aliceT, modT]) {
      const r = await put(t, { apiKey: FAKE });
      assert.equal(r.status, 403, r.text);
      assert.match(r.json.error, /^only an? .+ changes the .+'s settings$/);
      assert.equal((await getSetting(t)).status, 403, 'and they cannot list the settings');
    }
    assert.equal((await call('PUT', `/api/modules/secret-fixture/settings/environment?s=${stream}`, { body: { values: { apiKey: FAKE } } })).status, 401);
    assert.equal((await put(owner, { apiKey: FAKE }, 'secret-fixture', 'space', `?space=${space.id}`)).status, 400, 'there is no space-level secret to set');
    assert.equal((await put(owner, { apiKey: FAKE }, 'secret-fixture', 'person')).status, 400, 'nor a personal one');
    assert.equal((await put(owner, { apiKey: FAKE }, 'secret-other')).status, 400, 'another module cannot be given this one\'s key, nor this one set through it');
    assert.equal((await getSetting(owner)).json.modules.find((m) => m.id === 'secret-fixture').settings.find((d) => d.key === 'apiKey').value.set, false, 'none of that set it');
  });

  await test('setting it answers { set: true } and never the value, in the answer or on the list, for the owner', async () => {
    const r = await put(owner, { apiKey: FAKE, label: 'hello' });
    assert.equal(r.status, 200, r.text);
    assert.ok(!r.text.includes(FAKE));
    const def = r.json.settings.find((d) => d.key === 'apiKey');
    assert.deepEqual(def.value, { set: true });
    assert.equal(def.type, 'secret');
    const list = await getSetting(owner);
    assert.ok(!list.text.includes(FAKE));
    assert.deepEqual(apiKeyOf(list).value, { set: true });
    assert.equal('default' in apiKeyOf(list), false);
  });

  await test('every read answers only { set }: the module\'s own page, a member, the access key, the module list, the context, the activity list', async () => {
    const reads = [
      ['owner values', call('GET', '/api/modules/secret-fixture/settings/values', { token: owner })],
      ['member values', call('GET', '/api/modules/secret-fixture/settings/values', { token: aliceT })],
      ['moderator values', call('GET', '/api/modules/secret-fixture/settings/values', { token: modT })],
      ['access key values', call('GET', `/api/modules/secret-fixture/settings/values?s=${stream}`)],
      ['context', call('GET', '/api/modules/secret-fixture/context', { token: aliceT })],
      ['module list', call('GET', '/api/modules', { token: owner })],
      ['activity', call('GET', '/api/modules/activity', { token: owner })],
      ['settings', call('GET', '/api/settings', { token: owner })],
      ['status', call('GET', '/api/status', { token: owner })],
      ['me', call('GET', '/api/me', { token: owner })],
      ['for-space', call('GET', `/api/modules/for-space?space=${space.id}`, { token: aliceT })],
      ['data', call('GET', '/api/modules/secret-fixture/data?scope=environment', { token: owner })],
    ];
    for (const [what, p] of reads) {
      const r = await p;
      for (const needle of [FAKE, 'aesgcm']) assert.ok(!r.text.includes(needle), `${what} carries ${needle === FAKE ? 'the value' : 'a sealed value'}`);
    }
    const v = await call('GET', '/api/modules/secret-fixture/settings/values', { token: aliceT });
    assert.equal(v.status, 200, v.text);
    assert.deepEqual(v.json.values.apiKey, { set: true }, 'a page sees only that one is set');
    assert.equal(v.json.values.label, 'hello');
    const other = await call('GET', '/api/modules/secret-other/settings/values', { token: owner });
    assert.ok(!('apiKey' in other.json.values), 'another module sees nothing of it');
  });

  await test('a value too long is 413, a hostile one is taken as plain text and never reflected, and the old key stays through a refusal', async () => {
    const tooLong = await put(owner, { apiKey: `FAKE${'x'.repeat(300)}` });
    assert.equal(tooLong.status, 413);
    assert.equal(tooLong.json.error, 'Service key is too long');
    const huge = await call('PUT', '/api/modules/secret-fixture/settings/environment', { token: owner, raw: JSON.stringify({ values: { apiKey: 'z'.repeat(200000) } }), body: {} });
    assert.equal(huge.status, 413);
    assert.ok(!huge.text.includes('zzzz'));
    for (const bad of ['line\nbreak', 'a\r\nb', 'nul\u0000byte', 'esc\u001b[31m']) {
      const r = await put(owner, { apiKey: bad });
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.equal(r.json.error, 'Service key must not have line breaks or control characters');
    }
    for (const bad of [123, true, ['a'], { a: 1 }, null]) assert.equal((await put(owner, { apiKey: bad })).status, 400, JSON.stringify(bad));
    const html = '<script>alert("FAKE-xss")</script><img src=x onerror=alert(1)>';
    const r = await put(owner, { apiKey: html });
    assert.equal(r.status, 200, r.text);
    assert.ok(!r.text.includes('FAKE-xss') && !r.text.includes('onerror'), 'not reflected');
    assert.ok(!(await getSetting(owner)).text.includes('onerror'));
    assert.ok(!(await call('GET', '/api/modules/secret-fixture/settings/values', { token: aliceT })).text.includes('onerror'));
    assert.ok(!filesHolding('onerror').length, `the plain hostile value is in no file: ${filesHolding('onerror')}`);
    assert.ok(!log.includes('onerror') && !log.includes('FAKE-xss'), 'nor in the server\'s log');
    const edge = await put(owner, { apiKey: 'x'.repeat(200) });
    assert.equal(edge.status, 200, 'exactly the bound is taken');
    assert.equal((await put(owner, { apiKey: FAKE })).status, 200);
  });

  await test('on the disk: sealed in a private file of its own, in no other file, no answer above and no log line', async () => {
    assert.deepEqual(filesHolding(FAKE), [], 'the plain value is in no file at all');
    const secretsPath = path.join(dataDir, 'modules', 'secrets.json');
    assert.equal(fs.statSync(secretsPath).mode & 0o777, 0o600);
    const sealed = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
    assert.match(sealed['secret-fixture'].apiKey, /^aesgcm\$[0-9a-f]+\$[0-9a-f]+\$[0-9a-f]+$/);
    assert.ok(!fs.readFileSync(path.join(dataDir, 'modules', 'settings.json'), 'utf8').includes('aesgcm'), 'settings.json holds no sealed form');
    assert.ok(!fs.readFileSync(path.join(dataDir, 'modules', 'settings.json'), 'utf8').includes('apiKey'), 'nor the setting\'s name with a value');
    assert.ok(!log.includes(FAKE) && !log.includes('aesgcm'), 'the server logged neither');
  });

  await test('an owner\'s copy of the folder as it now is leaves the file out, and no entry holds the value', async () => {
    const walk = (dir, base = dir, out = []) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, base, out); else if (e.isFile()) out.push([path.relative(base, full).split(path.sep).join('/'), fs.readFileSync(full)]);
      }
      return out;
    };
    const entries = exportLib.exportEntries(walk(dataDir), JSON.parse(fs.readFileSync(path.join(dataDir, 'app.json'), 'utf8')), { declared: () => [] });
    assert.ok(entries.length > 1);
    assert.ok(!entries.some(([name]) => name === 'modules/secrets.json'));
    for (const [name, data] of entries) {
      assert.ok(!data.includes(FAKE), `${name} holds the value`);
      assert.ok(!data.includes('"aesgcm$' + sealedOf()), `${name} holds the sealed form`);
    }
    function sealedOf() { return JSON.parse(fs.readFileSync(path.join(dataDir, 'modules', 'secrets.json'), 'utf8'))['secret-fixture'].apiKey.split('$')[1]; }
  });

  await test('it is still set after a restart, and clearing removes it from the file and the answers; clearing twice is fine', async () => {
    await stopServer();
    await startServer();
    const token = await signIn('admin', 'testpass1234');
    assert.deepEqual(apiKeyOf(await getSetting(token)).value, { set: true });
    const r = await put(token, { apiKey: '' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.settings.find((d) => d.key === 'apiKey').value, { set: false });
    assert.deepEqual(apiKeyOf(await getSetting(token)).value, { set: false });
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'modules', 'secrets.json'), 'utf8'))['secret-fixture'], undefined);
    assert.equal((await put(token, { apiKey: '' })).status, 200);
    assert.deepEqual(filesHolding(FAKE), []);
    const label = await put(token, { label: 'only the label' });
    assert.deepEqual(label.json.settings.find((d) => d.key === 'apiKey').value, { set: false }, 'saving other settings does not touch it');
  });

  await test('removing the module with its data takes the key with it', async () => {
    assert.equal((await put(owner, { apiKey: FAKE2 })).status, 200);
    assert.ok(fs.readFileSync(path.join(dataDir, 'modules', 'secrets.json'), 'utf8').includes('aesgcm$'));
    const del = await call('DELETE', '/api/modules/secret-fixture?keepData=0', { token: owner });
    assert.equal(del.status, 200, del.text);
    assert.ok(!fs.readFileSync(path.join(dataDir, 'modules', 'secrets.json'), 'utf8').includes('aesgcm$'));
    assert.deepEqual(filesHolding(FAKE2), []);
    assert.ok(!log.includes(FAKE2));
  });
} catch (err) {
  failed += 1;
  console.error(err.stack || err);
} finally {
  await stopServer();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-secret-setting: ${failed} failed`);
  process.exit(1);
}
console.log(`check-secret-setting: ${n} groups OK`);
