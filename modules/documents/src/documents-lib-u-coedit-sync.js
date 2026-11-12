// ---- documents-lib-u-coedit-sync.js: the channel of a shared document (no page, no host; `live` and the clock are handed in) -----------------
//
// Co-editing step 4a (plan-documents-coediting.md). Everything here runs only when the module's `coediting` switch is on; with it off nothing in
// this file is called (the page never makes a session). The pieces that need no Yjs are plain functions; dlSyncSession ties the Y.Doc, the gate
// (documents-lib-t-coedit-gate.js) and `live` (host.live: subscribe, publish, on) together, with an injected clock so a test runs it with no timers.
//
// THE CHANNEL. One topic per document, `ydoc.<id>` (dlSyncTopic: the topic rule is `^[a-z0-9._-]{1,40}$`). Data is one of (any other key, type or size
// is dropped and counted; a person is never named inside the data, the sender is the transport's `from`, see below):
//   { u: <base64 Yjs update> }                    an edit. One message per edit while the update fits the module's `live.bytes`.
//   { v: <base64 state vector>, e: 0|1, a: <n> }  "this is what I have: send me what I lack". Also the presence beat (e: I am an editor; a: how many
//                                                 other editors I counted when I joined, which orders a crowd). Sent on join, on a gap in `seq`,
//                                                 after the gate's quiet period, every 15 s, and as the answer to a vector (to the one who asked).
//   { k: <id>, i: <index>, n: <count>, c: <base64 piece> }  one piece of a difference too big for one message; the receiver joins the pieces
//                                                 and gives the whole to the gate. Pieces are sent one after the other under the module's rate.
//   { x: 1 }                                      "I left this document" (a page that only closed the document, not the module).
// A vector message is answered with the difference (encodeStateAsUpdate(doc, vector)). If the sender's vector shows it has something this page
// lacks (a big edit it did not send, or a lost message), this page sends its own vector back. So one exchange repairs both ways, duplicates and
// reordering are harmless (Yjs applies an update once), and an update too big for a message reaches the others by the same path.
//
// THE SENDER. Every remote update goes through guard.receive(update, sender) and nothing is applied around it. `sender` is host.live's `from.key`.
// Where it comes from: the server stamps `from` on a message from the signed-in person's own session (server/index.js, the live publish route);
// public/module-live.js (cleanIncoming) copies it from the stream event's own field, never from `data`, cleans it, and hands it to the SDK
// (public/sdk/host.js), which passes it as the handler's second argument. The data this file reads has fixed keys (dlSyncClean) and no key names a person.
//
// NOT HERE (4b/4c): snapshots and storage, the writer, mend reporting, the lock switch, the editors list, cursors.

const DL_SYNC = Object.freeze({
  messageBytes: 2048, // the most a message's data may be: the manifest's live.bytes (the test checks they agree). The server's maximum may be lower: a 413 halves it.
  minMessageBytes: 256,
  editorsMax: 8, // people typing in one document at once (decision 5 of the plan); the next person reads along
  repairMs: 15000, // every page sends its vector this often
  gapMinMs: 1000, // at least this long between two vectors sent because of a gap or a quiet period
  answerMinMs: 400, // a person's vector is answered at most this often
  settleMs: 250, // after the state came, this long for the others' presence to arrive before the cap is decided
  joinWaitMs: 1200, // a page that joins waits this long to hear anyone; if no one on this document was heard, it is alone and seeds from the saved text
  joinQuietMs: 6000, // a page that heard someone seeds only after nothing at all has come from anyone for this long (and after joinMaxMs, and with them gone)
  joinMaxMs: 30000, // ... and not before the join has lasted this long
  joinAskMs: 15000, // a page still joining asks again by vector this often (not while pieces are still coming)
  joinBusyMs: 3000, // pieces or an update came in this lately: the ask waits
  joinTickMs: 500, // how often a joining page looks at the clock
  assemblyMs: 30000, // pieces of one difference are dropped when the next one has not come after this long (the slot is free again)
  assembliesPerSender: 2, // differences being put together at once, from one person (a new one drops that person's oldest)
  assemblies: 8, // ... and from everyone together (past it, the oldest of whoever holds most goes)
  presenceMs: 40000, // someone not heard on this document for this long is no longer counted
  vectorBytes: 1400, // a vector longer than this is not sent or taken
  pieces: 900, // the most pieces one difference may have (a difference is at most DL_COEDIT.snapshotBytes)
  clients: 400, // the most writers a vector may list
  retryMs: 1000,
  publishMs: 5000, // a publish not answered after this long is let go (the next message goes)
  queueMax: 200, // messages waiting for one person or for everyone; past this, more answers are not queued
});

