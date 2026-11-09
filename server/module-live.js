// Live messages for modules (documentation/plans/plan-module-live.md): short messages between the people using one
// module in one space, such as a pointer, a typing mark or a nudge. One register per environment, in memory only:
// nothing here is written to disk, stored or replayed. Pure: no timers, no requests, no access rules; the clock is handed
// in, so a check can run every rule on its own (as server/live.js is). The routes in server/index.js
// (POST /api/modules/:id/live, /live/join, /live/leave, and the `ready`, `live`, `joined` and `left` events on
// GET /api/modules/stream) keep one register per environment, decide who may read, and do the writing.
//
// This travels over the app's own server only, never over the call: this file requires nothing but Node's crypto, and
// nothing in it knows the call exists.
//
// Four things are held:
//   - connections: one entry per open module stream with a space, { id, who, guest, space, deliver, mayRead }. `who` is a
//     person's key, or null for a guest (a guest on the module stream is known only by the guest link, so nobody can
//     name them in `to`). `deliver(bytes)` writes to that stream; `mayRead(moduleId)` answers whether its reader may
//     read that module in that space now (index.js keeps that answer per connection and asks again on every recheck).
//     Indexed by space, so a message touches only the connections of its own space.
//   - joins: per module and space, the people who joined that module's live messages there, each with the connections
//     they joined from, or `until` (the grace) once the last of those closed, so the stream's own reconnect reads as
//     neither leaving nor joining.
//   - buckets: the rates, one token bucket per key (a person in a module, a person, a guest link).
//   - seqs: per module and space, the last sequence number stamped.
'use strict';

const crypto = require('crypto');

// How long someone whose last joined connection closed still counts as there: the module stream reconnects after
// 3 seconds, so 10 seconds covers a reconnect without keeping a closed tab listed for long.
const GRACE_MS = 10 * 1000;
// A topic: 1 to 40 of a-z, 0-9, dot, underscore and dash.
const TOPIC_RE = /^[a-z0-9._-]{1,40}$/;
// Whom `to` may name: a person's key, or a guest's id (as the guest pass gives it).
const PERSON_RE = /^(?:[a-z0-9]{4,16}|guest-[A-Za-z0-9_-]{4,40})$/;

const pairKey = (moduleId, space) => `${moduleId}\u0000${space}`;

// Whole numbers above 0 from the environment's settings; anything else is the default.
function wholeAbove0(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

// The limits, from MODULE_LIVE_BYTES, MODULE_LIVE_PER_SECOND, MODULE_LIVE_PER_PERSON, MODULE_LIVE_PER_GUEST_LINK and
// MODULE_LIVE_TO (as process.env has them; index.js hands them in).
function liveLimits(env = {}) {
  return Object.freeze({
    bytes: wholeAbove0(env.MODULE_LIVE_BYTES, 256),
    perSecond: wholeAbove0(env.MODULE_LIVE_PER_SECOND, 20),
    perPerson: wholeAbove0(env.MODULE_LIVE_PER_PERSON, 40),
    perGuestLink: wholeAbove0(env.MODULE_LIVE_PER_GUEST_LINK, 60),
    to: wholeAbove0(env.MODULE_LIVE_TO, 20),
  });
}

// A send's body read: { topic, data, to } or { error } (one plain sentence). `to` is null for everyone, else a list of
// distinct ids. Only own fields are read, and any other field is refused, so a body can't set `from`, `module`, the
// time or the sequence, and a `__proto__` key is just an unknown field.
function readSend(body, limits) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'send the message as JSON: { topic, data, to? }' };
  const extra = Object.keys(body).find((k) => k !== 'topic' && k !== 'data' && k !== 'to');
  if (extra !== undefined) return { error: 'send only topic, data and to' };
  const topic = Object.prototype.hasOwnProperty.call(body, 'topic') ? body.topic : undefined;
  if (typeof topic !== 'string' || !TOPIC_RE.test(topic)) return { error: 'the topic must be 1 to 40 of a-z, 0-9, dot, underscore and dash' };
  const data = Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : null;
  let to = null;
  if (Object.prototype.hasOwnProperty.call(body, 'to') && body.to !== null) {
    if (!Array.isArray(body.to) || !body.to.length || body.to.length > limits.to) return { error: `to must list 1 to ${limits.to} people` };
    if (!body.to.every((k) => typeof k === 'string' && PERSON_RE.test(k))) return { error: 'to must list people by their keys' };
    to = [...new Set(body.to)];
  }
  return { topic, data, to };
}

