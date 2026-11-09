// The Vault privacy section of the Prototype (plan-vault-privacy.md, slice 2; Thomas, 2026-11-06): who can see which file, drawn for him
// to judge before anything is built. Design-process only: nothing here ships, nothing is fetched, all names and files are made up
// (the sample is prototype-vault-data.js). The screens are drawn from the Vault section's own pieces (the module frame, the file row, the
// file window, the dialogs) and the SDK's (choice rows, removable chips, the search box, tables, host.menu). The rule drawn is Thomas's:
// a file is seen by everyone in the space (the default), by its adder only, or by chosen people; owners and the admin see all;
// a member sees nothing of a file they cannot see (no row, no count, no placeholder); a moderator sees only what is shared with them
// unless See every file is on.
import { createModuleFrame } from '/module-frame.js';
import { openHostMenu } from '/host-menu.js';
import { FILES, KINDS, GB, byId } from './prototype-vault-data.js';
import { D, h, fa, btn, iconBtn, size, when, plural, thumb, fileChip, inShadow, lazy, heldMenu, runDeferred, WORDS } from './prototype-vault-ui.js';
import { createCanvas } from './prototype-vault-window.js';
import { sheet, cancelBtn, okBtn, heldDialog, liveOpen, shareSheet } from './prototype-vault-dialogs.js';

const W = WORDS.vault;
const CAP = 5 * GB;
const LIMIT = 200;

