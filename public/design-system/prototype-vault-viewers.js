// The Prototype's Vault viewers (Thomas, 2026-11-02; design-process only): a picture (zoom, pan, full screen), audio and video with the browser's
// own controls, Markdown through the SDK's own renderer, the PDF viewer (drawn: pdf.js is not shipped on this page), a PDF kept as download
// only, a file the browser cannot play, a file whose bytes are missing, and the info panel. Each returns the stage the module's viewer shows
// under its top row.
import { KINDS, USES, MARKDOWN, artFull, art, sampleAudio, sampleVideo, PEOPLE } from './prototype-vault-data.js';
import { D, h, fa, btn, iconBtn, size, when, dayWords, clock, who, plural } from './prototype-vault-ui.js';

// A state in the stage: an icon, a title, a line and the buttons (the States family's empty state).
export function stageState({ icon, title, text, tone, actions = [] }) {
  const s = h('div', 'vt-stage vt-state');
  const box = h('div', 'sdk-empty');
  const i = fa(icon);
  if (tone) i.dataset.tone = tone;
  box.append(i, h('p', 'sdk-empty-title', title));
  if (text) box.append(h('p', 'sdk-empty-text', text));
  if (actions.length) { const a = h('div', 'sdk-empty-actions'); a.append(...actions); box.append(a); }
  s.append(box);
  return s;
}

export function pictureStage(f, api) {
  const stage = h('div', 'vt-stage vt-pic');
  stage.tabIndex = 0;
  stage.setAttribute('role', 'group');
  stage.setAttribute('aria-label', `${f.name}. Use plus and minus to zoom, the arrow keys to move.`);
  const { url } = artFull(f);
  const wrap = h('div', 'vt-pic-wrap');
  const img = h('img');
  img.src = url;
  img.alt = f.name;
  img.draggable = false;
  wrap.append(img);
  let z = 1, x = 0, y = 0;
  const level = btn('btn btn-small btn-quiet vt-zoom-level', { label: '100%', tip: 'Fit to window' });
  const apply = () => {
    img.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    level.querySelector('.vt-btn-word').textContent = z === 1 ? 'Fit' : `${Math.round(z * 100)}%`;
    stage.classList.toggle('is-zoomed', z > 1);
    out.disabled = z <= 1;
    inn.disabled = z >= 4;
  };
  const set = (nz) => { z = Math.max(1, Math.min(4, nz)); if (z === 1) { x = 0; y = 0; } apply(); };
  const out = iconBtn('magnifying-glass-minus', 'Zoom out', 'vt-over');
  const inn = iconBtn('magnifying-glass-plus', 'Zoom in', 'vt-over');
  const full = iconBtn('expand', 'Full screen', 'vt-over');
  out.addEventListener('click', () => set(z - 0.5));
  inn.addEventListener('click', () => set(z + 0.5));
  level.addEventListener('click', () => set(1));
  full.addEventListener('click', () => { if (D.fullscreenElement) D.exitFullscreen(); else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {}); });
  const bar = h('div', 'vt-zoombar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Zoom');
  bar.append(out, level, inn, full);
  stage.append(wrap, bar);
  wrap.addEventListener('wheel', (e) => { e.preventDefault(); set(z + (e.deltaY < 0 ? 0.25 : -0.25)); }, { passive: false });
  wrap.addEventListener('dblclick', () => set(z > 1 ? 1 : 2));
  let drag = null;
  wrap.addEventListener('pointerdown', (e) => { if (z <= 1) return; drag = { px: e.clientX, py: e.clientY, x, y }; wrap.setPointerCapture(e.pointerId); wrap.classList.add('is-dragging'); });
  wrap.addEventListener('pointermove', (e) => { if (!drag) return; x = drag.x + e.clientX - drag.px; y = drag.y + e.clientY - drag.py; apply(); });
  const end = () => { drag = null; wrap.classList.remove('is-dragging'); };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
  stage.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') set(z + 0.5);
    else if (e.key === '-') set(z - 0.5);
    else if (e.key === '0') set(1);
    else if (z > 1 && e.key.startsWith('Arrow')) { const d = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[e.key]; x += d[0]; y += d[1]; apply(); e.preventDefault(); } else return;
    e.stopPropagation();
  });
  apply();
  return stage;
}

export function audioStage(f) {
  const stage = h('div', 'vt-stage vt-audio');
  const tile = h('span', 'vt-audio-tile');
  tile.dataset.tint = KINDS.audio.tint;
  tile.append(fa('file-audio'));
  const player = h('audio');
  player.controls = true;
  player.preload = 'metadata';
  player.src = sampleAudio();
  player.setAttribute('aria-label', f.name);
  stage.append(tile, h('p', 'vt-audio-name', f.name), h('p', 'vt-audio-meta', `${clock(f.dur)} · ${size(f.size)}`), player);
  return stage;
}

