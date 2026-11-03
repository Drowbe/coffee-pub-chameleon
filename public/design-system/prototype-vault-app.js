// The Prototype's Vault module (Thomas, 2026-11-02; design-process only, nothing here ships): one function, createVault, draws the Vault in the
// real module frame (createModuleFrame): List and Grid, search, Filters, sorting, choosing several, the menus, Add files with its progress and
// its refusals, the viewers, and the permission views. The section (prototype-vault.js) draws it many times, each in a state, and once for
// trying. The sample is prototype-vault-data.js; nothing is fetched. Words and colours are the product's: SDK pieces first, and what is new
// is built in prototype-vault.css and marked "to system.css".
import { createModuleFrame } from '/module-frame.js';
import { openHostMenu } from '/host-menu.js';
import { FILES, KINDS, PEOPLE, USES, QUOTA, TOTAL_BYTES, NOW, MB, GB, byId } from './prototype-vault-data.js';
import { D, h, fa, btn, iconBtn, WORDS, size, when, clock, who, plural, circleIcon, thumb, personDot, inShadow } from './prototype-vault-ui.js';
import { stopMedia } from './prototype-vault-ui.js';
import { liveOpen, heldDialog, removeSheet, renameSheet, usesSheet, shareSheet, shareListSheet, sheet, cancelBtn, okBtn, turnOffShareSheet } from './prototype-vault-dialogs.js';

// What each role may do (plan, section 6): view, add, download, remove_any, share. A guest has none of them.
export const ROLES = {
  owner: { label: 'Owner', me: 'mia', view: 1, add: 1, download: 1, remove_any: 1, share: 1 },
  moderator: { label: 'Moderator', me: 'mia', view: 1, add: 1, download: 1, remove_any: 1, share: 1 },
  member: { label: 'Member', me: 'lee', view: 1, add: 1, download: 1 },
  'member-share': { label: 'Member with Share', me: 'lee', view: 1, add: 1, download: 1, share: 1 },
  'member-noadd': { label: 'Member who cannot add', me: 'lee', view: 1, download: 1 },
  'member-nodownload': { label: 'Member who cannot download', me: 'lee', view: 1, add: 1 },
  guest: { label: 'Guest', me: 'guest' },
  'guest-view': { label: 'Guest who may look (option)', me: 'guest', view: 1 },
};
// The choices the plan leaves open, drawn both ways. The section's switches change these, and every Vault is drawn again.
export const TRIAL = { words: 'vault', gridCard: 'banded', sort: 'filters', select: 'button', add: 'panel', pdfSearch: true, removeWhere: 'off', pdfDamaged: 'refused' };
export const instances = new Set();
export const redrawAll = () => { for (const v of instances) v.render(); };

const GROUP_WORD = { image: 'Pictures', audio: 'Audio', video: 'Video', document: 'Documents' };
const SORTS = [
  ['new', 'Newest first', (a, b) => (b.at > a.at ? 1 : -1)],
  ['old', 'Oldest first', (a, b) => (a.at > b.at ? 1 : -1)],
  ['name', 'Name, A to Z', (a, b) => a.name.localeCompare(b.name)],
  ['big', 'Largest first', (a, b) => b.size - a.size],
  ['kind', 'Type', (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)],
];
const ALLOWED = /\.(jpe?g|png|webp|gif|mp3|ogg|oga|wav|m4a|mp4|webm|mov|pdf|md)$/i;
export const TYPE_REFUSAL = "That kind of file can't go in the Vault. It takes pictures (JPEG, PNG, WebP, GIF), audio (MP3, OGG, WAV, M4A), video (MP4, WebM, MOV), PDF and Markdown.";
const kindOfName = (n) => { const e = n.split('.').pop().toLowerCase(); return ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(e) ? 'picture' : ['mp3', 'ogg', 'oga', 'wav', 'm4a'].includes(e) ? 'audio' : ['mp4', 'webm', 'mov'].includes(e) ? 'video' : e === 'pdf' ? 'pdf' : 'text'; };
const LIMIT = { picture: [25 * MB, '25 MB', 'picture'], audio: [200 * MB, '200 MB', 'audio'], video: [2 * GB, '2 GB', 'video'], pdf: [100 * MB, '100 MB', 'PDF'], text: [1 * MB, '1 MB', 'Markdown'] };

