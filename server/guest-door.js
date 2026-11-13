// The guest door (documentation/plans/plan-access-bundle.md, step 4): a person who presses "Continue as guest" types a
// name and is a guest for GUEST_SESSION_HOURS, with no account. Nothing here reads a request or the store; the routes
// and the one resolver (guestOf in server/index.js) hand in what they need.
//
//   The session    a `guest_session` cookie: { i: guest id, n: name, s: environment slug, v: the texts' versions agreed
//                  to, e: the environment's guestEpoch, t: issued at }, HMAC-signed with a key made from the
//                  environment's own session secret (a different key from the account session's), so it never reads as
//                  one and never works at another environment. Ended by: the hours running out, raising guestEpoch, a
//                  new text version (the agreement gate), the host turning the door off, DELETE.
//   The register   who is here now (seen in the last 15 minutes), for the environment's cap (GUESTS_PER_ENVIRONMENT); the
//                  space's cap (GUESTS_PER_SPACE) is read from the live register, which marks guests. In memory:
//                  a restart forgets it, and a session still in date is counted again when it next asks.
//   The limits     GUEST_SESSION_HOURS, GUEST_DOOR_PER_ADDRESS, GUESTS_PER_SPACE, GUESTS_PER_ENVIRONMENT (readLimits).
'use strict';

const crypto = require('crypto');

const COOKIE = 'guest_session';
const ACTIVE_MS = 15 * 60000;
const WINDOW_MS = 15 * 60000;
const GUEST_ID_RE = /^guest-[A-Za-z0-9_-]{4,40}$/;

const whole = (value, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

// The limits, from the environment variables, at the decided defaults.
function readLimits(env = process.env) {
  return {
    hours: whole(env.GUEST_SESSION_HOURS, 24),
    perAddress: whole(env.GUEST_DOOR_PER_ADDRESS, 5),
    perSpace: whole(env.GUESTS_PER_SPACE, 10),
    perEnvironment: whole(env.GUESTS_PER_ENVIRONMENT, 50),
  };
}

const sign = (secret, payload) => crypto.createHmac('sha256', crypto.createHmac('sha256', String(secret)).update('guest-session').digest()).update(payload).digest('base64url');

function issue(secret, { slug = '', id, name, versions = {}, epoch = 0, at = Date.now() }) {
  const payload = Buffer.from(JSON.stringify({ i: id, n: name, s: slug || '', v: versions, e: epoch, t: at })).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

// { id, name, versions, at } from a token for this environment, in date and of this epoch, or null.
function read(secret, token, { slug = '', epoch = 0, hours = 24, now = Date.now() } = {}) {
  if (typeof token !== 'string' || token.length > 1500) return null;
  const dot = token.indexOf('.');
  if (dot < 0 || token.indexOf('.', dot + 1) >= 0) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(sign(secret, payload));
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  let d;
  try { d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!d || typeof d.i !== 'string' || !GUEST_ID_RE.test(d.i) || typeof d.n !== 'string' || !d.n) return null;
  if (d.s !== (slug || '') || d.e !== epoch || typeof d.t !== 'number' || d.t > now + 60000 || now - d.t >= hours * 3600000) return null;
  return { id: d.i, name: d.n, versions: d.v && typeof d.v === 'object' && !Array.isArray(d.v) ? d.v : {}, at: d.t };
}

// Who is here: id -> { name, seen }. (How many are in one space is the live register's: server/live.js marks guests.)
class GuestRegister {
  constructor({ activeMs = ACTIVE_MS } = {}) {
    this.activeMs = activeMs;
    this.guests = new Map();
  }

  prune(now = Date.now()) {
    for (const [id, g] of this.guests) if (now - g.seen > this.activeMs) this.guests.delete(id);
  }

  touch(id, name, now = Date.now()) {
    this.prune(now);
    const g = this.guests.get(id);
    if (g) g.seen = now;
    else this.guests.set(id, { name, seen: now });
  }

  end(id) { this.guests.delete(id); }

  inEnvironment(now = Date.now()) { this.prune(now); return this.guests.size; }
}

// Per-address count of new sessions in a window (the door's and the guest link's alike). Bounded in memory.
class NewSessionLimiter {
  constructor(max, windowMs = WINDOW_MS) { this.max = max; this.windowMs = windowMs; this.hits = new Map(); }

  recent(ip, now) { return (this.hits.get(ip) || []).filter((t) => now - t < this.windowMs); }

  blocked(ip, now = Date.now()) { return this.recent(ip, now).length >= this.max; }

  count(ip, now = Date.now()) {
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
    if (this.hits.size > 10000) this.hits.delete(this.hits.keys().next().value);
    this.hits.set(ip, [...this.recent(ip, now), now]);
  }
}

// A typed name as compared with the members': case, accents and spacing do not make it another name.
const nameKey = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

// Letters that pass for Latin ones, from Cyrillic, Greek and full-width forms, folded to the Latin letter.
const LOOKALIKES = Object.fromEntries([
  ...'а:a в:b е:e к:k м:m н:h о:o р:p с:c т:t у:y х:x і:i ј:j ѕ:s ү:y һ:h ԁ:d ԛ:q ԝ:w ο:o ν:v α:a ρ:p ι:i κ:k τ:t υ:u χ:x ϲ:c'.split(' ').map((p) => [...p]).map((a) => [a[0], a[2]]),
].concat([['ı', 'i'], ['ɑ', 'a']]));
// A name compared with another for lookalikes: NFKC (full-width becomes plain), lowercase, lookalikes folded.
const nameSkeleton = (value) => [...nameKey(value)].map((c) => LOOKALIKES[c] || c).join('');
// True when a name has Latin letters and also letters of a script that has Latin lookalikes (a single script is fine).
const mixesScripts = (value) => {
  const s = String(value || '').normalize('NFKC');
  return /\p{Script=Latin}/u.test(s) && /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}\p{Script=Cherokee}\p{Script=Coptic}\p{Script=Georgian}\p{Script=Lisu}]/u.test(s);
};

// The mark a guest's name carries ("Thomas (Guest)"): the word for guest in this environment's template, capitalised, in
// round brackets. A typed name that already ends in the mark (the word or "guest", any case) is taken without it, so the
// mark is never doubled.
const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const markPattern = (word) => new RegExp(`\\(\\s*(?:guest|${escapeRe(word || 'guest')})\\s*\\)\\s*$`, 'iu');
const guestMark = (word) => { const w = String(word || 'guest'); return `(${w.charAt(0).toUpperCase()}${w.slice(1)})`; };
// True when `name` ends in the guest mark, as a person may not be called (a member's display name).
const endsWithGuestMark = (name, word) => markPattern(word).test(String(name || ''));
// The typed name without any guest mark on its end.
function stripGuestMark(typed, word) {
  let out = String(typed || '').trim();
  const re = markPattern(word);
  for (let i = 0; i < 5 && re.test(out); i += 1) out = out.replace(re, '').trim();
  return out;
}
// The name as kept and shown everywhere: the typed name and the mark once.
const markedGuestName = (typed, word) => `${stripGuestMark(typed, word)} ${guestMark(word)}`;

module.exports = { endsWithGuestMark, stripGuestMark, markedGuestName, guestMark, nameSkeleton, mixesScripts, COOKIE, ACTIVE_MS, WINDOW_MS, GUEST_ID_RE, readLimits, issue, read, GuestRegister, NewSessionLimiter, nameKey };
