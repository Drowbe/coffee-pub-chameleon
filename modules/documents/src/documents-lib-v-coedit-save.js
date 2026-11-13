// ---- documents-lib-v-coedit-save.js: saving the text of a shared document (no page, no host; the store and the clock are handed in) -------------
//
// Co-editing step 4b, slice 1 (plan-documents-coediting.md). Used only with the module's `coediting` switch on; with it off nothing here is called.
//
// WHO SAVES. The writer (dlSyncElect, documents-lib-u-coedit-sync.js) saves the merged text a quiet beat after the last change (dlCoSaveDelay: 3 s after
// the last change, at most once in 5 s), and every page that leaves saves once on the way out. Each save is dlCoeditSave. The text is the editor's own
// writer on the converged Y state (the page hands it in as io.current()), stored the same way as ever: the small record `doc:<id>` and the chunks
// `text:<id>:<chunk>`, the changed chunks first and the record last, under the version read. The record is the commit.
//
// MERGE BEFORE WRITE. Before a save writes, it reads the stored record. If its version is not the one this page last read or wrote, someone saved since:
// the stored text is read, and the editor's spelling lookup is refreshed from it (io.onStored). Equal to this page's text: nothing to write, the version is
// adopted. Different: this page's state is the merged one (it holds everything this page has seen), so it is written under the new version. A 409 on the
// record means a third page committed first: read again and go round (DL_COSAVE.tries times); a page that is still losing reports 'busy' and the page
// asks again a moment later. Two pages that hold the same state make the same text, so one of them finds the stored text equal and writes nothing.
// The title, the paper and the page layout come from the shared document's meta map (documents-lib-x-coedit-meta.js; the page hands them in as io.current()).
// A page writes a field only if it differs from what this page last read or wrote; otherwise the stored one stays (a save never puts an old title back).
// A save that finds nothing to write ('same') still takes the fields it just compared as read, so a page that heard a rename is not dirty for ever.
//
// textREV. The record carries `textRev`: a counter that every co-editing save bumps (the old saves leave it as it is). It lives in the record, not in a key of
// its own, because the record is the commit: the counter and the text change together or not at all, it costs no extra write (a module may write 240
// times a minute), and every page already hears the record change. A page that hears a textRev above the one it wrote or adopted knows another page saved.
// The snapshot of a later slice names the textRev it was made from.
//
// A FAILED SAVE LOSES NOTHING. The unsaved state stays in the page's document. 413 (storage is full), 429 (too many writes) and any other failure come
// back as 'full', 'limit' and 'failed' with the time to wait; the page says so plainly and asks again, longer each time (dlCoBackoff).

const DL_COSAVE = Object.freeze({
  quietMs: 3000, // a save waits for this long without a change
  gapMs: 5000, // and for this long after the last save
  maxWaitMs: 15000, // but never longer than this after the first change that is not saved yet
  tries: 4, // rounds of read, compare and write in one save while the record keeps changing under it
  backoffMs: 2000, // the wait after the first failure; it doubles to backoffMax
  backoffMax: 30000,
  busyMs: 600, // after a save that kept losing the race: ask again after this plus the page's own jitter
});

// What a store's error means. -> 'conflict' | 'full' | 'limit' | 'forbidden' | 'gone' | 'failed'. The status may be missing when the error came as a sentence.
function dlCoErr(err) {
  const status = Number(err && err.status) || 0;
  const text = String((err && err.message) || '');
  if (status === 409) return 'conflict';
  if (status === 413 || /storage is full/i.test(text)) return 'full';
  if (status === 429 || /too many|wait a moment|try again in a moment/i.test(text)) return 'limit';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'gone';
  return 'failed';
}

// Milliseconds until the writer's next save may run (null: nothing to save). `force` (the page is hidden) skips the wait for a change, never the gap.
// `hold`: not before this time (a failed save is asked again later).
// `since`: when the first change not yet saved was made. A writer that never gets a quiet beat (people typing without a pause) saves anyway after maxWaitMs.
function dlCoSaveDelay({ now, lastKey, lastSave, dirty, force, hold, since }) {
  if (!dirty) return null;
  const end = Number.isFinite(lastKey) ? lastKey + DL_COSAVE.quietMs : -Infinity;
  const cap = since ? since + DL_COSAVE.maxWaitMs : Infinity;
  const key = force || !Number.isFinite(lastKey) ? 0 : Math.max(0, Math.min(end, cap) - now);
  const gap = Number.isFinite(lastSave) ? Math.max(0, lastSave + DL_COSAVE.gapMs - now) : 0;
  const wait = Number.isFinite(hold) ? Math.max(0, hold - now) : 0;
  return Math.max(key, gap, wait);
}
// The wait before asking again after the n-th failure in a row (n from 1); `retryAfter` (seconds, from a 429) is a floor.
function dlCoBackoff(n, retryAfter) {
  const own = Math.min(DL_COSAVE.backoffMax, DL_COSAVE.backoffMs * 2 ** Math.max(0, Math.min(10, n - 1)));
  const asked = Number(retryAfter) > 0 ? Math.min(60, Number(retryAfter)) * 1000 : 0;
  return Math.max(own, asked);
}

