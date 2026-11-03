import { nav } from '/nav-bar.js';
import { openHostMenu, closeHostMenu } from '/host-menu.js';
import { mountEnvironmentBanner } from '/environment-banner.js';
import '/tooltip.js';
import { topBarTabs } from '/page-tabs.js';
import { word, setWords, setVerbs } from '/words.js';
import { themeSwitch, setEnvironmentMode, setAccountMode, themeChanged, watchThemeWithoutStream, forgetThemeMode, toggleThemeMode, useDefaultMode, themeMode as modeNow } from '/theme-mode.js';
import { profileEntries, profileDestinationLabel, seesUpdates, hostConsoleUrl, switcherEntries, switchPick, bellState, destinationTools, pageAnchor } from '/primary-nav.js';

// The words a person reads for each level and role (public/words.js), for every page that already imports from here.
export { word, words, fill, applyWords, setWords, verb, verbs, setVerbs } from '/words.js';
// Light and dark (GitHub #62): the mode showing now, and a popped-out window following this page's look.
export { themeMode, followTheme } from '/theme-mode.js';

// Escapes text going into innerHTML -- a space's or the environment's name is an owner-set
// string, not something we generated, so it isn't safe to trust verbatim.
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Whether an account has every right in this environment: its owner, or the host admin signed in through their
// stand-in account (role `admin`, `hostAdmin: true`). The server decides the same way; this only picks what to show.
export const hasOwnerRights = (user) => Boolean(user) && ['owner', 'admin'].includes(user.role);
// The admin: the server's own (ADMIN_LOGIN on a single-environment install), or the host admin's stand-in (`hostAdmin`).
// Every right, but not an owner, and its role and sign-in are the server's or the host console's, not Manage's.
export const isAdminAccount = (user) => Boolean(user) && ['admin'].includes(user.role);

// The word a person reads for an account's role. Admin is not a role anyone is given: the server's admin reads
// "Admin", and the host admin's stand-in inside an environment reads "Host admin". Each is this environment's word.
export function roleLabel(user) {
  if (!user) return '';
  if (user.hostAdmin) return `${word('host', { cap: true })} ${word('admin')}`;
  return ['owner', 'member', 'guest', 'admin'].includes(user.role) ? word(user.role, { cap: true }) : String(user.role || '');
}

// The admin's Font Awesome list (Theme tab), as last loaded by loadBranding().
let ICONS = [];
export const getIcons = () => ICONS;
// Full class list for an icon id -- space link icons and the home icon are
// stored as ids into that list. Before the list has loaded, or for an id no
// longer in it, fall back rather than draw nothing.
export function iconClasses(id) {
  const found = ICONS.find((i) => i.id === id);
  if (found) return found.classes;
  return ICONS.length ? 'fa-solid fa-link' : `fa-solid fa-${id || 'link'}`;
}

// What a page keeps in the browser was keyed by the product's old name once; it is keyed by
// "app" now (the host is not the brand, see plans/plan-modules.md). Old keys are moved the first time any page loads, so
// nobody's layout, chat history or remembered choices are lost. A key moves only when its new name is still empty, and
// the old one is deleted either way.
function moveStoredKey(storage, from, to) {
  const old = storage.getItem(from);
  if (old === null) return;
  if (storage.getItem(to) === null) storage.setItem(to, old);
  storage.removeItem(from);
}
function migrateStoredKeys() {
  try {
    for (const key of Object.keys(localStorage)) {
      const m = /^tavern([.:])(.*)$/.exec(key); // the old product name, read only to move the key
      if (m) moveStoredKey(localStorage, key, `app${m[1]}${m[2]}`);
    }
    // Keys renamed by the Names plan, read only to move them: the call's preferences (step 3), and each space's
    // remembered canvas (step 5b; `app.panels` alone is the layout from before layouts were kept per space). The chat
    // keys (app:chat:<id>:..., app:chatclear:<id>:...) keep their names: a space's id did not change.
    const moves = { 'host.table': 'app.call', 'app.panels': 'app.canvas' };
    for (const [from, to] of Object.entries(moves)) moveStoredKey(localStorage, from, to);
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('app.panels.')) moveStoredKey(localStorage, key, `app.canvas.${key.slice('app.panels.'.length)}`);
    }
  } catch {
    // no storage: nothing to move
  }
  try {
    moveStoredKey(sessionStorage, 'host.room', 'app.space'); // the space this tab was in, rejoined on a reload (step 5b)
  } catch {
    // no storage: nothing to move
  }
}
migrateStoredKeys();

let product = ''; // filled by loadBranding(); no name is written in the page

// The configured product name (PRODUCT_NAME), from /api/branding. Sentences use this, never a hard-coded name; it is ''
// until loadBranding() has answered, so a sentence that uses it reads without it then.
export function productName() {
  return product;
}

// Fills in the environment's name and icon on every page from /api/branding.
export async function loadBranding() {
  let b = { environmentName: 'Coffee Pub', loginText: '', hasIcon: false };
  try {
    const res = await fetch('/api/branding');
    if (res.ok) b = await res.json();
  } catch (err) {
    // keep the defaults
  }
  if (typeof b.productName === 'string' && b.productName.trim()) product = b.productName.trim();
  ICONS = Array.isArray(b.icons) ? b.icons : [];
  setEnvironmentMode(b.themeMode, b.themeVersion); // the default mode, and a stylesheet that changed since this page loaded
  setVerbs(b.verbs); // every data-verb and {enter} on the page, and verb() from here on (addendum 4)
  setWords(b.words); // every data-word and data-fill on the page, and word() from here on
  refreshWords();
  clockHour12 = b.clock !== '24'; // the times in the bell's list (modules read the setting through host.locale())
  qsa('[data-brand="environmentName"]').forEach((el) => (el.textContent = b.environmentName));
  qsa('[data-brand="home-icon"]').forEach((el) => {
    el.className = `${iconClasses(b.homeIcon || 'couch')} fa-fw`;
    el.dataset.iconId = b.homeIcon || 'couch';
  });
  // The logo box: the uploaded logo when there is one, else the home icon (decision 23).
  for (const box of qsa('.topbar .brand-logo')) {
    const img = box.querySelector('img');
    const icon = box.querySelector('i');
    if (img) img.hidden = !b.hasIcon;
    if (icon) icon.hidden = Boolean(b.hasIcon);
  }
  document.querySelectorAll('[data-brand="loginText"]').forEach((el) => (el.textContent = b.loginText));
  document.querySelectorAll('[data-brand="productName"]').forEach((el) => (el.textContent = product));
  document.querySelectorAll('[data-brand="version"]').forEach((el) => (el.textContent = b.version || ''));
  // The page's own title ("Sign in", "Manage", or "<old server name> - Manage" on a second load) gets the server's name in front.
  const parts = document.title.split(' - ');
  const page = parts.length > 1 ? parts.slice(1).join(' - ') : ['Coffee Pub', b.environmentName].includes(document.title.trim()) ? '' : document.title.trim();
  document.title = page ? `${b.environmentName} - ${page}` : b.environmentName;
  let icon = document.querySelector('link[rel="icon"]');
  if (!icon) {
    icon = document.createElement('link');
    icon.rel = 'icon';
    document.head.appendChild(icon);
  }
  icon.href = `/img/site/icon?v=${Date.now()}`;
  document.querySelectorAll('img[data-brand="icon"]').forEach((el) => (el.src = icon.href));
  // A page marked data-brand="background" (the sign-in page) gets the
  // background picture when one is set. It goes on the root element: the
  // root has its own colour, so a picture on the body would stop at the
  // body's box and leave the collapsed margin above the sign-in box bare.
  if (document.querySelector('[data-brand="background"]')) {
    const root = document.documentElement;
    root.classList.toggle('has-background', Boolean(b.hasBackground));
    root.style.backgroundImage = b.hasBackground ? `url("/img/site/background?v=${Date.now()}")` : '';
  }
  return b;
}

// One header, built once here, used by every page including the call page (plan-primary-nav.md, "The bar"). The
// header can be moved to the popped-out window with the rest of the app, so its parts are looked up inside it as well
// as in this document.
let headerEl = null;
const qsa = (sel) => [...new Set([...document.querySelectorAll(sel), ...(headerEl ? headerEl.querySelectorAll(sel) : [])])];
const byId = (id) => document.getElementById(id) || headerEl?.querySelector(`#${id}`) || null;

// What the bar knows about who is looking: undefined until /api/me answers, null with no account (a guest, a keyed
// page), else { role, hostAdmin, hosted, slug }. The slots that need an account wait for it only to hide.
let account;
let freshModules = 0; // modules this server ships that are not installed yet: Manage > Modules lists them as Available
let updatesWaiting = 0; // module updates available, for owners and the admin (GET /api/modules)
let presentSpace = null; // the space this page is present in (an aside's parent in an aside); the space page says so
let inSpace = false; // the space page showing a space (plan-one-bar.md, step 7): its one bar has the switcher in the Spaces slot's place
// A page whose tabs are in the top bar (renderPageBar(), a control marked data-top-bar: Manage, #262): the bar is the
// page's, so the Spaces slot and the switcher's entries in the phone menu leave it, and the anchor names the page.
let pageTabsInBar = false;
let bar = { adminHref: '/admin', withThemeSwitch: true, guest: false, hostConsole: false };

