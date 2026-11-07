#!/usr/bin/env node
/*
 * check-vault-share.mjs -- the Vault's share links (documentation/plans/plan-attachments-vault.md, sections 7 and 12,
 * step 5; server/vault-share.js and the share records in server/vault-store.js), live against throwaway servers (DATA_DIR
 * and VAULT_DIR under the temp folder, no LiveKit, no outside service).
 * Server S, one environment: the signed-in routes (make, list, change, Turn off) for signed out, a guest pass, the access
 * key, someone outside the space, a member without `share` (and with it, once Roles turns it on), a moderator, an owner
 * and the admin; every refusal its status and sentence; the `shared` mark in the list only for people with `share`; the
 * token never kept (only its SHA-256) and the password only as scrypt. The public routes, with no session: the list (its
 * exact fields, nothing of the space or its people but the maker's first name), the bytes with ranges and the library's
 * headers, download only when allowed, a file outside the set, another space's file, a thumbnail, a PDF kept as download
 * only, every header exact, the page's headers and CSP the same for every token; unknown, malformed, ended, turned off,
 * emptied links, the Vault turned off and the space deleted all answering the same; the password flow (locked, a wrong
 * one, a right one and its cookie's attributes, the cookie on another link or changed, Secure on https), the tries limit
 * per link and address, per link and per address, its growing wait, the misses limit; file removal and Turn off
 * cascading; the 200 links cap; the view count. Server H, with BASE_DOMAIN: a link opens only on its own environment's
 * host. What can't be checked here: the page in a browser (experience-design's), a real proxy's access logs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'tools', 'fixtures', 'vault');
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n += 1; };
const same = (a, b, msg) => { assert.deepEqual(a, b, msg); n += 1; };
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

const ENDED = { error: 'This link has ended.', ended: true };
const LOCKED = { error: 'This link needs its password.', password: true };
const TOO_MANY = { error: 'Too many tries. Wait a few minutes.' };
const NO_FILE = { error: 'There is no such file.' };
const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; frame-src 'self'; worker-src 'none'; object-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-vault-share-'));
async function startServer(name, env) {
  const dataDir = path.join(base, `${name}-data`);
  const vaultDir = path.join(base, `${name}-vault`);
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    // One proxy hop is trusted, so each part of the check can come from its own address (X-Forwarded-For).
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, VAULT_DIR: vaultDir, ADMIN_PASSWORD: 'testpass1234', TRUST_PROXY_HOPS: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 25000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  const stop = () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
  return { port, dataDir, vaultDir, stop, out: () => out };
}

// One request: { status, headers, bytes, json, text, cookies, ms }. `cookie` a session token (or `cookies`, a raw Cookie
// header); `ip` the X-Forwarded-For address.
function send(server, method, urlPath, { cookie, cookies, headers = {}, body, host, ip } = {}) {
  return new Promise((resolve) => {
    const h = { accept: 'application/json', ...headers };
    const jar = [cookie ? `app_session=${cookie}` : '', cookies || ''].filter(Boolean).join('; ');
    if (jar) h.cookie = jar;
    if (host) h.host = host;
    if (ip) h['x-forwarded-for'] = ip;
    if (body !== undefined && h['content-length'] === undefined) h['content-length'] = String(body.length);
    const started = Date.now();
    const req = http.request({ host: '127.0.0.1', port: server.port, method, path: urlPath, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const bytes = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(bytes.toString()); } catch { /* bytes */ }
        resolve({ status: res.statusCode, headers: res.headers, bytes, json, text: bytes.toString().slice(0, 400), setCookies: res.headers['set-cookie'] || [], ms: Date.now() - started });
      });
    });
    req.on('error', (err) => resolve({ status: 0, error: err.code || err.message, headers: {}, bytes: Buffer.alloc(0), json: null, text: '', setCookies: [] }));
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const bodyOf = (value) => Buffer.from(JSON.stringify(value));
const JSONH = { 'content-type': 'application/json' };