// The stored record and its text, as one reading: { rec, version, text, parts } | { gone: true } | { busy: true } (a listed chunk was missing three times:
// a save is in step). `store` is host.storage (get, list).
async function dlCoReadStored(store, id) {
  for (let tries = 0; tries < 3; tries += 1) {
    const cur = await store.get(dlDocKey(id));
    const rec = cur && dlCleanDoc(cur.value);
    if (!rec || rec.id !== id) return { gone: true };
    const byId = new Map();
    for (const it of await store.list(`text:${id}:`)) { const c = dlCleanChunk(it.value); if (c && c.doc === id) byId.set(c.id, c.text); }
    if (rec.chunks.every((c) => byId.has(c))) return { rec, version: cur.version, text: dlJoin(rec.chunks.map((c) => byId.get(c))), parts: rec.chunks.map((c) => ({ id: c, text: byId.get(c) })) };
  }
  return { busy: true };
}

// One save. `st` is the page's state for the open document and is changed here:
//   id, rec (the cleaned record last read or written), docVersion (its version), old ([{ id, text }] the chunks it lists), saved ({ text, title, paper, page }:
//   what this page last read or wrote, and what its own fields were then), log (times of this page's writes), stray (ids of chunks written for a commit that failed)
// `io`: current() -> { text, title, paper, page, rev } (the merged state now; called again after a read), onStored(text) (the stored text this page just read),
//   me, name, now() (an ISO time), nowMs(), fresh() (a new chunk id), lex, sleep(ms) (waits for the write rate).
// -> { status, rev, conflicts, wrote, adopted, error, retryAfter }; status is 'saved' (written), 'same' (nothing to write: stored text is this text), 'title'
//   or 'long' (the text cannot be saved as it is), 'busy' (kept losing the race), 'full', 'limit', 'failed' (asked again later), 'gone' (the document is deleted).
async function dlCoeditSave(store, st, io) {
  const out = { status: 'failed', rev: NaN, conflicts: 0, wrote: 0, adopted: false, error: null, retryAfter: 0 };
  const fail = (err) => {
    const kind = dlCoErr(err);
    out.status = kind === 'full' ? 'full' : kind === 'limit' ? 'limit' : kind === 'gone' ? 'gone' : 'failed';
    out.error = err; out.retryAfter = Number(err && err.retryAfter) || 0;
    return out;
  };
  // Chunks written for a commit that did not happen, and chunks the new record no longer lists, are deleted (best effort; a leftover is harmless).
  const sweep = (drop) => {
    const listed = new Set(st.old.map((c) => c.id));
    const gone = [...(drop || []), ...st.stray].filter((x) => !listed.has(x));
    st.stray = [];
    for (const cid of new Set(gone)) { try { Promise.resolve(store.delete(dlTextKey(st.id, cid))).catch(() => {}); } catch (err) { /* left for a later clean-up */ } }
  };
  // A field this page changed since it last read the record wins; any other stays as stored.
  const fieldsOf = (cur) => ({
    title: cur.title !== st.saved.title ? cur.title : st.rec.title,
    paper: cur.paper !== st.saved.paper ? cur.paper : st.rec.paper,
    page: dlSamePage(cur.page, st.saved.page) ? dlCleanPage(st.rec) : cur.page,
  });
  const adopt = (cur) => { // the page's own fields count as read from here on, whether they were written or found equal to the stored ones
    st.saved = {
      text: cur.text,
      title: cur.title !== st.saved.title ? cur.title : st.saved.title,
      paper: cur.paper !== st.saved.paper ? cur.paper : st.saved.paper,
      page: dlSamePage(cur.page, st.saved.page) ? st.saved.page : cur.page,
    };
  };
  const key = dlDocKey(st.id);
  for (let round = 0; round < DL_COSAVE.tries; round += 1) {
    let cur = io.current();
    let got; let read = null;
    try { got = await store.get(key); } catch (err) { return fail(err); }
    const rec = got && dlCleanDoc(got.value);
    if (!rec) { out.status = 'gone'; return out; }
    if (got.version !== st.docVersion) { // somebody saved since this page last read or wrote
      try { read = await dlCoReadStored(store, st.id); } catch (err) { return fail(err); }
      if (read.gone) { out.status = 'gone'; return out; }
      if (read.busy) { out.status = 'failed'; return out; }
      if (read.text !== st.saved.text && io.onStored) io.onStored(read.text);
      st.rec = read.rec; st.docVersion = read.version; st.old = read.parts; st.textHeard = read.rec.textRev || 0;
      cur = io.current(); // the state may have moved while the stored text was read
      const mine = fieldsOf(cur);
      st.saved = { ...st.saved, text: read.text };
      if (cur.text === read.text && mine.title === read.rec.title && mine.paper === read.rec.paper && dlSamePage(mine.page, read.rec)) {
        adopt(cur); sweep(); out.status = 'same'; out.rev = cur.rev; out.adopted = true; return out; // the stored text is this text: nothing to write
      }
    }
    const mine = fieldsOf(cur);
    if (cur.text === st.saved.text && mine.title === st.rec.title && mine.paper === st.rec.paper && dlSamePage(mine.page, st.rec)) { adopt(cur); sweep(); out.status = 'same'; out.rev = cur.rev; return out; }
    const plan = dlPlanSave({ old: st.old, text: cur.text, title: mine.title, paper: mine.paper, page: mine.page, rec: st.rec, me: io.me, name: io.name, now: io.now(), fresh: io.fresh, lex: io.lex });
    if (!plan.ok) { out.status = plan.reason; return out; }
    plan.record.textRev = Math.min(1e9, (Number(st.rec.textRev) || 0) + 1);
    const wait = dlWriteWait(st.log, io.nowMs(), plan.writes.length + 1);
    if (wait) await io.sleep(wait);
    const wrote = [];
    try {
      for (const c of plan.writes) { await store.set(dlTextKey(st.id, c.id), { id: c.id, doc: st.id, text: c.text }); wrote.push(c.id); st.log.push(io.nowMs()); out.wrote += 1; }
      const r = await store.set(key, plan.record, { version: st.docVersion });
      st.log.push(io.nowMs()); out.wrote += 1;
      st.docVersion = r && r.version;
    } catch (err) {
      st.stray.push(...wrote);
      if (dlCoErr(err) === 'conflict') { out.conflicts += 1; continue; } // a third page committed first: read again and go round
      return fail(err);
    }
    const own = { title: cur.title !== st.saved.title, paper: cur.paper !== st.saved.paper, page: !dlSamePage(cur.page, st.saved.page) };
    st.saved = { text: cur.text, title: own.title ? cur.title : st.saved.title, paper: own.paper ? cur.paper : st.saved.paper, page: own.page ? cur.page : st.saved.page };
    st.rec = plan.record; st.old = plan.chunks.map((c) => ({ id: c.id, text: c.text })); st.textHeard = plan.record.textRev;
    sweep(plan.dropped);
    out.status = 'saved'; out.rev = cur.rev;
    return out;
  }
  sweep();
  out.status = 'busy';
  return out;
}

