// The primary nav's pure parts (documentation/plans/plan-primary-nav.md, "The bar" and step 2): which entries the
// profile menu has for an account, the host console's address, the space switcher's entries and what a pick does, the
// bell's count and words, and the breadcrumb's segments. brand.js and space.js draw them; nothing here touches a
// document, so tools/check-nav.mjs runs them in node.

// The profile menu's entries, in order, as a pure function of the account, the install and the browser's offer
// (decisions 4 and 17):
//   - every account: View profile, the light or dark switch, Install as an app while the browser offers it, Sign out last;
//   - every account: the environment's destinations (Calendar, Map: `dest-<id>` for each of `destinations`, the ids
//     GET /api/destinations lists), after the light or dark switch (plan-one-bar.md, decision 6: parked here for now,
//     out of the top bar, whose Calendar and Map are a space's views);
//   - an owner: Manage;
//   - the admin on a single install (not hosted): Manage only, which holds the server's settings there;
//   - the host admin's stand-in on a hosted server: Manage and Host console;
//   - a member (a moderator is a member with rights in a space): nothing more.
// No account, or a guest: no menu at all.
export function profileEntries({ role, hostAdmin = false, hosted = false, installOffered = false, themeSwitch = true, destinations = [] } = {}) {
  if (!role || role === 'guest') return [];
  const out = ['profile'];
  if (themeSwitch) out.push('theme');
  for (const id of Array.isArray(destinations) ? destinations : []) if (typeof id === 'string' && /^[a-z][a-z0-9-]{1,31}$/.test(id)) out.push(`dest-${id}`);
  if (role === 'owner' || role === 'admin') out.push('manage');
  if (role === 'admin' && hosted && hostAdmin) out.push('host-console');
  if (installOffered) out.push('install');
  out.push('sign-out');
  return out;
}

// An environment page's entry in the profile menu (Thomas, 2026-10-13): Global Calendar and Global Map, so they read apart
// from a space's own Calendar and Map. A name a template gave it keeps that name after the word Global.
const PROFILE_DEST_DEFAULTS = { calendar: ['Calendar', 'Global Calendar'], map: ['Map', 'Global Map'] };
export function profileDestinationLabel(id, name = '') {
  const shown = String(name || '').trim();
  const known = PROFILE_DEST_DEFAULTS[id];
  if (known && (!shown || shown === known[0] || shown === `${known[0]}s`)) return known[1];
  return `Global ${shown || id}`;
}

// Who sees the module update count on the bell: those who can act on it (decision 9), owners and the admin.
export const seesUpdates = (role) => role === 'owner' || role === 'admin';

// The host console's address, from an environment's own (<slug>.<base domain>, the console at admin.<base domain>).
// Null when it can't be worked out (a single install has no slug and no console).
export function hostConsoleUrl({ protocol = 'https:', hostname = '', port = '' } = {}, slug = '') {
  if (!slug || !hostname.toLowerCase().startsWith(`${String(slug).toLowerCase()}.`)) return null;
  const base = hostname.slice(String(slug).length + 1);
  if (!base) return null;
  return `${protocol}//admin.${base}${port ? `:${port}` : ''}/`;
}

// The space switcher (decision 15): the spaces the viewer belongs to, in the space list's order, never an aside and
// never the Lobby (Home's hidden backing, plan-home-lobby.md, decision 6: Home is reached by the Home link). Each
// says whether you are present there and how many are. `present` is the space you are present in (an aside's parent
// when you are in an aside), or null. Present somewhere in the list, the last entry is Leave for that space
// (plan-one-bar.md, step 5: `{ id, leave: true }`; the top bar's menu draws it last, and the space page leaves on a pick).
export function switcherEntries({ spaces = [], users = [], present = null } = {}) {
  const out = spaces
    .filter((s) => s && s.mine && !s.isAside && !s.isLobby) // the Lobby is Home itself (plan-home-lobby.md, step 2)
    .map((s) => ({
      id: s.id,
      name: s.name,
      here: s.id === present,
      count: users.filter((u) => isHere(u, s.id)).length,
    }));
  if (present && out.some((e) => e.here)) out.push({ id: present, leave: true });
  return out;
}

