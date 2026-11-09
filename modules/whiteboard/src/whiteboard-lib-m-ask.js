  // ---- whiteboard-lib-m-ask.js: the picked blocks' words, as one question for the Assistant --------------------------------
  // Send to Assistant (the right-click menu) asks in the space's Chat (host.chat.ask) with the words of the picked blocks,
  // and nothing else: no picture, no pointers (a block is not an object). The words are the person's own, with no lead-in.
  //   A note, a text block, a shape: its words as plain text (the markup's marks taken out, its lines kept).
  //   A picture: its description. A connector: its label. A table: one line per row, its cells joined by " | ".
  //   A line, a stroke, a highlight, a timer: nothing (they have no words).
  // The blocks go in reading order: top to bottom, and left to right along a line. Blocks are on one line when each
  // starts above the middle of the first one on it. (Not the order they are stacked in, which is the order they were made
  // or layered, not how a person reads the board.) Each block's words are one paragraph: a blank line between blocks.
  // WB_ASK.max is the most a question may be, counted as Chat counts it (characters, so an emoji is one); the host also
  // cuts a question at 1000 units of the browser's string (an emoji is two), so both are kept to.
  const WB_ASK = { max: 1000, omit: new Set(['line', 'stroke', 'highlight', 'timer']) };
  // Plain text with its lines kept: each line's spaces made one, blank lines at most one in a row.
  const wbAskLines = (text) => {
    const t = typeof text === 'string' ? text : '';
    const out = wbMarkup.plain ? wbMarkup.plain(t) : t;
    return String(out).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  };
  // One block's words, or '' when it has none.
  function wbAskWords(b) {
    if (!b || WB_ASK.omit.has(b.type)) return '';
    if (b.type === 'table') {
      const rows = Array.isArray(b.cells) ? b.cells : [];
      return rows.map((row) => (Array.isArray(row) ? row : []).map((c) => wbPlain(c)))
        .map((cells) => { const r = cells.slice(); while (r.length && !r[r.length - 1]) r.pop(); return r; })
        .filter((cells) => cells.length).map((cells) => cells.join(' | ')).join('\n');
    }
    if (b.type === 'image') return String(b.alt || '').replace(/\s+/g, ' ').trim();
    if (b.type === 'connector') return String(b.label || '').replace(/\s+/g, ' ').trim();
    return typeof b.text === 'string' ? wbAskLines(b.text) : '';
  }
  // Reading order of [{ block, rect }] (rect { x0, y0, x1, y1 } on the board, or null: last, in the order given).
  function wbAskOrder(list) {
    const placed = list.filter((x) => x.rect && Number.isFinite(x.rect.y0) && Number.isFinite(x.rect.x0));
    const rest = list.filter((x) => !placed.includes(x));
    const byTop = placed.slice().sort((a, b) => a.rect.y0 - b.rect.y0 || a.rect.x0 - b.rect.x0);
    const lines = [];
    for (const x of byTop) {
      const line = lines[lines.length - 1];
      const first = line && line[0].rect;
      if (first && x.rect.y0 < (first.y0 + first.y1) / 2) line.push(x);
      else lines.push([x]);
    }
    return [...lines.flatMap((line) => line.sort((a, b) => a.rect.x0 - b.rect.x0)), ...rest];
  }
  // The question: { text, count, over }. count is in characters as Chat counts them; over is how many too many (0: fits).
  function wbAskText(list) {
    const text = wbAskOrder(list).map((x) => wbAskWords(x.block)).filter(Boolean).join('\n\n');
    const count = [...text].length;
    const over = Math.max(0, count - WB_ASK.max, text.length - WB_ASK.max);
    return { text, count, over };
  }
