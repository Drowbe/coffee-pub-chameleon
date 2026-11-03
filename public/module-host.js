// The page side of a module frame. A module runs in a sandboxed iframe and can
// only talk to this page (see public/sdk/host.js); this file answers those
// calls by making the real, authenticated requests, and pushes live changes
// back into the frame. Used by a module's own page (module.js), the dashboard (dashboard.js) and a
// space's canvas (canvas.js).

import { api, accessKeyHeaders, word, words, withinSpacePage, showNote, undoToast } from '/brand.js';
import { confirmDialog } from '/confirm.js';
import { pickObjects } from '/object-pick.js';
import { nav as navBar } from '/nav-bar.js';
import { openHostMenu, closeHostMenu } from '/host-menu.js';
import { cleanAddEntries, foldBarItems, cleanStatusItems, statusKey, statusSpoken, statusFrame, createAnnouncer, topmostAt, cleanToolbarItems, cleanHeaderItems, titlebarActions, frameToolbar, frameAdd, cleanStandardActions, cleanShareResult } from '/module-chrome.js';
import { shareDialog, printFrame } from '/module-actions.js';
import { createStreamHub, createStreamRelay, createStreamRelayClient } from '/module-stream.js';

// The design tokens a module's frame receives (see design-theme.md).
const THEME_TOKENS = [
  '--bg', '--bg-section', '--bg-card', '--bg-input', '--border', '--text', '--text-dim', '--accent', '--on-accent',
  '--accent-hover', '--primary-hover', '--secondary', '--secondary-text', '--secondary-hover', '--header-bg',
  '--header-text', '--icon-hover', '--danger', '--ok', '--surface', '--surface-hover', '--shade',
  // The colour roles the shared stylesheet's buttons read (a module in a frame gets that stylesheet from the server's page route, and these values).
  '--accent-fill', '--accent-fill-hover', '--text-on-accent', '--fill-secondary', '--fill-secondary-hover', '--text-on-secondary',
  '--edge-hairline', '--text-primary', '--text-muted', '--fill-hover', '--fill-selected', '--text-selected', '--focus-ring',
  '--status-danger-fill', '--status-danger-text', '--status-danger-on-fill',
  // The tints (plan-chat-model.md), in the mode showing, so a module's own colour matches the host's.
  '--tint-gold', '--tint-blue', '--tint-green', '--tint-teal', '--tint-purple', '--tint-red', '--tint-orange', '--tint-pink',
];

export function readTheme() {
  const styles = getComputedStyle(document.documentElement);
  const theme = {};
  for (const token of THEME_TOKENS) {
    const value = styles.getPropertyValue(token).trim();
    if (value) theme[token] = value;
  }
  return theme;
}

// One event stream per page is shared by every module mount on it (public/module-stream.js: the page's own view and
// one space's ride one connection). Browsers allow only a few long-lived connections to one site (six over HTTP/1.1),
// so a stream per module, or per window frame, starves everything else. See GET /api/modules/stream in server/index.js.
// A destination's page in a window frame on a space's Workspace (canvas.js marks that frame data-composite) opens no
// stream: it hears the page's over postMessage (createStreamRelayClient; the page's side is relayStreamToFrame, below).
const streamHub = createStreamHub();
let frameRelay; // undefined: not asked yet; null: not in a window frame on the Workspace
export function joinStream(space, guest, onEvent) {
  if (frameRelay === undefined) {
    let inComposite = false;
    try {
      inComposite = window.self !== window.top && Boolean(window.frameElement && window.frameElement.hasAttribute('data-composite'));
    } catch {
      inComposite = false;
    }
    // A join the page never answers falls back to this frame's own stream (the hub), so live updates never stop.
    frameRelay = inComposite ? createStreamRelayClient({ parent: window.parent, self: window, origin: location.origin, fallback: (space, guest, fn) => streamHub.join(space, guest, fn) }) : null;
  }
  return (frameRelay || streamHub).join(space, guest, onEvent);
}
// The page's side of the relay, for one window frame on the Workspace (canvas.js, compositeMount): the frame may hear
// only `allow()`'s view ({ space, guest }: the space and guest token the frame was made for). `win` is the window the
// frame is in (not this one when the call has been popped out). Answers stop(), for when the window closes.
export function relayStreamToFrame(frame, { win = window, allow }) {
  return createStreamRelay({ win, frame, origin: win.location.origin, allow, join: (space, guest, fn) => streamHub.join(space, guest, fn) });
}

// --- watching one person's media (host.media.watch) ----------------------------------------------
// A read-only viewer connection to the space the person is in, following them as they move (`follow`),
// that never publishes. The module gets the elements to place (`handlers.video`, `handlers.audio`),
// the person's state (`handlers.state`: online, cameraOn, micOn, speaking, name) and their reactions
// (`handlers.reaction`). The client library is loaded the first time anyone watches.
// With no call service on the server (branding.callService false) there is no media to watch: it answers at once, once,
// with `state` { online: false, ..., unavailable: true, reason } and `connection` { connected: false, unavailable: true,
// error: reason }, never loads the client library nor asks for a token, and hands back a watcher whose follow and stop
// do nothing. The module draws from host.presence and host.images alone.
const MEDIA_UNAVAILABLE = 'Voice and video are not set up on this server.';
let livekit = null;
async function watchMedia({ key, audio = false, video = true, space: startSpace = 'lobby', handlers = {} }) {
  if (typeof key !== 'string' || !key) throw Object.assign(new Error('media.watch needs the person\'s key'), { status: 400 });
  const call = (name, ...args) => { try { if (typeof handlers[name] === 'function') handlers[name](...args); } catch (err) { console.error(err); } };
  if ((await brandingOnce()).callService === false) {
    call('state', { online: false, cameraOn: false, micOn: false, speaking: false, name: null, unavailable: true, reason: MEDIA_UNAVAILABLE });
    call('connection', { connected: false, space: null, unavailable: true, error: MEDIA_UNAVAILABLE });
    return { follow() {}, stop() {} };
  }
  if (!livekit) livekit = await import('/lib/livekit-client.esm.mjs');
  const { Room, RoomEvent, Track } = livekit;
  const viewer = new Room({ adaptiveStream: false });
  // Everything for a video box; a box that only needs "are they talking" subscribes to the microphone
  // alone once the person is found (LiveKit reports who is talking over the subscriber link).
  const autoSubscribe = video || audio;
  let participant = null;
  let speaking = false;
  let wantedSpace = typeof startSpace === 'string' && startSpace ? startSpace : 'lobby';
  let connectedSpace = null;
  let following = false; // this disconnect is ours (follow), so reconnect at once, not after the usual pause
  let stopped = false;
  let videoEl = null;
  let audioEl = null;
  // One retry at a time: a failed connect is reported both by its own rejection and by a Disconnected event,
  // and two timers per failure would double the attempts every round.
  let retry = null;
  const connectLater = (ms) => {
    if (stopped) return;
    clearTimeout(retry);
    retry = setTimeout(connect, ms);
  };

  const state = () => {
    const cam = participant && participant.getTrackPublication(Track.Source.Camera);
    const mic = participant && participant.getTrackPublication(Track.Source.Microphone);
    call('state', {
      online: Boolean(participant),
      cameraOn: Boolean(cam && !cam.isMuted && cam.track),
      micOn: Boolean(mic && !mic.isMuted),
      speaking: Boolean(participant) && speaking,
      name: participant ? participant.name || null : null,
    });
  };
  const subscribeMic = (p) => {
    if (autoSubscribe) return;
    for (const pub of p.trackPublications.values()) if (pub.kind === Track.Kind.Audio && !pub.isSubscribed) pub.setSubscribed(true);
  };
  const adopt = (p) => {
    if (p.identity !== key) return;
    participant = p;
    subscribeMic(p);
    state();
  };
  const dropMedia = () => {
    if (videoEl) { videoEl.remove(); videoEl = null; call('video', null); }
    if (audioEl) { audioEl.remove(); audioEl = null; call('audio', null); }
  };
  const drop = (p) => {
    if (p.identity !== key) return;
    participant = null;
    dropMedia();
    state();
  };
  viewer
    .on(RoomEvent.ParticipantConnected, adopt)
    .on(RoomEvent.ParticipantDisconnected, drop)
    .on(RoomEvent.TrackPublished, (_pub, p) => adopt(p))
    .on(RoomEvent.TrackSubscribed, (track, _pub, p) => {
      if (p.identity !== key) return;
      participant = p;
      if (track.kind === Track.Kind.Video && video) {
        if (videoEl) videoEl.remove();
        videoEl = track.attach();
        call('video', videoEl);
      } else if (track.kind === Track.Kind.Audio && audio) {
        if (audioEl) audioEl.remove();
        audioEl = track.attach();
        call('audio', audioEl);
      }
      state();
    })
    .on(RoomEvent.TrackUnsubscribed, (track, _pub, p) => {
      if (p.identity !== key) return;
      const gone = track.detach();
      if (videoEl && gone.includes(videoEl)) { videoEl = null; call('video', null); }
      if (audioEl && gone.includes(audioEl)) { audioEl = null; call('audio', null); }
      gone.forEach((el) => el.remove());
      state();
    })
    .on(RoomEvent.TrackMuted, (_pub, p) => adopt(p))
    .on(RoomEvent.TrackUnmuted, (_pub, p) => adopt(p))
    .on(RoomEvent.DataReceived, (payload, p, _kind, topic) => {
      if (topic !== 'reaction' || !p || p.identity !== key) return;
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));
        if (data.type === 'reaction' && typeof data.id === 'string') call('reaction', data.id);
      } catch {
        // not a reaction
      }
    })
    .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const now = speakers.some((s) => s.identity === key);
      if (now !== speaking) {
        speaking = now;
        state();
      }
    })
    .on(RoomEvent.Disconnected, () => {
      connectedSpace = null;
      participant = null;
      dropMedia();
      state();
      call('connection', { connected: false, space: null });
      const soon = following;
      following = false;
      connectLater(soon ? 300 : 3000);
    });

  async function connect() {
    if (stopped) return;
    const target = wantedSpace;
    try {
      const { token, livekitUrl } = await api('POST', '/api/token', { role: 'viewer', space: target });
      await viewer.connect(livekitUrl, token, { autoSubscribe });
      connectedSpace = target;
      call('connection', { connected: true, space: target });
      for (const p of viewer.remoteParticipants.values()) adopt(p);
      state();
    } catch (err) {
      call('connection', { connected: false, space: null, error: err.message });
      connectLater(5000);
    }
  }
  connect();
  return {
    // The person moved: leave this space for that one (the reconnect follows Disconnected).
    follow(spaceId) {
      if (typeof spaceId !== 'string' || !spaceId || spaceId === wantedSpace) return;
      wantedSpace = spaceId;
      if (connectedSpace) {
        following = true;
        viewer.disconnect().catch(() => {});
      }
    },
    stop() {
      stopped = true;
      clearTimeout(retry);
      dropMedia();
      viewer.disconnect().catch(() => {});
    },
  };
}

// --- dragging an object from one module onto another ---------------------------------------------
// A drag that starts in one module frame does not reliably carry its data into another, so the host
// brokers it. The source says a drag of a pointer began (host.objects.drag), the host puts an invisible
// layer over every other module frame on the page for the length of the drag, and the layer, being in
// the host's own page, receives the drag. It tells the frame under it where the pointer is and, on a
// drop, which pointer was dropped, in the frame's own coordinates. The frame decides what that means
// (and the host still checks the pointer when it is resolved). Nothing else crosses.
const mounted = new Set(); // every module frame the host has on this page: { frame, module, send }

// --- one page, for a request only the asking page may carry out -------------------------------------------------------------
// A `local` action asked with { here: true } (host.actions.request; Places' target button asking Maps for a spot) is for a
// module open in the page that asked, never in another tab the same person has open, and only for a few seconds: the host
// puts the page's id (`page`) and a time limit (`pageUntil`, ms) in the input, and a mount in any other page, or one that
// comes after the limit, never hears of it. The host owns both fields: a module's own `page` or `pageUntil` is dropped.
// The provider declares them in its action's input ("page": "string?", "pageUntil": "number?"), or the server drops them
// and the request goes to any page as before. The page is this window together with the frames in it (a composite's page
// in a frame on the Workspace) and a window it opened (a pop-out): they share one record, `window.__modulePage`
// ({ id, open }), found through the parent or the opener. `open` holds the mounts in the page, so host.actions.list can
// say which actions a module open here answers (`open: true`).
export const PAGE_WAIT_MS = 5000;
export function pageInput(input, here, pageId, now) {
  const out = input && typeof input === 'object' && !Array.isArray(input) ? { ...input } : {};
  delete out.page;
  delete out.pageUntil;
  if (here) { out.page = pageId; out.pageUntil = now + PAGE_WAIT_MS; }
  return out;
}
// Whether a request (its input, as the server passed it on) is for a mount in this page now.
export function forThisPage(input, pageId, now) {
  if (!input || typeof input !== 'object' || input.page === undefined) return true;
  return input.page === pageId && !(Number(input.pageUntil) < now);
}
// --- end of pageInput

// The environment's facts a module is told (host.environment), from its context: the picture map, { file, minZoom, maxZoom,
// tileType }, or null.
export function environmentFacts(answer) {
  const pm = answer && answer.environment && answer.environment.pictureMap;
  return { pictureMap: pm && typeof pm === 'object' && !Array.isArray(pm) ? pm : null };
}
const thisPage = (() => {
  const near = [];
  try { if (window.parent && window.parent !== window) near.push(window.parent); } catch { /* none */ }
  try { if (window.opener) near.push(window.opener); } catch { /* none */ }
  for (const w of near) {
    try {
      const p = w.__modulePage;
      if (p && typeof p.id === 'string' && p.open && typeof p.open.add === 'function') { window.__modulePage = p; return p; }
    } catch { /* another origin */ }
  }
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const p = { id: [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''), open: new Set() };
  try { window.__modulePage = p; } catch { /* not shared */ }
  return p;
})();
// Whether a module is mounted in this page (any of its windows and frames) and still on screen there.
function openInPage(moduleId) {
  for (const e of [...thisPage.open]) {
    const win = e.el && e.el.ownerDocument && e.el.ownerDocument.defaultView;
    if (!win || win.closed || !e.el.isConnected) { if (!win || win.closed) thisPage.open.delete(e); continue; }
    if (e.module === moduleId) return true;
  }
  return false;
}
// Light or dark flipped, or the owner changed the theme (theme-mode.js fires 'app:theme' once the new colors are in):
// every module hears its colors again, through the SDK's 'theme' event, which a framed module's SDK also sets on its
// own :root.
document.addEventListener('app:theme', () => {
  const theme = readTheme();
  for (const target of mounted) target.send('theme', theme);
});
let activeDrag = null; // { source, ref, layers, timer }

// The browser's time zone (IANA), sent with every ask so the AI's "today" is the asker's.
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };
const REF_SHAPE = (r) => r && typeof r.module === 'string' && typeof r.kind === 'string' && typeof r.id === 'string'
  && /^[a-z][a-z0-9-]{1,31}$/.test(r.module) && /^[a-z][a-z0-9-]{0,23}$/.test(r.kind) && /^[A-Za-z0-9_-]{1,64}$/.test(r.id)
  && (r.scope === 'environment' || r.scope === 'person' || (r.scope === 'space' && typeof r.space === 'string' && r.space.length <= 64));
// A pointer that passed REF_SHAPE, with only its own fields.
const cleanPointer = (r) => ({ module: r.module, kind: r.kind, id: r.id, scope: r.scope, ...(r.scope === 'space' ? { space: r.space } : {}) });

// The environment's name, as its header shows it (GET /api/branding, public, asked once per page): a module names the
// environment's own list by it (info.context.environment.name), as the destination's filter does (decision 19).
// The same answer says whether the server has a call service (callService), for host.media.watch.
let brandingAsked = null;
function brandingOnce() {
  if (!brandingAsked) brandingAsked = fetch('/api/branding').then((res) => (res.ok ? res.json() : {})).catch(() => ({}));
  return brandingAsked;
}
function environmentName() {
  return brandingOnce().then((b) => (typeof b.environmentName === 'string' ? b.environmentName.trim() : ''));
}

