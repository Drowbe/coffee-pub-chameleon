  // ---- whiteboard-lib-t-cursor-icon.js: the active tool's icon beside the mouse pointer -----------------------------------
  // Draw and insert tools show their icon a little down and right of the pointer (the crosshair stays). Select and Hand show
  // none (their own pointer says it), the Eraser has its own ring, and nobody who cannot edit, or is presenting, sees one.
  // Pure: the page draws it (renderer.cursorIcon). `icon`: the icon name of the tool's kind (its own icon, e.g. the Rectangle's).
  const WB_CURSOR_ICON_NONE = ['select', 'hand', 'eraser'];
  function wbToolCursorIcon(toolId, icon, ctx) {
    if (typeof toolId !== 'string' || !toolId || WB_CURSOR_ICON_NONE.includes(toolId)) return null;
    if (!ctx || !ctx.canEdit || ctx.presenting) return null;
    return typeof icon === 'string' && icon ? icon : null;
  }
