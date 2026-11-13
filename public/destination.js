// A destination's page (/calendar, /map; plan-calendar-destination.md and plan-map-destination.md): a host page made of
// modules' parts. GET /api/destinations/<id> names the parts (a `main`, and panels in their order); this page is one module
// frame (public/module-frame.js; plan-unified-layout.md, "Bands everywhere"): its title bar (the page's name, the parts'
// "+" and icons), one toolbar row (the main part's items, the page's view switch, its filters and its search, the panel's
// switch and the shown panel's items), the parts in its content and one status bar (the main part's, then the shown
// panel's). It mounts each
// part with mountModule() at environment scope, and keeps the one shared state every part draws from
// (createDestination() in module-host.js; the parts read it with host.destination.onState). The page names
// destinations, never modules: a module takes part by declaring a part (surfaces.destination).
//
// Remembered in this browser (decision 18): the view, the filter and the panel's tab, under app.destination.<id>. On a
// phone (640 px or less, not in a frame) the main part and each panel are tabs along the bottom, the view switch shows only on the
// main part's tab, and the first view is the phone's own (Day for the calendar) until one is picked.
//
// As a view of one space (?space=<id>; plan-calendar-todo.md and plan-map-places.md, step 1): the same page with the
// parts mounted at space scope (a guest with the space's token too), no space filter, no Mine and no other calendars
// (plan-google-calendar.md's rule), the view switch and the marker kinds kept, its choices remembered under
// app.destination.<id>.<space id>. The map in a space (plan-map-places.md, step 2) keeps a filter of whose places show:
// This <space> (on), Mine (on) and the environment's own (off at first), under the same key. Shown in a frame (a
// composite's on the space's canvas, which the Calendar and Map layout tabs show; `window.self !== window.top`) it draws
// no top bar of its own; in a composite's frame its own frame has no title bar and no status bar either: the composite's
// window on the Workspace holds the parts' "+" and icons and the status bar; the toolbar row is this page's, the first
// thing in it.
import { loadBranding, api, wireOverlayBack, renderTopbar, word, withinSpacePage } from '/brand.js';
import { mountModule, createDestination, askCanvasToOpen, sameSiteOpener, createFrameBands } from '/module-host.js';
import { createModuleFrame } from '/module-frame.js';
import { hashPanel } from '/primary-nav.js';
import { dropRepeatedAdds } from '/module-chrome.js';
import { moduleTint } from '/module-tint.js';

const $ = (id) => document.getElementById(id);
const destId = decodeURIComponent(location.pathname.split('/')[1] || '').toLowerCase(); // /CALENDAR is /calendar
const phoneQuery = window.matchMedia('(max-width: 640px)');
const params = new URLSearchParams(location.search);
const spaceId = /^[A-Za-z0-9_-]{1,80}$/.test(params.get('space') || '') ? params.get('space') : ''; // a view of this space
const guestToken = spaceId && params.get('guest') ? params.get('guest') : null; // a guest's link token, in a space only
// A guest from the guest door has no token in the address: their cookie is their credential. Told apart in start(), by asking
// the door; a guest of either kind is `guestMode`.
let guestMode = Boolean(guestToken);
const embedded = window.self !== window.top;
// A phone is the page opened on its own at 640 px or less. In a frame (a docked column, a narrow window) it is narrow, not a
// phone: the panel stacks below the main part (destination.css), with no tabs.
const onPhone = () => !embedded && phoneQuery.matches;
const withoutTopbar = Boolean(spaceId) && embedded; // a view in the space page's frame: its bar is the one bar
// In a composite's frame on a space's Workspace (canvas.js marks that frame data-composite; plan-module-titlebar-add.md):
// the composite's titlebar holds the one "+" and its window the status bar. The parts' adds and status lines are
// gathered here and handed up (sendChrome); the parts hide their own big add buttons, as they do under a titlebar. Not
// on the top-level /calendar and /map, where the parts keep their own.
const inComposite = (() => {
  try {
    return embedded && Boolean(window.frameElement && window.frameElement.hasAttribute('data-composite'));
  } catch {
    return false;
  }
})();
// The guest's token on this page's own calls (the parts' calls carry it through mountModule).
const withGuest = (url) => (guestToken ? `${url}${url.includes('?') ? '&' : '?'}guest=${encodeURIComponent(guestToken)}` : url);

