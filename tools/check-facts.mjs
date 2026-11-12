#!/usr/bin/env node
/*
 * check-facts.mjs -- the facts store and the budget target (documentation/plans/plan-space-story-strip.md, "The
 * contract", steps 4 to 6; #216): the shape check cleanFacts(), the store (DATA_DIR/facts.json, atomic, per space and
 * module and never per person, the 7-day drop, the clean-up for a space and a module), the routes PUT/DELETE
 * /api/spaces/:id/facts/:module and GET /api/spaces/:id/facts with their codes for a member, another member, someone
 * not in the space, a guest, nobody signed in, a role without `write` and one without `read` in the module; then the
 * space's `budget` field (plan-budget-module.md, decisions 3, 5, 6 and 7): PATCH /api/spaces/:id for the admin and a
 * moderator of the space, refused for a member and someone outside; its rules (an amount above zero of at most 12
 * digits, a currency the server knows, either alone, null clears, a bad entry never deletes it); who reads it (Set up's
 * read for the admin and the moderator, the module context for a member, never a guest, never the general lists). The
 * first two run in-process; the rest against a throwaway server.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { Facts, cleanFacts, LIMITS, MAX_AGE } = require('../server/facts.js');

let n = 0;
const ok = (cond, label) => { assert.ok(cond, label); n += 1; };
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `check-facts-${name}-`));
const DAY = 24 * 60 * 60 * 1000;

// --- the shape check ----------------------------------------------------------------------------------------------
const spent = { id: 'spent', icon: 'coins', text: '$2,340 of $4,000', value: '$1,660 left', progress: 0.585, order: 10, budget: true };
const next = { id: 'next', icon: 'plane', text: 'Next: Thu · SJC → ONT' };
{
  const refused = (body, label) => {
    const out = cleanFacts(body);
    assert.ok(out.error && !out.facts, `${label}: refused (${JSON.stringify(out)})`);
    assert.match(out.error, /^[A-Z0-9$][^\n]+\.$/, `${label}: one plain sentence (${out.error})`);
    n += 1;
  };
  assert.deepEqual(cleanFacts({ facts: [spent, next] }).facts, [spent, next]);
  assert.deepEqual(cleanFacts({ facts: [{ id: 'a', icon: 'coins', text: '  two\nlines  ', value: ' ', progress: 0.12345, budget: false }] }).facts,
    [{ id: 'a', icon: 'coins', text: 'two lines', progress: 0.123 }], 'words on one line, an empty value and a false mark dropped, progress rounded');
  assert.deepEqual(cleanFacts({ facts: [] }).facts, [], 'an empty list is a report (it clears)');
  assert.equal(cleanFacts({ facts: [{ ...next, text: 'x'.repeat(40) }] }).facts[0].text.length, 40);
  assert.equal(cleanFacts({ facts: Array.from({ length: 6 }, (_, i) => ({ ...next, id: `f${i}` })) }).facts.length, 6);
  assert.deepEqual([cleanFacts({ facts: [{ ...next, progress: 0 }] }).facts[0].progress, cleanFacts({ facts: [{ ...next, progress: 1 }] }).facts[0].progress], [0, 1]);
  n += 6;
  refused(null, 'no body');
  refused({}, 'no list');
  refused({ facts: 'a' }, 'not a list');
  refused({ facts: Array.from({ length: 7 }, (_, i) => ({ ...next, id: `f${i}` })) }, 'over 6');
  refused({ facts: [5] }, 'a fact not an object');
  refused({ facts: [{ ...next, id: 'Spent' }] }, 'an id in capitals');
  refused({ facts: [{ ...next, id: '' }] }, 'no id');
  refused({ facts: [next, next] }, 'the same id twice');
  refused({ facts: [{ ...next, icon: 'not-an-icon-at-all' }] }, 'an icon not in Font Awesome Free\'s solid set');
  refused({ facts: [{ ...next, icon: 'fa-solid fa-plane' }] }, 'a class list, not a name');
  refused({ facts: [{ ...next, text: '' }] }, 'no words');
  refused({ facts: [{ ...next, text: 'x'.repeat(41) }] }, 'words over 40');
  refused({ facts: [{ ...next, text: 5 }] }, 'words not text');
  refused({ facts: [{ ...next, value: 'x'.repeat(25) }] }, 'a value over 24');
  refused({ facts: [{ ...next, value: 3 }] }, 'a value not text');
  refused({ facts: [{ ...next, progress: 1.5 }] }, 'progress over 1');
  refused({ facts: [{ ...next, progress: -0.1 }] }, 'progress under 0');
  refused({ facts: [{ ...next, progress: '0.5' }] }, 'progress as text');
  refused({ facts: [{ ...next, order: 1.5 }] }, 'an order not whole');
  refused({ facts: [{ ...next, order: 100 }] }, 'an order over 99');
  refused({ facts: [{ ...next, budget: 'yes' }] }, 'a budget mark not true or false');
  // Invisible characters (zero-width, bidi controls) would let a fact look empty or reorder its words: refused.
  for (const cp of [0x200B, 0x200C, 0x200D, 0x200E, 0x200F, 0x2060, 0xFEFF, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069]) {
    const ch = String.fromCodePoint(cp);
    refused({ facts: [{ ...next, text: `${ch}` }] }, `words of U+${cp.toString(16).toUpperCase()} alone`);
    refused({ facts: [{ ...next, text: `SJC ${ch}→ ONT` }] }, `words holding U+${cp.toString(16).toUpperCase()}`);
    refused({ facts: [{ ...next, value: `UA${ch} 1` }] }, `a value holding U+${cp.toString(16).toUpperCase()}`);
  }
  assert.equal(cleanFacts({ facts: [{ ...next, text: 'a\u200Bb' }] }).error, 'A fact\'s words cannot hold invisible characters.');
  // Lengths are characters as a person counts them: forty emoji are forty, forty-one too many.
  assert.equal(cleanFacts({ facts: [{ ...next, text: '😀'.repeat(40) }] }).facts[0].text, '😀'.repeat(40), 'forty emoji are forty characters');
  refused({ facts: [{ ...next, text: '😀'.repeat(41) }] }, 'forty-one emoji');
  assert.equal(cleanFacts({ facts: [{ ...next, value: '✈️'.repeat(12) }] }).facts[0].value, '✈️'.repeat(12), 'a value counted the same way');
  // A fact's day (`when`): a real date written YYYY-MM-DD, kept as sent; anything else refused.
  assert.equal(cleanFacts({ facts: [{ ...next, when: '2026-10-16' }] }).facts[0].when, '2026-10-16');
  assert.ok(!('when' in cleanFacts({ facts: [{ ...next, when: null }] }).facts[0]), 'no day: none kept');
  for (const when of ['2026-02-30', '2026-13-01', '16/10/2026', '2026-10-16T08:15', 'tomorrow', 20261016, '']) refused({ facts: [{ ...next, when }] }, `a day of ${JSON.stringify(when)}`);
  assert.equal(cleanFacts({ facts: [{ ...next, when: 'tomorrow' }] }).error, 'A fact\'s day must be a real date written YYYY-MM-DD.');
  n += 6;
  assert.equal(LIMITS.facts, 6);
  assert.equal(LIMITS.text, 40);
  assert.equal(MAX_AGE, 7 * DAY);
}

// --- the store ----------------------------------------------------------------------------------------------------
{
  const dir = tmp('store');
  let now = Date.UTC(2026, 9, 14);
  const f = new Facts(dir, () => now);
  f.set('s1', 'travel', [spent, next]);
  f.set('s1', 'polls', [next]);
  f.set('s2', 'travel', [next]);
  assert.deepEqual(f.list('s1').map((r) => [r.module, r.facts.length, r.at]), [['travel', 2, now], ['polls', 1, now]]);
  assert.deepEqual(f.list('nowhere'), []);
  assert.ok(!fs.existsSync(path.join(dir, 'facts.json.tmp')), 'written by rename, no temp file left');
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'facts.json'), 'utf8'));
  assert.deepEqual(Object.keys(stored.spaces.s1), ['travel', 'polls'], 'per space and module, no person in it');
  n += 4;
  // Set again replaces; an empty list clears and leaves no empty entry.
  f.set('s1', 'travel', [next]);
  assert.equal(f.list('s1').find((r) => r.module === 'travel').facts.length, 1);
  f.set('s2', 'travel', []);
  assert.ok(!('s2' in JSON.parse(fs.readFileSync(path.join(dir, 'facts.json'), 'utf8')).spaces), 'a cleared space leaves no entry');
  n += 2;
  // A fresh load reads the same; seven days on, reports are dropped on read and on load.
  const g = new Facts(dir, () => now);
  assert.deepEqual(g.list('s1'), f.list('s1'));
  now += 7 * DAY - 1000;
  assert.equal(g.list('s1').length, 2, 'just under 7 days is kept');
  now += 2000;
  assert.deepEqual(g.list('s1'), [], 'over 7 days is dropped');
  assert.deepEqual(new Facts(dir, () => now).list('s1'), [], 'and dropped on load');
  n += 4;
  // Clean-up.
  now = Date.UTC(2026, 9, 14);
  const c = new Facts(dir, () => now);
  c.set('s1', 'travel', [next]);
  c.set('s1', 'polls', [next]);
  c.set('s2', 'travel', [next]);
  c.forgetModule('travel');
  assert.deepEqual(c.list('s1').map((r) => r.module), ['polls']);
  assert.deepEqual(c.list('s2'), []);
  c.forgetSpace('s1');
  assert.deepEqual(c.list('s1'), []);
  assert.equal(c.clear('s1', 'polls'), false, 'clearing nothing is fine');
  n += 4;
  // A damaged or odd file reads as nothing; a stored report that no longer passes the shape check is dropped.
  fs.writeFileSync(path.join(dir, 'facts.json'), '{ not json');
  assert.deepEqual(new Facts(dir, () => now).list('s1'), []);
  fs.writeFileSync(path.join(dir, 'facts.json'), JSON.stringify({ spaces: { s1: { travel: { facts: [{ id: 'X', icon: 'coins', text: 'a' }], at: now }, polls: 7 } } }));
  assert.deepEqual(new Facts(dir, () => now).list('s1'), []);
  n += 2;
  // A file with a `__proto__` key (as a space or a module) leaves Object.prototype clean after load and after a save.
  const good = { facts: [{ id: 'polluted', icon: 'coins', text: 'yes' }], at: now };
  fs.writeFileSync(path.join(dir, 'facts.json'), `{"spaces":{"__proto__":{"travel":${JSON.stringify(good)}},"s1":{"__proto__":${JSON.stringify(good)},"constructor":${JSON.stringify(good)},"travel":${JSON.stringify(good)}}}}`);
  const p = new Facts(dir, () => now);
  ok(!('travel' in Object.prototype) && !('facts' in Object.prototype) && ({}).travel === undefined, 'nothing reached Object.prototype from a __proto__ space');
  ok(Object.getPrototypeOf({}) === Object.prototype && !Object.prototype.polluted, 'Object.prototype is untouched');
  assert.deepEqual(p.list('s1').map((r) => r.module), ['travel'], 'the good report kept, the __proto__ and constructor modules skipped');
  assert.deepEqual(p.list('__proto__'), [], 'no __proto__ space');
  assert.deepEqual(p.list('constructor'), [], 'and nothing read through the prototype');
  p.set('s1', 'polls', [next]);
  ok(!('__proto__' in JSON.parse(fs.readFileSync(path.join(dir, 'facts.json'), 'utf8'), (k, v) => v).spaces) || !Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'facts.json'), 'utf8')).spaces).includes('__proto__'), 'not written back');
  assert.equal(p.set('__proto__', 'travel', [next]), false, 'a __proto__ space is never kept');
  ok(({}).travel === undefined, 'still clean after a set');
  n += 3;
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- the routes, against a throwaway server -----------------------------------------------------------------------
const dataDir = tmp('server');
let child = null;
let port = 0;
let serverOut = '';
async function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir,
      ADMIN_PASSWORD: 'testpass1234',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverOut = '';
  child.stdout.on('data', (d) => { serverOut += d; });
  child.stderr.on('data', (d) => { serverOut += d; });
  port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${serverOut}`)); }, 25000);
    const onData = () => { const m = /listening on :(\d+)/.exec(serverOut); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${serverOut}`)); });
  });
}
const stopServer = () => new Promise((resolve) => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });

async function call(method, urlPath, { body, cookie } = {}) {
  const headers = { accept: 'application/json' };
  if (cookie) headers.cookie = `app_session=${cookie}`;
  let payload;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const expect = async (label, status, method, urlPath, options) => {
  const r = await call(method, urlPath, options);
  assert.equal(r.status, status, `${label}: ${method} ${urlPath} answered ${r.status} ${r.text}`);
  if (status >= 400) assert.match(r.json?.error || '', /^[A-Z0-9$].*\S$/, `${label}: a sentence (${r.text})`);
  n += 1;
  return r;
};

await startServer();
try {
  const login = async (name, password) => {
    const r = await call('POST', '/api/login', { body: { login: name, password } });
    assert.equal(r.status, 200, `${name} signs in: ${r.text}`);
    return r.json.token;
  };
  const admin = await login('admin', 'testpass1234');
  const mk = async (name) => (await call('POST', '/api/users', { cookie: admin, body: { login: name, displayName: name, role: 'member', password: 'memberpass1234' } })).json.user;
  const patUser = await mk('pat');
  const samUser = await mk('sam');
  const moUser = await mk('mo');
  await mk('out');
  // Bundled To-do (write is "edit"), Polls (write is "vote") and the Planner (travel: read is "view", write "edit"),
  // turned on for the environment.
  for (const id of ['todo', 'polls', 'travel']) {
    const r = await call('POST', `/api/modules/bundled/${id}/install`, { cookie: admin });
    assert.ok(r.status === 201 || r.status === 200, `${id} installs: ${r.status} ${r.text}`);
    if (!r.json.module?.enabled) await expect(`${id} on`, 200, 'PATCH', `/api/modules/${id}`, { cookie: admin, body: { enabled: true } });
  }
  const S = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Trip', members: [patUser.key, samUser.key, moUser.key] } })).json.space.id;
  await expect('mo moderates', 200, 'PATCH', `/api/users/${moUser.key}/spaces/${S}`, { cookie: admin, body: { permissions: { moderator: true } } });
  const pat = await login('pat', 'memberpass1234');
  const sam = await login('sam', 'memberpass1234');
  const mo = await login('mo', 'memberpass1234');
  const out = await login('out', 'memberpass1234');
  await expect('guests allowed', 200, 'PATCH', `/api/spaces/${S}`, { cookie: admin, body: { allowGuests: true } });
  const guestToken = (await expect('guest link', 200, 'POST', `/api/spaces/${S}/guest-link`, { cookie: admin, body: {} })).json.space.guestToken;
  const asGuest = `?guest=${encodeURIComponent(guestToken)}`;
  const F = `/api/spaces/${S}/facts`;

  // Nothing yet.
  assert.deepEqual((await expect('empty', 200, 'GET', F, { cookie: pat })).json, { modules: [] });

  // A member reports for a module they can write in; another member reads the same facts (the space's, not a person's),
  // with the module's shown name; who sent them is not said.
  await expect('member reports', 200, 'PUT', `${F}/todo`, { cookie: pat, body: { facts: [spent, next] } });
  const seen = (await expect('another member reads', 200, 'GET', F, { cookie: sam })).json;
  assert.equal(seen.modules.length, 1);
  const m = seen.modules[0];
  assert.deepEqual({ module: m.module, name: m.name, facts: m.facts }, { module: 'todo', name: 'To-do', facts: [spent, next] });
  ok(Number.isFinite(m.at) && Math.abs(Date.now() - m.at) < 60000, 'at is when it was reported');
  ok(!JSON.stringify(seen).includes(patUser.key), 'who sent them is not said');
  assert.deepEqual((await call('GET', F, { cookie: admin })).json.modules.map((x) => x.module), ['todo'], 'the admin reads them too');
  n += 1;

  // A second module; another member's report replaces the module's, it is not added to it.
  await expect('second module', 200, 'PUT', `${F}/polls`, { cookie: sam, body: { facts: [{ id: 'open', icon: 'square-poll-vertical', text: '2 polls open' }] } });
  await expect('sam reports todo', 200, 'PUT', `${F}/todo`, { cookie: sam, body: { facts: [next] } });
  const two = (await call('GET', F, { cookie: pat })).json;
  assert.deepEqual(two.modules.map((x) => [x.module, x.facts.length]), [['todo', 1], ['polls', 1]], 'one report per module, the last');
  n += 1;

  // Someone not in the space, nobody signed in and a guest are refused; no such space or module.
  await expect('not in the space reads', 404, 'GET', F, { cookie: out });
  await expect('not in the space reports', 404, 'PUT', `${F}/todo`, { cookie: out, body: { facts: [next] } });
  await expect('nobody signed in reads', 401, 'GET', F);
  await expect('nobody signed in reports', 401, 'PUT', `${F}/todo`, { body: { facts: [next] } });
  const g = await expect('guest reads', 403, 'GET', `${F}${asGuest}`);
  assert.match(g.json.error, /^Guests do not see/);
  await expect('guest reports', 403, 'PUT', `${F}/todo${asGuest}`, { body: { facts: [next] } });
  await expect('guest clears', 403, 'DELETE', `${F}/todo${asGuest}`);
  await expect('no such space', 404, 'GET', '/api/spaces/nope/facts', { cookie: pat });
  await expect('no such module', 404, 'PUT', `${F}/nothing`, { cookie: pat, body: { facts: [next] } });

  // A bad shape is a 400 with one sentence, and changes nothing.
  for (const [label, body] of [
    ['no list', {}],
    ['too many', { facts: Array.from({ length: 7 }, (_, i) => ({ ...next, id: `f${i}` })) }],
    ['words too long', { facts: [{ ...next, text: 'x'.repeat(41) }] }],
    ['unknown icon', { facts: [{ ...next, icon: 'no-such-icon-here' }] }],
    ['progress over 1', { facts: [{ ...next, progress: 2 }] }],
    ['bad id', { facts: [{ ...next, id: 'Next One' }] }],
  ]) await expect(label, 400, 'PUT', `${F}/todo`, { cookie: pat, body });
  assert.deepEqual((await call('GET', F, { cookie: pat })).json.modules.find((x) => x.module === 'todo').facts, [next], 'a refused report changes nothing');
  n += 1;

  // Without `write` in the module a person cannot report for it, though they still read.
  await expect('take edit from members', 200, 'PATCH', '/api/roles/member', { cookie: admin, body: { 'module.todo.edit': false } });
  const noWrite = await expect('no write', 403, 'PUT', `${F}/todo`, { cookie: sam, body: { facts: [next] } });
  assert.equal(noWrite.json.error, 'Your role can\'t do that in this module.');
  await expect('no write clears', 403, 'DELETE', `${F}/todo`, { cookie: sam });
  await expect('still reads', 200, 'GET', F, { cookie: sam });
  await expect('give edit back', 200, 'PATCH', '/api/roles/member', { cookie: admin, body: { 'module.todo.edit': true } });
  // Without `read` (To-do's "view") that module's facts are left out of what the person reads; the others stay.
  await expect('take view from members', 200, 'PATCH', '/api/roles/member', { cookie: admin, body: { 'module.todo.view': false } });
  assert.deepEqual((await call('GET', F, { cookie: sam })).json.modules.map((x) => x.module), ['polls'], 'no To-do facts without view');
  assert.deepEqual((await call('GET', F, { cookie: admin })).json.modules.map((x) => x.module), ['todo', 'polls'], 'the admin still reads both');
  await expect('give view back', 200, 'PATCH', '/api/roles/member', { cookie: admin, body: { 'module.todo.view': true } });
  n += 2;

  // An empty list and DELETE clear one module's facts.
  await expect('empty list clears', 200, 'PUT', `${F}/polls`, { cookie: sam, body: { facts: [] } });
  assert.deepEqual((await call('GET', F, { cookie: pat })).json.modules.map((x) => x.module), ['todo']);
  await expect('delete clears', 200, 'DELETE', `${F}/todo`, { cookie: pat });
  assert.deepEqual((await call('GET', F, { cookie: pat })).json, { modules: [] });
  await expect('delete again is fine', 200, 'DELETE', `${F}/todo`, { cookie: pat });
  n += 2;

  // --- the budget target (#216) on the space record -------------------------------------------------------------
  const P = `/api/spaces/${S}`;
  const ctx = async (cookie) => (await call('GET', `/api/modules/todo/context?scope=space&space=${S}`, { cookie })).json.space;
  assert.equal((await ctx(pat)).budget, null, 'no target: null in the module context');
  n += 1;
  const set = await expect('the admin sets a target', 200, 'PATCH', P, { cookie: admin, body: { budget: { amount: 4000 } } });
  assert.deepEqual(set.json.space.budget, { amount: 4000 }, 'no currency: the module\'s own');
  assert.deepEqual((await ctx(pat)).budget, { amount: 4000 }, 'the module context carries it, for a member too');
  const withCode = await expect('with a currency', 200, 'PATCH', P, { cookie: admin, body: { budget: { amount: 1234.567, currency: 'eur' } } });
  assert.deepEqual(withCode.json.space.budget, { amount: 1234.57, currency: 'EUR' }, 'rounded to cents, the code in capitals');
  n += 3;
  // A moderator of the space may set it (MODERATOR_SPACE_FIELDS holds `budget`), and their answer and Set up's read
  // carry it; a member and someone outside may not, and a guest is not signed in at all.
  const moSet = await expect('the moderator sets a target', 200, 'PATCH', P, { cookie: mo, body: { budget: { amount: 10 } } });
  assert.deepEqual(moSet.json.space.budget, { amount: 10 }, 'the moderator\'s answer carries it');
  assert.deepEqual((await expect('the moderator reads it back', 200, 'GET', P, { cookie: mo })).json.space.budget, { amount: 10 });
  const moAlso = await expect('beside a moderator\'s other field', 200, 'PATCH', P, { cookie: mo, body: { budget: { amount: 1234.567, currency: 'eur' }, opensWith: null } });
  assert.deepEqual(moAlso.json.space.budget, { amount: 1234.57, currency: 'EUR' });
  n += 3;
  const ownersOnly = { error: 'owners only' };
  for (const [label, cookie] of [['a member', pat], ['someone outside', out]]) {
    const r = await call('PATCH', P, { cookie, body: { budget: { amount: 10 } } });
    assert.deepEqual([r.status, r.json], label === 'a member' ? [403, ownersOnly] : [404, { error: 'no such space' }], `${label} may not set the budget: ${r.text}`);
    n += 1;
  }
  const guestSet = await call('PATCH', `${P}${asGuest}`, { body: { budget: { amount: 10 } } });
  assert.equal(guestSet.status, 401, `a guest may not set the budget: ${guestSet.text}`);
  const moBoth = await call('PATCH', P, { cookie: mo, body: { budget: null, name: 'Mine' } });
  assert.deepEqual([moBoth.status, moBoth.json], [403, ownersOnly], 'not beside a field that is not a moderator\'s');
  assert.deepEqual((await call('GET', P, { cookie: admin })).json.space.budget, { amount: 1234.57, currency: 'EUR' }, 'the refusals changed nothing');
  n += 3;
  // The rules: a positive amount of at most 12 digits, a currency the server knows; one plain sentence each; a refusal
  // changes nothing.
  for (const [label, budget, words] of [
    ['zero', { amount: 0 }, 'The budget must be an amount above zero.'],
    ['negative', { amount: -5 }, 'The budget must be an amount above zero.'],
    ['under a cent', { amount: 0.001 }, 'The budget must be an amount above zero.'],
    ['text', { amount: '4000' }, 'The budget must be an amount above zero.'],
    ['nothing in it', {}, 'The budget needs an amount or a currency, or nothing to clear it.'],
    ['an empty currency alone', { currency: '' }, 'The budget needs an amount or a currency, or nothing to clear it.'],
    // Set up sends an entry it cannot read as `amount: null`: refused, never read as "a currency alone", so a bad
    // entry never deletes the stored amount.
    ['a bad entry beside a currency', { amount: null, currency: 'EUR' }, 'The budget must be an amount above zero.'],
    ['a bad entry alone', { amount: null }, 'The budget must be an amount above zero.'],
    ['a bad code alone', { currency: 'euros' }, 'The budget\'s currency is a three-letter code, such as USD.'],
    ['13 digits', { amount: 1e12 }, 'The budget can be at most 12 digits.'],
    ['a bad code', { amount: 5, currency: 'dollars' }, 'The budget\'s currency is a three-letter code, such as USD.'],
    ['an unknown code', { amount: 5, currency: 'QQQ' }, 'QQQ is not a currency this server knows. Choose one from the list, such as USD.'],
    ['not an object', 4000, 'The budget needs an amount or a currency, or nothing to clear it.'],
  ]) {
    const r = await call('PATCH', P, { cookie: admin, body: { budget } });
    assert.deepEqual([r.status, r.json], [400, { error: words }], `${label}: ${r.text}`);
    n += 1;
  }
  // The moderator's bad entry is refused the same way.
  const moBad = await call('PATCH', P, { cookie: mo, body: { budget: { amount: null, currency: 'USD' } } });
  assert.deepEqual([moBad.status, moBad.json], [400, { error: 'The budget must be an amount above zero.' }], `a moderator's bad entry: ${moBad.text}`);
  n += 1;
  assert.deepEqual((await call('GET', P, { cookie: admin })).json.space.budget, { amount: 1234.57, currency: 'EUR' }, 'the refusals changed nothing');
  await expect('12 digits is fine', 200, 'PATCH', P, { cookie: admin, body: { budget: { amount: 999999999999 } } });
  // A currency alone (decision 7): a space that chose its currency with no target. The moderator may set it too; the
  // module context carries it; a bad entry beside it changes nothing.
  const alone = await expect('a currency alone', 200, 'PATCH', P, { cookie: mo, body: { budget: { currency: 'gbp' } } });
  assert.deepEqual(alone.json.space.budget, { currency: 'GBP' }, 'kept with no amount');
  assert.deepEqual((await call('GET', P, { cookie: admin })).json.space.budget, { currency: 'GBP' }, 'stored so');
  assert.deepEqual((await ctx(pat)).budget, { currency: 'GBP' }, 'a member reads it through the module');
  await expect('a bad entry beside it', 400, 'PATCH', P, { cookie: mo, body: { budget: { amount: null, currency: 'GBP' } } });
  assert.deepEqual((await call('GET', P, { cookie: mo })).json.space.budget, { currency: 'GBP' }, 'still there');
  const both = await expect('an amount added to it', 200, 'PATCH', P, { cookie: mo, body: { budget: { amount: 75, currency: 'GBP' } } });
  assert.deepEqual(both.json.space.budget, { amount: 75, currency: 'GBP' });
  const noCode = await expect('an amount without a currency', 200, 'PATCH', P, { cookie: mo, body: { budget: { amount: 75 } } });
  assert.deepEqual(noCode.json.space.budget, { amount: 75 }, 'the currency goes with it: the body is the whole target');
  n += 5;
  const cleared = await expect('null clears', 200, 'PATCH', P, { cookie: admin, body: { budget: null } });
  ok(!('budget' in cleared.json.space), 'no budget once cleared');
  assert.equal((await ctx(pat)).budget, null);
  n += 1;
  await expect('set again', 200, 'PATCH', P, { cookie: admin, body: { budget: { amount: 500, currency: 'USD' } } });

  // --- who reads the budget (#216): it is not a general part of the space ---------------------------------------
  // Those who edit it (owners, the admin, the space's moderators) through Set up's read and their own PATCH's answer;
  // a member through a module's context, while they may read that module there. The presence list, GET /api/spaces,
  // the stream's status and a guest's presence never carry it: not to someone outside the space, a guest, a member
  // without the Planner's view, a member with it, nor the admin.
  await expect('a guest link again', 200, 'POST', `/api/spaces/${S}/guest-link`, { cookie: admin, body: {} });
  const guestNow = (await call('GET', `/api/spaces/${S}`, { cookie: admin })).json.space.guestToken;
  // Members lose the Planner's view (sam stands for them); mo, a member ticked moderator here, keeps it through the
  // moderator's role and stands for a member who may read the Planner.
  await expect('take the Planner\'s view from members', 200, 'PATCH', '/api/roles/member', { cookie: admin, body: { 'module.travel.view': false } });
  const planCtx = async (cookie, q = '') => call('GET', `/api/modules/travel/context?scope=space&space=${S}${q}`, { cookie });
  assert.equal((await planCtx(sam)).status, 403, 'sam may not read the Planner here now');
  assert.equal((await planCtx(mo)).status, 200, 'mo still may');
  n += 1;
  const spaceIn = (json) => (json?.spaces || []).find((r) => r.id === S);
  for (const [label, cookie, q] of [['someone not in the space', out, ''], ['a guest', null, `?guest=${encodeURIComponent(guestNow)}`], ['a member without the Planner\'s view', sam, ''], ['a member with it (the moderator)', mo, ''], ['the admin', admin, '']]) {
    const pres = await call('GET', `/api/presence${q}`, { cookie });
    assert.equal(pres.status, 200, `${label} reads presence: ${pres.text}`);
    const rec = spaceIn(pres.json);
    const outside = label === 'someone not in the space'; // a space one may not enter is not listed at all
    assert.ok(outside ? !rec : rec, `${label}: the space is ${outside ? 'not ' : ''}listed`);
    ok((outside || !('budget' in rec)) && !pres.text.includes('"budget"'), `${label}: no budget in /api/presence`);
    if (cookie) {
      const list = await call('GET', '/api/spaces', { cookie });
      assert.equal(list.status, 200);
      ok((outside ? !spaceIn(list.json) : !('budget' in spaceIn(list.json))) && !list.text.includes('"budget"'), `${label}: no budget in GET /api/spaces`);
    }
  }
  const guestList = await call('GET', `/api/spaces?guest=${encodeURIComponent(guestNow)}`);
  ok(guestList.status === 401 && !guestList.text.includes('budget'), 'a guest has no space list at all');
  // The stream's status (OBS and the Studio app, with the stream key or an owner's session) leaves it out too.
  const status = await call('GET', '/api/status', { cookie: admin });
  assert.equal(status.status, 200, status.text);
  ok(!('budget' in spaceIn(status.json)) && !status.text.includes('"budget"'), 'no budget in the stream\'s status');
  // Set up's read: the admin's carries the whole record; the moderator's carries the id and a moderator's fields, the
  // budget among them, and nothing else of the record; a member, someone outside and a guest are refused that read.
  assert.deepEqual((await call('GET', P, { cookie: admin })).json.space.budget, { amount: 500, currency: 'USD' }, 'Set up\'s read carries it for the admin');
  const moRead = (await expect('the moderator\'s Set up read', 200, 'GET', P, { cookie: mo })).json.space;
  assert.deepEqual(moRead.budget, { amount: 500, currency: 'USD' }, 'it carries the budget for the moderator');
  ok(Object.keys(moRead).every((k) => ['id', 'phases', 'opensWith', 'defaultLayout', 'budget'].includes(k)) && !('name' in moRead) && !('guestToken' in moRead), `only the moderator's fields (${Object.keys(moRead)})`);
  for (const [label, cookie] of [['a member', pat], ['someone outside', out]]) {
    const r = await call('GET', P, { cookie });
    ok((label === 'a member' ? r.status === 403 && r.json?.error === 'owners only' : r.status === 404 && r.json?.error === 'no such space') && !r.text.includes('budget'), `${label} cannot read Set up's record (${r.status})`);
  }
  const guestRead = await call('GET', `${P}?guest=${encodeURIComponent(guestNow)}`);
  ok(guestRead.status === 401 && !guestRead.text.includes('budget'), `a guest cannot read Set up's record (${guestRead.status})`);
  // A moderator of another space is not a moderator here.
  const S2 = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Other', members: [samUser.key] } })).json.space.id;
  await expect('sam moderates the other space', 200, 'PATCH', `/api/users/${samUser.key}/spaces/${S2}`, { cookie: admin, body: { permissions: { moderator: true } } });
  const samHere = await call('PATCH', P, { cookie: sam, body: { budget: { amount: 1 } } });
  assert.deepEqual([samHere.status, samHere.json], [403, ownersOnly], 'a moderator elsewhere may not set it here');
  ok((await call('GET', P, { cookie: sam })).status === 403, 'nor read Set up\'s record here');
  // The moderator's and the admin's own PATCH answers carry it; a member's guest-link answer does not.
  const moSave = await expect('the moderator saves the first visit', 200, 'PATCH', P, { cookie: mo, body: { opensWith: null } });
  assert.deepEqual(moSave.json.space.budget, { amount: 500, currency: 'USD' }, 'the moderator\'s answer carries it');
  ok('budget' in (await call('PATCH', P, { cookie: admin, body: { opensWith: null } })).json.space, 'the admin\'s answer carries it');
  const patLink = await call('POST', `/api/spaces/${S}/guest-link`, { cookie: pat, body: {} });
  if (patLink.status === 200) ok(!('budget' in patLink.json.space), 'no budget in a member\'s guest-link answer');
  else ok(!patLink.text.includes('budget'), `a member's guest-link refusal carries no budget (${patLink.status})`);
  n += 3;
  // The module context: a member who may read the Planner, and the admin, get it; a guest gets null; a member without
  // the Planner's view and someone outside get no context at all.
  assert.deepEqual((await planCtx(mo)).json.space.budget, { amount: 500, currency: 'USD' }, 'a member with the Planner\'s view');
  assert.deepEqual((await planCtx(admin)).json.space.budget, { amount: 500, currency: 'USD' }, 'the admin');
  const guestCtx = await planCtx(null, `&guest=${encodeURIComponent(guestNow)}`);
  assert.equal(guestCtx.status, 200, `a guest reads the Planner here: ${guestCtx.text}`);
  assert.equal(guestCtx.json.space.budget, null, 'but never the budget');
  ok(!guestCtx.text.includes('500'), 'not even its amount');
  for (const [label, cookie] of [['a member without the view', sam], ['someone outside', out]]) {
    const r = await planCtx(cookie);
    assert.equal(r.status, label === 'someone outside' ? 404 : 403, `${label}: ${r.text}`);
    ok(!r.text.includes('budget'), `${label}: no budget`);
  }
  await expect('give members the view back', 200, 'PATCH', '/api/roles/member', { cookie: admin, body: { 'module.travel.view': true } });
  assert.deepEqual((await planCtx(pat)).json.space.budget, { amount: 500, currency: 'USD' }, 'with the view back, a plain member reads it in the Planner\'s context');
  ok(!('budget' in spaceIn((await call('GET', '/api/presence', { cookie: pat })).json)), 'and still not in the presence list');
  n += 5;

  // Stale: facts older than 7 days are dropped; the budget is kept across a start. Stop, age one report, start again.
  await expect('pat reports', 200, 'PUT', `${F}/todo`, { cookie: pat, body: { facts: [spent] } });
  await expect('sam reports polls', 200, 'PUT', `${F}/polls`, { cookie: sam, body: { facts: [next] } });
  await stopServer();
  const file = path.join(dataDir, 'facts.json');
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  stored.spaces[S].todo.at = Date.now() - 8 * DAY;
  stored.spaces[S].polls.at = Date.now() - 6 * DAY;
  fs.writeFileSync(file, JSON.stringify(stored));
  await startServer();
  const patAgain = await login('pat', 'memberpass1234');
  assert.deepEqual((await expect('after 8 days', 200, 'GET', F, { cookie: patAgain })).json.modules.map((x) => x.module), ['polls'], 'the 8-day-old report is dropped, the 6-day-old kept');
  const adminAgain = await login('admin', 'testpass1234');
  assert.deepEqual((await call('GET', P, { cookie: adminAgain })).json.space.budget, { amount: 500, currency: 'USD' }, 'the budget is kept');
  n += 1;

  // A removed space's facts go with it.
  await expect('remove the space', 200, 'DELETE', P, { cookie: adminAgain });
  await stopServer();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).spaces, {}, 'nothing is left of that space');
  n += 1;
} finally {
  await stopServer();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(`check-facts: ${n} checks passed`);
