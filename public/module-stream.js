// The modules' event stream on a page (GET /api/modules/stream), shared by every module mount on it, and the relay that
// lets a window frame on a space's Workspace hear it from the page instead of opening its own (health audit MP-01;
// Thomas, 2026-11-02: window frames share the page's stream).
//
// Why. A browser allows six connections to one site over HTTP/1.1, and an event stream holds one for as long as it is
// open. The space page already holds the notifications stream (brand.js) and the live stream (space-live.js); a stream per
// view the page's mounts need, and another per window frame (the Map's /map?space=<id>, the Calendar's /calendar?...),
// left nothing for any other request, so the Map window never finished loading.
//
// The hub (createStreamHub). Mounts join a view: a space's (its id) or the page's own (no space: the environment and the
// viewer's spaces), for a guest or not. The hub opens as few connections as carry every view wanted: the page's view and
// one space's ride one connection (?space=<id>&page=1; the server labels the page view's events `view: 'page'`), any other
// space has its own. When the views change (entering another space, going Home), the new connection is opened first and
// the old one closed only once the new one is open, so nothing is missed meanwhile; an event both carry (the server gives
// the same `id:` for the same thing on every stream, led by a token of its own start, so ids after a restart are new) is
// handed on once. A connection the browser gave up on (a refusal: no
// such space, signed out) is not opened again for that view until everyone left it, as before; a page view that rode on
// it gets a connection of its own.
//
// The relay (createStreamRelay on the page, createStreamRelayClient in the frame). A destination's page in a window frame
// on the Workspace (canvas.js compositeMount, iframe[data-composite]; same origin) asks the page over postMessage, never
// opens a stream: { type: 'app:streamjoin', doc, sub, space, guest } and 'app:streamleave' (sub '*': all of this
// document's, sent as the page goes). The page joins its own hub for it and posts each event back as { type:
// 'app:streamevent', doc, sub, event, data }, the same `data` an EventSource would have parsed. The page grants only the
// view the frame was made for (its space and the page's guest token, the ones in the frame's address), so a frame hears
// nothing the page did not give it (never the page's own view), and each mount's own filtering in the frame
// (module-host.js, mountModule) still decides what each module hears. Both sides check the other's window and origin; `doc` is the frame document's own token, so a new page in the
// frame starts over and the old page's subscriptions go. When the relay is made again for the same frame it says
// 'app:streamhello' and the frame joins again.
//
// Pure: nothing here reads the page's globals; module-host.js and canvas.js hand in the windows, and tools/check-streams.mjs
// runs it against a stand-in EventSource and clock.

export const STREAM_TYPES = Object.freeze(['change', 'schedule', 'links', 'refchange', 'bus', 'action', 'settings', 'markers', 'external']);
const PAGE = ''; // the page's own view
const SEEN_MAX = 512; // ids remembered per view, to hand on once what two connections both carried
const EVENT_SOURCE_CLOSED = 2;

// The stream's address for a connection: a space's view, with the page's (`page`) riding along, or the page's alone.
export function moduleStreamUrl({ space = null, page = false, guest = null } = {}) {
  const p = new URLSearchParams();
  if (space) p.set('space', space);
  if (space && page) p.set('page', '1');
  if (guest) p.set('guest', guest);
  return `/api/modules/stream?${p}`;
}

// The connections that carry `wanted` (a set of views: space ids, and '' for the page's own): the page's view with one
// space (the one in `keep` when it is still wanted, so a connection is not swapped for nothing), each other space alone.
// Answers [{ space, page }]: { space: null, page: false } is the page's view alone.
export function streamPlan(wanted, keep = null) {
  const views = [...wanted];
  const spaces = views.filter((v) => v !== PAGE);
  const page = views.includes(PAGE);
  const joined = page && spaces.length ? (keep && spaces.includes(keep) ? keep : spaces[0]) : null;
  const out = [];
  if (page) out.push({ space: joined, page: Boolean(joined) });
  for (const s of spaces) if (s !== joined) out.push({ space: s, page: false });
  return out;
}
const viewsOf = (c) => (c.space ? (c.page ? [c.space, PAGE] : [c.space]) : [PAGE]);