// A page opened over a call (?from=space, Profile or Manage in the space page's frame): the same origin underneath.
export const overCall = () => new URLSearchParams(window.location.search).get('from') === 'space' && window.parent !== window;
// Shown within a space's page in any way: opened over a call (?from=space), or in the space page's overlay frame even
// where a redirect dropped that query (a module's page leading on to its destination, such as /modules/calendar to
// /calendar), or in a composite's frame on the canvas (canvas.js marks it data-composite: the Calendar and Map tabs
// show their page there, plan-layout-views.md step 3), whatever page a link inside it led on to. Same origin, so the
// frame's element can be read; anywhere else it is null.
const inSpaceFrame = (frame) => Boolean(frame && (frame.id === 'page-overlay-frame' || frame.hasAttribute('data-composite')));
export const withinSpacePage = () => {
  if (overCall()) return true;
  try { return inSpaceFrame(window.frameElement); } catch { return false; }
};
const keptQuery = () => (new URLSearchParams(window.location.search).get('from') === 'space' ? window.location.search : '');
// A path with a page opened over a call's query kept (?from=space...), so the next page keeps its way back.
function keepingQuery(href) {
  const keep = keptQuery();
  const [path, hash] = String(href).split('#');
  return keep && !path.includes('?') ? `${path}${keep}${hash ? `#${hash}` : ''}` : href;
}

// The space page tells the bar where this page is present (updateCrumb in space.js), so the switcher can mark it. A
// page opened over a call reads it from the space page underneath.
export function setPresentSpace(id) {
  presentSpace = id || null;
  markDestinations();
}
window.appPresentSpace = () => presentSpace;
// The space page says when it shows a space (not home over it): then the top bar's left zone is the space's name with
// the switcher's caret (space.js's `space-switcher`), and the Spaces slot leaves the bar until home shows again.
export function setInSpace(on) {
  inSpace = Boolean(on);
  nav.draw('primary');
}
function presentSpaceNow() {
  if (overCall()) {
    try {
      return window.parent.appPresentSpace?.() || null;
    } catch {
      return null;
    }
  }
  return presentSpace;
}

// themeSwitch: false leaves out the light or dark switch (the host console, which no environment's theme reaches).
export function renderTopbar({ location = '', adminHref = '/admin', themeSwitch: withThemeSwitch = true } = {}) {
  const header = document.querySelector('.topbar');
  if (!header) return;
  headerEl = header;
  // Opened as an overlay iframe (see openOverlay() in space.js), the parent page already knows the environment's real
  // name and logo -- passing them along means the very first paint gets it right, instead of flashing the generic
  // default while this page's own loadBranding() fetch is in flight.
  const handoff = new URLSearchParams(window.location.search);
  const initialName = handoff.get('environmentName') || 'Coffee Pub';
  const initialIcon = handoff.get('homeIcon') || 'couch';
  const initialLogo = handoff.get('hasIcon') === '1';
  const guest = isGuestPage();
  const hostConsole = document.body.classList.contains('host-console');
  bar = { adminHref, withThemeSwitch, guest, hostConsole };
  // The left zone: the logo (the uploaded one, else the chosen home icon, in one box, never both: decision 23) and the
  // environment's name, one link home; for a guest, plain text. Modules, Spaces and the anchor are tools after them.
  const tag = guest ? 'span' : 'a';
  const homeAttrs = guest ? '' : ` href="/" target="_top" title="${escapeHtml(word('home'))}"`;
  header.innerHTML = `
    <div class="nav-left brand">
      <${tag} class="brand-home" id="brand-home-link"${homeAttrs}>
        <span class="brand-logo"><img data-brand="icon" alt="" class="icon"${initialLogo ? '' : ' hidden'}><i class="fa-solid fa-${escapeHtml(initialIcon)} fa-fw" data-icon-id="${escapeHtml(initialIcon)}" data-brand="home-icon" aria-hidden="true"${initialLogo ? ' hidden' : ''}></i></span>
        <span class="brand-name" data-brand="environmentName">${escapeHtml(initialName)}</span>
      </${tag}>
    </div>
    <div class="nav-middle core-nav" id="core-nav"></div>
    <nav class="nav-right links" aria-label="${guest ? 'Page' : 'You'}"></nav>
    <button class="icon-link nav-toggle" id="nav-toggle" type="button" data-tip="Menu" aria-label="Menu" aria-expanded="false"><i class="fa-solid fa-bars fa-fw" aria-hidden="true"></i></button>
  `;
  nav.attach('primary', header);
  registerSystemTools(header);
  wireNavMenu(header);
  setTopbarLocation(location);
  wireInstall();
  startPresence();
  loadAccount();
  if (guest) useDefaultMode(); // a guest gets the environment's default mode, never one this browser remembers
  else if (withThemeSwitch) loadAccountMode();
  fillWhoami();
  startNotifications();
  mountEnvironmentBanner(loadMe); // an owner's past-due line under the header, on a hosted environment only
}

// Who is looking, for the slots that depend on it (the profile menu, the bell's updates). Redraws the bar once known.
async function loadAccount() {
  if (bar.guest) {
    account = null;
    return;
  }
  const me = await loadMe();
  if (me === null) account = null;
  else if (me && me.user) account = { role: me.user.role, hostAdmin: Boolean(me.environment?.hostAdmin || me.user.hostAdmin), hosted: Boolean(me.environment?.hosted), slug: me.environment?.slug || '' };
  nav.draw(); // both bars: a page bar's Manage link waits on the role too
  if (account && seesUpdates(account.role)) loadUpdateBadge();
  paintBell();
}

// The bar's words, again once loadBranding() has this environment's (the home word, the module word).
function refreshWords() {
  const home = byId('brand-home-link');
  if (home && home.tagName === 'A') home.title = word('home');
  const link = byId('spaces-link');
  if (link) link.textContent = word('home');
  const caret = byId('spaces-switch');
  if (caret) {
    const text = `Switch ${word('space')}`;
    caret.dataset.tip = text;
    caret.setAttribute('aria-label', text);
  }
  if (nav.get('menu-home')) nav.register({ ...nav.get('menu-home'), label: word('home') });
  if (nav.get('menu-new-space')) nav.register({ ...nav.get('menu-new-space'), label: `New ${word('space')}` });
}

