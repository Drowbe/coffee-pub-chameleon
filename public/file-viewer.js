// The file windows (documentation/plans/plan-attachments-vault.md, step 3, decisions 18 to 20; the design is the Prototype's Vault window,
// public/design-system/prototype-vault-window.js). A file opens in one of the app's own windows, drawn by the module frame (variant
// 'window') in a layer over the page, never inside the Vault's panel and never in a new browser window. The Vault's list opens one
// (host.files.open), and so will any module that links to a file.
//
//   openFile({ ref, ids, doc, name, returnFocus, openRef })   open the file `ref` points at (a pointer: { module, kind: 'file', id, scope: 'space',
//                                    space }). `ids`: the files to walk with Previous and Next (the Vault's list as filtered, or the files linked
//                                    where it was opened from), else none. `returnFocus()`: where focus goes when the window closes.
//                                    `openRef(pointer)`: shows another module's object (a link in Info).
//   closeAllFiles(doc), fileWindowCount(doc)   Close all (the Layout menu's), and how many are open.
//
// Several windows at once, at most MAX_WINDOWS; opening a file that already has a window brings it forward; at the cap, "Close a window to
// open another." and nothing opens. On a phone (640 px and narrower) one window shows at a time, a full-screen sheet, and a new file replaces
// the one shown. Esc closes the window that has the focus and focus goes back to the opener. The views are in file-viewer-views.js, which the
// public share page uses too. The bytes come from the library routes with the person's session; the PDF viewer is framed from there.
import { createModuleFrame } from '/module-frame.js';
import { openHostMenu } from '/host-menu.js';
import { confirmDialog } from '/confirm.js';
import { actionBar } from '/action-bar.js';
import { api, accessKeyHeaders, showNote, word } from '/brand.js';
import { fileView, infoView, viewState, stopMedia, KINDS, kindOf, size, when, h } from '/file-viewer-views.js';

export const MAX_WINDOWS = 4;
export const CAP_SENTENCE = 'Close a window to open another.';
export const CAP_TITLE = 'Four windows are open';
const SMALL_H = 300; // a window shorter than this has no Info: it would hide the file
const PHONE = 640;
// Share (decision 12, step 5): the button shows only where the person has the `share` permission, and opens the same sheet the Vault's Share does.
const SHARE_READY = true;
const enc = encodeURIComponent;

const managers = new WeakMap();
const managerFor = (doc) => {
  let m = managers.get(doc);
  if (!m) { m = createManager(doc); managers.set(doc, m); }
  return m;
};
export const fileWindowCount = (doc = document) => (managers.get(doc) ? managers.get(doc).wins.length : 0);
export function closeAllFiles(doc = document) { const m = managers.get(doc); if (m) m.closeAll(); }
export function openFile(spec) {
  const doc = spec.doc || document;
  return managerFor(doc).open(spec);
}

// The stylesheet, once for each document (a window popped out of the page is a document of its own).
const styled = new WeakMap();
function loadStyles(doc) {
  if (styled.has(doc)) return styled.get(doc);
  const done = new Promise((resolve) => {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/file-viewer.css';
    link.addEventListener('load', resolve);
    link.addEventListener('error', resolve);
    doc.head.append(link);
    setTimeout(resolve, 1500);
  });
  styled.set(doc, done);
  return done;
}

