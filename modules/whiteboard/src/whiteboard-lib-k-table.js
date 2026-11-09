  // ---- whiteboard-lib-k-table.js: rows copied from a spreadsheet, read as a table's cells -----------------------------------
  //
  // A paste of rows and columns (Excel, Google Sheets, Numbers) makes a table (lib-e-block-table.js). The computer's
  // clipboard has them as plain text, a line a row and a tab between cells (a cell with a tab, a line end or a quote in it
  // in "double quotes", a quote in it doubled), and often as HTML with a <table> too. Only the words are ever read from the
  // HTML: it is parsed by the browser's DOMParser into a document that is never shown (no script in it runs and nothing in it
  // loads), its first table's own rows and cells are walked for their text (script, style and the like left out), and that
  // text is all that is kept. The HTML is never put anywhere. Plain arithmetic and text, tested on their own.
  const WB_PASTE_LIMITS = { text: 1000000, html: 2000000 }; // the most characters of text or HTML read
  // Whether pasted text is clearly rows and columns: a tab on at least half of the lines that have anything on them.
  function wbLooksTabular(text) {
    if (typeof text !== 'string' || !text.includes('\t')) return false;
    const lines = text.slice(0, WB_PASTE_LIMITS.text).replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n').filter((l) => l.trim());
    const tabbed = lines.filter((l) => l.includes('\t')).length;
    return tabbed > 0 && tabbed * 2 >= lines.length;
  }
  // Tab-separated text as rows of cells. Reads at most one row and one column past the table's limits (so a cut is seen).
  function wbParseTsv(text) {
    const s = String(text || '').slice(0, WB_PASTE_LIMITS.text).replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    const rows = [];
    let row = [];
    let i = 0;
    const sep = (k) => { let j = k; while (j < s.length && s[j] !== '\t' && s[j] !== '\n') j += 1; return j; };
    for (;;) {
      let cell;
      let quoted = false;
      if (s[i] === '"') {
        let j = i + 1;
        let buf = '';
        let closed = false;
        while (j < s.length) {
          if (s[j] === '"') {
            if (s[j + 1] === '"') { buf += '"'; j += 2; continue; }
            closed = true; j += 1; break;
          }
          buf += s[j]; j += 1;
        }
        if (closed && (j >= s.length || s[j] === '\t' || s[j] === '\n')) { cell = buf; i = j; quoted = true; }
      }
      if (!quoted) { const k = sep(i); cell = s.slice(i, k); i = k; }
      if (row.length <= WB_TABLE.maxCols) row.push(cell);
      if (i >= s.length) { rows.push(row); break; }
      if (s[i] === '\t') { i += 1; continue; }
      rows.push(row);
      row = [];
      i += 1;
      if (rows.length > WB_TABLE.maxRows) break;
    }
    return rows;
  }
  // The words of an HTML cell: its text, a line end for a <br> and between blocks (paragraphs, list entries), spaces run
  // together as a page shows them. What is never shown (script, style, template ...) is left out.
  const WB_HTML_SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'TITLE', 'HEAD', 'IFRAME', 'EMBED', 'SVG', 'MATH', 'SELECT', 'TEXTAREA', 'BUTTON']);
  const WB_HTML_BLOCK = /^(P|DIV|LI|TR|H[1-6]|BLOCKQUOTE|PRE|UL|OL|TABLE|SECTION|ARTICLE)$/;
  function wbHtmlText(node) {
    let out = '';
    const most = WB_TABLE.cellMax * 2;
    const walk = (n, depth) => {
      for (const ch of n.childNodes) {
        if (out.length > most || depth > 64) return;
        if (ch.nodeType === 3) { out += String(ch.nodeValue || '').replace(/\s+/g, ' '); continue; }
        if (ch.nodeType !== 1) continue;
        const tag = String(ch.tagName || '').toUpperCase();
        if (WB_HTML_SKIP.has(tag)) continue;
        if (tag === 'BR') { out += '\n'; continue; }
        const block = WB_HTML_BLOCK.test(tag);
        if (block && out && !out.endsWith('\n')) out += '\n';
        walk(ch, depth + 1);
        if (tag === 'TD' || tag === 'TH') out += ' ';
        if (block && out && !out.endsWith('\n')) out += '\n';
      }
    };
    walk(node, 0);
    return out.replace(/[  ]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  // The rows of cells of the first table in some HTML, or null when it has none. parse(html) -> a Document (the page
  // hands it DOMParser's). A cell that spans columns is followed by empty ones; one that spans rows is in its first row only.
  function wbGridFromHtml(html, parse) {
    if (typeof html !== 'string' || html.length > WB_PASTE_LIMITS.html || !/<table[\s>]/i.test(html)) return null;
    let doc = null;
    try { doc = parse(html); } catch { return null; }
    const tbl = doc && doc.querySelector ? doc.querySelector('table') : null;
    if (!tbl || !tbl.rows) return null;
    const grid = [];
    for (const tr of tbl.rows) { // its own rows only, never a table's inside a cell
      if (grid.length > WB_TABLE.maxRows) break;
      const row = [];
      for (const td of tr.cells) {
        if (row.length > WB_TABLE.maxCols) break;
        row.push(wbHtmlText(td));
        const span = Math.min(WB_TABLE.maxCols, Math.max(1, parseInt(td.getAttribute('colspan'), 10) || 1));
        for (let k = 1; k < span && row.length <= WB_TABLE.maxCols; k += 1) row.push('');
      }
      grid.push(row);
    }
    return grid.some((r) => r.length) ? grid : null;
  }
  // A table's fields for rows of cells ({ cols, rows, cells, head, cut }), within its limits: rows and columns past them
  // are left out, and a cell's words cut (cut: true says so). Each column is as wide as its longest line wants, roughly.
  function wbTableFromGrid(grid) {
    const nRows = Math.max(1, Math.min(WB_TABLE.maxRows, grid.length));
    const used = grid.slice(0, nRows);
    const nCols = Math.max(1, Math.min(WB_TABLE.maxCols, ...used.map((r) => r.length)));
    let cut = grid.length > WB_TABLE.maxRows || grid.some((r) => r.length > WB_TABLE.maxCols);
    if (used.some((r) => r.some((t) => typeof t === 'string' && wbCellText(t).length >= WB_TABLE.cellMax && t.length > WB_TABLE.cellMax))) cut = true;
    const fit = wbFitCells(used, nRows, nCols);
    const cols = [];
    for (let c = 0; c < nCols; c += 1) {
      let most = 0;
      for (let r = 0; r < nRows; r += 1) for (const line of wbCellOf(fit, r, c).split('\n')) most = Math.max(most, line.length);
      cols.push(wbClamp(Math.ceil(most * 7.5 + 20), Math.max(WB_TABLE.colMin, 80), 280));
    }
    return { cols, rows: Array(nRows).fill(null), cells: fit.cells, head: true, cut: cut || fit.cut };
  }
