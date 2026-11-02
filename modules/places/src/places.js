// The Places module's page: the space's saved places, listed by category, each with an address, an optional position, notes and
// owners. The places live in the module's store (see places-lib.js) and, with a position, give their summary a `place` that a map
// module draws. This page draws into the markup in places.html by cloning its templates and filling their [data-slot] and
// [data-icon] hooks, and toggles the state classes and data attributes CONTRACT.md lists. It builds no markup from strings
// and sets no style (the item menu is placed under the button that opened it). Nothing here names another module.
// As the Map destination's list (plan-map-destination) it lists Mine, the environment's own and each chosen space's places
// in one list, following the page's filter and search (host.destination), and a new place asks where it goes, every time.
// As that list in a space (/map?space=<id>; plan-map-places.md, step 2) it lists this space's, Mine and the environment's
// own by the page's filter there, reads a store only once the filter has it on, and Where offers the same three.
(async () => {
  'use strict';

  // This module runs in a frame (the SDK is a global) or in the page (its SDK is handed to its script); either way it looks
  // elements up in host.root, never in document.
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
    showMsg('Places could not start', err.message, () => location.reload());
    return;
  }
  // On a space's canvas or on the module's own page: a space has its own list; the page has only mine and everyone's.
  const inSpace = info.context.scope === 'space';
  if (!inSpace && info.context.scope !== 'environment') {
    showMsg(`${info.module.name} could not open here.`);
    return;
  }
  // The Map destination's list: Mine, everyone's and the viewer's spaces' places together, beside the map (in a space,
  // this space's, Mine and everyone's). The page draws the filter and the search; this draws no header, view switch or
  // bar of its own.
  const asPart = Boolean(info.context.destination && info.context.destination.part);

  const geo = host.util.geo;
  /*__LIB__*/

  const canEdit = host.can('edit');
  // An invented world drawn from a picture (the environment's picture map): there is no real-world position, so nothing here
  // links to a maps app, copies coordinates or talks of latitude, longitude or an address lookup. Read live: it can change.
  const onPicture = () => Boolean(host.environment && host.environment.pictureMap);
  const personal = Boolean(info.user && info.user.key !== 'guest'); // a guest has no profile, so no personal places
  const apple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
  // On a phone the link opens the person's own maps app; on a desktop it is OpenStreetMap's website, and says so.
  const MAPS_APP = apple || /Android/i.test(navigator.userAgent) ? 'Open in my maps app' : 'Open in OpenStreetMap';
  // The categories are the environment's list (the module's `categories` setting, an owner's to change in Manage), in order:
  // [{ id, label, icon, color }]. This is what it starts as (places-lib.js). A place keeps the id it was saved with; one whose id is
  // not on the list is shown under Other (catRow) and is not rewritten. The five ids from before the library (eat, do, travel) are
  // read as the new ones, and the other way round for a list stored before it. `other` is always on the list.
  const DEFAULT_CATS = DEFAULT_CATEGORIES;
  let cats = DEFAULT_CATS;
  let catsReadDone;
  const catsRead = new Promise((r) => { catsReadDone = r; }); // the owner's list has been read (or could not be)
  const catRow = (id) => findCategory(cats, id) || findCategory(cats, 'other') || cats[cats.length - 1];
  const catOf = (p) => catRow(p.category);
  // What a place is drawn with (icon, colour): its own, else its type's, else its category's (lookOf in places-lib.js).
  const lookFor = (p) => lookOf(p, cats);
  // Colour: a theme tint (the owner's list takes the eight in turn for the grey that means "automatic", a place may choose one) or a
  // colour chosen in the list, used as it is. Set as the element's --tone, with the text colour that reads on it.
  function tone(el, c) {
    el.style.removeProperty('--tone'); el.style.removeProperty('--tone-ink');
    if (c.hex) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.hex.slice(i, i + 2), 16));
      el.style.setProperty('--tone', c.hex);
      el.style.setProperty('--tone-ink', r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#000000' : '#ffffff');
    } else el.style.setProperty('--tone', `var(--tint-${c.tint})`);
  }
  const useCats = (v) => {
    const list = v && Array.isArray(v.categories) ? v.categories.filter((c) => c && typeof c.id === 'string' && typeof c.label === 'string' && c.label) : [];
    cats = list.length && list.some((c) => c.id === 'other') ? list.map((c) => ({ id: c.id, label: c.label, icon: c.icon || 'note-sticky', color: c.color || AUTO_COLOR })) : DEFAULT_CATS;
    if (state.cat && !cats.some((c) => c.id === state.cat)) state.cat = '';
  };

  // Two stores of the same kind of thing: this space's, and the person's own (private, in their profile, the same in every space).
  // `places` is whichever the person is looking at.
  // Beside the map, each of the viewer's spaces has a store too, keyed 'in:<space id>' (see addSpaceStore below). A place is
  // known by where it is (`w`, a store's key) and its id: two stores may hold the same id.
  // A place is kept in one store (its home) and may be marked into spaces and saved to a person's list (plan-places-library,
  // Part A): `saved` is that list, the person's bookmarks, in their own store.
  const here = inSpace ? String(info.context.spaceId) : null;
  const stores = { space: createPlaces(host, { scope: 'space', here }), my: createPlaces(host, { scope: 'person' }), global: createPlaces(host, { scope: 'environment' }) };
  const saved = personal ? createBookmarks(host) : null;
  const loadedStores = new Set();
  const ensureLoaded = (v) => { if (loadedStores.has(v) || !stores[v]) return Promise.resolve(); loadedStores.add(v); return stores[v].load().catch((err) => { loadedStores.delete(v); throw err; }); };
  let view = inSpace ? 'space' : 'my';
  const spaceInfo = new Map(); // beside the map: space id -> { id, name, icon, svg, write }, from host.spaces()
  // A module that can show a place on a map, if one is installed: found by what it offers, never by name.
  let showAction = null;
  async function findShowAction() {
    try {
      const list = await host.actions.list({ accepts: 'places:place' });
      showAction = list.find((a) => a.name === 'showOnMap') || null;
    } catch (err) {
      showAction = null;
    }
  }
  // A module that can pick a spot on its map for the place being added, found by what it offers (`pickPoint`) and open in this
  // page (the host's `open`): the target button beside Position shows only while there is one, since only the map in this
  // page may answer it. Asked again each time the dialog opens: a map may have come or gone.
  let pickAction = null;
  async function findPickAction() {
    try {
      const list = await host.actions.list();
      pickAction = list.find((a) => a.name === 'pickPoint' && a.open === true) || null;
    } catch (err) {
      pickAction = null;
    }
  }
  const state = {
    people: [],
    filter: '',
    cat: '',
    loaded: false,
    links: new Map(), // place id -> summaries of what other modules point at it
    editing: null, // { id | null, version, point: {lat, lng} | null, pointOk, conflict, origin (the search result it came from) }
    menuFor: null,
    armed: null,
    search: false, // whether a place search is set up
    searchCredit: '', // what to say about it under the results
    mapOn: false, // beside the map: the map is drawn (a map file is in use and the device can draw it), as the map says
    dest: null, // beside the map: the page's filter, { mine, environment, spaces: Set | null }; null shows everything
    q: '', // beside the map: the page's search text as typed
    selected: '', // beside the map: the selected place, `${w}/${id}`, shared with the map through the page
  };
  const nameOf = (key) => (state.people.find((p) => p.key === key) || {}).name || '';
  const initial = (key) => (nameOf(key)[0] || '?').toUpperCase();

  // --- small helpers ------------------------------------------------------------------------------------------------

  const clone = (id) => $(id).content.firstElementChild.cloneNode(true);
  const hide = (node, yes) => { if (node) node.hidden = Boolean(yes); };
  const slot = (el, name) => (el.dataset.slot === name ? el : el.querySelector(`[data-slot="${name}"]`));
  // Set a slot's text, or hide the slot when there is nothing to show.
  function fill(el, values) {
    for (const [name, value] of Object.entries(values)) {
      const s = slot(el, name);
      if (!s) continue;
      s.textContent = value == null ? '' : String(value);
      s.hidden = value === '' || value == null;
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
  // Where a place is, for the host: a pointer's options, and the store a pointer names.
  const whereOpts = (w) => (w === 'my' ? { scope: 'person' } : w === 'global' ? { scope: 'environment' } : w.startsWith('in:') ? { space: w.slice(3) } : {});
  const placeRef = (w, id) => host.objects.make('place', id, whereOpts(w));
  // A store's key for a home ({ scope, space? }) and back: 'global', 'my', 'space' (the space this page is in) or 'in:<id>'.
  const wOfHome = (h) => (h.scope === 'person' ? 'my' : h.scope === 'environment' ? 'global' : inSpace && h.space === here ? 'space' : `in:${h.space}`);
  const homeOfW = (w) => (w === 'global' ? { scope: 'environment' } : w === 'my' ? { scope: 'person' } : w === 'space' ? { scope: 'space', space: here } : { scope: 'space', space: w.slice(3) });
  const whereOfRef = (ref) => (ref.scope === 'person' || ref.scope === 'environment' || (ref.scope === 'space' && ref.space) ? wOfHome(ref) : ref.scope === 'space' && inSpace ? 'space' : null);
  const rowKey = (w, id) => `${w}/${id}`;
  // Who may change the places in a store. On the module's own pages, as before: this module's edit permission here (Mine
  // and everyone's need a signed-in person). Beside the map: Mine and everyone's by the edit permission at the environment,
  // a space's where host.spaces() says `write` there; in a space, this space's and everyone's by the edit permission here, as
  // its canvas has it. Another space's store is never written from a space's canvas (the host refuses it), so only marks
  // reach other spaces from there. The server decides again on every write.
  function writable(w) {
    if (w === 'saved') return false;
    if (w.startsWith('in:')) { if (inSpace) return false; const r = spaceInfo.get(w.slice(3)); return Boolean(r && r.write === true); }
    if (w === 'my' || w === 'global') return personal && canEdit;
    if (w === 'space') return inSpace && canEdit;
    return false;
  }
  // The environment's own places are named by the environment's name (info.context.environment.name), as the Map
  // destination's filter names them (decision 19); "Everyone" only where the name is not known.
  const everyoneName = () => (info.context.environment && info.context.environment.name) || 'Everyone';
  const everyoneIn = () => (info.context.environment && info.context.environment.name ? `Everyone in ${info.context.environment.name}` : 'Everyone');
  // A space's own name: this one's from host.space(), another's from host.spaces().
  const spaceName = (id) => (id === here && host.space && host.space() && host.space().name) || (spaceInfo.get(id) || {}).name || word('space', { cap: true });
  const whereName = (w) => (w === 'my' ? 'Mine' : w === 'global' ? everyoneName() : w === 'space' ? `This ${word('space')}` : (spaceInfo.get(w.slice(3)) || {}).name || word('space', { cap: true }));
  // What the viewer may tick in Shows in. Everyone, Mine and this space by the stores' rights; another space as the place's
  // home only from an environment page, and as a mark wherever host.spaces() says they may add places there.
  const canEveryone = () => writable('global');
  const canHere = () => inSpace && writable('space');
  const canMine = () => writable('my');
  const canMark = (id) => (inSpace && id === here ? canHere() : Boolean(spaceInfo.get(id) && spaceInfo.get(id).write === true));
  const otherSpaces = () => [...spaceInfo.values()].filter((r) => r.id !== here);
  // Adding is one system everywhere (the module's pages, a pop-out, the Map's list): a new place may be added when any tick
  // of Shows in is open to the viewer.
  const canAdd = () => canEveryone() || canHere() || canMine() || (!inSpace && otherSpaces().some((r) => r.write === true));
  // The stores shown: the view's on the module's own pages; beside the map, those the page's filter has on (in a space,
  // this space's among them).
  function shownWheres() {
    if (!asPart) return [view];
    const f = state.dest;
    const out = [];
    if (inSpace && (!f || !f.spaces || f.spaces.has(String(info.context.spaceId)))) out.push('space');
    if (personal && (!f || f.mine)) out.push('my');
    if (!f || f.environment) out.push('global');
    for (const id of spaceInfo.keys()) if (!f || !f.spaces || f.spaces.has(id)) out.push(`in:${id}`);
    return out;
  }
  // What is listed: the union of what the viewer may read, each place once, keyed by its home (shownOnce). A space's list is
  // the places kept there and the environment's marked for it; Mine is the person's own places and the ones they saved.
  let spacesKnown = false; // host.spaces() has answered (so a space missing from it is one the viewer is not in)
  function entries() {
    const env = stores.global.list();
    const groups = [];
    for (const v of shownWheres()) {
      if (v === 'my') { groups.push(stores.my.list().map((p) => ({ p, w: 'my' })), savedEntries()); continue; }
      if (v === 'global') { groups.push(env.map((p) => ({ p, w: 'global' }))); continue; }
      groups.push((stores[v] ? stores[v].list() : []).map((p) => ({ p, w: v })));
      groups.push(markedFor(env, v === 'space' ? here : v.slice(3)).map((p) => ({ p, w: 'global' })));
    }
    return shownOnce(groups);
  }
  // A saved place, followed to where it is now (through a forward when it moved): { p, w }, or the bookmark itself when it
  // is not readable here: `remote` (in another space, which a space's canvas does not read) or `gone` (deleted, or no
  // longer shared with this person).
  function followPlace(w, id) {
    for (let hop = 0; hop < 4; hop += 1) {
      if (w.startsWith('in:') && spacesKnown && !spaceInfo.has(w.slice(3))) return { gone: true };
      const s = stores[w];
      if (!s || !loadedStores.has(w)) return { remote: true };
      const p = s.get(id);
      if (p) return { p, w };
      const f = s.forwardOf(id);
      if (!f) return { gone: true };
      w = wOfHome(f.movedTo);
    }
    return { gone: true };
  }
  function savedEntries() {
    if (!saved) return [];
    return saved.list().map((b) => {
      const found = followPlace(wOfHome(b.ref), b.ref.id);
      if (found.p) return found;
      const p = cleanPlace(b.key, { title: b.title || 'A place' });
      return { p, w: 'saved', bookmark: b, state: found.remote ? 'remote' : 'gone' };
    });
  }
  const placeAt = (w, id) => (w && stores[w] ? stores[w].get(id) : null);
  const savedAt = (key) => (saved ? saved.list().find((b) => b.key === key) || null : null);

  // The pane's width, not the window's: a bundled module runs in the page, so a media query would follow the window.
  const fit = () => {
    const w = host.rootElement.clientWidth;
    if (w) $('app').classList.toggle('narrow', w < 720);
  };
  fit();
  new ResizeObserver(fit).observe(host.rootElement);

  // --- the list -----------------------------------------------------------------------------------------------------

  // The filter looks at the title, address and notes, and at the type's name and the other words it is found by.
  const matches = (p, q) => {
    if (!q) return true;
    const t = typeOf(p.type);
    return [p.title, p.address, p.notes, ...(t ? [t.label, ...t.aliases] : [])].some((x) => x.toLowerCase().includes(q));
  };
  const visible = () => {
    const q = state.filter.trim().toLowerCase();
    return entries().filter((x) => matches(x.p, q));
  };

  // What other modules point at each place (asked once per place, all the places not yet asked in one request; the 'links' event
  // clears it).
  const asked = new Set();
  async function loadLinks() {
    if (!host.objects || !host.objects.linksToAll) return;
    const todo = [];
    for (const { p, w } of entries()) { // personal places are not linked
      if (w === 'my' || w === 'saved') continue;
      const key = rowKey(w, p.id);
      if (asked.has(key)) continue;
      asked.add(key);
      todo.push({ key, ref: placeRef(w, p.id) });
    }
    if (!todo.length) return;
    let changed = false;
    try {
      const answer = await host.objects.linksToAll(todo.map((x) => x.ref));
      const byRef = new Map((Array.isArray(answer) ? answer : []).map((x) => [host.util.objectKey(x.ref), x.summaries]));
      for (const { key, ref } of todo) {
        const summaries = byRef.get(host.util.objectKey(ref));
        if (summaries && summaries.length) { state.links.set(key, summaries); changed = true; }
      }
    } catch (err) {
      for (const { key } of todo) asked.delete(key); // asked again next time
    }
    if (changed) render();
  }
  if (host.on) host.on('links', () => { asked.clear(); state.links.clear(); loadLinks().catch(() => {}); });

  const linkPill = (summary) => {
    const el = clone('tpl-link');
    setIcon(el.querySelector('[data-icon]'), (summary.module && summary.module.icon) || 'link');
    fill(el, { kind: summary.kindName || summary.kind || '', title: summary.title || '' });
    return el;
  };

  // Beside the map each place says whose it is: the person mark for Mine, the globe for everyone's, a space's own icon.
  function scopeMark(el, w) {
    const mark = el.querySelector('.scope-mark');
    if (!mark) return;
    if (!asPart) { mark.remove(); return; }
    const ic = mark.querySelector('.ic');
    const r = w.startsWith('in:') ? spaceInfo.get(w.slice(3)) : null;
    if (r && r.svg) { ic.innerHTML = r.svg; ic.dataset.shown = 'space'; } else setIcon(ic, w === 'my' ? 'user' : w === 'global' ? 'globe' : 'users');
    fill(mark, { scope: whereName(w) });
    mark.hidden = false;
  }

  // The spaces a place is marked into that the viewer is in, named on its row; the space being looked at is left out (the
  // row is in its list already). Other spaces are not named or counted.
  function markNames(p) {
    const viewing = (inSpace && (asPart || view === 'space')) ? here : null;
    return p.spaces.filter((id) => id !== viewing && (id === here || spaceInfo.has(id))).map(spaceName);
  }
  function row(p, w, x) {
    const el = clone('tpl-place');
    el.dataset.id = p.id;
    el.dataset.where = w;
    const look = lookFor(p);
    el.dataset.cat = look.cat.id;
    tone(el, look.color);
    if (asPart && state.selected === rowKey(w, p.id)) el.classList.add('on');
    const marks = slot(el, 'marks');
    marks.replaceChildren(...(w === 'global' ? markNames(p) : []).map((name) => { const m = clone('tpl-mark'); fill(m, { name }); return m; }));
    marks.hidden = !marks.children.length;
    if (w !== 'saved') scopeMark(el, w);
    setIcon(el.querySelector('.sdk-card-icon [data-icon]'), look.icon);
    const visit = slot(el, 'visit');
    const st = statusOf(p.status);
    if (st) { setIcon(visit.querySelector('[data-icon]'), st.icon); visit.querySelector('[data-slot="word"]').textContent = st.label; }
    visit.hidden = !st;
    fill(el, { title: p.title, address: p.address });
    // "On the map" only while a map is drawn beside (the Map page says so); otherwise it only has a position.
    const pinned = slot(el, 'pinned');
    const mapText = pinned.querySelector('.pinned-text');
    if (mapText) mapText.textContent = asPart && state.mapOn ? 'On the map' : 'Has a position';
    hide(pinned, !p.point);
    hide(slot(el, 'nopos'), Boolean(p.point));
    const owners = slot(el, 'owners');
    // Someone this page cannot name (the environment's people list leaves out some) is left out, not shown as "?".
    owners.replaceChildren(...p.owners.filter((k) => nameOf(k)).map((k) => { const o = clone('tpl-owner'); o.textContent = initial(k); o.title = nameOf(k); return o; }));
    owners.hidden = !owners.children.length;
    const links = slot(el, 'links');
    links.replaceChildren(...(state.links.get(rowKey(w, p.id)) || []).slice(0, 4).map(linkPill));
    links.hidden = !links.children.length;
    // A saved place this page cannot show: in another space (opened there), or gone or no longer shared.
    if (w === 'saved') {
      el.classList.add('saved-only');
      const b = x && x.bookmark;
      fill(el, { 'saved-state': x && x.state === 'remote' ? `In ${b && b.ref.space ? spaceName(b.ref.space) : word('space', { a: true })}` : 'No longer shared with you' });
      hide(slot(el, 'pinned'), true);
      hide(slot(el, 'nopos'), true);
      const mark = el.querySelector('.scope-mark');
      if (mark) mark.remove();
    }
    return el;
  }

  // Beside the map, with a name typed in the page's search and a place search set up: look for new places, at the list's foot.
  const findMore = () => {
    if (!asPart || !state.search || !state.q || !readEntry(state.q).find) return null;
    const el = clone('tpl-find-more');
    hydrate(el);
    return el;
  };

  // Beside the map (the Map destination's panel, on the /map page or a Workspace's Map): Add a place is the page's "+" once
  // it is known where the viewer may add, and the status line names the selected place and its kind ("Blue Door · Food").
  // The empty state's own button stays: it adds to an empty list.
  const ADD_PLACE = { id: 'place', label: 'Add a place', icon: 'location-dot' };
  // The dialog opens in this part. Where the parts are tabs (a phone) and the map's tab is the one showing, this part is hidden and the
  // dialog would open there, unseen and holding the page: show this part first. Harmless where both parts are on the screen.
  const revealPanel = () => { if (asPart && host.destination) host.destination.set({ reveal: 'panel' }).catch(() => {}); };
  let addAsked = null;
  function syncChrome() {
    if (asPart) {
      const want = state.loaded && canAdd() ? 'place' : '';
      if (want !== addAsked) {
        addAsked = want;
        host.add.set(want ? [ADD_PLACE] : []).catch(() => {});
      }
    }
    if (!state.loaded) return;
    if (asPart) {
      const sel = state.selected ? entries().find((x) => rowKey(x.w, x.p.id) === state.selected) : null;
      host.status.set(sel ? [{ text: sel.p.title }, { text: catOf(sel.p).label }] : []).catch(() => {});
      return;
    }
    // On its own: how many places are listed (of how many, while a filter or a kind narrows them), whose they are, and
    // the filter. The count is quiet while someone types in the filter, so a screen reader does not read every key.
    const total = entries().length;
    const shown = visible().filter((x) => !state.cat || catOf(x.p).id === state.cat).length;
    const typed = state.filter.trim();
    const items = [{ text: shown === total ? `${total} ${total === 1 ? 'place' : 'places'}` : `${shown} of ${total} places`, quiet: Boolean(typed) }];
    if (Object.values(allowed).filter(Boolean).length > 1) items.push({ text: whereName(view) });
    if (state.cat) items.push({ text: catRow(state.cat).label });
    if (typed) items.push({ text: `\u201c${typed.slice(0, 24)}\u201d`, quiet: true });
    host.status.set(items).catch(() => {});
  }
  // Add a place is the "+" in the titlebar: it opens the dialog (its Position field takes pasted coordinates or a map link).
  host.on('add', (e) => { if (e.id === 'place' && canAdd()) { closeFound(); revealPanel(); openEditor(null, null); } });

  function render() {
    syncChrome();
    const all = entries().map((x) => x.p);
    const empty = state.loaded && !all.length;
    const body = $('body');
    if (!state.loaded) { syncToolbar(empty, []); body.replaceChildren(clone('tpl-state-loading')); return; }
    // Beside the map, with nothing on in the page's filter (named Show in a space, with the space word's plural elsewhere).
    if (asPart && !shownWheres().length) {
      const none = clone('tpl-state-none');
      fill(none, { text: `Pick at least one in ${inSpace ? 'Show' : word('space', { many: true, cap: true })}.` });
      body.replaceChildren(none);
      syncToolbar(empty, []);
      return;
    }
    if (empty) {
      syncToolbar(empty, []);
      const st = clone('tpl-state-empty');
      if (asPart) { fill(st, { title: 'No places here yet.' }); hide(st.querySelector('[data-slot="text"]'), true); }
      body.replaceChildren(st);
      hide(body.querySelector('[data-action="add-place"]'), !canAdd());
      const more = findMore();
      if (more) body.append(more);
      hydrate(root);
      return;
    }
    // The category filter: one per category with places, with how many the search leaves in it (one category, or all).
    const searched = visible().map((x) => x.p);
    const counts = Object.fromEntries(cats.map((c) => [c.id, searched.filter((p) => catOf(p).id === c.id).length]));
    syncToolbar(empty, cats.filter((c) => counts[c.id] || state.cat === c.id).map((c) => {
      const look = categoryColor(cats, c);
      return { id: c.id, label: c.label, ...(ICON_NAME.test(c.icon || '') ? { icon: c.icon } : {}), ...(look.tint ? { tint: look.tint } : {}), count: counts[c.id] || 0 };
    }), searched.length);
    // The groups.
    const shown = visible().filter((x) => !state.cat || catOf(x.p).id === state.cat);
    if (!shown.length) {
      const st = clone('tpl-state-noresults');
      // Beside the map the search text is the page's: only a category chip can be cleared from here.
      if (asPart) hide(st.querySelector('[data-action="clear-filter"]'), !state.cat);
      body.replaceChildren(st);
      const more = findMore();
      if (more) body.append(more);
      hydrate(root);
      return;
    }
    const groups = [];
    for (const c of cats) {
      const inCat = shown.filter((x) => catOf(x.p).id === c.id);
      if (!inCat.length) continue;
      const g = clone('tpl-group');
      setIcon(g.querySelector('[data-icon]'), c.icon);
      fill(g, { title: c.label });
      g.querySelector('.rows').replaceChildren(...inCat.map((x) => row(x.p, x.w, x)));
      groups.push(g);
    }
    const more = findMore();
    body.replaceChildren(...groups, ...(more ? [more] : []));
    hydrate(root);
  }
  // A store's change redraws the list when it is shown, and checks the place open in the dialog.
  // Every store can change what is listed (the environment's marks fill a space's list, a saved place fills Mine), so any
  // change redraws.
  // Beside the map, a change (this person's or another's) is told to the map through the page, so its pins follow at once
  // (a counter in the page's state, `changed`; one telling after a burst of changes).
  let tellTimer = 0;
  let tellCount = 0;
  function tellMap() {
    if (!asPart || !host.destination || !state.loaded) return;
    clearTimeout(tellTimer);
    tellTimer = setTimeout(() => { tellCount += 1; host.destination.set({ changed: tellCount }).catch(() => {}); }, 300);
  }
  function watch(key) {
    stores[key].subscribe(() => {
      if (state.loaded) render();
      checkConflict();
      tellMap();
    });
  }
  for (const key of Object.keys(stores)) watch(key);
  if (saved) saved.subscribe(() => { if (state.loaded) render(); });
  // Beside the map: a store for one of the viewer's spaces, reached with { space }.
  function addSpaceStore(id) {
    const key = `in:${id}`;
    if (stores[key]) return stores[key];
    stores[key] = createPlaces(host, { scope: 'space', space: id });
    watch(key);
    return stores[key];
  }

  // The toolbar row: the view switch (whose places) leads it; then the search (on its own; beside the map the page's
  // search filters instead) and the category, one or all, in the row's Filters menu. No filter while there is nothing to
  // filter.
  function syncToolbar(empty, chips, all = 0) {
    const items = [];
    if (!asPart && !empty) items.push({ type: 'search', id: 'search', value: state.filter, placeholder: 'Filter places', label: 'Filter places' });
    if (chips.length) items.push({ type: 'chips', id: 'category', label: 'Category', single: true, value: state.cat || 'all', options: [{ id: 'all', label: 'Every category', count: all }, ...chips] });
    host.toolbar.set(items).catch(() => {});
  }
  host.on('toolbar', (e) => {
    if (e.id === 'search' && !asPart && typeof e.value === 'string') {
      if (e.value === state.filter) return;
      state.filter = e.value;
      render();
    } else if (e.id === 'category' && typeof e.value === 'string') {
      state.cat = e.value === 'all' ? '' : e.value;
      render();
    }
  });

  // Beside the map: mark the selected place (the map's or this list's), and bring it into view when the map picked it.
  function markSelected(scroll) {
    let found = null;
    for (const el of $('body').querySelectorAll('.place-row')) {
      const on = rowKey(el.dataset.where, el.dataset.id) === state.selected;
      el.classList.toggle('on', on);
      if (on) found = el;
    }
    if (found && scroll) found.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    syncChrome();
  }
  // Select a place from the list: the page tells the map, which flies to it.
  let told = null; // the selection last told to the page or heard from it (an object key, '' for none)
  function selectPlace(w, id) {
    state.selected = w && id ? rowKey(w, id) : '';
    markSelected(false);
    if (!host.destination) return;
    const ref = w && id ? placeRef(w, id) : null;
    told = ref ? host.util.objectKey(ref) : '';
    host.destination.set({ selected: ref }).catch(() => {});
  }

  // --- the place menu -----------------------------------------------------------------------------------------------

  function openLinkFor(p) {
    if (p.point) return geo.mapsLink(p.point.lat, p.point.lng, p.title, apple);
    return geo.mapsSearch(p.address || p.title, apple);
  }
  // Delete armed by id, cleared a few seconds after arming so a stray later click cannot delete unarmed.
  const armedDelete = new Set();
  // Set or clear the visit status from the menu: the place is saved as it is with the one field changed.
  async function setStatus(w, p, status) {
    try { await stores[w].save({ ...p, status, by: info.user.key }, stores[w].versionOf(p.id)); } catch (err) { say('It could not be changed: ' + ((err && err.message) || err)); }
  }
  // Mine for a shared place: a bookmark in the person's own store, holding the home's pointer (and the title, to name it
  // when it can no longer be read). Nobody else sees it.
  async function setSaved(w, p, on) {
    const ref = placeRef(w, p.id);
    try {
      if (on) { await saved.add(ref, p.title); say('Added to your list.'); } else { await saved.remove(ref); say('Taken off your list.'); }
    } catch (err) { say('Your list could not be changed: ' + ((err && err.message) || err)); }
  }
  // Where a place shows, in words, for the delete question: its spaces (those the viewer is in), then everyone.
  function showsIn(w, p) {
    if (w === 'global') return [...p.spaces.filter((id) => id === here || spaceInfo.has(id)).map(spaceName), everyoneIn()];
    if (w === 'space' || w.startsWith('in:')) return [spaceName(homeOfW(w).space)];
    return [];
  }
  const andList = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);
  // The modules that point at a place, by name, for the delete question ("The Planner uses it").
  function usedByWords(w, id) {
    const names = [...new Set((state.links.get(rowKey(w, id)) || []).map((x) => x && x.module && x.module.name).filter(Boolean))];
    return names.length ? ` ${andList(names)} ${names.length > 1 ? 'use' : 'uses'} it.` : '';
  }
  // Delete: the place goes for everyone, and from the person's own list.
  async function deletePlace(w, id) {
    const p = placeAt(w, id);
    await stores[w].remove(id);
    if (p && saved && w !== 'my' && saved.has(placeRef(w, id))) saved.remove(placeRef(w, id)).catch(() => {});
  }
  // A saved place this page cannot show: take it off the list, or (in another space) open it there.
  function openSavedMenu(key, button) {
    const b = savedAt(key);
    if (!b) return;
    const x = savedEntries().find((e) => e.w === 'saved' && e.bookmark.key === key);
    const items = [];
    if (x && x.state === 'remote') items.push({ id: 'open-there', label: `Open in ${spaceName(b.ref.space)}`, icon: 'arrow-up-right-from-square', onClick: () => host.objects.open(b.ref).catch(() => say('It could not be opened.')) });
    items.push({ id: 'unsave', label: 'Take off my list', icon: 'bookmark', onClick: () => saved.remove(key).catch((err) => say('Your list could not be changed: ' + ((err && err.message) || err))) });
    host.menu.show({ id: `saved-${key}`, anchor: button, items });
  }
  function openMenu(w, id, button) {
    if (w === 'saved') return openSavedMenu(id, button);
    const p = placeAt(w, id);
    if (!p) return;
    const items = [
      { id: 'edit', label: writable(w) ? 'Edit' : 'View', icon: 'pen', onClick: () => openEditor(w, id) },
    ];
    // In a space: take an environment's place off this space's list (the mark goes; it stays for everyone).
    if (inSpace && w === 'global' && p.spaces.includes(here) && writable('global') && canMark(here)) {
      items.push({ id: 'take-off-here', label: `Take off ${spaceName(here)}`, icon: 'eye-slash', onClick: () => stores.global.mark(id, [], [here], info.user.key).catch((err) => say('It could not be changed: ' + ((err && err.message) || err))) });
    }
    // Mine, for a shared place: on or off the person's own list.
    if (saved && w !== 'my' && canMine()) {
      const on = saved.has(placeRef(w, id));
      items.push({ id: on ? 'unsave' : 'save', label: on ? 'Take off my list' : 'Add to my list', icon: 'bookmark', onClick: () => setSaved(w, p, !on) });
    }
    if (!onPicture()) items.push({ id: 'open-in-maps', label: MAPS_APP, icon: 'arrow-up-right-from-square', href: openLinkFor(p) });
    if (p.point && !onPicture()) {
      items.push({
        id: 'copy-coords',
        label: 'Copy coordinates',
        icon: 'copy',
        onClick: async () => {
          try { await navigator.clipboard.writeText(geo.coordsText(p.point.lat, p.point.lng)); say('Coordinates copied.'); setTimeout(() => say(''), 2000); } catch (err) { say('Copy them from the place: ' + geo.coordsText(p.point.lat, p.point.lng)); }
        },
      });
    }
    if (writable(w)) {
      items.push({
        id: 'status',
        label: 'Status',
        icon: 'flag',
        items: [
          ...STATUSES.map((st) => ({ id: `status-${st.id}`, label: st.label, icon: p.status === st.id ? 'check' : st.icon, onClick: () => setStatus(w, p, p.status === st.id ? '' : st.id) })),
          ...(p.status ? [{ id: 'status-none', label: 'No status', icon: 'xmark', onClick: () => setStatus(w, p, '') }] : []),
        ],
      });
      // Delete removes it for everyone; when it shows in more than one place, the question says where.
      const where = showsIn(w, p);
      items.push({
        id: 'delete',
        label: 'Delete',
        icon: 'trash',
        danger: true,
        onClick: (item, b) => {
          if (!armedDelete.has(id)) {
            armedDelete.add(id);
            const label = b.querySelector('.sdk-menu-label');
            if (label) label.textContent = (where.length > 1 ? `Delete it for everyone? It is in ${andList(where)}.` : 'Delete it?') + usedByWords(w, id);
            setTimeout(() => armedDelete.delete(id), 4000);
            return false;
          }
          armedDelete.delete(id);
          deletePlace(w, id).catch((err) => say('It could not be deleted: ' + ((err && err.message) || err)));
        },
      });
    }
    host.menu.show({ id: `place-${id}`, anchor: button, items });
  }

  // --- the dialog for one place -------------------------------------------------------------------------------------

  const FIELD_WRAPPERS = () => [...$('form').children].filter((n) => !['editor-title', 'f-where', 'f-readonly', 'f-links-out', 'f-used-by', 'f-by', 'f-error'].includes(n.id) && !n.classList.contains('sdk-editor-actions') && !n.classList.contains('readonly') && !n.hasAttribute('data-bar'));

  // --- Shows in: where a place shows, and so where it is kept --------------------------------------------------------
  // A tick per place it can show: Everyone in <environment>, this space (in a space), the other spaces where the viewer may
  // add places (under More on a space's canvas, where they can only be marks), and Mine. The home follows from the ticks
  // (homeFor): Everyone keeps it in the environment with the spaces as marks; one space alone keeps it there; Mine alone keeps
  // it private. One line under the ticks says who will see it. Marks into spaces the viewer is not in are kept as they are
  // while the place stays in the environment (`e.hiddenMarks`), and never shown.
  const ticksNow = () => {
    const e = state.editing;
    const on = (v) => Boolean($('f-where').querySelector(`input[value="${CSS.escape(v)}"]:checked`));
    const spaces = [...$('f-where').querySelectorAll('input[value^="space:"]:checked')].map((i) => i.value.slice(6));
    return { everyone: on('environment'), spaces, mine: on('person'), hidden: e ? e.hiddenMarks : [] };
  };
  // Where the ticks would keep the place, with the marks the viewer cannot see added back when it stays in the environment.
  function targetOf(t) {
    const target = homeFor(t);
    if (target.error) return target;
    if (target.scope === 'environment') target.marks = [...new Set([...target.marks, ...(t.hidden || [])])].slice(0, 20);
    // Another space is kept as a home only from an environment page; a space's canvas reaches only its own store.
    if (target.scope === 'space' && inSpace && target.space !== here) return { error: 'elsewhere', space: target.space };
    return target;
  }
  function whereLine(target) {
    if (target.error === 'none') return 'Pick at least one.';
    if (target.error === 'spaces') return `To show it in more than one ${word('space')}, it must be in ${everyoneName()} too.`;
    if (target.error === 'elsewhere') return `To keep it in ${spaceName(target.space)} alone, add it from ${spaceName(target.space)}.`;
    if (target.scope === 'environment') return `${everyoneIn()} sees it.`;
    if (target.scope === 'space') return `Only people in ${spaceName(target.space)} see it.`;
    return 'Only you see it.';
  }
  // The line, and the note that a private place's notes will be seen once it is shared.
  function sayWhere() {
    const e = state.editing;
    if (!e) return;
    const target = targetOf(ticksNow());
    $('f-where-line').textContent = whereLine(target);
    const sharing = e.where === 'my' && !target.error && target.scope !== 'person' && $('f-notes').value.trim();
    const who = !sharing ? '' : target.scope === 'environment' ? everyoneIn().replace(/^Everyone/, 'everyone') : `everyone in ${spaceName(target.space)}`;
    $('f-where-notes').textContent = sharing ? `Its notes will be seen by ${who}.` : '';
    hide($('f-where-notes'), !sharing);
  }
  function tick(value, label, { checked, enabled, hint }) {
    const el = clone('tpl-tick');
    const input = el.querySelector('input');
    input.value = value;
    input.checked = Boolean(checked);
    input.disabled = !enabled;
    fill(el, { label, hint: hint || '' });
    return el;
  }
  // Draw the ticks for a place (`w` its home, null for a new one) with `ticks` on.
  function fillWhere(w, editable, ticks) {
    const box = $('f-where');
    hide(box, !editable);
    if (!editable) return;
    const t = ticks || { everyone: false, spaces: [], mine: false };
    const rows = [];
    const more = [];
    const nope = 'You cannot add places there.';
    rows.push(tick('environment', everyoneIn(), { checked: t.everyone, enabled: canEveryone(), hint: canEveryone() ? '' : `Only people who can add places for everyone in this ${word('environment')} can tick this.` }));
    if (inSpace) rows.push(tick(`space:${here}`, spaceName(here), { checked: t.spaces.includes(here), enabled: canHere(), hint: canHere() ? '' : nope }));
    // The other spaces: where the viewer may add places, and any the place is in that they are in (shown as it is).
    for (const r of otherSpaces()) {
      const on = t.spaces.includes(r.id);
      if (!(r.write === true) && !on) continue;
      const el = tick(`space:${r.id}`, r.name, { checked: on, enabled: r.write === true, hint: r.write === true ? '' : nope });
      (inSpace ? more : rows).push(el);
    }
    $('f-where-mine').replaceChildren(...(personal ? [tick('person', 'Mine', { checked: t.mine, enabled: canMine(), hint: 'On your own list. Only you see that you saved it.' })] : []));
    $('f-where-ticks').replaceChildren(...rows);
    $('f-where-more-ticks').replaceChildren(...more);
    fill($('f-where-more'), { more: `More ${word('space', { many: true })}` });
    hide($('f-where-more'), !more.length);
    $('f-where-more').open = more.some((el) => el.querySelector('input').checked);
    sayWhere();
  }
  $('f-where').addEventListener('change', () => { editorError(''); sayWhere(); });
  $('f-notes').addEventListener('input', () => { if (state.editing && state.editing.where === 'my') sayWhere(); });

  function fillOwners(selected) {
    const box = $('f-owners');
    box.replaceChildren(...state.people.map((person) => {
      const label = document.createElement('label');
      label.className = 'sdk-choice-row';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = person.key;
      input.checked = selected.includes(person.key);
      const name = document.createElement('span');
      name.textContent = person.name;
      label.append(input, name);
      return label;
    }));
  }
  const ownersChosen = () => [...$('f-owners').querySelectorAll('input:checked')].map((i) => i.value);

  // The position field: a pair of coordinates or a map link. Empty means no position.
  function readPoint() {
    const text = $('f-point').value.trim();
    const e = state.editing;
    if (!text) { e.point = null; e.pointOk = true; $('f-point-note').textContent = ''; return; }
    const pt = geo.parsePoint(text);
    e.point = pt;
    e.pointOk = Boolean(pt);
    $('f-point-note').textContent = onPicture() ? (pt ? 'Position found.' : 'No position in that.') : (pt ? 'Coordinates found.' : 'No coordinates in that.');
  }
  $('f-point').addEventListener('input', readPoint);

  const editorError = (text) => { $('f-error').textContent = text; $('f-error').hidden = !text; };
  const dropConflict = () => { for (const n of $('form').querySelectorAll('[data-bar]')) n.remove(); if (state.editing) state.editing.conflict = null; };
  // The dialog is the editor window (host.ui.editor): over everything (beside the map, over the whole destination page),
  // sized to the form, a sheet on a phone. What the form held when it opened is kept as text (state.editing.opened), so
  // Escape and Close ask "Discard your changes?" only after something changed; a read-only place never asks.
  const formSnapshot = () => JSON.stringify([[...$('f-where').querySelectorAll('input:checked')].map((i) => i.value), $('f-title').value, $('f-address').value, $('f-point').value, $('f-notes').value, ownersChosen(), state.editing ? [state.editing.type, state.editing.category, state.editing.icon, state.editing.color, state.editing.status] : null]);
  const formDirty = () => Boolean(state.editing && state.editing.opened !== undefined && state.editing.opened !== formSnapshot());
  const editor = host.ui.editor($('editor'), { size: 'medium', isDirty: formDirty, onClose: () => { if (!state.picking) state.editing = null; } });

  // --- type, icon, colour and visit status in the form ------------------------------------------------------------
  // One row. Type: host.ui.kindPicker over the library (typing in it searches the names and aliases; the owner's categories are only
  // its group headings), and a type is always set (a place with none stored reads as Custom Location). Icon and colour: two small
  // buttons that each open a list (flyout) below them, the icon's with a search box; the first entry resets it (to the type's icon,
  // to the category's colour) and the current choice is marked. The place's own choice beats the type's, which beats the category's.
  // Visit: four toggle buttons.
  const DEFAULT_TYPE = 'custom';
  let typePicker = null;
  const tintName = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const catIdOf = (t) => { const row = t && findCategory(cats, t.category); return row ? row.id : 'other'; };
  // What the place is drawn with now, from the form's choices (the type's when none is stored: the category's).
  const formLook = () => { const e = state.editing; return lookOf({ category: e.category, type: e.type, icon: e.icon, iconOwn: Boolean(e.icon), color: e.color }, cats); };
  function markLook() {
    const e = state.editing;
    if (!e) return;
    const look = formLook();
    const ib = $('f-icon');
    tone(ib, look.color);
    setIcon(ib.querySelector('[data-icon]'), look.icon);
    ib.setAttribute('aria-label', `Icon, ${e.icon ? iconLabel(e.icon) : 'same as the type'}. Change it`);
    ib.title = 'Icon';
    const cb = $('f-color');
    tone(cb.querySelector('.look-dot'), look.color);
    cb.setAttribute('aria-label', `Colour, ${e.color ? tintName(e.color) : 'same as the category'}. Change it`);
    cb.title = 'Colour';
    hydrate($('f-look'));
  }
  const iconLabel = (name) => { const o = iconOptions(cats).find((x) => x.id === name); return o ? o.label : String(name); };
  function buildPickers() {
    const e = state.editing;
    if (typePicker) typePicker.destroy();
    typePicker = host.ui.kindPicker($('f-type'), {
      label: 'Type',
      groups: typeGroups(cats),
      value: typeOf(e.type) ? e.type : e.id ? '' : DEFAULT_TYPE,
      recent: { key: 'type', max: 4 },
      onChange: (id) => {
        const x = state.editing;
        if (!x) return;
        x.type = id;
        x.category = catIdOf(typeOf(id)); // the category follows the type; it is never its own field
        x.cat = '';
        markLook();
      },
    });
    // A place saved with no type shows its category, not "Custom Location" (a type it never had).
    if (e.id && !typeOf(e.type)) {
      typePicker.set('');
      typePicker.input.placeholder = catRow(e.category).label;
    }
    markLook();
  }

  // A flyout under a button: an optional search box, then a list of choices (role listbox). Up, Down, Home, End and Enter choose,
  // Escape closes only the flyout, Tab leaves it. It goes inside the editor window so it sits over it. entries(): [{ id, label,
  // icon?, col?, words? }]; current(): the id marked; pick(id).
  let openFly = null;
  function closeFly(refocus) {
    if (!openFly) return;
    const f = openFly;
    openFly = null;
    f.pop.remove();
    f.btn.setAttribute('aria-expanded', 'false');
    root.removeEventListener('pointerdown', f.away, true);
    document.removeEventListener('keydown', f.key, true);
    window.removeEventListener('resize', f.place);
    if (refocus) f.btn.focus();
  }
  function flyout(btn, { label, search, entries, current, pick }) {
    if (openFly && openFly.btn === btn) return closeFly(true);
    closeFly();
    const pop = document.createElement('div');
    pop.className = 'sdk-popover sdk-popover-dense pick-pop'; // the SDK's popover surface (the Menus family), placed here
    pop.dataset.for = btn.id;
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', label);
    const box = document.createElement('div');
    box.className = 'pick-list';
    box.id = `${btn.id}-list`;
    box.setAttribute('role', 'listbox');
    box.setAttribute('aria-label', label);
    let input = null;
    if (search) {
      input = document.createElement('input');
      input.type = 'search';
      input.className = 'pick-search';
      input.placeholder = 'Search';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-controls', box.id);
      input.setAttribute('aria-label', `Search ${label.toLowerCase()}`);
      pop.appendChild(input);
    } else {
      box.tabIndex = 0;
    }
    pop.appendChild(box);
    const all = entries();
    const words = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    let shown = [];
    let active = 0;
    const focusEl = input || box;
    const mark = (i) => {
      active = Math.max(0, Math.min(shown.length - 1, i));
      shown.forEach((r, k) => r.el.classList.toggle('active', k === active));
      const r = shown[active];
      if (r) { focusEl.setAttribute('aria-activedescendant', r.el.id); r.el.scrollIntoView({ block: 'nearest' }); } else focusEl.removeAttribute('aria-activedescendant');
    };
    const choose = (i) => { const r = shown[i]; if (!r) return; closeFly(true); pick(r.entry.id); };
    const draw = () => {
      const q = words(input ? input.value : '');
      const now = current();
      box.replaceChildren();
      shown = [];
      const list = all.filter((en) => (en.reset && !q.length) || (!en.reset && (!q.length || q.every((w) => [...words(en.label), ...(en.words || []).flatMap(words)].some((x) => x.startsWith(w))))));
      for (const en of list) {
        const el = document.createElement('div');
        el.className = 'pick-option sdk-kind-option'; // a Menus row (hover, the keyboard cursor, the chosen one)
        el.id = `${btn.id}-o${shown.length}`;
        el.setAttribute('role', 'option');
        el.setAttribute('aria-selected', String(en.id === now));
        if (en.col) { const d = document.createElement('span'); d.className = 'look-dot'; tone(d, en.col); el.appendChild(d); }
        else if (en.icon) { const ic = document.createElement('span'); ic.className = 'ic'; ic.dataset.icon = en.icon; el.appendChild(ic); }
        const t = document.createElement('span');
        t.className = 'pick-name';
        t.textContent = en.label;
        el.appendChild(t);
        const i = shown.length;
        el.addEventListener('mousemove', () => { if (active !== i) mark(i); });
        el.addEventListener('click', () => choose(i));
        box.appendChild(el);
        shown.push({ entry: en, el });
        if (en.reset && list.length > 1) { const sep = document.createElement('div'); sep.className = 'pick-sep'; sep.setAttribute('role', 'presentation'); box.appendChild(sep); }
      }
      if (!shown.length) { const none = document.createElement('div'); none.className = 'pick-none'; none.textContent = 'Nothing matches'; box.appendChild(none); }
      hydrate(box);
      const at = shown.findIndex((r) => r.entry.id === now);
      mark(q.length ? 0 : Math.max(0, at));
    };
    const place = () => {
      if (window.matchMedia('(max-width: 640px)').matches) { pop.style.top = ''; pop.style.left = ''; pop.style.maxHeight = ''; return; }
      const r = btn.getBoundingClientRect();
      const h = Math.min(pop.offsetHeight, 340);
      const up = window.innerHeight - r.bottom < h + 12 && r.top > window.innerHeight - r.bottom;
      pop.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - pop.offsetWidth - 4))}px`;
      pop.style.top = `${up ? Math.max(4, r.top - 4 - h) : r.bottom + 4}px`;
    };
    const key = (ev) => {
      if (!ev.composedPath().includes(pop)) return;
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeFly(true); }
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); mark(active + 1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); mark(active - 1); }
      else if (ev.key === 'Home' && !input) { ev.preventDefault(); mark(0); }
      else if (ev.key === 'End' && !input) { ev.preventDefault(); mark(shown.length - 1); }
      else if (ev.key === 'Enter' || (ev.key === ' ' && !input)) { ev.preventDefault(); ev.stopPropagation(); choose(active); }
      else if (ev.key === 'Tab') closeFly(false);
    };
    const away = (ev) => { const path = ev.composedPath(); if (!path.includes(pop) && !path.includes(btn)) closeFly(false); };
    $('editor').appendChild(pop);
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-controls', box.id);
    openFly = { pop, btn, key, away, place };
    root.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', place);
    if (input) input.addEventListener('input', () => { draw(); place(); });
    draw();
    place();
    focusEl.focus();
  }
  $('f-icon').addEventListener('click', () => {
    const e = state.editing;
    if (!e) return;
    flyout($('f-icon'), {
      label: 'Icon',
      search: true,
      entries: () => {
        const list = iconOptions(cats);
        if (e.icon && !list.some((o) => o.id === e.icon)) list.push({ id: e.icon, label: e.icon, words: [] });
        const base = typeOf(e.type) || {};
        return [{ id: '', label: 'Same as the type', icon: base.icon || catRow(e.category).icon, reset: true }, ...list.map((o) => ({ ...o, icon: o.id }))];
      },
      current: () => e.icon,
      pick: (id) => { e.icon = id; markLook(); },
    });
  });
  $('f-color').addEventListener('click', () => {
    const e = state.editing;
    if (!e) return;
    flyout($('f-color'), {
      label: 'Colour',
      search: false,
      entries: () => [{ id: '', label: 'Same as the category', col: lookOf({ category: e.category, type: e.type }, cats).color, reset: true }, ...TINTS.map((t) => ({ id: t, label: tintName(t), col: { tint: t } }))],
      current: () => e.color,
      pick: (id) => { e.color = id; markLook(); },
    });
  });
  // The status buttons are drawn once when the form opens and then only marked, so the keyboard stays where it is.
  function drawChoices() {
    const status = $('f-status');
    status.replaceChildren(...STATUSES.map((st) => {
      const b = clone('tpl-status-btn');
      b.dataset.value = st.id;
      setIcon(b.querySelector('[data-icon]'), st.icon);
      slot(b, 'label').textContent = st.label;
      return b;
    }));
    markChoices();
    hydrate(status);
  }
  function markChoices() {
    const e = state.editing;
    if (!e) return;
    for (const b of $('f-status').children) { const on = b.dataset.value === e.status; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  }
  $('f-status').addEventListener('click', (ev) => {
    const b = ev.target.closest('.status-btn');
    if (!b || !state.editing) return;
    state.editing.status = state.editing.status === b.dataset.value ? '' : b.dataset.value; // pressing the one that is on clears it
    markChoices();
  });

  // Show a place in the dialog: a new one (`id` null, `seed` its start), or an existing one in the store `where`.
  function openEditor(where, id, seed) {
    closeFly(false);
    const w = id ? where || view : null;
    const p = id ? placeAt(w, id) : null;
    if (id && !p) return;
    if (!id && !canAdd()) return;
    state.editing = { where: w, id: id || null, version: p ? stores[w].versionOf(id) : undefined, point: p ? p.point : (seed && seed.point) || null, pointOk: true, conflict: null, origin: (seed && seed.origin) || '' };
    dropConflict();
    for (const n of $('form').querySelectorAll('.readonly')) n.remove();
    const shown = p || { title: (seed && seed.title) || '', category: (seed && seed.category) || 'other', type: (seed && seed.type) || (id ? '' : DEFAULT_TYPE), icon: '', iconOwn: false, color: '', status: '', address: (seed && seed.address) || '', point: (seed && seed.point) || null, notes: (seed && seed.notes) || '', owners: [], by: '', ref: null };
    const editable = id ? writable(w) : true;
    $('editor-title').textContent = id ? (editable ? 'Change this place' : shown.title) : 'Add a place';
    // Shows in: an existing place's home, the marks the viewer can see (the others are kept, unseen) and whether it is on
    // their list; a new place starts with Everyone and where the person is (defaultTicks).
    let ticks;
    if (p) {
      const seen = p.spaces.filter((s) => s === here || spaceInfo.has(s));
      state.editing.hiddenMarks = p.spaces.filter((s) => !seen.includes(s));
      ticks = ticksOf(homeOfW(w), { spaces: seen }, Boolean(saved && w !== 'my' && saved.has(placeRef(w, id))));
    } else {
      state.editing.hiddenMarks = [];
      const at = asPart ? (inSpace ? 'space' : '') : view;
      ticks = (seed && seed.ticks) || defaultTicks(at, here, { everyone: canEveryone(), here: canHere(), mine: canMine() });
    }
    state.editing.ticks = ticks;
    // Read only where the viewer may not change places: beside the map, say why (it differs from one place to the next).
    const why = asPart && id && !editable ? `Only people who can add places ${w === 'global' ? `for everyone in this ${word('environment')}` : w === 'space' ? `in this ${word('space')}` : `in ${whereName(w)}`} can change this.` : '';
    $('f-readonly').textContent = why;
    hide($('f-readonly'), !why);
    for (const el of FIELD_WRAPPERS()) el.hidden = !editable;
    if (editable) {
      $('f-title').value = shown.title;
      state.editing.category = catOf(shown).id;
      state.editing.cat = shown.category; // kept as it was unless the person chooses another
      Object.assign(state.editing, { type: shown.type || '', icon: shown.iconOwn ? shown.icon : '', color: shown.color || '', status: shown.status || '' });
      buildPickers();
      drawChoices();
      $('f-address').value = shown.address;
      $('f-point').value = shown.point ? geo.coordsText(shown.point.lat, shown.point.lng) : '';
      $('f-point-note').textContent = '';
      $('f-notes').value = shown.notes;
      fillOwners(id ? shown.owners : [info.user.key]);
      fillWhere(w, true, ticks);
    } else {
      fillWhere(w, false);
      const ro = clone('tpl-readonly');
      fill(ro, { type: (typeOf(shown.type) || {}).label || (id ? catOf(shown).label : (typeOf(DEFAULT_TYPE) || {}).label) || 'None', status: (statusOf(shown.status) || {}).label || 'None', address: shown.address || 'None', point: shown.point ? geo.coordsText(shown.point.lat, shown.point.lng) : 'None yet', owners: shown.owners.map(nameOf).filter(Boolean).join(', ') || 'Nobody in particular', notes: shown.notes });
      $('form').prepend(ro); // first in the form: the title is in the window's head
    }
    // Where it is, and what uses it.
    // The target beside Position: only for a place being added or changed in the form, and only while a map can answer.
    $('f-pick').hidden = true;
    findPickAction().then(() => { if (state.editing && editable) $('f-pick').hidden = !pickAction; });
    pictureParts();
    const used = (id && state.links.get(rowKey(w, id))) || [];
    hide($('f-used-by'), !used.length);
    $('f-used-by-links').replaceChildren(...used.map(linkPill));
    $('f-by').textContent = shown.by ? `Last changed by ${nameOf(shown.by) || 'someone'}` : '';
    editorError('');
    hide($('f-save'), !editable);
    hide($('f-delete'), !id || !editable);
    $('f-delete').textContent = 'Delete';
    // Read-only: no Cancel; the window's own Close in the corner is the one Close. The row goes when nothing in it shows.
    hide($('f-cancel'), !editable);
    hide($('f-cancel').parentElement, [...$('f-cancel').parentElement.querySelectorAll('button')].every((b) => b.hidden));
    state.armed = null;
    hydrate($('editor'));
    if (editable) state.editing.opened = formSnapshot();
    // Focus goes back to the place's row after a save (found again by its id, since render() redraws the list), else to
    // whatever had it before.
    editor.open({
      focus: editable ? $('f-title') : null,
      returnTo: id ? () => root.querySelector(`.place-row[data-where="${CSS.escape(w)}"][data-id="${CSS.escape(id)}"]`) : null,
    });
  }
  // What the dialog shows that depends on the picture map (no maps app, Position's wording): when it opens, and again when the
  // picture map is set, replaced or cleared while it is open.
  function pictureParts() {
    const e = state.editing;
    if (!e) return;
    hide($('f-links-out'), !e.id || onPicture());
    $('f-point').placeholder = onPicture() ? 'A position on the map (optional)' : 'Paste coordinates or a map link (optional)';
    const p = e.id ? placeAt(e.where, e.id) : null;
    if (p) $('f-open-in-maps').href = openLinkFor(p);
    $('f-open-in-maps').querySelector('[data-slot="label"]').textContent = MAPS_APP;
  }
  // After a save or a delete, or when the view changes: closes at once, nothing asked.
  function closeEditor() {
    closeFly(false);
    state.picking = false;
    state.editing = null;
    editor.close();
  }

  // Someone else changed the place that is open: say so, and offer their version or keeping mine.
  function checkConflict() {
    const e = state.editing;
    if (!e || !e.id || !writable(e.where) || e.conflict) return;
    const store = stores[e.where];
    const now = store.versionOf(e.id);
    if (!store.get(e.id)) { closeEditor(); return; }
    if (now === e.version) return;
    showConflict(store.get(e.id), now);
  }
  function showConflict(theirs, version) {
    const e = state.editing;
    if (!e) return;
    dropConflict();
    e.conflict = { theirs, version };
    const bar = clone('tpl-conflict');
    fill(bar, { text: 'Someone changed this place while you were editing.' });
    $('form').querySelector('.sdk-editor-actions').before(bar);
    editorError('');
  }
  $('form').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-action]');
    const e = state.editing;
    if (!b || !e || !e.conflict) return;
    if (b.dataset.action === 'use-theirs') {
      const id = e.id;
      dropConflict();
      openEditor(e.where, id);
    } else if (b.dataset.action === 'keep-mine') {
      e.version = e.conflict.version;
      dropConflict();
    }
  });

  // Asked before a change of ticks takes the place away from people (narrowing): Keep it shared puts the ticks back,
  // Take it away saves.
  function askNarrow(text) {
    for (const n of $('form').querySelectorAll('[data-bar="narrow"]')) n.remove();
    const bar = clone('tpl-narrow');
    fill(bar, { text });
    $('form').querySelector('.sdk-editor-actions').before(bar);
    bar.querySelector('[data-action="take-away"]').focus();
  }
  // A new place that repeats one already in the lists: Open it (the one there) or Save anyway.
  function askDuplicate(dup) {
    for (const n of $('form').querySelectorAll('[data-bar="duplicate"]')) n.remove();
    const bar = clone('tpl-duplicate');
    fill(bar, { text: `${dup.p.title} is already in ${dup.w === 'saved' ? 'your list' : whereName(dup.w)}.` });
    bar.dataset.at = rowKey(dup.w, dup.p.id);
    $('form').querySelector('.sdk-editor-actions').before(bar);
    bar.querySelector('[data-action="open-duplicate"]').focus();
  }
  // Open the place that is already there: beside the map it is selected on the map, else its own dialog.
  function openExisting(w, id) {
    if (asPart && placeAt(w, id) && placeAt(w, id).point) selectPlace(w, id);
    closeFound();
    openEditor(w, id);
  }
  $('form').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-action="open-duplicate"], [data-action="save-anyway"]');
    const e = state.editing;
    if (!b || !e) return;
    const bar = b.closest('[data-bar="duplicate"]');
    if (b.dataset.action === 'save-anyway') { e.dupOk = true; bar.remove(); $('form').requestSubmit(); return; }
    const [w, ...rest] = String(bar.dataset.at).split('/');
    const id = rest.join('/');
    closeEditor();
    openExisting(w, id);
  });
  $('form').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-action="keep-shared"], [data-action="take-away"]');
    const e = state.editing;
    if (!b || !e) return;
    for (const n of $('form').querySelectorAll('[data-bar="narrow"]')) n.remove();
    if (b.dataset.action === 'take-away') { e.narrowOk = true; $('form').requestSubmit(); return; }
    fillWhere(e.where, true, e.ticks);
    $('f-where').querySelector('input:not(:disabled)')?.focus();
  });
  // Mine beside a shared home is a bookmark in the person's own store; a private home needs none. After a save or a move the
  // bookmark follows the place's home pointer.
  async function keepSaved(from, to, id, mine, title) {
    if (!saved) return;
    const oldRef = from && from !== 'my' ? placeRef(from, id) : null;
    const newRef = to !== 'my' ? placeRef(to, id) : null;
    if (oldRef && from !== to && saved.has(oldRef)) await saved.remove(oldRef);
    if (newRef && mine && !saved.has(newRef)) await saved.add(newRef, title);
    if (newRef && !mine && saved.has(newRef)) await saved.remove(newRef);
  }

  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const e = state.editing;
    if (!e || !(e.id ? writable(e.where) : canAdd())) return;
    const title = geo.oneLine($('f-title').value, 120);
    if (!title) return editorError('Give the place a name.');
    readPoint();
    if (!e.pointOk) return editorError(onPicture() ? 'That is not a position. Leave it empty, or paste one.' : 'The position is not coordinates or a map link. Leave it empty, or paste one.');
    if (e.conflict) return editorError('Choose Use theirs or Keep mine first.');
    // Where the ticks keep it (its home) and the spaces it is marked into.
    const target = targetOf(ticksNow());
    if (target.error) return editorError(whereLine(target));
    const from = e.id ? e.where : null;
    const to = wOfHome(target);
    if (to.startsWith('in:')) addSpaceStore(to.slice(3));
    if (to !== from && !writable(to)) return editorError('You cannot add places there.');
    const base = e.id ? stores[from].get(e.id) : null;
    if (e.id && !base) return editorError('That place was removed by someone else.');
    // A mark the person adds or takes away must be in a space where they may add places (the ones they cannot see are kept).
    const before = from === 'global' ? base.spaces : [];
    const added = to === 'global' ? target.marks.filter((s) => !before.includes(s)) : [];
    const taken = to === 'global' ? before.filter((s) => !target.marks.includes(s)) : [];
    const refused = [...added, ...taken].find((s) => !canMark(s));
    if (refused) return editorError(`You cannot add places in ${spaceName(refused)}.`);
    // A new place that repeats one in the lists (the same search result, or the same name within about 30 m): asked first.
    if (!e.id && !e.dupOk) {
      const dup = findDuplicate(entries(), { origin: e.origin, title, point: e.point });
      if (dup) return askDuplicate(dup);
    }
    // Narrowing takes it away from people: asked first.
    const narrowing = from ? narrows(homeOfW(from), target) : '';
    if (narrowing && !e.narrowOk) {
      const envName = info.context.environment && info.context.environment.name;
      return askNarrow(narrowing === 'environment' ? (envName ? `People in ${envName} will no longer see it.` : 'Everyone else will no longer see it.') : `People in ${spaceName(homeOfW(from).space)} will no longer see it.`);
    }
    const place = {
      id: e.id || '',
      title,
      category: e.cat && e.category === catRow(e.cat).id ? e.cat : cats.some((c) => c.id === e.category) ? e.category : 'other', // a place keeps its stored id unless the person chose another
      address: geo.oneLine($('f-address').value, 200),
      point: e.point,
      notes: $('f-notes').value,
      owners: ownersChosen(),
      by: info.user.key,
      ref: base ? base.ref : null,
      type: e.type,
      iconOwn: Boolean(e.icon),
      icon: e.icon,
      color: e.color,
      status: e.status,
      spaces: to === 'global' ? target.marks : [],
      ...((base && base.origin) || e.origin ? { origin: (base && base.origin) || e.origin } : {}),
    };
    // The icon drawn is stored on the place (the summary carries it), whoever chose it: its own, else its type's, else its category's.
    place.icon = lookOf(place, cats).icon;
    $('f-save').disabled = true;
    try {
      let done;
      let moved = null;
      if (!e.id) done = await stores[to].save(place);
      else if (from === to && to === 'global' && (added.length || taken.length) && marksOnly(place, base)) done = await stores.global.mark(e.id, added, taken, info.user.key); // a change of ticks only: retried once on a conflict
      else if (from === to) done = await stores[to].save(place, e.version);
      else { moved = await movePlace(stores[from], stores[to], place, e.version); done = moved.place; }
      await keepSaved(from, to, done.id, target.mine, done.title).catch((err) => say('Your list could not be changed: ' + ((err && err.message) || err)));
      if (e.origin) markUsed(e.origin);
      closeEditor();
      if (moved && !moved.forwarded) say(`It moved, but its old copy could not be cleared: ${(moved.error && moved.error.message) || moved.error}`);
      // The same finish wherever it was added. A toast says where it went only when it is not on the list in front of the
      // person. A new place with a position is then shown on the map: selected beside the map, or, on a space's canvas or a
      // pop-out, shown by whatever map offers that (nothing happens when none is open).
      if (!e.id && done) {
        if (e.origin) closeFound();
        if (!entries().some((x) => x.w === to && x.p.id === done.id)) say(`Saved in ${whereName(to)}, which is not shown now.`);
        if (done.point) {
          if (asPart) selectPlace(to, done.id);
          else if (showAction && inSpace) host.actions.request(showAction.action, { ref: placeRef(to, done.id) }).catch(() => {});
        }
      }
    } catch (err) {
      if (err && err.status === 409 && e.id && from === to) {
        const cur = stores[from].get(e.id);
        if (cur) showConflict(cur, stores[from].versionOf(e.id));
        else editorError('That place was removed by someone else.');
      } else editorError('It could not be saved: ' + ((err && err.message) || err));
    } finally {
      $('f-save').disabled = false;
    }
  });
  // The target beside Position: tuck the dialog away (every field kept as it is), ask the map for a spot, and bring the dialog back
  // when the map answers with `positionPicked` (the spot, or none when the person left the mode). A map that does not answer
  // in time, or cannot start, gives the dialog back at once, unchanged.
  let pickTimer = null;
  function resumeEditor(point) {
    clearTimeout(pickTimer);
    if (!state.picking) return;
    state.picking = false;
    if (point) { $('f-point').value = geo.coordsText(point.lat, point.lng); readPoint(); }
    editor.open({ focus: point ? $('f-point') : $('f-pick') });
  }
  // Asked of the map in this page only (`here`): the host gives it a few seconds, after which no map anywhere may take it. When
  // none answered in that time the dialog comes back at once and the target is hidden until the next time the dialog opens
  // and the host says a map is open here.
  $('f-pick').addEventListener('click', async () => {
    if (!pickAction || !state.editing || state.picking) return;
    state.picking = true;
    editor.close();
    pickTimer = setTimeout(() => resumeEditor(null), 120000);
    try {
      const out = await host.actions.request(pickAction.action, {}, { wait: true, here: true });
      if (out.status !== 'done') { pickAction = null; $('f-pick').hidden = true; throw new Error('no map is open'); }
      if (!out.result || !out.result.ok) throw new Error('the map could not start');
    } catch (err) {
      resumeEditor(null);
      say(`The map could not be used: ${(err && err.message) || err}.`);
    }
  });
  // Cancel goes the way the SDK's own Close does (editor.cancel), so it asks "Discard your changes?" after typing.
  $('f-cancel').addEventListener('click', () => editor.cancel());
  $('f-delete').addEventListener('click', async () => {
    const e = state.editing;
    if (!e || !e.id) return;
    if (state.armed !== 'editor') {
      state.armed = 'editor';
      $('f-delete').textContent = 'Delete it?';
      const used = usedByWords(e.where, e.id);
      if (used) editorError(`${used.trim()} It will show as no longer available there.`);
      return;
    }
    state.armed = null;
    try { await deletePlace(e.where, e.id); closeEditor(); } catch (err) { editorError('It could not be deleted: ' + ((err && err.message) || err)); }
  });
  // --- clicks on the page -------------------------------------------------------------------------------------------

  root.addEventListener('click', async (ev) => {
    const t = ev.target.closest('[data-action]');
    const rowEl = ev.target.closest('.place-row');
    if (t && t.dataset.action === 'menu' && rowEl) {
      ev.stopPropagation();
      return openMenu(rowEl.dataset.where, rowEl.dataset.id, t);
    }
    if (t && t.dataset.action === 'add-place') return openEditor(null, null);
    if (t && t.dataset.action === 'find-new') return void (state.q && showFound(state.q, sharedSearch(state.q)));
    if (t && t.dataset.action === 'clear-filter') { if (!asPart) state.filter = ''; state.cat = ''; return render(); }
    const chip = ev.target.closest('.sdk-chip');
    if (chip) { state.cat = chip.dataset.cat === state.cat ? '' : chip.dataset.cat; return render(); }
    if (rowEl && !ev.target.closest('.item-menu')) {
      const w = rowEl.dataset.where;
      if (w === 'saved') return openSavedMenu(rowEl.dataset.id, rowEl.querySelector('.item-menu'));
      const p = placeAt(w, rowEl.dataset.id);
      // Beside the map a place with a position is selected, and the map beside flies to it; one with none opens.
      if (asPart) {
        if (p && p.point) return selectPlace(w, p.id);
        return openEditor(w, rowEl.dataset.id);
      }
      // In a space, a click on a place with a position shows it on the map when something offers that; otherwise it opens
      // the place. (On the environment page that would wait for a map page that is not open.)
      if (p && p.point && showAction && inSpace) return void host.actions.request(showAction.action, { ref: placeRef(w, p.id) }).catch(() => openEditor(w, p.id));
      openEditor(w, rowEl.dataset.id);
    }
  });
  // A place can be dragged out to another module (onto a day of a plan, or a task that links to it): press its row and move.
  // The pointer is the place's in the view it is shown in. A click after the drag is swallowed by the SDK.
  if (host.objects && host.objects.draggable) {
    host.objects.draggable(root, (target) => {
      const row = target.closest && target.closest('.place-row');
      if (!row || !row.dataset.id || row.dataset.where === 'saved' || target.closest('.item-menu, button, a')) return null;
      const p = placeAt(row.dataset.where, row.dataset.id);
      return p ? { kind: 'place', id: p.id, label: p.title, ...whereOpts(row.dataset.where) } : null;
    });
  }
  // Something from another module dropped here: what can be done with it is the shared decision (host.objects.dropMenu).
  // This module's own offer, when the object has a position, is to save it as a place: the editor opens seeded from it,
  // so the person finishes it rather than a copy landing unseen. The modules around add theirs.
  if (host.objects && host.objects.dropTarget) {
    const showDrop = (yes) => $('app').classList.toggle('drop-target', yes);
    const foreign = (ref, dragged) => (ref ? ref.module !== info.module.id : Boolean(dragged && dragged.summary));
    host.objects.dropTarget({
      over: (_pt, ref, dragged) => showDrop(canAdd() && foreign(ref, dragged)),
      leave: () => showDrop(false),
      drop: async (ref, pt, dragged) => {
        showDrop(false);
        if (!canAdd() || !foreign(ref, dragged)) return;
        try {
          const chosen = await host.objects.dropMenu(dragged, pt, {
            context: {},
            own: [{
              id: 'save',
              label: 'Save it as a place',
              run: (ctx) => openEditor(null, null, { title: ctx.summary.title || '', point: ctx.summary.place ? { lat: ctx.summary.place.lat, lng: ctx.summary.place.lng } : null, address: ctx.summary.place && ctx.summary.place.name && ctx.summary.place.name !== ctx.summary.title ? ctx.summary.place.name : '' }),
              // Only offered for an object that is somewhere: the shared menu drops an own offer whose `when` says no.
              when: (ctx) => Boolean(ctx.summary.place),
            }],
            remember: 'pane',
          });
          if (chosen && chosen.id !== 'save') say(`${chosen.label}: done`);
        } catch (err) { say((err && err.message) || String(err)); }
      },
    });
  }
  // Escape in the editor window is the SDK's (host.ui.editor asks about unsaved changes); here it closes the search results.
  root.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (!$('found').hidden) closeFound();
    } else if (ev.key === 'Enter' && ev.target.classList && ev.target.classList.contains('place-row')) {
      ev.target.click();
    }
  });

  // --- adding: the titlebar's "+", and what other modules and pointers ask ------------------------------------------

  // --- find a place (only when the admin set a search address) -----------------------------------------------------

  let searchToken = 0;
  let hits = [];
  // Ask the server to search for places by name: [{ key, title, sub, lat, lng, from }], or an Error. The server looks in the
  // places it has saved first and asks the outside service only for what is missing.
  async function searchFor(q, near) {
    if (!state.search) throw new Error('search is not configured');
    const out = await host.geocode.search(q, near || null);
    if (out.credit) state.searchCredit = out.credit;
    return uniqueResults(out.results || []).slice(0, 6);
  }
  // The same result once: by its key, and by its name, address and position (a service may answer one street three times).
  function uniqueResults(list) {
    const seen = new Set();
    return list.filter((h) => {
      const keys = [h.key ? `k:${h.key}` : '', `n:${String(h.title).toLowerCase()}|${String(h.sub || '').toLowerCase()}|${Number(h.lat).toFixed(4)},${Number(h.lng).toFixed(4)}`].filter(Boolean);
      if (keys.some((k) => seen.has(k))) return false;
      keys.forEach((k) => seen.add(k));
      return true;
    });
  }
  const closeFound = () => { searchToken += 1; hits = []; hide($('found'), true); $('found').replaceChildren(); };
  function foundHead(label, query, closable) {
    const h = clone('tpl-found-head');
    fill(h, { label, query: '\u201c' + query + '\u201d' });
    hide(h.querySelector('.found-close'), !closable);
    return h;
  }
  // Beside the map one search serves the list and the map beside it: the map asks (searchPlaces, near its centre) when the
  // page's search is entered, and the list shows the same answer. Kept a little while, by its text.
  const searches = new Map(); // lower-cased text -> { at, promise }
  const FRESH = 15000;
  function sharedSearch(q, near) {
    const key = q.toLowerCase();
    const known = searches.get(key);
    if (known && Date.now() - known.at < FRESH) return known.promise;
    const promise = searchFor(q, near);
    promise.catch(() => {});
    searches.set(key, { at: Date.now(), promise });
    for (const [k, v] of searches) if (Date.now() - v.at >= FRESH) searches.delete(k);
    return promise;
  }
  const searching = (query) => {
    const box = $('found');
    box.replaceChildren(foundHead('Searching for', query, false), clone('tpl-found-searching'));
    hide(box, false);
  };
  // Enter in the page's search, beside the map: wait a moment for the map's own search (which knows where the map is), and
  // search here if it does not come.
  let findToken = 0;
  function partFind(text) {
    const token = ++findToken;
    searchToken += 1;
    searching(text);
    const started = Date.now();
    const look = () => {
      if (token !== findToken || state.q !== text) return;
      const known = searches.get(text.toLowerCase());
      if (known && Date.now() - known.at < FRESH) return void showFound(text, known.promise);
      if (Date.now() - started >= 1500) return void showFound(text, sharedSearch(text));
      setTimeout(look, 100);
    };
    look();
  }
  async function showFound(query, promise) {
    const mine = ++searchToken;
    searching(query);
    const box = $('found');
    let found;
    try {
      found = await promise;
    } catch (err) {
      if (mine !== searchToken) return;
      const st = clone('tpl-found-state');
      fill(st, { text: 'Search is not available right now.' });
      box.replaceChildren(foundHead('Results for', query, true), st);
      return;
    }
    if (mine !== searchToken) return;
    hits = found;
    if (!found.length) {
      const st = clone('tpl-found-state');
      fill(st, { text: 'Nothing found. Try a fuller name, or paste coordinates or a map link.' });
      box.replaceChildren(foundHead('Results for', query, true), st);
      return;
    }
    const rows = document.createElement('div');
    rows.className = 'found-rows';
    found.forEach((h, i) => {
      const r = clone('tpl-found-row');
      r.dataset.i = String(i);
      // Where it came from; a result already in a list says so, and its button opens that place instead of saving it again.
      const dup = findDuplicate(entries(), { origin: h.key, title: h.title, point: { lat: Number(h.lat), lng: Number(h.lng) } });
      fill(r, { title: h.title, address: h.sub, source: dup ? `Already in ${whereName(dup.w)}` : h.source === 'server' ? 'From earlier searches' : h.from || '' });
      const b = r.querySelector('[data-action="save-found"]');
      if (dup) { r.dataset.dup = rowKey(dup.w, dup.p.id); b.textContent = 'Open it'; }
      hide(b, !dup && !canAdd());
      if (i > 0 || dup) b.classList.remove('btn-primary'); // one main Save in the list: the first result's
      rows.append(r);
    });
    const parts = [foundHead('Results for', query, true), rows];
    if (state.searchCredit) { const c = document.createElement('p'); c.className = 'found-credit'; c.textContent = state.searchCredit; parts.push(c); }
    box.replaceChildren(...parts);
    hydrate(box);
  }
  // A picked result is marked used on the server, which keeps it from being purged. Nothing depends on it, so a failure is ignored.
  const markUsed = (key) => { if (key && host.geocode) host.geocode.used(key).catch(() => {}); };
  // A result saved as a place: its name, address and position (the category is left for the person to set).
  // Beside the map it opens the dialog with the result filled in, so it asks where the place goes.
  function saveFound(i, rowEl) {
    const h = hits[i];
    if (rowEl && rowEl.dataset.dup) {
      const [w, ...rest] = rowEl.dataset.dup.split('/');
      return openExisting(w, rest.join('/'));
    }
    if (!h || !canAdd()) return;
    // The same dialog as every other way to add a place, so it asks where the place goes too.
    // A result that says what it is (an OpenStreetMap tag) takes that type and its category.
    const t = typeFromOsm(h.osm || h.category);
    const row = t ? findCategory(cats, t.category) : null;
    openEditor(null, null, { title: h.title, address: h.sub, point: { lat: h.lat, lng: h.lng }, origin: h.key, ...(t ? { type: t.id, category: row ? row.id : 'other' } : {}) });
  }
  $('found').addEventListener('click', (ev) => {
    const row = ev.target.closest('.found-row');
    if (ev.target.closest('[data-action="close-found"]')) return closeFound();
    if (row) saveFound(Number(row.dataset.i), row);
  });
  $('found').addEventListener('keydown', (ev) => {
    const row = ev.target.closest && ev.target.closest('.found-row');
    if (!row) return;
    if (ev.key === 'Enter') { ev.preventDefault(); saveFound(Number(row.dataset.i), row); }
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const next = ev.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
      if (next) next.focus();
    }
  });

  // On its own the "+" is in the titlebar (a window's, popped out too, or the page bar on the module's own page): it opens
  // the dialog. Beside the map the page's search field and Add a place at the top of the list do this.

  // What other modules may ask of this page, for the person who asked (a view, so only their own page does it): look for a
  // place by name, and open the dialog for a new one where a map was clicked.
  // Said when someone who may not add places asks for the dialog; the Map reads it to take its add tools away quietly.
  const REFUSED = 'you may not add places here';
  if (host.actions && host.actions.provide) {
    host.actions.provide({
      searchPlaces: async (input) => {
        const q = geo.oneLine(input && input.q, 200);
        if (q.length < 2) throw new Error('nothing to look for');
        const near = input && input.lat !== undefined ? { lat: input.lat, lon: input.lon } : null;
        if (!asPart) return { data: { results: await searchFor(q, near) } };
        // Beside the map: the map beside searching for what was entered in the page's search. The list shows it too.
        const promise = sharedSearch(q, near);
        if (q === state.q) { findToken += 1; showFound(q, promise); }
        return { data: { results: await promise } };
      },
      // The colours the owner chose for the categories (not the grey that means automatic), for the map in this page to colour
      // its pins as the list does: { colors: { <id>: '#rrggbb' } }. Waits for the list to have been read.
      categoryColors: async () => {
        await catsRead;
        const colors = {};
        for (const c of cats) { const col = categoryColor(cats, c); colors[c.id] = col.hex || col.tint; }
        return { data: { colors } };
      },
      // The map's answer to the target button: the spot clicked, or none. Asks nothing of anyone who is not picking.
      positionPicked: async (input) => {
        const i = input || {};
        const ok = i.lat !== undefined && i.lat !== null && i.lng !== undefined && i.lng !== null && geo.inRange(Number(i.lat), Number(i.lng));
        resumeEditor(ok ? { lat: geo.round6(Number(i.lat)), lng: geo.round6(Number(i.lng)) } : null);
        return {};
      },
      // Whether this person may add places here, for the map's "+" (it is hidden when not). Waits for the list to have been read:
      // before that the answer would be no for everyone.
      mayAdd: async () => {
        for (let i = 0; i < 50 && !state.loaded; i += 1) await new Promise((r) => setTimeout(r, 100));
        return { data: { may: state.loaded ? canAdd() : true } };
      },
      newPlace: async (input) => {
        if (!canAdd()) throw new Error(REFUSED);
        const i = input || {};
        const has = (x) => x !== undefined && x !== null && x !== '';
        const point = has(i.lat) && has(i.lng) && geo.inRange(Number(i.lat), Number(i.lng)) ? { lat: geo.round6(Number(i.lat)), lng: geo.round6(Number(i.lng)) } : null;
        closeFound();
        revealPanel();
        openEditor(null, null, { title: geo.oneLine(i.title, 120), point, address: geo.oneLine(i.address, 200), notes: String(i.notes || '').slice(0, 1000), origin: geo.oneLine(i.origin, 60) });
        return {};
      },
    });
  }

  // --- what other modules ask: add a place, give one a position, share one --------------------------------------------
  // A place another module adds takes the same default as the form here (Everyone and this space, else this space), or
  // what its `in` asks ("environment space person"); the answer is the home's pointer. A request that is not this person's
  // own never touches a private list: the page carrying it out is someone else's, and their list is theirs.
  const ownRequest = (ctx) => !ctx || !ctx.by || (personal && ctx.by === info.user.key);
  // Where a pointer's place is now (through a forward when it moved): { w, p }, read first when its store is not yet.
  async function placeOfRef(ref) {
    if (!ref || ref.kind !== 'place') throw new Error('that is not a place');
    const id = String(ref.id);
    let w = whereOfRef(ref);
    for (let hop = 0; w && hop < 4; hop += 1) {
      if (w.startsWith('in:') && !inSpace) addSpaceStore(w.slice(3));
      await ensureLoaded(w).catch(() => {});
      const s = stores[w];
      if (!s) break;
      const p = s.get(id);
      if (p) return { w, p };
      const f = s.forwardOf(id);
      if (!f) break;
      w = wOfHome(f.movedTo);
    }
    throw new Error('there is no such place, or it is no longer shared here');
  }
  async function placeWhere(ticks, input, me) {
    const target = homeFor(ticks);
    if (target.error) throw new Error(target.error === 'spaces' ? `to show it in more than one ${word('space')}, it must be in the ${word('environment')} too` : 'say where it goes');
    const to = wOfHome(target);
    if (!writable(to)) throw new Error(REFUSED);
    if (to === 'global' && target.marks.some((sp) => !canMark(sp))) throw new Error(REFUSED);
    await ensureLoaded(to);
    const place = placeFromRequest(input, me);
    place.spaces = target.marks;
    place.icon = lookOf(place, cats).icon;
    const done = await stores[to].save(place);
    if (target.mine) await keepSaved(null, to, done.id, true, done.title);
    return { ref: placeRef(to, done.id) };
  }
  if (host.actions && host.actions.provide) {
    const handlers = {
      // Share a place (the person's own private one, or a shared one into more places): the ticks it has now and the ones
      // `in` asks (Everyone and this space when none), the same move and marks as the form. Local: only the person's own
      // page carries it out, so a private place is never read or moved by anyone else's.
      sharePlace: async (input, ctx) => {
        if (!ownRequest(ctx) || !personal) throw new Error('only that person can share it');
        const { w, p } = await placeOfRef(input && input.place);
        const asked = ticksFromIn(input && input.in, here) || { everyone: canEveryone(), spaces: canHere() ? [here] : [], mine: false };
        const now = ticksOf(homeOfW(w), p, w !== 'my' && saved && saved.has(placeRef(w, p.id)));
        const target = homeFor({ everyone: now.everyone || asked.everyone, spaces: [...now.spaces, ...asked.spaces], mine: now.mine || asked.mine });
        if (target.error) throw new Error(`to show it in more than one ${word('space')}, it must be in the ${word('environment')} too`);
        const to = wOfHome(target);
        if (to !== w && !writable(to)) throw new Error(REFUSED);
        const added = to === 'global' ? target.marks.filter((sp) => !p.spaces.includes(sp)) : [];
        if (added.some((sp) => !canMark(sp))) throw new Error(REFUSED);
        let done;
        if (to === w) done = added.length ? await stores.global.mark(p.id, added, [], info.user.key) : p;
        else done = (await movePlace(stores[w], stores[to], { ...p, spaces: to === 'global' ? target.marks : [], by: info.user.key }, stores[w].versionOf(p.id))).place;
        await keepSaved(w, to, done.id, target.mine, done.title);
        return { ref: placeRef(to, done.id) };
      },
    };
    if (inSpace) {
      // Other modules' requests to add a place, as before only in a space (to that space and, by default, everyone).
      handlers.addPlace = async (input, ctx) => {
        const own = ownRequest(ctx);
        const asked = ticksFromIn(input && input.in, here);
        if (asked && asked.mine && !own) throw new Error('only that person can add to their own list');
        const ticks = asked || defaultTicks('space', here, { everyone: canEveryone(), here: canHere(), mine: own && canMine() });
        return placeWhere(ticks, input, info.user.key || (ctx && ctx.by) || '');
      };
      handlers.setPlacePoint = async (input) => {
        const { w, p } = await placeOfRef(input && input.place);
        if (!writable(w)) throw new Error(REFUSED);
        const place = await stores[w].setPoint(p.id, { lat: input.lat, lng: input.lng });
        return { ref: placeRef(w, place.id) };
      };
    }
    host.actions.provide(handlers);
  }
  if (host.objects && host.objects.onOpen) {
    host.objects.onOpen((ref) => {
      if (ref.module !== info.module.id || ref.kind !== 'place') return;
      if (!whereOfRef(ref)) return;
      // Followed to where the place is now (a pointer to its old home finds its forward); one the viewer cannot read says so.
      // On a module's own page, a place not in the view shown switches to its view first.
      const show = async () => {
        let found;
        try { found = await placeOfRef(ref); } catch (err) { say('This place is no longer shared here.'); return; }
        const { w } = found;
        const id = found.p.id;
        if (!asPart && !entries().some((x) => x.w === w && x.p.id === id) && allowed[w] && w !== view) showView(w);
        if (asPart) selectPlace(w, id);
        openEditor(w, id);
      };
      if (state.loaded) show(); else state.openWanted = show;
    });
  }

  // --- start --------------------------------------------------------------------------------------------------------

  // Whose places: the person's own need a signed-in person (a guest has no profile), and so does everyone's (an environment-wide store).
  const VIEW_NOTES = { my: `Your own places and the ones you saved. Only you see this list, in every ${word('space')}.`, global: `Everyone in this ${word('environment')} sees these, and anyone who can edit can change them.` };
  const allowed = { my: personal, space: inSpace, global: personal };
  const VIEW_OPTIONS = [
    { id: 'my', label: 'Mine', icon: 'user' },
    { id: 'space', label: `This ${word('space')}`, icon: 'users' },
    { id: 'global', label: everyoneName(), icon: 'globe' },
  ].filter((o) => allowed[o.id]);
  if (!asPart) host.add.set(canAdd() ? [ADD_PLACE] : []).catch(() => {});
  const viewSwitch = !asPart && VIEW_OPTIONS.length > 1 ? host.ui.viewSwitch({ id: 'whose', options: VIEW_OPTIONS, value: view, onChange: showView }) : null;
  function showView(next) {
    if (!allowed[next]) next = inSpace ? 'space' : 'my';
    view = next;
    try { localStorage.setItem('places-view', view); } catch (err) { /* not remembered */ }
    viewSwitch?.set(view);
    const note = root.querySelector('[data-slot="view-note"]');
    fill(note, { text: VIEW_NOTES[view] || '' });
    hide(note, !VIEW_NOTES[view]);
    state.links = new Map();
    asked.clear();
    host.menu.close();
    closeFound();
    closeEditor();
    render();
    ensureLoaded(view).then(() => { if (view === next) { render(); loadLinks().catch(() => {}); } }).catch((err) => say('These places could not load: ' + err.message));
  }
  try { const last = localStorage.getItem('places-view'); if (!asPart && allowed[last] && (last !== 'space' || inSpace)) view = last; } catch (err) { /* the default */ }
  if (!asPart && (view !== 'space' || !inSpace)) {
    viewSwitch?.set(view);
    fill(root.querySelector('[data-slot="view-note"]'), { text: VIEW_NOTES[view] || '' });
    hide(root.querySelector('[data-slot="view-note"]'), !VIEW_NOTES[view]);
  }
  // --- as the Map destination's list --------------------------------------------------------------------------------
  // The page owns the filter (Mine, the environment's own, which spaces) and the search field and hands them over
  // (host.destination.onState): typing filters the list, Enter (`find` raised) searches for new places. The selection is
  // shared with the map, either may set it.
  let lastFind = null;
  function takeState(st) {
    if (!st || typeof st !== 'object') return;
    state.dest = { mine: st.mine !== false, environment: st.environment !== false, spaces: Array.isArray(st.spaces) ? new Set(st.spaces.map(String)) : null };
    const text = typeof st.q === 'string' ? st.q.trim() : '';
    const entry = text ? readEntry(text) : null;
    state.q = text;
    state.filter = entry && entry.point ? '' : text; // a pasted position starts a new place (the map asks), it filters nothing
    if (!text) { findToken += 1; closeFound(); }
    const find = Number(st.find) || 0;
    if (lastFind === null) lastFind = find; // what the page held when this part came: nothing asked yet
    else if (find !== lastFind) {
      lastFind = find;
      if (entry && entry.find && state.search) partFind(text);
    }
    state.mapOn = st.mapOn === true;
    const ref = st.selected && typeof st.selected === 'object' ? st.selected : null;
    const sel = ref ? host.util.objectKey(ref) : '';
    const picked = sel !== told; // the map picked another (or none): bring the place into view in the list
    if (picked) {
      told = sel;
      const w = ref && ref.module === info.module.id && ref.kind === 'place' ? whereOfRef(ref) : null;
      state.selected = w ? rowKey(w, ref.id) : '';
    }
    if (!state.loaded) return;
    // A store the filter has just turned on and that has not been read yet (in a space, everyone's starts off): read it.
    for (const w of shownWheres()) if (stores[w] && !loadedStores.has(w)) ensureLoaded(w).then(() => { render(); loadLinks().catch(() => {}); }).catch(() => {});
    render();
    if (picked) markSelected(true);
    loadLinks().catch(() => {});
  }
  // The viewer's spaces (names, icons, where they may add places), for the ticks, the marks on a row and the Map's list. On an
  // environment page their places are read too, in one request (each item with its space); a space's canvas reads only its
  // own store, so another space's places reach it only as the environment's, marked.
  async function loadSpaces() {
    const list = await host.spaces();
    for (const r of list) { spaceInfo.set(r.id, r); if (!inSpace) addSpaceStore(r.id); }
    spacesKnown = true;
    if (inSpace) return;
    const bySpace = new Map();
    for (const it of await host.storage.list('place:', { scope: 'spaces' })) {
      if (!bySpace.has(it.spaceId)) bySpace.set(it.spaceId, []);
      bySpace.get(it.spaceId).push(it);
    }
    for (const id of spaceInfo.keys()) { stores[`in:${id}`].seed(bySpace.get(id) || []); loadedStores.add(`in:${id}`); }
  }
  if (asPart) {
    $('app').classList.add('part');
    $('body').before($('found')); // the results show at the top of the list, not over its foot
    hide(root.querySelector('[data-slot="view-note"]'), true);
    if (host.destination) host.destination.onState(takeState);
  }

  let lastSettings = null;
  let wired = false; // the settings and the environment are listened to once, however many times it is tried
  async function load() {
    $('msg').hidden = true;
    $('loading').hidden = true;
    $('app').hidden = false;
    render();
    try {
      // Everything the viewer may read, at once: this space's (or the view shown), the environment's (its marks fill a space's
      // list), Mine and the saved list, and the spaces. A guest on a guest link reads only the space: none of the
      // environment's places and no list of their own.
      const first = inSpace ? 'space' : asPart ? null : view;
      await Promise.all([
        first ? ensureLoaded(first) : null,
        personal ? ensureLoaded('my').catch(() => {}) : null,
        personal ? ensureLoaded('global').catch(() => {}) : null,
        saved ? saved.load().catch(() => {}) : null,
        personal ? loadSpaces().catch(() => {}) : null,
      ]);
      state.people = await host.people().catch(() => []);
      const useSearch = (v) => { state.search = searchOn(v) && !onPicture(); state.searchCredit = ''; if (!state.search) closeFound(); };
      // The settings arrive before the first list is drawn, and again when the owner saves them (the list is redrawn).
      const useSettings = (v) => { lastSettings = v; useSearch(v); useCats(v); catsReadDone(); if (state.loaded) { render(); hydrate(root); } };
      try { useSettings(await host.settings.get()); } catch (err) { useSettings(null); }
      if (!wired) host.settings.onChange((v) => useSettings(v));
      // The picture map set, replaced or cleared while the page is open (host.environment follows it): the outside search, the
      // dialog's Position wording and links, and the menu (built when it opens, so an open one is closed) follow at once.
      if (!wired) host.on('environment', () => { host.menu.close(); useSettings(lastSettings); pictureParts(); });
      wired = true;
      await Promise.all([...new Set([...root.querySelectorAll('[data-icon]'), ...[...root.querySelectorAll('template')].flatMap((t) => [...t.content.querySelectorAll('[data-icon]')])].map((n) => n.dataset.icon).concat(cats.map((c) => c.icon), ['layer-group', 'link']))].filter(Boolean).map(wantIcon));
      findShowAction();
      state.loaded = true;
      render();
      loadLinks().catch(() => {});
      if (state.openWanted) { const f = state.openWanted; state.openWanted = null; f(); }
    } catch (err) {
      catsReadDone();
      $('app').hidden = true;
      showMsg('The places could not load', err.message, load);
    }
  }
  await load();
})();