// The system's own tools. The left zone, after the branding (the logo and the name): the destinations (loadDestinations,
// orders 1 to 8), Spaces (the home word and the switcher's caret) and the anchor (the breadcrumb, then the status line),
// one group, `where` (plan-two-zone-nav.md). The right zone: the bell, then you (your picture, which opens the profile
// menu), a divider between; online people come before the bell in a later step. On a phone, the destinations and Spaces
// leave the bar and the menu (the right zone) holds the environment's name, home and the switcher's entries, the
// destinations, then you and the profile menu's entries; the bell stays (phone: 'bar').
function registerSystemTools(header) {
  const doc = header.ownerDocument;
  const { guest, hostConsole } = bar;
  const signedIn = () => !guest && account !== null; // still asking counts as signed in, so nothing jumps in
  const wide = () => !onPhone();
  const inMenuOnly = () => onPhone() && signedIn();
  if (!guest && !hostConsole) {
    // Spaces: the home word, a link home (the space page keeps it in the page, showSpaceList()), and a caret that opens
    // the switcher.
    const slot = doc.createElement('span');
    slot.className = 'nav-slot-pair';
    slot.innerHTML = '<a class="core-link nav-slot" id="spaces-link" href="/" target="_top"></a><button type="button" class="core-link nav-slot-caret" id="spaces-switch" aria-haspopup="menu" aria-expanded="false"><i class="fa-solid fa-caret-down fa-fw" aria-hidden="true"></i></button>';
    slot.querySelector('#spaces-link').textContent = word('home');
    const caret = slot.querySelector('#spaces-switch');
    caret.dataset.tip = `Switch ${word('space')}`;
    caret.setAttribute('aria-label', caret.dataset.tip);
    caret.addEventListener('click', () => openSwitcher(caret));
    nav.register({ id: 'spaces-slot', bar: 'primary', zone: 'left', group: 'where', groupOrder: 1, order: 9, element: slot, visible: () => wide() && signedIn() && !inSpace && !pageTabsInBar });
  }
  // The anchor: where you are, after the Spaces slot (setTopbarLocation; the space page's breadcrumb). On a phone only
  // its last segment shows (style.css).
  const crumb = doc.createElement('nav');
  crumb.className = 'crumb';
  crumb.id = 'topbar-crumb';
  crumb.setAttribute('aria-label', 'Where you are');
  nav.register({ id: 'topbar-crumb', bar: 'primary', zone: 'left', group: 'where', order: 10, element: crumb });
  const status = doc.createElement('span');
  status.className = 'status topbar-status';
  status.id = 'topbar-status';
  nav.register({ id: 'topbar-status', bar: 'primary', zone: 'left', group: 'where', order: 11, element: status });
  if (guest || hostConsole) return; // a guest's bar is the logo, the name and the anchor; the host console's is its own
  // The phone menu's own entries, first: the environment's name, then home and the switcher's entries (refreshed as
  // the menu opens), then "+ New" for owners and the admin.
  const envName = doc.createElement('span');
  envName.className = 'nav-menu-heading';
  envName.dataset.brand = 'environmentName';
  envName.textContent = byId('brand-home-link')?.querySelector('[data-brand="environmentName"]')?.textContent || '';
  nav.register({ id: 'menu-environment', bar: 'primary', zone: 'right', group: 'menu-where', groupOrder: 1, order: 1, element: envName, visible: inMenuOnly });
  nav.register({ id: 'menu-home', bar: 'primary', zone: 'right', group: 'menu-where', order: 2, icon: 'house', label: word('home'), href: '/', target: '_top', visible: inMenuOnly });
  nav.register({ id: 'menu-new-space', bar: 'primary', zone: 'right', group: 'menu-new', groupOrder: 2, order: 1, icon: 'plus', label: `New ${word('space')}`, visible: () => inMenuOnly() && seesUpdates(account?.role), onClick: newSpace });
  loadDestinations({ wide: () => wide() && signedIn(), inMenuOnly });
  // The bell: the unread module notices, and the module updates for owners and the admin (decisions 9 and 18).
  const bell = doc.createElement('button');
  bell.type = 'button';
  bell.id = 'notifications-bell';
  bell.className = 'icon-link nav-bell';
  bell.setAttribute('aria-haspopup', 'dialog');
  bell.setAttribute('aria-expanded', 'false');
  bell.setAttribute('aria-controls', 'notifications-list');
  bell.innerHTML = '<i class="fa-solid fa-bell fa-fw" aria-hidden="true"></i><span class="sdk-badge-micro" aria-hidden="true" hidden></span>';
  bell.addEventListener('click', (event) => {
    event.stopPropagation(); // not a click "elsewhere" for the phone menu or the list itself
    toggleNotices(bell);
  });
  nav.register({ id: 'notifications-bell', bar: 'primary', zone: 'right', group: 'notices', groupOrder: 90, order: 90, phone: 'bar', element: bell, visible: signedIn });
  paintBell();
  // You, last: your picture and name, a button that opens the profile menu. On a phone it folds into the header's menu
  // with everything else: there it is only your picture and name, and the profile menu's entries follow it as the
  // menu's own (no menu inside the menu).
  const whoami = doc.createElement('button');
  whoami.type = 'button';
  whoami.className = 'whoami nav-text'; // the nav text, as every word in the bar
  whoami.id = 'whoami-link';
  whoami.innerHTML = '<img id="whoami-img" alt="" hidden><span id="whoami"></span><span id="whoami-account" hidden>Account</span><i class="fa-solid fa-caret-down fa-fw whoami-caret" aria-hidden="true"></i>';
  whoami.addEventListener('click', (event) => {
    if (onPhone()) {
      event.stopPropagation(); // only a label in the header's menu: the menu stays open
      return;
    }
    openHostMenu(whoami, accountMenuItems());
  });
  paintWhoami(whoami);
  if (phoneQuery) phoneQuery.addEventListener('change', () => paintWhoami(whoami));
  nav.register({ id: 'whoami-link', bar: 'primary', zone: 'right', group: 'you', groupOrder: 999, order: 999, element: whoami });
  // The profile menu's entries as the header menu's own: on a phone only, and only for someone signed in (your picture
  // is showing), each by profileEntries() as the menu under your picture. The menu draws the bar again as it opens, so
  // these follow a page that hid your picture.
  const signedInHere = () => !whoami.hidden && !byId('whoami-img')?.hidden;
  const inMenu = () => onPhone() && signedInHere();
  const offers = (entry) => profileFor().includes(entry);
  nav.register({ id: 'account-profile', bar: 'primary', zone: 'right', group: 'you', order: 999, icon: 'user', label: 'View profile', visible: inMenu, onClick: viewProfile });
  if (bar.withThemeSwitch) nav.register({ id: 'theme-mode-switch', bar: 'primary', zone: 'right', group: 'you', order: 999, element: themeSwitch(doc), visible: () => inMenu() && offers('theme') });
  nav.register({ id: 'admin-link', bar: 'primary', zone: 'right', group: 'you', order: 999, icon: 'gear', label: 'Manage', href: keepingQuery(bar.adminHref), visible: () => inMenu() && offers('manage'), onClick: (event) => { event.preventDefault(); openManage(); } });
  nav.register({ id: 'account-host-console', bar: 'primary', zone: 'right', group: 'you', order: 999, icon: 'server', label: 'Host console', visible: () => inMenu() && offers('host-console'), onClick: openHostConsole });
  nav.register({ id: 'account-install', bar: 'primary', zone: 'right', group: 'you', order: 999, icon: 'download', label: 'Install as an app', visible: () => inMenu() && Boolean(installPromptEvent) && !installBarred, onClick: installFromPrompt });
  nav.register({ id: 'account-sign-out', bar: 'primary', zone: 'right', group: 'you', order: 999, icon: 'right-from-bracket', label: 'Sign out', visible: inMenu, onClick: signOut });
}

// The destinations (Calendar, Map; plan-calendar-destination.md): from GET /api/destinations, on a phone an entry each in
// the menu after the Spaces slot's (destinationTools() in primary-nav.js); wider, an entry each in the profile menu
// (accountMenuItems, plan-one-bar.md decision 6). In a space Calendar and Map are layout tabs (space.js, layoutTabs()),
// which show their composite on the canvas; the space page may still ask destinationsNow() or hear `app:destinations`. While this page is present in a space the
// menu's entries carry data-overlay-link, so the space page opens them over the space as a page (Away while on the
// call); a page already over a call keeps its way back (keepingQuery).
const destinationEls = new Set();
const destinationIds = new Set();
let destinationVisibility = null;
let destinationList = []; // what the server lists, as it came
export const destinationsNow = () => destinationList;
async function loadDestinations({ wide, inMenuOnly }) {
  destinationVisibility = { wide, inMenuOnly };
  let list = [];
  try {
    const res = await fetch('/api/destinations');
    if (res.ok) list = (await res.json()).destinations || [];
  } catch {
    // none, then
  }
  // Asked again (Manage's Top bar switches): what was there goes first.
  for (const id of destinationIds) nav.unregister(id);
  destinationIds.clear();
  destinationEls.clear();
  for (const { menu } of destinationTools(list, { path: window.location.pathname.toLowerCase() })) {
    // In a space the view (space.js, the menu's first entries on a phone) is the one entry: not two Calendars in one menu.
    for (const [t, visible] of [[menu, () => inMenuOnly() && !inSpace]]) {
      const { current, overlay, href, ...tool } = t;
      const el = nav.register({ ...tool, bar: 'primary', href: keepingQuery(href), visible, onClick: () => markDestinations() });
      destinationIds.add(tool.id);
      if (!el) continue;
      el.dataset.destination = href;
      if (!el.dataset.tip) el.title = tool.label;
      if (current) el.setAttribute('aria-current', 'page');
      destinationEls.add(el);
    }
  }
  destinationList = destinationTools(list).map((d) => ({ id: d.bar.id.slice('dest-'.length), name: d.bar.label, icon: d.bar.icon, href: d.bar.href }));
  markDestinations();
  document.dispatchEvent(new CustomEvent('app:destinations', { detail: { destinations: destinationList } }));
}
// The bar's destinations again, once they may have changed (Show in the top bar, on a module's configuration page).
export function refreshDestinations() {
  if (destinationVisibility) return loadDestinations(destinationVisibility);
  return Promise.resolve();
}
function markDestinations() {
  const over = Boolean(presentSpaceNow()) && !overCall();
  for (const el of destinationEls) el.toggleAttribute('data-overlay-link', over);
}
// The environment's Calendar or Map from the profile menu: over the space while present in one (as Manage opens),
// else the page itself (pageOpens: 'page' for a destination present nowhere).
function openDestination(href) {
  openPage(keepingQuery(href), 'destination');
}

// The profile menu's entries for whoever is looking (primary-nav.js's profileEntries, a pure function of the role, the
// install and the browser's offer).
function profileFor() {
  if (!account) return account === null ? [] : ['profile', ...(bar.withThemeSwitch ? ['theme'] : []), 'sign-out'];
  return profileEntries({ role: account.role, hostAdmin: account.hostAdmin, hosted: account.hosted, installOffered: Boolean(installPromptEvent) && !installBarred, themeSwitch: bar.withThemeSwitch, destinations: destinationList.map((d) => d.id) });
}

