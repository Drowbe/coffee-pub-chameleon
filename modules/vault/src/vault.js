// The Vault module (documentation/plans/plan-attachments-vault.md, step 2): the files of a space, as a List or a Grid, with search,
// Filters, Add files with progress, Rename, Remove (with where each file is used), Select for several, the status line and the
// empty and full states. The files and the rules about them are the server's (the library routes, reached through host.library);
// this page only draws them. It draws into the markup in vault.html and builds its rows and cards from the design system's pieces
// (the Cards block: banded card and row), with its own classes only where the Vault needs them (vault.css).
//
// Opening a file is one seam: openFile(file). The viewer windows are step 3; until they exist it shows the file's details with
// Download, so nothing is a dead end.
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
  const SORTS = [
    ['new', 'Newest first', (a, b) => (b.at > a.at ? 1 : -1)],
    ['old', 'Oldest first', (a, b) => (a.at > b.at ? 1 : -1)],
    ['name', 'Name, A to Z', (a, b) => a.name.localeCompare(b.name)],
    ['big', 'Largest first', (a, b) => b.size - a.size],
    ['kind', 'Type', (a, b) => kindOf(a).localeCompare(kindOf(b)) || a.name.localeCompare(b.name)],
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
  const me = (info.user && info.user.key) || '';
  const can = (key) => host.can(key);
  if (!inSpace || !can('view')) {
    showMsg(inSpace ? `You can't see the files in this ${SPACE}.` : `Open the ${MODULE} inside ${word('space', { a: true })}.`, inSpace ? 'Ask an owner or a moderator if you need them.' : '', { icon: 'lock' });
    return;
  }
  const mayAdd = can('add');
  const mayDownload = can('download');
  const mayRemoveAny = can('remove_any');
  const mayRemove = (f) => mayRemoveAny || f.by === me;

  const state = {
    files: [], usage: { bytes: 0, maxBytes: 0 },
    view: 'list', sort: 'new', query: '', types: new Set(), by: 'all', linked: new Set(),
    selecting: false, sel: new Set(), panel: false, queue: [], loaded: false,
    people: new Map(), removeWhere: false, notice: null, dropping: false,
  };

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
    if (state.query.trim()) parts.push(`matching "${state.query.trim()}"`);
    return parts.join(', ');
  }
  function clearFilters() {
    state.types.clear(); state.by = 'all'; state.linked.clear(); state.query = ''; state.sort = 'new';
  }

  // ---- loading ------------------------------------------------------------------------------------------------------------------------
  let lastSig = '';
  const signature = () => JSON.stringify([state.files.map((f) => [f.id, f.name, f.size, f.hasThumb, f.uses]), state.usage]);
  async function loadPeople() {
    try { for (const p of await host.people()) state.people.set(p.key, p.name); } catch { /* names are a nicety */ }
  }
  async function refresh({ quiet = false } = {}) {
    try {
      const res = await host.library.list();
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
      if (err.status === 403 || err.status === 404) showMsg(`You can't see the files in this ${SPACE}.`, 'Ask an owner or a moderator if you need them.', { icon: 'lock' });
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
  async function makeThumb(file, kind, id) {
    const MAX = 400;
    let source;
    let release = () => {};
    if (kind === 'picture') {
      try {
        source = await createImageBitmap(file, { imageOrientation: 'from-image' });
        release = () => source.close();
      } catch {
        return null;
      }
    } else {
      // The bytes the person chose (a blob address), or, where the page's policy refuses those for media, the file as the server now has it.
      const sources = [URL.createObjectURL(file)];
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'auto';
      video.playsInline = true;
      release = () => { video.removeAttribute('src'); video.load(); for (const u of sources) if (u.startsWith('blob:')) URL.revokeObjectURL(u); };
      const tryOne = (src, ms) => new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('slow')), ms);
        video.onerror = () => { clearTimeout(t); reject(new Error('bad')); };
        video.onloadeddata = () => {
          const at = Math.min(1, (video.duration || 2) / 10);
          video.onseeked = () => { clearTimeout(t); resolve(); };
          video.currentTime = at;
        };
        video.src = src;
      });
      try {
        try {
          await tryOne(sources[0], 2500);
        } catch (first) {
          if (!id) throw first;
          const addr = await host.library.url(id);
          sources.push(addr);
          await tryOne(addr, 10000);
        }
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
      if (blob && blob.size <= 300 * 1024) return blob;
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
  const viewSwitch = host.ui.viewSwitch({ id: 'view', options: VIEW_OPTIONS, value: state.view, onChange: (v) => { state.view = v === 'grid' ? 'grid' : 'list'; render(); } });
  function chosen() { return state.files.filter((f) => state.sel.has(f.id)); }
  function filtersChips() {
    const all = state.files;
    const count = (fn) => all.filter(fn).length;
    const others = [...new Set(all.map((f) => f.by))].filter((k) => k !== me).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    return [
      { type: 'chips', id: 'sort', label: 'Sort by', single: true, value: state.sort, options: SORTS.map(([id, label]) => ({ id, label })) },
      { type: 'chips', id: 'type', label: 'Type', options: ['image', 'audio', 'video', 'document'].map((g) => ({ id: g, label: GROUP_WORD[g], count: count((f) => f.group === g), on: state.types.has(g), default: false })) },
      { type: 'chips', id: 'by', label: 'Added by', single: true, value: state.by, options: [{ id: 'all', label: 'Everyone' }, { id: 'mine', label: 'Mine' }, ...others.map((k) => ({ id: k, label: nameOf(k) }))] },
      { type: 'chips', id: 'linked', label: 'Linked', options: [{ id: 'linked', label: 'Linked', count: count((f) => f.uses > 0), on: state.linked.has('linked'), default: false }, { id: 'unlinked', label: 'Not linked', on: state.linked.has('unlinked'), default: false }] },
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
        { type: 'button', id: 'all', label: n === filtered().length && n ? 'Choose none' : 'Choose all', icon: 'square-check', overflow: true },
        ...(mayDownload ? [{ type: 'button', id: 'sel-download', label: 'Download', icon: 'download', disabled: !n, overflow: true }] : []),
        { type: 'button', id: 'sel-remove', label: 'Remove', icon: 'trash', disabled: !removable, title: n && !removable ? 'Remove is only for files you added' : 'Remove', overflow: true },
        search,
        ...filtersChips(),
      ];
    }
    return [search, ...filtersChips()];
  }
  function statusItems() {
    const total = state.files.length;
    const shown = filtered().length;
    const f = filterWords();
    const words = `${f ? `${shown} of ${plural(total, 'file')}` : plural(total, 'file')} · ${size(usedBytes())}${capBytes() ? ` of ${size(capBytes())}` : ''}`;
    const items = [{ text: words, icon: 'vault' }];
    if (f) items.push({ text: f.length > 56 ? `${f.slice(0, 55)}…` : f, title: f });
    if (isFull()) items.push({ text: 'Full', icon: 'triangle-exclamation', title: fullSentence() });
    else if (capBytes() && usedBytes() / capBytes() >= 0.8) items.push({ text: 'Almost full', icon: 'triangle-exclamation' });
    if (state.selecting && state.sel.size && !chosen().every(mayRemove)) items.push({ text: 'Remove is only for files you added', icon: 'circle-info' });
    return items;
  }
  function chrome() {
    viewSwitch.set(state.view);
    host.toolbar.set(toolbarItems()).catch(() => {});
    host.header.set(state.files.length && (mayDownload || state.files.some(mayRemove)) ? [{ id: 'select', icon: 'square-check', title: 'Select', on: state.selecting }] : []).catch(() => {});
    host.add.set(mayAdd ? [{ id: 'add', label: 'Add files', icon: 'plus' }] : []).catch(() => {});
    host.status.set(statusItems()).catch(() => {});
  }

  host.on('toolbar', (e) => {
    const id = e.id;
    if (id === 'find') { if (typeof e.value === 'string' && e.value !== state.query) { state.query = e.value; render(); } }
    else if (id === 'sort' && typeof e.value === 'string') { state.sort = SORTS.some((s) => s[0] === e.value) ? e.value : 'new'; render(); }
    else if (id === 'type' && typeof e.value === 'string') { if (e.on) state.types.add(e.value); else state.types.delete(e.value); render(); }
    else if (id === 'by' && typeof e.value === 'string') { state.by = e.value; render(); }
    else if (id === 'linked' && typeof e.value === 'string') { if (e.on) state.linked.add(e.value); else state.linked.delete(e.value); render(); }
    else if (id === 'done') endSelecting();
    else if (id === 'all') { const ids = filtered().map((f) => f.id); if (state.sel.size === ids.length) state.sel.clear(); else ids.forEach((i) => state.sel.add(i)); render(); }
    else if (id === 'sel-download') downloadMany(chosen());
    else if (id === 'sel-remove') removeFiles(chosen(), endSelecting);
  });
  host.on('header', (e) => { if (e.id === 'select') { if (state.selecting) endSelecting(); else { state.selecting = true; state.sel.clear(); render(); } } });
  host.on('add', (e) => { if (e.id === 'add' && mayAdd) { state.panel = true; render(); setTimeout(() => $('choose').focus(), 0); } });
  host.on('links', () => { refresh({ quiet: true }); });
  function endSelecting() { state.selecting = false; state.sel.clear(); render(); }

  // ---- the menus ----------------------------------------------------------------------------------------------------------------------
  function fileMenu(f) {
    const items = [{ id: 'open', label: 'Open', icon: 'eye', onClick: () => openFile(f) }];
    if (mayDownload) items.push({ id: 'download', label: 'Download', icon: 'download', onClick: () => host.library.download(f.id).catch(fail) });
    if (mayRemove(f)) items.push({ id: 'rename', label: 'Rename', icon: 'pen-to-square', onClick: () => renameFile(f) });
    items.push({ id: 'uses', label: 'Where it is used', icon: 'link', hint: f.uses ? String(f.uses) : undefined, onClick: () => showFile(f, { uses: true }) });
    if (mayRemove(f)) items.push({ separator: true }, { id: 'remove', label: 'Remove', icon: 'trash', danger: true, onClick: () => removeFiles([f]) });
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
  function tick(f) {
    const lab = el('label', 'sdk-row-tick vt-tick');
    const cb = el('input');
    cb.type = 'checkbox'; cb.checked = state.sel.has(f.id); cb.setAttribute('aria-label', `Choose ${f.name}`);
    cb.addEventListener('change', () => { if (cb.checked) state.sel.add(f.id); else state.sel.delete(f.id); render(); });
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
  function fitCuts() {
    const app = $('body');
    if (!app.clientWidth) return;
    for (const b of app.querySelectorAll('.vt-cut')) {
      const head = b.querySelector('.vt-nm-head'); const tail = b.querySelector('.vt-nm-tail');
      if (!head || !tail) continue;
      const start = head.dataset.start;
      const cs = getComputedStyle(b);
      const left = b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - tail.getBoundingClientRect().width;
      const fits = (s) => { head.replaceChildren(mark(s)); return head.getBoundingClientRect().width <= left; };
      if (fits(start)) continue;
      let lo = 0; let hi = start.length - 1;
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fits(`${start.slice(0, mid)}…`)) lo = mid; else hi = mid - 1; }
      head.replaceChildren(mark(`${start.slice(0, lo)}…`));
    }
  }
  function openButton(f, cls, cut = false) {
    const b = el('button', `sdk-open ${cls}${cut ? ' vt-cut' : ''}`);
    b.type = 'button';
    b.append(cut ? cutName(f.name) : mark(f.name));
    b.title = f.name;
    b.addEventListener('click', () => {
      if (state.selecting) { if (state.sel.has(f.id)) state.sel.delete(f.id); else state.sel.add(f.id); render(); } else openFile(f);
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
      if (f.group === 'video') { const play = el('span', 'vt-play'); play.append(ic('play')); box.append(play); }
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
      if (ticks()) over.append(tick(f));
      over.append(el('span', 'vt-fill'), menuButton(f));
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
      e.append(ic('folder-open'), el('p', 'sdk-empty-title', 'No files yet.'), el('p', 'sdk-empty-text', mayAdd ? `Add tickets, photos and documents for this ${SPACE}.` : `Nothing has been added to this ${SPACE} yet.`));
      if (mayAdd) { const b = button('btn btn-primary', { label: 'Add files', icon: 'plus' }); b.addEventListener('click', () => { state.panel = true; render(); setTimeout(() => $('choose').focus(), 0); }); e.append(b); }
    } else {
      e.append(ic('magnifying-glass'), el('p', 'sdk-empty-title', 'No files match.'));
      const b = button('btn', { label: 'Clear filters', icon: 'xmark' });
      b.addEventListener('click', () => { clearFilters(); render(); });
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
  function renderBody() {
    renderedNarrow = narrow();
    const body = $('body');
    const scroller = scrollerOf($('app'));
    const scrollTop = scroller ? scroller.scrollTop : 0;
    body.replaceChildren();
    body.dataset.view = state.view;
    const list = filtered();
    if (!list.length) body.append(emptyEl());
    else if (state.view === 'list') {
      const ul = el('ul', 'sdk-card-list vt-rows');
      ul.setAttribute('aria-label', 'Files');
      for (const f of list) ul.append(rowEl(f));
      body.append(ul);
    } else {
      const g = el('div', 'vt-grid');
      g.setAttribute('role', 'list');
      for (const f of list) { const c = cardEl(f); c.setAttribute('role', 'listitem'); g.append(c); }
      body.append(g);
    }
    body.hidden = false;
    $('loading').hidden = true;
    if (scroller) scroller.scrollTop = scrollTop;
    fitCuts();
  }
  function renderBanner() {
    const b = $('banner');
    let note = state.notice;
    if (!note && !state.panel && capBytes()) {
      if (isFull()) note = { kind: 'danger', text: fullSentence() };
      else if (usedBytes() / capBytes() >= 0.8) note = { kind: 'warn', text: `Almost full. Remove some files to add more: ${size(usedBytes())} of ${size(capBytes())} used in this ${SPACE}.` };
    }
    b.hidden = !note;
    if (!note) return;
    b.dataset.kind = note.kind;
    $('banner-icon').replaceChildren(ic(note.kind === 'ok' ? 'check' : 'triangle-exclamation'));
    $('banner-text').textContent = note.text;
  }
  function render() {
    renderBody();
    renderBanner();
    renderAdd();
    chrome();
  }

  // ---- Add files -----------------------------------------------------------------------------------------------------------------------
  function renderAdd() {
    const p = $('add');
    p.hidden = !(state.panel && mayAdd);
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
    $('quota-bar').setAttribute('aria-label', `Space used in this ${SPACE}`);
    $('quota-bar').classList.toggle('warn', pct >= 90);
    $('quota-fill').style.setProperty('--pct', `${pct}%`);
    const q = $('queue');
    q.hidden = !state.queue.length;
    q.replaceChildren(...state.queue.map(uploadRow));
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
    line.textContent = it.status === 'uploading' ? `Adding · ${Math.round(it.pct)}% · ${size((it.size * it.pct) / 100)} of ${size(it.size)}` : it.status === 'queued' ? 'Waiting' : it.status === 'done' ? `Added · ${size(it.size)}` : it.msg;
    main.append(line);
    if (it.status === 'uploading') {
      const bar = el('div', 'sdk-progress sdk-progress-sm');
      bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', `Adding ${it.name}`); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(Math.round(it.pct)));
      const fill = el('span', 'sdk-progress-fill'); fill.style.setProperty('--pct', `${it.pct}%`);
      bar.append(fill);
      main.append(bar);
    }
    li.append(lead, main);
    const end = button('sdk-icon-btn btn-quiet btn-small', { icon: 'xmark', aria: it.status === 'uploading' || it.status === 'queued' ? `Stop adding ${it.name}` : `Clear ${it.name} from the list`, tip: it.status === 'uploading' || it.status === 'queued' ? 'Stop adding' : 'Clear' });
    end.addEventListener('click', () => {
      if (it.status === 'uploading' && it.job) it.job.cancel();
      if (it.status === 'queued') it.status = 'stopped';
      state.queue = state.queue.filter((x) => x !== it);
      renderAdd();
    });
    li.append(end);
    return li;
  }
  const pending = () => state.queue.filter((x) => x.status === 'queued');
  let running = 0;
  const maxRunning = 2; // the server takes two at once from one person
  function startFiles(files) {
    state.notice = null;
    for (const f of files) {
      const kind = (() => { const e = (f.name.split('.').pop() || '').toLowerCase(); return ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(e) ? 'picture' : ['mp3', 'ogg', 'oga', 'wav', 'm4a'].includes(e) ? 'audio' : ['mp4', 'webm', 'mov'].includes(e) ? 'video' : e === 'pdf' ? 'pdf' : 'text'; })();
      state.queue.push({ file: f, name: f.name, size: f.size || 1, kind, status: 'queued', pct: 0, msg: '' });
    }
    state.panel = true;
    render();
    pump();
  }
  function pump() {
    while (running < maxRunning) {
      const it = pending()[0];
      if (!it) return;
      running += 1;
      send(it).finally(() => { running -= 1; pump(); });
    }
  }
  async function send(it) {
    it.status = 'uploading';
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
      if ((rec.group === 'image' || rec.group === 'video') && it.file) {
        makeThumb(it.file, kindOf(rec), rec.id).then(async (blob) => {
          if (!blob) return;
          const updated = await host.library.thumb(rec.id, blob);
          const mine = state.files.find((x) => x.id === rec.id);
          if (mine && updated) { mine.hasThumb = true; thumbs.set(rec.id, URL.createObjectURL(blob)); lastSig = ''; render(); }
        }).catch(() => {});
      }
    } catch (err) {
      if (!state.queue.includes(it)) return; // stopped by the person
      it.status = 'refused';
      it.msg = err.message || 'That file could not be added.';
      if (err.status === 413 && /full|used your/i.test(it.msg)) refresh({ quiet: true });
      renderAdd();
    } finally {
      it.file = null;
      it.job = null;
      announce(it.status === 'done' ? `${it.name} added` : it.status === 'refused' ? `${it.name} was not added. ${it.msg}` : '');
    }
  }
  function paintProgress(it) {
    // Only the row's own numbers change while a file is being sent, so the rest of the page is not drawn again.
    const rows = $('queue').children;
    const i = state.queue.indexOf(it);
    if (i < 0 || !rows[i]) return;
    rows[i].replaceWith(uploadRow(it));
  }
  function announce(text) { if (text) $('live').textContent = text; }

  $('choose').addEventListener('click', () => $('picker').click());
  $('picker').addEventListener('change', () => { const files = [...$('picker').files]; $('picker').value = ''; if (files.length) startFiles(files); });
  $('add-close').addEventListener('click', () => { state.panel = false; render(); });
  $('remove-where').addEventListener('change', () => { state.removeWhere = $('remove-where').checked; });
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
    $('dropover').hidden = !on || state.panel;
    $('dropover-title').textContent = `Drop to add to the ${MODULE}`;
    $('dropover-sub').textContent = `Everyone in this ${SPACE} can see what you add.`;
    if (state.panel) renderAdd();
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
    lines.push(files.length === 1 ? `It is removed for everyone in this ${SPACE}. This can't be undone.` : `They are removed for everyone in this ${SPACE}. This can't be undone.`);
    const ok = await host.ui.confirm({ title: files.length === 1 ? `Remove "${files[0].name.length > 60 ? `${files[0].name.slice(0, 59)}…` : files[0].name}"?` : `Remove ${files.length} files?`, message: lines.join('\n\n'), action: 'Remove', kind: 'destructive' });
    if (!ok) return;
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
  // The viewer windows open a file from here (the same entry host.files.open will use). Until they exist, a file opens its details with
  // Download, so every file still goes somewhere.
  function openFile(file) {
    if (host.files && typeof host.files.open === 'function' && host.objects && host.objects.make) {
      return host.files.open(host.objects.make('file', file.id)).catch(() => showFile(file));
    }
    return showFile(file);
  }
  let showing = null;
  const detailsEditor = host.ui.editor($('details'), { size: 'small', onClose: () => { showing = null; } });
  async function showFile(f, { uses = false } = {}) {
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
    detailsEditor.open({ focus: mayDownload ? dl : $('details-close'), returnTo: () => root.querySelector(`[data-menu="${f.id}"]`) });
    if (!uses && !f.uses) return;
    try {
      const res = await host.library.uses(f.id);
      if (showing !== f) return;
      box.hidden = false;
      const head = el('h4', 'vt-uses-head', 'Where it is used');
      if (!res.uses.length && !res.hidden) { box.replaceChildren(head, el('p', 'vt-fine', `Nothing links to this file yet. Link it from a booking or a note in another tool.`)); return; }
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
  // Other people's changes arrive by asking again now and then (and when this page comes back into view): the server has no push for a
  // library yet.
  setInterval(() => { if (document.visibilityState === 'visible' && !running && !renaming) refresh({ quiet: true }); }, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh({ quiet: true }); });
})();
