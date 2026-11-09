  // ---- whiteboard-lib-f-tool-hand.js: move the board -------------------------------------------------------------------
  // Press anywhere and drag to move the whole board, over blocks too; nothing on it is picked or changed. The same as holding
  // Space, or dragging with the middle or right mouse button, with any other tool (the page does those). `apart`: an on/off
  // button of its own beside the tool switch, not one of its choices.
  {
    let last = null; // { sx, sy } while the pointer is down
    tools.register({
      id: 'hand',
      label: 'Hand',
      icon: 'hand',
      key: 'h',
      order: 15,
      apart: true,
      edits: false,
      cursor: 'grab',
      down(p) { last = { sx: p.sx, sy: p.sy }; },
      move(p, ctx) {
        if (!last) return;
        ctx.panBy(p.sx - last.sx, p.sy - last.sy);
        last = { sx: p.sx, sy: p.sy };
      },
      up() { last = null; },
      cancel() { last = null; },
      deactivate() { last = null; },
    });
  }
