  // ---- whiteboard-lib-f-tool-select.js: pick, move and open blocks; move the board --------------------------------------
  // Press a block to pick it and drag it to move it (saved once, where it is dropped); press it twice quickly to edit it.
  // With Shift, Ctrl or Cmd a press adds the block to what is picked, or takes it out. Drag a picked block and every picked
  // block moves with it, each by the same amount (each saved once, on the drop). Press the board itself and drag a
  // rectangle: every block it touches is picked (with Shift, Ctrl or Cmd, added to what is picked). On a touch screen one
  // finger on the board moves the board instead, unless "Select many" is on (ctx.many()): then it drags the rectangle,
  // and a tap on a block adds it or takes it out. Moving the board otherwise is the page's (Space, the middle or right button, the
  // wheel, two fingers) or the Hand tool's. Someone who may only look can pick, and move the board.
  // Drag a handle of the picked block to change its size (Shift keeps its shape; a picture always does) or to move a line's end; the new box is
  // saved once, when it is let go. What a handle does is the block type's resize (lib-a); showing the handles is the page's.
  // With Snap to grid (ctx.snapping, turned round while Alt is held) a move puts the pressed block's corner on the grid and
  // the others with it by the same amount; a resize puts the dragged edges or the line's end on the grid (not while the
  // shape is kept). Each is still saved once, on the drop: one step to undo.
  {
    const SLOP = 4; // screen pixels a press may wander and still be a press, not a drag
    const TWICE = 400; // milliseconds between two presses that open a block
    let hold = null; // { kind: 'block' | 'board' | 'resize', ... } while the pointer is down
    let last = { id: null, t: 0 };
    const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
    // Shift, Ctrl or Cmd: add to what is picked, or take out.
    // A finger with "Select many" on, too.
    const adds = (p, ctx) => Boolean((p.event && (p.event.shiftKey || p.event.ctrlKey || p.event.metaKey)) || (p.pointerType === 'touch' && ctx.many()));
    // A press on the board itself: drag a rectangle to pick blocks, or (one finger) move the board.
    const emptyPress = (p, ctx) => (p.pointerType === 'touch' && !ctx.many() ? 'board' : 'marquee');

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
    // How far a handle is dragged, (mx, my) board units, so that what it moves lands on the grid: the line's end, or the
    // corner's edges.
    function snapDrag(r, start, handle, mx, my) {
      const to = (edge, d) => wbSnap(edge + d) - edge;
      if (r.handles === 'ends') {
        const ex = handle === 'start' ? start.x : start.x + start.dx;
        const ey = handle === 'start' ? start.y : start.y + start.dy;
        return { mx: to(ex, mx), my: to(ey, my) };
      }
      const ex = handle.endsWith('e') ? start.x + start.w : start.x;
      const ey = handle.startsWith('s') ? start.y + (start.h || 0) : start.y;
      return { mx: to(ex, mx), my: r.height === false ? my : to(ey, my) };
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
        // Adding: a block not picked yet is added at once (and a drag then moves them all); one picked already is taken out
        // when it is let go without a drag.
        const adding = Boolean(p.id) && adds(p, ctx);
        let unpick = false;
        if (adding) { last = { id: null, t: 0 }; if (ctx.isSelected(p.id)) unpick = true; else ctx.toggle(p.id); }
        const r = picked && blockTypes.get(picked.type).resize;
        if (r && ctx.policy.canChange(picked)) {
          last = { id: null, t: 0 };
          hold = { kind: 'resize', id: picked.id, handle: p.handle, r, sx: p.sx, sy: p.sy, start: { ...picked }, moved: false };
          ctx.hold(picked.id, true);
          return;
        }
        if (p.id) {
          // A press on a block already picked with others keeps them all, to move together.
          if (!adding && (!ctx.isSelected(p.id) || ctx.selection().length < 2)) ctx.select(p.id);
          const now = Date.now();
          if (!adding && last.id === p.id && now - last.t < TWICE) { last = { id: null, t: 0 }; hold = null; ctx.select(p.id); ctx.edit(p.id); return; }
          const blocks = ctx.selection().map((id) => ctx.get(id)).filter((b) => b && ctx.policy.canChange(b));
          hold = { kind: 'block', id: p.id, sx: p.sx, sy: p.sy, starts: blocks.map((b) => ({ id: b.id, x: b.x, y: b.y })), moved: false, moves: blocks.length > 0, group: !adding && ctx.selection().length > 1, unpick, adding };
          for (const s of hold.starts) ctx.hold(s.id, true);
        } else if (emptyPress(p, ctx) === 'marquee') {
          hold = { kind: 'marquee', x: p.x, y: p.y, sx: p.sx, sy: p.sy, keep: adds(p, ctx) ? ctx.selection() : [], moved: false };
          if (!hold.keep.length) ctx.select(null);
        } else {
          if (!adds(p, ctx)) ctx.select(null);
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
          const keep = Boolean(hold.r.keep || (p.event && p.event.shiftKey)); // a picture always keeps its shape
          let m = { mx: (p.sx - hold.sx) / s, my: (p.sy - hold.sy) / s };
          if (!keep && ctx.snapping(p.event)) m = snapDrag(hold.r, hold.start, hold.handle, m.mx, m.my);
          ctx.change(hold.id, resized(hold.r, hold.start, hold.handle, m.mx, m.my, keep), { save: false });
          return;
        }
        if (!hold.moves) return;
        if (!hold.moved && Math.hypot(p.sx - hold.sx, p.sy - hold.sy) < SLOP) return;
        hold.moved = true;
        const s = ctx.scale();
        let dx = (p.sx - hold.sx) / s;
        let dy = (p.sy - hold.sy) / s;
        if (ctx.snapping(p.event)) {
          const lead = hold.starts.find((b) => b.id === hold.id) || hold.starts[0];
          dx = wbSnap(lead.x + dx) - lead.x;
          dy = wbSnap(lead.y + dy) - lead.y;
        }
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
          if (!hold.moved && hold.unpick) ctx.toggle(hold.id);
          last = hold.moved || hold.adding ? { id: null, t: 0 } : { id: hold.id, t: Date.now() };
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
