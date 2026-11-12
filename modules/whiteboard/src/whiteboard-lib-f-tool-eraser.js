  // ---- whiteboard-lib-f-tool-eraser.js: erase drawings by sweeping over them -----------------------------------------------
  // Press and drag over strokes and highlights to remove each one the pointer touches, whole. Notes, text, shapes, tables,
  // pictures, frames and connectors are never erased; a locked block is passed over and counted (the usual locked note).
  // The pointer is a small circle (12 screen pixels across, the same at any zoom; none on a touch screen, which erases by the
  // same radius). Each block is removed as it is touched, through the page's remove (so the history and the rights apply);
  // a whole drag is ONE undo step (its own tag, joined), and at most WB_ERASER.cap blocks go in one drag, then it says to lift
  // and sweep again. Escape or a lost pointer ends the drag; what was erased stays erased. Pointer moves are tested at most
  // once a frame. A choice of its own in the tool switch (not a kind of Pen), key E; no colour strip.
  //
  // wbEraserHits(blocks, from, to, radius, kinds) -> { ids, locked }: the ids of the blocks whose drawn line is within
  // `radius` (board units) of the segment from -> to ({ x, y } each), and the ids of locked ones that would have been hit. Only
  // strokes and highlights, whatever `kinds` says. Pure: no page. The block's box (its points' extent, grown by the radius and
  // half its width) is tested first, and the points are walked only for blocks near the segment. Not a number: nothing is hit.
  const WB_ERASER = { diameter: 12, cap: 100, kinds: ['stroke', 'highlight'], maxRadius: 10000 };
  const wbEraserBoxes = new WeakMap(); // a block's points -> [x0, y0, x1, y1] (the points array is replaced when the line changes)
  function wbEraserDist(ax, ay, bx, by, cx, cy, dx, dy) {
    // The least distance between the segments a-b and c-d.
    const cross = (px, py, qx, qy) => px * qy - py * qx;
    const rx = bx - ax; const ry = by - ay; const sx = dx - cx; const sy = dy - cy;
    const den = cross(rx, ry, sx, sy);
    if (den !== 0) {
      const t = cross(cx - ax, cy - ay, sx, sy) / den;
      const u = cross(cx - ax, cy - ay, rx, ry) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
    }
    const point = (px, py, x0, y0, x1, y1) => {
      const vx = x1 - x0; const vy = y1 - y0;
      const len = vx * vx + vy * vy;
      const t = len ? Math.max(0, Math.min(1, ((px - x0) * vx + (py - y0) * vy) / len)) : 0;
      return Math.hypot(px - (x0 + t * vx), py - (y0 + t * vy));
    };
    return Math.min(point(ax, ay, cx, cy, dx, dy), point(bx, by, cx, cy, dx, dy), point(cx, cy, ax, ay, bx, by), point(dx, dy, ax, ay, bx, by));
  }
  function wbEraserHits(blocks, from, to, radius, kinds) {
    const none = { ids: [], locked: [] };
    const ok = (v) => typeof v === 'number' && Number.isFinite(v);
    if (!Array.isArray(blocks) || !from || !to || !ok(from.x) || !ok(from.y) || !ok(to.x) || !ok(to.y) || !ok(radius) || radius < 0) return none;
    const r = Math.min(radius, WB_ERASER.maxRadius);
    const want = (Array.isArray(kinds) ? kinds : WB_ERASER.kinds).filter((k) => WB_ERASER.kinds.includes(k));
    const sx0 = Math.min(from.x, to.x) - r; const sx1 = Math.max(from.x, to.x) + r;
    const sy0 = Math.min(from.y, to.y) - r; const sy1 = Math.max(from.y, to.y) + r;
    const out = { ids: [], locked: [] };
    for (const b of blocks) {
      if (!b || !want.includes(b.type) || !Array.isArray(b.points) || b.points.length < 2) continue;
      const pts = b.points;
      const bx = ok(b.x) ? b.x : 0; const by = ok(b.y) ? b.y : 0;
      const half = (ok(b.weight) ? Math.min(Math.max(b.weight, 0), 4000) : 0) / 2;
      let box = wbEraserBoxes.get(pts);
      if (!box) {
        box = [Infinity, Infinity, -Infinity, -Infinity];
        for (let i = 0; i + 1 < pts.length; i += 2) {
          if (!ok(pts[i]) || !ok(pts[i + 1])) continue;
          box[0] = Math.min(box[0], pts[i]); box[2] = Math.max(box[2], pts[i]);
          box[1] = Math.min(box[1], pts[i + 1]); box[3] = Math.max(box[3], pts[i + 1]);
        }
        wbEraserBoxes.set(pts, box);
      }
      if (box[0] === Infinity) continue;
      if (bx + box[2] + half < sx0 || bx + box[0] - half > sx1 || by + box[3] + half < sy0 || by + box[1] - half > sy1) continue; // the box test
      const widths = Array.isArray(b.widths) && b.widths.length * 2 === pts.length ? b.widths : null;
      let hit = false;
      const n = pts.length;
      for (let i = 0; i + 1 < n && !hit; i += 2) {
        const x0 = bx + pts[i]; const y0 = by + pts[i + 1];
        const j = i + 3 < n ? i + 2 : i; // the last point is a segment to itself
        const x1 = bx + pts[j]; const y1 = by + pts[j + 1];
        if (!ok(x0) || !ok(y0) || !ok(x1) || !ok(y1)) continue;
        const w = widths ? Math.max(ok(widths[i / 2]) ? widths[i / 2] : 100, ok(widths[j / 2]) ? widths[j / 2] : 100) / 100 : 1;
        hit = wbEraserDist(from.x, from.y, to.x, to.y, x0, y0, x1, y1) <= r + half * w;
      }
      if (hit) (b.locked === true ? out.locked : out.ids).push(b.id);
    }
    return out;
  }

  {
    let run = null; // { tag, erased, locked: Set, full, last, want, frame } while the pointer is down
    let counter = 0;
    const radiusOf = (ctx) => WB_ERASER.diameter / 2 / Math.max(ctx.scale(), 1e-6);
    const sweep = (ctx, from, to) => {
      if (!run) return;
      const hits = wbEraserHits(ctx.blocks(), from, to, radiusOf(ctx), WB_ERASER.kinds);
      for (const id of hits.locked) run.locked.add(id);
      for (const id of hits.ids) {
        if (run.erased >= WB_ERASER.cap) {
          if (!run.full) { run.full = true; ctx.refuseWith(`Erased ${WB_ERASER.cap}. Lift and sweep again.`); }
          return;
        }
        if (ctx.erase(id, run.tag)) run.erased += 1;
      }
    };
    const flush = (ctx) => {
      if (!run) return;
      if (run.frame) { cancelAnimationFrame(run.frame); run.frame = 0; }
      if (run.want) { const to = run.want; run.want = null; sweep(ctx, run.last, to); run.last = to; }
    };
    const end = (ctx) => {
      if (!run) return;
      flush(ctx);
      const r = run;
      run = null;
      if (r.locked.size && !r.full) ctx.lockedNote(r.locked.size, r.locked.size + r.erased);
    };
    tools.register({
      id: 'eraser',
      label: 'Eraser',
      icon: 'eraser',
      key: 'e',
      order: 96.5,
      edits: true,
      cursor: 'none',
      hover(p, ctx) { ctx.ring(p && p.pointerType !== 'touch' ? { sx: p.sx, sy: p.sy } : null); },
      down(p, ctx) {
        counter += 1;
        run = { tag: `erase:${Date.now().toString(36)}-${counter}`, erased: 0, locked: new Set(), full: false, last: { x: p.x, y: p.y }, want: null, frame: 0 };
        ctx.ring(p.pointerType !== 'touch' ? { sx: p.sx, sy: p.sy } : null);
        sweep(ctx, run.last, run.last);
      },
      move(p, ctx) {
        if (!run) return;
        ctx.ring(p.pointerType !== 'touch' ? { sx: p.sx, sy: p.sy } : null);
        run.want = { x: p.x, y: p.y };
        if (!run.frame) run.frame = requestAnimationFrame(() => { if (run) run.frame = 0; flush(ctx); });
      },
      up(p, ctx) {
        if (!run) return;
        run.want = { x: p.x, y: p.y };
        end(ctx);
        if (p.pointerType === 'touch') ctx.ring(null);
      },
      cancel(ctx) { end(ctx); },
      deactivate(ctx) { end(ctx); ctx.ring(null); },
    });
  }
