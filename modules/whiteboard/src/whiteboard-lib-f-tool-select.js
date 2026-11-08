  // ---- whiteboard-lib-f-tool-select.js: pick, move and open blocks; move the board --------------------------------------
  // Press a block to pick it and drag it to move it (saved once, where it is dropped); press it twice quickly to edit it.
  // Press the board itself and drag to move the whole board. Someone who may only look can pick and move the board.
  {
    const SLOP = 4; // screen pixels a press may wander and still be a press, not a drag
    const TWICE = 400; // milliseconds between two presses that open a block
    let hold = null; // { kind: 'block' | 'board', ... } while the pointer is down
    let last = { id: null, t: 0 };
    tools.register({
      id: 'select',
      label: 'Select',
      icon: 'arrow-pointer',
      key: 'v',
      order: 10,
      edits: false,
      down(p, ctx) {
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
        if (!hold.moves) return;
        if (!hold.moved && Math.hypot(p.sx - hold.sx, p.sy - hold.sy) < SLOP) return;
        hold.moved = true;
        const s = ctx.scale();
        ctx.change(hold.id, { x: hold.ox + (p.sx - hold.sx) / s, y: hold.oy + (p.sy - hold.sy) / s }, { save: false });
      },
      up(p, ctx) {
        if (hold && hold.kind === 'block') {
          if (hold.moved) ctx.save(hold.id); // the drop is saved first, so a change from elsewhere held meanwhile is overtaken
          if (hold.moves) ctx.hold(hold.id, false);
          last = hold.moved ? { id: null, t: 0 } : { id: hold.id, t: Date.now() };
        }
        hold = null;
      },
      cancel(ctx) {
        if (hold && hold.kind === 'block' && hold.moved) ctx.change(hold.id, { x: hold.ox, y: hold.oy }, { save: false });
        if (hold && hold.kind === 'block' && hold.moves) ctx.hold(hold.id, false);
        hold = null;
      },
      deactivate() { hold = null; last = { id: null, t: 0 }; },
    });
  }
