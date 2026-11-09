  // ---- whiteboard-lib-f-tool-connector.js: join blocks with a connector --------------------------------------------------
  // Press on a block (near the middle of a side for that side, else anywhere on it for the side that faces the other end)
  // and drag to another block, or to the board for a free end, and let go: a connector is made from one to the other, saved
  // once, picked, and the tool goes back to Select. A press on the board starts one from a free point. Blocks show their
  // connection points: the one under a mouse or a pen before a press, and the ends' blocks while dragging (a finger sees
  // them once it presses). A click with no drag, or a drag from the board to almost the same point, makes nothing. With
  // Snap to grid (ctx.snapping, turned round while Alt is held) a free end goes on the grid; an end on a block follows it.
  {
    const SLOP = 6; // screen pixels a press may wander and still be a click
    const at10 = (n) => Math.round(n * 10) / 10;
    const free = (p, ctx) => (ctx.snapping(p.event) ? { x: wbSnap(p.x), y: wbSnap(p.y) } : { x: at10(p.x), y: at10(p.y) });
    let drag = null; // { from, sx, sy, moved, id } while the pointer is down
    tools.register({
      id: 'connector',
      label: 'Connector',
      icon: 'arrows-turn-right',
      key: 'c',
      order: 90,
      edits: true,
      makes: 'connector',
      cursor: 'crosshair',
      hover(p, ctx) {
        const at = p ? ctx.attachAt(p) : null;
        ctx.ports(at ? [at] : []);
      },
      down(p, ctx) {
        const at = ctx.attachAt(p);
        drag = { from: at || free(p, ctx), sx: p.sx, sy: p.sy, moved: false, id: null };
        ctx.ports(at ? [at] : []);
      },
      move(p, ctx) {
        if (!drag) return;
        if (!drag.moved && Math.hypot(p.sx - drag.sx, p.sy - drag.sy) < SLOP) return;
        let at = ctx.attachAt(p, { not: drag.id ? [drag.id] : [] });
        if (at && drag.from.block !== undefined && drag.from.block === at.block) at = null; // not back onto its own block
        const to = at || free(p, ctx);
        if (!drag.moved) {
          drag.moved = true;
          drag.id = ctx.draft('connector', { from: drag.from, to }).id;
        } else ctx.change(drag.id, { to }, { save: false });
        ctx.ports([...(drag.from.block !== undefined ? [drag.from] : []), ...(at ? [at] : [])]);
      },
      up(p, ctx) {
        if (!drag) return;
        const d = drag;
        drag = null;
        ctx.ports([]);
        if (!d.moved || !d.id) return;
        const b = ctx.get(d.id);
        const loose = (e) => e.block === undefined;
        if (!b || (loose(b.from) && loose(b.to) && Math.hypot(b.to.x - b.from.x, b.to.y - b.from.y) * ctx.scale() < SLOP * 2)) { ctx.discard(d.id); return; }
        ctx.save(d.id);
        ctx.select(d.id);
        ctx.setTool('select');
      },
      cancel(ctx) {
        if (drag && drag.id) ctx.discard(drag.id);
        drag = null;
        ctx.ports([]);
      },
      deactivate(ctx) { this.cancel(ctx); },
    });
  }
