  // ---- whiteboard-lib-f-tool-table.js: put a table on the board -----------------------------------------------------------
  // Click the board for a table of 3 columns and 3 rows centred there, or drag to give it a size (the columns share the
  // width, the rows the height, each kept to its least size); it is saved with its first cell's words, once they are
  // typed, and the tool goes back to Select. In the toolbar's Flowchart menu (the tool switch holds eight), key G. With Snap
  // to grid (ctx.snapping, turned round while Alt is held) its corners go on the grid, like a rectangle's.
  {
    let drag = null; // { id, x, y, sx, sy, moved }
    const on = (q, ctx) => (ctx.snapping(q.event) ? { ...q, x: wbSnap(q.x), y: wbSnap(q.y) } : q);
    const sized = (p) => {
      const n = WB_TABLE.usualCols;
      const m = WB_TABLE.usualRows;
      const w = Math.max(WB_TABLE.colMin * n, Math.abs(p.x - drag.x));
      const h = Math.abs(p.y - drag.y);
      const col = Math.round((w / n) * 10) / 10;
      const row = h > WB_TABLE.rowMin * m ? Math.round((h / m) * 10) / 10 : null;
      return {
        x: p.x < drag.x ? drag.x - w : drag.x,
        y: p.y < drag.y ? drag.y - Math.max(h, WB_TABLE.rowMin * m) : drag.y,
        cols: Array(n).fill(col),
        rows: Array(m).fill(row),
      };
    };
    tools.register({
      id: 'table',
      label: 'Table',
      icon: 'table',
      key: 'g',
      order: 95.5,
      group: 'flowchart',
      edits: true,
      makes: 'table',
      cursor: 'crosshair',
      down(q, ctx) {
        const p = on(q, ctx);
        const b = ctx.draft('table', { x: p.x, y: p.y });
        drag = { id: b.id, x: p.x, y: p.y, sx: p.sx, sy: p.sy, moved: false };
      },
      move(p, ctx) {
        if (!drag) return;
        if (!drag.moved && Math.hypot(p.sx - drag.sx, p.sy - drag.sy) < 6) return;
        drag.moved = true;
        ctx.change(drag.id, sized(on(p, ctx)), { save: false });
      },
      up(p, ctx) {
        if (!drag) return;
        const { id } = drag;
        if (!drag.moved) {
          const own = blockTypes.get('table').create();
          const at = { x: drag.x - own.w / 2, y: drag.y - (WB_TABLE.rowMin * own.rows.length) / 2 };
          if (ctx.snapping(p.event)) { at.x = wbSnap(at.x); at.y = wbSnap(at.y); }
          ctx.change(id, at, { save: false });
        }
        drag = null;
        ctx.select(id);
        ctx.setTool('select');
        ctx.edit(id, { fresh: true }); // its first cell; saved when that editing ends
      },
      cancel(ctx) { if (drag) ctx.discard(drag.id); drag = null; },
      deactivate(ctx) { this.cancel(ctx); },
    });
  }
