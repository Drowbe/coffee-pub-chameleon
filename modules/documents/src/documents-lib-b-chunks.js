  // ---- documents-lib-b-chunks.js: splitting text into chunks and joining it back (no page, no host) -----------------------
  //
  // Cut at the last blank line before the limit; if none, at the last line break; if none, at a character boundary that does
  // not split a surrogate pair. An empty text is one empty chunk. Too long (over 6 chunks or 150,000 characters) is refused.
  // The limit is the chunk record's serialized JSON, so the cost of each character is measured as JSON writes it.

  // JSON cost of one code point (a string of it, less the two quotes).
  const dlJsonCost = (cp) => JSON.stringify(cp).length - 2;

  // How many code units of `text` (from `from`) fit in `budget` JSON characters; never ends inside a surrogate pair.
  function dlFit(text, from, budget) {
    let used = 0;
    let i = from;
    while (i < text.length) {
      const c = text.charCodeAt(i);
      const pair = c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff;
      const step = pair ? 2 : 1;
      const cost = dlJsonCost(text.slice(i, i + step));
      if (used + cost > budget) break;
      used += cost;
      i += step;
    }
    return i;
  }

  // The text budget of a chunk: the limit less the record's own fields (the longest ids).
  const dlChunkBudget = () => DL.chunkJson - JSON.stringify({ id: 'x'.repeat(8), doc: 'x'.repeat(16), text: '' }).length;

  // -> { ok:true, chunks:[text, ...] } or { ok:false, reason:'long' }
  function dlSplit(text) {
    if (typeof text !== 'string') return { ok: false, reason: 'text' };
    if (text.length > DL.sizeMax) return { ok: false, reason: 'long' };
    if (text === '') return { ok: true, chunks: [''] };
    const budget = dlChunkBudget();
    const chunks = [];
    let at = 0;
    while (at < text.length) {
      const end = dlFit(text, at, budget);
      let cut = end;
      if (end < text.length) {
        const part = text.slice(at, end);
        const blank = part.lastIndexOf('\n\n');
        const line = part.lastIndexOf('\n');
        if (blank > 0) cut = at + blank + 2;
        else if (line > 0) cut = at + line + 1;
        if (cut <= at) cut = end > at ? end : at + 1;
      }
      chunks.push(text.slice(at, cut));
      at = cut;
      if (chunks.length > DL.chunksMax) return { ok: false, reason: 'long' };
    }
    return { ok: true, chunks };
  }
  const dlJoin = (chunks) => chunks.join('');

  // Which chunk ids a save keeps. `old` = [{ id, text }] in order; `next` = texts in order; `fresh()` a new id.
  // -> [{ id, text, write }]: a chunk equal to the old one at the same place keeps its id and is not written.
  function dlPlanChunks(old, next, fresh) {
    const used = new Set(old.map((o) => o.id));
    return next.map((text, i) => {
      if (old[i] && old[i].text === text) return { id: old[i].id, text, write: false };
      let id = fresh();
      while (used.has(id)) id = fresh();
      used.add(id);
      return { id, text, write: true };
    });
  }
  // The chunk ids the old record listed and the new one does not (deleted after the commit).
  const dlDroppedChunks = (oldIds, newIds) => oldIds.filter((id) => !newIds.includes(id));
  // Chunks stored under the document that its small record does not list (leftovers of a save that did not finish).
  const dlLeftoverChunks = (listed, storedIds) => storedIds.filter((id) => !listed.includes(id));

  // The first 300 characters as plain text, for lists and search.
  function dlExcerpt(text) {
    const t = dlCleanText(text)
      .replace(/^\s*(```|~~~).*$/gm, ' ')
      .replace(/^[\s|:-]*-[\s|:-]*$/gm, ' ')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/gm, '')
      .replace(/[*_`~|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return dlCut(t, DL.excerptMax).trim();
  }