// Where a person is, as GET /api/presence tells this viewer (decision 6, step 3). `space` is a place the viewer
// belongs to, or null with `elsewhere: true` for one they don't. Someone in an aside reads as the aside's id with
// `aside: true` to the aside's own people (and owners and the admin), and as the parent space's id with `aside: true`
// to the rest of the parent's people: stepped out of that space, not in it. `aside` here says whether `spaceId` is
// itself an aside (then its own people, `aside: true`, are in it).
export function steppedOut(u, spaceId, { aside = false } = {}) {
  return Boolean(u && u.online && spaceId && !aside && u.aside && u.space === spaceId);
}
export function isHere(u, spaceId, { aside = false } = {}) {
  return Boolean(u && u.online && spaceId && u.space === spaceId && !steppedOut(u, spaceId, { aside }));
}

// A space card's count: "3 here · 2 in the call", "3 here", or "Nobody here". Those stepped out into an aside are not here.
export function hereCount(members = [], spaceId = null) {
  const here = members.filter((u) => isHere(u, spaceId));
  const calling = here.filter((u) => u.inCall).length;
  const people = here.length ? `${here.length} here` : 'Nobody here';
  return calling ? `${people} · ${calling} in the call` : people;
}

// Whether a member of the space I am in (`current`: { id, isAside }) gets the "In an aside" placeholder tile instead
// of nothing, and what it says: null for none, else { private, members } (`members`: who they are with, to name;
// never for a private one). Two ways to know: the person reads as stepped out of this space (the presence answer
// alone, for those not in the aside), or as in an aside listed in `spaces` (its own people, owners, the admin, or the
// aside-started message's entry). `started`, when given, is what the live stream's aside-started message said of the aside
// they went to ({ private, members }), the only way someone outside it learns who it is with. Private is the
// answer's own `asidePrivate` (so it holds after a reload), the aside record's, or the message's.
export function asidePlaceholder(u, current, spaces = [], started = null) {
  if (!u || !u.online || !current || !current.id) return null;
  if (steppedOut(u, current.id, { aside: Boolean(current.isAside) })) {
    const priv = Boolean(u.asidePrivate || (started && started.private));
    return { private: priv, members: started && !priv && Array.isArray(started.members) ? started.members : [] };
  }
  if (!u.space || u.space === current.id) return null;
  const record = spaces.find((r) => r && r.id === u.space);
  if (!record || !record.isAside) return null;
  const priv = Boolean(record.private || u.asidePrivate);
  return { private: priv, members: priv ? [] : record.members || [] };
}

// Where Who's around says someone is: "in <the space's name>" for a space I belong to, "in an aside" for an aside
// (stepped out of one of my spaces or in one of mine), "in another <space>" for a place I can't see, '' when online
// with no place. A private aside reads "in a private conversation". `spaces` holds the spaces and the asides the page
// knows (each aside with `isAside`); `words` the environment's words, from word(): { aside: word('aside', { a: true }),
// space: word('space') }. The aside is checked first: someone stepped out reads as their parent space's id, and must
// never read as in it.
export function whereWords(u, spaces = [], words = {}) {
  if (!u) return '';
  const record = u.space ? spaces.find((r) => r && r.id === u.space) : null;
  if (u.aside || (record && record.isAside)) return u.asidePrivate || (record && record.isAside && record.private) ? 'in a private conversation' : `in ${words.aside}`;
  if (u.elsewhere) return `in another ${words.space}`;
  return record ? `in ${record.name}` : '';
}

// Off stream: online, an owner online (otherwise there is no stream to be off), and not where the stream hears.
// `activeSpace` null means the stream is somewhere this viewer can't see (a space they don't belong to, or an aside
// they are not in): everyone they can place is off it, and those they can't (elsewhere, or stepped out into an aside
// they are not in) might be on it, so they are not marked. With the stream somewhere they can see, those are off it.
// `asideIds`: the asides the viewer can see (theirs; owners and the admin see all), whose people read as the aside's id.
export function offStream(u, activeSpace, ownerOnline, asideIds = []) {
  if (!u || !u.online || !ownerOnline) return false;
  const unknown = activeSpace === null || activeSpace === undefined;
  const unseen = Boolean(u.elsewhere) || (Boolean(u.aside) && !asideIds.includes(u.space));
  if (unseen) return !unknown;
  return u.space !== activeSpace;
}