// What each destination's toolbar row holds. `views`: the view switch (none: no switch). `phoneView`: the first view on a
// phone. `firstView(values)`: the first view on a wider screen, from the main part's own settings (the calendar's
// "Open on": Week for Week, Month otherwise). `mine`: the filter has the person's own first (Mine). `external`: the
// filter lists the person's own other calendars after the spaces (plan-google-calendar.md, Part 2), each with its tint.
// `markers`: the filter lists the kinds of markers the main part has shown ("Tasks due", "Polls closing";
// plan-calendar-markers.md), after the spaces, each with its module's icon and tint. `search`: a search
// field on the right of the page bar, its words by whether the panel's place search is set up (`searchSetUp(values)`,
// the panel's settings). `initial`: the rest of the state the parts read. `needsWebgl`: the main part draws with WebGL,
// and without it the panel takes the page's width (the main part shows its own notice above it). `spaceFilter`: in a
// space the filter stays, as This <space>, Mine and the environment's own (the last off at first).
const KINDS = {
  calendar: {
    views: [{ id: 'month', label: 'Month', icon: 'calendar-days' }, { id: 'week', label: 'Week', icon: 'calendar-week' }, { id: 'day', label: 'Day', icon: 'calendar-day' }],
    phoneView: 'day',
    // Month, Week or Day as "Open on" says; the Agenda (`list`) and an old stored Month + list (`both`) open on Month here.
    firstView: (values) => (values && ['month', 'week', 'day'].includes(values.defaultView) ? values.defaultView : 'month'),
    // "Open on: Agenda" opens the calendar's own Agenda panel (the Agenda is a panel here, not a view of the calendar).
    openPanel: (values) => (values && values.defaultView === 'list' ? 'calendar' : null),
    external: true,
    markers: true,
    // The row's zones (Thomas, 2026-11-02): on the left the date group (the calendar's own title, back, Today, forward), then
    // the Month / Week / Day switch; at the far right, never moved into More, the panel's switch (Agenda / To-do) with the
    // shown panel's own items before it. The Filters button sits between, after the free space.
    zones: true,
  },
  map: {
    views: [],
    mine: true,
    search: {
      label: 'Find a place',
      placeholder: 'Find a place',
      filterOnly: 'Filter places',
    },
    searchSetUp: (values) => Boolean(values && values.searchProvider && values.searchProvider !== 'none'),
    initial: { q: '', find: 0, selected: null },
    needsWebgl: true,
    spaceFilter: true,
  },
};
const kind = KINDS[destId] || { views: [] };

// --- remembered in this browser ------------------------------------------------------------------
const KEY = `app.destination.${destId}${spaceId ? `.${spaceId}` : ''}`;
function remembered() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
function remember(patch) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...remembered(), ...patch }));
  } catch {
    // no storage: nothing is remembered
  }
}

// The environment's own list in the filter, beside the spaces (whose ids never start with a colon).
const OWN = ':own';
const MINE = ':mine'; // the person's own (the map's Mine)
const HERE = ':here'; // this space's own, in a space (the map's This <space>)
const EXTERNAL = ':external:'; // one of the person's other calendars, by its id after this
const MARKER = ':marker:'; // a kind of marker, by its '<module>:<kind>' after this
// Each other calendar's tint, by its place in the person's list: the same order the Calendar draws them in.
const EXTERNAL_TINTS = ['blue', 'teal', 'purple', 'green', 'orange'];

let hub = null;
let parts = []; // { part, key, holder, wrap, mounted, adds, status, header, toolbar }
let tab = 'main'; // on a phone: 'main', or a panel's key
let panel = ''; // on a wider screen: the panel shown
let view = '';
let spaces = []; // [{ id, name, icon }] in the space list's order
const off = new Set(); // spaces the filter has off
let ownOn = true;
let mineOn = true;
let hereOn = true; // in a space, with a filter there: this space's own
// The filter in a space: This <space>, Mine and the environment's own (a guest has no Mine).
const spaceFilter = () => Boolean(spaceId && kind.spaceFilter);
const spaceFilterHasMine = () => spaceFilter() && !guestMode;
let externals = []; // the person's other calendars: [{ id, name }], in their order
const externalOff = new Set(); // other calendars the filter has off
let markerKinds = []; // the kinds of markers the calendar has shown: [{ id, label, icon, tint }], remembered here
const markersOff = new Set(); // kinds of markers the filter has off
let find = 0;
let searchText = ''; // what is typed in the row's search (the map)
let searchWords = ''; // its placeholder: the filter's words, or the place search's once that is set up
let filterShown = false; // the filter is in the row (a destination with one; in a space only once there is a kind to switch)
let page = null; // the page's frame (createModuleFrame): its title bar, its one row, the parts, its status bar
let bands = null; // the parts' "+", title bar icons, row and status drawn in it (createFrameBands)
let side = null; // the panel's own frame: only its row, while the panel is stacked under the main part
let sideBands = null;
const stackedQuery = window.matchMedia('(max-width: 900px)'); // destination.css stacks the panel under the main part
let d = null; // the destination, as the server answered

function missing(text) {
  const note = $('dest-missing');
  note.textContent = text;
  note.hidden = false;
}