// A page to open: the space page takes it (app:open-page) and opens it over the call, so the call keeps running;
// anywhere else it is a real navigation. `kind` is 'manage' or 'host-console'.
function openPage(href, kind) {
  const unhandled = document.dispatchEvent(new CustomEvent('app:open-page', { detail: { href, kind }, cancelable: true }));
  if (unhandled) window.location.href = href;
}
function openManage(hash = '') {
  const [path, own] = String(bar.adminHref).split('#');
  openPage(keepingQuery(hash ? `${path}#${hash}` : own ? `${path}#${own}` : path), 'manage');
}
// "+ New <space>": Manage's Spaces tab at its Add button (decision 16, owners and the admin).
function newSpace() {
  openManage('add-space');
}
// The host console, on a hosted server, for the host admin's stand-in: the host's own address. Over a call it opens in
// a new tab, so the call keeps running.
function openHostConsole() {
  const url = hostConsoleUrl(window.location, account?.slug);
  if (!url) return;
  const unhandled = document.dispatchEvent(new CustomEvent('app:open-page', { detail: { href: url, kind: 'host-console' }, cancelable: true }));
  if (!unhandled) return;
  let win = window;
  try {
    if (window.top.location.origin === window.location.origin) win = window.top;
  } catch {
    // framed by another origin: this page goes
  }
  win.location.href = url;
}

// The space switcher (decision 15): the spaces you belong to, a mark and "You are here" on the one you are present in,
// "N here" when anyone is, then "+ New <space>" for owners and the admin, and last, while present in one, Leave <space>
// (plan-one-bar.md, step 5: the entry switcherEntries() marks `leave`; the space page does what its Leave button did).
async function presenceNow() {
  try {
    const res = await fetch('/api/presence');
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
const hereHint = (e) => [e.here ? 'You are here' : '', e.count ? `${e.count} here` : ''].filter(Boolean).join(' · ');
export async function openSwitcher(trigger) {
  const data = await presenceNow();
  const entries = switcherEntries({ spaces: data?.spaces, users: data?.users, present: presentSpaceNow() });
  const leave = entries.find((e) => e.leave);
  const items = entries.filter((e) => !e.leave).map((e) => ({ icon: e.here ? 'location-dot' : 'door-open', label: e.name, hint: hereHint(e), onPick: () => pickSpace(e.id) }));
  if (!data) items.push({ label: "Couldn't load the list. Try again.", disabled: true });
  if (seesUpdates(account?.role)) items.push(...(items.length ? [{ divider: true }] : []), { icon: 'plus', label: `New ${word('space')}`, onPick: newSpace });
  if (leave) items.push(...(items.length ? [{ divider: true }] : []), { icon: 'right-from-bracket', label: `Leave ${word('space')}`, onPick: () => pickSpace(leave.id, 'leave') });
  openHostMenu(trigger, items);
}
// The switcher's entries in the phone menu, asked again each time the menu opens. Not Leave: on a phone the space
// bar is the tab bar and keeps its Leave (plan-one-bar.md, decision 3).
let menuSpaceIds = new Set();
async function refreshMenuSpaces() {
  const data = await presenceNow();
  if (!data) return;
  const entries = switcherEntries({ spaces: data.spaces, users: data.users, present: presentSpaceNow() }).filter((e) => !e.leave);
  const keep = new Set(entries.map((e) => `menu-space-${e.id}`));
  for (const id of menuSpaceIds) if (!keep.has(id)) nav.unregister(id);
  menuSpaceIds = keep;
  entries.forEach((e, i) => {
    const hint = hereHint(e);
    nav.register({ id: `menu-space-${e.id}`, bar: 'primary', zone: 'right', group: 'menu-where', order: 3 + Math.min(i, 900), icon: e.here ? 'location-dot' : 'door-open', label: hint ? `${e.name} (${hint})` : e.name, visible: () => onPhone() && account !== null && !pageTabsInBar, onClick: () => pickSpace(e.id) });
  });
}
// A pick: the space page enters it or goes back to it (app:enter-space, the space page underneath when this page is
// over a call); any other page goes to the space page, which enters it. `action: 'leave'` (the switcher's last entry)
// is the space page's alone: it leaves, as its Leave button did; with no space page to take it, nothing happens.
function pickSpace(id, action = switchPick(presentSpaceNow(), id)) {
  let doc = document;
  if (overCall()) {
    try {
      doc = window.parent.document;
    } catch {
      doc = document;
    }
  }
  const view = doc.defaultView || window;
  const unhandled = doc.dispatchEvent(new view.CustomEvent('app:enter-space', { detail: { id, action }, cancelable: true }));
  if (!unhandled || action === 'leave') return;
  let win = window;
  try {
    if (window.top.location.origin === window.location.origin) win = window.top;
  } catch {
    // framed by another origin: this page goes
  }
  win.location.href = `/#join=${encodeURIComponent(id)}`;
}

// The phone width, the same one nav-bar.js folds the header at.
const phoneQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 640px)') : null;
const onPhone = () => Boolean(phoneQuery && phoneQuery.matches);

// Your picture is the account menu's button on a wider screen, and only a label (your picture and name) in the
// header's menu on a phone: out of the Tab order there, and it opens nothing.
function paintWhoami(whoami) {
  // An account menu open across the change would be left under a label (off screen on a phone) or without its button.
  // Its focus goes back to your picture, which on a phone is inside the closed header menu: the menu button takes it.
  const doc = whoami.ownerDocument;
  const hadFocus = Boolean(doc.activeElement?.closest?.('.host-menu'));
  closeHostMenu();
  if (onPhone() && hadFocus && !whoami.getClientRects().length) doc.getElementById('nav-toggle')?.focus();
  if (onPhone()) {
    whoami.tabIndex = -1;
    whoami.removeAttribute('title');
    whoami.removeAttribute('aria-haspopup');
    whoami.removeAttribute('aria-expanded');
    whoami.setAttribute('aria-disabled', 'true'); // read as your name, not as a button to press
    whoami.setAttribute('aria-labelledby', 'whoami');
  } else {
    whoami.removeAttribute('tabindex');
    whoami.removeAttribute('aria-disabled');
    whoami.title = 'Account';
    whoami.setAttribute('aria-haspopup', 'menu');
    whoami.setAttribute('aria-expanded', 'false');
    whoami.setAttribute('aria-labelledby', 'whoami whoami-account'); // "<your name> Account"
  }
}

// View profile goes to /profile; a page that can show it without leaving (a space, where leaving would end the call)
// takes the app:open-profile event and opens it over itself instead; on the profile page itself it does nothing.
function viewProfile() {
  const unhandled = document.dispatchEvent(new CustomEvent('app:open-profile', { cancelable: true }));
  if (!unhandled || location.pathname === '/profile') return; // already there: the menu just closes
  // Opened over a call (?from=space), the query stays, so the profile page keeps its way back.
  const keep = new URLSearchParams(location.search).get('from') === 'space' ? location.search : '';
  location.href = `/profile${keep}`;
}

// Sign out forgets this browser's light or dark choice first, so the next person here starts from the default, and
// signs the whole window out (from a page opened over a call too, not only that page).
function signOut() {
  forgetThemeMode();
  let win = window;
  try {
    if (window.top.location.origin === location.origin) win = window.top;
  } catch {
    // framed by another origin: sign this page out
  }
  win.location.href = '/logout';
}

// The profile menu under your picture, on a wider screen, by role (decisions 4 and 17; profileEntries() in
// primary-nav.js): View profile, Dark mode, the environment's Global Calendar and Global Map (plan-one-bar.md, decision 6), Manage
// for owners and the admin, Host console for the host admin's stand-in on a hosted server, Install as an app only
// while the browser offers it (never a guest), Sign out last.
function accountMenuItems() {
  const has = new Set(profileFor());
  return [
    { icon: 'user', label: 'View profile', onPick: viewProfile },
    ...(has.has('theme') ? [{ icon: 'moon', label: 'Dark mode', checked: modeNow() === 'dark', onPick: toggleThemeMode }] : []),
    ...destinationList.filter((d) => has.has(`dest-${d.id}`)).map((d) => ({ icon: d.icon, label: profileDestinationLabel(d.id, d.name), onPick: () => openDestination(d.href) })),
    ...(has.has('manage') ? [{ icon: 'gear', label: 'Manage', ...manageBadgeItem(), onPick: () => openManage() }] : []),
    ...(has.has('host-console') ? [{ icon: 'server', label: 'Host console', onPick: openHostConsole }] : []),
    ...(installPromptEvent && !installBarred ? [{ icon: 'download', label: 'Install as an app', onPick: installFromPrompt }] : []),
    { icon: 'right-from-bracket', label: 'Sign out', onPick: signOut },
  ];
}

// Your picture and name, for a page that does not fill them itself (the pages that do fill them first, or after: the
// same person). No account here (a guest's page): no picture, and so no account menu.
async function fillWhoami() {
  if (document.body.classList.contains('host-console')) return;
  const me = await loadMe();
  const button = byId('whoami-link');
  const name = byId('whoami');
  const img = byId('whoami-img');
  if (!button || !name || !img) return;
  if (me === null) {
    button.hidden = true;
    return;
  }
  if (!me || !me.user) return;
  if (!name.textContent) name.textContent = me.user.displayName || me.user.key || '';
  if (img.hidden) {
    img.src = `/img/${encodeURIComponent(me.user.key)}/profile`;
    img.hidden = false;
  }
}

// The server's clock (12- or 24-hour, Manage > Settings > Language, time and money), for the times in the bell's list.
let clockHour12 = true;

// On a phone the header's links are a menu (see the phone header rules in style.css): the button
// opens them, and a tap anywhere else or Escape closes them. The core navigation (the middle zone) has no
// space on a phone, so the registry draws its tools into the menu there, and back to the middle when the
// window widens (nav-bar.js watches the same width).
function wireNavMenu(header) {
  const toggle = header.querySelector('#nav-toggle');
  const menu = header.querySelector('.nav-right');
  // No ☰ with nothing in its menu (a guest's page, the host console): the button is hidden while every entry is.
  const syncToggle = () => {
    const any = [...menu.children].some((c) => !c.hidden && !('navDivider' in c.dataset));
    if (toggle.hidden === any) toggle.hidden = !any;
  };
  // Entries come and go (childList) and show or hide (their `hidden`, which the registry and the pages set).
  if (typeof MutationObserver === 'function') new MutationObserver(syncToggle).observe(menu, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  syncToggle();
  const isOpen = () => header.classList.contains('menu-open');
  const setOpen = (on, { focus = false } = {}) => {
    const wasOpen = isOpen();
    if (on) nav.draw('primary'); // what shows in it is decided as it opens (View profile and Sign out follow your picture)
    if (on && !wasOpen) refreshMenuSpaces(); // the switcher's entries, with who is where now
    header.classList.toggle('menu-open', on);
    toggle.setAttribute('aria-expanded', String(on));
    // The menu comes before its button in the markup, so Tab from the button would go into the page: opening it
    // takes focus to its first entry (Tab from its last comes back to the button), and closing it from inside puts
    // focus back on the button.
    if (on && !wasOpen) firstEntry(menu)?.focus();
    if (!on && wasOpen && focus) toggle.focus();
  };
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(!isOpen());
  });
  header.ownerDocument.addEventListener('click', (event) => {
    if (!event.target.closest('#nav-toggle')) setOpen(false);
  });
  header.ownerDocument.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) setOpen(false, { focus: menu.contains(event.target.ownerDocument.activeElement) });
  });
  // Focus leaving the menu and its button (Shift+Tab back into the crumb, Tab on from the button into the page) closes it.
  const leaving = (event) => {
    const to = event.relatedTarget;
    if (isOpen() && to && !menu.contains(to) && to !== toggle) setOpen(false);
  };
  menu.addEventListener('focusout', leaving);
  toggle.addEventListener('focusout', leaving);
  // Crossing the phone width closes it (wider, there is no menu; narrower again, it starts closed). The registry moves
  // the header's tools between the bar and the menu for the new width, which can drop the focus of the one it moved,
  // so the header remembers what last had focus in it: that again if it is still shown, else the menu button on a
  // phone, or the bar's first entry on a wider screen. After the registry has drawn the bar for the new width.
  let lastFocus = null;
  header.addEventListener('focusin', (event) => { lastFocus = event.target; });
  header.addEventListener('focusout', (event) => {
    if (event.relatedTarget && !header.contains(event.relatedTarget)) lastFocus = null;
  });
  if (phoneQuery) {
    phoneQuery.addEventListener('change', () => {
      const doc = header.ownerDocument;
      const had = doc.activeElement;
      const dropped = !had || had === doc.body;
      const was = dropped ? lastFocus : had;
      const wasHere = Boolean(was && (was === toggle || menu.contains(was) || (dropped && header.contains(was))));
      setOpen(false);
      if (!wasHere) return;
      setTimeout(() => {
        const now = doc.activeElement;
        if (now && now !== doc.body && now.getClientRects().length) return;
        const shown = (el) => el && header.contains(el) && el.tabIndex >= 0 && el.getClientRects().length;
        (shown(was) ? was : onPhone() ? toggle : firstEntry(menu))?.focus();
      }, 0);
    });
  }
}

