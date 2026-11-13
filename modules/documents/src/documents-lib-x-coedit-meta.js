// ---- documents-lib-x-coedit-meta.js: the settings that travel with a shared document, and one person's single edit window (no page, no host) ----------
//
// Co-editing step 4b, slice 3 (plan-documents-coediting.md). Used only with the module's `coediting` switch on; with it off nothing here is called.
//
// THE META MAP. The title, the page colour and the page layout of a shared document sit in a small Y.Map on the shared document (the root type `meta`), beside the
// text. A person's control (the title field, the colour, the page menu) sets a key; every page observes the map and draws what it says; the writer's save reads
// the map and writes the record from it (never from what the page last drew). The keys: title (a string, at most DL.titleMax characters, no control
// characters), paper (one of the fixed colours), layout ('fluid' or 'paper'), pageSize ('letter' or 'a4'), pageNumbers (true or false). Nothing else is a key.
// The gate checks the map in every update (documents-lib-t-coedit-gate.js calls dlMetaProblem): a wrong key, type, length or value is refused as `attrs`.
// A key is settled by Yjs the way any map key is: the last change wins, the same on every page.
//
// THE EDIT WINDOW. The server does not send a person's live messages to the person's other sessions, so two windows of one person cannot hear each other.
// A module runs in a frame without its own origin (BroadcastChannel, localStorage and Web Locks are not available there), so the lock is a storage key that
// reaches every window and every browser of the person: `ydoc:<id>:w:<person>` = { t: <this window's token>, at: <time> }. The window that holds it
// edits (it joins the channel, it can be the writer); a second window of the same person opens the document to read only and says so. The holder renews the
// key every renewMs. A window that finds a key it does not own looks again after watchMs: a key that was renewed has a live holder; one that was not is taken
// over with a compare-and-set. The time inside the key is read only to skip that wait for a key that is very old (staleMs); no decision of
// who edits rests on two clocks agreeing. A window that is closed on purpose deletes the key.

const DL_META = Object.freeze({
  root: 'meta',
  keys: Object.freeze(['title', 'paper', 'layout', 'pageSize', 'pageNumbers']),
  // THE LOCK (step 4c): a sixth key that may be there or not. { by: <person key>, name: <display name>, at: <time, ms> }. A locked document is read-only for
  // everyone. The gate checks the shape only: it cannot know a role, so the lock is a courtesy guard that an honest page keeps and a hostile editor can bypass.
  optional: Object.freeze(['lock']),
});
const DL_LOCK_NAME_MAX = 60;

// The lock as stored (in the map and in the record): { by, name, at } or null. Exactly these three keys, a plain object, nothing inherited.
function dlCoLockClean(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) return null;
  const keys = Object.keys(v);
  if (keys.length !== 3 || !keys.includes('by') || !keys.includes('name') || !keys.includes('at')) return null;
  if (typeof v.by !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(v.by)) return null;
  if (typeof v.name !== 'string' || v.name.length > DL_LOCK_NAME_MAX || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(v.name)) return null;
  if (typeof v.at !== 'number' || !Number.isFinite(v.at)) return null;
  return { by: v.by, name: v.name, at: v.at };
}
const dlCoLockSame = (a, b) => (!a && !b) || Boolean(a && b && a.by === b.by && a.at === b.at && a.name === b.name);
// May this person lock or unlock? `me`: their key; `role`: the host's word for their role ('owner' and 'admin' always may unlock); `canType`: they are an editor
// of this document. -> { lock, unlock, reason } (reason: why unlock is not offered, in plain words; `ownerWord` is the environment's word for an owner, with "an").
function dlCoLockRules({ me, role, canType, lock, ownerWord }) {
  if (!canType) return { lock: false, unlock: false, reason: '' };
  if (!lock) return { lock: true, unlock: false, reason: '' };
  const may = role === 'owner' || role === 'admin' || lock.by === me;
  return { lock: false, unlock: may, reason: may ? '' : `Only ${lock.name} or ${ownerWord || 'someone in charge'} can unlock.` };
}

