  // ---- whiteboard-lib-f-tool-highlight.js: highlight what is on the board -----------------------------------------------
  // Press and drag over words or shapes to lay a see-through band over them, a highlight block of its own, on top of what
  // is there. Holding Shift makes it a straight band, across or down (the longer way from where it started). It shows as
  // it is drawn and is saved whole when the pointer lifts, its points thinned as a drawing's are; one undo step. The tool
  // stays on for the next one; Escape goes back to Select. In the toolbar's Paint menu (group 'paint'), key U. `usual`:
  // the width it draws at until the person picks one (Extra heavy, about a line of words high).
  {
    let drawing = null; // { id, ox, oy, points, straight }
    const live = (d) => (d.straight ? blockTypes.get('highlight').straight(d.lx, d.ly) : d.points.slice());
    tools.register({
      id: 'highlight',
      label: 'Highlighter',
      icon: 'highlighter',
      key: 'u',
      order: 98.5,
      group: 'paint',
      edits: true,
      makes: 'highlight',
      usual: { weight: 12 },
      cursor: 'crosshair',
      down(p, ctx) {
        const b = ctx.draft('highlight', { x: p.x, y: p.y, points: [0, 0] });
        drawing = { id: b.id, ox: p.x, oy: p.y, points: [0, 0], lx: 0, ly: 0, straight: Boolean(p.event && p.event.shiftKey) };
      },
      move(p, ctx) {
        if (!drawing) return;
        const d = drawing;
        d.straight = Boolean(p.event && p.event.shiftKey);
        d.lx = p.x - d.ox; d.ly = p.y - d.oy;
        const n = d.points.length;
        if (Math.hypot(d.lx - d.points[n - 2], d.ly - d.points[n - 1]) * ctx.scale() >= 2 && n + 2 <= WB_LIMITS.numbers * 4) {
          d.points.push(Math.round(d.lx * 10) / 10, Math.round(d.ly * 10) / 10);
        }
        ctx.change(d.id, { points: live(d) }, { save: false });
      },
      up(p, ctx) {
        if (!drawing) return;
        const d = drawing;
        drawing = null;
        if (p.event) d.straight = Boolean(p.event.shiftKey);
        const points = d.straight ? live(d) : blockTypes.get('stroke').simplify(d.points).points;
        ctx.change(d.id, { points }, { save: 'now' });
      },
      cancel(ctx) { if (drawing) ctx.discard(drawing.id); drawing = null; },
      deactivate(ctx) { this.cancel(ctx); },
    });
  }
