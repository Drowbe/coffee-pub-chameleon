// The Prototype's Vault section, the third part (Thomas, 2026-11-02): the file chip and "File missing" in another module's card, the chooser,
// sharing (the sheet, the list of links, the public /shared page), deleting and erasing, and the questions for Thomas.
import { createModuleFrame } from '/module-frame.js';
import { FILES, SHARES, byId, TOTAL_BYTES } from './prototype-vault-data.js';
import { h, fa, btn, fileChip, WORDS, inShadow, lazy } from './prototype-vault-ui.js';
import { TRIAL } from './prototype-vault-app.js';
import { heldDialog, removeSheet, shareSheet, shareListSheet, renameSheet, usesSheet, turnOffShareSheet, eraseSpaceSheet, uninstallSheet, offInSpaceSheet, pickSheet } from './prototype-vault-dialogs.js';
import { sharedPage } from './prototype-vault-shared.js';

const W = () => WORDS[TRIAL.words];

// A frame of another module (or a plain one), on the canvas colour.
function plain(into, { name, note, w, h: hh, frame, after, level = 'h4' }) {
  const wrap = h('section', 'pp-state');
  wrap.append(h(level, 'pp-state-name', name));
  if (note) wrap.append(h('p', 'pp-state-note', note));
  const box = h('div', 'pp-frame vt-frame');
  if (w) box.dataset.w = String(w);
  if (hh) box.dataset.h = String(hh);
  wrap.append(box);
  into.append(wrap);
  const out = { f: null, box, wrap };
  lazy(box, () => {
    const f = createModuleFrame(frame);
    out.f = f;
    const hold = h('div', 'vt-hold');
    hold.append(f.el);
    f.hold = hold;
    box.append(hold);
    return after ? () => after(f, box) : undefined;
  }, () => { out.f = null; });
  return out;
}

// The object's Files block (host.ui.fileChips): a head with Add file, then a chip for each file.
function filesBlock(items, { canEdit = true } = {}) {
  const blk = h('div', 'vt-files');
  const head = h('div', 'vt-files-head');
  head.append(h('span', '', 'Files'));
  if (canEdit) head.append(btn('btn btn-small', { label: 'Add file', icon: 'paperclip' }));
  const ul = h('ul', 'vt-files-list');
  for (const it of items) { const li = h('li'); li.append(fileChip(it.file ? byId(it.file) : null, { state: it.state || 'ok', canEdit })); ul.append(li); }
  blk.append(head, ul);
  return blk;
}
const tag = (text) => h('span', 'sdk-chip-tag', text);
function card({ tint, icon, kind, title, body, files, canEdit }) {
  const c = h('article', 'sdk-card-banded');
  c.dataset.tint = tint;
  const head = h('header', 'sdk-card-head');
  const main = h('div', 'sdk-card-main');
  const ic = h('span', 'sdk-card-icon'); ic.append(fa(icon));
  main.append(ic, h('h3', 'sdk-card-title', title), h('span', 'sdk-card-sub sdk-tint-text', kind));
  const m = h('button', 'menu-btn sdk-icon-btn btn-quiet btn-small'); m.type = 'button'; m.setAttribute('aria-label', 'Menu'); m.append(fa('ellipsis-vertical'));
  head.append(main, m);
  const b = h('div', 'sdk-card-body');
  b.append(...body, filesBlock(files, { canEdit }));
  c.append(head, b);
  return c;
}
function itinerary({ canEdit = true } = {}) {
  const box = h('div', 'vt-other');
  const ins = h('div', 'vt-stay-ins');
  for (const [k, v] of [['Check in', 'Fri 24 Oct, 15:00'], ['Check out', 'Mon 27 Oct, 11:00']]) { const d = h('div'); d.append(h('small', '', k), h('b', '', v)); ins.append(d); }
  const chips = h('div', 'sdk-cluster'); chips.append(tag('Double room'), tag('2 guests'), h('span', 'sdk-chip-tag', 'RM-48213-X'));
  box.append(
    card({ tint: 'blue', icon: 'bed', kind: 'Hotel', title: 'Hotel Roma', body: [h('p', '', 'Via Marsala 12, Rome'), ins, chips], canEdit, files: [{ file: 'f30' }, { file: 'f07' }] }),
    card({ tint: 'orange', icon: 'plane', kind: 'Flight', title: 'Home to Rome', body: [h('p', '', 'Departs 09:40, arrives 12:05')], canEdit, files: [{ file: 'f29' }, { state: 'removed' }] }),
    card({ tint: 'green', icon: 'landmark', kind: 'Activity', title: 'Colosseum, 10:00', body: [h('p', '', 'Skip-the-line, 2 tickets')], canEdit, files: [{ file: 'f31' }, { file: 'f33', state: 'missing' }] }),
    card({ tint: 'pink', icon: 'utensils', kind: 'Meal', title: 'Dinner at Da Enzo', body: [h('p', '', 'Friday, 20:00, table for four')], canEdit, files: [{ state: 'hidden' }] }),
  );
  return box;
}
const itineraryFrame = (canEdit = true) => ({
  title: 'Itinerary', icon: 'map-location-dot', titlebar: { add: { label: 'Add' }, close: true },
  toolbar: [{ type: 'switch', id: 'view', label: 'View', value: 'days', options: [{ id: 'days', label: 'Days', icon: 'calendar-day' }, { id: 'list', label: 'List', icon: 'list' }] }, { type: 'title', text: 'Fri 24 Oct' }],
  content: inShadow(itinerary({ canEdit })), flush: true, status: { text: '4 things on this day' },
});