async function start() {
  if (spaceId) document.body.classList.add('dest-in-space');
  if (withoutTopbar) document.body.classList.add('dest-no-topbar');
  if (inComposite) document.body.classList.add('dest-in-composite');
  else renderTopbar({ location: '' });
  await loadBranding();
  if (!withoutTopbar) wireOverlayBack();
  if (!guestToken) {
    let me = null;
    try {
      me = (await api('GET', '/api/me')).user;
    } catch {
      // No account: a guest from the door may look at a space's page (the server answers for them by the cookie). Anyone
      // else goes to sign in, or, in a frame, is told in words: a window never shows the sign-in page.
      if (spaceId) {
        try { await api('GET', '/api/guest-door'); guestMode = true; } catch { /* not a guest either */ }
      }
      if (!guestMode) {
        if (embedded) { missing('Your session has ended. Reload the page.'); return; }
        location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
        return;
      }
    }
    if (me && $('whoami')) {
      $('whoami').textContent = me.displayName;
      $('whoami-img').src = `/img/${encodeURIComponent(me.key)}/profile`;
      $('whoami-img').hidden = false;
    }
  }

  try {
    d = await api('GET', withGuest(`/api/destinations/${encodeURIComponent(destId)}${spaceId ? `?space=${encodeURIComponent(spaceId)}` : ''}`));
  } catch (err) {
    if (err.status === 404) missing(spaceId && err.serverSaid ? err.message : 'This page is not in your top bar.');
    else missing(`This page could not open: ${err.message}`);
    return;
  }
  document.title = `${document.title.split(' - ')[0]} - ${d.name}${d.space?.name ? ` - ${d.space.name}` : ''}`;

  // Where it starts: what this browser remembers, else the phone's own first view or the main part's choice.
  const saved = remembered();
  spaces = (d.spaces || []).map((r) => ({ id: r.id, name: r.name, icon: r.icon }));
  for (const id of Array.isArray(saved.off) ? saved.off : []) if (typeof id === 'string') off.add(id);
  // The environment's own: on at first in the aggregate, off at first in a space (plan-map-places.md).
  ownOn = spaceFilter() ? saved.ownOff === false : saved.ownOff !== true;
  mineOn = saved.mineOff !== true;
  hereOn = saved.hereOff !== true;
  for (const id of Array.isArray(saved.externalOff) ? saved.externalOff : []) if (typeof id === 'string') externalOff.add(id);
  if (kind.markers) {
    markerKinds = cleanMarkerKinds(saved.markerKinds);
    for (const id of Array.isArray(saved.markersOff) ? saved.markersOff : []) if (typeof id === 'string') markersOff.add(id);
  }
  // Never shown over a call (?from=space in the space page's frame), where others may see the screen, nor in a space.
  if (kind.external && !spaceId && !withinSpacePage()) await loadExternals();
  let settings = null; // the main part's own settings (the calendar's "Open on"), once asked for
  const askSettings = async () => {
    try {
      settings = (await api('GET', withGuest(`/api/modules/${encodeURIComponent(d.main.module.id)}/settings/values?${placeQuery()}`))).values || {};
    } catch {
      settings = {};
    }
    return settings;
  };
  if (kind.views.some((v) => v.id === saved.view)) view = saved.view;
  else if (kind.views.length && onPhone()) view = kind.phoneView;
  else if (kind.views.length) {
    view = kind.firstView(await askSettings());
  }
  const keyOf = (p) => (p.part === 'main' ? 'main' : `panel:${p.module.id}`);
  const panelKeys = (d.panels || []).map(keyOf);
  panel = panelKeys.includes(saved.panel) ? saved.panel : panelKeys[0] || '';
  // "Open on: Agenda" (the calendar's setting) opens the Agenda panel beside the calendar, whatever panel was left open last; a
  // link to a panel (#panel=) still wins (takeHash). On a phone the parts are tabs and the main part's view stays first.
  if (kind.openPanel && !onPhone()) {
    const wanted = kind.openPanel(settings || await askSettings());
    if (wanted && panelKeys.includes(`panel:${wanted}`)) panel = `panel:${wanted}`;
  }
  tab = saved.tab === 'main' || panelKeys.includes(saved.tab) ? saved.tab : 'main';

  hub = createDestination(destId, { ...(kind.initial || {}), ...(view ? { view } : {}), ...filterState(), phone: onPhone() });
  // On a phone the parts are tabs: a part's `reveal` shows that part, and a place chosen in the list (a panel's tab)
  // shows the map with it selected (plan-map-destination, "Phones").
  let lastSelected = JSON.stringify(hub.state.selected ?? null);
  hub.onChange((st) => {
    if (st.reveal === 'main' || st.reveal === 'panel') {
      const key = st.reveal === 'main' ? 'main' : parts.find((p) => p.key !== 'main')?.key;
      hub.update({ reveal: null });
      if (key) show(key);
      return;
    }
    if (kind.markers && Array.isArray(st.markerKinds)) takeMarkerKinds(st.markerKinds);
    const sel = JSON.stringify(st.selected ?? null);
    if (sel === lastSelected) return;
    lastSelected = sel;
    if (onPhone() && st.selected && tab !== 'main' && 'selected' in (kind.initial || {})) show('main');
  });
  // Without WebGL a map part shows only its notice: the panel takes the page's width (plan-map-destination, "States").
  if (kind.needsWebgl && !webglWorks()) document.body.classList.add('dest-no-webgl');
  drawFrame(d, await mainModuleTint());
  drawTabs(d);
  stackedQuery.addEventListener('change', drawRow);
  if (kind.search) loadSearchWords(d);

  // The parts: the main one fills the page; each panel in the panel, one shown at a time.
  $('dest-main').setAttribute('aria-label', d.main.label || d.name);
  parts.push(mountPart(d.main, $('dest-main'), 'main'));
  for (const p of d.panels || []) {
    const wrap = document.createElement('div');
    wrap.className = 'dest-side-part';
    wrap.id = `dest-${keyOf(p).replace(':', '-')}`;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', p.label);
    $('dest-side-body').appendChild(wrap);
    parts.push(mountPart(p, wrap, keyOf(p)));
  }
  layout();
  phoneQuery.addEventListener('change', () => {
    layout();
    hub.update({ phone: onPhone() });
  });

  // Opened at a place: a day (#day=, from home's tile) for the main part, or an object (#ref=).
  takeHash();
  window.addEventListener('hashchange', takeHash);
}

