#!/usr/bin/env node
/*
 * check-module-live.mjs -- live messages for modules (documentation/plans/plan-module-live.md, steps 1 to 3; its Verify
 * section, points 1 to 7). Live messages travel over the app's own server, never over the call.
 *
 * First server/module-live.js on its own, with a clock handed in: connections indexed by space, join and leave, the grace
 * after a stream closes (a reconnect within it is neither a leave nor a join), the rates (a burst, then a wait, refilled),
 * the sequence per module and space, and what a send's body may hold (topic, data, to; nothing else, `__proto__` included).
 *
 * Then the rule that this is not the call, read as code: server/module-live.js requires nothing but Node's crypto and
 * names no LiveKit, and the live section of server/index.js (between its markers) and the module stream's route name none
 * of livekit, callService, HAS_CALL_SERVICE, publishData, /api/call/ or /api/token. (host.live in public/sdk/host.js, the
 * page's side in public/module-live.js and its wiring in public/module-host.js are read by tools/check-sdk-live.mjs.)
 *
 * Then three throwaway servers (PORT=0, DATA_DIR under the temp folder), with three modules built here: live-a (`live:
 * true`, read guarded by `view`), live-p (`live: { publish: "point" }`, `point` for moderators) and live-off (no `live`).
 *   1. No LiveKit keys at all, nobody on a call. Two members in a space: a message reaches the other, never the sender's own
 *      two tabs; `to` reaches only the named one; the owner and the space's guest receive; nothing reaches a member of
 *      another space (on their own space or on this one's stream), another space's guest, nor this space's stream opened
 *      with another space's guest link. The module and the space come from the server: a topic can't cross modules, the
 *      event is always `live`, a body can't set `from` or `module`, and data that looks like an event stays data. `at`
 *      and `seq` are the server's. Refusals with their sentences: no `live` (400), no read (403), the publish permission
 *      missing (403), a guest without a valid pass (403), signed out (401), no space (400), no such space or module (404), a bad topic or `to`
 *      (400), data over MODULE_LIVE_BYTES (413), past MODULE_LIVE_PER_SECOND (429 with Retry-After). `joined` and `left`:
 *      a join answers who is there and tells the others once; a second tab joining tells nobody; a stream that is not
 *      yours or not in this space is 409; a closed stream says `left` after its grace (10 seconds), a reconnect within the
 *      grace says neither; a leave says `left` at once. Access lost stops delivery at once (well under the 2-second recheck):
 *      a member taken out of the space (also `removed` on GET /api/live, and `left` to the others), a role that loses the
 *      module's read, the moderator tick taken away (from live-m, read only by moderators, and from live-p's sending), an
 *      owner made a member, a new password, a person deleted and a guest link turned off (each stream ends in under
 *      300 ms), the module turned off, rolled back to a version without `live` or removed; each next send is refused.
 *      With nothing to tell the streams (a person turning on their own two-step sign-in), the 2-second recheck alone ends
 *      the old session's stream within about 2.5 s. Guests by their pass (step 3): two guests on one link are told apart
 *      (each sends as the id and name on their pass, never hears their own, can be named in `to`, joins and leaves as
 *      themselves, and can't join on another's stream); a stream with no valid pass still receives but can't be joined on;
 *      another link's pass, another space, a forged pass (another guest's or a member's key on a signature), the publish
 *      permission and a module guests may not read are refused; the link turned off ends their streams and refuses their
 *      sends, and a joined guest is told to the others as left, by the name on their pass. Flood and abuse:
 *      many topics, huge bodies, malformed JSON, deep nesting, prototype-pollution keys and many streams leave the server
 *      answering and delivering. Nothing is written to DATA_DIR.
 *   2. Dummy LiveKit keys and a stand-in for the call service's API that counts every request: sending, joining, leaving
 *      and receiving ask it nothing. The limits read from the environment (MODULE_LIVE_BYTES, _PER_SECOND, _PER_PERSON,
 *      _TO, _PER_GUEST_LINK: everyone on one link together) hold. Module streams with a space are counted per person and per guest link (LIVE_STREAMS_PER_PERSON,
 *      LIVE_STREAMS_PER_GUEST_LINK, one address its share), apart from GET /api/live's: one over is 429 in the same
 *      sentence, a closed one gives its place back, and a stream with no space is not counted.
 *   3. Two environments (BASE_DOMAIN): a message in one never reaches a reader of the same module in the other, and the
 *      host console resetting an owner's two-step sign-in ends their stream in that environment at once. A guest's pass
 *      from one environment is refused in the other.
 * What can't be checked here: the feel of live pointers between two real browsers on a real network, and load beyond a
 * handful of people.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { ModuleLive, liveLimits, readSend, dataBytes } = require('../server/module-live.js');
const { buildModule } = require('../server/module-build.js');
const { totpCode } = require('../server/auth.js');
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n += 1; };
const same = (a, b, msg) => { assert.deepEqual(a, b, msg); n += 1; };
const quiet = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// --- the register on its own -------------------------------------------------------------------------------------------
{
  let t = 1000;
  let ids = 0;
  const reg = new ModuleLive({ now: () => t, makeId: () => `c${(ids += 1)}` });
  const got = [];
  const conn = (who, space, readable = true) => reg.open({ who, space, deliver: (b) => got.push([who, b]), mayRead: () => readable });
  const a1 = conn('al', 'keep');
  const a2 = conn('al', 'keep');
  const b1 = conn('bo', 'keep');
  const t1 = conn('cy', 'tower');
  same(reg.inSpace('keep').map((c) => c.id), [a1, a2, b1], 'connections are indexed by space');
  same(reg.inSpace('tower').map((c) => c.id), [t1], 'and only their own space');
  same(reg.connection('nope'), null, 'an unknown id is no connection');
  same(reg.connection({}), null, 'nor is anything that is not text');

  same(reg.join(a1, 'board'), { joined: true }, 'the first join is new');
  same(reg.join(a2, 'board'), { joined: false }, 'a second tab of the same person is not');
  same(reg.join(b1, 'board'), { joined: true }, 'another person is');
  same(reg.people('board', 'keep'), [{ key: 'al', guest: false, name: '' }, { key: 'bo', guest: false, name: '' }], 'both listed (a person\'s name is read from their account, not kept here)');
  same(reg.people('board', 'tower'), [], 'not in another space');
  same(reg.people('other', 'keep'), [], 'nor for another module');
  const g = reg.open({ who: null, guest: true, space: 'keep', deliver: () => {}, mayRead: () => true });
  same(reg.join(g, 'board'), null, 'a connection with no person (a guest who gave no valid pass) does not join');
  // A guest by their pass (step 3): known by its id, with the name on the pass kept (they have no account).
  const gp = reg.open({ who: 'guest-Zed01', name: 'Zed', guest: true, space: 'keep', deliver: () => {}, mayRead: () => true });
  same(reg.join(gp, 'board'), { joined: true }, 'a guest by their pass joins');
  same(reg.people('board', 'keep').find((p) => p.key === 'guest-Zed01'), { key: 'guest-Zed01', guest: true, name: 'Zed' }, 'listed with the name on their pass');
  same(reg.open({ who: 'x1y2', name: 'Not kept', space: 'keep', deliver: () => {}, mayRead: () => true }) && reg.inSpace('keep').at(-1).name, '', 'a name is kept for a guest only');
  reg.close(reg.inSpace('keep').at(-1).id);
  same(reg.leave(gp, 'board'), { left: true }, 'and leaves');
  reg.close(gp);

  same(reg.close(a1), [], 'closing one of two tabs: still there, no grace');
  same(reg.close(a2), [{ module: 'board', space: 'keep', who: 'al', name: '', guest: false, until: t + 10000 }], 'closing the last: a grace of 10 seconds');
  same(reg.people('board', 'keep').map((p) => p.key), ['al', 'bo'], 'listed during the grace');
  t += 5000;
  same(reg.sweep(), [], 'nothing to sweep inside the grace');
  const a3 = conn('al', 'keep');
  same(reg.join(a3, 'board'), { joined: false }, 'a reconnect within the grace is not a new join');
  same(reg.close(a3).length, 1, 'closed again');
  t += 10001;
  same(reg.sweep(), [{ module: 'board', space: 'keep', who: 'al', name: '', guest: false }], 'after the grace: left');
  same(reg.people('board', 'keep').map((p) => p.key), ['bo'], 'and no longer listed');
  same(reg.sweep(), [], 'said once');
  same(reg.leave(b1, 'board'), { left: true }, 'a leave is at once');
  same(reg.leave(b1, 'board'), null, 'twice is nothing');
  same(reg.people('board', 'keep'), [], 'nobody there');
  // A grace that ran out before the sweep: a join then is new.
  const a4 = conn('al', 'keep');
  reg.join(a4, 'board');
  reg.close(a4);
  t += 20000;
  const a5 = conn('al', 'keep');
  same(reg.join(a5, 'board'), { joined: true }, 'a join after the grace ran out is new, swept or not');

  // Rates: a burst of the rate, then a wait; refilled at the rate.
  const take = () => reg.take([['p:al:board', 3], ['p:al', 5]]);
  same([take(), take(), take()], [0, 0, 0], 'a burst of 3');
  same(take(), 1, 'the fourth waits a second');
  t += 340;
  same(take(), 0, 'a third of a second later one more');
  same(take(), 1, 'and no more');
  t += 1000;
  same(reg.take([['p:al:other', 3], ['p:al', 5]]), 0, 'another module, the person\'s own rate');
  same(reg.take([['p:al:other', 3], ['p:al', 5]]), 0, '');
  same(reg.take([['p:al:other', 3], ['p:al', 5]]), 0, '');
  same(reg.take([['p:al:other', 3], ['p:al', 5]]), 1, 'past the person\'s rate (5 a second across modules), even with the module\'s left');
  t += 1000;
  reg.prune();
  same(reg.buckets.size, 0, 'buckets untouched for a second are let go');

  same([reg.stamp('board', 'keep').seq, reg.stamp('board', 'keep').seq, reg.stamp('board', 'tower').seq, reg.stamp('other', 'keep').seq], [1, 2, 1, 1], 'seq counts per module and space');
  same(reg.stamp('board', 'keep').at, t, 'at is the server\'s clock');
  reg.forgetSpace('keep');
  same([reg.stamp('board', 'keep').seq, reg.stamp('board', 'tower').seq, reg.people('board', 'keep')], [1, 2, []], 'a space deleted: its sequence numbers and joins go, another space\'s stay');
  void got;
}

// --- a send's body, and the limits -----------------------------------------------------------------------------------
{
  const L = liveLimits({});
  same(L, { bytes: 256, perSecond: 20, perPerson: 40, perGuestLink: 60, to: 20 }, 'the defaults');
  same(liveLimits({ MODULE_LIVE_BYTES: '64', MODULE_LIVE_PER_SECOND: '0', MODULE_LIVE_PER_PERSON: '2.5', MODULE_LIVE_PER_GUEST_LINK: 'x', MODULE_LIVE_TO: '3' }), { bytes: 64, perSecond: 20, perPerson: 40, perGuestLink: 60, to: 3 }, 'set from the environment; anything but a whole number above 0 is the default');
  same(readSend({ topic: 'pointer', data: { x: 1 } }, L), { topic: 'pointer', data: { x: 1 }, to: null }, 'topic and data');
  same(readSend({ topic: 'nudge' }, L), { topic: 'nudge', data: null, to: null }, 'no data is null');
  same(readSend({ topic: 'a', to: ['abcd', 'abcd', 'guest-Ab_9'] }, L).to, ['abcd', 'guest-Ab_9'], 'to: keys and guest ids, once each');
  for (const [body, why] of [
    [null, 'no body'], [[], 'a list'], ['x', 'text'],
    [{ topic: 'Pointer' }, 'upper case'], [{ topic: '' }, 'empty'], [{ topic: 'x'.repeat(41) }, 'too long'], [{ topic: 'a b' }, 'a space'], [{ topic: 5 }, 'a number'], [{}, 'no topic'],
    [{ topic: 'a', to: [] }, 'to empty'], [{ topic: 'a', to: 'abcd' }, 'to not a list'], [{ topic: 'a', to: ['ABCD'] }, 'a bad key'], [{ topic: 'a', to: ['__proto__'] }, 'to __proto__'], [{ topic: 'a', to: Array.from({ length: 21 }, (_, i) => `k${String(i).padStart(3, '0')}`) }, '21 people'],
    [{ topic: 'a', from: { key: 'x' } }, 'from'], [{ topic: 'a', module: 'other' }, 'module'], [{ topic: 'a', seq: 1 }, 'seq'], [JSON.parse('{"topic":"a","__proto__":{"x":1}}'), '__proto__'], [{ topic: 'a', constructor: {} }, 'constructor'],
  ]) ok(readSend(body, L).error, `refused: ${why}`);
  same(readSend({ topic: '__proto__', data: JSON.parse('{"__proto__":{"polluted":1}}') }, L).topic, '__proto__', 'a topic is only text: __proto__ is as good as any');
  same(({}).polluted, undefined, 'and nothing was polluted');
  same(dataBytes({ x: 1 }), 7, 'size as JSON');
  same(dataBytes(undefined), 4, 'no data is null');
}

// --- the guest pass on its own: server/index.js's own functions, the environment handed in --------------------------------
// The same link token and pass are refused in another environment, so a pass is for one environment even where two
// environments' links had the same token (the two-environment run below can only show it with different tokens).
{
  const index = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  const fnSrc = (head) => {
    const at = index.indexOf(head);
    assert.ok(at >= 0, `server/index.js has ${head}`);
    return index.slice(at, index.indexOf('\n}\n', at) + 2);
  };
  const src = ['function guestPassKey()', 'function guestPassSignature(', 'function makeGuestPass(', 'function readGuestPass('].map(fnSrc).join('\n');
  let slug = 'aaa';
  let epoch = 0;
  let hours = 24;
  const passes = new Function('crypto', 'secretsKeyBuf', 'currentEnvironment', 'guestEpoch', 'guestDoorLib', 'agreementTexts', 'agreementsLib', `${src}\nreturn { makeGuestPass, readGuestPass };`)(
    require('crypto'), () => Buffer.alloc(32, 7), () => ({ slug, guestLimits: { hours } }), () => epoch, require('../server/guest-door.js'), { required: false, docs: [], versions: {} }, require('../server/agreements.js'),
  );
  const pass = passes.makeGuestPass('LINKTOKEN1', 'guest-Abcd1234', 'Ada');
  same(passes.readGuestPass('LINKTOKEN1', pass), { id: 'guest-Abcd1234', name: 'Ada' }, 'a pass reads back in its own environment, with its own link');
  same(passes.readGuestPass('LINKTOKEN2', pass), null, 'not with another link');
  slug = 'bbb';
  same(passes.readGuestPass('LINKTOKEN1', pass), null, 'the same link token and pass in another environment: refused');
  slug = undefined;
  same(passes.readGuestPass('LINKTOKEN1', pass), null, 'nor on a single-environment install');
  const plain = passes.makeGuestPass('LINKTOKEN1', 'guest-Abcd1234', 'Ada');
  slug = 'aaa';
  same(passes.readGuestPass('LINKTOKEN1', plain), null, 'and a single-environment pass is refused in an environment');
  epoch = 1;
  same(passes.readGuestPass('LINKTOKEN1', pass), null, 'a pass of an older epoch is refused');
  epoch = 0;
  hours = 0.0000001;
  await new Promise((r) => setTimeout(r, 20));
  same(passes.readGuestPass('LINKTOKEN1', pass), null, 'a pass past GUEST_SESSION_HOURS is refused');
}

// --- not the call: read as code ----------------------------------------------------------------------------------------
const CALL_WORDS = /livekit|callService|HAS_CALL_SERVICE|publishData|\/api\/call\/|\/api\/token/i;
{
  const liveFile = fs.readFileSync(path.join(ROOT, 'server', 'module-live.js'), 'utf8');
  same([...liveFile.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]), ['crypto'], 'server/module-live.js requires only Node\'s crypto');
  ok(!CALL_WORDS.test(liveFile), 'server/module-live.js names no LiveKit, call service or call route');
  const index = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  const from = index.indexOf('// --- module live messages (plan-module-live.md)');
  const to = index.indexOf('// --- end of module live messages');
  ok(from > 0 && to > from, 'server/index.js has the live section between its markers');
  const section = index.slice(from, to);
  ok(!CALL_WORDS.test(section), `the live section of server/index.js names no LiveKit, call service or call route${CALL_WORDS.test(section) ? `: ${CALL_WORDS.exec(section)[0]}` : ''}`);
  for (const route of ["app.post('/api/modules/:id/live'", "app.post('/api/modules/:id/live/join'", "app.post('/api/modules/:id/live/leave'"]) {
    same(index.split(route).length, 2, `${route} is defined once`);
    ok(index.indexOf(route) > from && index.indexOf(route) < to, `${route} is inside the live section`);
  }
  const streamFrom = index.indexOf("app.get('/api/modules/stream'");
  const streamTo = index.indexOf('\n});\n', streamFrom);
  ok(streamFrom > 0 && !CALL_WORDS.test(index.slice(streamFrom, streamTo)), 'the module stream\'s route names none of them either');
  ok(/openModuleLive\(/.test(index.slice(streamFrom, streamTo)), 'and opens the live register from inside it');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  ok(pkg.scripts.check.includes('node tools/check-module-live.mjs'), 'npm run check runs this check');
}

// --- the servers ---------------------------------------------------------------------------------------------------------
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'check-module-live-'));
function writeModule(id, extra) {
  const root = path.join(TMP, 'modules', id);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'module.json'), JSON.stringify({
    id, name: id, version: '1.0.0', scope: ['space'], icon: 'circle',
    surfaces: { canvas: { entry: `${id}.html`, menu: false } },
    permissions: [
      { key: 'view', label: 'View', default: { member: true, guest: true } },
      { key: 'point', label: 'Point', default: { member: false, moderator: true, guest: false } },
    ],
    access: { read: 'view' },
    ...extra,
  }));
  fs.writeFileSync(path.join(root, 'src', `${id}.html`), '<!DOCTYPE html><html><head><style>/*__CSS__*/</style></head><body><script>/*__JS__*/</script></body></html>');
  fs.writeFileSync(path.join(root, 'src', `${id}.css`), '');
  fs.writeFileSync(path.join(root, 'src', `${id}.js`), '');
  return buildModule(root).zip;
}
const ZIPS = {
  'live-a': writeModule('live-a', { live: true }),
  'live-p': writeModule('live-p', { live: { publish: 'point' } }),
  'live-off': writeModule('live-off', {}),
  // Read only by moderators (and owners): `point` guards reading.
  'live-m': writeModule('live-m', { live: true, access: { read: 'point' } }),
};
// A module whose 1.0.0 has no `live` and whose 1.1.0 has: rolled back, it has none.
const ROLL = [writeModule('live-r', {}), writeModule('live-r', { version: '1.1.0', live: true })];
const BAD_ZIPS = [
  [writeModule('live-env', { scope: ['person'], live: true }), 'module.json: live needs the "space" scope'],
  [writeModule('live-bad', { live: { publish: 'nosuch' } }), 'module.json: live.publish must name one of the module\'s own permissions'],
  [writeModule('live-odd', { live: 'yes' }), 'module.json: live must be true, or { "publish": "<permission>" }'],
];

