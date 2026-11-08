  // ---- whiteboard-lib-f-tool-place.js: put a note or words where you click ---------------------------------------------
  // Click the board and a note (centred on the click) or a text block (starting at it) is made there and opened for its
  // words; the tool goes back to Select. Another click-to-place block is one more entry in PLACE.
  {
    const PLACE = [
      { id: 'note', type: 'note', label: 'Note', icon: 'note-sticky', key: 'n', order: 30, centred: true },
      { id: 'text', type: 'text', label: 'Text', icon: 'font', key: 't', order: 40, centred: false },
    ];
    for (const t of PLACE) {
      let at = null;
      tools.register({
        id: t.id,
        label: t.label,
        icon: t.icon,
        key: t.key,
        order: t.order,
        edits: true,
        cursor: 'copy',
        down(p) { at = p; },
        up(p, ctx) {
          if (!at) return;
          const def = blockTypes.get(t.type);
          const own = def.create();
          const box = def.box({ ...own, x: 0, y: 0 });
          const x = t.centred ? at.x - box.w / 2 : at.x;
          const y = t.centred ? at.y - (box.h || 0) / 2 : at.y - 12;
          at = null;
          const b = ctx.draft(t.type, { x, y });
          ctx.select(b.id);
          ctx.setTool('select');
          ctx.edit(b.id, { fresh: true });
        },
        cancel() { at = null; },
      });
    }
  }