// The first entry of the open header menu that takes focus: a link, a button or the light or dark switch, shown and
// in the Tab order (your picture, only a label there, is not).
function firstEntry(menu) {
  const all = menu ? menu.querySelectorAll('a[href], button, input, select, [tabindex]') : [];
  for (const el of all) {
    if (el.disabled || el.tabIndex < 0 || el.closest('[hidden]') || !el.getClientRects().length) continue;
    return el;
  }
  return null;
}

// --- module notifications ----------------------------------------------------
// A module can notify people (its reminders, say). They arrive as a toast while you are in the host, as a count on the
// bell, on the home tiles and on the space bar's Layout button; opening the module clears its own, and opening the
// bell's list marks them all read. A page opened over a call (?from=space) asks for the count once and
// leaves the live stream to the call page underneath.
const unreadByModule = {};

function paintUnread() {
  paintBell();
  document.dispatchEvent(new CustomEvent('app:unread', { detail: { ...unreadByModule } }));
}

// The bell's count and its words: the unread notices, and for owners and the admin the module updates (bellState() in
// primary-nav.js).
function bellNow() {
  const unread = Object.values(unreadByModule).reduce((sum, n) => sum + (Number(n) || 0), 0);
  return bellState({ unread, updates: updatesWaiting, role: account?.role, moduleWord: word('module') });
}
function paintBell() {
  const bell = byId('notifications-bell');
  if (!bell) return;
  const { count, title } = bellNow();
  bell.dataset.tip = title;
  bell.setAttribute('aria-label', title);
  const badge = bell.querySelector('.sdk-badge-micro');
  badge.hidden = !count;
  badge.textContent = count > 9 ? '9+' : String(count);
}

// The bell's list (decisions 9 and 18): for owners and the admin a line with the module updates, linking to Manage >
// Modules; then the notices, newest first, each with its module's icon and name, its title, body and time; "Nothing
// new." with none. Opening it marks them read. It hangs under the bell, inside the window, and closes on the bell,
// Escape (focus back to the bell), a press elsewhere or focus leaving it.
let noticesOpen = null; // { list, bell, cleanup }
function closeNotices({ refocus = false } = {}) {
  if (!noticesOpen) return;
  const { list, bell, cleanup } = noticesOpen;
  noticesOpen = null;
  cleanup();
  list.remove();
  bell.setAttribute('aria-expanded', 'false');
  if (refocus) bell.focus();
}
function noticeTime(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString([], today ? { hour: 'numeric', minute: '2-digit', hour12: clockHour12 } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: clockHour12 });
}
// A notice from the host itself (about the bundled modules) carries href "/admin#<tab>": it opens that tab of Manage.
const manageTabOf = (n) => (typeof n.href === 'string' && n.href.startsWith('/admin#') ? n.href.slice(7) : '');
function noticeHtml(n) {
  const icon = String(n.icon || 'bell');
  const iconClass = icon.includes(' ') ? icon : `fa-solid fa-${icon}`;
  const when = noticeTime(n.at);
  const tab = manageTabOf(n);
  return `<li class="bell-notice"${tab ? ` data-manage="${escapeHtml(tab)}" role="link" tabindex="0"` : ''}><i class="${escapeHtml(iconClass)} fa-fw bell-notice-icon" aria-hidden="true"></i><span class="bell-notice-text"><strong>${escapeHtml(n.title || '')}</strong>${n.body ? `<span class="bell-notice-body">${escapeHtml(n.body)}</span>` : ''}<span class="bell-notice-from">${escapeHtml(n.moduleName || n.module || '')}${when ? ` · ${escapeHtml(when)}` : ''}</span></span></li>`;
}
// A notice that arrives while the list is open goes to its top, read at once (the list is what reads them). True when
// it was shown there.
function addToOpenNotices(n) {
  if (!noticesOpen || !noticesOpen.loaded) return false; // still asking: the answer will have it
  const { list } = noticesOpen;
  let ul = list.querySelector('.bell-notices');
  if (!ul) {
    list.querySelector('[data-empty]')?.remove();
    ul = list.ownerDocument.createElement('ul');
    ul.className = 'bell-notices';
    list.appendChild(ul);
  }
  ul.insertAdjacentHTML('afterbegin', noticeHtml(n));
  if (n.id) api('POST', '/api/notifications/read', { id: n.id }).catch(() => {});
  return true;
}

// The counts again from the server (GET /api/notifications): after a page opened over the call read them, so the
// bell, the Modules slot and the call's own counts underneath are not left stale. A page over the call asks its space
// page to do it (window.appRefreshNotices), and the space page also asks when it closes that page.
export async function refreshNotices() {
  try {
    const res = await fetch('/api/notifications');
    if (!res.ok) return;
    const { byModule } = await res.json();
    for (const key of Object.keys(unreadByModule)) unreadByModule[key] = 0;
    Object.assign(unreadByModule, byModule || {});
    paintUnread();
  } catch {
    // the next event or load brings them
  }
}
window.appRefreshNotices = refreshNotices;
function refreshUnderneath() {
  if (!overCall()) return;
  try {
    window.parent.appRefreshNotices?.();
  } catch {
    // not our own page underneath
  }
}