export function buildOther({ set, state, pair }) {
  const s = set('other', 'In other modules', 'A module links an object to files in the Vault and never copies them (plan section 4). The file chip shows a file on the object: its type icon, the name, the size; a click opens it in the Vault\'s viewer. A deleted file reads "File removed" with Remove link for someone who may edit the object; a file whose bytes are gone reads "File missing"; a file the person may not see reads "Not available to you". The chip is the Chips block\'s tag with a type icon. The sample is a stay, a flight, an activity and a meal in the Itinerary (the travel template\'s name for the Planner), built from the Cards block.');
  const p = pair(s);
  plain(p, { name: 'Itinerary: file chips on cards', note: 'A hotel with two files, a flight with a file and a removed one, an activity with a file and a missing one, a dinner whose file this person may not see.', frame: itineraryFrame(), h: 800 });
  plain(p, { name: 'The chooser (host.files.pick)', note: 'Add file opens the Vault as a chooser in the product\'s dialog: search, the types the module asked for, a tick on each file, "Add a file" to send a new one, Attach with the count.', frame: itineraryFrame(), h: 800, after: (f) => heldDialog(f.hold, pickSheet(W(), { chosen: ['f07'] })) });
  const p2 = pair(s);
  plain(p2, { name: 'Without the right to edit', note: 'A person who may not edit the object sees the states but no Add file and no Remove link.', frame: itineraryFrame(false), h: 800 });
  plain(p2, { name: 'The chips, one by one', w: 360, h: 560, note: 'Every state, at 360px. Long names are cut with an ellipsis; the size stays.', frame: { title: 'Files on an object', icon: 'paperclip', titlebar: { close: true }, toolbar: [], status: { text: 'The chip, every state' }, flush: true, content: (() => {
    const box = h('div', 'vt-other');
    const rows = [
      ['A document', fileChip(byId('f30'))], ['A picture', fileChip(byId('f07'))], ['Audio', fileChip(byId('f19'))], ['Video', fileChip(byId('f23'))], ['Markdown', fileChip(byId('f39'))],
      ['A long name', fileChip({ ...byId('f34'), name: 'Train tickets, Rome to Florence, with the seat numbers and the QR codes.pdf' })],
      ['Kept for download only', fileChip(byId('f32'))],
      ['File removed (an editor)', fileChip(null, { state: 'removed', canEdit: true })],
      ['File removed (not an editor)', fileChip(null, { state: 'removed' })],
      ['File missing (an editor)', fileChip(byId('f33'), { state: 'missing', canEdit: true })],
      ['Not available to you', fileChip(null, { state: 'hidden' })],
    ];
    for (const [label, chip] of rows) { const r = h('div', 'vt-files'); r.append(h('div', 'vt-files-head', label)); const ul = h('div', 'vt-files-list'); ul.append(chip); r.append(ul); box.append(r); }
    return inShadow(box);
  })() } });
  const p3 = pair(s);
  state(p3, { name: 'Where it is used', note: 'From a file\'s more button or its Info: the objects that link to it, as summaries the person may see, and how many they may not.', cfg: { role: 'member', state: { view: 'list' }, held: false }, h: 560, after: (api) => heldDialog(api.el, usesSheet(byId('f30'), W())) });
  state(p3, { name: 'Linked marks in the List', note: 'A link icon with its count and a share icon on the row; the Filters have Linked and Shared to find them.', cfg: { role: 'member', state: { view: 'list', linked: ['linked'] } }, h: 560 });
}