// The size of a message's data as it is sent (JSON), in bytes.
const dataBytes = (data) => Buffer.byteLength(JSON.stringify(data === undefined ? null : data));

class ModuleLive {
  constructor({ now = Date.now, graceMs = GRACE_MS, makeId } = {}) {
    this.now = now;
    this.graceMs = graceMs;
    // A connection's id is a person's proof that the connection is theirs (join and leave), so it can't be guessed.
    this.makeId = makeId || (() => crypto.randomBytes(12).toString('base64url'));
    this.connections = new Map(); // id -> { id, who, guest, space, deliver, mayRead, joined: Set<moduleId> }
    this.bySpace = new Map(); // space -> Set<id>
    this.joins = new Map(); // pairKey -> Map<who, { who, guest, conns: Set<id>, until }>
    this.buckets = new Map(); // key -> { tokens, at }
    this.seqs = new Map(); // pairKey -> last seq
    this.takes = 0;
  }

  // A module stream with a space opened: its id.
  open({ who = null, guest = false, space, deliver, mayRead }) {
    const id = this.makeId();
    const entry = { id, who: who || null, guest: Boolean(guest), space, deliver, mayRead, joined: new Set() };
    this.connections.set(id, entry);
    if (!this.bySpace.has(space)) this.bySpace.set(space, new Set());
    this.bySpace.get(space).add(id);
    return id;
  }

  connection(id) {
    return typeof id === 'string' ? this.connections.get(id) || null : null;
  }

  // The connections open in a space now.
  inSpace(space) {
    const ids = this.bySpace.get(space);
    return ids ? [...ids].map((id) => this.connections.get(id)).filter(Boolean) : [];
  }

  // A module stream closed: every module it joined loses it. Answers [{ module, space, who, until }] for each person
  // that leaves no other joined connection there: they are in the grace until `until` (sweep() then says they left).
  close(id) {
    const entry = this.connections.get(id);
    if (!entry) return [];
    this.connections.delete(id);
    const ids = this.bySpace.get(entry.space);
    if (ids) {
      ids.delete(id);
      if (!ids.size) this.bySpace.delete(entry.space);
    }
    const waiting = [];
    for (const moduleId of entry.joined) {
      const person = this.drop(entry, moduleId);
      if (!person || person.conns.size) continue;
      person.until = this.now() + this.graceMs;
      waiting.push({ module: moduleId, space: entry.space, who: person.who, until: person.until });
    }
    entry.joined.clear();
    return waiting;
  }

  drop(entry, moduleId) {
    const people = this.joins.get(pairKey(moduleId, entry.space));
    const person = people && entry.who ? people.get(entry.who) : null;
    if (person) person.conns.delete(entry.id);
    return person;
  }

  // A connection joins a module's live messages in its space. Answers { joined } -- true when the person was not there
  // before (nor in the grace), so the others are told -- or null for a connection that is not open or has no person.
  join(id, moduleId) {
    const entry = this.connections.get(id);
    if (!entry || !entry.who) return null;
    const key = pairKey(moduleId, entry.space);
    if (!this.joins.has(key)) this.joins.set(key, new Map());
    const people = this.joins.get(key);
    let person = people.get(entry.who);
    const now = this.now();
    if (person && !person.conns.size && person.until && person.until <= now) {
      people.delete(entry.who); // the grace ran out and sweep() has not said so yet: a new arrival
      person = null;
    }
    const joined = !person;
    if (!person) {
      person = { who: entry.who, guest: entry.guest, conns: new Set(), until: 0 };
      people.set(entry.who, person);
    }
    person.conns.add(id);
    person.until = 0;
    entry.joined.add(moduleId);
    return { joined };
  }

