  // ---- documents-lib-o-write.js: the rich editor's text -> Markdown, block by block (no page, no host) ----------------------
  //
  // dlRichText(PM, doc, stored, lex) is what the editor's getText() hands out. It is a pure function of the editor's text (`doc`)
  // and the table made when the stored text was read (`stored`, from dlRichRead in documents-lib-m-parse.js). The rules:
  //   1. NOTHING CHANGED: the stored text is handed back as it is, character for character, and nothing is read or written.
  //   2. A BLOCK THAT IS UNCHANGED is written word for word: a top-level node that is the same node as, or equal to
  //      (Node.eq), a stored one writes that block's stored slice (dlRichMatch; a moved block is kept too).
  //   3. A BLOCK THAT IS CHANGED OR NEW is written by the serialiser (dlRichSerialise: the editor's form), alone.
  //   4. WHAT STANDS BETWEEN TWO BLOCKS: the stored blank lines where both blocks stood side by side in the stored text, and
  //      around a block that is edited in place; a blank line elsewhere. So typing in one block changes that block's
  //      characters and no other character of the text.
  //   5. READ BACK (decision 23): before the text is handed out it is read again, whole, and compared with the editor's text
  //      block by block. A written block that reads differently gets a blank line on both sides; a kept block that reads
  //      differently is written by the serialiser, alone (`alone` counts them); if the text still differs, the whole text is
  //      written by the serialiser (the last resort: `whole`).
  //   6. WHAT CANNOT READ BACK. A written block that does not read back as itself is read alone. When it reads the same way
  //      alone, the serialiser cannot write it (a raw block a person edited, words that start with a space: the editor's
  //      rules of a later step): the text is handed out as written and `same` is false; the other blocks are still checked,
  //      and nothing else is written again for it. If the text does not read back at all (a raw block never closed, with
  //      blocks after it), the first block-level text is handed out, `same` false.
  // A block that writes nothing (an empty paragraph: Markdown has none) is left out of the text and of the comparison.
  // Result: { text, changed, same, whole, over, alone, reads, blocks }
  //   changed  false when the stored text was handed back (rule 1)      same   the text reads back as the editor's text
  //   whole    the whole text was written by the serialiser             alone  kept blocks written again alone (rule 5)
  //   reads    how many times the whole text was read back              blocks [{ index, from, to, entry }] for each block
  //            written: its place in `doc`, its characters in `text`, and the table entry it was kept from (-1: written new)
  //   over     the text is longer than the reader reads (DL.sizeMax): read back once, whole, and handed out as written
  // Cost: grows with the length of the text (one matching pass, one reading). It is for save, Done, Copy and Source, never
  // for a key (decision 24). One table serves a whole editing session: it is made again only when the editor is given a new
  // text (setText), because the nodes of the table are the nodes the editor's text started from.
  const DL_RICH_WRITE = Object.freeze({ passes: 6, probes: 8, scan: 64, keyText: 32 });
  const DL_RICH_BLANK_LINE = /\n[ \t]*\n/;
  const DL_RICH_LIST_MARK = { bullet_list: /^ {0,3}([-*+])/, ordered_list: /^ {0,3}\d{1,9}([.)])/ };

  // Which stored block each block of the text is: -> an array, for each of `now` the index of its entry, or -1.
  // First the very node (the editor keeps the node of a block nobody touched, so two blocks that read alike are not mixed up).
  // Then, for the blocks left, an equal node (Node.eq: a text read again, a block typed back to what it was), tried in this
  // order: the stored block after the last match (a run goes on), the one as far from the start, the one as far from the end,
  // then any equal one, looked up by what it is (its kind, size, first and last words) and compared in full. A stored block is
  // used once.
  function dlRichMatch(entries, now) {
    const m = entries.length;
    const n = now.length;
    const at = new Array(n).fill(-1);
    const used = new Uint8Array(m);
    const where = new Map();
    for (let i = 0; i < m; i += 1) where.set(entries[i].node, i);
    let left = 0;
    for (let j = 0; j < n; j += 1) {
      const i = where.get(now[j]);
      if (i !== undefined && !used[i]) { at[j] = i; used[i] = 1; } else left += 1;
    }
    if (!left || left === n - m) return at; // every stored block is in use
    const key = (b) => {
      const size = b.content.size;
      const words = b.isLeaf ? JSON.stringify(b.attrs) : `${b.textBetween(0, Math.min(size, DL_RICH_WRITE.keyText), '\n', '\u0001')}|${b.textBetween(Math.max(0, size - DL_RICH_WRITE.keyText), size, '\n', '\u0001')}`;
      return `${b.type.name}|${b.nodeSize}|${b.childCount}|${words}`;
    };
    let known = null;
    const lookUp = (b) => {
      if (!known) {
        known = new Map();
        for (let i = 0; i < m; i += 1) {
          if (used[i]) continue;
          const k = key(entries[i].node);
          const list = known.get(k);
          if (list) list.ids.push(i); else known.set(k, { ids: [i], head: 0 });
        }
      }
      const list = known.get(key(b));
      if (!list) return -1;
      while (list.head < list.ids.length && used[list.ids[list.head]]) list.head += 1;
      let tried = 0;
      const stop = Math.min(list.ids.length, list.head + DL_RICH_WRITE.scan);
      for (let x = list.head; x < stop && tried < DL_RICH_WRITE.probes; x += 1) { // a bounded look: the cost stays with the length
        if (used[list.ids[x]]) continue;
        tried += 1;
        if (entries[list.ids[x]].node.eq(b)) return list.ids[x];
      }
      return -1;
    };
    const equal = (i, j) => i >= 0 && i < m && !used[i] && entries[i].node.eq(now[j]);
    for (let j = 0; j < n; j += 1) {
      if (at[j] >= 0) continue;
      const run = j > 0 && at[j - 1] >= 0 ? at[j - 1] + 1 : -1;
      const found = equal(run, j) ? run : equal(j, j) ? j : equal(m - n + j, j) ? m - n + j : lookUp(now[j]);
      if (found >= 0) { at[j] = found; used[found] = 1; }
    }
    return at;
  }

  function dlRichText(PM, doc, stored, lex) {
    const N = dlRichSchema(PM).nodes;
    const entries = stored.entries;
    const result = (text, more) => ({ text, changed: true, same: true, whole: false, over: false, alone: 0, reads: 0, blocks: null, ...more });
    const asStored = () => result(stored.text, { changed: false });
    if (doc === stored.doc || (!entries && doc.eq(stored.doc))) return asStored();
    const now = [];
    doc.forEach((b) => now.push(b));
    const n = now.length;
    const m = entries ? entries.length : 0;
    const at = entries ? dlRichMatch(entries, now) : new Array(n).fill(-1);
    const out = new Array(n).fill(null); // a written block's text ('' when it writes nothing); null for a kept block
    const forced = new Uint8Array(n); // a blank line on both sides, whatever stood there
    const live = (j) => at[j] >= 0 || out[j] !== '';
    const textOf = (j) => (at[j] >= 0 ? entries[at[j]].text : out[j]);
    // The list mark of the block before or after block j, when it is a list of this kind whose text is known.
    const markBeside = (j, step, type) => {
      let k = j + step;
      while (k >= 0 && k < n && !live(k)) k += step;
      if (k < 0 || k >= n || now[k].type !== type || textOf(k) === null) return null;
      const found = DL_RICH_LIST_MARK[type.name].exec(textOf(k));
      return found ? { kind: type.name, mark: found[1] } : null;
    };
    const write = (j) => {
      const b = now[j];
      const beside = DL_RICH_LIST_MARK[b.type.name] ? { before: markBeside(j, -1, b.type), after: markBeside(j, 1, b.type) } : null;
      at[j] = -1;
      out[j] = dlTrimBreaks(dlRichSerialise(PM, N.doc.create(null, [b]), beside));
    };
    // What a written block reads as, alone, when it does not read back as itself in the text (rule 6). Read when asked, once.
    const readings = new Map();
    const reading = (j) => {
      if (at[j] >= 0 || !out[j]) return null;
      const key = `${j}:${out[j]}`;
      if (!readings.has(key)) {
        const alone = dlRichRead(PM, out[j], lex);
        const nodes = [];
        if (alone.stored.entries) for (const e of alone.stored.entries) nodes.push(e.node); else alone.doc.forEach((x) => nodes.push(x));
        readings.set(key, nodes);
      }
      return readings.get(key);
    };
    let reads = 0;
    let alone = 0;
    // Does a text read back as its blocks? -> { ok, same, bad }. `bad` is the blocks that do not read back: the text read again
    // has no block with those very characters that reads as that node (or, for a written block, as what it reads as alone);
    // null when the blocks cannot be told apart. `same` is true when every block reads back as its own node.
    const readBack = (text, blocks) => {
      reads += 1;
      const read = dlRichRead(PM, text, lex);
      const got = read.stored.clean ? read.stored.entries : null;
      if (!got || (blocks.length && blocks[0].from === undefined)) {
        const whole = (pick) => {
          const all = [];
          for (const b of blocks) for (const x of pick(b.index)) all.push(x);
          let ok = all.length ? read.doc.childCount === all.length : read.doc.childCount === 1 && read.doc.firstChild.type === N.paragraph && read.doc.firstChild.childCount === 0;
          for (let k = 0; ok && k < all.length; k += 1) ok = read.doc.child(k).eq(all[k]);
          return ok;
        };
        const same = whole((j) => [now[j]]);
        return { ok: same || whole((j) => reading(j) || [now[j]]), same, bad: null };
      }
      const bad = [];
      let same = true;
      let i = 0;
      for (const b of blocks) {
        while (i < got.length && got[i].from < b.from) i += 1;
        const start = i;
        while (i < got.length && got[i].from < b.to) i += 1;
        const fits = (nodes) => {
          if (i - start !== nodes.length) return false;
          if (!nodes.length) return true;
          if (got[start].from !== b.from || got[i - 1].from + got[i - 1].text.length !== b.to) return false;
          for (let k = 0; k < nodes.length; k += 1) if (!got[start + k].node.eq(nodes[k])) return false;
          return true;
        };
        if (fits([now[b.index]])) continue;
        same = false;
        const other = reading(b.index);
        if (!(other && fits(other))) bad.push(b.index);
      }
      return { ok: !bad.length, same, bad };
    };
    // The last resort: the whole text written by the serialiser. `made` is the block-level text it would replace, if there is one.
    const wholeText = (made) => {
      const text = dlRichSerialise(PM, doc);
      const blocks = [];
      for (let j = 0; j < n; j += 1) if (live(j)) blocks.push({ index: j });
      const { ok, same } = readBack(text, blocks);
      if (ok || !made) return result(text, { whole: true, same, alone, reads });
      return result(made.text, { same: false, reads, blocks: made.blocks }); // neither reads back: the one that changes least
    };

    for (let j = 0; j < n; j += 1) if (at[j] < 0 && !DL_RICH_LIST_MARK[now[j].type.name]) write(j);
    let end = n - 1;
    while (end >= 0 && !live(end)) end -= 1;
    for (let j = 0; j < end; j += 1) if (at[j] >= 0 && entries[at[j]].open) write(j); // a block with no end of its own is kept only at the end
    // A kept block that starts with an indent and has come to stand after a list would be read as part of the list's last row.
    for (let j = 1; j <= end; j += 1) {
      if (at[j] < 0 || !/^[ \t]/.test(entries[at[j]].text)) continue;
      let k = j - 1;
      while (k >= 0 && !live(k)) k -= 1;
      if (k >= 0 && DL_RICH_LIST_MARK[now[k].type.name] && (at[k] < 0 || at[k] !== at[j] - 1)) write(j);
    }
    // Lists last, in order: a written list takes a mark the lists beside it do not have, and a kept list that has come to
    // stand after a list of its kind with its own mark is written too (the two would read as one list).
    for (let j = 0; j < n; j += 1) {
      const rule = DL_RICH_LIST_MARK[now[j].type.name];
      if (!rule) continue;
      if (at[j] < 0) { if (out[j] === null) write(j); continue; }
      const before = markBeside(j, -1, now[j].type);
      const own = rule.exec(entries[at[j]].text);
      if (before && own && before.mark === own[1]) write(j);
    }
    if (!entries) return wholeText(null); // no table: nothing can be kept by the block

    // The text from the blocks as they stand: kept slices, written blocks, and what stands between them (rule 4).
    const build = () => {
      const ids = [];
      for (let j = 0; j < n; j += 1) if (live(j)) ids.push(j);
      const count = ids.length;
      const kept = (k) => k < 0 || k >= count || at[ids[k]] >= 0;
      // place[k]: the stored block that block k is, or whose place it took (written blocks between two kept ones, as many as
      // stood there). For a run of written blocks of another number: before[k], the stored block whose gap may stand before
      // the run's first block, and after[k], the one whose gap may stand after its last.
      const place = new Array(count).fill(-2);
      const before = new Array(count).fill(-2);
      const after = new Array(count).fill(-2);
      let unchanged = count === m;
      for (let k = 0; k < count;) {
        if (kept(k)) { place[k] = at[ids[k]]; if (place[k] !== k) unchanged = false; k += 1; continue; }
        unchanged = false;
        let q = k;
        while (q + 1 < count && !kept(q + 1)) q += 1;
        const a = k === 0 ? -1 : at[ids[k - 1]];
        const b = q === count - 1 ? m : at[ids[q + 1]];
        if (b - a - 1 === q - k + 1) for (let i = k; i <= q; i += 1) place[i] = a + 1 + i - k;
        else if (b > a) { before[k] = a; if (b - 1 > a) after[q] = b - 1; }
        k = q + 1;
      }
      if (unchanged) return null;
      const gapOf = (i) => (i < 0 ? stored.lead : entries[i].gap);
      const inPlace = (k) => kept(k) || (place[k] >= 0 && entries[place[k]].node.type === now[ids[k]].type);
      const gap = (k) => { // between block k and block k + 1 (k = -1: before the first; k = count - 1: after the last)
        const left = k < 0 ? -1 : place[k];
        const right = k + 1 >= count ? m : place[k + 1];
        const plain = k < 0 ? '' : k + 1 >= count ? '\n' : now[ids[k]].type === now[ids[k + 1]].type && DL_RICH_LIST_MARK[now[ids[k]].type.name] ? '\n\n\n' : '\n\n';
        let g = null;
        if (left >= -1 && right === left + 1) g = gapOf(left);
        else if (!kept(k + 1) && before[k + 1] >= -1) g = gapOf(before[k + 1]);
        else if (!kept(k) && after[k] >= 0) g = gapOf(after[k]);
        if (g === null) return plain;
        if (kept(k) && kept(k + 1)) return g;
        if ((k >= 0 && forced[ids[k]]) || (k + 1 < count && forced[ids[k + 1]])) return plain;
        if (k < 0 || k + 1 >= count || DL_RICH_BLANK_LINE.test(g)) return g;
        return inPlace(k) && inPlace(k + 1) ? g : plain; // no blank line between them: kept only around a block edited in place
      };
      if (!count) return { text: '', blocks: [] };
      const parts = [gap(-1)];
      const blocks = [];
      let size = parts[0].length;
      for (let k = 0; k < count; k += 1) {
        const t = textOf(ids[k]);
        const g = gap(k);
        blocks.push({ index: ids[k], from: size, to: size + t.length, entry: at[ids[k]] });
        parts.push(t, g);
        size += t.length + g.length;
      }
      return { text: parts.join(''), blocks };
    };

    const first = build();
    if (!first) return asStored();
    // Past the reader's size bound the reader holds a text whole, so the blocks cannot be checked one by one: the text is
    // read once (it reads back when it is one raw block held whole) and handed out as written. The save refuses such a text.
    if (first.text.length > DL.sizeMax) return result(first.text, { same: readBack(first.text, first.blocks).same, over: true, reads, blocks: first.blocks });
    let made = first;
    // A kept block that no longer stands after the block it stood after in the stored text.
    const displaced = (j) => {
      let k = j - 1;
      while (k >= 0 && !live(k)) k -= 1;
      return k < 0 ? at[j] !== 0 : at[k] < 0 || at[k] !== at[j] - 1;
    };
    for (let pass = 0; pass < DL_RICH_WRITE.passes; pass += 1) {
      const { ok, same, bad } = readBack(made.text, made.blocks);
      if (ok) return result(made.text, { same, alone, reads, blocks: made.blocks });
      if (!bad) break;
      let next = null;
      const soft = bad.filter((j) => at[j] < 0 && !forced[j]); // written blocks first: a blank line on both sides
      if (soft.length) {
        for (const j of soft) forced[j] = 1;
        next = build();
        if (next.text === made.text) next = null;
      }
      if (!next) { // then kept blocks, written alone: those that stand in a new place first, the others only if that was not enough
        const kept = bad.filter((j) => at[j] >= 0);
        const hard = kept.some(displaced) ? kept.filter(displaced) : kept;
        if (!hard.length) break;
        for (const j of hard) { write(j); forced[j] = 1; alone += 1; }
        next = build();
      }
      made = next;
    }
    return wholeText(first);
  }