// The title bar's icon wears the main module's tint, as on its own page (/modules/<id>): the manifest's colour, else a stable
// pick from its id. The colour comes from the modules list a guest cannot read: then the pick from the id alone.
async function mainModuleTint() {
  const id = d.main.module.id;
  if (!guestMode) {
    try {
      const found = (await api('GET', '/api/modules/nav')).modules.find((m) => m.id === id);
      if (found) return moduleTint(id, found.color || null);
    } catch {
      // the pick from the id, then
    }
  }
  return moduleTint(id, null);
}

// The place this page's own calls name: the space it is a view of, else the environment.
const placeQuery = () => (spaceId ? `scope=space&space=${encodeURIComponent(spaceId)}` : 'scope=environment');

// The filter's choice as the shared state has it: the spaces on, and whether the environment's own are. In a space
// there is no choice: that one space, not the environment's own, not Mine, no other calendars; the marker kinds stay.
// The map's filter in a space (`spaceFilter`) chooses among this space, Mine and the environment's own.
function filterState() {
  if (spaceFilter()) return { mine: spaceFilterHasMine() && mineOn, spaces: hereOn ? [spaceId] : [], space: spaceId, environment: ownOn };
  if (spaceId) return { ...(kind.mine ? { mine: false } : {}), spaces: [spaceId], space: spaceId, environment: false, ...(kind.external ? { externalOff: [] } : {}), ...(kind.markers ? { markersOff: [...markersOff] } : {}) };
  return { ...(kind.mine ? { mine: mineOn } : {}), spaces: spaces.filter((r) => !off.has(r.id)).map((r) => r.id), environment: ownOn, ...(kind.external ? { externalOff: [...externalOff] } : {}), ...(kind.markers ? { markersOff: [...markersOff] } : {}) };
}

// The kinds of markers, as remembered or as the calendar said (createDestination checked its shape): kept in the order
// first seen, a kind the calendar names again taking its newer label, icon and tint.
const MARKER_TINTS = ['gold', 'blue', 'green', 'teal', 'purple', 'red', 'orange', 'pink'];
function cleanMarkerKinds(list) {
  return (Array.isArray(list) ? list : []).filter((k) => k && typeof k.id === 'string' && typeof k.label === 'string' && k.label).slice(0, 20)
    .map((k) => ({ id: k.id.slice(0, 81), label: k.label.slice(0, 40), icon: typeof k.icon === 'string' ? k.icon : '', tint: MARKER_TINTS.includes(k.tint) ? k.tint : null }));
}
function takeMarkerKinds(list) {
  const next = [...markerKinds];
  for (const k of cleanMarkerKinds(list)) {
    const at = next.findIndex((x) => x.id === k.id);
    if (at >= 0) next[at] = k; else next.push(k);
  }
  if (JSON.stringify(next) === JSON.stringify(markerKinds)) return;
  markerKinds = next.slice(0, 20);
  remember({ markerKinds });
  drawRow(); // a kind the calendar shows for the first time: a chip now, and in the folded words
}

// The person's own other calendars, for the filter: none while the environment does not allow them.
async function loadExternals() {
  try {
    const got = await api('GET', '/api/me/external-calendars');
    externals = got && got.allowed ? (got.calendars || []).map((c) => ({ id: String(c.id), name: String(c.name || '') })) : [];
  } catch {
    externals = [];
  }
}

// Whether this browser can draw with WebGL, as a map part asks it.
function webglWorks() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

// The row's search (the map): typing filters what the parts show (`q`); Enter asks the place search (`find`, raised each
// time); Escape clears it. A pasted position or map link is the parts' to read from `q`. Its words say whether Enter finds
// new places too: only with a place search set up (the panel's own settings).
async function loadSearchWords(dest) {
  searchWords = kind.search.filterOnly;
  const panelPart = (dest.panels || [])[0];
  if (!panelPart) return;
  try {
    const values = (await api('GET', withGuest(`/api/modules/${encodeURIComponent(panelPart.module.id)}/settings/values?${placeQuery()}`))).values || {};
    if (kind.searchSetUp(values)) { searchWords = kind.search.placeholder; drawRow(); }
  } catch {
    // the filter's words, then
  }
}

function mountPart(part, container, key) {
  const inPage = part.runMode === 'page';
  let holder;
  if (inPage) {
    holder = document.createElement('div');
    holder.className = 'module-root dest-part-root';
  } else {
    holder = document.createElement('iframe');
    holder.className = 'dest-part-frame';
    holder.title = part.label || part.module.name;
  }
  container.appendChild(holder);
  const m = { part, key, holder, wrap: container, mounted: null, adds: [], status: [], header: [], toolbar: [] };
  m.mounted = mountModule({
    module: { id: part.module.id, version: part.module.version, scope: part.module.scope, content: part.module.content },
    ...(inPage ? { container: holder } : { frame: holder }),
    // A view of one space mounts its parts there (the space's own data and permissions, a guest's token carried).
    ...(spaceId ? { scope: 'space', spaceId, guestToken } : { scope: 'environment' }),
    entry: part.entry,
    destination: { hub, part: part.part },
    // The part's bands are the page's: its "+" entries, titlebar icons and status for the page bar and the status line (or,
    // in a composite's frame, the composite's titlebar and window), its toolbar items for the page's one row.
    onAdd: (entries) => { m.adds = entries; sendChrome(); },
    onStatus: (items) => { m.status = items; sendChrome(); },
    onHeader: (items) => { m.header = items; sendChrome(); },
    onToolbarItems: (items) => { m.toolbar = items; drawRow(); },
    ...(inComposite ? { liftUp: liftComposite } : {}),
    onOpenRef: openRef,
    // A part saying how tall its content is: where the page stacks its parts in one scroll (destination.css, `sized`) the
    // part is that tall, so it has no scroll of its own; beside each other the page ignores it.
    onResize: ({ height } = {}) => {
      if (!Number.isFinite(height) || height < 0) return;
      holder.style.setProperty('--part-h', `${Math.min(Math.ceil(height), 20000)}px`);
      container.classList.add('sized');
      const side = container.closest('.dest-side');
      if (side) side.classList.add('sized');
    },
    // A part asking to be shown at a place in itself (host.page.open): it already is its own page.
    onOpenPage: (hash) => {
      m.mounted.deliver('pagehash', { hash });
      return true;
    },
  });
  return m;
}

