// The file store behind a module that declares `library` (documentation/plans/plan-attachments-vault.md, sections 2 and 9):
// a space's files, their bytes under VAULT_DIR and their records under DATA_DIR. One store per environment.
//
// On disk:
//   <bytes folder>/space-<space id>/<file id>.bin     the file as kept (a picture cleaned, everything else as sent)
//   <bytes folder>/space-<space id>/<file id>.thumb   its small picture, made by the page
//   <bytes folder>/space-<space id>/.part-<random>    an upload still arriving (or cut off by a restart)
//   DATA_DIR/modules/<module id>/library/space-<space id>.json   the records: { <file id>: record }, so a backup carries them
//   DATA_DIR/modules/<module id>/library/space-<space id>.shares.json   its share links (hashes only), beside them
// The bytes folder is VAULT_DIR/<environment slug> (index.js decides it; DATA_DIR/vault by default, outside the in-app
// backups). Nothing a person sends names a path: a space id and a file id are checked against their patterns, and a
// file's own name lives only in its record. Every write of a record or a thumbnail goes to a temp file first and is
// renamed into place, so a crash leaves the old file or the new one, never half of one. On start the store removes the
// parts and temp files a restart left, and bytes with no record (a crash between the two steps) once they are a week old.
//
// A record: { id, name, type, group, size, sha256, by, at, taken?, camera?, thumb: { type, size } | null }. `size` is the
// bytes of the .bin; what a space or a person uses counts the thumbnail too.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword, verifyPassword } = require('./auth');

const FILE_ID_RE = /^[a-f0-9]{24}$/;
const SPACE_RE = /^[a-z0-9]{4,16}$/;
const MODULE_RE = /^[a-z][a-z0-9-]{1,31}$/;
const PART_PREFIX = '.part-';
const NAME_MAX = 120;
const ORPHAN_MS = 7 * 24 * 60 * 60 * 1000;
const SHARE_ID_RE = /^[a-f0-9]{18}$/;
const SHARE_DAYS = [1, 7, 30];
const SHARES_MAX = 200; // share links in one space
const SHARE_FILES_MAX = 500; // files in one share link
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