// ---- who is in the made-up trip ----
const CAST = {
  noor: { name: 'Noor', role: 'Owner' }, mia: { name: 'Mia', role: 'Moderator' }, lee: { name: 'Lee', role: 'Member' }, sam: { name: 'Sam', role: 'Member' },
  ana: { name: 'Ana', role: 'Member' }, ben: { name: 'Ben', role: 'Member' }, chloe: { name: 'Chloe', role: 'Member' }, dev: { name: 'Dev', role: 'Member' },
  elena: { name: 'Elena', role: 'Member' }, farid: { name: 'Farid', role: 'Member' }, gita: { name: 'Gita', role: 'Member' }, hugo: { name: 'Hugo', role: 'Member' },
  ines: { name: 'Ines', role: 'Member' }, jon: { name: 'Jon', role: 'Member' },
};
const nm = (k) => (CAST[k] ? CAST[k].name : 'someone who left');
// A big space for the 200 limit: 240 more made-up members, "Ana B." and so on.
const FIRST = ['Abel', 'Bea', 'Cato', 'Dara', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jade', 'Kai', 'Lena', 'Milo', 'Nia', 'Omar', 'Pia', 'Quin', 'Rosa', 'Seth', 'Tess', 'Uma', 'Vik', 'Wren', 'Xavi', 'Yara', 'Zed', 'Alma', 'Bram', 'Cleo', 'Dino'];
const BIG = [];
for (const l of 'ABCDEFGH') for (const f of FIRST) BIG.push({ key: `${f}-${l}`, name: `${f} ${l}.`, role: 'Member' });

// What each person sees (the plan's decisions 2 to 5): the adder always; owners and the admin always; a moderator only with See every file;
// else the visibility.
const VIEWERS = { lee: {}, sam: {}, noor: { owner: true }, mia: { moderator: true }, 'mia-all': { moderator: true, seeAll: true, key: 'mia' } };
const PRIV = {
  f02: { v: 'people', p: ['ana', 'ben', 'sam'] }, f05: { v: 'only-me' }, f13: { v: 'only-me' }, f32: { v: 'people', p: ['mia'] },
  f33: { v: 'only-me' }, f41: { v: 'people', p: ['sam', 'noor'] }, f22: { v: 'people', p: ['mia', 'ana'] }, f37: { v: 'people', p: ['noor', 'sam'] },
  f17: { v: 'only-me' }, f14: { v: 'people', p: ['lee', 'ana', 'ben'] }, f26: { v: 'people', p: ['lee', 'sam'] }, f36: { v: 'people', p: ['sam', 'mia'] },
};
const vis = (f) => PRIV[f.id] || { v: 'everyone', p: [] };
const keyOf = (viewer) => VIEWERS[viewer].key || viewer;
const sees = (viewer, f) => {
  const r = VIEWERS[viewer];
  if (f.by === keyOf(viewer) || r.owner || r.seeAll) return true;
  const x = vis(f);
  return x.v === 'everyone' || (x.v === 'people' && x.p.includes(keyOf(viewer)));
};
const shared = (viewer, f) => { // true when the file is open to this person only because of their rights, not because it was shared with them
  const x = vis(f);
  return f.by !== keyOf(viewer) && x.v !== 'everyone' && !(x.v === 'people' && x.p.includes(keyOf(viewer)));
};
const visibleTo = (viewer) => FILES.filter((f) => sees(viewer, f)).sort((a, b) => (a.at < b.at ? 1 : -1));
const setLabel = (b, t) => { b.querySelector('.vt-btn-word').textContent = t; };
// Who loses sight when a file goes from Everyone to Only me: the members, less the owners (who keep access) and the person changing it.
const LOSE = Object.entries(CAST).filter(([k, v]) => v.role !== 'Owner' && k !== 'lee').length;
const peopleWord = (n) => (n === 1 ? '1 person' : `${n} people`);
const markOf = (f) => { const x = vis(f); return x.v === 'only-me' ? ['lock', 'Only me'] : x.v === 'people' ? ['user-group', peopleWord(x.p.length)] : null; };

// ---- the small pieces ----
function av(key, px = 24) {
  const a = h('span', `sdk-avatar sdk-avatar-${px}`);
  a.append(h('span', 'sdk-avatar-ini', (CAST[key] ? CAST[key].name : key)[0]));
  a.setAttribute('aria-hidden', 'true');
  return a;
}
const PSHEET = await (async () => {
  const r = await fetch(new URL('prototype-vault-privacy.css', import.meta.url));
  const s = new CSSStyleSheet();
  s.replaceSync(await r.text());
  return s;
})();
function inFrame(node) {
  const host = inShadow(node);
  host.shadowRoot.adoptedStyleSheets = [...host.shadowRoot.adoptedStyleSheets, PSHEET];
  return host;
}

// ---- the Vault list, as a person sees it ----
function row(f, viewer, onOpen) {
  const li = h('li', 'sdk-row vt-row');
  li.dataset.id = f.id; li.dataset.tint = KINDS[f.kind].tint;
  li.append(thumb(f, 96));
  const main = h('span', 'sdk-row-main');
  const open = h('button', 'sdk-open sdk-row-title', f.name);
  open.type = 'button'; open.title = f.name;
  if (onOpen) open.addEventListener('click', () => onOpen(f, open));
  const sub = h('span', 'sdk-row-sub vt-sub');
  sub.append(h('span', 'vt-sub-kind', `${KINDS[f.kind].word} · `), size(f.size));
  const mark = f.by === keyOf(viewer) ? markOf(f) : null; // the adder sees a small mark on their own files, and only they
  if (mark) { const t = h('span', 'vt-tone vp-mark'); t.append(fa(mark[0]), mark[1]); sub.append(' · ', t); }
  if (shared(viewer, f)) { const t = h('span', 'vt-tone vp-mark'); t.dataset.kind = 'rights'; t.append(fa('eye'), 'Not shared with you'); sub.append(' · ', t); }
  const n = h('span', 'vt-sub-narrow'); n.append(` · ${f.by === keyOf(viewer) ? 'You' : nm(f.by)} · ${when(f.at)}`);
  sub.append(n);
  main.append(open, sub);
  li.append(main);
  const by = h('span', 'vt-by'); by.append(av(f.by, 20), h('span', 'vt-by-name', f.by === keyOf(viewer) ? 'You' : nm(f.by)));
  const m = h('button', 'menu-btn sdk-icon-btn btn-quiet btn-small');
  m.type = 'button'; m.setAttribute('aria-label', `More for ${f.name}`); m.append(fa('ellipsis-vertical'));
  li.append(by, h('span', 'sdk-row-meta vt-when', when(f.at)), h('span', 'vt-flags'), m);
  return li;
}

// A file as a card in the Grid (the Vault's banded card). The marks sit on their own line under the facts, so a narrow card cuts nothing.
function cardOf(f, viewer, onOpen, narrow = false) {
  const k = KINDS[f.kind];
  if (narrow) { // a phone: the picture first, the name under it (the Vault's own narrow card)
    const c = h('article', 'sdk-card vt-card vt-card-thumb');
    c.dataset.id = f.id; c.dataset.tint = k.tint;
    const over = h('div', 'vt-card-over');
    const m = h('button', 'menu-btn sdk-icon-btn btn-quiet btn-small'); m.type = 'button'; m.setAttribute('aria-label', `More for ${f.name}`); m.append(fa('ellipsis-vertical'));
    over.append(h('span', 'vt-fill'), m);
    const meta = h('div', 'vt-card-meta');
    const name = h('button', 'sdk-open vt-card-name', f.name); name.type = 'button'; name.title = `${f.name} (${k.word})`;
    if (onOpen) name.addEventListener('click', () => onOpen(f, name));
    const subl = h('span', 'sdk-card-sub');
    subl.append(h('span', 'vt-x-kind', `${k.word} · `), size(f.size), h('span', 'vt-x-by', ` · ${f.by === keyOf(viewer) ? 'You' : nm(f.by)}`));
    meta.append(name, subl);
    const mark = f.by === keyOf(viewer) ? markOf(f) : null;
    if (mark || shared(viewer, f)) {
      const t = h('p', 'vt-card-line vp-card-marks');
      if (mark) { const a = h('span', 'vt-tone vp-mark'); a.append(fa(mark[0]), mark[1]); t.append(a); }
      if (shared(viewer, f)) { const a = h('span', 'vt-tone vp-mark'); a.dataset.kind = 'rights'; a.append(fa('eye'), 'Not shared with you'); t.append(a); }
      meta.append(t);
    }
    c.append(thumb(f, 192), over, meta);
    return c;
  }
  const c = h('article', 'sdk-card-banded vt-card');
  c.dataset.id = f.id; c.dataset.tint = k.tint;
  const head = h('header', 'sdk-card-head');
  const main = h('div', 'sdk-card-main');
  const ic = h('span', 'vt-kind-mini'); ic.dataset.tint = k.tint; ic.title = k.word; ic.setAttribute('role', 'img'); ic.setAttribute('aria-label', k.word); ic.append(fa(k.icon));
  const title = h('h3', 'sdk-card-title vt-card-title');
  const name = h('button', 'sdk-open vt-card-name', f.name); name.type = 'button'; name.title = `${f.name} (${k.word})`;
  if (onOpen) name.addEventListener('click', () => onOpen(f, name));
  title.append(name);
  main.append(ic, title);
  const m = h('button', 'menu-btn sdk-icon-btn btn-quiet btn-small'); m.type = 'button'; m.setAttribute('aria-label', `More for ${f.name}`); m.append(fa('ellipsis-vertical'));
  head.append(main, m);
  const body = h('div', 'sdk-card-body');
  const line = h('p', 'vt-card-line');
  line.append(`${size(f.size)} · ${f.by === keyOf(viewer) ? 'You' : nm(f.by)} · ${when(f.at)}`);
  body.append(thumb(f, 192), line);
  const mark = f.by === keyOf(viewer) ? markOf(f) : null;
  if (mark || shared(viewer, f)) {
    const t = h('p', 'vt-card-line vp-card-marks');
    if (mark) { const a = h('span', 'vt-tone vp-mark'); a.append(fa(mark[0]), mark[1]); t.append(a); }
    if (shared(viewer, f)) { const a = h('span', 'vt-tone vp-mark'); a.dataset.kind = 'rights'; a.append(fa('eye'), 'Not shared with you'); t.append(a); }
    body.append(t);
  }
  c.append(head, body);
  return c;
}

// The Vault in the real module frame. `viewer` decides what is in the list; `form` is Add files drawn above the list; `banner` a notice.
function vaultFrame({ viewer = 'lee', form = null, banner = null, onOpen, statusItems = [], addButton = true, view = 'list', narrow = false }) {
  const list = visibleTo(viewer);
  const total = list.reduce((a, f) => a + f.size, 0); // each person sees their own visible total
  const app = h('div', 'vt-app vp-app');
  app.dataset.vault = '';
  if (banner) {
    const b = h('div', 'sdk-banner vt-banner'); b.dataset.kind = banner.kind || 'info'; b.setAttribute('role', 'status');
    const ic = h('span', 'sdk-banner-icon'); ic.append(fa(banner.icon || 'circle-info'));
    b.append(ic, h('span', 'sdk-banner-text', banner.text));
    app.append(b);
  }
  if (form) app.append(form);
  const scroll = h('div', 'vt-scroll');
  if (view === 'grid') {
    const g = h('div', 'vt-grid');
    g.setAttribute('role', 'list'); g.setAttribute('aria-label', 'Files');
    for (const f of list) { const c = cardOf(f, viewer, onOpen, narrow); c.setAttribute('role', 'listitem'); g.append(c); }
    scroll.append(g);
  } else {
    const ul = h('ul', 'sdk-card-list vt-rows');
    ul.setAttribute('aria-label', 'Files');
    for (const f of list) ul.append(row(f, viewer, onOpen));
    scroll.append(ul);
  }
  app.append(scroll);
  const by = [...new Set(list.map((f) => f.by))].filter((k) => k !== keyOf(viewer)); // Added by lists only people who added a file this person can see
  const groups = [
    { id: 'type', heading: 'Type', options: ['image', 'audio', 'video', 'document'].map((g) => ({ id: g, label: { image: 'Pictures', audio: 'Audio', video: 'Video', document: 'Documents' }[g], count: list.filter((f) => f.group === g).length, on: false })) },
    { id: 'by', heading: 'Added by', single: true, value: 'all', options: [{ id: 'all', label: 'Everyone' }, { id: 'mine', label: 'Mine' }, ...by.map((k) => ({ id: k, label: nm(k) }))] },
  ];
  const frame = createModuleFrame({
    title: W.module, icon: W.icon, tint: 'blue',
    titlebar: { ...(addButton ? { add: { label: 'Add files' } } : {}), close: true },
    toolbar: [
      { type: 'switch', id: 'view', label: 'View', value: view, options: [{ id: 'list', label: 'List', icon: 'list' }, { id: 'grid', label: 'Grid', icon: 'grip' }] },
      { type: 'title', text: 'Newest first' },
      { type: 'search', id: 'find', label: 'Search files', placeholder: 'Search files', value: '' },
      { type: 'filters', id: 'filters', label: 'Filters', groups },
    ],
    content: inFrame(app), flush: true, status: { text: `${plural(list.length, 'file')} · ${size(total)} of ${size(CAP)}`, items: statusItems },
  });
  const hold = h('div', 'vt-hold');
  hold.append(frame.el);
  frame.el.classList.add('vt-mf');
  return { hold, frame, app, list, total };
}

// ---- the page: one section, sets, states ----
const main = D.getElementById('pp-main');
const sec = h('section', 'pp-group vt vp');
sec.id = 'pp-vault-privacy';
sec.setAttribute('aria-labelledby', 'pp-vault-privacy-name');
const title = h('h2', 'pp-group-name', 'Vault privacy: who can see which file');
title.id = 'pp-vault-privacy-name';
sec.append(title, h('p', 'pp-state-note', 'Slice 2 of plan-vault-privacy.md, for Thomas to judge before anything is built. A file is seen by Everyone in the trip (the default), Only me, or Chosen people (members of the trip, at most 200). Owners and the admin see and open everything. A member sees nothing of a file they cannot see: no row, no count, no placeholder. A moderator sees only what is shared with them, unless See every file is on. A link from an object to a file you cannot see reads hidden, never the name. Made up from the Vault section\'s sample (Rome, forty-two files); the viewer is Lee, a member, unless a drawing says otherwise. The Vault and the pieces here are the Vault section\'s own; nothing is saved and nothing is sent. Narrow the page above: the 390 drawings are always 390 wide.'));
const jump = h('nav', 'pp-jump');
jump.setAttribute('aria-label', 'Jump to a part of Vault privacy');
jump.append(h('span', 'pp-jump-label', 'Jump to'));
sec.append(jump);

function set(id, name, note) {
  const s = h('section', 'vt-set');
  s.id = `vp-${id}`;
  s.setAttribute('aria-labelledby', `vp-${id}-name`);
  const hh = h('h3', 'vt-set-name', name);
  hh.id = `vp-${id}-name`;
  s.append(hh);
  if (note) s.append(h('p', 'pp-state-note', note));
  sec.append(s);
  const b = btn('btn btn-small', { label: name });
  b.addEventListener('click', () => { hh.scrollIntoView({ block: 'start' }); s.classList.add('pp-flash'); setTimeout(() => s.classList.remove('pp-flash'), 900); });
  jump.append(b);
  return s;
}
const pair = (parent) => { const p = h('div', 'vt-pair'); parent.append(p); return p; };

// One drawing: its name and note, a box on the canvas colour, filled when it is near the screen. build(box) returns { destroy, after }.
function shot(into, { name, note, w, h: hh, build }) {
  const wrap = h('section', 'pp-state');
  wrap.append(h('h4', 'pp-state-name', name));
  if (note) wrap.append(h('p', 'pp-state-note', note));
  const box = h('div', 'pp-frame vt-frame');
  if (w) box.dataset.w = String(w);
  if (hh) box.dataset.h = String(hh);
  wrap.append(box);
  into.append(wrap);
  let made = null;
  lazy(box, () => {
    made = build(box);
    return made && made.after ? () => made.after() : undefined;
  }, () => { if (made && made.destroy) made.destroy(); made = null; });
  return box;
}

// ---- Add files, with Who can see this ----
const CHOICES = [
  ['everyone', 'Everyone in this trip', 'The default. Every member can see them.'],
  ['only-me', 'Only me', 'You and the owners can see them.'],
  ['people', 'Chosen people', 'You, the owners and the people you pick.'],
];
// The menu's three choices as radio items (role menuitemradio, aria-checked), the current one drawn with a filled dot and the others with an empty ring.
const radioItems = (current, onPick = () => {}) => [
  { heading: 'Who can see this' },
  ...CHOICES.map(([key, label]) => ({ label, radio: true, checked: key === current, icon: 'circle-dot', ...(key === current ? {} : { icon: 'circle', regular: true }), onPick: () => onPick(key) })),
];
let uid = 0;
function addForm({ vis: v0 = 'everyone', people: p0 = [], onPick } = {}) {
  const st = { v: v0, p: [...p0] };
  const p = h('section', 'vt-add vp-add');
  p.setAttribute('aria-label', 'Add files');
  const head = h('div', 'vt-add-head');
  head.append(h('h3', 'vt-add-title', 'Add files'), iconBtn('xmark', 'Close'));
  const drop = h('div', 'vt-drop');
  drop.append(fa('cloud-arrow-up', 'vt-drop-ic'), h('p', 'vt-drop-title', 'Drop files here'), h('p', 'vt-drop-sub', 'or'), btn('btn btn-primary', { label: 'Choose files', icon: 'plus' }));
  const accept = h('p', 'vt-accept', 'Pictures (JPEG, PNG, WebP, GIF), audio (MP3, OGG, WAV, M4A), video (MP4, WebM, MOV), PDF and Markdown. Up to 25 MB for a picture, 200 MB audio, 2 GB video, 100 MB PDF, 1 MB Markdown.');
  const who = h('div', 'vp-who');
  const id = `vp-who-${++uid}`;
  const line = h('p', 'vt-line vp-line');
  const pick = h('div', 'vp-pick');
  const pickBtn = btn('btn btn-small', { label: 'Choose people', icon: 'user-group' });
  const names = h('span', 'vp-names');
  pick.append(pickBtn, names);
  pickBtn.addEventListener('click', () => { if (onPick) onPick(st, draw); else { const d = peopleSheet({ chosen: st.p, max: LIMIT, members: members(), onDone: (c) => { st.p = c; draw(); } }); liveOpen(d); const q = d.querySelector('.sdk-search input'); if (q) q.focus(); } });
  function sentence() {
    if (st.v === 'everyone') return `Everyone in this ${W.space} can see what you add. This is the default. It applies to every file you add now.`;
    if (st.v === 'only-me') return 'Only you and the owners can see what you add. It applies to every file you add now.';
    return st.p.length ? `You, the owners and ${peopleWord(st.p.length)} can see what you add. It applies to every file you add now.` : 'Only you and the owners until you choose someone. It applies to every file you add now.';
  }
  // The radios are made once; a change updates the sentence and the people row in place, so the keyboard stays on the radio.
  function draw() {
    pick.hidden = st.v !== 'people';
    setLabel(pickBtn, st.p.length ? 'Change people' : 'Choose people');
    names.textContent = '';
    if (st.p.length) {
      names.append(...st.p.slice(0, 3).map((k) => nm(k)).flatMap((n, i, a) => (i < a.length - 1 ? [n, ', '] : [n])));
      if (st.p.length > 3) names.append(` and ${st.p.length - 3} more`);
    }
    line.textContent = sentence();
  }
  const label = h('span', 'sdk-label vp-label', 'Who can see this');
  label.id = id;
  const list = h('div', 'sdk-choice-list');
  list.setAttribute('role', 'radiogroup'); list.setAttribute('aria-labelledby', id);
  for (const [key, word, desc] of CHOICES) {
    const r = h('label', 'sdk-choice-row sdk-choice-boxed');
    const i = h('input'); i.type = 'radio'; i.name = id; i.checked = st.v === key;
    i.addEventListener('change', () => { st.v = key; draw(); });
    const t = h('span', 'sdk-choice-text'); t.append(h('span', 'sdk-choice-label', word), h('span', 'sdk-choice-desc', desc));
    r.append(i, t);
    list.append(r);
  }
  who.append(label, list, pick, line);
  draw();
  const opt = h('label', 'sdk-choice-row vt-where');
  const cb = h('input'); cb.type = 'checkbox';
  const txt = h('span', 'sdk-choice-text'); txt.append(h('span', 'sdk-choice-label', 'Remove where it was taken'), h('span', 'sdk-choice-desc', 'For pictures. Your choice is remembered.'));
  opt.append(cb, txt);
  const m = h('div', 'sdk-meter vt-quota');
  const mh = h('div', 'sdk-meter-head');
  const mine = visibleTo('lee').reduce((a, f) => a + f.size, 0);
  mh.append(h('span', 'sdk-meter-label', `Used in this ${W.space}`), h('span', 'sdk-meter-value', `${size(mine)} of ${size(CAP)}`));
  const bar = h('div', 'sdk-progress sdk-progress-sm');
  bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', `Space used in this ${W.space}`); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(Math.round(mine / CAP * 100)));
  const fill = h('span', 'sdk-progress-fill'); fill.style.setProperty('--pct', `${mine / CAP * 100}%`);
  bar.append(fill); m.append(mh, bar);
  p.append(head, drop, accept, who, opt, h('p', 'vt-notice', 'Videos keep their details, which can include where they were taken.'), m);
  return p;
}

// ---- the people picker ----
const members = () => Object.entries(CAST).filter(([k]) => k !== 'lee').map(([key, v]) => ({ key, ...v }));
// chosen: keys; members: everyone who may be chosen (not the adder, who always sees); query: the search text; locked: the adder's row.
function peopleSheet({ chosen = [], members: all, max = LIMIT, query = '', adder = 'lee', phone = false, error = false, onDone }) {
  const s = sheet({ title: 'Who can see this', width: 'form' });
  if (phone) s.dlg.classList.add('vp-phone');
  const st = { chosen: new Set(chosen), q: query };
  const body = h('div', 'vp-pickbody');
  const search = h('label', 'sdk-search');
  const inp = h('input'); inp.type = 'search'; inp.placeholder = 'Search people'; inp.setAttribute('aria-label', 'Search people'); inp.value = query;
  search.append(fa('magnifying-glass'), inp);
  const head = h('div', 'vp-chosen-head');
  const count = h('span', 'vp-count'); count.setAttribute('role', 'status');
  const chips = h('div', 'vp-chosen');
  chips.setAttribute('aria-label', 'Chosen people');
  const msg = h('div', 'sdk-banner vp-limit'); msg.dataset.kind = 'warn'; msg.setAttribute('role', 'status');
  const mic = h('span', 'sdk-banner-icon'); mic.append(fa('triangle-exclamation'));
  msg.append(mic, h('span', 'sdk-banner-text', `You can choose up to ${LIMIT} people. Take someone off to add another.`));
  const list = h('div', 'vp-people');
  list.setAttribute('role', 'group'); list.setAttribute('aria-label', 'People in this trip');
  const find = (k) => all.find((x) => x.key === k) || { key: k, name: nm(k) };
  function drawChips() {
    chips.textContent = '';
    const you = h('span', 'sdk-chip-tag vp-you'); you.append(av(adder, 20), `${nm(adder)} (you)`);
    chips.append(you);
    for (const k of st.chosen) {
      const c = h('span', 'sdk-chip-removable vp-chip');
      const x = h('button', 'sdk-chip-x'); x.type = 'button'; x.setAttribute('aria-label', `Take off ${find(k).name}`); x.append(fa('xmark'));
      x.addEventListener('click', () => { st.chosen.delete(k); redraw(); });
      c.append(av(k, 20), h('span', 'sdk-chip-label', find(k).name), x);
      chips.append(c);
    }
  }
  function drawList() {
    list.textContent = '';
    const q = st.q.trim().toLowerCase();
    const shown = all.filter((x) => !q || x.name.toLowerCase().includes(q));
    const full = st.chosen.size >= max;
    for (const x of shown.slice(0, 30)) {
      if (x.role === 'Owner') { // owners always can: shown, not choosable
        const r = h('div', 'sdk-choice-row vp-person vp-locked');
        r.append(av(x.key, 24), h('span', 'sdk-choice-label', x.name), h('span', 'vp-role', 'Always can'));
        list.append(r);
        continue;
      }
      const r = h('label', 'sdk-choice-row vp-person');
      const i = h('input'); i.type = 'checkbox'; i.checked = st.chosen.has(x.key); i.disabled = full && !i.checked;
      i.addEventListener('change', () => { if (i.checked) st.chosen.add(x.key); else st.chosen.delete(x.key); redraw(); });
      r.append(i, av(x.key, 24), h('span', 'sdk-choice-label', x.name), h('span', 'vp-role', x.role));
      list.append(r);
    }
    if (!all.length) list.append(h('p', 'vt-info-none', `No one else is in this ${W.space} yet. Only you and the owners can see what you add.`));
    else if (!shown.length) list.append(h('p', 'vt-info-none', `No one matches "${st.q.trim()}".`));
    else if (shown.length > 30) list.append(h('p', 'vt-info-none', `${shown.length - 30} more. Search to find them.`));
  }
  function redraw() {
    count.textContent = `${st.chosen.size} of ${max} chosen`;
    msg.hidden = st.chosen.size < max;
    drawChips(); drawList();
  }
  inp.addEventListener('input', () => { st.q = inp.value; drawList(); });
  head.append(h('span', 'sdk-label', 'Chosen'), count);
  const fail = h('div', 'sdk-banner vp-error'); fail.dataset.kind = 'danger'; fail.setAttribute('role', 'alert');
  const fic = h('span', 'sdk-banner-icon'); fic.append(fa('circle-exclamation'));
  fail.append(fic, h('span', 'sdk-banner-text', "We couldn't save who can see this. Nothing changed. Try again."));
  body.append(...(error ? [fail] : []), search, head, chips, msg, list);
  s.body.append(body);
  const done = okBtn('Done', 'btn btn-primary');
  s.foot.append(cancelBtn(), done);
  s.dlg.addEventListener('click', (e) => { if (e.target.closest('[data-ok]') && onDone) onDone([...st.chosen]); });
  redraw();
  return s.dlg;
}

// ---- the file window ----
const winCtx = { can: (what) => ['view', 'add', 'download'].includes(what), canRemove: () => false, remove: () => {}, share: () => {}, words: { module: W.module }, pdfSearch: true };
// Who can see this, in the file window's Info: a control for the adder and owners, a line for everyone else.
function whoBlock(f, { viewer, change, as, error = false }) {
  const x = as || vis(f);
  const box = h('div', 'vp-who-info');
  box.append(h('h4', 'vt-info-sub', 'Who can see this'));
  const adderName = nm(f.by);
  const word = x.v === 'everyone' ? `Everyone in this ${W.space}` : x.v === 'only-me' ? (f.by === keyOf(viewer) ? 'Only me' : `Only ${adderName}`) : 'Chosen people';
  if (change) {
    const b = btn('btn btn-small vp-change', { label: x.v === 'people' ? `${word} · ${x.p.length}` : word, icon: x.v === 'only-me' ? 'lock' : x.v === 'people' ? 'user-group' : 'users' });
    b.append(fa('caret-down', 'vp-caret'));
    b.setAttribute('aria-haspopup', 'menu');
    b.dataset.change = '';
    if (error) b.setAttribute('aria-describedby', 'vp-save-error');
    const items = () => radioItems(x.v);
    b.addEventListener('click', () => openHostMenu(b, items));
    box.append(b);
    if (error) {
      const e = h('p', 'sdk-error vp-save-error', "We couldn't change who can see this file. Nothing changed. Try again.");
      e.id = 'vp-save-error'; e.setAttribute('role', 'alert');
      e.prepend(fa('circle-exclamation'), ' ');
      box.append(e);
    }
    if (x.v === 'people' && !x.p.length) box.append(h('p', 'vt-info-none', 'No one chosen yet. Only you and the owners can see it.'));
    if (x.v === 'people' && x.p.length) {
      const names = h('ul', 'vp-namelist');
      for (const k of x.p) { const li = h('li'); li.append(av(k, 20), nm(k)); names.append(li); }
      box.append(names);
    }
    const owners = f.by === keyOf(viewer) ? 'You added this file, and owners and the admin can always see it.' : `${adderName} added this file. Owners and the admin can always see it.`;
    box.append(h('p', 'vt-info-none', owners));
  } else {
    // Read only: a person who may not change it. No names, no count; nothing at all for a file shared with everyone.
    if (x.v === 'everyone') return null;
    box.classList.add('vp-after');
    box.append(h('p', 'vp-readonly', 'Shared with you and others.'));
  }
  return box;
}
// Owner or admin looking at a file that was not shared with them: the window says so, and who can see it.
function ownerBlock(f) {
  const x = vis(f);
  const box = whoBlock(f, { viewer: 'noor', change: true });
  const note = h('div', 'sdk-banner vp-rights'); note.dataset.kind = 'info'; note.setAttribute('role', 'status');
  const ic = h('span', 'sdk-banner-icon'); ic.append(fa('eye'));
  note.append(ic, h('span', 'sdk-banner-text', `This file is not shared with you. You can open it because you are an owner. ${x.v === 'only-me' ? `${nm(f.by)} can see it.` : ''}`.trim()));
  box.prepend(note);
  return box;
}
// A Vault on the canvas with a file window open over it; the window's Info shows `block`.
function windowShot(box, { viewer, fileId, block, openSheet, phone = false, menu = false }) {
  const cv = createCanvas();
  box.append(cv.el);
  const v = vaultFrame({ viewer, onOpen: () => {} });
  cv.under.append(v.hold);
  const f = byId(fileId);
  const ctx = viewer === 'noor' ? { ...winCtx, can: (w) => ['view', 'add', 'download', 'remove_any', 'share'].includes(w) } : winCtx;
  const out = {
    destroy() { cv.destroy(); },
    after() {
      cv.open({ id: fileId, list: [f], ctx, returnFocus: () => cv.el, info: true, note: viewer === 'noor' ? () => 'Not shared with you' : undefined });
      const w = cv.windows[0];
      const root = w.body.getRootNode();
      if (root.adoptedStyleSheets && !root.adoptedStyleSheets.includes(PSHEET)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, PSHEET];
      const put = () => {
        const info = w.body.querySelector('.vt-info');
        if (info && !info.dataset.vpDone) {
        info.dataset.vpDone = '';
        for (const dt of info.querySelectorAll('.vt-info-list dt')) if (dt.textContent === 'Shared') dt.textContent = 'Share link'; // that row is about share links
        const b = block(f);
        if (b) { if (b.classList.contains('vp-after')) info.querySelector('.vt-info-list').after(b); else info.insertBefore(b, info.querySelector('.vt-info-list')); }
      }
      };
      put();
      new MutationObserver(put).observe(w.body, { childList: true, subtree: true });
      if (menu) { const t = w.body.querySelector('[data-change]'); if (t) heldMenu(cv.el, t, radioItems('people')); }
    },
  };
  return out;
}

// ---- dialogs held over a Vault ----
function dialogShot(box, { viewer = 'lee', form, dialog, phone = false, banner = null }) {
  const v = vaultFrame({ viewer, form: form ? form() : null, banner });
  box.append(v.hold);
  return { after() { const d = dialog(); heldDialog(v.hold, d); } };
}

// ---- other modules' cards: the Planner (the Itinerary) with files attached ----
function card({ tint, icon, kind, title, body, files, canEdit = false }) {
  const c = h('article', 'sdk-card-banded');
  c.dataset.tint = tint;
  const head = h('header', 'sdk-card-head');
  const mn = h('div', 'sdk-card-main');
  const ic = h('span', 'sdk-card-icon'); ic.append(fa(icon));
  mn.append(ic, h('h3', 'sdk-card-title', title), h('span', 'sdk-card-sub sdk-tint-text', kind));
  const m = h('button', 'menu-btn sdk-icon-btn btn-quiet btn-small'); m.type = 'button'; m.setAttribute('aria-label', 'Menu'); m.append(fa('ellipsis-vertical'));
  head.append(mn, m);
  const b = h('div', 'sdk-card-body');
  const blk = h('div', 'vt-files');
  const fh = h('div', 'vt-files-head');
  fh.append(h('span', '', 'Files'));
  if (canEdit) fh.append(btn('btn btn-small', { label: 'Add file', icon: 'paperclip' }));
  const ul = h('ul', 'vt-files-list');
  for (const it of files) { const li = h('li'); li.append(fileChip(it.file ? byId(it.file) : null, { state: it.state || 'ok', canEdit })); ul.append(li); }
  blk.append(fh, ul);
  b.append(...body);
  if (files.length || canEdit) b.append(blk); // like the real card: nothing at all when there is nothing to show and the viewer may not add
  c.append(head, b);
  return c;
}
function bookingFrame({ hotel, dinner, canEdit = false }) {
  const box = h('div', 'vt-other');
  const ins = h('div', 'vt-stay-ins');
  for (const [k, v] of [['Check in', 'Fri 24 Oct, 15:00'], ['Check out', 'Mon 27 Oct, 11:00']]) { const d = h('div'); d.append(h('small', '', k), h('b', '', v)); ins.append(d); }
  box.append(
    card({ tint: 'blue', icon: 'bed', kind: 'Hotel', title: 'Hotel Roma', body: [h('p', '', 'Via Marsala 12, Rome'), ins], files: hotel, canEdit }),
    card({ tint: 'pink', icon: 'utensils', kind: 'Meal', title: 'Dinner at Da Enzo', body: [h('p', '', 'Friday, 20:00, table for four')], files: dinner, canEdit }),
  );
  const frame = createModuleFrame({
    title: 'Itinerary', icon: 'map-location-dot', titlebar: { add: { label: 'Add' }, close: true },
    toolbar: [{ type: 'switch', id: 'view', label: 'View', value: 'days', options: [{ id: 'days', label: 'Days', icon: 'calendar-day' }, { id: 'list', label: 'List', icon: 'list' }] }, { type: 'title', text: 'Fri 24 Oct' }],
    content: inFrame(box), flush: true, status: { text: '2 things on this day' },
  });
  const hold = h('div', 'vt-hold');
  hold.append(frame.el);
  return hold;
}

// ================= 1. the Vault list =================
{
  const s = set('list', 'The Vault as a member sees it', 'Lee, a member. His own files that are not for everyone carry a small mark in the line under the name: Only me, or the number of people. Only he sees that mark on them. Files other people shared with him are plain rows. The files Mia kept to herself, the ones Sam shared with others, and the rental agreement are not in the list: no row, no gap, no count, no "hidden file" line. The line at the foot counts only what he can see, and so does the storage total. Added by in Filters lists only people who added a file he can see. Mia, who sees Lee\'s files only if they are shared with her, is the moderator below.');
  const p = pair(s);
  shot(p, { name: 'The list, 1280', note: 'The foot says 36 files: six of the forty-two are not shared with Lee, and he is not told. The marks are on Trevi fountain.jpg (3 people), Gelato stop.webp, Receipt, dinner on Friday.png (Only me) and the insurance (1 person).', h: 720, build: (box) => { const v = vaultFrame({ viewer: 'lee' }); box.append(v.hold); return {}; } });
  shot(p, { name: 'The Grid, 1280', note: 'The same files as cards. The marks sit on their own line under the facts, and the owner\'s "Not shared with you" the same way (set 5). Nothing else changes.', h: 720, build: (box) => { const v = vaultFrame({ viewer: 'lee', view: 'grid' }); box.append(v.hold); return {}; } });
  shot(p, { name: 'The Grid, on a phone (390)', note: 'Three across with the picture first, as the Vault\'s Grid is on a phone. The marks sit under the facts.', w: 390, h: 720, build: (box) => { const v = vaultFrame({ viewer: 'lee', view: 'grid', narrow: true }); box.append(v.hold); return {}; } });
  shot(p, { name: 'The list, on a phone (390)', note: 'The mark moves into the line under the name with the size and who added it; nothing is cut.', w: 390, h: 720, build: (box) => { const v = vaultFrame({ viewer: 'lee' }); box.append(v.hold); return {}; } });
}

// ================= 2. Add files =================
{
  const s = set('add', 'Add files: Who can see this', 'Under the drop area a line says who can see what is added, with the three choices. It applies to the whole batch being added, and the person can change it again for the next batch (the choice is not remembered: Everyone in this trip is the default every time). It replaces the line "Everyone in this trip can see what you add." Chosen people shows a Choose people button and the names chosen. Here it is drawn in the Add files area at the top of the Vault; in the dialog (Q4) it is the same block.');
  const p = pair(s);
  shot(p, { name: 'Everyone in this trip (the default)', h: 940, build: (box) => { const v = vaultFrame({ viewer: 'lee', form: addForm() }); box.append(v.hold); return {}; } });
  shot(p, { name: 'Chosen people, three picked', note: 'Choose people opens the picker below. The line counts the people.', h: 940, build: (box) => { const v = vaultFrame({ viewer: 'lee', form: addForm({ vis: 'people', people: ['ana', 'ben', 'chloe'] }) }); box.append(v.hold); return {}; } });
  const p2 = pair(s);
  shot(p2, { name: 'Chosen people, no one picked yet', note: 'Adding is not blocked: until someone is chosen, only the adder and the owners can see the files.', h: 940, build: (box) => { const v = vaultFrame({ viewer: 'lee', form: addForm({ vis: 'people' }) }); box.append(v.hold); return {}; } });
  shot(p2, { name: 'Only me', h: 940, build: (box) => { const v = vaultFrame({ viewer: 'lee', form: addForm({ vis: 'only-me' }) }); box.append(v.hold); return {}; } });
  shot(p2, { name: 'On a phone (390)', note: 'The three choices are rows of 44px; the buttons are 44px.', w: 390, h: 940, build: (box) => { const v = vaultFrame({ viewer: 'lee', form: addForm({ vis: 'people', people: ['ana', 'ben', 'chloe'] }) }); box.append(v.hold); return {}; } });
}

// ================= 3. the people picker =================
{
  const s = set('picker', 'The people picker', 'A dialog from Choose people. Names with a small avatar (recommendation; Thomas to rule: the plan\'s question d): a name is what people look for, and the avatar helps tell two people with the same first name apart. Search the trip\'s members, tick them in the list or take them off with the x on their chip, and a count of N of 200 stays in view. The adder is always in (the first chip, not removable). At 200 the rest of the list switches off and a message says why.');
  const phoneBase = { chosen: ['ana', 'ben', 'chloe'], members: members() };
  const p = pair(s);
  const over = (name, note, dlg, opts = {}) => shot(p, { name, note, w: opts.w, h: opts.h || 940, build: (box) => { const v = vaultFrame({ viewer: 'lee', form: addForm({ vis: 'people', people: ['ana', 'ben', 'chloe'] }) }); box.append(v.hold); return { after: () => heldDialog(v.hold, dlg()) }; } });
  over('Three chosen', 'The list shows everyone in the trip who is not the adder, with their role in quiet words. Owners are shown with Always can and cannot be chosen; moderators can.', () => peopleSheet(phoneBase));
  over('Searching', 'The list narrows as the person types; the chosen stay on their chips.', () => peopleSheet({ ...phoneBase, query: 'e' }));
  over('At the limit: 200 of 200', 'A big trip (the picker lists the first thirty and asks for a search). Nothing more can be ticked, a message says why, and the chips scroll.', () => peopleSheet({ chosen: BIG.slice(BIG.length - LIMIT).map((x) => x.key), members: BIG, max: LIMIT }));
  over('At the limit, on a phone (390)', 'The chips wrap; three whole rows show and the rest scroll a row at a time, so a chip is never cut in half.', () => peopleSheet({ chosen: BIG.slice(BIG.length - LIMIT).map((x) => x.key), members: BIG, max: LIMIT, phone: true }), { w: 390, h: 940 });
  over('A save that failed', 'Done was pressed and the save did not go through. The line sits at the top of the dialog, in the danger colour with an icon and words; the choices stay as they were, so nothing is lost and the person presses Done again.', () => peopleSheet({ ...phoneBase, error: true }));
  over('A search with no match', 'The list says so; the chosen stay on their chips.', () => peopleSheet({ ...phoneBase, query: 'zzz' }));
  over('No one to choose', 'A trip with only the adder.', () => peopleSheet({ chosen: [], members: [] }));
  over('On a phone (390)', 'A full-width sheet; the rows and buttons are 44px.', () => peopleSheet({ ...phoneBase, phone: true }), { w: 390, h: 940 });
}

// ================= 4. the file window =================
{
  const s = set('window', 'The file window: Who can see this', 'In the file window\'s Info. For the adder (and an owner) it is the first block, above the facts, with a control: a button that shows the setting and opens the menu with the three choices; Chosen people also lists the names. Anyone else gets it after the facts, as one read-only line with no names and no count ("Shared with you and others."), and nothing at all for a file shared with everyone. The Info row that was called Shared is now Share link, so the two never clash. The control is the host\'s menu (host.menu.show), as the Vault\'s other menus.');
  const p = pair(s);
  shot(p, { name: 'The adder (Lee), his file', note: 'Trevi fountain.jpg, chosen people. The button opens the choices.', h: 720, build: (box) => windowShot(box, { viewer: 'lee', fileId: 'f02', block: (f) => whoBlock(f, { viewer: 'lee', change: true }) }) });
  shot(p, { name: 'Someone it is shared with (Sam)', note: 'The same file. A read-only line after the facts, no control.', h: 720, build: (box) => windowShot(box, { viewer: 'sam', fileId: 'f02', block: (f) => whoBlock(f, { viewer: 'sam', change: false }) }) });
  const p2 = pair(s);
  shot(p2, { name: 'Chosen people, no one chosen yet', note: 'A file of Lee\'s with an empty list.', h: 720, build: (box) => windowShot(box, { viewer: 'lee', fileId: 'f02', block: (f) => whoBlock(f, { viewer: 'lee', change: true, as: { v: 'people', p: [] } }) }) });
  shot(p2, { name: 'Shared with everyone: no block (Sam)', note: 'A file in the default state shows no block to a viewer.', h: 720, build: (box) => windowShot(box, { viewer: 'sam', fileId: 'f30', block: (f) => whoBlock(f, { viewer: 'sam', change: false }) }) });
  const p4 = pair(s);
  shot(p4, { name: 'A change that failed to save', note: 'Lee tried to change Trevi fountain.jpg and the save did not go through. The line sits under the control in the danger colour, with an icon; the control shows the setting that is still true.', h: 720, build: (box) => windowShot(box, { viewer: 'lee', fileId: 'f02', block: (f) => whoBlock(f, { viewer: 'lee', change: true, error: true }) }) });
  const p3 = pair(s);
  shot(p3, { name: 'The menu open', note: 'Three radio choices; a change that narrows who sees a file with links asks first (section 9).', h: 720, build: (box) => windowShot(box, { viewer: 'lee', fileId: 'f02', block: (f) => whoBlock(f, { viewer: 'lee', change: true }), menu: true }) });
  shot(p3, { name: 'On a phone (390)', note: 'The window is a full-screen sheet; the control is a 44px button.', w: 390, h: 720, build: (box) => windowShot(box, { viewer: 'lee', fileId: 'f02', block: (f) => whoBlock(f, { viewer: 'lee', change: true }) }) });
}

// ================= 5. owner or admin =================
{
  const s = set('owner', 'The owner or admin, a file not shared with them', 'Noor is an owner. She sees every file in the list; the ones not shared with her carry "Not shared with you" in the line under the name (so nobody is surprised, plan decision 2). Opening one works. The file window says so in a notice at the top of Info, names who can see it, and has the same control to change it. The admin sees the same.');
  const p = pair(s);
  shot(p, { name: 'The owner\'s list', h: 720, build: (box) => { const v = vaultFrame({ viewer: 'noor' }); box.append(v.hold); return {}; } });
  shot(p, { name: 'The owner\'s Grid', note: '"Not shared with you" on its own line under the facts of each card.', h: 720, build: (box) => { const v = vaultFrame({ viewer: 'noor', view: 'grid' }); box.append(v.hold); return {}; } });
  shot(p, { name: 'The owner opens Mia\'s Only me picture', note: 'Bridge over the Tiber.jpg. The notice, then who can see it, then the control.', h: 720, build: (box) => windowShot(box, { viewer: 'noor', fileId: 'f17', block: (f) => ownerBlock(f) }) });
}

// ================= 6. the moderator, and the permission =================
{
  const s = set('moderator', 'The moderator, and See every file', 'Mia is a moderator. Without See every file she sees what is for everyone, what is hers and what is shared with her; Lee\'s Only me files and his file for three other people are not in her list (no row, no count). Nothing in the Vault says the list is shorter, and the status line says only what she can see. The setting is explained where it lives: the row\'s description in Settings, Roles. Remove (for files that others added) works only on files she can see. With See every file on, a moderator sees what an owner sees. The permission is a row in Settings, Roles, in the Vault\'s group: off for moderators by default, locked on for owners, and locked off for guests (a guest has no Vault at all).');
  const p = pair(s);
  shot(p, { name: 'A moderator without See every file (the default)', note: 'No notice and no word in the status line: the list just is what she can see.', h: 720, build: (box) => { const v = vaultFrame({ viewer: 'mia' }); box.append(v.hold); return {}; } });
  shot(p, { name: 'A moderator with See every file on', note: 'Like the owner\'s list, with the same "Not shared with you" marks.', h: 720, build: (box) => { const v = vaultFrame({ viewer: 'mia-all' }); box.append(v.hold); return {}; } });
  const wrap = h('section', 'pp-state');
  wrap.append(h('h4', 'pp-state-name', 'Settings, Roles: the new row'));
  wrap.append(h('p', 'pp-state-note', 'The Vault\'s group in the roles grid (the same grid as admin.js draws): one new row, See every file. Owners are locked on, as in every row. Guests are locked off, with the reason in the tooltip. The row\'s description is the one place that explains the setting. The other rows are today\'s.'));
  const page = h('div', 'vp-page');
  const tw = h('div', 'sdk-table-wrap');
  const tb = h('table', 'sdk-table');
  tb.setAttribute('aria-label', 'What each kind of person can do');
  const thead = h('thead'); const hr = h('tr');
  const th0 = h('th'); th0.scope = 'col'; th0.append(h('span', 'visually-hidden', 'What they can do'));
  hr.append(th0);
  for (const r of ['Owner', 'Moderator', 'Member', 'Guest']) { const th = h('th', 'is-center', r); th.scope = 'col'; hr.append(th); }
  thead.append(hr);
  const tbody = h('tbody');
  const grp = h('tr', 'sdk-table-group'); const gh = h('th', '', W.module); gh.scope = 'colgroup'; gh.colSpan = 5; grp.append(gh); tbody.append(grp);
  const PERMS = [
    ["See the trip's files", [1, 1, 1, 0]], ['Add files', [1, 1, 1, 0]], ['Download files', [1, 1, 1, 0]], ['Remove files other people added', [1, 1, 0, 0]], ['Make share links', [1, 1, 0, 0]],
    ['See every file', [1, 0, 0, 0], true, 'Lets this role open files that were not shared with them. Off by default for moderators; owners always can.'],
  ];
  for (const [label, on, isNew, desc] of PERMS) {
    const tr = h('tr');
    if (isNew) tr.id = 'vp-see-all';
    const th = h('th', '', label); th.scope = 'row';
    if (isNew) { th.append(h('span', 'vp-new', ' New'), h('span', 'vp-desc', desc)); th.title = desc; }
    tr.append(th);
    ['owner', 'moderator', 'member', 'guest'].forEach((role, i) => {
      const td = h('td', 'is-center');
      const c = h('input'); c.type = 'checkbox'; c.checked = Boolean(on[i]);
      c.setAttribute('aria-label', `${label}, ${role[0].toUpperCase()}${role.slice(1)}`);
      if (role === 'owner') { c.disabled = true; c.title = 'Owners can always do this'; }
      if (role === 'guest' && isNew) { c.disabled = true; c.title = 'Guests can never do this'; }
      if (isNew && role !== 'guest' && role !== 'owner') c.title = desc;
      td.append(c); tr.append(td);
    });
    tbody.append(tr);
  }
  tb.append(thead, tbody);
  tw.append(tb);
  page.append(h('h3', 'vp-page-title', 'Roles'), h('p', 'vt-info-none', 'What each kind of person can do in this environment. Tick a box to save it. See every file shows a person every file in a trip, including ones not shared with them.'), tw);
  wrap.append(page);
  s.append(wrap);
}

// ================= 7. links from objects =================
{
  const s = set('links', 'A booking with a file attached', 'A link follows the file (plan decision 7). Someone who cannot see the file sees the link as hidden, with the chip\'s existing wording "Not available to you": never the name, never "File removed". After the file is deleted, a person who could never see it sees nothing where the link was, and a person who could see it sees "File removed" (with Remove link for someone who may edit the booking). To show a file to everyone on a booking, share the file with everyone first.');
  const hotelOk = [{ file: 'f30' }, { file: 'f37' }];
  const p = pair(s);
  shot(p, { name: 'A member who cannot see two of the files', note: 'The rental agreement and the restaurant booking are hidden from Lee. The chips say hidden and no more.', h: 720, build: (box) => { box.append(bookingFrame({ hotel: [{ file: 'f30' }, { state: 'hidden' }], dinner: [{ state: 'hidden' }] })); return {}; } });
  shot(p, { name: 'A person who can see them', note: 'Noor, an owner (or Sam, to whom both are shared).', h: 720, build: (box) => { box.append(bookingFrame({ hotel: hotelOk, dinner: [{ file: 'f36' }] })); return {}; } });
  const p2 = pair(s);
  shot(p2, { name: 'After deletion: a person who could never see the file', note: 'Nothing where the link was: no chip, no "File removed". Lee, on the same booking.', h: 720, build: (box) => { box.append(bookingFrame({ hotel: [{ file: 'f30' }], dinner: [] })); return {}; } });
  shot(p2, { name: 'After deletion: a person who could see it', note: 'File removed, with Remove link for someone who may edit the booking.', h: 720, build: (box) => { box.append(bookingFrame({ hotel: [{ file: 'f30' }, { state: 'removed' }], dinner: [{ state: 'removed' }], canEdit: true })); return {}; } });
}

// ================= 8. share links =================
{
  const s = set('share', 'Making a share link for a restricted file', 'Only a person who can see the file can make a link for it; for anyone else Share is not there, for that file. The dialog says what the file is, says that anyone with the link can open it (a link reaches people the file is not shared with in the Vault), and says that the link ends if its maker can no longer see the file. The confirmation after the link is made says the ending once more.');
  const f = byId('f02');
  const addLine = (dlg, asLink) => {
    const box = h('div', 'vp-restrict');
    const tag = h('span', 'sdk-chip-tag'); tag.append(fa('user-group'), 'Chosen people · 3');
    const mk = h('div', 'sdk-banner'); mk.dataset.kind = 'info';
    const ic = h('span', 'sdk-banner-icon'); ic.append(fa('circle-info'));
    mk.append(ic, h('span', 'sdk-banner-text', asLink ? 'The link ends if you can no longer see this file.' : 'Anyone with this link can open this file, even people it is not shared with here. The link ends if you can no longer see the file.'));
    box.append(tag, mk);
    const files = dlg.querySelector('.vt-share-files');
    files.after(box);
    return dlg;
  };
  const p = pair(s);
  const over = (name, note, dlg) => shot(p, { name, note, h: 800, build: (box) => { const v = vaultFrame({ viewer: 'lee' }); box.append(v.hold); return { after: () => heldDialog(v.hold, dlg()) }; } });
  over('Make link', 'Trevi fountain.jpg, for chosen people. The form is today\'s.', () => addLine(shareSheet(W, [f], {}), false));
  over('Link made', 'The line that matters once more, short, with the address.', () => addLine(shareSheet(W, [f], { mode: 'made' }), true));
}

// ================= 9. changing who can see a file =================
{
  const s = set('change', 'Changing who can see a file: the question', 'Widening is never asked. Narrowing a file that has links from objects or share links asks first, and says what happens: the links show hidden to the people who lose sight of the file; a share link ends if its maker can no longer see the file (a link made by an owner or the adder does not end). A narrowing with no links and no share links just happens.');
  const effects = (rows) => {
    const ul = h('ul', 'vp-effects');
    for (const [icon, text] of rows) { const li = h('li'); li.append(fa(icon), h('span', '', text)); ul.append(li); }
    return ul;
  };
  const ask = (rows, lead, action) => {
    const x = sheet({ title: 'Change who can see this file?', width: 'confirm', kind: 'destructive' });
    x.body.append(h('p', '', lead), effects(rows));
    x.foot.append(cancelBtn(), okBtn(action, 'btn btn-danger solid'));
    return x.dlg;
  };
  const p = pair(s);
  const over = (name, note, dlg) => shot(p, { name, note, h: 720, build: (box) => { const v = vaultFrame({ viewer: 'lee' }); box.append(v.hold); return { after: () => heldDialog(v.hold, dlg()) }; } });
  over('Everyone to Only me, with links and a share link', 'Hotel Roma booking.pdf, added by Lee. The count leaves out the owners, who keep access, and Lee.', () => ask([
    ['users', `${peopleWord(LOSE)} can no longer see the file.`],
    ['link', `Linked from 2 places: Hotel Roma in the Itinerary and Hotels near Termini in Research. For those ${LOSE} people the links show hidden.`],
    ['share-nodes', 'In 1 share link, "Rome, October", made by Mia. It ends, because Mia can no longer see the file.'],
  ], 'Hotel Roma booking.pdf will be seen only by you and the owners.', 'Make it only me'));
  over('Chosen people to fewer people, with a link', 'Trevi fountain.jpg, added by Lee. No share link, so one line less.', () => ask([
    ['users', 'Ben and Sam can no longer see the file.'],
    ['link', 'Linked from 1 place: Day 3 in the Itinerary. For Ben and Sam the link shows hidden.'],
  ], 'Trevi fountain.jpg will be seen by you, the owners and Ana.', 'Remove those people'));
}

// ---- jump list, dock ----
main.append(sec);
requestAnimationFrame(() => { runDeferred(); });
const pageJump = D.querySelector('nav.pp-jump[aria-label="Jump to a section of the page"]');
if (pageJump) {
  const b = h('button', 'btn btn-small', 'Vault privacy');
  b.type = 'button';
  b.addEventListener('click', () => D.getElementById('pp-vault-privacy-name')?.scrollIntoView({ block: 'start' }));
  pageJump.append(b);
}
if (location.hash === '#pp-vault-privacy') setTimeout(() => D.getElementById('pp-vault-privacy-name')?.scrollIntoView({ block: 'start' }), 400);
