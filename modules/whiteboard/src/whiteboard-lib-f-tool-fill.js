  // ---- whiteboard-lib-f-tool-fill.js: fill a block with a colour, or take a colour from one -----------------------------
  // Click a block that has a background (its type's paint has a fill role) and it takes the fill colour: the one the Colour
  // menu sets for new blocks (ctx.nextFill()). Saved once, one undo step; a block that has it already is left alone. A
  // line, a drawing, a connector or a picture has no background: the pointer shows it cannot be filled, and a click does
  // nothing. With Alt (Option on a Mac) a click takes the colour from the block instead (its background, else its line)
  // and makes it the fill colour. The block under the pointer is marked, and a small swatch of the colour follows the
  // pointer (a mouse or a pen). Picking the tool unpicks every block, so the Colour menu sets its colour. The tool stays on
  // until another is picked; Escape goes back to Select. The rules are
  // wbFillAction (plain, tested on its own).
  //
  // wbFillAction(block, def, colour, alt) -> { kind: 'fill', fill } (fill it), { kind: 'pick', colour } (take its colour),
  // { kind: 'same' } (it has that fill), or { kind: 'no' } (nothing to fill, or no colour to take).
  function wbFillAction(block, def, colour, alt) {
    if (!block || !def) return { kind: 'no' };
    const has = (role) => Boolean(def.paint && def.paint[role]);
    if (alt) {
      for (const role of ['fill', 'stroke']) if (has(role) && WB_PALETTE_BY_ID.has(block[role])) return { kind: 'pick', colour: block[role] };
      return { kind: 'no' };
    }
    if (!has('fill') || !WB_PALETTE_BY_ID.has(colour)) return { kind: 'no' };
    return block.fill === colour ? { kind: 'same' } : { kind: 'fill', fill: colour };
  }
  {
    const SLOP = 6; // screen pixels a press may wander and still be a click
    let pressed = null; // { id, sx, sy, alt }: the block pressed, until the pointer lifts
    const actionAt = (p, ctx) => {
      const b = p && p.id ? ctx.get(p.id) : null;
      return { b, act: wbFillAction(b, b && blockTypes.get(b.type), ctx.nextFill(), Boolean(p && p.event && p.event.altKey)) };
    };
    tools.register({
      id: 'fill',
      label: 'Fill',
      icon: 'fill-drip',
      key: 'f',
      order: 96,
      edits: true,
      paints: 'fill',
      cursor: 'cell',
      hover(p, ctx) {
        if (!p) { ctx.mark(null); ctx.swatch(null); return; }
        const { b, act } = actionAt(p, ctx);
        ctx.mark(b ? b.id : null, act.kind === 'no' ? 'no' : 'ok');
        ctx.swatch({ sx: p.sx, sy: p.sy });
      },
      down(p, ctx) {
        const { b, act } = actionAt(p, ctx);
        pressed = b ? { id: b.id, sx: p.sx, sy: p.sy, alt: Boolean(p.event && p.event.altKey) } : null;
        if (b) ctx.mark(b.id, act.kind === 'no' ? 'no' : 'ok');
      },
      up(p, ctx) {
        const was = pressed;
        pressed = null;
        if (p.pointerType === 'touch') ctx.mark(null); // a finger does not hover: no mark left behind
        // A click: let go near where it was pressed (the pointer is held by the board, so the block is the one pressed).
        if (!was || Math.hypot(p.sx - was.sx, p.sy - was.sy) > SLOP) return;
        const b = ctx.get(was.id);
        const act = wbFillAction(b, b && blockTypes.get(b.type), ctx.nextFill(), was.alt);
        if (act.kind === 'fill') ctx.change(b.id, { fill: act.fill }, { save: 'now' });
        else if (act.kind === 'pick') ctx.setNextFill(act.colour);
        else if (act.kind === 'no' && b) ctx.refuse(b, was.alt);
      },
      // Nothing stays picked: the Colour menu is then the Fill tool's colour, not a picked block's.
      activate(ctx) { ctx.select(null); },
      cancel(ctx) { pressed = null; ctx.mark(null); },
      deactivate(ctx) { pressed = null; ctx.mark(null); ctx.swatch(null); },
    });
  }
