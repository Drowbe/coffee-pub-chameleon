// The public page of a share link (plan-attachments-vault.md, section 7; the Prototype's "The public page"). No sign-in, no session read, nothing
// but this site's own files: the server sends this page with a policy that allows no inline script or style (see shared.html).
//
//   /shared/<token>   the list of files as a grid (name, who shared it, when it ends); a file opens in the page's own viewer, with Back,
//                     Previous and Next, and Download only where the link allows it. A password first, when the link has one.
// The views are the file windows' own (file-viewer-views.js); the bytes come from /api/shared/<token>/files/..., and the password cookie goes
// along with those requests by itself. A PDF is fetched here and handed to the sandboxed /viewer/pdf frame, which needs no cookie.
import '/agreement-redirect.js';
import { fileView, viewState, stopMedia, KINDS, kindOf, size, h, fa, btn, iconBtn, DOWNLOAD_ONLY } from '/file-viewer-views.js';

const root = document.getElementById('shared');
const token = (location.pathname.split('/')[2] || '').trim();
const api = (path, opts) => fetch(`/api/shared/${encodeURIComponent(token)}${path}`, { credentials: 'same-origin', cache: 'no-store', ...opts });

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function endsWord(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

let data = null;
let at = null; // the id of the file open in the viewer, else null
let view = null;
let back = null; // the card to focus when the viewer closes

function show(...nodes) {
  if (view) { view.destroy(); view = null; }
  stopMedia(root);
  root.replaceChildren(...nodes);
}
function gate(...nodes) {
  const g = h('div', 'sh-gate');
  g.append(...nodes);
  return g;
}
function say(icon, title, text) {
  const box = h('div', 'sdk-empty');
  box.append(fa(icon), h('p', 'sdk-empty-title', title));
  if (text) box.append(h('p', 'sdk-empty-text', text));
  return box;
}

// ---- states ------------------------------------------------------------------------------------------------------------------------
function ended() {
  document.title = 'Link ended';
  const title = h('h1', 'sdk-empty-title', 'This link has ended.');
  const box = h('div', 'sdk-empty');
  box.append(fa('link-slash'), title, h('p', 'sdk-empty-text', 'Ask the person who sent it to make a new one.'));
  show(gate(box));
  title.tabIndex = -1;
  title.focus({ preventScroll: true });
}
function trouble(text) {
  document.title = 'Shared files';
  const again = btn('btn', { label: 'Try again' });
  again.addEventListener('click', () => start());
  const box = say('triangle-exclamation', 'This page could not be opened.', text);
  const actions = h('div', 'sdk-empty-actions');
  actions.append(again);
  box.append(actions);
  show(gate(box));
}
function password(message = '', wait = 0) {
  document.title = 'Password needed';
  const form = h('form', 'sh-gate sdk-form');
  form.noValidate = true;
  form.append(h('h1', 'sh-title', 'This link has a password'));
  const field = h('label', 'sdk-field');
  field.append(h('span', 'sdk-label', 'Password'));
  const input = h('input');
  input.type = 'password';
  input.autocomplete = 'off';
  input.required = true;
  input.setAttribute('aria-label', 'Password');
  const note = h('span', message ? 'sdk-error' : 'sdk-hint', message || 'Ask the person who sent you the link.');
  note.setAttribute('role', 'status');
  if (message) input.setAttribute('aria-invalid', 'true');
  field.append(input, note);
  const go = btn('btn btn-primary', { label: 'Open' });
  go.type = 'submit';
  form.append(field, go);
  if (wait) {
    go.disabled = true;
    setTimeout(() => { go.disabled = false; }, Math.min(wait, 900) * 1000);
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!input.value) { input.setAttribute('aria-invalid', 'true'); note.className = 'sdk-error'; note.textContent = 'Type the password.'; input.focus(); return; }
    go.disabled = true;
    try {
      const res = await api('/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: input.value }) });
      if (res.ok) { await start(); return; }
      const body = await res.json().catch(() => ({}));
      if (res.status === 404 && body.ended) { ended(); return; }
      password(body.error || 'That password isn\'t right.', res.status === 429 ? Number(res.headers.get('Retry-After')) || 0 : 0);
    } catch {
      password('The page could not be reached. Check your connection and try again.');
    }
  });
  show(form);
  input.focus({ preventScroll: true });
}

