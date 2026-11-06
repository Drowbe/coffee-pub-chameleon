#!/usr/bin/env node
/*
 * check-demo-loader.mjs -- the generic demo loader (server/demo-loader.js) and the travel demo file
 * (templates/demo/travel.json; documentation/plans/plan-demo-space.md, slice 1).
 * Boots throwaway servers and calls the loader directly (not through tools/seed-demo.mjs) and asserts:
 *  (a) on a travel environment with every module on it makes the seeder's counts: Planner 76, Places 37, Calendar 77, To-do 16,
 *      Polls 3, Budget 18, Research 4, Chat 25, with nothing refused or skipped, and random passwords that differ on every run;
 *  (b) with Budget turned off it skips Budget, says so in one plain sentence, does not turn it on, and makes everything else;
 *  (c) it changes no environment-wide setting: the settings, the modules list, the place search and the template are
 *      identical before and after a run;
 *  (d) a space with the demo's name and no marker, or a person with a demo login and another name, is refused in one sentence,
 *      and nothing at all is made or changed before the refusal;
 *  (e) a second run resets only the demo space and the demo people (another space, its data and another account stay; the
 *      old passwords stop working);
 *  (f) every date in the data file is an offset (no absolute date, no epoch number), a file with an unknown base is refused
 *      before anything is made, and the demo stays ahead of a faked "today" and moves with it;
 *  (h) every sentence reads in the environment's own words (a `words` function renaming space and environment shows in a
 *      refusal and a skip), and a module id outside [a-z0-9-] refuses the file before anything is made;
 *  (i) the last writer of every object is pinned per module (a demo person, never the admin);
 *  (g) a template with no demo file reports "There is no demo for this template." and creates nothing; the data file's
 *      folder does not stop the server (the server started, so templates/ read fine) and every file in it names a bundled
 *      template; and no file holds a password.
 * No LiveKit and no browser are needed.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const loaderPath = process.env.DEMO_LOADER_UNDER_TEST ? path.resolve(process.env.DEMO_LOADER_UNDER_TEST) : path.join(ROOT, 'server', 'demo-loader.js');
const WORDS = require(path.join(ROOT, 'server', 'words.js'));
const { loadDemo, readDemoFile, DemoError, MARKER, dayPlus } = require(loaderPath);
const PASSWORD = 'testpass1234';
const ALL = ['travel', 'places', 'todo', 'polls', 'calendar', 'budget', 'research', 'maps'];
const WANT = { travel: 76, places: 37, calendar: 77, todo: 16, polls: 3, budget: 18, research: 4, chat: 25 };
const TODAY = '2031-03-01';
// Who last wrote each object, per module (the item's `by`, as a demo login): the demo people, never the admin who ran the loader.
const WRITERS = { travel: { mia: 77 }, places: { mia: 37 }, calendar: { mia: 77 }, todo: { mia: 16 }, polls: { lee: 4, mia: 3, sam: 4 }, budget: { mia: 18 }, research: { mia: 4 } };

const free = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
const servers = [];
async function boot(extraEnv = {}) {
  const port = await free();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-loader-'));
  const child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), DATA_DIR: dataDir, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ADMIN_PASSWORD: PASSWORD, ...extraEnv } });
  const s = { child, dataDir, log: '', base: `http://127.0.0.1:${port}` };
  child.stdout.on('data', (d) => { s.log += d; }); child.stderr.on('data', (d) => { s.log += d; });
  servers.push(s);
  for (let i = 0; i < 150; i += 1) {
    try { if ((await fetch(`${s.base}/healthz`)).ok) break; } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(`a throwaway server did not start: ${s.log.slice(-400)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const jar = {};
  s.api = async (method, url, body) => {
    const r = await fetch(s.base + url, { method, headers: { 'content-type': 'application/json', ...(jar.c ? { cookie: jar.c } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (url === '/api/login') jar.c = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  await s.api('POST', '/api/login', { login: 'admin', password: PASSWORD });
  s.run = (extra = {}) => loadDemo({ base: s.base, templateId: 'travel', today: TODAY, session: { login: 'admin', password: PASSWORD }, ...extra });
  return s;
}
const stopAll = async () => {
  for (const s of servers) {
    if (s.child.exitCode === null) { const gone = new Promise((r) => s.child.once('exit', r)); s.child.kill('SIGTERM'); await Promise.race([gone, new Promise((r) => setTimeout(r, 8000))]); }
    fs.rmSync(s.dataDir, { recursive: true, force: true });
  }
};
const modulesOn = async (s, ids) => { for (const id of ids) { await s.api('POST', `/api/modules/bundled/${id}/install`); await s.api('PATCH', `/api/modules/${id}`, { enabled: true }); } };
// Everything environment-wide a person could set: the settings (template included), the modules and the place search.
const snapshot = async (s) => JSON.stringify({
  settings: (await s.api('GET', '/api/settings')).json.settings,
  modules: (await s.api('GET', '/api/modules')).json.modules.map((m) => ({ id: m.id, enabled: m.enabled, version: m.version })),
  moduleSettings: (await s.api('GET', '/api/module-settings/environment')).json,
});
const rejects = async (p, re, why) => { try { await p; } catch (e) { assert.ok(e instanceof DemoError, `${why}: a DemoError (${e && e.message})`); assert.match(e.message, re, why); return e; } assert.fail(`${why}: it should have been refused`); };

let n = 0; let failed = null;
const step = async (name, fn) => { try { await fn(); n += 1; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };

try {
  // ---- (f) the data file itself: only offsets ----
  await step('(f) the data file holds only date offsets', async () => {
    const file = readDemoFile('travel');
    const strings = []; const numbers = [];
    const walk = (v) => { if (typeof v === 'string') strings.push(v); else if (typeof v === 'number') numbers.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { strings.push(k); walk(x); }); };
    walk(file);
    const text = fs.readFileSync(path.join(ROOT, 'templates', 'demo', 'travel.json'), 'utf8');
    assert.ok(!/\b(19|20|21)\d\d-\d\d-\d\d\b/.test(text), 'no YYYY-MM-DD anywhere in the file');
    assert.ok(!/\b(19|20|21)\d\d-\d\d\b/.test(text.replace(/"_about"[^\n]*/, '')), 'no year and month either');
    assert.deepEqual(numbers.filter((x) => x > 1e9), [], 'no epoch number (a number of seconds or milliseconds) in the file');
    assert.deepEqual(strings.filter((s) => /^\d{4}-\d{2}/.test(s) || /^\d{4}-\d{2}-\d{2}T/.test(s)), [], 'no string starts like an absolute date');
    const offsets = strings.filter((s) => /^(ms:)?[a-z]+[+-]\d+(T\d\d:\d\d)?Z?$/.test(s) && !s.startsWith('@'));
    assert.ok(offsets.length > 150, `the file has many date offsets (${offsets.length})`);
    for (const o of offsets) assert.match(o, /^(ms:)?(today|start)[+-]\d+(T\d\d:\d\d)?Z?$/, `${o} is an offset from today or start`);
    assert.ok(strings.includes('ms:now'), 'a time of the run is written ms:now');
    assert.ok(file.anchor >= 1, 'the trip starts after today');
  });

  // ---- (g) a folder of data files, every one a bundled template; no password in any ----
  await step('(g) every demo file names a bundled template and holds no password', async () => {
    const dir = path.join(ROOT, 'templates', 'demo');
    const files = fs.readdirSync(dir);
    assert.ok(files.includes('travel.json'));
    for (const f of files) {
      assert.ok(f.endsWith('.json') && fs.existsSync(path.join(ROOT, 'templates', f)), `${f} is named like a bundled template`);
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.ok(!/"password"|"pass"|passwd/i.test(raw), `${f} holds no password`);
      assert.ok(readDemoFile(f.slice(0, -5)), `${f} is a valid demo file`);
    }
    assert.equal(readDemoFile('games'), null, 'the games template has no demo file yet');
    assert.equal(readDemoFile('../server/index'), null, 'an id cannot reach another folder');
  });

  // A travel environment with every module on (each case that runs the loader more than once or twice gets its own, so
  // the per-minute write budget of a module (240 a person) is never what is being tested).
  const travelServer = async () => {
    const s = await boot();
    await s.api('PATCH', '/api/settings', { template: 'travel' });
    await s.api('PATCH', '/api/settings', { showCalendar: true, showMap: true });
    await modulesOn(s, ALL);
    return s;
  };

  // ---- (a), (c), (e): a travel environment with every module on ----
  const A = await travelServer();
  const kim = (await A.api('POST', '/api/users', { login: 'kim', displayName: 'Kim Other', role: 'member', password: 'kim-password-1' })).json.user;
  const other = (await A.api('POST', '/api/spaces', { name: 'Other trip', description: 'Mine.', members: [kim.key] })).json.space;
  assert.equal((await A.api('PUT', `/api/modules/todo/data/task:keep?scope=space&space=${other.id}`, { value: { id: 'keep', title: 'Keep me', notes: '', due: null, done: false, remind: false, doneAt: null, createdAt: 1, by: 'Kim', links: [] } })).status, 200);

  let first;
  await step('(a) the loader makes the seeder\'s counts', async () => {
    const before = await snapshot(A); // (c) the snapshot is taken before the first run
    A.before = before;
    first = await A.run();
    assert.equal(first.demo, true);
    assert.deepEqual(first.created, WANT, 'Planner 76, Places 37, Calendar 77, To-do 16, Polls 3, Budget 18, Research 4, Chat 25');
    assert.deepEqual(first.refused, [], 'nothing refused');
    assert.deepEqual(first.skipped, [], 'nothing skipped');
    assert.deepEqual(first.people.map((p) => p.login), ['mia', 'lee', 'sam']);
    assert.ok(first.people.every((p) => p.password && p.password.length >= 12 && p.password !== PASSWORD), 'a random password each');
    assert.equal(new Set(first.people.map((p) => p.password)).size, 3);
    assert.ok(first.guestUrl && /\/guest\//.test(first.guestUrl));
    assert.equal(first.start, dayPlus(TODAY, 45));
    assert.ok(first.space.members.length >= 4);
    const space = (await A.api('GET', `/api/spaces/${first.space.id}`)).json.space;
    assert.ok(space.description.startsWith(MARKER), 'the space carries the marker');
    assert.equal(space.phases.trip.start, first.start);
    assert.deepEqual(space.budget, { amount: 6500, currency: 'EUR' });
    const polls = (await A.api('GET', `/api/modules/polls/data?scope=space&space=${first.space.id}&prefix=vote:`)).json.items;
    assert.equal(polls.length, 8, 'the votes were cast, each by its own voter');
    const chat = (await A.api('GET', `/api/spaces/${first.space.id}/chat`)).json.messages;
    assert.ok(chat.some((m) => m.text.includes(`${A.base}/modules/travel?space=${first.space.id}`)), 'the chat link holds this server and this space');
  });
  await step('(a) each module\'s last writer is a demo person, never the admin who ran the loader', async () => {
    const login = Object.fromEntries(first.people.map((p) => [p.key, p.login]));
    const tally = {};
    for (const id of ['travel', 'places', 'calendar', 'todo', 'polls', 'budget', 'research']) {
      const items = (await A.api('GET', `/api/modules/${id}/data?scope=space&space=${first.space.id}&prefix=`)).json.items;
      const by = {};
      for (const it of items) { const who = login[it.by] || `other:${it.by}`; by[who] = (by[who] || 0) + 1; }
      tally[id] = by;
    }
    assert.deepEqual(tally, WRITERS, 'the last writer of every object, per module');
  });
  await step('(c) it changed no environment-wide setting', async () => {
    assert.equal(await snapshot(A), A.before, 'settings, modules, place search and template are identical after the run');
  });

  await step('(f) the demo stays ahead of today, and moves with it', async () => {
    const F = await travelServer();
    const first = await F.run();
    const read = async (id, mod, prefix) => (await F.api('GET', `/api/modules/${mod}/data?scope=space&space=${id}&prefix=${prefix}`)).json.items.map((i) => i.value);
    const id1 = first.space.id;
    const trip = (await F.api('GET', `/api/modules/travel/data/trip:main?scope=space&space=${id1}`)).json.item.value;
    assert.ok(trip.start > TODAY && trip.end > trip.start);
    const dated = async (id) => {
      const plan = await read(id, 'travel', 'plan:'); const tasks = await read(id, 'todo', 'task:'); const events = (await read(id, 'calendar', 'event:')).map((e) => String(e.start).slice(0, 10));
      return { plan: plan.map((p) => p.date).filter(Boolean), tasks: tasks.map((t) => t.due), events, budget: (await read(id, 'budget', 'cost:')).map((c) => c.date).filter(Boolean) };
    };
    const d1 = await dated(id1);
    for (const [what, list] of Object.entries(d1)) assert.ok(list.length > 0 && list.every((d) => d >= TODAY), `every ${what} date is on or after today`);
    // A later day moves every date by the same number of days.
    const LATER = '2035-07-04';
    const second = await F.run({ today: LATER });
    const d2 = await dated(second.space.id);
    const shift = (Date.parse(`${LATER}T00:00:00Z`) - Date.parse(`${TODAY}T00:00:00Z`)) / 86400000;
    for (const k of Object.keys(d1)) assert.deepEqual(d2[k].slice().sort(), d1[k].map((d) => dayPlus(d, shift)).sort(), `every ${k} date moved by ${shift} days`);
    assert.ok(second.start > LATER);
  });

  await step('(e) a rerun resets only the demo space and the demo people', async () => {
    const oldPass = first.people.find((p) => p.login === 'mia').password;
    const again = await A.run();
    assert.notEqual(again.space.id, first.space.id, 'a new space');
    assert.deepEqual(again.created, WANT, 'the same counts');
    assert.notEqual(again.people.find((p) => p.login === 'mia').password, oldPass, 'a new password');
    const old = await fetch(`${A.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'mia', password: oldPass }) });
    assert.equal(old.status === 200, false, 'the old password no longer signs in');
    const spaces = (await A.api('GET', '/api/spaces')).json.spaces;
    assert.equal(spaces.filter((s) => s.name === 'Demo: Portugal').length, 1, 'exactly one demo space');
    assert.ok(spaces.some((s) => s.id === other.id), 'the other space is still there');
    assert.equal((await A.api('GET', `/api/modules/todo/data/task:keep?scope=space&space=${other.id}`)).json.item.value.title, 'Keep me', 'and its data');
    const users = (await A.api('GET', '/api/users')).json.users;
    assert.ok(users.some((u) => u.login === 'kim' && u.displayName === 'Kim Other'), 'the other account is untouched');
    for (const l of ['mia', 'lee', 'sam']) assert.equal(users.filter((u) => u.login === l).length, 1, `one ${l}`);
  });

  const B = await travelServer();
  await step('(c) the same, run again with the owner\'s own cookie', async () => {
    const login = await fetch(`${B.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'admin', password: PASSWORD }) });
    const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const before = await snapshot(B);
    const r = await B.run({ session: { cookie } });
    assert.deepEqual(r.created, WANT);
    assert.equal(await snapshot(B), before);
  });

  // ---- (b) a module that is off is skipped, said so, and not turned on ----
  await step('(b) Budget off: skipped, reported, not turned on', async () => {
    assert.equal((await B.api('PATCH', '/api/modules/budget', { enabled: false })).status, 200);
    const before = await snapshot(B);
    const r = await B.run();
    assert.equal(r.skipped.length, 1, JSON.stringify(r.skipped));
    assert.equal(r.skipped[0].module, 'budget');
    assert.match(r.skipped[0].why, /^Budget is off in this environment, so the 18 demo costs were not made\.$/);
    assert.equal(r.created.budget, undefined, 'no costs were made');
    const { budget: _off, ...rest } = WANT;
    assert.deepEqual(r.created, rest, 'everything else was made');
    assert.deepEqual(r.refused, []);
    assert.equal(await snapshot(B), before, 'and Budget is still off');
    const mods = (await B.api('GET', '/api/modules')).json.modules;
    assert.equal(mods.find((m) => m.id === 'budget').enabled, false);
    await B.api('PATCH', '/api/modules/budget', { enabled: true });
  });

  // ---- a file with an unknown base or a phase the template lacks ----
  const E = await travelServer();
  await step('(f) an unknown date base is refused before anything is made; a missing phase is reported', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-files-'));
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'demo', 'travel.json'), 'utf8'));
      const bad = structuredClone(raw); bad.modules.todo.steps[0].data['task:dm01'].due = 'tomorrow+1';
      fs.writeFileSync(path.join(dir, 'travel.json'), JSON.stringify(bad));
      const spacesBefore = (await E.api('GET', '/api/spaces')).json.spaces.map((s) => s.id).join();
      await rejects(E.run({ dir }), /a date the loader does not know \("tomorrow\+1" at modules\.todo\.steps\[0\]\.task:dm01\.due\)/, 'the unknown base');
      assert.equal((await E.api('GET', '/api/spaces')).json.spaces.map((s) => s.id).join(), spacesBefore, 'nothing was made or removed');
      const evil = structuredClone(raw); evil.modules['../settings'] = evil.modules.todo;
      fs.writeFileSync(path.join(dir, 'travel.json'), JSON.stringify(evil));
      await rejects(E.run({ dir }), /modules\.\.\.\/settings is not a module id/, 'a module id outside [a-z0-9-]');
      assert.equal((await E.api('GET', '/api/spaces')).json.spaces.map((s) => s.id).join(), spacesBefore, 'nothing was made or removed for a bad module id');
      const odd = structuredClone(raw); odd.phases.voyage = { start: 'today+1' }; odd.modules.todo.steps[0].data['task:dm01'].phase = 'voyage';
      fs.writeFileSync(path.join(dir, 'travel.json'), JSON.stringify(odd));
      const r = await E.run({ dir });
      assert.ok(r.skipped.some((s) => s.module === 'phases' && /no phase "voyage"/.test(s.why)));
      assert.ok(r.refused.some((x) => x.module === 'todo' && x.key === 'task:dm01' && /no phase "voyage"/.test(x.why)));
      assert.equal(r.created.todo, 15, 'the object that needs the missing phase is left out');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await step('(h) the sentences use the words function: a skip and a refusal read the environment\'s own words', async () => {
    const set = WORDS.resolve({ space: { one: 'quest', many: 'quests' }, environment: { one: 'campaign', many: 'campaigns' } }, null);
    const words = (key, opts) => WORDS.format(set, key, opts);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-files-'));
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'demo', 'travel.json'), 'utf8'));
      raw.modules = { budget: raw.modules.budget }; raw.phases = { voyage: { start: 'today+1' } };
      fs.writeFileSync(path.join(dir, 'travel.json'), JSON.stringify(raw));
      assert.equal((await E.api('PATCH', '/api/modules/budget', { enabled: false })).status, 200);
      const r = await E.run({ dir, words });
      assert.match(r.skipped.find((x) => x.module === 'budget').why, /^Budget is off in this campaign, so the 18 demo costs were not made\.$/);
      assert.match(r.skipped.find((x) => x.module === 'phases').why, /^This campaign's template has no phase "voyage"/);
      const plain = await E.run({ dir });
      assert.match(plain.skipped.find((x) => x.module === 'budget').why, /^Budget is off in this environment,/, 'the default words without the option');
      await E.api('PATCH', '/api/modules/budget', { enabled: true });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // ---- (d) names without the marker ----
  const D = await boot();
  await D.api('PATCH', '/api/settings', { template: 'travel' });
  await modulesOn(D, ALL);
  await step('(d) a space with the demo\'s name and no marker is refused', async () => {
    const mine = (await D.api('POST', '/api/spaces', { name: 'Demo: Portugal', description: 'My own trip.', members: [] })).json.space;
    const usersBefore = JSON.stringify((await D.api('GET', '/api/users')).json.users.map((u) => u.login));
    const spacesBefore = (await D.api('GET', '/api/spaces')).json.spaces.map((s) => s.id);
    await rejects(D.run(), /A trip called "Demo: Portugal" exists but is not the demo \(its description lacks the marker\), so it is left alone\./, 'no marker (the travel environment\'s own word for a space)');
    const spaces = (await D.api('GET', '/api/spaces')).json.spaces;
    assert.deepEqual(spaces.map((s) => s.id), spacesBefore, 'nothing was made or removed');
    assert.ok(spaces.some((s) => s.id === mine.id), 'the space is still there');
    assert.equal(JSON.stringify((await D.api('GET', '/api/users')).json.users.map((u) => u.login)), usersBefore, 'and no person was made or changed');
    await rejects(D.run({ words: (key, opts) => WORDS.format(WORDS.resolve({ space: { one: 'journey', many: 'journeys' } }, null), key, opts) }), /^A journey called "Demo: Portugal" exists but is not the demo/, 'the refusal uses the words function');
    await D.api('DELETE', `/api/spaces/${mine.id}`);
  });
  await step('(d) a person with a demo login and another name is refused', async () => {
    const lee = (await D.api('POST', '/api/users', { login: 'lee', displayName: 'Lee Somebody Else', role: 'member', password: 'lee-password-1' })).json.user;
    const spacesBefore = (await D.api('GET', '/api/spaces')).json.spaces.length;
    await rejects(D.run(), /An account called "lee" already exists and is not a demo person \(its name is not Lee Chen\), so it is left alone\. Rename or remove it first\./, 'another name');
    const users = (await D.api('GET', '/api/users')).json.users;
    assert.ok(users.some((u) => u.key === lee.key && u.displayName === 'Lee Somebody Else'), 'the account is as it was');
    assert.ok(!users.some((u) => u.login === 'mia' || u.login === 'sam'), 'no demo person was made before the refusal');
    assert.equal((await D.api('GET', '/api/spaces')).json.spaces.length, spacesBefore, 'no space was made');
    // Her own password still works: it was not changed.
    const r = await fetch(`${D.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'lee', password: 'lee-password-1' }) });
    assert.equal(r.status, 200, 'its password was not changed');
  });

  // ---- (g) a template with no demo ----
  const G = await boot({ TEMPLATE: 'games' });
  await step('(g) a template with no demo creates nothing', async () => {
    const tpl = ((await G.api('GET', '/api/settings')).json.settings.template || {}).id;
    assert.equal(tpl, 'games', 'the games environment is up');
    // The environment is still setting itself up from its template for a moment; wait until it stops changing.
    const state = async () => JSON.stringify([(await G.api('GET', '/api/spaces')).json.spaces.map((x) => x.id), (await G.api('GET', '/api/users')).json.users.map((u) => u.login), await snapshot(G)]);
    let before = await state();
    for (let i = 0; i < 20; i += 1) { await new Promise((r) => setTimeout(r, 300)); const now = await state(); if (now === before) break; before = now; }
    const r = await G.run({ templateId: tpl });
    assert.deepEqual(r, { demo: false, message: 'There is no demo for this template.', created: {}, skipped: [], refused: [], people: [] });
    assert.equal(await state(), before, 'nothing was made');
    for (const id of [null, undefined, '', 'nope', '../x']) assert.equal((await G.run({ templateId: id })).demo, false, `no demo for ${JSON.stringify(id)}`);
  });
} catch (e) { failed = e; } finally { await stopAll(); }
if (failed) { console.error(failed.stack || failed); console.error(servers.map((s) => s.log.slice(-300)).join('\n---\n')); process.exit(1); }
console.log(`check-demo-loader: ${n} groups OK`);
