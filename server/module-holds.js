// Clear's Undo: what a Clear (DELETE /api/modules/:id/data) took from one module in one scope is held here for 30 seconds,
// plus a few seconds' grace for a slow network, instead of going for good. The values leave the module's data at once; the
// uploaded files they name stay on disk, and what the clear would do to other modules (their dated copies, their pointers)
// waits. Undo (POST .../data/restore) takes the hold back whole; when the time is over, onExpire finishes the clear.
//
// One hold per module and scope (a space, the environment, one person): a second Clear there is refused while it waits
// (index.js says how long). Holds live on disk, DATA_DIR/modules/<id>/trash/<scope>.json (environment.json, space-<id>.json,
// person-<key>.json), so a page closed mid-undo or a restart loses nothing: the server re-arms each hold when it starts,
// and finishes those whose time ran out while it was down; a hold file it can't read is logged and set aside as
// <name>.bad, so nothing waits on it for ever. Only the timers, and what became of recent tokens (so a refused Undo
// can say why), are in memory. A hold is never bigger than
// what the module could store (its data cap, 5 MB), and holds go in the order they were made.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { moduleFolders } = require('./module-data');

const HOLD_SECONDS = 30;
const GRACE_MS = 5000;
const SPACE_RE = /^[a-z0-9]{4,16}$/;
const PERSON_RE = /^[a-z0-9]{4,40}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const KEPT_ENDS = 500; // how many finished tokens are remembered, for why()

function nameOfScope(scopeKey) {
  if (scopeKey === 'environment') return 'environment.json';
  const s = /^space:(.+)$/.exec(scopeKey);
  if (s && SPACE_RE.test(s[1])) return `space-${s[1]}.json`;
  const p = /^person:(.+)$/.exec(scopeKey);
  if (p && PERSON_RE.test(p[1])) return `person-${p[1]}.json`;
  return null;
}
function scopeOfName(name) {
  if (name === 'environment.json') return 'environment';
  const s = /^space-(.+)\.json$/.exec(name);
  if (s && SPACE_RE.test(s[1])) return `space:${s[1]}`;
  const p = /^person-(.+)\.json$/.exec(name);
  if (p && PERSON_RE.test(p[1])) return `person:${p[1]}`;
  return null;
}

class ModuleHolds {
  constructor(modulesDir, { holdSeconds = HOLD_SECONDS, graceMs = GRACE_MS, log = console.error } = {}) {
    this.dir = modulesDir;
    this.seconds = holdSeconds; // how long a Clear can be undone (CLEAR_UNDO_SECONDS)
    this.holdMs = holdSeconds * 1000;
    this.graceMs = graceMs;
    this.log = log;
    this.timers = new Map(); // "id|scopeKey" -> timeout
    this.ends = new Map(); // "id|scopeKey|token" -> 'undone' or 'over': what became of a hold, newest last
    this.stopped = false;
    // Set by the server: runIn(fn) runs a timer's work in this environment; onExpire(hold) finishes a clear whose time is over.
    this.runIn = (fn) => fn();
    this.onExpire = null;
    this.sweep();
  }

  fileFor(id, scopeKey) {
    const name = ID_RE.test(String(id)) ? nameOfScope(scopeKey) : null;
    return name ? path.join(this.dir, id, 'trash', name) : null;
  }

  read(id, scopeKey) {
    const file = this.fileFor(id, scopeKey);
    if (!file) return null;
    try {
      const h = JSON.parse(fs.readFileSync(file, 'utf8'));
      return h && typeof h === 'object' && Array.isArray(h.items) ? { ...h, files: Array.isArray(h.files) ? h.files : [] } : null;
    } catch {
      return null;
    }
  }

  // The hold here while its time runs (the grace included), else null; one whose time is over is finished now.
  peek(id, scopeKey) {
    const h = this.read(id, scopeKey);
    if (!h) return null;
    if (Date.parse(h.expiresAt) <= Date.now()) { this.expire(id, scopeKey); return null; }
    return h;
  }

  // Holds what a clear took: items ({ key, value, version, updatedAt, by }, as stored), the upload ids they name, who
  // cleared and their zone. Never over a hold still waiting here (the caller refuses that clear: peek first); one whose
  // time is over is finished first. Answers { token, undoUntil, expiresAt, seconds }.
  hold(id, scopeKey, { items, files = [], by = '', tz = null }) {
    const file = this.fileFor(id, scopeKey);
    if (!file) throw new Error('bad scope for a hold');
    if (this.peek(id, scopeKey)) throw new Error('a hold is already waiting here');
    const now = Date.now();
    const h = {
      token: crypto.randomBytes(16).toString('hex'),
      module: id,
      scopeKey,
      by: String(by).slice(0, 40),
      tz: typeof tz === 'string' ? tz.slice(0, 64) : null,
      at: new Date(now).toISOString(),
      undoUntil: new Date(now + this.holdMs).toISOString(),
      expiresAt: new Date(now + this.holdMs + this.graceMs).toISOString(),
      files: [...new Set(files)],
      items,
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(h));
    fs.renameSync(`${file}.tmp`, file);
    this.arm(id, scopeKey, now + this.holdMs + this.graceMs);
    return { token: h.token, undoUntil: h.undoUntil, expiresAt: h.expiresAt, seconds: this.seconds };
  }

