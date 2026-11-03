// The app's own PDF viewer: pdf.js (public/sdk/pdfjs/, pinned by hash) drawing a PDF inside a null-origin sandboxed
// frame, with no network (documentation/plans/plan-attachments-vault.md, decision 18, section 10; server/pdf-viewer.js).
//
// THE SEAM, for the page that shows a PDF (the viewer window, built on this):
//
//   Frame it:   <iframe src="/viewer/pdf" sandbox="allow-scripts" title="..."></iframe>
//               Never add allow-same-origin (or any other allow-*): the route's own CSP sandboxes it too
//               (`sandbox allow-scripts`), so the frame has a null origin, no cookies, no storage, no network
//               (connect-src 'none'), no frames, no workers, no forms. Full screen is the page's: put the window's
//               element in full screen (Element.requestFullscreen); the frame only asks for it ('fullscreen' below).
//   Bytes:      the page fetches the PDF itself with the person's session, after the server's checks:
//               const blob = await host.library.blob(id) from a module, or GET
//               /api/modules/<id>/library/<fid>/content?space=<space id> from the host page. A PDF whose view says
//               `viewable: false` is download only: never fetch it for the viewer (the route answers 404 "This PDF
//               can't be opened here. Download it."), show that sentence with Download instead.
//   Messages:   page -> frame: frame.contentWindow.postMessage(message, '*', [transfer]). The frame's origin is
//               "null", so '*' is the only target; nothing secret is sent but the PDF's own bytes.
//               frame -> page: arrives with event.origin === 'null'; take only messages whose
//               event.source === frame.contentWindow. The frame posts to the app's own origin only.
//
//   page -> frame
//     { type: 'open', data: ArrayBuffer, page?: n }     show this PDF (the ArrayBuffer is best transferred), at page n
//     { type: 'page', page: n }                          go to page n (1 is the first)
//     { type: 'next' } / { type: 'previous' }            the next or previous page
//     { type: 'zoom', scale: s }                         zoom to s (1 is 100%; 0.25 to 5)
//     { type: 'zoom', step: 1 | -1 }                     zoom in or out one step
//     { type: 'fit', mode: 'width' | 'page' }            fit the page's width, or the whole page; kept on resize
//     { type: 'search', query: 'text', back?: true }     find the text (case and accents ignored): the next match,
//                                                        or the one before with back; '' ends the search
//     { type: 'colors', page: 'css colour', focus: 'css colour' }  the theme's colours for around the pages and for
//                                                        a link's focus ring (tokens resolved by the page)
//   frame -> page
//     { type: 'ready' }                                  loaded; send 'open' after this
//     { type: 'opened', pages: n }                       the PDF is open
//     { type: 'state', page: n, pages: n, scale: s, fit: 'width' | 'page' | null }   after every change and scroll
//     { type: 'search', query, total: n, index: i, page: n }  i is 1-based, 0 when nothing matched
//     { type: 'link', url: 'https://...' | 'mailto:...' }      a web or email link in the PDF was pressed: open it in
//                                                        a new tab with rel="noopener noreferrer". No other link is
//                                                        ever sent; a link to a page inside the PDF is followed here.
//     { type: 'fullscreen' }                             the person pressed F: put the window in full screen
//     { type: 'key', key: 'Escape' | 'find' }            Escape, or Ctrl/Cmd+F (to open the page's own search)
//     { type: 'error', code: 'password' | 'failed', message }   it can't be shown; message is the sentence to show
//
// What it does not do: run the PDF's own scripts (pdf.js's scripting sandbox is never loaded and no JavaScript or
// form actions are read), fill forms (their appearance is drawn, not editable), select or copy text, or load CMaps,
// standard fonts or its WebAssembly decoders (all need the network): a PDF that needs them may draw some text in a
// fallback font or miss a JPEG 2000 picture. pdf.js parses on this frame's thread, not in a worker (server/pdf-viewer.js).
import './pdfjs/pdf.worker.min.mjs'; // first: sets globalThis.pdfjsWorker, so pdf.js parses here and starts no worker
import { getDocument, AnnotationMode } from './pdfjs/pdf.min.mjs';

