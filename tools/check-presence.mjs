#!/usr/bin/env node
/*
 * check-presence.mjs -- presence by membership (documentation/plans/plan-primary-nav.md, decision 6 and
 * "Phase 2: the online people widget", built as step 3). GET /api/presence tells a viewer where someone is only for
 * the spaces (and asides) the viewer belongs to:
 *   - a member of space A asking about someone in space B they don't belong to reads `space: null, elsewhere: true`,
 *     never on the call;
 *   - a private aside's members read as its parent space with `aside: true` to a member of the parent who is not in
 *     the aside, and as nowhere they can see (`elsewhere`) to anyone else; the aside's id and record go only to its
 *     own members, and to owners and the admin, who belong to every space and aside;
 *   - a guest reads only their own space and its people;
 *   - the access key (OBS, Studio) reads everything, as before, and an OBS viewer is never listed.
 * Where people are comes from the live register (server/live.js, plan-realtime-optional-livekit.md step 1), with the
 * call service's list merged in (mergeCall); presenceView() reads that. First server/presence-view.js on its own and fed
 * from a register, then a real single-environment server on a throwaway DATA_DIR against a stand-in LiveKit (a small
 * Twirp JSON server answering ListRooms and ListParticipants), with people in the register through GET /api/live as
 * well: an aside is pulled from the register's word about the call, and its aside-started goes on the live stream
 * (plan-realtime-optional-livekit.md, step 4). No network beyond localhost.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { presenceView, placeFor, activeSpaceFor } = require('../server/presence-view.js');
const { LiveRegister, mergeCall } = require('../server/live.js');
let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    n += 1;
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}\n${err.stack || err}`);
  }
};

// --- the rules on their own ---------------------------------------------------------------------------------------
{
  const spaces = [
    { id: 'lobby', name: 'Lobby', members: ['al', 'bo', 'cy', 'di', 'ad'] },
    { id: 'spa', name: 'A', members: ['al', 'cy', 'di'] },
    { id: 'spb', name: 'B', members: ['bo'] },
  ];
  const asides = [{ id: 'asd', members: ['cy', 'di'], origin: 'spa', private: true }, { id: 'lone', members: ['bo', 'ad'], origin: null, private: true }];
  const users = ['al', 'bo', 'cy', 'di', 'ad', 'ev'].map((key) => ({ key }));
  const online = new Map([
    ['al', { key: 'al', space: 'spa', inCall: true }],
    ['bo', { key: 'bo', space: 'spb', inCall: true }],
    ['cy', { key: 'cy', space: 'asd', inCall: true }],
    ['di', { key: 'di', space: 'asd', inCall: true }],
  ]);
  const view = (viewer, activeSpace = 'lobby') => presenceView(viewer, {
    users, spaces, asides, online, present: (k) => k === 'ev', describeUser: (u) => ({ key: u.key }), describeSpace: (s) => ({ id: s.id, name: s.name, members: s.members }), activeSpace,
  });
  const where = (answer) => Object.fromEntries(answer.users.map((u) => [u.key, [u.space, u.aside, u.elsewhere, u.inCall, u.online, u.present]]));

  await test('rules: a member of A sees A\'s people, B\'s as elsewhere, and the aside from A as A with aside', () => {
    const a = view({ key: 'al', owner: false });
    assert.deepEqual(where(a), {
      al: ['spa', false, false, true, true, true],
      bo: [null, false, true, false, true, true],
      cy: ['spa', true, false, false, true, true],
      di: ['spa', true, false, false, true, true],
      ad: [null, false, false, false, false, false],
      ev: [null, false, false, false, false, true],
    });
    assert.deepEqual(a.asides, [], 'no aside record for a non-member');
    assert.deepEqual(a.spaces.map((s) => [s.id, s.mine]), [['lobby', true], ['spa', true]], 'a closed space is not told to a person outside it');
    assert.ok(!JSON.stringify(a).includes('asd'), 'the aside\'s id is nowhere in the answer');
  });

  await test('rules: a member of B only sees A\'s people and the aside\'s members as elsewhere', () => {
    const b = view({ key: 'bo', owner: false });
    assert.deepEqual(where(b).al.slice(0, 4), [null, false, true, false]);
    assert.deepEqual(where(b).cy.slice(0, 4), [null, false, true, false]);
    assert.deepEqual(where(b).bo.slice(0, 4), ['spb', false, false, true], 'themselves');
    assert.deepEqual(b.asides.map((x) => x.id), ['lone'], 'only the aside they are in');
  });

  await test('rules: an aside\'s own member reads its id; the admin reads everything', () => {
    const d = view({ key: 'di', owner: false });
    assert.deepEqual(where(d).cy.slice(0, 4), ['asd', true, false, true]);
    assert.deepEqual(d.asides.map((x) => [x.id, x.mine]), [['asd', true]]);
    const ad = view({ key: 'ad', owner: true });
    assert.deepEqual(where(ad).cy.slice(0, 4), ['asd', true, false, true]);
    assert.deepEqual(where(ad).bo.slice(0, 4), ['spb', false, false, true]);
    assert.deepEqual(ad.asides.map((x) => x.id), ['asd', 'lone']);
    assert.ok(ad.spaces.every((s) => s.mine));
  });

  await test('rules: a guest reads only their own space and its people; the access key reads everything', () => {
    const g = view({ guestSpace: 'spa' });
    assert.deepEqual(where(g), {
      al: ['spa', false, false, true, true, true],
      cy: ['spa', true, false, false, true, true],
      di: ['spa', true, false, false, true, true],
    });
    assert.deepEqual([g.spaces.map((s) => [s.id, s.mine]), g.asides], [[['spa', true]], []]);
    const gb = view({ guestSpace: 'spb' });
    assert.deepEqual(where(gb), { bo: ['spb', false, false, true, true, true] });
    const all = view({ all: true });
    assert.deepEqual(where(all).cy.slice(0, 4), ['asd', true, false, true]);
    assert.deepEqual(all.asides.map((x) => x.id), ['asd', 'lone']);
  });

  await test('rules: asidePrivate says which kind of aside, to the parent\'s members and the aside\'s own, never with whom', () => {
    const kinds = presenceView({ key: 'al', owner: false }, {
      users: [{ key: 'cy' }, { key: 'ev' }, { key: 'bo' }],
      spaces,
      asides: [...asides, { id: 'pub', members: ['ev'], origin: 'spa', private: false }],
      online: new Map([['cy', { key: 'cy', space: 'asd', inCall: true }], ['ev', { key: 'ev', space: 'pub', inCall: true }], ['bo', { key: 'bo', space: 'spb', inCall: true }]]),
      present: () => false, describeUser: (u) => ({ key: u.key }), describeSpace: (s) => s, activeSpace: 'lobby',
    });
    const of = (k) => { const u = kinds.users.find((x) => x.key === k); return [u.space, u.aside, u.asidePrivate]; };
    assert.deepEqual([of('cy'), of('ev'), of('bo')], [['spa', true, true], ['spa', true, false], [null, false, false]]);
    assert.ok(!kinds.users.some((u) => 'members' in u), 'no members on a person');
    assert.equal(where(view({ key: 'di', owner: false })).cy[0], 'asd');
    assert.equal(view({ key: 'di', owner: false }).users.find((u) => u.key === 'cy').asidePrivate, true);
  });

  await test('rules: the stream\'s space is read only where the viewer belongs', () => {
    const find = { spaceById: (id) => spaces.find((s) => s.id === id) || null, asideById: (id) => asides.find((a) => a.id === id) || null };
    assert.equal(activeSpaceFor({ key: 'al' }, 'spb', find), null);
    assert.equal(activeSpaceFor({ key: 'bo' }, 'spb', find), 'spb');
    assert.equal(activeSpaceFor({ key: 'al' }, 'asd', find), null, 'an aside the viewer is not in reads as null, even to its parent\'s members (they are off stream)');
    assert.equal(activeSpaceFor({ key: 'di' }, 'asd', find), 'asd', 'and as itself to its own members');
    assert.equal(activeSpaceFor({ key: 'ad', owner: true }, 'asd', find), 'asd');
    assert.equal(activeSpaceFor({ key: 'bo' }, 'asd', find), null);
    assert.equal(activeSpaceFor({ guestSpace: 'spa' }, 'lobby', find), null);
    assert.equal(activeSpaceFor({ all: true }, 'asd', find), 'asd');
    assert.deepEqual(placeFor({ key: 'al' }, 'al', undefined, find), { space: null, aside: false, asidePrivate: false, elsewhere: false, inCall: false }, 'in no call: no place, not elsewhere');
  });

  await test('rules: the register is the source; the same rules apply to it', () => {
    const reg = new LiveRegister();
    reg.open({ who: 'al', name: 'al', space: 'spa' });
    const s1 = reg.open({ who: 'cy', name: 'cy', space: 'asd' });
    reg.set('cy', 'asd', { onCall: true }, s1);
    reg.open({ who: 'bo', name: 'bo', space: null }); // Home: on the site, in no space
    const fromRegister = presenceView({ key: 'al', owner: false }, {
      users, spaces, asides, online: mergeCall(reg.places(), []), present: (k) => reg.onSite(k), describeUser: (u) => ({ key: u.key }), describeSpace: (s) => s, activeSpace: 'lobby',
    });
    assert.deepEqual(where(fromRegister).al, ['spa', false, false, false, true, true], 'in the Keep, off the call');
    assert.deepEqual(where(fromRegister).cy, ['spa', true, false, false, true, true], 'in an aside from A, never on the call to a non-member');
    assert.deepEqual(where(fromRegister).bo, [null, false, false, false, false, true], 'on Home: present, not online');
    const toMember = presenceView({ key: 'di', owner: false }, {
      users, spaces, asides, online: mergeCall(reg.places(), []), present: (k) => reg.onSite(k), describeUser: (u) => ({ key: u.key }), describeSpace: (s) => s, activeSpace: 'lobby',
    });
    assert.deepEqual(where(toMember).cy, ['asd', true, false, true, true, true], 'the page\'s word: on the call, to the aside\'s member');
  });
}

// --- live: a single-environment server and a stand-in LiveKit -------------------------------------------------------
// `calls` is { callName: [person, ...] }; a person is an identity on the call, or { id, call, hidden }.
const calls = {};
const participant = (person) => {
  const identity = person.id || person;
  return { sid: `PA_${identity}`, identity, name: identity, joinedAt: '1', permission: { hidden: Boolean(person.hidden) }, tracks: [], attributes: person.hidden ? {} : { call: person.call || 'on' } };
};
const standIn = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const ask = body ? JSON.parse(body) : {};
    let answer = {};
    if (req.url.endsWith('/ListRooms')) answer = { rooms: Object.entries(calls).map(([name, people]) => ({ sid: `RM_${name}`, name, numParticipants: people.length })) };
    else if (req.url.endsWith('/ListParticipants')) answer = { participants: (calls[ask.room] || []).map(participant) };
    else { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(answer));
  });
});
await new Promise((r) => standIn.listen(0, '127.0.0.1', r));
const setCalls = (next) => { for (const k of Object.keys(calls)) delete calls[k]; Object.assign(calls, next); };

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-presence-'));
let child = null;
let port = 0;
async function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ADMIN_PASSWORD: 'testpass1234', LIVEKIT_API_URL: `http://127.0.0.1:${standIn.address().port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
}
const stopServer = () => new Promise((resolve) => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });

async function call(method, urlPath, { body, token } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const signIn = async (login, password) => {
  const r = await call('POST', '/api/login', { body: { login, password } });
  assert.equal(r.status, 200, `${login} signs in: ${r.text}`);
  return r.json.token;
};

try {
  await startServer();
  const admin = await signIn('admin', 'testpass1234');
  const me = (await call('GET', '/api/me', { token: admin })).json;
  const adminKey = me.user.key;
  const streamKey = me.streamKey;
  const mk = async (login) => {
    const r = await call('POST', '/api/users', { token: admin, body: { login, displayName: login, role: 'member', password: 'memberpass1234' } });
    assert.equal(r.status, 201, r.text);
    return r.json.user.key;
  };
  const [alice, bob, carol, dana] = [await mk('alice'), await mk('bob'), await mk('carol'), await mk('dana')];
  const spaceA = (await call('POST', '/api/spaces', { token: admin, body: { name: 'Keep', members: [alice, carol, dana] } })).json.space.id;
  const spaceB = (await call('POST', '/api/spaces', { token: admin, body: { name: 'Tower', members: [bob] } })).json.space.id;
  // A creator is a member of the space they make (GitHub #239); these cases want the admin outside both.
  await call('PATCH', `/api/spaces/${spaceA}`, { token: admin, body: { members: [alice, carol, dana] } });
  await call('PATCH', `/api/spaces/${spaceB}`, { token: admin, body: { members: [bob] } });
  const guestA = (await call('POST', `/api/spaces/${spaceA}/guest-link`, { token: admin, body: {} })).json.space.guestToken;
  assert.ok(guestA, 'the Keep has a guest link');
  const [aliceT, bobT, carolT, danaT] = [await signIn('alice', 'memberpass1234'), await signIn('bob', 'memberpass1234'), await signIn('carol', 'memberpass1234'), await signIn('dana', 'memberpass1234')];
  const presence = async (opts, query = '') => {
    const r = await call('GET', `/api/presence${query}`, opts);
    assert.equal(r.status, 200, r.text);
    return r;
  };
  const person = (answer, key) => {
    const u = answer.json.users.find((x) => x.key === key);
    return u ? [u.space, u.aside, u.elsewhere, u.inCall, u.online] : undefined;
  };
  const kind = (answer, key) => answer.json.users.find((x) => x.key === key)?.asidePrivate;
  // In a space as the register says: a live stream open there (GET /api/live), on the call when `onCall` (the page's
  // word). Answers { events, close }; `events` collects each event's data.
  const opened = [];
  const enter = async (token, space, { onCall = false } = {}) => {
    const ctl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/live?space=${space}`, { headers: { authorization: `Bearer ${token}` }, signal: ctl.signal });
    assert.equal(res.status, 200, `the live stream opens for ${space}`);
    const events = [];
    let buf = '';
    let gotReady;
    const ready = new Promise((r) => { gotReady = r; });
    (async () => {
      const decoder = new TextDecoder();
      try {
        for await (const chunk of res.body) {
          buf += decoder.decode(chunk, { stream: true });
          let at;
          while ((at = buf.indexOf('\n\n')) >= 0) {
            const line = buf.slice(0, at).split('\n').find((l) => l.startsWith('data: '));
            buf = buf.slice(at + 2);
            if (!line) continue;
            const data = JSON.parse(line.slice(6));
            events.push(data);
            if (data.type === 'ready') gotReady(data.stream);
          }
        }
      } catch { /* closed */ }
    })();
    const stream = await ready;
    if (onCall) assert.equal((await call('PATCH', `/api/spaces/${space}/presence`, { token, body: { onCall: true, stream } })).status, 200);
    const entered = { events, close: () => ctl.abort() };
    opened.push(entered);
    return entered;
  };
  const quiet = (ms = 300) => new Promise((r) => setTimeout(r, ms));
  const startedIn = (s) => s.events.filter((e) => e.type === 'aside-started').map(({ type, spaceId, members, private: priv }) => (members ? { type, spaceId, members, private: priv } : { type, spaceId, private: priv }));

  // Alice, Carol and Dana on the Keep's call, Bob on the Tower's with a hidden OBS viewer, a guest in the Keep. Carol and
  // Dana are in the Keep by the register and on the call by their page's word, Alice there off it by her page's word:
  // the call service is asked only while the register has someone on a call (plan-realtime-optional-livekit.md, step 5).
  setCalls({ [spaceA]: [alice, carol, dana, 'guest-wanderer'], [spaceB]: [bob, { id: 'obs-viewer', hidden: true }] });
  const aliceIn = await enter(aliceT, spaceA);
  const carolIn = await enter(carolT, spaceA, { onCall: true });
  const danaIn = await enter(danaT, spaceA, { onCall: true });

  await test('live: a member of the Keep asking about Bob in the Tower reads him online with no place', async () => {
    const r = await presence({ token: aliceT });
    assert.deepEqual(person(r, bob), [null, false, true, false, true]);
    assert.deepEqual(person(r, carol), [spaceA, false, false, true, true]);
    assert.ok(!r.json.users.some((u) => u.space === spaceB), 'nobody is placed in the Tower');
    assert.ok(!r.json.spaces.some((s) => s.id === spaceB), 'and the Tower is not listed to one outside it');
    const b = await presence({ token: bobT });
    assert.deepEqual(person(b, alice), [null, false, true, false, true], 'and Bob reads Alice the same way');
    assert.deepEqual(person(b, bob), [spaceB, false, false, true, true]);
    assert.ok(!r.text.includes('obs-viewer') && !b.text.includes('obs-viewer'), 'an OBS viewer is never listed');
  });

  // Carol pulls Dana into a private conversation from the Keep's call (both on it as the register says; Alice in the Keep,
  // off the call by her page's word, hears it start); then both are on the aside's call, and in the aside.
  const pulled = await call('POST', '/api/asides', { token: carolT, body: { with: [dana], private: true } });
  assert.equal(pulled.status, 200, pulled.text);
  const aside = pulled.json.aside.id;
  setCalls({ [spaceA]: [alice, 'guest-wanderer'], [`aside-${aside}`]: [carol, dana], [spaceB]: [bob, { id: 'obs-viewer', hidden: true }] });
  await quiet();
  carolIn.close();
  danaIn.close();
  await enter(carolT, aside, { onCall: true });
  await enter(danaT, aside, { onCall: true });

  await test('live: a private aside\'s members read as the Keep, stepped out, to a Keep member who is not in it', async () => {
    const r = await presence({ token: aliceT });
    assert.deepEqual(person(r, carol), [spaceA, true, false, false, true]);
    assert.deepEqual(person(r, dana), [spaceA, true, false, false, true]);
    assert.deepEqual([kind(r, carol), kind(r, dana), kind(r, alice), kind(r, bob)], [true, true, false, false], 'a private conversation, said as such');
    assert.deepEqual(r.json.asides, [], 'no aside record');
    assert.ok(!r.text.includes(aside), 'the aside\'s id is nowhere in the answer');
  });

  await test('live: a non-member of the Keep reads the aside\'s members as elsewhere, and learns nothing of the aside', async () => {
    const r = await presence({ token: bobT });
    assert.deepEqual(person(r, carol), [null, false, true, false, true]);
    assert.deepEqual(person(r, dana), [null, false, true, false, true]);
    assert.deepEqual(r.json.asides, []);
    assert.ok(!r.text.includes(aside));
  });

  await test('live: the aside\'s own members read it by its id', async () => {
    const r = await presence({ token: danaT });
    assert.deepEqual(person(r, carol), [aside, true, false, true, true]);
    assert.deepEqual(r.json.asides.map((a) => [a.id, a.origin, a.private, a.mine]), [[aside, spaceA, true, true]]);
  });

  await test('live: a guest of the Keep reads only the Keep and its people', async () => {
    const r = await presence({}, `?guest=${encodeURIComponent(guestA)}`);
    assert.deepEqual(r.json.users.map((u) => u.key).sort(), [alice, carol, dana].sort(), 'Bob and the admin are not listed');
    assert.deepEqual(person(r, alice), [spaceA, false, false, true, true]);
    assert.deepEqual(person(r, carol), [spaceA, true, false, false, true]);
    assert.deepEqual(r.json.spaces.map((s) => [s.id, s.mine, s.guestToken]), [[spaceA, true, null]]);
    assert.deepEqual(r.json.asides, []);
    assert.ok(!r.text.includes(aside) && !r.text.includes(spaceB), 'neither the aside nor the Tower is named');
    assert.equal((await call('GET', '/api/presence?guest=wrong')).status, 401, 'a wrong guest link reads nothing');
  });

  await test('live: the admin belongs everywhere and reads everything; so does the access key', async () => {
    for (const r of [await presence({ token: admin }), await presence({}, `?s=${encodeURIComponent(streamKey)}`)]) {
      assert.deepEqual(person(r, bob), [spaceB, false, false, true, true]);
      assert.deepEqual(person(r, carol), [aside, true, false, true, true]);
      assert.deepEqual(r.json.asides.map((a) => [a.id, a.mine]), [[aside, true]]);
      assert.ok(r.json.spaces.every((s) => s.mine));
    }
  });

  await test('live: the space the stream hears is named only to those who belong to it', async () => {
    setCalls({ [spaceA]: [alice], [`aside-${aside}`]: [carol, dana], [spaceB]: [bob, adminKey] });
    assert.equal((await presence({ token: bobT })).json.activeSpace, spaceB);
    assert.equal((await presence({ token: aliceT })).json.activeSpace, null);
    assert.equal((await presence({ token: admin })).json.activeSpace, spaceB);
    assert.equal((await presence({ token: aliceT })).json.ownerOnline, true);
  });

  await test('live: a private conversation\'s aside-started tells the call no members; an ordinary aside\'s does', async () => {
    assert.deepEqual(startedIn(aliceIn), [{ type: 'aside-started', spaceId: aside, private: true }], 'the private pull: no members, on the live stream of everyone in the Keep');
    // The admin pulls Alice into an ordinary aside from the Keep (an owner's move); both on the Keep's call first.
    setCalls({ [spaceA]: [adminKey, alice, 'guest-wanderer'], [`aside-${aside}`]: [carol, dana], [spaceB]: [bob] });
    const adminIn = await enter(admin, spaceA, { onCall: true });
    aliceIn.close();
    const aliceOn = await enter(aliceT, spaceA, { onCall: true });
    const pub = await call('POST', '/api/asides', { token: admin, body: { with: [alice] } });
    assert.equal(pub.status, 200, pub.text);
    const pubId = pub.json.aside.id;
    await quiet();
    assert.deepEqual(startedIn(adminIn)[0], { type: 'aside-started', spaceId: pubId, members: [adminKey, alice], private: false });
    setCalls({ [`aside-${pubId}`]: [adminKey, alice], [`aside-${aside}`]: [carol, dana], [spaceB]: [bob] });
    adminIn.close();
    aliceOn.close();
    await enter(admin, pubId, { onCall: true });
    await enter(aliceT, pubId, { onCall: true });
    const d = await presence({ token: danaT });
    assert.deepEqual([person(d, alice), kind(d, alice)], [[spaceA, true, false, false, true], false], 'an ordinary aside, to a Keep member not in it');
    assert.deepEqual([person(d, carol), kind(d, carol)], [[aside, true, false, true, true], true], 'the private one, to its own member');
    // The stream follows the admin into the ordinary aside: named only to its members.
    assert.equal(d.json.activeSpace, null, 'a Keep member not in it is off stream');
    assert.equal((await presence({ token: bobT })).json.activeSpace, null);
    assert.equal((await presence({ token: aliceT })).json.activeSpace, pubId);
  });

  for (const s of opened.splice(0)) s.close();
  await quiet();

  await test('live: someone signed in and in no call is present, with no place', async () => {
    assert.equal((await call('POST', '/api/presence', { token: bobT })).status, 200);
    setCalls({});
    const r = await presence({ token: aliceT });
    const b = r.json.users.find((u) => u.key === bob);
    assert.deepEqual([b.online, b.present, b.space, b.elsewhere, b.aside, b.inCall], [false, true, null, false, false, false]);
    assert.equal((await call('GET', '/api/presence')).status, 401, 'nobody signed in reads nothing');
  });

  await test('live: someone in the register (GET /api/live) and on no call at LiveKit reads as in the space', async () => {
    setCalls({});
    const ctl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/live?space=${spaceA}`, { headers: { authorization: `Bearer ${aliceT}` }, signal: ctl.signal });
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    let got = '';
    while (!/"type":"ready"/.test(got)) got += new TextDecoder().decode((await reader.read()).value);
    const stream = JSON.parse(/data: (\{"type":"ready".*\})/.exec(got)[1]).stream;
    assert.equal((await call('PATCH', `/api/spaces/${spaceA}/presence`, { token: aliceT, body: { onCall: true, stream } })).status, 200);
    const r = await presence({ token: carolT });
    assert.deepEqual(person(r, alice), [spaceA, false, false, true, true], 'in the Keep, on the call by the page\'s word');
    assert.deepEqual(person(await presence({ token: bobT }), alice), [null, false, true, false, true], 'elsewhere to a non-member');
    ctl.abort();
  });
} catch (err) {
  failed += 1;
  console.error(`FAIL live setup\n${err.stack || err}`);
} finally {
  await stopServer();
  standIn.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-presence: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-presence: ${n} checks passed`);
