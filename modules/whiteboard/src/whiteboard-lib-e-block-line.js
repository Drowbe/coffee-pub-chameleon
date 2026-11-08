  // ---- whiteboard-lib-e-block-line.js: a line, or an arrow ----------------------------------------------------------------
  // { ...block, dx, dy, arrow, tint }: from x, y to x + dx, y + dy, with a head at the end when arrow is true.
  // Double-click to change its colour (tint); drag either end to move it.
  blockTypes.register({
    type: 'line',
    label: 'Line',
    edit: 'tint',
    create: () => ({ dx: 160, dy: 0, arrow: false, tint: 'ink' }),
    clean(raw) {
      const dx = wb.num(raw.dx, WB_LIMITS.size);
      const dy = wb.num(raw.dy, WB_LIMITS.size);
      if (dx === null || dy === null) return null;
      return { dx, dy, arrow: raw.arrow === true, tint: wb.tint(raw.tint) };
    },
    box(b) {
      const pad = 12;
      return { x: Math.min(0, b.dx) - pad, y: Math.min(0, b.dy) - pad, w: Math.abs(b.dx) + pad * 2, h: Math.abs(b.dy) + pad * 2 };
    },
    render(b, el) {
      const box = this.box(b);
      const ox = -box.x; const oy = -box.y; // the start, inside the box
      const ex = ox + b.dx; const ey = oy + b.dy;
      const svg = wb.svg('svg', { class: 'wb-svg', width: box.w, height: box.h, viewBox: `0 0 ${box.w} ${box.h}`, 'aria-hidden': 'true' });
      svg.append(wb.svg('line', { class: 'wb-hit wb-hit-wide', x1: ox, y1: oy, x2: ex, y2: ey }));
      svg.append(wb.svg('line', { class: 'wb-stroke', x1: ox, y1: oy, x2: ex, y2: ey }));
      const len = Math.hypot(b.dx, b.dy);
      if (b.arrow && len > 0) {
        const ux = b.dx / len; const uy = b.dy / len; const head = Math.min(14, len / 2);
        const bx = ex - ux * head; const by = ey - uy * head;
        const pts = [[ex, ey], [bx - uy * head * 0.55, by + ux * head * 0.55], [bx + uy * head * 0.55, by - ux * head * 0.55]];
        svg.append(wb.svg('polygon', { class: 'wb-head', points: pts.map((p) => p.join(',')).join(' ') }));
      }
      el.replaceChildren(svg);
    },
    describe: (b) => (b.arrow ? 'Arrow' : 'Line'),
    resize: { handles: 'ends' }, // a handle on each end moves that end
  });
