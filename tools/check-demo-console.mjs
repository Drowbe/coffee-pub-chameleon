#!/usr/bin/env node
/*
 * check-demo-console.mjs -- POST /api/host/environments/:slug/demo (the host console's "Add demo space").
 * Boots a throwaway hosted server (BASE_DOMAIN=localhost) and asserts: anonymous, an environment's owner and a cross-site
 * request are refused; a host admin adds the demo (the report has the space, counts and one-time passwords; nothing is
 * stored in the data folder or the log); a second add is refused with the plain sentence; a space with the demo's name
 * but no marker is left alone; an unknown and a suspended environment are refused. No LiveKit and no browser.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = { login: 'boss', password: 'check-demo-console-1' };
const OWNER_PASSWORD = 'owner-password-1234';
const demoName = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'demo', 'travel.json'), 'utf8')).name;
const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-demo-console-'));
let log = '';
const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), DATA_DIR: dataDir, BASE_DOMAIN: 'localhost', ADMIN_LOGIN: HOST.login, ADMIN_PASSWORD: HOST.password, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret' },
});
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });
let ip = 0;
const call = (method, host, urlPath, body, headers = {}) => new Promise((resolve, reject) => {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  ip += 1;
  const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: { host: `${host}.localhost:${port}`, accept: 'application/json', 'x-forwarded-for': `198.51.100.${ip}`, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}), ...headers } }, (res) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { text += d; });
    res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ } resolve({ status: res.statusCode, json, text, cookie: (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ') }); });
  });
  req.on('error', reject);
  if (payload) req.write(payload);
  req.end();
});
const stop = () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
let failed = 0;
try {
  for (let i = 0; i < 100; i += 1) {
    if (/listening on/.test(log)) break;
    if (child.exitCode !== null) throw new Error(`the server stopped:\n${log}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const login = await call('POST', 'admin', '/api/host/login', HOST);
  assert.equal(login.status, 200, login.text);
  const admin = { cookie: login.cookie };
  for (const slug of ['alpha', 'beta']) {
    const made = await call('POST', 'admin', '/api/host/environments', { slug, name: slug, template: 'travel', owner: { login: `own${slug}`, displayName: slug, password: OWNER_PASSWORD } }, admin);
    assert.equal(made.status, 201, made.text);
  }
  const ownerOf = async (slug) => {
    const r = await call('POST', slug, '/api/login', { login: `own${slug}`, password: OWNER_PASSWORD });
    assert.equal(r.status, 200, r.text);
    return { cookie: r.cookie };
  };
  const url = (slug) => `/api/host/environments/${slug}/demo`;

  assert.equal((await call('POST', 'admin', url('alpha'))).status, 401, 'anonymous is refused');
  assert.equal((await call('POST', 'admin', url('alpha'), undefined, await ownerOf('alpha'))).status, 401, 'an owner is refused');
  const cross = await call('POST', 'admin', url('alpha'), undefined, { ...admin, 'sec-fetch-site': 'cross-site' });
  assert.equal(cross.status, 403, 'a cross-site request is refused');
  assert.equal((await call('POST', 'admin', url('nope'), undefined, admin)).status, 404, 'unknown environment');

  const added = await call('POST', 'admin', url('alpha'), undefined, admin);
  assert.equal(added.status, 200, added.text);
  assert.equal(added.json.demo, true);
  assert.equal(added.json.fellBack, false);
  assert.ok(added.json.space && added.json.space.id, 'the report names the space');
  assert.ok(added.json.people.length && added.json.people.every((p) => p.password && p.password.length >= 12), 'one-time passwords come back');
  assert.ok(Object.values(added.json.created).some((n) => n > 0), 'something was made');
  const owner = await ownerOf('alpha');
  const spaces = (await call('GET', 'alpha', '/api/spaces', undefined, owner)).json.spaces;
  assert.ok(spaces.some((s) => s.name === demoName), 'the demo space is there');

  const again = await call('POST', 'admin', url('alpha'), undefined, admin);
  assert.equal(again.status, 409);
  assert.match(again.json.error, /^The demo (space|trip) is already there\. Delete it, then add it again\.$/);

  const plain = await call('POST', 'beta', '/api/spaces', { name: demoName, description: 'Mine.' }, await ownerOf('beta'));
  assert.ok(plain.status < 300, plain.text);
  const kept = await call('POST', 'admin', url('beta'), undefined, admin);
  assert.equal(kept.status, 409, 'a space with the name and no marker is refused');
  assert.match(kept.json.error, /not the demo/);
  const after = (await call('GET', 'beta', '/api/spaces', undefined, await ownerOf('beta'))).json.spaces;
  assert.equal(after.filter((s) => s.name === demoName).length, 1, 'it is left alone');

  assert.equal((await call('PATCH', 'admin', '/api/host/environments/beta', { status: 'suspended' }, admin)).status, 200);
  const sus = await call('POST', 'admin', url('beta'), undefined, admin);
  assert.equal(sus.status, 409);
  assert.match(sus.json.error, /suspended/);

  await stop();
  const keep = (added.json.people.map((p) => p.password));
  const files = fs.readdirSync(dataDir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
  for (const f of files) { const text = fs.readFileSync(f, 'latin1'); for (const pw of keep) assert.ok(!text.includes(pw), `a demo password is stored in ${f}`); }
  for (const pw of keep) assert.ok(!log.includes(pw), 'a demo password is in the log');
  console.log('check-demo-console: ok');
} catch (err) {
  failed = 1;
  console.error(`check-demo-console: ${err.stack || err.message}`);
} finally {
  await stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed);