const DL_SYNC_TOPIC = /^[a-z0-9._-]{1,40}$/;
const DL_SYNC_B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const DL_SYNC_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen'];

// "Eight people are editing. You can read along." for the person past the cap.
function dlSyncFullNote(max) {
  const w = DL_SYNC_WORDS[max] || String(max);
  return `${w} people are editing. You can read along.`;
}

// The topic of a document: `ydoc.<id>` when the id is plain and short (lower case, digits, dash, underscore, up to 30), else `ydoc.x.<hash>`: two
// 32-bit hashes of the whole id in base 36 (a plain id has no dot, so the two forms never meet). -> a topic that fits the rule, or '' for a non-string.
function dlSyncTopic(id) {
  if (typeof id !== 'string' || !id) return '';
  if (/^[a-z0-9_-]{1,30}$/.test(id)) return `ydoc.${id}`;
  let a = 0x811c9dc5; let b = 0x01000193 ^ id.length;
  for (let i = 0; i < id.length; i += 1) {
    const c = id.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b + c + 0x9e3779b9, 0x85ebca6b) >>> 0;
    b ^= b >>> 13;
  }
  return `ydoc.x.${a.toString(36)}${b.toString(36)}`.slice(0, 40);
}

// The module setting `coediting`: on only for a real `true` (anything else, or no answer, is off).
function dlSyncEnabled(values) { return Boolean(values) && typeof values === 'object' && values.coediting === true; }

// The first content of a shared document, made the same on every page that reads the same saved text: the writer id of the seed is a hash of the
// document's id and text, so two pages that seed at once make the same structs and Yjs merges them as one (no doubled text). The id is put back after.
function dlSyncSeedId(id, text) {
  let h = 0x811c9dc5;
  const s = `${id}\u0000${text}`;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h || 1;
}
function dlSyncSeed(PM, ydoc, pmDoc, id, text) {
  const keep = ydoc.clientID;
  ydoc.clientID = dlSyncSeedId(id, text);
  try { ydoc.transact(() => { PM.prosemirrorToYXmlFragment(pmDoc, ydoc.getXmlFragment(dlCoeditGate(PM).limits.root)); }, 'dl-sync-seed'); } finally { ydoc.clientID = keep; }
}

// Bytes <-> base64, in slices (a long array would overflow the argument list). dlSyncUnb64 -> a Uint8Array, or null for anything that is not base64.
function dlSyncB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(s);
}
function dlSyncUnb64(text, maxBytes) {
  if (typeof text !== 'string' || text.length % 4 !== 0 || !DL_SYNC_B64.test(text)) return null;
  if (maxBytes && text.length > Math.ceil(maxBytes / 3) * 4) return null;
  try {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
    return out;
  } catch (e) { return null; }
}

// A state vector read by hand (the library has no decoder in the bundle): a count, then writer and clock pairs, each a variable-length number.
// -> a Map(writer -> clock), or null when it is not exactly a vector.
function dlSyncVector(bytes, maxClients) {
  if (!(bytes instanceof Uint8Array)) return null;
  let at = 0;
  const num = () => {
    let n = 0; let mul = 1;
    for (let i = 0; i < 6; i += 1) {
      if (at >= bytes.length) return -1;
      const b = bytes[at]; at += 1;
      n += (b & 0x7f) * mul;
      if (b < 0x80) return n;
      mul *= 128;
    }
    return -1;
  };
  const count = num();
  if (count < 0 || count > (maxClients || DL_SYNC.clients)) return null;
  const map = new Map();
  for (let i = 0; i < count; i += 1) {
    const w = num(); const c = num();
    if (w < 0 || c < 0 || map.has(w)) return null;
    map.set(w, c);
  }
  return at === bytes.length ? map : null;
}
// Does `a` hold anything `b` does not?
function dlSyncHasMore(a, b) {
  for (const [w, c] of a) if (c > (b.get(w) || 0)) return true;
  return false;
}

