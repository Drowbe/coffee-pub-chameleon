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

// ---- the list's look: rows or thumbnails (a person's own choice, kept in this browser) ----------------------------------------
const DL_LISTVIEWS = Object.freeze([{ id: 'list', label: 'List', icon: 'list' }, { id: 'thumbs', label: 'Thumbnails', icon: 'table-cells-large' }]);
// -> 'list' or 'thumbs'; anything else (nothing, a stray value) is the list.
const dlCleanListView = (v) => (v === 'thumbs' ? 'thumbs' : 'list');

// ---- the editor: the Markdown text box or the rich editor (a person's own choice, kept in this browser) -----------------------
// The two choices of the shared view switch in the editing bar, Markdown first: it is what people get until they choose.
const DL_EDITVIEWS = Object.freeze([{ id: 'markdown', label: 'Markdown', icon: 'hashtag' }, { id: 'rich', label: 'Rich text', icon: 'align-left' }]);
// The switch's choice for "is it the rich editor", and back: anything but 'rich' (nothing, a stray value) is Markdown.
const dlEditViewId = (rich) => (rich ? 'rich' : 'markdown');
const dlEditViewIsRich = (id) => id === 'rich';

// ---- the page: its size, in one place (print reuses these later: @page takes the same inches and millimetres) --------------------
// Letter is 8.5 by 11 inches, A4 is 210 by 297 millimetres; a screen inch is 96 px, so Letter is 816 by 1056 px and A4 794 by 1123.
// The margin is 1 inch all round. `w`, `h` and `text` (the area inside the margins) are px, derived from the real size.
const DL_PAGE_DPI = 96;
const DL_PAGE_MARGIN_IN = 1;
const DL_PAGE_SIZES = Object.freeze({
  letter: Object.freeze({ id: 'letter', label: 'Letter', inW: 8.5, inH: 11, atPage: '8.5in 11in' }),
  a4: Object.freeze({ id: 'a4', label: 'A4', mmW: 210, mmH: 297, atPage: '210mm 297mm' }),
});
// -> { id, label, w, h, margin, textW, textH, atPage } for 'letter' or 'a4' (anything else is Letter).
function dlPageGeometry(id) {
  const s = DL_PAGE_SIZES[id === 'a4' ? 'a4' : 'letter'];
  const px = (inches, mm) => Math.round(inches !== undefined ? inches * DL_PAGE_DPI : (mm / 25.4) * DL_PAGE_DPI);
  const w = px(s.inW, s.mmW);
  const h = px(s.inH, s.mmH);
  const margin = DL_PAGE_MARGIN_IN * DL_PAGE_DPI;
  return { id: s.id, label: s.label, w, h, margin, textW: w - 2 * margin, textH: h - 2 * margin, atPage: s.atPage };
}
// Fit width on a Paper sheet: the scale that makes the page as wide as the window, never more than twice its size.
const DL_PAGE_FIT_MAX = 2;
const dlPageFit = (avail, pageW) => (Number.isFinite(avail) && avail > 0 && pageW > 0 ? Math.min(DL_PAGE_FIT_MAX, avail / pageW) : 1);

// ---- the layout: Fluid or Paper (the document's own, kept in its record; the shared view switch in the editing bar) ----------------
const DL_LAYOUTS = Object.freeze([{ id: 'fluid', label: 'Fluid', icon: 'align-justify' }, { id: 'paper', label: 'Paper', icon: 'file' }]);
// The Page menu's entries after "Page colour...": the sizes, then the page numbers; -> [{ kind, id, label, current }].
function dlPageMenuModel(page) {
  const p = dlCleanPage(page);
  return [
    { kind: 'heading', label: 'Page size' },
    ...Object.values(DL_PAGE_SIZES).map((s) => ({ kind: 'size', id: s.id, label: s.label, current: p.pageSize === s.id })),
    { kind: 'heading', label: 'On the page' },
    { kind: 'numbers', id: 'numbers', label: 'Page numbers', current: p.pageNumbers },
    { kind: 'break', id: 'break', label: 'Page break', icon: 'scissors' },
  ];
}