async function toggleNotices(bell) {
  if (noticesOpen) {
    closeNotices({ refocus: noticesOpen.bell === bell });
    return;
  }
  closeHostMenu();
  const doc = bell.ownerDocument;
  const view = doc.defaultView;
  const list = doc.createElement('div');
  list.className = 'bell-list';
  list.id = 'notifications-list';
  list.setAttribute('role', 'dialog');
  list.setAttribute('aria-label', 'Notifications');
  list.tabIndex = -1;
  list.innerHTML = '<div class="bell-head">Notifications</div><p class="sdk-empty-line" data-empty><span class="sdk-spinner sdk-spinner-sm" aria-hidden="true"></span> Loading</p>';
  doc.body.appendChild(list);
  bell.setAttribute('aria-expanded', 'true');
  const place = () => {
    const b = bell.getBoundingClientRect();
    const width = Math.min(360, view.innerWidth - 16);
    list.style.width = `${width}px`;
    list.style.left = `${Math.max(8, Math.min(b.right - width, view.innerWidth - width - 8))}px`;
    list.style.top = `${b.bottom + 6}px`;
    list.style.maxHeight = `${Math.max(160, view.innerHeight - b.bottom - 18)}px`;
  };
  place();
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeNotices({ refocus: true });
    }
  };
  const onOutside = (e) => {
    if (!list.contains(e.target) && !bell.contains(e.target)) closeNotices();
  };
  const onFocusOut = (e) => {
    const to = e.relatedTarget;
    if (to && !list.contains(to) && to !== bell) closeNotices();
  };
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('pointerdown', onOutside, true);
  list.addEventListener('focusout', onFocusOut);
  view.addEventListener('resize', place);
  noticesOpen = { list, bell, cleanup: () => {
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('pointerdown', onOutside, true);
    view.removeEventListener('resize', place);
  } };
  list.focus();
  let notices = [];
  try {
    const res = await fetch('/api/notifications');
    if (res.ok) notices = (await res.json()).notifications || [];
  } catch {
    // shown as nothing new
  }
  if (!noticesOpen || noticesOpen.list !== list) return; // closed while it was asking
  const { updates } = bellNow();
  const parts = ['<div class="bell-head">Notifications</div>'];
  if (updates) {
    parts.push(`<a class="bell-updates" href="${escapeHtml(keepingQuery('/admin#modules'))}"><i class="fa-solid fa-puzzle-piece fa-fw" aria-hidden="true"></i><span>${updates} ${escapeHtml(word('module'))} update${updates === 1 ? '' : 's'} available</span></a>`);
  }
  const sorted = [...notices].sort((a, b) => (Number(new Date(b.at)) || 0) - (Number(new Date(a.at)) || 0));
  if (sorted.length) {
    parts.push('<ul class="bell-notices">');
    for (const n of sorted) parts.push(noticeHtml(n));
    parts.push('</ul>');
  } else if (!updates) {
    parts.push('<p class="sdk-empty-line" data-empty>Nothing new.</p>');
  }
  list.innerHTML = parts.join('');
  noticesOpen.loaded = true;
  const openNotice = (event) => {
    const li = event.target.closest?.('.bell-notice[data-manage]');
    if (!li || (event.type === 'keydown' && event.key !== 'Enter')) return;
    event.preventDefault();
    closeNotices();
    openManage(li.dataset.manage);
  };
  list.addEventListener('click', openNotice);
  list.addEventListener('keydown', openNotice);
  const link = list.querySelector('.bell-updates');
  if (link) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      closeNotices();
      openManage('modules');
    });
  }
  // Opening the list reads them: every unread notice is marked read.
  if (Object.values(unreadByModule).some((n) => n > 0)) {
    for (const key of Object.keys(unreadByModule)) unreadByModule[key] = 0;
    paintUnread();
    api('POST', '/api/notifications/read', {}).then(refreshUnderneath, () => {});
  }
}

export async function markModuleRead(moduleId) {
  unreadByModule[moduleId] = 0;
  paintUnread();
  try {
    await api('POST', '/api/notifications/read', { module: moduleId });
  } catch {
    // the count clears next load
  }
}

// The toasts (design system, Toasts and banners): one stack, .sdk-toasts, with the newest nearest the screen edge (the top on a desktop,
// the bottom on a phone). Three show at once; a fourth waits and comes in as one goes. A note goes after 4.5 s, a notice after 9 s, an
// invite after 60 s; a pointer or the focus on a toast waits its clock. The close button, or Escape on the toast, closes it.
const TOAST_SHOWING = 3;
const toastWaiting = [];
const toastCloseHtml = '<button type="button" class="sdk-icon-btn btn-quiet btn-small" data-toast-close aria-label="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>';
function toastStack() {
  let layer = document.getElementById('toast-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'toast-layer';
    layer.className = 'sdk-toasts';
    layer.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(layer);
  }
  return layer;
}
function closeToast(t) {
  if (t.gone) return;
  t.gone = true;
  clearTimeout(t.timer);
  t.el.dataset.state = 'leaving';
  setTimeout(() => {
    t.el.remove();
    const next = toastWaiting.shift();
    if (next) placeToast(next);
  }, 200);
}
function placeToast(spec) {
  const kind = spec.kind || 'info';
  const el = document.createElement('div');
  el.className = 'sdk-toast';
  el.dataset.kind = kind;
  el.setAttribute('role', kind === 'danger' ? 'alert' : 'status');
  const head = `<span class="sdk-toast-title">${escapeHtml(spec.title || '')}</span>${spec.text ? `<span class="sdk-toast-text">${escapeHtml(spec.text)}</span>` : ''}${spec.from ? `<span class="sdk-toast-text">${escapeHtml(spec.from)}</span>` : ''}`;
  el.innerHTML = `<span class="sdk-toast-icon" aria-hidden="true"><i class="fa-solid fa-${escapeHtml(spec.icon || 'circle-info')}"></i></span>`
    + (spec.onOpen ? `<button type="button" class="sdk-toast-body" data-toast-open>${head}</button>` : `<div class="sdk-toast-body">${head}</div>`)
    + `<div class="sdk-toast-end">${toastCloseHtml}</div>`
    + (spec.actions ? `<div class="sdk-toast-actions">${spec.actions}</div>` : '');
  const t = { el, left: spec.ms, started: 0, timer: 0, held: false, gone: false };
  const start = () => {
    if (t.held || t.gone) return;
    t.started = Date.now();
    clearTimeout(t.timer);
    t.timer = setTimeout(() => closeToast(t), t.left);
  };
  const hold = () => {
    if (t.gone) return;
    t.held = true;
    if (t.started) { t.left = Math.max(0, t.left - (Date.now() - t.started)); t.started = 0; }
    clearTimeout(t.timer);
  };
  el.addEventListener('mouseenter', hold);
  el.addEventListener('mouseleave', () => { if (!el.matches(':focus-within')) { t.held = false; start(); } });
  el.addEventListener('focusin', hold);
  el.addEventListener('focusout', () => { if (!el.matches(':hover') && !el.contains(document.activeElement)) { t.held = false; start(); } });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeToast(t); });
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-toast-close]')) return closeToast(t);
    if (spec.onClick && spec.onClick(e)) closeToast(t);
    else if (spec.onOpen && e.target.closest('[data-toast-open]')) { spec.onOpen(); closeToast(t); }
  });
  toastStack().prepend(el);
  start();
  return t;
}
// Shows a toast, or queues it behind the three showing.
function pushToast(spec) {
  const showing = [...toastStack().children].filter((e) => e.dataset.state !== 'leaving').length;
  if (showing >= TOAST_SHOWING) { toastWaiting.push(spec); return; }
  placeToast(spec);
}
// A page's own notice as a toast (a notice: 9 s), for a word the person must see wherever they are looking: `kind`
// 'danger' for a refusal or a failure, else 'info'.
export function noticeToast(title, { kind = 'info', icon = kind === 'danger' ? 'triangle-exclamation' : 'circle-info' } = {}) {
  if (title) pushToast({ kind, icon, title: String(title), ms: 9000 });
}

function showToast(n) {
  pushToast({
    kind: 'info',
    icon: n.icon || 'bell',
    title: n.title,
    text: n.body,
    from: n.moduleName || '',
    ms: 9000,
    onOpen: () => {
      if (manageTabOf(n)) return openManage(manageTabOf(n));
      // The call page handles opening a space module's panel; anything else goes to the module's page.
      const handled = !document.dispatchEvent(new CustomEvent('app:notification', { detail: n, cancelable: true }));
      if (!handled && n.scope === 'environment') window.location.href = `/modules/${encodeURIComponent(n.module)}`;
    },
  });
}

// A short note that goes away by itself (a module's "Saved in ...", host.ui.toast): a toast with a title only, never kept in the bell.
// It is said aloud once (role=status) and goes after 4.5 s, or when it is closed.
export function showNote(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!t) return;
  pushToast({ kind: 'info', icon: 'circle-info', title: t, ms: 4500 });
}

// A note with one button, "Undo", for `ms` milliseconds (Clear's 30 seconds). onUndo may fail: the note then says so.
export function undoToast(text, onUndo, ms = 30000) {
  pushToast({
    kind: 'info',
    icon: 'rotate-left',
    title: String(text ?? '').slice(0, 200),
    ms,
    actions: '<button type="button" class="btn btn-primary btn-small" data-undo>Undo</button>',
    onClick: (e) => {
      if (!e.target.closest('[data-undo]')) return false;
      Promise.resolve().then(onUndo).then(() => showNote('Brought back.'), (err) => noticeToast((err && err.message) || 'It could not be brought back.', { kind: 'danger' }));
      return true;
    },
  });
}