// --- the page's frame ----------------------------------------------------------------------------
// The module frame fills the page under the header: its title bar names the page and holds the parts' "+" and icons; its
// row; the parts; its status bar. In a composite's frame it has neither title bar nor status bar: the composite's window
// on the Workspace holds them (sendChrome). The panel is in a frame of its own with only a row, which shows while the
// panel is stacked under the main part (drawRow).
function drawFrame(d, mainTint = null) {
  page = createModuleFrame({
    title: d.name,
    icon: d.icon,
    variant: 'page',
    tint: mainTint,
    bands: { titlebar: !inComposite, status: !inComposite },
    titlebar: { standard: { dock: false, window: false, popout: false, clear: false } },
    flush: true,
    content: $('dest'),
    onAction: (e) => bands.event(e),
  });
  page.el.id = 'dest-frame';
  // Every row item carries its own send (drawRow); the "+" and the icons go to their part.
  bands = createFrameBands(page, { statusLimit: 6, send: (event, data) => {
    if (event === 'add' && data?.id) pickAdd(data.id);
    else if (event === 'header' && data?.id) pickHeader(data.id);
  } });
  $('dest-tabs').before(page.el);
  side = createModuleFrame({ title: 'Panel', variant: 'page', bands: { titlebar: false, status: false }, flush: true, content: $('dest-side-body'), onAction: (e) => sideBands.event(e) });
  side.el.classList.add('dest-side-frame');
  sideBands = createFrameBands(side, { send: () => {} });
  $('dest-side').append(side.el);
  // The filter's environment entry: the environment's own name, as modules and the "Saved in ..." note have it
  // (/api/branding); the word only until that answers.
  environmentName = document.querySelector('[data-brand="environmentName"]')?.textContent?.trim() || word('environment', { cap: true });
  fetch('/api/branding').then((res) => (res.ok ? res.json() : {})).then((b) => {
    const name = typeof b.environmentName === 'string' ? b.environmentName.trim() : '';
    if (name && name !== environmentName) { environmentName = name; drawRow(); }
  }).catch(() => {});
  // In a space there is no space filter, no Mine and no other calendars: the filter holds the marker kinds alone, and
  // shows once the main part has named one; a destination without marker kinds has no filter there at all. The map's
  // filter in a space (`spaceFilter`) is This <space>, Mine and the environment's own.
  filterShown = !(spaceId && !kind.markers && !spaceFilter());
}
let environmentName = '';

// The filter's groups, each a group of switches in the row's Filters menu (on: shown; one turned off is a filter applied):
// whose (the spaces, Mine and the environment's own; This <space> in a space), the kinds of markers, the person's other
// calendars.
function filterGroups() {
  const whose = [
    ...(spaceFilter() ? [{ id: HERE, icon: d.space?.icon || 'users', label: `This ${word('space')}`, on: hereOn }] : []),
    ...(spaceFilterHasMine() ? [{ id: MINE, icon: 'user', label: 'Mine', on: mineOn }] : []),
    // In a space the places marked for it are already in This <space>; this one adds the rest, drawn softer, to be found and
    // added. Off at first there: its resting state is off.
    ...(spaceFilter() ? [{ id: OWN, icon: 'globe', label: `All of ${environmentName}'s places`, on: ownOn, default: false }] : []),
    ...(kind.mine && !spaceId ? [{ id: MINE, icon: 'user', label: 'Mine', on: mineOn }] : []),
    ...(spaceId ? [] : [{ id: OWN, icon: 'globe', label: environmentName, on: ownOn }]),
    ...spaces.map((r) => ({ id: r.id, icon: r.icon, label: r.name, on: !off.has(r.id) })),
  ];
  const markers = kind.markers ? markerKinds.map((k) => ({ id: `${MARKER}${k.id}`, icon: k.icon, label: k.label, tint: k.tint, on: !markersOff.has(k.id) })) : [];
  const calendars = externals.map((c, i) => ({ id: `${EXTERNAL}${c.id}`, icon: 'calendar', label: c.name, note: 'only you', tint: EXTERNAL_TINTS[i % EXTERNAL_TINTS.length], on: !externalOff.has(c.id) }));
  const flip = ({ value, on }) => flipFilter(String(value), Boolean(on));
  return [
    { id: 'dest-whose', label: spaceFilter() ? 'Show' : word('space', { many: true, cap: true }), options: whose },
    { id: 'dest-markers', label: 'Markers', options: markers },
    { id: 'dest-calendars', label: 'Other calendars', options: calendars },
  ].filter((g) => g.options.length).map((g) => ({ type: 'chips', ...g, send: flip }));
}

