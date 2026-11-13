// ---- documents-lib-w-coedit-snapshot.js: the shared document kept in storage, so a late joiner opens fast (no page, no host; the store and the clock are handed in) ----
//
// Co-editing step 4b, slice 2 (plan-documents-coediting.md). Used only with the module's `coediting` switch on; with it off nothing here is called.
//
// WHAT IS STORED. The writer (the elected page, see documents-lib-u-coedit-sync.js) keeps a copy of the Yjs state in the module's storage:
//   ydoc:<id>:<n>   n = 0..k-1   one chunk: { n, d: <base64 of up to 36,000 bytes>, h: <short hash of d> }. About 48 KB of base64 in each: under the 60 KB a value may be.
//   ydoc:<id>                    the HEADER: { v: 1, rev, n, bytes, hashes: [k hashes], seed, epoch, at }. Written LAST, under the version read.
//   ydoc:<id>:seed               the seed marker (documents-lib-u-coedit-sync.js): { id, by, at, epoch? }. `seed` and `epoch` in the header are the marker's id
//                                and epoch: together the LINEAGE. A copy of the state is only ever merged with states of its own lineage.
// `rev` is the textRev of the saved text the copy was made from (documents-lib-v-coedit-save.js): the writer makes a copy only when the text it saved is the
// text of the state, so on load "rev is the stored textRev and the state writes the stored text" proves the copy is the document.
// A name never collides: a chunk's n is a number, the marker's is 'seed', the header has no suffix.
//
// WRITE (dlSnapSaver, the writer's page only). At most one copy per 45 s (10 s after a large change, such as a big paste), only when the state changed AND
// the text was saved again since, only after a quiet beat (2 s), only when the text is saved (not dirty), only while the page's write budget has room
// (the module may write 240 times a minute, per person; the page counts every write it makes). Before writing: the grids are repaired, the state is verified
// against the saved text and, if it does not read back, mended (gate: repairGrids, mendForSnapshot); a state that still fails is not written. Only the chunks
// whose hash changed since THIS page wrote or loaded them are written; the header goes last and is a compare-and-set, so two writers do not interleave; chunks
// beyond the new count are deleted after it. A chunk is written in place: a crash after some chunks and before the header leaves a copy whose hashes no longer
// match, and a reader REJECTS it (it never applies half) and opens from the text. 413 ("storage is full"), 429 and any failure keep the header as it was, say
// so once in plain words, and ask again later; they never touch the saving of the text.
//
// LOAD (dlSnapJoin; a page that joins before it would seed). Nothing read from storage is trusted: any editor may write any key. The header is shape-checked
// (v, ints, n <= 40, bytes <= 1.5 MB, hashes the length of n, only these keys), rev <= stored textRev + 1, the lineage equals the marker's, every chunk is
// present, shaped, hashed and the sizes add up to `bytes`; the joined bytes go through the GATE (rebuildFromGood, 1 MB, the writer's lexer) and are VERIFIED:
// rev equal to the stored textRev: the state must write EXACTLY the stored text; rev different (older or one ahead): the state is only a starting point (it
// must pass the gate and read back as itself), the peers' difference and the writer's next save/copy converge. Any failure drops the whole copy, names the
// reason, and the page opens from the stored text. A page that applied a copy does not seed.
//
// COMPACTION BY RE-SEED (dlSnapCompaction). The state grows with every writer id and with the edit history. When a page opens, finds no peer, and the copy is
// too big (bytes > 3 x the text and > 8,000, or > 400 KB) or its state vector is over 1,000 bytes (about 160 writers), it does not load it: it seeds from the
// stored text with epoch + 1 and a fresh seed id (dlSnapReseed: a compare-and-set of the marker; the page that wins seeds, one that loses waits for it), and
// its writer then writes a copy with the new epoch (all chunks) and deletes the old ones. Pages in the room are untouched: they compact only when all left.
// The same re-seed follows a copy that was rejected (a fresh lineage: no struct of the old state can clash).

const DL_SNAP = Object.freeze({
  chunkBytes: 36000, // binary bytes in a chunk (48,000 base64 characters, about 48.1 KB with the JSON: under the 60 KB value)
  maxChunks: 40,
  maxBytes: 1500000, // the header's bytes
  chunkChars: 48000,
  gapMs: 45000, // between two copies
  fastGapMs: 10000, // after a large change
  quietMs: 2000, // nothing changed for this long
  largeBytes: 1400, // an update over this is a large change (the live limit)
  budget: 180, // writes in the last minute, this page, with the copy's own, at most (the server allows 240)
  holdBudgetMs: 15000,
  holdFullMs: 300000,
  holdLimitMs: 60000,
  holdFailMs: 30000,
  holdConflictMs: 10000,
  compactRatio: 3, // bytes over this many times the stored text ...
  compactFloor: 8000, // ... and over this many bytes
  compactBytes: 400000,
  compactVector: 1000, // a state vector over this many bytes
  loadMs: 8000, // a load that has not answered after this long is let go (the page opens from the text)
});