export function videoStage(f, api) {
  if (f.codec) {
    return stageState({
      icon: 'file-video', title: "This browser can't play this file.",
      text: `It is a ${f.codec} video. Safari plays it; other browsers may not. The Vault keeps it as it was sent.`,
      actions: api.can('download') ? [api.downloadButton(f, true)] : [],
    });
  }
  const stage = h('div', 'vt-stage vt-video');
  const v = h('video');
  v.controls = true;
  v.playsInline = true;
  v.preload = 'metadata';
  v.poster = art(f, 640, 360);
  v.setAttribute('aria-label', f.name);
  sampleVideo().then((u) => { if (u) v.src = u; });
  stage.append(v);
  return stage;
}

export function markdownStage(f) {
  const stage = h('div', 'vt-stage vt-md-stage');
  const page = h('article', 'vt-md');
  page.tabIndex = 0;
  page.setAttribute('aria-label', f.name);
  const text = MARKDOWN[f.md] || '';
  page.innerHTML = window.hostText && window.hostText.markdown ? window.hostText.markdown(text) : '';
  if (!page.innerHTML) page.textContent = text;
  stage.append(page);
  return stage;
}

// ---- a PDF page, drawn on a canvas in the document's own colours (paper) ----
function drawPage(canvas, f, n, pages) {
  const w = 612, hgt = 792, ctx = canvas.getContext('2d');
  canvas.width = w * 2; canvas.height = hgt * 2;
  ctx.scale(2, 2);
  ctx.fillStyle = 'hsl(45 25% 98%)'; ctx.fillRect(0, 0, w, hgt);
  ctx.fillStyle = 'hsl(215 30% 30%)'; ctx.fillRect(0, 0, w, 54);
  ctx.fillStyle = 'hsl(45 25% 98%)'; ctx.font = '600 20px sans-serif'; ctx.fillText(f.name.replace(/\.pdf$/i, ''), 36, 34);
  ctx.fillStyle = 'hsl(215 15% 25%)'; ctx.font = '12px sans-serif';
  const bars = (x, y, count, wide) => { for (let i = 0; i < count; i += 1) { ctx.fillStyle = 'hsl(215 10% 78%)'; ctx.fillRect(x, y + i * 18, wide * (0.55 + ((i * 37 + n * 11) % 45) / 100), 7); } };
  ctx.font = '600 14px sans-serif'; ctx.fillStyle = 'hsl(215 15% 25%)';
  ctx.fillText(n === 1 ? 'Booking details' : `Details, part ${n}`, 36, 92);
  bars(36, 106, 9, 540);
  ctx.fillStyle = 'hsl(215 15% 25%)'; ctx.font = '600 14px sans-serif'; ctx.fillText('Reference', 36, 300); ctx.fillStyle = 'hsl(215 20% 90%)'; ctx.fillRect(36, 310, 250, 44);
  ctx.fillStyle = 'hsl(215 15% 25%)'; ctx.font = '600 18px monospace'; ctx.fillText('RM-48213-X', 50, 338);
  if (/ticket|pass|flight/i.test(f.name)) {
    ctx.fillStyle = 'hsl(215 15% 15%)';
    for (let i = 0; i < 46; i += 1) ctx.fillRect(330 + i * 5, 300, 1 + (i * 7 % 3), 58);
  }
  bars(36, 390, 12, 540);
  ctx.font = '11px sans-serif'; ctx.fillStyle = 'hsl(215 10% 45%)'; ctx.fillText(`Page ${n} of ${pages}`, w / 2 - 28, hgt - 24);
}

