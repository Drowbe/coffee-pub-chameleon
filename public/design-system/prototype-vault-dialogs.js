// The Prototype's Vault dialogs (Thomas, 2026-11-02; design-process only): the share sheet and the list of share links, the questions (remove,
// turn off, erase a space, uninstall), Rename, Where it is used, and the file chooser other modules open (host.files.pick). Each is a <dialog>
// in the product's own dialog look (the Dialogs and confirm blocks of public/sdk/system.css), made to be opened for real (liveOpen) or held
// open in a picture (heldDialog).
import { FILES, KINDS, SHARES, USES } from './prototype-vault-data.js';
import { D, h, fa, btn, iconBtn, size, when, dayWords, who, plural, circleIcon, thumb, fileChip } from './prototype-vault-ui.js';

let uid = 0;
export function sheet({ title, width = 'form', kind = '', labelledby = true }) {
  const dlg = h('dialog', `sdk-dialog sdk-dialog-confirm vt-sheet vt-sheet-${width}`);
  const id = `vt-dlg-${++uid}`;
  dlg.setAttribute('aria-modal', 'true');
  dlg.setAttribute('aria-labelledby', `${id}-t`);
  if (kind) { dlg.setAttribute('role', 'alertdialog'); dlg.dataset.kind = kind; }
  const head = h('div', 'sdk-dialog-head');
  const t = h('h2', 'sdk-dialog-title', title);
  t.id = `${id}-t`;
  const close = h('button', 'sdk-icon-btn btn-quiet btn-small sdk-dialog-close');
  close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.dataset.close = '';
  close.append(fa('xmark'));
  head.append(t, close);
  const body = h('div', 'sdk-dialog-body');
  const foot = h('div', 'sdk-dialog-foot');
  dlg.append(head, body, foot);
  return { dlg, body, foot, title: t };
}
export const cancelBtn = (label = 'Cancel') => { const b = h('button', 'btn', label); b.type = 'button'; b.dataset.close = ''; return b; };
export const okBtn = (label, cls = 'btn btn-primary') => { const b = h('button', cls, label); b.type = 'button'; b.dataset.ok = ''; return b; };

// Open for real: modal, Escape and Close shut it, a click outside does not (as the product's dialogs).
export function liveOpen(dlg) {
  return new Promise((resolve) => {
    const opener = D.activeElement && D.activeElement !== D.body ? D.activeElement : null;
    let ended = false;
    const end = (v) => { if (ended) return; ended = true; if (dlg.open) dlg.close(); dlg.remove(); D.documentElement.style.overflow = ''; if (opener && opener.isConnected) opener.focus(); resolve(v); };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); end(false); });
    dlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) end(false); else if (e.target.closest('[data-ok]')) end(true); });
    D.body.append(dlg);
    D.documentElement.style.overflow = 'hidden';
    dlg.showModal();
    const first = dlg.querySelector('[data-ok]:not(:disabled)') || dlg.querySelector('input, button');
    if (first) first.focus();
  });
}
// Held open in a picture: a layer with the scrim, the dialog centred, nothing to press.
export function heldDialog(box, dlg, { inert = true } = {}) {
  const layer = h('div', 'vt-scrimbox');
  dlg.setAttribute('open', '');
  if (inert) { layer.inert = true; layer.setAttribute('aria-hidden', 'true'); }
  layer.append(dlg);
  box.append(layer);
  return layer;
}

// ---- the questions ----
export function confirmSheet({ title, message = '', action = 'OK', cancel = 'Cancel', kind = 'plain', typed = '' }) {
  const s = sheet({ title, width: 'confirm', kind });
  for (const p of message.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)) s.body.append(h('p', '', p));
  let input = null;
  if (typed) {
    const label = h('label', 'sdk-field');
    label.append(h('span', 'sdk-label', `Type ${typed} to confirm`));
    input = h('input');
    input.type = 'text'; input.autocomplete = 'off'; input.placeholder = typed;
    label.append(input);
    s.body.append(label);
  }
  const ok = okBtn(action, `btn ${kind === 'plain' ? 'btn-primary' : kind === 'final' ? 'btn-danger solid' : 'btn-danger'}`);
  if (input) { ok.disabled = true; input.addEventListener('input', () => { ok.disabled = input.value.trim() !== typed; }); }
  s.foot.append(cancelBtn(cancel), ok);
  return s.dlg;
}

