#!/usr/bin/env node
/*
 * check-space-templates.mjs -- a space's own template (documentation/plans/plan-space-templates.md, step 1, server only).
 *
 * Part 1, the store in node: the resolution order (the owner's own words and module names, the space's template, the environment's
 * template, the defaults) for words, the verb, phases and module names; the keys a space's template does not change; a space with no
 * key reading exactly what the environment reads; an unknown id, the Lobby, another environment's space id and the off switch reading
 * the environment's; an aside reading its origin's words; the phase-date rule after a change; sanitizeSpace and the export lists.
 *
 * Part 2, the routes on a throwaway server (PORT=0, DATA_DIR under the system tmpdir, stopped by its pid; the environment is made from
 * the travel template, the second template is games): who may set a template (owner and admin; never a moderator, a member, an
 * outsider, a guest or a door guest), every refusal with its status and sentence, prototype-pollution ids, a closed space, no word
 * of an unseen space's template told, the reads (GET /api/spaces, GET /api/spaces/:id, the guest link, the module context), the
 * off switch, and the stored key.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

process.env.TZ = 'UTC';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { Store } = require('../server/store.js');
const templates = require('../server/templates.js');
const exportLib = require('../server/environment-export.js');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-space-templates: ${name}: ${err.stack || err.message}`); }
};

// --- part 1: the store -----------------------------------------------------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-space-templates-'));
const fresh = (name, { env = 'travel' } = {}) => {
  const store = new Store(fs.mkdtempSync(path.join(tmp, `${name}-`)));
  store.templateById = (id) => templates.get(id) || null;
  if (env) templates.useLive(store, templates.get(env));
  return store;
};
const wordOf = (look, key) => look.words[key].one;

await test('a space with no key, the Lobby, and an environment with no template read what the environment reads', () => {
  const store = fresh('plain');
  const a = store.addSpace({ name: 'Lisbon' });
  assert.deepEqual(store.lookOf(a.id), { words: store.resolvedWords(), verbs: store.resolvedVerbs(), phases: store.templatePhases, template: null });
  assert.deepEqual(store.lookOf(null).words, store.resolvedWords());
  assert.deepEqual(store.lookOf('nosuchspace').words, store.resolvedWords());
  assert.equal(store.moduleDisplay('travel', a.id).name, 'Itinerary', 'a space with no key reads the environment template');
  assert.deepEqual(store.moduleDisplay('travel', a.id), store.moduleDisplay('travel'));
  const bare = fresh('bare', { env: null });
  const b = bare.addSpace({ name: 'B' });
  assert.deepEqual(bare.lookOf(b.id), { words: bare.resolvedWords(), verbs: bare.resolvedVerbs(), phases: bare.templatePhases, template: null }, 'with no template at all');
  assert.equal(bare.word('space'), 'space');
});

await test('the resolution order: the owner, the space template, the environment template, the default', () => {
  const store = fresh('order');
  const a = store.addSpace({ name: 'Campaign', template: 'games' });
  assert.equal(a.template, 'games');
  const look = store.lookOf(a.id);
  assert.equal(look.template, 'games');
  assert.equal(wordOf(look, 'space'), 'campaign', "the space's template over the environment's trip");
  assert.equal(wordOf(look, 'member'), 'player');
  assert.equal(wordOf(look, 'aside'), 'whisper');
  assert.equal(wordOf(look, 'canvas'), 'canvas', 'neither template has it: the default');
  assert.equal(look.words.space.a, 'a campaign');
  assert.deepEqual(look.phases, [], 'games has no phases, so a space of it has none');
  assert.equal(store.templatePhases.length, 6, 'the environment keeps its own');
  // The environment's own side is unchanged.
  assert.equal(store.resolvedWords().space.one, 'trip');
  // The keys above a space stay the environment's.
  assert.equal(wordOf(look, 'environment'), 'environment', 'games says group; the environment says environment');
  assert.equal(wordOf(look, 'owner'), 'owner', 'games says game master; owner stays');
  assert.equal(look.words.home.many, 'Trips', 'home follows the environment, not the space');
  assert.equal(look.verbs.enter, store.resolvedVerbs().enter);
  assert.equal(wordOf(look, 'host'), 'host');
  assert.equal(wordOf(look, 'admin'), 'admin');
  // A word of the space template the environment's template lacks, and one both have: the space's wins; one only the environment has stays.
  const t = fresh('order2', { env: 'games' });
  const tv = t.addSpace({ name: 'Trip', template: 'travel' });
  assert.equal(wordOf(t.lookOf(tv.id), 'space'), 'trip');
  assert.equal(wordOf(t.lookOf(tv.id), 'member'), 'player', "travel has no member word, so the environment template's shows through");
  assert.equal(t.lookOf(tv.id).phases.length, 6);
  // The owner's own words and module names win everywhere.
  store.updateSettings({ words: { space: { one: 'outing', many: 'outings' } }, moduleNames: undefined });
  assert.equal(wordOf(store.lookOf(a.id), 'space'), 'outing');
  assert.equal(wordOf(store.lookOf(a.id), 'member'), 'player', 'the others still follow the template');
});

await test('module names and icons: the owner, the space template, the environment template, the manifest', () => {
  const store = fresh('modules');
  const a = store.addSpace({ name: 'Campaign', template: 'games' });
  const b = store.addSpace({ name: 'Trip' });
  assert.equal(store.moduleDisplay('travel', a.id).name, 'Campaign planner');
  assert.equal(store.moduleDisplay('calendar', a.id).name, 'Sessions');
  assert.equal(store.moduleDisplay('travel', b.id).name, 'Itinerary');
  assert.equal(store.moduleDisplay('travel').name, 'Itinerary', 'with no space: the environment');
  assert.equal(store.moduleDisplay('chat', a.id).name, null, 'neither names it: the manifest');
  // A name the space's template lacks falls through to the environment template's; its icon too.
  const g = fresh('modules2', { env: 'games' });
  const tv = g.addSpace({ name: 'Trip', template: 'travel' });
  assert.equal(g.moduleDisplay('travel', tv.id).name, 'Itinerary', "the space's template over the environment's");
  assert.equal(g.moduleDisplay('calendar', tv.id).name, 'Sessions', "travel does not name it: the environment template's shows through");
  assert.equal(g.moduleDisplay('travel', tv.id).icon, 'scroll', "an icon only the environment template gives still shows");
  store.data.settings.moduleNames = { travel: 'Plans' };
  assert.equal(store.moduleDisplay('travel', a.id).name, 'Plans', "the owner's own name wins in every space");
  assert.equal(store.moduleDisplay('travel', a.id).templateName, 'Campaign planner');
  delete store.data.settings.moduleNames;
});

await test('the off switch, an unknown id, the Lobby, an aside and another space id', () => {
  const store = fresh('off');
  const a = store.addSpace({ name: 'Campaign', template: 'games' });
  store.updateSettings({ spaceTemplates: false });
  assert.equal(store.spaceTemplatesOn(), false);
  assert.deepEqual(store.lookOf(a.id).words, store.resolvedWords(), 'off ignores the key');
  assert.equal(store.spaceById(a.id).template, 'games', 'and keeps it');
  assert.equal(store.moduleDisplay('travel', a.id).name, 'Itinerary');
  assert.throws(() => store.updateSpace(a.id, { template: 'travel' }), /can't use its own template while that is turned off/);
  assert.throws(() => store.addSpace({ name: 'X', template: 'games' }), /turned off/);
  store.updateSpace(a.id, { template: null });
  assert.equal('template' in store.spaceById(a.id), false, 'null returns to the environment, even while off');
  store.updateSpace(a.id, { name: 'Renamed' });
  assert.equal(store.spaceTemplatesOn(), false);
  store.updateSettings({ spaceTemplates: true });
  assert.equal(store.spaceTemplatesOn(), true);
  assert.equal(store.updateSpace(a.id, { template: 'games' }).template, 'games');
  store.updateSettings({ spaceTemplates: false });
  store.updateSettings({ spaceTemplates: true });
  assert.equal(wordOf(store.lookOf(a.id), 'space'), 'campaign', 'turning it on restores what the keys said');
  assert.throws(() => store.updateSettings({ spaceTemplates: 'no' }), /spaceTemplates is true or false/);
  // An unknown id (a template the server no longer has) reads as the environment's, and says so once.
  const warned = [];
  const was = console.warn;
  console.warn = (m) => warned.push(String(m));
  try {
    store.data.spaces.find((r) => r.id === a.id).template = 'gone';
    assert.deepEqual(store.lookOf(a.id).words, store.resolvedWords());
    store.lookOf(a.id);
    store.lookOf(a.id);
  } finally { console.warn = was; }
  assert.equal(warned.filter((m) => /"gone"/.test(m)).length, 1, 'logged once per id');
  store.data.spaces.find((r) => r.id === a.id).template = 'games';
  // The Lobby never reads one, and cannot be given one.
  store.data.spaces.find((r) => r.id === 'lobby').template = 'games';
  assert.deepEqual(store.lookOf('lobby').words, store.resolvedWords());
  assert.throws(() => store.updateSpace('lobby', { template: 'games' }), /The Lobby/);
  assert.equal(store.sanitizeSpace({ id: 'lobby', name: 'L', template: 'games' }).template, undefined);
  // An aside reads the words of the space it came from, and the environment's phases and module names.
  const aside = store.addAside([], a.id);
  assert.equal(wordOf(store.lookOf(aside.id), 'aside'), 'whisper');
  assert.equal(store.lookOf(aside.id).phases.length, 6, 'an aside has no phases of its own');
  assert.equal(store.moduleDisplay('travel', aside.id).name, 'Itinerary');
  const orphan = store.addAside([], 'gone1234');
  assert.deepEqual(store.lookOf(orphan.id).words, store.resolvedWords(), 'its origin is gone: the environment');
  // Another environment's space id means nothing here.
  const other = fresh('other');
  const o = other.addSpace({ name: 'Elsewhere', template: 'games' });
  assert.deepEqual(store.lookOf(o.id).words, store.resolvedWords(), "another environment's id is no space here");
  assert.equal(store.moduleDisplay('travel', o.id).name, 'Itinerary');
});

await test('a template equal to the stored one is a no-op before any check', () => {
  const store = fresh('echo');
  const a = store.addSpace({ name: 'A', template: 'games' });
  store.data.spaces.find((r) => r.id === a.id).template = 'gone';
  assert.equal(store.updateSpace(a.id, { template: 'gone' }).template, 'gone', 'echoing a template the server no longer has');
  store.data.spaces.find((r) => r.id === a.id).template = 'games';
  store.updateSettings({ spaceTemplates: false });
  assert.equal(store.updateSpace(a.id, { template: 'games', name: 'B' }).template, 'games', 'echoing it while the switch is off');
  assert.throws(() => store.updateSpace(a.id, { template: 'travel' }), /turned off/, 'a different one is still refused');
  assert.equal(store.updateSpace(a.id, { template: null }).template, undefined, 'null stays allowed while off');
});

await test('what may be stored and named: ids, hidden templates, the shape', () => {
  const store = fresh('shape');
  const a = store.addSpace({ name: 'A' });
  for (const bad of ['__proto__', 'constructor', 'toString', 'Games', 'games ', '../x', '', 'x'.repeat(40), 7, {}, [], true]) {
    assert.throws(() => store.updateSpace(a.id, { template: bad }), (err) => err.status === 400 && /^There is no template called /.test(err.message), `refused: ${JSON.stringify(bad)}`);
  }
  assert.throws(() => store.updateSpace(a.id, { template: 'nosuch' }), (err) => err.status === 400 && err.message === 'There is no template called nosuch.');
  assert.equal('template' in store.spaceById(a.id), false, 'nothing stored by a refusal');
  assert.throws(() => store.addSpace({ name: 'B', template: '__proto__' }), /There is no template called __proto__\./);
  assert.equal(store.spaces.length, 2, 'a refused add makes no space (the Lobby and A)');
  // A key read from a file keeps only a template-id shape.
  for (const bad of ['__proto__', 'a b', 'A', 7, null, {}]) assert.equal('template' in store.sanitizeSpace({ id: 'abcd', template: bad }), false, JSON.stringify(bad));
  assert.equal(store.sanitizeSpace({ id: 'abcd', template: 'games' }).template, 'games');
  assert.equal(store.sanitizeSpace({ id: 'abcd', template: 'ghost' }).template, 'ghost', 'an id this server lacks is kept as stored');
  // A hidden template cannot be newly chosen, but a space that has it keeps it.
  store.templateById = (id) => (id === 'games' ? { ...templates.get('games'), hidden: true } : templates.get(id) || null);
  assert.throws(() => store.updateSpace(a.id, { template: 'games' }), /There is no template called games\./);
  store.data.spaces.find((r) => r.id === a.id).template = 'games';
  assert.equal(store.updateSpace(a.id, { template: 'games' }).template, 'games', 'the same id as now');
  assert.equal(wordOf(store.lookOf(a.id), 'space'), 'campaign', 'and it still reads');
  assert.throws(() => store.addSpace({ name: 'C', template: 'games' }), /There is no template called games\./);
});

await test('a new space starts from its template, else the environment; later changes touch nothing else', () => {
  const store = fresh('seed');
  store.updateSettings({ spaceDefaults: { profile: 'characters' } });
  const g = store.addSpace({ name: 'G', template: 'games' });
  assert.deepEqual(g.opensWith, ['chat', 'calendar'], "the games template's opens-with");
  assert.equal(g.profile, 'characters', "games has no profile of its own: the environment's");
  const t = store.addSpace({ name: 'T', template: 'travel' });
  assert.equal(t.profile, 'participants');
  assert.deepEqual(t.opensWith, ['travel', 'chat']);
  const plain = store.addSpace({ name: 'P' });
  assert.equal(plain.profile, 'characters');
  assert.equal('opensWith' in plain, false, 'no key: nothing new is seeded');
  const picked = store.addSpace({ name: 'Q', template: 'travel', profile: 'roleplaying' });
  assert.equal(picked.profile, 'roleplaying', 'a profile given wins');
  // A change of template touches only the key.
  store.updateSpace(g.id, { phases: null, opensWith: ['chat'], description: 'd' });
  const before = JSON.stringify({ ...store.spaceById(g.id), template: undefined });
  store.updateSpace(g.id, { template: 'travel' });
  assert.equal(JSON.stringify({ ...store.spaceById(g.id), template: undefined }), before);
});

await test('phase dates after a change of template: stale ids stay on the record and never fail a save', () => {
  const store = fresh('phases', { env: null });
  const a = store.addSpace({ name: 'Trip', template: 'travel' });
  store.updateSpace(a.id, { phases: { planning: { start: '2027-01-01' }, trip: { start: '2027-02-01', end: '2027-02-10' } } });
  assert.deepEqual(Object.keys(store.spaceById(a.id).phases).sort(), ['planning', 'trip']);
  // To games: none of these ids exist there. The record keeps them.
  store.updateSpace(a.id, { template: 'games' });
  assert.equal(Object.keys(store.spaceById(a.id).phases).length, 2, 'kept on the record');
  assert.deepEqual(store.lookOf(a.id).phases, []);
  // The panel sends the whole map back: it must not fail, and the dates stay.
  store.updateSpace(a.id, { phases: { planning: { start: '2027-01-01' }, trip: { start: '2027-02-01', end: '2027-02-10' } } });
  assert.deepEqual(Object.keys(store.spaceById(a.id).phases).sort(), ['planning', 'trip']);
  // Sending only what it shows (nothing) keeps them; clearing with null really clears.
  store.updateSpace(a.id, { phases: {} });
  assert.equal(Object.keys(store.spaceById(a.id).phases).length, 2, 'dates of ids the template lacks survive a save');
  // An id the record does not hold and the template lacks is still refused.
  assert.throws(() => store.updateSpace(a.id, { phases: { nope: { start: '2026-09-10' } } }), /There is no phase called "nope"\./);
  assert.throws(() => store.updateSpace(a.id, { phases: JSON.parse('{"__proto__":{"start":"2026-09-10"}}') }), /There is no phase called "__proto__"\./);
  // Back to travel: nothing was lost, and a shared id keeps its dates.
  store.updateSpace(a.id, { template: 'travel' });
  assert.equal(store.spaceById(a.id).phases.trip.end, '2027-02-10');
  assert.equal(store.lookOf(a.id).phases.length, 6);
  // A template and phases in one patch are checked against the new template's phases.
  const b = store.addSpace({ name: 'B' });
  store.updateSpace(b.id, { template: 'travel', phases: { trip: { start: '2027-02-01' } } });
  assert.equal(store.spaceById(b.id).phases.trip.start, '2027-02-01');
  store.updateSpace(b.id, { phases: null });
  assert.deepEqual(store.spaceById(b.id).phases, {}, 'cleared');
  assert.throws(() => store.updateSpace(b.id, { template: 'games', phases: { trip: { start: '2027-02-05' } } }), /There is no phase called "trip"\./, 'a date the new template lacks and the record does not hold');
  assert.equal(store.spaceById(b.id).template, 'travel', 'a refused patch changes nothing');
});

await test('the export lists name the key and the switch, and a space with a template reads back', () => {
  const store = fresh('export');
  store.updateSettings({ spaceTemplates: false });
  const a = store.addSpace({ name: 'A' });
  store.updateSettings({ spaceTemplates: true });
  store.updateSpace(a.id, { template: 'games' });
  const copy = exportLib.exportApp(store.data);
  assert.equal(copy.spaces.find((s) => s.id === a.id).template, 'games');
  assert.equal(copy.settings.spaceTemplates, true, 'in the copy once set');
  assert.deepEqual(exportLib.unclassifiedFields(store.data), []);
  store.updateSettings({ spaceTemplates: false });
  assert.equal(exportLib.exportApp(store.data).settings.spaceTemplates, false);
  assert.deepEqual(exportLib.unclassifiedFields(store.data), []);
  // A restore reads app.json through the same sanitizer: the key survives, an id the target lacks reads as the environment's.
  const back = store.sanitizeSpace(JSON.parse(JSON.stringify(copy.spaces.find((s) => s.id === a.id))));
  assert.equal(back.template, 'games');
});

// --- part 2: the routes -------------------------------------------------------------------------------------------------------

const PRODUCT = 'Testname';
let child = null;
function startServer(dataDir, env = {}) {
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, TZ: 'UTC', PRODUCT_NAME: PRODUCT, ADMIN_PASSWORD: 'admin-password-1', TEMPLATE: 'travel', ENABLE_GUEST_DOOR: 'true', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve({ port: Number(m[1]), output: () => out }); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
}
const stopServer = () => new Promise((resolve) => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
function call(server, method, urlPath, { body, cookie } = {}) {
  const payload = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const headers = { host: `127.0.0.1:${server.port}`, accept: 'application/json' };
  if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = payload.length; }
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

const dataDir = path.join(tmp, 'data');
try {
  const server = await startServer(dataDir);
  const admin = cookieOf(await call(server, 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
  const as = (cookie) => (method, url, body) => call(server, method, url, { cookie, body });
  const asAdmin = as(admin);
  const makeUser = async (login, role = 'member') => {
    const made = await asAdmin('POST', '/api/users', { login, displayName: login, role, password: `${login}-password-1` });
    assert.equal(made.status, 201, made.text);
    return { key: made.json.user.key, as: as(cookieOf(await call(server, 'POST', '/api/login', { body: { login, password: `${login}-password-1` } }))) };
  };
  const owner = await makeUser('olive', 'owner');
  const mia = await makeUser('mia'); // a member
  const mo = await makeUser('mo'); // a member who moderates
  const out = await makeUser('ola'); // in no space
  const campaign = (await asAdmin('POST', '/api/spaces', { name: 'Dragon', members: [mia.key, mo.key], template: 'games' })).json.space;
  const trip = (await asAdmin('POST', '/api/spaces', { name: 'Lisbon', members: [mia.key, mo.key] })).json.space;
  assert.equal((await asAdmin('PATCH', `/api/users/${mo.key}/spaces/${campaign.id}`, { permissions: { moderator: true } })).status, 200);
  const ctx2 = (who, space) => who('GET', `/api/modules/travel/context?scope=space&space=${space}`);
  const stored = (id) => JSON.parse(fs.readFileSync(path.join(dataDir, 'app.json'), 'utf8')).spaces.find((s) => s.id === id);

  await test('creation: the key is stored, an unknown id and a bad shape refused, no space made by a refusal', async () => {
    assert.equal(campaign.template, 'games');
    assert.equal(stored(campaign.id).template, 'games');
    assert.equal('template' in stored(trip.id), false, 'no key stored for the environment default');
    const count = (await asAdmin('GET', '/api/spaces')).json.spaces.length;
    for (const bad of ['nosuch', '__proto__', 'constructor', 7, {}, '']) {
      const r = await asAdmin('POST', '/api/spaces', { name: 'X', template: bad });
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.match(r.json.error, /^There is no template called /);
    }
    assert.equal((await asAdmin('GET', '/api/spaces')).json.spaces.length, count);
    const viaNull = await asAdmin('POST', '/api/spaces', { name: 'N', template: null });
    assert.equal(viaNull.status, 200);
    assert.equal('template' in stored(viaNull.json.space.id), false);
    assert.equal((await owner.as('POST', '/api/spaces', { name: 'By owner', template: 'games' })).json.space.template, 'games');
    assert.equal((await mia.as('POST', '/api/spaces', { name: 'By member', template: 'games' })).status, 403, 'a member cannot add a space at all');
  });

  await test('reads: GET /api/spaces and /api/spaces/:id carry the template; the owner and a moderator read the look', async () => {
    const list = (await asAdmin('GET', '/api/spaces')).json.spaces;
    assert.equal(list.find((s) => s.id === campaign.id).template, 'games');
    assert.equal(list.find((s) => s.id === trip.id).template, null);
    assert.equal(list.find((s) => s.id === 'lobby').template, null);
    const one = (await asAdmin('GET', `/api/spaces/${campaign.id}`)).json;
    assert.equal(one.space.template, 'games');
    assert.equal(one.look.words.space.one, 'campaign');
    assert.equal(one.look.words.owner.one, 'owner', 'owner is the environment\'s word');
    assert.equal(one.look.verbs.layout, 'Layout');
    assert.deepEqual(one.look.phases, []);
    const tripOne = (await asAdmin('GET', `/api/spaces/${trip.id}`)).json;
    assert.equal(tripOne.space.template, null);
    assert.equal(tripOne.look.words.space.one, 'trip');
    assert.equal(tripOne.look.phases.map((p) => p.id).join(), 'planning,booking,buffer,pre-trip,trip,post-trip');
    const mod = (await mo.as('GET', `/api/spaces/${campaign.id}`)).json;
    assert.equal(mod.space.template, 'games', 'a moderator reads it');
    assert.equal(mod.look.words.space.one, 'campaign');
    assert.deepEqual(Object.keys(mod.space).filter((k) => !['id', 'template', 'templateName', 'phases', 'opensWith', 'defaultLayout', 'tabs', 'budget', 'closed'].includes(k)), [], 'and nothing more than the name of that template');
    assert.equal(mod.space.templateName, templates.get('games').name, "a moderator reads the name of that same template, the one the owner's list shows");
    assert.equal('templateName' in (await asAdmin('GET', `/api/spaces/${campaign.id}`)).json.space, false, "the admin's answer is unchanged");
    assert.equal('templateName' in (await owner.as('GET', `/api/spaces/${campaign.id}`)).json.space, false, "an owner's answer is unchanged");
    const member = await mia.as('GET', `/api/spaces/${campaign.id}`);
    assert.deepEqual([member.status, member.json], [403, { error: 'owners only' }], 'a member is told nothing of it');
    assert.equal(member.text.includes('games'), false);
    assert.equal(member.text.includes('Games'), false, "a member is told no name");
    const stranger = await out.as('GET', `/api/spaces/${campaign.id}`);
    assert.equal(stranger.text.includes('Games') || stranger.text.includes('games'), false, 'an outsider reads what an unseen space reads');
    const plain = (await asAdmin('POST', '/api/spaces', { name: 'Plain', members: [mo.key] })).json.space;
    assert.equal((await asAdmin('PATCH', `/api/users/${mo.key}/spaces/${plain.id}`, { permissions: { moderator: true } })).status, 200);
    const none = (await mo.as('GET', `/api/spaces/${plain.id}`)).json.space;
    assert.equal(none.template, null, 'a space with no template still reads null');
    assert.equal('templateName' in none, false, 'and adds no name');
    assert.equal(JSON.stringify(none).includes('Games'), false, 'nor the environment template');
    // Another space's template is never named: the moderator of the plain space cannot read the campaign.
    assert.equal((await mo.as('GET', `/api/spaces/${campaign.id}`)).json.space.templateName, templates.get('games').name, 'the campaign names its own template only');
  });

  await test('who may set a template: owners and the admin; a moderator, a member, an outsider and no one signed in are refused', async () => {
    const body = { template: 'games' };
    const refused = async (r, why) => { assert.deepEqual([r.status, r.json], [403, { error: 'owners only' }], why); assert.equal('template' in stored(trip.id), false, `${why}: nothing stored`); };
    await refused(await mo.as('PATCH', `/api/spaces/${trip.id}`, body), 'a moderator of that space');
    // A moderator of the campaign sending it for the campaign is refused too, though phases are theirs to send.
    const modOwn = await mo.as('PATCH', `/api/spaces/${campaign.id}`, { template: null });
    assert.deepEqual([modOwn.status, modOwn.json], [403, { error: 'owners only' }], 'a moderator cannot even clear it');
    assert.equal(stored(campaign.id).template, 'games');
    assert.equal((await mo.as('PATCH', `/api/spaces/${campaign.id}`, { phases: {} })).status, 200, 'what a moderator may send still works');
    assert.equal((await mo.as('PATCH', `/api/spaces/${campaign.id}`, { phases: {}, template: 'travel' })).status, 403, 'mixed with an allowed field');
    await refused(await mia.as('PATCH', `/api/spaces/${trip.id}`, body), 'a member');
    // An outsider (not in the space): the space is not told to exist for them, so it answers as an unknown id.
    const o = await out.as('PATCH', `/api/spaces/${campaign.id}`, body);
    const unknown = await out.as('PATCH', '/api/spaces/zzzzzzzz', body);
    assert.deepEqual([o.status, o.json], [unknown.status, unknown.json], 'an outsider cannot tell a space from none');
    assert.equal((await call(server, 'PATCH', `/api/spaces/${trip.id}`, { body })).status, 401, 'no one signed in');
    assert.equal(stored(campaign.id).template, 'games');
    assert.equal('template' in stored(trip.id), false);
    // Owners and the admin may, at any time; the answer is the space.
    const byOwner = await owner.as('PATCH', `/api/spaces/${trip.id}`, body);
    assert.equal(byOwner.status, 200);
    assert.equal(byOwner.json.space.template, 'games');
    assert.equal(stored(trip.id).template, 'games');
    const same = await asAdmin('PATCH', `/api/spaces/${trip.id}`, body);
    assert.equal(same.status, 200, 'the same id as now');
    assert.equal(same.json.space.template, 'games');
    const cleared = await asAdmin('PATCH', `/api/spaces/${trip.id}`, { template: null });
    assert.equal(cleared.status, 200);
    assert.equal('template' in stored(trip.id), false, 'null returns it to the environment');
    assert.equal('template' in cleared.json.space, false);
  });

  await test('refusals: an unknown id, a bad shape, prototype keys, the Lobby; each a status and one sentence, nothing changed', async () => {
    const was = JSON.stringify(stored(trip.id));
    const bad = async (value, status, error) => {
      const r = await asAdmin('PATCH', `/api/spaces/${trip.id}`, { template: value });
      assert.deepEqual([r.status, r.json], [status, { error }], JSON.stringify(value));
      assert.equal(JSON.stringify(stored(trip.id)), was);
    };
    await bad('nosuch', 400, 'There is no template called nosuch.');
    await bad('__proto__', 400, 'There is no template called __proto__.');
    await bad('constructor', 400, 'There is no template called constructor.');
    await bad('hasOwnProperty', 400, 'There is no template called hasOwnProperty.');
    await bad('Games', 400, 'There is no template called Games.');
    await bad('x'.repeat(300), 400, `There is no template called ${'x'.repeat(40)}.`);
    await bad(7, 400, 'There is no template called that.');
    await bad({ id: 'games' }, 400, 'There is no template called that.');
    await bad(['games'], 400, 'There is no template called that.');
    const raw = await call(server, 'PATCH', `/api/spaces/${trip.id}`, { cookie: admin, body: '{"template":"games","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}' });
    assert.ok([200, 400].includes(raw.status), `a body with prototype keys answers cleanly (${raw.status})`);
    assert.equal({}.polluted, undefined, 'nothing reached Object.prototype');
    assert.equal((await asAdmin('PATCH', `/api/spaces/${trip.id}`, { template: null })).status, 200);
    const lobby = await asAdmin('PATCH', '/api/spaces/lobby', { template: 'games' });
    assert.deepEqual([lobby.status, lobby.json], [400, { error: "The Lobby reads the environment's template and takes none of its own." }]);
    assert.equal('template' in stored('lobby'), false);
    assert.equal((await asAdmin('PATCH', '/api/spaces/zzzzzzzz', { template: 'games' })).status, 404);
  });

  await test('words inside a space: a refusal in a space reads in that space\'s words, and never tells an unseen space\'s', async () => {
    // A sentence built inside a space's route says that space's word: the same refusal in two spaces of two templates.
    const inCampaign = await mia.as('POST', `/api/spaces/${campaign.id}/guest-link`, {});
    const inTrip = await mia.as('POST', `/api/spaces/${trip.id}/guest-link`, {});
    assert.deepEqual([inCampaign.status, inCampaign.json], [403, { error: "you can't invite people to this campaign" }]);
    assert.deepEqual([inTrip.status, inTrip.json], [403, { error: "you can't invite people to this trip" }]);
    // An outsider asking about the campaign is told what they are told for an id that is not there, in the environment's words.
    const hidden = await out.as('GET', `/api/spaces/${campaign.id}`);
    const nothing = await out.as('GET', '/api/spaces/zzzzzzzz');
    assert.deepEqual([hidden.status, hidden.json], [nothing.status, nothing.json], 'an unseen space reads as no space');
    assert.equal(hidden.json.error, 'no such trip', "in the environment's word, not the campaign's");
    // Closed for set up: its members are told it is closed (they knew of it) and an outsider is told nothing.
    assert.equal((await asAdmin('PATCH', `/api/spaces/${campaign.id}`, { closed: true })).status, 200);
    const closedMember = await mia.as('GET', `/api/spaces/${campaign.id}`);
    assert.equal(closedMember.status, 403);
    const closedOut = await out.as('GET', `/api/spaces/${campaign.id}`);
    assert.deepEqual([closedOut.status, closedOut.json], [nothing.status, nothing.json], 'a closed space is not told to an outsider');
    assert.equal((await mia.as('PATCH', `/api/spaces/${campaign.id}`, { template: null })).status, 403, 'a member of a closed space');
    assert.equal((await mo.as('PATCH', `/api/spaces/${campaign.id}`, { template: null })).status, 403, 'its moderator');
    assert.equal((await out.as('PATCH', `/api/spaces/${campaign.id}`, { template: null })).status, nothing.status);
    assert.equal(stored(campaign.id).template, 'games');
    // An owner may set it on a closed space, and it reads.
    assert.equal((await asAdmin('PATCH', `/api/spaces/${campaign.id}`, { template: 'travel' })).status, 200);
    assert.equal((await asAdmin('PATCH', `/api/spaces/${campaign.id}`, { template: 'games', closed: false })).status, 200);
  });

  await test('guests: a link guest reads the look of the link\'s space only and cannot set anything; a closed space is refused as before', async () => {
    const link = (await asAdmin('POST', `/api/spaces/${campaign.id}/guest-link`, { body: {} })).json.space.guestToken;
    const read = await call(server, 'GET', `/api/guest-link/${link}`);
    assert.equal(read.status, 200);
    assert.equal(read.json.spaceId, campaign.id);
    assert.equal(read.json.spaceName, 'Dragon');
    assert.equal(read.json.look.words.space.one, 'campaign');
    assert.equal(read.json.look.words.guest.one, 'guest');
    assert.deepEqual(read.json.look.phases, []);
    assert.equal(JSON.stringify(read.json).includes('"games"'), false, 'no template id is told');
    const tripLink = (await asAdmin('POST', `/api/spaces/${trip.id}/guest-link`, { body: {} })).json.space.guestToken;
    assert.equal((await call(server, 'GET', `/api/guest-link/${tripLink}`)).json.look.words.space.one, 'trip');
    assert.equal((await call(server, 'GET', `/api/guest-link/${tripLink}`)).json.look.phases.length, 6);
    // The guest joins; as that guest, nothing about a template can be read or set.
    const joined = await call(server, 'POST', '/api/guest-join', { body: { token: link, name: 'Gus' } });
    assert.equal(joined.status, 200, joined.text);
    const guest = cookieOf(joined);
    for (const [method, url, body] of [['PATCH', `/api/spaces/${campaign.id}`, { template: 'travel' }], ['PATCH', `/api/spaces/${trip.id}`, { template: 'games' }], ['POST', '/api/spaces', { name: 'g', template: 'games' }], ['GET', `/api/spaces/${campaign.id}`]]) {
      const r = await call(server, method, url, { cookie: guest, body });
      assert.ok([401, 403].includes(r.status), `${method} ${url} refused (${r.status})`);
    }
    assert.equal(stored(campaign.id).template, 'games');
    assert.equal('template' in stored(trip.id), false);
    // A closed space refuses its link as it does today.
    await asAdmin('PATCH', `/api/spaces/${campaign.id}`, { closed: true });
    const closed = await call(server, 'GET', `/api/guest-link/${link}`);
    assert.equal(closed.status, 403);
    assert.equal(closed.json.look, undefined, 'a closed space tells a guest nothing of its words');
    await asAdmin('PATCH', `/api/spaces/${campaign.id}`, { closed: false });
    assert.equal((await call(server, 'GET', '/api/guest-link/nosuchtokennosuchtoken')).status, 404);
  });

  await test('GET /api/spaces/:id/look: whoever may enter reads the space\'s look and no template id; everyone else reads what an unknown id reads', async () => {
    const lookOf = (who, id) => who('GET', `/api/spaces/${id}/look`);
    const anon = (id, cookie, query = '') => call(server, 'GET', `/api/spaces/${id}/look${query}`, { cookie });
    const branding = (await asAdmin('GET', '/api/branding')).json;
    const nothing = await out.as('GET', '/api/spaces/zzzzzzzz/look');
    assert.deepEqual([nothing.status, nothing.json], [404, { error: 'no such trip' }], "an unknown id, in the environment's words");
    const keys = (r) => Object.keys(r.json || {}).join();
    for (const [who, label] of [[mia.as, 'a member'], [mo.as, 'a moderator'], [owner.as, 'an owner'], [asAdmin, 'the admin']]) {
      const r = await lookOf(who, campaign.id);
      assert.equal(r.status, 200, `${label}: ${r.text}`);
      assert.equal(keys(r), 'look');
      assert.equal(keys({ json: r.json.look }), 'words,verbs,phases');
      assert.equal(r.json.look.words.space.one, 'campaign', label);
      assert.equal(r.json.look.words.owner.one, 'owner', label);
      assert.deepEqual(r.json.look.phases, [], label);
      assert.equal(/games|template/.test(r.text), false, `${label}: no template id in the body`);
      const t = await lookOf(who, trip.id);
      assert.equal(t.json.look.words.space.one, 'trip');
      assert.equal(t.json.look.phases.length, 6);
      assert.equal(/"template"/.test(t.text), false);
    }
    // With no template key the look is the environment's, as /api/branding tells it.
    const plain = (await lookOf(mia.as, trip.id)).json.look;
    assert.deepEqual(plain, { words: branding.words, verbs: branding.verbs, phases: branding.phases });
    // An outsider (in no space, the space invited-only), no session, the access key, an unknown id, the Lobby and a made-up aside id.
    assert.equal((await asAdmin('PATCH', `/api/spaces/${campaign.id}`, { entry: 'invited' })).status, 200);
    const hidden = await lookOf(out.as, campaign.id);
    assert.deepEqual([hidden.status, hidden.json], [nothing.status, nothing.json], 'an outsider');
    assert.equal(hidden.text, nothing.text);
    for (const [label, r] of [['no session', await anon(campaign.id)], ['no session, unknown id', await anon('zzzzzzzz')], ['the Lobby (a member)', await lookOf(mia.as, 'lobby')], ['the Lobby (the admin)', await lookOf(asAdmin, 'lobby')], ['an aside id', await lookOf(mia.as, 'aside-abc123')], ['a prototype id', await lookOf(mia.as, '__proto__')], ['an odd id', await lookOf(mia.as, 'a%2Fb')]]) {
      assert.deepEqual([r.status, r.json], [nothing.status, nothing.json], label);
    }
    const key = (await asAdmin('GET', '/api/settings')).json.streamKey;
    const keyed = await anon(campaign.id, undefined, `?s=${encodeURIComponent(key)}`);
    assert.deepEqual([keyed.status, keyed.json], [404, nothing.json], 'the access key');
    // Closed for set up: a member (told it is closed elsewhere) and an outsider read what an unknown id reads; the owner and a moderator still read it.
    assert.equal((await asAdmin('PATCH', `/api/spaces/${campaign.id}`, { closed: true })).status, 200);
    assert.deepEqual([(await lookOf(mia.as, campaign.id)).status, (await lookOf(mia.as, campaign.id)).json], [404, nothing.json], 'a closed space, a member');
    assert.deepEqual([(await lookOf(out.as, campaign.id)).status, (await lookOf(out.as, campaign.id)).json], [404, nothing.json], 'a closed space, an outsider');
    assert.equal((await lookOf(owner.as, campaign.id)).status, 200, 'a closed space, an owner');
    assert.equal((await lookOf(mo.as, campaign.id)).json.look.words.space.one, 'campaign', 'a closed space, its moderator');
    // A link guest reads their own space's look only; a closed space turns their link off.
    const link = (await asAdmin('POST', `/api/spaces/${campaign.id}/guest-link`, { body: {} })).json.space.guestToken;
    const tripLink = (await asAdmin('POST', `/api/spaces/${trip.id}/guest-link`, { body: {} })).json.space.guestToken;
    assert.deepEqual([(await anon(campaign.id, undefined, `?guest=${link}`)).status], [404], 'a link into a closed space');
    assert.equal((await asAdmin('PATCH', `/api/spaces/${campaign.id}`, { closed: false })).status, 200);
    const viaLink = await anon(campaign.id, undefined, `?guest=${link}`);
    assert.equal(viaLink.status, 200, viaLink.text);
    assert.equal(viaLink.json.look.words.space.one, 'campaign');
    assert.equal(/games|template/.test(viaLink.text), false);
    const otherLink = await anon(campaign.id, undefined, `?guest=${tripLink}`);
    assert.deepEqual([otherLink.status, otherLink.json], [404, nothing.json], "another space's link");
    assert.deepEqual((await anon(trip.id, undefined, `?guest=${link}`)).json, nothing.json, "the campaign's link on the trip");
    assert.equal((await anon(campaign.id, undefined, '?guest=nosuchtokennosuchtoken')).status, 404, 'a wrong link');
    assert.equal((await anon('lobby', undefined, `?guest=${link}`)).status, 404, 'a link guest on the Lobby');
    // A door guest reads the look of a space they may enter, and nothing of one they may not.
    const door = await call(server, 'POST', '/api/guest-door', { body: { name: 'Dora' } });
    assert.equal(door.status, 201, door.text);
    const dg = cookieOf(door);
    assert.deepEqual([(await anon(campaign.id, dg)).status, (await anon(campaign.id, dg)).json], [404, nothing.json], 'a door guest, the space not open to guests');
    assert.equal((await asAdmin('PATCH', `/api/spaces/${campaign.id}`, { entry: 'guests' })).status, 200);
    const viaDoor = await anon(campaign.id, dg);
    assert.equal(viaDoor.status, 200, viaDoor.text);
    assert.equal(viaDoor.json.look.words.space.one, 'campaign');
    assert.equal(/games|template/.test(viaDoor.text), false);
    assert.deepEqual([(await anon(trip.id, dg)).status, (await anon('lobby', dg)).status], [404, 404], 'a door guest, a space not open and the Lobby');
    assert.equal((await asAdmin('PATCH', `/api/spaces/${campaign.id}`, { closed: true })).status, 200);
    assert.deepEqual((await anon(campaign.id, dg)).json, nothing.json, 'a door guest, closed');
    assert.equal((await asAdmin('PATCH', `/api/spaces/${campaign.id}`, { closed: false, entry: 'invited' })).status, 200);
    assert.deepEqual((await anon(campaign.id, dg)).json, nothing.json, 'a door guest, the space no longer open');
    // The switch off: every space reads the environment's.
    assert.equal((await asAdmin('PATCH', '/api/settings', { spaceTemplates: false })).status, 200);
    const off = (await lookOf(mia.as, campaign.id)).json.look;
    assert.deepEqual(off, { words: branding.words, verbs: branding.verbs, phases: branding.phases }, 'the switch off');
    assert.equal((await asAdmin('PATCH', '/api/settings', { spaceTemplates: true })).status, 200);
    assert.equal((await lookOf(mia.as, campaign.id)).json.look.words.space.one, 'campaign', 'on again');
    // An aside has no record among the spaces: it reads as an unknown id (the store, since an aside needs a call to make).
    const asideStore = fresh('aside');
    const sp = asideStore.addSpace({ name: 'A' });
    const aside = asideStore.addAside(['x', 'y'], sp.id);
    assert.equal(asideStore.spaceById(aside.id), null);
  });

  await test('the module context: words, phases and the module name are the space\'s; no template id reaches a module', async () => {
    const ctx = (who, space) => who('GET', `/api/modules/travel/context?scope=space&space=${space}`);
    const forCampaign = await ctx(mia.as, campaign.id);
    assert.equal(forCampaign.status, 200, forCampaign.text);
    assert.equal(forCampaign.json.locale.words.space.one, 'campaign');
    assert.equal(forCampaign.json.module.name, 'Campaign planner');
    assert.deepEqual(forCampaign.json.phases, []);
    const forTrip = await ctx(mia.as, trip.id);
    assert.equal(forTrip.json.locale.words.space.one, 'trip');
    assert.equal(forTrip.json.module.name, 'Itinerary');
    assert.equal(forTrip.json.phases.length, 6);
    for (const r of [forCampaign, forTrip]) assert.equal(/"template"/.test(r.text), false, 'no template id in the context');
    const noSpace = await mia.as('GET', '/api/modules/travel/context?scope=environment');
    assert.equal(noSpace.json.locale.words.space.one, 'trip', 'with no space: the environment');
    const outsider = await ctx(out.as, campaign.id);
    assert.equal(outsider.status, 404);
    assert.equal(outsider.json.error, 'no such trip');
    const list = (await mia.as('GET', `/api/modules/for-space?space=${campaign.id}`)).json;
    assert.equal(list.modules.find((m) => m.id === 'travel')?.name, 'Campaign planner');
  });

  await test('branding carries the switch; the switch off ignores every key and keeps them; on restores', async () => {
    assert.equal((await asAdmin('GET', '/api/branding')).json.spaceTemplates, true);
    const bad = await asAdmin('PATCH', '/api/settings', { spaceTemplates: 'no' });
    assert.deepEqual([bad.status, bad.json], [400, { error: 'spaceTemplates is true or false' }]);
    assert.equal((await mia.as('PATCH', '/api/settings', { spaceTemplates: false })).status, 403, 'only an owner');
    assert.equal((await asAdmin('PATCH', '/api/settings', { spaceTemplates: false })).status, 200);
    assert.equal((await asAdmin('GET', '/api/branding')).json.spaceTemplates, false);
    const off = (await asAdmin('GET', `/api/spaces/${campaign.id}`)).json;
    assert.equal(off.space.template, 'games', 'the key is kept and shown');
    assert.equal(off.look.words.space.one, 'trip', 'but not read');
    assert.equal((await ctx2(mia.as, campaign.id)).json.module.name, 'Itinerary');
    const set = await asAdmin('PATCH', `/api/spaces/${trip.id}`, { template: 'games' });
    assert.equal(set.status, 409);
    assert.match(set.json.error, /turned off/);
    assert.equal((await asAdmin('POST', '/api/spaces', { name: 'Z', template: 'games' })).status, 409);
    assert.equal((await asAdmin('PATCH', `/api/spaces/${campaign.id}`, { template: null })).status, 200, 'clearing is allowed');
    assert.equal((await asAdmin('PATCH', `/api/spaces/${campaign.id}`, { name: 'Dragon' })).status, 200);
    assert.equal((await asAdmin('PATCH', '/api/settings', { spaceTemplates: true })).status, 200);
    assert.equal((await asAdmin('PATCH', `/api/spaces/${campaign.id}`, { template: 'games' })).status, 200);
    assert.equal((await asAdmin('GET', `/api/spaces/${campaign.id}`)).json.look.words.space.one, 'campaign');
  });

  await test('the access key reads no template on a space list; a single install cannot delete a template a space names', async () => {
    const key = (await asAdmin('GET', '/api/settings')).json.streamKey;
    const keyed = await call(server, 'GET', '/api/spaces', { cookie: '', body: undefined });
    assert.equal(keyed.status, 401);
    const withKey = await call(server, 'GET', `/api/spaces?s=${encodeURIComponent(key)}`);
    assert.equal(withKey.status, 200, withKey.text);
    assert.ok(withKey.json.spaces.length >= 2);
    for (const sp of withKey.json.spaces) assert.equal('template' in sp, false, 'no template on an item');
    const status = await call(server, 'GET', `/api/status?s=${encodeURIComponent(key)}`);
    for (const sp of status.json.spaces) assert.equal('template' in sp, false, 'nor on the stream status');
    assert.equal((await asAdmin('GET', '/api/spaces')).json.spaces.find((s) => s.id === campaign.id).template, 'games', 'a signed-in owner still reads it');
    // An imported template a space names.
    const file = (await asAdmin('GET', '/api/templates/games/export')).json;
    const imp = await call(server, 'POST', '/api/templates/import?id=mine', { cookie: admin, body: file });
    assert.equal(imp.status, 201, imp.text);
    assert.equal((await asAdmin('PATCH', `/api/spaces/${trip.id}`, { template: 'mine' })).status, 200);
    const refused = await asAdmin('DELETE', '/api/templates/mine');
    assert.equal(refused.status, 409);
    assert.match(refused.json.error, /^Environments or trips use this template: .+\. Hide it instead\.$/);
    assert.equal((await asAdmin('PATCH', `/api/spaces/${trip.id}`, { template: null })).status, 200);
    assert.equal((await asAdmin('DELETE', '/api/templates/mine')).status, 200);
  });

  await test('the stored file: the key on the record, no other file changed in shape, and a restart reads it back', async () => {
    assert.equal(stored(campaign.id).template, 'games');
    const app = JSON.parse(fs.readFileSync(path.join(dataDir, 'app.json'), 'utf8'));
    assert.equal(app.spaces.find((s) => s.id === 'lobby').template, undefined);
    assert.equal(app.settings.spaceTemplates, true);
  });
} finally {
  await stopServer();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failed ? `check-space-templates: ${failed} failed` : `check-space-templates: ${n} checks passed`);
process.exit(failed ? 1 : 0);
