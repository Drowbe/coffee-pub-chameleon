// The Maps module's page: a map of every place the space has, from the admin's map file. Maps keeps no data of its own: it draws
// every summary in the space that carries a `place` (through the objects conduit), each with its own module's icon and grouped by
// module, and it saves a new place by asking whichever module provides the `newPlace` action. On the environment's own page it
// draws the same across the viewer's spaces, their own places and the environment's (plan-map-destination, decision 20), and
// as the Map destination's main part it follows the page's filter, search and selection (host.destination). As that part in
// a space (/map?space=<id>; plan-map-places.md, step 2) it draws this space's pins, with Mine and the environment's own by the
// page's filter there, and reads only what the filter has on. This page draws into the markup
// in maps.html by cloning its templates and filling their [data-slot] and [data-icon] hooks, and toggles the state classes
// and data attributes CONTRACT.md lists. It builds no markup from strings and sets no style (the map library positions the
// pins). Nothing here names another module, and no request leaves the server unless the admin set a search address.
(async () => {
  'use strict';

  // This module runs in the page (its SDK is handed to its script; a frame cannot read a map file or start the map's worker).
  const host = (document.currentScript && document.currentScript.host) || window.host;
  const root = host.root;
  const word = host.util.word; // the environment's word for a level or role (host.locale().words)
  const $ = (id) => root.getElementById(id);
  // States: loading is the skeleton in #loading; a failure or a plain notice is the block in #msg (.sdk-empty: an icon, a heading, a line,
  // and Retry on a failure, data-kind="error").
  function showMsg(title, text, retry) {
    $('loading').hidden = true;
    const m = $('msg');
    const icon = document.createElement('span');
    icon.className = 'ic';
    host.ui.icon(retry ? 'triangle-exclamation' : 'circle-info').then((svg) => { icon.innerHTML = svg; }).catch(() => {});
    const head = document.createElement('h2');
    head.className = 'sdk-empty-title';
    head.textContent = title;
    const parts = [icon, head];
    if (text) {
      const line = document.createElement('p');
      line.className = 'sdk-empty-text';
      line.textContent = text;
      parts.push(line);
    }
    if (retry) {
      const actions = document.createElement('div');
      actions.className = 'sdk-empty-actions';
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'btn';
      again.textContent = 'Retry';
      again.addEventListener('click', () => { m.hidden = true; $('loading').hidden = false; retry(); });
      actions.append(again);
      parts.push(actions);
    }
    m.replaceChildren(...parts);
    if (retry) m.dataset.kind = 'error'; else delete m.dataset.kind;
    m.hidden = false;
  }

  let info;
  try {
    info = await host.ready();
  } catch (err) {
    showMsg('Maps could not start', err.message, () => location.reload());
    return;
  }
  // On a space's canvas (or its pop-out): that space's places. On the environment page: every space's the viewer belongs to,
  // with their own and the environment's. As the Map destination's main part ('main'), the same, through the page's filter;
  // in a space, that space's, through the page's filter there (this space, Mine, the environment's own).
  const inSpace = info.context.scope === 'space';
  if (!inSpace && info.context.scope !== 'environment') {
    showMsg(`${info.module.name} could not open here.`);
    return;
  }
  const part = (info.context.destination && info.context.destination.part) || null;
  // The environment page on its own (no destination): a view of every place, with nothing beside it to save one in.
  const alone = !inSpace && !part;

  const geo = host.util.geo;
  const { round6, oneLine, parsePoint, coordsText, mapsLink } = geo;
  /*__LIB__*/

  const canEdit = host.can('edit');
  const maplibregl = window.maplibregl;
  // The pane's width, not the window's: a bundled module runs in the page, so a media query would follow the window. The
  // stylesheet keys its narrow layout on `.app.narrow`.
  const NARROW = 720;
  const isNarrow = () => $('app').classList.contains('narrow');
  const apple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
  // On a phone the link opens the person's own maps app; on a desktop it is OpenStreetMap's website, and says so.
  const MAPS_APP = apple || /Android/i.test(navigator.userAgent) ? 'Open in my maps app' : 'Open in OpenStreetMap';

  // The page's document hears this map (Escape while picking, the page coming back) only while its markup is there: once it
  // goes (the page or the space left, the module opened again), what was added there is taken off (letGo).
  const alive = new AbortController();
  function letGo() { if (!alive.signal.aborted) alive.abort(); }

  const state = {
    all: [], // every summary read that carries a place: this space's (or every space's), the viewer's own and the environment's
    how: new Map(), // the id of each place drawn, to 'full' or 'soft'
    found: [], // the ones drawn: as the destination's part, those in the page's filter; elsewhere all of them
    filter: null, // as the destination's part: { mine, environment, spaces: Set | null } from the page; null shows everything
    read: { person: false, environment: false }, // whether Mine and the environment's own have been read (the filter may leave them unread)
    q: '', // as the destination's part: the page's search text, which dims the pins that do not match it
    settings: { maps: [], web: false }, // the map files to draw (names on this server, or one https address when `web`)
    candidates: [], // search results drawn as pins to pick from
    spread: null, // the ids of places in one spot that are spread out round it (a click on their cluster), or null
    picked: null, // the action that takes the spot a person picked for a place (`positionPicked`), if some module provides one
    pick: false, // a spot is being picked for a place the editor holds (`pickPoint`): the next click on the map answers it
    searcher: null, // the action that searches for a place, if some module provides one
    selected: null, // the id of the summary that is open
    adding: false,
    draft: null, // { lat, lng }: where a new place would go
    adder: null, // the action that saves a place, if some module provides one
    map: null,
    mapReady: false,
    fitted: false,
    started: false,
    saving: false,
    // The environment's picture map ({ file, minZoom, maxZoom, tileType }), or null for the world map. While it is set the
    // map draws only the picture, and what means nothing on an invented world (where I am, my maps app, the coordinates in
    // the callout, the OpenStreetMap credit, the outside search) is left out (plan-map-image).
    picture: pictureOf(host.environment && host.environment.pictureMap),
    landZoom: WORLD_MAX_ZOOM,
    maxZoom: WORLD_MAX_ZOOM, // the map's maximum: every fixed zoom below is capped at it (capZoom)
    labelZoom: 14, // the zoom from which every pin shows its label (zoomed out, only the selected one and the one pointed at do)
    style: null, // builds the style from the theme's colours, for a theme change
  };
  const PICTURE_FOLDER = 'image-map'; // the `imageMap` setting's folder (module.json)
  function pictureOf(pm) {
    return pm && typeof pm === 'object' && typeof pm.file === 'string' && pm.file ? pm : null;
  }
  // A zoom the page asks for lands at `landZoom` at most: the map's maximum on the world map, one level above the file's deepest
  // on a picture map. `limit` is the map's own maximum (a remembered view may be as deep as that).
  const cap = (z) => capZoom(z, state.landZoom);
  const limit = (z) => capZoom(z, state.maxZoom);

  // --- small helpers ------------------------------------------------------------------------------------------------

  // A template's copy, its data-word marks filled with this environment's words.
  const clone = (id) => host.util.fillWords($(id).content.firstElementChild.cloneNode(true));
  const parts = (id) => [...$(id).content.children].map((n) => host.util.fillWords(n.cloneNode(true)));
  const hide = (node, yes) => { if (node) node.hidden = Boolean(yes); };
  const slot = (el, name) => (el.dataset.slot === name ? el : el.querySelector(`[data-slot="${name}"]`));
  function fill(el, values) {
    for (const [name, value] of Object.entries(values)) {
      const s = slot(el, name);
      if (s) { s.textContent = value == null ? '' : String(value); s.hidden = value === '' || value == null; }
    }
  }
  const iconSvg = new Map();
  const iconWait = new Map();
  function wantIcon(name) {
    if (iconSvg.has(name)) return Promise.resolve(iconSvg.get(name));
    if (!iconWait.has(name)) iconWait.set(name, host.ui.icon(name).then((svg) => { iconSvg.set(name, svg); return svg; }).catch(() => { iconSvg.set(name, ''); return ''; }));
    return iconWait.get(name);
  }
  // Icons not here yet are waited for once per scan, together: a scan per pending icon would attach a scan to every
  // other pending icon too, and a form opened while its icons still load would scan itself 2^n times.
  function hydrate(scope) {
    const pending = new Set();
    for (const el of scope.querySelectorAll('[data-icon]')) {
      const name = el.dataset.icon;
      if (!name || el.dataset.shown === name) continue;
      if (iconSvg.has(name)) { el.innerHTML = iconSvg.get(name); el.dataset.shown = name; } else pending.add(name);
    }
    if (pending.size) Promise.all([...pending].map(wantIcon)).then(() => hydrate(scope));
  }
  const setIcon = (node, name) => { if (node) { node.dataset.icon = name || ''; delete node.dataset.shown; node.textContent = ''; } };
  // A transient confirmation or refusal is a toast (host.ui.toast), never text drawn in the module; `say('')` is a no-op.
  const say = (text) => { if (text && host.ui && host.ui.toast) host.ui.toast(String(text)).catch(() => {}); };
  const whenText = (w) => {
    if (w == null || w === '') return '';
    const d = typeof w === 'number' ? new Date(w) : /^\d{4}-\d{2}-\d{2}/.test(String(w)) ? new Date(String(w).length === 10 ? String(w) + 'T00:00:00' : String(w)) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : String(w).slice(0, 40);
  };

  // --- the places (summaries) -------------------------------------------------------------------------------------------

  const summaryId = (c) => host.util.objectKey(c.ref);
  // A place kept by the module that owns places is drawn as a place; anything else with a position is an object.
  const kindOf = (c) => (c.kind === 'place' ? 'place' : 'object');
  const moduleName = (c) => (c.module && c.module.name) || 'Other';
  const current = () => (state.selected ? state.found.find((c) => summaryId(c) === state.selected) || null : null);
  async function loadFound() {
    if (!host.objects || !host.objects.search) return;
    try {
      // This space's (on the environment page every space's the viewer belongs to, each pointer with its space), the person's
      // own (private to them) and everyone's in this environment (a guest has neither of the last, so those answer with
      // nothing). Only summaries with a place, so a busy space's pins are all there, not the newest 50. As the destination's
      // part, Mine and the environment's own are read only while the page's filter has them on (takeState reads them when
      // they are turned on).
      const here = inSpace ? host.objects.search('', { has: 'place' }) : host.objects.search('', { scope: 'spaces', has: 'place' }).catch(() => []);
      // In a space: the environment's places marked for it, always (whatever the filter), so the trip's map has them with its own.
      const spaceId = inSpace ? info.context.spaceId : '';
      const marked = spaceId ? host.objects.search('', { scope: 'environment', has: 'place', in: spaceId }).then((list) => list.map((c) => (c && c.ref && !markedFor(c, spaceId) ? { ...c, spaces: [...(Array.isArray(c.spaces) ? c.spaces : []), spaceId] } : c))).catch(() => []) : Promise.resolve([]);
      const wanted = (scope) => !state.filter || state.filter[scope === 'person' ? 'mine' : 'environment'];
      const other = (scope) => (wanted(scope) ? host.objects.search('', { scope, has: 'place' }).then((list) => { state.read[scope] = true; return list; }).catch(() => []) : Promise.resolve(state.all.filter((c) => c.ref.scope === scope)));
      const [spaces, mark, mine, everyone] = await Promise.all([here, marked, other('person'), other('environment')]);
      // Each place once, by the pointer of its home: one reached through a mark and through the environment's list is one pin.
      const seen = new Set();
      state.all = [...spaces, ...mark, ...mine, ...everyone].filter((c) => {
        if (!(c && c.ref && c.place && geo.inRange(Number(c.place.lat), Number(c.place.lng)) && c.title)) return false;
        const id = summaryId(c);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    } catch (err) {
      state.all = [];
    }
    applyFilter();
  }
  // The places the map shows and how (pinLib's showHow): the page's filter, and in a space the marked ones with this space's own;
  // the rest of the environment's drawn softer.
  function applyFilter() {
    state.how = new Map();
    const spaceId = inSpace ? info.context.spaceId : '';
    state.found = state.all.filter((c) => {
      const how = showHow(c, state.filter, spaceId);
      if (how) state.how.set(summaryId(c), how);
      return Boolean(how);
    });
  }
  // A pin the search text does not match is dimmed, not hidden: by its title and where it is.
  const dimmed = (c) => Boolean(state.q) && !`${c.title} ${c.subtitle || ''}`.toLowerCase().includes(state.q);
  // What the module that keeps places offers: a dialog for a new place at a position (`newPlace`) and a search by name
  // (`searchPlaces`, which answers with a few results). Found by what they offer, never by name.
  // Places' category colours ({ <category id>: '#rrggbb' }, only those the owner chose), kept in this browser for a map with no
  // Places beside it; asked again whenever a Places is open in this page (findAdder), and the pins redrawn when they changed.
  const COLORS_KEY = 'maps-category-colors';
  state.catColors = (() => { try { return cleanColors(JSON.parse(localStorage.getItem(COLORS_KEY) || '{}')); } catch (err) { return {}; } })();
  async function askColors(action) {
    try {
      const out = await host.actions.request(action.action, {}, { wait: true, here: true });
      if (out.status !== 'done' || !out.result || !out.result.ok || !out.result.data) return;
      const next = cleanColors(out.result.data.colors);
      if (JSON.stringify(next) === JSON.stringify(state.catColors)) return;
      state.catColors = next;
      try { localStorage.setItem(COLORS_KEY, JSON.stringify(next)); } catch (err) { /* not kept */ }
      if (state.started) render();
    } catch (err) { /* the colours stay as they were */ }
  }
  async function findAdder() {
    state.adder = null;
    state.searcher = null;
    if (!host.actions || !host.actions.list) return;
    try {
      // These actions are carried out by the list part of this module beside the map (src/maps-list.js), in the asking person's
      // own open page, so asking from anywhere but the Map destination would wait for a part that is not there.
      if (!part) return;
      const list = await host.actions.list({ self: true });
      // Who may add is the list's call, not the map's: it refuses someone who may not (see askNewPlace), and a listing that
      // says `may: false` for the action takes the add tools away at once.
      state.adder = list.find((a) => a.name === 'newPlace' && a.input && a.input.lat && a.input.lng && a.may !== false && !state.refused) || null;
      state.searcher = list.find((a) => a.name === 'searchPlaces' && a.input && a.input.q) || null;
      state.picked = list.find((a) => a.name === 'positionPicked') || null; // where a picked spot (or none) is told
      // Whether this person may add places is the list's call: ask it, and show no "+" when the answer is no.
      const may = state.adder && list.find((a) => a.name === 'mayAdd' && a.open === true);
      if (may) {
        try {
          const out = await host.actions.request(may.action, {}, { wait: true, here: true });
          if (out.status === 'done' && out.result && out.result.ok && out.result.data && out.result.data.may === false) state.adder = null;
        } catch (err) { /* the add stays offered; a refusal is still handled when it comes */ }
      }
      // The colours an owner chose for the categories: asked of the list part in this page.
      const colors = list.find((a) => a.name === 'categoryColors' && a.open === true);
      if (colors) askColors(colors);
    } catch (err) {
      state.adder = null;
      state.picked = null;
      state.searcher = null;
    }
  }

  // --- the callout of the selected place, and drawing --------------------------------------------------------------

  // A selected pin shows its callout over the map: what it is, where, and what can be done (open it in the person's own maps
  // app, copy its position, or open it in the module that owns it). Places is the list; Maps only shows.
  function renderCallout() {
    const box = $('callout');
    const c = current();
    if (!c) { box.replaceChildren(); hide(box, true); return; }
    const el = clone('tpl-callout');
    el.dataset.kind = kindOf(c);
    const look = pinLook(c, state.catColors);
    if (look.color) { el.dataset.cat = c.category || 'own'; turnCat(el, look); }
    if (c.ref.scope === 'person') el.dataset.scope = 'person';
    // On a picture map a position is not somewhere on Earth: no coordinates shown (Copy coordinates still copies them) and
    // no "Open in my maps app".
    const picture = Boolean(state.picture);
    fill(el, { title: c.title, where: c.subtitle || '', coords: picture ? '' : coordsText(c.place.lat, c.place.lng), from: `from ${moduleName(c)}${look.visitLabel ? ' \u00b7 ' + look.visitLabel : ''}${c.when ? ' \u00b7 ' + whenText(c.when) : ''}` });
    hide(el.querySelector('.callout-where'), picture && !c.subtitle);
    setIcon(el.querySelector('.callout-source [data-icon]'), (c.module && c.module.icon) || 'link');
    const inMaps = el.querySelector('[data-action="open-in-maps"]');
    if (picture) inMaps.remove(); else { inMaps.href = mapsLink(c.place.lat, c.place.lng, c.title, apple); fill(inMaps, { 'maps-label': MAPS_APP }); }
    // As the destination's part on a phone, where the list is the other tab: "Show in list" asks the page to show it.
    const inList = el.querySelector('[data-action="show-in-list"]');
    if (inList) inList.hidden = !(part && state.phone);
    box.replaceChildren(el);
    hide(box, false);
    hydrate(box);
  }

  // The module's markup is gone (its page or the space was left): the map library may still fire a move or a late
  // answer may still arrive, so stop the map and draw nothing more.
  function torn() {
    if (host.rootElement.isConnected && $('tpl-pin')) return false;
    letGo();
    if (state.map) { try { state.map.remove(); } catch (err) { /* already gone */ } state.map = null; state.mapReady = false; }
    return true;
  }

  function render() {
    if (torn()) return;
    if (state.selected && !current()) state.selected = null;
    renderCallout();
    hydrate(root);
    drawPins();
    syncStatus();
  }

  // Follow the pane's width (the stylesheet keys its narrow layout on `.app.narrow`). A frame can report none while it is still
  // being laid out, so wait for a real one.
  const fit = () => {
    if (!host.rootElement.isConnected) { letGo(); return; } // the markup went: the observer hears that first
    const w = host.rootElement.clientWidth;
    if (!w) return;
    const now = w < NARROW;
    if (now === isNarrow() && state.fitted) { state.map && state.map.resize(); return; }
    state.fitted = true;
    $('app').classList.toggle('narrow', now);
    if (state.started) state.map && state.map.resize();
  };
  fit();
  new ResizeObserver(fit).observe(host.rootElement);

  // As the destination's part the selection is the page's too (the panel beside follows it): tell it, unless it told us
  // (`o.quiet`).
  let told = null; // the selection last told to the page or heard from it (an object key, '' for none)
  function select(id, o) {
    state.selected = id || null;
    render();
    const c = current();
    if (c && state.map && !(o && o.still)) state.map.easeTo({ center: [c.place.lng, c.place.lat], zoom: cap(Math.max(state.map.getZoom(), 13)), duration: 500 });
    const now = c ? summaryId(c) : '';
    if (part && host.destination && !(o && o.quiet) && now !== told) {
      told = now;
      host.destination.set({ selected: c ? c.ref : null }).catch(() => {});
    }
  }

  // --- the pins -----------------------------------------------------------------------------------------------------

  const markers = [];
  let draftMarker = null;
  function clearPins() { while (markers.length) markers.pop().remove(); }

  // A pin's colour (pinColor): the place's own, else its category's as the owner set it in Places (catColors), else the category's
  // automatic theme tint. A hex colour is used as it is, as Places does; a tint is the theme's, so it follows the theme.
  function turnCat(el, look) {
    const c = look.color;
    if (!c) return;
    el.style.setProperty('--tone', cssColor(c));
    if (c.hex) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.hex.slice(i, i + 2), 16));
      el.style.setProperty('--tone-ink', r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#000000' : '#ffffff');
    }
  }

  function makePin(x, on) {
    const pin = clone('tpl-pin');
    pin.dataset.kind = x.kind;
    pin.dataset.id = x.id;
    if (x.look.color) { pin.dataset.cat = x.cat || 'own'; turnCat(pin, x.look); }
    if (x.scope) pin.dataset.scope = x.scope;
    if (x.dim) pin.classList.add('dim');
    if (x.soft) pin.classList.add('soft');
    setIcon(pin.querySelector('[data-icon]'), x.look.icon);
    // The visit status: a small badge in the pin's corner, with its words for a screen reader (the pin's name, set by addMarker).
    const badge = pin.querySelector('.pin-badge');
    if (x.look.visit) {
      badge.dataset.visit = x.look.visit;
      setIcon(badge.querySelector('[data-icon]'), x.look.visitIcon);
    } else badge.remove();
    pinLabel(pin, x.title);
    if (state.selected === x.id) pin.classList.add('selected');
    pin.addEventListener('click', (e) => { e.stopPropagation(); if (!state.adding) on(); });
    return pin;
  }
  // A pin's name on the map. Zoomed out the names would pile up on each other, so they show only for the selected pin and the one
  // pointed at or focused (the stylesheet); from `labelZoom` in, every pin shows its name.
  function pinLabel(pin, title) {
    if (!title) { pin.querySelector('.pin-label').remove(); return; }
    fill(pin, { label: title });
    if (state.map.getZoom() < state.labelZoom) pin.classList.add('lowzoom');
  }
  // A marker on the map with its accessible name. The map library names every marker "Map marker" as it is added, so the name is
  // set after, and it is the place's title (or "3 places" for a cluster), with the visit status when it has one.
  function addMarker(el, lngLat, anchor, name) {
    const m = new maplibregl.Marker({ element: el, anchor }).setLngLat(lngLat).addTo(state.map);
    el.setAttribute('aria-label', name);
    markers.push(m);
    return m;
  }
  // The places that are all in one spot (to about 30 m): a cluster of them cannot be opened by zooming.
  const together = (points) => { const b = boundsOf(points); return b[1][0] - b[0][0] < 0.0003 && b[1][1] - b[0][1] < 0.0003; };
  const clusterPin = (points, dim, soft, onClick) => {
    const c = clone('tpl-pin-cluster');
    fill(c, { count: points.length });
    c.dataset.key = `${points.length}:${points[0].id || points[0].title}`;
    if (dim) c.classList.add('dim');
    if (soft) c.classList.add('soft');
    c.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return c;
  };
  const elementKey = (el) => (el.dataset.id ? `id:${el.dataset.id}` : el.dataset.key ? `key:${el.dataset.key}` : '');

  function drawPins() {
    if (torn()) return;
    if (!state.map || !state.mapReady) return;
    // The pins are drawn again on every move; keep the keyboard where it was (the same pin, or cluster, after the redraw).
    const active = root.activeElement;
    const keep = active && active.classList && active.classList.contains('pin') && markers.some((m) => m.getElement() === active) ? elementKey(active) : '';
    clearPins();
    const map = state.map;
    const all = state.found.map((c) => ({ kind: kindOf(c), id: summaryId(c), lat: c.place.lat, lng: c.place.lng, title: c.title, cat: c.category || '', scope: c.ref.scope === 'person' ? 'person' : '', look: pinLook(c, state.catColors), soft: state.how.get(summaryId(c)) === 'soft', dim: dimmed(c) }));
    const picked = all.filter((x) => x.id === state.selected);
    const rest = all.filter((x) => !picked.includes(x));
    const pinName = (x) => (x.look.visit ? `${x.title}, ${x.look.visitLabel}` : x.title);
    for (const g of clusterPoints(rest, (lat, lng) => map.project([lng, lat]), 36)) {
      if (g.points.length === 1) {
        const x = g.points[0];
        addMarker(makePin(x, () => select(x.id)), [x.lng, x.lat], 'bottom', pinName(x));
      } else if (state.spread && g.points.every((x) => state.spread.has(x.id))) {
        // Places in one spot, spread out round it so each can be picked (a click on the map puts them back).
        const c = map.project([g.lng, g.lat]);
        const radius = Math.max(36, 14 + g.points.length * 7);
        g.points.forEach((x, i) => {
          const a = (i / g.points.length) * 2 * Math.PI - Math.PI / 2;
          const at = map.unproject([c.x + radius * Math.cos(a), c.y + radius * Math.sin(a)]);
          addMarker(makePin(x, () => select(x.id)), [at.lng, at.lat], 'bottom', pinName(x));
        });
      } else {
        const c = clusterPin(g.points, g.points.every((x) => x.dim), g.points.every((x) => x.soft), () => {
          if (together(g.points)) { state.spread = new Set(g.points.map((x) => x.id)); drawPins(); return; }
          map.fitBounds(boundsOf(g.points), { padding: 60, maxZoom: cap(17), duration: 500 });
        });
        addMarker(c, [g.lng, g.lat], 'center', `${g.points.length} places`);
      }
    }
    // Search results not saved yet: near ones are a cluster too, so their names do not pile up.
    for (const g of clusterPoints(state.candidates, (lat, lng) => map.project([lng, lat]), 36)) {
      if (g.points.length > 1) {
        const c = clusterPin(g.points, false, false, () => map.fitBounds(boundsOf(g.points), { padding: 60, maxZoom: cap(17), duration: 500 }));
        c.classList.add('candidate');
        addMarker(c, [g.lng, g.lat], 'center', `${g.points.length} places found`);
        continue;
      }
      const cand = g.points[0];
      const pin = clone('tpl-pin');
      pin.dataset.kind = 'place';
      pin.classList.add('candidate');
      pin.querySelector('.pin-badge').remove();
      setIcon(pin.querySelector('[data-icon]'), 'location-dot');
      pinLabel(pin, cand.title);
      if (state.candidates.length === 1) pin.classList.remove('lowzoom');
      pin.addEventListener('click', (e) => { e.stopPropagation(); draftAt(cand.lat, cand.lng, { title: cand.title, address: cand.sub, origin: cand.key }); });
      addMarker(pin, [cand.lng, cand.lat], 'bottom', `${cand.title}, found by search`);
    }
    for (const x of picked) addMarker(makePin({ ...x, dim: false }, () => {}), [x.lng, x.lat], 'bottom', pinName(x));
    hydrate(root);
    if (keep) {
      const again = markers.map((m) => m.getElement()).find((el) => elementKey(el) === keep);
      if (again) again.focus({ preventScroll: true });
    }
  }

  function drawDraft() {
    if (torn()) return;
    if (draftMarker) { draftMarker.remove(); draftMarker = null; }
    if (!state.draft || !state.map) return;
    const pin = clone('tpl-pin');
    pin.dataset.kind = 'place';
    pin.classList.add('draft');
    pin.querySelector('.pin-badge').remove();
    setIcon(pin.querySelector('[data-icon]'), 'location-dot');
    pin.querySelector('.pin-label').remove();
    draftMarker = new maplibregl.Marker({ element: pin, anchor: 'bottom' }).setLngLat([state.draft.lng, state.draft.lat]).addTo(state.map);
    pin.setAttribute('aria-label', 'The new place');
    hydrate(root);
  }

  // --- saving a new place -------------------------------------------------------------------------------------------

  function setAdding(on) {
    state.adding = Boolean(on) && Boolean(state.adder || state.pick) && Boolean(state.map);
    $('map').classList.toggle('adding', state.adding);
    hide($('banner'), !state.adding);
    syncStatus();
    // Leaving the mode (Escape, Cancel, the + again) without a click gives the editor back unchanged.
    if (!state.adding && state.pick) { state.pick = false; tellPicked(null); }
  }

  // A pin where a place would go, and Places' own dialog for it: the map asks the module that keeps places to open its dialog
  // with this spot filled in (its pane opens if it is not open). The pin stays until the new place arrives, or a minute passes.
  function draftAt(lat, lng, o) {
    if (!state.adder) return;
    state.draft = { lat, lng };
    drawDraft();
    state.candidates = [];
    setAdding(false);
    if (state.map) state.map.easeTo({ center: [lng, lat], zoom: cap(Math.max(state.map.getZoom(), 14)), duration: 500 });
    const before = state.all.length;
    const a = o || {};
    // On a phone the parts are tabs: show the list's, where the dialog opens.
    if (part && state.phone && host.destination) host.destination.set({ reveal: 'panel' }).catch(() => {});
    askNewPlace({ lat, lng, ...(a.title ? { title: a.title } : {}), ...(a.address ? { address: a.address } : {}), ...(a.notes ? { notes: a.notes } : {}), ...(a.origin ? { origin: a.origin } : {}) }, () => { state.draft = null; drawDraft(); });
    waitForSummary(before).then(() => { if (state.draft && state.draft.lat === lat && state.draft.lng === lng) { state.draft = null; drawDraft(); render(); } });
  }
  // The spot a person clicked for the place in the editor (or none: they left the mode), told to the module that keeps places,
  // which brings its editor back. On a phone the list's tab is shown again so the editor is seen.
  function tellPicked(at) {
    if (part && state.phone && host.destination) host.destination.set({ reveal: 'panel' }).catch(() => {});
    if (!state.picked) return;
    // Told to the Places in this page only (the one whose dialog asked), never to one open in another tab.
    host.actions.request(state.picked.action, at ? { lat: at.lat, lng: at.lng } : {}, { here: true }).catch(() => {});
  }
  // Ask the module that keeps places for its dialog. If it says the person may not add places, the add tools go quietly (no
  // message); any other failure is said.
  function askNewPlace(input, failed) {
    // Waits for the answer: Places' refusal comes back in it, not as a failed request.
    const stop = (text) => {
      if (failed) failed();
      if (/may not add/.test(text)) { state.refused = true; state.adder = null; setAdding(false); setBar(); return; }
      say('It could not be started: ' + text);
    };
    host.actions.request(state.adder.action, input, { wait: true }).then((r) => {
      const res = r && r.result;
      if (res && res.ok === false) stop(String(res.error || ''));
    }).catch((err) => stop((err && err.message) || String(err)));
  }
  async function waitForSummary(before) {
    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      await loadFound();
      if (state.all.length > before) return true;
    }
    return false;
  }

  // --- search (only when the admin set an address) ------------------------------------------------------------------

  // What someone sees when they search and no search has been chosen in Places' settings.
  // The search is another module's (found by what it offers, below): say whose, and where it is switched on.
  const noSearch = () => `Search is not set up. It is the ${state.searcher && state.searcher.moduleName ? state.searcher.moduleName : 'place search'} ${word('module')}'s: choose a place search in its configuration (Manage, ${word('module', { many: true, cap: true })}).`;
  let searchToken = 0;
  let hits = [];
  let hit = -1;
  function drawResults() {
    if (torn()) return;
    const list = $('results');
    list.replaceChildren();
    // As the destination's part the results are listed in the panel beside the map; the map draws only their pins.
    if (part) { list.hidden = true; syncStatus(); return; }
    if (state.searchMessage) {
      const li = document.createElement('li');
      li.className = 'note';
      li.textContent = state.searchMessage;
      list.appendChild(li);
    }
    hits.forEach((h, i) => {
      const li = clone('tpl-result');
      fill(li, { title: h.title, sub: h.sub });
      const b = li.querySelector('.result');
      b.dataset.i = String(i);
      if (i === hit) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      list.appendChild(li);
    });
    list.hidden = !list.children.length;
    hydrate(root);
    syncStatus();
  }
  async function search(text) {
    const q = String(text || '').trim();
    const mine = ++searchToken;
    hits = [];
    hit = -1;
    state.searchMessage = '';
    state.candidates = [];
    if (!state.searcher || q.length < 2) { drawResults(); return; }
    try {
      const near = state.map ? state.map.getCenter() : null;
      const out = await host.actions.request(state.searcher.action, { q, ...(near ? { lat: round6(near.lat), lon: round6(near.lng) } : {}) }, { wait: true });
      if (mine !== searchToken) return;
      if (out.status !== 'done' || !out.result || !out.result.ok) {
        state.searchMessage = out.result && /not set up|not configured/.test(out.result.error || '') ? noSearch() : 'Search is not available right now';
      } else {
        const list = out.result.data && Array.isArray(out.result.data.results) ? out.result.data.results : [];
        hits = list.filter((h) => h && geo.inRange(Number(h.lat), Number(h.lng)) && typeof h.title === 'string').slice(0, 6).map((h) => ({ title: oneLine(h.title, 120), sub: oneLine(h.sub, 160), lat: Number(h.lat), lng: Number(h.lng), key: oneLine(h.key, 60) }));
        state.searchMessage = hits.length ? '' : 'No results';
      }
    } catch (err) {
      if (mine !== searchToken) return;
      state.searchMessage = 'Search is not available right now';
    }
    state.candidates = hits;
    fitCandidates();
    drawPins();
    drawResults();
  }
  // Bring what a search found into view: all of them on the map, or the one.
  function fitCandidates() {
    if (!state.map || !state.mapReady || !state.candidates.length) return;
    const b = boundsOf(state.candidates);
    if (state.candidates.length > 1 && (b[0][0] !== b[1][0] || b[0][1] !== b[1][1])) state.map.fitBounds(b, { padding: 70, maxZoom: cap(16), duration: 500 });
    else state.map.easeTo({ center: b[0], zoom: cap(Math.max(state.map.getZoom(), 15)), duration: 500 });
  }
  // On a picture map the outside search is off (it knows only the real world): a name is looked for among the places drawn
  // here, by title and where they are. The first match is selected; several are listed under the field to pick from.
  const NO_SAVED_MATCH = 'No saved places match.';
  const savedMatches = (text) => {
    const q = String(text || '').trim().toLowerCase();
    return q ? state.found.filter((c) => `${c.title} ${c.subtitle || ''}`.toLowerCase().includes(q)) : [];
  };
  function searchSaved(text) {
    searchToken += 1;
    state.candidates = [];
    const list = savedMatches(text);
    hits = list.length > 1 ? list.slice(0, 6).map((c) => ({ title: oneLine(c.title, 120), sub: oneLine(c.subtitle || moduleName(c), 160), id: summaryId(c) })) : [];
    hit = -1;
    state.searchMessage = list.length ? '' : NO_SAVED_MATCH;
    drawPins();
    drawResults();
    if (list.length) select(summaryId(list[0]));
  }
  function pickHit(i) {
    const h = hits[i];
    if (!h) return;
    hits = [];
    state.searchMessage = '';
    clearSearch();
    drawResults();
    if (h.id) select(h.id); // a saved place (a picture map's search)
    else if (state.adder) draftAt(h.lat, h.lng, { title: h.title, address: h.sub, origin: h.key });
    else if (state.map) state.map.easeTo({ center: [h.lng, h.lat], zoom: cap(15) });
  }
  $('results').addEventListener('click', (e) => {
    const b = e.target.closest('.result');
    if (b) pickHit(Number(b.dataset.i));
  });

  // --- the map ------------------------------------------------------------------------------------------------------

  const tokenProbe = (name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    $('app').appendChild(probe);
    const c = rgbOf(getComputedStyle(probe).color);
    probe.remove();
    return c;
  };
  const tokens = () => {
    const t = { bg: tokenProbe('--bg'), section: tokenProbe('--bg-section'), text: tokenProbe('--text'), dim: tokenProbe('--text-dim'), accent: tokenProbe('--accent'), border: tokenProbe('--border') };
    for (const k of Object.keys(t)) if (!t[k]) delete t[k];
    t.blue = tokenProbe('--tint-blue');
    t.green = tokenProbe('--tint-green');
    // The map's own colours (public/sdk/system.css, `--map-*`): used as they are, so the theme can set them.
    const map = {};
    for (const [k, name] of [['land', 'land'], ['water', 'water'], ['park', 'park'], ['wood', 'wood'], ['roadMinor', 'road-minor'], ['roadMedium', 'road-medium'], ['roadMajor', 'road-major'], ['building', 'building'], ['label', 'label'], ['boundary', 'boundary']]) {
      const c = tokenProbe(`--map-${name}`);
      if (c) map[k] = c;
    }
    t.map = map;
    for (const k of ['blue', 'green']) if (!t[k]) delete t[k];
    return t;
  };

  // The credit the licence requires: always there on the world map. A credit the map file's own metadata names (its builder)
  // is added to it. A picture map is not OpenStreetMap's: only the file's own credit (its artist) shows, else no credit.
  function credit(metadata, picture) {
    const box = root.querySelector('.attribution');
    for (const extra of box.querySelectorAll('[data-extra]')) extra.remove();
    hide(slot(box, 'osm'), picture);
    const add = (node) => {
      node.dataset.extra = '1';
      if (box.querySelector('[data-extra]') || !picture) {
        const dot = document.createElement('span');
        dot.dataset.extra = '1';
        dot.textContent = ' · ';
        box.append(dot);
      }
      box.append(node);
    };
    const html = metadata && typeof metadata.attribution === 'string' ? metadata.attribution : '';
    const doc = html ? new DOMParser().parseFromString(html, 'text/html') : null;
    for (const a of doc ? doc.querySelectorAll('a') : []) {
      const text = (a.textContent || '').trim().slice(0, 60);
      if (!text || /openstreetmap/i.test(text)) continue;
      const href = a.getAttribute('href') || '';
      const link = document.createElement('a');
      link.textContent = text;
      if (/^https?:\/\//i.test(href)) { link.href = href; link.target = '_blank'; link.rel = 'noopener'; }
      add(link);
    }
    // A picture's credit may be plain words ("Drawn by ..."), with no link.
    if (picture && doc && !box.querySelector('[data-extra]')) {
      const text = (doc.body.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      if (text) { const span = document.createElement('span'); span.textContent = text; add(span); }
    }
    hide(box, picture && !box.querySelector('[data-extra]'));
  }

  let protocol = null;
  function showState(name) {
    const s = $('state');
    if (!name) { s.hidden = true; s.replaceChildren(); delete s.dataset.kind; return; }
    s.replaceChildren(...parts(name));
    if (name === 'tpl-state-error') s.dataset.kind = 'error'; else delete s.dataset.kind;
    // This module's name, as this environment shows it (host.info's); the markup's own word until it is known.
    for (const el of s.querySelectorAll('[data-slot="own-name"]')) el.textContent = info.module.name || el.textContent;
    for (const el of s.querySelectorAll('[data-slot="maps-app"]')) hide(el, state.picture); // nobody's maps app has an invented world
    s.hidden = false;
    hydrate(s);
  }
  const showError = () => {
    showState('tpl-state-error');
    const retry = $('state').querySelector('[data-action="retry"]');
    if (retry) retry.addEventListener('click', () => startMap());
  };

  async function startMap() {
    if (state.map) { state.map.remove(); state.map = null; state.mapReady = false; clearPins(); setBar(); tellMapOn(); }
    // A picture map replaces the world map for the whole environment while it is set: only its one file is read.
    const picture = state.picture;
    syncPicture();
    const wanted = picture ? [picture.file] : state.settings.maps;
    if (!wanted.length) {
      showState('tpl-state-nomap'); // the same words for everyone: a module can't tell an owner apart without a permission
      tellMapOn();
      render();
      return;
    }
    if (!webgl()) {
      showState('tpl-state-nowebgl');
      tellMapOn();
      render();
      return;
    }
    showState('tpl-state-loading');
    let fileUrls;
    let headers;
    let metadata = null;
    try {
      if (!protocol) { protocol = new pmtiles.Protocol(); maplibregl.addProtocol('pmtiles', protocol.tile); }
      fileUrls = [];
      headers = [];
      for (const name of wanted) {
        const url = state.settings.web && !picture ? name : await fileUrl(name, picture ? PICTURE_FOLDER : '');
        const archive = new pmtiles.PMTiles(url);
        protocol.add(archive);
        headers.push(await archive.getHeader());
        fileUrls.push(url);
        if (!metadata) metadata = await archive.getMetadata().catch(() => null);
      }
    } catch (err) {
      showError();
      render();
      return;
    }
    // A picture map's file holds picture tiles (2 PNG, 3 JPEG, 4 WebP, 5 AVIF); the server refuses anything else there.
    if (picture && !(headers[0].tileType >= 2 && headers[0].tileType <= 5)) {
      showError();
      render();
      return;
    }
    const glyphs = `${location.origin}/maps-glyphs/{fontstack}/{range}.pbf`;
    state.tileUrls = fileUrls.map((u) => `pmtiles://${u}`);
    const header = { centerLon: headers[0].centerLon, centerLat: headers[0].centerLat, minLon: Math.min(...headers.map((h) => h.minLon)), minLat: Math.min(...headers.map((h) => h.minLat)), maxLon: Math.max(...headers.map((h) => h.maxLon)), maxLat: Math.max(...headers.map((h) => h.maxLat)) };
    const options = { container: $('map'), attributionControl: false, renderWorldCopies: false, dragRotate: false, pitchWithRotate: false, fadeDuration: 150 };
    let limits = null;
    if (picture) {
      // The picture's own zooms, two more by stretching its deepest tiles, and panning only over the picture.
      limits = pictureLimits(headers[0], picture);
      state.maxZoom = limits.maxZoom;
      state.landZoom = limits.landZoom;
      // The whole picture is one tile at zoom 0, so the pins' labels show a few levels before its deepest zoom.
      state.labelZoom = Math.max(0, limits.fileMaxZoom - 3);
      state.style = () => buildPictureStyle(tokens(), { tiles: state.tileUrls[0], minZoom: limits.fileMinZoom, maxZoom: limits.fileMaxZoom, bounds: limits.bounds });
      const [[w, s], [e, n]] = limits.bounds;
      Object.assign(options, { minZoom: limits.minZoom, maxZoom: limits.maxZoom, maxBounds: limits.bounds, center: [(w + e) / 2, (s + n) / 2], zoom: limits.minZoom });
    } else {
      state.maxZoom = WORLD_MAX_ZOOM;
      state.landZoom = WORLD_MAX_ZOOM;
      state.labelZoom = 14;
      state.style = () => buildStyle(tokens(), { tiles: state.tileUrls, glyphs });
      Object.assign(options, { maxZoom: WORLD_MAX_ZOOM, center: [header.centerLon, header.centerLat], zoom: 2 });
    }
    const map = new maplibregl.Map({ ...options, style: state.style() });
    map.touchZoomRotate.disableRotation();
    state.map = map;
    setBar();
    map.getCanvas().setAttribute('aria-label', picture ? 'Picture map' : 'Map');
    credit(metadata, Boolean(picture));
    map.on('click', (e) => {
      if (state.adding && state.pick) {
        const at = { lat: round6(e.lngLat.lat), lng: round6(e.lngLat.lng) };
        state.pick = false;
        setAdding(false);
        tellPicked(at);
        return;
      }
      if (state.adding) { draftAt(round6(e.lngLat.lat), round6(e.lngLat.lng)); return; }
      if (state.spread) { state.spread = null; drawPins(); }
      if (state.selected) select(null);
    });
    map.on('moveend', drawPins);
    map.on('moveend', keepView);
    map.once('load', () => {
      state.mapReady = true;
      tellMapOn();
      showState(null);
      const b = boundsOf(state.found.map((c) => c.place));
      const last = lastView();
      if (last) map.jumpTo(last);
      // A picture map opens on the whole picture: the world the places are in.
      else if (limits) map.fitBounds(limits.bounds, { padding: 0, animate: false });
      else if (b && (b[0][0] !== b[1][0] || b[0][1] !== b[1][1])) map.fitBounds(b, { padding: 70, maxZoom: cap(14), animate: false });
      else if (b) map.jumpTo({ center: b[0], zoom: cap(13) });
      else map.fitBounds([[header.minLon, header.minLat], [header.maxLon, header.maxLat]], { padding: 20, animate: false });
      render();
      const want = state.openWanted;
      state.openWanted = null;
      if (want) select(want);
    });
    let failed = false;
    map.on('error', (e) => {
      if (state.mapReady || failed) return;
      // A missing glyph range (a script the labels do not cover) is not the map failing.
      if (/maps-glyphs\//.test(String((e && e.error && (e.error.url || e.error.message)) || ''))) return;
      const status = e && e.error && e.error.status;
      if (status === 404 || status === 401 || status === 403) { failed = true; showError(); }
    });
  }
  // The address of one of this module's files; `folder` names which of its folders (a picture map's is its own).
  async function fileUrl(name, folder) {
    const u = new URL(await host.files.url(name, folder ? { folder } : undefined), location.href);
    if (folder) u.searchParams.set('folder', folder);
    return u.href;
  }
  // What a picture map leaves out, or puts back for the world map: "Show where I am", and the field's words (its search
  // looks only at saved places). The credit and the callout follow state.picture as they are drawn.
  function syncPicture() {
    hide(locateButton, Boolean(state.picture));
    credit(null, Boolean(state.picture)); // the file's own credit, if any, is added once it is read
    setBar(); // the search's words
  }

  // As the destination's part the map opens where it was last left in this browser (plan-map-destination, decision 22);
  // in a space, where that space's map was last left.
  // A picture map's view is kept apart, so the world map's comes back as it was when the picture is cleared.
  const VIEW_KEY = `maps-destination-view${inSpace && info.context.spaceId ? `.${info.context.spaceId}` : ''}`;
  const viewKey = () => (state.picture ? `${VIEW_KEY}.picture` : VIEW_KEY);
  function lastView() {
    if (!part) return null;
    try {
      const v = JSON.parse(localStorage.getItem(viewKey()) || 'null');
      return v && geo.inRange(Number(v.lat), Number(v.lng)) && Number.isFinite(Number(v.zoom)) ? { center: [Number(v.lng), Number(v.lat)], zoom: limit(Math.max(0, Number(v.zoom))) } : null;
    } catch (err) {
      return null;
    }
  }
  let keepTimer = 0;
  function keepView() {
    if (!part || !state.map || !state.mapReady) return;
    clearTimeout(keepTimer);
    keepTimer = setTimeout(() => {
      if (!state.map) return;
      const c = state.map.getCenter();
      try { localStorage.setItem(viewKey(), JSON.stringify({ lat: round6(c.lat), lng: round6(c.lng), zoom: Math.round(state.map.getZoom() * 100) / 100 })); } catch (err) { /* not remembered */ }
    }, 400);
  }

  function webgl() {
    try {
      const c = document.createElement('canvas');
      return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (err) {
      return false;
    }
  }

  // The zoom and locate buttons ("Show where I am" is left out on a picture map: nobody is on an invented world).
  let locateButton = null;
  (function controls() {
    const group = document.createElement('div');
    group.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const button = (icon, label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = label;
      b.setAttribute('aria-label', label);
      const i = document.createElement('span');
      i.className = 'ic';
      i.dataset.icon = icon;
      b.appendChild(i);
      b.addEventListener('click', fn);
      group.appendChild(b);
      return b;
    };
    button('plus', 'Zoom in', () => state.map && state.map.zoomIn());
    button('minus', 'Zoom out', () => state.map && state.map.zoomOut());
    locateButton = button('location-crosshairs', 'Show where I am', () => {
      if (!state.map || !navigator.geolocation || state.picture) return;
      navigator.geolocation.getCurrentPosition((pos) => state.map.easeTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: cap(Math.max(state.map.getZoom(), 14)) }), () => say('Your location is not available here.'), { timeout: 8000 });
    });
    hide(locateButton, Boolean(state.picture));
    $('ctrl-zoom').appendChild(group);
  })();

  // --- events on the page -------------------------------------------------------------------------------------------

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-action]');
    if (!t || t.closest('template')) return;
    const a = t.dataset.action;
    const c = current();
    if (a === 'close-callout') select(null);
    else if (a === 'show-in-list' && part && host.destination) host.destination.set({ reveal: 'panel' }).catch(() => {});
    else if (a === 'cancel') setAdding(false);
    else if (a === 'copy-coords' && c) {
      try { await navigator.clipboard.writeText(coordsText(c.place.lat, c.place.lng)); say('Coordinates copied.'); setTimeout(() => say(''), 2000); } catch (err) { say('Copy them from the place: ' + coordsText(c.place.lat, c.place.lng)); }
    } else if (a === 'open' && c) host.objects.open(c.ref).catch(() => say(`That ${word('object')} could not be opened.`));
  });
  // While a spot is being picked for the editor, focus may be anywhere on the page (the editor's list was the last): Escape leaves
  // the mode wherever it is pressed.
  // Added to the page's document, so it is taken off again when the map's markup goes (letGo).
  document.addEventListener('keydown', (e) => { if (!host.rootElement.isConnected) { letGo(); return; } if (e.key === 'Escape' && state.pick) setAdding(false); }, { signal: alive.signal });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.adding) setAdding(false); else if (hits.length || state.searchMessage) { hits = []; state.searchMessage = ''; state.candidates = []; drawPins(); drawResults(); } else if (state.selected) select(null);
  });

  // An object dropped on the map: one that already has a pin is shown. Anything else goes to the shared decision
  // (host.objects.dropMenu) with the map position under the pointer as the place: whichever module offers to put
  // its object at a position, or to save a place there, is offered, by what it declares, not by name. The map has
  // nothing of its own to offer.
  if (host.objects && host.objects.dropTarget) {
    host.objects.dropTarget({
      over: () => {},
      leave: () => {},
      drop: async (ref, pt, dragged) => {
        if (!(ref || dragged.summary) || !canEdit || !state.map || !state.mapReady) return;
        const hr = host.rootElement.getBoundingClientRect();
        const mr = $('map').getBoundingClientRect();
        const at = state.map.unproject([pt.x + hr.left - mr.left, pt.y + hr.top - mr.top]);
        if (ref) {
          const known = state.found.find((c) => summaryId(c) === host.util.objectKey(ref));
          if (known) return select(summaryId(known));
        }
        try {
          const chosen = await host.objects.dropMenu(dragged, pt, { context: { place: { lat: round6(at.lat), lng: round6(at.lng) } }, remember: 'map' });
          if (!chosen) return;
          await loadFound();
          render();
        } catch (err) {
          say((err && err.message) || String(err));
        }
      },
    });
  }

  // Adding and searching: the host's bands (plan-unified-layout.md). The "+" in the titlebar (host.add.set: a window's,
  // popped out too, the page bar on the module's own page and on the Map destination, the composite's "+" in a Workspace's
  // Map) holds one entry, "Add a place" (a click on the map, then Places' dialog). The search is the toolbar's field
  // (host.toolbar.set), the module's own where it can do something; as the destination's map the page's row has the search.
  let addAsked = '';
  let barAsked = '';
  let searchValue = ''; // the field's text, as the toolbar said it (sent back, so a redraw keeps it; '' clears it)
  // The words, the same as Places': one "Add a place" everywhere. With a map it asks for a click first ("Click the map to place
  // it"), then Places' dialog opens with that spot; with no map to click it opens the dialog at once.
  const ADD_PLACE = 'Add a place';
  const CLICK_TO_ADD = 'Click the map to place it';
  function addEntries() {
    if (!state.adder) return [];
    return [{ id: 'place', label: ADD_PLACE, icon: 'location-dot' }];
  }
  function setBar() {
    // Standing alone (a window or the page, no list part beside it) the field is always there: it goes to a pasted position or link,
    // and searches saved places on a picture map. Beside the list (the destination) the page's own row has the search.
    const field = !part;
    $('results').classList.toggle('under-search', field);
    const words = state.picture ? 'Search saved places' : 'Search, or paste coordinates or a link';
    const bar = field ? [{ type: 'search', id: 'find', value: searchValue, placeholder: words, label: state.picture ? 'Search saved places' : 'Search the map' }] : [];
    const barKey = JSON.stringify(bar);
    if (barKey !== barAsked) {
      barAsked = barKey;
      host.toolbar.set(bar).catch(() => {});
    }
    const list = addEntries();
    const key = list.map((x) => x.id).join();
    if (key !== addAsked) {
      addAsked = key;
      host.add.set(list).catch(() => {});
    }
  }
  function clearSearch() {
    searchValue = '';
    setBar();
  }
  // The toolbar's field: typing is kept (sent back on the next draw); Enter finds it; Escape (the host clears the field) takes
  // the results away too.
  host.on('toolbar', (e) => {
    if (e.id !== 'find') return;
    searchValue = String(e.value ?? '');
    if (e.submit) runFind(searchValue);
    else if (!searchValue && (hits.length || state.searchMessage)) { hits = []; state.searchMessage = ''; state.candidates = []; drawPins(); drawResults(); }
  });
  if (host.add) {
    host.on('add', (e) => {
      // One entry, "Add a place": Places' dialog at once, empty (a place need not be a pin; its Position field has a target that
      // picks the spot on this map).
      if (e.id === 'place' && state.adder) askNewPlace({});
    });
  }
  // The status line under the map: how many places it shows, how many a search found, or what to do while adding one.
  // (Beside a composite's map, the list says which place is selected.)
  function syncStatus() {
    if (!host.status || !state.started) return;
    const n = state.found.length;
    const found = state.candidates.length;
    // The places the search text matches (the others are dimmed): "1 of 5 places shown" while it narrows them.
    const matching = state.q ? state.found.filter((c) => !dimmed(c)).length : n;
    const noun = n === 1 ? 'place' : 'places';
    let shown;
    if (!state.mapReady) shown = n ? `${n} ${noun}, no map drawn` : 'No places'; // a map that is not drawn shows nothing
    else if (!n) shown = 'No places shown';
    else shown = matching === n ? `${n} ${noun} shown` : `${matching} of ${n} ${noun} shown`;
    const items = found ? [{ text: `${found} found` }, { text: shown }] : [{ text: shown }];
    host.status.set(items).catch(() => {});
  }
  // What was typed in the field: a pasted position or map link goes there (or starts a place there);
  // a name is searched for.
  function runFind(raw) {
    const text = String(raw || '').trim();
    if (!text) return;
    const p = parsePoint(text);
    if (p) { if (state.adder) draftAt(p.lat, p.lng); else if (state.map) state.map.easeTo({ center: [p.lng, p.lat], zoom: cap(15) }); return; }
    if (state.picture) { searchSaved(text); return; }
    if (state.searcher) { search(text); return; }
    say(alone ? 'Paste coordinates or a map link to go there.' : `${noSearch()} Paste coordinates or a map link, or click the map.`);
  }

  // Show an object on the map for the person who asked (a view: only their own page does it). The request waits for the page to
  // have started, and the object must be one that has a place.
  let startedResolve;
  const startedPromise = new Promise((r) => { startedResolve = r; });
  if (host.actions && host.actions.provide) {
    host.actions.provide({
      // Places' editor asks for a spot on the map for the place it holds: the map goes into its click-the-map mode (the same as
      // the + on the map) and the next click is told back through `positionPicked`; leaving the mode tells it none. Answers
      // at once; the spot comes back as that request.
      // `pageUntil` (the host's, with `page`): a request the asking page has given up on is refused, so a late start never
      // puts the map into the mode.
      pickPoint: async (input) => {
        await startedPromise;
        if (input && Number(input.pageUntil) < Date.now()) throw new Error('the dialog stopped waiting');
        if (!state.map || !state.mapReady) throw new Error('the map is not ready');
        state.pick = true;
        if (part && state.phone && host.destination) host.destination.set({ reveal: 'main' }).catch(() => {});
        setAdding(true);
        return {};
      },
      showOnMap: async (input) => {
        await startedPromise;
        const id = host.util.objectKey(input.ref);
        if (!state.found.some((c) => summaryId(c) === id)) { await loadFound(); render(); }
        if (!state.found.some((c) => summaryId(c) === id)) throw new Error('that place is not on the map');
        if (state.mapReady) select(id); else state.openWanted = id;
        return {};
      },
    });
  }

  // Asked to show an object on the map (the map shows what has a place): select it when it is there.
  if (host.objects && host.objects.onOpen) {
    host.objects.onOpen((ref) => {
      const id = host.util.objectKey(ref);
      if (state.mapReady) select(state.found.some((c) => summaryId(c) === id) ? id : null); else state.openWanted = id;
    });
  }

  host.on('theme', () => {
    if (!state.map || !state.mapReady) return;
    if (!state.tileUrls || !state.style) return;
    state.map.setStyle(state.style());
  });

  function applySettings(next) {
    // The map files (a list; a single name from before is one file): the host's, all of them, where there are
    // environments; this server's own, the ticked ones, on a single server. Both arrive as the `map` setting's value.
    const files = (Array.isArray(next.map) ? next.map : next.map ? [next.map] : []).slice(0, 20);
    const web = false; // a map at a web address is not offered in this phase (the host's files or nothing)
    const mapChanged = files.join('|') !== state.settings.maps.join('|') || web !== state.settings.web;
    // The picture map (`imageMap`): the environment's fact (host.environment.pictureMap) says whether there is one when the
    // page opens; a change made while it is open (an upload, or the setting cleared) switches the map here and now.
    const image = typeof next.imageMap === 'string' ? next.imageMap : '';
    const imageChanged = state.settings.image !== undefined && image !== state.settings.image;
    if (imageChanged) state.picture = image ? { file: image } : null;
    state.settings = { maps: files, web, image };
    if ((imageChanged || (mapChanged && !state.picture)) && state.started) startMap();
  }
  host.settings.onChange((s) => applySettings(s || {}));

  // Other modules' objects change without telling this page: look again now and then, and when the page comes back.
  const refresh = async () => { await Promise.all([loadFound(), findAdder()]); setBar(); if (state.started) render(); };
  const timer = setInterval(() => { if (!host.rootElement.isConnected) { clearInterval(timer); letGo(); } else refresh(); }, 90000);
  document.addEventListener('visibilitychange', () => { if (!host.rootElement.isConnected) letGo(); else if (!document.hidden) refresh(); }, { signal: alive.signal });

  // --- as the Map destination's main part ------------------------------------------------------------------------------
  // The page owns the filter (Mine, the environment's own, which spaces) and the search field, and hands them over
  // (host.destination.onState); the selection is shared with the panel beside, either may set it. Typing dims the pins
  // that do not match; Enter (`find` raised) searches for new places, whose pins are drawn here and whose rows the panel
  // lists, or with a pasted position starts a new place there.
  let lastFind = null;
  let lastChanged = null; // the list's change counter as last seen
  let changeTimer = 0;
  let lastQ = '';
  // Tell the list beside whether the map is drawn, so it says "On the map" only when that is true.
  let mapOnTold = null;
  function tellMapOn() {
    const on = Boolean(state.mapReady);
    if (!part || !host.destination || on === mapOnTold) return;
    mapOnTold = on;
    host.destination.set({ mapOn: on }).catch(() => {});
  }
  function showWanted(key) {
    if (!state.all.some((c) => summaryId(c) === key)) return false;
    if (state.mapReady) select(key, { quiet: true }); else state.openWanted = key;
    return true;
  }
  function takeState(st) {
    if (!st || typeof st !== 'object') return;
    state.phone = st.phone === true; // the page's parts are tabs (the callout offers Show in list)
    // The list beside says its places changed (another person's new place too): read them again now, not at the next timer.
    const changed = Number(st.changed) || 0;
    if (lastChanged !== null && changed !== lastChanged && state.started) { clearTimeout(changeTimer); changeTimer = setTimeout(() => loadFound().then(() => { if (state.started) render(); }), 200); }
    lastChanged = changed;
    state.filter = { mine: st.mine !== false, environment: st.environment !== false, spaces: Array.isArray(st.spaces) ? new Set(st.spaces.map(String)) : null };
    const text = typeof st.q === 'string' ? st.q.trim() : '';
    const point = text ? parsePoint(text) : null;
    state.q = point ? '' : text.toLowerCase();
    // A place open in the callout that the new text does not match is put away (its pin would be dimmed under it).
    if (state.q !== lastQ) { lastQ = state.q; const open = current(); if (open && state.q && dimmed(open)) select(null); }
    if (!text && (hits.length || state.candidates.length)) { searchToken += 1; hits = []; state.searchMessage = ''; state.candidates = []; }
    applyFilter();
    if (state.started) render();
    // Mine or the environment's own turned on for the first time: read them now.
    if (state.started && ((state.filter.mine && !state.read.person) || (state.filter.environment && !state.read.environment))) loadFound().then(() => render());
    const find = Number(st.find) || 0;
    if (lastFind === null) lastFind = find; // what the page held when this part came: nothing asked yet
    else if (find !== lastFind) {
      lastFind = find;
      if (point) { if (state.adder) draftAt(point.lat, point.lng); else if (state.map) state.map.easeTo({ center: [point.lng, point.lat], zoom: cap(15) }); }
      else if (text && state.picture) {
        // A picture map: the first saved place that matches (the pins that do not are already dimmed).
        const first = savedMatches(text)[0];
        if (first) select(summaryId(first));
        else { say(NO_SAVED_MATCH); setTimeout(() => say(''), 3000); }
      } else if (text && state.searcher) search(text);
    }
    const sel = st.selected && typeof st.selected === 'object' ? host.util.objectKey(st.selected) : '';
    if (sel === told) return;
    told = sel;
    if (!sel) { if (state.selected) select(null, { quiet: true }); return; }
    // A place the panel picked that the map has not read yet (one just saved): read again, then show it.
    if (!showWanted(sel)) loadFound().then(() => { if (told === sel && showWanted(sel)) return; render(); });
  }
  if (part && host.destination) host.destination.onState(takeState);

  // --- start --------------------------------------------------------------------------------------------------------

  async function start() {
    try {
      for (const name of new Set([...root.querySelectorAll('[data-icon]'), ...[...root.querySelectorAll('template')].flatMap((t) => [...t.content.querySelectorAll('[data-icon]')])].map((n) => n.dataset.icon).concat(['location-dot', 'map-location-dot', 'link', 'bookmark', 'calendar-check', 'circle-check', 'star']))) if (name) wantIcon(name);
      applySettings((await host.settings.get()) || {});
      await Promise.all([loadFound(), findAdder()]);
      setBar();
      $('msg').hidden = true;
      $('loading').hidden = true;
      $('app').hidden = false;
      state.started = true;
      render();
      startedResolve();
      await startMap();
    } catch (err) {
      $('app').hidden = true;
      showMsg('The map could not load', err.message, start);
    }
  }
  await start();
})();