// A guest's page (a guest link, /guest/<token>, or a module it popped out, ?guest=): no account, so /api/me is not asked.
const isGuestPage = () => location.pathname.startsWith('/guest/') || new URLSearchParams(location.search).has('guest');
// GET /api/me, asked once per page and shared (the header's switch, the owner's banner): the answer, null for no
// account (a guest, or signed out), undefined when it could not be asked. `fresh` asks again.
let mePromise = null;
function loadMe(fresh = false) {
  if (!mePromise || fresh) {
    mePromise = isGuestPage()
      ? Promise.resolve(null)
      : fetch('/api/me').then((res) => (res.ok ? res.json() : res.status === 401 ? null : undefined)).catch(() => undefined);
    mePromise.then((me) => {
      if (me?.user?.role === 'guest') barInstall(); // an account whose role is guest: no install either
    });
  }
  return mePromise;
}

// The signed-in person's own light or dark (their account wins over what this browser remembers); a guest's is the
// browser's. See theme-mode.js.
async function loadAccountMode(fresh = false) {
  const me = await loadMe(fresh);
  if (me) setAccountMode(me.user);
  else if (me === null) setAccountMode(null);
  // undefined: unknown; the switch still works, and keeps the pick in this browser
}

async function startNotifications() {
  // A guest has no notices and no stream: it asks after the theme now and then.
  if (isGuestPage()) {
    watchThemeWithoutStream();
    return;
  }
  try {
    const res = await fetch('/api/notifications');
    if (res.status === 401) watchThemeWithoutStream(); // no account (a keyed page): no stream either
    if (!res.ok) return;
    Object.assign(unreadByModule, (await res.json()).byModule);
    paintUnread();
  } catch {
    return;
  }
  // An overlay over a call (?from=space) leaves the live stream to the call page, which passes a theme change down to it.
  if (new URLSearchParams(window.location.search).get('from') === 'space') return;
  const source = new EventSource('/api/notifications/stream');
  // The owner changed the theme or its default mode: the stylesheet is fetched again (GitHub #62).
  source.addEventListener('theme', (ev) => {
    try {
      themeChanged(JSON.parse(ev.data));
    } catch {
      // ignore a malformed event
    }
  });
  // This person picked light or dark on another page or device.
  source.addEventListener('mode', (ev) => {
    try {
      setAccountMode({ themeMode: JSON.parse(ev.data).themeMode });
    } catch {
      // ignore a malformed event
    }
  });
  // Back after a dropped connection: anything told while it was down is asked for again.
  let connected = false;
  source.addEventListener('open', () => {
    if (connected) {
      fetch('/api/branding').then((r) => (r.ok ? r.json() : null)).then((b) => b && setEnvironmentMode(b.themeMode, b.themeVersion)).catch(() => {});
      loadAccountMode(true);
    }
    connected = true;
  });
  // Someone asked you into a private conversation: join, or decline.
  source.addEventListener('invite', (ev) => {
    try {
      showInvite(JSON.parse(ev.data));
    } catch {
      // ignore a malformed event
    }
  });
  source.addEventListener('notification', (ev) => {
    try {
      const n = JSON.parse(ev.data);
      if (addToOpenNotices(n)) return; // the open list shows it, read
      unreadByModule[n.module] = (unreadByModule[n.module] || 0) + 1;
      paintUnread();
      showToast(n);
    } catch {
      // ignore a malformed event
    }
  });
}

// Tell the server this page is open (every half minute, and when it comes back into view), so the dashboard's
// Who's around can show who is online, not only who is in a space. Not in an overlay over a call: that page's
// own page is already doing it.
function startPresence() {
  if (new URLSearchParams(window.location.search).get('from') === 'space') return;
  const beat = () => {
    if (document.visibilityState === 'visible') fetch('/api/presence', { method: 'POST' }).catch(() => {});
  };
  beat();
  setInterval(beat, 30000);
  document.addEventListener('visibilitychange', beat);
}

// The toast for an invitation: who asked, and Join or Decline. The page can take it (the space page joins in place);
// any other page goes to the spaces page, which joins.
function showInvite(invite) {
  pushToast({
    kind: 'info',
    icon: 'people-arrows',
    title: `${invite.fromName || 'Someone'} invites you to talk`,
    text: 'A private conversation, off the record.',
    ms: 60000,
    actions: '<button type="button" class="btn btn-primary btn-small" data-invite="join">Join</button><button type="button" class="btn btn-small" data-invite="decline">Decline</button>',
    onClick: (e) => {
      const b = e.target.closest('[data-invite]');
      if (!b) return false;
      if (b.dataset.invite === 'join') {
        const taken = !document.dispatchEvent(new CustomEvent('app:invite-accept', { detail: invite, cancelable: true }));
        if (!taken) window.location.href = `/#join=${encodeURIComponent(invite.spaceId)}`;
      } else {
        fetch(`/api/asides/invite/${encodeURIComponent(invite.id)}/decline`, { method: 'POST' }).catch(() => {});
      }
      return true;
    },
  });
}

// The module updates available (modules that ship with this server newer than the one installed), on the bell for
// those who can act on them: owners and the admin (decision 9). Only they can ask; the Manage page calls
// setUpdateBadge again when it installs an update.
export function setUpdateBadge(count) {
  updatesWaiting = Math.max(0, Number(count) || 0);
  paintBell();
}
// What needs a look in Manage > Modules: updates plus new modules, as a green count on Manage (the profile menu, the
// phone menu, a page bar's link) and on that tab. Nothing at zero. The words repeat the number for a screen reader.
export function manageBadgeLabel(updates, fresh) {
  return [updates ? `${updates} ${updates === 1 ? 'update' : 'updates'} available` : '', fresh ? `${fresh} available` : ''].filter(Boolean).join(', ');
}
function manageBadgeItem() {
  const n = updatesWaiting + freshModules;
  return n ? { badge: n, badgeTone: 'ok', badgeLabel: manageBadgeLabel(updatesWaiting, freshModules) } : {};
}
function paintManageBadge() {
  const n = updatesWaiting + freshModules;
  const opts = n ? { tone: 'ok', label: manageBadgeLabel(updatesWaiting, freshModules) } : {};
  for (const id of ['admin-link', 'page-bar-manage']) nav.setBadge(id, n, opts);
}
export function setManageBadge(updates, fresh) {
  updatesWaiting = Math.max(0, Number(updates) || 0);
  freshModules = Math.max(0, Number(fresh) || 0);
  paintBell();
  paintManageBadge();
}
async function loadUpdateBadge() {
  try {
    const res = await fetch('/api/modules');
    if (!res.ok) return;
    const { bundled } = await res.json();
    setManageBadge((bundled || []).filter((b) => b.update).length, (bundled || []).filter((b) => !b.installed).length);
  } catch {
    // no count is fine
  }
}

// The header icon for a space: the launch-link icon the space picked, or the
// plain message icon when it has not picked one ('link' is the default).
export function spaceCrumbIcon(space) {
  return space?.linkIcon && space.linkIcon !== 'link' ? iconClasses(space.linkIcon) : 'fa-solid fa-message';
}

// The anchor's segments after the Spaces slot. Only the space page sets them (updateCrumb() in space.js: "› <space>",
// and an aside's "› <space> › <Aside word>: <names>"): the top bar holds places, not a breadcrumb (plan-two-zone-nav.md,
// decision 10). Every other page names itself in its page bar (renderPageBar() below), and on a phone in the anchor.
export function setTopbarLocation(html) {
  const crumb = byId('topbar-crumb');
  if (crumb) crumb.innerHTML = html ? `<span class="crumb-sep">&rsaquo;</span>${html}` : '';
}

