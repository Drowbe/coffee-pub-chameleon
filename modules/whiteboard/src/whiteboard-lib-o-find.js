  // ---- whiteboard-lib-o-find.js: Find in the board -----------------------------------------------------------------------
  //
  // Find (the title bar's menu, or the / key on the board) opens a bar at the top of the board that finds words in the
  // blocks: the words of notes, text and shapes (their markup read as plain words), frame titles, table cells, connector
  // labels and picture descriptions; not timers or drawings. It ignores case and accents, counts each block once however
  // often the words are in it, and goes through the blocks in reading order (top to bottom, then left to right). It only
  // reads the board, so someone who may only look can use it. The work is plain functions; whiteboard.js has the bar.
  const WB_FIND = {
    max: 100, // the most characters searched for
    wait: 250, // milliseconds: changes to the board are searched again this long after the last one
    say: 80, // the most characters of a block's words read out with a match
  };

  // Words as compared: lower case, without accents (é is e), spaces run together (a line break stays one: a table's
  // cells are on lines of their own).
  function wbFindFold(text) {
    return String(text == null ? '' : text).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\S\n]+/g, ' ');
  }
  // What was typed, as searched for: at most WB_FIND.max characters, on one line, folded, trimmed ('' searches for
  // nothing).
  const wbFindQuery = (typed) => wbFindFold(String(typed == null ? '' : typed).slice(0, WB_FIND.max).replace(/\s+/g, ' ')).trim();

  // The plain words of a block that Find reads, or '' for a block with none it searches (a timer, a drawing, a line). A
  // table's cells each on a line of their own, so a match never runs from one cell into the next.
  function wbFindWords(b) {
    const def = b && blockTypes.get(b.type);
    if (!def) return '';
    if (def.edit === 'cells') return (Array.isArray(b.cells) ? b.cells : []).flatMap((row) => (Array.isArray(row) ? row : [])).map((c) => wbPlain(c)).filter(Boolean).join('\n');
    if (def.markup) return wbPlain(b.text);
    if (def.textField) return String(b[def.textField] || '').replace(/\s+/g, ' ').trim(); // a frame's title, a label, a description
    return '';
  }

  // The blocks whose words hold the query, in reading order: [id]. at(b) -> where it is drawn ({ x, y }, its top left on
  // the board), or null for a block not drawn (it is left out). words(b): wbFindWords unless the page says otherwise.
  function wbFindMatches(blocks, typed, { at, words = wbFindWords } = {}) {
    const q = wbFindQuery(typed);
    if (!q) return [];
    const found = [];
    for (const b of blocks || []) {
      if (!wbFindFold(words(b)).includes(q)) continue;
      const p = at(b);
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) found.push({ id: b.id, x: p.x, y: p.y });
    }
    found.sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return found.map((f) => f.id);
  }

  // The next (dir 1) or previous (dir -1) match of n from i, round from the last to the first and back; -1 for none.
  function wbFindStep(i, n, dir) {
    if (!(n > 0)) return -1;
    if (!(i >= 0 && i < n)) return dir < 0 ? n - 1 : 0;
    return (((i + dir) % n) + n) % n;
  }
  // What the bar says: nothing before anything is typed, "No matches", or "2 of 7".
  function wbFindCount(typed, i, n) {
    if (!wbFindQuery(typed)) return '';
    return n > 0 ? `${Math.max(0, i) + 1} of ${n}` : 'No matches';
  }
  // What is read out for a match: "Match 2 of 7: the block's words" (cut short), or "No matches".
  function wbFindWordsSaid(i, n, words) {
    if (!(n > 0)) return 'No matches';
    const w = String(words || '').replace(/\s+/g, ' ').trim();
    const cut = w.length > WB_FIND.say ? `${w.slice(0, WB_FIND.say - 1).trimEnd()}…` : w;
    return `Match ${Math.max(0, i) + 1} of ${n}${cut ? `: ${cut}` : ''}`;
  }

  // The matches found again (the board changed): the one shown stays shown when it is still a match, else the match now
  // in its place (the last when there are fewer); -1 when there are none.
  function wbFindFollow(was, i, now) {
    if (!now.length) return -1;
    const id = i >= 0 ? was[i] : undefined;
    const kept = id === undefined ? -1 : now.indexOf(id);
    if (kept >= 0) return kept;
    return Math.min(Math.max(0, i), now.length - 1);
  }

  // Whether a key on the board opens Find: / with no Ctrl, Cmd or Alt (Shift is allowed: some keyboards need it for /),
  // and never while words are edited (a note's, a cell's, a frame's title, the formatting bar's), while presenting or
  // while a character is being composed.
  function wbFindKey(e, { editing = false, presenting = false } = {}) {
    if (!e || e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false;
    if (editing || presenting) return false;
    const t = e.target;
    if (t && t.closest && t.closest('.wb-text-edit, .wb-format, .wb-find, input, textarea, select, [contenteditable="true"]')) return false;
    return true;
  }

  // Where the view goes to show a block's box ({ x0, y0, x1, y1 }) on a W x H board from the view ({ x, y, s }): null when
  // it is in sight already (with `margin` screen pixels round it); else its middle in the middle, at the same zoom, or,
  // for a box too big to be seen whole at that zoom, zoomed out until it fits (never under min). It never zooms in.
  function wbFindView(r, view, W, H, { margin = 24, min = 0.2 } = {}) {
    const sx0 = r.x0 * view.s + view.x;
    const sy0 = r.y0 * view.s + view.y;
    const sx1 = r.x1 * view.s + view.x;
    const sy1 = r.y1 * view.s + view.y;
    if (sx0 >= margin && sy0 >= margin && sx1 <= W - margin && sy1 <= H - margin) return null;
    const bw = Math.max(1, r.x1 - r.x0);
    const bh = Math.max(1, r.y1 - r.y0);
    const fits = Math.min((W - margin * 2) / bw, (H - margin * 2) / bh);
    const s = Math.max(min, Math.min(view.s, fits));
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    return { x: W / 2 - cx * s, y: H / 2 - cy * s, s };
  }