// The stand-in for the call service's API: answers nobody and counts every request.
const lkAsked = [];
const lk = http.createServer((req, res) => {
  lkAsked.push(req.url);
  req.resume();
  req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"participants":[]}'); });
});
await new Promise((resolve) => lk.listen(0, '127.0.0.1', resolve));

let child = null;
let port = 0;
let out = '';
let dataDir = '';
let hostHeader = null; // set for the two-environment server
async function startServer(env) {
  dataDir = fs.mkdtempSync(path.join(TMP, 'data-'));
  out = '';
  const base = { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, ADMIN_PASSWORD: 'testpass1234', TRUST_PROXY_HOPS: '0' };
  const merged = { ...base, ...env };
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { cwd: ROOT, env: merged, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 30000);
    const look = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', look);
    child.stderr.on('data', look);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
}
const stopServer = () => new Promise((resolve) => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });

// One request: { status, json, text, retryAfter }. `raw` is a body sent as it is; `host` a Host header (an environment).
function call(method, urlPath, { body, cookie, raw, type = 'application/json', host = hostHeader } = {}) {
  const payload = raw !== undefined ? Buffer.from(raw) : body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const headers = { accept: 'application/json' };
    if (host) headers.host = host;
    if (cookie) headers.cookie = `app_session=${cookie}`;
    if (payload) { headers['content-type'] = type; headers['content-length'] = payload.length; }
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, json, text, retryAfter: res.headers['retry-after'] || null });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// An open event stream: `events` collects { event, data, id }; `until(pred)` waits for one; `ended` resolves when the
// server ends it; `close()` closes it.
const open = [];
function openStream(urlPath, { cookie, host = hostHeader } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { accept: 'text/event-stream' };
    if (host) headers.host = host;
    if (cookie) headers.cookie = `app_session=${cookie}`;
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: urlPath, headers, agent: false }, (res) => {
      const s = { status: res.statusCode, events: [], waiters: [], closed: false };
      s.close = () => { s.closed = true; req.destroy(); };
      if (res.statusCode !== 200) {
        let text = '';
        res.on('data', (d) => { text += d; });
        res.on('end', () => { s.text = text; try { s.error = JSON.parse(text).error; } catch { /* not JSON */ } resolve(s); });
        return;
      }
      let buf = '';
      let endedResolve;
      s.ended = new Promise((r) => { endedResolve = r; });
      res.setEncoding('utf8');
      res.on('data', (d) => {
        buf += d;
        let at;
        while ((at = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, at).split('\n');
          buf = buf.slice(at + 2);
          const dataLine = block.find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          const ev = block.find((l) => l.startsWith('event: '));
          const id = block.find((l) => l.startsWith('id: '));
          s.events.push({ event: ev ? ev.slice(7) : 'message', data: JSON.parse(dataLine.slice(6)), id: id ? id.slice(4) : null });
          for (const w of [...s.waiters]) w();
        }
      });
      const done = () => endedResolve(true);
      res.on('end', done);
      res.on('close', done);
      res.on('error', done);
      s.until = (pred, ms = 3000) => new Promise((ok2, no) => {
        const look = () => {
          const e = s.events.find(pred);
          if (!e) return;
          clearTimeout(timer);
          s.waiters.splice(s.waiters.indexOf(look), 1);
          ok2(e);
        };
        const timer = setTimeout(() => { s.waiters.splice(s.waiters.indexOf(look), 1); no(new Error(`no such event in ${ms} ms; got ${JSON.stringify(s.events).slice(0, 2000)}`)); }, ms);
        s.waiters.push(look);
        look();
      });
      s.lives = (moduleId = null) => s.events.filter((e) => e.event === 'live' && (!moduleId || e.data.module === moduleId));
      open.push(s);
      resolve(s);
    });
    req.on('error', (err) => { if (!String(err.message).includes('aborted') && !String(err.code).includes('ECONNRESET')) reject(err); });
    req.end();
  });
}
const within = (promise, ms) => Promise.race([promise, new Promise((r) => setTimeout(() => r('timeout'), ms))]);
const login = async (name, password) => {
  const r = await call('POST', '/api/login', { body: { login: name, password } });
  assert.equal(r.status, 200, `${name} signs in: ${r.text}`);
  return r.json.token;
};
// Every file under a folder with its size and time, to see that nothing was written.
function snapshot(dir) {
  const files = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { const st = fs.statSync(p); files[path.relative(dir, p)] = `${st.size}:${st.mtimeMs}`; }
    }
  };
  walk(dir);
  return files;
}
// Installs and turns on the three modules (as `cookie`, an owner who may add a zip).
async function installModules(cookie) {
  for (const [id, zip] of Object.entries(ZIPS)) {
    const up = await call('POST', '/api/modules', { cookie, raw: zip, type: 'application/zip' });
    assert.equal(up.status, 201, `${id} installs: ${up.text}`);
    const on = await call('PATCH', `/api/modules/${id}`, { cookie, body: { enabled: true } });
    assert.equal(on.status, 200, `${id} turns on: ${on.text}`);
  }
}
const ready = async (s) => (await s.until((e) => e.event === 'ready')).data.stream;
const MS = (space, extra = '') => `/api/modules/stream?space=${encodeURIComponent(space)}${extra}`;
const send = (moduleId, space, body, cookie, extra = '') => call('POST', `/api/modules/${moduleId}/live?space=${encodeURIComponent(space)}${extra}`, { cookie, body });

