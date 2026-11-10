// The Whiteboard module's page: a shared board for a space where people draw, put notes, words and shapes, and move them.
// Everything on it is a block (whiteboard-lib-a-core.js has the format). This file is the glue: it starts the board, wires
// the pointer, the keyboard and the host's toolbar, title bar and status line to the active tool, and is the one path
// every change made here goes through (commit), on its way to the screen and to the sync manager. The pieces it joins:
//   lib-a core      the block format, the board's state, the block type and tool registries
//   lib-b policy    who may do what
//   lib-c sync      storage and live changes, nothing else does either
//   lib-d render    drawing the board, the view (pan and zoom), editing words in place
//   lib-e block-*   one file per block type
//   lib-f tool-*    one file per tool
//   lib-g history   undo and redo of this person's own changes
//   lib-h clipboard copy, cut, paste and duplicate (in this page's memory)
//   lib-i pictures  pictures from the computer, sent as uploads
//   lib-j markup    what the formatting bar does to the words being edited
//   lib-k table     rows copied from a spreadsheet, read as a table's cells
//   lib-l export    the board as a picture, and ready to print
//   lib-m arrange   align, distribute, guides, and what a lock, a group or a delete changes
//   lib-n overview  the small map of the whole board
//   lib-o find      Find in the board: which blocks hold the words, in reading order
//   lib-p pointers  other people's pointers, live: what is sent, what is heard, how long each is shown
(async () => {
  'use strict';

  // A bundled module runs in the page: its SDK is handed to its script.
  const host = (document.currentScript && document.currentScript.host) || window.host;
  const root = host.root;
  const $ = (id) => root.getElementById(id);

  function showMsg(title, text) {
    $('loading').hidden = true;
    const head = document.createElement('h2');
    head.className = 'sdk-empty-title';
    head.textContent = title;
    const parts = [head];
    if (text) {
      const line = document.createElement('p');
      line.className = 'sdk-empty-text';
      line.textContent = text;
      parts.push(line);
    }
    $('msg').replaceChildren(...parts);
    $('msg').hidden = false;
  }

  let info;
  try {
    info = await host.ready();
  } catch (err) {
    showMsg('The whiteboard could not start', err.message);
    return;
  }
  if (info.context.scope !== 'space') {
    showMsg(`${info.module.name} opens in ${host.util.word('space', { a: true })}.`);
    return;
  }

  /*__LIB__*/

  const policy = createPolicy(host);
  const me = (info.user && info.user.key) || '';
  const board = createBoard();
  const surface = $('board');
  let overview = null; // the overview's map (lib-n), once it is made (see "the overview")
  Object.assign(wbGrid, wbGridLoad(() => window.localStorage)); // this person's grid (the Grid button), before the board is drawn
  const renderer = createRenderer({ surface, world: $('world'), frame: $('frame'), icon: (name) => iconSvg(name), onView: () => overviewView() });
  const drafts = new Set(); // blocks made here that are not saved yet (a stroke being drawn, a note before its words)
  const held = new Set(); // blocks being moved or edited here: a change to one from elsewhere waits until it is let go
  const waiting = new Map(); // id -> the newest change from elsewhere to a held block
  const known = new Map(); // id -> the block as last saved here or heard from elsewhere: a change's "before", for undo
  const sel = new Set(); // the picked blocks' ids
  const one = () => (sel.size === 1 ? [...sel][0] : null); // the one picked block, or null (none, or several)
  let editing = null; // { id, finish, cell? ({ r, c, td }: a table's cell) }
  let many = false; // "Many", a mode of the Select tool (on its strip): a click or tap adds to what is picked, a drag on the board draws a rectangle that adds
  let presenting = null; // while the frames are presented: lib-e-block-frame's state ({ order, i, view }), see "presenting"
  let tool = tools.get('select');
  // The colours and width picked for new blocks, by role; null: each type's usual. They go to a new block only where its
  // usual is a colour (a text block keeps no background, a note its matching border); weight goes with the stroke.
  const next = { stroke: null, fill: null, ink: null, weight: null };
  // A freehand stroke's width is picked for its brush alone (a marker is wide, a pen thin), and a highlight's for
  // highlights: brush id (or 'highlight') -> width, or null.
  const nextWeights = { pen: null, marker: null, brush: null, highlight: null };
  // What a block's width is remembered by: a drawing's brush, 'highlight' for a highlight, else nothing (the shared one).
  const brushKey = (type, brush) => (type === 'stroke' ? brush || null : type === 'highlight' ? 'highlight' : null);
  // A highlight's colour is picked for highlights alone (Yellow until one is picked), so a pen's ink does not make the
  // next highlight black; every other type shares next.
  const OWN_COLOURS = new Set(['highlight']);
  const nextOwn = { highlight: { stroke: null } };
  const nextColour = (def, role) => (def && OWN_COLOURS.has(def.type) ? (nextOwn[def.type][role] ?? null) : next[role]);
  const setNextColour = (def, role, v) => { if (def && OWN_COLOURS.has(def.type)) nextOwn[def.type][role] = v; else next[role] = v; };
  const nextWeightOf = (brush) => (brush && brush in nextWeights ? nextWeights[brush] : next.weight);
  const setNextWeight = (brush, v) => { if (brush && brush in nextWeights) nextWeights[brush] = v; else next.weight = v; };
  // The colour the Fill tool fills with: the fill picked for new blocks, else Yellow.
  const FILL_USUAL = 'gold';
  const nextFill = () => next.fill || FILL_USUAL;
  // The line style and arrowheads picked for new connectors (null: the usual), the same way.
  const nextLine = { style: null, head: null };
  const CONNECTOR = 'connector'; // the block type the Line style and Arrowheads menus are for
  // The key named in hints: Cmd on a Mac, iPhone or iPad, else Ctrl. Keys are named (in menus, in a button's name) only
  // where there is a mouse or a trackpad: on a touch screen alone they are noise.
  const MOD = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '') ? 'Cmd' : 'Ctrl';
  const ALT = MOD === 'Cmd' ? 'Option' : 'Alt'; // the Alt key, by its name on this device
  const KEYS = Boolean(window.matchMedia && window.matchMedia('(any-pointer: fine)').matches);
  const keyHint = (keys) => (KEYS ? keys : undefined);
  const withKey = (label, keys) => (KEYS ? `${label} (${keys})` : label);
  // The board's spoken help: the keys in this device's words (Command on a Mac), and only where there is a mouse or a
  // trackpad, as in the buttons' names; on a touch screen alone, what a finger does. Short: every gesture and tool, once.
  const boardHelp = () => {
    if (!KEYS) return 'Whiteboard. Tap a block to pick it, drag to move it, press it long for more (align, group, lock). Drag the board or use Hand to move it, pinch to zoom. Select strip: Many (drag round blocks or tap each), Select all, Clear selection. Press the board long for its background colour. Pen, Shape and Flowchart show their kinds on the strip: Pen, Marker, Brush, Highlighter; Rectangle, Ellipse, Line, Arrow; Connector (drag from one block to another) and flowchart shapes; Table properties on the strip sets every cell. The strip also has text size, alignment, line style and colours for what is picked. Fill: tap a block. Table (tap a cell twice to write). Frame (takes what is inside along; tap its title or border to pick it, press the title long for more). Timer: drag it; tap its time to set it. While you edit words, the bar makes them bold, italic, code or a link, and aligns them; tap a link on a picked block to open it. Press a note long, choose Add pointer, drag its tip. Paste spreadsheet rows to make a table. Find (magnifier in the title bar; Next and Previous). Overview (right of the toolbar): tap or drag in the map. Title bar menu: Save as image (or press the board long), Print, Present (frames in turn; Next and Back; the slider dims the rest; Transition sets the move). Other people\'s pointers show where they point; hide them in the title bar menu.';
    const M = MOD === 'Cmd' ? 'Command' : 'Ctrl';
    return `Whiteboard. Tab: next block; Enter edits, arrow keys move, Delete removes. Shift-click adds, ${M} A selects all, Escape clears, back to Select. ${M} C, X, V, D: copy, cut, paste, duplicate; ${M} Z, ${M} Shift Z: undo, redo. Move the board: right-drag, spacebar-drag or Hand (H). Select strip: Many, Select all, Clear selection. Pen (P; Marker M, Highlighter U; Shift: straight), Shape (R, O, L, A) and Flowchart (Connector C, Rounded box B, Diamond D) show their kinds on the strip; each tool's strip: text size, alignment, line style, colours. Tools stay on. Fill (F; ${ALT}-click takes a colour). Connector: drag block to block; Enter edits its label. Editing words: ${M} B, I, E, K: bold, italic, code, link; the bar aligns them too; ${M}-click a link, or click it on a picked block, to open it. Right-click a note: Add pointer. Table (G; Table properties sets every cell; Enter shows cells, arrows and Tab move, Enter edits, Escape leaves). Frame (S; takes what is inside along; pick by title or border, double-click to rename). Paste rows for a table; paste, drop or Add (+) a picture. Right-click the board: background colour. ${M} G group, ${M} Shift G ungroup, ${M} L lock. Snap to grid: onto dots, else near blocks; ${ALT} while dragging: opposite. Find (/ or the title bar's magnifier). Overview (right of the toolbar): click or drag the map. Grid (same place): dots, graph paper or off, size, colour, opacity. Title bar menu: Save as image, Print, Present (frames: arrows, spacebar; Escape stops; slider dims; Transition button). Timer (Y): drag it; click its time to set it. Pointers show where others point; hide in the title bar menu.`;
  };
  // The words of notes, text blocks and shapes are markup: drawn by the host's markdown (escaped first; lib-d,
  // wbShowWords), read out as the host's plain text of it.
  wbMarkup.html = host.util.markdown;
  wbMarkup.plain = host.util.plain;
  wbMarkup.linkTip = `${MOD}-click to open`;
  // The host's icons as SVG, each asked for once (a timer's buttons, the formatting bar).
  const icons = new Map(); // name -> a promise of its SVG
  function iconSvg(name) { if (!icons.has(name)) icons.set(name, host.ui.icon(name).catch(() => '')); return icons.get(name); }

  // The size and alignment picked for the words of new blocks (null: each type's usual).
  const nextText = { size: null, align: null };
  // What new tables start with, for this visit only (the Table properties menu with no table picked).
  const nextTable = { align: 'center', valign: 'middle', head: true };
  const takesNext = (def, role) => {
    const usual = def.create();
    const colour = (v) => WB_PALETTE_BY_ID.has(v) || v === 'usual'; // a frame's colours are 'usual' until one is picked
    if (role === 'weight') return Boolean(def.weight) && colour(usual.stroke);
    return Boolean(def.paint && def.paint[role]) && colour(usual[role]);
  };

  // ---- the one path for changes made here -----------------------------------------------------------------------------
  // Every local change lands here: drawn at once, and saved now, soon (after a pause) or not yet (while a drag or a stroke
  // goes on). Each save, and each delete (remove), is told to the history as { before, after }, the whole block (lib-g):
  // undo and redo put back from them the fields that changed, through this same path.
  const history = policy.canEdit ? createHistory({ cap: 100, onChange: () => historyButtons() }) : null;
  function commit(next, save) {
    board.put(next);
    renderer.draw(next);
    if (save) persist(next, save);
    updateStatus();
  }
  function persist(b, how) {
    const stamped = { ...b, by: me, at: new Date().toISOString() };
    if (history) history.record(b.id, known.get(b.id) || null, stamped);
    known.set(b.id, stamped);
    board.put(stamped);
    drafts.delete(b.id);
    waiting.delete(b.id); // ours is newer than what waited
    if (how === 'soon') sync.saveSoon(stamped); else sync.save(stamped);
  }

  // What tools and block types may ask of the board: they never touch storage or permissions themselves.
  const ctx = {
    policy,
    get: (id) => board.get(id),
    selected: () => one(),
    selection: () => [...sel],
    isSelected: (id) => sel.has(id),
    scale: () => renderer.view.s,
    // Whether this gesture snaps to the grid (Snap to grid, turned round while Alt is held), and a point or a length so.
    snapping: (event) => snapping(event),
    panBy: (dx, dy) => renderer.panBy(dx, dy),
    draft(type, fields) {
      const def = blockTypes.get(type);
      // The type's usual, then what the tool making it draws with (a marker's width), then what the person picked.
      const own = { ...def.create(), ...(tool.makes === type && tool.usual ? tool.usual : {}) };
      const brush = brushKey(type, fields.brush || own.brush);
      for (const role of Object.keys(next)) {
        const v = role === 'weight' ? nextWeightOf(brush) : nextColour(def, role);
        if (v !== null && takesNext(def, role)) own[role] = v;
      }
      if (type === CONNECTOR) for (const [k, v] of Object.entries(nextLine)) if (v !== null) own[k] = v;
      if (def.markup) Object.assign(own, wbNextWords(def, nextText));
      if (type === 'table') Object.assign(own, nextTable);
      // A frame goes under the other blocks (lib-e-block-frame, wbFrameZ); everything else on top.
      const z = def.container ? wbFrameZ(board.all()) : Math.floor(board.topZ()) + 1;
      const b = wbClean({ ...own, ...fields, id: host.util.id(), type, z });
      drafts.add(b.id);
      commit(b, false);
      return b;
    },
    change(id, patch, { save = 'now' } = {}) {
      if (presenting) return; // the board is not changed while the frames are presented
      const b = board.get(id);
      if (b && !drafts.has(id) && b.locked && policy.canLock(b)) { lockedNote(1, 1); return; }
      if (!b || (!drafts.has(id) && !policy.canChange(b))) return;
      const next = wbClean({ ...b, ...patch });
      if (next) commit(next, save);
    },
    // Save a block as it is now: once, at the end of a gesture; nothing when the gesture left it as it was.
    save(id) {
      const b = board.get(id);
      if (!b || (!drafts.has(id) && sameBlock(known.get(id), b))) return;
      persist(b, 'now');
      updateStatus();
    },
    discard(id) {
      if (!drafts.has(id)) return;
      drafts.delete(id);
      board.remove(id);
      renderer.remove(id);
      unpick(id);
      updateStatus();
    },
    remove: (id) => remove(id),
    placed: (id) => flowPlaced(id),
    select: (id) => select(id ? [id] : []),
    setSelection: (ids) => select(ids),
    // A block of a group goes in or out with its whole group.
    toggle(id) {
      const unit = new Set(wbExpandGroups([id], board.all()));
      if (sel.has(id)) select([...sel].filter((x) => !unit.has(x))); else select([...sel, ...unit]);
    },
    marquee: (r) => renderer.marquee(r),
    many: () => many,
    blocksIn: (r) => blocksIn(r),
    // The blocks a drag of these blocks takes along (the ones inside a frame among them) that may be moved, and how many
    // locked ones inside stay (lib-e-block-frame, wbFrameFollow).
    contentsOf(ids) {
      const r = wbFrameFollow(ids.map((id) => ({ id, dx: 0, dy: 0 })), live(), { measure: heightOf });
      return { blocks: r.moves.map((m) => board.get(m.id)).filter((b) => b && policy.canChange(b)), locked: r.locked };
    },
    edit: (id, o) => edit(id, o),
    // A block's element, for a tool to measure what is drawn (a table's rows).
    element: (id) => renderer.element(id),
    // A short note instead of a change that cannot be made (a table's last row deleted).
    refuseWith: (words) => note(words),
    // Locked blocks left as they are: n of the `of` blocks a gesture was for (lib-m's words).
    lockedNote: (n, of) => lockedNote(n, of),
    // Guides while blocks are dragged (lib-f-tool-select): whether this drag has them (Snap to grid off, Alt not held),
    // the box round the dragged blocks and the boxes near what is in sight to line it up with (once a drag), and the
    // lines to draw ([] for none).
    guiding: (event) => !snapOn && !(event && event.altKey),
    guideBoxes: (ids) => guideBoxes(ids),
    guides: (lines) => renderer.guides(lines),
    setTool: (id) => setTool(id),
    hold(id, on) { if (on) held.add(id); else release(id); },
    // Where a connector's end goes for a pointer on the board ({ block, side } or null: the board), and the connection
    // points to show ([{ block, side }], [] for none).
    attachAt: (p, o) => attachAt(p, o),
    ports: (list) => renderer.ports(list),
    // The Fill tool: the colour it fills with, taking a colour for it (Alt-click), the block under the pointer marked
    // ('ok' or 'no'; null for none), the swatch by the pointer ({ sx, sy }, null to take it away), and a click on a block
    // with nothing to fill (or, with alt, no colour to take).
    nextFill: () => nextFill(),
    setNextFill(v, { quiet = false } = {}) {
      if (!isColour(v)) return;
      next.fill = v;
      if (!quiet) note(`Fill colour: ${colourLabel(v)}.`); // taken from a block: say which
      if (lastSwatch) showSwatch(lastSwatch);
      updateStatus(); // the strip's swatch
    },
    mark: (id, kind) => renderer.mark(id, kind),
    swatch: (at) => showSwatch(at),
    refuse(b, alt) {
      const d = blockTypes.get(b.type);
      const noun = d.noun ? d.noun(b) : d.label.toLowerCase();
      note(alt ? `This ${noun} has no colour to take.` : `${/^[aeiou]/.test(noun) ? 'An' : 'A'} ${noun} has no background to fill.`);
    },
  };
  let lastSwatch = null;
  function showSwatch(at) {
    lastSwatch = at;
    renderer.swatch(at, colourOf(nextFill()));
  }
  // The same block, leaving aside who saved it and when.
  function sameBlock(a, b) {
    if (!a || !b) return a === b;
    const { by: _a, at: _b, ...x } = a;
    const { by: _c, at: _d, ...y } = b;
    return JSON.stringify(x) === JSON.stringify(y);
  }
  // The block a connector's end goes on for a point on the board: the topmost one that can take a connector (not a draft,
  // not one of `not`), the side whose middle is near the point, else 'auto'. Near is 12 screen pixels (20 for a finger).
  function attachAt(p, { not = [] } = {}) {
    const skip = new Set(not);
    const boxes = [];
    for (const b of board.all().reverse()) {
      if (skip.has(b.id) || drafts.has(b.id) || !wbAttachable(blockTypes.get(b.type))) continue;
      const r = renderer.boxOf(b.id);
      if (r) boxes.push({ ...r, id: b.id });
    }
    return wbAttachAt(boxes, p, (p.pointerType === 'touch' ? 20 : 12) / renderer.view.s);
  }
  // The connectors attached to a block, and the blocks a connector is attached to that are not on the board.
  const connectorsOf = (id) => board.all().filter((b) => { const d = blockTypes.get(b.type); return Boolean(d && d.refs && d.refs(b).includes(id)); }).map((b) => b.id);
  const missingRefs = (b) => { const d = blockTypes.get(b.type); return d && d.refs ? d.refs(b).filter((id) => !board.has(id)) : []; };

  function release(id) {
    held.delete(id);
    const w = waiting.get(id);
    waiting.delete(id);
    if (w) onRemote(w);
  }

  // Deleting a block deletes the connectors attached to it first, in the same undo step: one undo brings the block back,
  // then them, each with its own id. A connector goes with its block even when it is locked (force: a locked block taken
  // away all the same), so none is left pointing at nothing.
  function remove(id, { force = false } = {}) {
    const b = board.get(id);
    if (!b) return;
    if (drafts.has(id)) { ctx.discard(id); return; }
    if (!(force ? policy.canLock(b) : policy.canDelete(b))) return;
    for (const c of connectorsOf(id)) remove(c, { force: true });
    if (history) history.record(id, known.get(id) || b, null);
    known.delete(id);
    board.remove(id);
    renderer.remove(id);
    held.delete(id);
    waiting.delete(id);
    sync.remove(id);
    unpick(id);
    updateStatus();
  }
  // A delete of several blocks (lib-m, wbDeleteSet): the locked ones stay, and the person is told.
  function removeMany(ids) {
    if (presenting) return;
    const r = wbDeleteSet(ids, board.all(), { canDelete: (b) => drafts.has(b.id) || policy.canDelete(b), refsOf: (b) => { const d = defOf(b); return d && d.refs ? d.refs(b) : []; } });
    for (const id of r.ids) remove(id, { force: true });
    if (r.locked) lockedNote(r.locked, ids.length);
  }
  // A block gone from the board is gone from what is picked.
  function unpick(id) { if (sel.has(id)) select([...sel].filter((x) => x !== id)); }

  // ---- what comes from elsewhere ------------------------------------------------------------------------------------
  // A connector whose block someone else deleted is not drawn (lib-d), and a page that may edit removes it a moment later,
  // once the server says the block is not there (the block may only be late: a restore by someone's undo sends a block and
  // its connectors one by one). That delete is no step of anyone's undo, and two pages doing it is one delete.
  let sweepTimer = 0;
  function sweepSoon() { if (policy.canEdit && !sweepTimer) sweepTimer = setTimeout(sweep, 2500); }
  async function sweep() {
    sweepTimer = 0;
    const orphans = board.all().filter((b) => !drafts.has(b.id) && !held.has(b.id) && missingRefs(b).length);
    for (const c of orphans) {
      let gone = false;
      for (const id of missingRefs(c)) if (!(await sync.exists(id))) gone = true;
      const now = board.get(c.id);
      if (!gone || !now || held.has(c.id) || !missingRefs(now).length) continue;
      if (editing && editing.id === c.id) { const e = editing; editing = null; e.finish(false); }
      known.delete(c.id);
      board.remove(c.id);
      renderer.remove(c.id);
      waiting.delete(c.id);
      sync.remove(c.id);
      unpick(c.id);
      updateStatus();
    }
  }
  function onRemote(change) {
    if (change.op === 'remove') {
      const { id } = change;
      if (editing && editing.id === id) { const e = editing; editing = null; e.finish(false); }
      held.delete(id);
      waiting.delete(id);
      drafts.delete(id);
      known.delete(id);
      board.remove(id);
      renderer.remove(id);
      unpick(id);
    } else {
      const b = change.block;
      if (held.has(b.id)) { waiting.set(b.id, change); return; }
      if (!policy.canSee(b)) return;
      known.set(b.id, b);
      board.put(b);
      renderer.draw(b);
      // A table's cell being edited here that is no longer drawn (its row or column went): its editing ends (lib-e).
      if (editing && editing.cell && editing.id === b.id && !editing.cell.td.isConnected) { const e = editing; editing = null; e.finish(true); }
    }
    sweepSoon();
    presentSync();
    updateStatus();
  }
  // One note at a time: a change to many blocks that is refused is refused once for each, and is said once.
  let noted = { text: '', t: 0 };
  function note(text, kind) {
    const now = Date.now();
    if (text === noted.text && now - noted.t < 5000) return;
    noted = { text, t: now };
    host.ui.toast(text, kind ? { kind } : undefined).catch(() => {});
  }
  function onRefused(err) {
    note(err && err.status === 403 ? 'You may not change this whiteboard.' : `That change was not saved. ${(err && err.message) || ''}`.trim());
  }
  function onBusy() { note('Saving a lot at once. The rest is saved in a few seconds.'); }
  async function reload() {
    let list;
    try { list = await sync.load(); } catch (err) { host.ui.toast('The whiteboard could not be read again. Reload the page.').catch(() => {}); return; }
    if (editing) { const e = editing; editing = null; e.finish(false); }
    board.clear();
    renderer.clear();
    drafts.clear();
    held.clear();
    waiting.clear();
    known.clear();
    if (history) history.clear(); // the board was cleared or put back as a whole: older steps no longer fit it
    for (const b of list) { if (!policy.canSee(b)) continue; known.set(b.id, b); board.put(b); renderer.draw(b); }
    select(null);
    sweepSoon();
    presentSync();
    updateStatus();
  }

  const sync = createSync({ host, board: WB_BOARD, clean: wbClean, me, onRemote, onReload: reload, onRefused, onBusy });

  // ---- the board's background -------------------------------------------------------------------------------------------
  // One setting for the whole board, seen by everyone (lib-a, WB_BOARD_PREFIX): its own sync, the same as the blocks' (one
  // write per change, changes from elsewhere drawn as they come, a missing key the usual Default). Anyone who may edit the
  // board changes it; a change is one undo step of its own (WB_BOARD_STEP), put back field by field like a block's.
  let boardSettings = WB_BOARD_USUAL;
  // The colour a fixed background holds in whiteboard.css (read by name from the board's own style).
  const fixedColour = (f) => getComputedStyle(surface).getPropertyValue(f.css).trim();
  // A colour name's CSS colour for a swatch on the page: the tint's theme token, or the fixed colour itself ('' for neither).
  const colourOf = (id) => { const f = WB_FIXED_BY_ID.get(id); if (f) return fixedColour(f); const c = WB_PALETTE_BY_ID.get(id); return c ? c.token : ''; };
  const isColour = (id) => WB_PALETTE_BY_ID.has(id) || WB_FIXED_BY_ID.has(id);
  const colourLabel = (id) => (WB_FIXED_BY_ID.get(id) || WB_PALETTE_BY_ID.get(id) || {}).label;
  const rgbOfColour = (css) => {
    const probe = document.createElement('span');
    probe.style.color = css;
    surface.append(probe);
    const m = /^rgba?\(\s*(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/.exec(getComputedStyle(probe).color);
    probe.remove();
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  // Whether a fixed background is light or dark is told by contrast (wbContrastInk): the dark ink (--wb-fixed-ink-light, the
  // ink for light grounds) reading better on it makes it 'light'; the list's own family stands in when a colour cannot be read.
  function groundOf(f) {
    const pick = wbContrastInk(rgbOfColour(fixedColour(f)), rgbOfColour('var(--wb-fixed-ink-light)'), rgbOfColour('var(--wb-fixed-ink-dark)'));
    return pick === 'dark' ? 'light' : pick === 'light' ? 'dark' : f.family;
  }
  function showBackdrop() {
    const d = wbBackdrop(boardSettings.background);
    surface.style.setProperty('--wb-ground', d.ground);
    surface.style.setProperty('--wb-dot', wbGridPaint(d, wbGrid));
    surface.dataset.grid = wbGrid.style;
    surface.dataset.background = d.id;
    surface.dataset.ground = d.family === 'themed' ? 'themed' : groundOf(WB_FIXED_BY_ID.get(d.id));
  }
  function takeBoard(change) {
    boardSettings = change.op === 'put' ? change.block : WB_BOARD_USUAL;
    showBackdrop();
  }
  async function reloadBoard() {
    try { const list = await boardSync.load(); boardSettings = list[0] || WB_BOARD_USUAL; } catch { return; }
    showBackdrop();
  }
  const boardSync = createSync({ host, board: WB_BOARD, prefix: WB_BOARD_PREFIX, clean: wbCleanBoard, me, onRemote: takeBoard, onReload: reloadBoard, onRefused, onBusy });
  // Put the settings as `next` (a background picked, or an undo): drawn at once, saved whole, told to the history.
  function commitBoard(next) {
    const stamped = { ...wbCleanBoard(next), by: me, at: new Date().toISOString() };
    if (history) history.record(WB_BOARD_STEP, boardSettings, stamped);
    boardSettings = stamped;
    showBackdrop();
    boardSync.save(stamped);
  }
  function setBackground(id) {
    if (!policy.canEdit || presenting || id === boardSettings.background) return;
    commitBoard({ ...boardSettings, background: id });
  }
  // A background picked in a menu: asked first, because it changes for everyone; an Undo or Redo does not ask again.
  async function chooseBackground(id) {
    if (!policy.canEdit || presenting || id === boardSettings.background) return;
    let yes = false;
    try {
      yes = await host.ui.confirm({ title: 'Change background', message: 'This will change for everyone. Are you sure you want to change the background?', action: 'Change background', cancel: 'Cancel' });
    } catch { return; }
    if (yes) setBackground(id);
  }
  // A Clear (the title bar's) takes every key, the background's too; the page of the person who cleared puts the
  // background back at once, so a Clear empties the board of blocks and leaves its colour. Its Undo keeps what is there.
  function keepBackground(e) {
    if (!e || !e.cleared || (e.scope && e.scope !== 'space') || !policy.canEdit || !me || e.by !== me) return;
    if (boardSettings.background === 'default') return;
    boardSync.save({ ...boardSettings, by: me, at: new Date().toISOString() });
  }

  // ---- selecting and editing ----------------------------------------------------------------------------------------
  let deleteButton = null;
  let addCanConnect = false; // the +'s "Connect the 2 picked blocks" is on
  // Pick exactly these blocks (an array of ids; [] or null for none).
  // Picking a block of a group picks the whole group (lib-m, wbExpandGroups).
  function select(ids) {
    sel.clear();
    const want = (ids || []).filter((id) => board.has(id));
    for (const id of want.length ? wbExpandGroups(want, board.all()) : []) if (board.has(id)) sel.add(id);
    if (cellNav && !(sel.size === 1 && sel.has(cellNav.id))) leaveCells(); // the cells are the one picked table's
    renderer.select([...sel], handlesOf(one()));
    toolbarTail();
    if (Boolean(pair()) !== addCanConnect) setAdd();
    updateStatus();
  }
  // The toolbar's buttons for what is picked, always in this order: Delete (something picked may be
  // deleted), Arrange (two or more picked, for someone who may change the board). Made again in order when one comes or
  // goes. (Snap to grid is in the right zone, so it stays at the far right.)
  let arrangeButton = null;
  function toolbarTail() {
    const wantDelete = [...sel].some((id) => policy.canDelete(board.get(id)));
    const wantArrange = policy.canEdit && sel.size > 1;
    if (Boolean(deleteButton) === wantDelete && Boolean(arrangeButton) === wantArrange) return;
    if (arrangeButton) { arrangeButton.destroy(); arrangeButton = null; }
    if (deleteButton && !wantDelete) { deleteButton.destroy(); deleteButton = null; }
    if (wantDelete && !deleteButton) deleteButton = host.ui.toolbarButton({ id: 'delete', label: 'Delete', icon: 'trash', iconOnly: true, onClick: () => removeMany([...sel]) });
    if (wantArrange) arrangeButton = host.ui.toolbarButton({ id: 'arrange', label: 'Arrange', icon: 'arrows-left-right-to-line', iconOnly: true, onClick: (e) => arrangeMenu(toolbarAt(e)) });
  }
  // Auto-connect: the last flowchart shape this person placed with the Flowchart tool (cleared when another tool is chosen),
  // and whether a new one is joined to it when they are in a row (wbAutoConnect). The choice is this browser's.
  const FLOW_KEY = 'whiteboard-auto-connect';
  let autoConnect = true;
  try { autoConnect = window.localStorage.getItem(FLOW_KEY) !== '0'; } catch { /* no browser storage: on */ }
  let lastFlow = null;
  function flowPlaced(id) {
    const b = board.get(id);
    const was = lastFlow && lastFlow !== id ? board.get(lastFlow) : null;
    lastFlow = b ? id : null;
    if (!b || !was || !autoConnect || !policy.canCreate()) return;
    if (!wbAttachable(blockTypes.get(b.type)) || !wbAttachable(blockTypes.get(was.type))) return;
    const sides = wbAutoConnect({ x: was.x, y: was.y, w: was.w, h: was.h }, { x: b.x, y: b.y, w: b.w, h: b.h });
    if (!sides) return;
    const c = ctx.draft(CONNECTOR, { from: { block: was.id, side: sides.from }, to: { block: b.id, side: sides.to } });
    ctx.save(c.id); // in the same turn as the shape's save: one undo step for both
  }
  // The two picked blocks a connector can join (in the order they were picked), or null.
  function pair() {
    if (sel.size !== 2 || !policy.canCreate()) return null;
    const list = [...sel].map((id) => board.get(id));
    return list.every((b) => b && !drafts.has(b.id) && wbAttachable(blockTypes.get(b.type))) ? list : null;
  }
  // Join the two picked blocks with a connector, from the first picked to the second: one save, one undo step.
  function connectPicked() {
    const two = pair();
    if (!two) return;
    const b = ctx.draft(CONNECTOR, { from: { block: two[0].id, side: 'auto' }, to: { block: two[1].id, side: 'auto' } });
    ctx.save(b.id);
    select([b.id]);
    const el = renderer.element(b.id);
    if (el) el.focus({ preventScroll: true });
  }
  function selectAll() { select(board.all().filter((x) => !drafts.has(x.id)).map((x) => x.id)); }
  // Every block a rectangle on the board (board units, any two corners) touches, by each block type's box.
  function blocksIn(r) {
    const x0 = Math.min(r.x0, r.x1); const x1 = Math.max(r.x0, r.x1);
    const y0 = Math.min(r.y0, r.y1); const y1 = Math.max(r.y0, r.y1);
    const out = [];
    for (const b of board.all()) {
      if (drafts.has(b.id)) continue;
      // A connector is picked when the rectangle touches its line, not just the box round it.
      if (blockTypes.get(b.type).attached) { const g = renderer.geometry(b.id); if (g && wbPathTouches(g.points, r)) out.push(b.id); continue; }
      // All it draws: a note's pointer too.
      const def = blockTypes.get(b.type);
      // A frame only when the rectangle covers it whole: one dragged inside it picks what is in it.
      if (def.container) { if (wbFrameInRect(wbRect(b), r)) out.push(b.id); continue; }
      const box = def.reach ? def.reach(b) : def.box(b);
      const el = renderer.element(b.id);
      const h = box.h === null ? (el ? el.offsetHeight : 0) : box.h;
      const bx = b.x + box.x; const by = b.y + box.y;
      if (bx <= x1 && bx + box.w >= x0 && by <= y1 && by + h >= y0) out.push(b.id);
    }
    return out;
  }

  // ---- locks, groups, align and distribute ------------------------------------------------------------------------------
  // What they change is lib-m's to work out; each command is one undo step (every block it changes is saved in the same
  // turn), for someone who may change the board. Locked blocks are left as they are and the person is told (note).
  const lockedNote = (n, of) => { const t = wbLockedNote(n, of); if (t) note(t, 'warning'); };
  // Every block on the board but the drafts (one being drawn, a new one before its words).
  const live = () => board.all().filter((b) => !drafts.has(b.id));
  const pickedBlocks = () => [...sel].map((id) => board.get(id)).filter((b) => b && !drafts.has(b.id));
  const heightOf = (b) => { const el = renderer.element(b.id); return el ? el.offsetHeight : 0; };
  // The picked blocks align and distribute would move: placed (not connectors) and not locked.
  const arrangeable = () => pickedBlocks().filter((b) => !defOf(b).attached && b.locked !== true);
  function arrange(how) {
    if (!policy.canEdit || presenting) return;
    const list = pickedBlocks();
    const r = wbArrangeChanges(list, how, { measure: heightOf });
    if (!r.enough) { if (r.locked) note(wbLockedNote(r.locked, list.length), 'warning'); else note('Pick more blocks to do that.'); return; }
    // A frame moved takes the blocks inside it along, in the same step.
    const f = wbFrameMoveChanges(r.moves, live(), { measure: heightOf });
    for (const c of f.changes) ctx.change(c.id, c.fields, { save: 'now' });
    if (r.locked || f.locked) lockedNote(r.locked + f.locked, list.length + f.changes.length - r.changes.length + f.locked);
  }
  // The rows of Arrange, in the toolbar's menu and the right-click menu: each greyed while too few blocks can move.
  const arrangeRows = () => {
    const n = arrangeable().length;
    return WB_ARRANGE.flatMap((a, i) => [
      ...(i > 0 && a.distribute && !WB_ARRANGE[i - 1].distribute ? [{ separator: true }] : []),
      { id: `arrange-${a.id}`, label: a.label, icon: a.icon, disabled: n < (a.distribute ? 3 : 2), onClick: () => arrange(a.id) },
    ]);
  };
  function arrangeMenu(where) {
    if (!policy.canEdit || sel.size < 2) return;
    host.menu.show({ id: 'arrange', ...where, items: [{ heading: `Arrange the ${sel.size} picked blocks` }, ...arrangeRows()] });
  }
  // Lock or unlock what is picked: lock it all when any of it is unlocked, else unlock it all. A lock is written without
  // the usual leave (a locked block may still be unlocked), one save each.
  function lockPicked() {
    if (!policy.canEdit || !sel.size || presenting) return;
    if (editing && sel.has(editing.id)) { const e = editing; editing = null; e.finish(true); }
    const r = wbLockChanges([...sel], pickedBlocks());
    for (const c of r.changes) {
      const b = board.get(c.id);
      const next = b && policy.canLock(b) ? wbClean({ ...b, ...c.fields }) : null;
      if (next) commit(next, 'now');
    }
    select([...sel]); // no handles on a locked block; Delete and Arrange as they now are
    say(r.on ? 'Locked.' : 'Unlocked.');
  }
  const canGroup = () => policy.canEdit && wbGroupChanges([...sel], board.all(), { newGroup: () => 'x' }).changes.length > 0;
  const inGroup = () => { const groups = wbGroupsOf(board.all()); return [...sel].some((id) => groups.has(wbGroupOf(board.get(id)))); };
  function groupPicked() {
    if (!policy.canEdit || !sel.size) return;
    const r = wbGroupChanges([...sel], board.all());
    if (!r.changes.length) { if (r.locked) lockedNote(r.locked, sel.size); return; }
    for (const c of r.changes) ctx.change(c.id, c.fields, { save: 'now' });
    select([...sel]);
    if (r.locked) lockedNote(r.locked, r.locked + r.changes.length);
    say(`Grouped ${r.changes.length} blocks.`);
  }
  function ungroupPicked() {
    if (!policy.canEdit || !sel.size) return;
    const r = wbUngroupChanges([...sel], board.all());
    for (const c of r.changes) ctx.change(c.id, c.fields, { save: 'now' });
    if (r.locked) lockedNote(r.locked, r.locked + r.changes.length);
    if (r.changes.length) say('Ungrouped.');
  }
  // Guides: the box round the dragged blocks (their boxes as drawn; connectors follow them), and the boxes of the other
  // blocks in sight or near it (half a screen round it), found once when a drag begins.
  function guideBoxes(ids) {
    const mine = new Set(ids);
    let box = null;
    for (const id of ids) {
      const b = board.get(id);
      const r = b && !defOf(b).attached ? renderer.rectOf(id) : null;
      if (!r) continue;
      box = box ? { x0: Math.min(box.x0, r.x0), y0: Math.min(box.y0, r.y0), x1: Math.max(box.x1, r.x1), y1: Math.max(box.y1, r.y1) } : { ...r };
    }
    const v = viewBox();
    const mx = (v.x1 - v.x0) / 2;
    const my = (v.y1 - v.y0) / 2;
    const near = [];
    for (const b of board.all()) {
      if (mine.has(b.id) || drafts.has(b.id) || defOf(b).attached) continue;
      const r = renderer.rectOf(b.id);
      if (r && r.x1 >= v.x0 - mx && r.x0 <= v.x1 + mx && r.y1 >= v.y0 - my && r.y0 <= v.y1 + my) near.push(r);
    }
    return { box, near };
  }

  // The handles the one picked block shows: its type's (resize), only with Select and only to someone who may change it.
  function handlesOf(id) {
    const b = id && board.get(id);
    const def = b && blockTypes.get(b.type);
    if (!def || !def.resize || tool.id !== 'select' || !(drafts.has(id) || policy.canChange(b))) return null;
    return def.resize.handles;
  }

  // Words edited in a tool that stays on (Text, Note, Table, Frame): when the editing ends the block is let go, so the strip is the tool's again.
  // (A moment later: ending the editing hands the focus back to the block, which would pick it again.)
  function settle(id) {
    setTimeout(() => { if (tool.id !== 'select' && !tool.mode && !editing && sel.size === 1 && sel.has(id)) select(null); }, 0);
  }
  function edit(id, o = {}) {
    const { fresh = false } = o;
    const b = board.get(id);
    const def = b && blockTypes.get(b.type);
    const el = renderer.element(id);
    if (!def || !el || !def.edit) return;
    if (!drafts.has(id) && !policy.canChange(b)) { if (b.locked && policy.canLock(b)) lockedNote(1, 1); return; }
    if (editing) { const e = editing; editing = null; e.finish(true); }
    if (def.edit === 'cells') {
      // A table: the cell pressed, else the active one, else the first.
      const at = (o.target && def.cellAt(o.target)) || (cellNav && cellNav.id === id ? cellNav : null) || (lastCell && lastCell.id === id ? lastCell : null) || { r: 0, c: 0 };
      editCell(id, at.r, at.c);
      return;
    }
    if (def.edit === 'colour') {
      const r = el.getBoundingClientRect();
      const box = host.rootElement.getBoundingClientRect();
      colourMenu({ at: { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 } }, id);
      return;
    }
    held.add(id);
    const field = def.textField || 'text'; // a picture's description is its alt
    const handle = wbEditText(el, def.textOf(el), b[field] || '', (text) => {
      if (editing && editing.id === id) editing = null;
      const now = board.get(id);
      if (now) {
        if (!text.trim() && def.textEmpty === 'remove') remove(id);
        else if (text !== now[field] || drafts.has(id)) ctx.change(id, { [field]: text }, { save: 'now' });
        else renderer.draw(now);
      }
      release(id);
      renderer.refreshFrame();
      settle(id);
    }, {
      grow: b.type === 'text',
      line: Boolean(def.textLine),
      label: def.textLabel || 'Words',
      max: def.textMax || 0,
      // Words that take markup get the formatting bar (lib-d).
      bar: def.markup ? { layer: surface, icon: iconSvg, mod: KEYS ? MOD : null, align: alignFor(id) } : null, // keys named only where there are keys
    });
    editing = { id, finish: handle.finish, fresh };
  }

  // The format bar's alignment buttons for the block being edited: what it has now, and a change of one field (one save).
  const alignFor = (id) => ({
    read() {
      const b = board.get(id);
      const d = b && defOf(b);
      return b ? { align: b.align, valign: wbValignOf(b, d) } : null;
    },
    set(field, v) {
      const b = board.get(id);
      if (!b || !(drafts.has(id) || policy.canChange(b))) return;
      ctx.change(id, { [field]: v }, { save: 'now' });
      if (field !== 'valign') nextText[field] = v;
    },
  });
  // ---- cells ------------------------------------------------------------------------------------------------------------
  // A table's cells are edited one at a time, in place, with the same editor and formatting bar as a note's words: Tab and
  // Shift Tab keep the words and go on to the next and the previous cell (Tab on the last cell adds a row first), Enter
  // keeps them and moves down, Shift Enter makes a new line, Escape puts them back, a press elsewhere keeps them. Each cell
  // kept is one save and one undo step (with the row Tab adds).
  // The table is not held while a cell is edited: what someone else changes in it meanwhile is drawn at once (the cell's
  // text box stays as it is), and the cell's words are then written into the newest table, that cell alone
  // (wbTableSetCell), so what the others changed stays. Only a cell that was changed here is written. Cells are found by
  // their place: a row or a column someone adds or deletes above or left of it meanwhile moves the words typed to the cell
  // that is then in that place, and a cell no longer in the table is not kept (the person is told). Two people changing
  // the same table at the same moment otherwise still overwrite each other, as with any block (the last write wins).
  // The active cell: Enter on a picked table (or editing a cell) shows it, and then the arrow keys move it rather than the
  // table, Enter or F2 edits it, a letter typed starts its words afresh, Delete empties it and Escape goes back to moving
  // the table. It is this page's own mark (data-cell on the block), never saved.
  let cellNav = null; // { id, r, c } while a table's cells are moved through
  let lastCell = null; // { id, r, c }: the cell last pressed, for Enter
  let cellClip = null; // the words of a cell, copied with the menu's Copy cell text (this page's memory)
  const tableDef = () => blockTypes.get('table');
  function showCell(id, r, c) {
    if (cellNav && cellNav.id !== id) { const was = renderer.element(cellNav.id); if (was) { delete was.dataset.cell; tableDef().markCell(was); } }
    cellNav = { id, r, c };
    const el = renderer.element(id);
    if (el) { el.dataset.cell = `${r},${c}`; tableDef().markCell(el); }
  }
  function leaveCells() {
    if (!cellNav) return;
    const el = renderer.element(cellNav.id);
    cellNav = null;
    if (el) { delete el.dataset.cell; tableDef().markCell(el); }
  }
  function sayCell(id, r, c) {
    const b = board.get(id);
    if (!b) return;
    const t = wbPlain(wbCellOf(b, r, c));
    say(`Row ${r + 1}, column ${c + 1}${b.head && r === 0 ? ', header' : ''}: ${t || 'empty'}`);
  }
  // One cell's words, written into the table as it is now (one save), or a note when they cannot be.
  function putCell(id, r, c, text) {
    const now = board.get(id);
    if (!now || (!drafts.has(id) && !policy.canChange(now))) return false;
    const put = wbTableSetCell(now, r, c, text);
    if (!put) { note('That cell is not in the table any more, so what was typed in it was not kept.'); return false; }
    if (put.cut) note('The table is full, so the words were cut short.');
    ctx.change(id, { cells: put.cells }, { save: 'now' });
    return true;
  }
  function editCell(id, r, c, { typed = '' } = {}) {
    const b = board.get(id);
    const def = b && blockTypes.get(b.type);
    const el = renderer.element(id);
    if (!def || def.edit !== 'cells' || !el) return;
    if (!drafts.has(id) && !policy.canChange(b)) { if (b.locked && policy.canLock(b)) lockedNote(1, 1); return; }
    if (editing) { const e = editing; editing = null; e.finish(true); }
    const td = def.cellEl(el, r, c);
    if (!td) return;
    showCell(id, r, c);
    const start = wbCellOf(b, r, c);
    let then = null; // where to go once the words are kept: 'next', 'prev' or 'down'
    const handle = wbEditText(td, td.querySelector(':scope > .wb-words'), start, (text) => {
      if (editing && editing.id === id) editing = null;
      if (board.get(id)) {
        if (text !== start) putCell(id, r, c, text);
        else if (drafts.has(id)) ctx.save(id); // a new table whose first cell is left empty: saved as it is
      }
      renderer.refreshFrame();
      const now = board.get(id);
      if (!now) return;
      const step = then ? wbTableStep(now, r, c, then) : null;
      if (step && step.grow) {
        const f = wbTableInsertRow(now, now.rows.length);
        if (f.refuse) { note(f.refuse); showCell(id, r, c); el.focus({ preventScroll: true }); return; }
        ctx.change(id, f, { save: 'now' }); // in the same undo step as the cell
      }
      if (step && then !== 'down') { editCell(id, step.r, step.c); return; }
      const at = step || { r, c };
      showCell(id, at.r, at.c);
      if (then) { el.focus({ preventScroll: true }); sayCell(id, at.r, at.c); }
      if (!then) settle(id);
    }, {
      grow: true,
      label: `Row ${r + 1}, column ${c + 1}`,
      max: def.cellMax,
      bar: { layer: surface, icon: iconSvg, mod: KEYS ? MOD : null, align: alignFor(id) },
      home: el,
      keys(e, finish) {
        if (e.ctrlKey || e.metaKey || e.altKey) return false;
        if (e.key === 'Tab') { e.preventDefault(); then = e.shiftKey ? 'prev' : 'next'; finish(true); return true; }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); then = 'down'; finish(true); return true; }
        return false;
      },
    });
    editing = { id, finish: handle.finish, cell: { r, c, td } };
    // A letter typed on the active cell starts its words afresh with it.
    const box = typed ? td.querySelector('.wb-text-edit') : null;
    if (box) { box.value = typed.slice(0, def.cellMax); box.setSelectionRange(box.value.length, box.value.length); box.dispatchEvent(new Event('input')); }
  }
  // The right-click menu's entries for a table's cell: Edit cell, the rows and columns, the header row, and the cell.
  function cellRows(b, cell) {
    const def = defOf(b);
    const text = wbCellOf(b, cell.r, cell.c);
    // Each worked out again from the table as it is when it is chosen (someone may have changed it meanwhile).
    const run = (id) => () => {
      const now = board.get(b.id);
      const a = now && def.actions(now, cell).find((x) => x.id === id);
      if (!a || !policy.canChange(now)) return;
      const { refuse, cut: _cut, ...fields } = a.fields;
      if (refuse) { note(refuse); return; }
      ctx.change(b.id, fields, { save: 'now' });
    };
    const acts = def.actions(b, cell).map((a) => ({ id: a.id, label: a.label, icon: a.icon, ...(a.current !== undefined ? { current: a.current } : {}), ...(a.ariaLabel ? { ariaLabel: a.ariaLabel } : {}), ...(a.disabled ? { disabled: true } : {}), onClick: run(a.id) }));
    const pick = (ids) => acts.filter((a) => ids.includes(a.id));
    return [
      { id: 'edit', label: 'Edit cell', icon: 'pen', hint: keyHint('Enter'), onClick: () => editCell(b.id, cell.r, cell.c) },
      { id: 'rows', label: 'Rows and columns', icon: 'table-cells', items: [...pick(['row-above', 'row-below', 'col-left', 'col-right']), { separator: true }, ...pick(['row-delete', 'col-delete'])] },
      ...pick(['head']),
      {
        id: 'cell',
        label: 'Cell',
        icon: 'table-cells-large',
        hint: `Row ${cell.r + 1}, column ${cell.c + 1}`,
        items: [
          ...pick(['clear']),
          { id: 'cell-copy', label: 'Copy cell text', icon: 'copy', disabled: !text, onClick: () => { cellClip = text; if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {}); } },
          { id: 'cell-cut', label: 'Cut cell text', icon: 'scissors', disabled: !text, onClick: () => { cellClip = text; if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {}); putCell(b.id, cell.r, cell.c, ''); } },
          { id: 'cell-paste', label: 'Paste cell text', icon: 'paste', disabled: cellClip === null, onClick: () => { if (cellClip !== null) putCell(b.id, cell.r, cell.c, cellClip); } },
        ],
      },
    ];
  }
  // A paste of rows and columns (lib-k): a new table round the pointer, or the middle of what is in sight, saved at once
  // as this person's, picked. Rows and columns past the limits are left out, with a short note.
  function gridOf(data) {
    if (!data || !data.getData) return null;
    let html = '';
    let text = '';
    try { html = data.getData('text/html') || ''; text = data.getData('text/plain') || ''; } catch { return null; }
    const grid = html ? wbGridFromHtml(html, (h) => new DOMParser().parseFromString(h, 'text/html')) : null;
    if (grid) return grid;
    return wbLooksTabular(text) ? wbParseTsv(text) : null;
  }
  function pasteTable(grid) {
    if (!policy.canCreate() || !tableDef()) return;
    const t = wbTableFromGrid(grid);
    const p = hover ? renderer.toBoard(hover.cx, hover.cy) : renderer.center();
    const w = t.cols.reduce((a, n) => a + n, 0);
    const at = { x: p.x - w / 2, y: p.y - (t.rows.length * WB_TABLE.rowMin) / 2 };
    if (snapping(null)) { at.x = wbSnap(at.x); at.y = wbSnap(at.y); } // with Snap to grid, its corner on the grid
    const b = ctx.draft('table', { ...at, cols: t.cols, rows: t.rows, cells: t.cells, head: t.head });
    ctx.save(b.id);
    select([b.id]);
    const el = renderer.element(b.id);
    if (el) el.focus({ preventScroll: true });
    if (t.cut) note(`Only part of it was pasted: a table holds at most ${WB_TABLE.maxRows} rows, ${WB_TABLE.maxCols} columns and ${WB_TABLE.cellMax} characters a cell.`);
  }

  // ---- the host's bands: the tools, the colour and zoom menus, the +, the status line -----------------------------
  // The tools are one switch, named Tools: Hand (a `mode`), Select, then Pen, Fill, Text, Note, Flowchart, Shape, Table and Frame. A tool
  // marked `apart` (the Timer) is its own on/off button after it. Pen, Flowchart and Shape are FAMILIES: one choice in the switch,
  // its kinds (each a tool of its own, with its own key) the buttons of the first group on the colour strip. A kind's key picks
  // its family with that kind; a family remembers the last kind picked, for this session.
  const allowed = tools.list().filter((t) => policy.canUseTool(t));
  const FAMILIES = [
    { id: 'pen', kinds: ['pen', 'marker', 'brush', 'highlight'] },
    { id: 'shape', kinds: ['rect', 'ellipse', 'line', 'arrow'] },
    { id: 'flowchart', kinds: ['connector', 'rounded', 'diamond', 'pill', 'parallelogram'] },
  ];
  const familyHas = (f) => f.kinds.some((id) => allowed.some((t) => t.id === id));
  const lastKind = Object.fromEntries(FAMILIES.map((f) => [f.id, f.kinds[0]]));
  let family = null; // the id of the family the tool is a kind of, else null
  const SWITCH = [
    { id: 'hand', label: 'Hand', icon: 'hand' },
    { id: 'select', label: 'Select', icon: 'arrow-pointer' },
    { id: 'pen', label: 'Pen', icon: 'pen' },
    { id: 'fill', label: 'Fill', icon: 'fill-drip' },
    { id: 'text', label: 'Text', icon: 'font' },
    { id: 'note', label: 'Note', icon: 'note-sticky' },
    { id: 'flowchart', label: 'Flowchart', icon: 'diagram-project' },
    { id: 'shape', label: 'Shape', icon: 'shapes' },
    { id: 'table', label: 'Table', icon: 'table' },
    { id: 'frame', label: 'Frame', icon: 'crop-simple' },
  ];
  const inSwitch = (o) => (FAMILIES.some((f) => f.id === o.id) ? familyHas(FAMILIES.find((f) => f.id === o.id)) : allowed.some((t) => t.id === o.id));
  const pickTool = (v) => {
    const f = FAMILIES.find((x) => x.id === v);
    if (f) setTool(allowed.some((t) => t.id === lastKind[v]) ? lastKind[v] : f.kinds.find((id) => allowed.some((t) => t.id === id)), v);
    else setTool(v);
  };
  const toolSwitch = SWITCH.filter(inSwitch).length > 1
    ? host.ui.viewSwitch({ id: 'tool', label: 'Tools', value: tool.id, options: SWITCH.filter(inSwitch), onChange: pickTool })
    : null;
  // An apart tool's button, and its key or a mode's (the Hand's H), turn it on, and again off, back to the tool used before it.
  const goesBack = (t) => Boolean(t && (t.apart || t.mode));
  let toolBefore = 'select';
  const toggleTool = (t) => setTool(tool === t ? toolBefore : t.id);
  const apartButtons = allowed.filter((t) => t.apart).map((t) => ({
    tool: t,
    button: host.ui.toolbarButton({ id: `tool-${t.id}`, label: withKey(t.label, t.key.toUpperCase()), icon: t.icon, iconOnly: true, on: false, onClick: () => toggleTool(t) }),
  }));
  const showTool = () => {
    if (toolSwitch) toolSwitch.set(family || (SWITCH.some((o) => o.id === tool.id) ? tool.id : ''));
    for (const a of apartButtons) a.button.set({ on: a.tool === tool });
  };
  // `fam`: the family a kind is picked in (the Rectangle is a kind of Shape and of Flowchart); else the first it is in.
  function setTool(id, fam) {
    const next = tools.get(id);
    const nextFamily = next ? (fam && FAMILIES.some((f) => f.id === fam && f.kinds.includes(next.id)) ? fam : (FAMILIES.find((f) => f.kinds.includes(next.id)) || {}).id || null) : null;
    if (!next || !policy.canUseTool(next) || (next === tool && nextFamily === family)) { showTool(); return; }
    if (tool.deactivate) tool.deactivate(ctx);
    if (goesBack(next) && !goesBack(tool)) toolBefore = tool.id;
    if (!next.mode && next.id !== 'select') many = false; // Select many is Select's: a drawing tool ends it, the Hand does not
    tool = next;
    family = nextFamily;
    if (!(tool.makes && blockTypes.get(tool.makes) && ['rounded', 'diamond', 'pill', 'parallelogram'].includes(tool.makes))) lastFlow = null;
    if (family) lastKind[family] = tool.id;
    if (tool.id !== 'select' && !tool.mode && sel.size) select(null); // a tool's strip is about the tool, not what was picked before
    if (tool.activate) tool.activate(ctx);
    surface.dataset.tool = tool.id;
    surface.style.cursor = tool.cursor || '';
    renderer.select([...sel], handlesOf(one()));
    showTool();
    updateHint();
    updateStatus();
    updatePaint();
  }
  surface.dataset.tool = tool.id;
  surface.setAttribute('aria-label', boardHelp());

  // ---- colours, widths and layers ----------------------------------------------------------------------------------
  // The Colour and Width menus change the picked blocks (each that has that colour or a width), or, with none picked, what
  // new blocks get (for the active tool's block type when it makes one). The current choice is the marked row; with
  // several blocks that differ, no row is marked. Each change is one whole save of each block.
  const toolbarAt = (e) => ({ at: { x: e && Number.isFinite(e.x) ? e.x : 100000, y: 4 } });
  const NAMED = { none: { label: 'None', icon: 'ban' }, auto: { label: 'Matching', icon: 'circle-half-stroke' }, usual: { label: 'Default', icon: 'circle-dot' } };
  // The blocks the menus work on: the one given, else every picked one this person may change.
  const targets = (only) => (only ? [only] : [...sel]).map((id) => board.get(id)).filter((b) => b && policy.canChange(b));
  const roleLabel = (def, role) => (def && def.paint && def.paint[role.id] && def.paint[role.id].label) || role.label;
  const choiceRow = (id, label, now, onPick, extra = {}) => ({
    id: id || 'usual',
    label,
    current: id === now,
    ariaLabel: id === now ? `${label}, chosen` : undefined,
    onClick: onPick,
    ...extra,
  });
  const swatch = (id) => {
    if (NAMED[id]) return { icon: NAMED[id].icon };
    const col = colourOf(id);
    return col ? { icon: 'circle', iconColor: col } : { icon: 'circle', regular: true };
  };
  // A role's rows in the groups the background menu has (lib-a, wbColourMenuModel): its own rows first, then Light colours and
  // Dark colours (fixed), Tinted colours (follow the theme) and the disabled Custom row. `pick(id)` makes a row's click.
  function colourRows(specialRows, now, pick) {
    return wbColourMenuModel(specialRows).map((e) => {
      if (e.kind === 'special') return e.row;
      if (e.kind === 'heading') return { heading: e.label };
      if (e.kind === 'custom') return { id: 'custom', label: e.label, disabled: true };
      const how = e.kind === 'fixed' ? 'fixed colour' : 'follows the theme';
      return choiceRow(e.id, e.label, now, pick(e.id), { ...swatch(e.id), ariaLabel: `${e.label}, ${how}${e.id === now ? ', chosen' : ''}` });
    });
  }
  const defOf = (b) => blockTypes.get(b.type);
  const nounOf = (b) => { const def = defOf(b); return def.noun ? def.noun(b) : def.label.toLowerCase(); };
  // The one value every block has, or undefined when they differ.
  const agreed = (list, field) => { const vals = new Set(list.map((b) => b[field])); return vals.size === 1 ? [...vals][0] : undefined; };
  // Whose colours a menu shows: "this note", "the 3 picked blocks", "the Pen tool" (what it draws next), "new blocks".
  const whoseOf = (list, def) => (list.length > 1 ? `the ${list.length} picked blocks` : list.length ? `this ${nounOf(list[0])}` : def ? `the ${tool.label} tool` : 'new blocks');
  // A role's colour in words: a palette colour's name, None, Matching, Mixed (the picked blocks differ) or Default (each
  // block type's own colour, when no type is known).
  const nameOf = (id) => (id === undefined ? 'Mixed' : NAMED[id] ? NAMED[id].label : isColour(id) ? colourLabel(id) : 'Default');

  // `role`: only that colour role's rows (a swatch on the board's strip opens its own role).
  function colourMenu(where, only, role) {
    const list = targets(only);
    if (!list.length && tool.paints === 'fill') {
      // The Fill tool's colour (the fill new blocks get too): the palette, the current one marked.
      const now = nextFill();
      const rows = colourRows([], now, (id) => () => ctx.setNextFill(id, { quiet: true }));
      host.menu.show({ id: 'colour', ...where, items: [{ heading: 'Colour for the Fill tool' }, ...rows] });
      return;
    }
    const def = list.length ? null : tool.makes ? blockTypes.get(tool.makes) : null;
    let groups;
    if (list.length) {
      // A role's rows on blocks: the extra choices every one of them takes, then the palette.
      groups = WB_ROLES.map((role) => {
        const having = list.filter((b) => { const d = defOf(b); return d.paint && d.paint[role.id]; });
        if (!having.length) return null;
        const now = agreed(having, role.id);
        const extras = having.map((b) => defOf(b).paint[role.id].extra || []).reduce((a, x) => a.filter((v) => x.includes(v)));
        const pick = (v) => () => {
          for (const b of having) ctx.change(b.id, { [role.id]: v }, { save: 'now' });
          if (isColour(v)) for (const t of new Set(having.map((b) => b.type))) setNextColour(blockTypes.get(t), role.id, v);
        };
        const rows = colourRows(extras.map((v) => choiceRow(v, NAMED[v].label, now, pick(v), swatch(v))), now, pick);
        const same = new Set(having.map((b) => b.type)).size === 1 ? defOf(having[0]) : null;
        return { role, label: roleLabel(same, role), now, rows };
      }).filter((g) => g && (!role || g.role.id === role));
    } else {
      // For new blocks: "Default" (the block type's own colour, named beside it when the type is known) and the palette.
      groups = WB_ROLES.filter((r) => (!def || takesNext(def, r.id)) && (!role || r.id === role)).map((r) => {
        const now = nextColour(def, r.id);
        const usual = def ? def.create()[r.id] : null;
        const pick = (v) => () => { setNextColour(def, r.id, v); updateStatus(); };
        const rows = colourRows([choiceRow(null, 'Default', now, pick(null), { ...swatch(usual), hint: usual ? nameOf(usual) : '' })], now, pick);
        return { role: r, label: roleLabel(def, r), now: now === null ? usual : now, rows };
      });
    }
    if (!groups.length) return;
    const whose = whoseOf(list, def);
    const prep = list.length ? 'of' : 'for';
    const items = groups.length === 1
      ? [{ heading: groups[0].role.id === 'ink' ? `Colour of the words ${prep} ${whose}` : `${groups[0].label} colour ${prep} ${whose}` }, ...groups[0].rows]
      : [{ heading: `Colours ${prep} ${whose}` }, ...groups.map((g) => ({ id: g.role.id, label: g.label, hint: nameOf(g.now), ...swatch(g.now), items: g.rows }))];
    host.menu.show({ id: 'colour', ...where, items });
  }

  // The board's background (one for everyone, see "the board's background"), in groups: Default (the theme's own board colour),
  // Custom background (a disabled row until the host has a colour picker), Light and Dark backgrounds (fixed colours, the same
  // in both modes) and Tinted backgrounds (washes that follow the theme). The current one is marked. A pick asks first, then
  // is one save and one undo step.
  function backgroundMenu(where) {
    if (!policy.canEdit) return;
    const now = boardSettings.background;
    const pick = (id) => () => { chooseBackground(id); };
    const fixedRow = (f) => choiceRow(f.id, f.label, now, pick(f.id), { icon: 'circle', iconColor: fixedColour(f) || undefined, ariaLabel: `${f.label} background, fixed colour${f.id === now ? ', chosen' : ''}` });
    const tintRow = (c) => choiceRow(c.id, c.label, now, pick(c.id), { ...swatch(c.id), ariaLabel: `${c.label} background, follows the theme${c.id === now ? ', chosen' : ''}` });
    const items = [
      { heading: 'Background colour of the board' },
      choiceRow('default', 'Default', now, pick('default'), { icon: 'circle', regular: true, ariaLabel: `Default background, follows the theme${now === 'default' ? ', chosen' : ''}` }),
      { heading: 'Custom background' },
      { id: 'custom', label: 'Custom colour (coming with the colour picker)', disabled: true },
      { heading: 'Light backgrounds' },
      ...WB_FIXED_BACKGROUNDS.filter((f) => f.family === 'light').map(fixedRow),
      { heading: 'Dark backgrounds' },
      ...WB_FIXED_BACKGROUNDS.filter((f) => f.family === 'dark').map(fixedRow),
      { heading: 'Tinted backgrounds' },
      ...WB_PALETTE.map(tintRow),
    ];
    host.menu.show({ id: 'background', ...where, items });
  }
  const backgroundRow = (at) => ({ id: 'background', label: 'Background colour', icon: 'palette', hint: nameOf(boardSettings.background), onClick: () => { setTimeout(() => backgroundMenu({ at }), 0); } });

  function widthMenu(where, only) {
    const all = targets(only);
    const list = all.filter((b) => defOf(b).weight);
    const def = list.length ? (new Set(list.map((b) => b.type)).size === 1 ? defOf(list[0]) : null) : tool.makes ? blockTypes.get(tool.makes) : null;
    if (all.length && !list.length) return;
    if (!list.length && def && !takesNext(def, 'weight')) {
      // A note's or a text block's border is set on the block itself, not for the next one.
      host.menu.show({ id: 'width', ...where, items: [{ label: `Pick a ${def.noun ? def.noun(def.create()) : def.label.toLowerCase()} to change its border width`, disabled: true }] });
      return;
    }
    // A freehand tool's width, and a picked drawing's, is remembered for its brush alone.
    const brushOf = list.length === 1 ? brushKey(list[0].type, list[0].brush) : !list.length && def ? brushKey(def.type, tool.usual && tool.usual.brush) : null;
    const now = list.length ? agreed(list, 'weight') : nextWeightOf(brushOf);
    const pick = (v) => () => {
      for (const b of list) ctx.change(b.id, { weight: v }, { save: 'now' });
      if (!list.length || (list.length === 1 && takesNext(def, 'weight'))) setNextWeight(brushOf, v);
      updateStatus();
    };
    const lines = (t) => t === 'line' || t === 'stroke' || t === 'highlight' || t === CONNECTOR;
    const border = list.length ? !list.every((b) => lines(b.type)) : def && !lines(def.type);
    const whose = list.length || def ? whoseOf(list, def) : 'new lines and borders';
    const items = [{ heading: `${border ? 'Border width' : 'Line width'} ${list.length ? 'of' : 'for'} ${whose}` }];
    const samples = []; // the weight each choice row draws, in row order
    if (!list.length) {
      const usual = def ? (tool.makes === def.type && tool.usual && tool.usual.weight) || def.create().weight : null;
      items.push(choiceRow(null, 'Default', now, pick(null), { hint: usual ? wbWeightName(usual) : '' }));
      samples.push(usual);
    }
    for (const w of WB_WEIGHTS) { items.push(choiceRow(w, wbWeightName(w), now, pick(w))); samples.push(w); }
    if (list.some((b) => b.stroke === 'none')) items.push({ separator: true }, { label: 'Pick a border colour to show it', disabled: true });
    host.menu.show({ id: 'width', className: 'wb-width-menu', ...where, items });
    // The menu has no picture slot but an icon, so each choice row gets a small line drawn at its weight.
    const menu = surface.getRootNode().querySelector('.wb-width-menu');
    if (menu) [...menu.querySelectorAll('.sdk-menu-item:not(:disabled)')].forEach((row, i) => {
      if (!samples[i]) return;
      row.insertBefore(widthSample(samples[i]), row.firstChild);
    });
  }
  // A short line drawn at a width, for a menu row.
  function widthSample(w, className = 'wb-width-sample') {
    const line = document.createElement('span');
    line.className = className;
    line.setAttribute('aria-hidden', 'true');
    line.style.setProperty('--sample', `${w}px`);
    return line;
  }

  // ---- the colours and width on show ------------------------------------------------------------------------------------
  // A toolbar button holds only an icon, never a colour or a drawing, so the colours and the width are shown on the board's
  // own strip (#paint), hung under the toolbar's left end: a swatch for each colour role (Border a frame, Background a
  // filled square, Words an A over a bar) and a line drawn at the width, each a button that opens its own menu. Each shows
  // what its menu marks: the picked blocks' (several colours when they differ), else what new blocks get (the active
  // tool's block type's own when Default is chosen; a dashed mark when no type is known). Hidden for a role the
  // picked blocks or the tool's type do not have, and for someone who may only look.
  const paintStrip = $('paint');
  const paintButtons = new Map(); // role id or 'weight' -> { button, mark }
  // The strip's first group: the kinds of the active tool when it has them (Pen: pen, marker, brush, highlighter; Shape;
  // Flowchart), a small row of icon buttons, the chosen one pressed, then a thin divider before the colours.
  const KIND_ICONS = { pen: 'pen', marker: 'marker', brush: 'paintbrush', highlight: 'highlighter', rect: 'square', ellipse: 'circle', line: 'minus', arrow: 'arrow-right-long', connector: 'arrows-turn-right', rounded: 'square', diamond: 'diamond', pill: 'capsules', parallelogram: 'arrow-right-arrow-left' };
  const FAMILY_NAMES = { pen: 'Pen', shape: 'Shape', flowchart: 'Flowchart' };
  const kindsBox = document.createElement('div');
  kindsBox.className = 'wb-kinds';
  kindsBox.setAttribute('role', 'group');
  kindsBox.hidden = true;
  // The strip is one card in groups with a thin divider between: the kinds, the fonts (size and alignment), the line
  // (style and arrowheads) and the colours. Each group shows only when the active tool or the picked blocks can use it.
  const fontsBox = document.createElement('div');
  fontsBox.className = 'wb-paint-group wb-fonts';
  fontsBox.setAttribute('role', 'group');
  fontsBox.setAttribute('aria-label', 'Words');
  fontsBox.hidden = true;
  const lineBox = document.createElement('div');
  lineBox.className = 'wb-paint-group wb-linegroup';
  lineBox.setAttribute('role', 'group');
  lineBox.setAttribute('aria-label', 'Line');
  lineBox.hidden = true;
  const tableBox = document.createElement('div');
  tableBox.className = 'wb-paint-group wb-tablegroup';
  tableBox.setAttribute('role', 'group');
  tableBox.setAttribute('aria-label', 'Table');
  tableBox.hidden = true;
  const coloursBox = document.createElement('div');
  coloursBox.className = 'wb-paint-group wb-colours';
  coloursBox.setAttribute('role', 'group');
  coloursBox.setAttribute('aria-label', 'Colours and line width');
  const selectionBox = document.createElement('div');
  selectionBox.className = 'wb-paint-group wb-selectgroup';
  selectionBox.setAttribute('role', 'group');
  selectionBox.setAttribute('aria-label', 'Selection');
  selectionBox.hidden = true;
  const presentBox = document.createElement('div');
  presentBox.className = 'wb-paint-group wb-presentgroup';
  presentBox.setAttribute('role', 'group');
  presentBox.setAttribute('aria-label', 'Frames');
  presentBox.hidden = true;
  // The strip begins with a quiet badge: the icon of the tool it belongs to (or of the kind of block picked).
  const endcap = document.createElement('span');
  endcap.className = 'wb-endcap';
  endcap.setAttribute('role', 'img');
  const endcapIc = document.createElement('span');
  endcapIc.className = 'ic';
  endcapIc.setAttribute('aria-hidden', 'true');
  endcap.appendChild(endcapIc);
  let endcapName = '';
  function setEndcap(icon, label) {
    endcap.setAttribute('aria-label', label);
    if (endcapName === icon) return;
    endcapName = icon;
    iconSvg(icon).then((svg) => { if (svg && endcapName === icon) endcapIc.innerHTML = svg; });
  }
  const stripGroups = [selectionBox, kindsBox, fontsBox, tableBox, lineBox, presentBox, coloursBox];
  const stripSeps = [];
  for (let i = 1; i < stripGroups.length; i += 1) {
    const sep = document.createElement('span');
    sep.className = 'wb-paint-sep';
    sep.setAttribute('aria-hidden', 'true');
    sep.hidden = true;
    stripSeps.push(sep);
  }
  paintStrip.append(endcap, selectionBox, stripSeps[0], kindsBox, stripSeps[1], fontsBox, stripSeps[2], tableBox, stripSeps[3], lineBox, stripSeps[4], presentBox, stripSeps[5], coloursBox);
  // A divider shows between two groups that both show.
  function stripDividers() {
    stripSeps.forEach((sep, i) => { sep.hidden = !(!stripGroups[i + 1].hidden && stripGroups.slice(0, i + 1).some((g) => !g.hidden)); });
  }
  let afterPaint = () => {}; // set once the find bar exists: it moves clear of the strip's new size
  const kindButtons = new Map(); // tool id -> button
  function showKinds() {
    const f = FAMILIES.find((x) => x.id === family);
    if (!f) { kindsBox.hidden = true; kindsBox.dataset.family = ''; return false; }
    if (kindsBox.dataset.family !== f.id) {
      kindsBox.dataset.family = f.id;
      kindsBox.textContent = '';
      kindButtons.clear();
      kindsBox.setAttribute('aria-label', `${FAMILY_NAMES[f.id]} kinds`);
      for (const id of f.kinds) {
        const t = allowed.find((x) => x.id === id);
        if (!t) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sdk-icon-btn btn-quiet btn-small wb-paint-btn wb-kind';
        const words = withKey(t.label, t.key ? t.key.toUpperCase() : '').replace(' ()', '');
        button.setAttribute('aria-label', t.label);
        button.dataset.tip = words;
        button.dataset.kind = id;
        const ic = document.createElement('span');
        ic.className = 'ic';
        ic.setAttribute('aria-hidden', 'true');
        button.appendChild(ic);
        iconSvg(KIND_ICONS[id] || t.icon).then((svg) => { if (svg) ic.innerHTML = svg; });
        button.addEventListener('click', () => setTool(id, f.id));
        kindsBox.appendChild(button);
        kindButtons.set(id, button);
      }
    }
    for (const [id, button] of kindButtons) button.setAttribute('aria-pressed', String(id === tool.id));
    kindsBox.hidden = false;
    return true;
  }
  function stripButton(key, label, make, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sdk-icon-btn btn-quiet btn-small wb-paint-btn';
    button.setAttribute('aria-haspopup', 'menu');
    const mark = make();
    mark.setAttribute('aria-hidden', 'true');
    button.appendChild(mark);
    button.addEventListener('click', () => onClick(button));
    coloursBox.appendChild(button);
    paintButtons.set(key, { button, mark, label });
  }
  if (policy.canEdit) {
    for (const role of WB_ROLES) {
      stripButton(role.id, role.label, () => {
        const m = document.createElement('span');
        m.className = `wb-sw wb-sw-${role.id}`;
        if (role.id === 'ink') m.textContent = 'A';
        return m;
      }, (button) => colourMenu({ anchor: button }, null, role.id));
    }
    stripButton('weight', 'Line width', () => { const m = document.createElement('span'); m.className = 'wb-lw'; return m; }, (button) => widthMenu({ anchor: button }));
    paintStrip.hidden = false;
  }
  // The fonts group (size, align left / centre / right, align top / middle / bottom) and the line group (elbow or straight,
  // the arrowheads): icon buttons, the chosen one pressed, none pressed when the picked blocks differ. Size is one button
  // that shows the size and opens the four sizes as a menu: a row of four would be wider than the rest put together.
  const fontButtons = new Map(); // 'align:left', 'valign:top' -> button
  const lineButtons = new Map(); // 'style:elbow', 'head:end' -> button
  const LINE_STRIP = {
    style: [{ id: 'elbow', label: 'Elbow line', icon: 'stairs' }, { id: 'straight', label: 'Straight line', icon: 'slash' }],
    head: [{ id: 'none', label: 'No arrowheads', icon: 'minus' }, { id: 'end', label: 'Arrow at the end', icon: 'arrow-right-long' }, { id: 'start', label: 'Arrow at the start', icon: 'arrow-left-long' }, { id: 'both', label: 'Arrows at both ends', icon: 'arrows-left-right' }],
  };
  let sizeButton = null;
  let sizeLabel = null;
  let presentButton = null;
  let valignBox = null;
  let autoButton = null;
  let tableButton = null;
  let singleButton = null;
  let manyButton = null;
  let allButton = null;
  let clearButton = null;
  // Single (a click picks one, Shift adds) or Many (a click toggles a block, an empty drag adds a rectangle).
  function setMany(on) {
    if (tool.id !== 'select' || many === on) return;
    many = on;
    updatePaint();
  }
  if (policy.canEdit) {
    const pressButton = (label, icon, onClick) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sdk-icon-btn btn-quiet btn-small wb-paint-btn';
      button.setAttribute('aria-label', label);
      button.dataset.tip = label;
      button.setAttribute('aria-pressed', 'false');
      const ic = document.createElement('span');
      ic.className = 'ic';
      ic.setAttribute('aria-hidden', 'true');
      button.appendChild(ic);
      iconSvg(icon).then((svg) => { if (svg) ic.innerHTML = svg; });
      button.addEventListener('click', onClick);
      return button;
    };
    const pairBox = (label) => { const s = document.createElement('span'); s.className = 'wb-paint-pair'; s.setAttribute('role', 'group'); s.setAttribute('aria-label', label); return s; };
    sizeButton = document.createElement('button');
    sizeButton.type = 'button';
    sizeButton.className = 'btn btn-quiet btn-small wb-size-btn';
    sizeButton.setAttribute('aria-haspopup', 'menu');
    sizeButton.dataset.tip = 'Text size';
    sizeButton.setAttribute('aria-label', 'Text size');
    sizeButton.addEventListener('click', () => sizeMenu({ anchor: sizeButton }));
    const hBox = pairBox('Align');
    for (const a of WB_ALIGNS) {
      const b = pressButton(`Align ${a.label.toLowerCase()}`, a.icon, () => setWords('align', a.id));
      fontButtons.set(`align:${a.id}`, b);
      hBox.appendChild(b);
    }
    valignBox = pairBox('Vertical align');
    for (const a of WB_VALIGNS) {
      const b = pressButton(`Align ${a.label.toLowerCase()}`, a.icon, () => setWords('valign', a.id));
      fontButtons.set(`valign:${a.id}`, b);
      valignBox.appendChild(b);
    }
    // Selection: Single | Many (the mode of the Select tool), Select all, Clear selection.
    const modeBox = pairBox('Selection mode');
    singleButton = pressButton('Select one at a time', 'arrow-pointer', () => setMany(false));
    manyButton = pressButton('Select many', 'object-group', () => setMany(true));
    modeBox.append(singleButton, manyButton);
    allButton = pressButton('Select all', 'check-double', () => { selectAll(); surface.focus({ preventScroll: true }); });
    allButton.removeAttribute('aria-pressed');
    clearButton = pressButton('Clear selection', 'xmark', () => { if (sel.size) { select(null); surface.focus({ preventScroll: true }); } });
    clearButton.removeAttribute('aria-pressed');
    selectionBox.append(modeBox, allButton, clearButton);
    const sizeIc = document.createElement('span');
    sizeIc.className = 'ic';
    sizeIc.setAttribute('aria-hidden', 'true');
    iconSvg('text-height').then((svg) => { if (svg) sizeIc.innerHTML = svg; });
    sizeLabel = document.createElement('span');
    sizeButton.append(sizeIc, sizeLabel);
    fontsBox.append(sizeButton, hBox, valignBox);
    presentButton = document.createElement('button');
    presentButton.type = 'button';
    presentButton.className = 'btn btn-quiet btn-small wb-present-btn';
    presentButton.dataset.tip = 'Present the frames, from the first';
    presentButton.setAttribute('aria-label', 'Present the frames, from the first');
    const presentIc = document.createElement('span');
    presentIc.className = 'ic';
    presentIc.setAttribute('aria-hidden', 'true');
    iconSvg('play').then((svg) => { if (svg) presentIc.innerHTML = svg; });
    presentButton.append(presentIc, document.createTextNode('Present'));
    presentButton.addEventListener('click', () => {
      if (presentButton.getAttribute('aria-disabled') === 'true') { note('No frames to present. Add a frame first.'); return; }
      startPresenting();
    });
    presentBox.appendChild(presentButton);
    for (const field of ['style', 'head']) {
      const box = pairBox(field === 'style' ? 'Line style' : 'Arrowheads');
      for (const c of LINE_STRIP[field]) {
        const b = pressButton(c.label, c.icon, () => setLine(field, c.id));
        lineButtons.set(`${field}:${c.id}`, b);
        box.appendChild(b);
      }
      lineBox.appendChild(box);
    }
    autoButton = pressButton('Auto-connect', 'link', () => {
      autoConnect = !autoConnect;
      try { window.localStorage.setItem(FLOW_KEY, autoConnect ? '1' : '0'); } catch { /* kept for this visit only */ }
      updatePaint();
    });
    autoButton.dataset.tip = 'Join new shapes to the last one';
    lineBox.appendChild(autoButton);
    tableButton = pressButton('Table properties', 'table-cells-large', () => tableMenu({ anchor: tableButton }));
    tableButton.removeAttribute('aria-pressed');
    tableButton.setAttribute('aria-haspopup', 'menu');
    tableBox.appendChild(tableButton);
  }
  // The picked blocks (or the next ones) the fonts group works on.
  const fontsOf = () => targets().filter((b) => defOf(b).markup);
  const fontsNow = () => {
    const list = targets();
    const def = !list.length && tool.makes ? blockTypes.get(tool.makes) : null;
    return wbFontsShown(list, defOf, def, nextText);
  };
  function setWords(field, v) {
    for (const b of fontsOf()) if (field !== 'valign' || defOf(b).valign) ctx.change(b.id, { [field]: v }, { save: 'now' });
    if (field !== 'valign') nextText[field] = v; // not the vertical: the types sit differently (a table's cells are in the middle)
    updatePaint();
  }
  function sizeMenu(where) {
    const now = (fontsNow() || {}).size;
    host.menu.show({ id: 'size', ...where, items: WB_SIZES.map((c) => choiceRow(c.id, c.label, now, () => setWords('size', c.id))) });
  }
  // The line group shows for picked connectors, or for the Connector tool with nothing picked.
  const lineOf = () => targets().filter((b) => b.type === CONNECTOR);
  function lineNow() {
    const list = targets();
    if (list.length) { const c = lineOf(); return c.length ? c : null; }
    return (tool.id === CONNECTOR || family === 'flowchart') && (policy.canUseTool(tool)) ? [] : null;
  }
  function setLine(field, v) {
    for (const b of lineOf()) ctx.change(b.id, { [field]: v }, { save: 'now' });
    nextLine[field] = v;
    updatePaint();
  }
  // The Table properties button: for the Table tool with nothing picked, or when a table is picked.
  const tablesPicked = () => targets().filter((b) => b.type === 'table');
  function updateTable() {
    tableBox.hidden = !(tableButton && (sel.size ? tablesPicked().length > 0 : tool.id === 'table'));
  }
  // The Table properties menu: alignment, vertical alignment, header row and text size of the whole table, as the strip's
  // buttons do (one save of each picked table, all one undo step); with no table picked, what new tables start with.
  function setTable(field, v) {
    const list = tablesPicked();
    if (!list.length) { nextTable[field] = v; if (field === 'size') nextText.size = v; updatePaint(); return; }
    for (const b of list) ctx.change(b.id, { [field]: v }, { save: 'now' });
    updatePaint();
  }
  function tableMenu(where) {
    const list = tablesPicked();
    const now = wbTableProps(list, { ...nextTable, size: nextText.size || blockTypes.get('table').create().size });
    const sub = (id, label, choices, field) => ({ id, label, hint: (choices.find((c) => c.id === now[field]) || { label: 'Mixed' }).label, items: choices.map((c) => choiceRow(c.id, c.label, now[field], () => setTable(field, c.id), c.icon ? { icon: c.icon } : {})) });
    host.menu.show({
      id: 'table-properties',
      ...where,
      items: [
        { heading: list.length ? (list.length > 1 ? `Properties of the ${list.length} picked tables` : 'Properties of this table') : 'Properties of new tables' },
        sub('cell-align', 'Cell alignment', WB_ALIGNS, 'align'),
        sub('cell-valign', 'Vertical alignment', WB_VALIGNS, 'valign'),
        sub('text-size', 'Text size', WB_SIZES, 'size'),
        { id: 'head', label: 'Header row', icon: 'heading', current: now.head === true, ariaLabel: `Header row, ${now.head === true ? 'on' : 'off'}`, onClick: () => setTable('head', now.head !== true) },
      ],
    });
  }
  function updateFonts() {
    const s = fontsNow();
    fontsBox.hidden = !s;
    if (!s) return;
    const sz = WB_SIZE_BY_ID.get(s.size);
    sizeLabel.textContent = sz ? sz.label : 'Size';
    sizeButton.setAttribute('aria-label', `Text size: ${sz ? sz.label : 'Mixed'}`);
    sizeButton.dataset.tip = `Text size: ${sz ? sz.label : 'Mixed'}`;
    for (const [key, b] of fontButtons) {
      const [field, id] = key.split(':');
      b.setAttribute('aria-pressed', String(s[field] === id));
    }
    valignBox.hidden = s.valign === null;
  }
  function updateLine() {
    const c = lineNow();
    lineBox.hidden = !c;
    if (!c) return;
    autoButton.hidden = c.length > 0 || tool.id === CONNECTOR; // for the shapes the Flowchart tool places
    autoButton.setAttribute('aria-pressed', String(autoConnect));
    const usual = blockTypes.get(CONNECTOR).create();
    for (const [key, b] of lineButtons) {
      const [field, id] = key.split(':');
      const now = c.length ? agreed(c, field) : nextLine[field] || usual[field];
      b.setAttribute('aria-pressed', String(now === id));
    }
  }
  // What the strip shows for each role: { value, label, own } (value: a palette id, 'none', 'auto', null for Default with
  // no type known, undefined for Mixed; own: Default is chosen and value is the type's own colour), or null to hide it.
  function paintShown() {
    const list = targets();
    const def = list.length ? null : tool.makes ? blockTypes.get(tool.makes) : null;
    const sameDef = (bs) => (new Set(bs.map((b) => b.type)).size === 1 ? defOf(bs[0]) : null);
    const out = {};
    // The Fill tool (nothing is picked while it is on): only its colour, which its swatch's menu sets.
    if (!list.length && tool.paints === 'fill') {
      for (const role of WB_ROLES) out[role.id] = role.id === 'fill' ? { value: nextFill(), label: 'Fill colour' } : null;
      out.weight = null;
      return out;
    }
    for (const role of WB_ROLES) {
      if (list.length) {
        const having = list.filter((b) => { const d = defOf(b); return d.paint && d.paint[role.id]; });
        out[role.id] = having.length ? { value: agreed(having, role.id), label: roleLabel(sameDef(having), role) } : null;
      } else if (!def || takesNext(def, role.id)) {
        const now = nextColour(def, role.id);
        out[role.id] = { value: now !== null ? now : def ? def.create()[role.id] : null, label: roleLabel(def, role), own: now === null && Boolean(def) };
      } else out[role.id] = null;
    }
    const lined = list.filter((b) => defOf(b).weight);
    if (list.length) out.weight = lined.length ? { value: agreed(lined, 'weight') } : null;
    else if (!def || takesNext(def, 'weight')) {
      // A freehand tool's width is its brush's own (the Marker draws wide until another width is picked for it), and the
      // Highlighter's its own.
      const brush = def ? brushKey(def.type, tool.usual && tool.usual.brush) : null;
      const now = nextWeightOf(brush);
      const usual = def ? (tool.makes === def.type && tool.usual && tool.usual.weight) || def.create().weight : null;
      out.weight = { value: now !== null ? now : usual, own: now === null && Boolean(def) };
    }
    else out.weight = null;
    return out;
  }
  // The icon of a kind of block (the tools' own icons; a stroke's is its brush's).
  const BLOCK_ICONS = { note: 'note-sticky', text: 'font', frame: 'crop-simple', table: 'table', image: 'image', timer: 'stopwatch', connector: 'arrows-turn-right', highlight: 'highlighter' };
  const blockIcon = (b) => (b.type === 'stroke' ? KIND_ICONS[b.brush] || 'pen' : b.type === 'line' ? (b.arrow ? 'arrow-right-long' : 'minus') : BLOCK_ICONS[b.type] || KIND_ICONS[b.type] || 'arrow-pointer');
  function updatePaint() {
    if (!paintButtons.size) return;
    const nothing = !sel.size;
    const plan = nothing ? wbStripPlan(tool, tool.makes ? blockTypes.get(tool.makes) : null, family) : null;
    // The Hand has no strip at all (it only moves around).
    if (tool.mode || (nothing && !plan)) { paintStrip.hidden = true; afterPaint(); return; }
    const selecting = tool.id === 'select';
    // Only locked blocks picked: nothing of theirs to change, and the strip is not about new blocks then either.
    const lockedOnly = sel.size > 0 && !targets().length;
    if (lockedOnly && !selecting) { paintStrip.hidden = true; return; }
    selectionBox.hidden = !selecting;
    if (selecting) {
      singleButton.setAttribute('aria-pressed', String(!many));
      manyButton.setAttribute('aria-pressed', String(many));
      const none = sel.size === 0;
      clearButton.setAttribute('aria-disabled', String(none));
      const words = none ? 'Clear selection (nothing is picked)' : 'Clear selection';
      clearButton.dataset.tip = words;
    }
    const shown = lockedOnly || (nothing && plan && !plan.colours) ? {} : paintShown();
    let any = false;
    for (const [key, p] of paintButtons) {
      const s = shown[key];
      p.button.hidden = !s;
      if (!s) continue;
      any = true;
      let words;
      if (key === 'weight') {
        words = s.value === undefined ? 'Mixed' : s.value === null ? 'Default' : s.own ? `Default (${wbWeightName(s.value)})` : wbWeightName(s.value);
        p.mark.dataset.state = s.value === undefined ? 'mixed' : s.value === null ? 'default' : 'width';
        p.mark.style.setProperty('--lw', `${Math.min(8, s.value || 2)}px`);
        words = `Line width: ${words}`;
      } else {
        const c = colourOf(s.value);
        p.mark.dataset.state = s.value === undefined ? 'mixed' : s.value === null ? 'default' : c ? 'colour' : s.value;
        if (c) p.mark.style.setProperty('--wb-sw', c); else p.mark.style.removeProperty('--wb-sw');
        words = `${s.label || p.label}: ${s.own ? `Default (${nameOf(s.value)})` : nameOf(s.value)}`;
      }
      p.button.setAttribute('aria-label', words);
      p.button.dataset.tip = words;
    }
    const kinds = showKinds();
    updateFonts();
    updateLine();
    updateTable();
    presentBox.hidden = !(plan && plan.present);
    if (!presentBox.hidden) {
      const none = !live().some((b) => b.type === 'frame');
      presentButton.setAttribute('aria-disabled', String(none));
      const words = none ? 'No frames to present' : 'Present the frames, from the first';
      presentButton.dataset.tip = words;
      presentButton.setAttribute('aria-label', words);
    }
    coloursBox.hidden = !any;
    stripDividers();
    paintStrip.hidden = !any && !kinds && selectionBox.hidden && fontsBox.hidden && tableBox.hidden && lineBox.hidden && presentBox.hidden;
    // The endcap: the tool's icon, or the kind of the one block picked (the Select arrow for several).
    const picked = targets();
    const one1 = picked.length === 1 ? picked[0] : null;
    if (one1) setEndcap(blockIcon(one1), `${defOf(one1).label} tools`);
    else if (picked.length) setEndcap('arrow-pointer', 'Select tools');
    else { const o = SWITCH.find((x) => x.id === (family || tool.id)); setEndcap(o ? o.icon : tool.icon, `${o ? o.label : tool.label} tools`); }
    afterPaint();
  }

  // Line style and arrowheads: of the picked connectors (each one whole save), or, with none picked, for new connectors.
  // The current choice is the marked row; with several connectors that differ, none is.
  const connectorsIn = (only) => targets(only).filter((b) => b.type === CONNECTOR);
  function lineGroups(list) {
    const usual = blockTypes.get(CONNECTOR).create();
    const group = (field, label, icon, choices) => {
      const now = list.length ? agreed(list, field) : nextLine[field] || usual[field];
      const pick = (v) => () => {
        for (const b of list) ctx.change(b.id, { [field]: v }, { save: 'now' });
        nextLine[field] = v;
      };
      const chosen = choices.find((c) => c.id === now);
      return { id: field, label, icon, hint: chosen ? chosen.label : 'Mixed', items: choices.map((c) => choiceRow(c.id, c.label, now, pick(c.id), { icon: c.icon })) };
    };
    return [group('style', 'Line style', 'stairs', WB_CONNECTOR_STYLES), group('head', 'Arrowheads', 'arrow-right-long', WB_CONNECTOR_HEADS)];
  }
  // The words' size and alignment: of the picked notes, text blocks and shapes (each one whole save, all of them one undo
  // step), or, with none picked, for new ones. Picked on blocks, it is remembered for the next block too, as a colour is.
  // The current choice is the marked row; with several blocks that differ, none is.
  const wordedIn = (only) => targets(only).filter((b) => defOf(b).markup);
  function textGroups(list) {
    const group = (field, label, choices) => {
      const now = list.length ? agreed(list, field) : nextText[field];
      const pick = (v) => () => {
        for (const b of list) ctx.change(b.id, { [field]: v }, { save: 'now' });
        nextText[field] = v;
      };
      const rows = choices.map((c) => choiceRow(c.id, c.label, now, pick(c.id), c.icon ? { icon: c.icon } : {}));
      if (!list.length) rows.unshift(choiceRow(null, 'Default', now, pick(null)));
      const chosen = choices.find((c) => c.id === now);
      return { id: `text-${field}`, label, hint: chosen ? chosen.label : list.length ? 'Mixed' : 'Default', rows };
    };
    // Align: Left, Centre, Right, then (for notes, shapes and tables) Top, Middle, Bottom under a divider.
    const align = group('align', 'Align', WB_ALIGNS);
    const tall = list.filter((b) => defOf(b).valign);
    if (tall.length) {
      const now = wbAgreedWords(tall, (b) => wbValignOf(b, defOf(b)));
      const pick = (v) => () => {
        for (const b of tall) ctx.change(b.id, { valign: v }, { save: 'now' });
      };
      align.rows.push({ separator: true }, ...WB_VALIGNS.map((c) => choiceRow(c.id, c.label, now, pick(c.id), { icon: c.icon })));
    }
    return [group('size', 'Text size', WB_SIZES), align];
  }
  // Layers: one write moves a block (its z put between its new neighbours, lib-a's wbBetween). Only when two neighbours'
  // z are too close to split is every block numbered again, once. Several picked blocks move together and keep their
  // order among themselves: to the front or back as a stack, a layer up or down each past the next block not picked.
  const boxOf = (b) => renderer.reachOf(b.id); // all it draws: a note's pointer too
  function overlaps(a, b) {
    const p = boxOf(a);
    const q = boxOf(b);
    return Boolean(p && q && p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1);
  }
  const LAYERS = [
    { id: 'front', label: 'Bring to front', icon: 'angles-up', hint: keyHint('Shift ]') },
    { id: 'forward', label: 'Forward one layer', icon: 'arrow-up', hint: keyHint(']') },
    { id: 'backward', label: 'Back one layer', icon: 'arrow-down', hint: keyHint('[') },
    { id: 'back', label: 'Send to back', icon: 'angles-down', hint: keyHint('Shift [') },
  ];
  const layerable = (ids) => ids.map((id) => board.get(id)).filter((b) => b && !drafts.has(b.id) && policy.canChange(b)).sort((a, b) => a.z - b.z);
  function canLayer(ids, to) {
    const list = layerable(ids);
    if (!list.length) return false;
    const mine = new Set(list.map((b) => b.id));
    const others = board.all().filter((b) => !mine.has(b.id));
    if (to === 'front') return others.some((o) => o.z >= list[0].z);
    if (to === 'back') return others.some((o) => o.z <= list[list.length - 1].z);
    const past = (a, b) => !mine.has(b.id) && overlaps(a, b);
    return list.some((b) => Boolean(wbBetween(board.all(), b.id, to, past)));
  }
  function layer(ids, to) {
    const locked = ids.filter((id) => { const b = board.get(id); return b && b.locked; }).length;
    if (locked && policy.canEdit) lockedNote(locked, ids.length);
    if (!canLayer(ids, to)) return;
    const list = layerable(ids);
    const mine = new Set(list.map((b) => b.id));
    if (to === 'front') { const top = Math.floor(board.topZ()); list.forEach((b, i) => ctx.change(b.id, { z: top + 1 + i })); return; }
    if (to === 'back') { const bottom = Math.ceil(board.bottomZ()); list.forEach((b, i) => ctx.change(b.id, { z: bottom - list.length + i })); return; }
    const past = (a, b) => !mine.has(b.id) && overlaps(a, b);
    // Up: the top one first, so each stays under the one above it; down: the bottom one first.
    for (const b of to === 'forward' ? list.reverse() : list) {
      let r = wbBetween(board.all(), b.id, to, past);
      if (r && r.renumber) {
        board.all().forEach((x, i) => { if (x.z !== i + 1 && !drafts.has(x.id) && policy.canChange(x)) commit({ ...x, z: i + 1 }, 'now'); });
        r = wbBetween(board.all(), b.id, to, past);
      }
      if (r && !r.renumber) ctx.change(b.id, { z: r.z });
    }
  }

  // ---- undo and redo ----------------------------------------------------------------------------------------------------
  // Only this person's own steps (lib-g), put back as new changes through commit and remove, so everyone sees them like any
  // edit. Only the fields the step changed are put back, and each only where the block still holds what this person left:
  // a field someone else has changed since keeps their change, and so does every field its block type links with it,
  // changed by the step or not (wbMergeBack); a block whose every such field someone else changed is left as it is. A
  // block someone else deleted since, which the step needs, is left out, and so is a connector whose block is gone. The
  // person is told once, of both when both happened (wbUndoNote). A block this person deleted comes back whole, with its
  // own id, before the connectors attached to it. The work is lib-g's (wbApplyChanges); this hands it the board.
  let undoButton = null;
  let redoButton = null;
  function historyButtons() {
    if (undoButton) undoButton.set({ disabled: !history.canUndo() });
    if (redoButton) redoButton.set({ disabled: !history.canRedo() });
  }
  function applyChanges(list) {
    // The board's settings (WB_BOARD_STEP, the background) go through the same work: as a block whose value is never
    // missing (no key: the usual), put back with commitBoard.
    const isBoard = (id) => id === WB_BOARD_STEP;
    const boardy = (b) => Boolean(b && b.type === 'board');
    const r = wbApplyChanges(list, {
      get: (id) => (isBoard(id) ? boardSettings : board.get(id)),
      remove: (id) => { if (!isBoard(id)) remove(id); },
      put: (b) => (boardy(b) ? commitBoard(b) : commit(b, 'now')),
      // A step that only locked or unlocked a block is undone on it while it is locked; nothing else is.
      canChange: (b, fields) => (boardy(b) ? policy.canEdit : fields && fields.length && fields.every((f) => f === 'locked') ? policy.canLock(b) : policy.canChange(b)),
      canRemove: (b) => boardy(b) || drafts.has(b.id) || policy.canDelete(b),
      locked: (b) => Boolean(b && b.locked === true),
      canCreate: () => policy.canCreate(),
      clean: (raw) => (boardy(raw) ? wbCleanBoard(raw) : wbClean(raw)),
      linkedOf: (b) => { const def = blockTypes.get(b.type); return (def && def.linked) || []; },
      pointsAt: (b) => { const def = blockTypes.get(b.type); return Boolean(def && def.refs); },
      missing: (b) => !boardy(b) && missingRefs(b).length > 0,
      isBoard,
    });
    select(r.touched.filter((id) => board.has(id)));
    return r;
  }
  // Undo or Redo pressed for the last time turns itself off, and the keyboard would fall to the page: it goes to the board
  // instead (the toolbar is drawn again a moment later, so it is looked for over a few frames).
  function keepKeyboard() {
    let frames = 0;
    const look = () => {
      const a = document.activeElement;
      if (!a || a === document.body) { surface.focus({ preventScroll: true }); return; }
      if (frames++ < 20) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  }
  function undoRedo(which) {
    if (!history || down !== null || presenting) return; // not in the middle of a drag or a stroke, nor while presenting
    if (editing) { const ed = editing; editing = null; ed.finish(true); }
    const r = which === 'undo' ? history.undo(applyChanges) : history.redo(applyChanges);
    const told = wbUndoNote(r);
    if (told) note(told);
    historyButtons();
  }

  if (policy.canEdit) {
    undoButton = host.ui.toolbarButton({ id: 'undo', label: withKey('Undo', `${MOD} Z`), icon: 'rotate-left', iconOnly: true, disabled: true, onClick: () => { undoRedo('undo'); if (!history.canUndo()) keepKeyboard(); } });
    redoButton = host.ui.toolbarButton({ id: 'redo', label: withKey('Redo', `${MOD} Shift Z`), icon: 'rotate-right', iconOnly: true, disabled: true, onClick: () => { undoRedo('redo'); if (!history.canRedo()) keepKeyboard(); } });
  }

  // Zoom is the window's, in the title bar: Zoom out and Zoom in as icons, and the magnifier's menu with the rest. Toolbar
  // buttons placed in the title bar (host.toolbar.set), so a click comes as the 'toolbar' event with where the button is.
  // Not while presenting: the view moves with the frames alone.
  const zoomIn = () => { if (presenting) return; renderer.zoomBy(1.25); updateStatus(); };
  const zoomOut = () => { if (presenting) return; renderer.zoomBy(0.8); updateStatus(); };
  const zoomMenu = (e) => !presenting && host.menu.show({
    id: 'zoom',
    ...toolbarAt(e),
    items: [
      { id: 'in', label: 'Zoom in', icon: 'magnifying-glass-plus', hint: keyHint('+'), onClick: zoomIn },
      { id: 'out', label: 'Zoom out', icon: 'magnifying-glass-minus', hint: keyHint('-'), onClick: zoomOut },
      { id: 'fit', label: 'Show everything', icon: 'expand', hint: keyHint('0'), onClick: () => { if (!presenting) { renderer.fit(); updateStatus(); } } },
      { id: 'actual', label: 'Actual size', icon: 'magnifying-glass', onClick: () => { if (!presenting) { renderer.reset(); updateStatus(); } } },
    ],
  });
  host.toolbar.set([
    { type: 'button', id: 'zoom-out', title: withKey('Zoom out', '-'), icon: 'magnifying-glass-minus', placement: 'titlebar' },
    { type: 'button', id: 'zoom-in', title: withKey('Zoom in', '+'), icon: 'magnifying-glass-plus', placement: 'titlebar' },
    { type: 'button', id: 'zoom', title: 'Zoom', icon: 'up-right-and-down-left-from-center', placement: 'titlebar' },
    { type: 'button', id: 'find', title: 'Find in the board', icon: 'magnifying-glass', placement: 'titlebar' },
  ]).catch(() => {});
  host.on('toolbar', (e) => {
    if (e.id === 'zoom-in') zoomIn();
    else if (e.id === 'zoom-out') zoomOut();
    else if (e.id === 'zoom') zoomMenu(e);
    else if (e.id === 'find') { if (finding) closeFind(); else openFind(); }
  });

  // Snap to grid: blocks made, moved and resized land on the board's dots (wbGrid.size); Alt (Option on a Mac) held during a
  // drag does the opposite for that drag. Lines snap at their ends; a pen drawing never does. Each person's own choice,
  // kept in this browser when it can be (off at first), never in the board's data.
  const SNAP_KEY = 'whiteboard-snap';
  let snapOn = false;
  try { snapOn = window.localStorage.getItem(SNAP_KEY) === '1'; } catch { /* no browser storage: off */ }
  const snapping = (event) => snapOn !== Boolean(event && event.altKey);
  // Grid: dots, graph paper or off, with its size, colour and opacity; each person's own, kept in this browser (wbGrid, lib-a),
  // for everyone who can see the board. The size is also Snap to grid's step. The panel is the small bar at the board's top right.
  const gridPop = $('grid-pop');
  const gridStore = () => window.localStorage;
  const gridSize = $('grid-size');
  const gridOpacity = $('grid-opacity');
  const gridSwatches = new Map();
  function gridShow() {
    showBackdrop();
    renderer.redrawGrid();
    if (gridPop.hidden) return;
    for (const b of gridPop.querySelectorAll('[data-style]')) b.setAttribute('aria-checked', String(b.dataset.style === wbGrid.style));
    gridSize.value = String(wbGrid.size);
    $('grid-size-val').textContent = String(wbGrid.size);
    for (const [id, b] of gridSwatches) b.setAttribute('aria-checked', String(id === wbGrid.color));
    const auto = wbGrid.opacity === null;
    gridOpacity.value = String(auto ? Math.round(wbBackdrop(boardSettings.background).strength / 5) * 5 : Math.round(wbGrid.opacity * 100));
    $('grid-opacity-val').textContent = auto ? 'Auto' : `${gridOpacity.value}%`;
  }
  function gridSet(change) {
    Object.assign(wbGrid, wbGridClean({ ...wbGrid, ...change }));
    wbGridSave(gridStore, wbGrid);
    gridShow();
  }
  for (const c of WB_GRID_COLOURS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `wb-grid-swatch${c.id === 'auto' ? ' wb-grid-auto' : ''}`;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', c.label);
    b.title = c.label;
    if (c.token) b.style.setProperty('--wb-sw', c.token);
    b.addEventListener('click', () => gridSet({ color: c.id }));
    gridSwatches.set(c.id, b);
    $('grid-colours').append(b);
  }
  for (const b of gridPop.querySelectorAll('[data-style]')) b.addEventListener('click', () => gridSet({ style: b.dataset.style }));
  gridSize.addEventListener('input', () => gridSet({ size: Number(gridSize.value) }));
  gridOpacity.addEventListener('input', () => gridSet({ opacity: Number(gridOpacity.value) / 100 }));
  $('grid-reset').addEventListener('click', () => gridSet({ ...WB_GRID_USUAL }));
  function openGrid() {
    if (presenting) return;
    closeFind({ quiet: true });
    gridPop.hidden = false;
    gridShow();
    (gridPop.querySelector('[data-style][aria-checked="true"]') || gridPop).focus({ preventScroll: true });
  }
  function closeGrid() {
    if (gridPop.hidden) return;
    gridPop.hidden = true;
    surface.focus({ preventScroll: true }); // the button is in the frame's toolbar, outside this page: the board gets the keyboard
  }
  gridPop.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeGrid(); }
  });
  for (const type of ['pointerdown', 'click', 'dblclick', 'contextmenu', 'wheel', 'copy', 'cut', 'paste', 'keyup']) gridPop.addEventListener(type, (e) => e.stopPropagation());
  // The module runs inside the page's shadow root, so a press there is seen at the document as aimed at the root's host: the
  // press is placed by its path (composedPath), not by e.target. The Grid button toggles the panel itself.
  document.addEventListener('pointerdown', (e) => {
    if (gridPop.hidden) return;
    const path = e.composedPath();
    if (path.includes(gridPop) || path.some((n) => n.dataset && n.dataset.key === 'btn:grid')) return;
    closeGrid();
  }, true);
  // The right zone's buttons are made in this order: Overview, Grid, Snap. The host draws the last one at the far right, so Snap
  // stays there whatever comes and goes on the left (Delete, Arrange); a view-only person has no Snap, so Grid is last. Overview
  // and Grid are for everyone who can see the board (they only change the view); Snap is for editors.
  const overviewStore = () => window.localStorage;
  let overviewOn = wbOverviewLoad(overviewStore);
  const overviewButton = host.ui.toolbarButton({ id: 'overview', label: 'Overview', icon: 'map', iconOnly: true, on: overviewOn, zone: 'end', onClick: () => toggleOverview() });
  host.ui.toolbarButton({ id: 'grid', label: 'Grid', icon: 'table-cells', iconOnly: true, zone: 'end', onClick: () => { if (gridPop.hidden) openGrid(); else closeGrid(); } });
  if (policy.canEdit) {
    const snapButton = host.ui.toolbarButton({
      id: 'snap', label: 'Snap to grid', icon: 'border-all', iconOnly: true, on: snapOn, zone: 'end',
      onClick: () => {
        snapOn = !snapOn;
        snapButton.set({ on: snapOn });
        try { window.localStorage.setItem(SNAP_KEY, snapOn ? '1' : '0'); } catch { /* kept for this visit only */ }
      },
    });
  }

  // ---- copy, cut, paste and duplicate -----------------------------------------------------------------------------------
  // Only for someone who may change the board. The copies are new blocks: new ids, saved as this person's, on top of
  // everything (in the order the originals were), a step along each time (lib-h), and picked once they are there. Each is
  // saved whole, like any new block; a copy the server refuses (the module's storage is full) is taken off again and the
  // person told once (onRefused).
  const clipboard = createClipboard();
  let clipMarked = false; // the last copy here put the mark on the computer's clipboard (CLIP_MARK, below)
  // A connector that is not drawn (its block is gone) is never copied. A frame takes the blocks inside it (locked ones
  // too: a copy is never locked; a cut leaves them, see copy).
  const copyable = () => {
    const picked = [...sel].map((id) => board.get(id)).filter((b) => b && !drafts.has(b.id));
    const along = wbFrameFollow(picked.map((b) => ({ id: b.id, dx: 0, dy: 0 })), live(), { measure: heightOf, keepLocked: true });
    return [...picked, ...along.moves.map((m) => board.get(m.id))].filter((b) => b && !missingRefs(b).length);
  };
  // What a copy holds: the picked blocks and every connector whose blocks are all among them (picked or not); a picked
  // connector with an end on a block left out has that end made a free point where it is drawn now (its type's loosen).
  function copySet(picked = copyable()) {
    const list = picked.slice();
    const ids = new Set(list.map((b) => b.id));
    for (const b of board.all()) {
      const d = defOf(b);
      const refs = d.refs ? d.refs(b) : [];
      if (!ids.has(b.id) && !drafts.has(b.id) && refs.length && refs.every((id) => ids.has(id))) { list.push(b); ids.add(b.id); }
    }
    return list.map((b) => {
      const d = defOf(b);
      if (!d.loosen || d.refs(b).every((id) => ids.has(id))) return b;
      const g = renderer.geometry(b.id); // its points run from its `from` end to its `to` end
      return { ...b, ...d.loosen(b, ids, (which) => (g ? (which === 'from' ? g.points[0] : g.points[g.points.length - 1]) : null)) };
    });
  }
  // The box round some blocks, in board units (a block whose height follows its words counts as tall as it is drawn, else
  // one line high).
  function boundsOf(blocks) {
    const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const b of blocks) {
      const def = blockTypes.get(b.type);
      if (def.attached && def.refs(b).length === 2) continue; // where it runs follows its blocks
      const box = def.reach ? def.reach(b) : def.box(b); // all it draws: a note's pointer too
      const x = (b.x || 0) + box.x; const y = (b.y || 0) + box.y;
      const el = box.h === null ? renderer.element(b.id) : null; // the original's, when it is still on the board
      r.x0 = Math.min(r.x0, x); r.y0 = Math.min(r.y0, y); r.x1 = Math.max(r.x1, x + box.w); r.y1 = Math.max(r.y1, y + (box.h === null ? (el ? el.offsetHeight : 32) : box.h));
    }
    if (!Number.isFinite(r.x0)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
    return r;
  }
  // Cut is a copy and a delete: the connectors attached to what is cut go too (the ones between them are in the copy).
  // A locked block is copied, never cut: a cut takes the others and leaves it (the person is told).
  function copy({ cut = false } = {}) {
    if (!policy.canEdit || !copyable().length) return;
    const picked = cut ? copyable().filter((b) => policy.canDelete(b)) : copyable();
    if (cut) lockedNote(copyable().length - picked.length, copyable().length);
    if (!picked.length) return;
    const list = copySet(picked);
    clipboard.copy(list, { cut });
    clipMarked = false; // onCopyEvent sets it again when this copy put the mark on the computer's clipboard
    if (cut) removeMany(list.map((b) => b.id));
    setAdd();
  }
  function placeCopies(copies) {
    if (!policy.canCreate() || !copies.length || presenting) return;
    let top = Math.floor(board.topZ());
    const made = [];
    // On top of everything, in their order; a frame's copy under the blocks (over the frames there), as a new frame goes.
    copies.forEach((c) => { const b = wbClean({ ...c, z: wbIsFrame(c) ? wbFrameZ(board.all()) : (top += 1) }); if (b) { commit(b, 'now'); made.push(b.id); } });
    select(made);
  }
  // Paste: a step along from the last paste, or, given a point on the board, round it.
  function paste(at = null) {
    if (!policy.canCreate() || !clipboard.has()) return;
    placeCopies(clipboard.take({ newId: () => host.util.id(), at, bounds: boundsOf }));
  }
  // Duplicate: copies of what is picked, a step along, without touching what was copied.
  function duplicate() {
    if (!policy.canCreate()) return;
    if (!copyable().length) return;
    placeCopies(wbCopies(copySet(), { newId: () => host.util.id(), dx: WB_PASTE_STEP, dy: WB_PASTE_STEP }));
  }
  const clipRows = (at, { cut = true } = {}) => [
    { id: 'cut', label: 'Cut', icon: 'scissors', hint: keyHint(`${MOD} X`), disabled: !cut, onClick: () => copy({ cut: true }) },
    { id: 'copy', label: 'Copy', icon: 'copy', hint: keyHint(`${MOD} C`), onClick: () => copy() },
    { id: 'paste', label: 'Paste', icon: 'paste', hint: keyHint(`${MOD} V`), disabled: !clipboard.has(), onClick: () => paste(at) },
    { id: 'duplicate', label: 'Duplicate', icon: 'clone', hint: keyHint(`${MOD} D`), onClick: () => duplicate() },
  ];

  // ---- timers -------------------------------------------------------------------------------------------------------------
  // The board's one timer is a clock over the board (lib-e-block-timer.js), on every page. What its buttons do: Start, Pause,
  // Reset and the view are one write and one undo step each, and anyone who may change the board may use them. Clicking
  // the time opens the length menu, which sets a new length (the timer stops and waits at it); Custom asks for minutes and
  // seconds, and Mute keeps this person's timer quiet in this browser. Where the clock sits and whether it is shown are this
  // person's own, kept in this browser. The toolbar's Timer, the Y key and the + add the timer (one only) or show or hide
  // the clock; "Remove timer" in its right-click menu takes it away for everyone. A
  // timer reaching zero while the page watches is said once and, unless muted, plays one short soft tone (only once the
  // person has pressed or typed on the page: browsers play no sound before that; where it cannot play it is skipped).
  const timerDef = blockTypes.get('timer');
  const MUTE_KEY = 'whiteboard-timer-mute';
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* no storage: not muted */ }
  timerDef.layer = surface;
  timerDef.now = () => sync.now();
  // A locked timer still runs: its controls are using it, not changing it (lib-b, canLock).
  timerDef.controls = (b) => policy.canLock(b);
  const TIMER_POS = 'whiteboard-timer-pos';
  const TIMER_HIDE = `whiteboard-timer-hidden:${WB_BOARD}`;
  let timerHidden = false;
  try { timerHidden = localStorage.getItem(TIMER_HIDE) === '1'; } catch { /* no storage: shown */ }
  timerDef.hidden = () => timerHidden;
  timerDef.canHide = () => policy.canEdit; // the toolbar's Timer brings it back, for those who have it
  timerDef.store = () => ({
    get() { try { const p = JSON.parse(localStorage.getItem(TIMER_POS)); return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null; } catch { return null; } },
    set(p) { try { localStorage.setItem(TIMER_POS, JSON.stringify({ x: p.x, y: p.y })); } catch { /* not kept */ } },
  });
  function showTimer(on) {
    timerHidden = !on;
    try { if (on) localStorage.removeItem(TIMER_HIDE); else localStorage.setItem(TIMER_HIDE, '1'); } catch { /* not kept */ }
    // Shown again: a place that no longer fits is put back inside (the clock does it as it shows).
    timerDef.redraw();
    timerButton.set({ on });
  }
  timerDef.hide = () => { showTimer(false); surface.focus({ preventScroll: true }); };
  timerDef.leave = () => surface.focus({ preventScroll: true });
  // The Timer (toolbar, Y): no timer yet makes one (one undo step) and shows the card; one shown is hidden for this person
  // only; one hidden is shown. The + only adds or shows.
  function toggleTimer(only) {
    if (!policy.canEdit) return;
    if (!timerDef.current()) {
      const b = ctx.draft('timer', { x: 0, y: 0 });
      ctx.save(b.id);
      showTimer(true);
      return;
    }
    showTimer(only ? true : timerHidden);
    if (!timerHidden && timerDef.clock()) timerDef.clock().focus({ preventScroll: true });
  }
  const timerButton = policy.canEdit
    ? host.ui.toolbarButton({ id: 'tool-timer', label: withKey('Timer', 'Y'), icon: 'stopwatch', iconOnly: true, on: false, onClick: () => toggleTimer(false) })
    : { set() {} };
  timerButton.set({ on: Boolean(timerDef.current()) && !timerHidden });
  timerDef.changed = () => timerButton.set({ on: Boolean(timerDef.current()) && !timerHidden });
  timerDef.menu = (e) => {
    if (!policy.canEdit || !timerDef.current()) return;
    const box = host.rootElement.getBoundingClientRect();
    host.menu.show({ id: 'timer-card', at: { x: e.clientX - box.left, y: e.clientY - box.top }, items: [{ id: 'remove', label: 'Remove timer', icon: 'trash-can', onClick: () => removeTimer() }] });
  };
  async function removeTimer() {
    const b = timerDef.current();
    if (!b || !policy.canEdit) return;
    let yes = false;
    try { yes = await host.ui.confirm({ title: 'Remove timer', message: 'This will remove the timer for everyone. Are you sure?', action: 'Remove timer', cancel: 'Cancel' }); } catch { return; }
    if (!yes) return;
    // Every timer block goes (an old board may have several), so none is left to take its place.
    for (const t of board.ofType('timer')) remove(t.id, { force: true });
    surface.focus({ preventScroll: true });
  }
  const useTimer = (id, fields) => {
    const b = board.get(id);
    const next = b && b.type === 'timer' && policy.canLock(b) ? wbClean({ ...b, ...fields }) : null;
    if (next) commit(next, 'now');
  };
  timerDef.icon = (name) => iconSvg(name);
  timerDef.say = (text) => say(text);
  timerDef.done = () => { say('Time is up.'); if (!muted) chime(); };
  timerDef.act = (id, what, button) => {
    const b = board.get(id);
    if (!b || b.type !== 'timer' || !policy.canLock(b)) return;
    const now = sync.now();
    if (what === 'start') useTimer(id, wbTimerStart(b, now));
    else if (what === 'pause') useTimer(id, wbTimerPause(b, now));
    else if (what === 'reset') useTimer(id, wbTimerReset(b));
    else if (what === 'view') useTimer(id, { view: b.view === 'horizontal' ? 'radial' : 'horizontal' });
    else if (what === 'length') timerMenu(id, button);
  };
  // Words read out once (started, paused, time is up), never the seconds ticking.
  let sayTimer = 0;
  function say(text) {
    const el = $('say');
    clearTimeout(sayTimer);
    el.textContent = '';
    sayTimer = setTimeout(() => { el.textContent = text; }, 50); // emptied first, so the same words are read again
  }
  function timerMenu(id, button) {
    const b = board.get(id);
    if (!b) return;
    const set = (secs) => () => useTimer(id, wbTimerSetLength(secs));
    host.menu.show({
      id: 'timer',
      anchor: button,
      items: [
        { heading: 'Length' },
        ...WB_TIMER_LENGTHS.map((secs) => choiceRow(secs, wbTimerShort(secs), b.length, set(secs))),
        { id: 'custom', label: 'Custom…', icon: 'stopwatch', current: !WB_TIMER_LENGTHS.includes(b.length), hint: WB_TIMER_LENGTHS.includes(b.length) ? '' : wbTimerShort(b.length), onClick: () => { setTimeout(() => customLength(id, button), 0); } },
        { separator: true },
        { id: 'mute', label: 'Mute the sound', icon: muted ? 'volume-xmark' : 'volume-high', current: muted, ariaLabel: muted ? 'Mute the sound, on' : 'Mute the sound, off', tip: 'Only for you, in this browser', onClick: () => { muted = !muted; try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* kept until the page goes */ } } },
      ],
    });
  }
  // Custom: minutes and seconds, in the editor window.
  let customFor = null; // { id, button }
  const customEditor = policy.canEdit ? host.ui.editor($('editor'), { onClose: () => { customFor = null; $('custom-error').hidden = true; } }) : null;
  function customLength(id, button) {
    const b = board.get(id);
    if (!b || !customEditor) return;
    customFor = { id, button };
    $('custom-min').value = String(Math.floor(b.length / 60));
    $('custom-sec').value = String(b.length % 60);
    $('custom-error').hidden = true;
    customEditor.open({ focus: $('custom-min'), returnTo: () => (button && button.isConnected ? button : surface) });
  }
  function saveCustom() {
    const m = Number($('custom-min').value || 0);
    const sec = Number($('custom-sec').value || 0);
    const total = Math.round(m) * 60 + Math.round(sec);
    const err = $('custom-error');
    if (!Number.isFinite(total) || m < 0 || sec < 0 || sec > 59 || total < 1 || total > WB_TIMER_MAX) {
      err.textContent = 'Give a length from 1 second to 23:59:59, with seconds from 0 to 59.';
      err.hidden = false;
      return;
    }
    const f = customFor;
    const b = f && board.get(f.id);
    if (b) useTimer(b.id, wbTimerSetLength(total));
    customEditor.close();
  }
  if (customEditor) {
    $('custom-form').addEventListener('submit', (e) => { e.preventDefault(); saveCustom(); });
    $('custom-cancel').addEventListener('click', () => customEditor.cancel());
  }
  // One short soft tone (two gentle notes), after the person has pressed or typed on the page.
  let gestured = false;
  let audio = null;
  for (const type of ['pointerdown', 'keydown']) host.rootElement.addEventListener(type, () => { gestured = true; }, { capture: true, passive: true });
  function chime() {
    if (!gestured) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audio) audio = new Ctx();
      if (audio.state === 'suspended') audio.resume().catch(() => {});
      const t = audio.currentTime + 0.02;
      [[660, 0], [880, 0.22]].forEach(([hz, at]) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = 'sine';
        osc.frequency.value = hz;
        gain.gain.setValueAtTime(0.0001, t + at);
        gain.gain.exponentialRampToValueAtTime(0.08, t + at + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.5);
        osc.connect(gain).connect(audio.destination);
        osc.start(t + at);
        osc.stop(t + at + 0.55);
      });
    } catch { /* no sound here: the face still says it */ }
  }

  // ---- pictures from the computer ---------------------------------------------------------------------------------------
  // Pasted, dropped on the board, or chosen with "Add a picture" in the +: each is made ready and sent one at a time (lib-i)
  // with a placeholder where it will be, and becomes an image block once its upload is there, saved once. The pictures
  // added at once (one drop, one paste, one choice) are one undo step together.
  // Only for someone who may change the board; everyone who may see the board sees the pictures (the uploads are the
  // space's, read with the module's view permission). Deleting a picture block leaves its upload (see lib-i).
  blockTypes.get('image').source = (upload, thumb) => host.uploads.url(upload, { thumb, scope: 'space' });
  const PICTURE_STEPS = { waiting: 'Waiting', reading: 'Getting it ready', sending: 'Sending' };
  const sentence = (text) => { const t = String(text || '').trim(); return t ? `${t[0].toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? '' : '.'}` : ''; };
  const pictures = policy.canAddPicture() ? createPictures({
    host,
    newId: () => host.util.id(),
    onStart(job) { renderer.pending(job.id, job.box, PICTURE_STEPS[job.step]); updateStatus(); },
    onStep(job) { renderer.pending(job.id, job.box, PICTURE_STEPS[job.step]); },
    inUse: (u) => board.all().some((b) => b.upload === u),
    // false: no block for it (no longer allowed, or not a picture block after all), so lib-i removes the upload again.
    onPlaced(job, file) {
      renderer.pending(job.id, null);
      updateStatus();
      if (!policy.canCreate()) return false;
      const def = blockTypes.get('image');
      const b = wbClean({ ...def.create(), id: job.id, type: 'image', x: job.box.x, y: job.box.y, w: job.box.w, h: job.box.h, upload: file.id, z: Math.floor(board.topZ()) + 1 });
      if (!b) return false;
      // Saved once, the upload there already. The pictures added together are one step of the undo history, however long
      // apart their uploads finish.
      const batch = job.batch;
      if (history && batch) history.tag(batch.tag, { join: true });
      commit(b, 'now');
      // Picked, with the others added along with it, unless the person has picked something else meanwhile.
      if (batch) {
        const same = sel.size === batch.picked.length && batch.picked.every((id) => sel.has(id));
        batch.made.push(b.id);
        if (same) select(batch.made.slice());
        batch.picked = [...sel];
      }
      return true;
    },
    onFailed(job, err) {
      renderer.pending(job.id, null);
      note(err && err.status === 403 ? 'You may not add pictures to this whiteboard.' : `The picture was not added. ${sentence(err && err.message)}`.trim());
      updateStatus();
    },
    onBusy() { note('Adding a lot of pictures at once. The rest follow in a few seconds.'); },
  }) : null;
  // Add picture files with the middle of them at `at` (a point on the board), or in the middle of what is in sight.
  function addPictures(files, at = null) {
    if (!pictures) return;
    const { pictures: list, others } = wbSplitPictures(files);
    if (others) note('Only pictures can go on the board.');
    if (!list.length) return;
    // The pictures added together share a batch, so they are picked together as they arrive.
    pictures.add(list, at || renderer.center(), { batch: { tag: `pictures:${host.util.id()}`, made: [], picked: [...sel] } });
  }
  // The computer's own file chooser, for "Add a picture" (touch and the keyboard too).
  $('picker').accept = WB_PICTURE_ACCEPT;
  $('picker').addEventListener('change', () => {
    const files = [...$('picker').files];
    $('picker').value = '';
    if (files.length) addPictures(files);
  });

  // The +: the same blocks, put in the middle of what is in sight (for the keyboard, and for anyone who looks for it there),
  // and a picture from the computer. Paste is there too, greyed until something is copied.
  // The flowchart shapes are a category of their own, with "Connect the 2 picked blocks" (on while two blocks that can take
  // a connector are picked).
  function setAdd() {
    if (!policy.canEdit || !host.add) return;
    addCanConnect = Boolean(pair());
    const shape = (id) => { const t = tools.get(id); return t ? [{ id, label: t.label, icon: t.icon, hint: t.key ? keyHint(t.key.toUpperCase()) : undefined }] : []; };
    host.add.set([
      { id: 'note', label: 'Add a note', icon: 'note-sticky' },
      { id: 'text', label: 'Add text', icon: 'font' },
      { id: 'rect', label: 'Add a rectangle', icon: 'square' },
      { id: 'timer', label: 'Add a timer', icon: 'stopwatch', hint: keyHint('Y') },
      ...(tools.get('table') ? [{ id: 'table', label: 'Add a table', icon: 'table', hint: keyHint('G') }] : []),
      ...(tools.get('frame') ? [{ id: 'frame', label: 'Add a frame', icon: 'crop-simple', hint: keyHint('S') }] : []),
      {
        label: 'Add a flowchart shape',
        icon: 'diagram-project',
        items: [
          ...['rounded', 'diamond', 'pill', 'parallelogram'].flatMap(shape),
          { id: 'connect', label: 'Connect the 2 picked blocks', icon: 'arrows-turn-right', disabled: !addCanConnect },
        ],
      },
      ...(pictures ? [{ id: 'picture', label: 'Add a picture', icon: 'image' }] : []),
      { divider: true },
      { id: 'paste', label: 'Paste', icon: 'paste', hint: keyHint(`${MOD} V`), disabled: !clipboard.has() },
    ]).catch(() => {});
  }
  if (policy.canEdit && host.add) {
    setAdd();
    host.on('add', ({ id }) => {
      if (presenting) return;
      if (id === 'paste') { paste(); return; }
      if (id === 'picture') { if (pictures) $('picker').click(); return; }
      if (id === 'connect') { connectPicked(); return; }
      if (id === 'timer') { toggleTimer(true); return; }
      const def = blockTypes.get(id);
      if (!def || def.attached) return;
      const c = renderer.center();
      const box = def.box({ ...def.create(), x: 0, y: 0 });
      const at = { x: c.x - box.w / 2, y: c.y - (box.h || 24) / 2 };
      const b = ctx.draft(id, snapping(null) ? { x: wbSnap(at.x), y: wbSnap(at.y) } : at);
      select(b.id);
      if (def.edit !== 'text' && def.edit !== 'cells') { ctx.save(b.id); renderer.element(b.id).focus({ preventScroll: true }); return; }
      // After the host's menu has closed and handed the focus back to the +, or that would end the editing at once.
      setTimeout(() => { if (board.has(b.id)) edit(b.id, { fresh: true }); }, 60);
    });
  }

  let statusFrame = 0;
  function updateStatus() {
    if (statusFrame) return;
    statusFrame = requestAnimationFrame(() => {
      statusFrame = 0;
      const n = Math.max(0, board.size - [...drafts].filter((id) => board.has(id) && blockTypes.get(board.get(id).type) && !blockTypes.get(board.get(id).type).floating).length);
      const items = [{ text: n === 1 ? '1 block' : `${n} blocks`, icon: 'shapes' }];
      if (sel.size > 1) {
        // What is picked is one group: said so (a group looks like any blocks picked together).
        const groups = new Set([...sel].map((id) => wbGroupOf(board.get(id))));
        const grouped = groups.size === 1 && !groups.has(null);
        items.push({ text: grouped ? `${sel.size} selected, grouped` : `${sel.size} selected` });
      }
      const coming = pictures ? pictures.count : 0;
      if (coming) items.push({ text: coming === 1 ? 'Adding a picture' : `Adding ${coming} pictures`, icon: 'image' });
      if (exporting) items.push({ text: `${exporting}…`, icon: 'file-image' });
      if (presenting) items.push({ text: `Presenting ${presenting.i + 1} of ${presenting.order.length}`, icon: 'play' });
      if (!policy.canEdit) items.push({ text: 'View only', title: 'You can look and move around, not change the board' });
      items.push({ text: `${Math.round(renderer.view.s * 100)}%`, quiet: true, end: true, title: 'Zoom' });
      if (host.status) host.status.set(items).catch(() => {});
      updateHint();
      updatePaint();
      overviewRefresh();
      if (finding) findSoon(); // the matches, as the board now is
    });
  }
  function updateHint() {
    const hint = $('hint');
    hint.hidden = board.size > 0 || Boolean(pictures && pictures.count);
    if (hint.hidden) return;
    hint.textContent = !policy.canEdit ? 'Nothing on the board yet.'
      : tool.id === 'select' || tool.id === 'hand' ? `Pick a tool above, then click the board.${pictures ? ' Or paste or drop a picture here.' : ''}`
        : tool.makes === 'stroke' ? 'Press and drag to draw.'
          : tool.makes === 'highlight' ? `Press and drag over what to highlight.${KEYS ? ' Hold Shift for a straight band.' : ''}`
          : tool.id === 'fill' ? KEYS ? `Click a block to fill it. ${ALT}-click one to take its colour.` : 'Tap a block to fill it.'
          : tool.id === 'table' ? `${KEYS ? 'Click' : 'Tap'} the board to put a table there, or drag to give it a size.`
          : tool.id === 'frame' ? `Drag on the board to draw a frame, or ${KEYS ? 'click' : 'tap'} for one.`
            : tool.id === 'connector' ? 'Press on a block and drag to another to join them.' : 'Click the board to put it there.';
  }

  // ---- save as image, and print ---------------------------------------------------------------------------------------
  // For everyone who can see the board (it only reads it): "Save as image" in the title bar's menu and the right-click
  // menus asks what to save (everything, what is selected, what is in sight), on what background and at what size, and
  // saves a PNG to the computer (lib-l). Print is the host's standard Print in the title bar's menu: the whole board,
  // fitted to the paper, in the light colours.
  // Not here yet (the host has no way for it): saving the picture to the Vault, and Print from a key or a button of the
  // board's own (only the title bar's menu starts the host's Print, so Ctrl or Cmd P stays the browser's).
  const exporter = createExporter({
    root,
    world: $('world'),
    async picture(upload, thumb) {
      const address = await host.uploads.url(upload, { thumb, scope: 'space' });
      const res = await fetch(address, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.blob();
    },
  });
  let exporting = ''; // what the status line says while a picture is made
  // What is in sight, on the board.
  const viewBox = () => {
    const v = renderer.view;
    return { x0: -v.x / v.s, y0: -v.y / v.s, x1: (surface.clientWidth - v.x) / v.s, y1: (surface.clientHeight - v.y) / v.s };
  };
  // The blocks a kind of export takes (bottom to top) and the part of the board it shows.
  function exportPlan(kind) {
    const list = board.all().filter((b) => !drafts.has(b.id)).map((b) => {
      const d = defOf(b);
      return { id: b.id, rect: renderer.reachOf(b.id), refs: d.refs ? d.refs(b) : [] };
    });
    const rectOf = new Map(list.map((x) => [x.id, x.rect]));
    // A frame's picture: the frame's own box, with all of the board in it.
    const fr = kind === 'frame' ? pickedFrame() : null;
    if (kind === 'frame' && !fr) return { ids: [], extent: null, items: [] };
    const view = fr ? wbRect(fr) : viewBox();
    const ids = wbExportPick(kind, list, { picked: sel, view });
    const extent = ids.length ? wbExportExtent(kind, ids.map((id) => rectOf.get(id)), { view }) : null;
    return { ids, extent, items: ids.map((id) => ({ block: board.get(id), el: renderer.element(id) })) };
  }
  // Hands the person the file. The SDK has no call that hands over a file a module made (host.library.download saves a
  // Vault file only): the SDK's once it has one (host.files.save), else a download link in the page, which works for a
  // module running in the page (every bundled module does). In a sandboxed frame a download is blocked without a word,
  // so there it says it cannot.
  async function deliver(blob, name) {
    if (host.files && typeof host.files.save === 'function') return host.files.save(blob, { name });
    if (typeof ShadowRoot === 'undefined' || !(root instanceof ShadowRoot)) throw new Error('Saving a file to the computer is not possible here.');
    const address = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = address;
    a.download = name;
    a.rel = 'noopener';
    a.hidden = true;
    $('app').append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(address), 60000);
    return true;
  }
  const EXPORT_EMPTY = { all: 'There is nothing on the board to save.', selection: 'Select what to save first.', view: 'There is nothing in sight to save.', frame: 'Pick a frame first.' };
  // The one picked frame, or null.
  const pickedFrame = () => { const b = one() && board.get(one()); return b && wbIsFrame(b) ? b : null; };
  async function saveImage({ kind, background, scale }) {
    const plan = exportPlan(kind);
    if (!plan.ids.length) throw new Error(EXPORT_EMPTY[kind] || EXPORT_EMPTY.all);
    const size = wbExportSize(plan.extent, scale);
    const fill = background === 'page' ? getComputedStyle(surface).backgroundColor : '';
    exporting = 'Making the picture';
    updateStatus();
    try {
      const blob = await exporter.png(plan.items, plan.extent, size, { background: fill, step: (words) => { exporting = words; updateStatus(); } });
      const name = wbExportName(info.module.name, new Date(), 'png');
      await deliver(blob, name);
      return { name, size };
    } finally {
      exporting = '';
      updateStatus();
    }
  }

  // The Save as image window.
  const exportEditor = host.ui.editor($('export'), { onClose: () => { $('export-error').hidden = true; } });
  let exportBusy = false;
  const exportChoice = () => ({ kind: $('export-what').value, background: $('export-bg').value, scale: Number($('export-scale').value) || 1 });
  // The picture's size, said under the choices; and whether it had to be made smaller.
  function exportSizeNote() {
    const { kind, scale } = exportChoice();
    const plan = exportPlan(kind);
    const out = $('export-size');
    if (!plan.ids.length) { out.textContent = EXPORT_EMPTY[kind] || ''; $('export-save').disabled = true; return; }
    $('export-save').disabled = exportBusy;
    const size = wbExportSize(plan.extent, scale);
    out.textContent = `${wbExportPixels(size)}.${size.clamped ? ' Made smaller to fit: the board is too big for this size.' : ''}`;
  }
  function openExport(kind = null) {
    const what = $('export-what');
    // With one frame picked, "This frame" too: the frame's own box (Save frame as image).
    const kinds = [...WB_EXPORT_KINDS, ...(pickedFrame() ? [{ id: 'frame', label: 'This frame' }] : [])];
    what.replaceChildren(...kinds.map((k) => {
      const o = document.createElement('option');
      o.value = k.id;
      o.textContent = k.label;
      if (k.id === 'selection' && !sel.size) o.disabled = true;
      return o;
    }));
    what.value = kind && kinds.some((k) => k.id === kind) && (kind !== 'selection' || sel.size) ? kind : sel.size > 1 ? 'selection' : 'all';
    $('export-error').hidden = true;
    exportSizeNote();
    exportEditor.open({ focus: what, returnTo: () => surface });
  }
  for (const id of ['export-what', 'export-bg', 'export-scale']) $(id).addEventListener('change', exportSizeNote);
  $('export-cancel').addEventListener('click', () => exportEditor.cancel());
  $('export-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (exportBusy) return;
    exportBusy = true;
    const save = $('export-save');
    save.disabled = true;
    save.textContent = 'Saving…';
    $('export-error').hidden = true;
    try {
      const { name, size } = await saveImage(exportChoice());
      exportEditor.close();
      note(`Saving ${name} to your computer.${size.clamped ? ` It was made smaller to fit: ${wbExportPixels(size)}.` : ''}`);
    } catch (err) {
      $('export-error').textContent = sentence(err && err.message) || 'The picture could not be made.';
      $('export-error').hidden = false;
    } finally {
      exportBusy = false;
      save.textContent = 'Save';
      save.disabled = false;
    }
  });
  const exportRow = (kind = null) => ({ id: 'export', label: 'Save as image…', icon: 'file-image', onClick: () => { setTimeout(() => openExport(kind), 0); } });
  // The title bar's menu: set again when the pointers entry changes.
  function setHeader() {
    if (!host.header) return;
    host.header.set([
      ...(policy.canEdit ? [{ id: 'background', icon: 'palette', title: 'Background colour…', overflow: true }] : []),
      { id: 'export', icon: 'file-image', title: 'Save as image…', overflow: true },
      { id: 'present', icon: 'play', title: 'Present', overflow: true },
      { id: 'pointers', icon: 'arrow-pointer', title: pointersOn ? 'Hide other people\'s pointers' : 'Show other people\'s pointers', on: pointersOn, overflow: true },
    ]).catch(() => {});
  }
  if (host.header) {
    host.on('header', (e) => {
      if (e && e.id === 'export') openExport();
      if (e && e.id === 'background' && !presenting) backgroundMenu(toolbarAt(null)); // under the title bar, at its right end
      if (e && e.id === 'present') { if (presenting) stopPresenting(); else startPresenting(); }
      if (e && e.id === 'pointers') togglePointers();
    });
  }

  // Print: the whole board in an SVG the width of the paper (whiteboard.css, .wb-print), put back once the host has printed.
  function endPrint() { $('app').classList.remove('wb-printing'); $('print').replaceChildren(); }
  async function preparePrint() {
    const plan = exportPlan('all');
    if (!plan.ids.length) { note('There is nothing on the board to print.'); return false; }
    // On the board's background when one is picked (Default: the paper, as before).
    const d = wbBackdrop(boardSettings.background);
    const { svg } = await exporter.scene(plan.items, plan.extent, { live: true, background: d.id === 'default' ? '' : d.family === 'themed' ? d.ground : getComputedStyle(surface).backgroundColor });
    svg.setAttribute('class', 'wb-print-svg');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    $('print').replaceChildren(svg);
    $('app').classList.add('wb-printing');
    return true;
  }
  if (host.standard) {
    host.standard.set({ print: { run: preparePrint } }).catch(() => {});
    host.on('printed', endPrint);
  }

  // ---- presenting ---------------------------------------------------------------------------------------------------------
  // Present (the title bar's menu, the board's right-click menu, or a frame's: from that frame) shows the frames one at a
  // time, each fitted in the view, in reading order (lib-e-block-frame, wbFrameOrder: top to bottom in rows, left to right
  // in a row). Each person presents on their own: it reads the board and changes nothing, so someone who may only look can
  // present too. A small bar at the bottom of the board has Back, "2 of 5", Next and Exit; the keys: the right and down
  // arrows, Page Down and Space go on, the left and up arrows and Page Up go back, Home and End go to the first and the
  // last, Escape stops. Each frame is said ("Frame 2 of 5: Plan"). Meanwhile the board can't be changed (a press, a key, a
  // paste, the + do nothing; a timer's own buttons still work) and the view moves only with the frames: the wheel, a pinch,
  // a drag and the zoom buttons are ignored rather than ending it, so a slip of the hand does not lose the place. The view
  // glides to each frame (or jumps, for someone who asks for less motion). Exit puts back the view there was. Frames added,
  // moved or deleted meanwhile by others: the frame shown stays while it is there, else the one now in its place; with
  // none left it stops. ("Everyone follows me" waits for the live channel.)
  const reduceMotion = () => Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let glide = 0;
  // Move the view to `to` ({ x, y, s }): the middle of the screen and the zoom glide together (the zoom evenly).
  function showView(to, onStep, instant = false) {
    cancelAnimationFrame(glide);
    glide = 0;
    const from = { x: renderer.view.x, y: renderer.view.y, s: renderer.view.s };
    const W = surface.clientWidth / 2;
    const H = surface.clientHeight / 2;
    if (instant || reduceMotion() || !(from.s > 0)) { renderer.setView(to); if (onStep) onStep(1); updateStatus(); return; }
    const mid = (v) => ({ x: (W - v.x) / v.s, y: (H - v.y) / v.s }); // the board point in the middle of the screen
    const a = mid(from);
    const b = mid(to);
    const t0 = performance.now();
    const T = 320;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / T);
      const e = 1 - (1 - k) ** 3;
      const s = Math.exp(Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * e);
      const c = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
      renderer.setView(k < 1 ? { x: W - c.x * s, y: H - c.y * s, s } : to);
      if (onStep) onStep(e);
      if (k < 1) glide = requestAnimationFrame(step); else { glide = 0; updateStatus(); }
    };
    glide = requestAnimationFrame(step);
  }
  const PRESENT_ICONS = [['present-back', 'chevron-left'], ['present-next', 'chevron-right'], ['present-exit', 'xmark']];
  for (const [id, name] of PRESENT_ICONS) {
    const ic = $(id).querySelector('.ic');
    iconSvg(name).then((svg) => { if (svg) ic.innerHTML = svg; }, () => {}); // the host's own icon SVG
  }
  // The bar as the state is: which frame of how many, and Back or Next marked off at an end.
  function presentBar() {
    const n = presenting.order.length;
    $('present-count').textContent = `${presenting.i + 1} of ${n}`;
    $('present-back').setAttribute('aria-disabled', String(presenting.i === 0));
    $('present-next').setAttribute('aria-disabled', String(presenting.i === n - 1));
    updateStatus();
  }
  // Show the frame the state is at, with the tab over it, and say it.
  function presentFrame() {
    const b = board.get(presenting.order[presenting.i]);
    presentBar();
    if (!b) return;
    goToFrame(b, presentMove());
    say(wbPresentWords(presenting, b.title));
  }
  // How Present moves between frames: the one place the choice is read (shared presenting can pass the presenter's instead)
  // and the one place it is applied (goToFrame). With reduced motion every choice is Immediate; the choice itself is kept.
  const moveStore = () => window.localStorage;
  let presentMoveNow = wbMoveLoad(moveStore);
  const presentMove = () => presentMoveNow;
  const MOVES = { immediate: 'Immediate', fade: 'Fade', pan: 'Pan' };
  const world = $('world');
  let fading = null; // the board's fade in progress (a Web Animation), so a new move can end it
  function goToFrame(b, mode) {
    if (fading) { fading.cancel(); fading = null; }
    const fit = () => {
      const q = defOf(b).reach(b);
      return wbFitView({ x: b.x + q.x, y: b.y + q.y, w: q.w, h: q.h }, surface.clientWidth, surface.clientHeight, { bottom: WB_FRAME.bar, min: renderer.limits.min, max: renderer.limits.max });
    };
    const win = scrimWindow(b);
    const jump = () => { scrimDraw(win); showView(fit(), null, true); };
    const how = reduceMotion() ? 'immediate' : wbMoveValue(mode);
    if (how === 'pan') {
      const from = scrimNow;
      scrimDraw(from || win); // the clear window starts where the last one was, then travels with the view
      showView(fit(), from ? (e) => scrimDraw(wbLerpWindow(from, win, e)) : () => scrimDraw(win));
    } else if (how === 'fade' && world.animate && scrimNow) {
      const T = 150;
      const out = world.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T, fill: 'forwards' });
      fading = out;
      out.finished.then(() => {
        if (fading !== out) return;
        jump();
        const back = world.animate([{ opacity: 0 }, { opacity: 1 }], { duration: T });
        fading = back;
        out.cancel();
        back.finished.then(() => { if (fading === back) fading = null; }, () => {});
      }, () => {});
    } else jump();
  }
  // The spotlight: the dim and where it is clear (the frame shown, with its tab), in the world.
  const dimStore = () => window.localStorage;
  let presentDim = wbDimLoad(dimStore);
  const scrim = $('scrim');
  const dimInput = $('present-dim');
  function dimShow() {
    dimInput.value = String(presentDim);
    dimInput.title = `Dim the rest of the board: ${presentDim}%`;
    dimInput.setAttribute('aria-valuetext', `${presentDim}%`);
    scrim.style.setProperty('--wb-dim', String(wbDimStrength(presentDim)));
    scrim.dataset.dim = String(presentDim);
  }
  // The two clear windows, in board units: the frame's box and its title tab (read from what is drawn: the tab sits above the
  // box's top left corner, the gap between them is dimmed too).
  let scrimNow = null; // the window as last drawn
  function scrimWindow(b) {
    const el = renderer.element(b.id);
    const tab = el && el.querySelector('.wb-fr-tab');
    const face = el && el.querySelector('.wb-fr-face');
    // The corners as drawn: the computed radii are in the element's own units, which are board units (the world scales them).
    const radii = (e) => { const c = getComputedStyle(e); return ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((k) => parseFloat(c[`border${k}Radius`]) || 0); };
    return {
      face: { x: b.x, y: b.y, w: b.w, h: b.h, r: face ? radii(face) : [0, 0, 0, 0] },
      tab: tab && tab.offsetWidth ? { x: b.x, y: b.y - WB_FRAME.gap - tab.offsetHeight, w: tab.offsetWidth, h: tab.offsetHeight, r: radii(tab) } : null,
    };
  }
  function scrimDraw(win) {
    scrimNow = win;
    $('scrim-path').setAttribute('d', wbScrimPath(win));
    scrim.removeAttribute('hidden');
    dimShow();
  }
  dimShow();
  iconSvg('circle-half-stroke').then((svg) => { if (svg) $('present-dim-icon').innerHTML = svg; }, () => {});
  // The transition choice: one button that opens a menu of the three.
  const moveBtn = $('present-move');
  iconSvg('film').then((svg) => { if (svg) $('present-move-icon').innerHTML = svg; }, () => {});
  function moveShow() {
    const calm = reduceMotion();
    moveBtn.setAttribute('aria-label', `Transition: ${MOVES[presentMoveNow]}`);
    moveBtn.dataset.tip = calm ? 'How Present moves between frames (less motion is on: it jumps)' : 'How Present moves between frames';
    moveBtn.title = moveBtn.dataset.tip;
    $('present-move-label').textContent = MOVES[presentMoveNow];
  }
  moveShow();
  moveBtn.addEventListener('click', () => {
    host.menu.show({
      id: 'present-move',
      anchor: moveBtn,
      items: WB_MOVE.all.map((id) => ({ id, label: MOVES[id], current: id === presentMoveNow, onClick: () => { presentMoveNow = id; wbMoveSave(moveStore, id); moveShow(); surface.focus({ preventScroll: true }); } })),
    });
  });
  dimInput.addEventListener('input', () => {
    presentDim = wbDimValue(dimInput.value);
    wbDimSave(dimStore, presentDim);
    dimShow();
  });
  function startPresenting(at = null) {
    if (presenting) { if (at) presentTo(at); return; }
    const state = wbPresentStart(live(), renderer.view, at);
    if (!state) { note('No frames to present. Add a frame first.'); return; }
    if (editing) { const e = editing; editing = null; e.finish(true); }
    if (down !== null) { if (tool.cancel) tool.cancel(ctx); down = null; pointers.clear(); }
    closeFind({ quiet: true }); // Find is not used while presenting
    liveLeave(); // a person's own read-through: their pointer is not sent meanwhile
    presenting = state;
    select(null);
    $('app').classList.add('wb-presenting');
    $('present').hidden = false;
    surface.focus({ preventScroll: true });
    presentFrame();
  }
  function presentTo(id) {
    const i = presenting.order.indexOf(id);
    if (i < 0 || i === presenting.i) return;
    presenting = { ...presenting, i };
    presentFrame();
  }
  function presentGo(how) {
    if (!presenting) return;
    const next = wbPresentGo(presenting, how);
    if (next.i === presenting.i) return;
    presenting = next;
    presentFrame();
  }
  function stopPresenting() {
    if (!presenting) return;
    const back = presenting.view;
    presenting = null;
    $('app').classList.remove('wb-presenting');
    $('present').hidden = true;
    scrim.setAttribute('hidden', '');
    scrimNow = null;
    if (fading) { fading.cancel(); fading = null; }
    showView(back);
    surface.focus({ preventScroll: true });
    say('Stopped presenting.');
    updateStatus();
  }
  // The frames changed while presenting (a change from elsewhere, a reload).
  function presentSync() {
    if (!presenting) return;
    const next = wbPresentSync(presenting, live());
    if (!next) { stopPresenting(); note('There are no frames left to present.'); return; }
    presenting = next;
    if (next.same) presentBar(); else presentFrame();
  }
  // A key while presenting: the bar's buttons keep Enter and Space, Tab moves between them and the board, the rest is
  // the presentation's or nothing.
  function presentKey(e) {
    const onButton = Boolean(e.target.closest && e.target.closest('.wb-present button'));
    const k = e.key;
    if (k === 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('.wb-present-dim') && k !== 'Escape') return; // the slider keeps its own keys
    if (onButton && (k === 'Enter' || k === ' ')) return;
    e.preventDefault();
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ') presentGo('next');
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') presentGo('back');
    else if (k === 'Home') presentGo('first');
    else if (k === 'End') presentGo('last');
    else if (k === 'Escape') stopPresenting();
  }
  $('present-back').addEventListener('click', () => presentGo('back'));
  $('present-next').addEventListener('click', () => presentGo('next'));
  $('present-exit').addEventListener('click', () => stopPresenting());
  const presentRow = () => ({ id: 'present', label: 'Present', icon: 'play', onClick: () => startPresenting() });

  // ---- the overview -------------------------------------------------------------------------------------------------------
  // A small map of the whole board at the bottom right of the board (lib-n): the Overview button at the right of the toolbar
  // turns it on and off, each person's own choice kept in this browser when it can be (off at first), never in
  // the board's data. It shows every block, the frames as outlines, and what is in sight; a press on it puts the middle of
  // the view there at the same zoom, and a drag moves the view along. It is hidden while presenting, in a module smaller
  // than 360 x 320 pixels, and while the board is empty. It is a picture to the keyboard and a screen reader (no tab stop,
  // no key): the keyboard moves the board itself. It reads the board only, so someone who may only look can use it.
  // Other people's pointers shown (see "other people's pointers"): this browser's choice, on at first.
  const pointersStore = () => window.localStorage;
  let pointersOn = wbLiveLoad(pointersStore);
  overview = createOverview({
    layer: surface,
    centre(p) {
      if (presenting) return;
      cancelAnimationFrame(glide);
      glide = 0;
      renderer.setView(wbOverviewCentre(p, renderer.view, surface.clientWidth, surface.clientHeight));
      updateStatus();
    },
  });
  // Every block's box (lib-m, wbRect: a connector has none, it follows its blocks), with its z and whether it is a frame.
  const overviewBoxes = () => live().map((b) => { const r = wbRect(b, heightOf); return r && { ...r, z: b.z, frame: wbIsFrame(b) }; }).filter(Boolean);
  // Shown or hidden as things are now, and drawn again (once a frame at most, by lib-n): with the status line, after any
  // change to the board, a resize or presenting.
  function overviewRefresh() {
    if (!overview) return;
    const hidden = wbOverviewHidden({ on: overviewOn, width: host.rootElement.clientWidth, height: host.rootElement.clientHeight, count: live().length, presenting });
    overview.size(wbOverviewSize($('app').classList.contains('narrow')));
    overview.hide(hidden);
    if (hidden) return;
    overview.blocks(overviewBoxes());
    overview.view(viewBox());
  }
  // The view moved (a drag, the wheel, a zoom, a glide): only the rectangle, and the map's fit, follow.
  function overviewView() {
    if (overview && !overview.hidden) overview.view(viewBox());
  }
  function toggleOverview() {
    overviewOn = !overviewOn;
    wbOverviewSave(overviewStore, overviewOn); // where it cannot be kept, it lasts until the page goes
    overviewButton.set({ on: overviewOn });
    overviewRefresh();
  }
  setHeader();

  // ---- find in the board ----------------------------------------------------------------------------------------------------
  // Find, the title bar's Find button, or / on the board (when no words are being edited) opens the find bar at the top of the
  // board: what is typed is found in the blocks' words (lib-o: notes, text, shapes, frame titles, table cells, connector
  // labels, picture descriptions; case and accents aside), each block once, in reading order. Enter goes to the next match
  // and Shift Enter to the previous, round at the ends; Escape or Close closes it and hands the keyboard back to the board.
  // Every match has a thin accent outline and the one shown a stronger one, drawn on a layer of their own over the blocks
  // (nothing in the blocks changes). The one shown is not picked: what the person picked stays picked, so a Delete or an
  // arrow key after a search still acts on what they chose, and Find reads only, for someone who may only look too. The
  // view glides to a match that is not in sight (or jumps, for someone who asks for less motion), keeping the zoom unless
  // the block is too big to be seen whole (lib-o, wbFindView). Changes to the board, here or from elsewhere, are found
  // again a moment later. Not while presenting.
  let finding = null; // { ids, i } while the find bar is open: the matches in reading order, and the one shown (-1: none)
  let findTimer = 0;
  let findTyped = 0;
  const findBar = $('find');
  const findInput = $('find-input');
  const findMarks = document.createElement('div'); // the outlines round the matches, a layer over the blocks
  findMarks.className = 'wb-find-marks';
  findMarks.setAttribute('aria-hidden', 'true');
  $('world').insertBefore(findMarks, $('frame'));
  for (const [id, name] of [['find-prev', 'chevron-up'], ['find-next', 'chevron-down'], ['find-close', 'xmark']]) {
    const ic = $(id).querySelector('.ic');
    iconSvg(name).then((svg) => { if (svg) ic.innerHTML = svg; }, () => {});
  }
  // Where a block is drawn, for reading order (null: not drawn, as a connector whose block is gone).
  const findAt = (b) => { const r = renderer.rectOf(b.id); return r ? { x: r.x0, y: r.y0 } : null; };
  // The outlines: one round each match (all it draws), the one shown stronger.
  function drawFindMarks() {
    const ids = finding ? finding.ids : [];
    const kids = findMarks.children;
    while (kids.length > ids.length) kids[kids.length - 1].remove();
    ids.forEach((id, i) => {
      let m = kids[i];
      if (!m) { m = document.createElement('div'); m.className = 'wb-find-mark'; findMarks.append(m); }
      const r = renderer.reachOf(id);
      m.hidden = !r;
      if (r) { m.style.left = `${r.x0}px`; m.style.top = `${r.y0}px`; m.style.width = `${r.x1 - r.x0}px`; m.style.height = `${r.y1 - r.y0}px`; }
      m.classList.toggle('wb-find-now', i === finding.i);
    });
  }
  function showFindCount() {
    $('find-count').textContent = finding ? wbFindCount(findInput.value, finding.i, finding.ids.length) : '';
  }
  // Search again for what is typed. go: show the first match (what was typed changed); else keep the one shown.
  function runFind({ go = false } = {}) {
    if (!finding) return;
    clearTimeout(findTimer);
    findTimer = 0;
    const ids = wbFindMatches(live(), findInput.value, { at: findAt });
    const i = go ? (ids.length ? 0 : -1) : wbFindFollow(finding.ids, finding.i, ids);
    finding = { ids, i };
    showFindCount();
    drawFindMarks();
    if (go) { if (ids.length) showMatch(); else if (wbFindQuery(findInput.value)) say('No matches'); }
  }
  // The board changed: found again a moment after the last change, the view left where it is.
  function findSoon() { if (!findTimer) findTimer = setTimeout(() => { findTimer = 0; runFind(); }, WB_FIND.wait); }
  // Bring the match shown into sight, and say it.
  function showMatch() {
    const id = finding && finding.ids[finding.i];
    const r = id && renderer.reachOf(id);
    if (!r) return;
    const to = wbFindView(r, renderer.view, surface.clientWidth, surface.clientHeight, { min: renderer.limits.min });
    if (to) showView(to);
    say(wbFindWordsSaid(finding.i, finding.ids.length, wbFindWords(board.get(id))));
  }
  // Next (1) or previous (-1). What was typed and not yet searched for is searched for first (its first match is the next).
  function findGo(dir) {
    if (!finding) return;
    if (findTyped) { clearTimeout(findTyped); findTyped = 0; runFind({ go: true }); if (dir > 0) return; }
    const i = wbFindStep(finding.i, finding.ids.length, dir);
    if (i < 0) { say('No matches'); return; }
    finding = { ...finding, i };
    showFindCount();
    drawFindMarks();
    showMatch();
  }
  function openFind() {
    if (presenting) return;
    if (!finding) {
      if (editing) { const e = editing; editing = null; e.finish(true); }
      finding = { ids: [], i: -1 };
      findBar.hidden = false;
      placeFind();
      if (findInput.value) runFind();
    }
    findInput.focus({ preventScroll: true });
    findInput.select();
  }
  function closeFind({ quiet = false } = {}) {
    if (!finding) return;
    finding = null;
    clearTimeout(findTimer);
    clearTimeout(findTyped);
    findTimer = 0;
    findTyped = 0;
    findBar.hidden = true;
    showFindCount();
    drawFindMarks();
    if (!quiet) surface.focus({ preventScroll: true });
  }
  // Clear of the colour strip (top left): beside it where there is room, else under it.
  function placeFind() {
    findBar.style.top = '';
    const strip = $('paint');
    if (strip.hidden || !strip.offsetWidth) return;
    const bar = findBar.getBoundingClientRect();
    const st = strip.getBoundingClientRect();
    if (bar.left < st.right && bar.top < st.bottom) findBar.style.top = `${st.bottom - surface.getBoundingClientRect().top + 4}px`;
  }
  afterPaint = () => { if (finding) placeFind(); };
  findInput.addEventListener('input', () => {
    clearTimeout(findTyped);
    findTyped = setTimeout(() => { findTyped = 0; runFind({ go: true }); }, 150);
  });
  findBar.addEventListener('keydown', (e) => {
    e.stopPropagation(); // the board's keys are not the bar's
    if (e.key === 'Escape') { e.preventDefault(); closeFind(); return; }
    if (e.key === 'Enter' && e.target === findInput && !e.isComposing) { e.preventDefault(); findGo(e.shiftKey ? -1 : 1); }
  });
  for (const type of ['pointerdown', 'click', 'dblclick', 'contextmenu', 'wheel', 'copy', 'cut', 'paste', 'keyup']) findBar.addEventListener(type, (e) => e.stopPropagation());
  $('find-prev').addEventListener('click', () => findGo(-1));
  $('find-next').addEventListener('click', () => findGo(1));
  $('find-close').addEventListener('click', () => closeFind());

  // ---- links in the words ------------------------------------------------------------------------------------------------
  // A link in a block's words opens in a new tab: with Ctrl or Cmd and a click (that click is the link's, it picks
  // nothing), or with a plain click on the block that was already the one picked, once it is clear the click is not the
  // first of a double-click (which edits the words). Only with the Select tool, and never on a drag: a press on a link
  // anywhere else picks and moves the block as on its words. The browser itself never follows one (its click, middle
  // click and drag are stopped). The right-click menu has Open link too (the way for the keyboard and a touch screen).
  const LINK_WAIT = 400; // the Select tool's double-click time
  let linkPress = null; // { pointerId, href, sx, sy, mod, picked } while a press on a link is down
  let linkTimer = 0;
  function openLink(href) {
    if (typeof href !== 'string' || !/^https?:\/\//i.test(href)) return;
    window.open(href, '_blank', 'noopener,noreferrer');
  }
  for (const type of ['click', 'auxclick', 'dragstart']) {
    surface.addEventListener(type, (e) => { if (e.target.closest && e.target.closest('.wb-block a')) e.preventDefault(); }, true);
  }
  const hostOf = (href) => { try { return new URL(href).host; } catch { return ''; } };
  const linkRows = (id) => wbLinksIn(renderer.element(id)).map((href, i) => ({ id: `link-${i}`, label: 'Open link', icon: 'arrow-up-right-from-square', hint: hostOf(href), tip: href, onClick: () => openLink(href) }));

  // ---- the pointer ------------------------------------------------------------------------------------------------------
  const pointers = new Map(); // pointer id -> its last point on the screen
  let down = null; // the pointer the tool is following
  let pinch = null; // two fingers on the board: { d, s, mx, my }
  let pointerFocus = false; // a press is moving the focus
  // Moving the board with any tool: Space held, the middle mouse button, or the right one. { id, lx, ly } while it goes on;
  // for the right button also { right, sx, sy, target, moved, menu }. A right press moves the board only once it has gone
  // RIGHT_SLOP; one that does not is a right-click and opens the menu, for what was pressed (target: the captured pointer's
  // menu event names the board instead). menu: where it was asked for, when the browser asks on the press (a Mac, Linux);
  // on Windows it asks after the release. A right drag opens no menu: the menu a browser asks for just after one is not
  // shown (afterRightDrag). That lasts until the next press, a mouse menu asked for, or RIGHT_AFTER, whichever is first,
  // and never covers the menu key (a browser that asks for no menu after a drag must not leave a real right-click or the
  // menu key ignored).
  let spaceHeld = false;
  let panning = null;
  const RIGHT_SLOP = 4; // screen pixels a right press may wander and still be a click (the select tool's SLOP)
  const RIGHT_AFTER = 500; // milliseconds after a right drag in which a menu asked for is the drag's own
  let afterRightDrag = false; // a right drag has just ended: the menu the browser asks for after it is not shown
  let afterRightTimer = 0;
  const endAfterRight = () => { afterRightDrag = false; clearTimeout(afterRightTimer); afterRightTimer = 0; };
  const panCursor = (on) => { surface.classList.toggle('wb-grab', on); };
  const pointOf = (e) => ({ ...renderer.toBoard(e.clientX, e.clientY), id: renderer.blockAt(e.target), handle: renderer.handleAt(e.target), pointerType: e.pointerType, event: e });
  const twoFingers = () => {
    const [a, b] = [...pointers.values()];
    return { d: Math.max(1, Math.hypot(a.sx - b.sx, a.sy - b.sy)), mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 };
  };

  // A control on a block (a timer's buttons) is a button of its own: the board leaves its presses and keys alone.
  const onControl = (e) => Boolean(e.target && e.target.closest && e.target.closest('.wb-ctl'));
  surface.addEventListener('pointerdown', (e) => {
    endAfterRight(); // a new press: any menu after it is its own
    if (e.target.closest('.wb-text-edit') || onControl(e)) return;
    // Presenting: the bar's buttons are pressed as buttons; a press anywhere else does nothing (see "presenting").
    if (presenting) { if (!e.target.closest('.wb-present')) e.preventDefault(); return; }
    const middle = e.pointerType === 'mouse' && e.button === 1;
    const right = e.pointerType === 'mouse' && e.button === 2;
    if (e.pointerType === 'mouse' && e.button !== 0 && !middle && !right) return;
    const free = !editing && down === null && !pinch && !panning;
    if (right && (!free || spaceHeld)) return; // only the menu, as a right-click
    e.preventDefault();
    if ((middle || right || spaceHeld) && free) {
      try { surface.setPointerCapture(e.pointerId); } catch { /* the pointer is gone already */ }
      panning = { id: e.pointerId, lx: e.clientX, ly: e.clientY };
      if (right) Object.assign(panning, { right: true, sx: e.clientX, sy: e.clientY, target: e.target, moved: false, menu: null });
      else surface.classList.add('wb-grabbing');
      return;
    }
    // A press on a table's cell: remembered for Enter, and the active cell when the cells are being moved through.
    const pressed = (() => {
      const id = renderer.blockAt(e.target);
      const d = id && board.get(id) ? blockTypes.get(board.get(id).type) : null;
      const at = d && d.cellAt ? d.cellAt(e.target) : null;
      return at ? { id, r: at.r, c: at.c } : null;
    })();
    if (pressed) lastCell = pressed;
    const onCells = () => { if (pressed && cellNav && cellNav.id === pressed.id && sel.has(pressed.id)) showCell(pressed.id, pressed.r, pressed.c); };
    // A press while words are being edited only ends the editing: it does not also draw or put a block there.
    if (editing) { const ed = editing; editing = null; ed.finish(true); surface.focus({ preventScroll: true, focusVisible: false }); onCells(); return; }
    clearTimeout(linkTimer);
    linkTimer = 0;
    linkPress = null;
    const href = tool.id === 'select' && !spaceHeld ? wbLinkAt(e.target) : null;
    if (href) {
      const on = renderer.blockAt(e.target);
      linkPress = { pointerId: e.pointerId, href, sx: e.clientX, sy: e.clientY, mod: (e.ctrlKey || e.metaKey) && !e.shiftKey, picked: sel.size === 1 && sel.has(on) };
      if (linkPress.mod) return; // a Ctrl or Cmd click on a link is the link's
    }
    try { surface.setPointerCapture(e.pointerId); } catch { /* the pointer is gone already */ }
    const p = pointOf(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      if (down !== null && tool.cancel) tool.cancel(ctx);
      down = null;
      pinch = { ...twoFingers(), s: renderer.view.s };
      return;
    }
    if (pointers.size > 2) return;
    const el = p.id && renderer.element(p.id);
    pointerFocus = true; // the tool picks what a press picks, not the focus
    (el || surface).focus({ preventScroll: true, focusVisible: false }); // the ring is for the keyboard
    pointerFocus = false;
    if (tool.edits && !policy.canUseTool(tool)) return;
    down = e.pointerId;
    tool.down(p, ctx);
    onCells();
  });
  surface.addEventListener('pointermove', (e) => {
    if (panning && panning.id === e.pointerId) {
      if (panning.right && !panning.moved) {
        if (Math.hypot(e.clientX - panning.sx, e.clientY - panning.sy) < RIGHT_SLOP) return;
        panning.moved = true;
        surface.classList.add('wb-grabbing');
      }
      renderer.panBy(e.clientX - panning.lx, e.clientY - panning.ly);
      panning.lx = e.clientX; panning.ly = e.clientY;
      return;
    }
    if (!pointers.has(e.pointerId)) return;
    const p = pointOf(e);
    pointers.set(e.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const now = twoFingers();
      renderer.zoomAt(pinch.s * (now.d / pinch.d), now.mx, now.my);
      renderer.panBy(now.mx - pinch.mx, now.my - pinch.my);
      pinch.mx = now.mx; pinch.my = now.my;
      updateStatus();
      return;
    }
    if (down === e.pointerId && tool.move) tool.move(p, ctx);
  });
  const lift = (e) => {
    if (linkPress && linkPress.pointerId === e.pointerId) {
      const lp = linkPress;
      linkPress = null;
      const still = e.type === 'pointerup' && Math.hypot(e.clientX - lp.sx, e.clientY - lp.sy) < 4;
      if (still && lp.mod) openLink(lp.href);
      else if (still && lp.picked) linkTimer = setTimeout(() => { linkTimer = 0; if (!editing) openLink(lp.href); }, LINK_WAIT);
    }
    if (panning && panning.id === e.pointerId) {
      const was = panning;
      panning = null;
      surface.classList.remove('wb-grabbing');
      if (was.right && was.moved) { endAfterRight(); afterRightDrag = true; afterRightTimer = setTimeout(endAfterRight, RIGHT_AFTER); }
      else if (was.right && was.menu && e.type === 'pointerup') contextMenu(was.menu);
      return;
    }
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    if (down !== e.pointerId) return;
    down = null;
    if (e.type === 'pointercancel') { if (tool.cancel) tool.cancel(ctx); } else if (tool.up) tool.up(pointOf(e), ctx);
  };
  surface.addEventListener('pointerup', lift);
  surface.addEventListener('pointercancel', lift);
  surface.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // no scrolling by the middle button
  surface.addEventListener('keyup', (e) => { if (e.key === ' ') { spaceHeld = false; panCursor(false); } });
  surface.addEventListener('focusout', (e) => { if (!surface.contains(e.relatedTarget)) { spaceHeld = false; panCursor(false); } });
  const WHEEL_STEP = Math.log(1.12); // the most one wheel step zooms: 12%
  surface.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (presenting) return; // the view moves with the frames alone
    const r = surface.getBoundingClientRect();
    // In pixels, whatever the wheel counts in (lines, pages).
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? surface.clientHeight : 1;
    if (e.ctrlKey || e.metaKey) {
      // A pinch on a trackpad comes as many small steps and follows the fingers; a mouse wheel's notch is one big step,
      // held to WHEEL_STEP, so it zooms a little, not by half again.
      const f = Math.min(WHEEL_STEP, Math.max(-WHEEL_STEP, -e.deltaY * unit * 0.01));
      renderer.zoomAt(renderer.view.s * Math.exp(f), e.clientX - r.left, e.clientY - r.top);
    } else renderer.panBy(-e.deltaX * unit, -e.deltaY * unit);
    updateStatus();
  }, { passive: false });

  // Right-click (or a long press) on a block: what can be done with it, and with the others picked with it.
  // On the board itself: paste there, or select everything.
  surface.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.wb-text-edit')) return;
    e.preventDefault();
    if (presenting) return;
    // A right press still down may yet be a drag: its menu waits for the release. One just after a right drag is not shown.
    if (panning && panning.right) { panning.menu = { target: panning.target, clientX: e.clientX, clientY: e.clientY }; return; }
    // The menu key (and Shift F10) asks with no mouse button: always shown.
    if (afterRightDrag && e.button === 2) { endAfterRight(); return; }
    contextMenu(e);
  });
  function contextMenu(e) {
    const id = renderer.blockAt(e.target) || (renderer.handleAt(e.target) ? one() : null); // a handle is its block's
    const box = host.rootElement.getBoundingClientRect();
    const at = { x: e.clientX - box.left, y: e.clientY - box.top };
    if (!id) {
      // Someone who may only look: Save as image.
      if (!policy.canEdit) { host.menu.show({ id: 'board', at, items: [exportRow(), presentRow()] }); return; }
      const there = renderer.toBoard(e.clientX, e.clientY);
      host.menu.show({
        id: 'board',
        at,
        items: [
          { id: 'paste', label: 'Paste here', icon: 'paste', hint: keyHint(`${MOD} V`), disabled: !clipboard.has(), onClick: () => paste({ x: there.x, y: there.y }) },
          { id: 'all', label: 'Select all', icon: 'object-group', hint: keyHint(`${MOD} A`), disabled: board.size === 0, onClick: () => selectAll() },
          { separator: true },
          backgroundRow(at),
          exportRow(),
          presentRow(),
        ],
      });
      return;
    }
    if (!sel.has(id)) select([id]);
    const ids = [...sel];
    const list = targets();
    const links = ids.length === 1 ? linkRows(id) : [];
    // A frame, picked alone: present from it, and save it as a picture (its own box, with all of the board in it).
    const frameRows = pickedFrame() ? [
      { id: 'present-here', label: 'Present from this frame', icon: 'play', onClick: () => startPresenting(id) },
      { id: 'export-frame', label: 'Save frame as image…', icon: 'file-image', onClick: () => { setTimeout(() => openExport('frame'), 0); } },
    ] : [];
    if (!policy.canEdit) {
      // Someone who may only look: the links, if there are any, a frame's own rows, and Save as image (what is selected).
      const own = [...links, ...frameRows];
      host.menu.show({ id: 'block', at, items: [...own, ...(own.length ? [{ separator: true }] : []), exportRow('selection')] });
      return;
    }
    // Locked blocks are in `ids` and not in `list` (what may be changed): they get Unlock, Copy, Duplicate and Save as
    // image, and the rest of the menu works on the others.
    const single = list.length === 1 && ids.length === 1 ? list[0] : null;
    const lockOn = wbLockChanges(ids, pickedBlocks()).on;
    const deletable = ids.filter((x) => policy.canDelete(board.get(x))).length;
    const def = single && defOf(single);
    // A table's cell: the one pressed (it becomes the active one), else the active one (Shift F10), else the first.
    let cell = null;
    if (def && def.edit === 'cells') {
      const hit = def.cellAt(e.target);
      cell = hit || (cellNav && cellNav.id === single.id ? cellNav : null) || { r: 0, c: 0 };
      if (hit) showCell(single.id, hit.r, hit.c);
    }
    const lines = connectorsIn();
    const worded = wordedIn();
    host.menu.show({
      id: 'block',
      className: 'wb-block-menu',
      at,
      items: [
        ...(def && def.edit === 'text' ? [{ id: 'edit', label: def.editLabel || 'Edit', icon: 'pen', hint: keyHint('Enter'), onClick: () => edit(single.id) }] : []),
        // The block type's own entries (a note's Add pointer, Remove pointer): each one save of the fields it names.
        ...(cell ? cellRows(single, cell) : def && def.actions ? def.actions(single).map((a) => ({ id: a.id, label: a.label, icon: a.icon, onClick: () => ctx.change(single.id, a.fields, { save: 'now' }) })) : []),
        ...(list.length ? [{ id: 'colour', label: 'Colour', icon: 'palette', onClick: () => { setTimeout(() => colourMenu({ at }), 0); } }] : []),
        ...(list.some((b) => defOf(b).weight) ? [{ id: 'width', label: 'Line width', onClick: () => { setTimeout(() => widthMenu({ at }), 0); } }] : []),
        ...(lines.length ? lineGroups(lines) : []),
        ...(worded.length ? textGroups(worded).map((g) => ({ id: g.id, label: g.label, icon: g.id === 'text-size' ? 'text-height' : 'align-left', hint: g.hint, items: g.rows })) : []),
        ...links,
        ...(pair() ? [{ id: 'connect', label: 'Connect them', icon: 'arrows-turn-right', onClick: () => connectPicked() }] : []),
        // Two or more picked: align and distribute them, group them; and for any picked, ungroup, lock or unlock.
        ...(ids.length > 1 ? [{ id: 'arrange', label: 'Arrange', icon: 'arrows-left-right-to-line', items: arrangeRows() }] : []),
        ...(ids.length > 1 && canGroup() ? [{ id: 'group', label: 'Group', icon: 'object-group', hint: keyHint(`${MOD} G`), onClick: () => groupPicked() }] : []),
        ...(inGroup() ? [{ id: 'ungroup', label: 'Ungroup', icon: 'object-ungroup', hint: keyHint(`${MOD} Shift G`), onClick: () => ungroupPicked() }] : []),
        { id: 'lock', label: lockOn ? 'Lock' : 'Unlock', icon: lockOn ? 'lock' : 'lock-open', hint: keyHint(`${MOD} L`), onClick: () => lockPicked() },
        { heading: 'Layer' },
        ...LAYERS.map((l) => ({ ...l, disabled: !canLayer(ids, l.id), onClick: () => layer(ids, l.id) })),
        { separator: true },
        ...clipRows(null, { cut: list.length > 0 }),
        exportRow('selection'),
        ...frameRows,
        { separator: true },
        { id: 'delete', label: deletable > 1 ? `Delete ${deletable} blocks` : 'Delete', icon: 'trash', hint: keyHint('Delete'), danger: true, disabled: !deletable, onClick: () => removeMany(ids) },
      ],
    });
    // Line width has no icon that reads as it: a short line is drawn in the icon's place instead.
    const menu = surface.getRootNode().querySelector('.wb-block-menu');
    const row = menu && [...menu.querySelectorAll('.sdk-menu-label')].find((l) => l.textContent === 'Line width');
    if (row) row.before(widthSample(3, 'wb-width-sample wb-width-icon'));
  }

  // ---- the keyboard -----------------------------------------------------------------------------------------------------
  // Tab reaches the board and then each block in turn; a block that takes the focus is selected (alone, unless it is one
  // of those picked already).
  surface.addEventListener('focusin', (e) => {
    const id = renderer.blockAt(e.target);
    if (id && !pointerFocus && !sel.has(id) && !e.target.closest('.wb-text-edit')) select([id]);
  });
  surface.addEventListener('keydown', (e) => {
    if (presenting) { if (!onControl(e)) presentKey(e); return; }
    if (e.target.closest('.wb-text-edit') || e.altKey) return;
    if (onControl(e) && e.key !== 'Escape' && e.key !== 'Tab') return;
    if (e.key === ' ') { e.preventDefault(); if (!spaceHeld) { spaceHeld = true; panCursor(true); } return; } // held: drag moves the board
    const picked = targets(); // the picked blocks this person may change
    const b = one() && board.get(one());
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    // A table's active cell (see "cells"): the arrows, Enter, Delete and a letter are the cells', Escape leaves them.
    const nav = cellNav && b && b.id === cellNav.id && policy.canChange(b) ? cellNav : null;
    if (nav && !mod) {
      const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[k];
      if (dir) { e.preventDefault(); const st = wbTableStep(b, nav.r, nav.c, dir); if (st) { showCell(b.id, st.r, st.c); sayCell(b.id, st.r, st.c); } return; }
      if (k === 'Enter' || k === 'F2') { e.preventDefault(); editCell(b.id, nav.r, nav.c); return; }
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); putCell(b.id, nav.r, nav.c, ''); return; }
      if (k === 'Escape') { e.preventDefault(); leaveCells(); say('The arrow keys move the table again.'); return; }
      if (k.length === 1 && !e.isComposing) { e.preventDefault(); editCell(b.id, nav.r, nav.c, { typed: k }); return; }
    }
    if (wbFindKey(e, { editing: Boolean(editing), presenting: Boolean(presenting) })) { e.preventDefault(); openFind(); return; }
    if (mod && !e.shiftKey && k.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
    // Undo: Ctrl or Cmd Z; redo: with Shift, or Ctrl Y.
    const zy = mod ? (e.code === 'KeyZ' || k.toLowerCase() === 'z' ? 'z' : e.code === 'KeyY' || k.toLowerCase() === 'y' ? 'y' : '') : '';
    if (zy && history) { e.preventDefault(); undoRedo(zy === 'z' && !e.shiftKey ? 'undo' : 'redo'); return; }
    // Lock (Ctrl or Cmd L, again to unlock), group (Ctrl or Cmd G) and ungroup (with Shift): only with something picked,
    // so with nothing picked the browser keeps the keys (by the key's place too, so any keyboard layout).
    const named = mod ? (e.code && e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : k.toLowerCase()) : '';
    if (named === 'l' && !e.shiftKey && policy.canEdit && sel.size) { e.preventDefault(); lockPicked(); return; }
    if (named === 'g' && policy.canEdit && sel.size) { e.preventDefault(); if (e.shiftKey) ungroupPicked(); else groupPicked(); return; }
    // Copy, cut, paste and duplicate (by the key's place too, so any keyboard layout).
    const letter = mod && !e.shiftKey ? (e.code && e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : k.toLowerCase()) : '';
    if (letter && 'cxvd'.includes(letter) && policy.canEdit) {
      if (letter === 'd') { e.preventDefault(); duplicate(); return; }
      // Copy, cut and paste go through the browser's own copy, cut and paste events (below), so a picture on the
      // computer's clipboard reaches a paste; where the browser sends none, the board does it a moment later.
      clipKey(letter);
      return;
    }
    // Locked blocks among those picked stay, and the person is told (removeMany, the arrows and the brackets).
    const lockedPicked = policy.canEdit ? [...sel].filter((id) => { const x = board.get(id); return x && x.locked; }).length : 0;
    if ((k === 'Delete' || k === 'Backspace') && (picked.length || lockedPicked)) { e.preventDefault(); removeMany([...sel]); surface.focus({ preventScroll: true }); return; }
    if (k === 'Escape') {
      select(null); // Escape clears the pick and goes back to Select, Many off (also from the Hand and the drawing tools)
      if (many) { many = false; updatePaint(); }
      if (tool.id !== 'select') setTool('select');
      surface.focus({ preventScroll: true });
      return;
    }
    // Enter edits the one picked block, or the block of a picked group that has the keyboard.
    const focused = renderer.blockAt(e.target);
    const toEdit = b || (focused && sel.has(focused) ? board.get(focused) : null);
    if (k === 'Enter' && toEdit) { e.preventDefault(); edit(toEdit.id); return; }
    if (k.startsWith('Arrow') && lockedPicked && !mod) lockedNote(lockedPicked, sel.size);
    if (k.startsWith('Arrow') && !picked.length && lockedPicked && !mod) { e.preventDefault(); return; }
    if (k.startsWith('Arrow') && picked.length && !mod) {
      e.preventDefault();
      const step = e.shiftKey ? 1 : 10;
      const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
      const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
      // A frame takes the blocks inside it along (a locked one stays, and the person is told).
      const f = wbFrameMoveChanges(picked.map((x) => ({ id: x.id, dx, dy })), live(), { measure: heightOf });
      if (history) history.tag(`nudge:${f.changes.map((c) => c.id).sort().join(',')}`); // a run of presses is one step
      for (const c of f.changes) ctx.change(c.id, c.fields, { save: 'soon' });
      if (f.locked) lockedNote(f.locked, f.changes.length + f.locked);
      return;
    }
    if (mod) return;
    // ] forward one layer, [ back one; with Shift, to the front and to the back (by the key's place, so any keyboard layout).
    const bracket = e.code === 'BracketRight' || k === ']' || k === '}' ? 'up' : e.code === 'BracketLeft' || k === '[' || k === '{' ? 'down' : null;
    if (bracket && (picked.length || lockedPicked)) {
      e.preventDefault();
      const ends = e.shiftKey || k === '}' || k === '{';
      layer([...sel], bracket === 'up' ? (ends ? 'front' : 'forward') : (ends ? 'back' : 'backward'));
      return;
    }
    if (k === '+' || k === '=') { renderer.zoomBy(1.25); updateStatus(); return; }
    if (k === '-') { renderer.zoomBy(0.8); updateStatus(); return; }
    if (k === '0') { renderer.fit(); updateStatus(); return; }
    if (k.toLowerCase() === 'y' && !mod && !e.altKey && policy.canEdit) { e.preventDefault(); toggleTimer(false); return; }
    const t = allowed.find((x) => x.key === k.toLowerCase());
    if (t) { e.preventDefault(); if (goesBack(t)) toggleTool(t); else setTool(t.id); }
  });

  // ---- the computer's clipboard, and dropping files -----------------------------------------------------------------------
  // Ctrl or Cmd C, X and V reach the board as the browser's copy, cut and paste events. Copy and cut keep the blocks in
  // this page's clipboard (lib-h) as before and put a mark on the computer's clipboard (CLIP_MARK, no words or picture), so
  // a picture copied elsewhere earlier is no longer there to be pasted instead. A paste that carries picture files and
  // not the mark adds the pictures, where the pointer is over the board or else in the middle of what is in sight; then
  // rows and columns (an HTML table, or tab-separated lines) make a table there. A paste with the mark puts down the
  // copied blocks. Once a copy here has put the mark on the computer's clipboard, a paste without it, without pictures
  // and without rows (words copied elsewhere since) does nothing: it is not the blocks being pasted. A copy that could
  // not put the mark there (the menu's Copy, a browser that sends no event) leaves any paste putting the copied blocks
  // down. A browser that sends no event: the key does it after CLIP_WAIT.
  const CLIP_MARK = 'application/x-coffee-whiteboard-blocks';
  const CLIP_WAIT = 150;
  let clipTimer = 0;
  function clipKey(letter) {
    clearTimeout(clipTimer);
    clipTimer = setTimeout(() => {
      clipTimer = 0;
      if (letter === 'c') copy(); else if (letter === 'x') copy({ cut: true }); else paste();
    }, CLIP_WAIT);
  }
  const inField = (e) => Boolean(e.target && e.target.closest && e.target.closest('.wb-text-edit'));
  function onCopyEvent(e, cut) {
    if (inField(e) || !policy.canEdit || (cut && presenting)) return;
    clearTimeout(clipTimer);
    clipTimer = 0;
    if (!copyable().length) return;
    e.preventDefault();
    let marked = false;
    try { if (e.clipboardData) { e.clipboardData.setData(CLIP_MARK, '1'); marked = true; } } catch { /* the page's own clipboard still has them */ }
    copy({ cut });
    clipMarked = marked;
  }
  surface.addEventListener('copy', (e) => onCopyEvent(e, false));
  surface.addEventListener('cut', (e) => onCopyEvent(e, true));
  // The files a paste or a drop carries (some browsers give them only as items).
  function filesOf(data) {
    if (!data) return [];
    const files = [...(data.files || [])];
    if (files.length) return files;
    return [...(data.items || [])].filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean);
  }
  // Where the pointer is over the board (a mouse or a pen hovering), for a paste.
  let hover = null;
  surface.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    hover = { cx: e.clientX, cy: e.clientY };
    // A tool that shows something under a resting pointer (the Connector: the connection points of the block there).
    if (tool.hover && down === null && !panning && !pinch && !editing) tool.hover(pointOf(e), ctx);
  });
  surface.addEventListener('pointerleave', () => { hover = null; if (tool.hover && down === null) tool.hover(null, ctx); });
  surface.addEventListener('paste', (e) => {
    if (inField(e) || !policy.canEdit || presenting) return;
    clearTimeout(clipTimer);
    clipTimer = 0;
    const data = e.clipboardData;
    const ours = Boolean(data && [...(data.types || [])].includes(CLIP_MARK));
    const files = ours ? [] : filesOf(data);
    e.preventDefault();
    if (files.length && pictures) { const p = hover && renderer.toBoard(hover.cx, hover.cy); addPictures(files, p && { x: p.x, y: p.y }); return; }
    // Rows and columns from a spreadsheet (an HTML table's words, or lines of tab-separated text): a table (lib-k).
    const grid = ours ? null : gridOf(data);
    if (grid && policy.canCreate()) { pasteTable(grid); return; }
    if (!ours && (files.length || clipMarked)) return; // something copied elsewhere since: not the blocks
    paste();
  });

  // Dropping files on the board, the Vault's way: a drag carrying files shows "Drop to add to the board" over it, only to
  // someone who may add pictures; each picture dropped is added where it is let go (several, a step apart). For anyone
  // else, a file dropped on the board does nothing (and the browser does not open it in place of the page).
  let dragDepth = 0;
  const carriesFiles = (e) => Boolean(e.dataTransfer) && [...(e.dataTransfer.types || [])].includes('Files');
  function showDropOver(on) {
    $('drop').hidden = !on;
  }
  $('drop-sub').textContent = 'JPEG, PNG, WebP or GIF pictures. Everyone who can see the board sees them.';
  surface.addEventListener('dragenter', (e) => { if (!pictures || !carriesFiles(e) || presenting) return; dragDepth += 1; showDropOver(true); });
  surface.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) showDropOver(false); });
  surface.addEventListener('dragover', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = pictures ? 'copy' : 'none';
  });
  surface.addEventListener('drop', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    showDropOver(false);
    if (!pictures || presenting) return;
    const p = renderer.toBoard(e.clientX, e.clientY);
    addPictures(filesOf(e.dataTransfer), { x: p.x, y: p.y });
  });

  // ---- other people's pointers ------------------------------------------------------------------------------------------
  // Live (lib-p, host.live): while this person's pointer moves over the board, its place in board units and the tool in
  // hand go to everyone else on the board (at most 20 a second, the last place always), nothing while it rests, and one
  // "gone" when it leaves the board, the page is hidden or goes, or presenting starts (a person's own read-through sends
  // nothing). A touch sends only while the finger is down. Everyone else's pointer is drawn on a layer of its own in the
  // world (it moves and zooms with the board, the same size on the screen): an arrow in their colour and their name, a
  // guest's marked. Quiet for 5 seconds it dims, for 20 it goes; it goes at once when they leave the board or the live
  // messages close. Hide other people's pointers (the title bar's menu) is this person's own choice in this browser, never
  // in the board's data; it hides only what they see: their own pointer still goes to the others. Nothing here changes
  // the board, its history, Find, the overview, Save as image or Print. Someone who may only look sends and sees too.
  const liveApi = host.live && typeof host.live.publish === 'function' ? host.live : null;
  const liveStore = createWbLiveStore();
  const liveLayer = document.createElement('div');
  liveLayer.className = 'wb-live';
  liveLayer.setAttribute('aria-hidden', 'true');
  liveLayer.hidden = true;
  $('world').append(liveLayer);
  const liveEls = new Map(); // a person's key -> { el, name, tool, x, y, toolId, faded }
  const liveState = () => (liveApi ? liveApi.state : 'closed');
  const guestWord = host.util.word('guest');
  const ARROW = 'M1 1 L1 17 L5.5 13 L8.5 20 L11.5 18.7 L8.6 12 L14.5 12 Z';
  function livePointerEl(p) {
    const el = document.createElement('div');
    el.className = 'wb-live-pointer';
    if (p.tint) el.style.setProperty('--wb-live', `var(--tint-${p.tint})`); // one of the eight (lib-p checked it)
    const mark = document.createElement('div');
    mark.className = 'wb-live-mark';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'wb-live-arrow');
    svg.setAttribute('viewBox', '0 0 18 22');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ARROW);
    svg.append(path);
    const tag = document.createElement('span');
    tag.className = 'wb-live-tag';
    const name = document.createElement('span');
    name.className = 'wb-live-name';
    name.textContent = wbLiveLabel(p, guestWord);
    const toolEl = document.createElement('span');
    toolEl.className = 'wb-live-tool';
    tag.append(name, toolEl);
    mark.append(svg, tag);
    el.append(mark);
    return { el, name, tool: toolEl, x: null, y: null, toolId: null, label: name.textContent, faded: false };
  }
  // Drawn once a frame at most: each pointer's place (one transform), its dimming and its tool; gone ones taken away.
  let liveFrame = 0;
  function liveDraw() { if (!liveFrame) liveFrame = requestAnimationFrame(liveFlush); }
  function liveFlush() {
    liveFrame = 0;
    const drawn = wbLiveDrawn({ on: pointersOn, state: liveState() });
    if (!drawn && liveStore.size) liveStore.clear();
    for (const [k, v] of liveEls) if (!liveStore.get(k)) { v.el.remove(); liveEls.delete(k); }
    liveLayer.hidden = !drawn || !liveStore.size;
    if (!drawn) return;
    const now = Date.now();
    for (const p of liveStore.list()) {
      let v = liveEls.get(p.key);
      if (!v) { v = livePointerEl(p); liveEls.set(p.key, v); }
      if (v.x !== p.x || v.y !== p.y) { v.el.style.transform = `translate(${p.x}px, ${p.y}px)`; v.x = p.x; v.y = p.y; }
      if (!v.el.isConnected) liveLayer.append(v.el); // placed first, so it does not glide in from the corner
      const label = wbLiveLabel(p, guestWord);
      if (v.label !== label) { v.name.textContent = label; v.label = label; }
      const faded = liveStore.faded(p, now);
      if (v.faded !== faded) { v.el.classList.toggle('wb-live-faded', faded); v.faded = faded; }
      const toolId = p.tool && p.tool !== 'select' && tools.get(p.tool) ? p.tool : null;
      if (v.toolId !== toolId) {
        v.toolId = toolId;
        v.tool.replaceChildren();
        if (toolId) {
          const box = v.tool;
          iconSvg(tools.get(toolId).icon).then((s) => { if (s && v.toolId === toolId) box.innerHTML = s; }, () => {}); // the host's own icon SVG
        }
      }
    }
    liveSweepSoon();
  }
  // While any pointer is drawn, once a second: dim the quiet ones and take away the long-quiet ones. No timer otherwise.
  let liveSweep = 0;
  function liveSweepSoon() {
    if (liveSweep || !liveStore.size) return;
    liveSweep = setTimeout(() => { liveSweep = 0; liveStore.sweep(Date.now()); liveDraw(); }, 1000);
  }
  function togglePointers() {
    pointersOn = !pointersOn;
    wbLiveSave(pointersStore, pointersOn); // where it cannot be kept, it lasts until the page goes
    if (!pointersOn) liveStore.clear();
    setHeader();
    liveDraw();
  }

  // Sending. Not over the find bar, the presenting bar, the overview or the formatting bar: only the board itself.
  const NOT_BOARD = '.wb-find, .wb-present, .wb-overview, .wb-format, .wb-drop';
  const liveSender = liveApi ? createWbLiveSender({ send: (data) => liveApi.publish(WB_LIVE.topic, data) }) : null;
  const liveLeave = () => { if (liveSender) liveSender.leave(); };
  function livePoint(e) {
    if (!liveSender || !e.isPrimary) return;
    const over = !(e.target && e.target.closest && e.target.closest(NOT_BOARD));
    if (!wbLiveMaySend({ state: liveState(), hidden: document.visibilityState === 'hidden', presenting, over })) { liveLeave(); return; }
    const cx = e.clientX;
    const cy = e.clientY;
    const using = tool.id;
    liveSender.move(() => wbLivePayload(renderer.toBoard(cx, cy), using)); // worked out when it goes
  }
  if (liveApi) {
    surface.addEventListener('pointermove', livePoint);
    surface.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') livePoint(e); }); // a finger is down
    surface.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch' && e.isPrimary) liveLeave(); }); // and lifted
    surface.addEventListener('pointercancel', (e) => { if (e.isPrimary) liveLeave(); });
    surface.addEventListener('pointerleave', (e) => { if (e.isPrimary) liveLeave(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') liveLeave(); });
    window.addEventListener('pagehide', liveLeave);
    // Hearing. Only the fields a pointer sends, each checked (lib-p); a message that is not one is ignored.
    try {
      liveApi.subscribe(WB_LIVE.topic, (data, from) => {
        const msg = wbLiveRead(data, from, { me, tint: (k) => liveApi.tint(k) });
        if (!msg || (!pointersOn && !msg.gone)) return;
        liveStore.put(msg, Date.now());
        liveDraw();
      });
      liveApi.on('people', (e) => {
        const left = e && e.left;
        if (left && typeof left.key === 'string' && liveStore.remove(left.key)) liveDraw();
      });
      liveApi.on('state', (s) => { if (s !== 'open') { liveStore.clear(); liveLeave(); } liveDraw(); });
    } catch { /* no live messages here: nothing is drawn */ }
  }

  // ---- the width ------------------------------------------------------------------------------------------------------
  // The module's width, not the window's (a bundled module runs in the page). The stylesheet keys on `.app.narrow`.
  let fitted = false;
  new ResizeObserver(() => {
    const w = host.rootElement.clientWidth;
    $('app').classList.toggle('narrow', w > 0 && w < 520);
    if (!fitted && surface.clientWidth > 0) { fitted = true; renderer.fit(); }
    updateStatus(); // the overview: its size, and whether there is room for it
    if (finding) placeFind(); // the find bar clear of the colour strip at the new width
  }).observe(host.rootElement);
  window.addEventListener('pagehide', () => { sync.flush(); boardSync.flush(); });

  // ---- start ------------------------------------------------------------------------------------------------------------
  host.on('change', (e) => { sync.handle(e); boardSync.handle(e); });
  host.on('changes', (e) => { keepBackground(e); sync.handleMany(e); boardSync.handleMany(e); });
  let first;
  try { first = await sync.load(); } catch (err) { showMsg('The whiteboard could not be read', err.message); return; }
  await reloadBoard(); // the background (Default when it cannot be read)
  for (const b of first) if (policy.canSee(b)) { known.set(b.id, b); board.put(b); renderer.draw(b); }
  sweepSoon();
  $('loading').hidden = true;
  $('app').hidden = false;
  if (surface.clientWidth > 0) { fitted = true; renderer.fit(); }
  updateStatus();
})();