// --- who is where, for a module (host.presence) -----------------------------------------------------
// GET /api/presence as a module reads it. A person's place is as the viewer may know it (plan-primary-nav step 3):
// `space` is a space or an aside the viewer belongs to, or null; `aside` says they are in an aside (`space` is then
// the aside's id, or the space it came out of), and `asidePrivate` whether that aside is a private conversation (never
// with whom); `elsewhere` says they are online somewhere the viewer is not told of.
// `activeSpace` is null when there is none the viewer may know of.
function presenceForModule(d) {
  return {
    people: (d.users || []).map((u) => ({ key: u.key, name: u.displayName, online: Boolean(u.online), space: u.space || null, aside: Boolean(u.aside), asidePrivate: Boolean(u.aside && u.asidePrivate), elsewhere: Boolean(u.elsewhere), inCall: Boolean(u.inCall), isOwner: Boolean(u.isOwner) })),
    spaces: (d.spaces || []).map((r) => ({ id: r.id, name: r.name })),
    asides: (d.asides || []).map((r) => ({ id: r.id, origin: r.origin || null, private: Boolean(r.private) })),
    activeSpace: typeof d.activeSpace === 'string' && d.activeSpace ? d.activeSpace : null,
    ownerOnline: Boolean(d.ownerOnline),
    reactions: (d.reactions || []).map((r) => ({ id: r.id, glyph: r.glyph })),
    pictureScale: d.pictureScale || 100,
  };
}

// --- where a module's call goes -------------------------------------------------------------------
// A call names a scope ('context', the default, is wherever the frame is showing) and may name a space:
// { space: <id> } from a module's environment page reaches into one of the viewer's spaces, to write there as well as
// read (plan-calendar-destination). The host only shapes the request; the server decides whether this viewer may.
// A mount in a space reaches only its own space. `mount` is { scope, spaceId, moduleScopes }. Returns { scope, space }.
const SPACE_ID = /^[A-Za-z0-9_-]{1,64}$/;
function placeOf(requested, space, mount) {
  const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }); };
  const named = space !== undefined && space !== null && space !== '';
  if (named && (typeof space !== 'string' || !SPACE_ID.test(space))) fail('that is not a space');
  const scopes = Array.isArray(mount.moduleScopes) ? mount.moduleScopes : [];
  let sc = !requested || requested === 'context' ? (named ? 'space' : mount.scope) : requested;
  // A name from before the product's rename says which word replaced it.
  const renamed = { server: 'environment', room: 'space', rooms: 'spaces' }[sc];
  if (renamed) fail(`scope "${sc}" is an old name; use "${renamed}"`);
  if (!['environment', 'space', 'spaces', 'person'].includes(sc)) fail(`scope "${String(sc).slice(0, 20)}" is not one of context, environment, space, spaces or person`);
  if (named && sc !== 'space') fail(`a space goes with scope "space", not "${sc}"`);
  // 'person' is the viewer's own data (their profile's), from a page anywhere; the module must have declared the scope.
  if (sc === 'person' && !scopes.includes('person')) fail('this module has no personal scope');
  // 'spaces' is the environment page reading every space the viewer belongs to (read-only).
  if (sc === 'spaces' && (mount.scope !== 'environment' || !scopes.includes('space'))) fail('only a module\'s environment page can read across spaces');
  if (sc !== 'space') return { scope: sc, space: null };
  if (mount.scope === 'space') {
    if (named && space !== mount.spaceId) fail('this module is in another space');
    return { scope: 'space', space: mount.spaceId };
  }
  if (!named) fail('this module is not in a space');
  if (!scopes.includes('space')) fail('this module has no space scope');
  return { scope: 'space', space };
}

// The query for GET /api/objects/search on a module's behalf (host.objects.search). 'person' is the viewer's own
// private objects, from anywhere. `scope: 'spaces'` (a module's environment page only, never a space or a keyed page)
// asks every space the viewer belongs to at once, each pointer with its space; `has: 'place'` keeps only summaries
// with a place (plan-map-destination, "SDK and the host"). Otherwise the place is placeOf's.
function objectSearchParams(moduleId, { q, scope: s, space, has, kind, in: marked } = {}, mount) {
  const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }); };
  let sc;
  if (s === 'person') sc = { scope: 'person', space: null };
  else if (s === 'spaces') {
    if (mount.scope !== 'environment' || mount.keyed) fail('only a module\'s environment page can search across spaces');
    if (space !== undefined && space !== null && space !== '') fail('a space goes with scope "space", not "spaces"');
    sc = { scope: 'spaces', space: null };
  } else sc = placeOf(s, space, mount);
  if (has !== undefined && has !== null && has !== '' && has !== 'place' && has !== 'amount') fail('has is "place", "amount" or nothing');
  const p = new URLSearchParams({ from: moduleId, q: String(q || '').slice(0, 100), scope: sc.scope });
  if (sc.scope === 'space') p.set('space', sc.space);
  if (has === 'place' || has === 'amount') p.set('has', has);
  // `kind`: one kind of object only (all of them, up to 1,000), so a module need not page the newest 50 for the few it wants.
  if (typeof kind === 'string' && kind) p.set('kind', kind.slice(0, 32));
  // `in`: a space's id, with scope 'environment': the environment's objects marked for that space (the server checks the rest).
  if (typeof marked === 'string' && marked) p.set('in', marked.slice(0, 64));
  return p;
}
// --- end of the search

// Whether a mount may show the person's own other calendars: only at environment scope, on no keyed page, and not
// within a space in any way (a page opened over a call, or a window popped out of a space's canvas).
export function externalAllowedHere({ scope, keyed = false, overCall = false, search = '' }) {
  const q = new URLSearchParams(search || '');
  return scope === 'environment' && !keyed && !overCall && !q.get('space') && q.get('popout') !== '1' && q.get('from') !== 'space';
}
// --- end of externalAllowedHere

// --- destinations ---------------------------------------------------------------------------------
// A destination (plan-calendar-destination, plan-map-destination) is a host page made of modules' parts: a `main`
// and up to one `panel`. The page keeps one shared state per destination and hands it to every part on mount and on
// each change (host.destination.onState). The page sets what it owns (the view, the filter, the search) with
// update(); a part may change only the fields its destination lets that part change (host.destination.set), each
// checked for shape. Each destination's state is its own shape.
const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;
const MARKER_KIND_ID = /^[a-z0-9][a-z0-9-]{0,39}:[A-Za-z0-9_-]{1,40}$/;
const TINT_NAMES = ['gold', 'blue', 'green', 'teal', 'purple', 'red', 'orange', 'pink'];
const DESTINATION_FIELDS = {
  day: (v) => (typeof v === 'string' && DAY_TEXT.test(v) ? v : undefined),
  from: (v) => (typeof v === 'string' && DAY_TEXT.test(v) ? v : undefined),
  to: (v) => (typeof v === 'string' && DAY_TEXT.test(v) ? v : undefined),
  selected: (v) => (v === null ? null : REF_SHAPE(v) ? cleanPointer(v) : undefined),
  // A part asking the page to bring a part into view (on a phone, its tab): the map's "Show in list".
  reveal: (v) => (v === 'main' || v === 'panel' ? v : undefined),
  // The map says whether it is drawn (a map file in use, a device that can draw it), so the list beside it says "On the map" only
  // when that is true; the list says its places changed (a counter), so the map reads them again at once.
  mapOn: (v) => (typeof v === 'boolean' ? v : undefined),
  changed: (v) => (Number.isSafeInteger(v) && v >= 0 ? v : undefined),
  // The kinds of markers the calendar has shown (plan-calendar-markers.md), for the page's filter: up to 20 of
  // { id: '<module>:<kind>', label, icon, tint }, the label at most 40 characters, the icon a Font Awesome name, the
  // tint one of the eight or none.
  markerKinds: (v) => {
    if (!Array.isArray(v) || v.length > 20) return undefined;
    const out = [];
    for (const k of v) {
      if (!k || typeof k !== 'object' || typeof k.id !== 'string' || !MARKER_KIND_ID.test(k.id)) return undefined;
      const label = typeof k.label === 'string' ? k.label.replace(/\p{Cc}/gu, ' ').trim().slice(0, 40) : '';
      if (!label) return undefined;
      out.push({ id: k.id, label, icon: typeof k.icon === 'string' && /^[a-z0-9-]{1,40}$/.test(k.icon) ? k.icon : 'calendar-check', tint: TINT_NAMES.includes(k.tint) ? k.tint : null });
    }
    return out;
  },
};
// Which part may set what, by destination: in the calendar only the main part (the calendar) sets the selected day,
// the period shown and the kinds of markers it has shown; on the map both parts select a place, and either may ask for a part to be shown (`reveal`).
// The page's own fields (the view, the filter, the search, `phone`) are set only by the page.
const DESTINATIONS = {
  calendar: { main: ['day', 'from', 'to', 'markerKinds'] },
  map: { main: ['selected', 'reveal', 'mapOn'], panel: ['selected', 'reveal', 'changed'] },
};
const DESTINATION_PARTS = ['main', 'panel'];
export function createDestination(id, initial = {}) {
  const rules = DESTINATIONS[id];
  if (!rules) throw new Error(`there is no destination called ${String(id).slice(0, 20)}`);
  let state = { ...initial };
  const parts = new Set(); // { part, send }
  const watchers = new Set();
  const copy = () => JSON.parse(JSON.stringify(state));
  const publish = () => {
    for (const p of parts) p.send(copy());
    for (const fn of watchers) fn(copy());
  };
  return {
    id,
    get state() { return copy(); },
    // The page's own changes (the view, the filter, the search): anything it likes, passed to every part.
    update(patch) {
      state = { ...state, ...(patch || {}) };
      publish();
    },
    // A part's change: only what its destination lets that part set, and only in the right shape.
    fromPart(part, patch) {
      const allowed = rules[part] || [];
      if (!allowed.length) throw Object.assign(new Error(`the ${String(part).slice(0, 20)} part cannot change this page`), { status: 403 });
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Object.assign(new Error('send the fields to change'), { status: 400 });
      const clean = {};
      for (const [key, value] of Object.entries(patch)) {
        if (!allowed.includes(key)) throw Object.assign(new Error(`the ${part} part cannot set ${String(key).slice(0, 20)}`), { status: 403 });
        const ok = DESTINATION_FIELDS[key](value);
        if (ok === undefined) throw Object.assign(new Error(`${key} is not valid`), { status: 400 });
        clean[key] = ok;
      }
      if (Object.keys(clean).some((k) => JSON.stringify(state[k]) !== JSON.stringify(clean[k]))) {
        state = { ...state, ...clean };
        publish();
      }
      return copy();
    },
    // A part joins (mountModule does this); `send` gets the whole state on each change. Returns the leave.
    join(part, send) {
      const p = { part, send };
      parts.add(p);
      return () => parts.delete(p);
    },
    // The page hears every change too, the parts' included. Returns the off.
    onChange(fn) {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
  };
}
// --- end of destinations

function endDrag() {
  if (!activeDrag) return;
  clearTimeout(activeDrag.timer);
  for (const { el, target } of activeDrag.layers) {
    el.remove();
    target.send('objectdrag', { type: 'leave' });
  }
  activeDrag = null;
}

function beginDrag(source, ref) {
  endDrag();
  const layers = [];
  for (const target of mounted) {
    if (target === source) continue;
    const rect = target.frame.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const doc = target.frame.ownerDocument;
    const el = doc.createElement('div');
    el.style.cssText = `position:fixed;z-index:2147483000;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:transparent`;
    const at = (e) => ({ x: Math.round(e.clientX - rect.left), y: Math.round(e.clientY - rect.top) });
    el.addEventListener('dragenter', (e) => e.preventDefault());
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'link';
      target.send('objectdrag', { type: 'over', ...at(e), ref });
    });
    el.addEventListener('dragleave', () => target.send('objectdrag', { type: 'leave' }));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      target.send('objectdrag', { type: 'drop', ...at(e), ref });
      endDrag();
    });
    // A click on the layer means no drag is going on (a module cannot keep the layers up).
    el.addEventListener('pointerdown', endDrag);
    doc.body.appendChild(el);
    layers.push({ el, target });
  }
  activeDrag = { source, ref, layers, timer: setTimeout(endDrag, 20000) };
}

// A trace of a drag on screen, for finding out where one stops: open the host once with ?debug=1 (?debug=0
// turns it off). Every step, in the module that starts the drag, in the host and in the module under it,
// adds a line at the bottom left of the page.
try {
  const flag = new URLSearchParams(location.search).get('debug');
  if (flag === '1') localStorage.setItem('app.debug', '1');
  else if (flag === '0') localStorage.removeItem('app.debug');
} catch {
  // no storage: no trace
}
const debugOn = () => {
  try {
    return localStorage.getItem('app.debug') === '1';
  } catch {
    return false;
  }
};
const traceLines = [];
function trace(text) {
  if (!debugOn()) return;
  traceLines.push(`${new Date().toLocaleTimeString([], { hour12: false })} ${text}`);
  if (traceLines.length > 12) traceLines.shift();
  console.log('[host]', text);
  let box = document.getElementById('app-debug');
  if (!box) {
    box = document.createElement('pre');
    box.id = 'app-debug';
    box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483002;margin:0;padding:8px 10px;max-width:60vw;max-height:40vh;overflow:auto;background:rgba(0,0,0,.85);color:#9f9;font:11px/1.35 monospace;border-radius:var(--radius-small);pointer-events:none';
    document.body.appendChild(box);
  }
  box.textContent = traceLines.join('\n');
}

// A drag driven by the pointer instead of the browser's drag and drop, which is unreliable between
// sandboxed frames. The source frame (host.objects.draggable) tells the host when a drag begins, where
// the pointer is as it moves, and where it lets go, in its own coordinates; the host turns those into
// the page's, finds the module frame under the pointer, and forwards over, leave and drop to it in
// that frame's coordinates, drawing a small label at the pointer meanwhile.
let ptrDrag = null; // { source, ref, summary, label, ghost, over, timer, doc }

// A summary carried by a drag instead of a pointer (a module with nothing stored, Assistant's answers): only the
// fields a target can fill an action from, checked for shape and size, or null.
function cleanSummary(c) {
  if (!c || typeof c !== 'object' || typeof c.title !== 'string' || !c.title.trim()) return null;
  const summary = { title: c.title.trim().slice(0, 200) };
  if (typeof c.kind === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(c.kind)) summary.kind = c.kind;
  if (typeof c.content === 'string' && c.content.trim()) summary.text = c.content.replace(/\p{Cc}(?<!\n)/gu, ' ').slice(0, 8000);
  if (typeof c.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.date)) summary.date = c.date;
  const p = c.place;
  if (p && typeof p === 'object' && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180) {
    summary.place = { lat: p.lat, lng: p.lng, ...(typeof p.name === 'string' && p.name.trim() ? { name: p.name.trim().slice(0, 120) } : {}) };
  }
  return summary;
}

// What a drag carries, as a target's objectdrag event gets it: a pointer, or a summary.
const dragged = () => ({ ref: ptrDrag.ref || null, summary: ptrDrag.summary || null });

function ptrEnd() {
  if (!ptrDrag) return;
  clearTimeout(ptrDrag.timer);
  ptrDrag.ghost.remove();
  if (ptrDrag.over) ptrDrag.over.send('objectdrag', { type: 'leave' });
  if (ptrDrag.relay) relayPost(ptrDrag.relay, { type: 'leave' }); // a composite frame it was over
  ptrDrag = null;
}

// The module frame in the same window as the source that is on top at a point of the page, and where in it. Chosen by
// what the page paints there (document.elementsFromPoint, topmost first), not by mount order: a frame behind another
// window, hidden, or inert is never the answer, and a window's own titlebar or toolbar on top covers the frame under it.
function ptrTarget(px, py) {
  const doc = ptrDrag.doc;
  const byFrame = new Map();
  for (const target of mounted) if (target.frame.ownerDocument === doc) byFrame.set(target.frame, target);
  const stack = doc.elementsFromPoint ? doc.elementsFromPoint(px, py) : null;
  const candidates = [];
  if (stack) {
    stack.forEach((el, i) => {
      if (el.closest?.('[inert]')) return;
      const z = stack.length - i;
      let target = null, box = null; // an iframe is the frame itself; a module's own page holds its parts in a container
      for (const [f, t] of byFrame) if (f === el || f.contains(el)) { target = t; box = f; break; }
      if (target) candidates.push({ id: target, rect: box.getBoundingClientRect(), z, visible: true });
      else if (el.closest?.('.module-floating, .module-docked')) candidates.push({ id: null, blocks: true, rect: el.closest('.module-floating, .module-docked').getBoundingClientRect(), z, visible: true });
      else if (el.tagName === 'IFRAME') candidates.push({ id: null, blocks: true, rect: el.getBoundingClientRect(), z, visible: true });
    });
  } else {
    let order = 0;
    for (const [frame, target] of byFrame) candidates.push({ id: target, rect: frame.getBoundingClientRect(), z: 0, order: order++, visible: true });
  }
  const top = topmostAt(candidates, px, py);
  const target = top?.id;
  if (!target || target === ptrDrag.source) return null;
  const r = target.frame.getBoundingClientRect();
  return { target, x: Math.round(px - r.left), y: Math.round(py - r.top) };
}

function ptrPoint(x, y) {
  const r = ptrDrag.source.frame.getBoundingClientRect();
  return { px: r.left + x, py: r.top + y };
}

