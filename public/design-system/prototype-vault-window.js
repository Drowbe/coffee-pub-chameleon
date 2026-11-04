// The Prototype's Vault viewer window (Thomas, 2026-11-03; design-process only, nothing here ships). A file opens in one of the app's own windows
// (the module frame, variant 'window', as the Workspace draws a module window), never inside the Vault panel and never in a new browser window.
// The same window opens when another module links to a file, over the canvas, without bringing the Vault forward. Several can be open at once
// (each file its own window, at most four); at phone width one at a time, a full-screen sheet, and a new file replaces the one shown.
//
// createCanvas draws the canvas: whatever is under (the Vault panel, a Planner card) and the windows over it. The window's title is the file's
// name; its toolbar is Previous, Next, where it is in the list, Info, Download, Share and Full screen (the host's). Esc closes the window that
// has the focus, and the focus goes back to what opened it. A window moves by its title bar and resizes by its grip, as the Workspace's do (no keyboard moves
// there either), and stays inside the canvas; at phone width it is a fixed sheet.
import { createModuleFrame } from '/module-frame.js';
import { openHostMenu } from '/host-menu.js';
import { KINDS } from './prototype-vault-data.js';
import { D, h, fa, btn, size, when, who, inShadow, stopMedia } from './prototype-vault-ui.js';
import { pictureView, audioView, videoView, markdownView, pdfView, viewState, infoView } from './prototype-vault-viewers.js';

export const MAX_WINDOWS = 4;
export const CAP_SENTENCE = 'Close a window to open another.';
const PHONE = 640;

