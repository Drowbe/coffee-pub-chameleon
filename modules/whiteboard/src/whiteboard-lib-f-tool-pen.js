  // ---- whiteboard-lib-f-tool-pen.js: draw freehand, with a pen, a marker or a brush ------------------------------------
  // Press and drag to draw. The stroke shows as it is drawn and is saved whole, every point, when the pen lifts; the tool
  // stays on for the next stroke. Each kind is one entry in KINDS: each is a kind of the Pen tool in the tool switch (FAMILIES in whiteboard.js). `usual`: the width a kind draws at until the person picks one.
  // The Brush follows the pressure where the device reports one (a pen, a finger on a screen that senses force): its
  // widths, one per point. Where every point has the same pressure (a mouse), it keeps none, and the stroke is even.
  {
    const KINDS = [
      { id: 'pen', label: 'Pen', icon: 'pen', key: 'p', order: 20, usual: 3 },
      { id: 'marker', label: 'Marker', icon: 'marker', key: 'm', order: 97, usual: 12 },
      { id: 'brush', label: 'Brush', icon: 'paintbrush', order: 98, usual: 8 },
    ];
    // A pointer's pressure as a width in percent: a light touch is a third of the full width, a hard press all of it.
    const widthOf = (p) => {
      const e = p.event;
      const v = e && typeof e.pressure === 'number' && Number.isFinite(e.pressure) ? e.pressure : 0;
      return Math.max(1, Math.min(100, Math.round(30 + 70 * Math.min(1, Math.max(0, v)))));
    };
    const senses = (p) => p.pointerType === 'pen' || p.pointerType === 'touch';
    for (const k of KINDS) {
      let drawing = null; // { id, ox, oy, points, widths }
      tools.register({
        id: k.id,
        label: k.label,
        icon: k.icon,
        key: k.key,
        order: k.order,
        edits: true,
        makes: 'stroke',
        usual: { brush: k.id, weight: k.usual },
        cursor: 'crosshair',
        down(p, ctx) {
          const b = ctx.draft('stroke', { x: p.x, y: p.y, points: [0, 0], brush: k.id });
          drawing = { id: b.id, ox: p.x, oy: p.y, points: [0, 0], widths: k.id === 'brush' && senses(p) ? [widthOf(p)] : null };
        },
        move(p, ctx) {
          if (!drawing) return;
          const n = drawing.points.length;
          const dx = p.x - drawing.ox; const dy = p.y - drawing.oy;
          if (Math.hypot(dx - drawing.points[n - 2], dy - drawing.points[n - 1]) * ctx.scale() < 2) return;
          if (n + 2 > WB_LIMITS.numbers * 4) return; // a very long stroke stops growing; simplify brings it under the limit
          drawing.points.push(Math.round(dx * 10) / 10, Math.round(dy * 10) / 10);
          if (drawing.widths) drawing.widths.push(widthOf(p));
          const live = { points: drawing.points.slice() };
          if (drawing.widths && drawing.points.length <= blockTypes.get('stroke').maxWide) live.widths = drawing.widths.slice();
          ctx.change(drawing.id, live, { save: false });
        },
        up(p, ctx) {
          if (!drawing) return;
          const d = drawing;
          drawing = null;
          const b = ctx.get(d.id);
          // Widths only where the pressure changed along the stroke.
          const varied = d.widths && d.widths.some((w) => w !== d.widths[0]);
          const out = blockTypes.get('stroke').simplify(d.points, varied ? d.widths : null, b ? b.weight : k.usual);
          ctx.change(d.id, { points: out.points, widths: out.widths }, { save: 'now' });
        },
        cancel(ctx) { if (drawing) ctx.discard(drawing.id); drawing = null; },
        deactivate(ctx) { this.cancel(ctx); },
      });
    }
  }