  // The hold, taken out of here for an Undo, when `token` is the one its clear answered and its time is not over; else null.
  take(id, scopeKey, token) {
    const h = this.peek(id, scopeKey);
    if (!h || typeof token !== 'string' || token !== h.token) return null;
    this.drop(id, scopeKey, 'undone');
    return h;
  }

  // Why `token` no longer undoes anything here: 'undone' (its Undo was done), 'replaced' (another clear's hold is here
  // now) or 'over' (its time ran out, or it is not known: a restart forgets what became of a token).
  why(id, scopeKey, token) {
    const end = this.ends.get(`${id}|${scopeKey}|${token}`);
    if (end) return end;
    const h = this.read(id, scopeKey);
    return h && h.token !== token ? 'replaced' : 'over';
  }

  noteEnd(id, scopeKey, token, end) {
    if (typeof token !== 'string' || !token) return;
    const key = `${id}|${scopeKey}|${token}`;
    this.ends.delete(key);
    this.ends.set(key, end);
    while (this.ends.size > KEPT_ENDS) this.ends.delete(this.ends.keys().next().value);
  }

  // Whether a hold here keeps this upload (the upload sweeps and a file's delete leave it alone).
  holdsFile(id, scopeKey, fid) {
    const h = this.read(id, scopeKey);
    return Boolean(h && h.files.includes(fid));
  }

  // The hold goes, and the clear is finished (onExpire): its files, what other modules kept of its objects.
  expire(id, scopeKey) {
    const h = this.read(id, scopeKey);
    this.drop(id, scopeKey, 'over');
    if (h && typeof this.onExpire === 'function') {
      try { this.onExpire(h); } catch (err) { console.error(`A cleared ${id} could not be finished: ${err.stack || err.message}`); }
    }
  }

  // The hold goes, unfinished; `end` ('undone', 'over') is remembered against its token for why().
  drop(id, scopeKey, end = null) {
    const key = `${id}|${scopeKey}`;
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    if (end) { const h = this.read(id, scopeKey); if (h) this.noteEnd(id, scopeKey, h.token, end); }
    const file = this.fileFor(id, scopeKey);
    if (file) { fs.rmSync(file, { force: true }); fs.rmSync(`${file}.tmp`, { force: true }); }
  }

  // Every timer stops (the environment is set aside: deleted, or replaced by a backup). The holds stay on disk as they
  // are; whoever reads this folder next (a new ModuleHolds) finishes them.
  stop() {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  arm(id, scopeKey, at) {
    if (this.stopped) return;
    const key = `${id}|${scopeKey}`;
    clearTimeout(this.timers.get(key));
    const t = setTimeout(() => {
      this.timers.delete(key);
      if (this.stopped) return;
      this.runIn(() => { if (this.read(id, scopeKey)) this.expire(id, scopeKey); });
    }, Math.max(0, at - Date.now()));
    if (t.unref) t.unref();
    this.timers.set(key, t);
  }

  // Every module's holds as found on disk: each is armed for the time it has left, or for now when that is over. One
  // that can't be read is logged and renamed <name>.bad: it is never finished, and the files it may name are left.
  sweep() {
    for (const id of moduleFolders(this.dir)) {
      let names = [];
      try { names = fs.readdirSync(path.join(this.dir, id, 'trash')); } catch { continue; }
      for (const n of names) {
        if (n.endsWith('.json.tmp') && scopeOfName(n.slice(0, -4))) { fs.rmSync(path.join(this.dir, id, 'trash', n), { force: true }); continue; }
        const scopeKey = scopeOfName(n);
        if (!scopeKey) continue;
        const h = this.read(id, scopeKey);
        if (!h) { this.quarantine(id, n); continue; }
        this.arm(id, scopeKey, Date.parse(h.expiresAt) || 0);
      }
    }
  }

  quarantine(id, name) {
    const file = path.join(this.dir, id, 'trash', name);
    try {
      fs.renameSync(file, `${file}.bad`);
      this.log(`A held clear of ${id} (${name}) could not be read, so it was set aside as ${name}.bad. What it took does not come back, and any files it named are left where they are.`);
    } catch (err) {
      this.log(`A held clear of ${id} (${name}) could not be read or set aside: ${err.message}`);
    }
  }

  // Every hold of one module, finished now (the module is being removed or turned off).
  expireModule(id) {
    let names = [];
    try { names = fs.readdirSync(path.join(this.dir, id, 'trash')); } catch { return; }
    for (const n of names) {
      const scopeKey = scopeOfName(n);
      if (scopeKey) this.expire(id, scopeKey);
    }
  }

  // A deleted space's holds go with it, unfinished (its data, files and links go by their own steps). Answers how many.
  forgetSpace(spaceId) {
    if (!SPACE_RE.test(spaceId)) return 0;
    let gone = 0;
    for (const id of moduleFolders(this.dir)) {
      if (!this.fileFor(id, `space:${spaceId}`)) continue;
      if (fs.existsSync(this.fileFor(id, `space:${spaceId}`))) gone += 1;
      this.drop(id, `space:${spaceId}`);
    }
    return gone;
  }
}

module.exports = { ModuleHolds, HOLD_SECONDS };