export function buildShare({ set, state, pair }) {
  const s = set('share', 'Sharing outside', 'The title bar\'s Share (owners and moderators; a member when the owner turns it on) opens the sheet for the chosen files, or the list of share links when none is chosen. Choices on the sheet: a name, an end (1, 7 or 30 days; 7 is first; never without one), an optional password and Allow download (off). Make link shows the address once, with Copy. The sentence about view only is the plan\'s. The public page is a plain page: the share\'s name, who shared it and when it ends, and the files in a grid with the same viewers.');
  const chosen = ['f09', 'f12', 'f01', 'f17', 'f23'].map(byId);
  const p = pair(s);
  state(p, { name: 'The share sheet', note: 'Five files chosen, Share pressed. 7 days is chosen, download is off.', cfg: { role: 'moderator', held: false, state: { view: 'grid', selecting: true, sel: chosen.map((f) => f.id) } }, h: 800, after: (api) => heldDialog(api.el, shareSheet(W(), chosen)) });
  state(p, { name: 'Password and download on', note: 'The same with 30 days, a password and Allow download.', cfg: { role: 'moderator', state: { view: 'list', selecting: true, sel: chosen.map((f) => f.id) } }, h: 800, after: (api) => heldDialog(api.el, shareSheet(W(), chosen, { days: 30, password: true, download: true })) });
  const p2 = pair(s);
  state(p2, { name: 'Link made', note: 'The address is shown once, with Copy; what it allows is under it.', cfg: { role: 'moderator', state: { view: 'list' } }, h: 640, after: (api) => heldDialog(api.el, shareSheet(W(), chosen, { mode: 'made', days: 7, password: true, download: false, copied: true })) });
  state(p2, { name: 'Share from the viewer', note: 'One file: its Share button, the same sheet.', cfg: { role: 'moderator', state: { open: 'f09' } }, h: 800, after: (api) => heldDialog(api.el, shareSheet(W(), [byId('f09')], { name: 'Group photo' })) });
  const p3 = pair(s);
  state(p3, { name: 'The list of share links', note: 'Share with nothing chosen. Each link: its name, files, end, whether it has a password, view only or download, how many times it was opened, and Turn off. An ended link stays, muted, until removed (Q13).', cfg: { role: 'moderator', state: { view: 'list' } }, h: 800, after: (api) => heldDialog(api.el, shareListSheet(W())) });
  state(p3, { name: 'No share links yet', cfg: { role: 'moderator', state: { view: 'list' } }, h: 560, after: (api) => heldDialog(api.el, shareListSheet(W(), { empty: true })) });
  state(s, { name: 'Turn off a link', note: 'The question before a link stops. The people with it read "This link has ended."', cfg: { role: 'moderator', state: { view: 'list' } }, h: 480, after: (api) => heldDialog(api.el, turnOffShareSheet(SHARES[0])) });

  const pub = set('public', 'The public page: /shared/<token>', 'What a person outside sees, with no account: a plain page in the environment\'s theme. No space name, no people, no chat, no modules, no other link; no sign-in prompt. Click a file to open it; Back returns. Download shows only when the link allows it. The page is drawn in the product\'s theme (Strong Coffee here); the window is a picture.');
  const pubState = (parent, name, note, kind, opts = {}) => {
    const wrap = h('section', 'pp-state');
    wrap.append(h('h4', 'pp-state-name', name));
    if (note) wrap.append(h('p', 'pp-state-note', note));
    const f = h('div', 'pp-frame vt-pagebox');
    f.append(sharedPage(kind, opts));
    wrap.append(f);
    parent.append(wrap);
  };
  pubState(pub, 'Opened, download allowed', 'The share\'s name, who shared it and when it ends; the files as a grid. Click a file to open it.', 'grid');
  const p4 = pair(pub);
  pubState(p4, 'View only', 'The same without Download anywhere, and one sentence at the foot.', 'view');
  pubState(p4, 'A file removed from the link', 'The card says "File removed" and cannot be opened.', 'removed');
  const p5 = pair(pub);
  pubState(p5, 'Needs a password', 'Before the files, nothing but the field.', 'password');
  pubState(p5, 'Wrong password', '', 'wrong');
  pubState(p5, 'Too many tries', 'Five wrong tries in fifteen minutes: the plan\'s sentence.', 'tries');
  pubState(p5, 'Ended or turned off', 'A wrong address reads the same.', 'ended');
  const p6 = pair(pub);
  pubState(p6, 'On a phone, 390', 'Three across, as the Vault\'s grid is.', 'grid', { w: 390 });
  pubState(p6, 'A picture opened', 'The viewer is the Vault\'s, with Previous, Next and Download.', 'grid', { w: 390, open: 'f09' });
  pubState(p6, 'A PDF kept for download only', 'In a link that allows download: the button; in one that does not: the words.', 'grid', { w: 390, open: 'f32' });
}

