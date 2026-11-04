// A space's chat, kept on the server so someone who joins later (or from another browser) reads what was said, and
// so a person's private messages (command echoes, /ai questions and answers) survive a refresh. One store for both
// (plan-chat-model.md): every message is one entry in DATA_DIR/chat.json, and `visibility: "private"` marks one only
// its author (`by`) ever receives. Absent means public, so every message stored before stays public.
//
// Public messages go out live on the live stream (GET /api/live) once the sender posts them here. Only text is
// kept (not pictures), only for a real space (an aside is meant to be off the record), and only a rolling window,
// counted apart: the last MAX_PUBLIC public messages per space and the last MAX_PRIVATE private messages per person
// per space, none older than MAX_AGE_MS. An AI answer, or an /ai question, may be up to MAX_AI_TEXT characters; any
// other message up to MAX_TEXT.
//
// On disk the two are kept apart, so a release from before this one (which reads chat.json and knows nothing of
// `visibility`) can never show a private message to anyone after a roll back: chat.json holds public messages only,
// in exactly the shape it always had ({ spaces, cleared }), and private messages live in DATA_DIR/chat-private.json
// ({ spaces, threadsMoved }), which no earlier release reads. In memory they are one list per space. A message whose
// visibility changes is written to the file it moves to first, then removed from the one it left; a message found in
// both files on load (a write cut short between the two) is taken as private, so nothing is lost and nothing private
// is ever shown. A chat.json from a build of this release that kept private entries in it is split on load.
//
// An ordinary message with a link may carry `preview` ({ url, and after a read module, title, description, image,
// at }) and `kept` ({ by, who, at }) (plan-chat-links.md). Both are optional fields on the message, in whichever file it
// lives; an earlier release reads past them, and a message without them reads as before.
//
// Once, on the first start after the upgrade, the old private AI threads (DATA_DIR/ai-threads.json) are moved in as
// private messages (moveThreads); chat-private.json is marked `threadsMoved` and the old file is renamed, never
// deleted.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_PUBLIC = 500;
const MAX_PRIVATE = 200;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TEXT = 1000;
const MAX_AI_TEXT = 8000;
const MAX_SUMMARIES = 20;
const ID_RE = /^[a-f0-9]{12}$/;

const newId = () => crypto.randomBytes(6).toString('hex');
const cleanText = (text, max) => String(text ?? '').replace(/\p{Cc}/gu, (c) => (c === '\n' || c === '\t' ? c : '')).trim().slice(0, max);
const cleanWho = (who) => String(who || '').replace(/\p{Cc}/gu, ' ').trim().slice(0, 40) || 'someone';
const isPrivate = (m) => m.visibility === 'private';
const isAi = (m) => m.kind === 'ai' || m.command === 'ai';
const copy = (m) => ({
  ...m,
  ...(Array.isArray(m.summaries) ? { summaries: m.summaries.map((s) => ({ ...s })) } : {}),
  ...(m.preview && typeof m.preview === 'object' ? { preview: { ...m.preview } } : {}),
  ...(m.kept && typeof m.kept === 'object' ? { kept: { ...m.kept } } : {}),
  ...(m.sent && typeof m.sent === 'object' ? { sent: JSON.parse(JSON.stringify(m.sent)) } : {}),
  ...(Array.isArray(m.used) ? { used: m.used.map((r) => ({ ...r })) } : {}),
  ...(Array.isArray(m.numbered) ? { numbered: m.numbered.map((r) => ({ ...r })) } : {}),
  ...(Array.isArray(m.leftOut) ? { leftOut: m.leftOut.map((l) => ({ ...l })) } : {}),
});
const QUOTE_MAX = 300;
const MAX_NUMBERED = 200; // attached (12), the rollup's relevant and linked (30 + 20), and the look-ups' (8 calls of up to 15, slice 2)
const MAX_LINK = 500; // a message's link, as Research keeps one (plan-chat-links.md)