// A chip turned on or off.
function flipFilter(id, on) {
  if (id === OWN) ownOn = on;
  else if (id === MINE) mineOn = on;
  else if (id === HERE) hereOn = on;
  else if (id.startsWith(EXTERNAL)) {
    if (on) externalOff.delete(id.slice(EXTERNAL.length));
    else externalOff.add(id.slice(EXTERNAL.length));
  } else if (id.startsWith(MARKER)) {
    if (on) markersOff.delete(id.slice(MARKER.length));
    else markersOff.add(id.slice(MARKER.length));
  } else if (on) off.delete(id);
  else off.add(id);
  remember({ off: [...off], ownOff: !ownOn, mineOff: !mineOn, hereOff: !hereOn, ...(kind.external ? { externalOff: [...externalOff] } : {}), ...(kind.markers ? { markersOff: [...markersOff] } : {}) });
  hub.update(filterState());
  drawRow();
}

// --- the toolbar row: one band over every part ---------------------------------------------------
// The main part's items, then the page's own (the view switch, the filters, the search), then the panel's switch and the
// shown panel's items: the frame draws them in Thomas's order (the switches, the words, the buttons; the search and the
// one Filters button at the end, every part's filters and the page's in it). While the panel is stacked under the main
// part (a narrow window or column, not a phone), the panel's switch and items are the panel's own row, at its top, where
// they act. On a phone, the tab showing: the main part's tab has the main part's items, the view switch and the filter; a
// panel's tab that panel's items; the search shows on every tab. A part's control answers that part (its ids kept apart
// from the other parts' as "<part's key>~<id>"; its `x` measured from the part's own edge, for a menu under it); the
// page's answer the page.
function partItems(m) {
  return m.toolbar.map(({ pin, zone, ...item }) => ({ // a module's items stay a module's: no pin, no zone of its own in the page's row
    ...item,
    ...(item.id ? { id: `${m.key}~${item.id}` } : {}),
    send: (data, el) => {
      const out = { ...data, id: item.id };
      if (el && 'x' in out) out.x = Math.max(0, Math.round(el.getBoundingClientRect().left - m.holder.getBoundingClientRect().left));
      m.mounted.send('toolbar', out);
    },
  }));
}
function drawRow() {
  if (!bands || !hub) return;
  const phone = onPhone();
  const main = parts.find((p) => p.key === 'main');
  const panels = parts.filter((p) => p.key !== 'main');
  const shownPanel = panels.find((p) => p.key === (phone ? tab : panel));
  const onMain = !phone || tab === 'main';
  const own = [];
  if (onMain && kind.views.length) {
    own.push({ type: 'tabs', id: 'dest-view', value: view, options: kind.views, send: ({ value }) => {
      if (!value || value === view) return;
      view = value;
      remember({ view });
      hub.update({ view });
      drawRow();
    } });
  }
  if (onMain && filterShown && (!spaceId || spaceFilter() || markerKinds.length > 0)) own.push(...filterGroups());
  if (kind.search) {
    own.push({ type: 'search', id: 'dest-search', value: searchText, placeholder: searchWords || kind.search.filterOnly, label: kind.search.label, send: ({ value, submit }) => {
      searchText = String(value ?? '');
      if (submit) { find += 1; hub.update({ q: searchText, find }); } else hub.update({ q: searchText });
    } });
  }
  const panelSwitch = !phone && panels.length > 1 ? [{
    type: 'tabs',
    id: 'dest-panel',
    value: panel,
    // Each panel with its module's icon (as the phone's tabs have): icons only while the row is too narrow, then the row's
    // other things go into More before this does (it is pinned).
    options: panels.map((p) => ({ id: p.key, label: p.part.label, icon: /^[a-z0-9-]{1,40}$/.test(p.part.module.icon || '') ? p.part.module.icon : 'puzzle-piece' })),
    send: ({ value }) => {
      if (!value || value === panel) return;
      panel = value;
      remember({ panel });
      layout();
    },
  }] : [];
  const stacked = !phone && panels.length > 0 && (stackedQuery.matches || document.body.classList.contains('dest-no-webgl'));
  if (kind.zones) {
    // The panel's switch is always in the main row's right zone, whatever the width; while the panel is stacked its own items
    // are the panel's row, at its top, where they act.
    const shownItems = shownPanel ? partItems(shownPanel) : [];
    const zone = (items, z, pin) => items.map((i) => ({ ...i, zone: z, ...(pin ? { pin: true } : {}) }));
    bands.toolbar([
      ...(onMain && main ? zone(partItems(main), 'start') : []),
      ...own.map((i) => (i.type === 'tabs' ? { ...i, zone: 'start' } : i)),
      ...(stacked ? [] : zone(shownItems, 'end')),
      ...zone(panelSwitch, 'end', true),
    ]);
    sideBands.toolbar(stacked ? zone(shownItems, 'start') : []);
    return;
  }
  const panelItems = [...panelSwitch, ...(shownPanel ? partItems(shownPanel) : [])];
  bands.toolbar([...(onMain && main ? partItems(main) : []), ...own, ...(stacked ? [] : panelItems)]);
  sideBands.toolbar(stacked ? panelItems : []);
}

