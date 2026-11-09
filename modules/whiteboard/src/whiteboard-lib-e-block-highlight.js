  // ---- whiteboard-lib-e-block-highlight.js: a highlight over what is on the board ---------------------------------------
  // { ...block, points: [x0, y0, x1, y1, ...], stroke, weight }: a wide band with round ends along the points (relative to
  // x, y), in a see-through wash of its colour (stroke; Yellow at first) so the words and shapes under it still read; drawn
  // as one path, so where the band crosses itself it is no darker. weight is the band's width. Its points are kept and
  // thinned as a drawing's are (the stroke type's simplify), saved whole once the pointer lifts. It is a block of its own:
  // picked, moved, copied, stacked and deleted like a drawing, with no resize. Double-click to change its colour.
  // How see-through it is, in both modes, is whiteboard.css's (.wb-highlight). Later it may lock onto what it highlights:
  // see lib-a.
  {
    const f1 = (n) => Math.round(n * 10) / 10;
    // A straight band along the longer of the two directions from the first point (Shift while it is drawn): the
    // points [0, 0, dx, 0] or [0, 0, 0, dy].
    const straight = (dx, dy) => (Math.abs(dx) >= Math.abs(dy) ? [0, 0, f1(dx), 0] : [0, 0, 0, f1(dy)]);
    blockTypes.register({
      type: 'highlight',
      label: 'Highlight',
      edit: 'colour',
      paint: { stroke: { label: 'Colour' } },
      weight: true,
      straight,
      create: () => ({ points: [0, 0], stroke: 'gold', weight: 12 }),
      clean(raw) {
        const max = WB_LIMITS.numbers;
        if (!Array.isArray(raw.points) || raw.points.length < 2 || raw.points.length > max || raw.points.length % 2) return null;
        const points = raw.points.map((n) => wb.num(n, WB_LIMITS.size * 10));
        if (points.some((n) => n === null)) return null;
        return { points };
      },
      box(b) {
        let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
        for (let i = 0; i + 1 < b.points.length; i += 2) {
          x0 = Math.min(x0, b.points[i]); x1 = Math.max(x1, b.points[i]);
          y0 = Math.min(y0, b.points[i + 1]); y1 = Math.max(y1, b.points[i + 1]);
        }
        const pad = b.weight / 2 + 8;
        return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
      },
      linked: [['x', 'y', 'points']], // where it is and its band
      render(b, el) {
        const box = this.box(b);
        const d = blockTypes.get('stroke').pathOf(b.points, -box.x, -box.y);
        let svg = el.querySelector('svg');
        if (!svg) {
          svg = wb.svg('svg', { class: 'wb-svg', 'aria-hidden': 'true' });
          svg.append(wb.svg('path', { class: 'wb-hit wb-hit-wide' }), wb.svg('path', { class: 'wb-highlight' }));
          el.replaceChildren(svg);
        }
        svg.setAttribute('width', box.w); svg.setAttribute('height', box.h); svg.setAttribute('viewBox', `0 0 ${box.w} ${box.h}`);
        for (const path of svg.querySelectorAll('path')) path.setAttribute('d', d);
      },
      describe: () => 'Highlight',
    });
  }