function ptrBegin(source, { ref = null, summary = null }, label, x, y) {
  trace(`host: drag begins from ${source.module.id} (${ref ? `${ref.kind} ${ref.id}` : `a summary "${summary.title.slice(0, 30)}"`}) at ${x},${y}; ${[...mounted].filter((t) => t !== source).map((t) => t.module.id).join(', ') || 'no other module frames'} to drop on`);
  ptrEnd();
  endDrag();
  const doc = source.frame.ownerDocument;
  const ghost = doc.createElement('div');
  ghost.textContent = String(label || '').slice(0, 40);
  ghost.style.cssText = 'position:fixed;z-index:2147483001;pointer-events:none;padding:3px 9px;border-radius:var(--radius-small);background:#c8873a;color:#1a1206;font:var(--weight-strong) var(--text-12) var(--font-ui);max-width:220px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;box-shadow:0 4px 14px rgba(0,0,0,.4)';
  doc.body.appendChild(ghost);
  ptrDrag = { source, ref, summary, label, ghost, over: null, doc, timer: setTimeout(ptrEnd, 60000) };
  ptrMove(x, y);
}

function ptrMove(x, y) {
  if (!ptrDrag) return;
  const { px, py } = ptrPoint(x, y);
  ptrDrag.ghost.style.left = `${px + 12}px`;
  ptrDrag.ghost.style.top = `${py + 12}px`;
  const hit = ptrTarget(px, py);
  if (ptrDrag.over && (!hit || hit.target !== ptrDrag.over)) {
    ptrDrag.over.send('objectdrag', { type: 'leave' });
    ptrDrag.over = null;
  }
  if (hit && ptrDrag.over !== hit.target) trace(`host: pointer is over ${hit.target.module.id} at ${hit.x},${hit.y}`);
  if (hit) {
    ptrDrag.over = hit.target;
    hit.target.send('objectdrag', { type: 'over', x: hit.x, y: hit.y, ...dragged() });
    relayPtr('leave', px, py); // a composite frame it was over before hears the leave
  } else relayPtr('over', px, py);
}

function ptrDrop(x, y) {
  if (!ptrDrag) {
    trace('host: released, but no drag was in progress');
    return;
  }
  const { px, py } = ptrPoint(x, y);
  const hit = ptrTarget(px, py);
  trace(hit ? `host: released over ${hit.target.module.id} at ${hit.x},${hit.y}: dropping` : `host: released at page ${Math.round(px)},${Math.round(py)}, over no module frame`);
  if (hit) hit.target.send('objectdrag', { type: 'drop', x: hit.x, y: hit.y, ...dragged() });
  else relayPtr('drop', px, py);
  ptrDrag.over = null; // the drop already ended it for the target
  ptrEnd();
}

// A drag relayed into a composite's frame (canvas.js, plan-calendar-todo.md step 3): the app's own page shown in a
// frame on the Workspace (`/calendar?space=<id>`) holds module parts of its own, mounted by that page's host. A drag
// from a module on the Workspace over that frame is handed to the page inside as a message (`app:objectdrag`, same
// origin, over, leave and drop in the frame's coordinates); the page's host takes it below (relayIn) and treats it as
// a drag from outside: the part under the pointer gets objectdrag as it would from a module beside it. A drag the other
// way (from a part inside out onto a module on the Workspace) is not relayed.
const relays = new Set(); // the composite frames on this page
export function registerDragRelay(frame) {
  relays.add(frame);
  return () => relays.delete(frame);
}
function relayUnder(px, py) {
  for (const frame of relays) {
    if (!frame.isConnected || frame.ownerDocument !== ptrDrag.doc) continue;
    const r = frame.getBoundingClientRect();
    if (px >= r.left && px < r.right && py >= r.top && py < r.bottom) return { frame, x: Math.round(px - r.left), y: Math.round(py - r.top) };
  }
  return null;
}
function relayPost(frame, drag) {
  try { frame.contentWindow?.postMessage({ type: 'app:objectdrag', drag }, location.origin); } catch { /* the page is not there */ }
}
// Over, leave or drop at a page point over no module frame: the composite frame under it, if any, hears it.
function relayPtr(type, px, py) {
  const hit = type === 'leave' ? null : relayUnder(px, py);
  if (ptrDrag.relay && (!hit || hit.frame !== ptrDrag.relay)) {
    relayPost(ptrDrag.relay, { type: 'leave' });
    ptrDrag.relay = null;
  }
  if (!hit) return;
  ptrDrag.relay = type === 'drop' ? null : hit.frame;
  relayPost(hit.frame, { type, x: hit.x, y: hit.y, ...dragged() });
}
// Inside the frame: the drag from the page outside, handed to the part under the point as objectdrag.
let relayOver = null;
function relayIn(drag) {
  const hit = drag.type === 'leave' ? null : [...mounted].find((t) => {
    const r = t.frame.getBoundingClientRect();
    return drag.x >= r.left && drag.x < r.right && drag.y >= r.top && drag.y < r.bottom;
  });
  if (relayOver && relayOver !== hit) relayOver.send('objectdrag', { type: 'leave' });
  relayOver = hit && drag.type !== 'drop' ? hit : null;
  if (!hit) return;
  const r = hit.frame.getBoundingClientRect();
  const ref = REF_SHAPE(drag.ref) ? cleanPointer(drag.ref) : null;
  const summary = drag.summary ? cleanSummary(drag.summary) : null;
  if (!ref && !summary) return;
  hit.send('objectdrag', { type: drag.type, x: Math.round(drag.x - r.left), y: Math.round(drag.y - r.top), ref, summary });
}
if (window.parent !== window) {
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.origin !== location.origin) return;
    const d = event.data;
    if (!d || d.type !== 'app:objectdrag' || !d.drag || !['over', 'leave', 'drop'].includes(d.drag.type)) return;
    relayIn({ type: d.drag.type, x: Number(d.drag.x) || 0, y: Number(d.drag.y) || 0, ref: d.drag.ref || null, summary: d.drag.summary || null });
  });
}

// Asking the space's canvas to show an object (host.objects.open) from a page it holds or opened: a composite's page in
// its frame (the parent) or a module's or composite's own window (the opener). 'app:openref' goes to that window, same
// origin only; the canvas opens the module that owns the object and hands it the pointer, as it does for a module on it,
// and answers 'app:openref-done' (canvas.js, answerOpenRef). Resolves true or false with its answer, or null when nothing
// answered (not a canvas, or gone). Never a navigation: a frame on the canvas must not be led on to an app page.
export function askCanvasToOpen(win, ref, wait = 1500) {
  return new Promise((resolve) => {
    if (!win || win === window || !REF_SHAPE(ref)) return resolve(null);
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    let timer = 0;
    const onReply = (event) => {
      if (event.source !== win || event.origin !== location.origin) return;
      const d = event.data;
      if (d && d.type === 'app:openref-done' && d.id === id) done(d.ok === true);
    };
    const done = (ok) => {
      window.removeEventListener('message', onReply);
      clearTimeout(timer);
      resolve(ok);
    };
    window.addEventListener('message', onReply);
    timer = setTimeout(() => done(null), wait);
    try {
      win.postMessage({ type: 'app:openref', id, ref: cleanPointer(ref) }, location.origin);
    } catch {
      done(null);
    }
  });
}
// The window that opened this one, when it is this site's (a module's or composite's own window, popped out of a space's
// canvas): null otherwise.
export function sameSiteOpener() {
  try {
    const o = window.opener;
    return o && !o.closed && o.location.origin === location.origin ? o : null;
  } catch {
    return null;
  }
}

// The host-drawn "..." dropdown for whatever a header or toolbar row didn't have room for is the page's
// shared menu (public/host-menu.js), the same one the canvas's title bars and the account menu use.
export { openHostMenu, closeHostMenu };

// A confirm in this same menu, under the button that opened it. The first choice asks; the second does it.
// `armed` skips the ask, for a choice that was already picked from a longer menu.
// `choices` ([{ label, hint?, disabled?, onConfirm }]) makes the armed confirm offer more than one way to do it (Chat's
// Clear…: yours or everyone's): `confirm` is then a heading line above them, and each acts at once. Keep it is last.
// A failure shows its message in the menu's place, whichever choice it was.
export function openConfirmMenu(trigger, { label, confirm, hint, icon = 'trash', onConfirm, choices = null, fail = 'It could not be cleared.', armed = false } = {}) {
  const act = (run) => async () => {
    try { await run(); }
    catch (err) { openHostMenu(trigger, [{ label: err.message || fail, disabled: true }]); }
  };
  const open = (isArmed) => {
    const doing = Array.isArray(choices) && choices.length
      ? [
          ...(confirm ? [{ icon, label: confirm, disabled: true }] : []),
          ...choices.map((c) => ({ icon, label: c.label, hint: c.hint, disabled: Boolean(c.disabled), danger: !c.disabled, onPick: act(c.onConfirm) })),
        ]
      : [{ icon, label: confirm, hint, danger: true, onPick: act(onConfirm) }];
    const items = isArmed
      ? [...doing, { icon: 'xmark', label: 'Keep it', onPick: () => {} }]
      : [{ icon, label, hint, danger: true, onPick: () => open(true) }];
    openHostMenu(trigger, items);
  };
  open(armed);
}

// The titlebar "..." on an installed module (not the conference or the chat). `armed`: Clear was already picked from the
// canvas's longer "..." (canvas.js, moduleMenuItems), so it asks straight away. With a `name` it asks by the styled confirm and
// the person types that name first (it wipes the module's data for everyone). `onClear` may resolve to an `undo` function (see
// clearWithUndo): the page then shows "Cleared. Undo" until the server's undo time is over (undo.until), never longer.
export function openClearMenu(trigger, onClear, { armed = false, name = '', undoSeconds = 0 } = {}) {
  if (!name) { openConfirmMenu(trigger, { label: 'Clear', confirm: 'Clear everything and start again?', onConfirm: onClear, armed }); return; }
  const seconds = Number(undoSeconds) > 0 ? Math.round(Number(undoSeconds)) : UNDO_SECONDS;
  const ask = async () => {
    let undo = null;
    // The Clear runs inside the dialog: a refusal (a second Clear while the first can still be undone, too many in a short
    // time) is read where it was asked, and the dialog stays.
    const ok = await confirmDialog({
      title: `Clear ${name}?`,
      message: `Everything ${name} holds here goes, for everyone. You can undo it for ${seconds} seconds, until you leave this page.`,
      action: 'Clear',
      kind: 'final',
      typed: name,
      run: async () => {
        try { undo = await onClear(); } catch (err) { throw sayAsked(err, 'It could not be cleared.'); }
      },
    });
    if (!ok) return;
    if (typeof undo === 'function') undoToast(`Cleared ${name}.`, undo, { until: undo.until });
    else showNote(`${name} had nothing to clear.`);
  };
  if (armed) ask();
  else openHostMenu(trigger, [{ icon: 'trash', label: 'Clear', danger: true, onPick: ask }]);
}
// The undo time when the server did not say (its default).
const UNDO_SECONDS = 30;

// What a refused Clear or Undo says: the server's own sentence; after "too many" (429) it leads with "Try again in a moment."
function sayAsked(err, fallback) {
  const said = (err && err.serverSaid && err.message) || '';
  if (err && err.status === 429) return Object.assign(new Error(said ? `Try again in a moment. ${said}` : 'Try again in a moment.'), { status: 429 });
  return Object.assign(new Error(said || fallback), { status: err && err.status });
}

// Clears everything a module holds in a place (DELETE .../data). The server holds what went for its undo time (undoSeconds,
// 30 unless the server says) and answers a restoreToken; this resolves to a function that asks the server to put it all back
// (POST .../data/restore). The token lives in this page only: the server keeps the hold, but after this page is closed or
// reloaded there is no way to ask for the Undo, and the hold runs out. The function resolves to the sentence to show, and
// carries `until`, when the undo time is over by this page's clock. A failed Undo (storage full, no network) throws the
// server's sentence and may be asked again until `until`. Resolves to null when there was nothing to clear.
// `query` is the place's query string.
export async function clearWithUndo(moduleId, query) {
  const base = `/api/modules/${encodeURIComponent(moduleId)}/data`;
  const answer = await api('DELETE', `${base}?${query}`);
  if (!answer || !answer.cleared || typeof answer.restoreToken !== 'string') return null;
  const seconds = Number(answer.undoSeconds) > 0 ? Number(answer.undoSeconds) : UNDO_SECONDS;
  const undo = async () => {
    let back;
    try {
      back = await api('POST', `${base}/restore?${query}`, { restoreToken: answer.restoreToken });
    } catch (err) {
      throw sayAsked(err, 'It could not be brought back.');
    }
    const n = Number(back.restored) || 0;
    const restored = `Restored ${n} ${n === 1 ? word('object') : word('object', { many: true })}.`;
    const skipped = Array.isArray(back.taken) && back.taken.length ? back.taken.length : Number(back.skipped) || 0;
    return skipped ? `${restored} ${skipped} could not come back: something new is in ${skipped === 1 ? 'its' : 'their'} place.` : restored;
  };
  undo.until = Date.now() + seconds * 1000;
  return undo;
}

// Keeps what the page knows of a module's Clear in step with the server: its `clear` (is there anything to clear, and may this
// person) and `undoSeconds` come from GET /api/modules/for-space, read at load. Call the function this returns when the module's
// data changed; it asks again once, after a short wait however many calls came, and hands the module's entry to `apply`.
// A single change asks only when it could flip `clear` (something was added where there was nothing, `isClear()` false; or
// something went where there was something); many at once ({ many: true }, a Clear or its Undo) always ask.
export function followClearable(moduleId, { spaceId, guestToken = null }, apply, isClear = () => true) {
  let timer = 0;
  let holdTimer = 0;
  let holdFrom = 0; // when the last many-at-once change came (a Clear or its Undo); the undo time counts from it
  let holdEnds = 0; // when that undo time and the server's grace are over, by this page's clock
  const read = async () => {
    let entry = null;
    try {
      const q = new URLSearchParams({ space: spaceId });
      if (guestToken) q.set('guest', guestToken);
      entry = ((await api('GET', `/api/modules/for-space?${q}`)).modules || []).find((m) => m.id === moduleId) || null;
      if (entry) apply(entry);
    } catch { /* the flag stays as it was */ }
    // While a Clear can be undone the server says there is nothing to clear; when that time ends the flag may be true (data
    // written during it) and no change comes to say so. So ask once more then, and when the page comes back to the front.
    if (holdFrom && entry) {
      const seconds = Number(entry.undoSeconds) > 0 ? Number(entry.undoSeconds) : UNDO_SECONDS;
      holdEnds = holdFrom + seconds * 1000 + HOLD_GRACE_MS;
      holdFrom = 0;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => { holdEnds = 0; read(); }, Math.max(0, holdEnds - Date.now()));
    }
  };
  if (spaceId && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && holdEnds && Date.now() >= holdEnds) { clearTimeout(holdTimer); holdEnds = 0; read(); }
    });
  }
  return ({ many = false, deleted = false } = {}) => {
    if (!spaceId) return;
    if (many) { holdFrom = Date.now(); clearTimeout(holdTimer); holdEnds = 0; }
    if (!many && deleted !== isClear()) return;
    clearTimeout(timer);
    timer = setTimeout(read, 400);
  };
}
// The wait after the undo time before the page asks again: the server keeps a hold 5 s past the undo time (module-holds.js, its grace), plus 1.5 s for the clocks.
const HOLD_GRACE_MS = 6500;

// The lifts (editor.lift, in mountModule below), for the page as a whole: how many lifts hold each element inert, which
// elements the lifts set inert themselves (one inert before any lift stays so), the lifts up now, and one watch per
// document that keeps what is added to the page inert, puts a lift back when its frame leaves the screen, and takes
// Escape and the viewport's width for every lift.
const inertCount = new WeakMap();
const inertOwned = new WeakSet();
const liftRecords = new Set();
const liftWatches = new Map(); // document -> { observer, onKey, onResize, win }
function holdInert(el, held) {
  if (held.has(el)) return;
  held.add(el);
  const n = (inertCount.get(el) || 0) + 1;
  inertCount.set(el, n);
  if (n === 1 && !el.inert) { el.inert = true; inertOwned.add(el); }
}
function dropInert(el) {
  const n = (inertCount.get(el) || 0) - 1;
  if (n > 0) { inertCount.set(el, n); return; }
  inertCount.delete(el);
  if (inertOwned.has(el)) { inertOwned.delete(el); el.inert = false; }
}
// Everything but the frame, its backdrop, its Close and its ancestors: each ancestor's siblings up to the body.
function inertAround(lift) {
  const { frame, doc } = lift;
  for (let el = frame; el && el.parentNode && el !== doc.body; el = el.parentNode) {
    for (const s of el.parentNode.children) {
      if (s === el || s === lift.backdrop || s === lift.close || s.tagName === 'SCRIPT') continue;
      holdInert(s, lift.held);
    }
  }
}
function refreshLifts(doc) {
  for (const lift of [...liftRecords]) {
    if (lift.doc !== doc) continue;
    if (!lift.visible()) { lift.dismiss(false); continue; }
    inertAround(lift);
  }
}
function watchLifts(doc) {
  const any = [...liftRecords].some((l) => l.doc === doc);
  const w = liftWatches.get(doc);
  if (any && !w) {
    const win = doc.defaultView || window;
    const observer = new MutationObserver(() => refreshLifts(doc));
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
    // Escape anywhere on the page (focus on the backdrop's Close, or past the frame) dismisses the top lift; inside the
    // frame the module's own Escape runs instead, as the key never reaches the page from there.
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const top = [...liftRecords].filter((l) => l.doc === doc).pop();
      if (!top) return;
      e.preventDefault();
      e.stopPropagation();
      top.dismiss();
    };
    const onResize = () => {
      refreshLifts(doc);
      for (const l of liftRecords) if (l.doc === doc) l.mount.send('editorlift', { phone: win.innerWidth <= 640 });
    };
    doc.addEventListener('keydown', onKey, true);
    win.addEventListener('resize', onResize);
    liftWatches.set(doc, { observer, onKey, onResize, win });
  } else if (!any && w) {
    w.observer.disconnect();
    doc.removeEventListener('keydown', w.onKey, true);
    w.win.removeEventListener('resize', w.onResize);
    liftWatches.delete(doc);
  }
}

