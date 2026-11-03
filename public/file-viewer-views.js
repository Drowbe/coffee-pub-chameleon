// The file viewers (documentation/plans/plan-attachments-vault.md, step 3, decisions 18 to 20): what a file window shows for a picture (fit,
// zoom, pan, pinch), audio and video (the browser's own controls), Markdown (the SDK's renderer, so planted HTML shows as text), a PDF
// (the app's sandboxed pdf.js viewer, public/sdk/pdf-viewer.mjs, framed here), and the states: loading, a file that is missing or
// removed, a file the browser can't play, a PDF kept as download only, an error. Also the Info panel.
//
// Nothing here knows the window or the host: a view is made from `file` (a library record) and `source`, which says how to reach it, so the
// public share page (step 5) draws the same views in its own page:
//   source = {
//     url(file)                  the address of the bytes, for an <img>, <audio> or <video>
//     blob(file)                 a promise of the bytes as a Blob (rejects with the server's own sentence)
//     download(file)             start the download (omit when the person may not: no button is drawn)
//     openLink(url)              a web or email link in a PDF or in Markdown was asked for (checked again here)
//     module                     the word for the module ("Vault", "Documents"), for the sentences
//     missingText                the line under "File missing" where the default (which names the module and the admin) does not fit
//     markdown(text)             HTML for Markdown text (window.hostText.markdown)
//     toast(text)                a short note
//   }
// Every view is { el, destroy(), focus(), keys?(event) }: `el` goes in the window's body; destroy() stops media and listeners.
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

export const KINDS = {
  picture: { icon: 'file-image', tint: 'teal', word: 'Picture' },
  audio: { icon: 'file-audio', tint: 'purple', word: 'Audio' },
  video: { icon: 'file-video', tint: 'orange', word: 'Video' },
  pdf: { icon: 'file-pdf', tint: 'red', word: 'PDF' },
  text: { icon: 'file-lines', tint: 'gold', word: 'Markdown' },
};
export const kindOf = (f) => (f.group === 'image' ? 'picture' : f.group === 'audio' ? 'audio' : f.group === 'video' ? 'video' : f.type === 'application/pdf' ? 'pdf' : 'text');

// The colour around a PDF's pages: the panel pulled toward the text colour, so white pages stand out from it in a light theme (1.5:1 and more) and a dark one.
export const AROUND_PAGES = 'color-mix(in srgb, var(--text-primary) 22%, var(--surface-panel))';
export const DOWNLOAD_ONLY_NO = 'This PDF can\'t be opened here, and your role can\'t download it.';
export const DOWNLOAD_ONLY = 'This PDF can\'t be opened here. Download it.';

// ---- small pieces -------------------------------------------------------------------------------------------------------------------
export function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
export function fa(name, cls = '') {
  const i = document.createElement('i');
  i.className = `fa-solid fa-${name} fa-fw${cls ? ` ${cls}` : ''}`;
  i.setAttribute('aria-hidden', 'true');
  return i;
}
export function btn(cls, { label, icon, tip, aria } = {}) {
  const b = h('button', cls);
  b.type = 'button';
  if (icon) b.append(fa(icon));
  if (label) b.append(h('span', 'fv-btn-word', label));
  if (aria || (!label && tip)) b.setAttribute('aria-label', aria || tip);
  if (tip) b.dataset.tip = tip;
  return b;
}
export const iconBtn = (icon, label, extra = '') => btn(`sdk-icon-btn btn-quiet btn-small${extra ? ` ${extra}` : ''}`, { icon, aria: label, tip: label });

