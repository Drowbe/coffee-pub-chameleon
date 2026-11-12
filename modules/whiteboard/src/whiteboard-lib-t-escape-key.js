  // ---- whiteboard-lib-t-escape-key.js: where an Escape goes ---------------------------------------------------------------
  // Escape always takes the person back to Select, wherever the keyboard focus is inside the Whiteboard: on the board (its own
  // key handler) or on the title bar or the toolbar around it (the frame's, outside the board). Pure: the page asks, then acts.
  // `from`: where the key was pressed, as the page found it from the event's path: 'board' (the board or a block), 'edit' (a text
  // edit), 'popup' (a menu, a dialog or a panel that has its own Escape), 'bars' (the title bar or the toolbar), anything else is
  // outside the Whiteboard. `handled`: something already took the key (preventDefault). `presenting`: present mode is on.
  // Returns 'board' (the board's own handler does it), 'select' (the frame's handler takes the person to Select and puts the
  // focus on the board) or 'none' (this key is somebody else's: a text edit, an open menu or dialog, present mode, other places).
  function wbEscapeRoute({ from, handled = false, presenting = false } = {}) {
    if (presenting || handled) return 'none';
    if (from === 'board') return 'board';
    if (from === 'bars') return 'select';
    return 'none';
  }
  // A tool button clicked with the mouse or a finger leaves the keyboard focus on the button, so the tool's letter would reach
  // the toolbar, not the board: the page puts the focus on the board when the pointer pressed within `within` ms before the change
  // (a press of Enter or Space on the button keeps its focus: the toolbar stays reachable by keyboard).
  function wbFocusBoardAfterChange(pointerAt, now, within = 700) {
    return typeof pointerAt === 'number' && typeof now === 'number' && now - pointerAt >= 0 && now - pointerAt <= within;
  }
