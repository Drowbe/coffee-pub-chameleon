// ---- documents-lib-h-view.js: how wide the page is shown (the view: Fit width or a zoom level; no page, no host) ----------------
//
// A person's view is 'fit' (the sheet fills the window, up to fitMax) or a zoom level in percent (100 is Actual size: the 48rem
// sheet, centred). Zoom scales the sheet's width and its text together. The page keeps the choice per person, in this browser.
const DL_VIEW = Object.freeze({ fit: 'fit', levels: Object.freeze([50, 75, 100, 125, 150, 200]), actual: 100, sheetRem: 48, fitMaxRem: 120 });

// -> 'fit' or a level in DL_VIEW.levels; anything else (nothing, a stray value, a number between levels) is Fit width.
function dlCleanView(v) {
  if (v === 'fit') return 'fit';
  const n = typeof v === 'string' && /^\d{2,3}$/.test(v) ? Number(v) : v;
  return DL_VIEW.levels.includes(n) ? n : 'fit';
}
// The value kept in the browser, and read back.
const dlViewStore = (v) => String(dlCleanView(v));
const dlViewRead = (s) => dlCleanView(typeof s === 'string' ? s : null);
// What is said in the zoom label.
const dlViewLabel = (v) => { const c = dlCleanView(v); return c === 'fit' ? 'Fit width' : `${c}%`; };
// -> { zoom, widthRem, maxRem }: the scale of the sheet (its text with it) and its width in its own (scaled) rem; Fit width is
// the window's width (widthRem null) up to maxRem. The page also never lets the sheet pass the window.
function dlViewSheet(v) {
  const c = dlCleanView(v);
  if (c === 'fit') return { zoom: 1, widthRem: null, maxRem: DL_VIEW.fitMaxRem };
  return { zoom: c / 100, widthRem: DL_VIEW.sheetRem, maxRem: DL_VIEW.sheetRem };
}
// The next view for zoom in (dir 1) or zoom out (-1). Fit width counts as Actual size when stepping. Stops at the ends.
function dlViewStep(v, dir) {
  const c = dlCleanView(v);
  const at = DL_VIEW.levels.indexOf(c === 'fit' ? DL_VIEW.actual : c);
  const to = Math.min(DL_VIEW.levels.length - 1, Math.max(0, at + (dir < 0 ? -1 : 1)));
  return DL_VIEW.levels[to];
}
// What a key press asks for: 'in', 'out' or 'actual' (Ctrl or Cmd with + = - or 0, not with Alt), else null.
function dlViewKey(e) {
  if (!e || !(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key === '+' || e.key === '=') return 'in';
  if (e.key === '-' || e.key === '_') return 'out';
  if (e.key === '0') return 'actual';
  return null;
}
