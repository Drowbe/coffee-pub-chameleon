  // ---- whiteboard-lib-e-block-table.js: a table of words in rows and columns ---------------------------------------------
  // { ...block, w, cols, rows, cells, head, fill, stroke, ink, weight, size, align }: a grid of cells, each holding words in
  // markup (as a note's: bold, italic, code, lists, links), drawn through wbShowWords only.
  //   cols: each column's width in board units (WB_TABLE.colMin to colMax); w is always their sum (worked out, never trusted).
  //   rows: each row's height, or null for "as tall as its words"; a height is the least it is, so a row never hides its
  //     words (a row grows to fit). The heights a row is drawn at are measured on the page, never saved.
  //   cells: the words, row by row (cells[r][c]); kept small: empty cells at the end of a row and empty rows at the end are
  //     left out, the grid's shape is cols x rows.
  //   head: the first row is a header (its own light background and bold words).
  // fill is the cells' background ('none': the board's own colour), stroke the grid lines and the outer border (none: no
  // lines), ink the words, weight the lines' width; size and align are the body's words, for the whole table.
  //
  // One table is one stored value, so it always fits the storage limit (60 KB a value): at most 20 columns and 50 rows,
  // 500 characters a cell, and all the cells' text together at most WB_TABLE.textMax characters as it is stored (JSON).
  // clean() enforces every limit, so whatever is read is drawn safely; the operations below (insert, delete, a cell's
  // words) are plain functions of the block, tested on their own, that give back the fields to change.
  //
  // The page does the rest: which cell is being edited or is the active one (a mark on the cell, never saved), the
  // right-click menu's Copy, Cut and Paste of a cell's words, and the merge when someone else changes the table while a
  // cell is edited (the edited cell is written into the newest table: wbTableSetCell).
  const WB_TABLE = {
    maxCols: 20,
    maxRows: 50,
    cellMax: 500, // characters in one cell
    textMax: 48000, // the cells as stored (JSON characters), all together: the whole value stays under about 50 KB
    colMin: 60,
    colMax: 800,
    rowMin: 32,
    rowMax: 800,
    colUsual: 120,
    usualCols: 3,
    usualRows: 3,
  };
  const wbClamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const wbTenth = (n) => Math.round(n * 10) / 10;
  const wbSum = (list) => list.reduce((a, n) => a + (n || 0), 0);
  // A cell's words made safe: a string, line ends as \n, no control characters but the line end (a tab is a space), at
  // most cellMax characters.
  function wbCellText(v) {
    if (typeof v !== 'string') return '';
    // eslint-disable-next-line no-control-regex
    return v.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, WB_TABLE.cellMax);
  }
  // The words of one cell, '' when it is empty or outside the grid.
  const wbCellOf = (b, r, c) => (b && Array.isArray(b.cells) && Array.isArray(b.cells[r]) && typeof b.cells[r][c] === 'string' ? b.cells[r][c] : '');
  // The grid made compact: empty cells at the end of each row, and empty rows at the end, left out.
  function wbTrimCells(cells) {
    const out = cells.map((row) => { const r = row.slice(); while (r.length && !r[r.length - 1]) r.pop(); return r; });
    while (out.length && !out[out.length - 1].length) out.pop();
    return out;
  }
  // The cells of a table cleaned to its shape (nRows x nCols), every cell cleaned, and the whole kept to textMax as it is
  // stored: a cell past the limit is cut to what fits, every cell after it left empty. { cells, cut }.
  function wbFitCells(raw, nRows, nCols) {
    const src = Array.isArray(raw) ? raw : [];
    let used = 2; // the outer [ ]
    let cut = false;
    const cells = [];
    for (let r = 0; r < nRows; r += 1) {
      const row = Array.isArray(src[r]) ? src[r] : [];
      const out = [];
      used += 3; // a row's [ ] and the comma after it
      for (let c = 0; c < nCols; c += 1) {
        let t = wbCellText(row[c]);
        if (t && cut) t = '';
        if (t) {
          let cost = JSON.stringify(t).length + 1;
          if (used + cost > WB_TABLE.textMax) {
            cut = true;
            // As much of it as fits (a quote or a line end takes two characters when stored).
            t = t.slice(0, Math.max(0, WB_TABLE.textMax - used - 3));
            while (t && used + JSON.stringify(t).length + 1 > WB_TABLE.textMax) t = t.slice(0, -1);
            cost = JSON.stringify(t).length + 1;
          }
          used += t ? cost : 3;
        } else used += 3;
        out.push(t);
      }
      cells.push(out);
    }
    return { cells: wbTrimCells(cells), cut };
  }
  // A table's own fields read from anything, every limit kept: { w, cols, rows, cells, head }. A list that is not one, or
  // is empty, is the usual 3 x 3; a column or a row past the limits is left out; a width or height out of range is put in
  // range (a column's that is not a number is the usual width; a row's is "as tall as its words").
  function wbTableClean(raw) {
    const colsIn = Array.isArray(raw.cols) && raw.cols.length ? raw.cols.slice(0, WB_TABLE.maxCols) : null;
    const rowsIn = Array.isArray(raw.rows) && raw.rows.length ? raw.rows.slice(0, WB_TABLE.maxRows) : null;
    const cols = colsIn
      ? colsIn.map((v) => (typeof v === 'number' && Number.isFinite(v) ? wbTenth(wbClamp(v, WB_TABLE.colMin, WB_TABLE.colMax)) : WB_TABLE.colUsual))
      : Array(WB_TABLE.usualCols).fill(WB_TABLE.colUsual);
    const rows = rowsIn
      ? rowsIn.map((v) => (typeof v === 'number' && Number.isFinite(v) ? wbTenth(wbClamp(v, WB_TABLE.rowMin, WB_TABLE.rowMax)) : null))
      : Array(WB_TABLE.usualRows).fill(null);
    const { cells } = wbFitCells(raw.cells, rows.length, cols.length);
    return { w: wbTenth(wbSum(cols)), cols, rows, cells, head: typeof raw.head === 'boolean' ? raw.head : true };
  }
  // The grid as a full rows x cols list of strings (for the operations below, which then leave the trimming to clean).
  function wbFullCells(b) {
    return b.rows.map((_, r) => b.cols.map((__, c) => wbCellOf(b, r, c)));
  }
  // The operations: each gives the fields to change (one save), or { refuse: words } when it cannot be done.
  function wbTableInsertRow(b, at) {
    if (b.rows.length >= WB_TABLE.maxRows) return { refuse: `A table can have at most ${WB_TABLE.maxRows} rows.` };
    const i = wbClamp(at, 0, b.rows.length);
    const rows = b.rows.slice(); rows.splice(i, 0, null);
    const cells = wbFullCells(b); cells.splice(i, 0, b.cols.map(() => ''));
    return { rows, cells: wbTrimCells(cells) };
  }
  function wbTableDeleteRow(b, at) {
    if (b.rows.length <= 1) return { refuse: 'A table needs at least one row.' };
    const i = wbClamp(at, 0, b.rows.length - 1);
    const rows = b.rows.slice(); rows.splice(i, 1);
    const cells = wbFullCells(b); cells.splice(i, 1);
    return { rows, cells: wbTrimCells(cells) };
  }
  function wbTableInsertCol(b, at) {
    if (b.cols.length >= WB_TABLE.maxCols) return { refuse: `A table can have at most ${WB_TABLE.maxCols} columns.` };
    const j = wbClamp(at, 0, b.cols.length);
    const cols = b.cols.slice(); cols.splice(j, 0, WB_TABLE.colUsual);
    const cells = wbFullCells(b).map((row) => { const r = row.slice(); r.splice(j, 0, ''); return r; });
    return { cols, w: wbSum(cols), cells: wbTrimCells(cells) };
  }
  function wbTableDeleteCol(b, at) {
    if (b.cols.length <= 1) return { refuse: 'A table needs at least one column.' };
    const j = wbClamp(at, 0, b.cols.length - 1);
    const cols = b.cols.slice(); cols.splice(j, 1);
    const cells = wbFullCells(b).map((row) => { const r = row.slice(); r.splice(j, 1); return r; });
    return { cols, w: wbSum(cols), cells: wbTrimCells(cells) };
  }
  // One cell's words put into a table (the newest one there is: what someone else changed meanwhile stays), cut to what
  // the table can still hold. { cells, cut } or null when that cell is no longer in the table.
  function wbTableSetCell(b, r, c, text) {
    if (!b || r < 0 || c < 0 || r >= b.rows.length || c >= b.cols.length) return null;
    const cells = wbFullCells(b);
    cells[r][c] = wbCellText(text);
    // The others first, so a cell that does not fit is this one, cut, never someone else's.
    const others = cells.map((row, i) => row.map((t, j) => (i === r && j === c ? '' : t)));
    const spare = WB_TABLE.textMax - JSON.stringify(wbTrimCells(others)).length - 4;
    let t = cells[r][c];
    let cut = false;
    if (t && JSON.stringify(t).length > spare) { t = t.slice(0, Math.max(0, spare - 2)); cut = true; }
    while (t && JSON.stringify(t).length > spare) t = t.slice(0, -1);
    cells[r][c] = t;
    return { cells: wbTrimCells(cells), cut };
  }
  // The cell Tab (dir 'next'), Shift Tab ('prev') and Enter ('down') go to from r, c: { r, c, grow? } (grow: Tab on the
  // last cell, a row is added first), or null when there is nowhere to go.
  function wbTableStep(b, r, c, dir) {
    const nr = b.rows.length;
    const nc = b.cols.length;
    if (dir === 'next') {
      if (c + 1 < nc) return { r, c: c + 1 };
      if (r + 1 < nr) return { r: r + 1, c: 0 };
      return nr < WB_TABLE.maxRows ? { r: r + 1, c: 0, grow: true } : null;
    }
    if (dir === 'prev') {
      if (c > 0) return { r, c: c - 1 };
      return r > 0 ? { r: r - 1, c: nc - 1 } : null;
    }
    if (dir === 'down') return r + 1 < nr ? { r: r + 1, c } : null;
    if (dir === 'up') return r > 0 ? { r: r - 1, c } : null;
    if (dir === 'left') return c > 0 ? { r, c: c - 1 } : null;
    if (dir === 'right') return c + 1 < nc ? { r, c: c + 1 } : null;
    return null;
  }
  // A whole table scaled to a new box (a corner handle): each column by the new width's share, each row by the new
  // height's (rows given the height they were drawn at, start.heights), each kept to its own limits; the side that is not
  // dragged stays where it was. With the height as it was, the rows are left as they are (a row as tall as its words
  // stays so). start: the table when the drag began, with w and h as drawn and heights; box: { x, y, w, h }.
  function wbTableScale(start, box) {
    const fx = box.w / Math.max(1, start.w);
    const cols = start.cols.map((c) => wbTenth(wbClamp(c * fx, WB_TABLE.colMin, WB_TABLE.colMax)));
    const sw = wbSum(cols);
    const x = Math.abs(box.x - start.x) < 0.05 ? start.x : wbTenth(start.x + start.w - sw);
    let rows = start.rows.slice();
    let y = start.y;
    if (typeof box.h === 'number' && start.h > 0 && Math.abs(box.h - start.h) > 0.5) {
      const fy = box.h / start.h;
      const heights = Array.isArray(start.heights) && start.heights.length === start.rows.length ? start.heights : start.rows.map((h) => h || WB_TABLE.rowMin);
      rows = heights.map((h) => wbTenth(wbClamp(h * fy, WB_TABLE.rowMin, WB_TABLE.rowMax)));
      y = Math.abs(box.y - start.y) < 0.05 ? start.y : wbTenth(start.y + start.h - wbSum(rows));
    }
    return { x, y, cols, w: wbTenth(sw), rows };
  }
  // A column's right line dragged to x (a point on the board): its new width. A row's bottom line dragged to y, where its
  // top is at `top`: its new height.
  function wbTableColTo(b, k, x) {
    const cols = b.cols.slice();
    cols[k] = wbTenth(wbClamp(x - (b.x + wbSum(b.cols.slice(0, k))), WB_TABLE.colMin, WB_TABLE.colMax));
    return { cols, w: wbTenth(wbSum(cols)) };
  }
  function wbTableRowTo(b, k, y, top) {
    const rows = b.rows.slice();
    rows[k] = wbTenth(wbClamp(y - top, WB_TABLE.rowMin, WB_TABLE.rowMax));
    return { rows };
  }
  // The table's name for a screen reader: its size, and the header's words.
  function wbTableName(b) {
    const n = (k, one) => `${k} ${one}${k === 1 ? '' : 's'}`;
    const words = `Table, ${n(b.rows.length, 'row')} by ${n(b.cols.length, 'column')}`;
    const head = b.head ? b.cols.map((_, c) => wbPlain(wbCellOf(b, 0, c))).filter(Boolean).join(', ') : '';
    return head ? `${words}: ${head.slice(0, 100)}` : words;
  }

  {
    // The cell (a td) a pointer or a node is in, as { r, c }, or null.
    const cellAt = (node) => {
      const td = node && node.closest ? node.closest('td[data-r]') : null;
      return td ? { r: Number(td.dataset.r), c: Number(td.dataset.c) } : null;
    };
    const cellEl = (el, r, c) => {
      const tr = el && el.querySelector('tbody') ? el.querySelector('tbody').rows[r] : null;
      return tr ? tr.cells[c] || null : null;
    };
    // The active cell (the page's: data-cell="r,c" on the block, while a person moves round the cells or edits one).
    const markCell = (el) => {
      const was = el.querySelector('td.wb-cell-on');
      const at = el.dataset.cell ? el.dataset.cell.split(',').map(Number) : null;
      const td = at ? cellEl(el, at[0], at[1]) : null;
      if (was && was !== td) was.classList.remove('wb-cell-on');
      if (td) td.classList.add('wb-cell-on');
    };
    blockTypes.register({
      type: 'table',
      label: 'Table',
      edit: 'cells',
      markup: true,
      role: 'group',
      paint: { stroke: { label: 'Lines', extra: ['none'] }, fill: { extra: ['none'] }, ink: {} },
      weight: true,
      create: () => ({
        w: WB_TABLE.colUsual * WB_TABLE.usualCols,
        cols: Array(WB_TABLE.usualCols).fill(WB_TABLE.colUsual),
        rows: Array(WB_TABLE.usualRows).fill(null),
        cells: [],
        head: true,
        fill: 'none',
        stroke: 'ink',
        ink: 'ink',
        weight: 1,
        size: 'small',
        align: 'left',
      }),
      clean: (raw) => wbTableClean(raw),
      box: (b) => ({ x: 0, y: 0, w: b.w, h: null }), // the rows' words set the height: measured on the page
      // Its place and its grid: a resize changes x, y, w and the sizes, a new row the rows and the cells. An undo puts back
      // only the fields its change changed (lib-g), so a move's undo is still only x and y.
      linked: [['x', 'y', 'w', 'cols', 'rows', 'cells']],
      resize: {
        handles: 'corners',
        min: { w: WB_TABLE.colMin, h: WB_TABLE.rowMin },
        minOf: (b) => ({ w: WB_TABLE.colMin * b.cols.length, h: WB_TABLE.rowMin * b.rows.length }),
        // What the drag starts from: the height and each row's height as they are drawn.
        measure: (b, el) => {
          const body = el && el.querySelector('tbody');
          const heights = body ? [...body.rows].map((tr) => tr.offsetHeight) : [];
          return { h: el ? el.offsetHeight : wbSum(b.rows.map((h) => h || WB_TABLE.rowMin)), heights };
        },
        scale: (start, box) => wbTableScale(start, box),
      },
      // The handles beside the corners, for the one table picked: a grab bar on each line between two columns and two
      // rows (drag to change that column's or row's size), and a + below the last row and right of the last column.
      grips(b, el) {
        if (!el) return [];
        const W = el.offsetWidth;
        const H = el.offsetHeight;
        const out = [];
        let x = 0;
        for (let k = 0; k < b.cols.length - 1; k += 1) { x += b.cols[k]; out.push({ id: `col-${k}`, x, y: H / 2, kind: 'col', len: H }); }
        const body = el.querySelector('tbody');
        const trs = body ? [...body.rows] : [];
        for (let k = 0; k < trs.length - 1; k += 1) out.push({ id: `row-${k}`, x: W / 2, y: trs[k].offsetTop + trs[k].offsetHeight, kind: 'row', len: W });
        out.push({ id: 'add-row', x: W / 2, y: H, oy: 2, kind: 'add' });
        out.push({ id: 'add-col', x: W, y: H / 2, ox: 2, kind: 'add' });
        return out;
      },
      // Where a row's top is when its line is pressed (rows above it are drawn as tall as their words).
      gripBase(b, id, el) {
        const m = /^row-(\d+)$/.exec(id);
        const tr = m && el && el.querySelector('tbody') ? el.querySelector('tbody').rows[Number(m[1])] : null;
        return tr ? { top: b.y + tr.offsetTop } : null;
      },
      grip(b, id, at, base) {
        let m = /^col-(\d+)$/.exec(id);
        if (m && Number(m[1]) < b.cols.length) return wbTableColTo(b, Number(m[1]), at.x);
        m = /^row-(\d+)$/.exec(id);
        if (m && base && Number(m[1]) < b.rows.length) return wbTableRowTo(b, Number(m[1]), at.y, base.top);
        return {};
      },
      // A press on a + without a drag: a row at the bottom, a column at the right.
      tap(b, id) {
        if (id === 'add-row') return wbTableInsertRow(b, b.rows.length);
        if (id === 'add-col') return wbTableInsertCol(b, b.cols.length);
        return null;
      },
      // The right-click menu's entries for a cell ({ r, c }): each one save, or a short note when it cannot be done.
      actions(b, cell) {
        const at = cell || { r: 0, c: 0 };
        return [
          { id: 'row-above', label: 'Insert row above', icon: 'arrow-up', fields: wbTableInsertRow(b, at.r) },
          { id: 'row-below', label: 'Insert row below', icon: 'arrow-down', fields: wbTableInsertRow(b, at.r + 1) },
          { id: 'col-left', label: 'Insert column left', icon: 'arrow-left', fields: wbTableInsertCol(b, at.c) },
          { id: 'col-right', label: 'Insert column right', icon: 'arrow-right', fields: wbTableInsertCol(b, at.c + 1) },
          { id: 'row-delete', label: 'Delete row', icon: 'trash-can', fields: wbTableDeleteRow(b, at.r) },
          { id: 'col-delete', label: 'Delete column', icon: 'trash-can', fields: wbTableDeleteCol(b, at.c) },
          { id: 'head', label: 'Header row', icon: 'heading', current: b.head, ariaLabel: `Header row, ${b.head ? 'on' : 'off'}`, fields: { head: !b.head } },
          { id: 'clear', label: 'Clear cell', icon: 'eraser', disabled: !wbCellOf(b, at.r, at.c), fields: wbTableSetCell(b, at.r, at.c, '') || {} },
        ];
      },
      cellAt,
      cellEl,
      markCell,
      cellOf: wbCellOf,
      step: wbTableStep,
      setCell: wbTableSetCell,
      cellMax: WB_TABLE.cellMax,
      // Drawn in place: the same rows and cells stay (only what changed is drawn again), so a cell being edited keeps its
      // text box when the table changes under it (someone else's change, while this person types).
      render(b, el) {
        let tbl = el.querySelector(':scope > table');
        if (!tbl) {
          tbl = document.createElement('table');
          tbl.className = 'wb-tbl';
          tbl.append(document.createElement('colgroup'), document.createElement('tbody'));
          el.replaceChildren(tbl);
        }
        const [group, body] = tbl.children;
        while (group.children.length < b.cols.length) group.append(document.createElement('col'));
        while (group.children.length > b.cols.length) group.lastChild.remove();
        b.cols.forEach((w, c) => { group.children[c].style.width = `${w}px`; });
        tbl.style.width = `${b.w}px`;
        while (body.rows.length < b.rows.length) body.append(document.createElement('tr'));
        while (body.rows.length > b.rows.length) body.lastChild.remove();
        b.rows.forEach((h, r) => {
          const tr = body.rows[r];
          tr.style.height = `${h || WB_TABLE.rowMin}px`; // a least height: a row grows to fit its words
          const head = b.head && r === 0;
          tr.classList.toggle('wb-head', head);
          while (tr.cells.length < b.cols.length) {
            const td = document.createElement('td');
            const words = document.createElement('div');
            words.className = 'wb-words';
            td.append(words);
            tr.append(td);
          }
          while (tr.cells.length > b.cols.length) tr.lastChild.remove();
          [...tr.cells].forEach((td, c) => {
            td.dataset.r = String(r);
            td.dataset.c = String(c);
            if (head) td.setAttribute('role', 'columnheader'); else td.removeAttribute('role');
            wbShowWords(td.querySelector(':scope > .wb-words'), wbCellOf(b, r, c));
          });
        });
        markCell(el);
      },
      describe: (b) => wbTableName(b),
    });
  }
