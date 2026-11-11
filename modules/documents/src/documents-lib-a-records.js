  // ---- documents-lib-a-records.js: cleaning the three stored records (no page, no host) ------------------------------------
  //
  //   doc:<id>        { id, type:'doc', title, rev, chunks, size, excerpt, preview?, paper, by, at, editedBy, editedByName, editedAt }
  //   text:<id>:<c>   { id:<chunk>, doc:<id>, text }
  //   _lock:<id>      { id:'lock', type:'lock', doc, holder, name, at, seq, by }
  // Every record is cleaned on reading as well as on writing: a wrong type, unknown fields dropped, strings cut, control
  // and direction characters removed, ids matched against a pattern. A record that does not clean is null (shown as unreadable).
  // These files carry no module words, so another module can reuse them.
  const DL = Object.freeze({
    titleMax: 120,
    nameMax: 40,
    excerptMax: 300,
    previewMax: 400,
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
  // A text without the line breaks at its end. A loop on purpose: the pattern /\n+$/ tries every line break of a long run in the
  // middle of a text as a start, so its cost grows with the square of the run (seconds at 100,000 line breaks).
  const dlTrimBreaks = (s) => { let e = s.length; while (e > 0 && s.charCodeAt(e - 1) === 10) e -= 1; return e < s.length ? s.slice(0, e) : s; };
  // One line (a title, a name): no control character at all, runs of space collapsed, cut by code points.
  const dlCleanLine = (s, max) => {
    if (typeof s !== 'string') return '';
    const t = s.replace(DL_INVISIBLE, '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/ {2,}/g, ' ').trim();
    return dlCut(t, max).trim();
  };
  // The first lines of a text as short plain Markdown, for a thumbnail: cleaned, at most previewMax characters, cut at a line
  // boundary where there is one (a cut that keeps at least a quarter of the allowance), never inside a surrogate pair.
  function dlPreview(text) {
    const t = dlCleanText(text).replace(/^\n+/, '');
    if (t.length <= DL.previewMax) return t.trimEnd();
    const cut = dlCut(t, DL.previewMax);
    const nl = cut.lastIndexOf('\n');
    return (nl >= DL.previewMax / 4 && t[cut.length] !== '\n' ? cut.slice(0, nl) : cut).trimEnd();
  }
  // A preview read from a record: never trusted, cleaned again and capped (a stray type, or none, is nothing).
  const dlCleanPreview = (v) => (typeof v === 'string' ? dlPreview(v.slice(0, DL.previewMax * 2)) : '');
  // What a thumbnail shows: the preview, else (a record saved before previews) the excerpt.
  const dlThumbText = (rec) => (rec && (rec.preview || rec.excerpt)) || '';

  // Cut to `max` characters without splitting a surrogate pair.
  function dlCut(s, max) {
    if (s.length <= max) return s;
    let n = max;
    const c = s.charCodeAt(n - 1);
    if (c >= 0xd800 && c <= 0xdbff) n -= 1;
    return s.slice(0, n);
  }

  // The page colour: one of a small fixed set, named as the Whiteboard names its fixed backgrounds (--wb-fixed-*), so a later move
  // to shared tokens is a rename. `css` is the custom property in documents.css that holds the colour (read by name, never a
  // free string in CSS). A missing or unknown id reads as the default.
  const DL_PAPERS = Object.freeze([
    { id: 'light-white', label: 'Pure White', family: 'light', css: '--doc-fixed-light-white' },
    { id: 'light-creme', label: 'Creme', family: 'light', css: '--doc-fixed-light-creme' },
    { id: 'light-grey', label: 'Light Grey', family: 'light', css: '--doc-fixed-light-grey' },
    { id: 'light-blue', label: 'Light Blue', family: 'light', css: '--doc-fixed-light-blue' },
    { id: 'dark-slate', label: 'Slate', family: 'dark', css: '--doc-fixed-dark-slate' },
    { id: 'dark-blue', label: 'Dark Blue', family: 'dark', css: '--doc-fixed-dark-blue' },
    { id: 'dark-black', label: 'Black', family: 'dark', css: '--doc-fixed-dark-black' },
  ].map((p) => Object.freeze(p)));
  const DL_PAPER_DEFAULT = 'light-white';
  const DL_PAPER_BY_ID = new Map(DL_PAPERS.map((p) => [p.id, p]));
  const dlCleanPaper = (v) => (typeof v === 'string' && DL_PAPER_BY_ID.has(v) ? v : DL_PAPER_DEFAULT);
  // The colour menu's entries in order: { kind:'heading', label } and { kind:'paper', id, label, css }.
  function dlPaperMenuModel() {
    const out = [];
    for (const family of ['light', 'dark']) {
      out.push({ kind: 'heading', label: family === 'light' ? 'Light colours' : 'Dark colours' });
      for (const p of DL_PAPERS) if (p.family === family) out.push({ kind: 'paper', id: p.id, label: p.label, css: p.css });
    }
    return out;
  }
  // Contrast (WCAG), as the Whiteboard's wbContrast: colours are [r, g, b] (0-255); a ratio from 1 to 21.
  function dlLuminance(rgb) {
    const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  }
  function dlContrast(a, b) {
    const x = dlLuminance(a);
    const y = dlLuminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  // 'dark' or 'light': whichever of the two inks reads better on `fill` (the dark one on a tie); null when a colour is not three numbers.
  function dlInkFor(fill, dark, light) {
    const ok = (c) => Array.isArray(c) && c.length === 3 && c.every((n) => Number.isFinite(n));
    if (!ok(fill) || !ok(dark) || !ok(light)) return null;
    return dlContrast(fill, dark) >= dlContrast(fill, light) ? 'dark' : 'light';
  }
  // "#rrggbb" or "#rgb" to [r, g, b], else null.
  function dlHexRgb(s) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(typeof s === 'string' ? s.trim() : '');
    if (!m) return null;
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
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
    const preview = dlCleanPreview(v.preview);
    return {
      id, type: 'doc', title, rev, chunks, size,
      excerpt: dlCut(dlCleanLine(v.excerpt, DL.excerptMax * 2), DL.excerptMax),
      ...(preview ? { preview } : {}),
      paper: dlCleanPaper(v.paper),
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

  // A removed document, kept for a while so it can come back: `_trash:<id>` = { id, type:'trash', doc:<the small record>, by,
  // name, at }. Its text chunks stay where they are. The leading "_" keeps it out of a list of the documents.
  const DL_TRASH_DAYS = 7;
  const dlTrashKey = (id) => `_trash:${id}`;
  function dlCleanTrash(v) {
    if (!dlIsRecord(v) || v.type !== 'trash') return null;
    const doc = dlCleanDoc(v.doc);
    const by = dlUserKey(v.by);
    const at = dlTime(v.at);
    if (!doc || !by || !at || v.id !== doc.id) return null;
    return { id: doc.id, type: 'trash', doc, by, name: dlCleanLine(v.name, DL.nameMax) || 'Someone', at };
  }
  const dlTrashExpired = (rec, now) => now - Date.parse(rec.at) >= DL_TRASH_DAYS * 86400000;