function createManager(doc) {
  const win = doc.defaultView || window;
  const wins = [];
  let z = 10;
  let layer = null;
  const pending = new Set();
  const people = new Map();
  let peopleAsked = 0;

  const phone = () => win.innerWidth <= PHONE;
  const ensureLayer = () => {
    if (layer && layer.isConnected) return layer;
    layer = doc.createElement('div');
    layer.id = 'file-layer';
    layer.className = 'fv-layer';
    doc.body.append(layer);
    return layer;
  };

  // ---- what we know about a place (a module's library in a space) ----------------------------------------------------------------
  const base = (p) => `/api/modules/${enc(p.module)}/library`;
  const libUrl = (p, path = '', extra = {}) => {
    const q = new URLSearchParams({ space: p.space });
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    return `${base(p)}${path}?${q}`;
  };
  // Asked again each time a window opens, so a change of rights (download turned off) reaches the next window.
  const contextOf = (p) => api('GET', `/api/modules/${enc(p.module)}/context?scope=space&space=${enc(p.space)}`);
  async function loadPeople() {
    if (Date.now() - peopleAsked < 15000) return;
    peopleAsked = Date.now();
    try { for (const u of (await api('GET', '/api/presence')).users || []) people.set(u.key, u.displayName); } catch { /* names are a nicety */ }
  }

  // ---- the window ---------------------------------------------------------------------------------------------------------------
  const MIN_W = 300; const MIN_H = 200;
  const vw = () => win.innerWidth;
  const vh = () => win.innerHeight;
  // The box a window stays inside: the canvas (the work area the Layout menu belongs to), else the page.
  function bounds() {
    const c = doc.getElementById('canvas');
    if (c && !c.hidden) {
      const r = c.getBoundingClientRect();
      if (r.width >= MIN_W && r.height >= MIN_H) return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    }
    return { x: 0, y: 0, w: vw(), h: vh() };
  }
  function putBox(w, b) {
    const k = bounds();
    const width = Math.min(Math.max(b.w, MIN_W), Math.max(MIN_W, k.w));
    const height = Math.min(Math.max(b.h, MIN_H), Math.max(MIN_H, k.h));
    const x = Math.min(Math.max(b.x, k.x), Math.max(k.x, k.x + k.w - width));
    const y = Math.min(Math.max(b.y, k.y), Math.max(k.y, k.y + k.h - height));
    w.el.style.cssText = `z-index:${w.z};left:${x}px;top:${y}px;width:${width}px;height:${height}px`;
    const small = height < SMALL_H;
    if (small !== Boolean(w.small)) { w.small = small; if (w.files && w.files.size) { w.frame.setToolbar(toolbar(w)); drawInfo(w); } }
  }
  const boxOf = (w) => ({ x: w.el.offsetLeft, y: w.el.offsetTop, w: w.el.offsetWidth, h: w.el.offsetHeight });
  function place(w, n) {
    if (phone()) { w.el.style.cssText = `z-index:${w.z}`; return; }
    if (w.user) { putBox(w, boxOf(w)); return; }
    const k = bounds();
    const width = Math.round(Math.max(420, Math.min(720, k.w * 0.5)));
    const left = Math.round(k.x + Math.min(k.w - width - 16, 16 + n * 36));
    const top = k.y + 16 + n * 28;
    putBox(w, { x: left, y: top, w: width, h: Math.max(340, Math.min(k.y + k.h - top - 16, 640)) });
  }
  function wireDrag(w) {
    const grip = h('span', 'fv-grip');
    grip.title = 'Drag to resize';
    w.el.append(grip);
    let drag = null;
    const begin = (kind) => (e) => {
      if (phone() || (e.button !== undefined && e.button > 0)) return;
      if (e.target.closest('button, input, textarea, a')) return;
      e.preventDefault();
      drag = { kind, sx: e.clientX, sy: e.clientY, box: boxOf(w) };
      layer.classList.add('dragging');
      e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const move = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx; const dy = e.clientY - drag.sy;
      const b = { ...drag.box };
      if (drag.kind === 'move') { b.x += dx; b.y += dy; } else { b.w += dx; b.h += dy; }
      if (dx || dy) w.user = true;
      putBox(w, b);
    };
    const end = () => { if (!drag) return; drag = null; layer.classList.remove('dragging'); };
    for (const [node, kind] of [[w.frame.titlebar, 'move'], [grip, 'size']]) {
      node.addEventListener('pointerdown', begin(kind));
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', end);
      node.addEventListener('pointercancel', end);
    }
  }
  function front(w) {
    z += 1; w.z = z;
    w.el.style.zIndex = String(z);
    for (const x of wins) x.el.classList.toggle('is-front', x === w);
  }
  const topWindow = () => wins.reduce((a, b) => (!a || b.z > a.z ? b : a), null);

  function close(w, { focus = true } = {}) {
    const at = wins.indexOf(w);
    if (at < 0) return;
    wins.splice(at, 1);
    w.dead = true;
    if (w.view) w.view.destroy();
    if (w.infoSide) w.infoSide.destroy();
    stopMedia(w.el);
    try { if (doc.fullscreenElement && w.el.contains(doc.fullscreenElement)) doc.exitFullscreen(); } catch { /* none */ }
    if (w.frame.destroy) w.frame.destroy();
    w.el.remove();
    const rest = topWindow();
    if (rest) front(rest);
    if (!focus) return;
    const back = w.returnFocus && w.returnFocus();
    if (back && back.isConnected !== false && typeof back.focus === 'function') back.focus({ preventScroll: true });
    else if (!back && rest) rest.frame.el.focus({ preventScroll: true });
  }
  // Close all: from a window's menu focus goes back to what opened the one in front; from the Layout menu the menu has the focus.
  function closeAll({ focus = false } = {}) {
    const back = focus && topWindow() ? topWindow().returnFocus : null;
    for (const w of [...wins].reverse()) close(w, { focus: false });
    const to = back && back();
    if (to && to.isConnected !== false && typeof to.focus === 'function') to.focus({ preventScroll: true });
  }

  // ---- what the person may do, and the words ----------------------------------------------------------------------------------------
  const can = (w, key) => Boolean(w.cx && w.cx.permissions && w.cx.permissions[key]);
  const me = (w) => (w.cx && w.cx.user && w.cx.user.key) || '';
  const mayChange = (w, f) => can(w, 'remove_any') || f.by === me(w);
  const whoIs = (w) => (f) => (f.by === me(w) ? 'You' : people.get(f.by) || 'someone who left');
  const moduleWord = (w) => (w.cx && w.cx.module && w.cx.module.name) || 'Vault';

  function download(w, f) {
    const a = doc.createElement('a');
    a.href = libUrl(w.place, `/${enc(f.id)}/content`, { download: '1' });
    a.download = '';
    a.rel = 'noopener';
    a.hidden = true;
    doc.body.append(a);
    a.click();
    a.remove();
  }
  async function blobOf(w, f) {
    const res = await fetch(libUrl(w.place, `/${enc(f.id)}/content`), { headers: accessKeyHeaders() });
    if (!res.ok) {
      let said = '';
      try { said = (await res.json()).error || ''; } catch { /* no body */ }
      throw Object.assign(new Error(said || (res.status === 404 ? 'There is no such file.' : `HTTP ${res.status}`)), { status: res.status });
    }
    return res.blob();
  }
  const fullscreen = (w) => {
    try {
      if (doc.fullscreenElement) doc.exitFullscreen();
      else if (w.frame.el.requestFullscreen) w.frame.el.requestFullscreen().catch(() => {});
    } catch { /* not allowed here */ }
  };
  const sourceFor = (w) => ({
    module: moduleWord(w),
    url: (f) => libUrl(w.place, `/${enc(f.id)}/content`),
    blob: (f) => blobOf(w, f),
    download: can(w, 'download') ? (f) => download(w, f) : null,
    openLink: (u) => { if (/^(https?:\/\/|mailto:)/i.test(u)) win.open(u, '_blank', 'noopener,noreferrer'); },
    markdown: (t) => { const text = win.hostText || window.hostText; return text && text.markdown ? text.markdown(t) : ''; },
  });

  // ---- the toolbar and the title bar's menu ----------------------------------------------------------------------------------------
  const walk = (w) => (w.ids ? w.ids.filter((id) => w.files.has(id)) : []);
  function go(w, dir) {
    const ids = walk(w);
    const i = ids.indexOf(w.id) + dir;
    if (i >= 0 && i < ids.length) show(w, ids[i]);
  }
  function toolbar(w) {
    const list = [];
    const f = w.files.get(w.id);
    const ids = walk(w);
    if (ids.length > 1) {
      const i = ids.indexOf(w.id);
      list.push({ type: 'button', id: 'prev', label: 'Previous', icon: 'chevron-left', kind: 'icon', disabled: i <= 0 });
      list.push({ type: 'button', id: 'next', label: 'Next', icon: 'chevron-right', kind: 'icon', disabled: i < 0 || i >= ids.length - 1 });
      list.push({ type: 'text', text: `${i + 1} of ${ids.length}` });
    }
    if (f && !w.small) list.push({ type: 'button', id: 'info', label: 'Info', icon: 'circle-info', kind: 'icon', on: w.info, tip: w.info ? 'Hide info' : 'Show info' });
    const end = (it) => ({ ...it, zone: 'end', pin: true });
    if (f) {
      if (can(w, 'download') && !phone() && !w.missing) list.push(end({ type: 'button', id: 'download', label: 'Download', icon: 'download', kind: 'secondary' }));
      if (SHARE_READY && can(w, 'share')) list.push(end({ type: 'button', id: 'share', label: 'Share', icon: 'share-nodes', kind: 'secondary' }));
      if (f.viewable !== false && !w.broken) list.push(end({ type: 'button', id: 'full', label: 'Full screen', icon: 'expand', kind: 'icon' }));
    }
    return list;
  }
  function menuActions(w) {
    const f = w.files.get(w.id);
    const out = [];
    if (f && mayChange(w, f)) out.push({ id: 'rename', label: 'Rename', icon: 'pen', placement: 'menu' });
    if (f) out.push({ id: 'uses', label: 'Where it is used', icon: 'link', placement: 'menu' });
    out.push({ id: 'closeall', label: 'Close all', icon: 'xmark', placement: 'menu' });
    if (f && mayChange(w, f)) out.push({ id: 'remove', label: 'Remove', icon: 'trash', placement: 'menu', danger: true });
    return out;
  }
  function act(w, e) {
    const f = w.files.get(w.id);
    if (e.area === 'titlebar') {
      if (e.id === 'close') close(w);
      else if (e.id === 'closeall') closeAll({ focus: true });
      else if (e.id === 'uses') { w.info = true; drawInfo(w); w.frame.setToolbar(toolbar(w)); if (w.infoSide) w.infoSide.focus(); } else if (e.id === 'rename' && f) rename(w, f, e.el);
      else if (e.id === 'remove' && f) remove(w, f, e.el);
    } else if (e.area === 'toolbar') {
      if (e.id === 'prev') go(w, -1);
      else if (e.id === 'next') go(w, 1);
      else if (e.id === 'info') { w.info = !w.info; drawInfo(w); w.frame.setToolbar(toolbar(w)); } else if (e.id === 'download' && f) download(w, f);
      else if (e.id === 'full') fullscreen(w);
      else if (e.id === 'share' && f) share(w, f, e.el);
    }
  }

  // ---- Share: the sheet of public/share-sheet.js, over the window ----------------------------------------------------------------------
  async function share(w, f, from) {
    const { shareFiles } = await import('/share-sheet.js');
    shareFiles({ doc, place: { module: w.place.module, space: w.place.space }, ids: [f.id], returnFocus: () => (w.dead ? null : from && from.isConnected ? from : w.frame.el) });
  }

  // ---- Rename and Remove: the same words as the Vault's list ------------------------------------------------------------------------------
  function rename(w, f, from) {
    const dlg = doc.createElement('dialog');
    dlg.className = 'sdk-editor fv-rename';
    dlg.setAttribute('aria-labelledby', 'fv-rename-title');
    const ext = f.name.includes('.') ? `.${f.name.split('.').pop()}` : '';
    dlg.innerHTML = '<form class="sdk-form" novalidate><h3 id="fv-rename-title">Rename the file</h3><label class="sdk-field"><span class="sdk-label">Name</span><input type="text" maxlength="120" autocomplete="off"><span class="sdk-hint"></span></label></form>';
    const form = dlg.querySelector('form');
    const input = dlg.querySelector('input');
    const hint = dlg.querySelector('.sdk-hint');
    input.value = f.name;
    hint.textContent = `Keep ${ext} at the end. A name can be 120 characters.`;
    const done = () => { dlg.close(); dlg.remove(); const back = w.dead ? null : (from && from.isConnected ? from : w.frame.el); if (back) back.focus({ preventScroll: true }); };
    // The shared action bar: Rename is off until the name changed; Cancel and Escape ask first when it was edited.
    const bar = actionBar({
      label: 'Rename the file',
      doc,
      saveLabel: 'Rename',
      submit: true,
      dirty: () => input.value.trim() !== f.name,
      onCancel: done,
      onSave: async () => {
        const name = input.value.trim().replace(/[\\/\u0000-\u001f]/g, '').slice(0, 120);
        if (!name) { input.setAttribute('aria-invalid', 'true'); hint.className = 'sdk-error'; hint.textContent = 'Give the file a name.'; return false; }
        try {
          const res = await api('PATCH', libUrl(w.place, `/${enc(f.id)}`), { name });
          if (res.file) w.files.set(f.id, res.file);
          done();
          if (!w.dead && w.id === f.id && res.file) { w.frame.setTitle(res.file.name, KINDS[kindOf(res.file)].icon); w.frame.setStatus({ text: statusOf(w, res.file) }); }
          showNote(`Renamed to ${res.file ? res.file.name : name}`);
          return true;
        } catch (err) {
          input.setAttribute('aria-invalid', 'true');
          hint.className = 'sdk-error';
          hint.textContent = err.message;
          return false;
        }
      },
    });
    form.append(bar.el);
    bar.bindEscape(dlg);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); bar.requestCancel(); });
    input.addEventListener('input', () => bar.refresh());
    form.addEventListener('submit', (e) => { e.preventDefault(); bar.save(); });
    doc.body.append(dlg);
    dlg.showModal();
    input.focus();
    input.select();
  }
  async function remove(w, f, from) {
    let found = { uses: [], hidden: 0 };
    let unknown = false;
    if (f.uses) {
      try { found = await api('GET', libUrl(w.place, `/${enc(f.id)}/uses`)); } catch { unknown = true; }
    }
    const lines = [];
    if (found.uses.length || found.hidden) {
      const list = found.uses.map((x) => `${x.title}${(x.module && x.module.name) || x.moduleName ? ` (${(x.module && x.module.name) || x.moduleName})` : ''}`).join(', ');
      lines.push(`Used in ${found.uses.length + found.hidden}: ${list}${found.hidden ? `${list ? ', and ' : ''}${found.hidden} you can't see` : ''}. The links will show File removed.`);
    } else if (unknown) lines.push('It is linked from other tools. The links will show File removed.');
    lines.push(`It is removed for everyone in this ${word('space')}. This can't be undone.`);
    const name = f.name.length > 60 ? `${f.name.slice(0, 59)}…` : f.name;
    const ok = await confirmDialog({ title: `Remove "${name}"?`, message: lines.join('\n\n'), action: 'Remove', kind: 'destructive' }, doc);
    if (from && from.isConnected && !ok) from.focus({ preventScroll: true });
    if (!ok) return;
    try {
      await api('DELETE', libUrl(w.place, `/${enc(f.id)}`));
    } catch (err) {
      if (err.status !== 404) { showNote(err.message); return; }
    }
    w.files.delete(f.id);
    showNote('File removed');
    const ids = walk(w);
    if (ids.length) show(w, ids[Math.min(Math.max(ids.indexOf(f.id), 0), ids.length - 1)] || ids[0]); else close(w);
  }

  // ---- Info -------------------------------------------------------------------------------------------------------------------------------
  function drawInfo(w) {
    if (w.infoSide) { w.infoSide.destroy(); w.infoSide.el.remove(); w.infoSide = null; }
    const f = w.files.get(w.id);
    w.main.classList.toggle('has-info', Boolean(w.info && f && !w.small));
    if (!w.info || !f || w.small) return;
    w.infoSide = infoView(f, {
      who: whoIs(w),
      uses: (file) => api('GET', libUrl(w.place, `/${enc(file.id)}/uses`)),
      open: w.openRef ? (summary) => w.openRef(summary.ref) : null,
      onClose: () => { w.info = false; drawInfo(w); w.frame.setToolbar(toolbar(w)); },
    });
    w.main.append(w.infoSide.el);
  }

  // ---- showing a file in a window ------------------------------------------------------------------------------------------------------
  function statusOf(w, f) {
    const by = f.by ? `${whoIs(w)(f)} · ${when(f.at)}` : '';
    return [`${KINDS[kindOf(f)].word} · ${size(f.size)}`, by].filter(Boolean).join(' · ');
  }
  function setBody(w, view) {
    if (w.view) w.view.destroy();
    w.view = view;
    const old = w.main.querySelector('.fv-view');
    if (old) old.replaceWith(view.el); else w.main.prepend(view.el);
  }
  function stateIn(w, opts) {
    w.broken = true;
    if (w.view) w.view.destroy();
    w.view = null;
    w.infoSide = null;
    for (const bar of w.body.querySelectorAll('.fv-dlbar')) bar.remove();
    w.main.replaceChildren();
    w.info = false;
    w.main.classList.remove('has-info');
    const s = viewState(opts);
    w.view = s;
    w.main.append(s.el);
    w.frame.setToolbar(toolbar(w));
    w.frame.setTitlebar({ actions: menuActions(w) });
    return s;
  }
  function show(w, id) {
    w.id = id;
    w.broken = false;
    w.missing = false;
    const f = w.files.get(id);
    if (!f) {
      w.frame.setTitle('File removed', 'file-circle-xmark');
      w.frame.setStatus({ text: '' });
      stateIn(w, { icon: 'file-circle-xmark', tone: 'warn', title: 'File removed', text: `This file is no longer in the ${moduleWord(w)}.` });
      return;
    }
    const k = KINDS[kindOf(f)];
    w.frame.setTitle(f.name, k.icon);
    const t = w.frame.el.querySelector('.mf-titlebar-title');
    if (t) t.title = f.name;
    w.frame.setStatus({ text: statusOf(w, f) });
    w.frame.setTitlebar({ actions: menuActions(w) });
    if (w.view) w.view.destroy();
    w.view = null;
    for (const bar of w.body.querySelectorAll('.fv-dlbar')) bar.remove();
    w.main.replaceChildren();
    const source = sourceFor(w);
    const apiFor = {
      win,
      replace: (view) => { if (w.dead || w.id !== id) return; w.broken = true; w.missing = Boolean(view.missing); if (w.missing) for (const bar of w.body.querySelectorAll('.fv-dlbar')) bar.remove(); setBody(w, view); w.frame.setToolbar(toolbar(w)); },
      fullscreen: () => fullscreen(w),
      escape: () => { if (!doc.fullscreenElement) close(w); },
    };
    const view = fileView(f, source, apiFor);
    w.view = view;
    w.main.append(view.el);
    // On a phone Download is a large button under the file (the toolbar's is hidden there); a download-only PDF has its own.
    if (can(w, 'download') && f.viewable !== false) {
      const bar = h('div', 'fv-dlbar');
      const b = h('button', 'btn btn-primary fv-dlbig');
      b.type = 'button';
      b.innerHTML = '<i class="fa-solid fa-download fa-fw" aria-hidden="true"></i><span class="fv-btn-word">Download</span>';
      b.addEventListener('click', () => download(w, f));
      bar.append(b);
      w.body.append(bar);
    }
    w.frame.setToolbar(toolbar(w));
    drawInfo(w);
  }

  function keys(w, e) {
    const p = (e.composedPath && e.composedPath()[0]) || e.target;
    const typing = p && p.closest && p.closest('input, textarea, audio, video, select');
    if (e.key === 'Escape') {
      if (doc.fullscreenElement || e.defaultPrevented) return;
      if (typing && p.closest('input, textarea')) return;
      close(w);
      e.stopPropagation();
      return;
    }
    if (typing || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (p && p.closest && p.closest('.fv-pic.is-zoomed, .fv-md, .fv-pdf, button, [role="toolbar"], [role="menu"]')) return;
    if (e.key === 'ArrowLeft') { go(w, -1); e.preventDefault(); } else if (e.key === 'ArrowRight') { go(w, 1); e.preventDefault(); }
  }

  // Load what a window shows: the library's records and the person's rights in that place, then the file.
  async function load(w, id) {
    try {
      const [cx, list] = await Promise.all([contextOf(w.place), api('GET', libUrl(w.place)), loadPeople()]);
      if (w.dead) return;
      w.cx = cx;
      w.files = new Map(list.files.map((f) => [f.id, f]));
      show(w, id);
    } catch (err) {
      if (w.dead) return;
      w.frame.setTitle('File', 'file');
      const retry = h('button', 'btn btn-small', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', () => { stateIn(w, { busy: true, title: 'Opening…' }); load(w, id); });
      // Not allowed or not there: a plain sentence and no Try again. Anything else may pass, so it can be tried again.
      if (err.status === 403 || err.status === 404) stateIn(w, { icon: 'triangle-exclamation', tone: 'warn', title: 'You can\'t open this file.', text: `It is in ${word('space', { a: true })} you are not in, or it is gone.` });
      else stateIn(w, { icon: 'triangle-exclamation', tone: 'warn', title: 'This file could not be opened.', text: err.message, actions: [retry] });
    }
  }

  // spec: { ref, ids, name, returnFocus, openRef }
  async function open(spec) {
    const ref = spec.ref;
    const place = { module: ref.module, space: ref.space };
    const same = (w) => w.place.module === place.module && w.place.space === place.space && w.id === ref.id;
    const key = `${place.module}/${place.space}/${ref.id}`;
    const known = wins.find(same);
    if (known) { front(known); known.frame.el.focus({ preventScroll: true }); return true; }
    // The stylesheet may still be loading: a second open of the same file (a double-click) waits on the first, not a window of its own.
    if (pending.has(key)) return true;
    pending.add(key);
    try {
      await loadStyles(doc);
      return openNow(spec, place, same);
    } finally { pending.delete(key); }
  }
  function openNow(spec, place, same) {
    const ref = spec.ref;
    const known = wins.find(same);
    if (known) { front(known); known.frame.el.focus({ preventScroll: true }); return true; }
    if (phone() && wins.length) {
      // One at a time on a phone: a new file replaces the one shown.
      const w = wins[0];
      Object.assign(w, { place, ids: spec.ids || null, returnFocus: spec.returnFocus, openRef: spec.openRef, files: new Map(), cx: null });
      w.frame.setTitle(spec.name || 'Opening…', 'file');
      w.frame.setStatus({ text: '' });
      stateIn(w, { busy: true, title: 'Opening…' });
      w.id = ref.id;
      load(w, ref.id);
      return true;
    }
    if (wins.length >= MAX_WINDOWS) {
      showNote(CAP_TITLE, CAP_SENTENCE);
      const top = topWindow();
      if (top) top.frame.el.focus({ preventScroll: true });
      return false;
    }
    ensureLayer();
    const w = { place, id: ref.id, ids: spec.ids || null, files: new Map(), cx: null, info: false, z: 0, returnFocus: spec.returnFocus, openRef: spec.openRef, dead: false, broken: false };
    w.el = h('div', 'fv-win');
    w.main = h('div', 'fv-main');
    const body = h('div', 'fv-body');
    body.append(w.main);
    w.body = body;
    w.frame = createModuleFrame({
      document: doc,
      title: spec.name || 'Opening…', icon: 'file', tint: 'blue', variant: 'window',
      titlebar: { close: true, standard: { window: false, popout: false }, actions: [{ id: 'closeall', label: 'Close all', icon: 'xmark', placement: 'menu' }] },
      toolbar: [], content: body, flush: true, status: { text: '' },
      onAction: (e) => act(w, e),
    });
    w.el.append(w.frame.el);
    wireDrag(w);
    w.frame.el.tabIndex = -1;
    w.z = ++z;
    wins.push(w);
    place_(w);
    layer.append(w.el);
    front(w);
    w.el.addEventListener('pointerdown', () => { if (!w.el.classList.contains('is-front')) front(w); });
    w.el.addEventListener('focusin', () => { if (!w.el.classList.contains('is-front')) front(w); });
    w.el.addEventListener('keydown', (e) => keys(w, e));
    stateIn(w, { busy: true, title: 'Opening…' });
    w.frame.el.focus({ preventScroll: true });
    load(w, ref.id);
    return true;
  }
  const place_ = (w) => place(w, wins.indexOf(w));

  // The window changing size: a phone has one sheet; wider, each window is kept inside the page.
  let wasPhone = phone();
  win.addEventListener('resize', () => {
    const p = phone();
    if (p && !wasPhone) for (const w of wins.slice(0, -1)) close(w, { focus: false });
    wasPhone = p;
    for (const w of wins) { place_(w); w.frame.setToolbar(toolbar(w)); }
  });

  return { wins, open, closeAll };
}

