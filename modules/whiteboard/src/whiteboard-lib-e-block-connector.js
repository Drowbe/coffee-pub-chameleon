  // ---- whiteboard-lib-e-block-connector.js: a connector between blocks --------------------------------------------------
  // { id, type: 'connector', from, to, style, head, label, stroke, weight, z, by, at }: a line from one end to the other.
  // Each end is attached to a block, { block: <id>, side: 'auto' | 'top' | 'right' | 'bottom' | 'left' } ('auto': the side
  // that faces the other end), or is a free point on the board, { x, y }. style: 'elbow' (straight runs and right-angled
  // bends) or 'straight'; head: where the arrowheads are, 'end', 'none', 'start' or 'both'; label: a few words at its middle
  // (double-click or Enter to change them; one line).
  //
  // Where it runs is never saved: it is worked out each time it is drawn, from the boxes the blocks it is attached to have
  // now (layout, below), so moving or resizing a block (alone, with others, by an undo, or by someone else) moves its
  // connectors with no write of their own. While a block it is attached to is not on the board, it is not drawn at all
  // (and the page removes it: a connector never outlives the blocks it is attached to). Drag either end, once it is
  // picked, to attach it somewhere else (lib-f-tool-select.js).
  //
  // The route (wbRoute) is plain arithmetic on boxes and points, with no page in it, so it is tested on its own: an elbow
  // leaves each block straight out from the side it uses, runs in straight lines with as few bends as it can (one to
  // three; four only to come back round to a side that faces away), and does not cross its own two blocks where another
  // way does not. It goes round only its own two blocks, not others in the way.
  const WB_SIDES = ['top', 'right', 'bottom', 'left'];
  // The choices of the Line style and Arrowheads menus.
  const WB_CONNECTOR_STYLES = [
    { id: 'elbow', label: 'Elbow', icon: 'stairs' },
    { id: 'straight', label: 'Straight', icon: 'minus' },
  ];
  const WB_CONNECTOR_HEADS = [
    { id: 'none', label: 'None', icon: 'minus' },
    { id: 'end', label: 'End', icon: 'arrow-right-long' },
    { id: 'start', label: 'Start', icon: 'arrow-left-long' },
    { id: 'both', label: 'Both', icon: 'arrows-left-right' },
  ];
  // gap: how far an elbow goes straight out of a block before it turns (board units); snap: two facing sides whose middles
  // are this close are joined by one straight line instead of a small jog.
  const WB_ROUTE = { gap: 20, snap: 8 };
  const WB_DIR = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };

  const wbCentre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const wbPointBox = (p) => ({ x: p.x, y: p.y, w: 0, h: 0 });
  // The middle of a side of a box ({ x, y, w, h, in? }), moved in by the box's `in` for that side (a parallelogram's
  // slanted sides).
  function wbSidePoint(r, side) {
    const k = (r.in && r.in[side]) || 0;
    if (side === 'top') return { x: r.x + r.w / 2, y: r.y + k };
    if (side === 'bottom') return { x: r.x + r.w / 2, y: r.y + r.h - k };
    if (side === 'left') return { x: r.x + k, y: r.y + r.h / 2 };
    return { x: r.x + r.w - k, y: r.y + r.h / 2 };
  }
  // The side of box r that faces `other` (a box; a point is a box with no size): across the wider of the two gaps.
  function wbFacing(r, other) {
    const a = wbCentre(r);
    const b = wbCentre(other);
    const gx = Math.abs(b.x - a.x) - (r.w + other.w) / 2;
    const gy = Math.abs(b.y - a.y) - (r.h + other.h) / 2;
    if (gx >= gy) return b.x >= a.x ? 'right' : 'left';
    return b.y >= a.y ? 'bottom' : 'top';
  }
  // The sides two ends use: an end on a block keeps the side it names, and 'auto' faces the other end (that end's point
  // when its side is named, else its whole box). Both ends on one block: out of its right side and into its top.
  function wbSides(a, b) {
    const area = (e) => (e.box ? e.box : wbPointBox(e.point));
    const named = (e) => Boolean(e.box && e.side && e.side !== 'auto');
    const same = Boolean(a.box && b.box && a.id !== undefined && a.id === b.id);
    const pick = (e, other, first) => {
      if (!e.box) return null;
      if (named(e)) return e.side;
      if (same) return first ? 'right' : 'top';
      return wbFacing(e.box, named(other) ? wbPointBox(wbSidePoint(other.box, other.side)) : area(other));
    };
    return { sa: pick(a, b, true), sb: pick(b, a, false) };
  }

  // A route's points tidied: no point twice, no point in the middle of a straight run. null when it turns straight back
  // on itself (never a route to draw).
  function wbTidy(list) {
    const out = [];
    for (const p of list) {
      const q = out[out.length - 1];
      if (q && Math.abs(q.x - p.x) < 0.01 && Math.abs(q.y - p.y) < 0.01) continue;
      out.push({ x: p.x, y: p.y });
    }
    const dir = (p, q) => ({ x: Math.sign(Math.round((q.x - p.x) * 100)), y: Math.sign(Math.round((q.y - p.y) * 100)) });
    for (let i = 1; i + 1 < out.length;) {
      const d1 = dir(out[i - 1], out[i]);
      const d2 = dir(out[i], out[i + 1]);
      if (d1.x === d2.x && d1.y === d2.y) { out.splice(i, 1); continue; }
      if (d1.x === -d2.x && d1.y === -d2.y) return null;
      i += 1;
    }
    if (out.length === 1) out.push({ ...out[0] }); // both ends on one point
    return out;
  }
  // Whether a straight run across or down (p to q) goes through the inside of box r (running along its edge does not).
  function wbCrosses(p, q, r) {
    const e = 0.5;
    return Math.min(p.x, q.x) < r.x + r.w - e && Math.max(p.x, q.x) > r.x + e && Math.min(p.y, q.y) < r.y + r.h - e && Math.max(p.y, q.y) > r.y + e;
  }

  // The route from end a to end b, as points on the board (at least two). An end is { box, side, id? } on a block (box:
  // { x, y, w, h, in? }) or { point } for a free one. style 'straight': one line, from the side's middle when a side is
  // named, else from where the line between the two ends crosses the block's edge. style 'elbow': straight runs across
  // and down only. Of a few ways round (through the middle between the ends, along either end's line, or outside both
  // blocks), it takes the one that crosses neither block, then the shortest with the fewest bends; each way leaves a
  // block straight out from its side for `gap` first (less when two facing sides are closer than that).
  function wbRoute(a, b, style = 'elbow', { gap = WB_ROUTE.gap } = {}) {
    const { sa, sb } = wbSides(a, b);
    if (style === 'straight') {
      const towards = (e, side, other) => {
        if (!e.box) return { ...e.point };
        if (e.side && e.side !== 'auto') return wbSidePoint(e.box, side);
        const c = wbCentre(e.box);
        const t = other.box ? (other.side && other.side !== 'auto' ? wbSidePoint(other.box, other.side) : wbCentre(other.box)) : other.point;
        const dx = t.x - c.x;
        const dy = t.y - c.y;
        if (!dx && !dy) return wbSidePoint(e.box, side);
        const k = Math.min(dx ? e.box.w / 2 / Math.abs(dx) : Infinity, dy ? e.box.h / 2 / Math.abs(dy) : Infinity);
        return { x: c.x + dx * k, y: c.y + dy * k };
      };
      const p = towards(a, sa, b);
      const q = towards(b, sb, a);
      return [p, q];
    }
    const A = a.box ? wbSidePoint(a.box, sa) : { ...a.point };
    const B = b.box ? wbSidePoint(b.box, sb) : { ...b.point };
    const dA = sa ? WB_DIR[sa] : null;
    const dB = sb ? WB_DIR[sb] : null;
    let out = gap;
    if (dA && dB && dA[0] === -dB[0] && dA[1] === -dB[1]) {
      // Two sides that face each other: no further out than half the way between them, and one straight line when their
      // middles are only a little apart and both blocks have space for it.
      const across = dA[0] !== 0;
      const ahead = across ? (B.x - A.x) * dA[0] : (B.y - A.y) * dA[1];
      if (ahead >= 0) {
        out = Math.min(gap, ahead / 2);
        const k = across ? 'y' : 'x';
        const size = across ? 'h' : 'w';
        const lo = Math.max(a.box[k], b.box[k]);
        const hi = Math.min(a.box[k] + a.box[size], b.box[k] + b.box[size]);
        if (Math.abs(A[k] - B[k]) <= WB_ROUTE.snap && hi >= lo) {
          const v = Math.min(hi, Math.max(lo, (A[k] + B[k]) / 2));
          A[k] = v;
          B[k] = v;
        }
      }
    }
    // Nor further out than halfway to the other block when it lies straight ahead (two blocks close together).
    const distAhead = (P, d, r) => {
      if (!d || !r) return Infinity;
      if (d[0] && P.y > r.y && P.y < r.y + r.h) { const t = d[0] > 0 ? r.x - P.x : P.x - (r.x + r.w); return t >= 0 ? t : Infinity; }
      if (d[1] && P.x > r.x && P.x < r.x + r.w) { const t = d[1] > 0 ? r.y - P.y : P.y - (r.y + r.h); return t >= 0 ? t : Infinity; }
      return Infinity;
    };
    const outA = Math.min(out, distAhead(A, dA, b.box) / 2);
    const outB = Math.min(out, distAhead(B, dB, a.box) / 2);
    const A1 = dA ? { x: A.x + dA[0] * outA, y: A.y + dA[1] * outA } : A;
    const B1 = dB ? { x: B.x + dB[0] * outB, y: B.y + dB[1] * outB } : B;
    const boxes = a.box && b.box && a.id !== undefined && a.id === b.id ? [a.box] : [a.box, b.box].filter(Boolean);
    const all = [...boxes, wbPointBox(A), wbPointBox(B)];
    const x0 = Math.min(...all.map((r) => r.x)) - gap;
    const x1 = Math.max(...all.map((r) => r.x + r.w)) + gap;
    const y0 = Math.min(...all.map((r) => r.y)) - gap;
    const y1 = Math.max(...all.map((r) => r.y + r.h)) + gap;
    const viaX = (x) => [A1, { x, y: A1.y }, { x, y: B1.y }, B1];
    const viaY = (y) => [A1, { x: A1.x, y }, { x: B1.x, y }, B1];
    // In the order a tie is settled: through the middle first.
    const ways = [
      viaX((A1.x + B1.x) / 2),
      viaY((A1.y + B1.y) / 2),
      [A1, { x: B1.x, y: A1.y }, B1],
      [A1, { x: A1.x, y: B1.y }, B1],
      ...[A1.x, B1.x, x0, x1].map(viaX),
      ...[A1.y, B1.y, y0, y1].map(viaY),
    ];
    const sgn = (v) => (Math.abs(v) < 0.01 ? 0 : Math.sign(v));
    const dirOf = (p, q) => [sgn(q.x - p.x), sgn(q.y - p.y)];
    let best = null;
    let bestScore = Infinity;
    for (const way of ways) {
      const pts = wbTidy([A, ...way, B]);
      if (!pts) continue;
      let length = 0;
      let hits = 0;
      for (let i = 0; i + 1 < pts.length; i += 1) {
        length += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
        for (const r of boxes) if (wbCrosses(pts[i], pts[i + 1], r)) hits += 1;
      }
      // Leaving a block other than straight out of its side (only when two blocks touch) is the last resort.
      let askew = 0;
      if (dA && length) { const d = dirOf(pts[0], pts[1]); if (d[0] !== dA[0] || d[1] !== dA[1]) askew += 1; }
      if (dB && length) { const d = dirOf(pts[pts.length - 1], pts[pts.length - 2]); if (d[0] !== dB[0] || d[1] !== dB[1]) askew += 1; }
      const score = hits * 1e6 + askew * 1e5 + length + (pts.length - 2) * gap;
      if (score < bestScore - 1e-6) { best = pts; bestScore = score; }
    }
    return best || [A, B];
  }

  // A path's length, the point halfway along it, how near it passes a point, and whether it touches a rectangle.
  function wbPathLength(pts) {
    let n = 0;
    for (let i = 0; i + 1 < pts.length; i += 1) n += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    return n;
  }
  function wbMidpoint(pts) {
    let left = wbPathLength(pts) / 2;
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const p = pts[i];
      const q = pts[i + 1];
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d >= left && d > 0) return { x: p.x + ((q.x - p.x) * left) / d, y: p.y + ((q.y - p.y) * left) / d };
      left -= d;
    }
    return { ...pts[0] };
  }
  // The distance from point p to the path.
  function wbPathDistance(pts, p) {
    let best = Infinity;
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
      best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
    }
    return best;
  }
  const wbNearPath = (pts, p, tol) => wbPathDistance(pts, p) <= tol;
  // Whether any part of the path is inside the rectangle { x0, y0, x1, y1 } (any two corners).
  function wbPathTouches(pts, r) {
    const x0 = Math.min(r.x0, r.x1); const x1 = Math.max(r.x0, r.x1);
    const y0 = Math.min(r.y0, r.y1); const y1 = Math.max(r.y0, r.y1);
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const p = pts[i];
      const dx = pts[i + 1].x - p.x;
      const dy = pts[i + 1].y - p.y;
      let t0 = 0;
      let t1 = 1;
      const edges = [[-dx, p.x - x0], [dx, x1 - p.x], [-dy, p.y - y0], [dy, y1 - p.y]];
      let inside = true;
      for (const [d, gap] of edges) {
        if (d === 0) { if (gap < 0) { inside = false; break; } continue; }
        const t = gap / d;
        if (d < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
        if (t0 > t1) { inside = false; break; }
      }
      if (inside) return true;
    }
    return false;
  }

  // Where a connector's end goes for a point on the board: the first of `boxes` (each { id, x, y, w, h, in? }, the
  // topmost first) that the point is on or within `tol` of; on it, the side whose middle the point is near, else 'auto'.
  // null: the board itself (a free end).
  function wbAttachAt(boxes, p, tol) {
    for (const r of boxes) {
      if (p.x < r.x - tol || p.x > r.x + r.w + tol || p.y < r.y - tol || p.y > r.y + r.h + tol) continue;
      let side = 'auto';
      let best = Math.min(tol, Math.max(4, Math.min(r.w, r.h) / 4));
      for (const s of WB_SIDES) {
        const q = wbSidePoint(r, s);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d <= best) { best = d; side = s; }
      }
      return { block: r.id, side };
    }
    return null;
  }

  {
    const isAttached = (e) => Boolean(e) && e.block !== undefined;
    const endOf = (e) => {
      if (!e || typeof e !== 'object') return null;
      if (e.block !== undefined) {
        const block = wb.id(e.block);
        return block ? { block, side: WB_SIDES.includes(e.side) ? e.side : 'auto' } : null;
      }
      const x = wb.num(e.x);
      const y = wb.num(e.y);
      return x === null || y === null ? null : { x, y };
    };
    const lineOf = (v) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').slice(0, 120) : '');
    // An arrowhead's length for a width, the same as an arrow's (lib-e-block-line.js).
    const headOf = (weight) => 10 + weight * 2;
    const shift = (e, dx, dy) => (isAttached(e) ? e : { x: Math.round((e.x + dx) * 10) / 10, y: Math.round((e.y + dy) * 10) / 10 });
    // The words a block shows, for a screen reader: its own (a shape's, a note's, a picture's description), else what it is.
    const wordsOf = (o) => {
      if (!o) return 'a point';
      const t = (o.text ? wbPlain(o.text) : String(o.alt || '')).replace(/\s+/g, ' ').trim(); // a block's words without their markup
      if (t) return t.slice(0, 60);
      const def = blockTypes.get(o.type);
      const noun = def ? (def.noun ? def.noun(o) : def.label.toLowerCase()) : 'block';
      return `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}`;
    };

    blockTypes.register({
      type: 'connector',
      label: 'Connector',
      noun: () => 'connector',
      attached: true,
      edit: 'text',
      textField: 'label',
      textLine: true,
      textLabel: 'Connector label',
      textMax: 120,
      editLabel: 'Edit label',
      paint: { stroke: { label: 'Line' } },
      weight: true,
      create: () => ({ from: { x: 0, y: 0 }, to: { x: 160, y: 0 }, style: 'elbow', head: 'end', label: '', stroke: 'ink', weight: 2 }),
      clean(raw) {
        const from = endOf(raw.from);
        const to = endOf(raw.to);
        if (!from || !to) return null;
        return {
          from,
          to,
          style: WB_CONNECTOR_STYLES.some((s) => s.id === raw.style) ? raw.style : 'elbow',
          head: WB_CONNECTOR_HEADS.some((h) => h.id === raw.head) ? raw.head : 'end',
          label: lineOf(raw.label),
        };
      },
      // Its box is worked out from the blocks it is attached to (layout); this is only the free ends'.
      box(b) {
        const pts = [b.from, b.to].filter((e) => !isAttached(e));
        if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
        const x = Math.min(...pts.map((p) => p.x));
        const y = Math.min(...pts.map((p) => p.y));
        return { x, y, w: Math.max(...pts.map((p) => p.x)) - x, h: Math.max(...pts.map((p) => p.y)) - y };
      },
      resize: { handles: 'ends', attach: true }, // a handle on each end: drag it to attach that end somewhere else
      linked: [['from', 'to']], // its two ends: where it starts and where it ends
      refs: (b) => [b.from, b.to].filter(isAttached).map((e) => e.block),
      remap(b, idMap) {
        const re = (e) => (isAttached(e) && idMap.has(e.block) ? { ...e, block: idMap.get(e.block) } : e);
        return { from: re(b.from), to: re(b.to) };
      },
      loosen(b, keep, pointOf) {
        const free = (e, which) => {
          if (!isAttached(e) || keep.has(e.block)) return e;
          const p = pointOf(which);
          return p ? { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 } : e;
        };
        return { from: free(b.from, 'from'), to: free(b.to, 'to') };
      },
      // Moving it moves only its free ends; an attached end goes with its block.
      move: (b, dx, dy) => ({ from: shift(b.from, dx, dy), to: shift(b.to, dx, dy) }),
      layout(b, boxOf) {
        const end = (e) => {
          if (!isAttached(e)) return { point: { x: e.x, y: e.y } };
          const box = boxOf(e.block);
          return box ? { id: e.block, box, side: e.side } : null;
        };
        const from = end(b.from);
        const to = end(b.to);
        if (!from || !to) return null;
        const head = b.head === 'none' ? 0 : headOf(b.weight);
        const points = wbRoute(from, to, b.style, { gap: Math.max(WB_ROUTE.gap, head + 8) });
        const pad = Math.max(12, b.weight * 2) + head;
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        const x = Math.min(...xs) - pad;
        const y = Math.min(...ys) - pad;
        return { points, head, mid: wbMidpoint(points), box: { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y } };
      },
      render(b, el, g) {
        if (!g) return;
        const ox = -g.box.x;
        const oy = -g.box.y;
        const pts = g.points.map((p) => ({ x: p.x + ox, y: p.y + oy }));
        const len = wbPathLength(pts);
        const size = len > 0 ? Math.min(g.head || headOf(b.weight), len / 2) : 0;
        const atEnd = size > 0 && (b.head === 'end' || b.head === 'both');
        const atStart = size > 0 && (b.head === 'start' || b.head === 'both');
        const line = pts.map((p) => ({ ...p }));
        // With a head, the line stops inside it, so a wide line does not poke through its point.
        const pull = (i, j) => {
          const d = Math.hypot(line[j].x - line[i].x, line[j].y - line[i].y);
          const k = d ? Math.min(size * 0.6, d) / d : 0;
          line[i] = { x: line[i].x + (line[j].x - line[i].x) * k, y: line[i].y + (line[j].y - line[i].y) * k };
        };
        if (atEnd) pull(line.length - 1, line.length - 2);
        if (atStart) pull(0, 1);
        const flat = (list) => list.map((p) => `${p.x},${p.y}`).join(' ');
        const svg = wb.svg('svg', { class: 'wb-svg', width: g.box.w, height: g.box.h, viewBox: `0 0 ${g.box.w} ${g.box.h}`, 'aria-hidden': 'true' });
        svg.append(wb.svg('polyline', { class: 'wb-hit wb-hit-wide', points: flat(pts) }));
        svg.append(wb.svg('polyline', { class: 'wb-stroke', points: flat(line) }));
        const arrow = (tip, from) => {
          const d = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
          const ux = (tip.x - from.x) / d;
          const uy = (tip.y - from.y) / d;
          const bx = tip.x - ux * size;
          const by = tip.y - uy * size;
          const corners = [[tip.x, tip.y], [bx - uy * size * 0.55, by + ux * size * 0.55], [bx + uy * size * 0.55, by - ux * size * 0.55]];
          svg.append(wb.svg('polygon', { class: 'wb-head', points: corners.map((c) => c.join(',')).join(' ') }));
        };
        if (atEnd) arrow(pts[pts.length - 1], pts[pts.length - 2]);
        if (atStart) arrow(pts[0], pts[1]);
        // The label: a few words over the middle of the line, on the board's own colour so the line does not run through them.
        const label = document.createElement('div');
        label.className = 'wb-conn-label';
        label.style.left = `${g.mid.x + ox}px`;
        label.style.top = `${g.mid.y + oy}px`;
        if (!b.label) label.dataset.empty = 'true';
        const words = document.createElement('span');
        words.className = 'wb-words';
        words.textContent = b.label;
        label.append(words);
        el.replaceChildren(svg, label);
      },
      textOf: (el) => el.querySelector('.wb-conn-label .wb-words'),
      describe(b, find) {
        const end = (e) => (isAttached(e) ? (find && find(e.block)) || null : null);
        const from = end(b.from);
        const to = end(b.to);
        const named = (o) => Boolean(o && String(o.text || o.alt || '').trim());
        let s = named(from) || named(to) ? `Connector from ${wordsOf(from)} to ${wordsOf(to)}` : 'Connector';
        if (b.label) s += `, labelled ${b.label}`;
        return s;
      },
    });
  }