// ---- the saver: when a page saves, and what it does with the answer ---------------------------------------------------------------------------
// One per open shared document. The page hands in what it owns; the saver owns the timing (quiet beat, gap, longest wait, the wait after a failure) and
// the counters. `o`:
//   store, st                the store (host.storage) and the page's save state (see dlCoeditSave)
//   io                       what dlCoeditSave needs from the page (current, onStored, me, name, now, nowMs, fresh, lex, sleep)
//   isWriter()               is this page the writer now (session.isWriter)
//   dirty()                  has the text changed since this page last saved or adopted (the editor's change counter; never reads the text)
//   alone()                  is no other editor holding this page's text
//   clock                    { now(), set(fn, ms), clear(id) }
//   serial(fn)               runs fn after the saves and swaps that are already under way (the page's queue)
//   drain(ms)                waits for this page's own changes to go out (session.drain)
//   onSaved(rev), onChange(), note(text), refused(why)   the page: the counter that was saved, something to redraw, a short line for the person, and the
//                            reason a text cannot be saved as it is ('title', 'long') or can no longer be saved ('gone'): the page words it
// -> { changed, plan, save, leave, stop, state, counts, hold }
function dlCoSaver(o) {
  const clock = o.clock || { now: () => Date.now(), set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) };
  const state = { saving: false, failed: false, refused: '' };
  const counts = { saves: 0, same: 0, adopted: 0, conflicts: 0, busy: 0, failed: 0, leaves: 0, storeFull: 0, rateLimited: 0, rounds: 0 };
  let timer = null; let since = 0; let lastKey = NaN; let lastSave = -Infinity; let hold = 0; let failures = 0; let stopped = false;
  const jitter = (String(o.io.me).length * 97) % 700;
  const change = () => { if (o.onChange) o.onChange(); };

  function save(leave) {
    return o.serial(async () => {
      if (stopped) return 'lost';
      if (!leave && !o.dirty()) return 'saved';
      state.saving = true; state.failed = false; lastSave = clock.now(); since = 0; change();
      let r;
      try { r = await dlCoeditSave(o.store, o.st, o.io); } catch (err) { r = { status: 'failed', error: err, retryAfter: 0, conflicts: 0 }; }
      if (stopped) return 'lost';
      state.saving = false; counts.rounds += 1; counts.conflicts += r.conflicts || 0;
      if (r.status === 'saved' || r.status === 'same') {
        failures = 0; hold = 0;
        if (r.status === 'saved') counts.saves += 1; else counts.same += 1;
        if (r.adopted) counts.adopted += 1;
        o.onSaved(r.rev, r);
        change();
        return 'saved';
      }
      if (r.status === 'title' || r.status === 'long') {
        state.refused = r.status;
        o.refused(r.status);
        change();
        return r.status;
      }
      if (r.status === 'gone') {
        state.refused = 'gone';
        o.refused('gone');
        change();
        return 'gone';
      }
      if (r.status === 'busy') { // another page kept winning: a moment later, a little different for each person
        counts.busy += 1; hold = clock.now() + DL_COSAVE.busyMs + jitter;
        change();
        return 'busy';
      }
      // 413, 429 or anything else: everything stays in the document, the page says so, and asks again later (longer each time)
      failures += 1;
      if (r.status === 'full') counts.storeFull += 1; else if (r.status === 'limit') counts.rateLimited += 1; else counts.failed += 1;
      hold = clock.now() + dlCoBackoff(failures, r.retryAfter);
      state.failed = true; change();
      return r.status;
    });
  }
  // The next save: only the writer's (a page that is hidden or leaving asks with `force`).
  function plan(force) {
    if (stopped) return;
    if (timer !== null) { clock.clear(timer); timer = null; }
    if (state.refused) return;
    if (!force && !o.isWriter()) return;
    const d = dlCoSaveDelay({ now: clock.now(), lastKey, lastSave, dirty: o.dirty(), force: Boolean(force), hold, since });
    if (d === null) return;
    timer = clock.set(() => { timer = null; save(false).then(() => plan(false)).catch(() => {}); }, d);
  }
  return {
    state, counts,
    hold: () => Math.max(0, hold - clock.now()),
    // The text changed, by this person or by another: the quiet beat starts again.
    changed() { lastKey = clock.now(); state.refused = ''; if (!since) since = lastKey; plan(false); },
    plan, save,
    // The page is leaving (Back, or the module closing with the page alive): the last typing goes out first, so the writer does not save a text without it
    // over this one; then one save, asked again twice if it could not be done. -> 'go' (leave now) or 'stay' (the text could not be saved and nobody else
    // holds it: it stays on the screen, and the page says so).
    async leave() {
      if (timer !== null) { clock.clear(timer); timer = null; }
      try { await o.drain(1500); } catch (err) { /* the save below still runs */ }
      counts.leaves += 1;
      let r = 'saved';
      for (let tries = 0; tries < 3; tries += 1) {
        try { r = await save(true); } catch (err) { r = 'failed'; }
        if (r === 'saved' || r === 'lost' || r === 'gone' || r === 'title' || r === 'long') break; // a refusal is not asked again (its note is on the screen)
        await o.io.sleep(tries === 0 ? 800 : 1500);
        if (stopped) break;
      }
      if (r !== 'saved' && r !== 'lost' && r !== 'gone' && o.alone()) { if (r !== 'title' && r !== 'long') o.note('Could not save. Your changes are kept here.'); return 'stay'; }
      return 'go';
    },
    stop() { stopped = true; if (timer !== null) { clock.clear(timer); timer = null; } },
  };
}