const APP_ORIGIN = new URL(window.location.href).origin;
const MAX_BYTES = 100 * 1024 * 1024 + 1024 * 1024; // the Vault's PDF limit, and a little
const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const MAX_CANVAS_PIXELS = 16 * 1024 * 1024; // a page's canvas at most, whatever the zoom and the screen
const GAP = 12; // between pages and around them, in CSS pixels
const SENTENCES = {
  password: 'This PDF needs a password, so it can\'t be opened here. Download it.',
  failed: 'This PDF could not be opened here. Download it.',
};

const pagesEl = document.getElementById('pages');
let doc = null;
let task = null;
let opening = 0; // which open is the latest
let pages = []; // { el, canvas, links, size: { w, h } at scale 1, drawn: scale or 0, render }
let scale = 1;
let fit = 'width';
let current = 1;
let jumped = false; // the next scroll is one goTo made
let search = { query: '', hits: [], index: 0, texts: new Map(), run: 0 };

const post = (message) => window.parent.postMessage(message, APP_ORIGIN);
const clamp = (v) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));
const state = () => post({ type: 'state', page: current, pages: pages.length, scale: Math.round(scale * 1000) / 1000, fit });

function showError(code) {
  pagesEl.replaceChildren();
  const p = document.createElement('p');
  p.className = 'pv-note';
  p.textContent = SENTENCES[code];
  pagesEl.append(p);
  post({ type: 'error', code, message: SENTENCES[code] });
}

async function close() {
  observer.disconnect();
  for (const p of pages) if (p.render) p.render.cancel();
  pages = [];
  search = { query: '', hits: [], index: 0, texts: new Map(), run: search.run + 1 };
  pagesEl.replaceChildren();
  const old = task;
  task = null;
  doc = null;
  if (old) await old.destroy().catch(() => {});
}

async function open(data, startPage) {
  const mine = ++opening;
  await close();
  if (mine !== opening) return;
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
  if (!bytes || !bytes.length || bytes.length > MAX_BYTES) return showError('failed');
  task = getDocument({
    data: bytes,
    useWasm: false, // its decoders would be fetched; there is no network here
    useSystemFonts: true,
    enableXfa: false,
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true,
    stopAtErrors: false,
    verbosity: 0,
  });
  let loaded;
  try {
    loaded = await task.promise;
  } catch (err) {
    if (mine !== opening) return;
    return showError(err && err.name === 'PasswordException' ? 'password' : 'failed');
  }
  if (mine !== opening) return;
  doc = loaded;
  let first;
  try {
    first = await doc.getPage(1);
  } catch {
    return showError('failed');
  }
  const vp = first.getViewport({ scale: 1 });
  pages = Array.from({ length: doc.numPages }, (_, k) => {
    const el = document.createElement('div');
    el.className = 'pv-page';
    el.dataset.page = String(k + 1);
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', `Page ${k + 1}`);
    canvas.setAttribute('role', 'img');
    const links = document.createElement('div');
    links.className = 'pv-links';
    el.append(canvas, links);
    pagesEl.append(el);
    return { el, canvas, links, size: { w: vp.width, h: vp.height }, known: k === 0, drawn: 0, render: null };
  });
  current = Math.min(Math.max(1, Math.floor(Number(startPage)) || 1), pages.length);
  fit = 'width';
  applyScale(fitScale('width'));
  post({ type: 'opened', pages: pages.length });
  goTo(current);
}

// The scale that fits page `n`'s width, or the whole page, in the frame.
// A frame not laid out yet (narrower or lower than 100 pixels) is fitted once it is, when it is resized (below).
function fitScale(mode, n = current) {
  const p = pages[n - 1];
  if (!p) return scale;
  const root = document.documentElement;
  if (root.clientWidth < 100 || root.clientHeight < 100) return scale;
  const w = root.clientWidth - 2 * GAP;
  const h = root.clientHeight - 2 * GAP;
  return clamp(mode === 'page' ? Math.min(w / p.size.w, h / p.size.h) : w / p.size.w);
}

function layout() {
  for (const p of pages) {
    p.el.style.width = `${Math.floor(p.size.w * scale)}px`;
    p.el.style.height = `${Math.floor(p.size.h * scale)}px`;
  }
}

function applyScale(next) {
  const keep = current;
  scale = clamp(next);
  for (const p of pages) {
    if (p.render) { p.render.cancel(); p.render = null; }
    p.drawn = 0;
  }
  layout();
  observer.disconnect();
  for (const p of pages) observer.observe(p.el);
  goTo(keep, false);
  state();
}

