  // ---- whiteboard-lib-f-tool-select.js: pick, move and open blocks; move the board --------------------------------------
  // Press a block to pick it and drag it to move it (saved once, where it is dropped); press it twice quickly to edit it.
  // With Shift, Ctrl or Cmd a press adds the block to what is picked, or takes it out. Drag a picked block and every picked
  // block moves with it, each by the same amount (each saved once, on the drop). Press the board itself and drag to move
  // the whole board; with Shift, drag a rectangle instead and every block it touches is picked too.
  // Someone who may only look can pick and move the board.
  // Drag a handle of the picked block to change its size (Shift keeps its shape) or to move a line's end; the new box is
  // saved once, when it is let go. What a handle does is the block type's resize (lib-a); showing the handles is the page's.
  {
    const SLOP = 4; // screen pixels a press may wander and still be a press, not a drag
    const TWICE = 400; // milliseconds between two presses that open a block
    let hold = null; // { kind: 'block' | 'board' | 'resize', ... } while the pointer is down
    let last = { id: null, t: 0 };
    const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
    // Shift, Ctrl or Cmd: add to what is picked, or take out.
    const adds = (p) => Boolean(p.event && (p.event.shiftKey || p.event.ctrlKey || p.event.metaKey));
    // A press on the board itself: move the board, or drag a rectangle to pick blocks.
    const emptyPress = (p) => (p.event && p.event.shiftKey ? 'marquee' : 'board');

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
        if (p.id && adds(p)) { last = { id: null, t: 0 }; hold = null; ctx.toggle(p.id); return; }
        const r = picked && blockTypes.get(picked.type).resize;
        if (r && ctx.policy.canChange(picked)) {
          last = { id: null, t: 0 };
          hold = { kind: 'resize', id: picked.id, handle: p.handle, r, sx: p.sx, sy: p.sy, start: { ...picked }, moved: false };
          ctx.hold(picked.id, true);
          return;
        }
        if (p.id) {
          // A press on a block already picked with others keeps them all, to move together.
          if (!ctx.isSelected(p.id) || ctx.selection().length < 2) ctx.select(p.id);
          const now = Date.now();
          if (last.id === p.id && now - last.t < TWICE) { last = { id: null, t: 0 }; hold = null; ctx.select(p.id); ctx.edit(p.id); return; }
          const blocks = ctx.selection().map((id) => ctx.get(id)).filter((b) => b && ctx.policy.canChange(b));
          hold = { kind: 'block', id: p.id, sx: p.sx, sy: p.sy, starts: blocks.map((b) => ({ id: b.id, x: b.x, y: b.y })), moved: false, moves: blocks.length > 0, group: ctx.selection().length > 1 };
          for (const s of hold.starts) ctx.hold(s.id, true);
        } else if (emptyPress(p, ctx) === 'marquee') {
          hold = { kind: 'marquee', x: p.x, y: p.y, sx: p.sx, sy: p.sy, keep: adds(p) ? ctx.selection() : [], moved: false };
          if (!hold.keep.length) ctx.select(null);
        } else {
          if (!adds(p)) ctx.select(null);
          hold = { kind: 'board', sx: p.sx, sy: p.sy, lx: p.sx, ly: p.sy };
        }
      },
      move(p, ctx) {
        if (!hold) return;
        if (hold.kind === 'board') { ctx.panBy(p.sx - hold.lx, p.sy - hold.ly); hold.lx = p.sx; hold.ly = p.sy; return; }
        if (hold.kind === 'marquee') {
          if (!hold.moved && Math.hypot(p.sx - hold.sx, p.sy - hold.sy) < SLOP) return;
          hold.moved = true;
          const r = { x0: hold.x, y0: hold.y, x1: p.x, y1: p.y };
          ctx.marquee(r);
          ctx.setSelection([...new Set([...hold.keep, ...ctx.blocksIn(r)])]);
          return;
        }
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
        const dx = (p.sx - hold.sx) / s;
        const dy = (p.sy - hold.sy) / s;
        for (const b of hold.starts) ctx.change(b.id, { x: b.x + dx, y: b.y + dy }, { save: false });
      },
      up(p, ctx) {
        if (hold && hold.kind === 'resize') {
          if (hold.moved) ctx.save(hold.id); // the whole new box, once
          ctx.hold(hold.id, false);
        }
        if (hold && hold.kind === 'block') {
          // The drop is saved first, so a change from elsewhere held meanwhile is overtaken. Every block moved, in one go.
          if (hold.moved) for (const b of hold.starts) ctx.save(b.id);
          for (const b of hold.starts) ctx.hold(b.id, false);
          if (!hold.moved && hold.group) ctx.select(hold.id); // a click, not a drag, on one of several picks just it
          last = hold.moved ? { id: null, t: 0 } : { id: hold.id, t: Date.now() };
        }
        if (hold && hold.kind === 'marquee') ctx.marquee(null);
        hold = null;
      },
      cancel(ctx) {
        if (hold && hold.kind === 'resize') {
          if (hold.moved) ctx.change(hold.id, before(hold.r, hold.start), { save: false });
          ctx.hold(hold.id, false);
        }
        if (hold && hold.kind === 'block') {
          for (const b of hold.starts) {
            if (hold.moved) ctx.change(b.id, { x: b.x, y: b.y }, { save: false });
            ctx.hold(b.id, false);
          }
        }
        if (hold && hold.kind === 'marquee') { ctx.marquee(null); ctx.setSelection(hold.keep); }
        hold = null;
      },
      deactivate(ctx) { this.cancel(ctx); last = { id: null, t: 0 }; },
    });
  }
