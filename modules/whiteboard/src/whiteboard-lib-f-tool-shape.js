  // ---- whiteboard-lib-f-tool-shape.js: draw a shape, a line or an arrow -------------------------------------------------
  // Drag to draw it to size, or click for one of the usual size; it is saved when the pointer lifts and the tool goes back
  // to Select. Another drawn shape is one more entry in SHAPE_TOOLS. The flowchart shapes are in the toolbar's Flowchart
  // menu (group), not the tool switch, which holds eight.
  {
    const SHAPE_TOOLS = [
      { id: 'rect', type: 'rect', label: 'Rectangle', icon: 'square', key: 'r', order: 50 },
      { id: 'ellipse', type: 'ellipse', label: 'Ellipse', icon: 'circle', key: 'o', order: 60 },
      { id: 'line', type: 'line', label: 'Line', icon: 'minus', key: 'l', order: 70, line: true },
      { id: 'arrow', type: 'line', label: 'Arrow', icon: 'arrow-right-long', key: 'a', order: 80, line: true, arrow: true },
      { id: 'rounded', type: 'rounded', label: 'Rounded box', icon: 'square', key: 'b', order: 92, group: 'flowchart' },
      { id: 'diamond', type: 'diamond', label: 'Diamond', icon: 'diamond', key: 'd', order: 93, group: 'flowchart' },
      { id: 'pill', type: 'pill', label: 'Pill', icon: 'capsules', order: 94, group: 'flowchart' },
      { id: 'parallelogram', type: 'parallelogram', label: 'Parallelogram', icon: 'arrow-right-arrow-left', order: 95, group: 'flowchart' },
    ];
    for (const t of SHAPE_TOOLS) {
      let drag = null; // { id, x, y, sx, sy, moved }
      const sized = (p) => {
        if (t.line) return { x: drag.x, y: drag.y, dx: p.x - drag.x, dy: p.y - drag.y };
        return { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.max(8, Math.abs(p.x - drag.x)), h: Math.max(8, Math.abs(p.y - drag.y)) };
      };
      tools.register({
        id: t.id,
        label: t.label,
        icon: t.icon,
        key: t.key,
        order: t.order,
        group: t.group,
        edits: true,
        makes: t.type,
        cursor: 'crosshair',
        down(p, ctx) {
          const b = ctx.draft(t.type, t.line ? { x: p.x, y: p.y, dx: 0, dy: 0, arrow: Boolean(t.arrow) } : { x: p.x, y: p.y, w: 8, h: 8 });
          drag = { id: b.id, x: p.x, y: p.y, sx: p.sx, sy: p.sy, moved: false };
        },
        move(p, ctx) {
          if (!drag) return;
          if (!drag.moved && Math.hypot(p.sx - drag.sx, p.sy - drag.sy) < 6) return;
          drag.moved = true;
          ctx.change(drag.id, sized(p), { save: false });
        },
        up(p, ctx) {
          if (!drag) return;
          const id = drag.id;
          if (!drag.moved) {
            const own = blockTypes.get(t.type).create();
            ctx.change(id, t.line ? { x: drag.x - own.dx / 2, y: drag.y, dx: own.dx, dy: 0 } : { x: drag.x - own.w / 2, y: drag.y - own.h / 2, w: own.w, h: own.h }, { save: false });
          }
          drag = null;
          ctx.save(id);
          ctx.select(id);
          ctx.setTool('select');
        },
        cancel(ctx) { if (drag) ctx.discard(drag.id); drag = null; },
        deactivate(ctx) { this.cancel(ctx); },
      });
    }
  }
