// ---- documents-lib-s-pages.js: where the automatic page breaks fall (Paper in the reading view; pure, no page, no host) ---------------
//
// The reader measures each top-level block as drawn (unscaled px, margins included) and hands the list here with the height of the
// page's text area (DL_PAGE_SIZES through dlPageGeometry: 864 px Letter, 931 px A4). Nothing returned is stored: it is worked out
// again from the text each time. Whole blocks move to the next page (decision 10); nothing is split inside a line.
//
// A block is { height, kind, rows? }, kind 'block' | 'grid' | 'code' | 'formula' | 'heading' | 'head' | 'pagebreak'. A 'head' is what stands
// above the text on the first page (the line under the title, the tags; in the editor the height of both): it is kept with what follows,
// as a heading is, and it is not text, so a break straight after it is still a break at the very start. A grid's rows are its row
// heights (the head row first); its total is `height` (whatever the rows do not add up to, the margin, goes to the last row).
//
// Rules, in the order they matter:
//  - A manual break (kind 'pagebreak') ends the page it is on. It has no height and is in no page's items; the page it ends lists it in
//    `breaks` (so the reader can keep a "Page break" separator for a screen reader). A break at the very start (after nothing but a 'head') makes no empty page and is
//    returned in `before`; a break at the very end makes none either (it ends the last page). Each further consecutive break makes one
//    empty page: a, break, break, b is [a] [] [b]; break, break, a is [] [a].
//  - A block that fits the space left goes there; otherwise it starts the next page. A block taller than a whole page gets a page of its
//    own (`tall`) and runs past the bottom margin, never clipped; only a heading before it may share that page.
//  - A grid breaks between rows, never inside one (the head row is not repeated). It moves whole when it fits on one page and the space
//    left is not enough for its head row and one more; otherwise its rows fill the space left, the rest goes on. An item of a split
//    grid is { i, from, to } (rows from..to-1); a whole block or grid is { i }.
//  - Code blocks and block formulas are whole blocks, like a paragraph.
//  - A heading is kept with what follows: a run of headings and the first thing after them (a grid's head row and one row) move together,
//    so a heading is never the last thing on a page, except before a manual break. Before a block taller than a page it goes with that block.
// -> { pages: [{ items: [{ i, from?, to? }], breaks: [i], tall }], before: [i] }
function dlPageBreaks(blocks, textH) {
  const list = Array.isArray(blocks) ? blocks : [];
  const pageH = Number.isFinite(textH) && textH > 0 ? textH : 1;
  const hOf = (b) => (b && Number.isFinite(b.height) && b.height > 0 ? b.height : 0);
  const rowsOf = (b) => {
    if (!b || b.kind !== 'grid' || !Array.isArray(b.rows) || !b.rows.length) return null;
    const r = b.rows.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
    const sum = r.reduce((a, x) => a + x, 0);
    if (hOf(b) > sum) r[r.length - 1] += hOf(b) - sum;
    return r;
  };
  const isBreak = (b) => Boolean(b) && b.kind === 'pagebreak';
  // What must fit with a heading: the first piece of the thing after it.
  const lead = (j) => {
    const b = list[j];
    if (!b || isBreak(b)) return 0;
    const r = rowsOf(b);
    const first = r ? r[0] + (r.length > 1 ? r[1] : 0) : hOf(b);
    return first > pageH ? pageH : first; // a block that is taller than a page starts its own page: its heading goes with it
  };
  const pages = [];
  const before = [];
  let cur = null;
  let leadingUsed = false;
  let text = false; // a block that is not a 'head' has come
  const start = () => { cur = { items: [], breaks: [], tall: false, used: 0, body: false, closed: false }; pages.push(cur); return cur; };
  const fresh = () => { if (!cur || cur.closed) start(); return cur; };
  for (let i = 0; i < list.length; i += 1) {
    const b = list[i];
    if (isBreak(b)) {
      if (!text && !leadingUsed) { before.push(i); leadingUsed = true; continue; }
      if (!cur) start();
      cur.breaks.push(i);
      cur = null;
      continue;
    }
    const kind = b && b.kind === 'head' ? 'heading' : b && b.kind;
    if (!(b && b.kind === 'head')) text = true;
    const rows = rowsOf(b);
    const h = rows ? rows.reduce((a, x) => a + x, 0) : hOf(b);
    if (kind === 'heading') {
      let need = 0;
      let j = i;
      while (j < list.length && list[j] && (list[j].kind === 'heading' || list[j].kind === 'head')) { need += hOf(list[j]); j += 1; }
      need += lead(j);
      if (cur && !cur.closed && cur.items.length && cur.used + need > pageH) cur = null;
    }
    if (h > pageH && !rows) { // taller than a page: a page of its own
      if (cur && cur.body) cur = null;
      fresh();
      cur.items.push({ i }); cur.used += h; cur.tall = true; cur.closed = true; cur.body = true;
      continue;
    }
    fresh();
    if (cur.used + h <= pageH && !(rows && h > pageH)) { // fits whole
      cur.items.push({ i }); cur.used += h; cur.body = cur.body || kind !== 'heading';
      continue;
    }
    if (!rows) { // moves whole to a new page
      cur = null; fresh();
      cur.items.push({ i }); cur.used += h; cur.body = kind !== 'heading';
      continue;
    }
    // a grid that does not fit the space left: its rows, page by page
    let from = 0;
    while (from < rows.length) {
      fresh();
      let avail = pageH - cur.used;
      let to = from;
      let sum = 0;
      while (to < rows.length && sum + rows[to] <= avail) { sum += rows[to]; to += 1; }
      const need = from === 0 && rows.length > 1 ? 2 : 1;
      if (to - from < need && cur.items.length) { cur = null; fresh(); avail = pageH; to = from; sum = 0; while (to < rows.length && sum + rows[to] <= avail) { sum += rows[to]; to += 1; } }
      if (to === from) { sum = rows[to]; to += 1; cur.tall = true; } // one row taller than a page
      cur.items.push(from === 0 && to === rows.length ? { i } : { i, from, to });
      cur.used += sum; cur.body = true;
      from = to;
      if (from < rows.length || cur.tall) cur.closed = true;
    }
  }
  return { pages: pages.map((p) => ({ items: p.items, breaks: p.breaks, tall: p.tall })), before };
}
