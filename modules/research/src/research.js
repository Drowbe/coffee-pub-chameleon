// The Research module's page: notes, links and photos a group keeps while it plans, each a card that can be tagged, found again,
// linked from anywhere and dragged onto a plan. The objects live in the module's store (see research-lib.js). This page draws into
// the markup in research.html by cloning its templates and filling their [data-slot] and [data-icon] hooks, and toggles the state
// classes and data attributes CONTRACT.md lists. It builds no markup from strings and sets no style (a tag's colour, --chip-tone, and the
// object menu's position are the exceptions). "Research this" asks in Chat (`host.chat.ask`) with that object as context.
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
    showMsg('Research could not start', err.message, () => location.reload());
    return;
  }
  const inSpace = info.context.scope === 'space';
  const geo = host.util.geo;
  /*__LIB__*/

  // Mine is the person's own: anyone signed in may keep private notes there, whatever the role says about this space's research.
  const personal = Boolean(info.user && info.user.key !== 'guest'); // a guest has no profile, so nothing of their own
  const canEditSpace = host.can('edit');
  const canEdit = () => (view === 'my' ? personal : canEditSpace);
  // Reading a link's page (a preview) takes edit in every view: in Mine, view is enough to keep one's own notes, not to
  // have the server fetch pages (access.personWrite covers data and uploads only).
  const canFetch = () => canEdit() && canEditSpace;
  // The titlebar reads its name as this environment shows it (host.info's: the display name, else its own), with no
  // count beside it (#191).
  host.setTitle(info.module.name);
    const removeAnyPhoto = host.can('remove_photos'); // a space's photos other people added (owners always can)
  const me = (info.user && info.user.key) || '';

  // Two stores of the same kind of thing: this space's, and the person's own (private, the same in every space).
  const stores = { space: createResearch(host, { scope: 'space' }), my: createResearch(host, { scope: 'person' }) };
  const loadedStores = new Set();
  const ensureLoaded = (v) => { if (loadedStores.has(v)) return Promise.resolve(); loadedStores.add(v); return stores[v].load().catch((err) => { loadedStores.delete(v); throw err; }); };
  let view = inSpace ? 'space' : 'my';
  const research = new Proxy({}, { get: (_, key) => stores[view][key] });
  const scopeOf = () => (view === 'my' ? 'person' : 'space');
  const allowed = { my: personal, space: inSpace };

  const state = {
    open: new Set(), // the cards opened to read in place (by id)
    people: [],
    filter: '',
    kind: '',
    tags: [], // tags chosen as filters (an object must have all)
    loaded: false,
    editing: null, // { id | null, kind, version, point, pointOk, seed }
    menuFor: null,
    armed: null,
    uploads: [], // { el, file, step, progress, error, posAsk }
    tagColors: new Map(), // a well-known tag -> its colour
    previews: false, // the environment's Fetch link previews setting
    warming: new Set(), // link ids already asked for a picture, so a redraw does not ask again
    peek: new Map(), // link id -> the page's picture, shown this visit only (never saved)
    ai: false, // whether this person may use AI here (for Suggest tags, and Research this)
    thumbs: new Map(), // photo id -> address of its thumbnail in the view it was asked for
  };
  const nameOf = (key) => (state.people.find((p) => p.key === key) || {}).name || (key === me && info.user ? info.user.displayName : '') || '';
  const initial = (key) => (nameOf(key)[0] || '?').toUpperCase();

  // --- small helpers ------------------------------------------------------------------------------------------------

  const clone = (id) => $(id).content.firstElementChild.cloneNode(true);
  const hide = (node, yes) => { if (node) node.hidden = Boolean(yes); };
  const slot = (el, name) => (el.dataset.slot === name ? el : el.querySelector(`[data-slot="${name}"]`));
  // Set a slot's text, or hide the slot when there is nothing to show; a `<name>-wrap` around it hides with it.
  function fill(el, values) {
    for (const [name, value] of Object.entries(values)) {
      const s = slot(el, name);
      const empty = value === '' || value == null;
      if (s) { s.textContent = empty ? '' : String(value); s.hidden = empty; }
      const wrap = slot(el, `${name}-wrap`);
      if (wrap) wrap.hidden = empty;
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
  const say = (text, ms) => { const n = $('note'); n.textContent = text || ''; n.hidden = !text; if (text && ms) setTimeout(() => { if (n.textContent === text) say(''); }, ms); };
  // Good news and hints go to the toast, never the red error line.
  const told = (text) => { if (host.ui && typeof host.ui.toast === 'function') host.ui.toast(text).catch(() => {}); else say(text, 3000); };
  const message = (err) => {
    const m = (err && err.message) || String(err);
    return /failed to fetch|networkerror|load failed/i.test(m) ? 'Check your connection and try again.' : m;
  };

  // The pane's width, not the window's: a bundled module runs in the page, so a media query would follow the window.
  const fit = () => {
    const w = host.rootElement.clientWidth;
    if (w) $('app').classList.toggle('narrow', w < 720);
  };
  fit();
  new ResizeObserver(fit).observe(host.rootElement);

  const dayText = (d) => { const t = new Date(`${d}T12:00:00`); return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
  // What to call an object an answer came from: its title when it is one of ours, otherwise what kind of thing it is.
  const sourceLabel = (r) => (r.module === info.module.id && stores.space.get(r.id) ? stores.space.get(r.id).title : r.module === info.module.id && stores.my.get(r.id) ? stores.my.get(r.id).title : r.label || r.kind);
  // A source of an answer as a pill; `gone` when it is one of ours that is no longer there.
  const sourcePill = (r) => {
    const el = clone('tpl-source');
    fill(el, { label: sourceLabel(r) });
    el.classList.toggle('gone', r.module === info.module.id && !stores.space.get(r.id) && !stores.my.get(r.id));
    return el;
  };
  const placeText = (p) => (p ? p.name || geo.coordsText(p.lat, p.lng) : '');

  // --- tags ---------------------------------------------------------------------------------------------------------

  const colorOf = (tag) => state.tagColors.get(tag) || '';
  function loadTagColors(values) {
    state.tagColors = new Map();
    for (const r of (values && Array.isArray(values.tags) ? values.tags : [])) if (r && r.color) { state.tagColors.set(String(r.label || r.id).toLowerCase().replace(/[^\p{L}\p{N}-]/gu, ''), r.color); }
  }
  function tagNode(tag, tplId) {
    const el = clone(tplId);
    fill(el, { label: tag });
    const c = colorOf(tag);
    if (c) el.style.setProperty('--chip-tone', c);
    return el;
  }

  // --- the list -----------------------------------------------------------------------------------------------------

  const visible = () => filterItems(research.list(), { q: state.filter, kind: state.kind, tags: state.tags });
  const thumbUrl = (it) => {
    const key = `${view}:${it.file.id}`;
    if (!state.thumbs.has(key)) {
      state.thumbs.set(key, '');
      host.uploads.url(it.file.id, { thumb: it.file.hasThumb, scope: scopeOf() }).then((u) => { state.thumbs.set(key, u); for (const img of root.querySelectorAll(`.rcard[data-id="${it.id}"] [data-slot="thumb"]`)) { img.src = u; img.hidden = false; } }).catch(() => {});
    }
    return state.thumbs.get(key);
  };

  // What other modules point at each object (space view only: a person's own objects are never linked): asked once per object, cleared by the
  // 'links' event. Shown as one pill per kind of linker: "Task: book the hotel", or "2 plans".
  const links = new Map(); // object id -> summaries of what points at it
  const linkTarget = new WeakMap(); // a pill -> the pointer to open
  const askedLinks = new Set();
  async function loadLinks() {
    if (view === 'my' || !host.objects || !host.objects.linksTo) return;
    let changed = false;
    for (const it of research.list().slice(0, 100)) {
      if (askedLinks.has(it.id)) continue;
      askedLinks.add(it.id);
      try {
        const summaries = await host.objects.linksTo(research.refOf(it.kind, it.id));
        if (summaries.length) { links.set(it.id, summaries); changed = true; }
      } catch (err) { /* nothing points at it */ }
    }
    if (changed) render();
  }
  if (host.on) host.on('links', () => { askedLinks.clear(); links.clear(); loadLinks().catch(() => {}); });
  const pluralOf = (w) => (/[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : /(s|x|z|ch|sh)$/.test(w) ? `${w}es` : `${w}s`);
  function backlinkPills(summaries) {
    const groups = new Map();
    for (const c of summaries) { const k = c.kindName || c.kind || word('object', { cap: true }); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
    const all = [...groups.entries()];
    const pills = all.slice(0, 3).map(([kind, list]) => {
      const el = clone('tpl-backlink');
      setIcon(el.querySelector('[data-icon]'), (list[0].module && list[0].module.icon) || 'link');
      fill(el, { label: list.length === 1 ? `${kind}: ${list[0].title}` : `${list.length} ${pluralOf(kind.toLowerCase())}` });
      el.title = list.map((c) => c.title).join(', ');
      linkTarget.set(el, list[0].ref);
      return el;
    });
    if (all.length > 3) { const more = clone('tpl-backlink-more'); fill(more, { label: `+${all.length - 3}` }); pills.push(more); }
    return pills;
  }

  function card(it) {
    const el = clone('tpl-card');
    el.dataset.id = it.id;
    el.dataset.kind = it.kind;
    el.classList.toggle('open', state.open.has(it.id));
    el.classList.toggle('on', state.open.has(it.id));
    el.setAttribute('aria-expanded', state.open.has(it.id) ? 'true' : 'false');
    const pen = el.querySelector('[data-action="edit"]');
    if (pen && it.broken) pen.hidden = true;
    else if (pen) { pen.setAttribute('aria-label', canEdit() ? 'Edit' : 'View'); pen.title = canEdit() ? 'Edit' : 'View'; }
    setIcon(el.querySelector('.kind [data-icon]'), it.kind === 'note' ? noteIcon(it.icon) : KIND_ICON[it.kind]);
    fill(el, { kind: it.kind === 'note' ? (noteIconLabel(it.icon) === 'General' ? 'Note' : noteIconLabel(it.icon)) : KIND_LABEL[it.kind], title: it.title, site: it.site, when: it.date ? dayText(it.date) : '', place: placeText(it.point), by: initial(it.by) });
    const words = it.kind === 'photo' ? '' : textOf(it);
    const excerpt = slot(el, 'excerpt');
    if (excerpt) {
      excerpt.innerHTML = words ? host.util.markdown(words) : '';
      excerpt.hidden = !words;
    }
    hide(slot(el, 'ai'), it.kind !== 'answer');
    const by = slot(el, 'by-wrap');
    if (by) by.title = nameOf(it.by) ? `Added by ${nameOf(it.by)}` : '';
    hide(slot(el, 'by-wrap'), !it.by || view === 'my');
    const img = slot(el, 'thumb');
    // A picture that will not load (its file was removed) shows a quiet placeholder instead of nothing.
    // A link's picture is the page's, fetched by this server: if that fails, leave the card without it.
    img.addEventListener('error', () => {
      if (!img.getAttribute('src')) return;
      if (el.dataset.kind === 'link') { img.hidden = true; img.removeAttribute('src'); return; }
      img.classList.add('missing');
      img.hidden = false;
    });
    if (it.kind === 'photo' && it.file) { const u = thumbUrl(it); if (u) { img.src = u; img.hidden = false; } }
    else if (it.kind === 'link' && (it.image || state.peek.get(it.id)) && state.previews) showLinkImage(it.id, it.image || state.peek.get(it.id), img);
    else hide(img, true);
    const tags = slot(el, 'tags');
    tags.replaceChildren(...it.tags.map((t) => tagNode(t, 'tpl-tag')));
    tags.hidden = !it.tags.length;
    const back = slot(el, 'backlinks');
    if (back) { back.replaceChildren(...backlinkPills(links.get(it.id) || [])); back.hidden = !back.children.length; }
    return el;
  }

  function renderUploads() {
    for (const n of root.querySelectorAll('.upload, .pos-ask')) n.remove();
    const body = $('body');
    body.prepend(...state.uploads.map((u) => u.el));
    hydrate(body);
  }

  // The toolbar row: the view switches lead it; then the search and the filters (in the row's Filters menu): the kind (one
  // kind, or every kind) and the tags (any number; each in use, with how many it is on). None of it while there is
  // nothing to look through.
  const KIND_CHIPS = [
    { id: 'note', label: 'Notes', icon: 'note-sticky' },
    { id: 'link', label: 'Links', icon: 'link' },
    { id: 'photo', label: 'Photos', icon: 'camera' },
    { id: 'answer', label: 'Answers', icon: 'wand-magic-sparkles' },
  ];
  function syncToolbar(empty) {
    host.toolbar.set(empty ? [] : [
      { type: 'search', id: 'search', value: state.filter, placeholder: 'Search research', label: 'Search research' },
      { type: 'chips', id: 'kind', label: 'Kind', single: true, value: state.kind || 'all', options: [{ id: 'all', label: 'Every kind' }, ...KIND_CHIPS.filter((k) => k.id !== 'answer' || state.kind === 'answer' || research.list().some((it) => it.kind === 'answer'))] },
      ...(tagCounts(research.list()).length ? [{ type: 'chips', id: 'tags', label: 'Tags', options: tagCounts(research.list()).map(({ tag, count }) => ({ id: tag, label: tag, count, default: false, on: state.tags.includes(tag) })) }] : []),
    ]).catch(() => {});
  }
  host.on('toolbar', (e) => {
    if (e.id === 'search' && typeof e.value === 'string') {
      if (e.value === state.filter) return;
      state.filter = e.value;
      render();
    } else if (e.id === 'kind' && typeof e.value === 'string') {
      state.kind = e.value === 'all' ? '' : e.value;
      render();
    } else if (e.id === 'tags' && typeof e.value === 'string') {
      state.tags = e.on ? [...new Set([...state.tags, e.value])] : state.tags.filter((t) => t !== e.value);
      render();
    }
  });

  // The status line at the foot of the window: how many are shown, and what narrows them. Quiet words, none while empty.
  const KIND_WORDS = { note: 'Notes', link: 'Links', photo: 'Photos', answer: 'Answers' };
  function syncStatus() {
    if (!host.status) return;
    const items = [];
    const all = state.loaded ? research.list() : [];
    if (all.length) {
      const n = visible().length;
      items.push({ text: n === all.length ? `${n} ${word('object', { many: n !== 1 })}` : `${n} of ${all.length}` });
      if (state.kind) items.push({ text: KIND_WORDS[state.kind] || state.kind });
      if (state.tags.length) items.push({ text: `Tag: ${state.tags.join(', ')}`.slice(0, 60) });
      if (state.filter.trim()) items.push({ text: `"${state.filter.trim()}"`.slice(0, 60) });
    }
    if (state.uploads.length) items.splice(1, 0, { text: `Adding ${state.uploads.length} ${state.uploads.length === 1 ? 'photo' : 'photos'}`, quiet: true });
    host.status.set(items.slice(0, 4)).catch(() => {});
  }
  function render() {
    renderPage();
    syncStatus();
  }
  function renderPage() {
    const all = research.list();
    const empty = state.loaded && !all.length && !state.uploads.length;
    syncToolbar(empty || !state.loaded);
    const body = $('body');
    if (!state.loaded) { body.replaceChildren(clone('tpl-state-loading')); return; }
    if (empty) {
      body.replaceChildren(clone('tpl-state-empty'));
      for (const b of body.querySelectorAll('[data-action="new-note"], [data-action="new-link"], [data-action="add-photo"]')) hide(b, !canEdit());
      hydrate(root);
      return;
    }
    const counts = tagCounts(all);
    // The tags chosen as filters: the toolbar's Filters menu has them; the status line names them.
    state.tags = state.tags.filter((t) => counts.some((c) => c.tag === t)); // a tag no object carries any more drops out
    const dl = $('tag-list');
    dl.replaceChildren(...counts.map(({ tag }) => { const o = document.createElement('option'); o.value = tag; return o; }));
    const shown = visible();
    const grid = document.createElement('div');
    grid.className = state.layout === 'list' ? 'rs-list' : 'rs-grid';
    if (!shown.length && !state.uploads.length) { body.replaceChildren(clone('tpl-state-noresults')); hydrate(root); return; }
    grid.replaceChildren(...shown.map(card));
    body.replaceChildren(grid);
    if (state.layout !== 'list') masonry(grid);
    renderUploads();
    hydrate(root);
    for (const id of state.open) peekLink(id);
  }

  // The page's picture, through this server, so the other site is not asked by the browser.
  function showLinkImage(id, image, img) {
    host.preview.image(image).then((u) => {
      const node = root.querySelector(`.rcard[data-id="${CSS.escape(id)}"] [data-slot="thumb"]`) || img;
      if (!node || !u) return;
      node.src = u;
      node.hidden = false;
    }).catch(() => {});
  }

  // A saved link that has no picture: only when its card is opened to read, the page is asked once (one at a time) and the
  // picture is shown on the card for this visit. Nothing is saved: a visit never rewrites what someone else kept.
  let peekChain = Promise.resolve();
  function peekLink(id) {
    const it = research.get(id);
    if (!state.previews || !canFetch() || !it || it.kind !== 'link' || !it.url || it.image || state.peek.has(id) || state.warming.has(id)) return;
    state.warming.add(id);
    peekChain = peekChain.then(async () => {
      const got = await host.preview.link(it.url);
      const image = cleanUrl(got && got.image, 2000) || '';
      if (!image) return;
      state.peek.set(id, image);
      const img = root.querySelector(`.rcard[data-id="${CSS.escape(id)}"] [data-slot="thumb"]`);
      if (img) showLinkImage(id, image, img);
    }).catch(() => {});
  }

  // Read the page again and replace the title, description and picture with what it says now.
  async function refreshLink(id) {
    const it = research.get(id);
    if (!it || it.kind !== 'link' || !it.url || !canFetch()) return;
    if (!state.previews) { told('Turn on Fetch link previews to read the page again.'); return; }
    try {
      const got = await host.preview.link(it.url);
      const cur = research.get(id);
      if (!cur) return;
      if (!got || got.enabled === false) { told('Turn on Fetch link previews to read the page again.'); return; }
      const title = String(got.title || '').trim();
      const description = String(got.description || '').trim();
      const image = cleanUrl(got.image, 2000) || '';
      // The person's own words stay; the page's description only fills an empty note.
      const next = { ...cur, title: title || cur.title, excerpt: cur.excerpt || description, image: image || cur.image };
      if (next.title === cur.title && next.excerpt === cur.excerpt && next.image === cur.image) { told('Nothing new on that page.'); return; }
      await research.save(next, research.versionOf(id));
      told('Link refreshed.');
    } catch (err) {
      say('That page could not be read.', 4000);
    }
  }

  // Cards pack like masonry: each takes as many rows of the grid's fine row unit as its own height needs, so a short card
  // beside a tall one leaves no hole under it, and the columns adapt to the pane's width (the grid's own auto-fill). A card's
  // height is read after layout and again whenever it changes (a photo loading, the pane resizing), never guessed.
  const ROW = 8; // px, the grid's row unit (grid-auto-rows in research.css)
  function masonry(grid) {
    const gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
    const fit = (el) => {
      el.style.gridRowEnd = '';
      const h = el.getBoundingClientRect().height;
      el.style.gridRowEnd = `span ${Math.max(1, Math.ceil((h + gap) / (ROW + gap)))}`;
    };
    const all = () => { for (const el of grid.children) fit(el); };
    all();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver((entries) => {
      if (!grid.isConnected) return ro.disconnect();
      if (entries.some((e) => e.target === grid)) all(); else for (const e of entries) fit(e.target);
    });
    ro.observe(grid);
    for (const el of grid.children) ro.observe(el);
  }
  for (const key of Object.keys(stores)) {
    stores[key].subscribe(() => {
      if (view !== key) return; // a change to the store not being looked at needs no redraw
      if (state.loaded) render();
      checkConflict();
    });
  }

  // --- an object's menu ------------------------------------------------------------------------------------------------

  const mayRemove = (it) => canEdit() && (view === 'my' || it.kind !== 'photo' || it.by === me || removeAnyPhoto);
  // Remove armed by id, cleared a few seconds after arming so a stray later click cannot remove unarmed.
  const armedRemove = new Set();
  function openMenu(id, button) {
    const it = research.get(id);
    if (!it) return;
    const items = it.broken ? [] : [
      { id: 'edit', label: canEdit() ? 'Edit' : 'View', icon: 'pen', onClick: () => openEditor(id) },
    ];
    if (canEdit() && state.previews && it.kind === 'link' && it.url) {
      items.push({ id: 'refresh', label: 'Refresh link', icon: 'arrows-rotate', onClick: () => refreshLink(id) });
    }
    if (personal && inSpace && it.kind !== 'photo' && !it.broken && (view === 'my' ? canEditSpace : true)) {
      items.push({
        id: 'copy-to',
        label: view === 'my' ? `Copy to This ${word('space')}` : 'Copy to Mine',
        icon: 'share-nodes',
        onClick: async () => {
          const target = view === 'my' ? stores.space : stores.my;
          try {
            await ensureLoaded(view === 'my' ? 'space' : 'my');
            await target.save({ ...it, id: '', by: me, at: new Date().toISOString(), ai: it.ai ? { ...it.ai, sources: [] } : null });
            told(view === 'my' ? `Copied to this ${word('space')}.` : 'Copied to Mine.');
          } catch (err) { say('It could not be copied: ' + message(err)); }
        },
      });
    }
    if (state.ai && state.chat && it.kind !== 'photo') {
      items.push({
        id: 'ask-about',
        label: 'Research this',
        icon: 'wand-magic-sparkles',
        onClick: () => {
          const title = it.title || KIND_LABEL[it.kind] || 'this';
          host.chat.ask({
            question: `What should I know about ${title}?`,
            refs: [research.refOf(it.kind, it.id)],
          }).catch((err) => say(err.message || 'The AI could not answer.', 4000));
        },
      });
    }
    if (mayRemove(it)) {
      items.push({
        id: 'delete',
        label: 'Remove',
        icon: 'trash',
        danger: true,
        onClick: (item, b) => {
          if (!armedRemove.has(id)) {
            armedRemove.add(id);
            const label = b.querySelector('.sdk-menu-label');
            if (label) label.textContent = 'Remove it?';
            setTimeout(() => { armedRemove.delete(id); if (label && label.isConnected) label.textContent = 'Remove'; }, 4000);
            return false;
          }
          armedRemove.delete(id);
          research.remove(id).catch((err) => say('It could not be removed: ' + message(err)));
        },
      });
    }
    host.menu.show({ id: `research-${id}`, anchor: button, items });
  }

  // --- the dialog for one object --------------------------------------------------------------------------------------

  const editorError = (text) => { $('f-error').textContent = text; $('f-error').hidden = !text; };
  // The dialog is the editor window (host.ui.editor): over everything, sized to the form, a sheet on a phone. What the
  // form held when it opened is kept as text (state.editing.opened), so Escape and Close ask "Discard your changes?"
  // only after something changed; words the link preview filled in are not the person's changes.
  const formSnapshot = () => JSON.stringify([$('f-title').value, $('f-caption').value, $('f-url').value, $('f-body').value, $('f-excerpt').value, $('f-tags').value, $('f-point').value, $('f-date').value, state.editing ? state.editing.icon : '']);
  const formDirty = () => Boolean(state.editing && state.editing.opened !== undefined && state.editing.opened !== formSnapshot());
  const editor = host.ui.editor($('editor'), { size: 'medium', isDirty: formDirty, onClose: () => { state.editing = null; } });
  const datePicker = host.ui.datePicker($('f-date'), { clearable: true }); // its weekday shows in the field's hint
  function paintIconChoices() {
    const icon = state.editing && state.editing.kind === 'note' ? noteIcon(state.editing.icon) : '';
    for (const b of $('f-icons').querySelectorAll('[data-action="pick-icon"]')) {
      const on = b.dataset.iconName === icon;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  const dropConflict = () => { for (const n of $('form').querySelectorAll('[data-bar]')) n.remove(); if (state.editing) state.editing.conflict = null; };
  // Every control in the form, the type buttons and Suggest tags too: a read-only view takes no input.
  const setFormEditable = (yes) => { for (const f of $('form').querySelectorAll('input, textarea, select, .format-bar button, #f-icons button, [data-action="suggest-tags"]')) f.disabled = !yes; };
  // The same marks chat writes: **bold**, *italic*, `code`, and "- " at the start of a line.
  function wrapSelection(el, marker) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = el.value.slice(start, end);
    el.value = el.value.slice(0, start) + marker + selected + marker + el.value.slice(end);
    el.focus();
    const from = start + marker.length;
    el.setSelectionRange(from, from + selected.length);
  }
  function listSelection(el) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const value = el.value;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = value.indexOf('\n', end) === -1 ? value.length : value.indexOf('\n', end);
    const block = value.slice(lineStart, lineEnd);
    const next = block.split('\n').map((line) => (line.trim() ? `- ${line}` : line)).join('\n');
    el.value = value.slice(0, lineStart) + next + value.slice(lineEnd);
    el.focus();
    el.setSelectionRange(lineStart, lineStart + next.length);
  }
  const FORMAT = { bold: '**', italic: '*', code: '`' };
  $('form').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-format]');
    if (!b || b.disabled) return;
    const field = b.closest('label') && b.closest('label').querySelector('textarea');
    if (!field || field.disabled) return;
    ev.preventDefault();
    if (b.dataset.format === 'list') listSelection(field);
    else if (FORMAT[b.dataset.format]) wrapSelection(field, FORMAT[b.dataset.format]);
  });

  function readPoint() {
    const text = $('f-point').value.trim();
    const e = state.editing;
    if (!text) { e.point = null; e.pointOk = true; $('f-point-note').textContent = ''; return; }
    const pt = geo.parsePoint(text);
    e.point = pt ? { ...pt, ...(e.point && e.point.name ? { name: e.point.name } : {}) } : null;
    e.pointOk = Boolean(pt);
    $('f-point-note').textContent = pt ? 'Coordinates found.' : 'No coordinates in that.';
  }
  $('f-point').addEventListener('input', readPoint);

  // A link's page, read by the server when Fetch link previews is on. An empty title or description is filled in.
  // What the person already typed is left as it is. The picture is kept on the link and drawn on the card.
  let previewWait = 0;
  let previewFor = '';
  const previewImg = $('f-preview-img');
  const shotEmpty = () => $('f-preview') && $('f-preview').querySelector('.link-shot-empty');
  function showShot(src) {
    if (!previewImg) return;
    if (!src) {
      previewImg.hidden = true;
      previewImg.removeAttribute('src');
      if (shotEmpty()) shotEmpty().hidden = false;
      return;
    }
    previewImg.hidden = false;
    previewImg.src = src;
    if (shotEmpty()) shotEmpty().hidden = true;
  }
  if (previewImg) previewImg.addEventListener('error', () => { if (previewImg.getAttribute('src')) showShot(''); });
  function clearPreview() {
    previewFor = '';
    if ($('f-url-note')) $('f-url-note').textContent = '';
    showShot('');
  }
  async function pullPreview() {
    const e = state.editing;
    if (!e || e.kind !== 'link' || !state.previews || !canFetch()) return clearPreview();
    const url = cleanUrl($('f-url').value);
    if (!url) return clearPreview();
    if (url === previewFor) return;
    previewFor = url;
    $('f-url-note').textContent = 'Reading the page...';
    try {
      const got = await host.preview.link(url);
      if (previewFor !== url || !state.editing) return;
      if (!got || got.enabled === false) return clearPreview();
      const title = String(got.title || '').trim();
      const description = String(got.description || '').trim();
      const clean = !formDirty();
      if (title && !geo.oneLine($('f-title').value, 120)) $('f-title').value = title;
      if (description && !$('f-excerpt').value.trim()) $('f-excerpt').value = description;
      if (clean && state.editing.opened !== undefined) state.editing.opened = formSnapshot();
      $('f-url-note').textContent = (title || description) ? 'Read from the page.' : '';
      const image = cleanUrl(got.image, 2000) || '';
      if (image) e.image = image;
      if (image) host.preview.image(image).then((u) => { if (previewFor === url && u) showShot(u); }).catch(() => {});
      else showShot('');
    } catch (err) {
      if (previewFor !== url) return;
      $('f-url-note').textContent = 'That page could not be read.';
      showShot('');
    }
  }
  $('f-url').addEventListener('input', () => {
    clearTimeout(previewWait);
    previewFor = '';
    if (state.editing) state.editing.image = '';
    showShot('');
    if ($('f-url-note')) $('f-url-note').textContent = '';
    previewWait = setTimeout(pullPreview, 500);
  });
  $('f-url').addEventListener('change', () => { clearTimeout(previewWait); previewFor = ''; pullPreview(); });

  // Show an object in the dialog: a new one (`id` null; `seed` its start, with its kind), or an existing one.
  function openEditor(id, seed) {
    const cur = id ? research.get(id) : null;
    if (id && !cur) return;
    if (cur && cur.broken) return; // an unreadable link can only be removed
    const s = seed || {};
    const kind = cur ? cur.kind : KINDS.includes(s.kind) ? s.kind : 'note';
    const it = cur || { kind, title: s.title || '', body: s.body || '', excerpt: s.excerpt || '', content: '', url: s.url || '', tags: [], date: '', point: s.point || null, by: '', ai: null, icon: s.icon || '' };
    state.editing = { id: id || null, kind, version: cur ? research.versionOf(id) : undefined, point: it.point, pointOk: true, conflict: null, icon: kind === 'note' ? noteIcon(it.icon) : '', image: kind === 'link' ? (it.image || '') : '' };
    paintIconChoices();
    dropConflict();
    $('form').dataset.kind = kind;
    $('editor-title').textContent = id ? (canEdit() ? `Change this ${KIND_LABEL[kind].toLowerCase()}` : it.title) : `New ${KIND_LABEL[kind].toLowerCase()}`;
    $('f-title').value = kind === 'photo' ? '' : it.title;
    $('f-caption').value = kind === 'photo' ? it.title : '';
    $('f-url').value = it.url;
    $('f-body').value = kind === 'answer' ? it.content : it.body;
    fill($('form'), { 'body-label': kind === 'answer' ? 'Answer' : 'Note' });
    $('f-excerpt').value = it.excerpt;
    $('f-tags').value = it.tags.join(', ');
    $('f-point').value = it.point ? geo.coordsText(it.point.lat, it.point.lng) : '';
    $('f-point-note').textContent = '';
    clearPreview();
    $('f-date').value = it.date;
    hide($('f-asked'), !(kind === 'answer' && it.ai));
    if (kind === 'answer' && it.ai) {
      fill($('f-asked'), { asked: it.ai.question });
      const src = $('f-asked').querySelector('[data-slot="sources"]');
      src.replaceChildren(...it.ai.sources.map(sourcePill));
    }
    $('f-by').textContent = it.by ? `Added by ${nameOf(it.by) || 'someone'}${it.at ? ' on ' + dayText(it.at.slice(0, 10)) : ''}` : '';
    editorError('');
    setFormEditable(canEdit());
    datePicker.refresh();
    hide($('f-save'), !canEdit());
    hide($('form').querySelector('[data-action="suggest-tags"]'), !(state.ai && canEdit() && id && kind !== 'photo'));
    hide($('f-delete'), !id || !cur || !mayRemove(cur));
    $('f-delete').textContent = 'Remove';
    // Read-only: no Cancel; the window's own Close in the corner is the one Close. The row goes when nothing in it shows.
    hide($('f-cancel'), !canEdit());
    hide($('f-cancel').parentElement, [...$('f-cancel').parentElement.querySelectorAll('button')].every((b) => b.hidden));
    state.armed = null;
    hydrate($('editor'));
    if (canEdit()) state.editing.opened = formSnapshot();
    // Focus goes back to the object's card after a save (found again by its id, since render() redraws the list), else
    // to whatever had it before.
    editor.open({
      focus: canEdit() ? (kind === 'photo' ? $('f-caption') : kind === 'link' && !id ? $('f-url') : $('f-title')) : $('editor'), // read-only: the window itself
      returnTo: id ? () => root.querySelector(`.rcard[data-id="${CSS.escape(id)}"]`) : null,
    });
    if (kind === 'link' && it.image && state.previews) {
      host.preview.image(it.image).then((u) => { if (state.editing && state.editing.image === it.image && u) showShot(u); }).catch(() => {});
    }
    if (kind === 'link' && it.url && !id) pullPreview(); // a saved link is not read again until its address changes
  }
  // After a save or a removal, or when the view changes: closes at once, nothing asked.
  function closeEditor() { state.editing = null; editor.close(); }

  // Someone else changed the object that is open: say so, and offer their version or keeping mine.
  function checkConflict() {
    const e = state.editing;
    if (!e || !e.id || !canEdit() || e.conflict) return;
    if (!research.get(e.id)) { closeEditor(); return; }
    const now = research.versionOf(e.id);
    if (now !== e.version) showConflict(now);
  }
  function showConflict(version) {
    const e = state.editing;
    if (!e) return;
    dropConflict();
    e.conflict = { version };
    const bar = clone('tpl-conflict');
    fill(bar, { text: 'Someone changed this while you were editing.' });
    $('form').querySelector('.sdk-editor-actions').before(bar);
    editorError('');
  }
  $('form').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-action]');
    const e = state.editing;
    if (!b || !e || !e.conflict) return;
    if (b.dataset.action === 'use-theirs') { const id = e.id; dropConflict(); openEditor(id); }
    else if (b.dataset.action === 'keep-mine') { e.version = e.conflict.version; dropConflict(); }
  });

  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const e = state.editing;
    if (!e || !canEdit()) return;
    const base = e.id ? research.get(e.id) : null;
    const kind = e.kind;
    readPoint();
    if (!e.pointOk) return editorError('The place is not coordinates or a map link. Leave it empty, or paste one.');
    if (e.conflict) return editorError('Choose Use theirs or Keep mine first.');
    const url = kind === 'link' ? cleanUrl($('f-url').value) : '';
    if (kind === 'link' && !url) return editorError('Give a web address that starts with https:// or http://.');
    // The same address twice: said once, and saved when Save is pressed again.
    if (kind === 'link' && (!base || base.url !== url) && research.list().some((x) => x.kind === 'link' && x.id !== e.id && x.url === url) && e.dupFor !== url) {
      e.dupFor = url;
      return editorError('This link is already here. Press Save again to add it anyway.');
    }
    const title = kind === 'photo' ? $('f-caption').value : $('f-title').value;
    if (!geo.oneLine(title, 120) && kind !== 'link' && !(kind === 'note' && $('f-body').value.trim())) return editorError(kind === 'photo' ? 'Give the photo a caption.' : 'Give it a title, or write something in it.');
    const item = {
      id: e.id || '',
      kind,
      title,
      body: kind === 'note' ? $('f-body').value : '',
      excerpt: kind === 'link' ? $('f-excerpt').value : '',
      content: kind === 'answer' ? $('f-body').value : '',
      url: url || '',
      image: kind === 'link' ? (e.image || '') : '',
      tags: parseTags($('f-tags').value),
      date: $('f-date').value,
      point: kind === 'photo' || kind === 'answer' ? (base ? base.point : null) : e.point,
      file: base ? base.file : null,
      by: base ? base.by : me,
      at: base ? base.at : new Date().toISOString(),
      ai: base ? base.ai : null,
      icon: kind === 'note' ? noteIcon(e.icon) : '',
    };
    $('f-save').disabled = true;
    try {
      await research.save(item, e.id ? e.version : undefined);
      closeEditor();
    } catch (err) {
      if (err && err.status === 409) {
        if (e.id && research.get(e.id)) showConflict(research.versionOf(e.id));
        else editorError('That was removed by someone else.');
      } else editorError('It could not be saved: ' + message(err));
    } finally {
      $('f-save').disabled = false;
    }
  });
  // Cancel goes the way the SDK's own Close does (editor.cancel), so it asks "Discard your changes?" after typing.
  $('form').addEventListener('input', () => { if (!$('f-error').hidden) editorError(''); }); // a problem named is gone once the person types again
  $('f-cancel').addEventListener('click', () => editor.cancel());
  $('f-delete').addEventListener('click', async () => {
    const e = state.editing;
    if (!e || !e.id) return;
    if (state.armed !== 'editor') { state.armed = 'editor'; $('f-delete').textContent = 'Remove it?'; return; }
    state.armed = null;
    try { await research.remove(e.id); closeEditor(); } catch (err) { editorError('It could not be removed: ' + message(err)); }
  });
  // --- photos: choose, prepare (resize and a thumbnail, here in the page), upload ------------------------------------

  const jpegOf = (bitmap, max, quality) => {
    const { width, height } = fitSize(bitmap.width, bitmap.height, max);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // a transparent picture becomes white rather than black
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the picture could not be prepared'))), 'image/jpeg', quality));
  };

  function newUpload(file) {
    const el = clone('tpl-upload');
    fill(el, { name: file.name || 'Photo' });
    const rec = { el, file, step: '', error: false, scope: scopeOf(), store: stores[view] }; // the view it was chosen in, even if the person switches
    state.uploads.push(rec);
    el.querySelector('[data-action="retry-upload"]').addEventListener('click', () => { rec.error = false; runUpload(rec); });
    el.querySelector('[data-action="dismiss-upload"]').addEventListener('click', () => finishUpload(rec));
    return rec;
  }
  const setStep = (rec, step, progress, error) => {
    rec.error = Boolean(error);
    fill(rec.el, { step });
    rec.el.classList.toggle('failed', Boolean(error));
    if (progress !== undefined) rec.el.querySelector('progress').value = progress;
    hide(rec.el.querySelector('[data-action="retry-upload"]'), !error);
    hide(rec.el.querySelector('[data-action="dismiss-upload"]'), !error);
  };
  const finishUpload = (rec) => { state.uploads = state.uploads.filter((u) => u !== rec); rec.el.remove(); render(); };

  async function runUpload(rec) {
    const sc = rec.scope;
    const store = rec.store;
    try {
      setStep(rec, 'Preparing…', 5);
      const facts = await host.uploads.inspect(rec.file.slice(0, 256 * 1024, rec.file.type), { scope: sc }).catch(() => ({}));
      let bitmap;
      try { bitmap = await createImageBitmap(rec.file, { imageOrientation: 'from-image' }); } catch (err) { throw new Error('this browser cannot read that picture'); }
      const main = await jpegOf(bitmap, 2000, 0.85);
      const thumb = await jpegOf(bitmap, 400, 0.8);
      if (bitmap.close) bitmap.close();
      setStep(rec, 'Uploading…', 35);
      const file = rec.done || (rec.done = await host.uploads.put(main, { name: rec.file.name, scope: sc }));
      setStep(rec, 'Uploading…', 75);
      await host.uploads.thumb(file.id, thumb, { scope: sc });
      const day = facts.taken ? facts.taken.slice(0, 10) : '';
      const item = await store.save({ kind: 'photo', title: captionOf(rec.file.name) || 'Photo', file: { id: file.id, hasThumb: true }, tags: [], date: isDay(day) ? day : '', by: me });
      if (facts.hasPosition && facts.position) { rec.el = askPosition(rec, item, facts.position); renderUploads(); } else finishUpload(rec);
    } catch (err) {
      setStep(rec, 'Could not add it: ' + message(err), undefined, true);
    }
    renderUploads();
  }
  // The file had a position, which is left out unless the person keeps it.
  function askPosition(rec, item, position) {
    const el = clone('tpl-pos-ask');
    fill(el, { text: `This photo has a position (${geo.coordsText(position.lat, position.lng)}). Photos are shared without it unless you keep it.` });
    el.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-action]');
      if (!b) return;
      if (b.dataset.action === 'keep-position') {
        try {
          const cur = rec.store.get(item.id);
          if (cur) await rec.store.save({ ...cur, point: position }, rec.store.versionOf(item.id));
        } catch (err) { say('The position could not be kept: ' + message(err), 4000); }
      }
      finishUpload(rec);
    });
    return el;
  }
  function addPhotos(files) {
    if (!canEdit()) return;
    const list = [...files].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    if (!list.length) return say('Choose a picture (JPEG, PNG, WebP or a phone photo).', 4000);
    for (const f of list.slice(0, 10)) runUpload(newUpload(f));
    renderUploads();
  }
  function choosePhotos() {
    if (!canEdit()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.addEventListener('change', () => addPhotos(input.files));
    input.click();
  }

  async function checkAi() {
    try { state.ai = Boolean((await host.ai.available()).available); } catch (err) { state.ai = false; }
    // "Research this" asks in Chat, which a module's own page has none of.
    try { state.chat = Boolean((await host.chat.available()).available); } catch (err) { state.chat = false; }
  }

  // Suggest tags for the object in the dialog (a saved one: the server reads it as the person asking). The words go into the tags field
  // for the person to keep or change; nothing is saved until they save.
  async function suggestTags() {
    const e = state.editing;
    const btn = $('form').querySelector('[data-action="suggest-tags"]');
    if (!e || !e.id || !state.ai || !btn) return;
    btn.disabled = true;
    editorError('');
    try {
      const r = await host.ai.ask({ task: 'tags', objects: [research.refOf(e.kind, e.id)] });
      const have = parseTags($('f-tags').value);
      const suggested = (r.tags || []).map((t) => String(t).replace(/<[^>]*>/g, ' ').trim().replace(/\s+/g, '-')).filter(Boolean); // "old town" stays one tag
      $('f-tags').value = [...new Set([...have, ...suggested])].slice(0, 8).join(', ');
      if (!suggested.length) editorError('The AI had no tags to suggest.');
    } catch (err) { editorError('The AI could not suggest tags: ' + message(err)); } finally { btn.disabled = false; }
  }

  // --- clicks on the page -------------------------------------------------------------------------------------------

  root.addEventListener('click', async (ev) => {
    const t = ev.target.closest('[data-action]');
    const cardEl = ev.target.closest('.rcard');
    if (t && t.dataset.action === 'menu' && cardEl) {
      ev.stopPropagation();
      return openMenu(cardEl.dataset.id, t);
    }
    if (t && t.dataset.action === 'open-backlink') { ev.stopPropagation(); const ref = linkTarget.get(t); if (ref) host.objects.open(ref).catch(() => say('That could not be opened.', 3000)); return; }
    if (t && t.dataset.action === 'suggest-tags') return suggestTags();
    if (t && t.dataset.action === 'new-note') return openEditor(null, { kind: 'note' });
    if (t && t.dataset.action === 'new-link') return openEditor(null, { kind: 'link' });
    if (t && t.dataset.action === 'add-photo') return choosePhotos();
    if (t && t.dataset.action === 'clear-filter') { state.filter = ''; state.kind = ''; state.tags = []; return render(); }
    if (t && t.dataset.action === 'edit' && cardEl) { ev.stopPropagation(); return openEditor(cardEl.dataset.id); }
    // A plain click only opens or closes the card to read it in place (the editor is the pen button, a double click, or
    // Shift+Enter); a link, a button or the menu inside it does its own thing.
    if (cardEl && !ev.target.closest('.menu, a, button, [data-action]')) toggleCard(cardEl);
  });
  root.addEventListener('dblclick', (ev) => {
    const cardEl = ev.target.closest('.rcard');
    if (cardEl && !ev.target.closest('.menu, a, button, [data-action]')) openEditor(cardEl.dataset.id);
  });
  function toggleCard(el, on) {
    const open = on === undefined ? !state.open.has(el.dataset.id) : on;
    if (open) state.open.add(el.dataset.id); else state.open.delete(el.dataset.id);
    el.classList.toggle('open', open);
    el.classList.toggle('on', open);
    el.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) peekLink(el.dataset.id);
  }
  // An object can be dragged out to another module (onto a day of a plan, or a task that links to it): press its card and move.
  if (host.objects && host.objects.draggable) {
    host.objects.draggable(root, (target) => {
      const el = target.closest && target.closest('.rcard');
      if (!el || !el.dataset.id || target.closest('.menu, button, a')) return null;
      const it = research.get(el.dataset.id);
      return it ? { kind: it.kind, id: it.id, label: it.title, ...(view === 'my' ? { scope: 'person' } : {}) } : null;
    });
  }
  // Escape in the editor window is the SDK's (host.ui.editor asks about unsaved changes).
  root.addEventListener('keydown', (ev) => {
    if (!ev.target.classList || !ev.target.classList.contains('rcard')) return;
    if (ev.key === 'Enter' && ev.shiftKey) { ev.preventDefault(); openEditor(ev.target.dataset.id); }
    else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleCard(ev.target); }
  });

  // --- adding: the titlebar's "+", and what other modules and pointers ask ------------------------------------------

  // The host's "+" holds the three adds wherever Research is drawn: a window's titlebar, popped out, or its own page.
  // The empty state's own buttons stay: they add to an empty page.
  const addNote = () => openEditor(null, { kind: 'note' });
  const addLink = () => openEditor(null, { kind: 'link' });
  const syncAdd = () => host.add.set(canEdit() ? [
    { id: 'note', label: 'Note', icon: 'note-sticky' },
    { id: 'link', label: 'Link', icon: 'link' },
    { id: 'photo', label: 'Photo', icon: 'camera' },
  ] : []).catch(() => {});
  syncAdd();
  host.on('add', (e) => {
    if (!canEdit()) return;
    if (e.id === 'photo') return choosePhotos();
    if (e.id === 'link') return addLink();
    if (e.id === 'note') return addNote();
  });
  // Something from another module dropped on the pane: what can be done with it is the shared decision
  // (host.objects.dropMenu). Starting a note about it, with its title, linked to it, is this module's own offer (a
  // personal note is not linked: private objects are not linked to or from); a summary carried by the drag (an answer)
  // keeps its text as the note's body. The modules around add theirs.
  if (host.objects && host.objects.dropTarget) {
    const showDrop = (yes) => { $('app').classList.toggle('drop-target', yes); hide($('drop-hint'), !yes); };
    const foreign = (ref, dragged) => (ref ? ref.module !== info.module.id : Boolean(dragged && dragged.summary));
    host.objects.dropTarget({
      over: (_point, ref, dragged) => showDrop(canEdit() && foreign(ref, dragged)),
      leave: () => showDrop(false),
      drop: async (ref, pt, dragged) => {
        showDrop(false);
        if (!canEdit() || !foreign(ref, dragged)) return;
        try {
          const chosen = await host.objects.dropMenu(dragged, pt, {
            context: {},
            own: [{
              id: 'note',
              label: 'Start a note about it',
              run: async (ctx) => {
                const note = await research.save({ kind: 'note', title: geo.oneLine(ctx.summary.title || '', 120) || 'Note', body: ref ? '' : String(ctx.summary.text || ''), tags: [], date: '', by: me });
                if (ref && view !== 'my') host.objects.setLinks(research.refOf('note', note.id), [ref]).catch(() => {});
                openEditor(note.id);
              },
            }],
            remember: 'pane',
          });
          if (chosen && chosen.id !== 'note') told(`${chosen.label}: done`);
        } catch (err) { say('It could not do that: ' + message(err), 4000); }
      },
    });
  }
  if (inSpace) {
    // Other modules' requests to save a note, a link or a picture go to the space's research. A picture sent from elsewhere
    // gets its thumbnail here, made from the file as uploaded (savePhoto).
    stores.space.provide(me, {
      ready: () => ensureLoaded('space'),
      makeThumb: async (fileId, file) => {
        // Only the person who added the file, or an owner, may give it a thumbnail: anyone else leaves it, asking nothing.
        const role = info.user && info.user.role;
        if (!file || (file.by !== me && role !== 'owner' && role !== 'admin')) return false;
        const address = await host.uploads.url(fileId, { scope: 'space' });
        const got = await fetch(address, { credentials: 'same-origin' });
        if (!got.ok) return false;
        const bitmap = await createImageBitmap(await got.blob(), { imageOrientation: 'from-image' });
        const thumb = await jpegOf(bitmap, 400, 0.8);
        if (bitmap.close) bitmap.close();
        await host.uploads.thumb(fileId, thumb, { scope: 'space' });
      },
    });
    stores.space.onCompose((text, kind) => {
      const entry = readEntry(text);
      // /l: always a link, the typed words as its address to fix in the editor; /n and the rest: as typed.
      openEditor(null, kind === 'link' ? (entry && entry.kind === 'link' ? entry : { kind: 'link', url: String(text || '').trim(), title: '', excerpt: '' }) : entry || { kind: 'note' });
    });
  }
  if (host.objects && host.objects.onOpen) {
    host.objects.onOpen((ref) => {
      if (ref.module !== info.module.id || !KINDS.includes(ref.kind)) return;
      const show = async () => {
        const want = ref.scope === 'person' ? 'my' : 'space';
        if (want !== view && allowed[want]) await showView(want);
        openEditor(ref.id);
      };
      if (state.loaded) show(); else state.openWanted = show;
    });
  }

  // --- start --------------------------------------------------------------------------------------------------------

  const VIEW_OPTIONS = [
    { id: 'my', label: 'Mine', icon: 'user' },
    { id: 'space', label: `This ${word('space')}`, icon: 'users' },
  ].filter((o) => allowed[o.id]);
  const viewSwitch = VIEW_OPTIONS.length > 1 ? host.ui.viewSwitch({ id: 'whose', options: VIEW_OPTIONS, value: view, onChange: showView }) : null;
  // How the objects are laid out: cards packed like masonry, or a list. Remembered per person.
  try { state.layout = localStorage.getItem('research-layout') === 'list' ? 'list' : 'grid'; } catch (err) { state.layout = 'grid'; }
  host.ui.viewSwitch({
    id: 'layout',
    options: [{ id: 'grid', label: 'Cards', icon: 'grip', iconOnly: true }, { id: 'list', label: 'List', icon: 'list', iconOnly: true }],
    value: state.layout,
    onChange: (next) => {
      state.layout = next === 'list' ? 'list' : 'grid';
      try { localStorage.setItem('research-layout', state.layout); } catch (err) { /* not remembered */ }
      render();
    },
  });
  async function showView(next) {
    if (!allowed[next]) next = inSpace ? 'space' : 'my';
    view = next;
    try { localStorage.setItem('research-view', view); } catch (err) { /* not remembered */ }
    viewSwitch?.set(view);
    syncAdd();
    state.filter = ''; state.kind = ''; state.tags = [];
    host.menu.close();
    closeEditor();
    state.uploads = [];
    links.clear();
    askedLinks.clear();
    render();
    try { await ensureLoaded(view); if (view === next) { render(); loadLinks().catch(() => {}); } } catch (err) { say('This could not load: ' + message(err)); }
  }
  try { const last = localStorage.getItem('research-view'); if (allowed[last]) view = last; } catch (err) { /* the default */ }
  viewSwitch?.set(view);
  let wired = false; // the settings and the icon choices are listened to once, however many times it is tried
  async function load() {
    $('msg').hidden = true;
    $('loading').hidden = true;
    $('app').hidden = false;
    render();
    try {
      await ensureLoaded(view);
      state.people = await host.people().catch(() => []);
      const applySettings = (v) => { loadTagColors(v); state.previews = Boolean(v && v.linkPreviews); };
      try { applySettings(await host.settings.get()); } catch (err) { applySettings(null); }
      if (!wired) host.settings.onChange((v) => { applySettings(v); if (state.loaded) render(); });
      const choices = $('f-icons');
      choices.replaceChildren(...NOTE_ICONS.map(([icon, label]) => {
        const el = clone('tpl-icon-choice');
        el.dataset.iconName = icon;
        el.title = label;
        el.setAttribute('aria-label', label);
        setIcon(el.querySelector('[data-icon]'), icon);
        fill(el, { label });
        return el;
      }));
      if (!wired) {
        choices.addEventListener('click', (ev) => {
          const b = ev.target.closest('[data-action="pick-icon"]');
          if (!b || !state.editing || state.editing.kind !== 'note') return;
          state.editing.icon = b.dataset.iconName;
          paintIconChoices();
        });
      }
      wired = true;
      await Promise.all([...new Set([...root.querySelectorAll('[data-icon]'), ...[...root.querySelectorAll('template')].flatMap((t) => [...t.content.querySelectorAll('[data-icon]')])].map((n) => n.dataset.icon).concat(Object.values(KIND_ICON), NOTE_ICONS.map(([icon]) => icon)))].filter(Boolean).map(wantIcon));
      hydrate(choices);
      state.loaded = true;
      render();
      loadLinks().catch(() => {});
      checkAi();
      if (state.openWanted) { const f = state.openWanted; state.openWanted = null; f(); }
    } catch (err) {
      $('app').hidden = true;
      showMsg('The research could not load', message(err), load);
    }
  }
  await load();
})();