const dlSnapHeaderKey = (id) => `ydoc:${id}`;
const dlSnapChunkKey = (id, n) => `ydoc:${id}:${n}`;
const DL_SNAP_HEADER_KEYS = ['v', 'rev', 'n', 'bytes', 'hashes', 'seed', 'epoch', 'at'];
const DL_SNAP_HASH = /^[0-9a-z]{2,14}$/;
const DL_SNAP_B64 = /^[A-Za-z0-9+/]*={0,2}$/;

// Two 32-bit hashes of the characters, in base 36. Not a secret (any editor can write the chunk and the header); it only finds a chunk that is not the one the
// header names.
function dlSnapHash(s) {
  let a = 0x811c9dc5; let b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b + c + 0x9e3779b9, 0x85ebca6b) >>> 0;
    b ^= b >>> 13;
  }
  return a.toString(36) + (b >>> 0).toString(36);
}

// The bytes as chunks [{ n, d, h }].
function dlSnapSplit(bytes) {
  const out = [];
  for (let at = 0, n = 0; at < bytes.length || n === 0; at += DL_SNAP.chunkBytes, n += 1) {
    const d = dlSyncB64(bytes.subarray(at, at + DL_SNAP.chunkBytes));
    out.push({ n, d, h: dlSnapHash(d) });
  }
  return out;
}

const dlSnapInt = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

// The header as stored -> { v, rev, n, bytes, hashes, seed, epoch, at }, or { bad: <reason> }. Hostile input is bounded before anything is looped over.
function dlSnapCleanHeader(v) {
  const bad = (why) => ({ bad: why });
  if (!v || typeof v !== 'object' || Array.isArray(v)) return bad('header_shape');
  const keys = Object.keys(v);
  if (keys.length !== DL_SNAP_HEADER_KEYS.length || !keys.every((k) => DL_SNAP_HEADER_KEYS.includes(k))) return bad('header_shape');
  if (v.v !== 1) return bad('header_version');
  const rev = dlSnapInt(v.rev, 0, 1e9); const n = dlSnapInt(v.n, 1, DL_SNAP.maxChunks); const bytes = dlSnapInt(v.bytes, 1, DL_SNAP.maxBytes);
  const seed = dlSnapInt(v.seed, 1, 0xffffffff); const epoch = dlSnapInt(v.epoch, 0, 1e6);
  if (rev === null || n === null || bytes === null || seed === null || epoch === null) return bad('header_numbers');
  if (!Array.isArray(v.hashes) || v.hashes.length !== n) return bad('header_hashes');
  for (const h of v.hashes) if (typeof h !== 'string' || !DL_SNAP_HASH.test(h)) return bad('header_hashes');
  if (typeof v.at !== 'string' || v.at.length > 40 || !Number.isFinite(Date.parse(v.at))) return bad('header_time');
  if (Math.ceil(bytes / DL_SNAP.chunkBytes) > n) return bad('header_sizes'); // n chunks cannot hold fewer bytes than the header says
  return { v: 1, rev, n, bytes, hashes: v.hashes.slice(), seed, epoch, at: v.at };
}
// One chunk as stored, for the header's n and hash -> the bytes, or { bad }.
function dlSnapCleanChunk(v, n, hash) {
  const bad = (why) => ({ bad: why });
  if (!v || typeof v !== 'object' || Array.isArray(v)) return bad('chunk_shape');
  const keys = Object.keys(v);
  if (keys.length !== 3 || !['n', 'd', 'h'].every((k) => keys.includes(k))) return bad('chunk_shape');
  if (v.n !== n || typeof v.d !== 'string' || v.d.length > DL_SNAP.chunkChars + 4 || typeof v.h !== 'string') return bad('chunk_shape');
  if (v.h !== hash || dlSnapHash(v.d) !== hash) return bad('chunk_hash');
  const bytes = dlSyncUnb64(v.d, DL_SNAP.chunkBytes);
  return bytes ? bytes : bad('chunk_base64');
}

