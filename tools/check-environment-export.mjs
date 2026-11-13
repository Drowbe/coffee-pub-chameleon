#!/usr/bin/env node
/*
 * check-environment-export.mjs -- what an owner's copy of their environment (GET /api/environment/export) may carry,
 * run on server/environment-export.js and server/store.js directly (no server; the live run is in
 * check-host-registry.mjs):
 *   - default-deny: every field of a fully seeded app.json (top level, settings, each person, each person's own record
 *     per space, each space, each aside) is either on the copy's allow-list or on its documented left-out list, so a
 *     field added later fails here until someone classifies it; the copy carries only allowed fields, keeps every one
 *     of them as it is, and carries no left-out one; a field on neither list stays out of the copy;
 *   - every field a person, a space or an aside can be stored with, conditional ones included (read from the store's
 *     own sanitizeUser, sanitizeSpace and sanitizeAside), is set by the seed, so a new one has to be classified;
 *   - the same for files: every file the server keeps in an environment's folder is allowed or left out, and the
 *     copy carries exactly the allowed ones (a module's declared folder included, other people's private chat, each
 *     person's own module data, held clears and uploads, share links, half-written files and an unknown file not);
 *   - a host admin's stand-in never keeps a password, a personal link or a second factor of its own when loaded;
 *   - a session or stream key that is not as strong as the ones the server makes is replaced when loaded, a strong
 *     one is kept; a restore's files carry no session or stream key, and a record with role admin that is not the host
 *     admin's stand-in is restored as an owner.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Store } = require('../server/store.js');
const ex = require('../server/environment-export.js');
const { LEGACY_ENVIRONMENT_RECORD } = require('../server/migrate-names.js');

let n = 0;
let failed = 0;
const test = (name, fn) => {
  try { fn(); n += 1; } catch (err) { failed += 1; console.error(`check-environment-export: ${name}: ${err.stack || err}`); }
};
const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'environment-export-'));
const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');
const token = (bytes) => crypto.randomBytes(bytes).toString('base64url');

// A fully seeded app.json, as raw data: every optional field set, so each one is classified below.
const strong = { session: token(32), stream: token(18) };
function seededApp(secrets = strong) {
  const mfa = { secret: `aesgcm$${hex(16)}`, enrolledAt: '2026-01-01T00:00:00.000Z', recovery: [`scrypt$${hex(16)}`], version: 2, lastStep: 5, pending: { secret: `aesgcm$${hex(16)}`, startedAt: '2026-01-02T00:00:00.000Z' } };
  const feed = () => ({ hash: hex(32), made: '2026-01-03T00:00:00.000Z', readAt: null });
  return {
    version: 2,
    migrations: [{ id: 'names-roles', at: '2026-01-01T00:00:00.000Z', moved: [] }],
    template: { id: 'travel', appliedAt: '2026-01-01T00:00:00.000Z', appliedVersion: 1, switchedAt: '2026-01-01T00:00:00.000Z', applied: { words: 'abc' }, skipped: [] },
    templateHistory: [{ from: null, to: 'travel', at: '2026-01-01T00:00:00.000Z', by: 'ownerkey' }],
    templates: [{ id: 'mine', name: 'Mine' }],
    secrets,
    settings: {
      environmentName: 'Seeded', mfaRequired: true, words: { space: { one: 'trip' } }, verbs: { join: 'Board' },
      spaceDefaults: { profile: 'characters', opensWith: ['todo'] }, otherCalendars: true, publishedCalendar: true,
      publishedCalendarFeed: feed(),
    },
    users: [
      {
        key: 'ownerkey', login: 'owner', displayName: 'Owner', role: 'owner', passwordHash: `scrypt$${hex(16)}`, linkToken: token(24), mfa,
        images: { profile: 'profile.png' }, player: {}, callPrefs: { gain: 120 }, themeMode: 'light', createdAt: '2026-01-01T00:00:00.000Z',
        calendarFeed: feed(),
        externalCalendars: [{ id: 'cal1', name: 'Work', url: `aesgcm$${hex(24)}`, readAt: null, error: null }],
        // What they agreed to (server/agreements.js): left out of the copy, so everyone is asked again after a restore of it.
        agreed: [{ doc: 'terms', version: hex(8), at: '2026-01-04T00:00:00.000Z' }],
        spaces: { trip01: { images: { player: 'p.png' }, useDefaultImages: false, permissions: {}, joined: { by: 'self', at: '2026-01-02T00:00:00.000Z' }, calendarFeed: feed() } },
      },
      // A host admin's stand-in, as a zip a person wrote by hand might give it: a password, a link and a factor of its own.
      { key: 'bosskey1', login: 'boss', displayName: 'boss', role: 'admin', hostAdmin: true, passwordHash: `scrypt$${hex(16)}`, linkToken: token(24), mfa, firstPassword: { hash: hex(32), expiresAt: '2099-01-01T00:00:00.000Z' }, createdAt: '2026-01-01T00:00:00.000Z' },
      // A new owner who has not set a first password yet (plan-first-password.md): the hash of a one-time link.
      { key: 'newowner', login: 'newowner', displayName: 'New', role: 'owner', passwordHash: null, firstPassword: { hash: hex(32), expiresAt: '2099-01-01T00:00:00.000Z' }, createdAt: '2026-01-01T00:00:00.000Z' },
    ],
    spaces: [
      { id: 'lobby', name: 'Lobby', members: ['ownerkey'], createdAt: '2026-01-01T00:00:00.000Z' },
      {
        id: 'trip01', name: 'Trip', description: 'A trip', members: ['ownerkey'], createdAt: '2026-01-01T00:00:00.000Z', profile: 'characters',
        link: 'https://example.com/', linkIcon: 'link', guestToken: token(20), allowGuests: true, entry: 'accounts', requestAccess: true, closed: true, opensWith: ['todo'], defaultLayout: 'lay01', tabs: { order: ['conference', 'workspace', 'calendar', 'map', 'whiteboard', 'documents'], hide: ['map'] },
        aiOff: true, aiSees: { chat: true }, publishCalendar: false, guestsSeeHidden: true, phases: { main: { start: '2026-02-01', end: '2026-02-05' } },
        budget: { amount: 1200, currency: 'EUR' },
      },
    ],
    asides: [{ id: 'asid01', members: ['ownerkey'], origin: 'trip01', private: true, createdAt: '2026-01-01T00:00:00.000Z' }],
    invites: [{ token: token(24), spaces: ['trip01'], createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' }],
  };
}
function loadStore(app) {
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify(app));
  return { dir, store: new Store(dir) };
}

// Each level of app.json: its fields as the store holds them, against the copy's two lists.
function levels(data) {
  const out = [['app.json', [data], ex.APP_FIELDS, ex.APP_LEFT_OUT], ['settings', [data.settings], ex.SETTINGS_FIELDS, ex.SETTINGS_LEFT_OUT]];
  out.push(['users[]', data.users || [], ex.USER_FIELDS, ex.USER_LEFT_OUT]);
  out.push(['users[].spaces{}', (data.users || []).flatMap((u) => Object.values(u.spaces || {})), ex.USER_SPACE_FIELDS, ex.USER_SPACE_LEFT_OUT]);
  out.push(['spaces[]', data.spaces || [], ex.SPACE_FIELDS, ex.SPACE_LEFT_OUT]);
  out.push(['asides[]', data.asides || [], ex.ASIDE_FIELDS, []]);
  return out;
}
const unclassified = ex.unclassifiedFields;

// The fields the store sets only sometimes (`...(cond ? { field: ... } : {})`), read from its own code, so one added
// later is caught below until the seed sets it (and so it is classified).
const conditionalFields = (fn) => [...new Set([...fn.toString().matchAll(/\?\s*\{\s*([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1]))];

test("every field of a fully seeded environment is on the copy's allow-list or its left-out list", () => {
  const { store } = loadStore(seededApp());
  assert.deepEqual(unclassified(store.data), [], 'classify each of these in server/environment-export.js');
  // The seed reaches every left-out field, so none of them is checked only on paper.
  for (const [level, objects, , leftOut] of levels(store.data)) {
    for (const k of leftOut) assert.ok(objects.some((o) => k in o), `the seed sets ${level}: ${k}`);
  }
  // The seed sets every field each level is stored with, the ones the store keeps only while set included.
  for (const [level, objects, allowed, leftOut] of levels(store.data)) {
    if (level === 'app.json' || level === 'settings') continue;
    for (const k of [...allowed, ...leftOut]) assert.ok(objects.some((o) => k in o), `the seed sets ${level}: ${k}`);
  }
  const byLevel = Object.fromEntries(levels(store.data).map(([level, objects]) => [level, objects]));
  for (const [fn, where] of [[Store.prototype.sanitizeUser, ['users[]', 'users[].spaces{}']], [Store.prototype.sanitizeSpace, ['spaces[]']], [Store.prototype.sanitizeAside, ['asides[]']]]) {
    const fields = conditionalFields(fn);
    assert.ok(fn !== Store.prototype.sanitizeUser || fields.includes('themeMode'), 'the conditional fields are read from the store');
    for (const k of fields) assert.ok(where.some((level) => byLevel[level].some((o) => k in o)), `${fn.name} can store ${k}: set it in the seed here, and classify it in server/environment-export.js`);
  }
  // A field added later is caught here, and is not in the copy.
  const later = structuredClone(store.data);
  later.users[0].newField = 'x';
  later.spaces[1].newField = 'x';
  later.settings.newField = 'x';
  later.newField = 'x';
  assert.deepEqual(unclassified(later), ['app.json: newField', 'settings: newField', 'users[]: newField', 'spaces[]: newField']);
  const copy = ex.exportApp(later);
  assert.ok(!('newField' in copy) && !('newField' in copy.settings) && !('newField' in copy.users[0]) && !('newField' in copy.spaces[1]), 'a field on neither list stays out');
});

test('the copy carries only allowed fields, keeps each of them as it is, and none that is left out', () => {
  const { store } = loadStore(seededApp());
  const data = store.data;
  const copy = ex.exportApp(data);
  for (const [level, objects, allowed, leftOut] of levels(copy)) {
    for (const o of objects) for (const k of Object.keys(o)) {
      assert.ok(allowed.includes(k), `${level}: ${k} is allowed`);
      assert.ok(!leftOut.includes(k), `${level}: ${k} is not left out`);
    }
  }
  const keep = (o, fields) => Object.fromEntries(fields.filter((f) => f in o).map((f) => [f, o[f]]));
  for (const f of ex.APP_FIELDS.filter((k) => !['settings', 'users', 'spaces', 'asides'].includes(k))) assert.deepEqual(copy[f], data[f], `app.json: ${f} kept`);
  assert.deepEqual(copy.settings, keep(data.settings, ex.SETTINGS_FIELDS));
  assert.deepEqual(copy.spaces, data.spaces.map((s) => keep(s, ex.SPACE_FIELDS)));
  assert.deepEqual(copy.asides, data.asides.map((a) => keep(a, ex.ASIDE_FIELDS)));
  assert.deepEqual(copy.users, data.users.map((u) => ({ ...keep(u, ex.USER_FIELDS), spaces: Object.fromEntries(Object.entries(u.spaces).map(([id, s]) => [id, keep(s, ex.USER_SPACE_FIELDS)])) })));
  // No secret value of the seed is anywhere in the copy.
  const text = JSON.stringify(copy);
  assert.ok(!text.includes('aesgcm$') && !text.includes('scrypt$'), 'no sealed value or hash');
  for (const v of [data.secrets.session, data.secrets.stream, data.invites[0].token, data.spaces[1].guestToken, data.users[0].linkToken, data.users[0].calendarFeed.hash, data.settings.publishedCalendarFeed.hash, data.users[0].spaces.trip01.calendarFeed.hash, data.users[2].firstPassword.hash]) {
    assert.ok(!text.includes(v), `the copy carries ${v}`);
  }
  // The live data is unchanged.
  assert.ok(data.users[0].passwordHash && data.secrets.session && data.spaces[1].guestToken);
  // A restore of the copy reads back every person and space as they were, less what was left out.
  const back = loadStore(copy).store.data;
  assert.deepEqual(back.users.map((u) => [u.key, u.login, u.role, u.themeMode, u.passwordHash, u.linkToken, u.mfa]), [['ownerkey', 'owner', 'owner', 'light', null, null, null], ['bosskey1', 'boss', 'admin', undefined, null, null, null], ['newowner', 'newowner', 'owner', undefined, null, null, null]]);
  assert.ok(back.users.every((u) => !('firstPassword' in u)), 'a restored copy carries no first-password link');
  assert.deepEqual(back.spaces.map((s) => ({ ...s, guestToken: undefined })), data.spaces.map((s) => ({ ...s, guestToken: undefined })));
});

test("a host admin's stand-in keeps no password, personal link or second factor of its own when loaded, and the file is written without them", () => {
  const { dir, store } = loadStore(seededApp());
  const boss = store.userByLogin('boss');
  assert.deepEqual([boss.role, boss.hostAdmin, boss.passwordHash, boss.linkToken, boss.mfa], ['admin', true, null, null, null]);
  const owner = store.userByLogin('owner');
  assert.ok(owner.passwordHash && owner.linkToken && owner.mfa, "everyone else's are kept");
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8')).users.find((u) => u.login === 'boss');
  assert.deepEqual([onDisk.passwordHash, onDisk.linkToken, onDisk.mfa], [null, null, null]);
  assert.equal(store.userByLinkToken(seededApp().users[1].linkToken), null);
  assert.ok(!('firstPassword' in boss) && !('firstPassword' in onDisk), 'nor a first-password link');
});

// plan-first-password.md: the link's hash is kept across a load (a restart between sign-up and the exchange keeps it
// working), in its two shapes only, and never on an account with a password or on the stand-in.
test('a first-password link is kept when loaded, in its two shapes only, and only on an account with no password', () => {
  const hash = hex(32);
  const app = seededApp();
  app.users.push(
    { key: 'claimed1', login: 'claimed', role: 'owner', firstPassword: { claim: 'a'.repeat(32), claimedAt: '2026-01-02T00:00:00.000Z', expiresAt: '2026-01-02T00:15:00.000Z' } },
    { key: 'noclaim1', login: 'noclaim', role: 'owner', firstPassword: { claimedAt: '2026-01-02T00:00:00.000Z', expiresAt: '2026-01-02T00:15:00.000Z' } },
    { key: 'badclaim', login: 'badclaim', role: 'owner', firstPassword: { claim: '2026-01-02T00:00:00.000Z', claimedAt: '2026-01-02T00:00:00.000Z', expiresAt: '2026-01-02T00:15:00.000Z' } },
    { key: 'haspass1', login: 'haspass', role: 'owner', passwordHash: `scrypt$${hex(16)}`, firstPassword: { hash, expiresAt: '2099-01-01T00:00:00.000Z' } },
    { key: 'badhash1', login: 'badhash', role: 'owner', firstPassword: { hash: 'short', expiresAt: '2099-01-01T00:00:00.000Z' } },
    { key: 'noends01', login: 'noends', role: 'owner', firstPassword: { hash } },
    { key: 'tokenkp1', login: 'tokenkept', role: 'owner', firstPassword: { hash, expiresAt: '2099-01-01T00:00:00.000Z', token: 'plain-token' } },
  );
  const { store } = loadStore(app);
  const fp = (login) => store.userByLogin(login).firstPassword;
  assert.deepEqual(fp('newowner'), app.users[2].firstPassword);
  assert.deepEqual(fp('claimed'), { claim: 'a'.repeat(32), claimedAt: '2026-01-02T00:00:00.000Z', expiresAt: '2026-01-02T00:15:00.000Z' });
  for (const login of ['haspass', 'badhash', 'noends', 'noclaim', 'badclaim']) assert.equal(fp(login), undefined, login);
  assert.deepEqual(fp('tokenkept'), { hash, expiresAt: '2099-01-01T00:00:00.000Z' }, 'only the hash and the end are kept');
  assert.ok(store.awaitingFirstPassword());
  // A password set any other way ends the link.
  store.updateUser(store.userByLogin('newowner').key, { passwordHash: `scrypt$${hex(16)}` });
  assert.equal(fp('newowner'), undefined);
});

test('a session or stream key weaker than the ones the server makes is replaced when loaded; a strong one is kept', () => {
  for (const weak of [{ session: 'x', stream: 'y' }, { session: 'a'.repeat(42), stream: 'b'.repeat(23) }, { session: `${token(32)}!`, stream: `${token(18)} ` }, { session: 12345, stream: null }]) {
    const { dir, store } = loadStore(seededApp(weak));
    assert.notEqual(store.sessionSecret, weak.session);
    assert.notEqual(store.streamKey, weak.stream);
    assert.match(store.sessionSecret, /^[A-Za-z0-9_-]{43}$/);
    assert.match(store.streamKey, /^[A-Za-z0-9_-]{24}$/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8')).secrets, { session: store.sessionSecret, stream: store.streamKey }, 'written back');
  }
  const { store } = loadStore(seededApp());
  assert.deepEqual([store.sessionSecret, store.streamKey], [strong.session, strong.stream]);
});

test("a restore's files carry no session or stream key; every other file is as it was", () => {
  const src = seededApp();
  const app = Buffer.from(JSON.stringify(src));
  const other = Buffer.from('{"a":1}');
  const out = ex.restoreEntries([['app.json', app], ['./app.json', app], ['chat.json', other], ['bad/app.json', app]], { backup: true });
  const { secrets, ...rest } = src;
  assert.ok(secrets.session);
  for (const i of [0, 1]) assert.deepEqual(JSON.parse(out[i][1].toString('utf8')), rest, 'everything else as it was');
  assert.equal(out[2][1], other);
  assert.equal(out[3][1], app, 'only the environment\'s own record');
  // An owner's copy (no `backup`) loses what it says people agreed to, and any agreements.json.
  const copy = ex.restoreEntries([['app.json', app], ['agreements.json', other], ['./agreements.json', other], ['chat.json', other]]);
  assert.deepEqual(copy.map(([n]) => n), ['app.json', 'chat.json']);
  // Likewise access.json (requests to enter and a guest's approvals): the host's backup keeps it, an owner's copy never carries it.
  assert.deepEqual(ex.restoreEntries([['app.json', app], ['access.json', other], ['./access.json', other]]).map(([n]) => n), ['app.json']);
  assert.deepEqual(ex.restoreEntries([['app.json', app], ['access.json', other]], { backup: true }).map(([n]) => n), ['app.json', 'access.json']);
  assert.equal(ex.fileAllowed('access.json'), false, 'never in an owner\'s copy');
  assert.ok(JSON.parse(copy[0][1].toString('utf8')).users.every((u) => !('agreed' in u)));
  assert.equal(ex.restoreEntries([['app.json', Buffer.from('not json')]])[0][1].toString(), 'not json');
});

test("a restore turns every admin that is not the host admin's stand-in into an owner; the stand-in stays the admin", () => {
  for (const file of ['app.json', LEGACY_ENVIRONMENT_RECORD]) {
    const src = seededApp();
    delete src.secrets; // a zip with nothing else to take out still has its admins turned into owners
    src.users.push({ key: 'madeadm1', login: 'madeadmin', displayName: 'Made', role: 'admin', createdAt: '2026-01-01T00:00:00.000Z' });
    const [[, out]] = ex.restoreEntries([[file, Buffer.from(JSON.stringify(src))]]);
    const back = loadStore(JSON.parse(out.toString('utf8'))).store;
    assert.deepEqual(back.data.users.map((u) => [u.login, u.role, u.hostAdmin]), [['owner', 'owner', false], ['boss', 'admin', true], ['newowner', 'owner', false], ['madeadmin', 'owner', false]], file);
    assert.deepEqual(back.serverAdmins(), [], `${file}: no admin but the stand-in`);
  }
});

// --- files ---------------------------------------------------------------------------------------------------------

// What the server keeps in an environment's folder, one of each kind (and the copy's verdict).
const FILES = {
  allowed: [
    'chat.json', 'layouts.json', 'attention.json', 'facts.json', 'tags.json', 'ai-usage.json', 'ai-log.jsonl',
    'images/ownerkey/player.png', 'images/site/icon.png', 'images/spaces/trip01.webp',
    'modules/registry.json', 'modules/settings.json', 'modules/activity.json', 'modules/announced.json', 'modules/links.json', 'modules/schedules.json', 'modules/notifications.json', 'modules/bus.json',
    'modules/todo/data/environment.json', 'modules/todo/data/space-trip01.json', 'modules/todo/trash/space-trip01.json',
    'modules/research/uploads/space-trip01/abc123.png', 'modules/research/uploads/space-trip01/abc123.json', 'modules/todo/versions/1.0.0/module.json',
    'modules/vault/library/space-trip01.json', 'modules/maps/geocode.json', 'modules/maps/image-map/castle.png',
  ],
  leftOut: [
    'secrets.key', 'modules/secrets.json', 'pre-names/a-part/app.json', 'chat-private.json', 'ai-threads.moved.json', 'ai-threads.json', LEGACY_ENVIRONMENT_RECORD, 'tmp/region-cut/x.pmtiles',
    'modules/todo/data/person-ownerkey.json', 'modules/todo/trash/person-ownerkey.json', 'modules/research/uploads/person-ownerkey/abc123.png', 'modules/research/uploads/person-ownerkey/abc123.json',
    'modules/vault/library/space-trip01.shares.json', 'app.json.tmp', 'modules/maps/image-map/.upload-1a2b.part', 'modules/.staging-1-2/todo/module.json', 'modules/maps/map-tiles/x.pmtiles.part',
  ],
};
const declared = (id) => (id === 'maps' ? ['map-tiles', 'image-map'] : []);

test("every file the server keeps in an environment's folder is allowed in the copy or left out of it", () => {
  for (const name of FILES.allowed) assert.ok(ex.fileAllowed(name, declared) && !ex.fileLeftOut(name), `${name} is allowed`);
  for (const name of FILES.leftOut) assert.ok(!ex.fileAllowed(name, declared) && ex.fileLeftOut(name), `${name} is left out`);
  // A file of a kind nobody classified is on neither list, and is not in the copy.
  for (const name of ['new-thing.json', 'modules/todo/new-folder/a.json', 'modules/maps/undeclared/a.png', 'vault/trip01/abc']) {
    assert.ok(!ex.fileAllowed(name, declared), `${name} is not in the copy`);
    assert.ok(!ex.fileLeftOut(name), `${name} is not on the left-out list either, so the live guard fails on it`);
  }
  assert.equal(ex.fileAllowed('images/../secrets.key', declared), false, 'a path that climbs out');
});

test('the copy carries exactly the allowed files, app.json made from the data and ai.json without its key', () => {
  const files = [...FILES.allowed, ...FILES.leftOut, 'new-thing.json'].map((name) => [name, Buffer.from(name)]);
  files.push(['app.json', Buffer.from('{"secrets":{"session":"s"}}')], ['ai.json', Buffer.from(JSON.stringify({ provider: 'anthropic', key: 'aesgcm$sealed' }))]);
  const out = ex.exportEntries(files, seededApp(), { declared });
  assert.deepEqual(out.map(([name]) => name).sort(), ['ai.json', 'app.json', ...FILES.allowed].sort());
  assert.deepEqual(JSON.parse(out.find(([name]) => name === 'ai.json')[1].toString()), { provider: 'anthropic', key: '' });
  assert.equal('secrets' in JSON.parse(out[0][1].toString()), false);
  for (const [name, data] of out) if (FILES.allowed.includes(name)) assert.equal(data.toString(), name, `${name} as it is`);
});

if (failed) {
  console.error(`check-environment-export: ${failed} failed`);
  process.exit(1);
}
console.log(`check-environment-export: ${n} groups OK`);
