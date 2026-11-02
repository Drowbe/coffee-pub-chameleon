// The Vault section of the Prototype (Thomas, 2026-11-02): the Vault module drawn for him to judge before anything is built
// (documentation/plans/plan-attachments-vault.md; the process is design on the Prototype, lock the components, then build the module).
// Nothing here ships. The Vault is drawn in the real module frame (createModuleFrame) with the sample of prototype-vault-data.js, in every
// state the plan describes, and once to try. Where the plan is silent or open, both ways are drawn (the switches under the heading, and
// pairs side by side), and the questions for Thomas are listed at the end. The pieces are in prototype-vault-ui.js, the module in
// prototype-vault-app.js, the viewers, the dialogs, the public page in their own files; the styles in prototype-vault.css.
import { createVault, TRIAL, redrawAll } from './prototype-vault-app.js';
import { GB } from './prototype-vault-data.js';
import { D, h, btn, heldMenu } from './prototype-vault-ui.js';
import { buildAddAndViewers, buildNarrowAndPermissions } from './prototype-vault-sets.js';
import { buildOther, buildShare, buildDelete, buildQuestions } from './prototype-vault-more.js';

const main = D.getElementById('pp-main');
const sec = h('section', 'pp-group vt');
sec.id = 'pp-vault';
sec.setAttribute('aria-labelledby', 'pp-vault-name');
const title = h('h2', 'pp-group-name', 'Vault: the module, every state');
title.id = 'pp-vault-name';
sec.append(title, h('p', 'pp-state-note', 'The Vault (plan-attachments-vault.md) in the real module frame, with a made-up trip to Rome: forty-two files, all types. The server half is built; this is the screen and the pieces to lock before the module. Try the first panel for real (search, Filters, Select, the menus, Add files with the picker or a drop, the viewers). Where the plan is silent the two ways are drawn side by side or on the switches below; the questions for Thomas are listed at the end. Narrow the page width above: the Vault answers to its own width, not the page\'s.'));

// ---- the switches for what the plan leaves open (every Vault below is drawn again) ----
const trials = h('div', 'vt-trials');
trials.setAttribute('role', 'group');
trials.setAttribute('aria-label', 'Vault trials');
function trialSwitch(key, label, options) {
  const wrap = h('div', 'vt-trial');
  const l = h('span', 'vt-trial-label', label);
  const box = h('div', 'mf-switch');
  box.setAttribute('role', 'radiogroup');
  box.setAttribute('aria-label', label);
  const draw = () => {
    box.textContent = '';
    for (const [id, text] of options) {
      const b = h('button', 'mf-switch-btn');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(TRIAL[key] === id)); b.tabIndex = TRIAL[key] === id ? 0 : -1;
      b.append(h('span', '', text));
      b.addEventListener('click', () => { TRIAL[key] = id; draw(); redrawAll(); box.querySelector('[aria-checked="true"]').focus(); });
      box.append(b);
    }
  };
  draw();
  wrap.append(l, box);
  trials.append(wrap);
}
trialSwitch('words', 'Template words', [['vault', 'Vault'], ['documents', 'Documents (travel)'], ['handouts', 'Handouts (games)']]);
trialSwitch('sort', 'Sorting (Q2)', [['filters', 'In Filters'], ['button', 'A button']]);
trialSwitch('select', 'Choosing (Q3)', [['button', 'Select button'], ['ticks', 'Ticks always']]);
trialSwitch('add', 'Add files (Q4)', [['panel', 'Panel in the module'], ['dialog', 'Dialog']]);
trialSwitch('info', 'Info in the viewer (Q5)', [['panel', 'Side panel'], ['under', 'Under the file']]);
trialSwitch('pdfSearch', 'PDF search (Q6)', [[true, 'Shown'], [false, 'Left out']]);
trialSwitch('removeWhere', 'Remove where taken (Q7)', [['off', 'Off by default'], ['on', 'On by default']]);
sec.append(trials);

// ---- the sub jump list ----
const jump = h('nav', 'pp-jump');
jump.setAttribute('aria-label', 'Jump to a part of the Vault');
jump.append(h('span', 'pp-jump-label', 'Jump to'));
sec.append(jump);

