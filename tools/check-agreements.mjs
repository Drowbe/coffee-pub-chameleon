#!/usr/bin/env node
/*
 * check-agreements.mjs -- agreements (documentation/plans/plan-access-bundle.md, step 1): the texts (TERMS_FILE,
 * NDA_FILE), the record, and the gate on the server. Real servers on throwaway data folders, asked as each of: nobody
 * signed in, a member, a moderator, an owner, the admin, the access key, and a second environment on a hosted server.
 *   - the texts: read once at start; a version is the first 16 hex of the text's SHA-256; a byte order mark and
 *     Windows line ends are not part of it; a file that is missing, a folder, empty, over 256 KB or not UTF-8 stops
 *     the start with one sentence, before anything is written;
 *   - with neither text set nothing changes: no agreement page, no accept route, nobody asked, nothing stored;
 *   - GET /api/agreements answers anyone { required, docs: [{ id, title, version, text }] }: only the texts the
 *     server was started with, as JSON, exactly as written (markup in a text is text);
 *   - the gate: an account that has not agreed gets 403 { error, agreementRequired: true } from every API route but
 *     the texts, agreeing, sign-out and branding, whatever the method, the case or the way the path is written, with
 *     the cookie or a bearer token; a page is redirected to /agree?next=<a path on this site>, or told in a frame;
 *     pictures, a module's files, the feed and the keyed page are refused too; the agreement page and the files it is
 *     drawn with are served;
 *   - every way in ends at the gate: a password, a personal link, sign-up, an invite, the code step, the first password;
 *   - agreeing: a session is needed; a request from another site is refused; the versions must be exactly the current
 *     ones (400 for no versions, 409 for anything else); over 1 KB is 413; 20 tries in 15 minutes a person, then 429;
 *     once per person and version (again adds nothing); it is recorded for the one who asked and nobody else, whatever
 *     the body names, and no other route writes it;
 *   - after agreeing everything answers as before; the record survives a restart; a changed text asks again, a session
 *     already open included, and the old versions are refused; a text taken away is no longer asked;
 *   - never asked: the host admin's stand-in on a hosted server, and a request with no account session (the access
 *     key); a session that has not agreed is refused even when it carries the access key or a guest link;
 *   - a hosted server: the host console and the product host have no agreement routes; agreeing in one environment
 *     says nothing in another, and one environment's session is nobody at another;
 *   - the demo space on a hosted server: the loader's own requests carry a mark the server makes for that one run, so
 *     all its chat is posted; a real account is refused before, during and after the run whatever header, field or name
 *     it sends, and a person who signs in as a demo person is asked;
 *   - guests' agreements (server/agreements.js, GuestAgreements): a typed name is kept as plain text, one line, at
 *     most 40 characters; one record per guest, text and version; the file is private, bounded, and never written over
 *     when it cannot be read; an owner's copy carries neither it nor an account's `agreed`.
 * Left for later steps, pinned here so they change on purpose: a guest link is not asked (step 4), and /agree serves
 * the step page, which has no agreement panel until step 2.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auth = require('../server/auth.js');
const lib = require('../server/agreements.js');
const { Store } = require('../server/store.js');
const exportLib = require('../server/environment-export.js');
const { zipFiles } = require('../server/module-build.js');

const AGREE_FIRST = 'Agree to the terms first.';
const ORIGIN_SENTENCE = 'This request came from another site, so it was refused.';
const CHANGED = 'The text has changed. Read it again, then agree.';
const NO_VERSIONS = 'Send the version of each text you agree to.';
const ADMIN_PASSWORD = 'check-agreements-admin-1';
const HOST_LOGIN = 'boss';
const HOST_PASSWORD = 'check-agreements-host-1';
// Markup in a text is text: nothing here may ever come back as a page.
const TERMS_1 = '# Terms of service\n\nBe kind. <script>alert(1)</script> <img src=x onerror=alert(2)>\n\n[a link](javascript:alert(3)) and "quotes" & more.\n';
const TERMS_2 = `${TERMS_1}\nOne more line.\n`;
const NDA_1 = '# Beta NDA\n\nTell nobody.\n';
const sha16 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);

let n = 0;
let failed = 0;
const notes = [];
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-agreements: ${name}: ${err.stack || err.message}`); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-agreements-'));
const write = (name, data) => { const file = path.join(tmp, name); fs.writeFileSync(file, data); return file; };
const termsFile = write('terms.md', TERMS_1);
const ndaFile = write('nda.md', NDA_1);

// --- unit: the texts ------------------------------------------------------------------------------------------------
await test('the texts: a version is the first 16 hex of the SHA-256 of the text, and only what is set is asked', () => {
  const none = lib.readTexts({});
  assert.deepEqual({ required: none.required, docs: none.docs, versions: none.versions }, { required: false, docs: [], versions: {} });
  assert.equal(lib.readTexts({ TERMS_FILE: '', NDA_FILE: undefined }).required, false, 'empty or missing is not set (blank is refused: see below)');
  const both = lib.readTexts({ TERMS_FILE: termsFile, NDA_FILE: ndaFile });
  assert.equal(both.required, true);
  assert.deepEqual(both.docs.map((d) => [d.id, d.title, d.version, d.text]), [['terms', 'Terms of service', sha16(TERMS_1), TERMS_1], ['nda', 'Beta NDA', sha16(NDA_1), NDA_1]]);
  assert.deepEqual(both.versions, { terms: sha16(TERMS_1), nda: sha16(NDA_1) });
  for (const d of both.docs) assert.match(d.version, /^[0-9a-f]{16}$/);
  const one = lib.readTexts({ NDA_FILE: ndaFile });
  assert.deepEqual(one.docs.map((d) => d.id), ['nda'], 'one text set: one text asked');
  // A byte order mark and Windows line ends are how a file was saved, not what it says.
  const windows = write('terms-windows.md', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(TERMS_1.replace(/\n/g, '\r\n'))]));
  assert.equal(lib.readTexts({ TERMS_FILE: windows }).docs[0].version, sha16(TERMS_1));
  assert.equal(lib.readTexts({ TERMS_FILE: windows }).docs[0].text, TERMS_1);
  assert.notEqual(lib.versionOf(TERMS_2), lib.versionOf(TERMS_1), 'a changed text is another version');
  assert.throws(() => { both.docs.push({}); }, TypeError, 'the texts cannot be changed once read');
});

await test('the texts: a file that is set and cannot be used is refused with one sentence naming the variable', () => {
  const cases = [
    ['missing', path.join(tmp, 'no-such-file.md'), /is not a file this server can read/],
    ['a folder', tmp, /is not a file/],
    ['empty', write('empty.md', ''), /is empty/],
    ['only spaces', write('spaces.md', ' \n\t\r\n'), /is empty/],
    ['over 256 KB', write('big.md', 'a'.repeat(lib.MAX_TEXT_BYTES + 1)), /is over 256 KB/],
    ['not UTF-8', write('latin.md', Buffer.from([0x54, 0xe9, 0x72, 0x6d, 0x73])), /is not text/],
    ['a NUL byte', write('nul.md', Buffer.from('Terms\u0000more')), /is not text/],
  ];
  for (const [what, file, sentence] of cases) {
    for (const variable of ['TERMS_FILE', 'NDA_FILE']) {
      assert.throws(() => lib.readTexts({ [variable]: file }), (err) => err instanceof lib.AgreementTextError && sentence.test(err.message) && err.message.startsWith(`${variable}=`), `${variable}: ${what}`);
    }
  }
  assert.equal(lib.readTexts({ TERMS_FILE: write('max.md', 'a'.repeat(lib.MAX_TEXT_BYTES)) }).docs.length, 1, 'exactly 256 KB is read');
});

await test('an account\'s record: only { doc, version, at } of a known text is kept, once per text and version', () => {
  const at = '2026-11-11T10:00:00.000Z';
  const v = sha16(TERMS_1);
  assert.deepEqual(lib.cleanAgreed([{ doc: 'terms', version: v, at, extra: 1 }, { doc: 'terms', version: v, at: '2026-11-12T10:00:00.000Z' }]), [{ doc: 'terms', version: v, at }]);
  for (const bad of [null, 'x', {}, [null], [{ doc: 'other', version: v, at }], [{ doc: 'terms', version: 'ZZZZ', at }], [{ doc: 'terms', version: v.toUpperCase(), at }], [{ doc: 'terms', version: v, at: 'when' }], [{ doc: 'terms', version: v }], [{ doc: '__proto__', version: v, at }], [{ doc: ['terms'], version: v, at }]]) {
    assert.deepEqual(lib.cleanAgreed(bad), [], JSON.stringify(bad));
  }
  const docs = [{ id: 'terms', version: v }, { id: 'nda', version: sha16(NDA_1) }];
  assert.equal(lib.hasAgreed([{ doc: 'terms', version: v, at }], docs), false, 'one of two is not agreed');
  assert.equal(lib.hasAgreed([{ doc: 'terms', version: v, at }, { doc: 'nda', version: sha16(NDA_1), at }], docs), true);
  assert.equal(lib.hasAgreed([{ doc: 'terms', version: sha16(TERMS_2), at }, { doc: 'nda', version: sha16(NDA_1), at }], docs), false, 'another version is not agreed');
  for (const none of [undefined, null, 'x', {}]) assert.equal(lib.hasAgreed(none, docs), false);
  assert.equal(lib.versionsMatch({ terms: v, nda: sha16(NDA_1) }, docs), true);
  for (const bad of [null, undefined, 'x', [], [v, sha16(NDA_1)], {}, { terms: v }, { terms: v, nda: sha16(NDA_1), more: 'x' }, { terms: sha16(TERMS_2), nda: sha16(NDA_1) }, { terms: [v], nda: sha16(NDA_1) }, { terms: v, nda: null }, { terms: v, NDA: sha16(NDA_1) }]) {
    assert.equal(lib.versionsMatch(bad, docs), false, JSON.stringify(bad));
  }
});

await test('where to go after agreeing is only ever a path on this site', () => {
  for (const bad of ['//evil.example', '/\\evil.example', '/\\\\evil', 'https://evil.example', 'javascript:alert(1)', '/\t/evil.example', '/\n/evil.example', '\\\\evil.example', 'spaces/x', '', null, undefined, 7, ['/x'], { a: 1 },
    '/.//evil.example', '/./\\evil.example', '/a/..//evil.example', '/..//evil.example', '/%2e//evil.example', '/a/../\\evil.example', '/%2f%2fevil.example', '/%5Cevil.example', `/${'a'.repeat(2001)}`]) {
    assert.equal(auth.safeNext(bad), '/', JSON.stringify(bad));
  }
  for (const good of ['/', '/profile', '/spaces/x?y=1', '/login?next=%2Fprofile']) assert.equal(auth.safeNext(good), good, good);
  assert.equal(auth.safeNext('/a/../b?c=1#d'), '/b?c=1', 'answered as a browser resolves it, without the fragment');
});

// --- unit: guests' agreements ---------------------------------------------------------------------------------------
const DOCS_1 = [{ id: 'terms', version: sha16(TERMS_1) }, { id: 'nda', version: sha16(NDA_1) }];
await test('a guest\'s typed name is kept as plain text: one line, no hidden characters, at most 40', () => {
  assert.equal(lib.cleanGuestName('  Ada \r\n Lovelace\t '), 'Ada Lovelace');
  assert.equal(lib.cleanGuestName('<script>alert(1)</script>'), '<script>alert(1)</script>', 'markup is text, kept as it is');
  assert.equal(lib.cleanGuestName('a\u0000b\u0007c\u001bd\u007fe\u2028f\u2029g'), 'a b c d e f g');
  assert.equal(lib.cleanGuestName('Ad\u202Ea\u200B\u2066 x\uFEFF'), 'Ada x', 'characters that hide or reorder text are taken out');
  assert.equal([...lib.cleanGuestName('\u{1F600}'.repeat(60))].length, 40, 'counted as a person counts them');
  assert.equal(lib.cleanGuestName('x'.repeat(5000)).length, 40);
  for (const none of [undefined, null, 7, {}, ['Ada'], '', '   ', '\u200B\u200B', '\n\t']) assert.equal(lib.cleanGuestName(none), '', JSON.stringify(none));
});

await test('guests\' agreements: one record per guest, text and version, kept across a reload, private, bounded', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'guests-'));
  const file = path.join(dir, 'agreements.json');
  const guests = new lib.GuestAgreements(dir);
  assert.ok(!fs.existsSync(file), 'no file until a guest agrees');
  const at = '2026-11-11T10:00:00.000Z';
  const hostile = '<img src=x onerror=alert(1)>"\';\r\n{{7*7}}';
  const added = guests.record({ guest: 'guest-abcd1234', name: hostile, docs: DOCS_1, at });
  assert.equal(added.length, 2);
  const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(kept), ['agreements']);
  assert.deepEqual(kept.agreements, DOCS_1.map((d) => ({ guest: 'guest-abcd1234', name: '<img src=x onerror=alert(1)>"\'; {{7*7}}', doc: d.id, version: d.version, at })));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'private to the server\'s own user');
  assert.ok(!fs.existsSync(`${file}.tmp`), 'written whole, then renamed');
  assert.deepEqual(guests.record({ guest: 'guest-abcd1234', name: 'Another name', docs: DOCS_1 }), [], 'agreeing again adds nothing');
  assert.equal(guests.has('guest-abcd1234', DOCS_1), true);
  assert.equal(guests.has('guest-other123', DOCS_1), false);
  assert.equal(guests.has('guest-abcd1234', [{ id: 'terms', version: sha16(TERMS_2) }]), false, 'a changed text is not agreed');
  for (const none of [undefined, null, {}, ['guest-abcd1234']]) assert.equal(guests.has(none, DOCS_1), false);
  // Refusals: one sentence each, nothing kept.
  const refused = (input, status, sentence) => assert.throws(() => guests.record(input), (err) => err instanceof lib.AgreementError && err.status === status && sentence.test(err.message), JSON.stringify(input));
  for (const guest of [undefined, null, 'abcd1234', 'guest-', 'guest-ab', 'guest-../../x', `guest-${'a'.repeat(41)}`, 'guest-abcd|terms', { toString: () => 'guest-abcd1234' }]) refused({ guest, name: 'Ada', docs: DOCS_1 }, 400, /not a guest/);
  for (const name of [undefined, '', '   ', '\u200B', 7, {}]) refused({ guest: 'guest-wxyz9876', name, docs: DOCS_1 }, 400, /name is required/);
  refused({ guest: 'guest-wxyz9876', name: 'Ada', docs: [] }, 404, /nothing to agree to/);
  refused({ guest: 'guest-wxyz9876', name: 'Ada', docs: [{ id: 'other', version: sha16(NDA_1) }] }, 400, /not one of the texts/);
  refused({ guest: 'guest-wxyz9876', name: 'Ada', docs: [{ id: 'terms', version: 'nope' }] }, 400, /not one of the texts/);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).agreements.length, 2, 'a refusal keeps nothing');
  // A reload reads the same records, and drops anything that is not one.
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.agreements.push({ guest: 'guest-abcd1234', name: 'Twice', doc: 'terms', version: sha16(TERMS_1), at }, { guest: 'nobody', name: 'x', doc: 'terms', version: sha16(TERMS_1), at }, null, 'x', { guest: 'guest-good5678', name: 'Good <b>', doc: 'nda', version: sha16(NDA_1), at });
  raw.__proto__ = { polluted: true };
  fs.writeFileSync(file, JSON.stringify(raw));
  const again = new lib.GuestAgreements(dir);
  assert.equal(again.records.length, 3);
  assert.equal(again.has('guest-abcd1234', DOCS_1), true);
  assert.deepEqual(again.of('guest-good5678'), [{ guest: 'guest-good5678', name: 'Good <b>', doc: 'nda', version: sha16(NDA_1), at }]);
  assert.equal({}.polluted, undefined);
  // Bounded: past the most it keeps, nobody new is recorded and nothing kept is dropped.
  const small = new lib.GuestAgreements(fs.mkdtempSync(path.join(tmp, 'guests-small-')), { max: 3 });
  small.record({ guest: 'guest-aaaa1111', name: 'A', docs: DOCS_1 });
  assert.throws(() => small.record({ guest: 'guest-bbbb2222', name: 'B', docs: DOCS_1 }), (err) => err instanceof lib.AgreementError && err.status === 503 && /is full/.test(err.message));
  assert.equal(small.records.length, 2);
  assert.equal(small.has('guest-bbbb2222', DOCS_1), false, 'half an agreement is none');
  assert.equal(small.record({ guest: 'guest-cccc3333', name: 'C', docs: [DOCS_1[0]] }).length, 1, 'one more still fits');
  // A record that could not be written is not kept in memory either.
  const lost = new lib.GuestAgreements(fs.mkdtempSync(path.join(tmp, 'guests-lost-')));
  lost.save = () => { throw new Error('disk full'); };
  assert.throws(() => lost.record({ guest: 'guest-dddd4444', name: 'D', docs: DOCS_1 }), /disk full/);
  assert.equal(lost.records.length, 0);
  assert.equal(lost.has('guest-dddd4444', DOCS_1), false);
});

await test('guests\' agreements: a file that cannot be read is set aside, never written over', () => {
  for (const damaged of ['{"agreements": [', '[]', '"x"', '{"agreements": {}}', '']) {
    const dir = fs.mkdtempSync(path.join(tmp, 'guests-damaged-'));
    fs.writeFileSync(path.join(dir, 'agreements.json'), damaged);
    const said = [];
    const guests = new lib.GuestAgreements(dir, { log: (line) => said.push(line) });
    assert.equal(guests.records.length, 0);
    const aside = fs.readdirSync(dir).filter((f) => /^agreements\.unreadable-\d+\.json$/.test(f));
    assert.equal(aside.length, 1, `set aside: ${JSON.stringify(damaged)}`);
    assert.equal(fs.readFileSync(path.join(dir, aside[0]), 'utf8'), damaged, 'kept as it was');
    assert.equal(said.length, 1, 'said once');
    guests.record({ guest: 'guest-abcd1234', name: 'Ada', docs: DOCS_1 });
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'agreements.json'), 'utf8')).agreements.length, 2);
  }
});

await test('the store: an agreement is added to one account only, kept across a reload, and left out of an owner\'s copy', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'store-'));
  const store = new Store(dir);
  const ada = store.addUser({ login: 'ada', displayName: 'Ada', role: 'member', passwordHash: 'scrypt$x$y' });
  const bob = store.addUser({ login: 'bob', displayName: 'Bob', role: 'member', passwordHash: 'scrypt$x$y' });
  assert.ok(!('agreed' in ada), 'nothing until they agree');
  const at = '2026-11-11T10:00:00.000Z';
  store.recordAgreement(ada.key, DOCS_1, at);
  store.recordAgreement(ada.key, DOCS_1, '2026-12-01T00:00:00.000Z');
  assert.deepEqual(store.userByKey(ada.key).agreed, DOCS_1.map((d) => ({ doc: d.id, version: d.version, at })), 'once per text and version, the first time kept');
  assert.ok(!('agreed' in store.userByKey(bob.key)), 'nobody else');
  assert.throws(() => store.recordAgreement('nobody00', DOCS_1), /no such user/);
  assert.throws(() => store.recordAgreement(bob.key, [{ id: 'other', version: sha16(NDA_1) }]), /not one of the texts/);
  assert.ok(!('agreed' in store.userByKey(bob.key)));
  // A changed text is added beside the old one: the history stays.
  store.recordAgreement(ada.key, [{ id: 'terms', version: sha16(TERMS_2) }], '2026-12-02T00:00:00.000Z');
  assert.equal(store.userByKey(ada.key).agreed.length, 3);
  // No other change to an account writes it.
  store.updateUser(bob.key, { displayName: 'Bobby', agreed: store.userByKey(ada.key).agreed });
  assert.ok(!('agreed' in store.userByKey(bob.key)), 'updateUser does not take agreed');
  const again = new Store(dir);
  assert.equal(again.userByKey(ada.key).agreed.length, 3, 'kept across a reload');
  assert.equal(lib.hasAgreed(again.userByKey(ada.key).agreed, DOCS_1), true);
  // The owner's copy: neither the accounts' agreements nor the guests' file.
  const copy = exportLib.exportApp(again.data);
  assert.ok(copy.users.length === 2 && copy.users.every((u) => !('agreed' in u)), 'an owner\'s copy leaves agreed out');
  assert.deepEqual(exportLib.unclassifiedFields(again.data), [], 'agreed is classified for the copy');
  for (const name of ['agreements.json', 'agreements.unreadable-1762855200000.json']) {
    assert.equal(exportLib.fileAllowed(name), false, `${name} is not in an owner's copy`);
    assert.equal(exportLib.fileLeftOut(name), true, `${name} is left out on purpose`);
  }
  assert.ok(!exportLib.exportEntries([['agreements.json', Buffer.from('{}')]], again.data).some(([name]) => name.startsWith('agreements')));
});

// --- the servers ----------------------------------------------------------------------------------------------------
async function startServer(dataDir, env) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: os.tmpdir(), PORT: '0', DATA_DIR: dataDir, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 25000);
    const look = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', look);
    child.stderr.on('data', look);
    child.once('exit', (code) => { clearTimeout(timer); reject(Object.assign(new Error(`the server stopped (${code}):\n${out}`), { code, output: out })); });
  });
  return { port, output: () => out, stop: () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); }) };
}

let server = null;
let ip = 0;
const nextIp = () => { ip += 1; return `198.51.100.${ip}`; };
// One request. `host`: null for a single-environment server, else a subdomain of localhost ('' is the product host).
// Nothing is followed: a redirect is read as it is answered.
function call(host, method, urlPath, { body, type = 'application/json', cookie, bearer, from = '192.0.2.1', headers = {}, srv = server } = {}) {
  const payload = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const h = { host: host === null ? `127.0.0.1:${srv.port}` : `${host ? `${host}.` : ''}localhost:${srv.port}`, accept: 'application/json', 'x-forwarded-for': from, ...headers };
  if (payload) { h['content-type'] = type; h['content-length'] = payload.length; }
  if (cookie) h.cookie = cookie;
  if (bearer) h.authorization = `Bearer ${bearer}`;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, method, path: urlPath, headers: h }, (res) => {
      const chunks = [];
      // A stream that opened (it should not have, where this check asks for one) is read for a moment, then closed.
      const streaming = /text\/event-stream/.test(res.headers['content-type'] || '');
      const done = () => {
        const raw = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(raw.toString('utf8')); } catch { json = null; }
        const setCookies = [].concat(res.headers['set-cookie'] || []);
        const jar = {};
        for (const c of setCookies) { const [pair] = c.split(';'); const eq = pair.indexOf('='); jar[pair.slice(0, eq)] = /expires=Thu, 01 Jan 1970/i.test(c) ? '' : pair.slice(eq + 1); }
        resolve({ status: res.statusCode, headers: res.headers, text: raw.toString('utf8'), json, setCookies, jar, streaming });
      };
      res.on('data', (c) => chunks.push(c));
      res.on('end', done);
      if (streaming) setTimeout(() => { req.destroy(); done(); }, 300);
    });
    req.setTimeout(15000, () => req.destroy(new Error(`${method} ${urlPath} did not answer`)));
    req.on('error', (err) => { if (err.code !== 'ECONNRESET') reject(err); });
    if (payload) req.write(payload);
    req.end();
  });
}
const sessionOf = (r) => (r.jar.app_session ? `app_session=${r.jar.app_session}` : null);
async function signIn(host, login, password, opts = {}) {
  const res = await call(host, 'POST', '/api/login', { body: { login, password }, from: nextIp(), ...opts });
  assert.equal(res.status, 200, `sign-in as ${login}: ${res.text}`);
  assert.ok(sessionOf(res), `sign-in as ${login} sets the session`);
  return { cookie: sessionOf(res), token: res.json.token, key: res.json.user.key };
}
const isAsked = (r) => r.status === 403 && r.json?.error === AGREE_FIRST && r.json?.agreementRequired === true && Object.keys(r.json).length === 2;
const versionsOf = async (host) => Object.fromEntries((await call(host, 'GET', '/api/agreements')).json.docs.map((d) => [d.id, d.version]));
const agree = async (host, cookie, versions, opts = {}) => call(host, 'POST', '/api/agreements/accept', { body: { versions: versions || await versionsOf(host) }, cookie, ...opts });
const appJson = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'));
const onDisk = (dir, login) => appJson(dir).users.find((u) => u.login === login);
function filesUnder(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.lstatSync(full);
    if (st.isDirectory()) filesUnder(full, out);
    else if (st.isFile()) out.push(full);
  }
  return out;
}
const guestFiles = (dir) => filesUnder(dir).filter((f) => /(^|\/)agreements[^/]*\.json$/.test(f));

// --- a single-environment server with nothing set: as before ---------------------------------------------------------
{
  const dataDir = fs.mkdtempSync(path.join(tmp, 'plain-'));
  try {
    server = await startServer(dataDir, { ADMIN_PASSWORD });
    await test('nothing set: no agreement step, no accept route, no agreement page, nobody asked, nothing stored', async () => {
      assert.ok(!/Agreements are on/.test(server.output()), 'the start says nothing about agreements');
      const texts = await call(null, 'GET', '/api/agreements');
      assert.equal(texts.status, 200);
      assert.deepEqual(texts.json, { required: false, docs: [] });
      const admin = await signIn(null, 'admin', ADMIN_PASSWORD);
      const me = await call(null, 'GET', '/api/me', { cookie: admin.cookie });
      assert.equal(me.status, 200, me.text);
      assert.deepEqual((await call(null, 'GET', '/api/agreements', { cookie: admin.cookie })).json, { required: false, docs: [] });
      // The accept route and the page answer exactly as a path nobody ever made.
      for (const [method, route, unknown] of [['POST', '/api/agreements/accept', '/api/agreements/no-such-thing'], ['GET', '/agree', '/no-such-page']]) {
        for (const cookie of [undefined, admin.cookie]) {
          const got = await call(null, method, route, { cookie, body: method === 'POST' ? { versions: {} } : undefined, headers: { accept: 'text/html' } });
          const base = await call(null, method, unknown, { cookie, body: method === 'POST' ? { versions: {} } : undefined, headers: { accept: 'text/html' } });
          assert.equal(got.status, 404, `${method} ${route}`);
          assert.equal(got.status, base.status);
          assert.equal(got.text.replace(route, unknown), base.text, `${method} ${route} answers as an unknown path`);
        }
      }
      assert.equal((await call(null, 'GET', '/', { cookie: admin.cookie, headers: { accept: 'text/html' } })).status, 200);
      assert.ok(appJson(dataDir).users.every((u) => !('agreed' in u)), 'no account holds agreed');
      assert.deepEqual(guestFiles(dataDir), [], 'no agreements file');
    });
  } finally {
    if (server) await server.stop();
    server = null;
  }
}

// --- a file that cannot be used stops the start ----------------------------------------------------------------------
await test('a text that is set and cannot be read stops the start with one sentence, before anything is written', async () => {
  for (const [variable, file, sentence] of [['TERMS_FILE', path.join(tmp, 'no-such-file.md'), /is not a file this server can read/], ['NDA_FILE', path.join(tmp, 'empty.md'), /is empty/], ['TERMS_FILE', path.join(tmp, 'big.md'), /is over 256 KB/]]) {
    const dataDir = path.join(tmp, `never-${crypto.randomBytes(4).toString('hex')}`);
    let stopped = null;
    try {
      const started = await startServer(dataDir, { ADMIN_PASSWORD, [variable]: file });
      await started.stop();
    } catch (err) { stopped = err; }
    assert.ok(stopped, `${variable}=${file}: the server must not start`);
    assert.equal(stopped.code, 1, stopped.message);
    assert.ok(stopped.output.includes(`${variable}=${file}`) && sentence.test(stopped.output), stopped.output);
    assert.ok(!/listening on/.test(stopped.output));
    assert.ok(!fs.existsSync(dataDir), 'nothing was written');
  }
});

await test('a text variable that is set but blank stops the start with one sentence, before anything is written', async () => {
  for (const variable of ['TERMS_FILE', 'NDA_FILE']) {
    for (const blank of [' ', '\t', '   \t ']) {
      assert.throws(() => lib.readTexts({ [variable]: blank }), (err) => err instanceof lib.AgreementTextError && err.message === `${variable} is set but blank. Name a file, or remove ${variable} to ask nobody.`, `${variable}: ${JSON.stringify(blank)}`);
    }
    const dataDir = path.join(tmp, `never-${crypto.randomBytes(4).toString('hex')}`);
    let stopped = null;
    try { await (await startServer(dataDir, { ADMIN_PASSWORD, [variable]: '   ' })).stop(); } catch (err) { stopped = err; }
    assert.ok(stopped && stopped.code === 1, `${variable}: the server must not start`);
    assert.ok(stopped.output.includes(`${variable} is set but blank.`) && !/listening on/.test(stopped.output), stopped.output);
    assert.ok(!fs.existsSync(dataDir), 'nothing was written');
  }
});

// agreements.json that is a folder (or otherwise cannot be read) at start is set aside like one that is corrupt.
await test('an agreements.json that is a folder: set aside, said once, and the environment answers as it should', async () => {
  const dataDir = fs.mkdtempSync(path.join(tmp, 'folder-'));
  fs.mkdirSync(path.join(dataDir, 'agreements.json'));
  fs.writeFileSync(path.join(dataDir, 'agreements.json', 'x'), 'x');
  const said = [];
  const g = new lib.GuestAgreements(dataDir, { log: (m) => said.push(m) });
  assert.deepEqual(g.records, []);
  assert.equal(said.length, 1);
  assert.ok(!said[0].includes('EISDIR'));
  assert.ok(fs.readdirSync(dataDir).some((f) => /^agreements\.unreadable-\d+\.json$/.test(f)));
  assert.ok(!fs.existsSync(path.join(dataDir, 'agreements.json')));
  // And a whole server started over one.
  const served = fs.mkdtempSync(path.join(tmp, 'folder-server-'));
  fs.mkdirSync(path.join(served, 'agreements.json'));
  const srv = await startServer(served, { ADMIN_PASSWORD, TERMS_FILE: termsFile });
  try {
    assert.equal((await call(null, 'GET', '/api/agreements', { srv })).status, 200);
    assert.equal((await call(null, 'GET', '/api/me', { srv })).status, 401);
    const login = await call(null, 'POST', '/api/login', { srv, body: { login: 'admin', password: ADMIN_PASSWORD }, from: nextIp() });
    assert.equal(login.status, 200, login.text);
    assert.ok(!srv.output().includes('EISDIR') || /could not be read as agreements/.test(srv.output()));
  } finally { await srv.stop(); }
});

// --- a single-environment server with both texts ----------------------------------------------------------------------
const single = fs.mkdtempSync(path.join(tmp, 'single-'));
const people = {}; // name -> { cookie, token, key }
let accessKey = null;
let spaceId = null;
let recoveryCode = null;
const V1 = { terms: sha16(TERMS_1), nda: sha16(NDA_1) };
// What a person who has not agreed is refused, as [method, path, body?]: a sample of every kind of route.
const refusedRoutes = (key) => [
  ['GET', '/api/me'], ['GET', '/api/spaces'], ['GET', '/api/presence'], ['GET', '/api/config'], ['GET', '/api/settings'], ['GET', '/api/users'],
  ['GET', '/api/modules'], ['GET', '/api/notifications'], ['GET', '/api/notifications/stream'], ['GET', '/api/live?space=lobby'], ['GET', '/api/status'],
  ['GET', '/api/destinations'], ['GET', '/api/environment/export'], ['GET', '/api/product'], ['GET', '/api/spaces/lobby/chat'], ['GET', '/api/modules/stream/data?scope=environment'],
  ['GET', '/api/modules/stream/context'], ['GET', '/api/bus/events'], ['GET', '/api/guest-link/abc'], ['GET', '/api/shared/abc'], ['GET', '/api/invites/abc'],
  ['POST', '/healthz'], ['GET', '/healthz/x'], ['GET', '/api/login'], ['POST', '/api/login/verify'], ['POST', '/api/login/x'], ['POST', '/api/login/first-password'], ['GET', `/img/${key}/profile`], ['GET', '/img/space/lobby'], ['GET', '/img/guest/player'], ['GET', '/img/default/player'],
  ['GET', '/m/stream/1.0.0/index.html'], ['GET', '/m/stream/1.0.0/app.js'], ['GET', '/modules/stream'], ['GET', '/feed/abc.ics'], ['GET', `/view/${key}`], ['GET', '/shared/abc'],
  ['GET', '/about/studio-logo'], ['GET', '/viewer/pdf'], ['GET', '/design-system/'], ['GET', '/space.html'], ['GET', '/admin.html'], ['GET', '/login.html'],
  // However the path is written.
  ['GET', '/API/ME'], ['GET', '/api/me/'], ['GET', '/Api/Me/'], ['GET', '//api/me'], ['GET', '/api//me'], ['GET', '/api/agreements/../me'], ['GET', '/api/branding/../me'],
  ['GET', '/api/%6de'], ['GET', '/api/me%2f'], ['GET', '/api/branding/x'], ['GET', '/api/agreements/x'], ['GET', '/api/agreements/accept'], ['GET', '/api/logout'],
  ['GET', '/assets/../api/me'], ['GET', '/sdk/../api/me'], ['GET', '/fa/%2e%2e/api/me'], ['GET', '/lib/..%2fapi%2fme'], ['GET', '/x.js/../api/me'], ['GET', '/agree/x'], ['GET', '/agree.html'],
  ['GET', '/assets/..'], ['GET', '/assets/./../space.html'], ['GET', '/sdk//system.css'], ['GET', '/fonts/..%5capp.json'], ['GET', '/assets/'], ['GET', '/sdk'], ['GET', '/..js'], ['GET', '/.x.js'], ['GET', '/a%20b.js'], ['GET', '/assets/.hidden'],
  // Whatever the method.
  ['POST', '/api/spaces', { name: 'Camp' }], ['PATCH', '/api/me', { themeMode: 'dark' }], ['PUT', '/api/me/images/profile', {}], ['DELETE', `/api/users/${key}`],
  ['POST', '/api/register', { login: 'x', password: 'y' }], ['POST', '/api/guest-join', { token: 'abc', name: 'G' }],
  ['POST', '/api/presence'], ['POST', '/api/me/mfa/start'], ['POST', '/api/stream-key/regenerate'], ['POST', '/api/branding'], ['DELETE', '/api/agreements'], ['PUT', '/api/agreements/accept', { versions: V1 }],
  ['POST', '/api/agreements', { versions: V1 }], ['OPTIONS', '/api/me'], ['POST', '/agree', { versions: V1 }], ['POST', '/logout'], ['DELETE', '/style.css'], ['POST', '/sdk/system.css'],
];
// The pages a browser asks for: each is sent to the agreement page, with where it was going.
const PAGES = ['/', '/profile', '/admin', '/login', '/login?next=%2Fprofile', '/register', '/login/verify', '/login/enrol', '/calendar', '/map', '/modules/stream', '/guest/abc', '/invite/abc', '/j/abc', '/me', '/space.html', '/admin.html', '/profile.html', '/no-such-page'];
// What stays open to them: the texts, branding, the agreement page and the files it is drawn with.
const OPEN = ['/api/agreements', '/API/Agreements/', '/api/branding', '/api/branding/', '/agree', '/Agree/', '/style.css', '/brand.js', '/login-step.js', '/next-address.js', '/theme-head.js', '/mfa-enrol.js', '/theme.css', '/fa/css/all.min.css', '/sdk/system.css', '/img/site/icon', '/favicon.ico', '/manifest.webmanifest', '/assets/images/brand/favicon.svg', '/healthz', '/HEALTHZ/'];

async function refusedEverywhere(host, who, label) {
  for (const [method, route, body] of refusedRoutes(who.key)) {
    const res = await call(host, method, route, { cookie: who.cookie, body });
    assert.ok(isAsked(res), `${label}: ${method} ${route} answered ${res.status} ${res.text.slice(0, 120)}`);
    assert.ok(!res.streaming, `${label}: ${method} ${route} opened a stream`);
    assert.equal(res.headers['cache-control'], 'no-store', `${label}: ${method} ${route}`);
    assert.ok(!res.setCookies.length, `${label}: ${method} ${route} set a cookie`);
  }
  // The same with the session as a bearer token (the Studio app).
  for (const route of ['/api/me', '/api/spaces', '/api/status']) assert.ok(isAsked(await call(host, 'GET', route, { bearer: who.token })), `${label}: bearer ${route}`);
  for (const route of PAGES) {
    const res = await call(host, 'GET', route, { cookie: who.cookie, headers: { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } });
    assert.equal(res.status, 302, `${label}: page ${route} answered ${res.status}`);
    assert.equal(res.headers.location, `/agree?next=${encodeURIComponent(route)}`, `${label}: page ${route}`);
    const head = await call(host, 'HEAD', route, { cookie: who.cookie, headers: { accept: 'text/html' } });
    assert.equal(head.status, 302, `${label}: HEAD ${route}`);
  }
}
async function openToThem(host, who, label) {
  for (const route of OPEN) {
    const res = await call(host, 'GET', route, { cookie: who.cookie, headers: { accept: route.startsWith('/agree') || route.startsWith('/Agree') ? 'text/html' : '*/*' } });
    assert.equal(res.status, 200, `${label}: ${route} answered ${res.status} ${res.text.slice(0, 120)}`);
  }
}