export function buildDelete({ set, state, pair }) {
  const s = set('delete', 'Deleting and erasing', 'Remove asks first and says where the file is used. Links stay and read "File removed" (decision 2). Erasing a space deletes its files and its share links, and uninstalling the module removes every space\'s files: both are the typed, final question. Turning the Vault off in a space keeps its files. Removing is not undone; there is no recycle bin in the plan.');
  const backdrop = (parent, name, note, dlg, { q } = {}) => {
    const wrap = h('section', 'pp-state');
    wrap.append(h('h4', 'pp-state-name', name));
    if (note) wrap.append(h('p', 'pp-state-note', note));
    const box = h('div', 'pp-frame vt-frame');
    box.dataset.h = '480';
    const st = h('div', 'vt-backdrop');
    box.append(st);
    wrap.append(box);
    parent.append(wrap);
    heldDialog(st, dlg);
  };
  const p = pair(s);
  state(p, { name: 'Remove a file used elsewhere', note: 'It lists where the file is used and says the links will show File removed.', cfg: { role: 'moderator', state: { view: 'list' }, held: false }, h: 640, after: (api) => heldDialog(api.el, removeSheet(W(), [byId('f30')])) });
  state(p, { name: 'Remove a file that is not used', cfg: { role: 'member', state: { view: 'list' } }, h: 640, after: (api) => heldDialog(api.el, removeSheet(W(), [byId('f10')])) });
  const p2 = pair(s);
  state(p2, { name: 'Remove several', note: 'Some of them are linked from other modules.', cfg: { role: 'moderator', state: { view: 'list', selecting: true, sel: ['f29', 'f30', 'f10'] } }, h: 640, after: (api) => heldDialog(api.el, removeSheet(W(), ['f29', 'f30', 'f10'].map(byId))) });
  state(p2, { name: 'After removing', note: 'A toast says so. The Itinerary\'s chip now reads "File removed".', cfg: { role: 'member', state: { view: 'list', removed: ['f10'] }, toast: ['File removed', 'Pasta lunch.jpg', 'ok', 'trash'] }, h: 640 });
  const p3 = pair(s);
  state(p3, { name: 'Rename', cfg: { role: 'member', state: { view: 'list' } }, h: 480, after: (api) => heldDialog(api.el, renameSheet(byId('f10'))) });
  state(p3, { name: 'Rename, a name that will not do', cfg: { role: 'member', state: { view: 'list' } }, h: 480, after: (api) => heldDialog(api.el, renameSheet({ ...byId('f10'), name: '' }, { error: 'Give the file a name.' })) });
  const p4 = pair(s);
  backdrop(p4, 'Delete a space', 'The space\'s own question (#337) with the Vault\'s part in it: the files and links go too, and the files can only come back from the Vault folder\'s own copy.', eraseSpaceSheet(W(), FILES.length, TOTAL_BYTES, 3));
  backdrop(p4, 'Uninstall the module', 'An owner or admin: every space\'s files, all the share links. Typed to confirm.', uninstallSheet(W()));
  const p5 = pair(s);
  backdrop(p5, 'Turn the Vault off in a space', 'The files are kept; share links stop while it is off.', offInSpaceSheet(W()));
  state(p5, { name: 'Someone left', note: 'Files stay with the space, shown as added by "someone who left", and stop counting against a person\'s limit.', cfg: { role: 'member', state: { view: 'list', query: 'guide' } }, h: 480 });
}