export function createStreamHub({ EventSourceImpl = globalThis.EventSource, schedule = (fn, ms) => setTimeout(fn, ms), cancel = (t) => clearTimeout(t), retireAfterMs = 15000 } = {}) {
  const groups = new Map(); // guest token ('' for none) -> { guest, views: Map(view -> Set(fn)), conns: Map(url -> conn), refused: Set(view), seen: Map(view -> { ids, order }), timer }
  const groupFor = (guest) => {
    const key = guest || '';
    let g = groups.get(key);
    if (!g) {
      g = { key, guest: guest || null, views: new Map(), conns: new Map(), refused: new Set(), seen: new Map(), timer: null };
      groups.set(key, g);
    }
    return g;
  };
  // Hand an event on to the view's mounts, once: an id already handed on in this view (the other connection had it) is not.
  function deliver(g, view, type, id, data) {
    const fns = g.views.get(view);
    if (!fns || !fns.size) return;
    if (id) {
      let s = g.seen.get(view);
      if (!s) { s = { ids: new Set(), order: [] }; g.seen.set(view, s); }
      const k = `${type}:${id}`;
      if (s.ids.has(k)) return;
      s.ids.add(k);
      s.order.push(k);
      if (s.order.length > SEEN_MAX) s.ids.delete(s.order.shift());
    }
    for (const fn of [...fns]) {
      try { fn(type, data); } catch (err) { console.error(err); }
    }
  }
  function close(g, c) {
    if (c.retireTimer !== null) cancel(c.retireTimer);
    c.retireTimer = null;
    c.es.close();
    g.conns.delete(c.url);
  }
  // A retiring connection goes once every view it carries that is still wanted is carried by an open one that stays.
  function settle(g) {
    for (const c of [...g.conns.values()]) {
      if (!c.retiring) continue;
      const covered = viewsOf(c).every((v) => !g.views.has(v) || g.refused.has(v) || [...g.conns.values()].some((o) => o !== c && !o.retiring && o.open && viewsOf(o).includes(v)));
      if (covered) close(g, c);
    }
    if (!g.conns.size && !g.views.size && groups.get(g.key) === g) {
      if (g.timer !== null) cancel(g.timer);
      g.timer = null;
      groups.delete(g.key);
    }
  }
  function open(g, p) {
    const url = moduleStreamUrl({ ...p, guest: g.guest });
    const es = new EventSourceImpl(url);
    const c = { url, space: p.space, page: p.page, es, open: false, retiring: false, retireTimer: null };
    for (const type of STREAM_TYPES) {
      es.addEventListener(type, (ev) => {
        if (g.conns.get(url) !== c) return;
        let data;
        try {
          data = JSON.parse(ev.data);
        } catch {
          return; // ignore a malformed event
        }
        if (!data || typeof data !== 'object') return;
        let view = c.space || PAGE;
        if (c.space && c.page) {
          if (data.view === 'page') view = PAGE;
          delete data.view; // the label is the connection's, not the module's
        }
        deliver(g, view, type, ev.lastEventId || '', data);
      });
    }
    es.addEventListener('open', () => {
      if (g.conns.get(url) !== c) return;
      c.open = true;
      settle(g);
    });
    es.addEventListener('error', () => {
      if (g.conns.get(url) !== c) return;
      c.open = false;
      if (es.readyState !== EVENT_SOURCE_CLOSED) return; // the browser tries again by itself
      // Given up (a refusal): that view is not asked for again until everyone has left it, as a stream of its own was.
      close(g, c);
      g.refused.add(c.space || PAGE);
      replan(g);
    });
    g.conns.set(url, c);
  }
  function replan(g) {
    g.timer = null;
    const wanted = new Set([...g.views.keys()].filter((v) => !g.refused.has(v)));
    const keep = [...g.conns.values()].find((c) => !c.retiring && c.page && c.space)?.space || null;
    const plan = streamPlan(wanted, keep);
    const urls = new Set();
    for (const p of plan) {
      const url = moduleStreamUrl({ ...p, guest: g.guest });
      urls.add(url);
      const c = g.conns.get(url);
      if (!c) open(g, p);
      else if (c.retiring) {
        c.retiring = false;
        if (c.retireTimer !== null) cancel(c.retireTimer);
        c.retireTimer = null;
      }
    }
    for (const c of [...g.conns.values()]) {
      if (urls.has(c.url) || c.retiring) continue;
      c.retiring = true;
      c.retireTimer = schedule(() => { c.retireTimer = null; if (g.conns.get(c.url) === c) { close(g, c); settle(g); } }, retireAfterMs);
    }
    settle(g);
  }
  // Views are joined and left in bursts (a canvas going from one space to the next): the connections follow once the
  // burst is over, in the same turn.
  const later = (g) => {
    if (g.timer === null) g.timer = schedule(() => replan(g), 0);
  };
  return {
    // Hear `space`'s view (null: the page's own) for `guest`: onEvent(type, data) for each event. Answers leave().
    join(space, guest, onEvent) {
      const g = groupFor(guest);
      const view = space || PAGE;
      let fns = g.views.get(view);
      if (!fns) { fns = new Set(); g.views.set(view, fns); }
      fns.add(onEvent);
      later(g);
      let left = false;
      return () => {
        if (left) return;
        left = true;
        const now = g.views.get(view);
        if (!now) return;
        now.delete(onEvent);
        if (!now.size) {
          g.views.delete(view);
          g.refused.delete(view);
          g.seen.delete(view);
        }
        later(g);
      };
    },
    // For checks: the connections open now, as their addresses.
    connections: () => [...groups.values()].flatMap((g) => [...g.conns.values()].map((c) => c.url)),
  };
}