async function draw(p, n) {
  if (!doc || p.drawn === scale || p.render) return;
  const want = scale;
  let page;
  try {
    page = await doc.getPage(n);
  } catch {
    return;
  }
  if (want !== scale || !pages.includes(p)) return;
  const base = page.getViewport({ scale: 1 });
  if (!p.known) {
    p.known = true;
    if (Math.abs(base.width - p.size.w) > 0.5 || Math.abs(base.height - p.size.h) > 0.5) {
      p.size = { w: base.width, h: base.height };
      p.el.style.width = `${Math.floor(p.size.w * scale)}px`;
      p.el.style.height = `${Math.floor(p.size.h * scale)}px`;
    }
  }
  const viewport = page.getViewport({ scale });
  let ratio = window.devicePixelRatio || 1;
  if (viewport.width * viewport.height * ratio * ratio > MAX_CANVAS_PIXELS) ratio = Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
  canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  canvas.setAttribute('aria-label', `Page ${n}`);
  canvas.setAttribute('role', 'img');
  const context = canvas.getContext('2d', { alpha: false });
  p.render = page.render({ canvasContext: context, canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null, annotationMode: AnnotationMode.ENABLE });
  try {
    await p.render.promise;
  } catch {
    p.render = null;
    return; // cancelled by a new zoom, or a page pdf.js could not draw
  }
  p.render = null;
  if (want !== scale || !pages.includes(p)) return;
  p.canvas.replaceWith(canvas);
  p.canvas = canvas;
  p.drawn = want;
  drawLinks(p, page, viewport);
}

// Links: a web or email link is handed to the page (it opens it in a new tab); a link to a page here is followed here.
// Anything else (a file, a program, a script) is not a link here at all.
async function drawLinks(p, page, viewport) {
  let annotations = [];
  try {
    annotations = await page.getAnnotations({ intent: 'display' });
  } catch {
    return;
  }
  p.links.replaceChildren();
  for (const a of annotations) {
    if (a.subtype !== 'Link' || !Array.isArray(a.rect) || a.rect.length !== 4 || !a.rect.every(Number.isFinite)) continue;
    const web = typeof a.url === 'string' && /^(https?:\/\/|mailto:)/i.test(a.url) ? a.url : null;
    if (!web && !a.dest) continue;
    const [x1, y1] = viewport.convertToViewportPoint(a.rect[0], a.rect[1]);
    const [x2, y2] = viewport.convertToViewportPoint(a.rect[2], a.rect[3]);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pv-link';
    b.style.left = `${Math.min(x1, x2)}px`;
    b.style.top = `${Math.min(y1, y2)}px`;
    b.style.width = `${Math.abs(x2 - x1)}px`;
    b.style.height = `${Math.abs(y2 - y1)}px`;
    b.title = web || 'Go to the page';
    b.setAttribute('aria-label', web ? `Link: ${web}` : 'Go to the page');
    b.addEventListener('click', () => (web ? post({ type: 'link', url: web }) : followDest(a.dest)));
    p.links.append(b);
  }
}

async function followDest(dest) {
  if (!doc) return;
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || !explicit.length) return;
    const ref = explicit[0];
    const index = ref && typeof ref === 'object' ? await doc.getPageIndex(ref) : Number.isInteger(ref) ? ref : -1;
    if (index >= 0) goTo(index + 1);
  } catch { /* a destination that is not there */ }
}

function goTo(n, announce = true) {
  if (!pages.length) return;
  current = Math.min(Math.max(1, Math.floor(Number(n)) || 1), pages.length);
  const p = pages[current - 1];
  const top = Math.min(Math.max(0, p.el.offsetTop - GAP), Math.max(0, document.documentElement.scrollHeight - document.documentElement.clientHeight));
  // The scroll this makes is not the person's: the page asked for stays the current one, even one too near the end to
  // reach the top of the frame.
  if (Math.abs(top - window.scrollY) >= 1) { jumped = true; window.scrollTo({ top, left: window.scrollX, behavior: 'instant' }); }
  if (announce) state();
}

// Pages are drawn when they come near the screen; the current page is the one across the middle of the frame.
const observer = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const n = Number(e.target.dataset.page);
    const p = pages[n - 1];
    if (p) draw(p, n);
  }
}, { rootMargin: '100% 0px' });