// The meta of a record: -> { title, paper, layout, pageSize, pageNumbers }, cleaned.
function dlMetaOf(rec) {
  const page = dlCleanPage(rec);
  return { title: rec && typeof rec.title === 'string' ? rec.title : '', paper: dlCleanPaper(rec && rec.paper), layout: page.layout, pageSize: page.pageSize, pageNumbers: page.pageNumbers, lock: (rec && dlCoLockClean(rec.lock)) || null };
}
// Why this value may not be a key of the map ('' when it may).
function dlMetaValueProblem(key, v) {
  if (key === 'title') {
    if (typeof v !== 'string') return 'title is not text';
    if (v.length > DL.titleMax) return 'title is too long';
    if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(v)) return 'title has control characters';
    return '';
  }
  if (key === 'paper') return typeof v === 'string' && DL_PAPER_BY_ID.has(v) ? '' : 'paper is not one of the colours';
  if (key === 'layout') return v === 'fluid' || v === 'paper' ? '' : 'layout is not fluid or paper';
  if (key === 'pageSize') return v === 'letter' || v === 'a4' ? '' : 'pageSize is not letter or a4';
  if (key === 'pageNumbers') return typeof v === 'boolean' ? '' : 'pageNumbers is not true or false';
  if (key === 'lock') return dlCoLockClean(v) ? '' : 'lock is not who and when';
  return 'a key the map does not have';
}
// Is the map (a Y.Map) only what it may be? -> '' or the first problem. The map holds at most six keys (the lock is the optional one); a type inside it, or an entry outside it, is refused.
function dlMetaProblem(map) {
  if (map._start !== null && map._start !== undefined) return 'something outside the keys';
  let n = 0;
  for (const key of map.keys()) {
    n += 1;
    if (n > DL_META.keys.length + DL_META.optional.length) return 'too many keys';
    if (!DL_META.keys.includes(key) && !DL_META.optional.includes(key)) return 'a key the map does not have';
    const why = dlMetaValueProblem(key, map.get(key));
    if (why) return why;
  }
  return '';
}
// What the shared document says. `fallback`: { title, paper, page } for a key that is missing. -> { title, paper, page: {layout,pageSize,pageNumbers}, missing: [keys] }.
function dlMetaRead(ydoc, fallback) {
  const map = ydoc.getMap(DL_META.root);
  const fb = fallback || {};
  const fp = dlCleanPage(fb.page || fb);
  const missing = DL_META.keys.filter((k) => dlMetaValueProblem(k, map.get(k)) !== '');
  const pick = (k, alt) => (missing.includes(k) ? alt : map.get(k));
  return {
    title: pick('title', typeof fb.title === 'string' ? fb.title : ''),
    paper: pick('paper', dlCleanPaper(fb.paper)),
    page: { layout: pick('layout', fp.layout), pageSize: pick('pageSize', fp.pageSize), pageNumbers: pick('pageNumbers', fp.pageNumbers) },
    lock: dlCoLockClean(map.get('lock')),
    missing,
  };
}
// Sets keys of the map in ONE transaction (origin 'dl-meta'); a key already holding the value is left alone. `fields`: { key: value }; `lock: null` removes the lock.
// -> how many keys changed.
function dlMetaSet(ydoc, fields, origin) {
  const map = ydoc.getMap(DL_META.root);
  const todo = Object.keys(fields).filter((k) => {
    if (k === 'lock') return fields.lock === null ? map.has('lock') : dlMetaValueProblem('lock', fields.lock) === '' && !dlCoLockSame(dlCoLockClean(map.get('lock')), fields.lock);
    return DL_META.keys.includes(k) && dlMetaValueProblem(k, fields[k]) === '' && map.get(k) !== fields[k];
  });
  if (!todo.length) return 0;
  ydoc.transact(() => { for (const k of todo) { if (k === 'lock' && fields.lock === null) map.delete('lock'); else map.set(k, k === 'lock' ? { by: fields.lock.by, name: fields.lock.name, at: fields.lock.at } : fields[k]); } }, origin || 'dl-meta');
  return todo.length;
}
// The record's values for the keys the document lacks (a document seeded without them, or opened from an older copy).
function dlMetaFill(ydoc, rec) {
  const miss = dlMetaRead(ydoc, rec).missing;
  if (!miss.length) return 0;
  const all = dlMetaOf(rec);
  const fields = {};
  for (const k of miss) fields[k] = all[k];
  if (all.lock && !ydoc.getMap(DL_META.root).has('lock')) fields.lock = all.lock; // a document made from the record takes the record's lock; one that has the keys already is not given it back
  return dlMetaSet(ydoc, fields, 'dl-meta');
}
// Do the document's keys all hold what the record holds? (A copy of the state is only trusted as the document when they do: documents-lib-w-coedit-snapshot.js.)
function dlMetaSame(ydoc, rec) {
  const m = dlMetaRead(ydoc, null);
  if (m.missing.length) return false;
  const all = dlMetaOf(rec);
  return m.title === all.title && m.paper === all.paper && m.page.layout === all.layout && m.page.pageSize === all.pageSize && m.page.pageNumbers === all.pageNumbers && dlCoLockSame(m.lock, all.lock);
}