// The lift (editor.lift; plan-editor-window.md, "A module in a sandboxed frame"). The host owns it: a frame is lifted
// only while the person is in it (it is the document's active element) and it is on screen, never within a second of
// the host having dismissed its last lift, and the host always has a way out (its own Close on the backdrop, Escape)
// that tells the module to close its editor (`tell`: `editordismiss`; it asks first when something is half-edited) and puts
// the page back. A click on the backdrop does nothing (Thomas, 2026-10-13: a click outside an edit window never closes it).
// Lifted: the frame gets the class module-editor-lifted (position: fixed, centered, the editor's width, --lift-h tall;
// module-editor-lifted-large for a large editor; a full-screen sheet on a phone), div.module-editor-backdrop goes
// before it and button.module-editor-close after it, and everything else on the page is made inert the way a modal
// <dialog> does it: each ancestor's siblings, up to the body. A count per element lets two lifts hold the same element
// and an element inert before any lift stays so. A watch on the page keeps anything added while lifted inert too, and
// puts the lift back when the frame leaves the screen (a phone showing another view). Put back on close, when the
// frame loads another document (a module moved between docked and floating starts over), and when the mount is
// destroyed. Focus stays in the frame; on release it goes back to the host control that opened the editor (the bar's
// button) when one did, else it is left where it is.
// Used for a sandboxed module's frame (mountModule) and for a composite's frame (canvas.js: the Map's panel and the
// Calendar's parts run in the app's own page in a frame, where a dialog's top layer is the frame's too).
// Returns { lift(open, size, height), release(), dismiss(byPerson), isLifted() }.
//
// `cover` (a composite's frame, whose page is the Calendar or the Map): the frame keeps its width and left edge, so the page's
// media queries and containers answer as before, and runs the screen's full height, not shrunk to the
// editor's size; it answers with the box it had, { top, right, bottom, left } in pixels from the screen's edges, so
// the page can stay drawn in that box (destination.js, liftComposite) with the editor window over it. Without it the
// window the person was working in would be left blank, as the frame (the whole page) moved out to the editor's size.
export function createFrameLift(frame, { mount, tell, onLift = null, takeOpener = null, cover = false }) {
  let lifted = null; // the lift record from liftRecords while lifted
  let dismissedAt = 0; // when the host last dismissed this frame's lift
  const liftPhone = () => (frame.ownerDocument.defaultView || window).innerWidth <= 640;
  const liftVisible = () => frame.isConnected && frame.getClientRects().length > 0 && (typeof frame.checkVisibility !== 'function' || frame.checkVisibility({ visibilityProperty: true }));
  function release() {
    if (!lifted) return;
    const was = lifted;
    lifted = null;
    liftRecords.delete(was);
    frame.classList.remove('module-editor-lifted', 'module-editor-lifted-large', 'module-editor-cover');
    frame.style.removeProperty('--lift-h');
    frame.style.removeProperty('--cover-left');
    frame.style.removeProperty('--cover-right');
    was.backdrop.remove();
    was.close.remove();
    for (const el of was.held) dropInert(el);
    was.held.clear();
    watchLifts(frame.ownerDocument);
    const doc = frame.ownerDocument;
    const a = doc.activeElement;
    if ((!a || a === doc.body || a === frame) && was.before && was.before.isConnected && !was.before.inert) {
      try { was.before.focus(); } catch { /* not focusable */ }
    }
    if (onLift) onLift(false);
  }
  // The host's way out: the page back, the module told to close its editor, focus in the frame so Escape keeps working there.
  // `byPerson`: the host's Close or Escape; a lift refused for the next second. Not when the
  // frame left the screen (a phone showing another view), which a real open may follow at once.
  function dismiss(byPerson = true) {
    if (!lifted) return;
    if (byPerson) dismissedAt = Date.now();
    release();
    try { frame.focus(); } catch { /* not focusable */ }
    tell();
  }
  function lift(open, size, height) {
    if (!open) { release(); return false; }
    const doc = frame.ownerDocument;
    if (!frame.parentNode || !liftVisible()) { release(); return false; }
    if (!lifted) {
      if (doc.activeElement !== frame || frame.closest('[inert]')) return false; // the person is not in the frame, or it is under another lift or a dialog
      if (Date.now() - dismissedAt < 1000) return false; // the host just put it back
      const backdrop = doc.createElement('div');
      backdrop.className = 'module-editor-backdrop';
      // No click handler: a click outside the editor window leaves it open (only its Cancel, its X, the host's Close
      // and Escape close it, and they ask when something is half-edited).
      const close = doc.createElement('button');
      close.type = 'button';
      close.className = 'module-editor-close';
      close.setAttribute('aria-label', 'Close');
      close.dataset.tip = 'Close';
      close.innerHTML = '<i class="fa-solid fa-xmark fa-fw" aria-hidden="true"></i>';
      close.addEventListener('click', () => dismiss());
      frame.parentNode.insertBefore(backdrop, frame);
      frame.parentNode.insertBefore(close, frame.nextSibling);
      const o = takeOpener ? takeOpener() : null;
      const before = o && Date.now() - o.at < 3000 && o.el && o.el.isConnected && o.el !== frame ? o.el : null;
      lifted = { frame, doc, backdrop, close, held: new Set(), before, mount, visible: liftVisible, dismiss };
      liftRecords.add(lifted);
    }
    let box = null; // the frame's box before it covers the screen (kept while lifted)
    if (cover) {
      if (lifted.box) box = lifted.box;
      else if (typeof frame.getBoundingClientRect === 'function') {
        const win = doc.defaultView || window;
        const r = frame.getBoundingClientRect();
        box = lifted.box = { top: Math.max(0, Math.round(r.top)), right: Math.max(0, Math.round(win.innerWidth - r.right)), bottom: Math.max(0, Math.round(win.innerHeight - r.bottom)), left: Math.max(0, Math.round(r.left)) };
      }
    }
    frame.classList.add('module-editor-lifted');
    frame.classList.toggle('module-editor-cover', Boolean(box));
    if (box) { frame.style.setProperty('--cover-left', `${box.left}px`); frame.style.setProperty('--cover-right', `${box.right}px`); }
    frame.classList.toggle('module-editor-lifted-large', size === 'large');
    if (Number.isFinite(height) && height > 0) frame.style.setProperty('--lift-h', `${Math.ceil(height)}px`); else frame.style.removeProperty('--lift-h');
    inertAround(lifted);
    watchLifts(doc);
    if (onLift) onLift(true, size);
    return box ? { lifted: true, phone: liftPhone(), cover: box } : { lifted: true, phone: liftPhone() };
  }
  return { lift, release, dismiss, isLifted: () => Boolean(lifted) };
}

// A module's bands in a frame (createModuleFrame, public/module-frame.js; plan-unified-layout.md, "Bands everywhere"): what
// it asks for through the SDK, drawn there with the pure rules of module-chrome.js. `send(event, data)` takes a control's
// event back to the module ('add' { id }, 'header' { id }, 'toolbar' { id, value?, on?, submit?, x? }); `box()` is the
// module's own area, for a button's `x` (a menu it opens sits under it). An item that carries its own `send(data, el)` (a
// destination's parts' items, mixed into the page's one row and title bar) gets its event instead. The window keeps its
// own title bar events (the standard actions, Close) and hands every other frame event to `event(e)`. The status bar draws
// nothing for the same items again, and reads the non-quiet words out politely once they have been still a moment.
// The standard actions the module handles (host.standard.set: Settings, Share, Print) are drawn in the frame's menu by the
// host; a pick goes to the module as the 'standard' event ({ id }), and for Share and Print the module answers with what to
// share (share) or that it is ready (print) within a minute of the pick, never unasked.
// Used by mountModule, by canvas.js for a composite and by destination.js for its page.
// Returns { add(entries), header(items), toolbar(items) -> the cleaned items, status(items) -> true, standard(spec),
// share(result) -> true, print({ iframe, height }) -> a promise, event(e), destroy() }.
export function createFrameBands(frame, { send, box = null, statusLimit = undefined }) {
  const win = frame.el.ownerDocument.defaultView || window;
  let header = [];
  let toolbar = [];
  let actions = [];
  let routes = new Map(); // a toolbar item's id -> the item
  let statusLast = null;
  const announcer = createAnnouncer({ write: (t) => frame.announce(t), setTimer: (fn, ms) => win.setTimeout(fn, ms), clearTimer: (t) => win.clearTimeout(t) });
  const xOf = (el) => {
    const area = box ? box() : frame.content.getBoundingClientRect();
    return Math.max(0, Math.round(el.getBoundingClientRect().left - area.left));
  };
  const drawActions = () => {
    actions = titlebarActions(header, toolbar);
    frame.setTitlebar({ actions });
  };
  const to = (item, event, data, el) => (item && item.send ? item.send(data, el) : send(event, data));
  let asked = null; // { id, at, el }: the standard action picked last, which the module answers (share, print)
  const answering = (id) => asked && asked.id === id && Date.now() - asked.at < 60000;
  return {
    standard(spec) {
      const clean = cleanStandardActions(spec);
      frame.setTitlebar({ moduleStandard: { ...clean, onPick: (id, el) => { asked = { id, at: Date.now(), el }; send('standard', { id }); } } });
    },
    // What to share, from the module's handler: the host's one Share dialog. False when the module was not asked.
    share(result) {
      if (!answering('share')) return false;
      const clean = cleanShareResult(result, win.location.origin);
      if (!clean) throw Object.assign(new Error('there is no link to share: give `url`, an https address or a path on this server'), { status: 400 });
      asked = null;
      shareDialog(frame.el.ownerDocument, clean);
      return true;
    },
    // The module is ready to print: the host prints its content area. Resolves once the page is put back; false when not asked.
    print({ iframe = null, height = 0 } = {}) {
      if (!answering('print')) return false;
      asked = null;
      return printFrame(frame.el, { iframe, height });
    },
    add(entries) { frame.setTitlebar({ add: frameAdd(cleanAddEntries(entries), (id) => send('add', { id })) }); },
    header(items) { header = cleanHeaderItems(items); drawActions(); },
    toolbar(items) {
      toolbar = cleanToolbarItems(items);
      routes = new Map(toolbar.filter((i) => i.id).map((i) => [i.id, i]));
      drawActions();
      frame.setToolbar(frameToolbar(toolbar));
      return toolbar;
    },
    status(items) {
      const clean = cleanStatusItems(items, statusLimit);
      const key = statusKey(clean);
      if (key === statusLast) return true;
      statusLast = key;
      frame.setStatus(statusFrame(clean));
      announcer.update(statusSpoken(clean));
      return true;
    },
    event(e) {
      if (!e) return;
      if (e.area === 'titlebar') {
        if (e.id === 'add') { if (e.value !== undefined) send('add', { id: e.value }); return; }
        const a = actions.find((x) => x.id === e.id);
        if (!a) return;
        if (a.from === 'header') to(a, 'header', { id: a.id }, e.el);
        else to(a, 'toolbar', { id: a.id, ...(e.el ? { x: xOf(e.el) } : {}) }, e.el);
        return;
      }
      if (e.area !== 'toolbar') return;
      const item = routes.get(e.id);
      const data = { id: e.id };
      for (const k of ['value', 'on', 'submit']) if (e[k] !== undefined) data[k] = e[k];
      if (item && item.type === 'button' && e.el) data.x = xOf(e.el);
      to(item, 'toolbar', data, e.el);
    },
    destroy() { announcer.stop(); },
  };
}