// What a message's data may be. -> { t: 'u'|'v'|'k'|'x', ... } or null (counted by the session). Keys are fixed; a string is bounded before it is read.
function dlSyncClean(data, cfg) {
  const c = cfg || DL_SYNC;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const keys = Object.keys(data);
  const only = (list) => keys.length > 0 && keys.every((k) => list.includes(k));
  const cap = c.messageBytes * 2; // a string longer than this is no message of ours
  const str = (v) => typeof v === 'string' && v.length <= cap;
  if (keys.length === 1 && keys[0] === 'u') return str(data.u) ? { t: 'u', b64: data.u } : null;
  if (keys.length === 1 && keys[0] === 'x') return data.x === 1 ? { t: 'x' } : null;
  if (only(['v', 'e', 'a']) && 'v' in data) {
    if (!str(data.v)) return null;
    const e = data.e === undefined ? 1 : data.e;
    const a = data.a === undefined ? 0 : data.a;
    if ((e !== 0 && e !== 1) || !Number.isInteger(a) || a < 0 || a > 64) return null;
    return { t: 'v', b64: data.v, editor: e === 1, admitted: a };
  }
  if (keys.length === 4 && only(['k', 'i', 'n', 'c'])) {
    if (typeof data.k !== 'string' || !/^[a-z0-9]{4,12}$/.test(data.k) || !str(data.c)) return null;
    if (!Number.isInteger(data.i) || !Number.isInteger(data.n) || data.n < 1 || data.n > c.pieces || data.i < 0 || data.i >= data.n) return null;
    return { t: 'k', id: data.k, i: data.i, n: data.n, b64: data.c };
  }
  return null;
}

