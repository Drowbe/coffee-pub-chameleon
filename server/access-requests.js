// Request access (documentation/plans/plan-access-bundle.md, step 6): a person who may not enter a space asks to, and an
// owner or the admin answers. One file per environment, <its data folder>/access.json:
//   { requests: [{ id, space, key | guest + name, at, state, until?, decidedBy?, decidedAt? }], grants: [{ guest, space, until }] }
// `state` is pending, approved, denied, withdrawn or expired. A request by a guest holds `until`, the end of that guest's
// session, so an approval can never outlive it. A grant is a door guest's entry to one space, good until `until`.
// Every method is synchronous from its check to its write, so two answers to one request cannot both win. Written whole
// each time (a temporary file, then a rename), private to the server's own user; a file that is there and cannot be read
// is never written over (it is set aside, said once, and a new one begun). Bounded: old answers are dropped, and the file
// refuses new requests past MAX_REQUESTS.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DAY = 24 * 3600000;
const KEPT_MS = 30 * DAY;
const MAX_REQUESTS = 5000;
const STATES = ['pending', 'approved', 'denied', 'withdrawn', 'expired'];
const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
const GUEST_RE = /^guest-[A-Za-z0-9_-]{4,40}$/;
const SPACE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const whole = (value, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

// The limits, from the environment variables, at the decided defaults.
function readLimits(env = process.env) {
  return {
    perDay: whole(env.ACCESS_REQUESTS_PER_DAY, 5), // per person, in 24 hours
    perAddress: whole(env.ACCESS_REQUESTS_PER_ADDRESS, 20), // per address, in 24 hours
    pendingPerSpace: whole(env.ACCESS_REQUESTS_PENDING_PER_SPACE, 50), // waiting at once, per space
    days: whole(env.ACCESS_REQUEST_DAYS, 7), // a request ends after
  };
}

class AccessRequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function cleanRequest(r) {
  if (!isObject(r) || typeof r.id !== 'string' || !/^[a-f0-9]{16}$/.test(r.id)) return null;
  if (typeof r.space !== 'string' || !SPACE_RE.test(r.space) || !STATES.includes(r.state)) return null;
  if (typeof r.at !== 'number' || !Number.isFinite(r.at)) return null;
  const out = { id: r.id, space: r.space, at: r.at, state: r.state };
  if (typeof r.key === 'string' && KEY_RE.test(r.key)) out.key = r.key;
  else if (typeof r.guest === 'string' && GUEST_RE.test(r.guest) && typeof r.name === 'string' && r.name) {
    out.guest = r.guest;
    out.name = r.name.slice(0, 200);
    if (typeof r.until === 'number' && Number.isFinite(r.until)) out.until = r.until;
  } else return null;
  if (typeof r.decidedBy === 'string') out.decidedBy = r.decidedBy.slice(0, 64);
  if (typeof r.decidedAt === 'number' && Number.isFinite(r.decidedAt)) out.decidedAt = r.decidedAt;
  return out;
}
function cleanGrant(g) {
  if (!isObject(g) || typeof g.guest !== 'string' || !GUEST_RE.test(g.guest)) return null;
  if (typeof g.space !== 'string' || !SPACE_RE.test(g.space) || typeof g.until !== 'number' || !Number.isFinite(g.until)) return null;
  return { guest: g.guest, space: g.space, until: g.until };
}

class AccessRequests {
  constructor(dir, { log = console.warn, limits = readLimits(), max = MAX_REQUESTS } = {}) {
    this.dir = dir;
    this.file = path.join(dir, 'access.json');
    this.log = log;
    this.limits = limits;
    this.max = max;
    this.requests = [];
    this.grants = [];
    this.load();
  }

  load() {
    let text;
    try { text = fs.readFileSync(this.file, 'utf8'); } catch (err) {
      if (err.code === 'ENOENT') return;
      text = null;
    }
    let raw = null;
    if (text !== null) { try { raw = JSON.parse(text); } catch { raw = null; } }
    if (!isObject(raw) || (raw.requests !== undefined && !Array.isArray(raw.requests)) || (raw.grants !== undefined && !Array.isArray(raw.grants))) {
      const aside = path.join(this.dir, `access.unreadable-${Date.now()}.json`);
      try { fs.renameSync(this.file, aside); } catch { throw new Error('The access requests file could not be read or moved out of the way.'); }
      this.log(`${this.file} could not be read as access requests, so it was kept as ${aside} and a new one begun.`);
      return;
    }
    const seen = new Set();
    for (const r of raw.requests || []) {
      const kept = cleanRequest(r);
      if (!kept || seen.has(kept.id)) continue;
      seen.add(kept.id);
      this.requests.push(kept);
    }
    for (const g of raw.grants || []) {
      const kept = cleanGrant(g);
      if (kept) this.grants.push(kept);
    }
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ requests: this.requests, grants: this.grants }, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, this.file);
  }

  // Writes; when the write fails the memory is put back, so nothing is told that the disk does not hold.
  commit(undo) {
    try { this.save(); } catch (err) { undo(); throw err; }
  }

  endsAt(r) { return r.at + this.limits.days * DAY; }

  // A pending request past its days (or a guest's session) reads as expired, with or without having been swept.
  stateOf(r, now = Date.now()) {
    if (r.state !== 'pending') return r.state;
    return now >= this.endsAt(r) || (r.until !== undefined && now >= r.until) ? 'expired' : 'pending';
  }

  // Marks what has run out and drops what is old. Returns whether anything changed.
  sweep(now = Date.now()) {
    let changed = false;
    for (const r of this.requests) {
      if (r.state === 'pending' && this.stateOf(r, now) === 'expired') { r.state = 'expired'; r.decidedAt = now; changed = true; }
    }
    const keep = this.requests.filter((r) => r.state === 'pending' || now - (r.decidedAt || r.at) < KEPT_MS);
    if (keep.length !== this.requests.length) { this.requests = keep; changed = true; }
    const grants = this.grants.filter((g) => g.until > now);
    if (grants.length !== this.grants.length) { this.grants = grants; changed = true; }
    return changed;
  }

  mine(r, who) { return who.key ? r.key === who.key : Boolean(who.guest) && r.guest === who.guest; }

  // The pending request this person has for this space, or null.
  pendingOf(space, who, now = Date.now()) {
    return this.requests.find((r) => r.space === space && this.mine(r, who) && this.stateOf(r, now) === 'pending') || null;
  }

  // The last answer to this person's request for the space (denied or approved), newest first, or null.
  lastAnswer(space, who) {
    const answered = this.requests.filter((r) => r.space === space && this.mine(r, who) && (r.state === 'approved' || r.state === 'denied'));
    return answered.length ? answered.reduce((a, b) => ((b.decidedAt || 0) > (a.decidedAt || 0) ? b : a)) : null;
  }

  // Asks. who: { key } or { guest, name, until }. Throws AccessRequestError: 409 when one is pending, 429 past the person's
  // daily limit or when too many wait on the space, 503 when the file is full. Returns the request.
  create(space, who, now = Date.now()) {
    if (this.sweep(now)) this.commit(() => {});
    if (this.pendingOf(space, who, now)) throw new AccessRequestError('You have asked already. Wait for an answer.', 409);
    const recent = this.requests.filter((r) => this.mine(r, who) && now - r.at < DAY).length;
    if (recent >= this.limits.perDay) throw new AccessRequestError('You have asked as many times as you can today. Try again tomorrow.', 429);
    const waiting = this.requests.filter((r) => r.space === space && this.stateOf(r, now) === 'pending').length;
    if (waiting >= this.limits.pendingPerSpace) throw new AccessRequestError('Too many people are waiting to be let in. Try again later.', 429);
    if (this.requests.length >= this.max) throw new AccessRequestError('Requests cannot be taken right now. Tell whoever runs this server.', 503);
    const r = { id: crypto.randomBytes(8).toString('hex'), space, at: now, state: 'pending' };
    if (who.key) r.key = who.key;
    else {
      r.guest = who.guest;
      r.name = String(who.name || '').slice(0, 200);
      if (Number.isFinite(who.until)) r.until = who.until;
    }
    this.requests.push(r);
    this.commit(() => { this.requests.pop(); });
    return { ...r };
  }

  // The requester takes it back. Returns the request, or null when there was none pending.
  withdraw(space, who, now = Date.now()) {
    const r = this.pendingOf(space, who, now);
    if (!r) return null;
    r.state = 'withdrawn';
    r.decidedAt = now;
    this.commit(() => { r.state = 'pending'; delete r.decidedAt; });
    return { ...r };
  }

  // The pending ones for a space, oldest first.
  pendingFor(space, now = Date.now()) {
    return this.requests.filter((r) => r.space === space && this.stateOf(r, now) === 'pending').sort((a, b) => a.at - b.at).map((r) => ({ ...r }));
  }

  find(space, id) {
    const r = this.requests.find((x) => x.id === id && x.space === space);
    return r ? { ...r } : null;
  }

  // Answers a request. `decision` is 'approve' or 'deny'; `by` the key of whoever decides. Idempotent: the same answer again
  // changes nothing ({ changed: false }); the other answer, or one to an ended request, is a 409. Throws 404 for no such
  // request. A guest's approval writes the grant in the same step. Returns { request, changed }.
  decide(space, id, decision, by, now = Date.now()) {
    const r = this.requests.find((x) => x.id === id && x.space === space);
    if (!r) throw new AccessRequestError('No such request.', 404);
    const want = decision === 'approve' ? 'approved' : 'denied';
    if (r.state === want) return { request: { ...r }, changed: false };
    if (r.state !== 'pending') throw new AccessRequestError(r.state === 'approved' || r.state === 'denied' ? 'That request was answered already.' : 'That request is over.', 409);
    if (this.stateOf(r, now) === 'expired') {
      r.state = 'expired';
      r.decidedAt = now;
      try { this.save(); } catch { /* the next write keeps it */ }
      throw new AccessRequestError('That request has run out.', 409);
    }
    const before = { ...r };
    const grants = this.grants;
    r.state = want;
    r.decidedBy = String(by || '').slice(0, 64);
    r.decidedAt = now;
    if (want === 'approved' && r.guest) this.grants = [...this.grants.filter((g) => !(g.guest === r.guest && g.space === space)), { guest: r.guest, space, until: r.until !== undefined ? r.until : now }];
    this.commit(() => { Object.keys(r).forEach((k) => delete r[k]); Object.assign(r, before); this.grants = grants; });
    return { request: { ...r }, changed: true };
  }

  // The spaces a guest was let into and may still enter.
  grantedSpaces(guest, now = Date.now()) {
    return this.grants.filter((g) => g.guest === guest && g.until > now).map((g) => g.space);
  }

  // A deleted space takes its requests and grants with it. Returns how many went.
  forgetSpace(space) {
    const n = this.requests.length + this.grants.length;
    this.requests = this.requests.filter((r) => r.space !== space);
    this.grants = this.grants.filter((g) => g.space !== space);
    const gone = n - this.requests.length - this.grants.length;
    if (gone) this.save();
    return gone;
  }
}

module.exports = { AccessRequests, AccessRequestError, readLimits, STATES, MAX_REQUESTS };
