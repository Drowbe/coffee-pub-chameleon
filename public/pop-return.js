// Where a module goes when its own window is closed (canvas.js's comeBack). Pure, no document and no imports, so
// tools/check-canvas.mjs runs it in node.
//
// `from`: how it was shown before it left, 'dock' or 'float'. `narrow`: a phone, where every module is a tab (docked).
// `canDock` / `canFloat`: the modes the module supports. `full`: a docked module would find no room for another column.
// Answers { mode, why }: the mode to open it in, and `why` is 'full' when it had to float for lack of room (the person
// is told), else ''.
export function returnPlace({ from, narrow, canDock, canFloat, full } = {}) {
  if (narrow) return { mode: canDock ? 'dock' : 'float', why: '' };
  if (from === 'float') return { mode: canFloat ? 'float' : 'dock', why: '' };
  if (!canDock) return { mode: 'float', why: '' };
  if (full && canFloat) return { mode: 'float', why: 'full' };
  return { mode: 'dock', why: '' };
}