// What each question says. `w` is the words ({ module, space }); `n` things at stake.
export function removeText(w, files) {
  const used = files.filter((f) => USES[f.id]);
  const lines = [];
  if (used.length === 1) {
    const u = USES[used[0].id];
    lines.push(`Used in ${u.list.length + u.hidden}: ${u.list.map((x) => `${x.title} (${x.module})`).join(', ')}${u.hidden ? `, and ${u.hidden} you can't see` : ''}. The links will show File removed.`);
  } else if (used.length > 1) {
    const total = used.reduce((a, f) => a + USES[f.id].list.length + USES[f.id].hidden, 0);
    lines.push(`${plural(used.length, 'of them is', 'of them are')} used in other tools, ${total} links in all. The links will show File removed.`);
  }
  lines.push(files.length === 1 ? `It is removed for everyone in this ${w.space}. This can't be undone.` : `They are removed for everyone in this ${w.space}. This can't be undone.`);
  return lines.join('\n\n');
}
export function removeSheet(w, files) {
  return confirmSheet({
    title: files.length === 1 ? `Remove "${files[0].name}"?` : `Remove ${files.length} files?`,
    message: removeText(w, files), action: 'Remove', kind: 'destructive',
  });
}
export const turnOffShareSheet = (s) => confirmSheet({
  title: `Turn off "${s.name}"?`, message: `The link stops working at once. People who have it will read "This link has ended."\n\nYou can make a new link any time.`, action: 'Turn off', kind: 'destructive',
});
export const eraseSpaceSheet = (w, count, bytes, shares) => confirmSheet({
  title: `Delete the Rome ${w.space}?`,
  message: `This deletes everything in the ${w.space}, including its ${plural(count, 'file')} in the ${w.module} (${size(bytes)}) and ${plural(shares, 'share link')}. People with a link will see "This link has ended."\n\nThis can't be undone. The ${w.module} is not backed up with the data folder, so these files can only come back from your own copy of the ${w.module} folder.`,
  action: 'Delete the trip', kind: 'final', typed: 'Rome',
});
export const uninstallSheet = (w) => confirmSheet({
  title: `Uninstall the ${w.module}?`,
  message: `This removes the ${w.module} and every file in it, from all 3 ${w.space}s: 118 files, 4.8 GB, and 6 share links. Links in other tools will show File removed, and every share link stops.\n\nThis can't be undone. Turn the ${w.module} off in a ${w.space} instead to keep its files.`,
  action: `Uninstall the ${w.module}`, kind: 'final', typed: w.module,
});
export const offInSpaceSheet = (w) => confirmSheet({
  title: `Turn off the ${w.module} in this ${w.space}?`,
  message: `Its files are kept, and come back when you turn it on again. Share links stop working while it is off, and links in other tools read "Not available to you".`,
  action: 'Turn off', kind: 'destructive',
});

// ---- Rename and Where it is used ----
export function renameSheet(f, { error = '' } = {}) {
  const s = sheet({ title: 'Rename the file', width: 'confirm' });
  const label = h('label', 'sdk-field');
  label.append(h('span', 'sdk-label', 'Name'));
  const input = h('input');
  input.type = 'text'; input.value = f.name; input.maxLength = 120; input.setAttribute('autocomplete', 'off');
  const ext = f.name.includes('.') ? `.${f.name.split('.').pop()}` : '';
  const hint = h('span', error ? 'sdk-error' : 'sdk-hint', error || `Keep ${ext} at the end. A name can be 120 characters.`);
  if (error) input.setAttribute('aria-invalid', 'true');
  label.append(input, hint);
  s.body.append(label);
  s.foot.append(cancelBtn(), okBtn('Rename'));
  return s.dlg;
}
export function usesSheet(f, w) {
  const s = sheet({ title: 'Where it is used', width: 'confirm' });
  s.body.append(h('p', '', f.name));
  const u = USES[f.id];
  if (!u) s.body.append(h('p', '', `Nothing links to this file yet. Link it from a booking or a note in another tool.`));
  else {
    const ul = h('ul', 'sdk-card-list vt-usesheet');
    for (const x of u.list) {
      const li = h('li', 'sdk-row');
      const main = h('span', 'sdk-row-main');
      main.append(h('span', 'sdk-row-title', x.title), h('span', 'sdk-row-sub', `${x.kind} · ${x.module}`));
      const open = btn('btn btn-small', { label: 'Open', icon: 'arrow-up-right-from-square' });
      li.append(main, open);
      ul.append(li);
    }
    s.body.append(ul);
    if (u.hidden) s.body.append(h('p', '', `and ${plural(u.hidden, 'more link')} you can't see.`));
    s.body.append(h('p', '', 'Remove the file and these links read File removed.'));
  }
  s.foot.append(cancelBtn('Close'));
  return s.dlg;
}

// ---- Share ----
export const ADDRESS = 'https://rome.example.org/shared/q8Zt2mRk4vLw9XaPd7HcYn3sBfUe5JgT';
export function filesLine(files) {
  const first = files[0];
  return files.length === 1 ? first.name : `${first.name} and ${plural(files.length - 1, 'other file')}`;
}
export function shareSheet(w, files, { mode = 'new', password = false, download = false, days = 7, name = 'Rome, October', copied = false } = {}) {
  const s = sheet({ title: mode === 'made' ? 'Link made' : `Share ${files.length === 1 ? 'a file' : `${files.length} files`}`, width: 'form' });
  const sum = h('div', 'vt-share-files');
  const strip = h('div', 'vt-share-strip');
  for (const f of files.slice(0, 5)) strip.append(thumb(f, 96));
  if (files.length > 5) strip.append(h('span', 'vt-share-more', `+${files.length - 5}`));
  sum.append(strip, h('p', 'vt-share-line', filesLine(files)));
  s.body.append(sum);
  if (mode === 'made') {
    s.body.append(h('p', '', 'Anyone with this address can open these files, without an account. This is the only time it is shown. Copy it now.'));
    const label = h('label', 'sdk-field');
    label.append(h('span', 'sdk-label', 'Address'));
    const input = h('input', 'vt-share-address'); input.type = 'text'; input.readOnly = true; input.value = ADDRESS; input.spellcheck = false;
    label.append(input, h('span', 'sdk-hint', copied ? 'Copied. Paste it wherever you want to share it.' : ''));
    s.body.append(label);
    const facts = h('div', 'sdk-cluster');
    const ends = new Date('2026-11-02T10:00:00Z'); ends.setUTCDate(ends.getUTCDate() + days);
    const tag = (icon, text) => { const t = h('span', 'sdk-chip-tag'); t.append(fa(icon), text); return t; };
    facts.append(tag('clock', `Ends ${dayWords(ends.toISOString())}`), tag(password ? 'key' : 'lock-open', password ? 'Password on' : 'No password'), tag(download ? 'download' : 'eye', download ? 'Download allowed' : 'View only'));
    s.body.append(facts);
    s.foot.append(cancelBtn('Close'), okBtn('Copy address'));
    return s.dlg;
  }
  const form = h('div', 'sdk-form vt-share-form');
  const nameF = h('label', 'sdk-field');
  const nameIn = h('input'); nameIn.type = 'text'; nameIn.value = name; nameIn.maxLength = 80;
  nameF.append(h('span', 'sdk-label', 'Name'), nameIn, h('span', 'sdk-hint', 'Only you and the people with the link see it.'));
  const endF = h('div', 'sdk-field');
  endF.append(h('span', 'sdk-label', 'Ends'));
  const sw = h('div', 'mf-switch'); sw.setAttribute('role', 'radiogroup'); sw.setAttribute('aria-label', 'Ends');
  for (const d of [1, 7, 30]) {
    const b = h('button', 'mf-switch-btn'); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(d === days)); b.tabIndex = d === days ? 0 : -1;
    b.append(h('span', '', d === 1 ? '1 day' : `${d} days`));
    b.addEventListener('click', () => { for (const x of sw.children) { x.setAttribute('aria-checked', 'false'); x.tabIndex = -1; } b.setAttribute('aria-checked', 'true'); b.tabIndex = 0; });
    sw.append(b);
  }
  endF.append(sw, h('span', 'sdk-hint', 'A link always ends. You can turn it off sooner.'));
  const pwF = h('label', 'sdk-field');
  const pwLabel = h('span', 'sdk-label', 'Password ');
  pwLabel.append(h('span', 'sdk-optional', 'optional'));
  pwF.append(pwLabel);
  const pw = h('input'); pw.type = 'password'; pw.autocomplete = 'new-password'; pw.value = password ? 'correct horse' : '';
  pwF.append(pw, h('span', 'sdk-hint', 'People need it to open the link. Tell them another way.'));
  const dlRow = h('label', 'sdk-choice-row');
  const dlText = h('span', 'sdk-choice-text');
  dlText.append(h('span', 'sdk-choice-label', 'Allow download'), h('span', 'sdk-choice-desc', 'People can download the files. Without download, people can still save what they see on screen.'));
  const dlIn = h('input', 'sdk-switch'); dlIn.type = 'checkbox'; dlIn.setAttribute('role', 'switch'); dlIn.checked = download;
  dlRow.append(dlText, dlIn);
  form.append(nameF, endF, pwF, dlRow);
  s.body.append(form);
  s.foot.append(cancelBtn(), okBtn('Make link'));
  return s.dlg;
}