// What a pick in the switcher does (decision 15, until the visit view): present nowhere, it enters; present in that
// space, it goes back to it; present in another, it enters (the visit view replaces this in a later step).
export function switchPick(present, id) {
  if (present && present === id) return 'back';
  return 'enter';
}

// How the space page opens a page asked for with app:open-page (decision 2, option (a)): the host console, another
// site, in a new tab; a module page over the space while present in one (home over the space included), and as a real
// page present nowhere, where nothing is lost; anything else (Manage, a new space, the updates line) over the page.
export function pageOpens({ kind = '', present = false } = {}) {
  if (kind === 'host-console') return 'new-tab';
  if ((kind === 'module' || kind === 'destination') && !present) return 'page';
  return 'overlay';
}

// Where a home tile sends one of its objects (plan-calendar-destination.md, decisions 16 and 20 to 22). `page` is where
// the tile's heading goes (the server's `href`): a destination the module is a part of while that shows (/calendar),
// else its module's page. Its own module's object goes to the destination, opened there (`#ref=`); with no destination
// shown (or another module's object), one in a space goes into that space (`how: 'space'`, `href` its module's page
// there, for a new tab), anything else to its module's page. Returns { how: 'page' | 'space', href }.
export function tileRefTarget(ref, { page = '', module = '' } = {}) {
  const hash = `#ref=${encodeURIComponent(JSON.stringify(ref))}`;
  page = String(page || '').split('#')[0]; // a panel's heading names its panel (#panel=); the pointer opens it anyway
  if (page && page.startsWith('/') && !page.startsWith('/modules/') && ref.module === module) return { how: 'page', href: page + hash };
  const q = ref.scope === 'space' && ref.space ? `?${new URLSearchParams({ space: ref.space })}` : '';
  return { how: ref.scope === 'space' && ref.space ? 'space' : 'page', href: `/modules/${encodeURIComponent(ref.module)}${q}${hash}` };
}

// The bell (decisions 9 and 18): its count is the unread module notices, and for owners and the admin the module
// updates too. `moduleWord` is the environment's word for a module.
export function bellState({ unread = 0, updates = 0, role = null, moduleWord = '' } = {}) {
  const u = Math.max(0, Number(unread) || 0);
  const m = seesUpdates(role) ? Math.max(0, Number(updates) || 0) : 0;
  let title = `Notifications, ${u} unread`;
  if (seesUpdates(role)) title += `, ${m} ${moduleWord} update${m === 1 ? '' : 's'}`;
  return { count: u + m, updates: m, title };
}

// The breadcrumb after the Spaces slot (decision 14): nothing on home; in a space, its name, current; in an aside, the
// parent's name (which does what Rejoin call does, decision 25), then "<Aside word>: <the other members' first names>",
// current. Each segment is { label, current, action? }.
export function crumbSegments({ space = null, parentName = '', asideWord = '', others = [] } = {}) {
  if (!space) return [];
  if (!space.isAside) return [{ label: space.name, current: true }];
  const firsts = others.map((n) => String(n || '').trim().split(/\s+/)[0]).filter(Boolean);
  const own = firsts.length ? `${asideWord}: ${firsts.join(', ')}` : asideWord;
  const out = [];
  if (parentName) out.push({ label: parentName, current: false, action: 'rejoin', title: `Rejoin call in ${parentName}` });
  out.push({ label: own, current: true });
  return out;
}

// What the anchor shows on any page but the space page (plan-two-zone-nav.md, decisions 7 and 10): the top bar holds
// places, not a breadcrumb, so wider than a phone nothing (a destination's entry is marked current, and the page bar
// names the rest); on a phone the page's name as a plain label (its icon and name, current, the whole name as its
// title), since the phone's bar names where you are in that place. Null for nothing.
export function pageAnchor({ phone = false, name = '', icon = '' } = {}) {
  const label = String(name || '').trim();
  if (!phone || !label) return null;
  return { label, icon: String(icon || ''), title: label, current: 'page' };
}

