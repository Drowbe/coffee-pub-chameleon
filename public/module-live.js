// Live messages for one module mount (plan-module-live.md, step 5): the page's side of host.live. A module calls
// live.publish, live.subscribe, live.unsubscribe, live.people and live.state through its SDK (public/sdk/host.js); the
// mount (public/module-host.js, mountModule) hands those calls here, and the module stream's `ready`, `lost`, `live`,
// `joined` and `left` events (public/module-stream.js). This is the boundary a sandboxed frame can't get past:
//
//   - Every call is cleaned here: only the fields named (anything else is refused), a topic of 1 to 40 of a-z, 0-9, dot,
//     underscore and dash, `to` a list of 1 to 20 people's keys (or guests' ids), `data` plain JSON of at most 256 bytes
//     with no `__proto__` key anywhere. The limits are the server's defaults until a join answers with its own.
//   - The module and the space are the mount's, never the module's: a call cannot name another module or space, and only
//     this module's messages in this space are handed on, and only for topics it subscribed to.
//   - A message's `data` reaches the module as a copy of its own (structuredClone), never merged into another object, and
//     one whose data has a `__proto__` key anywhere is dropped (JSON.parse makes it an own key; Object.assign or a merge
//     would turn it into a prototype).
//   - Publishing is held to the server's rate here too (MODULE_LIVE_PER_SECOND, 20 a second, with a burst of the same),
//     so a module that floods is refused at once (429) instead of spending the person's rate on the server.
//
// Join and leave: the mount joins the module's live messages (POST .../live/join with the stream's id from `ready`) while
// the module subscribes to a topic or watches who is there, and joins again after every `ready` (a reconnect, a new
// connection, the server started again). It leaves when the module stops wanting it, when its frame loads a new page
// (reset), when it is unmounted (destroy) and as the page goes (pageHide, a keepalive request). A stream that closes
// without a leave is left by the server after its grace.
//
// Nothing here talks to the call: it uses only the app's own requests (`request`) and the module stream.
//
// Pure: no globals beyond structuredClone; the mount hands in `request(path, body, { keepalive })` (path '', '/join' or
// '/leave' under /api/modules/<id>/live?space=...), `send(event, data)` to the module, and the clock. tools/check-sdk-live.mjs
// runs it on its own.

export const LIVE_DEFAULTS = Object.freeze({ bytes: 256, perSecond: 20, to: 20 });
export const LIVE_TOPIC = /^[a-z0-9._-]{1,40}$/;
export const LIVE_PERSON = /^(?:[a-z0-9]{4,16}|guest-[A-Za-z0-9_-]{4,40})$/;
const MAX_PEOPLE = 500; // people in one list handed on
const RETRY_MS = 3000; // a join that failed for no reason the server gave is asked again after this

const refusal = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });

// Whether a JSON value holds an own `__proto__` key anywhere (walked without recursion).
export function hasProtoKey(value) {
  const stack = [value];
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== 'object') continue;
    if (Array.isArray(v)) { for (const x of v) stack.push(x); continue; }
    for (const k of Object.keys(v)) {
      if (k === '__proto__') return true;
      stack.push(v[k]);
    }
  }
  return false;
}

// UTF-8 bytes of a string (no TextEncoder needed).
function utf8Bytes(text) {
  let n = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) { n += 4; i += 1; } else n += 3;
  }
  return n;
}

// Only these own fields, or the call is refused.
function onlyFields(params, allowed, sentence) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw refusal(sentence);
  if (Object.keys(params).some((k) => !allowed.includes(k))) throw refusal(sentence);
}

export function cleanTopic(topic) {
  if (typeof topic !== 'string' || !LIVE_TOPIC.test(topic)) throw refusal('the topic must be 1 to 40 of a-z, 0-9, dot, underscore and dash');
  return topic;
}

// A publish's params cleaned: { topic, data, to } (to: null for everyone else), or thrown (400, or 413 for too big).
export function cleanPublish(params, limits = LIVE_DEFAULTS) {
  onlyFields(params, ['topic', 'data', 'to'], 'send only topic, data and to');
  const topic = cleanTopic(params.topic);
  let to = null;
  if (params.to !== undefined && params.to !== null) {
    if (!Array.isArray(params.to) || !params.to.length || params.to.length > limits.to) throw refusal(`to must list 1 to ${limits.to} people`);
    if (!params.to.every((k) => typeof k === 'string' && LIVE_PERSON.test(k))) throw refusal('to must list people by their keys');
    to = [...new Set(params.to)];
  }
  let text;
  try {
    text = JSON.stringify(params.data === undefined ? null : params.data);
  } catch {
    throw refusal('the data must be plain JSON');
  }
  if (typeof text !== 'string') throw refusal('the data must be plain JSON');
  if (utf8Bytes(text) > limits.bytes) throw refusal(`a live message's data can be at most ${limits.bytes} bytes`, 413);
  const data = JSON.parse(text); // plain JSON from here on: no functions, no dates, no undefined
  if (hasProtoKey(data)) throw refusal('the data can\'t have a __proto__ key');
  return { topic, data, to };
}