const Q = [
  ['Grid card: stacked head or picture first?', 'The stacked head with the circle icon (your pattern, drawn first) costs about 50px a card and cuts long names to two lines; the picture-first card (the plan\'s wording) shows more files and the whole name.', 'Picture first for the Vault\'s grid, because a gallery is the one place the picture is the content. Keep the stacked head for object cards elsewhere. Under 480px it is picture first anyway.', 'sets "Grid" and the switch'],
  ['Sorting: where?', 'The plan has no sort. Two ways are on the switch: a "Sort by" group at the top of Filters (it counts as a filter in the badge), or a button beside the View switch that opens a small menu and says the current sort. Not drawn: column headers in the List.', 'A button beside the View switch: one tap, it names the current sort, and Filters keeps counting only real filters.', 'the Sorting switch'],
  ['Choosing several: a Select button, or ticks always?', 'The plan has the Select action in the title bar. Always-visible ticks save a step on a touch screen but crowd every row and card.', 'The Select button, as the plan says.', 'the Choosing switch'],
  ['Add files: a panel in the module, or a dialog?', 'The plan says each file "shows a progress row" and does not say where. A panel keeps the list in view and the uploads visible while browsing; a dialog is simpler but hides the list.', 'The panel. Closing it does not stop the uploads; the row stays until cleared.', 'the Add files switch, set "Add files"'],
  ['Info in the viewer: a side panel or under the file?', 'The plan does not draw Info. A side panel at 260px; under the file; and a sheet over the file under 560px either way.', 'The side panel (a sheet when narrow).', 'the Info switch'],
  ['PDF search: ship it?', 'Decision 18 says "if cheap". It is drawn (a field, the count, Previous and Next match) and can be left out.', 'Leave it out of the first version; the space is kept in the toolbar. Ask again when pdf.js is sized.', 'the PDF search switch'],
  ['Remove where it was taken: on or off by default?', 'Plan "What is not decided" 1. Both are drawn.', 'On for pictures (a position is dropped unless the person keeps it, as Research does); the video notice always shows.', 'the Remove where taken switch'],
  ['A damaged PDF: refused or download only?', 'Plan "What is not decided" 4. Both rows are drawn.', 'Refused, with "This PDF looks damaged. Save it again and try once more.": a download-only file that cannot be read helps nobody.', 'set "Add files"'],
  ['Guests: none, or read-only?', 'The plan says a guest has no access, cannot be given any, and the server answers 404. The task asked for a read-only guest too. Both are drawn.', 'None, as the plan and the security review decided: a guest in a space then never learns a file exists.', 'set "What a person may do"'],
  ['Filters beyond the plan', 'The plan has Type, Added by (Everyone, Mine) and Linked. I added the other people by name, Added (this week, this month, earlier) and Shared (only for people who can share), as you asked for date and shared.', 'Keep Added by with names, Added, and Shared for people who can share.', 'set "Search and Filters"'],
  ['Words with the template\'s name', 'The plan\'s "This trip\'s Vault is full" does not read with Documents or Handouts (plural). I wrote "This trip\'s Vault is full (5 GB). Remove some files to add more." with the template\'s name for the Vault; the empty state for games asks for maps, pictures and handouts.', 'Approve the new sentence and the games empty state.', 'the Template words switch'],
  ['What is left, shown', 'Not in the plan: a meter in the Add files panel and an "Almost full" note in the status line at 80%, and a banner. The plan has only the status line text.', 'Keep the meter in the panel and the note in the status line; skip the banner except when full.', 'sets "Empty, and what is left" and "Add files"'],
  ['Ended share links: gone, or kept in the list?', 'The plan says a link turns off by itself at its end and does not say whether the list keeps it. Drawn kept, muted, with Remove from the list.', 'Kept for 30 days, so the maker can see it ended and how often it was opened.', 'set "Sharing outside"'],
  ['Public page: a "Download all"?', 'The plan has Download per file, no archives anywhere. A zip would need the server to build archives, which the plan refuses.', 'No Download all in the first version.', 'set "The public page"'],
  ['Words that are new', 'Four sentences the plan does not give: a PDF with a script, a slow upload, a damaged PDF, and "This trip\'s Vault is full". Also the labels on the share sheet and list, the viewer\'s and the chooser\'s buttons.', 'Read them on the page and change any you dislike; they are plain and short on purpose.', 'sets "Add files" and "Sharing outside"'],
];

export function buildQuestions({ set }) {
  const s = set('questions', 'Questions for Thomas', 'Where the plan is silent or two ways are possible, both are drawn; each question says where, with a recommendation.');
  const ol = h('ol', 'vt-qs');
  Q.forEach(([q, what, rec, where], i) => {
    const li = h('li');
    li.id = `vt-q${i + 1}`;
    li.append(h('b', '', q), ' ', what, ' ');
    li.append(h('span', 'vt-q-rec', `Recommendation: ${rec} (Where: ${where}.)`));
    ol.append(li);
  });
  s.append(ol);
}