function drawTabs(d) {
  const all = [d.main, ...(d.panels || [])];
  if (all.length < 2) return;
  $('dest-tabs').innerHTML = all.map((p) => {
    const key = p.part === 'main' ? 'main' : `panel:${p.module.id}`;
    const icon = /^[a-z0-9-]{1,40}$/.test(p.module.icon || '') ? p.module.icon : 'puzzle-piece';
    return `<button type="button" class="dest-tab" data-tab="${key}"><i class="fa-solid fa-${icon} fa-fw" aria-hidden="true"></i><span>${escape(p.label)}</span></button>`;
  }).join('');
  $('dest-tabs').addEventListener('click', (event) => {
    const b = event.target.closest('[data-tab]');
    if (!b || b.dataset.tab === tab) return;
    tab = b.dataset.tab;
    remember({ tab });
    layout();
  });
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// What shows: on a wider screen the main part and the chosen panel; on a phone the one tab.
function layout() {
  const phone = onPhone();
  const panels = parts.filter((p) => p.key !== 'main');
  const hasTabs = parts.length > 1;
  $('dest-tabs').hidden = !(phone && hasTabs);
  document.body.classList.toggle('dest-has-tabs', phone && hasTabs);
  const showing = phone ? tab : null;
  $('dest-main').hidden = phone && showing !== 'main';
  $('dest-side').hidden = !panels.length || (phone && showing === 'main');
  for (const p of panels) p.wrap.hidden = phone ? p.key !== showing : p.key !== panel;
  for (const b of document.querySelectorAll('#dest-tabs [data-tab]')) {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  drawRow(); // on a phone the row follows the tab
  sendChrome(); // the status line follows the panel shown
}

// --- the titlebar's "+" and icons, and the status line ---------------------------------------------------------------
// The "+": each part's entries in the parts' order (the main, then the panels), their ids as "<part's place>.<id>" so a
// pick finds its part; a part with more than one entry, beside another with some, is a category named by the part (its
// flyout). One leaf in all: the "+" runs it at once. The icons likewise, "<part's place>.<id>". The status: the main part's
// items, then the panel's shown (the status bar keeps the first six here: the calendar's two and the To-do's four). On the page they are drawn in its frame's title bar
// and status bar; in a composite's frame they are handed up to the composite's window on the Workspace.
// The same add offered by two parts (the Map's "Add a place" and its list part's) is one entry, the first part's.
function chromeAdds() {
  const lists = dropRepeatedAdds(parts.map((p) => p.adds));
  const shown = new Map(parts.map((p, i) => [p, lists[i]]));
  const giving = parts.map((p, at) => ({ p, at, adds: shown.get(p) })).filter(({ adds }) => adds.some((e) => !e.divider));
  const out = [];
  for (const { p, at, adds } of giving) {
    const leaf = (e) => ({ ...e, id: `${at}.${e.id}` });
    const own = adds.map((e) => (e.divider ? e : e.items ? { ...e, items: e.items.map(leaf) } : leaf(e)));
    const real = own.filter((e) => !e.divider);
    if (giving.length > 1 && (real.length > 1 || real[0].items)) {
      const items = real.flatMap((e) => e.items || [e]);
      out.push({ label: p.part.label || p.part.module.name, ...(/^[a-z0-9-]{1,40}$/.test(p.part.module.icon || '') ? { icon: p.part.module.icon } : {}), items });
    } else out.push(...own);
  }
  return out;
}
function chromeStatus() {
  const main = parts.find((p) => p.key === 'main');
  const side = parts.find((p) => p.key !== 'main' && p.key === panel);
  return [...(main ? main.status : []), ...(side ? side.status : [])];
}
function chromeHeader() {
  return parts.flatMap((p, at) => p.header.map((h) => ({ ...h, id: `${at}.${h.id}` })));
}
// A pick in the "+" or a click on an icon: that part's own add (shown first, so its editor opens in view), or its icon.
function partOf(id) {
  const dot = id.indexOf('.');
  const p = parts[Number(id.slice(0, dot))];
  return dot < 1 || !p || !p.mounted ? null : { p, own: id.slice(dot + 1) };
}
function pickAdd(id) {
  const found = partOf(id);
  if (!found) return;
  show(found.p.key);
  found.p.mounted.deliver('add', { id: found.own });
}
function pickHeader(id) {
  const found = partOf(id);
  if (found) found.p.mounted.send('header', { id: found.own });
}
let chromeQueued = false;
function sendChrome() {
  if (chromeQueued) return;
  chromeQueued = true;
  queueMicrotask(() => {
    chromeQueued = false;
    if (!inComposite) {
      if (!bands) return;
      bands.add(chromeAdds());
      bands.header(chromeHeader());
      bands.status(chromeStatus());
      return;
    }
    try {
      window.parent.postMessage({ type: 'app:compositechrome', add: chromeAdds(), status: chromeStatus(), header: chromeHeader() }, location.origin);
    } catch {
      // the Workspace is gone
    }
  });
}
// A part's editor window (host.ui.editor) needs the whole Workspace, not this frame: the Workspace lifts the frame over
// itself while one is open (canvas.js, compositeMount) and says so; the answer is { lifted: true, phone } or false.
const liftWaits = new Map();
let liftSeq = 0;
// The Workspace lifted this frame over the whole screen ({ lifted: true, cover: box }): the page stays drawn in the box the
// frame had (body.dest-covered, destination.css) and the part's editor window is a plain modal dialog over the screen, so the
// list is still there behind it. Answers false then (the dialog is not "lifted" into a frame of its size). Put back on close.
function coverPage(open, result) {
  const body = document.body;
  const box = open && result && result.lifted === true && result.cover ? result.cover : null;
  for (const side of ['top', 'bottom']) {
    if (box) body.style.setProperty(`--cover-${side}`, `${Math.max(0, Number(box[side]) || 0)}px`); else body.style.removeProperty(`--cover-${side}`);
  }
  body.classList.toggle('dest-covered', Boolean(box));
  return box ? false : result;
}
function liftComposite(open, size, height) {
  return new Promise((resolve) => {
    const seq = ++liftSeq;
    liftWaits.set(seq, (result) => resolve(coverPage(open, result)));
    setTimeout(() => { if (liftWaits.delete(seq)) resolve(false); }, 1500);
    try {
      window.parent.postMessage({ type: 'app:compositelift', seq, open, size, height }, location.origin);
    } catch {
      liftWaits.delete(seq);
      resolve(false);
    }
  });
}
// From the Workspace: a pick in the composite's "+" (that part's own add, as its button in the page would; the part is
// shown first, so its editor opens in view), or a new frame asking for what to draw.
if (inComposite) {
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.origin !== location.origin) return;
    const d = event.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'app:compositehello') return sendChrome();
    if (d.type === 'app:compositelifted') { const done = liftWaits.get(d.seq); liftWaits.delete(d.seq); if (done) done(d.result); return; }
    if (d.type === 'app:compositeevent') { // the Workspace put the lifted frame back, or the window crossed the phone line
      if (d.event === 'editordismiss') coverPage(false, null);
      if (d.event === 'editordismiss' || d.event === 'editorlift') for (const p of parts) if (p.mounted) p.mounted.deliver(d.event, d.data || {});
      return;
    }
    if (d.type === 'app:compositeheader' && typeof d.id === 'string') return pickHeader(d.id);
    if (d.type !== 'app:compositeadd' || typeof d.id !== 'string') return;
    pickAdd(d.id);
  });
}