// Someone as the stream names them: { key, name, guest }, or null.
export function cleanPerson(p) {
  if (!p || typeof p !== 'object' || typeof p.key !== 'string' || !LIVE_PERSON.test(p.key)) return null;
  return { key: p.key, name: typeof p.name === 'string' ? p.name.slice(0, 80) : '', guest: p.guest === true };
}
const cleanPeople = (list) => (Array.isArray(list) ? list.slice(0, MAX_PEOPLE).map(cleanPerson).filter(Boolean) : []);

// A `live` event from the stream for this module in this space, as the module gets it: { topic, data, from, at, seq }, or
// null (another module's or space's, a bad shape, data with a `__proto__` key).
export function cleanIncoming(d, moduleId, spaceId) {
  if (!d || typeof d !== 'object' || d.module !== moduleId || d.spaceId !== spaceId) return null;
  if (typeof d.topic !== 'string' || !LIVE_TOPIC.test(d.topic)) return null;
  const from = cleanPerson(d.from);
  if (!from || !Number.isSafeInteger(d.seq) || d.seq < 1 || typeof d.at !== 'number' || !Number.isFinite(d.at)) return null;
  const data = d.data === undefined ? null : d.data;
  if (hasProtoKey(data)) return null;
  let copy;
  try { copy = structuredClone(data); } catch { return null; }
  return { topic: d.topic, data: copy, from, at: d.at, seq: d.seq };
}

