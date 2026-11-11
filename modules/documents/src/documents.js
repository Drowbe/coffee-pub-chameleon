// Documents module: the list, reading and editing (build steps 3 and 4). Each space has its own documents. A document is a small
// record (doc:<id>) and its text in chunks (text:<id>:<chunk>); the rules are in the documents-lib-*.js files, which have no page.
// One person edits at a time: Edit takes the lock (_lock:<id>, compare-and-set), the editor refreshes it every 10 s and saves
// 3 s after the last key; the save writes the changed chunks, then the small record under the version read (the commit).
// Removing a document puts it in the trash (_trash:<id>), where an editor can bring it back or delete it for good.
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
    else if (key.startsWith('_lock:')) locks.delete(idOf(key, '_lock:'));
  }
  async function load() {
    docs.clear(); unreadable.clear(); trash.clear();
    for (const item of await host.storage.list('doc:')) remember(item);
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
    const rec = { id, type: 'doc', title: t, rev: 1, chunks: plan.map((c) => c.id), size: text.length, excerpt: dlExcerpt(text), paper: DL_PAPER_DEFAULT, by: me, at: now, editedBy: me, editedByName: myName, editedAt: now };
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
  function render() {
    if (showTrash) $('make').hidden = true;
    renderChrome();
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

  // ---- the page colour -----------------------------------------------------------------------------------------------------
  // The sheet gets the chosen colour (data-paper names it; documents.css holds the value) and the ink that reads best on it
  // (data-ink, picked by contrast from the two inks in documents.css), so every colour is readable.
  function paintPaper(sheet, id) {
    const p = DL_PAPER_BY_ID.get(dlCleanPaper(id));
    const css = getComputedStyle($('app'));
    const rgb = (name) => dlHexRgb(css.getPropertyValue(name));
    sheet.dataset.paper = p.id;
    sheet.dataset.ink = dlInkFor(rgb(p.css), rgb('--doc-fixed-ink-light'), rgb('--doc-fixed-ink-dark')) || 'dark';
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

  // ---- reading -------------------------------------------------------------------------------------------------------------
  async function draw(id) {
    const got = await readText(id);
    if (openId !== id) return;
    if (!got) { $('page').replaceChildren(el('p', null, 'This document could not be loaded. Try again.')); return; }
    const page = $('page');
    const top = $('read').scrollTop;
    shownRev = got.rec.rev;
    paintPaper($('read').querySelector('.sheet'), got.rec.paper);
    $('read-title').textContent = got.rec.title;
    $('read-meta').textContent = `Edited by ${got.rec.editedByName}, ${when(got.rec.editedAt)}`;
    page.replaceChildren(dlBuild(dlDescribe(got.text, lex), doc));
    $('read').scrollTop = top;
  }
  function openDoc(id) {
    if (!docs.has(id)) return;
    openId = id; shownRev = 0;
    $('list').hidden = true; $('read').hidden = false;
    $('renamer').hidden = true;
    updateEditButton();
    $('page').replaceChildren();
    $('read-title').textContent = docs.get(id).title;
    paintPaper($('read').querySelector('.sheet'), docs.get(id).paper);
    draw(id).catch(() => { $('page').replaceChildren(el('p', null, 'This document could not be loaded. Try again.')); });
    renderChrome();
    $('page').focus();
  }
  function closeDoc() { openId = null; $('read').hidden = true; $('list').hidden = false; render(); }

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
    if (!/^(doc|_trash|_lock):/.test(key)) return false;
    if (e.deleted) forget(key); else if (e.value !== undefined) remember({ key, value: e.value, version: e.version, heard: true }); else return 'reload';
    return true;
  }
  function afterChange() {
    if (ed) { hearLock(); return; }
    if (openId) {
      updateEditButton();
      const rec = docs.get(openId);
      if (!rec) { note('This document was deleted.'); closeDoc(); return; }
      if (rec.rev > shownRev) draw(openId).catch(() => {});
    } else render();
  }
  host.on('change', (e) => { const r = applyChange(e); if (r === 'reload') reload(); else if (r) afterChange(); });
  host.on('changes', (e) => {
    const list = Array.isArray(e.changes) ? e.changes : [];
    if (!list.some((c) => /^(doc|_trash|_lock):/.test(String(c.key)))) return;
    if (list.some((c) => !c.deleted && c.value === undefined)) { reload(); return; }
    for (const c of list) applyChange(c);
    afterChange();
  });
  function reload() { load().then(afterChange).catch(() => {}); }

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

  async function openEditor(id, lock) {
    const { rec, version, got } = await readForEdit(id);
    ed = {
      id, rec, docVersion: version, old: got.parts, lock, text: got.text, paper: rec.paper, saved: { text: got.text, title: rec.title, paper: rec.paper },
      lastKey: NaN, lastSave: -Infinity, saving: false, failed: false, refused: '', lost: false, log: [], stray: [],
      timer: 0, beat: 0, queue: Promise.resolve(),
    };
    for (const cid of dlLeftoverChunks(rec.chunks, got.stored)) host.storage.delete(dlTextKey(id, cid)).catch(() => {});
    $('read').hidden = true; $('list').hidden = true; $('editor').hidden = false;
    $('edit-title').value = rec.title;
    paintPaper($('editor').querySelector('.sheet'), ed.paper);
    const ta = $('edit-text');
    ta.value = got.text; ta.readOnly = false;
    $('edit-title').readOnly = false;
    $('lost').hidden = true;
    renderChrome();
    const beat = setInterval(() => {
      if (!$('app')) return void clearInterval(beat);
      serial(refreshLock).catch(() => {});
    }, DL_LOCK.beat);
    ed.beat = beat;
    ta.focus();
  }

  const serial = (fn) => {
    const s = ed;
    const run = s.queue.then(() => (s === ed ? fn() : undefined));
    s.queue = run.catch(() => {});
    return run;
  };
  const current = () => ({ text: $('edit-text').value, title: $('edit-title').value, paper: ed ? ed.paper : undefined });
  const dirtyNow = () => ed && dlIsDirty(ed.saved, current());
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
    $('edit-text').readOnly = true; $('edit-title').readOnly = true;
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
      const cur = current();
      if (!dlIsDirty(ed.saved, cur)) return 'saved';
      const plan = dlPlanSave({ old: ed.old, text: cur.text, title: cur.title, paper: cur.paper, rec: ed.rec, me, name: myName, now: new Date().toISOString(), fresh: () => dlNewId(Math.random) });
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
      ed.saved = { text: cur.text, title: cur.title, paper: cur.paper };
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
    clearTimeout(ed.timer); clearInterval(ed.beat);
    ed = null;
    $('editor').hidden = true;
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
    $('page').replaceChildren();
    $('read-title').textContent = docs.get(mine.id) ? docs.get(mine.id).title : '';
    updateEditButton();
    draw(mine.id).catch(() => {});
    renderChrome();
    $('page').focus();
  }

  // The bar: each button changes the text with the library's function, keeping the browser's undo where it can.
  function applyFormat(fn) {
    if (!ed || ed.lost) return;
    const ta = $('edit-text');
    const out = fn({ value: ta.value, start: ta.selectionStart, end: ta.selectionEnd });
    ta.focus();
    if (out.value !== ta.value) {
      ta.setSelectionRange(0, ta.value.length);
      if (!doc.execCommand || !doc.execCommand('insertText', false, out.value)) { ta.value = out.value; typed(); }
      if (ta.value !== out.value) { ta.value = out.value; typed(); }
    }
    ta.setSelectionRange(out.start, out.end);
  }
  // ---- the shared chrome: the toolbar row, the title bar's "+" and menu, the status bar --------------------------------------
  const FORMATS = [
    { id: 'bold', title: 'Bold', icon: 'bold', fn: dlBold },
    { id: 'italic', title: 'Italic', icon: 'italic', fn: dlItalic },
    { id: 'code', title: 'Code', icon: 'code', fn: dlCode },
    { id: 'heading', title: 'Heading', icon: 'heading' },
    { id: 'list', title: 'Bulleted list', icon: 'list-ul', fn: dlList },
    { id: 'numbered', title: 'Numbered list', icon: 'list-ol', fn: dlNumbered },
    { id: 'checklist', title: 'Checklist', icon: 'list-check', fn: dlChecklist },
    { id: 'quote', title: 'Quote', icon: 'quote-left', fn: dlQuote },
    { id: 'link', title: 'Link', icon: 'link', fn: (s) => dlLink(s) },
    { id: 'grid', title: 'Grid', icon: 'table-cells', fn: (s) => dlGrid(s) },
    { id: 'formula', title: 'Formula', icon: 'square-root-variable', fn: (s) => dlFormula(s) },
  ];
  // ---- the view: Fit width or a zoom level, a person's own choice, kept in this browser --------------------------------------
  // The sheet is scaled with CSS zoom (its width and its text together); the caret, the text box and selections follow it.
  const VIEW_KEY = 'documents-view';
  let view = 'fit';
  try { view = dlViewRead(window.localStorage.getItem(VIEW_KEY)); } catch { /* no browser storage: Fit width */ }
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
  }
  function setView(v) {
    view = dlCleanView(v);
    try { window.localStorage.setItem(VIEW_KEY, dlViewStore(view)); } catch { /* kept for this visit only */ }
    paintView();
    renderStatus();
  }
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

  let fmtButtons = [];
  let paperButton = null;
  function formatWith(f, e) {
    if (!ed || ed.lost) return;
    if (f.id === 'heading') {
      host.menu.show({ id: 'heading', at: { x: e && Number.isFinite(e.x) ? e.x : 100000, y: 4 }, items: [1, 2, 3, 4].map((lv) => ({ id: `h${lv}`, label: `Heading ${lv}`, onClick: () => applyFormat((s) => dlHeading(s, lv)) })) });
    } else applyFormat(f.fn);
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
      items = [{ type: 'button', id: 'back', title: 'Back to the documents', icon: 'arrow-left' }, ...zoomItems()];
      if (canEdit) items.push(
        { type: 'button', id: 'edit', label: 'Edit', icon: 'pen', primary: true, zone: 'end', ...(editOff ? { disabled: true } : {}) },
        { type: 'button', id: 'rename', label: 'Rename', icon: 'pen-to-square', placement: 'menu' },
        { type: 'button', id: 'remove', label: 'Delete', icon: 'trash', placement: 'menu' },
      );
    } else {
      items = [{ type: 'search', id: 'search', value: query, placeholder: 'Search documents', label: 'Search documents' }];
      if (canEdit) items.push({ type: 'button', id: 'trash', title: showTrash ? 'Back to the documents' : `Trash${trash.size ? ` (${trash.size})` : ''}`, icon: showTrash ? 'file-lines' : 'trash', on: showTrash });
    }
    // The formatting buttons are the shared icon-only toolbar buttons (host.ui.toolbarButton), made while a person is editing.
    const wantFmt = Boolean(ed && !ed.lost);
    if (wantFmt && !fmtButtons.length) fmtButtons = FORMATS.map((f) => host.ui.toolbarButton({ id: `fmt-${f.id}`, label: f.title, icon: f.icon, iconOnly: true, onClick: (e) => formatWith(f, e) }));
    else if (!wantFmt && fmtButtons.length) { for (const b of fmtButtons) b.destroy(); fmtButtons = []; }
    if (wantFmt && !paperButton) paperButton = host.ui.toolbarButton({ id: 'paper', label: 'Page colour', icon: 'palette', iconOnly: true, zone: 'end', onClick: (e) => paperMenu(e) });
    else if (!wantFmt && paperButton) { paperButton.destroy(); paperButton = null; }
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
  $('edit-text').addEventListener('input', typed);
  $('edit-title').addEventListener('input', typed);

  $('lost-copy').addEventListener('click', async () => {
    const text = $('edit-text').value;
    try { await navigator.clipboard.writeText(text); note('Copied.'); } catch (err) {
      const ta = $('edit-text'); ta.focus(); ta.select();
      note(doc.execCommand && doc.execCommand('copy') ? 'Copied.' : 'Select the text and copy it.');
    }
  });
  $('lost-new').addEventListener('click', async () => {
    try {
      const id = await create(dlCleanLine(`${$('edit-title').value} (copy)`, DL.titleMax), $('edit-text').value);
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

  try { await load(); } catch (err) { showMsg('Documents could not load', err.message, () => location.reload()); return; }
  paintView();
  render();
  $('loading').hidden = true;
  $('app').hidden = false;
})();
