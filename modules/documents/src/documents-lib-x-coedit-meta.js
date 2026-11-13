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
});

// The meta of a record: -> { title, paper, layout, pageSize, pageNumbers }, cleaned.
function dlMetaOf(rec) {
  const page = dlCleanPage(rec);
  return { title: rec && typeof rec.title === 'string' ? rec.title : '', paper: dlCleanPaper(rec && rec.paper), layout: page.layout, pageSize: page.pageSize, pageNumbers: page.pageNumbers };
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
  return 'a key the map does not have';
}
// Is the map (a Y.Map) only what it may be? -> '' or the first problem. The map holds at most five keys; a type inside it, or an entry outside it, is refused.
function dlMetaProblem(map) {
  if (map._start !== null && map._start !== undefined) return 'something outside the keys';
  let n = 0;
  for (const key of map.keys()) {
    n += 1;
    if (n > DL_META.keys.length) return 'too many keys';
    if (!DL_META.keys.includes(key)) return 'a key the map does not have';
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
    missing,
  };
}
// Sets keys of the map in ONE transaction (origin 'dl-meta'); a key already holding the value is left alone. `fields`: { key: value }. -> how many keys changed.
function dlMetaSet(ydoc, fields, origin) {
  const map = ydoc.getMap(DL_META.root);
  const todo = Object.keys(fields).filter((k) => DL_META.keys.includes(k) && dlMetaValueProblem(k, fields[k]) === '' && map.get(k) !== fields[k]);
  if (!todo.length) return 0;
  ydoc.transact(() => { for (const k of todo) map.set(k, fields[k]); }, origin || 'dl-meta');
  return todo.length;
}
// The record's values for the keys the document lacks (a document seeded without them, or opened from an older copy).
function dlMetaFill(ydoc, rec) {
  const miss = dlMetaRead(ydoc, rec).missing;
  if (!miss.length) return 0;
  const all = dlMetaOf(rec);
  const fields = {};
  for (const k of miss) fields[k] = all[k];
  return dlMetaSet(ydoc, fields, 'dl-meta');
}
// Do the document's keys all hold what the record holds? (A copy of the state is only trusted as the document when they do: documents-lib-w-coedit-snapshot.js.)
function dlMetaSame(ydoc, rec) {
  const m = dlMetaRead(ydoc, null);
  if (m.missing.length) return false;
  const all = dlMetaOf(rec);
  return m.title === all.title && m.paper === all.paper && m.page.layout === all.layout && m.page.pageSize === all.pageSize && m.page.pageNumbers === all.pageNumbers;
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