// Should a page that is alone skip this copy and re-seed? Pure. `header`: a cleaned header; `textLen`: the stored text's length; `vectorBytes`: the length of the
// state vector the copy gives (when known). -> { compact, why }.
function dlSnapCompaction(o) {
  const h = o.header;
  if (h.bytes > DL_SNAP.compactBytes) return { compact: true, why: 'bytes' };
  if (h.bytes > DL_SNAP.compactFloor && h.bytes > DL_SNAP.compactRatio * Math.max(1, o.textLen)) return { compact: true, why: 'history' };
  if (Number.isFinite(o.vectorBytes) && o.vectorBytes > DL_SNAP.compactVector) return { compact: true, why: 'writers' };
  return { compact: false, why: '' };
}

// The marker with the next epoch, by compare-and-set. -> { won: true, id, epoch } | { won: false, marker } | { error }.
async function dlSnapReseed(store, o) {
  const key = dlSeedMarkerKey(o.doc);
  try {
    for (let round = 0; round < 3; round += 1) {
      const cur = await store.get(key);
      const m = cur && dlCleanSeedMarker(cur.value);
      const epoch = Math.min(1e6, ((m && m.epoch) || 0) + 1);
      const id = dlSyncSeedId(`${o.doc}#${epoch}`, o.text);
      const next = { id, by: o.me, at: new Date(o.now()).toISOString(), epoch };
      try { await store.set(key, next, { version: cur ? cur.version : 0 }); return { won: true, id, epoch }; } catch (err) { if (!err || err.status !== 409) throw err; }
      const again = await store.get(key);
      const m2 = again && dlCleanSeedMarker(again.value);
      if (m2 && (m2.epoch || 0) > ((m && m.epoch) || 0)) return { won: false, marker: m2 }; // somebody re-seeded first: wait for their state
    }
    return { error: new Error('seed marker busy') };
  } catch (err) { return { error: err }; }
}

// ---- load ----------------------------------------------------------------------------------------------------------------------------
// The join side. o: { store, id, lex, storedText (the text this page read), storedRev (its textRev), storedRec (its record), me, now() }.
// -> { load(), judge(bytes, header), reseed(), textLen() }
function dlSnapJoin(PM, o) {
  const gateApi = dlCoeditGate(PM);
  const limits = { bytes: gateApi.limits.snapshotBytes, lex: o.lex };
  return {
    textLen: () => o.storedText.length,
    storedRev: () => o.storedRev,
    // -> { none } | { reject: <reason> } | { ok, header, bytes }
    async load() {
      try {
        const got = await o.store.get(dlSnapHeaderKey(o.id));
        if (!got) return { none: true };
        const header = dlSnapCleanHeader(got.value);
        if (header.bad) return { reject: header.bad };
        if (header.rev > o.storedRev + 1) return { reject: 'rev_ahead' };
        const mk = await o.store.get(dlSeedMarkerKey(o.id));
        const marker = mk && dlCleanSeedMarker(mk.value);
        if (!marker) return { reject: 'no_marker' };
        if (marker.id !== header.seed || (marker.epoch || 0) !== header.epoch) return { reject: 'lineage' };
        const chunks = await Promise.all(header.hashes.map((h, n) => o.store.get(dlSnapChunkKey(o.id, n)).then((c) => (c ? dlSnapCleanChunk(c.value, n, h) : { bad: 'chunk_missing' }))));
        let total = 0;
        for (const c of chunks) { if (c.bad) return { reject: c.bad }; total += c.length; }
        if (total !== header.bytes) return { reject: 'size' };
        const bytes = new Uint8Array(total); let at = 0;
        for (const c of chunks) { bytes.set(c, at); at += c.length; }
        return { ok: true, header, bytes };
      } catch (err) { return { reject: 'read_failed', detail: String(err && err.message).slice(0, 80) }; }
    },
    // The gate and the check, on a new document made from the bytes. -> { ok, doc, vectorBytes } | { reject }
    judge(bytes, header) {
      let built;
      try { built = gateApi.rebuildFromGood(bytes, limits); } catch (err) { return { reject: 'gate_throws' }; }
      if (!built.ok) { try { built.doc.destroy(); } catch (e) { /* gone */ } return { reject: `gate_${built.reason}` }; }
      const same = header.rev === o.storedRev;
      let v;
      try { v = gateApi.verifyBeforeSnapshot(o.lex, built.doc, same ? o.storedText : '', limits); } catch (err) { v = { ok: false, reason: 'throws' }; }
      if (!v.ok) { built.doc.destroy(); return { reject: `verify_${v.reason}` }; }
      if (same && v.text !== o.storedText) { built.doc.destroy(); return { reject: 'text_differs' }; }
      // A copy made from the saved text also has the saved title, colour and layout (the writer copies only when they are saved too): one that does not is not the document.
      if (same && o.storedRec && !dlMetaSame(built.doc, o.storedRec)) { built.doc.destroy(); return { reject: 'meta_differs' }; }
      return { ok: true, doc: built.doc, vectorBytes: PM.encodeStateVector(built.doc).length };
    },
    reseed: () => dlSnapReseed(o.store, { doc: o.id, text: o.storedText, me: o.me, now: o.now }),
  };
}