// The list of share links (the Share action with no file chosen).
export function shareListSheet(w, { empty = false, shares = SHARES } = {}) {
  const s = sheet({ title: 'Share links', width: 'form' });
  if (empty) {
    const e = h('div', 'sdk-empty');
    e.append(fa('share-nodes'), h('p', 'sdk-empty-title', 'No share links yet.'), h('p', 'sdk-empty-text', `Choose files in the ${w.module}, then press Share to make a link for people outside.`));
    s.body.append(e);
    s.foot.append(cancelBtn('Close'), okBtn('Choose files', 'btn btn-primary'));
    return s.dlg;
  }
  const ul = h('ul', 'sdk-card-list vt-sharelist');
  for (const sh of shares) {
    const li = h('li', 'sdk-card-banded vt-share');
    if (sh.ended) li.classList.add('is-ended');
    const head = h('header', 'sdk-card-head');
    const main = h('div', 'sdk-card-main');
    const ic = h('span', 'sdk-card-icon'); ic.dataset.tint = sh.ended ? '' : 'blue'; ic.append(fa(sh.ended ? 'link-slash' : 'link'));
    main.append(ic, h('h3', 'sdk-card-title', sh.name), h('span', 'sdk-card-sub sdk-tint-text', sh.ended ? 'Ended' : 'Active'));
    if (!sh.ended) main.firstChild.dataset.tint = 'blue';
    head.append(main);
    const body = h('div', 'sdk-card-body vt-share-body');
    const tags = h('div', 'sdk-cluster');
    const tag = (icon, text) => { const t = h('span', 'sdk-chip-tag'); t.append(fa(icon), text); return t; };
    tags.append(tag('file', plural(sh.files.length, 'file')), tag('clock', sh.ended ? `Ended ${when(sh.ends)}` : `Ends ${when(sh.ends, { long: true })}`), tag(sh.password ? 'key' : 'lock-open', sh.password ? 'Password' : 'No password'), tag(sh.download ? 'download' : 'eye', sh.download ? 'Download allowed' : 'View only'), tag('eye', `Opened ${sh.opened} times`));
    const by = h('p', 'sdk-card-sub', `Made by ${who(sh.by)}, ${when(sh.at)}`);
    const acts = h('div', 'sdk-card-foot');
    if (!sh.ended) acts.append(btn('btn btn-small', { label: 'Files', icon: 'pen-to-square' }), btn('btn btn-small btn-danger', { label: 'Turn off', icon: 'link-slash' }));
    else acts.append(btn('btn btn-small', { label: 'Remove from the list', icon: 'trash' }));
    body.append(tags, by, acts);
    li.append(head, body);
    ul.append(li);
  }
  s.body.append(ul);
  s.foot.append(cancelBtn('Close'), okBtn('Make a link', 'btn btn-primary'));
  return s.dlg;
}

