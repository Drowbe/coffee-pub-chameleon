  // ---- documents-lib-a-records.js: cleaning the three stored records (no page, no host) ------------------------------------
  //
  //   doc:<id>        { id, type:'doc', title, rev, chunks, size, excerpt, by, at, editedBy, editedByName, editedAt }
  //   text:<id>:<c>   { id:<chunk>, doc:<id>, text }
  //   _lock:<id>      { id:'lock', type:'lock', doc, holder, name, at, seq, by }
  // Every record is cleaned on reading as well as on writing: a wrong type, unknown fields dropped, strings cut, control
  // and direction characters removed, ids matched against a pattern. A record that does not clean is null (shown as unreadable).
  // These files carry no module words, so another module can reuse them.
  const DL = Object.freeze({
    titleMax: 120,
    nameMax: 40,
    excerptMax: 300,
    sizeMax: 150000,
    chunksMax: 6,
    chunkJson: 48000, // a chunk record's serialized JSON, measured, never estimated
    gridRows: 200,
    gridCols: 20,
    listDepth: 4,
    formulaMax: 2000,
  });

  // Direction-control and zero-width characters (bidi marks and overrides, isolates, zero-width space/joiners, word joiner,
  // BOM, Arabic letter mark).
  const DL_INVISIBLE = /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
  // Text: invisible ones out; control characters out except tab and line breaks (a carriage return becomes nothing).
  const dlCleanText = (s) => (typeof s === 'string' ? s.replace(DL_INVISIBLE, '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '') : '');
  // One line (a title, a name): no control character at all, runs of space collapsed, cut by code points.
  const dlCleanLine = (s, max) => {
    if (typeof s !== 'string') return '';
    const t = s.replace(DL_INVISIBLE, '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/ {2,}/g, ' ').trim();
    return dlCut(t, max).trim();
  };
  // Cut to `max` characters without splitting a surrogate pair.
  function dlCut(s, max) {
    if (s.length <= max) return s;
    let n = max;
    const c = s.charCodeAt(n - 1);
    if (c >= 0xd800 && c <= 0xdbff) n -= 1;
    return s.slice(0, n);
  }

  const dlIsRecord = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const dlDocId = (s) => (typeof s === 'string' && /^[a-z0-9]{8,16}$/.test(s) ? s : null);
  const dlChunkId = (s) => (typeof s === 'string' && /^[a-z0-9]{8}$/.test(s) ? s : null);
  const dlUserKey = (s) => (typeof s === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(s) ? s : null);
  const dlTime = (s) => (typeof s === 'string' && s.length <= 40 && Number.isFinite(Date.parse(s)) ? s : null);
  const dlInt = (n, lo, hi) => (Number.isInteger(n) && n >= lo && n <= hi ? n : null);

  // The document's small record, or null.
  function dlCleanDoc(v) {
    if (!dlIsRecord(v) || v.type !== 'doc') return null;
    const id = dlDocId(v.id);
    const title = dlCleanLine(v.title, DL.titleMax);
    const rev = dlInt(v.rev, 1, 1e9);
    const size = dlInt(v.size, 0, DL.sizeMax);
    if (!id || !title || rev === null || size === null) return null;
    if (typeof v.title !== 'string' || v.title.length > DL.titleMax * 4) return null;
    if (!Array.isArray(v.chunks) || v.chunks.length < 1 || v.chunks.length > DL.chunksMax) return null;
    const chunks = v.chunks.map(dlChunkId);
    if (chunks.includes(null) || new Set(chunks).size !== chunks.length) return null;
    if (typeof v.excerpt !== 'string' || v.excerpt.length > DL.excerptMax * 2) return null;
    const by = dlUserKey(v.by);
    const editedBy = dlUserKey(v.editedBy);
    const at = dlTime(v.at);
    const editedAt = dlTime(v.editedAt);
    if (!by || !editedBy || !at || !editedAt) return null;
    return {
      id, type: 'doc', title, rev, chunks, size,
      excerpt: dlCut(dlCleanLine(v.excerpt, DL.excerptMax * 2), DL.excerptMax),
      by, at, editedBy,
      editedByName: dlCleanLine(v.editedByName, DL.nameMax) || 'Someone',
      editedAt,
    };
  }

  // A chunk of text, or null. `maxJson` is the serialized limit, checked on the record as it is given.
  function dlCleanChunk(v) {
    if (!dlIsRecord(v) || typeof v.text !== 'string') return null;
    const id = dlChunkId(v.id);
    const doc = dlDocId(v.doc);
    if (!id || !doc) return null;
    if (JSON.stringify({ id: v.id, doc: v.doc, text: v.text }).length > DL.chunkJson) return null;
    return { id, doc, text: dlCleanText(v.text) };
  }

  // The edit lock, or null.
  function dlCleanLock(v) {
    if (!dlIsRecord(v) || v.id !== 'lock' || v.type !== 'lock') return null;
    const doc = dlDocId(v.doc);
    const holder = dlUserKey(v.holder);
    if (!doc || !holder) return null;
    return {
      id: 'lock', type: 'lock', doc, holder,
      name: dlCleanLine(v.name, DL.nameMax) || 'Someone',
      at: dlTime(v.at) || '',
      seq: dlInt(v.seq, 0, 1e9) || 0,
      by: dlUserKey(v.by) || holder,
    };
  }

  const dlDocKey = (id) => `doc:${id}`;
  const dlTextKey = (id, chunk) => `text:${id}:${chunk}`;
  const dlLockKey = (id) => `_lock:${id}`;
  // A new id: `len` lowercase letters and digits from rand() (0 up to 1).
  function dlNewId(rand, len = 8) {
    const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < len; i += 1) s += a[Math.min(a.length - 1, Math.floor(rand() * a.length))];
    return s;
  }
