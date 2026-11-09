  // ---- whiteboard-lib-e-block-stroke.js: a freehand stroke --------------------------------------------------------------
  // { ...block, points: [x0, y0, x1, y1, ...], stroke, weight }: every point of the line drawn, relative to x, y, saved
  // whole once the pen lifts. Double-click to change its colour.
  {
    const MAX = WB_LIMITS.numbers;
    // Fewer points for the same line (Ramer-Douglas-Peucker), within `tol` board units; looser until it fits the limit.
    const simplify = (flat) => {
      const pts = [];
      for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
      const run = (tol) => {
        if (pts.length < 3) return pts.slice();
        const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
        const stack = [[0, pts.length - 1]];
        while (stack.length) {
          const [a, z] = stack.pop();
          const [ax, ay] = pts[a]; const [zx, zy] = pts[z];
          const len = Math.hypot(zx - ax, zy - ay) || 1;
          let far = -1; let at = -1;
          for (let i = a + 1; i < z; i += 1) {
            const d = Math.abs((zx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (zy - ay)) / len;
            if (d > far) { far = d; at = i; }
          }
          if (far > tol && at > 0) { keep[at] = 1; stack.push([a, at], [at, z]); }
        }
        return pts.filter((_, i) => keep[i]);
      };
      let tol = 0.6; let out = run(tol);
      while (out.length * 2 > MAX) { tol *= 2; out = run(tol); }
      return out.flat().map((n) => Math.round(n * 10) / 10);
    };
    // A smooth path through the points: a curve through each middle point.
    const pathOf = (p, ox, oy) => {
      if (p.length < 4) return `M${p[0] + ox} ${p[1] + oy}h0.1`;
      let d = `M${p[0] + ox} ${p[1] + oy}`;
      for (let i = 2; i + 3 < p.length; i += 2) {
        const mx = (p[i] + p[i + 2]) / 2; const my = (p[i + 1] + p[i + 3]) / 2;
        d += `Q${p[i] + ox} ${p[i + 1] + oy} ${mx + ox} ${my + oy}`;
      }
      return `${d}L${p[p.length - 2] + ox} ${p[p.length - 1] + oy}`;
    };
    blockTypes.register({
      type: 'stroke',
      label: 'Drawing',
      edit: 'colour',
      paint: { stroke: { label: 'Line' } },
      weight: true,
      simplify,
      create: () => ({ points: [0, 0], stroke: 'ink', weight: 3 }),
      clean(raw) {
        if (!Array.isArray(raw.points) || raw.points.length < 2 || raw.points.length > MAX || raw.points.length % 2) return null;
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
      render(b, el) {
        const box = this.box(b);
        const d = pathOf(b.points, -box.x, -box.y);
        let svg = el.querySelector('svg');
        if (!svg) {
          svg = wb.svg('svg', { class: 'wb-svg', 'aria-hidden': 'true' });
          svg.append(wb.svg('path', { class: 'wb-hit wb-hit-wide' }), wb.svg('path', { class: 'wb-stroke' }));
          el.replaceChildren(svg);
        }
        svg.setAttribute('width', box.w); svg.setAttribute('height', box.h); svg.setAttribute('viewBox', `0 0 ${box.w} ${box.h}`);
        for (const p of svg.querySelectorAll('path')) p.setAttribute('d', d);
      },
      describe: () => 'Drawing',
    });
  }