// Bring a part into view (its tab on a phone, its panel on a wider screen).
function show(key) {
  if (key !== 'main') panel = key;
  tab = key;
  layout();
}

// An object to show. One of a part's own: that part shows it. Another module's, in a composite's frame on a space's
// canvas: the canvas opens that module there with the object (askCanvasToOpen), as for a module beside it; the frame
// is never led on to the module's page (a whole app page, its header and all, inside the Calendar's window). In a
// window popped out of the canvas: the canvas that opened it, if it answers. Otherwise: its page, keeping the way back
// to a call this page is open over.
async function openRef(ref) {
  const target = parts.find((p) => p.part.module.id === ref.module && p.key === 'main') || parts.find((p) => p.part.module.id === ref.module);
  if (target) {
    show(target.key);
    target.mounted.deliver('objectopen', { ref });
    return true;
  }
  if (inComposite) return (await askCanvasToOpen(window.parent, ref)) === true;
  const opener = embedded ? null : sameSiteOpener();
  if (opener && (await askCanvasToOpen(opener, ref)) === true) return true;
  const q = new URLSearchParams(location.search);
  q.delete('space');
  if (ref.scope === 'space') q.set('space', ref.space);
  // A guest's token opens only their own space's pages.
  if (guestToken && !(ref.scope === 'space' && ref.space === spaceId)) q.delete('guest');
  location.href = `/modules/${encodeURIComponent(ref.module)}${q.toString() ? `?${q}` : ''}#ref=${encodeURIComponent(JSON.stringify(ref))}`;
  return true;
}

function takeHash() {
  let h = location.hash.slice(1);
  if (!h) return;
  // A panel to show (#panel=<module id>, a panel tile's heading on home): it wins over the remembered tab this once and is
  // then remembered as a pick in the switch would be (the bottom tab on a phone). It leaves the address, so a reload
  // keeps the person's later picks. An unknown or unreadable one is ignored.
  const asked = hashPanel(h, parts.filter((p) => p.key !== 'main').map((p) => p.key));
  if (asked.found) {
    h = asked.rest;
    history.replaceState(history.state, '', `${location.pathname}${location.search}${h ? `#${h}` : ''}`);
    if (asked.key) {
      panel = asked.key;
      if (onPhone()) {
        tab = asked.key;
        remember({ panel, tab });
      } else remember({ panel });
      layout();
    }
    if (!h) return;
  }
  if (h.startsWith('ref=')) {
    try {
      const ref = JSON.parse(decodeURIComponent(h.slice(4)));
      if (ref && typeof ref.module === 'string') openRef(ref);
    } catch {
      // not a pointer
    }
    return;
  }
  if (/^[A-Za-z0-9=&_.:,-]{1,80}$/.test(h)) {
    const main = parts.find((p) => p.key === 'main');
    if (main) {
      show('main');
      main.mounted.deliver('pagehash', { hash: h });
    }
  }
}

start().catch((err) => missing(`This page could not start: ${err.message}`));
