// The canvas of a space: the Layout button and its menu, and every module the space has
// open on it. A module is either an installed one (a sandboxed frame driven by module-host.js)
// or a built-in one, the conference and the chat. Both work the same way and can be shown
// three ways:
//
//   docked   as a column of the space's grid: conference, chat, module...
//   floating as a draggable, resizable box over the call
//   window   as a window of its own
//
// A module's manifest says which of docked and floating it supports (both, if it
// does not say); every module can be popped into a window. Modules follow the call
// when it is popped out: they open in whichever window the canvas is in.
// See documentation/architecture/architecture-canvas.md.

import { api, markModuleRead, followTheme, word, fill, noticeToast } from '/brand.js';
import { mountModule, createFrameLift, openClearMenu, clearWithUndo, followClearable, registerDragRelay, createFrameBands, relayStreamToFrame, joinStream } from '/module-host.js';
import { createModuleFrame } from '/module-frame.js';
import { mountHostMenu } from '/host-menu.js';
import { fileWindowCount, closeAllFiles, openFile } from '/file-viewer.js';
import { nav } from '/nav-bar.js';
import { whatOpens, readAliased, firstVisitLayout, SYSTEM_TABS } from '/opens-with.js';
import { layoutOf, placeLayout, leftOutNote, groupColumns, splitHeights, dragShares, evenShares, cleanShares, stackRefusal, STACK, STACK_ID } from '/layouts.js';
import { TINTS, moduleTint } from '/module-tint.js';
import { MIN_W, MIN_H, SNAP_GAP, gridFor, cellBox, snapCell, leastSpan, clampCell, nearestFree, nextFree, resettle, tidyBoxes, fillBoxes, TIDY_GAP, DOCK_MIN, FLEX_MIN, NARROW, dockLimit, fitDock } from '/snap-grid.js';
import { composeList, aliasesFor, compositeById, compositesToAsk } from '/composites.js';

// What each space remembers (`app.canvas.<space>`; brand.js moves the old `app.panels` keys): the modules open when the person last used it,
// and each module's mode and sizes. `app.canvas` alone is what earlier versions kept for all
// spaces, and is the starting point for a space with nothing saved yet.
const STORE_KEY = 'app.canvas';
const storeKey = (spaceId) => `${STORE_KEY}.${spaceId}`;
// The module frame's title bar height (--mf-title-h, the moduleframe block of /sdk/system.css: 36px), read where it is used.
const headH = () => {
  const h = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mf-title-h'));
  return Number.isFinite(h) && h > 0 ? h : 36;
};
// A fixed column's least width (DOCK_MIN), the flexible column's (FLEX_MIN) and the narrow line (NARROW) are snap-grid.js's,
// beside fitDock(), the rule for how many columns a window holds (plan-docked-limit.md).