try {
  server = await startServer(single, { ADMIN_PASSWORD, TERMS_FILE: termsFile, NDA_FILE: ndaFile });

  await test('the texts are read at start and said once', () => {
    assert.ok(server.output().includes(`Agreements are on: Terms of service (version ${V1.terms}), Beta NDA (version ${V1.nda}). Every account agrees before entering.`), server.output());
  });

  await test('the texts: nosniff, and 60 reads in 15 minutes for each address, 429 after, never touching sign-in or agreeing', async () => {
    const a = nextIp();
    const b = nextIp();
    for (let i = 0; i < 60; i += 1) {
      const res = await call(null, 'GET', '/api/agreements', { from: a });
      assert.equal(res.status, 200, `read ${i + 1}`);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
    }
    const over = await call(null, 'GET', '/api/agreements', { from: a });
    assert.equal(over.status, 429);
    assert.deepEqual(over.json, { error: 'too many requests, try again in a few minutes' });
    assert.equal(over.headers['x-content-type-options'], 'nosniff');
    assert.equal((await call(null, 'GET', '/api/agreements', { from: b })).status, 200, 'another address is not held up');
    // The same address can still sign in, and the accept route has its own limit (a wrong version is 409, never 429).
    const who = await signIn(null, 'admin', ADMIN_PASSWORD, { from: a });
    assert.equal((await agree(null, who.cookie, { terms: 'wrong' }, { from: a })).status, 409);
    assert.equal((await call(null, 'GET', '/api/branding', { from: a })).status, 200);
  });

  await test('an account that has not agreed can still sign in as someone else, and the health check answers', async () => {
    const who = await signIn(null, 'admin', ADMIN_PASSWORD);
    assert.ok(isAsked(await call(null, 'GET', '/api/me', { cookie: who.cookie })));
    const again = await call(null, 'POST', '/api/login', { cookie: who.cookie, body: { login: 'admin', password: ADMIN_PASSWORD }, from: nextIp() });
    assert.equal(again.status, 200, again.text);
    const wrong = await call(null, 'POST', '/api/login', { cookie: who.cookie, body: { login: 'admin', password: 'nope' }, from: nextIp() });
    assert.equal(wrong.status, 401);
    for (const method of ['GET', 'HEAD']) {
      const h = await call(null, method, '/healthz', { cookie: who.cookie });
      assert.equal(h.status, 200, method);
      if (method === 'GET') assert.deepEqual(h.json, { ok: true });
    }
    assert.ok(isAsked(await call(null, 'POST', '/healthz', { cookie: who.cookie })));
    assert.ok(isAsked(await call(null, 'GET', '/api/me', { cookie: who.cookie })), 'still refused everywhere else');
  });

  await test('nobody signed in: the texts are open, exactly as written and as JSON; nothing else changes', async () => {
    const texts = await call(null, 'GET', '/api/agreements');
    assert.equal(texts.status, 200);
    assert.match(texts.headers['content-type'], /^application\/json/);
    assert.equal(texts.headers['cache-control'], 'no-store');
    assert.deepEqual(texts.json, { required: true, docs: [{ id: 'terms', title: 'Terms of service', version: V1.terms, text: TERMS_1 }, { id: 'nda', title: 'Beta NDA', version: V1.nda, text: NDA_1 }] });
    // Only the texts the server was started with: nothing in a request names a file.
    for (const q of ['?file=/etc/passwd', '?TERMS_FILE=/etc/passwd', '?id=../../app.json', '?doc=nda', '/..%2f..%2fapp.json']) {
      const res = await call(null, 'GET', `/api/agreements${q}`);
      if (res.status === 200) assert.deepEqual(res.json, texts.json, q); else assert.equal(res.status, 404, q);
      assert.ok(!res.text.includes('root:'), q);
    }
    const me = await call(null, 'GET', '/api/me');
    assert.equal(me.status, 401);
    assert.deepEqual(me.json, { error: 'sign in first' }, 'signed out is told to sign in, not to agree');
    assert.equal((await call(null, 'GET', '/api/branding')).status, 200);
    assert.equal((await call(null, 'GET', '/login', { headers: { accept: 'text/html' } })).status, 200);
    assert.equal((await call(null, 'GET', '/healthz')).status, 200);
    const accept = await call(null, 'POST', '/api/agreements/accept', { body: { versions: V1 } });
    assert.equal(accept.status, 401);
    assert.deepEqual(accept.json, { error: 'sign in first' });
    // The agreement page is for an account: signed out goes to sign in, keeping only a path on this site.
    for (const [q, to] of [['', '/login'], ['?next=/profile', '/login?next=%2Fprofile'], ['?next=//evil.example', '/login'], ['?next=/.//evil.example', '/login'], ['?next=https://evil.example', '/login'], ['?next[]=/x', '/login']]) {
      const res = await call(null, 'GET', `/agree${q}`, { headers: { accept: 'text/html' } });
      assert.equal(res.status, 302, q);
      assert.equal(res.headers.location, to, q);
    }
    // A session nobody here signed is nobody.
    const forged = `app_session=${auth.issueSession('not-this-servers-secret', { key: 'abcd1234', passwordHash: 'x', linkToken: null })}`;
    assert.equal((await call(null, 'POST', '/api/agreements/accept', { cookie: forged, body: { versions: V1 } })).status, 401);
    assert.equal((await call(null, 'GET', '/api/me', { cookie: forged })).status, 401);
  });

  await test('the admin of a single-environment server is asked like everyone: refused everywhere but the agreement', async () => {
    people.admin = await signIn(null, 'admin', ADMIN_PASSWORD);
    assert.equal((await call(null, 'GET', '/api/agreements', { cookie: people.admin.cookie })).json.required, true);
    await refusedEverywhere(null, people.admin, 'admin');
    await openToThem(null, people.admin, 'admin');
  });

  await test('a page: the redirect keeps only a path on this site, a frame is told in place, and the agreement page is the step page', async () => {
    const html = { accept: 'text/html' };
    for (const [route, next] of [['//evil.example/x', '/'], ['/\\evil.example', '/'], ['/.//evil.example', '/'], ['/a/..//evil.example', '/'], ['/profile?x=1&next=//evil.example', '/profile?x=1&next=//evil.example']]) {
      const res = await call(null, 'GET', route, { cookie: people.admin.cookie, headers: html });
      assert.equal(res.status, 302, route);
      assert.equal(res.headers.location, `/agree?next=${encodeURIComponent(next)}`, route);
    }
    const framed = await call(null, 'GET', '/profile', { cookie: people.admin.cookie, headers: { ...html, 'sec-fetch-dest': 'iframe' } });
    assert.equal(framed.status, 403);
    assert.match(framed.headers['content-type'], /^text\/html/);
    assert.ok(framed.text.includes(AGREE_FIRST));
    assert.equal(framed.headers['x-frame-options'], 'SAMEORIGIN');
    // Without Accept: text/html (a script's fetch, a picture, curl) a page's address answers the JSON refusal.
    assert.ok(isAsked(await call(null, 'GET', '/profile', { cookie: people.admin.cookie, headers: { accept: '*/*' } })));
    const page = await call(null, 'GET', '/agree?next=/profile', { cookie: people.admin.cookie, headers: html });
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /^text\/html/);
    assert.equal(page.headers['x-frame-options'], 'SAMEORIGIN', 'framed by this site only, as the sign-in pages are');
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.equal(page.text, fs.readFileSync(path.join(ROOT, 'public', 'login-step.html'), 'utf8'), 'the step page, as it is');
    assert.ok(!page.text.includes('alert(1)') && !page.text.includes('Be kind'), 'the server never writes a text into a page');
    if (!/agree/i.test(fs.readFileSync(path.join(ROOT, 'public', 'login-step.js'), 'utf8'))) notes.push('/agree serves the step page, which has no agreement panel yet (step 2 of the plan): until then a person can agree only through the API.');
  });

  await test('agreeing: recorded with each text\'s version and the time, once; then everything answers as before', async () => {
    const c = people.admin.cookie;
    // A refusal records nothing: from another site, and with a version that is not the current one.
    assert.equal((await agree(null, c, V1, { headers: { origin: 'http://evil.example' } })).status, 403);
    assert.equal((await agree(null, c, { terms: V1.terms, nda: sha16('another text') })).status, 409);
    assert.ok(!('agreed' in onDisk(single, 'admin')) && isAsked(await call(null, 'GET', '/api/me', { cookie: c })), 'still asked, nothing recorded');
    const before = Date.now();
    const res = await agree(null, c, V1);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.json.ok, true);
    assert.deepEqual(res.json.agreed.map((a) => [a.doc, a.version]), [['terms', V1.terms], ['nda', V1.nda]]);
    const kept = onDisk(single, 'admin').agreed;
    assert.deepEqual(kept, res.json.agreed);
    for (const a of kept) {
      assert.deepEqual(Object.keys(a), ['doc', 'version', 'at']);
      assert.equal(new Date(a.at).toISOString(), a.at);
      assert.ok(Date.parse(a.at) >= before - 1000 && Date.parse(a.at) <= Date.now() + 1000, 'the time it was agreed');
    }
    const again = await agree(null, c, V1);
    assert.equal(again.status, 200);
    assert.deepEqual(onDisk(single, 'admin').agreed, kept, 'agreeing again adds nothing and keeps the first time');
    const me = await call(null, 'GET', '/api/me', { cookie: c });
    assert.equal(me.status, 200, me.text);
    assert.ok(!('agreed' in me.json.user), 'the record is not part of what an account answers');
    assert.equal((await call(null, 'GET', '/api/agreements', { cookie: c })).json.required, false);
    for (const route of ['/api/spaces', '/api/presence', '/api/settings', '/api/users', '/api/config', '/healthz']) assert.equal((await call(null, 'GET', route, { cookie: c })).status, 200, route);
    for (const route of ['/', '/profile', '/admin']) assert.equal((await call(null, 'GET', route, { cookie: c, headers: { accept: 'text/html' } })).status, 200, route);
    assert.equal((await call(null, 'GET', '/api/me', { bearer: people.admin.token })).status, 200, 'the bearer token too');
    // With nothing left to agree to, the agreement page goes on to `next`, kept to this site.
    for (const [q, to] of [['', '/'], ['?next=/profile', '/profile'], ['?next=//evil.example', '/'], ['?next=/.//evil.example', '/'], ['?next=/agree', '/agree']]) {
      const page = await call(null, 'GET', `/agree${q}`, { cookie: c, headers: { accept: 'text/html' } });
      assert.equal(page.status, 302, q);
      assert.equal(page.headers.location, to, q);
    }
    accessKey = (await call(null, 'GET', '/api/settings', { cookie: c })).json.streamKey;
    assert.ok(accessKey, 'the admin reads the access key');
    spaceId = (await call(null, 'POST', '/api/spaces', { cookie: c, body: { name: 'Camp' } })).json.space.id;
    assert.ok(spaceId);
  });

  // The other roles: made by the admin, each asked at their first sign-in.
  const PASSWORD = 'check-agreements-person-1';
  const makePerson = async (login, role = 'member', extra = {}) => {
    const res = await call(null, 'POST', '/api/users', { cookie: people.admin.cookie, body: { login, displayName: login, role, password: PASSWORD, ...extra } });
    assert.equal(res.status, 201, res.text);
    return res.json.user;
  };

  await test('agreeing: refused from another site, without the exact current versions, and over 1 KB; nothing is recorded by a refusal', async () => {
    // Two people, so the tries of one test stay under the limit on agreeing (20 a person).
    await makePerson('fussy');
    await makePerson('fussier');
    const c = (await signIn(null, 'fussy', PASSWORD)).cookie;
    const c2 = (await signIn(null, 'fussier', PASSWORD)).cookie;
    const post = (opts, cookie = c) => call(null, 'POST', '/api/agreements/accept', { cookie, ...opts });
    for (const headers of [{ origin: 'http://evil.example' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site', origin: 'http://other.localhost' }]) {
      const res = await post({ body: { versions: V1 }, headers });
      assert.equal(res.status, 403, JSON.stringify(headers));
      assert.deepEqual(res.json, { error: ORIGIN_SENTENCE });
    }
    for (const body of [undefined, {}, { versions: null }, { versions: 'all' }, { versions: [V1.terms, V1.nda] }, { versions: 7 }, { versions: true }, [V1]]) {
      const res = await post({ body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(res.json, { error: NO_VERSIONS }, JSON.stringify(body));
    }
    // A body that is not JSON is not read at all.
    for (const type of ['text/plain', 'application/x-www-form-urlencoded']) {
      const res = await post({ body: JSON.stringify({ versions: V1 }), type });
      assert.equal(res.status, 400, type);
      assert.deepEqual(res.json, { error: NO_VERSIONS }, type);
    }
    assert.equal((await post({ body: '{"versions":', type: 'application/json' })).status, 400, 'bad JSON');
    for (const versions of [{}, { terms: V1.terms }, { nda: V1.nda }, { terms: V1.terms, nda: sha16('x') }, { terms: sha16(TERMS_2), nda: V1.nda }, { ...V1, more: 'x' }, { terms: V1.terms.toUpperCase(), nda: V1.nda },
      { terms: [V1.terms], nda: V1.nda }, { terms: V1.terms, nda: { $ne: null } }, { terms: true, nda: true }, { TERMS: V1.terms, NDA: V1.nda }, JSON.parse(`{"terms":"${V1.terms}","nda":"${V1.nda}","__proto__":{"x":1}}`)]) {
      const res = await post({ body: { versions } }, c2);
      assert.equal(res.status, 409, JSON.stringify(versions));
      assert.deepEqual(res.json, { error: CHANGED }, JSON.stringify(versions));
    }
    const big = await post({ body: { versions: V1, pad: 'x'.repeat(1100) } });
    assert.equal(big.status, 413);
    assert.deepEqual(big.json, { error: 'that request is over 1 KB' });
    const huge = await post({ body: { versions: V1, pad: 'x'.repeat(70000) } });
    assert.equal(huge.status, 413);
    for (const [login, cookie] of [['fussy', c], ['fussier', c2]]) {
      assert.ok(isAsked(await call(null, 'GET', '/api/me', { cookie })), `${login} is still asked`);
      assert.ok(!('agreed' in onDisk(single, login)), `nothing recorded for ${login}`);
    }
  });

  await test('a member, a moderator and an owner: each is refused before agreeing and allowed after, in what their role opens', async () => {
    const cases = [
      ['member', 'member', '/api/spaces', async () => {}],
      ['moderator', 'member', null, async (user) => {
        const space = await call(null, 'PATCH', `/api/spaces/${spaceId}`, { cookie: people.admin.cookie, body: { members: [user.key] } });
        assert.equal(space.status, 200, space.text);
        const tick = await call(null, 'PATCH', `/api/users/${user.key}/spaces/${spaceId}`, { cookie: people.admin.cookie, body: { permissions: { moderator: true } } });
        assert.equal(tick.status, 200, tick.text);
      }],
      ['owner', 'owner', '/api/users', async () => {}],
    ];
    for (const [name, role, own, setUp] of cases) {
      const user = await makePerson(name, role);
      await setUp(user);
      const route = own || `/api/spaces/${spaceId}`; // a moderator's own read: Set up's, of the space they moderate
      people[name] = await signIn(null, name, PASSWORD);
      assert.equal(people[name].key, user.key);
      await refusedEverywhere(null, people[name], name);
      await openToThem(null, people[name], name);
      assert.ok(isAsked(await call(null, 'GET', route, { cookie: people[name].cookie })), `${name}: ${route}`);
      assert.ok(!('agreed' in onDisk(single, name)));
      const res = await agree(null, people[name].cookie, V1);
      assert.equal(res.status, 200, `${name}: ${res.text}`);
      assert.equal((await call(null, 'GET', '/api/me', { cookie: people[name].cookie })).status, 200, name);
      const opened = await call(null, 'GET', route, { cookie: people[name].cookie });
      assert.equal(opened.status, 200, `${name}: ${route} ${opened.text.slice(0, 120)}`);
      assert.equal(onDisk(single, name).agreed.length, 2);
    }
    // What a role does not open stays shut after agreeing: the gate adds nothing.
    assert.equal((await call(null, 'GET', '/api/users', { cookie: people.member.cookie })).status, 403);
    assert.ok(!isAsked(await call(null, 'GET', '/api/users', { cookie: people.member.cookie })));
  });

  await test('an agreement is recorded for the one who asked and nobody else, whatever the body names, and no other route writes it', async () => {
    const target = await makePerson('target');
    people.target = await signIn(null, 'target', PASSWORD);
    const sender = await makePerson('sender');
    people.sender = await signIn(null, 'sender', PASSWORD);
    const named = { versions: V1, key: target.key, user: target.key, userKey: target.key, login: 'target', for: target.key, guest: 'guest-abcd1234', name: '<b>Somebody else</b>', agreed: [{ doc: 'terms', version: V1.terms, at: '2020-01-01T00:00:00.000Z' }] };
    const res = await call(null, 'POST', `/api/agreements/accept?key=${target.key}&user=${target.key}`, { cookie: people.sender.cookie, body: named });
    assert.equal(res.status, 200, res.text);
    assert.equal(onDisk(single, 'sender').agreed.length, 2, 'the sender agreed');
    assert.ok(onDisk(single, 'sender').agreed.every((a) => a.at !== '2020-01-01T00:00:00.000Z'), 'the time is the server\'s, never the body\'s');
    assert.ok(!('agreed' in onDisk(single, 'target')), 'the one named did not');
    assert.ok(isAsked(await call(null, 'GET', '/api/me', { cookie: people.target.cookie })));
    // An owner and the admin cannot agree for someone either: no route that changes an account takes it.
    const record = [{ doc: 'terms', version: V1.terms, at: new Date().toISOString() }, { doc: 'nda', version: V1.nda, at: new Date().toISOString() }];
    for (const who of ['owner', 'admin']) {
      const patched = await call(null, 'PATCH', `/api/users/${target.key}`, { cookie: people[who].cookie, body: { displayName: 'Target', agreed: record } });
      assert.equal(patched.status, 200, patched.text);
      assert.ok(!('agreed' in patched.json.user));
      await call(null, 'PATCH', `/api/users/${target.key}/spaces/${spaceId}`, { cookie: people[who].cookie, body: { agreed: record, permissions: {} } });
    }
    const made = await makePerson('madewith', 'member', { agreed: record });
    assert.ok(!('agreed' in onDisk(single, 'target')) && !('agreed' in onDisk(single, 'madewith')), 'still nothing recorded for either');
    assert.ok(isAsked(await call(null, 'GET', '/api/me', { cookie: people.target.cookie })));
    assert.ok(isAsked(await call(null, 'GET', '/api/me', { cookie: (await signIn(null, 'madewith', PASSWORD)).cookie })));
    assert.ok(made.key);
    assert.deepEqual(guestFiles(single), [], 'a guest named in a body is not recorded: nothing writes guests\' agreements yet');
  });

  await test('the access key is never asked; a session that has not agreed is refused even when it carries the key or a guest link', async () => {
    const k = `s=${encodeURIComponent(accessKey)}`;
    for (const route of [`/img/${people.admin.key}/profile?${k}`, `/api/status?${k}`, `/view/${people.admin.key}?${k}`]) {
      const res = await call(null, 'GET', route, { headers: { accept: '*/*' } });
      assert.equal(res.status, 200, `${route}: ${res.status} ${res.text.slice(0, 100)}`);
    }
    assert.equal((await call(null, 'GET', '/api/status', { headers: { 'x-stream-key': accessKey } })).status, 200, 'the key as a header');
    // The key in the hands of an account that has not agreed opens nothing while that session is sent.
    for (const route of [`/img/${people.admin.key}/profile?${k}`, `/api/status?${k}`, `/view/${people.admin.key}?${k}`]) {
      assert.ok(isAsked(await call(null, 'GET', route, { cookie: people.target.cookie, headers: { accept: '*/*' } })), route);
    }
    assert.ok(isAsked(await call(null, 'GET', '/api/status', { cookie: people.target.cookie, headers: { 'x-stream-key': accessKey } })));
    // A guest link (left for step 4 of the plan, pinned): no account, so not asked yet; with such a session, refused.
    const link = await call(null, 'POST', `/api/spaces/${spaceId}/guest-link`, { cookie: people.admin.cookie });
    assert.equal(link.status, 200, link.text);
    const token = link.json.space?.guestToken || link.json.guestToken;
    assert.ok(token, link.text);
    const open = await call(null, 'GET', `/api/guest-link/${token}`);
    assert.equal(open.status, 200, 'a guest link is not asked until the guest session exists (step 4)');
    const join = await call(null, 'POST', '/api/guest-join', { body: { token, name: 'Guest' } });
    assert.equal(join.status, 200, join.text);
    notes.push('A guest link is not asked yet: guests go through the gate with the guest session (step 4 of the plan).');
    assert.ok(isAsked(await call(null, 'GET', `/api/guest-link/${token}`, { cookie: people.target.cookie })));
    assert.ok(isAsked(await call(null, 'GET', `/img/guest/player?guest=${token}`, { cookie: people.target.cookie })));
    assert.ok(isAsked(await call(null, 'GET', `/api/presence?guest=${token}`, { cookie: people.target.cookie })));
  });

  await test('every way in ends at the gate: a personal link, sign-up, an invite', async () => {
    // A personal link signs in and sends to /, which sends to the agreement page.
    const linked = await call(null, 'POST', `/api/users/${people.target.key}/link`, { cookie: people.admin.cookie });
    assert.equal(linked.status, 200, linked.text);
    const linkPath = new URL(linked.json.user.link).pathname;
    const viaLink = await call(null, 'GET', linkPath, { headers: { accept: 'text/html' } });
    assert.equal(viaLink.status, 302);
    assert.ok(sessionOf(viaLink), 'the personal link signs in');
    people.target = { ...people.target, cookie: sessionOf(viaLink) }; // the new link ended the older session
    assert.ok(isAsked(await call(null, 'GET', '/api/me', { cookie: people.target.cookie })));
    const home = await call(null, 'GET', '/', { cookie: people.target.cookie, headers: { accept: 'text/html' } });
    assert.equal(home.headers.location, '/agree?next=%2F');
    // Sign-up, once an owner turns it on.
    assert.equal((await call(null, 'PATCH', '/api/settings', { cookie: people.admin.cookie, body: { allowRegistration: true } })).status, 200);
    const signedUp = await call(null, 'POST', '/api/register', { body: { login: 'newcomer', displayName: 'Newcomer', password: PASSWORD } });
    assert.equal(signedUp.status, 201, signedUp.text);
    assert.ok(isAsked(await call(null, 'GET', '/api/me', { cookie: sessionOf(signedUp) })), 'a new account is asked at once');
    // An invite.
    const invite = await call(null, 'POST', '/api/invites', { cookie: people.admin.cookie, body: { spaces: [spaceId] } });
    assert.equal(invite.status, 201, invite.text);
    const invited = await call(null, 'POST', `/api/invites/${invite.json.invite.token}/accept`, { body: { login: 'invited', displayName: 'Invited', password: PASSWORD } });
    assert.equal(invited.status, 201, invited.text);
    assert.ok(isAsked(await call(null, 'GET', '/api/me', { cookie: sessionOf(invited) })));
    assert.ok(isAsked(await call(null, 'GET', `/api/spaces/${spaceId}/chat`, { cookie: sessionOf(invited) })), 'not even the space they were invited to');
  });

  await test('signing out stays open to someone who has not agreed', async () => {
    const who = await signIn(null, 'target', PASSWORD);
    const page = await call(null, 'GET', '/logout', { cookie: who.cookie, headers: { accept: 'text/html' } });
    assert.equal(page.status, 302);
    assert.equal(page.headers.location, '/login');
    assert.equal(page.jar.app_session, '', 'the cookie is cleared');
    const out = await call(null, 'POST', '/api/logout', { cookie: who.cookie });
    assert.equal(out.status, 200);
    assert.deepEqual(out.json, { ok: true });
    assert.equal(out.jar.app_session, '');
    assert.equal((await call(null, 'POST', '/api/logout', { cookie: who.cookie, headers: { origin: 'http://evil.example' } })).status, 403, 'from another site it is refused, as every write is');
  });

  await test('agreeing is limited: 20 tries in 15 minutes a person, then 429, and nobody else is held up', async () => {
    await makePerson('hasty');
    const hasty = await signIn(null, 'hasty', PASSWORD);
    for (let i = 0; i < 20; i += 1) {
      const res = await agree(null, hasty.cookie, { terms: V1.terms });
      assert.equal(res.status, 409, `try ${i + 1}: ${res.text}`);
    }
    for (const body of [{ versions: V1 }, { versions: { terms: V1.terms } }, {}]) {
      const res = await call(null, 'POST', '/api/agreements/accept', { cookie: hasty.cookie, body });
      assert.equal(res.status, 429, JSON.stringify(body));
      assert.deepEqual(res.json, { error: 'too many attempts, try again in a few minutes' });
    }
    assert.equal((await call(null, 'POST', '/api/agreements/accept', { cookie: hasty.cookie, body: { versions: V1 }, from: nextIp() })).status, 429, 'another address is the same person');
    assert.ok(!('agreed' in onDisk(single, 'hasty')), 'the correct versions past the limit record nothing');
    assert.ok(isAsked(await call(null, 'GET', '/api/me', { cookie: hasty.cookie })));
    // Signed out costs nobody anything, and another person agrees as usual.
    for (let i = 0; i < 25; i += 1) assert.equal((await call(null, 'POST', '/api/agreements/accept', { body: { versions: V1 } })).status, 401);
    await makePerson('patient');
    const patient = await signIn(null, 'patient', PASSWORD);
    assert.equal((await agree(null, patient.cookie, V1)).status, 200);
  });

  await test('two-step sign-in: someone who agreed sets it up, for the code step after the text changes', async () => {
    await makePerson('twostep');
    const who = await signIn(null, 'twostep', PASSWORD);
    assert.ok(isAsked(await call(null, 'POST', '/api/me/mfa/start', { cookie: who.cookie })), 'not before agreeing');
    assert.equal((await agree(null, who.cookie, V1)).status, 200);
    const started = await call(null, 'POST', '/api/me/mfa/start', { cookie: who.cookie });
    assert.equal(started.status, 200, started.text);
    const enabled = await call(null, 'POST', '/api/me/mfa/enable', { cookie: who.cookie, body: { code: auth.totpCode(started.json.secret) } });
    assert.equal(enabled.status, 200, enabled.text);
    recoveryCode = enabled.json.recoveryCodes[0];
    assert.ok(recoveryCode);
  });

  await test('nothing wrote a guests\' agreements file, and no answer or log line carried a text but the texts route', async () => {
    assert.deepEqual(guestFiles(single), []);
    assert.ok(!server.output().includes('Be kind'), 'a text is never logged');
  });

  // --- a restart with the same texts: the record is kept ---------------------------------------------------------------
  await server.stop();
  server = await startServer(single, { ADMIN_PASSWORD, TERMS_FILE: termsFile, NDA_FILE: ndaFile });
  await test('the record survives a restart: those who agreed are not asked again, those who did not still are', async () => {
    for (const name of ['admin', 'member', 'moderator', 'owner', 'sender']) {
      assert.equal((await call(null, 'GET', '/api/me', { cookie: people[name].cookie })).status, 200, name);
    }
    assert.ok(isAsked(await call(null, 'GET', '/api/me', { cookie: people.target.cookie })), 'target');
    assert.equal(onDisk(single, 'admin').agreed.length, 2);
  });

  // --- a restart with a changed text: everyone is asked again -----------------------------------------------------------
  await server.stop();
  fs.writeFileSync(termsFile, TERMS_2);
  server = await startServer(single, { ADMIN_PASSWORD, TERMS_FILE: termsFile, NDA_FILE: ndaFile });
  const V2 = { terms: sha16(TERMS_2), nda: V1.nda };
  await test('a changed text asks again: a session already open is refused, the old versions are refused, the new ones recorded beside the old', async () => {
    assert.notEqual(V2.terms, V1.terms);
    const texts = await call(null, 'GET', '/api/agreements', { cookie: people.admin.cookie });
    assert.deepEqual(texts.json.docs.map((d) => [d.id, d.version, d.text]), [['terms', V2.terms, TERMS_2], ['nda', V1.nda, NDA_1]]);
    assert.equal(texts.json.required, true);
    for (const name of ['admin', 'member', 'moderator', 'owner']) {
      assert.ok(isAsked(await call(null, 'GET', '/api/me', { cookie: people[name].cookie })), `${name}: the session from before the change`);
    }
    await refusedEverywhere(null, people.owner, 'owner, after the text changed');
    assert.ok(isAsked(await call(null, 'GET', '/api/me', { bearer: people.admin.token })), 'the bearer token from before the change');
    const old = await agree(null, people.admin.cookie, V1);
    assert.equal(old.status, 409, 'the versions agreed before are not the current ones');
    assert.deepEqual(old.json, { error: CHANGED });
    assert.ok(isAsked(await call(null, 'GET', '/api/me', { cookie: people.admin.cookie })));
    const res = await agree(null, people.admin.cookie, V2);
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.json.agreed.map((a) => [a.doc, a.version]), [['nda', V1.nda], ['terms', V2.terms]], 'the answer names the current ones');
    assert.deepEqual(onDisk(single, 'admin').agreed.map((a) => [a.doc, a.version]), [['terms', V1.terms], ['nda', V1.nda], ['terms', V2.terms]], 'the older agreement is kept');
    assert.equal((await call(null, 'GET', '/api/me', { cookie: people.admin.cookie })).status, 200);
    assert.ok(isAsked(await call(null, 'GET', '/api/me', { cookie: people.member.cookie })), 'one person agreeing is not another');
  });

  await test('every way in ends at the gate: the code step', async () => {
    const first = await call(null, 'POST', '/api/login', { body: { login: 'twostep', password: PASSWORD }, from: nextIp() });
    assert.equal(first.status, 200, first.text);
    assert.equal(first.json.mfaRequired, true);
    assert.ok(!sessionOf(first), 'no session before the code');
    const pending = `mfa_pending=${first.jar.mfa_pending}`;
    const second = await call(null, 'POST', '/api/login/verify', { cookie: pending, body: { code: recoveryCode }, from: nextIp() });
    assert.equal(second.status, 200, second.text);
    assert.ok(sessionOf(second));
    assert.ok(isAsked(await call(null, 'GET', '/api/me', { cookie: sessionOf(second) })), 'signed in by the code step, and asked');
    assert.equal((await agree(null, sessionOf(second), V2)).status, 200);
    assert.equal((await call(null, 'GET', '/api/me', { cookie: sessionOf(second) })).status, 200);
  });

  // --- a restart with one text taken away: only what is set is asked ---------------------------------------------------
  await server.stop();
  server = await startServer(single, { ADMIN_PASSWORD, NDA_FILE: ndaFile });
  await test('one text set: only that one is asked, and those who agreed to it are not asked again', async () => {
    const texts = await call(null, 'GET', '/api/agreements');
    assert.deepEqual(texts.json.docs.map((d) => d.id), ['nda']);
    assert.ok(!texts.text.includes('Be kind'), 'a text that is no longer set is not answered');
    for (const name of ['admin', 'member', 'owner']) assert.equal((await call(null, 'GET', '/api/me', { cookie: people[name].cookie })).status, 200, `${name} agreed to this version of the NDA`);
    assert.ok(isAsked(await call(null, 'GET', '/api/me', { cookie: people.target.cookie })), 'target never agreed');
    assert.equal((await agree(null, people.target.cookie, V2)).status, 409, 'a text that is not asked cannot be agreed to');
    assert.equal((await agree(null, people.target.cookie, { nda: V1.nda })).status, 200);
    assert.deepEqual(onDisk(single, 'target').agreed.map((a) => a.doc), ['nda']);
    assert.equal((await call(null, 'GET', '/api/me', { cookie: people.target.cookie })).status, 200);
  });
} finally {
  if (server) await server.stop();
  server = null;
}

// --- a hosted server: two environments, the host console, the product host --------------------------------------------
const hosted = fs.mkdtempSync(path.join(tmp, 'hosted-'));
fs.writeFileSync(termsFile, TERMS_1);
try {
  server = await startServer(hosted, { BASE_DOMAIN: 'localhost', SIGNUP: 'on', ADMIN_LOGIN: HOST_LOGIN, ADMIN_PASSWORD: HOST_PASSWORD, TERMS_FILE: termsFile, NDA_FILE: ndaFile });
  const OWNER_PASSWORD = 'check-agreements-owner-1';
  const envDir = (slug) => path.join(hosted, 'environments', slug);
  let hostCookie = null;
  const owners = {};

  await test('a hosted server: the host console and the product host have no agreement routes and are never asked', async () => {
    assert.ok(server.output().includes("Every account agrees before entering, except the host admin's."), server.output());
    const login = await call('admin', 'POST', '/api/host/login', { body: { login: HOST_LOGIN, password: HOST_PASSWORD }, from: nextIp() });
    assert.equal(login.status, 200, login.text);
    hostCookie = login.setCookies.map((c) => c.split(';')[0]).join('; ');
    for (const slug of ['aaa', 'bbb']) {
      const made = await call('admin', 'POST', '/api/host/environments', { cookie: hostCookie, body: { slug, name: `Env ${slug}`, plan: { modules: 'all' }, owner: { login: 'olive', displayName: 'Olive', password: OWNER_PASSWORD } } });
      assert.equal(made.status, 201, made.text);
    }
    assert.equal((await call('admin', 'GET', '/api/host/environments', { cookie: hostCookie })).status, 200, 'the console is the host\'s: never asked');
    for (const host of ['admin', '']) {
      for (const [method, route] of [['GET', '/api/agreements'], ['POST', '/api/agreements/accept'], ['GET', '/agree']]) {
        const res = await call(host, method, route, { cookie: host === 'admin' ? hostCookie : undefined, body: method === 'POST' ? { versions: V1 } : undefined });
        assert.equal(res.status, 404, `${host || 'the product host'}: ${method} ${route}`);
        assert.ok(!res.text.includes('Be kind'));
      }
    }
  });

  await test('two environments: the same texts, each its own record; agreeing in one says nothing in the other', async () => {
    for (const slug of ['aaa', 'bbb']) {
      const texts = await call(slug, 'GET', '/api/agreements');
      assert.deepEqual(texts.json, { required: true, docs: [{ id: 'terms', title: 'Terms of service', version: V1.terms, text: TERMS_1 }, { id: 'nda', title: 'Beta NDA', version: V1.nda, text: NDA_1 }] }, slug);
      owners[slug] = await signIn(slug, 'olive', OWNER_PASSWORD);
      assert.ok(isAsked(await call(slug, 'GET', '/api/me', { cookie: owners[slug].cookie })), slug);
    }
    await refusedEverywhere('aaa', owners.aaa, 'an owner at aaa');
    await openToThem('aaa', owners.aaa, 'an owner at aaa');
    // One environment's session is nobody at the other: it can neither read nor agree there.
    assert.equal((await call('bbb', 'GET', '/api/me', { cookie: owners.aaa.cookie })).status, 401);
    assert.equal((await agree('bbb', owners.aaa.cookie, V1)).status, 401);
    assert.equal((await call('bbb', 'GET', '/api/me', { bearer: owners.aaa.token })).status, 401);
    const res = await agree('aaa', owners.aaa.cookie, V1);
    assert.equal(res.status, 200, res.text);
    assert.equal((await call('aaa', 'GET', '/api/me', { cookie: owners.aaa.cookie })).status, 200);
    assert.equal(onDisk(envDir('aaa'), 'olive').agreed.length, 2);
    assert.ok(!('agreed' in onDisk(envDir('bbb'), 'olive')), 'the same login at another environment has agreed to nothing');
    assert.ok(isAsked(await call('bbb', 'GET', '/api/me', { cookie: owners.bbb.cookie })));
    await refusedEverywhere('bbb', owners.bbb, 'an owner at bbb, after the one at aaa agreed');
    assert.equal((await call('bbb', 'GET', '/api/agreements', { cookie: owners.bbb.cookie })).json.required, true);
    assert.equal((await call('aaa', 'GET', '/api/agreements', { cookie: owners.aaa.cookie })).json.required, false);
    // Nothing of aaa's is under bbb's folder, and nothing of either at the host's root.
    assert.ok(!JSON.stringify(appJson(envDir('bbb'))).includes(owners.aaa.key) || owners.aaa.key === owners.bbb.key);
    assert.ok(!fs.readFileSync(path.join(hosted, 'host.json'), 'utf8').includes('"agreed"'), 'host.json holds no agreement');
    assert.deepEqual(guestFiles(hosted), []);
    // The limit on agreeing is each environment's own: a person held up at bbb holds nobody up at aaa.
    for (let i = 0; i < 20; i += 1) assert.equal((await agree('bbb', owners.bbb.cookie, { terms: V1.terms })).status, 409);
    assert.equal((await agree('bbb', owners.bbb.cookie, V1)).status, 429);
    assert.equal((await agree('aaa', owners.aaa.cookie, V1)).status, 200);
  });

  await test('the host admin\'s stand-in is never asked, and is the only account that is not', async () => {
    const cross = await call('bbb', 'POST', '/api/login', { body: { login: HOST_LOGIN, password: HOST_PASSWORD }, from: nextIp() });
    assert.equal(cross.status, 200, cross.text);
    const standIn = { cookie: sessionOf(cross), token: cross.json.token };
    const me = await call('bbb', 'GET', '/api/me', { cookie: standIn.cookie });
    assert.equal(me.status, 200, me.text);
    assert.equal(me.json.environment.hostAdmin, true);
    assert.equal(me.json.user.hostAdmin, true);
    for (const route of ['/api/users', '/api/settings', '/api/spaces']) assert.equal((await call('bbb', 'GET', route, { bearer: standIn.token })).status, 200, route);
    assert.equal((await call('bbb', 'GET', '/', { cookie: standIn.cookie, headers: { accept: 'text/html' } })).status, 200);
    assert.equal((await call('bbb', 'GET', '/api/agreements', { cookie: standIn.cookie })).json.required, false);
    assert.equal((await call('bbb', 'GET', '/agree?next=/admin', { cookie: standIn.cookie, headers: { accept: 'text/html' } })).headers.location, '/admin');
    assert.ok(!('agreed' in onDisk(envDir('bbb'), HOST_LOGIN)), 'nothing is recorded for it');
    // Being exempt is the host's to give: nothing an owner sends makes an account a stand-in.
    const made = await call('bbb', 'POST', '/api/users', { bearer: standIn.token, body: { login: 'pretender', displayName: 'Pretender', role: 'member', password: OWNER_PASSWORD, hostAdmin: true } });
    assert.equal(made.status, 201, made.text);
    await call('bbb', 'PATCH', `/api/users/${made.json.user.key}`, { bearer: standIn.token, body: { hostAdmin: true, displayName: 'Pretender' } });
    assert.equal(onDisk(envDir('bbb'), 'pretender').hostAdmin, false);
    assert.ok(isAsked(await call('bbb', 'GET', '/api/me', { cookie: (await signIn('bbb', 'pretender', OWNER_PASSWORD)).cookie })));
    // An owner is not exempt, whatever their rights.
    assert.ok(isAsked(await call('bbb', 'GET', '/api/me', { cookie: owners.bbb.cookie })));
  });

  await test('a restore: an owner\'s copy loses what it says people agreed to; the host\'s backup keeps it as written', async () => {
    const made = await call('admin', 'POST', '/api/host/environments', { cookie: hostCookie, body: { slug: 'eee', name: 'Env eee', plan: { modules: 'all' }, owner: { login: 'erin', displayName: 'Erin', password: OWNER_PASSWORD } } });
    assert.equal(made.status, 201, made.text);
    await signIn('eee', 'erin', OWNER_PASSWORD); // the environment is open, so app.json is written
    const backup = await call('admin', 'POST', '/api/host/environments/eee/backup', { cookie: hostCookie });
    assert.equal(backup.status, 200);
    const app = appJson(envDir('eee'));
    const agreed = [{ doc: 'terms', version: V1.terms, at: '2020-01-01T00:00:00.000Z' }, { doc: 'nda', version: V1.nda, at: '2020-01-01T00:00:00.000Z' }];
    for (const u of app.users) u.agreed = agreed;
    const guestFile = `${JSON.stringify({ agreements: [{ guest: 'guest-abcd1234', name: 'G', doc: 'terms', version: V1.terms, at: '2020-01-01T00:00:00.000Z' }] })}\n`;
    const zip = zipFiles([['app.json', Buffer.from(JSON.stringify(app))], ['agreements.json', Buffer.from(guestFile)]]);
    const restore = (query) => call('admin', 'POST', `/api/host/environments/eee/restore${query}`, { cookie: hostCookie, body: zip, type: 'application/zip' });
    const owner = await restore('');
    assert.equal(owner.status, 200, owner.text);
    assert.ok(appJson(envDir('eee')).users.length > 0);
    assert.ok(appJson(envDir('eee')).users.every((u) => !('agreed' in u)), 'no agreed from an owner\'s copy');
    assert.deepEqual(guestFiles(envDir('eee')), [], 'no agreements.json from an owner\'s copy');
    assert.ok(isAsked(await call('eee', 'GET', '/api/me', { cookie: (await signIn('eee', 'erin', OWNER_PASSWORD)).cookie })), 'everyone is asked again');
    const host = await restore('?backup=1');
    assert.equal(host.status, 200, host.text);
    assert.ok(appJson(envDir('eee')).users.every((u) => JSON.stringify(u.agreed) === JSON.stringify(agreed)), 'kept as written');
    assert.equal(fs.readFileSync(path.join(envDir('eee'), 'agreements.json'), 'utf8'), guestFile);
    assert.equal((await call('eee', 'GET', '/api/me', { cookie: (await signIn('eee', 'erin', OWNER_PASSWORD)).cookie })).status, 200);
  });

  await test('a restore with agreements.json as a folder is refused in one plain sentence and the environment stays healthy', async () => {
    const app = appJson(envDir('eee'));
    const zip = zipFiles([['app.json', Buffer.from(JSON.stringify(app))], ['agreements.json/inner.json', Buffer.from('{}')]]);
    for (const query of ['', '?backup=1']) {
      const res = await call('admin', 'POST', `/api/host/environments/eee/restore${query}`, { cookie: hostCookie, body: zip, type: 'application/zip' });
      assert.equal(res.status, 400, res.text);
      assert.deepEqual(res.json, { error: 'The agreements file in this copy is not a file.' });
      assert.ok(fs.statSync(path.join(envDir('eee'), 'agreements.json')).isFile(), 'nothing was replaced');
      assert.equal((await call('eee', 'GET', '/api/agreements')).status, 200);
      assert.equal((await call('eee', 'GET', '/api/branding')).status, 200);
      assert.equal((await signIn('eee', 'erin', OWNER_PASSWORD)).cookie.startsWith('app_session='), true);
    }
  });

  await test('the demo space: the loader\'s own requests are let through while it runs; nothing a client sends stands for them', async () => {
    // A fresh environment with a real owner who has not agreed, to ask as while the demo space is being added.
    const made = await call('admin', 'POST', '/api/host/environments', { cookie: hostCookie, body: { slug: 'ddd', name: 'Env ddd', plan: { modules: 'all' }, owner: { login: 'dora', displayName: 'Dora', password: OWNER_PASSWORD } } });
    assert.equal(made.status, 201, made.text);
    const dora = await signIn('ddd', 'dora', OWNER_PASSWORD);
    const forged = ['1', 'true', 'yes', 'host-demo', crypto.randomBytes(32).toString('base64url'), '', 'x'.repeat(43)];
    const stillAsked = async (when) => {
      for (const mark of forged) {
        for (const headers of [{ 'x-demo-run': mark }, { 'X-Demo-Run': mark, 'x-demo': '1', 'x-host-admin': '1', 'x-forwarded-for': '127.0.0.1' }]) {
          assert.ok(isAsked(await call('ddd', 'GET', '/api/me', { cookie: dora.cookie, headers })), `${when}: a forged mark ${JSON.stringify(mark)}`);
          assert.ok(isAsked(await call('ddd', 'POST', `/api/spaces/lobby/chat?demo=1&hostAdmin=true`, { cookie: dora.cookie, headers, body: { text: 'hello', demo: true, hostAdmin: true } })), `${when}: a forged mark posting chat`);
        }
      }
    };
    await stillAsked('before the run');
    const run = call('admin', 'POST', '/api/host/environments/ddd/demo', { cookie: hostCookie });
    // While it runs (a second ask is told to wait), a real account is still refused, whatever it sends.
    let during = 0;
    for (let i = 0; i < 200 && !during; i += 1) {
      await new Promise((done) => setTimeout(done, 25));
      const second = await call('admin', 'POST', '/api/host/environments/ddd/demo', { cookie: hostCookie });
      if (second.status === 409 && /is being added/.test(second.json?.error || '')) during += 1;
      else if (second.status !== 409) break;
    }
    assert.ok(during, 'the run was caught in progress');
    await stillAsked('during the run');
    assert.ok(isAsked(await call('ddd', 'GET', '/api/spaces', { cookie: dora.cookie })), 'during the run: no mark at all');
    assert.ok(isAsked(await call('bbb', 'GET', '/api/me', { cookie: owners.bbb.cookie })), 'during the run: another environment is as it was');
    const report = (await run);
    assert.equal(report.status, 200, report.text.slice(0, 300));
    assert.equal(report.json.demo, true);
    // Everything the loader wrote as the demo people went in: nothing was refused for want of an agreement.
    assert.ok(report.json.created.chat > 0, `the chat messages were posted: ${JSON.stringify(report.json.created)}`);
    assert.deepEqual(report.json.refused.filter((r) => r.module === 'chat'), [], 'no chat message was refused');
    assert.ok(!report.json.refused.some((r) => /Agree to the terms/.test(r.why || '')), JSON.stringify(report.json.refused).slice(0, 300));
    assert.ok(!report.text.includes('x-demo-run'), 'the answer names no mark');
    assert.ok(report.json.people.length > 0);
    // Afterwards: the mark is gone, a real account is refused, and a person who signs in as a demo person is asked.
    await stillAsked('after the run');
    for (const person of report.json.people) {
      const real = await signIn('ddd', person.login, person.password);
      assert.ok(isAsked(await call('ddd', 'GET', '/api/me', { cookie: real.cookie })), `${person.login}, signed in by a person, is asked`);
      assert.ok(isAsked(await call('ddd', 'POST', `/api/spaces/${report.json.space.id}/chat`, { cookie: real.cookie, body: { text: 'hello' } })), `${person.login} cannot post before agreeing`);
      assert.ok(!('agreed' in onDisk(envDir('ddd'), person.login)), `nothing was agreed for ${person.login}`);
      assert.equal(onDisk(envDir('ddd'), person.login).hostAdmin, false);
    }
    const mia = await signIn('ddd', report.json.people[0].login, report.json.people[0].password);
    assert.equal((await agree('ddd', mia.cookie)).status, 200, 'and agrees like anyone');
    assert.equal((await call('ddd', 'GET', '/api/me', { cookie: mia.cookie })).status, 200);
    // The mark is in no file and no log line; an account with the stand-in's name is an account like any other.
    assert.ok(!server.output().includes('x-demo-run'));
    const cross = await call('bbb', 'POST', '/api/login', { body: { login: HOST_LOGIN, password: HOST_PASSWORD }, from: nextIp() });
    const named = await call('bbb', 'POST', '/api/users', { bearer: cross.json.token, body: { login: 'host-demo', displayName: 'Host (demo)', role: 'member', password: OWNER_PASSWORD, hostAdmin: true, demo: true } });
    assert.equal(named.status, 201, named.text);
    assert.ok(isAsked(await call('bbb', 'GET', '/api/me', { cookie: (await signIn('bbb', 'host-demo', OWNER_PASSWORD)).cookie })), 'an account called host-demo is asked');
  });

  await test('every way in ends at the gate: the first password; its page is never redirected', async () => {
    const signup = await call('', 'POST', '/api/product/signup', { body: { slug: 'ccc', name: 'Env ccc', owner: { login: 'carol', displayName: 'Carol' } }, from: nextIp() });
    assert.equal(signup.status, 201, signup.text);
    const token = signup.json.url.split('#')[1];
    const exchange = await call('ccc', 'POST', '/api/login/first-password', { body: { token }, from: nextIp() });
    assert.equal(exchange.status, 200, exchange.text);
    const set = await call('ccc', 'POST', '/api/login/first-password/set', { cookie: `mfa_pending=${exchange.jar.mfa_pending}`, body: { login: 'carol', password: OWNER_PASSWORD }, from: nextIp() });
    assert.equal(set.status, 200, set.text);
    const carol = sessionOf(set);
    assert.ok(carol);
    assert.ok(isAsked(await call('ccc', 'GET', '/api/me', { cookie: carol })), 'a new owner is asked at once');
    // The first-password page holds the one-time token in its address: it is never redirected (plan-first-password.md).
    const page = await call('ccc', 'GET', '/login/first-password', { cookie: carol, headers: { accept: 'text/html' } });
    assert.notEqual(page.status, 302, 'never redirected');
    assert.ok(!page.headers.location);
    assert.ok(isAsked(await call('ccc', 'POST', '/api/login/first-password', { cookie: carol, body: { token: 'x' } })), 'what the page asks is refused as everything else is');
    assert.equal((await agree('ccc', carol)).status, 200);
    assert.equal((await call('ccc', 'GET', '/api/me', { cookie: carol })).status, 200);
  });
} finally {
  if (server) await server.stop();
  server = null;
  fs.rmSync(tmp, { recursive: true, force: true });
}

for (const note of [...new Set(notes)]) console.log(`check-agreements: note: ${note}`);
if (failed) {
  console.error(`check-agreements: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-agreements: ok (${n} checks)`);