// --- the page bar: the header's second row on every page but a space (plan-two-zone-nav.md, decision 10) ----------
// The row Calendar and Map have, shared: a `.subnav.page-bar` attached to the registry as the secondary bar, so it has
// the space bar's zones, look and fold. The left zone holds, in order: a Manage link (`manage`, the tab of Manage the
// page belongs to; owners and the admin only), the page's name (`name`, `icon`; not on a phone, where the anchor has
// it, and not when `showName` is false: Calendar and Map, whose top bar entry is marked current), then the page's own
// controls (`controls`: elements placed as they are, ids kept: Manage's tabs, `#subtabs`). A page's own tools register
// into it as any secondary tool does. On a phone the page's name is the anchor's plain label (pageAnchor() in
// primary-nav.js), painted again as the window crosses 640px; a bar left with nothing to show there is not drawn
// (style.css). Returns { el, setName(name, icon?) }; a second call on the same page only renames.
let pageBar = null;
export function renderPageBar({ name = '', icon = '', showName = true, manage = '', controls = [], id = 'page-bar', className = '' } = {}) {
  if (pageBar) {
    pageBar.setName(name, icon || undefined);
    return pageBar;
  }
  const header = document.querySelector('.topbar');
  if (!header) return null;
  const doc = header.ownerDocument;
  const el = doc.createElement('div');
  el.className = `subnav page-bar${className ? ` ${className}` : ''}`;
  el.id = id;
  el.setAttribute('role', 'navigation');
  el.setAttribute('aria-label', 'This page');
  el.innerHTML = '<div class="nav-left"></div><span class="nav-right"></span>';
  header.appendChild(el);
  nav.attach('secondary', el);
  // A control marked data-top-bar (the page's tabs: Manage, #262) goes in the top bar instead (page-tabs.js), as a space's
  // layout tabs do; the page's name is then the top bar's anchor at every width, and this row is left for navigation
  // inside a tab (what the page registers into the secondary bar), not drawn while it has nothing.
  const inBar = controls.filter((c) => c && c.hasAttribute('data-top-bar'));
  const state = { name: String(name || ''), icon: String(icon || ''), tabsInBar: inBar.length > 0 };
  if (state.tabsInBar) {
    pageTabsInBar = true;
    el.classList.add('page-bar-inside');
  }
  const iconHtml = (i) => (i ? `<i class="${i.includes(' ') ? escapeHtml(i) : `fa-solid fa-${escapeHtml(i)}`} fa-fw" aria-hidden="true"></i>` : '');
  let nameEl = null;
  if (showName) {
    nameEl = doc.createElement('span');
    nameEl.className = 'page-bar-name nav-text'; // the nav text; the current page's name, so in --header-text
    nameEl.id = 'page-bar-name';
    nav.register({ id: 'page-bar-name', bar: 'secondary', zone: 'left', group: 'page', groupOrder: 2, order: 1, fold: false, element: nameEl, visible: () => !onPhone() && Boolean(state.name) && !state.tabsInBar });
  }
  if (manage) {
    nav.register({ id: 'page-bar-manage', bar: 'secondary', zone: 'left', group: 'page-manage', groupOrder: 1, order: 1, fold: false, labelled: true, icon: 'gear', label: 'Manage', href: keepingQuery(manage), visible: () => seesUpdates(account?.role) });
    paintManageBadge();
  }
  for (const c of inBar) topBarTabs({ strip: c, label: state.name });
  controls.filter((c) => c && !inBar.includes(c)).forEach((c, i) => {
    c.classList.add('page-bar-control');
    nav.register({ id: c.id || `page-bar-control-${i + 1}`, bar: 'secondary', zone: 'left', group: 'page', order: 2 + i, fold: false, element: c });
  });
  const paint = () => {
    if (nameEl) {
      nameEl.innerHTML = `${iconHtml(state.icon)}<span class="page-bar-label"></span>`;
      nameEl.querySelector('.page-bar-label').textContent = state.name;
      nameEl.title = state.name;
    }
    paintPageAnchor(state);
    nav.draw('secondary');
    if (state.tabsInBar) nav.draw('primary'); // the Spaces slot leaves, and the anchor's width changed
  };
  if (phoneQuery) phoneQuery.addEventListener('change', paint);
  paint();
  pageBar = {
    el,
    setName(next, nextIcon) {
      state.name = String(next || '');
      if (nextIcon !== undefined) state.icon = String(nextIcon || '');
      paint();
    },
  };
  return pageBar;
}

// The anchor on a page with a page bar: nothing wider than a phone; on a phone the page's name, a plain label (not a
// link, no separator), current, cut short with an ellipsis as the anchor is (style.css), the whole name as its title.
// A page whose tabs are in the top bar has its name there at every width, before its tabs, as a space's name is.
function paintPageAnchor({ name, icon, tabsInBar = false }) {
  const crumb = byId('topbar-crumb');
  if (!crumb) return;
  const a = pageAnchor({ phone: onPhone(), name, icon }) || (tabsInBar ? pageAnchor({ phone: true, name, icon }) : null);
  crumb.replaceChildren();
  if (!a) return;
  const label = document.createElement('span');
  label.className = 'crumb-here'; // the nav text by the anchor's box (.crumb, style.css)
  label.setAttribute('aria-current', a.current);
  label.title = a.title;
  if (a.icon) {
    const i = document.createElement('i');
    i.className = `${a.icon.includes(' ') ? a.icon : `fa-solid fa-${a.icon}`} fa-fw`;
    i.setAttribute('aria-hidden', 'true');
    label.appendChild(i);
  }
  const text = document.createElement('span');
  text.className = 'crumb-label';
  text.textContent = a.label;
  label.appendChild(text);
  crumb.appendChild(label);
}

// Chrome/Edge's "Install as an app" prompt -- a chromeless window (Settings
// > Install, or here) with none of a browser tab's own address bar or tab
// strip. Shared so any page can offer it, not just the call page. It is an
// entry in the account menu (accountMenuItems(), and the phone menu's
// account-install), shown only while installPromptEvent is set; the phone
// entry's `visible` reads it, so the bar is redrawn when it changes.
//
// Guests get no install at all (Thomas, 2026-10-01): not on a guest link's page
// (isGuestPage()), and not for an account whose role is guest (loadMe() bars it
// once /api/me answers). The browser's prompt is still held back (no mini-infobar
// of its own), the event is not kept, and the page drops its manifest link so
// the browser has no app to offer.
let installPromptEvent = null;
let installBarred = false;
function barInstall() {
  installBarred = true;
  installPromptEvent = null;
  document.querySelectorAll('link[rel="manifest"]').forEach((link) => link.remove());
  nav.draw('primary');
}
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  if (installBarred) return;
  installPromptEvent = event;
  nav.draw('primary');
});
if (isGuestPage()) barInstall();
function wireInstall() {
  nav.draw('primary');
}
async function installFromPrompt() {
  if (!installPromptEvent || installBarred) return;
  installPromptEvent.prompt();
  await installPromptEvent.userChoice.catch(() => {});
  installPromptEvent = null;
  nav.draw('primary');
}

// A page opened with the server's access key instead of a sign-in (a module's keyed page, /view/<key>?s=...):
// every call the page makes carries the key, so nothing here needs a session.
let accessKey = '';
export function setAccessKey(key) {
  accessKey = String(key || '');
}
export function accessKeyHeaders() {
  return accessKey ? { 'x-stream-key': accessKey } : {};
}

export async function api(method, url, body, contentType, signal) {
  const headers = accessKeyHeaders();
  let payload = body;
  if (body !== undefined && !(body instanceof Blob)) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  } else if (body instanceof Blob) {
    headers['content-type'] = contentType || body.type;
  }
  const res = await fetch(url, { method, headers, body: payload, signal });
  let data = {};
  try {
    data = await res.json();
  } catch (err) {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.serverSaid = typeof data.error === 'string' && data.error !== ''; // the server's own sentence, not "HTTP 500"
    err.current = data.current; // set on a 409 from the module data store
    if (Array.isArray(data.problems)) err.problems = data.problems; // every problem with a template, not only the first
    throw err;
  }
  return data;
}

// Your profile or Manage, opened from inside a call (space.js loads either
// one in an iframe rather than navigating away, so the call underneath
// keeps running). Adds a "Back to [space]" link to this page's own header,
// which closes the overlay via the parent window -- same origin, so a
// direct call, no postMessage plumbing needed. A page that isn't "about"
// the space itself (Manage, say) can pass its own label instead of the
// space's name.
export function wireOverlayBack(label) {
  const params = new URLSearchParams(location.search);
  if (params.get('from') !== 'space' || window.parent === window) return;
  const nav = document.querySelector('.topbar nav.links');
  if (!nav) return;
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'btn btn-small';
  const spaceName = params.get('spaceName');
  back.textContent = label ? `← Back to ${label}` : spaceName ? `← Back to ${spaceName}` : '← Back';
  back.addEventListener('click', () => {
    try {
      window.parent.closeProfileOverlay?.();
    } catch (err) {
      // not actually framed by our own page for some reason; nothing to do
    }
  });
  nav.prepend(back);
}

// A password field is masked; a Show/Hide button beside it (the access key's pattern on the Manage page) reveals it:
// <button class="btn btn-small" type="button" data-reveal="the-input-id">Show</button>. A form reset masks it again.
function setRevealed(button, shown) {
  const field = document.getElementById(button.dataset.reveal);
  if (!field) return;
  field.type = shown ? 'text' : 'password';
  button.textContent = shown ? 'Hide' : 'Show';
  button.setAttribute('aria-pressed', String(shown));
}
// Masks a field again (after a save that empties it, say), its button back to Show.
export function maskPassword(id) {
  document.querySelectorAll(`button[data-reveal="${id}"]`).forEach((button) => setRevealed(button, false));
}
document.addEventListener('click', (event) => {
  const button = event.target.closest?.('button[data-reveal]');
  if (!button) return;
  event.preventDefault();
  setRevealed(button, document.getElementById(button.dataset.reveal)?.type === 'password');
});
document.addEventListener('reset', (event) => {
  event.target.querySelectorAll?.('button[data-reveal]').forEach((button) => setRevealed(button, false));
}, true);

export function initialsOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const text = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] || '?').slice(0, 2);
  return text.toUpperCase();
}
