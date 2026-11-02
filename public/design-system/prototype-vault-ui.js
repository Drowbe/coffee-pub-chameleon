// The Prototype's Vault: the small pieces (Thomas, 2026-11-02; design-process only, nothing here ships). A piece that does not exist in
// public/sdk/system.css yet is built here and marked in prototype-vault.css as "to system.css": the file chip, the file thumbnail and type
// tile, the file row and card, the upload row, the viewer frame.
import { KINDS, PEOPLE, NOW, MB, GB, art } from './prototype-vault-data.js';
import { openHostMenu, closeHostMenu } from '/host-menu.js';

export const D = document;
export function h(tag, cls, text) {
  const e = D.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
export function fa(name, cls = '') {
  const i = D.createElement('i');
  i.className = `fa-solid fa-${name} fa-fw${cls ? ` ${cls}` : ''}`;
  i.setAttribute('aria-hidden', 'true');
  return i;
}
export function btn(cls, { label, icon, tip, aria } = {}) {
  const b = h('button', cls);
  b.type = 'button';
  if (icon) b.append(fa(icon));
  if (label) b.append(h('span', 'vt-btn-word', label));
  if (aria || (!label && tip)) b.setAttribute('aria-label', aria || tip);
  if (tip) b.dataset.tip = tip;
  return b;
}
export const iconBtn = (icon, label, extra = '') => btn(`sdk-icon-btn btn-quiet btn-small${extra ? ` ${extra}` : ''}`, { icon, aria: label, tip: label });

// ---- the words: the shown name and the space word come from the template ----
export const WORDS = {
  vault: { id: 'vault', module: 'Vault', space: 'trip', icon: 'vault', empty: 'No files yet. Add tickets, photos and documents for this trip.' },
  documents: { id: 'documents', module: 'Documents', space: 'trip', icon: 'vault', empty: 'No files yet. Add tickets, photos and documents for this trip.' },
  handouts: { id: 'handouts', module: 'Handouts', space: 'campaign', icon: 'vault', empty: 'No files yet. Add maps, pictures and handouts for this campaign.' },
};

// ---- numbers and dates ----
const trim = (n, d) => String(Number(n.toFixed(d)));
export function size(bytes) {
  if (bytes >= GB) return `${trim(bytes / GB, bytes >= 10 * GB ? 0 : 1)} GB`;
  if (bytes >= MB) return `${trim(bytes / MB, bytes >= 100 * MB ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function when(iso, { long = false } = {}) {
  const d = new Date(iso);
  const days = Math.floor((NOW - d) / 86400000);
  if (!long && days <= 0) return 'Today';
  if (!long && days === 1) return 'Yesterday';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${d.getUTCFullYear() !== NOW.getUTCFullYear() ? ` ${d.getUTCFullYear()}` : ''}`;
}
export function dayWords(iso) { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
export function clock(sec) { const m = Math.floor(sec / 60); const s = Math.floor(sec % 60); return `${m}:${String(s).padStart(2, '0')}`; }
export const who = (by) => (PEOPLE[by] ? PEOPLE[by].name : by);
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

// ---- the file's look: a tile (type icon on a circle in the kind's tint) or its small picture ----
export function circleIcon(f, cls = '') {
  const k = KINDS[f.kind];
  const s = h('span', `sdk-card-icon vt-kind${cls ? ` ${cls}` : ''}`);
  s.dataset.tint = k.tint;
  s.append(fa(k.icon));
  return s;
}
// The file's picture: a square. Pictures and video have their small picture (a video a play mark and its length); the rest a type tile.
export function thumb(f, px = 192) {
  const k = KINDS[f.kind];
  const box = h('span', 'vt-thumb');
  box.dataset.kind = f.kind;
  box.dataset.tint = k.tint;
  if ((f.kind === 'picture' || f.kind === 'video') && !f.missing) {
    const img = h('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = art(f, px, px);
    box.append(img);
    if (f.kind === 'video') {
      const play = h('span', 'vt-play');
      play.append(fa('play'));
      box.classList.add('vt-has-play');
      box.append(play, h('span', 'vt-len', clockOf(f)));
    }
  } else {
    box.classList.add('vt-tile');
    box.append(fa(f.missing ? 'file-circle-exclamation' : k.icon));
  }
  return box;
}
export const clockOf = (f) => clock(f.dur || 0);

// ---- the file chip (to system.css as .sdk-file-chip): another module's card shows a file as this ----
export function fileChip(f, { state = 'ok', canEdit = false, onOpen, onRemove } = {}) {
  const wrap = h('span', 'vt-chipwrap');
  const kind = f ? KINDS[f.kind] : null;
  const c = h(state === 'ok' ? 'button' : 'span', 'sdk-chip-tag vt-chip');
  if (state === 'ok') c.type = 'button';
  c.dataset.state = state;
  if (state === 'ok' && kind) {
    c.dataset.tint = kind.tint;
    c.append(fa(kind.icon, 'vt-chip-ic'), h('span', 'vt-chip-name', f.name), h('span', 'vt-chip-size', size(f.size)));
    c.setAttribute('aria-label', `${f.name}, ${size(f.size)}. Open it in the Vault.`);
  } else if (state === 'removed') {
    c.append(fa('file-circle-xmark', 'vt-chip-ic'), h('span', 'vt-chip-state', 'File removed'));
  } else if (state === 'missing') {
    c.dataset.tone = 'warn';
    c.append(fa('triangle-exclamation', 'vt-chip-ic'), h('span', 'vt-chip-name', f.name), h('span', 'vt-chip-state', 'File missing'));
  } else if (state === 'hidden') {
    c.append(fa('lock', 'vt-chip-ic'), h('span', 'vt-chip-state', 'Not available to you'));
  }
  if (onOpen && state === 'ok') c.addEventListener('click', () => onOpen(f));
  wrap.append(c);
  if (canEdit && (state === 'removed' || state === 'missing')) {
    const r = btn('btn btn-small btn-quiet vt-chip-remove', { label: 'Remove link', icon: 'link-slash' });
    if (onRemove) r.addEventListener('click', () => onRemove(f));
    wrap.append(r);
  }
  return wrap;
}

// ---- one line for the people ----
export function personDot(by, px = 20) {
  const a = h('span', `sdk-avatar sdk-avatar-${px}`);
  a.append(h('span', 'sdk-avatar-ini', PEOPLE[by] && by !== 'gone' ? PEOPLE[by].name[0] : '?'));
  a.setAttribute('aria-hidden', 'true');
  return a;
}

// A held-open host menu: the real menu is opened once on its trigger, copied, and closed; the copy is placed in `box` (a picture).
export function heldMenu(box, trigger, items, { side = 'under' } = {}) {
  const sc = trigger.closest && trigger.closest('.vt-scroll');
  if (sc) { const r = trigger.getBoundingClientRect(); const b = sc.getBoundingClientRect(); sc.scrollTop += r.top - b.top - 70; }
  if (items) openHostMenu(trigger, items); else trigger.click();
  const real = D.querySelector('body > .host-menu') || D.querySelector('.host-menu');
  if (!real) return null;
  const copy = real.cloneNode(true);
  closeHostMenu();
  copy.classList.add('vt-held-menu');
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  copy.style.removeProperty('top'); copy.style.removeProperty('left'); copy.style.removeProperty('right'); copy.style.removeProperty('bottom');
  copy.style.maxHeight = 'none'; copy.style.position = 'absolute'; copy.style.visibility = 'visible';
  box.append(copy);
  const place = () => {
    const b = box.getBoundingClientRect();
    const t = trigger.getBoundingClientRect();
    const below = t.bottom - b.top + 4;
    const top = side === 'over' || below + copy.offsetHeight > b.height - 4 ? t.top - b.top - copy.offsetHeight - 4 : below;
    copy.style.top = `${Math.max(4, top + box.scrollTop)}px`;
    copy.style.left = `${Math.max(4, Math.min(b.width - copy.offsetWidth - 4, t.right - b.left - copy.offsetWidth + box.scrollLeft))}px`;
  };
  new ResizeObserver(place).observe(box);
  place();
  return copy;
}

// The product draws a module in its own frame (an iframe, or a shadow root for a bundled one) with the host's host.css and system.css, so the
// module frame's own rules (its buttons take the surrounding colour and size) never reach what a module draws. The Prototype draws the
// module in the page, so it does the same: the module's body goes in a shadow root with host.css, system.css, Font Awesome's glyph rules
// (the product's modules draw SVG icons) and this section's stylesheet.
const getText = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u} ${r.status}`); return r.text(); };
const scopeCss = (t) => t.replace(/@font-face\s*\{[^}]*\}/g, '').replace(/:root\s*\{[^}]*\}/g, '').replace(/(^|[\s,}])(html|body)(?=[\s,{.:[])/g, '$1:host');
const SHEET = await (async () => {
  const [host, system, fas, own] = await Promise.all([getText('/sdk/host.css'), getText('/sdk/system.css'), getText('/fa/css/all.min.css'), getText(new URL('prototype-vault.css', import.meta.url))]);
  const sheet = new CSSStyleSheet();
  sheet.replaceSync([scopeCss(host), scopeCss(system), scopeCss(fas), scopeCss(own)].join('\n'));
  return sheet;
})();
export function inShadow(node) {
  const host = D.createElement('div');
  host.className = 'vt-host';
  const root = host.attachShadow({ mode: 'open' });
  root.adoptedStyleSheets = [SHEET];
  root.append(node);
  return host;
}
