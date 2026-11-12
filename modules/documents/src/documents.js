// Documents module: the list, reading and editing (build steps 3 and 4). Each space has its own documents. A document is a small
// record (doc:<id>) and its text in chunks (text:<id>:<chunk>); the rules are in the documents-lib-*.js files, which have no page.
// One person edits at a time: Edit takes the lock (_lock:<id>, compare-and-set), the editor refreshes it every 10 s and saves
// 3 s after the last key; the save writes the changed chunks, then the small record under the version read (the commit).
// Tags are the space's shared tags (host.tags): a document's tag ids sit in their own small record (tags:<id>), so tagging never
// competes with a text save. Removing a document puts it in the trash (_trash:<id>), where an editor can bring it back or delete it for good.
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
  const locks = new Map(); // id -> { rec, version, seenAt }: the locks heard, with when this page saw them change
  let ed = null; // the editing session, or null
  const tagsOf = new Map(); // id -> the tag ids of that document (cleaned; a dead id is dropped when shown)
  const knownTags = new Map(); // the space's tags now: id -> { id, name, color }
  let filterTags = []; // the tags chosen in the list's filter (not stored)
  let tagPicker = null; // the open tag picker, or null
  let tagQueue = Promise.resolve(); // this page's own tag changes, one after the other

  const note = (text) => {
    const n = $('note');
    clearTimeout(noteTimer);
    n.textContent = text || '';
    n.hidden = !text;
    if (text) noteTimer = setTimeout(() => note(''), 6000);
  };
  const when = (iso) => { try { return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch (err) { return ''; } };
  const reader = new marked.Marked({ gfm: true, extensions: [DL_MARKED_MATH], hooks: DL_MARKED_HOOKS });
  const lex = (md) => reader.lexer(md);
  const idOf = (key, prefix) => key.slice(prefix.length);

  // ---- storage -------------------------------------------------------------------------------------------------------------
  function remember(item) {
    if (item.key.startsWith('doc:')) {
      const id = idOf(item.key, 'doc:');
      const rec = item.value ? dlCleanDoc(item.value) : null;
      if (rec && rec.id === id) { docs.set(id, rec); unreadable.delete(id); } else { docs.delete(id); unreadable.add(id); }
    } else if (item.key.startsWith('tags:')) {
      const id = idOf(item.key, 'tags:');
      const rec = item.value ? dlCleanTags(item.value, id) : null;
      if (rec) tagsOf.set(id, rec.tags); else tagsOf.delete(id);
    } else if (item.key.startsWith('_trash:')) {
      const rec = item.value ? dlCleanTrash(item.value) : null;
      if (rec && rec.id === idOf(item.key, '_trash:')) trash.set(rec.id, rec);
    } else if (item.key.startsWith('_lock:')) {
      const id = idOf(item.key, '_lock:');
      const rec = item.value ? dlCleanLock(item.value) : null;
      if (rec && rec.doc === id) observeLock(id, rec, item.version, Boolean(item.heard)); else locks.delete(id);
    }
  }
  // A lock record seen. Read at load or take time: how long it has been quiet is judged from its time; heard as a change: just now.
  function observeLock(id, rec, version, heard) {
    const prev = locks.get(id);
    const same = prev && prev.rec.holder === rec.holder && prev.rec.seq === rec.seq && prev.rec.at === rec.at;
    const now = Date.now();
    const seenAt = same ? prev.seenAt : heard ? now : dlLockSeenAt(now, now - Date.parse(rec.at));
    locks.set(id, { rec, version, seenAt });
  }
  const liveLock = (id) => { const l = locks.get(id); return l && !dlLockStale(l.seenAt, Date.now()) ? l : null; };
  function forget(key) {
    if (key.startsWith('doc:')) { docs.delete(idOf(key, 'doc:')); unreadable.delete(idOf(key, 'doc:')); } else if (key.startsWith('_trash:')) trash.delete(idOf(key, '_trash:'));
    else if (key.startsWith('tags:')) tagsOf.delete(idOf(key, 'tags:'));
    else if (key.startsWith('_lock:')) locks.delete(idOf(key, '_lock:'));
  }
  async function load() {
    docs.clear(); unreadable.clear(); trash.clear(); tagsOf.clear();
    for (const item of await host.storage.list('doc:')) remember(item);
    for (const item of await host.storage.list('tags:')) remember(item);
    for (const item of await host.storage.list('_lock:')) remember(item);
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
      if (rec.chunks.every((c) => byId.has(c))) return { rec, text: dlJoin(rec.chunks.map((c) => byId.get(c))), parts: rec.chunks.map((c) => ({ id: c, text: byId.get(c) })), stored: [...byId.keys()] };
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
    const rec = { id, type: 'doc', title: t, rev: 1, chunks: plan.map((c) => c.id), size: text.length, excerpt: dlExcerpt(text, lex), preview: dlPreview(text), paper: DL_PAPER_DEFAULT, ...dlCleanPage(null), by: me, at: now, editedBy: me, editedByName: myName, editedAt: now };
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
    await host.storage.delete(dlTagsKey(id)).catch(() => {});
    tagsOf.delete(id);
    await host.storage.delete(dlTrashKey(id));
    trash.delete(id);
    if (!quiet) render();
  }

  // ---- tags -------------------------------------------------------------------------------------------------------------------
  // A document's tag ids are kept in tags:<id>, apart from doc:<id>: a text save writes only the small record and the chunks, a tag
  // change only this one, so neither can 409 or write over the other. Two people tagging at once are merged (dlTagsCommit). Only
  // the ids of tags the space has now are shown or counted; a tag deleted in Set up simply stops showing.
  const tagsOn = Boolean(host.tags);
  const shownTags = (id) => dlKnownTagIds(tagsOf.get(id) || [], knownTags);
  async function loadTags() {
    if (!tagsOn) return;
    try { const list = await host.tags.list(); knownTags.clear(); for (const t of list) knownTags.set(t.id, t); } catch (err) { /* chips stay off */ }
  }
  function chipRow(id) {
    const chips = shownTags(id).map((t) => host.tags.chip(t)).filter(Boolean);
    if (!chips.length) return null;
    const row = el('span', 'chips');
    row.append(...chips);
    return row;
  }
  function paintTags() {
    if (!openId) return;
    const holder = $('read-tags');
    const row = chipRow(openId);
    holder.replaceChildren(...(row ? [row] : []));
    holder.hidden = !row;
    if (flow) schedulePaginate();
  }
  // Saves the person's ticks as a change on what is stored (so a second person's tag is kept), in order, off the text path.
  function changeTags(id, ids) {
    const delta = dlTagsDelta(shownTags(id), dlKnownTagIds(ids, knownTags));
    if (!delta.add.length && !delta.remove.length) return;
    tagsOf.set(id, dlKnownTagIds(ids, knownTags));
    const store = { get: (k) => host.storage.get(k), set: (k, v, o) => host.storage.set(k, v, o) };
    tagQueue = tagQueue.then(async () => {
      try {
        const out = await dlTagsCommit({ store, id, delta, known: knownTags, me, now: new Date().toISOString() });
        tagsOf.set(id, out.ids);
        if (out.full) note(`Up to ${DL_TAGS_MAX} tags on one ${host.util.word('object')}.`);
        if (tagPicker && openId === id) tagPicker.set(out.ids);
      } catch (err) {
        note(err.status === 409 ? 'Someone else changed the tags at the same time. Try again.' : cleanMsg(err));
        const cur = await host.storage.get(dlTagsKey(id)).catch(() => null);
        const rec = cur && dlCleanTags(cur.value, id);
        if (rec) tagsOf.set(id, rec.tags); else tagsOf.delete(id);
        if (tagPicker && openId === id) tagPicker.set(shownTags(id));
      }
      if (openId === id) paintTags(); else if (!openId && !ed) render();
    });
  }
  // The picker opens under an invisible point at the button's left edge, at the top of the module (the toolbar button has no element here).
  function tagsMenu(e) {
    const id = ed ? ed.id : openId;
    if (!id || !canEdit || !tagsOn || (ed && ed.lost)) return;
    const box = host.rootElement.getBoundingClientRect();
    const a = $('tag-anchor');
    a.style.left = `${box.left + (e && Number.isFinite(e.x) ? e.x : 0)}px`;
    a.style.top = `${box.top}px`;
    try { tagPicker = host.tags.picker(a, { selected: shownTags(id), max: DL_TAGS_MAX, create: canEdit, onChange: (ids) => changeTags(id, ids) }); } catch (err) { note(cleanMsg(err)); }
  }
  function closeTagPicker() { if (tagPicker) { try { tagPicker.close(); } catch (err) { /* already closed */ } tagPicker = null; } }

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
    const tagRow = !trashRec && tagsOn && chipRow(rec.id);
    if (tagRow) main.append(tagRow);
    const held = !trashRec && liveLock(rec.id);
    if (held) main.append(el('span', 'lock-tag', `${held.rec.name} is editing`));
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
  // A thumbnail: a small copy of the page in the document's own colour, its first lines through the same safe reader
  // (tokens to elements, no HTML), the title and who edited it. The description is kept per revision, the elements made fresh.
  const described = new Map();
  function thumbDesc(rec) {
    const k = `${rec.id}:${rec.rev}`;
    if (!described.has(k)) {
      if (described.size > 200) described.clear();
      described.set(k, dlDescribe(dlThumbText(rec), lex));
    }
    return described.get(k);
  }
  function thumbItem(rec, trashRec) {
    const li = el('li', 'thumb-item');
    li.setAttribute('data-id', rec.id);
    const main = el(trashRec ? 'div' : 'button', 'thumb-main');
    if (!trashRec) { main.type = 'button'; main.addEventListener('click', () => openDoc(rec.id)); }
    const thumb = el('div', 'sheet thumb');
    paintPaper(thumb, rec.paper);
    thumb.setAttribute('aria-hidden', 'true');
    const pg = dlCleanPage(rec);
    if (pg.layout === 'paper') { // the page's shape, its margins scaled to the tile, the top of the first page
      const g = dlPageGeometry(pg.pageSize);
      thumb.dataset.layout = 'paper';
      thumb.style.setProperty('--thumb-ar', `${g.w} / ${g.h}`);
      thumb.style.setProperty('--thumb-m', `${((g.margin / g.w) * 100).toFixed(2)}%`);
    }
    const page = el('div', 'page');
    page.append(dlBuild(pg.layout === 'paper' ? dlDescribe(dlThumbPreview(dlThumbText(rec)), lex) : thumbDesc(rec), doc));
    for (const a of page.querySelectorAll('a')) { a.removeAttribute('href'); a.removeAttribute('target'); }
    thumb.append(page);
    main.append(thumb, el('span', 'row-title', rec.title));
    main.append(el('span', 'meta', trashRec ? `Deleted by ${trashRec.name}, ${when(trashRec.at)}` : `Edited by ${rec.editedByName}, ${when(rec.editedAt)}`));
    const tagRow = !trashRec && tagsOn && chipRow(rec.id);
    if (tagRow) main.append(tagRow);
    const held = !trashRec && liveLock(rec.id);
    if (held) main.append(el('span', 'lock-tag', `${held.rec.name} is editing`));
    li.append(main);
    if (trashRec && canEdit) {
      const bar = el('div', 'bar');
      const back = el('button', 'btn btn-small', 'Restore');
      back.type = 'button';
      back.addEventListener('click', () => restore(rec.id).then(render).catch((e) => note(e.message)));
      const gone = el('button', 'btn btn-quiet btn-small', 'Delete for good');
      gone.type = 'button';
      gone.addEventListener('click', async () => {
        if (await host.ui.confirm({ title: 'Delete for good?', message: `"${rec.title}" and its text will be gone.`, action: 'Delete for good', kind: 'final' })) removeForGood(rec.id).catch((e) => note(e.message));
      });
      bar.append(back, gone);
      li.append(bar);
    }
    return li;
  }
  function render() {
    if (showTrash) $('make').hidden = true;
    renderChrome();
    const q = query.trim().toLowerCase();
    const recs = showTrash ? [...trash.values()].sort((a, b) => b.at.localeCompare(a.at)).map((t) => ({ rec: t.doc, t }))
      : [...docs.values()].sort((a, b) => b.editedAt.localeCompare(a.editedAt)).map((rec) => ({ rec }));
    const byTag = (rec) => showTrash || dlTagsMatch(tagsOf.get(rec.id) || [], filterTags, knownTags);
    const shown = recs.filter(({ rec }) => byTag(rec) && (!q || rec.title.toLowerCase().includes(q) || rec.excerpt.toLowerCase().includes(q)));
    const thumbs = listView === 'thumbs';
    $('rows').className = thumbs ? 'thumbs' : 'rows';
    const items = shown.map(({ rec, t }) => (thumbs ? thumbItem(rec, t) : row(rec, t)));
    if (!showTrash) for (const id of unreadable) { const li = el('li', thumbs ? 'thumb-item unreadable' : 'row unreadable'); li.append(el('span', 'row-title', 'This document could not be read.')); items.push(li); }
    if (!items.length) {
      const text = q || filterTags.length ? 'Nothing matches that.' : showTrash ? 'The trash is empty.' : canEdit ? 'No documents yet.' : 'Nothing has been written here yet.';
      const li = el('li', 'meta', text);
      li.setAttribute('role', 'status');
      items.push(li);
    }
    $('rows').replaceChildren(...items);
    const chars = [...docs.values(), ...[...trash.values()].map((t) => t.doc)].reduce((n, r) => n + r.size, 0);
    $('size').textContent = `${docs.size} ${docs.size === 1 ? 'document' : 'documents'}, about ${Math.max(1, Math.round(chars / 1000))} KB of text. Documents has 5 MB in all, shared by every ${host.util.word("space")}.`;
  }

  // ---- the page colour -----------------------------------------------------------------------------------------------------
  // The sheet gets the chosen colour (data-paper names it; documents.css holds the value) and the ink that reads best on it
  // (data-ink, picked by contrast from the two inks in documents.css), so every colour is readable.
  const inks = new Map(); // paper id -> 'dark' | 'light' (the colours are fixed, so each is worked out once)
  function paintPaper(sheet, id) {
    const p = DL_PAPER_BY_ID.get(dlCleanPaper(id));
    if (!inks.has(p.id)) {
      const css = getComputedStyle($('app'));
      const rgb = (name) => dlHexRgb(css.getPropertyValue(name));
      inks.set(p.id, dlInkFor(rgb(p.css), rgb('--doc-fixed-ink-light'), rgb('--doc-fixed-ink-dark')) || 'dark');
    }
    sheet.dataset.paper = p.id;
    sheet.dataset.ink = inks.get(p.id);
  }
  function choosePaper(id) {
    if (!ed || ed.lost || ed.paper === dlCleanPaper(id)) return;
    ed.paper = dlCleanPaper(id);
    paintPaper($('editor').querySelector('.sheet'), ed.paper);
    typed();
  }
  function paperMenu(e) {
    if (!ed || ed.lost) return;
    const swatch = (p) => getComputedStyle($('app')).getPropertyValue(p.css).trim();
    const items = [{ heading: 'Page colour' }, ...dlPaperMenuModel().map((m) => {
      if (m.kind === 'heading') return { heading: m.label };
      const p = DL_PAPER_BY_ID.get(m.id);
      const now = m.id === ed.paper;
      return { id: m.id, label: m.label, current: now, ariaLabel: `${m.label} page colour${now ? ', chosen' : ''}`, icon: 'circle', iconColor: swatch(p) || undefined, onClick: () => choosePaper(m.id) };
    })];
    host.menu.show({ id: 'paper', at: { x: e && Number.isFinite(e.x) ? e.x : 100000, y: 4 }, items });
  }

  // ---- the page: layout, size, numbers --------------------------------------------------------------------------------------
  // The sheet wears the document's layout (data-layout: Paper is drawn as one sheet of the page's width with its margins,
  // documents.css) and size (data-size). The page's measures come from dlPageGeometry, set as custom properties so the style
  // sheet holds no number of its own. Paper is paged in the reading view (below) and one sheet in the editors. A Paper sheet at Fit width is scaled to the window's width.
  function paintPage(sheet, page) {
    if (!sheet) return;
    const p = dlCleanPage(page);
    const g = dlPageGeometry(p.pageSize);
    sheet.dataset.layout = p.layout;
    sheet.dataset.size = p.pageSize;
    sheet.dataset.numbers = p.pageNumbers ? 'on' : 'off';
    sheet.style.setProperty('--doc-page-w', `${g.w}px`);
    sheet.style.setProperty('--doc-page-h', `${g.h}px`);
    sheet.style.setProperty('--doc-page-m', `${g.margin}px`);
    fitPaper();
  }
  // Fit width on a Paper sheet: the page scaled to the window's width (never above 100%). Other sheets, and a zoom level,
  // follow the app's --doc-zoom.
  function fitPaper() {
    const avail = (box) => {
      const cs = getComputedStyle(box);
      return box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    };
    for (const id of ['read', 'editor']) {
      const box = $(id);
      const sheet = box.querySelector('.sheet');
      if (!sheet) continue;
      const paper = sheet.dataset.layout === 'paper';
      if (paper && view === 'fit' && !box.hidden) {
        const w = avail(box);
        const pageW = dlPageGeometry(sheet.dataset.size).w;
        const narrow = dlPaperNarrow(w, pageW, sheet.hasAttribute('data-narrow'));
        if (narrow !== sheet.hasAttribute('data-narrow')) { // below the floor the sheet is drawn as Fluid
          sheet.toggleAttribute('data-narrow', narrow);
          if (id === 'read') schedulePaginate();
        }
        if (narrow) sheet.style.removeProperty('--doc-zoom'); else sheet.style.setProperty('--doc-zoom', String(dlPageFit(w, pageW)));
      } else {
        sheet.style.removeProperty('--doc-zoom');
        if (sheet.hasAttribute('data-narrow')) { sheet.removeAttribute('data-narrow'); if (id === 'read') schedulePaginate(); }
      }
    }
    pageEditor();
    sizeEditSoon();
  }
  // Paper above the narrow floor shows real pages in the rich editor while typing (spacers; documents-lib-t-editor-pages.js). The Markdown box,
  // Fluid and a narrow window are not paged.
  function pageEditor() {
    const sheet = $('editor').querySelector('.sheet-edit');
    if (!sheet) return;
    const on = Boolean(rich && ed && ed.editor && ed.editor.setPaged && !$('editor').hidden && sheet.dataset.layout === 'paper' && !sheet.hasAttribute('data-narrow'));
    sheet.toggleAttribute('data-epaged', on);
    if (ed && ed.editor && ed.editor.setPaged) ed.editor.setPaged(on, sheet.dataset.size);
  }
  // The editing sheet has no frame of its own: the text box is as tall as its text (scrollHeight, not the text) and the view scrolls.
  // In Paper the sheet is a whole number of pages tall (at least one). Not real page breaks yet.
  let sizeQueued = false;
  function sizeEditSoon() {
    if (sizeQueued) return;
    sizeQueued = true;
    requestAnimationFrame(() => { sizeQueued = false; sizeEdit(); });
  }
  function sizeEdit() {
    const box = $('editor');
    const sheet = box.querySelector('.sheet-edit');
    if (box.hidden || !sheet) return;
    const top = box.scrollTop; // measuring collapses the box for a moment; the view must not lose its place
    sheet.style.minHeight = '';
    const ta = $('edit-text');
    if (!ta.hidden) {
      ta.style.flexGrow = '0'; ta.style.height = 'auto';
      const h = ta.scrollHeight;
      ta.style.height = `${h}px`; ta.style.flexGrow = '';
    }
    if (sheet.dataset.layout === 'paper' && !sheet.hasAttribute('data-narrow') && !sheet.hasAttribute('data-epaged')) {
      const ph = dlPageGeometry(sheet.dataset.size).h;
      const keep = sheet.style.flexGrow; sheet.style.flexGrow = '0';
      const h = sheet.offsetHeight;
      sheet.style.flexGrow = keep;
      sheet.style.minHeight = `${Math.max(1, Math.ceil((h - 1) / ph)) * ph}px`;
    }
    box.scrollTop = top;
  }
  // typing at the end of the text box: keep the caret in view (the view scrolls, not the box); the rich editor scrolls its own selection
  function keepCaret() {
    const ta = $('edit-text');
    if (ta.hidden || ta.getRootNode().activeElement !== ta || ta.selectionEnd !== ta.textLength) return;
    sizeEdit();
    const r = ta.getBoundingClientRect(); const v = $('editor').getBoundingClientRect();
    if (r.bottom > v.bottom - 24) $('editor').scrollTop += r.bottom - v.bottom + 24;
  }
  function chooseLayout(v) {
    if (!ed || ed.lost) return;
    const layout = dlCleanLayout(v);
    if (ed.page.layout === layout) return;
    ed.page = { ...ed.page, layout };
    pageChanged();
  }
  function pageChanged() {
    paintPage($('editor').querySelector('.sheet'), ed.page);
    typed();
    renderChrome();
    ed.editor.focus();
  }
  function choosePageSize(id) {
    if (!ed || ed.lost || ed.page.pageSize === dlCleanPageSize(id)) return;
    ed.page = { ...ed.page, pageSize: dlCleanPageSize(id) };
    pageChanged();
  }
  function togglePageNumbers() {
    if (!ed || ed.lost) return;
    ed.page = { ...ed.page, pageNumbers: !ed.page.pageNumbers };
    pageChanged();
  }
  // The Page button's menu: the page colour (its own menu), the size and the numbers.
  function pageMenu(e) {
    if (!ed || ed.lost) return;
    const at = { x: e && Number.isFinite(e.x) ? e.x : 100000, y: 4 };
    const items = [{ id: 'colour', label: 'Page colour...', icon: 'palette', onClick: () => paperMenu(e) }, ...dlPageMenuModel(ed.page).map((m) => {
      if (m.kind === 'heading') return { heading: m.label };
      if (m.kind === 'size') return { id: m.id, label: m.label, current: m.current, ariaLabel: `${m.label}${m.current ? ', chosen' : ''}`, icon: 'ruler-combined', onClick: () => choosePageSize(m.id) };
      if (m.kind === 'numbers') return { id: m.id, label: m.label, current: m.current, ariaLabel: `${m.label}${m.current ? ', on' : ', off'}`, icon: 'arrow-down-1-9', onClick: togglePageNumbers };
      return null;
    }).filter(Boolean)];
    host.menu.show({ id: 'page', at, items });
  }

  // ---- Paper in the reading view: separate pages --------------------------------------------------------------------------------
  // A Paper document is drawn as sheets of the page's size. The blocks are laid out once in a hidden box as wide as the page's text
  // area (unscaled px, outside the zoomed sheet), each block's height is read, dlPageBreaks says where the pages end, and the same
  // nodes are moved into the sheets (never rebuilt, never set as HTML). The title, the line under it and the tags are the first blocks
  // of the first page. Nothing about the breaks is stored. Zoom and Fit width scale the whole sheet (fitPaper) and change no page.
  // It runs again when the text, the layout, the size, the numbers or the tags change and when fonts have loaded (formulas are not
  // drawn in the reader, they show as written, so there is nothing else to wait for). A text with more blocks than PAGES_MAX is not
  // paged: it shows as one sheet with its breaks as dashed lines.
  const PAGES_MAX = 6000;
  let flow = null; // { root, entries }: the document shown, its top-level nodes in order
  let paginateFrame = 0;
  const HEAD_IDS = ['read-title', 'read-meta', 'read-tags'];
  function restoreHead() {
    const sheet = $('read').querySelector('.sheet');
    for (const id of HEAD_IDS) sheet.insertBefore($(id), $('page'));
  }
  function clearPage(content) {
    restoreHead();
    flow = null;
    $('read').querySelector('.sheet').removeAttribute('data-paged');
    if (content) $('page').replaceChildren(content); else $('page').replaceChildren();
  }
  function flowEntries(root) {
    return [...root.children].map((n) => {
      let kind = 'block';
      if (/^H[1-6]$/.test(n.tagName)) kind = 'heading';
      else if (n instanceof HTMLTableElement) kind = 'grid';
      else if (n.tagName === 'PRE') kind = 'code';
      else if (n.classList.contains('dl-math-block')) kind = 'formula';
      else if (n.classList.contains('dl-pagebreak')) kind = 'pagebreak';
      const e = { node: n, kind };
      if (kind === 'grid') { e.rows = [...n.rows]; e.head = n.tHead; e.body = n.tBodies[0]; }
      return e;
    });
  }
  function schedulePaginate() {
    if (paginateFrame || !flow) return;
    paginateFrame = window.requestAnimationFrame(() => { paginateFrame = 0; paginateRead(); });
  }
  function paginateRead() {
    if (!flow) return;
    const sheet = $('read').querySelector('.sheet');
    const page = $('page');
    restoreHead();
    for (const e of flow.entries) if (e.kind === 'grid') e.rows.forEach((tr, i) => (i === 0 ? e.head : e.body).append(tr));
    if (sheet.dataset.layout !== 'paper' || sheet.hasAttribute('data-narrow') || flow.entries.length > PAGES_MAX) { // one sheet: Fluid, or too long to page
      flow.root.replaceChildren(...flow.entries.map((e) => e.node));
      page.replaceChildren(flow.root);
      sheet.removeAttribute('data-paged');
      return;
    }
    const t0 = performance.now();
    const g = dlPageGeometry(sheet.dataset.size);
    const all = [...HEAD_IDS.map($).filter((n) => !n.hidden).map((n) => ({ node: n, kind: n.id === 'read-title' ? 'heading' : 'block' })), ...flow.entries];
    const measure = el('div', 'page dl-flow dl-measure');
    measure.setAttribute('aria-hidden', 'true');
    measure.style.width = `${g.textW}px`;
    const look = getComputedStyle(sheet); // the sheet's colours (borders and fills use them, so they change a block's size)
    for (const v of ['--doc-ink', '--doc-paper', '--doc-edge', '--doc-quiet', '--doc-field']) measure.style.setProperty(v, look.getPropertyValue(v));
    const wraps = all.map((e) => { if (e.kind === 'pagebreak') return null; const w = el('div', 'dl-blk'); w.append(e.node); measure.append(w); return w; });
    $('app').append(measure);
    const blocks = all.map((e, i) => {
      if (e.kind === 'pagebreak') return { height: 0, kind: 'pagebreak' };
      const b = { height: wraps[i].getBoundingClientRect().height, kind: e.kind };
      if (e.kind === 'grid') {
        // a row is the distance to the next row's top (so borders count once); the last one runs to the foot of the block, margin included
        const tops = e.rows.map((tr) => tr.getBoundingClientRect().top);
        const foot = wraps[i].getBoundingClientRect().bottom;
        b.rows = tops.map((top, k) => (k < tops.length - 1 ? tops[k + 1] : foot) - top);
        e.cols = [...e.rows[0].cells].map((c) => c.getBoundingClientRect().width); // a piece keeps the columns of the whole grid
      }
      return b;
    });
    const mi = all.findIndex((e) => e.node.id === 'read-meta'); // the line under the title is not in the editor; it hands the editor its height so the first page holds the same
    if (mi >= 0) $('app').style.setProperty('--dl-meta-h', `${blocks[mi].height}px`);
    const r = dlPageBreaks(blocks, g.textH);
    const numbers = sheet.dataset.numbers === 'on';
    const frag = doc.createDocumentFragment();
    r.pages.forEach((p, n) => {
      const pg = el('div', 'dl-pg');
      if (p.tall) pg.dataset.tall = 'on';
      const text = el('div', 'page dl-flow');
      if (n === 0) for (const i of r.before) text.append(all[i].node);
      for (const it of p.items) {
        if (it.from === undefined) { text.append(wraps[it.i]); continue; }
        const e = all[it.i];
        const w = el('div', 'dl-blk');
        const t = e.node.cloneNode(false);
        const th = e.head.cloneNode(false);
        const tb = e.body.cloneNode(false);
        for (let k = it.from; k < it.to; k += 1) (k === 0 ? th : tb).append(e.rows[k]);
        if (it.to < e.rows.length) t.style.marginBottom = '0';
        const first = (th.firstChild || tb.firstChild);
        if (first) [...first.cells].forEach((c, k) => { c.style.boxSizing = 'border-box'; if (e.cols[k]) c.style.width = `${e.cols[k]}px`; });
        if (th.firstChild) t.append(th);
        if (tb.firstChild) t.append(tb);
        w.append(t);
        text.append(w);
      }
      for (const i of p.breaks) text.append(all[i].node);
      pg.append(text);
      if (numbers) { const num = el('div', 'dl-pg-num', String(n + 1)); num.setAttribute('aria-hidden', 'true'); pg.append(num); }
      frag.append(pg);
    });
    measure.remove();
    page.replaceChildren(frag);
    sheet.dataset.paged = 'on';
    try { performance.measure('documents-paginate', { start: t0, end: performance.now(), detail: { blocks: all.length, pages: r.pages.length } }); } catch { /* no timing */ }
  }
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(() => { schedulePaginate(); if (ed && ed.editor && ed.editor.measurePages) ed.editor.measurePages(); }).catch(() => {});
  if (doc.fonts && doc.fonts.addEventListener) doc.fonts.addEventListener('loadingdone', schedulePaginate);

  // ---- reading -------------------------------------------------------------------------------------------------------------
  async function draw(id) {
    const got = await readText(id);
    if (openId !== id) return;
    if (!got) { clearPage(el('p', null, 'This document could not be loaded. Try again.')); return; }
    const page = $('page');
    const top = $('read').scrollTop;
    shownRev = got.rec.rev;
    paintPaper($('read').querySelector('.sheet'), got.rec.paper);
    paintPage($('read').querySelector('.sheet'), got.rec);
    $('read-title').textContent = got.rec.title;
    $('read-meta').textContent = `Edited by ${got.rec.editedByName}, ${when(got.rec.editedAt)}`;
    paintTags();
    restoreHead();
    const built = dlBuild(dlDescribe(got.text, lex), doc);
    flow = { root: built, entries: flowEntries(built) };
    paginateRead();
    $('read').scrollTop = top;
  }
  function openDoc(id) {
    if (!docs.has(id)) return;
    openId = id; shownRev = 0;
    $('list').hidden = true; $('read').hidden = false;
    $('renamer').hidden = true;
    updateEditButton();
    clearPage();
    $('read-title').textContent = docs.get(id).title;
    paintTags();
    paintPaper($('read').querySelector('.sheet'), docs.get(id).paper);
    paintPage($('read').querySelector('.sheet'), docs.get(id));
    draw(id).catch(() => { clearPage(el('p', null, 'This document could not be loaded. Try again.')); });
    renderChrome();
    $('page').focus();
  }
  function closeDoc() { closeTagPicker(); openId = null; $('read').hidden = true; $('list').hidden = false; render(); }

  // ---- wiring --------------------------------------------------------------------------------------------------------------
  $('make-cancel').addEventListener('click', () => { $('make').hidden = true; });
  $('make').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const id = await create($('make-title').value, ''); $('make').hidden = true; render(); openDoc(id); } catch (err) { note(err.message); }
  });
  const heldByOther = (id) => { const l = liveLock(id); return l && l.rec.holder !== me ? l : null; };
  const startRename = () => {
    const l = heldByOther(openId);
    if (l) { note(`${l.rec.name} is editing this. Try again when they are done.`); return; }
    $('renamer').hidden = false; $('rename-title').value = docs.get(openId).title; $('rename-title').focus();
  };
  $('rename-cancel').addEventListener('click', () => { $('renamer').hidden = true; });
  $('renamer').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await rename(openId, $('rename-title').value); $('renamer').hidden = true; draw(openId); } catch (err) { note(err.status === 409 ? 'Someone else changed this first. Try again.' : err.message); }
  });
  const startRemove = async () => {
    const rec = docs.get(openId);
    const l = heldByOther(openId);
    if (l) { note(`${l.rec.name} is editing this. Try again when they are done.`); return; }
    try {
      if (!rec || !(await host.ui.confirm({ title: 'Delete this document?', message: `"${rec.title}" goes to the trash. You can bring it back for a week.`, action: 'Delete', kind: 'destructive' }))) return;
      await moveToTrash(openId);
      closeDoc();
    } catch (err) { note(err.message); }
  };

  // Another person's change: the small record is the signal. A change to a chunk alone is not heard.
  function applyChange(e) {
    const key = String(e.key || '');
    if (!/^(doc|_trash|_lock|tags):/.test(key)) return false;
    if (e.deleted) forget(key); else if (e.value !== undefined) remember({ key, value: e.value, version: e.version, heard: true }); else return 'reload';
    return true;
  }
  function afterChange() {
    if (tagPicker && (openId || ed)) tagPicker.set(shownTags(ed ? ed.id : openId));
    if (ed) { hearLock(); return; }
    if (openId) {
      updateEditButton();
      paintTags();
      const rec = docs.get(openId);
      if (!rec) { note('This document was deleted.'); closeDoc(); return; }
      if (rec.rev > shownRev) draw(openId).catch(() => {});
    } else render();
  }
  host.on('change', (e) => { const r = applyChange(e); if (r === 'reload') reload(); else if (r) afterChange(); });
  host.on('changes', (e) => {
    const list = Array.isArray(e.changes) ? e.changes : [];
    if (!list.some((c) => /^(doc|_trash|_lock|tags):/.test(String(c.key)))) return;
    if (list.some((c) => !c.deleted && c.value === undefined)) { reload(); return; }
    for (const c of list) applyChange(c);
    afterChange();
  });
  // A tag added, renamed, recoloured or deleted in the space: the list is kept by the SDK; draw again.
  if (tagsOn) host.on('tags', () => { loadTags().then(() => { if (openId) { paintTags(); if (tagPicker) tagPicker.set(shownTags(openId)); } else if (!ed) { render(); } }).catch(() => {}); });
  function reload() { load().then(afterChange).catch(() => {}); }

  // ---- catching up after a dropped connection ---------------------------------------------------------------------------------
  // When the live stream is back, the browser is online again, or the page shows after a while hidden, read the lists again (reads
  // only). The rules are dlResyncPlan: the list is redrawn, a text being read only on a higher rev, a text being edited never
  // (only the lock is looked at). Everything is read first and applied only if every read worked. One at a time; one more queued.
  let resyncing = false;
  let resyncAgain = false;
  async function resyncDocs() {
    if (resyncing) { resyncAgain = true; return; }
    resyncing = true;
    try {
      do {
        resyncAgain = false;
        let read = null;
        try {
          read = {};
          for (const p of ['doc:', 'tags:', '_lock:', '_trash:']) read[p] = await host.storage.list(p);
        } catch (err) { read = null; }
        const state = ed ? 'editing' : openId ? 'reading' : 'list';
        let rec = null;
        if (read && state === 'reading') {
          const item = read['doc:'].find((i) => i.key === `doc:${openId}`);
          rec = item && item.value ? dlCleanDoc(item.value) : null;
        }
        const plan = dlResyncPlan({ state, shownRev, rec, ok: Boolean(read) });
        if (!plan.apply) continue;
        const top = $('list').scrollTop;
        const mine = ed && locks.get(ed.id);
        docs.clear(); unreadable.clear(); trash.clear(); tagsOf.clear();
        const seen = new Set();
        for (const p of ['doc:', 'tags:', '_lock:', '_trash:']) for (const item of read[p]) { remember(item); if (p === '_lock:') seen.add(idOf(item.key, p)); }
        for (const id of [...locks.keys()]) if (!seen.has(id) && !(ed && id === ed.id)) locks.delete(id);
        if (ed && mine && !seen.has(ed.id)) locks.set(ed.id, mine);
        if (plan.checkLock) { hearLock(); serial(refreshLock).then(() => schedule(true)).catch(() => {}); } // a lost lock is noticed now
        else if (plan.closeReading) { note('This document was deleted.'); closeDoc(); } else if (plan.redrawReading) { updateEditButton(); paintTags(); draw(openId).catch(() => {}); } else if (plan.redrawList) { render(); $('list').scrollTop = top; } else if (openId) { updateEditButton(); paintTags(); }
      } while (resyncAgain);
    } catch (err) { /* the next change or a reload puts it right */ } finally { resyncing = false; }
  }
  let hiddenAt = 0;
  host.on('reconnected', () => { resyncDocs(); });
  window.addEventListener('online', () => { resyncDocs(); });
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') hiddenAt = Date.now();
    else { const gap = dlResyncAfterHidden(hiddenAt, Date.now()); hiddenAt = 0; if (gap) resyncDocs(); }
  });

  // ---- the lock and editing ------------------------------------------------------------------------------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cleanMsg = (err) => (err && err.message) || 'That did not work. Try again.';

  // The Edit button: on, or off with the reason beside it.
  let editOff = false;
  let why = '';
  function updateEditButton() {
    if (!canEdit || !openId || ed) return;
    const l = liveLock(openId);
    const st = dlLockEditState({ canEdit, me, rec: l && l.rec, fresh: Boolean(l), mine: false });
    editOff = !st.enabled;
    why = st.reason;
    renderChrome();
  }
  // A lock goes stale with no event, so the page looks again every few seconds.
  const looker = setInterval(() => {
    if (!$('app')) return void clearInterval(looker);
    if (ed || !locks.size) return;
    if (openId) updateEditButton(); else if (!showTrash && !$('list').hidden) render();
  }, 5000);

  async function startEdit() {
    const id = openId;
    if (!id || ed || !canEdit) return;
    editOff = true; renderChrome();
    try {
      const cur = await host.storage.get(dlLockKey(id));
      const rec = cur && dlCleanLock(cur.value);
      const held = rec && rec.doc === id ? rec : null;
      if (held) observeLock(id, held, cur.version, false); else locks.delete(id);
      const plan = dlLockTakePlan({ canEdit, me, rec: held, fresh: Boolean(liveLock(id)), mine: false });
      if (plan !== 'take') { updateEditButton(); const st = dlLockEditState({ canEdit, me, rec: held, fresh: true, mine: false }); note(st.reason || 'You cannot edit this.'); return; }
      const next = dlLockNext(id, me, myName, new Date().toISOString(), held);
      let r;
      try { r = await host.storage.set(dlLockKey(id), next, { version: cur ? cur.version : 0 }); } catch (err) {
        if (dlLockTakeResult(err) === 'busy') { const again = await host.storage.get(dlLockKey(id)).catch(() => null); const lr = again && dlCleanLock(again.value); if (lr) observeLock(id, lr, again.version, true); updateEditButton(); note(lr ? `${lr.name} is editing this. You can read it as it changes.` : 'Someone else is editing this.'); } else note('Could not start editing. Try again.');
        return;
      }
      const lock = { rec: next, version: r && r.version };
      locks.set(id, { rec: next, version: lock.version, seenAt: Date.now() });
      try { await openEditor(id, lock); } catch (err) {
        host.storage.delete(dlLockKey(id), { version: lock.version }).catch(() => {});
        locks.delete(id);
        note(cleanMsg(err));
        updateEditButton();
      }
    } catch (err) { note(cleanMsg(err)); updateEditButton(); }
  }

  // Reads the small record with its version and the text it lists; the person who has the lock deletes leftover chunks.
  async function readForEdit(id) {
    for (let tries = 0; tries < 3; tries += 1) {
      const cur = await host.storage.get(dlDocKey(id));
      const rec = cur && dlCleanDoc(cur.value);
      if (!rec) throw new Error('This document is gone.');
      docs.set(rec.id, rec);
      const got = await readText(rec.id);
      if (!got) throw new Error('This document could not be loaded. Try again.');
      if (got.rec.rev === rec.rev) return { rec, version: cur.version, got };
    }
    throw new Error('This document could not be loaded. Try again.');
  }

  // ---- the editor: the Markdown text box (what people get) or the rich editor (a person's own choice, kept in this browser) ----
  const RICH_KEY = 'documents-rich';
  let rich = false;
  try { rich = window.localStorage.getItem(RICH_KEY) === '1'; } catch { /* no browser storage: the text box */ }
  const INEXACT = 'This block has formatting Markdown cannot keep exactly; switch to Markdown to check.';
  // Makes the editor for the choice, with this text, in the sheet: one of the two shows, both behind the same adapter.
  function mountEditor(text) {
    const ta = $('edit-text');
    const box = $('edit-rich');
    $('editor').scrollTop = 0; // a new document starts at its top, not where the last one was scrolled to
    ta.hidden = rich; box.hidden = !rich;
    ed.editor = rich ? dlRichEditor(DlPM, doc, lex, box) : dlTextareaEditor(ta, doc);
    ed.editor.onChange(typed);
    ed.editor.onChange(() => { sizeEditSoon(); keepCaret(); });
    if (ed.editor.onSelect) ed.editor.onSelect(paintActive);
    if (ed.editor.onLink) ed.editor.onLink(() => linkWith(null));
    ed.editor.setText(text); ed.editor.setReadOnly(Boolean(ed.lost));
    pageEditor();
    sizeEditSoon();
    ed.inexact = false;
    paintActive();
  }
  // After the text was read from the rich editor: a block that Markdown cannot keep exactly is saved as typed, and said once.
  function sayInexact(always) {
    const w = ed && ed.editor.lastWrite ? ed.editor.lastWrite() : null;
    if (!w) return;
    if (w.same) { ed.inexact = false; return; }
    if (always || !ed.inexact) note(INEXACT);
    ed.inexact = true;
  }
  // The switch: the text goes from one editor to the other as Markdown. What is not saved yet stays not saved.
  function setRich(on) {
    const next = Boolean(on);
    const swap = () => {
      if (next === rich) return;
      rich = next;
      try { window.localStorage.setItem(RICH_KEY, rich ? '1' : '0'); } catch { /* kept for this visit only */ }
      if (ed && !ed.lost) {
        const text = ed.editor.getText();
        sayInexact(true);
        ed.editor.destroy();
        mountEditor(text);
        ed.savedRev = text === ed.saved.text ? ed.editor.revision() : NaN;
        ed.editor.focus();
        setStatus(); schedule(false);
      }
      renderChrome();
    };
    if (ed && !ed.lost) serial(swap).catch(() => {}); else swap(); // after a save that is under way, so its counter is not mixed up
  }

  async function openEditor(id, lock) {
    const { rec, version, got } = await readForEdit(id);
    ed = {
      id, rec, docVersion: version, old: got.parts, lock, text: got.text, paper: rec.paper, page: dlCleanPage(rec), saved: { text: got.text, title: rec.title, paper: rec.paper, page: dlCleanPage(rec) }, savedRev: 0,
      lastKey: NaN, lastSave: -Infinity, saving: false, failed: false, refused: '', lost: false, log: [], stray: [],
      timer: 0, beat: 0, queue: Promise.resolve(),
    };
    for (const cid of dlLeftoverChunks(rec.chunks, got.stored)) host.storage.delete(dlTextKey(id, cid)).catch(() => {});
    $('read').hidden = true; $('list').hidden = true; $('editor').hidden = false;
    $('edit-title').value = rec.title;
    paintPaper($('editor').querySelector('.sheet'), ed.paper);
    paintPage($('editor').querySelector('.sheet'), ed.page);
    mountEditor(got.text);
    ed.savedRev = ed.editor.revision();
    $('edit-title').readOnly = false;
    $('lost').hidden = true;
    renderChrome();
    const beat = setInterval(() => {
      if (!$('app')) return void clearInterval(beat);
      serial(refreshLock).catch(() => {});
    }, DL_LOCK.beat);
    ed.beat = beat;
    ed.editor.focus();
  }

  const serial = (fn) => {
    const s = ed;
    const run = s.queue.then(() => (s === ed ? fn() : undefined));
    s.queue = run.catch(() => {});
    return run;
  };
  // Never reads the text: the editor's change counter and the title and paper decide (the text is read only by snapshot()).
  const dirtyNow = () => ed && dlEditorDirty(ed.editor, ed.savedRev, ed.saved, $('edit-title').value, ed.paper, ed.page);
  const snapshot = () => dlEditorSnapshot(ed.editor, ed.saved, $('edit-title').value, ed.paper, ed.page);
  function setStatus() {
    if (!ed) return;
    renderStatus();
  }

  async function refreshLock() {
    if (!ed || ed.lost) return;
    const next = dlLockNext(ed.id, me, myName, new Date().toISOString(), ed.lock.rec);
    try {
      const r = await host.storage.set(dlLockKey(ed.id), next, { version: ed.lock.version });
      ed.log.push(Date.now());
      ed.lock = { rec: next, version: r && r.version };
      locks.set(ed.id, { rec: next, version: ed.lock.version, seenAt: Date.now() });
    } catch (err) {
      if (dlLockRefreshResult(err) === 'lost') loseLock();
    }
  }
  // Another person holds the lock now: the editor stops taking keys and keeps the text on the screen.
  function hearLock() {
    if (!ed || ed.lost) return;
    const l = locks.get(ed.id);
    if (l && dlLockHear({ rec: l.rec, fresh: true, me, editing: true }) === 'lost') loseLock();
  }
  function loseLock() {
    if (!ed || ed.lost) return;
    ed.lost = true;
    clearTimeout(ed.timer); clearInterval(ed.beat);
    ed.editor.setReadOnly(true); $('edit-title').readOnly = true;
    $('lost-text').textContent = 'You stopped editing because someone else saved first. Your changes are kept here.';
    $('lost').hidden = false;
    renderChrome();
    $('lost-copy').focus();
  }

  // The commit: the changed chunks, then the small record with rev + 1 under the version read. -> 'saved' | 'conflict' | 'failed' |
  // 'title' | 'long' | 'lost'.
  function saveNow() {
    return serial(async () => {
      if (!ed || ed.lost) return 'lost';
      const cur = snapshot();
      sayInexact(false);
      if (!cur.changed) { ed.savedRev = cur.rev; return 'saved'; }
      const plan = dlPlanSave({ old: ed.old, text: cur.text, title: cur.title, paper: cur.paper, page: cur.page, rec: ed.rec, me, name: myName, now: new Date().toISOString(), fresh: () => dlNewId(Math.random), lex });
      if (!plan.ok) {
        ed.refused = plan.reason;
        note(plan.reason === 'title' ? 'Give the document a title.' : 'This document is too long. Split it into two.');
        setStatus();
        return plan.reason;
      }
      const wait = dlWriteWait(ed.log, Date.now(), plan.writes.length + 1);
      if (wait) await sleep(wait);
      if (!ed || ed.lost) return 'lost';
      ed.saving = true; ed.failed = false; ed.lastSave = Date.now(); setStatus();
      const wrote = [];
      try {
        for (const c of plan.writes) { await host.storage.set(dlTextKey(ed.id, c.id), { id: c.id, doc: ed.id, text: c.text }); wrote.push(c.id); ed.log.push(Date.now()); }
        const r = await host.storage.set(dlDocKey(ed.id), plan.record, { version: ed.docVersion });
        ed.log.push(Date.now());
        ed.docVersion = r && r.version;
      } catch (err) {
        ed.saving = false;
        ed.stray.push(...wrote);
        if (dlCommitResult(err) === 'conflict') { loseLock(); return 'conflict'; }
        ed.failed = true; setStatus();
        return 'failed';
      }
      ed.saving = false;
      ed.rec = plan.record;
      ed.old = plan.chunks.map((c) => ({ id: c.id, text: c.text }));
      ed.saved = { text: cur.text, title: cur.title, paper: cur.paper, page: cur.page }; ed.savedRev = cur.rev;
      remember({ key: dlDocKey(ed.id), value: plan.record });
      const gone = [...plan.dropped, ...ed.stray.filter((x) => !plan.chunks.some((c) => c.id === x))];
      ed.stray = [];
      for (const cid of gone) host.storage.delete(dlTextKey(ed.id, cid)).catch(() => {});
      setStatus();
      return 'saved';
    });
  }
  // Plans the next autosave: 3 s after the last key, never within 3 s of the last save.
  function schedule(force) {
    if (!ed || ed.lost) return;
    clearTimeout(ed.timer);
    if (ed.refused) return;
    const d = dlAutosaveDelay({ now: Date.now(), lastKey: ed.lastKey, lastSave: ed.lastSave, dirty: dirtyNow(), force: Boolean(force) });
    if (d === null) return;
    const mine = ed;
    ed.timer = setTimeout(() => { saveNow().then(() => { if (ed === mine) schedule(false); }).catch(() => {}); }, d);
  }
  function typed() {
    if (!ed || ed.lost) return;
    ed.lastKey = Date.now(); ed.refused = '';
    setStatus(); schedule(false);
  }

  function stopEditing() {
    if (!ed) return;
    closeTagPicker();
    clearTimeout(ed.timer); clearInterval(ed.beat);
    ed.editor.destroy();
    ed = null;
    $('editor').hidden = true;
    $('edit-rich').hidden = true; $('edit-text').hidden = false;
  }
  async function finish() {
    if (!ed || ed.lost) return;
    const mine = ed;
    ed.finishing = true; renderChrome();
    clearTimeout(ed.timer);
    const d = dlAutosaveDelay({ now: Date.now(), lastKey: ed.lastKey, lastSave: ed.lastSave, dirty: dirtyNow(), force: true });
    if (d) await sleep(d);
    const r = await saveNow();
    if (ed !== mine || mine.lost) return;
    if (r !== 'saved') {
      mine.finishing = false; renderChrome();
      if (r === 'failed') note('Not saved. Try Done again.');
      return;
    }
    const lockVersion = mine.lock.version;
    await mine.queue;
    stopEditing();
    host.storage.delete(dlLockKey(mine.id), { version: lockVersion }).catch(() => {});
    locks.delete(mine.id);
    $('read').hidden = false;
    openId = mine.id; shownRev = 0;
    clearPage();
    $('read-title').textContent = docs.get(mine.id) ? docs.get(mine.id).title : '';
    updateEditButton();
    draw(mine.id).catch(() => {});
    renderChrome();
    $('page').focus();
  }

  // The bar: each button runs its action in the editor, which keeps the browser's undo where it can.
  function applyFormat(action) {
    if (!ed || ed.lost) return;
    ed.editor.run(action);
  }
  // A link in the rich editor: the Link button and Ctrl or Cmd with K. With no link at the caret or the selection, the shared
  // prompt asks for the address: the selection is linked, and at a caret the address itself goes in as the words. In a link,
  // the shared menu offers Edit link and Remove link under the address. The address is checked by the reader's own rule
  // (dlSafeAddress, through the editor's linkProblem); one it refuses is asked for again, with what was typed kept.
  // A question takes the keyboard out of the editor, so the selection is kept first and put back after the answer or a
  // Cancel, and when the menu closes, however it closes (a pick, Escape, a press outside): the menu's onClose.
  let linking = false;
  function linkWith(e) {
    if (!ed || ed.lost || !rich || linking || !ed.editor.linkFits) return;
    const mine = ed;
    const editor = ed.editor;
    if (!editor.linkFits()) { editor.focus(); return; }
    const kept = editor.selection();
    const live = () => ed === mine && !mine.lost && mine.editor === editor;
    const back = () => { if (live()) editor.restore(kept); };
    const ask = async (o) => {
      linking = true;
      let answer = null;
      try { answer = await host.ui.prompt({ label: 'Address', placeholder: `${DL_LINK_START}...`, maxLength: DL_LINK.max, validate: (a) => editor.linkProblem(a, kept), ...o }); } catch (err) { note(cleanMsg(err)); }
      linking = false;
      back();
      if (answer !== null && live()) editor.setLink(answer);
    };
    const link = editor.linkAt();
    if (!link) { ask({ title: 'Add a link', action: 'Add link' }); return; }
    // Under the button that was pressed; for the key, under the caret.
    const box = host.rootElement.getBoundingClientRect();
    const caret = e && Number.isFinite(e.x) ? null : editor.caretBox();
    const at = caret ? { x: caret.left - box.left, y: caret.bottom - box.top + 4 } : { x: e && Number.isFinite(e.x) ? e.x : 100000, y: 4 };
    host.menu.show({
      id: 'link', className: 'dl-link-menu', at,
      onClose: () => { if (!linking) back(); }, // Edit link has its question open by now: the answer puts the selection back
      items: [
        { heading: dlLinkShown(link.href) },
        { id: 'edit', label: 'Edit link', icon: 'pen', onClick: () => { ask({ title: 'Edit link', action: 'Save link', value: link.href }); } },
        { id: 'remove', label: 'Remove link', icon: 'link-slash', onClick: () => { back(); if (live()) editor.removeLink(); } },
      ],
    });
  }
  // ---- the shared chrome: the toolbar row, the title bar's "+" and menu, the status bar --------------------------------------
  // `key`: what follows Ctrl or Cmd in the button's name in the rich editor, where there is a keyboard.
  const FORMATS = [
    { id: 'bold', title: 'Bold', icon: 'bold', key: 'B' },
    { id: 'italic', title: 'Italic', icon: 'italic', key: 'I' },
    { id: 'code', title: 'Code', icon: 'code', key: 'E' },
    { id: 'heading', title: 'Heading', icon: 'heading' },
    { id: 'list', title: 'Bulleted list', icon: 'list-ul' },
    { id: 'numbered', title: 'Numbered list', icon: 'list-ol' },
    { id: 'checklist', title: 'Checklist', icon: 'list-check', key: 'Enter ticks a row' },
    { id: 'quote', title: 'Quote', icon: 'quote-left' },
    { id: 'link', title: 'Link', icon: 'link', key: 'K' },
  ];
  // ---- the view: Fit width or a zoom level, a person's own choice, kept in this browser --------------------------------------
  // The sheet is scaled with CSS zoom (its width and its text together); the caret, the text box and selections follow it.
  const VIEW_KEY = 'documents-view';
  let view = 'fit';
  try { view = dlViewRead(window.localStorage.getItem(VIEW_KEY)); } catch { /* no browser storage: Fit width */ }
  // The list's look: rows or thumbnails, the shared view switch in the list's toolbar, remembered per person in this browser.
  const LISTVIEW_KEY = 'documents-listview';
  let listView = 'list';
  try { listView = dlCleanListView(window.localStorage.getItem(LISTVIEW_KEY)); } catch { /* the list */ }
  let listSwitch = null;
  function setListView(v) {
    listView = dlCleanListView(v);
    try { window.localStorage.setItem(LISTVIEW_KEY, listView); } catch { /* kept for this visit only */ }
    render();
  }
  const MOD = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '') ? 'Cmd' : 'Ctrl';
  const KEYS = Boolean(window.matchMedia && window.matchMedia('(any-pointer: fine)').matches);
  const keyHint = (keys) => (KEYS ? `${MOD} ${keys}` : undefined);
  const withKey = (label, keys) => (KEYS ? `${label} (${MOD} ${keys})` : label);
  function paintView() {
    const s = dlViewSheet(view);
    const app = $('app');
    app.style.setProperty('--doc-zoom', String(s.zoom));
    app.style.setProperty('--doc-width', s.widthRem === null ? '100%' : `${s.widthRem}rem`);
    app.style.setProperty('--doc-max', `${s.maxRem}rem`);
    fitPaper();
  }
  function setView(v) {
    view = dlCleanView(v);
    try { window.localStorage.setItem(VIEW_KEY, dlViewStore(view)); } catch { /* kept for this visit only */ }
    paintView();
    renderStatus();
  }
  // A Paper sheet at Fit width follows the window's width.
  if (typeof ResizeObserver === 'function') { const watch = new ResizeObserver(() => fitPaper()); watch.observe($('read')); watch.observe($('editor')); let richW = 0; const grown = new ResizeObserver(() => { sizeEditSoon(); const w = $('edit-rich').offsetWidth; if (w !== richW) { richW = w; if (ed && ed.editor && ed.editor.measurePages) ed.editor.measurePages(); } }); grown.observe($('edit-rich')); }
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(() => sizeEditSoon()).catch(() => {});
  const viewShown = () => Boolean(ed ? !ed.lost : openId);
  function zoomMenu(e) {
    if (!viewShown()) return;
    const level = (n) => ({ id: `z${n}`, label: `${n}%`, icon: 'magnifying-glass', current: view === n, onClick: () => setView(n) });
    host.menu.show({
      id: 'zoom',
      at: { x: e && Number.isFinite(e.x) ? e.x : 100000, y: 4 },
      items: [
        { id: 'in', label: 'Zoom in', icon: 'magnifying-glass-plus', hint: keyHint('+'), onClick: () => setView(dlViewStep(view, 1)) },
        { id: 'out', label: 'Zoom out', icon: 'magnifying-glass-minus', hint: keyHint('-'), onClick: () => setView(dlViewStep(view, -1)) },
        { id: 'fit', label: 'Fit width', icon: 'expand', current: view === 'fit', onClick: () => setView('fit') },
        { id: 'actual', label: 'Actual size', icon: 'magnifying-glass', hint: keyHint('0'), current: view === DL_VIEW.actual, onClick: () => setView(DL_VIEW.actual) },
        { heading: 'Zoom' },
        ...DL_VIEW.levels.filter((n) => n !== DL_VIEW.actual).map(level),
      ],
    });
  }
  // Ctrl or Cmd with + - 0, only when the key press came from inside this window (modules run in a shadow root, so by its path).
  doc.addEventListener('keydown', (e) => {
    const what = dlViewKey(e);
    if (!what || !viewShown() || !e.composedPath().includes(host.rootElement)) return;
    e.preventDefault();
    setView(what === 'actual' ? DL_VIEW.actual : dlViewStep(view, what === 'in' ? 1 : -1));
  }, true);

  // Ctrl or Cmd with K while the rich editor is open, pressed anywhere in this window (the link menu has the keyboard while it
  // is open): never the browser's own. The editor has taken it already when the keyboard was in it (Mod-k); this runs after.
  doc.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || String(e.key).toLowerCase() !== 'k') return;
    if (ed && !ed.lost && rich && e.composedPath().includes(host.rootElement)) e.preventDefault();
  });

  let fmtButtons = [];
  let fmtFor = null; // which editor the format buttons were last drawn for (true: the rich one)
  let fmtOn = []; // which format buttons are drawn `on`, in FORMATS order
  let activeFrame = 0;
  // Which formats the rich selection is in (null in the text box, which has no such thing).
  const activeNow = () => (ed && !ed.lost && rich && ed.editor.active ? ed.editor.active() : null);
  // The buttons of the formats the selection is in are drawn `on`. Asked for on every move of the caret; done once a frame,
  // from the selection alone (the words are never read), and only a button whose state changed is drawn again.
  function paintActive() {
    if (activeFrame) return;
    activeFrame = window.requestAnimationFrame(() => {
      activeFrame = 0;
      if (!fmtButtons.length) return;
      const active = activeNow();
      FORMATS.forEach((f, i) => {
        const on = dlRichIsOn(active, f.id);
        if (on !== Boolean(fmtOn[i])) { fmtOn[i] = on; fmtButtons[i].set({ on }); }
      });
    });
  }
  let richSwitch = null;
  let insertButton = null;
  let layoutSwitch = null;
  let paperButton = null;
  let tagButton = null;
  let backButton = null;
  function formatWith(f, e) {
    if (!ed || ed.lost) return;
    if (f.id === 'heading') {
      const active = activeNow();
      const level = active ? active.heading : 0; // the level the caret is in shows as the current one
      host.menu.show({ id: 'heading', at: { x: e && Number.isFinite(e.x) ? e.x : 100000, y: 4 }, items: [1, 2, 3, 4].map((lv) => ({ id: `h${lv}`, label: `Heading ${lv}`, ...(level === lv ? { current: true } : {}), onClick: () => applyFormat(`h${lv}`) })), onClose: () => { if (ed && !ed.lost) ed.editor.focus(); } }); // Escape or a press outside: the keyboard goes back to the editor
    } else if (f.id === 'link' && rich) linkWith(e);
    else applyFormat(f.id);
  }
  // The Insert button's menu: Grid and Formula (Markdown only for now), and a page break at the caret.
  // Rich text: the Grid group comes first in Insert while the caret is in a grid (the editor says which entries fit), and is not there otherwise.
  function gridItems() {
    if (!rich || !ed.editor.gridMenu) return null;
    const model = ed.editor.gridMenu();
    return model ? model.map((m) => ({ id: m.id, label: m.label, ...(m.disabled ? { disabled: true } : {}), ...(m.current ? { current: true } : {}), onClick: () => applyFormat(m.id) })) : null;
  }
  function insertMenu(e) {
    if (!ed || ed.lost) return;
    const entry = (id, label, icon) => ({ id, label, icon, ...(rich && !dlRichCan(id) ? { disabled: true } : {}), onClick: () => applyFormat(id) });
    host.menu.show({
      id: 'insert', at: { x: e && Number.isFinite(e.x) ? e.x : 100000, y: 4 },
      items: dlRichInsertItems([entry('grid', 'Grid', 'table-cells'), entry('formula', 'Formula', 'square-root-variable'), { id: 'break', label: 'Page break', icon: 'scissors', onClick: () => applyFormat('pagebreak') }], gridItems()),
      onClose: () => { if (ed && !ed.lost) ed.editor.focus(); }, // Escape or a press outside: the keyboard goes back to the editor
    });
  }
  // Zoom is the window's, in the title bar, as in the Whiteboard: Zoom out and Zoom in as icons, and a menu with the rest.
  const zoomItems = () => [
    { type: 'button', id: 'zoom-out', title: withKey('Zoom out', '-'), icon: 'magnifying-glass-minus', placement: 'titlebar' },
    { type: 'button', id: 'zoom-in', title: withKey('Zoom in', '+'), icon: 'magnifying-glass-plus', placement: 'titlebar' },
    { type: 'button', id: 'zoom', title: 'Zoom', icon: 'up-right-and-down-left-from-center', placement: 'titlebar' },
  ];
  function renderChrome() {
    let items;
    if (ed) {
      items = ed.lost ? [] : [
        { type: 'button', id: 'done', label: 'Done', icon: 'check', primary: true, zone: 'end', ...(ed.finishing ? { disabled: true } : {}) },
        ...zoomItems(),
      ];
    } else if (openId) {
      items = [...zoomItems()];
      if (canEdit) items.push(
        { type: 'button', id: 'edit', label: 'Edit', icon: 'pen', primary: true, zone: 'end', ...(editOff ? { disabled: true } : {}) },
        { type: 'button', id: 'rename', label: 'Rename', icon: 'pen-to-square', placement: 'menu' },
        { type: 'button', id: 'remove', label: 'Delete', icon: 'trash', placement: 'menu' },
      );
    } else {
      items = [{ type: 'search', id: 'search', value: query, placeholder: 'Search documents', label: 'Search documents' }];
      if (tagsOn && !showTrash) {
        const counts = dlTagCounts([...docs.keys()].map((id) => tagsOf.get(id) || []), knownTags);
        for (const t of filterTags) if (knownTags.has(t) && !counts.has(t)) counts.set(t, 0);
        const options = host.tags.filterOptions(counts).map((o) => ({ ...o, on: filterTags.includes(o.id) }));
        if (options.length) items.push({ type: 'chips', id: 'tag-filter', label: 'Tags', options });
      }
      if (canEdit) items.push({ type: 'button', id: 'trash', title: showTrash ? 'Back to the documents' : `Trash${trash.size ? ` (${trash.size})` : ''}`, icon: showTrash ? 'file-lines' : 'trash', on: showTrash });
    }
    // The formatting buttons are the shared icon-only toolbar buttons (host.ui.toolbarButton), made while a person is editing.
    const wantFmt = Boolean(ed && !ed.lost);
    if (wantFmt && !fmtButtons.length) fmtButtons = FORMATS.map((f) => host.ui.toolbarButton({ id: `fmt-${f.id}`, label: f.title, icon: f.icon, iconOnly: true, onClick: (e) => formatWith(f, e) }));
    else if (!wantFmt && fmtButtons.length) { for (const b of fmtButtons) b.destroy(); fmtButtons = []; }
    if (wantFmt && !insertButton) insertButton = host.ui.toolbarButton({ id: 'insert', label: 'Insert', icon: 'circle-plus', iconOnly: true, onClick: (e) => insertMenu(e) });
    else if (!wantFmt && insertButton) { insertButton.destroy(); insertButton = null; }
    // In the rich editor an entry with no action there yet (Grid, Formula) is off; Heading's levels are all there.
    // There Bold, Italic, Code and Link name their keys, and Checklist the key that ticks a row.
    if (!fmtButtons.length) { fmtFor = null; fmtOn = []; }
    else if (fmtFor !== rich) {
      fmtFor = rich;
      fmtButtons.forEach((b, i) => {
        const f = FORMATS[i];
        b.set({ disabled: rich && f.id !== 'heading' && !dlRichCan(f.id), label: rich && f.key ? withKey(f.title, f.key) : f.title });
      });
      paintActive();
    }
    // The choice between the Markdown text box and the rich editor: the shared view switch (as the list's List and Thumbnails),
    // in the bar's end zone before Page colour, there while a person is editing.
    if (wantFmt && !richSwitch) richSwitch = host.ui.viewSwitch({ id: 'editview', label: 'Editor', options: DL_EDITVIEWS.map((o) => ({ ...o })), value: dlEditViewId(rich), zone: 'end', onChange: (v) => setRich(dlEditViewIsRich(v)) });
    else if (!wantFmt && richSwitch) { richSwitch.destroy(); richSwitch = null; }
    else if (richSwitch) richSwitch.set(dlEditViewId(rich));
    // The layout (Fluid or Paper) is the document's own, set while editing: the same shared switch, beside the editor's.
    if (wantFmt && !layoutSwitch) layoutSwitch = host.ui.viewSwitch({ id: 'layout', label: 'Layout', options: DL_LAYOUTS.map((o) => ({ ...o })), value: ed.page.layout, zone: 'end', onChange: chooseLayout });
    else if (!wantFmt && layoutSwitch) { layoutSwitch.destroy(); layoutSwitch = null; }
    else if (layoutSwitch) layoutSwitch.set(ed.page.layout);
    // The Page button's menu holds the colour, the size and the numbers.
    if (wantFmt && !paperButton) paperButton = host.ui.toolbarButton({ id: 'paper', label: 'Page', icon: 'ruler-combined', iconOnly: true, zone: 'end', onClick: (e) => pageMenu(e) });
    else if (!wantFmt && paperButton) { paperButton.destroy(); paperButton = null; }
    // The Tags button (the shared icon-only toolbar button) is there for an editor with a document open, reading or editing.
    // Back is the first button (the shared buttons draw in the order they were made), so Tags is made after it.
    const wantBack = Boolean(openId && !ed);
    const wantTags = Boolean(tagsOn && canEdit && (openId || (ed && !ed.lost)));
    if (wantBack && !backButton) {
      if (tagButton) { tagButton.destroy(); tagButton = null; }
      backButton = host.ui.toolbarButton({ id: 'back', label: 'Back to the documents', icon: 'arrow-left', iconOnly: true, onClick: () => { if (!ed) closeDoc(); } });
    } else if (!wantBack && backButton) { backButton.destroy(); backButton = null; }
    if (wantTags && !tagButton) tagButton = host.ui.toolbarButton({ id: 'tags', label: 'Tags', icon: 'tags', iconOnly: true, onClick: (e) => tagsMenu(e) });
    else if (!wantTags && tagButton) { tagButton.destroy(); tagButton = null; closeTagPicker(); }
    // The list's look switch is there only while the list is.
    const wantSwitch = !ed && !openId;
    if (wantSwitch && !listSwitch) listSwitch = host.ui.viewSwitch({ id: 'listview', label: 'View', options: DL_LISTVIEWS.map((o) => ({ ...o })), value: listView, onChange: setListView });
    else if (!wantSwitch && listSwitch) { listSwitch.destroy(); listSwitch = null; }
    else if (listSwitch) listSwitch.set(listView);
    host.toolbar.set(items).catch(() => {});
    if (host.add) host.add.set(!ed && !openId && canEdit && !showTrash ? [{ id: 'new', label: 'New document', icon: 'plus' }] : []).catch(() => {});
    renderStatus();
  }
  function renderStatus() {
    if (!host.status) return;
    const text = ed ? (ed.lost ? 'Stopped' : dlSaveWord({ dirty: dirtyNow(), saving: ed.saving, failed: ed.failed })) : openId ? why.slice(0, 60) : '';
    const items = text ? [{ text }] : [];
    if (viewShown()) items.push({ text: dlViewLabel(view), quiet: true, end: true, title: 'Zoom' }); // as the Whiteboard's zoom
    host.status.set(items).catch(() => {});
  }
  host.on('toolbar', (e) => {
    const id = String(e.id || '');
    if (id === 'search') { query = String(e.value || ''); render(); return; }
    if (id === 'tag-filter' && typeof e.value === 'string') { filterTags = e.on ? [...new Set([...filterTags, e.value])] : filterTags.filter((t) => t !== e.value); render(); return; }
    if (id === 'trash') { showTrash = !showTrash; render(); return; }
    if (id === 'back') { if (!ed) closeDoc(); return; }
    if (id === 'edit') { startEdit(); return; }
    if (id === 'rename') { if (openId && !ed && canEdit) startRename(); return; }
    if (id === 'remove') { if (openId && !ed && canEdit) startRemove(); return; }
    if (id === 'done') { finish(); return; }
    if (id === 'zoom-in') { setView(dlViewStep(view, 1)); return; }
    if (id === 'zoom-out') { setView(dlViewStep(view, -1)); return; }
    if (id === 'zoom') { zoomMenu(e); return; }
  });
  host.on('add', (e) => { if (e.id === 'new' && !ed && !openId) { $('make').hidden = false; $('make-title').value = ''; $('make-title').focus(); } });
  $('edit-title').addEventListener('input', typed);

  $('lost-copy').addEventListener('click', async () => {
    const text = ed.editor.getText();
    try { await navigator.clipboard.writeText(text); note('Copied.'); } catch (err) {
      ed.editor.selectAll();
      note(doc.execCommand && doc.execCommand('copy') ? 'Copied.' : 'Select the text and copy it.');
    }
  });
  $('lost-new').addEventListener('click', async () => {
    try {
      const id = await create(dlCleanLine(`${$('edit-title').value} (copy)`, DL.titleMax), ed.editor.getText());
      stopEditing();
      render();
      $('read').hidden = false; $('list').hidden = true;
      openDoc(id);
      note('Saved as a new document.');
    } catch (err) { note(cleanMsg(err)); }
  });
  $('lost-close').addEventListener('click', async () => {
    if (!(await host.ui.confirm({ title: 'Close without saving?', message: 'The text on the screen will be gone.', action: 'Close', kind: 'destructive' }))) return;
    stopEditing();
    closeDoc();
  });

  // A hidden page saves; a page that shows again refreshes the lock first, then saves.
  doc.addEventListener('visibilitychange', () => {
    if (!ed || ed.lost) return;
    if (doc.visibilityState === 'hidden') schedule(true);
    else serial(refreshLock).then(() => schedule(true)).catch(() => {});
  });
  window.addEventListener('pagehide', () => { if (ed && !ed.lost) { clearTimeout(ed.timer); saveNow().catch(() => {}); } });

  await loadTags();
  try { await load(); } catch (err) { showMsg('Documents could not load', err.message, () => location.reload()); return; }
  paintView();
  render();
  $('loading').hidden = true;
  $('app').hidden = false;
})();
