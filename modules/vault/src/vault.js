// The Vault module (documentation/plans/plan-attachments-vault.md, step 2): the files of a space, as a List or a Grid, with search,
// Filters, Add files with progress, Rename, Remove (with where each file is used), Select for several, the status line and the
// empty and full states. The files and the rules about them are the server's (the library routes, reached through host.library);
// this page only draws them. It draws into the markup in vault.html and builds its rows and cards from the design system's pieces
// (the Cards block: banded card and row), with its own classes only where the Vault needs them (vault.css).
//
// Opening a file is one seam: openFile(file), which asks the host for a file window (host.files.open).
(async function () {
  'use strict';

  const host = (document.currentScript && document.currentScript.host) || window.host;
  const root = host.root;
  const word = host.util.word;
  const $ = (id) => root.getElementById(id);

  // ---- small helpers ------------------------------------------------------------------------------------------------------------
  const iconSvg = new Map();
  const iconWait = new Map();
  function wantIcon(name) {
    if (iconSvg.has(name)) return Promise.resolve(iconSvg.get(name));
    if (!iconWait.has(name)) iconWait.set(name, host.ui.icon(name).then((svg) => { iconSvg.set(name, svg); return svg; }).catch(() => { iconSvg.set(name, ''); return ''; }));
    return iconWait.get(name);
  }
  // An icon span: filled at once when the icon is known, else when it arrives.
  function ic(name, cls = '') {
    const s = document.createElement('span');
    s.className = `ic${cls ? ` ${cls}` : ''}`;
    s.setAttribute('aria-hidden', 'true');
    if (iconSvg.has(name)) s.innerHTML = iconSvg.get(name);
    else wantIcon(name).then((svg) => { s.innerHTML = svg; });
    return s;
  }
  function hydrate(scope) {
    for (const el of scope.querySelectorAll('[data-icon]')) {
      if (el.dataset.filled) continue;
      el.dataset.filled = '1';
      wantIcon(el.dataset.icon).then((svg) => { el.innerHTML = svg; });
    }
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function button(cls, { label, icon, tip, aria } = {}) {
    const b = el('button', cls);
    b.type = 'button';
    if (icon) b.append(ic(icon));
    if (label) b.append(el('span', '', label));
    if (aria || (!label && tip)) b.setAttribute('aria-label', aria || tip);
    if (tip) b.dataset.tip = tip;
    return b;
  }
  const MB = 1024 * 1024;
  const GB = 1024 * MB;
  const trim = (n, d) => String(Number(n.toFixed(d)));
  function size(bytes) {
    if (bytes >= GB) return `${trim(bytes / GB, bytes >= 10 * GB ? 0 : 1)} GB`;
    if (bytes >= MB) return `${trim(bytes / MB, bytes >= 100 * MB ? 0 : 1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function when(iso, long = false) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const today = new Date();
    const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    if (!long && days === 0) return 'Today';
    if (!long && days === 1) return 'Yesterday';
    return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== today.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
  }

  // ---- what a file is, as a person reads it -----------------------------------------------------------------------------------
  const KINDS = {
    picture: { icon: 'file-image', tint: 'teal', word: 'Picture' },
    audio: { icon: 'file-audio', tint: 'purple', word: 'Audio' },
    video: { icon: 'file-video', tint: 'orange', word: 'Video' },
    pdf: { icon: 'file-pdf', tint: 'red', word: 'PDF' },
    text: { icon: 'file-lines', tint: 'gold', word: 'Markdown' },
  };
  const kindOf = (f) => (f.group === 'image' ? 'picture' : f.group === 'audio' ? 'audio' : f.group === 'video' ? 'video' : f.type === 'application/pdf' ? 'pdf' : 'text');
  const GROUP_WORD = { image: 'Pictures', audio: 'Audio', video: 'Video', document: 'Documents' };
  // IMG_2 comes before IMG_10: numbers in a name are read as numbers.
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const SORTS = [
    ['new', 'Newest first', (a, b) => (b.at > a.at ? 1 : -1)],
    ['old', 'Oldest first', (a, b) => (a.at > b.at ? 1 : -1)],
    ['name', 'Name, A to Z', (a, b) => byName(a, b)],
    ['big', 'Largest first', (a, b) => b.size - a.size],
    ['kind', 'Type', (a, b) => kindOf(a).localeCompare(kindOf(b)) || byName(a, b)],
  ];

  // ---- start -------------------------------------------------------------------------------------------------------------------------
  function showMsg(title, text, { retry, icon } = {}) {
    $('loading').hidden = true;
    $('body').hidden = true;
    const m = $('msg');
    const parts = [ic(icon || (retry ? 'triangle-exclamation' : 'circle-info')), el('h2', 'sdk-empty-title', title)];
    if (text) parts.push(el('p', 'sdk-empty-text', text));
    if (retry) {
      const actions = el('div', 'sdk-empty-actions');
      const again = button('btn', { label: 'Retry' });
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
    $('app').hidden = false;
    showMsg('This could not start', err.message, { retry: () => location.reload() });
    return;
  }
  $('app').hidden = false;
  const MODULE = info.module.name; // the template's word for it: Vault, Documents, Handouts
  const SPACE = word('space');
  host.setTitle(MODULE);
  const inSpace = info.context.scope === 'space';
  const ASK_WORDS = `Ask ${word('owner', { a: true })} or ${word('moderator', { a: true })} if you need them.`;
  const me = (info.user && info.user.key) || '';
  const can = (key) => host.can(key);
  if (!inSpace || !can('view')) {
    showMsg(inSpace ? `You can't see the files in this ${SPACE}.` : `Open the ${MODULE} inside ${word('space', { a: true })}.`, inSpace ? ASK_WORDS : '', { icon: 'lock' });
    return;
  }
  const mayAdd = can('add');
  const mayDownload = can('download');
  const mayRemoveAny = can('remove_any');
  const mayShare = can('share');
  const mayRemove = (f) => mayRemoveAny || f.by === me;

  const PAGE = 100; // files drawn at a time; more come as the list is scrolled
  const state = {
    files: [], usage: { bytes: 0, maxBytes: 0 },
    view: 'list', sort: 'new', query: '', types: new Set(), by: 'all', linked: new Set(),
    shared: false, selecting: false, sel: new Set(), adding: false, queue: [], loaded: false,
    people: new Map(), removeWhere: false, notice: null, dropping: false, limit: PAGE,
  };

  // What a person chose here stays with them (their own data, not the space's): the List or Grid and Remove where it was taken.
  // Off (the position is kept) until they say otherwise.
  const PREFS = 'prefs';
  async function loadPrefs() {
    try {
      const r = (await host.storage.list(PREFS, { scope: 'person' })).find((i) => i.key === PREFS);
      if (r && r.value && typeof r.value === 'object') {
        if (r.value.view === 'grid' || r.value.view === 'list') state.view = r.value.view;
        state.removeWhere = r.value.removeWhere === true;
      }
    } catch { /* not kept: the defaults stand */ }
  }
  function savePrefs() { host.storage.set(PREFS, { view: state.view, removeWhere: state.removeWhere }, { scope: 'person' }).catch(() => {}); }
  // A video's length, read when its small picture is made. The server's record has no length, so the space keeps them here, by file id.
  let durations = {};
  let durVersion;
  async function loadDurations() {
    try {
      const r = (await host.storage.list('durations')).find((i) => i.key === 'durations');
      if (r && r.value && typeof r.value === 'object') { durations = r.value; durVersion = r.version; }
    } catch { /* no lengths: the chip is left off */ }
  }
  async function saveDuration(id, seconds) {
    for (let again = 0; again < 3; again += 1) {
      const next = {};
      for (const f of state.files) if (durations[f.id]) next[f.id] = durations[f.id];
      next[id] = Math.max(1, Math.round(seconds));
      try {
        const saved = await host.storage.set('durations', next, durVersion === undefined ? undefined : { version: durVersion });
        durations = next; durVersion = saved && saved.version;
        return;
      } catch (err) {
        if (!err || err.status !== 409) return;
        await loadDurations();
      }
    }
  }
  const lengthWord = (sec) => { const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };

  const nameOf = (key) => (state.people.get(key) || (key === me && info.user ? info.user.displayName : '') || 'someone who left');
  const byWord = (f) => (f.by === me ? 'You' : nameOf(f.by));

  // ---- the files, as the person sees them now ---------------------------------------------------------------------------------------
  const matches = (f, q) => f.name.toLowerCase().includes(q) || nameOf(f.by).toLowerCase().includes(q) || KINDS[kindOf(f)].word.toLowerCase().includes(q);
  function filtered() {
    let out = state.files;
    if (state.types.size) out = out.filter((f) => state.types.has(f.group));
    if (state.by === 'mine') out = out.filter((f) => f.by === me);
    else if (state.by !== 'all') out = out.filter((f) => f.by === state.by);
    if (state.linked.size === 1) out = out.filter((f) => (state.linked.has('linked') ? f.uses > 0 : !f.uses));
    if (state.shared) out = out.filter((f) => f.shared === true);
    const q = state.query.trim().toLowerCase();
    if (q) out = out.filter((f) => matches(f, q));
    const cmp = (SORTS.find((s) => s[0] === state.sort) || SORTS[0])[2];
    return [...out].sort(cmp);
  }
  function filterWords() {
    const parts = [];
    if (state.types.size) parts.push([...state.types].map((g) => GROUP_WORD[g]).join(', '));
    if (state.by !== 'all') parts.push(state.by === 'mine' ? 'added by you' : `added by ${nameOf(state.by)}`);
    if (state.linked.size === 1) parts.push(state.linked.has('linked') ? 'linked' : 'not linked');
    if (state.shared) parts.push('shared');
    if (state.query.trim()) parts.push(`matching "${state.query.trim()}"`);
    return parts.join(', ');
  }
  function clearFilters() {
    state.types.clear(); state.by = 'all'; state.linked.clear(); state.shared = false; state.query = ''; state.sort = 'new';
  }

  // ---- loading ------------------------------------------------------------------------------------------------------------------------
  let lastSig = '';
  const signature = () => JSON.stringify([state.files.map((f) => [f.id, f.name, f.size, f.hasThumb, f.uses, f.shared === true, durations[f.id] || 0]), state.usage]);
  async function loadPeople() {
    try { for (const p of await host.people()) state.people.set(p.key, p.name); } catch { /* names are a nicety */ }
  }
  async function refresh({ quiet = false } = {}) {
    try {
      const [res] = await Promise.all([host.library.list(), loadDurations()]);
      state.files = Array.isArray(res.files) ? res.files : [];
      state.usage = res.usage || state.usage;
      for (const id of [...state.sel]) if (!state.files.some((f) => f.id === id)) state.sel.delete(id);
      for (const [id, url] of thumbs) if (!state.files.some((f) => f.id === id)) { URL.revokeObjectURL(url); thumbs.delete(id); }
      state.loaded = true;
      $('msg').hidden = true;
      const sig = signature();
      if (quiet && sig === lastSig) return;
      lastSig = sig;
      render();
    } catch (err) {
      if (quiet) return;
      if (err.status === 403 || err.status === 404) showMsg(`You can't see the files in this ${SPACE}.`, ASK_WORDS, { icon: 'lock' });
      else showMsg(`The ${MODULE} could not load`, err.message, { retry: () => refresh() });
    }
  }

  // ---- thumbnails: the small pictures are the server's; fetched once as bytes and kept here ---------------------------------------
  const thumbs = new Map(); // file id -> object address
  const thumbWait = new Map();
  let thumbRunning = 0;
  const thumbQueue = [];
  function pumpThumbs() {
    while (thumbRunning < 4 && thumbQueue.length) {
      const job = thumbQueue.shift();
      thumbRunning += 1;
      host.library.blob(job.id, { thumb: true }).then((blob) => {
        const url = URL.createObjectURL(blob);
        thumbs.set(job.id, url);
        job.done(url);
      }).catch(() => job.done('')).finally(() => { thumbRunning -= 1; thumbWait.delete(job.id); pumpThumbs(); });
    }
  }
  function wantThumb(id) {
    if (thumbs.has(id)) return Promise.resolve(thumbs.get(id));
    if (!thumbWait.has(id)) thumbWait.set(id, new Promise((done) => { thumbQueue.push({ id, done }); pumpThumbs(); }));
    return thumbWait.get(id);
  }
  const seen = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      seen.unobserve(e.target);
      const id = e.target.dataset.thumb;
      wantThumb(id).then((url) => {
        if (!url || !e.target.isConnected) return;
        const img = document.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        img.src = url;
        e.target.prepend(img);
      });
    }
  }, { rootMargin: '300px' }) : null;

  // A picture's or a video's small picture, made here before the file is sent on (decision 11): at most 400 px, a JPEG under 300 KB.
  // Gives { blob, duration } (the length in seconds, for a video), or null. A video is read from the server's address for it: the
  // page's policy refuses a blob address for media.
  async function makeThumb(file, kind, id) {
    const MAX = 400;
    let source;
    let duration = 0;
    let release = () => {};
    if (kind === 'picture') {
      try {
        source = await createImageBitmap(file, { imageOrientation: 'from-image' });
        release = () => source.close();
      } catch {
        return null;
      }
    } else {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'auto';
      video.playsInline = true;
      release = () => { video.removeAttribute('src'); video.load(); };
      try {
        const addr = await host.library.url(id);
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('slow')), 10000);
          video.onerror = () => { clearTimeout(t); reject(new Error('bad')); };
          video.onloadeddata = () => {
            if (Number.isFinite(video.duration)) duration = video.duration;
            const at = Math.min(1, (video.duration || 2) / 10);
            video.onseeked = () => { clearTimeout(t); resolve(); };
            video.currentTime = at;
          };
          video.src = addr;
        });
      } catch {
        release();
        return null;
      }
      source = video;
    }
    const w = source.videoWidth || source.width;
    const h = source.videoHeight || source.height;
    if (!w || !h) { release(); return null; }
    const scale = Math.min(1, MAX / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    release();
    for (const q of [0.82, 0.65, 0.45]) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
      if (blob && blob.size <= 300 * 1024) return { blob, duration };
    }
    return null;
  }

  // ---- the words that sit on the page -----------------------------------------------------------------------------------------------
  const usedBytes = () => state.usage.bytes || 0;
  const capBytes = () => state.usage.maxBytes || 0;
  const fullSentence = () => `This ${SPACE}'s ${MODULE} is full (${size(capBytes())}). Remove some files to add more.`;
  const isFull = () => capBytes() > 0 && usedBytes() >= capBytes();

  // ---- the host's bands: the toolbar, the title bar, the "+", the status line ---------------------------------------------------
  const VIEW_OPTIONS = [{ id: 'list', label: 'List', icon: 'list' }, { id: 'grid', label: 'Grid', icon: 'grip' }];
  await loadPrefs();
  const viewSwitch = host.ui.viewSwitch({ id: 'view', options: VIEW_OPTIONS, value: state.view, onChange: (v) => { state.view = v === 'grid' ? 'grid' : 'list'; state.limit = PAGE; savePrefs(); render(); } });
  function chosen() { return state.files.filter((f) => state.sel.has(f.id)); }
  function filtersChips() {
    const all = state.files;
    const count = (fn) => all.filter(fn).length;
    const others = [...new Set(all.map((f) => f.by))].filter((k) => k !== me).sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true }));
    return [
      { type: 'chips', id: 'sort', label: 'Sort by', single: true, value: state.sort, options: SORTS.map(([id, label]) => ({ id, label })) },
      { type: 'chips', id: 'type', label: 'Type', options: ['image', 'audio', 'video', 'document'].map((g) => ({ id: g, label: GROUP_WORD[g], count: count((f) => f.group === g), on: state.types.has(g), default: false })) },
      { type: 'chips', id: 'by', label: 'Added by', single: true, value: state.by, options: [{ id: 'all', label: 'Everyone' }, { id: 'mine', label: 'Mine' }, ...others.map((k) => ({ id: k, label: nameOf(k) }))] },
      { type: 'chips', id: 'linked', label: 'Linked', options: [{ id: 'linked', label: 'Linked', count: count((f) => f.uses > 0), on: state.linked.has('linked'), default: false }, { id: 'unlinked', label: 'Not linked', on: state.linked.has('unlinked'), default: false }] },
      ...(mayShare ? [{ type: 'chips', id: 'shared', label: 'Shared', options: [{ id: 'shared', label: 'Shared', count: count((f) => f.shared === true), on: state.shared, default: false }] }] : []),
    ];
  }
  function toolbarItems() {
    const search = { type: 'search', id: 'find', label: 'Search files', placeholder: 'Search files', value: state.query };
    if (state.selecting) {
      const n = state.sel.size;
      const picked = chosen();
      const removable = n > 0 && picked.every(mayRemove);
      return [
        { type: 'button', id: 'done', label: 'Done', icon: 'check' },
        { type: 'text', text: n ? `${n} selected` : 'Choose files' },
        { type: 'button', id: 'all', label: n === filtered().length && n ? 'Choose none' : 'Choose all', icon: 'square-check' },
        ...(mayDownload ? [{ type: 'button', id: 'sel-download', label: 'Download', icon: 'download', disabled: !n }] : []),
        ...(mayShare ? [{ type: 'button', id: 'sel-share', label: 'Share', icon: 'share-nodes', disabled: !n }] : []),
        { type: 'button', id: 'sel-remove', label: 'Remove', icon: 'trash', disabled: !removable, title: n && !removable ? 'Remove is only for files you added' : 'Remove' },
        search,
        ...filtersChips(),
      ];
    }
    const sortWord = (SORTS.find((x) => x[0] === state.sort) || SORTS[0])[1];
    return [{ type: 'text', text: sortWord }, search, ...filtersChips()];
  }
  function statusItems() {
    const total = state.files.length;
    const shown = filtered().length;
    const f = filterWords();
    const words = `${f ? `${shown} of ${plural(total, 'file')}` : plural(total, 'file')} · ${size(usedBytes())}${capBytes() ? ` of ${size(capBytes())}` : ''}`;
    const items = [{ text: words, icon: 'vault', title: `This ${SPACE}'s ${MODULE}` }];
    if (f) items.push({ text: f.length > 56 ? `${f.slice(0, 55)}…` : f, title: f });
    if (isFull()) items.push({ text: 'Full', icon: 'triangle-exclamation', title: fullSentence() });
    else if (capBytes() && usedBytes() / capBytes() >= 0.8) items.push({ text: 'Almost full', icon: 'triangle-exclamation' });
    if (state.selecting && state.sel.size && !chosen().every(mayRemove)) items.push({ text: 'Remove is only for files you added', icon: 'circle-info' });
    return items;
  }
  function chrome() {
    viewSwitch.set(state.view);
    host.toolbar.set(toolbarItems()).catch(() => {});
    const head = [];
    if (state.files.length && (mayDownload || mayShare || state.files.some(mayRemove))) head.push({ id: 'select', icon: 'square-check', title: 'Select', on: state.selecting });
    if (mayShare) head.push({ id: 'share-links', icon: 'share-nodes', title: 'Share links', overflow: true });
    host.header.set(head).catch(() => {});
    host.add.set(mayAdd ? [{ id: 'add', label: 'Add files', icon: 'plus' }] : []).catch(() => {});
    host.status.set(statusItems()).catch(() => {});
  }

  host.on('toolbar', (e) => {
    const id = e.id;
    if (id === 'find') { if (typeof e.value === 'string' && e.value !== state.query) { state.query = e.value; refilter(); } }
    else if (id === 'sort' && typeof e.value === 'string') { state.sort = SORTS.some((s) => s[0] === e.value) ? e.value : 'new'; refilter(); }
    else if (id === 'type' && typeof e.value === 'string') { if (e.on) state.types.add(e.value); else state.types.delete(e.value); refilter(); }
    else if (id === 'by' && typeof e.value === 'string') { state.by = e.value; refilter(); }
    else if (id === 'linked' && typeof e.value === 'string') { if (e.on) state.linked.add(e.value); else state.linked.delete(e.value); refilter(); }
    else if (id === 'shared' && typeof e.value === 'string') { state.shared = Boolean(e.on); refilter(); }
    else if (id === 'done') endSelecting();
    else if (id === 'all') { const ids = filtered().map((f) => f.id); if (state.sel.size === ids.length) state.sel.clear(); else ids.forEach((i) => state.sel.add(i)); render(); }
    else if (id === 'sel-download') downloadMany(chosen());
    else if (id === 'sel-share') shareFiles(chosen());
    else if (id === 'sel-remove') removeFiles(chosen(), endSelecting);
  });
  host.on('header', (e) => { if (e.id === 'share-links') { host.library.shares().catch(fail); return; } if (e.id === 'select') { if (state.selecting) endSelecting(); else { state.selecting = true; state.sel.clear(); render(); } } });
  host.on('add', (e) => { if (e.id === 'add' && mayAdd) { state.adding = true; render(); setTimeout(() => $('choose').focus(), 0); } });
  host.on('links', () => { refresh({ quiet: true }); });
  // Share links (public/share-sheet.js): the sheet and the list open over the page; a link made, changed or turned off arrives as 'sharechanged'.
  host.on('sharechanged', () => { refresh({ quiet: true }); });
  host.on('sharechoose', () => { if (!state.selecting) { state.selecting = true; state.sel.clear(); render(); } });
  function shareFiles(files) {
    if (!files.length) return;
    host.library.share(files.map((f) => f.id)).catch(fail);
  }
  function refilter() { state.limit = PAGE; render(); }
  function endSelecting() { state.selecting = false; state.sel.clear(); render(); }

  // ---- the menus ----------------------------------------------------------------------------------------------------------------------
  function fileMenu(f) {
    // The handlers return nothing: the menu waits for what an item returns before it closes, and while it is open it takes Escape.
    const items = [{ id: 'open', label: 'Open', icon: 'eye', onClick: () => { openFile(f, 'menu'); } }];
    if (mayDownload) items.push({ id: 'download', label: 'Download', icon: 'download', onClick: () => { host.library.download(f.id).catch(fail); } });
    if (mayShare) items.push({ id: 'share', label: 'Share', icon: 'share-nodes', onClick: () => { shareFiles([f]); } });
    if (mayRemove(f)) items.push({ id: 'rename', label: 'Rename', icon: 'pen-to-square', onClick: () => { renameFile(f); } });
    items.push({ id: 'uses', label: 'Where it is used', icon: 'link', hint: f.uses ? String(f.uses) : undefined, onClick: () => { showFile(f, { uses: true, opener: 'menu' }); } });
    if (mayRemove(f)) items.push({ separator: true }, { id: 'remove', label: 'Remove', icon: 'trash', danger: true, onClick: () => { removeFiles([f]); } });
    return items;
  }
  function fail(err) { host.ui.toast(err && err.message ? err.message : 'That did not work. Try again.'); }

  // ---- the list and the grid ----------------------------------------------------------------------------------------------------------
  const mark = (name) => {
    const q = state.query.trim();
    if (!q) return document.createTextNode(name);
    const i = name.toLowerCase().indexOf(q.toLowerCase());
    const frag = document.createDocumentFragment();
    if (i < 0) { frag.append(name); return frag; }
    frag.append(name.slice(0, i), el('mark', 'vt-mark', name.slice(i, i + q.length)), name.slice(i + q.length));
    return frag;
  };
  const itemEl = (id) => { for (const e of $('body').querySelectorAll('[data-id]')) if (e.dataset.id === id) return e; return null; };
  // Choosing one file changes that file's row or card and the toolbar, not the whole list, so a long list stays quick and the keyboard stays put.
  function pick(id, on) {
    if (on) state.sel.add(id); else state.sel.delete(id);
    const item = itemEl(id);
    if (item) {
      if (on) item.setAttribute('aria-selected', 'true'); else item.removeAttribute('aria-selected');
      const cb = item.querySelector('.vt-tick input');
      if (cb) cb.checked = on;
    }
    chrome();
  }
  function tick(f) {
    const lab = el('label', 'sdk-row-tick vt-tick');
    const cb = el('input');
    cb.type = 'checkbox'; cb.checked = state.sel.has(f.id); cb.setAttribute('aria-label', `Choose ${f.name}`);
    cb.addEventListener('change', () => pick(f.id, cb.checked));
    lab.append(cb);
    return lab;
  }
  // A name too long for its line is cut in the middle, so the end (the extension) stays: "Vespa ri…p.mp4". The head holds the start
  // and fitCuts sets it to the longest start that fits beside the tail; the tooltip has the whole name.
  function cutName(name) {
    const dot = name.lastIndexOf('.');
    const at = Math.max(1, dot > 0 ? Math.max(1, dot - 3) : name.length - 4);
    const head = el('span', 'vt-nm-head'); head.dataset.start = name.slice(0, at); head.append(mark(name.slice(0, at)));
    const tail = el('span', 'vt-nm-tail'); tail.append(mark(name.slice(at)));
    const frag = document.createDocumentFragment(); frag.append(head, tail);
    return frag;
  }
  // Every name is measured first, then every cut is written, so the page is laid out once however many cards there are.
  let measure = null;
  function fitCuts(within) {
    const app = $('body');
    if (!app.clientWidth) return;
    const cuts = [...(within || app).querySelectorAll('.vt-cut')];
    if (!cuts.length) return;
    const head0 = cuts[0].querySelector('.vt-nm-head');
    if (!head0) return;
    if (!measure) measure = document.createElement('canvas').getContext('2d');
    const hs = getComputedStyle(head0);
    measure.font = `${hs.fontStyle} ${hs.fontWeight} ${hs.fontSize} ${hs.fontFamily}`;
    const cs = getComputedStyle(cuts[0]);
    const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const jobs = [];
    for (const b of cuts) {
      const head = b.querySelector('.vt-nm-head'); const tail = b.querySelector('.vt-nm-tail');
      if (head && tail) jobs.push({ head, start: head.dataset.start, left: b.clientWidth - pad - tail.getBoundingClientRect().width - 1 });
    }
    const wide = (t) => measure.measureText(t).width;
    for (const j of jobs) {
      if (wide(j.start) <= j.left) { j.text = j.start; continue; }
      let lo = 0; let hi = j.start.length - 1;
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (wide(`${j.start.slice(0, mid)}…`) <= j.left) lo = mid; else hi = mid - 1; }
      j.text = `${j.start.slice(0, lo)}…`;
    }
    for (const j of jobs) {
      if (j.head.dataset.shown === j.text || (j.head.dataset.shown === undefined && j.text === j.start)) continue;
      j.head.dataset.shown = j.text;
      j.head.replaceChildren(mark(j.text));
    }
  }
  function openButton(f, cls, cut = false) {
    const b = el('button', `sdk-open ${cls}${cut ? ' vt-cut' : ''}`);
    b.type = 'button';
    b.append(cut ? cutName(f.name) : mark(f.name));
    b.title = f.name;
    b.addEventListener('click', () => {
      if (state.selecting) pick(f.id, !state.sel.has(f.id)); else openFile(f, 'open');
    });
    return b;
  }
  function menuButton(f) {
    const m = el('button', 'menu-btn sdk-icon-btn btn-quiet btn-small');
    m.type = 'button'; m.setAttribute('aria-label', `More for ${f.name}`); m.setAttribute('aria-haspopup', 'menu'); m.dataset.tip = 'More';
    m.dataset.menu = f.id;
    m.append(ic('ellipsis-vertical'));
    m.addEventListener('click', (e) => { e.stopPropagation(); host.menu.show({ id: `file-${f.id}`, anchor: m, items: fileMenu(f) }); });
    return m;
  }
  function badges(f) {
    const box = el('span', 'vt-flags');
    if (f.uses) {
      const s = el('span', 'vt-flag');
      s.title = `Linked from ${plural(f.uses, 'place')}`;
      s.setAttribute('aria-label', s.title);
      s.append(ic('link'), el('span', '', String(f.uses)));
      box.append(s);
    }
    if (f.shared) {
      const s = el('span', 'vt-flag');
      s.title = 'Shared by a link';
      s.setAttribute('aria-label', 'Shared by a link');
      s.append(ic('share-nodes'));
      box.append(s);
    }
    return box;
  }
  // The file's picture: a square. A picture and a video have their small picture (a video a play mark); the rest a type tile.
  function thumb(f) {
    const k = KINDS[kindOf(f)];
    const box = el('span', 'vt-thumb');
    box.dataset.tint = k.tint;
    if (f.hasThumb) {
      box.dataset.thumb = f.id;
      if (thumbs.has(f.id)) { const img = document.createElement('img'); img.alt = ''; img.src = thumbs.get(f.id); box.append(img); } else if (seen) seen.observe(box);
      box.append(ic(k.icon, 'vt-tile'));
      if (f.group === 'video') { const play = el('span', 'vt-play'); play.append(ic('play')); box.append(play); if (durations[f.id]) box.append(el('span', 'vt-len', lengthWord(durations[f.id]))); }
    } else {
      box.classList.add('vt-bare');
      box.append(ic(k.icon, 'vt-tile'));
    }
    return box;
  }
  function sub(f) {
    const s = el('span', 'sdk-row-sub vt-sub');
    s.append(el('span', 'vt-sub-kind', `${KINDS[kindOf(f)].word} · `), size(f.size));
    s.append(el('span', 'vt-sub-narrow', ` · ${byWord(f)} · ${when(f.at)}`));
    return s;
  }
  function personDot(key) {
    const a = el('span', 'sdk-avatar sdk-avatar-20');
    a.append(el('span', 'sdk-avatar-ini', (nameOf(key)[0] || '?').toUpperCase()));
    a.setAttribute('aria-hidden', 'true');
    return a;
  }
  const ticks = () => state.selecting;
  function rowEl(f) {
    const li = el('li', 'sdk-row vt-row');
    li.dataset.id = f.id; li.dataset.tint = KINDS[kindOf(f)].tint;
    if (state.sel.has(f.id)) li.setAttribute('aria-selected', 'true');
    if (ticks()) li.append(tick(f));
    li.append(thumb(f));
    const main = el('span', 'sdk-row-main');
    main.append(openButton(f, 'vt-title'), sub(f));
    li.append(main);
    const by = el('span', 'vt-by'); by.append(personDot(f.by), el('span', 'vt-by-name', byWord(f)));
    li.append(by, el('span', 'sdk-row-meta vt-when', when(f.at)), badges(f), menuButton(f));
    return li;
  }
  const narrow = () => $('app').clientWidth > 0 && $('app').clientWidth <= 480;
  function cardEl(f) {
    const k = KINDS[kindOf(f)];
    if (narrow()) {
      const c = el('article', 'sdk-card vt-card vt-card-thumb');
      c.dataset.id = f.id; c.dataset.tint = k.tint;
      if (state.sel.has(f.id)) c.setAttribute('aria-selected', 'true');
      const over = el('div', 'vt-card-over');
      if (ticks()) { const first = el('span', 'vt-over-chip'); first.append(tick(f)); over.append(first); }
      over.append(el('span', 'vt-fill'));
      const chip = el('span', 'vt-over-chip');
      chip.append(menuButton(f));
      over.append(chip);
      const meta = el('div', 'vt-card-meta');
      const subl = el('span', 'vt-card-sub');
      subl.append(el('span', 'vt-x-kind', `${k.word} · `), size(f.size), el('span', 'vt-x-by', ` · ${byWord(f)}`));
      meta.append(openButton(f, 'vt-card-name'), subl, badges(f));
      c.append(thumb(f), over, meta);
      return c;
    }
    const c = el('article', 'sdk-card-banded vt-card');
    c.dataset.id = f.id; c.dataset.tint = k.tint;
    if (state.sel.has(f.id)) c.setAttribute('aria-selected', 'true');
    const head = el('header', 'sdk-card-head');
    if (ticks()) head.append(tick(f));
    const main = el('div', 'sdk-card-main');
    // One line: a small type icon in the kind's colour, the name cut in the middle, the more button.
    const mini = el('span', 'vt-kind-mini');
    mini.title = k.word; mini.setAttribute('role', 'img'); mini.setAttribute('aria-label', k.word);
    mini.append(ic(k.icon));
    const title = el('h3', 'vt-card-title');
    const nameBtn = openButton(f, 'vt-card-name', true);
    nameBtn.title = `${f.name} (${k.word})`;
    title.append(nameBtn);
    main.append(mini, title);
    head.append(main, menuButton(f));
    const body = el('div', 'sdk-card-body vt-stack');
    const line = el('p', 'vt-card-line', `${size(f.size)} · ${byWord(f)} · ${when(f.at)}`);
    body.append(thumb(f), line, badges(f));
    c.append(head, body);
    return c;
  }
  function emptyEl() {
    const e = el('div', 'sdk-empty vt-empty-in');
    if (!state.files.length) {
      e.append(ic('folder-open'), el('p', 'sdk-empty-title', `Nothing in ${MODULE} yet.`), el('p', 'sdk-empty-text', mayAdd ? `Add pictures, audio, video and documents for this ${SPACE}.` : `Nothing has been added to this ${SPACE}'s ${MODULE} yet.`));
      if (mayAdd && !state.adding) { const b = button('btn btn-primary', { label: 'Add files', icon: 'plus' }); b.addEventListener('click', () => { state.adding = true; render(); setTimeout(() => $('choose').focus(), 0); }); e.append(b); }
    } else {
      e.append(ic('magnifying-glass'), el('p', 'sdk-empty-title', 'No files match.'));
      const b = button('btn', { label: 'Clear filters', icon: 'xmark' });
      b.addEventListener('click', () => { clearFilters(); refilter(); });
      e.append(b);
    }
    return e;
  }

  // ---- the page ----------------------------------------------------------------------------------------------------------------------
  // The nearest ancestor that scrolls (in the page the module sits in a shadow root, so the walk crosses it).
  function scrollerOf(node) {
    for (let e = node.parentElement || (node.getRootNode() && node.getRootNode().host); e; e = e.parentElement || (e.getRootNode() && e.getRootNode().host)) {
      const o = getComputedStyle(e).overflowY;
      if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight) return e;
    }
    return null;
  }
  let renderedNarrow = false;
  // Only the first files are drawn; the rest are added as the person scrolls to the end (or presses Show more), so a long list opens at once.
  let paged = null; // { list, box, make, more }
  const moreSeen = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) showMore(); }, { rootMargin: '400px' }) : null;
  function showMore() {
    if (!paged) return;
    const from = paged.box.children.length;
    const next = paged.list.slice(from, from + PAGE);
    if (!next.length) return;
    if (paged.more) moreSeen && moreSeen.unobserve(paged.more);
    const page = document.createDocumentFragment();
    for (const f of next) page.append(paged.make(f));
    paged.box.append(page);
    state.limit = paged.box.children.length;
    fitCuts(paged.box);
    drawMore();
  }
  function drawMore() {
    if (!paged) return;
    const left = paged.list.length - paged.box.children.length;
    if (paged.more) { moreSeen && moreSeen.unobserve(paged.more); paged.more.remove(); paged.more = null; }
    if (left <= 0) return;
    const wrap = el('div', 'vt-more');
    const b = button('btn', { label: `Show ${Math.min(PAGE, left)} more (${left} left)` });
    b.addEventListener('click', showMore);
    wrap.append(b);
    $('body').append(wrap);
    paged.more = wrap;
    if (moreSeen) moreSeen.observe(wrap);
  }
  function renderBody() {
    renderedNarrow = narrow();
    const body = $('body');
    const scroller = scrollerOf($('app'));
    const scrollTop = scroller ? scroller.scrollTop : 0;
    if (paged && paged.more && moreSeen) moreSeen.unobserve(paged.more);
    paged = null;
    body.replaceChildren();
    body.dataset.view = state.view;
    const list = filtered();
    const shown = list.slice(0, Math.max(PAGE, state.limit));
    if (!list.length) body.append(emptyEl());
    else if (state.view === 'list') {
      const ul = el('ul', 'sdk-card-list vt-rows');
      ul.setAttribute('aria-label', 'Files');
      const frag = document.createDocumentFragment();
      for (const f of shown) frag.append(rowEl(f));
      ul.append(frag);
      body.append(ul);
      paged = { list, box: ul, make: rowEl, more: null };
    } else {
      const g = el('div', 'vt-grid');
      g.setAttribute('role', 'list');
      const make = (f) => { const c = cardEl(f); c.setAttribute('role', 'listitem'); return c; };
      const frag = document.createDocumentFragment();
      for (const f of shown) frag.append(make(f));
      g.append(frag);
      body.append(g);
      paged = { list, box: g, make, more: null };
    }
    body.hidden = false;
    $('loading').hidden = true;
    drawMore();
    if (scroller) scroller.scrollTop = scrollTop;
    fitCuts();
  }
  function renderBanner() {
    const b = $('banner');
    let note = state.notice;
    if (!note && !state.adding && capBytes()) {
      if (isFull()) note = { kind: 'danger', text: fullSentence() };
      else if (usedBytes() / capBytes() >= 0.8) note = { kind: 'warn', text: `Almost full. Remove some files to add more: ${size(usedBytes())} of ${size(capBytes())} of this ${SPACE}'s ${MODULE} used.` };
    }
    b.hidden = !note;
    if (!note) return;
    b.dataset.kind = note.kind;
    $('banner-icon').replaceChildren(ic(note.kind === 'ok' ? 'check' : 'triangle-exclamation'));
    $('banner-text').textContent = note.text;
  }
  // Where the keyboard is in the list (a name, a tick or a More button, by file), so a redraw puts it back.
  function focusKey() {
    const a = root.activeElement;
    if (!a || !$('body').contains(a)) return null;
    const item = a.closest('[data-id]');
    if (!item) return null;
    const kind = a.matches('.vt-tick input') ? '.vt-tick input' : a.matches('.menu-btn') ? '.menu-btn' : a.matches('.sdk-open') ? '.sdk-open' : null;
    return kind ? { id: item.dataset.id, kind } : null;
  }
  function putFocusBack(k) {
    if (!k) return;
    const item = itemEl(k.id);
    const target = item && item.querySelector(k.kind);
    if (target) { try { target.focus({ preventScroll: true }); } catch { /* not focusable */ } }
  }
  function render() {
    const kept = focusKey();
    renderBody();
    renderBanner();
    renderAdd();
    chrome();
    putFocusBack(kept);
  }

  // ---- Add files -----------------------------------------------------------------------------------------------------------------------
  function renderAdd() {
    const p = $('add');
    p.hidden = !(state.adding && mayAdd);
    if (p.hidden) return;
    const full = isFull();
    const drop = $('drop');
    drop.classList.toggle('is-off', full);
    drop.classList.toggle('is-compact', state.queue.length > 0);
    drop.classList.toggle('is-over', state.dropping === true);
    $('choose').disabled = full;
    $('drop-title').textContent = full ? `This ${SPACE}'s ${MODULE} is full` : state.dropping ? 'Drop to add them' : 'Drop files here';
    $('drop-sub').textContent = full ? 'Remove some files to add more.' : 'or';
    $('add-title').textContent = `Add files`;
    $('add-line').textContent = `Everyone in this ${SPACE} can see what you add.`;
    $('remove-where').checked = state.removeWhere;
    $('quota-label').textContent = `Used in this ${SPACE}`;
    const u = usedBytes(); const cap = capBytes();
    $('quota-value').textContent = cap ? `${size(u)} of ${size(cap)}` : size(u);
    const pct = cap ? Math.min(100, (u / cap) * 100) : 0;
    $('quota-bar').setAttribute('aria-valuenow', String(Math.round(pct)));
    $('quota-bar').setAttribute('aria-label', `Used in this ${SPACE}`);
    $('quota-bar').classList.toggle('warn', pct >= 90);
    $('quota-fill').style.setProperty('--pct', `${pct}%`);
    const q = $('queue');
    q.hidden = !state.queue.length;
    const keptAt = q.contains(root.activeElement) ? [...q.children].findIndex((r) => r.contains(root.activeElement)) : -1;
    q.replaceChildren(...state.queue.map(uploadRow));
    if (keptAt >= 0 && q.children.length) { const b = q.children[Math.min(keptAt, q.children.length - 1)].querySelector('button:last-of-type'); if (b) b.focus(); }
  }
  function uploadRow(it) {
    const li = el('li', 'sdk-row vt-up');
    li.dataset.status = it.status;
    const k = KINDS[it.kind] || KINDS.text;
    const lead = el('span', 'sdk-card-icon vt-kind');
    lead.dataset.tint = it.status === 'refused' ? 'red' : it.status === 'done' ? 'green' : k.tint;
    lead.append(ic(it.status === 'refused' ? 'triangle-exclamation' : it.status === 'done' ? 'check' : k.icon));
    const main = el('span', 'sdk-row-main');
    main.append(el('span', 'vt-up-name', it.name));
    const line = el('span', `vt-up-line${it.status === 'refused' ? ' vt-up-bad' : ''}`);
    line.textContent = it.status === 'uploading' ? `Adding · ${Math.round(it.pct)}% · ${size((it.size * it.pct) / 100)} of ${size(it.size)}` : it.status === 'queued' ? (it.waiting ? 'Waiting a moment' : 'Waiting') : it.status === 'done' ? `Added · ${size(it.size)}` : it.msg;
    main.append(line);
    if (it.status === 'uploading') {
      const bar = el('div', 'sdk-progress sdk-progress-sm');
      bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', `Adding ${it.name}`); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(Math.round(it.pct)));
      const fill = el('span', 'sdk-progress-fill'); fill.style.setProperty('--pct', `${it.pct}%`);
      bar.append(fill);
      main.append(bar);
    }
    li.append(lead, main);
    if (it.status === 'refused' && it.retry && it.file) {
      const again = button('btn btn-small', { label: 'Try again', aria: `Try adding ${it.name} again` });
      again.addEventListener('click', () => { it.status = 'queued'; it.waiting = false; it.tries = 0; it.retry = false; it.msg = ''; renderAdd(); pump(); });
      li.append(again);
    }
    const end = button('sdk-icon-btn btn-quiet btn-small', { icon: 'xmark', aria: it.status === 'uploading' || it.status === 'queued' ? `Stop adding ${it.name}` : `Clear ${it.name} from the list`, tip: it.status === 'uploading' || it.status === 'queued' ? 'Stop adding' : 'Clear' });
    end.addEventListener('click', () => {
      if (it.status === 'uploading' && it.job) { it.job.cancel(); stoppedAt(it); }
      if (it.status === 'queued') it.status = 'stopped';
      state.queue = state.queue.filter((x) => x !== it);
      renderAdd();
      if (!state.queue.length && !running) { const c = $('choose'); if (c && !c.disabled) c.focus(); }
    });
    li.append(end);
    return li;
  }
  const pending = () => state.queue.filter((x) => x.status === 'queued');
  let running = 0;
  const maxRunning = 2; // the server takes two at once from one person
  // The host lets one person add 30 files a minute. A file it turns away waits, and the rest wait with it, then they go again.
  let holding = false;
  let holdTimer = 0;
  function hold(ms) {
    holding = true;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { holding = false; pump(); }, ms);
  }
  const MAX_TRIES = 8;
  // How long the server asked to wait (Retry-After, in seconds); the old fixed wait only when it said nothing.
  const waitMs = (err, fallback) => (err && err.retryAfter > 0 ? Math.min(err.retryAfter, 120) * 1000 : fallback);
  function startFiles(files) {
    state.notice = null;
    for (const f of files) {
      const kind = (() => { const e = (f.name.split('.').pop() || '').toLowerCase(); return ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(e) ? 'picture' : ['mp3', 'ogg', 'oga', 'wav', 'm4a'].includes(e) ? 'audio' : ['mp4', 'webm', 'mov'].includes(e) ? 'video' : e === 'pdf' ? 'pdf' : 'text'; })();
      state.queue.push({ file: f, name: f.name, size: f.size || 1, kind, status: 'queued', pct: 0, msg: '', tries: 0, waiting: false, retry: false });
    }
    state.adding = true;
    render();
    pump();
  }
  function pump() {
    if (holding) return;
    while (running < maxRunning) {
      const it = pending()[0];
      if (!it) { if (!running) finished(); return; }
      running += 1;
      send(it).finally(() => { running -= 1; pump(); });
    }
  }
  // When every file of a batch has gone in, Add files says so and closes itself; one that was refused keeps it open to read.
  let closeTimer = 0;
  function finished() {
    if (!state.queue.length || !state.queue.every((x) => x.status === 'done')) return;
    const n = state.queue.length;
    host.ui.toast(n === 1 ? `${state.queue[0].name} added` : `${n} files added`);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (running || pending().length || !state.queue.every((x) => x.status === 'done')) return;
      state.queue = [];
      if ($('add').contains(root.activeElement)) closeAdd(); else { state.adding = false; render(); }
    }, 1200);
  }
  // A video's small picture goes up after the file; when the host says too often, it is tried again a little later.
  async function sendThumb(rec, blob, tries = 0) {
    try {
      const updated = await host.library.thumb(rec.id, blob);
      const mine = state.files.find((x) => x.id === rec.id);
      if (mine && updated) { mine.hasThumb = true; thumbs.set(rec.id, URL.createObjectURL(blob)); lastSig = ''; render(); }
    } catch (err) {
      if (err && err.status === 429 && tries < 3) setTimeout(() => sendThumb(rec, blob, tries + 1), waitMs(err, 15000));
    }
  }
  // Stopped while the last bytes were going: the file may have been kept. Look again, and say so.
  function stoppedAt() {
    const before = state.files.length;
    setTimeout(async () => {
      await refresh({ quiet: true });
      if (state.files.length > before) host.ui.toast('Added before it could stop.');
    }, 1500);
  }
  async function send(it) {
    it.status = 'uploading';
    it.waiting = false;
    renderAdd();
    try {
      it.job = host.library.add(it.file, { name: it.name, keepPosition: !state.removeWhere, onProgress: ({ loaded, total }) => { it.pct = total ? Math.min(99, (loaded / total) * 100) : 0; paintProgress(it); } });
      const rec = await it.job;
      it.status = 'done'; it.pct = 100;
      const named = state.files.some((x) => x.id === rec.id);
      if (!named) state.files.unshift(rec);
      state.usage = { ...state.usage, bytes: usedBytes() + (rec.size || 0) };
      lastSig = '';
      render();
      if (!state.queue.includes(it)) host.ui.toast('Added before it could stop.');
      if ((rec.group === 'image' || rec.group === 'video') && it.file) {
        makeThumb(it.file, kindOf(rec), rec.id).then((made) => {
          if (!made) return;
          if (made.duration) saveDuration(rec.id, made.duration).then(() => { lastSig = ''; render(); });
          return sendThumb(rec, made.blob);
        }).catch(() => {});
      }
    } catch (err) {
      if (!state.queue.includes(it)) return; // stopped by the person
      if (err && err.status === 429 && it.tries < MAX_TRIES) {
        it.tries += 1;
        it.status = 'queued'; it.waiting = true; it.pct = 0;
        hold(waitMs(err, it.tries < 3 ? 8000 : 15000));
        renderAdd();
        return;
      }
      it.status = 'refused';
      it.retry = !err || !err.status || err.status === 429 || err.status >= 500;
      it.msg = (err && err.message) || 'That file could not be added.'; // the server's own sentence, also for a 429
      if (err && err.status === 413 && /full|used your/i.test(it.msg)) refresh({ quiet: true });
      renderAdd();
    } finally {
      if (it.status === 'done' || (it.status === 'refused' && !it.retry)) it.file = null;
      it.job = null;
      announce(it.status === 'done' ? `${it.name} added` : it.status === 'refused' ? `${it.name} was not added. ${it.msg}` : '');
    }
  }
  function paintProgress(it) {
    // Only the row's own numbers change while a file is being sent, so the rest of the page is not drawn again.
    const rows = $('queue').children;
    const i = state.queue.indexOf(it);
    if (i < 0 || !rows[i]) return;
    const again = uploadRow(it);
    const had = rows[i].contains(root.activeElement);
    rows[i].replaceWith(again);
    if (had) { const b = again.querySelector('button'); if (b) b.focus(); }
  }
  function announce(text) { if (text) $('live').textContent = text; }

  $('choose').addEventListener('click', () => $('picker').click());
  $('picker').addEventListener('change', () => { const files = [...$('picker').files]; $('picker').value = ''; if (files.length) startFiles(files); });
  // Closing Add files puts the keyboard back on the "+" that opened it (the host's), never the page.
  function closeAdd() {
    state.adding = false; render();
    const back = host.add && typeof host.add.focus === 'function' ? host.add.focus() : Promise.resolve(false);
    back.then((ok) => { if (!ok) { const b = $('body'); b.tabIndex = -1; b.focus({ preventScroll: true }); } }, () => {});
  }
  $('add-close').addEventListener('click', closeAdd);
  $('add').addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); closeAdd(); } });
  $('remove-where').addEventListener('change', () => { state.removeWhere = $('remove-where').checked; savePrefs(); });
  // Dropping files on the module adds them.
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  root.addEventListener('dragenter', (e) => { if (!mayAdd || !hasFiles(e)) return; depth += 1; showDropOver(true); });
  root.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) showDropOver(false); });
  root.addEventListener('dragover', (e) => { if (mayAdd && hasFiles(e)) e.preventDefault(); });
  root.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0; showDropOver(false);
    if (mayAdd && e.dataTransfer.files.length) startFiles([...e.dataTransfer.files]);
  });
  function showDropOver(on) {
    state.dropping = on;
    $('dropover').hidden = !on || state.adding;
    $('dropover-title').textContent = `Drop to add to the ${MODULE}`;
    $('dropover-sub').textContent = `Everyone in this ${SPACE} can see what you add.`;
    if (state.adding) renderAdd();
  }

  // ---- Rename ----------------------------------------------------------------------------------------------------------------------------
  let renaming = null;
  const renameEditor = host.ui.editor($('rename'), { size: 'small', isDirty: () => renaming && $('rename-name').value !== renaming.name, onClose: () => { renaming = null; } });
  function renameFile(f) {
    renaming = f;
    const ext = f.name.includes('.') ? `.${f.name.split('.').pop()}` : '';
    $('rename-name').value = f.name;
    $('rename-name').removeAttribute('aria-invalid');
    $('rename-hint').className = 'sdk-hint';
    $('rename-hint').textContent = `Keep ${ext} at the end. A name can be 120 characters.`;
    renameEditor.open({ focus: $('rename-name'), returnTo: () => root.querySelector(`[data-menu="${f.id}"]`) });
    $('rename-name').select();
  }
  $('rename-cancel').addEventListener('click', () => renameEditor.cancel());
  $('rename-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = renaming;
    if (!f) return;
    const name = $('rename-name').value.trim().replace(/[\\/\u0000-\u001f]/g, '').slice(0, 120);
    if (!name) { $('rename-name').setAttribute('aria-invalid', 'true'); $('rename-hint').className = 'sdk-error'; $('rename-hint').textContent = 'Give the file a name.'; return; }
    try {
      const updated = await host.library.rename(f.id, name);
      const mine = state.files.find((x) => x.id === f.id);
      if (mine && updated) Object.assign(mine, updated);
      renameEditor.close();
      lastSig = '';
      render();
      host.ui.toast(`Renamed to ${updated ? updated.name : name}`);
    } catch (err) {
      $('rename-name').setAttribute('aria-invalid', 'true');
      $('rename-hint').className = 'sdk-error';
      $('rename-hint').textContent = err.message;
    }
  });

  // ---- Remove, with where each file is used -------------------------------------------------------------------------------------------
  async function removeFiles(files, done) {
    if (!files.length) return;
    const found = await Promise.all(files.map((f) => (f.uses ? host.library.uses(f.id).catch(() => null) : Promise.resolve({ uses: [], hidden: 0 }))));
    const lines = [];
    const used = files.map((f, i) => ({ f, u: found[i] })).filter((x) => x.u && (x.u.uses.length || x.u.hidden));
    const unknown = files.some((f, i) => f.uses && !found[i]);
    if (files.length === 1 && used.length === 1) {
      const u = used[0].u;
      const list = u.uses.map((x) => `${x.title}${x.moduleName ? ` (${x.moduleName})` : ''}`).join(', ');
      lines.push(`Used in ${u.uses.length + u.hidden}: ${list}${u.hidden ? `${list ? ', and ' : ''}${u.hidden} you can't see` : ''}. The links will show File removed.`);
    } else if (used.length) {
      const total = used.reduce((a, x) => a + x.u.uses.length + x.u.hidden, 0);
      lines.push(`${plural(used.length, 'of them is', 'of them are')} used in other tools, ${plural(total, 'link')} in all. The links will show File removed.`);
    } else if (unknown) {
      lines.push('Some of them are linked from other tools. The links will show File removed.');
    }
    lines.push(files.length === 1 ? `It is removed from the ${MODULE} for everyone in this ${SPACE}, and from any share link it is in. A link left with no file ends. This can't be undone.` : `They are removed from the ${MODULE} for everyone in this ${SPACE}, and from any share link they are in. A link left with no file ends. This can't be undone.`);
    const ok = await host.ui.confirm({ title: files.length === 1 ? `Remove "${files[0].name.length > 60 ? `${files[0].name.slice(0, 59)}…` : files[0].name}"?` : `Remove ${files.length} files?`, message: lines.join('\n\n'), action: 'Remove', kind: 'destructive' });
    if (!ok) return;
    const order = filtered().map((x) => x.id);
    const gonePos = Math.min(...files.map((x) => order.indexOf(x.id)).filter((i) => i >= 0), order.length);
    const leaving = new Set(files.map((x) => x.id));
    let gone = 0;
    let failure = null;
    for (const f of files) {
      try {
        await host.library.remove(f.id);
        gone += 1;
        state.files = state.files.filter((x) => x.id !== f.id);
        state.sel.delete(f.id);
        state.usage = { ...state.usage, bytes: Math.max(0, usedBytes() - f.size) };
      } catch (err) {
        if (err.status === 404) { state.files = state.files.filter((x) => x.id !== f.id); gone += 1; } else failure = err;
      }
    }
    if (done) done();
    lastSig = '';
    render();
    refresh({ quiet: true });
    if (gone) host.ui.toast(gone === 1 ? 'File removed' : `${gone} files removed`);
    if (failure) fail(failure);
    // The menu or the card that held focus is gone: it goes to the neighbouring file, else the list, never the page.
    const settle = () => {
      const a = root.activeElement;
      if (a && a !== document.body && a.isConnected && $('body').contains(a)) return;
      const next = order.slice(gonePos + 1).find((id) => !leaving.has(id) && itemEl(id)) || order.slice(0, gonePos).reverse().find((id) => !leaving.has(id) && itemEl(id));
      const to = next ? itemEl(next).querySelector('.sdk-open') : $('body').querySelector('.sdk-empty button');
      if (to) to.focus({ preventScroll: true });
      else { $('body').tabIndex = -1; $('body').focus({ preventScroll: true }); }
    };
    setTimeout(settle, 0);
    setTimeout(settle, 120);
  }

  // ---- Download ---------------------------------------------------------------------------------------------------------------------
  async function downloadMany(files) {
    if (!files.length) return;
    host.ui.toast(files.length === 1 ? `Downloading ${files[0].name}` : `Downloading ${plural(files.length, 'file')}, one at a time as the browser allows.`);
    for (const f of files) {
      try { await host.library.download(f.id); } catch (err) { fail(err); return; }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // ---- Opening a file: the seam for the viewers (step 3) --------------------------------------------------------------------------------
  // A file opens in a file window over the page (the host's own, public/file-viewer.js; host.files.open). Previous and Next walk the list
  // as it is filtered now. When the window closes, focus goes back to what opened it. Only if the host can't open one is the file's details
  // sheet shown, so every file still goes somewhere.
  // Each window remembers what opened it, by file id, so Esc on one returns to its own row. When that element is gone (the list drew again)
  // or the window was closed with Close all, focus goes to the file's row, else the first row, never the page.
  const openers = new Map();
  const rowFocus = (id) => {
    const item = itemEl(id) || $('body').querySelector('[data-id]');
    return item ? item.querySelector('.sdk-open') || item.querySelector('button, input') : null;
  };
  host.on('fileclosed', (e) => {
    const id = e && e.id;
    const at = openers.get(id);
    openers.delete(id);
    const to = at && at.isConnected ? at : rowFocus(id);
    if (to) to.focus({ preventScroll: true });
  });
  function openFile(file, via = 'open') {
    if (host.files && typeof host.files.open === 'function') {
      const at = root.activeElement || (document.activeElement !== document.body ? document.activeElement : null);
      openers.set(file.id, at);
      return host.files.open(host.objects.make('file', file.id), { list: filtered().map((f) => f.id), name: file.name }).then((opened) => {
        // Refused at the cap: nothing opened, so nothing will close; focus stays where it was.
        if (opened === false) openers.delete(file.id);
        return opened;
      }, () => { openers.delete(file.id); return showFile(file, { opener: via }); });
    }
    return showFile(file, { opener: via });
  }
  let showing = null;
  const detailsEditor = host.ui.editor($('details'), { size: 'small', onClose: () => { showing = null; } });
  async function showFile(f, { uses = false, opener = 'menu' } = {}) {
    showing = f;
    const k = KINDS[kindOf(f)];
    $('details-title').textContent = f.name;
    const facts = [['Type', k.word], ['Size', size(f.size)], ['Added by', byWord(f)], ['Added', when(f.at, true)]];
    if (f.taken) facts.push(['Taken', when(f.taken, true)]);
    facts.push(['Used in', f.uses ? plural(f.uses, 'place') : 'Nowhere yet']);
    $('facts').replaceChildren(...facts.flatMap(([a, b]) => [el('dt', '', a), el('dd', '', b)]));
    $('details-note').textContent = mayDownload ? '' : 'Your role can look at this file here but not download it.';
    $('details-note').hidden = mayDownload;
    const dl = $('details-download');
    dl.hidden = !mayDownload;
    dl.onclick = () => host.library.download(f.id).catch(fail);
    const box = $('uses');
    box.hidden = true;
    box.replaceChildren();
    // Escape goes back to what opened it: the name, or the More button.
    detailsEditor.open({ focus: mayDownload ? dl : $('details-close'), returnTo: () => { const item = itemEl(f.id); return item && item.querySelector(opener === 'open' ? '.sdk-open' : '.menu-btn'); } });
    if (!uses && !f.uses) return;
    try {
      const res = await host.library.uses(f.id);
      if (showing !== f) return;
      box.hidden = false;
      const head = el('h4', 'vt-uses-head', 'Where it is used');
      if (!res.uses.length && !res.hidden) { box.replaceChildren(head, el('p', 'vt-fine', `Nothing in this ${SPACE} links to this file yet. Link it from a booking or a note in another tool.`)); return; }
      const ul = el('ul', 'vt-uses-list');
      for (const x of res.uses) ul.append(el('li', '', `${x.title}${x.moduleName ? ` (${x.moduleName})` : ''}`));
      box.replaceChildren(head, ul);
      if (res.hidden) box.append(el('p', 'vt-fine', `and ${plural(res.hidden, 'more link')} you can't see.`));
      box.append(el('p', 'vt-fine', 'Remove the file and these links read File removed.'));
    } catch { /* the facts stay */ }
  }
  $('details-close').addEventListener('click', () => detailsEditor.close());

  // ---- go -----------------------------------------------------------------------------------------------------------------------------------
  try { new ResizeObserver(() => { if (!state.loaded) return; if (narrow() !== renderedNarrow && state.view === 'grid') renderBody(); else fitCuts(); }).observe($('app')); } catch { /* no observer */ }
  hydrate(root);
  await loadPeople();
  await refresh();
  // Other people's changes arrive at once by the server's 'library' event (a file added, renamed, removed or given a thumbnail), and by
  // asking again now and then as a fallback (and when this page comes back into view), in case an event was missed.
  host.on('library', () => { if ($('app') && !running && !renaming) refresh({ quiet: true }); });
  const poll = setInterval(() => {
    if (!$('app')) return void clearInterval(poll);
    if (document.visibilityState === 'visible' && !running && !renaming) refresh({ quiet: true });
  }, 15000);
  document.addEventListener('visibilitychange', () => { if ($('app') && document.visibilityState === 'visible') refresh({ quiet: true }); });
})();