// ---- the grid ----------------------------------------------------------------------------------------------------------------------
const openable = () => data.files.filter((f) => !f.removed);
function card(f) {
  const li = h('li', `sh-card${f.removed ? ' is-gone' : ''}`);
  const thumb = h('span', 'sh-thumb');
  const meta = h('div', 'sh-meta');
  const name = h('button', 'sh-name');
  name.type = 'button';
  if (f.removed) {
    thumb.append(fa('file-circle-xmark'));
    name.textContent = 'File removed';
    name.disabled = true;
    meta.append(name, h('span', 'sh-sub', 'It is no longer in this link.'));
  } else {
    const k = KINDS[kindOf(f)];
    thumb.dataset.tint = k.tint;
    thumb.append(fa(k.icon));
    if (f.thumb) {
      const img = h('img');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', () => img.remove());
      img.src = f.thumb;
      thumb.append(img);
    }
    if (f.group === 'video') { const play = h('span', 'sh-play'); play.append(fa('play')); thumb.append(play); }
    name.textContent = f.name;
    name.title = f.name;
    name.addEventListener('click', () => open(f.id, name));
    thumb.addEventListener('click', () => name.click()); // the picture opens the file as the name does
    thumb.classList.add('is-open');
    meta.append(name, h('span', 'sh-sub', `${k.word} · ${size(f.size)}`));
  }
  li.append(thumb, meta);
  return li;
}
function list() {
  document.title = data.name || 'Shared files';
  const head = h('header', 'sh-head');
  head.append(h('h1', 'sh-title', data.name || 'Shared files'));
  const by = [data.by ? `Shared by ${data.by}` : '', data.ends ? `Ends ${endsWord(data.ends)}` : ''].filter(Boolean).join(' · ');
  if (by) head.append(h('p', 'sh-by', by));
  const grid = h('ul', 'sh-grid');
  grid.setAttribute('aria-label', 'Files');
  grid.append(...data.files.map(card));
  const nodes = [head, grid];
  if (!data.download) nodes.push(h('p', 'sh-foot', 'These files are for looking at. The person who shared them has not allowed downloads.'));
  show(...nodes);
  if (back) { const to = [...root.querySelectorAll('.sh-name')].find((b) => b.title === back); if (to) to.focus({ preventScroll: true }); back = null; }
}