export function pdfStage(f, api) {
  const stage = h('div', 'vt-stage vt-pdf');
  const pages = f.pages || 1;
  let page = 1, z = 1, searching = false;
  const bar = h('div', 'vt-pdfbar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'PDF controls');
  const prev = iconBtn('chevron-left', 'Previous page');
  const next = iconBtn('chevron-right', 'Next page');
  const num = h('input', 'vt-pdf-page');
  num.type = 'text'; num.inputMode = 'numeric'; num.value = '1'; num.setAttribute('aria-label', 'Page number');
  const total = h('span', 'vt-pdf-of', `of ${pages}`);
  const out = iconBtn('magnifying-glass-minus', 'Zoom out');
  const inn = iconBtn('magnifying-glass-plus', 'Zoom in');
  const level = btn('btn btn-small btn-quiet vt-zoom-level', { label: 'Fit width', tip: 'Fit to width' });
  const find = iconBtn('magnifying-glass', 'Search in the PDF');
  const full = iconBtn('expand', 'Full screen');
  const sep = () => h('span', 'vt-sep');
  const searchBox = h('div', 'vt-pdf-search');
  const q = h('input'); q.type = 'search'; q.placeholder = 'Search in the PDF'; q.setAttribute('aria-label', 'Search in the PDF');
  const count = h('span', 'vt-pdf-count', '');
  const sPrev = iconBtn('chevron-up', 'Previous match');
  const sNext = iconBtn('chevron-down', 'Next match');
  const sClose = iconBtn('xmark', 'Close search');
  searchBox.append(q, count, sPrev, sNext, sClose);
  searchBox.hidden = true;
  const left = h('div', 'vt-pdfbar-group'); left.append(prev, num, total, next);
  const mid = h('div', 'vt-pdfbar-group'); mid.append(out, level, inn);
  const right = h('div', 'vt-pdfbar-group'); if (api.trial.pdfSearch) right.append(find); right.append(full);
  bar.append(left, sep(), mid, h('span', 'vt-pdfbar-fill'), right);
  const scroller = h('div', 'vt-pdf-pages');
  scroller.tabIndex = 0;
  scroller.setAttribute('aria-label', `${f.name}, ${plural(pages, 'page')}`);
  const canvases = [];
  for (let i = 1; i <= pages; i += 1) {
    const c = h('canvas', 'vt-pdf-canvas');
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', `Page ${i}`);
    drawPage(c, f, i, pages);
    scroller.append(c);
    canvases.push(c);
  }
  const apply = () => {
    for (const c of canvases) c.style.width = z === 0 ? '' : `${Math.round(612 * z)}px`;
    level.querySelector('.vt-btn-word').textContent = z === 0 ? 'Fit width' : `${Math.round(z * 100)}%`;
    scroller.classList.toggle('is-fit', z === 0);
    prev.disabled = page <= 1; next.disabled = page >= pages;
    num.value = String(page);
  };
  const go = (n) => { page = Math.max(1, Math.min(pages, n)); apply(); canvases[page - 1].scrollIntoView({ block: 'start' }); };
  prev.addEventListener('click', () => go(page - 1));
  next.addEventListener('click', () => go(page + 1));
  num.addEventListener('change', () => go(parseInt(num.value, 10) || 1));
  out.addEventListener('click', () => { z = Math.max(0.5, (z || 1) - 0.25); apply(); });
  inn.addEventListener('click', () => { z = Math.min(3, (z || 1) + 0.25); apply(); });
  level.addEventListener('click', () => { z = 0; apply(); });
  full.addEventListener('click', () => { if (D.fullscreenElement) D.exitFullscreen(); else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {}); });
  const showSearch = (on) => { searching = on; searchBox.hidden = !on; if (on) q.focus(); else find.focus(); };
  find.addEventListener('click', () => showSearch(!searching));
  sClose.addEventListener('click', () => showSearch(false));
  q.addEventListener('input', () => { count.textContent = q.value ? '1 of 3' : ''; });
  scroller.addEventListener('scroll', () => {
    const top = scroller.getBoundingClientRect().top;
    let best = 1;
    canvases.forEach((c, i) => { if (c.getBoundingClientRect().top - top < scroller.clientHeight / 2) best = i + 1; });
    if (best !== page) { page = best; apply(); }
  });
  stage.append(bar, searchBox, scroller);
  z = 0;
  apply();
  return stage;
}

// The info panel: what the record holds, and where the file is used.
export function infoPanel(f, api) {
  const box = h('aside', 'vt-info');
  box.setAttribute('aria-label', 'Information about this file');
  const head = h('div', 'vt-info-head');
  head.append(h('h3', 'vt-info-title', 'Info'), iconBtn('xmark', 'Close info'));
  head.lastChild.addEventListener('click', () => api.info(false));
  const dl = h('dl', 'vt-info-list');
  const row = (k, v) => { if (v === undefined || v === null || v === '') return; dl.append(h('dt', '', k), h('dd', '', v)); };
  row('Name', f.name);
  row('Type', `${KINDS[f.kind].word} · ${f.type}`);
  row('Size', size(f.size));
  row('Added by', who(f.by));
  row('Added', dayWords(f.at));
  if (f.taken) row('Taken', dayWords(f.taken));
  if (f.camera) row('Camera', f.camera);
  if (f.w) row('Dimensions', `${f.w} × ${f.h}`);
  if (f.dur) row('Length', clock(f.dur));
  if (f.pages) row('Pages', String(f.pages));
  row('Shared', f.shared ? 'In a share link' : 'Not shared');
  box.append(head, dl);
  const uses = USES[f.id];
  const u = h('div', 'vt-info-uses');
  u.append(h('h4', 'vt-info-sub', 'Used in'));
  if (!uses) u.append(h('p', 'vt-info-none', 'Not linked from anywhere.'));
  else {
    const ul = h('ul', 'vt-uses');
    for (const x of uses.list) { const li = h('li'); li.append(h('b', '', x.title), h('span', '', ` · ${x.module}`)); ul.append(li); }
    u.append(ul);
    if (uses.hidden) u.append(h('p', 'vt-info-none', `and ${uses.hidden} more you can't see`));
  }
  box.append(u);
  return box;
}