export function createCanvas() {
  const el = h('div', 'vt-canvas');
  const under = h('div', 'vt-canvas-under');
  const layer = h('div', 'vt-canvas-layer');
  const toasts = h('div', 'vt-toastlayer vt-canvas-toasts');
  toasts.setAttribute('aria-live', 'polite');
  // The canvas's own Layout menu, drawn small: Close all file windows. (In the product it is the space bar's Layout menu.)
  const bar = h('div', 'vt-canvas-bar');
  const layout = btn('btn btn-small', { label: 'Layout', icon: 'table-cells-large' });
  layout.setAttribute('aria-haspopup', 'menu');
  layout.addEventListener('click', () => openHostMenu(layout, () => [{ label: wins.length ? `Close all file windows (${wins.length})` : 'No file windows open', icon: 'xmark', disabled: !wins.length, onPick: () => closeAll() }]));
  bar.append(layout);
  el.append(under, layer, bar, toasts);

  const wins = [];
  let z = 10;
  // The canvas's size is remembered from its observer, so opening a window does not make the page measure itself again (each measuring is a full style pass here).
  let seenW = 0, seenH = 0;
  const canvasW = () => seenW || el.clientWidth || 1100;
  const canvasH = () => seenH || el.clientHeight || 640;
  const phone = () => canvasW() <= PHONE;

  // `only` names a toast that replaces the one before it with the same name (the cap's), so it never stacks.
  function toast(title, text, icon = 'check', kind = 'ok', only = '') {
    if (only) for (const old of toasts.querySelectorAll(`[data-only="${only}"]`)) old.remove();
    const t = h('div', 'sdk-toast vt-toast');
    if (only) t.dataset.only = only;
    t.dataset.kind = kind;
    const ic = h('span', 'sdk-toast-icon'); ic.append(fa(icon));
    const body = h('div', 'sdk-toast-body'); body.append(h('span', 'sdk-toast-title', title));
    if (text) body.append(h('span', 'sdk-toast-text', text));
    t.append(ic, body);
    toasts.append(t);
    setTimeout(() => t.remove(), 3600);
  }

  // A window starts cascaded from an offset and can then be moved and resized (as the Workspace's windows are, canvas.js wireFloating);
  // once the person has, it keeps its box and is only kept inside the canvas.
  const MIN_W = 240, MIN_H = 160;
  function putBox(w, b) {
    const sw = canvasW(), sh = canvasH();
    const width = Math.min(Math.max(b.w, MIN_W), Math.max(MIN_W, sw));
    const height = Math.min(Math.max(b.h, MIN_H), Math.max(MIN_H, sh));
    const x = Math.min(Math.max(b.x, 0), Math.max(0, sw - width));
    const y = Math.min(Math.max(b.y, 0), Math.max(0, sh - height));
    w.el.style.cssText = `z-index:${w.z};left:${x}px;top:${y}px;width:${width}px;height:${height}px`;
    return { x, y, w: width, h: height };
  }
  const boxOf = (w) => ({ x: w.el.offsetLeft, y: w.el.offsetTop, w: w.el.offsetWidth, h: w.el.offsetHeight });
  function wireDrag(w) {
    const grip = h('span', 'vt-win-grip');
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
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
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
  function place(w, n) {
    if (phone()) { w.el.style.cssText = `z-index:${w.z}`; return; }
    if (w.user) { putBox(w, boxOf(w)); return; }
    const sw = canvasW(), sh = canvasH();
    const width = Math.round(Math.max(380, Math.min(680, sw * 0.52)));
    const left = Math.round(Math.min(sw - width - 16, Math.max(16, sw * 0.18) + n * width * 0.72));
    const top = 40 + n * 28;
    putBox(w, { x: left, y: top, w: width, h: Math.max(300, sh - top - 24) });
  }
  function front(w) {
    z += 1; w.z = z;
    w.el.style.zIndex = String(z);
    for (const x of wins) x.el.classList.toggle('is-front', x === w);
  }

  function close(w, { focus = true } = {}) {
    const at = wins.indexOf(w);
    if (at < 0) return;
    wins.splice(at, 1);
    stopMedia(w.el);
    if (w.frame.destroy) w.frame.destroy();
    w.el.remove();
    if (wins.length) front(wins.reduce((a, b) => (b.z > a.z ? b : a)));
    if (!focus) return;
    const back = w.returnFocus && w.returnFocus();
    if (back && back.isConnected !== false) back.focus({ preventScroll: true });
    else if (wins.length) wins[wins.length - 1].el.querySelector('.mf').focus({ preventScroll: true });
  }
  function closeAll() {
    for (const w of [...wins].reverse()) close(w, { focus: false });
    layout.focus({ preventScroll: true });
  }

  // spec: { id, list: [files to walk], ctx, returnFocus: () => element, note?: (file) => words for the status line }
  function open(spec) {
    const known = wins.find((w) => w.id === spec.id);
    if (known && !phone()) { front(known); known.el.querySelector('.mf').focus({ preventScroll: true }); return known; }
    if (phone() && wins.length) {
      // one at a time on a phone: a new file replaces the one shown
      const w = wins[0];
      Object.assign(w, { list: spec.list, ctx: spec.ctx, note: spec.note, returnFocus: spec.returnFocus });
      show(w, spec.id);
      return w;
    }
    if (wins.length >= MAX_WINDOWS) {
      toast('Four windows are open', CAP_SENTENCE, 'circle-info', 'warn', 'cap');
      const top = wins.reduce((a, b) => (b.z > a.z ? b : a));
      top.el.querySelector('.mf').focus({ preventScroll: true });
      return null;
    }
    const w = { id: spec.id, list: spec.list, ctx: spec.ctx, note: spec.note, returnFocus: spec.returnFocus, info: Boolean(spec.info), z: 0 };
    w.el = h('div', 'vt-win');
    w.body = h('div', 'vt-wbody');
    const f0 = cur(w);
    // The window is drawn whole before it is in the page (title, toolbar, status, file), so the page measures it once.
    w.frame = createModuleFrame({
      title: f0.name, icon: KINDS[f0.kind].icon, tint: 'blue', variant: 'window',
      titlebar: { close: true, standard: { window: false, popout: false } },
      toolbar: toolbar(w), content: inShadow(w.body), flush: true, status: { text: statusOf(w, f0) },
      onAction: (e) => act(w, e),
    });
    w.el.append(w.frame.el);
    wireDrag(w);
    w.frame.el.tabIndex = -1;
    w.z = ++z;
    show(w, spec.id, true);
    wins.push(w);
    place(w, wins.length - 1);
    front(w);
    layer.append(w.el);
    w.el.addEventListener('pointerdown', () => { if (!w.el.classList.contains('is-front')) front(w); });
    w.el.addEventListener('focusin', () => { if (!w.el.classList.contains('is-front')) front(w); });
    w.el.addEventListener('keydown', (e) => keys(w, e));
    w.frame.el.focus({ preventScroll: true });
    return w;
  }

  const at = (w) => w.list.findIndex((x) => x.id === w.id);
  const cur = (w) => w.list.find((x) => x.id === w.id) || w.list[0];
  function go(w, dir) { const i = at(w) + dir; if (i >= 0 && i < w.list.length) show(w, w.list[i].id); }

  function act(w, e) {
    if (e.area === 'titlebar' && e.id === 'close') close(w);
    else if (e.area === 'toolbar') {
      const f = cur(w);
      if (e.id === 'prev') go(w, -1);
      else if (e.id === 'next') go(w, 1);
      else if (e.id === 'info') { w.info = !w.info; drawInfo(w); w.frame.setToolbar(toolbar(w)); }
      else if (e.id === 'download') toast('Download started', f.name, 'download');
      else if (e.id === 'share') w.ctx.share(f);
      else if (e.id === 'full') { const t = w.frame.el; if (D.fullscreenElement) D.exitFullscreen(); else if (t.requestFullscreen) t.requestFullscreen().catch(() => {}); }
    }
  }
  function keys(w, e) {
    const p = (e.composedPath && e.composedPath()[0]) || e.target;
    const typing = p && p.closest && p.closest('input, textarea, audio, video, select');
    if (e.key === 'Escape') { if (D.fullscreenElement || typing) return; close(w); e.stopPropagation(); return; }
    if (typing || e.altKey || e.ctrlKey || e.metaKey) return;
    if (p && p.closest && p.closest('.vt-pic.is-zoomed, .vt-pdf-pages, .vt-md, button, [role="toolbar"]')) return;
    if (e.key === 'ArrowLeft') go(w, -1);
    else if (e.key === 'ArrowRight') go(w, 1);
  }

  function toolbar(w) {
    const f = cur(w);
    const i = at(w);
    const many = w.list.length > 1;
    const list = [];
    if (many) {
      list.push({ type: 'button', id: 'prev', label: 'Previous file', icon: 'chevron-left', kind: 'icon', disabled: i <= 0 });
      list.push({ type: 'button', id: 'next', label: 'Next file', icon: 'chevron-right', kind: 'icon', disabled: i >= w.list.length - 1 });
      list.push({ type: 'text', text: `${i + 1} of ${w.list.length}` });
    }
    list.push({ type: 'button', id: 'info', label: 'Info', icon: 'circle-info', kind: 'icon', on: w.info, tip: w.info ? 'Hide info' : 'Show info' });
    // The right zone (the frame's end zone, as the Calendar's panel switch): Download, Share, Full screen, right-justified to the
    // window's edge and pinned, so they never move into More; the left zone's controls are the ones that fold.
    const end = (it) => ({ ...it, zone: 'end', pin: true });
    const usable = !f.missing && f.viewable !== false;
    if (w.ctx.can('download') && !f.missing && !phone()) list.push(end({ type: 'button', id: 'download', label: 'Download', icon: 'download', kind: 'secondary' }));
    if (w.ctx.can('share') && !f.missing) list.push(end({ type: 'button', id: 'share', label: 'Share', icon: 'share-nodes', kind: 'secondary' }));
    if (usable) list.push(end({ type: 'button', id: 'full', label: 'Full screen', icon: 'expand', kind: 'icon' }));
    return list;
  }

  function viewFor(w, f) {
    const { ctx } = w;
    const dl = (ff, primary = false) => { const b = btn(`btn btn-small${primary ? ' btn-primary' : ''}`, { label: 'Download', icon: 'download' }); b.addEventListener('click', () => toast('Download started', ff.name, 'download')); return b; };
    const api = { can: ctx.can, downloadButton: dl, trial: { pdfSearch: ctx.pdfSearch }, info: () => {} };
    if (f.missing) {
      const acts = [];
      if (ctx.canRemove(f)) { const b = btn('btn btn-danger', { label: 'Remove', icon: 'trash' }); b.addEventListener('click', () => ctx.remove(f, () => close(w))); acts.push(b); }
      return viewState({ icon: 'file-circle-exclamation', tone: 'warn', title: 'File missing', text: `The file itself is not on the server. This can happen after a restore. Remove it from the ${ctx.words.module}, or ask the admin to restore the ${ctx.words.module} folder.`, actions: acts });
    }
    if (f.kind === 'picture') return pictureView(f, api);
    if (f.kind === 'audio') return audioView(f, api);
    if (f.kind === 'video') return videoView(f, api);
    if (f.kind === 'text') return markdownView(f, api);
    if (f.viewable === false) return viewState({ icon: 'file-circle-exclamation', tone: 'warn', title: "This PDF can't be opened here. Download it.", text: `${ctx.words.module} could not check this file, so it is kept for download only. Your own PDF reader opens it.`, actions: ctx.can('download') ? [dl(f, true)] : [] });
    return pdfView(f, api);
  }

  function drawInfo(w) {
    const old = w.main.querySelector('.vt-info');
    if (old) old.remove();
    w.main.classList.toggle('has-info', w.info);
    if (w.info) w.main.append(infoView(cur(w), { info: (on) => { w.info = on; drawInfo(w); w.frame.setToolbar(toolbar(w)); } }));
  }

  function statusOf(w, f) {
    const by = f.by ? `${who(f.by)} · ${when(f.at)}` : '';
    return [w.note ? w.note(f) : '', `${KINDS[f.kind].word} · ${size(f.size)}`, by].filter(Boolean).join(' · ');
  }
  // `fresh`: the window was just made with this file's title, toolbar and status, and is not in the page yet.
  function show(w, id, fresh = false) {
    w.id = id;
    const f = cur(w);
    if (!fresh) {
      w.frame.setTitle(f.name, KINDS[f.kind].icon);
      w.frame.setToolbar(toolbar(w));
      w.frame.setStatus({ text: statusOf(w, f) });
    }
    const t = w.frame.el.querySelector('.mf-titlebar-title');
    if (t) t.title = f.name;
    stopMedia(w.body);
    w.body.textContent = '';
    w.main = h('div', 'vt-wmain');
    const shown = viewFor(w, f);
    w.main.append(shown);
    w.body.append(w.main);
    if (phone() && w.ctx.can('download') && !f.missing && f.viewable !== false) {
      const bar = h('div', 'vt-dlbar');
      const b = btn('btn btn-primary vt-dlbig', { label: 'Download', icon: 'download' });
      b.addEventListener('click', () => toast('Download started', f.name, 'download'));
      bar.append(b);
      w.body.append(bar);
    }
    drawInfo(w);
    if (!fresh) place(w, wins.indexOf(w));
  }

  let wasPhone = null;
  const ro = new ResizeObserver((entries) => {
    const r = entries[entries.length - 1].contentRect;
    seenW = Math.round(r.width); seenH = Math.round(r.height);
    const p = phone();
    if (wasPhone === null) { wasPhone = p; return; }
    if (p === wasPhone) { for (const w of wins) place(w, wins.indexOf(w)); return; }
    wasPhone = p;
    if (p) for (const w of wins.slice(0, -1)) close(w, { focus: false });
    for (const w of wins) { w.frame.setToolbar(toolbar(w)); show(w, w.id); }
  });
  ro.observe(el);

  return {
    el, under, open, closeAll, toast, windows: wins,
    destroy() { ro.disconnect(); for (const w of [...wins]) close(w, { focus: false }); },
  };
}
