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
  // With Snap to grid off (and Alt not held: Alt turns guides off for that drag), a move lines the dragged blocks' box up
  // with the blocks near it in sight (lib-m, wbGuideSnap: its edges and middle onto theirs within GUIDE screen pixels),
  // and the page draws the guides while it does (ctx.guides). Not for a resize, nor a line's end. The blocks it lines up
  // with are found once, when the drag begins (ctx.guideBoxes). A locked block is not moved (lib-b): a drag of picked
  // blocks moves the others, and the person is told once (ctx.lockedNote).
  // Picking one block of a group picks the whole group (the page's select does it), so a click, Shift-click or rectangle
  // works on whole groups. A frame dragged takes every block inside it along (ctx.contentsOf), each saved once on the
  // drop with the rest: one step to undo. A frame is pressed only by its tab or its border (whiteboard.css), so a press
  // inside it is a press on the board or on the block there.
  // A connector's end (resize.attach) goes where it is let go: onto a block (the side whose middle it is near, else the
  // side that faces the other end), or the board (a free end, on the grid with Snap to grid); the block under it shows
  // its connection points meanwhile. A connector moves with the blocks it is attached to; moved itself (with others
  // picked), only its free ends move.
  // A handle of a block type's own (grips: a note's pointer tip, a table's lines) changes what its grip says, saved once on
  // the drop; with Snap to grid the point it is dragged to goes on the grid. One that does something when pressed without
  // a drag (a table's +) does it then (its type's tap). A corner of a table scales every column and row (its resize's
  // scale), one save on the drop.
  {
    const SLOP = 4; // screen pixels a press may wander and still be a press, not a drag
    const GUIDE = 6; // screen pixels a dragged box's edge or middle may be from another's and go onto it
    const TWICE = 400; // milliseconds between two presses that open a block
    let hold = null; // { kind: 'block' | 'board' | 'resize', ... } while the pointer is down
    let last = { id: null, t: 0 };
    const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
    // Shift, Ctrl or Cmd: add to what is picked, or take out.
    // Any pointer with "Select many" on, too.
    const adds = (p, ctx) => Boolean((p.event && (p.event.shiftKey || p.event.ctrlKey || p.event.metaKey)) || ctx.many());
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
      const least = r.minOf ? r.minOf(start) : r.min; // a table's least size follows its rows and columns
      const minW = (least && least.w) || 8;
      const minH = (least && least.h) || 8;
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
    // (A table's scale says which fields it changes: those, as they were.)
    const before = (r, s) => (r.scale ? Object.fromEntries(Object.keys(r.scale(s, s)).map((k) => [k, s[k]])) : r.attach ? { from: s.from, to: s.to } : r.handles === 'ends' ? { x: s.x, y: s.y, dx: s.dx, dy: s.dy } : r.height === false ? { x: s.x, w: s.w } : { x: s.x, y: s.y, w: s.w, h: s.h });
    // A connector's end dragged to p: attached to the block there (not the one its other end is on), else a free point.
    function endAt(hold, p, ctx) {
      const which = hold.handle === 'start' ? 'from' : 'to';
      const other = hold.start[which === 'from' ? 'to' : 'from'];
      let at = ctx.attachAt(p, { not: [hold.id] });
      if (at && other && other.block === at.block) at = null;
      ctx.ports(at ? [at] : []);
      if (at) return { [which]: at };
      if (ctx.snapping(p.event)) return { [which]: { x: wbSnap(p.x), y: wbSnap(p.y) } };
      return { [which]: { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 } };
    }

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
        // A handle of the block type's own (a note's pointer tip): its grip says what dragging it changes.
        const def = picked && blockTypes.get(picked.type);
        const el = picked ? ctx.element(picked.id) : null;
        if (def && def.grips && def.grip && ctx.policy.canChange(picked) && def.grips(picked, el).some((g) => g.id === p.handle)) {
          last = { id: null, t: 0 };
          const base = def.gripBase ? def.gripBase(picked, p.handle, el) : null;
          hold = { kind: 'grip', id: picked.id, handle: p.handle, def, base, sx: p.sx, sy: p.sy, start: { ...picked }, moved: false, keys: [] };
          ctx.hold(picked.id, true);
          return;
        }
        const r = picked && def.resize;
        if (r && ctx.policy.canChange(picked)) {
          last = { id: null, t: 0 };
          // A table starts from its height and its rows' heights as drawn (its rows grow with their words).
          const start = r.measure ? { ...picked, ...r.measure(picked, el) } : { ...picked };
          hold = { kind: 'resize', id: picked.id, handle: p.handle, r, sx: p.sx, sy: p.sy, start, moved: false };
          ctx.hold(picked.id, true);
          return;
        }
        if (p.id) {
          // A press on a block already picked with others keeps them all, to move together.
          if (!adding && (!ctx.isSelected(p.id) || ctx.selection().length < 2)) ctx.select(p.id);
          const now = Date.now();
          if (!adding && last.id === p.id && now - last.t < TWICE) { last = { id: null, t: 0 }; hold = null; ctx.select(p.id); ctx.edit(p.id, { target: p.event && p.event.target }); return; }
          const all = ctx.selection().map((id) => ctx.get(id)).filter(Boolean);
          const picked = all.filter((b) => ctx.policy.canChange(b));
          // A frame moved takes the blocks inside it now (lib-e-block-frame, wbFrameFollow); a locked one inside stays.
          const inside = ctx.contentsOf ? ctx.contentsOf(picked.map((b) => b.id)) : { blocks: [], locked: 0 };
          const blocks = [...picked, ...inside.blocks];
          const locked = all.filter((b) => b.locked === true).length + inside.locked;
          hold = { kind: 'block', id: p.id, sx: p.sx, sy: p.sy, starts: blocks.map((b) => ({ ...b })), moved: false, moves: blocks.length > 0, group: !adding && ctx.selection().length > 1, unpick, adding, locked, of: all.length + inside.blocks.length + inside.locked, guide: null };
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
        if (hold.kind === 'grip') {
          if (!hold.moved && Math.hypot(p.sx - hold.sx, p.sy - hold.sy) < SLOP) return;
          hold.moved = true;
          const to = ctx.snapping(p.event) ? { x: wbSnap(p.x), y: wbSnap(p.y) } : { x: p.x, y: p.y };
          const fields = hold.def.grip(ctx.get(hold.id) || hold.start, hold.handle, to, hold.base);
          hold.keys = [...new Set([...hold.keys, ...Object.keys(fields)])];
          ctx.change(hold.id, fields, { save: false });
          return;
        }
        if (hold.kind === 'resize') {
          if (!hold.moved && Math.hypot(p.sx - hold.sx, p.sy - hold.sy) < SLOP) return;
          hold.moved = true;
          if (hold.r.attach) { ctx.change(hold.id, endAt(hold, p, ctx), { save: false }); return; }
          const s = ctx.scale();
          const keep = Boolean(hold.r.keep || (p.event && p.event.shiftKey)); // a picture always keeps its shape
          let m = { mx: (p.sx - hold.sx) / s, my: (p.sy - hold.sy) / s };
          if (!keep && ctx.snapping(p.event)) m = snapDrag(hold.r, hold.start, hold.handle, m.mx, m.my);
          const box = resized(hold.r, hold.start, hold.handle, m.mx, m.my, keep);
          ctx.change(hold.id, hold.r.scale ? hold.r.scale(hold.start, box) : box, { save: false });
          return;
        }
        if (!hold.moved && Math.hypot(p.sx - hold.sx, p.sy - hold.sy) < SLOP) return;
        if (hold.locked && !hold.told && ctx.lockedNote && !hold.adding) { hold.told = true; ctx.lockedNote(hold.locked, hold.of); }
        if (!hold.moves) return;
        hold.moved = true;
        const s = ctx.scale();
        let dx = (p.sx - hold.sx) / s;
        let dy = (p.sy - hold.sy) / s;
        if (ctx.snapping(p.event)) {
          // The pressed block's corner goes on the grid, the others with it; a connector has no corner of its own, so the
          // first picked block that has one leads (none: a connector's free ends, moved as they are).
          const has = (b) => b && Number.isFinite(b.x) && Number.isFinite(b.y);
          const pressed = hold.starts.find((b) => b.id === hold.id);
          const lead = has(pressed) ? pressed : hold.starts.find(has);
          if (lead) {
            dx = wbSnap(lead.x + dx) - lead.x;
            dy = wbSnap(lead.y + dy) - lead.y;
          }
          if (ctx.guides) ctx.guides([]);
        } else if (ctx.guiding && ctx.guiding(p.event)) {
          // The box round the dragged blocks, and the boxes it may line up with, once per drag.
          if (!hold.guide) hold.guide = ctx.guideBoxes(hold.starts.map((b) => b.id));
          const g = hold.guide;
          if (g && g.box) {
            const r = wbGuideSnap({ x0: g.box.x0 + dx, y0: g.box.y0 + dy, x1: g.box.x1 + dx, y1: g.box.y1 + dy }, g.near, GUIDE / s);
            dx += r.dx;
            dy += r.dy;
            ctx.guides(r.lines);
          }
        } else if (ctx.guides) ctx.guides([]);
        for (const b of hold.starts) ctx.change(b.id, wbMoved(b, dx, dy), { save: false });
      },
      up(p, ctx) {
        if (hold && hold.kind === 'grip') {
          if (hold.moved) ctx.save(hold.id); // once, where it is let go
          ctx.hold(hold.id, false);
          // A press without a drag on a grip that does something (a table's +): its fields, one save.
          const now = !hold.moved && hold.def.tap ? ctx.get(hold.id) : null;
          const fields = now ? hold.def.tap(now, hold.handle) : null;
          if (fields && fields.refuse) ctx.refuseWith(fields.refuse);
          else if (fields) ctx.change(hold.id, fields, { save: 'now' });
        }
        if (hold && hold.kind === 'resize') {
          if (hold.r.attach) ctx.ports([]);
          if (hold.moved) ctx.save(hold.id); // the whole new box, once
          ctx.hold(hold.id, false);
        }
        if (hold && hold.kind === 'block') {
          if (ctx.guides) ctx.guides([]);
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
        if (hold && hold.kind === 'grip') {
          if (hold.moved) ctx.change(hold.id, Object.fromEntries(hold.keys.map((k) => [k, hold.start[k]])), { save: false });
          ctx.hold(hold.id, false);
        }
        if (hold && hold.kind === 'resize') {
          if (hold.r.attach) ctx.ports([]);
          if (hold.moved) ctx.change(hold.id, before(hold.r, hold.start), { save: false });
          ctx.hold(hold.id, false);
        }
        if (hold && hold.kind === 'block') {
          if (ctx.guides) ctx.guides([]);
          for (const b of hold.starts) {
            if (hold.moved) ctx.change(b.id, wbMoved(b, 0, 0), { save: false });
            ctx.hold(b.id, false);
          }
        }
        if (hold && hold.kind === 'marquee') { ctx.marquee(null); ctx.setSelection(hold.keep); }
        hold = null;
      },
      deactivate(ctx) { this.cancel(ctx); last = { id: null, t: 0 }; },
    });
  }