// A document renamed from the list while it is open here: the title the writer puts into the shared settings, or '' for none. `recTitle`: the record's title now;
// `savedTitle`: what this page last read or wrote; `metaTitle`: the shared title; `applied`: the record title this page already applied. Only the writer acts;
// a title the page already saved, already shows or already applied is not a rename (so a page's own save never starts it again).
function dlCoRenamePlan({ recTitle, savedTitle, metaTitle, applied, writer, editor }) {
  if (!writer || !editor || typeof recTitle !== 'string' || !recTitle) return '';
  if (recTitle === savedTitle || recTitle === metaTitle || recTitle === applied) return '';
  return dlMetaValueProblem('title', recTitle) === '' ? recTitle : '';
}

// ---- the editors list (presence, step 4c) -----------------------------------------------------------------------------------------------------
// A person's colour: the host's rule (public/sdk/host.js personTint: 32-bit FNV-1a of the key, modulo 8 into this list), so a person has the same colour here as
// in every module. The page uses host.live.tint when the host offers it; this is the same rule for the tests and for a host that does not.
const DL_TINTS = Object.freeze(['blue', 'green', 'teal', 'purple', 'orange', 'pink', 'gold', 'red']);
function dlCoTintOf(key) {
  const s = String(key == null ? '' : key);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return DL_TINTS[h % DL_TINTS.length];
}
// Up to two capital letters: the first letters of the first two words of the name; with no name, the first two characters of the key.
function dlCoInitials(name, key) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const from = words.length ? words.slice(0, 2).map((w) => Array.from(w)[0]).join('') : Array.from(String(key || '?')).slice(0, 2).join('');
  return from.toLocaleUpperCase('en');
}
// Who is editing this document now, in the order they are shown: this person first (when they are an editor), then the others by key (the same on every page).
// `others`: the roster's keys (editors only, never a reader); `names`: { key: name } from the host's list of people (a key with no name shows its initials);
// `lockBy`: the key of the person who locked it or '' (`lockNote`: the words for the tooltip); `tint(key)`: the colour name. -> [{ key, name, initials, tint, me, locker, label }], at most `max`.
function dlCoEditorsList({ me, myName, meEditor, others, names, lockBy, lockNote, tint, max }) {
  const pick = tint || dlCoTintOf;
  const limit = Number.isInteger(max) && max > 0 ? max : 8;
  const keys = [...new Set((others || []).filter((k) => typeof k === 'string' && k && k !== me))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const all = (meEditor ? [me] : []).concat(keys);
  const nameOf = (k) => (k === me ? myName : names && Object.prototype.hasOwnProperty.call(names, k) ? names[k] : '') || '';
  return all.slice(0, limit).map((key) => {
    const name = String(nameOf(key)).slice(0, 60);
    const locker = Boolean(lockBy) && key === lockBy;
    const shown = name || 'Someone';
    return { key, name: shown, initials: dlCoInitials(name, key), tint: pick(key), me: key === me, locker, label: `${shown}${key === me ? ' (you)' : ''}${locker && lockNote ? `, ${lockNote}` : ''}` };
  });
}

// ---- the edit window -----------------------------------------------------------------------------------------------------------------------
const DL_LEASE = Object.freeze({
  renewMs: 5000, // the holder renews this often
  watchMs: 7500, // a window that finds a key it does not own looks again after this long
  staleMs: 60000, // a key whose time is older than this (by this window's clock) is dead at once, with no wait
  failMs: 20000, // a holder whose renewals have failed this long stops editing (another window may have taken the key)
});
const dlLeaseKey = (doc, me) => `ydoc:${doc}:w:${me}`;
// The key's value, or null. Anything else is no lease.
function dlCleanLease(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const keys = Object.keys(v);
  if (keys.length !== 2 || !keys.includes('t') || !keys.includes('at')) return null;
  if (typeof v.t !== 'string' || !/^[a-z0-9]{8,16}$/.test(v.t)) return null;
  if (typeof v.at !== 'string' || v.at.length > 40 || !Number.isFinite(Date.parse(v.at))) return null;
  return { t: v.t, at: v.at };
}
// Takes the key for this window, or finds that another window of the person holds it. store: host.storage; o: { doc, me, tab, now() (ms), sleep(ms) }.
// -> { won: true, version } | { won: false } (another window edits) | { error }.
async function dlLeaseAcquire(store, o) {
  const key = dlLeaseKey(o.doc, o.me);
  const mine = () => ({ t: o.tab, at: new Date(o.now()).toISOString() });
  const conflict = (err) => Boolean(err) && err.status === 409;
  try {
    for (let round = 0; round < 4; round += 1) {
      try { const r = await store.set(key, mine(), { version: 0 }); return { won: true, version: r && r.version }; } catch (err) { if (!conflict(err)) throw err; }
      const cur = await store.get(key);
      if (!cur) continue; // gone in between: ask again
      const v = dlCleanLease(cur.value);
      let dead = !v;
      if (v && v.t === o.tab) dead = true; // this window's own key (a renewal that was lost on its way back)
      else if (v && o.now() - Date.parse(v.at) >= DL_LEASE.staleMs) dead = true;
      if (!dead) {
        await o.sleep(DL_LEASE.watchMs);
        const again = await store.get(key);
        if (again && again.version !== cur.version) return { won: false }; // renewed (or changed): its holder is there
        if (!again) continue;
        cur.version = again.version;
      }
      try { const r = await store.set(key, mine(), { version: cur.version }); return { won: true, version: r && r.version }; } catch (err) { if (!conflict(err)) throw err; return { won: false }; }
    }
    return { won: false };
  } catch (err) { return { error: err }; }
}
// The holder's side: renews every renewMs, deletes the key on release. o: { doc, me, tab, version, now(), set(fn, ms) -> id, clear(id), onLost() }.
// onLost fires once: another window took the key (a renewal found someone else's token), or the renewals failed for failMs.
function dlLeaseHold(store, o) {
  const key = dlLeaseKey(o.doc, o.me);
  let version = o.version; let timer = null; let done = false; let lost = false; let failedSince = 0; let busy = false;
  const mine = () => ({ t: o.tab, at: new Date(o.now()).toISOString() });
  const lose = () => { if (lost || done) return; lost = true; if (timer !== null) { o.clear(timer); timer = null; } if (o.onLost) o.onLost(); };
  async function renew() {
    timer = null;
    if (done || lost || busy) return;
    busy = true;
    try {
      try { const r = await store.set(key, mine(), { version }); version = r && r.version; failedSince = 0; } catch (err) {
        if (err && err.status === 409) {
          const cur = await store.get(key);
          const v = cur && dlCleanLease(cur.value);
          if (cur && v && v.t === o.tab) { version = cur.version; failedSince = 0; } else if (!cur) {
            try { const r = await store.set(key, mine(), { version: 0 }); version = r && r.version; failedSince = 0; } catch (e2) { lose(); return; } // the key was deleted: take it again, or lose it
          } else { lose(); return; }
        } else { if (!failedSince) failedSince = o.now(); if (o.now() - failedSince >= DL_LEASE.failMs) { lose(); return; } }
      }
    } catch (err) { if (!failedSince) failedSince = o.now(); if (o.now() - failedSince >= DL_LEASE.failMs) { lose(); return; } } finally { busy = false; }
    if (!done && !lost) timer = o.set(renew, DL_LEASE.renewMs);
  }
  timer = o.set(renew, DL_LEASE.renewMs);
  return {
    held: () => !done && !lost,
    lost: () => lost,
    // Deletes the key if this window still holds it (a window closed on purpose).
    release() {
      if (done) return Promise.resolve();
      done = true;
      if (timer !== null) { o.clear(timer); timer = null; }
      if (lost) return Promise.resolve();
      return Promise.resolve(store.delete(key, { version })).catch(() => {});
    },
  };
}
