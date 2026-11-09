  // ---- whiteboard-lib-e-block-stroke.js: a freehand stroke --------------------------------------------------------------
  // { ...block, points: [x0, y0, x1, y1, ...], brush, widths?, stroke, weight }: every point of the line drawn, relative to
  // x, y, saved whole once the pen lifts. Double-click to change its colour.
  // brush: what drew it, 'pen' (the line, weight wide), 'marker' (wide, round, a little see-through, so strokes over one
  // another show) or 'brush' (a filled shape that is thinner at both ends, and wider where it was pressed harder). A stroke
  // with no brush is a pen's. widths: for a brush drawn with pressure only, one number per point, how wide the stroke is
  // there in percent of weight (1 to 100); with none (a mouse), the same width all along. weight is the brush's full width.
  {
    const MAX = WB_LIMITS.numbers; // 6000 numbers: 3000 points
    // A stroke with widths keeps at most 2000 points (4000 numbers) and their 2000 widths, so it stays far under the 60 KB a
    // value may be: a point is at most 9 characters a number ("-39999.9,"), a width 4 ("100,"), 36 KB + 8 KB in all.
    const MAX_WIDE = 4000;
    const BRUSHES = ['pen', 'marker', 'brush'];
    const pct = (n) => Math.max(1, Math.min(100, Math.round(n)));
    // Fewer points for the same line (Ramer-Douglas-Peucker), within `tol` board units; looser until it fits the limit. With
    // widths (percent of `weight`), a point is kept where the width changes as well as where the line bends: a width that
    // is `tol` board units off the straight change between its neighbours counts as far off. Returns { points, widths? }.
    const simplify = (flat, widths = null, weight = 3) => {
      const n = Math.floor(flat.length / 2);
      const wide = Array.isArray(widths) && widths.length === n && n > 0;
      const pts = [];
      for (let i = 0; i < n; i += 1) pts.push([flat[i * 2], flat[i * 2 + 1], wide ? pct(widths[i]) : 0]);
      const k = wide ? weight / 100 : 0; // a width step of one percent, in board units
      const run = (tol) => {
        if (pts.length < 3) return pts.slice();
        const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
        const stack = [[0, pts.length - 1]];
        while (stack.length) {
          const [a, z] = stack.pop();
          const [ax, ay, aw] = pts[a]; const [zx, zy, zw] = pts[z];
          const len2 = (zx - ax) ** 2 + (zy - ay) ** 2;
          const len = Math.sqrt(len2) || 1;
          let far = -1; let at = -1;
          for (let i = a + 1; i < z; i += 1) {
            let d = Math.abs((zx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (zy - ay)) / len;
            if (k) {
              const t = len2 ? Math.max(0, Math.min(1, ((pts[i][0] - ax) * (zx - ax) + (pts[i][1] - ay) * (zy - ay)) / len2)) : 0;
              d = Math.max(d, Math.abs(pts[i][2] - (aw + (zw - aw) * t)) * k);
            }
            if (d > far) { far = d; at = i; }
          }
          if (far > tol && at > 0) { keep[at] = 1; stack.push([a, at], [at, z]); }
        }
        return pts.filter((_, i) => keep[i]);
      };
      const limit = wide ? MAX_WIDE : MAX;
      let tol = 0.6; let out = run(tol);
      while (out.length * 2 > limit) { tol *= 2; out = run(tol); }
      const points = out.flatMap((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
      return wide ? { points, widths: out.map((p) => p[2]) } : { points };
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
    const f1 = (n) => Math.round(n * 10) / 10;
    // A brush stroke's outline: each point pushed out to both sides by half its width, the width tapering to a fifth over
    // the first and last stretch (up to four widths long, at most a third of the stroke each), joined round the ends.
    const outlineOf = (p, widths, weight, ox, oy) => {
      const n = p.length / 2;
      const X = (i) => p[i * 2] + ox; const Y = (i) => p[i * 2 + 1] + oy;
      const along = [0];
      for (let i = 1; i < n; i += 1) along.push(along[i - 1] + Math.hypot(X(i) - X(i - 1), Y(i) - Y(i - 1)));
      const total = along[n - 1];
      const half = (i) => {
        const base = weight * (widths ? widths[i] / 100 : 1);
        const taper = Math.min(total / 3, weight * 4);
        const f = taper > 0 ? Math.min(1, along[i] / taper, (total - along[i]) / taper) : 1;
        return Math.max(0.3, (base * (0.2 + 0.8 * Math.sin((f * Math.PI) / 2))) / 2);
      };
      if (n < 2 || total < 0.5) {
        const r = f1(Math.max(0.5, weight * (widths ? widths[0] / 100 : 1) / 2));
        return `M${f1(X(0) - r)} ${f1(Y(0))}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
      }
      const left = []; const right = []; const rs = [];
      for (let i = 0; i < n; i += 1) {
        const a = Math.max(0, i - 1); const b = Math.min(n - 1, i + 1);
        let dx = X(b) - X(a); let dy = Y(b) - Y(a);
        const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
        const r = half(i);
        rs.push(r);
        left.push([X(i) - dy * r, Y(i) + dx * r]);
        right.push([X(i) + dy * r, Y(i) - dx * r]);
      }
      const side = (list) => {
        let d = '';
        for (let i = 1; i + 1 < list.length; i += 1) {
          const m = [(list[i][0] + list[i + 1][0]) / 2, (list[i][1] + list[i + 1][1]) / 2];
          d += `Q${f1(list[i][0])} ${f1(list[i][1])} ${f1(m[0])} ${f1(m[1])}`;
        }
        const last = list[list.length - 1];
        return `${d}L${f1(last[0])} ${f1(last[1])}`;
      };
      const back = right.slice().reverse();
      const capEnd = f1(rs[n - 1]); const capStart = f1(rs[0]);
      return `M${f1(left[0][0])} ${f1(left[0][1])}${side(left)}A${capEnd} ${capEnd} 0 0 0 ${f1(back[0][0])} ${f1(back[0][1])}${side(back)}A${capStart} ${capStart} 0 0 0 ${f1(left[0][0])} ${f1(left[0][1])}Z`;
    };
    blockTypes.register({
      type: 'stroke',
      label: 'Drawing',
      edit: 'colour',
      paint: { stroke: { label: 'Line' } },
      weight: true,
      brushes: BRUSHES,
      maxWide: MAX_WIDE,
      simplify,
      create: () => ({ points: [0, 0], brush: 'pen', stroke: 'ink', weight: 3 }),
      clean(raw) {
        if (!Array.isArray(raw.points) || raw.points.length < 2 || raw.points.length > MAX || raw.points.length % 2) return null;
        const points = raw.points.map((n) => wb.num(n, WB_LIMITS.size * 10));
        if (points.some((n) => n === null)) return null;
        const brush = BRUSHES.includes(raw.brush) ? raw.brush : 'pen';
        const out = { points, brush };
        // Widths only for a brush, one whole percent per point; any other list is left out (the stroke is drawn even).
        const w = raw.widths;
        if (brush === 'brush' && Array.isArray(w) && w.length * 2 === points.length && points.length <= MAX_WIDE && w.every((v) => Number.isInteger(v) && v >= 1 && v <= 100)) out.widths = w.slice();
        return out;
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
        const brush = b.brush || 'pen';
        let svg = el.querySelector('svg');
        if (!svg || svg.dataset.brush !== brush) {
          svg = wb.svg('svg', { class: 'wb-svg', 'aria-hidden': 'true', 'data-brush': brush });
          svg.append(wb.svg('path', { class: 'wb-hit wb-hit-wide' }), wb.svg('path', { class: brush === 'brush' ? 'wb-brush' : 'wb-stroke' }));
          el.replaceChildren(svg);
        }
        el.dataset.brush = brush;
        svg.setAttribute('width', box.w); svg.setAttribute('height', box.h); svg.setAttribute('viewBox', `0 0 ${box.w} ${box.h}`);
        const [hit, ink] = svg.querySelectorAll('path');
        hit.setAttribute('d', d);
        ink.setAttribute('d', brush === 'brush' ? outlineOf(b.points, b.widths || null, b.weight, -box.x, -box.y) : d);
      },
      describe: (b) => (b.brush === 'marker' ? 'Marker drawing' : b.brush === 'brush' ? 'Brush drawing' : 'Drawing'),
      linked: [['x', 'y', 'points', 'widths']], // where it is, its line and how wide it is along it
    });
  }
