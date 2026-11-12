  // ---- whiteboard-lib-f-tool-insert.js: a click on a block with an insert tool on -------------------------------------------
  // An insert tool (Note, Text, Table, Rectangle, Ellipse and the Flowchart shapes) stays on so people keep adding blocks. A
  // click that lands on a block already there is almost always an edit or a move, not another block on top. So:
  //   edit   a block that takes words: its words open (a drag that starts on it moves it instead)
  //   select any other block, and a locked one: it is picked, nothing is put on it
  //   place  the empty board, a frame (put inside it, as before), a handle, or no one allowed to edit: as before
  // The page hands the gesture to Select for that one press, then the insert tool is still the tool.
  const WB_INSERT_TOOLS = ['note', 'text', 'table', 'rect', 'ellipse', 'rounded', 'diamond', 'pill', 'parallelogram'];
  // The one rule for "takes words": the block type has a words editor (Select's double press opens the same), a frame and a
  // connector aside (a frame is put into, a connector is picked).
  function wbTakesText(block) {
    if (!block || typeof block !== 'object' || block.type === 'frame' || block.type === 'connector') return false;
    const def = typeof blockTypes !== 'undefined' && typeof block.type === 'string' ? blockTypes.get(block.type) : null;
    return Boolean(def && (def.edit === 'text' || def.edit === 'cells'));
  }
  // block: the block pressed (or null); tool: the active tool; ctx: { canChange(block) }.
  function wbInsertClickAction(block, tool, ctx) {
    if (!block || typeof block !== 'object' || !tool || !WB_INSERT_TOOLS.includes(tool.id)) return 'place';
    if (block.type === 'frame') return 'place';
    if (!ctx || typeof ctx.canChange !== 'function') return 'place';
    if (block.locked === true) return 'select';
    if (!ctx.canChange(block)) return 'place';
    return wbTakesText(block) ? 'edit' : 'select';
  }