  // A connection leaves a module's live messages (the module closed on that page, or its reader lost access): no grace.
  // Answers { left } -- true when the person has no other joined connection there, so the others are told -- or null
  // when the connection had not joined it.
  leave(id, moduleId) {
    const entry = this.connections.get(id);
    if (!entry || !entry.joined.has(moduleId)) return null;
    entry.joined.delete(moduleId);
    const person = this.drop(entry, moduleId);
    if (!person) return { left: false };
    if (person.conns.size) return { left: false };
    this.forget(moduleId, entry.space, person.who);
    return { left: true };
  }

  forget(moduleId, space, who) {
    const key = pairKey(moduleId, space);
    const people = this.joins.get(key);
    if (!people) return;
    people.delete(who);
    if (!people.size) this.joins.delete(key);
  }

  // The modules a connection has joined.
  joinedBy(id) {
    const entry = this.connections.get(id);
    return entry ? [...entry.joined] : [];
  }

  // Those whose grace ran out with no connection back: [{ module, space, who }], each forgotten now.
  sweep() {
    const now = this.now();
    const gone = [];
    for (const [key, people] of [...this.joins]) {
      const [moduleId, space] = key.split('\u0000');
      for (const person of [...people.values()]) {
        if (person.conns.size || !person.until || person.until > now) continue;
        gone.push({ module: moduleId, space, who: person.who });
        this.forget(moduleId, space, person.who);
      }
    }
    return gone;
  }

  // Who has joined a module's live messages in a space now (the grace included): [{ key, guest }].
  people(moduleId, space) {
    const people = this.joins.get(pairKey(moduleId, space));
    if (!people) return [];
    const now = this.now();
    return [...people.values()].filter((p) => p.conns.size || p.until > now).map((p) => ({ key: p.who, guest: p.guest }));
  }

  // The rates: `limits` is [[key, perSecond], ...], each a token bucket that holds perSecond tokens (the burst) and
  // gains perSecond a second. Answers 0 and takes one token from each when every bucket has one; else the whole seconds
  // to wait (at least 1) and takes none.
  take(limits) {
    const now = this.now();
    let wait = 0;
    const filled = limits.map(([key, rate]) => {
      const b = this.buckets.get(key);
      const tokens = b ? Math.min(rate, b.tokens + ((now - b.at) / 1000) * rate) : rate;
      if (tokens < 1) wait = Math.max(wait, Math.max(1, Math.ceil((1 - tokens) / rate)));
      return [key, tokens];
    });
    if (!wait) for (const [key, tokens] of filled) this.buckets.set(key, { tokens: tokens - 1, at: now });
    else for (const [key, tokens] of filled) this.buckets.set(key, { tokens, at: now });
    // Now and then, buckets that are full again are let go, so the map holds only who sent lately.
    this.takes += 1;
    if (this.takes % 1000 === 0) this.prune();
    return wait;
  }

  // A bucket holds a second's worth, so one untouched for a second is full again: the same as no bucket.
  prune() {
    const now = this.now();
    for (const [key, b] of this.buckets) if (now - b.at >= 1000) this.buckets.delete(key);
  }

  // A space deleted: its sequence numbers and joins go (its streams end on their own as their readers lose access).
  forgetSpace(space) {
    for (const key of [...this.seqs.keys()]) if (key.endsWith(`\u0000${space}`)) this.seqs.delete(key);
    for (const key of [...this.joins.keys()]) if (key.endsWith(`\u0000${space}`)) this.joins.delete(key);
  }

  // The server's time and the next sequence number for a module in a space: { at, seq }.
  stamp(moduleId, space) {
    const key = pairKey(moduleId, space);
    const seq = (this.seqs.get(key) || 0) + 1;
    this.seqs.set(key, seq);
    return { at: this.now(), seq };
  }
}

module.exports = { ModuleLive, liveLimits, readSend, dataBytes, TOPIC_RE, PERSON_RE, GRACE_MS };