// ---- write -----------------------------------------------------------------------------------------------------------------------------
// What the writer's page checks before a copy: the grids repaired, the state read back against the saved text (mended when it does not), and the text of the
// state the saved text. -> { ok, bytes } | { ok: false, reason }.
function dlSnapPrepare(PM, lex, doc, savedText) {
  const gateApi = dlCoeditGate(PM);
  try {
    if (gateApi.repairGrids(doc) > 0) return { ok: false, reason: 'unsaved' }; // the repair changed the text: the next save, then the copy
    const m = gateApi.mendForSnapshot(lex, doc, savedText);
    if (!m.ok) return { ok: false, reason: `verify_${m.verify && m.verify.reason}` };
    if (m.dropped.length || m.verify.text !== savedText) return { ok: false, reason: 'unsaved', dropped: m.dropped };
    return { ok: true, bytes: PM.encodeStateAsUpdate(doc) };
  } catch (err) { return { ok: false, reason: 'throws' }; }
}

// The writer's copy. Call tick() about once a second; it does nothing unless every rule allows a copy. o:
//   store, id, me, now() (ms), iso() (a time string)
//   isWriter(), ready(), dirty()      the page is the writer and has its content / has text not saved yet
//   savedText(), rev()                the text this page saved or read last, and its textRev
//   stateKey(), largeKey()            counters that change when the state changes / when a large update (over the live limit) came or went
//   prepare()                         -> { ok, bytes } | { ok: false, reason } (dlSnapPrepare)
//   writes()                          the writes this page made in the last minute
//   lineage()                         { seed, epoch } of this page's document as the session knows it, or null (where not known, the marker is taken as it stands)
//   alone()                           no other editor is in the room
//   mended(dropped)                   the mend removed blocks: the page says so
//   note(text), onChange()            a plain line for the person; something to redraw
// -> { tick, adopted, counts, state }
function dlSnapSaver(o) {
  const counts = { written: 0, chunks: 0, skipped: 0, full: 0, limited: 0, failed: 0, conflicts: 0, deleted: 0, healed: 0, lastBytes: 0, lastChunks: 0, lastWrote: 0, lastAt: '', skips: {} };
  const state = { running: false, have: false, said: false };
  const known = new Map(); // n -> hash: chunks this page wrote or loaded and checked
  let lineage = null; // { seed, epoch } as the marker had it when this page first wrote or loaded
  let seenKey = NaN; let lastChange = -Infinity; let snapKey = NaN; let snapRev = -1; let lastWrite = -Infinity; let hold = 0; let largeAt = NaN; let failures = 0;
  const skip = (why) => { counts.skipped += 1; counts.skips[why] = (counts.skips[why] || 0) + 1; };

  // The page applied a copy it loaded (checked), at this state: its hashes are known, and the state is the copy's.
  function adopted(header, chunkHashes) {
    known.clear(); chunkHashes.forEach((h, n) => known.set(n, h));
    lineage = { seed: header.seed, epoch: header.epoch };
    snapKey = o.stateKey(); snapRev = header.rev; largeAt = o.largeKey();
    state.have = header.rev === o.rev();
    lastWrite = o.now();
  }

  async function write() {
    state.running = true;
    const t = o.now();
    try {
      const keyNow = o.stateKey(); const revNow = o.rev(); const large = o.largeKey();
      const p = o.prepare();
      if (!p.ok) { if (p.dropped && p.dropped.length && o.mended) o.mended(p.dropped); skip(p.reason); return; }
      if (p.bytes.length > DL_SNAP.maxBytes) { skip('too_big'); hold = t + DL_SNAP.holdFullMs; return; }
      const mk = await o.store.get(dlSeedMarkerKey(o.id));
      let marker = mk && dlCleanSeedMarker(mk.value);
      const own = o.lineage ? o.lineage() : null; // the lineage this page's state is in, when known
      const mine = lineage || (own && own.seed ? { seed: own.seed, epoch: own.epoch || 0 } : null);
      if (!marker || (mine && (mine.seed !== marker.id || mine.epoch !== (marker.epoch || 0)))) {
        // The marker is not this page's lineage (someone wrote it, or it is gone or garbage). With others in the room the copy waits; a page that is alone puts
        // the marker back under its own lineage, so the copy is written and a page that opens next can load it. The text is not touched either way.
        if (!mine || !o.alone || !o.alone()) { skip(marker ? 'lineage_changed' : 'no_marker'); hold = t + DL_SNAP.holdFailMs; return; }
        const next = { id: mine.seed, by: o.me, at: o.iso(), ...(mine.epoch ? { epoch: mine.epoch } : {}) };
        try { await o.store.set(dlSeedMarkerKey(o.id), next, { version: mk ? mk.version : 0 }); } catch (err) { if (err && err.status === 409) { skip('marker_busy'); hold = t + DL_SNAP.holdConflictMs; return; } throw err; }
        marker = next; counts.healed += 1;
      }
      const lin = { seed: marker.id, epoch: marker.epoch || 0 };
      if (lineage && (lineage.seed !== lin.seed || lineage.epoch !== lin.epoch)) { skip('lineage_changed'); hold = t + DL_SNAP.holdFailMs; return; }
      const hv = await o.store.get(dlSnapHeaderKey(o.id));
      const oldHeader = hv ? dlSnapCleanHeader(hv.value) : null;
      const old = oldHeader && !oldHeader.bad ? oldHeader : null;
      const chunks = dlSnapSplit(p.bytes);
      if (old && (old.seed !== lin.seed || old.epoch !== lin.epoch)) known.clear(); // a new lineage: every chunk is written
      const todo = chunks.filter((c) => known.get(c.n) !== c.h);
      if (o.writes() + todo.length + 4 > DL_SNAP.budget) { skip('budget'); hold = t + DL_SNAP.holdBudgetMs; return; }
      let wrote = 0;
      try {
        for (const c of todo) { await o.store.set(dlSnapChunkKey(o.id, c.n), { n: c.n, d: c.d, h: c.h }); known.set(c.n, c.h); wrote += 1; counts.chunks += 1; }
        const header = { v: 1, rev: revNow, n: chunks.length, bytes: p.bytes.length, hashes: chunks.map((c) => c.h), seed: lin.seed, epoch: lin.epoch, at: o.iso() };
        await o.store.set(dlSnapHeaderKey(o.id), header, { version: hv ? hv.version : 0 });
        lineage = lin;
      } catch (err) {
        if (err && err.status === 409) { known.clear(); counts.conflicts += 1; hold = t + DL_SNAP.holdConflictMs; return; } // another writer put a header in
        throw err;
      }
      for (let n = chunks.length; old && n < old.n; n += 1) { try { await o.store.delete(dlSnapChunkKey(o.id, n)); counts.deleted += 1; } catch (err) { /* left: harmless */ } }
      counts.written += 1; counts.lastBytes = p.bytes.length; counts.lastChunks = chunks.length; counts.lastWrote = wrote; counts.lastAt = o.iso();
      snapKey = keyNow; snapRev = revNow; largeAt = large; lastWrite = t; failures = 0; hold = 0; state.have = true;
    } catch (err) {
      const kind = dlCoErr(err); failures += 1;
      if (kind === 'full') { counts.full += 1; hold = t + DL_SNAP.holdFullMs; if (!state.said) { state.said = true; o.note('The saved copy for faster opening is full. Your text is safe.'); } }
      else if (kind === 'limit') { counts.limited += 1; hold = t + Math.max(DL_SNAP.holdLimitMs, (Number(err.retryAfter) || 0) * 1000); }
      else { counts.failed += 1; hold = t + Math.min(300000, DL_SNAP.holdFailMs * 2 ** Math.min(4, failures - 1)); }
    } finally { state.running = false; if (o.onChange) o.onChange(); }
  }

  function tick() {
    if (state.running) return null;
    const t = o.now();
    const k = o.stateKey();
    if (!Number.isFinite(largeAt)) largeAt = o.largeKey();
    if (k !== seenKey) { seenKey = k; lastChange = t; }
    if (!o.isWriter() || !o.ready()) return null;
    const changed = k !== snapKey && o.rev() > snapRev;
    if (state.have && !changed) return null;
    if (o.dirty()) return null; // the text is saved first; the copy is of the saved text
    if (t - lastChange < DL_SNAP.quietMs) return null; // never inside a burst
    const large = o.largeKey() !== largeAt && Number.isFinite(largeAt);
    if (t - lastWrite < (large ? DL_SNAP.fastGapMs : DL_SNAP.gapMs)) return null;
    if (t < hold) return null;
    return write();
  }
  return { tick, adopted, counts, state, known: () => new Map(known) };
}
