#!/usr/bin/env node
/*
 * check-catalog.mjs -- the write tools made from the modules' manifests (plan-ai-integration.md, slice 2 step 12, decision 22).
 *
 * Fails when a bundled module's action that is not local and not asker-only has no `description` (one sentence, up to 200
 * characters) or no `effect`; when a destructive action, a local one, an asker-only one, one with `"ai": false` or one that
 * makes a new object reaches the catalog; when a generated schema is not the plain shape both providers take or does not
 * accept its own example; when module.json's new fields are not refused as they should be; and when the catalog the bundled
 * manifests make drifts from its golden file (tools/golden/catalog.json). Then, through a throwaway server with the fake
 * model, GET /api/ai/catalog: who may read it, and that it narrows to the module's write access, What AI may see and the space.
 *
 *   node tools/check-catalog.mjs            check
 *   node tools/check-catalog.mjs --update   write the golden file from the bundled manifests (after a deliberate change)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startFakeModel } from './fake-model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { cleanManifest, fillManifest } = require('../server/modules.js');
const { bundledModules } = require('../server/module-build.js');
const { buildCatalog, checkToolInput, MAX_DESCRIPTION, TOOL_NAME_RE } = require('../server/action-catalog.js');
const GOLDEN = path.join(ROOT, 'tools', 'golden', 'catalog.json');

let n = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { console.error(`check-catalog: ${name}\n${err.stack || err}`); process.exitCode = 1; throw err; }
};

// The files a built zip holds (server/module-build.js): module.json and each surface's entry.
const filesOf = (raw) => new Set(['module.json', ...Object.values(raw.surfaces || {}).flat().map((d) => d && d.entry).filter(Boolean)]);
const raws = bundledModules(path.join(ROOT, 'modules'));
const cleaned = raws.map((raw) => cleanManifest(raw, filesOf(raw)));
const catalog = buildCatalog(cleaned);

if (process.argv.includes('--update')) {
  fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
  fs.writeFileSync(GOLDEN, JSON.stringify(catalog.tools, null, 2) + '\n');
  console.log(`check-catalog: wrote tools/golden/catalog.json (${catalog.tools.length} tools)`);
  process.exit(0);
}

await test('every bundled action that is not local and not asker-only says what it does and what it changes', () => {
  const missing = [];
  for (const raw of raws) {
    for (const a of raw.actions?.provides || []) {
      if (a.local === true || a.askerOnly === true) continue;
      const where = `modules/${raw.id}/module.json action ${a.name}`;
      if (typeof a.description !== 'string' || !a.description.trim()) { missing.push(`${where}: no description`); continue; }
      if (a.effect === undefined) missing.push(`${where}: no effect (write or destructive)`);
      const d = a.description.trim();
      if ([...d].length > MAX_DESCRIPTION) missing.push(`${where}: description over ${MAX_DESCRIPTION} characters`);
      if (!/[.]$/.test(d) || /[.!?]\s/.test(d)) missing.push(`${where}: description must be one sentence, ending with a full stop`);
    }
  }
  assert.deepEqual(missing, []);
});

await test('the bundled catalog is the four actions on objects that already exist, as the plan names them', () => {
  assert.deepEqual(catalog.tools.map((t) => t.name), ['places__setPlacePoint', 'todo__linkTask', 'todo__setTaskDue', 'travel__addToDay']);
  for (const t of catalog.tools) {
    assert.equal(t.effect, 'write', `${t.name} is not destructive`);
    assert.ok(TOOL_NAME_RE.test(t.name), t.name);
    assert.ok(t.description && [...t.description].length <= MAX_DESCRIPTION, t.name);
  }
  // Every other action is left out, each for its reason.
  const why = Object.fromEntries(catalog.leftOut.map((x) => [`${x.module}:${x.action}`, x.why]));
  for (const id of ['todo:createTask', 'travel:addStop', 'travel:acceptSuggestion', 'places:addPlace', 'calendar:createEvent', 'research:saveNote', 'research:saveLink', 'budget:addCost']) assert.equal(why[id], 'new-object', id);
  assert.equal(why['research:savePhoto'], 'asker-only');
  for (const id of ['maps:showOnMap', 'places:sharePlace', 'todo:addTask', 'assistant:askAssistant']) assert.equal(why[id], 'local', id);
});

await test('the catalog has not drifted from the bundled manifests (tools/golden/catalog.json)', () => {
  assert.ok(fs.existsSync(GOLDEN), 'no golden file: run node tools/check-catalog.mjs --update');
  const want = fs.readFileSync(GOLDEN, 'utf8');
  const now = JSON.stringify(catalog.tools, null, 2) + '\n';
  assert.equal(now, want, 'the catalog the manifests make changed: if that is meant, bump the module, then run node tools/check-catalog.mjs --update');
});

// A schema both providers take: an object of plain typed properties, every required one listed, nothing else accepted.
function plainSchema(s, name) {
  assert.equal(s.type, 'object', name);
  assert.equal(s.additionalProperties, false, name);
  assert.ok(Array.isArray(s.required) && s.required.every((k) => Object.hasOwn(s.properties, k)), name);
  for (const [k, p] of Object.entries(s.properties)) {
    assert.ok(['integer', 'number', 'string', 'boolean'].includes(p.type), `${name}.${k}`);
    for (const key of Object.keys(p)) assert.ok(['type', 'minimum', 'minLength', 'maxLength', 'pattern', 'format', 'description'].includes(key), `${name}.${k} ${key}`);
    if (p.pattern) new RegExp(p.pattern); // compiles
  }
  JSON.parse(JSON.stringify(s)); // plain JSON
}
const exampleOf = (s) => Object.fromEntries(Object.entries(s.properties).map(([k, p]) => [k, p.type === 'integer' ? 1 : p.type === 'number' ? 1.5 : p.type === 'boolean' ? true : p.pattern ? '2026-05-12' : p.format ? '2026-05-12T10:00:00Z' : 'Ferry']));

await test('each generated schema is plain, accepts its own example, and refuses what it should', () => {
  for (const t of catalog.tools) {
    plainSchema(t.schema, t.name);
    const ex = exampleOf(t.schema);
    assert.deepEqual(checkToolInput(t, ex), { ok: true, input: ex }, t.name);
    assert.equal(checkToolInput(t, { ...ex, extra: 1 }).ok, false, `${t.name}: an extra field`);
    for (const k of t.schema.required) { const less = { ...ex }; delete less[k]; assert.equal(checkToolInput(t, less).error, `${k} is needed.`, `${t.name} ${k}`); }
    for (const [k, p] of Object.entries(t.schema.properties)) {
      if (p.type === 'integer') for (const bad of [0, -1, 1.5, '1']) assert.equal(checkToolInput(t, { ...ex, [k]: bad }).ok, false, `${t.name}.${k} ${bad}`);
      if (p.pattern) for (const bad of ['12 May', '2026-5-12', 12]) assert.equal(checkToolInput(t, { ...ex, [k]: bad }).ok, false, `${t.name}.${k} ${bad}`);
    }
  }
  assert.equal(checkToolInput(catalog.tools[0], null).error, "The input must be named fields, as the tool's schema says.");
  assert.equal(checkToolInput(catalog.tools[0], [1]).error, "The input must be named fields, as the tool's schema says.");
  // A pointer is never taken: only the number the server gave out.
  const due = catalog.tools.find((t) => t.name === 'todo__setTaskDue');
  assert.equal(checkToolInput(due, { task: { module: 'todo', kind: 'task', id: 'x' }, date: '2026-05-12' }).ok, false);
});

// --- module.json's new fields, through the manifest cleaner -------------------------------------------------------------
const todoRaw = raws.find((r) => r.id === 'todo');
const withActions = (provides) => cleanManifest({ ...structuredClone(todoRaw), commands: [], actions: { provides, uses: [] } }, filesOf(todoRaw));
const refusal = (provides) => { try { withActions(provides); return ''; } catch (err) { return `${err.status}|${err.message}`; } };
const act = (extra) => ({ name: 'doIt', label: 'Do it', input: { task: 'ref:todo:task' }, ...extra });

await test('description, effect and ai are refused with one sentence when wrong', () => {
  assert.equal(refusal([act({ description: 'x'.repeat(MAX_DESCRIPTION + 1) })]), `400|module.json: action "doIt" description is at most ${MAX_DESCRIPTION} characters.`);
  assert.equal(refusal([act({ description: '  \n ' })]), '400|module.json: action "doIt" description is empty; say in one sentence what it does.');
  assert.equal(refusal([act({ description: 3 })]), '400|module.json: action "doIt" description must be text: one sentence saying what it does.');
  assert.equal(refusal([act({ effect: 'read' })]), '400|module.json: action "doIt" effect must be write or destructive.');
  assert.equal(refusal([act({ local: true, effect: 'write' })]), '400|module.json: action "doIt" is local, which changes nothing, so it has no effect.');
  assert.equal(refusal([act({ ai: 'yes' })]), '400|module.json: action "doIt" ai must be true or false.');
  assert.equal(refusal([act({ local: true, ai: true })]), '400|module.json: action "doIt" is local, so it is never offered to the AI.');
  assert.equal(refusal([act({ description: 'Do it to a task.', effect: 'write', ai: true })]), '');
});

await test('the cleaned action keeps what the catalog needs; effect defaults to write', () => {
  const [a] = withActions([act({ description: ' Do it\n to a task. ' })]).actions.provides;
  assert.deepEqual([a.description, a.effect, 'ai' in a], ['Do it to a task.', 'write', false]);
  const [l] = withActions([act({ local: true, description: 'Show a task.' })]).actions.provides;
  assert.deepEqual([l.description, 'effect' in l], ['Show a task.', false], 'a local action has no effect');
  const [off] = withActions([act({ description: 'Do it.', ai: false })]).actions.provides;
  assert.equal(off.ai, false);
});

await test('a destructive action, one with ai false, one undescribed, one with a whole object and one that makes a new object stay out', () => {
  const m = withActions([
    act({ name: 'eraseTask', description: 'Erase a task.', effect: 'destructive' }),
    act({ name: 'quietTask', description: 'Do it quietly.', ai: false }),
    act({ name: 'plainTask' }),
    act({ name: 'makeTask', description: 'Make a task.', input: { title: 'string', ref: 'ref?' } }),
    act({ name: 'takeTask', description: 'Take a task.', input: { task: 'ref:todo:task', object: 'object?' }, takes: [{ kinds: ['task'], as: 'a task' }] }),
    act({ name: 'keepTask', description: 'Keep a task.' }),
  ]);
  const c = buildCatalog([m]);
  assert.deepEqual(c.tools.map((t) => t.name), ['todo__keepTask']);
  assert.deepEqual(Object.fromEntries(c.leftOut.map((x) => [x.action, x.why])), { eraseTask: 'destructive', quietTask: 'ai-off', plainTask: 'no-description', makeTask: 'new-object', takeTask: 'new-object' });
  // A tool name over 64 characters is left out rather than sent and refused by the provider.
  const long = buildCatalog([{ id: 'a'.repeat(32), actions: { provides: [{ ...act({ description: 'Do it.' }), name: 'b'.repeat(32), effect: 'write' }] } }]);
  assert.deepEqual([long.tools.length, long.leftOut[0].why], [0, 'long-name']);
});

await test('a description takes the environment\'s words, as a label does', () => {
  const todo = cleaned.find((m) => m.id === 'todo');
  const link = (m) => m.actions.provides.find((a) => a.name === 'linkTask').description;
  assert.match(link(todo), /\{object\}/);
  assert.equal(link(fillManifest(todo)), 'Link a task to another object it is about, so each shows the other.');
});

// --- GET /api/ai/catalog, through a throwaway server ----------------------------------------------------------------------
const fake = await startFakeModel();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-catalog-'));
fs.writeFileSync(path.join(dataDir, 'ai.json'), JSON.stringify({ source: 'custom', provider: 'compatible', address: fake.url, model: 'fake-1', key: '', enabled: true }));
const out = { text: '' };
const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, ADMIN_PASSWORD: 'testpass1234' }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (d) => { out.text += d; });
child.stderr.on('data', (d) => { out.text += d; });
try {
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`the server did not start:\n${out.text}`)); }, 25000);
    const look = () => { const m = /listening on :(\d+)/.exec(out.text); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', look);
    child.stderr.on('data', look);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out.text}`)); });
  });
  const call = async (method, urlPath, { body, cookie } = {}) => {
    const headers = { accept: 'application/json' };
    if (cookie) headers.cookie = `app_session=${cookie}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  const login = async (name, password) => (await call('POST', '/api/login', { body: { login: name, password } })).json.token;
  const owner = await login('admin', 'testpass1234');
  const mk = async (name) => (await call('POST', '/api/users', { cookie: owner, body: { login: name, displayName: name, role: 'member', password: 'memberpass1234' } })).json.user;
  const [pat, sam] = [await mk('pat'), await mk('sam')];
  const space = (await call('POST', '/api/spaces', { cookie: owner, body: { name: 'Trip', members: [pat.key] } })).json.space;
  const other = (await call('POST', '/api/spaces', { cookie: owner, body: { name: 'Elsewhere', members: [sam.key] } })).json.space;
  const tok = { pat: await login('pat', 'memberpass1234'), sam: await login('sam', 'memberpass1234') };
  const C = `/api/ai/catalog?space=${space.id}`;
  // Nothing is installed in a fresh environment: no tools until a module with some is on.
  assert.deepEqual((await call('GET', C, { cookie: tok.pat })).json, { tools: [] });
  for (const id of ['todo', 'places', 'travel', 'research']) {
    assert.equal((await call('POST', `/api/modules/bundled/${id}/install`, { cookie: owner, body: {} })).status, 201, id);
    assert.equal((await call('PATCH', `/api/modules/${id}`, { cookie: owner, body: { enabled: true } })).status, 200, id);
  }
  const names = (r) => r.json.tools.map((t) => t.name);

  await test('GET /api/ai/catalog: who may read it, each refusal one sentence', async () => {
    let r = await call('GET', C);
    assert.deepEqual([r.status, r.json.error], [401, 'Sign in first.']);
    r = await call('GET', '/api/ai/catalog', { cookie: tok.pat });
    assert.deepEqual([r.status, r.json.error], [400, 'Say which space the tools are for.']);
    r = await call('GET', '/api/ai/catalog?space=nope', { cookie: tok.pat });
    assert.deepEqual([r.status, r.json.error], [404, 'No such space.']);
    r = await call('GET', `/api/ai/catalog?space=${other.id}`, { cookie: tok.pat });
    assert.deepEqual([r.status, r.json.error], [403, 'You are not in this space.']);
    const link = (await call('POST', `/api/spaces/${space.id}/guest-link`, { cookie: owner, body: {} })).json.space.guestToken;
    r = await call('GET', `${C}&guest=${encodeURIComponent(link)}`);
    assert.deepEqual([r.status, r.json.error], [403, "Guests can't use AI."]);
    await call('PATCH', `/api/spaces/${space.id}`, { cookie: owner, body: { aiOff: true } });
    r = await call('GET', C, { cookie: tok.pat });
    assert.deepEqual([r.status, r.json.error], [403, 'AI is turned off in this space.']);
    await call('PATCH', `/api/spaces/${space.id}`, { cookie: owner, body: { aiOff: false } });
  });

  await test('GET /api/ai/catalog: the person\'s write tools here, narrowed by write access and What AI may see', async () => {
    let r = await call('GET', C, { cookie: tok.pat });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(names(r), ['places__setPlacePoint', 'todo__linkTask', 'todo__setTaskDue', 'travel__addToDay']);
    const due = r.json.tools.find((t) => t.name === 'todo__setTaskDue');
    assert.deepEqual(Object.keys(due).sort(), ['action', 'description', 'effect', 'label', 'module', 'moduleName', 'name', 'schema']);
    assert.deepEqual([due.module, due.action, due.effect, typeof due.moduleName], ['todo', 'setTaskDue', 'write', 'string']);
    assert.equal(r.json.tools.find((t) => t.name === 'todo__linkTask').description, 'Link a task to another object it is about, so each shows the other.', 'filled in the environment\'s words');
    assert.equal((await call('GET', C, { cookie: owner })).json.tools.length, 4, 'the owner too');
    // A member whose role may not change the To-do list loses its tools, not the others.
    assert.equal((await call('PATCH', '/api/roles/member', { cookie: owner, body: { 'module.todo.edit': false } })).status, 200);
    r = await call('GET', C, { cookie: tok.pat });
    assert.deepEqual(names(r), ['places__setPlacePoint', 'travel__addToDay']);
    await call('PATCH', '/api/roles/member', { cookie: owner, body: { 'module.todo.edit': true } });
    // What AI may see keeping a module out keeps its tools out.
    assert.equal((await call('PATCH', `/api/spaces/${space.id}`, { cookie: owner, body: { aiSees: { modules: ['todo', 'travel'] } } })).status, 200);
    r = await call('GET', C, { cookie: tok.pat });
    assert.deepEqual(names(r), ['todo__linkTask', 'todo__setTaskDue', 'travel__addToDay']);
    // Use AI off for the role: no catalog at all.
    await call('PATCH', '/api/roles/member', { cookie: owner, body: { useAi: false } });
    r = await call('GET', C, { cookie: tok.pat });
    assert.deepEqual([r.status, r.json.error], [403, "Your role can't use AI."]);
  });
} finally {
  child.kill();
  await fake.close?.();
}
if (!process.exitCode) console.log(`check-catalog: OK (${n} checks, ${catalog.tools.length} tools)`);