let failed = false;
const servers = [];
try {
  // --- server S ----------------------------------------------------------------------------------------------------
  let S = await startServer('s', { SHARE_UNLOCKS_PER_MINUTE: '100000' });
  servers.push(S);
  const json = (method, urlPath, cookie, value, o = {}) => send(S, method, urlPath, { cookie, ...o, headers: { ...JSONH, ...(o.headers || {}) }, body: bodyOf(value) });
  const login = async (who, password) => { const r = await json('POST', '/api/login', null, { login: who, password }); assert.equal(r.status, 200, `${who} signs in: ${r.text}`); return r.json.token; };
  let admin = await login('admin', 'testpass1234');
  const people = {};
  for (const [who, role, name] of [['pat', 'member', 'Pat Lee'], ['mo', 'member', 'Morgan Ray'], ['max', 'member', 'Max'], ['lou', 'member', 'Lou'], ['ola', 'owner', 'Ola Nord']]) {
    const r = await json('POST', '/api/users', admin, { login: who, displayName: name, role, password: 'memberpass1234' });
    assert.equal(r.status, 201, r.text);
    people[who] = { key: r.json.user.key, token: await login(who, 'memberpass1234') };
  }
  const members = ['pat', 'mo', 'max'].map((w) => people[w].key);
  const trip = (await json('POST', '/api/spaces', admin, { name: 'Rome Secret Trip', members })).json.space;
  const other = (await json('POST', '/api/spaces', admin, { name: 'Oslo', members: [people.lou.key, people.mo.key] })).json.space;
  await json('PATCH', `/api/spaces/${trip.id}`, admin, { members });
  await json('PATCH', `/api/spaces/${other.id}`, admin, { members: [people.lou.key, people.mo.key] });
  for (const w of ['mo', 'max']) same((await json('PATCH', `/api/users/${people[w].key}/spaces/${trip.id}`, admin, { permissions: { moderator: true } })).status, 200, `${w} moderates the trip`);
  same((await json('POST', '/api/modules/bundled/vault/install', admin, {})).status < 300, true, 'the bundled Vault installs');
  same((await json('PATCH', '/api/modules/vault', admin, { enabled: true, allSpaces: true })).status, 200, 'the Vault turns on');
  const roles = (await send(S, 'GET', '/api/roles', { cookie: admin })).json.roles;
  same([roles.member['module.vault.share'], roles.moderator['module.vault.share'], roles.guest['module.vault.share']], [false, true, false], 'share: off for members, on for moderators, off for guests (plan section 6)');
  const roleOn = await json('PATCH', '/api/roles/guest', admin, { 'module.vault.share': true });
  ok(roleOn.status === 400 && /^Guests can never have ".+"\.$/.test(roleOn.json?.error), `and Roles can't turn it on for guests: ${roleOn.status} ${roleOn.json?.error}`);

  const lib = (space, q = '') => `/api/modules/vault/library?space=${space}${q}`;
  const add = async (who, space, name, bytes, type) => {
    const r = await send(S, 'POST', lib(space, `&name=${encodeURIComponent(name)}`), { cookie: people[who].token, headers: { 'content-type': type }, body: bytes });
    assert.equal(r.status, 201, `${name} is added: ${r.text}`);
    return r.json.file;
  };
  const pic = await add('pat', trip.id, 'beach.png', fs.readFileSync(path.join(FIX, 'pic.png')), 'image/png');
  const md = await add('pat', trip.id, 'notes.md', fs.readFileSync(path.join(FIX, 'notes.md')), 'text/markdown');
  const pdf = await add('mo', trip.id, 'ticket.pdf', fs.readFileSync(path.join(FIX, 'plain.pdf')), 'application/pdf');
  const lockedPdf = await add('mo', trip.id, 'locked.pdf', Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\ntrailer << /Root 1 0 R /Encrypt 9 0 R /ID [<00> <00>] >>\n%%EOF\n', 'latin1'), 'application/pdf');
  same(lockedPdf.viewable, false, 'an encrypted PDF is kept as download only');
  const video = await add('pat', trip.id, 'walk.mp4', fs.readFileSync(path.join(FIX, 'clip.mp4')), 'video/mp4');
  const notShared = await add('pat', trip.id, 'private.md', Buffer.from('# not in any link\n'), 'text/markdown');
  const oslo = await add('lou', other.id, 'oslo.md', Buffer.from('# Oslo\n'), 'text/markdown');
  same((await send(S, 'PUT', `/api/modules/vault/library/${pic.id}/thumb?space=${trip.id}`, { cookie: people.pat.token, headers: { 'content-type': 'image/png' }, body: fs.readFileSync(path.join(FIX, 'pic.png')) })).status, 200, 'the picture has a small picture');

  // --- the signed-in routes: who may ---------------------------------------------------------------------------------
  const shares = (space, sid = '') => `/api/modules/vault/library/shares${sid ? `/${sid}` : ''}?space=${space}`;
  const guestToken = (await json('POST', `/api/spaces/${trip.id}/guest-link`, admin, {})).json.space.guestToken;
  const streamKey = (await send(S, 'GET', '/api/me', { cookie: admin })).json.streamKey;
  const make = (cookie, value, space = trip.id, o = {}) => json('POST', shares(space), cookie, value, o);
  const goodBody = { name: 'Rome photos', files: [pic.id, md.id, pdf.id, lockedPdf.id, video.id], days: 7 };
  for (const [label, o, status, error] of [
    ['signed out', {}, 401, 'Sign in first.'],
    ['a guest pass', { q: `&guest=${guestToken}` }, 403, 'Guests can\'t use Vault.'],
    ['the access key', { q: `&s=${streamKey}` }, 403, 'The access key can\'t open Vault.'],
    ['someone outside the space', { cookie: people.lou.token }, 404, 'There is no such space.'],
    ['a member without share', { cookie: people.pat.token }, 403, 'Your role can\'t do that in Vault.'],
  ]) {
    const q = o.q || '';
    const list = await send(S, 'GET', `${shares(trip.id)}${q}`, { cookie: o.cookie });
    same([list.status, list.json], [status, { error }], `GET shares, ${label}: ${status} "${error}"`);
    const made = await send(S, 'POST', `${shares(trip.id)}${q}`, { cookie: o.cookie, headers: JSONH, body: bodyOf(goodBody) });
    same([made.status, made.json], [status, { error }], `POST shares, ${label}: ${status}`);
    const off = await send(S, 'DELETE', `${shares(trip.id, 'aaaaaaaaaaaaaaaaaa')}${q}`, { cookie: o.cookie });
    same([off.status, off.json], [status, { error }], `DELETE a share, ${label}: ${status}`);
  }
  for (const [label, value, status, error] of [
    ['an end that is not 1, 7 or 30', { ...goodBody, days: 2 }, 400, 'A share link ends after 1, 7 or 30 days.'],
    ['an end as text', { ...goodBody, days: '7' }, 400, 'A share link ends after 1, 7 or 30 days.'],
    ['no name', { ...goodBody, name: ' \u0000 ' }, 400, 'Give the share link a name.'],
    ['no files', { ...goodBody, files: [] }, 400, 'Choose the files to share.'],
    ['another space\'s file', { ...goodBody, files: [pic.id, oslo.id] }, 404, 'There is no such file.'],
    ['a file id that is a path', { ...goodBody, files: ['../../etc/passwd'] }, 404, 'There is no such file.'],
    ['over 500 files', { ...goodBody, files: Array.from({ length: 501 }, (_, i) => i.toString(16).padStart(24, '0')) }, 400, 'A share link holds at most 500 files.'],
    ['a name that is not text', { ...goodBody, name: 42 }, 400, 'Give the share link a name.'],
    ['a name that is a list', { ...goodBody, name: ['x'] }, 400, 'Give the share link a name.'],
    ['a password under 8 characters', { ...goodBody, password: 'short12' }, 400, 'A password needs at least 8 characters.'],
    ['a password that is not text', { ...goodBody, password: 1234 }, 400, 'A password is text.'],
    ['a password over 200 characters', { ...goodBody, password: 'x'.repeat(201) }, 400, 'That password is too long.'],
    ['download that is not on or off', { ...goodBody, download: 'yes' }, 400, 'Allow download is on or off.'],
  ]) {
    const r = await make(people.mo.token, value);
    same([r.status, r.json], [status, { error }], `a share link with ${label}: ${status} "${error}"`);
  }
  const bad = await send(S, 'POST', shares(trip.id), { cookie: people.mo.token, headers: JSONH, body: Buffer.from('{"name":') });
  same(bad.status, 400, 'a body that is not JSON: 400');

  // A view-only link by the moderator, a download link with a password by the owner.
  const view = await make(people.mo.token, goodBody);
  same(view.status, 201, `the moderator makes a view-only link: ${view.text}`);
  same(Object.keys(view.json).sort(), ['share', 'token', 'url'], 'it answers the share, the token and the address');
  ok(/^[A-Za-z0-9_-]{43}$/.test(view.json.token) && Buffer.from(view.json.token, 'base64url').length === 32, 'the token is 32 random bytes (256 bits)');
  same(view.json.url, `/shared/${view.json.token}`, 'the address is /shared/<token>');
  same(Object.keys(view.json.share).sort(), ['at', 'by', 'download', 'ends', 'files', 'hasPassword', 'id', 'name', 'opened'], 'the share as its maker sees it');
  same([view.json.share.download, view.json.share.hasPassword, view.json.share.by, view.json.share.opened], [false, false, people.mo.key, 0], 'view-only by default, no password, made by the moderator');
  const days = (Date.parse(view.json.share.ends) - Date.parse(view.json.share.at)) / 86400000;
  same(days, 7, 'it ends after 7 days');
  const dl = await make(people.ola.token, { name: 'Tickets', files: [pdf.id, lockedPdf.id, pic.id], days: 1, download: true, password: 'open sesame' });
  same(dl.status, 201, `the owner makes a download link with a password: ${dl.text}`);
  same([dl.json.share.download, dl.json.share.hasPassword, (Date.parse(dl.json.share.ends) - Date.parse(dl.json.share.at)) / 86400000], [true, true, 1], 'download on, a password, one day');
  const adminMade = await make(admin, { name: 'Admin link', files: [md.id], days: 30 });
  same(adminMade.status, 201, 'the admin may make one too');
  const sharesFile = path.join(S.dataDir, 'modules', 'vault', 'library', `space-${trip.id}.shares.json`);
  const stored = fs.readFileSync(sharesFile, 'utf8');
  ok(!stored.includes(view.json.token) && !stored.includes(dl.json.token) && !stored.includes('open sesame'), 'neither token nor password is in the data file');
  ok(stored.includes(sha256(view.json.token)) && /"passwordHash":"scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}"/.test(stored), 'only the token\'s SHA-256, and the password as scrypt');
  ok(!fs.readFileSync(path.join(S.dataDir, 'modules', 'vault', 'library', `space-${trip.id}.json`), 'utf8').includes('tokenHash'), 'share links are not in the files\' records');

  // A member, once Roles gives members `share`; and a download link only for someone who may download.
  same((await json('PATCH', '/api/roles/member', admin, { 'module.vault.share': true, 'module.vault.download': false })).status, 200, 'Roles: members may share, not download');
  const patDl = await make(people.pat.token, { ...goodBody, download: true });
  same([patDl.status, patDl.json], [403, { error: 'Your role can\'t download from Vault, so its share links can\'t allow it.' }], 'a link with download from someone who may not download: 403');
  const patMade = await make(people.pat.token, { name: 'Pat\'s', files: [md.id] });
  same(patMade.status, 201, 'a member with share makes a view-only link');
  same((await json('PATCH', '/api/roles/member', admin, { 'module.vault.share': false, 'module.vault.download': true })).status, 200, 'Roles back');

  // The list of links, and the Shared mark in the files list.
  const listed = await send(S, 'GET', shares(trip.id), { cookie: people.mo.token });
  same(listed.status, 200, 'the moderator lists the links');
  same(listed.json.shares.map((s) => s.name).sort(), ['Admin link', 'Pat\'s', 'Rome photos', 'Tickets'], 'every link of the space');
  ok(!listed.text.includes('tokenHash') && !listed.text.includes('passwordHash') && !listed.text.includes(view.json.token), 'no token, hash or password in the list');
  const asMo = (await send(S, 'GET', lib(trip.id), { cookie: people.mo.token })).json.files;
  same(Object.fromEntries(asMo.map((f) => [f.name, f.shared])), { 'beach.png': true, 'notes.md': true, 'ticket.pdf': true, 'locked.pdf': true, 'walk.mp4': true, 'private.md': false }, 'the files list marks what is shared, for someone with share');
  const asPat = (await send(S, 'GET', lib(trip.id), { cookie: people.pat.token })).json.files;
  ok(asPat.length === 6 && asPat.every((f) => !('shared' in f)), 'and says nothing of it to someone without share');
  const otherList = await send(S, 'GET', shares(other.id), { cookie: people.ola.token });
  same([otherList.status, otherList.json.shares], [200, []], 'another space has its own (empty) list');

  // A file not shared with the maker (plan-vault-privacy.md, slice 1): refused as one that is not there, and its id is in
  // no list shown to someone who can't see it.
  {
    same((await json('PATCH', `/api/modules/vault/library/${notShared.id}?space=${trip.id}`, people.pat.token, { visibility: 'only-me' })).status, 200, 'its adder makes private.md only-me');
    const hidden = await make(people.mo.token, { name: 'Hidden', files: [notShared.id] });
    const missing = await make(people.mo.token, { name: 'Hidden', files: ['ffffffffffffffffffffffff'] });
    same([hidden.status, hidden.text], [missing.status, missing.text], 'a moderator who can\'t see it: the same answer as a file that is not there');
    same([hidden.status, hidden.json], [404, NO_FILE], 'which is 404 "There is no such file."');
    const ownerMade = await make(people.ola.token, { name: 'With the private one', files: [notShared.id, pic.id] });
    same(ownerMade.status, 201, 'an owner sees it, so may share it');
    const moList = await send(S, 'GET', shares(trip.id), { cookie: people.mo.token });
    same(moList.json.shares.find((s) => s.id === ownerMade.json.share.id).files, [pic.id], 'the moderator\'s list of links leaves its id out');
    ok(!moList.text.includes(notShared.id), 'anywhere in the list');
    const edit = await json('PATCH', shares(trip.id, view.json.share.id), people.mo.token, { files: [pic.id, notShared.id] });
    same([edit.status, edit.json], [404, NO_FILE], 'nor can the moderator put it into their own link');
    same((await send(S, 'DELETE', shares(trip.id, ownerMade.json.share.id), { cookie: people.ola.token })).status, 200, 'the owner\'s link turned off');
    same((await json('PATCH', `/api/modules/vault/library/${notShared.id}?space=${trip.id}`, people.pat.token, { visibility: 'everyone' })).status, 200, 'and private.md is everyone\'s again');
  }

  // --- public: the list ----------------------------------------------------------------------------------------------
  const T = view.json.token;
  const pub = (token, rest = '', o = {}) => send(S, o.method || 'GET', `/api/shared/${token}${rest}`, o);
  const API_HEADERS = { 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
  const hasHeaders = (r, want) => Object.entries(want).every(([k, v]) => r.headers[k] === v);
  const pl = await pub(T, '', { ip: '10.0.0.1' });
  same(pl.status, 200, `the list opens with no session: ${pl.text}`);
  same(Object.keys(pl.json).sort(), ['by', 'download', 'ends', 'files', 'name'], 'the list holds the name, the maker\'s first name, download, the end and the files, nothing else');
  same([pl.json.name, pl.json.by, pl.json.download, pl.json.ends], ['Rome photos', 'Morgan', false, view.json.share.ends], 'its name, "Morgan" (the first name only), view-only, its end');
  same(pl.json.files.map((f) => f.name), ['beach.png', 'notes.md', 'ticket.pdf', 'locked.pdf', 'walk.mp4'], 'the files of the set, in its order');
  const fp = pl.json.files[0];
  same(Object.keys(fp).sort(), ['content', 'group', 'hasThumb', 'id', 'name', 'size', 'thumb', 'type'], 'a file: id, name, type, group, size, hasThumb and its addresses');
  same([fp.content, fp.thumb], [`/api/shared/${T}/files/${pic.id}/content`, `/api/shared/${T}/files/${pic.id}/thumb`], 'its addresses under the link');
  ok(pl.json.files.every((f) => !('download' in f)), 'no download address on a view-only link');
  same(pl.json.files.find((f) => f.id === lockedPdf.id).viewable, false, 'a PDF kept as download only says so');
  for (const secret of [trip.name, trip.id, people.mo.key, people.pat.key, 'Ray', 'Pat', 'sha256', 'by":"', 'tokenHash', 'Oslo']) ok(!pl.text.includes(secret) || (secret === 'by":"' && pl.json.by === 'Morgan'), `the public list does not hold "${secret}"`);
  ok(!JSON.stringify(pl.json).includes(people.mo.key) && !JSON.stringify(pl.json).includes('"at"') && !JSON.stringify(pl.json).includes('taken'), 'nor a person\'s key, when files were added, or when pictures were taken');
  ok(hasHeaders(pl, API_HEADERS), 'its headers: no referrer, noindex, not kept, nosniff');
  same([pl.headers['access-control-allow-origin'], pl.setCookies], [undefined, []], 'no CORS header and no cookie');
  const pre = await send(S, 'OPTIONS', `/api/shared/${T}`, { headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
  same(pre.headers['access-control-allow-origin'], undefined, 'a preflight from another site gets no CORS header');

  // Unknown, malformed and wrong tokens answer exactly as an ended link.
  const unknown = crypto.randomBytes(32).toString('base64url');
  const flipped = `${T.slice(0, -1)}${T.at(-1) === 'A' ? 'B' : 'A'}`;
  for (const [label, token] of [['an unknown token', unknown], ['the token with one letter changed', flipped], ['a short token', T.slice(0, 20)], ['a token with a dot', `${T.slice(0, 42)}.`], ['the token\'s hash', sha256(T)]]) {
    const r = await pub(token, '', { ip: '10.0.0.2' });
    same([r.status, r.json], [404, ENDED], `${label}: 404 "This link has ended."`);
    ok(hasHeaders(r, API_HEADERS), `${label}: with the same headers`);
    const c = await pub(token, `/files/${pic.id}/content`, { ip: '10.0.0.2' });
    same([c.status, c.json], [404, ENDED], `${label}, a file: the same`);
  }
  same((await pub(T, '/anything', { ip: '10.0.0.2' })).json, ENDED, 'any other route under a link answers as ended');
  same((await pub(T, `/files/${pic.id}`, { ip: '10.0.0.2' })).json, ENDED, 'and a file without content or thumb too');

  // --- public: the bytes ---------------------------------------------------------------------------------------------
  const FILE_HEADERS = { ...API_HEADERS, 'cross-origin-resource-policy': 'same-origin', 'content-security-policy': "sandbox; default-src 'none'" };
  const c1 = await pub(T, `/files/${pic.id}/content`, { ip: '10.0.0.3' });
  same([c1.status, c1.headers['content-type'], c1.bytes.equals(fs.readFileSync(path.join(S.vaultDir, '_default', `space-${trip.id}`, `${pic.id}.bin`)))], [200, 'image/png', true], 'a picture of the set: its bytes, its type');
  ok(hasHeaders(c1, FILE_HEADERS), `with the library's headers: sandbox CSP, nosniff, no referrer, same-origin, not kept, noindex: ${JSON.stringify(c1.headers)}`);
  same([c1.headers['content-disposition'], c1.headers['accept-ranges'], c1.setCookies, c1.headers['access-control-allow-origin']], ['inline; filename="beach.png"; filename*=UTF-8\'\'beach.png', 'bytes', [], undefined], 'inline, with ranges, no cookie, no CORS');
  const vbin = fs.readFileSync(path.join(S.vaultDir, '_default', `space-${trip.id}`, `${video.id}.bin`));
  const r206 = await pub(T, `/files/${video.id}/content`, { ip: '10.0.0.3', headers: { range: 'bytes=10-29' } });
  same([r206.status, r206.headers['content-range'], r206.bytes.equals(vbin.subarray(10, 30))], [206, `bytes 10-29/${vbin.length}`, true], 'a range: 206 with the right bytes');
  const r416 = await pub(T, `/files/${video.id}/content`, { ip: '10.0.0.3', headers: { range: `bytes=${vbin.length + 10}-` } });
  same([r416.status, r416.headers['content-range'], r416.json], [416, `bytes */${vbin.length}`, { error: 'That part of the file is out of range.' }], 'a range past the end: 416 with the size');
  same((await pub(T, `/files/${md.id}/content`, { ip: '10.0.0.3' })).headers['content-type'], 'text/plain; charset=utf-8', 'Markdown as plain text, never HTML');
  const pdfIn = await pub(T, `/files/${pdf.id}/content`, { ip: '10.0.0.3' });
  same([pdfIn.status, pdfIn.headers['content-disposition']], [200, 'attachment; filename="ticket.pdf"; filename*=UTF-8\'\'ticket.pdf'], 'a PDF only ever as an attachment (the viewer is handed its bytes)');
  const lockedIn = await pub(T, `/files/${lockedPdf.id}/content`, { ip: '10.0.0.3' });
  same([lockedIn.status, lockedIn.json], [404, { error: 'This PDF can\'t be opened here.' }], 'a PDF kept as download only, on a view-only link: 404 "can\'t be opened here"');
  for (const [label, rest] of [
    ['a download on a view-only link', `/files/${pic.id}/content?download=1`],
    ['a file not in the set', `/files/${notShared.id}/content`],
    ['another space\'s file', `/files/${oslo.id}/content`],
    ['a file id that is a path', '/files/..%2F..%2Fetc%2Fpasswd/content'],
    ['a thumbnail the file doesn\'t have', `/files/${md.id}/thumb`],
    ['a thumbnail of a file not in the set', `/files/${notShared.id}/thumb`],
  ]) {
    const r = await pub(T, rest, { ip: '10.0.0.3' });
    same([r.status, r.json], [404, NO_FILE], `${label}: 404 "There is no such file."`);
  }
  const th = await pub(T, `/files/${pic.id}/thumb`, { ip: '10.0.0.3' });
  ok(th.status === 200 && /^image\//.test(th.headers['content-type']) && hasHeaders(th, FILE_HEADERS), 'its small picture, with the same headers');
  // The opened count, for the maker only.
  const opened = (await send(S, 'GET', shares(trip.id), { cookie: people.mo.token })).json.shares.find((s) => s.id === view.json.share.id).opened;
  same(opened, 1, 'the maker sees it opened once (the list read once; files and wrong tokens don\'t count)');
  ok(!fs.readFileSync(sharesFile, 'utf8').includes('10.0.0.'), 'no address is kept');

  // --- public: the page ----------------------------------------------------------------------------------------------
  const PAGE_HEADERS = { 'content-security-policy': PAGE_CSP, 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'cross-origin-opener-policy': 'same-origin' };
  const hasPage = fs.existsSync(path.join(ROOT, 'public', 'shared.html'));
  const pages = [];
  for (const [label, p] of [['a good link', `/shared/${T}`], ['an unknown one', `/shared/${unknown}`], ['a malformed one', '/shared/x'], ['the file by its name', '/shared.html']]) {
    const r = await send(S, 'GET', p, { headers: { accept: 'text/html' }, ip: '10.0.0.4' });
    same(r.status, hasPage ? 200 : 404, `the page, ${label}: ${hasPage ? 200 : '404 until public/shared.html is built'}`);
    ok(hasHeaders(r, PAGE_HEADERS), `the page, ${label}: CSP, no framing, no referrer, noindex, not kept: ${JSON.stringify(r.headers)}`);
    same([r.setCookies, r.headers['access-control-allow-origin']], [[], undefined], `the page, ${label}: no cookie, no CORS`);
    pages.push(r.bytes.toString('base64'));
  }
  same(new Set(pages.slice(0, 3)).size, 1, 'the page is the same for every token, so it says nothing about one');

  // --- public: the password ------------------------------------------------------------------------------------------
  const D = dl.json.token;
  const DL_IP = '10.0.1.1';
  same([(await pub(D, '', { ip: DL_IP })).status, (await pub(D, '', { ip: DL_IP })).json], [401, LOCKED], 'a link with a password: its list is locked');
  same((await pub(D, `/files/${pdf.id}/content?download=1`, { ip: DL_IP })).json, LOCKED, 'and so are its files');
  same((await pub(D, '', { ip: DL_IP, cookie: admin })).json, LOCKED, 'a session that comes along opens nothing');
  const unlock = (token, password, ip, o = {}) => pub(token, '/unlock', { ...o, method: 'POST', ip, headers: { ...JSONH, ...(o.headers || {}) }, body: bodyOf({ password }) });
  const wrong = await unlock(D, 'nope', DL_IP);
  same([wrong.status, wrong.json, wrong.setCookies], [401, { error: 'That password isn\'t right.' }, []], 'a wrong password: 401, no cookie');
  const right = await unlock(D, 'open sesame', DL_IP);
  same([right.status, right.json], [200, { ok: true }], 'the right one: 200');
  same(right.setCookies.length, 1, 'and one cookie');
  const raw = right.setCookies[0];
  const attrs = raw.split(';').map((s) => s.trim());
  const [cname, cvalue] = attrs[0].split('=');
  same(cname, 'share_unlock', 'named share_unlock');
  ok(attrs.includes(`Path=/api/shared/${D}`) && attrs.includes('HttpOnly') && attrs.includes('SameSite=Strict') && !attrs.includes('Secure'), `HttpOnly, SameSite=Strict, only for the link's own path, not Secure on http: ${raw}`);
  const maxAge = Number(attrs.find((a) => a.startsWith('Max-Age='))?.slice(8));
  ok(maxAge > 3500 && maxAge <= 3600, `for an hour: Max-Age=${maxAge}`);
  ok(!cvalue.includes(D) && !cvalue.includes('open'), 'the cookie holds neither the token nor the password');
  const jar = `share_unlock=${cvalue}`;
  const dlList = await pub(D, '', { ip: DL_IP, cookies: jar });
  same([dlList.status, dlList.json.download, dlList.json.by, dlList.json.files.map((f) => f.name)], [200, true, 'Ola', ['ticket.pdf', 'locked.pdf', 'beach.png']], 'with the cookie the list opens');
  same(dlList.json.files[0].download, `/api/shared/${D}/files/${pdf.id}/content?download=1`, 'with a download address on each file');
  const down = await pub(D, `/files/${pic.id}/content?download=1`, { ip: DL_IP, cookies: jar });
  same([down.status, down.headers['content-disposition']], [200, 'attachment; filename="beach.png"; filename*=UTF-8\'\'beach.png'], 'a download: an attachment with both names');
  const lockedDl = await pub(D, `/files/${lockedPdf.id}/content`, { ip: DL_IP, cookies: jar });
  same([lockedDl.status, lockedDl.json], [404, { error: 'This PDF can\'t be opened here. Download it.' }], 'a download-only PDF asked inline on a download link: the note');
  same((await pub(D, `/files/${lockedPdf.id}/content?download=1`, { ip: DL_IP, cookies: jar })).status, 200, 'and its download works');
  same((await pub(D, `/files/${md.id}/content`, { ip: DL_IP, cookies: jar })).json, NO_FILE, 'a file of the space but not of this link: 404');
  const tampered = `share_unlock=${cvalue.slice(0, -1)}${cvalue.at(-1) === 'A' ? 'B' : 'A'}`;
  same((await pub(D, '', { ip: DL_IP, cookies: tampered })).json, LOCKED, 'a changed cookie opens nothing');
  const later = `share_unlock=${Number(cvalue.split('.')[0]) + 86400000 * 5}.${cvalue.split('.')[1]}`;
  same((await pub(D, '', { ip: DL_IP, cookies: later })).json, LOCKED, 'nor one with its end moved');
  // A second link with a password: the first's cookie does not open it.
  const dl2 = await make(people.ola.token, { name: 'Other', files: [pic.id], days: 7, password: 'open sesame' });
  same((await pub(dl2.json.token, '', { ip: DL_IP, cookies: jar })).json, LOCKED, 'another link\'s cookie, even with the same password: locked');
  const secure = await unlock(dl2.json.token, 'open sesame', DL_IP, { headers: { 'x-forwarded-proto': 'https' } });
  ok(secure.status === 200 && secure.setCookies[0].split(';').map((s) => s.trim()).includes('Secure'), 'on https the cookie is Secure');
  same((await unlock(T, 'anything', DL_IP)).json, { ok: true }, 'unlocking a link without a password: 200, no cookie needed');

  // The tries limit: five wrong ones per link and address in fifteen minutes, with a growing wait.
  const L_IP = '10.0.2.1';
  const times = [];
  for (let i = 0; i < 5; i += 1) {
    const r = await unlock(D, `wrong ${i}`, L_IP);
    same(r.status, 401, `wrong try ${i + 1}: 401`);
    times.push(r.ms);
  }
  ok(times[2] >= 450 && times[3] >= 950 && times[4] >= 1950, `the wait grows after the first wrong tries: ${times.join(', ')} ms`);
  const sixth = await unlock(D, 'open sesame', L_IP);
  same([sixth.status, sixth.json], [429, TOO_MANY], 'the sixth, even the right password: 429 "Too many tries. Wait a few minutes."');
  ok(Number(sixth.headers['retry-after']) > 800 && Number(sixth.headers['retry-after']) <= 900, `with Retry-After in seconds: ${sixth.headers['retry-after']}`);
  same((await unlock(D, 'open sesame', '10.0.2.2')).status, 200, 'another address still may');
  // Per link from anywhere: thirty wrong tries in all, from six addresses, then even a fresh address waits.
  const spread = ['10.0.3.1', '10.0.3.2', '10.0.3.3', '10.0.3.4', '10.0.3.5'];
  const L2 = dl2.json.token;
  await Promise.all(spread.map(async (ip) => { for (let i = 0; i < 5; i += 1) await unlock(L2, 'x', ip); }));
  await Promise.all(['10.0.3.6'].map(async (ip) => { for (let i = 0; i < 5; i += 1) await unlock(L2, 'x', ip); }));
  same((await unlock(L2, 'open sesame', '10.0.3.9')).json, TOO_MANY, 'thirty wrong tries at one link, from anywhere: it waits for everyone');
  same((await unlock(D, 'open sesame', '10.0.3.9')).status, 200, 'other links are not held up');
  // Per address across links: twenty wrong tries from one address, then it waits for every link.
  const A_IP = '10.0.4.1';
  const many = [];
  for (let i = 0; i < 4; i += 1) many.push((await make(people.ola.token, { name: `L${i}`, files: [pic.id], days: 1, password: 'password1' })).json.token);
  const statuses = [];
  await Promise.all(many.map(async (tok) => { for (let i = 0; i < 5; i += 1) statuses.push((await unlock(tok, 'x', A_IP)).status); }));
  const lastTry = await unlock(D, 'open sesame', A_IP);
  same([lastTry.status, lastTry.json], [429, TOO_MANY], `twenty wrong tries from one address, across links: it waits for every link (statuses ${statuses.join(' ')})`);
  // Unlocking a link that doesn't open: 404, counted as a miss, no password hashed.
  same((await unlock(unknown, 'x', '10.0.5.3')).json, ENDED, 'unlocking an unknown link: 404 "This link has ended."');
  // The password check never blocks the server: while several unlocks hash at once, a plain request is still answered
  // quickly (medians over several samples, so one slow moment decides nothing).
  const median = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  const sample = async (count) => { const out = []; for (let i = 0; i < count; i += 1) out.push((await pub(unknown, '', { ip: `10.0.5.${100 + (i % 100)}` })).ms); return out; };
  const idle = median(await sample(7));
  const busy = Promise.all(Array.from({ length: 8 }, (_, i) => unlock(D, 'not it', `10.0.5.${10 + i}`)));
  const during = median(await sample(7));
  const busyDone = await busy;
  same(busyDone.map((r) => r.status), Array(8).fill(401), 'eight wrong passwords at once: all 401');
  ok(during < idle + 250, `and meanwhile a plain request is answered (median ${during} ms, ${idle} ms when idle)`);
  // A valid unlock cookie skips every limit: this address has used up its tries, and the cookie still opens the link.
  const C_IP = '10.0.5.50';
  const cookieOk = await unlock(D, 'open sesame', C_IP);
  const cj = `share_unlock=${cookieOk.setCookies[0].split(';')[0].split('=')[1]}`;
  for (let i = 0; i < 6; i += 1) await unlock(D, 'wrong again', C_IP);
  same((await unlock(D, 'open sesame', C_IP)).status, 429, 'an address out of tries is held up');
  same([(await pub(D, '', { ip: C_IP, cookies: cj })).status, (await unlock(D, 'anything', C_IP, { cookies: cj })).json], [200, { ok: true }], 'but with a valid unlock cookie it still opens the link, limits skipped');
  // Lookups of links that don't open: a hundred from one address, then more of them wait; links that do open don't.
  const M_IP = '10.0.6.1';
  for (let i = 0; i < 100; i += 1) await pub(crypto.randomBytes(32).toString('base64url'), '', { ip: M_IP });
  const blocked = await pub(crypto.randomBytes(32).toString('base64url'), '', { ip: M_IP });
  same([blocked.status, blocked.json], [429, TOO_MANY], 'a hundred lookups of links that don\'t open from one address: more of them wait (429)');
  same((await pub(T, '', { ip: M_IP })).status, 200, 'but a link that opens is not held up by them');
  same((await pub(T, '', { ip: '10.0.6.2' })).status, 200, 'other addresses are not held up');
  // A try counted against a link can't be pushed out by other keys (the per-link window has no bound; the others do).
  const { Window } = createRequire(import.meta.url)('../server/vault-share.js');
  const win = new Window(900000, 5);
  const unbounded = new Window(900000, Infinity);
  win.add('link'); unbounded.add('link');
  for (let i = 0; i < 50; i += 1) { win.add(`other${i}`); unbounded.add(`other${i}`); }
  same([win.count('link'), unbounded.count('link')], [0, 1], 'a bounded window forgets its oldest key; the per-link one (unbounded) keeps its count');

  // --- changing, Turn off, removal ---------------------------------------------------------------------------------
  const sid = view.json.share.id;
  const notMaker = await json('PATCH', shares(trip.id, sid), people.max.token, { files: [pic.id] });
  same([notMaker.status, notMaker.json], [403, { error: 'Only the person who made this share link, or an owner, can change it.' }], 'another moderator can\'t change it: 403');
  const byMaker = await json('PATCH', shares(trip.id, sid), people.mo.token, { files: [pic.id, md.id, video.id, notShared.id], name: 'Rome, day one' });
  same([byMaker.status, byMaker.json.share.files.length, byMaker.json.share.name], [200, 4, 'Rome, day one'], 'its maker adds a file and renames it');
  same((await pub(T, `/files/${notShared.id}/content`, { ip: '10.0.7.1' })).status, 200, 'so the added file opens from the link');
  same((await pub(T, `/files/${pdf.id}/content`, { ip: '10.0.7.1' })).json, NO_FILE, 'and one taken out does not');
  same((await json('PATCH', shares(trip.id, sid), people.ola.token, { files: [pic.id, md.id, video.id] })).status, 200, 'an owner may change it too');
  same((await json('PATCH', shares(trip.id, sid), people.mo.token, { files: [] })).json, { error: 'Choose the files to share.' }, 'a set may not be emptied');
  same((await json('PATCH', shares(trip.id, 'bbbbbbbbbbbbbbbbbb'), people.mo.token, { name: 'x' })).json, { error: 'There is no such share link.' }, 'an unknown share id: 404 "There is no such share link."');
  // Removing a file takes it out of every link; a link left with none ends.
  const single = await make(people.mo.token, { name: 'Just notes', files: [notShared.id] });
  same((await pub(single.json.token, '', { ip: '10.0.7.2' })).status, 200, 'a link to one file opens');
  same((await send(S, 'DELETE', `/api/modules/vault/library/${notShared.id}?space=${trip.id}`, { cookie: people.pat.token })).status, 200, 'that file is removed');
  same((await pub(single.json.token, '', { ip: '10.0.7.2' })).json, ENDED, 'so its link has ended');
  ok(!(await send(S, 'GET', shares(trip.id), { cookie: people.mo.token })).json.shares.some((s) => s.id === single.json.share.id), 'and is gone from the list');
  same((await pub(T, '', { ip: '10.0.7.2' })).json.files.map((f) => f.name), ['beach.png', 'notes.md', 'walk.mp4'], 'a link that had it keeps the rest');
  // Turn off.
  // Who may turn a link off: its maker, an owner (the admin too) or a moderator of the space; another member with share may not.
  const REFUSED_OFF = { error: 'Only the person who made this share link, an owner or a moderator of this space can turn it off.' };
  same((await json('PATCH', '/api/roles/member', admin, { 'module.vault.share': true })).status, 200, 'Roles: members may share (for the turn-off cases)');
  const offOf = async (maker, who, label, allowed) => {
    const l = await make(maker, { name: `Off ${label}`, files: [pic.id] });
    same(l.status, 201, `${label}: a link is made`);
    const row = (await send(S, 'GET', shares(trip.id), { cookie: who })).json.shares.find((x) => x.id === l.json.share.id);
    same(row.canTurnOff, allowed, `${label}: the list says canTurnOff ${allowed}`);
    const r = await send(S, 'DELETE', shares(trip.id, l.json.share.id), { cookie: who });
    if (allowed) same(r.json, { ok: true }, `${label}: turned off`);
    else {
      same([r.status, r.json], [403, REFUSED_OFF], `${label}: 403 with a plain sentence`);
      same((await pub(l.json.token, '', { ip: '10.0.7.4' })).status, 200, `${label}: the link still opens`);
      same((await send(S, 'DELETE', shares(trip.id, l.json.share.id), { cookie: people.mo.token })).json, { ok: true }, `${label}: a moderator then ends it`);
    }
  };
  await offOf(people.pat.token, people.pat.token, 'the maker (a member)', true);
  await offOf(people.pat.token, people.ola.token, 'an owner', true);
  await offOf(people.pat.token, admin, 'the admin', true);
  await offOf(people.pat.token, people.max.token, 'a moderator', true);
  await offOf(people.mo.token, people.pat.token, 'another member with share', false);
  same((await json('PATCH', '/api/roles/member', admin, { 'module.vault.share': false })).status, 200, 'Roles back');
  same((await send(S, 'DELETE', shares(trip.id, sid), { cookie: people.max.token })).json, { ok: true }, 'a moderator who is not its maker turns it off');
  same((await pub(T, '', { ip: '10.0.7.3' })).json, ENDED, 'a turned-off link answers as ended');
  same((await pub(T, `/files/${pic.id}/content`, { ip: '10.0.7.3' })).json, ENDED, 'and so do its files');
  same((await send(S, 'DELETE', shares(trip.id, sid), { cookie: people.max.token })).json, { error: 'There is no such share link.' }, 'turned off twice: 404');
  same((await send(S, 'DELETE', shares(other.id, adminMade.json.share.id), { cookie: people.ola.token })).json, { error: 'There is no such share link.' }, 'a link of another space can\'t be turned off from this one');

  // Activity lines, without a file's name or the link's.
  const act = await send(S, 'GET', '/api/modules/activity', { cookie: admin });
  const lines = act.json.activity.filter((a) => a.module === 'vault').map((a) => a.text || a.what || a.action || JSON.stringify(a));
  ok(lines.some((l) => l.includes('made a share link')) && lines.some((l) => l.includes('turned off a share link')) && !JSON.stringify(act.json).includes('Rome photos'), `activity: "made a share link", "turned off a share link", no names: ${lines.slice(0, 3).join(' | ')}`);

  // The maker ends it: a link opens only while its maker exists, is in the space, and may share (and download, for a download link).
  const kim = (await json('POST', '/api/users', admin, { login: 'kim', displayName: '\u202Egpj.exe Kim', role: 'member', password: 'memberpass1234' })).json.user;
  await json('PATCH', `/api/spaces/${trip.id}`, admin, { members: [...members, kim.key] });
  same((await json('PATCH', `/api/users/${kim.key}/spaces/${trip.id}`, admin, { permissions: { moderator: true } })).status, 200, 'kim moderates the trip');
  const kimToken = await login('kim', 'memberpass1234');
  const kimLink = await make(kimToken, { name: 'Kim\'s', files: [md.id], days: 7 });
  same(kimLink.status, 201, 'kim makes a link');
  const kimList = await pub(kimLink.json.token, '', { ip: '10.0.10.1' });
  ok(kimList.status === 200 && !/[\u202E\u200E\u200F]/.test(kimList.json.by) && kimList.json.by === 'gpj.exe', `the maker's first name goes through the name cleaner: ${JSON.stringify(kimList.json.by)}`);
  await json('PATCH', `/api/spaces/${trip.id}`, admin, { members });
  same((await pub(kimLink.json.token, '', { ip: '10.0.10.1' })).json, ENDED, 'a maker no longer in the space: the link has ended');
  same((await pub(kimLink.json.token, `/files/${md.id}/content`, { ip: '10.0.10.1' })).json, ENDED, 'and its files');
  await json('PATCH', `/api/spaces/${trip.id}`, admin, { members: [...members, kim.key] });
  same((await pub(kimLink.json.token, '', { ip: '10.0.10.1' })).status, 200, 'back in the space, it opens again');
  same((await send(S, 'DELETE', `/api/users/${kim.key}`, { cookie: admin })).status, 200, 'kim is deleted');
  same((await pub(kimLink.json.token, '', { ip: '10.0.10.1' })).json, ENDED, 'a maker who no longer exists: the link has ended');
  await json('PATCH', `/api/spaces/${trip.id}`, admin, { members });
  // Pat is a plain member, so Roles decides what they may do (the moderators' space role grants everything).
  same((await json('PATCH', '/api/roles/member', admin, { 'module.vault.share': true, 'module.vault.download': true })).status, 200, 'Roles: members may share and download');
  const moView = await make(people.pat.token, { name: 'Pat view', files: [md.id], days: 7 });
  const moDl = await make(people.pat.token, { name: 'Pat download', files: [md.id], days: 7, download: true });
  same([moView.status, moDl.status], [201, 201], 'a member makes a view-only and a download link');
  same((await json('PATCH', shares(trip.id, moDl.json.share.id), people.pat.token, { files: [md.id, pic.id] })).status, 200, 'its maker, who may download, changes the files of the download link');
  same((await json('PATCH', '/api/roles/member', admin, { 'module.vault.download': false })).status, 200, 'Roles: members may not download');
  const noDl = await json('PATCH', shares(trip.id, moDl.json.share.id), people.pat.token, { files: [md.id] });
  same([noDl.status, noDl.json], [403, { error: 'Your role can\'t download from Vault, so you can\'t change the files of a link that allows it.' }], 'changing the files of a download link without download: 403');
  same((await json('PATCH', shares(trip.id, moDl.json.share.id), people.pat.token, { name: 'Renamed' })).status, 200, 'but its name may change');
  same((await json('PATCH', shares(trip.id, moView.json.share.id), people.pat.token, { files: [md.id, pic.id] })).status, 200, 'and a view-only link\'s files may');
  same((await pub(moDl.json.token, '', { ip: '10.0.10.2' })).json, ENDED, 'a download link whose maker lost download: the link has ended');
  same((await pub(moView.json.token, '', { ip: '10.0.10.2' })).status, 200, 'a view-only link still opens');
  same((await json('PATCH', '/api/roles/member', admin, { 'module.vault.share': false })).status, 200, 'Roles: members may not share');
  same((await pub(moView.json.token, '', { ip: '10.0.10.2' })).json, ENDED, 'a maker who lost share: the link has ended');
  same((await pub(moView.json.token, `/files/${md.id}/content`, { ip: '10.0.10.2' })).json, ENDED, 'and its files');
  same((await json('PATCH', '/api/roles/member', admin, { 'module.vault.share': true, 'module.vault.download': true })).status, 200, 'Roles back');
  same((await pub(moView.json.token, '', { ip: '10.0.10.2' })).status, 200, 'and it opens again');
  same((await json('PATCH', '/api/roles/member', admin, { 'module.vault.share': false, 'module.vault.download': true })).status, 200, 'Roles: members may not share, as at the start');
  for (const id of [moView, moDl]) await send(S, 'DELETE', shares(trip.id, id.json.share.id), { cookie: admin });
  const nm = await json('PATCH', shares(trip.id, view.json.share.id), people.mo.token, { name: 7 });
  const fresh = await make(people.mo.token, { name: 'Name test', files: [md.id], days: 1 });
  same([(await json('PATCH', shares(trip.id, fresh.json.share.id), people.mo.token, { name: 7 })).status, (await json('PATCH', shares(trip.id, fresh.json.share.id), people.mo.token, { name: null })).json], [400, { error: 'Give the share link a name.' }], 'a name that is not text on a change: 400');
  void nm;

  // The Vault turned off: its links end for good (their records are deleted), even with the files kept.
  const offLink = await make(admin, { name: 'Off test', files: [md.id], days: 7 });
  ok(fs.existsSync(sharesFile), 'before it is turned off, the space has a share links file');
  same((await json('PATCH', '/api/modules/vault', admin, { enabled: false })).status, 200, 'the Vault is turned off');
  same((await pub(adminMade.json.token, '', { ip: '10.0.8.1' })).json, ENDED, 'its links answer as ended');
  ok(!fs.existsSync(sharesFile), 'and the share links file is deleted');
  same((await json('PATCH', '/api/modules/vault', admin, { enabled: true, allSpaces: true })).status, 200, 'and on again');
  same([(await pub(adminMade.json.token, '', { ip: '10.0.8.1' })).json, (await pub(offLink.json.token, '', { ip: '10.0.8.1' })).json], [ENDED, ENDED], 'no old link comes back');
  same((await send(S, 'GET', shares(trip.id), { cookie: admin })).json, { shares: [] }, 'the list is empty');
  same((await send(S, 'GET', lib(trip.id), { cookie: admin })).json.files.length, 5, 'the files are kept');

  const endLink = await make(admin, { name: 'Ends soon', files: [md.id], days: 30 });
  same(endLink.status, 201, 'a link to end by the clock');

  // The cap: 200 links in a space.
  const have = (await send(S, 'GET', shares(trip.id), { cookie: admin })).json.shares.length;
  for (let i = have; i < 200; i += 1) assert.equal((await make(admin, { name: `n${i}`, files: [pic.id], days: 1 })).status, 201);
  const over = await make(admin, { name: 'one too many', files: [pic.id], days: 1 });
  same([over.status, over.json], [409, { error: 'There are already 200 share links here. Turn some off first.' }], 'the 201st link in a space: 409');

  // Ended: a restart with the clock past a link's end (its end moved back in the file).
  await S.stop();
  const file = JSON.parse(fs.readFileSync(sharesFile, 'utf8'));
  file[endLink.json.share.id].ends = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(sharesFile, JSON.stringify(file));
  S = await startServer('s', { SHARE_UNLOCKS_PER_MINUTE: '100000' });
  servers.push(S);
  admin = await login('admin', 'testpass1234');
  const endedR = await pub(endLink.json.token, '', { ip: '10.0.9.1' });
  same([endedR.status, endedR.json], [404, ENDED], 'a link past its end: 404 "This link has ended.", as an unknown one');
  same((await pub(endLink.json.token, `/files/${md.id}/content`, { ip: '10.0.9.1' })).json, ENDED, 'and its files');
  ok(!(await send(S, 'GET', shares(trip.id), { cookie: admin })).json.shares.some((s) => s.id === endLink.json.share.id), 'it is gone from the list');
  const keep = await make(admin, { name: 'one more', files: [pic.id], days: 30 });
  same(keep.status, 201, 'so another can be made');


  // The space deleted: its links go with it.
  same((await pub(keep.json.token, '', { ip: '10.0.9.2' })).status, 200, 'a link before the space is deleted');
  same((await send(S, 'DELETE', `/api/spaces/${trip.id}`, { cookie: admin })).status, 200, 'the space is deleted');
  same((await pub(keep.json.token, '', { ip: '10.0.9.2' })).json, ENDED, 'its links answer as ended');
  ok(!fs.existsSync(sharesFile), 'and its share links file is gone');
  ok(!S.out().includes(keep.json.token) && !S.out().includes(T) && !S.out().includes(D), 'no token reached the server\'s log');

  // --- server H: environments (BASE_DOMAIN) --------------------------------------------------------------------------
  {
    const BASE = 'share.test';
    const H = await startServer('h', { SHARE_UNLOCKS_PER_MINUTE: '3', BASE_DOMAIN: BASE, ADMIN_LOGIN: 'host', ADMIN_PASSWORD: 'hostpass1234' });
    servers.push(H);
    const at = (sub) => `${sub ? `${sub}.` : ''}${BASE}:${H.port}`;
    const hsend = (method, sub, urlPath, o = {}) => send(H, method, urlPath, { ...o, host: at(sub) });
    const hjson = (method, sub, urlPath, value, o = {}) => hsend(method, sub, urlPath, { ...o, headers: { ...(o.headers || {}), ...JSONH }, body: bodyOf(value) });
    const hostLogin = await hjson('POST', 'admin', '/api/host/login', { login: 'host', password: 'hostpass1234' });
    same(hostLogin.status, 200, `the host admin signs in: ${hostLogin.text}`);
    const hostCookie = hostLogin.setCookies.map((c) => c.split(';')[0]).join('; ');
    const envs = {};
    for (const slug of ['aaa', 'bbb']) {
      same((await hjson('POST', 'admin', '/api/host/environments', { slug, name: `Env ${slug}`, owner: { login: `own${slug}`, password: 'ownerpass1234' } }, { cookies: hostCookie })).status, 201, `environment ${slug}`);
      const owner = (await hjson('POST', slug, '/api/login', { login: `own${slug}`, password: 'ownerpass1234' })).json.token;
      const asHost = (await hjson('POST', slug, '/api/login', { login: 'host', password: 'hostpass1234' })).json.token;
      same((await hjson('POST', slug, '/api/modules/bundled/vault/install', {}, { cookie: asHost })).status < 300, true, `the Vault installs in ${slug}`);
      const on = await hjson('PATCH', slug, '/api/modules/vault', { enabled: true, allSpaces: true }, { cookie: asHost });
      same(on.status, 200, `the Vault is on in ${slug}: ${on.text}`);
      const space = (await hjson('POST', slug, '/api/spaces', { name: 'Trip' }, { cookie: owner })).json.space;
      const up = await hsend('POST', slug, `/api/modules/vault/library?space=${space.id}&name=a.md`, { cookie: owner, headers: { 'content-type': 'text/markdown' }, body: Buffer.from(`# ${slug}\n`) });
      same(up.status, 201, `a file in ${slug}: ${up.text}`);
      const sh = await hjson('POST', slug, `/api/modules/vault/library/shares?space=${space.id}`, { name: 'x', files: [up.json.file.id], days: 1, password: 'password1' }, { cookie: owner });
      same(sh.status, 201, `a link in ${slug}`);
      envs[slug] = { owner, space, file: up.json.file, token: sh.json.token };
    }
    const a = envs.aaa;
    same((await hsend('GET', 'aaa', `/api/shared/${a.token}`, { ip: '10.1.0.1' })).json, LOCKED, 'a link opens on its own environment\'s host');
    const un = await hjson('POST', 'aaa', `/api/shared/${a.token}/unlock`, { password: 'password1' }, { ip: '10.1.0.1' });
    same(un.status, 200, 'and unlocks there');
    const hjar = un.setCookies[0].split(';')[0];
    same((await hsend('GET', 'aaa', `/api/shared/${a.token}`, { ip: '10.1.0.1', cookies: hjar })).status, 200, 'and lists there');
    same((await hsend('GET', 'bbb', `/api/shared/${a.token}`, { ip: '10.1.0.1', cookies: hjar })).json, ENDED, 'on another environment\'s host it has ended, cookie or not');
    same((await hjson('POST', 'bbb', `/api/shared/${a.token}/unlock`, { password: 'password1' }, { ip: '10.1.0.2' })).json, ENDED, 'and can\'t be unlocked there');
    same((await hsend('GET', 'bbb', `/api/shared/${a.token}/files/${a.file.id}/content`, { ip: '10.1.0.1', cookies: hjar })).json, ENDED, 'nor its file read there');
    // bbb's own cookie, made for bbb's link, opens nothing of aaa's (signed with bbb's secret over bbb's link).
    const unB = await hjson('POST', 'bbb', `/api/shared/${envs.bbb.token}/unlock`, { password: 'password1' }, { ip: '10.1.0.3' });
    const bValue = unB.setCookies[0].split(';')[0].split('=')[1];
    same((await hsend('GET', 'aaa', `/api/shared/${a.token}`, { ip: '10.1.0.3', cookies: `share_unlock=${bValue}` })).json, LOCKED, 'another environment\'s cookie opens nothing');
    // The environment's unlock rate (SHARE_UNLOCKS_PER_MINUTE=3 here): aaa has used 1; two more wrong ones from other
    // addresses and the fourth waits, while bbb is not held up by aaa's.
    const rates = [];
    for (const ip of ['10.1.1.1', '10.1.1.2', '10.1.1.3']) rates.push((await hjson('POST', 'aaa', `/api/shared/${a.token}/unlock`, { password: 'nope nope' }, { ip })).status);
    same(rates, [401, 401, 429], `the environment's unlocks per minute are capped (statuses ${rates.join(' ')})`);
    same((await hjson('POST', 'bbb', `/api/shared/${envs.bbb.token}/unlock`, { password: 'password1' }, { ip: '10.1.1.4' })).status, 200, 'and another environment is not held up by it');
    for (const host of ['', 'admin', 'nope']) {
      const r = await hsend('GET', host, `/api/shared/${a.token}`, { ip: '10.1.0.4' });
      ok(r.status === 404 && !r.text.includes('Trip'), `the ${host || 'product'} host: 404, nothing about the link`);
    }
    // Uninstalling with the files kept still ends the links for good.
    const listShareFiles = (dir) => { const out = []; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) out.push(...listShareFiles(f)); else if (e.name.endsWith('.shares.json')) out.push(f); } return out; };
    ok(listShareFiles(H.dataDir).length === 2, 'both environments have a share links file');
    const hostAsAaa = (await hjson('POST', 'aaa', '/api/login', { login: 'host', password: 'hostpass1234' })).json.token;
    same((await hsend('DELETE', 'aaa', '/api/modules/vault?keepData=1', { cookie: hostAsAaa })).status, 200, 'the Vault is uninstalled in aaa with its files kept');
    ok(listShareFiles(H.dataDir).length === 1, 'and aaa\'s share links file is gone, bbb\'s is not');
  }
} catch (err) {
  failed = true;
  console.error(err);
  for (const s of servers) console.error(`--- server log (last 2000) ---\n${s.out().slice(-2000)}`);
} finally {
  for (const s of servers) await s.stop();
  fs.rmSync(base, { recursive: true, force: true });
}
if (failed) process.exit(1);
console.log(`check-vault-share: ${n} checks passed`);