const MB = 1024 * 1024;
const GB = 1024 * MB;
const trim = (n, d) => String(Number(n.toFixed(d)));
export function size(bytes) {
  if (bytes >= GB) return `${trim(bytes / GB, bytes >= 10 * GB ? 0 : 1)} GB`;
  if (bytes >= MB) return `${trim(bytes / MB, bytes >= 100 * MB ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function day(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
export function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== today.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

// A state in the view: an icon, a title, a line and the buttons (the States family's empty state).
export function viewState({ icon, title, text, tone, actions = [], busy = false }) {
  const el = h('div', 'fv-view fv-state');
  el.setAttribute('role', busy ? 'status' : 'group');
  const box = h('div', 'sdk-empty');
  const i = fa(busy ? 'circle-notch' : icon, busy ? 'fa-spin fv-spin' : '');
  if (tone) i.dataset.tone = tone;
  box.append(i, h('p', 'sdk-empty-title', title));
  if (text) box.append(h('p', 'sdk-empty-text', text));
  if (actions.length) { const a = h('div', 'sdk-empty-actions'); a.append(...actions); box.append(a); }
  el.append(box);
  return { el, destroy() {}, focus() { const b = el.querySelector('button'); if (b) b.focus({ preventScroll: true }); } };
}

// Whether the bytes are not there (a 404), when an element could not show them: asks for one byte. 'gone' is a file the server has no
// bytes for; 'other' is anything else (so the browser could not show it).
export async function probe(url) {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    if (res.status === 404) return 'gone';
    return res.ok ? 'there' : 'other';
  } catch { return 'other'; }
}
function missingView(file, source) {
  return Object.assign(viewState({ icon: 'file-circle-exclamation', tone: 'warn', title: 'File missing', text: source.missingText || `The file itself is not on the server. This can happen after a restore. Remove it from the ${source.module}, or ask the admin to restore the ${source.module} folder.`, actions: [] }), { missing: true });
}
function downloadButton(file, source, primary = true) {
  if (!source.download) return [];
  const b = btn(`btn btn-small${primary ? ' btn-primary' : ''}`, { label: 'Download', icon: 'download' });
  b.addEventListener('click', () => source.download(file));
  return [b];
}
export function errorView(file, source, message) {
  return viewState({ icon: 'triangle-exclamation', tone: 'warn', title: message || 'This file could not be opened.', actions: downloadButton(file, source) });
}

// Only one sound or video plays at a time, and one that is let go holds no data.
let playing = null;
function oneAtATime(el) {
  el.addEventListener('play', () => {
    if (playing && playing !== el && playing.isConnected) { try { playing.pause(); } catch { /* gone */ } }
    playing = el;
  });
}
export function stopMedia(root) {
  for (const m of root.querySelectorAll('audio, video')) { try { m.pause(); m.removeAttribute('src'); m.load(); } catch { /* gone already */ } }
}

// ---- a picture: fit, zoom, pan (drag, arrow keys), pinch ---------------------------------------------------------------------------------
function pictureView(file, source, api) {
  const el = h('div', 'fv-view fv-pic');
  el.tabIndex = 0;
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', `${file.name}. Plus and minus zoom, the arrow keys move a zoomed picture.`);
  const wrap = h('div', 'fv-pic-wrap');
  const img = h('img');
  img.alt = file.name;
  img.draggable = false;
  img.decoding = 'async';
  wrap.append(img);
  let z = 1; let x = 0; let y = 0;
  const level = btn('btn btn-small btn-quiet fv-zoom-level', { label: 'Fit', tip: 'Fit to window' });
  const out = iconBtn('magnifying-glass-minus', 'Zoom out');
  const inn = iconBtn('magnifying-glass-plus', 'Zoom in');
  const MAX = 5;
  const apply = () => {
    img.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    level.querySelector('.fv-btn-word').textContent = z === 1 ? 'Fit' : `${Math.round(z * 100)}%`;
    el.classList.toggle('is-zoomed', z > 1);
    out.disabled = z <= 1;
    inn.disabled = z >= MAX;
  };
  const set = (nz) => { z = Math.max(1, Math.min(MAX, nz)); if (z === 1) { x = 0; y = 0; } apply(); };
  out.addEventListener('click', () => set(z - 0.5));
  inn.addEventListener('click', () => set(z + 0.5));
  level.addEventListener('click', () => set(1));
  const bar = h('div', 'fv-zoombar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Zoom');
  bar.append(out, level, inn);
  bar.hidden = true;
  el.append(wrap, bar);
  wrap.addEventListener('wheel', (e) => { e.preventDefault(); set(z + (e.deltaY < 0 ? 0.25 : -0.25)); }, { passive: false });
  wrap.addEventListener('dblclick', () => set(z > 1 ? 1 : 2));
  // Pointers: one drags a zoomed picture; two pinch.
  const pts = new Map();
  let drag = null; let pinch = null;
  wrap.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { wrap.setPointerCapture(e.pointerId); } catch { /* gone */ }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z }; drag = null; } else if (z > 1) { drag = { px: e.clientX, py: e.clientY, x, y }; wrap.classList.add('is-dragging'); }
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size >= 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch.d) set(pinch.z * (d / pinch.d)); } else if (drag) { x = drag.x + e.clientX - drag.px; y = drag.y + e.clientY - drag.py; apply(); }
  });
  const end = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) { drag = null; wrap.classList.remove('is-dragging'); } };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
  el.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') set(z + 0.5);
    else if (e.key === '-') set(z - 0.5);
    else if (e.key === '0') set(1);
    else if (z > 1 && e.key.startsWith('Arrow')) { const d = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[e.key]; x += d[0]; y += d[1]; apply(); e.preventDefault(); } else return;
    e.stopPropagation();
  });
  img.addEventListener('load', () => { bar.hidden = false; });
  img.addEventListener('error', async () => {
    const what = await probe(source.url(file));
    api.replace(what === 'gone' ? missingView(file, source) : errorView(file, source, 'This picture could not be shown.'));
  });
  img.src = source.url(file);
  apply();
  return { el, destroy() {}, focus() { el.focus({ preventScroll: true }); }, fullTarget: el };
}

// ---- audio and video: the browser's own controls ----------------------------------------------------------------------------------------
function cannotPlay(file, source) {
  return viewState({ icon: 'file-video', tone: 'warn', title: 'This browser can\'t play this file.', text: file.type === 'video/quicktime' ? 'It is a QuickTime video. Safari plays it; other browsers may not.' : 'You can download it and play it on your device.', actions: downloadButton(file, source) });
}
function audioView(file, source, api) {
  const el = h('div', 'fv-view fv-audio');
  const tile = h('span', 'fv-audio-tile');
  tile.dataset.tint = KINDS.audio.tint;
  tile.append(fa('file-audio'));
  const player = h('audio');
  player.controls = true;
  player.preload = 'metadata';
  oneAtATime(player);
  player.setAttribute('aria-label', file.name);
  player.addEventListener('error', async () => {
    const what = await probe(source.url(file));
    api.replace(what === 'gone' ? missingView(file, source) : cannotPlay(file, source));
  });
  player.src = source.url(file);
  el.append(tile, h('p', 'fv-audio-name', file.name), h('p', 'fv-audio-meta', `${size(file.size)}`), player);
  return { el, destroy() { stopMedia(el); }, focus() { player.focus({ preventScroll: true }); } };
}
function videoView(file, source, api) {
  const el = h('div', 'fv-view fv-video');
  const v = h('video');
  v.controls = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.preload = 'metadata';
  oneAtATime(v);
  v.setAttribute('aria-label', file.name);
  v.addEventListener('error', async () => {
    const what = await probe(source.url(file));
    api.replace(what === 'gone' ? missingView(file, source) : cannotPlay(file, source));
  });
  v.src = source.url(file);
  el.append(v);
  return { el, destroy() { stopMedia(el); }, focus() { v.focus({ preventScroll: true }); } };
}

// ---- Markdown, read only, in the reading width ---------------------------------------------------------------------------------------------
function markdownView(file, source, api) {
  const el = h('div', 'fv-view fv-md-view');
  const page = h('article', 'fv-md');
  page.tabIndex = 0;
  page.setAttribute('aria-label', file.name);
  el.append(page);
  let gone = false;
  source.blob(file).then((blob) => blob.text()).then((text) => {
    if (gone) return;
    // The renderer escapes everything first; HTML in the text shows as text.
    const html = source.markdown ? source.markdown(text) : '';
    if (html) page.innerHTML = html; else page.textContent = text;
    for (const a of page.querySelectorAll('a')) {
      const href = a.getAttribute('href') || '';
      if (!SAFE_LINK.test(href)) { a.removeAttribute('href'); continue; }
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
  }).catch((err) => { if (!gone) api.replace(err && err.status === 404 ? missingView(file, source) : errorView(file, source, (err && err.message) || 'This file could not be opened.')); });
  return { el, destroy() { gone = true; }, focus() { page.focus({ preventScroll: true }); } };
}

// ---- a PDF: the sandboxed pdf.js viewer in a frame, with our own controls ---------------------------------------------------------------------
// The seam is at the top of public/sdk/pdf-viewer.mjs: the frame is sandbox="allow-scripts" only (a null origin), the bytes go in as a
// transferred ArrayBuffer, and only the messages from that very frame are heard.
function pdfView(file, source, api) {
  const el = h('div', 'fv-view fv-pdf');
  const bar = h('div', 'fv-pdfbar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'PDF controls');
  const prev = iconBtn('chevron-left', 'Previous page');
  const next = iconBtn('chevron-right', 'Next page');
  const num = h('input', 'fv-pdf-page');
  num.type = 'text'; num.inputMode = 'numeric'; num.value = '1'; num.setAttribute('aria-label', 'Page number'); num.autocomplete = 'off';
  const total = h('span', 'fv-pdf-of', 'of 1');
  const out = iconBtn('magnifying-glass-minus', 'Zoom out');
  const inn = iconBtn('magnifying-glass-plus', 'Zoom in');
  const level = btn('btn btn-small btn-quiet fv-zoom-level', { label: 'Fit width', tip: 'Fit to width' });
  const find = iconBtn('magnifying-glass', 'Search in the PDF');
  const left = h('div', 'fv-pdfbar-group'); left.append(prev, num, total, next);
  const mid = h('div', 'fv-pdfbar-group fv-pdfbar-zoom'); mid.append(out, level, inn);
  const right = h('div', 'fv-pdfbar-group'); right.append(find);
  const sep = () => h('span', 'fv-sep');
  bar.append(left, sep(), mid, h('span', 'fv-pdfbar-fill'), right);
  const searchBox = h('div', 'fv-pdf-search');
  searchBox.setAttribute('role', 'search');
  const q = h('input'); q.type = 'search'; q.placeholder = 'Search in the PDF'; q.setAttribute('aria-label', 'Search in the PDF'); q.autocomplete = 'off';
  const count = h('span', 'fv-pdf-count', '');
  count.setAttribute('aria-live', 'polite');
  const sPrev = iconBtn('chevron-up', 'Previous match');
  const sNext = iconBtn('chevron-down', 'Next match');
  const sClose = iconBtn('xmark', 'Close search');
  searchBox.append(q, count, sPrev, sNext, sClose);
  searchBox.hidden = true;
  const holder = h('div', 'fv-pdf-holder');
  const frame = document.createElement('iframe');
  frame.className = 'fv-pdf-frame';
  frame.setAttribute('sandbox', 'allow-scripts'); // nothing else, ever: no allow-same-origin
  frame.title = `${file.name}, PDF`;
  frame.hidden = true;
  holder.append(frame);
  const loading = viewState({ busy: true, title: 'Opening…' });
  holder.append(loading.el);
  el.append(bar, searchBox, holder);
  bar.hidden = true;

  let st = { page: 1, pages: 1, fit: 'width', scale: 1 };
  let ready = false; let bytes = null; let sent = false; let dead = false;
  const post = (m, transfer) => { if (frame.contentWindow) frame.contentWindow.postMessage(m, '*', transfer || []); };
  const paint = () => {
    num.value = String(st.page);
    total.textContent = `of ${st.pages}`;
    prev.disabled = st.page <= 1;
    next.disabled = st.page >= st.pages;
    level.querySelector('.fv-btn-word').textContent = st.fit === 'width' ? 'Fit width' : st.fit === 'page' ? 'Fit page' : `${Math.round(st.scale * 100)}%`;
  };
  // The theme's colours for around the pages and a link's focus ring, resolved from the tokens here.
  const colour = (value) => {
    const probeEl = h('span');
    probeEl.style.cssText = `position:absolute;visibility:hidden;color:${value}`;
    el.append(probeEl);
    const c = getComputedStyle(probeEl).color;
    probeEl.remove();
    return c;
  };
  const send = () => {
    if (sent || !ready || !bytes) return;
    sent = true;
    post({ type: 'colors', page: colour(AROUND_PAGES), focus: colour('var(--focus-ring)') });
    post({ type: 'open', data: bytes }, [bytes]);
    bytes = null;
  };
  const onMessage = (event) => {
    if (event.source !== frame.contentWindow || event.origin !== 'null' || !event.data || typeof event.data !== 'object') return;
    const m = event.data;
    if (m.type === 'ready') { ready = true; send(); } else if (m.type === 'opened') {
      loading.el.remove();
      frame.hidden = false;
      bar.hidden = false;
      st = { ...st, pages: Number(m.pages) || 1 };
      paint();
    } else if (m.type === 'state') {
      st = { page: m.page, pages: m.pages, fit: m.fit, scale: m.scale };
      paint();
    } else if (m.type === 'search') {
      count.textContent = !m.query ? '' : m.total ? `${m.index} of ${m.total}` : 'No match';
    } else if (m.type === 'link') {
      if (typeof m.url === 'string' && SAFE_LINK.test(m.url)) source.openLink(m.url);
    } else if (m.type === 'fullscreen') api.fullscreen();
    else if (m.type === 'key') {
      if (m.key === 'Escape') api.escape(); else if (m.key === 'find') showSearch(true);
    } else if (m.type === 'error') {
      api.replace(errorView(file, source, typeof m.message === 'string' && m.message ? m.message : 'This PDF could not be opened here. Download it.'));
    }
  };
  const home = api.win || window; // the window the file window is in (a pop-out has its own)
  home.addEventListener('message', onMessage);
  frame.src = '/viewer/pdf';
  source.blob(file).then((blob) => blob.arrayBuffer()).then((buf) => { if (dead) return; bytes = buf; send(); }).catch((err) => {
    if (dead) return;
    api.replace(err && err.status === 404 && file.viewable === false ? downloadOnlyView(file, source) : err && err.status === 404 ? missingView(file, source) : errorView(file, source, (err && err.message) || 'This file could not be opened.'));
  });

  const go = (n) => post({ type: 'page', page: Math.max(1, Math.min(st.pages, n)) });
  prev.addEventListener('click', () => post({ type: 'previous' }));
  next.addEventListener('click', () => post({ type: 'next' }));
  num.addEventListener('keydown', (e) => { if (e.key === 'Enter') { go(parseInt(num.value, 10) || 1); e.preventDefault(); } e.stopPropagation(); });
  num.addEventListener('change', () => go(parseInt(num.value, 10) || 1));
  out.addEventListener('click', () => post({ type: 'zoom', step: -1 }));
  inn.addEventListener('click', () => post({ type: 'zoom', step: 1 }));
  level.addEventListener('click', () => post({ type: 'fit', mode: st.fit === 'width' ? 'page' : 'width' }));
  function showSearch(on) {
    searchBox.hidden = !on;
    if (on) { q.focus({ preventScroll: true }); q.select(); } else { q.value = ''; count.textContent = ''; post({ type: 'search', query: '' }); find.focus({ preventScroll: true }); }
  }
  find.addEventListener('click', () => showSearch(searchBox.hidden));
  sClose.addEventListener('click', () => showSearch(false));
  const run = (back) => post({ type: 'search', query: q.value, ...(back ? { back: true } : {}) });
  let timer = 0;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => run(false), 250); });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(timer); run(e.shiftKey); e.preventDefault(); } else if (e.key === 'Escape') { showSearch(false); e.preventDefault(); }
    e.stopPropagation();
  });
  sPrev.addEventListener('click', () => run(true));
  sNext.addEventListener('click', () => run(false));
  return {
    el, fullTarget: el,
    destroy() { dead = true; clearTimeout(timer); home.removeEventListener('message', onMessage); frame.src = 'about:blank'; frame.remove(); },
    focus() { if (!frame.hidden) frame.focus({ preventScroll: true }); else el.focus({ preventScroll: true }); },
  };
}

export function downloadOnlyView(file, source) {
  if (!source.download) return viewState({ icon: 'file-circle-exclamation', tone: 'warn', title: DOWNLOAD_ONLY_NO, text: `The ${source.module} could not check this file, so it is kept for download only.` });
  return viewState({ icon: 'file-circle-exclamation', tone: 'warn', title: DOWNLOAD_ONLY, text: `The ${source.module} could not check this file, so it is kept for download only. Your own PDF reader opens it.`, actions: downloadButton(file, source) });
}

// The view for a file. `api`: { win, replace(view) puts a state in its place (an error found while loading), fullscreen(), escape() }.
export function fileView(file, source, api) {
  if (file.viewable === false) return downloadOnlyView(file, source);
  const kind = kindOf(file);
  if (kind === 'picture') return pictureView(file, source, api);
  if (kind === 'audio') return audioView(file, source, api);
  if (kind === 'video') return videoView(file, source, api);
  if (kind === 'text') return markdownView(file, source, api);
  return pdfView(file, source, api);
}

// ---- Info: what the record holds, and where the file is used ----------------------------------------------------------------------------------
// info: { who(file) -> name, uses(file) -> Promise<{ uses: [summary], hidden }> | null, open(summary) | null, onClose() }
export function infoView(file, info) {
  const box = h('aside', 'fv-info');
  box.setAttribute('aria-label', 'Information about this file');
  const head = h('div', 'fv-info-head');
  const close = iconBtn('xmark', 'Close info');
  close.addEventListener('click', () => info.onClose());
  head.append(h('h3', 'fv-info-title', 'Info'), close);
  const dl = h('dl', 'fv-info-list');
  const row = (k, v) => { if (v === undefined || v === null || v === '') return; dl.append(h('dt', '', k), h('dd', '', v)); };
  row('Name', file.name);
  row('Type', `${KINDS[kindOf(file)].word} · ${file.type}`);
  row('Size', size(file.size));
  row('Added by', info.who(file));
  row('Added', day(file.at));
  if (file.taken) row('Taken', day(file.taken));
  box.append(head, dl);
  const uses = h('div', 'fv-info-uses');
  uses.append(h('h4', 'fv-info-sub', 'Where it is used'));
  const body = h('div', 'fv-info-body');
  uses.append(body);
  box.append(uses);
  let gone = false;
  const fill = (res) => {
    if (gone) return;
    body.replaceChildren();
    if (!res.uses.length && !res.hidden) { body.append(h('p', 'fv-info-none', 'Not linked from anywhere.')); return; }
    const ul = h('ul', 'fv-uses');
    for (const x of res.uses) {
      const li = h('li');
      const mod = (x.module && x.module.name) || x.moduleName || '';
      if (info.open && x.open !== false && x.ref) {
        const b = btn('fv-use-link', { label: x.title });
        b.addEventListener('click', () => info.open(x));
        li.append(b);
      } else li.append(h('b', '', x.title));
      if (mod) li.append(h('span', '', ` · ${mod}`));
      ul.append(li);
    }
    body.append(ul);
    if (res.hidden) body.append(h('p', 'fv-info-none', `and ${res.hidden} more you can't see`));
  };
  if (file.uses === 0) fill({ uses: [], hidden: 0 });
  else if (info.uses) {
    body.append(h('p', 'fv-info-none', 'Looking…'));
    info.uses(file).then(fill).catch(() => { if (!gone) { body.replaceChildren(h('p', 'fv-info-none', 'This could not be read just now.')); } });
  }
  return { el: box, destroy() { gone = true; }, focus() { close.focus({ preventScroll: true }); } };
}