const SUB_ID = /^[A-Za-z0-9_*-]{1,40}$/;
const MAX_FRAME_SUBS = 64;

// The page's side, for one window frame (`frame`, an iframe in `win`, which is where its messages arrive): `allow()`
// answers { space, guest }, the only view the frame may hear; `join` is the page's hub's. Answers stop().
export function createStreamRelay({ win, frame, origin, allow, join }) {
  const subs = new Map(); // sub -> leave
  let doc = null; // the token of the document in the frame now
  const post = (msg) => {
    try { frame.contentWindow?.postMessage(msg, origin); } catch { /* the page is not there */ }
  };
  const dropAll = () => {
    for (const leave of subs.values()) leave();
    subs.clear();
  };
  const onMessage = (e) => {
    if (!frame.contentWindow || e.source !== frame.contentWindow || e.origin !== origin) return;
    const d = e.data;
    if (!d || (d.type !== 'app:streamjoin' && d.type !== 'app:streamleave')) return;
    if (typeof d.doc !== 'string' || !SUB_ID.test(d.doc) || typeof d.sub !== 'string' || !SUB_ID.test(d.sub)) return;
    if (d.doc !== doc) { dropAll(); doc = d.doc; } // another page in the frame: the last one's go
    if (d.type === 'app:streamleave') {
      if (d.sub === '*') return dropAll();
      const leave = subs.get(d.sub);
      if (leave) { leave(); subs.delete(d.sub); }
      return;
    }
    if (d.sub === '*') return post({ type: 'app:streamjoined', doc, sub: d.sub, ok: false, error: 'that name is kept for leaving everything' }); // '*' means all of them
    if (subs.has(d.sub)) return post({ type: 'app:streamjoined', doc, sub: d.sub, ok: true }); // asked again: still on
    const may = allow() || {};
    const space = typeof d.space === 'string' && d.space ? d.space : null;
    const guest = typeof d.guest === 'string' && d.guest ? d.guest : null;
    if (!space || space !== (may.space || null) || guest !== (may.guest || null) || subs.size >= MAX_FRAME_SUBS) {
      return post({ type: 'app:streamjoined', doc, sub: d.sub, ok: false, error: 'this window may hear only the events its page gave it' });
    }
    const mine = doc;
    const sub = d.sub;
    subs.set(sub, join(space, guest, (event, data) => post({ type: 'app:streamevent', doc: mine, sub, event, data })));
    post({ type: 'app:streamjoined', doc, sub, ok: true });
  };
  // The frame's messages arrive in the window it is in. That can change under the relay: popping the call out moves the
  // canvas, this frame and all, into another window (and the frame's page loads again there). So on each load the relay
  // listens where the frame is now, and says hello so the new page joins.
  let at = null;
  const listen = (w) => {
    if (!w || w === at) return;
    if (at) at.removeEventListener('message', onMessage);
    at = w;
    at.addEventListener('message', onMessage);
  };
  const where = () => {
    try { return frame.ownerDocument?.defaultView || null; } catch { return null; }
  };
  const onLoad = () => {
    listen(where());
    post({ type: 'app:streamhello' });
  };
  listen(win);
  if (typeof frame.addEventListener === 'function') frame.addEventListener('load', onLoad);
  post({ type: 'app:streamhello' }); // a frame already there (the relay made again) joins again
  return () => {
    if (at) at.removeEventListener('message', onMessage);
    at = null;
    if (typeof frame.removeEventListener === 'function') frame.removeEventListener('load', onLoad);
    dropAll();
    doc = null;
  };
}