class ChatHistory {
  constructor(dataDir) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'chat.json');
    this.privateFile = path.join(dataDir, 'chat-private.json');
    this.spaces = {}; // spaceId -> [message], public and private together in memory, oldest first
    this.cleared = {}; // spaceId -> ms when the chat was deleted for everyone
    this.threadsMoved = 0; // ms when ai-threads.json was moved in, 0 before
    this.timer = null;
    let pub = {};
    let priv = {};
    let split = false; // private entries found in chat.json: written apart at once
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && raw.spaces && typeof raw.spaces === 'object') pub = raw.spaces;
      if (raw && raw.cleared && typeof raw.cleared === 'object') this.cleared = raw.cleared;
      if (raw && Number.isFinite(raw.threadsMoved)) { this.threadsMoved = raw.threadsMoved; split = true; }
    } catch {
      // first run
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.privateFile, 'utf8'));
      if (raw && raw.spaces && typeof raw.spaces === 'object') priv = raw.spaces;
      if (raw && Number.isFinite(raw.threadsMoved)) this.threadsMoved = raw.threadsMoved;
    } catch {
      // none yet
    }
    for (const spaceId of new Set([...Object.keys(pub), ...Object.keys(priv)])) {
      const mine = (Array.isArray(priv[spaceId]) ? priv[spaceId] : []).filter((m) => m && typeof m === 'object').map((m) => ({ ...m, visibility: 'private' }));
      const privateIds = new Set(mine.map((m) => m.id));
      const theirs = [];
      for (const m of Array.isArray(pub[spaceId]) ? pub[spaceId] : []) {
        if (!m || typeof m !== 'object') continue;
        if (privateIds.has(m.id)) { split = true; continue; } // in both: a change cut short; private wins
        if (isPrivate(m)) { split = true; mine.push(m); privateIds.add(m.id); continue; }
        theirs.push(m);
      }
      const list = [...theirs, ...mine].sort((a, b) => a.at - b.at);
      if (list.length) this.spaces[spaceId] = list;
    }
    if (split) this.flush();
  }

  // Written soon after a change, not on every message, and once more when the server stops.
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 2000);
    if (this.timer.unref) this.timer.unref();
  }

  // The two files' contents: chat.json's exactly as before (no private entry, no new key), and chat-private.json's.
  split() {
    const pub = {};
    const priv = {};
    for (const [spaceId, list] of Object.entries(this.spaces)) {
      for (const m of list) {
        const to = isPrivate(m) ? priv : pub;
        (to[spaceId] ||= []).push(m);
      }
    }
    const privateOut = { spaces: priv };
    if (this.threadsMoved) privateOut.threadsMoved = this.threadsMoved;
    return { publicOut: { spaces: pub, cleared: this.cleared }, privateOut };
  }

  writeFile(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  }

  // True when both files were written. `publicFirst` is for a message just made public: the file it moves to is
  // written first, so a stop between the two writes leaves it in both (read back as private), never in neither.
  // Otherwise chat-private.json goes first, so a message just made private is never only in chat.json. chat-private.json
  // is not made until there is something to put in it.
  flush({ publicFirst = false } = {}) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const { publicOut, privateOut } = this.split();
    const writePrivate = () => {
      if (!Object.keys(privateOut.spaces).length && !privateOut.threadsMoved && !fs.existsSync(this.privateFile)) return;
      this.writeFile(this.privateFile, privateOut);
    };
    try {
      if (publicFirst) {
        this.writeFile(this.file, publicOut);
        writePrivate();
      } else {
        writePrivate();
        this.writeFile(this.file, publicOut);
      }
      return true;
    } catch {
      // the chat still works; it just is not kept this time
      return false;
    }
  }

  // Drops what is past 30 days, then keeps the last MAX_PUBLIC public messages and the last MAX_PRIVATE private
  // messages of each person, counted apart, so one person's private use never pushes the public chat out.
  prune(spaceId) {
    const cutoff = Date.now() - MAX_AGE_MS;
    const all = (this.spaces[spaceId] || []).filter((m) => m && m.at >= cutoff);
    const kept = [];
    let publicCount = 0;
    const privateCount = new Map();
    for (let i = all.length - 1; i >= 0; i -= 1) {
      const m = all[i];
      if (isPrivate(m)) {
        const n = privateCount.get(m.by) || 0;
        if (n >= MAX_PRIVATE) continue;
        privateCount.set(m.by, n + 1);
      } else {
        if (publicCount >= MAX_PUBLIC) continue;
        publicCount += 1;
      }
      kept.push(m);
    }
    kept.reverse();
    if (kept.length) this.spaces[spaceId] = kept;
    else delete this.spaces[spaceId];
  }

  // What `viewer` may read, oldest first: every public message, and the viewer's own private ones. A null viewer (a
  // guest, whose sender is the shared `guest`) gets public messages only.
  list(spaceId, viewer = null) {
    this.prune(spaceId);
    return (this.spaces[spaceId] || []).filter((m) => !isPrivate(m) || (viewer != null && m.by === viewer)).map((m) => this.shown(spaceId, m));
  }

  // A message as it is sent, never as it is stored: a public AI answer whose question is its author's own carries a
  // read-only `question: { who, text }` (text cut at QUOTE_MAX), so its head can read "AI, for <name>" and quote it
  // while the question itself stays private (plan-chat-model.md, decision 11). A private answer never carries it, nor
  // does an answer whose question is gone or someone else's.
  shown(spaceId, m) {
    const out = copy(m);
    if (m.kind !== 'ai' || isPrivate(m) || !m.replyTo) return out;
    const q = (this.spaces[spaceId] || []).find((x) => x.id === m.replyTo);
    if (!q || q.by !== m.by) return out;
    out.question = { who: q.who, text: q.text.length > QUOTE_MAX ? `${q.text.slice(0, QUOTE_MAX - 1)}\u2026` : q.text };
    return out;
  }

  // The message as `viewer` may see it, or null (none, or someone else's private one).
  find(spaceId, messageId, viewer = null) {
    const m = (this.spaces[spaceId] || []).find((x) => x.id === messageId);
    if (!m || (isPrivate(m) && (viewer == null || m.by !== viewer))) return null;
    return m;
  }

  // `by` is the sender's user key ('guest' for a guest), `who` the name to show. A private message is only ever added
  // for a signed-in person (the routes never pass `private` for a guest). `kind` absent is an ordinary message;
  // `command` (with `command` and, for a module's command, `module`) the echo of a command; `ai` an AI answer, with
  // `summaries` and `replyTo`. `link` (plan-chat-links.md): the ordinary message's link, found by the route with
  // findLink (server/chat-links.js), stored as `preview: { url }`.
  add(spaceId, { by, who, text, visibility, kind, command, module, summaries, replyTo, at, link, prompt, sent, used, numbered, leftOut, cut }) {
    const ai = kind === 'ai' || command === 'ai';
    const clean = cleanText(text, ai ? MAX_AI_TEXT : MAX_TEXT);
    if (!clean) return null;
    const when = Number.isFinite(at) && at > 0 ? Math.floor(at) : Date.now();
    const message = { id: newId(), at: when, by: String(by || 'guest').slice(0, 40), who: cleanWho(who), text: clean };
    if (visibility === 'private') message.visibility = 'private';
    if (kind === 'command' || kind === 'ai') message.kind = kind;
    if (typeof command === 'string' && command) message.command = command.slice(0, 12);
    if (typeof module === 'string' && module) message.module = module.slice(0, 32);
    if (kind === 'ai' && Array.isArray(summaries) && summaries.length) message.summaries = summaries.slice(0, MAX_SUMMARIES);
    if (typeof replyTo === 'string' && ID_RE.test(replyTo)) message.replyTo = replyTo;
    // An AI answer's provenance (plan-ai-integration.md): the template version that made it, what was sent (counts and the
    // attached pointers, never content), the pointers it drew on, and whether it was cut short.
    if (kind === 'ai') {
      if (typeof prompt === 'string' && /^[a-z]+@\d{1,4}$/.test(prompt)) message.prompt = prompt;
      if (sent && typeof sent === 'object' && !Array.isArray(sent)) message.sent = JSON.parse(JSON.stringify(sent));
      if (Array.isArray(used) && used.length) message.used = JSON.parse(JSON.stringify(used.slice(0, 50)));
      // The pointer behind each number the answer may cite ([n] is numbered[n - 1]), and what was left out of the prompt.
      if (Array.isArray(numbered) && numbered.length) message.numbered = JSON.parse(JSON.stringify(numbered.slice(0, MAX_NUMBERED)));
      if (Array.isArray(leftOut) && leftOut.length) message.leftOut = JSON.parse(JSON.stringify(leftOut.slice(0, 20)));
      if (cut === true) message.cut = true;
    }
    if (!kind && typeof link === 'string' && link && link.length <= MAX_LINK) message.preview = { url: link };
    if (!this.spaces[spaceId]) this.spaces[spaceId] = [];
    const list = this.spaces[spaceId];
    // Kept in time order: a question asked before its answer came back is placed where its time puts it.
    let i = list.length;
    while (i > 0 && list[i - 1].at > when) i -= 1;
    list.splice(i, 0, message);
    this.prune(spaceId);
    this.save();
    return copy(message);
  }

  // Changes who sees a message, and nothing else. null: no such message for this person (someone else's private one
  // included). false: someone else's public message. Otherwise the message as stored, and whether it changed.
  setVisibility(spaceId, messageId, by, visibility) {
    const m = this.find(spaceId, messageId, by);
    if (!m) return null;
    if (m.by !== by) return false;
    const was = isPrivate(m) ? 'private' : 'public';
    if (was === visibility) return { message: this.shown(spaceId, m), changed: false };
    if (visibility === 'private') m.visibility = 'private';
    else delete m.visibility;
    this.flush({ publicFirst: visibility === 'public' });
    return { message: this.shown(spaceId, m), changed: true };
  }

  // Links in Chat (plan-chat-links.md). Both change one stored message in place, in whichever file it lives (public or
  // private), and nothing else about it; both are kept through a change of visibility, and go with the message when it
  // is deleted. null when there is no such message.
  //
  // What a read of the message's link found (readFields in server/chat-links.js), with the keeper's id as `module`.
  // Only once: a message whose preview was already read is left as it is (`changed: false`).
  setPreview(spaceId, messageId, moduleId, fields) {
    const m = (this.spaces[spaceId] || []).find((x) => x.id === messageId);
    if (!m || !m.preview || !m.preview.url) return null;
    if (m.preview.at) return { message: this.shown(spaceId, m), changed: false };
    m.preview = { url: m.preview.url, module: String(moduleId || '').slice(0, 32), ...fields };
    this.save();
    return { message: this.shown(spaceId, m), changed: true };
  }

  // The first Keep of the message's link (decision 11): who kept it and when. A message already kept is left as it is.
  setKept(spaceId, messageId, { by, who, at }) {
    const m = (this.spaces[spaceId] || []).find((x) => x.id === messageId);
    if (!m) return null;
    if (m.kept) return { message: this.shown(spaceId, m), changed: false };
    m.kept = { by: String(by || 'guest').slice(0, 40), who: cleanWho(who), at: Number.isFinite(at) ? Math.floor(at) : Date.now() };
    this.flush();
    return { message: this.shown(spaceId, m), changed: true };
  }

  clearedAt(spaceId) {
    const at = this.cleared[spaceId];
    return Number.isFinite(at) ? at : 0;
  }

  // null: no such message (someone else's private message counts as none, even for a moderator). false: it is
  // someone else's. `by` null lets a moderator delete any public message.
  remove(spaceId, messageId, by, viewer = by) {
    const list = this.spaces[spaceId];
    if (!list) return null;
    const at = list.findIndex((m) => m.id === messageId);
    if (at < 0) return null;
    if (isPrivate(list[at]) && (viewer == null || list[at].by !== viewer)) return null;
    if (by != null && list[at].by !== by) return false;
    const [gone] = list.splice(at, 1);
    if (!list.length) delete this.spaces[spaceId];
    this.flush();
    return gone;
  }

  // Deletes the person's own private messages in the space (all of them, or only those `which` accepts), never anyone
  // else's and never a public one. Returns how many went.
  removePrivate(spaceId, by, which = () => true) {
    const list = this.spaces[spaceId];
    if (!list || by == null) return 0;
    const keep = list.filter((m) => !(isPrivate(m) && m.by === by && which(m)));
    const count = list.length - keep.length;
    if (!count) return 0;
    if (keep.length) this.spaces[spaceId] = keep;
    else delete this.spaces[spaceId];
    this.flush();
    return count;
  }

  // Clear… (plan-chat-clear.md): removes the messages of one type in one pass, flushes once, and returns them as they
  // were stored (the route counts them and tells the call the public ids). `type` is `chat` (no `kind`), `ai` (an /ai
  // question or an AI answer), `module` (a command echo of the module `module`) or `all`. `scope` `mine` takes `by`'s
  // own messages of that type, public and private; `everyone` takes every public message of that type and `by`'s own
  // private ones, never anyone else's private message (decision 4). Anything unknown, or no `by`, removes nothing, so
  // a request that lost its words can never empty the chat. `cleared` is not touched: that marks a whole delete only.
  clearByType(spaceId, { type, module, scope, by } = {}) {
    const list = this.spaces[spaceId];
    if (!list || by == null || by === '') return [];
    const moduleId = typeof module === 'string' ? module.slice(0, 32) : '';
    const types = {
      chat: (m) => !m.kind,
      ai: isAi,
      module: (m) => Boolean(moduleId) && m.kind === 'command' && !isAi(m) && m.module === moduleId,
      all: () => true,
    };
    const ofType = typeof type === 'string' && Object.hasOwn(types, type) ? types[type] : null;
    if (!ofType || (scope !== 'mine' && scope !== 'everyone')) return [];
    const inScope = scope === 'mine' ? (m) => m.by === by : (m) => (isPrivate(m) ? m.by === by : true);
    const removed = [];
    const kept = [];
    for (const m of list) (ofType(m) && inScope(m) ? removed : kept).push(m);
    if (!removed.length) return [];
    if (kept.length) this.spaces[spaceId] = kept;
    else delete this.spaces[spaceId];
    this.flush();
    return removed.map(copy);
  }

  // Empties the space's chat for everyone, private messages included. The time is kept so a browser that still has an
  // old local copy does not bring those messages back.
  clear(spaceId) {
    delete this.spaces[spaceId];
    this.cleared[spaceId] = Date.now();
    this.flush();
  }

  forgetSpace(spaceId) {
    const changed = Boolean(this.spaces[spaceId] || this.cleared[spaceId]);
    delete this.spaces[spaceId];
    delete this.cleared[spaceId];
    if (changed) this.save();
  }

  // The one-time move of DATA_DIR/ai-threads.json ({ threads: { "<spaceId>:<userKey>": [{ id, at, role, text,
  // summaries?, shared? }] } }) into this store. Runs when that file exists and there is no `threadsMoved` mark.
  // Every entry becomes a private message of the person in the thread key, `shared: true` ones too (their public copy
  // is already in the chat). An id that is taken in that space, or is not 12 hex characters, gets a new one. Both files
  // are written, chat-private.json carrying the mark, first; then the old file is renamed to ai-threads.moved.json, so a second start does
  // nothing. `nameOf(userKey)` gives the person's display name, or null when the account is gone. Returns how many
  // messages were moved, or 0 when there was nothing to do.
  moveThreads(nameOf = () => null) {
    if (this.threadsMoved) return 0;
    const oldFile = path.join(this.dir, 'ai-threads.json');
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(oldFile, 'utf8'));
    } catch (err) {
      if (err && err.code === 'ENOENT') return 0;
      // Unreadable: left exactly where it is, unmarked, so nothing is lost and a fixed file moves on a later start.
      return 0;
    }
    const threads = raw && typeof raw.threads === 'object' && raw.threads ? raw.threads : {};
    const snapshot = JSON.stringify(this.spaces);
    let moved = 0;
    for (const [key, entries] of Object.entries(threads)) {
      const cut = key.indexOf(':');
      if (cut <= 0 || !Array.isArray(entries)) continue;
      const spaceId = key.slice(0, cut);
      const by = key.slice(cut + 1).slice(0, 40);
      if (!by) continue;
      const name = cleanWho(nameOf(by) || 'someone');
      if (!this.spaces[spaceId]) this.spaces[spaceId] = [];
      const list = this.spaces[spaceId];
      const taken = new Set(list.map((m) => m.id));
      let before = null; // the entry just before this one, as moved
      for (const e of entries) {
        if (!e || (e.role !== 'user' && e.role !== 'ai') || !Number.isFinite(e.at)) { before = null; continue; }
        const text = cleanText(e.text, MAX_AI_TEXT);
        if (!text) { before = null; continue; }
        let id = typeof e.id === 'string' && ID_RE.test(e.id) && !taken.has(e.id) ? e.id : null;
        while (!id || taken.has(id)) id = newId();
        taken.add(id);
        const message = { id, at: Math.floor(e.at), by, who: e.role === 'ai' ? 'AI' : name, text, visibility: 'private' };
        if (e.role === 'user') {
          message.kind = 'command';
          message.command = 'ai';
        } else {
          message.kind = 'ai';
          if (Array.isArray(e.summaries) && e.summaries.length) message.summaries = e.summaries.slice(0, MAX_SUMMARIES);
          if (before && before.kind === 'command') message.replyTo = before.id;
        }
        list.push(message);
        before = message;
        moved += 1;
      }
      list.sort((a, b) => a.at - b.at);
      if (!list.length) delete this.spaces[spaceId];
    }
    this.threadsMoved = Date.now();
    if (!this.flush()) {
      // Not written: try again on the next start rather than mark a move that is not on disk.
      this.threadsMoved = 0;
      this.spaces = JSON.parse(snapshot);
      return 0;
    }
    try {
      fs.renameSync(oldFile, path.join(this.dir, 'ai-threads.moved.json'));
    } catch {
      // chat-private.json carries the mark, so the old file is never read again even where it cannot be renamed
    }
    return moved;
  }
}

module.exports = { ChatHistory, CHAT_LIMITS: { MAX_PUBLIC, MAX_PRIVATE, MAX_AGE_MS, MAX_TEXT, MAX_AI_TEXT, MAX_SUMMARIES, MAX_PER_SPACE: MAX_PUBLIC } };
