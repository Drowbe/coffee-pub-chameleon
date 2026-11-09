// The share sheet and the list of share links, for someone signed in (documentation/plans/plan-attachments-vault.md, section 7 and step 5; the
// Prototype's "Sharing outside"). One piece of code for both places that start a share: the Vault's own page (through host.library.share and
// host.library.shares, answered by module-host.js) and a file window's Share button (public/file-viewer.js). Both draw in the page's document, so
// Copy works (a module's frame may not use the clipboard).
//
//   shareFiles({ doc, place, ids, onChange, returnFocus })   the sheet for these files (ids in the library); Make link shows the address once
//   shareLinks({ doc, place, onChange, returnFocus })        the list of the space's share links: Turn off, Edit (name and files), Make a link
// `place` is { module, space }. The routes are the server's (server/vault-share.js, "the seam"); the sentences it sends are shown as written.
import { api, showNote } from '/brand.js';
import { actionBar } from '/action-bar.js';
import { confirmDialog } from '/confirm.js';
import { KINDS, kindOf, size, h, fa, btn } from '/file-viewer-views.js';

const enc = encodeURIComponent;
const DAYS = [1, 7, 30];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDay = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''}`;
};
const shortDay = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.round((new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : longDay(iso);
};
// The stylesheet, once for each document.
const styled = new WeakMap();
function styles(doc) {
  if (styled.has(doc)) return styled.get(doc);
  const done = new Promise((resolve) => {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/share-sheet.css';
    link.addEventListener('load', resolve);
    link.addEventListener('error', resolve);
    doc.head.append(link);
    setTimeout(resolve, 1500);
  });
  styled.set(doc, done);
  return done;
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

const base = (p) => `/api/modules/${enc(p.module)}`;
const q = (p) => `space=${enc(p.space)}`;
const sharesUrl = (p, path = '') => `${base(p)}/library/shares${path}?${q(p)}`;

async function loadPlace(p) {
  const [cx, library] = await Promise.all([
    api('GET', `${base(p)}/context?scope=space&space=${enc(p.space)}`),
    api('GET', `${base(p)}/library?${q(p)}`),
  ]);
  return { cx, files: library.files || [], name: (cx.module && cx.module.name) || 'Vault' };
}
async function peopleNames() {
  const out = new Map();
  try { for (const u of (await api('GET', '/api/presence')).users || []) out.set(u.key, u.displayName); } catch { /* names are a nicety */ }
  return out;
}

// ---- the dialog ---------------------------------------------------------------------------------------------------------------------
function makeDialog(doc, title, cls = '') {
  const dlg = doc.createElement('dialog');
  dlg.className = `sdk-editor sh-sheet${cls ? ` ${cls}` : ''}`;
  const id = `sh-title-${Math.random().toString(36).slice(2, 8)}`;
  dlg.setAttribute('aria-labelledby', id);
  const form = doc.createElement('form');
  form.className = 'sdk-form';
  form.noValidate = true;
  const head = h('h3', '', title);
  head.id = id;
  form.append(head);
  dlg.append(form);
  return { dlg, form, head };
}
function openDialog(doc, dlg, { focus, returnFocus } = {}) {
  dlg.addEventListener('close', () => { dlg.remove(); const to = returnFocus && returnFocus(); if (to && to.isConnected !== false && typeof to.focus === 'function') to.focus({ preventScroll: true }); });
  doc.body.append(dlg);
  dlg.showModal();
  if (focus) focus.focus({ preventScroll: true });
}
function actions(doc, ...buttons) {
  const row = doc.createElement('div');
  row.className = 'sdk-editor-actions';
  row.append(...buttons);
  return row;
}
// A restricted file (not for everyone in the space) says so in the sheet: a link reaches people it is not shared with, and ends when its maker can no longer see it.
// `visibility` comes with a file only for the person who added it, owners and the admin (the server's rule).
const restricted = (files) => files.some((f) => f.visibility && f.visibility !== 'everyone');
function restrictLine(asLink) {
  const box = h('div', 'sh-restrict');
  const mk = h('div', 'sdk-banner');
  mk.dataset.kind = 'info';
  const ic = h('span', 'sdk-banner-icon'); ic.append(fa('circle-info'));
  mk.append(ic, h('span', 'sdk-banner-text', asLink ? 'If you can no longer see this file, the link stops showing it.' : 'Anyone with this link can open a file that is not shared with everyone here, even people it is not shared with. If you can no longer see it, the link stops showing it.'));
  box.append(mk);
  return box;
}
const tag = (icon, text) => { const t = h('span', 'sdk-chip-tag'); t.append(fa(icon), text); return t; };
function filesStrip(place, files) {
  const sum = h('div', 'sh-files');
  const strip = h('div', 'sh-strip');
  for (const f of files.slice(0, 5)) {
    const k = KINDS[kindOf(f)];
    const t = h('span', 'sh-mini');
    t.dataset.tint = k.tint;
    t.append(fa(k.icon));
    if (f.hasThumb) {
      const img = h('img');
      img.alt = '';
      img.addEventListener('error', () => img.remove());
      img.src = `${base(place)}/library/${enc(f.id)}/thumb?${q(place)}`;
      t.append(img);
    }
    strip.append(t);
  }
  if (files.length > 5) strip.append(h('span', 'sh-more', `+${files.length - 5}`));
  const first = files[0];
  sum.append(strip, h('p', 'sh-line', files.length === 1 ? first.name : `${first.name} and ${plural(files.length - 1, 'other file')}`));
  return sum;
}
async function copyText(doc, text, input) {
  try { await doc.defaultView.navigator.clipboard.writeText(text); return true; } catch { /* fall back to the old way */ }
  try { input.focus(); input.select(); return doc.execCommand('copy'); } catch { return false; }
}

// ---- the sheet to make a link ---------------------------------------------------------------------------------------------------------
export async function shareFiles({ doc = document, place, ids, onChange, returnFocus }) {
  let here;
  try { [here] = await Promise.all([loadPlace(place), styles(doc)]); } catch (err) { showNote(err.status === 403 ? 'You can\'t make share links here.' : err.message); return false; }
  const { cx } = here;
  if (!cx.permissions || !cx.permissions.share) { showNote('You can\'t make share links here.'); return false; }
  const wanted = new Set(ids);
  const files = here.files.filter((f) => wanted.has(f.id));
  if (!files.length) { showNote('Choose a file to share.'); return false; }
  const mayDownload = Boolean(cx.permissions.download);

  const { dlg, form } = makeDialog(doc, files.length === 1 ? 'Share a file' : `Share ${files.length} files`);
  form.append(filesStrip(place, files));
  if (restricted(files)) form.append(restrictLine(false));
  const nameField = h('label', 'sdk-field');
  const nameIn = h('input');
  nameIn.type = 'text'; nameIn.maxLength = 80; nameIn.autocomplete = 'off';
  nameIn.value = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '').slice(0, 80) : '';
  const nameHint = h('span', 'sdk-hint', 'Only you and the people with the link see it.');
  nameField.append(h('span', 'sdk-label', 'Name'), nameIn, nameHint);

  let days = 7;
  const endField = h('div', 'sdk-field');
  const swLabel = h('span', 'sdk-label', 'Ends');
  endField.append(swLabel);
  const sw = h('div', 'mf-switch');
  sw.setAttribute('role', 'radiogroup');
  sw.setAttribute('aria-label', 'Ends');
  const radios = DAYS.map((d) => {
    const b = h('button', 'mf-switch-btn');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.append(h('span', '', d === 1 ? '1 day' : `${d} days`));
    b.addEventListener('click', () => choose(d, true));
    sw.append(b);
    return b;
  });
  function choose(d, focus) {
    days = d;
    radios.forEach((b, i) => { const on = DAYS[i] === d; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
  }
  sw.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    choose(DAYS[(DAYS.indexOf(days) + step + DAYS.length) % DAYS.length], true);
  });
  choose(7, false);
  endField.append(sw, h('span', 'sdk-hint', 'A link always ends. You can turn it off sooner.'));

  const pwField = h('label', 'sdk-field');
  const pwLabel = h('span', 'sdk-label', 'Password ');
  pwLabel.append(h('span', 'sdk-optional', 'optional'));
  const pw = h('input');
  pw.type = 'password'; pw.autocomplete = 'new-password'; pw.maxLength = 200; pw.minLength = 8;
  pwField.append(pwLabel, pw, h('span', 'sdk-hint', 'At least 8 characters. People need it to open the link. Tell them another way.'));

  form.append(nameField, endField, pwField);
  let dlIn = null;
  if (mayDownload) {
    const row = h('label', 'sdk-choice-row');
    const text = h('span', 'sdk-choice-text');
    text.append(h('span', 'sdk-choice-label', 'Allow download'), h('span', 'sdk-choice-desc', 'People can download the files. Without download, people can still save what they see on screen, and a PDF can be downloaded.'));
    dlIn = h('input', 'sdk-switch');
    dlIn.type = 'checkbox';
    dlIn.setAttribute('role', 'switch');
    row.append(text, dlIn);
    form.append(row);
  } else {
    form.append(h('p', 'sdk-hint', 'People can look at the files but not download them. Your role can\'t allow downloads. They can still save what they see on screen, and a PDF can be downloaded.'));
  }
  const failure = h('p', 'sdk-form-error');
  failure.hidden = true;
  failure.setAttribute('role', 'alert');
  form.append(failure);

  const finish = () => { dlg.close(); };
  const bar = actionBar({
    label: 'Share', doc, saveLabel: 'Make link', submit: true, discardWords: 'Discard this link?',
    dirty: () => nameIn.value.trim().length > 0,
    onCancel: finish,
    onSave: async () => {
      const name = nameIn.value.trim();
      failure.hidden = true;
      if (!name) { nameIn.setAttribute('aria-invalid', 'true'); nameHint.className = 'sdk-error'; nameHint.textContent = 'Give the link a name.'; nameIn.focus(); return false; }
      try {
        const made = await api('POST', sharesUrl(place), { name, files: files.map((f) => f.id), days, download: Boolean(dlIn && dlIn.checked), ...(pw.value ? { password: pw.value } : {}) });
        if (onChange) onChange();
        made_(made);
        return true;
      } catch (err) {
        failure.textContent = err.message;
        failure.hidden = false;
        return false;
      }
    },
  });
  form.append(bar.el);
  bar.bindEscape(dlg);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); bar.requestCancel(); });
  for (const el of [nameIn, pw]) el.addEventListener('input', () => { bar.refresh(); if (el === nameIn && nameIn.hasAttribute('aria-invalid')) { nameIn.removeAttribute('aria-invalid'); nameHint.className = 'sdk-hint'; nameHint.textContent = 'Only you and the people with the link see it.'; } });
  form.addEventListener('submit', (e) => { e.preventDefault(); bar.save(); });

  // The address, shown once (the server keeps only a hash of it).
  function made_(made) {
    const address = new URL(made.url, doc.defaultView.location.origin).href;
    form.replaceChildren();
    const title = h('h3', '', 'Link made');
    dlg.setAttribute('aria-labelledby', 'sh-made-title');
    title.id = 'sh-made-title';
    form.append(title, filesStrip(place, files));
    if (restricted(files)) form.append(restrictLine(true));
    form.append(h('p', '', 'Anyone with this address can open these files, without an account. This is the only time it is shown. Copy it now.'));
    const field = h('label', 'sdk-field');
    const input = h('input', 'sh-address');
    input.type = 'text'; input.readOnly = true; input.value = address; input.spellcheck = false;
    const hint = h('span', 'sdk-hint', '');
    hint.setAttribute('role', 'status');
    field.append(h('span', 'sdk-label', 'Address'), input, hint);
    form.append(field);
    const facts = h('div', 'sdk-cluster');
    const s = made.share;
    facts.append(tag('clock', `Ends ${longDay(s.ends)}`), tag(s.hasPassword ? 'key' : 'lock-open', s.hasPassword ? 'Password on' : 'No password'), tag(s.download ? 'download' : 'eye', s.download ? 'Download allowed' : 'View only'));
    form.append(facts);
    const close = btn('btn', { label: 'Close' });
    close.addEventListener('click', finish);
    const copy = btn('btn btn-primary', { label: 'Copy address', icon: 'copy' });
    copy.addEventListener('click', async () => {
      const ok = await copyText(doc, address, input);
      hint.textContent = ok ? 'Copied. Paste it wherever you want to share it.' : 'Select the address and copy it.';
      if (!ok) input.select();
    });
    input.addEventListener('focus', () => input.select());
    form.append(actions(doc, close, copy));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(); });
    copy.focus();
  }

  openDialog(doc, dlg, { focus: nameIn, returnFocus });
  nameIn.select();
  return true;
}

// ---- the list of share links ----------------------------------------------------------------------------------------------------------
export async function shareLinks({ doc = document, place, onChange, returnFocus, onChoose }) {
  let here; let names;
  try { [here, names] = await Promise.all([loadPlace(place), peopleNames(), styles(doc)]); } catch (err) { showNote(err.status === 403 ? 'You can\'t make share links here.' : err.message); return false; }
  const { cx, name: moduleName } = here;
  if (!cx.permissions || !cx.permissions.share) { showNote('You can\'t make share links here.'); return false; }
  const me = (cx.user && cx.user.key) || '';
  const owner = Boolean(cx.user && (cx.user.role === 'owner' || cx.user.role === 'admin'));

  const { dlg, form } = makeDialog(doc, 'Share links', 'sh-list-sheet');
  const body = h('div', 'sh-list-body');
  form.append(body);
  const close = btn('btn', { label: 'Close' });
  close.type = 'button';
  close.addEventListener('click', () => dlg.close());
  const more = btn('btn btn-primary', { label: 'Choose files', icon: 'square-check' });
  more.type = 'button';
  more.hidden = !onChoose;
  more.addEventListener('click', () => { dlg.close(); if (onChoose) onChoose(); });
  form.append(actions(doc, close, more));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); dlg.close(); });
  let shares = [];
  const byWord = (key) => (key === me ? 'You' : names.get(key) || 'someone who left');

  async function reload(keep) {
    try { shares = (await api('GET', sharesUrl(place))).shares || []; } catch (err) { body.replaceChildren(h('p', 'sdk-form-error', err.message)); return; }
    draw(keep);
  }
  function draw(keep) {
    body.replaceChildren();
    if (!shares.length) {
      const e = h('div', 'sdk-empty');
      e.append(fa('share-nodes'), h('p', 'sdk-empty-title', 'No share links yet.'), h('p', 'sdk-empty-text', `Choose files in the ${moduleName}, then press Share to make a link for people outside.`));
      body.append(e);
      return;
    }
    const ul = h('ul', 'sdk-card-list sh-links');
    ul.setAttribute('aria-label', 'Share links');
    const now = Date.now();
    for (const s of [...shares].sort((a, b) => (a.at < b.at ? 1 : -1))) {
      const over = !(Date.parse(s.ends) > now);
      const li = h('li', `sdk-card-banded sh-link${over ? ' is-ended' : ''}`);
      li.dataset.id = s.id;
      const head = h('header', 'sdk-card-head');
      const main = h('div', 'sdk-card-main');
      const ic = h('span', 'sdk-card-icon');
      if (!over) ic.dataset.tint = 'blue';
      ic.append(fa(over ? 'link-slash' : 'link'));
      main.append(ic, h('h4', 'sdk-card-title', s.name), h('span', 'sdk-card-sub sdk-tint-text', over ? 'Ended' : 'Active'));
      head.append(main);
      const cardBody = h('div', 'sdk-card-body sh-link-body');
      const tags = h('div', 'sdk-cluster');
      tags.append(tag('file', plural(s.files.length, 'file')), tag('clock', over ? `Ended ${shortDay(s.ends)}` : `Ends ${longDay(s.ends)}`), tag(s.hasPassword ? 'key' : 'lock-open', s.hasPassword ? 'Password' : 'No password'), tag(s.download ? 'download' : 'eye', s.download ? 'Download allowed' : 'View only'), tag('eye', s.opened === 1 ? 'Opened 1 time' : `Opened ${s.opened} times`));
      cardBody.append(tags, h('p', 'sdk-card-sub', `Made by ${byWord(s.by)}, ${shortDay(s.at)}`));
      if (!over) {
        const row = h('div', 'sh-link-actions');
        if (s.by === me || owner) {
          const edit = btn('btn btn-small', { label: 'Edit', icon: 'pen-to-square', aria: `Edit ${s.name}` });
          edit.type = 'button';
          edit.addEventListener('click', () => editLink(s, edit));
          row.append(edit);
        }
        if (s.canTurnOff) {
          const off = btn('btn btn-small', { label: 'Turn off', icon: 'link-slash', aria: `Turn off ${s.name}` });
          off.type = 'button';
          off.addEventListener('click', () => turnOff(s, off));
          row.append(off);
        }
        if (row.childElementCount) cardBody.append(row);
      }
      li.append(head, cardBody);
      ul.append(li);
    }
    body.append(ul);
    if (keep) { const to = body.querySelector(`[data-id="${keep}"] button`); if (to) to.focus({ preventScroll: true }); }
  }

  async function turnOff(s, from) {
    const name = s.name.length > 60 ? `${s.name.slice(0, 59)}…` : s.name;
    const ok = await confirmDialog({ title: `Turn off "${name}"?`, message: 'The link stops working at once. People who have it will read "This link has ended."\n\nYou can make a new link any time.', action: 'Turn off', kind: 'destructive' }, doc);
    if (!ok) { if (from.isConnected) from.focus({ preventScroll: true }); return; }
    try {
      await api('DELETE', sharesUrl(place, `/${enc(s.id)}`));
    } catch (err) {
      if (err.status !== 404) { showNote(err.message); return; }
    }
    showNote('Link turned off', s.name);
    if (onChange) onChange();
    await reload();
    const first = body.querySelector('button'); if (first) first.focus({ preventScroll: true }); else close.focus({ preventScroll: true });
  }

  function editLink(s, from) {
    const { dlg: ed, form: ef } = makeDialog(doc, 'Edit the link', 'sh-edit-sheet');
    const nameIn = h('input');
    nameIn.type = 'text'; nameIn.maxLength = 80; nameIn.autocomplete = 'off'; nameIn.value = s.name;
    const nameField = h('label', 'sdk-field');
    nameField.append(h('span', 'sdk-label', 'Name'), nameIn);
    ef.append(nameField);
    const chosen = new Set(s.files);
    const inLibrary = new Set(here.files.map((f) => f.id));
    const rows = [...here.files.map((f) => ({ id: f.id, f })), ...s.files.filter((id) => !inLibrary.has(id)).map((id) => ({ id, f: null }))];
    const fieldset = h('div', 'sdk-field');
    fieldset.append(h('span', 'sdk-label', 'Files'));
    const ul = h('ul', 'sdk-card-list sh-pick');
    ul.setAttribute('aria-label', 'Files in the link');
    for (const { id, f } of rows) {
      const li = h('li', 'sdk-row');
      const lab = h('label', 'sdk-row-tick');
      const cb = h('input');
      cb.type = 'checkbox'; cb.checked = chosen.has(id);
      cb.setAttribute('aria-label', f ? f.name : 'File removed');
      cb.addEventListener('change', () => { if (cb.checked) chosen.add(id); else chosen.delete(id); bar.refresh(); });
      lab.append(cb);
      const mainSpan = h('span', 'sdk-row-main');
      mainSpan.append(h('span', 'sdk-row-title', f ? f.name : 'File removed'), h('span', 'sdk-row-sub', f ? `${KINDS[kindOf(f)].word} · ${size(f.size)}` : 'It is no longer in the ' + moduleName));
      li.append(lab, mainSpan);
      ul.append(li);
    }
    fieldset.append(ul);
    ef.append(fieldset);
    const failure = h('p', 'sdk-form-error');
    failure.hidden = true;
    failure.setAttribute('role', 'alert');
    ef.append(failure);
    const same = () => nameIn.value.trim() === s.name && chosen.size === s.files.length && s.files.every((id) => chosen.has(id));
    const bar = actionBar({
      label: 'Edit the link', doc, saveLabel: 'Save', submit: true,
      dirty: () => !same(),
      onCancel: () => ed.close(),
      onSave: async () => {
        failure.hidden = true;
        const name = nameIn.value.trim();
        if (!name) { failure.textContent = 'Give the link a name.'; failure.hidden = false; nameIn.focus(); return false; }
        if (!chosen.size) { failure.textContent = 'Keep at least one file. To stop the link, turn it off.'; failure.hidden = false; return false; }
        try {
          await api('PATCH', sharesUrl(place, `/${enc(s.id)}`), { name, files: rows.map((r) => r.id).filter((id) => chosen.has(id)) });
        } catch (err) { failure.textContent = err.message; failure.hidden = false; return false; }
        if (onChange) onChange();
        ed.close();
        showNote('Link changed', name);
        await reload(s.id);
        return true;
      },
    });
    ef.append(bar.el);
    bar.bindEscape(ed);
    ed.addEventListener('cancel', (e) => { e.preventDefault(); bar.requestCancel(); });
    nameIn.addEventListener('input', () => bar.refresh());
    ef.addEventListener('submit', (e) => { e.preventDefault(); bar.save(); });
    openDialog(doc, ed, { focus: nameIn, returnFocus: () => (from.isConnected ? from : null) });
  }

  draw();
  openDialog(doc, dlg, { focus: close, returnFocus });
  await reload();
  return true;
}