let scrollQueued = false;
window.addEventListener('scroll', () => {
  if (jumped) { jumped = false; return; }
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => {
    scrollQueued = false;
    const root = document.documentElement;
    const middle = window.scrollY + root.clientHeight / 2;
    let n = 1;
    for (let k = 0; k < pages.length; k += 1) {
      if (pages[k].el.offsetTop - GAP <= middle) n = k + 1; else break;
    }
    if (window.scrollY > 0 && window.scrollY + root.clientHeight >= root.scrollHeight - 2) n = pages.length; // scrolled to the end
    if (pages.length && n !== current) { current = n; state(); }
  });
}, { passive: true });

let resizeQueued = false;
new ResizeObserver(() => {
  if (resizeQueued || !fit || !pages.length) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    if (!fit || !pages.length) return; // a zoom chosen since
    const next = fitScale(fit);
    if (Math.abs(next - scale) > 0.001) applyScale(next);
  });
}).observe(document.documentElement);

// Search: each page's text, read once, matched without case or accents; the match goes to its page.
const fold = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
async function pageText(n) {
  if (search.texts.has(n)) return search.texts.get(n);
  let text = '';
  try {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    text = fold(content.items.map((i) => (typeof i.str === 'string' ? i.str + (i.hasEOL ? ' ' : '') : '')).join(''));
  } catch { /* a page whose text can't be read has none */ }
  search.texts.set(n, text);
  return text;
}
async function find(query, back) {
  if (!doc) return;
  const q = fold(String(query || '').slice(0, 200)).trim();
  if (!q) { search.query = ''; search.hits = []; search.index = 0; return post({ type: 'search', query: '', total: 0, index: 0, page: current }); }
  if (q !== search.query) {
    const run = ++search.run;
    const hits = [];
    for (let n = 1; n <= pages.length; n += 1) {
      const text = await pageText(n);
      if (run !== search.run) return;
      for (let at = text.indexOf(q); at >= 0; at = text.indexOf(q, at + q.length)) hits.push(n);
    }
    search.query = q;
    search.hits = hits;
    // The first match on or after the current page.
    const from = hits.findIndex((n) => n >= current);
    search.index = hits.length ? (from >= 0 ? from : 0) : -1;
  } else if (search.hits.length) {
    search.index = (search.index + (back ? -1 : 1) + search.hits.length) % search.hits.length;
  }
  const page = search.index >= 0 ? search.hits[search.index] : current;
  if (search.index >= 0) goTo(page);
  post({ type: 'search', query: String(query), total: search.hits.length, index: search.index + 1, page });
}

function zoomStep(step) {
  const next = step > 0 ? STEPS.find((s) => s > scale + 0.001) : [...STEPS].reverse().find((s) => s < scale - 0.001);
  fit = null;
  applyScale(next || scale);
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.origin !== APP_ORIGIN) return;
  const m = event.data;
  if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
  if (m.type === 'open') return void open(m.data, m.page);
  if (m.type === 'colors') {
    const root = document.documentElement.style;
    if (typeof m.page === 'string' && CSS.supports('color', m.page)) root.setProperty('--pv-around', m.page);
    if (typeof m.focus === 'string' && CSS.supports('color', m.focus)) root.setProperty('--pv-focus', m.focus);
    return;
  }
  if (!pages.length) return;
  if (m.type === 'page') return goTo(m.page);
  if (m.type === 'next') return goTo(current + 1);
  if (m.type === 'previous') return goTo(current - 1);
  if (m.type === 'zoom' && Number.isFinite(m.scale)) { fit = null; return applyScale(m.scale); }
  if (m.type === 'zoom' && (m.step === 1 || m.step === -1)) return zoomStep(m.step);
  if (m.type === 'fit' && (m.mode === 'width' || m.mode === 'page')) { fit = m.mode; return applyScale(fitScale(m.mode)); }
  if (m.type === 'search') return void find(m.query, Boolean(m.back));
});

window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') return post({ type: 'key', key: 'Escape' });
  if (mod && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); return post({ type: 'key', key: 'find' }); }
  if (mod && (e.key === '+' || e.key === '=')) { e.preventDefault(); return zoomStep(1); }
  if (mod && e.key === '-') { e.preventDefault(); return zoomStep(-1); }
  if (!mod && !e.altKey && (e.key === 'f' || e.key === 'F')) return post({ type: 'fullscreen' });
});

post({ type: 'ready' });