// Who is editing this document, as this page has heard. Presence comes from any message on the document's topic; the list of people at the module
// (host.live's 'people') says who has left. `a` (admitted) is how many other editors the person counted when they joined: with the key it puts a crowd
// in one order that every page computes the same way, so the person past the cap is the same one everywhere (an older editor is never the one who loses it).
function dlSyncRoster(o) {
  const cfg = { ...DL_SYNC, ...((o && o.config) || {}) };
  const now = (o && o.now) || (() => Date.now());
  const seen = new Map(); // key -> { at, editor, admitted }
  let present = null; // the keys at the module now, or null while unknown
  const fresh = (p) => now() - p.at < cfg.presenceMs;
  const here = (k) => present === null || present.has(k);
  const roster = {
    hear(key, mark) {
      if (typeof key !== 'string' || !key) return;
      const was = seen.get(key);
      seen.set(key, { at: now(), editor: mark && mark.editor !== undefined ? mark.editor : was ? was.editor : true, admitted: mark && mark.admitted !== undefined ? mark.admitted : was ? was.admitted : 0 });
    },
    forget(key) { seen.delete(key); },
    has(key) { const p = seen.get(key); return Boolean(p) && fresh(p) && here(key); },
    people(keys) { present = Array.isArray(keys) ? new Set(keys) : null; for (const k of [...seen.keys()]) if (!here(k)) seen.delete(k); },
    // The other editors heard lately and still at the module: [{ key, admitted }].
    others() { const out = []; for (const [key, p] of seen) if (p.editor && fresh(p) && here(key)) out.push({ key, admitted: p.admitted }); return out; },
    anyone() { for (const [key, p] of seen) if (fresh(p) && here(key)) return true; return false; },
    // May a page that is joining type? Fewer than the cap are editing already.
    admit() { return roster.others().length < cfg.editorsMax; },
    // The page is an editor with this key and admission count: does the crowd put it past the cap? Every page computes the same order.
    past(myKey, myAdmitted) {
      const all = roster.others().concat([{ key: myKey, admitted: myAdmitted }]);
      if (all.length <= cfg.editorsMax) return false;
      all.sort((x, y) => x.admitted - y.admitted || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
      return all.findIndex((p) => p.key === myKey) >= cfg.editorsMax;
    },
    size: () => seen.size,
  };
  return roster;
}

// One page's share of a shared document's channel. `o`:
//   doc, lex                         the Y.Doc (may be replaced: see onRebuild) and the reader's lexer (the gate needs it)
//   topic                            dlSyncTopic(id)
//   me                               this person's key
//   live                             host.live: { subscribe(topic, fn(data, from, meta)), publish(topic, data, { to }), on(event, fn), state }
//   editor                           true when this page may type (false: it listens and answers, never publishes an edit)
//   clock                            { now(), set(fn, ms), clear(id) } (tests hand in a manual clock)
//   config                           overrides of DL_SYNC (tests)
//   onRebuild(newDoc)                the page must draw the new document (the old one was poisoned)
//   onRoster() / onState()           something the page shows changed (editors, the channel, the counters)
// -> { start, stop, stats, status, rebuild, hearPeople, ... }
function dlSyncSession(PM, o) {
  const gateApi = dlCoeditGate(PM);
  const cfg = { ...DL_SYNC, ...(o.config || {}) };
  const clock = o.clock || { now: () => Date.now(), set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) };
  const live = o.live;
  const topic = o.topic;
  const ORIGIN = 'dl-sync-net';
  const SEED = 'dl-sync-seed';
  const roster = dlSyncRoster({ now: clock.now, config: cfg });
  const stats = {
    sent: 0, sentBytes: 0, maxSentBytes: 0, edits: 0, editBytes: 0, maxEditBytes: 0, got: 0, applied: 0, refused: 0, quiet: 0, bad: 0, gaps: 0,
    vectorsOut: 0, vectorsIn: 0, answers: 0, pieces: 0, piecesIn: 0, assembled: 0, assemblyLost: 0, big: 0, rebuilt: 0, resized: 0, failed: 0, slow: 0, lastError: '', lastRefusal: '', details: {}, reasons: {},
  };
  let doc = o.doc;
  let guard = null;
  let good = null; // the last state taken from a document the gate had accepted everything for
  let goodDirty = true;
  let started = false;
  let stopped = false;
  let editor = Boolean(o.editor);
  let announced = false; // the join decided whether this page may type, and said so
  let admitted = 0;
  let lastSeq = 0;
  let lastGapVector = -Infinity;
  const lastAnswer = new Map(); // key -> when
  let timers = [];
  let bytesMax = cfg.messageBytes;
  let sending = false;
  const local = []; // this page's own updates not sent yet
  const direct = []; // [{ data, to }] messages for one person (answers, pieces)
  const assemblies = new Map(); // id -> { from, n, parts: Map(i -> bytes), at, bytes }
  let nextId = 0;
  let quietSince = 0;
  let quietFrom = null; // the last sender whose update was dropped in the quiet period: the vector after it goes to them
  let joinCheck = null; // the join wait, while there is one
  let joining = false; // a join is waiting for its content
  let peerSeen = false; // during the join: someone else's state is, or may be, on its way (their vector had content, or a piece or an update came)
  let peerAt = 0; // during the join: when anything last came from anyone else
  let pieceAt = 0; // when a piece or an update last came from anyone else
  let atModule = null; // keys at the module now, from host.live's people
  const othersAtModule = () => (atModule || []).some((k) => k !== o.me);

  const setTimer = (fn, ms) => { const t = clock.set(() => { timers = timers.filter((x) => x !== t); if (!stopped) fn(); }, ms); timers.push(t); return t; };
  const clearTimer = (t) => { timers = timers.filter((x) => x !== t); clock.clear(t); };
  const changed = () => { if (o.onState) o.onState(); };
  const reason = (r) => { stats.reasons[r] = (stats.reasons[r] || 0) + 1; };

  function makeGuard() {
    if (guard) guard.destroy();
    guard = gateApi.guard(doc, o.limits, { lex: o.lex, origin: ORIGIN, bytes: gateApi.limits.snapshotBytes, now: () => clock.now() });
    doc.on('update', onLocal);
    goodDirty = true;
  }
  function detach() { if (guard) { guard.destroy(); guard = null; } try { doc.off('update', onLocal); } catch (e) { /* gone */ } }
  // Anything that did not come through the guard and was not the seed is this person's own edit.
  function onLocal(u, origin) {
    if (origin === ORIGIN || origin === SEED || stopped) return;
    goodDirty = true;
    if (!editor) return;
    stats.edits += 1;
    local.push(u);
    pump();
  }

  // ---- sending -------------------------------------------------------------------------------------------------------------------------
  const size = (data) => JSON.stringify(data).length; // the module's limit counts the data as JSON
  function publish(data, to) {
    const n = size(data);
    stats.sent += 1; stats.sentBytes += n; if (n > stats.maxSentBytes) stats.maxSentBytes = n;
    return live.publish(topic, data, to ? { to } : undefined);
  }
  const pieceRaw = () => Math.floor((bytesMax - 90) / 4) * 3; // raw bytes of one piece so that its message fits
  // A difference (or any update) split into pieces for one person, or for everyone (to = null).
  function pieces(bytes, to) {
    const id = `${clock.now().toString(36)}${(nextId += 1).toString(36)}`.slice(-10).padStart(4, '0');
    const step = pieceRaw();
    const n = Math.ceil(bytes.length / step);
    if (n > cfg.pieces) return false;
    for (let i = 0; i < n; i += 1) direct.push({ data: { k: id, i, n, c: dlSyncB64(bytes.subarray(i * step, (i + 1) * step)) }, to });
    stats.pieces += n;
    return true;
  }
  function vectorMessage() {
    const v = PM.encodeStateVector(doc);
    if (v.length > cfg.vectorBytes) return null;
    return { v: dlSyncB64(v), e: editor && announced ? 1 : 0, a: admitted }; // an editor only once the join decided it may type
  }
  // `asking`: this vector asks for what is missing (a gap, a quiet period, a join, a return): the gate is told, so the honest updates that come back
  // with a missing predecessor meanwhile are not counted against their senders (guard.syncRequested; syncDone when an update is taken). The beat does not ask.
  function sendVector(to, asking = true) {
    if (asking && guard) guard.syncRequested();
    if (direct.length >= cfg.queueMax) { stats.failed += 1; reason('busy'); return; }
    const data = vectorMessage();
    if (!data) { stats.failed += 1; reason('vector_too_long'); return; }
    stats.vectorsOut += 1;
    direct.push({ data, to: to ? [to] : null });
    pump();
  }
  // One message at a time: the SDK keeps only the newest message for a topic and recipient, so the next goes when the last was taken.
  let sentAt = 0;
  let holdUntil = 0; // after a 429 nothing goes until then
  function pump() {
    if (sending || stopped || !started || holdUntil > clock.now()) return;
    let item = null;
    if (local.length) {
      const merged = local.length === 1 ? local[0] : PM.mergeUpdates(local);
      local.length = 0;
      const data = { u: dlSyncB64(merged) };
      if (size(data) <= bytesMax) item = { data, to: null, edit: merged };
      else { stats.big += 1; reason('edit_too_big_for_a_message'); sendVector(null); /* the others ask, and the difference goes in pieces */ }
    }
    if (!item && direct.length) item = direct.shift();
    if (!item) return;
    sending = true; sentAt = clock.now();
    let late = null;
    const slow = new Promise((resolve) => { late = setTimer(() => { stats.slow += 1; resolve(); }, cfg.publishMs); }); // a publish that never answers does not hold the rest back
    Promise.race([Promise.resolve().then(() => publish(item.data, item.to)), slow]).then(() => {
      if (late !== null) clearTimer(late);
      if (item.edit) { const n = size(item.data); stats.editBytes += n; if (n > stats.maxEditBytes) stats.maxEditBytes = n; }
    }, (err) => {
      stats.failed += 1; stats.lastError = String(err && err.message).slice(0, 80);
      // The error may reach the page as its sentence only (the status can be lost on the way), so the sentence is read too.
      const text = String((err && err.message) || '');
      const status = (err && err.status) || (/at most \d+ bytes/.test(text) ? 413 : /too many|wait a moment|try again in a moment/i.test(text) ? 429 : 0);
      if (status === 413 && bytesMax > cfg.minMessageBytes) {
        // the server's maximum is lower than the manifest's: smaller messages from here on, and what did not go is asked for again
        bytesMax = Math.max(cfg.minMessageBytes, Math.floor(bytesMax / 2)); stats.resized += 1;
        direct.length = 0;
        if (item.edit) local.unshift(item.edit);
        setTimer(() => sendVector(null), cfg.retryMs);
      } else {
        // An edit that did not go waits and goes again (the update is in the document either way); a vector or a piece is not queued again, the repair
        // asks for what is missing. After a 429, or any other failure, nothing goes for the time asked (a second at least).
        const wait = Math.max(1, Number(err && err.retryAfter) || 1) * 1000;
        holdUntil = clock.now() + (status === 429 ? wait : cfg.retryMs);
        if (item.edit) local.unshift(item.edit);
        setTimer(pump, Math.max(0, holdUntil - clock.now()) + 5);
        if (!item.edit) setTimer(() => sendVector(null), holdUntil - clock.now() + cfg.retryMs);
      }
    }).then(() => { sending = false; pump(); });
  }

  // ---- receiving -----------------------------------------------------------------------------------------------------------------------
  function receiveUpdate(bytes, from) {
    const r = guard.receive(bytes, from);
    if (r.ok) { stats.applied += 1; quietSince = 0; guard.syncDone(); if (joinCheck) joinCheck('applied'); return r; }
    if (r.reason === 'quiet') {
      stats.quiet += 1;
      quietFrom = from;
      if (!quietSince) { quietSince = clock.now(); setTimer(() => { quietSince = 0; const to = quietFrom !== 'unknown' ? quietFrom : null; quietFrom = null; sendVector(to); }, gateApi.limits.quietMs + 100); }
    } else if (r.reason === 'pending') {
      reason('pending');
      askAfterGap(from);
    } else { stats.refused += 1; reason(r.reason); }
    if (!r.ok) { stats.lastRefusal = `${r.reason}: ${r.detail || ''}`.slice(0, 160); if (!stats.details[r.reason]) stats.details[r.reason] = String(r.detail || '').slice(0, 160); }
    if (r.rebuild || r.reason === 'live_threw') rebuild(r.reason);
    changed();
    return r;
  }
  // A vector because something is missing: at most one a second; one asked for inside the second goes at its end (to everyone, when two people were the cause).
  let trailing = null;
  function askAfterGap(from) {
    const t = clock.now();
    const wait = cfg.gapMinMs - (t - lastGapVector);
    if (wait <= 0) { lastGapVector = t; sendVector(from); return; }
    if (trailing) { if (trailing.to !== from) trailing.to = null; return; }
    trailing = { to: from };
    setTimer(() => { const to = trailing.to; trailing = null; lastGapVector = clock.now(); sendVector(to); }, wait);
  }
  function answer(vec, from) {
    const t = clock.now();
    if (t - (lastAnswer.get(from) || -Infinity) < cfg.answerMinMs) return;
    if (direct.length >= cfg.queueMax) { stats.failed += 1; reason('busy'); return; }
    lastAnswer.set(from, t);
    if (lastAnswer.size > 200) { for (const [k, at] of lastAnswer) if (t - at > 60000) lastAnswer.delete(k); }
    let diff;
    try { diff = PM.encodeStateAsUpdate(doc, vec.bytes); } catch (e) { stats.bad += 1; reason('vector_unreadable'); return; }
    if (diff.length <= 2 && !PM.encodeStateAsUpdate(doc).length) return;
    // an empty difference is two bytes (no structs, no deletes): nothing to say
    if (diff.length <= 2) return;
    stats.answers += 1;
    const data = { u: dlSyncB64(diff) };
    if (size(data) <= bytesMax) { direct.push({ data, to: [from] }); } else if (!pieces(diff, [from])) { stats.failed += 1; reason('difference_too_big'); }
    pump();
  }
  // The pieces of a difference are put together per sender and per id. A sender holds at most `assembliesPerSender` at once (a new one drops that
  // sender's oldest), everyone together at most `assemblies` (past it the oldest of whoever holds most, another sender than this one, goes), and one
  // that has had no piece for `assemblyMs` is dropped: a made-up set of pieces from one person cannot refuse the pieces of another.
  function dropAssembly(k) { assemblies.delete(k); stats.assemblyLost += 1; }
  function takePiece(m, from) {
    stats.piecesIn += 1;
    let a = assemblies.get(`${from}:${m.id}`);
    const t = clock.now();
    for (const [k, x] of assemblies) if (t - x.at > cfg.assemblyMs) dropAssembly(k);
    if (!a) {
      const mine = [...assemblies].filter(([, x]) => x.from === from);
      if (mine.length >= cfg.assembliesPerSender) dropAssembly(mine[0][0]); // Map order is the order they began: the oldest
      if (assemblies.size >= cfg.assemblies) {
        const per = new Map();
        for (const x of assemblies.values()) if (x.from !== from) per.set(x.from, (per.get(x.from) || 0) + 1);
        let most = null;
        for (const [who, n] of per) if (!most || n > per.get(most)) most = who;
        const victim = most === null ? null : [...assemblies].find(([, x]) => x.from === most);
        if (!victim) { stats.bad += 1; reason('too_many_assemblies'); return; }
        dropAssembly(victim[0]);
      }
      a = { from, n: m.n, parts: new Map(), at: t, bytes: 0 };
      assemblies.set(`${from}:${m.id}`, a);
    }
    if (a.n !== m.n) { assemblies.delete(`${from}:${m.id}`); stats.bad += 1; return; }
    const bytes = dlSyncUnb64(m.b64, cfg.messageBytes);
    if (!bytes) { stats.bad += 1; reason('not_base64'); return; }
    if (!a.parts.has(m.i)) { a.parts.set(m.i, bytes); a.bytes += bytes.length; a.at = t; }
    if (a.bytes > gateApi.limits.snapshotBytes) { assemblies.delete(`${from}:${m.id}`); stats.bad += 1; reason('too_big'); return; }
    if (a.parts.size < a.n) return;
    assemblies.delete(`${from}:${m.id}`);
    const whole = new Uint8Array(a.bytes); let at = 0;
    for (let i = 0; i < a.n; i += 1) { const p = a.parts.get(i); whole.set(p, at); at += p.length; }
    stats.assembled += 1;
    receiveUpdate(whole, from);
  }
  function onMessage(data, from, meta) {
    if (stopped) return;
    stats.got += 1;
    // The sender is the transport's `from.key`. A message with none is still checked, as one shared sender 'unknown' (never a free pass, never its own bucket).
    const key = from && typeof from.key === 'string' && from.key ? from.key : 'unknown';
    if (meta && Number.isSafeInteger(meta.seq)) {
      if (lastSeq && meta.seq > lastSeq + 1) { stats.gaps += 1; askAfterGap(key); }
      if (meta.seq > lastSeq) lastSeq = meta.seq;
    }
    const m = dlSyncClean(data, cfg);
    if (!m) { stats.bad += 1; reason('not_a_message'); changed(); return; }
    if (m.t === 'x') { roster.forget(key); changed(); return; }
    const known = roster.has(key);
    roster.hear(key, m.t === 'v' ? { editor: m.editor, admitted: m.admitted } : undefined);
    if (joining && key !== o.me) {
      peerAt = clock.now();
      if (m.t === 'u' || m.t === 'k') { peerSeen = true; pieceAt = peerAt; }
    }
    if (m.t === 'u') {
      const bytes = dlSyncUnb64(m.b64, cfg.messageBytes);
      if (!bytes) { stats.bad += 1; reason('not_base64'); changed(); return; }
      receiveUpdate(bytes, key);
    } else if (m.t === 'k') takePiece(m, key);
    else if (m.t === 'v') {
      stats.vectorsIn += 1;
      const bytes = dlSyncUnb64(m.b64, cfg.vectorBytes);
      const map = bytes ? dlSyncVector(bytes, cfg.clients) : null;
      if (!map) { stats.bad += 1; reason('vector_unreadable'); changed(); return; }
      // a vector with content is someone with a state to give; an empty one is another page that is joining, or a document with nothing in it
      if (joining && key !== o.me && map.size > 0) peerSeen = true;
      answer({ bytes, map }, key);
      if (!known) sendVector(key); // someone new: say who this page is (the cap is counted from these)
      const mine = dlSyncVector(PM.encodeStateVector(doc), 100000);
      if (mine && dlSyncHasMore(map, mine)) askAfterGap(key); // they have what this page lacks
    }
    changed();
  }

  // ---- the page's own life ---------------------------------------------------------------------------------------------------------------
  function rebuild(why) {
    const snap = good;
    stats.rebuilt += 1; reason(`rebuilt_${why || 'asked'}`);
    const r = snap ? gateApi.rebuildFromGood(snap, o.limits) : { ok: false };
    const next = r.ok ? r.doc : new PM.Doc();
    detach();
    doc = next;
    makeGuard();
    guard.prime();
    if (o.onRebuild) o.onRebuild(doc);
    sendVector(null); // the others give back what came after the snapshot
  }
  function take() { // the last good state, for a rebuild: only when nothing refused has touched the document since
    if (!goodDirty) return;
    try { good = PM.encodeStateAsUpdate(doc); goodDirty = false; } catch (e) { /* keep the old one */ }
  }
  function beat() {
    take();
    sendVector(null, false);
    setTimer(beat, cfg.repairMs);
  }

  const api = {
    // Subscribes, watches who is there, and says what this page has. Safe to call once.
    start() {
      if (started) return;
      started = true;
      makeGuard();
      guard.prime();
      take();
      o.off = [
        live.subscribe(topic, onMessage),
        live.on('people', (e) => {
          atModule = (e.people || []).map((p) => p.key);
          roster.people(atModule);
          if (joinCheck) joinCheck('people');
          changed();
        }),
      ];
      if (typeof live.on === 'function' && o.onChannel) o.off.push(live.on('state', (s) => o.onChannel(s)));
      setTimer(beat, cfg.repairMs);
      sendVector(null);
    },
    stop() {
      if (stopped) return;
      if (started) { try { live.publish(topic, { x: 1 }).catch(() => {}); } catch (e) { /* closing */ } }
      stopped = true;
      for (const t of timers) clock.clear(t);
      timers = [];
      for (const off of o.off || []) { try { off(); } catch (e) { /* gone */ } }
      detach();
    },
    // The first state of a page. It never seeds while someone's state may be on its way (a seed made beside a peer's makes a second copy of the text).
    // After joinWaitMs: if no one on this document was heard, the page is alone and seeds with o.seed(doc) (the same bytes on every page that reads the
    // same saved text, so two pages that open at once make one copy). If someone was heard, the page stays joining and keeps asking by vector until
    // the state has come; it seeds only when nothing has come from anyone for joinQuietMs, joinMaxMs have passed and they are gone (left, or not heard
    // for presenceMs). If they are still there it keeps asking every joinAskMs and does not seed: the page stays unable to type, which can be
    // recovered, and a doubled document cannot.
    // done(how, mayType) once the document has its content: how is 'alone', 'state' or 'timeout' (nobody heard in time, or the peers gone);
    // mayType is false when eight others are editing already (the page then reads along). Until then this page says it is not an editor.
    join(done) {
      let finished = false; let wait = null; let settle = null; let tick = null;
      const t0 = clock.now(); let askedAt = t0;
      joining = true; peerSeen = false; peerAt = 0; pieceAt = 0;
      const content = () => doc.getXmlFragment(gateApi.limits.root).length > 0;
      const finish = (how) => {
        if (finished) return;
        finished = true; joinCheck = null; joining = false;
        if (wait !== null) clearTimer(wait);
        if (settle !== null) clearTimer(settle);
        if (tick !== null) clearTimer(tick);
        if (!content()) { o.seed(doc); if (guard) guard.reseed(); goodDirty = true; take(); }
        admitted = roster.others().length;
        if (!roster.admit()) editor = false; // the cap: this page reads along
        announced = true;
        stats.joinedBy = how;
        sendVector(null);
        done(how, editor);
      };
      const look = () => {
        tick = null;
        if (finished || stopped) return;
        const t = clock.now();
        if (content()) { if (settle === null) settle = setTimer(() => finish('state'), cfg.settleMs); }
        else if (peerSeen && t - t0 >= cfg.joinWaitMs) {
          if (t - peerAt >= cfg.joinQuietMs && t - t0 >= cfg.joinMaxMs && !roster.anyone()) { finish('timeout'); return; }
          if (t - askedAt >= cfg.joinAskMs && t - pieceAt >= cfg.joinBusyMs) { askedAt = t; sendVector(null); }
        }
        tick = setTimer(look, cfg.joinTickMs);
      };
      joinCheck = (why) => {
        if (why === 'applied') { if (content() && settle === null) settle = setTimer(() => finish('state'), cfg.settleMs); return; }
        if (!peerSeen && !roster.others().length && !roster.anyone() && !othersAtModule()) finish('alone');
      };
      wait = setTimer(() => { wait = null; if (!peerSeen) finish('timeout'); }, cfg.joinWaitMs);
      tick = setTimer(look, cfg.joinTickMs);
    },
    // After the channel came back: both sides say what they have.
    reconnected() { if (started && !stopped) { lastSeq = 0; sendVector(null); } },
    // The page changed the live document outside the gate (it should not; a rebuild or a seed does).
    reseed() { if (guard) guard.reseed(); goodDirty = true; },
    setEditor(on) { const was = editor; editor = Boolean(on); if (started && announced && was !== editor) sendVector(null); },
    admitted: () => admitted,
    hearPeople(keys) { atModule = keys; roster.people(keys); },
    roster,
    stats: () => ({ ...stats, reasons: { ...stats.reasons }, details: { ...stats.details }, guard: guard ? guard.stats() : null, bytesMax, sending, hold: Math.max(0, holdUntil - clock.now()), sinceSend: sentAt ? clock.now() - sentAt : -1, pending: local.length + direct.length, assembling: assemblies.size }),
    doc: () => doc,
    rebuild,
    sendVector,
    flush: pump,
    // The text a person may read about the channel: '' when all is well.
    status() { return stats.refused + stats.quiet > 0 ? `${stats.refused + stats.quiet} changes from others were not used` : ''; },
  };
  return api;
}
