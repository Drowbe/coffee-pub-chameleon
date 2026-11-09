  // ---- whiteboard-lib-f-tool-frame.js: draw a frame ------------------------------------------------------------------------
  // Drag to draw it to size, or click for one of the usual size centred there; it goes under the other blocks (wbFrameZ,
  // the page's draft does it for a container), the tool goes back to Select and its title ("Frame") is opened for editing
  // at once; it is saved when that editing ends. With Snap to grid (ctx.snapping, turned round while Alt is held) its
  // corners go on the grid. In the toolbar's Flowchart menu, with the Table, key S.
  {
    let drag = null; // { id, x, y, sx, sy, moved }
    const on = (q, ctx) => (ctx.snapping(q.event) ? { ...q, x: wbSnap(q.x), y: wbSnap(q.y) } : q);
    tools.register({
      id: 'frame',
      label: 'Frame',
      icon: 'crop-simple',
      key: 's',
      order: 95.7,
      group: 'flowchart',
      edits: true,
      makes: 'frame',
      cursor: 'crosshair',
      down(q, ctx) {
        const p = on(q, ctx);
        const b = ctx.draft('frame', { x: p.x, y: p.y, w: WB_FRAME.min.w, h: WB_FRAME.min.h });
        drag = { id: b.id, x: p.x, y: p.y, sx: p.sx, sy: p.sy, moved: false };
      },
      move(q, ctx) {
        if (!drag) return;
        if (!drag.moved && Math.hypot(q.sx - drag.sx, q.sy - drag.sy) < 6) return;
        drag.moved = true;
        const p = on(q, ctx);
        const w = Math.max(WB_FRAME.min.w, Math.abs(p.x - drag.x));
        const h = Math.max(WB_FRAME.min.h, Math.abs(p.y - drag.y));
        ctx.change(drag.id, { x: p.x < drag.x ? drag.x - w : drag.x, y: p.y < drag.y ? drag.y - h : drag.y, w, h }, { save: false });
      },
      up(q, ctx) {
        if (!drag) return;
        const { id } = drag;
        if (!drag.moved) {
          const at = { x: drag.x - WB_FRAME.w / 2, y: drag.y - WB_FRAME.h / 2, w: WB_FRAME.w, h: WB_FRAME.h };
          if (ctx.snapping(q.event)) { at.x = wbSnap(at.x); at.y = wbSnap(at.y); }
          ctx.change(id, at, { save: false });
        }
        drag = null;
        ctx.select(id);
        ctx.setTool('select');
        ctx.edit(id, { fresh: true }); // its title; saved when that editing ends
      },
      cancel(ctx) { if (drag) ctx.discard(drag.id); drag = null; },
      deactivate(ctx) { this.cancel(ctx); },
    });
  }
