  // The Places module's model: no page in it, so the page and the checks can both use it. A place is one stored value
  // (`place:<id>`): { title, category, address, point?, notes, owners, by, ref?, type?, icon?, iconOwn?, color?, status? }. `point` is a
  // field of its own so the module's summary can name it (a summary's `place`); a place with only an address has none. The page
  // defines `geo` (host.util.geo) and `word` (host.util.word) ahead of this code, as the check does, and the build puts the bundled types library
  // (maps-list-lib-types.json) ahead of it as `LIB_TYPES` (plan-places-library.md, Part B).
  const PLACE_PREFIX = 'place:';
  const CATEGORY_ID = /^[a-z][a-z0-9-]{0,29}$/;
  const ICON_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
  // The grey that means "automatic colour" in the owner's list.
  const AUTO_COLOR = '#888888';
  // The ids the environment's category list starts with (the module's `categories` setting, same rows as the manifest's default).
  // A place keeps whatever id it was saved with, even after the owner takes that category off the list (the page then shows it
  // under Other).
  const DEFAULT_CATEGORIES = [
    { id: 'food', label: 'Food & Drink', icon: 'utensils', color: AUTO_COLOR },
    { id: 'stay', label: 'Accommodations', icon: 'bed', color: AUTO_COLOR },
    { id: 'sights', label: 'Sights & Culture', icon: 'landmark', color: AUTO_COLOR },
    { id: 'nature', label: 'Nature & Outdoors', icon: 'tree', color: AUTO_COLOR },
    { id: 'activities', label: 'Activities & Experiences', icon: 'ticket', color: AUTO_COLOR },
    { id: 'nightlife', label: 'Entertainment & Nightlife', icon: 'masks-theater', color: AUTO_COLOR },
    { id: 'shopping', label: 'Shopping', icon: 'bag-shopping', color: AUTO_COLOR },
    { id: 'transport', label: 'Transportation', icon: 'train', color: AUTO_COLOR },
    { id: 'services', label: 'Services & Essentials', icon: 'circle-info', color: AUTO_COLOR },
    { id: 'health', label: 'Health & Wellness', icon: 'heart-pulse', color: AUTO_COLOR },
    { id: 'other', label: 'Personal & Other', icon: 'location-dot', color: AUTO_COLOR },
  ];
  const CATEGORIES = DEFAULT_CATEGORIES.map((c) => c.id);
  // The five ids a place or a request may still carry from before the library: read as the new ones (stay and other are the same).
  // Nothing is rewritten; a list the owner already stored keeps its own ids, so a lookup tries the id itself first.
  const OLD_CATEGORIES = { eat: 'food', do: 'activities', travel: 'transport' };
  const NEW_FOR_OLD = Object.fromEntries(Object.entries(OLD_CATEGORIES).map(([o, n]) => [n, o]));
  const newCategoryId = (id) => OLD_CATEGORIES[id] || id;
  // The row of a category list for an id: the id itself, else the new or the old id it stands for. null when the list has none.
  const findCategory = (cats, id) => (cats || []).find((c) => c.id === id) || (cats || []).find((c) => c.id === OLD_CATEGORIES[id]) || (cats || []).find((c) => c.id === NEW_FOR_OLD[id]) || null;

  // The library: [{ id, label, category, icon, aliases, osm? }].
  const TYPES = Array.isArray(LIB_TYPES) ? LIB_TYPES : [];
  const TYPE_BY_ID = new Map(TYPES.map((t) => [t.id, t]));
  const typeOf = (id) => TYPE_BY_ID.get(id) || null;
  // The type an OpenStreetMap tag ("amenity:cafe", as a search result carries it) stands for, or null.
  function typeFromOsm(tags) {
    for (const tag of Array.isArray(tags) ? tags : [tags]) {
      if (typeof tag !== 'string' || !tag) continue;
      const t = TYPES.find((x) => Array.isArray(x.osm) && x.osm.includes(tag));
      if (t) return t;
    }
    return null;
  }

  // Visit status: a mark on the place (not a category or a type), one at a time.
  const STATUSES = [
    { id: 'want', label: 'Want to go', icon: 'bookmark' },
    { id: 'booked', label: 'Booked', icon: 'calendar-check' },
    { id: 'visited', label: 'Visited', icon: 'circle-check' },
    { id: 'favorite', label: 'Favorite', icon: 'star' },
  ];
  const statusOf = (id) => STATUSES.find((s) => s.id === id) || null;

  // The eight theme tints, in the order the phases take them (public/phases.js): a category with the automatic colour takes the one
  // at its place in the owner's list, round again after the eighth. A place's own colour is one of these names.
  const TINTS = ['blue', 'green', 'teal', 'purple', 'orange', 'pink', 'gold', 'red'];
  const isHex = (c) => /^#[0-9a-fA-F]{6}$/.test(String(c || ''));
  const asColor = (c) => (TINTS.includes(c) ? { tint: c } : isHex(c) ? { hex: String(c).toLowerCase() } : null);
  // The colour of a category row: the one the owner chose, else its automatic tint. { tint } or { hex }.
  function categoryColor(cats, row) {
    if (row && isHex(row.color) && String(row.color).toLowerCase() !== AUTO_COLOR) return { hex: String(row.color).toLowerCase() };
    const i = (cats || []).findIndex((c) => row && c.id === row.id);
    return { tint: TINTS[(i < 0 ? 0 : i) % TINTS.length] };
  }
  // Any CSS colour for a colour of the kind above.
  const cssColor = (c) => (c.tint ? `var(--tint-${c.tint})` : c.hex);
  // What a place is drawn with. Icon: its own (when the person chose one), else its type's, else its category's. Colour: its own, else
  // its type's (none of the shipped types has one), else the category's chosen colour, else the category's automatic tint.
  function lookOf(p, cats) {
    const list = cats && cats.length ? cats : DEFAULT_CATEGORIES;
    const row = findCategory(list, p.category) || findCategory(list, 'other') || list[list.length - 1];
    const type = typeOf(p.type);
    return {
      cat: row,
      type,
      icon: p.iconOwn && p.icon ? p.icon : type ? type.icon : row.icon,
      color: asColor(p.color) || (type && asColor(type.color)) || categoryColor(list, row),
    };
  }
  // The groups for the Type picker (host.ui.kindPicker): one per category of the list, in its order with Other last; a type whose
  // category is not on the list is in Other. Each option { id, label, icon, color (CSS), words (its aliases) }.
  function typeGroups(cats) {
    const list = cats && cats.length ? cats : DEFAULT_CATEGORIES;
    const other = findCategory(list, 'other') || list[list.length - 1];
    const groups = list.map((c) => ({ id: c.id, label: c.label, options: [] }));
    for (const t of TYPES) {
      const row = findCategory(list, t.category) || other;
      const color = asColor(t.color) || categoryColor(list, row);
      groups.find((g) => g.id === row.id).options.push({ id: t.id, label: t.label, icon: t.icon, color: cssColor(color), words: t.aliases });
    }
    const last = groups.findIndex((g) => g.id === other.id);
    const ordered = [...groups.slice(0, last), ...groups.slice(last + 1), groups[last]];
    return ordered.filter((g) => g.options.length).map(({ label, options }) => ({ label, options }));
  }
  // The icons the Icon picker offers: every icon the library and the category list use, each found by the labels and aliases of
  // the types that use it ("beach" finds the umbrella). [{ id: <icon name>, label, words }].
  function iconOptions(cats) {
    const words = new Map();
    const add = (icon, more) => { if (!words.has(icon)) words.set(icon, new Set(icon.split('-'))); for (const w of more) words.get(icon).add(w); };
    for (const t of TYPES) add(t.icon, [t.label, ...t.aliases]);
    for (const c of [...DEFAULT_CATEGORIES, ...(cats || [])]) add(c.icon, [c.label]);
    for (const s of STATUSES) add(s.icon, [s.label]);
    return [...words].map(([id, w]) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' '), words: [...w] })).sort((a, b) => a.label.localeCompare(b.label));
  }

  // --- belonging: one home, marks into spaces, a private list (plan-places-library.md, Part A) -------------------------
  // A place is kept in one store, its home (the environment's, a space's or a person's), and the home alone decides who
  // can read and change it. `spaces` on the record are marks: the spaces it also shows in. They only filter lists and maps;
  // they let nobody read it who could not already. Mine is a bookmark in the person's own store (`saved:`), never written
  // on the shared record. A place that moves leaves a forward in its old home: `place:<id>` holding only its title and
  // `movedTo`, so a pointer to the old home still resolves.
  const SAVED_PREFIX = 'saved:';
  const MAX_MARKS = 20;
  const MAX_SAVED = 1000;
  const SPACE_ID = /^[A-Za-z0-9_-]{1,64}$/;
  const PLACE_ID = /^[A-Za-z0-9_-]{1,64}$/;
  const cleanMarks = (list) => (Array.isArray(list) ? [...new Set(list.filter((s) => typeof s === 'string' && SPACE_ID.test(s)))].slice(0, MAX_MARKS) : []);
  // A home as stored in a forward or a pointer: { scope: 'environment' | 'person' } or { scope: 'space', space }.
  const cleanHome = (h) => (h && (h.scope === 'environment' || h.scope === 'person') ? { scope: h.scope }
    : h && h.scope === 'space' && typeof h.space === 'string' && SPACE_ID.test(h.space) ? { scope: 'space', space: h.space } : null);
  const sameHome = (a, b) => Boolean(a && b && a.scope === b.scope && (a.scope !== 'space' || a.space === b.space));
  // A forward, or null when the value is not one. It holds the title only: no address, position or notes.
  function cleanForward(v) {
    if (!v || typeof v !== 'object' || !v.movedTo) return null;
    const movedTo = cleanHome(v.movedTo);
    return movedTo ? { title: geo.oneLine(v.title, 120) || 'A place', movedTo } : null;
  }
  const forwardValue = (title, to) => ({ title: geo.oneLine(title, 120), movedTo: cleanHome(to) });

  // The ticks of the form's Shows in: { everyone, spaces: [space id], mine }. The home follows from them, widest first:
  // Everyone keeps it in the environment (the ticked spaces become marks); one space alone keeps it in that space; Mine alone
  // keeps it private in the person's store. Two spaces or more without Everyone is refused for now (`error: 'spaces'`), and
  // nothing ticked is `error: 'none'`. `mine` beside a shared home is a bookmark.
  function homeFor(t) {
    const spaces = cleanMarks(t && t.spaces);
    const mine = Boolean(t && t.mine);
    if (t && t.everyone) return { scope: 'environment', marks: spaces, mine };
    if (spaces.length > 1) return { error: 'spaces' };
    if (spaces.length === 1) return { scope: 'space', space: spaces[0], marks: [], mine };
    if (mine) return { scope: 'person', marks: [], mine: false };
    return { error: 'none' };
  }
  // The ticks a place has now: from its home, its marks, and whether the person keeps it on their list.
  function ticksOf(home, place, saved) {
    if (home.scope === 'environment') return { everyone: true, spaces: cleanMarks(place && place.spaces), mine: Boolean(saved) };
    if (home.scope === 'space') return { everyone: false, spaces: [home.space], mine: Boolean(saved) };
    return { everyone: false, spaces: [], mine: true };
  }
  // The ticks a new place starts with: Everyone first when the viewer may add there, then where they are (`at`: 'space'
  // on a space's canvas or its Map, adding `space`; 'my' in the Mine view, adding Mine; anything else, nothing more).
  // Without Everyone, where they are; failing that, the first store open to them. `can` says what they may add to.
  function defaultTicks(at, space, can) {
    const c = can || {};
    const t = { everyone: Boolean(c.everyone), spaces: [], mine: false };
    if (at === 'space' && space && c.here) t.spaces = [space];
    if (at === 'my' && c.mine) t.mine = true;
    if (!t.everyone && !t.spaces.length && !t.mine) {
      if (space && c.here) t.spaces = [space];
      else if (c.mine) t.mine = true;
    }
    return t;
  }
  // `in` on a request from another module (addPlace, sharePlace): the words environment, space and person, as a list or
  // in one string ("environment space"). Null when none is given, so the default applies; an Error for a word it does not know.
  function ticksFromIn(value, space) {
    if (value === undefined || value === null || value === '') return null;
    const words = (Array.isArray(value) ? value : String(value).split(/[\s,]+/)).map((w) => String(w).trim().toLowerCase()).filter(Boolean);
    if (!words.length) return null;
    const bad = words.find((w) => !['environment', 'space', 'person'].includes(w));
    if (bad) throw new Error(`in takes ${word('environment')}, ${word('space')} or person, not "${bad.slice(0, 20)}"`);
    if (words.includes('space') && !space) throw new Error(`there is no ${word('space')} here to add it to`);
    return { everyone: words.includes('environment'), spaces: words.includes('space') ? [space] : [], mine: words.includes('person') };
  }
  // Whether going from one home to another takes the place away from people: Everyone to a space or to Mine (the
  // environment's people lose it), or a space to Mine (the space's people lose it). '' when it widens or stays.
  function narrows(from, to) {
    if (!from || !to || sameHome(from, to)) return '';
    if (from.scope === 'environment') return 'environment';
    if (from.scope === 'space' && to.scope === 'person') return 'space';
    return '';
  }
  // Whether two places differ in their marks and nothing else (a change of ticks only, retried once on a conflict).
  const withoutMarks = (p) => JSON.stringify({ ...placeValue({ ...p, spaces: [] }), by: '' });
  const marksOnly = (a, b) => withoutMarks(a) === withoutMarks(b);

  // A bookmark: `saved:e:<id>` for an environment place, `saved:s:<space id>:<id>` for a space's, holding { ref, title }.
  // The title is kept so the list can name a place it cannot read (another space's, or one no longer shared).
  const bookmarkKey = (ref) => (ref.scope === 'space' ? `${SAVED_PREFIX}s:${ref.space}:${ref.id}` : `${SAVED_PREFIX}e:${ref.id}`);
  function cleanBookmark(key, v) {
    if (!v || typeof v !== 'object' || !v.ref || typeof v.ref !== 'object') return null;
    const home = cleanHome(v.ref);
    if (!home || home.scope === 'person' || typeof v.ref.id !== 'string' || !PLACE_ID.test(v.ref.id)) return null;
    // The pointer names the module that keeps places; one that names any other (a bookmark from before Places folded into Maps) is not read.
    if (v.ref.module !== 'maps') return null;
    const ref = { module: 'maps', kind: 'place', id: v.ref.id, ...home };
    if (key !== bookmarkKey(ref)) return null;
    return { key, ref, title: geo.oneLine(v.title, 120) };
  }
  // The places in a space's list: those kept there, then the environment's marked for it.
  const markedFor = (places, space) => (places || []).filter((p) => Array.isArray(p.spaces) && p.spaces.includes(space));
  // Many lists of { p, w } (w: the place's home store) as one, each place once: a place reached through a mark and through
  // the environment's own list is one row and one pin. Sorted by name.
  function shownOnce(groups) {
    const seen = new Map();
    for (const list of groups) for (const x of list || []) { const k = `${x.w}/${x.p.id}`; if (!seen.has(k)) seen.set(k, x); }
    return [...seen.values()].sort((a, b) => a.p.title.localeCompare(b.p.title, undefined, { numeric: true }));
  }
  // The distance in metres between two points ({ lat, lng }).
  function metresBetween(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // The same name, ignoring case, spacing and accents.
  const sameName = (a, b) => {
    const plain = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    return Boolean(plain(a)) && plain(a) === plain(b);
  };
  // A place already in `list` ({ p, w }) that `cand` ({ origin, title, point }) would repeat: the one saved from the same search
  // result (its key), else the same name within about 30 metres. Null when there is none.
  function findDuplicate(list, cand) {
    const c = cand || {};
    for (const x of list || []) if (c.origin && x.p.origin && x.p.origin === c.origin) return x;
    if (!c.point) return null;
    for (const x of list || []) if (x.p.point && sameName(x.p.title, c.title) && metresBetween(x.p.point, c.point) <= 30) return x;
    return null;
  }

  // A stored value as a place, or null when it is not one (a forward is not).
  function cleanPlace(id, v) {
    if (!v || typeof v !== 'object' || v.movedTo) return null;
    const title = geo.oneLine(v.title, 120);
    if (!title) return null;
    let point = null;
    if (v.point && typeof v.point === 'object') {
      const lat = Number(v.point.lat);
      const lng = Number(v.point.lng);
      if (geo.inRange(lat, lng)) point = { lat: geo.round6(lat), lng: geo.round6(lng) };
    }
    const r = v.ref;
    const ref = r && typeof r === 'object' && typeof r.module === 'string' && typeof r.kind === 'string' && typeof r.id === 'string'
      ? { module: r.module, kind: r.kind, id: r.id, ...(typeof r.scope === 'string' ? { scope: r.scope } : {}), ...(typeof r.space === 'string' ? { space: r.space } : {}) }
      : null;
    return {
      id: String(id),
      title,
      category: typeof v.category === 'string' && CATEGORY_ID.test(v.category) ? v.category : 'other',
      type: typeof v.type === 'string' && CATEGORY_ID.test(v.type) ? v.type : '',
      icon: typeof v.icon === 'string' && ICON_NAME.test(v.icon) ? v.icon : '',
      iconOwn: v.iconOwn === true && typeof v.icon === 'string' && ICON_NAME.test(v.icon),
      color: TINTS.includes(v.color) ? v.color : '',
      status: statusOf(v.status) ? v.status : '',
      address: geo.oneLine(v.address, 200),
      point,
      notes: String(v.notes == null ? '' : v.notes).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, 1000),
      owners: Array.isArray(v.owners) ? [...new Set(v.owners.filter((k) => typeof k === 'string' && k.length <= 64))].slice(0, 20) : [],
      by: typeof v.by === 'string' ? v.by.slice(0, 64) : '',
      ref,
      spaces: cleanMarks(v.spaces),
      ...(typeof v.origin === 'string' && v.origin ? { origin: v.origin.slice(0, 60) } : {}), // the search result it was saved from
    };
  }
  // What is stored for a place (no `point` at all when it has none, so its summary carries no place).
  const placeValue = (p) => ({
    title: p.title,
    category: p.category,
    ...(p.type ? { type: p.type } : {}),
    ...(p.icon ? { icon: p.icon } : {}),
    ...(p.icon && p.iconOwn ? { iconOwn: true } : {}),
    ...(p.color ? { color: p.color } : {}),
    ...(p.status ? { status: p.status } : {}),
    address: p.address,
    ...(p.point ? { point: { lat: p.point.lat, lng: p.point.lng } } : {}),
    notes: p.notes,
    owners: p.owners,
    by: p.by,
    ...(p.ref ? { ref: p.ref } : {}),
    ...(p.spaces && p.spaces.length ? { spaces: cleanMarks(p.spaces) } : {}),
    ...(p.origin ? { origin: String(p.origin).slice(0, 60) } : {}),
  });

  // What another module asks for through `addPlace`: a checked place, or an Error saying what is wrong.
  function placeFromRequest(input, by) {
    const i = input || {};
    const title = geo.oneLine(i.title, 120);
    if (!title) throw new Error('a place needs a name');
    const has = (x) => x !== undefined && x !== null && x !== '';
    let point = null;
    if (has(i.lat) || has(i.lng)) {
      const lat = Number(i.lat);
      const lng = Number(i.lng);
      if (!geo.inRange(lat, lng)) throw new Error('the coordinates are out of range');
      point = { lat, lng };
    }
    // The old category ids are read as the new ones; a type (when it is in the library) gives the category when none is asked, and its icon.
    const type = typeOf(i.type);
    const category = has(i.category) ? newCategoryId(i.category) : type ? type.category : i.category;
    const p = cleanPlace('new', { title, category, type: type ? type.id : '', icon: type ? type.icon : '', address: i.address, point, notes: i.notes, owners: [], by, ref: i.ref });
    if (!p) throw new Error('that is not a place');
    return p;
  }

  // The places of a space, kept live, and what other modules may ask of them. `host` is the SDK.
  // `opts.scope` says whose they are: 'space' (this space's, the default), 'environment' (everyone's) or 'person' (the signed-in person's own, private).
  // `opts.space` names one of the viewer's spaces from the environment page (the Map destination's panel): scope 'space'
  // there reaches that space with { space }, and its changes arrive as the 'spaces' scope with its id.
  // `opts.here` is the id of the space the page is in (a store of scope 'space' without `space` is that one's).
  function createPlaces(host, opts) {
    const scope = (opts && opts.scope) || 'space';
    const space = scope === 'space' && opts && opts.space ? String(opts.space) : null;
    const at = space ? { scope, space } : { scope };
    // Where this store is, as a forward's `movedTo` names it.
    const home = () => (scope === 'space' ? { scope: 'space', space: space || String((opts && opts.here) || '') } : { scope });
    // A pointer to one of these places, and the options that say where it is for setLinks.
    const pointer = (id) => host.objects.make('place', id, scope === 'environment' || scope === 'person' ? { scope } : space ? { space } : undefined);
    const linkOpts = space ? { space } : undefined;
    const byId = new Map(); // id -> { place, version }
    const forwards = new Map(); // id -> { forward, version }: places that moved out of this store
    const listeners = new Set();
    const changed = () => { for (const fn of listeners) fn(); };

    const remember = (id, value, version) => {
      byId.delete(id);
      forwards.delete(id);
      const f = value ? cleanForward(value) : null;
      if (f) { forwards.set(id, { forward: f, version }); return; }
      const p = value ? cleanPlace(id, value) : null;
      if (p) byId.set(id, { place: p, version });
    };
    async function load() {
      const items = await host.storage.list(PLACE_PREFIX, at);
      byId.clear();
      forwards.clear();
      for (const it of items) remember(it.key.slice(PLACE_PREFIX.length), it.value, it.version);
      changed();
    }
    // Fill from items already read (a list across every space, each item with its spaceId), instead of asking again.
    function seed(items) {
      byId.clear();
      forwards.clear();
      for (const it of items || []) if (String(it.key).startsWith(PLACE_PREFIX)) remember(it.key.slice(PLACE_PREFIX.length), it.value, it.version);
      changed();
    }
    host.on('change', (e) => {
      if (!String(e.key).startsWith(PLACE_PREFIX)) return;
      if (space ? !(e.scope === 'spaces' && String(e.spaceId) === space) : e.scope === 'spaces' || (e.scope || 'space') !== scope) return;
      remember(String(e.key).slice(PLACE_PREFIX.length), e.deleted ? null : e.value, e.version);
      changed();
    });
    // Many at once (a Clear, its Undo): kept in one pass, announced once. Keys only (a big event comes without values): read again.
    host.on('changes', (e) => {
      if (space ? !(e.scope === 'spaces' && String(e.spaceId) === space) : e.scope === 'spaces' || (e.scope || 'space') !== scope) return;
      const list = (Array.isArray(e.changes) ? e.changes : []).filter((c) => String(c.key).startsWith(PLACE_PREFIX));
      if (!list.length) return;
      if (list.some((c) => !c.deleted && c.value === undefined)) { load().catch(() => {}); return; }
      for (const c of list) remember(String(c.key).slice(PLACE_PREFIX.length), c.deleted ? null : c.value, c.version);
      changed();
    });

    const list = () => [...byId.values()].map((x) => x.place).sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })); // QA place 2 before QA place 10
    const get = (id) => (byId.get(id) || {}).place || null;
    const versionOf = (id) => (byId.get(id) || {}).version;
    const forwardOf = (id) => (forwards.get(id) || {}).forward || null;

    // Save a place (a new one when it has no id). A stale edit is refused with the store's 409.
    async function save(p, version) {
      const id = p.id && p.id !== 'new' ? p.id : host.util.id();
      // Marks are kept only on the environment's places: a space's place is in that space alone, a person's is private.
      const value = placeValue({ ...p, id, spaces: scope === 'environment' ? p.spaces : [] });
      const saved = await host.storage.set(PLACE_PREFIX + id, value, version === undefined ? at : { ...at, version });
      const place = cleanPlace(id, value);
      forwards.delete(id);
      byId.set(id, { place, version: saved && saved.version });
      // Personal places are private, so nothing is linked to or from them.
      if (place.ref && scope !== 'person') host.objects.setLinks(pointer(id), [place.ref], linkOpts).catch(() => {});
      changed();
      return place;
    }
    // A place moving in from another store, keeping its id: written only over nothing or over this store's own forward of
    // it (version 0 means "only if there is nothing there"), never over another place.
    const adopt = (p) => save(p, forwards.has(p.id) ? forwards.get(p.id).version : 0);
    // The place left this store for `to`: its record is replaced by a forward (title only), and its links go with it.
    async function forward(id, title, to, version) {
      const value = forwardValue(title, to);
      const saved = await host.storage.set(PLACE_PREFIX + id, value, version === undefined ? at : { ...at, version });
      byId.delete(id);
      forwards.set(id, { forward: cleanForward(value), version: saved && saved.version });
      if (scope !== 'person') host.objects.setLinks(pointer(id), [], linkOpts).catch(() => {});
      changed();
    }
    async function remove(id) {
      await host.storage.delete(PLACE_PREFIX + id, byId.has(id) ? { ...at, version: byId.get(id).version } : at);
      byId.delete(id);
      forwards.delete(id);
      if (scope !== 'person') host.objects.setLinks(pointer(id), [], linkOpts).catch(() => {});
      changed();
    }
    // Add and take away space marks, and nothing else. Two people ticking two spaces at once both win: on a conflict the
    // place is read again and the same change applied to what is there now, once.
    async function mark(id, add, take, by) {
      const apply = (p) => ({ ...p, spaces: cleanMarks([...p.spaces.filter((s) => !(take || []).includes(s)), ...(add || [])]), ...(by ? { by } : {}) });
      const cur = byId.get(id);
      if (!cur) throw new Error('there is no such place');
      try {
        return await save(apply(cur.place), cur.version);
      } catch (err) {
        if (!err || err.status !== 409) throw err;
        const fresh = await host.storage.get(PLACE_PREFIX + id, at);
        const p = fresh ? cleanPlace(id, fresh.value) : null;
        if (!p) throw Object.assign(new Error('that place was removed by someone else'), { status: 404 });
        return save(apply(p), fresh.version);
      }
    }
    // Give a place a point (or take it away with null).
    async function setPoint(id, pt) {
      const cur = byId.get(id);
      if (!cur) throw new Error('there is no such place');
      if (pt && !geo.inRange(Number(pt.lat), Number(pt.lng))) throw new Error('the coordinates are out of range');
      return save({ ...cur.place, point: pt ? { lat: geo.round6(Number(pt.lat)), lng: geo.round6(Number(pt.lng)) } : null }, cur.version);
    }

    return { load, seed, list, get, versionOf, forwardOf, save, adopt, forward, remove, mark, setPoint, home, pointer, scope, space, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
  }

  // Move a place to another store (sharing a private place, widening or narrowing), keeping its id. The new home is
  // written first, then the forward in the old one, so a failure between the two leaves the place readable in one of them:
  // { place, forwarded: true }, or { place, forwarded: false, error } when only the old record could not be replaced.
  async function movePlace(from, to, place, version) {
    const moved = await to.adopt(place);
    try {
      await from.forward(place.id, place.title, to.home(), version);
      return { place: moved, forwarded: true };
    } catch (err) {
      return { place: moved, forwarded: false, error: err };
    }
  }

  // The person's own list of shared places they saved (bookmarks), in their own store: nobody else, an owner included,
  // can see who keeps a place on their list.
  function createBookmarks(host) {
    const at = { scope: 'person' };
    const byKey = new Map(); // key -> { key, ref, title }
    const listeners = new Set();
    const changed = () => { for (const fn of listeners) fn(); };
    const remember = (key, value) => { const b = value ? cleanBookmark(key, value) : null; if (b) byKey.set(key, b); else byKey.delete(key); };
    async function load() {
      const items = await host.storage.list(SAVED_PREFIX, at);
      byKey.clear();
      for (const it of items) remember(it.key, it.value);
      changed();
    }
    host.on('change', (e) => {
      if (!String(e.key).startsWith(SAVED_PREFIX) || e.scope !== 'person') return;
      remember(String(e.key), e.deleted ? null : e.value);
      changed();
    });
    host.on('changes', (e) => {
      if (e.scope !== 'person') return;
      const list = (Array.isArray(e.changes) ? e.changes : []).filter((c) => String(c.key).startsWith(SAVED_PREFIX));
      if (!list.length) return;
      if (list.some((c) => !c.deleted && c.value === undefined)) { load().catch(() => {}); return; }
      for (const c of list) remember(String(c.key), c.deleted ? null : c.value);
      changed();
    });
    const has = (ref) => byKey.has(bookmarkKey(ref));
    async function add(ref, title) {
      if (byKey.size >= MAX_SAVED && !has(ref)) throw new Error(`your list holds at most ${MAX_SAVED} places`);
      const key = bookmarkKey(ref);
      const value = { ref: { module: ref.module, kind: 'place', id: String(ref.id), scope: ref.scope, ...(ref.scope === 'space' ? { space: ref.space } : {}) }, title: geo.oneLine(title, 120) };
      await host.storage.set(key, value, at);
      remember(key, value);
      changed();
    }
    async function remove(refOrKey) {
      const key = typeof refOrKey === 'string' ? refOrKey : bookmarkKey(refOrKey);
      await host.storage.delete(key, at);
      byKey.delete(key);
      changed();
    }
    return { load, list: () => [...byKey.values()], has, add, remove, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
  }

  // --- finding a place ----------------------------------------------------------------------------------------------
  // What a bar entry means: a name, with coordinates or a map link anywhere in it setting the position. `find` is true when
  // it is only a name, which is what a search should look for.
  function readEntry(text) {
    const t = String(text || '').trim();
    const link = t.match(/(?:https?:\/\/|geo:)\S+/i);
    if (link) {
      const pt = geo.parsePoint(link[0]);
      if (pt) return { title: geo.oneLine(t.replace(link[0], ' '), 120), point: pt, find: false };
    }
    const whole = geo.parsePoint(t);
    if (whole) return { title: '', point: whole, find: false };
    const tail = t.match(/(-?\d{1,3}\.\d+)[,;\s]+(-?\d{1,3}\.\d+)\s*$/);
    if (tail) {
      const pt = geo.parsePoint(`${tail[1]}, ${tail[2]}`);
      if (pt) return { title: geo.oneLine(t.slice(0, tail.index), 120), point: pt, find: false };
    }
    return { title: geo.oneLine(t, 120), point: null, find: t.length >= 2 };
  }

  // Whether the module's settings ({ searchProvider, search }) name a place search. Where it is asked, and what comes back, is
  // the server's business (see the manifest's `geocoder`); the page only needs to know whether to offer one.
  function searchOn(values) {
    const v = values || {};
    if (v.searchProvider === 'custom') return typeof v.search === 'string' && /^https?:\/\//i.test(v.search);
    return typeof v.searchProvider === 'string' && v.searchProvider !== '' && v.searchProvider !== 'none';
  }