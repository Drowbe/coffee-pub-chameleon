// Documents module: the list and reading (build step 3). Each space has its own documents. A document is a small record
// (doc:<id>) and its text in chunks (text:<id>:<chunk>); the rules are in the documents-lib-*.js files, which have no page.
// Editing is not here yet: a document is made with a title (and, for tests, documentsSeed). Removing one puts it in the trash
// (_trash:<id>), where an editor can bring it back or delete it for good.
(async function () {
  'use strict';

  const host = (document.currentScript && document.currentScript.host) || window.host;
  const root = host.root;
  const $ = (id) => root.getElementById(id);
  const doc = root.ownerDocument || document;

  /*__LIB__*/

  function showMsg(title, text, retry) {
    $('loading').hidden = true;
    const m = $('msg');
    const head = doc.createElement('h2');
    head.className = 'sdk-empty-title';
    head.textContent = title;
    const parts = [head];
    if (text) { const p = doc.createElement('p'); p.className = 'sdk-empty-text'; p.textContent = text; parts.push(p); }
    if (retry) {
      const actions = doc.createElement('div');
      actions.className = 'sdk-empty-actions';
      const again = doc.createElement('button');
      again.type = 'button';
      again.className = 'btn';
      again.textContent = 'Retry';
      again.addEventListener('click', () => { m.hidden = true; $('loading').hidden = false; retry(); });
      actions.append(again);
      parts.push(actions);
    }
    m.replaceChildren(...parts);
    if (retry) m.dataset.kind = 'error'; else delete m.dataset.kind;
    m.hidden = false;
  }

  let info;
  try { info = await host.ready(); } catch (err) { showMsg('Documents could not start', err.message, () => location.reload()); return; }
  const me = info.user && info.user.key;
  const myName = (info.user && info.user.name) || 'Someone';
  const canEdit = host.can('edit') && Boolean(me);

  const docs = new Map(); // id -> cleaned small record
  const unreadable = new Set(); // ids whose record did not clean
  const trash = new Map(); // id -> cleaned trash record
  let showTrash = false;
  let openId = null; // the document being read
  let shownRev = 0;
  let query = '';
  let noteTimer = 0;

  const note = (text) => {
    const n = $('note');
    clearTimeout(noteTimer);
    n.textContent = text || '';
    n.hidden = !text;
    if (text) noteTimer = setTimeout(() => note(''), 6000);
  };
  const when = (iso) => { try { return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch (err) { return ''; } };
  const lex = (md) => marked.lexer(md, { gfm: true });
  const idOf = (key, prefix) => key.slice(prefix.length);

  // ---- storage -------------------------------------------------------------------------------------------------------------
  function remember(item) {
    if (item.key.startsWith('doc:')) {
      const id = idOf(item.key, 'doc:');
      const rec = item.value ? dlCleanDoc(item.value) : null;
      if (rec && rec.id === id) { docs.set(id, rec); unreadable.delete(id); } else { docs.delete(id); unreadable.add(id); }
    } else if (item.key.startsWith('_trash:')) {
      const rec = item.value ? dlCleanTrash(item.value) : null;
      if (rec && rec.id === idOf(item.key, '_trash:')) trash.set(rec.id, rec);
    }
  }
  function forget(key) {
    if (key.startsWith('doc:')) { docs.delete(idOf(key, 'doc:')); unreadable.delete(idOf(key, 'doc:')); } else if (key.startsWith('_trash:')) trash.delete(idOf(key, '_trash:'));
  }
  async function load() {
    docs.clear(); unreadable.clear(); trash.clear();
    for (const item of await host.storage.list('doc:')) remember(item);
    for (const item of await host.storage.list('_trash:')) remember(item);
    if (canEdit) purgeOld();
  }
  // An editor opening the list deletes what has been in the trash for a week, with its text.
  function purgeOld() {
    for (const rec of trash.values()) if (dlTrashExpired(rec, Date.now())) removeForGood(rec.id, true).catch(() => {});
  }

  // The text of a document: its chunks in order. A listed chunk that is missing means a save is in step; read the record again.
  async function readText(id) {
    let rec = docs.get(id);
    for (let tries = 0; tries < 3 && rec; tries += 1) {
      const items = await host.storage.list(`text:${id}:`);
      const byId = new Map();
      for (const it of items) { const c = dlCleanChunk(it.value); if (c && c.doc === id) byId.set(c.id, c.text); }
      if (rec.chunks.every((c) => byId.has(c))) return { rec, text: dlJoin(rec.chunks.map((c) => byId.get(c))) };
      const fresh = await host.storage.get(`doc:${id}`);
      const cleaned = fresh && dlCleanDoc(fresh.value);
      if (!cleaned) return null;
      rec = cleaned;
      docs.set(id, rec);
    }
    return null;
  }
  // Writes a new document: its chunks, then the record (version 0: the key must not exist yet).
  async function create(title, text) {
    const t = dlCleanLine(title, DL.titleMax);
    if (!t) throw new Error('Give the document a title.');
    const split = dlSplit(text);
    if (!split.ok) throw new Error('This document is too long. Split it into two.');
    const id = dlNewId(Math.random, 12);
    const now = new Date().toISOString();
    const plan = dlPlanChunks([], split.chunks, () => dlNewId(Math.random));
    for (const c of plan) await host.storage.set(dlTextKey(id, c.id), { id: c.id, doc: id, text: c.text });
    const rec = { id, type: 'doc', title: t, rev: 1, chunks: plan.map((c) => c.id), size: text.length, excerpt: dlExcerpt(text), by: me, at: now, editedBy: me, editedByName: myName, editedAt: now };
    const r = await host.storage.set(dlDocKey(id), rec, { version: 0 });
    remember({ key: dlDocKey(id), value: rec, version: r && r.version });
    return id;
  }
  async function rename(id, title) {
    const t = dlCleanLine(title, DL.titleMax);
    if (!t) throw new Error('Give the document a title.');
    const cur = await host.storage.get(dlDocKey(id));
    const rec = cur && dlCleanDoc(cur.value);
    if (!rec) throw new Error('This document is gone.');
    const next = { ...rec, title: t, rev: rec.rev + 1, editedBy: me, editedByName: myName, editedAt: new Date().toISOString() };
    await host.storage.set(dlDocKey(id), next, { version: cur.version });
    remember({ key: dlDocKey(id), value: next });
  }
  async function moveToTrash(id) {
    const cur = await host.storage.get(dlDocKey(id));
    const rec = cur && dlCleanDoc(cur.value);
    if (!rec) return;
    const t = { id, type: 'trash', doc: rec, by: me, name: myName, at: new Date().toISOString() };
    await host.storage.set(dlTrashKey(id), t);
    await host.storage.delete(dlDocKey(id), { version: cur.version });
    docs.delete(id);
    trash.set(id, dlCleanTrash(t));
  }
  async function restore(id) {
    const t = trash.get(id);
    if (!t) return;
    await host.storage.set(dlDocKey(id), t.doc, { version: 0 });
    await host.storage.delete(dlTrashKey(id));
    trash.delete(id);
    docs.set(id, t.doc);
  }
  async function removeForGood(id, quiet) {
    for (const it of await host.storage.list(`text:${id}:`)) await host.storage.delete(it.key);
    await host.storage.delete(dlTrashKey(id));
    trash.delete(id);
    if (!quiet) render();
  }

  // ---- the list ------------------------------------------------------------------------------------------------------------
  function el(tag, cls, text) { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function row(rec, trashRec) {
    const li = el('li', 'row');
    li.setAttribute('data-id', rec.id);
    const main = el(trashRec ? 'div' : 'button', 'row-main');
    if (!trashRec) { main.type = 'button'; main.addEventListener('click', () => openDoc(rec.id)); }
    main.append(el('span', 'row-title', rec.title));
    if (rec.excerpt) main.append(el('span', 'row-excerpt', rec.excerpt));
    main.append(el('span', 'meta', trashRec ? `Deleted by ${trashRec.name}, ${when(trashRec.at)}` : `Edited by ${rec.editedByName}, ${when(rec.editedAt)}`));
    li.append(main);
    if (trashRec && canEdit) {
      const back = el('button', 'btn btn-small', 'Restore');
      back.type = 'button';
      back.addEventListener('click', () => restore(rec.id).then(render).catch((e) => note(e.message)));
      const gone = el('button', 'btn btn-quiet btn-small', 'Delete for good');
      gone.type = 'button';
      gone.addEventListener('click', async () => {
        if (await host.ui.confirm({ title: 'Delete for good?', message: `"${rec.title}" and its text will be gone.`, action: 'Delete for good', kind: 'final' })) removeForGood(rec.id).catch((e) => note(e.message));
      });
      li.append(back, gone);
    }
    return li;
  }
  function render() {
    $('new').hidden = !canEdit || showTrash;
    $('trash-toggle').hidden = !canEdit;
    $('trash-toggle').textContent = showTrash ? 'Documents' : `Trash${trash.size ? ` (${trash.size})` : ''}`;
    if (showTrash) $('make').hidden = true;
    const q = query.trim().toLowerCase();
    const recs = showTrash ? [...trash.values()].sort((a, b) => b.at.localeCompare(a.at)).map((t) => ({ rec: t.doc, t }))
      : [...docs.values()].sort((a, b) => b.editedAt.localeCompare(a.editedAt)).map((rec) => ({ rec }));
    const shown = recs.filter(({ rec }) => !q || rec.title.toLowerCase().includes(q) || rec.excerpt.toLowerCase().includes(q));
    const items = shown.map(({ rec, t }) => row(rec, t));
    if (!showTrash) for (const id of unreadable) { const li = el('li', 'row unreadable'); li.append(el('span', 'row-title', 'This document could not be read.')); items.push(li); }
    if (!items.length) {
      const text = q ? 'Nothing matches that.' : showTrash ? 'The trash is empty.' : canEdit ? 'No documents yet.' : 'Nothing has been written here yet.';
      const li = el('li', 'meta', text);
      li.setAttribute('role', 'status');
      items.push(li);
    }
    $('rows').replaceChildren(...items);
    const chars = [...docs.values(), ...[...trash.values()].map((t) => t.doc)].reduce((n, r) => n + r.size, 0);
    $('size').textContent = `${docs.size} ${docs.size === 1 ? 'document' : 'documents'}, about ${Math.max(1, Math.round(chars / 1000))} KB of text. Documents has 5 MB in all, shared by every ${host.util.word("space")}.`;
  }

  // ---- reading -------------------------------------------------------------------------------------------------------------
  async function draw(id) {
    const got = await readText(id);
    if (openId !== id) return;
    if (!got) { $('page').replaceChildren(el('p', null, 'This document could not be loaded. Try again.')); return; }
    const page = $('page');
    const top = $('read').scrollTop;
    shownRev = got.rec.rev;
    $('read-title').textContent = got.rec.title;
    $('read-meta').textContent = `Edited by ${got.rec.editedByName}, ${when(got.rec.editedAt)}`;
    page.replaceChildren(dlBuild(dlDescribe(got.text, lex), doc));
    $('read').scrollTop = top;
  }
  function openDoc(id) {
    if (!docs.has(id)) return;
    openId = id; shownRev = 0;
    $('list').hidden = true; $('read').hidden = false;
    $('rename').hidden = $('remove').hidden = !canEdit;
    $('renamer').hidden = true;
    $('page').replaceChildren();
    $('read-title').textContent = docs.get(id).title;
    draw(id).catch(() => { $('page').replaceChildren(el('p', null, 'This document could not be loaded. Try again.')); });
    $('read-title').closest('.bar').querySelector('button').focus();
  }
  function closeDoc() { openId = null; $('read').hidden = true; $('list').hidden = false; render(); }

  // ---- wiring --------------------------------------------------------------------------------------------------------------
  $('search').addEventListener('input', (e) => { query = e.target.value; render(); });
  $('new').addEventListener('click', () => { $('make').hidden = false; $('make-title').value = ''; $('make-title').focus(); });
  $('make-cancel').addEventListener('click', () => { $('make').hidden = true; });
  $('make').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const id = await create($('make-title').value, ''); $('make').hidden = true; render(); openDoc(id); } catch (err) { note(err.message); }
  });
  $('trash-toggle').addEventListener('click', () => { showTrash = !showTrash; render(); });
  $('back').addEventListener('click', closeDoc);
  $('rename').addEventListener('click', () => { $('renamer').hidden = false; $('rename-title').value = docs.get(openId).title; $('rename-title').focus(); });
  $('rename-cancel').addEventListener('click', () => { $('renamer').hidden = true; });
  $('renamer').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await rename(openId, $('rename-title').value); $('renamer').hidden = true; draw(openId); } catch (err) { note(err.status === 409 ? 'Someone else changed this first. Try again.' : err.message); }
  });
  $('remove').addEventListener('click', async () => {
    const rec = docs.get(openId);
    try {
      if (!rec || !(await host.ui.confirm({ title: 'Delete this document?', message: `"${rec.title}" goes to the trash. You can bring it back for a week.`, action: 'Delete', kind: 'destructive' }))) return;
      await moveToTrash(openId);
      closeDoc();
    } catch (err) { note(err.message); }
  });

  // Another person's change: the small record is the signal. A change to a chunk alone is not heard.
  function applyChange(e) {
    const key = String(e.key || '');
    if (!key.startsWith('doc:') && !key.startsWith('_trash:')) return false;
    if (e.deleted) forget(key); else if (e.value !== undefined) remember({ key, value: e.value }); else return 'reload';
    return true;
  }
  function afterChange() {
    if (openId) {
      const rec = docs.get(openId);
      if (!rec) { note('This document was deleted.'); closeDoc(); return; }
      if (rec.rev > shownRev) draw(openId).catch(() => {});
    } else render();
  }
  host.on('change', (e) => { const r = applyChange(e); if (r === 'reload') reload(); else if (r) afterChange(); });
  host.on('changes', (e) => {
    const list = Array.isArray(e.changes) ? e.changes : [];
    if (!list.some((c) => /^(doc|_trash):/.test(String(c.key)))) return;
    if (list.some((c) => !c.deleted && c.value === undefined)) { reload(); return; }
    for (const c of list) applyChange(c);
    afterChange();
  });
  function reload() { load().then(afterChange).catch(() => {}); }

  // For tests only, until editing exists: makes a document with the text given. Returns its id.
  window.documentsSeed = (title, text) => (canEdit ? create(title, String(text)).then((id) => { render(); return id; }) : Promise.reject(new Error('Not allowed.')));

  try { await load(); } catch (err) { showMsg('Documents could not load', err.message, () => location.reload()); return; }
  render();
  $('loading').hidden = true;
  $('app').hidden = false;
})();