export function createVault(cfg = {}) {
  const role = cfg.role || 'member';
  const perm = ROLES[role];
  const st = {
    view: 'list', sort: 'new', query: '', types: new Set(), by: 'all', when: 'any', shared: new Set(), linked: new Set(),
    selecting: false, sel: new Set(), panel: false, queue: [], dropping: false,
    removed: new Set(), added: [], renamed: new Map(), notice: null, pdfOff: false, usedBytes: null, capBytes: QUOTA.space, ...cfg.state,
  };
  st.removed = new Set((cfg.state && cfg.state.removed) || []);
  st.queue = [...((cfg.state && cfg.state.queue) || [])];
  if (cfg.state && cfg.state.types) st.types = new Set(cfg.state.types);
  if (cfg.state && cfg.state.sel) st.sel = new Set(cfg.state.sel);
  if (cfg.state && cfg.state.shared) st.shared = new Set(cfg.state.shared);
  if (cfg.state && cfg.state.linked) st.linked = new Set(cfg.state.linked);
  const T = (k) => (cfg.trial && k in cfg.trial ? cfg.trial[k] : TRIAL[k]);
  const me = perm.me;
  const W = () => WORDS[T('words')];
  let frame = null;
  const app = h('div', 'vt-app');
  app.dataset.vault = '';
  const layer = h('div', 'vt-toastlayer');
  layer.setAttribute('aria-live', 'polite');

  // ---- the files, as the person sees them now ----
  const pool = () => (cfg.empty ? [] : [...st.added, ...FILES].filter((f) => !st.removed.has(f.id)).map((f) => (st.renamed.has(f.id) ? { ...f, name: st.renamed.get(f.id) } : f)));
  const matches = (f, q) => f.name.toLowerCase().includes(q) || who(f.by).toLowerCase().includes(q) || KINDS[f.kind].word.toLowerCase().includes(q);
  function filtered(list = pool()) {
    let out = list;
    if (st.types.size) out = out.filter((f) => st.types.has(f.group));
    if (st.by === 'mine') out = out.filter((f) => f.by === me);
    else if (st.by !== 'all') out = out.filter((f) => f.by === st.by);
    if (st.when !== 'any') {
      const age = (f) => (NOW - new Date(f.at)) / 86400000;
      out = out.filter((f) => (st.when === 'week' ? age(f) <= 7 : st.when === 'month' ? age(f) <= 30 : age(f) > 30));
    }
    if (st.shared.size === 1) out = out.filter((f) => (st.shared.has('shared') ? f.shared : !f.shared));
    if (st.linked.size === 1) out = out.filter((f) => (st.linked.has('linked') ? f.uses > 0 : !f.uses));
    const q = st.query.trim().toLowerCase();
    if (q) out = out.filter((f) => matches(f, q));
    const cmp = (SORTS.find((s) => s[0] === st.sort) || SORTS[0])[2];
    return [...out].sort(cmp);
  }
  const filterWords = () => {
    const parts = [];
    if (st.types.size) parts.push([...st.types].map((g) => GROUP_WORD[g]).join(', '));
    if (st.by !== 'all') parts.push(st.by === 'mine' ? 'added by you' : `added by ${who(st.by)}`);
    if (st.when !== 'any') parts.push({ week: 'this week', month: 'this month', older: 'earlier' }[st.when]);
    if (st.shared.size === 1) parts.push(st.shared.has('shared') ? 'shared' : 'not shared');
    if (st.linked.size === 1) parts.push(st.linked.has('linked') ? 'linked' : 'not linked');
    if (st.query.trim()) parts.push(`matching "${st.query.trim()}"`);
    return parts.join(', ');
  };
  const nFilters = () => st.types.size + (st.by !== 'all' ? 1 : 0) + (st.when !== 'any' ? 1 : 0) + (st.shared.size === 1 ? 1 : 0) + (st.linked.size === 1 ? 1 : 0) + (T('sort') === 'filters' && st.sort !== 'new' ? 1 : 0);
  const clearFilters = () => { st.types.clear(); st.by = 'all'; st.when = 'any'; st.shared.clear(); st.linked.clear(); st.query = ''; if (T('sort') === 'filters') st.sort = 'new'; };
  const used = () => (st.usedBytes !== null ? st.usedBytes : pool().reduce((a, f) => a + f.size, 0));
  const REMOVE_WHY = 'Remove is only for files you added';
  const canRemove = (f) => Boolean(perm.remove_any) || f.by === me;
  const can = (what) => Boolean(perm[what]);

  // ---- little things ----
  function toast(title, text, kind = 'ok', icon = 'check', keep = false) {
    const t = h('div', 'sdk-toast vt-toast');
    t.dataset.kind = kind;
    const ic = h('span', 'sdk-toast-icon'); ic.append(fa(icon));
    const body = h('div', 'sdk-toast-body'); body.append(h('span', 'sdk-toast-title', title));
    if (text) body.append(h('span', 'sdk-toast-text', text));
    t.append(ic, body);
    layer.append(t);
    if (!keep) setTimeout(() => t.remove(), 3600);
    frame.announce(`${title}${text ? `. ${text}` : ''}`);
  }
  const downloadButton = (f, primary = false) => {
    const b = btn(`btn btn-small${primary ? ' btn-primary' : ''}`, { label: 'Download', icon: 'download' });
    b.addEventListener('click', () => toast('Download started', f.name, 'ok', 'download'));
    return b;
  };

  // ---- menus ----
  function fileMenu(f) {
    const uses = USES[f.id] ? USES[f.id].list.length + USES[f.id].hidden : 0;
    const items = [];
    if (!f.missing) items.push({ label: 'Open', icon: 'eye', onPick: () => openFile(f.id, app.querySelector(`[data-menu="${f.id}"]`)) });
    if (can('download') && !f.missing) items.push({ label: 'Download', icon: 'download', onPick: () => toast('Download started', f.name, 'ok', 'download') });
    if (canRemove(f) && !f.missing) items.push({ label: 'Rename', icon: 'pen-to-square', onPick: () => rename(f) });
    if (can('share') && !f.missing) items.push({ label: 'Share', icon: 'share-nodes', onPick: () => shareFiles([f]) });
    items.push({ label: 'Where it is used', icon: 'link', badge: uses || undefined, onPick: () => ask(usesSheet(f, W())) });
    if (canRemove(f)) { items.push({ divider: true }); items.push({ label: 'Remove', icon: 'trash', danger: true, onPick: () => removeFiles([f]) }); }
    return items;
  }
  const ask = (dlg) => liveOpen(dlg);
  function rename(f) {
    const dlg = renameSheet(f);
    const input = dlg.querySelector('input');
    ask(dlg).then((ok) => {
      const name = input.value.trim().replace(/[\\/\u0000-\u001f]/g, '').slice(0, 120);
      if (ok && name) { st.renamed.set(f.id, name); toast('Renamed', name, 'ok', 'pen-to-square'); render(false); }
    });
  }
  function removeFiles(files, done) {
    ask(removeSheet(W(), files)).then((ok) => {
      if (!ok) return;
      if (done) done();
      for (const f of files) { st.removed.add(f.id); st.sel.delete(f.id); }
      toast(files.length === 1 ? 'File removed' : `${files.length} files removed`, files.length === 1 ? files[0].name : '', 'ok', 'trash');
      render();
    });
  }
  function shareFiles(files) {
    const s = shareSheet(W(), files);
    ask(s).then((ok) => { if (ok) ask(shareSheet(W(), files, { mode: 'made' })); });
  }
  const shareList = () => ask(shareListSheet(W())).then((ok) => { if (ok) { st.selecting = true; render(); } });

  // ---- the toolbar (the frame's own: View switch, info, search and Filters) ----
  const sortGroup = () => ({ id: 'sort', heading: 'Sort by', single: true, value: st.sort, options: SORTS.map(([id, label]) => ({ id, label })) });
  function filtersEntry() {
    const all = pool();
    const count = (fn) => all.filter(fn).length;
    const groups = [
      { id: 'type', heading: 'Type', options: ['image', 'audio', 'video', 'document'].map((g) => ({ id: g, label: GROUP_WORD[g], count: count((f) => f.group === g), on: st.types.has(g) })) },
      { id: 'by', heading: 'Added by', single: true, value: st.by, options: [{ id: 'all', label: 'Everyone' }, { id: 'mine', label: 'Mine' }, ...['mia', 'lee', 'sam'].filter((p) => p !== me).map((p) => ({ id: p, label: PEOPLE[p].name }))] },
      { id: 'when', heading: 'Added', single: true, value: st.when, options: [{ id: 'any', label: 'Any time' }, { id: 'week', label: 'This week' }, { id: 'month', label: 'This month' }, { id: 'older', label: 'Earlier' }] },
      { id: 'shared', heading: 'Shared', options: [{ id: 'shared', label: 'In a share link', count: count((f) => f.shared), on: st.shared.has('shared') }, { id: 'unshared', label: 'Not shared', on: st.shared.has('unshared') }] },
      { id: 'linked', heading: 'Linked', options: [{ id: 'linked', label: 'Linked', count: count((f) => f.uses > 0), on: st.linked.has('linked') }, { id: 'unlinked', label: 'Not linked', on: st.linked.has('unlinked') }] },
    ];
    if (!can('share')) groups.splice(3, 1);
    if (T('sort') === 'filters') groups.unshift(sortGroup());
    return { type: 'filters', id: 'filters', label: 'Filters', groups };
  }
  function toolbar() {
    if (!perm.view) return [];
    if (st.selecting) {
      const n = st.sel.size;
      const chosen = pool().filter((f) => st.sel.has(f.id));
      const mayRemove = n > 0 && chosen.every(canRemove);
      return [
        { type: 'button', id: 'done', label: 'Done', icon: 'check', kind: 'secondary' },
        { type: 'title', text: n ? `${n} selected` : 'Choose files' },
        { type: 'button', id: 'all', label: n === filtered().length ? 'Choose none' : 'Choose all', icon: 'square-check', kind: 'secondary' },
        ...(can('download') ? [{ type: 'button', id: 'sel-download', label: 'Download', icon: 'download', kind: 'secondary', disabled: !n }] : []),
        ...(can('share') ? [{ type: 'button', id: 'sel-share', label: 'Share', icon: 'share-nodes', kind: 'secondary', disabled: !n }] : []),
        { type: 'button', id: 'sel-remove', label: 'Remove', icon: 'trash', kind: 'secondary', disabled: !mayRemove, ...(n && !mayRemove ? { tip: REMOVE_WHY } : {}) },
      ];
    }
    const sortName = (SORTS.find((s) => s[0] === st.sort) || SORTS[0])[1];
    return [
      { type: 'switch', id: 'view', label: 'View', value: st.view, options: [{ id: 'list', label: 'List', icon: 'list' }, { id: 'grid', label: 'Grid', icon: 'grip' }] },
      ...(T('sort') === 'button' ? [{ type: 'button', id: 'sort', label: sortName, icon: 'arrow-down-short-wide', kind: 'secondary', tip: 'Sort the files' }] : [{ type: 'title', text: sortName }]),
      { type: 'search', id: 'find', label: 'Search files', placeholder: 'Search files', value: st.query },
      filtersEntry(),
    ];
  }
  function titlebar() {
    const tb = {
      actions: pool().length && (can('download') || can('share') || pool().some(canRemove)) ? [{ id: 'select', icon: 'square-check', label: 'Select', placement: 'bar', on: st.selecting }] : [],
      moduleStandard: { ...(role === 'owner' ? { settings: true } : {}), ...(can('share') ? { share: true } : {}), onPick: (id) => { if (id === 'share') { const ch = pool().filter((f) => st.sel.has(f.id)); if (ch.length) shareFiles(ch); else shareList(); } if (id === 'settings') toast('Settings', 'Owners set smaller limits here.', 'ok', 'gear'); } },
      close: true,
    };
    if (can('add')) tb.add = { label: 'Add files' };
    return tb;
  }
  function status() {
    const list = pool();
    const shown = filtered().length;
    const cap = st.capBytes;
    const u = used();
    const f = filterWords();
    const count = f ? `${shown} of ${plural(list.length, 'file')}` : plural(list.length, 'file');
    const text = `${count} · ${u === 0 ? '0 GB' : size(u)} of ${size(cap)}${f ? ` · ${f}` : ''}`;
    const items = [];
    if (u >= cap) items.push({ text: 'Full', icon: 'triangle-exclamation', tone: 'danger', title: `This ${W().space}'s ${W().module} is full` });
    else if (u / cap >= 0.8) items.push({ text: 'Almost full', icon: 'triangle-exclamation', tone: 'warn' });
    if (st.selecting && st.sel.size && !pool().filter((x) => st.sel.has(x.id)).every(canRemove)) items.push({ text: REMOVE_WHY, icon: 'circle-info', title: REMOVE_WHY });
    return { text, items };
  }

  function onAction(e) {
    if (e.area === 'titlebar') {
      if (e.id === 'add') { st.panel = !st.panel || T('add') === 'dialog'; render(); }
      else if (e.id === 'select') { st.selecting = !st.selecting; st.sel.clear(); render(); }
      return;
    }
    if (e.area !== 'toolbar') return;
    const id = e.id;
    if (id === 'view') { st.view = e.value; render(false); }
    else if (id === 'find') { st.query = e.value || ''; render(false); }
    else if (id === 'sort' && e.value === undefined) openHostMenu(e.el, SORTS.map(([sid, label]) => ({ label, radio: true, checked: st.sort === sid, onPick: () => { st.sort = sid; render(); } })));
    else if (id === 'sort') { st.sort = e.value; render(false); }
    else if (id === 'type') { if (e.on) st.types.add(e.value); else st.types.delete(e.value); render(false); }
    else if (id === 'by') { st.by = e.value; render(false); }
    else if (id === 'when') { st.when = e.value; render(false); }
    else if (id === 'shared' || id === 'linked') { const s = st[id]; if (e.on) s.add(e.value); else s.delete(e.value); render(false); }
    else if (id === 'done') { st.selecting = false; st.sel.clear(); render(); }
    else if (id === 'all') { const ids = filtered().map((f) => f.id); if (st.sel.size === ids.length) st.sel.clear(); else ids.forEach((i) => st.sel.add(i)); render(); }
    else if (id === 'sel-download') toast(`Downloading ${plural(st.sel.size, 'file')}`, 'One file at a time, as the browser allows.', 'ok', 'download');
    else if (id === 'sel-share') shareFiles(pool().filter((f) => st.sel.has(f.id)));
    else if (id === 'sel-remove') removeFiles(pool().filter((f) => st.sel.has(f.id)));
  }

  // ---- the list and the grid ----
  const mark = (name) => {
    const q = st.query.trim();
    if (!q) return name;
    const i = name.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return name;
    const frag = D.createDocumentFragment();
    frag.append(name.slice(0, i));
    frag.append(h('mark', 'vt-mark', name.slice(i, i + q.length)));
    frag.append(name.slice(i + q.length));
    return frag;
  };
  function tick(f) {
    const lab = h('label', 'sdk-row-tick vt-tick');
    const cb = h('input');
    cb.type = 'checkbox'; cb.checked = st.sel.has(f.id); cb.setAttribute('aria-label', `Choose ${f.name}`);
    cb.addEventListener('change', () => { if (cb.checked) st.sel.add(f.id); else st.sel.delete(f.id); render(false); });
    lab.append(cb);
    return lab;
  }
  const narrow = () => app.clientWidth > 0 && app.clientWidth <= 480;
  const ticks = () => st.selecting || T('select') === 'ticks';
  // A name that is too long for its line is cut in the middle, so the end (the extension) stays: "Vespa ri…p.mp4". The tooltip has the whole name.
  function cutName(name) {
    const dot = name.lastIndexOf('.');
    const at = Math.max(1, dot > 0 ? Math.max(1, dot - 3) : name.length - 4);
    const head = h('span', 'vt-nm-head'); head.append(mark(name.slice(0, at)));
    const tail = h('span', 'vt-nm-tail'); tail.append(mark(name.slice(at)));
    const frag = D.createDocumentFragment(); frag.append(head, tail);
    return frag;
  }
  function openButton(f, cls, cut = false) {
    const b = h('button', `sdk-open ${cls}${cut ? ' vt-cut' : ''}`);
    b.type = 'button';
    if (f.missing) b.disabled = false;
    b.append(cut ? cutName(f.name) : mark(f.name));
    b.title = f.name;
    b.addEventListener('click', () => { if (st.selecting) { if (st.sel.has(f.id)) st.sel.delete(f.id); else st.sel.add(f.id); render(false); } else openFile(f.id, b); });
    return b;
  }
  function menuButton(f) {
    const m = h('button', 'menu-btn sdk-icon-btn btn-quiet btn-small');
    m.type = 'button'; m.setAttribute('aria-label', `More for ${f.name}`); m.setAttribute('aria-haspopup', 'menu'); m.dataset.tip = 'More';
    m.append(fa('ellipsis-vertical'));
    m.addEventListener('click', (e) => { e.stopPropagation(); openHostMenu(m, () => fileMenu(f)); });
    m.dataset.menu = f.id;
    return m;
  }
  function badges(f) {
    const box = h('span', 'vt-flags');
    if (f.uses) { const s = h('span', 'vt-flag'); s.title = `Linked from ${plural(USES[f.id] ? USES[f.id].list.length + USES[f.id].hidden : f.uses, 'place')}`; s.append(fa('link'), h('span', '', String(f.uses))); s.setAttribute('aria-label', s.title); box.append(s); }
    if (f.shared) { const s = h('span', 'vt-flag'); s.title = 'In a share link'; s.append(fa('share-nodes')); s.setAttribute('aria-label', 'In a share link'); box.append(s); }
    return box;
  }
  function sub(f) {
    const s = h('span', 'sdk-row-sub vt-sub');
    s.append(h('span', 'vt-sub-kind', `${KINDS[f.kind].word} · `), size(f.size));
    if (f.missing) { const t = h('span', 'vt-tone vt-warn'); t.append(fa('triangle-exclamation'), 'File missing'); s.append(' · ', t); }
    else if (f.viewable === false) { const t = h('span', 'vt-tone'); t.append('Download only'); s.append(' · ', t); }
    const n = h('span', 'vt-sub-narrow'); n.append(` · ${f.by === me ? 'You' : who(f.by)} · ${when(f.at)}`);
    s.append(n);
    return s;
  }
  function rowEl(f) {
    const li = h('li', 'sdk-row vt-row');
    li.dataset.id = f.id; li.dataset.tint = KINDS[f.kind].tint;
    if (st.sel.has(f.id)) li.setAttribute('aria-selected', 'true');
    if (f.missing) li.classList.add('is-missing');
    if (ticks()) li.append(tick(f));
    li.append(thumb(f, 96));
    const main = h('span', 'sdk-row-main');
    main.append(openButton(f, 'sdk-row-title'), sub(f));
    li.append(main);
    const by = h('span', 'vt-by'); by.append(personDot(f.by, 20), h('span', 'vt-by-name', f.by === me ? 'You' : who(f.by)));
    li.append(by, h('span', 'sdk-row-meta vt-when', when(f.at)), badges(f), menuButton(f));
    return li;
  }
  function cardEl(f) {
    const k = KINDS[f.kind];
    if (T('gridCard') === 'thumb' || narrow()) {
      const c = h('article', 'sdk-card vt-card vt-card-thumb');
      c.dataset.id = f.id; c.dataset.tint = k.tint;
      if (st.sel.has(f.id)) c.setAttribute('aria-selected', 'true');
      const t = thumb(f, 192);
      const over = h('div', 'vt-card-over');
      if (ticks()) over.append(tick(f));
      over.append(h('span', 'vt-fill'), menuButton(f));
      const meta = h('div', 'vt-card-meta');
      const subl = h('span', 'sdk-card-sub');
      subl.append(h('span', 'vt-x-kind', `${k.word} · `), size(f.size), h('span', 'vt-x-by', ` · ${f.by === me ? 'You' : who(f.by)}`));
      meta.append(openButton(f, 'vt-card-name'), subl, badges(f));
      c.append(t, over, meta);
      return c;
    }
    const c = h('article', 'sdk-card-banded vt-card');
    c.dataset.id = f.id; c.dataset.tint = k.tint;
    if (st.sel.has(f.id)) c.setAttribute('aria-selected', 'true');
    const head = h('header', 'sdk-card-head');
    if (ticks()) head.append(tick(f));
    const main = h('div', 'sdk-card-main');
    // One line (Thomas, 2026-11-03): a small type icon in the kind's colour, the name cut with an ellipsis, the more button. The kind word is in the tooltip and the label.
    const ic = h('span', 'vt-kind-mini');
    ic.dataset.tint = k.tint; ic.title = k.word; ic.setAttribute('role', 'img'); ic.setAttribute('aria-label', k.word);
    ic.append(fa(k.icon));
    const title = h('h3', 'sdk-card-title vt-card-title');
    const nameBtn = openButton(f, 'vt-card-name', true);
    nameBtn.title = `${f.name} (${k.word})`;
    title.append(nameBtn);
    main.append(ic, title);
    head.append(main, menuButton(f));
    const body = h('div', 'sdk-card-body');
    const meta = h('p', 'vt-card-line');
    meta.append(`${size(f.size)} · ${f.by === me ? 'You' : who(f.by)} · ${when(f.at)}`);
    if (f.missing) { const t = h('span', 'vt-tone vt-warn'); t.append(fa('triangle-exclamation'), 'File missing'); meta.append(' · ', t); }
    else if (f.viewable === false) meta.append(' · Download only');
    body.append(thumb(f, 192), meta, badges(f));
    c.append(head, body);
    return c;
  }
  function emptyEl() {
    const e = h('div', 'sdk-empty vt-empty');
    if (!pool().length) {
      e.append(fa('folder-open'), h('p', 'sdk-empty-title', 'No files yet.'), h('p', 'sdk-empty-text', can('add') ? W().empty.replace('No files yet. ', '') : `Nothing has been added to this ${W().space} yet.`));
      if (can('add')) { const b = btn('btn btn-primary', { label: 'Add files', icon: 'plus' }); b.addEventListener('click', () => { st.panel = true; render(); }); e.append(b); }
    } else {
      e.append(fa('magnifying-glass'), h('p', 'sdk-empty-title', 'No files match.'));
      const b = btn('btn', { label: 'Clear filters', icon: 'xmark' });
      b.addEventListener('click', () => { clearFilters(); render(); });
      e.append(b);
    }
    return e;
  }
  function noPermEl() {
    const e = h('div', 'sdk-empty vt-empty');
    e.append(fa('lock'), h('p', 'sdk-empty-title', `You can't see the files in this ${W().space}.`), h('p', 'sdk-empty-text', 'Ask an owner or a moderator if you need them.'));
    return e;
  }

  // ---- Add files ----
  function uploadRow(it) {
    const li = h('li', 'sdk-row vt-up');
    li.dataset.status = it.status;
    const k = KINDS[it.kind] || KINDS.text;
    const lead = h('span', 'sdk-card-icon vt-kind');
    lead.dataset.tint = it.status === 'refused' ? 'red' : it.status === 'done' ? 'green' : k.tint;
    lead.append(fa(it.status === 'refused' ? 'triangle-exclamation' : it.status === 'done' ? 'check' : k.icon));
    const main = h('span', 'sdk-row-main');
    main.append(h('span', 'sdk-row-title', it.name));
    const line = h('span', `sdk-row-sub vt-up-line${it.status === 'refused' ? ' vt-up-bad' : ''}`);
    line.textContent = it.status === 'uploading' ? `Adding · ${Math.round(it.pct)}% · ${size(it.size * it.pct / 100)} of ${size(it.size)}` : it.status === 'queued' ? it.msg || 'Waiting' : it.status === 'done' ? (it.msg || `Added · ${size(it.size)}`) : it.msg;
    main.append(line);
    if (it.status === 'uploading') {
      const bar = h('div', 'sdk-progress sdk-progress-sm');
      bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', `Adding ${it.name}`); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(Math.round(it.pct)));
      const fill = h('span', 'sdk-progress-fill'); fill.style.setProperty('--pct', `${it.pct}%`);
      bar.append(fill);
      main.append(bar);
    }
    li.append(lead, main);
    const end = iconBtn('xmark', it.status === 'uploading' || it.status === 'queued' ? 'Stop adding' : 'Clear from the list');
    end.addEventListener('click', () => { st.queue = st.queue.filter((x) => x !== it); if (it.timer) clearInterval(it.timer); render(false); });
    li.append(end);
    return li;
  }
  function addPanel(inDialog = false) {
    const p = h('section', 'vt-add');
    p.setAttribute('aria-label', 'Add files');
    if (!inDialog) {
      const head = h('div', 'vt-add-head');
      head.append(h('h3', 'vt-add-title', 'Add files'), iconBtn('xmark', 'Close'));
      head.lastChild.addEventListener('click', () => { st.panel = false; render(); });
      p.append(head);
    }
    const u = used(), cap = st.capBytes, full = u >= cap;
    if (st.notice) {
      const b = h('div', 'sdk-banner'); b.dataset.kind = st.notice.kind; b.setAttribute('role', 'status');
      const ic = h('span', 'sdk-banner-icon'); ic.append(fa(st.notice.icon || 'triangle-exclamation'));
      b.append(ic, h('span', 'sdk-banner-text', st.notice.text));
      p.append(b);
    }
    const drop = h('div', `vt-drop${st.dropping ? ' is-over' : ''}${full ? ' is-off' : ''}${st.queue.length ? ' is-compact' : ''}`);
    if (full) drop.setAttribute('aria-disabled', 'true');
    const input = h('input'); input.type = 'file'; input.multiple = true; input.hidden = true; input.accept = '.jpg,.jpeg,.png,.webp,.gif,.mp3,.ogg,.oga,.wav,.m4a,.mp4,.webm,.mov,.pdf,.md';
    input.addEventListener('change', () => { startFiles([...input.files]); input.value = ''; });
    const choose = btn('btn btn-primary', { label: 'Choose files', icon: 'plus' });
    choose.disabled = full;
    choose.addEventListener('click', () => input.click());
    drop.append(fa(full ? 'ban' : 'cloud-arrow-up', 'vt-drop-ic'), h('p', 'vt-drop-title', full ? `This ${W().space}'s ${W().module} is full` : st.dropping ? 'Drop to add them' : 'Drop files here'), full ? h('p', 'vt-drop-sub', 'Remove some files to add more.') : h('p', 'vt-drop-sub', 'or'), full ? h('span') : choose, input);
    p.append(drop);
    if (st.queue.length) { const ul = h('ul', 'sdk-card-list vt-queue'); ul.setAttribute('aria-label', 'Files being added'); for (const it of st.queue) ul.append(uploadRow(it)); p.append(ul); }
    p.append(h('p', 'vt-accept', 'Pictures (JPEG, PNG, WebP, GIF), audio (MP3, OGG, WAV, M4A), video (MP4, WebM, MOV), PDF and Markdown. Up to 25 MB for a picture, 200 MB audio, 2 GB video, 100 MB PDF, 1 MB Markdown.'));
    const opt = h('label', 'sdk-choice-row vt-where');
    const cb = h('input'); cb.type = 'checkbox'; cb.checked = T('removeWhere') === 'on';
    const txt = h('span', 'sdk-choice-text'); txt.append(h('span', 'sdk-choice-label', 'Remove where it was taken'), h('span', 'sdk-choice-desc', 'For pictures. Your choice is remembered.'));
    opt.append(cb, txt);
    p.append(opt, h('p', 'vt-notice', 'Videos keep their details, which can include where they were taken.'), h('p', 'vt-line', `Everyone in this ${W().space} can see what you add.`));
    const m = h('div', 'sdk-meter vt-quota');
    const mh = h('div', 'sdk-meter-head');
    const val = h('span', 'sdk-meter-value'); val.textContent = `${size(u)} of ${size(cap)}`;
    mh.append(h('span', 'sdk-meter-label', `Used in this ${W().space}`), val);
    const bar = h('div', `sdk-progress sdk-progress-sm${u / cap >= 0.9 ? ' warn' : ''}`);
    bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', `Space used in this ${W().space}`); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(Math.round(u / cap * 100)));
    const fill = h('span', 'sdk-progress-fill'); fill.style.setProperty('--pct', `${Math.min(100, u / cap * 100)}%`);
    bar.append(fill); m.append(mh, bar);
    p.append(m);
    return p;
  }
  // The picker and the drop: each file is checked as the server would (type, size), then "sent" over a few seconds.
  function startFiles(files) {
    for (const f of files) {
      const kind = kindOfName(f.name);
      const it = { name: f.name, size: f.size || 1, kind, status: 'queued', pct: 0, msg: '' };
      if (/\.heic$/i.test(f.name)) { it.status = 'refused'; it.msg = 'Save it as a JPEG.'; }
      else if (!ALLOWED.test(f.name)) { it.status = 'refused'; it.msg = TYPE_REFUSAL; }
      else if (f.size > LIMIT[kind][0]) { it.status = 'refused'; it.msg = `That file is over the ${LIMIT[kind][1]} limit for ${LIMIT[kind][2]}.`; }
      else if (used() + f.size > st.capBytes) { it.status = 'refused'; it.msg = `This ${W().space}'s ${W().module} is full (${size(st.capBytes)}). Remove some files to add more.`; }
      st.queue.push(it);
      if (it.status === 'refused') continue;
      it.status = 'uploading';
      it.timer = setInterval(() => {
        it.pct = Math.min(100, it.pct + 12 + Math.random() * 14);
        if (it.pct >= 100) {
          clearInterval(it.timer); it.status = 'done'; it.pct = 100;
          const rec = { id: `n${Date.now()}${Math.floor(Math.random() * 99)}`, name: f.name, kind, group: KINDS[kind].group, type: f.type, size: f.size, by: me, at: new Date(NOW.getTime() - 60000).toISOString(), uses: 0, shared: false, seed: Math.floor(Math.random() * 40) + 1, scene: 'street', hue: Math.floor(Math.random() * 360), w: 1600, h: 1200, dur: 30, pages: 1 };
          st.added.unshift(rec);
        }
        render(false);
      }, 450);
    }
    render(false);
  }

  // ---- the viewer: a window of the canvas (prototype-vault-window.js), never inside the panel ----
  // What the window asks of the module: what the person may do, and the removing of a missing file.
  const winCtx = { can, canRemove, remove: (f, done) => removeFiles([f], done), share: (f) => shareFiles([f]), words: { get module() { return W().module; } }, get pdfSearch() { return T('pdfSearch'); } };
  function openFile(id, opener, extra = {}) {
    if (!cfg.stage) return;
    const list = filtered();
    const f = pool().find((x) => x.id === id);
    if (!f) return;
    const back = () => app.querySelector(`[data-id="${id}"] .sdk-open`) || app.querySelector('.sdk-open');
    cfg.stage.open({ id, list: list.some((x) => x.id === id) ? list : [f], ctx: winCtx, returnFocus: opener ? () => (opener.isConnected ? opener : back()) : back, ...extra });
  }

  // ---- the whole content ----
  let lastScroll = 0;
  let renderedNarrow = false;
  function render(refreshBars = true) {
    renderedNarrow = narrow();
    const keep = app.querySelector('.vt-scroll');
    if (keep) lastScroll = keep.scrollTop;
    app.textContent = '';
    app.dataset.view = st.view;
    app.dataset.card = T('gridCard');
    if (!perm.view) {
      app.append(noPermEl());
    } else {
      if (st.notice && !st.panel) {
        const b = h('div', 'sdk-banner vt-banner'); b.dataset.kind = st.notice.kind; b.setAttribute('role', 'status');
        const ic = h('span', 'sdk-banner-icon'); ic.append(fa(st.notice.icon || 'triangle-exclamation'));
        b.append(ic, h('span', 'sdk-banner-text', st.notice.text));
        app.append(b);
      }
      if (st.panel && T('add') === 'panel' && can('add')) app.append(addPanel());
      const scroll = h('div', 'vt-scroll');
      const list = filtered();
      if (!list.length) scroll.append(emptyEl());
      else if (st.view === 'list') {
        const ul = h('ul', 'sdk-card-list vt-rows');
        ul.setAttribute('aria-label', 'Files');
        for (const f of list) ul.append(rowEl(f));
        scroll.append(ul);
      } else {
        const g = h('div', 'vt-grid');
        g.setAttribute('role', 'list');
        for (const f of list) { const c = cardEl(f); c.setAttribute('role', 'listitem'); g.append(c); }
        scroll.append(g);
      }
      app.append(scroll);
      scroll.scrollTop = lastScroll;
    }
    if (st.dropping && !st.panel) { const o = h('div', 'vt-dropover'); o.append(fa('cloud-arrow-up'), h('p', 'vt-drop-title', `Drop to add to the ${W().module}`), h('p', 'vt-drop-sub', `Everyone in this ${W().space} can see what you add.`)); app.append(o); }
    app.append(layer);
    if (frame) {
      frame.setTitle(W().module, W().icon);
      frame.setTitlebar(titlebar());
      frame.setToolbar(toolbar());
      frame.setStatus(perm.view ? status() : { text: '' });
      if (st.panel && T('add') === 'dialog' && can('add') && !st._dlg) {
        st._dlg = true;
        const s = sheet({ title: 'Add files', width: 'form' });
        s.body.append(addPanel(true));
        s.foot.append(okBtn('Done', 'btn btn-primary'));
        if (cfg.held) heldDialog(hold, s.dlg);
        else ask(s.dlg).then(() => { st._dlg = false; st.panel = false; render(); });
      }
      if (!(st.panel && T('add') === 'dialog')) st._dlg = false;
    }
  }

  // Dropping files on the module adds them (a real drop; the picture of it is the "dropping" state).
  let depth = 0;
  app.addEventListener('dragenter', (e) => { if (!can('add') || !e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return; depth += 1; if (!st.dropping) { st.dropping = true; render(false); } });
  app.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth && st.dropping) { st.dropping = false; render(false); } });
  app.addEventListener('dragover', (e) => { if (can('add')) e.preventDefault(); });
  app.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; st.dropping = false; if (can('add') && e.dataTransfer.files.length) { st.panel = true; startFiles([...e.dataTransfer.files]); } else render(false); });

  const ro = new ResizeObserver(() => { if (narrow() !== renderedNarrow) render(false); });
  ro.observe(app);
  frame = createModuleFrame({
    title: W().module, icon: W().icon, tint: 'blue', titlebar: titlebar(), toolbar: toolbar(), content: inShadow(app), flush: true, status: status(), onAction,
  });
  const hold = h('div', 'vt-hold');
  hold.append(frame.el);
  frame.el.classList.add('vt-mf');
  render();
  if (cfg.toast) toast(cfg.toast[0], cfg.toast[1], cfg.toast[2], cfg.toast[3], true);
  const api = { el: hold, app, frame, st, render, perm, pool, filtered, fileMenu, filtersEntry, fileMenuFor: (id) => fileMenu(byId(id)), set(patch) { Object.assign(st, patch); render(); }, openFile, startFiles, toast };
  // Let go of everything this panel holds (the section draws a panel only near the screen and releases it when it is far away).
  api.destroy = () => {
    ro.disconnect();
    for (const it of st.queue) if (it.timer) clearInterval(it.timer);
    stopMedia(api.el);
    instances.delete(api);
  };
  instances.add(api);
  return api;
}
