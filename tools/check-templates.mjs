#!/usr/bin/env node
/*
 * check-templates.mjs -- the bundled environment templates (templates/<id>.json; documentation/plans/
 * plan-environment-templates.md, "check-templates"): each is valid by the server's own rules (server/templates.js), a
 * template that breaks one is refused with its sentence, and applying one to a throwaway environment gives the same
 * result twice, with a module the plan leaves out recorded as skipped. The enter verb (addendum 4): the template field's
 * rules, the owner's over the template's over the default, PATCH /api/settings's refusals, and a host edit live at once.
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
const { buildEnvironment } = require('../server/environment.js');
const { bundledModules } = require('../server/module-build.js');
const { LOBBY } = require('../server/store.js');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-templates: ${name}: ${err.stack || err.message}`); }
};
const bundled = bundledModules(path.join(ROOT, 'modules')).map((m) => m.id);
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
function call(server, host, method, urlPath, { body, cookie } = {}) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { host: host ? `${host}.localhost:${server.port}` : `127.0.0.1:${server.port}`, accept: 'application/json' };
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

try {
  await test('every bundled template is valid, and the server loads them all', () => {
    const loaded = templates.loadTemplates();
    const files = fs.readdirSync(path.join(ROOT, 'templates')).filter((f) => f.endsWith('.json'));
    assert.equal(loaded.size, files.length);
    for (const f of files) assert.deepEqual(templates.problemsOf(JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', f), 'utf8')), { file: f, bundled }), [], f);
    assert.deepEqual(templates.list().map((t) => t.id), [...loaded.keys()]);
  });

  await test('the travel template is the one decided (decisions 10 and 17)', () => {
    const t = templates.get('travel');
    assert.deepEqual(t.words, { space: { one: 'trip', many: 'trips' } });
    assert.equal(t.verbs, null, 'Travel sets no verb (addendum 4, decision 3): it reads the default');
    assert.equal('verbs' in travelRaw, false, 'travel.json has no verbs entry');
    assert.deepEqual(t.modules, ['travel', 'places', 'maps', 'research', 'vault', 'calendar', 'budget', 'polls', 'todo', 'chat', 'conference']);
    assert.deepEqual([t.moduleNames.travel, t.moduleNames.vault, t.icons.home, t.lobby.name, t.lobby.description, t.spaceDefaults.profile], ['Itinerary', 'Documents', 'suitcase-rolling', 'Home base', 'Everyone on every trip.', 'participants']);
    assert.deepEqual(t.spaceDefaults.opensWith, ['travel', 'chat']);
    assert.equal(t.version, 8);
    // Version 6: each phase has a Font Awesome Free solid icon that can be drawn (the server's own drawable() test).
    assert.deepEqual(t.phases.map((p) => [p.id, p.icon]), [['planning', 'clipboard-list'], ['booking', 'ticket'], ['buffer', 'hourglass-half'], ['pre-trip', 'suitcase-rolling'], ['trip', 'plane'], ['post-trip', 'camera-retro']]);
    for (const p of travelRaw.phases) assert.ok(fs.existsSync(path.join(ROOT, 'node_modules', '@fortawesome', 'fontawesome-free', 'svgs', 'solid', `${p.icon}.svg`)), `${p.id}: ${p.icon} is not a drawable icon`);
    assert.deepEqual(templates.problemsOf(travelRaw, { file: 'travel.json', bundled }), [], 'every phase icon passes the server\'s check');
    // plan-calendar-destination.md, decision 12, and plan-map-destination.md, decision 17: Show Calendar and Show Map
    // are on for Travel (applied once, as template settings are).
    // plan-space-calendars.md, decision 7: private addresses and other calendars on for Travel too (version 5).
    assert.deepEqual(t.settings, { showCalendar: true, showMap: true, calendarFeeds: true, otherCalendars: true });
    assert.deepEqual(t.phases.map((p) => p.id), ['planning', 'booking', 'buffer', 'pre-trip', 'trip', 'post-trip']);
    assert.equal(t.phases.find((p) => p.main).id, 'trip');
  });


  await test('a template that breaks a rule is refused, each with its sentence', () => {
    const with_ = (patch) => ({ ...structuredClone(travelRaw), ...patch });
    const problems = (raw, file = 'travel.json') => templates.problemsOf(raw, { file, bundled });
    const cases = [
      [with_({ modules: ['travel', 'conference'] }), 'modules: "chat" must be listed; Chat can\'t be switched off yet.'],
      [with_({ modules: ['travel', 'chat', 'nope'] }), 'modules: "nope" is not a bundled or built-in module.'],
      [with_({ modules: ['chat', 'chat'] }), 'modules: "chat" is listed twice.'],
      [with_({ words: { host: { one: 'boss', many: 'bosses' } } }), 'words: "host" is the host\'s own word and a template can\'t change it.'],
      [with_({ words: { admin: { one: 'chief', many: 'chiefs' } } }), 'words: "admin" is the host\'s own word and a template can\'t change it.'],
      [with_({ words: { lobby: { one: 'a', many: 'b' } } }), 'words: there is no word called "lobby"; the words are environment, space, home, aside, canvas, module, object, owner, moderator, member, guest.'],
      [with_({ words: { space: { one: 'trip' } } }), 'words: The word for space needs both its singular and its plural.'],
      [with_({ words: { home: { one: 'Campaigns' } } }), 'words: The word for the home page needs both its singular and its plural.'],
      [with_({ words: { home: { one: 'Camp<b>', many: 'Campaigns' } } }), 'words: The word for the home page can use only letters, spaces, hyphens and apostrophes.'],
      [with_({ verbs: ['Enter'] }), '"verbs" must be an object of verbs by name.'],
      [with_({ verbs: { join: 'Join' } }), 'verbs: there is no verb called "join"; the verbs are enter, layout.'],
      [with_({ verbs: { enter: 'Board the flight right now' } }), 'verbs: The enter verb must be 1 to 20 characters.'],
      [with_({ verbs: { enter: '  ' } }), 'verbs: The enter verb must be 1 to 20 characters.'],
      [with_({ verbs: { enter: 'Go!' } }), 'verbs: The enter verb can use only letters, spaces, hyphens and apostrophes.'],
      [with_({ verbs: { enter: 42 } }), 'verbs: The enter verb must be text.'],
      [with_({ verbs: { enter: null } }), 'verbs: The enter verb must be text.'],
      [with_({ icons: { home: 'discord' } }), 'icons.home: "discord" is not a Font Awesome Free solid icon.'],
      [with_({ icons: { home: 'no-such-icon-at-all' } }), 'icons.home: "no-such-icon-at-all" is not a Font Awesome Free solid icon.'],
      [with_({ moduleIcons: { travel: 'fa-route' } }), 'moduleIcons.travel: "fa-route" is not a Font Awesome Free solid icon.'],
      [with_({ moduleNames: { travel: '<b>Trips</b>' } }), 'moduleNames.travel: A display name is plain text, without < or >.'],
      [with_({ moduleNames: { nope: 'Nope' } }), 'moduleNames: "nope" is not a bundled or built-in module.'],
      [with_({ settings: { environmentName: 'x' } }), 'settings: "environmentName" is not a setting a template can give; those are language, clock, currency, loginText, allowRegistration, mfaRequired, maxQuality, allowScreenShare, allowAsides, allowPrivate, allowReactions, showCalendar, showMap, calendarFeeds, otherCalendars, publishedCalendar, activeThemeId, themeMode.'],
      [with_({ settings: { clock: 24 } }), 'settings: 24 is not a value "clock" takes.'],
      [with_({ spaceDefaults: { profile: 'players' } }), 'spaceDefaults.profile must be one of roleplaying, participants, characters.'],
      [with_({ lobby: { name: 'x'.repeat(41) } }), 'lobby.name must be text of 1 to 40 characters.'],
      [with_({ plan: 'pro' }), '"plan" is not a template field; the fields are id, name, description, version, words, verbs, phases, icons, moduleNames, moduleIcons, modules, settings, lobby, spaceDefaults, reactions, theme, iconSet.'],
    ];
    for (const [raw, sentence] of cases) assert.deepEqual(problems(raw), [sentence], sentence);
    assert.deepEqual(problems(travelRaw, 'trips.json'), ['"id" must match the file\'s name (trips.json).']);
    // A server with an invalid template in its folder does not start (loadTemplates throws, naming the file).
    const dir = path.join(base, 'bad-templates');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'travel.json'), JSON.stringify(with_({ modules: ['travel'] })));
    assert.throws(() => templates.loadTemplates({ dir }), /templates\/travel\.json: modules: "chat" must be listed/);
  });

  await test('verbs (addendum 4): a live part, tidied, left out of an export when unset, and not in what a version bump guards', () => {
    const with_ = (patch) => ({ ...structuredClone(travelRaw), ...patch });
    assert.deepEqual(templates.problemsOf(with_({ verbs: { enter: 'Go to' } }), { file: 'travel.json', bundled }), [], 'a valid verb');
    assert.deepEqual(templates.problemsOf(with_({ verbs: {} }), { file: 'travel.json', bundled }), [], 'an empty set');
    // The space bar's Layout button: a verb of its own, set the same way.
    assert.deepEqual(templates.problemsOf(with_({ verbs: { layout: 'Arrange' } }), { file: 'travel.json', bundled }), [], 'a valid layout verb');
    assert.deepEqual(templates.problemsOf(with_({ verbs: { layout: 'Lay out!' } }), { file: 'travel.json', bundled }), ['verbs: The layout verb can use only letters, spaces, hyphens and apostrophes.']);
    assert.deepEqual(templates.cleanTemplate(with_({ verbs: { enter: 'Board', layout: ' My  view ' } })).verbs, { enter: 'Board', layout: 'My view' }, 'both, tidied');
    assert.deepEqual(templates.cleanTemplate(with_({ verbs: { enter: '  Go   to ' } })).verbs, { enter: 'Go to' }, 'tidied');
    const { verbs: _v, ...without } = travelRaw;
    assert.equal(templates.cleanTemplate(without).verbs, null, 'none set: null');
    assert.equal(templates.cleanTemplate(with_({ verbs: {} })).verbs, null, 'an empty set: null');
    const templateFile = require('../server/template-file.js');
    assert.equal('verbs' in templateFile.templateToFile(templates.cleanTemplate(without)), false, 'an export leaves it out when unset');
    const file = templateFile.templateToFile(templates.cleanTemplate(with_({ verbs: { enter: 'Board' } })));
    assert.deepEqual([file.verbs, file.format, file.formatVersion], [{ enter: 'Board' }, 'template', 1], 'and carries it when set, the format unchanged');
    assert.deepEqual(templateFile.readTemplateFile(JSON.stringify(file), { bundled }).raw.verbs, { enter: 'Board' }, 'an import reads it back');
    // Live, so not a part a switch offers or a version bump guards; the whole fingerprint (addendum 3's notice) sees it.
    assert.equal(templates.PARTS.includes('verbs'), false);
    const a = templates.cleanTemplate(with_({ verbs: { enter: 'Enter' } }));
    const b = templates.cleanTemplate(with_({ verbs: { enter: 'Board' } }));
    assert.equal(templates.appliedOnceFingerprint(a), templates.appliedOnceFingerprint(b), 'the applied-once fingerprint ignores it');
    assert.deepEqual(templates.partFingerprints(a), templates.partFingerprints(b));
    assert.notEqual(templates.wholeFingerprint(a), templates.wholeFingerprint(b), 'the whole fingerprint sees it');
    // A template without verbs keeps the whole fingerprint it had before the field existed.
    const c = templates.cleanTemplate(without);
    const crypto = require('node:crypto');
    const before = crypto.createHash('sha256').update(JSON.stringify(templates.FIELDS.filter((k) => k !== 'version' && k !== 'verbs').map((k) => c[k] ?? null))).digest('hex').slice(0, 16);
    assert.equal(templates.wholeFingerprint(c), before);
  });

  await test('the live part: the verb, the owner\'s over the template\'s over the default', () => {
    const travel = templates.get('travel');
    const env = freshEnvironment('live-verbs');
    assert.deepEqual([env.store.resolvedVerbs(), env.store.ownVerbs(), env.store.templateVerbsView()], [{ enter: 'Enter', layout: 'Layout' }, {}, null], 'no template: the default');
    templates.useLive(env.store, { ...travel, verbs: { enter: 'Board' } });
    assert.deepEqual([env.store.resolvedVerbs(), env.store.templateVerbsView()], [{ enter: 'Board', layout: 'Layout' }, { enter: 'Board' }], 'the template\'s');
    env.store.updateSettings({ verbs: { enter: ' Go  to ' } });
    assert.deepEqual([env.store.resolvedVerbs(), env.store.ownVerbs(), env.store.settings.verbs], [{ enter: 'Go to', layout: 'Layout' }, { enter: 'Go to' }, { enter: 'Go to' }], 'the owner\'s wins, tidied');
    assert.deepEqual(env.store.templateVerbsView(), { enter: 'Board' }, 'the template\'s stays readable under it');
    const refused = (patch) => { try { env.store.updateSettings(patch); return null; } catch (err) { return err.message; } };
    assert.equal(refused({ verbs: { enter: 'x'.repeat(21) } }), 'The enter verb must be 1 to 20 characters.');
    assert.equal(refused({ verbs: { enter: '' } }), 'The enter verb must be 1 to 20 characters.');
    assert.equal(refused({ verbs: { enter: 'Go!' } }), 'The enter verb can use only letters, spaces, hyphens and apostrophes.');
    assert.equal(refused({ verbs: { enter: 5 } }), 'The enter verb must be text, or null to use the default.');
    assert.equal(refused({ verbs: { enter: { one: 'Go' } } }), 'The enter verb must be text, or null to use the default.');
    assert.equal(refused({ verbs: { join: 'Join' } }), 'There is no verb called join; the verbs are enter, layout.');
    assert.equal(refused({ verbs: 'Enter' }), 'Verbs must be given by name, each as text.');
    assert.equal(refused({ verbs: ['Enter'] }), 'Verbs must be given by name, each as text.');
    assert.equal(refused({ verbs: { join: 'Join' }, environmentName: 'Changed' }), 'There is no verb called join; the verbs are enter, layout.');
    assert.notEqual(env.store.settings.environmentName, 'Changed', 'a refused verb refuses the whole patch');
    assert.equal(env.store.resolvedVerbs().enter, 'Go to', 'nothing changed');
    env.store.updateSettings({ verbs: { enter: null } });
    assert.deepEqual([env.store.resolvedVerbs().enter, env.store.ownVerbs(), 'verbs' in env.store.settings], ['Board', {}, false], 'null goes back to the template\'s, and leaves the settings');
    // The layout verb (the space bar's Layout button) resolves the same way, each key on its own.
    templates.useLive(env.store, { ...travel, verbs: { layout: 'Arrange' } });
    assert.deepEqual([env.store.resolvedVerbs(), env.store.templateVerbsView()], [{ enter: 'Enter', layout: 'Arrange' }, { layout: 'Arrange' }], 'the template\'s layout verb');
    env.store.updateSettings({ verbs: { layout: 'My view' } });
    assert.deepEqual([env.store.resolvedVerbs(), env.store.ownVerbs()], [{ enter: 'Enter', layout: 'My view' }, { layout: 'My view' }], 'the owner\'s over it');
    assert.equal(refused({ verbs: { layout: 'Go!' } }), 'The layout verb can use only letters, spaces, hyphens and apostrophes.');
    env.store.updateSettings({ verbs: { layout: null } });
    assert.deepEqual([env.store.resolvedVerbs().layout, 'verbs' in env.store.settings], ['Arrange', false], 'null: the template\'s again');
    templates.useLive(env.store, travel);
    assert.deepEqual([env.store.resolvedVerbs().enter, env.store.templateVerbsView()], ['Enter', {}], 'Travel sets none: the default');
    templates.useLive(env.store, { ...travel, verbs: null });
    assert.deepEqual([env.store.resolvedVerbs().enter, env.store.templateVerbsView()], ['Enter', {}], 'a template without verbs: the default');
    templates.useLive(env.store, null);
  });

  await test('a phase list that breaks a rule is refused, and opensWith is offered when its fingerprint changes', async () => {
    const with_ = (patch) => ({ ...structuredClone(travelRaw), ...patch });
    const problems = (raw) => templates.problemsOf(raw, { bundled });
    const phase = (id, extra = {}) => ({ id, label: id[0].toUpperCase() + id.slice(1), ...extra });
    assert.deepEqual(problems(with_({ phases: [phase('planning'), phase('planning')] })), ['phases: "planning" is listed twice.']);
    assert.deepEqual(problems(with_({ phases: [phase('planning', { main: true }), phase('booking', { main: true })] })), ['phases: only one phase can be the main one.']);
    assert.deepEqual(problems(with_({ phases: Array.from({ length: 13 }, (_, i) => phase(`p${i}`)) })), ['"phases" must be a list of at most 12 phases.']);
    assert.deepEqual(problems(with_({ phases: [{ id: 'planning', label: 'x'.repeat(41) }] })), ['phases[0]: a label is text of 1 to 40 characters.']);
    assert.deepEqual(problems(with_({ phases: [{ id: 'planning', label: 'Planning', note: 'x' }] })), ['phases[0]: "note" is not a phase field; a phase takes id, label, main and icon.']);
    // An optional icon: a good one is kept, a bad one refuses the template, none leaves the phase as it was.
    assert.deepEqual(problems(with_({ phases: [phase('planning', { icon: 'plane' })] })), []);
    assert.deepEqual(templates.cleanTemplate(with_({ phases: [phase('planning', { icon: 'plane' })] })).phases, [{ id: 'planning', label: 'Planning', icon: 'plane' }]);
    assert.deepEqual(problems(with_({ phases: [phase('planning', { icon: 'no-such-icon-xyz' })] })), ['phases[0]: icon "no-such-icon-xyz" is not a Font Awesome Free solid icon.']);
    assert.deepEqual(problems(with_({ phases: [phase('planning', { icon: 5 })] })), ['phases[0]: icon "5" is not a Font Awesome Free solid icon.']);
    assert.deepEqual(templates.cleanTemplate(with_({ phases: [phase('planning')] })).phases, [{ id: 'planning', label: 'Planning' }]);
    assert.deepEqual(problems(with_({ spaceDefaults: { opensWith: ['chat', 1] } })), ['spaceDefaults.opensWith: 1 is not a module id.']);
    const withoutOpen = templates.cleanTemplate(with_({ spaceDefaults: { profile: 'participants' } }));
    const withOpen = templates.cleanTemplate(with_({ spaceDefaults: { profile: 'participants', opensWith: ['travel', 'chat'] } }));
    assert.notEqual(templates.appliedOnceFingerprint(withoutOpen), templates.appliedOnceFingerprint(withOpen));
    assert.equal(templates.appliedOnceFingerprint(templates.cleanTemplate(with_({ phases: [] }))), templates.appliedOnceFingerprint(templates.cleanTemplate(with_({ phases: [phase('planning')] }))), 'phases follow the template live');
    const env = freshEnvironment('opens-with');
    env.store.updateSettings({ spaceDefaults: { profile: 'participants' } });
    const travel = templates.get('travel');
    const old = templates.partFingerprints(withoutOpen);
    assert.deepEqual(templates.offerFor(env, travel, { applied: old }).spaceDefaults, { opensWith: ['travel', 'chat'] });
    await templates.applyOffer(env, travel, { spaceDefaults: true });
    assert.deepEqual(env.store.settings.spaceDefaults, { profile: 'participants', opensWith: ['travel', 'chat'] });
    assert.equal(templates.offerFor(env, travel).spaceDefaults, null);
    templates.useLive(env.store, travel);
    assert.equal(env.store.templatePhases.find((p) => p.main).id, 'trip');
    templates.useLive(env.store, null);
    assert.equal(env.store.templatePhases, null);
  });

  // The once-only part, twice: the same environment either way (only the time it was applied differs).
  const snapshot = (env) => {
    const app = JSON.parse(fs.readFileSync(path.join(env.store.dir, 'app.json'), 'utf8'));
    const registry = JSON.parse(fs.readFileSync(path.join(env.modules.dir, 'registry.json'), 'utf8'));
    const lobby = app.spaces.find((s) => s.id === LOBBY);
    return {
      settings: { conferenceEnabled: app.settings.conferenceEnabled, homeIcon: app.settings.homeIcon, spaceDefaults: app.settings.spaceDefaults, icons: app.settings.icons.map((i) => i.id) },
      lobby: [lobby.name, lobby.description],
      modules: Object.fromEntries(Object.entries(registry.modules).map(([id, e]) => [id, [e.version, e.enabled]])),
    };
  };
  const travel = templates.get('travel');
  await test('applying twice gives the same environment: settings, the Lobby, space defaults, icons, modules on in every space', async () => {
    const env = freshEnvironment('twice');
    env.modules.aiReady = () => true; // an AI service set up, so Research can be on
    const first = await templates.applyTemplate(env, travel);
    const once = snapshot(env);
    const second = await templates.applyTemplate(env, travel);
    assert.deepEqual(second, first);
    assert.deepEqual(snapshot(env), once);
    assert.deepEqual(first, []);
    assert.deepEqual(once.lobby, ['Home base', 'Everyone on every trip.']);
    assert.deepEqual([once.settings.conferenceEnabled, once.settings.homeIcon, once.settings.spaceDefaults], [true, null, { profile: 'participants', opensWith: ['travel', 'chat'] }]);
    assert.ok(once.settings.icons.includes('suitcase-rolling'), 'the home icon joins the icon list');
    for (const id of ['travel', 'places', 'maps', 'research', 'calendar']) assert.deepEqual(once.modules[id].slice(1), [true], id);
    assert.equal(env.modules.isInstalled('assistant'), false, 'a new install leaves the Assistant out');
    assert.equal(env.modules.enabled('maps') !== null, true, 'Maps runs (Places, which it needs, came first)');
    assert.equal(env.store.addSpace({ name: 'Lisbon' }).profile, 'participants', 'a new trip starts with the Participants profile');
    assert.equal(env.store.addSpace({ name: 'Game night', profile: 'roleplaying' }).profile, 'roleplaying', 'unless told otherwise');
    const before = JSON.stringify(env.store.settings);
    assert.throws(() => env.store.updateSettings({ spaceDefaults: { profile: 'characters', evil: 1 }, clock: '24' }), (err) => err.status === 400 && err.message === 'spaceDefaults takes only profile and opensWith.');
    assert.throws(() => env.store.updateSettings({ spaceDefaults: 'characters' }), /spaceDefaults takes only profile and opensWith\./);
    assert.throws(() => env.store.updateSettings({ spaceDefaults: { opensWith: [1] }, clock: '24' }), (err) => err.status === 400 && err.message === 'spaceDefaults.opensWith: 1 is not a module id.');
    assert.equal(JSON.stringify(env.store.settings), before, 'a refused change changes nothing');
    env.store.updateSettings({ spaceDefaults: null });
    assert.equal('spaceDefaults' in env.store.settings, false, 'null clears it');
    assert.equal('spaceDefaults' in JSON.parse(fs.readFileSync(path.join(env.store.dir, 'app.json'), 'utf8')).settings, false, 'on disk too');
    assert.equal(env.store.addSpace({ name: 'Later' }).profile, 'roleplaying');
  });

  await test('Research, which uses the AI service only when it is on, is on in every space with no AI service', async () => {
    const env = freshEnvironment('no-ai');
    assert.deepEqual(await templates.applyTemplate(env, travel), []);
    const research = env.modules.view('research');
    assert.deepEqual([research.enabled, research.missing, research.hooks.ai], [true, [], 'optional']);
  });

  await test('a module the plan leaves out is skipped and recorded; what needs a skipped one is skipped too', async () => {
    const noMaps = freshEnvironment('no-maps');
    noMaps.modules.aiReady = () => true;
    assert.deepEqual(await templates.applyTemplate(noMaps, travel, { allowed: (id) => id !== 'maps' }), [{ id: 'maps', why: 'not in the plan' }]);
    assert.equal(noMaps.modules.isInstalled('maps'), false);
    assert.equal(noMaps.modules.enabled('places') !== null, true);
    const noPlaces = freshEnvironment('no-places');
    noPlaces.modules.aiReady = () => true;
    const skipped = await templates.applyTemplate(noPlaces, travel, { allowed: (id) => id !== 'places', name: (id) => ({ places: 'Places' })[id] || id });
    assert.deepEqual(skipped, [{ id: 'places', why: 'not in the plan' }, { id: 'maps', why: 'needs Places, which was skipped' }]);
  });

  await test('a template that lists the Assistant skips it (retired; ask in Chat with /ai)', async () => {
    const env = freshEnvironment('no-assistant');
    env.modules.aiReady = () => true;
    const skipped = await templates.applyTemplate(env, { ...travel, modules: [...travel.modules, 'assistant'] });
    assert.ok(skipped.some((x) => x.id === 'assistant' && /retired/.test(x.why)), JSON.stringify(skipped));
    assert.equal(env.modules.isInstalled('assistant'), false);
  });

  await test('a template that leaves the conference out switches it off', async () => {
    const env = freshEnvironment('no-conference');
    await templates.applyTemplate(env, { ...travel, modules: ['chat', 'polls'], lobby: {}, settings: { clock: '24', allowAsides: false } });
    assert.deepEqual([env.store.settings.conferenceEnabled, env.store.settings.clock, env.store.settings.allowAsides], [false, '24', false]);
    assert.equal(env.modules.enabled('polls') !== null, true);
  });

  // plan-template-games.md, Decisions (2026-10-21): the games template as decided.
  await test('the games template is the one decided (plan-template-games.md)', async () => {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'games.json'), 'utf8'));
    const t = templates.get('games');
    assert.deepEqual([t.name, t.version, t.description], ['Games', 2, 'Run a campaign together: the chat, the calendar for sessions, a campaign planner, quests, lore and polls, and every player as an OBS source.']);
    assert.deepEqual(Object.fromEntries(Object.entries(t.words).map(([k, v]) => [k, v.one])), { environment: 'group', space: 'campaign', owner: 'game master', aside: 'whisper', member: 'player' });
    for (const k of ['moderator', 'guest', 'canvas', 'module', 'object', 'home']) assert.equal(k in raw.words, false, `${k} keeps its word`);
    assert.deepEqual(t.modules, ['travel', 'calendar', 'polls', 'todo', 'research', 'vault', 'chat', 'conference']);
    for (const off of ['places', 'maps', 'budget', 'assistant']) assert.equal(t.modules.includes(off), false, `${off} is not in the template`);
    assert.deepEqual(t.moduleNames, { travel: 'Campaign planner', calendar: 'Sessions', todo: 'Quests', research: 'Lore', vault: 'Handouts' });
    assert.deepEqual([t.moduleIcons, t.icons.home, t.lobby.name, t.lobby.description], [{ travel: 'scroll' }, 'dice-d20', 'Common room', 'Everyone in every campaign.']);
    assert.deepEqual(t.settings, { showCalendar: true, showMap: false, calendarFeeds: true });
    assert.deepEqual(t.phases, [], 'no phases');
    assert.deepEqual(t.spaceDefaults, { opensWith: ['chat', 'calendar'] });
    for (const icon of ['dice-d20', 'scroll']) assert.ok(fs.existsSync(path.join(ROOT, 'node_modules', '@fortawesome', 'fontawesome-free', 'svgs', 'solid', `${icon}.svg`)), `${icon} is a Font Awesome Free solid icon`);
    assert.deepEqual(templates.problemsOf(raw, { file: 'games.json', bundled }), []);
    // What a person reads, and what a new group is made with.
    const env = freshEnvironment('games');
    env.modules.aiReady = () => true;
    assert.deepEqual(await templates.applyTemplate(env, t), []);
    templates.useLive(env.store, t);
    const w = env.store.resolvedWords();
    assert.deepEqual([w.environment.one, w.space.one, w.home.one, w.home.many, w.owner.one, w.aside.one, w.member.one, w.moderator.one, w.guest.one], ['group', 'campaign', 'Campaigns', 'Campaigns', 'game master', 'whisper', 'player', 'moderator', 'guest']);
    assert.equal(env.store.homeIcon, 'dice-d20');
    assert.deepEqual(['travel', 'calendar', 'todo', 'research'].map((id) => env.store.moduleDisplay(id).name), ['Campaign planner', 'Sessions', 'Quests', 'Lore']);
    assert.equal(env.store.moduleDisplay('travel').icon, 'scroll');
    const snap = snapshot(env);
    assert.deepEqual(snap.lobby, ['Common room', 'Everyone in every campaign.']);
    assert.deepEqual(snap.settings.spaceDefaults, { opensWith: ['chat', 'calendar'] });
    for (const id of ['travel', 'calendar', 'polls', 'todo', 'research']) assert.deepEqual(snap.modules[id].slice(1), [true], id);
    for (const id of ['places', 'maps', 'budget', 'assistant']) assert.equal(snap.modules[id], undefined, `${id} is not installed: offered, off`);
    assert.equal(env.store.addSpace({ name: 'The Ashen Crown' }).profile, 'roleplaying', 'a new campaign keeps the Participant and Character pictures');
  });

  await test('the live part: words, the home icon and module names and icons, the owner\'s over the template\'s', () => {
    const env = freshEnvironment('live');
    env.store.updateSettings({ homeIcon: null }); // as applying the template leaves it: unset, the template's
    templates.useLive(env.store, travel);
    assert.deepEqual(env.store.resolvedWords().space, { one: 'trip', many: 'trips', a: 'a trip' });
    assert.deepEqual([env.store.resolvedWords().home.one, env.store.resolvedWords().home.many], ['Trips', 'Trips'], 'home follows the template\'s space word (plan-primary-nav, decision 13)');
    assert.equal(env.store.homeIcon, 'suitcase-rolling');
    assert.equal(env.store.moduleDisplay('travel').name, 'Itinerary');
    env.store.updateSettings({ words: { space: { one: 'journey', many: 'journeys' } }, homeIcon: 'couch' });
    assert.deepEqual([env.store.resolvedWords().space.one, env.store.homeIcon], ['journey', 'couch']);
    assert.equal(env.store.resolvedWords().home.one, 'Journeys', 'home follows the owner\'s space word over the template\'s');
    templates.useLive(env.store, { ...travel, words: { ...travel.words, home: { one: 'Adventure', many: 'Adventures' } } });
    assert.deepEqual([env.store.resolvedWords().home.many, env.store.resolvedWords().space.one], ['Adventures', 'journey'], 'a template\'s own home wins over any space word');
    env.store.updateSettings({ words: { home: { one: 'Atlas', many: 'Atlases' } } });
    assert.equal(env.store.resolvedWords().home.many, 'Atlases', 'and the owner\'s own over the template\'s');
    env.store.updateSettings({ words: { home: null } });
    templates.useLive(env.store, travel);
    env.store.updateSettings({ words: { space: null }, homeIcon: null });
    assert.deepEqual([env.store.resolvedWords().space.one, env.store.homeIcon], ['trip', 'suitcase-rolling'], 'null goes back to the template\'s');
    // What the template gives stays readable under the owner's own (for Manage's "the template's" hints).
    env.store.updateSettings({ words: { space: { one: 'journey', many: 'journeys' } } });
    env.store.applyModuleDisplay('travel', { name: 'Plans', icon: 'compass' });
    assert.deepEqual([env.store.templateWordsView(), env.store.templateHomeIcon], [{ space: { one: 'trip', many: 'trips' } }, 'suitcase-rolling']);
    const d = env.store.moduleDisplay('travel');
    assert.deepEqual([d.name, d.templateName, d.templateIcon], ['Plans', 'Itinerary', null]);
    assert.equal(env.modules.view('travel'), null, 'not installed here');
    env.store.updateSettings({ words: { space: null } });
    env.store.applyModuleDisplay('travel', { name: null, icon: null });
    templates.useLive(env.store, null);
    assert.deepEqual([env.store.templateWordsView(), env.store.moduleDisplay('travel').templateName], [null, null]);
    assert.deepEqual([env.store.resolvedWords().space.one, env.store.homeIcon, env.store.moduleDisplay('travel').name], ['space', 'couch', null], 'no template: the defaults');
  });

  await test('made from a template, its modules are in every space but the Lobby; the Calendar, made for it, is there too', async () => {
    const env = freshEnvironment('lobby-rule');
    env.modules.aiReady = () => true;
    await templates.applyTemplate(env, travel);
    for (const id of ['travel', 'places', 'maps', 'research']) assert.equal(env.modules.isOnIn(id, LOBBY), false, `${id} not in the Lobby`);
    const trip = env.store.addSpace({ name: 'Lisbon' });
    for (const id of ['travel', 'places', 'maps', 'research', 'calendar']) assert.equal(env.modules.isOnIn(id, trip.id), true, `${id} in a new trip`);
    assert.equal(env.modules.isOnIn('calendar', LOBBY), true, 'the Calendar is allowed in the Lobby, and on');
    const registry = JSON.parse(fs.readFileSync(path.join(env.modules.dir, 'registry.json'), 'utf8')).modules;
    assert.ok(Object.values(registry).every((e) => !(e.spaces || []).includes(LOBBY)), 'nothing adds the Lobby to a module\'s spaces');
  });

  // A switch (the switching addendum): the offer, then only what is confirmed, never turning anything off.
  const switchSnapshot = (env) => ({ ...snapshot(env), words: env.store.settings.words || null });
  await test('a switch offers what the template would add, and applying the confirmed part twice gives the same environment', async () => {
    const env = freshEnvironment('switch');
    env.modules.aiReady = () => true;
    const icons = env.store.iconIds();
    env.store.updateSettings({ homeIcon: icons[icons.length - 1], conferenceEnabled: false, words: { member: { one: 'player', many: 'players' } } });
    const owned = { homeIcon: env.store.settings.homeIcon, words: env.store.settings.words };
    const opts = { allowed: (id) => id !== 'research', name: (id) => `name of ${id}` };
    const offer = templates.offerFor(env, travel, opts);
    assert.deepEqual(offer.modules.map((m) => [m.id, m.allowed, m.why || null]), [['travel', true, null], ['places', true, null], ['maps', true, null], ['research', false, 'not in the plan'], ['vault', true, null], ['calendar', true, null], ['budget', true, null], ['polls', true, null], ['todo', true, null], ['conference', true, null]]);
    assert.equal(offer.modules[0].name, 'name of travel');
    assert.deepEqual(offer.lobby, { name: 'Home base', description: 'Everyone on every trip.' });
    assert.deepEqual(offer.spaceDefaults, { profile: 'participants', opensWith: ['travel', 'chat'] });
    // Only Maps, the conference and the new-space profile ticked (and Research, which the plan refuses, asked for too).
    const confirm = { modules: ['maps', 'conference', 'research', 'not-offered'], lobby: false, spaceDefaults: true };
    const first = await templates.applyOffer(env, travel, confirm, opts);
    const once = switchSnapshot(env);
    assert.deepEqual(first, [{ id: 'research', why: 'not in the plan' }]);
    assert.deepEqual([once.modules.maps.slice(1), once.modules.places.slice(1)], [[true], [true]], 'Maps, with Places which it needs');
    assert.equal(once.modules.travel, undefined, 'the Planner, not ticked, is not installed');
    assert.deepEqual([once.settings.conferenceEnabled, once.settings.spaceDefaults, once.lobby[0]], [true, { profile: 'participants', opensWith: ['travel', 'chat'] }, 'Lobby'], 'the conference on, the profile taken, the Lobby left as it was');
    assert.deepEqual([env.store.settings.homeIcon, env.store.settings.words], [owned.homeIcon, owned.words], 'the owner\'s home icon and words untouched');
    assert.equal(env.modules.isOnIn('maps', LOBBY), false, 'not in the Lobby');
    const second = await templates.applyOffer(env, travel, confirm, opts);
    assert.deepEqual(second, first);
    assert.deepEqual(switchSnapshot(env), once, 'twice: the same');
    // What is left to offer: only what is still missing.
    assert.deepEqual(templates.offerFor(env, travel, opts).modules.map((m) => m.id), ['travel', 'research', 'vault', 'calendar', 'budget', 'polls', 'todo']);
    assert.equal(templates.offerFor(env, travel, opts).spaceDefaults, null);
  });

  await test('a switch never turns the conference or a module off, and nothing ticked changes nothing', async () => {
    const env = freshEnvironment('never-off');
    env.modules.aiReady = () => true; // Research on too (without an AI service it stays off, and a switch offers it)
    await templates.applyTemplate(env, travel);
    const before = snapshot(env);
    const noConference = { ...travel, modules: travel.modules.filter((m) => m !== 'conference' && m !== 'maps') };
    assert.deepEqual(templates.offerFor(env, noConference).modules, [], 'everything it lists is on already');
    assert.deepEqual(await templates.applyOffer(env, noConference, {}), []);
    assert.deepEqual(snapshot(env), before, 'the conference still on, Maps still on');
  });

  await test('the home icon is stored only as the owner\'s choice, so a template\'s shows after a switch; an old stored default is not a choice', async () => {
    const { Store } = require('../server/store.js');
    const fresh = freshEnvironment('home-icon');
    const appFile = path.join(fresh.store.dir, 'app.json');
    assert.equal(JSON.parse(fs.readFileSync(appFile, 'utf8')).settings.homeIcon, null, 'a new environment stores no home icon');
    assert.equal(fresh.store.homeIcon, 'couch', 'and shows the default');
    templates.useLive(fresh.store, travel);
    assert.equal(fresh.store.homeIcon, 'suitcase-rolling', 'a template switched to shows its own');
    fresh.store.updateSettings({ homeIcon: 'couch' });
    assert.equal(fresh.store.homeIcon, 'couch', 'an owner who picks the default keeps it, under a template too');
    assert.equal(new Store(fresh.store.dir).settings.homeIcon, 'couch', 'and after a restart');
    // Data from before: the default stored as if chosen, with no mark that it was looked at.
    const old = JSON.parse(fs.readFileSync(appFile, 'utf8'));
    delete old.settings.homeIconChoiceSeeded;
    fs.writeFileSync(appFile, JSON.stringify(old));
    const reloaded = new Store(fresh.store.dir);
    assert.deepEqual([reloaded.settings.homeIcon, reloaded.settings.homeIconChoiceSeeded], [null, true], 'an old stored default is read as not chosen, once');
    reloaded.templateHomeIcon = 'suitcase-rolling';
    assert.equal(reloaded.homeIcon, 'suitcase-rolling');
    // An old owner's real choice (anything but the default) is kept.
    const chose = JSON.parse(fs.readFileSync(appFile, 'utf8'));
    delete chose.settings.homeIconChoiceSeeded;
    chose.settings.homeIcon = 'suitcase-rolling';
    fs.writeFileSync(appFile, JSON.stringify(chose));
    assert.equal(new Store(fresh.store.dir).settings.homeIcon, 'suitcase-rolling');
  });

  // --- addendum 2: templates grow (#68) -----------------------------------------------------------------------------
  const templateFile = require('../server/template-file.js');
  const set = (over = {}) => ({ 'surface-page': '#ffffff', 'surface-panel': '#f5f7f8', 'edge-hairline': '#dde3e6', 'text-primary': '#222222', 'text-muted': '#6b7479', 'accent-fill': '#1c7c8c', 'text-on-accent': '#ffffff', ...over });
  const harbour = { name: 'Harbour', author: 'Thomas', light: set(), dark: null };
  const grown = (over = {}) => ({ ...structuredClone(travelRaw), id: 'harbour', name: 'Harbour', version: 1, reactions: [{ id: 'wave', glyph: '👋', label: 'Wave' }], theme: harbour, ...over });

  await test('the new fields are checked: version, reactions and an embedded theme (checked as a theme import is)', () => {
    const problems = (raw) => templates.problemsOf(raw, { bundled });
    assert.deepEqual(problems(grown()), []);
    assert.deepEqual(problems(grown({ version: 0 })), ['"version" must be a whole number, 1 or more.']);
    assert.deepEqual(problems(grown({ reactions: [{ label: 'x' }] })), ['reactions[0]: each reaction needs a glyph of 1 to 8 characters.']);
    assert.deepEqual(problems(grown({ reactions: [{ glyph: '👋', size: 3 }] })), ['reactions[0]: a reaction takes only id, glyph and label.']);
    assert.deepEqual(problems(grown({ theme: { ...harbour, light: set({ 'surface-page': 'red; background: url(x)' }) } })), ['theme: This theme has no complete light or dark set: each needs all seven base colors.']);
    assert.deepEqual(problems(grown({ theme: { ...harbour, glow: 1 } })), ['theme: "glow" is not part of a theme.']);
    const clean = templates.cleanTemplate(grown());
    assert.deepEqual([clean.version, clean.reactions[0].id, clean.theme.name, clean.theme.author, clean.theme.light['surface-page']], [1, 'wave', 'Harbour', 'Thomas', '#ffffff']);
    const unversioned = structuredClone(travelRaw);
    delete unversioned.version;
    assert.equal(templates.cleanTemplate(unversioned).version, 1, 'a file without a version is version 1');
  });

  await test('applied once: reactions become the environment\'s, the theme is added and made active; twice gives the same', async () => {
    const env = freshEnvironment('grown');
    env.modules.aiReady = () => true;
    const t = templates.cleanTemplate(grown());
    await templates.applyTemplate(env, t);
    const once = { reactions: env.store.settings.reactions, active: env.store.settings.activeThemeId, themes: env.store.themes.length };
    assert.deepEqual(once.reactions.map((r) => r.id), ['wave']);
    assert.equal(env.store.themes.find((x) => x.id === once.active).name, 'Harbour');
    await templates.applyTemplate(env, t);
    assert.deepEqual({ reactions: env.store.settings.reactions, active: env.store.settings.activeThemeId, themes: env.store.themes.length }, once, 'the theme is not added twice');
  });

  await test('a newer version offers only what is new, the rest unticked; confirming applies only what is ticked', async () => {
    const env = freshEnvironment('update');
    env.modules.aiReady = () => true;
    const v1 = templates.cleanTemplate(grown({ modules: ['travel', 'places', 'chat', 'conference'] }));
    await templates.applyTemplate(env, v1);
    assert.deepEqual(templates.offerFor(env, v1).modules, [], 'nothing new in the same version');
    const v2 = templates.cleanTemplate(grown({ version: 2, modules: ['travel', 'places', 'calendar', 'chat', 'conference'], reactions: [{ id: 'cheer', glyph: '🎉', label: 'Cheer' }] }));
    const offer = templates.offerFor(env, v2);
    assert.deepEqual([offer.modules.map((m) => m.id), offer.reactions.map((r) => r.id), offer.theme], [['calendar'], ['cheer'], null], 'the new module and reactions; the theme already in use is not offered');
    await templates.applyOffer(env, v2, { modules: ['calendar'], reactions: false });
    assert.deepEqual([env.modules.view('calendar').enabled, env.store.settings.reactions.map((r) => r.id)], [true, ['wave']], 'the module on; the reactions, not ticked, kept');
  });

  await test('template files: a round trip gives the same template; newer, too big and not a file are refused; unknown keys dropped and listed', () => {
    const t = templates.cleanTemplate(grown());
    const file = templateFile.templateToFile(t);
    assert.deepEqual(Object.keys(file).slice(0, 2), ['format', 'formatVersion']);
    assert.deepEqual([file.format, file.formatVersion], ['template', 1]);
    assert.equal('format' in file.theme || 'formatVersion' in file.theme, false, 'the embedded theme has no marker of its own');
    const back = templateFile.readTemplateFile(JSON.stringify(file), { bundled });
    assert.deepEqual(back.dropped, []);
    assert.deepEqual(templates.cleanTemplate(back.raw), t);
    assert.equal(templateFile.templateFileName('Harbour Trips'), 'harbour-trips.template.json');
    assert.equal(templateFile.templateFileName('***'), 'template.template.json');
    const refused = (input, sentence) => assert.throws(() => templateFile.readTemplateFile(input, { bundled }), (err) => err instanceof templateFile.TemplateFileError && err.message === sentence);
    refused({ ...file, formatVersion: 2 }, templateFile.NEWER);
    // The sentences that name the product take it from PRODUCT_NAME.
    assert.equal(templateFile.NEWER, `This template was made by a newer version of ${PRODUCT}.`);
    assert.equal(templateFile.NOT_A_TEMPLATE_FILE, `That isn't a ${PRODUCT} template file.`);
    refused({ ...file, formatVersion: undefined }, templateFile.NOT_A_TEMPLATE_FILE);
    refused({ ...file, format: 'theme' }, templateFile.NOT_A_TEMPLATE_FILE);
    const { format, formatVersion, ...unmarked } = file;
    refused(unmarked, templateFile.NOT_A_TEMPLATE_FILE);
    for (const label of require('../server/file-format.js').PAST_BLOCK_LABELS) refused({ [`${label}Template`]: 1, ...unmarked }, templateFile.OLD_TEMPLATE_FILE);
    refused({ someTemplate: 1, ...unmarked }, templateFile.NOT_A_TEMPLATE_FILE); // an unknown xxxTemplate key is not an old marker
    // An embedded theme with the theme file's own marker (a template made by hand from an exported theme) reads the same.
    const marked = templateFile.readTemplateFile({ ...file, theme: { format: 'theme', formatVersion: 1, ...file.theme } }, { bundled });
    assert.deepEqual([templates.cleanTemplate(marked.raw), marked.dropped], [t, []]);
    refused('not json', templateFile.NOT_A_TEMPLATE_FILE);
    refused(JSON.stringify({ ...file, description: 'x'.repeat(70 * 1024) }), templateFile.NOT_A_TEMPLATE_FILE);
    refused({ ...file, modules: ['travel'] }, 'modules: "chat" must be listed; Chat can\'t be switched off yet.');
    const extra = templateFile.readTemplateFile({ ...file, plan: 'pro', theme: { ...file.theme, glow: 1, light: { ...file.theme.light, shine: '#000000' } } }, { bundled });
    assert.deepEqual(extra.dropped, ['plan', 'theme.glow', 'theme.light.shine']);
  });

  // A bundled template's version is raised by hand when its applied-once part changes (PM's decision 6, addendum 2):
  // tools/template-versions.json keeps each one's fingerprint beside its version. `--update` records the current ones
  // (after raising the version).
  await test('a bundled template whose applied-once part changed has a new version', () => {
    const file = path.join(ROOT, 'tools', 'template-versions.json');
    const now = Object.fromEntries([...templates.all().values()].map((t) => [t.id, { version: t.version, fingerprint: templates.appliedOnceFingerprint(t) }]));
    if (process.argv.includes('--update') || !fs.existsSync(file)) fs.writeFileSync(file, `${JSON.stringify(now, null, 2)}\n`);
    const recorded = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [id, cur] of Object.entries(now)) {
      const was = recorded[id];
      if (!was) throw new Error(`templates/${id}.json is not in tools/template-versions.json; run node tools/check-templates.mjs --update`);
      if (was.fingerprint !== cur.fingerprint && cur.version <= was.version) throw new Error(`templates/${id}.json changed what it applies once (its modules, settings, Lobby, space defaults, reactions, icon set or theme) but kept version ${cur.version}; raise "version", then run node tools/check-templates.mjs --update`);
      if (was.fingerprint !== cur.fingerprint || was.version !== cur.version) throw new Error(`templates/${id}.json has a new version; record it with node tools/check-templates.mjs --update`);
    }
  });

  await test('iconSet: checked, added to the icon list once at creation, and offered on a new version only if it changed', async () => {
    const problems = (raw) => templates.problemsOf(raw, { bundled });
    assert.deepEqual(problems(grown({ iconSet: ['anchor', 'no-such-icon-at-all'] })), ['iconSet: "no-such-icon-at-all" is not a Font Awesome Free solid icon.']);
    assert.deepEqual(problems(grown({ iconSet: ['anchor', 'anchor'] })), ['iconSet: "anchor" is listed twice.']);
    const env = freshEnvironment('icon-set');
    const v1 = templates.cleanTemplate(grown({ iconSet: ['anchor', 'ship'] }));
    await templates.applyTemplate(env, v1);
    assert.ok(['anchor', 'ship'].every((id) => env.store.iconIds().includes(id)), 'added at creation');
    const applied = templates.partFingerprints(v1);
    // The owner changes their reactions and removes an icon: a new version that changed neither offers neither.
    env.store.updateSettings({ reactions: [{ id: 'mine', glyph: '⭐', label: 'Mine' }], icons: env.store.settings.icons.filter((i) => i.id !== 'ship') });
    const v2 = templates.cleanTemplate(grown({ version: 2, iconSet: ['anchor', 'ship'] }));
    const quiet = templates.offerFor(env, v2, { applied });
    assert.deepEqual([quiet.reactions, quiet.iconSet, quiet.theme, quiet.modules], [null, null, null, []], 'nothing the template didn\'t change');
    assert.notEqual(templates.offerFor(env, v2, {}).reactions, null, 'without fingerprints: by the environment as it is (a record from before)');
    const v3 = templates.cleanTemplate(grown({ version: 3, iconSet: ['anchor', 'ship', 'compass'] }));
    // The console's card for an environment not open reads only the record: changed parts by fingerprint.
    assert.deepEqual([templates.appliedPartsChanged({ applied }, v2), templates.appliedPartsChanged({ applied }, v3), templates.appliedPartsChanged({}, v2)], [false, true, true], 'unchanged parts: no offer; a changed part or no fingerprints: an offer');
    const offer = templates.offerFor(env, v3, { applied });
    assert.deepEqual([offer.iconSet, offer.reactions], [['ship', 'compass'].filter((id) => !env.store.iconIds().includes(id)), null], 'the changed icon set, only what is missing; reactions unchanged, not offered');
    await templates.applyOffer(env, v3, { iconSet: true }, { applied });
    assert.ok(env.store.iconIds().includes('compass'));
  });

  // --- addendum 3: editing a bundled template (GitHub #91) -------------------------------------------------------
  // A hosted server on a throwaway folder. The ten cases in the plan. A single install is started at the end.
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
    const bad = await console_('PATCH', '/api/host/templates/travel', { modules: ['travel'] });
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
    const edited = await console_('PATCH', '/api/host/templates/travel', { words: { space: { one: 'journey', many: 'journeys' } }, modules: [...shipped.modules, 'assistant'] });
    assert.deepEqual([edited.status, edited.json.template.id, edited.json.template.version, edited.json.template.edited, edited.json.template.source], [200, 'travel', shipped.version + 1, true, 'bundled'], edited.text);
    assert.equal((await call(server, 'out', 'GET', '/api/branding')).json.words.space.one, 'journey', 'the new word, with no restart');
    const owner = cookieOf(await call(server, 'out', 'POST', '/api/login', { body: { login: 'owner', password: 'owner-password-1' } }));
    const tab = await call(server, 'out', 'GET', '/api/environment/template', { cookie: owner });
    assert.equal(tab.json.template.offerOpen, true);
    assert.ok(tab.json.offer.modules.some((m) => m.id === 'assistant'), 'a changed module is offered, not forced');
    assert.equal((await call(server, 'out', 'GET', '/api/modules', { cookie: owner })).json.modules.some((m) => m.id === 'assistant'), false);
  });

  await test('verbs (addendum 4), hosted: the owner\'s over the template\'s over the default, and a host edit reaches branding at once', async () => {
    const owner = cookieOf(await call(server, 'out', 'POST', '/api/login', { body: { login: 'owner', password: 'owner-password-1' } }));
    const settings = async () => (await call(server, 'out', 'GET', '/api/settings', { cookie: owner })).json.settings;
    const branding = async () => (await call(server, 'out', 'GET', '/api/branding')).json;
    assert.deepEqual((await branding()).verbs, { enter: 'Enter', layout: 'Layout' }, 'Travel sets none: the default');
    let st = await settings();
    assert.deepEqual([st.verbs, st.ownVerbs, st.templateVerbs], [{ enter: 'Enter', layout: 'Layout' }, {}, {}]);
    // The host template editor's save takes verbs, and every environment made from it reads the new one at once.
    const edited = await console_('PATCH', '/api/host/templates/travel', { verbs: { enter: 'Board' } });
    assert.deepEqual([edited.status, edited.json.template.verbs], [200, { enter: 'Board' }], edited.text);
    assert.deepEqual((await branding()).verbs, { enter: 'Board', layout: 'Layout' }, 'the template\'s new verb, with no restart');
    const bad = await console_('PATCH', '/api/host/templates/travel', { verbs: { enter: 'Board!' } });
    assert.deepEqual([bad.status, bad.json.error], [400, 'verbs: The enter verb can use only letters, spaces, hyphens and apostrophes.']);
    // The owner's own wins, and null returns it to the template's.
    const saved = await call(server, 'out', 'PATCH', '/api/settings', { cookie: owner, body: { verbs: { enter: 'Go to' } } });
    assert.deepEqual([saved.status, saved.json.settings.verbs, saved.json.settings.ownVerbs, saved.json.settings.templateVerbs], [200, { enter: 'Go to', layout: 'Layout' }, { enter: 'Go to' }, { enter: 'Board' }], saved.text);
    assert.deepEqual((await branding()).verbs, { enter: 'Go to', layout: 'Layout' });
    const b = await branding();
    assert.deepEqual([b.ownVerbs, b.templateVerbs], [undefined, undefined], 'the public branding carries only the resolved verbs');
    for (const [body, sentence] of [
      [{ verbs: { enter: 'x'.repeat(21) } }, 'The enter verb must be 1 to 20 characters.'],
      [{ verbs: { enter: 7 } }, 'The enter verb must be text, or null to use the default.'],
      [{ verbs: { join: 'Join' } }, 'There is no verb called join; the verbs are enter, layout.'],
      [{ verbs: 'Enter' }, 'Verbs must be given by name, each as text.'],
    ]) {
      const res = await call(server, 'out', 'PATCH', '/api/settings', { cookie: owner, body });
      assert.deepEqual([res.status, res.json.error], [400, sentence], JSON.stringify(body));
    }
    assert.equal((await call(server, 'out', 'PATCH', '/api/settings', { body: { verbs: { enter: 'Hop' } } })).status, 401, 'signed out: refused');
    assert.deepEqual((await branding()).verbs, { enter: 'Go to', layout: 'Layout' }, 'nothing refused changed it');
    const cleared = await call(server, 'out', 'PATCH', '/api/settings', { cookie: owner, body: { verbs: { enter: null } } });
    assert.deepEqual([cleared.json.settings.verbs, cleared.json.settings.ownVerbs], [{ enter: 'Board', layout: 'Layout' }, {}], 'null: the template\'s again');
    // The host removes the template's verbs: the default.
    const removed = await console_('PATCH', '/api/host/templates/travel', { verbs: null });
    assert.deepEqual([removed.status, removed.json.template.verbs], [200, null], removed.text);
    st = await settings();
    assert.deepEqual([st.verbs, st.templateVerbs], [{ enter: 'Enter', layout: 'Layout' }, {}], 'a template without verbs: the default');
  });

  await test('duplicate makes a host template at version 1 from the template in use; a taken id is refused', async () => {
    const before = (await travelRow()).version;
    const copy = await console_('POST', '/api/host/templates/travel/duplicate', { id: 'day-trips', name: 'Day trips' });
    assert.equal(copy.status, 201, copy.text);
    assert.deepEqual([copy.json.template.source, copy.json.template.version, copy.json.template.hidden, copy.json.template.id, copy.json.template.name], ['host', 1, false, 'day-trips', 'Day trips']);
    assert.deepEqual(copy.json.template.words, { space: { one: 'journey', many: 'journeys' } });
    assert.ok(copy.json.template.modules.includes('assistant'));
    assert.equal((await travelRow()).version, before, 'the original is unchanged');
    const again = await console_('POST', '/api/host/templates/day-trips/duplicate', { id: 'day-trips-2', name: 'Day trips two' });
    assert.equal(again.status, 201, again.text);
    assert.deepEqual([again.json.template.version, again.json.template.words, again.json.template.modules], [1, copy.json.template.words, copy.json.template.modules]);
    assert.deepEqual(await console_('POST', '/api/host/templates/travel/duplicate', { id: 'day-trips', name: 'Taken' }).then((r) => [r.status, r.json.error]), [409, 'There is already a template called day-trips.']);
    const renamed = await console_('PATCH', '/api/host/templates/day-trips', { name: 'Day trips edited' });
    assert.deepEqual([renamed.status, renamed.json.template.version, renamed.json.template.name], [200, 2, 'Day trips edited']);
    assert.equal((await travelRow()).name, 'Travel');
  });

  await test('an edited template exports with edited set, and importing it under a new id drops nothing', async () => {
    const file = await console_('GET', '/api/host/templates/travel/export');
    assert.equal(file.status, 200, file.text);
    assert.equal(file.json.edited, true);
    assert.deepEqual(file.json.words.space, { one: 'journey', many: 'journeys' });
    assert.ok(file.json.modules.includes('assistant'));
    const imported = await console_('POST', '/api/host/templates/import?id=from-file', file.json);
    assert.equal(imported.status, 201, imported.text);
    assert.deepEqual(imported.json.dropped, []);
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
      data.bundledEdits.push({ id: 'retired', template: { id: 'retired', name: 'Retired', description: 'Gone.', modules: ['chat'] }, version: 2, base: { version: 1, fingerprint: 'x', whole: 'y' }, hidden: false, updatedAt: '2026-09-26T00:00:00.000Z' });
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

  await test('travel version 6 (phase icons): never-edited copy updates silently, an edited one gets the notice once, and nothing is applied again', async () => {
    // The shipped file as version 5 had it: no phase icons. Only the whole-template fingerprint can tell; what is applied
    // once (modules, settings, Lobby, space defaults, reactions, icon set, theme) must be the same.
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
    assert.deepEqual((await call(server, 'out', 'GET', '/api/branding')).json.phases.map((p) => p.icon), ['clipboard-list', 'ticket', 'hourglass-half', 'suitcase-rolling', 'plane', 'camera-retro']);
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
    assert.deepEqual([row.name, row.edited, row.version, row.update], ['Journeys', true, edited.json.template.version, { shippedVersion: 8 }], 'the notice opens');
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
    // Verbs on a single install without a template: the default, the admin's own over it, null back to the default.
    assert.deepEqual((await call(server, '', 'GET', '/api/branding')).json.verbs, { enter: 'Enter', layout: 'Layout' });
    const admin = cookieOf(await call(server, '', 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
    const st = (await call(server, '', 'GET', '/api/settings', { cookie: admin })).json.settings;
    assert.deepEqual([st.verbs, st.ownVerbs, st.templateVerbs], [{ enter: 'Enter', layout: 'Layout' }, {}, null]);
    const set = await call(server, '', 'PATCH', '/api/settings', { cookie: admin, body: { verbs: { enter: 'Step into' } } });
    assert.deepEqual([set.status, set.json.settings.verbs], [200, { enter: 'Step into', layout: 'Layout' }], set.text);
    assert.deepEqual((await call(server, '', 'GET', '/api/branding')).json.verbs, { enter: 'Step into', layout: 'Layout' });
    const layout = await call(server, '', 'PATCH', '/api/settings', { cookie: admin, body: { verbs: { layout: 'Arrange' } } });
    assert.deepEqual([layout.status, layout.json.settings.verbs, layout.json.settings.ownVerbs], [200, { enter: 'Step into', layout: 'Arrange' }, { enter: 'Step into', layout: 'Arrange' }], layout.text);
    assert.deepEqual((await call(server, '', 'GET', '/api/branding')).json.verbs, { enter: 'Step into', layout: 'Arrange' }, 'the layout verb, beside the enter verb');
    const tooLong = await call(server, '', 'PATCH', '/api/settings', { cookie: admin, body: { verbs: { layout: 'x'.repeat(21) } } });
    assert.deepEqual([tooLong.status, tooLong.json.error], [400, 'The layout verb must be 1 to 20 characters.']);
    const back = await call(server, '', 'PATCH', '/api/settings', { cookie: admin, body: { verbs: { enter: null, layout: null } } });
    assert.deepEqual([back.json.settings.verbs, back.json.settings.ownVerbs], [{ enter: 'Enter', layout: 'Layout' }, {}]);
    assert.equal('verbs' in JSON.parse(fs.readFileSync(path.join(single, 'app.json'), 'utf8')).settings, false, 'nothing left stored');
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