// ---- the viewer --------------------------------------------------------------------------------------------------------------------
function saveFile(f) {
  if (!f.download) return;
  const a = document.createElement('a');
  a.href = f.download;
  a.download = '';
  a.rel = 'noopener';
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
}
async function bytes(f) {
  const res = await fetch(f.content, { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) {
    let said = '';
    try { said = (await res.json()).error || ''; } catch { /* no body */ }
    throw Object.assign(new Error(said || (res.status === 404 ? 'There is no such file.' : `HTTP ${res.status}`)), { status: res.status });
  }
  return res.blob();
}
const source = (f) => ({
  module: 'link',
  missingText: 'The file is not available right now. Try again later, or ask the person who sent the link.',
  url: (x) => x.content,
  blob: bytes,
  download: data.download ? saveFile : null,
  openLink: (u) => { if (/^(https?:\/\/|mailto:)/i.test(u)) window.open(u, '_blank', 'noopener,noreferrer'); },
  markdown: (t) => (window.hostText && window.hostText.markdown ? window.hostText.markdown(t) : ''),
});

function open(id, opener) {
  const f = openable().find((x) => x.id === id);
  if (!f) return;
  back = f.name;
  at = id;
  const files = openable();
  const i = files.findIndex((x) => x.id === id);
  document.title = `${f.name} · ${data.name || 'Shared files'}`;
  const wrap = h('section', 'sh-viewer');
  wrap.setAttribute('aria-label', f.name);
  const bar = h('div', 'sh-vbar');
  const close = btn('btn btn-small', { label: 'Back', icon: 'arrow-left' });
  close.addEventListener('click', closeViewer);
  const prev = iconBtn('chevron-left', 'Previous file');
  const next = iconBtn('chevron-right', 'Next file');
  prev.disabled = i <= 0;
  next.disabled = i >= files.length - 1;
  prev.addEventListener('click', () => open(files[i - 1].id));
  next.addEventListener('click', () => open(files[i + 1].id));
  bar.append(close, h('h2', 'sh-vname', f.name), h('span', 'sh-vpos', `${i + 1} of ${files.length}`), prev, next);
  if (data.download && f.download) {
    const dl = btn('btn btn-small btn-primary', { label: 'Download', icon: 'download' });
    dl.addEventListener('click', () => saveFile(f));
    bar.append(dl);
  }
  const body = h('div', 'sh-vbody');
  const src = source(f);
  const holder = { v: null };
  const swap = (v) => { if (at !== id) return; if (holder.v) holder.v.destroy(); holder.v = v; view = v; const old = body.querySelector('.fv-view'); if (old) old.replaceWith(v.el); else body.append(v.el); };
  let v;
  if (f.viewable === false) {
    v = viewState({ icon: 'file-circle-exclamation', tone: 'warn', title: data.download ? DOWNLOAD_ONLY : 'This PDF can\'t be opened here.', text: data.download ? '' : 'The person who shared it has not allowed downloads.' });
  } else {
    v = fileView(f, src, {
      win: window,
      replace: (nv) => swap(nv),
      fullscreen: () => { try { if (document.fullscreenElement) document.exitFullscreen(); else wrap.requestFullscreen().catch(() => {}); } catch { /* not allowed here */ } },
      escape: () => { if (!document.fullscreenElement) closeViewer(); },
    });
  }
  holder.v = v;
  if (view) view.destroy();
  stopMedia(root);
  root.replaceChildren(wrap);
  body.append(v.el);
  view = v;
  wrap.append(bar, body);
  if (f.viewable === false && data.download && f.download) {
    const b = btn('btn btn-primary', { label: 'Download', icon: 'download' });
    b.addEventListener('click', () => saveFile(f));
    const actions = h('div', 'sdk-empty-actions');
    actions.append(b);
    const box = v.el.querySelector('.sdk-empty');
    if (box) box.append(actions);
  }
  window.scrollTo(0, 0);
  close.focus({ preventScroll: true });
}
function closeViewer() {
  at = null;
  list();
}

document.addEventListener('keydown', (e) => {
  if (at === null || e.defaultPrevented) return;
  const t = e.target;
  const typing = t && t.closest && t.closest('input, textarea, select, audio, video');
  if (e.key === 'Escape') {
    if (document.fullscreenElement || (t && t.closest && t.closest('input, textarea'))) return;
    closeViewer();
    e.preventDefault();
    return;
  }
  if (typing || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (t && t.closest && t.closest('.fv-pic.is-zoomed, .fv-md, .fv-pdf, [role="toolbar"]')) return;
  const files = openable();
  const i = files.findIndex((x) => x.id === at);
  if (e.key === 'ArrowLeft' && i > 0) { open(files[i - 1].id); e.preventDefault(); } else if (e.key === 'ArrowRight' && i >= 0 && i < files.length - 1) { open(files[i + 1].id); e.preventDefault(); }
});

// ---- start -------------------------------------------------------------------------------------------------------------------------
async function start() {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { ended(); return; }
  try {
    const res = await api('');
    const body = await res.json().catch(() => ({}));
    if (res.ok) { data = body; at = null; list(); return; }
    if (res.status === 401 && body.password) { password(); return; }
    if (res.status === 404) { ended(); return; }
    if (res.status === 429) { trouble(body.error || 'Too many tries. Wait a few minutes.'); return; }
    trouble('Something went wrong. Try again in a moment.');
  } catch {
    trouble('The page could not be reached. Check your connection and try again.');
  }
}
start();