class VaultError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// A file's name for its record and for display: one line, at most 120 characters, without path separators, control
// characters or the invisible ones that turn text around ("gpj.exe" shown as "exe.jpg"), nor dots and spaces at either
// end. Never used on disk.
function cleanName(raw) {
  const s = String(raw == null ? '' : raw)
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/[/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim();
  // Trailing dots and spaces go too ("x.pdf." would become "x.pdf..pdf").
  return Array.from(s).slice(0, NAME_MAX).join('').replace(/[.\s]+$/, '');
}

// The name's extension, lower case, without the dot ('' for none).
function extensionOf(name) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

// The name with the type's own extension: kept when it already has one of `exts`, added when it has none. The caller has
// already refused a name whose extension says another type.
function nameForType(name, exts) {
  const ext = extensionOf(name);
  if (ext && exts.includes(ext)) return name;
  const base = Array.from(name).slice(0, NAME_MAX - exts[0].length - 1).join('').trim() || 'file';
  return `${base}.${exts[0]}`;
}

// Writes `data` to `file` by way of a temp file beside it and a rename.
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

class VaultStore {
  // `bytesDir`: this environment's folder under VAULT_DIR. `modulesDir`: DATA_DIR/modules, where the records go.
  // `onBytes(delta)` is told every change in the bytes kept, for a total across environments.
  constructor({ bytesDir, modulesDir, now = () => Date.now(), onBytes = () => {} }) {
    this.bytesDir = bytesDir;
    this.modulesDir = modulesDir;
    this.now = now;
    this.onBytes = onBytes;
    this.cache = new Map(); // "<module>|<space>" -> Map(file id -> record)
    this.shareCache = new Map(); // "<module>|<space>" -> Map(share id -> share)
    this.totals = null; // { all, spaces: Map(space -> bytes), people: Map(key -> bytes), files } once counted
    this.swept = this.sweep();
  }

  spaceDir(spaceId) {
    if (!SPACE_RE.test(String(spaceId))) throw new VaultError('not a valid id');
    return path.join(this.bytesDir, `space-${spaceId}`);
  }

  recordFile(moduleId, spaceId) {
    if (!MODULE_RE.test(String(moduleId))) throw new VaultError('not a valid id');
    if (!SPACE_RE.test(String(spaceId))) throw new VaultError('not a valid id');
    return path.join(this.modulesDir, moduleId, 'library', `space-${spaceId}.json`);
  }

  // Where a file's bytes (or its thumbnail) are, or null for an id that is not one.
  filePath(spaceId, fid, thumb = false) {
    if (!FILE_ID_RE.test(String(fid))) return null;
    return path.join(this.spaceDir(spaceId), `${fid}.${thumb ? 'thumb' : 'bin'}`);
  }

  records(moduleId, spaceId) {
    const key = `${moduleId}|${spaceId}`;
    let map = this.cache.get(key);
    if (map) return map;
    map = new Map();
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(this.recordFile(moduleId, spaceId), 'utf8'));
    } catch (err) {
      if (err instanceof VaultError) throw err;
      // nothing kept yet
    }
    if (raw && typeof raw === 'object') for (const [fid, r] of Object.entries(raw)) if (FILE_ID_RE.test(fid) && r && typeof r === 'object') map.set(fid, r);
    this.cache.set(key, map);
    return map;
  }

  save(moduleId, spaceId) {
    const map = this.records(moduleId, spaceId);
    const file = this.recordFile(moduleId, spaceId);
    if (!map.size) return void fs.rmSync(file, { force: true });
    writeAtomic(file, JSON.stringify(Object.fromEntries(map)));
  }

  list(moduleId, spaceId) {
    return [...this.records(moduleId, spaceId).values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }

  get(moduleId, spaceId, fid) {
    if (!FILE_ID_RE.test(String(fid))) return null;
    return this.records(moduleId, spaceId).get(fid) || null;
  }

  newId() {
    return crypto.randomBytes(12).toString('hex');
  }

  // A new part file for an upload into the space: its path. The folder is made when it is missing.
  newPart(spaceId) {
    const dir = this.spaceDir(spaceId);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${PART_PREFIX}${crypto.randomBytes(8).toString('hex')}`);
  }

  // A part file of this store, or false: so a caller can never hand in a path of its own.
  isPart(spaceId, part) {
    return typeof part === 'string' && path.dirname(part) === this.spaceDir(spaceId) && path.basename(part).startsWith(PART_PREFIX);
  }

  // Keep an upload: the part becomes <id>.bin and the record is written. A failure takes the bytes back out, so there is
  // never a record without its bytes. Answers the record.
  commit(moduleId, spaceId, part, record) {
    if (!this.isPart(spaceId, part)) throw new VaultError('bad part');
    const fid = record.id;
    const final = this.filePath(spaceId, fid);
    if (!final) throw new VaultError('bad file id');
    fs.renameSync(part, final);
    const map = this.records(moduleId, spaceId);
    map.set(fid, record);
    try {
      this.save(moduleId, spaceId);
    } catch (err) {
      map.delete(fid);
      fs.rmSync(final, { force: true });
      throw err;
    }
    this.count(spaceId, record.by, this.bytesOf(record));
    return record;
  }

  // A file's thumbnail (already checked by the caller): written beside it and noted on its record.
  putThumb(moduleId, spaceId, fid, bytes, type) {
    const r = this.get(moduleId, spaceId, fid);
    if (!r) throw new VaultError('no such file', 404);
    const before = this.bytesOf(r);
    writeAtomic(this.filePath(spaceId, fid, true), bytes);
    r.thumb = { type, size: bytes.length };
    this.save(moduleId, spaceId);
    this.count(spaceId, r.by, this.bytesOf(r) - before);
    return r;
  }

  rename(moduleId, spaceId, fid, name) {
    const r = this.get(moduleId, spaceId, fid);
    if (!r) throw new VaultError('no such file', 404);
    r.name = name;
    this.save(moduleId, spaceId);
    return r;
  }

  // Take a file out: its record first (so it is gone for everyone at once), then its bytes and thumbnail.
  remove(moduleId, spaceId, fid) {
    const r = this.get(moduleId, spaceId, fid);
    if (!r) return false;
    this.records(moduleId, spaceId).delete(fid);
    this.save(moduleId, spaceId);
    this.dropFromShares(moduleId, spaceId, fid);
    for (const thumb of [false, true]) fs.rmSync(this.filePath(spaceId, fid, thumb), { force: true });
    this.count(spaceId, r.by, -this.bytesOf(r));
    return true;
  }

  // --- share links (plan section 7; the public routes are step 5) ---------------------------------------------------
  // Kept beside the records, in DATA_DIR/modules/<id>/library/space-<space id>.shares.json, never in the module's data, so
  // no data route (which reads only DATA_DIR/modules/<id>/data/) and no `access.read` reader can see them. A share:
  // { id, name, files, by, at, ends, download, passwordHash?, tokenHash, opened }. The token (32 random bytes) is given
  // to its maker once and only its SHA-256 is kept; a password only as scrypt (server/auth.js).
  sharesFile(moduleId, spaceId) {
    return this.recordFile(moduleId, spaceId).replace(/\.json$/, '.shares.json');
  }

  shareMap(moduleId, spaceId) {
    const key = `${moduleId}|${spaceId}`;
    let map = this.shareCache.get(key);
    if (map) return map;
    map = new Map();
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(this.sharesFile(moduleId, spaceId), 'utf8')); } catch (err) { if (err instanceof VaultError) throw err; }
    if (raw && typeof raw === 'object') for (const [id, s] of Object.entries(raw)) if (SHARE_ID_RE.test(id) && s && typeof s === 'object' && /^[a-f0-9]{64}$/.test(String(s.tokenHash))) map.set(id, s);
    this.shareCache.set(key, map);
    return map;
  }

  saveShares(moduleId, spaceId) {
    const map = this.shareMap(moduleId, spaceId);
    const file = this.sharesFile(moduleId, spaceId);
    if (!map.size) return void fs.rmSync(file, { force: true });
    writeAtomic(file, JSON.stringify(Object.fromEntries(map)));
  }

  // A share without what is secret, for its maker and owners: { id, name, files, by, at, ends, download, hasPassword, opened }.
  shareView(s) {
    return { id: s.id, name: s.name, files: [...s.files], by: s.by, at: s.at, ends: s.ends, download: Boolean(s.download), hasPassword: Boolean(s.passwordHash), opened: Number(s.opened) || 0 };
  }

  // A new share link for files of the space: { share (its view), token } -- the token only here, never again.
  // `days` is 1, 7 or 30 (plan decision 15); `password` optional; every file must be one of the space's.
  createShare(moduleId, spaceId, { name, files, by, days = 7, download = false, password = '' }) {
    const clean = cleanName(name);
    if (!clean) throw new VaultError('Give the share link a name.');
    if (!SHARE_DAYS.includes(days)) throw new VaultError('A share link ends after 1, 7 or 30 days.');
    const list = [...new Set(Array.isArray(files) ? files.map(String) : [])];
    if (!list.length) throw new VaultError('Choose the files to share.');
    if (list.length > SHARE_FILES_MAX) throw new VaultError(`A share link holds at most ${SHARE_FILES_MAX} files.`);
    if (list.some((fid) => !this.get(moduleId, spaceId, fid))) throw new VaultError('There is no such file.', 404);
    if (typeof password !== 'string' || password.length > 200) throw new VaultError('That password is too long.');
    const map = this.shareMap(moduleId, spaceId);
    if (map.size >= SHARES_MAX) throw new VaultError(`There are already ${SHARES_MAX} share links here. Turn some off first.`, 409);
    const token = crypto.randomBytes(32).toString('base64url');
    const at = this.now();
    const share = { id: crypto.randomBytes(9).toString('hex'), name: clean, files: list, by: String(by), at: new Date(at).toISOString(), ends: new Date(at + days * 86400000).toISOString(), download: Boolean(download), ...(password ? { passwordHash: hashPassword(password) } : {}), tokenHash: sha256(token), opened: 0 };
    map.set(share.id, share);
    try {
      this.saveShares(moduleId, spaceId);
    } catch (err) {
      map.delete(share.id);
      throw err;
    }
    return { share: this.shareView(share), token };
  }

  listShares(moduleId, spaceId) {
    this.dropEndedShares(moduleId, spaceId);
    return [...this.shareMap(moduleId, spaceId).values()].map((s) => this.shareView(s)).sort((a, b) => a.at.localeCompare(b.at));
  }

  // A share link past its end opens nothing and can't be made to again, so it goes (plan section 7, "by itself at its
  // end"): from the list, and so from the 200 a space may hold.
  dropEndedShares(moduleId, spaceId) {
    const map = this.shareMap(moduleId, spaceId);
    let changed = false;
    for (const [id, s] of map) if (!(Date.parse(s.ends) > this.now())) { map.delete(id); changed = true; }
    if (changed) this.saveShares(moduleId, spaceId);
  }

  // The stored share by its id, or null.
  getShare(moduleId, spaceId, id) {
    if (!SHARE_ID_RE.test(String(id))) return null;
    return this.shareMap(moduleId, spaceId).get(String(id)) || null;
  }

  // A share's name or its set of files changed (its maker or an owner, plan section 7): answers its view. Every file
  // must be one of the space's; a set may not be emptied (Turn off ends a link).
  updateShare(moduleId, spaceId, id, { name, files } = {}) {
    const s = this.getShare(moduleId, spaceId, id);
    if (!s || !(Date.parse(s.ends) > this.now())) throw new VaultError('There is no such share link.', 404);
    let nextName = s.name;
    let nextFiles = s.files;
    if (name !== undefined) {
      nextName = cleanName(name);
      if (!nextName) throw new VaultError('Give the share link a name.');
    }
    if (files !== undefined) {
      nextFiles = [...new Set(Array.isArray(files) ? files.map(String) : [])];
      if (!nextFiles.length) throw new VaultError('Choose the files to share.');
      if (nextFiles.length > SHARE_FILES_MAX) throw new VaultError(`A share link holds at most ${SHARE_FILES_MAX} files.`);
      if (nextFiles.some((fid) => !this.get(moduleId, spaceId, fid))) throw new VaultError('There is no such file.', 404);
    }
    const before = { name: s.name, files: s.files };
    s.name = nextName;
    s.files = nextFiles;
    try {
      this.saveShares(moduleId, spaceId);
    } catch (err) {
      Object.assign(s, before);
      throw err;
    }
    return this.shareView(s);
  }

  // One more opening of a share link (its maker sees the count; no address or person is kept).
  noteShareOpened(moduleId, spaceId, id) {
    const s = this.getShare(moduleId, spaceId, id);
    if (!s) return;
    s.opened = (Number(s.opened) || 0) + 1;
    // Written a few seconds later, once for a burst of openings; the count in memory is what the maker reads. A space
    // forgotten meanwhile reads back as having no links, so nothing comes back.
    const key = `${moduleId}|${spaceId}`;
    this.openedPending = this.openedPending || new Set();
    if (this.openedPending.has(key)) return;
    this.openedPending.add(key);
    setTimeout(() => {
      this.openedPending.delete(key);
      if (!this.shareCache.has(key)) return;
      try { this.saveShares(moduleId, spaceId); } catch { /* a count is not worth an error */ }
    }, 5000).unref();
  }

  // The ids of the space's files in a share link that still opens, for the "Shared" mark in the list.
  sharedFileIds(moduleId, spaceId) {
    const out = new Set();
    const now = this.now();
    for (const s of this.shareMap(moduleId, spaceId).values()) if (Date.parse(s.ends) > now) for (const fid of s.files) out.add(fid);
    return out;
  }

  // Turn a share link off: true when there was one.
  revokeShare(moduleId, spaceId, id) {
    const map = this.shareMap(moduleId, spaceId);
    if (!map.delete(String(id))) return false;
    this.saveShares(moduleId, spaceId);
    return true;
  }

  // The share a token opens, among a module's spaces: { spaceId, share } (the stored record), or null for a wrong, ended
  // or emptied one. Every share's hash is compared in constant time, so how long it takes says nothing about the token.
  findShareByToken(moduleId, token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const want = Buffer.from(sha256(token), 'hex');
    let found = null;
    for (const spaceId of this.shareSpacesOf(moduleId)) {
      for (const s of this.shareMap(moduleId, spaceId).values()) {
        if (crypto.timingSafeEqual(want, Buffer.from(s.tokenHash, 'hex')) && !found) found = { spaceId, share: s };
      }
    }
    if (!found || Date.parse(found.share.ends) <= this.now() || !found.share.files.length) return null;
    return found;
  }

  // Whether `password` opens the share (true when it has none).
  sharePasswordOk(share, password) {
    return !share.passwordHash || verifyPassword(String(password || ''), share.passwordHash);
  }

  // The spaces a module has share links in.
  shareSpacesOf(moduleId) {
    let names = [];
    try { names = fs.readdirSync(path.join(this.modulesDir, moduleId, 'library')); } catch { /* none */ }
    return names.map((n) => /^space-([a-z0-9]{4,16})\.shares\.json$/.exec(n)?.[1]).filter(Boolean);
  }

  // A file removed is taken out of every share of its space; a share left with no file ends.
  dropFromShares(moduleId, spaceId, fid) {
    const map = this.shareMap(moduleId, spaceId);
    let changed = false;
    for (const [id, s] of map) {
      if (!s.files.includes(fid)) continue;
      s.files = s.files.filter((f) => f !== fid);
      if (!s.files.length) map.delete(id);
      changed = true;
    }
    if (changed) this.saveShares(moduleId, spaceId);
  }

  // A deleted space takes its files: the space's bytes folder and every module's records for it. Answers how many files went.
  forgetSpace(spaceId) {
    if (!SPACE_RE.test(String(spaceId))) return 0;
    let gone = 0;
    for (const moduleId of this.libraryModules()) {
      fs.rmSync(this.sharesFile(moduleId, spaceId), { force: true }); // and its share links
      this.shareCache.delete(`${moduleId}|${spaceId}`);
      const file = this.recordFile(moduleId, spaceId);
      if (!fs.existsSync(file)) { this.cache.delete(`${moduleId}|${spaceId}`); continue; }
      const map = this.records(moduleId, spaceId);
      gone += map.size;
      for (const r of map.values()) this.count(spaceId, r.by, -this.bytesOf(r));
      fs.rmSync(file, { force: true });
      this.cache.delete(`${moduleId}|${spaceId}`);
    }
    fs.rmSync(this.spaceDir(spaceId), { recursive: true, force: true });
    return gone;
  }

  // A module uninstalled with its data takes its files: in every space, each file's bytes and small picture, then its
  // records and what is kept of them in memory. Answers how many files went.
  forgetModule(moduleId) {
    if (!MODULE_RE.test(String(moduleId))) return 0;
    let gone = 0;
    for (const spaceId of this.spacesOf(moduleId)) {
      const map = this.records(moduleId, spaceId);
      for (const r of map.values()) {
        for (const thumb of [false, true]) { const f = this.filePath(spaceId, r.id, thumb); if (f) fs.rmSync(f, { force: true }); }
        this.count(spaceId, r.by, -this.bytesOf(r));
        gone += 1;
      }
    }
    // Every space's folder goes too once nothing is left in it (another library module's files may still be there).
    let folders = [];
    try { folders = fs.readdirSync(this.bytesDir).filter((n) => /^space-[a-z0-9]{4,16}$/.test(n)); } catch { /* none */ }
    for (const n of folders) { try { fs.rmdirSync(path.join(this.bytesDir, n)); } catch { /* not empty */ } }
    for (const key of [...this.cache.keys()]) if (key.startsWith(`${moduleId}|`)) this.cache.delete(key);
    for (const key of [...this.shareCache.keys()]) if (key.startsWith(`${moduleId}|`)) this.shareCache.delete(key); // its share links go with the folder
    fs.rmSync(path.join(this.modulesDir, moduleId, 'library'), { recursive: true, force: true });
    return gone;
  }

  bytesOf(r) {
    return (Number(r.size) || 0) + (Number(r.thumb?.size) || 0);
  }

  // The modules with records here (folders under DATA_DIR/modules with a library folder).
  libraryModules() {
    let names = [];
    try { names = fs.readdirSync(this.modulesDir, { withFileTypes: true }).filter((d) => d.isDirectory() && MODULE_RE.test(d.name)).map((d) => d.name); } catch { /* none */ }
    return names.filter((id) => fs.existsSync(path.join(this.modulesDir, id, 'library')));
  }

  // The spaces a module has records for.
  spacesOf(moduleId) {
    let names = [];
    try { names = fs.readdirSync(path.join(this.modulesDir, moduleId, 'library')); } catch { /* none */ }
    return names.map((n) => /^space-([a-z0-9]{4,16})\.json$/.exec(n)?.[1]).filter(Boolean);
  }

  // What this environment's files use, counted once from the records and kept up to date by every change here:
  // { all, files, spaces: Map(space -> bytes), people: Map(person key -> bytes) }.
  usage() {
    if (this.totals) return this.totals;
    const t = { all: 0, files: 0, spaces: new Map(), people: new Map() };
    for (const moduleId of this.libraryModules()) {
      for (const spaceId of this.spacesOf(moduleId)) {
        for (const r of this.records(moduleId, spaceId).values()) {
          const b = this.bytesOf(r);
          t.all += b;
          t.files += 1;
          t.spaces.set(spaceId, (t.spaces.get(spaceId) || 0) + b);
          t.people.set(r.by, (t.people.get(r.by) || 0) + b);
        }
      }
    }
    this.totals = t;
    return t;
  }

  count(spaceId, by, delta) {
    if (!delta) return;
    this.onBytes(delta);
    if (!this.totals) return;
    const add = (map, k) => { const v = (map.get(k) || 0) + delta; if (v > 0) map.set(k, v); else map.delete(k); };
    this.totals.all += delta;
    add(this.totals.spaces, spaceId);
    add(this.totals.people, by);
  }

  // Removes what a restart left behind: every part and temp file in the bytes folders (nothing is arriving while the
  // store is made), temp files beside the records, and bytes no module's record names once they are a week old.
  // Answers what went: { parts, orphans }.
  sweep() {
    const out = { parts: 0, orphans: 0 };
    let spaces = [];
    try { spaces = fs.readdirSync(this.bytesDir).filter((n) => /^space-[a-z0-9]{4,16}$/.test(n)); } catch { return out; }
    const known = new Map(); // space id -> Set(file id)
    for (const moduleId of this.libraryModules()) {
      for (const spaceId of this.spacesOf(moduleId)) {
        const set = known.get(spaceId) || new Set();
        for (const fid of this.records(moduleId, spaceId).keys()) set.add(fid);
        known.set(spaceId, set);
      }
      try {
        for (const n of fs.readdirSync(path.join(this.modulesDir, moduleId, 'library'))) if (n.endsWith('.tmp')) fs.rmSync(path.join(this.modulesDir, moduleId, 'library', n), { force: true });
      } catch { /* gone */ }
    }
    for (const folder of spaces) {
      const dir = path.join(this.bytesDir, folder);
      const spaceId = folder.slice('space-'.length);
      let names = [];
      try { names = fs.readdirSync(dir); } catch { continue; }
      for (const n of names) {
        const full = path.join(dir, n);
        try {
          if (n.startsWith(PART_PREFIX) || n.endsWith('.tmp')) {
            fs.rmSync(full, { force: true });
            out.parts += 1;
            continue;
          }
          const m = /^([a-f0-9]{24})\.(bin|thumb)$/.exec(n);
          if (!m || known.get(spaceId)?.has(m[1])) continue;
          if (this.now() - fs.statSync(full).mtimeMs > ORPHAN_MS) {
            fs.rmSync(full, { force: true });
            if (m[2] === 'bin') out.orphans += 1;
          }
        } catch { /* gone meanwhile */ }
      }
    }
    return out;
  }
}

// The bytes under a folder, for VAULT_MAX_GB: every file, counted once when the server starts.
function folderBytes(dir) {
  let total = 0;
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const d of names) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) total += folderBytes(full);
    else if (d.isFile()) { try { total += fs.statSync(full).size; } catch { /* gone */ } }
  }
  return total;
}

module.exports = { VaultStore, VaultError, cleanName, extensionOf, nameForType, folderBytes, FILE_ID_RE, PART_PREFIX, NAME_MAX };