function readStore(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function loadSaved(spaceId) {
  const own = spaceId ? readStore(storeKey(spaceId)) : null;
  if (own) return own;
  const { __open, ...rest } = readStore(STORE_KEY) || {};
  return rest;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);


// `onNote(text)`: a short line for the Layout menu's note (#modules-menu-note), '' to clear it. `onMenu(open)`: the
// Layout menu opened (space.js reads its layouts again as it opens). `menuItems()`: the page's own entries for the
// menu's end (the Layouts section, space.js), in the shared menu's item shape (host-menu.js). `noteEl`: the page's note
// element, drawn as the menu's last row. `frameParams()`: what a composite's page is handed besides its space (the same
// handoff a page over the call gets: from=space and the names for its header), so a link inside it that leads on to
// another page keeps its way back. `onCompositeLoad(frame)`: each page that loads in a composite's frame, so the page
// can take the header links inside it (home, which must not navigate the top window away from the call).
export function createCanvas({ guestToken = null, onChatAsk = null, onNote = null, onMenu = null, menuItems = null, noteEl = null, frameParams = null, onCompositeLoad = null, onTabs = null, onPopBlocked = null } = {}) {
  // The phone's tab bar (#modules-menu, `sdk-tabbar-tabs` while the window is a phone's width: space.js's placeSubnav):
  // a tab per module, Chat first; the conference is not a tab there (the call is the bar's pinned call item, space.js).
  // Wider than a phone the Modules tab of Set up (mountMenu, below) is the one place to show and hide modules, drawn with
  // the page's shared menu (host-menu.js), opened from the top bar's Set up button (#setup, a nav tool of space.js).
  const menu = document.getElementById('modules-menu');
  // An inline menu (the tab bar) is always shown: it is never hidden or positioned by this file, only kept up to date.
  const inline = () => Boolean(menu && menu.classList.contains('sdk-tabbar-tabs'));
  const canvas = document.getElementById('canvas');
  // The always-on column beside the canvas (plan-one-bar.md, step 6; #side-column in space.html): wider than a phone
  // the conference and the chat live in it, in the mode `column`, not as columns of the grid, not in the Show list, not
  // in a saved layout. At 640px and below (isNarrow) there is no column and they are the phone's tabs, as before. A
  // page without the element (a module's own page) has no column mode at all.
  const column = document.getElementById('side-column');
  const columnMode = () => Boolean(column) && !isNarrow();
  const inColumn = (p) => p.mode === 'column';
  // The column's even while it is out of it: lifted over the Workspace (a screen share, or the person floating it) or
  // popped into a window of its own from the column (popBuiltin). Closing that window brings it back to the column.
  const columnOwned = (p) => inColumn(p) || Boolean(p.lifted) || Boolean(p.popped);
  const onCanvas = () => [...opened.values()].some((p) => !inColumn(p) && !p.popped); // whether anything is open on the canvas itself
  let saved = loadSaved(null);
  // Nothing is remembered until a join has restored the space's modules, and not while the space is
  // being torn down: closing every module on the way out must not become the layout.
  let suspended = true;
  const opened = new Map(); // id -> module; a module is open while it is in here
  const builtins = new Map(); // id -> the built-in module's definition (the conference and the chat)
  const canvasEmpty = document.getElementById('canvas-empty');
  let spaceId = null;
  // The modules on in this space for this person, as the server lists them (`modules`: Chat reads commands and names
  // by module id from it), and what the Workspace offers (`available`): the same list with each composite that is on
  // in its main module's place and the composite's other parts left out (composites.js; plan-calendar-todo.md,
  // step 3; plan-map-places.md, step 3). A composite (`dest:calendar`, `dest:map`) is one column or floating box
  // holding the destination's page at space scope in a frame; it opens, moves and closes as an installed module does,
  // under its own id.
  let modules = [];
  let available = [];
  // How a stored id reads here (composites.js's aliasesFor): a composite's part as the composite while it is on, a
  // composite as its parts that are on while it is off. opens-with.js and layouts.js read lists through the same map.
  let aliases = {};
  const readId = (id) => { const to = aliases[id]; return typeof to === 'string' ? to : Array.isArray(to) ? to[0] || id : id; };
  const compositeOf = (m) => (m && m.composite) || null;
  // Each module's colour in this space (plan-chat-model.md, decision 18), a tint name or null, from every module the
  // server listed, the ones kept out of the Layout menu (canvas.menu false) included: Chat colours a command's
  // messages by it. A module whose manifest names no colour gets a stable one from its id (module-tint.js, GitHub
  // #229), so every titlebar is told apart. A composite carries its main module's.
  let colors = new Map();
  const colorOf = (id) => { const c = compositeById(id); const base = c ? c.main : id; return moduleTint(base, colors.get(base) || null); };
  const tintAttr = (id) => (colorOf(id) ? ` data-tint="${colorOf(id)}"` : '');
  // What this space opens with, and the environment's list for a space that has none. Both null until a space is loaded.
  let spaceOpensWith = null;
  let spaceDefaultLayout = null; // the space's default layout when it is a shared one, whole (plan-saved-layouts.md, decision 4), or null
  // What a first visit opens, as the server resolved it (plan-layout-views.md, step 5): { layout, opensWith }, or null.
  let spaceFirstVisit = null;
  // Set by refresh() for the space just entered, used up by the restore that follows: only entering shows the first
  // visit's layout (a press on the Workspace tab restores the Workspace alone).
  let entering = false;
  let environmentOpensWith = null;
  let z = 40;
  let order = 0;
  let unread = {}; // module id -> unread notifications, from brand.js
  const builtinUnread = {}; // built-in module id -> unread count (the chat's messages)

  const canvasDoc = () => canvas.ownerDocument;
  const canvasWin = () => canvasDoc().defaultView || window;

  // A layer for floating modules in whichever window the call is in.
  const layers = new WeakMap();
  function layerFor(doc) {
    let layer = layers.get(doc);
    if (!layer) {
      layer = doc.createElement('div');
      layer.id = 'module-layer';
      layer.className = 'module-layer';
      doc.body.appendChild(layer);
      layers.set(doc, layer);
    }
    return layer;
  }
  // Floating modules live in their own layer, a sibling of the canvas, so hiding the canvas (space.js's
  // own space-list view, shown while still connected but not looking at this space) does not hide them
  // on its own -- without this they go on floating over whatever the space shows instead. Nothing is
  // torn down: the same modules reappear exactly as they were once the canvas comes back.
  function showFloating(show) {
    const layer = layers.get(canvasDoc());
    if (layer) layer.hidden = !show;
  }

  const supports = (p, mode) => (p.modes || ['dock', 'float']).includes(mode);

  // A narrow canvas has no room for a column. The line is the window's width (the same line as the space bar's tab
  // bar, max-width: 640px): the side column takes part of a wide window, so the canvas's own width would say narrow
  // where the window is not.
  function isNarrow() {
    const w = column ? canvasWin().innerWidth : canvas.clientWidth;
    return w > 0 ? w <= NARROW : canvas.classList.contains('narrow');
  }

  // `holdStore`: the grid-size slider's preview changes the layout on every step but writes it once, when let go.
  let holdStore = false;
  // Only the Workspace remembers (plan-layout-views.md, decision 15): while another layout tab is shown (holdMemory),
  // nothing is written to the browser, and `held` keeps the Workspace's arrangement as it was, for resumeMemory to put
  // back. { space, saved }: the space it belongs to and a copy of what was remembered.
  let held = null;
  // An arrangement (Panel Mode or Window Mode) chosen while the window is a phone's, for placeForWidth to put on the
  // canvas once it is wide again (GitHub #268).
  let arrangeOnWide = false;
  function persist() {
    if (!spaceId || holdStore || held) return; // an aside remembers nothing; another tab than the Workspace neither
    try {
      localStorage.setItem(storeKey(spaceId), JSON.stringify(saved));
    } catch {
      // private mode: modules still work, they just do not remember where they were
    }
  }

  // The modules open now, in column order.
  // A join that was asked to open one item (from the dashboard) opens just that module, once, and does not
  // become the space's remembered layout: nothing is saved until the person opens or closes a module themselves.
  let openRequest = null;
  let keepLayout = false;
  let restoring = false;
  function snapshot() {
    if (suspended || !spaceId || keepLayout) return;
    const ids = [...opened.values()].sort((a, b) => a.order - b.order).map((p) => p.id);
    // In column mode the conference and the chat are not the canvas's to remember: the list keeps whichever of the two
    // it held before (a phone reads it as its tabs), the chat when nothing was remembered yet (whatOpens's default).
    const prev = Array.isArray(saved.__open) ? saved.__open : guestToken ? ['conference', 'chat'] : ['chat'];
    const kept = (id) => prev.includes(id);
    saved.__open = columnMode() ? ids.filter((id) => { const p = opened.get(id); return !columnOwned(p) || kept(id); }) : ids;
    persist();
  }

  function remember(id, patch) {
    saved[id] = { ...(saved[id] || {}), ...patch };
    persist();
  }

  // --- floating: place, drag, resize ----------------------------------------

  function clampBox(box, win) {
    const maxW = Math.max(MIN_W, win.innerWidth - SNAP_GAP); // the grid's gutter: a module spanning every cell still fits
    const maxH = Math.max(MIN_H, win.innerHeight - SNAP_GAP);
    const w = Math.min(Math.max(box.w, MIN_W), maxW);
    const h = Math.min(Math.max(box.h, MIN_H), maxH);
    const x = Math.min(Math.max(box.x, 0), Math.max(0, win.innerWidth - w));
    const y = Math.min(Math.max(box.y, 0), Math.max(0, win.innerHeight - h));
    return { x, y, w, h };
  }

  function place(floater, box) {
    const win = floater.ownerDocument.defaultView || window;
    const b = clampBox(box, win);
    floater.style.left = `${b.x}px`;
    floater.style.top = `${b.y}px`;
    floater.style.width = `${b.w}px`;
    floater.style.height = `${b.h}px`;
    return b;
  }

  const currentBox = (floater) => ({ x: floater.offsetLeft, y: floater.offsetTop, w: floater.offsetWidth, h: floater.offsetHeight });
  const front = (floater) => { floater.style.zIndex = String(++z); };

  // --- snap: a floating module can snap to a grid over the canvas --------------
  // Floating is free by default (anywhere, any size). A module with `snap` on sits in the cells of a grid laid over
  // the canvas instead: dragged, it jumps from cell to cell; resized, it grows a cell at a time; and what is
  // remembered is its cells (`cell`: col, row, cols, rows), so it keeps its place in the grid when the window
  // changes size. Turning the grid on keeps a place the user dragged or resized (`layout: 'user'`, or a saved box
  // that does not sit on another). Windows still on a default spot are tiled so they do not stack. The grid is as many cells of about SNAP_CELL as the canvas fits (never fewer than one), gutter
  // SNAP_GAP, drawn (`.snap-grid`) only while a snapped module is being dragged. The grid sits half a gutter in from the
  // canvas's edges, so a window at the edge is a whole gutter from it, the same as from the next window. Docked and
  // window are untouched.
  // The grid's pitch (a cell's width; a cell is 0.77 as tall) is the canvas's: the space bar's slider sets it, remembered with
  // the space's layout (`__snap.pitch`), beside the canvas-level switch (`__snap.all`) that snaps every floating module, now and later.
  // That switch is the only one: a module's own `snap` (stored by an older version, per module and in saved layouts) is
  // read without error and ignored, and never written (Thomas, 2026-10-13).
  const SNAP_PITCH = { min: 50, max: 320, step: 10, default: 130 };
  const snapPitch = () => { const p = Number(saved.__snap?.pitch); return p >= SNAP_PITCH.min && p <= SNAP_PITCH.max ? p : SNAP_PITCH.default; };
  const snapAllOn = () => Boolean(saved.__snap?.all);
  const snapping = () => snapAllOn();
  function snapGrid() {
    const win = canvasWin();
    const r = canvas.getBoundingClientRect();
    const s = r.width > 0 && r.height > 0 ? r : { left: 0, top: 0, width: win.innerWidth, height: win.innerHeight };
    const half = SNAP_GAP / 2;
    return gridFor({ left: s.left + half, top: s.top + half, width: Math.max(1, s.width - SNAP_GAP), height: Math.max(1, s.height - SNAP_GAP) }, snapPitch());
  }
  // The grid's arithmetic (cellBox, snapCell, leastSpan, clampCell, nearestFree, nextFree, tileFresh, resettle) is in snap-grid.js.
  // Put a snapped module in its cells (its remembered ones, or the ones nearest its box) and remember both. `placed` is the
  // box it was put in, kept apart from `box` so a change of grid size can go back to it (setSnapPitch leaves it alone).
  function settleSnap(id, floater, cell, { keepPlaced = false } = {}) {
    const g = snapGrid();
    const c = clampCell(g, cell || snapCell(g, currentBox(floater)));
    const box = place(floater, cellBox(g, c));
    remember(id, keepPlaced ? { cell: c, box } : { cell: c, box, placed: { x: box.x - g.x, y: box.y - g.y, w: box.w, h: box.h } });
    return box;
  }
  // The cells already taken by snapped modules that are not part of this layout pass.
  function takenCells(exceptIds) {
    const g = snapGrid();
    const taken = [];
    for (const p of opened.values()) {
      if (exceptIds.has(p.id) || !snapping(p.id)) continue;
      if (saved[p.id]?.cell) taken.push(clampCell(g, saved[p.id].cell));
    }
    return taken;
  }
  // Snap a group: each module goes to the cells nearest where it is now, at about its size. One module alone (one
  // opening or floating while the grid is on) takes the free cells nearest it, clear of the snapped modules outside the group; a group (Snap to
  // grid in the Layout menu: every floating module) is settled together (snap-grid.js's resettle: none on another
  // where the grid has room, all a little smaller together where it has not). Nothing is tiled or moved further than
  // it must be: the grid going on keeps every window about where it was (Thomas, 2026-10-13).
  function applySnapLayout(mods) {
    const g = snapGrid();
    const live = mods.filter((x) => floaterOf(x));
    if (!live.length) return;
    if (live.length === 1) {
      const p = live[0];
      const cell = nearestFree(g, snapCell(g, currentBox(floaterOf(p))), takenCells(new Set([p.id])));
      settleSnap(p.id, floaterOf(p), cell);
      remember(p.id, { layout: 'user' });
      return;
    }
    const cells = resettle(g, live.map((p) => ({ id: p.id, box: currentBox(floaterOf(p)) })));
    for (const p of live) {
      settleSnap(p.id, floaterOf(p), cells.get(p.id));
      remember(p.id, { layout: 'user' });
    }
  }
  // A module opening while the grid is on: back to the cells the user left it in, or the next free spot.
  function snapOntoGrid(id, floater) {
    const rec = saved[id] || {};
    const g = snapGrid();
    const taken = takenCells(new Set([id]));
    if (rec.layout !== 'auto' && rec.cell) {
      settleSnap(id, floater, nearestFree(g, rec.cell, taken));
      return;
    }
    const least = leastSpan(g);
    settleSnap(id, floater, nextFree(g, taken, least.cols, least.rows) || nearestFree(g, { col: 0, row: 0, cols: least.cols, rows: least.rows }, taken));
    remember(id, { layout: 'auto' });
  }
  // The grid, drawn in the layer while a snapped module moves.
  function showGrid(layer, g) {
    let grid = layer.querySelector('.snap-grid');
    if (!grid) {
      grid = layer.ownerDocument.createElement('div');
      grid.className = 'snap-grid';
      layer.appendChild(grid);
    }
    grid.style.left = `${g.x}px`;
    grid.style.top = `${g.y}px`;
    grid.style.width = `${g.w}px`;
    grid.style.height = `${g.h}px`;
    grid.style.setProperty('--snap-cw', `${g.cw}px`);
    grid.style.setProperty('--snap-ch', `${g.ch}px`);
    layer.classList.add('snapping');
  }
  const hideGrid = (layer) => layer.classList.remove('snapping');
  // The box a module floats in (an installed module's is its own element; a built-in module's is around it).
  const floaterOf = (mod) => (mod.kind === 'builtin' ? mod.floatEl : mod.mode === 'float' ? mod.el : null);
  // The Layout menu's Snap to grid (Window Mode only; Thomas, 2026-10-13): on, every floating module, now and later,
  // sits in the grid's cells, each at the free cells nearest where it is (applySnapLayout); dragged, it jumps from cell to cell, resized, it grows a cell at a time. Off, every floating module is
  // free again where it is. Nothing docks or floats because of it: which modules float is the arrange mode's
  // (setArrangeMode). Remembered with the space's layout (`__snap.all`); an older `__snap.before` is not read.
  function setSnapAll(on) {
    saved.__snap = { ...(saved.__snap || {}), all: Boolean(on) };
    persist();
    const mods = [...opened.values()].filter((p) => floaterOf(p));
    if (on) applySnapLayout(mods);
  }
  // --- the arrange mode (Thomas, 2026-10-13: Panel Mode and Window Mode) --------------------------------------------
  // How the Workspace holds its modules, chosen in the Layout menu and remembered per person per space (`__mode`):
  //   panel    modules are docked, columns beside the call; a module opened later docks (preferredMode). Choosing it
  //            docks every floating module that can dock (dockAll).
  //   window   modules float as windows over the Workspace; a module opened later floats. Choosing it floats every
  //            docked module that can float, each at its last floating place where it has one, the rest tidied around
  //            them (tidyBoxes); with the grid on they snap. Only here the menu offers Snap to grid and Clean up.
  // A module's own titlebar still moves it either way; a saved layout keeps each module's own mode (layouts.js), and
  // loading one sets the mode to what it holds (all floating: window; else panel). Nothing stored before this reads as
  // Panel Mode. On a narrow canvas (a phone) there is one view at a time and the mode is not offered.
  const arrangeMode = () => (saved.__mode === 'window' ? 'window' : 'panel');
  function setArrangeMode(mode) {
    const want = mode === 'window' ? 'window' : 'panel';
    arrangeOnWide = isNarrow(); // no columns or windows on a phone: put on the canvas when it is wide (placeForWidth)
    saved.__mode = want;
    persist();
    if (want === 'panel') { dockAll(); return; }
    if (isNarrow()) { update(); return; }
    const columns = [...opened.values()].filter((p) => (p.mode === 'dock' || p.waiting) && !inColumn(p) && !p.lifted && supports(p, 'float')).sort(byOrder);
    const fresh = columns.filter((p) => !(saved[p.id]?.box && saved[p.id]?.layout === 'user'));
    hush += 1;
    try {
      for (const p of columns) setMode(p.id, 'float');
    } finally { hush -= 1; }
    // Those with no place of their own: tidied around the ones that have one, in column order. By id: a move makes
    // a new record for the module (moveModule), so the ones listed before it are stale.
    const doc = canvasDoc();
    const live = fresh.map((p) => opened.get(p.id)).filter((p) => p && floaterOf(p) && floaterOf(p).ownerDocument === doc);
    if (live.length) {
      const g = snapGrid();
      const area = { x: g.x + TIDY_GAP / 2, y: g.y + TIDY_GAP / 2, w: g.w - TIDY_GAP, h: g.h - TIDY_GAP }; // the grid is already half a gutter in: a gutter from the edge
      const taken = [...opened.values()].filter((p) => !live.includes(p) && floaterOf(p) && floaterOf(p).ownerDocument === doc).map((p) => currentBox(floaterOf(p)));
      const boxes = tidyBoxes(live.map((p) => ({ id: p.id, box: currentBox(floaterOf(p)) })), area, taken);
      for (const p of live) remember(p.id, { box: place(floaterOf(p), boxes.get(p.id)), layout: 'user' });
    }
    if (snapAllOn()) applySnapLayout([...opened.values()].filter((p) => floaterOf(p)));
    update();
  }
  // Panel Mode's dock (the Layout menu's Panel Mode): every floating module that can be a column goes back beside the
  // call. A module in a window of its own, and one that can only float, are left alone.
  // Through the fit (plan-docked-limit.md): what the window holds gets a column, in column order; the rest wait, floating,
  // and the menu's note says how many. Answers { docked, waiting }: how many of them docked, and how many wait now.
  function dockAll() {
    if (isNarrow()) { update(); return { docked: 0, waiting: 0 }; }
    // The conference and the chat first (they always have a column), then the others in the order they opened.
    const tried = [...opened.values()].filter((p) => p.mode === 'float' && !p.waiting && !p.lifted && supports(p, 'dock'))
      .sort((a, b) => (a.kind === 'builtin' ? 0 : 1) - (b.kind === 'builtin' ? 0 : 1) || byOrder(a, b)).map((p) => p.id);
    hush += 1;
    try {
      for (const id of tried) setMode(id, 'dock');
    } finally { hush -= 1; }
    syncDock();
    update();
    const docked = tried.filter((id) => opened.get(id)?.mode === 'dock').length;
    const waiting = [...opened.values()].filter((p) => p.waiting).length;
    if (waiting) note(`${docked} docked. ${waiting} ${waiting === 1 ? 'stays' : 'stay'} floating until the window is wide enough.`);
    else note('');
    return { docked, waiting };
  }
  // Clean up (the Layout menu, Window Mode; Thomas, 2026-10-13): every floating module on this canvas, in this window,
  // tiled to fill the whole Workspace, none on another, no room wasted (snap-grid.js's fillBoxes: a bigger window stays
  // bigger, each keeps its side, none below its least size while the Workspace holds them all). With the grid on the
  // tiles are whole cells of the grid; off, a small gutter (TIDY_GAP) keeps them apart and from the Workspace's edges.
  // Docked modules and modules in their own window are left alone. Remembered as a drag is (`layout: 'user'`). Answers
  // how many were placed.
  function cleanUp() {
    if (isNarrow()) return 0;
    const doc = canvasDoc();
    const mods = [...opened.values()].filter((p) => floaterOf(p) && floaterOf(p).ownerDocument === doc).sort((a, b) => a.order - b.order);
    if (!mods.length) return 0;
    const g = snapGrid(); // the canvas's box, in the layer's coordinates
    if (snapAllOn()) {
      const least = leastSpan(g);
      const cellOf = (p) => { const c = saved[p.id]?.cell ? clampCell(g, saved[p.id].cell) : snapCell(g, currentBox(floaterOf(p))); return { x: c.col, y: c.row, w: c.cols, h: c.rows }; };
      const tiles = fillBoxes(mods.map((p) => ({ id: p.id, box: cellOf(p) })), { x: 0, y: 0, w: g.cols, h: g.rows }, { least: { w: least.cols, h: least.rows }, integer: true });
      for (const p of mods) {
        const t = tiles.get(p.id);
        settleSnap(p.id, floaterOf(p), { col: t.x, row: t.y, cols: t.w, rows: t.h });
        remember(p.id, { layout: 'user' });
      }
      return mods.length;
    }
    // The grid's box is already half a gutter in from the canvas; each tile gives up the other half on every side, so a
    // window is a gutter from the next and from the edge. A tile is at least a module's smallest size plus the gutter,
    // so the smallest window still leaves it (place() would otherwise grow the window back over the gap).
    const half = TIDY_GAP / 2;
    const tiles = fillBoxes(mods.map((p) => ({ id: p.id, box: currentBox(floaterOf(p)) })), { x: g.x, y: g.y, w: g.w, h: g.h }, { least: { w: MIN_W + TIDY_GAP, h: MIN_H + TIDY_GAP } });
    for (const p of mods) {
      const t = tiles.get(p.id);
      const floater = floaterOf(p);
      const box = { x: Math.round(t.x + half), y: Math.round(t.y + half), w: Math.round(t.w - TIDY_GAP), h: Math.round(t.h - TIDY_GAP) };
      if (snapping(p.id)) { settleSnap(p.id, floater, snapCell(g, box)); } else { place(floater, box); remember(p.id, { box: currentBox(floater) }); }
      remember(p.id, { layout: 'user' });
    }
    return mods.length;
  }
  // The grid's size, from the space bar's slider: every snapped module is re-settled into the cells nearest the box it was
  // put in (`placed`), so it keeps about its size in pixels, not its count of cells, and none sits on another where the canvas
  // has room (snap-grid.js's resettle). Going back to the old size gives back the old boxes. While the slider moves
  // (`preview`) the grid shows, so the size can be seen, and the modules already sit where letting go leaves them.
  function setSnapPitch(px, { preview = false } = {}) {
    const pitch = Math.min(SNAP_PITCH.max, Math.max(SNAP_PITCH.min, Math.round(Number(px) || SNAP_PITCH.default)));
    holdStore = true;
    try { resnap(pitch); } finally { holdStore = false; }
    if (!preview) persist(); // stored once, when the slider is let go (a key press is a let go too)
    const layer = layerFor(canvasDoc());
    if (preview) showGrid(layer, snapGrid()); else hideGrid(layer);
  }
  function resnap(pitch) {
    const before = snapGrid();
    const snapped = [...opened.values()].filter((p) => floaterOf(p) && snapping(p.id));
    // A module snapped before `placed` was kept starts from where it is now, on the grid it is on now.
    for (const p of snapped) {
      if (saved[p.id]?.placed) continue;
      const b = currentBox(floaterOf(p));
      remember(p.id, { placed: { x: b.x - before.x, y: b.y - before.y, w: b.w, h: b.h } });
    }
    saved.__snap = { ...(saved.__snap || {}), pitch };
    const g = snapGrid();
    const cells = resettle(g, snapped.map((p) => {
      const b = saved[p.id].placed;
      return { id: p.id, box: { x: g.x + b.x, y: g.y + b.y, w: b.w, h: b.h } };
    }));
    for (const p of snapped) settleSnap(p.id, floaterOf(p), cells.get(p.id), { keepPlaced: true });
  }

  // Drag a floating module by `handle`, resize it by `grip`. A snapped module moves and grows by whole cells.
  function wireFloating(id, floater, handle, grip) {
    const layer = floater.parentNode;
    let drag = null;
    const begin = (kind) => (event) => {
      if (event.target.closest('button, input, textarea, a')) return;
      event.preventDefault();
      drag = { kind, sx: event.clientX, sy: event.clientY, box: currentBox(floater), grid: snapping(id) ? snapGrid() : null };
      layer.classList.add('dragging'); // frames swallow pointer events; switch them off while dragging
      if (drag.grid) showGrid(layer, drag.grid);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    };
    const move = (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.sx;
      const dy = event.clientY - drag.sy;
      const b = { ...drag.box };
      if (dx || dy) drag.moved = true;
      if (drag.kind === 'move') { b.x += dx; b.y += dy; } else { b.w += dx; b.h += dy; }
      place(floater, drag.grid ? cellBox(drag.grid, snapCell(drag.grid, b)) : b);
    };
    const end = () => {
      if (!drag) return;
      const g = drag.grid;
      const moved = drag.moved;
      drag = null;
      if (moved) settleWaiting(id); // a waiting module the person moves is floating by their choice
      layer.classList.remove('dragging');
      hideGrid(layer);
      if (g) {
        settleSnap(id, floater, snapCell(g, currentBox(floater)));
        remember(id, { layout: 'user' });
      } else remember(id, { box: currentBox(floater), layout: 'user' });
    };
    for (const [el, kind] of [[handle, 'move'], [grip, 'size']]) {
      el.addEventListener('pointerdown', begin(kind));
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }
    floater.addEventListener('pointerdown', () => front(floater));
  }

  // --- docked: columns of the grid ------------------------------------------

  const dockedModules = () => [...opened.values()].filter((p) => p.mode === 'dock').sort((a, b) => a.order - b.order);

  const maxDock = () => Math.max(DOCK_MIN, Math.round(canvas.clientWidth * 0.6));
  const clampDock = (w) => Math.min(Math.max(Math.round(w), DOCK_MIN), maxDock());

  // --- stacks (plan-panel-stacking.md) -------------------------------------------------------------------------------
  // A column of the canvas holds one docked module, or a stack: two or three docked modules one above the other, each in
  // its own frame, with a divider between two of them and a collapse on each. A stack is one column of the docked limit.
  // Which modules may be in one is the host's rule (decision 2): every docked module but the conference, the chat and a
  // composite (dest:*). What makes one is each module's record (`saved[id]`, remembered with the space's layout, and in a
  // saved layout: layouts.js): `stack` (the column's id), `at` (its place, top first), `h` (its share of the column's
  // height) and `folded` (the person collapsed it). The modules' sections stay where they are in the page (nothing is
  // moved, so a module in a frame is never loaded again): each one's content is laid in its column's grid area at its own
  // top and height (paintStacks), and a divider between two of them is the call and chat column's own splitter, turned.
  // Not on a phone (640 px and below): one view at a time there, the stack kept in what is remembered for a wide window.
  const canStack = (p) => Boolean(p) && p.kind === 'module' && !compositeOf(p.m) && supports(p, 'dock');
  const stackOf = (p) => { const s = canStack(p) ? saved[p.id]?.stack : null; return typeof s === 'string' && STACK_ID.test(s) ? s : null; };
  // The columns the modules in `mods` make, in column order (layouts.js's groupColumns): [{ key, stack, mods }], a stack's
  // modules top first. A stack id only one of them carries is an ordinary column (decision 8).
  function columnsFrom(mods) {
    const byId = new Map(mods.map((p) => [p.id, p]));
    return groupColumns(mods.map((p) => ({ id: p.id, order: p.order, stack: stackOf(p), at: saved[p.id]?.at })))
      .map((c) => ({ key: c.key, stack: c.stack, mods: c.ids.map((id) => byId.get(id)) }));
  }
  const stacked = (c) => Boolean(c) && c.mods.length > 1;
  // The flexible column: the conference's when it is docked, else the first.
  const flexOf = (cols) => cols.find((c) => c.mods.some((p) => p.def?.flex)) || cols[0];
  const listWords = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const newStackId = () => { let s = ''; while (!s) s = Math.random().toString(36).slice(2, 12).replace(/[^a-z0-9]/g, ''); return s; };
  // A section's least height: its title bar and 120 px under it (156 on the desktop's title bar; Thomas, on the Prototype).
  const sectionMin = () => Math.max(STACK.sectionMin, headH() + STACK.contentMin);
  const contentOf = (p) => (p && p.el && p.el.querySelector ? p.el.querySelector(':scope > .mod-content') : null);
  // A module out of its stack: no stack keys, and its own width again (`ownW`, kept when it was stacked and its width
  // became the column's), unless `restore` is false (a saved layout gives the width itself).
  function clearStackRecord(id, { restore = true } = {}) {
    if (!saved[id] || !['stack', 'at', 'h', 'folded', 'ownW'].some((k) => k in saved[id])) return;
    const { stack, at, h, folded, ownW, ...rest } = saved[id];
    if (restore && Number.isFinite(ownW) && stack) {
      rest.dockW = ownW;
      const p = opened.get(id);
      if (p && p.kind === 'module') p.width = clampDock(ownW);
    }
    saved[id] = rest;
  }

  // --- how many columns fit (plan-docked-limit.md) ----------------------------------------------------------------
  // A module whose remembered mode is dock wants a column. snap-grid.js's fitDock() says which get one at the canvas's
  // width: the conference and the chat always, installed modules from the left until the window is full. The rest are
  // waiting (`mod.waiting`): shown floating, their remembered mode still dock, and docked again, in their old place in the
  // column order, as soon as the canvas is wide enough. Dragging or resizing a waiting module makes it floating for good.
  // A stack is one column (decision 7): its modules dock or wait together.
  const wantsColumn = (p) => p.mode === 'dock' || Boolean(p.waiting);
  const byOrder = (a, b) => a.order - b.order;
  const dockWidthOf = (p) => p.width ?? clampDock(saved[p.id]?.dockW || p.m?.canvas?.width || p.def?.width || 320);
  // fitDock()'s columns: a stack's width is its top module's (every module in it has the column's width).
  const specsOf = (cols) => cols.map((c) => ({ id: c.key, width: dockWidthOf(c.mods[0]), flex: c.mods.some((p) => Boolean(p.def?.flex)), keep: c.mods.some((p) => p.kind === 'builtin') }));
  // The canvas's width; while it is hidden (the space list shown over a running call), the last width it had.
  let fitWidth = 0;
  const canvasWidth = () => { if (canvas.clientWidth > 0) fitWidth = canvas.clientWidth; return fitWidth; };
  // fitDock() over every module wanting a column now, and `extra` (one about to dock); `waiting` is the modules' ids.
  const planColumns = (extra = []) => {
    const cols = columnsFrom([...opened.values()].filter(wantsColumn).concat(extra));
    const plan = fitDock(canvasWidth(), specsOf(cols));
    const waits = new Set(plan.waiting);
    return { ...plan, cols, waiting: cols.filter((c) => waits.has(c.key)).flatMap((c) => c.mods.map((p) => p.id)) };
  };
  // Whether a module about to dock would get a column, or wait (one joining a stack needs no column of its own).
  const wouldWait = (p) => !isNarrow() && planColumns([{ ...p, order: order + 1, mode: 'dock', waiting: false }]).waiting.includes(p.id);

  // No note while the layout is put back on entering, a canvas pops out or back, or the window is resized: the change is
  // in front of the person, or is not theirs.
  let hush = 0;
  const quiet = () => hush > 0 || restoring || suspended;
  const nameOf = (id) => opened.get(id)?.m?.name || available.find((x) => x.id === id)?.name || builtins.get(id)?.name || id;
  let noteTimer = null;
  let noteAt = 0;
  function note(text) {
    clearTimeout(noteTimer);
    noteAt = Date.now();
    onNote?.(text);
    if (text) noteTimer = setTimeout(() => onNote?.(''), 6000);
  }
  function tellWaiting(ids) {
    if (!ids.length || quiet()) return;
    const names = ids.map(nameOf);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    note(names.length === 1
      ? `The window is too narrow for another column, so ${list} is floating. It docks when the window is wide enough.`
      : `The window is too narrow for another column, so ${list} are floating. They dock when the window is wide enough.`);
  }

  // A waiting module with no remembered box is placed tidily around the other floating modules.
  function placeWaiting(mod) {
    if (saved[mod.id]?.box || snapping(mod.id)) return;
    const doc = canvasDoc();
    const g = snapGrid();
    const area = { x: g.x + TIDY_GAP / 2, y: g.y + TIDY_GAP / 2, w: g.w - TIDY_GAP, h: g.h - TIDY_GAP };
    const taken = [...opened.values()].filter((p) => p !== mod && floaterOf(p) && floaterOf(p).ownerDocument === doc).map((p) => currentBox(floaterOf(p)));
    const box = tidyBoxes([{ id: mod.id, box: currentBox(mod.el) }], area, taken).get(mod.id);
    if (box) place(mod.el, box);
  }
  // A docked module gives up its column and waits, floating, in its place in the column order.
  function startWaiting(p) {
    const { order: keepOrder, width } = p;
    moveModule(p.id, 'float');
    const mod = opened.get(p.id);
    Object.assign(mod, { order: keepOrder, waiting: true, width });
    placeWaiting(mod);
  }
  // A waiting module docks again, in its old place in the column order, at its remembered width.
  function stopWaiting(p) {
    const { order: keepOrder, width } = p;
    moveModule(p.id, 'dock');
    const mod = opened.get(p.id);
    mod.order = keepOrder;
    // Its own width, not the one a narrower canvas would clamp it to on the way back (none on a narrow one: no columns).
    if (width) mod.width = isNarrow() ? width : clampDock(width);
  }
  // Fit the columns to the canvas: modules past the limit wait, waiting ones that now fit dock. Answers the ids that
  // started waiting. Not while a fit is already moving modules (moving one calls syncDock again), nor on a hidden canvas.
  let fitting = false;
  function fitColumns() {
    // While modules are being opened or closed together (entering, leaving, popping out), the fit waits for the end.
    if (fitting || suspended || canvas.clientWidth <= 0) return [];
    fitting = true;
    const started = [];
    try {
      const waits = new Set(planColumns().waiting);
      for (const p of [...opened.values()].sort(byOrder)) {
        if (p.kind !== 'module') continue; // the conference and the chat always have a column (fitDock's `keep`)
        if (p.mode === 'dock' && waits.has(p.id)) { startWaiting(p); started.push(p.id); }
        else if (p.waiting && !waits.has(p.id)) stopWaiting(p);
      }
    } finally {
      fitting = false;
    }
    tellWaiting(started);
    return started;
  }
  // Why a floating module's Dock as a panel (its "..." menu) is unavailable, or '': while it waits, and while the columns
  // are full (so a pick never stores a dock it cannot show). A stack counts as one column.
  function dockBlocked(p) {
    if (p.waiting) return 'Docks when the window is wide enough';
    const full = !isNarrow() && columnsFrom([...opened.values()].filter(wantsColumn)).length >= dockLimit(canvasWidth());
    return full ? 'The window is too narrow for another column' : '';
  }
  // A waiting module's box says so (data-waiting).
  function paintDockButtons() {
    for (const p of opened.values()) {
      if (p.kind !== 'module' || p.mode !== 'float' || !p.el) continue;
      p.el.toggleAttribute('data-waiting', Boolean(p.waiting));
    }
  }
  // A waiting module dragged or resized by the person floats for good (and leaves its stack).
  function settleWaiting(id) {
    const mod = opened.get(id);
    if (!mod?.waiting) return;
    mod.waiting = false;
    const left = dropFromStack(id);
    remember(id, { mode: 'float' });
    paintDockButtons();
    snapshot();
    if (left && !quiet()) note(`${nameOf(left)} has its own column again.`);
  }

  // Docked modules are the columns, in order: the conference, the chat, then modules. One
  // column is flexible and takes what is left: the conference when it is docked, else the
  // first column, so the canvas is never left with an empty column. The others keep
  // their widths while they fit, and shrink in step when they do not, none below DOCK_MIN (fitDock); a module past the
  // limit waits, floating (fitColumns). A stack is one column: its modules share the column's grid area (paintStacks).
  // On a narrow canvas CSS takes over (see architecture-canvas).
  function syncDock() {
    fitColumns();
    const docked = dockedModules();
    // The narrow layout keys off this, as it does off chat-open.
    canvas.classList.toggle('module-open', docked.some((p) => p.kind === 'module'));
    syncView();
    for (const p of opened.values()) p.el.classList?.remove('is-flex');
    for (const p of docked) for (const el of p.parts()) el.style.gridColumn = '';
    if (canvasEmpty) canvasEmpty.hidden = onCanvas();
    paintDockButtons();
    if (isNarrow() || !docked.length) {
      canvas.style.removeProperty('--canvas-cols');
      paintStacks([]);
      return;
    }
    const cols = columnsFrom(docked);
    const flex = flexOf(cols);
    for (const p of flex.mods) p.el.classList.add('is-flex');
    // Each module keeps the width it was given for when there is room again; only what is shown shrinks.
    const { widths } = fitDock(canvasWidth(), specsOf(cols));
    canvas.style.setProperty('--canvas-cols', cols.map((c) => (c === flex ? 'minmax(0, 1fr)' : `${widths.get(c.key) ?? DOCK_MIN}px`)).join(' '));
    // Both lines given: a stack's sections are laid in the column's area absolutely, where a missing end line is the canvas's edge.
    cols.forEach((c, i) => { for (const p of c.mods) for (const el of p.parts()) el.style.gridColumn = `${1 + i} / ${2 + i}`; });
    paintStacks(cols);
  }

  // When the fixed columns together are wider than the canvas allows, syncDock shows them squeezed in step
  // and the conference at its minimum. A drag would then change a stored width that is not what is on
  // screen, so the conference never moved. Called as a drag starts: each fixed column takes the width it is
  // showing, so the drag moves what the person sees (narrowing one gives the room to the conference).
  function settleDock() {
    const cols = columnsFrom(dockedModules());
    if (isNarrow() || cols.length < 2) return;
    const flex = flexOf(cols);
    const fixed = cols.filter((c) => c !== flex);
    const total = fixed.reduce((sum, c) => sum + dockWidthOf(c.mods[0]), 0);
    if (total <= canvasWidth() - FLEX_MIN) return;
    const { widths } = fitDock(canvasWidth(), specsOf(cols));
    for (const c of fixed) for (const p of c.mods) p.width = widths.get(c.key) ?? DOCK_MIN;
  }

  // Widening a column when there is no room left takes the width from the other fixed columns (each down to
  // its minimum), not by squeezing the one being dragged; the conference keeps what it has.
  function takeWidthFromOthers(mod) {
    const cols = columnsFrom(dockedModules());
    if (isNarrow() || cols.length < 2) return;
    const flex = flexOf(cols);
    const own = cols.find((c) => c.mods.includes(mod));
    if (!own || own === flex) return;
    const w = (c) => dockWidthOf(c.mods[0]);
    const fixed = cols.filter((c) => c !== flex);
    const others = fixed.filter((c) => c !== own);
    const excess = fixed.reduce((sum, c) => sum + w(c), 0) - Math.max(DOCK_MIN, canvasWidth() - FLEX_MIN);
    if (excess <= 0) return;
    const spare = others.reduce((sum, c) => sum + Math.max(0, w(c) - DOCK_MIN), 0);
    if (spare <= 0) return;
    const take = Math.min(excess, spare);
    for (const c of others) {
      const next = w(c) - Math.round(take * (Math.max(0, w(c) - DOCK_MIN) / spare));
      for (const p of c.mods) p.width = next;
    }
  }
  // The modules in `mod`'s column (itself alone when it is not in a stack).
  const columnMates = (mod) => columnsFrom(dockedModules()).find((c) => c.mods.includes(mod))?.mods || [mod];

  // --- a stack drawn: its sections, its dividers, its group ---------------------------------------------------------
  const dividers = new Map(); // `<stack>:<i>` -> the divider under the stack's section i
  const groups = new Map(); // stack id -> its group for a screen reader ("Stacked: To-do, Polls")
  const autoFolded = new Map(); // stack id -> which sections the short canvas collapsed, as last drawn (splitHeights)
  const keepOpen = new Map(); // stack id -> the module the person opened last (not the next one to collapse by itself)
  // Draw every stack in `cols` (syncDock's columns; none on a phone): each section's content at its top and height in its
  // column's grid area, the person's collapse and the short canvas's, a collapse button at the start of each title bar,
  // a divider between two sections. Every other module has none of it.
  function paintStacks(cols) {
    const doc = canvasDoc();
    const total = canvas.clientHeight;
    const liveDividers = new Set();
    const liveGroups = new Set();
    const inStack = new Set();
    cols.forEach((c, ci) => {
      if (!stacked(c)) return;
      const sid = c.stack;
      const ids = c.mods.map((p) => p.id);
      const { px, auto, open } = splitHeights(total, { h: ids.map((id) => saved[id]?.h), folded: ids.map((id) => saved[id]?.folded === true), keep: ids.indexOf(keepOpen.get(sid)) }, { titleH: headH(), min: sectionMin() });
      autoFolded.set(sid, auto);
      const owns = [];
      let y = 0;
      c.mods.forEach((p, i) => {
        inStack.add(p.id);
        const shut = !open.includes(i);
        const content = contentOf(p);
        p.el.classList.add('in-stack');
        p.el.classList.toggle('stack-top', i === 0);
        p.el.classList.toggle('stack-folded', shut);
        if (content) {
          content.id ||= `stack-section-${p.id}`;
          content.style.top = `${y}px`;
          content.style.height = `${px[i]}px`;
          owns.push(content.id);
        }
        paintFold(p, shut, !shut && open.length === 1);
        y += px[i];
        if (i === c.mods.length - 1) return;
        const key = `${sid}:${i}`;
        let dv = dividers.get(key);
        if (!dv || dv.ownerDocument !== doc) { dv?.remove(); dv = makeDivider(); dividers.set(key, dv); }
        if (dv.parentNode !== canvas) canvas.appendChild(dv);
        liveDividers.add(key);
        dv.id = `stack-divider-${sid}-${i}`;
        dv.style.gridColumn = `${1 + ci} / ${2 + ci}`;
        dv.style.top = `${y}px`;
        dv._stack = { sid, ids, i, px };
        paintDivider(dv, shut || !open.includes(i + 1));
        owns.push(dv.id);
      });
      // The stack is a group (its sections and dividers, top first), named by what it holds.
      let g = groups.get(sid);
      if (!g || g.ownerDocument !== doc) { g?.remove(); g = doc.createElement('div'); g.className = 'stack-group'; g.setAttribute('role', 'group'); groups.set(sid, g); }
      if (g.parentNode !== canvas) canvas.appendChild(g);
      liveGroups.add(sid);
      g.style.gridColumn = `${1 + ci} / ${2 + ci}`;
      g.setAttribute('aria-label', `Stacked: ${ids.map(nameOf).join(', ')}`);
      g.setAttribute('aria-owns', owns.join(' '));
    });
    for (const c of cols) if (stacked(c)) orderInPage(c);
    for (const p of opened.values()) if (p.kind === 'module' && !inStack.has(p.id)) clearSection(p);
    for (const [key, dv] of dividers) if (!liveDividers.has(key)) { dv.remove(); dividers.delete(key); }
    for (const [sid, g] of groups) if (!liveGroups.has(sid)) { g.remove(); groups.delete(sid); autoFolded.delete(sid); }
  }
  // The page's order follows the stack, top first, each divider right after the section above it, so the keyboard goes
  // top section, divider, next section (the plan's Accessibility), and again after Move up or a drag. A section is moved
  // with moveBefore(), which keeps a module's frame, its focus and an open editor window as they are (nothing loads
  // again); a browser without moveBefore() leaves the sections where they are (they would load again) and only the
  // dividers follow the section above them. Only what is out of place moves.
  function orderInPage(c) {
    const canMove = typeof canvas.moveBefore === 'function';
    const put = (node, after) => {
      if (!node || !after || after.parentNode !== canvas || after.nextSibling === node) return;
      if (canMove) canvas.moveBefore(node, after.nextSibling);
      else if (node.classList.contains('stack-divider')) canvas.insertBefore(node, after.nextSibling);
    };
    let prev = c.mods[0].el;
    c.mods.forEach((p, i) => {
      if (!i) return;
      const dv = dividers.get(`${c.stack}:${i - 1}`);
      put(dv, prev);
      prev = dv && dv.previousSibling === prev ? dv : prev;
      put(p.el, prev);
      prev = p.el;
    });
  }
  // The heights again, nothing else (a divider moved, a section collapsed, the canvas changed height).
  function relayoutStacks() {
    if (isNarrow()) return;
    paintStacks(columnsFrom(dockedModules()));
  }
  // A module not in a stack: no place of its own in the column, no collapse button.
  function clearSection(p) {
    p.el?.classList?.remove('in-stack', 'stack-top', 'stack-folded');
    const content = contentOf(p);
    if (content) { content.style.top = ''; content.style.height = ''; }
    p.frame?.titlebar?.querySelector(':scope > .stack-fold')?.remove();
  }
  // The collapse button at the start of a section's title bar: a real button, "Collapse Polls" or "Expand Polls" with
  // aria-expanded. The last open section cannot be collapsed (Thomas, on the Prototype): its button says so when pressed.
  function paintFold(p, shut, lastOpen) {
    const head = p.frame?.titlebar;
    if (!head) return;
    let b = head.querySelector(':scope > .stack-fold');
    if (!b) {
      b = head.ownerDocument.createElement('button');
      b.type = 'button';
      b.className = 'mf-icon-btn mf-titlebar-btn stack-fold';
      b.innerHTML = '<i class="fa-solid fa-chevron-down fa-fw" aria-hidden="true"></i>';
      const id = p.id;
      b.addEventListener('click', () => toggleFold(id, { say: true })); // said as the menu's Collapse says it
      head.prepend(b);
    }
    const words = `${shut ? 'Expand' : 'Collapse'} ${nameOf(p.id)}`;
    b.setAttribute('aria-label', words);
    b.dataset.tip = words;
    b.setAttribute('aria-expanded', String(!shut));
    if (p.frame.content?.id) b.setAttribute('aria-controls', p.frame.content.id);
    if (lastOpen) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
    b.querySelector('i').className = `fa-solid fa-chevron-${shut ? 'right' : 'down'} fa-fw`;
  }

  // The divider between two sections: the call and chat column's splitter (.side-column-splitter-h, style.css; Thomas:
  // "We should not reinvent this."), 8 px over the frames' edges and 14 on a coarse pointer, taking no height. A separator
  // that moves: dragged, or Up and Down (16 px; Shift, 64), Home and End (the least and the most the 156 px least allows),
  // Enter or a double click for equal heights. Next to a collapsed section it moves nothing and is not a tab stop.
  function makeDivider() {
    const dv = canvasDoc().createElement('div');
    dv.className = 'side-column-splitter side-column-splitter-h stack-divider';
    dv.setAttribute('role', 'separator');
    dv.setAttribute('aria-orientation', 'horizontal');
    dv.title = 'Drag to resize';
    const off = () => !dv._stack || dv.classList.contains('stack-divider-off');
    let press = null;
    dv.addEventListener('pointerdown', (event) => {
      if (off() || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      press = { y: event.clientY, a: dv._stack.px[dv._stack.i] };
      dv.classList.add('dragging');
      canvas.classList.add('resizing-stack'); // a frame under the pointer would swallow the drag
      dv.setPointerCapture?.(event.pointerId);
    });
    dv.addEventListener('pointermove', (event) => { if (press) moveDivider(dv, press.a + event.clientY - press.y, { store: false }); });
    const stop = () => {
      if (!press) return;
      press = null;
      dv.classList.remove('dragging');
      canvas.classList.remove('resizing-stack');
      persist();
    };
    dv.addEventListener('pointerup', stop);
    dv.addEventListener('pointercancel', stop);
    dv.addEventListener('dblclick', () => { if (!off()) evenHeights(dv._stack.sid); });
    dv.addEventListener('keydown', (event) => {
      if (off()) return;
      const { i, px } = dv._stack;
      const step = event.shiftKey ? 64 : 16;
      if (event.key === 'ArrowUp') moveDivider(dv, px[i] - step);
      else if (event.key === 'ArrowDown') moveDivider(dv, px[i] + step);
      else if (event.key === 'Home') moveDivider(dv, 0);
      else if (event.key === 'End') moveDivider(dv, px[i] + px[i + 1]);
      else if (event.key === 'Enter') evenHeights(dv._stack.sid);
      else return;
      event.preventDefault();
    });
    return dv;
  }
  // Its name and value: the upper section's share of the two, in percent, within what the least height allows.
  function paintDivider(dv, off) {
    const { ids, i, px } = dv._stack;
    dv.classList.toggle('stack-divider-off', off);
    dv.setAttribute('aria-label', `Resize ${nameOf(ids[i])} and ${nameOf(ids[i + 1])}`);
    if (off) {
      for (const k of ['tabindex', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow']) dv.removeAttribute(k);
      return;
    }
    const a = px[i];
    const both = Math.max(1, px[i] + px[i + 1]);
    const lo = Math.round((100 * sectionMin()) / both);
    dv.tabIndex = 0;
    dv.setAttribute('aria-valuemin', String(Math.min(lo, 50)));
    dv.setAttribute('aria-valuemax', String(Math.max(100 - lo, 50)));
    dv.setAttribute('aria-valuenow', String(Math.round((100 * a) / both)));
  }
  // The section above `dv` to be `upper` px tall: only the two beside it change (layouts.js's dragShares).
  function moveDivider(dv, upper, { store = true } = {}) {
    const { ids, i, px } = dv._stack;
    const shares = cleanShares(ids.map((id) => saved[id]?.h), ids.length);
    const next = dragShares({ px, h: shares, i, upper, min: sectionMin() }).h;
    ids.forEach((id, k) => { saved[id] = { ...(saved[id] || {}), h: next[k] }; });
    relayoutStacks();
    if (store) persist();
  }
  function evenHeights(sid, { say = true } = {}) {
    const c = columnsFrom(dockedModules()).find((x) => x.stack === sid);
    if (!stacked(c)) return;
    const shares = evenShares(c.mods.length);
    c.mods.forEach((p, k) => { saved[p.id] = { ...(saved[p.id] || {}), h: shares[k] }; });
    persist();
    relayoutStacks();
    if (say) note(`${listWords(c.mods.map((p) => nameOf(p.id)))} have equal heights.`);
  }
  // Collapse or expand a section (its button, or Collapse and Expand in its menu). Answers whether it is collapsed now, or
  // null when it could not change: the last open section stays open.
  function toggleFold(id, { say = false } = {}) {
    const c = columnsFrom(dockedModules()).find((x) => x.mods.some((p) => p.id === id));
    if (!stacked(c)) return null;
    const i = c.mods.findIndex((p) => p.id === id);
    const auto = autoFolded.get(c.stack) || [];
    const shutAt = (p, k) => saved[p.id]?.folded === true || Boolean(auto[k]);
    const shut = shutAt(c.mods[i], i);
    if (!shut && c.mods.filter((p, k) => !shutAt(p, k)).length <= 1) {
      note(`${nameOf(id)} can't be collapsed. The last open one stays open.`);
      return null;
    }
    if (shut) { remember(id, { folded: false }); keepOpen.set(c.stack, id); } else remember(id, { folded: true });
    relayoutStacks();
    if (say) note(`${nameOf(id)} ${shut ? 'expanded' : 'collapsed'}.`);
    return !shut;
  }

  // --- a stack changed: the columns rearranged --------------------------------------------------------------------------
  // The columns of every module wanting one, as plain lists to change: [{ ids, stack, width }], in column order.
  const currentColumns = () => columnsFrom([...opened.values()].filter(wantsColumn)).map((c) => ({ ids: c.mods.map((p) => p.id), stack: c.stack, width: dockWidthOf(c.mods[0]) }));
  // Put the columns in this order and grouping, `cols` from currentColumns() changed: each module's place in the column
  // order (the order values they had, given out again in the new order), and each stack's records (`even`: a new stack, or
  // one joined, starts with equal heights, decision 6; else each keeps its share, the rest closing up). A column of one
  // keeps no stack. Every module of a column takes the column's width.
  function arrange(cols) {
    const pool = cols.flatMap((c) => c.ids).map((id) => opened.get(id)?.order).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    let k = 0;
    for (const c of cols) {
      if (c.ids.length < 2) clearStackRecord(c.ids[0]);
      else {
        const sid = c.stack || newStackId();
        const shares = c.even ? evenShares(c.ids.length) : cleanShares(c.ids.map((id) => saved[id]?.h), c.ids.length);
        c.ids.forEach((id, at) => {
          const was = saved[id] || {};
          const own = Number.isFinite(was.ownW) ? was.ownW : was.stack ? undefined : (opened.get(id)?.mode === 'dock' ? opened.get(id).width : undefined) ?? was.dockW;
          saved[id] = { ...was, stack: sid, at, h: shares[at], folded: was.folded === true, ...(Number.isFinite(own) ? { ownW: own } : {}) };
          if (c.width) {
            saved[id].dockW = c.width;
            const p = opened.get(id);
            if (p && p.mode === 'dock') p.width = c.width;
          }
        });
      }
      for (const id of c.ids) { const p = opened.get(id); if (p && k < pool.length) p.order = pool[k++]; }
    }
    persist();
  }
  // A module leaves its stack (closed, floated, popped out): the others close up, and a stack left with one module is an
  // ordinary column at once (decision 8). Answers the id of that module, or null. Not while a layout is put back or the
  // modules are opened again together (entering, leaving, a pop-out of the canvas): what is remembered stays.
  function dropFromStack(id) {
    if (suspended || restoring) return null;
    const sid = typeof saved[id]?.stack === 'string' ? saved[id].stack : null;
    if (!sid) return null;
    clearStackRecord(id);
    const rest = [...opened.values()].filter((p) => p.id !== id && wantsColumn(p) && stackOf(p) === sid)
      .sort((a, b) => (saved[a.id]?.at ?? 99) - (saved[b.id]?.at ?? 99));
    if (rest.length === 1) { clearStackRecord(rest[0].id); persist(); return rest[0].id; }
    const shares = cleanShares(rest.map((p) => saved[p.id]?.h), rest.length);
    rest.forEach((p, at) => { saved[p.id] = { ...saved[p.id], at, h: shares[at] }; });
    persist();
    return null;
  }
  // After a layout is put back (entering, a saved layout): the stacks made whole from what opened (layouts.js's rules:
  // two or three modules that may stack, `at` with no gap, the shares cleaned, never every one collapsed), and a stack
  // record on a module not in one let go.
  function tidyStackRecords() {
    const kept = new Set();
    for (const c of columnsFrom([...opened.values()].filter(wantsColumn))) {
      if (!stacked(c)) continue;
      const shares = cleanShares(c.mods.map((p) => saved[p.id]?.h), c.mods.length);
      const allFolded = c.mods.every((p) => saved[p.id]?.folded === true);
      const width = dockWidthOf(c.mods[0]); // one column, one width: the top module's
      c.mods.forEach((p, at) => {
        if (p.mode === 'dock') p.width = width;
        saved[p.id] = { ...saved[p.id], at, h: shares[at], dockW: width, folded: saved[p.id]?.folded === true && !(allFolded && at === c.mods.length - 1) };
        kept.add(p.id);
      });
    }
    for (const id of Object.keys(saved)) if (!id.startsWith('__') && saved[id] && typeof saved[id] === 'object' && !kept.has(id)) clearStackRecord(id);
    persist();
  }

  // Why `id` cannot go into column `c` (columnsFrom's) as a section: a short line, or ''.
  function refusalFor(id, c) {
    const code = stackRefusal({ mover: canStack(opened.get(id)), target: c.mods.every(canStack), n: c.mods.length, inIt: c.mods.some((p) => p.id === id), height: canvas.clientHeight, min: sectionMin() });
    if (code === 'mover') return `${nameOf(id)} can't be in a stack.`;
    if (code === 'target') return `${nameOf(c.mods[0].id)} can't hold a stack.`;
    if (code === 'full') return fill('A stack holds three {modules} at most.');
    if (code === 'short') return fill('The {canvas} is too short to stack here.');
    return '';
  }
  // Why `id` cannot have a column of its own now (out of its stack), or ''.
  function ownColumnBlocked(id) {
    const cols = currentColumns();
    const c = cols.find((x) => x.ids.includes(id));
    const extra = !c || c.ids.length > 1 ? 1 : 0;
    return extra && cols.length + extra > dockLimit(canvasWidth()) ? 'The window is too narrow for another column.' : '';
  }
  const focusMenuOf = (id) => requestAnimationFrame(() => opened.get(id)?.frame?.titlebar?.querySelector('.mf-titlebar-menu')?.focus());

  // Stack `id` above or below `targetId` (a drop on a zone, or Stack with... in its menu). A floating module docks and
  // stacks in one step (decision 5). Answers whether it did.
  function stackInto(id, targetId, pos, { focus = false } = {}) {
    const p = opened.get(id);
    const target = columnsFrom(dockedModules()).find((c) => c.mods.some((x) => x.id === targetId));
    if (!p || !target || id === targetId) return false;
    const why = refusalFor(id, target);
    if (why) { note(why); return false; }
    const cols = currentColumns();
    const into = cols.find((c) => c.ids.includes(targetId));
    const from = cols.find((c) => c.ids.includes(id));
    if (from) from.ids.splice(from.ids.indexOf(id), 1);
    const left = from && from !== into && from.ids.length === 1 ? from.ids[0] : null;
    const within = from === into; // moved inside its own stack: every section keeps its share and its collapse, as Move up
    const held = into.ids.slice(); // the column's modules before this one joins
    into.ids.splice(into.ids.indexOf(targetId) + (pos === 'below' ? 1 : 0), 0, id);
    if (!saved[id]) saved[id] = {};
    if (!within) {
      saved[id].folded = false;
      if (held.length < 2) into.even = true; // a new stack starts with equal heights (decision 6)
      else {
        // Joining a stack: the newcomer an equal part, the others keep their proportions in the rest.
        const shares = cleanShares(held.map((x) => saved[x]?.h), held.length);
        held.forEach((x, k) => { saved[x] = { ...(saved[x] || {}), h: (shares[k] * held.length) / (held.length + 1) }; });
        saved[id].h = 1 / (held.length + 1);
      }
    }
    const next = cols.filter((c) => c.ids.length);
    const floating = p.mode === 'float' && !p.waiting;
    arrange(next);
    if (floating) {
      hush += 1;
      try { setMode(id, 'dock'); } finally { hush -= 1; }
      const now = opened.get(id);
      if (now && now.mode === 'dock') { now.width = into.width; syncDock(); }
    } else syncDock();
    update();
    note(`${nameOf(id)} was stacked ${pos === 'above' ? 'above' : 'under'} ${nameOf(targetId)}.${left ? ` ${nameOf(left)} has its own column again.` : ''}`);
    if (focus) focusMenuOf(id);
    return true;
  }
  // Give `id` a column of its own before the column at `index` (as the columns are now), out of its stack, or move its
  // column there (a drop on a column's edge, Move out of the stack). Answers whether it did.
  function moveToColumn(id, index, { focus = false } = {}) {
    const cols = currentColumns();
    const from = cols.find((c) => c.ids.includes(id));
    if (!from) return false;
    const wasStacked = from.ids.length > 1;
    const why = ownColumnBlocked(id);
    if (why) { note(why); return false; }
    from.ids.splice(from.ids.indexOf(id), 1);
    const left = wasStacked && from.ids.length === 1 ? from.ids[0] : null;
    const next = cols.filter((c) => c.ids.length);
    const at = cols.slice(0, Math.max(0, index)).filter((c) => next.includes(c)).length;
    next.splice(at, 0, { ids: [id], stack: null, width: from.width });
    arrange(next);
    syncDock();
    update();
    if (wasStacked) note(`${nameOf(id)} has its own column again.${left ? ` So has ${nameOf(left)}.` : ''}`);
    if (focus) focusMenuOf(id);
    return true;
  }
  // Move a section one place up or down in its stack.
  function moveInStack(id, step) {
    const cols = currentColumns();
    const c = cols.find((x) => x.ids.includes(id));
    const i = c ? c.ids.indexOf(id) : -1;
    const j = i + step;
    if (!c || c.ids.length < 2 || j < 0 || j >= c.ids.length) return;
    [c.ids[i], c.ids[j]] = [c.ids[j], c.ids[i]];
    arrange(cols);
    syncDock();
    update();
    note(`${nameOf(id)} moved ${step < 0 ? 'up' : 'down'}.`);
    focusMenuOf(id);
  }
  // Unstack all, in Arrange (the Modules tab of Set up; decision 9): every module of every stack in a column of its own, where it was; past the
  // docked limit the rightmost ones float and wait, as Panel Mode's do (fitColumns says so).
  const hasStacks = () => columnsFrom(dockedModules()).some(stacked);
  function unstackAll() {
    const cols = currentColumns();
    if (!cols.some((c) => c.ids.length > 1)) return;
    const waitingBefore = [...opened.values()].filter((p) => p.waiting).length;
    arrange(cols.flatMap((c) => c.ids.map((id) => ({ ids: [id], stack: null, width: c.width }))));
    syncDock();
    update();
    if ([...opened.values()].filter((p) => p.waiting).length <= waitingBefore) note(fill('Every {module} has its own column again.'));
  }

  // The stack entries in a module's title bar menu (module-frame.js's `extra`), after the window's own (Dock as a panel's
  // siblings): Stack with... for a docked or floating module that may stack (a floating one docks and stacks in one step,
  // decision 5), and in a stack Move up, Move down, Move out of the stack, Collapse or Expand, Equal heights. None on a
  // phone. Every drag has its menu route here, for the keyboard, a screen reader and a finger.
  function stackTargets(id) {
    const cols = columnsFrom(dockedModules());
    const own = cols.find((c) => c.mods.some((p) => p.id === id));
    return cols.filter((c) => c !== own && c.mods.every(canStack));
  }
  function stackWithItems(id) {
    const out = [];
    for (const c of stackTargets(id)) {
      out.push({ heading: listWords(c.mods.map((p) => nameOf(p.id))) });
      const why = refusalFor(id, c);
      if (why) { out.push({ label: c.mods.length >= STACK.max ? fill('Full: three {modules}') : 'Too short here', disabled: true }); continue; }
      const top = c.mods[0].id;
      out.push({ label: `Above ${nameOf(top)}`, icon: 'arrow-up', onPick: () => stackInto(id, top, 'above', { focus: true }) });
      for (const p of c.mods) out.push({ label: `Below ${nameOf(p.id)}`, icon: 'arrow-down', onPick: () => stackInto(id, p.id, 'below', { focus: true }) });
    }
    return out;
  }
  function stackMenu(id) {
    const p = opened.get(id);
    if (!p || isNarrow() || !canStack(p) || (p.mode !== 'dock' && p.mode !== 'float')) return [];
    const out = [];
    const targets = stackTargets(id);
    out.push(targets.length
      ? { label: 'Stack with...', icon: 'layer-group', items: () => stackWithItems(id) }
      : { label: 'Stack with...', icon: 'layer-group', disabled: true, hint: 'No column here can hold it' });
    const c = p.mode === 'dock' ? columnsFrom(dockedModules()).find((x) => x.mods.includes(p)) : null;
    if (!stacked(c)) return out;
    const i = c.mods.indexOf(p);
    const auto = autoFolded.get(c.stack) || [];
    const shutAt = (x, k) => saved[x.id]?.folded === true || Boolean(auto[k]);
    const shut = shutAt(p, i);
    const lastOpen = !shut && c.mods.filter((x, k) => !shutAt(x, k)).length <= 1;
    if (i > 0) out.push({ label: 'Move up', icon: 'arrow-up', onPick: () => moveInStack(id, -1) });
    if (i < c.mods.length - 1) out.push({ label: 'Move down', icon: 'arrow-down', onPick: () => moveInStack(id, 1) });
    out.push({ label: 'Move out of the stack', icon: 'object-ungroup', onPick: () => { const cols = currentColumns(); moveToColumn(id, cols.findIndex((x) => x.ids.includes(id)) + 1, { focus: true }); } });
    out.push({ label: shut ? 'Expand' : 'Collapse', icon: shut ? 'chevron-down' : 'chevron-up', ...(lastOpen ? { disabled: true, hint: 'The last one open' } : {}), onPick: () => { toggleFold(id, { say: true }); focusMenuOf(id); } });
    out.push({ label: 'Equal heights', icon: 'equals', onPick: () => { evenHeights(c.stack); focusMenuOf(id); } });
    return out;
  }

  // --- the title bar drag: move between columns, or stack ---------------------------------------------------------------
  // A docked module is dragged by its titlebar (more than 6 px; buttons in the bar still click). While it moves, the place
  // it would take is drawn over the module under the pointer (Thomas's choice on the Prototype, the preview): its upper
  // half stacks it above, its lower half below, in words as well as in the accent ("Polls goes under To-do"); the outer
  // eighth of a column at each side moves it between columns, with a line where it would land. Nothing is drawn where a
  // stack cannot go (the conference, the chat, a composite, a full stack, a canvas too short): a drop there does nothing
  // and the note says why. Letting go makes the change; Escape takes it back. All of it is in the menus too (stackMenu).
  let drag = null;
  let zoneLayer = null;
  const relRect = (r) => { const cr = canvas.getBoundingClientRect(); return { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height }; };
  // A column's box on the canvas: its modules' content (a module's) or parts (the conference's, the chat's).
  function columnRect(c) {
    const boxes = c.mods.flatMap((p) => (p.kind === 'module' ? [contentOf(p)] : p.parts())).filter(Boolean).map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    if (!boxes.length) return null;
    const left = Math.min(...boxes.map((r) => r.left)); const top = Math.min(...boxes.map((r) => r.top));
    const right = Math.max(...boxes.map((r) => r.right)); const bottom = Math.max(...boxes.map((r) => r.bottom));
    return relRect({ left, top, width: right - left, height: bottom - top });
  }
  function zonesFor(id) {
    const out = [];
    const cols = columnsFrom(dockedModules());
    cols.forEach((c, ci) => {
      const r = columnRect(c);
      if (!r) return;
      const own = c.mods.some((p) => p.id === id);
      if (own && c.mods.length === 1) return; // its own column: nothing to do there
      const edge = Math.max(24, r.w / 8);
      out.push({ kind: 'move', index: ci, x: r.x, y: r.y, w: edge, h: r.h, line: r.x });
      out.push({ kind: 'move', index: ci + 1, x: r.x + r.w - edge, y: r.y, w: edge, h: r.h, line: r.x + r.w });
      const why = refusalFor(id, c);
      if (why) { out.push({ kind: 'refused', why, x: r.x + edge, y: r.y, w: r.w - 2 * edge, h: r.h }); return; }
      for (const p of c.mods) {
        if (p.id === id) continue;
        const sr = relRect(contentOf(p).getBoundingClientRect());
        const n = c.mods.length + (own ? 0 : 1);
        out.push({ kind: 'stack', target: p.id, pos: 'above', x: r.x + edge, y: sr.y, w: r.w - 2 * edge, h: sr.h / 2, sec: sr, col: r, n });
        out.push({ kind: 'stack', target: p.id, pos: 'below', x: r.x + edge, y: sr.y + sr.h / 2, w: r.w - 2 * edge, h: sr.h / 2, sec: sr, col: r, n });
      }
    });
    return out;
  }
  function zones() {
    const doc = canvasDoc();
    if (!zoneLayer || zoneLayer.ownerDocument !== doc) {
      zoneLayer?.remove();
      zoneLayer = doc.createElement('div');
      zoneLayer.className = 'stack-zones';
      zoneLayer.setAttribute('aria-hidden', 'true');
    }
    if (zoneLayer.parentNode !== canvas) canvas.appendChild(zoneLayer);
    return zoneLayer;
  }
  const iconOf = (id) => { const m = opened.get(id)?.m; return m?.icon || 'cube'; };
  function drawZones() {
    const layer = zones();
    layer.textContent = '';
    if (!drag) return;
    const doc = canvasDoc();
    const el = (tag, cls, text) => { const e = doc.createElement(tag); e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const glyph = (id) => { const i = el('i', `fa-solid fa-${iconOf(id)} fa-fw`); i.setAttribute('aria-hidden', 'true'); return i; };
    const cw = canvas.clientWidth;
    const hit = drag.hit;
    if (hit && hit.kind === 'stack') {
      // The place it would take: a section with its title bar, a share of the column at the target's top or bottom.
      const share = Math.min(hit.sec.h, Math.max(sectionMin(), hit.col.h / hit.n));
      const g = el('div', 'stack-ghost');
      const top = hit.pos === 'above' ? hit.sec.y : hit.sec.y + hit.sec.h - share;
      Object.assign(g.style, { left: `${hit.col.x + 2}px`, top: `${top}px`, width: `${Math.max(0, hit.col.w - 4)}px`, height: `${share}px` });
      const head = el('div', 'stack-ghost-head');
      head.append(glyph(drag.id), el('span', 'stack-ghost-name', nameOf(drag.id)));
      g.append(head, el('p', 'stack-ghost-words', `${nameOf(drag.id)} goes ${hit.pos === 'above' ? 'above' : 'under'} ${nameOf(hit.target)}`));
      layer.append(g);
    }
    if (hit && hit.kind === 'move' && !ownColumnBlocked(drag.id)) {
      const line = el('div', `stack-line${hit.line > cw - 140 ? ' stack-line-flip' : ''}`);
      line.style.left = `${Math.min(Math.max(hit.line, 2), cw - 2)}px`;
      const inStack = currentColumns().some((c) => c.ids.length > 1 && c.ids.includes(drag.id));
      line.append(el('span', 'stack-line-words', inStack ? 'Its own column here' : 'Move here'));
      layer.append(line);
    }
    if (drag.pt) {
      const chip = el('div', 'stack-chip');
      chip.append(glyph(drag.id), el('span', '', nameOf(drag.id)));
      chip.style.left = `${Math.min(Math.max(drag.pt.x + 14, 0), Math.max(0, cw - 120))}px`;
      chip.style.top = `${Math.min(Math.max(drag.pt.y + 14, 0), Math.max(0, canvas.clientHeight - 36))}px`;
      layer.append(chip);
      // Never over the words of the preview or the line: the chip moves just below them (above, where there is no room).
      const cr = canvas.getBoundingClientRect();
      for (const words of layer.querySelectorAll('.stack-ghost-words, .stack-line-words')) {
        const a = chip.getBoundingClientRect();
        const b = words.getBoundingClientRect();
        if (a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom) continue;
        const below = b.bottom - cr.top + 8;
        chip.style.top = `${below + a.height <= canvas.clientHeight ? below : Math.max(0, b.top - cr.top - a.height - 8)}px`;
      }
    }
  }
  function onDragKey(event) {
    if (event.key !== 'Escape' || !drag) return;
    event.preventDefault();
    event.stopPropagation();
    endDrag(true);
  }
  function beginDrag(mod) {
    drag = { id: mod.id, zones: zonesFor(mod.id), hit: null, pt: null };
    canvas.classList.add('reordering');
    for (const el of mod.parts()) el.classList.add('module-lifted');
    canvasDoc().addEventListener('keydown', onDragKey, true);
    drawZones();
  }
  function dragTo(clientX, clientY) {
    if (!drag) return;
    const cr = canvas.getBoundingClientRect();
    const x = clientX - cr.left;
    const y = clientY - cr.top;
    drag.pt = { x, y };
    const inside = (z) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h;
    drag.hit = drag.zones.find((z) => z.kind === 'move' && inside(z)) || drag.zones.find((z) => z.kind !== 'move' && inside(z)) || null;
    drawZones();
  }
  function endDrag(cancel) {
    if (!drag) return;
    const { id, hit } = drag;
    drag = null;
    canvasDoc().removeEventListener('keydown', onDragKey, true);
    canvas.classList.remove('reordering');
    for (const p of opened.values()) for (const el of p.parts()) el.classList.remove('module-lifted');
    if (zoneLayer) zoneLayer.textContent = '';
    if (cancel || !hit || !opened.has(id)) return;
    if (hit.kind === 'refused') note(hit.why);
    else if (hit.kind === 'stack') stackInto(id, hit.target, hit.pos);
    else if (hit.kind === 'move') moveToColumn(id, hit.index);
  }
  function wireReorder(head, current) {
    if (!head || wired.has(head)) return;
    wired.add(head);
    head.classList.add('reorderable');
    let press = null;
    const move = (event) => {
      const mod = current();
      if (!press || event.pointerId !== press.id || !mod) return;
      if (!press.started) {
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < 6) return;
        press.started = true;
        head.setPointerCapture?.(event.pointerId);
        beginDrag(mod);
      }
      dragTo(event.clientX, event.clientY);
    };
    const stop = (event, cancel) => {
      if (!press || event.pointerId !== press.id) return;
      const moved = press.started;
      press.off();
      press = null;
      if (!moved) return;
      // The release would otherwise count as a click on something in the bar.
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      head.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => head.removeEventListener('click', swallow, { capture: true }), 100);
      endDrag(cancel);
    };
    head.addEventListener('pointerdown', (event) => {
      const mod = current();
      if (!mod || mod.mode !== 'dock' || isNarrow() || event.button !== 0 || event.target.closest('button, a, input, select, textarea, [data-close]')) return;
      // Followed on the whole page until it is let go: a quick press can leave the title bar before it has moved 6 px.
      const doc = head.ownerDocument;
      const up = (e) => stop(e, false);
      const cancel = (e) => stop(e, true);
      press?.off();
      press = { id: event.pointerId, x: event.clientX, y: event.clientY, started: false, off: () => { doc.removeEventListener('pointermove', move, true); doc.removeEventListener('pointerup', up, true); doc.removeEventListener('pointercancel', cancel, true); } };
      doc.addEventListener('pointermove', move, true);
      doc.addEventListener('pointerup', up, true);
      doc.addEventListener('pointercancel', cancel, true);
    });
  }

  // `current` returns the module the handle belongs to right now (a built-in module is a new object each time it opens).
  // A stack's column is moved by its top section's edge (the others have none), and each of its modules takes the width.
  function wireDockResize(current, handle) {
    let drag = null;
    handle.addEventListener('pointerdown', (event) => {
      const mod = current();
      if (!mod) return;
      event.preventDefault();
      settleDock();
      drag = { sx: event.clientX, w: mod.width };
      handle.classList.add('dragging');
      canvas.classList.add('resizing-dock'); // frames swallow the pointer while dragging
      handle.setPointerCapture?.(event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      const mod = current();
      if (!drag || !mod) return;
      const mates = columnMates(mod);
      mod.width = clampDock(drag.w + (drag.sx - event.clientX)); // the column is on the right: dragging left widens it
      for (const p of mates) p.width = mod.width;
      takeWidthFromOthers(mod);
      syncDock();
    });
    const stop = () => {
      const mod = current();
      if (!drag || !mod) return;
      drag = null;
      handle.classList.remove('dragging');
      canvas.classList.remove('resizing-dock');
      for (const p of columnMates(mod)) { p.width = mod.width; remember(p.id, { dockW: mod.width }); }
      mod.onWidth?.(mod.width);
    };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  // --- installed modules -------------------------------------------------------

  // An installed module's window is the module frame (createModuleFrame, public/module-frame.js), the same in every mode:
  // the title bar (icon, name, the module's own actions, the "+", the menu, Close), the toolbar row, the module in the
  // content and the status bar. The menu's standard actions are the ways to show it (standardFor) and the host's Clear,
  // last, in red (it asks first); a composite has only the ways (Clear everything is each part's, in the page it holds).
  // Moving between docked and floating moves the whole frame. `holderEl` is the module's place in the content.
  function makeFrame(m, mode, holderEl) {
    const frame = createModuleFrame({
      document: canvasDoc(),
      title: m.name,
      icon: m.icon,
      tint: colorOf(m.id),
      variant: mode === 'dock' ? 'docked' : 'window',
      titlebar: { close: true, standard: () => standardFor(m.id), extra: () => stackMenu(m.id), onAction: (e) => titlebarAction(m.id, e) },
      flush: true,
      content: holderEl,
      onAction: (e) => opened.get(m.id)?.mount?.bandEvent?.(e),
    });
    frame.el.dataset.moduleFrame = m.id;
    return frame;
  }
  // The module's place in its frame's content, from holder()'s markup.
  const holderElement = (m) => {
    const wrap = canvasDoc().createElement('div');
    wrap.innerHTML = holder(m, 'module-holder');
    return wrap.firstElementChild;
  };

  // The page a composite holds: the destination as a view of this space (`/calendar?space=<id>`, `/map?space=<id>`, the
  // page the Calendar and Map layout tabs show filling the canvas; it draws no top bar of its own in a frame), with a
  // guest's token, or for anyone else the page's handoff (frameParams: ?from=space and the names), as the view frame had.
  const compositeSrc = (c) => {
    const q = new URLSearchParams({ space: spaceId || '' });
    if (guestToken) q.set('guest', guestToken);
    else if (typeof frameParams === 'function') for (const [k, v] of frameParams()) if (!q.has(k)) q.set(k, v);
    return `${c.path}?${q}`;
  };

  // An installed module's place on the canvas: a frame for a sandboxed module, an element of its own for one that runs in
  // the page, the app's own page (not sandboxed: it is this site's) for a composite.
  const holder = (m, cls) => (m.runMode === 'page'
    ? `<div class="module-root ${cls}" data-module-root="${escapeHtml(m.id)}"></div>`
    : compositeOf(m)
      ? `<iframe class="${cls} composite-frame" data-composite title="${escapeHtml(m.name)}" src="${escapeHtml(compositeSrc(compositeOf(m)))}"></iframe>`
      : `<iframe class="${cls}" title="${escapeHtml(m.name)}"></iframe>`);

  // What stands in for a composite's mount: nothing runs through the SDK here (the parts inside the page have their own
  // host); a pointer to open (openRef) goes to the page as #ref=, which it already takes (destination.js, takeHash).
  // The page (marked by the frame's data-composite) hands up its parts' adds, title bar icons and status lines
  // ('app:compositechrome'): they are drawn in this window's frame (its title bar's "+" and icons, its status bar), and a
  // pick goes back to the page ('app:compositeadd', 'app:compositeheader'), which hands it to that part. The toolbar row is
  // the page's own, the first thing in it, right under this title bar. Each new page in the frame is asked for them
  // ('app:compositehello').
  function compositeMount(mod, frame) {
    // A drag from a module on the Workspace over the frame reaches the parts inside (module-host.js, registerDragRelay).
    const unrelay = registerDragRelay(frame);
    const c = compositeOf(mod.m);
    const hostWin = frame.ownerDocument.defaultView || window;
    const post = (data) => { try { frame.contentWindow?.postMessage(data, hostWin.location.origin); } catch { /* the page is not there */ } };
    // The page in the frame opens no event stream of its own: it hears this page's (module-host.js, relayStreamToFrame),
    // for this space and this guest only, until the window closes.
    const unstream = relayStreamToFrame(frame, { win: hostWin, allow: () => ({ space: spaceId || null, guest: guestToken || null }) });
    let opener = null; // the "+" or icon the person used: focus goes back to it when the editor window closes
    // The parts' "+" and title bar icons drawn in this window's frame (createFrameBands), a pick posted back to the page.
    const bands = createFrameBands(mod.frame, {
      statusLimit: 6, // the calendar's items and the shown panel's (4 open, 1 overdue, Showing all) all fit
      send: (event, data) => {
        opener = { el: frame.ownerDocument.activeElement, at: Date.now() };
        if (event === 'add' && data?.id) post({ type: 'app:compositeadd', id: data.id });
        else if (event === 'header' && data?.id) post({ type: 'app:compositeheader', id: data.id });
      },
    });
    const lift = createFrameLift(frame, {
      mount: { send: (event, data) => post({ type: 'app:compositeevent', event, data }) },
      tell: () => post({ type: 'app:compositeevent', event: 'editordismiss', data: {} }),
      takeOpener: () => { const o = opener; opener = null; return o; },
      cover: true, // the window keeps showing the Calendar or the Map behind the editor window
    });
    frame.addEventListener('load', () => lift.release()); // the page started over: no editor is open in it
    const onChrome = (event) => {
      if (event.source !== frame.contentWindow || event.origin !== hostWin.location.origin) return;
      const d = event.data;
      if (d && d.type === 'app:openref') return answerOpenRef(event, d); // a part's link to another module's object
      if (d && d.type === 'app:compositelift') { // a part's editor window: this frame is lifted over the Workspace (module-host.js, createFrameLift)
        const result = d.open ? lift.lift(true, d.size === 'large' ? 'large' : 'medium', Number(d.height)) : lift.lift(false);
        return post({ type: 'app:compositelifted', seq: d.seq, result });
      }
      if (!d || d.type !== 'app:compositechrome') return;
      // Cleaned again here; a pick goes back to the page, which hands it to its part.
      if (Array.isArray(d.add)) bands.add(d.add);
      if (Array.isArray(d.header)) bands.header(d.header);
      if (Array.isArray(d.status)) bands.status(d.status);
    };
    hostWin.addEventListener('message', onChrome);
    frame.addEventListener('load', () => {
      bands.add([]);
      bands.header([]);
      bands.status([]);
      post({ type: 'app:compositehello' });
      if (typeof onCompositeLoad === 'function') { try { onCompositeLoad(frame); } catch { /* the page's links stay its own */ } }
    });
    // Whether the destination's page is in the frame (not the blank it starts as): a pointer that arrives before it is
    // (the composite opened for that pointer: a place card's, a task's) waits for the page's load.
    const loaded = () => { try { return Boolean(frame.contentWindow) && frame.contentWindow.location.pathname === c.path; } catch { return false; } };
    let waiting = null;
    const show = (ref) => {
      try {
        const win = frame.contentWindow;
        const hash = `ref=${encodeURIComponent(JSON.stringify(ref))}`;
        if (win.location.hash === `#${hash}`) win.location.hash = ''; // the same pointer again still fires hashchange
        win.location.hash = hash;
      } catch { /* the page is not there; the pointer is dropped */ }
    };
    frame.addEventListener('load', () => { if (waiting && loaded()) { show(waiting); waiting = null; } });
    const mount = {
      destroy() { unrelay(); lift.release(); waiting = null; frame.src = 'about:blank'; },
      deliver(event, data) {
        if (event !== 'objectopen' || !data?.ref) return;
        if (loaded()) show(data.ref); else waiting = data.ref;
      },
      send() {},
      bandEvent: (e) => bands.event(e),
      lift: (open) => (open ? false : lift.release()),
      beginDragForTest() {},
      ptrForTest() {},
    };
    // Closing lets the "+", the status bar, the page's messages and the events it heard from this page's stream go too.
    const close = mount.destroy;
    mount.destroy = () => {
      hostWin.removeEventListener('message', onChrome);
      unstream();
      bands.destroy();
      close();
    };
    return mount;
  }
  // Unread notifications: a composite's are its parts'.
  const unreadOf = (id) => { const c = compositeById(id); return c ? c.parts.reduce((sum, p) => sum + (unread[p] || 0), 0) : unread[id] || 0; };
  const markRead = (id) => { const c = compositeById(id); for (const one of c ? c.parts : [id]) markModuleRead(one); };

  // onResize is wired the same way regardless of which mode a module opened in, and reads
  // the module's *current* element and mode rather than the one it was mounted with (`mod.el`, `mod.mode`):
  // that is what lets moveModule, below, hand a mount that started in one mode on to the other without
  // remounting it. onResize only remembers a size while floating. A module has no bar along the bottom
  // (plan-module-titlebar-add.md): its adds are the titlebar's "+", and host.bar.set folds into it.
  function mountFor(mod, frame, extra = {}) {
    const m = mod.m;
    if (compositeOf(m)) return compositeMount(mod, frame);
    return mountModule({
      module: { id: m.id, version: m.version, scope: m.scope, budget: m.budget === true, content: m.content },
      ...(frame.tagName === 'IFRAME' ? { frame } : { container: frame }),
      chrome: mod.frame,
      onOpenRef: openRef,
      // A request for an action waits for the page of the module that carries it: open that module if it is on here.
      onOpenModule: (id) => { const target = available.find((x) => x.id === readId(id)); if (target && !opened.has(target.id)) openModule(target); },
      onChatAsk,
      // The data changed (someone cleared it, or put it back): whether Clear is offered, and for how long Undo lasts, are asked again.
      onChanges: followClearable(m.id, { spaceId, guestToken }, (entry) => { m.clear = entry.clear === true; m.undoSeconds = entry.undoSeconds; if (mod.frame) mod.frame.setTitlebar({}); }, () => m.clear === true),
      scope: 'space',
      spaceId,
      guestToken,
      entry: m.canvas.entry,
      onTitle: (title) => { mod.frame.setTitle(title || m.name); },
      onResize: ({ width, height } = {}) => {
        if (mod.mode !== 'float') return;
        const b = currentBox(mod.el);
        if (Number.isFinite(width)) b.w = width;
        if (Number.isFinite(height)) b.h = height + headH();
        if (snapping(m.id)) { const g = snapGrid(); settleSnap(m.id, mod.el, snapCell(g, b)); remember(m.id, { layout: 'user' }); return; }
        remember(m.id, { box: place(mod.el, b), layout: 'user' });
      },
      // A sandboxed frame lifted over the canvas for its editor window (module-host.js, editor.lift) sits in its own
      // floating box's layer when floating: that box comes to the front so no other floating module draws over it.
      onLift: (open) => {
        const now = opened.get(m.id);
        if (open && now && now.mode === 'float') front(now.el);
      },
      ...extra,
    });
  }

  // `reuse` (from moveModule) carries the module's frame (createModuleFrame: its bands and the module's own frame or
  // container in its content) and its mount, already running in the other mode: the frame is moved into the new place
  // instead of built fresh, so the mount inside keeps whatever it was holding (a conversation, a draft, ...) rather than
  // being torn down and started over. Only the frame's variant changes (a docked column, or a window).
  function openModuleFloating(m, reuse) {
    const doc = canvasDoc();
    const floater = doc.createElement('section');
    floater.className = 'module-floating module-window';
    floater.dataset.module = m.id;
    const grip = doc.createElement('span');
    grip.className = 'module-floating-grip';
    grip.title = 'Drag to resize';
    const frame = reuse ? reuse.frame : makeFrame(m, 'float', holderElement(m));
    frame.el.classList.remove('mf-docked');
    floater.append(frame.el, grip);
    layerFor(doc).appendChild(floater);
    const index = [...opened.values()].filter((p) => p.mode === 'float').length;
    const win = canvasWin();
    place(floater, saved[m.id]?.box || {
      w: m.canvas.width,
      h: m.canvas.height + headH(),
      x: win.innerWidth - m.canvas.width - 24 - index * 28,
      y: 70 + index * 28,
    });
    if (snapping(m.id)) snapOntoGrid(m.id, floater);
    front(floater);
    const mod = { id: m.id, kind: 'module', mode: 'float', m, el: floater, frame, modes: m.canvas.mode, order: ++order, parts: () => [] };
    if (reuse) mod.mount = reuse.mount;
    else mod.mount = mountFor(mod, frame.content.querySelector('iframe, .module-root'));
    opened.set(m.id, mod);
    wireFloating(m.id, floater, frame.titlebar, grip);
  }

  function openModuleDocked(m, reuse) {
    const doc = canvasDoc();
    const section = doc.createElement('section');
    section.className = 'module module-docked';
    section.dataset.module = m.id;
    section.innerHTML = '<div class="dock-resize" title="Drag to resize"></div><div class="mod-content dock-content"></div>';
    const frame = reuse ? reuse.frame : makeFrame(m, 'dock', holderElement(m));
    frame.el.classList.add('mf-docked');
    section.querySelector('.dock-content').append(frame.el);
    canvas.appendChild(section);
    const mod = {
      id: m.id, kind: 'module', mode: 'dock', m, el: section, frame, modes: m.canvas.mode, order: ++order,
      width: clampDock(saved[m.id]?.dockW || m.canvas.width),
      parts: () => [...section.children],
    };
    // The module's content fills the column, its status bar the last thing in it.
    if (reuse) mod.mount = reuse.mount;
    else mod.mount = mountFor(mod, frame.content.querySelector('iframe, .module-root'));
    opened.set(m.id, mod);
    syncDock();
    wireDockResize(() => mod, section.querySelector('.dock-resize'));
    wireReorder(frame.titlebar, () => opened.get(m.id));
  }

  // Switch an installed module between docked and floating without the module inside noticing: move its frame (its bands
  // and its own frame or in-page container) into the new place, then drop the emptied-out old one. Leaving for a window
  // is a real new page, so that keeps going through closeModule + popOut instead (see setMode).
  function moveModule(id, mode) {
    const mod = opened.get(id);
    const m = mod.m;
    const reuse = { frame: mod.frame, mount: mod.mount };
    const old = mod.el;
    // A sandboxed frame lifted over the canvas for its editor window goes back first: the move takes its backdrop away
    // with the old place and the frame starts over in the new one, so nothing may stay inert behind it.
    mod.mount?.lift?.(false);
    opened.delete(id);
    if (mode === 'dock') openModuleDocked(m, reuse); else openModuleFloating(m, reuse);
    old.remove();
    // The move took the module's box out of the page and back, which drops an open editor window (a modal <dialog>,
    // host.ui.editor) out of the top layer: the module's SDK shows it again on this event.
    opened.get(id).mount?.deliver('moved', { mode });
  }

  // --- built-in modules (the conference and the chat) ---------------------------
  // The module's DOM already exists in the page; moving it between the canvas's grid,
  // a floating box and a window keeps everything wired to it (a node moved to
  // another document keeps its listeners).

  const wired = new WeakSet();

  // `opts.moving`: the module is only changing where it is shown, not opening or closing, so
  // its owner (the conference: a call) is told not to start or stop anything.
  function openBuiltinIn(def, mode, opts = {}) {
    if (def.allowed && !def.allowed()) return false;
    if (mode === 'column' && !columnMode()) mode = 'dock'; // no column on a phone
    if (mode !== 'dock' && mode !== 'column' && def.modes && !def.modes.includes(mode)) mode = 'dock';
    if (mode === 'window') return openBuiltinWindow(def, opts);
    const doc = canvasDoc();
    const el = def.el;
    const mod = {
      id: def.id, kind: 'builtin', mode, def, el, modes: def.modes || ['dock', 'float'], order: def.order,
      width: clampDock(saved[def.id]?.dockW || def.width || 320),
      onWidth: def.onWidth,
      parts: () => [...el.children],
    };
    if (mode === 'column') {
      // Its place in the side column (def.slot), wrapped as it is when floating (the conference brings its own .canvas).
      const slot = column.querySelector(def.slot) || column;
      mod.columnEl = wrapFor(def, el, doc);
      slot.appendChild(mod.columnEl);
      el.hidden = false;
      mod.parts = () => [];
    } else if (mode === 'dock') {
      canvas.appendChild(el);
      el.hidden = false;
      const handle = el.querySelector('.chat-resize');
      if (handle && !wired.has(handle)) {
        wired.add(handle);
        wireDockResize(() => opened.get(def.id), handle);
      }
      wireReorder(el.querySelector('header'), () => opened.get(def.id));
    } else {
      const floater = doc.createElement('section');
      floater.className = `module-floating builtin-floating ${def.id}-floating`;
      floater.dataset.module = def.id;
      floater.appendChild(wrapFor(def, el, doc));
      const grip = doc.createElement('span');
      grip.className = 'module-floating-grip';
      grip.title = 'Drag to resize';
      floater.appendChild(grip);
      layerFor(doc).appendChild(floater);
      el.hidden = false;
      const size = def.floatSize || { w: 340, h: 480 };
      place(floater, saved[def.id]?.box || { ...size, x: Math.max(8, canvasWin().innerWidth - size.w - 24), y: 70 });
      if (snapping(def.id)) snapOntoGrid(def.id, floater);
      front(floater);
      mod.floatEl = floater;
      wireFloating(def.id, floater, el.querySelector('header'), grip);
    }
    opened.set(def.id, mod);
    syncDock();
    def.onChange?.({ open: true, mode, moving: opts.moving });
    update();
    return true;
  }

  // The conference's tiles are styled by an ancestor `.canvas`, so out of the canvas's grid it
  // needs one of its own (`def.wrap` is its class); the chat needs nothing.
  function wrapFor(def, el, doc) {
    if (!def.wrap) return el;
    const wrap = doc.createElement('div');
    wrap.className = def.wrap;
    wrap.appendChild(el);
    return wrap;
  }

  function openBuiltinWindow(def, opts = {}) {
    const size = saved[def.id]?.win || def.windowSize || { w: 380, h: 520 };
    const win = window.open('/popout.html', `app-${def.id}`, `popup,width=${size.w},height=${size.h}`);
    if (!win) return false;
    const mod = { id: def.id, kind: 'builtin', mode: 'window', def, el: def.el, win, modes: def.modes || ['dock', 'float'], order: def.order, parts: () => [] };
    opened.set(def.id, mod);
    const setup = () => {
      win.document.title = def.name;
      for (const sheet of document.querySelectorAll('link[rel="stylesheet"]')) win.document.head.appendChild(sheet.cloneNode(true));
      followTheme(win.document); // light or dark, and a changed theme, follow the call page's (brand.js)
      win.document.body.className = def.windowClass || 'chat-window';
      const grid = def.wrap ? wrapFor(def, def.el, win.document) : win.document.createElement('div');
      if (!def.wrap) {
        grid.className = 'chat-window-grid';
        grid.appendChild(def.el);
      }
      win.document.body.appendChild(grid);
      def.el.hidden = false;
      def.onWindow?.(win);
      // Popups the chat opens (emoji, formatting help) close on a click elsewhere.
      win.document.addEventListener('click', (e) => {
        for (const id of ['chat-help-popup', 'chat-emoji-popup', 'chat-command-menu']) {
          const p = win.document.getElementById(id);
          if (p && !p.hidden && !e.target.closest(`#${id}`) && !e.target.closest('#chat-help, #chat-emoji, #chat-command')) p.hidden = true;
        }
      });
      win.addEventListener('resize', () => {
        remember(def.id, { win: { w: win.innerWidth, h: win.innerHeight } });
        def.onWindowResize?.(win);
      });
      def.onChange?.({ open: true, mode: 'window', moving: opts.moving });
      update();
    };
    win.addEventListener('load', () => {
      setup();
      // Closing the window brings the module back into the page, in the mode it had before it left (docked or
      // floating), with whatever it holds untouched: a call keeps going, a chat keeps its draft. Closing the
      // window is not closing the module; a call is left with Hang up, a chat with its own close. Registered
      // only once the window has loaded: the blank page it starts as also fires pagehide, when it navigates
      // to the real one, and that must not count as the person closing it. The module the app closed itself
      // (closeBuiltin) is already gone from `opened` by the time its window's pagehide fires, so it stays closed.
      win.addEventListener('pagehide', () => {
        if (opened.get(def.id) !== mod) return;
        canvas.appendChild(def.el);
        def.el.hidden = true;
        def.el.classList.remove('is-flex');
        opened.delete(def.id);
        const back = columnMode() ? 'column' : saved[def.id]?.mode === 'float' && supports(mod, 'float') && !isNarrow() ? 'float' : 'dock';
        if (!openBuiltinIn(def, back, { moving: true })) {
          syncDock();
          def.onChange?.({ open: false, mode: 'window' });
        }
        update();
      });
    }, { once: true });
    return true;
  }

  function closeBuiltin(id, opts = {}) {
    const mod = opened.get(id);
    if (!mod) return;
    if (!restoring) keepLayout = false;
    const def = mod.def;
    opened.delete(id);
    if (mod.floatEl) mod.floatEl.remove();
    canvas.appendChild(def.el); // home again, before a window goes and takes it along
    if (mod.columnEl && mod.columnEl !== def.el) mod.columnEl.remove(); // the column's wrap, now empty
    def.el.hidden = true;
    def.el.classList.remove('is-flex');
    for (const el of def.el.children) el.style.gridColumn = '';
    if (mod.mode === 'window') mod.win.close();
    syncDock();
    def.onChange?.({ open: false, mode: mod.mode, moving: opts.moving });
    update();
  }

  // --- opening, closing, switching -------------------------------------------

  function preferredMode(p) {
    // A phone shows one module at a time, docked below the conference strip like the chat; a module that cannot dock floats.
    if (isNarrow()) return supports(p, 'dock') ? 'dock' : 'float';
    // The arrange mode (setArrangeMode): a module opens as a window in Window Mode, as a column in Panel Mode, where it can.
    if (arrangeMode() === 'window') return supports(p, 'float') ? 'float' : 'dock';
    return supports(p, 'dock') ? 'dock' : 'float';
  }

  // On a narrow canvas (a phone) one view is shown at a time: the chat, a module or the conference. The others
  // stay open, only hidden, so the call keeps running (its microphone and camera as they were) while you read
  // the chat; a tab switches the view and never closes anything. `view` is the id being shown.
  let view = null;
  function syncView() {
    const narrow = isNarrow();
    const shown = [...opened.values()].filter((p) => p.mode === 'dock').map((p) => p.id);
    // The chat is the view to start on (the first tab); the conference is shown by joining or by the call item.
    if (narrow && !shown.includes(view)) view = shown.includes('chat') ? 'chat' : shown.find((id) => id !== 'conference') || shown[0] || null;
    for (const p of opened.values()) {
      if (p.mode !== 'dock') continue;
      const hide = narrow && p.id !== view;
      for (const el of p.parts()) el.classList.toggle('narrow-hidden', hide);
    }
  }
  // Open, docked, and hidden on a narrow canvas because another view is shown.
  function hiddenByView(id) {
    const mod = opened.get(id);
    return Boolean(mod && mod.mode === 'dock' && isNarrow() && view !== id);
  }
  function setView(id) {
    if (!opened.has(id)) return;
    const mod = opened.get(id);
    if (mod.mode !== 'dock') {
      if (mod.el.classList && mod.mode === 'float') front(mod.el);
      return;
    }
    view = id;
    syncView();
    if (mod.kind === 'module') markRead(id);
    update();
  }

  function openModule(m, mode) {
    if (!restoring) keepLayout = false;
    const p = { id: m.id, modes: m.canvas.mode, kind: 'module' };
    if (opened.has(m.id)) {
      const mod = opened.get(m.id);
      if (mod.mode === 'float') front(mod.el);
      return;
    }
    if (isNarrow()) view = m.id;
    mode ||= preferredMode(p);
    if (mode === 'dock' && !supports(p, 'dock')) mode = 'float';
    // One too many for the window: it takes the newest place in the column order, so it is the one that waits, floating.
    if (mode === 'dock' && wouldWait({ ...p, m })) {
      openModuleFloating(m);
      const mod = opened.get(m.id);
      Object.assign(mod, { waiting: true, width: Math.max(DOCK_MIN, Math.round(saved[m.id]?.dockW || m.canvas.width)) });
      placeWaiting(mod);
      tellWaiting([m.id]);
    } else if (mode === 'dock') openModuleDocked(m); else openModuleFloating(m);
    markRead(m.id);
    update();
  }

  // Show an item in the module that owns it, here: open its module (if it is on in this space; the composite where the
  // module is one of its parts) and hand it the pointer, which its own code turns into showing the item. the host
  // knows nothing about the item.
  function openRef(ref) {
    // A file of the space's library (a link from Chat or another tool) opens in the file window over the canvas; the library's module
    // is not brought forward (plan-attachments-vault.md, decision 19). Previous and Next appear only when the opener gives a list.
    if (ref.kind === 'file' && ref.scope === 'space' && !(spaceId && ref.space === spaceId)) {
      noticeToast(`That file is in another ${word('space')}. Open it there.`, { kind: 'danger' });
      return false;
    }
    if (ref.kind === 'file' && ref.scope === 'space') {
      Promise.resolve(openFile({ ref: { module: ref.module, kind: 'file', id: ref.id, scope: 'space', space: ref.space }, ids: null, doc: document, openRef, join: (fn) => joinStream(spaceId, guestToken, fn) })).catch(() => {});
      return true;
    }
    const m = available.find((x) => x.id === readId(ref.module));
    if (!m) return false;
    if (!opened.has(m.id)) openModule(m);
    const mod = opened.get(m.id);
    if (!mod || !mod.mount) return false;
    if (mod.mode === 'float') front(mod.el);
    mod.mount.deliver('objectopen', { ref });
    return true;
  }
  // A page this canvas holds or opened asking it to show an object (askCanvasToOpen in module-host.js): a composite's
  // page in its frame (compositeMount), or a module's or composite's own window (popOut). Shown here as openRef shows a
  // module's own host.objects.open, and answered with whether it could; the asker never navigates while it is asked.
  function answerOpenRef(event, d) {
    const r = d.ref;
    const ok = Boolean(r && typeof r.module === 'string' && typeof r.kind === 'string' && typeof r.id === 'string') && openRef(r);
    try { event.source.postMessage({ type: 'app:openref-done', id: d.id, ok }, event.origin); } catch { /* the asker is gone */ }
  }
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || !event.data || event.data.type !== 'app:openref') return;
    if (![...windows.values()].includes(event.source)) return; // only a window this canvas popped out
    answerOpenRef(event, event.data);
  });

  function closeModule(id) {
    const mod = opened.get(id);
    if (!mod) return;
    if (!restoring) keepLayout = false;
    if (mod.kind === 'builtin') return closeBuiltin(id);
    const left = dropFromStack(id); // a stack left with one module is an ordinary column at once (decision 8)
    mod.mount.destroy();
    mod.frame?.destroy();
    mod.el.remove();
    opened.delete(id);
    syncDock();
    update();
    if (left && !quiet()) note(`${nameOf(left)} has its own column again.`);
  }

  function closeAllModules() {
    for (const p of [...opened.values()]) if (p.kind === 'module') closeModule(p.id);
  }

  function setMode(id, mode) {
    const mod = opened.get(id);
    if (!mod) return;
    // A waiting module already wants its column; floating it is the person's choice, so it stops waiting.
    if (mod.waiting && mode === 'dock') return;
    if (mod.waiting && mode === 'float') { settleWaiting(id); update(); return; }
    if (mod.mode === mode) return;
    if (mod.kind === 'builtin') {
      if (columnOwned(mod)) return; // the column's: moved only by liftBuiltin (a share, Floating window) and popBuiltin
      const def = mod.def;
      const before = mod.mode;
      closeBuiltin(id, { moving: true });
      if (mode !== 'window') remember(id, { mode });
      // A window the browser refuses to open must not leave the module closed.
      if (!openBuiltinIn(def, mode, { moving: true })) openBuiltinIn(def, before, { moving: true });
      return;
    }
    if (mode !== 'window' && !supports(mod, mode)) return;
    const m = mod.m;
    if (mode === 'window') return popOut(m.id); // closes the module only once the window opened
    // Open as a window takes it out of its stack; the stack closes up (plan-panel-stacking.md).
    const left = mode === 'float' ? dropFromStack(id) : null;
    remember(id, { mode });
    if (left && !quiet()) note(`${nameOf(left)} has its own column again.`);
    // Docking one too many (not from its Dock button, which is unavailable then): it stays where it floats, and waits.
    if (mode === 'dock' && wouldWait(mod)) {
      Object.assign(mod, { waiting: true, order: ++order, width: dockWidthOf(mod) });
      tellWaiting([id]);
      update();
      return;
    }
    moveModule(id, mode);
    syncDock(); // a column given up may let a waiting module dock
    markRead(m.id);
    update();
  }

  // A module's own window: the same page a server page uses, in this space's scope.
  const windows = new Map();
  function popOut(id) {
    const mod = opened.get(id);
    const m = mod?.m || available.find((x) => x.id === id);
    if (!m) return;
    const q = new URLSearchParams({ space: spaceId, popout: '1' });
    if (guestToken) q.set('guest', guestToken);
    const width = Math.max(320, Math.min(m.canvas.width, screen.availWidth));
    const height = Math.max(240, Math.min(m.canvas.height + headH(), screen.availHeight));
    // A composite's own window is the destination's page for this space, whole (its own bar, no titlebar of the canvas's).
    const url = compositeOf(m) ? compositeSrc(compositeOf(m)) : `/modules/${encodeURIComponent(m.id)}?${q}`;
    const win = window.open(url, `app-module-${m.id}`, `popup,width=${width},height=${height}`);
    if (!win) { onPopBlocked?.(); return; } // the browser refused: the module stays where it is
    windows.set(m.id, win);
    if (mod) closeModule(m.id);
  }

  // The ways to show a module, the standard actions of its frame's menu (Thomas, 2026-10-13: Panel Mode and Window Mode):
  // Dock as a panel while it floats (unavailable, and why, while it waits or the columns are full), Open as a window while
  // docked, and Open in its own window (pop out). None on a phone, where each module is a tab. Then the host's Clear, last
  // and red (it asks first); not a composite's (Clear everything is each part's, in the page it holds).
  function standardFor(id) {
    const out = { dock: false, window: false, popout: false, clear: false };
    const mod = opened.get(id);
    if (!mod) return out;
    out.clear = !compositeOf(mod.m) && mod.m.clear === true; // only where the server says this person may (for-space `clear`)
    if (isNarrow()) return out;
    if (mod.mode === 'dock' && supports(mod, 'float')) out.window = true;
    if (mod.mode === 'float' && supports(mod, 'dock')) {
      const why = dockBlocked(mod);
      out.dock = why ? { hint: why, disabled: true } : true;
    }
    out.popout = true;
    return out;
  }
  // The window's own title bar events: Close and the standard actions. The module's own ("+", its icons and menu actions)
  // go to its mount.
  function titlebarAction(id, e) {
    const mod = opened.get(id);
    if (!mod) return;
    if (e.id === 'close') return closeModule(id);
    if (!e.standard) { mod.mount?.bandEvent?.(e); return; }
    if (e.id === 'window') return setMode(id, 'float');
    if (e.id === 'dock') return setMode(id, 'dock');
    if (e.id === 'popout') return popOut(id);
    if (e.id === 'clear' && e.el) openClearMenu(e.el, () => clearModuleData(opened.get(id) || mod), { armed: true, name: (opened.get(id) || mod).m.name || '', undoSeconds: (opened.get(id) || mod).m.undoSeconds });
  }

  // Everything this module holds in this space. The conference and the chat are not modules, so they never get this.
  async function clearModuleData(mod) {
    const q = new URLSearchParams({ scope: 'space', space: spaceId });
    if (guestToken) q.set('guest', guestToken);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) q.set('tz', tz);
    } catch { /* the server falls back */ }
    return clearWithUndo(mod.m.id, q.toString());
  }

  // The call moved to (or came back from) a window of its own. Module frames cannot
  // move between windows without reloading, and a frame's messages arrive in the
  // window it lives in, so each open module is opened again in the canvas's new
  // window, the same way it was. A floating chat is carried over; a docked one is
  // inside the canvas and goes with it.
  function canvasPopped() {
    suspended = true; // closing and reopening the modules is not a change of layout
    const doc = canvasDoc();
    const again = [...opened.values()].filter((p) => p.kind === 'module').sort(byOrder).map((p) => ({ m: p.m, mode: p.waiting ? 'dock' : p.mode }));
    for (const { m } of again) closeModule(m.id);
    for (const p of opened.values()) {
      if (p.kind === 'builtin' && p.mode === 'float' && p.floatEl) {
        layerFor(doc).appendChild(p.floatEl);
        place(p.floatEl, currentBox(p.floatEl));
      }
    }
    bindDoc(doc);
    for (const { m, mode } of again) openModule(m, isNarrow() ? undefined : mode);
    placeBuiltins(); // the column, or the phone's tabs, by this window's width
    suspended = false;
    syncDock();
    update(); // the tab or switch for the view shown in this window's width
  }

  // The conference and the chat go where this window's width puts them (plan-one-bar.md, step 6): the side column
  // wider than a phone, the canvas (the phone's tabs) at 640px and below. Called as the window crosses the line and
  // after a pop-out. A lift for a screen share ends on the way to a phone. Only moving, never opening or closing:
  // the call keeps running, and nothing is remembered while it happens.
  function placeBuiltins() {
    if (!column) return;
    const want = columnMode();
    const was = suspended;
    suspended = true;
    try {
      if (want) {
        // Into the column: the two are always on there. One the phone had open moves; one it had closed opens (the
        // chat quietly, without taking the keyboard; the conference as its switch would, so it says "Not in a call").
        for (const def of builtins.values()) {
          const p = opened.get(def.id);
          if (p && p.mode === 'dock') { closeBuiltin(def.id, { moving: true }); openBuiltinIn(def, 'column', { moving: true }); }
          else if (!p && canOpenHere(def.id)) openBuiltinIn(def, 'column', { moving: def.id === 'chat' });
        }
        // A screen share still on lifts the conference out of the column again (the phone ended the lift on the way),
        // and one that ended while away puts it back: the module's own answer (def.shareLift), as syncShareLift asks.
        // A lift the person chose (Floating window) is theirs: liftBuiltin never puts that back for a share.
        for (const def of builtins.values()) {
          if (typeof def.shareLift === 'function' && opened.has(def.id)) liftBuiltin(def.id, Boolean(def.shareLift()));
        }
      } else {
        // Onto the canvas (the phone's tabs): only what the phone would have had open, the remembered list's (the
        // chat alone when nothing is remembered yet, as whatOpens's default; the conference too for a guest), and the
        // conference while on the call, since closing it would hang up. The rest closes, as it was on the phone.
        const prev = Array.isArray(saved.__open) ? saved.__open : guestToken ? ['conference', 'chat'] : ['chat'];
        for (const p of [...opened.values()]) {
          if (p.kind !== 'builtin' || !(inColumn(p) || p.lifted)) continue;
          const keep = prev.includes(p.id) || Boolean(p.def.inCall?.());
          closeBuiltin(p.id, { moving: keep });
          if (keep) openBuiltinIn(p.def, 'dock', { moving: true });
        }
      }
    } finally {
      suspended = was;
    }
    snapshot();
  }

  // The installed modules as this window's width wants them (GitHub #268). A phone has one view at a time, through the
  // tab bar, and no windows over it: crossing to 640px and below docks every floating module that can dock into the
  // phone's tabs (`phoneDocked`, its stacking order), its waiting ones too, and nothing is remembered, so its mode and
  // box stay what they were. Crossing back, in Window Mode, those float again at their remembered places (their cells
  // while the grid is on), in the order they were stacked; and an arrangement chosen on the phone (`arrangeOnWide`:
  // setArrangeMode, a layout loaded there) is put on the canvas as the Layout menu would. A module that can only float
  // stays floating on a phone, under the top bar and the tab bar (style.css, .module-layer).
  function placeForWidth(narrow) {
    const doc = canvasDoc();
    const mods = [...opened.values()].filter((p) => p.kind === 'module');
    if (narrow) {
      const floating = mods.filter((p) => p.mode === 'float' && supports(p, 'dock') && p.el.ownerDocument === doc)
        .sort((a, b) => (Number(a.el.style.zIndex) || 0) - (Number(b.el.style.zIndex) || 0));
      floating.forEach((p, i) => {
        const { order: keepOrder, waiting } = p;
        if (waiting) { stopWaiting(p); return; } // it wants its column: the fit decides again when the window is wide
        moveModule(p.id, 'dock');
        Object.assign(opened.get(p.id), { order: keepOrder, phoneDocked: i + 1 });
      });
      // The window that was in front is the view shown.
      const top = floating.filter((p) => !p.waiting).pop();
      if (top && opened.get(top.id)?.mode === 'dock') view = top.id;
      return;
    }
    const back = arrangeMode() === 'window' ? mods.filter((p) => p.phoneDocked && p.mode === 'dock' && supports(p, 'float')).sort((a, b) => a.phoneDocked - b.phoneDocked) : [];
    for (const p of mods) delete p.phoneDocked;
    for (const p of back) {
      const keepOrder = p.order;
      moveModule(p.id, 'float'); // at its remembered box, or its cells while the grid is on (openModuleFloating)
      opened.get(p.id).order = keepOrder;
    }
    if (arrangeOnWide) { arrangeOnWide = false; setArrangeMode(arrangeMode()); }
  }

  // A screen share lifts the conference out of the column into the Workspace as a floating module, and back when it
  // stops (plan-one-bar.md, step 6). Floating as the conference floats today, in the floating layer, its call untouched
  // (moving); the mode is not remembered, so it is the column's again on the next visit. Answers whether it is lifted.
  // `why` says whose lift it is: 'share' (the default, syncShareLift) or 'person' (the call's Floating window). A share
  // ending never puts back a call the person floated themselves; the person's own choice puts back either.
  function liftBuiltin(id, on, why = 'share') {
    const mod = opened.get(id);
    if (!mod || mod.kind !== 'builtin' || !columnMode()) return false;
    if (on && inColumn(mod) && supports(mod, 'float')) {
      closeBuiltin(id, { moving: true });
      if (!openBuiltinIn(mod.def, 'float', { moving: true })) { openBuiltinIn(mod.def, 'column', { moving: true }); return false; }
      const now = opened.get(id);
      now.lifted = why;
      return true;
    }
    if (on && mod.lifted && why === 'person') { mod.lifted = 'person'; return true; } // lifted by a share: now the person's
    if (!on && mod.lifted && (why === 'person' || mod.lifted !== 'person')) {
      closeBuiltin(id, { moving: true });
      openBuiltinIn(mod.def, 'column', { moving: true });
      return false;
    }
    return Boolean(mod.lifted);
  }

  // The call's own window, from the column (the Pop out button, Call position > Its own window): the same element moved
  // into a window of its own (openBuiltinWindow), so the call keeps its connection, nobody joins twice. Closing that
  // window brings it back to the column (openBuiltinWindow's pagehide). Answers whether it is out in a window now.
  function popBuiltin(id) {
    const mod = opened.get(id);
    if (!mod || mod.kind !== 'builtin' || !columnMode() || !mod.modes.includes('window')) return false;
    if (mod.mode === 'window') { mod.win?.focus?.(); return true; }
    if (!columnOwned(mod)) return false;
    const def = mod.def;
    closeBuiltin(id, { moving: true });
    if (!openBuiltinWindow(def, { moving: true })) { openBuiltinIn(def, 'column', { moving: true }); return false; } // the browser refused the window
    opened.get(id).popped = true;
    update();
    return true;
  }

  // Bring it back into the column, from floating (either lift) or its own window. Answers whether it moved.
  function returnBuiltin(id) {
    const mod = opened.get(id);
    if (!mod || mod.kind !== 'builtin' || !columnMode() || inColumn(mod) || !columnOwned(mod)) return false;
    closeBuiltin(id, { moving: true }); // a window is closed by the app here, so its pagehide leaves it alone
    openBuiltinIn(mod.def, 'column', { moving: true });
    return true;
  }

  // Whether this person may open a module here: the conference and the chat by their own rule, any other by being on
  // in this space for them.
  function canOpenHere(id) {
    if (builtins.has(id)) {
      const def = builtins.get(id);
      return !def.allowed || def.allowed();
    }
    return available.some((m) => m.id === readId(id));
  }

  // Open what this space starts with (plan-entering.md, "What opens on entering"): a fresh request, then the
  // remembered layout (never for a guest), then the space's own list, then the environment's list, then the chat and
  // every module on here without the conference (for a guest, the conference and the chat). See opens-with.js.
  // On entering, a first visit opens the space's first visit layout (plan-layout-views.md, step 5; firstVisitLayout):
  // a shared layout loads into the Workspace here; for Calendar or Map the Workspace opens as above and restore()
  // answers the tab's id ('calendar' or 'map'), which the page shows through the tab's own press once its layouts are
  // read (the Workspace stays behind, remembered). Otherwise it answers null. A phone has no tabs: there the Calendar's
  // or the Map's composite opens first, as the phone's first tab.
  function restore() {
    suspended = true;
    restoring = true;
    const enteringNow = entering;
    entering = false;
    // A pending request to open one item wins, when the module is on for this space and the request is fresh.
    const request = openRequest && Date.now() - openRequest.at < 20000 && available.some((x) => x.id === readId(openRequest.module)) ? openRequest : null;
    openRequest = null;
    keepLayout = Boolean(request);
    // The column's own (plan-one-bar.md, step 6): wider than a phone the conference and the chat open in the side column,
    // whatever the lists or a layout say, and whatOpens leaves them out of what goes on the canvas.
    if (columnMode()) for (const id of builtins.keys()) if (canOpenHere(id)) api_openBuiltin(id);
    const firstLayout = request ? 'workspace' : firstVisitLayout({ firstVisit: spaceFirstVisit, remembered: saved.__open, guest: Boolean(guestToken), entering: enteringNow });
    // A shared layout as the first visit (plan-saved-layouts.md, decision 4): it opens through loadLayout, modes and
    // places included, whether or not Opens with is set (the two are independent now). A person's remembered layout
    // still wins after their first visit (plan-entering, decision 5).
    if (firstLayout !== 'workspace' && !SYSTEM_TABS.includes(firstLayout) && spaceDefaultLayout && spaceDefaultLayout.id === firstLayout) {
      restoring = false;
      suspended = false;
      loadLayout(spaceDefaultLayout);
      return null;
    }
    const tab = SYSTEM_TABS.includes(firstLayout) ? firstLayout : null;
    const opens = request ? [request.module] : whatOpens({
      remembered: saved.__open,
      own: spaceOpensWith,
      environment: environmentOpensWith,
      modules: available.map((m) => m.id),
      canOpen: canOpenHere,
      guest: Boolean(guestToken),
      column: columnMode(),
      aliases, // a stored `calendar` or `todo` opens the composite while the Calendar is on here (composites.js)
    });
    // A phone with Calendar or Map as the first visit: that composite first (a stored `calendar` or `maps` read as it).
    const lead = tab && isNarrow() ? readAliased([tab === 'map' ? 'maps' : 'calendar'], aliases).filter((id) => canOpenHere(id)) : [];
    const want = [...lead, ...opens.filter((id) => !lead.includes(id))];
    for (const id of want) {
      if (builtins.has(id)) { if (canOpenHere(id)) api_openBuiltin(id); }
      else {
        const m = available.find((x) => x.id === readId(id));
        if (m) openModule(m);
      }
    }
    // The remembered order is the column order, for the built-in modules as well as the installed ones.
    if (!request) {
      const docked = [...opened.values()].filter(wantsColumn).sort(byOrder); // waiting ones keep their place too
      const sequence = want.map((id) => opened.get(id)).filter((p) => p && wantsColumn(p));
      if (sequence.length === docked.length) {
        const values = docked.map((p) => p.order).sort((a, b) => a - b);
        sequence.forEach((p, i) => { p.order = values[i]; });
      }
    }
    // On a phone the first tab is the first module opened, whichever it is (the call only when it comes first).
    if (isNarrow()) {
      const first = want.find((id) => opened.has(id));
      if (first) view = first;
    }
    restoring = false;
    suspended = false;
    if (!keepLayout) tidyStackRecords(); // a remembered stack whose other modules did not open is an ordinary column (not for a one-object request, which remembers nothing)
    syncDock();
    update();
    snapshot();
    if (request) openRef(request.ref);
    return tab && !isNarrow() ? tab : null;
  }

  // --- saved layouts (plan-saved-layouts.md) ------------------------------------------------------------------------
  // The canvas's box, in the floating layer's coordinates (the window's); the window while the canvas is hidden.
  function canvasArea() {
    const win = canvasWin();
    const r = canvas.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: 0, y: 0, w: win.innerWidth, h: win.innerHeight };
  }

  // The canvas as a layout to save (layouts.js's layoutOf): the open modules in column order, docked widths in pixels,
  // floating boxes as fractions of the canvas, and the canvas-level snap. A module waiting for a column is saved docked
  // (the layout is the intent; each window fits it on load); one in a window of its own as the mode it had before. On a
  // narrow canvas, where everything shows docked one at a time, each module's remembered mode and box are what is saved.
  // A composite is saved under its main module's id (`calendar` for `dest:calendar`): the server's layout store takes
  // module ids only (server/layouts.js, MODULE_ID), and a stored `calendar` reads back as the composite (placeLayout
  // through the aliases) wherever the Calendar is on, as the To-do's own column where it is not.
  function captureLayout() {
    const narrow = isNarrow();
    const mods = [...opened.values()].map((p) => {
      const rec = saved[p.id] || {};
      const floater = floaterOf(p);
      const mode = narrow ? (rec.mode === 'float' && supports(p, 'float') ? 'float' : 'dock') : p.waiting ? 'dock' : p.mode;
      return {
        id: compositeOf(p.m) ? compositeOf(p.m).main : p.id,
        mode,
        was: rec.mode,
        order: p.order,
        canDock: supports(p, 'dock'),
        flex: Boolean(p.def?.flex),
        width: p.width ?? rec.dockW,
        box: !narrow && floater && p.mode === 'float' ? currentBox(floater) : rec.box,
        // Its stack as remembered (layoutOf keeps only a whole one, of docked modules).
        ...(stackOf(p) ? { stack: stackOf(p), at: rec.at, h: rec.h, folded: rec.folded === true } : {}),
      };
    });
    return layoutOf(mods, canvasArea(), { all: snapAllOn(), pitch: snapPitch() });
  }

  // Put a saved layout on the canvas (plan-saved-layouts.md, "Saving and loading"): what may open here (canOpenHere)
  // opens or moves to its mode, in order; the open modules the layout does not name close, except the conference while
  // this person is on the call (closing it would hang up); docked widths, floating boxes scaled from the fractions,
  // snapped ones settled onto the grid at the saved pitch; then the columns are fitted to the window by fitDock(),
  // exactly as a resize would. The result becomes this person's remembered layout for the space. On a narrow canvas the
  // modes and places are remembered for a wider window and the first module is the view. Answers { left, waiting }:
  // the ids left out, and the ids waiting for a column; the panel's note says both in plain words.
  function loadLayout(layout) {
    if (!spaceId || !layout || !Array.isArray(layout.modules)) return { left: [], waiting: [] };
    const narrow = isNarrow();
    const area = canvasArea();
    const plan = placeLayout(layout, area, canOpenHere, aliases); // a stored `calendar` or `todo` places the composite
    const named = new Set(plan.modules.map((p) => p.id));
    const keepCall = (p) => p.id === 'conference' && p.kind === 'builtin' && Boolean(p.def?.inCall?.());
    suspended = true;
    restoring = true;
    try {
      // The conference and the chat are the column's (plan-one-bar.md, step 6): a layout neither names nor closes them.
      for (const p of [...opened.values()]) if (p.kind !== 'builtin' && !named.has(p.id) && !keepCall(p)) closeModule(p.id);
      // The canvas-level snap as saved (a module's own `snap` in an older layout is ignored).
      saved.__snap = { ...(saved.__snap || {}), all: plan.snap.all, pitch: plan.snap.pitch };
      const g = gridFor({ left: area.x, top: area.y, width: area.w, height: area.h }, plan.snap.pitch);
      for (const want of plan.modules) {
        const def = builtins.get(want.id);
        const m = def ? null : available.find((x) => x.id === want.id);
        const p = def ? { modes: def.modes || ['dock', 'float'] } : { modes: m.canvas.mode };
        const mode = supports(p, want.mode) ? want.mode : supports(p, 'dock') ? 'dock' : 'float';
        // The records first, so whatever opens now opens where the layout says.
        const rec = { mode };
        if (want.dockW) rec.dockW = want.dockW;
        if (want.box) {
          Object.assign(rec, { box: want.box, layout: 'user' });
          if (want.cell) Object.assign(rec, { cell: want.cell, placed: { x: want.box.x - g.x, y: want.box.y - g.y, w: want.box.w, h: want.box.h } });
        }
        remember(want.id, rec);
        // Its stack as the layout says (placeLayout made it whole), or none.
        clearStackRecord(want.id, { restore: false }); // the layout's width is the one (dockW, above)
        if (want.stack) remember(want.id, { stack: want.stack, at: want.at, h: want.h, folded: want.folded === true });
        let mod = opened.get(want.id);
        if (mod && mod.waiting) {
          if (mode === 'float') { mod.waiting = false; } else { mod.width = clampDock(want.dockW || mod.width); continue; }
        }
        const shown = narrow ? 'dock' : mode;
        if (!mod) {
          if (def) api_openBuiltin(want.id, narrow ? undefined : shown);
          else openModule(m, narrow ? undefined : shown);
        } else if (mod.mode !== shown && !(narrow && mod.mode === 'dock')) {
          setMode(want.id, shown);
        }
        mod = opened.get(want.id);
        if (!mod) continue; // a window the browser refused, or a module that may not open after all
        if (mod.mode === 'dock' && want.dockW) {
          mod.width = clampDock(want.dockW);
          mod.onWidth?.(mod.width);
        }
        const floater = floaterOf(mod);
        if (floater && mod.mode === 'float') {
          if (want.cell) settleSnap(want.id, floater, want.cell, { keepPlaced: true });
          else if (want.box) remember(want.id, { box: place(floater, want.box) });
          front(floater);
        }
      }
      // The column order is the layout's: the modules it names follow whatever stays (the conference on the call).
      for (const want of plan.modules) { const mod = opened.get(want.id); if (mod) mod.order = ++order; }
      // The arrange mode follows the layout: every module a window, Window Mode; any column, Panel Mode.
      if (plan.modules.length) saved.__mode = plan.modules.every((want) => want.mode === 'float') ? 'window' : 'panel';
      if (narrow && plan.modules.length) arrangeOnWide = true; // put on the canvas when the window is wide (placeForWidth)
      if (narrow) {
        const first = plan.modules.find((want) => opened.has(want.id));
        if (first) view = first.id;
      }
    } finally {
      restoring = false;
      suspended = false;
    }
    keepLayout = false;
    tidyStackRecords(); // the stacks as they opened here (one whose module was left out closes up)
    hush += 1; // one note for the whole load, below, not one per module
    try { syncDock(); } finally { hush -= 1; }
    update();
    snapshot();
    const waiting = [...opened.values()].filter((p) => p.waiting).sort(byOrder).map((p) => p.id);
    const lines = [leftOutNote(plan.left, nameOfLayout, word('space'))];
    if (waiting.length) {
      const names = waiting.map(nameOf);
      const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      lines.push(names.length === 1 ? `The window is too narrow for another column, so ${list} is floating.` : `The window is too narrow for more columns, so ${list} are floating.`);
    }
    note(lines.filter(Boolean).join(' '));
    return { left: plan.left, waiting };
  }
  // The layout tabs (plan-layout-views.md, step 2): a press on a tab other than the Workspace holds the Workspace's
  // memory (a copy of what is remembered, and nothing written while held), so the layout it loads, and any change made
  // on it, never becomes the Workspace's. Back on the Workspace (resumeMemory) the modules that tab opened close and the
  // Workspace's own open again as remembered, exactly as entering the space opens them (restore). A space left or
  // entered drops the hold (refresh): the copy is that space's, and what is stored was never overwritten.
  function holdMemory() {
    if (held || !spaceId) return;
    held = { space: spaceId, saved: structuredClone(saved) };
  }
  function resumeMemory() {
    if (!held) return false;
    const back = held.space === spaceId ? held.saved : null;
    held = null;
    if (!back) return false;
    const keepCall = (p) => p.id === 'conference' && p.kind === 'builtin' && Boolean(p.def?.inCall?.());
    suspended = true;
    for (const p of [...opened.values()]) if (p.kind !== 'builtin' && !keepCall(p)) closeModule(p.id);
    saved = back;
    restore();
    return true;
  }
  // A module's name for the load's note, open or not, installed here or not (one left out has only its id).
  const nameOfLayout = (id) => builtins.get(id)?.name || available.find((x) => x.id === id)?.name || id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ');

  // --- the Layout menu and the phone's tab bar --------------------------------------

  // The one place to show and hide modules, wider than a phone: the Layout menu, the page's shared menu (host-menu.js)
  // under the top bar's Layout button, so it looks and behaves as every other menu does (plan-layout-menu.md; Thomas,
  // 2026-10-13). Its sections: Show, a switch per module (the conference and the chat too where they are the canvas's:
  // a page with no side column), each showing or hiding its module and leaving the menu open; Arrange (not on a narrow
  // canvas): Panel Mode and Window Mode, and in Window Mode Snap to grid, with the grid's size while it is on, and
  // Clean up; then the page's own entries (menuItems: the Layouts section, space.js) and the note (noteEl). Drawn
  // again from these items on every change while it is open (refreshMenu), so a switch flipped shows what happened.
  const snapSizeRow = document.createElement('label');
  snapSizeRow.className = 'host-menu-range';
  snapSizeRow.innerHTML = '<span>Grid size</span><input type="range" id="snap-size">';
  const snapSize = snapSizeRow.querySelector('input');
  snapSize.addEventListener('input', () => setSnapPitch(Number(snapSize.value), { preview: true }));
  snapSize.addEventListener('change', () => setSnapPitch(Number(snapSize.value)));
  // A switch shows or hides the module, the same for every one; the conference's owner hears it through onChange.
  // On a narrow canvas one docked module shows at a time (syncView): a switch on a module that is open but hidden
  // behind another shows it (it reads off until then), so seeing the conference never means switching it off, which
  // hangs up. On a phone a tab switches the view; it never closes a module (so it never hangs up the call).
  function flipShown(id, { tab = false } = {}) {
    const builtin = builtins.has(id);
    const m = builtin ? null : available.find((x) => x.id === id);
    if (!builtin && !m) return;
    const open = () => (builtin ? api_openBuiltin(id) : openModule(m));
    const close = () => (builtin ? closeBuiltin(id) : closeModule(id));
    if (tab && isNarrow()) { if (opened.has(id)) setView(id); else open(); return; }
    if (opened.has(id) && hiddenByView(id)) setView(id);
    else if (opened.has(id)) close();
    else open();
    update();
  }
  function layoutMenuItems() {
    const shown = (id) => opened.has(id) && !hiddenByView(id);
    const builtinList = columnMode() ? [] : [...builtins.values()].sort((a, b) => a.order - b.order).filter((def) => !def.allowed || def.allowed());
    const items = [{ heading: 'Show' }];
    for (const def of builtinList) items.push({ toggle: true, checked: shown(def.id), icon: def.icon, label: def.name, ...(def.description ? { hint: def.description, clamp: true } : {}), badge: builtinUnread[def.id] || 0, onPick: () => flipShown(def.id) });
    for (const m of available) items.push({ toggle: true, checked: shown(m.id), icon: m.icon, tint: colorOf(m.id), label: m.name, ...(m.description ? { hint: m.description, clamp: true } : {}), badge: unreadOf(m.id), onPick: () => flipShown(m.id) });
    if (!isNarrow()) {
      const windowMode = arrangeMode() === 'window';
      items.push({ divider: true }, { heading: 'Arrange' });
      items.push({ radio: true, checked: !windowMode, keepOpen: true, icon: 'fa-solid fa-table-columns', label: 'Panel Mode', onPick: () => setArrangeMode('panel') });
      items.push({ radio: true, checked: windowMode, keepOpen: true, icon: 'window-restore', label: 'Window Mode', onPick: () => setArrangeMode('window') });
      // Every stack back to columns of their own (plan-panel-stacking.md, decision 9); off while there is none.
      if (!windowMode) items.push({ icon: 'object-ungroup', label: 'Unstack all', disabled: !hasStacks(), keepOpen: true, onPick: () => { unstackAll(); keepFocusInArrange(); } });
      if (windowMode) {
        items.push({ toggle: true, checked: snapAllOn(), icon: 'border-all', label: 'Snap to grid', onPick: () => setSnapAll(!snapAllOn()) });
        if (snapAllOn()) {
          snapSize.min = String(SNAP_PITCH.min); snapSize.max = String(SNAP_PITCH.max); snapSize.step = String(SNAP_PITCH.step);
          snapSize.value = String(snapPitch());
          items.push({ element: snapSizeRow });
        }
        items.push({ icon: 'fa-solid fa-broom', label: 'Clean up', onPick: () => cleanUp() });
      }
    }
    // The file windows (public/file-viewer.js) are over the canvas, not modules of it: one entry closes them all (plan-attachments-vault.md, decision 20).
    const filesOpen = fileWindowCount(canvasDoc());
    if (filesOpen) items.push({ divider: true }, { heading: 'Open files' }, { icon: 'xmark', label: 'Close all', badge: filesOpen, onPick: () => closeAllFiles(canvasDoc()) });
    const extra = typeof menuItems === 'function' ? menuItems() : [];
    if (Array.isArray(extra) && extra.length) items.push({ divider: true }, ...extra);
    if (noteEl) items.push({ element: noteEl });
    return items;
  }
  let menuView = null;
  let menuHolder = null; // where the menu is drawn (the Modules tab of Set up)
  // After Unstack all its row is off: the keyboard stays in Arrange, on Panel Mode, not on the next row (Layouts) or the
  // tab. Once the menu has been drawn again after the pick (host-menu.js draws it right after onPick).
  function keepFocusInArrange() {
    setTimeout(() => {
      const rows = menuHolder ? [...menuHolder.querySelectorAll('.host-menu-item')] : [];
      const row = rows.find((b) => b.querySelector('.host-menu-label')?.textContent.trim() === 'Panel Mode');
      if (!row) return;
      for (const r of rows) if (r.tabIndex === 0) r.tabIndex = -1;
      row.tabIndex = 0;
      row.focus();
    }, 0);
  }
  const menuOpen = () => Boolean(menuView);
  // Draw the menu into `container` (the Set up panel's Modules tab) and keep it there until the handle's destroy(). Never
  // on a phone, where the tab bar is the list. It is drawn again on every change (refreshMenu).
  function mountMenu(container) {
    if (inline() || !container) return null;
    menuView?.destroy();
    onMenu?.(true);
    menuHolder = container;
    const view = mountHostMenu(container, layoutMenuItems);
    const handle = { redraw: () => view.redraw(), destroy: () => { view.destroy(); if (menuView === handle) menuView = null; } };
    menuView = handle;
    return handle;
  }
  function refreshMenu() {
    menuView?.redraw();
  }

  // The Layout button's count (unread in modules not shown), the phone's tabs, and the open menu drawn again.
  function update() {
    const total = available.reduce((sum, m) => sum + unreadOf(m.id), 0)
      + [...builtins.keys()].reduce((sum, id) => sum + (opened.has(id) ? 0 : builtinUnread[id] || 0), 0);
    nav.setBadge('setup', total);
    snapshot();
    paintDockButtons();
    if (canvasEmpty) canvasEmpty.hidden = onCanvas();
    if (!inline()) { refreshMenu(); return; }
    // The phone's tab bar (the Tab bar family, system.css): a tab per module, the chat first; the conference is not a
    // tab (the call is the bar's pinned call item, space.js). The current tab is the view being shown.
    const builtinList = columnMode() ? [] : [...builtins.values()].sort((a, b) => a.order - b.order).filter((def) => def.id !== 'conference' && (!def.allowed || def.allowed()));
    const tab = (data, icon, name, current, n) => {
      const b = menu.ownerDocument.createElement('button');
      b.type = 'button';
      b.className = 'sdk-tabbar-tab';
      Object.assign(b.dataset, data);
      b.classList.toggle('on', current);
      if (current) b.setAttribute('aria-current', 'page');
      // The icon in its 24 by 24 box, the count at the box's corner; a tab with a count says so in its name.
      if (n) b.setAttribute('aria-label', `${name}, ${n} new`);
      b.innerHTML = `<span class="sdk-tabbar-glyph"><i class="fa-solid fa-${escapeHtml(icon)} fa-fw" aria-hidden="true"></i>${n ? `<span class="sdk-badge-micro" aria-hidden="true">${n > 9 ? '9+' : n}</span>` : ''}</span><span class="sdk-tabbar-label">${escapeHtml(name)}</span>`;
      menu.appendChild(b);
    };
    menu.innerHTML = '';
    for (const def of builtinList) tab({ builtin: def.id }, def.icon, def.name, opened.has(def.id) && (!isNarrow() || view === def.id), builtinUnread[def.id] || 0);
    for (const m of available) tab({ module: m.id }, m.icon, m.name, opened.has(m.id) && (!isNarrow() || view === m.id), unreadOf(m.id));
    // The tabs are new: the bar folds again (nav-bar.js, plan-phone-space-bar.md), so the tabs that do not fit and
    // their unread counts go into its "...", and the view being shown keeps its tab. On the next frame, before a paint.
    nav.draw('secondary');
    onTabs?.();
  }

  // A resize keeps floating modules on screen, in whichever window the call is in.
  const bound = new WeakSet();
  let lastNarrow = null;
  function bindDoc(doc) {
    if (bound.has(doc)) return;
    bound.add(doc);
    (doc.defaultView || window).addEventListener('resize', () => {
      // Crossing the phone line moves the floating modules first (placeForWidth), before a box is fitted to the new
      // width: a box squeezed to a phone's width is never what is put back, nor what a snapped module remembers.
      const narrow = isNarrow();
      if (narrow !== lastNarrow) { hush += 1; try { placeForWidth(narrow); } finally { hush -= 1; } }
      for (const p of opened.values()) {
        const floater = floaterOf(p);
        if (!floater || floater.ownerDocument !== doc) continue;
        // A snapped module keeps its cells in the grid the new size makes; a free one just stays on screen.
        if (snapping(p.id)) settleSnap(p.id, floater, saved[p.id]?.cell); else place(floater, currentBox(floater));
      }
      hush += 1; // the columns fit again, quietly: the change is in front of the person
      try { syncDock(); } finally { hush -= 1; }
      // Crossing the narrow line changes which module shows, so the tabs and switches say so; and the conference and
      // the chat move between the side column and the canvas.
      if (narrow !== lastNarrow) { lastNarrow = narrow; placeBuiltins(); update(); }
    });
  }
  bindDoc(document);
  // A stack's heights follow the canvas's own height (the window, the top bar, the call's column), not only a resize.
  if (typeof ResizeObserver === 'function') {
    let frameId = 0;
    new ResizeObserver(() => {
      if (frameId || !dividers.size) return;
      frameId = requestAnimationFrame(() => { frameId = 0; relayoutStacks(); });
    }).observe(canvas);
  }

  document.addEventListener('app:unread', (event) => {
    unread = event.detail || {};
    update();
  });
  // A tab on the phone's bar.
  menu?.addEventListener('click', (event) => {
    const el = event.target.closest('[data-builtin], [data-module]');
    if (!el || !inline()) return;
    flipShown(el.dataset.builtin || el.dataset.module, { tab: true });
  });

  // The destinations a composite asks about (composites.js, compositesToAsk: the Map, whose main being on in the space
  // is not enough), each asked once for this space; answers the dest ids shown here for this person. A refusal (404:
  // no map file, or not readable there) or a failed request leaves the composite off, the parts as they are.
  async function askDestinations(id, list) {
    const shown = [];
    await Promise.all(compositesToAsk(list.map((m) => m.id)).map(async (c) => {
      const q = new URLSearchParams({ space: id });
      if (guestToken) q.set('guest', guestToken);
      try {
        await api('GET', `/api/destinations/${encodeURIComponent(c.dest)}?${q}`);
        shown.push(c.dest);
      } catch { /* not shown here */ }
    }));
    return shown;
  }

  // The modules on for this space and this viewer, or none (null = not in a space).
  async function refresh(id) {
    suspended = true;
    held = null; // a hold is the space left's; its stored arrangement was never overwritten
    arrangeOnWide = false; // an arrangement chosen on a phone is the space left's
    closeAllModules();
    note('');
    spaceId = id;
    saved = loadSaved(id);
    modules = [];
    available = [];
    aliases = {};
    colors = new Map();
    spaceOpensWith = null;
    spaceDefaultLayout = null;
    spaceFirstVisit = null;
    environmentOpensWith = null;
    entering = Boolean(id);
    if (id) {
      try {
        const q = new URLSearchParams({ space: id });
        if (guestToken) q.set('guest', guestToken);
        const answer = await api('GET', `/api/modules/for-space?${q}`);
        modules = (answer.modules || []).filter((m) => !m.canvas || m.canvas.menu !== false);
        // A composite that asks (the Map: Maps on here is not enough, the space's Map needs a map file; plan-map-places.md
        // step 3) is on only where its destination answers for this space. The same question the one bar's view and the
        // pop-out ask; a 404 keeps the parts as they are.
        const shown = await askDestinations(id, modules);
        if (spaceId !== id) return; // another space was entered while this one was asked about
        // The composite in its main's place while that is on here; its other parts leave the Show list (composites.js).
        available = composeList(modules, shown);
        aliases = aliasesFor(modules.map((m) => m.id), shown);
        colors = new Map((answer.modules || []).filter((m) => TINTS.includes(m.color)).map((m) => [m.id, m.color]));
        spaceOpensWith = Array.isArray(answer.opensWith) ? answer.opensWith : null;
        spaceDefaultLayout = answer.defaultLayout && Array.isArray(answer.defaultLayout.modules) ? answer.defaultLayout : null;
        // The first visit, as the server resolved it; from a server before it, the shared default as it opened then.
        spaceFirstVisit = answer.firstVisit && typeof answer.firstVisit.layout === 'string'
          ? answer.firstVisit
          : { layout: spaceDefaultLayout && spaceOpensWith ? spaceDefaultLayout.id : 'workspace', opensWith: spaceOpensWith };
        environmentOpensWith = Array.isArray(answer.spaceDefaultsOpensWith) ? answer.spaceDefaultsOpensWith : null;
        showBuiltin(answer.builtin);
      } catch {
        available = [];
      }
    }
    update();
  }

  // The modules were changed in Manage (one turned on or off, installed or removed): the list is read again, live, so the
  // Show list and the tabs follow without a reload. What is open stays, except a module that is no longer on here.
  async function reread() {
    const id = spaceId;
    if (!id) return;
    try {
      const q = new URLSearchParams({ space: id });
      if (guestToken) q.set('guest', guestToken);
      const answer = await api('GET', `/api/modules/for-space?${q}`);
      const list = (answer.modules || []).filter((m) => !m.canvas || m.canvas.menu !== false);
      const shown = await askDestinations(id, list);
      if (spaceId !== id) return;
      modules = list;
      available = composeList(modules, shown);
      aliases = aliasesFor(modules.map((m) => m.id), shown);
      colors = new Map((answer.modules || []).filter((m) => TINTS.includes(m.color)).map((m) => [m.id, m.color]));
      showBuiltin(answer.builtin);
      for (const p of [...opened.values()]) if (p.kind === 'module' && !available.some((x) => x.id === p.id)) closeModule(p.id);
    } catch { /* the list stays as it was */ }
    update();
  }
  document.addEventListener('app:modules-changed', reread);

  // The built-in modules' names and icons as this environment shows them (their display names, else their own), from the
  // server's `builtin` list; a module that draws its own header hears it through def.onShown.
  function showBuiltin(list) {
    for (const b of Array.isArray(list) ? list : []) {
      const def = builtins.get(b.id);
      if (!def || typeof b.name !== 'string' || !b.name) continue;
      const was = def.name;
      def.name = b.name;
      def.description = typeof b.description === 'string' ? b.description : '';
      if (typeof b.icon === 'string' && /^[a-z0-9-]{1,40}$/.test(b.icon)) def.icon = b.icon;
      def.onShown?.(def);
      // A window of its own titled by the module's name follows it (one titled otherwise, the conference's, keeps its own).
      const mod = opened.get(b.id);
      if (mod?.mode === 'window' && mod.win && !mod.win.closed && mod.win.document.title === was) mod.win.document.title = def.name;
    }
  }

  const api_openBuiltin = (id, mode) => {
    const def = builtins.get(id);
    if (!def) return false;
    if (opened.has(id)) return true;
    if (!restoring) keepLayout = false;
    if (columnMode()) return openBuiltinIn(def, 'column'); // the column's, whatever was remembered
    if (isNarrow()) view = id;
    const canFloat = !def.modes || def.modes.includes('float');
    // In Window Mode a module that can float opens floating (and snapped while the grid is on); in Panel Mode docked.
    const want = canFloat && arrangeMode() === 'window' ? 'float' : 'dock';
    return openBuiltinIn(def, mode || (isNarrow() ? 'dock' : want));
  };
  // Show a built-in module the way its switch does (the click handler above): open it if it is closed; if it is open
  // but out of sight (behind another view on a narrow canvas, or floating behind), bring it forward; a window of its
  // own is focused. Never closes it. Says whether it is open now (false: it may not open here).
  const api_showBuiltin = (id) => {
    if (!builtins.has(id)) return false;
    if (!opened.has(id)) api_openBuiltin(id);
    else if (opened.get(id).mode === 'window') opened.get(id).win?.focus?.();
    else setView(id);
    if (opened.has(id) && inColumn(opened.get(id))) builtins.get(id).onShow?.(); // the column's: its owner brings it into view (the rail opens)
    update();
    return opened.has(id);
  };
  // The same for any module (Chat's Send to... and Keep, after a module's form opened on this page): open it if it is
  // closed, else bring it forward the way its tab or switch does (on a phone, it becomes the view shown; floating, it
  // comes to the front; in a window of its own, that window is focused). Never closes anything.
  const api_show = (id) => {
    if (builtins.has(id)) return api_showBuiltin(id);
    const m = available.find((x) => x.id === readId(id));
    if (!m) return false;
    if (!opened.has(m.id)) openModule(m);
    else if (opened.get(m.id).mode === 'window') opened.get(m.id).win?.focus?.();
    else setView(m.id);
    update();
    return opened.has(m.id);
  };

  return {
    refresh,
    restore,
    // Ask the next restore to open just this module, on this item (a pointer), instead of the remembered modules.
    requestOpen: (module, ref) => { openRequest = { module, ref, at: Date.now() }; },
    suspend: () => { suspended = true; },
    setBuiltinUnread(id, n) {
      builtinUnread[id] = n;
      update();
    },
    closeAll: closeAllModules,
    popped: canvasPopped, // the call moved to (or back from) a window of its own
    showFloating,
    layoutChanged: () => { hush += 1; try { syncDock(); } finally { hush -= 1; } },
    updateMenu: update,
    openRef,
    // For tests: send a host event to an open module's frame.
    sendTo: (id, event, data) => opened.get(id)?.mount?.send(event, data),
    testDrag: (id, ref) => opened.get(id)?.mount?.beginDragForTest(ref),
    testPtr: (id, step, ref, label, x, y) => opened.get(id)?.mount?.ptrForTest(step, ref, label, x, y),
    // The canvas-level snap (the space bar's switch and slider): whether every floating module snaps, and the grid's pitch.
    snapAll: setSnapAll,
    snapAllOn,
    dockAll,
    cleanUp,
    snapPitch,
    snapPitchRange: () => ({ ...SNAP_PITCH }),
    setSnapPitch,
    // The arrange mode (Thomas, 2026-10-13): 'panel' or 'window', and choosing one.
    arrangeMode,
    setArrangeMode,
    // The Show tab of Set up: draw the menu into a container (gives { redraw, destroy }), whether it is drawn, and draw
    // it again (the layouts arrived, a note was written) while it is.
    mountMenu,
    menuOpen,
    refreshMenu,
    // Saved layouts (plan-saved-layouts.md): the canvas as a layout to save, and a saved layout put on the canvas.
    captureLayout,
    loadLayout,
    // The layout tabs: only the Workspace remembers. Hold its memory while another tab shows; put it back on the Workspace.
    holdMemory,
    resumeMemory,
    holdingMemory: () => Boolean(held),
    // Whether the canvas is narrow (640 px and below): the Layout panel's Layouts section is not drawn then.
    isNarrow,
    // `mode` (a module's own window asking to come back as a column or floating) is remembered. A module id that reads
    // as the composite here (`todo` while the Calendar is on) opens the composite.
    open: (id, mode) => {
      const m = available.find((x) => x.id === readId(id));
      if (!m) return;
      if (mode) remember(m.id, { mode });
      openModule(m, mode);
    },
    // Whether the module supports a mode (the window's titlebar offers only what works).
    supportsMode: (id, mode) => {
      const m = available.find((x) => x.id === readId(id));
      return Boolean(m) && supports({ modes: m.canvas.mode }, mode);
    },
    close: (id) => closeModule(readId(id)),
    isOpen: (id) => opened.has(readId(id)),
    modeOf: (id) => opened.get(readId(id))?.mode || null,
    setMode,
    popOut,
    // The modules on here as the server lists them (Chat reads commands, names and colours by module id), not the
    // Show list's composed one.
    list: () => modules.slice(),
    colorOf,
    // The built-in modules: the conference and the chat register their element and how to be told about changes.
    registerBuiltin(def) {
      def.order ??= 0; // the conference sets -1 to come first; the chat is the next column
      builtins.set(def.id, def);
      update(); // the menu lists it
    },
    openBuiltin: api_openBuiltin,
    showBuiltin: api_showBuiltin,
    show: api_show,
    closeBuiltin,
    builtinOpen: (id) => opened.has(id),
    // The always-on column (plan-one-bar.md, step 6): whether the conference and the chat are in it now, and a screen
    // share's lift of the conference into the Workspace and back.
    columnMode,
    liftBuiltin,
    lifted: (id) => Boolean(opened.get(id)?.lifted),
    liftedBy: (id) => opened.get(id)?.lifted || null, // 'share', 'person' or null
    // The call's place out of the column, the person's own choice (Call position): its own window, and back.
    popBuiltin,
    returnBuiltin,
    popped: (id) => Boolean(opened.get(id)?.popped),
    // The window a built-in module is popped out into, or null (the page's idle-hide needs that document's own canvas).
    builtinWindow: (id) => { const p = opened.get(id); return p && p.mode === 'window' && p.win && !p.win.closed ? p.win : null; },
    builtinMode: (id) => opened.get(id)?.mode || null,
    // The view being shown on a narrow canvas (a phone: the chat, a module or the conference), or null wider.
    shownView: () => (isNarrow() ? view : null),
    // A notification's toast asks the call to open the module on the canvas.
    handleNotification(n) {
      if (n.scope !== 'space' || n.spaceId !== spaceId) return false;
      const m = available.find((x) => x.id === readId(n.module));
      if (!m) return false;
      openModule(m);
      return true;
    },
  };
}