// The frame's side: `parent` is the page's window, `self` this one. Answers { join(space, guest, onEvent) -> leave }, as
// the hub's. A join the page has not answered within a moment is asked again (the page may still be wiring the frame);
// one it never answers (RELAY_TRIES asks) is carried by `fallback` instead, the frame's own stream (the hub's join), so the
// frame is never left without live updates.
// Who answers. A message's source is the window whose script posted it: the page's own when the canvas is in it, but once
// the call is popped out the frame sits in the popped-out window (`parent`) while the canvas's script still runs in the
// page that opened that window (`parent.opener`). Both are heard; the opener only while it is this site's.
const RELAY_TRIES = 4;
export function createStreamRelayClient({ parent, self, origin, fallback = null, schedule = (fn, ms) => setTimeout(fn, ms), cancel = (t) => clearTimeout(t) }) {
  const doc = `d${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
  const subs = new Map(); // sub -> { fn, space, guest, acked, tries, timer, own }
  let n = 0;
  const post = (msg) => {
    try { parent.postMessage({ ...msg, doc }, origin); } catch { /* the page is gone */ }
  };
  const fromPage = (src) => {
    if (!src) return false;
    if (src === parent) return true;
    try {
      const o = parent.opener;
      return Boolean(o) && src === o && o.location.origin === origin;
    } catch {
      return false; // an opener of another site
    }
  };
  // The page never answered: this join hears the frame's own stream from now on.
  const ownStream = (s) => {
    if (s.own || !fallback) return;
    s.own = fallback(s.space, s.guest, (event, data) => { try { s.fn(event, data); } catch (err) { console.error(err); } });
  };
  const ask = (sub, s) => {
    if (s.own) return;
    post({ type: 'app:streamjoin', sub, space: s.space, guest: s.guest });
    if (s.timer !== null) cancel(s.timer);
    s.timer = schedule(() => {
      s.timer = null;
      if (s.acked || subs.get(sub) !== s) return;
      s.tries += 1;
      if (s.tries < RELAY_TRIES) ask(sub, s);
      else ownStream(s);
    }, 1000 * (s.tries + 1));
  };
  const askAgain = () => { for (const [sub, s] of subs) { if (s.own) continue; s.acked = false; s.tries = 0; ask(sub, s); } };
  self.addEventListener('message', (e) => {
    if (e.origin !== origin || !fromPage(e.source)) return;
    const d = e.data;
    if (!d || typeof d.type !== 'string') return;
    if (d.type === 'app:streamhello') return askAgain();
    if (d.doc !== doc) return;
    const s = subs.get(d.sub);
    if (!s || s.own) return;
    if (d.type === 'app:streamjoined') {
      s.acked = true;
      if (s.timer !== null) cancel(s.timer);
      s.timer = null;
      if (d.ok !== true) console.warn(`[app] live updates: ${typeof d.error === 'string' ? d.error : 'the page said no'}`);
    } else if (d.type === 'app:streamevent' && typeof d.event === 'string' && STREAM_TYPES.includes(d.event) && d.data && typeof d.data === 'object') {
      try { s.fn(d.event, d.data); } catch (err) { console.error(err); }
    }
  });
  self.addEventListener('pagehide', () => { if ([...subs.values()].some((s) => !s.own)) post({ type: 'app:streamleave', sub: '*' }); });
  // Back from the browser's back-forward cache: the page dropped this document's subscriptions as it went, so join again.
  self.addEventListener('pageshow', (e) => { if (e.persisted) askAgain(); });
  return {
    join(space, guest, onEvent) {
      n += 1;
      const sub = `s${n}`;
      const s = { fn: onEvent, space: space || null, guest: guest || null, acked: false, tries: 0, timer: null, own: null };
      subs.set(sub, s);
      ask(sub, s);
      return () => {
        if (subs.get(sub) !== s) return;
        subs.delete(sub);
        if (s.timer !== null) cancel(s.timer);
        if (s.own) { s.own(); s.own = null; return; }
        post({ type: 'app:streamleave', sub });
      };
    },
  };
}
