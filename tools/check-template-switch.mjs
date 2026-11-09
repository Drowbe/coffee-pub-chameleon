#!/usr/bin/env node
/*
 * check-template-switch.mjs -- switching a template (plan-environment-templates.md, "Addendum: switching a template",
 * GitHub #59) and the Lobby kept for being together (plan-modules.md, "Addendum: the Lobby is for being together",
 * GitHub #63), against real servers on throwaway DATA_DIRs:
 *   - a single install: the start-up sync (To-do switched off in the Lobby only, its data kept, logged), "every space"
 *     leaving the Lobby out, the Calendar allowed there, the refusals with the module's display name and the Lobby's
 *     own name; an owner switching to travel (the words at once, the owner's own word and home icon kept, the offer),
 *     confirming part of the offer, 409s, switching to none, the history, and a switched template never applied on a
 *     restart (a space's "AI off" kept across it);
 *   - a hosted server: the host switching an environment made with no template, the plan's refusal in the offer and
 *     recorded as skipped when confirmed, the console's list showing it;
 *   - the enter verb (addendum 4) on both: the owner's own kept over a switched-to template's, null back to the
 *     template's or the default, a host template's verb live at once and never in the offer.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A made-up product name for the servers this check starts, so a sentence that hard-codes the default fails here
// (plan-kind-names.md, The guard).
const PRODUCT = 'Testname';
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
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
// A file from before the formats were named by kind (tools/fixtures/format-old/), found by its kind.
const OLD_DIR = path.join(ROOT, 'tools', 'fixtures', 'format-old');
const oldFiles = (kind) => fs.readdirSync(OLD_DIR).filter((f) => f.endsWith(`-${kind}.json`)).sort().map((f) => fs.readFileSync(path.join(OLD_DIR, f), 'utf8'));

async function startServer(dataDir, env = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, PRODUCT_NAME: PRODUCT, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  const waitFor = async (text) => {
    for (let i = 0; i < 200 && !out.includes(text); i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.ok(out.includes(text), `${text}\n${out}`);
  };
  return { port, output: () => out, waitFor, stop: () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); }) };
}

// One request, as `host` (a subdomain of localhost, or '' for 127.0.0.1 on a single install).
// `raw`: a body sent as it is, with `type` (a file's own text), instead of `body` as JSON.
function call(server, host, method, urlPath, { body, cookie, raw, type } = {}) {
  const payload = raw !== undefined ? Buffer.from(raw) : body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { host: host ? `${host}.localhost:${server.port}` : `127.0.0.1:${server.port}`, accept: 'application/json' };
  if (payload) { headers['content-type'] = raw !== undefined ? (type || 'text/plain') : 'application/json'; headers['content-length'] = payload.length; }
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

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-template-switch-'));
let server = null;
try {
  // --- a single install ------------------------------------------------------------------------------------------
  const single = path.join(base, 'single');
  const env = { ADMIN_PASSWORD: 'admin-password-1' };
  server = await startServer(single, env);
  let cookie = cookieOf(await call(server, '', 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
  let as = (method, url, body) => call(server, '', method, url, { cookie, body });
  const side = (await as('POST', '/api/spaces', { name: 'Side' })).json.space.id;
  for (const id of ['todo', 'polls', 'calendar']) assert.equal((await as('POST', `/api/modules/bundled/${id}/install`)).status, 201, id);
  assert.equal((await as('PATCH', '/api/modules/todo', { enabled: true, spaces: [side] })).status, 200);
  assert.equal((await as('PATCH', '/api/modules/polls', { enabled: true, allSpaces: true })).status, 200);
  assert.equal((await as('PATCH', '/api/modules/calendar', { enabled: true, allSpaces: true })).status, 200);
  await server.stop();
  // To-do on in the Lobby as an older build allowed, with data there.
  const registryFile = path.join(single, 'modules', 'registry.json');
  const registry = readJson(registryFile);
  registry.modules.todo.spaces = ['lobby', side];
  fs.writeFileSync(registryFile, JSON.stringify(registry));
  const lobbyData = path.join(single, 'modules', 'todo', 'data', 'space-lobby.json');
  fs.mkdirSync(path.dirname(lobbyData), { recursive: true });
  fs.writeFileSync(lobbyData, JSON.stringify({ 'task:a': { value: { title: 'kept' }, version: 1, updatedAt: '2026-09-01T00:00:00.000Z', by: 'x' } }));
  server = await startServer(single, env);
  cookie = cookieOf(await call(server, '', 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
  as = (method, url, body) => call(server, '', method, url, { cookie, body });
  const lobbySentence = (name) => `${name} can't be turned on in Lobby, which is kept for chat, the call and a few modules made for it.`;

  await test('on start, nothing rewrites the stored spaces; To-do is in every space but the Lobby, its data kept', async () => {
    assert.deepEqual(readJson(registryFile).modules.todo.spaces, ['lobby', side], 'stored spaces left as they were');
    assert.deepEqual(readJson(registryFile).modules.todo.allSpaces, false);
    const ids = async (space) => (await as('GET', `/api/modules/for-space?space=${space}`)).json.modules.map((m) => m.id);
    assert.ok((await ids(side)).includes('todo'), 'in the space it was set for');
    assert.ok(!(await ids('lobby')).includes('todo'), 'not in the Lobby: it is not made for it');
    assert.ok(fs.existsSync(lobbyData), 'its Lobby data is kept');
  });

  await test('the Lobby lists only the modules made for it; every other space lists them all', async () => {
    const ids = async (space) => (await as('GET', `/api/modules/for-space?space=${space}`)).json.modules.map((m) => m.id).sort();
    assert.deepEqual(await ids('lobby'), ['calendar'], 'Polls in every space leaves the Lobby out; the Calendar is allowed');
    assert.deepEqual(await ids(side), ['calendar', 'polls', 'todo']);
    const lobbyModules = (await as('GET', '/api/modules/for-space?space=lobby')).json;
    assert.deepEqual(lobbyModules.builtin.map((b) => b.id), ['conference', 'chat'], 'chat and the conference are the built-ins, as before');
    // #237: each module and built-in carries its one-line description, in the environment's words, never a made-up one.
    assert.ok(lobbyModules.builtin.every((b) => typeof b.description === 'string' && b.description && !/[{}]/.test(b.description)), 'built-ins describe themselves, placeholders filled');
    const sideModules = (await as('GET', `/api/modules/for-space?space=${side}`)).json.modules;
    assert.ok(sideModules.every((m) => m.description === undefined || (typeof m.description === 'string' && m.description && !/[{}]/.test(m.description))), 'a module\'s description is its manifest\'s, filled, or absent');
    assert.ok(sideModules.some((m) => m.description), 'at least one bundled module is described');
    assert.deepEqual([lobbyModules.opensWith, lobbyModules.spaceDefaultsOpensWith], [null, null], 'with no template, nothing is set to open');
    assert.equal((await as('GET', '/api/modules')).json.modules.find((m) => m.id === 'polls').lobby, false);
    assert.equal((await as('GET', '/api/modules')).json.modules.find((m) => m.id === 'calendar').lobby, true);
  });

  // plan-entering.md, step 1: a space's own "Opens with", which GET /api/modules/for-space answers beside the
  // environment's spaceDefaults.opensWith (the template's) that this check already covers.
  await test('a space\'s Opens with: cleaned, cleared by null, refused when not a list, owner only, answered with the space', async () => {
    const forSpace = async (id) => (await as('GET', `/api/modules/for-space?space=${id}`)).json.opensWith;
    const stored = () => readJson(path.join(single, 'app.json')).spaces.find((s) => s.id === side);
    assert.equal('opensWith' in stored(), false, 'nothing is stored for a space that has not set it');
    assert.equal('opensWith' in (await as('GET', '/api/spaces')).json.spaces.find((s) => s.id === side), false, 'absent while not set');
    // Too long, wrong types inside a list of strings refused; a bad id pattern and a repeat dropped.
    const ids = Array.from({ length: 25 }, (_, i) => `m${i}`);
    let r = await as('PATCH', `/api/spaces/${side}`, { opensWith: ['chat', 'Bad_Id', 'todo', '1x', 'chat', ...ids] });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.space.opensWith, ['chat', 'todo', ...ids.slice(0, 18)], 'up to 20 module ids, bad ones and repeats dropped');
    // A module that is off (To-do is not on in the Lobby) or not installed is kept, in order.
    r = await as('PATCH', '/api/spaces/lobby', { opensWith: ['todo', 'conference', 'not-installed', 'chat'] });
    assert.deepEqual([r.status, r.json.space.opensWith], [200, ['todo', 'conference', 'not-installed', 'chat']]);
    assert.deepEqual(await forSpace('lobby'), ['todo', 'conference', 'not-installed', 'chat'], 'for-space answers the stored list');
    assert.deepEqual((await as('GET', '/api/presence')).json.spaces.find((s) => s.id === 'lobby').opensWith, ['todo', 'conference', 'not-installed', 'chat'], 'the space carries it on presence');
    assert.deepEqual((await as('GET', '/api/spaces')).json.spaces.find((s) => s.id === 'lobby').opensWith, ['todo', 'conference', 'not-installed', 'chat'], 'and on the space list');
    // Anything that is not a list of strings, or null, is refused and changes nothing.
    const sentence = { error: 'Opens with must be a list of modules.' };
    for (const bad of ['chat', 5, true, { chat: true }, ['chat', 5], [null], [['chat']]]) {
      assert.deepEqual(await as('PATCH', `/api/spaces/${side}`, { opensWith: bad }).then((x) => [x.status, x.json]), [400, sentence], JSON.stringify(bad));
    }
    assert.deepEqual(stored().opensWith, ['chat', 'todo', ...ids.slice(0, 18)], 'a refused value changes nothing');
    // A refused Opens with refuses the whole change.
    assert.equal((await as('PATCH', `/api/spaces/${side}`, { name: 'Renamed', opensWith: 'chat' })).status, 400);
    assert.equal(stored().name, 'Side');
    // null clears it back to "not set", as does an empty list or one with nothing usable in it.
    r = await as('PATCH', `/api/spaces/${side}`, { opensWith: null });
    assert.deepEqual([r.status, 'opensWith' in r.json.space, 'opensWith' in stored(), await forSpace(side)], [200, false, false, null]);
    assert.equal((await as('PATCH', `/api/spaces/${side}`, { opensWith: ['chat'] })).status, 200);
    r = await as('PATCH', `/api/spaces/${side}`, { opensWith: [] });
    assert.deepEqual([r.status, 'opensWith' in stored()], [200, false], 'an empty list is not set');
    r = await as('PATCH', `/api/spaces/${side}`, { opensWith: ['Nope!'] });
    assert.deepEqual([r.status, 'opensWith' in stored()], [200, false], 'nothing usable is not set');
    // Another field changed leaves it as it is.
    assert.equal((await as('PATCH', '/api/spaces/lobby', { description: 'Where everyone meets.' })).status, 200);
    assert.deepEqual(await forSpace('lobby'), ['todo', 'conference', 'not-installed', 'chat']);
    // Owner only: a member, and a member who moderates the space, are refused.
    const made = await as('POST', '/api/users', { login: 'opener', displayName: 'Opener', role: 'member', password: 'opener-password-1' });
    assert.equal(made.status, 201, made.text);
    const key = made.json.user.key;
    assert.equal((await as('PATCH', `/api/spaces/${side}`, { members: [key] })).status, 200);
    const member = cookieOf(await call(server, '', 'POST', '/api/login', { body: { login: 'opener', password: 'opener-password-1' } }));
    const asMember = (method, url, body) => call(server, '', method, url, { cookie: member, body });
    assert.deepEqual(await asMember('PATCH', `/api/spaces/${side}`, { opensWith: ['chat'] }).then((x) => [x.status, x.json]), [403, { error: 'owners only' }], 'a member');
    assert.equal((await as('PATCH', `/api/users/${key}/spaces/${side}`, { permissions: { moderator: true } })).status, 200);
    // A member who moderates the space may set Opens with (plan-one-bar.md step 4), nothing else.
    assert.equal((await asMember('PATCH', `/api/spaces/${side}`, { opensWith: ['chat'] })).status, 200, 'a member who moderates the space');
    assert.deepEqual(stored().opensWith, ['chat']);
    assert.equal((await asMember('PATCH', `/api/spaces/${side}`, { opensWith: null })).status, 200);
    assert.equal('opensWith' in stored(), false, 'cleared again');
    assert.deepEqual(await asMember('PATCH', `/api/spaces/${side}`, { name: 'Side 2' }).then((x) => [x.status, x.json]), [403, { error: 'owners only' }], 'the name is still the owners\'');
    assert.deepEqual((await asMember('GET', '/api/modules/for-space?space=lobby')).json.opensWith, ['todo', 'conference', 'not-installed', 'chat'], 'a member reads it');
    assert.equal((await as('DELETE', `/api/users/${key}`)).status, 200);
  });

  await test('a module not made for the Lobby is refused there with its display name and the Lobby\'s own name', async () => {
    assert.equal((await as('PATCH', '/api/modules/todo', { spaces: ['lobby', side], allSpaces: false })).status, 200, 'accepted and ignored');
    assert.deepEqual(readJson(registryFile).modules.todo.spaces, ['lobby', side], 'nothing changed');
    assert.equal((await as('PATCH', '/api/modules/polls', { displayName: 'Votes' })).status, 200);
    assert.equal((await as('PATCH', '/api/modules/polls', { spaces: ['lobby'] })).status, 200, 'accepted and ignored');
    assert.deepEqual(await as('GET', '/api/modules/todo/data?scope=space&space=lobby').then((r) => [r.status, r.json]), [404, { error: lobbySentence('To-do') }], 'its data there is shown nowhere');
    const page = await as('GET', '/modules/todo?space=lobby');
    assert.deepEqual([page.status, page.text], [404, lobbySentence('To-do')]);
    assert.equal((await as('PATCH', '/api/modules/calendar', { spaces: ['lobby'] })).status, 200, 'the Calendar may be');
    assert.equal((await as('GET', `/api/modules/todo/data?scope=space&space=${side}`)).status, 200, 'another space is as before');
  });

  await test('the module context names the space it is in, and has no phases until a template does', async () => {
    const envScope = await as('GET', '/api/modules/calendar/context?scope=environment');
    assert.equal(envScope.status, 200, envScope.text);
    assert.equal(envScope.json.space, null);
    assert.deepEqual(envScope.json.phases, []);
    const sideSpace = (await as('GET', '/api/spaces')).json.spaces.find((s) => s.id === side);
    const inSpace = await as('GET', `/api/modules/calendar/context?scope=space&space=${side}`);
    assert.equal(inSpace.status, 200, inSpace.text);
    assert.deepEqual(inSpace.json.space, { id: side, name: 'Side', createdAt: sideSpace.createdAt, phases: {}, budget: null, guestsSeeHidden: false });
    assert.deepEqual(inSpace.json.phases, []);
  });

  const words = async () => (await call(server, '', 'GET', '/api/branding')).json;
  await test('an owner switches to travel: the words at once, the owner\'s own word and home icon kept, and the offer', async () => {
    const icon = (await as('GET', '/api/settings')).json.settings.icons.at(-1).id;
    assert.equal((await as('PATCH', '/api/settings', { words: { member: { one: 'player', many: 'players' } }, homeIcon: icon })).status, 200);
    // Addendum 4: no template, the default verb; the owner's own set before the switch.
    assert.deepEqual((await words()).verbs, { enter: 'Enter', layout: 'Layout' });
    const ownVerb = await as('PATCH', '/api/settings', { verbs: { enter: 'Step in' } });
    assert.deepEqual([ownVerb.status, ownVerb.json.settings.verbs, ownVerb.json.settings.ownVerbs, ownVerb.json.settings.templateVerbs], [200, { enter: 'Step in', layout: 'Layout' }, { enter: 'Step in' }, null], ownVerb.text);
    assert.deepEqual(await as('PATCH', '/api/settings', { template: 'nope' }).then((r) => [r.status, r.json]), [400, { error: 'There is no template called nope.' }]);
    assert.deepEqual(await as('PATCH', '/api/settings', { template: 5 }).then((r) => [r.status, r.json]), [400, { error: 'A template is named by its id, or "none" for no template.' }]);
    const r = await as('PATCH', '/api/settings', { template: 'travel' });
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.settings, 'the settings, as before');
    assert.deepEqual([r.json.template.id, r.json.template.name, r.json.template.offerOpen, r.json.template.appliedAt], ['travel', 'Travel', true, null]);
    assert.deepEqual(r.json.offer.modules.map((m) => [m.id, m.allowed]), [['travel', true], ['places', true], ['maps', true], ['research', true], ['vault', true], ['budget', true]], 'the Calendar is on in every space already; the conference is on');
    assert.deepEqual(r.json.offer.lobby, { name: 'Home base', description: 'Everyone on every trip.' });
    assert.deepEqual(r.json.offer.spaceDefaults, { profile: 'participants', opensWith: ['travel', 'chat'] });
    const b = await words();
    assert.deepEqual([b.words.space.one, b.words.member.one, b.homeIcon], ['trip', 'player', icon], 'the template\'s words at once; the owner\'s own still win');
    assert.deepEqual(b.verbs, { enter: 'Step in', layout: 'Layout' }, 'the owner\'s verb kept over the template\'s');
    assert.deepEqual([r.json.settings.ownVerbs, r.json.settings.templateVerbs], [{ enter: 'Step in' }, {}], 'Travel sets no verb of its own');
    assert.equal('verbs' in r.json.offer, false, 'a live part: never in the offer');
    const cleared = await as('PATCH', '/api/settings', { verbs: { enter: null } });
    assert.deepEqual([cleared.json.settings.verbs, cleared.json.settings.ownVerbs], [{ enter: 'Enter', layout: 'Layout' }, {}], 'null: the template\'s, here the default');
    assert.equal((await as('PATCH', '/api/settings', { verbs: { enter: 'Step in' } })).status, 200);
    assert.equal((await as('GET', '/api/modules')).json.modules.some((m) => m.id === 'travel'), false, 'nothing turned on before it is confirmed');
    const again = await as('PATCH', '/api/settings', { template: 'travel' });
    assert.deepEqual([again.status, again.json.template.offerOpen], [200, true], 'the same template: nothing changes');
    const view = (await as('GET', '/api/environment/template')).json;
    assert.deepEqual([view.template.id, view.template.source, view.offer.modules.length, view.choices.map((c) => c.id)], ['travel', 'bundled', 6, ['games', 'travel']]);
  });

  await test('switching to a template puts its phases on the module context at once', async () => {
    const inSpace = await as('GET', `/api/modules/calendar/context?scope=space&space=${side}`);
    assert.equal(inSpace.status, 200, inSpace.text);
    assert.equal(inSpace.json.space.name, 'Side');
    assert.deepEqual(inSpace.json.phases.map((p) => [p.id, Boolean(p.main)]), [['planning', false], ['booking', false], ['buffer', false], ['pre-trip', false], ['trip', true], ['post-trip', false]]);
    const envScope = await as('GET', '/api/modules/calendar/context?scope=environment');
    assert.equal(envScope.json.space, null);
    assert.equal(envScope.json.phases.find((p) => p.main).id, 'trip');
  });

  await test('confirming part of the offer turns on only that, in every space but the Lobby; then 409', async () => {
    assert.deepEqual(await as('POST', '/api/environment/template/apply', { modules: 'travel' }).then((r) => [r.status, r.json]), [400, { error: 'Name the modules to turn on as a list of their ids.' }]);
    const r = await as('POST', '/api/environment/template/apply', { modules: ['travel', 'maps'], lobby: false, spaceDefaults: true });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.template.offerOpen, typeof r.json.template.appliedAt, r.json.offer, r.json.template.skipped], [false, 'string', null, []]);
    const mods = Object.fromEntries((await as('GET', '/api/modules')).json.modules.map((m) => [m.id, m]));
    for (const id of ['travel', 'places', 'maps']) assert.deepEqual([id, mods[id].enabled, mods[id].allSpaces], [id, true, true]);
    assert.equal(mods.research, undefined, 'Research, not ticked, not installed');
    const lobby = (await as('GET', '/api/modules/for-space?space=lobby')).json.modules.map((m) => m.id);
    assert.deepEqual(lobby.sort(), ['calendar'], 'the Lobby keeps its own');
    assert.ok((await as('GET', `/api/modules/for-space?space=${side}`)).json.modules.some((m) => m.id === 'travel'));
    assert.equal((await as('GET', '/api/spaces')).json.spaces.find((s) => s.id === 'lobby').name, 'Lobby', 'the Lobby\'s name, not ticked, kept');
    assert.equal((await as('POST', '/api/spaces', { name: 'Lisbon' })).json.space.profile, 'participants', 'the new-space profile, ticked, taken');
    assert.deepEqual(await as('POST', '/api/environment/template/apply', {}).then((r2) => [r2.status, r2.json]), [409, { error: 'This template has already been applied.' }]);
  });

  await test('switching to none: the words go back, the modules stay on, the owner\'s own kept; then 409; the history', async () => {
    const r = await as('PATCH', '/api/settings', { template: 'none' });
    assert.deepEqual([r.status, r.json.template, r.json.offer], [200, null, null]);
    const b = await words();
    assert.deepEqual([b.words.space.one, b.words.member.one], ['space', 'player']);
    assert.deepEqual(b.verbs, { enter: 'Step in', layout: 'Layout' }, 'the owner\'s verb kept');
    const st = (await as('GET', '/api/settings')).json.settings;
    assert.deepEqual([st.templateVerbs, st.ownVerbs], [null, { enter: 'Step in' }]);
    assert.deepEqual((await as('PATCH', '/api/settings', { verbs: { enter: null } })).json.settings.verbs, { enter: 'Enter', layout: 'Layout' }, 'no template: the default');
    assert.equal((await as('GET', '/api/modules')).json.modules.find((m) => m.id === 'travel').enabled, true, 'still on');
    assert.deepEqual(await as('POST', '/api/environment/template/apply', {}).then((r2) => [r2.status, r2.json]), [409, { error: 'This environment has no template to apply.' }]);
    const app = readJson(path.join(single, 'app.json'));
    assert.deepEqual(app.templateHistory.map((h) => [h.from, h.to]), [[null, 'travel'], ['travel', null]]);
    assert.ok(app.templateHistory.every((h) => typeof h.by === 'string' && h.by !== 'host' && h.at));
  });

  await test('a switched template is never applied on its own at a restart; switching back offers only what is missing', async () => {
    assert.equal((await as('PATCH', '/api/settings', { template: 'travel' })).status, 200);
    // A space's "AI off" is refused before the restart and must still be after it (it was dropped on load once).
    const aiOffSentence = { error: 'AI is turned off in this trip.' }; // travel's word for a space
    assert.equal((await as('PATCH', `/api/spaces/${side}`, { aiOff: true })).status, 200);
    assert.deepEqual(await as('POST', `/api/spaces/${side}/ai`, { question: 'hello there' }).then((x) => [x.status, x.json]), [403, aiOffSentence]);
    await server.stop();
    // A space's Opens with, hand-edited on disk, is cleaned the same way when read back (plan-entering.md, step 1).
    const appFile = path.join(single, 'app.json');
    const onDisk = readJson(appFile);
    onDisk.spaces.find((s) => s.id === side).opensWith = ['chat', 5, 'Bad_Id', null, 'chat', ...Array.from({ length: 25 }, (_, i) => `m${i}`)];
    fs.writeFileSync(appFile, JSON.stringify(onDisk));
    server = await startServer(single, env);
    cookie = cookieOf(await call(server, '', 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
    as = (method, url, body) => call(server, '', method, url, { cookie, body });
    const view = (await as('GET', '/api/environment/template')).json;
    assert.deepEqual([view.template.offerOpen, view.template.appliedAt], [true, null]);
    assert.deepEqual(view.offer.modules.map((m) => m.id), ['research', 'vault', 'budget'], 'only what is missing');
    assert.ok(!server.output().includes('Applied the "travel" template'), server.output());
    assert.equal((await as('GET', '/api/spaces')).json.spaces.find((s) => s.id === 'lobby').name, 'Lobby');
    const spaces = (await as('GET', '/api/spaces')).json.spaces;
    assert.deepEqual(spaces.find((s) => s.id === side).opensWith, ['chat', ...Array.from({ length: 19 }, (_, i) => `m${i}`)], 'cleaned on load: up to 20 module ids');
    assert.deepEqual(spaces.find((s) => s.id === 'lobby').opensWith, ['todo', 'conference', 'not-installed', 'chat'], 'kept across a restart');
    assert.equal(spaces.find((s) => s.id === side).aiOff, true, 'AI off kept across a restart');
    assert.equal('aiOff' in readJson(appFile).spaces.find((s) => s.id === 'lobby'), false, 'nothing stored for a space that never set it');
    assert.deepEqual(await as('POST', `/api/spaces/${side}/ai`, { question: 'hello there' }).then((x) => [x.status, x.json]), [403, aiOffSentence], 'still refused after a restart');
    assert.equal((await as('PATCH', `/api/spaces/${side}`, { aiOff: false })).status, 200);
    assert.notDeepEqual(await as('POST', `/api/spaces/${side}/ai`, { question: 'hello there' }).then((x) => [x.status, x.json]), [403, aiOffSentence], 'turned back on');
  });
  await test('a single install imports, exports and deletes its own templates; one in use can\'t be deleted', async () => {
    const travel = await as('GET', '/api/templates/travel/export');
    assert.deepEqual([travel.status, travel.headers['content-disposition']], [200, 'attachment; filename="travel.template.json"'], 'a bundled one exports');
    assert.deepEqual([travel.json.format, travel.json.formatVersion], ['template', 1]);
    for (const old of oldFiles('template')) assert.deepEqual(await call(server, '', 'POST', '/api/templates/import?id=old-trips', { cookie, raw: old }).then((r) => [r.status, r.json]), [400, { error: 'That template file is in an older format. Export the template again and import the new file.' }], 'an old template file, with its sentence');
    assert.deepEqual(await as('POST', '/api/templates/import', travel.json).then((r) => [r.status, r.json]), [409, { error: 'There is already a template called travel.' }]);
    const mine = await as('POST', '/api/templates/import?id=my-trips', { ...travel.json, name: 'My trips' });
    assert.deepEqual([mine.status, mine.json.template.source, mine.json.template.name], [201, 'imported', 'My trips'], mine.text);
    assert.deepEqual((await as('GET', '/api/environment/template')).json.choices.map((c) => [c.id, c.source]), [['my-trips', 'imported'], ['games', 'bundled'], ['travel', 'bundled']]);
    assert.equal((await as('PATCH', '/api/settings', { template: 'my-trips' })).status, 200);
    assert.deepEqual(await as('DELETE', '/api/templates/my-trips').then((r) => [r.status, r.json]), [409, { error: 'This environment uses this template. Switch to another one first.' }]);
    assert.equal((await as('PATCH', '/api/settings', { template: 'travel' })).status, 200);
    assert.equal((await as('DELETE', '/api/templates/my-trips')).status, 200);
    assert.deepEqual(await as('DELETE', '/api/templates/travel').then((r) => [r.status, r.json]), [403, { error: "Bundled templates can't be deleted." }]);
    assert.deepEqual(await as('POST', '/api/templates/import', '{ not json').then((r) => [r.status, r.json]), [400, { error: `That isn't a ${PRODUCT} template file.` }]);
  });
  await server.stop();
  server = null;

  // --- a hosted server --------------------------------------------------------------------------------------------
  const hosted = path.join(base, 'hosted');
  server = await startServer(hosted, { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-1' });
  const host = cookieOf(await call(server, 'admin', 'POST', '/api/host/login', { body: { login: 'boss', password: 'host-password-1' } }));
  const console_ = (method, url, body) => call(server, 'admin', method, url, { cookie: host, body });

  await test('hosted: the host switches an environment made with no template; the plan\'s refusal is in the offer and recorded', async () => {
    const made = await console_('POST', '/api/host/environments', { slug: 'beta', name: 'Beta', plan: { modules: ['travel', 'places', 'research', 'vault', 'calendar', 'budget', 'polls', 'todo', 'stream'] }, owner: { login: 'owner', password: 'owner-password-1' } });
    assert.equal(made.status, 201, made.text);
    assert.deepEqual(await console_('PATCH', '/api/host/environments/beta', { template: 'nope' }).then((r) => [r.status, r.json]), [400, { error: 'There is no template called nope.' }]);
    assert.deepEqual(await console_('PATCH', '/api/host/environments/nope', { template: 'travel' }).then((r) => [r.status, r.json]), [404, { error: 'no such environment' }]);
    const r = await console_('PATCH', '/api/host/environments/beta', { template: 'travel' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.environment.slug, r.json.environment.template.offerOpen], ['beta', true]);
    assert.deepEqual(r.json.environment.offer.modules.find((m) => m.id === 'maps'), { id: 'maps', name: 'Maps', allowed: false, why: 'not in the plan' });
    const review = await console_('GET', '/api/host/environments/beta/template');
    assert.equal(review.status, 200, review.text);
    assert.deepEqual([review.json.template.id, review.json.template.offerOpen, review.json.offer.modules.length, review.json.choices.map((c) => c.id)], ['travel', true, r.json.environment.offer.modules.length, ['games', 'travel']], 'the console reads the offer without switching again');
    assert.deepEqual(await console_('GET', '/api/host/environments/nope/template').then((x) => [x.status, x.json]), [404, { error: 'no such environment' }]);
    assert.equal(readJson(path.join(hosted, 'environments', 'beta', 'app.json')).templateHistory.length, 1, 'reading it switched nothing');
    const shownIcon = (await call(server, 'beta', 'GET', '/api/branding')).json.homeIcon;
    assert.equal(shownIcon, 'suitcase-rolling', 'an environment made with no template shows the template\'s home icon after a switch');
    const listed = (await console_('GET', '/api/host/environments')).json.environments.find((e) => e.slug === 'beta');
    assert.deepEqual([listed.template.id, listed.template.offerOpen], ['travel', true]);
    const ids = r.json.environment.offer.modules.map((m) => m.id);
    const applied = await console_('POST', '/api/host/environments/beta/template/apply', { modules: ids, lobby: true, spaceDefaults: true });
    assert.equal(applied.status, 200, applied.text);
    assert.deepEqual(applied.json.environment.template.skipped.map((x) => [x.id, x.why]), [['maps', 'not in the plan']], 'the plan\'s refusal; Research needs no AI service, so it is not skipped');
    assert.equal(applied.json.environment.template.offerOpen, false);
    const owner = cookieOf(await call(server, 'beta', 'POST', '/api/login', { body: { login: 'owner', password: 'owner-password-1' } }));
    const lobby = (await call(server, 'beta', 'GET', '/api/spaces', { cookie: owner })).json.spaces.find((s) => s.id === 'lobby');
    assert.equal(lobby.name, 'Home base', 'the Lobby\'s name, ticked, taken');
    const home = (await call(server, 'beta', 'GET', '/api/modules/for-space?space=lobby', { cookie: owner })).json;
    assert.deepEqual(home.modules.map((m) => m.id), ['calendar'], 'the Planner is not in "Home base"');
    assert.equal(home.opensWith, null, 'Home base has no list of its own');
    assert.deepEqual(home.spaceDefaultsOpensWith, ['travel', 'chat'], 'the environment opens the Planner and chat');
    // A space's own Opens with, on a hosted environment (plan-entering.md, step 1): stored in that environment only.
    const set = await call(server, 'beta', 'PATCH', '/api/spaces/lobby', { cookie: owner, body: { opensWith: ['chat', 'travel'] } });
    assert.deepEqual([set.status, set.json.space.opensWith], [200, ['chat', 'travel']], set.text);
    assert.deepEqual((await call(server, 'beta', 'GET', '/api/modules/for-space?space=lobby', { cookie: owner })).json.opensWith, ['chat', 'travel']);
    assert.deepEqual(await call(server, 'beta', 'PATCH', '/api/spaces/lobby', { cookie: owner, body: { opensWith: 'chat' } }).then((x) => [x.status, x.json]), [400, { error: 'Opens with must be a list of modules.' }]);
    assert.equal((await call(server, 'beta', 'PATCH', '/api/spaces/lobby', { cookie: owner, body: { opensWith: null } })).status, 200);
    assert.equal((await call(server, 'beta', 'GET', '/api/modules/for-space?space=lobby', { cookie: owner })).json.opensWith, null, 'null clears it');
    assert.equal((await call(server, 'beta', 'GET', '/api/environment', { cookie: owner })).json.template.id, 'travel');
    const history = readJson(path.join(hosted, 'environments', 'beta', 'app.json')).templateHistory;
    assert.deepEqual(history.map((h) => [h.from, h.to, h.by]), [[null, 'travel', 'host']]);
    assert.equal((await console_('PATCH', '/api/host/environments/beta', { template: 'none' })).json.environment.template, null);
  });

  // plan-template-games.md: an environment made from the games template reads in its words and opens with the chat and Sessions.
  await test('hosted: an environment made from the games template has its words, names, Lobby and modules (Places and Maps offered, off)', async () => {
    const made = await console_('POST', '/api/host/environments', { slug: 'dice', name: 'Dice', template: 'games', owner: { login: 'owner', password: 'owner-password-1' } });
    assert.equal(made.status, 201, made.text);
    const owner = cookieOf(await call(server, 'dice', 'POST', '/api/login', { body: { login: 'owner', password: 'owner-password-1' } }));
    const asOwner = (method, url, body) => call(server, 'dice', method, url, { cookie: owner, body });
    for (let i = 0; i < 100 && !server.output().includes('[dice] Applied the "games" template'); i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.ok(server.output().includes('[dice] Applied the "games" template'), 'applied at creation');
    const b = (await asOwner('GET', '/api/branding')).json;
    assert.deepEqual([b.words.environment.one, b.words.space.one, b.words.home.many, b.words.owner.one, b.words.aside.one, b.words.member.one, b.words.moderator.one, b.words.guest.one], ['group', 'campaign', 'Campaigns', 'game master', 'whisper', 'player', 'moderator', 'guest']);
    assert.equal(b.homeIcon, 'dice-d20');
    assert.deepEqual(b.phases || [], [], 'no phases');
    const lobby = (await asOwner('GET', '/api/spaces')).json.spaces.find((s) => s.id === 'lobby');
    assert.deepEqual([lobby.name, lobby.description], ['Common room', 'Everyone in every campaign.']);
    const mods = (await asOwner('GET', '/api/modules')).json.modules;
    const on = (id) => mods.find((m) => m.id === id)?.enabled === true;
    for (const id of ['travel', 'calendar', 'polls', 'todo']) assert.equal(on(id), true, `${id} on`);
    for (const id of ['places', 'maps', 'budget', 'assistant']) assert.equal(on(id), false, `${id} off`);
    const campaign = await asOwner('POST', '/api/spaces', { name: 'The Ashen Crown' });
    assert.equal(campaign.status, 200, campaign.text);
    assert.equal(campaign.json.space.profile, 'roleplaying');
    const inside = (await asOwner('GET', `/api/modules/for-space?space=${campaign.json.space.id}`)).json.modules;
    const shown = Object.fromEntries(inside.filter((m) => ['travel', 'calendar', 'todo'].includes(m.id)).map((m) => [m.id, [m.name, m.icon]]));
    assert.deepEqual(shown.travel, ['Campaign planner', 'scroll']);
    assert.deepEqual([shown.calendar[0], shown.todo[0]], ['Sessions', 'Quests']);
    const home = (await asOwner('GET', '/api/modules/for-space?space=lobby')).json;
    assert.deepEqual(home.spaceDefaultsOpensWith, ['chat', 'calendar']);
    assert.equal((await asOwner('GET', '/api/settings')).json.settings.showMap, false);
    assert.equal((await console_('DELETE', '/api/host/environments/dice')).status < 500, true);
  });

  // --- addendum 2: the host's own templates and template files (#68) ------------------------------------------------
  await test('hosted: a host template is made, used, edited (live at once, a new module offered), hidden, refused deletion, exported and imported', async () => {
    const set = { 'surface-page': '#ffffff', 'surface-panel': '#f5f7f8', 'edge-hairline': '#dde3e6', 'text-primary': '#222222', 'text-muted': '#6b7479', 'accent-fill': '#1c7c8c', 'text-on-accent': '#ffffff' };
    const harbour = { id: 'harbour', name: 'Harbour', description: 'Sailing trips.', words: { space: { one: 'voyage', many: 'voyages' } }, verbs: { enter: 'Board' }, modules: ['travel', 'places', 'chat', 'conference'], reactions: [{ id: 'wave', glyph: '👋', label: 'Wave' }], theme: { name: 'Harbour', light: set, dark: null } };
    const made = await console_('POST', '/api/host/templates', harbour);
    assert.equal(made.status, 201, made.text);
    assert.deepEqual([made.json.template.source, made.json.template.version, made.json.template.hidden], ['host', 1, false]);
    assert.deepEqual(await console_('POST', '/api/host/templates', { ...harbour, id: 'travel' }).then((r) => [r.status, r.json]), [409, { error: 'There is already a template called travel.' }]);
    const bad = await console_('POST', '/api/host/templates', { ...harbour, id: 'bad', modules: ['travel'] });
    assert.deepEqual([bad.status, bad.json.error], [400, 'modules: "chat" must be listed; Chat can\'t be switched off yet.']);
    assert.equal((await console_('POST', '/api/host/environments', { slug: 'sail', name: 'Sail', template: 'harbour', owner: { login: 'owner', password: 'owner-password-1' } })).status, 201);
    const owner = cookieOf(await call(server, 'sail', 'POST', '/api/login', { body: { login: 'owner', password: 'owner-password-1' } }));
    const asOwner = (method, url, body) => call(server, 'sail', method, url, { cookie: owner, body });
    for (let i = 0; i < 100 && !server.output().includes('[sail] Applied the "harbour" template'); i += 1) await new Promise((r) => setTimeout(r, 50));
    const settings = (await asOwner('GET', '/api/settings')).json.settings;
    assert.deepEqual([settings.words.space.one, settings.reactions.map((r) => r.id), settings.template.source, settings.template.appliedVersion], ['voyage', ['wave'], 'host', 1]);
    assert.deepEqual([settings.verbs, settings.templateVerbs, settings.ownVerbs], [{ enter: 'Board', layout: 'Layout' }, { enter: 'Board' }, {}], 'the host template\'s verb');
    assert.equal((await asOwner('GET', '/api/themes')).json.themes.find((t) => t.id === settings.activeThemeId).name, 'Harbour', 'its theme added and active');
    assert.deepEqual((await asOwner('GET', '/api/modules/travel/context?scope=environment')).json.phases, [], 'no phases until the template lists them');
    const list = (await console_('GET', '/api/host/templates')).json.templates;
    assert.deepEqual(list.find((t) => t.id === 'harbour').usedBy, ['sail']);
    assert.equal(list.find((t) => t.id === 'travel').source, 'bundled');
    // An edit: the words at once, the version up, the new module offered on the Template tab, nothing forced.
    const edited = await console_('PATCH', '/api/host/templates/harbour', { words: { space: { one: 'sail', many: 'sails' } }, modules: [...harbour.modules, 'calendar'], phases: [{ id: 'planning', label: 'Planning' }, { id: 'sailing', label: 'Sailing', main: true }] });
    assert.deepEqual([edited.status, edited.json.template.version], [200, 2], edited.text);
    assert.equal((await call(server, 'sail', 'GET', '/api/branding')).json.words.space.one, 'sail', 'live at once');
    const crossing = await asOwner('POST', '/api/spaces', { name: 'Crossing' });
    assert.equal(crossing.status, 200, crossing.text);
    const inSpace = await asOwner('GET', `/api/modules/travel/context?scope=space&space=${crossing.json.space.id}`);
    assert.equal(inSpace.status, 200, inSpace.text);
    assert.deepEqual(inSpace.json.space, { id: crossing.json.space.id, name: 'Crossing', createdAt: crossing.json.space.createdAt, phases: {}, budget: null, guestsSeeHidden: false });
    assert.deepEqual(inSpace.json.phases, [{ id: 'planning', label: 'Planning' }, { id: 'sailing', label: 'Sailing', main: true }], 'a phase edit is on the next read');
    const tab = (await asOwner('GET', '/api/environment/template')).json;
    assert.deepEqual([tab.template.version, tab.template.appliedVersion, tab.template.offerOpen, tab.offer.modules.map((m) => m.id)], [2, 1, true, ['calendar']]);
    assert.equal((await asOwner('GET', '/api/modules')).json.modules.some((m) => m.id === 'calendar'), false, 'nothing forced');
    const applied = await asOwner('POST', '/api/environment/template/apply', { modules: ['calendar'] });
    assert.deepEqual([applied.status, applied.json.template.appliedVersion, applied.json.template.offerOpen], [200, 2, false]);
    const touch = await console_('PATCH', '/api/host/templates/travel', { name: 'Trips' });
    assert.equal(touch.status, 200, touch.text);
    assert.equal(touch.json.template.edited, true);
    assert.equal((await console_('DELETE', '/api/host/templates/travel/edits')).status, 200, 'the edit is reset, so the rest of this test still sees the shipped template');
    // Hidden: gone from new choices; the environment keeps it.
    assert.equal((await console_('PATCH', '/api/host/templates/harbour', { hidden: true })).json.template.version, 2, 'hiding is not a new version');
    assert.deepEqual(await console_('POST', '/api/host/environments', { slug: 'sail2', name: 'Sail 2', template: 'harbour' }).then((r) => [r.status, r.json]), [400, { error: 'There is no template called harbour.' }]);
    assert.equal((await asOwner('GET', '/api/environment/template')).json.choices.some((c) => c.id === 'harbour'), true, 'the one it has is still listed for it');
    assert.deepEqual(await console_('DELETE', '/api/host/templates/harbour').then((r) => [r.status, r.json]), [409, { error: 'Environments use this template: Sail. Hide it instead.' }]);
    // Export, then import under a new id; an import with a taken id is refused.
    const file = await console_('GET', '/api/host/templates/harbour/export');
    assert.equal(file.headers['content-disposition'], 'attachment; filename="harbour.template.json"');
    assert.deepEqual([file.json.format, file.json.formatVersion, file.json.version, file.json.theme.name], ['template', 1, 2, 'Harbour']);
    assert.equal('format' in file.json.theme, false, 'the embedded theme carries no marker');
    assert.deepEqual(await console_('POST', '/api/host/templates/import', file.json).then((r) => [r.status, r.json]), [409, { error: 'There is already a template called harbour.' }]);
    const copy = await console_('POST', '/api/host/templates/import?id=harbour-copy', { ...file.json, extra: 1 });
    assert.deepEqual([copy.status, copy.json.template.id, copy.json.template.version, copy.json.dropped], [201, 'harbour-copy', 2, ['extra']], 'the file\'s version kept');
    assert.deepEqual(await console_('POST', '/api/host/templates/import', { ...file.json, formatVersion: 2 }).then((r) => [r.status, r.json]), [400, { error: `This template was made by a newer version of ${PRODUCT}.` }]);
    for (const old of oldFiles('template')) assert.deepEqual(await call(server, 'admin', 'POST', '/api/host/templates/import?id=old-harbour', { cookie: host, raw: old }).then((r) => [r.status, r.json]), [400, { error: 'That template file is in an older format. Export the template again and import the new file.' }]);
    assert.equal((await console_('DELETE', '/api/host/templates/harbour-copy')).status, 200, 'an unused one can be deleted');
    // The template editor's theme picker asks the server about a theme file (plan-kind-names.md): read as an import
    // reads it, nothing stored, the sentence on a refusal.
    const themeText = (await asOwner('GET', '/api/themes/default/export')).text;
    const checked = await call(server, 'admin', 'POST', '/api/host/themes/check', { cookie: host, raw: themeText, type: 'application/octet-stream' });
    assert.equal(checked.status, 200, checked.text);
    // The default theme is the product's own, named by the product's short name (store.js DEFAULT_THEME); Strong Coffee is now a built-in beside the others. The test product has one word, so its short name is PRODUCT.
    assert.deepEqual([Object.keys(checked.json).sort(), Object.keys(checked.json.theme), checked.json.theme.name, checked.json.dropped], [['dropped', 'theme'], ['name', 'light', 'dark'], PRODUCT, []]);
    assert.deepEqual(checked.json.theme.dark, JSON.parse(themeText).dark, 'the colors as the file has them');
    assert.equal((await console_('POST', '/api/host/themes/check', JSON.parse(themeText))).status, 200, 'sent as JSON too');
    const themeRefusals = [
      ...oldFiles('theme').map((old) => [old, 'That theme file is in an older format. Export the theme again and import the new file.']),
      [JSON.stringify({ someTheme: 1, name: 'x', light: {}, dark: {} }), `That isn't a ${PRODUCT} theme file.`],
      [JSON.stringify({ ...JSON.parse(themeText), formatVersion: 2 }), `This theme was made by a newer version of ${PRODUCT}.`],
      ['not json', `That isn't a ${PRODUCT} theme file.`],
      [JSON.stringify({ ...JSON.parse(themeText), name: 'x'.repeat(20 * 1024) }), `That isn't a ${PRODUCT} theme file.`],
      [JSON.stringify({ format: 'theme', formatVersion: 1, name: 'Empty', light: null, dark: null }), 'This theme has no complete light or dark set: each needs all seven base colors.'],
    ];
    for (const [raw, error] of themeRefusals) {
      assert.deepEqual(await call(server, 'admin', 'POST', '/api/host/themes/check', { cookie: host, raw }).then((r) => [r.status, r.json]), [400, { error }], raw.slice(0, 40));
    }
    assert.deepEqual(await call(server, 'admin', 'POST', '/api/host/themes/check', { raw: themeText }).then((r) => [r.status, r.json]), [401, { error: 'sign in first' }], 'host admins only');
    assert.equal((await call(server, 'sail', 'POST', '/api/host/themes/check', { cookie: owner, raw: themeText })).status, 404, 'not on an environment');
    // Owners on a hosted server export only their own template; import and delete are the host's.
    const own = await asOwner('GET', '/api/templates/harbour/export');
    assert.deepEqual([own.status, own.json.id, own.json.version], [200, 'harbour', 2]);
    assert.deepEqual(await asOwner('GET', '/api/templates/travel/export').then((r) => [r.status, r.json]), [403, { error: 'On a hosted server, the host manages templates.' }]);
    assert.deepEqual(await asOwner('POST', '/api/templates/import', own.json).then((r) => [r.status, r.json]), [403, { error: 'On a hosted server, the host manages templates.' }]);
    // A newer version that changed only the words: the Template tab offers nothing (every part fingerprinted when applied).
    // Verbs are live too (addendum 4): an edit reaches branding at once and offers nothing.
    assert.equal((await console_('PATCH', '/api/host/templates/harbour', { words: { space: { one: 'crossing', many: 'crossings' } }, verbs: { enter: 'Sail into' } })).json.template.version, 3);
    assert.deepEqual((await call(server, 'sail', 'GET', '/api/branding')).json.verbs, { enter: 'Sail into', layout: 'Layout' }, 'the edited verb, at once');
    const after = (await asOwner('GET', '/api/environment/template')).json;
    assert.deepEqual([after.template.version, after.template.offerOpen, after.offer], [3, false, null], 'no offer: nothing it applies once changed');
    const card = () => console_('GET', '/api/host/environments').then((r) => r.json.environments.find((e) => e.slug === 'sail').template);
    assert.deepEqual(await card().then((t) => [t.version, t.appliedVersion, t.offerOpen]), [3, 2, false], 'the console\'s card agrees');
    assert.equal((await console_('PATCH', '/api/host/templates/harbour', { modules: [...harbour.modules, 'calendar', 'polls'] })).json.template.version, 4);
    assert.deepEqual(await card().then((t) => [t.version, t.appliedVersion, t.offerOpen]), [4, 2, true], 'a changed module list flags the card');
    // Hosted switch: the owner's own verb stays over the new template's; cleared, it is the new template's.
    assert.equal((await asOwner('PATCH', '/api/settings', { verbs: { enter: 'Cast off' } })).status, 200);
    const switched = await asOwner('PATCH', '/api/settings', { template: 'travel' });
    assert.deepEqual([switched.status, switched.json.settings.verbs, switched.json.settings.templateVerbs], [200, { enter: 'Cast off', layout: 'Layout' }, {}], switched.text);
    assert.deepEqual((await asOwner('PATCH', '/api/settings', { verbs: { enter: null } })).json.settings.verbs, { enter: 'Enter', layout: 'Layout' });
  });

  await test('hosted: the host settings list the modules the image ships, with names and icons, for the template editor', async () => {
    const mods = (await console_('GET', '/api/host/settings')).json.modules;
    assert.deepEqual(mods.slice(0, 2), [{ id: 'conference', name: 'Conference', icon: 'video' }, { id: 'chat', name: 'Chat', icon: 'message' }]);
    assert.deepEqual(mods.find((m) => m.id === 'travel'), { id: 'travel', name: 'Planner', icon: 'suitcase-rolling' });
    assert.deepEqual((await call(server, 'admin', 'GET', '/api/host/settings')).status, 401, 'host only');
  });
} finally {
  if (server) await server.stop();
  fs.rmSync(base, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-template-switch: ${failed} group${failed === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log(`check-template-switch: ${n} groups OK`);