// ---- the file chooser other modules open (host.files.pick) ----
export function pickSheet(w, { groups = ['document', 'image'], chosen = ['f30'], query = '', canAdd = true } = {}) {
  const s = sheet({ title: `Attach from the ${w.module}`, width: 'browse' });
  const bar = h('div', 'vt-pick-bar');
  const search = h('input'); search.type = 'search'; search.placeholder = 'Search files'; search.setAttribute('aria-label', 'Search files'); search.value = query;
  const chips = h('div', 'sdk-cluster');
  for (const g of ['image', 'audio', 'video', 'document']) {
    if (!groups.includes(g)) continue;
    const c = h('button', 'sdk-chip'); c.type = 'button'; c.setAttribute('aria-pressed', 'true');
    c.textContent = { image: 'Pictures', audio: 'Audio', video: 'Video', document: 'Documents' }[g];
    chips.append(c);
  }
  bar.append(search, chips);
  const list = h('ul', 'sdk-card-list vt-picklist');
  const pool = FILES.filter((f) => groups.includes(f.group) && !f.missing && (f.viewable !== false) && (!query || f.name.toLowerCase().includes(query.toLowerCase()))).slice(0, 8);
  for (const f of pool) {
    const li = h('li', 'sdk-row vt-pickrow');
    const lab = h('label', 'sdk-row-tick'); const cb = h('input'); cb.type = 'checkbox'; cb.checked = chosen.includes(f.id); cb.setAttribute('aria-label', f.name);
    lab.append(cb);
    li.setAttribute('aria-selected', String(cb.checked));
    cb.addEventListener('change', () => li.setAttribute('aria-selected', String(cb.checked)));
    const main = h('span', 'sdk-row-main');
    main.append(h('span', 'sdk-row-title', f.name), h('span', 'sdk-row-sub', `${KINDS[f.kind].word} · ${size(f.size)} · ${who(f.by)}`));
    li.append(lab, thumb(f, 96), main);
    list.append(li);
  }
  s.body.append(bar, list);
  const n = chosen.length;
  if (canAdd) { const add = btn('btn vt-pick-add', { label: 'Add a file', icon: 'plus' }); s.foot.append(add, h('span', 'vt-foot-fill')); }
  s.foot.append(cancelBtn(), okBtn(n ? `Attach ${n}` : 'Attach'));
  if (!n) s.foot.lastChild.disabled = true;
  return s.dlg;
}
