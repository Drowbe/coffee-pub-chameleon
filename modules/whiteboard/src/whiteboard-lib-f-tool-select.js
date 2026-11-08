  // ---- whiteboard-lib-f-tool-select.js: pick, move and open blocks; move the board --------------------------------------
  // Press a block to pick it and drag it to move it (saved once, where it is dropped); press it twice quickly to edit it.
  // Press the board itself and drag to move the whole board. Someone who may only look can pick and move the board.
  // Drag a handle of the picked block to change its size (Shift keeps its shape) or to move a line's end; the new box is
  // saved once, when it is let go. What a handle does is the block type's resize (lib-a); showing the handles is the page's.
  {
    const SLOP = 4; // screen pixels a press may wander and still be a press, not a drag
    const TWICE = 400; // milliseconds between two presses that open a block
    let hold = null; // { kind: 'block' | 'board' | 'resize', ... } while the pointer is down
    let last = { id: null, t: 0 };
    const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

    // The new box for a handle dragged (mx, my) board units from where it was pressed, inside the type's minimum size.
    function resized(r, start, handle, mx, my, keep) {
      if (r.handles === 'ends') {
        return handle === 'start'
          ? { x: start.x + mx, y: start.y + my, dx: start.dx - mx, dy: start.dy - my }
          : { dx: start.dx + mx, dy: start.dy + my };
      }
      const east = handle.endsWith('e');
      const south = handle.startsWith('s');
      const minW = (r.min && r.min.w) || 8;
      const minH = (r.min && r.min.h) || 8;
      const max = WB_LIMITS.size;
      let w = start.w + (east ? mx : -mx);
      let h = r.height === false ? null : start.h + (south ? my : -my);
      if (h !== null && keep) {
        const f = clamp(Math.max(w / start.w, h / start.h), Math.max(minW / start.w, minH / start.h), Math.min(max / start.w, max / start.h));
        w = start.w * f;
        h = start.h * f;
      } else {
        w = clamp(w, minW, max);
        if (h !== null) h = clamp(h, minH, max);
      }
      const out = { w, x: east ? start.x : start.x + start.w - w };
      if (h !== null) { out.h = h; out.y = south ? start.y : start.y + start.h - h; }
      return out;
    }
    // The fields a resize changes, as they were when it began (to put back when it is cancelled).
    const before = (r, s) => (r.handles === 'ends' ? { x: s.x, y: s.y, dx: s.dx, dy: s.dy } : r.height === false ? { x: s.x, w: s.w } : { x: s.x, y: s.y, w: s.w, h: s.h });

    tools.register({
      id: 'select',
      label: 'Select',
      icon: 'arrow-pointer',
      key: 'v',
      order: 10,
      edits: false,
      down(p, ctx) {
        const picked = p.handle && ctx.selected() ? ctx.get(ctx.selected()) : null;
        const r = picked && blockTypes.get(picked.type).resize;
        if (r && ctx.policy.canChange(picked)) {
          last = { id: null, t: 0 };
          hold = { kind: 'resize', id: picked.id, handle: p.handle, r, sx: p.sx, sy: p.sy, start: { ...picked }, moved: false };
          ctx.hold(picked.id, true);
          return;
        }
        if (p.id) {
          const b = ctx.get(p.id);
          ctx.select(p.id);
          const now = Date.now();
          if (last.id === p.id && now - last.t < TWICE) { last = { id: null, t: 0 }; hold = null; ctx.edit(p.id); return; }
          hold = { kind: 'block', id: p.id, sx: p.sx, sy: p.sy, ox: b.x, oy: b.y, moved: false, moves: ctx.policy.canChange(b) };
          if (hold.moves) ctx.hold(p.id, true);
        } else {
          ctx.select(null);
          hold = { kind: 'board', sx: p.sx, sy: p.sy, lx: p.sx, ly: p.sy };
        }
      },
      move(p, ctx) {
        if (!hold) return;
        if (hold.kind === 'board') { ctx.panBy(p.sx - hold.lx, p.sy - hold.ly); hold.lx = p.sx; hold.ly = p.sy; return; }
        if (hold.kind === 'resize') {
          if (!hold.moved && Math.hypot(p.sx - hold.sx, p.sy - hold.sy) < SLOP) return;
          hold.moved = true;
          const s = ctx.scale();
          const keep = Boolean(p.event && p.event.shiftKey);
          ctx.change(hold.id, resized(hold.r, hold.start, hold.handle, (p.sx - hold.sx) / s, (p.sy - hold.sy) / s, keep), { save: false });
          return;
        }
        if (!hold.moves) return;
        if (!hold.moved && Math.hypot(p.sx - hold.sx, p.sy - hold.sy) < SLOP) return;
        hold.moved = true;
        const s = ctx.scale();
        ctx.change(hold.id, { x: hold.ox + (p.sx - hold.sx) / s, y: hold.oy + (p.sy - hold.sy) / s }, { save: false });
      },
      up(p, ctx) {
        if (hold && hold.kind === 'resize') {
          if (hold.moved) ctx.save(hold.id); // the whole new box, once
          ctx.hold(hold.id, false);
        }
        if (hold && hold.kind === 'block') {
          if (hold.moved) ctx.save(hold.id); // the drop is saved first, so a change from elsewhere held meanwhile is overtaken
          if (hold.moves) ctx.hold(hold.id, false);
          last = hold.moved ? { id: null, t: 0 } : { id: hold.id, t: Date.now() };
        }
        hold = null;
      },
      cancel(ctx) {
        if (hold && hold.kind === 'resize') {
          if (hold.moved) ctx.change(hold.id, before(hold.r, hold.start), { save: false });
          ctx.hold(hold.id, false);
        }
        if (hold && hold.kind === 'block' && hold.moved) ctx.change(hold.id, { x: hold.ox, y: hold.oy }, { save: false });
        if (hold && hold.kind === 'block' && hold.moves) ctx.hold(hold.id, false);
        hold = null;
      },
      deactivate() { hold = null; last = { id: null, t: 0 }; },
    });
  }