let failed = false;
try {
  // === 1. no LiveKit keys at all, nobody on a call =====================================================================
  await startServer({});
  ok(/No LiveKit: voice and video are off\./.test(out), 'the server says it has no LiveKit, once');
  const owner = await login('admin', 'testpass1234');
  for (const [zip, said] of BAD_ZIPS) {
    const r = await call('POST', '/api/modules', { cookie: owner, raw: zip, type: 'application/zip' });
    same([r.status, r.json?.error], [400, said], `refused at install: ${said}`);
  }
  await installModules(owner);
  const mk = async (loginName, displayName) => (await call('POST', '/api/users', { cookie: owner, body: { login: loginName, displayName, role: 'member', password: 'memberpass1234' } })).json.user;
  const pat = await mk('pat', 'Pat');
  const sam = await mk('sam', 'Sam');
  const lou = await mk('lou', 'Lou');
  const ivy = await mk('ivy', 'Ivy');
  const patC = await login('pat', 'memberpass1234');
  const samC = await login('sam', 'memberpass1234');
  const louC = await login('lou', 'memberpass1234');
  const ivyC = await login('ivy', 'memberpass1234');
  const mkSpace = async (name, members) => {
    const sp = (await call('POST', '/api/spaces', { cookie: owner, body: { name, members } })).json.space;
    await call('PATCH', `/api/spaces/${sp.id}`, { cookie: owner, body: { members } });
    return sp;
  };
  const keep = await mkSpace('Keep', [pat.key, sam.key, ivy.key]);
  const tower = await mkSpace('Tower', [lou.key]);
  const keepLink = (await call('POST', `/api/spaces/${keep.id}/guest-link`, { cookie: owner, body: {} })).json.space.guestToken;
  const towerLink = (await call('POST', `/api/spaces/${tower.id}/guest-link`, { cookie: owner, body: {} })).json.space.guestToken;

  // The readers: Pat in two tabs, Sam, Ivy, the owner and a guest in the Keep; Lou in the Tower and on the Keep's stream;
  // a Tower guest, and the Keep's stream opened with the Tower's guest link.
  const pat1 = await openStream(MS(keep.id), { cookie: patC });
  const pat2 = await openStream(MS(keep.id), { cookie: patC });
  const samS = await openStream(MS(keep.id), { cookie: samC });
  const ivyS = await openStream(MS(keep.id), { cookie: ivyC });
  const ownS = await openStream(MS(keep.id, '&page=1'), { cookie: owner });
  const guestS = await openStream(MS(keep.id, `&guest=${encodeURIComponent(keepLink)}`));
  const louT = await openStream(MS(tower.id), { cookie: louC });
  const louK = await openStream(MS(keep.id), { cookie: louC });
  const towerG = await openStream(MS(tower.id, `&guest=${encodeURIComponent(towerLink)}`));
  const crossG = await openStream(MS(keep.id, `&guest=${encodeURIComponent(towerLink)}`));
  const home = await openStream('/api/modules/stream', { cookie: patC });
  // A signed-in person who may not enter the space (Lou on the Keep) is told it is not there, as for an unknown id.
  const all = [pat1, pat2, samS, ivyS, ownS, guestS, louT, towerG, crossG];
  for (const s of all) same(s.status, 200, 'a module stream opens');
  same(louK.status, 404, 'a stream for a space they may not enter is refused as an unknown space');
  const ids = await Promise.all(all.map(ready));
  ok(ids.every((id) => typeof id === 'string' && id.length >= 16) && new Set(ids).size === ids.length, 'each stream with a space says its own id first (`ready`), long enough not to be guessed');
  await quiet(200);
  ok(!home.events.some((e) => e.event === 'ready'), 'a stream with no space says no ready: live messages are only in a space');
  await quiet(5500); // the module activity the installs noted is written after 5 seconds (environment.js saveActivity)
  const before = snapshot(dataDir);
  const asked0 = lkAsked.length;

  // --- 2. who receives ---------------------------------------------------------------------------------------------------
  const t0 = Date.now();
  same((await send('live-a', keep.id, { topic: 'pointer', data: { x: 1, y: 2 } }, samC)).json, { ok: true }, 'Sam sends: { ok: true }');
  const m1 = await pat1.until((e) => e.event === 'live');
  same(Object.keys(m1.data).sort(), ['at', 'data', 'from', 'module', 'seq', 'spaceId', 'topic'], 'the event: module, topic, data, from, at, seq, spaceId');
  same([m1.data.module, m1.data.topic, m1.data.data, m1.data.from, m1.data.spaceId], ['live-a', 'pointer', { x: 1, y: 2 }, { key: sam.key, name: 'Sam', guest: false }, keep.id], 'what Sam sent, from Sam as the server knows him, in the Keep');
  ok(typeof m1.data.at === 'number' && m1.data.at >= t0 - 1000 && m1.data.at <= Date.now() + 1000 && Number.isInteger(m1.data.seq), 'at is the server\'s time and seq a whole number');
  ok(m1.id, 'the event has an id');
  for (const s of [pat2, ivyS, ownS, guestS]) await s.until((e) => e.event === 'live' && e.data.seq === m1.data.seq);
  same(guestS.lives()[0].data.from.key, sam.key, 'the space\'s guest receives it too');
  await quiet(300);
  same(samS.lives().length, 0, 'never the sender');
  for (const [s, who] of [[louT, 'Lou in the Tower'], [louK, 'Lou on the Keep\'s stream (not a member)'], [towerG, 'the Tower\'s guest'], [crossG, 'the Keep\'s stream opened with the Tower\'s guest link'], [home, 'a stream with no space']]) {
    same(s.events.filter((e) => e.event === 'live').length, 0, `nothing reaches ${who}`);
  }
  same(ownS.lives()[0].data.view, undefined, 'the page view of a page=1 stream does not get it twice');
  same(ownS.lives().length, 1, 'once on a page=1 stream');

  await send('live-a', keep.id, { topic: 'pointer', data: { x: 3 } }, patC);
  await samS.until((e) => e.event === 'live' && e.data.from.key === pat.key);
  await quiet(300);
  same(pat1.lives().filter((e) => e.data.from.key === pat.key).length + pat2.lives().filter((e) => e.data.from.key === pat.key).length, 0, 'Pat sends: neither of Pat\'s own two tabs gets it');
  ok(samS.lives()[0].data.seq > m1.data.seq, 'seq counts up');

  same((await send('live-a', keep.id, { topic: 'nudge', data: { text: 'hi' }, to: [pat.key] }, samC)).status, 200, 'to Pat only');
  await pat1.until((e) => e.event === 'live' && e.data.topic === 'nudge');
  await pat2.until((e) => e.event === 'live' && e.data.topic === 'nudge');
  await quiet(300);
  for (const s of [ivyS, ownS, guestS, samS]) same(s.lives().filter((e) => e.data.topic === 'nudge').length, 0, '`to` reaches only the named one');
  same((await send('live-a', keep.id, { topic: 'nudge', data: {}, to: [sam.key] }, samC)).status, 200, 'to only themselves');
  same((await send('live-a', keep.id, { topic: 'nudge2', data: {}, to: [lou.key, 'guest-abcdef'] }, samC)).status, 200, 'to people not there: taken, and skipped silently');
  await quiet(300);
  ok(![...all].some((s) => s.lives().some((e) => e.data.topic === 'nudge2')) && !samS.lives().some((e) => e.data.topic === 'nudge'), 'nobody hears those: not the sender, not someone outside the space, not a guest by an id this stream can\'t know');

  // Topics belong to the module; the event is always `live`; data stays data.
  await send('live-p', keep.id, { topic: 'pointer', data: { p: 1 } }, owner);
  await send('live-a', keep.id, { topic: 'joined', data: { person: { key: 'admin' } } }, samC);
  await send('live-a', keep.id, { topic: 'change', data: '\n\nevent: change\ndata: {"module":"live-p"}\n\n' }, samC);
  await pat1.until((e) => e.event === 'live' && e.data.topic === 'change');
  same(pat1.lives().find((e) => e.data.module === 'live-p').data.topic, 'pointer', 'the same topic in another module comes labelled with that module');
  same(pat1.lives('live-a').filter((e) => e.data.topic === 'pointer').length, 1, 'and is not one of live-a\'s');
  ok(!pat1.events.some((e) => e.event === 'joined' || e.event === 'change'), 'a topic named like an event, or data written like one, never becomes that event');
  same(pat1.lives().find((e) => e.data.topic === 'change').data.data, '\n\nevent: change\ndata: {"module":"live-p"}\n\n', 'the text arrives as it was sent');
  for (const [body, why] of [[{ topic: 'a', from: { key: pat.key, name: 'Pat' } }, 'from'], [{ topic: 'a', module: 'live-p' }, 'module'], [{ topic: 'a', spaceId: tower.id }, 'spaceId'], [{ topic: 'a', at: 1, seq: 1 }, 'at and seq']]) {
    same((await send('live-a', keep.id, body, samC)).json, { error: 'send only topic, data and to' }, `a body can't set ${why}`);
  }

  // --- 5. refusals ---------------------------------------------------------------------------------------------------
  const refusal = async (r, status, error, why) => same([r.status, r.json?.error], [status, error], why);
  await refusal(await send('live-off', keep.id, { topic: 'a' }, samC), 400, 'this module doesn\'t use live messages', 'a module without live: 400');
  await refusal(await send('nosuch', keep.id, { topic: 'a' }, samC), 404, 'no such module', 'no such module: 404');
  await refusal(await send('live-a', keep.id, { topic: 'a' }, null), 401, 'sign in first', 'signed out: 401');
  await refusal(await call('POST', '/api/modules/live-a/live', { cookie: samC, body: { topic: 'a' } }), 400, 'live messages are only in a space; say which one', 'no space: 400');
  await refusal(await send('live-a', 'nosuch', { topic: 'a' }, samC), 404, 'no such space', 'no such space: 404');
  await refusal(await send('live-a', tower.id, { topic: 'a' }, samC), 404, 'no such space', 'another space: 404');
  await refusal(await send('live-p', keep.id, { topic: 'a' }, samC), 403, 'your role can\'t send live messages in this module', 'the publish permission missing: 403');
  await refusal(await send('live-a', keep.id, { topic: 'a' }, null, `&guest=${encodeURIComponent(keepLink)}`), 403, 'that guest pass is not valid; enter again', 'a guest without a pass: 403');
  await refusal(await send('live-a', keep.id, { topic: 'a' }, null, `&guest=${encodeURIComponent(keepLink)}&pass=anything`), 403, 'that guest pass is not valid; enter again', 'a guest with a pass that is not one: 403');
  await refusal(await send('live-a', keep.id, { topic: 'a' }, null, `&guest=${encodeURIComponent(towerLink)}`), 403, 'this module is not available in that space for you', 'another space\'s guest: 403');
  await refusal(await send('live-a', keep.id, { topic: 'Bad Topic' }, samC), 400, 'the topic must be 1 to 40 of a-z, 0-9, dot, underscore and dash', 'a bad topic: 400');
  await refusal(await send('live-a', keep.id, { topic: 'a', to: [] }, samC), 400, 'to must list 1 to 20 people', 'to empty: 400');
  await refusal(await send('live-a', keep.id, { topic: 'a', to: ['NOT A KEY'] }, samC), 400, 'to must list people by their keys', 'a bad key in to: 400');
  const fits = { s: 'x'.repeat(256 - 8) }; // {"s":"..."} is 8 bytes around the text
  same(Buffer.byteLength(JSON.stringify(fits)), 256, '(256 bytes of data)');
  same((await send('live-a', keep.id, { topic: 'big', data: fits }, samC)).status, 200, 'data of 256 bytes is taken');
  await refusal(await send('live-a', keep.id, { topic: 'big', data: { s: 'x'.repeat(256 - 7) } }, samC), 413, 'a live message\'s data can be at most 256 bytes', 'data of 257 bytes: 413');
  await refusal(await send('live-a', keep.id, { topic: 'big', data: { s: 'é'.repeat(130) } }, samC), 413, 'a live message\'s data can be at most 256 bytes', 'counted in bytes, not characters: 413');
  // Rates: Ivy sends 40 at once in one module; about 20 are taken, the rest 429 with Retry-After.
  const burst = await Promise.all(Array.from({ length: 40 }, (_, i) => send('live-a', keep.id, { topic: `burst.${i}` }, ivyC)));
  const taken = burst.filter((r) => r.status === 200).length;
  const slowed = burst.filter((r) => r.status === 429);
  ok(taken >= 20 && taken <= 24, `about MODULE_LIVE_PER_SECOND (20) taken at once (${taken})`);
  ok(slowed.length && slowed.every((r) => r.json.error === 'too many live messages; wait a moment' && Number(r.retryAfter) >= 1), 'the rest: 429, in a plain sentence, with Retry-After');
  await quiet(1100);
  same((await send('live-a', keep.id, { topic: 'after' }, ivyC)).status, 200, 'a second later Ivy may send again');

  // --- 6. joined and left ----------------------------------------------------------------------------------------------
  const [patId1, patId2, samId] = [ids[0], ids[1], ids[2]];
  const join = (moduleId, stream, cookie, space = keep.id) => call('POST', `/api/modules/${moduleId}/live/join?space=${space}`, { cookie, body: { stream } });
  const leave = (moduleId, stream, cookie, space = keep.id) => call('POST', `/api/modules/${moduleId}/live/leave?space=${space}`, { cookie, body: { stream } });
  const sj = await join('live-a', samId, samC);
  same(sj.json, { ok: true, people: [{ key: sam.key, name: 'Sam', guest: false }], limits: { bytes: 256, perSecond: 20, to: 20 } }, 'Sam joins: answered with who is there, and the limits a page keeps to');
  const pj = await join('live-a', patId1, patC);
  same(pj.json.people.map((p) => p.key).sort(), [pat.key, sam.key].sort(), 'Pat joins: both there');
  const joinedEv = await samS.until((e) => e.event === 'joined');
  same([joinedEv.data.module, joinedEv.data.spaceId, joinedEv.data.person], ['live-a', keep.id, { key: pat.key, name: 'Pat', guest: false }], 'Sam is told Pat joined');
  same(joinedEv.data.people.length, 2, 'with everyone there');
  await guestS.until((e) => e.event === 'joined' && e.data.person.key === pat.key);
  same((await join('live-a', patId2, patC)).status, 200, 'Pat\'s second tab joins');
  await quiet(300);
  same(samS.events.filter((e) => e.event === 'joined').length, 1, 'a second tab of Pat\'s tells nobody');
  same(pat1.events.filter((e) => e.event === 'joined' && e.data.person.key === pat.key).length, 0, 'nor Pat\'s own tabs');
  await refusal(await join('live-a', samId, patC), 409, 'open the space first; there is no module stream of yours there', 'Sam\'s stream is not Pat\'s: 409');
  await refusal(await join('live-a', ids[7], louC, keep.id), 404, 'no such space', 'Lou can\'t join the Keep with his stream there: 404');
  await refusal(await join('live-a', ids[6], louC, keep.id), 404, 'no such space', 'nor with his Tower stream');
  same((await join('live-a', ids[6], louC, tower.id)).status, 200, 'Lou joins in the Tower');
  await refusal(await join('live-a', ids[6], patC, keep.id), 409, 'open the space first; there is no module stream of yours there', 'Lou\'s stream is not Pat\'s, and not in the Keep: 409');
  await refusal(await join('live-a', patId1, patC, tower.id), 404, 'no such space', 'Pat can\'t join the Tower');
  await refusal(await join('live-a', 'nosuch', patC), 409, 'open the space first; there is no module stream of yours there', 'an unknown stream: 409');
  await refusal(await join('live-a', 42, patC), 400, 'stream must be the id the module stream gave', 'a stream that is not text: 400');
  await refusal(await join('live-off', patId1, patC), 400, 'this module doesn\'t use live messages', 'a module without live: 400');
  await refusal(await join('live-a', 'x', null), 401, 'sign in first', 'signed out: 401');
  await quiet(300);
  ok(!samS.events.some((e) => e.event === 'joined' && e.data.person.key === lou.key), 'Lou joining in the Tower tells nobody in the Keep');
  await refusal(await call('POST', `/api/modules/live-a/live/join?space=${keep.id}&guest=${encodeURIComponent(keepLink)}`, { body: { stream: ids[5] } }), 403, 'that guest pass is not valid; enter again', 'a guest without a pass can\'t join: 403');

  // A closed tab with another still joined: nothing. The last closed: `left` after the grace; a reconnect within it: neither.
  pat1.close();
  await quiet(500);
  pat2.close();
  const closedAt = Date.now();
  await quiet(1500);
  const pat3 = await openStream(MS(keep.id), { cookie: patC });
  const patId3 = await ready(pat3);
  same((await join('live-a', patId3, patC)).json.people.map((p) => p.key).sort(), [pat.key, sam.key].sort(), 'Pat reconnects within the grace and joins again');
  await quiet(Math.max(0, closedAt + 11500 - Date.now()));
  same(samS.events.filter((e) => e.event === 'left' || (e.event === 'joined' && e.data.person.key === pat.key)).length, 1, 'a reconnect within the grace: neither left nor joined (only the first joined)');
  pat3.close();
  const closed3 = Date.now();
  const leftEv = await samS.until((e) => e.event === 'left', 14000);
  const waited = Date.now() - closed3;
  ok(waited >= 9500 && waited <= 13000, `the last stream closed: left after the grace of 10 seconds (${waited} ms)`);
  same([leftEv.data.person.key, leftEv.data.people.map((p) => p.key)], [pat.key, [sam.key]], 'Pat left; Sam is still there');
  // A leave is at once.
  const pat4 = await openStream(MS(keep.id), { cookie: patC });
  const patId4 = await ready(pat4);
  await join('live-a', patId4, patC);
  await samS.until((e) => e.event === 'joined' && e.data.person.key === pat.key && e !== joinedEv);
  const leftBefore = samS.events.filter((e) => e.event === 'left').length;
  same((await leave('live-a', patId4, patC)).json, { ok: true }, 'Pat leaves');
  await samS.until((e) => e.event === 'left' && samS.events.filter((x) => x.event === 'left').length > leftBefore, 800);
  same((await leave('live-a', patId4, patC)).json, { ok: true }, 'leaving twice is fine');
  await refusal(await leave('live-a', samId, patC), 409, 'open the space first; there is no module stream of yours there', 'leaving with someone else\'s stream: 409');
  await join('live-a', patId4, patC);

  // --- 7. nothing written: every message, refusal, join and leave above left DATA_DIR as it was -------------------------
  same(snapshot(dataDir), before, 'sending, receiving, refusals, rates, joining and leaving wrote nothing to DATA_DIR');

  // --- guests by their pass (step 3) -----------------------------------------------------------------------------------
  // Two guests on the Keep's one link, each known by the id on their own pass (POST /api/guest-join); a guest stream
  // with no pass still only receives. Gia and Gus in the Keep, Tod on the Tower's link.
  const guestIn = async (link, name) => (await call('POST', '/api/guest-join', { body: { token: link, name } })).json.guest;
  const gia = await guestIn(keepLink, 'Gia');
  const gus = await guestIn(keepLink, 'Gus');
  const tod = await guestIn(towerLink, 'Tod');
  ok(gia.id !== gus.id && /^guest-/.test(gia.id) && /^guest-/.test(gus.id), 'two guests on one link: two ids');
  const gq = (link, pass) => `&guest=${encodeURIComponent(link)}&pass=${encodeURIComponent(pass)}`;
  const giaS = await openStream(MS(keep.id, gq(keepLink, gia.pass)));
  const gusS = await openStream(MS(keep.id, gq(keepLink, gus.pass)));
  const [giaId, gusId] = [await ready(giaS), await ready(gusS)];
  same((await send('live-a', keep.id, { topic: 'g.point', data: { x: 5 } }, null, gq(keepLink, gia.pass))).json, { ok: true }, 'a guest with their pass sends');
  const gm = await samS.until((e) => e.event === 'live' && e.data.topic === 'g.point');
  same(gm.data.from, { key: gia.id, name: 'Gia', guest: true }, 'from the guest as their pass names them');
  await gusS.until((e) => e.event === 'live' && e.data.topic === 'g.point');
  await guestS.until((e) => e.event === 'live' && e.data.topic === 'g.point');
  await quiet(300);
  same(giaS.lives().filter((e) => e.data.topic === 'g.point').length, 0, 'the other guest and a guest with no pass receive it; never the guest who sent it');
  for (const [st, who] of [[towerG, 'the Tower\'s guest'], [crossG, 'the Keep\'s stream on the Tower\'s link']]) same(st.lives().filter((e) => e.data.topic === 'g.point').length, 0, `nor ${who}`);
  same((await send('live-a', keep.id, { topic: 'g.nudge', data: {}, to: [gus.id] }, samC)).status, 200, 'Sam sends to Gus by his id');
  await gusS.until((e) => e.event === 'live' && e.data.topic === 'g.nudge');
  same((await send('live-a', keep.id, { topic: 'g.back', data: {}, to: [sam.key] }, null, gq(keepLink, gus.pass))).status, 200, 'Gus answers Sam alone');
  await samS.until((e) => e.event === 'live' && e.data.topic === 'g.back');
  await quiet(300);
  ok(![giaS, guestS, pat4, ownS].some((st) => st.lives().some((e) => e.data.topic === 'g.nudge' || e.data.topic === 'g.back')), '`to` a guest reaches that guest only, and a guest\'s `to` the person named only');
  // Joining and leaving as themselves.
  const gjoin = await call('POST', `/api/modules/live-a/live/join?space=${keep.id}${gq(keepLink, gia.pass)}`, { body: { stream: giaId } });
  same(gjoin.status, 200, 'Gia joins with her stream');
  ok(gjoin.json.people.some((p) => p.key === gia.id && p.name === 'Gia' && p.guest === true), 'and is listed by the name on her pass');
  const gjEv = await samS.until((e) => e.event === 'joined' && e.data.person.key === gia.id);
  same(gjEv.data.person, { key: gia.id, name: 'Gia', guest: true }, 'Sam is told Gia joined');
  ok(gjEv.data.people.some((p) => p.key === gia.id && p.guest === true), 'and she is in the list');
  await refusal(await call('POST', `/api/modules/live-a/live/join?space=${keep.id}${gq(keepLink, gus.pass)}`, { body: { stream: giaId } }), 409, 'open the space first; there is no module stream of yours there', 'Gus can\'t join with Gia\'s stream: 409');
  const noPassS = await openStream(MS(keep.id, gq(keepLink, 'not-a-pass')));
  same(noPassS.status, 200, 'a guest stream with a pass that is not one still opens (it receives)');
  const noPassId = await ready(noPassS);
  await refusal(await call('POST', `/api/modules/live-a/live/join?space=${keep.id}${gq(keepLink, gia.pass)}`, { body: { stream: noPassId } }), 409, 'open the space first; there is no module stream of yours there', 'but nobody can join with it, not even with a good pass');
  same((await send('live-a', keep.id, { topic: 'g.all', data: {} }, samC)).status, 200);
  await noPassS.until((e) => e.event === 'live' && e.data.topic === 'g.all');
  // A module guests may not read (live-m: `point`, which the guest role lacks): nothing of it reaches a guest, pass or not.
  same((await send('live-m', keep.id, { topic: 'g.mod', data: { secret: 1 } }, owner)).status, 200, 'the owner sends on live-m');
  same((await send('live-a', keep.id, { topic: 'g.after', data: {} }, owner)).status, 200, 'then on live-a');
  for (const st of [giaS, gusS, noPassS, guestS]) await st.until((e) => e.event === 'live' && e.data.topic === 'g.after');
  ok([giaS, gusS, noPassS, guestS].every((st) => !st.events.some((e) => e.data && e.data.module === 'live-m')), 'a guest with a valid pass (or none) gets no live event of a module guests may not read');
  // Refusals: another link's pass, another space, a forged pass, the publish permission.
  await refusal(await send('live-a', keep.id, { topic: 'a' }, null, gq(keepLink, tod.pass)), 403, 'that guest pass is not valid; enter again', 'the Tower guest\'s pass on the Keep\'s link: 403');
  await refusal(await send('live-a', keep.id, { topic: 'a' }, null, gq(towerLink, gia.pass)), 403, 'this module is not available in that space for you', 'Gia\'s pass on the Tower\'s link, to the Keep: 403');
  await refusal(await send('live-a', tower.id, { topic: 'a' }, null, gq(towerLink, gia.pass)), 403, 'that guest pass is not valid; enter again', 'Gia\'s pass on the Tower\'s link, to the Tower: 403');
  await refusal(await send('live-a', tower.id, { topic: 'a' }, null, gq(keepLink, gia.pass)), 403, 'this module is not available in that space for you', 'Gia in the Tower: 403');
  const [, sig] = gia.pass.split('.');
  const forged = `${Buffer.from(JSON.stringify({ id: gus.id, name: 'Gus' })).toString('base64url')}.${sig}`;
  await refusal(await send('live-a', keep.id, { topic: 'a' }, null, gq(keepLink, forged)), 403, 'that guest pass is not valid; enter again', 'Gus\'s id on Gia\'s signature: 403');
  const asMember = `${Buffer.from(JSON.stringify({ id: sam.key, name: 'Sam' })).toString('base64url')}.${sig}`;
  await refusal(await send('live-a', keep.id, { topic: 'a' }, null, gq(keepLink, asMember)), 403, 'that guest pass is not valid; enter again', 'a member\'s key on a guest\'s signature: 403');
  await refusal(await send('live-p', keep.id, { topic: 'a' }, null, gq(keepLink, gia.pass)), 403, 'your role can\'t send live messages in this module', 'the guest role without live-p\'s publish permission: 403');
  await refusal(await send('live-m', keep.id, { topic: 'a' }, null, gq(keepLink, gia.pass)), 403, 'your role can\'t do that in this module', 'a module guests may not read: 403');
  // Gia leaves: at once.
  same((await call('POST', `/api/modules/live-a/live/leave?space=${keep.id}${gq(keepLink, gia.pass)}`, { body: { stream: giaId } })).json, { ok: true }, 'Gia leaves');
  const glEv = await samS.until((e) => e.event === 'left' && e.data.person.key === gia.id, 800);
  same(glEv.data.person, { key: gia.id, name: 'Gia', guest: true }, 'Sam is told Gia left');
  // Gus joins; the link turned off (below) ends his access: the others are told he left, by the name on his pass.
  same((await call('POST', `/api/modules/live-a/live/join?space=${keep.id}${gq(keepLink, gus.pass)}`, { body: { stream: gusId } })).status, 200, 'Gus joins');
  await samS.until((e) => e.event === 'joined' && e.data.person.key === gus.id);

  // --- 4. access lost stops delivery at once -------------------------------------------------------------------------
  // Sam taken out of the Keep: no more messages, `removed` on his live stream, `left` to the others, his send refused.
  const samLive = await openStream(`/api/live?space=${keep.id}`, { cookie: samC });
  await samLive.until((e) => e.data.type === 'ready');
  const samBefore = samS.lives().length;
  const leftCount = pat4.events.filter((e) => e.event === 'left').length;
  const took = Date.now();
  same((await call('DELETE', `/api/spaces/${keep.id}/members/${sam.key}`, { cookie: owner })).status, 200, 'Sam is taken out of the Keep');
  same((await send('live-a', keep.id, { topic: 'after.remove' }, patC)).status, 200, 'Pat sends at once');
  const removed = await samLive.until((e) => e.data.type === 'removed', 1000);
  ok(Date.now() - took < 1000, `GET /api/live says removed at once (${Date.now() - took} ms, the recheck is 2000)`);
  same(removed.data.reason, 'access', 'for access');
  await pat4.until((e) => e.event === 'left' && pat4.events.filter((x) => x.event === 'left').length > leftCount, 1000);
  await ivyS.until((e) => e.event === 'live' && e.data.topic === 'after.remove');
  await quiet(400);
  same(samS.lives().length, samBefore, 'Sam\'s module stream gets nothing more, at once');
  await refusal(await send('live-a', keep.id, { topic: 'a' }, samC), 404, 'no such space', 'and his next send is refused');

  // A role that loses the module's read: Pat and Ivy (members) stop receiving at once; the owner still does.
  same((await call('PATCH', '/api/roles/member', { cookie: owner, body: { 'module.live-a.view': false } })).status, 200, 'members lose live-a\'s read');
  same((await send('live-a', keep.id, { topic: 'after.role' }, owner)).status, 200, 'the owner sends at once');
  await guestS.until((e) => e.event === 'live' && e.data.topic === 'after.role');
  await quiet(400);
  ok(!pat4.lives().some((e) => e.data.topic === 'after.role') && !ivyS.lives().some((e) => e.data.topic === 'after.role'), 'members without read get nothing, at once');
  await refusal(await send('live-a', keep.id, { topic: 'a' }, patC), 403, 'your role can\'t do that in this module', 'and their send is refused');
  await refusal(await join('live-a', patId4, patC), 403, 'your role can\'t do that in this module', 'and their join');
  await call('PATCH', '/api/roles/member', { cookie: owner, body: { 'module.live-a.view': true } });
  same((await send('live-a', keep.id, { topic: 'role.back' }, owner)).status, 200);
  await pat4.until((e) => e.event === 'live' && e.data.topic === 'role.back', 1000);
  ok(true, 'given back, at once');

  // The moderator tick: Pat may send in live-p as a moderator, and not once it is taken away.
  await call('PATCH', `/api/users/${pat.key}/spaces/${keep.id}`, { cookie: owner, body: { permissions: { moderator: true } } });
  same((await send('live-p', keep.id, { topic: 'mod' }, patC)).status, 200, 'a moderator of the Keep may send in live-p');
  await call('PATCH', `/api/users/${pat.key}/spaces/${keep.id}`, { cookie: owner, body: { permissions: { moderator: false } } });
  await refusal(await send('live-p', keep.id, { topic: 'mod' }, patC), 403, 'your role can\'t send live messages in this module', 'the tick taken away: refused');

  // Read only by moderators (live-m): Pat ticked hears it; the tick taken away, the very next message does not reach him.
  await call('PATCH', `/api/users/${pat.key}/spaces/${keep.id}`, { cookie: owner, body: { permissions: { moderator: true } } });
  same((await send('live-m', keep.id, { topic: 'mod.read' }, owner)).status, 200, 'the owner sends in live-m, read by moderators');
  await pat4.until((e) => e.event === 'live' && e.data.topic === 'mod.read', 1000);
  await call('PATCH', `/api/users/${pat.key}/spaces/${keep.id}`, { cookie: owner, body: { permissions: { moderator: false } } });
  same((await send('live-m', keep.id, { topic: 'mod.gone' }, owner)).status, 200, 'and again, at once after the tick is taken away');
  await quiet(400);
  ok(!pat4.lives().some((e) => e.data.topic === 'mod.gone'), 'Pat, no longer a moderator, gets nothing at once (well under the 2-second recheck)');

  // Ends in well under the recheck: `act` done, the stream's end comes within `ms` of starting it.
  const endsAtOnce = async (s, act, ms = 300) => {
    const t = Date.now();
    await act();
    const ended = await within(s.ended, 1500);
    return ended === true ? Date.now() - t : Infinity;
  };
  const kim = await mk('kim', 'Kim');
  const max = await mk('max', 'Max');
  const oz = (await call('POST', '/api/users', { cookie: owner, body: { login: 'oz', displayName: 'Oz', role: 'owner', password: 'ownerpass1234' } })).json.user;
  const kimC = await login('kim', 'memberpass1234');
  const maxC = await login('max', 'memberpass1234');
  const ozC = await login('oz', 'ownerpass1234');
  await call('PATCH', `/api/spaces/${keep.id}`, { cookie: owner, body: { members: [pat.key, ivy.key, kim.key, max.key] } });
  const kimS = await openStream(MS(keep.id), { cookie: kimC });
  const maxS = await openStream(MS(keep.id), { cookie: maxC });
  const ozS = await openStream(MS(keep.id), { cookie: ozC });
  await Promise.all([kimS, maxS, ozS].map(ready));

  // A new password signs Kim out everywhere: her module stream ends at once.
  const kimMs = await endsAtOnce(kimS, async () => same((await call('PATCH', `/api/users/${kim.key}`, { cookie: owner, body: { password: 'newpass12345' } })).status, 200, 'Kim\'s password is changed'));
  ok(kimMs < 300, `her module stream ends at once (${kimMs} ms; the recheck is 2000)`);

  // Oz, an owner who is not a member of the Keep, reads it by owner rights; made a member, the very next message is not his.
  same((await send('live-a', keep.id, { topic: 'oz.before' }, patC)).status, 200);
  await ozS.until((e) => e.event === 'live' && e.data.topic === 'oz.before', 1000);
  same((await call('PATCH', `/api/users/${oz.key}`, { cookie: owner, body: { role: 'member' } })).status, 200, 'Oz is made a member');
  same((await send('live-a', keep.id, { topic: 'oz.after' }, patC)).status, 200, 'Pat sends at once');
  await quiet(400);
  ok(!ozS.lives().some((e) => e.data.topic === 'oz.after'), 'Oz, no longer an owner and not in the Keep, gets nothing at once');

  // Nothing tells the streams when Max turns on his own two-step sign-in (his other pages' sessions end with the old
  // stamp, and his own are left to the recheck so they never race his new cookie): the 2-second recheck ends his stream.
  const secret = (await call('POST', '/api/me/mfa/start', { cookie: maxC, body: {} })).json.secret;
  const maxT = Date.now();
  same((await call('POST', '/api/me/mfa/enable', { cookie: maxC, body: { code: totpCode(secret) } })).status, 200, 'Max turns on his two-step sign-in');
  const maxEnded = await within(maxS.ended, 3000);
  const maxMs = Date.now() - maxT;
  ok(maxEnded === true && maxMs < 2600, `his old session's module stream ends by the periodic recheck alone (${maxMs} ms, within about 2.5 s)`);

  // Ivy deleted: her module stream ends at once.
  const ivyMs = await endsAtOnce(ivyS, async () => same((await call('DELETE', `/api/users/${ivy.key}`, { cookie: owner })).status, 200, 'Ivy is deleted'));
  ok(ivyMs < 300, `her module stream ends at once (${ivyMs} ms)`);
  await refusal(await send('live-a', keep.id, { topic: 'a' }, ivyC), 401, 'sign in first', 'and her send is refused');

  // The guest link turned off: the guest's module stream ends at once.
  const guestMs = await endsAtOnce(guestS, async () => same((await call('DELETE', `/api/spaces/${keep.id}/guest-link`, { cookie: owner })).status, 200, 'the Keep\'s guest link is turned off'));
  ok(guestMs < 300, `the guest's module stream ends at once (${guestMs} ms)`);
  ok((await within(giaS.ended, 500)) === true && (await within(gusS.ended, 500)) === true, 'and the streams of the guests with passes too');
  await refusal(await send('live-a', keep.id, { topic: 'a' }, null, gq(keepLink, gia.pass)), 401, 'sign in first', 'and a guest\'s send with the old link and pass is refused');
  const gusLeft = await pat4.until((e) => e.event === 'left' && e.data.person.key === gus.id, 1000);
  same(gusLeft.data.person, { key: gus.id, name: 'Gus', guest: true }, 'Gus lost access with the link: the others are told at once that he left, by the name on his pass');

  // A module rolled back to a version without `live`, and a module removed: their messages are refused at once.
  same((await call('POST', '/api/modules', { cookie: owner, raw: ROLL[0], type: 'application/zip' })).status, 201, 'live-r 1.0.0 (no live) installs');
  same((await call('PATCH', '/api/modules/live-r', { cookie: owner, body: { enabled: true } })).status, 200);
  const up = await call('POST', '/api/modules', { cookie: owner, raw: ROLL[1], type: 'application/zip' });
  ok(up.status === 201 || up.status === 200, `live-r 1.1.0 (live) installs over it: ${up.text.slice(0, 200)}`);
  same((await send('live-r', keep.id, { topic: 'r' }, patC)).status, 200, '1.1.0 has live messages');
  same((await join('live-r', patId4, patC)).json.people.map((p) => p.key), [pat.key], 'Pat joins live-r');
  same((await call('POST', '/api/modules/live-r/rollback', { cookie: owner, body: { version: '1.0.0' } })).status, 200, 'rolled back to 1.0.0');
  await refusal(await send('live-r', keep.id, { topic: 'r' }, patC), 400, 'this module doesn\'t use live messages', 'rolled back: its send is 400');
  same((await call('DELETE', '/api/modules/live-r?keepData=0', { cookie: owner })).status, 200, 'live-r is removed');
  await refusal(await send('live-r', keep.id, { topic: 'r' }, patC), 404, 'no such module', 'removed: 404');

  // The module turned off: nothing more, and the send is 404.
  same((await call('PATCH', '/api/modules/live-p', { cookie: owner, body: { enabled: false } })).status, 200, 'live-p is turned off');
  await refusal(await send('live-p', keep.id, { topic: 'a' }, owner), 404, 'no such module', 'its send: 404');
  await call('PATCH', '/api/modules/live-p', { cookie: owner, body: { enabled: true } });

  // --- flood and abuse -------------------------------------------------------------------------------------------------
  const flooder = await mk('fay', 'Fay');
  const fayC = await login('fay', 'memberpass1234');
  await call('PATCH', `/api/spaces/${keep.id}`, { cookie: owner, body: { members: [pat.key, flooder.key] } });
  await quiet(5500);
  const beforeFlood = snapshot(dataDir);
  let floodTaken = 0;
  for (let round = 0; round < 3; round += 1) {
    const r = await Promise.all(Array.from({ length: 100 }, (_, i) => send('live-a', keep.id, { topic: `t${round}.${i}`, data: { i } }, fayC)));
    floodTaken += r.filter((x) => x.status === 200).length;
    ok(r.every((x) => x.status === 200 || x.status === 429), 'a flood of 100 topics at once: taken or 429, nothing else');
  }
  ok(floodTaken <= 3 * 25, `the rate held under the flood (${floodTaken} of 300 taken)`);
  const huge = await call('POST', `/api/modules/live-a/live?space=${keep.id}`, { cookie: fayC, raw: JSON.stringify({ topic: 'a', data: 'x'.repeat(2 * 1024 * 1024) }) });
  same(huge.status, 413, 'a body of 2 MB: 413');
  const near = await call('POST', `/api/modules/live-a/live?space=${keep.id}`, { cookie: fayC, raw: JSON.stringify({ topic: 'a', data: 'x'.repeat(60000) }) });
  await refusal(near, 413, 'a live message\'s data can be at most 256 bytes', 'data of 60 KB: 413');
  await refusal(await call('POST', `/api/modules/live-a/live?space=${keep.id}`, { cookie: fayC, raw: '{"topic":"a","data":' }), 400, 'bad JSON', 'malformed JSON: 400');
  await refusal(await call('POST', `/api/modules/live-a/live?space=${keep.id}`, { cookie: fayC, raw: '["topic"]' }), 400, 'send the message as JSON: { topic, data, to? }', 'a list: 400');
  const deep = await call('POST', `/api/modules/live-a/live?space=${keep.id}`, { cookie: fayC, raw: `{"topic":"a","data":${'['.repeat(30000)}${']'.repeat(30000)}}` });
  ok([400, 413].includes(deep.status) && typeof deep.json?.error === 'string', `deeply nested data: refused (${deep.status} ${deep.json?.error})`);
  await refusal(await call('POST', `/api/modules/live-a/live?space=${keep.id}`, { cookie: fayC, raw: '{"topic":"a","__proto__":{"isAdmin":true}}' }), 400, 'send only topic, data and to', 'a __proto__ field: 400');
  await refusal(await call('POST', `/api/modules/live-a/live?space=${keep.id}`, { cookie: fayC, raw: '{"topic":"a","constructor":{"prototype":{"x":1}}}' }), 400, 'send only topic, data and to', 'a constructor field: 400');
  await quiet(1100);
  same((await call('POST', `/api/modules/live-a/live?space=${keep.id}`, { cookie: fayC, raw: '{"topic":"__proto__","data":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}}' })).status, 200, 'a __proto__ topic and pollution keys in data: taken as plain data');
  const polluted = await pat4.until((e) => e.event === 'live' && e.data.topic === '__proto__');
  same(JSON.stringify(polluted.data.data), '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}', 'and delivered as it was');
  const me = await call('GET', '/api/me', { cookie: patC });
  ok(me.status === 200 && me.json.polluted === undefined && me.json.user.polluted === undefined && me.json.isAdmin === undefined, 'the server answers, unpolluted');
  // Many streams: 30 of Pat's in the Keep each get a message once.
  const many = await Promise.all(Array.from({ length: 30 }, () => openStream(MS(keep.id), { cookie: patC })));
  await Promise.all(many.map(ready));
  same((await send('live-a', keep.id, { topic: 'many' }, fayC)).status, 200);
  await Promise.all(many.map((s) => s.until((e) => e.event === 'live' && e.data.topic === 'many')));
  ok(many.every((s) => s.lives().filter((e) => e.data.topic === 'many').length === 1), '30 streams each get it once');
  for (const s of many) s.close();
  same((await join('live-a', 'z'.repeat(5000), fayC)).status, 400, 'an overlong stream id: 400');
  const joins = await Promise.all(Array.from({ length: 60 }, () => join('live-a', 'nosuch', fayC)));
  ok(joins.every((r) => r.status === 409 || r.status === 429), 'a flood of joins: 409 or 429');

  same(snapshot(dataDir), beforeFlood, 'the flood wrote nothing to DATA_DIR either');
  same(lkAsked.length, asked0, 'no call service was set, and nothing was asked of one');
  ok(!/A live stream's listener failed|server error/i.test(out), `the server logged no failure:\n${out.slice(-2000)}`);
  for (const s of open) s.close();
  await stopServer();

  // === 2. dummy keys and a counting stand-in: nothing asks it; the limits read from the environment ====================
  open.length = 0;
  await startServer({
    LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', LIVEKIT_API_URL: `http://127.0.0.1:${lk.address().port}`,
    MODULE_LIVE_BYTES: '64', MODULE_LIVE_PER_SECOND: '3', MODULE_LIVE_PER_PERSON: '5', MODULE_LIVE_TO: '2', MODULE_LIVE_PER_GUEST_LINK: '4',
    LIVE_STREAMS_PER_PERSON: '4', LIVE_STREAMS_PER_GUEST_LINK: '5',
  });
  {
    const own = await login('admin', 'testpass1234');
    await installModules(own);
    const a = (await call('POST', '/api/users', { cookie: own, body: { login: 'ann', displayName: 'Ann', role: 'member', password: 'memberpass1234' } })).json.user;
    const b = (await call('POST', '/api/users', { cookie: own, body: { login: 'ben', displayName: 'Ben', role: 'member', password: 'memberpass1234' } })).json.user;
    const aC = await login('ann', 'memberpass1234');
    const bC = await login('ben', 'memberpass1234');
    const sp = (await call('POST', '/api/spaces', { cookie: own, body: { name: 'Hall', members: [a.key, b.key] } })).json.space;
    await call('PATCH', `/api/spaces/${sp.id}`, { cookie: own, body: { members: [a.key, b.key] } });
    await quiet(500);
    const from = lkAsked.length;
    const aS = await openStream(MS(sp.id), { cookie: aC });
    const bS = await openStream(MS(sp.id), { cookie: bC });
    const [aId, bId] = [await ready(aS), await ready(bS)];
    same((await call('POST', `/api/modules/live-a/live/join?space=${sp.id}`, { cookie: aC, body: { stream: aId } })).status, 200, 'Ann joins');
    same((await call('POST', `/api/modules/live-a/live/join?space=${sp.id}`, { cookie: bC, body: { stream: bId } })).status, 200, 'Ben joins');
    await aS.until((e) => e.event === 'joined');
    same((await send('live-a', sp.id, { topic: 'pointer', data: { x: 1 } }, aC)).status, 200, 'Ann sends');
    await bS.until((e) => e.event === 'live');
    same((await call('POST', `/api/modules/live-a/live/leave?space=${sp.id}`, { cookie: bC, body: { stream: bId } })).status, 200, 'Ben leaves');
    await aS.until((e) => e.event === 'left');
    await quiet(300);
    same(lkAsked.slice(from), [], 'with keys set and a call service standing in, sending, joining, receiving and leaving asked it nothing');
    await quiet(1100);
    same((await send('live-a', sp.id, { topic: 'a', data: 'x'.repeat(62) }, aC)).status, 200, 'MODULE_LIVE_BYTES=64: 64 bytes taken');
    same((await send('live-a', sp.id, { topic: 'a', data: 'x'.repeat(63) }, aC)).json, { error: 'a live message\'s data can be at most 64 bytes' }, 'and 65 refused');
    await refusal(await send('live-a', sp.id, { topic: 'a', to: [b.key, a.key, 'abcdef'] }, aC), 400, 'to must list 1 to 2 people', 'MODULE_LIVE_TO=2');
    await quiet(1100);
    const r1 = await Promise.all(Array.from({ length: 6 }, () => send('live-a', sp.id, { topic: 'r' }, aC)));
    same(r1.filter((r) => r.status === 200).length, 3, 'MODULE_LIVE_PER_SECOND=3: three at once in one module');
    await quiet(1100);
    const r2 = await Promise.all([...Array.from({ length: 3 }, () => send('live-a', sp.id, { topic: 'r' }, aC)), ...Array.from({ length: 3 }, () => send('live-p', sp.id, { topic: 'r' }, own))]);
    same(r2.filter((r) => r.status === 200).length, 6, 'two people are counted apart');
    await quiet(1100);
    const r3 = await Promise.all([...Array.from({ length: 3 }, () => send('live-a', sp.id, { topic: 'r' }, own)), ...Array.from({ length: 3 }, () => send('live-p', sp.id, { topic: 'r' }, own))]);
    same(r3.filter((r) => r.status === 200).length, 5, 'MODULE_LIVE_PER_PERSON=5: five at once across modules');
    same(lkAsked.slice(from), [], 'still nothing asked of the call service');
    // MODULE_LIVE_PER_GUEST_LINK=4: three guests on one link, three each at once (each under their own 3): four in all.
    const hallLink = (await call('POST', `/api/spaces/${sp.id}/guest-link`, { cookie: own, body: {} })).json.space.guestToken;
    const passes = [];
    for (const name of ['Gil', 'Gwen', 'Gord']) passes.push((await call('POST', '/api/guest-join', { body: { token: hallLink, name } })).json.guest.pass);
    await quiet(1100);
    const rg = await Promise.all(passes.flatMap((pass) => Array.from({ length: 3 }, () => send('live-a', sp.id, { topic: 'g' }, null, `&guest=${encodeURIComponent(hallLink)}&pass=${encodeURIComponent(pass)}`))));
    same(rg.filter((r) => r.status === 200).length, 4, 'MODULE_LIVE_PER_GUEST_LINK=4: four at once for everyone on one guest link');
    ok(rg.filter((r) => r.status === 429).every((r) => Number(r.retryAfter) >= 1), 'the rest 429 with Retry-After');

    // Open module streams with a space are counted as GET /api/live's are (LIVE_STREAMS_PER_PERSON=4 here), apart from them.
    const more = [];
    for (let i = 0; i < 3; i += 1) more.push(await openStream(MS(sp.id), { cookie: aC }));
    ok(more.every((s) => s.status === 200), 'Ann holds four module streams with a space');
    const fifth = await openStream(MS(sp.id), { cookie: aC });
    same([fifth.status, fifth.error], [429, 'you have too many module streams open (4 at most); close one and try again'], 'a fifth: 429, in the live stream\'s sentence');
    const otherSpace = (await call('POST', '/api/spaces', { cookie: own, body: { name: 'Yard', members: [a.key] } })).json.space;
    await call('PATCH', `/api/spaces/${otherSpace.id}`, { cookie: own, body: { members: [a.key] } });
    same((await openStream(MS(otherSpace.id), { cookie: aC })).status, 429, 'counted per person, in any space');
    same((await openStream(MS(sp.id), { cookie: bC })).status, 200, 'Ben is counted apart: per person, not for everyone');
    same((await openStream(`/api/live?space=${sp.id}`, { cookie: aC })).status, 200, 'Ann\'s live stream is counted apart from her module streams');
    same((await openStream('/api/modules/stream', { cookie: aC })).status, 200, 'a module stream with no space (no live messages) is not counted');
    more[0].close();
    await quiet(300);
    const again = await openStream(MS(sp.id), { cookie: aC });
    same(again.status, 200, 'a closed stream gives its place back');
    // A guest link: one address gets its share of LIVE_STREAMS_PER_GUEST_LINK (5: two here), as on the live stream.
    const link = (await call('POST', `/api/spaces/${sp.id}/guest-link`, { cookie: own, body: {} })).json.space.guestToken;
    const g = `&guest=${encodeURIComponent(link)}`;
    const gs = [await openStream(MS(sp.id, g)), await openStream(MS(sp.id, g))];
    ok(gs.every((s) => s.status === 200), 'two guest streams from one address');
    const g3 = await openStream(MS(sp.id, g));
    same([g3.status, g3.error], [429, 'you have too many module streams open (2 at most); close one and try again'], 'a third from that address: 429');
    gs[0].close();
    await quiet(300);
    same((await openStream(MS(sp.id, g))).status, 200, 'one closed, one more opens');
    for (const s of open) s.close();
  }
  await stopServer();

  // === 3. two environments: nothing crosses ===========================================================================
  open.length = 0;
  const BASE = 'live.test';
  await startServer({ BASE_DOMAIN: BASE, ADMIN_LOGIN: 'host', ADMIN_PASSWORD: 'hostpass1234' });
  {
    const consoleHost = `admin.${BASE}:${port}`;
    hostHeader = consoleHost;
    const hostIn = await new Promise((resolve, reject) => {
      const payload = Buffer.from(JSON.stringify({ login: 'host', password: 'hostpass1234' }));
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/host/login', agent: false, headers: { host: hostHeader, 'content-type': 'application/json', 'content-length': payload.length } }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode, cookies: (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ') }));
      });
      req.on('error', reject);
      req.end(payload);
    });
    same(hostIn.status, 200, 'the host signs in');
    const hostCall = (method, p, body) => new Promise((resolve, reject) => {
      const payload = Buffer.from(JSON.stringify(body));
      const req = http.request({ host: '127.0.0.1', port, method, path: p, agent: false, headers: { host: consoleHost, cookie: hostIn.cookies, 'content-type': 'application/json', 'content-length': payload.length } }, (res) => {
        let text = '';
        res.on('data', (d) => { text += d; });
        res.on('end', () => resolve({ status: res.statusCode, text }));
      });
      req.on('error', reject);
      req.end(payload);
    });
    const envs = {};
    for (const slug of ['aaa', 'bbb']) {
      const made = await hostCall('POST', '/api/host/environments', { slug, name: `Env ${slug}`, owner: { login: `own${slug}`, password: 'ownerpass1234' } });
      same(made.status, 201, `environment ${slug} is made: ${made.text}`);
      hostHeader = `${slug}.${BASE}:${port}`;
      const host = await login('host', 'hostpass1234'); // the host's own sign-in may add a zip
      await installModules(host);
      const ownC = await login(`own${slug}`, 'ownerpass1234');
      const u = (await call('POST', '/api/users', { cookie: ownC, body: { login: 'pip', displayName: `Pip ${slug}`, role: 'member', password: 'memberpass1234' } })).json.user;
      const uC = await login('pip', 'memberpass1234');
      const sp = (await call('POST', '/api/spaces', { cookie: ownC, body: { name: 'Same', members: [u.key] } })).json.space;
      await call('PATCH', `/api/spaces/${sp.id}`, { cookie: ownC, body: { members: [u.key] } });
      const s = await openStream(MS(sp.id), { cookie: uC });
      const sid = await ready(s);
      same((await call('POST', `/api/modules/live-a/live/join?space=${sp.id}`, { cookie: uC, body: { stream: sid } })).status, 200, `Pip joins in ${slug}`);
      envs[slug] = { ownC, uC, sp, s, sid, host: hostHeader, key: u.key };
    }
    const { aaa, bbb } = envs;
    hostHeader = aaa.host;
    same((await send('live-a', aaa.sp.id, { topic: 'pointer', data: { env: 'aaa' } }, aaa.ownC)).status, 200, 'the owner of aaa sends');
    await aaa.s.until((e) => e.event === 'live' && e.data.data.env === 'aaa');
    await refusal(await send('live-a', bbb.sp.id, { topic: 'x' }, aaa.ownC), 404, 'no such space', 'aaa\'s owner names bbb\'s space: 404');
    same((await call('POST', `/api/modules/live-a/live/join?space=${aaa.sp.id}`, { cookie: aaa.ownC, body: { stream: bbb.sid } })).status, 409, 'bbb\'s stream id at aaa: 409');
    hostHeader = bbb.host;
    same((await send('live-a', bbb.sp.id, { topic: 'x' }, aaa.ownC)).status, 401, 'aaa\'s session at bbb: 401');
    await quiet(400);
    same(bbb.s.lives().length, 0, 'a reader of the same module in the other environment gets nothing');
    ok(!bbb.s.events.some((e) => e.event === 'joined'), 'nor its joins');
    // A guest pass is for its own environment: aaa's guest's pass with bbb's link is refused, and aaa's link means nothing at bbb.
    hostHeader = aaa.host;
    const aLink = (await call('POST', `/api/spaces/${aaa.sp.id}/guest-link`, { cookie: aaa.ownC, body: {} })).json.space.guestToken;
    const aGuest = (await call('POST', '/api/guest-join', { body: { token: aLink, name: 'Ada' } })).json.guest;
    same((await send('live-a', aaa.sp.id, { topic: 'g' }, null, `&guest=${encodeURIComponent(aLink)}&pass=${encodeURIComponent(aGuest.pass)}`)).status, 200, 'aaa\'s guest sends in aaa');
    hostHeader = bbb.host;
    const bLink = (await call('POST', `/api/spaces/${bbb.sp.id}/guest-link`, { cookie: bbb.ownC, body: {} })).json.space.guestToken;
    await refusal(await send('live-a', bbb.sp.id, { topic: 'g' }, null, `&guest=${encodeURIComponent(bLink)}&pass=${encodeURIComponent(aGuest.pass)}`), 403, 'that guest pass is not valid; enter again', 'aaa\'s guest pass with bbb\'s link: 403');
    await refusal(await send('live-a', bbb.sp.id, { topic: 'g' }, null, `&guest=${encodeURIComponent(aLink)}&pass=${encodeURIComponent(aGuest.pass)}`), 401, 'sign in first', 'aaa\'s link at bbb: 401');
    await quiet(300);
    same(bbb.s.lives().length, 0, 'still nothing in bbb');

    // The host console resets aaa's owner's two-step sign-in (signing them out everywhere there): their module stream in
    // aaa ends at once, though the reset runs on the host's router.
    hostHeader = aaa.host;
    const secret = (await call('POST', '/api/me/mfa/start', { cookie: aaa.ownC, body: {} })).json.secret;
    const enabled = await call('POST', '/api/me/mfa/enable', { cookie: aaa.ownC, body: { code: totpCode(secret) } });
    same(enabled.status, 200, 'aaa\'s owner turns on two-step sign-in');
    const ownS = await openStream(MS(aaa.sp.id), { cookie: enabled.json.token });
    await ready(ownS);
    const t = Date.now();
    same((await hostCall('DELETE', '/api/host/environments/aaa/owners/ownaaa/mfa', {})).status, 200, 'the host console resets it');
    const ended = await within(ownS.ended, 1500);
    const ms = Date.now() - t;
    ok(ended === true && ms < 300, `the owner's module stream in aaa ends at once (${ms} ms; the recheck is 2000)`);
    ok(bbb.s.closed !== true && (await within(bbb.s.ended, 300)) === 'timeout', 'a stream in bbb goes on');
    for (const s of open) s.close();
  }
  await stopServer();
  hostHeader = null;
} catch (err) {
  failed = true;
  console.error(err);
  if (out) console.error(`--- server output ---\n${out.slice(-4000)}`);
} finally {
  for (const s of open) { try { s.close(); } catch { /* gone */ } }
  await stopServer();
  lk.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}
if (failed) process.exit(1);
console.log(`check-module-live: ${n} checks passed`);