// Mounts one module: into an empty <iframe> (`frame`; sandboxed, with only the SDK to reach the page), or,
// for a module that runs in the page, into an empty element (`container`), where it lives in a shadow
// root of its own, beside the page's own elements, with the page's power (see the run modes in
// documentation/architecture/architecture-modules.md).
//
// `scope` is 'environment' (the module's own page) or 'space' (on a space's canvas, with `spaceId`). `destination`
// is { hub, part } for a destination's part: `hub` from createDestination(), `part` 'main' or 'panel'. `onAdd(entries)`,
// `onStatus(items)`, `onHeader(items)` and `onToolbarItems(items)`, for a destination's part only: its "+" entries, status
// items, titlebar icons and toolbar items, cleaned, for the page to draw in its own bands (or hand up to a composite's
// window); the calls answer true. Wherever a module is drawn the host draws its bands; only a dashboard widget (no
// header, toolbar, add or status given) answers false. `module.content` is the manifest's ("flush" or nothing). Returns
// { destroy, send, deliver }. The module hears the same names the server uses (plan-names step 5c).
export function mountModule({ module, frame = null, container = null, scope = 'environment', spaceId = null, guestToken = null, entry, onTitle, onResize, chrome = null, onOpenRef = null, onOpenPage = null, onOpenModule = null, onChatAsk = null, keyed = null, destination = null, onAdd = null, onStatus = null, onHeader = null, onToolbarItems = null, lift = true, onLift = null, liftUp = null, onChanges = null }) {
  const base = `/api/modules/${encodeURIComponent(module.id)}`;
  let contextInfo = null;
  // A keyed page (public/keyed.js): the module's page about one person, opened with the access key and no
  // session. `keyed` is { path, subject, query }; the page's own api() already carries the key.
  if (destination && (!destination.hub || !DESTINATION_PARTS.includes(destination.part))) throw new Error('a destination\'s part is "main" or "panel"');

  // `sc` is a scope name ('space' meaning the space this frame is in) or a place from scopeOf ({ scope, space }).
  const q = (sc) => {
    const place = typeof sc === 'string' ? { scope: sc, space: sc === 'space' ? spaceId : null } : sc;
    const p = new URLSearchParams();
    if (place.scope === 'space') { p.set('scope', 'space'); p.set('space', place.space); } else if (place.scope === 'spaces' || place.scope === 'person') p.set('scope', place.scope); else p.set('scope', 'environment');
    if (guestToken) p.set('guest', guestToken);
    return p;
  };
  // The person's own other calendars (plan-google-calendar.md, Part 2) are shown only on a module's own page and on a
  // destination, never within a space, whatever the mount's scope says: not on a space's canvas, not in a window popped
  // out of one, not on a page opened over a call (?from=space), and never on a keyed page. Elsewhere the module is
  // answered none and never hears the 'external' event.
  const externalHere = externalAllowedHere({ scope, keyed: Boolean(keyed), overCall: withinSpacePage(), search: location.search });
  // 'context' means wherever this frame is showing; a module on a space's canvas may also ask for 'environment', and a
  // module's environment page for one of the viewer's spaces ({ space }). See placeOf.
  const scopeOf = (requested, space) => placeOf(requested, space, { scope, spaceId, moduleScopes: module.scope });
  const url = (path, sc, extra = {}) => {
    const p = q(sc);
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
    return `${base}${path}?${p}`;
  };

  // The library routes (a module that declares `library: true`) are about one space: this frame's.
  const libraryUploads = new Map();
  const libraryUrl = (path = '', extra = {}) => {
    if (scope !== 'space' || !spaceId) throw Object.assign(new Error(`This works inside ${word('space', { a: true })}.`), { status: 400 });
    const p = new URLSearchParams({ space: spaceId });
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
    return `${base}/library${path}?${p}`;
  };

  // The place this module is in, for the bus routes: on a space's canvas it is in that space, a page in the environment.
  const busPlaceBody = () => (scope === 'space' ? { scope: 'space', space: spaceId } : { scope: 'environment' });
  const busGuest = () => (guestToken ? `?guest=${encodeURIComponent(guestToken)}` : '');
  const busQuery = (extra) => {
    const p = new URLSearchParams({ ...extra, ...busPlaceBody() });
    if (guestToken) p.set('guest', guestToken);
    return p;
  };

  // This module, as the drag brokering sees it (its `send` is defined below).
  const pageMode = Boolean(container);
  // `frame` in the drag brokering below is whichever element holds the module: its frame, or its container.
  const mine = { frame: pageMode ? container : frame, module, send: (event, data) => send(event, data) };

  // The nav-bar tools this mount registered (their namespaced ids), so destroy() takes exactly those out.
  const navIds = new Set();

  // The module's bands in the frame it is drawn in (`chrome`, a createModuleFrame; createFrameBands above): the "+"
  // (host.add.set), the title bar's icons (host.header.set), the toolbar row (host.toolbar.set) and the status bar
  // (host.status.set). A destination's part (`onAdd`, `onHeader`, `onToolbarItems`, `onStatus`) hands them, cleaned, to its
  // page, which draws them in its own frame with its own (or hands them up to a composite's window). Only a dashboard
  // widget has neither. The old action bar (host.bar.set, kept for modules written for it) is drawn nowhere: its buttons
  // fold into this same "+" (foldBarItems), until the module calls host.add.set, whose list wins. While the "+" holds the
  // fold, a pick goes back as the old 'bar' event ({ id }; a quick-add's { id, value: '' }).
  let addOwn = null; // what host.add.set sent (null: never called)
  let barFold = []; // host.bar.set's buttons as "+" leaves
  let barQuick = new Set(); // which of them were quick-adds
  const folding = () => addOwn === null && barFold.length > 0;
  const bands = chrome ? createFrameBands(chrome, {
    send: (event, data) => {
      if (event === 'add' && folding()) send('bar', barQuick.has(data.id) ? { id: data.id, value: '' } : { id: data.id });
      else send(event, data);
    },
    box: () => (pageMode ? container : frame).getBoundingClientRect(),
  }) : null;
  const drawAddSlot = () => { if (bands) bands.add(addOwn !== null ? addOwn : barFold); };
  const toolbarOut = destination && onToolbarItems
    ? (items) => { const clean = cleanToolbarItems(items); onToolbarItems(clean); return clean; }
    : bands ? (items) => bands.toolbar(items) : null;
  const headerOut = destination && onHeader ? (clean) => onHeader(clean) : bands ? (clean) => bands.header(clean) : null;
  // The standard actions this module handles (host.standard.set), drawn in its frame's menu. A destination's part and a
  // dashboard widget have none (their page's frame is the page's).
  const standardOut = destination ? null : bands;
  // How the content fills its slot (the manifest's `content`): "flush" for content edge to edge (a map), else the slot's
  // padding. The holder carries it for the page's stylesheet; the module's own document hears it in its hello.
  const contentFit = module.content === 'flush' ? 'flush' : 'padded';
  (pageMode ? container : frame).dataset.content = contentFit;

  // The attention route for this mount (host.attention): only a module in a space for a signed-in person (a guest page and
  // a keyed page have no personal list). The page's status strip is told so it reads the count again.
  const attentionPlace = () => (scope === 'space' && spaceId && !guestToken && !keyed ? `/api/spaces/${encodeURIComponent(spaceId)}/attention/${encodeURIComponent(module.id)}` : null);
  async function sendAttention(method, place, body) {
    try {
      await api(method, place, body);
    } catch (err) {
      if (err.status === 401 || err.status === 403 || err.status === 404) return false; // not in this space, or the role cannot write here
      throw err;
    }
    try { window.dispatchEvent(new CustomEvent('app:attention', { detail: { space: spaceId } })); } catch { /* no window to tell */ }
    return true;
  }
  // The facts route for this mount (host.facts): the same places as attention's (a guest has no status strip, a keyed page
  // no space). The same list sent again within the hour is not sent (a module may call it on every draw); the page's
  // status strip is told so it reads the facts again.
  const factsPlace = () => (scope === 'space' && spaceId && !guestToken && !keyed ? `/api/spaces/${encodeURIComponent(spaceId)}/facts/${encodeURIComponent(module.id)}` : null);
  let factsSent = { sig: null, at: 0 };
  async function sendFacts(method, place, body) {
    const sig = JSON.stringify([method, body || null]);
    if (sig === factsSent.sig && Date.now() - factsSent.at < 3600000) return true;
    try {
      await api(method, place, body);
    } catch (err) {
      if (err.status === 401 || err.status === 403 || err.status === 404) return false; // not in this space, or the role cannot write here
      throw err;
    }
    factsSent = { sig, at: Date.now() };
    try { window.dispatchEvent(new CustomEvent('app:facts', { detail: { space: spaceId } })); } catch { /* no window to tell */ }
    return true;
  }

  // Events for the module before its page has said hello wait until it has.
  let ready = false;
  // The environment's facts as the module was last told them (the hello, then the 'environment' event). They follow a
  // setting (the picture map is Maps' `imageMap`), so any environment setting change reads this mount's context again, a
  // moment later (one read for a burst), and the module hears 'environment' with the new facts when they differ.
  let toldFacts = null;
  let factsTimer = 0;
  const recheckFacts = () => {
    if (!ready || keyed) return;
    clearTimeout(factsTimer);
    factsTimer = setTimeout(() => {
      api('GET', url('/context', scope)).then((answer) => {
        const facts = environmentFacts(answer);
        if (JSON.stringify(facts) === JSON.stringify(toldFacts)) return;
        toldFacts = facts;
        send('environment', facts);
      }).catch(() => { /* the next change asks again */ });
    }, 300);
  };
  // The space's phases, as the module was last told them (the hello, then the 'phases' event): { phases, created } as one
  // text. The space page says when they change (space.js: a window event for the modules in its page, a BroadcastChannel
  // for pop-outs and module pages of the same browser); a page without it (a module opened alone) reads this mount's
  // context again now and then and on focus. The module hears 'phases' ({ phases }; the SDK adds the timeline) only when
  // they differ, and the SDK keeps host.space().phases current.
  const phasesKey = (dates, created) => JSON.stringify([dates || {}, created || null]);
  let toldPhases = null;
  const tellPhases = (dates, created) => {
    if (!ready || keyed || scope !== 'space' || !contextInfo || !contextInfo.space) return;
    const key = phasesKey(dates, created || contextInfo.space.createdAt);
    if (key === toldPhases) return;
    toldPhases = key;
    contextInfo.space = { ...contextInfo.space, phases: dates || {}, ...(created ? { createdAt: created } : {}) };
    send('phases', { phases: dates || {}, created: contextInfo.space.createdAt || null });
  };
  // The space's budget target (#216) rides with the phases: the module hears 'space' ({ budget }) only when it changed,
  // and the SDK keeps host.space().budget current.
  const tellSpace = (budget) => {
    if (!ready || keyed || scope !== 'space' || !contextInfo || !contextInfo.space) return;
    const b = budget && typeof budget === 'object' ? budget : null;
    if (JSON.stringify(b) === JSON.stringify(contextInfo.space.budget || null)) return;
    contextInfo.space = { ...contextInfo.space, budget: b };
    send('space', { budget: b });
  };
  const hearPhases = (d) => {
    if (!d || d.space !== spaceId) return;
    if (d.phases && typeof d.phases === 'object') tellPhases(d.phases, d.created);
    if ('budget' in d) tellSpace(d.budget);
  };
  const onPhasesEvent = (event) => hearPhases(event.detail);
  let phasesChannel = null;
  let phasesTimer = 0;
  let phasesLook = null;
  if (scope === 'space' && spaceId && !keyed) {
    window.addEventListener('app:phases', onPhasesEvent);
    if (typeof BroadcastChannel === 'function') {
      phasesChannel = new BroadcastChannel('app-phases');
      phasesChannel.onmessage = (event) => hearPhases(event.data);
    }
    if (!window.__phasesHost) {
      phasesLook = () => {
        if (!ready || document.hidden || !contextInfo || !(contextInfo.phases || []).length) return;
        api('GET', url('/context', scope)).then((a) => { if (a && a.space) { tellPhases(a.space.phases, a.space.createdAt); tellSpace(a.space.budget); } }).catch(() => { /* the next look asks again */ });
      };
      phasesTimer = setInterval(phasesLook, 60000);
      window.addEventListener('focus', phasesLook);
      document.addEventListener('visibilitychange', phasesLook);
    }
  }
  const queued = [];
  const deliver = (event, data) => {
    if (ready) send(event, data);
    else queued.push([event, data]);
  };

  const handlers = {
    async hello() {
      const [answer, envName] = await Promise.all([api('GET', url('/context', scope)), environmentName()]);
      contextInfo = answer;
      ready = true;
      toldPhases = answer.space ? phasesKey(answer.space.phases, answer.space.createdAt) : null;
      setTimeout(() => { for (const [event, data] of queued.splice(0)) send(event, data); }, 50);
      return {
        user: contextInfo.user,
        permissions: contextInfo.permissions,
        module: contextInfo.module,
        context: keyed ? { scope: 'keyed', spaceId: null, path: keyed.path, subject: keyed.subject, query: keyed.query || {} } : { scope, spaceId: scope === 'space' ? spaceId : null, environment: { name: envName }, ...(destination ? { destination: { id: destination.hub.id, part: destination.part } } : {}) },
        // A destination's part gets the page's state now, and each change after it as the 'destination' event.
        ...(destination ? { destinationState: destination.hub.state } : {}),
        locale: contextInfo.locale || { language: 'en', clock: '12', currency: 'USD', words: words() },
        space: contextInfo.space || null,
        phases: Array.isArray(contextInfo.phases) ? contextInfo.phases : [],
        // Facts about the environment (host.environment): the picture map, { file, minZoom, maxZoom, tileType }, or null.
        environment: (toldFacts = environmentFacts(contextInfo)),
        theme: readTheme(),
        // How the content fills the slot (the manifest's `content`): the SDK marks the module's document with it.
        content: contentFit,
        debug: debugOn(),
      };
    },
    async 'storage.get'({ key, scope: s, space }) {
      try {
        return (await api('GET', url(`/data/${encodeURIComponent(key)}`, scopeOf(s, space)))).item;
      } catch (err) {
        if (err.status === 404) return null;
        throw err;
      }
    },
    async 'storage.set'({ key, value, version, scope: s, space, tz: given }) {
      // The zone the value's clock times are read in: this browser's, or the one the module names (the Calendar, saving a copy of
      // an Itinerary object, names the trip's own, so the object's time is not moved by where the person is).
      let tz = '';
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* the server falls back */ }
      if (typeof given === 'string' && /^[A-Za-z0-9_+\-/]{1,64}$/.test(given)) tz = given;
      return (await api('PUT', url(`/data/${encodeURIComponent(key)}`, scopeOf(s, space)), { value, version, tz })).item;
    },
    async 'storage.delete'({ key, version, scope: s, space }) {
      let tz = '';
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* the server falls back */ }
      return api('DELETE', url(`/data/${encodeURIComponent(key)}`, scopeOf(s, space), { version, tz }));
    },
    async 'storage.list'({ prefix, scope: s, space }) {
      const sc = scopeOf(s, space);
      if (sc.scope === 'spaces') return (await api('GET', url('/spaces-data', sc, { prefix }))).items;
      return (await api('GET', url('/data', sc, { prefix }))).items;
    },
    // Objects: summaries for pointers to other modules' objects, and a search for objects this module may link to.
    // Always asked on this module's behalf (`from`), so the server can check it was approved for them.
    async 'objects.resolve'({ refs }) {
      const q = guestToken ? `?guest=${encodeURIComponent(guestToken)}` : '';
      return (await api('POST', `/api/objects/resolve${q}`, { from: module.id, refs: Array.isArray(refs) ? refs.slice(0, 50) : [] })).summaries;
    },
    // The kinds of other modules' objects this module may link to, so it need not know them by name.
    async 'objects.kinds'() {
      const p = new URLSearchParams({ from: module.id });
      if (guestToken) p.set('guest', guestToken);
      return (await api('GET', `/api/objects/kinds?${p}`)).kinds;
    },
    // Show an object in the module that owns it (the page decides how: the canvas, a page). `newTab`: the click asked for
    // a new tab (Ctrl or the middle button); a page that can (home's tiles) opens it in one, any other ignores it.
    async 'objects.open'({ ref, newTab, list }) {
      if (!REF_SHAPE(ref)) throw Object.assign(new Error('that is not a valid reference'), { status: 400 });
      // A file of a library opens in the file window over the page, not in the library's module (plan-attachments-vault.md,
      // decision 19); `list` is the ids of the files linked where it was opened from, for Previous and Next.
      if (ref.kind === 'file' && ref.scope === 'space') return handlers['files.open']({ ref, list });
      if (!onOpenRef) throw Object.assign(new Error('nothing here can open it'), { status: 400 });
      return Boolean(await onOpenRef(cleanPointer(ref), { newTab: newTab === true }));
    },
    // A short note on the page that goes away by itself: for an instant confirmation ("Saved in ..."), never kept anywhere.
    async 'ui.toast'({ text }) {
      if (typeof text !== 'string' || !text.trim()) throw Object.assign(new Error('say something'), { status: 400 });
      showNote(text);
      return true;
    },
    // A question for the person (host.ui.confirm): the styled confirm over the page. true for the action, false for anything else.
    async 'ui.confirm'(o) {
      return confirmDialog(o);
    },
    // The object picker (host.objects.pick): a window the page draws, searching with this module's own permissions (the same search as
    // 'objects.search'). Resolves with a pointer, a list of them (multiple), or null when the person cancels.
    async 'objects.pick'({ modules, kinds, title, multiple, scope: s, space }) {
      const kindList = await handlers['objects.kinds']().catch(() => []);
      return pickObjects(
        { title: title || `Pick ${word('object', { a: true })}`, multiple: multiple === true, modules, kinds },
        {
          // The server answers at most 50 objects, newest first, and cannot yet keep to one module or kind. With a filter and no words
          // typed, the objects that have a place (up to 1,000) are asked for as well, so a list of Places is not cut to what is dated.
          // Once the server filters by module and kind this second ask goes.
          search: async (q) => {
            const found = await handlers['objects.search']({ q, scope: s, space });
            if (q || !((modules && modules.length) || (kinds && kinds.length))) return found;
            const more = await handlers['objects.search']({ q, scope: s, space, has: 'place' }).catch(() => []);
            const keyOf = (r) => [r.module, r.kind, r.id, r.scope, r.space || ''].join('|');
            const seen = new Set(found.map((x) => x && x.ref && keyOf(x.ref)));
            return [...found, ...more.filter((x) => x && x.ref && !seen.has(keyOf(x.ref)))];
          },
          kinds: kindList,
        },
      );
    },
    // A Font Awesome icon as inline SVG, for a module in a sandboxed frame that cannot load the icon font.
    async 'icons.svg'({ name, style }) {
      const n = String(name ?? '');
      const st = ['solid', 'regular', 'brands'].includes(style) ? style : 'solid';
      if (!/^[a-z0-9-]{1,40}$/.test(n)) throw Object.assign(new Error('no such icon'), { status: 400 });
      const res = await fetch(`/api/icons/${st}/${n}`);
      if (!res.ok) throw Object.assign(new Error('no such icon'), { status: res.status });
      return res.text();
    },
    // Open this module's own page, at a place in it (a short hash such as day=2026-09-24). Only a host that has
    // somewhere to take it (the dashboard) answers; the page then hands the hash to the module (pagehash).
    async 'page.open'({ hash, newTab }) {
      const h = String(hash ?? '');
      if (!/^[A-Za-z0-9=&_.:,-]{0,80}$/.test(h)) throw Object.assign(new Error('that is not a valid place'), { status: 400 });
      if (!onOpenPage) throw Object.assign(new Error('nothing here can open it'), { status: 400 });
      return Boolean(await onOpenPage(h, { newTab: newTab === true }));
    },
    // Tell the host what one of this module's objects points at (all of it: the list replaces the last).
    async 'objects.setLinks'({ from, to, space, kind, op }) {
      if (!REF_SHAPE(from)) throw Object.assign(new Error('that is not a valid reference'), { status: 400 });
      // The object's own place, as any other write: a mount in a space speaks only for that space, and { space } must
      // be the pointer's. The server checks the viewer may change the module's data there.
      if (from.scope === 'space') {
        const place = scopeOf('space', space === undefined || space === null || space === '' ? from.space : space);
        if (place.space !== from.space) throw Object.assign(new Error('that object is in another space'), { status: 400 });
      } else if (space !== undefined && space !== null && space !== '') throw Object.assign(new Error('that object is not in a space'), { status: 400 });
      const q = guestToken ? `?guest=${encodeURIComponent(guestToken)}` : '';
      return api('POST', `/api/objects/links${q}`, { module: module.id, from: cleanPointer(from), to: (Array.isArray(to) ? to : []).filter(REF_SHAPE).slice(0, 20).map(cleanPointer), ...(typeof kind === 'string' && /^[a-z][a-z0-9_-]{0,31}$/i.test(kind) ? { kind } : {}), ...(op === 'add' || op === 'remove' ? { op } : {}) });
    },
    // What points at one of this module's objects ('to'), or what it points at ('from'): summaries.
    async 'objects.links'({ ref, dir }) {
      if (!REF_SHAPE(ref)) throw Object.assign(new Error('that is not a valid reference'), { status: 400 });
      const p = new URLSearchParams({ from: module.id, ref: JSON.stringify(cleanPointer(ref)), dir: dir === 'from' ? 'from' : 'to' });
      if (guestToken) p.set('guest', guestToken);
      return (await api('GET', `/api/objects/links?${p}`)).summaries;
    },
    // What points at each of several of this module's objects, in one request: [{ ref, summaries }], only those something points at.
    async 'objects.linksToAll'({ refs }) {
      const list = (Array.isArray(refs) ? refs : []).filter(REF_SHAPE).slice(0, 200).map(cleanPointer);
      if (!list.length) return [];
      const q = guestToken ? `?guest=${encodeURIComponent(guestToken)}` : '';
      return (await api('POST', `/api/objects/links/batch${q}`, { module: module.id, refs: list })).links;
    },
    // Events and actions between modules (see the SDK's host.events and host.actions). Always in this
    // module's own place, and always on its behalf: the server checks what it declared and was approved for.
    async 'events.publish'({ name, ref, data }) {
      return api('POST', `/api/bus/publish${busGuest()}`, { module: module.id, name, ref, data, ...busPlaceBody() });
    },
    async 'events.since'({ after }) {
      return api('GET', `/api/bus/events?${busQuery({ module: module.id, after: String(after ?? 0) })}`);
    },
    // `ref`: the object the actions would be about (a drop's): the server then lists only those that can be carried out
    // in that object's own place for this viewer (plan-calendar-destination, decision 21).
    async 'actions.list'({ accepts, self, ref } = {}) {
      const extra = {};
      if (typeof accepts === 'string' && accepts) extra.accepts = accepts.slice(0, 80);
      if (self) extra.self = '1';
      if (REF_SHAPE(ref)) extra.ref = JSON.stringify(cleanPointer(ref));
      // `open`: a mount of the providing module is in this page, so a request asked with { here: true } can be answered.
      return (await api('GET', `/api/bus/actions?${busQuery({ from: module.id, ...extra })}`)).actions.map((a) => ({ ...a, open: openInPage(a.module) }));
    },
    // `here`: only a mount of the provider in this page may carry it out, within PAGE_WAIT_MS (see pageInput).
    async 'actions.request'({ action, input, here }) {
      const name = String(action || '');
      if (name === 'assistant:askAssistant' || name === 'askAssistant') {
        if (typeof onChatAsk !== 'function') throw Object.assign(new Error(`Ask this from Chat in ${word('space', { a: true })}.`), { status: 400 });
        // No question with an object is fine: the server asks its own default (What should I know about it?).
        const q = String(input?.question || '').trim().slice(0, 1000);
        if (!q && !input?.ref) throw Object.assign(new Error('Type a question.'), { status: 400 });
        const refs = input?.ref ? [input.ref] : [];
        await onChatAsk({ question: q, refs });
        return { id: 0, status: 'done', result: { ok: true } };
      }
      const queued = await api('POST', `/api/bus/actions/request${busGuest()}`, { from: module.id, action, input: pageInput(input, here === true, thisPage.id, Date.now()), ...busPlaceBody() });
      // The module that carries an action does it from its own page, so a request waits until that page is open: ask the host to
      // open it here (on the space's canvas) when it is not.
      if (onOpenModule) { try { onOpenModule(String(action).split(':')[0]); } catch (err) { /* it cannot be opened here */ } }
      return queued;
    },
    async 'actions.pending'() {
      return (await api('GET', `/api/bus/actions/pending?${busQuery({ module: module.id })}`)).actions.filter((a) => forThisPage(a.input, thisPage.id, Date.now()));
    },
    async 'actions.claim'({ id }) {
      return api('POST', `/api/bus/actions/claim${busGuest()}`, { module: module.id, id, ...busPlaceBody() });
    },
    async 'actions.complete'({ id, result }) {
      return api('POST', `/api/bus/actions/complete${busGuest()}`, { module: module.id, id, result, ...busPlaceBody() });
    },
    async 'actions.status'({ id }) {
      return api('GET', `/api/bus/actions/status?${busQuery({ from: module.id, id: String(id) })}`);
    },
    async 'objects.format'() {
      return api('GET', '/api/objects/format');
    },
    async 'objects.checkAvailable'() {
      return api('GET', url('/objects/check', scopeOf()));
    },
    async 'objects.check'({ text, file }) {
      const body = file instanceof Blob ? file : new Blob([String(text ?? '')], { type: 'text/plain' });
      return api('POST', url('/objects/check', scopeOf()), body, file instanceof Blob ? 'application/octet-stream' : 'text/plain');
    },
    // `scope: 'spaces'` (an environment page only) asks every space the viewer belongs to at once, each pointer with its
    // space; `has: 'place'` keeps only summaries with a place (plan-map-destination, "SDK and the host").
    async 'objects.search'({ q, scope: s, space, has, kind, in: marked }) {
      const p = objectSearchParams(module.id, { q, scope: s, space, has, kind, in: marked }, { scope, spaceId, moduleScopes: module.scope, keyed: Boolean(keyed) });
      if (guestToken) p.set('guest', guestToken);
      return (await api('GET', `/api/objects/search?${p}`)).summaries;
    },
    // The priced objects of the other modules in this space (host.objects.priced; plan-budget-module.md, step 3): the
    // summaries that carry an `amount`, and `withheld`, how many the viewer may not read (a number, no titles).
    async 'objects.priced'() {
      if (scope !== 'space' || !spaceId) return { summaries: [], withheld: 0 };
      const p = objectSearchParams(module.id, { scope: 'space', space: spaceId, has: 'amount' }, { scope, spaceId, moduleScopes: module.scope, keyed: Boolean(keyed) });
      if (guestToken) p.set('guest', guestToken);
      const answer = await api('GET', `/api/objects/search?${p}`);
      return { summaries: answer.summaries || [], withheld: Number(answer.withheld) > 0 ? Math.floor(Number(answer.withheld)) : 0 };
    },
    // Whether another module that reads the budget target (the `budget` flag) is on in this space and open to this
    // person: the Planner stands its own money aside for it. False outside a space.
    async 'budget.elsewhere'() {
      if (scope !== 'space' || !spaceId || keyed) return false;
      const q = new URLSearchParams({ space: spaceId });
      if (guestToken) q.set('guest', guestToken);
      try {
        return ((await api('GET', `/api/modules/for-space?${q}`)).modules || []).some((m) => m.budget === true && m.id !== module.id);
      } catch (err) {
        return false;
      }
    },
    // Each space with its `createdAt` and `phases` (the dates on its timeline) from the spaces list when the viewer may
    // read it, so a module's environment page can run host.util.phaseTimeline for each (plan-one-bar.md step 2).
    async spaces() {
      const list = (await api('GET', url('/spaces-data', 'spaces', { info: 1 }))).spaces;
      let records = [];
      try { records = (await api('GET', '/api/spaces')).spaces || []; } catch (err) { records = []; }
      const byId = new Map(records.map((r) => [r.id, r]));
      return list.map((r) => { const full = byId.get(r.id); return full ? { ...r, createdAt: full.createdAt, phases: full.phases || {} } : r; });
    },
    // The main phase's end moved later to cover a day (POST /api/spaces/:id/phases/cover, plan-one-bar.md step 2): the
    // space's new phases, or null when nothing moved (the server answers 204).
    async 'phases.cover'({ day }) {
      if (scope !== 'space' || !spaceId) throw Object.assign(new Error(`only in ${word('space', { a: true })}`), { status: 400 });
      const guest = guestToken ? `?guest=${encodeURIComponent(guestToken)}` : '';
      const answer = await api('POST', `/api/spaces/${encodeURIComponent(spaceId)}/phases/cover${guest}`, { day });
      return answer && answer.phases && typeof answer.phases === 'object' ? { phases: answer.phases } : null;
    },
    // The space's budget target (plan-budget-module.md, decision 5). Whether this person may change it: the space's owner,
    // the admin, or a moderator of this space (the rule Set up uses: GET /api/me, hasOwnerRights or
    // user.spaces[<id>].permissions.moderator). The server decides again on every save. False for a guest and anywhere
    // but a space.
    async 'budget.can'() {
      if (module.budget !== true || scope !== 'space' || !spaceId || keyed || guestToken) return false;
      try {
        const me = (await api('GET', '/api/me')).user;
        return Boolean(me) && me.role !== 'guest' && (['owner', 'admin'].includes(me.role) || Boolean(me.spaces?.[spaceId]?.permissions?.moderator));
      } catch (err) {
        return false;
      }
    },
    // Save the target (PATCH /api/spaces/:id with only `budget`: { amount?, currency? }; a currency sent alone REPLACES the
    // whole target, so a caller keeping an amount sends it too). Answers the target the server kept, or null when it is
    // cleared. The module hears 'space' at once; the other modules here and the pop-outs hear it through the page's event.
    async 'budget.set'({ budget }) {
      // Only a module whose manifest says `"budget": true` (the host's own word for it, never the module's), and only an
      // explicit target or null: nothing sent is a mistake, never a clear.
      if (module.budget !== true) throw Object.assign(new Error(`this ${word('module')} does not use the budget target`), { status: 403 });
      if (budget === undefined) throw Object.assign(new Error('say the target, or null to clear it'), { status: 400 });
      if (scope !== 'space' || !spaceId || keyed) throw Object.assign(new Error(`only in ${word('space', { a: true })}`), { status: 400 });
      const answer = await api('PATCH', `/api/spaces/${encodeURIComponent(spaceId)}`, { budget });
      const kept = answer && answer.space && answer.space.budget && typeof answer.space.budget === 'object' ? answer.space.budget : null;
      const detail = { space: spaceId, budget: kept };
      try { window.dispatchEvent(new CustomEvent('app:phases', { detail })); } catch (err) { /* no window to tell */ }
      try { if (phasesChannel) phasesChannel.postMessage(detail); } catch (err) { /* nobody to hear */ }
      tellSpace(kept);
      return kept;
    },
    // The address of a file an owner placed for this module (see the server's module files), in this module's place.
    async 'files.url'({ name, folder }) {
      const n = String(name ?? '');
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(n)) throw Object.assign(new Error('no such file'), { status: 400 });
      // `folder` (optional) says which of the module's file folders, for a name two folders share (the picture map's).
      const f = folder === undefined || folder === null ? '' : String(folder);
      if (f && !/^[a-z0-9][a-z0-9-]{0,31}$/.test(f)) throw Object.assign(new Error('no such file'), { status: 400 });
      return url(`/files/${encodeURIComponent(n)}`, scopeOf(), f ? { folder: f } : {});
    },
    async 'settings.get'() {
      return (await api('GET', url('/settings/values', scopeOf()))).values;
    },
    // AI (a module that declares the `ai` hook): whether this person may use it here, and a request the server answers.
    async 'ai.available'() {
      return api('GET', url('/ai', scopeOf()));
    },
    async 'ai.ask'({ task, question, objects }) {
      return api('POST', url('/ai', scopeOf()), { task: String(task ?? ''), question: String(question ?? '').slice(0, 1000), objects: Array.isArray(objects) ? objects.slice(0, 12) : [], tz: browserZone() });
    },
    // The signed-in person's own other calendars (a module that declares the `external` hook), read only: their events
    // between `from` and `to` (YYYY-MM-DD or ISO times), with the calendars they come from. A guest gets none.
    async 'external.events'({ from, to }) {
      if (!externalHere) return { calendars: [], events: [] };
      const when = (v) => (v === undefined || v === null || v === '' ? undefined : String(v).slice(0, 40));
      return api('GET', url('/external-events', scopeOf(), { from: when(from), to: when(to) }));
    },
    // Other modules' objects shown on a calendar as markers (host.objects.markers; plan-calendar-markers.md): the module's
    // own route, in the mount's place (the space, or the environment and the viewer's spaces) and as the guest. A keyed
    // page has none.
    async 'objects.markers'({ from, to }) {
      if (keyed) return [];
      const when = (v) => (v === undefined || v === null || v === '' ? undefined : String(v).slice(0, 40));
      return (await api('GET', url('/markers', scopeOf(), { from: when(from), to: when(to) }))).markers;
    },
    // Ask in this space's Chat (host.chat.ask). Only the canvas host provides it.
    // Whether host.chat.ask can work here: only on a space's canvas, where Chat is.
    async 'chat.available'() {
      return { available: typeof onChatAsk === 'function' };
    },
    async 'chat.ask'({ question, refs }) {
      if (typeof onChatAsk !== 'function') throw Object.assign(new Error(`Ask this from Chat in ${word('space', { a: true })}.`), { status: 400 });
      const q = String(question || '').trim().slice(0, 1000);
      const list = (Array.isArray(refs) ? refs : []).filter(REF_SHAPE).slice(0, 12).map(cleanPointer);
      if (!q && !list.length) throw Object.assign(new Error('Type a question.'), { status: 400 });
      return onChatAsk({ question: q, refs: list });
    },
    // Uploaded pictures (a module whose manifest declares `uploads`): kept per scope, checked and cleaned by the server.
    async 'uploads.put'({ file, name, keepPosition, scope: s }) {
      if (!(file instanceof Blob)) throw Object.assign(new Error('send a picture'), { status: 400 });
      return (await api('POST', url('/uploads', scopeOf(s), { name: String(name ?? file.name ?? '').slice(0, 100), keepPosition: keepPosition ? '1' : '' }), file, file.type)).file;
    },
    async 'uploads.inspect'({ head, scope: s }) {
      if (!(head instanceof Blob)) throw Object.assign(new Error('send a picture'), { status: 400 });
      return api('POST', url('/uploads/inspect', scopeOf(s)), head.slice(0, 256 * 1024), head.type);
    },
    async 'uploads.thumb'({ id, file, scope: s }) {
      if (!(file instanceof Blob)) throw Object.assign(new Error('send a picture'), { status: 400 });
      return (await api('PUT', url(`/uploads/${encodeURIComponent(String(id ?? ''))}/thumb`, scopeOf(s)), file, file.type)).file;
    },
    async 'uploads.list'({ scope: s }) {
      return (await api('GET', url('/uploads', scopeOf(s)))).files;
    },
    async 'uploads.remove'({ id, scope: s }) {
      return api('DELETE', url(`/uploads/${encodeURIComponent(String(id ?? ''))}`, scopeOf(s)));
    },
    // The address to show a picture from (an <img> in the page), or its thumbnail.
    async 'uploads.url'({ id, thumb, scope: s }) {
      return url(`/uploads/${encodeURIComponent(String(id ?? ''))}${thumb ? '/thumb' : ''}`, scopeOf(s));
    },
    // A library's files (a module that declares `library: true`): the space this frame is in, through the library routes. The bytes
    // of an add go by XHR so the module hears how far they got ('libraryprogress'); a download is started here, because a sandboxed
    // frame may not start one.
    async 'library.list'() {
      return api('GET', libraryUrl());
    },
    async 'library.add'({ file, name, keepPosition, token }) {
      if (!(file instanceof Blob)) throw Object.assign(new Error('send a file'), { status: 400 });
      const target = libraryUrl('', { name: String(name ?? file.name ?? '').slice(0, 200), keepPosition: keepPosition ? '1' : '' });
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', target);
        for (const [k, v] of Object.entries(accessKeyHeaders())) xhr.setRequestHeader(k, v);
        if (file.type) xhr.setRequestHeader('content-type', file.type);
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) send('libraryprogress', { token, loaded: e.loaded, total: e.total }); };
        const fail = (message, status) => { libraryUploads.delete(token); reject(Object.assign(new Error(message), { status })); };
        xhr.onload = () => {
          libraryUploads.delete(token);
          let data = {};
          try { data = JSON.parse(xhr.responseText); } catch { data = {}; }
          if (xhr.status >= 200 && xhr.status < 300) resolve(data.file);
          else fail(data.error || `HTTP ${xhr.status}`, xhr.status);
        };
        xhr.onerror = () => fail('The file could not be sent. Check your connection and try again.', 0);
        xhr.onabort = () => fail('Stopped.', 0);
        if (token) libraryUploads.set(token, xhr);
        xhr.send(file);
      });
    },
    async 'library.cancel'({ token }) {
      const xhr = libraryUploads.get(token);
      if (xhr) xhr.abort();
      return true;
    },
    async 'library.rename'({ id, name }) {
      return (await api('PATCH', libraryUrl(`/${encodeURIComponent(String(id ?? ''))}`), { name: String(name ?? '').slice(0, 200) })).file;
    },
    async 'library.remove'({ id }) {
      return api('DELETE', libraryUrl(`/${encodeURIComponent(String(id ?? ''))}`));
    },
    async 'library.uses'({ id }) {
      return api('GET', libraryUrl(`/${encodeURIComponent(String(id ?? ''))}/uses`));
    },
    async 'library.thumb'({ id, file }) {
      if (!(file instanceof Blob)) throw Object.assign(new Error('send a picture'), { status: 400 });
      return (await api('PUT', libraryUrl(`/${encodeURIComponent(String(id ?? ''))}/thumb`), file, file.type)).file;
    },
    async 'library.url'({ id, thumb, download }) {
      return libraryUrl(`/${encodeURIComponent(String(id ?? ''))}/${thumb ? 'thumb' : 'content'}`, download && !thumb ? { download: '1' } : {});
    },
    async 'library.blob'({ id, thumb }) {
      const res = await fetch(libraryUrl(`/${encodeURIComponent(String(id ?? ''))}/${thumb ? 'thumb' : 'content'}`), { headers: accessKeyHeaders() });
      if (!res.ok) {
        // The server's own sentence (a download-only PDF answers "This PDF can't be opened here. Download it."), else the plain one.
        let said = '';
        try { said = (await res.json()).error || ''; } catch { /* no body */ }
        throw Object.assign(new Error(said || (res.status === 404 ? 'There is no such file.' : `HTTP ${res.status}`)), { status: res.status });
      }
      return res.blob();
    },
    // Open a file of a library in a file window over the page (public/file-viewer.js): `ref` points at the file, `list` is the ids to walk with
    // Previous and Next (the Vault's list as filtered). Focus comes back to this module when the window closes, and the module hears 'fileclosed'.
    async 'files.open'({ ref, list, name }) {
      if (!REF_SHAPE(ref) || ref.kind !== 'file' || ref.scope !== 'space') throw Object.assign(new Error('that is not a file'), { status: 400 });
      // A mount opens files of its own space only, and a module other than the library itself only if its manifest consumes that kind and
      // an owner approved it (the server's resolve answers 403 otherwise; plan-attachments-vault.md, section 5).
      if (scope !== 'space' || !spaceId || ref.space !== spaceId) throw Object.assign(new Error('that file is not in this space'), { status: 403 });
      if (ref.module !== module.id) {
        const [seen] = await api('POST', '/api/objects/resolve', { from: module.id, refs: [cleanPointer(ref)] }).then((r) => r.summaries || []);
        if (!seen || seen.status === 400 || seen.status === 403) throw Object.assign(new Error((seen && seen.status === 403 && seen.error) || 'this module may not open files'), { status: 403 });
      }
      const holder = pageMode ? container : frame;
      const { openFile } = await import('/file-viewer.js');
      const ids = Array.isArray(list) ? list.filter((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id)).slice(0, 2000) : null;
      return openFile({
        ref: cleanPointer(ref),
        ids,
        name: typeof name === 'string' ? name.slice(0, 200) : '',
        doc: holder.ownerDocument,
        returnFocus: () => {
          try { holder.focus({ preventScroll: true }); } catch { /* not focusable */ }
          send('fileclosed', { id: ref.id });
          return holder;
        },
        openRef: onOpenRef ? (r) => onOpenRef(cleanPointer(r), {}) : null,
        join: (fn) => joinStream(spaceId, guestToken, fn),
      });
    },
    // Share links (public/share-sheet.js): the sheet and the list are drawn in this page, so Copy works; the module hears 'sharechanged'
    // when a link is made, changed or turned off. The server checks the `share` permission on every call.
    async 'library.share'({ ids }) {
      const list = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id)).slice(0, 200);
      if (!list.length) throw Object.assign(new Error('choose a file'), { status: 400 });
      libraryUrl();
      const holder = pageMode ? container : frame;
      const { shareFiles } = await import('/share-sheet.js');
      return shareFiles({ doc: holder.ownerDocument, place: { module: module.id, space: spaceId }, ids: list, onChange: () => send('sharechanged', {}), returnFocus: () => holder });
    },
    async 'library.shares'() {
      libraryUrl();
      const holder = pageMode ? container : frame;
      const { shareLinks } = await import('/share-sheet.js');
      return shareLinks({ doc: holder.ownerDocument, place: { module: module.id, space: spaceId }, onChange: () => send('sharechanged', {}), onChoose: () => send('sharechoose', {}), returnFocus: () => holder });
    },
    async 'library.download'({ id }) {
      const doc = (pageMode ? container : frame).ownerDocument;
      const a = doc.createElement('a');
      a.href = libraryUrl(`/${encodeURIComponent(String(id ?? ''))}/content`, { download: '1' });
      a.download = '';
      a.rel = 'noopener';
      a.hidden = true;
      doc.body.append(a);
      a.click();
      a.remove();
      return true;
    },
    // Place search answered by the server (a module that declares `geocoder`): saved places first, then the chosen service.
    async 'geocode.search'({ q, lat, lon }) {
      return api('GET', url('/geocode', scopeOf(), { q: String(q ?? '').slice(0, 200), lat, lon }));
    },
    async 'geocode.used'({ key }) {
      return api('POST', url('/geocode/use', scopeOf()), { key: String(key ?? '') });
    },
    // Lookups answered by the server (a module that declares `"lookups": ["flight"]`): a flight from the schedule this server
    // learned from saved flights, an airport by its code, and teaching it a saved flight. Only `flight` exists today.
    async 'lookup.flight'({ number, date }) {
      const n = String(number ?? '').trim().slice(0, 40);
      const d = String(date ?? '').trim().slice(0, 40);
      // Left empty, the route would answer whether the lookup is offered instead: the route's own errors.
      if (!n) throw Object.assign(new Error('bad number'), { status: 400 });
      if (!d) throw Object.assign(new Error('bad date'), { status: 400 });
      return api('GET', url('/flight-lookup', scopeOf(), { number: n, date: d }));
    },
    async 'lookup.airport'({ code }) {
      const c = String(code ?? '').trim().slice(0, 8);
      if (!c) return null;
      try {
        return (await api('GET', url('/flight-lookup', scopeOf(), { code: c }))).airport || null;
      } catch (err) {
        if (err.status === 404) return null;
        throw err;
      }
    },
    async 'lookup.available'({ kind }) {
      if (kind !== 'flight') return false;
      return (await api('GET', url('/flight-lookup', scopeOf()))).available === true;
    },
    async 'lookup.remember'({ kind, object }) {
      if (kind !== 'flight' || !object || typeof object !== 'object') return null;
      await api('POST', url('/flight-lookup/remember', scopeOf()), { object });
      return null;
    },
    // A page's title, description and image, read by the server (a module with a linkPreviews setting).
    async 'preview.link'({ url: page }) {
      return api('POST', url('/link-preview', scopeOf()), { url: String(page ?? '').slice(0, 500) });
    },
    // The address of a link's picture, fetched by this server, for an <img> on the card.
    async 'preview.image'({ url: page }) {
      return url('/link-image', scopeOf(), { url: String(page ?? '').slice(0, 2000) });
    },
    // The people of the space this module is in: [{ key, name }], for a module that lets a person be chosen ("whose is it").
    // Empty on a module's environment page, which is not in one space.
    async people() {
      if (scope !== 'space' || !spaceId) return [];
      const q = guestToken ? `?guest=${encodeURIComponent(guestToken)}` : '';
      const { users, spaces } = await api('GET', `/api/presence${q}`);
      const members = new Set((spaces || []).find((r) => r.id === spaceId)?.members || []);
      return (users || []).filter((u) => members.has(u.key)).map((u) => ({ key: u.key, name: u.displayName }));
    },
    async schedule(spec) {
      return api('POST', url('/schedule', scopeOf(spec?.scope, spec?.space)), { ...spec, scope: undefined, space: undefined });
    },
    async cancelSchedule({ key, scope: s, space }) {
      return api('DELETE', url(`/schedule/${encodeURIComponent(key)}`, scopeOf(s, space)));
    },
    // `to: 'space'` is the space the call is in: this frame's, or the one named with { space }.
    async notify(spec) {
      return api('POST', url('/notify', scopeOf(spec?.scope, spec?.space)), { ...spec, scope: undefined, space: undefined });
    },
    // A destination's part changing the page's shared state (host.destination.set): only what its destination lets
    // this part set (see DESTINATIONS); the page passes it on to every part.
    async 'destination.set'({ patch }) {
      if (!destination) throw Object.assign(new Error('this is not part of a destination'), { status: 400 });
      return destination.hub.fromPart(destination.part, patch);
    },
    // The old action bar (host.bar.set), kept for modules written for it: nothing is drawn along the bottom any more.
    // Its buttons fold into the "+" as plain leaves (the primary first, the rest in order; a quick-add is a leaf that
    // sends an empty value), and a pick sends the 'bar' event it always sent. A module that calls host.add.set gets that
    // list instead. Answers true, as it always did.
    async 'bar.set'({ items }) {
      ({ entries: barFold, quick: barQuick } = foldBarItems(items));
      drawAddSlot();
      return true;
    },
    // The "+" in the titlebar (host.add.set): the window's titlebar, or the page bar on a module's own page. False where
    // there is none (a destination's part, a dashboard widget): the module keeps its own add buttons in the page there. An
    // empty list takes the "+" away (a module sends one for a person who may not add: what "may add" means is the
    // module's own permission).
    async 'add.set'({ entries }) {
      if (!bands) return false;
      addOwn = Array.isArray(entries) ? entries : [];
      drawAddSlot();
      return true;
    },
    // The status bar (host.status.set). False where there is none (a destination's part, a dashboard widget).
    async 'status.set'({ items }) {
      if (!bands) return false;
      return bands.status(items);
    },
    // What needs this person's action (host.attention.set / clear): kept by the server per space, person and module, and
    // counted in the space's status strip (space.js, which hears 'app:attention' and reads it again). Only a module
    // running in a space for a signed-in person has one; anywhere else, or when the role may not write here, false.
    async 'attention.set'(report) {
      const place = attentionPlace();
      if (!place) return false;
      const count = Number(report?.count);
      const body = { count: Number.isInteger(count) ? Math.min(99, Math.max(0, count)) : -1 };
      if (body.count < 0) throw Object.assign(new Error('the count must be a whole number from 0 to 99'), { status: 400 });
      body.label = String(report?.label ?? '').slice(0, 40);
      body.items = (Array.isArray(report?.items) ? report.items : []).slice(0, 20).map((i) => ({
        title: String(i?.title ?? '').slice(0, 120),
        ...(REF_SHAPE(i?.object) ? { object: cleanPointer(i.object) } : {}),
      })).filter((i) => i.title.trim());
      return sendAttention('PUT', place, body);
    },
    async 'attention.clear'() {
      const place = attentionPlace();
      return place ? sendAttention('DELETE', place) : false;
    },
    // How this space stands (host.facts.set / clear): kept by the server per space and module, and drawn as chips in the
    // space's status strip (space.js, which hears 'app:facts' and reads them again). Only a module running in a space for
    // a signed-in person reports; anywhere else, or when the role may not write here, false. The shape is cut to the
    // server's limits; what is left the server checks (a bad id or icon rejects with its sentence).
    // The words are cut by characters as a person counts them (code points), so an emoji is never split in half. `when`
    // (a day, YYYY-MM-DD) goes as sent: the page words it for each viewer. A module that reports a fact marked `budget`
    // reads the space's budget target from its context again after the report (the space's record no longer carries
    // it to the page), and hears 'space' when an owner changed it, so its next report is against the current target.
    async 'facts.set'({ facts } = {}) {
      const place = factsPlace();
      if (!place) return false;
      const cut = (v, n) => [...String(v ?? '')].slice(0, n).join('');
      const list = (Array.isArray(facts) ? facts : []).slice(0, 6).map((f) => {
        const fact = { id: cut(f?.id, 32), icon: cut(f?.icon, 40), text: cut(f?.text, 40) };
        if (f?.value !== undefined && f?.value !== null && f.value !== '') fact.value = cut(f.value, 24);
        const progress = Number(f?.progress);
        if (f?.progress !== undefined && f?.progress !== null && Number.isFinite(progress)) fact.progress = Math.min(1, Math.max(0, progress));
        if (Number.isInteger(f?.order)) fact.order = Math.min(99, Math.max(0, f.order));
        if (f?.budget === true) fact.budget = true;
        if (typeof f?.when === 'string' && f.when) fact.when = f.when.slice(0, 10);
        return fact;
      });
      const kept = await (list.length ? sendFacts('PUT', place, { facts: list }) : sendFacts('DELETE', place));
      if (list.some((f) => f.budget)) {
        api('GET', url('/context', scope)).then((a) => { if (a && a.space) tellSpace(a.space.budget); }).catch(() => { /* the next report asks again */ });
      }
      return kept;
    },
    async 'facts.clear'() {
      const place = factsPlace();
      return place ? sendFacts('DELETE', place) : false;
    },
    // The module's own actions in its frame's title bar (icons beside the menu, or in it): a window's, popped out too, a
    // module's own page, a destination's page, a composite's window on a space's canvas.
    async 'header.set'({ items }) {
      if (!headerOut) return false; // a dashboard widget
      headerOut(cleanHeaderItems(items));
      return true;
    },
    // The standard actions the module handles itself (host.standard.set: Settings, Share, Print), drawn by the host in the
    // frame's menu with the host's words and icons; a pick arrives as the 'standard' event. False where there is no frame.
    async 'standard.set'({ actions }) {
      if (!standardOut) return false;
      standardOut.standard(actions);
      return true;
    },
    // Share: what the module's handler answered, in the host's Share dialog (only after the person picked Share).
    async 'share.show'(result) {
      if (!standardOut) return false;
      return standardOut.share(result);
    },
    // Print: the module is ready (its handler ran; in a frame, its page measured at `height`). The host prints the content
    // area and tells the module 'printed' once the page is back.
    async 'print.run'({ height } = {}) {
      if (!standardOut) return false;
      const done = standardOut.print({ iframe: pageMode ? null : frame, height: Number(height) || 0 });
      if (!done) return false;
      done.then(() => send('printed', {}));
      return true;
    },
    // The one toolbar row under the title bar (createFrameBands, above): the view switches, a title, buttons, a search,
    // the filters -- see host.toolbar.set. A destination's part hands its items to the page, which draws them in the
    // page's one row with its own.
    async 'toolbar.set'({ items }) {
      if (!toolbarOut) return false; // a dashboard widget
      toolbarOut(items);
      return true;
    },
    // The module's tools in the nav bars (host.nav.set): registered under the module's own namespace in the shared
    // registry (public/nav-bar.js), drawn while this mount lives (the module open on this space's canvas) and taken out when it is
    // destroyed. The set replaces the last one. Every tool is a Workspace tool: the registry puts it where the page put
    // the Workspace's toolbar (the top bar's right zone wider than a phone, the tab bar's "..." on a phone; nav-bar.js
    // setWorkspace), and a module never chooses (plan-primary-nav.md, decision 10): a tool that still says bar:
    // 'primary' or system: true is placed like any other; see cleanModuleTools for every rule. Resolves false when there
    // is no space bar here (a module's own page), and then nothing is drawn.
    async 'nav.set'({ tools }) {
      const clean = navBar.cleanModuleTools(module.id, tools);
      const wanted = new Set(clean.map((t) => t.id));
      for (const id of navIds) if (!wanted.has(id)) { navBar.unregister(id); navIds.delete(id); }
      let drawn = true;
      for (const t of clean) {
        if (!navBar.has(t.bar)) { drawn = false; continue; }
        const { own, module: _m, ...tool } = t;
        navBar.register({ ...tool, onClick: () => send('nav', { id: own }) });
        navIds.add(t.id);
      }
      return drawn;
    },
    async 'nav.setActive'({ id, on }) {
      const full = `${module.id}:${String(id ?? '')}`;
      return navIds.has(full) && navBar.setActive(full, Boolean(on));
    },
    async 'nav.setBadge'({ id, n }) {
      const full = `${module.id}:${String(id ?? '')}`;
      return navIds.has(full) && navBar.setBadge(full, Number(n) || 0);
    },
    // A drag of a pointer to one of this module's objects began or ended (see host.objects.drag).
    async 'objects.dragStart'({ ref }) {
      if (!REF_SHAPE(ref)) throw Object.assign(new Error('that is not a valid reference'), { status: 400 });
      beginDrag(mine, cleanPointer(ref));
      return true;
    },
    async 'objects.dragEnd'() {
      if (activeDrag && activeDrag.source === mine) endDrag();
      if (ptrDrag && ptrDrag.source === mine) ptrEnd();
      return true;
    },
    // A line for the on-screen trace (see the top of this file), from a module that was told tracing is on.
    async 'objects.trace'({ msg }) {
      trace(`${module.id}: ${String(msg).slice(0, 160)}`);
      return true;
    },
    // The pointer-driven drag (see host.objects.draggable): begin, move, and let go.
    // What is dragged is a pointer to one of this module's objects, or, for a module with nothing stored (an answer
    // the assistant wrote), a summary of it.
    async 'objects.ptrStart'({ ref, summary, label, x, y }) {
      const carried = ref ? null : cleanSummary(summary);
      if (ref && !REF_SHAPE(ref)) throw Object.assign(new Error('that is not a valid reference'), { status: 400 });
      if (!ref && !carried) throw Object.assign(new Error('nothing valid to drag: a reference or a summary with a title'), { status: 400 });
      ptrBegin(mine, ref ? { ref: cleanPointer(ref) } : { summary: carried }, label, Number(x) || 0, Number(y) || 0);
      return true;
    },
    async 'objects.ptrMove'({ x, y }) {
      if (ptrDrag && ptrDrag.source === mine) ptrMove(Number(x) || 0, Number(y) || 0);
      return true;
    },
    async 'objects.ptrDrop'({ x, y }) {
      if (ptrDrag && ptrDrag.source === mine) ptrDrop(Number(x) || 0, Number(y) || 0);
      return true;
    },
    async resize(size) {
      if (onResize) onResize(size || {});
      return true;
    },
    // An editor window (host.ui.editor) in a sandboxed frame: the <dialog>'s top layer is the frame's own, so the SDK
    // asks for the frame itself to be lifted over the canvas while the editor is open, and put back when it closes.
    // Answers { lifted: true, phone } when lifted, else false: a module in the page needs nothing (its dialog is in the
    // page's top layer), nor does a window of its own (`lift: false`), and the host refuses a frame the person is not in
    // or that is off screen (see liftFrame). `height` (the dialog's content) sizes the frame. See
    // documentation/plans/plan-editor-window.md, "A module in a sandboxed frame".
    async 'editor.lift'({ open, size, height }) {
      // A part in a composite's page (destination.js, `liftUp`): the page is in a frame on the Workspace, so the canvas lifts that frame.
      if (pageMode) return liftUp ? liftUp(Boolean(open), size === 'large' ? 'large' : 'medium', Number(height)) : false;
      if (!lift) return false;
      return liftFrame(Boolean(open), size === 'large' ? 'large' : 'medium', Number(height));
    },
    async setTitle({ title }) {
      if (onTitle) onTitle(String(title || '').slice(0, 80));
      return true;
    },
    // Who is online right now, everyone: the same roster the call page reads. For a page that follows
    // people (a keyed page about one of them, a dashboard) rather than the members of the space a module is in (`people`).
    // The asides are their own record (plan-names step 8), never among the spaces.
    async 'presence.get'() {
      return presenceForModule(await api('GET', `/api/presence${busGuest()}`));
    },
    // One person's picture in a slot (profile, player, character, talking ...), as a blob URL the module shows and
    // releases; null when they have none there. `space` asks for that space's own picture set, the way the call page does.
    async 'images.get'({ key, slot, space, fallback }) {
      const p = new URLSearchParams();
      if (space) p.set('space', String(space));
      if (fallback === 'none') p.set('fallback', 'none'); // the profile slot: the real photo only, not the initials plate
      if (guestToken) p.set('guest', guestToken);
      const res = await fetch(`/img/${encodeURIComponent(String(key ?? ''))}/${encodeURIComponent(String(slot ?? ''))}?${p}`, { headers: accessKeyHeaders() });
      if (!res.ok) return null;
      return URL.createObjectURL(await res.blob());
    },
    'images.release'({ url }) {
      if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
      return true;
    },
    // The server's access key (an owner's to see), for a module that builds links to a keyed page.
    async 'access.key'() {
      return (await api('GET', '/api/me')).streamKey || null;
    },
    async 'access.regenerate'() {
      return (await api('POST', '/api/stream-key/regenerate')).streamKey;
    },
    // A read-only viewer of one person's camera and microphone, following them from space to space. Page mode only:
    // the media elements are handed to the module's own handlers, which a frame could not receive.
    async 'media.watch'(params) {
      if (!pageMode) throw Object.assign(new Error('media.watch needs a module that runs in the page'), { status: 400 });
      return watchMedia(params);
    },
  };
  // A destination's part in a composite's frame (destination.js, `onAdd` and `onStatus`): it has no titlebar of its own,
  // but its page hands its adds and its status up to the composite's titlebar and status bar on the Workspace, so they are
  // drawn after all (true), and the part hides its own add buttons as it does under a titlebar. A pick comes back as the
  // 'add' event, through deliver.
  if (destination && onAdd) handlers['add.set'] = async ({ entries }) => { onAdd(cleanAddEntries(entries)); return true; };
  if (destination && onStatus) handlers['status.set'] = async ({ items }) => { onStatus(cleanStatusItems(items)); return true; };

  // Each frame has its own secret, handed to it in its address. Messages to the frame carry it, and
  // the SDK ignores any that do not, so another frame that can reach this one cannot pose as the host.
  // (Checking who sent a message is not enough: when the call has been popped out, this code runs in
  // a different window from the frame's parent.)
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

  function reply(id, message) {
    frame.contentWindow?.postMessage({ host: 1, tk: secret, id, ...message }, '*');
  }

  async function onMessage(e) {
    if (pageMode || e.source !== frame.contentWindow) return; // only our own frame
    const m = e.data;
    if (!m || m.host !== 1 || m.tk !== secret || typeof m.id !== 'number' || typeof m.method !== 'string') return; // its own secret, both ways
    const handler = handlers[m.method];
    if (!handler) return reply(m.id, { error: { message: `unknown call ${m.method}`, status: 400 } });
    try {
      reply(m.id, { result: await handler(m.params || {}) });
    } catch (err) {
      reply(m.id, { error: { message: err.message, status: err.status, current: err.current } });
    }
  }
  // A frame's messages arrive in the window it lives in, which is not this one
  // when the call has been popped out.
  const hostWin = (pageMode ? container : frame).ownerDocument.defaultView || window;
  if (!pageMode) hostWin.addEventListener('message', onMessage);
  mounted.add(mine);
  const inPage = { module: module.id, el: mine.frame };
  thisPage.open.add(inPage);
  // A destination's part hears the page's state on each change (the hello carried it as it was then).
  const leaveDestination = destination ? destination.hub.join(destination.part, (state) => deliver('destination', state)) : () => {};

  // Live changes: one stream per scope the frame can see. For a module in the page, an event goes
  // straight to its SDK.
  let sdkEmit = null;
  function send(event, data) {
    // The host control the module is answering (a bar button, a toolbar item, a header icon, a nav tool, the "+"): where
    // focus goes back to when the editor window this opens is put back (liftFrame).
    if (!pageMode && (event === 'bar' || event === 'toolbar' || event === 'header' || event === 'nav' || event === 'add' || event === 'standard')) opener = { el: frame.ownerDocument.activeElement, at: Date.now() };
    if (pageMode) {
      if (sdkEmit) sdkEmit(event, data);
      return;
    }
    frame.contentWindow?.postMessage({ host: 1, tk: secret, event, data }, '*');
  }
  // A module on a space's canvas hears that space and the environment; a module's environment page hears the
  // environment and the viewer's spaces (see the stream's scopes on the server). A keyed page has no session for the
  // event stream, so it asks after its settings now and then instead (the one live thing it needs).
  const leaveStream = keyed ? pollSettings() : joinStream(scope === 'space' ? spaceId : null, guestToken, (type, d) => {
    // The person's own other calendars changed (plan-google-calendar.md, Part 2): only the modules the server named,
    // those with the approved `external` hook, hear it, and ask again for what they show.
    if (type === 'external') {
      if (externalHere && Array.isArray(d.modules) && d.modules.includes(module.id)) send('external', {});
      return;
    }
    // An object of a marker kind changed (plan-calendar-markers.md): only the modules the server named, those approved
    // to show it, hear it, and ask again for what they show. No object data comes with it.
    if (type === 'markers') {
      if (Array.isArray(d.modules) && d.modules.includes(module.id)) send('markers', {});
      return;
    }
    // A library's file was added, renamed, removed or given a thumbnail (plan-attachments-vault.md, step 4): the library's own
    // module and the modules approved to link to its files (the server names them) hear which one, and ask again for what they show.
    if (type === 'library') {
      if (Array.isArray(d.modules) && d.modules.includes(module.id)) send('library', { op: d.op, id: d.id, module: d.module, spaceId: d.spaceId });
      return;
    }
    // Any module's environment setting may change the environment's facts (host.environment): every mount looks again.
    if (type === 'settings' && d.scope === 'environment') recheckFacts();
    if (type !== 'bus' && type !== 'action' && type !== 'refchange' && d.module !== module.id) return;
    const here = scope === 'space' ? 'space' : 'environment';
    if (type === 'change') {
      if (onChanges) onChanges({ deleted: d.deleted === true });
      send('change', { key: d.key, value: d.value, version: d.version, deleted: d.deleted, by: d.by, scope: d.scope, spaceId: d.spaceId });
    // Many keys at once (a Clear, its Undo): one event, which the SDK hands to a 'changes' listener once, else key by key.
    } else if (type === 'changes') {
      if (onChanges) onChanges({ many: true });
      send('changes', { changes: Array.isArray(d.changes) ? d.changes : [], cleared: d.cleared === true, restored: d.restored === true, by: d.by, scope: d.scope, spaceId: d.spaceId });
    } else if (type === 'refchange') {
      if (Array.isArray(d.modules) && d.modules.includes(module.id)) send('refchange', { ref: d.ref, change: d.change });
    }
    else if (type === 'links') send('links', { ref: d.ref });
    else if (type === 'settings') send('settings', { scope: d.scope });
    else if (type === 'bus') {
      // An event some module published: only the modules the server named may hear it, in their own place.
      if (Array.isArray(d.subscribers) && d.subscribers.includes(module.id) && d.scope === here) send('bus', { id: d.id, at: d.at, module: d.module, name: d.name, ref: d.ref, data: d.data });
    } else if (type === 'action') {
      // A request for this module to do something.
      // One asked for the asking page only (pageInput) is heard there only, and not after its time.
      if (d.provider === module.id && d.scope === here && forThisPage(d.input, thisPage.id, Date.now())) send('action', { id: d.id, name: d.name, from: d.from, by: d.by });
    }
    else send('schedule', { key: d.key, payload: d.payload, scope: d.scope });
  });

  // The keyed page's stand-in for the event stream: its settings, compared every 10 seconds, a 'settings'
  // event when they changed (an admin adjusting the box while the stream is up).
  function pollSettings() {
    let last = null;
    const tick = async () => {
      try {
        const sig = JSON.stringify((await api('GET', url('/settings/values', 'environment'))).values);
        if (last !== null && sig !== last) send('settings', { scope: 'environment' });
        last = sig;
      } catch {
        // the next tick asks again
      }
    };
    const timer = setInterval(tick, 10000);
    tick();
    return () => clearInterval(timer);
  }

  // The lift (editor.lift; plan-editor-window.md, "A module in a sandboxed frame"): createFrameLift (above mountModule) does it.
  // `opener`: the host control whose event the module heard last (the bar, toolbar, header, nav, add).
  let opener = null; // { el, at }
  const frameLift = frame ? createFrameLift(frame, { mount: mine, tell: () => send('editordismiss', {}), onLift, takeOpener: () => { const o = opener; opener = null; return o; } }) : null;
  const releaseLift = () => { if (frameLift) frameLift.release(); };
  const liftFrame = (open, size, height) => (frameLift ? frameLift.lift(open, size, height) : false);

  // No same-origin: an opaque origin, no cookies, no host DOM. allow-forms lets a
  // module's own <form> fire its submit event (a sandboxed frame without it
  // swallows the submit, so a Save button appears to do nothing); the frame's
  // policy sets form-action 'none', so nothing can actually be submitted anywhere.
  if (!pageMode) {
    frame.addEventListener('load', () => releaseLift()); // the module started over: no editor is open in it
    frame.setAttribute('sandbox', 'allow-scripts allow-forms');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.src = `/m/${encodeURIComponent(module.id)}/${encodeURIComponent(module.version)}/${entry}?tk=${secret}`;
  } else {
    startInPage().catch((err) => {
      container.textContent = `This ${word('module')} could not start: ${err.message}`;
    });
  }

  // A module running in the page: its styles, markup and script come from the server in parts, into a
  // shadow root on the container. Its page-wide selectors (html, body) mean the container, the theme
  // reaches it because CSS variables inherit into a shadow root, and it gets its own SDK, whose calls
  // go straight to the handlers above instead of through a frame. Nothing stops the module reaching
  // beyond that: it runs with the page's power.
  async function startInPage() {
    const scopeCss = (text) => text.replace(/:root\s*\{[^}]*\}/g, '').replace(/(^|[\s,}])(html|body)(?=[\s,{.:[])/g, '$1:host');
    const base = `/m/${encodeURIComponent(module.id)}/${encodeURIComponent(module.version)}/${entry}`;
    const text = async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} ${res.status}`);
      return res.text();
    };
    const [sdkCss, systemCss, css, body] = await Promise.all([text('/sdk/host.css'), text('/sdk/system.css'), text(`${base}?part=css`), text(`${base}?part=body`)]);
    const root = container.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    // system.css after host.css, as the app's pages load it (the design system's tokens and roles; their :root is dropped here, so the module reads the page's, inherited).
    style.textContent = scopeCss(sdkCss) + '\n' + scopeCss(systemCss) + '\n' + scopeCss(css);
    root.appendChild(style);
    const tpl = document.createElement('template');
    tpl.innerHTML = body;
    root.appendChild(tpl.content);
    const call = (method, params) => {
      const handler = handlers[method];
      if (!handler) return Promise.reject(Object.assign(new Error(`unknown call ${method}`), { status: 400 }));
      return Promise.resolve().then(() => handler(params || {}));
    };
    const built = window.createHost({
      call,
      root,
      rootElement: container,
      // In a composite's page the frame is lifted over the Workspace while an editor window is open (handlers 'editor.lift').
      ...(liftUp ? { lift: (open, size, height) => call('editor.lift', { open: Boolean(open), size, height }) } : {}),
      // The pointer in the page's coordinates, in the module's own.
      localPoint: (x, y) => {
        const r = container.getBoundingClientRect();
        return { x: x - r.left, y: y - r.top };
      },
      // Points from the SDK are in the module's own coordinates; a shadow root wants the page's.
      elementAt: (pt) => {
        const r = container.getBoundingClientRect();
        return root.elementFromPoint(pt.x + r.left, pt.y + r.top);
      },
    });
    sdkEmit = built.emit;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${base}?part=js&v=${encodeURIComponent(module.version)}`;
      script.host = built.host; // the module reads it from document.currentScript when it starts
      script.onload = () => { script.remove(); resolve(); };
      script.onerror = () => { script.remove(); reject(new Error('its script did not load')); };
      document.head.appendChild(script);
    });
  }

  return {
    send,
    // For tests: start a brokered drag of `ref` from this module, as its SDK would.
    beginDragForTest: (ref) => beginDrag(mine, ref),
    // For tests: run the pointer-driven drag from this module as its SDK would (steps: start, move, drop).
    ptrForTest: (step, ref, label, x, y) => (step === 'start' ? ptrBegin(mine, ref && ref.summary ? { summary: cleanSummary(ref.summary) } : { ref }, label, x, y) : step === 'move' ? ptrMove(x, y) : ptrDrop(x, y)),
    // An event for the module from the page (a pointer to open, objectopen; a place in its page, pagehash).
    deliver,
    // A control in the frame's bands that is the module's (its "+", title bar icons, toolbar): the window that made the frame
    // hands each such event here (its own standard actions and Close it keeps).
    bandEvent: (e) => { if (bands) bands.event(e); },
    // The frame's lift for an editor window (editor.lift), for the page to put back itself: canvas.js does before it
    // moves a module between docked and floating. lift(false) when nothing is lifted does nothing.
    lift: (open, size) => (!pageMode ? liftFrame(Boolean(open), size === 'large' ? 'large' : 'medium') : false),
    destroy() {
      if (!pageMode) releaseLift();
      if (!pageMode) hostWin.removeEventListener('message', onMessage);
      sdkEmit = null;
      mounted.delete(mine);
      thisPage.open.delete(inPage);
      if (activeDrag && (activeDrag.source === mine || activeDrag.layers.some((l) => l.target === mine))) endDrag();
      if (ptrDrag && ptrDrag.source === mine) ptrEnd();
      for (const id of navIds) navBar.unregister(id); // its nav tools go with it
      navIds.clear();
      if (bands) bands.destroy();
      clearTimeout(factsTimer);
      window.removeEventListener('app:phases', onPhasesEvent);
      if (phasesChannel) phasesChannel.close();
      if (phasesTimer) { clearInterval(phasesTimer); window.removeEventListener('focus', phasesLook); document.removeEventListener('visibilitychange', phasesLook); }
      leaveStream();
      leaveDestination();
      if (pageMode) container.shadowRoot?.replaceChildren();
      else frame.removeAttribute('src');
    },
  };
}