// One mount's live messages. `spaceId` null: not in a space (everything answers 'closed' and publish is refused with
// `notInSpace`). Answers { handlers, onStream(type, data), state(), reset(), pageHide(), destroy() }.
export function createLiveBridge({ moduleId, spaceId = null, request, send, notInSpace = 'live messages are off here', now = () => Date.now(), schedule = (fn, ms) => setTimeout(fn, ms), cancel = (t) => clearTimeout(t) }) {
  const inSpace = Boolean(spaceId);
  let limits = { ...LIVE_DEFAULTS };
  let stream = null; // the stream's id now (the last `ready`)
  let joinedOn = null; // the stream id the server has this module joined on
  let joining = null; // the stream id a join is out for
  let refused = null; // the server's lasting refusal ({ message, status }) until the next `ready`
  let retry = null;
  let destroyed = false;
  const topics = new Set();
  let watching = false;
  let people = [];
  let state = inSpace ? 'connecting' : 'closed';
  let bucket = { tokens: LIVE_DEFAULTS.perSecond, at: now() };

  const wanted = () => topics.size > 0 || watching;
  const tell = (event, data) => { if (!destroyed) { try { send(event, data); } catch (err) { console.error(err); } } };
  const stateNow = () => {
    if (destroyed || !inSpace || refused) return 'closed';
    if (!stream) return 'connecting';
    if (wanted() && joinedOn !== stream) return 'connecting';
    return 'open';
  };
  // `fresh`: a new `ready` (the module's last-seen sequence numbers start over: they restart after a server restart).
  function update(fresh = false) {
    const next = stateNow();
    if (next === state && !fresh) return;
    state = next;
    tell('live.state', { state, ...(fresh ? { fresh: true } : {}), ...(state === 'closed' && refused ? { reason: refused.message } : {}) });
  }
  function later(ms) {
    if (retry !== null) cancel(retry);
    retry = schedule(() => { retry = null; sync(); }, ms);
  }
  function join(id) {
    joining = id;
    Promise.resolve().then(() => request('/join', { stream: id })).then((answer) => {
      if (joining === id) joining = null;
      if (destroyed || id !== stream) {
        if (destroyed) Promise.resolve().then(() => request('/leave', { stream: id })).catch(() => {});
        else sync();
        return;
      }
      joinedOn = id;
      const l = answer && answer.limits;
      if (l && typeof l === 'object') {
        limits = {
          bytes: Number.isSafeInteger(l.bytes) && l.bytes > 0 ? l.bytes : LIVE_DEFAULTS.bytes,
          perSecond: Number.isSafeInteger(l.perSecond) && l.perSecond > 0 ? l.perSecond : LIVE_DEFAULTS.perSecond,
          to: Number.isSafeInteger(l.to) && l.to > 0 ? l.to : LIVE_DEFAULTS.to,
        };
      }
      people = cleanPeople(answer && answer.people);
      update();
      if (watching) tell('live.people', { joined: null, left: null, people });
      if (!wanted()) sync();
    }, (err) => {
      if (joining === id) joining = null;
      if (destroyed || id !== stream) return;
      const status = err && err.status;
      if (status === 409) { stream = null; update(); return; } // that connection is gone: the next `ready` brings one
      if (status === 429) { later(Math.max(1, Number(err.retryAfter) || 1) * 1000); return; }
      if (status === 400 || status === 401 || status === 403 || status === 404) {
        refused = { message: err.message || 'live messages are off here', status };
        update();
        return;
      }
      later(RETRY_MS); // no answer, or the server failed: ask again
    });
  }
  function leave(id) {
    joinedOn = null;
    Promise.resolve().then(() => request('/leave', { stream: id })).catch(() => {});
  }
  function sync() {
    if (destroyed || !inSpace) return;
    if (wanted()) {
      if (!refused && stream && joinedOn !== stream && joining !== stream) join(stream);
    } else if (joinedOn) {
      leave(joinedOn);
    }
    update();
  }

  // The stream's events for this mount (the hub hands every mount in the space each one).
  function onStream(type, d) {
    if (destroyed || !inSpace || !d || typeof d !== 'object') return;
    if (type === 'ready') {
      if (typeof d.stream !== 'string' || !d.stream || d.stream === stream) return; // said twice (a late mount): once
      stream = d.stream;
      joinedOn = null;
      refused = null; // access may have changed: ask again
      update(true);
      sync();
    } else if (type === 'lost') {
      stream = null;
      joinedOn = null;
      update();
    } else if (type === 'live') {
      const m = cleanIncoming(d, moduleId, spaceId);
      if (m && topics.has(m.topic)) tell('live.message', m);
    } else if (type === 'joined' || type === 'left') {
      if (d.module !== moduleId || d.spaceId !== spaceId) return;
      const person = cleanPerson(d.person);
      if (!person) return;
      people = cleanPeople(d.people);
      if (watching) tell('live.people', { joined: type === 'joined' ? person : null, left: type === 'left' ? person : null, people });
    }
  }

  // The local rate: a token bucket of limits.perSecond, as the server's for one person in one module.
  function takeToken() {
    const t = now();
    const rate = limits.perSecond;
    const tokens = Math.min(rate, bucket.tokens + ((t - bucket.at) / 1000) * rate);
    if (tokens < 1) { bucket = { tokens, at: t }; return false; }
    bucket = { tokens: tokens - 1, at: t };
    return true;
  }

  const handlers = {
    // { topic, data, to? }: resolves true once the server took it (never when it was delivered: live messages are lossy).
    async 'live.publish'(params) {
      if (!inSpace) throw refusal(notInSpace);
      if (destroyed) throw refusal('live messages are off here');
      const said = cleanPublish(params, limits);
      if (refused && (refused.status === 400 || refused.status === 404)) throw refusal(refused.message, refused.status);
      if (!takeToken()) throw refusal('too many live messages; wait a moment', 429, { retryAfter: 1 });
      await request('', { topic: said.topic, data: said.data, ...(said.to ? { to: said.to } : {}) });
      return true;
    },
    async 'live.subscribe'(params) {
      onlyFields(params, ['topic'], 'send only topic');
      if (!inSpace) throw refusal(notInSpace);
      topics.add(cleanTopic(params.topic));
      sync();
      return { state };
    },
    async 'live.unsubscribe'(params) {
      onlyFields(params, ['topic'], 'send only topic');
      topics.delete(cleanTopic(params.topic));
      sync();
      return { state };
    },
    // { on }: watch who has joined (the 'live.people' event); answers who is there now (once joined) and the state.
    async 'live.people'(params) {
      onlyFields(params, ['on'], 'send only on');
      if (typeof params.on !== 'boolean') throw refusal('on must be true or false');
      if (!inSpace && params.on) throw refusal(notInSpace);
      watching = params.on;
      sync();
      return { state, people: watching && joinedOn ? people : [] };
    },
    async 'live.state'(params) {
      onlyFields(params, [], 'send nothing');
      return { state };
    },
  };

  return {
    handlers,
    onStream,
    state: () => state,
    // The module's frame loaded a page (its old subscriptions went with the old page): forget them, and leave.
    reset() {
      topics.clear();
      watching = false;
      if (retry !== null) { cancel(retry); retry = null; }
      sync();
    },
    // The page is going: leave now, with a request that outlives the page.
    pageHide() {
      if (!joinedOn) return;
      const id = joinedOn;
      joinedOn = null;
      // Not deferred: the page may be gone after this turn.
      try { Promise.resolve(request('/leave', { stream: id }, { keepalive: true })).catch(() => {}); } catch { /* the page is going */ }
    },
    // Back from the browser's back-forward cache: join again (a stale id is answered 409, and the next `ready` joins).
    pageShow() { sync(); },
    // Unmounted: leave, and hear nothing more.
    destroy() {
      if (destroyed) return;
      if (joinedOn) leave(joinedOn);
      if (retry !== null) { cancel(retry); retry = null; }
      topics.clear();
      watching = false;
      destroyed = true;
      state = 'closed';
    },
  };
}
