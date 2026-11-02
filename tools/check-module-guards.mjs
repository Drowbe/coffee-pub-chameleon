#!/usr/bin/env node
/*
 * check-module-guards.mjs -- a module's data guards (server/module-guards.js): the server, not only the page, holds people
 * to a module's finer permissions and value shapes, and keeps its hidden fields from guests.
 *   - The manifest: guards are read and refused as cleanGuards says (a rule's parts, permissions that exist, `clear` needed
 *     with `keys`, `parentOpen` needs a parent rule that says when it is closed, field specs), and every bundled module's
 *     guards read.
 *   - The matcher and the rules, as a table: key patterns and their parts, the closed prefix, a person's own key, a parent's
 *     closed state, an owner's field, `need`, `others` and `others.may` (append, when, open), field shapes, deletes and
 *     clearing, and hide / keepHidden.
 *   - Live, against the screenshot seed (tools/shots-seed.mjs, the travel one) on a throwaway server: the audit's cases
 *     (health-audit polls-budget PB-01, PB-02, PB-03, PB-05) refused or redacted, and what the pages do still allowed: a
 *     vote for someone else, a fake voter, a vote on a closed poll, a key that slips the pattern, a poll started or changed
 *     without `create`, someone else's poll changed or deleted without `manage_any`, an option suggested on an open poll
 *     that allows it, clearing a module by a member, a negative, zero, too large or text cost; a guest's Planner data and
 *     live changes without cost, estimate, confirm or paidBy, has=amount refused for a guest, the owner opening the
 *     space's guestsSeeHidden showing them, a guest's write keeping them; a poll past its closing time `done` in its
 *     summary; a research photo removed or emptied only by whoever may; the canvas's `clear` flag.
 *   - The feedback build's cases: a vote is a list of the poll's own option ids, no id twice, one unless the poll takes
 *     several; a poll's closed, closesAt, multi and addable typed; an added option needs a new id and is named by the
 *     server; a cost at least 0.01; a guest who can't see hidden fields can't remove, replace or clear what holds them;
 *     guards whose hidden fields don't read shut the module's data to guests (after a restart); Research's ids are one
 *     kind's only (exclusive), a photo's file must be the writer's and goes with the photo (also when a remove_photos
 *     holder removes it, kept while another photo names it); a member without Research edit writes in Mine
 *     (access.personWrite), notes and photos with their uploads; link pictures refused to guests and to addresses no link
 *     here has; icons without a session; a closed poll's votes are final (nobody removes one), and a poll removed takes
 *     its votes with it; the module context's space.guestsSeeHidden.
 * No network beyond localhost, no LiveKit.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const guards = require('../server/module-guards.js');
const { ModuleError } = require('../server/modules.js');

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

// --- the manifest ------------------------------------------------------------------------------------------------------
const PERMS = ['view', 'vote', 'create', 'manage_any'];
const clean = (raw) => guards.cleanGuards(raw, PERMS, ModuleError);
const POLLS_GUARDS = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'polls', 'module.json'), 'utf8')).guards;

await test('manifest: guards are read, and refused with a sentence', () => {
  assert.equal(clean(undefined), null);
  assert.equal(clean({}), null, 'nothing declared is no guards');
  const g = clean(POLLS_GUARDS);
  assert.equal(g.clear, 'manage_any');
  assert.deepEqual(g.keys.map((r) => r.key), ['poll:{id}', 'vote:{poll}:{person}']);
  assert.equal(g.keys[1].person, true);
  const bad = [
    [[], /"guards" must be an object/],
    [{ keys: [{ key: 'poll:{id}' }] }, /guards.clear is needed with guards.keys/],
    [{ clear: 'nobody' }, /guards.clear must name one of the module's own permissions/],
    [{ clear: 'owner', keys: [{ key: '{id}' }] }, /keys\[0\].key must be a stored key/],
    [{ clear: 'owner', keys: [{ key: 'a:{x}:{x}' }] }, /names a part twice/],
    [{ clear: 'owner', keys: [{ key: 'a:{x}' }, { key: 'a:{y}' }] }, /is listed twice/],
    [{ clear: 'owner', keys: [{ key: 'a:{x}', need: 'fly' }] }, /need must name one of the module's own permissions/],
    [{ clear: 'owner', keys: [{ key: 'a:{x}', personName: 'name' }] }, /personName needs a \{person\} part/],
    [{ clear: 'owner', keys: [{ key: 'a:{person}', owner: 'by' }] }, /both a \{person\} part and an "owner"/],
    [{ clear: 'owner', keys: [{ key: 'a:{x}', others: { change: 'create' } }] }, /others needs an "owner"/],
    [{ clear: 'owner', keys: [{ key: 'a:{x}', owner: 'by', others: { may: ['title'] } }] }, /others.may needs others.change/],
    [{ clear: 'owner', keys: [{ key: 'a:{x}', owner: 'by', others: { change: 'create', may: [{ field: 'o', open: true }] } }] }, /uses "open", which needs "closed"/],
    [{ clear: 'owner', keys: [{ key: 'a:{x}', owner: 'by', others: { change: 'create', may: ['by'] } }] }, /can't list the owner's fields/],
    [{ clear: 'owner', keys: [{ key: 'v:{p}', parent: 'a:{q}' }] }, /parent may only use the key's own/],
    [{ clear: 'owner', keys: [{ key: 'v:{p}', parent: 'a:{p}', parentOpen: true }] }, /needs a rule for "a:\{p\}" that says when it is "closed"/],
    [{ clear: 'owner', keys: [{ key: 'v:{p}', parentOpen: true }] }, /parentOpen needs a "parent"/],
    [{ clear: 'owner', keys: [{ key: 'c:{id}', fields: { amount: { type: 'money' } } }] }, /fields.amount.type must be/],
    [{ clear: 'owner', keys: [{ key: 'c:{id}', fields: { title: { type: 'string', above: 0 } } }] }, /above must be a number, on a number field/],
    [{ hidden: ['ok', 'not ok'] }, /each guards.hidden entry must name a stored field/],
  ];
  for (const [raw, message] of bad) assert.throws(() => clean(raw), message, JSON.stringify(raw));
});

await test('manifest: every bundled module reads, guards and all; Polls, Budget, the Planner and Research declare theirs', () => {
  for (const id of fs.readdirSync(path.join(ROOT, 'modules'))) {
    const dir = path.join(ROOT, 'modules', id);
    if (!fs.existsSync(path.join(dir, 'module.json'))) continue;
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'module.json'), 'utf8'));
    const m = { guards: guards.cleanGuards(raw.guards, (raw.permissions || []).map((p) => p.key), ModuleError) };
    if (['polls', 'budget', 'research'].includes(id)) assert.ok(m.guards && m.guards.clear && m.guards.keys.length, `${id} has guards with keys`);
    else if (id !== 'travel') assert.equal(m.guards, null, `${id} declares none`);
    if (id === 'travel') assert.deepEqual(m.guards.hidden, ['cost', 'estimate', 'confirm', 'paidBy']);
    if (id === 'budget') assert.deepEqual(m.guards.hidden, ['planned', 'actual', 'amount', 'paidBy', 'sharedBy']);
  }
});

// --- the matcher and the rules, as a table -------------------------------------------------------------------------------
await test('matcher: key patterns and their parts', () => {
  const rows = [
    ['poll:{id}', 'poll:q1', { id: 'q1' }],
    ['poll:{id}', 'poll:', null],
    ['poll:{id}', 'poll:q1:x', null],
    ['poll:{id}', 'polls:q1', null],
    ['vote:{poll}:{person}', 'vote:q1:ab12cd', { poll: 'q1', person: 'ab12cd' }],
    ['vote:{poll}:{person}', 'vote:q1:ab12cd:x', null],
    ['vote:{poll}:{person}', 'vote:q1', null],
    ['a.b/{x}-c', 'a.b/7-c', { x: '7' }],
    ['a.b/{x}-c', 'aXb/7-c', null],
    ['cost:{id}', 'cost:a_b.c-d', { id: 'a_b.c-d' }],
  ];
  for (const [pattern, key, want] of rows) assert.deepEqual(guards.matchKey(pattern, key), want, `${pattern} ~ ${key}`);
  const g = clean(POLLS_GUARDS);
  assert.equal(guards.ruleFor(g, 'vote:q1:mia').rule.key, 'vote:{poll}:{person}');
  assert.equal(guards.ruleFor(g, 'other'), null);
});

await test('closed: by its flag, or once its time has passed', () => {
  const c = { flag: 'closed', at: 'closesAt' };
  assert.equal(guards.closedNow(c, { closed: true }, 0), true);
  assert.equal(guards.closedNow(c, { closed: false, closesAt: 100 }, 99), false);
  assert.equal(guards.closedNow(c, { closed: false, closesAt: 100 }, 100), true);
  assert.equal(guards.closedNow(c, { closed: false, closesAt: null }, 1e15), false);
  assert.equal(guards.closedNow(c, { closed: false, closesAt: '100' }, 1e15), false, 'only a number of milliseconds is a time');
});

await test('rules: what a PUT and a DELETE answer, case by case', () => {
  const g = clean(POLLS_GUARDS);
  const person = (key, perms) => ({ key, name: `Name of ${key}`, owner: false, can: (p) => perms.includes(p) });
  const member = person('sam', ['view', 'vote', 'create']);
  const voter = person('lee', ['view', 'vote']);
  const manager = person('boss', ['view', 'vote', 'create', 'manage_any']);
  const guest = { key: null, name: '', owner: false, can: () => false };
  const NOW = 1000;
  const poll = (extra = {}) => ({ id: 'q1', question: 'Where?', options: [{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B' }], multi: false, addable: true, closed: false, closesAt: null, by: 'Mia', byKey: 'mia', ...extra });
  const store = { 'poll:q1': poll(), 'poll:q2': poll({ id: 'q2', closed: true }), 'poll:q3': poll({ id: 'q3', closesAt: 500 }), 'poll:q4': poll({ id: 'q4', addable: false }) };
  const read = (k) => store[k] || null;
  const put = (key, value, who, before = store[key] || null) => guards.checkPut(g, { key, before, value, who, read, now: NOW });
  const del = (key, who, before = store[key] || null) => guards.checkDelete(g, { key, before, who, read, now: NOW });
  const status = (r) => (r && r.error ? r.status : r && 'value' in r ? 200 : r === null ? 200 : r.status);
  const rows = [
    // [what, answer, status]
    ['a vote of one\'s own', put('vote:q1:sam', { options: ['o1'], name: 'X' }, member), 200],
    ['a vote for someone else', put('vote:q1:mia', { options: ['o1'] }, member), 403],
    ['a vote for a made-up voter', put('vote:q1:zzfake', { options: ['o1'] }, member), 403],
    ['a key that slips the pattern', put('vote:q1:sam:x', { options: ['o1'] }, member), 400],
    ['a key that slips the poll pattern', put('poll:q1:x', poll(), member), 400],
    ['a key no rule is about', put('note:x', { anything: 1 }, member), 200],
    ['a vote on a poll closed by hand', put('vote:q2:sam', { options: ['o1'] }, member), 403],
    ['a vote on a poll past its time', put('vote:q3:sam', { options: ['o1'] }, member), 403],
    ['a vote on a poll that is not there', put('vote:qx:sam', { options: ['o1'] }, member), 404],
    ['a vote that is not an object', put('vote:q1:sam', 'o1', member), 400],
    ['a guest\'s vote', put('vote:q1:guest', { options: ['o1'] }, guest), 403],
    ['a new poll with create', put('poll:n1', poll({ id: 'n1', byKey: undefined, by: undefined }), member, null), 200],
    ['a new poll without create', put('poll:n1', poll({ id: 'n1', byKey: 'lee' }), voter, null), 403],
    ['a new poll in someone else\'s name', put('poll:n1', poll({ id: 'n1', byKey: 'mia' }), member, null), 403],
    ['a new poll in someone else\'s name, by a manager', put('poll:n1', poll({ id: 'n1', byKey: 'mia' }), manager, null), 200],
    ['someone else\'s question changed', put('poll:q1', poll({ question: 'Changed' }), member), 403],
    ['someone else\'s question changed, by a manager', put('poll:q1', poll({ question: 'Changed' }), manager), 200],
    ['someone else\'s poll closed', put('poll:q1', poll({ closed: true }), member), 403],
    ['an option added to an open poll that allows it', put('poll:q1', poll({ options: [...poll().options, { id: 'o3', text: 'C', by: 'Lee' }] }), voter), 200],
    ['an option changed, not added', put('poll:q1', poll({ options: [{ id: 'o1', text: 'Changed' }, { id: 'o2', text: 'B' }] }), voter), 403],
    ['an option added to a poll that does not allow it', put('poll:q4', poll({ id: 'q4', addable: false, options: [...poll().options, { id: 'o3', text: 'C' }] }), voter), 403],
    ['an option added to a closed poll', put('poll:q2', poll({ id: 'q2', closed: true, options: [...poll().options, { id: 'o3', text: 'C' }] }), voter), 403],
    ['someone else\'s poll marked announced', put('poll:q3', { ...poll({ id: 'q3', closesAt: 500 }), announced: true }, voter), 200],
    ['who started it changed', put('poll:q1', poll({ byKey: 'sam' }), manager), 403],
    ['one\'s own poll without create', put('poll:q1', poll({ question: 'Mine' }), person('mia', ['view', 'vote'])), 403],
    ['one\'s own poll with create', put('poll:q1', poll({ question: 'Mine' }), person('mia', ['view', 'vote', 'create'])), 200],
    ['someone else\'s poll deleted', del('poll:q1', member), 403],
    ['someone else\'s poll deleted, by a manager', del('poll:q1', manager), 200],
    ['one\'s own poll deleted', del('poll:q1', person('mia', ['create'])), 200],
    ['someone else\'s vote deleted', del('vote:q1:mia', member, { options: ['o1'] }), 403],
    ['someone else\'s vote deleted by the poll\'s starter', del('vote:q1:sam', person('mia', ['create']), { options: ['o1'] }), 200],
    ['someone else\'s vote on a closed poll deleted by a manager: a closed poll is final', del('vote:q2:sam', manager, { options: ['o1'] }), 403],
    ['a vote on a closed poll deleted by its starter', del('vote:q2:sam', person('mia', ['create']), { options: ['o1'] }), 403],
    ['one\'s own vote taken back on an open poll', del('vote:q1:sam', member, { options: ['o1'] }), 200],
    ['one\'s own vote taken back on a closed poll', del('vote:q2:sam', member, { options: ['o1'] }), 403],
    ['a key that is not there deleted', del('vote:q1:mia', member, null), 200],
  ];
  for (const [what, answer, want] of rows) assert.equal(status(answer), want, `${what}: ${JSON.stringify(answer)}`);
  // What the server sets: the voter's own name, the starter's key and name.
  assert.equal(put('vote:q1:sam', { options: ['o1'], name: 'Thomas' }, member).value.name, 'Name of sam');
  const made = put('poll:n1', poll({ id: 'n1', byKey: undefined, by: 'Someone else' }), member, null).value;
  assert.deepEqual([made.byKey, made.by], ['sam', 'Name of sam']);
  const kept = put('poll:q1', (({ byKey, ...rest }) => rest)(poll({ question: 'Mine', by: 'Changed' })), person('mia', ['create'])).value;
  assert.deepEqual([kept.byKey, kept.by], ['mia', 'Mia'], 'left out or changed, who started it is kept');
  // Every refusal is one sentence.
  for (const [, answer] of rows) if (answer && answer.error) assert.match(answer.error, /^[A-Z].*[.]$/, answer.error);
  // Clearing.
  assert.equal(guards.checkClear(g, member).status, 403);
  assert.equal(guards.checkClear(g, manager), null);
  assert.equal(guards.checkClear(clean({ clear: 'owner' }), manager).status, 403);
  assert.equal(guards.checkClear(clean({ clear: 'owner' }), { ...member, owner: true }), null);
  assert.equal(guards.checkClear(null, member), null, 'no guards: clearing is as before');
  // Guards that no longer read refuse every write.
  assert.equal(guards.checkPut({ invalid: true, keys: [] }, { key: 'x', value: {}, who: member, read }).status, 403);
});

await test('fields: the shape of a value', () => {
  const amount = { type: 'number', null: true, above: 0, below: 1e12 };
  const g = clean({ clear: 'owner', keys: [{ key: 'cost:{id}', fields: { planned: amount, title: { type: 'string', required: true, maxLength: 5 } } }] });
  const who = { key: 'sam', name: 'Sam', owner: false, can: () => true };
  const put = (value) => guards.checkPut(g, { key: 'cost:c1', before: null, value, who, read: () => null });
  const rows = [
    [{ title: 'a', planned: 40 }, 200],
    [{ title: 'a', planned: 12.345 }, 200],
    [{ title: 'a', planned: null }, 200],
    [{ title: 'a' }, 200],
    [{ title: 'a', planned: -500 }, 400],
    [{ title: 'a', planned: 0 }, 400],
    [{ title: 'a', planned: 1e12 }, 400],
    [{ title: 'a', planned: '40' }, 400],
    [{ title: 'a', planned: true }, 400],
    [{ title: 'a', planned: [40] }, 400],
    [{ planned: 40 }, 400],
    [{ title: 'abcdef' }, 400],
    [{ title: 5 }, 400],
  ];
  for (const [value, want] of rows) assert.equal(put(value).error ? put(value).status : 200, want, JSON.stringify(value));
  assert.equal(put({ title: 'a', planned: -5 }).error, 'planned must be a number above 0 and below 1000000000000, or empty.');
  assert.equal(put({}).error, 'title is needed.');
});

await test('hidden fields: hide and keepHidden', () => {
  const v = { title: 'Flight', cost: 612, confirm: 'QX81ZP' };
  assert.deepEqual(guards.hide(v, ['cost', 'confirm']), { title: 'Flight' });
  assert.deepEqual(v, { title: 'Flight', cost: 612, confirm: 'QX81ZP' }, 'the stored value is not changed');
  assert.equal(guards.hide('text', ['cost']), 'text');
  assert.equal(guards.hide(v, []), v);
  assert.deepEqual(guards.keepHidden({ title: 'New', cost: 1 }, v, ['cost', 'confirm']), { title: 'New', cost: 612, confirm: 'QX81ZP' });
  assert.deepEqual(guards.keepHidden({ title: 'New', cost: 1 }, null, ['cost']), { title: 'New' }, 'a guest sets no hidden field');
  // What a writer who can't see them may not do: remove, replace with a non-object, clear (QA 2).
  const H = ['cost', 'confirm'];
  assert.equal(guards.holdsHidden(v, H), true);
  assert.equal(guards.holdsHidden({ title: 'x', cost: null, confirm: '' }, H), false, 'empty is nothing to lose');
  assert.equal(guards.hiddenDeleteRefusal(v, H).status, 403);
  assert.equal(guards.hiddenDeleteRefusal(v, []), null, 'someone who sees them');
  assert.equal(guards.hiddenDeleteRefusal({ title: 'x' }, H), null);
  assert.equal(guards.hiddenPutRefusal('text', v, H).status, 403);
  assert.equal(guards.hiddenPutRefusal(null, v, H).status, 403);
  assert.equal(guards.hiddenPutRefusal({ title: 'x' }, v, H), null, 'an object keeps them (keepHidden)');
  assert.equal(guards.hiddenClearRefusal([{ title: 'x' }, v], H).status, 403);
  assert.equal(guards.hiddenClearRefusal([{ title: 'x' }], H), null);
  // Guards that don't read: hidden fields kept as far as they read; when they don't read in full, shut to guests (QA 4).
  assert.deepEqual(guards.unreadableGuards({ hidden: ['cost', 'cost'], keys: 'bad' }), { invalid: true, clear: null, hidden: ['cost'], keys: [], exclusive: null });
  assert.equal(guards.unreadableGuards({ keys: 'bad' }).shut, undefined, 'no hidden fields declared: nothing to shut');
  assert.equal(guards.unreadableGuards({ hidden: 'cost' }).shut, true, 'hidden not a list');
  assert.equal(guards.unreadableGuards({ hidden: ['cost', 'not ok'] }).shut, true, 'a hidden entry that does not read');
  assert.deepEqual(guards.unreadableGuards({ hidden: ['cost', 'not ok'] }).hidden, ['cost']);
});

await test('fields: lists (of, unique, pick), votes and options (QA 1, 6, 8)', () => {
  const g = clean(POLLS_GUARDS);
  const voter = { key: 'sam', name: 'Sam', owner: false, can: (p) => ['view', 'vote'].includes(p) };
  const poll = (extra = {}) => ({ id: 'q1', question: 'Where?', options: [{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B' }], multi: false, addable: true, closed: false, closesAt: null, by: 'Mia', byKey: 'mia', ...extra });
  const store = { 'poll:q1': poll(), 'poll:q2': poll({ id: 'q2', multi: true }) };
  const read = (k) => store[k] || null;
  const put = (key, value, who = voter, before = store[key] || null) => guards.checkPut(g, { key, before, value, who, read, now: 0 });
  const rows = [
    ['one choice', put('vote:q1:sam', { options: ['o1'] }), 200],
    ['no choice', put('vote:q1:sam', { options: [] }), 200],
    ['two on a poll of one', put('vote:q1:sam', { options: ['o1', 'o2'] }), 400],
    ['two on a poll of several', put('vote:q2:sam', { options: ['o1', 'o2'] }), 200],
    ['the same twice', put('vote:q2:sam', { options: ['o1', 'o1'] }), 400],
    ['a choice the poll has not', put('vote:q1:sam', { options: ['o9'] }), 400],
    ['not text', put('vote:q1:sam', { options: [1] }), 400],
    ['not a list', put('vote:q1:sam', { options: 'o1' }), 400],
    ['left out', put('vote:q1:sam', {}), 400],
    ['too many', put('vote:q2:sam', { options: Array.from({ length: 21 }, (_, i) => `o${i}`) }), 400],
    ['closed as text', put('poll:q1', poll({ closed: 'yes' }), { ...voter, key: 'mia', can: () => true }), 400],
    ['closesAt as text', put('poll:q1', poll({ closesAt: '2026-11-01' }), { ...voter, key: 'mia', can: () => true }), 400],
    ['an option id twice', put('poll:q1', poll({ options: [{ id: 'o1', text: 'A' }, { id: 'o1', text: 'B' }] }), { ...voter, key: 'mia', can: () => true }), 400],
    ['an option with no id', put('poll:q1', poll({ options: [{ text: 'A' }, { id: 'o2', text: 'B' }] }), { ...voter, key: 'mia', can: () => true }), 400],
    ['an added option with a new id', put('poll:q1', poll({ options: [...poll().options, { id: 'o3', text: 'C' }] })), 200],
    ['an added option reusing an id', put('poll:q1', poll({ options: [...poll().options, { id: 'o2', text: 'C' }] })), 400],
    ['an added option that is not an object', put('poll:q1', poll({ options: [...poll().options, 'C'] })), 400],
  ];
  const status = (r) => (r.error ? r.status : 200);
  for (const [what, answer, want] of rows) assert.equal(status(answer), want, `${what}: ${JSON.stringify(answer)}`);
  assert.equal(put('poll:q1', poll({ options: [...poll().options, { id: 'o3', text: 'C', by: 'Mallory' }] })).value.options[2].by, 'Sam', 'the server names who added an option');
  assert.equal(put('poll:q1', poll({ options: [...poll().options, { id: 'o3', text: 'C', by: 'Mallory' }] }), { ...voter, key: 'mia', can: () => true }).value.options[2].by, 'Mallory', 'the poll\'s starter edits options as written');
  for (const [, answer] of rows) if (answer.error && !/^[a-z]/.test(answer.error)) assert.match(answer.error, /^[A-Z].*[.]$/, answer.error);
  // The manifest's refusals for the new specs.
  const bad = [
    [{ clear: 'owner', keys: [{ key: 'a:{x}', fields: { t: { type: 'string', of: 'string' } } }] }, /of is for a list field/],
    [{ clear: 'owner', keys: [{ key: 'a:{x}', fields: { t: { type: 'array', of: 'array' } } }] }, /of must be number, string, boolean or object/],
    [{ clear: 'owner', keys: [{ key: 'a:{x}', fields: { t: { type: 'array', pick: { from: 'options' } } } }] }, /pick needs a "parent"/],
    [{ clear: 'owner', keys: [{ key: 'a:{x}', fields: { t: { type: 'array', unique: 'not ok' } } }] }, /unique must name a stored field/],
    [{ clear: 'owner', keys: [{ key: 'a:{x}', owner: 'by', others: { change: 'create', may: [{ field: 'o', by: 'by' }] } }] }, /by needs append: true/],
    [{ exclusive: ['note:{id}'] }, /guards.exclusive must be a list of 2/],
    [{ exclusive: ['note:{id}', 'note:{other}'] }, /lists a key twice/],
    [{ exclusive: ['note:{id}', 'link:{x}'] }, /the same \{name\} parts/],
    [{ exclusive: ['note', 'link:{x}'] }, /each guards.exclusive entry must be a stored key with \{name\} parts/],
  ];
  for (const [raw, message] of bad) assert.throws(() => clean(raw), message, JSON.stringify(raw));
});

await test('exclusive ids and a rule\'s file (Research)', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'research', 'module.json'), 'utf8'));
  const g = guards.cleanGuards(raw.guards, raw.permissions.map((p) => p.key), ModuleError);
  assert.deepEqual(g.exclusive, ['note:{id}', 'link:{id}', 'photo:{id}', 'answer:{id}']);
  const files = { f1: { by: 'sam' }, f2: { by: 'mia' } };
  const person = (key, perms, owner = false) => ({ key, name: key, owner, can: (p) => perms.includes(p), file: (id) => files[id] || null });
  const sam = person('sam', ['view', 'edit']);
  const store = { 'photo:p1': { kind: 'photo', title: 'P', by: 'sam', file: { id: 'f1' } } };
  const read = (k) => store[k] || null;
  const put = (key, value, who, before = store[key] || null) => guards.checkPut(g, { key, before, value, who, read });
  const status = (r) => (r.error ? r.status : 200);
  assert.equal(status(put('note:p1', { kind: 'note', title: 'N' }, sam)), 409, 'a note under a photo\'s id');
  assert.equal(put('note:p1', { kind: 'note', title: 'N' }, sam).error, 'Something else here already has that id, so this can\'t be saved under it.');
  assert.equal(status(put('note:n1', { kind: 'note', title: 'N' }, sam)), 200, 'a note with its own id');
  assert.equal(status(put('photo:p1', { ...store['photo:p1'], title: 'Q' }, sam)), 200, 'the photo itself changed');
  assert.equal(status(put('photo:p2', { kind: 'photo', title: 'P', file: { id: 'f9' } }, sam, null)), 400, 'a file that is not here');
  assert.equal(status(put('photo:p2', { kind: 'photo', title: 'P', file: { id: 'f2' } }, sam, null)), 403, 'someone else\'s file');
  assert.equal(status(put('photo:p2', { kind: 'photo', title: 'P', file: { id: 'f2' } }, person('boss', ['view', 'edit'], true), null)), 200, 'an owner may use any file');
  assert.equal(status(put('photo:p2', { kind: 'photo', title: 'P', file: 'f1' }, sam, null)), 400, 'a file named by text, not { id }');
  assert.equal(status(put('photo:p2', { kind: 'photo', title: 'P', file: { id: 'f1' } }, sam, null)), 200, 'one\'s own file');
  assert.equal(guards.fileOf(g, 'photo:p1', store['photo:p1']), 'f1');
  assert.equal(guards.fileOf(g, 'note:p1', { file: { id: 'f1' } }), null, 'only a rule with `file` names one');
});

// --- live, against the seed ----------------------------------------------------------------------------------------------
const { bootSeeded, startServer, stopServer, freePort } = await import('./shots.mjs');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-module-guards-'));
let server;
try {
  const port = await freePort();
  const boot = await bootSeeded('travel', dataDir, port);
  server = boot.server;
  const { ctx, cookies } = boot;
  const call = async (method, url, body, as = 'admin') => {
    const headers = { 'content-type': 'application/json', accept: 'application/json' };
    if (cookies[as]) headers.cookie = cookies[as].map((c) => `${c.name}=${c.value}`).join('; ');
    const r = await fetch(server.base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json };
  };
  const T = ctx.trip;
  const K = ctx.second;
  const sp = (s = T) => `scope=space&space=${s}`;
  const data = (m, key, s = T) => `/api/modules/${m}/data${key ? `/${encodeURIComponent(key)}` : ''}?${sp(s)}`;
  const guestToken = (await call('POST', `/api/spaces/${T}/guest-link`)).json?.space?.guestToken || (await call('GET', `/api/spaces/${T}`)).json?.space?.guestToken;
  assert.ok(guestToken, 'the trip has a guest link');
  const asGuest = async (method, url, body) => {
    const r = await fetch(`${server.base}${url}&guest=${encodeURIComponent(guestToken)}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json };
  };
  const q1 = (await call('GET', data('polls', 'poll:q1'))).json.item.value;

  await test('live: votes belong to their voter (PB-01)', async () => {
    const r1 = await call('PUT', data('polls', `vote:q1:${ctx.mia}`), { value: { options: ['o3'], name: 'Mia Alvarez', at: 1 } }, 'sam');
    assert.equal(r1.status, 403, 'sam rewriting Mia\'s vote');
    assert.equal(r1.json.error, 'That belongs to someone else, so you can\'t change it.');
    assert.deepEqual((await call('GET', data('polls', `vote:q1:${ctx.mia}`))).json.item.value.options, ['o1'], 'Mia\'s vote is as she cast it');
    assert.equal((await call('PUT', data('polls', 'vote:q1:zzfake'), { value: { options: ['o2'], name: 'Thomas', at: 1 } }, 'sam')).status, 403, 'a made-up voter');
    assert.equal((await call('PUT', data('polls', `vote:q1:${ctx.sam}:x`), { value: { options: ['o2'] } }, 'sam')).status, 400, 'a key that slips the pattern');
    const closed = await call('PUT', data('polls', `vote:q2:${ctx.sam}`), { value: { options: ['o1'], name: 'Sam', at: 1 } }, 'sam');
    assert.deepEqual([closed.status, closed.json.error], [403, 'That is closed, so it can\'t be changed.'], 'a vote on the closed poll');
    const own = await call('PUT', data('polls', `vote:q1:${ctx.sam}`), { value: { options: ['o1'], name: 'Thomas', at: 1 } }, 'sam');
    assert.equal(own.status, 200, 'sam\'s own vote');
    assert.equal(own.json.item.value.name, 'Sam Okafor', 'the server names the voter');
    assert.equal((await call('DELETE', data('polls', `vote:q1:${ctx.mia}`), undefined, 'sam')).status, 403, 'sam deleting Mia\'s vote');
    assert.equal((await call('PUT', data('polls', `vote:nopoll:${ctx.sam}`), { value: { options: ['o1'] } }, 'sam')).status, 404, 'a vote on a poll that is not there');
  });

  await test('live: polls need create, and someone else\'s need manage_any (PB-01)', async () => {
    const edited = await call('PUT', data('polls', 'poll:q1'), { value: { ...q1, question: 'EDITED BY SAM' } }, 'sam');
    assert.equal(edited.status, 403, 'sam changing Mia\'s question');
    assert.equal(edited.json.error, 'Your role can\'t change what someone else added in this module.');
    assert.equal((await call('GET', data('polls', 'poll:q1'))).json.item.value.question, q1.question);
    assert.equal((await call('PUT', data('polls', 'poll:q1'), { value: { ...q1, closed: true } }, 'sam')).status, 403, 'sam closing Mia\'s poll');
    assert.equal((await call('DELETE', data('polls', 'poll:q1'), undefined, 'sam')).status, 403, 'sam deleting Mia\'s poll');
    const suggested = await call('PUT', data('polls', 'poll:q1'), { value: { ...q1, options: [...q1.options, { id: 'o9', text: 'A fourth place', by: 'Sam Okafor' }] } }, 'sam');
    assert.equal(suggested.status, 200, 'sam suggesting an option on an open poll that allows it');
    assert.equal(suggested.json.item.value.byKey, ctx.mia, 'still Mia\'s');
    const forged = await call('PUT', data('polls', 'poll:sam1'), { value: { id: 'sam1', question: 'Sam asks', options: [{ id: 'o1', text: 'a' }, { id: 'o2', text: 'b' }], closed: false, closesAt: null, byKey: ctx.mia, by: 'Mia Alvarez' } }, 'sam');
    assert.equal(forged.status, 403, 'a poll started in Mia\'s name');
    const started = await call('PUT', data('polls', 'poll:sam1'), { value: { id: 'sam1', question: 'Sam asks', options: [{ id: 'o1', text: 'a' }, { id: 'o2', text: 'b' }], closed: false, closesAt: null, by: 'Thomas' } }, 'sam');
    assert.equal(started.status, 200, 'sam starting a poll');
    assert.deepEqual([started.json.item.value.byKey, started.json.item.value.by], [ctx.sam, 'Sam Okafor'], 'in his own name');
    // Without create, a member can vote but not start or change a poll.
    assert.equal((await call('PATCH', '/api/roles/member', { 'module.polls.create': false })).status, 200);
    try {
      assert.equal((await call('PUT', data('polls', 'poll:sam2'), { value: { id: 'sam2', question: 'Again', options: [], closed: false } }, 'sam')).status, 403, 'a poll started without create');
      assert.equal((await call('PUT', data('polls', 'poll:sam1'), { value: { ...started.json.item.value, question: 'Changed' } }, 'sam')).status, 403, 'his own poll changed without create');
      assert.equal((await call('PUT', data('polls', `vote:sam1:${ctx.sam}`), { value: { options: ['o1'] } }, 'sam')).status, 200, 'a vote still goes in');
    } finally {
      await call('PATCH', '/api/roles/member', { 'module.polls.create': true });
    }
    assert.equal((await call('DELETE', data('polls', `vote:sam1:${ctx.sam}`), undefined, 'sam')).status, 200);
    assert.equal((await call('DELETE', data('polls', 'poll:sam1'), undefined, 'sam')).status, 200, 'his own poll deleted');
    // Mia, who started q1, removes Sam's vote with it (the page deletes the votes first).
    assert.equal((await call('DELETE', data('polls', `vote:q1:${ctx.sam}`), undefined, 'mia')).status, 200, 'the starter removes a vote on her poll');
  });

  await test('live: clearing a module is for whoever its guards say (PB-01, PB-02)', async () => {
    await call('PUT', data('polls', 'poll:k1', K), { value: { id: 'k1', question: 'Admin poll in Kyoto', options: [{ id: 'o1', text: 'a' }, { id: 'o2', text: 'b' }], closed: false, closesAt: null } });
    await call('PUT', data('budget', 'cost:k1', K), { value: { title: 'Admin cost', planned: 100, amount: 100 } });
    const polls = await call('DELETE', data('polls', '', K), undefined, 'mia');
    assert.deepEqual([polls.status, polls.json.error], [403, 'Your role can\'t clear everything in this module.'], 'mia, a member in Kyoto, clearing every poll');
    const budget = await call('DELETE', data('budget', '', K), undefined, 'mia');
    assert.deepEqual([budget.status, budget.json.error], [403, 'Only owners can clear everything in this module.'], 'mia clearing every cost');
    assert.equal((await call('GET', data('polls', '', K))).json.items.length, 1);
    assert.equal((await call('GET', data('budget', '', K))).json.items.length, 1);
    assert.equal((await call('DELETE', data('polls', 'poll:k1', K), undefined, 'mia')).status, 403, 'nor one by one');
    assert.deepEqual((await call('DELETE', data('budget', '', K))).json, { cleared: 1 }, 'the admin clears');
    // The canvas's Clear: who may.
    const forSpace = async (as) => Object.fromEntries((await call('GET', `/api/modules/for-space?space=${T}`, undefined, as)).json.modules.map((m) => [m.id, m.clear]));
    const sam = await forSpace('sam');
    assert.deepEqual([sam.budget, sam.polls, sam.todo], [false, false, true], 'sam may clear To-do, not Budget or Polls');
    const admin = await forSpace('admin');
    assert.deepEqual([admin.budget, admin.polls], [true, true]);
  });

  await test('live: a cost\'s amounts are checked (PB-02)', async () => {
    // At least a cent (0.01), as the page rounds an amount to cents and drops one that rounds to nothing.
    const rows = [[-500, 400], [0, 400], [0.004, 400], [0.009, 400], [1e12, 400], [1e13, 400], ['40', 400], [true, 400], [0.01, 200], [12.345, 200], [40, 200]];
    for (const [planned, want] of rows) {
      const r = await call('PUT', data('budget', 'cost:shape'), { value: { title: 'Shape', planned, amount: planned } }, 'sam');
      assert.equal(r.status, want, `planned ${JSON.stringify(planned)}: ${JSON.stringify(r.json)}`);
    }
    const r = await call('PUT', data('budget', 'cost:neg'), { value: { title: 'Neg', planned: -500, actual: -500, amount: -500 } }, 'sam');
    assert.equal(r.json.error, 'planned must be a number at least 0.01 and below 1000000000000, or empty.');
    assert.equal((await call('GET', data('budget', 'cost:neg'))).status, 404, 'nothing was stored');
    assert.equal((await call('DELETE', data('budget', 'cost:shape'), undefined, 'sam')).status, 200);
  });

  await test('live: a guest gets no costs or booking codes, until an owner opens them (PB-03)', async () => {
    const MONEY = ['cost', 'estimate', 'confirm', 'paidBy'];
    const leaks = (v) => MONEY.filter((f) => v && v[f] !== undefined && v[f] !== null && v[f] !== '');
    const list = await asGuest('GET', data('travel', ''));
    assert.equal(list.status, 200);
    assert.ok(list.json.items.length > 5);
    for (const it of list.json.items) assert.deepEqual(leaks(it.value), [], `${it.key} as a guest`);
    assert.doesNotMatch(JSON.stringify(list.json), /QX81ZP|HAP-4471|FD-22/);
    const one = await asGuest('GET', data('travel', 'plan:a1'));
    assert.deepEqual([one.json.item.value.title, leaks(one.json.item.value)], ['Flight to Lisbon', []]);
    // A member still sees them.
    const mine = (await call('GET', data('travel', 'plan:a1'), undefined, 'sam')).json.item.value;
    assert.deepEqual([mine.cost, mine.confirm], [612, 'QX81ZP']);
    // has=amount is refused for a guest; the summaries a guest may read carry no money.
    const priced = await asGuest('GET', `/api/objects/search?from=polls&has=amount&${sp()}`);
    assert.equal(priced.status, 403);
    assert.equal(priced.json.error, 'Guests can\'t see costs in this trip.', 'in the travel template\'s words');
    const found = await asGuest('GET', `/api/objects/search?from=polls&${sp()}`);
    assert.equal(found.status, 200);
    const plans = found.json.summaries.filter((s) => s.module.id === 'travel' && s.kind === 'plan');
    assert.ok(plans.length > 3, 'the guest finds the bookings');
    for (const s of plans) assert.deepEqual(['amount', 'planned', 'paidBy'].filter((f) => s[f] !== undefined), [], s.title);
    const resolved = await asGuest('POST', `/api/objects/resolve?${sp()}`, { from: 'polls', refs: [{ module: 'travel', kind: 'plan', id: 'a3', scope: 'space', space: T }] });
    assert.equal(resolved.json.summaries[0].title, 'Hotel Avenida Palace');
    assert.equal(resolved.json.summaries[0].amount, undefined);
    // Budget stays refused to a guest.
    assert.equal((await asGuest('GET', data('budget', ''))).status, 403);
    // Live changes: a guest's streams of the Planner (the module's own, and the one a space's page holds) carry no cost.
    const heard = async (url, note) => {
      const ctl = new AbortController();
      const events = await fetch(`${server.base}${url}&guest=${encodeURIComponent(guestToken)}`, { signal: ctl.signal });
      const reader = events.body.getReader();
      await new Promise((r) => setTimeout(r, 200));
      const plan = (await call('GET', data('travel', 'plan:a1'))).json.item.value;
      await call('PUT', data('travel', 'plan:a1'), { value: { ...plan, notes: note } });
      let text = '';
      let pending = reader.read();
      const until = Date.now() + 5000;
      while (!text.includes(note) && Date.now() < until) {
        const got = await Promise.race([pending, new Promise((r) => setTimeout(() => r(null), 250))]);
        if (!got) continue;
        if (got.done) break;
        text += Buffer.from(got.value).toString('utf8');
        pending = reader.read();
      }
      pending.catch(() => {}); // the read still waiting ends with the abort
      ctl.abort();
      return text;
    };
    for (const [url, note] of [[`/api/modules/travel/events?${sp()}`, 'Changed for the module stream'], [`/api/modules/stream?space=${T}`, 'Changed for the space stream']]) {
      const text = await heard(url, note);
      assert.ok(text.includes(note), `the change arrived on ${url}`);
      assert.doesNotMatch(text, /"cost"|QX81ZP/, `without its cost or code on ${url}`);
    }
    // A guest given edit keeps what they can't see as it was.
    assert.equal((await call('PATCH', '/api/roles/guest', { 'module.travel.edit': true })).status, 200);
    try {
      const g = await asGuest('PUT', data('travel', 'plan:a1'), { value: { ...one.json.item.value, notes: 'A guest wrote this', cost: 1 } });
      assert.equal(g.status, 200, JSON.stringify(g.json));
      assert.equal(g.json.item.value.cost, undefined, 'the answer has no cost either');
      const after = (await call('GET', data('travel', 'plan:a1'))).json.item.value;
      assert.deepEqual([after.notes, after.cost, after.confirm], ['A guest wrote this', 612, 'QX81ZP']);
    } finally {
      await call('PATCH', '/api/roles/guest', { 'module.travel.edit': false });
    }
    // Only an owner opens them in a space; then the guest sees them.
    assert.equal((await call('PATCH', `/api/spaces/${T}`, { guestsSeeHidden: true }, 'mia')).status, 403, 'a moderator can\'t');
    assert.equal((await call('PATCH', `/api/spaces/${T}`, { guestsSeeHidden: 'yes' })).status, 400);
    const opened = await call('PATCH', `/api/spaces/${T}`, { guestsSeeHidden: true });
    assert.equal(opened.json.space.guestsSeeHidden, true);
    assert.equal((await call('GET', `/api/modules/travel/context?${sp()}`, undefined, 'sam')).json.space.guestsSeeHidden, true, 'the module context says so: on');
    assert.equal((await asGuest('GET', `/api/modules/travel/context?${sp()}`)).json.space.guestsSeeHidden, true, 'to a guest too');
    try {
      const seen = (await asGuest('GET', data('travel', 'plan:a1'))).json.item.value;
      assert.deepEqual([seen.cost, seen.confirm], [612, 'QX81ZP']);
      assert.equal((await asGuest('GET', `/api/objects/search?from=polls&has=amount&${sp()}`)).status, 200);
    } finally {
      const shut = await call('PATCH', `/api/spaces/${T}`, { guestsSeeHidden: false });
      assert.equal(shut.json.space.guestsSeeHidden, undefined, 'off is stored as nothing');
      assert.equal((await call('GET', `/api/modules/travel/context?${sp()}`, undefined, 'sam')).json.space.guestsSeeHidden, false, 'the module context says so: off');
    }
    assert.equal((await asGuest('GET', data('travel', 'plan:a1'))).json.item.value.cost, undefined, 'and closed again');
  });

  await test('live: a poll past its closing time is done in its summary (PB-05)', async () => {
    // The server's clock starts on the seed's day, 2026-10-15 (tools/shots-clock.cjs).
    await call('PUT', data('polls', 'poll:late'), { value: { id: 'late', question: 'Timed out', options: [{ id: 'o1', text: 'a' }, { id: 'o2', text: 'b' }], closed: false, closesAt: Date.parse('2026-10-01T12:00:00Z') } });
    await call('PUT', data('polls', 'poll:soon'), { value: { id: 'soon', question: 'Still open', options: [{ id: 'o1', text: 'a' }, { id: 'o2', text: 'b' }], closed: false, closesAt: Date.parse('2027-10-01T12:00:00Z') } });
    const r = await call('POST', '/api/objects/resolve', { from: 'travel', refs: ['late', 'soon', 'q1', 'q2'].map((id) => ({ module: 'polls', kind: 'poll', id, scope: 'space', space: T })) }, 'sam');
    assert.deepEqual(r.json.summaries.map((s) => s.done), [true, false, false, true]);
    assert.equal((await call('PUT', data('polls', `vote:late:${ctx.sam}`), { value: { options: ['o1'] } }, 'sam')).status, 403, 'and takes no votes');
  });

  // A picture uploaded to Research in the trip by `as`: its file id.
  const { encodePng } = await import('./shots.mjs');
  const upload = async (as, place = sp()) => {
    const headers = { 'content-type': 'image/png' };
    if (cookies[as]) headers.cookie = cookies[as].map((c) => `${c.name}=${c.value}`).join('; ');
    const r = await fetch(`${server.base}/api/modules/research/uploads?${place}&name=p.png`, { method: 'POST', headers, body: encodePng({ w: 2, h: 2, data: Buffer.alloc(16, 200) }) });
    const json = await r.json();
    assert.equal(r.status, 201, JSON.stringify(json));
    return json.file.id;
  };
  const filesHere = async () => (await call('GET', `/api/modules/research/uploads?${sp()}`)).json.files.map((f) => f.id);

  await test('live: a research photo is removed or emptied only by whoever may, and its file goes with it (RS-01)', async () => {
    const samFile = await upload('sam');
    const photo = { kind: 'photo', title: 'Sam\'s photo', tags: [], date: '', at: '2026-10-15T10:00:00.000Z', text: 'Sam\'s photo', sub: '', file: { id: samFile, hasThumb: false } };
    const nowhere = await call('PUT', data('research', 'photo:p0'), { value: { ...photo, file: { id: 'a'.repeat(24), hasThumb: false } } }, 'sam');
    assert.deepEqual([nowhere.status, nowhere.json.error], [400, 'That file isn\'t here.'], 'a photo of a file that is not there');
    const theirs = await call('PUT', data('research', 'photo:p0'), { value: { ...photo, by: undefined } }, 'mia');
    assert.deepEqual([theirs.status, theirs.json.error], [403, 'You can only use a file you added.'], 'Mia making a photo of Sam\'s file');
    const made = await call('PUT', data('research', 'photo:p1'), { value: photo }, 'sam');
    assert.equal(made.status, 200);
    assert.equal(made.json.item.value.by, ctx.sam, 'the server names who added it');
    assert.equal((await call('PUT', data('research', 'photo:p1'), { value: { ...made.json.item.value, title: 'Renamed by Mia', text: 'Renamed by Mia' } }, 'mia')).status, 200, 'anyone with edit renames it');
    assert.equal((await call('PUT', data('research', 'photo:p1'), { value: { ...made.json.item.value, file: { id: 'b'.repeat(24), hasThumb: true } } }, 'mia')).status, 403, 'nor swaps its picture');
    assert.equal((await call('DELETE', data('research', 'photo:p1'), undefined, 'mia')).status, 403, 'mia (no remove_photos) can\'t remove Sam\'s photo');
    assert.equal((await call('DELETE', data('research', ''), undefined, 'mia')).status, 403, 'nor clear Research');
    // Another kind of object can't take a photo's id (it would hide the photo on the page).
    const shadow = await call('PUT', data('research', 'note:p1'), { value: { kind: 'note', title: 'Shadow', body: '', tags: [], date: '', at: '', text: '', sub: '' } }, 'mia');
    assert.deepEqual([shadow.status, shadow.json.error], [409, 'Something else here already has that id, so this can\'t be saved under it.'], 'a note under the photo\'s id');
    assert.equal((await call('PUT', data('research', 'answer:p1'), { value: { kind: 'answer', title: 'Shadow', content: 'x' } }, 'admin')).status, 409, 'nor an answer, by the admin');
    // A member given remove_photos removes Sam's photo, and its file goes with it.
    assert.equal((await call('PATCH', '/api/roles/member', { 'module.research.remove_photos': true })).status, 200);
    try {
      assert.ok((await filesHere()).includes(samFile));
      assert.equal((await call('DELETE', data('research', 'photo:p1'), undefined, 'mia')).status, 200, 'mia, holding remove_photos, removes it');
      assert.equal((await filesHere()).includes(samFile), false, 'the file went with the photo');
    } finally {
      await call('PATCH', '/api/roles/member', { 'module.research.remove_photos': false });
    }
    // Sam removes his own; a file another photo still names stays.
    const second = await upload('sam');
    for (const k of ['p2', 'p3']) assert.equal((await call('PUT', data('research', `photo:${k}`), { value: { ...photo, file: { id: second, hasThumb: false } } }, 'sam')).status, 200);
    assert.equal((await call('DELETE', data('research', 'photo:p2'), undefined, 'sam')).status, 200, 'Sam removes his own');
    assert.ok((await filesHere()).includes(second), 'still named by photo:p3, so kept');
    assert.equal((await call('DELETE', data('research', 'photo:p3'), undefined, 'sam')).status, 200);
    assert.equal((await filesHere()).includes(second), false, 'then removed with the last');
  });

  await test('live: a member without Research edit keeps private notes in Mine (RS-24)', async () => {
    const note = { kind: 'note', title: 'Only mine', body: 'x', tags: [], date: '', at: '', text: 'x', sub: '' };
    assert.equal((await call('PATCH', '/api/roles/member', { 'module.research.edit': false })).status, 200);
    try {
      const space = await call('PUT', data('research', 'note:mine1'), { value: note }, 'sam');
      assert.equal(space.status, 403, 'not in the trip');
      const mine = await call('PUT', '/api/modules/research/data/note:mine1?scope=person', { value: note }, 'sam');
      assert.equal(mine.status, 200, `in Mine: ${JSON.stringify(mine.json)}`);
      assert.equal((await call('DELETE', '/api/modules/research/data/note:mine1?scope=person', undefined, 'sam')).status, 200, 'and removes it');
      // And a photo in Mine: the upload and the photo itself (not in the trip).
      const headers = { 'content-type': 'image/png', cookie: cookies.sam.map((c) => `${c.name}=${c.value}`).join('; ') };
      const inTrip = await fetch(`${server.base}/api/modules/research/uploads?${sp()}&name=p.png`, { method: 'POST', headers, body: encodePng({ w: 2, h: 2, data: Buffer.alloc(16, 9) }) });
      assert.equal(inTrip.status, 403, 'no upload to the trip without edit');
      const fileId = await upload('sam', 'scope=person');
      const photo = await call('PUT', '/api/modules/research/data/photo:mine2?scope=person', { value: { kind: 'photo', title: 'Mine', tags: [], date: '', at: '', text: 'Mine', sub: '', file: { id: fileId, hasThumb: false } } }, 'sam');
      assert.equal(photo.status, 200, `a photo in Mine: ${JSON.stringify(photo.json)}`);
      assert.equal((await call('DELETE', '/api/modules/research/data/photo:mine2?scope=person', undefined, 'sam')).status, 200);
      const left = (await call('GET', '/api/modules/research/uploads?scope=person', undefined, 'sam')).json.files.map((f) => f.id);
      assert.equal(left.includes(fileId), false, 'its file went with it');
      // Another module's own data still takes its write permission (Polls has no person scope; the Planner's is
      // guarded by edit as before).
      assert.equal((await call('PATCH', '/api/roles/member', { 'module.travel.edit': false })).status, 200);
      try {
        const travel = await call('PUT', '/api/modules/travel/data/plan:mine1?scope=person', { value: { title: 'x' } }, 'sam');
        assert.ok([400, 403].includes(travel.status), `the Planner's own data without edit: ${travel.status}`);
      } finally {
        await call('PATCH', '/api/roles/member', { 'module.travel.edit': true });
      }
    } finally {
      await call('PATCH', '/api/roles/member', { 'module.research.edit': true });
    }
  });

  await test('live: votes are a list of the poll\'s own options, one unless it takes several (QA 1, 6, 8)', async () => {
    const single = (await call('GET', data('polls', 'poll:q1'))).json.item.value;
    assert.notEqual(single.multi, true, 'q1 takes one answer');
    const rows = [
      [{ options: ['o1', 'o2'] }, 400, 'options can hold only one choice here.'],
      [{ options: ['nope'] }, 400, 'Each entry of options must be one of the choices.'],
      [{ options: ['o1', 'o1'] }, 400, 'options has the same entry twice.'],
      [{ options: 'o1' }, 400, 'options must be a list with at most 20 entries.'],
      [{ options: [1] }, 400, 'Each entry of options must be text.'],
      [{}, 400, 'options is needed.'],
      [{ options: ['o2'] }, 200, null],
    ];
    for (const [value, want, error] of rows) {
      const r = await call('PUT', data('polls', `vote:q1:${ctx.sam}`), { value: { ...value, name: 'x', at: 1 } }, 'sam');
      assert.equal(r.status, want, `${JSON.stringify(value)}: ${JSON.stringify(r.json)}`);
      if (error) assert.equal(r.json.error, error);
    }
    // A poll that takes several.
    const several = { id: 'm1', question: 'Several', options: [{ id: 'o1', text: 'a' }, { id: 'o2', text: 'b' }], multi: true, addable: true, closed: false, closesAt: null };
    assert.equal((await call('PUT', data('polls', 'poll:m1'), { value: several }, 'mia')).status, 200);
    assert.equal((await call('PUT', data('polls', `vote:m1:${ctx.sam}`), { value: { options: ['o1', 'o2'] } }, 'sam')).status, 200, 'two on a poll that takes several');
    // The poll's own fields have their types.
    for (const [patch, error] of [[{ closed: 'yes' }, 'closed must be true or false.'], [{ closesAt: '2026-11-01' }, 'closesAt must be a number, or empty.'], [{ multi: 1 }, 'multi must be true or false.'], [{ options: [{ id: 'o1', text: 'a' }, { id: 'o1', text: 'b' }] }, 'Two entries of options have the same id.']]) {
      const r = await call('PUT', data('polls', 'poll:m1'), { value: { ...several, ...patch } }, 'mia');
      assert.deepEqual([r.status, r.json.error], [400, error], JSON.stringify(patch));
    }
    // An option someone else adds: a new id, named by the server.
    const now = (await call('GET', data('polls', 'poll:m1'))).json.item.value;
    const dup = await call('PUT', data('polls', 'poll:m1'), { value: { ...now, options: [...now.options, { id: 'o1', text: 'again' }] } }, 'sam');
    assert.deepEqual([dup.status, dup.json.error], [400, 'Two entries of options have the same id.'], 'an added option reusing an id');
    const added = await call('PUT', data('polls', 'poll:m1'), { value: { ...now, options: [...now.options, { id: 'o3', text: 'c', by: 'Someone else' }] } }, 'sam');
    assert.equal(added.status, 200, JSON.stringify(added.json));
    assert.equal(added.json.item.value.options[2].by, 'Sam Okafor', 'the server names who added it');
    assert.equal((await call('PUT', data('polls', 'poll:m1'), { value: { ...added.json.item.value, options: [...added.json.item.value.options, 'd'] } }, 'sam')).status, 400, 'an added option that is not an object');
    // Closed, it is final (QA 7, Thomas): no vote removed on its own, not by its voter or the poll's starter; the poll
    // removed by its starter takes its votes with it.
    assert.equal((await call('PUT', data('polls', 'poll:m1'), { value: { ...added.json.item.value, closed: true } }, 'mia')).status, 200);
    assert.equal((await call('DELETE', data('polls', `vote:m1:${ctx.sam}`), undefined, 'sam')).status, 403, 'the voter, after the close');
    assert.equal((await call('DELETE', data('polls', `vote:m1:${ctx.sam}`), undefined, 'mia')).status, 403, 'the starter, after the close');
    assert.equal((await call('DELETE', data('polls', `vote:m1:${ctx.sam}`))).status, 403, 'the admin, after the close');
    assert.equal((await call('DELETE', data('polls', 'poll:m1'), undefined, 'mia')).status, 200, 'the starter removes the poll');
    assert.equal((await call('GET', data('polls', `vote:m1:${ctx.sam}`))).status, 404, 'and its votes went with it');
  });

  await test('live: a guest can\'t remove or replace what holds hidden fields (QA 2)', async () => {
    assert.equal((await call('PATCH', '/api/roles/guest', { 'module.travel.edit': true })).status, 200);
    try {
      const del = await asGuest('DELETE', data('travel', 'plan:a1'));
      assert.deepEqual([del.status, del.json.error], [403, 'That holds details guests can\'t see, so a guest can\'t remove it.'], 'the booking with a cost');
      const over = await asGuest('PUT', data('travel', 'plan:a1'), { value: 'gone' });
      assert.deepEqual([over.status, over.json.error], [403, 'That holds details guests can\'t see, so it can only be changed, not replaced.']);
      const clear = await asGuest('DELETE', data('travel', ''));
      assert.deepEqual([clear.status, clear.json.error], [403, 'Some of it holds details guests can\'t see, so a guest can\'t clear everything.']);
      const after = (await call('GET', data('travel', 'plan:a1'))).json.item.value;
      assert.deepEqual([after.cost, after.confirm], [612, 'QX81ZP'], 'nothing was lost');
      // What holds nothing hidden is the guest's to remove, as before.
      assert.equal((await call('PUT', data('travel', 'plan:plain1'), { value: { title: 'No cost', kind: 'note' } })).status, 200);
      assert.equal((await asGuest('DELETE', data('travel', 'plan:plain1'))).status, 200);
    } finally {
      await call('PATCH', '/api/roles/guest', { 'module.travel.edit': false });
    }
  });

  await test('live: link pictures only for a signed-in person, only ones a link here has (RS-02); icons for guests (RS-08)', async () => {
    const stored = 'https://pictures.example.org/tram.jpg';
    assert.equal((await call('PUT', data('research', 'link:img1'), { value: { kind: 'link', title: 'Tram', url: 'https://example.org/tram', excerpt: '', image: stored, tags: [], date: '', at: '', text: '', sub: 'example.org' } }, 'sam')).status, 200);
    const img = (url) => `/api/modules/research/link-image?${sp()}&url=${encodeURIComponent(url)}`;
    const guest = await fetch(`${server.base}${img(stored)}&guest=${encodeURIComponent(guestToken)}`);
    assert.equal(guest.status, 403, 'a guest');
    const other = await call('GET', img('http://192.0.2.2:3390/img.png?probe=1'), undefined, 'sam');
    assert.deepEqual([other.status, other.json?.error], [404, 'That picture isn\'t on a link here.'], 'an address no link here has');
    const known = await call('GET', img(stored), undefined, 'sam');
    assert.equal(known.status, 404, 'a stored picture is looked for (no network here, so not found)');
    assert.equal(known.json, null, 'past the check: the fetch itself failed');
    assert.equal((await call('DELETE', data('research', 'link:img1'), undefined, 'sam')).status, 200);
    // A preview refuses a port that isn't the web's own.
    const port = await call('POST', `/api/modules/research/link-preview?${sp()}`, { url: 'http://example.org:22/' }, 'sam');
    assert.deepEqual([port.status, port.json.error], [400, 'that address is not allowed']);
    // Icons need no session, so a guest's page shows them.
    const icon = await fetch(`${server.base}/api/icons/solid/pen`);
    assert.equal(icon.status, 200);
    assert.match(await icon.text(), /^<svg/);
  });

  await test('live: guards whose hidden fields can\'t be read keep the module\'s data from guests (QA 4)', async () => {
    assert.equal((await asGuest('GET', data('travel', 'plan:a1'))).status, 200, 'before');
    await stopServer(server);
    const versions = path.join(dataDir, 'modules', 'travel', 'versions');
    for (const v of fs.readdirSync(versions)) {
      const file = path.join(versions, v, 'module.json');
      const m = JSON.parse(fs.readFileSync(file, 'utf8'));
      m.guards = { ...m.guards, hidden: 'cost' };
      fs.writeFileSync(file, JSON.stringify(m));
    }
    server = await startServer(dataDir, port, 'second');
    const r = await asGuest('GET', data('travel', ''));
    assert.equal(r.status, 403, 'a guest reads nothing');
    assert.match(r.json.error, /rules can't be read, so guests can't see what it holds\./);
    assert.equal((await call('GET', data('travel', 'plan:a1'), undefined, 'sam')).json.item.value.cost, 612, 'a member still reads it');
    assert.equal((await call('PUT', data('travel', 'plan:a1'), { value: { title: 'x' } }, 'sam')).status, 403, 'and nobody writes');
  });
} catch (err) {
  failed += 1;
  console.error(`FAIL live: the seeded server\n${err.stack || err}`);
} finally {
  if (server) await stopServer(server);
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failed) {
  console.error(`check-module-guards: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-module-guards: OK (${n} checks)`);
