// A throwaway hosted server for the host console's checks (tools/check-host-console.mjs): BASE_DOMAIN=localhost (Chromium
// sends localhost and every *.localhost to this machine), a host admin from ADMIN_LOGIN and ADMIN_PASSWORD, and `count`
// invented environments in every state the console draws: active, suspended, past due, won't open (an unreadable
// app.json), deletion asked, degraded, at a cap and near one. Made through the host routes, then the few states no route
// sets from here (deletion asked, degraded, AI calls this month, won't open) written into the data folder between two starts.
//
//   node tools/host-console-seed.mjs --serve [--count=30]   seed and stay up, printing the console's address (for a person to look)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOST_LOGIN = 'boss';
export const HOST_PASSWORD = 'check-host-console-pass-1';

const NAMES = ['Harbour Club', 'Lisbon in May', 'The Long Table', 'Northside Writers', 'Oakridge Hikers', 'Tiny Trips', 'Old Book Club',
  'Summer Camp 2025 for the whole extended family', 'Greenway Co-op', 'Dragons Rest', 'Test environment', 'Kims rollback', 'Riverside Chess',
  'Anas Birthday Trip', 'Westgate Gamers', 'Maple Street Reading Circle', 'The Pines', 'Coffee and Code', 'Uncle Joes 80th', 'Moonlight Games',
  'Berlin 2027', 'Sunday League', 'Quiet Corner', 'Atlas Guild', 'Visiting Grandma', 'Night Owls', 'Patagonia', 'The Quest Board', 'Vale Family', 'Zeta Lab'];
export const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30).replace(/-$/, '');
// What each of the first environments is made to be (the rest are active and well under their caps).
// i: 1 near a cap (AI 45 of 50), 2 at a cap (members 1 of 1), 3 and 4 past due, 6 suspended, 7 suspended, 8 won't open,
// 10 deletion asked, 12 degraded. With 6, the first six: one of most kinds.
export const STATES = { 1: 'near', 2: 'atcap', 3: 'pastDue', 4: 'pastDue', 5: 'deletion', 6: 'suspended', 7: 'suspended', 8: 'refused', 10: 'deletion', 12: 'degraded' };
export const PLANS = {
  free: { name: 'Free', caps: { modules: 'all', members: 10, storageBytes: 2e9, aiCallsPerMonth: 50, calls: 2 } },
  pro: { name: 'Pro', caps: { modules: 'all', members: 60, storageBytes: 50e9, aiCallsPerMonth: 2000, calls: 10 } },
};

export function call(port, method, host, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: { host: `${host ? `${host}.` : ''}localhost:${port}`, accept: 'application/json', ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length, origin: `http://${host ? `${host}.` : ''}localhost:${port}` } : {}), ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ } resolve({ status: res.statusCode, json, text, cookies: (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]) }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export async function startServer(dataDir, port, env = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), DATA_DIR: dataDir, BASE_DOMAIN: 'localhost', ADMIN_LOGIN: HOST_LOGIN, ADMIN_PASSWORD: HOST_PASSWORD, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ...env },
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const end = Date.now() + 30000;
  while (!/listening on :\d+/.test(log)) {
    if (child.exitCode !== null || Date.now() > end) throw new Error(`the throwaway server did not start:\n${log.slice(-600)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  child.log = () => log;
  return child;
}
export function stopServer(child) {
  return new Promise((resolve) => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
}
export async function hostCookie(port) {
  const res = await call(port, 'POST', 'admin', '/api/host/login', { login: HOST_LOGIN, password: HOST_PASSWORD });
  if (res.status !== 200) throw new Error(`host sign-in: ${res.status} ${res.text}`);
  return res.cookies.find((c) => c.startsWith('host_session='));
}

// Seeds `count` environments into an empty data folder and answers the running server and its host cookie.
export async function seed({ count, port, dataDir }) {
  let child = await startServer(dataDir, port);
  let cookie = await hostCookie(port);
  const as = (method, p, body) => call(port, method, 'admin', p, body, { cookie });
  let r = await as('PUT', '/api/host/plans', PLANS);
  if (r.status !== 200) throw new Error(`plans: ${r.text}`);
  const templates = ((await as('GET', '/api/host/templates')).json.templates || []).map((t) => t.id);
  const made = [];
  for (let i = 0; i < count; i += 1) {
    const name = NAMES[i % NAMES.length];
    const slug = slugOf(name);
    const planId = i % 3 === 0 ? 'pro' : 'free';
    const caps = { ...PLANS[planId].caps, ...(STATES[i] === 'atcap' ? { members: 1 } : {}) };
    const template = i < 6 && templates.length ? templates[i % templates.length] : undefined;
    r = await as('POST', '/api/host/environments', { slug, name, plan: { name: planId, ...caps }, ...(template ? { template } : {}), owner: { login: `own-${slug}`.slice(0, 40), displayName: `Owner of ${name}`, password: 'owner-password-1' } });
    if (r.status !== 201) throw new Error(`create ${slug}: ${r.status} ${r.text}`);
    if (STATES[i] === 'suspended' || STATES[i] === 'pastDue') {
      r = await as('PATCH', `/api/host/environments/${slug}`, { status: STATES[i] });
      if (r.status !== 200) throw new Error(`status ${slug}: ${r.text}`);
    }
    made.push({ slug, name, plan: planId, state: STATES[i] || 'active' });
  }
  if (!count) return { child, cookie, made };
  // The states no host route sets: written while the server is stopped.
  await new Promise((res) => setTimeout(res, 1500)); // a template's background installs
  await stopServer(child);
  const file = path.join(dataDir, 'host.json');
  const host = JSON.parse(fs.readFileSync(file, 'utf8'));
  const month = new Date().toISOString().slice(0, 7);
  const days = (n) => new Date(Date.now() - n * 86400000).toISOString();
  for (const e of host.environments) {
    const i = made.findIndex((m) => m.slug === e.slug);
    const state = STATES[i];
    e.usage = { ...(e.usage || {}), aiMonth: month, aiCalls: state === 'near' ? 45 : (i * 7) % 20 };
    if (state === 'deletion') { e.deleteRequestedAt = days(3); e.deleteRequestReason = 'We are done with it.'; }
    if (state === 'degraded') e.degradedAt = days(9);
    if (state === 'pastDue') e.pastDueSince = days(4 + i);
    if (state === 'refused') fs.writeFileSync(path.join(dataDir, 'environments', e.slug, 'app.json'), '{ not json');
  }
  fs.writeFileSync(file, JSON.stringify(host, null, 2));
  child = await startServer(dataDir, port);
  cookie = await hostCookie(port);
  return { child, cookie, made };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--serve')) {
  const count = Number((process.argv.find((a) => a.startsWith('--count=')) || '--count=30').slice(8));
  const port = Number((process.argv.find((a) => a.startsWith('--port=')) || '--port=0').slice(7)) || 3990;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-console-seed-'));
  const { child } = await seed({ count, port, dataDir });
  console.log(`http://admin.localhost:${port}/  (sign in as ${HOST_LOGIN}; data in ${dataDir}; pid ${child.pid})`);
  const stop = async () => { await stopServer(child); fs.rmSync(dataDir, { recursive: true, force: true }); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