// What the anchor shows on the space page, from where the page is: the breadcrumb of the space it is in (crumbSegments),
// nothing while it shows home over a space it is still in (`viewingHome`, until the return pill of a later step), and
// for a guest who has not entered yet, the guest link's space. `viewingHome` only counts while there is a space:
// entering any space shows that space's breadcrumb whatever was on screen before.
export function anchorSegments({ space = null, viewingHome = false, guestSpaceName = '', ...rest } = {}) {
  if (!space) return guestSpaceName ? [{ label: guestSpaceName, current: true }] : [];
  if (viewingHome) return [];
  return crumbSegments({ space, ...rest });
}

// Where a home tile's heading goes (dashboard.js): the server's `href`, a path on this server, with a panel's
// `#panel=<module id>` when the module is a destination's panel; anything else, its module's page. Returns { page, path }:
// `page` the whole address (the heading), `path` without the hash (a widget's own place is added to that).
export function tileHeading(href, id) {
  const own = `/modules/${encodeURIComponent(id)}`;
  if (typeof href !== 'string' || !/^\/[A-Za-z0-9/_-]*(#panel=[a-z0-9][a-z0-9_-]{0,63})?$/.test(href)) return { page: own, path: own };
  return { page: href, path: href.split('#')[0] };
}

// A destination page's `#panel=<module id>` (a panel tile's heading, plan-calendar-destination.md): the panel to show,
// as `panel:<id>` when it is one of `panelKeys`, else '' (unknown or unreadable: ignored). `rest` is the hash without
// it, for the rest of the page's places (#ref=, #day=). `hash` is location.hash without its '#'.
export function hashPanel(hash, panelKeys = []) {
  const bits = String(hash || '').split('&');
  const at = bits.findIndex((b) => b.startsWith('panel='));
  if (at < 0) return { key: '', found: false, rest: String(hash || '') };
  let id = '';
  try {
    id = decodeURIComponent(bits[at].slice(6));
  } catch {
    id = '';
  }
  bits.splice(at, 1);
  const key = /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) && panelKeys.includes(`panel:${id}`) ? `panel:${id}` : '';
  return { key, found: true, rest: bits.join('&') };
}

// The destinations (plan-calendar-destination.md, "The bar's entry"; plan-map-destination.md): one entry per
// destination GET /api/destinations lists for this viewer, in its order, each its main module's name and icon as this
// environment shows them. The `bar` entry (`dest-<id>`, the core links' look, a left-zone tool in the
// group `where`) is no longer drawn in the top bar: in a space Calendar and Map are layout tabs (layoutTabs() below) (plan-one-bar.md,
// decision 6: the environment's Calendar and Map are in the profile menu, profileEntries()). On a phone an entry in the
// menu after the Spaces slot's entries (`menu-dest-<id>`, in their group, before New <space>). `current`
// while that page is open (`path` is the page's own). `overlay` while present in a space, so the space page opens it
// over the space as a page (data-overlay-link, Away while on the call). Anything malformed in the list is left out.
export function destinationTools(list, { path = '', present = false } = {}) {
  const ok = (d) => d && /^[a-z][a-z0-9-]{1,31}$/.test(d.id || '') && typeof d.name === 'string' && d.name.trim()
    && typeof d.href === 'string' && /^\/[a-z][a-z0-9-]*$/.test(d.href);
  return (Array.isArray(list) ? list : []).filter(ok).slice(0, 8).map((d, i) => {
    const shared = { icon: /^[a-z0-9-]{1,40}$/.test(d.icon || '') ? d.icon : 'puzzle-piece', label: d.name.trim().slice(0, 40), href: d.href, current: path === d.href, overlay: Boolean(present) };
    return {
      bar: { id: `dest-${d.id}`, zone: 'left', group: 'where', groupOrder: 1, order: 1 + i, ...shared },
      menu: { id: `menu-dest-${d.id}`, zone: 'right', group: 'menu-where', order: 950 + i, ...shared },
    };
  });
}

// The layout tabs in the top bar's left zone, right after the space switcher (plan-layout-views.md, decisions 1, 2, 5,
// 13 and 17, step 2): every view is a layout. The Workspace first, always (it can be renamed, never left out); then
// the system layouts Calendar and Map while the server lists them for this space and the person keeps their tab
// (`tab` not false); then the person's favorite saved layouts in the order they were favorited, with no limit. `system`
// is GET /api/spaces/:id/layouts's `system` list, `favorites` its favorite ids, `layouts` its shared and own layouts
// (a favorite not among them is left out). A guest and an aside have none (decision: no tabs there); neither does a
// page outside a space. `current` is the id of the layout shown. Returns [{ id: 'layout-tab-<layout id>', layout, kind,
// icon, label, current, temp? }]; the ids are the tabs' element ids.
const TAB_ICON = /^[a-z0-9-]{1,40}$/;
const SYSTEM_TAB_DEFAULTS = { workspace: ['Workspace', 'columns'], calendar: ['Calendar', 'calendar-days'], map: ['Map', 'map-location-dot'] };
export function layoutTabs({ system = [], favorites = [], layouts = [], current = 'workspace', guest = false, aside = false, space = '' } = {}) {
  // A guest keeps no favorites: the Workspace, then every shared layout the list holds, to switch between, read-only.
  if (aside || !space) return [];
  const name = (s, fallback) => String((s && s.name) || '').trim().slice(0, 40) || fallback;
  const icon = (s, fallback) => (s && TAB_ICON.test(s.icon || '') ? s.icon : fallback);
  const list = Array.isArray(system) ? system.filter((s) => s && SYSTEM_TAB_DEFAULTS[s.id]) : [];
  const ws = list.find((s) => s.id === 'workspace') || null;
  const out = [{ layout: 'workspace', kind: 'system', icon: icon(ws, 'columns'), label: name(ws, 'Workspace') }];
  for (const s of list) {
    if (s.id === 'workspace' || s.tab === false || out.some((t) => t.layout === s.id)) continue;
    const [word, glyph] = SYSTEM_TAB_DEFAULTS[s.id];
    out.push({ layout: s.id, kind: 'system', icon: icon(s, glyph), label: name(s, word) });
  }
  const known = Array.isArray(layouts) ? layouts.filter((l) => l && typeof l.id === 'string') : [];
  for (const id of guest ? known.map((l) => l.id) : Array.isArray(favorites) ? favorites : []) {
    const l = known.find((x) => x.id === id);
    if (!l || SYSTEM_TAB_DEFAULTS[id] || out.some((t) => t.layout === id)) continue;
    out.push({ layout: id, kind: 'user', icon: icon(l, 'object-group'), label: name(l, 'Layout') });
  }
  // Any layout can be the one shown: a saved one that is not pinned (not a favorite) gets a temporary tab while it is
  // shown, with its name; it is gone when another layout is shown. Not stored.
  if (current !== 'workspace' && !out.some((t) => t.layout === current)) {
    const l = known.find((x) => x.id === current);
    if (l && !SYSTEM_TAB_DEFAULTS[current]) out.push({ layout: current, kind: 'user', icon: icon(l, 'object-group'), label: name(l, 'Layout'), temp: true });
  }
  return out.map((t) => ({ id: `layout-tab-${t.layout}`, ...t, current: t.layout === current }));
}

// Which layout tabs stay in the bar when it is tight (plan-layout-views.md, decisions 11, 14 and 17): all of them while
// they fit side by side in `avail`; else the tabs leave from the right, one at a time, into a "..." after the last one
// shown, as many staying as fit with the "..." (`more`, its width) beside them. The Workspace (the first tab) and the
// tab shown now (`current`, its index; -1 for none) never leave (Thomas, 2026-10-13): they stay even where nothing
// else fits, and the bar's other tools give way after them. Tabs are never shortened. `widths` are the tabs' widths in
// order, `gap` the space between two neighbours. Gives { out, count, more }: the indexes of the tabs in the "...", in
// order, how many tabs show, and whether the "..." shows. Pure, for check-nav.
export function tabOverflow({ avail, gap = 0, widths = [], more = 0, current = -1 } = {}) {
  const limit = Number.isFinite(avail) ? avail : Infinity;
  const n = widths.length;
  const row = (list) => list.reduce((sum, i) => sum + widths[i], 0) + gap * Math.max(0, list.length - 1);
  const all = widths.map((_, i) => i);
  if (row(all) <= limit + 0.5) return { out: [], count: n, more: false };
  const pinned = (i) => i === 0 || i === current;
  const others = all.filter((i) => !pinned(i));
  if (!others.length) return { out: [], count: n, more: false }; // nothing that may leave
  let keep = others.length - 1;
  const shownWith = (k) => all.filter((i) => pinned(i) || others.slice(0, k).includes(i));
  while (keep > 0 && row(shownWith(keep)) + gap + more > limit + 0.5) keep -= 1;
  const out = others.slice(keep);
  return { out, count: n - out.length, more: true };
}

// The icons a layout may wear (plan-layout-views.md, decision 4 and "Icons", step 4): what Change icon's grid offers.
// The defaults first (the Workspace's, the Layout button's, Calendar's and Map's as this environment shows them, from
// GET .../layouts's `system` list), then the environment's own icon list (Manage > Theme, brand.js getIcons()), only
// the ones drawn as `fa-solid fa-<id>` (the way the tabs and the menu draw an icon; the server takes these), then the
// layout's current icon if it is none of those, so it is always there to be marked. Each { id, label }: the label is
// what a screen reader hears for it (the list's own label, else the id's words). Nothing malformed, nothing twice. Pure.
const LAYOUT_ICON_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export function layoutIconChoices({ icons = [], system = [], current = '' } = {}) {
  const out = new Map();
  const add = (id, label) => {
    if (typeof id !== 'string' || !LAYOUT_ICON_ID.test(id) || out.has(id)) return;
    const words = typeof label === 'string' && label.trim() ? label.trim().slice(0, 40) : id.replace(/-/g, ' ');
    out.set(id, words);
  };
  add('columns');
  add('object-group');
  for (const s of Array.isArray(system) ? system : []) if (s) { add(s.defaultIcon); add(s.icon); }
  add('calendar-days');
  add('map-location-dot');
  for (const i of Array.isArray(icons) ? icons : []) {
    if (!i || typeof i.id !== 'string') continue;
    const tokens = String(i.classes || '').split(/\s+/).filter((t) => t && !/^fa-(fw|lg|xs|sm|2x|3x)$/.test(t));
    if (tokens.length === 2 && tokens.includes('fa-solid') && tokens.includes(`fa-${i.id}`)) add(i.id, i.label);
  }
  add(current);
  return [...out].map(([id, label]) => ({ id, label }));
}

// Whether an icon answers a search in Change icon's grid: every word typed is in its label or its id. Pure.
export function iconMatches(choice, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${choice?.label || ''} ${choice?.id || ''} ${String(choice?.id || '').replace(/-/g, ' ')}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

// Where an arrow key moves in a grid of `count` icons drawn `columns` to a row (the radiogroup's keys, as a radio
// group's): Left and Right one step, wrapping round the ends; Up and Down a row, staying put at the top or bottom
// edge; Home and End the first and the last. Returns the new index, or -1 for a key that is not one of these. Pure.
export function gridStep(index, key, count, columns) {
  if (!(count > 0)) return -1;
  const cols = Math.max(1, Math.floor(columns) || 1);
  const at = Math.min(Math.max(0, Math.floor(index) || 0), count - 1);
  switch (key) {
    case 'ArrowRight': return (at + 1) % count;
    case 'ArrowLeft': return (at - 1 + count) % count;
    case 'ArrowDown': return at + cols < count ? at + cols : at;
    case 'ArrowUp': return at - cols >= 0 ? at - cols : at;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return -1;
  }
}
