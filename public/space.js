// The call page: players see and hear each other.
import { Room, RoomEvent, Track, createLocalTracks } from '/lib/livekit-client.esm.mjs';
import { loadBranding, api, noticeToast, renderTopbar, setTopbarLocation, setPresentSpace, setInSpace, openSwitcher as openSpaceSwitcher, refreshNotices, iconClasses, spaceCrumbIcon, hasOwnerRights, word, verb, applyWords, followTheme, getIcons } from '/brand.js';
import { anchorSegments, layoutTabs, tabOverflow, layoutIconChoices, iconMatches, gridStep, pageOpens, isHere, hereCount, asidePlaceholder, whereWords, offStream } from '/primary-nav.js';
import { openPhaseSheet, FACT_CHIPS_HIDDEN_AT } from '/phase-sheet.js';
import { createSpaceSetup, setupAddress, configurationLabel } from '/space-setup.js';
import { renderModuleSettings } from '/module-settings.js';
import { actionBar } from '/action-bar.js';
import { createCanvas } from '/canvas.js';
import { layoutDiffers } from '/layouts.js';
import { conferenceAllowed, opensWithSummary, shouldAutoJoin } from '/opens-with.js';
import { switchListHtml, wireSwitchList } from '/switch-list.js';
import { createWhoHere } from '/space-people.js';
import { openLiveStream, liveStreamUrl, peopleFromPresence } from '/space-live.js';
import { hotkeyMatches, formatHotkey } from '/hotkeys.js';
import { initDashboard } from '/dashboard.js';
import { nav } from '/nav-bar.js';
import { attachChatInput, viewOf, discussionWord, placeAbove, stripSummaryMarkers, clearChoices, ofClearType, inClearScope, clearTakesPicture, clearNoticeTakes, cleanPreview, cleanKept, siteName, linkKeeper, previewNoticeTakes, keptNoticeTakes } from '/chat-input.js';
import { openHostMenu, openConfirmMenu, closeHostMenu, setGuestPass } from '/module-host.js';
import { confirmDialog } from '/confirm.js';
import { foldCallToolbar, callTitle, callTime, callDuration } from '/call-toolbar.js';

// Elements by id, wherever the canvas currently lives (the page or the pop-out
// window, which takes the whole canvas with it).
const canvasEl = document.getElementById('canvas');
// The conference can float or live in a window of its own, away from the canvas.
const confEl = document.getElementById('conference');
// The header moves to the popped-out window with the canvas, so it is searched too.
const topbarEl = document.getElementById('topbar');
// The chat can be in a window of its own, away from the canvas, so it is searched too.
const chatEl = document.getElementById('chat');
// The work area (plan-one-bar.md, step 6): the always-on column (#side-column: the call as a strip of tiles or Join the
// call, Online, the chat) beside the canvas. It pops out as one with the canvas, so it is searched too.
const workEl = document.getElementById('work');
const columnEl = document.getElementById('side-column');
const $ = (id) => (id === 'canvas' ? canvasEl : document.getElementById(id) || canvasEl.querySelector(`#${id}`) || confEl.querySelector(`#${id}`) || topbarEl.querySelector(`#${id}`) || chatEl.querySelector(`#${id}`) || workEl.querySelector(`#${id}`));
// Before anything else touches a header element -- the header itself is
// built here, not left static in space.html, so every #topbar-crumb,
// #recall-button etc. lookup below needs this to have already run.
renderTopbar();
if (new URLSearchParams(location.search).has('layout')) import('/layout-debug.js'); // a live geometry readout, see there
// The space's own bar, a second row of the header (so it moves with the header when the app is popped out). Wider
// than a phone it is the status strip (plan-space-status-strip.md, step 1: the phase chip and its track, in every view
// while the space has phases; the Workspace's controls are in the top bar) and hides itself with nothing in it
// (style.css); on a phone it is the tab bar at the foot of the page (the strip is then a line under the top row): the modules to open (canvas.js fills #modules-menu), Join,
// Online, Rejoin call, the "..." and Leave.
const subnav = document.createElement('div');
subnav.className = 'subnav';
subnav.id = 'subnav';
// The secondary nav is about the space, in two zones (plan-two-zone-nav.md, decisions 1, 4 and 5; see
// architecture-navigation.md): left, the module selector and then Online, who is here (the space's name is the top bar's
// breadcrumb, not repeated here: plan-primary-nav.md, decision 14); right, the space's actions: full screen, pop out, pulling people back
// from an aside, and leaving. The controls are registrations in the nav-bar registry (public/nav-bar.js), made below
// beside the code each one drives, as Workspace tools (`workspace`): the registry puts them in the top bar wider than a
// phone (placeSubnav, nav.setWorkspace) and here on a phone; a module's own tools (host.nav.set) go with them.
subnav.innerHTML = `
  <div class="nav-left subnav-left"></div>
  <span class="nav-right subnav-tools"></span>`;
topbarEl.appendChild(subnav);
nav.attach('secondary', subnav); // its tools are registered further down, once the state their `visible` reads exists
// The layout tab whose layout the canvas holds (plan-layout-views.md, steps 2 and 3): 'workspace', 'calendar', 'map'
// or a favorite saved layout's id. Every view is a layout: Calendar and Map are their composite on the canvas, loaded
// as a saved layout is. The Workspace's tools (the Layout menu, Full screen, Pop out) show on every tab (workspaceShown,
// below). For the visit only: entering a space resets it. (setView() further down is the
// conference's own layout, another thing.)
let currentLayoutTab = 'workspace';
// The Layout menu (plan-layout-menu.md; Thomas, 2026-10-13: the page's shared menu, host-menu.js, not a panel of its
// own): one icon button, Layout (the environment's `layout` verb), beside Set up in the top bar wider than a phone,
// registered with Set up further down. canvas.js draws the menu from its items (Show, Arrange) and the Layouts section
// here (layoutMenuItems, further down), with this note as its last row: a short line canvas.js writes (onNote): a
// module that waits for a column because the window is too narrow, or how many Panel Mode could dock
// (plan-docked-limit.md). Empty, it takes no room; it stays in the page so a screen reader hears it as it changes.
// On a phone #modules-menu is the tab bar instead (canvas.js fills it; registered after placeSubnav() below, which
// decides phone or wide), the button is not drawn, and there is no menu.
const noteHolder = document.createElement('div');
noteHolder.innerHTML = '<p class="module-chooser-note" id="modules-menu-note" role="status"></p>';
const menuNote = noteHolder.firstElementChild;
const moduleChooser = document.createElement('span');
moduleChooser.className = 'module-chooser';
moduleChooser.innerHTML = '<div class="module-chooser-list" id="modules-menu" role="group" hidden></div>';
// The tab bar is named by the module word (registerWordTools() below calls this once it is known).
function nameModuleChooser() {
  moduleChooser.querySelector('#modules-menu').setAttribute('aria-label', word('module', { many: true, cap: true }));
}
nameModuleChooser();
// On a phone the space bar is a tab bar at the bottom of the page, in the flow after the canvas, so
// the call toolbar sits directly above it whatever the browser does with its own bottom bar. Wider,
// it is the header's second row. On a phone the bar is the Tab bar family's (.sdk-tabbar, system.css) and the chooser's
// list holds its module tabs (`sdk-tabbar-tabs`, always shown, canvas.js draws them); wider it is a list under its button.
// Phone or wide is the header's own window: popped out, the header is in that window, whose width is its own (a
// 480 wide pop-out is a phone there, and its stylesheet says so). Re-checked as that window crosses the line, and
// when the header moves between windows (setUpPopoutWindow and its pagehide call placeSubnav()).
let phoneWatch = null; // { view, query } the header's window and its phone-width query, listened to
function phoneWidth() {
  const view = subnav.ownerDocument.defaultView || window;
  if (!phoneWatch || phoneWatch.view !== view) {
    phoneWatch?.query.removeEventListener('change', placeSubnav);
    const query = view.matchMedia('(max-width: 640px)');
    query.addEventListener('change', placeSubnav);
    phoneWatch = { view, query };
  }
  return phoneWatch.query.matches;
}
function placeSubnav() {
  const popped = topbarEl.ownerDocument !== document;
  if (popped && subnav.parentNode !== topbarEl) topbarEl.appendChild(subnav); // popped out, the bar is the header's second row
  const list = moduleChooser.querySelector('#modules-menu');
  const tabs = phoneWidth();
  subnav.classList.toggle('sdk-tabbar', tabs);
  if (list.classList.contains('sdk-tabbar-tabs') !== tabs) {
    list.classList.toggle('sdk-tabbar-tabs', tabs);
    list.classList.toggle('module-chooser-list', !tabs);
    if (tabs) list.removeAttribute('role'); else list.setAttribute('role', 'group');
    nameModuleChooser();
    list.hidden = !tabs;
    window.hostModules?.updateMenu(); // tabs or switches (not yet made on the first call)
  }
  placeColumnTools(); // Join the call and Online: in the side column wider than a phone, in the bar (the tab bar) below
  placeStatusStrip(tabs); // the status strip: this row wider than a phone, a line under the top row on a phone
  // The Workspace's tools (Layout, Full screen, Pop out, Pull participants back, a module's): in the top
  // bar wider than a phone, in the tab bar's "..." on a phone (nav-bar.js, `workspace`).
  nav.setWorkspace({ bar: tabs ? 'secondary' : 'primary' });
  nav.draw('secondary'); // the space bar folds again in the window it is in now (plan-phone-space-bar.md)
  if (popped) { nav.draw('primary'); return; } // the header's phone menu follows that window too
  if (tabs) document.body.appendChild(subnav);
  else topbarEl.appendChild(subnav);
}
// Set further down, once Join the call and Online exist (the column section); nothing to place before that.
let placeColumnTools = () => {};
let homeChatChanged = () => {}; // Home's chat came or went: Start call and the commands follow (assigned with the column below)
// Set further down with the status strip (the phase chip's section); nothing to place before that.
let placeStatusStrip = () => {};
placeSubnav();
// The phone's tab bar: the Workspace's, first in the tab bar's left zone, only where the window is a phone's width.
nav.register({ bar: 'secondary', zone: 'left', group: 'modules', id: 'module-chooser', order: 1, fold: false, icon: 'object-group', label: word('module', { many: true, cap: true }), element: moduleChooser, visible: () => phoneWidth(), workspace: 'only' });
// Only this page loads your profile, Manage and a module's page as an overlay over a running call instead of a real
// navigation (see openOverlay() below): the shared header asks first (app:open-profile, app:open-page, see the
// listeners by openOverlay()).
const call = new Room({ adaptiveStream: true, dynacast: true });
const tiles = new Map(); // participant identity (user key) -> tile element
const ghostTiles = new Map(); // identity -> tile element, for space members aside elsewhere
// What the live stream's aside-started message said of the aside each person went to (key -> { private, members }): someone
// outside an aside learns who it is with only from that, since presence names only the space they stepped out of.
const startedAsides = new Map();
const STARTED_ASIDE_MS = 15000; // a presence answer older than the message can still say they are here
const asideSelection = new Set(); // identities picked to pull aside together, before confirming
let me = null;
let spaceName = 'Coffee Pub'; // the space I am in, once joined; the environment's name before that
const presenceUsers = new Map(); // key -> { displayName, borderColor, online, space, ... } from /api/presence
let requestSpaces = []; // spaces I may only ask to enter (request access), as the narrow rows the server sends
let presenceSpaces = []; // the spaces, with `mine` for the ones I may join
let currentSpace = null; // the space I am in, once joined
let viewingHome = false; // the space list shown while still connected (showSpaceList); the breadcrumb is empty then
// Home's chat (plan-home-lobby.md, step 3): the Lobby's record (the hidden `lobby` space, Home's backing, decision 6)
// while the one #chat shows in Home's column, else null. The chat reads its space from chatSpace(), never currentSpace.
let homeChatSpace = null;
const chatSpace = () => homeChatSpace || currentSpace;
let guestSpaceName = ''; // a guest link's space, named in the top bar's anchor before the guest enters
// Reloading the page keeps you in your space: the space is remembered for this tab (not across tabs or restarts) and rejoined when the
// page starts again. It is forgotten when you leave or are removed, but not when the page itself is going away.
let unloading = false;
addEventListener('pagehide', () => { unloading = true; });
addEventListener('pageshow', () => { unloading = false; });
const REMEMBERED_SPACE = 'app.space';
const rememberSpace = (id) => { try { sessionStorage.setItem(REMEMBERED_SPACE, id); } catch { /* not remembered */ } };
const forgetSpace = () => { if (unloading) return; try { sessionStorage.removeItem(REMEMBERED_SPACE); } catch { /* nothing */ } };
const rememberedSpace = () => { try { return sessionStorage.getItem(REMEMBERED_SPACE) || ''; } catch { return ''; } };
// Being in the space and being in the conference are separate (plan-realtime-optional-livekit.md, step 5). In the space
// (`entered`) is the live stream being open: the canvas, the chat and who is here, from entering until leaving, with no
// call service at all. On the call (`inCall`) is the only time the page is connected to the call service: from Start or
// Join call (startCall, with the token POST /api/call/join answers) until hanging up, leaving or moving.
let entered = false;
let inCall = false;
// Left the call since entering (Hang up, the conference closed): the environment's "join the call on entering" does
// not join them again until they enter a space again (GitHub #199). A pull keeps it; join() clears it.
let leftCall = false;
// Away (setAway, below): declared up here because what you hear (hearingOff) is set from page load on.
let isAway = false;
let awayRestoreMic = false;
let awayRestoreCam = false;
let awayMessage = ''; // the away message others read (the "awayMessage" attribute), '' for a plain Away
let awayRestartCam = false; // a camera change (device, quality) made while away, applied on Back (restartCamera)
const LOBBY = 'lobby';
// The space the stream currently hears (server-computed), as this viewer may read it: null when it is somewhere they
// can't see (decision 6, step 3: a space or an aside they don't belong to).
let activeSpace = LOBBY;
let ownerOnline = false; // whether that's actually backed by an owner (or the admin) online right now
// Server-wide call feature toggles (Manage > Settings) -- these defaults
// hold until init() replaces them with whatever /api/branding actually says.
let features = { maxQuality: 720, allowScreenShare: true, allowAsides: true, allowPrivate: true, allowReactions: true, callService: true, conferenceEnabled: true, autoJoinCall: false };

// A guest link (/guest/<token>): no account, just a name and this space. The
// token both identifies which space's guest link this is and, appended to
// our own reads below, is this tab's only credential -- there's no session.
const GUEST_PREFIX = 'guest-';
const pathToken = location.pathname.startsWith('/guest/') ? decodeURIComponent(location.pathname.split('/')[2] || '') : null;
// The same address also opens a space for a guest who came through the guest door (the landing, /guest, links to
// /guest/<space id>): their cookie is their credential, so nothing rides on the address. Told apart by asking the door
// whether this is a space it lets this visitor into; if not, the address is a guest link's token.
async function doorGuestHere(id) {
  if (!id) return null;
  try {
    const res = await fetch('/api/guest-door', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return null;
    const answer = await res.json();
    const space = (answer.spaces || []).find((s) => s.id === id);
    return space ? { guest: answer.guest, space, permissions: answer.permissions || {} } : null;
  } catch { return null; }
}
const doorGuest = await doorGuestHere(pathToken);
const guestToken = doorGuest ? null : pathToken; // a guest link's token: rides on the reads below
const guestMode = Boolean(pathToken); // any guest, by link or by the door: no account, no Set up, no creating
// What POST /api/guest-join hands the guest once they give a name: their pass, signed by the server, by which the live
// stream, presence and the call know them (as me.key, the id on it). For this page only: a reload asks the name again.
let guestPass = '';

// A picture URL for a slot, guest-aware: a guest identity (however many
// different guests are in the call) always shows the one shared guest
// picture set, and our own guest token (if we are the guest looking) rides
// along so the server recognises this tab without a session.
function imgUrl(key, slot, params = {}) {
  const isGuest = key.startsWith(GUEST_PREFIX);
  const urlKey = isGuest ? 'guest' : key;
  const urlSlot = isGuest && slot === 'profile' ? 'player' : slot;
  const q = new URLSearchParams(params);
  if (guestToken) q.set('guest', guestToken);
  const qs = q.toString();
  return `/img/${encodeURIComponent(urlKey)}/${urlSlot}${qs ? `?${qs}` : ''}`;
}

// The conference shows one set, chosen on the space: Character images, or
// Participant images (the usual, including a space still marked roleplaying).
// An aside uses the space it came from.
function conferenceSlot(spaceId, offline) {
  const space = presenceSpaces.find((r) => r.id === spaceId);
  const character = space?.profile === 'characters';
  if (offline) return character ? 'characterOffline' : 'playerOffline';
  return character ? 'character' : 'player';
}
// That set's picture, in the same order as the other views: this space's own,
// then this person's, then the default set. The profile photo is only the last
// step, when the image fails to load. The lobby and a guest have no space
// picture, so they use the profile photo.
function spacePortraitUrl(key) {
  const spaceId = currentSpace?.isAside ? currentSpace.origin : currentSpace?.id;
  if (!spaceId || spaceId === LOBBY || key.startsWith(GUEST_PREFIX)) return imgUrl(key, 'profile');
  return imgUrl(key, conferenceSlot(spaceId), { space: spaceId });
}
// One box. Only the address changes when the space's set changes, or when the
// picture is missing and the profile photo stands in.
function showConferencePortrait(img, key) {
  const src = spacePortraitUrl(key);
  if (img.dataset.src === src) return;
  img.dataset.src = src;
  img.onerror = () => { img.onerror = null; img.src = imgUrl(key, 'profile'); };
  img.src = src;
}

// An aside as the page lists it beside the spaces: its record, the environment's word for it, and the mark.
const asideEntry = (a) => ({ ...a, name: word('aside', { cap: true }), isAside: true });
// Whether I am in an aside right now: the call only, no modules, chat or chat pictures (plan-names decision 5).
const inAside = () => Boolean(currentSpace?.isAside);

// Who is where comes from GET /api/presence, which asks the call service only for who is on a call. When that does not
// answer, the page gives up and keeps what it already has: the space list and the call do not wait on it (GitHub #71). A
// little longer than the server's own two seconds, so a slow answer still arrives.
const PRESENCE_GIVE_UP_MS = 3000;

function adoptPendingSpace() {
  if (!currentSpace?.pending) return;
  const found = presenceSpaces.find((r) => r.id === currentSpace.id);
  if (!found) return;
  currentSpace = found;
  spaceName = spaceDisplayName(found);
  applyPermissions();
  updateRecallButton();
  updateCrumb();
}

async function loadPresence() {
  try {
    const url = guestToken ? `/api/presence?guest=${encodeURIComponent(guestToken)}` : doorGuest ? `/api/presence?space=${encodeURIComponent(doorGuest.space.id)}` : '/api/presence';
    const { users, spaces, asides, activeSpace: active, ownerOnline: hasOwner } = await api('GET', url, undefined, undefined, AbortSignal.timeout(PRESENCE_GIVE_UP_MS));
    presenceUsers.clear();
    for (const u of users) presenceUsers.set(u.key, u);
    // The asides are their own record (plan-names step 8); the page lists them after the spaces, marked isAside, so
    // everything that finds where someone is reads one list.
    // A space I may only ask to enter comes as a narrow row (id, name, description, hasImage, request, no members): kept
    // apart, so nothing that reads a space's members ever meets one.
    requestSpaces = (spaces || []).filter((r) => r && r.request);
    presenceSpaces = [...(spaces || []).filter((r) => !(r && r.request)), ...(asides || []).map(asideEntry)];
    activeSpace = active === undefined ? LOBBY : active; // null: the stream is somewhere I can't see
    ownerOnline = Boolean(hasOwner);
    for (const [key, tile] of tiles) {
      const colour = presenceUsers.get(key)?.borderColor;
      if (colour) tile.style.setProperty('--talk', colour);
      updateBackgroundPlaceholder(tile, key);
      const portrait = tile.querySelector('.placeholder');
      if (portrait) showConferencePortrait(portrait, key);
    }
    renderSpaces();
    updatePhaseChip(); // the space's dates ride on its presence record: a change by someone else reaches the chip here
    // The invitation to a private conversation (an aside, so a call) is offered only where there can be one.
    const canInvite = features.callService && features.conferenceEnabled && features.allowPrivate;
    if (!guestMode) initDashboard({ users, spaces: presenceSpaces, me: me?.key }, { openInSpace, joinSpace: canInvite ? joinInvitedSpace : null });
    reconcileGhostTiles();
    renderGuestLink();
    updateRecallButton();
    adoptPendingSpace();
  } catch (err) {
    // default colour stands; the next poll tries again
  }
}

// Admin only: shows "Pull participants back" whenever a Private
// Conversation was pulled out of the space I'm currently in -- the admin
// is never part of those (see /api/asides), so without this
// there'd be no way to know one is even happening, let alone end it.
let recallButtonTimer = 0;
let recallButtonCountingDown = false;

// The tool's `visible` (see its registration above): shown while the countdown runs, whatever else changes.
function recallWanted() {
  return recallButtonCountingDown || Boolean(hasOwnerRights(me) && currentSpace && presenceSpaces.some((r) => r.isAside && r.private && r.origin === currentSpace.id));
}

function updateRecallButton() {
  nav.draw(); // the tool is in the top bar wider than a phone, the tab bar's "..." on a phone
}

function resetRecallButton() {
  clearInterval(recallButtonTimer);
  recallButtonCountingDown = false;
  const btn = $('recall-button');
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-people-arrows fa-fw" aria-hidden="true"></i> Pull participants back';
}

async function recallParticipants() {
  const btn = $('recall-button');
  try {
    await api('POST', '/api/asides/recall');
    recallButtonCountingDown = true;
    btn.disabled = true;
    let n = 10;
    btn.textContent = `Rejoining in... ${n}`;
    clearInterval(recallButtonTimer);
    recallButtonTimer = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        resetRecallButton();
        updateRecallButton();
        return;
      }
      btn.textContent = `Rejoining in... ${n}`;
    }, 1000);
  } catch (err) {
    setStatus(`pull participants back: ${err.message}`, true);
  }
}

// The countdown a Private Conversation's own participants see once the
// admin recalls them -- a warning, not an instant yank, so it doesn't cut
// anyone off mid-sentence. Re-triggering (e.g. the admin clicks it twice)
// restarts the same countdown rather than stacking a second one.
let recallTimer = 0;
function startRecallCountdown(spaceId, name) {
  clearInterval(recallTimer);
  $('recall-space-name').textContent = name || 'the call';
  $('recall-overlay').hidden = false;
  let n = 10;
  $('recall-countdown').textContent = n;
  recallTimer = setInterval(() => {
    n -= 1;
    if (n <= 0) {
      clearInterval(recallTimer);
      $('recall-overlay').hidden = true;
      reconnectTo(spaceId, 'pulled back to the call...', { keepCall: true });
      return;
    }
    $('recall-countdown').textContent = n;
  }, 1000);
}

// A member of the space I'm in who is online but not actually connected
// here -- they're in a private aside elsewhere -- gets a placeholder tile:
// their picture stands in for video, dimmed, with who they stepped aside
// with, so they read as "still in the call" rather than looking like they
// hung up. Reconciled from the same polled /api/presence data that already
// drives the join screen's badges, since a genuine LiveKit disconnect
// alone can't tell "went to a private aside" apart from "actually left".
function othersLabel(members, exclude) {
  const names = members.filter((k) => k !== exclude).map((k) => presenceUsers.get(k)?.displayName).filter(Boolean);
  if (!names.length) return '';
  if (names.length === 1) return `with ${names[0]}`;
  return `with ${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

// The Aside/Private picture (their own, their space's, or the server-wide
// Default Images fallback) laid over their profile photo, same as OBS
// shows it over the Online/Offline picture -- a badge, not a replacement.
// Optional, so unlike the profile photo it simply stays hidden rather
// than falling back to anything when nothing resolves for that slot.
function setGhostBadge(img, key, slot) {
  img.hidden = true;
  img.onerror = () => { img.hidden = true; };
  img.onload = () => { img.hidden = false; };
  img.src = imgUrl(key, slot);
}

function ghostTile(key) {
  let tile = ghostTiles.get(key);
  if (tile) return tile;
  tile = document.createElement('div');
  tile.className = 'tile tile-ghost';
  tile.dataset.identity = key;
  const placeholder = document.createElement('img');
  placeholder.className = 'placeholder';
  placeholder.alt = '';
  placeholder.src = imgUrl(key, 'profile');
  tile.appendChild(placeholder);
  const badge = document.createElement('img');
  badge.className = 'tile-ghost-badge';
  badge.alt = '';
  badge.hidden = true;
  tile.appendChild(badge);
  const overlay = document.createElement('div');
  overlay.className = 'tile-ghost-overlay';
  const status = document.createElement('span');
  status.className = 'tile-ghost-status';
  status.textContent = `In ${word('aside', { a: true })}`;
  const withLine = document.createElement('span');
  withLine.className = 'tile-ghost-with';
  overlay.append(status, withLine);
  tile.appendChild(overlay);
  const name = document.createElement('span');
  name.className = 'name';
  tile.appendChild(name);
  ghostTiles.set(key, tile);
  placeInOrder(tile);
  return tile;
}

function removeGhost(key) {
  const tile = ghostTiles.get(key);
  if (!tile) return;
  tile.remove();
  ghostTiles.delete(key);
}

function reconcileGhostTiles() {
  if (!currentSpace || !inCall || !document.body.classList.contains('in-space')) return;
  let changed = false;
  for (const key of currentSpace.members) {
    if (key === me?.key) continue;
    if (tiles.has(key)) {
      if (ghostTiles.has(key)) { removeGhost(key); changed = true; }
      continue;
    }
    const user = presenceUsers.get(key);
    // Stepped out of this space (presence says so, aside record or not), or in an aside the page can see.
    const away = asidePlaceholder(user, currentSpace, presenceSpaces, startedAsides.get(key));
    if (away) {
      const tile = ghostTile(key);
      tile.classList.toggle('tile-ghost-private', away.private);
      setGhostBadge(tile.querySelector('.tile-ghost-badge'), key, away.private ? 'playerPrivate' : 'playerAside');
      tile.querySelector('.name').textContent = user.displayName;
      tile.querySelector('.tile-ghost-status').textContent = away.private ? 'In a private conversation' : `In ${word('aside', { a: true })}`;
      // Who a private word is with stays off the record here too, same as
      // it's kept off the OBS-facing recording -- everyone else at the
      // call only gets to know that it's happening, not with whom.
      tile.querySelector('.tile-ghost-with').textContent = away.private ? '' : othersLabel(away.members, key);
      changed = true;
    } else {
      // Back, or gone: forget what the message said, once presence has had time to catch up with it.
      if (Date.now() - (startedAsides.get(key)?.at || 0) > STARTED_ASIDE_MS) startedAsides.delete(key);
      if (ghostTiles.has(key)) {
        removeGhost(key);
        changed = true;
      }
    }
  }
  for (const key of [...ghostTiles.keys()]) {
    if (!currentSpace.members.includes(key)) { removeGhost(key); changed = true; }
  }
  if (changed) applyLayout();
}

// A space's name for display: asides carry no useful
// stored name, so build one from whoever else is in it.
function spaceDisplayName(r) {
  if (!r?.isAside) return r?.name || spaceName;
  const others = r.members.filter((k) => k !== me?.key).map((k) => presenceUsers.get(k)?.displayName).filter(Boolean);
  // Says "Private" rather than "Aside" whenever it is one -- whoever's in
  // here should be able to tell at a glance that this one is genuinely off
  // the record, not just infer it from which button someone clicked earlier.
  const label = r.private ? 'Private' : word('aside', { cap: true });
  return others.length ? `${label} with ${others.join(' & ')}` : label;
}

// The join screen: one card per space I belong to, with its members and a
// green dot on those in that space right now. Refreshed until I join.
function renderSpaces() {
  const list = $('spaces');
  if (!list) return;
  const keep = new Set();
  // The Lobby is Home itself (plan-home-lobby.md, step 2): its record stays, its card is not drawn.
  for (const r of [...presenceSpaces.filter((x) => x.mine && !x.isLobby), ...presenceSpaces.filter((x) => !x.mine && x.entry && !x.isAside && !x.isLobby)]) {
    keep.add(r.id);
    let card = list.querySelector(`[data-space="${CSS.escape(r.id)}"]`);
    if (!card) {
      card = document.getElementById('space-choice').content.firstElementChild.cloneNode(true);
      applyWords(card); // the template's data-fill titles, in this environment's words
      card.dataset.space = r.id;
      card.querySelector('[data-join]').dataset.join = r.id;
      list.insertBefore(card, $('home-add-space')); // the ghost card stays last
    }
    if (card.classList.contains('requestable')) { // my request was answered: it is a card like the rest now
      card.classList.remove('requestable');
      card.querySelector('[data-ask-box]').hidden = true;
      card.querySelector('.space-choice-actions').hidden = false;
      card.querySelector('.sdk-members').hidden = false;
    }
    card.classList.toggle('aside', Boolean(r.isAside));
    // Entering is the primary action; joining the call is a separate choice inside (plan-entering.md). A space's
    // button reads this environment's enter verb; an aside is a call, so its button reads Join with the phone
    // (plan-environment-templates.md, addendum 4). Still connected to this one (just browsing the space list -- see
    // showSpaceList()): offer to go back instead.
    const back = entered && currentSpace?.id === r.id;
    const joinable = !r.mine; // a space I may enter but have not joined: Join, then it is a space like the rest
    card.classList.toggle('joinable', joinable);
    const action = r.isAside || joinable ? 'Join' : verb('enter');
    const enterLabel = back ? `Back to ${spaceDisplayName(r)}` : action;
    const enter = card.querySelector('[data-join]');
    card.querySelector('[data-join-icon]').className = `fa-solid fa-${back ? 'circle-left' : r.isAside ? 'phone' : joinable ? 'user-plus' : 'door-open'} fa-fw`;
    card.querySelector('[data-join-label]').textContent = enterLabel;
    // The whole card enters the space (GitHub #225): a button by role, named for the space; an aside's card stays as it was.
    if (r.isAside || joinable) { card.removeAttribute('role'); card.removeAttribute('tabindex'); card.removeAttribute('aria-label'); }
    else { card.setAttribute('role', 'button'); card.tabIndex = 0; card.setAttribute('aria-label', spaceDisplayName(r)); }
    if (enter.title !== enterLabel) enter.title = enterLabel; // the whole label, wherever a narrow card cuts it short
    const link = card.querySelector('[data-link]');
    link.hidden = !r.link;
    if (r.link) {
      link.href = r.link;
      link.querySelector('i').className = `${iconClasses(r.linkIcon || 'link')} fa-fw`;
    }
    card.querySelector('.space-choice-name').textContent = spaceDisplayName(r);
    card.querySelector('.space-choice-desc').textContent = r.description;
    card.querySelector('.space-choice-desc').hidden = !r.description || r.isAside;
    const img = card.querySelector('.space-choice-image');
    const src = !r.isAside && r.hasImage ? `/img/space/${encodeURIComponent(r.id)}` : '';
    img.hidden = !src;
    if (src && img.dataset.src !== src) {
      img.dataset.src = src;
      img.src = src;
    }
    const members = r.members.map((k) => presenceUsers.get(k)).filter(Boolean);
    card.querySelector('.space-choice-count').textContent = r.isAside ? '' : hereCount(members, r.id);
    renderMembers(card.querySelector('.sdk-members'), members, r.id, Boolean(r.isAside));
  }
  for (const r of requestSpaces) {
    keep.add(r.id);
    let card = list.querySelector(`[data-space="${CSS.escape(r.id)}"]`);
    if (!card) {
      card = document.getElementById('space-choice').content.firstElementChild.cloneNode(true);
      card.dataset.space = r.id;
      list.insertBefore(card, $('home-add-space'));
    }
    paintRequestCard(card, r);
  }
  for (const card of [...list.children]) if (card.id !== 'home-add-space' && !keep.has(card.dataset.space)) card.remove();
  renderSpaceListHead();
  syncHomeChat(); // Home's chat column, with no space entered (plan-home-lobby.md, step 3)
}

// A space I may only ask to enter: its picture, name and description, and the state of my request. Never entered from the
// card. Drawn as text. `request` is 'request' (Request access), 'pending' (Requested, Withdraw), and `answer: 'denied'`
// rides on a 'request' row during the cooldown (Declined, no button).
function paintRequestCard(card, r) {
  card.classList.add('requestable');
  card.classList.remove('joinable', 'aside');
  for (const a of ['role', 'tabindex', 'aria-label']) card.removeAttribute(a);
  card.querySelector('.space-choice-actions').hidden = true;
  card.querySelector('.sdk-members').hidden = true;
  card.querySelector('.space-choice-count').textContent = '';
  card.querySelector('.space-choice-name').textContent = r.name;
  const desc = card.querySelector('.space-choice-desc');
  desc.textContent = r.description || '';
  desc.hidden = !r.description;
  const img = card.querySelector('.space-choice-image');
  const src = r.hasImage ? `/img/space/${encodeURIComponent(r.id)}` : '';
  img.hidden = !src;
  if (src && img.dataset.src !== src) { img.dataset.src = src; img.src = src; }
  const pending = r.request === 'pending';
  const declined = !pending && r.answer === 'denied';
  card.querySelector('[data-ask-box]').hidden = false;
  card.querySelector('[data-ask]').hidden = pending || declined;
  card.querySelector('[data-withdraw]').hidden = !pending;
  const state = card.querySelector('[data-ask-state]');
  state.textContent = pending ? 'Requested' : declined ? 'Declined' : '';
  state.hidden = !state.textContent;
}
async function askAccess(card, method) {
  const id = card.dataset.space;
  const buttons = card.querySelectorAll('[data-ask], [data-withdraw]');
  buttons.forEach((b) => { b.disabled = true; });
  try {
    await api(method, `/api/spaces/${encodeURIComponent(id)}/request`);
  } catch (err) {
    noticeToast(err.message || "Couldn't send that. Try again.", { kind: 'danger' });
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
  await loadPresence();
}

// The row above the space cards (GitHub #233): the home word with its icon, and "Add <space>" for those who may make
// one (owners and the admin, as the top bar's "New <space>" entry decides: hasOwnerRights). Never for a guest.
function renderSpaceListHead() {
  const title = $('space-list-title');
  if (!title) return;
  const homeIcon = document.querySelector('[data-brand="home-icon"]')?.dataset.iconId || 'couch';
  title.innerHTML = `<i class="${escapeHtml(iconClasses(homeIcon))} fa-fw" aria-hidden="true"></i> `;
  title.append(document.createTextNode(word('home')));
  const button = $('home-add-space');
  const label = `Add ${word('space', { cap: true })}`;
  $('home-add-space-label').textContent = label;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.hidden = Boolean(guestMode) || !hasOwnerRights(me);
  // The Modules column's heading (plan-home-lobby.md, decision 11): the module word, the template's when it sets one.
  const modules = $('home-modules-title');
  if (modules) {
    modules.innerHTML = '<i class="fa-solid fa-puzzle-piece fa-fw" aria-hidden="true"></i> ';
    modules.append(document.createTextNode(word('module', { many: true, cap: true })));
  }
}
// Add <space>: the request Manage's Add button makes (POST /api/spaces, named "<Space> N"), then straight into the new
// space with Set up open, so it can be named and set up at once. A failure is said where a join's is.
async function addSpace() {
  const button = $('home-add-space');
  if (button.disabled) return;
  button.disabled = true;
  $('join-error').hidden = true;
  try {
    const count = presenceSpaces.filter((r) => r.mine && !r.isAside).length;
    const { space } = await api('POST', '/api/spaces', { name: `${word('space', { cap: true })} ${count}`, description: '', members: [] });
    await loadPresence(); // the new card, and the record join() reads the name from
    await joinInvitedSpace(space.id);
    if (entered && currentSpace?.id === space.id) enterSetup();
  } catch (err) {
    $('join-error').textContent = err.message;
    $('join-error').hidden = false;
  } finally {
    button.disabled = false;
  }
}
$('home-add-space')?.addEventListener('click', addSpace);

// hereCount() (primary-nav.js, held by check-nav): "3 here · 2 in the call", leaving out those stepped out into an aside.
// `isAside`: the card is an aside's, whose own people read `aside: true` and are in it.
function renderMembers(list, members, spaceId, isAside = false) {
  const keep = new Set();
  for (const u of members) {
    keep.add(u.key);
    let el = list.querySelector(`[data-key="${CSS.escape(u.key)}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'sdk-member';
      el.dataset.key = u.key;
      const img = document.createElement('img');
      img.alt = '';
      img.className = 'sdk-member-pic';
      const dot = document.createElement('span');
      dot.className = 'sdk-member-dot';
      const name = document.createElement('span');
      name.className = 'sdk-member-name';
      el.append(img, dot, name);
      list.appendChild(el);
    }
    const here = isHere(u, spaceId, { aside: isAside });
    // The same set the conference shows for this space, Online or Offline.
    const img = el.querySelector('img');
    const slot = conferenceSlot(spaceId, !here);
    if (img.dataset.slot !== slot) {
      img.dataset.slot = slot;
      const profile = imgUrl(u.key, 'profile');
      img.onerror = () => { img.onerror = null; img.src = profile; };
      img.src = spaceId && spaceId !== LOBBY && !u.key.startsWith(GUEST_PREFIX) ? imgUrl(u.key, slot, { space: spaceId }) : profile;
    }
    el.querySelector('.sdk-member-name').textContent = u.displayName;
    el.querySelector('.sdk-member-dot').hidden = !here; // the online dot; an offline person has none
    // In the call: a small mark beside the online dot, with its own words, never the colour alone.
    const calling = here && Boolean(u.inCall);
    let mark = el.querySelector('.call-mark');
    if (calling && !mark) {
      mark = document.createElement('span');
      mark.className = 'call-mark';
      mark.setAttribute('role', 'img');
      mark.innerHTML = '<i class="fa-solid fa-video" aria-hidden="true"></i>'; // the same mark as Who's around
      el.querySelector('.sdk-member-dot').after(mark);
    } else if (!calling && mark) {
      mark.remove();
    }
    if (mark && calling) {
      mark.title = `${u.displayName} is in the call`;
      mark.setAttribute('aria-label', 'In the call');
    }
    // Where they are instead (whereWords, primary-nav.js): in an aside or a private conversation (who with is not said
    // here; checked first, since someone stepped out reads as their parent space's id), a space of mine, or one I can't see.
    const there = u.online && !here && !u.aside && !u.elsewhere ? presenceSpaces.find((r) => r.id === u.space) : null;
    const where = !u.online || here ? '' : there && !there.isAside ? `in ${spaceDisplayName(there)}` : whereWords(u, presenceSpaces, { aside: word('aside', { a: true }), space: word('space') });
    el.title = calling ? `${u.displayName} is here, in the call` : here ? `${u.displayName} is here` : where ? `${u.displayName} is ${where}` : u.displayName;
    // Off stream: this member is online but not in the space the stream
    // currently hears (wherever the owner actually is); "aside" is the
    // more specific case of a pulled-aside private word, which implies off
    // stream too. Only meaningful when an owner is actually online -- with
    // none, activeSpace is just the Lobby fallback, not a real "here's where
    // the stream is" signal, so nobody should read as off stream against it.
    // offStream() is primary-nav.js's: activeSpace null is a stream somewhere I can't see.
    const asideNow = u.online && (Boolean(u.aside) || presenceSpaces.find((r) => r.id === u.space)?.isAside);
    const offTheStream = offStream(u, activeSpace, ownerOnline, presenceSpaces.filter((r) => r.isAside).map((r) => r.id));
    let badge = el.querySelector(':scope > .sdk-chip-tag');
    if (asideNow || offTheStream) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'sdk-chip-tag';
        el.appendChild(badge);
      }
      badge.textContent = asideNow ? word('aside') : 'off stream';
      if (asideNow) badge.dataset.tone = 'info';
      else delete badge.dataset.tone;
    } else if (badge) {
      badge.remove();
    }
  }
  for (const el of [...list.children]) if (!keep.has(el.dataset.key)) el.remove();
}
setInterval(() => {
  if (!$('join').hidden || document.body.classList.contains('in-space')) loadPresence();
}, 5000);
$('spaces').addEventListener('click', (event) => {
  const asking = event.target.closest('.space-choice.requestable');
  if (asking) { // a space I may only ask to enter: its two buttons, nothing else
    if (event.target.closest('[data-ask]')) askAccess(asking, 'POST');
    else if (event.target.closest('[data-withdraw]')) askAccess(asking, 'DELETE');
    return;
  }
  if (event.target.closest('a, button:not([data-join])')) return; // the link and Set up do their own thing
  const card = event.target.closest('.space-choice[data-space]');
  if (card && card.classList.contains('joinable')) { if (event.target.closest('[data-join]')) joinOpenSpace(card.dataset.space, event.target.closest('[data-join]')); return; }
  if (!card || (card.classList.contains('aside') && !event.target.closest('[data-join]'))) return;
  enterFromCard(card.dataset.space);
});
// Enter or Space on the focused card itself (not on a control inside it) does what pressing it does.
$('spaces').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const card = event.target;
  if (!card.matches?.('.space-choice[role="button"]')) return;
  event.preventDefault();
  enterFromCard(card.dataset.space);
});
// Join a space I may enter: the server adds me, then it is one of mine (Enter) on the next list.
async function joinOpenSpace(spaceId, button) {
  button.disabled = true;
  try {
    await api('POST', `/api/spaces/${encodeURIComponent(spaceId)}/join`);
    await loadPresence();
  } catch (err) {
    $('join-error').textContent = err.message || "Couldn't join. Try again.";
    $('join-error').hidden = false;
  } finally {
    button.disabled = false;
  }
}
function enterFromCard(spaceId) {
  if (entered && currentSpace?.id === spaceId) returnToCanvas();
  else if (entered) reconnectTo(spaceId);
  else join(spaceId);
}
// The texts a guest agrees to by typing their name (TERMS_FILE, NDA_FILE), shown on a guest link's form: drawn as text,
// never as markup. The versions go with the name; the server records them.
let guestDocs = [];
async function showGuestDocs() {
  try {
    const a = await api('GET', '/api/agreements');
    guestDocs = a.required && Array.isArray(a.docs) ? a.docs : [];
  } catch { guestDocs = []; }
  const box = $('guest-docs');
  box.textContent = '';
  for (const d of guestDocs) {
    const h = document.createElement('h2');
    h.textContent = d.title || d.id;
    box.append(h);
    for (const part of String(d.text || '').split(/\n{2,}/)) {
      if (!part.trim()) continue;
      const p = document.createElement('p');
      p.textContent = part.trim();
      box.append(p);
    }
  }
  box.hidden = $('guest-docs-note').hidden = !guestDocs.length;
}
$('guest-join').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('guest-join-error').hidden = true;
  const name = $('guest-name').value.trim();
  if (!name) return;
  const submit = $('guest-join').querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const { spaceId: joinedId, spaceName: joinedName, permissions, guest } = await api('POST', '/api/guest-join', { token: guestToken, name, ...(guestDocs.length ? { versions: Object.fromEntries(guestDocs.map((d) => [d.id, d.version])) } : {}) });
    me = { key: guest.id, displayName: guest.name, role: 'guest', permissions };
    guestPass = guest.pass;
    setGuestPass(guestToken, guestPass); // the module host's stream and live messages know this guest by it
    await joinAsGuest(joinedId, joinedName);
  } catch (err) {
    if (err.status === 409) await showGuestDocs(); // the text changed: shown again, to read
    $('guest-join-error').textContent = err.message;
    $('guest-join-error').hidden = false;
  } finally {
    submit.disabled = false;
  }
});
let unread = 0;
let assistantNew = 0; // the Assistant's new results (chat-input.js), for the rail
let chatViews = null; // chat-input.js's views, once attached (the column and the canvas may ask before)
let pipWindow = null;

// --- Chat's status area (the line under the composer, GitHub #330) ---
// The call on the left (In a call and its time, or empty; a problem replaces it), the latest notice on the right (an error, the
// AI's state, what a command did). Notices that used to sit in the message list or in the call's status come here.
let chatStream = ''; // the live stream's state ('live', 'reconnecting', 'paused', 'link-off' for a guest, or '')
let chatNoteFn = null; // chat-input.js's note, once attached
let chatNoteTimer = null;
// The left side says only what the person needs: "In a call" with the call's time while in one, nothing otherwise, and a
// problem in plain words with the fix.
function chatConnState() {
  if (chatStream === 'link-off') return 'link-off';
  if (chatStream === 'paused') return 'paused';
  if (chatStream === 'reconnecting') return 'reconnecting';
  if (inCall && call.state === 'connected') return 'call';
  return 'idle';
}
function paintChatTime() {
  const el = $('chat-conn-time');
  if (!el) return;
  const inCall = chatConnState() === 'call';
  const seconds = callTimeStart ? Math.max(0, Math.floor((Date.now() - callTimeStart) / 1000)) : 0;
  const text = inCall && callTimeStart ? ` · ${callTime(seconds)}` : '';
  if (el.textContent !== text) el.textContent = text;
}
function paintChatConn() {
  const text = $('chat-conn-text');
  if (!text) return;
  const state = chatConnState();
  const look = {
    call: ['In a call', 'phone', ''],
    reconnecting: ['Reconnecting… messages may be late', 'rotate', 'Finding its way back. Nothing to do; wait a moment.'],
    paused: ['Paused. Reload to see new messages', 'circle-pause', 'Live updates are paused. Reload the page to try again.'],
    'link-off': [`This ${word('guest')} link was turned off`, 'link-slash', `Ask for a new ${word('guest')} link to come back in.`],
    idle: ['', '', ''],
  }[state];
  if (text.textContent !== look[0]) text.textContent = look[0];
  const item = $('chat-conn');
  item.title = look[2];
  item.classList.toggle('error', state === 'paused' || state === 'link-off');
  $('chat-conn-icon').className = look[1] ? `fa-solid fa-${look[1]} fa-fw` : 'fa-solid fa-fw';
  paintChatTime();
}
// A notice for the status area: it clears itself after a while. Before Chat is attached it goes to the call's status.
function chatNotice(text, error = false) {
  if (!chatNoteFn) { setStatus(text, error); return; }
  chatNoteFn(text, error);
  clearTimeout(chatNoteTimer);
  if (text) chatNoteTimer = setTimeout(() => chatNoteFn(''), 15000);
}

function setStatus(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
  // The page header shows the same status, except the plain "in <space>"
  // which the space name next to the brand already says.
  const top = $('topbar-status');
  top.textContent = !error && text === `in ${spaceName}` ? '' : text;
  top.classList.toggle('error', error);
}

// --- tiles -------------------------------------------------------------------

// While the camera is off, a chosen background image (the same one used
// live when the camera is on -- see space.js's video settings) shows behind
// the profile photo too, instead of a plain fill, so the box looks like
// them even without video.
function updateBackgroundPlaceholder(tile, key) {
  const user = presenceUsers.get(key);
  const hasBg = !!user?.images?.background;
  tile.classList.toggle('has-bg-image', hasBg);
  const bg = tile.querySelector('.placeholder-bg');
  // removeAttribute, not src='' -- an empty string still makes the browser
  // fetch the current page as an "image" and show a broken-image icon once
  // it fails to decode; only actually removing the attribute stays invisible.
  if (bg) { if (hasBg) bg.src = imgUrl(key, 'background'); else bg.removeAttribute('src'); }
  tile.style.setProperty('--pic-scale', user?.pictureScale || 100);
}

// Admin only, on hover: mute (toggles, reading the live mic state fresh on
// each click rather than tracking our own copy of it) and kick. Neither
// touches this browser's own call state, so no local UI besides the tile
// itself needs updating -- the space's own presence/track events do that.
// What I can do here: everything as an admin; otherwise the space's own
// effective set (my role's permissions plus anything ticked for me in that
// space, see Settings > Roles and profile > Spaces), or just my role's
// outside a space the server has no per-space entry for (an aside, a guest).
const CHAT_PERMISSIONS = ['chatRead', 'chat', 'sendPictures'];
function canDo(permission) {
  if (inAside() && CHAT_PERMISSIONS.includes(permission)) return false; // an aside has no chat and no chat pictures, for anyone
  if (hasOwnerRights(me)) return true;
  const inSpace = currentSpace && me?.spaces?.[currentSpace.id]?.effective;
  return !!(inSpace || me?.permissions || {})[permission];
}
// Everything a permission hides or shows on the page. Reruns once who I am
// and which space I'm in are both known, not just at load.
function applyPermissions() {
  applyFeatureFlags();
  syncCallControl();
  $('chat-form').hidden = !canDo('chat');
  $('chat-pic').hidden = !canDo('sendPictures');
}

function adminToolsFor(participant) {
  const tools = document.createElement('div');
  tools.className = 'tile-admin-tools';
  // Muting is a real server-side toggle, but LiveKit has no "remote
  // unmute" -- only the participant's own client can turn their mic back
  // on, so offering it here just fails ("remote unmute not enabled").
  // The button only ever mutes; once muted, updateMuted() hides it and
  // whoever's muted has to unmute themselves.
  const mute = document.createElement('button');
  mute.type = 'button';
  mute.dataset.action = 'mute';
  mute.className = 'tile-admin-btn';
  mute.dataset.tip = 'Mute';
  mute.setAttribute('aria-label', mute.dataset.tip);
  mute.hidden = participant.getTrackPublication(Track.Source.Microphone)?.isMuted ?? false;
  mute.innerHTML = '<i class="fa-solid fa-microphone-slash fa-fw" aria-hidden="true"></i>';
  mute.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await api('POST', `/api/users/${encodeURIComponent(participant.identity)}/mute`, { muted: true });
    } catch (err) {
      setStatus(`mute: ${err.message}`, true);
    }
  });
  const kick = document.createElement('button');
  kick.type = 'button';
  kick.className = 'tile-admin-btn danger';
  kick.dataset.tip = 'Kick';
  kick.setAttribute('aria-label', kick.dataset.tip);
  kick.innerHTML = '<i class="fa-solid fa-user-slash fa-fw" aria-hidden="true"></i>';
  kick.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!await confirmDialog({ title: `Kick ${participant.name || participant.identity} from the call?`, message: 'They can rejoin.', action: 'Kick', kind: 'destructive' })) return;
    try {
      await api('POST', `/api/users/${encodeURIComponent(participant.identity)}/kick`);
    } catch (err) {
      setStatus(`kick: ${err.message}`, true);
    }
  });
  if (canDo('canMute')) tools.append(mute);
  if (canDo('canKick')) tools.append(kick);
  // Same restriction as the corner step-aside button: you can't step aside
  // from an aside (or private) space, there's nowhere further to go. Each
  // also has its own Manage > Settings toggle, independent of the other.
  const isOwner = hasOwnerRights(me);
  if (isOwner && !currentSpace?.isAside && features.allowAsides) {
    const aside = document.createElement('button');
    aside.type = 'button';
    aside.className = 'tile-admin-btn';
    aside.dataset.tip = 'Step aside';
    aside.setAttribute('aria-label', aside.dataset.tip);
    aside.innerHTML = '<i class="fa-solid fa-people-arrows fa-fw" aria-hidden="true"></i>';
    aside.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!await confirmDialog({ title: `Step aside with ${participant.name || participant.identity}?`, action: 'Step aside' })) return;
      pullAside([participant.identity]);
    });
    tools.append(aside);
  }
  if (isOwner && !currentSpace?.isAside && features.allowPrivate) {
    const priv = document.createElement('button');
    priv.type = 'button';
    priv.className = 'tile-admin-btn';
    priv.dataset.tip = 'Privately';
    priv.setAttribute('aria-label', priv.dataset.tip);
    priv.innerHTML = '<i class="fa-solid fa-user-lock fa-fw" aria-hidden="true"></i>';
    priv.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!await confirmDialog({ title: `Have a private word with ${participant.name || participant.identity}?`, action: 'Go private' })) return;
      pullAside([participant.identity], true);
    });
    tools.append(priv);
  }
  return tools;
}

// A tile exists only while I am in the conference and the person is too: everyone at the call service is on the call
// (the server mints its token only for a join), and an OBS viewer there is hidden.
const shownInCall = () => inCall;
const subscribeAll = (participant) => { for (const pub of participant.trackPublications.values()) pub.setSubscribed(true); };

function tileFor(participant) {
  let tile = tiles.get(participant.identity);
  if (tile) return tile;
  removeGhost(participant.identity); // they're back live, the placeholder can go
  tile = document.createElement('div');
  tile.className = 'tile';
  tile.dataset.identity = participant.identity;
  const placeholderBg = document.createElement('img');
  placeholderBg.className = 'placeholder-bg';
  placeholderBg.alt = '';
  tile.appendChild(placeholderBg);
  const placeholder = document.createElement('img');
  placeholder.className = 'placeholder';
  placeholder.alt = '';
  showConferencePortrait(placeholder, participant.identity);
  const colour = presenceUsers.get(participant.identity)?.borderColor;
  if (colour) tile.style.setProperty('--talk', colour);
  tile.appendChild(placeholder);
  updateBackgroundPlaceholder(tile, participant.identity);
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = participant.name || participant.identity;
  tile.appendChild(name);
  if (!participant.isLocal) {
    const vol = document.createElement('input');
    vol.type = 'range';
    vol.className = 'vol';
    vol.min = '0';
    vol.max = '100';
    vol.value = String(Math.round((prefs.volumes[participant.identity] ?? 1) * 100));
    vol.title = 'Volume';
    vol.addEventListener('input', () => setVolume(participant, Number(vol.value) / 100));
    vol.addEventListener('click', (e) => e.stopPropagation());
    vol.addEventListener('pointerenter', () => (tile.draggable = false));
    vol.addEventListener('pointerleave', () => (tile.draggable = true));
    tile.appendChild(vol);
    // An admin has Step Aside/Privately right in the hover tools below, one
    // click each -- this corner button (pick one or more, then confirm) is
    // only still needed for a non-admin, who has no other way to invite
    // someone for a private word.
    if (!currentSpace?.isAside && !hasOwnerRights(me) && ((features.allowPrivate && canDo('privateCall')) || (features.allowAsides && canDo('startAside')))) {
      const aside = document.createElement('button');
      aside.type = 'button';
      aside.className = 'tile-aside';
      aside.title = `Have a private word with ${participant.name || participant.identity} (pick one or more, then confirm)`;
      aside.innerHTML = '<i class="fa-solid fa-people-arrows" aria-hidden="true"></i>';
      aside.classList.toggle('selected', asideSelection.has(participant.identity));
      aside.addEventListener('click', (e) => { e.stopPropagation(); toggleAsideSelection(participant.identity, aside); });
      tile.appendChild(aside);
    }
    // Mute/Kick for owners, or for a member granted them in this space --
    // never against an owner (the server refuses that anyway).
    const targetIsOwner = presenceUsers.get(participant.identity)?.isOwner;
    if (hasOwnerRights(me) || (!targetIsOwner && (canDo('canMute') || canDo('canKick')))) {
      const tools = adminToolsFor(participant);
      tools.addEventListener('pointerenter', () => (tile.draggable = false));
      tools.addEventListener('pointerleave', () => (tile.draggable = true));
      tile.appendChild(tools);
    }
  }
  tile.draggable = true;
  tile.addEventListener('dragstart', onDragStart);
  tile.addEventListener('dragover', onDragOver);
  tile.addEventListener('drop', onDrop);
  tile.addEventListener('dragend', onDragEnd);
  tile.addEventListener('click', () => spotlight(participant.identity));
  tiles.set(participant.identity, tile);
  showAway(participant); // someone already away when their tile is made (a late join, a reload)
  placeInOrder(tile);
  applyLayout();
  return tile;
}

// A shared screen gets its own tile, separate from the sharer's camera one
// -- someone can keep their camera up while sharing, and both stay visible.
function screenTileId(identity) {
  return `${identity}::screen`;
}
function screenTileFor(participant) {
  const key = screenTileId(participant.identity);
  let tile = tiles.get(key);
  if (tile) return tile;
  tile = document.createElement('div');
  tile.className = 'tile tile-screen';
  tile.dataset.identity = key;
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = `${participant.name || participant.identity}'s screen`;
  tile.appendChild(name);
  if (document.pictureInPictureEnabled) {
    const pip = document.createElement('button');
    pip.type = 'button';
    pip.className = 'tile-pip';
    pip.dataset.tip = 'Pop out this screen share';
    pip.setAttribute('aria-label', pip.dataset.tip);
    pip.innerHTML = '<i class="fa-solid fa-up-right-from-square" aria-hidden="true"></i>';
    pip.addEventListener('click', (e) => {
      e.stopPropagation();
      const video = tile.querySelector('video');
      if (!video) return;
      (document.pictureInPictureElement === video ? document.exitPictureInPicture() : video.requestPictureInPicture()).catch(() => {});
    });
    tile.appendChild(pip);
  }
  tile.addEventListener('click', () => spotlight(key));
  tiles.set(key, tile);
  $('grid').appendChild(tile);
  applyLayout();
  syncShareLift(); // a share lifts the conference out of the column (plan-one-bar.md, step 6)
  return tile;
}
function removeScreenTile(identity) {
  const key = screenTileId(identity);
  const tile = tiles.get(key);
  if (!tile) return;
  if (document.pictureInPictureElement && tile.contains(document.pictureInPictureElement)) {
    document.exitPictureInPicture().catch(() => {});
  }
  tile.remove();
  tiles.delete(key);
  applyLayout();
  syncShareLift(); // the last share ending puts the conference back in the column
}

// --- layouts and ordering -----------------------------------------------------

const DEFAULT_PREFS = {
  layout: 'grid', order: [], pinned: null, follow: true,
  micId: '', camId: '', gain: 100, gate: 0, noise: true, echo: true, agc: true, ptt: false,
  quality: 720, mirror: true, background: 'none', volumes: {}, popout: null, deafened: false,
  chatWidth: 320, stripHeight: 168, speakerId: '', masterVolume: 100, // chatWidth is the column's width too (the splitter)
  homeChatWidth: 360, // Home's chat column (plan-home-lobby.md, step 3), its own width
  // Where the call sits in the column (Call position): its 'top', 'bottom' or 'left' (beside the chat, in a column wide
  // enough); callFloat, floating over the Workspace instead (from the column's side it goes back to). Its own window is
  // never remembered (a window opens only from a click). callSideWidth: the call's width beside the chat (Left). The
  // tiles always show in the column (Thomas, 2026-10-14: no hiding the video); a `callTiles` stored before then is
  // ignored.
  callPosition: 'top', callFloat: false,
  callSideWidth: 320,
  pttKey: 'Space', muteKey: 'Mod+KeyD', camKey: 'Mod+KeyE',
};
// Call preferences (layout, devices, volumes, keys). brand.js moves the key they had before the Names plan on load.
const PREFS_KEY = 'app.call';
const prefs = loadPrefs();
// The Layout menu's note (canvas.js's onNote): written in the menu's last row, where it is seen. A note from docking with
// the menu closed (Join the call, a titlebar's Dock, a module's own window coming back) would sit unheard out of the
// page, so then the same sentence goes to a visually hidden status region of the page's own, outside the menu.
// Decided once the click that wrote it is over, since that click may be the one closing the menu; never both, so a screen
// reader hears it once.
let layoutAnnouncer = null;
let noteUnderFavorites = false; // a load from a layout tab: its note shows under the tabs too (showFavoritesNote)
function layoutNote(text) {
  const t = text || '';
  menuNote.textContent = t;
  if (noteUnderFavorites && t) showFavoritesNote(t);
  setTimeout(() => {
    const menuOpen = canvas.menuOpen();
    const doc = moduleChooser.ownerDocument;
    if (!layoutAnnouncer || layoutAnnouncer.ownerDocument !== doc) {
      layoutAnnouncer?.remove();
      layoutAnnouncer = doc.createElement('div');
      layoutAnnouncer.id = 'layout-announce';
      layoutAnnouncer.className = 'visually-hidden';
      layoutAnnouncer.setAttribute('role', 'status');
      doc.body.appendChild(layoutAnnouncer);
    }
    layoutAnnouncer.textContent = menuOpen ? '' : t;
  }, 0);
}
// The space's canvas: the Modules menu and every module open on it, docked, floating or in a window.
let askInChat = null;
let attachInChat = null;
let paintCallTab = () => {}; // the phone's call item (Online), set with who is here below
let micLive = false; // the microphone is live (reflectMic): the call item says so on a phone
const canvas = createCanvas({
  guestToken,
  guest: guestMode, // a door guest has no token to send, but is a guest
  onNote: (text) => layoutNote(text),
  onPopBlocked: () => setStatus(POPUP_BLOCKED, true),
  // The Layouts section is read again each time the menu opens, and drawn from layoutMenuItems() with the note last.
  onMenu: (open) => { if (open) refreshLayouts(); },
  onArrange: () => arrangementChanged(),
  menuItems: () => layoutMenuItems(),
  noteEl: menuNote,
  // A composite's page (the Calendar and Map tabs' too) gets the handoff a page over the call gets, and its links home
  // stay in this page (overlayParams, homeLinksIn, below).
  frameParams: () => (guestMode ? new URLSearchParams() : overlayParams()),
  onCompositeLoad: (frame) => homeLinksIn(frame),
  onTabs: () => paintCallTab(), // the phone's tabs are new: Online, the call item, says whether the call is the view
  onChatAsk: (input) => {
    if (!askInChat) return Promise.reject(Object.assign(new Error('Chat is not ready.'), { status: 400 }));
    toggleChat(true);
    return askInChat(input);
  },
  // host.chat.attach: the chip goes in Chat's box and nothing is sent; the person's Send sends it.
  onChatAttach: (input) => {
    if (!attachInChat) return Promise.reject(Object.assign(new Error('Chat is not ready.'), { status: 400 }));
    // Someone busy in the page (typing, or in a form) keeps their view and their cursor: the chip is held and says so in Chat.
    if (!chatInput.attachBusy()) {
      toggleChat(true);
      canvas.show('chat'); // on a phone Chat is a tab: bring it forward, as its tab does
    }
    return attachInChat(input);
  },
});
window.hostModules = canvas; // for debugging and tests

// The space's actions, in the right zone: one group in the bands plan-nav.md sets out (full screen and pop out
// secondary, the aside's two utility), and Leave last on its own, a divider before it. Registered here, after the
// state their `visible` functions read exists. Full screen, Pop out and Pull participants back are Workspace tools
// (nav-bar.js, `workspace`): wider than a phone the registry draws them in the top bar's right zone, Full screen and
// Pop out last of all, right of your picture (`place: 'end'`; Thomas, 2026-10-13: as in his drawing), Pull
// participants back before Set up; they fold into the top bar's "..." (Pop out, then Full screen first),
// the first two on every layout tab, not in an aside; on a phone (plan-phone-space-bar.md) they are the tab bar's: Leave and
// Rejoin call stay in it (`phone: 'bar'`), Full screen and Pop out are in its "..." only in a narrow popped-out window
// (`phone: 'popout'`), and the rest goes into the "...".
const SPACE_TOOL = { bar: 'secondary', zone: 'right', group: 'space', groupOrder: 1 };
// A tool's part in the call, for the tab bar's colours on a phone (system.css, tabbar block: data-role join or leave).
function tabRole(id, role) {
  const el = nav.elementOf(id);
  if (el) el.dataset.role = role;
}
nav.register({ ...SPACE_TOOL, id: 'fullscreen-toggle', order: 11, icon: 'expand', activeIcon: 'compress', label: 'Full screen', title: 'Full screen (F)', activeLabel: 'Exit full screen', phone: 'popout', workspace: 'only', place: 'end', toggleable: true, active: false, onClick: () => toggleFullscreen() });
nav.register({ ...SPACE_TOOL, id: 'popout', order: 12, icon: 'up-right-from-square', activeIcon: 'window-restore', label: 'Pop out into its own window', activeLabel: 'Pop it back in', phone: 'popout', workspace: 'only', place: 'end', toggleable: true, active: false, onClick: () => (pipWindow ? closePopout() : openPopout()) });
// The tools whose words are the environment's: registered again (the same elements) once loadBranding() has them.
function registerWordTools() {
  nameModuleChooser();
  paintSetupLabel();
  if (nav.get('module-chooser')) nav.register({ ...nav.get('module-chooser'), label: word('module', { many: true, cap: true }) });
  nav.register({ ...SPACE_TOOL, id: 'recall-button', order: 51, icon: 'people-arrows', label: 'Pull participants back', title: `Give everyone in a Private Conversation from this ${word('space')} a 10 second warning, then pull them back`, labelled: true, workspace: 'every', visible: () => recallWanted(), onClick: recallParticipants });
  // Leave is in the space bar only where the bar is the phone's tab bar (plan-one-bar.md, step 5 and decision 3); wider,
  // it is the last entry of the top bar's space switcher (brand.js, through app:enter-space { action: 'leave' } below).
  nav.register({ bar: 'secondary', zone: 'right', group: 'leave', groupOrder: 999, id: 'leave-space', order: 999, phone: 'bar', short: 'Leave', icon: 'right-from-bracket', label: `Leave ${word('space')}`, visible: () => phoneWidth(), onClick: () => leaveSpace() });
  tabRole('leave-space', 'leave'); // the readable red in the tab bar
}
registerWordTools();
// Rejoin call is the tab bar's; wider than a phone the top bar has its own (aside-rejoin, the one bar section below).
nav.register({ ...SPACE_TOOL, id: 'rejoin-call', order: 52, phone: 'bar', short: 'Rejoin', icon: 'circle-left', label: 'Rejoin call', visible: () => Boolean(currentSpace && currentSpace.isAside && currentSpace.origin) && phoneWidth(), onClick: () => returnFromAside() });
tabRole('rejoin-call', 'join'); // the call's ok colour in the tab bar
// On a phone the header's links are a menu (see brand.js), and the call's settings would otherwise
// only be reachable from the Conference view's toolbar. This tool, in the menu only (its class, see style.css) and
// only while in the call, shows the conference and opens them. It sits in the session group, ahead of the clock.
nav.register({
  id: 'call-settings', bar: 'primary', zone: 'right', group: 'session', order: 50, icon: 'sliders', label: 'Call settings',
  visible: () => inCall && !guestMode && canDo('canInvite'),
  onClick: () => {
    canvas.showBuiltin('conference'); // shows the conference view
    setTimeout(() => { if ($('settings').hidden || $('settings').dataset.group !== 'more') openSettings('more'); }, 50);
  },
}).classList.add('call-settings-link');
topbarEl.querySelector('#nav-toggle')?.addEventListener('click', () => nav.draw('primary'));

// --- the live stream (space-live.js; plan-realtime-optional-livekit.md, steps 2 and 3) ------------------------------
// One per page. In a space (or an aside) from entering it until leaving it (step 5): entering is opening it (join() and
// joinAsGuest() wait for its first `ready`, the server's yes, or its refusal, which is the entry's error), and leaving
// or moving (leaveSpaceNow, reconnectTo()) closes it; the call service has no part in either. On Home, signed in and
// allowed to read the chat, one in no space (syncHomeChatStream), for Home's chat. Its `presence` is who is here, the
// conference's "Not in a call" list, Start or Join call and the tiles' away; its chat events are the space's chat and
// the Lobby's (Home's chat and its unread count; liveChatNotice); its aside nudges move the page (asideNudge, step 4); a
// kick's `removed` leaves the space (leaveKicked). The page says its own state with PATCH
// /api/spaces/:id/presence: on the call (startCall, stopCall) and away with its message (sendAway, stopCall), and all of
// it again on every `ready` (a reconnect is a new stream, which starts with nothing said). The PATCHes go one after
// another, so a quick Away then Back arrive in that order. A person's key on the stream is their identity on the call (a
// guest's is the id on their pass), so the tiles read away from here too.
let liveStream = null; // openLiveStream's, while in a space or on Home
let liveSpaceId = null; // the space or aside it is for; null on Home
let livePeopleList = []; // the last presence event's people, as the server sent them
let liveSaying = Promise.resolve(); // the PATCHes, in order
let livePending = null; // the first `ready` an entry waits on (openLive's promise), until it comes or is refused
// My state as the server should have it.
function presenceState() {
  return { onCall: inCall, away: isAway, awayMessage: isAway ? awayMessage : '' };
}
// Say some of it (a PATCH on this stream). Before `ready` nothing is said: ready says all of it.
function sayPresence(patch) {
  const ready = liveStream?.ready;
  if (!ready || !liveSpaceId) return;
  const q = guestToken ? `?${new URLSearchParams({ guest: guestToken })}` : '';
  const url = `/api/spaces/${encodeURIComponent(liveSpaceId)}/presence${q}`;
  const body = { ...patch, stream: ready.stream };
  liveSaying = liveSaying.then(() => api('PATCH', url, body)).catch((err) => console.debug('[app] presence:', err.message));
}
// Asked after a stream that never opened: the status of a fresh request and the server's sentence, to tell a refusal
// (and why) from a drop.
async function liveStreamStatus(url) {
  const ctl = new AbortController();
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'text/event-stream' }, cache: 'no-store' });
    if (res.ok) {
      ctl.abort();
      return { status: res.status };
    }
    const said = await res.json().catch(() => null);
    return { status: res.status, error: typeof said?.error === 'string' ? said.error : '' };
  } catch {
    return { status: 0 };
  }
}
// Open it for a space or an aside, or for Home (spaceId null). Answers a promise: kept at the first `ready`, broken with
// the server's sentence when it is refused before that (entering waits on it). A drop shows "Reconnecting" in Chat's
// status line and each `ready` after the first catches the chat up from the history (nothing is replayed); a refusal
// later, or the server's `removed`, says once that live updates are paused. Posting still works meanwhile.
function openLive(spaceId) {
  closeLive();
  if (typeof EventSource !== 'function') return Promise.resolve();
  liveSpaceId = spaceId;
  livePeopleList = [];
  const first = new Promise((resolve, reject) => { livePending = { resolve, reject }; });
  first.catch(() => {}); // Home's stream is not waited on
  liveStream = openLiveStream({
    url: liveStreamUrl({ space: spaceId, guest: guestToken, pass: guestPass }),
    probe: liveStreamStatus,
    onReady: (_ready, isFirst) => {
      const state = presenceState();
      if (spaceId && (state.onCall || state.away)) sayPresence(state);
      if (!isFirst) catchUpLiveChat();
      livePending?.resolve();
      livePending = null;
    },
    onChat: liveChatNotice,
    onAside: asideNudge,
    onState: (state) => {
      chatStream = state;
      paintChatConn();
    },
    onPresence: (people) => {
      livePeopleList = people;
      syncCallControl();
      for (const [identity] of tiles) {
        const p = call.remoteParticipants.get(identity);
        if (p) showAway(p);
      }
    },
    onEnd: ({ reason, error }) => {
      if (livePending) { // refused before it ever opened: entering failed, with the server's own sentence when it gave one
        livePending.reject(new Error(error || `Could not open this ${word('space')}. Try again in a moment.`));
        livePending = null;
        return;
      }
      if (reason === 'kicked') return leaveKicked();
      console.debug('[app] the live stream ended:', error || 'refused');
      // A guest who lost their access lost their link (turned off, made again, or guests turned off): a reload can't
      // bring it back, so they are told so rather than to reload.
      chatStream = guestToken ? 'link-off' : 'paused';
      paintChatConn();
    },
  });
  return first;
}
function closeLive() {
  livePending?.reject(Object.assign(new Error('closed'), { closed: true })); // an entry still waiting on it gives way
  livePending = null;
  liveStream?.close();
  liveStream = null;
  liveSpaceId = null;
  livePeopleList = [];
  chatStream = '';
  paintChatConn();
}
// My key on the stream: `ready`'s, else (before it, so who is here says "Just you") my own.
const liveYou = () => liveStream?.ready?.you || me?.key || null;
// Who is here, you first: { key, name, you, onCall, away, awayMessage }.
function livePeople() {
  return peopleFromPresence(livePeopleList, { you: liveYou(), youName: me?.displayName || '', meOnCall: inCall });
}
// One person on the stream by key (a tile's identity), or null.
function livePerson(key) {
  return livePeople().find((p) => p.key === key) || null;
}
// Everyone else on the call now, as the stream says.
function liveOthersOnCall() {
  return livePeople().filter((p) => !p.you && p.onCall);
}
// --- end the live stream ---

// Who is in the call, while I am not: the conference's "Not in a call" note lists them, with "Join the call" and the
// microphone note under it. The space bar's call control ("N in the call · Join", plan-entering decisions 2 and 16) is
// gone (Thomas, 2026-09-30): joining lives in the conference, which its switch shows out of the call, and in the space
// bar's Join the call (GitHub #165), which shows the conference and joins in one press.
function syncCallControl() {
  syncWhoIsInCall();
  whoHere.refresh(); // who is here, in the top bar or the phone's tab bar (space-people.js)
  nav.draw('secondary'); // Join the call shows only out of the call
  paintJoinCall();
  paintCallTab(); // and Online is the call item on a phone while on the call
  syncColumn(); // and in the always-on column, where the two are wider than a phone
}
// The conference's "Not in a call" note lists who is in the call now: the live stream's people on the call (what
// /api/presence reports as inCall), with their picture in this space, else their first letter. Kept live by the
// stream's presence (openLive); built only while the note shows.
function syncWhoIsInCall() {
  const list = $('no-call-list');
  if (!list || $('no-call').hidden) return;
  const people = liveOthersOnCall().map((p) => ({ key: p.key, name: p.name }));
  list.replaceChildren(...people.map(({ key, name }) => {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.alt = '';
    img.src = spacePortraitUrl(key);
    const circle = document.createElement('span');
    circle.className = 'sdk-avatar sdk-avatar-24';
    circle.setAttribute('aria-hidden', 'true');
    circle.append(img);
    img.onerror = () => {
      if (img.dataset.fallback) { img.replaceWith(initialOf(name)); return; }
      img.dataset.fallback = '1';
      img.src = imgUrl(key, 'profile');
    };
    const label = document.createElement('span');
    label.textContent = name;
    li.append(circle, label);
    return li;
  }));
  list.hidden = people.length === 0;
  $('no-call-empty').hidden = people.length > 0;
}
function initialOf(name) {
  const el = document.createElement('span');
  el.className = 'sdk-avatar-ini';
  el.textContent = String(name || '?').trim().charAt(0).toUpperCase() || '?';
  return el;
}

// --- Join the call (GitHub #165) ---------------------------------------------------------------------
// In the space bar's left zone, after Layout and before Online: one press shows the Conference (as its Show switch
// does) and joins, through joinTheCall(), the same startCall() the conference's own "Join the call" uses. Shown only
// while connected to a space (or an aside: there the call is the aside's), out of the call, and where this person may
// see the conference; Leave and the conference's own Hang up end the call as before. On a phone it is a tab in the tab
// bar, between the module tabs and Online's count, reading "Join".
const joinCallButton = document.createElement('button');
joinCallButton.type = 'button';
joinCallButton.id = 'join-call';
joinCallButton.className = 'btn btn-small btn-primary join-call nav-text'; // the nav text's type, the accent button's colours
joinCallButton.setAttribute('aria-label', 'Start call');
joinCallButton.title = 'Start a call from this chat';
joinCallButton.dataset.role = 'join'; // on a phone a tab whose phone is in the call's ok colour (system.css, tabbar block)
joinCallButton.innerHTML = '<i class="fa-solid fa-phone fa-fw" aria-hidden="true"></i> <span class="join-call-label sdk-tabbar-label"><span class="join-call-verb">Start</span><span class="join-call-more"> call</span></span>';
// "Start call" while no one is in the call, "Join call" while one is running (the live stream's people on the call, as
// the conference's note lists them).
function paintJoinCall() {
  const running = liveOthersOnCall().length > 0;
  const verb = running ? 'Join' : 'Start';
  joinCallButton.querySelector('.join-call-verb').textContent = verb;
  joinCallButton.setAttribute('aria-label', `${verb} call`);
  joinCallButton.title = running ? 'Join the call that is running' : 'Start a call from this chat';
}
joinCallButton.addEventListener('click', () => joinTheCall());
// Not while Home's chat shows (GitHub #326): a call belongs to a space, and Home is only a view over it.
const joinCallWanted = () => Boolean(currentSpace) && !homeChatSpace && entered && !inCall
  && conferenceAllowed({ callService: features.callService, conferenceEnabled: features.conferenceEnabled, permitted: canDo('conference') });
nav.register({ bar: 'secondary', zone: 'left', group: 'call', groupOrder: 1.5, id: 'join-call', order: 1, icon: 'phone', label: 'Start call', element: joinCallButton, visible: joinCallWanted });
// Entering joins by itself where the environment says so (GitHub #199, branding.autoJoinCall): the rule is
// shouldAutoJoin (opens-with.js, held by check-canvas), asked once by enterSpace() on each entry, and it joins only
// where Join the call would show (joinCallWanted), never in an aside, and not for a person who left the call since they
// entered. The join is the same press as Join the call (joinTheCall), so the microphone, Away and a refusal behave alike.
const autoJoinOnEntry = () => shouldAutoJoin({ setting: features.autoJoinCall, inCall, canJoin: joinCallWanted(), aside: inAside(), left: leftCall });
// --- end Join the call ---

// --- who is here (space-people.js) ------------------------------------------------------------------
// Everyone in this space (or aside) now, you among them, with a mark on those on the call, and the list of them, their
// names and who is on the call, on a press. Live from the live stream's presence (openLive). It belongs to the space, not to
// the call (Thomas, 2026-10-14: "the 'in the room' widget has the context of the space, not the conf window"), so wider
// than a phone it is the top bar's (`whoHereTop`): an element tool at the end of its left zone, after the space switcher
// and the layout tabs, before the Workspace's tools, Layout, the bell and your picture, in a space call or no call, never
// in an aside (the aside's tools leave the top bar too) nor while Home is shown (Home's own Who's around says it there).
// Short of room it gives way first (`yieldFirst`, nav-bar.js's fitLeft), before the favorite tabs: the names become the
// count, portraits drop, then it shows only the icon and the short count. On a phone it is the count in the tab bar,
// before Leave (plan-phone-space-bar.md), in an aside too; its list opens above it there.
const whoHere = createWhoHere({
  people: livePeople,
  where: () => (inAside() ? word('aside') : word('space')),
  portraitUrl: spacePortraitUrl,
  profileUrl: (key) => imgUrl(key, 'profile'),
  wanted: () => Boolean(currentSpace) && entered,
  events: {
    redraw: () => nav.draw(nav.get('who-here')?.bar || 'secondary'),
  },
});
nav.register({ bar: 'secondary', zone: 'left', group: 'people', groupOrder: 2, id: 'who-here', order: 1, fold: false, icon: 'user-group', label: 'Who is here', element: whoHere.el, fit: whoHere.fit, visible: () => Boolean(currentSpace) && entered });
const whoHereBar = nav.get('who-here'); // the phone's, in the tab bar
// On a phone the conference is not a tab: the call is the tab bar's pinned call item (the Tab bar family; Thomas,
// 2026-10-21): Join out of the call, then Online. On the call Online is the call itself: its icon in the call's ok colour
// (the readable red while the microphone is live), current while the conference is the view shown, and a press shows the
// conference when another view is shown (and opens who is here when the conference already is). Out of the call a press
// opens who is here, as wider.
function callTabShown() {
  return phoneWidth() && inCall && canvas.shownView() === 'conference';
}
paintCallTab = () => {
  const toggle = whoHere.el.querySelector('.who-here-toggle');
  if (!toggle) return;
  const phone = phoneWidth();
  toggle.classList.toggle('in-call', phone && inCall);
  toggle.dataset.mic = phone && inCall && micLive ? 'live' : 'off';
  toggle.classList.toggle('on', callTabShown());
};
whoHere.el.addEventListener('click', (event) => {
  if (!phoneWidth() || !inCall || callTabShown() || !event.target.closest('.who-here-toggle')) return;
  event.stopPropagation(); // the conference instead of the list
  canvas.showBuiltin('conference');
  paintCallTab();
}, true);
const whoHereTopWanted = () => Boolean(currentSpace) && !viewingHome && !inAside() && entered && !phoneWidth();
const whoHereTop = { id: 'who-here', bar: 'primary', zone: 'left', group: 'people', groupOrder: 13, order: 1, icon: 'user-group', label: 'Who is here', element: whoHere.el, fit: whoHere.fit, yieldFirst: true, visible: whoHereTopWanted };
// --- end who is here ---

// --- the always-on column (plan-one-bar.md, decision 2 and step 6) ---------------------------------------------
// Wider than a phone, #side-column (space.html) beside the canvas holds the call and the chat in every view: the
// conference as a strip of tiles while on the call (canvas.js puts it in .side-column-strip, in its `column` mode),
// else nothing there; under it Join the call (out of the call), the space bar's own element, taken out of the registry
// and placed here; then the chat (in .side-column-chat). Who is here is the top bar's there (whoHereTop, above). A
// handle collapses the column to a 44px rail (the faces on the call and the chat's unread count), remembered per space
// (localStorage `app.column.<space>`); it never closes. At 640px and below the column is not drawn and both go back to
// the tab bar (decision 3). In an aside the column is the whole screen (decision 10, style.css). A screen share lifts
// the conference into the Workspace as a floating module and back (syncShareLift).
const joinCallTool = nav.get('join-call'); // the registration above, to put back
let columnToolsIn = null; // 'column' or 'bar', where Join the call and Who is here are now
placeColumnTools = () => {
  const wide = !phoneWidth();
  const toColumn = Boolean(columnEl) && wide;
  const where = toColumn ? 'column' : 'bar';
  if (where !== columnToolsIn) {
    columnToolsIn = where;
    if (toColumn) {
      nav.unregister(joinCallTool.id);
      $('chat-views')?.appendChild(joinCallButton); // the right end of the Discussion | Assistant row
    } else if (!nav.get(joinCallTool.id)) nav.register(joinCallTool);
  }
  // Who is here: the top bar's wider than a phone, the tab bar's on a phone (the same element, moved by the registry).
  const people = wide ? whoHereTop : whoHereBar;
  if (nav.get('who-here')?.bar !== people.bar) nav.register(people);
  syncColumn();
};
homeChatChanged = () => { if ($('chat-command-wrap')) $('chat-command-wrap').hidden = Boolean(homeChatSpace); syncColumn(); document.dispatchEvent(new CustomEvent('chat-tools-changed')); }; // no commands on Home
// What the column shows now: Join the call out of the call (its row hidden on the call, with nothing in it), and the
// rail.
function syncColumn() {
  paintJoinCall();
  if (!columnEl || columnToolsIn !== 'column') return;
  joinCallButton.hidden = !joinCallWanted();
  columnEl.classList.toggle('in-call', inCall);
  applyColumnSizes();
  syncRail();
}

// The column's sizes (the splitters, #side-column-splitter and #side-column-strip-splitter in space.html): its width,
// the chat's own preference from before the column (prefs.chatWidth, so a width a person had set holds), between
// COLUMN_MIN and the whole window (Thomas, 2026-10-14: the chat may take all of it; the Workspace then has no room, and
// the handle folds the column away again); and on the call the height of the strip's tiles (prefs.stripHeight), from STRIP_MIN
// up to what leaves the chat its share: the whole call area (the tiles, the toolbar under them and the Join/Online row,
// `chrome` being the last two) is at most CALL_MAX_SHARE of the column, so the chat always keeps at least 45% of it
// (Thomas, 2026-10-14: the video must never squeeze the chat). Untouched (the default height), the call area is at most
// CALL_DEFAULT_SHARE. The tiles always show (Thomas, 2026-10-14: no hiding the video): in a short window they scale down
// to the height they get, and the chat's share holds (style.css, .side-column-chat's min-height). Dragged by pointer or touch; with the keyboard the arrows move by a step, Shift by a bigger one, Home and End to the
// least and the most, double-click or Shift+Enter back to the default. Both are remembered per person. Collapsed, the
// rail is 44px whatever the width, and opening returns to it.
const COLUMN_MIN = 220;
const COLUMN_MAX_SHARE = 1; // of the window: all of it
const STRIP_MIN = 100;
const STRIP_DEFAULT = 168; // DEFAULT_PREFS.stripHeight
const CALL_MAX_SHARE = 0.55; // of the column: the chat keeps the other 45% or more
const CALL_DEFAULT_SHARE = 0.4;
const SPLIT_STEP = 16;
const SPLIT_BIG_STEP = 64;
const clampSplit = (v, min, max) => Math.min(Math.max(Math.round(Number(v) || 0), min), Math.max(min, max));
function clampColumnWidth(w, windowWidth) { return clampSplit(w, COLUMN_MIN, Math.round(windowWidth * COLUMN_MAX_SHARE)); }
function stripMaxHeight(columnHeight, chrome = 0) { return Math.round(columnHeight * CALL_MAX_SHARE) - Math.round(chrome); }
function clampStripHeight(h, columnHeight, chrome = 0) { return clampSplit(h, STRIP_MIN, stripMaxHeight(columnHeight, chrome)); }
// The tiles' height for the person's preference: the default one is held to CALL_DEFAULT_SHARE of the column.
function stripHeightFor(h, columnHeight, chrome = 0) {
  const want = Number(h) === STRIP_DEFAULT ? Math.min(STRIP_DEFAULT, Math.round(columnHeight * CALL_DEFAULT_SHARE) - Math.round(chrome)) : h;
  return clampStripHeight(want, columnHeight, chrome);
}
// Call position Left (Thomas, 2026-10-14): the call beside the chat, the column's full height, in a column at least
// CALL_LEFT_MIN wide; narrower, the call sits at the top until the column is wide again, the choice kept. The call's
// width there (prefs.callSideWidth, the line between the two) is at least CALL_SIDE_MIN and leaves the chat COLUMN_MIN.
const CALL_LEFT_MIN = 560;
const CALL_SIDE_MIN = 240;
// Where the call shows for the chosen position in a column this wide: 'top', 'bottom' or 'left'.
function callPlaceFor(pos, columnWidth) {
  if (pos === 'bottom') return 'bottom';
  if (pos === 'left' && Number(columnWidth) >= CALL_LEFT_MIN) return 'left';
  return 'top';
}
function clampCallSide(w, columnWidth) { return clampSplit(w, CALL_SIDE_MIN, Math.round(columnWidth) - COLUMN_MIN); }
// A key on a splitter: the new value, or null when the key is not the splitter's (so it goes on, never trapped).
// `grow` and `shrink` are the arrow names for the axis (Right and Left for the column's edge, Down and Up for the strip's).
function splitterKey({ key, shift }, now, { min, max, def, grow, shrink }) {
  if (key === grow || key === shrink) return clampSplit(now + (key === grow ? 1 : -1) * (shift ? SPLIT_BIG_STEP : SPLIT_STEP), min, max);
  if (key === 'Home') return min;
  if (key === 'End') return Math.max(min, max);
  if (key === 'Enter' && shift) return clampSplit(def, min, max);
  return null;
}
const columnWin = () => columnEl.ownerDocument.defaultView || window;
const columnMaxWidth = () => Math.round(columnWin().innerWidth * COLUMN_MAX_SHARE);
const columnHeight = () => columnEl.clientHeight || columnWin().innerHeight;
const columnWidthNow = () => clampColumnWidth(prefs.chatWidth, columnWin().innerWidth);
// The call area's height besides its tiles: its titlebar, the toolbar under the tiles (while it is in the column) and
// the Join/Online row.
function callChrome() {
  const bar = $('video-bar');
  const toolbar = bar && bar.closest('.side-column-strip') && !confEl.classList.contains('call-off') ? bar.offsetHeight : 0;
  return toolbar + (columnEl.querySelector('#call-head')?.offsetHeight || 0);
}
// The call's width beside the chat (Left), held to the column it is in now.
const callSideWidthNow = () => clampCallSide(prefs.callSideWidth, columnWidthNow());
const callSideMax = () => Math.max(CALL_SIDE_MIN, columnWidthNow() - COLUMN_MIN);
const columnMaxStrip = () => Math.max(STRIP_MIN, stripMaxHeight(columnHeight(), callChrome()));
// The sizes onto the column, clamped to the window it is in now (resized, popped out); and where the call is in it.
function applyColumnSizes() {
  if (!columnEl) return;
  const w = columnWidthNow();
  columnEl.style.setProperty('--side-column-w', `${w}px`);
  columnEl.classList.toggle('full', w >= columnWin().innerWidth - 8); // its edge kept inside the window
  const v = columnEl.querySelector('#side-column-splitter');
  v.setAttribute('aria-valuemin', String(COLUMN_MIN));
  v.setAttribute('aria-valuemax', String(Math.max(COLUMN_MIN, columnMaxWidth())));
  v.setAttribute('aria-valuenow', String(w));
  v.setAttribute('aria-valuetext', `${w} pixels wide`);
  // Left: the call's width beside the chat, and its line's values.
  const side = callSideWidthNow();
  columnEl.style.setProperty('--side-column-call-w', `${side}px`);
  const sv = columnEl.querySelector('#side-column-call-splitter');
  if (sv) {
    sv.setAttribute('aria-valuemin', String(CALL_SIDE_MIN));
    sv.setAttribute('aria-valuemax', String(callSideMax()));
    sv.setAttribute('aria-valuenow', String(side));
    sv.setAttribute('aria-valuetext', `The call ${side} pixels wide`);
  }
  const colH = columnHeight();
  const chrome = callChrome();
  const h = stripHeightFor(prefs.stripHeight, colH, chrome);
  columnEl.style.setProperty('--side-column-strip-h', `${h}px`);
  const s = columnEl.querySelector('#side-column-strip-splitter');
  s.setAttribute('aria-valuemin', String(STRIP_MIN));
  s.setAttribute('aria-valuemax', String(columnMaxStrip()));
  s.setAttribute('aria-valuenow', String(h));
  s.setAttribute('aria-valuetext', `${h} pixels tall`);
  syncCallPlace();
}
let columnSizeFrame = 0;
function setColumnSize(which, value, { remember = true } = {}) {
  if (which === 'width') prefs.chatWidth = clampColumnWidth(value, columnWin().innerWidth);
  else if (which === 'side') prefs.callSideWidth = clampCallSide(value, columnWidthNow());
  else prefs.stripHeight = clampStripHeight(value, columnHeight(), callChrome());
  if (remember) savePrefs();
  applyColumnSizes();
  if (!columnSizeFrame) columnSizeFrame = columnWin().requestAnimationFrame(() => { columnSizeFrame = 0; applyLayout(); }); // the canvas and the tiles follow, once a frame
}
// One splitter: `axis` 'x' or 'y', `which` the size it sets; the drag works from the pointer's travel since it began.
function wireSplitter(el, { which, axis, def, min, max, grow, shrink }) {
  let drag = null;
  // The strip's: from the height shown (the default one may be held lower), and with the call at the bottom of the
  // column the line is above it, so up grows it (the drag's travel and the arrows turn round).
  // The column's edge and the call's line beside the chat (Left) from the widths shown, held to this window.
  const start = () => {
    if (which === 'width') return columnWidthNow();
    if (which === 'side') return callSideWidthNow();
    return parseFloat(columnEl.style.getPropertyValue('--side-column-strip-h')) || prefs.stripHeight;
  };
  const flipped = () => which === 'strip' && columnEl.classList.contains('call-bottom');
  el.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    drag = { at: axis === 'x' ? event.clientX : event.clientY, from: start() };
    el.classList.add('dragging');
    columnEl.parentElement?.classList.add('resizing-column');
    el.setPointerCapture?.(event.pointerId);
  });
  el.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const travel = ((axis === 'x' ? event.clientX : event.clientY) - drag.at) * (flipped() ? -1 : 1);
    setColumnSize(which, drag.from + travel, { remember: false });
  });
  const stop = () => {
    if (!drag) return;
    drag = null;
    el.classList.remove('dragging');
    columnEl.parentElement?.classList.remove('resizing-column');
    savePrefs();
  };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('dblclick', () => setColumnSize(which, def));
  el.addEventListener('keydown', (event) => {
    const keys = flipped() ? { grow: shrink, shrink: grow } : { grow, shrink };
    const next = splitterKey({ key: event.key, shift: event.shiftKey }, start(), { min, max: max(), def, ...keys });
    if (next === null) return; // Tab, Escape and the rest go on
    event.preventDefault();
    setColumnSize(which, next);
  });
}
const columnKey = (id) => `app.column.${id}`;
const columnCollapsed = () => Boolean(columnEl?.classList.contains('collapsed'));
function setColumnCollapsed(on, { remember = true } = {}) {
  if (!columnEl) return;
  columnEl.classList.toggle('collapsed', on);
  const b = columnEl.querySelector('#side-column-toggle');
  b.setAttribute('aria-expanded', String(!on));
  b.dataset.tip = on ? 'Expand' : 'Collapse';
  b.setAttribute('aria-label', on ? 'Show the call and chat' : 'Collapse the call and chat');
  b.querySelector('i').className = `fa-solid fa-angles-${on ? 'right' : 'left'} fa-fw`;
  if (!on && unread) { unread = 0; canvas.setBuiltinUnread('chat', assistantNew); } // opened: the chat is read
  if (!on) chatViews?.seen(); // and the view showing
  const id = layoutSpaceId();
  if (remember && id) {
    try { localStorage.setItem(columnKey(id), JSON.stringify({ collapsed: on })); } catch { /* private mode: not remembered */ }
  }
  syncRail();
  applyLayout();
}
// On entering a space: as it was left in this browser; an aside starts open and remembers nothing.
function applyColumnPref() {
  const id = layoutSpaceId();
  let on = false;
  if (id) {
    try { on = Boolean(JSON.parse(localStorage.getItem(columnKey(id)) || 'null')?.collapsed); } catch { on = false; }
  }
  setColumnCollapsed(on, { remember: false });
}
// The rail: the chat's unread count (its button opens the column into the chat) and a face per person on the call.
function syncRail() {
  if (!columnEl || !document.body.classList.contains('in-space')) return;
  // Both of Chat's views count: the Discussion's unread messages and the Assistant's new results (GitHub #203).
  const total = unread + assistantNew;
  const badge = columnEl.querySelector('#side-column-rail-unread');
  badge.hidden = total === 0;
  badge.textContent = total > 9 ? '9+' : String(total);
  const btn = columnEl.querySelector('#side-column-rail-chat');
  const said = total ? `Chat, ${total} unread` : 'Chat';
  btn.setAttribute('aria-label', said);
  btn.dataset.tip = said;
  const faces = columnEl.querySelector('#side-column-rail-faces');
  const people = [...tiles.values()].filter((t) => !t.classList.contains('tile-screen'));
  const key = people.map((t) => `${t.dataset.identity}:${t.querySelector('.placeholder')?.getAttribute('src') || ''}`).join('|');
  if (faces.dataset.key === key) return;
  faces.dataset.key = key;
  faces.replaceChildren(...people.map((t) => {
    const face = faces.ownerDocument.createElement('span');
    face.className = 'side-column-rail-face';
    face.title = t.querySelector('.name')?.textContent || '';
    const src = t.querySelector('.placeholder')?.getAttribute('src');
    if (src) {
      const img = faces.ownerDocument.createElement('img');
      img.src = src;
      img.alt = face.title;
      face.appendChild(img);
    } else face.textContent = (face.title || '?').charAt(0).toUpperCase();
    return face;
  }));
}
// A screen share (anyone's: a screen tile in the grid) lifts the conference out of the column, floating over the
// Workspace; the last share ending puts it back. Only in column mode (canvas.js says no elsewhere). The canvas asks
// screenShared() too (the conference's shareLift) when it puts the conference back in the column after a phone's width.
const screenShared = () => [...tiles.values()].some((t) => t.classList.contains('tile-screen'));
function syncShareLift() {
  if (!canvas.columnMode()) return;
  const sharing = screenShared();
  if (sharing !== canvas.lifted('conference')) canvas.liftBuiltin('conference', sharing);
}

// --- the call's place (Thomas, 2026-10-14: the call pops out again, and never squeezes the chat) ---------------------
// Call position, in the call's own titlebar's "..." (#call-more)
// and in Chat's "...": the top of the column (the default), its bottom (the chat above the call), the left of the chat
// (beside it, the column's full height, in a column at least CALL_LEFT_MIN wide; narrower it shows at the top, the choice
// kept, and comes back when the column is wide again), a floating window over the Workspace (canvas.liftBuiltin, the
// person's own lift), or a window of its own (canvas.popBuiltin: the conference's element moved into the window, as it
// popped out before the column, so the call keeps its connection and nobody joins twice). Top, bottom, left and floating are
// remembered per person (prefs.callPosition, prefs.callFloat); its own window is not (a window opens only from a click). Out of the
// column (its own window, floating, or lifted for a screen share) the column shows a slim strip, #call-out: the call's
// controls and Bring the call back, and the chat has the rest; closing the call's window brings it back too (canvas.js).
// Hang up brings it back. On a phone there is no column: Pop out moves the docked call into its window as before.
const callOutEl = columnEl?.querySelector('#call-out') || null;
const callAtBottom = () => prefs.callPosition === 'bottom';
// Where the call shows in the column now: 'top', 'bottom' or 'left' (only open, never in an aside: the column is the
// call there).
const callPlaceNow = () => (columnCollapsed() || inAside() ? (callAtBottom() ? 'bottom' : 'top') : callPlaceFor(prefs.callPosition, columnWidthNow()));
// Where the call is now: 'column', 'window', 'float' (the person's), 'share' (lifted for a screen share), 'dock' or
// 'closed' (a phone's).
function callWhere() {
  const mode = canvas.builtinMode('conference');
  if (!mode) return 'closed';
  if (mode === 'window') return 'window';
  const by = canvas.liftedBy('conference');
  if (by) return by === 'person' ? 'float' : 'share';
  return mode;
}
const CALL_OUT_NOTES = { window: 'The call is in its own window', float: 'The call is in a floating window', share: 'The call floats while a screen is shared' };
function syncCallPlace() {
  const where = callWhere();
  const outside = where === 'window' || where === 'float' || where === 'share';
  // The titlebar's Pop out, and the conference's own when it floats: Bring back once the call is out of the column.
  const label = outside ? 'Bring the call back' : 'Pop out the call';
  for (const pop of [columnEl?.querySelector('#call-head-popout'), $('conf-popout')]) {
    if (!pop || pop.dataset.tip === label) continue;
    pop.dataset.tip = label;
    pop.setAttribute('aria-label', label);
    pop.querySelector('i').className = `fa-solid fa-${outside ? 'arrow-left' : 'up-right-from-square'} fa-fw`;
  }
  // A phone has no window to pop into (a pop-up is a new tab there): only the way back shows.
  const noPop = phoneWidth() && where !== 'window';
  for (const pop of [columnEl?.querySelector('#call-head-popout'), $('conf-popout')]) if (pop) pop.hidden = noPop;
  if (!columnEl) return;
  // No call area out of the call (Thomas, 2026-10-14: "when not in a call we should not show the call area"): no
  // titlebar, no Left column beside the chat, whatever Call position is saved (kept for the next call); the chat fills
  // the column with the slim Join the call row above it, or below it with the call at the bottom, as before the
  // titlebar. The call area comes with the call, and stays while the call is floating or in its own window.
  const callArea = inCall || outside;
  const chosen = callPlaceNow();
  const place = !callArea && chosen === 'left' ? 'top' : chosen;
  const left = place === 'left';
  columnEl.classList.toggle('call-area', callArea);
  columnEl.classList.toggle('call-bottom', place === 'bottom');
  columnEl.classList.toggle('call-left', left);
  const sideLine = columnEl.querySelector('#side-column-call-splitter');
  if (sideLine) sideLine.hidden = !left;
  // The call's titlebar: wherever the conference is open from this column (in it, floating or in its own window).
  const head = columnEl.querySelector('#call-head');
  if (head) head.hidden = !callArea || where === 'closed' || where === 'dock';
  const away = canvas.columnMode() && outside;
  columnEl.classList.toggle('call-away', away);
  if (callOutEl) {
    callOutEl.hidden = !away;
    if (away) columnEl.querySelector('#call-out-note').textContent = CALL_OUT_NOTES[where];
  }
}
const POPUP_BLOCKED = 'The browser did not open the window. Allow pop-ups for this site to open it in its own window.';
function popOutCall() {
  if (canvas.columnMode()) {
    if (!canvas.popBuiltin('conference')) setStatus(POPUP_BLOCKED, true);
  } else if (canvas.builtinOpen('conference')) canvas.setMode('conference', 'window');
  syncCallPlace();
}
function bringCallBack() {
  if (prefs.callFloat) { prefs.callFloat = false; savePrefs(); } // brought back from floating: the column's again
  if (canvas.columnMode()) canvas.returnBuiltin('conference');
  else if (canvas.builtinMode('conference') === 'window') canvas.setMode('conference', 'dock');
  syncCallPlace();
  applyLayout();
}
function setCallPosition(pos) {
  if (pos === 'window') { popOutCall(); return; }
  prefs.callFloat = pos === 'float';
  if (pos !== 'float') prefs.callPosition = pos;
  savePrefs();
  if (pos === 'float') {
    if (callWhere() === 'window') canvas.returnBuiltin('conference');
    canvas.liftBuiltin('conference', true, 'person');
  } else canvas.returnBuiltin('conference');
  syncCallPlace();
  applyLayout();
}
// The Call position entries, for the caret's menu, the call's titlebar and Chat's "...". The position marked is the one
// chosen: Left stays marked in a column too narrow for it (the call shows at the top meanwhile), and is offered only in
// a column wide enough, saying why otherwise.
function callPlaceItems() {
  const where = callWhere();
  const column = canvas.columnMode();
  const items = [{ heading: 'Call position' }];
  if (column) {
    const inside = where === 'column';
    const floating = where === 'float' || where === 'share' || (inside && prefs.callFloat);
    const chosen = ['bottom', 'left'].includes(prefs.callPosition) ? prefs.callPosition : 'top';
    const at = (pos) => inside && !floating && chosen === pos;
    const wide = columnWidthNow() >= CALL_LEFT_MIN;
    items.push(
      { radio: true, checked: at('top'), icon: 'arrow-up', label: 'Top of the column', onPick: () => setCallPosition('top') },
      { radio: true, checked: at('bottom'), icon: 'arrow-down', label: 'Bottom of the column', onPick: () => setCallPosition('bottom') },
      { radio: true, checked: at('left'), icon: 'arrow-left', label: 'Left of the chat', hint: wide ? undefined : 'Needs a wider column', disabled: !wide, onPick: () => setCallPosition('left') },
      { radio: true, checked: floating, icon: 'window-restore', regular: true, label: 'Floating window', onPick: () => setCallPosition('float') },
    );
  }
  items.push({ radio: true, checked: where === 'window', icon: 'up-right-from-square', label: 'Its own window', onPick: () => setCallPosition('window') });
  return items;
}
// The call's titlebar's "..." (#call-more): Pop out or Bring the call back (the toolbar's Pop out does the same), Call
// position, then on the call its Settings (the toolbar's gear) and Leave the call (Hang up; the
// titlebar's x before the column, which closed the call).
function callMenuItems() {
  const where = callWhere();
  const items = [];
  if (['window', 'float', 'share'].includes(where)) items.push({ icon: 'arrow-left', label: 'Bring the call back', onPick: bringCallBack });
  else if (where !== 'closed' && !phoneWidth()) items.push({ icon: 'up-right-from-square', label: 'Pop out the call', onPick: popOutCall });
  if (where !== 'closed') items.push({ divider: true }, ...callPlaceItems());
  if (inCall) {
    items.push({ divider: true });
    // The guest link's switch, for whoever can manage the space. After the menu has closed, so the click that picked
    // it does not close the settings again.
    if (!guestMode && canDo('canInvite')) items.push({ icon: 'gear', label: 'Settings', onPick: () => setTimeout(() => openSettings('more'), 0) });
    items.push({ icon: 'phone-slash', label: 'Leave the call', danger: true, onPick: () => $('hangup').click() });
  }
  return items;
}
// The time in the call, in the titlebar (the column's, and the conference's own when it floats or has a window): from
// when this person joined the call (the server gives no start for the call itself; the room is made when the first
// person enters the space, not when the call starts), every second, only while in the call. Counted from the clock, so
// a hidden page that comes back shows the true time, and cleared on leaving and on a lost connection (pagehide only
// stops the tick; pageshow starts it again while the call is connected).
let callTimeStart = 0;
let callTimeTimer = null;
function callTimeEls() {
  const found = [columnEl, confEl].filter(Boolean).flatMap((root) => [...root.querySelectorAll('[data-call-time]')]);
  return found;
}
function showCallTime() {
  const seconds = callTimeStart ? Math.max(0, Math.floor((Date.now() - callTimeStart) / 1000)) : 0;
  const text = callTime(seconds);
  paintChatConn(); // the status line's "In a call" and the same time
  for (const el of callTimeEls()) {
    el.hidden = !callTimeStart;
    const t = el.querySelector('time');
    if (t.textContent !== text) { t.textContent = text; t.setAttribute('datetime', callDuration(seconds)); }
    const head = el.closest('header');
    if (head) head.title = callTimeStart ? `In the call for ${text}` : '';
  }
}
function stopCallTime() {
  clearInterval(callTimeTimer);
  callTimeTimer = null;
  callTimeStart = 0;
  showCallTime();
}
function startCallTime() {
  clearInterval(callTimeTimer);
  callTimeStart = Date.now();
  showCallTime();
  callTimeTimer = setInterval(showCallTime, 1000);
}
// pagehide only stops the tick (the start is kept); a page the browser brings back (pageshow, from its back-forward
// cache) ticks again while the call is still connected, and clears the time if it is not.
addEventListener('pagehide', () => { clearInterval(callTimeTimer); callTimeTimer = null; });
addEventListener('pageshow', () => {
  if (call.state !== 'connected') {
    if (callTimeStart) stopCallTime();
    return;
  }
  if (!callTimeStart) callTimeStart = Date.now();
  showCallTime();
  if (!callTimeTimer) callTimeTimer = setInterval(showCallTime, 1000);
});
// A hidden page does not tick (unless the call is in a window of its own, which is seen); back, it shows the true time.
document.addEventListener('visibilitychange', () => {
  if (!callTimeStart) return;
  if (document.hidden && callWhere() !== 'window') { clearInterval(callTimeTimer); callTimeTimer = null; }
  else if (!callTimeTimer) { showCallTime(); callTimeTimer = setInterval(showCallTime, 1000); }
});
// The titlebar's name and icon: the environment's name for the conference, else Call (callTitle, call-toolbar.js).
function setCallHead(def) {
  const name = columnEl?.querySelector('#call-head-name');
  if (name) name.textContent = callTitle(def.name);
  const icon = columnEl?.querySelector('#call-head-icon');
  if (icon && def.icon) icon.className = `fa-solid fa-${def.icon} fa-fw`;
}
// Pop out on the titlebar (and on the conference's own when it floats): the same as the "..." entry.
for (const pop of [columnEl?.querySelector('#call-head-popout'), $('conf-popout')]) {
  pop?.addEventListener('click', () => (['window', 'float', 'share'].includes(callWhere()) ? bringCallBack() : popOutCall()));
}
if (callOutEl) {
  // Each control here clicks the call's own and looks as it does (its state, its tooltip), wherever the call is.
  for (const b of callOutEl.querySelectorAll('[data-for]')) {
    const src = $(b.dataset.for);
    if (!src) continue;
    const copy = () => {
      b.className = src.className;
      b.dataset.tip = src.dataset.tip || '';
      if (src.dataset.tipKeys) b.dataset.tipKeys = src.dataset.tipKeys;
      else delete b.dataset.tipKeys;
      b.setAttribute('aria-label', src.getAttribute('aria-label') || src.dataset.tip || '');
      b.hidden = src.hidden;
    };
    new MutationObserver(copy).observe(src, { attributes: true, attributeFilter: ['class', 'data-tip', 'data-tip-keys', 'hidden', 'aria-label'] });
    copy();
    b.addEventListener('click', () => src.click());
  }
  callOutEl.querySelector('#call-back').addEventListener('click', bringCallBack);
}
columnEl?.querySelector('#call-more')?.addEventListener('click', (event) => {
  event.stopPropagation();
  openHostMenu(event.currentTarget, callMenuItems);
});
// --- end the call's place ---

if (columnEl) {
  columnEl.querySelector('#side-column-toggle').addEventListener('click', () => setColumnCollapsed(!columnCollapsed()));
  columnEl.querySelector('#side-column-rail-chat').addEventListener('click', () => {
    setColumnCollapsed(false);
    if (canvas.builtinOpen('chat')) $('chat-input')?.focus();
  });
  wireSplitter(columnEl.querySelector('#side-column-splitter'), { which: 'width', axis: 'x', def: DEFAULT_PREFS.chatWidth, min: COLUMN_MIN, max: columnMaxWidth, grow: 'ArrowRight', shrink: 'ArrowLeft' });
  wireSplitter(columnEl.querySelector('#side-column-strip-splitter'), { which: 'strip', axis: 'y', def: DEFAULT_PREFS.stripHeight, min: STRIP_MIN, max: columnMaxStrip, grow: 'ArrowDown', shrink: 'ArrowUp' });
  wireSplitter(columnEl.querySelector('#side-column-call-splitter'), { which: 'side', axis: 'x', def: DEFAULT_PREFS.callSideWidth, min: CALL_SIDE_MIN, max: callSideMax, grow: 'ArrowRight', shrink: 'ArrowLeft' });
  applyColumnSizes();
}
placeColumnTools(); // now that the two exist
// --- end the always-on column ---

// --- the status strip: the phase chip and its journey bar (the Journey bar family) ----------------------------------
// The space's status, one line (plan-space-status-strip.md, step 1; plan-space-story-strip.md, steps 1 and 2; design
// system step 30): the chip, "● Booking starts tomorrow" (the story sentence, Phases.storyParts; no caret, it opens the
// sheet, not a menu) and, beside it, the journey bar: a day grid (journeyLayout, public/journey-layout.js), each band as
// wide as its phase is long, named (and its icon, when the template gives one) where it fits, past, current ("Now") and
// ahead by fill, the days no phase covers as an empty slice, a pin above the bar at today with the day of the month, and
// the dates under it; then the days to go. Then the facts modules report (host.facts, up to three chips) and the count
// (host.attention) at the right. The template's phases (branding.phases) and this space's dates (its presence record's
// `phases` and `createdAt`, refreshed by the presence poll, and by my own save) go through the one rule, public/phases.js
// (window.Phases). Nothing but the sheet opens from it (phases only inform): the chip, the days to go, and a press on the
// bar. Shown on every layout tab whenever the space has phases; never with no phases, for a guest, in an aside or while
// home is shown over the space. Its look is system.css's (journey block).
// Wider than a phone it is an element tool of the space bar's left zone (`phase-chip`, the `secondary` bar: that row is
// the strip, style.css, --status-strip-h), with no `fit`. On a narrow window things give way in order: the facts (one by
// one, fitFacts; all at 760px), the end of the sentence (each clause after the first is its own span and drops whole),
// then the bar to its least width; a band shows what fits of its name and icon. On a phone the space bar is the tab bar
// at the foot of the page, so placeSubnav() takes the same element out of the registry and puts it in the header as a
// slim line under the top row (--status-strip-slim-h): the sentence and the bar as a 2px line along its foot, a dot at
// today, and a long press on a band says its name and dates. The header moves to a popped-out window with the strip in it. For
// a screen reader the strip is a region, "Status"; the chip's words sit in one polite status, written only when the
// sentence changes, so the presence poll never makes it speak again; the bar is a group, "Journey", each band named by
// its name and dates, the pin by today's date.
const statusStrip = document.createElement('div');
statusStrip.id = 'status-strip';
statusStrip.className = 'sdk-strip';
statusStrip.setAttribute('role', 'region');
statusStrip.setAttribute('aria-label', 'Status');
statusStrip.hidden = true; // until a space with phases is entered
const statusSaid = document.createElement('span');
statusSaid.className = 'sdk-strip-said';
statusSaid.setAttribute('role', 'status');
const phaseChip = document.createElement('button');
phaseChip.type = 'button';
phaseChip.id = 'phase-chip'; // keeps its own id (the registry only names the elements it draws)
phaseChip.className = 'sdk-strip-chip sdk-strip-phase'; // a header chip (system.css, journey block)
phaseChip.setAttribute('aria-haspopup', 'dialog');
phaseChip.innerHTML = '<span class="sdk-strip-dot" aria-hidden="true"></span><span class="sdk-strip-sentence"></span>';
// The journey bar: a day grid (journeyLayout, public/journey-layout.js). Each band is reached by the keyboard and shows its
// name and dates in a tooltip on hover, focus or a tap; the pin's name is today's date.
const statusTrack = document.createElement('div');
statusTrack.className = 'sdk-journey';
statusTrack.setAttribute('role', 'group');
statusTrack.setAttribute('aria-label', 'Journey');
const statusToGo = document.createElement('button');
statusToGo.type = 'button';
statusToGo.className = 'sdk-strip-chip sdk-strip-count'; // the countdown to the main phase; it opens the phases too
statusToGo.setAttribute('aria-haspopup', 'dialog');
statusToGo.hidden = true;
// The facts modules report (host.facts, plan-space-story-strip.md step 5): up to three chips after the days to go, each a
// button opening a small menu. Not a live region: a fact that changes is not read out (the plan's accessibility rule);
// the chips are drawn again only when the facts change.
const statusFacts = document.createElement('span');
statusFacts.className = 'sdk-strip-facts';
statusFacts.setAttribute('role', 'group');
statusFacts.setAttribute('aria-label', 'Facts');
statusSaid.appendChild(phaseChip);
// The count of what needs this person's action (host.attention, plan-space-status-strip.md step 3): at the strip's right
// end, after the days to go, only above zero. Its own polite status, written only when the count changes; the button
// opens the shared menu of what needs action.
const statusAttention = document.createElement('span');
statusAttention.className = 'sdk-strip-attn-slot';
statusAttention.setAttribute('role', 'status');
statusAttention.hidden = true;
const attentionButton = document.createElement('button');
attentionButton.type = 'button';
attentionButton.id = 'attention-count';
attentionButton.className = 'sdk-strip-chip sdk-strip-attn'; // the warn tone chip with the count in a Chips count
attentionButton.setAttribute('aria-haspopup', 'menu');
statusAttention.appendChild(attentionButton);
statusStrip.append(statusSaid, statusTrack, statusToGo, statusFacts, statusAttention);
let attention = { spaceId: null, modules: [], total: 0 }; // what needs my action here, from GET /api/spaces/:id/attention
let attentionSeen = false; // a count above zero has arrived in this space: the strip stays for the visit
let templatePhases = []; // the template's phases, from /api/branding, cleaned by the rule
let phaseIcons = {}; // phase id -> its icon, when the template gives one
const phaseRule = () => window.Phases || null;
const phaseSpaceRecord = () => (currentSpace && !currentSpace.isAside ? presenceSpaces.find((r) => r.id === currentSpace.id) || currentSpace : null);
const phasesWanted = () => templatePhases.length > 0 && Boolean(phaseRule());
// The strip shows in a space with phases; in one without, once a count above zero has arrived, for the rest of the visit.
const phaseChipWanted = () => Boolean(currentSpace) && !inAside() && !viewingHome && !guestToken && me?.role !== 'guest' && (phasesWanted() || attentionSeen);
// Owners, the admin and the space's moderators edit the dates (PATCH /api/spaces/:id); a member reads them.
function canEditPhases() {
  if (!currentSpace || inAside() || !me || guestToken || me.role === 'guest') return false;
  return hasOwnerRights(me) || Boolean(me.spaces?.[currentSpace.id]?.permissions?.moderator);
}
function phaseToday() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function phaseTimeline() {
  const R = phaseRule();
  const space = phaseSpaceRecord();
  if (!R || !space) return [];
  return R.timelineOf(templatePhases, space.phases || {}, { today: phaseToday(), created: space.createdAt });
}
// The bar: a day grid (journeyLayout, public/journey-layout.js; the Journey bar family). Every day is an equal slice of the
// bar's width, so a band is as wide as its phase is long and the days no phase covers show as an empty slice; an open-ended
// phase (no end) runs two weeks past today or its start; a phase with no dates is a stub at the right end. The pin stands
// above the bar at the middle of today's slice (or in a zone at the end the trip has not reached, or has passed), the ticks
// and dates under it. Each band says what fits of its icon and name, and its name and dates on hover, focus or a tap. Laid
// out again when the bar's width changes or a date or the day does (journeySpec). The days to go after it
// (Phases.countdown).
const OPEN_DAYS_PAST_TODAY = 14; // as the sheet's bar (phase-sheet.js bandShares)
const JOURNEY_LEAST = 480; // the bar keeps at least this much before a fact gives way (the day grid needs the room)
let journeySpec = null; // { bands, today }: what the bar shows, laid out at its width by layoutJourney
let journeyDrawn = '';
const journeyPhone = () => (statusTrack.ownerDocument.defaultView || window).matchMedia('(max-width: 640px)').matches;
function drawStatusTrack(bands, today) {
  const R = phaseRule();
  journeySpec = { bands, today };
  layoutJourney();
  const togo = R.countdown(bands, today);
  const doc = statusToGo.ownerDocument;
  statusToGo.hidden = !togo;
  if (togo) {
    // "2 days to Trip": the number large, the rest beside it; "Trip starts today" has no number.
    const rest = doc.createElement('span');
    rest.className = 'sdk-strip-count-words';
    if (togo.days > 0) {
      const n = doc.createElement('span');
      n.className = 'sdk-strip-count-n';
      n.textContent = String(togo.days);
      rest.textContent = togo.words.slice(String(togo.days).length + 1); // "days to Trip"
      statusToGo.replaceChildren(n, rest);
    } else {
      rest.textContent = togo.words;
      statusToGo.replaceChildren(rest);
    }
    statusToGo.setAttribute('aria-label', `${togo.words}. Phases`);
  } else statusToGo.replaceChildren();
}
function layoutJourney() {
  const L = window.JourneyLayout;
  if (!journeySpec || !L || statusStrip.hidden) return;
  const width = statusTrack.getBoundingClientRect().width;
  if (!width) return;
  const R = phaseRule();
  const { bands, today } = journeySpec;
  const phone = journeyPhone();
  const key = JSON.stringify([today, Math.round(width * 100), phone, bands.map((b) => [b.id, b.label, b.start, b.end, b.tint, phaseIcons[b.id] || ''])]);
  if (key === journeyDrawn) return;
  journeyDrawn = key;
  const dated = bands.filter((b) => b.dated).sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));
  const offs = bands.filter((b) => !b.dated);
  // An open-ended phase runs two weeks past today (or its start, when that is later), as the sheet's bar draws it.
  const endOf = (b) => b.end || R.addDays(today > b.start ? today : b.start, OPEN_DAYS_PAST_TODAY);
  const lay = L.journeyLayout(dated.map((b) => ({ n: b.label, i: phaseIcons[b.id] || '', t: b.tint, s: b.start, e: endOf(b) })), today, width, { zone: phone ? 14 : 28, offs: offs.length });
  const doc = statusTrack.ownerDocument;
  const px = (v) => `${Math.round(v * 100) / 100}px`;
  const out = [];
  lay.bands.forEach((b, k) => {
    const phase = dated[k];
    const tip = phase.end ? `${b.n}, ${b.span}${b.state === 'current' ? ', now' : ''}` : `${b.n}, from ${L.dayText(L.dayNo(b.s))}${b.state === 'current' ? ', now' : ''}`;
    const band = doc.createElement('span');
    band.className = 'sdk-band';
    band.dataset.state = b.state;
    band.dataset.tint = b.t; // the phase's own colour (Phases.tintOf), as in the sheet
    band.dataset.label = b.label.mode;
    band.dataset.tip = tip;
    band.setAttribute('aria-label', tip);
    band.tabIndex = 0;
    band.style.setProperty('--days', String(b.days));
    band.style.setProperty('--x', px(b.x));
    band.style.setProperty('--w', px(b.w));
    if (b.label.mode !== 'none') {
      const box = doc.createElement('span');
      box.className = 'sdk-band-box';
      box.dataset.align = b.label.align;
      if (b.i) {
        const icon = doc.createElement('i');
        icon.className = `fa-solid fa-${b.i} sdk-band-icon`;
        icon.setAttribute('aria-hidden', 'true');
        box.appendChild(icon);
      }
      if (b.label.mode === 'full') {
        const name = doc.createElement('span');
        name.className = 'sdk-band-name';
        name.textContent = b.n;
        box.appendChild(name);
      }
      if (b.label.now) {
        const now = doc.createElement('span');
        now.className = 'sdk-band-now';
        now.textContent = 'Now';
        box.appendChild(now);
      }
      band.appendChild(box);
    }
    if (b.progress != null) {
      const line = doc.createElement('span');
      line.className = 'sdk-band-progress'; // how far through the phase today is
      line.style.setProperty('--p', px(b.progress));
      band.appendChild(line);
    }
    out.push(band);
  });
  for (const g of lay.gaps) {
    if (g.w < 2) continue;
    const gap = doc.createElement('span');
    gap.className = 'sdk-gap';
    gap.setAttribute('aria-hidden', 'true');
    gap.style.setProperty('--days', String(g.days));
    gap.style.setProperty('--x', px(g.x));
    gap.style.setProperty('--w', px(g.w));
    out.push(gap);
  }
  lay.offs.forEach((f, k) => {
    const tip = `${offs[k].label}, no dates`;
    const band = doc.createElement('span');
    band.className = 'sdk-band';
    band.dataset.state = 'off';
    band.dataset.tint = offs[k].tint;
    band.dataset.tip = tip;
    band.setAttribute('aria-label', tip);
    band.tabIndex = 0;
    band.style.setProperty('--x', px(f.x));
    band.style.setProperty('--w', px(f.w));
    out.push(band);
  });
  for (const t of lay.ticks) {
    const tick = doc.createElement('i');
    tick.className = 'sdk-tick';
    tick.setAttribute('aria-hidden', 'true');
    tick.style.setProperty('--x', px(t.x));
    out.push(tick);
  }
  for (const l of lay.labels) {
    const label = doc.createElement('span');
    label.className = 'sdk-tick-label';
    label.dataset.align = l.align;
    label.setAttribute('aria-hidden', 'true');
    label.style.setProperty('--x', px(l.x));
    label.textContent = l.text;
    out.push(label);
  }
  if (lay.pin.where !== 'none') {
    const pin = doc.createElement('span');
    pin.className = 'sdk-today';
    pin.setAttribute('role', 'img');
    const d = new Date(`${today}T12:00:00`);
    pin.setAttribute('aria-label', `Today, ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`);
    pin.dataset.where = lay.pin.where;
    pin.style.setProperty('--pin-x', px(lay.pin.x));
    pin.style.setProperty('--day-offset', String(lay.pin.offset == null ? 0 : lay.pin.offset));
    pin.textContent = String(lay.pin.day);
    const stem = doc.createElement('span');
    stem.className = 'sdk-today-stem';
    stem.setAttribute('aria-hidden', 'true');
    pin.appendChild(stem);
    out.push(pin);
  }
  statusTrack.dataset.mode = lay.tickMode;
  statusTrack.dataset.where = lay.where;
  statusTrack.style.setProperty('--day-w', px(lay.dayW));
  statusTrack.style.setProperty('--zone', px(lay.zl));
  statusTrack.replaceChildren(...out);
}
if (typeof ResizeObserver === 'function') new ResizeObserver(() => layoutJourney()).observe(statusTrack);
// A band's name and dates are its tooltip: the shared one (public/tooltip.js, the Tooltips family) reads its data-tip, on
// hover, on keyboard focus, and on a phone's line on a long press. A band is a way into the phases from the keyboard too
// wider than a phone, as a press on the bar is with the mouse.
const barBand = (event) => (event.target && event.target.closest ? event.target.closest('.sdk-band[data-tip]') : null);
statusTrack.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && barBand(event) && !journeyPhone()) { event.preventDefault(); openPhaseSheetFrom(phaseChip); }
});
// The chip's words: the sentence's clauses, each after the first its own span with its " · ", so a narrow strip drops
// them whole from the end (system.css) and the label's text is still the whole sentence.
function writeStory(parts) {
  const label = phaseChip.querySelector('.sdk-strip-sentence');
  const doc = label.ownerDocument;
  label.replaceChildren(...parts.map((part, i) => {
    const span = doc.createElement('span');
    span.className = i ? 'story-part' : 'story-part story-lead';
    span.textContent = i ? ` · ${part}` : part;
    return span;
  }));
}
// --- what needs my action (host.attention): read when the space loads, when a module reports, on focus and slowly ---
// The strip is for this space and this person; entering another space starts a new visit (the count, and whether the
// strip stays for a space without phases).
function followAttentionSpace() {
  const id = currentSpace && !currentSpace.isAside && !inAside() && !guestToken && me && me.role !== 'guest' ? currentSpace.id : null;
  if (id === attention.spaceId) return;
  attention = { spaceId: id, modules: [], total: 0 };
  attentionSeen = false;
  if (id) loadAttention();
}
let attentionAsked = 0;
async function loadAttention() {
  const id = attention.spaceId;
  if (!id) return;
  const ticket = ++attentionAsked;
  try {
    const answer = await api('GET', `/api/spaces/${encodeURIComponent(id)}/attention`);
    if (ticket !== attentionAsked || attention.spaceId !== id) return; // a newer read, or another space, took over
    attention = { spaceId: id, modules: Array.isArray(answer.modules) ? answer.modules : [], total: Number(answer.total) || 0 };
    if (attention.total > 0) attentionSeen = true;
    updatePhaseChip();
  } catch (err) {
    // keeps the last count; the next read tries again
  }
}
let attentionSoon = 0;
function loadAttentionSoon() {
  clearTimeout(attentionSoon);
  attentionSoon = setTimeout(loadAttention, 250);
}
window.addEventListener('app:attention', (event) => { if (!event.detail?.space || event.detail.space === attention.spaceId) loadAttentionSoon(); });
window.addEventListener('focus', loadAttentionSoon);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadAttentionSoon(); });
setInterval(() => { if (!document.hidden) loadAttention(); }, 60000);
// "2 need action" / "1 needs action", only above zero; written only when the count changes (the status is polite).
function drawAttentionCount() {
  const n = phaseChipWanted() ? attention.total : 0;
  const words = n === 1 ? '1 needs action' : `${n} need action`;
  statusAttention.hidden = n < 1;
  statusStrip.classList.toggle('attention-only', !phasesWanted());
  if (n > 0 && attentionButton.textContent !== words) {
    // The count in a Chips count, then the words: its text is still the whole sentence ("3 need action").
    const count = document.createElement('span');
    count.className = 'sdk-badge'; // the Chips count
    count.textContent = String(n);
    const rest = document.createElement('span');
    rest.className = 'sdk-strip-attn-words';
    rest.textContent = words.slice(String(n).length);
    attentionButton.replaceChildren(count, rest);
    attentionButton.title = `${words}. Show the list`;
  }
}
// The list: a section per module (its name), its label with the count, then its items. A pick opens the object, or the
// module when the item has none.
function openAttentionTarget(moduleId, object) {
  returnToCanvas();
  canvas.open(moduleId);
  if (object && object.module) canvas.openRef(object);
}
function attentionMenuItems() {
  const items = [];
  for (const m of attention.modules) {
    if (items.length) items.push({ divider: true });
    items.push({ heading: m.name || m.module });
    items.push({ label: `${m.count} ${m.label || (m.count === 1 ? 'needs action' : 'need action')}`, onPick: () => openAttentionTarget(m.module) });
    for (const item of m.items || []) items.push({ label: item.title, icon: 'angle-right', onPick: () => openAttentionTarget(m.module, item.object) });
  }
  return items;
}
attentionButton.addEventListener('click', () => openHostMenu(attentionButton, attentionMenuItems));
// --- how the space stands (host.facts): read when the space loads, when a module reports, on focus and slowly ---------
// Facts are the space's (every module's last report, from GET /api/spaces/:id/facts, only the modules I may read here).
// The strip draws up to three, in each fact's `order`, then the order the modules answered in; the rest are in the
// phone's phase sheet and a chip's menu. On a narrow line they give way first, one by one from the end (fitFacts),
// while the journey bar has less than its room (JOURNEY_LEAST); style.css hides them all at 760px and below, and on a phone.
const MAX_FACT_CHIPS = 3;
let spaceFacts = { spaceId: null, modules: [] };
let factsDrawn = '';
function followFactsSpace() {
  const id = currentSpace && !currentSpace.isAside && !inAside() && !guestToken && me && me.role !== 'guest' ? currentSpace.id : null;
  if (id === spaceFacts.spaceId) return;
  spaceFacts = { spaceId: id, modules: [] };
  if (id) loadFacts();
}
let factsAsked = 0;
async function loadFacts() {
  const id = spaceFacts.spaceId;
  if (!id) return;
  const ticket = ++factsAsked;
  try {
    const answer = await api('GET', `/api/spaces/${encodeURIComponent(id)}/facts`);
    if (ticket !== factsAsked || spaceFacts.spaceId !== id) return; // a newer read, or another space, took over
    spaceFacts = { spaceId: id, modules: Array.isArray(answer.modules) ? answer.modules : [] };
    drawFacts();
    // Set up opened before the facts arrived (by address, say): it offers the budget now, keeping what was typed.
    if (settingUp && budgetReported()) spaceSetup.offerBudget(budgetSource());
  } catch (err) {
    // keeps the last facts; the next read tries again
  }
}
let factsSoon = 0;
function loadFactsSoon() {
  clearTimeout(factsSoon);
  factsSoon = setTimeout(loadFacts, 250);
}
window.addEventListener('app:facts', (event) => { if (!event.detail?.space || event.detail.space === spaceFacts.spaceId) loadFactsSoon(); });
window.addEventListener('focus', loadFactsSoon);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadFactsSoon(); });
setInterval(() => { if (!document.hidden) loadFacts(); }, 60000);
// A module's facts as this viewer reads them today (Phases.factsToday): a fact's `when` worded against my own today in
// front of its words ("Tomorrow · SJC → ONT"), and one whose day has passed left out, so a report never reads stale.
const factsNow = (list) => (phaseRule() && phaseRule().factsToday ? phaseRule().factsToday(list, phaseToday()) : (list || []).filter((f) => !f.when));
// Every fact here, in the order shown: each module's by `order`, then as sent; the modules in the order they answered.
function factsInOrder() {
  const all = [];
  spaceFacts.modules.forEach((m, mi) => factsNow(m.facts).forEach((f, fi) => all.push({ ...f, module: m.module, name: m.name || m.module, rank: [Number.isInteger(f.order) ? f.order : 50, mi, fi] })));
  return all.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2]);
}
// Whether some module here reads the space's budget target (a fact marked `budget`): Set up offers the target then.
const budgetReported = () => spaceFacts.modules.some((m) => (m.facts || []).some((f) => f.budget));
const budgetSource = () => ({ name: spaceFacts.modules.find((m) => (m.facts || []).some((f) => f.budget))?.name || '' });
// Whether the phase sheet lists the facts: whenever the strip's chips are hidden (FACT_CHIPS_HIDDEN_AT, the width
// style.css hides them at, in the header's own window: a phone's slim line included), and wider when the line cannot
// fit some of them (a chip dropped, or more facts than chips), so every fact is one tap away.
function factsHiddenInStrip() {
  const view = subnav.ownerDocument.defaultView || window;
  if (view.matchMedia(`(max-width: ${FACT_CHIPS_HIDDEN_AT}px)`).matches) return true;
  return factsInOrder().length > statusFacts.querySelectorAll('.sdk-strip-fact:not([hidden])').length;
}
function factChip(f) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sdk-strip-chip sdk-strip-fact'; // a header chip (system.css, journey block)
  b.dataset.module = f.module;
  b.setAttribute('aria-haspopup', 'menu');
  b.title = f.value ? `${f.text} · ${f.value}. ${f.name}` : `${f.text}. ${f.name}`;
  b.setAttribute('aria-label', b.title);
  if (typeof f.progress === 'number') {
    const fill = document.createElement('span');
    fill.className = 'sdk-strip-fact-fill'; // the progress, a fill from the left (system.css)
    fill.setAttribute('aria-hidden', 'true');
    b.style.setProperty('--p', `${Math.round(Math.min(1, Math.max(0, f.progress)) * 100)}%`);
    b.appendChild(fill);
  }
  const icon = document.createElement('i');
  icon.className = `fa-solid fa-${/^[a-z0-9-]+$/.test(f.icon) ? f.icon : 'circle-info'}`;
  icon.setAttribute('aria-hidden', 'true');
  const words = document.createElement('span');
  words.className = 'sdk-strip-fact-text';
  words.textContent = f.text;
  b.append(icon, words);
  b.addEventListener('click', () => openHostMenu(b, () => factMenuItems(f.module)));
  return b;
}
// The chips, drawn again only when the facts change; then fitted to the line.
function drawFacts() {
  const shown = phaseChipWanted() ? factsInOrder().slice(0, MAX_FACT_CHIPS) : [];
  const key = JSON.stringify(shown.map((f) => [f.module, f.name, f.id, f.icon, f.text, f.value || '', f.progress ?? null]));
  if (key !== factsDrawn) {
    factsDrawn = key;
    statusFacts.replaceChildren(...shown.map(factChip));
  }
  statusFacts.hidden = !shown.length;
  fitFacts();
}
// A narrow line: the last chip gives way, one at a time, while the journey bar is left less than its room (the day grid
// needs it) or the line runs past the strip's end.
function fitFacts() {
  const chips = [...statusFacts.children];
  for (const c of chips) c.hidden = false;
  if (!chips.length || statusStrip.hidden || !statusFacts.getClientRects().length) return;
  const crowded = () => (statusTrack.getClientRects().length && statusTrack.offsetWidth < JOURNEY_LEAST) || statusStrip.scrollWidth > statusStrip.clientWidth + 1;
  for (let i = chips.length - 1; i >= 0 && crowded(); i -= 1) chips[i].hidden = true;
}
if (typeof ResizeObserver === 'function') new ResizeObserver(() => fitFacts()).observe(statusStrip);
// A chip's menu: the module's name, each of its facts in full (with its value), and a way to open the module.
function factMenuItems(moduleId) {
  const m = spaceFacts.modules.find((x) => x.module === moduleId);
  if (!m) return [];
  const list = document.createElement('ul');
  list.className = 'status-fact-list';
  for (const f of factsNow(m.facts)) {
    const li = document.createElement('li');
    const icon = document.createElement('i');
    icon.className = `fa-solid fa-${/^[a-z0-9-]+$/.test(f.icon) ? f.icon : 'circle-info'} fa-fw`;
    icon.setAttribute('aria-hidden', 'true');
    li.append(icon, document.createTextNode(f.value ? `${f.text} · ${f.value}` : f.text));
    list.appendChild(li);
  }
  return [{ heading: m.name || m.module }, { element: list }, { label: `Open ${m.name || m.module}`, icon: 'arrow-up-right-from-square', onPick: () => openAttentionTarget(m.module) }];
}
// Modules hear the space's phases when they change (the 'phases' event, host.on('phases')): this page reads them from the
// space's record (the presence poll, my own save from the sheet or Set up), so a window event tells the modules mounted
// here and a BroadcastChannel tells the pop-outs and module pages of the same browser. Said only when they differ from
// what was last said for that space. The record is the presence list's, which an admin who is not a member reads too.
window.__phasesHost = true; // module-host.js: this page tells the modules, so they need not look themselves
const phasesChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('app-phases') : null;
let phasesSaid = '';
function announcePhases() {
  const space = phaseSpaceRecord();
  if (!space || !space.id || currentSpace?.isAside) return;
  // The budget target (#216) is not on this record (the presence list leaves it out): the modules read it from their
  // own context, and a save here by an owner, the admin or a moderator says it (announceBudget).
  const detail = { space: space.id, phases: space.phases || {}, created: space.createdAt || null };
  const sig = JSON.stringify(detail);
  if (sig === phasesSaid) return;
  phasesSaid = sig;
  try { window.dispatchEvent(new CustomEvent('app:phases', { detail })); } catch { /* no window to tell */ }
  try { if (phasesChannel) phasesChannel.postMessage(detail); } catch { /* nobody to hear */ }
}
// A Set up save of the budget target (an owner's, the admin's or a moderator's): the modules mounted here and the pop-outs hear it at once ('space' with
// { budget }, through the module host); everyone else's modules read it from their context.
function announceBudget(spaceId, budget) {
  const detail = { space: spaceId, budget: budget && typeof budget === 'object' ? budget : null };
  try { window.dispatchEvent(new CustomEvent('app:phases', { detail })); } catch { /* no window to tell */ }
  try { if (phasesChannel) phasesChannel.postMessage(detail); } catch { /* nobody to hear */ }
}
window.addEventListener('focus', () => { if (currentSpace && !document.hidden) loadPresence(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && currentSpace) loadPresence(); });
function updatePhaseChip() {
  announcePhases();
  followAttentionSpace();
  followFactsSpace();
  const R = phaseRule();
  const show = phaseChipWanted();
  if (statusStrip.hidden === show) statusStrip.hidden = !show; // the registry writes the same when the strip is its tool
  nav.draw('secondary');
  drawAttentionCount();
  drawFacts();
  if (!show || !R || !phasesWanted()) return;
  const today = phaseToday();
  const bands = phaseTimeline();
  const parts = R.storyParts(bands, today);
  const words = parts.join(' · ');
  // Written only when the sentence changes: the status is polite, and the presence poll runs this every few seconds.
  if (phaseChip.querySelector('.sdk-strip-sentence').textContent !== words) {
    writeStory(parts);
    phaseChip.title = `${words}. Phases`;
    phaseChip.setAttribute('aria-label', `${words}. Phases`);
  }
  // The dot takes the colour of the phase today is in (before the first, the first; past the last, the last).
  const datedNow = bands.filter((b) => b.dated);
  const here = bands.find((b) => b.current) || datedNow.filter((b) => b.start <= today).pop() || datedNow[0] || null;
  const dot = phaseChip.querySelector('.sdk-strip-dot');
  if (here) dot.dataset.tint = here.tint; else delete dot.dataset.tint;
  drawStatusTrack(bands, today);
  fitFacts(); // the sentence or the bar may have changed the room
}
async function savePhases(dates) {
  const { space } = await api('PATCH', `/api/spaces/${encodeURIComponent(currentSpace.id)}`, { phases: dates });
  const record = presenceSpaces.find((r) => r.id === currentSpace.id);
  if (record) record.phases = space.phases || {};
  if (currentSpace) currentSpace.phases = space.phases || {};
  updatePhaseChip(); // which tells the modules
  return space.phases || {};
}
// The sheet, from the chip or the status track (`opener` takes the keyboard back when it closes). Set up draws the same
// rows inline, as a draft saved with its own Save (space-setup.js); the sheet still saves as it is set.
function openPhaseSheetFrom(opener) {
  const space = phaseSpaceRecord();
  if (!space || !phaseRule()) return;
  openPhaseSheet({
    phases: templatePhases,
    dates: space.phases || {},
    created: space.createdAt,
    today: phaseToday(),
    canEdit: canEditPhases(),
    save: savePhases,
    rule: phaseRule(),
    opener,
    words: { owner: word('owner'), moderator: word('moderator') },
    // Where the strip shows no chips (760px and below, the phone's slim line too) or cannot fit them all, the facts
    // head the sheet instead (plan-space-story-strip.md, "The phone line").
    facts: factsHiddenInStrip() ? factsInOrder().map((f) => ({ icon: f.icon, text: f.text, value: f.value, progress: f.progress, name: f.name, open: () => openAttentionTarget(f.module) })) : [],
  });
}
phaseChip.addEventListener('click', () => openPhaseSheetFrom(phaseChip));
// A press on the bar opens the phases wider than a phone; the phone's 2px line is for seeing (the chip opens them there).
statusTrack.addEventListener('click', () => {
  if (journeyPhone()) return; // the 2px line is for seeing; a long press on a band shows its name and dates
  openPhaseSheetFrom(phaseChip);
});
statusToGo.addEventListener('click', () => openPhaseSheetFrom(phaseChip));
// The strip as a tool of the space bar's left zone, wider than a phone; no fit (the track gives way, style.css).
const STATUS_STRIP_TOOL = { id: 'phase-chip', bar: 'secondary', zone: 'left', group: 'status', order: 1, icon: 'circle', label: 'Status', element: statusStrip, visible: phaseChipWanted };
// Phone or wide (placeSubnav, `tabs`): wider, the registry's tool in the space bar; on a phone, out of the registry
// (which would put it back in the tab bar) and into the header after the top row, before the tab bar when that is the
// header's row too (a narrow popped-out window).
placeStatusStrip = (tabs) => {
  if (tabs) {
    if (nav.get('phase-chip')) nav.unregister('phase-chip');
    const before = subnav.parentNode === topbarEl ? subnav : null;
    if (statusStrip.parentNode !== topbarEl || statusStrip.nextSibling !== before) topbarEl.insertBefore(statusStrip, before);
    statusStrip.hidden = !phaseChipWanted();
  } else if (!nav.get('phase-chip') || statusStrip.parentNode === topbarEl) {
    nav.register(STATUS_STRIP_TOOL);
  }
};
placeStatusStrip(phoneWidth());
// --- end the status strip ---

// --- the one bar: the switcher (plan-one-bar.md, decisions 1, 6, 9 and 10, step 7) -----------------------------------
// In a space the top bar's left zone is the space's name with the switcher's caret as one control (`space-switcher`,
// in the breadcrumb's place: the breadcrumb is not drawn beside it wider than a phone, and the Spaces slot leaves the
// bar, setInSpace), then the layout tabs (Workspace, Calendar, Map and the favorites: plan-layout-views.md, further
// down); the phase chip is the status strip's, under the bar (plan-space-status-strip.md). Calendar and Map are layouts: their composite on the canvas, beside the always-on
// column, with no Away. A guest's bar is the name alone (the breadcrumb); an aside's is the switcher, Rejoin call (the
// right zone) and your picture. On a phone (step 8) the one row is the switcher (the breadcrumb is not drawn beside it
// at any width), the bell and the menu (the chip is the status strip's line under it); there are no layout tabs there: the tab
// bar holds a tab per module open, Calendar and Map as their composites' tabs (canvas.js), and the column is not drawn.
const oneBar = () => Boolean(currentSpace) && !viewingHome && !guestToken && me?.role !== 'guest';
// The Workspace's tools (the Layout menu, Full screen, Pop out, a module's: nav-bar.js, `workspace: 'only'`) show on
// every layout tab, the Workspace, Calendar, Map and each favorite alike: "the layout menu stays where it is and as it
// is" (plan-layout-views.md, decision 5, step 3). Only an aside hides them (an aside has no layouts); on a phone the tab
// bar keeps them (decision 3). A module's own tools come and go with the module focused: on the Calendar and Map tabs
// the composite is the only module, so only its own show. Read by the registry on every draw.
const workspaceShown = () => phoneWidth() || !inAside();
nav.setWorkspace({ shown: workspaceShown });
const spaceSwitcher = document.createElement('span');
spaceSwitcher.id = 'space-switcher'; // an element tool keeps its own id
spaceSwitcher.className = 'space-switcher';
const spaceSwitcherButton = document.createElement('button');
spaceSwitcherButton.type = 'button';
spaceSwitcherButton.className = 'core-link space-switcher-button';
spaceSwitcherButton.setAttribute('aria-haspopup', 'menu');
spaceSwitcherButton.setAttribute('aria-expanded', 'false');
spaceSwitcherButton.innerHTML = '<i class="fa-solid fa-message fa-fw" aria-hidden="true"></i><span class="crumb-label"></span><i class="fa-solid fa-caret-down fa-fw space-switcher-caret" aria-hidden="true"></i>';
spaceSwitcherButton.addEventListener('click', () => openSpaceSwitcher(spaceSwitcherButton));
spaceSwitcher.appendChild(spaceSwitcherButton);
nav.register({ id: 'space-switcher', bar: 'primary', zone: 'left', group: 'where', order: 9.5, icon: 'caret-down', label: 'Switch', element: spaceSwitcher, visible: () => oneBar() });
// The switcher reads as the segment the breadcrumb shows last: the space's name and icon, or an aside's own words.
function paintSpaceSwitcher(seg, icon) {
  if (!spaceSwitcherButton.isConnected) spaceSwitcher.replaceChildren(spaceSwitcherButton); // the name's input went with Set up
  const label = seg ? seg.label : '';
  const i = spaceSwitcherButton.querySelector('i:first-child');
  i.className = `${icon.includes(' ') ? icon : `fa-solid fa-${icon}`} fa-fw`;
  spaceSwitcherButton.querySelector('.crumb-label').textContent = label;
  const text = `${label}. Switch ${word('space')}`;
  spaceSwitcherButton.title = text;
  spaceSwitcherButton.setAttribute('aria-label', text);
}
// An aside's bar (decision 10): Rejoin call beside your picture; the space bar (the Workspace's toolbar) is not drawn
// there (style.css), so the tool is here too. The phone keeps it in the tab bar.
nav.register({ id: 'aside-rejoin', bar: 'primary', zone: 'right', group: 'aside', groupOrder: 80, order: 1, icon: 'circle-left', label: 'Rejoin call', labelled: true, visible: () => oneBar() && inAside() && Boolean(currentSpace.origin) && !phoneWidth(), onClick: () => returnFromAside() });
// --- end the one bar ---

// --- Set up (space-setup.js) ----------------------------------------------------------------------------
// Edit's place (plan-one-bar.md, decision 5, step 4; plan-setup-panel.md, steps 1 to 3): a `setup` tool in the top bar's
// right zone before the bell and your picture (step 7), for owners, the admin and this space's moderators (GET /api/me:
// hasOwnerRights, or user.spaces[<id>].permissions.moderator). Pressing it puts `body.setting-up` on, shows the tool
// pressed, turns the space's name in the bar into an input (in the switcher's place, placeSetupName below) and opens
// the side panel with its tabs (a full-screen sheet on a phone); pressing it again is Cancel. The address fragment
// picks the tab (#show, #space, #members, #phases, #modules: the tabs Modules, the space's own, Members, Phases and Settings) and follows it while the panel is open. The panel's
// Save and Cancel are an action bar locked to its bottom (action-bar.js; not in the top bar): Save sends what changed,
// in order, and leaves the mode; Cancel and Escape leave it and drop the edits, asking "Discard your changes?" first
// when something was edited; a click outside does nothing. A member has no Set up. /?setup=<id>#<tab> opens it from an
// address (openSetupFor, step 6), as do the space card's Set up link on Home and Manage's Edit link.
const spaceSetup = createSpaceSetup({ tabOverflow, openMenu: openHostMenu, api, word, verb, icons: getIcons, switchListHtml, wireSwitchList, opensWithSummary, escapeHtml, layoutVerb: () => verb('layout'), renderModuleSettings });
let settingUp = false;
const setupNameInput = document.createElement('input');
setupNameInput.type = 'text';
setupNameInput.id = 'setup-bar-name';
setupNameInput.className = 'setup-bar-name';
setupNameInput.maxLength = 40;
setupNameInput.autocomplete = 'off';
setupNameInput.setAttribute('aria-label', 'Name');
const isModeratorHere = () => Boolean(currentSpace && me?.spaces?.[currentSpace.id]?.permissions?.moderator);
const canSetUp = () => Boolean(currentSpace) && !inAside() && !viewingHome && !guestToken && Boolean(me) && me.role !== 'guest' && (hasOwnerRights(me) || isModeratorHere());
// The Modules tab (id `show`; the modules' switches, Arrange, Layouts: canvas.mountMenu) is for everyone in a space wider than a phone, a
// guest too; so Set up's button is, and a person who may not set up has that one tab and Close.
const canShowTab = () => Boolean(currentSpace) && !viewingHome && !phoneWidth();
const canOpenSetup = () => canSetUp() || canShowTab();
const setupShown = () => canOpenSetup(); // shown while open too, pressed (nav.setActive in enterSetup and leaveSetup)
// The panel's tabs in the address: the fragment it opened with, and the tab shown while it is open; gone with it.
const SETUP_TAB_HASH = /^#(show|space|members|phases|modules)$/;
function setupTabInAddress(tab) {
  const keep = location.pathname + location.search;
  if (tab) history.replaceState(history.state, '', `${keep}#${tab}`);
  else if (SETUP_TAB_HASH.test(location.hash)) history.replaceState(history.state, '', keep);
}
// While setting up, the space's name in the bar carries the input instead of the name: the switcher's place, at every
// width (step 8: the switcher is the phone's too, so the input never moves as the window crosses 640px; updateCrumb
// draws the switcher afresh, so this runs after each draw; the input is one element, so what was typed survives).
function placeSetupName() {
  if (!settingUp || !hasOwnerRights(me)) return; // a moderator may not rename: the name stays words
  if (nav.isVisible(nav.get('space-switcher'))) {
    spaceSwitcher.replaceChildren(setupNameInput);
  }
}
// The panel hangs under the header: its top follows the header's height (one row or two, a phone's one).
let setupHeaderWatch = null;
function placeSetupSide() {
  const top = topbarEl.getBoundingClientRect().bottom;
  spaceSetup.el.style.setProperty('--setup-top', `${Math.max(0, Math.round(top))}px`);
}
// `tab`: the tab asked for (an address's fragment, or /?setup=<id>#<tab>'s); the address's own fragment when not given.
function enterSetup({ tab = location.hash } = {}) {
  if (!canOpenSetup() || settingUp) return;
  const space = phaseSpaceRecord() || currentSpace;
  settingUp = true;
  document.body.classList.add('setting-up');
  setupNameInput.value = space.name || spaceName;
  updateCrumb(); // the name as the input
  nav.setActive('setup', true);
  const opened = spaceSetup.open({
    space,
    owner: canSetUp() && hasOwnerRights(me),
    moderator: canSetUp() && isModeratorHere(),
    show: canShowTab() ? (holder) => canvas.mountMenu(holder) : null,
    phases: templatePhases, // drawn inline in the phases tab, a draft saved with Save (the chip's sheet is its own)
    rule: phaseRule(),
    today: phaseToday(),
    tab,
    nameInput: setupNameInput,
    // The budget field (#216) shows while a module here reads the target: one whose manifest says so (Set up reads the
    // module list itself), one that reported a fact marked `budget` (named after it; later facts: offerBudget), or one set.
    budget: budgetReported() ? budgetSource() : null,
    onDone: setupSaved,
    onSaved: (saved, fields) => setupSaved(saved, '', fields), // a part went through before a refusal: the page follows it
    onDeleted: setupDeleted,
    onLinks: () => loadPresence().then(() => renderGuestLink()), // the in-space guest link controls read the same record
    onTab: setupTabInAddress,
    onLeave: leaveSetup,
  });
  if (!opened) { leaveSetup(); return; }
  placeSetupSide();
  if (!setupHeaderWatch && typeof ResizeObserver === 'function') {
    setupHeaderWatch = new ResizeObserver(() => { if (settingUp) placeSetupSide(); });
    setupHeaderWatch.observe(topbarEl);
  }
}
function leaveSetup() {
  if (!settingUp) return;
  settingUp = false;
  document.body.classList.remove('setting-up');
  nav.setActive('setup', false);
  setupTabInAddress(null);
  if (spaceSetup.isOpen()) spaceSetup.close();
  updateCrumb(); // the name back as words, Set up back in the bar
  const tool = nav.elementOf('setup');
  if (tool && tool.getClientRects().length) tool.focus();
}
// Opening Set up by address (plan-setup-panel.md, step 6): /?setup=<id>#<tab>, the Home card's Set up link, Manage's
// Edit link and its jump after making a space (app:enter-space { action: 'setup' }). Enters the space (not the call:
// joinInvitedSpace, as an invitation does), then opens the panel on the tab asked for (pickTab: an unknown one is the
// first tab). Someone who may not set up gets the space without the panel. Already setting this space up: the tab.
async function openSetupFor(id, tab = '') {
  // The Lobby has no Set up any more (plan-home-lobby.md, step 2): /?setup=lobby opens Manage at its Spaces tab, where
  // Home's row is, for owners and the admin; anyone else stays on Home.
  if (isHomeRecord(id)) {
    landOnHome();
    if (hasOwnerRights(me)) openOverlay('/admin#spaces');
    return;
  }
  const hash = tab ? `#${String(tab).replace(/^#/, '')}` : '';
  if (settingUp && currentSpace?.id === id) { if (hash) spaceSetup.select(hash.slice(1)); return; }
  await joinInvitedSpace(id);
  if (entered && currentSpace?.id === id && canSetUp()) enterSetup({ tab: hash });
}

// After Save: the space the server answered goes into this page's records (the name in the bar and on the card, the
// picture), presence is read again so everyone's copy follows, and the line says what happened.
function setupSaved(space, said, saved = []) {
  if (space && currentSpace && space.id === currentSpace.id) {
    const record = presenceSpaces.find((r) => r.id === space.id);
    if (record) Object.assign(record, space);
    if (currentSpace !== record) Object.assign(currentSpace, space);
    // The budget target is not kept on this page's records (the presence list leaves it out): the modules hear it.
    if (record) delete record.budget;
    delete currentSpace.budget;
    if (saved.includes('budget')) announceBudget(space.id, space.budget || null);
    spaceName = spaceDisplayName(currentSpace);
    renderSpaces();
    announcePhases();
    if (saved.includes('image') || saved.includes('imageRemoved')) {
      const img = $('spaces')?.querySelector(`[data-space="${CSS.escape(space.id)}"] .space-choice-image`);
      if (img && !img.hidden) img.src = `/img/space/${encodeURIComponent(space.id)}?v=${Date.now()}`;
    }
  }
  loadPresence();
  updateCrumb();
  if (saved.includes('defaultLayout')) refreshLayouts(); // the Layout menu's Default mark follows the first visit
  if (said) saySetup(said);
}
// After Delete (the panel's own question; it does not wait for Save): the space is gone, so this page leaves it and
// shows Home, and a reload does not try it again.
function setupDeleted(space) {
  forgetSpace();
  if (entered) leaveSpaceNow(); // Home shows
  else loadPresence();
  saySetup(`Deleted ${space.name || word('space')}.`);
}
// The one line after Save, read out, under the canvas's edge for a moment.
const setupSaid = document.createElement('p');
setupSaid.id = 'space-setup-said';
setupSaid.className = 'setup-said';
setupSaid.setAttribute('role', 'status');
setupSaid.setAttribute('aria-live', 'polite');
setupSaid.hidden = true;
document.body.appendChild(setupSaid);
let setupSaidTimer = 0;
function saySetup(text) {
  setupSaid.textContent = text;
  setupSaid.hidden = false;
  clearTimeout(setupSaidTimer);
  setupSaidTimer = setTimeout(() => { setupSaid.hidden = true; }, 8000);
}
// Escape anywhere on the page cancels (asking when something was edited), unless something of its own is open (the
// phase sheet, a menu, the Layout panel), which Escape closes first; the panel's own Escape is its own (space-setup.js).
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !settingUp || event.defaultPrevented) return;
  if (event.target.closest?.('#space-setup')) return;
  if (document.querySelector('dialog[open], .host-menu:not(.host-menu-inline), .module-chooser-list:not([hidden]), .who-here-list:not([hidden])')) return;
  event.preventDefault();
  spaceSetup.cancel();
});
// Set up, wider than a phone, sits after your picture and before the window controls (`place: 'end'`, in their group
// 'space', so no divider between them; Thomas, 2026-10-13: "Settings should go right before the window controls"). On a
// phone `place` is not read and it keeps its place in the menu (groupOrder 85, before the bell's 90 and you 999).
nav.register({ id: 'setup', bar: 'primary', zone: 'right', group: 'space', groupOrder: 85, order: 1, place: 'end', icon: 'sliders', label: setupLabel(), toggleable: true, active: false, visible: setupShown, onClick: () => (settingUp ? spaceSetup.cancel() : enterSetup({ tab: '#show' })) });
// Set up's tooltip and name for a screen reader: "<space word> Configuration" (Room Configuration, Trip Configuration), in
// the template's word; in an aside, where it holds only the Modules tab, the aside's word. Home has no Set up button.
// Registered again once the environment's words are in, and when the page enters a space or an aside.
function setupLabel() {
  return configurationLabel(word, inAside());
}
function paintSetupLabel() {
  const tool = nav.get('setup');
  if (tool && tool.label !== setupLabel()) nav.register({ ...tool, label: setupLabel() });
}
// --- end Set up ---

// --- the Layout menu's Layouts section (plan-saved-layouts.md, step 3; Thomas, 2026-10-13: in the shared menu) --------
// The layouts of the space you are in: GET /api/spaces/:id/layouts answers { system, mine, shared, defaultLayout,
// canShare, canSetDefault, favorites }. The section's entries (layoutMenuItems, drawn by canvas.js at the end of the
// Layout menu): a heading, the system layouts (plan-layout-views.md, step 2: the Workspace, Calendar and Map, each its
// icon and name, a press shows it as its tab does, and for Calendar and Map a ... with Favorite or Unfavorite, which
// keeps or takes away its tab), then the shared layouts, then your own, each an entry that loads it (canvas.loadLayout)
// and leaves the menu open, with a ... that offers, for everyone signed in, Favorite or Unfavorite (a favorite is a tab;
// no limit, decision 13); for an owner on a shared layout, Make default or Stop using as default (decision 4); and on a layout
// you may change (your own, or a shared one for owners, the admin and the space's moderators), Replace with this layout,
// Rename and Delete (asked once, in the menu's own confirm row). A favorite's entry shows a small heart, the default
// one the word Default. Then Save this layout, which opens a small sheet (openLayoutSheet): a name and, for those who
// may share, a switch for everyone in the space; Rename opens the same sheet. A guest loads shared layouts only. The
// server keeps the limits (10 of your own and 10 shared in a space, names up to 40 characters, each name once in its
// list) and says what it refuses; its sentence is shown as it is. Not drawn on a narrow canvas, in an aside, or for a
// guest with nothing to load.
let layoutList = { spaceId: null, mine: [], shared: [], system: [], firstVisit: null, defaultLayout: null, favorites: [], canShare: false, canSetDefault: false };
let layoutAsk = 0; // the latest request for the list; an older answer arriving late is dropped
const layoutSpaceId = () => (currentSpace && !currentSpace.isAside ? currentSpace.id : null); // an aside has no layouts
const layoutUrl = (id, layoutId = '') => `/api/spaces/${encodeURIComponent(id)}/layouts${layoutId ? `/${encodeURIComponent(layoutId)}` : ''}${guestToken ? `?guest=${encodeURIComponent(guestToken)}` : ''}`;
// A request that keeps the server's whole answer on a refusal: a taken name answers 409 with the id of the layout that
// has it, so the sheet can offer to replace that one.
async function layoutRequest(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = res.status === 204 ? {} : await res.json(); } catch { data = {}; }
  if (!res.ok) throw Object.assign(new Error(typeof data.error === 'string' && data.error ? data.error : 'That did not work. Try again.'), { status: res.status, id: data.id || null });
  return data;
}
const mayChangeLayout = (shared) => !guestMode && (!shared || layoutList.canShare);
// Making a shared layout the space's default is the owners' and the admin's, as Opens with is (decision 4).
const maySetDefault = (shared) => !guestMode && shared && layoutList.canSetDefault;
const findLayout = (id) => layoutList.shared.find((l) => l.id === id) || layoutList.mine.find((l) => l.id === id) || null;
// Favorites are each signed-in person's own; a guest keeps none (decision 4). No limit (plan-layout-views.md, decision 13).
const mayFavorite = () => !guestToken && Boolean(me?.key) && me.role !== 'guest';
const isFavorite = (id) => layoutList.favorites.includes(id);
const findSystemLayout = (id) => layoutList.system.find((l) => l.id === id) || null;

// Reads the list again (the menu opening, after a change) and draws it: the menu's section (while it is open) and the
// layout tabs in the top bar.
async function refreshLayouts() {
  const id = layoutSpaceId();
  const ask = ++layoutAsk;
  if (!id) {
    layoutList = { spaceId: null, mine: [], shared: [], system: [], firstVisit: null, defaultLayout: null, favorites: [], canShare: false, canSetDefault: false };
    renderLayouts();
    return;
  }
  try {
    const got = await layoutRequest('GET', layoutUrl(id));
    if (ask !== layoutAsk || layoutSpaceId() !== id) return;
    layoutList = { spaceId: id, mine: got.mine || [], shared: got.shared || [], system: Array.isArray(got.system) ? got.system : [], firstVisit: got.firstVisit && typeof got.firstVisit.layout === 'string' ? got.firstVisit : null, defaultLayout: got.defaultLayout || null, favorites: Array.isArray(got.favorites) ? got.favorites : [], canShare: Boolean(got.canShare), canSetDefault: Boolean(got.canSetDefault) };
  } catch {
    if (ask !== layoutAsk) return;
    layoutList = { spaceId: id, mine: [], shared: [], system: [], firstVisit: null, defaultLayout: null, favorites: [], canShare: false, canSetDefault: false };
  }
  renderLayouts();
}
function renderLayouts() {
  renderLayoutTabs(); // the top bar's layout tabs, from the same list
  // The tab shown was unfavorited or deleted: back to the Workspace, which is the one that remembers.
  if (currentLayoutTab !== 'workspace' && layoutList.spaceId && layoutList.spaceId === layoutSpaceId() && !layoutTabList().some((t) => t.layout === currentLayoutTab) && !findLayout(currentLayoutTab)) pressLayoutTab('workspace');
  canvas.refreshMenu(); // and the menu's Layouts section, while it is open
}

// The Layouts section's entries, in the shared menu's item shape (host-menu.js): what canvas.js draws after Arrange.
// Nothing where there is nothing to load or save (an aside; a guest with no shared layouts) or on a narrow canvas.
function layoutMenuItems() {
  const { mine, shared } = layoutList;
  const canSave = Boolean(layoutList.spaceId) && !guestMode;
  const empty = !layoutList.spaceId || (!canSave && !shared.length);
  if (empty || canvas.isNarrow()) return [];
  const entry = (l, isShared) => ({
    icon: userLayoutIcon(l, isShared),
    label: l.name,
    mark: isFavorite(l.id) ? 'heart' : undefined,
    tag: l.id === layoutList.defaultLayout ? 'Default' : undefined,
    keepOpen: true,
    radio: true,
    checked: l.id === currentLayoutTab, // the layout shown now
    onPick: () => { pressLayoutTab(l.id); },
    more: mayFavorite() || mayChangeLayout(isShared) || maySetDefault(isShared) ? () => layoutRowItems(l.id) : undefined,
  });
  const items = [{ heading: 'Layouts' }];
  // The system layouts first (plan-layout-views.md, steps 2 and 4): a press shows it as its tab does; its ... (anyone
  // signed in: the choices are their own) holds Favorite or Unfavorite for Calendar and Map (their tab; the Workspace's
  // always stays), then Rename and Change icon (systemRowItems). Never Delete: a system layout stays.
  for (const l of layoutList.system) {
    const tabbed = l.id !== 'workspace' && l.tab !== false;
    items.push({
      icon: /^[a-z0-9-]{1,40}$/.test(l.icon || '') ? l.icon : 'object-group',
      label: l.name,
      mark: tabbed ? 'heart' : undefined,
      tag: l.id !== 'workspace' && l.id === layoutList.firstVisit?.layout ? 'Default' : undefined, // Calendar or Map as the first visit (Set up)
      radio: true,
      checked: l.id === currentLayoutTab,
      onPick: () => pressLayoutTab(l.id),
      more: mayFavorite() ? () => systemRowItems(l.id) : undefined,
    });
  }
  // Modified: right under the layout shown, with Update where this person may change it (otherwise the word alone).
  const withModified = (l, isShared) => {
    items.push(entry(l, isShared));
    if (layoutModified && l.id === currentLayoutTab) {
      items.push(mayChangeLayout(isShared)
        ? { icon: 'arrows-rotate', label: 'Update', tag: 'Modified', keepOpen: true, onPick: () => updateLayout(l.id) }
        : { label: 'Modified', disabled: true });
    }
  };
  for (const l of shared) withModified(l, true);
  for (const l of mine) withModified(l, false);
  if (!shared.length && !mine.length && canSave) items.push({ label: 'No saved layouts yet.', disabled: true });
  if (canSave) {
    items.push({ icon: 'plus', label: 'New layout', onPick: () => openSaveLayout({ blank: true }) });
    items.push({ icon: 'floppy-disk', label: 'Save as new layout', onPick: () => openSaveLayout() });
  }
  return items;
}

// A saved layout's row icon: the one chosen for it (Change icon), else, as before, the two people of a shared layout
// or the Layout button's for your own (the server answers the Layout button's for one stored without an icon).
const userLayoutIcon = (l, isShared) => (/^[a-z0-9-]{1,40}$/.test(l.icon || '') && l.icon !== 'object-group' ? l.icon : isShared ? 'user-group' : 'object-group');

// A system layout's ... (plan-layout-views.md, step 4): Favorite or Unfavorite for Calendar and Map (never the
// Workspace, whose tab always stays), a divider, then Rename and Change icon, each this person's own. No Delete.
function systemRowItems(systemId) {
  const l = findSystemLayout(systemId);
  if (!l || !mayFavorite()) return [];
  const entries = [];
  if (l.id !== 'workspace') {
    entries.push(l.tab !== false
      ? { icon: 'heart', label: 'Unfavorite', onPick: () => setFavorite(l, false) }
      : { icon: 'heart', regular: true, label: 'Favorite', onPick: () => setFavorite(l, true) });
    entries.push({ divider: true });
  }
  entries.push(
    { icon: 'pen', label: 'Rename', onPick: () => startRename(l.id) },
    { icon: 'icons', label: 'Change icon', onPick: () => startChangeIcon(l.id) },
  );
  return entries;
}

// A layout's ...: Favorite or Unfavorite first, for everyone signed in (plan-favorite-layouts.md; no limit,
// plan-layout-views.md decision 13); then, for an owner on a shared layout, Make default or
// Stop using as default (decision 4); then, on a layout you may change, Replace with this layout, Rename, Delete (asked
// once, in the menu's own confirm row under the Layout button). A divider between each run.
function layoutRowItems(layoutId) {
  const layout = findLayout(layoutId);
  if (!layout) return [];
  const shared = layoutList.shared.includes(layout);
  const trigger = () => nav.elementOf('setup');
  const entries = [];
  if (mayFavorite()) {
    entries.push(isFavorite(layoutId)
      ? { icon: 'heart', label: 'Unfavorite', onPick: () => setFavorite(layout, false) }
      : { icon: 'heart', regular: true, label: 'Favorite', onPick: () => setFavorite(layout, true) });
  }
  if (maySetDefault(shared)) {
    if (entries.length) entries.push({ divider: true });
    entries.push(layoutList.defaultLayout === layoutId
      ? { icon: 'star', regular: true, label: 'Stop using as default', onPick: () => setDefaultLayout(null, layout) }
      : { icon: 'star', label: 'Make default', onPick: () => setDefaultLayout(layoutId, layout) });
  }
  if (!mayChangeLayout(shared)) return entries;
  if (entries.length) entries.push({ divider: true });
  return [
    ...entries,
    { icon: 'arrows-rotate', label: 'Replace with this layout', onPick: () => replaceLayout(layoutId) },
    { icon: 'pen', label: 'Rename', onPick: () => startRename(layoutId) },
    { icon: 'icons', label: 'Change icon', onPick: () => startChangeIcon(layoutId) },
    { icon: 'trash', label: 'Delete', danger: true, onPick: () => openConfirmMenu(trigger(), {
      label: 'Delete', confirm: `Delete ${layout.name}?`, armed: true, fail: 'It could not be deleted.',
      onConfirm: async () => {
        await layoutRequest('DELETE', layoutUrl(layoutSpaceId(), layoutId));
        layoutNote(`Deleted ${layout.name}.`);
        await refreshLayouts();
      },
    }) },
  ];
}

// Favorite (`on`) or Unfavorite: PUT or DELETE /api/spaces/:id/layouts/:layoutId/favorite, which answers this person's
// favorites and the layout ({ favorites, layout }: for Calendar and Map, its `tab`). The list and the tabs are drawn
// again, and the menu's note says what changed. A layout gone meanwhile (404) or any
// refusal: the server's sentence, and the list read again.
async function setFavorite(layout, on) {
  const id = layoutSpaceId();
  if (!id) return;
  try {
    const { favorites, layout: answered } = await layoutRequest(on ? 'PUT' : 'DELETE', `/api/spaces/${encodeURIComponent(id)}/layouts/${encodeURIComponent(layout.id)}/favorite`);
    if (layoutSpaceId() !== id || layoutList.spaceId !== id) return;
    layoutList.favorites = Array.isArray(favorites) ? favorites : [];
    const system = findSystemLayout(layout.id);
    if (system) system.tab = answered && typeof answered.tab === 'boolean' ? answered.tab : on;
    layoutNote(on ? `${layout.name} is a favorite.` : `${layout.name} is no longer a favorite.`);
    renderLayouts();
  } catch (err) {
    layoutNote(err.message || 'That did not work. Try again.');
    await refreshLayouts();
  }
}

// Makes a shared layout what a first visit opens, or stops (`layoutId` null: the Workspace again): PATCH /api/spaces/:id
// with `defaultLayout` alone. Opens with is not touched either way (plan-layout-views.md, step 5: it is the Workspace's
// own content). Then the list again, for the Default mark.
async function setDefaultLayout(layoutId, layout) {
  const id = layoutSpaceId();
  if (!id) return;
  try {
    const { space } = await api('PATCH', `/api/spaces/${encodeURIComponent(id)}`, { defaultLayout: layoutId });
    if (space && currentSpace?.id === space.id) Object.assign(currentSpace, { opensWith: space.opensWith ?? null, defaultLayout: space.defaultLayout ?? null });
    layoutNote(layoutId ? `A first visit opens ${layout.name} now.` : `${layout.name} is no longer the default. A first visit opens the Workspace.`);
  } catch (err) {
    layoutNote(err.message || 'That did not work. Try again.');
  }
  await refreshLayouts();
}

// Replaces a layout's modules and places with the canvas as it is now. From the Save sheet, its "Replace it" (a taken
// name): `sheet` is that sheet, which shows the refusal and closes on success.
async function replaceLayout(layoutId, sheet = null) {
  const id = layoutSpaceId();
  if (!id) return;
  const captured = canvas.captureLayout();
  try {
    const { layout } = await layoutRequest('PUT', layoutUrl(id, layoutId), captured);
    if (sheet) sheet.close();
    layoutNote(`${layout.name} now holds this layout.`);
    if (layoutId === currentLayoutTab) { layoutBase = captured; setModified(false); }
    await refreshLayouts();
  } catch (err) {
    if (sheet) sheet.error(err.message); else layoutNote(err.message);
  }
}

// The small sheet (a <dialog>) for Save this layout and Rename: Name, for Save the share switch (those who may share),
// the server's refusal under them, and the action bar (action-bar.js): Save, off until the name or the switch changed,
// and Cancel. A click outside does nothing; Escape or Cancel closes it, asking "Discard changes?" when something was
// typed; Enter in the name saves. `onSave(name,
// shared, sheet)` does the work and closes the sheet (sheet.close) or shows what went wrong (sheet.error, with
// `replaceId` for a taken name: "Replace it" beside the sentence). Opened from the Layout button, which takes the
// keyboard back when the sheet closes. `emptyName` (Rename on a system layout): the name an empty field stands for,
// its default; the field's placeholder shows it, a line under it says so, and an empty name saves as that default.
function openLayoutSheet({ title, name = '', share = null, emptyName = '', onSave }) {
  const doc = canvasDoc();
  const dlg = doc.createElement('dialog');
  dlg.className = 'layout-sheet';
  dlg.setAttribute('aria-label', title);
  dlg.innerHTML = `
    <form class="layout-form" novalidate>
      <div class="layout-form-body action-content">
      <h2 class="layout-sheet-title">${escapeHtml(title)}</h2>
      <label class="layout-field"><span class="layout-field-label">Name</span><input type="text" id="layout-name" autocomplete="off" spellcheck="false" maxlength="40"></label>
      <p class="layout-field-hint" id="layout-name-hint" hidden></p>
      <label class="sdk-choice-row" id="layout-shared-row" hidden><i class="fa-solid fa-user-group fa-fw" aria-hidden="true"></i><span class="sdk-choice-text"><span class="sdk-choice-label" id="layout-shared-label"></span></span><input type="checkbox" class="sdk-switch" role="switch" id="layout-shared"></label>
      <p class="layout-form-error" id="layout-form-error" role="alert" hidden></p>
      </div>
    </form>`;
  const form = dlg.querySelector('form');
  const input = dlg.querySelector('#layout-name');
  const sharedRow = dlg.querySelector('#layout-shared-row');
  const sharedSwitch = dlg.querySelector('#layout-shared');
  const errorEl = dlg.querySelector('#layout-form-error');
  dlg.querySelector('#layout-shared-label').textContent = `For everyone in this ${word('space')}`;
  input.value = name;
  if (emptyName) {
    input.placeholder = emptyName;
    const hint = dlg.querySelector('#layout-name-hint');
    hint.textContent = `Leave it empty for ${emptyName}.`;
    hint.hidden = false;
    input.setAttribute('aria-describedby', hint.id);
  }
  sharedRow.hidden = share === null;
  sharedSwitch.checked = Boolean(share);
  wireSwitchList(form); // Enter flips the share switch, as Space does
  const opener = nav.elementOf('setup');
  let failed = false; // the last save was refused (sheet.error)
  const bar = actionBar({
    submit: true,
    label: 'Save the layout',
    doc,
    ids: { save: 'layout-save', cancel: 'layout-cancel' },
    dirty: () => input.value.trim() !== name.trim() || (share !== null && sharedSwitch.checked !== Boolean(share)),
    onCancel: () => sheet.close(),
    onSave: async () => {
      const value = input.value.trim();
      if (!value && !emptyName) { sheet.error('Give the layout a name.'); return false; }
      failed = false;
      await onSave(value, share !== null && layoutList.canShare && sharedSwitch.checked, sheet);
      return !failed;
    },
  });
  form.appendChild(bar.el);
  const sheet = {
    close: () => { if (dlg.open) dlg.close(); },
    error: (text, replaceId = null) => {
      failed = true;
      errorEl.hidden = false;
      errorEl.textContent = text;
      if (replaceId) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'layout-replace-it';
        b.textContent = 'Replace it';
        b.addEventListener('click', () => replaceLayout(replaceId, sheet));
        errorEl.append(' ', b);
      }
      input.focus();
    },
  };
  // No click on the backdrop closes it. Escape is Cancel, and asks first when something was typed.
  bar.bindEscape(dlg);
  dlg.addEventListener('cancel', (event) => { event.preventDefault(); bar.requestCancel(); });
  form.addEventListener('input', () => bar.refresh());
  form.addEventListener('change', () => bar.refresh());
  dlg.addEventListener('close', () => {
    dlg.remove();
    if (opener && opener.isConnected && opener.getClientRects().length) opener.focus();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    bar.save();
  });
  doc.body.appendChild(dlg);
  dlg.showModal();
  input.focus();
  input.select();
  return sheet;
}
// New layout (`blank`): a layout with no module open, the arrangement mode and snap as they are now. Save as new layout:
// the canvas as it is. Both ask the name in the same sheet, save with POST, then show the new layout (it becomes the one
// shown: a Save as new layout leaves the canvas as it is, a New layout empties it).
function openSaveLayout({ blank = false } = {}) {
  const id = layoutSpaceId();
  if (!id) return;
  openLayoutSheet({
    title: blank ? 'New layout' : 'Save as new layout',
    share: layoutList.canShare ? false : null,
    onSave: async (name, shared, sheet) => {
      const now = canvas.captureLayout();
      const captured = blank ? { modules: [], arrange: now.arrange, ...(now.snap ? { snap: now.snap } : {}) } : now;
      try {
        const { layout } = await layoutRequest('POST', layoutUrl(id), { name, shared, ...captured });
        sheet.close();
        layoutNote(blank ? `Created ${layout.name}.` : `Saved ${layout.name}.`);
        await refreshLayouts();
        if (layoutSpaceId() === id) pressLayoutTab(layout.id, null, { load: blank });
      } catch (err) {
        sheet.error(err.message, err.status === 409 ? err.id : null);
      }
    },
  });
}
// Rename: the same sheet with the name filled in; Enter saves, Escape leaves it as it was. A system layout (the
// Workspace, Calendar, Map: plan-layout-views.md, step 4) is renamed for this person alone, PATCH
// .../layouts/system/:id; an empty name (the field cleared) puts its default name back ({ name: null }). A saved
// layout is renamed with PUT .../layouts/:id, as before (a name is required). The tab and the menu row are drawn again.
const systemLayoutUrl = (id, systemId) => `/api/spaces/${encodeURIComponent(id)}/layouts/system/${encodeURIComponent(systemId)}`;
function startRename(layoutId) {
  const system = findSystemLayout(layoutId);
  const layout = system || findLayout(layoutId);
  if (!layout) return;
  openLayoutSheet({
    title: 'Rename',
    name: layout.name,
    emptyName: system ? system.defaultName || '' : '',
    onSave: async (name, _shared, sheet) => {
      if (name === layout.name) { sheet.close(); return; }
      try {
        if (system) await layoutRequest('PATCH', systemLayoutUrl(layoutSpaceId(), layoutId), { name: name || null });
        else await layoutRequest('PUT', layoutUrl(layoutSpaceId(), layoutId), { name });
        sheet.close();
        await refreshLayouts();
      } catch (err) {
        sheet.error(err.message);
      }
    },
  });
}

// Change icon (plan-layout-views.md, decision 4, "Icons" and step 4): a small sheet like the layout sheet, on the shared
// action bar (Save off until another icon is picked; Cancel and Escape ask when one was; a click outside does nothing),
// with a search field over a grid of the icons a layout may wear (layoutIconChoices: the defaults, the environment's
// icon list, the current one), the current one marked. The grid is a radiogroup: one stop for Tab, the arrows move and
// pick (gridStep), Home and End; each icon is a radio named by its words. `defaultIcon` (a system layout's): a
// "Reset to default" button that picks it. `onSave(icon, sheet)` does the work and closes the sheet or shows why not.
function openIconSheet({ title, current = '', defaultIcon = '', onSave }) {
  const doc = canvasDoc();
  const choices = layoutIconChoices({ icons: getIcons(), system: layoutList.system, current });
  let chosen = current;
  const dlg = doc.createElement('dialog');
  dlg.className = 'layout-sheet layout-icon-sheet';
  dlg.setAttribute('aria-label', title);
  dlg.innerHTML = `
    <form class="layout-form" novalidate>
      <div class="layout-form-body action-content">
      <h2 class="layout-sheet-title">${escapeHtml(title)}</h2>
      <label class="layout-field"><span class="layout-field-label">Find an icon</span><span class="sdk-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input type="search" id="layout-icon-search" autocomplete="off" spellcheck="false" maxlength="40"></span></label>
      <div class="icon-grid layout-icon-grid" id="layout-icon-grid" role="radiogroup" aria-label="Icon"></div>
      <p class="layout-field-hint" id="layout-icon-none" role="status" hidden>No icon matches.</p>
      ${defaultIcon ? '<button type="button" class="btn btn-small layout-icon-reset" id="layout-icon-reset">Reset to default</button>' : ''}
      <p class="layout-form-error" id="layout-form-error" role="alert" hidden></p>
      </div>
    </form>`;
  const form = dlg.querySelector('form');
  const search = dlg.querySelector('#layout-icon-search');
  const grid = dlg.querySelector('#layout-icon-grid');
  const none = dlg.querySelector('#layout-icon-none');
  const errorEl = dlg.querySelector('#layout-form-error');
  grid.innerHTML = choices.map((c) => `<button type="button" role="radio" aria-checked="false" tabindex="-1" data-icon-choice="${escapeHtml(c.id)}" aria-label="${escapeHtml(c.label)}" data-tip="${escapeHtml(c.label)}"><i class="fa-solid fa-${escapeHtml(c.id)} fa-fw" aria-hidden="true"></i></button>`).join('');
  const radios = () => [...grid.querySelectorAll('[data-icon-choice]')].filter((b) => !b.hidden);
  // The one Tab stop: the icon picked while it shows, else the first that shows.
  function mark() {
    const shown = radios();
    const stop = shown.find((b) => b.dataset.iconChoice === chosen) || shown[0] || null;
    for (const b of grid.querySelectorAll('[data-icon-choice]')) {
      const on = b.dataset.iconChoice === chosen;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.classList.toggle('selected', on);
      b.tabIndex = b === stop ? 0 : -1;
    }
  }
  function pick(button, focus = false) {
    if (!button) return;
    chosen = button.dataset.iconChoice;
    mark();
    if (focus) button.focus();
    bar.refresh();
  }
  grid.addEventListener('click', (event) => pick(event.target.closest('[data-icon-choice]')));
  grid.addEventListener('keydown', (event) => {
    const shown = radios();
    const at = shown.indexOf(event.target.closest('[data-icon-choice]'));
    if (at < 0) return;
    // Columns as drawn: the icons on the first row's line.
    const columns = shown.filter((b) => b.offsetTop === shown[0].offsetTop).length || 1;
    const next = gridStep(at, event.key, shown.length, columns);
    if (next < 0) return;
    event.preventDefault();
    pick(shown[next], true);
  });
  search.addEventListener('input', () => {
    let any = false;
    for (const b of grid.querySelectorAll('[data-icon-choice]')) {
      const c = choices.find((x) => x.id === b.dataset.iconChoice);
      b.hidden = !iconMatches(c, search.value);
      if (!b.hidden) any = true;
    }
    none.hidden = any;
    mark();
  });
  // Enter in the search field picks nothing and saves nothing; it moves to the grid.
  search.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    grid.querySelector('[data-icon-choice][tabindex="0"]')?.focus();
  });
  dlg.querySelector('#layout-icon-reset')?.addEventListener('click', () => {
    if (search.value) { search.value = ''; search.dispatchEvent(new Event('input')); }
    pick(grid.querySelector(`[data-icon-choice="${CSS.escape(defaultIcon)}"]`), true);
  });
  const opener = nav.elementOf('setup');
  let failed = false;
  const bar = actionBar({
    submit: true,
    label: 'Save the icon',
    doc,
    ids: { save: 'layout-icon-save', cancel: 'layout-icon-cancel' },
    dirty: () => chosen !== current,
    onCancel: () => sheet.close(),
    onSave: async () => {
      failed = false;
      await onSave(chosen, sheet);
      return !failed;
    },
  });
  form.appendChild(bar.el);
  const sheet = {
    close: () => { if (dlg.open) dlg.close(); },
    error: (text) => {
      failed = true;
      errorEl.hidden = false;
      errorEl.textContent = text;
    },
  };
  // No click on the backdrop closes it. Escape is Cancel, and asks first when another icon was picked.
  bar.bindEscape(dlg);
  dlg.addEventListener('cancel', (event) => { event.preventDefault(); bar.requestCancel(); });
  dlg.addEventListener('close', () => {
    dlg.remove();
    if (opener && opener.isConnected && opener.getClientRects().length) opener.focus();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    bar.save();
  });
  mark();
  bar.refresh();
  doc.body.appendChild(dlg);
  dlg.showModal();
  (grid.querySelector('[data-icon-choice][tabindex="0"]') || search).focus();
  return sheet;
}
// Change icon on a layout's row: a system layout's through PATCH .../layouts/system/:id (its default icon saved as
// null, so it follows the default), a saved layout's through PUT .../layouts/:id { icon }. Then the list again: the
// tab and the menu row wear the new icon.
function startChangeIcon(layoutId) {
  const system = findSystemLayout(layoutId);
  const layout = system || findLayout(layoutId);
  if (!layout) return;
  const current = /^[a-z0-9-]{1,40}$/.test(layout.icon || '') ? layout.icon : system ? system.defaultIcon || 'object-group' : 'object-group';
  openIconSheet({
    title: `Change icon: ${layout.name}`,
    current,
    defaultIcon: system ? system.defaultIcon || '' : '',
    onSave: async (icon, sheet) => {
      if (icon === current) { sheet.close(); return; }
      try {
        if (system) await layoutRequest('PATCH', systemLayoutUrl(layoutSpaceId(), layoutId), { icon: icon === system.defaultIcon ? null : icon });
        else await layoutRequest('PUT', layoutUrl(layoutSpaceId(), layoutId), { icon });
        sheet.close();
        layoutNote(`${layout.name} has a new icon.`);
        await refreshLayouts();
      } catch (err) {
        sheet.error(err.message);
      }
    },
  });
}

// --- the layout tabs (plan-layout-views.md, steps 2 and 3) ----------------------------------------------------------
// Every view is a layout: in the top bar's left zone, right after the space switcher, one tab per layout (layoutTabs()
// in primary-nav.js): the Workspace, then Calendar and Map while the server lists them for this space and their tab is
// kept, then this person's favorite saved layouts in the order they were favorited, with no limit. Each wears the top
// bar's link look, its icon and its name, `aria-current="page"` on the one shown; each is a button of its own, reached
// by Tab in order, shown by Enter or Space. A press shows its layout: the Workspace puts back this person's own
// remembered arrangement; any other tab loads its layout through canvas.loadLayout, the path a saved layout takes:
// Calendar and Map are the system layouts `calendar` and `map` (one docked module, `calendar` or `maps`, which reads as
// the composite `dest:calendar` or `dest:map` filling the canvas). Only the Workspace remembers (decision 15): while
// another tab is shown the canvas writes nothing (canvas.holdMemory), so the Workspace comes back as it was; the
// Layout menu, Full screen and Pop out stay on every tab (workspaceShown). When the bar is tight
// the tabs leave from the right into a "..." after the last one shown (tabOverflow()), which opens the shared menu
// listing them, each with its icon; the Workspace and the tab shown never leave. That happens first, before anything
// folds (nav-bar.js's fitLeft; only Who is here, after them, gives way before they do, Thomas 2026-10-14). No tabs for a guest, in an aside, while home is shown,
// or on a phone (640px and below: the tab bar holds the composites as module tabs). A load that leaves something out
// says so under the tab for 6 seconds (#layout-favorites-note, seen) and to #layout-announce (heard, layoutNote).
const layoutTabsEl = document.createElement('span');
layoutTabsEl.id = 'layout-tabs';
layoutTabsEl.className = 'layout-tabs';
layoutTabsEl.setAttribute('role', 'group');
layoutTabsEl.setAttribute('aria-label', 'Layouts');
const layoutTabsMore = document.createElement('button');
layoutTabsMore.type = 'button';
layoutTabsMore.id = 'layout-tabs-more';
layoutTabsMore.className = 'core-link layout-tabs-more';
layoutTabsMore.dataset.tip = 'More layouts';
layoutTabsMore.setAttribute('aria-label', 'More layouts');
layoutTabsMore.setAttribute('aria-haspopup', 'menu');
layoutTabsMore.setAttribute('aria-expanded', 'false');
layoutTabsMore.hidden = true;
layoutTabsMore.innerHTML = '<i class="fa-solid fa-ellipsis-vertical fa-fw" aria-hidden="true"></i>';
const favoritesNote = document.createElement('p');
favoritesNote.id = 'layout-favorites-note';
favoritesNote.className = 'layout-favorites-note';
favoritesNote.setAttribute('aria-hidden', 'true'); // heard through #layout-announce, once
favoritesNote.hidden = true;
layoutTabsEl.append(layoutTabsMore, favoritesNote);
let favoritesNoteTimer = 0;
let favoritesNoteAt = null; // the tab the note hangs under
function showFavoritesNote(text) {
  clearTimeout(favoritesNoteTimer);
  favoritesNote.textContent = text;
  favoritesNote.hidden = !text;
  if (!text) return;
  // Fixed under the tab pressed (the left zone clips what hangs out of it), inside the window.
  const at = (favoritesNoteAt && favoritesNoteAt.isConnected && favoritesNoteAt.getClientRects().length ? favoritesNoteAt : layoutTabsEl).getBoundingClientRect();
  const view = favoritesNote.ownerDocument.defaultView || window;
  favoritesNote.style.top = `${Math.round(at.bottom + 6)}px`;
  favoritesNote.style.left = `${Math.round(Math.max(8, Math.min(at.left, view.innerWidth - favoritesNote.offsetWidth - 8)))}px`;
  favoritesNoteTimer = setTimeout(() => showFavoritesNote(''), 6000);
}
// The layout shown now: the canvas's tab.
const shownLayoutTab = () => currentLayoutTab;
// A first visit that opens on Calendar or Map (canvas.restore()'s answer; plan-layout-views.md, step 5): once the space's
// layouts are read, its tab is pressed as a person would, so the Workspace stays behind, remembered. Not when the space
// was left meanwhile, another tab was pressed, or the tab is not there (turned off, or this person unfavorited it).
function showFirstVisitTab(id, spaceId) {
  if (!id || currentLayoutTab !== 'workspace' || layoutSpaceId() !== spaceId || layoutList.spaceId !== spaceId) return;
  if (layoutTabList().some((t) => t.layout === id)) pressLayoutTab(id);
}
function layoutTabList() {
  return layoutTabs({
    system: layoutList.spaceId === layoutSpaceId() ? layoutList.system : [],
    favorites: mayFavorite() && layoutList.spaceId === layoutSpaceId() ? layoutList.favorites : [],
    layouts: [...layoutList.shared, ...layoutList.mine],
    current: shownLayoutTab(),
    guest: Boolean(guestToken) || me?.role === 'guest',
    aside: inAside(),
    space: layoutSpaceId() || '',
  });
}
const layoutTabsWanted = () => oneBar() && !inAside() && !phoneWidth() && layoutTabList().length > 0;
let layoutTabsDrawn = ''; // what the tabs show now, so an unchanged list keeps its buttons (and the keyboard on one)
function renderLayoutTabs() {
  const list = layoutTabList();
  const key = JSON.stringify(list.map((t) => [t.id, t.icon, t.label, t.temp === true]));
  if (key !== layoutTabsDrawn) {
    layoutTabsDrawn = key;
    const doc = layoutTabsEl.ownerDocument;
    const had = doc.activeElement?.closest?.('[data-layout-tab]');
    const hadId = had && layoutTabsEl.contains(had) ? had.dataset.layoutTab : null;
    const buttons = list.map((t) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.id = t.id;
      b.className = 'core-link layout-tab';
      b.dataset.layoutTab = t.layout;
      b.title = t.label;
      b.setAttribute('aria-label', t.label);
      b.innerHTML = `<i class="fa-solid fa-${escapeHtml(t.icon)} fa-fw" aria-hidden="true"></i><span class="core-label">${escapeHtml(t.label)}</span>`;
      if (!t.temp) return [b];
      // A temporary tab (a saved layout shown that is not a favorite): a heart beside it pins it as a favorite.
      const pin = doc.createElement('button');
      pin.type = 'button';
      pin.className = 'core-link layout-tab-pin';
      pin.dataset.tip = 'Favorite';
      pin.setAttribute('aria-label', `Favorite ${t.label}`);
      pin.innerHTML = '<i class="fa-solid fa-heart fa-fw" aria-hidden="true"></i>';
      pin.addEventListener('click', () => { const l = findLayout(t.layout); if (l) setFavorite(l, true); });
      return [b, pin];
    }).flat();
    layoutTabsEl.replaceChildren(...buttons, layoutTabsMore, favoritesNote);
    if (hadId) (layoutTabsEl.querySelector(`[data-layout-tab="${CSS.escape(hadId)}"]`) || layoutTabsEl.querySelector('[data-layout-tab]'))?.focus();
  }
  markLayoutTabs();
  nav.draw('primary'); // the tabs changed: the bar fits again (fitBar)
}
function markLayoutTabs() {
  const shown = shownLayoutTab();
  let outCurrent = false;
  for (const b of layoutTabsEl.querySelectorAll(':scope > [data-layout-tab]')) {
    const on = b.dataset.layoutTab === shown;
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    if (on && b.classList.contains('layout-tab-out')) outCurrent = true;
  }
  placeModified();
  layoutTabsMore.classList.toggle('layout-tabs-more-current', outCurrent); // the one shown is in the "..."
}
// The width the bar gives the group (nav-bar.js's fitLeft, while it measures with nothing shrunk): every tab while they
// all fit; else the tabs leave from the right into the "..." after them, never the Workspace nor the tab shown
// (tabOverflow()). The keyboard on a tab that leaves goes to the "...", where it is now.
function fitLayoutTabs(avail) {
  const doc = layoutTabsEl.ownerDocument;
  const tabs = [...layoutTabsEl.querySelectorAll(':scope > [data-layout-tab]')];
  const focused = doc.activeElement && layoutTabsEl.contains(doc.activeElement) ? doc.activeElement : null;
  for (const b of tabs) b.classList.remove('layout-tab-out');
  layoutTabsMore.hidden = true;
  if (!tabs.length || !layoutTabsEl.getClientRects().length) { markLayoutTabs(); return; }
  const w = (el) => el.getBoundingClientRect().width;
  const gap = parseFloat(doc.defaultView.getComputedStyle(layoutTabsEl).columnGap) || 0;
  layoutTabsMore.hidden = false;
  const more = w(layoutTabsMore);
  layoutTabsMore.hidden = true;
  // A pixel spare: the bar counts the left zone in whole pixels (rounded up) when it decides what folds.
  const current = tabs.findIndex((b) => b.dataset.layoutTab === shownLayoutTab());
  const { out, more: showMore } = tabOverflow({ avail: Math.floor(avail) - 1, gap, widths: tabs.map(w), more, current });
  tabs.forEach((b, i) => b.classList.toggle('layout-tab-out', out.includes(i)));
  layoutTabsMore.hidden = !showMore;
  markLayoutTabs();
  if (focused && focused.closest('.layout-tab-out')) layoutTabsMore.focus();
}
// A press shows the tab's layout, one click, no confirm; the keyboard stays on the tab. The bars are drawn again (the
// focused module's own tools change with the layout) and the tabs fitted again (the one shown never goes into the "...").
function pressLayoutTab(id, from = null, { load = true } = {}) {
  const tab = layoutTabList().find((t) => t.layout === id);
  if (!tab && id !== 'workspace' && !findLayout(id)) return;
  if (id === 'workspace') {
    currentLayoutTab = 'workspace';
    canvas.resumeMemory(); // the Workspace's own arrangement, as it was before another tab was pressed
    rebaseLayout();
    renderLayoutTabs(); // the temporary tab goes
    nav.draw();
    canvas.refreshMenu();
    return;
  }
  // Calendar and Map are system layouts (their `modules`: the composite, docked, filling the canvas), reloaded as saved
  // on every press (decision 15); a favorite is a saved layout. Both load the same way.
  const layout = tab && tab.kind === 'system' ? findSystemLayout(id) : findLayout(id);
  if (!layout || !Array.isArray(layout.modules)) return;
  canvas.holdMemory(); // only the Workspace remembers: from here on nothing is written until it is shown again
  currentLayoutTab = id;
  layoutBase = null;
  renderLayoutTabs(); // a layout that is not a favorite gets its temporary tab
  nav.draw();
  showFavoritesNote('');
  favoritesNoteAt = from;
  noteUnderFavorites = true;
  try {
    if (load) canvas.loadLayout(layout);
  } finally {
    noteUnderFavorites = false;
  }
  rebaseLayout();
  canvas.refreshMenu();
}

// Modified (Thomas, 2026-11-11): the layout shown is a saved one and the arrangement is no longer what it was when it was
// shown. `layoutBase` is the arrangement a moment after the layout was shown (the canvas fits a load to the window, so
// the stored definition itself would differ at once); layoutDiffers() (layouts.js) compares it with the canvas now, once a
// frame after a change (never per mouse move). Update writes the canvas over the layout (PUT, the routes' own rules).
// Nothing is stored; a guest, the Workspace, Calendar and Map (fixed or remembered by themselves) never show it.
let layoutBase = null;
let layoutModified = false;
let layoutBaseTimer = 0;
let layoutCheckFrame = 0;
const layoutModifiedEl = document.createElement('span');
layoutModifiedEl.id = 'layout-modified';
layoutModifiedEl.className = 'layout-modified';
layoutModifiedEl.hidden = true;
function setModified(on) {
  layoutModified = on;
  placeModified();
  canvas.refreshMenu();
}
function rebaseLayout() {
  clearTimeout(layoutBaseTimer);
  layoutBase = null;
  if (layoutModified) setModified(false);
  const id = currentLayoutTab;
  if (!findLayout(id) || guestToken || me?.role === 'guest') return;
  layoutBaseTimer = setTimeout(() => {
    if (currentLayoutTab !== id) return;
    layoutBase = canvas.captureLayout();
    checkModified();
  }, 400);
}
function arrangementChanged() {
  if (!layoutBase || layoutCheckFrame) return;
  layoutCheckFrame = requestAnimationFrame(() => { layoutCheckFrame = 0; checkModified(); });
}
function checkModified() {
  if (!layoutBase) return;
  const cap = canvas.captureLayout();
  const now = layoutDiffers(layoutBase, cap);
  if (now !== layoutModified) setModified(now);
}
async function updateLayout(layoutId) {
  const id = layoutSpaceId();
  const layout = findLayout(layoutId);
  if (!id || !layout) return;
  const captured = canvas.captureLayout();
  try {
    await layoutRequest('PUT', layoutUrl(id, layoutId), captured);
    layoutBase = captured;
    layoutNote(`Updated ${layout.name}.`);
    setModified(false);
    await refreshLayouts();
  } catch (err) {
    layoutNote(err.message || 'That did not work. Try again.');
  }
}
// The mark beside the tab shown: "Modified" and, where this person may change the layout, the Update link.
function placeModified() {
  const layout = layoutModified ? findLayout(currentLayoutTab) : null;
  const tab = layout ? layoutTabsEl.querySelector(`:scope > [data-layout-tab="${CSS.escape(layout.id)}"]`) : null;
  if (!layout || !tab) { layoutModifiedEl.hidden = true; return; }
  const shared = layoutList.shared.includes(layout);
  layoutModifiedEl.replaceChildren(layoutModifiedEl.ownerDocument.createTextNode('Modified'));
  if (mayChangeLayout(shared)) {
    const b = layoutModifiedEl.ownerDocument.createElement('button');
    b.type = 'button';
    b.className = 'layout-update';
    b.textContent = 'Update';
    b.setAttribute('aria-label', `Update ${layout.name}`);
    b.addEventListener('click', () => updateLayout(layout.id));
    layoutModifiedEl.append(' ', b);
  }
  (tab.nextElementSibling?.classList.contains('layout-tab-pin') ? tab.nextElementSibling : tab).after(layoutModifiedEl);
  layoutModifiedEl.hidden = false;
}
layoutTabsEl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-layout-tab]');
  if (!button) return;
  pressLayoutTab(button.dataset.layoutTab, button);
  if (button.isConnected && !button.classList.contains('layout-tab-out')) button.focus();
});
// The "...": the tabs that did not fit, in their order, each with its icon, on the shared menu (Enter, the arrows).
layoutTabsMore.addEventListener('click', () => {
  const out = new Set([...layoutTabsEl.querySelectorAll(':scope > .layout-tab-out')].map((b) => b.dataset.layoutTab));
  const shown = shownLayoutTab();
  const items = layoutTabList().filter((t) => out.has(t.layout)).map((t) => ({
    icon: t.icon,
    label: t.label,
    radio: true,
    checked: t.layout === shown,
    onPick: () => pressLayoutTab(t.layout, layoutTabsMore),
  }));
  openHostMenu(layoutTabsMore, items);
});
// Right after the space switcher, in the views' place (group `views`, after their phone-only entries). Who is here, after
// them, gives way first (its `yieldFirst`); then the tabs go into their "...", before anything on the right folds.
nav.register({ id: 'layout-tabs', bar: 'primary', zone: 'left', group: 'views', groupOrder: 12, order: 10, icon: 'columns', label: 'Layouts', element: layoutTabsEl, visible: layoutTabsWanted, fit: fitLayoutTabs });
// --- end the layout tabs ---
// A toast about a space module opens it on the canvas; an environment module opens over the call.
document.addEventListener('app:notification', (event) => {
  const n = event.detail;
  if (canvas.handleNotification(n)) event.preventDefault();
  else if (n.scope === 'environment' && document.body.classList.contains('in-space')) {
    event.preventDefault();
    openOverlay(`/modules/${encodeURIComponent(n.module)}`);
  }
});

function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch (err) {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (err) {
    // private mode or storage off: the session still works
  }
}

// The mic/camera processing fields (not device selection) also live on the
// account -- see populateCallSettingsUI -- so a change here follows to the
// profile page and to wherever else this account joins from. A guest has no
// account to save it to; localStorage above is all they get. Debounced and
// accumulated across fields so dragging a slider doesn't fire a request per
// tick.
let pendingCallPrefs = {};
let callPrefsTimer = 0;
function syncCallPrefs(patch) {
  if (guestMode) return;
  Object.assign(pendingCallPrefs, patch);
  clearTimeout(callPrefsTimer);
  callPrefsTimer = setTimeout(async () => {
    const body = pendingCallPrefs;
    pendingCallPrefs = {};
    try {
      await api('PATCH', '/api/me/call-prefs', body);
    } catch (err) {
      // best-effort: the local change already applied, this just fails to follow the account
    }
  }, 500);
}

// Insert a tile where the remembered order says; unknown ones go last.
function placeInOrder(tile) {
  const rank = (el) => {
    const i = prefs.order.indexOf(el.dataset.identity);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const siblings = [...$('grid').querySelectorAll('.tile')];
  const next = siblings.find((el) => rank(el) > rank(tile));
  if (next) next.parentNode.insertBefore(tile, next);
  else ($('grid').querySelector('.rest') || $('grid')).appendChild(tile);
}

function rememberOrder() {
  const order = [...$('grid').querySelectorAll('.tile')].map((el) => el.dataset.identity);
  // In spotlight the big tile sits apart from the row; keep its remembered place.
  const spot = $('grid').querySelector('.tile.spot');
  if (spot && prefs.layout === 'spotlight') {
    const id = spot.dataset.identity;
    const previous = prefs.order.indexOf(id);
    order.splice(order.indexOf(id), 1);
    order.splice(previous < 0 ? order.length : Math.min(previous, order.length), 0, id);
  }
  prefs.order = order;
  savePrefs();
}

const LAYOUTS = ['grid', 'strip', 'spotlight']; // the actual stored prefs.layout values
// Four picker buttons over three real layouts: Focus and Spotlight are both
// prefs.layout 'spotlight' underneath, one big tile either picked by hand
// (pinned, or just first) or following whoever's speaking -- prefs.follow
// is the only thing that differs between them.
const VIEWS = [
  { id: 'grid', layout: 'grid', icon: 'fa-solid fa-table-cells-large' },
  { id: 'strip', layout: 'strip', icon: 'fa-solid fa-grip' },
  { id: 'focus', layout: 'spotlight', follow: false, icon: 'fa-solid fa-expand' },
  { id: 'spotlight', layout: 'spotlight', follow: true, icon: 'fa-solid fa-bullseye' },
];

function currentViewId() {
  if (prefs.layout === 'spotlight') return prefs.follow ? 'spotlight' : 'focus';
  return LAYOUTS.includes(prefs.layout) ? prefs.layout : 'grid';
}

function syncLayoutPick() {
  const id = currentViewId();
  for (const b of $('layout-pick').children) b.classList.toggle('selected', b.dataset.view === id);
  $('layout-glyph').className = `${VIEWS.find((v) => v.id === id).icon} fa-fw`;
}

function setView(id) {
  const view = VIEWS.find((v) => v.id === id) || VIEWS[0];
  prefs.layout = view.layout;
  if ('follow' in view) prefs.follow = view.follow;
  savePrefs();
  syncLayoutPick();
  applyLayout();
}

function cycleView() {
  const id = currentViewId();
  setView(VIEWS[(VIEWS.findIndex((v) => v.id === id) + 1) % VIEWS.length].id);
}

function applyLayout() {
  fitFloatbar();
  canvas.layoutChanged(); // modules' columns follow the canvas's width
  const grid = $('grid');
  grid.dataset.layout = prefs.layout;
  const portrait = grid.clientHeight > grid.clientWidth;
  grid.classList.toggle('portrait', portrait);
  const canvasEl = $('canvas');
  // The same line as the tab bar (max-width: 640px) and snap-grid.js's NARROW: the window's width, since the side
  // column takes part of a wide window (canvas.js's isNarrow measures the same).
  canvasEl.classList.toggle('narrow', (canvasEl.ownerDocument.defaultView || window).innerWidth <= 640);
  syncColumn(); // Join the call, Online and the rail follow the call
  // The sizes follow the conference itself, wherever it is (docked beside the chat, floating,
  // or in a window of its own), not the whole canvas.
  const host = confEl.closest('.canvas') || canvasEl;
  const box = confEl.querySelector('.mod-content');
  const cw = box?.clientWidth || host.clientWidth;
  const ch = box?.clientHeight || host.clientHeight;
  for (const el of new Set([canvasEl, host])) {
    el.classList.toggle('compact', cw < 460);
    el.classList.toggle('tiny', cw < 300 || ch < 220);
  }
  if (floatbarInColumn()) fitFloatbar(); // the buttons' size may have changed with those two: fitted again at it
  const ordered = [...grid.querySelectorAll('.tile')];
  let rest = grid.querySelector('.rest');
  if (prefs.layout === 'spotlight' && ordered.length > 1) {
    // remember where every tile sits before the big one is pulled out
    let changed = false;
    for (const tile of ordered) {
      if (!prefs.order.includes(tile.dataset.identity)) {
        prefs.order.push(tile.dataset.identity);
        changed = true;
      }
    }
    if (changed) savePrefs();
    const wanted = (prefs.pinned && tiles.get(prefs.pinned)) || (prefs.follow && speaker && tiles.get(speaker)) || ordered[0];
    if (!rest) {
      rest = document.createElement('div');
      rest.className = 'rest';
    }
    // the big tile stays a direct child; the others share a row underneath
    for (const tile of ordered) {
      const isSpot = tile === wanted;
      tile.classList.toggle('spot', isSpot);
      if (isSpot && tile.parentNode !== grid) grid.appendChild(tile);
      else if (!isSpot && tile.parentNode !== rest) rest.appendChild(tile);
    }
    if (rest.parentNode !== grid) grid.appendChild(rest);
  } else {
    for (const tile of ordered) {
      tile.classList.remove('spot');
      if (tile.parentNode !== grid) grid.appendChild(tile);
    }
    if (rest) rest.remove();
  }
  fitTiles(grid, portrait);
}

// Size the tiles so all of them fit the grid area at 16:9, whatever the
// window shape. Sizes go into CSS variables the layouts read.
const RATIO = 16 / 9;
function fitTiles(grid, portrait) {
  // Ghost tiles (members stepped into an aside) are real .tile elements in
  // the grid too -- size for all of them, or the ones left out get the
  // sizing meant for a smaller crowd and spill past the grid's own edges.
  const n = tiles.size + ghostTiles.size;
  const style = getComputedStyle(grid);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const W = grid.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const H = grid.clientHeight - padY;
  // The grid's own gaps, so the sizes add up to exactly what the row and the column hold (a tile a pixel too wide wraps).
  const gapX = parseFloat(style.columnGap) || 0;
  const gapY = parseFloat(style.rowGap) || 0;
  if (n === 0 || W <= 0 || H <= 0) return;
  let w = 0;
  let h = 0;
  let sw = 0;
  let sh = 0;
  if (prefs.layout === 'strip') {
    if (portrait) {
      w = Math.min(W, ((H - gapY * (n - 1)) / n) * RATIO);
      h = w / RATIO;
    } else {
      h = Math.min(H, (W - gapX * (n - 1)) / n / RATIO);
      w = h * RATIO;
    }
  } else if (prefs.layout === 'spotlight' && n > 1) {
    sh = Math.max(64, Math.min(160, H * 0.22));
    sw = Math.min(sh * RATIO, (W - gapX * (n - 2)) / (n - 1));
    sh = sw / RATIO;
    h = H - sh - gapY;
    w = Math.min(W, h * RATIO);
    h = w / RATIO;
  } else {
    // grid (and a spotlight of one): the column count that gives the biggest tiles
    for (let cols = 1; cols <= n; cols += 1) {
      const rows = Math.ceil(n / cols);
      let tw = (W - gapX * (cols - 1)) / cols;
      let th = tw / RATIO;
      if (th * rows + gapY * (rows - 1) > H) {
        th = (H - gapY * (rows - 1)) / rows;
        tw = th * RATIO;
      }
      if (tw > w) {
        w = tw;
        h = th;
      }
    }
  }
  grid.style.setProperty('--tw', `${Math.floor(w)}px`);
  grid.style.setProperty('--th', `${Math.floor(h)}px`);
  grid.style.setProperty('--sw', `${Math.floor(sw)}px`);
  grid.style.setProperty('--sh', `${Math.floor(sh)}px`);
}

// Refit whenever the grid area changes (window resize, chat drawer, pop out).
const refit = new ResizeObserver(() => applyLayout());
refit.observe($('grid'));
if ($('side-column-strip')) refit.observe($('side-column-strip')); // the column's strip: its splitter and Call position change the room

// Click a tile: pin it as the spotlight (click again to unpin).
function spotlight(identity) {
  if (dragging || justDragged) return;
  prefs.pinned = prefs.pinned === identity ? null : identity;
  if (prefs.layout !== 'spotlight') prefs.layout = 'spotlight';
  savePrefs();
  syncLayoutPick();
  applyLayout();
}

let speaker = null;
let dragging = null;
let justDragged = false;

function onDragStart(event) {
  dragging = event.currentTarget;
  dragging.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  try {
    event.dataTransfer.setData('text/plain', dragging.dataset.identity);
  } catch (err) {
    // some browsers refuse setData in synthetic events
  }
}

function onDragOver(event) {
  if (!dragging) return;
  event.preventDefault();
  const over = event.currentTarget;
  if (over === dragging) return;
  // in spotlight only the small row reorders; the big tile stays put
  if (prefs.layout === 'spotlight' && (over.classList.contains('spot') || dragging.classList.contains('spot'))) return;
  const box = over.getBoundingClientRect();
  const horizontal = box.width >= box.height || $('grid').dataset.layout !== 'strip';
  const before = horizontal ? event.clientX < box.left + box.width / 2 : event.clientY < box.top + box.height / 2;
  over.parentNode.insertBefore(dragging, before ? over : over.nextSibling);
}

function onDrop(event) {
  event.preventDefault();
  rememberOrder();
}

function onDragEnd() {
  if (dragging) dragging.classList.remove('dragging');
  dragging = null;
  rememberOrder();
  // a click can follow the drop; keep it from toggling the spotlight
  justDragged = true;
  setTimeout(() => (justDragged = false), 200);
}

function attachTrack(participant, track) {
  if (!shownInCall(participant)) return;
  if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
    const screenTile = screenTileFor(participant);
    screenTile.querySelector('video')?.remove();
    const video = track.attach();
    video.muted = true;
    screenTile.prepend(video);
    keepPoppedVideoLive(track, video);
    return;
  }
  const tile = tileFor(participant);
  if (track.kind === Track.Kind.Video) {
    tile.querySelector('video')?.remove();
    const video = track.attach();
    video.muted = true; // audio comes through its own element
    tile.prepend(video);
    keepPoppedVideoLive(track, video); // in the pop-out window, LiveKit must not think it unseen
    // placeholder-bg sits later in the tile than the just-prepended video,
    // so it paints on top and hides live video behind whoever's custom
    // background picture unless it's hidden here too -- updateCamera()
    // already knew to do both, but this is the only path a remote viewer's
    // very first subscribe to someone's camera ever goes through.
    tile.querySelector('.placeholder').hidden = true;
    tile.querySelector('.placeholder-bg').hidden = true;
  } else if (track.kind === Track.Kind.Audio) {
    if (participant.isLocal) return; // never play your own voice back
    const audio = track.attach();
    audio.dataset.identity = participant.identity;
    audio.muted = hearingOff(); // deafened or away
    if (prefs.speakerId && audio.setSinkId) audio.setSinkId(prefs.speakerId).catch(() => {});
    $('canvas').appendChild(audio);
    track.setVolume(effectiveVolume(participant.identity));
  }
}

function detachTrack(participant, track) {
  track.detach().forEach((el) => el.remove());
  if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
    removeScreenTile(participant.identity);
    return;
  }
  const tile = tiles.get(participant.identity);
  if (tile && track.kind === Track.Kind.Video) {
    tile.querySelector('.placeholder').hidden = false;
    tile.querySelector('.placeholder-bg').hidden = false;
  }
}

function removeParticipant(participant) {
  const tile = tiles.get(participant.identity);
  if (tile) tile.remove();
  tiles.delete(participant.identity);
  removeScreenTile(participant.identity);
  if (asideSelection.delete(participant.identity)) updateAsideConfirm();
  canvasDoc().querySelectorAll(`audio[data-identity="${CSS.escape(participant.identity)}"]`).forEach((el) => el.remove());
  reconcileGhostTiles(); // they may have just stepped into a private aside, not actually left
  applyLayout();
}

// Marked muted: no microphone published, or the one published is muted. Only the publication's own state, which a
// late joiner gets with the publication, never what events happened to arrive (tools/check-canvas.mjs runs it).
function micMarkedMuted(pub) {
  return !pub || !!pub.isMuted;
}
function updateMuted(participant) {
  if (!shownInCall(participant)) return;
  const tile = tileFor(participant);
  let badge = tile.querySelector('.muted');
  const muted = micMarkedMuted(participant.getTrackPublication(Track.Source.Microphone));
  if (muted && !badge) {
    badge = document.createElement('span');
    badge.className = 'muted';
    badge.textContent = 'muted';
    tile.appendChild(badge);
  } else if (!muted && badge) {
    badge.remove();
  }
  // The admin Mute button can't unmute (see adminToolsFor) -- hide it once
  // there's nothing left for it to do.
  const muteBtn = tile.querySelector('.tile-admin-btn[data-action="mute"]');
  if (muteBtn) muteBtn.hidden = muted;
}

// A camera turned off keeps its publication but mutes it: show the image again.
function updateCamera(participant) {
  if (!shownInCall(participant)) return;
  const tile = tileFor(participant);
  const cam = participant.getTrackPublication(Track.Source.Camera);
  const off = !cam || cam.isMuted;
  const video = tile.querySelector('video');
  if (video) video.hidden = off;
  // Not gated on the <video> element already existing: attachTrack() hides
  // these the moment it runs regardless, and if this fires first there's
  // nothing to gain by leaving them showing for however long that takes --
  // an empty tile reads better than the wrong picture stuck on top of live video.
  tile.querySelector('.placeholder').hidden = !off;
  tile.querySelector('.placeholder-bg').hidden = !off;
}

// The document the canvas currently lives in (the page, or the pop-out window).
function canvasDoc() {
  return $('canvas').ownerDocument;
}

// --- chat ---------------------------------------------------------------------

// Text and pictures are posted to the server, which tells everyone on the live stream (GET /api/live, liveChatNotice).
// It keeps a text message in a rolling window per space (see server/chat-history.js), and everyone who joins reads it
// back, so a late joiner or a new browser sees what was said. Pictures are live only. An aside/private space keeps nothing,
// staying as off-the-record as everything else about it. The log here is what Save writes out and goes when you
// leave. Deleting the chat removes it for everyone. Deleting one message removes that message for everyone, and
// only the person who sent it can.
const chatLog = []; // { id, who, by, at, text } or { id, who, by, at, blob, name }
// Older versions kept the history in this browser only. It is still read when the server has none and has never
// been deleted (or cannot be reached). A delete on the server records when, so that old copy stays hidden.
const chatHistoryKey = (spaceId) => `app:chat:${spaceId}:${me?.key || guestToken || 'guest'}`;
const chatClearedKey = (spaceId) => `app:chatclear:${spaceId}:${me?.key || guestToken || 'guest'}`;
function loadChatHistory(spaceId) {
  try {
    return JSON.parse(localStorage.getItem(chatHistoryKey(spaceId))) || [];
  } catch {
    return [];
  }
}
function chatClearedAt(spaceId) {
  try {
    return Number(localStorage.getItem(chatClearedKey(spaceId))) || 0;
  } catch {
    return 0;
  }
}
function chatIdOk(id) {
  return typeof id === 'string' && /^[a-f0-9]{12}$/.test(id);
}
function newChatId() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function chatMessageNode(id) {
  if (!chatIdOk(id)) return null;
  return $('messages')?.querySelector(`.message[data-chat-id="${CSS.escape(id)}"]`) || null;
}
async function fetchChatHistory(spaceId) {
  const q = guestToken ? `?guest=${encodeURIComponent(guestToken)}` : '';
  const { messages, clearedAt } = await api('GET', `/api/spaces/${encodeURIComponent(spaceId)}/chat${q}`);
  return {
    messages: messages.map((m) => storedEntry(m)),
    clearedAt: Number(clearedAt) || 0,
  };
}
// A message as the server stores it (plan-chat-model.md, "One message, one store"), as this page keeps it: public or
// private, and what kind (absent: an ordinary message; an unknown kind reads as one). `question` is a public AI answer's
// read-only quote of what was asked (decision 11). `local`: drawn on this page only (a guest's command echo).
function storedEntry(m, { local = false } = {}) {
  const kind = m.kind === 'command' || m.kind === 'ai' ? m.kind : '';
  const entry = {
    id: local ? '' : String(m.id || ''),
    who: String(m.who || 'someone'),
    by: String(m.by || ''),
    text: String(m.text || ''),
    at: new Date(m.at),
    visibility: m.visibility === 'private' ? 'private' : 'public',
    kind,
    stored: !local && chatIdOk(m.id),
  };
  if (kind && typeof m.command === 'string' && m.command) entry.command = m.command;
  if (kind && typeof m.module === 'string' && m.module) entry.module = m.module;
  // The words a module attached to an /ai question: the page keeps only their label (the words stay with the server).
  if (kind === 'command' && m.attached && typeof m.attached.label === 'string' && m.attached.label) entry.attached = { label: m.attached.label.slice(0, 60) };
  if (kind === 'ai' && Array.isArray(m.summaries)) entry.summaries = m.summaries;
  if (kind === 'ai' && typeof m.replyTo === 'string') entry.replyTo = m.replyTo;
  // What the answer used (the server keeps it with the answer): the AI used: line under it.
  if (kind === 'ai' && m.sent && typeof m.sent === 'object') entry.sent = m.sent;
  if (kind === 'ai' && Array.isArray(m.used)) entry.used = m.used;
  if (kind === 'ai' && m.cut === true) entry.cut = true;
  if (kind === 'ai' && Array.isArray(m.numbered)) entry.numbered = m.numbered;
  if (kind === 'ai' && Array.isArray(m.leftOut)) entry.leftOut = m.leftOut;
  if (kind === 'ai' && m.question && typeof m.question.text === 'string') entry.question = { who: String(m.question.who || 'someone'), text: m.question.text };
  // An ordinary message's link (plan-chat-links.md): its preview, and who kept it. Cleaned, whoever handed it in.
  if (!kind) {
    const preview = cleanPreview(m.preview);
    if (preview) entry.preview = preview;
    const kept = preview ? cleanKept(m.kept) : null;
    if (kept) entry.kept = kept;
  }
  return entry;
}
// Tell the server what was just said: it keeps it and tells everyone on the live stream. Returns the stored message;
// throws when it was not taken (the server's sentence, or the network's).
async function postChatMessage(text) {
  if (!chatSpace() || chatSpace().isAside) throw new Error('');
  // A guest is shown by the name on their pass (the server reads it from there).
  const q = guestToken ? `?${new URLSearchParams({ guest: guestToken, pass: guestPass })}` : '';
  const { message } = await api('POST', `/api/spaces/${encodeURIComponent(chatSpace().id)}/chat${q}`, { text });
  if (!message?.id) throw new Error('');
  return message;
}
// Stores the message and draws it here with that id; everyone else hears it from the server's live stream. Not taken:
// said in Chat's status line, the words put back in the box when it is empty, and sent no other way.
async function sendChatText(text) {
  let stored = null;
  try {
    stored = await postChatMessage(text);
  } catch (err) {
    chatNotice(err.serverSaid ? `Not sent: ${err.message}` : 'Not sent. Try again.', true);
    const box = $('chat-input');
    if (box && !box.value) {
      box.value = text;
      resizeChatInput();
    }
    return;
  }
  dropChatMessage(stored.id); // the live stream can bring it back before this answer: drawn once, as mine
  const entry = storedEntry(stored);
  // Its link's preview is asked for now (below): nothing is drawn under it until that answers.
  const asking = Boolean(entry.preview && !entry.preview.at && me?.key && me.role !== 'guest' && !guestToken);
  if (asking) entry.previewAsked = true;
  addEntry(entry, true);
  if (asking) askLinkPreview(entry);
}
function dropChatMessage(id) {
  chatMessageNode(id)?.remove();
  const at = chatLog.findIndex((e) => e.id === id);
  if (at >= 0) chatLog.splice(at, 1);
}
function dropSharedChat() {
  for (const el of [...($('messages')?.querySelectorAll('.message, .chat-session-divider, .chat-closed-ask') || [])]) el.remove();
  chatLog.length = 0;
  unread = 0;
  canvas.setBuiltinUnread('chat', 0);
}
// An owner, or a member marked moderator in this space.
function canModerateChat() {
  if (!chatSpace() || chatSpace().isAside || !me || me.role === 'guest') return false;
  if (hasOwnerRights(me)) return true;
  return Boolean(me.spaces?.[chatSpace().id]?.permissions?.moderator);
}
// Who sees a message is the author's to change, both ways, on any stored message (plan-chat-model.md, decisions 3 and
// 9). Pictures are never stored and a guest's command echo stays on their page, so neither is a button; guests share
// one stored sender, so a guest never changes one.
function canChangeVisibility(entry) {
  if (!entry?.stored || entry.picture || !chatIdOk(entry.id)) return false;
  if (!me?.key || me.role === 'guest' || guestToken) return false;
  return entry.by === me.key;
}
// A shared message can be deleted by the person who sent it. A picture is never stored: the server holds it a short
// while and keeps who sent it for a day, so its sender or a moderator can still delete it for everyone.
function canDeleteChatEntry(entry) {
  if (!entry?.chat || !chatIdOk(entry.id)) return false;
  if (entry.picture) return Boolean(me?.key && me.role !== 'guest' && !guestToken && (entry.by === me.key || canModerateChat()));
  if (entry.visibility === 'private') return Boolean(me?.key && entry.by === me.key && me.role !== 'guest'); // only ever on its author's page
  if (canModerateChat()) return true;
  return Boolean(me?.key && entry.by === me.key && me.role !== 'guest');
}
// --- Clear… (plan-chat-clear.md, #166): clear messages by type, yours or everyone's ---------------------------------

// Drops held messages and pictures, and takes any still unread off Chat's number: the unread ones are the newest that
// were counted (addEntry), the last `unread` of them.
function dropChatEntries(gone) {
  if (!gone.length) return;
  if (unread > 0) {
    const still = new Set(chatLog.filter((e) => e.counted).slice(-unread));
    const less = gone.filter((e) => still.has(e)).length;
    if (less) {
      unread = Math.max(0, unread - less);
      canvas.setBuiltinUnread('chat', unread);
    }
  }
  for (const entry of gone) {
    if (entry.id) dropChatMessage(entry.id);
    else {
      const at = chatLog.indexOf(entry);
      if (at >= 0) chatLog.splice(at, 1);
    }
  }
}
// Whether this person may clear at all: signed in, not a guest, in a space (an aside keeps no chat).
function canClearChat() {
  return Boolean(me?.key && me.role !== 'guest' && !guestToken && chatSpace() && !chatSpace().isAside);
}
// How a type reads: its line in Clear… (name, icon, colour) and the word in its sentences ("the AI messages").
// A module reads as its shown name; one this space no longer has reads as its command ("/t").
function clearLook({ type, module, command }) {
  if (type === 'chat') return { label: 'Chat messages', icon: 'comment', noun: 'chat' };
  if (type === 'ai') return { label: 'AI', icon: 'robot', tint: 'gold', noun: 'AI' };
  if (type === 'all') return { label: 'All of them', icon: 'layer-group', noun: '' };
  const m = canvas.list().find((x) => x.id === module);
  const icon = m && /^[a-z0-9-]{1,40}$/.test(m.icon || '') ? m.icon : 'terminal';
  const name = m?.name || (command ? `/${command}` : '');
  return { label: name || module, icon, tint: m && canvas.colorOf ? canvas.colorOf(module) : null, noun: name };
}
const messagesWord = (n) => (n === 1 ? 'message' : 'messages');
// Clears one type, for this person ('mine') or for everyone ('everyone'), on the server, then here, then tells the
// call (the server tells it too; a page that already dropped them finds nothing). Throws the server's refusal, which
// the confirm shows in its place.
async function clearChatMessages({ type, module }, scope) {
  if (!canClearChat()) return;
  const q = new URLSearchParams({ type, scope });
  if (type === 'module') q.set('module', module);
  await api('DELETE', `/api/spaces/${encodeURIComponent(chatSpace().id)}/chat/messages?${q}`);
  const by = me.key;
  const gone = chatLog.filter((e) => (ofClearType(e, type, module) && inClearScope(e, scope, by)) || clearTakesPicture(e, { type, scope, by }));
  dropChatEntries(gone);
}
// Clear…'s list, then the confirm with the count (decisions 5 and 9). A member clears their own; a moderator, an owner
// or an admin picks theirs or everyone's. Opened from Chat's "..." (#chat-more), in the same menu.
function openClearChatMenu(button) {
  const moderator = canModerateChat();
  const choices = clearChoices(chatLog, { by: me?.key, moderator });
  if (!choices.length) return;
  const entries = [];
  for (const choice of choices) {
    const look = clearLook(choice);
    if (choice.type === 'all') entries.push({ divider: true });
    entries.push({ icon: look.icon, tint: look.tint, label: look.label, badge: moderator ? choice.everyone : choice.mine, onPick: () => confirmClearChat(button, choice, moderator) });
  }
  openHostMenu(button, entries);
}
function confirmClearChat(button, choice, moderator) {
  const { noun } = clearLook(choice);
  const what = noun ? `${noun} ` : '';
  if (!moderator) {
    openConfirmMenu(button, {
      icon: 'eraser',
      confirm: `Clear your ${choice.mine} ${what}${messagesWord(choice.mine)}?`,
      armed: true,
      fail: 'They could not be cleared.',
      onConfirm: () => clearChatMessages(choice, 'mine'),
    });
    return;
  }
  openConfirmMenu(button, {
    icon: 'eraser',
    confirm: choice.type === 'all' ? 'Clear all the messages?' : `Clear the ${what}messages?`,
    armed: true,
    fail: 'They could not be cleared.',
    choices: [
      { label: `Clear yours (${choice.mine})`, disabled: !choice.mine, onConfirm: () => clearChatMessages(choice, 'mine') },
      { label: `Clear everyone's (${choice.everyone})`, hint: 'Private messages of others stay.', onConfirm: () => clearChatMessages(choice, 'everyone') },
    ],
  });
}
// Someone cleared messages by type (chat-clear-some, the server's word on the live stream): drop each listed id held
// here, and for chat or all the matching pictures (clearNoticeTakes). Someone else's clear of everyone's adds one line,
// not stored and not counted (decision 9), once.
const heardClears = new Map();
function applyClearNotice(data) {
  if (!canDo('chatRead') || !chatSpace() || chatSpace().isAside) return;
  const by = typeof data.by === 'string' ? data.by : '';
  if (!by) return;
  const scope = data.scope === 'everyone' ? 'everyone' : data.scope === 'mine' ? 'mine' : '';
  const type = ['chat', 'ai', 'module', 'all'].includes(data.clearType) ? data.clearType : '';
  if (!scope || !type) return;
  const module = type === 'module' && typeof data.module === 'string' ? data.module : '';
  const ids = new Set((Array.isArray(data.ids) ? data.ids : []).filter(chatIdOk));
  const command = chatLog.find((e) => ids.has(e.id) && e.command)?.command || '';
  const gone = chatLog.filter((e) => clearNoticeTakes(e, { ids, type, scope, by }));
  dropChatEntries(gone);
  if (scope !== 'everyone' || by === me?.key) return;
  const now = Date.now();
  for (const [k, at] of heardClears) if (now - at > 10000) heardClears.delete(k);
  const key = `${by}|${type}|${module}`;
  if (heardClears.has(key)) return;
  heardClears.set(key, now);
  const who = String(data.who || '').trim() || 'Someone';
  const { noun } = clearLook({ type, module, command });
  // Told in the status area, not as a line in the list: the messages are gone from it already.
  chatNotice(type === 'all' ? `${who} cleared all the messages.` : noun ? `${who} cleared the ${noun} messages.` : `${who} cleared some messages.`);
}
// --- end Clear… ---

// Called once per join, after the canvas is up but before anything live has
// arrived -- fills #messages with whatever this space already said, so it
// reads as "still here" rather than the chat looking wiped on every rejoin.
async function renderChatHistory(spaceId) {
  let history;
  let serverCleared = 0;
  try {
    const got = await fetchChatHistory(spaceId);
    history = got.messages;
    serverCleared = got.clearedAt;
  } catch {
    // An old copy kept in this browser: public, and not a button (the server may not have it).
    history = loadChatHistory(spaceId).map((m) => ({ ...storedEntry(m), stored: false }));
  }
  if (chatSpace()?.id !== spaceId) return; // the chat moved on while this loaded (Home's chat, then a space, or back)
  const cleared = Math.max(chatClearedAt(spaceId), serverCleared);
  history = history.filter((e) => new Date(e.at).getTime() > cleared);
  // Anything live that arrived while this was loading is already there, so the history goes above it.
  const fragment = document.createDocumentFragment();
  for (const entry of history) {
    if (entry.id && chatMessageNode(entry.id)) continue;
    entry.chat = true;
    chatLog.push(entry);
    const el = messageEl(entry, ownEntry(entry));
    el.classList.add('history');
    fragment.appendChild(el);
  }
  // Everything above this line was said before you opened the call just
  // now; everything below it is happening live. Only worth marking when
  // there's actually old chat to separate from the new.
  if (history.length) {
    const divider = document.createElement('div');
    divider.className = 'chat-session-divider';
    divider.innerHTML = `<span>${escapeHtml(new Date().toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}</span>`;
    fragment.appendChild(divider);
    $('messages').prepend(fragment);
    $('messages').scrollTop = $('messages').scrollHeight;
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Markdown to safe HTML: headings, **bold**, *italic*/_italic_, `code`, fenced code, - and 1. lists, > quotes
// (what replyToEntry() quotes with), [text](url) and bare links. The one shared implementation every module
// (and now Chat) uses, in /sdk/host.js -- loaded on this page already for the modules it hosts in the page.
function renderMarkup(text) {
  return window.hostText.markdown(text);
}

function iconButton(icon, title, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sdk-icon-btn btn-quiet btn-small';
  b.dataset.tip = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = `<i class="fa-solid fa-${icon} fa-fw" aria-hidden="true"></i>`;
  b.addEventListener('click', onClick);
  return b;
}

function flashIcon(btn, icon) {
  const i = btn.querySelector('i');
  const was = i.className;
  i.className = `fa-solid fa-${icon} fa-fw`;
  setTimeout(() => (i.className = was), 1200);
}

function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name || 'picture.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function toPng(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close();
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

async function copyEntry(entry, btn) {
  try {
    if (entry.picture) {
      const blob = await pictureBlob(entry);
      if (!blob) {
        chatNotice(PICTURE_GONE, true);
        return;
      }
      const png = blob.type === 'image/png' ? blob : await toPng(blob);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    } else {
      await navigator.clipboard.writeText(entry.text);
    }
    if (btn) flashIcon(btn, 'check');
  } catch (err) {
    chatNotice(`copy: ${err.message}`, true);
  }
}

// Quotes the original message (markdown blockquote, so it renders as one
// once sent -- see renderMarkup()) at the start of whatever's already
// being typed, cursor landing right after so the reply continues below it.
function replyToEntry(entry) {
  const el = $('chat-input');
  const quoted = entry.picture
    ? `> ${entry.who} sent a picture`
    : `> ${entry.who}: ${entry.text.split('\n').join('\n> ')}`;
  const prefix = `${quoted}\n`;
  el.value = prefix + el.value;
  el.focus();
  el.setSelectionRange(prefix.length, prefix.length);
  resizeChatInput();
}

function messageStamp(at) {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${date}, ${time}`;
}

function senderKey(entry) {
  if (entry?.by) return entry.by;
  if (entry?.who && me?.displayName === entry.who) return me.key;
  for (const [key, user] of presenceUsers) {
    if (user?.displayName === entry.who) return key;
  }
  return '';
}

function messagePortrait(name, kind, icon, by) {
  const el = document.createElement('span');
  el.className = 'message-portrait';
  el.setAttribute('aria-hidden', 'true');
  const safe = /^[a-z0-9-]{1,40}$/.test(icon || '') ? icon : (kind === 'ai' ? 'robot' : '');
  if (safe) el.classList.add('message-portrait-icon'); // a command's or the AI's icon, in its colour (data-tint on the message)
  if (safe) {
    el.innerHTML = `<i class="fa-solid fa-${safe} fa-fw"></i>`;
    return el;
  }
  if (by) {
    const img = document.createElement('img');
    img.className = 'message-portrait';
    img.alt = '';
    img.src = spacePortraitUrl(by);
    img.onerror = () => {
      img.onerror = null;
      img.src = imgUrl(by, 'profile');
    };
    return img;
  }
  el.textContent = String(name || '?').trim().charAt(0).toUpperCase() || '?';
  return el;
}

// A chat message is a header and a container. The header has a left zone (portrait, name, time) and a
// right zone (the private or public mark, an icon, then the menu). The container is the message itself.
// `tint` is the colour of a command's module, or gold for the AI (plan-chat-model.md, decision 18): the portrait's icon
// and a thin left edge. `command` ("/n") follows the name. data-vis says private or public; data-in which of Chat's
// views shows it (viewOf: private in the Assistant, the person's own shared command or answer in both, else the
// Discussion). The person's own shared one shows the public icon, labelled "Shared with everyone".
function frameMessage({ name, at, visibility = 'public', kind, icon, by, body, entry, tint, command }) {
  const el = document.createElement('div');
  el.className = 'message';
  if (kind === 'own' || kind === 'you') el.classList.add('own');
  if (kind === 'ai' || kind === 'you' || kind === 'command') el.classList.add('private-ai');
  if (kind === 'ai') el.classList.add('msg-ai');
  if (/^(gold|blue|green|teal|purple|red|orange|pink)$/.test(tint || '')) el.dataset.tint = tint;
  const atMs = at instanceof Date ? at.getTime() : new Date(at).getTime();
  if (Number.isFinite(atMs)) el.dataset.at = String(atMs);
  const head = document.createElement('div');
  head.className = 'message-head';
  const left = document.createElement('span');
  left.className = 'message-head-side';
  const nameEl = document.createElement('span');
  nameEl.className = 'message-name';
  nameEl.textContent = name || 'someone';
  const dash = document.createElement('span');
  dash.className = 'message-dash';
  dash.setAttribute('aria-hidden', 'true');
  dash.textContent = '–';
  const when = document.createElement('span');
  when.className = 'message-when';
  when.textContent = messageStamp(at);
  left.append(messagePortrait(name, kind, icon, by), nameEl);
  if (command) {
    const cmd = document.createElement('span');
    cmd.className = 'message-command';
    cmd.textContent = command;
    left.append(cmd);
  }
  if (when.textContent) left.append(dash, when);
  const right = document.createElement('span');
  right.className = 'message-head-side';
  let state = visibility === 'private' ? 'private' : 'public';
  el.dataset.vis = state;
  const mine = Boolean(me?.key && entry?.by === me.key);
  const canChange = canChangeVisibility(entry);
  const vis = document.createElement(canChange ? 'button' : 'span');
  if (canChange) vis.type = 'button';
  vis.className = 'message-vis';
  // The mark is an icon: one person for private, three for public and for the author's shared one. The words are its
  // tooltip and its label ("Only you", "Everyone", "Shared with everyone").
  const paintVis = () => {
    el.dataset.in = viewOf({ visibility: state, kind, mine });
    const said = el.dataset.in === 'both' ? 'shared' : state;
    const words = said === 'private' ? 'Only you' : said === 'shared' ? 'Shared with everyone' : 'Everyone';
    vis.innerHTML = `<i class="fa-solid ${said === 'private' ? 'fa-user' : 'fa-users'} fa-fw" aria-hidden="true"></i>`;
    vis.dataset.tip = words;
    vis.dataset.mark = said;
    vis.setAttribute('aria-label', words);
    if (!canChange) vis.setAttribute('role', 'img');
    else vis.setAttribute('aria-haspopup', 'menu');
  };
  paintVis();
  // The badge flips who sees it, and nothing else (decision 3): PATCH, then repaint here and tell the call. On a
  // refusal the badge stays and Chat's status line says why.
  if (canChange) vis.addEventListener('click', (event) => {
    event.stopPropagation();
    const next = state === 'private' ? 'public' : 'private';
    openHostMenu(vis, [{
      icon: next === 'public' ? 'users' : 'user',
      label: next === 'public' ? 'Make public' : 'Make private',
      onPick: async () => {
        const done = await setMessageVisibility(entry, next);
        if (!done) return;
        state = next;
        el.dataset.vis = state;
        paintVis();
      },
    }]);
  });
  el.repaintVis = (v) => { state = v === 'private' ? 'private' : 'public'; el.dataset.vis = state; paintVis(); };
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'sdk-icon-btn btn-quiet btn-small';
  more.dataset.tip = 'More';
  more.setAttribute('aria-label', 'More');
  more.setAttribute('aria-haspopup', 'menu');
  more.innerHTML = '<i class="fa-solid fa-ellipsis-vertical fa-fw" aria-hidden="true"></i>';
  more.addEventListener('click', (event) => {
    event.stopPropagation();
    const items = [
      { icon: 'copy', label: 'Copy', onPick: () => copyEntry(entry) },
      { icon: 'reply', label: 'Reply', onPick: () => replyToEntry(entry) },
    ];
    // Share (GitHub #203): the author's private message, made public, shows in everyone's Discussion; an Assistant
    // one stays in their Assistant too, marked shared. The badge's Make public, from the menu.
    if (canChange && state === 'private') {
      items.push({
        icon: 'users',
        label: 'Share',
        hint: `Everyone in this ${word('space')} sees it in ${$('chat-view-discussion')?.querySelector('.mf-word')?.textContent || 'Discussion'}`,
        onPick: async () => {
          if (!await setMessageVisibility(entry, 'public')) return;
          el.repaintVis('public');
        },
      });
    }
    // Send to... (plan-object-handoff.md): only where something here can take what the message is.
    if (entry?.chat && chatInput.canSendTo(entry)) items.push({ icon: 'share', label: 'Send to...', onPick: () => chatInput.sendTo(entry, more) });
    if (!entry?.chat || canDeleteChatEntry(entry)) {
      items.push({ icon: 'trash', label: 'Delete', danger: true, onPick: () => deleteMessage(el, entry) });
    }
    openHostMenu(more, items);
  });
  right.append(vis, more);
  head.append(left, right);
  el.append(head, body);
  return el;
}

async function deleteMessage(el, entry) {
  if (!chatSpace()) return;
  const space = `/api/spaces/${encodeURIComponent(chatSpace().id)}`;
  if (entry?.chat) {
    if (!canDeleteChatEntry(entry)) return;
    // A picture too: the server keeps who sent it, and tells everyone (chat-delete) as for a message.
    try {
      const q = guestToken ? `?guest=${encodeURIComponent(guestToken)}` : '';
      await api('DELETE', `${space}/chat/${entry.id}${q}`);
    } catch (err) {
      chatNotice(err.message || 'Could not delete that.', true);
      return;
    }
    dropChatMessage(entry.id);
    return;
  }
  el.remove();
}

// A message or a picture deleted (the chat-delete notice, the server's word on the live stream).
function applyDeleteNotice(data) {
  dropChatMessage(data.id);
}

// Make a stored message public or private (plan-chat-model.md, decision 9). True when the server took it. The others
// hear it from the server (chat-visibility), as with a delete.
async function setMessageVisibility(entry, visibility) {
  if (!chatSpace() || !entry?.stored || !chatIdOk(entry.id)) return false;
  try {
    const { message } = await api('PATCH', `/api/spaces/${encodeURIComponent(chatSpace().id)}/chat/${entry.id}`, { visibility });
    entry.visibility = message?.visibility === 'private' ? 'private' : 'public';
    if (message?.question && entry.kind === 'ai') entry.question = { who: String(message.question.who || ''), text: String(message.question.text || '') };
    return entry.visibility === visibility;
  } catch (err) {
    chatNotice(err.message || 'Could not change who sees that.', true);
    return false;
  }
}

// A message someone made public or private (the chat-visibility notice, the server's word on the live stream). Made
// public: drawn where its time places it, and it counts as unread while Chat is closed (decision 10). Made private:
// gone from this page, but for its author.
function applyVisibilityNotice(data) {
  if (!chatIdOk(data.id) || !canDo('chatRead') || !chatSpace() || chatSpace().isAside) return;
  const have = chatLog.find((e) => e.id === data.id);
  if (data.visibility === 'private') {
    if (!have) return;
    if (have.by === me?.key) { have.visibility = 'private'; chatMessageNode(data.id)?.repaintVis?.('private'); return; }
    dropChatMessage(data.id);
    return;
  }
  if (data.visibility !== 'public' || !data.message || data.message.id !== data.id) return;
  if (have) {
    have.visibility = 'public';
    chatMessageNode(data.id)?.repaintVis?.('public');
    return;
  }
  // A shared AI answer comes in the notice without its pointers (it goes to everyone alike); the ones this reader can open
  // come from the list, whoever asked.
  if (data.message.kind === 'ai') {
    const spaceId = chatSpace().id;
    fetchChatHistory(spaceId).then(({ messages }) => {
      if (!chatSpace() || chatSpace().id !== spaceId || chatLog.some((e) => e.id === data.id)) return;
      const found = messages.find((e) => e.id === data.id);
      if (found && found.visibility === 'public') addEntry(found, false);
    }).catch(() => {});
    return;
  }
  const entry = storedEntry({ ...data.message, visibility: undefined });
  addEntry(entry, entry.by === me?.key);
}

// --- links in Chat (plan-chat-links.md, GitHub #158) ------------------------------------------------------------------
// An ordinary message's first link, kept as the message's `preview`. Once read (the keeper's Fetch link previews on),
// a box under the text: the picture, the title as the link, the site, the description; else one line with the site.
// Either way Keep, for someone who may add to the keeper (decision 10), or "Kept by <name>" once kept (decision 11).
// The box wears the keeper's colour on its edge and icon only; the message stays its author's. No keeper on in the
// space: nothing under the link (decision 9).
let chatLinkKeeper = null; // { module, name, may } from GET .../actions, or null
async function loadLinkKeeper(spaceId) {
  chatLinkKeeper = null;
  if (!spaceId || !canDo('chatRead')) return;
  try {
    const q = guestToken ? `?guest=${encodeURIComponent(guestToken)}` : '';
    const { actions } = await api('GET', `/api/spaces/${encodeURIComponent(spaceId)}/actions${q}`);
    if (!chatSpace() || chatSpace().id !== spaceId) return;
    chatLinkKeeper = linkKeeper(actions);
  } catch {
    chatLinkKeeper = null;
  }
  for (const entry of chatLog) if (entry.preview) paintLinkBox(entry);
}
function linkKeeperLook(moduleId) {
  const m = canvas.list().find((x) => x.id === moduleId);
  const name = m?.name || (chatLinkKeeper?.module === moduleId ? chatLinkKeeper.name : '') || moduleId;
  return { icon: m && /^[a-z0-9-]{1,40}$/.test(m.icon || '') ? m.icon : 'link', tint: canvas.colorOf ? canvas.colorOf(moduleId) : null, name };
}
function linkBox(entry) {
  const p = entry.preview;
  if (!p || !p.url || !chatSpace() || chatSpace().isAside) return null;
  const moduleId = p.module || chatLinkKeeper?.module || '';
  if (!moduleId) return null; // no keeper here (decision 9)
  const read = Boolean(p.at);
  if (!read && entry.previewAsked) return null; // its author's page is asking for it now
  const look = linkKeeperLook(moduleId);
  const box = document.createElement('div');
  box.className = read ? 'chat-link' : 'chat-link chat-link-plain';
  if (/^(gold|blue|green|teal|purple|red|orange|pink)$/.test(look.tint || '')) box.dataset.tint = look.tint;
  const site = siteName(p.url);
  if (read && p.image && chatIdOk(entry.id)) {
    const img = document.createElement('img');
    img.className = 'chat-link-img';
    img.alt = '';
    img.loading = 'lazy';
    const q = guestToken ? `?guest=${encodeURIComponent(guestToken)}` : '';
    img.src = `/api/spaces/${encodeURIComponent(chatSpace().id)}/chat/${entry.id}/image${q}`; // never the page's own address
    img.addEventListener('error', () => img.remove()); // left out, not shown broken
    box.appendChild(img);
  }
  const text = document.createElement('div');
  text.className = 'chat-link-text';
  if (read) {
    const title = document.createElement('a');
    title.className = 'chat-link-title';
    title.href = p.url;
    title.target = '_blank';
    title.rel = 'noopener noreferrer';
    title.textContent = p.title || site || p.url;
    text.appendChild(title);
  }
  const line = document.createElement('div');
  line.className = 'chat-link-site';
  const icon = document.createElement('i');
  icon.className = `fa-solid fa-${look.icon} fa-fw chat-link-icon`;
  icon.setAttribute('aria-hidden', 'true');
  const siteEl = document.createElement('span');
  siteEl.className = 'chat-link-site-name';
  siteEl.textContent = site || p.url;
  line.append(icon, siteEl);
  const keep = linkKeepEl(entry, look);
  if (keep) line.appendChild(keep);
  if (read && p.description) {
    const desc = document.createElement('p');
    desc.className = 'chat-link-desc';
    desc.textContent = p.description;
    text.append(desc);
  }
  text.appendChild(line);
  box.appendChild(text);
  return box;
}
// Keep, its waiting line, or who kept it; null when this person may not keep and nobody has.
function linkKeepEl(entry, look) {
  if (entry.kept) {
    const s = document.createElement('span');
    s.className = 'chat-link-kept';
    s.textContent = `Kept by ${entry.kept.who}`;
    return s;
  }
  if (!chatLinkKeeper?.may || !entry.stored || !chatIdOk(entry.id)) return null;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-quiet btn-small chat-link-keep';
  b.textContent = 'Keep';
  b.title = `Keep this link in ${look.name}`;
  b.addEventListener('click', () => keepLink(entry, b));
  return b;
}
// A body that gets a card under its words: the words into a block of their own and the body a column (.message-stack,
// style.css), so the card sits one gap under them and nothing stacks a margin on that gap.
function stackBody(body) {
  if (body.classList.contains('message-stack')) return;
  const words = document.createElement('div');
  words.append(...body.childNodes);
  if (words.childNodes.length) body.append(words);
  body.classList.add('message-stack');
}
function paintLinkBox(entry) {
  const node = chatMessageNode(entry.id);
  const body = node?.querySelector(':scope > .message-body');
  if (!body) return;
  const had = body.querySelector(':scope > .chat-link');
  const box = linkBox(entry);
  if (had && box) had.replaceWith(box);
  else if (had) had.remove();
  else if (box) { stackBody(body); body.appendChild(box); }
}
// Keep (decision 4): the server saves the stored link into the keeper as this person and marks the message kept at
// once (its bus request may still wait for the keeper to be open), so this page reads "Kept by" from its answer, and
// everyone else hears it from the server (chat-kept).
// Answers the server's answer; throws its refusal. Send to... on the message keeps its link the same way.
async function keepStoredLink(entry) {
  if (!chatSpace() || !chatIdOk(entry.id)) throw new Error('That link can no longer be kept.');
  const q = guestToken ? `?guest=${encodeURIComponent(guestToken)}` : '';
  const out = await api('POST', `/api/spaces/${encodeURIComponent(chatSpace().id)}/chat/${entry.id}/keep${q}`);
  const kept = cleanKept(out?.message?.kept);
  if (kept) entry.kept = kept;
  paintLinkBox(entry);
  return out;
}
async function keepLink(entry, btn) {
  if (!chatSpace() || !chatIdOk(entry.id)) return;
  btn.disabled = true;
  try {
    await keepStoredLink(entry);
    if (!entry.kept) btn.disabled = false;
  } catch (err) {
    btn.disabled = false;
    chatNotice(err.message || 'Could not keep that.', true);
  }
}
// The author's page asks for its new message's preview (decision 7); the server tells everyone else on the live stream.
async function askLinkPreview(entry) {
  let message = null;
  try {
    ({ message } = await api('POST', `/api/spaces/${encodeURIComponent(chatSpace().id)}/chat/${entry.id}/preview`));
  } catch {
    message = null;
  }
  entry.previewAsked = false;
  const preview = cleanPreview(message?.preview);
  if (preview?.at && !entry.preview?.at && preview.url === entry.preview?.url) entry.preview = preview;
  paintLinkBox(entry);
}
// chat-preview and chat-kept (the server's word on the live stream): the first copy only (previewNoticeTakes,
// keptNoticeTakes in chat-input.js).
function applyLinkNotice(data) {
  if (!canDo('chatRead') || !chatSpace() || chatSpace().isAside) return;
  const entry = chatLog.find((e) => e.id === data.id && !e.picture);
  if (!entry) return;
  if (data.type === 'chat-preview') {
    if (!previewNoticeTakes(entry, data)) return;
    entry.preview = cleanPreview(data.preview);
    entry.previewAsked = false;
  } else {
    if (!keptNoticeTakes(entry, data)) return;
    entry.kept = cleanKept(data.kept);
  }
  paintLinkBox(entry);
}
// --- end links in Chat ---

// Whether a message is this person's own (its colour in the chat).
function ownEntry(entry) {
  if (entry.kind === 'ai') return false;
  return Boolean(me?.key && entry.by === me.key) || entry.who === me?.displayName;
}

// One message, whatever it is: an ordinary message (its text, any {{summary:N}} left in an old copy removed, decision
// 16), a command's echo (the person, with the command's icon and colour), an AI answer ("AI", gold, its objects with
// Keep; public, "AI, for <name>" and the question quoted in one line, decision 11), or a picture.
function messageEl(entry, own) {
  entry.chat = true;
  if (entry.visibility !== 'private') entry.visibility = 'public';
  let body;
  // A guest's messages all share the sender `guest` (server): the name is the typed one with the guest mark once, shown as text.
  let name = entry.who;
  let look = null;
  if (entry.picture) {
    body = document.createElement('div');
    body.className = 'message-body text';
    const img = document.createElement('img');
    img.alt = entry.name || 'picture';
    img.title = 'Open full size';
    img.addEventListener('click', () => window.open(img.src, '_blank'));
    // Fetched from the server, which holds it a short while: once it has gone, a plain line says so.
    img.addEventListener('error', () => {
      const gone = document.createElement('p');
      gone.className = 'message-picture-gone';
      gone.textContent = PICTURE_GONE;
      img.replaceWith(gone);
    }, { once: true });
    img.src = entry.src;
    body.appendChild(img);
  } else if (entry.kind === 'ai') {
    look = chatInput.commandLook(entry);
    const quote = entry.visibility === 'public' && entry.question ? entry.question : null;
    if (quote) name = `AI, for ${quote.who}`;
    body = chatInput.answerBody(entry.text, entry.summaries, quote ? quote.text : '', { sent: entry.sent, used: entry.used, cut: entry.cut, numbered: entry.numbered, leftOut: entry.leftOut });
    if (quote) {
      const q = document.createElement('p');
      q.className = 'message-quote';
      q.textContent = quote.text.replace(/\s+/g, ' ').trim();
      q.title = quote.text;
      body.prepend(q);
    }
  } else {
    body = document.createElement('div');
    body.className = 'message-body text';
    if (entry.kind === 'command') look = chatInput.commandLook(entry);
    body.innerHTML = renderMarkup(entry.kind ? entry.text : stripSummaryMarkers(entry.text));
    // The words a module attached to an /ai question: its label under the question, as text (the words stay on the server).
    if (entry.kind === 'command' && entry.attached && typeof entry.attached.label === 'string' && entry.attached.label) {
      const line = document.createElement('p');
      line.className = 'message-attached';
      line.textContent = `Attached: ${entry.attached.label}`;
      body.appendChild(line);
    }
    const link = entry.kind ? null : linkBox(entry);
    if (link) { stackBody(body); body.appendChild(link); }
  }
  const el = frameMessage({
    name,
    at: entry.at,
    visibility: entry.visibility,
    kind: entry.kind === 'ai' ? 'ai' : entry.kind === 'command' ? 'command' : own ? 'own' : '',
    icon: look ? look.icon : '',
    tint: look ? look.tint : null,
    command: entry.kind === 'command' && look ? look.label : '',
    by: entry.kind === 'ai' ? '' : senderKey(entry),
    body,
    entry,
  });
  if (entry.kind === 'command' && own) el.classList.add('own');
  el.classList.add('is-chat');
  if (chatIdOk(entry.id)) el.dataset.chatId = entry.id;
  return el;
}

// Put a message where its time places it (a message made public long after it was written, decision 10); a new one
// goes last.
function placeMessage(el) {
  const list = $('messages');
  const at = Number(el.dataset.at);
  if (Number.isFinite(at)) {
    const later = [...list.querySelectorAll(':scope > .message[data-at]')].find((m) => Number(m.dataset.at) > at);
    if (later) { list.insertBefore(el, later); return false; }
  }
  list.appendChild(el);
  return true;
}

function addEntry(entry, own = false) {
  if (!entry.at) entry.at = new Date();
  else if (!(entry.at instanceof Date)) entry.at = new Date(entry.at);
  entry.chat = true;
  chatLog.push(entry);
  const el = messageEl(entry, own);
  const last = placeMessage(el);
  if (last) $('messages').scrollTop = $('messages').scrollHeight;
  chatInput.arrived(el, { own }); // the other view's mark, the Assistant's news read out (GitHub #203)
  // The unread number counts new public messages from others, whatever the filter shows. Home's chat in its column is
  // in sight, so nothing there counts (its unread on the Home link is plan-home-lobby.md's step 4).
  if (homeChatSpace) return;
  if (!canvas.builtinOpen('chat') && !own && entry.visibility !== 'private') {
    unread += 1;
    entry.counted = true; // so a clear can take it off the number again (dropChatEntries)
    canvas.setBuiltinUnread('chat', unread);
  } else if (canvas.columnMode() && columnCollapsed() && !own && entry.visibility !== 'private') {
    // The chat in the column behind the collapsed rail is not read either: the rail shows the number.
    unread += 1;
    entry.counted = true;
    canvas.setBuiltinUnread('chat', unread);
  }
  syncRail();
}

// A private message the server just stored and returned (a command's echo, an /ai question and its answer), or a
// guest's echo drawn on this page only (`local`).
function addStoredMessage(m, { local = false } = {}) {
  if (!local && chatIdOk(m?.id) && chatMessageNode(m.id)) return;
  const entry = storedEntry(m, { local });
  addEntry(entry, entry.kind !== 'ai');
}

function saveChat() {
  if (!chatLog.length) return;
  const lines = chatLog.map((e) => `[${e.at.toLocaleTimeString()}] ${e.who}: ${e.picture ? `[picture${e.name ? ' ' + e.name : ''}]` : e.text}`);
  saveBlob(new Blob([lines.join('\n') + '\n'], { type: 'text/plain' }), `${(homeChatSpace ? word('home') : spaceName).replace(/[^\w-]+/g, '-').toLowerCase()}-chat-${new Date().toISOString().slice(0, 10)}.txt`);
}

// Pictures: pasted, dropped or picked, shrunk to a sensible size, then sent to the server
// (POST /api/spaces/:id/chat/pictures), which holds them a short while and tells everyone on the live stream where to
// fetch them (GET /api/spaces/:id/chat/pictures/:id); nothing is stored.
const MAX_IMAGE_SIDE = 1600;
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  const keep = file.size <= 1.5e6 && Math.max(bmp.width, bmp.height) <= MAX_IMAGE_SIDE && /^image\/(png|jpeg|gif|webp)$/.test(file.type);
  if (keep) {
    bmp.close();
    return file;
  }
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.85));
  return new File([blob], `${(file.name || 'picture').replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
}

const CHAT_PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
async function sendImage(file) {
  // Not into Home's chat (plan-home-lobby.md, step 4): pictures are a space's.
  const space = chatSpace();
  if (!file || !file.type.startsWith('image/') || !space || space.isAside || !canDo('sendPictures') || homeChatSpace) return;
  let entry = null;
  try {
    let out = await shrinkImage(file);
    if (!CHAT_PICTURE_TYPES.includes(out.type)) out = new File([out], out.name || 'picture', { type: 'image/png' }); // never: shrinkImage answers one of them
    chatInput.setView('discussion'); // a picture is for everyone: it shows in the Discussion
    // Drawn at once; the server's id replaces this page's when it answers, so the live stream's copy is not drawn twice.
    entry = { id: newChatId(), who: me?.displayName || 'me', by: me?.key || '', picture: true, blob: out, src: URL.createObjectURL(out), name: out.name || 'picture' };
    addEntry(entry, true);
    const q = new URLSearchParams({ file: entry.name });
    if (guestToken) {
      q.set('guest', guestToken);
      q.set('pass', guestPass);
    }
    const { id } = await api('POST', `/api/spaces/${encodeURIComponent(space.id)}/chat/pictures?${q}`, out, out.type);
    if (chatIdOk(id)) {
      dropChatMessage(id); // the live stream's copy, when it came first
      const el = chatMessageNode(entry.id);
      entry.id = id;
      if (el) el.dataset.chatId = id;
    }
  } catch (err) {
    if (entry) dropChatMessage(entry.id);
    chatNotice(err.serverSaid ? `Picture not sent: ${err.message}` : 'Picture not sent. Try again.', true);
  }
}
// A picture someone sent (chat-picture, from the live stream): where to fetch it, never its bytes. A guest's fetch
// carries their link and pass, as their other chat requests do.
const PICTURE_GONE = 'Picture no longer available.';
function pictureEntry(data) {
  if (!CHAT_PICTURE_TYPES.includes(data.mime) || typeof data.space !== 'string' || !data.space) return null;
  const q = guestToken ? `?${new URLSearchParams({ guest: guestToken, pass: guestPass || '' })}` : '';
  const src = `/api/spaces/${encodeURIComponent(data.space)}/chat/pictures/${data.id}${q}`;
  return { id: data.id, who: String(data.who || 'someone'), by: String(data.by || ''), picture: true, src, name: String(data.file || 'picture'), at: data.at };
}
// A picture's bytes (to copy it or send it to a module): this page's own, else fetched once from the server. null once
// the server no longer holds it.
async function pictureBlob(entry) {
  if (entry.blob instanceof Blob) return entry.blob;
  try {
    const res = await fetch(entry.src, { credentials: 'same-origin' });
    if (!res.ok) return null;
    entry.blob = await res.blob();
    return entry.blob;
  } catch {
    return null;
  }
}

function imageFiles(list) {
  return [...(list || [])].filter((f) => f && f.type && f.type.startsWith('image/'));
}

// --- reactions ------------------------------------------------------------------
// A reaction travels over the call's data channel (topic "reaction"),
// never stored: every call page and every OBS view page of that player
// floats it up from their tile for a couple of seconds.

// The reaction tray, as the admin has set it up (Manage > Theme); keys 1
// to 6 reach only the first six, however many are configured.
let REACTIONS = {}; // id -> glyph
let REACTION_KEYS = []; // id, in tray order
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function renderReactionTray(list) {
  const reactions = Array.isArray(list) ? list : [];
  REACTIONS = Object.fromEntries(reactions.map((r) => [r.id, r.glyph]));
  REACTION_KEYS = reactions.map((r) => r.id);
  renderChatEmoji(reactions);
  const tray = $('react-tray');
  tray.textContent = '';
  reactions.forEach((r, i) => {
    const button = document.createElement('button');
    button.className = 'react';
    button.type = 'button';
    button.dataset.reaction = r.id;
    button.dataset.tip = i < 6 ? `${r.label} (${i + 1})` : r.label;
    button.setAttribute('aria-label', button.dataset.tip);
    button.textContent = r.glyph;
    tray.appendChild(button);
  });
}

function showReaction(identity, id) {
  const glyph = REACTIONS[id];
  const tile = tiles.get(identity);
  if (!glyph || !tile) return;
  const el = tile.ownerDocument.createElement('span');
  el.className = 'reaction';
  el.textContent = glyph;
  el.style.left = `${20 + Math.random() * 60}%`;
  el.addEventListener('animationend', () => el.remove());
  setTimeout(() => el.remove(), 3000); // a hidden tab never fires animationend
  tile.appendChild(el);
}

async function sendReaction(id) {
  if (!features.allowReactions || !canDo('react') || !REACTIONS[id] || call.state !== 'connected') return;
  showReaction(call.localParticipant.identity, id); // data is not echoed back
  try {
    await call.localParticipant.publishData(encoder.encode(JSON.stringify({ type: 'reaction', id })), { reliable: true, topic: 'reaction' });
  } catch (err) {
    chatNotice(`reaction: ${err.message}`, true);
  }
}

function toggleTray(open = $('react-tray').hidden) {
  if (open && !(features.allowReactions && canDo('react'))) return;
  $('react-tray').hidden = !open;
  $('react-toggle').classList.toggle('on', open);
  if (open) { closeSettings(); fitTray(); }
}
// The tray rises from the toolbar; with many reactions it would rise under the header, and its first row (keys 1 to 6)
// could not be clicked (GitHub #169). Its bottom stays where it is, so its height is capped to the room between its
// bottom and the header's (or the window's top, in a window with no header), and the rest scrolls inside it.
const TRAY_GAP = 8;
function fitTray() {
  const tray = $('react-tray');
  if (!tray || tray.hidden) return;
  if (placeStripPopover(tray)) return; // in the column: up or down, where there is more room
  const doc = tray.ownerDocument;
  const header = doc.getElementById('topbar');
  const top = header && header.getClientRects().length ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
  const height = Math.floor(tray.getBoundingClientRect().bottom - top - TRAY_GAP);
  tray.style.maxHeight = `${Math.max(64, height)}px`; // never less than one row
}
window.addEventListener('resize', fitTray);
// In the always-on column the toolbar is near the top of the window, so its popovers (a control's settings, the
// reactions) open down over the chat when there is more room below than above, else up over the tiles as anywhere
// else; either way capped to that room and scrolled inside. Elsewhere it does nothing and says so (false).
const POPOVER_GAP = 8;
function placeStripPopover(el) {
  if (!el) return false;
  if (!el.closest('.side-column-strip')) {
    if (el.classList.contains('opens-down')) { el.classList.remove('opens-down'); el.style.maxHeight = ''; }
    return false;
  }
  const doc = el.ownerDocument;
  const view = doc.defaultView || window;
  const bar = $('video-bar').getBoundingClientRect();
  const header = doc.getElementById('topbar');
  const top = header && header.getClientRects().length ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
  const above = Math.floor(bar.top - top - 10 - POPOVER_GAP);
  const below = Math.floor(view.innerHeight - bar.bottom - 6 - POPOVER_GAP);
  const down = below > above;
  el.classList.toggle('opens-down', down);
  el.style.maxHeight = `${Math.max(64, down ? below : above)}px`;
  return true;
}

// The settings popover shows one focused group at a time: mic, audio
// (speaker + volume), camera, layout, or "more" (everything else -- guests,
// install, account links) for the gear. Each of mic/audio/camera/layout's
// own caret opens straight to its group; clicking the same one again (or
// anywhere outside) closes it, same as any dropdown.
function closeSettings() {
  $('settings').hidden = true;
  for (const b of confEl.querySelectorAll('[data-settings]')) b.classList.remove('on');
}
function openSettings(group) {
  const trigger = confEl.querySelector(`[data-settings="${group}"]`);
  if (!$('settings').hidden && $('settings').dataset.group === group) {
    closeSettings();
    return;
  }
  for (const el of confEl.querySelectorAll('.settings-group')) el.hidden = el.dataset.group !== group;
  $('settings').dataset.group = group;
  $('settings').hidden = false;
  for (const b of confEl.querySelectorAll('[data-settings]')) b.classList.remove('on');
  if (trigger) trigger.classList.add('on');
  toggleTray(false);
  placeStripPopover($('settings')); // in the column: up or down, where there is more room
}

// A built-in module's own header, with the name and icon this environment shows it by (canvas.js hands them over once the
// space's modules are loaded).
function showBuiltinName(def) {
  const name = def.el.querySelector('[data-module-name]');
  if (name) name.textContent = def.name;
  const icon = def.el.querySelector('[data-module-icon]');
  if (icon) icon.className = `fa-solid fa-${def.icon} fa-fw`;
}

// The conference is a module too: docked, floating or in a window of its own, and it can be
// closed, which leaves the call but not the space. It is the flexible column, and the first
// one. Its switch only shows and hides it, like every module's, and always reads its name (Thomas, 2026-09-30):
// shown it says "Not in a call" and never joins by itself; switched off (the switch, its titlebar x) it hangs up, so
// nobody is left in the call with the module hidden. Entering a space never joins either, for members and guests alike
// (Thomas, 2026-09-30): only a click joins, the green phone or "Join the call". Moving it between docked, floating and
// a window leaves the call running.
canvas.registerBuiltin({
  id: 'conference',
  name: 'Conference',
  inCall: () => inCall, // the phone's tab bar marks the switch while in the call, not merely while shown
  shareLift: () => screenShared(), // back in the column (canvas.js placeBuiltins): lifted again while a screen is shared
  icon: 'video',
  el: $('conference'),
  onShown: (def) => { showBuiltinName(def); setCallHead(def); }, // and the column's titlebar for the call
  order: -1,
  flex: true,
  modes: ['dock', 'float', 'window'],
  wrap: 'canvas conference-canvas', // out of the canvas's grid it needs a .canvas of its own
  slot: '#side-column-strip', // its place in the always-on column: the strip of tiles (plan-one-bar.md, step 6)
  onShow: () => { if (columnCollapsed()) setColumnCollapsed(false); }, // brought into view: the rail opens
  windowClass: 'conference-window',
  windowSize: { w: 640, h: 420 },
  floatSize: { w: 560, h: 380 },
  // The environment's switch holds for owners and the admin too (canDo says yes to them whatever it is), so the
  // canvas, the Modules menu and the Open with popover agree.
  allowed: () => conferenceAllowed({ callService: features.callService, conferenceEnabled: features.conferenceEnabled, permitted: canDo('conference') }),
  // A window of its own has its own document: idle/hover, popovers and keys need to hear it.
  onWindow: (win) => {
    win.document.title = spaceName;
    watchPointer(win.document);
    watchOutsideClick(win.document);
    win.document.addEventListener('keydown', onKey);
    win.document.addEventListener('keyup', onKeyUp);
    win.addEventListener('keydown', noteKey, true);
    win.document.addEventListener('pointerdown', notePointer, true);
    win.document.addEventListener('focusin', noteFocus, true);
    win.document.addEventListener('visibilitychange', releaseWhenHidden);
    win.addEventListener('blur', releaseTalk);
    win.addEventListener('pagehide', releaseTalk);
    win.document.addEventListener('fullscreenchange', syncFullscreenButton);
  },
  onWindowResize: () => applyLayout(),
  onChange: ({ open, mode, moving }) => {
    $('canvas').classList.toggle('conference-open', open && mode === 'dock'); // the narrow layout keys off this
    if (!moving) {
      if (open) { if (!inCall) setNoCall(true); syncWhoIsInCall(); } // shown (entering or switched on): out of the call until a click joins
      else { if (inCall) leftCall = true; stopCall(); setNoCall(false); } // switched off: hang up (nothing to do out of the call); it starts fresh next time
    }
    // In a window of its own LiveKit must not think the videos unseen (keepPoppedVideoLive); back in the page it may.
    if (open && mode === 'window') keepPoppedVideosLive();
    else if (!pipWindow) dropPoppedWatches();
    updateCrumb();
    syncCallPlace(); // Pop out or Bring the call back, and the column's strip for a call out of it
    setTimeout(applyLayout, 0); // once the module is in place
  },
});
// The titlebar's x closes the module (and with it the call); Hang up on the toolbar only leaves the call.
$('conf-close').addEventListener('click', () => { if (pipWindow) closePopout(); canvas.closeBuiltin('conference'); });
$('no-call-join').addEventListener('click', () => phoneButton());


// The chat is a built-in module, shown like any other: a column beside the video, floating,
// or a window of its own (see canvas.js). This is what the canvas
// tells the chat when it opens or closes.
canvas.registerBuiltin({
  id: 'chat',
  name: 'Chat',
  icon: 'message',
  el: $('chat'),
  // The Discussion's word follows the environment's name for Chat, else "Discussion" (GitHub #203).
  onShown: (def) => { showBuiltinName(def); setDiscussionWordFrom(def.name); },
  // Not while it shows on Home (plan-home-lobby.md, step 3): the canvas never takes it from Home's column (crossing the
  // phone line opens the built-ins in the side column); entering a space gives it back first.
  allowed: () => canDo('chatRead') && !homeChatSpace,
  slot: '#side-column-chat', // its place in the always-on column, under the call (plan-one-bar.md, step 6)
  onShow: () => { if (columnCollapsed()) setColumnCollapsed(false); }, // brought into view: the rail opens
  width: prefs.chatWidth,
  onWidth: (w) => { prefs.chatWidth = w; savePrefs(); },
  onChange: ({ open, mode, moving }) => {
    $('canvas').classList.toggle('chat-open', open && mode === 'dock'); // the narrow layout keys off this
    applyLayout();
    if (open) {
      unread = 0;
      canvas.setBuiltinUnread('chat', assistantNew);
      chatViews?.seen();
      // Into the message box when it opens, but not when it only moves (docked, floating, snapped), and not while the
      // module chooser's list is open: the switch that turned it on keeps the keyboard.
      if ((!moving || mode === 'window') && !$('space-setup')?.contains(document.activeElement)) $('chat-input').focus();
      $('messages').scrollTop = $('messages').scrollHeight;
    }
  },
});

// The Discussion's word on the first choice of Chat's view switch: the environment's name for Chat, else "Discussion" (GitHub #203).
function setDiscussionWordFrom(name) {
  const b = $('chat-view-discussion');
  const w = b?.querySelector('.mf-word');
  if (!w) return;
  w.textContent = discussionWord(name);
  b.setAttribute('aria-label', w.textContent);
  if (window.hostSwitch && !$('chat-views').hidden) window.hostSwitch.fit($('chat-views'));
}

function toggleChat(open = !canvas.builtinOpen('chat')) {
  if (open) { canvas.openBuiltin('chat'); if (canvas.columnMode()) setColumnCollapsed(false); }
  else canvas.closeBuiltin('chat');
}

// --- microphone: device -> level -> gate -> what the call hears -----------
//
// The mic is processed in the page before it is published, so the level
// slider and the noise gate work in every browser and the meter shows what
// others actually receive. Changing device or filters swaps the input; the
// published track stays the same.

const mic = { ctx: null, raw: null, source: null, level: null, gate: null, analyser: null, timer: 0, dest: null, track: null, open: true, shown: 0, bypass: false };
let pttHeld = false; // while the push-to-talk key is held: its code (see onKeyUp)

function micConstraints() {
  const c = { noiseSuppression: prefs.noise, echoCancellation: prefs.echo, autoGainControl: prefs.agc };
  if (prefs.micId) c.deviceId = { exact: prefs.micId };
  return c;
}

async function buildMicGraph() {
  mic.ctx = new AudioContext();
  mic.level = mic.ctx.createGain();
  mic.dest = mic.ctx.createMediaStreamDestination();
  try {
    // The gate lives on the audio thread (see gate-worklet.js), so it keeps
    // working when the tab is hidden and page timers are throttled.
    await mic.ctx.audioWorklet.addModule('/gate-worklet.js');
    mic.gate = new AudioWorkletNode(mic.ctx, 'mic-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    mic.gate.port.onmessage = (event) => onMicLevel(event.data);
    mic.level.connect(mic.gate);
    mic.gate.connect(mic.dest);
  } catch (err) {
    console.warn('[app] no audio worklet, gate off:', err.message);
    mic.gate = null;
    mic.analyser = mic.ctx.createAnalyser();
    mic.analyser.fftSize = 512;
    mic.level.connect(mic.analyser);
    mic.level.connect(mic.dest);
    mic.timer = setInterval(meterFromAnalyser, 50);
  }
  mic.track = mic.dest.stream.getAudioTracks()[0];
}

// Rebuilds just the graph's output node (and the track that publishes from
// it) after LiveKit has stopped the old one -- everything upstream (the
// AudioContext, gain, gate/analyser) is untouched and still running.
function rebuildMicDestination() {
  const from = mic.gate || mic.level;
  from.disconnect(mic.dest);
  mic.dest = mic.ctx.createMediaStreamDestination();
  from.connect(mic.dest);
  mic.track = mic.dest.stream.getAudioTracks()[0];
}

async function openMic() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
  } catch (err) {
    if (!prefs.micId) throw err;
    prefs.micId = ''; // the remembered device is gone
    savePrefs();
    stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
  }
  const raw = stream.getAudioTracks()[0];
  if (!mic.ctx) await buildMicGraph();
  // LiveKit's call.disconnect() (on every hang up and every reconnectTo(), including
  // every aside/private step and the return from one) stops the underlying
  // MediaStreamTrack of whatever was published -- our processed track from
  // the Web Audio graph included. A stopped track can never restart, so
  // without this the mic would go dead the moment you first stepped aside
  // and stay dead for the rest of the session.
  else if (!mic.track || mic.track.readyState === 'ended') rebuildMicDestination();
  if (mic.source) mic.source.disconnect();
  if (mic.raw) mic.raw.stop();
  mic.raw = raw;
  mic.source = mic.ctx.createMediaStreamSource(new MediaStream([raw]));
  mic.source.connect(mic.level);
  applyMicSettings();
  await mic.ctx.resume();
  if (mic.ctx.state !== 'running') {
    // No audio output device or the browser refused to start the graph:
    // publish the microphone as it is, without level and gate.
    console.warn('[app] audio graph not running; publishing the raw microphone');
    mic.bypass = true;
    return raw;
  }
  return mic.track;
}

// The call bar's microphone level: a fill rising from the bottom of the button (level from 0 to 1); the steps 0 to 5 are for the words.
let micShown = -1;
function showMicLevel(level) {
  const pct = Math.max(0, Math.min(100, Math.round(level * 100)));
  if (pct === micShown) return;
  micShown = pct;
  const el = $('meter');
  const n = Math.min(5, Math.round(level * 5));
  el.style.setProperty('--pct', pct + '%');
  el.setAttribute('aria-valuenow', String(n));
  el.setAttribute('aria-valuetext', ['Silent', 'Quiet', 'Quiet', 'Medium', 'Loud', 'Loud'][n]);
}

function closeMic() {
  if (mic.raw) mic.raw.stop();
  if (mic.source) mic.source.disconnect();
  mic.raw = null;
  mic.source = null;
  mic.shown = 0;
  showMicLevel(0);
}

function applyMicSettings() {
  if (!mic.ctx) return;
  mic.level.gain.setTargetAtTime(prefs.gain / 100, mic.ctx.currentTime, 0.02);
  // slider 0..60 maps to a quiet-to-loud rms range
  if (mic.gate) mic.gate.parameters.get('threshold').value = prefs.gate / 100 / 4;
  $('gain-value').textContent = `${prefs.gain}%`;
  $('gate-value').textContent = !mic.gate && mic.ctx ? 'unavailable' : prefs.gate ? `${prefs.gate}` : 'off';
}

// Level and gate state from the audio thread: peak hold with a quick decay
// reads better than raw samples.
function onMicLevel({ level, open }) {
  mic.shown = Math.max(Math.min(1, level * 4), mic.shown * 0.85);
  showMicLevel(mic.shown);
  if (open !== mic.open) {
    mic.open = open;
    $('mic').classList.toggle('gated', !open);
  }
}

const samples = new Float32Array(512);
function meterFromAnalyser() {
  if (!mic.analyser) return;
  mic.analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  onMicLevel({ level: Math.sqrt(sum / samples.length), open: true });
}

// The master volume (Settings > Audio output) multiplies every remote
// participant's own volume (set by hovering their tile) rather than
// replacing it, so both stay independently adjustable.
function effectiveVolume(identity) {
  return (prefs.masterVolume / 100) * (prefs.volumes[identity] ?? 1);
}

function setVolume(participant, volume) {
  prefs.volumes[participant.identity] = volume;
  savePrefs();
  const pub = participant.getTrackPublication(Track.Source.Microphone);
  if (pub?.track?.setVolume) pub.track.setVolume(effectiveVolume(participant.identity));
}

function applyMasterVolume() {
  for (const p of call.remoteParticipants.values()) {
    const pub = p.getTrackPublication(Track.Source.Microphone);
    if (pub?.track?.setVolume) pub.track.setVolume(effectiveVolume(p.identity));
  }
}

// The output device every remote participant's audio plays through.
async function applySpeaker() {
  if (!prefs.speakerId) return;
  for (const audio of canvasDoc().querySelectorAll('audio')) {
    if (audio.setSinkId) await audio.setSinkId(prefs.speakerId).catch(() => {});
  }
}

const RESOLUTIONS = { 360: { width: 640, height: 360 }, 540: { width: 960, height: 540 }, 720: { width: 1280, height: 720 } };
function videoConstraints() {
  const c = { resolution: RESOLUTIONS[prefs.quality] || RESOLUTIONS[720] };
  if (prefs.camId) c.deviceId = { exact: prefs.camId };
  return c;
}

async function setPushToTalk(on) {
  prefs.ptt = on;
  savePrefs();
  pttHeld = false;
  $('mic').dataset.tip = on ? `Push to talk: hold ${formatHotkey(prefs.pttKey)} (M toggles)` : 'Microphone';
  if (on && call.state === 'connected') await call.localParticipant.setMicrophoneEnabled(false).catch(() => {});
  reflectMic();
}

function reflectMic() {
  const on = call.localParticipant?.isMicrophoneEnabled;
  $('mic').classList.toggle('on', !!on);
  $('mic').classList.toggle('off', !on);
  $('mic').classList.toggle('ptt', prefs.ptt);
  // On a phone the conference can be hidden behind the chat while the mic is live, so the tab bar's call item says so
  // (paintCallTab: Online's icon turns the readable red).
  micLive = Boolean(on);
  paintCallTab();
  if (call.state === 'connected') updateMuted(call.localParticipant);
}

// --- call events ---------------------------------------------------------------

// A tile's muted mark follows the person's microphone publication: one coming or going changes it as much as a mute
// does. Someone joining the call says "on" before their microphone is published, so their tile is made with none
// (marked muted), and no TrackMuted/TrackUnmuted ever comes for a microphone published unmuted. updateMuted does nothing
// for someone not in the call. The camera's picture keeps to TrackMuted/TrackUnmuted and attachTrack/detachTrack.
// The page is connected here only while on the call (startCall), so everyone it hears of is on the call too: joining is
// ParticipantConnected, hanging up ParticipantDisconnected. Away is the live stream's (showAway, from presence).
call
  .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => { attachTrack(participant, track); updateMuted(participant); })
  .on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => detachTrack(participant, track))
  .on(RoomEvent.LocalTrackPublished, (pub) => { if (pub.track) attachTrack(call.localParticipant, pub.track); updateMuted(call.localParticipant); })
  .on(RoomEvent.LocalTrackUnpublished, (pub) => { if (pub.track) detachTrack(call.localParticipant, pub.track); updateMuted(call.localParticipant); })
  .on(RoomEvent.ParticipantConnected, (p) => { if (shownInCall(p)) { tileFor(p); subscribeAll(p); updateMuted(p); updateCamera(p); } })
  // Nothing is received until I am in the conference; then everything published is taken.
  .on(RoomEvent.TrackPublished, (pub, p) => { if (shownInCall(p)) pub.setSubscribed(true); updateMuted(p); })
  .on(RoomEvent.TrackUnpublished, (_pub, p) => updateMuted(p))
  .on(RoomEvent.ParticipantDisconnected, removeParticipant)
  .on(RoomEvent.TrackMuted, (_pub, participant) => {
    updateMuted(participant);
    updateCamera(participant);
  })
  .on(RoomEvent.TrackUnmuted, (_pub, participant) => {
    updateMuted(participant);
    updateCamera(participant);
  })
  .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    const active = new Set(speakers.map((s) => s.identity));
    for (const [identity, tile] of tiles) tile.classList.toggle('speaking', active.has(identity));
    const loudest = speakers.find((s) => !s.isLocal) || speakers[0];
    if (loudest && loudest.identity !== speaker) {
      speaker = loudest.identity;
      if (prefs.layout === 'spotlight' && !prefs.pinned && prefs.follow) applyLayout();
    }
  })
  .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
    // The call carries reactions only; the chat and the asides' nudges come on the live stream (liveChatNotice, asideNudge).
    try {
      const data = JSON.parse(decoder.decode(payload));
      if (topic === 'reaction' && participant && data.type === 'reaction') showReaction(participant.identity, data.id);
    } catch (err) {
      // not ours
    }
  })
  // The call finding its way back after a network drop: the call's own state (the chat and who is here are the live
  // stream's, which says its own).
  .on(RoomEvent.Reconnecting, () => setStatus('reconnecting the call...'))
  .on(RoomEvent.ConnectionStateChanged, () => paintChatConn())
  .on(RoomEvent.Reconnected, () => { paintChatConn(); setStatus(`in ${spaceName}`); })
  // Only the call ended; the page stays in the space (leaving is leaveSpaceNow). Ended by the page itself (a hang up,
  // leaving, moving, a join backing out: disconnectCall) there is nothing more to do, nor while a join is still connecting
  // (its connect fails, and startCall says so); ended by the call service once on it (a drop it could not recover from,
  // a kick, the call closed) it is a hang up the person did not choose, said in the status.
  .on(RoomEvent.Disconnected, () => {
    paintChatConn();
    if (endingCall > 0 || unloading || !inCall) return;
    stopCall(); // a join still publishing its microphone backs out
    setNoCall(true);
    setStatus('the call dropped', true);
  });

// The page's own end of the call (a hang up, leaving, moving, a join backing out): the call service only, never the
// space. While it runs, the call's Disconnected knows it was this page's doing.
let endingCall = 0;
async function disconnectCall() {
  if (call.state === 'disconnected') return;
  endingCall += 1;
  try {
    await call.disconnect();
  } catch {
    // already gone
  } finally {
    endingCall -= 1;
  }
}

// Leaving the space (Leave, a kick, the space deleted, a move to another space or an aside, an entry that failed): the
// call ends if I am on it, the live stream closes (the server keeps me there for its grace), and the canvas, the chat,
// who is here and the tiles are cleared; Home shows. `said` is the status line's.
function leaveSpaceNow(said = `left the ${word('space')}`) {
  entered = false;
  viewingHome = false; // no space left to show home over
  canvas.suspend(); // tearing the space down must not become its remembered layout
  stopCall(); // on the call: off it (the call service only), its tiles and microphone gone
  hideHomeChat(); // Home's chat over the space gives the space's chat back first; Home shows its own again below
  closeLive(); // out of the space: the live stream goes with it (the server keeps me there for its grace)
  syncHomeChatStream(); // and Home's, in no space, takes its place
  paintChatConn();
  stopCallTime();
  syncCallControl();
  closeMic();
  closePopout();
  canvas.closeBuiltin('conference');
  setStatus(said);
  forgetSpace();
  currentSpace = null;
  currentLayoutTab = 'workspace'; // the tab is remembered for the visit only
  canvas.refresh(null);
  refreshLayouts(); // no space, no layouts
  document.body.classList.remove('in-space');
  $('canvas').hidden = true;
  resetRecallButton();
  updateRecallButton(); // no room, so the tool's own `visible` hides it
  clearInterval(recallTimer);
  $('recall-overlay').hidden = true;
  // A guest has no session and no room to pick from -- back to their own
  // name-only form for the one space their link is for, not the real
  // members' space list (which they can't do anything with anyway).
  $('join').hidden = guestMode;
  $('guest-join').hidden = !guestToken; // a door guest has typed a name already: their way back is the landing
  if (doorGuest) { location.href = '/guest#home'; return; }
  $('away').hidden = true;
  updateCrumb();
  asideSelection.clear();
  updateAsideConfirm();
  // Not setAway(false): that would try to re-enable mic/camera on a
  // participant that's already gone. Just drop the stale state so the
  // next space starts clean, not still marked away from the last one.
  $('away-overlay').hidden = true;
  isAway = false;
  awayMessage = '';
  awayRestartCam = false;
  $('away-toggle').classList.remove('off');
  $('away-toggle').dataset.tip = 'Away: pauses your mic and camera, mutes what you hear, and lets everyone know';
  for (const [, tile] of tiles) tile.remove();
  tiles.clear();
  for (const [, tile] of ghostTiles) tile.remove();
  ghostTiles.clear();
  canvasDoc().querySelectorAll('audio').forEach((el) => el.remove());
  $('messages').textContent = '';
  closeHostMenu();
  if ($('chat-views')) $('chat-views').hidden = true;
  toggleChat(false);
  toggleTray(false);
  loadPresence();
}

// An aside's nudge, from the live stream (openLive's onAside; the server's POST /api/asides, /recall and /return), with
// its `spaceId`. Deferred a tick, so the stream's own event finishes first.
function asideNudge(data) {
  // Someone pulled me aside. An owner's word is final -- just go. A peer's "Privately" needs this end to actually agree
  // to it first.
  if (data.type === 'aside-pull') {
    if (data.byOwner) {
      setTimeout(() => reconnectTo(data.spaceId, 'pulled aside...', { keepCall: true }), 0);
    } else {
      setTimeout(async () => {
        if (await confirmDialog({ title: `${data.from || 'Someone'} wants ${data.private === false ? 'to step aside with you' : 'to have a private word'}. Join them?`, action: 'Join' })) {
          reconnectTo(data.spaceId, data.private === false ? 'stepping aside...' : 'stepping aside privately...', { keepCall: true });
        }
      }, 0);
    }
  }
  // The other member of a pull-aside space clicked "Rejoin call"; follow them there instead of being left behind.
  else if (data.type === 'aside-return') {
    setTimeout(() => reconnectTo(data.spaceId, 'back to the call...', { keepCall: true }), 0);
  }
  // Someone just got pulled into an aside: prime the local data so their tile can turn into an "in an aside"
  // placeholder right away, without waiting for the next /api/presence poll. The server sends this to everyone in the
  // space, those pulled too, and their join can find this entry before presence answers. It has no origin, so it is
  // marked pending: presence replaces it (adoptPendingSpace), and with the origin "Rejoin call" shows in the aside. It
  // says whether the aside is private: then the placeholders never name who it is with: a private one's message carries
  // no members, and its entry keeps none even when one does (so it reads "Private", never "Private with ..."). Presence
  // names only the space they stepped out of to those outside the aside (decision 6), so what the message said is kept
  // for the placeholders (startedAsides).
  else if (data.type === 'aside-started') {
    const priv = data.private !== false; // not said reads as private: never name who it is with by mistake
    const said = Array.isArray(data.members) ? data.members.filter((k) => typeof k === 'string') : [];
    if (!presenceSpaces.some((r) => r.id === data.spaceId)) presenceSpaces.push(asideEntry({ id: data.spaceId, members: priv ? [] : said, private: priv, pending: true }));
    for (const key of said) {
      startedAsides.set(key, { private: priv, members: priv ? [] : said, at: Date.now() });
      const user = presenceUsers.get(key);
      if (user) { user.online = true; user.space = data.spaceId; user.aside = true; user.asidePrivate = priv; user.elsewhere = false; user.inCall = false; }
    }
    reconcileGhostTiles();
    // A private one names nobody, so who stepped out comes from presence (asidePrivate): ask now, not at the next poll.
    if (priv || !said.length) loadPresence();
  }
  // The admin clicked "Pull participants back" in the space this Private Conversation came from: warn, don't yank -- a
  // countdown, then go.
  else if (data.type === 'aside-recall') {
    startRecallCountdown(data.spaceId, data.spaceName);
  }
}
// Kicked (the live stream's `removed { reason: 'kicked' }`): out of the space, as leaving it. The server also takes them
// off the call, whose Disconnected may get here first (the call ends; the space is left here).
function leaveKicked() {
  forgetSpace();
  if (entered) leaveSpaceNow(`removed from the ${word('space')}`);
  else loadPresence();
}

async function fillDevices() {
  // Do not let the device list ask for permissions again: a denied camera
  // would throw here and drop an audio-only player out of the call.
  let devices = [];
  try {
    devices = await Room.getLocalDevices(undefined, false);
  } catch (err) {
    console.warn('[app] device list:', err.message);
  }
  const wantedFor = { audioinput: prefs.micId, videoinput: prefs.camId, audiooutput: prefs.speakerId };
  for (const [kind, select] of [['audioinput', $('mic-select')], ['videoinput', $('cam-select')], ['audiooutput', $('speaker-select')]]) {
    select.textContent = '';
    for (const d of devices.filter((d) => d.kind === kind)) {
      const option = document.createElement('option');
      option.value = d.deviceId;
      option.textContent = d.label || kind;
      select.appendChild(option);
    }
    const wanted = wantedFor[kind];
    if (wanted && [...select.options].some((o) => o.value === wanted)) select.value = wanted;
  }
}

// --- join / leave ---------------------------------------------------------------

// Disconnect (if connected) and join a different space. Used for the admin's
// own "pull aside" click, for the pulled player's push notification, and
// for "Rejoin call".
// From the dashboard: go into a space with one module's module open on one item, and nothing else changed. In the
// space already, that is just showing the canvas and opening the module.
// Into a space I was invited to (or started): the one I am in is left for it.
async function joinInvitedSpace(spaceId) {
  if (isHomeRecord(spaceId)) return landOnHome(); // an old link or invitation to the Lobby: Home, over a space kept
  if (entered && currentSpace?.id === spaceId) return returnToCanvas();
  if (entered) return reconnectTo(spaceId);
  return join(spaceId);
}
// An invitation accepted on this page (the toast in brand.js asks; a page that handles it says so).
document.addEventListener('app:invite-accept', (event) => {
  event.preventDefault();
  joinInvitedSpace(event.detail.spaceId);
});

async function openInSpace(spaceId, moduleId, ref) {
  // An object kept in the Lobby (the Calendar's Lobby events): its module's own page there, which keeps working
  // (/modules/<id>?space=lobby), since the Lobby is never entered (plan-home-lobby.md, step 2).
  if (isHomeRecord(spaceId)) {
    const href = `/modules/${encodeURIComponent(moduleId)}?${new URLSearchParams({ space: spaceId })}${ref ? `#ref=${encodeURIComponent(JSON.stringify(ref))}` : ''}`;
    if (currentSpace) openOverlay(href);
    else location.href = href;
    return;
  }
  if (entered && currentSpace?.id === spaceId) {
    returnToCanvas();
    canvas.open(moduleId);
    canvas.openRef(ref);
    return;
  }
  canvas.requestOpen(moduleId, ref);
  if (entered) await reconnectTo(spaceId);
  else await join(spaceId);
}
// A pull (into an aside, or back: "Pull participants back", "Rejoin call", following the others back) moves the call
// with you (Thomas, 2026-09-30, "Pull keeps you on the call"): `keepCall` says this is one, and if I was on the call I
// am on the new one without a click, through the same join check and microphone rules as a click (startCall). Out of
// the call, I land out of it. Going somewhere myself (an invitation, a module opened from the dashboard) never joins.
// Moving is leaving this space (its live stream closes, the call here ends) and entering the next (its live stream opens).
async function reconnectTo(spaceId, statusText, { keepCall = false } = {}) {
  const stayOnCall = Boolean(keepCall) && inCall; // read before leaving, which ends the call here
  if (entered) leaveSpaceNow(statusText || `left the ${word('space')}`);
  else if (statusText) setStatus(statusText);
  await join(spaceId, { joinCall: stayOnCall, pull: true });
}

// Admin only: pick who to pull into a private space with me -- click a
// tile's door icon to add or remove them, then confirm once ready.
function toggleAsideSelection(identity, button) {
  if (asideSelection.has(identity)) asideSelection.delete(identity);
  else asideSelection.add(identity);
  button.classList.toggle('selected', asideSelection.has(identity));
  updateAsideConfirm();
}

function updateAsideConfirm() {
  const overlay = $('aside-overlay');
  if (!overlay) return;
  overlay.hidden = asideSelection.size === 0;
  const n = asideSelection.size;
  const names = [...asideSelection].map((k) => presenceUsers.get(k)?.displayName || k);
  // An ordinary (recorded) aside and an off-the-record word are separate
  // permissions -- see Settings > Roles and /api/asides.
  const canAside = canDo('startAside') && features.allowAsides;
  const canPrivate = canDo('privateCall') && features.allowPrivate;
  $('aside-confirm').hidden = !canAside;
  $('aside-confirm-private').hidden = !canPrivate;
  $('aside-overlay-prompt').textContent = canAside ? `Step aside with ${names.join(' & ')}?` : `Have a private word with ${names.join(' & ')}?`;
  $('aside-confirm-label').textContent = n === 1 ? 'Step aside' : `Step aside with ${n}`;
  $('aside-confirm-private-label').textContent = n === 1 ? 'Privately' : `Privately with ${n}`;
}

// Back out without pulling anyone: un-pick everyone, door icons included.
function cancelAsideSelection() {
  for (const key of asideSelection) tiles.get(key)?.querySelector('.tile-aside')?.classList.remove('selected');
  asideSelection.clear();
  updateAsideConfirm();
}

// Admin only: pull one or more people who are currently in the call into a
// new space with me, for a word away from the rest. `priv` marks a real
// off-the-record word (Studio hides it from the recording, and the stream
// doesn't follow me there) rather than an in-fiction private moment (still
// recorded, just muted/dimmed on the main feed while it's happening).
async function pullAside(identities, priv = false) {
  try {
    const { aside } = await api('POST', '/api/asides', { with: identities, private: priv });
    asideSelection.clear();
    await reconnectTo(aside.id, priv ? 'stepping aside privately...' : 'stepping aside...', { keepCall: true });
  } catch (err) {
    setStatus(`pull aside: ${err.message}`, true);
  }
}

// "Rejoin call": return to the space a pull-aside space came from
// (whichever space that was, not always the Lobby), and bring whoever else
// is still in there with me.
async function returnFromAside() {
  try {
    const { space: homeSpace } = await api('POST', '/api/asides/return');
    await reconnectTo(homeSpace.id, 'back to the call...', { keepCall: true });
  } catch (err) {
    setStatus(`rejoin call: ${err.message}`, true);
  }
}

// Leaving entirely (not "Rejoin call" -- I'm not going anywhere
// myself). If I'm in a pulled-aside space, regular or private, whoever's
// still in there with me would otherwise be stranded -- an aside/private
// space is normally just the two (or few) of us, so without me there's no
// reason for them to still be off in a space by themselves. Applies to
// anyone, not just an admin: a Private Conversation doesn't need one.
// Same nudge /api/asides/return already sends the others in
// returnFromAside() above; I just never reconnect anywhere myself afterward.
async function leaveSpace() {
  // On a call, Leave drops it, and sits beside the Online tab: ask first (Thomas, 2026-11-01). Off a call it is one tap.
  // A kick or the space ending does not come through here (leaveKicked, leaveSpaceNow), so they never ask.
  if (inCall && !await confirmDialog({ title: `Leave and end your call?`, message: `You leave this ${word('space')} and the call.`, action: 'Leave', cancel: 'Stay', kind: 'destructive' })) return;
  if (!entered) return; // the space ended while the question was open
  if (currentSpace?.isAside) {
    await api('POST', '/api/asides/return').catch(() => {});
  }
  if (entered) leaveSpaceNow();
}

// The breadcrumb in the top bar's anchor (plan-primary-nav.md, decision 14): nothing on home; in a space, its name,
// current; in an aside, the parent's name (a button that does what Rejoin call does, decision 25, through the crumb's
// listener below), then "<Aside word>: <the others' first names>", current. The space bar no longer names the space.
// The top bar is told where this page is present, for the switcher's mark.
function crumbSegmentHtml(seg, icon) {
  const inner = `<i class="${icon.includes(' ') ? icon : `fa-solid fa-${icon}`} fa-fw" aria-hidden="true"></i><span class="crumb-label">${escapeHtml(seg.label)}</span>`;
  // An aside's parent segment says what it does: "Rejoin call in <space>" (its title and its accessible name).
  // Each segment is a top-bar link to look at (`core-link`, as Calendar, Map and Spaces are), so it can't drift from them.
  if (seg.action) return `<button type="button" class="crumb-here core-link crumb-link" data-crumb-action="${seg.action}" title="${escapeHtml(seg.title || seg.label)}" aria-label="${escapeHtml(seg.title || seg.label)}">${inner}</button>`;
  // A div, not a span: the top bar's left zone is .brand, whose `span` rule sizes the environment's name.
  return `<div class="crumb-here core-link"${seg.current ? ' aria-current="location"' : ''} title="${escapeHtml(seg.label)}">${inner}</div>`;
}
function updateCrumb() {
  const connected = entered && currentSpace;
  setPresentSpace(connected ? (currentSpace.isAside ? currentSpace.origin || null : currentSpace.id) : null);
  document.body.classList.toggle('in-aside', Boolean(connected) && inAside()); // an aside's column is the whole screen (style.css)
  // What the anchor shows is anchorSegments() (primary-nav.js, held by check-nav): the space's breadcrumb, nothing while
  // home is shown over it, or a guest link's space before the guest enters.
  let space = null;
  let parentName = '';
  let others = [];
  let originSpace = null;
  if (currentSpace?.isAside) {
    originSpace = presenceSpaces.find((r) => r.id === currentSpace.origin) || null;
    parentName = originSpace && !originSpace.isAside ? spaceDisplayName(originSpace) : '';
    others = (currentSpace.members || []).filter((k) => k !== me?.key).map((k) => presenceUsers.get(k)?.displayName).filter(Boolean);
    space = { isAside: true };
  } else if (currentSpace) {
    space = { name: spaceName };
  }
  const segs = anchorSegments({ space, viewingHome, guestSpaceName: guestMode ? guestSpaceName : '', parentName, asideWord: word('aside', { cap: true }), others });
  const iconOf = (seg) => (!currentSpace ? spaceCrumbIcon(null) : currentSpace.isAside ? (seg.action ? spaceCrumbIcon(originSpace) : 'people-arrows') : spaceCrumbIcon(currentSpace));
  setTopbarLocation(segs.map((seg) => crumbSegmentHtml(seg, iconOf(seg))).join('<span class="crumb-sep" aria-hidden="true">&rsaquo;</span>'));
  // The one bar (step 7): the switcher reads the last segment; the Spaces slot leaves.
  const last = segs[segs.length - 1] || null;
  paintSpaceSwitcher(last, last ? iconOf(last) : spaceCrumbIcon(null));
  setInSpace(oneBar());
  if (settingUp && !canOpenSetup()) spaceSetup.cancel(); // home over the space, an aside, a space left: Set up ends
  placeSetupName(); // while setting up, the current segment is the name's input
  nav.draw('secondary');
  updatePhaseChip(); // the strip follows the breadcrumb: shown in a space, gone on home, in an aside and for a guest
}

// `joinCall`: a pull moving my call with me (reconnectTo); entering a space never joins by itself, unless the
// environment's "join the call on entering" is on (autoJoinOnEntry, in enterSpace). `pull`: this is a pull, not
// the person entering again, so having left the call still counts (leftCall stays).
// Entering is opening the space's live stream (openLive): its first `ready` is the server's yes, its refusal the error
// said on Home (no such space, not one of mine). The call service is never asked.
async function join(spaceId = 'lobby', { joinCall = false, pull = false } = {}) {
  if (isHomeRecord(spaceId)) return landOnHome(); // the Lobby is Home now (plan-home-lobby.md, step 2): never entered
  if (!pull) leftCall = false; // entering again: a person who left the call may be joined again
  viewingHome = false; // entering any space shows it, and its breadcrumb, whatever was on screen before
  homeChatEntering = true; // the chat leaves Home's column at once: the space's history fills it (enterSpace)
  hideHomeChat();
  currentLayoutTab = 'workspace'; // entering a space opens on the Workspace tab (plan-layout-views.md), never the last space's
  $('join-error').hidden = true;
  for (const b of document.querySelectorAll('[data-join]')) b.disabled = true;
  const entry = ++entries;
  let placed = false;
  try {
    setStatus('connecting...');
    // Fresh permissions each join -- an admin may have changed them since
    // this page loaded.
    me = (await api('GET', '/api/me')).user;
    if (entry !== entries) return; // another entry began meanwhile
    // The space as the page already lists it; presence fills the rest in when it answers and does not hold the entry
    // (GitHub #71).
    const known = presenceSpaces.find((r) => r.id === spaceId);
    currentSpace = known || { id: spaceId, name: spaceName, members: [], pending: true };
    paintSetupLabel();
    if (!currentSpace.pending) spaceName = spaceDisplayName(currentSpace);
    placed = true;
    await liveOpened(openLive(spaceId));
    if (entry !== entries) return;
    // One the page does not list yet (an aside made a moment ago, an invitation's): presence first, so an aside is
    // entered as an aside (adoptPendingSpace), never asked for a space's modules and chat.
    if (currentSpace.pending) await loadPresence();
    else loadPresence();
    if (entry !== entries) return;
    await canvas.refresh(currentSpace.isAside ? null : currentSpace.id); // asides have no modules
    if (entry !== entries) return;
    spaceName = spaceDisplayName(currentSpace);
    applyPermissions();
    updateRecallButton();
    enterSpace({ joinCall });
  } catch (err) {
    if (err?.closed || entry !== entries) return; // given way to another entry
    if (placed) leaveSpaceNow(''); // back on Home, the space not kept
    setStatus('', false);
    forgetSpace(); // a space that cannot be joined is not remembered, so a reload does not try it again
    $('join-error').textContent = err.message;
    $('join-error').hidden = false;
  } finally {
    if (entry === entries) {
      for (const b of document.querySelectorAll('[data-join]')) b.disabled = false;
      homeChatEntering = false;
      syncHomeChat(); // in the space: nothing; refused, still on Home: Home's chat again
    }
  }
}
// Entries counted, so one given up for another (a move while still entering) stops where it is.
let entries = 0;
// How long entering waits for the live stream's first answer. Past it the page goes in anyway, the stream still trying
// (Reconnecting in Chat's status line), so a slow proxy never holds anyone at the door.
const LIVE_ENTER_WAIT_MS = 10000;
async function liveOpened(opened) {
  let timer = null;
  try {
    await Promise.race([opened, new Promise((resolve) => { timer = setTimeout(resolve, LIVE_ENTER_WAIT_MS); })]);
  } finally {
    clearTimeout(timer);
  }
}

// A guest link: locked to the one space the link is for, no space picker, no
// account -- everything past the live stream opening is identical to a real member's join.
async function joinAsGuest(joinedId, joinedName) {
  $('guest-join-error').hidden = true;
  leftCall = false; // a fresh entry
  const entry = ++entries;
  let placed = false;
  try {
    setStatus('connecting...');
    spaceName = joinedName;
    // Same as a member's join: the live stream, and presence fills in the members when it answers.
    const known = presenceSpaces.find((r) => r.id === joinedId);
    currentSpace = known || { id: joinedId, name: joinedName, members: [], pending: true };
    paintSetupLabel();
    placed = true;
    await liveOpened(openLive(joinedId));
    if (entry !== entries) return;
    loadPresence();
    await canvas.refresh(currentSpace.isAside ? null : currentSpace.id);
    if (entry !== entries) return;
    applyPermissions();
    updateRecallButton();
    enterSpace();
  } catch (err) {
    if (err?.closed || entry !== entries) return;
    if (placed) leaveSpaceNow('');
    setStatus('', false);
    $('guest-join-error').textContent = err.message;
    $('guest-join-error').hidden = false;
    if (doorGuest) setStatus(err.message, true); // their form is never shown
  }
}

// Shared by join() and joinAsGuest() once the live stream has opened: in the space, the canvas shown, and what this
// space starts with opened. No call: that is Start or Join call (startCall).
function enterSpace({ joinCall = false } = {}) {
  entered = true;
  console.debug('[app] in', currentSpace.id);
  if (!guestMode && currentSpace && !currentSpace.isAside) rememberSpace(currentSpace.id); // an aside is gone once it ends, so it is not kept
  $('join').hidden = true;
  $('guest-join').hidden = true;
  $('canvas').hidden = false;
  viewingHome = false; // every way into a space (join, a pull, an invitation, a reload) lands here
  updateCrumb();
  document.body.classList.add('in-space');
  wake();
  setStatus(`in ${spaceName}`);
  if (!currentSpace.isAside) {
    renderChatHistory(currentSpace.id);
    if (chatInput) chatInput.loadThread();
    loadLinkKeeper(currentSpace.id); // who keeps links here, and whether this person may (plan-chat-links.md)
  }
  canvas.updateMenu();
  // A fresh request, else the remembered layout, else what this space or environment opens with, else the chat and the modules.
  // The conference among them opens in "Not in a call": entering never joins, and the microphone is asked for only on a join.
  const firstTab = canvas.restore(); // 'calendar' or 'map' when a first visit opens on that tab (plan-layout-views.md, step 5)
  applyColumnPref(); // the always-on column, open or a rail, as this space was left
  const enteredId = currentSpace.id;
  refreshLayouts().then(() => showFirstVisitTab(firstTab, enteredId)); // and its saved layouts
  syncCallControl(); // who is in the call, for the conference's "Not in a call" note
  // An aside is the call only: its conference shows, "Not in a call" with Join the call until someone joins.
  if (currentSpace.isAside && !joinCall) canvas.showBuiltin('conference');
  // A pull while I was on the call (reconnectTo): straight onto this one, with the conference showing, through the
  // join check and the microphone rules a click goes through. Not awaited: the space is entered either way, and a
  // refusal is said in the "Not in a call" note as for a click. The environment's "join the call on entering"
  // (GitHub #199, autoJoinOnEntry) joins the same way, once per entry; blocked or refused, the Join row stays.
  if (joinCall || autoJoinOnEntry()) joinTheCall();
}

// Start the conference: connect to the call service, tiles for everyone in it, their media, and my own microphone.
// Runs only on a join: a click (the green phone or "Join the call"), or a pull that finds me on the call, which joins
// the new space's call from enterSpace() (entering a space otherwise never joins).
// The server is asked first (POST /api/call/join: the calls cap, then the call's token, the only way to one); a refusal
// is said in the "Not in a call" note and nothing is asked of the microphone. Then the call service, with that token: if
// it can't be reached (none running, none set up), the note says the call could not start, and the space goes on as it
// was. Every wait can outlast a stop (Hang up, the Conference switched off, leaving): after each one the join backs out
// if that happened, releasing what it got, and never publishes the microphone or says "on" after a stop.
let callGeneration = 0; // stopCall() counts it up, so a join still waiting sees it was stopped
let callJoining = null; // the join under way, until it is in the call or has backed out
async function startCall() {
  if (callJoining) await callJoining; // a join stopped part-way backs out first: the two would share the microphone
  if (inCall || callJoining || !entered || !currentSpace) return;
  const generation = callGeneration;
  // A stop came meanwhile (stopCall counts callGeneration up: a hang up, leaving, the call service dropping the join),
  // or the conference closed.
  const stopped = () => generation !== callGeneration || !entered || !canvas.builtinOpen('conference');
  // Back out of a stopped join. If nothing has stopped the call yet (the call or the module went some other way),
  // stop it now, which disconnects and releases everything; else release what this join got after the stop.
  const backOut = async (published) => {
    if (inCall && generation === callGeneration) { await stopCall(); return; }
    if (published && call.state === 'connected') await call.localParticipant.unpublishTrack(published, true).catch(() => {});
    await disconnectCall(); // what this join connected, if it got that far
    closeMic();
  };
  let settle;
  callJoining = new Promise((resolve) => { settle = resolve; });
  try {
    setJoinProblem('');
    let ticket = null; // the call's token, the only one there is (the server mints it only here)
    try {
      ticket = await api('POST', '/api/call/join', guestToken ? { guest: guestToken, pass: guestPass } : { space: currentSpace?.id });
    } catch (err) {
      // The server's own sentence when it gave one (the calls cap's refusal); anything else (no answer, a 500 page, a
      // proxy's 502) is said plainly, never as "HTTP 500".
      if (!stopped()) setJoinProblem(err.status && err.serverSaid ? err.message : 'Could not reach the server to join the call. Try again in a moment.');
      return;
    }
    if (stopped()) return;
    await disconnectCall(); // a call still closing (a hang up a moment ago, a move) finishes first
    if (stopped()) return;
    // Nothing is received until the tracks are asked for (subscribeAll), so autoSubscribe is off.
    try {
      await call.connect(ticket.livekitUrl, ticket.token, { autoSubscribe: false });
    } catch (err) {
      console.warn('[app] the call service:', err.message);
      if (!stopped()) setJoinProblem('Call not started: voice and video are unreachable.');
      return await backOut();
    }
    if (stopped()) return await backOut();
    console.debug('[app] on the call in', currentSpace.id);
    inCall = true;
    startCallTime();
    syncCallControl();
    setNoCall(false);
    canvas.updateMenu(); // the phone's Conference tab carries its in-call dot
    // "on", with away said in the same request when joining while away (or it was lost).
    sayPresence({ onCall: true, away: isAway, awayMessage: isAway ? awayMessage : '' });
    tileFor(call.localParticipant);
    applyMirror();
    for (const p of call.remoteParticipants.values()) {
      if (!shownInCall(p)) continue;
      tileFor(p);
      subscribeAll(p);
      updateMuted(p);
      updateCamera(p);
    }
    reconcileGhostTiles(); // anyone else in this space who's aside elsewhere, without waiting for the next poll
    // Only the microphone publishes on join. The camera stays off until
    // deliberately turned on -- a safety default, so nobody's video goes out
    // before they mean it to, and camera permission is only ever asked for
    // once someone actually reaches for it. toggleCam()'s setCameraEnabled
    // call already handles publishing a fresh track the first time, same as
    // it does for anyone who declined the camera here and turns it on later.
    let haveMic = false;
    try {
      const track = await openMic();
      if (stopped()) return await backOut();
      await call.localParticipant.publishTrack(track, { source: Track.Source.Microphone, name: 'microphone' });
      if (stopped()) return await backOut(track);
      haveMic = true;
      console.debug('[app] published audio');
      // Away when joining: the microphone stays off and comes on with Back, unless push to talk keeps it off anyway.
      if (isAway) awayRestoreMic = !prefs.ptt;
      if (prefs.ptt || isAway) {
        await call.localParticipant.setMicrophoneEnabled(false);
        if (stopped()) return await backOut(track);
      }
    } catch (err) {
      if (stopped()) return await backOut();
      console.warn('[app] no microphone:', err.message);
    }
    updateMuted(call.localParticipant);
    updateCamera(call.localParticipant);
    await fillDevices();
    if (stopped()) return await backOut();
    reflectMic();
    $('cam').classList.remove('on');
    $('cam').classList.add('off');
    setStatus(haveMic ? `in ${spaceName}` : `in ${spaceName} (no microphone)`);
    // Call position: Floating window, the person's own choice, floats it from the column as they join.
    if (prefs.callFloat && callWhere() === 'column') canvas.liftBuiltin('conference', true, 'person');
    applyLayout();
  } finally {
    callJoining = null;
    settle();
  }
}
// The join check's refusal (or no answer), said plainly where the person is looking: an error notice in Chat's status
// line (chatNotice) while the chat is in sight, else a toast (a phone showing the Conference or a module, the side
// column collapsed, the chat closed). '' says nothing (the notice clears itself).
function setJoinProblem(text) {
  if (!text) return;
  if (chatInSight()) chatNotice(text, true);
  else noticeToast(text, { kind: 'danger' });
}
// Whether the chat is where the person can read it: Home's, or the space's open, not behind the collapsed column, and on
// a phone the view being shown.
function chatInSight() {
  if (homeChatSpace) return true;
  if (!canvas.builtinOpen('chat') || (canvas.columnMode() && columnCollapsed())) return false;
  const shown = canvas.shownView();
  return shown === null || shown === 'chat';
}

// Leave the conference and stay in the space: disconnect from the call service (which stops sending and receiving
// media; everyone else drops my tile as I leave it there), drop the tiles, and say I am off the call on the live stream.
// All but the disconnect happens at once, so leaving the space (leaveSpaceNow) can go on straight after.
async function stopCall() {
  callGeneration += 1; // a join still under way backs out (it may not be in the call yet)
  setJoinProblem('');
  if (!inCall) return;
  inCall = false;
  stopCallTime();
  sayPresence({ onCall: false, away: false, awayMessage: '' }); // away ends with the call (below)
  const ending = disconnectCall(); // the call service only: the page stays in the space
  closeMic();
  // Away is a conference state: going out of the call ends it without a word to anyone.
  $('away-overlay').hidden = true;
  isAway = false;
  awayMessage = '';
  awayRestartCam = false;
  $('away-toggle').classList.remove('off');
  $('away-toggle').dataset.tip = 'Away: pauses your mic and camera, mutes what you hear, and lets everyone know';
  for (const [, tile] of tiles) tile.remove();
  tiles.clear();
  for (const [, tile] of ghostTiles) tile.remove();
  ghostTiles.clear();
  canvasDoc().querySelectorAll('audio').forEach((el) => el.remove());
  asideSelection.clear();
  updateAsideConfirm();
  $('cam').classList.remove('on');
  $('cam').classList.add('off');
  $('screen-share').classList.remove('on');
  toggleTray(false);
  closeSettings();
  if (entered) setStatus(`in ${spaceName}`);
  syncCallControl();
  syncShareLift(); // the tiles are gone: a lifted conference goes back into the column
  canvas.updateMenu(); // and loses it
  await ending;
}

// The hang-up button. In a pop-out window the canvas comes back to the page first, since the
// Layout button that brings the conference back is in the page's header.
// Hang up leaves the call but keeps the conference module, which says "Not in a call" while the toolbar's phone turns
// green to dial back in; the module's own close (its titlebar x) is what closes it. The whole-call popout comes back
// in with the call, as before.
function hangUp() {
  if (pipWindow) closePopout();
  leftCall = true; // their own choice: not joined again until they enter again (GitHub #199)
  // The call's own window or a floating call comes back to the column with it (its strip is the call's, out of it).
  if (canvas.columnMode() && callWhere() !== 'column') canvas.returnBuiltin('conference');
  stopCall();
  setNoCall(true);
}
function setNoCall(off) {
  $('conference').classList.toggle('call-off', off); // the section's state; .no-call is the note laid over the tiles
  $('no-call').hidden = !off;
  $('conf-close').dataset.tip = off ? 'Close' : 'Leave the call and close';
  $('conf-close').setAttribute('aria-label', $('conf-close').dataset.tip);
  syncWhoIsInCall();
  const h = $('hangup');
  h.classList.toggle('danger', !off);
  h.classList.toggle('dial', off);
  h.dataset.tip = off ? 'Join the call' : `Leave the call (you stay in the ${word('space')})`;
  h.setAttribute('aria-label', off ? 'Join the call' : 'Leave the call');
  h.querySelector('i').className = 'fa-solid fa-phone fa-fw'; // the handset, turned down to hang up (style.css)
}
// Join the call from outside the conference: the space bar's Join the call, and a pull that finds me on the call
// (enterSpace). Shows the Conference the way its Show switch does (canvas.showBuiltin: opened if hidden, brought
// into view on a phone), so its "Not in a call" note is there to say a refusal, then joins through startCall(), the
// one join path. Nothing happens where the conference may not open.
function joinTheCall() {
  if (!canvas.showBuiltin('conference')) return;
  startCall().catch((err) => setStatus(`call: ${err.message}`, true));
}
// The toolbar's phone: red hangs up, green dials back in.
function phoneButton() {
  if (inCall) hangUp();
  else startCall().catch((err) => setStatus(`call: ${err.message}`, true));
}

async function toggleMic() {
  if (!inCall) return;
  const enabled = !call.localParticipant.isMicrophoneEnabled;
  // Away, nobody hears you: coming back (the away button) is what turns the microphone on again.
  if (enabled && isAway) { setStatus('away: come back to turn your microphone on'); return; }
  try {
    await call.localParticipant.setMicrophoneEnabled(enabled);
  } catch (err) {
    setStatus(`microphone: ${err.message}`, true);
  }
  reflectMic();
}

let camToggling = false;
async function toggleCam() {
  if (!inCall) return;
  // getUserMedia (plus the retry above) can take a moment -- without this
  // guard a quick double-tap fires a second toggle before the first one has
  // actually turned the camera on, landing on whichever finishes last.
  if (camToggling) return;
  const enabled = !call.localParticipant.isCameraEnabled;
  // Away, nobody sees you: coming back (the away button) is what turns the camera on again.
  if (enabled && isAway) { setStatus('away: come back to turn your camera on'); return; }
  camToggling = true;
  $('cam').classList.add('loading');
  try {
    await setCameraEnabledWithRetry(enabled);
    if (enabled) await keepCameraOffWhileAway();
    // A camera change made while away with the camera off (restartCamera) is applied now it is on: turning it on
    // alone would open the device it had before.
    if (enabled && awayRestartCam && !isAway && call.localParticipant.isCameraEnabled) {
      awayRestartCam = false;
      await restartCamera();
    }
    if (enabled && prefs.background !== 'none') await applyBackground(); // a fresh track on re-enable needs the processor reapplied
  } catch (err) {
    setStatus(`camera: ${err.message}`, true);
  }
  camToggling = false;
  $('cam').classList.remove('loading');
  const on = call.localParticipant.isCameraEnabled;
  $('cam').classList.toggle('on', on);
  $('cam').classList.toggle('off', !on);
  updateCamera(call.localParticipant);
}

// Right after a reconnectTo() (stepping into or back from an aside/private),
// the camera device can still be a beat from actually releasing on the OS
// side -- most often on mobile -- so the very next getUserMedia can fail
// with NotReadableError even though nothing is really wrong. One short
// retry covers that without making a real failure (denied permission, no
// camera at all) wait needlessly.
async function setCameraEnabledWithRetry(enabled) {
  try {
    await call.localParticipant.setCameraEnabled(enabled);
  } catch (err) {
    if (!enabled || err?.name !== 'NotReadableError') throw err;
    await new Promise((resolve) => setTimeout(resolve, 700));
    await call.localParticipant.setCameraEnabled(enabled);
  }
}

// Desktop sharing: LiveKit's own screen-share track (getDisplayMedia under
// the hood), published and rendered as its own tile -- see screenTileFor.
async function toggleScreenShare() {
  if (!inCall) return;
  try {
    await call.localParticipant.setScreenShareEnabled(!call.localParticipant.isScreenShareEnabled, { audio: true });
  } catch (err) {
    // cancelling the browser's own share picker throws too -- not a real error
    if (err?.name !== 'NotAllowedError') setStatus(`screen share: ${err.message}`, true);
  }
  const on = call.localParticipant.isScreenShareEnabled;
  $('screen-share').classList.toggle('on', on);
  $('screen-share').dataset.tip = on ? 'Stop sharing your screen' : 'Share your screen';
}

// What I hear is off while I have muted it (deafened) or am away (setAway): every remote
// audio element, including any attached later (attachTrack), wherever the canvas is.
const hearingOff = () => !!prefs.deafened || isAway;
function applyHearing() {
  canvasDoc().querySelectorAll('audio').forEach((el) => { el.muted = hearingOff(); });
}
// Mute what I hear: everyone else's audio, not my own mic -- for when a
// phone call or something else needs the space quiet for a minute without
// actually leaving or muting yourself to the others.
function applyDeafen() {
  applyHearing();
  $('deafen').classList.toggle('on', !prefs.deafened);
  $('deafen').classList.toggle('off', prefs.deafened);
  $('deafen').dataset.tip = prefs.deafened ? 'Unmute what you hear' : 'Mute what you hear';
}

function toggleDeafen() {
  prefs.deafened = !prefs.deafened;
  savePrefs();
  applyDeafen();
}

$('mic').addEventListener('click', toggleMic);
$('cam').addEventListener('click', toggleCam);
$('deafen').addEventListener('click', toggleDeafen);
$('screen-share').addEventListener('click', toggleScreenShare);
applyDeafen();
$('mic-select').addEventListener('change', async (e) => {
  prefs.micId = e.target.value;
  savePrefs();
  if (mic.ctx) await openMic().catch((err) => setStatus(`microphone: ${err.message}`, true));
});
$('cam-select').addEventListener('change', async (e) => {
  prefs.camId = e.target.value;
  savePrefs();
  await restartCamera();
});
$('speaker-select').addEventListener('change', async (e) => {
  prefs.speakerId = e.target.value;
  savePrefs();
  await applySpeaker();
});
// A short tone through whichever speaker is picked above -- routed through
// an <audio> element (not straight to AudioContext.destination) since
// setSinkId is how a specific output device actually gets chosen, same as
// every remote participant's own audio already goes through one.
$('test-speaker').addEventListener('click', async () => {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 440;
    osc.connect(gain);
    const dest = ctx.createMediaStreamDestination();
    gain.connect(dest);
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.05); // fade in/out so it doesn't click
    gain.gain.setValueAtTime(0.25, now + 0.55);
    gain.gain.linearRampToValueAtTime(0, now + 0.65);
    const audio = new Audio();
    audio.srcObject = dest.stream;
    if (prefs.speakerId && audio.setSinkId) await audio.setSinkId(prefs.speakerId).catch(() => {});
    await audio.play();
    osc.start(now);
    osc.stop(now + 0.7);
    osc.onended = () => {
      audio.pause();
      ctx.close();
    };
  } catch (err) {
    setStatus(`test speaker: ${err.message}`, true);
  }
});
$('master-volume').addEventListener('input', (e) => {
  prefs.masterVolume = Number(e.target.value);
  savePrefs();
  syncCallPrefs({ masterVolume: prefs.masterVolume });
  $('volume-value').textContent = `${prefs.masterVolume}%`;
  applyMasterVolume();
});
$('gain').addEventListener('input', (e) => {
  prefs.gain = Number(e.target.value);
  savePrefs();
  syncCallPrefs({ gain: prefs.gain });
  applyMicSettings();
});
$('gate').addEventListener('input', (e) => {
  prefs.gate = Number(e.target.value);
  savePrefs();
  syncCallPrefs({ gate: prefs.gate });
  applyMicSettings();
});
for (const id of ['noise', 'echo', 'agc']) {
  $(id).addEventListener('change', async (e) => {
    prefs[id] = e.target.checked;
    savePrefs();
    syncCallPrefs({ [id]: prefs[id] });
    if (mic.ctx) await openMic().catch((err) => setStatus(`microphone: ${err.message}`, true));
  });
}
$('talk-mode').addEventListener('change', (e) => setPushToTalk(e.target.value === 'ptt'));
$('quality').addEventListener('change', async (e) => {
  prefs.quality = Number(e.target.value);
  savePrefs();
  syncCallPrefs({ quality: prefs.quality });
  await restartCamera();
});
$('mirror').addEventListener('change', (e) => {
  prefs.mirror = e.target.checked;
  savePrefs();
  syncCallPrefs({ mirror: prefs.mirror });
  applyMirror();
});
$('background-mode').addEventListener('change', async (e) => {
  prefs.background = e.target.value;
  savePrefs();
  syncCallPrefs({ background: prefs.background });
  await applyBackground();
});

function applyMirror() {
  const tile = call.localParticipant && tiles.get(call.localParticipant.identity);
  if (tile) tile.classList.toggle('mirror', prefs.mirror);
}

const MEDIAPIPE_ASSET_PATHS = { tasksVisionFileSet: '/lib/mediapipe-wasm', modelAssetPath: '/models/selfie_segmenter.tflite' };

// Blur, or a still picture (set on your profile page), behind your own
// camera -- entirely client-side (LiveKit's server never sees the real
// background or the other way around; this runs on the same track before
// it's published, same idea as a mirror flip). The model is real weight --
// a WASM runtime plus an ML segmenter -- so it's only fetched the first
// time someone actually turns either of these on, not on every join.
async function applyBackground() {
  const pub = call.localParticipant?.getTrackPublication(Track.Source.Camera);
  if (!pub?.track) return; // camera off right now; applied when it comes back on
  try {
    if (prefs.background === 'blur') {
      const { BackgroundBlur } = await import('/lib/track-processors.mjs');
      await pub.track.setProcessor(BackgroundBlur(10, undefined, undefined, { assetPaths: MEDIAPIPE_ASSET_PATHS }));
    } else if (prefs.background === 'image') {
      const { VirtualBackground } = await import('/lib/track-processors.mjs');
      await pub.track.setProcessor(VirtualBackground(`/img/${encodeURIComponent(me.key)}/background?v=${Date.now()}`, undefined, undefined, { assetPaths: MEDIAPIPE_ASSET_PATHS }));
    } else {
      await pub.track.stopProcessor();
    }
  } catch (err) {
    setStatus(`background: ${err.message}`, true);
    prefs.background = 'none';
    savePrefs();
    $('background-mode').value = 'none';
  }
}

async function restartCamera() {
  const pub = call.localParticipant?.getTrackPublication(Track.Source.Camera);
  if (!pub?.track) return;
  // Away: a restart asks the browser for the camera afresh, so it waits for Back (setAway).
  if (isAway) { awayRestartCam = true; return; }
  try {
    await pub.track.restartTrack(videoConstraints());
  } catch (err) {
    setStatus(`camera: ${err.message}`, true);
  }
}
$('hangup').addEventListener('click', phoneButton);
// The breadcrumb is drawn again with every updateCrumb() call, so one delegated listener on the stable container: an
// aside's parent segment does what Rejoin call does (decision 25). Rejoin call and Leave also live in the space's bar.
$('topbar-crumb').addEventListener('click', (event) => {
  const action = event.target.closest('[data-crumb-action]')?.dataset.crumbAction;
  if (action === 'rejoin') returnFromAside();
});
$('aside-confirm').addEventListener('click', () => pullAside([...asideSelection]));
$('aside-confirm-private').addEventListener('click', () => pullAside([...asideSelection], true));
$('aside-cancel').addEventListener('click', cancelAsideSelection);
$('aside-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) cancelAsideSelection(); });
window.addEventListener('beforeunload', () => call.disconnect());

$('chat-close').addEventListener('click', () => toggleChat(false));
$('chat-more').addEventListener('click', (event) => {
  event.stopPropagation();
  const button = event.currentTarget;
  const items = [
    { icon: 'download', label: 'Save the chat', onPick: () => saveChat() },
  ];
  // Clear… (plan-chat-clear.md): by type, for whoever has something here they could clear. Guests never.
  if (canClearChat() && clearChoices(chatLog, { by: me.key, moderator: canModerateChat() }).length) {
    items.push({ icon: 'eraser', label: 'Clear…', onPick: () => openClearChatMenu(button) });
  }
  if (canModerateChat()) {
    items.push({ icon: 'trash', label: 'Delete the chat', danger: true, onPick: () => openConfirmMenu(button, {
      confirm: 'Delete the chat for everyone?',
      hint: 'Every message goes, for everyone, private ones too.',
      armed: true,
      onConfirm: async () => {
        const space = chatSpace();
        if (!space) return;
        try {
          await api('DELETE', `/api/spaces/${encodeURIComponent(space.id)}/chat`);
        } catch (err) {
          chatNotice(err.message || 'Could not delete the chat.', true);
          return;
        }
        dropSharedChat();
        try {
          localStorage.removeItem(chatHistoryKey(space.id));
          localStorage.removeItem(chatClearedKey(space.id));
        } catch {
          // the server already deleted it
        }
      },
    }) });
  }
  // The call's place, here too (the column's "..."): Pop out or Bring the call back, and Call position as a flyout.
  const where = callWhere();
  const outside = ['window', 'float', 'share'].includes(where);
  if (outside) items.push({ divider: true }, { icon: 'arrow-left', label: 'Bring the call back', onPick: bringCallBack });
  else if (where !== 'closed' && !phoneWidth()) items.push({ divider: true }, { icon: 'up-right-from-square', label: 'Pop out the call', onPick: popOutCall });
  if (canvas.columnMode() && where !== 'closed') items.push({ icon: 'up-down', label: 'Call position', items: () => callPlaceItems().filter((it) => !it.heading) });
  openHostMenu(button, items);
});
$('chat-pic').addEventListener('click', () => { $('chat-file').click(); });
$('chat-file').addEventListener('change', () => {
  for (const f of imageFiles($('chat-file').files)) sendImage(f);
  $('chat-file').value = '';
});
$('chat').addEventListener('paste', (event) => {
  const files = imageFiles(event.clipboardData?.files);
  if (!files.length) return;
  event.preventDefault();
  for (const f of files) sendImage(f);
});
$('chat').addEventListener('dragover', (event) => {
  event.preventDefault();
  $('chat').classList.add('drop');
});
$('chat').addEventListener('dragleave', () => $('chat').classList.remove('drop'));
$('chat').addEventListener('drop', (event) => {
  event.preventDefault();
  $('chat').classList.remove('drop');
  for (const f of imageFiles(event.dataTransfer?.files)) sendImage(f);
});
const chatInput = attachChatInput({
  $,
  api,
  guestToken, // a guest link has no session; the citations call carries it (GitHub #395)
  word,
  getSpace: () => chatSpace(), // Home's chat while it shows on Home (plan-home-lobby.md), else the space's
  isHome: () => Boolean(homeChatSpace), // Home's chat is the Discussion alone (GitHub #326)
  getMe: () => me,
  isGuest: () => !me?.key || me.role === 'guest' || Boolean(guestToken),
  keepStoredLink,
  canvas,
  resizeChatInput,
  renderMarkup,
  frameMessage,
  addStored: (m, opts) => addStoredMessage(m, opts),
  openMenu: openHostMenu,
  openObject: (ref) => openAttentionTarget(ref.module, ref),
  pictureBlob: (entry) => pictureBlob(entry),
  // Chat in sight: open, and not behind the column's collapsed rail.
  isShown: () => Boolean(homeChatSpace) || (canvas.builtinOpen('chat') && !(canvas.columnMode() && columnCollapsed())),
  // The Assistant's new results count on the rail and Chat's switch too (GitHub #203).
  onAssistantNew: (n) => {
    assistantNew = n;
    canvas.setBuiltinUnread('chat', unread + assistantNew);
    syncRail();
  },
});
chatViews = chatInput;
chatNoteFn = (text, error) => chatInput.note(text, error);
paintChatConn();
document.addEventListener('chat-tools-changed', () => fitChatChrome());
askInChat = (input) => chatInput.askAbout(input);
attachInChat = (input) => chatInput.attach(input);
$('chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('chat-input').value.trim();
  // A dropped object stands in for the words in the Assistant: the server then asks its usual question about it.
  if (!canDo('chat') || (!text && !chatInput.canAskEmpty())) return;
  // Where the line goes: a command runs in the Assistant, switching there from the Discussion, in either view; in the
  // Assistant a pasted import answer is brought in and any other words ask the AI; in the Discussion words are a
  // message for everyone.
  const route = chatInput.routeLine(text);
  if (route.run === 'import') {
    if (await chatInput.importText(route.line)) {
      $('chat-input').value = '';
      resizeChatInput();
      chatInput.resetHint();
    }
    return;
  }
  if (route.run === 'command' || route.run === 'ai') {
    if (await (route.run === 'ai' ? chatInput.ask(route.line) : chatInput.handleSubmit(route.line))) {
      $('chat-input').value = '';
      resizeChatInput();
      chatInput.resetHint();
    }
    return;
  }
  if (route.run !== 'message') return;
  $('chat-input').value = '';
  resizeChatInput();
  chatInput.resetHint();
  await sendChatText(text);
});
// Enter sends, as in any chat; Shift+Enter makes a new line. There is no Send button. A phone keyboard's Enter or Send
// key may not report a key (Android keyboards send "Unidentified"), so the line break it asks for is taken too: a
// break asked for without Shift is a send (beforeinput).
let chatShift = false;
$('chat-input').addEventListener('keydown', (event) => {
  chatShift = event.shiftKey;
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  $('chat-form').requestSubmit();
});
$('chat-input').addEventListener('keyup', () => { chatShift = false; });
$('chat-input').addEventListener('blur', () => { chatShift = false; });
$('chat-input').addEventListener('beforeinput', (event) => {
  if ((event.inputType !== 'insertLineBreak' && event.inputType !== 'insertParagraph') || chatShift || event.isComposing) return;
  event.preventDefault();
  $('chat-form').requestSubmit();
});
// Grows with the text up to a few lines, then scrolls -- resetting height
// to 'auto' first is what lets scrollHeight shrink back down too, not just
// grow, when a line is deleted. The field is border-box, so its edge is added back (else five lines show a scrollbar);
// its max-height stops it at five lines (system.css, the chat block).
function resizeChatInput() {
  const el = $('chat-input');
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
}
$('chat-input').addEventListener('input', resizeChatInput);

// Wraps the current selection (or just inserts an empty pair, cursor
// landing in the middle) in the chat input with the given marker --
// **bold**, *italic*, `code`, matching what renderMarkup() understands.
function wrapChatSelection(marker) {
  const el = $('chat-input');
  const { selectionStart: start, selectionEnd: end, value } = el;
  const selected = value.slice(start, end);
  el.value = value.slice(0, start) + marker + selected + marker + value.slice(end);
  el.focus();
  const from = start + marker.length;
  el.setSelectionRange(from, from + selected.length);
  resizeChatInput();
}
$('chat-bold').addEventListener('click', () => wrapChatSelection('**'));
$('chat-italic').addEventListener('click', () => wrapChatSelection('*'));
$('chat-code').addEventListener('click', () => wrapChatSelection('`'));
// Prefixes the current line (or every non-blank line the selection spans)
// with "- ", rather than wrapping like the others -- a list marker belongs
// at the start of a line, not around a span of text.
$('chat-list').addEventListener('click', () => {
  const el = $('chat-input');
  const { selectionStart: start, selectionEnd: end, value } = el;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = value.indexOf('\n', end) === -1 ? value.length : value.indexOf('\n', end);
  const block = value.slice(lineStart, lineEnd);
  const newBlock = block.split('\n').map((l) => (l.trim() ? `- ${l}` : l)).join('\n');
  el.value = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
  el.focus();
  el.setSelectionRange(lineStart, lineStart + newBlock.length);
  resizeChatInput();
});
$('chat-format-bar').addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  $('chat-help-popup').hidden = true;
  $('chat-emoji-popup').hidden = true;
  if (chatInput) { chatInput.hidePicker(); }
  $('chat-input').focus();
});
$('chat-help').addEventListener('click', (e) => {
  e.stopPropagation();
  $('chat-emoji-popup').hidden = true;
  if (chatInput) chatInput.hidePicker();
  const help = $('chat-help-popup');
  help.hidden = !help.hidden;
  if (!help.hidden) placeAbove(help, visibleAnchor($('chat-help')));
});
document.addEventListener('click', (e) => {
  if (!$('chat-help-popup').hidden && !e.target.closest('#chat-help-popup')) $('chat-help-popup').hidden = true;
  if (!$('chat-emoji-popup').hidden && !e.target.closest('#chat-emoji-popup')) $('chat-emoji-popup').hidden = true;
  if (chatInput && !e.target.closest('#chat-command-wrap')) chatInput.hidePicker();
});

// The chat's emoji picker offers the same list as the reaction tray (the admin
// sets it under Manage > Theme), rebuilt whenever that list is loaded.
function renderChatEmoji(reactions) {
  const popup = $('chat-emoji-popup');
  popup.textContent = '';
  for (const r of reactions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chat-emoji-btn';
    b.textContent = r.glyph;
    b.dataset.tip = r.label;
    b.setAttribute('aria-label', b.dataset.tip);
    b.addEventListener('click', () => {
      const el = $('chat-input');
      const { selectionStart: start, selectionEnd: end, value } = el;
      el.value = value.slice(0, start) + r.glyph + value.slice(end);
      el.focus();
      const at = start + r.glyph.length;
      el.setSelectionRange(at, at);
      resizeChatInput();
    });
    popup.appendChild(b);
  }
  $('chat-emoji').hidden = reactions.length === 0;
}
$('chat-emoji').addEventListener('click', (e) => {
  e.stopPropagation();
  $('chat-help-popup').hidden = true;
  if (chatInput) chatInput.hidePicker();
  const emoji = $('chat-emoji-popup');
  emoji.hidden = !emoji.hidden;
  if (!emoji.hidden) placeAbove(emoji, visibleAnchor($('chat-emoji')));
});

$('layout').addEventListener('click', cycleView);
$('layout-pick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (b) setView(b.dataset.view);
});
window.addEventListener('resize', applyLayout);

$('floatbar').addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-settings]');
  if (trigger) openSettings(trigger.dataset.settings);
});

// --- floatbar overflow -------------------------------------------------------
// Only "More" and hang up always show; everything else collapses into "More"
// (rather than wrapping to a second row) as the bar runs out of room, lowest
// data-collapse first -- the extras, then chat, then camera, then the
// microphone last. See fitFloatbar(), called from applyLayout() whenever the
// canvas (or the chat next to it) changes size.
const FLOATBAR_ALL = [...$('floatbar').children];
const FLOATBAR_COLLAPSE_ORDER = FLOATBAR_ALL.filter((el) => el.dataset.collapse).sort(
  (a, b) => Number(a.dataset.collapse) - Number(b.dataset.collapse)
);
// In the always-on column the toolbar is the whole toolbar too (plan-one-bar.md, step 6): a wrapping row of at most
// two rows under the tiles; what still does not fit folds into "..." (lowest data-collapse first, call-toolbar.js),
// which opens on the shared menu (openFoldedMenu). The folded ones are marked data-folded (style.css hides them), so
// a control hidden for its own reason (no screen share here) keeps its own `hidden`.
const FLOATBAR_ROWS_IN_COLUMN = 2;
const floatbarInColumn = () => Boolean(confEl.closest('.side-column-strip'));
function fitFloatbar() {
  const bar = $('floatbar');
  // Put everything back in its original spot first -- simplest way to get a
  // stable, correctly-ordered result every time rather than tracking where
  // each collapsed item needs to be spliced back in.
  for (const item of FLOATBAR_ALL) { bar.appendChild(item); delete item.dataset.folded; }
  $('floatbar-more').hidden = true;
  if (floatbarInColumn()) $('floatbar-more').setAttribute('aria-haspopup', 'menu'); // the column's "..." opens a menu
  else $('floatbar-more').removeAttribute('aria-haspopup');
  if (floatbarInColumn()) {
    $('floatbar-overflow').hidden = true;
    fitFloatbarInColumn(bar);
    fitChatChrome();
    return;
  }
  for (const item of FLOATBAR_COLLAPSE_ORDER) {
    if (bar.scrollWidth <= bar.clientWidth) break;
    if (item.hidden) continue; // already hidden by its own logic (no room link, say) -- moving it won't help
    $('floatbar-overflow').appendChild(item);
    $('floatbar-more').hidden = false;
  }
  fitChatChrome();
}

function fitFloatbarInColumn(bar) {
  const more = $('floatbar-more');
  if (!bar.clientWidth) return; // not drawn (out of the call, the column collapsed): fitted again when it shows
  const style = getComputedStyle(bar);
  const width = bar.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
  const gap = parseFloat(style.columnGap) || 0;
  more.hidden = false; // measured with the rest, then hidden again unless something folds
  const items = FLOATBAR_ALL.map((el) => ({
    id: el.id || el.querySelector('.fbtn')?.id,
    el,
    width: el.getBoundingClientRect().width,
    priority: el.dataset.collapse === undefined ? null : Number(el.dataset.collapse),
    hidden: el.id === 'floatbar-more' ? false : el.hidden,
  }));
  const folded = foldCallToolbar({ items, width, gap, rows: FLOATBAR_ROWS_IN_COLUMN, more: 'floatbar-more' });
  for (const it of items) if (folded.includes(it.id)) it.el.dataset.folded = '1';
  more.hidden = folded.length === 0;
}
// The column's "..." on the shared menu: each folded control in the toolbar's order, by its own tooltip, and its
// settings caret as an entry of its own. A pick clicks the control itself, so it does just what it does on the toolbar.
function openFoldedMenu(trigger) {
  const entries = [];
  for (const el of FLOATBAR_ALL) {
    if (!el.dataset.folded || el.hidden) continue;
    const btn = el.matches('button') ? el : el.querySelector('.fbtn');
    if (!btn || btn.hidden) continue;
    entries.push({ icon: rowIcon(btn), label: btn.getAttribute('aria-label') || btn.dataset.tip || btn.title, onPick: () => btn.click() });
    const caret = el.querySelector('.fbtn-caret');
    if (caret) entries.push({ icon: 'sliders', label: caret.getAttribute('aria-label') || caret.title, onPick: () => caret.click() });
  }
  openHostMenu(trigger, entries);
}

// The same fold as the conference bar, for a row of icon buttons in the chat: lowest data-collapse
// first (left to right) into that row's "...". A button hidden for its own reason (Bring in research
// when it does not apply) is left alone. data-collapsed marks the ones this fold hid, so they can come back.
function rowIcon(el) {
  const node = el.querySelector('i');
  const match = node && node.className.match(/fa-(?!solid|regular|fw\b)([a-z0-9-]+)/);
  return match ? match[1] : '';
}
function rowLabel(el) {
  const named = el.matches('button') ? el : el.querySelector('button');
  return (named && (named.getAttribute('aria-label') || named.dataset.tip || named.title)) || el.getAttribute('aria-label') || 'More';
}
function fitRow(bar) {
  if (!bar) return;
  const more = bar.querySelector('[data-more]');
  const items = [...bar.querySelectorAll('[data-collapse]')].filter((el) => !el.dataset.off).sort(
    (a, b) => Number(a.dataset.collapse) - Number(b.dataset.collapse)
  );
  for (const item of items) {
    if (!item.dataset.collapsed) continue;
    item.hidden = Boolean(item.dataset.off); // a tool the view does not use stays away (chat-input.js paintModeTools)
    delete item.dataset.collapsed;
  }
  if (more) more.hidden = true;
  if (!bar.clientWidth) return;
  const spills = () => {
    const edge = bar.getBoundingClientRect();
    return [...bar.querySelectorAll('button')].some((child) => {
      if (child.hidden || child.closest('[hidden]')) return false;
      const box = child.getBoundingClientRect();
      return box.left < edge.left - 1 || box.right > edge.right + 1;
    });
  };
  let guard = 0;
  while (spills() && guard < 20) {
    const next = items.find((el) => !el.hidden && !el.dataset.collapsed);
    if (!next) break;
    next.hidden = true;
    next.dataset.collapsed = '1';
    if (more) more.hidden = false;
    guard += 1;
  }
}
function fitChatChrome() {
  fitRow($('chat-format-bar'));
}
function openCollapsed(more, bar) {
  const hidden = [...bar.querySelectorAll('[data-collapsed]')];
  openHostMenu(more, hidden.map((el) => ({
    icon: rowIcon(el),
    label: rowLabel(el),
    onPick: () => {
      const btn = el.matches('button') ? el : el.querySelector('button');
      btn?.click();
    },
  })));
}
function visibleAnchor(el) {
  const collapsed = el.closest('[data-collapsed]');
  const more = $('chat-format-more');
  if ((el.hidden || collapsed) && more && !more.hidden) return more;
  return el;
}
for (const barId of ['chat-format-bar']) {
  const bar = $(barId);
  if (!bar) continue;
  const more = bar.querySelector('[data-more]');
  if (more) more.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openCollapsed(more, bar);
  });
  // The row's own box, not the column: opening the import panel does not resize the column.
  new ResizeObserver(() => fitRow(bar)).observe(bar);
}
$('floatbar-overflow').addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-settings]');
  if (trigger) openSettings(trigger.dataset.settings);
  if (event.target.closest('button')) $('floatbar-overflow').hidden = true;
});
$('floatbar-more').addEventListener('click', (event) => {
  event.stopPropagation();
  if (floatbarInColumn()) { openFoldedMenu($('floatbar-more')); return; } // the column's: the shared menu
  $('floatbar-overflow').hidden = !$('floatbar-overflow').hidden;
});
document.addEventListener('click', (event) => {
  if (!$('floatbar-overflow').hidden && !event.target.closest('#floatbar-overflow') && !event.target.closest('#floatbar-more')) {
    $('floatbar-overflow').hidden = true;
  }
});

// Guests: the space's own reusable join link, same door for everyone at the
// call to open (see the guest-link routes) -- not just an admin.
function say(el, text, error = false) {
  el.textContent = text;
  el.classList.toggle('error', error);
  if (text && !error) setTimeout(() => el.textContent === text && (el.textContent = ''), 3000);
}
async function copyText(text, statusEl) {
  try {
    await navigator.clipboard.writeText(text);
    if (statusEl) say(statusEl, 'copied');
  } catch (err) {
    window.prompt('Copy this:', text);
  }
}
function renderGuestLink() {
  if (guestMode || !currentSpace) return; // a guest has no session to manage this with
  $('guest-section').hidden = !canDo('canInvite');
  const space = presenceSpaces.find((r) => r.id === currentSpace.id);
  const token = space?.guestToken || null;
  const allowed = space?.allowGuests !== false;
  $('guest-link-off-note').hidden = allowed;
  $('guest-link-value').textContent = token ? `${location.origin}/guest/${token}` : 'off';
  $('guest-link-on').hidden = !allowed || !!token;
  $('guest-link-copy').hidden = !token;
  $('guest-link-new').hidden = !allowed || !token;
  $('guest-link-off').hidden = !token;
}
async function setGuestLink(body) {
  try {
    if (body === null) await api('DELETE', `/api/spaces/${encodeURIComponent(currentSpace.id)}/guest-link`);
    else await api('POST', `/api/spaces/${encodeURIComponent(currentSpace.id)}/guest-link`, body);
    await loadPresence();
    renderGuestLink();
  } catch (err) {
    say($('guest-link-status'), err.message, true);
  }
}
$('guest-link-on').addEventListener('click', () => setGuestLink({}));
$('guest-link-new').addEventListener('click', () => setGuestLink({ regenerate: true }));
$('guest-link-off').addEventListener('click', () => setGuestLink(null));
$('guest-link-copy').addEventListener('click', () => copyText($('guest-link-value').textContent, $('guest-link-status')));
$('react-toggle').addEventListener('click', () => toggleTray());
$('react-tray').addEventListener('click', (event) => {
  const button = event.target.closest('[data-reaction]');
  if (!button) return;
  sendReaction(button.dataset.reaction);
  toggleTray(false);
});

// Keyboard: M mic, V camera, D deafen, C chat, L layout, R reactions, S
// screen share (once available), 1 to 6 send a reaction, the account's own
// push-to-talk key held = talk while in that mode, unless typing in a
// field. The account's mute and camera hotkeys (Cmd/Ctrl+D and +E by
// default, set on the profile page) work alongside M and V, not instead
// of them.
document.addEventListener('keydown', onKey);
document.addEventListener('keyup', onKeyUp);
// Whether the key went to a text field. A module that runs in the page keeps its fields in a shadow root, where
// event.target is only the root's host, so the field itself is the first thing on the event's path.
function typing(event) {
  const target = (event.composedPath && event.composedPath()[0]) || event.target;
  return Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable));
}
// Where focus last went by keyboard (see pressesControl): taken as focus moves, after a key or a pointer press, so a
// script's focus counts as whatever the person did last (a menu picked by mouse gives its button focus back by mouse).
// The browser's :focus-visible can't tell: by the time the key's own keydown arrives, it already says keyboard.
let byPointer = false;
let keyFocus = null;
function notePointer() {
  byPointer = true;
  keyFocus = null; // a click on the control focus is already on moves no focus, and makes it the mouse's
}
function noteKey() {
  byPointer = false;
}
function noteFocus(event) {
  keyFocus = byPointer ? null : (event.composedPath && event.composedPath()[0]) || event.target;
}
window.addEventListener('keydown', noteKey, true); // the window's capture runs first, before a menu's own keys move focus
document.addEventListener('pointerdown', notePointer, true);
document.addEventListener('focusin', noteFocus, true);
// Whether the key presses the focused control, so push-to-talk leaves it alone: Space or Enter on an entry of an open
// menu, or on a button (or anything playing one) reached by keyboard. A button focused by a mouse click keeps
// push-to-talk, or clicking the mic and then holding Space would press the mic again. Fields are typing()'s.
function pressesControl(event) {
  if (event.key !== ' ' && event.key !== 'Enter') return false;
  const target = (event.composedPath && event.composedPath()[0]) || event.target;
  if (!target || !target.matches) return false;
  if (target.closest('[role=menu]')) return true;
  if (target !== keyFocus) return false;
  return target.matches('button, summary, [role=button], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=checkbox], [role=switch], [role=tab]');
}
// Talking stops when the key that started it comes up, wherever focus has moved and whatever modifier came down since
// (pttHeld holds that key's code), or when its release can't reach the page: the window loses focus, is hidden or goes.
function releaseTalk() {
  if (!pttHeld) return;
  pttHeld = false;
  call.localParticipant.setMicrophoneEnabled(false).then(reflectMic).catch(() => {});
}
function releaseWhenHidden(event) {
  if (event.target.visibilityState === 'hidden') releaseTalk();
}
window.addEventListener('blur', releaseTalk);
window.addEventListener('pagehide', releaseTalk);
document.addEventListener('visibilitychange', releaseWhenHidden);
function onKeyUp(event) {
  if (prefs.ptt && pttHeld && event.code === pttHeld) {
    releaseTalk();
    event.preventDefault();
  }
}
function onKey(event) {
  if (!document.body.classList.contains('in-space')) return;
  if (typing(event)) return;
  // Push-to-talk only while in the call: out of it the key does nothing, or holding it would open the microphone
  // (LiveKit publishes one) with the person not in the call. Letting go is safe either way (releaseTalk).
  if (inCall && prefs.ptt && hotkeyMatches(event, prefs.pttKey) && !pressesControl(event)) {
    event.preventDefault();
    if (event.repeat || pttHeld || isAway) return; // away, nobody hears you (setAway)
    pttHeld = event.code;
    call.localParticipant.setMicrophoneEnabled(true).then(reflectMic).catch(() => {});
    return;
  }
  // Configurable mute/camera shortcuts (Cmd/Ctrl+D and +E by default, same
  // as Google Meet) check first since they carry a modifier the plain
  // single-letter shortcuts below intentionally reject.
  if (hotkeyMatches(event, prefs.muteKey)) { toggleMic(); event.preventDefault(); return; }
  if (hotkeyMatches(event, prefs.camKey)) { toggleCam(); event.preventDefault(); return; }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 'm') toggleMic();
  else if (key === 'v') toggleCam();
  else if (key === 'd') toggleDeafen();
  else if (key === 'c') { if (canvas.columnMode() && canvas.builtinOpen('chat')) setColumnCollapsed(!columnCollapsed()); else toggleChat(); } // the column never closes: C collapses it and opens it
  else if (key === 'l') cycleView();
  else if (key === 'r') toggleTray();
  else if (key === 's' && !$('screen-share').hidden) toggleScreenShare();
  else if (key === 'f') toggleFullscreen(event.target.ownerDocument || event.target);
  else if (/^[1-6]$/.test(key)) sendReaction(REACTION_KEYS[Number(key) - 1]);
  else return;
  event.preventDefault();
}

// --- mobile viewport quirks ---------------------------------------------------

// On a phone the keyboard overlays the page, and CSS's own `dvh` is slow to follow the browser's address and tab
// bars: visualViewport.height keeps the shell (and so the Chat input) above both (see body.in-space in style.css).
// Only at phone width (the max-width: 640px rule). A tablet's keyboard or shortcut bar must not shrink the shell,
// so wider than that the property is removed and the shell is plain 100dvh.
function syncViewportHeight() {
  const root = document.documentElement;
  if (window.innerWidth > 640) { root.style.removeProperty('--app-vh'); return; }
  root.style.setProperty('--app-vh', `${window.visualViewport?.height || window.innerHeight}px`);
}
window.visualViewport?.addEventListener('resize', syncViewportHeight);
window.addEventListener('resize', syncViewportHeight);
syncViewportHeight();


// --- floating controls: show on movement, hide when the pointer rests --------

const CHROME_IDLE_MS = 3000; // how long the pointer rests before a popped-out call's bars fade
let idleTimer = 0;
const lastPointer = new WeakMap(); // each document's last pointer position, for whether it rests on a bar
// The canvases that hide their chrome when the pointer rests: the page's own, and the one the conference is wrapped in
// when it is popped out into a window of its own (that window's document, not this page's).
function idleCanvases() {
  const out = [$('canvas')];
  const win = canvas.builtinWindow('conference');
  const theirs = win && win.document.querySelector('.canvas');
  if (theirs) out.push(theirs);
  return out;
}
// `doc`: the document the movement happened in, so a pointer on the page does not bring the popped-out window's chrome
// back (or the other way round); with none given, every canvas wakes.
function wake(doc = null) {
  for (const s of idleCanvases()) if (!doc || s.ownerDocument === doc) s.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    // The settings popover, the reaction tray and the floating toolbar live inside the conference section, so they are in
    // whichever document the conference is in: this page's, or its own window's once popped out. An open popover, or a
    // pointer resting on the toolbar, keeps the chrome up. The chat keeps it up only while the call is on this page: in
    // the conference's own window the chat is not there to need it.
    const win = canvas.builtinWindow('conference');
    const doc = win ? win.document : document;
    const shown = (id) => { const el = doc.getElementById(id); return Boolean(el && !el.hidden); };
    // The pointer on either bar, the keyboard in one, or a menu one of them opened keeps them up too.
    const bars = [...doc.querySelectorAll('.conference-head, .video-bar')];
    const at = lastPointer.get(doc);
    const under = at ? doc.elementFromPoint(at.x, at.y) : null; // where the pointer rests (a faded bar ignored it while it came)
    const inUse = bars.some((b) => b.matches(':hover') || b.contains(under) || b.matches(':has(:focus-visible)') || b.querySelector('[aria-expanded="true"]'));
    const keepOpen = shown('settings') || shown('react-tray') || inUse || Boolean(doc.querySelector('.host-menu')) || (!win && canvas.builtinOpen('chat'));
    if (!keepOpen) for (const s of idleCanvases()) s.classList.add('idle');
    else wake();
  }, CHROME_IDLE_MS);
}
function watchPointer(doc) {
  const here = () => wake(doc);
  // Only a pointer that really moved: Chromium sends a mousemove at the same place when what is under a resting pointer
  // changes (a bar fading out), and taking that for a movement would bring the bars straight back, again and again.
  let last = '';
  doc.addEventListener('mousemove', (event) => {
    const at = `${event.screenX},${event.screenY}`;
    if (at === last) return;
    last = at;
    lastPointer.set(doc, { x: event.clientX, y: event.clientY });
    here();
  });
  doc.documentElement.addEventListener('mouseleave', () => lastPointer.delete(doc)); // out of the window: on no bar
  doc.addEventListener('touchstart', here, { passive: true });
  doc.addEventListener('keydown', here);
  doc.addEventListener('focusin', here);
}
watchPointer(document);

// Click anywhere outside the settings popover (but still on the page) closes
// it, same as any other dropdown -- doesn't fire for the gear or any of the
// per-button carets that open it, or for clicks inside the popover itself
// (a link, a colour picker, ...).
function watchOutsideClick(doc) {
  doc.addEventListener('click', (event) => {
    if ($('settings').hidden) return;
    if (event.target.closest('#settings') || event.target.closest('[data-settings]')) return;
    closeSettings();
  });
}
watchOutsideClick(document);

// --- full screen ---------------------------------------------------------------

// Full screen applies to whichever document actually holds the canvas right
// now -- the main window normally, or the popped-out one once it exists.
// Hardcoding `document` here would fullscreen the wrong (empty) window
// once popped out, since that's a separate top-level browsing context.
function toggleFullscreen(doc = canvasDoc()) {
  if (doc.fullscreenElement) {
    doc.exitFullscreen().catch(() => {});
  } else {
    doc.documentElement.requestFullscreen().catch((err) => setStatus(`full screen: ${err.message}`, true));
  }
}
// Not just the click handler -- covers Esc and any other way the browser
// itself might leave full screen, so the button's icon never gets stuck
// showing the wrong state. Registered on the main document up front, and
// on the popout's own document once it exists (see setUpPopoutWindow).
function syncFullscreenButton() {
  const on = !!document.fullscreenElement || !!canvasDoc().fullscreenElement || !!confEl.ownerDocument.fullscreenElement;
  nav.setActive('fullscreen-toggle', on);
  $('fullscreen-toggle').dataset.tip = on ? 'Exit full screen (F)' : 'Full screen (F)';
}
document.addEventListener('fullscreenchange', syncFullscreenButton);

// --- install as an app / pop out ------------------------------------------------
// The entry itself (and the beforeinstallprompt handling behind it) now
// lives in the shared header's account menu -- see accountMenuItems() in
// brand.js -- so this is just the manual-instructions fallback for
// browsers that never fire that event at all. Guests get no install at all
// (Thomas, 2026-10-01): a guest link, or an account whose role is guest, has
// no hint, no note and no service worker (the worker is only there to make the
// site installable).

const isGuestViewer = () => Boolean(guestToken) || me?.role === 'guest';

// Once the page knows who is looking (an account's /api/me has answered): nothing for a guest.
function offerInstall() {
  const hint = describeInstall();
  $('install-hint').textContent = hint;
  $('install-hint').hidden = !hint;
  if (!isGuestViewer() && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function describeInstall() {
  if (isGuestViewer()) return '';
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return '';
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'Add to your home screen for a full-screen call: Share, then Add to Home Screen.';
  if (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) return 'For a window without browser bars: File, then Add to Dock.';
  if (/Firefox/.test(ua)) return 'Firefox has no install; Chrome, Edge or Safari can open the call in its own window.';
  return 'For a window without browser bars, use Install as an app in your profile menu once your browser offers it.';
}

// A plain popup window: the whole canvas moves into it and comes back when
// closed, same as before. Used to be Chrome's document picture-in-picture,
// which floats over other windows automatically -- but that API caps
// itself to ~80% of the screen's work area with no way for a page to ask
// for more (confirmed against Chromium's own source, not just guessed),
// which was exactly the "can't make it bigger" complaint this replaces.
// A regular popup can be resized to fill the whole screen like any other
// window; the trade-off is it needs `popup` in its window features (and
// even then, some platforms still show a thin title bar of their own) and
// won't stay above other windows the way picture-in-picture did.
function openPopout() {
  try {
    // Open small (or at the last size used) so it fits beside the game;
    // the tiles fit whatever size the window is dragged to. Pointed at a
    // real (empty) page of ours rather than '' -- a blank popup's address
    // strip reads "about:blank", which looks broken; this way it reads our
    // own domain, which at least looks intentional. Either way the strip
    // itself can't be suppressed (see the comment above).
    const size = prefs.popout || { w: 480, h: 300 };
    const width = Math.max(240, Math.min(size.w, screen.availWidth));
    const height = Math.max(120, Math.min(size.h, screen.availHeight));
    pipWindow = window.open('/popout.html', 'app-popout', `popup,width=${width},height=${height}`);
    if (!pipWindow) throw new Error('the browser blocked the popup -- allow popups for this site and try again');
    pipWindow.addEventListener('load', () => setUpPopoutWindow(pipWindow), { once: true });
    nav.setActive('popout', true);
    $('popout').dataset.tip = 'Pop it back in';
  } catch (err) {
    setStatus(`pop out: ${err.message}`, true);
  }
}

// Runs once /popout.html has actually finished loading in the new window --
// moving the canvas in before then would land it in that page's own
// about:blank-era document, which the real navigation throws away.
function setUpPopoutWindow(win) {
  win.document.title = spaceName;
  for (const sheet of document.querySelectorAll('link[rel="stylesheet"]')) {
    win.document.head.appendChild(sheet.cloneNode(true));
  }
  followTheme(win.document); // light or dark, and a changed theme, follow this page's (brand.js)
  win.document.body.className = 'in-space popout';
  // The whole app moves: the header too, so everything works from where you are. Moving a
  // node adopts it into the new document, video and audio and all.
  win.document.body.appendChild(topbarEl);
  win.document.body.appendChild(workEl); // the canvas and the always-on column beside it, as one
  placeSubnav(); // phone or wide by this window's width now: the tab bar, or the chooser's button and list
  canvas.popped(); // the modules open again in this window
  $('away').hidden = false;
  keepPoppedVideosLive();
  watchPointer(win.document);
  watchOutsideClick(win.document);
  win.document.addEventListener('keydown', onKey);
  win.document.addEventListener('keyup', onKeyUp);
  win.addEventListener('keydown', noteKey, true);
  win.document.addEventListener('pointerdown', notePointer, true);
  win.document.addEventListener('focusin', noteFocus, true);
  win.document.addEventListener('visibilitychange', releaseWhenHidden);
  win.addEventListener('blur', releaseTalk);
  win.addEventListener('pagehide', releaseTalk);
  // Full screen while popped out should fullscreen that window, not the
  // (now mostly empty) main one left behind -- see toggleFullscreen().
  win.document.addEventListener('fullscreenchange', syncFullscreenButton);
  // The header's links would navigate this window away from the call. They bring the app back
  // first, then do their thing on the page.
  win.document.addEventListener('click', (event) => {
    const link = event.target.closest('#topbar a[href]');
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute('href');
    closePopout();
    if (link.matches('#spaces-link, #menu-home, .brand-home')) showSpaceList();
    else if (link.matches('[data-overlay-link]')) openOverlay(href);
  });
  win.addEventListener('resize', () => {
    prefs.popout = { w: win.innerWidth, h: win.innerHeight };
    savePrefs();
    applyLayout();
  });
  setTimeout(applyLayout, 50);
  win.addEventListener('pagehide', () => {
    document.body.prepend(topbarEl);
    document.body.appendChild(workEl);
    placeSubnav(); // and by this window's again
    canvas.popped(); // and back in this one
    $('away').hidden = true;
    pipWindow = null;
    dropPoppedWatches();
    nav.setActive('popout', false);
    $('popout').dataset.tip = 'Pop out into its own window';
    wake();
  });
}
function closePopout() {
  if (pipWindow) pipWindow.close();
}

// LiveKit's adaptive stream stops a remote video it thinks nobody sees: when the main page is hidden
// (document.visibilityState, after a few seconds) or the element is out of the main window's view. It allows for
// Chrome's document picture-in-picture, not for this pop-out window, so a pop-out over a minimised or covered main
// window (an installed app's, most often) froze every video on its last picture. While a remote video is in the
// pop-out, a second watch of ours tells LiveKit it is shown in a window of its own (pictureInPicture, as its own
// picture-in-picture does) and how big it is there; popping back in drops it.
const poppedWatches = new Set(); // { track, info }
function keepPoppedVideoLive(track, video) {
  if ((!pipWindow && !canvas.builtinWindow('conference')) || video.ownerDocument === document || typeof track?.observeElementInfo !== 'function' || !track.isAdaptiveStream) return;
  for (const w of poppedWatches) if (w.info.element === video) return;
  const info = {
    element: video,
    visible: true,
    pictureInPicture: true,
    visibilityChangedAt: 0,
    width: () => video.clientWidth,
    height: () => video.clientHeight,
    observe() {
      const Observer = video.ownerDocument.defaultView?.ResizeObserver;
      this.resize = Observer ? new Observer(() => this.handleResize?.()) : null;
      this.resize?.observe(video);
    },
    stopObserving() { this.resize?.disconnect(); },
  };
  poppedWatches.add({ track, info });
  track.observeElementInfo(info);
}
function keepPoppedVideosLive() {
  for (const p of call.remoteParticipants.values()) {
    for (const pub of p.videoTrackPublications.values()) {
      for (const el of pub.track?.attachedElements || []) keepPoppedVideoLive(pub.track, el);
    }
  }
}
function dropPoppedWatches() {
  for (const { track, info } of poppedWatches) track.stopObservingElementInfo(info); // already gone with a detached video: harmless
  poppedWatches.clear();
}

$('bring-back').addEventListener('click', closePopout);

// --- your profile / Manage, without leaving the call -------------------------
// A real navigation would drop the WebRTC connection (it's tied to the page),
// so these load in an iframe instead: the call keeps running underneath,
// untouched. The loaded page (same origin) gets a "Back to [space]" link
// added to its own header -- see wireOverlayBack in brand.js -- rather than
// this page stacking a second bar of its own on top of it. Everyone else at
// the call sees your own tile marked "Away" while you're in there; you
// don't, since you already know.
// What a page over the call (and a composite's page on the canvas: canvas.js, frameParams) is handed: the space's name for its Back, and the
// environment's name and logo, already known here, so the overlay's own header renders right on its very first
// paint instead of flashing the generic default. See the matching read in renderTopbar() (brand.js).
function overlayParams() {
  const params = new URLSearchParams({ from: 'space', spaceName });
  const environmentName = document.querySelector('[data-brand="environmentName"]')?.textContent;
  if (environmentName) params.set('environmentName', environmentName);
  const homeIconEl = document.querySelector('[data-brand="home-icon"]');
  const homeIcon = homeIconEl?.dataset.iconId;
  if (homeIcon) params.set('homeIcon', homeIcon);
  if (document.querySelector('.topbar .brand-logo img:not([hidden])')) params.set('hasIcon', '1'); // the logo box shows the uploaded logo
  return params;
}
function openOverlay(path) {
  const params = overlayParams();
  // The query goes before any #section (Manage's #modules or #add-space), so the page reads both.
  const [where, section] = String(path).split('#');
  $('page-overlay-frame').src = `${where}${where.includes('?') ? '&' : '?'}${params}${section ? `#${section}` : ''}`;
  $('page-overlay-frame').hidden = false;
  setAway(true);
}
function closeOverlay() {
  $('page-overlay-frame').hidden = true;
  $('page-overlay-frame').src = 'about:blank';
  // Closed onto home over the space, you are still away from the call: Away clears only back on the space's canvas
  // (returnToCanvas, from the breadcrumb or Back to <space>).
  if (!viewingHome) setAway(false);
  refreshNotices(); // the page over the call may have read them (its bell): the counts here follow
}
// Called directly by the (same-origin) iframe's Back: a page over the call closes; a page a link led on to inside a
// composite's frame (the Calendar or Map tab's page, or the composite on the Workspace) goes back to the composite's
// own page. The frame pressed in has the focus here, so it is the one.
window.closeProfileOverlay = () => {
  if (!$('page-overlay-frame').hidden) closeOverlay();
  else backInComposite(document.activeElement);
};
function backInComposite(frame) {
  if (!frame || !frame.matches?.('iframe[data-composite]')) return; // the mark a move between modes keeps
  const own = frame.getAttribute('src');
  if (own) frame.src = own;
}
// The account menu's View profile (brand.js): over the page, not a navigation, from the popped-out window too.
document.addEventListener('app:open-profile', (event) => {
  event.preventDefault();
  closePopout();
  openOverlay('/profile');
});
// The top bar's Manage, "+ New <space>" and the bell's updates line (brand.js): over the page, as the profile is. The
// host console, another site, opens in a new tab so the call keeps running. A module page (a tile's heading or a
// module link on home, dashboard.js) opens over the space while present in one, home over the space included; present
// nowhere it is left unhandled, and the asker navigates (pageOpens, primary-nav.js).
document.addEventListener('app:open-page', (event) => {
  const { href, kind } = event.detail || {};
  if (!href) return;
  const how = pageOpens({ kind, present: Boolean(currentSpace) });
  if (how === 'page') return;
  event.preventDefault();
  closePopout();
  if (how === 'new-tab') {
    window.open(href, '_blank', 'noopener');
    return;
  }
  openOverlay(href);
});
// A pick in the top bar's space switcher (from this page, or from a page opened over it): back to the space this page
// is in, or into another, as its entry on home does (decision 15; the visit view comes in a later step).
document.addEventListener('app:enter-space', (event) => {
  const { id, action } = event.detail || {};
  if (!id || guestMode) return;
  event.preventDefault();
  if (!$('page-overlay-frame').hidden) closeOverlay();
  const connected = entered && currentSpace;
  // The switcher's last entry, Leave (plan-one-bar.md, step 5): what the space bar's Leave button does (on a phone it
  // is still there, in the tab bar). Present nowhere, there is nothing to leave.
  if (action === 'leave') {
    if (connected) leaveSpace();
    return;
  }
  // In an aside, the parent is marked "You are here": picking it does what Rejoin call does (and the breadcrumb's parent
  // segment), bringing everyone back, never leaving the others behind in the aside.
  if (connected && currentSpace.isAside && currentSpace.origin === id) returnFromAside();
  else if (action === 'back' && connected && currentSpace.id === id) returnToCanvas();
  else if (action === 'setup') openSetupFor(id, event.detail.tab || '');
  else joinInvitedSpace(id);
});

// Also called directly by the profile page overlay, right after it saves a
// background/call-prefs change -- otherwise the call keeps running with
// whatever was in effect at connect time, and the only way to pick up a
// change made this way used to be toggling the camera off and back on.
// `patch` is whatever fields actually changed (e.g. {background: 'blur'},
// {mirror: true}, {quality: 720}); a bare call with no patch just means
// "the background image itself changed, nothing in prefs did".
window.appApplyCallPrefs = async function (patch) {
  if (patch) {
    Object.assign(prefs, patch);
    savePrefs();
  }
  if (!patch || 'mirror' in patch) applyMirror();
  if (!patch || 'masterVolume' in patch) applyMasterVolume();
  if (!patch || 'gain' in patch || 'gate' in patch) applyMicSettings();
  if ((!patch || 'noise' in patch || 'echo' in patch || 'agc' in patch || 'micId' in patch) && mic.ctx) {
    await openMic().catch(() => {});
  }
  if (!patch || 'quality' in patch || 'camId' in patch) await restartCamera();
  // A plain image re-upload (no mode change) still needs this: applyBackground()
  // re-fetches the picture itself fresh every time, cache-bust and all.
  if (!patch || 'background' in patch || prefs.background === 'image') await applyBackground();
};
// Delegated (not one-time-queried) since a space card's own Edit link is
// built later, once presenceSpaces comes back -- a static query here would
// miss it and open it as a real navigation instead, with no way back.
document.addEventListener('click', (event) => {
  const link = event.target.closest('[data-overlay-link]');
  if (!link) return;
  event.preventDefault();
  openOverlay(link.getAttribute('href'));
});

// --- the space list, without leaving the call ---------------------------------
// "All spaces" (the server name/icon, and its twin in the nav) would otherwise
// be a real navigation to '/' -- same page, but a fresh load drops the
// WebRTC connection entirely. The space list already lives right here on this
// page (#join), so there's nothing to load: just swap views, the same "away"
// treatment openOverlay() gives profile/admin, and stay connected underneath.
function showSpaceList() {
  if (doorGuest) { location.href = '/guest#home'; return; } // a guest's Home is their list of spaces
  if (!document.body.classList.contains('in-space')) return;
  setAway(true);
  viewingHome = true;
  updateCrumb();
  document.body.classList.remove('in-space');
  $('canvas').hidden = true;
  canvas.showFloating(false); // a floating module lives beside the canvas, not inside it
  if (guestToken) {
    $('guest-join').hidden = false;
  } else {
    $('join').hidden = false;
    syncHomeChat(); // Home's chat in its column, the space's kept aside until Back (plan-home-lobby.md, step 4)
    loadPresence();
  }
}
// The reverse: a space card recognizes the space it's still connected to (see
// renderSpaces()) and offers "Rejoin" instead of "Join" -- no network round
// trip needed, just the same view swap back.
function returnToCanvas() {
  if (!entered) return;
  $('join').hidden = true;
  $('guest-join').hidden = true;
  $('canvas').hidden = false;
  canvas.showFloating(true); // a floating module lives beside the canvas, shown again with it
  document.body.classList.add('in-space');
  viewingHome = false;
  syncHomeChat(); // the space's chat back in its column, Home's put away (plan-home-lobby.md, step 4)
  updateCrumb();
  setAway(false);
}
// Spaces, the logo or the phone menu's home: home over the space while present in one, never a real navigation (that
// would drop the call), also when home already shows; present nowhere, a real navigation is fine.
function goHome(event) {
  if (guestMode || !currentSpace) return false;
  if (!document.body.classList.contains('in-space') && !viewingHome) return false;
  event.preventDefault();
  if (document.body.classList.contains('in-space')) showSpaceList(); // first, so closing a page over it keeps Away
  if (!$('page-overlay-frame').hidden) closeOverlay();
  return true;
}
// --- Home's chat column (plan-home-lobby.md, step 3) -----------------------------------------------------------------
// While Home shows with no space entered (signed in, never a guest, allowed to read chat), the one #chat moves into
// Home's left column (#home-chat-slot), pointed at Home's chat: the hidden Lobby record's (`lobby`, decision 6) history,
// sends through the same routes, Discussion and Assistant, and what others say live from the live stream (GET
// /api/live: the Lobby's chat rides every page's stream). Entering a space takes it back to the canvas, which places it
// in the space's column as before. Home over a space (present in one, decision 7, step 4) moves the same #chat into
// Home's column too, the space's messages kept aside (homeChatStash) and given back, with what its stream said
// meanwhile, on Back to <space>; Home's unread count shows on the Home link while Home is out of sight.
const HOME_CHAT = 'lobby';
// The Lobby is Home now (plan-home-lobby.md, step 2; decision 6 keeps its record as Home's hidden backing): no card,
// no switcher entry, no Set up, never entered by a signed-in person. Old ways in (/#join=lobby, a reload that remembers
// it, an aside that falls back to it, an invitation to it) land on Home instead. A guest link made for it still enters
// it as before (joinAsGuest), and everything that reads the record (OBS, tokens, Stream, Manage) is unchanged.
function isHomeRecord(id) {
  return !guestMode && id === LOBBY;
}
function landOnHome() {
  if (rememberedSpace() === LOBBY) forgetSpace();
  if (currentSpace && document.body.classList.contains('in-space')) {
    showSpaceList(); // present in a space: Home over it, the call kept
    return;
  }
  setStatus('', false);
  $('join').hidden = false;
  syncHomeChat();
}
let homeChatEntering = false; // join() under way: the chat is the space's from its first moment
// Which Home's chat is wanted now: 'home' while Home shows with no space entered (as step 3 built it), 'over' while
// Home shows over a space this page is still present in (Home over a space, decision 7: the space's call goes on
// underneath, Away set by showSpaceList), '' otherwise. Never for a guest. Not over an aside (it has no chat), and not
// while the space's chat is in its own window (another document: it can't be moved into Home's column).
function homeChatWanted() {
  const allowed = Boolean($('home-chat')) && !guestToken && Boolean(me?.key) && me.role !== 'guest' && !homeChatEntering && !$('join').hidden;
  if (!allowed) return '';
  if (!currentSpace && !entered && !document.body.classList.contains('in-space')
    && canDo('chatRead') && !canvas.builtinOpen('chat')) return 'home';
  if (currentSpace && viewingHome && entered && !inAside() && !pipWindow
    && !document.body.classList.contains('in-space') && canDo('chatRead') && !canvas.builtinWindow('chat')) return 'over';
  return '';
}
function syncHomeChat() {
  syncHomeChatStream();
  const want = homeChatWanted();
  const now = homeChatSpace ? (homeChatStash ? 'over' : 'home') : '';
  if (want === now) {
    if (want) showHomeChat(want);
    return;
  }
  hideHomeChat();
  if (want) showHomeChat(want);
}
// Home over a space: what the space's chat had (its messages as drawn, pictures included, its log, its unread number,
// where #chat sat), kept while Home's chat shows, given back by hideHomeChat. `parked`: what the live stream said of the space's
// chat meanwhile (parkSpaceChat), read in order once the space's chat is back. Null with no space under Home's chat.
let homeChatStash = null;
const PARKED_MAX = 500;
function parkSpaceChat(run) {
  if (!homeChatStash) return false;
  if (homeChatStash.parked.length < PARKED_MAX) homeChatStash.parked.push(run);
  return true;
}
function showHomeChat(mode = 'home') {
  $('home-chat').hidden = false;
  applyHomeChatWidth();
  if (homeChatSpace) return;
  const chat = $('chat');
  if (mode === 'over') {
    homeChatStash = {
      parent: chat.parentNode, next: chat.nextSibling, hidden: chat.hidden, pic: $('chat-pic').hidden,
      nodes: [...$('messages').childNodes], log: chatLog.splice(0), unread, keeper: chatLinkKeeper, parked: [],
    };
    $('messages').replaceChildren(); // the space's messages wait in the stash, as they were drawn
    unread = 0; // the space's number waits in the stash too; Chat's mark in the space keeps it meanwhile
  }
  homeChatSpace = presenceSpaces.find((r) => r.isLobby) || { id: HOME_CHAT, name: '', isLobby: true, members: [] };
  homeChatChanged();
  if (!homeChatStash) dropSharedChat();
  $('messages').textContent = '';
  $('home-chat-slot').appendChild(chat);
  chat.hidden = false;
  $('chat-pic').hidden = true; // pictures are a space's, never Home's
  renderChatHistory(HOME_CHAT);
  chatInput.loadThread();
  loadLinkKeeper(HOME_CHAT);
  setHomeUnread(0); // Home is in sight: its chat is read
}
function hideHomeChat() {
  const column = $('home-chat');
  if (column) column.hidden = true;
  if (!homeChatSpace) return;
  // Read up to its newest message (the server's clock, as a catch-up's times are), else up to now.
  const times = chatLog.map((e) => (e.at instanceof Date ? e.at.getTime() : 0)).filter((t) => t > 0);
  homeSeenAt = times.length ? Math.max(...times) : Date.now();
  homeChatSpace = null;
  homeChatChanged();
  const stash = homeChatStash;
  homeChatStash = null;
  const chat = $('chat');
  if (stash) {
    // Back to the space (Back to <space>, the switcher, leaving): its chat as it was, where it was, then what the live
    // stream said of it meanwhile. The call never dropped (decision 7).
    chatLog.length = 0;
    $('messages').replaceChildren(...stash.nodes);
    chatLog.push(...stash.log);
    unread = stash.unread;
    canvas.setBuiltinUnread('chat', unread);
    if (stash.parent?.isConnected) stash.parent.insertBefore(chat, stash.next?.parentNode === stash.parent ? stash.next : null);
    else $('canvas').appendChild(chat);
    chat.hidden = stash.parent?.isConnected ? stash.hidden : true;
    chatLinkKeeper = stash.keeper;
    chatInput.loadThread();
    applyPermissions(); // the picture button as the permissions say
    for (const run of stash.parked) run();
    $('messages').scrollTop = $('messages').scrollHeight;
    return;
  }
  dropSharedChat();
  $('messages').textContent = '';
  if (!canvas.builtinOpen('chat')) {
    $('canvas').appendChild(chat); // where a closed chat waits (canvas.js closeBuiltin)
    chat.hidden = true;
  }
  chatLinkKeeper = null;
  chatInput.loadThread();
  applyPermissions(); // the picture button as the permissions say
}
// Home's chat (the Lobby's) comes on the live stream (openLive): in a space its stream carries it too; on Home, signed in
// and allowed to read the chat, the page holds one in no space. Drawn into Home's chat while it shows, else counted for
// the Home link (decision 8).
function homeStreamWanted() {
  return !guestToken && Boolean(me?.key) && me.role !== 'guest' && (hasOwnerRights(me) || Boolean(me.permissions?.chatRead));
}
function syncHomeChatStream() {
  if (liveSpaceId) return; // in a space or an aside: its live stream carries Home's chat too
  if (homeStreamWanted()) {
    if (!liveStream) openLive(null);
  } else {
    closeLive();
    if (homeUnreadIds.size) setHomeUnread(0);
  }
}
// A chat event from the live stream (space-live.js), each with its `space`: the chat of the space this page is in (a
// guest's in the Lobby too), else Home's (the Lobby's, never a guest's).
function liveChatNotice(data) {
  if (!data || typeof data.type !== 'string') return;
  if (liveSpaceId && data.space === liveSpaceId && currentSpace?.id === liveSpaceId) {
    // The space's chat, heard while Home's chat shows over the space (plan-home-lobby.md, step 4): kept, and read in
    // order once the space's chat is back (hideHomeChat), so nothing said in the space lands in Home's chat.
    if (parkSpaceChat(() => applyChatNotice(data))) return;
    applyChatNotice(data);
  } else if (data.space === HOME_CHAT && !guestMode) homeChatNotice(data);
}
// What the live stream says of the chat in sight, the server's word. A message or a picture already drawn (my own, from
// the answer to my own request) is not drawn again; one of mine from another tab is drawn as mine.
function applyChatNotice(data) {
  if ((data.type === 'chat' || data.type === 'chat-picture') && chatIdOk(data.id)) {
    if (!canDo('chatRead') || chatMessageNode(data.id)) return;
    const entry = data.type === 'chat' ? storedEntry(data) : pictureEntry(data);
    if (entry) addEntry(entry, Boolean(me?.key && !guestMode && entry.by === me.key));
  } else if (data.type === 'chat-delete' && chatIdOk(data.id)) applyDeleteNotice(data);
  else if (data.type === 'chat-visibility') applyVisibilityNotice(data);
  else if (data.type === 'chat-clear-some') applyClearNotice(data);
  else if ((data.type === 'chat-preview' || data.type === 'chat-kept') && chatIdOk(data.id)) applyLinkNotice(data);
  else if (data.type === 'chat-clear') dropSharedChat();
}
// Home's chat: drawn while it shows, else a new public message from someone else counts on the Home link.
function homeChatNotice(data) {
  if (!homeChatSpace) {
    countHomeNotice(data);
    return;
  }
  applyChatNotice(data);
}
// Back after the live stream dropped (the server restarted, the network went): the history again, for Home's chat and
// for the space's chat in sight.
async function catchUpLiveChat() {
  if (!guestMode) catchUpHomeChat();
  const id = liveSpaceId;
  if (!id || inAside() || homeChatSpace || !canDo('chatRead')) return;
  let got = null;
  try {
    got = await fetchChatHistory(id);
  } catch {
    return; // the next reconnect tries again
  }
  if (liveSpaceId !== id || homeChatSpace) return;
  mergeChatHistory(got.messages.filter((e) => new Date(e.at).getTime() > got.clearedAt));
}
// --- Home's unread count on the Home link (plan-home-lobby.md, decision 8, step 4) ---
// The ids counted, so a delete, a clear or a message made private takes them off again, and a catch-up never counts one
// twice. `homeSeenAt`: the time Home's chat was last in sight; a catch-up counts only what came after it.
const homeUnreadIds = new Set();
let homeSeenAt = Date.now();
function countHomeNotice(data) {
  const before = homeUnreadIds.size;
  if (data.type === 'chat' && chatIdOk(data.id)) {
    if (data.by !== me?.key && data.visibility !== 'private') homeUnreadIds.add(data.id);
  } else if (data.type === 'chat-visibility' && chatIdOk(data.id)) {
    if (data.visibility === 'private') homeUnreadIds.delete(data.id);
    else if (data.message && data.message.by !== me?.key) homeUnreadIds.add(data.id);
  } else if (data.type === 'chat-delete') homeUnreadIds.delete(data.id);
  else if (data.type === 'chat-clear-some' && Array.isArray(data.ids)) for (const id of data.ids) homeUnreadIds.delete(id);
  else if (data.type === 'chat-clear') homeUnreadIds.clear();
  if (homeUnreadIds.size !== before) paintHomeUnread();
}
function setHomeUnread(n) {
  if (!n) homeUnreadIds.clear();
  paintHomeUnread();
}
// The count on the Home link: the logo (the Home link at every width, in a space too) and the phone menu's Home entry.
// Theme tokens only (style.css, .home-unread); the number is read out with the link.
function paintHomeUnread() {
  const n = homeUnreadIds.size;
  nav.setBadge('menu-home', n);
  const logo = topbarEl?.querySelector('#brand-home-link .brand-logo');
  if (!logo) return;
  let badge = logo.querySelector('.home-unread');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'home-unread';
    badge.id = 'home-unread';
    badge.innerHTML = '<span class="home-unread-count" aria-hidden="true"></span><span class="visually-hidden"></span>';
    logo.appendChild(badge);
  }
  badge.hidden = !n;
  badge.querySelector('.home-unread-count').textContent = n > 9 ? '9+' : String(n);
  badge.querySelector('.visually-hidden').textContent = n ? `, ${n} new ${n === 1 ? 'message' : 'messages'}` : '';
}
// Back after the stream dropped (the server restarted, the network went): the history again. Home's chat in sight gets
// what it missed drawn and what was deleted meanwhile taken off; out of sight, what came after it was last seen counts.
async function catchUpHomeChat() {
  let got = null;
  try {
    got = await fetchChatHistory(HOME_CHAT);
  } catch {
    return; // the next reconnect tries again
  }
  const history = got.messages.filter((e) => new Date(e.at).getTime() > got.clearedAt);
  if (homeChatSpace) {
    mergeChatHistory(history);
    return;
  }
  for (const e of history) {
    if (chatIdOk(e.id) && e.visibility !== 'private' && e.by !== me?.key && e.at.getTime() > homeSeenAt) homeUnreadIds.add(e.id);
  }
  paintHomeUnread();
}
// The history read again into the chat in sight: what it missed drawn, what was deleted meanwhile taken off.
function mergeChatHistory(history) {
  const have = new Set(history.map((e) => e.id));
  const oldest = history.length ? Math.min(...history.map((e) => e.at.getTime())) : Infinity;
  const gone = chatLog.filter((e) => e.stored && chatIdOk(e.id) && !have.has(e.id) && e.at.getTime() >= oldest);
  if (gone.length) dropChatEntries(gone);
  for (const entry of history) {
    if (!chatIdOk(entry.id) || chatMessageNode(entry.id)) continue;
    addEntry(entry, ownEntry(entry));
  }
}
// The column's width: dragged on its inner edge (#home-chat-splitter), or with the keyboard as the space column's edge
// (splitterKey); between COLUMN_MIN and the whole window, remembered in this browser (prefs.homeChatWidth). What is left
// beside it decides the rest (style.css): under HOME_SPARE_BESIDE the Modules go under the space cards (as below
// 1200px), under HOME_SPARE_LEAST the chat is all there is, its edge inside the window to drag back.
const HOME_SPARE_BESIDE = 840; // the spaces (520) and the Modules (320) side by side
const HOME_SPARE_LEAST = 200;
function applyHomeChatWidth() {
  const home = $('home');
  const handle = $('home-chat-splitter');
  if (!home || !handle) return;
  const w = clampColumnWidth(prefs.homeChatWidth, window.innerWidth);
  home.style.setProperty('--home-chat-w', `${w}px`);
  const spare = window.innerWidth - w;
  home.classList.toggle('chat-wide', spare < HOME_SPARE_BESIDE);
  home.classList.toggle('chat-full', spare < HOME_SPARE_LEAST);
  handle.setAttribute('aria-valuemin', String(COLUMN_MIN));
  handle.setAttribute('aria-valuemax', String(Math.max(COLUMN_MIN, Math.round(window.innerWidth * COLUMN_MAX_SHARE))));
  handle.setAttribute('aria-valuenow', String(w));
  handle.setAttribute('aria-valuetext', `${w} pixels wide`);
}
function setHomeChatWidth(value, { remember = true } = {}) {
  prefs.homeChatWidth = clampColumnWidth(value, window.innerWidth);
  if (remember) savePrefs();
  applyHomeChatWidth();
}
function wireHomeChatSplitter(el) {
  if (!el) return;
  let drag = null;
  const now = () => clampColumnWidth(prefs.homeChatWidth, window.innerWidth);
  el.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    drag = { at: event.clientX, from: now() };
    el.classList.add('dragging');
    $('home')?.classList.add('resizing-column');
    el.setPointerCapture?.(event.pointerId);
  });
  el.addEventListener('pointermove', (event) => {
    if (drag) setHomeChatWidth(drag.from + event.clientX - drag.at, { remember: false });
  });
  const stop = () => {
    if (!drag) return;
    drag = null;
    el.classList.remove('dragging');
    $('home')?.classList.remove('resizing-column');
    savePrefs();
  };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('dblclick', () => setHomeChatWidth(DEFAULT_PREFS.homeChatWidth));
  el.addEventListener('keydown', (event) => {
    const max = Math.round(window.innerWidth * COLUMN_MAX_SHARE);
    const next = splitterKey({ key: event.key, shift: event.shiftKey }, now(), { min: COLUMN_MIN, max, def: DEFAULT_PREFS.homeChatWidth, grow: 'ArrowRight', shrink: 'ArrowLeft' });
    if (next === null) return; // Tab, Escape and the rest go on
    event.preventDefault();
    setHomeChatWidth(next);
  });
}
wireHomeChatSplitter($('home-chat-splitter'));
window.addEventListener('resize', applyHomeChatWidth);
// --- end Home's chat column ---

const HOME_LINKS = '#spaces-link, #menu-home, .brand-home';
document.addEventListener('click', (event) => {
  if (event.target.closest(HOME_LINKS)) goHome(event);
});
// The same links in the header of a page opened over the call (they target the top window): home in this page. A page
// in a composite's frame gets the same (canvas.js, onCompositeLoad): a link inside the Calendar or Map that leads on to
// a page with a header, whose home would otherwise navigate the top window away from the call.
function homeLinksIn(frame) {
  let doc = null;
  try {
    doc = frame.contentDocument;
  } catch {
    return; // not our own page
  }
  doc?.addEventListener('click', (event) => {
    if (event.target.closest?.(HOME_LINKS)) goHome(event);
  });
}
$('page-overlay-frame').addEventListener('load', () => {
  let doc = null;
  try {
    doc = $('page-overlay-frame').contentDocument;
  } catch {
    return; // not our own page
  }
  doc?.addEventListener('click', (event) => {
    if (event.target.closest?.(HOME_LINKS)) goHome(event);
  });
});

// `message` is the optional away message; without one the tile just says Away.
function updateAwayOverlay(identity, on, message) {
  const tile = tiles.get(identity);
  if (!tile) return;
  tile.classList.toggle('tile-away', on);
  let overlay = tile.querySelector('.tile-away-overlay');
  if (on && !overlay) {
    overlay = document.createElement('div');
    overlay.className = 'tile-away-overlay';
    tile.appendChild(overlay);
  } else if (!on && overlay) {
    overlay.remove();
    return;
  }
  if (overlay) {
    const custom = typeof message === 'string' ? message.trim().slice(0, 200) : '';
    // Icon and AWAY on top; the message, if any, under them.
    overlay.textContent = '';
    const bubble = document.createElement('div');
    bubble.className = 'away-bubble';
    const head = document.createElement('div');
    head.className = 'away-head';
    const moon = document.createElement('i');
    moon.className = 'fa-solid fa-moon fa-fw'; // the same moon as the away button
    moon.setAttribute('aria-hidden', 'true');
    head.append(moon, ' Away');
    bubble.appendChild(head);
    if (custom) {
      const msg = document.createElement('div');
      msg.className = 'away-msg';
      msg.textContent = custom;
      bubble.appendChild(msg);
    }
    overlay.appendChild(bubble);
    overlay.classList.add('custom');
  }
}

// Someone's away mark on their tile, from the live stream (their key there is their identity on the call, a guest's
// too); mine from my own state, since the stream says it only once the server has it. Someone the stream does not
// have (yet) is not marked.
function showAway(participant) {
  if (participant.isLocal) return updateAwayOverlay(participant.identity, isAway, awayMessage);
  const said = livePerson(participant.identity);
  updateAwayOverlay(participant.identity, Boolean(said?.away), said?.away ? said.awayMessage : '');
}
// A camera that came on during a wait after going away (a click just before, Back and away again) goes off again, and
// comes back with Back.
async function keepCameraOffWhileAway() {
  if (!isAway || !call.localParticipant.isCameraEnabled) return;
  awayRestoreCam = true;
  await call.localParticipant.setCameraEnabled(false).catch(() => {});
}
// The same for the microphone: Back, then away again before the microphone was on.
async function keepMicOffWhileAway() {
  if (!isAway || !call.localParticipant.isMicrophoneEnabled) return;
  awayRestoreMic = true;
  await call.localParticipant.setMicrophoneEnabled(false).catch(() => {});
}

// Away as everyone reads it: said on the live stream (PATCH /api/spaces/:id/presence), so someone who joins, reloads or
// reconnects later sees it too.
async function sendAway(on) {
  updateAwayOverlay(me?.key, on, on ? awayMessage : '');
  sayPresence({ away: on, awayMessage: on ? awayMessage : '' });
}

// Away means away: nobody should be hearing or seeing you while your tile
// says so. Set from two places -- opening your profile/Manage over the call
// (openOverlay/closeOverlay above), and the away-toggle button for marking
// yourself away on purpose. Whichever mic/camera were actually on get
// remembered and only those come back when away turns back off, so someone
// whose camera was already off before stepping away doesn't have it turned
// on for them. Away also stops you hearing everyone else (hearingOff), and while away
// nothing opens the microphone: not push to talk, not the mic button or its keys (toggleMic),
// not a join (startCall). The state itself is declared near inCall, at the top.
async function setAway(on, message = '') {
  if (on === isAway) return;
  isAway = on;
  applyHearing(); // straight away, before the waits for the microphone and camera
  awayMessage = on ? String(message || '').trim().slice(0, 200) : '';
  if (on) {
    awayRestoreMic = !!call.localParticipant.isMicrophoneEnabled;
    awayRestoreCam = !!call.localParticipant.isCameraEnabled;
    if (awayRestoreMic) await call.localParticipant.setMicrophoneEnabled(false).catch(() => {});
    if (awayRestoreCam) await call.localParticipant.setCameraEnabled(false).catch(() => {});
  } else {
    if (awayRestoreMic) await call.localParticipant.setMicrophoneEnabled(true).catch(() => {});
    await keepMicOffWhileAway();
    if (awayRestoreCam) await setCameraEnabledWithRetry(true).catch(() => {});
    // A camera change made while away (restartCamera), now that the camera is back on. A camera left off is not
    // opened just to take it: the change waits for the camera to be turned on (toggleCam).
    if (!isAway && awayRestartCam && call.localParticipant.isCameraEnabled) {
      awayRestartCam = false;
      await restartCamera();
    }
    await keepCameraOffWhileAway();
  }
  reflectMic();
  const camOn = call.localParticipant.isCameraEnabled;
  $('cam').classList.toggle('on', camOn);
  $('cam').classList.toggle('off', !camOn);
  updateCamera(call.localParticipant);
  $('away-toggle').classList.toggle('off', on);
  $('away-toggle').dataset.tip = on ? 'Back: unpause your mic, camera and sound, and let everyone know' : 'Away: pauses your mic and camera, mutes what you hear, and lets everyone know';
  await sendAway(on);
}

// The away button asks for an optional message first; coming back is one click.
// Away set by opening your profile or the space list stays a plain "Away".
function closeAwayPrompt() {
  $('away-overlay').hidden = true;
}
$('away-toggle').addEventListener('click', () => {
  if (isAway) return setAway(false);
  $('away-message').value = '';
  $('away-overlay').hidden = false;
  $('away-message').focus();
});
$('away-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const message = $('away-message').value.trim();
  closeAwayPrompt();
  setAway(true, message);
});
$('away-cancel').addEventListener('click', closeAwayPrompt);
$('away-overlay').addEventListener('click', (event) => {
  if (event.target === $('away-overlay')) closeAwayPrompt();
});
$('away-message').addEventListener('keydown', (event) => {
  event.stopPropagation(); // typing here isn't a hotkey (M, V, C ...)
  if (event.key === 'Escape') closeAwayPrompt();
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) $('away-form').requestSubmit();
});

// --- start --------------------------------------------------------------------

// The mic/camera processing fields (not device selection -- that's kept
// local, per machine) also live on the account, set from the profile page
// or here; this reflects prefs into the settings-popover controls, called
// once from local defaults at startup and again once the account's own
// values come back from /api/me.
function populateCallSettingsUI() {
  $('gain').value = String(prefs.gain);
  $('gate').value = String(prefs.gate);
  $('gain-value').textContent = `${prefs.gain}%`;
  $('gate-value').textContent = prefs.gate ? `${prefs.gate}` : 'off';
  $('noise').checked = prefs.noise;
  $('echo').checked = prefs.echo;
  $('agc').checked = prefs.agc;
  $('talk-mode').value = prefs.ptt ? 'ptt' : 'open';
  $('quality').value = String(prefs.quality);
  $('mirror').checked = prefs.mirror;
  $('background-mode').value = prefs.background;
  $('master-volume').value = String(prefs.masterVolume);
  $('volume-value').textContent = `${prefs.masterVolume}%`;
  $('mic').classList.toggle('ptt', prefs.ptt);
}

// Manage > Settings' call-feature toggles: hides what's turned off and
// caps the quality picker at whatever the admin set as the ceiling. Run
// once branding is in hand (init()), since these come from the server.
function applyFeatureFlags() {
  $('screen-share').hidden = !(features.allowScreenShare && canDo('shareScreen') && navigator.mediaDevices?.getDisplayMedia);
  $('react-toggle').hidden = !(features.allowReactions && canDo('react'));
  const select = $('quality');
  for (const opt of select.options) opt.hidden = Number(opt.value) > features.maxQuality;
  if (prefs.quality > features.maxQuality) {
    prefs.quality = features.maxQuality;
    savePrefs();
  }
  select.value = String(prefs.quality);
}

async function init() {
  const branding = await loadBranding();
  registerWordTools();
  spaceName = branding.environmentName || spaceName;
  features = {
    maxQuality: branding.maxQuality || 720,
    allowScreenShare: branding.allowScreenShare !== false,
    allowAsides: branding.allowAsides !== false,
    allowPrivate: branding.allowPrivate !== false,
    allowReactions: branding.allowReactions !== false,
    callService: branding.callService !== false, // the server has LiveKit; with none, no call, Conference or asides at all
    conferenceEnabled: branding.conferenceEnabled !== false,
    autoJoinCall: branding.autoJoinCall === true, // entering a space joins the call (GitHub #199); off unless the owner turned it on
  };
  applyFeatureFlags();
  // The template's phases (plan-one-bar.md, step 3) come with the branding; none, no status strip.
  templatePhases = phaseRule() ? phaseRule().cleanPhases(branding.phases) : [];
  // A phase's icon, when the template gives one (a Font Awesome Free solid name); none, no icon in its band.
  phaseIcons = Object.fromEntries((Array.isArray(branding.phases) ? branding.phases : []).filter((p) => p && typeof p.id === 'string' && typeof p.icon === 'string' && /^[a-z0-9-]+$/.test(p.icon)).map((p) => [p.id, p.icon]));
  // The topbar dropped its own version readout -- too cramped alongside
  // everything else there. It's in the title bar instead, which reads as
  // the space's real native window title once installed as an app.
  if (branding.version) document.title += ` — ${branding.version}`;
  renderReactionTray(branding.reactions);
  updateCrumb();
  syncLayoutPick();
  populateCallSettingsUI();
  applyLayout();

  if (doorGuest) {
    // A guest from the door: no account and no name to ask, they typed it at the door. In at once, on the one space
    // the landing linked to; the permissions are the guest role's, as the door answered.
    $('join').hidden = true;
    $('guest-section').hidden = true;
    guestSpaceName = doorGuest.space.name;
    me = { key: doorGuest.guest.id, displayName: doorGuest.guest.name, role: 'guest', permissions: doorGuest.permissions };
    const banner = $('guest-banner');
    $('guest-banner-text').textContent = `You are in as ${me.displayName}.`;
    banner.hidden = false;
    $('guest-banner-leave').addEventListener('click', async () => {
      try { await api('DELETE', '/api/guest-door'); } catch { /* the cookie is cleared by the answer, or already gone */ }
      location.href = '/login';
    });
    await joinAsGuest(doorGuest.space.id, doorGuest.space.name);
    return;
  }
  if (guestToken) {
    // No account: no whoami (and so no Sign out), no Manage, no Guests section (that
    // needs a real session too) -- just the name field and, past that,
    // everything the space itself already handles the same for everyone.
    $('join').hidden = true;
    $('guest-section').hidden = true;
    try {
      const info = await api('GET', `/api/guest-link/${encodeURIComponent(guestToken)}`);
      $('guest-space-name').textContent = `${verb('enter')} ${info.spaceName}`;
      guestSpaceName = info.spaceName; // a guest's anchor: the space's name, before entering too
      updateCrumb();
      $('guest-join').hidden = false;
      await showGuestDocs();
      $('guest-join').dataset.spaceId = info.spaceId;
      $('guest-join').dataset.spaceName = info.spaceName;
    } catch (err) {
      $('guest-space-name').textContent = 'This link is off';
      $('guest-join-error').textContent = err.message;
      $('guest-join-error').hidden = false;
      $('guest-join').hidden = false;
      $('guest-join').querySelector('button[type="submit"]').hidden = true;
      $('guest-name').hidden = true;
    }
    return;
  }

  try {
    const info = await api('GET', '/api/me');
    me = info.user;
    offerInstall();
    $('whoami').textContent = me.displayName;
    $('whoami-img').src = `/img/${encodeURIComponent(me.key)}/profile?v=${Date.now()}`;
    $('whoami-img').hidden = false;
    // The account's own mic/camera processing settings take over from
    // whatever this browser had locally, so joining from anywhere lands
    // already set up the way the account is configured.
    if (me.callPrefs) {
      Object.assign(prefs, me.callPrefs);
      savePrefs();
      // Re-clamp: the account's own stored quality could predate whatever
      // the server's maxQuality cap is set to now.
      applyPermissions();
      populateCallSettingsUI();
    }
    loadPresence(); // the join screen's member grid; it does not hold the page when LiveKit is slow
  } catch (err) {
    location.href = '/login';
    return;
  }
  // Set up by address (plan-setup-panel.md, step 6): "/?setup=<space>#<tab>" enters that space and opens Set up on the
  // tab. The query leaves the address at once (the fragment stays while the panel shows that tab), so a reload or Back
  // does not open it again.
  const setupAsked = setupAddress(location.search, location.hash);
  const invited = /^#join=([a-z0-9]{4,16})$/.exec(location.hash);
  if (setupAsked) {
    const rest = new URLSearchParams(location.search);
    rest.delete('setup');
    history.replaceState(null, '', `${location.pathname}${rest.toString() ? `?${rest}` : ''}`);
    openSetupFor(setupAsked.id, setupAsked.tab);
  } else if (invited) {
    // Following an invitation from another page: "/#join=<space>" goes straight into that space.
    history.replaceState(null, '', location.pathname + location.search);
    joinInvitedSpace(invited[1]);
  } else if (!guestMode && rememberedSpace()) {
    // A reload: back into the space this tab was in. Joining checks it is still there; presence
    // does not have to have answered first.
    join(rememberedSpace());
  }
}
init();
