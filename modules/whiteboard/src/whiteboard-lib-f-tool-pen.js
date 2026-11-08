  // ---- whiteboard-lib-f-tool-pen.js: draw freehand --------------------------------------------------------------------
  // Press and drag to draw. The stroke shows as it is drawn and is saved whole, every point, when the pen lifts.
  {
    let drawing = null; // { id, points }
    tools.register({
      id: 'pen',
      label: 'Pen',
      icon: 'pen',
      key: 'p',
      order: 20,
      edits: true,
      cursor: 'crosshair',
      down(p, ctx) {
        const b = ctx.draft('stroke', { x: p.x, y: p.y, points: [0, 0] });
        drawing = { id: b.id, ox: p.x, oy: p.y, points: [0, 0] };
      },
      move(p, ctx) {
        if (!drawing) return;
        const n = drawing.points.length;
        const dx = p.x - drawing.ox; const dy = p.y - drawing.oy;
        if (Math.hypot(dx - drawing.points[n - 2], dy - drawing.points[n - 1]) * ctx.scale() < 2) return;
        if (n + 2 > WB_LIMITS.numbers * 4) return; // a very long stroke stops growing; simplify brings it under the limit
        drawing.points.push(Math.round(dx * 10) / 10, Math.round(dy * 10) / 10);
        ctx.change(drawing.id, { points: drawing.points.slice() }, { save: false });
      },
      up(p, ctx) {
        if (!drawing) return;
        const points = blockTypes.get('stroke').simplify(drawing.points);
        ctx.change(drawing.id, { points }, { save: 'now' });
        drawing = null;
      },
      cancel(ctx) { if (drawing) ctx.discard(drawing.id); drawing = null; },
      deactivate(ctx) { this.cancel(ctx); },
    });
  }