main.append(sec);
const sets = [];
function set(id, name, note) {
  const s = h('section', 'vt-set');
  s.id = `vt-${id}`;
  s.setAttribute('aria-labelledby', `vt-${id}-name`);
  const hh = h('h3', 'vt-set-name', name);
  hh.id = `vt-${id}-name`;
  s.append(hh);
  if (note) s.append(h('p', 'pp-state-note', note));
  sec.append(s);
  sets.push({ id, name, s });
  const b = btn('btn btn-small', { label: name });
  b.addEventListener('click', () => { hh.scrollIntoView({ block: 'start' }); s.classList.add('pp-flash'); setTimeout(() => s.classList.remove('pp-flash'), 900); });
  jump.append(b);
  return s;
}

// One state: its name and note, the frame (or a plain picture) on the canvas colour, then whatever is held open in it.
function state(into, { name, note, w, h: hh, cfg, after, level = 'h4' }) {
  const wrap = h('section', 'pp-state');
  const head = h(level, 'pp-state-name', name);
  wrap.append(head);
  if (note) wrap.append(h('p', 'pp-state-note', note));
  const box = h('div', 'pp-frame vt-frame');
  if (w) box.dataset.w = String(w);
  if (hh) box.dataset.h = String(hh);
  const api = createVault(cfg || {});
  box.append(api.el);
  wrap.append(box);
  into.append(wrap);
  if (after) after(api, box);
  return { api, box, wrap };
}
const pair = (parent) => { const p = h('div', 'vt-pair'); parent.append(p); return p; };

