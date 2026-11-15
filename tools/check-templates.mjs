#!/usr/bin/env node
/*
 * check-templates.mjs -- templates (documentation/plans/plan-templates-redesign.md, step 1, "The template format and
 * catalog"; plan-environment-templates.md for picking, switching and the host's edits): the shape as stored and every
 * refusal with its sentence, hostile input included (unknown keys, prototype keys, sizes, a module entry reaching for
 * permissions, settings a module does not mark, labels it does not declare, starter content it does not take); the fixed
 * Default template and its "*"; locked words and verbs; the bundled templates valid against the real manifests and
 * recorded in tools/template-versions.json; applying one twice gives the same environment; and, over HTTP, the owner's
 * own templates (copy, edit, delete with the fallback, import, export), the host's console routes and the Default
 * template's refusals, on a single install and a hosted one.
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
// A made-up product name for the server code this check loads and the servers it starts, so a sentence that hard-codes the default
// fails here (plan-kind-names.md, The guard).
const PRODUCT = 'Testname';
process.env.PRODUCT_NAME = PRODUCT;
const templates = require('../server/templates.js');
const templateFile = require('../server/template-file.js');
const { buildEnvironment } = require('../server/environment.js');
const { bundledModules } = require('../server/module-build.js');
const { LOBBY } = require('../server/store.js');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-templates: ${name}: ${err.stack || err.message}`); }
};
const manifests = new Map(bundledModules(path.join(ROOT, 'modules')).map((m) => [m.id, m]));
const travelRaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'travel.json'), 'utf8'));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-templates-'));
const built = [];
let server = null;
const quiet = () => {};
const freshEnvironment = (name) => {
  const env = buildEnvironment(path.join(base, name), { log: quiet });
  built.push(env);
  return env;
};

function startServer(dataDir, env = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, PRODUCT_NAME: PRODUCT, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ...env },
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
  return portPromise.then((port) => ({ port, output: () => out, stop: () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); }) }));
}
// `raw`: the body's text as it is (`type` its content type, JSON by default), for what JSON.stringify can't write.
function call(server, host, method, urlPath, { body, cookie, raw, type } = {}) {
  const payload = raw !== undefined ? Buffer.from(raw) : body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { host: host ? `${host}.localhost:${server.port}` : `127.0.0.1:${server.port}`, accept: 'application/json' };
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

try {
  const problems = (raw, opts = {}) => templates.problemsOf(raw, { manifests, ...opts });
  const minimal = (extra = {}) => ({ id: 'mini', name: 'Mini', description: 'A small one.', modules: { chat: {} }, ...extra });

  await test('every bundled template is valid against the real manifests, the server loads them all, the Default first', () => {
    const loaded = templates.loadTemplates();
    const files = fs.readdirSync(path.join(ROOT, 'templates')).filter((f) => f.endsWith('.json'));
    assert.equal(loaded.size, files.length);
    for (const f of files) assert.deepEqual(problems(JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', f), 'utf8')), { file: f }), [], f);
    assert.deepEqual(templates.list().map((t) => t.id), [...loaded.keys()]);
    assert.equal([...loaded.keys()][0], 'default');
  });

  await test('a bundled template whose applied-once part changed has a new version', () => {
    const file = path.join(ROOT, 'tools', 'template-versions.json');
    const now = Object.fromEntries([...templates.all().values()].map((t) => [t.id, { version: t.version, fingerprint: templates.appliedOnceFingerprint(t) }]));
    if (process.argv.includes('--update') || !fs.existsSync(file)) fs.writeFileSync(file, `${JSON.stringify(now, null, 2)}\n`);
    const recorded = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [id, cur] of Object.entries(now)) {
      const was = recorded[id];
      if (!was) throw new Error(`templates/${id}.json is not in tools/template-versions.json; run node tools/check-templates.mjs --update`);
      if (was.fingerprint !== cur.fingerprint && cur.version <= was.version) throw new Error(`templates/${id}.json changed what it applies or creates once (its modules, settings, Lobby, space defaults, workspace, reactions, icon set or starter content) but kept version ${cur.version}; raise "version", then run node tools/check-templates.mjs --update`);
      if (was.fingerprint !== cur.fingerprint || was.version !== cur.version) throw new Error(`templates/${id}.json has a new version; record it with node tools/check-templates.mjs --update`);
    }
  });

  await test('the Default template (decisions 3 and 33): the whole catalog as "*", no words, the core call, nothing added', () => {
    const d = templates.get('default');
    assert.deepEqual([d.id, d.name, d.version, d.modules, d.words, d.home, d.phases, d.reactions, d.iconSet, d.starterSpaces, d.settings, d.lobby], ['default', 'Default', 1, '*', {}, null, [], [], [], [], {}, {}]);
    assert.deepEqual(d.call, { joinOnEntry: false, position: 'top', layout: 'grid' });
    assert.equal(templates.defaultTemplate(), d);
    assert.deepEqual(templates.moduleIdsOf(d), '*');
    assert.deepEqual(templates.moduleIdsOf(d, ['a', 'b']), ['a', 'b'], '"*" reads as the catalog');
    assert.equal(templates.offers(d, 'anything'), true);
    // A server without it does not start.
    const dir = fs.mkdtempSync(path.join(base, 'no-default-'));
    fs.copyFileSync(path.join(ROOT, 'templates', 'travel.json'), path.join(dir, 'travel.json'));
    assert.throws(() => templates.loadTemplates({ dir }), /the Default template is missing, and the server needs it\./);
  });

  await test('the travel and games templates in the new shape: the same behaviour, their modules one entry each', () => {
    const t = templates.get('travel');
    assert.deepEqual(t.words, { space: { one: 'trip', many: 'trips' } });
    assert.deepEqual(Object.keys(t.modules), ['travel', 'maps', 'research', 'vault', 'assistant', 'calendar', 'budget', 'polls', 'todo', 'chat', 'conference']);
    assert.deepEqual([t.modules.travel, t.modules.vault, t.modules.maps], [{ name: 'Itinerary' }, { name: 'Documents' }, {}]);
    assert.deepEqual([t.icons.home, t.lobby, t.spaceDefaults, t.workspace], ['suitcase-rolling', { name: 'Home base', description: 'Everyone on every trip.' }, { profile: 'participants' }, { opensWith: ['travel', 'chat'] }]);
    assert.deepEqual(t.settings, { showCalendar: true, showMap: true, calendarFeeds: true, otherCalendars: true });
    assert.deepEqual(t.phases.map((p) => [p.id, p.icon]), [['planning', 'clipboard-list'], ['booking', 'ticket'], ['buffer', 'hourglass-half'], ['pre-trip', 'suitcase-rolling'], ['trip', 'plane'], ['post-trip', 'camera']]);
    assert.equal(t.phases.find((p) => p.main).id, 'trip');
    assert.equal(t.phaseMeasure, 'dates');
    const g = templates.get('games');
    assert.deepEqual(g.words, { space: { one: 'campaign', many: 'campaigns' }, member: { one: 'player', many: 'players' } }, 'Games loses group, game master and whisper (decisions 5 and 32)');
    assert.deepEqual(g.modules.travel, { name: 'Campaign planner', icon: 'scroll' });
    assert.deepEqual([g.modules.calendar.name, g.modules.todo.name, g.modules.research.name, g.modules.vault.name], ['Sessions', 'Quests', 'Lore', 'Handouts']);
    assert.deepEqual(g.workspace, { opensWith: ['chat', 'calendar'] });
  });

  await test('the fields: an unknown one, and every old one (verbs, theme, moduleNames, moduleIcons), is refused with its sentence', () => {
    const fields = 'id, name, description, version, words, home, icons, lobby, modules, call, workspace, phases, phaseMeasure, reactions, iconSet, spaceDefaults, starterSpaces, settings';
    for (const key of ['verbs', 'theme', 'moduleNames', 'moduleIcons', 'access', 'permissions']) {
      assert.deepEqual(problems(minimal({ [key]: {} })), [`"${key}" is not a template field; the fields are ${fields}.`], key);
    }
    assert.deepEqual(problems('x'), ['A template must be a JSON object.']);
    assert.deepEqual(problems(minimal({ id: 'Bad Id' })), ['"id" must be lowercase letters, digits and dashes, starting with a letter.']);
    assert.deepEqual(problems(minimal(), { file: 'other.json' }), ['"id" must match the file\'s name (other.json).']);
    assert.deepEqual(problems(minimal({ name: '<b>x</b>' })), ['"name" must be plain text of 1 to 40 characters.']);
    assert.deepEqual(problems(minimal({ description: 'x'.repeat(201) })), ['"description" must be plain text of 1 to 200 characters.']);
    assert.deepEqual(problems(minimal({ version: 0 })), ['"version" must be a whole number from 1 to 1000000.']);
    for (const version of [9e15, 1000001, 1.5]) assert.deepEqual(problems(minimal({ version })), ['"version" must be a whole number from 1 to 1000000.'], String(version));
    assert.deepEqual(problems(minimal({ version: 1000000 })), [], 'the highest version is accepted');
    assert.deepEqual(problems(minimal({ settings: { activeThemeId: null } })), [`settings: "activeThemeId" is not a setting a template can give; those are ${Object.keys(templates.SETTINGS).join(', ')}.`], 'the theme left templates (decision 13)');
    assert.deepEqual(problems(minimal({ settings: { themeMode: 'dark' } }))[0].slice(0, 30), 'settings: "themeMode" is not a');
    assert.deepEqual(problems(minimal({ settings: { clock: '13' } })), ['settings: "13" is not a value "clock" takes.']);
  });

  await test('hostile shapes: prototype keys anywhere, too deep, too big; refused before anything else', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const deep = minimal();
      deep.lobby = JSON.parse(`{ "name": "x", "${key}": { "polluted": true } }`);
      assert.deepEqual(problems(deep), [`A template can't hold a key called "${key}".`], `lobby.${key}`);
      const top = JSON.parse(`{ "id": "mini", "name": "Mini", "description": "A small one.", "modules": { "chat": {} }, "${key}": {} }`);
      assert.deepEqual(problems(top), [`A template can't hold a key called "${key}".`], key);
      const inModules = JSON.parse(`{ "id": "mini", "name": "Mini", "description": "A small one.", "modules": { "chat": {}, "${key}": {} } }`);
      assert.deepEqual(problems(inModules), [`A template can't hold a key called "${key}".`], `modules.${key}`);
    }
    assert.equal({}.polluted, undefined, 'nothing reached Object.prototype');
    let nested = {};
    const root = nested;
    for (let i = 0; i < 20; i += 1) { nested.a = {}; nested = nested.a; }
    assert.deepEqual(problems(minimal({ lobby: root })), ['A template can nest at most 16 levels deep.']);
    assert.deepEqual(problems(minimal({ description: 'x'.repeat(130 * 1024) })), ['A template can be at most 128 KB.']);
  });

  await test('locked words (decisions 5, 6 and 32): only space and member; home in its own field; every locked one refused', () => {
    for (const key of ['environment', 'aside', 'canvas', 'module', 'object', 'owner', 'moderator', 'guest', 'host', 'admin']) {
      assert.deepEqual(problems(minimal({ words: { [key]: { one: 'x', many: 'xs' } } })), [`words: "${key}" reads the same everywhere, so a template can't change it.`], key);
    }
    assert.deepEqual(problems(minimal({ words: { home: { one: 'Trips', many: 'Trips' } } })), ['words: the Home word goes in "home", not in "words".']);
    assert.deepEqual(problems(minimal({ words: { lobby: { one: 'x', many: 'xs' } } })), ['words: there is no word called "lobby"; a template may change space and member.']);
    assert.deepEqual(problems(minimal({ words: { space: { one: 'trip' } } })), ['words: The word for space needs both its singular and its plural.']);
    assert.deepEqual(problems(minimal({ words: { space: { one: 'trip', many: 'trips' }, member: { one: 'player', many: 'players' } }, home: { one: 'Trips', many: 'Trips' } })), []);
    assert.deepEqual(problems(minimal({ home: { one: 'Trips' } })), ['home: The word for the home page needs both its singular and its plural.']);
    // What a store reads: a locked word a template (or an owner) holds reads the default anyway.
    const env = freshEnvironment('locked');
    templates.useLive(env.store, { ...templates.cleanTemplate(minimal({ words: { space: { one: 'trip', many: 'trips' } }, home: { one: 'Journeys', many: 'Journeys' } })), words: { space: { one: 'trip', many: 'trips' }, owner: { one: 'boss', many: 'bosses' } } });
    const w = env.store.resolvedWords();
    assert.deepEqual([w.space.one, w.home.one, w.owner.one], ['trip', 'Journeys', 'owner']);
    assert.deepEqual(env.store.resolvedVerbs(), { enter: 'Enter', layout: 'Layout' });
    assert.throws(() => env.store.updateSettings({ verbs: { enter: 'Board' } }), (err) => err.status === 400 && err.message === 'The enter and layout verbs read the same everywhere, so they can\'t be changed.');
    assert.throws(() => env.store.updateSettings({ words: { owner: { one: 'boss', many: 'bosses' } } }), (err) => err.status === 400 && err.message === 'The owner word reads the same everywhere, so it can\'t be changed.');
  });

  await test('modules: "*" or one entry per id; only name, icon, settings, labels and starter (decision 15); chat listed; known ids only', () => {
    assert.deepEqual(problems(minimal({ modules: '*' })), []);
    assert.deepEqual(problems(minimal({ modules: ['chat'] })), ['"modules" must be "*" for every module, or an object with one entry per module id.']);
    assert.deepEqual(problems(minimal({ modules: { polls: {} } })), ['modules: "chat" must be listed; Chat can\'t be switched off yet.']);
    assert.deepEqual(problems(minimal({ modules: { chat: {}, nope: {} } })), ['modules: "nope" is not a module this server has.']);
    for (const key of ['permissions', 'uploads', 'refs', 'access', 'guards', 'actions', 'hooks', 'events', 'destinations', 'secrets', 'files', 'enabled']) {
      assert.deepEqual(problems(minimal({ modules: { chat: {}, polls: { [key]: {} } } })), ['modules.polls: a template sets only name, icon, settings, labels and starter.'], key);
    }
    assert.deepEqual(problems(minimal({ modules: { chat: 'on' } })), ['modules.chat must be an object; a template sets only name, icon, settings, labels and starter.']);
    assert.deepEqual(problems(minimal({ modules: { chat: { name: '<i>' } } })), ['modules.chat.name: A display name is plain text, without < or >.']);
    assert.deepEqual(problems(minimal({ modules: { chat: { icon: 'no-such-icon-xyz' } } })), ['modules.chat.icon: "no-such-icon-xyz" is not a Font Awesome Free solid icon.']);
    assert.deepEqual(problems(minimal({ modules: Object.fromEntries([['chat', {}], ...Array.from({ length: 61 }, (_, i) => [`m${i}`, {}])]) }))[0], '"modules" can list at most 60 modules.');
    // The real manifests mark nothing yet (step 3), so every setting, label and starter is refused today.
    assert.deepEqual(problems(minimal({ modules: { chat: {}, todo: { settings: { inCalendar: true } } } })), ['modules.todo.settings: "inCalendar" is not a setting the todo module lets a template set.']);
    assert.deepEqual(problems(minimal({ modules: { chat: {}, calendar: { labels: { event: { one: 'session', many: 'sessions' } } } } })), ['modules.calendar.labels: "event" is not a word the calendar module lets a template rename.']);
    assert.deepEqual(problems(minimal({ modules: { chat: {}, documents: { starter: { 'doc:a': {} } } } })), ['modules.documents: the documents module takes no starter content.']);
    const clean = templates.cleanTemplate(minimal({ modules: { chat: { name: '  Talk   here ' }, polls: {} } }));
    assert.deepEqual(clean.modules, { chat: { name: 'Talk here' }, polls: {} });
  });

  await test('module settings, labels and starter, against a manifest that marks them: driven and default only, by the module\'s own rules', () => {
    const fake = new Map(manifests);
    fake.set('fake', {
      id: 'fake',
      settings: [
        { key: 'unit', label: 'Counts', type: 'choice', scope: 'space', template: 'driven', options: [{ value: 'money', label: 'Money' }, { value: 'hours', label: 'Hours' }] },
        { key: 'split', label: 'Who owes whom', type: 'boolean', scope: 'space', template: 'default' },
        { key: 'view', label: 'View', type: 'choice', scope: 'person', template: 'driven', options: [{ value: 'a', label: 'A' }] },
        { key: 'own', label: 'Own', type: 'boolean', scope: 'space' },
        { key: 'key', label: 'Key', type: 'secret', scope: 'environment', template: 'default', maxLength: 10 },
        { key: 'site', label: 'Site', type: 'url', scope: 'environment', template: 'driven' },
        { key: 'count', type: 'number', scope: 'space', template: 'default', min: 1, max: 5 },
      ],
      labels: { milestone: { one: 'milestone', many: 'milestones' } },
      starter: true,
    });
    const p = (entry) => templates.problemsOf(minimal({ modules: { chat: {}, fake: entry } }), { manifests: fake });
    assert.deepEqual(p({ settings: { unit: 'hours', split: false } }), []);
    assert.deepEqual(p({ settings: { unit: 'gold' } }), ['modules.fake.settings: Counts must be one of its choices.']);
    assert.deepEqual(p({ settings: { split: 'yes' } }), ['modules.fake.settings: Who owes whom must be on or off.']);
    assert.deepEqual(p({ settings: { own: true } }), ['modules.fake.settings: "own" is not a setting the fake module lets a template set.']);
    assert.deepEqual(p({ settings: { nope: true } }), ['modules.fake.settings: "nope" is not a setting the fake module lets a template set.']);
    assert.deepEqual(p({ settings: { key: 'abc' } }), ['modules.fake.settings: "key" is a secret, so a template can\'t set it.']);
    assert.deepEqual(p({ settings: { site: 'https://example.com' } }), ['modules.fake.settings: "site" is a url, so a template can\'t set it.']);
    assert.deepEqual(p({ settings: { view: 'a' } }), ['modules.fake.settings: "view" is each person\'s own, so a template can only suggest it.']);
    assert.deepEqual(p({ settings: [] }), ['modules.fake.settings must be an object of settings by key.']);
    assert.deepEqual(p({ settings: { count: 9 } }), ['modules.fake.settings: count must be between 1 and 5.'], 'a setting with no label is named by its key');
    assert.deepEqual(p({ labels: { milestone: { one: 'session', many: 'sessions' } } }), []);
    assert.deepEqual(p({ labels: { goal: { one: 'x', many: 'xs' } } }), ['modules.fake.labels: "goal" is not a word the fake module lets a template rename.']);
    assert.deepEqual(p({ labels: { milestone: { one: '<b>', many: 'x' } } }), ['modules.fake.labels: The word for milestone can use only letters, spaces, hyphens and apostrophes.']);
    assert.deepEqual(p({ starter: { 'doc:brief': { title: 'Brief' } } }), []);
    assert.deepEqual(p({ starter: { 'bad key!': 1 } }), ['modules.fake.starter: "bad key!" is not a data key; a key is 1 to 128 letters, digits and . _ : / -.']);
    assert.deepEqual(p({ starter: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 1])) }), ['modules.fake.starter can hold at most 20 keys.']);
    assert.deepEqual(p({ starter: { big: 'x'.repeat(65 * 1024) } }), ['A template\'s starter content can be at most 64 KB.']);
    const clean = templates.cleanTemplate(minimal({ modules: { chat: {}, fake: { name: 'Plan', settings: { unit: 'hours' }, labels: { milestone: { one: 'session', many: 'sessions' } }, starter: { 'doc:a': { t: 1 } } } } }), { manifests: fake });
    assert.deepEqual(clean.modules.fake, { name: 'Plan', settings: { unit: 'hours' }, labels: { milestone: { one: 'session', many: 'sessions' } }, starter: { 'doc:a': { t: 1 } } });
    // Read against the module as it is now: a mark or a label it dropped since is left out, never an error.
    const later = templates.cleanTemplate(minimal({ modules: { chat: {}, fake: { settings: { unit: 'hours' }, labels: { milestone: { one: 'session', many: 'sessions' } }, starter: { a: 1 } } } }), { manifests });
    assert.deepEqual(later.modules.fake, {});
  });

  await test('call, workspace, phases and their measure, spaceDefaults and starterSpaces: each refused with its sentence', () => {
    assert.deepEqual(problems(minimal({ call: { joinOnEntry: true, position: 'left', layout: 'strip' } })), []);
    assert.deepEqual(problems(minimal({ call: { volume: 1 } })), ['"call" takes only joinOnEntry, position and layout.']);
    assert.deepEqual(problems(minimal({ call: { joinOnEntry: 'yes' } })), ['call.joinOnEntry must be true or false.']);
    assert.deepEqual(problems(minimal({ call: { position: 'middle' } })), ['call.position must be one of top, bottom, left, right, float, workspace, window.']);
    assert.deepEqual(problems(minimal({ call: { layout: 'mosaic' } })), ['call.layout must be one of grid, strip, focus, spotlight.']);
    assert.deepEqual(problems(minimal({ modules: { chat: {}, polls: {} }, workspace: { opensWith: ['polls', 'chat'], show: ['calendar', 'map'], opensFirst: 'calendar' } })), []);
    assert.deepEqual(problems(minimal({ workspace: { opensWith: ['polls'] } })), ['workspace.opensWith: "polls" is not one of this template\'s modules.']);
    assert.deepEqual(problems(minimal({ modules: '*', workspace: { opensWith: ['polls', 'nope'] } })), ['workspace.opensWith: "nope" is not one of this template\'s modules.']);
    assert.deepEqual(problems(minimal({ workspace: { opensWith: ['chat', 'chat'] } })), ['workspace.opensWith: "chat" is listed twice.']);
    assert.deepEqual(problems(minimal({ workspace: { show: ['workspace'] } })), ['workspace.show must be a list of Fixed Workspaces, each once: calendar, map, conference, whiteboard, documents.']);
    assert.deepEqual(problems(minimal({ workspace: { opensFirst: 'home' } })), ['workspace.opensFirst must be one of workspace, calendar, map, conference, whiteboard, documents.']);
    assert.deepEqual(problems(minimal({ workspace: { tabs: [] } })), ['"workspace" takes only opensWith, show and opensFirst.']);
    const phase = (id, extra = {}) => ({ id, label: id[0].toUpperCase() + id.slice(1), ...extra });
    assert.deepEqual(problems(minimal({ phases: [phase('a'), phase('a')] })), ['phases: "a" is listed twice.']);
    assert.deepEqual(problems(minimal({ phases: [phase('a', { main: true }), phase('b', { main: true })] })), ['phases: only one phase can be the main one.']);
    assert.deepEqual(problems(minimal({ phases: Array.from({ length: 13 }, (_, i) => phase(`p${i}`)) })), ['"phases" must be a list of at most 12 phases.']);
    assert.deepEqual(problems(minimal({ phases: [phase('a', { icon: 'no-such-icon-xyz' })] })), ['phases[0]: icon "no-such-icon-xyz" is not a Font Awesome Free solid icon.']);
    assert.deepEqual(problems(minimal({ phases: [{ id: 'a', label: 'A', note: 1 }] })), ['phases[0]: "note" is not a phase field; a phase takes id, label, main and icon.']);
    for (const m of ['dates', 'goals', 'progress']) assert.deepEqual(problems(minimal({ phaseMeasure: m })), [], m);
    assert.deepEqual(problems(minimal({ phaseMeasure: 'weeks' })), ['"phaseMeasure" must be one of dates, goals, progress.']);
    assert.equal(templates.cleanTemplate(minimal()).phaseMeasure, 'dates', 'dates when left out');
    assert.deepEqual(problems(minimal({ spaceDefaults: { opensWith: ['chat'] } })), ['"spaceDefaults" takes only "profile"; what a new space opens with is in "workspace".']);
    assert.deepEqual(problems(minimal({ spaceDefaults: { profile: 'x' } })), ['spaceDefaults.profile must be one of roleplaying, participants, characters.']);
    assert.deepEqual(problems(minimal({ starterSpaces: [{ name: 'First', description: 'Try things.' }] })), []);
    assert.deepEqual(problems(minimal({ starterSpaces: Array.from({ length: 6 }, () => ({ name: 'x' })) })), ['"starterSpaces" must be a list of at most 5 spaces.']);
    assert.deepEqual(problems(minimal({ starterSpaces: [{ name: 'x', members: [] }] })), ['starterSpaces[0] takes only name and description.']);
    assert.deepEqual(problems(minimal({ starterSpaces: [{ name: '' }] })), ['starterSpaces[0]: a name is plain text of 1 to 60 characters.']);
    assert.deepEqual(problems(minimal({ lobby: { name: 'x', size: 1 } })), ['"lobby" takes only "name" and "description".']);
    assert.deepEqual(problems(minimal({ icons: { home: 'plane', other: 'x' } })), ['"icons" takes only "home".']);
  });

  await test('reactions and icons (decision 12): additions only; a repeat of the core set refused', () => {
    assert.deepEqual(problems(minimal({ reactions: [{ id: 'ship', glyph: '\u{1f680}', label: 'Ship it' }], iconSet: ['diagram-project'] })), []);
    assert.deepEqual(problems(minimal({ reactions: [{ id: 'love', glyph: '❤️' }] })), ['reactions[0]: ❤️ is in the core set already; a template only adds.']);
    assert.deepEqual(problems(minimal({ reactions: [{ id: 'heart', glyph: '\u{1f680}' }] })), ['reactions[0]: \u{1f680} is in the core set already; a template only adds.'], 'a core id too');
    assert.deepEqual(problems(minimal({ reactions: [{ id: 'a1', glyph: '\u{1f680}' }, { id: 'a2', glyph: '\u{1f680}' }] })), ['reactions[1]: \u{1f680} is listed twice.']);
    assert.deepEqual(problems(minimal({ reactions: [{ glyph: '\u{1f680}' }] })), ['reactions[0]: an id is 1 to 24 lowercase letters, digits and dashes.']);
    assert.deepEqual(problems(minimal({ reactions: [{ id: 'x', glyph: '<' }] })), ['reactions[0]: each reaction needs a glyph of 1 to 8 characters.']);
    assert.deepEqual(problems(minimal({ reactions: [{ id: 'x', glyph: 'y', extra: 1 }] })), ['reactions[0]: a reaction takes only id, glyph and label.']);
    assert.deepEqual(problems(minimal({ reactions: Array.from({ length: 41 }, (_, i) => ({ id: `r${i}`, glyph: `${i}` })) })), ['"reactions" must be a list of at most 40 reactions to add.']);
    assert.deepEqual(problems(minimal({ iconSet: ['link'] })), ['iconSet: "link" is in the core set already; a template only adds.']);
    assert.deepEqual(problems(minimal({ iconSet: ['diagram-project', 'diagram-project'] })), ['iconSet: "diagram-project" is listed twice.']);
    assert.deepEqual(problems(minimal({ iconSet: ['no-such-icon-xyz'] })), ['iconSet: "no-such-icon-xyz" is not a Font Awesome Free solid icon.']);
    assert.deepEqual(templates.cleanTemplate(minimal({ reactions: [{ id: 'ship', glyph: ' \u{1f680} ' }] })).reactions, [{ id: 'ship', glyph: '\u{1f680}', label: '\u{1f680}' }], 'tidied; the label is the glyph when none is given');
  });

  // The once-only part, twice: the same environment either way (only the time it was applied differs).
  const snapshot = (env) => {
    const app = JSON.parse(fs.readFileSync(path.join(env.store.dir, 'app.json'), 'utf8'));
    const registryFile = path.join(env.modules.dir, 'registry.json');
    const registry = fs.existsSync(registryFile) ? JSON.parse(fs.readFileSync(registryFile, 'utf8')) : { modules: {} };
    const lobby = app.spaces.find((s) => s.id === LOBBY);
    return {
      settings: { conferenceEnabled: app.settings.conferenceEnabled, homeIcon: app.settings.homeIcon, spaceDefaults: app.settings.spaceDefaults, icons: app.settings.icons.map((i) => i.id), reactions: app.settings.reactions.map((r) => r.id) },
      lobby: [lobby.name, lobby.description],
      modules: Object.fromEntries(Object.entries(registry.modules).map(([id, e]) => [id, [e.version, e.enabled]])),
    };
  };
  const travel = templates.get('travel');
  await test('applying twice gives the same environment: settings, the Lobby, space defaults (with the workspace\'s opensWith), icons, added reactions, modules', async () => {
    const env = freshEnvironment('twice');
    const t = { ...travel, reactions: [{ id: 'ship', glyph: '\u{1f680}', label: 'Ship it' }], iconSet: ['diagram-project'] };
    const first = await templates.applyTemplate(env, t);
    const once = snapshot(env);
    const second = await templates.applyTemplate(env, t);
    assert.deepEqual(second, first);
    assert.deepEqual(snapshot(env), once);
    assert.deepEqual(first, []);
    assert.deepEqual(once.lobby, ['Home base', 'Everyone on every trip.']);
    assert.deepEqual([once.settings.conferenceEnabled, once.settings.homeIcon, once.settings.spaceDefaults], [true, null, { profile: 'participants', opensWith: ['travel', 'chat'] }]);
    assert.ok(once.settings.icons.includes('suitcase-rolling') && once.settings.icons.includes('diagram-project'), 'the home icon and the added icon join the icon list');
    assert.equal(once.settings.reactions.filter((id) => id === 'ship').length, 1, 'the added reaction joins the tray once, after the core set');
    assert.equal(once.settings.reactions[0], 'heart', 'the core set is untouched');
    for (const id of ['travel', 'maps', 'research', 'calendar', 'vault']) assert.deepEqual(once.modules[id].slice(1), [true], id);
    assert.equal(env.store.addSpace({ name: 'Lisbon' }).profile, 'participants');
  });

  await test('the Default template applies nothing: no module turned on or off, the conference on, nothing added', async () => {
    const env = freshEnvironment('default-apply');
    const before = snapshot(env);
    assert.deepEqual(await templates.applyTemplate(env, templates.defaultTemplate()), []);
    const after = snapshot(env);
    assert.deepEqual(after.modules, before.modules);
    assert.deepEqual([after.settings.reactions, after.settings.icons, after.lobby], [before.settings.reactions, before.settings.icons, before.lobby]);
    assert.equal(after.settings.conferenceEnabled, true);
    const offer = templates.offerFor(env, templates.defaultTemplate());
    assert.deepEqual(offer, { iconSet: null, reactions: null, modules: [], lobby: null, spaceDefaults: null });
  });

  await test('a module the plan leaves out is skipped and recorded; a template that leaves the conference out switches it off', async () => {
    const noMaps = freshEnvironment('no-maps');
    assert.deepEqual(await templates.applyTemplate(noMaps, travel, { allowed: (id) => id !== 'maps' }), [{ id: 'maps', why: 'not in the plan' }]);
    assert.equal(noMaps.modules.isInstalled('maps'), false);
    const env = freshEnvironment('no-conference');
    await templates.applyTemplate(env, templates.cleanTemplate(minimal({ modules: { chat: {}, polls: {} }, settings: { clock: '24', allowAsides: false } })));
    assert.deepEqual([env.store.settings.conferenceEnabled, env.store.settings.clock, env.store.settings.allowAsides], [false, '24', false]);
    assert.equal(env.modules.enabled('polls') !== null, true);
  });

  await test('a switch offers only what the template adds; confirming applies only what is ticked', async () => {
    const env = freshEnvironment('offer');
    const t = templates.cleanTemplate(minimal({ modules: { chat: {}, polls: {} }, reactions: [{ id: 'ship', glyph: '\u{1f680}' }], iconSet: ['diagram-project'], lobby: { name: 'Front desk' }, spaceDefaults: { profile: 'participants' }, workspace: { opensWith: ['polls'] } }));
    const offer = templates.offerFor(env, t);
    assert.deepEqual(offer.modules.map((m) => m.id), ['polls']);
    assert.deepEqual([offer.reactions.map((r) => r.id), offer.iconSet, offer.lobby.name, offer.spaceDefaults], [['ship'], ['diagram-project'], 'Front desk', { profile: 'participants', opensWith: ['polls'] }]);
    await templates.applyOffer(env, t, { reactions: true, modules: ['polls'] });
    assert.ok(env.store.settings.reactions.some((r) => r.id === 'ship'));
    assert.equal(env.modules.enabled('polls') !== null, true);
    assert.equal(env.store.spaceById(LOBBY).name !== 'Front desk', true, 'the Lobby was not ticked');
    const again = templates.offerFor(env, t);
    assert.deepEqual([again.reactions, again.modules], [null, []]);
  });

  await test('the live part: words, the Home word, phases, the home icon and module names and icons, from the modules entries', () => {
    const env = freshEnvironment('live');
    const t = templates.get('games');
    templates.useLive(env.store, t);
    assert.deepEqual([env.store.resolvedWords().space.one, env.store.resolvedWords().member.one, env.store.resolvedWords().home.one], ['campaign', 'player', 'Campaigns']);
    assert.deepEqual(env.store.moduleDisplay('travel'), { name: 'Campaign planner', icon: 'scroll', ownName: null, ownIcon: null, templateName: 'Campaign planner', templateIcon: 'scroll' });
    assert.equal(env.store.homeIcon, 'dice-d20');
    templates.useLive(env.store, templates.cleanTemplate(minimal({ home: { one: 'Base camps', many: 'Base camps' } })));
    assert.equal(env.store.resolvedWords().home.one, 'Base camps', 'the template\'s Home word');
    templates.useLive(env.store, null);
    assert.equal(env.store.templatePhases, null);
  });

  await test('template files: a round trip gives the same template; unknown keys, theme and prototype keys refused, never dropped', () => {
    const file = templateFile.templateToFile({ ...travel, source: 'bundled', edited: true });
    assert.deepEqual(Object.keys(file).slice(0, 2), ['format', 'formatVersion']);
    assert.equal('edited' in file, false);
    assert.equal('source' in file, false);
    const read = templateFile.readTemplateFile(JSON.stringify(file));
    assert.deepEqual(templates.cleanTemplate(read.raw), travel);
    const refused = (extra) => { try { templateFile.readTemplateFile(JSON.stringify({ ...file, ...extra })); return null; } catch (err) { return [err.status, err.message]; } };
    assert.deepEqual(refused({ theme: { name: 'x' } })[1].slice(0, 36), '"theme" is not a template field; the');
    assert.deepEqual(refused({ junk: 1 })[1].slice(0, 35), '"junk" is not a template field; the');
    let proto = null;
    try { templateFile.readTemplateFile(`{"format":"template","formatVersion":1,"__proto__":{"modules":"*"},"id":"x","name":"X","description":"X."}`); } catch (err) { proto = err.message; }
    assert.equal(proto, 'A template can\'t hold a key called "__proto__".');
    let big = null;
    try { templateFile.readTemplateFile(JSON.stringify({ ...file, description: 'x'.repeat(130 * 1024) })); } catch (err) { big = err.message; }
    assert.equal(big, templateFile.NOT_A_TEMPLATE_FILE);
  });

  // --- over HTTP: a single install ------------------------------------------------------------------------------------
  {
    const single = path.join(base, 'single-own');
    server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1' });
    let admin = cookieOf(await call(server, '', 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
    const api = (method, url, body) => call(server, '', method, url, { cookie: admin, body });

    await test('a single install with no TEMPLATE reads the Default template, with the usual words and verbs', async () => {
      const tab = await api('GET', '/api/environment/template');
      assert.deepEqual([tab.json.template.id, tab.json.template.source, tab.json.template.offerOpen, tab.json.offer], ['default', 'bundled', false, null]);
      assert.equal(tab.json.choices[0].id, 'default');
      const b = (await call(server, '', 'GET', '/api/branding')).json;
      assert.deepEqual([b.words.space.one, b.words.owner.one, b.verbs], ['space', 'owner', { enter: 'Enter', layout: 'Layout' }]);
      assert.equal('template' in JSON.parse(fs.readFileSync(path.join(single, 'app.json'), 'utf8')), false, 'nothing recorded: none reads the Default');
      const st = (await api('GET', '/api/settings')).json.settings;
      assert.deepEqual(['ownVerbs' in st, 'templateVerbs' in st], [false, false]);
    });

    await test('locked words and verbs over HTTP: refused with one sentence each, nothing changed', async () => {
      const verbs = await api('PATCH', '/api/settings', { verbs: { enter: 'Board' } });
      assert.deepEqual([verbs.status, verbs.json.error], [400, 'The enter and layout verbs read the same everywhere, so they can\'t be changed.']);
      const owner = await api('PATCH', '/api/settings', { words: { owner: { one: 'boss', many: 'bosses' } }, clock: '24' });
      assert.deepEqual([owner.status, owner.json.error], [400, 'The owner word reads the same everywhere, so it can\'t be changed.']);
      assert.notEqual((await api('GET', '/api/settings')).json.settings.clock, '24', 'the whole change refused');
      const none = await api('PATCH', '/api/settings', { template: 'none' });
      assert.deepEqual([none.status, none.json.error], [400, 'Every environment has a template; pick Default for the plain one.']);
    });

    await test('the Default and shipped templates stay as they are: 403 with a sentence for an edit or a delete', async () => {
      assert.deepEqual(await api('PATCH', '/api/environment/templates/default', { name: 'Mine' }).then((r) => [r.status, r.json]), [403, { error: 'The Default template can\'t be changed; copy it to make your own.' }]);
      assert.deepEqual(await api('DELETE', '/api/environment/templates/default').then((r) => [r.status, r.json]), [403, { error: 'The Default template can\'t be deleted; every environment falls back to it.' }]);
      assert.deepEqual(await api('PATCH', '/api/environment/templates/travel', { name: 'Mine' }).then((r) => [r.status, r.json]), [403, { error: 'Shipped templates stay as they are; copy one to change it.' }]);
      assert.deepEqual(await api('DELETE', '/api/environment/templates/travel').then((r) => [r.status, r.json]), [403, { error: 'Shipped templates can\'t be deleted.' }]);
      assert.deepEqual(await api('PATCH', '/api/environment/templates/nope', { name: 'x' }).then((r) => [r.status, r.json]), [404, { error: 'There is no template called nope.' }]);
      const list = (await api('GET', '/api/environment/templates')).json.templates;
      assert.deepEqual(list.map((t) => [t.id, t.source, t.editable, t.environment]), [['default', 'bundled', false, true], ['games', 'bundled', false, false], ['travel', 'bundled', false, false]]);
    });

    await test('copy: the Default\'s "*" written out as the modules on here; a copy of travel keeps its shape; refusals', async () => {
      const copy = await api('POST', '/api/environment/templates', { from: 'default', id: 'plain', name: 'Plain' });
      assert.equal(copy.status, 201, copy.text);
      const t = copy.json.template;
      assert.deepEqual([t.id, t.name, t.version, t.source, t.editable, t.copiedFrom], ['plain', 'Plain', 1, 'own', true, { id: 'default', version: 1 }]);
      assert.ok(t.modules && typeof t.modules === 'object' && t.modules.chat && t.modules.conference, 'chat and the conference listed by id');
      const enabled = (await api('GET', '/api/modules')).json.modules.filter((m) => m.enabled).map((m) => m.id);
      for (const id of enabled) assert.ok(id in t.modules, `${id} is listed`);
      const trip = await api('POST', '/api/environment/templates', { from: 'travel', id: 'trips', name: 'Trips' });
      assert.equal(trip.status, 201, trip.text);
      assert.deepEqual([trip.json.template.modules.travel, trip.json.template.words, trip.json.template.workspace], [{ name: 'Itinerary' }, { space: { one: 'trip', many: 'trips' } }, { opensWith: ['travel', 'chat'] }]);
      for (const [body, status, error] of [
        [{ from: 'travel', id: 'trips', name: 'Again' }, 409, 'There is already a template called trips.'],
        [{ from: 'travel', id: 'default', name: 'Again' }, 409, 'There is already a template called default.'],
        [{ from: 'nope', id: 'x1', name: 'X' }, 400, 'There is no template called nope to copy.'],
        [{ from: 'travel', id: 'Bad Id', name: 'X' }, 400, '"id" must be lowercase letters, digits and dashes, starting with a letter.'],
        [{ from: 'travel', id: 'x2', name: 'X', words: {} }, 400, 'A copy takes only from, id and name; "words" is not one of them.'],
        [['travel'], 400, 'A copy is sent as { from, id, name }.'],
      ]) {
        const r = await api('POST', '/api/environment/templates', body);
        assert.deepEqual([r.status, r.json.error], [status, error], JSON.stringify(body));
      }
      const stored = JSON.parse(fs.readFileSync(path.join(single, 'app.json'), 'utf8')).templates;
      assert.deepEqual(stored.map((x) => [x.id, x.version, x.copiedFrom]), [['plain', 1, { id: 'default', version: 1 }], ['trips', 1, { id: 'travel', version: 11 }]]);
      for (const x of stored) assert.ok(x.createdAt && x.updatedAt, 'dated');
    });

    await test('edit: the same checks as every template, hostile bodies refused, the version up, live at once', async () => {
      const ok = await api('PATCH', '/api/environment/templates/trips', { words: { space: { one: 'journey', many: 'journeys' } }, phaseMeasure: 'progress', call: { joinOnEntry: true } });
      assert.equal(ok.status, 200, ok.text);
      assert.deepEqual([ok.json.template.version, ok.json.template.words.space.one, ok.json.template.phaseMeasure, ok.json.template.call], [2, 'journey', 'progress', { joinOnEntry: true }]);
      for (const [body, error] of [
        [{ words: { owner: { one: 'boss', many: 'bosses' } } }, 'words: "owner" reads the same everywhere, so a template can\'t change it.'],
        [{ modules: { chat: {}, travel: { permissions: { view: ['guest'] } } } }, 'modules.travel: a template sets only name, icon, settings, labels and starter.'],
        [{ theme: { name: 'x' } }, '"theme" is not a template field; the fields are id, name, description, words, home, icons, lobby, modules, call, workspace, phases, phaseMeasure, reactions, iconSet, spaceDefaults, starterSpaces, settings.'],
        [{ version: 9 }, 'A template\'s version is the server\'s to set.'],
        [{ id: 'other' }, 'A template\'s id can\'t be changed; copy it to make one with another id.'],
        [{ lobby: { name: 'x', constructor: { prototype: 1 } } }, 'A template can\'t hold a key called "constructor".'],
        [{ name: null }, '"name" must be plain text of 1 to 40 characters.'],
      ]) {
        const r = await api('PATCH', '/api/environment/templates/trips', body);
        assert.deepEqual([r.status, r.json.error], [400, error], JSON.stringify(body));
      }
      const proto = await call(server, '', 'PATCH', '/api/environment/templates/trips', { cookie: admin, body: undefined, raw: '{"__proto__":{"name":"Polluted"}}' });
      assert.equal(proto.status, 400, proto.text);
      assert.equal((await api('GET', '/api/environment/templates/trips')).json.template.version, 2, 'nothing refused changed it');
      // Live: the environment on it reads the new words at once.
      assert.equal((await api('PATCH', '/api/settings', { template: 'trips' })).status, 200);
      assert.equal((await call(server, '', 'GET', '/api/branding')).json.words.space.one, 'journey');
      await api('PATCH', '/api/environment/templates/trips', { words: { space: { one: 'voyage', many: 'voyages' } } });
      assert.equal((await call(server, '', 'GET', '/api/branding')).json.words.space.one, 'voyage', 'an edit reaches the environment at once');
    });

    await test('delete while in use: spaces read the environment\'s template, the environment reads the Default, and the answer says what moved', async () => {
      const made = await api('POST', '/api/spaces', { name: 'Porto', template: 'plain' });
      assert.equal(made.status, 200, made.text);
      const gone = await api('DELETE', '/api/environment/templates/plain');
      assert.deepEqual([gone.status, gone.json], [200, { spaces: ['Porto'], environment: false }]);
      assert.equal((await api('GET', `/api/spaces/${made.json.space.id}`)).json.space.template, null);
      const space2 = await api('POST', '/api/spaces', { name: 'Faro', template: 'trips' });
      const both = await api('DELETE', '/api/environment/templates/trips');
      assert.deepEqual([both.status, both.json], [200, { spaces: ['Faro'], environment: true }]);
      assert.equal((await api('GET', `/api/spaces/${space2.json.space.id}`)).json.space.template, null);
      const tab = (await api('GET', '/api/environment/template')).json;
      assert.deepEqual([tab.template.id, tab.template.offerOpen], ['default', false]);
      assert.equal((await call(server, '', 'GET', '/api/branding')).json.words.space.one, 'space');
      const app = JSON.parse(fs.readFileSync(path.join(single, 'app.json'), 'utf8'));
      assert.equal('templates' in app, false, 'none left');
      assert.deepEqual(app.templateHistory.at(-1).to, 'default');
      assert.deepEqual(await api('DELETE', '/api/environment/templates/trips').then((r) => r.status), 404);
    });

    await test('import and export: a file round trip; a hostile file refused; the cap on own templates', async () => {
      const file = (await api('GET', '/api/templates/travel/export'));
      assert.equal(file.status, 200, file.text);
      const imported = await api('POST', '/api/templates/import?id=from-file', file.json);
      assert.equal(imported.status, 201, imported.text);
      assert.deepEqual([imported.json.template.source, imported.json.template.version, imported.json.template.copiedFrom], ['own', 11, null]);
      const theme = await api('POST', '/api/templates/import?id=themed', { ...file.json, theme: { name: 'x' } });
      assert.deepEqual([theme.status, theme.json.error.slice(0, 32)], [400, '"theme" is not a template field;']);
      const proto = await call(server, '', 'POST', '/api/templates/import', { cookie: admin, raw: `{"format":"template","formatVersion":1,"id":"p1","name":"P","description":"P.","modules":{"chat":{}},"__proto__":{"x":1}}`, type: 'text/plain' });
      assert.deepEqual([proto.status, proto.json.error], [400, 'A template can\'t hold a key called "__proto__".']);
      for (let i = 0; i < 19; i += 1) assert.equal((await api('POST', '/api/environment/templates', { from: 'default', id: `t${i}`, name: `T ${i}` })).status, 201);
      const over = await api('POST', '/api/environment/templates', { from: 'default', id: 'one-more', name: 'One more' });
      assert.deepEqual([over.status, over.json.error], [409, 'This environment has 20 templates of its own, the most it can keep; delete one first.']);
    });

    await test('a stored template is checked again on every read: one hand-edited or restored into app.json is left out, with a log line', async () => {
      await server.stop();
      const file = path.join(single, 'app.json');
      const app = JSON.parse(fs.readFileSync(file, 'utf8'));
      const good = { id: 'kept', name: 'Kept', description: 'Fine.', modules: { chat: {} }, version: 1 };
      app.templates = [good, { ...good, id: 'topped', name: 'Topped', version: 1000000 }, { ...good, id: 'huge', name: 'Huge', version: 9e15 }, { ...good, id: 'reach', name: 'Reach', modules: { chat: { permissions: { view: ['guest'] } } } }, { ...good, id: 'themed', name: 'Themed', theme: { name: 'x' } }, { ...good, id: 'default', name: 'Fake default' }];
      fs.writeFileSync(file, JSON.stringify(app));
      server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1' });
      const again = cookieOf(await call(server, '', 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
      const list = (await call(server, '', 'GET', '/api/environment/templates', { cookie: again })).json.templates;
      assert.ok(list.some((t) => t.id === 'kept'));
      assert.deepEqual(list.filter((t) => ['reach', 'themed'].includes(t.id)), [], 'the bad ones are left out');
      assert.deepEqual(list.filter((t) => t.id === 'default').map((t) => [t.source, t.name]), [['bundled', 'Default']], 'nothing replaces the Default template');
      assert.match(server.output(), /The template "reach" could not be read \(modules\.chat: a template sets only name, icon, settings, labels and starter\.\); it is left out\./);
      assert.match(server.output(), /The template "default" is left out: another template already has that id\./);
      // Read again and again: each bad one is said once in the log, not on every read.
      for (let i = 0; i < 5; i += 1) await call(server, '', 'GET', '/api/environment/templates', { cookie: again });
      for (const id of ['reach', 'themed', 'huge']) assert.equal(server.output().split(`The template "${id}" could not be read`).length - 1, 1, `${id} logged once`);
      assert.match(server.output(), /The template "huge" could not be read \("version" must be a whole number from 1 to 1000000\.\)/);
      const topped = await call(server, '', 'PATCH', '/api/environment/templates/topped', { cookie: again, body: { name: 'Over' } });
      assert.deepEqual([topped.status, topped.json.error], [409, 'This template has reached its highest version; copy it to go on changing it.']);
      assert.equal((await call(server, '', 'DELETE', '/api/environment/templates/topped', { cookie: again })).status, 200);
      const tooNew = await call(server, '', 'POST', '/api/templates/import?id=too-new', { cookie: again, body: { ...(await call(server, '', 'GET', '/api/templates/travel/export', { cookie: again })).json, version: 9e15 } });
      assert.deepEqual([tooNew.status, tooNew.json.error], [400, '"version" must be a whole number from 1 to 1000000.']);
      await server.stop();
      server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1' });
      const fresh = cookieOf(await call(server, '', 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
      admin = fresh;
    });

    await test('who may: members and signed-out people are refused every template route', async () => {
      for (const [method, url] of [['GET', '/api/environment/templates'], ['POST', '/api/environment/templates'], ['PATCH', '/api/environment/templates/t1'], ['DELETE', '/api/environment/templates/t1'], ['POST', '/api/templates/import']]) {
        const r = await call(server, '', method, url, { body: method === 'GET' ? undefined : {} });
        assert.equal(r.status, 401, `${method} ${url}`);
      }
    });
    await server.stop();
    server = null;
  }

  const hosted = path.join(base, 'hosted');
  const hostedEnv = { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-1' };
  let console_ = null;
  const readHost = () => JSON.parse(fs.readFileSync(path.join(hosted, 'host.json'), 'utf8'));
  const travelRow = () => (console_('GET', '/api/host/templates')).then((r) => r.json.templates.find((t) => t.id === 'travel'));
  async function boot(dir, env) {
    server = await startServer(dir, env);
  }
  async function restartHost(mutate) {
    await server.stop();
    if (mutate) mutate();
    await boot(hosted, hostedEnv);
    const host = cookieOf(await call(server, 'admin', 'POST', '/api/host/login', { body: { login: 'boss', password: 'host-password-1' } }));
    console_ = (method, url, body) => call(server, 'admin', method, url, { cookie: host, body });
  }
  await boot(hosted, hostedEnv);
  {
    const host = cookieOf(await call(server, 'admin', 'POST', '/api/host/login', { body: { login: 'boss', password: 'host-password-1' } }));
    console_ = (method, url, body) => call(server, 'admin', method, url, { cookie: host, body });
  }

  await test('an edit that fails the checks is refused, and nothing is stored', async () => {
    const shipped = await console_('GET', '/api/host/templates/travel');
    const bad = await console_('PATCH', '/api/host/templates/travel', { modules: { travel: {} } });
    assert.deepEqual([bad.status, bad.json.error], [400, 'modules: "chat" must be listed; Chat can\'t be switched off yet.']);
    assert.ok(Array.isArray(bad.json.problems) && bad.json.problems.length >= 1);
    assert.equal(readHost().bundledEdits.some((r) => r.id === 'travel'), false);
    assert.equal((await console_('GET', '/api/host/templates/travel')).json.template.name, shipped.json.template.name);
  });

  await test('the first edit of a bundled template raises the version, keeps the id, and reaches environments at once', async () => {
    const shipped = (await console_('GET', '/api/host/templates/travel')).json.template;
    assert.equal((await console_('POST', '/api/host/environments', { slug: 'out', name: 'Out', template: 'travel', owner: { login: 'owner', password: 'owner-password-1' } })).status, 201);
    for (let i = 0; i < 100 && !server.output().includes('[out] Applied the "travel" template'); i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.equal((await call(server, 'out', 'GET', '/api/branding')).json.words.space.one, 'trip');
    assert.deepEqual((await call(server, 'out', 'GET', '/api/branding')).json.words.home, { one: 'Trips', many: 'Trips', a: 'a Trips' }, 'branding\'s home, from the template\'s space word');
    const edited = await console_('PATCH', '/api/host/templates/travel', { words: { space: { one: 'journey', many: 'journeys' } }, modules: { ...shipped.modules, whiteboard: {} } });
    assert.deepEqual([edited.status, edited.json.template.id, edited.json.template.version, edited.json.template.edited, edited.json.template.source], [200, 'travel', shipped.version + 1, true, 'bundled'], edited.text);
    assert.equal((await call(server, 'out', 'GET', '/api/branding')).json.words.space.one, 'journey', 'the new word, with no restart');
    const owner = cookieOf(await call(server, 'out', 'POST', '/api/login', { body: { login: 'owner', password: 'owner-password-1' } }));
    const tab = await call(server, 'out', 'GET', '/api/environment/template', { cookie: owner });
    assert.equal(tab.json.template.offerOpen, true);
    assert.ok(tab.json.offer.modules.some((m) => m.id === 'whiteboard'), 'a changed module is offered, not forced');
    assert.equal((await call(server, 'out', 'GET', '/api/modules', { cookie: owner })).json.modules.some((m) => m.id === 'whiteboard'), false);
  });

  await test('the host and the Default template: no edit, hide or delete; a copy lists the image\'s modules; ids unique across every environment', async () => {
    for (const body of [{ name: 'Mine' }, { hidden: true }, {}]) {
      assert.deepEqual(await console_('PATCH', '/api/host/templates/default', body).then((r) => [r.status, r.json]), [403, { error: 'The Default template can\'t be changed; copy it to make your own.' }], JSON.stringify(body));
    }
    assert.deepEqual(await console_('DELETE', '/api/host/templates/default').then((r) => [r.status, r.json]), [403, { error: 'The Default template can\'t be deleted; every environment falls back to it.' }]);
    assert.equal(readHost().bundledEdits.some((r) => r.id === 'default'), false, 'nothing stored');
    const copy = await console_('POST', '/api/host/templates/default/duplicate', { id: 'everything', name: 'Everything' });
    assert.equal(copy.status, 201, copy.text);
    assert.deepEqual(Object.keys(copy.json.template.modules).sort(), [...manifests.keys(), 'chat', 'conference'].sort(), 'every module the image ships, by id');
    const extra = await console_('POST', '/api/host/templates/default/duplicate', { id: 'x9', name: 'X', words: {} });
    assert.deepEqual([extra.status, extra.json.error], [400, 'A copy takes only an id and a name; "words" is not one of them.']);
    // An owner's own template in one environment: the host can't make another with its id, and another environment never sees it.
    const owner = cookieOf(await call(server, 'out', 'POST', '/api/login', { body: { login: 'owner', password: 'owner-password-1' } }));
    const own = await call(server, 'out', 'POST', '/api/environment/templates', { cookie: owner, body: { from: 'travel', id: 'outings', name: 'Outings' } });
    assert.equal(own.status, 201, own.text);
    assert.deepEqual(await console_('POST', '/api/host/templates/default/duplicate', { id: 'outings', name: 'Outings' }).then((r) => [r.status, r.json.error]), [409, 'There is already a template called outings, in Out.']);
    assert.deepEqual(await console_('POST', '/api/host/templates', { id: 'outings', name: 'Outings', description: 'Taken.', modules: { chat: {} } }).then((r) => [r.status, r.json.error]), [409, 'There is already a template called outings, in Out.']);
    assert.equal((await console_('GET', '/api/host/templates')).json.templates.some((t) => t.id === 'outings'), false, 'the host\'s list is the host\'s');
    assert.equal((await call(server, 'out', 'POST', '/api/environment/templates', { cookie: owner, body: { from: 'travel', id: 'everything', name: 'Taken' } })).status, 409, 'an owner can\'t take a host template\'s id');
    // The owner sees the host's templates and may copy them, never edit them.
    assert.deepEqual(await call(server, 'out', 'PATCH', '/api/environment/templates/everything', { cookie: owner, body: { name: 'Mine' } }).then((r) => [r.status, r.json.error]), [403, 'Shipped templates stay as they are; copy one to change it.']);
    assert.equal((await call(server, 'out', 'POST', '/api/environment/templates', { cookie: owner, body: { from: 'everything', id: 'all-mine', name: 'All mine' } })).status, 201);
    assert.equal((await call(server, 'out', 'DELETE', '/api/environment/templates/all-mine', { cookie: owner })).status, 200);
    assert.equal((await call(server, 'out', 'DELETE', '/api/environment/templates/outings', { cookie: owner })).status, 200);
    assert.equal((await console_('DELETE', '/api/host/templates/everything')).status, 200);
    // A template the host hid is no template at all to an owner who does not use it: 404 on every route, delete included.
    assert.equal((await console_('POST', '/api/host/templates/travel/duplicate', { id: 'secret-plan', name: 'Secret plan' })).status, 201);
    assert.equal((await console_('PATCH', '/api/host/templates/secret-plan', { hidden: true })).status, 200);
    for (const [method, url, body] of [['GET', '/api/environment/templates/secret-plan'], ['PATCH', '/api/environment/templates/secret-plan', { name: 'x' }], ['DELETE', '/api/environment/templates/secret-plan'], ['GET', '/api/templates/secret-plan/export']]) {
      assert.deepEqual(await call(server, 'out', method, url, { cookie: owner, body }).then((r) => [r.status, r.json]), [404, { error: 'There is no template called secret-plan.' }], `${method} ${url}`);
    }
    assert.equal((await console_('DELETE', '/api/host/templates/secret-plan')).status, 200);
    // A host template body with an unknown or old field is refused, never dropped.
    const old = await console_('POST', '/api/host/templates', { id: 'old-shape', name: 'Old', description: 'Old.', modules: { chat: {} }, verbs: { enter: 'Board' } });
    assert.deepEqual([old.status, old.json.error.slice(0, 32)], [400, '"verbs" is not a template field;']);
  });

  await test('duplicate makes a host template at version 1 from the template in use; a taken id is refused', async () => {
    const before = (await travelRow()).version;
    const copy = await console_('POST', '/api/host/templates/travel/duplicate', { id: 'day-trips', name: 'Day trips' });
    assert.equal(copy.status, 201, copy.text);
    assert.deepEqual([copy.json.template.source, copy.json.template.version, copy.json.template.hidden, copy.json.template.id, copy.json.template.name], ['host', 1, false, 'day-trips', 'Day trips']);
    assert.deepEqual(copy.json.template.words, { space: { one: 'journey', many: 'journeys' } });
    assert.ok('whiteboard' in copy.json.template.modules);
    assert.equal((await travelRow()).version, before, 'the original is unchanged');
    const again = await console_('POST', '/api/host/templates/day-trips/duplicate', { id: 'day-trips-2', name: 'Day trips two' });
    assert.equal(again.status, 201, again.text);
    assert.deepEqual([again.json.template.version, again.json.template.words, again.json.template.modules], [1, copy.json.template.words, copy.json.template.modules]);
    assert.deepEqual(await console_('POST', '/api/host/templates/travel/duplicate', { id: 'day-trips', name: 'Taken' }).then((r) => [r.status, r.json.error]), [409, 'There is already a template called day-trips.']);
    const renamed = await console_('PATCH', '/api/host/templates/day-trips', { name: 'Day trips edited' });
    assert.deepEqual([renamed.status, renamed.json.template.version, renamed.json.template.name], [200, 2, 'Day trips edited']);
    assert.equal((await travelRow()).name, 'Travel');
  });

  await test('a space\'s own template (hosted): a host template a space names cannot be deleted, and usedBySpaces counts it', async () => {
    const owner = cookieOf(await call(server, 'out', 'POST', '/api/login', { body: { login: 'owner', password: 'owner-password-1' } }));
    const row = async () => (await console_('GET', '/api/host/templates')).json.templates.find((t) => t.id === 'day-trips-2');
    assert.equal((await row()).usedBySpaces, 0);
    const made = await call(server, 'out', 'POST', '/api/spaces', { cookie: owner, body: { name: 'Own words', template: 'day-trips-2' } });
    assert.equal(made.status, 200, made.text);
    assert.equal((await row()).usedBySpaces, 1);
    assert.deepEqual((await row()).usedBy, [], 'no environment is made from it');
    const refused = await console_('DELETE', '/api/host/templates/day-trips-2');
    assert.equal(refused.status, 409);
    assert.match(refused.json.error, /^Environments or spaces use this template: .+\. Hide it instead\.$/);
    const read = await call(server, 'out', 'GET', `/api/spaces/${made.json.space.id}`, { cookie: owner });
    assert.equal(read.json.space.template, 'day-trips-2');
    assert.equal(read.json.look.words.space.one, 'journey');
    // Another environment's own space is not counted against a template it did not choose, and clearing releases the template.
    assert.equal((await call(server, 'out', 'PATCH', `/api/spaces/${made.json.space.id}`, { cookie: owner, body: { template: null } })).status, 200);
    assert.equal((await row()).usedBySpaces, 0);
    assert.equal((await console_('DELETE', '/api/host/templates/day-trips-2')).status, 200);
    assert.equal((await console_('POST', '/api/host/templates/travel/duplicate', { id: 'day-trips-2', name: 'Day trips two' })).status, 201, 'put back for the checks after');
  });

  await test('an edited template exports as its fields alone, and imports under a new id as it was', async () => {
    const file = await console_('GET', '/api/host/templates/travel/export');
    assert.equal(file.status, 200, file.text);
    assert.equal('edited' in file.json, false);
    assert.deepEqual(file.json.words.space, { one: 'journey', many: 'journeys' });
    assert.ok('whiteboard' in file.json.modules);
    const imported = await console_('POST', '/api/host/templates/import?id=from-file', file.json);
    assert.equal(imported.status, 201, imported.text);
    assert.equal(imported.json.template.id, 'from-file');
    assert.deepEqual(imported.json.template.words.space, { one: 'journey', many: 'journeys' });
  });

  await test('hiding a bundled template takes it off the create list and does not raise the version', async () => {
    const version = (await travelRow()).version;
    assert.equal((await console_('PATCH', '/api/host/templates/travel', { hidden: true })).json.template.version, version);
    assert.equal((await call(server, 'admin', 'GET', '/api/product')).json.templates.some((t) => t.id === 'travel'), false);
    const choices = (await console_('GET', '/api/host/environments/out/template')).json.choices;
    assert.ok(choices.some((t) => t.id === 'travel'), 'the environment made from it still sees it');
    assert.equal((await call(server, 'out', 'GET', '/api/branding')).json.words.space.one, 'journey');
    assert.equal((await console_('PATCH', '/api/host/templates/travel', { hidden: false })).json.template.version, version);
  });

  await test('a bundled template cannot be deleted; reset is only for an edited bundled template', async () => {
    assert.deepEqual(await console_('DELETE', '/api/host/templates/travel').then((r) => [r.status, r.json]), [403, { error: "Bundled templates can't be deleted. Hide it instead." }]);
    assert.deepEqual(await console_('DELETE', '/api/host/templates/day-trips/edits').then((r) => [r.status, r.json]), [400, { error: 'Only a bundled template can be reset.' }]);
    assert.deepEqual(await console_('POST', '/api/host/templates/travel/update', { keep: 'later' }).then((r) => [r.status, r.json]), [400, { error: 'keep must be shipped or mine.' }]);
    assert.deepEqual(await console_('POST', '/api/host/templates/travel/update', { keep: 'mine' }).then((r) => [r.status, r.json.error]), [409, 'There is no update to review for Travel.']);
    assert.equal((await console_('POST', '/api/host/templates/no-such/duplicate', { id: 'n', name: 'N' })).status, 404);
  });

  await test('reset brings the shipped template back and the version still rises', async () => {
    const before = (await travelRow()).version;
    const reset = await console_('DELETE', '/api/host/templates/travel/edits');
    assert.equal(reset.status, 200, reset.text);
    assert.equal(reset.json.template.edited, false);
    assert.equal(reset.json.template.version, before + 1);
    assert.notEqual(reset.json.template.version, 1, 'never back to the shipped number');
    assert.equal(reset.json.template.name, 'Travel');
    assert.equal((await call(server, 'out', 'GET', '/api/branding')).json.words.space.one, 'trip');
    assert.deepEqual(await console_('DELETE', '/api/host/templates/travel/edits').then((r) => [r.status, r.json.error]), [409, 'Travel has no edits to reset.']);
  });

  await test('a shipped change with no edits raises the version at start and opens no notice', async () => {
    const before = (await travelRow()).version;
    await restartHost(() => {
      const data = readHost();
      const row = data.bundledEdits.find((r) => r.id === 'travel');
      row.base.fingerprint = 'stale-fingerprint';
      data.bundledEdits.push({ id: 'retired', template: { id: 'retired', name: 'Retired', description: 'Gone.', modules: { chat: {} } }, version: 2, base: { version: 1, fingerprint: 'x', whole: 'y' }, hidden: false, updatedAt: '2026-09-26T00:00:00.000Z' });
      fs.writeFileSync(path.join(hosted, 'host.json'), JSON.stringify(data, null, 2));
    });
    assert.ok(server.output().includes('The bundled template "retired" is no longer shipped; its edits are left unused.'));
    const row = await travelRow();
    assert.deepEqual([row.version, row.edited, row.update, row.name], [before + 1, false, null, 'Travel']);
    assert.equal((await console_('GET', '/api/host/templates')).json.templates.some((t) => t.id === 'retired'), false);
  });

  await test('a shipped change with edits keeps them and opens the notice; keep mine, then take the new version', async () => {
    const edited = await console_('PATCH', '/api/host/templates/travel', { name: 'Journeys', words: { space: { one: 'journey', many: 'journeys' } } });
    assert.equal(edited.json.template.edited, true);
    const version = edited.json.template.version;
    await restartHost(() => {
      const data = readHost();
      data.bundledEdits.find((r) => r.id === 'travel').base.whole = 'stale-whole';
      fs.writeFileSync(path.join(hosted, 'host.json'), JSON.stringify(data, null, 2));
    });
    let row = await travelRow();
    assert.deepEqual([row.name, row.edited, row.version, row.update], ['Journeys', true, version, { shippedVersion: travelRaw.version || 1 }]);
    const mine = await console_('POST', '/api/host/templates/travel/update', { keep: 'mine' });
    assert.deepEqual([mine.status, mine.json.template.version, mine.json.template.edited, mine.json.template.update, mine.json.template.name], [200, version, true, null, 'Journeys'], mine.text);
    await restartHost(() => {
      const data = readHost();
      data.bundledEdits.find((r) => r.id === 'travel').base.fingerprint = 'stale-fingerprint';
      fs.writeFileSync(path.join(hosted, 'host.json'), JSON.stringify(data, null, 2));
    });
    row = await travelRow();
    assert.deepEqual([row.update, row.name, row.version], [{ shippedVersion: travelRaw.version || 1 }, 'Journeys', version]);
    const shipped = await console_('POST', '/api/host/templates/travel/update', { keep: 'shipped' });
    assert.equal(shipped.status, 200, shipped.text);
    assert.equal(shipped.json.template.edited, false);
    assert.equal(shipped.json.template.version, version + 1);
    assert.equal(shipped.json.template.name, 'Travel');
    assert.equal(shipped.json.template.update, null);
    assert.equal((await call(server, 'out', 'GET', '/api/branding')).json.words.space.one, 'trip');
  });

  await test('a shipped change to a live part only (phase icons): never-edited copy updates silently, an edited one gets the notice once, and nothing is applied again', async () => {
    // The shipped file as an older version had it: no phase icons. Only the whole-template fingerprint can tell; what is
    // applied once (modules, settings, Lobby, space defaults, workspace, reactions, icon set) must be the same.
    const shipped = templates.get('travel');
    const old = { ...shipped, version: 5, phases: shipped.phases.map(({ icon, ...rest }) => rest) };
    assert.equal(templates.appliedOnceFingerprint(old), templates.appliedOnceFingerprint(shipped), 'icons on phases are not an applied-once part');
    assert.deepEqual(templates.partFingerprints(old), templates.partFingerprints(shipped));
    assert.notEqual(templates.wholeFingerprint(old), templates.wholeFingerprint(shipped), 'but the whole template differs');
    const base5 = { version: 5, fingerprint: templates.appliedOnceFingerprint(old), whole: templates.wholeFingerprint(old) };
    const owner = cookieOf(await call(server, 'out', 'POST', '/api/login', { body: { login: 'owner', password: 'owner-password-1' } }));
    const offerOpen = async () => (await call(server, 'out', 'GET', '/api/environment/template', { cookie: owner })).json.template.offerOpen;
    assert.equal(await offerOpen(), false, 'before');
    // Never edited: the host recorded version 5 as its base.
    const was = (await travelRow());
    assert.equal(was.edited, false);
    await restartHost(() => {
      const data = readHost();
      data.bundledEdits.find((r) => r.id === 'travel').base = base5;
      fs.writeFileSync(path.join(hosted, 'host.json'), JSON.stringify(data, null, 2));
    });
    let row = await travelRow();
    assert.deepEqual([row.edited, row.update, row.version], [false, null, was.version + 1], 'silent: the version rises, no notice');
    assert.deepEqual((await call(server, 'out', 'GET', '/api/branding')).json.phases.map((p) => p.icon), ['clipboard-list', 'ticket', 'hourglass-half', 'suitcase-rolling', 'plane', 'camera']);
    const ownerAgain = cookieOf(await call(server, 'out', 'POST', '/api/login', { body: { login: 'owner', password: 'owner-password-1' } }));
    const tab = await call(server, 'out', 'GET', '/api/environment/template', { cookie: ownerAgain });
    assert.equal(tab.json.template.offerOpen, false, 'nothing applied once changed, so no offer to apply again');
    // Edited: the owner of the template keeps their edit and sees the notice once.
    const edited = await console_('PATCH', '/api/host/templates/travel', { name: 'Journeys' });
    assert.equal(edited.json.template.edited, true);
    await restartHost(() => {
      const data = readHost();
      data.bundledEdits.find((r) => r.id === 'travel').base = base5;
      fs.writeFileSync(path.join(hosted, 'host.json'), JSON.stringify(data, null, 2));
    });
    row = await travelRow();
    assert.deepEqual([row.name, row.edited, row.version, row.update], ['Journeys', true, edited.json.template.version, { shippedVersion: travelRaw.version }], 'the notice opens');
    const mine = await console_('POST', '/api/host/templates/travel/update', { keep: 'mine' });
    assert.deepEqual([mine.status, mine.json.template.update, mine.json.template.name], [200, null, 'Journeys'], 'once: keeping the edit closes it');
    await restartHost();
    assert.equal((await travelRow()).update, null, 'and it stays closed');
    await console_('DELETE', '/api/host/templates/travel/edits');
  });

  await server.stop();
  server = null;
  await test('a single install has none of the bundled-edit routes', async () => {
    const single = path.join(base, 'single');
    await boot(single, { ADMIN_PASSWORD: 'admin-password-1' });
    for (const [method, url] of [['GET', '/api/host/templates'], ['PATCH', '/api/host/templates/travel'], ['DELETE', '/api/host/templates/travel/edits'], ['POST', '/api/host/templates/travel/update'], ['POST', '/api/host/templates/travel/duplicate']]) {
      const res = await call(server, '', method, url, { body: method === 'GET' ? undefined : {} });
      assert.equal(res.status, 404, `${method} ${url} -> ${res.status} ${res.text}`);
    }
    await server.stop();
    server = null;
  });
  await test('an empty or blank PRODUCT_NAME is the default everywhere: branding answers what productName() gives, and the environment takes it as its name', async () => {
    const { productName } = require('../server/product-name.js');
    for (const [i, blank] of ['', '   '].entries()) {
      await boot(path.join(base, `blank-name-${i}`), { ADMIN_PASSWORD: 'admin-password-1', PRODUCT_NAME: blank });
      const saved = process.env.PRODUCT_NAME;
      process.env.PRODUCT_NAME = blank;
      const expected = productName();
      if (saved === undefined) delete process.env.PRODUCT_NAME; else process.env.PRODUCT_NAME = saved;
      const branding = (await call(server, '', 'GET', '/api/branding')).json;
      assert.ok(expected.trim(), 'productName() falls back to the default');
      assert.deepEqual([branding.productName, branding.environmentName], [expected, expected], JSON.stringify(blank));
      await server.stop();
      server = null;
    }
  });
} finally {
  if (server) await server.stop();
  fs.rmSync(base, { recursive: true, force: true });
}
if (failed) {
  console.error(`check-templates: ${failed} group${failed === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log(`check-templates: OK (${n} groups, ${templates.list().length} template${templates.list().length === 1 ? '' : 's'})`);
process.exit(0);