// ================= 1. try it =================
{
  const s = set('try', 'The Vault, to try', 'Real: the toolbar is the frame\'s (View switch, the sort in words, Search files, Filters), the "+" is Add files, Select is in the title bar, Share and Settings are the standard actions. Click a file to open it, with Back, Previous and Next. Choose files or drop real files on it: the type and size rules run as the server\'s do and a file is "sent" over a moment. Everything is made up; nothing is stored.');
  state(s, { name: 'The Vault as a member (Lee) sees it', cfg: { role: 'member' }, level: 'h4' });
}
// ================= 2. List and Grid =================
{
  const s = set('views', 'List and Grid', 'The List is one row a file: the picture or a type icon, the name, the type and size in quiet words, who added it and when, the links and share marks, the more button. The Grid is a card a file in the stacked head with the circle icon (the Cards block): the type in the kind\'s colour above the name, the picture below. Both are the pieces named in plan section 10. Below 480px of module width the grid is three across, thumbnails with the name under (the second drawing), because the stacked head has no room.');
  const p = pair(s);
  state(p, { name: 'List', note: 'Newest first, as it opens.', cfg: { role: 'member', state: { view: 'list' } } });
  state(p, { name: 'Grid, stacked head', note: 'The card of the Cards block: a circle icon, the kind label above the name, the picture, one line of facts.', cfg: { role: 'member', state: { view: 'grid' }, trial: { gridCard: 'banded' } } });
  const p2 = pair(s);
  state(p2, { name: 'Grid, picture first (the other way)', note: 'The picture fills the card with the name under it; the tick and the more button sit on the picture. Denser, closer to the plan\'s words ("square thumbnails, the name under each"). Q1.', cfg: { role: 'member', state: { view: 'grid' }, trial: { gridCard: 'thumb' } } });
  state(p2, { name: 'List, sorted by name', note: 'Sorting is in Filters (Sort by) or a button beside the View switch (Q2); both are on the switch above.', cfg: { role: 'member', state: { view: 'list', sort: 'name' } } });
}
// ================= 3. choosing several =================
{
  const s = set('select', 'Choosing several', 'The title bar action Select turns it on; the toolbar becomes Done, the count and Choose all, Download, Share and Remove (the frame folds them into More when it is narrow). Remove is off while the choice holds a file somebody else added. Q3 asks whether ticks should always show instead.');
  const p = pair(s);
  state(p, { name: 'List, three chosen', cfg: { role: 'member', state: { view: 'list', selecting: true, sel: ['f02', 'f05', 'f10'] } } });
  state(p, { name: 'Grid, two chosen', cfg: { role: 'moderator', state: { view: 'grid', selecting: true, sel: ['f09', 'f12'] } } });
  state(p, { name: 'Ticks always shown (the other way)', note: 'No Select button needed; the tick is on every row and card, and a click on a row still opens it.', cfg: { role: 'member', state: { view: 'list' }, trial: { select: 'ticks' } } });
}
// ================= 4. menus =================
{
  const s = set('menus', 'The menus', 'The host\'s own menu (host-menu.js), copied open so it can be seen: a file\'s more button in the List and the Grid (Open, Download, Rename, Share, Where it is used, then Remove in red), the title bar menu, and the sort menu. What a person may do changes the menu: a member sees Remove only on their own files.');
  const p = pair(s);
  state(p, { name: 'A row\'s more button (a member, their own file)', cfg: { role: 'member', state: { view: 'list' } }, h: 480, after: (api, box) => { heldMenu(api.el, api.app.querySelector('[data-menu="f13"]'), api.fileMenuFor('f13')); } });
  state(p, { name: 'A card\'s more button (a member, someone else\'s file)', cfg: { role: 'member', state: { view: 'grid' } }, h: 480, after: (api, box) => { heldMenu(api.el, api.app.querySelector('[data-menu="f09"]'), api.fileMenuFor('f09')); } });
  const p2 = pair(s);
  state(p2, { name: 'A moderator, a file that is linked and shared', cfg: { role: 'moderator', state: { view: 'list' } }, h: 480, after: (api, box) => { heldMenu(api.el, api.app.querySelector('[data-menu="f30"]'), api.fileMenuFor('f30')); } });
  state(p2, { name: 'The title bar menu (a moderator)', cfg: { role: 'moderator', state: { view: 'list' } }, h: 480, after: (api, box) => { heldMenu(api.el, api.el.querySelector('.mf-titlebar-menu'), api.frame.titlebarMenu()); } });
}
// ================= 5. search and filters =================
{
  const s = set('find', 'Search and Filters', 'Search matches the name, who added it and the type; the match is marked. Filters has Type (with counts), Added by, Added, Shared (for people who can share) and Linked, and the sort when Q2 is "In Filters". The status line says what is shown in words. Clear filters empties them all.');
  const p = pair(s);
  state(p, { name: 'Search for "rome"', cfg: { role: 'member', state: { view: 'list', query: 'rome' } } });
  state(p, { name: 'Filters open', cfg: { role: 'member', state: { view: 'list', types: ['image'] } }, h: 800, after: (api, box) => { heldMenu(api.el, api.el.querySelector('.mf-filters'), null); } });
  const p2 = pair(s);
  state(p2, { name: 'Filtered: pictures added by Mia this month', cfg: { role: 'member', state: { view: 'grid', types: ['image'], by: 'mia', when: 'month' } } });
  state(p2, { name: 'Nothing matches', cfg: { role: 'member', state: { view: 'list', query: 'zzz', types: ['video'] } } });
}
// ================= 6. empty and quota =================
{
  const s = set('empty', 'Empty, and the room left', 'The empty state says what to do and has Add files. The status line is the count and the room ("42 files · 1.2 GB of 5 GB"); it turns to a warning at 80% and says Full at the limit.');
  const p = pair(s);
  state(p, { name: 'No files yet', cfg: { role: 'member', empty: true, state: { usedBytes: 0 } } });
  state(p, { name: 'No files yet, and a member who cannot add', cfg: { role: 'member-noadd', empty: true, state: { usedBytes: 0 } } });
  const p2 = pair(s);
  state(p2, { name: 'Almost full', note: '4.4 GB of 5 GB: the status line warns, the banner says what to do.', cfg: { role: 'member', state: { usedBytes: 4.4 * GB, notice: { kind: 'warn', text: 'Almost full. Remove some files to make room: 4.4 GB of 5 GB used in this trip.' } } } });
  state(p2, { name: 'Full', note: '5 GB of 5 GB: adding is off and says why.', cfg: { role: 'member', state: { usedBytes: 5 * GB, capBytes: 5 * GB, panel: true, notice: { kind: 'danger', text: "No room left in this trip's Vault (5 GB). Remove some files to add more." } } } });
}

const helpers = { set, state, pair };
buildAddAndViewers(helpers);
buildOther(helpers);
buildShare(helpers);
buildDelete(helpers);
buildNarrowAndPermissions(helpers);
buildQuestions(helpers);
// the page's jump list gets its Vault button (the page's list is the Phone script's)
const pageJump = D.querySelector('nav.pp-jump[aria-label="Jump to a section of the page"]');
if (pageJump) {
  const b = h('button', 'btn btn-small', 'Vault');
  b.type = 'button';
  b.addEventListener('click', () => D.getElementById('pp-vault-name')?.scrollIntoView({ block: 'start' }));
  pageJump.append(b);
}

