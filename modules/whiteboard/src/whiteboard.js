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
  const renderer = createRenderer({ surface, world: $('world'), frame: $('frame') });
  const drafts = new Set(); // blocks made here that are not saved yet (a stroke being drawn, a note before its words)
  const held = new Set(); // blocks being moved or edited here: a change to one from elsewhere waits until it is let go
  const waiting = new Map(); // id -> the newest change from elsewhere to a held block
  const known = new Map(); // id -> the block as last saved here or heard from elsewhere: a change's "before", for undo
  const sel = new Set(); // the picked blocks' ids
  const one = () => (sel.size === 1 ? [...sel][0] : null); // the one picked block, or null (none, or several)
  let editing = null; // { id, finish }
  let many = false; // "Select many" (a touch screen): one finger drags a rectangle and a tap adds, rather than moving the board
  let tool = tools.get('select');
  // The colours and width picked for new blocks, by role; null: each type's usual. They go to a new block only where its
  // usual is a colour (a text block keeps no background, a note its matching border); weight goes with the stroke.
  const next = { stroke: null, fill: null, ink: null, weight: null };
  // A freehand stroke's width is picked for its brush alone (a marker is wide, a pen thin): brush id -> width, or null.
  const nextWeights = { pen: null, marker: null, brush: null };
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
  // trackpad, as in the buttons' names; on a touch screen alone, what a finger does. MOVE_HELP is how the board moves.
  const MOVE_HELP = 'To move the board, drag with the right mouse button, hold the spacebar and drag, or pick the Hand tool (H).';
  const boardHelp = () => {
    if (!KEYS) return 'Whiteboard. Tap a block to pick it and drag it to move it; press it long for more. Drag the board with one finger to move it, pinch to zoom. To join two blocks, pick Connector in the Flowchart menu and drag from one to the other. The Paint menu holds Fill, the Pen, the Marker and the Brush; with Fill, tap a block to fill it with colour. The Timer button puts a countdown on the board.';
    const M = MOD === 'Cmd' ? 'Command' : 'Ctrl';
    return `Whiteboard. Tab moves through the blocks; Enter edits one, the arrow keys move what is selected, Delete takes it away. Shift-click adds a block to the selection, ${M} A selects all, Escape clears. ${M} C, X, V and D copy, cut, paste and duplicate; ${M} Z undoes, ${M} Shift Z redoes. ${MOVE_HELP} The Connector tool (C) joins two blocks: press on one and drag to the other. A connector follows its blocks and goes when one of them is deleted; Enter on it edits its label. The Paint menu holds Fill (F), the Pen (P), the Marker (M) and the Brush. With Fill, click a block to fill it with colour, or ${ALT}-click one to take its colour. The Timer (Y) puts a countdown on the board; Tab reaches its Start, Reset and Length buttons. Paste or drop a picture to add it, or choose Add a picture in the +.`;
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
  const takesNext = (def, role) => {
    const usual = def.create();
    if (role === 'weight') return Boolean(def.weight) && WB_PALETTE_BY_ID.has(usual.stroke);
    return Boolean(def.paint && def.paint[role]) && WB_PALETTE_BY_ID.has(usual[role]);
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
    panBy: (dx, dy) => renderer.panBy(dx, dy),
    draft(type, fields) {
      const def = blockTypes.get(type);
      // The type's usual, then what the tool making it draws with (a marker's width), then what the person picked.
      const own = { ...def.create(), ...(tool.makes === type && tool.usual ? tool.usual : {}) };
      const brush = type === 'stroke' ? fields.brush || own.brush : null;
      for (const role of Object.keys(next)) {
        const v = role === 'weight' ? nextWeightOf(brush) : next[role];
        if (v !== null && takesNext(def, role)) own[role] = v;
      }
      if (type === CONNECTOR) for (const [k, v] of Object.entries(nextLine)) if (v !== null) own[k] = v;
      const b = wbClean({ ...own, ...fields, id: host.util.id(), type, z: Math.floor(board.topZ()) + 1 });
      drafts.add(b.id);
      commit(b, false);
      return b;
    },
    change(id, patch, { save = 'now' } = {}) {
      const b = board.get(id);
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
    select: (id) => select(id ? [id] : []),
    setSelection: (ids) => select(ids),
    toggle(id) { if (sel.has(id)) select([...sel].filter((x) => x !== id)); else select([...sel, id]); },
    marquee: (r) => renderer.marquee(r),
    many: () => many,
    blocksIn: (r) => blocksIn(r),
    edit: (id, o) => edit(id, o),
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
      if (!WB_PALETTE_BY_ID.has(v)) return;
      next.fill = v;
      if (!quiet) note(`Fill colour: ${WB_PALETTE_BY_ID.get(v).label}.`); // taken from a block: say which
      if (lastSwatch) showSwatch(lastSwatch);
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
    renderer.swatch(at, WB_PALETTE_BY_ID.get(nextFill()).token);
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
  // then them, each with its own id.
  function remove(id) {
    const b = board.get(id);
    if (!b) return;
    if (drafts.has(id)) { ctx.discard(id); return; }
    if (!policy.canDelete(b)) return;
    for (const c of connectorsOf(id)) remove(c);
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
  function removeMany(ids) { for (const id of ids) remove(id); }
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
    }
    sweepSoon();
    updateStatus();
  }
  // One note at a time: a change to many blocks that is refused is refused once for each, and is said once.
  let noted = { text: '', t: 0 };
  function note(text) {
    const now = Date.now();
    if (text === noted.text && now - noted.t < 5000) return;
    noted = { text, t: now };
    host.ui.toast(text).catch(() => {});
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
    updateStatus();
  }

  const sync = createSync({ host, board: WB_BOARD, clean: wbClean, onRemote, onReload: reload, onRefused, onBusy });

  // ---- selecting and editing ----------------------------------------------------------------------------------------
  let deleteButton = null;
  let addCanConnect = false; // the +'s "Connect the 2 picked blocks" is on
  // Pick exactly these blocks (an array of ids; [] or null for none).
  function select(ids) {
    sel.clear();
    for (const id of ids || []) if (board.has(id)) sel.add(id);
    renderer.select([...sel], handlesOf(one()));
    const can = [...sel].some((id) => policy.canDelete(board.get(id)));
    if (can && !deleteButton) deleteButton = host.ui.toolbarButton({ id: 'delete', label: 'Delete', icon: 'trash', iconOnly: true, onClick: () => removeMany([...sel]) });
    if (!can && deleteButton) { deleteButton.destroy(); deleteButton = null; }
    if (Boolean(pair()) !== addCanConnect) setAdd();
    updateStatus();
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
      const box = blockTypes.get(b.type).box(b);
      const el = renderer.element(b.id);
      const h = box.h === null ? (el ? el.offsetHeight : 0) : box.h;
      const bx = b.x + box.x; const by = b.y + box.y;
      if (bx <= x1 && bx + box.w >= x0 && by <= y1 && by + h >= y0) out.push(b.id);
    }
    return out;
  }

  // The handles the one picked block shows: its type's (resize), only with Select and only to someone who may change it.
  function handlesOf(id) {
    const b = id && board.get(id);
    const def = b && blockTypes.get(b.type);
    if (!def || !def.resize || tool.id !== 'select' || !(drafts.has(id) || policy.canChange(b))) return null;
    return def.resize.handles;
  }

  function edit(id, { fresh = false } = {}) {
    const b = board.get(id);
    const def = b && blockTypes.get(b.type);
    const el = renderer.element(id);
    if (!def || !el || !def.edit) return;
    if (!drafts.has(id) && !policy.canChange(b)) return;
    if (editing) { const e = editing; editing = null; e.finish(true); }
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
    }, { grow: b.type === 'text', line: Boolean(def.textLine), label: def.textLabel || 'Words', max: def.textMax || 0 });
    editing = { id, finish: handle.finish, fresh };
  }

  // ---- the host's bands: the tools, the colour and zoom menus, the +, the status line -----------------------------
  // The tools are one switch; a tool marked `apart` (the Hand, the Timer) is its own on/off button beside it (the switch
  // holds 8), and the tools of a group (Flowchart: the Connector and the flowchart shapes; Paint: Fill, the Marker and the
  // Brush) are the choices of one button's menu after it, the button on while one of them is the tool. A group's menu may
  // offer a tool from the switch too (it is in its `order`: Paint offers the Pen). `split`: a line after that many choices.
  const allowed = tools.list().filter((t) => policy.canUseTool(t));
  const inSwitch = allowed.filter((t) => !t.apart && !t.group);
  const GROUPS = [
    { id: 'paint', label: 'Paint', icon: 'paintbrush', order: ['fill', 'pen', 'marker', 'brush'], split: 1 },
    { id: 'flowchart', label: 'Flowchart', icon: 'diagram-project', order: ['connector', 'rect', 'rounded', 'diamond', 'pill', 'parallelogram'], split: 1 },
  ];
  const toolSwitch = inSwitch.length > 1
    ? host.ui.viewSwitch({ id: 'tool', value: tool.id, options: inSwitch.map((t) => ({ id: t.id, label: t.label, icon: t.icon })), onChange: (v) => setTool(v) })
    : null;
  // An apart tool's button and its key turn it on, and again off, back to the tool used before it.
  let toolBefore = 'select';
  const toggleTool = (t) => setTool(tool === t ? toolBefore : t.id);
  const apartButtons = allowed.filter((t) => t.apart).map((t) => ({
    tool: t,
    button: host.ui.toolbarButton({ id: `tool-${t.id}`, label: withKey(t.label, t.key.toUpperCase()), icon: t.icon, iconOnly: true, on: false, onClick: () => toggleTool(t) }),
  }));
  const groupButtons = GROUPS.map((g) => {
    const list = g.order.map((id) => allowed.find((t) => t.id === id)).filter(Boolean);
    if (!list.some((t) => t.group === g.id)) return null;
    const menu = (e) => host.menu.show({
      id: `tools-${g.id}`,
      at: { x: e && Number.isFinite(e.x) ? e.x : 100000, y: 4 },
      items: [
        { heading: g.label },
        ...list.flatMap((t, i) => [
          ...(i > 0 && i === g.split ? [{ separator: true }] : []),
          // The Fill row's icon is in the colour it fills with.
          { id: t.id, label: t.label, icon: t.icon, ...(t.paints === 'fill' ? { iconColor: WB_PALETTE_BY_ID.get(nextFill()).token, tip: `${t.label}: ${WB_PALETTE_BY_ID.get(nextFill()).label}` } : {}), hint: t.key ? keyHint(t.key.toUpperCase()) : undefined, current: tool === t, ariaLabel: tool === t ? `${t.label}, chosen` : undefined, onClick: () => setTool(t.id) },
        ]),
      ],
    });
    return { group: g, button: host.ui.toolbarButton({ id: `tools-${g.id}`, label: g.label, icon: g.icon, iconOnly: true, on: false, onClick: menu }) };
  }).filter(Boolean);
  const showTool = () => {
    if (toolSwitch) toolSwitch.set(tool.apart || tool.group ? '' : tool.id);
    for (const a of apartButtons) a.button.set({ on: a.tool === tool });
    for (const g of groupButtons) g.button.set({ on: tool.group === g.group.id });
  };
  function setTool(id) {
    const next = tools.get(id);
    if (!next || !policy.canUseTool(next) || next === tool) { showTool(); return; }
    if (tool.deactivate) tool.deactivate(ctx);
    if (next.apart && !tool.apart) toolBefore = tool.id;
    tool = next;
    if (tool.activate) tool.activate(ctx);
    surface.dataset.tool = tool.id;
    surface.style.cursor = tool.cursor || '';
    renderer.select([...sel], handlesOf(one()));
    showTool();
    updateHint();
  }
  surface.dataset.tool = tool.id;
  surface.setAttribute('aria-label', boardHelp());

  // ---- colours, widths and layers ----------------------------------------------------------------------------------
  // The Colour and Width menus change the picked blocks (each that has that colour or a width), or, with none picked, what
  // new blocks get (for the active tool's block type when it makes one). The current choice is the marked row; with
  // several blocks that differ, no row is marked. Each change is one whole save of each block.
  const toolbarAt = (e) => ({ at: { x: e && Number.isFinite(e.x) ? e.x : 100000, y: 4 } });
  const NAMED = { none: { label: 'None', icon: 'ban' }, auto: { label: 'Matching', icon: 'circle-half-stroke' } };
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
    const c = WB_PALETTE_BY_ID.get(id);
    return c ? { icon: 'circle', iconColor: c.token } : { icon: 'circle', regular: true };
  };
  const defOf = (b) => blockTypes.get(b.type);
  const nounOf = (b) => { const def = defOf(b); return def.noun ? def.noun(b) : def.label.toLowerCase(); };
  // The one value every block has, or undefined when they differ.
  const agreed = (list, field) => { const vals = new Set(list.map((b) => b[field])); return vals.size === 1 ? [...vals][0] : undefined; };
  // Whose colours a menu shows: "this note", "the 3 picked blocks", "the Pen tool" (what it draws next), "new blocks".
  const whoseOf = (list, def) => (list.length > 1 ? `the ${list.length} picked blocks` : list.length ? `this ${nounOf(list[0])}` : def ? `the ${tool.label} tool` : 'new blocks');
  const nameOf = (id) => (id === undefined ? 'Mixed' : NAMED[id] ? NAMED[id].label : WB_PALETTE_BY_ID.has(id) ? WB_PALETTE_BY_ID.get(id).label : 'Usual');

  function colourMenu(where, only) {
    const list = targets(only);
    if (!list.length && tool.paints === 'fill') {
      // The Fill tool's colour (the fill new blocks get too): the palette, the current one marked.
      const now = nextFill();
      const rows = WB_PALETTE.map((c) => choiceRow(c.id, c.label, now, () => ctx.setNextFill(c.id, { quiet: true }), swatch(c.id)));
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
          if (WB_PALETTE_BY_ID.has(v)) next[role.id] = v;
        };
        const rows = extras.map((v) => choiceRow(v, NAMED[v].label, now, pick(v), swatch(v)));
        for (const c of WB_PALETTE) rows.push(choiceRow(c.id, c.label, now, pick(c.id), swatch(c.id)));
        const same = new Set(having.map((b) => b.type)).size === 1 ? defOf(having[0]) : null;
        return { role, label: roleLabel(same, role), now, rows };
      }).filter(Boolean);
    } else {
      // For new blocks: "Usual" and the palette.
      groups = WB_ROLES.filter((role) => !def || takesNext(def, role.id)).map((role) => {
        const now = next[role.id];
        const usual = def ? def.create()[role.id] : null;
        const pick = (v) => () => { next[role.id] = v; };
        const rows = [choiceRow(null, 'Usual', now, pick(null), { ...swatch(usual), hint: usual ? nameOf(usual) : '' })];
        for (const c of WB_PALETTE) rows.push(choiceRow(c.id, c.label, now, pick(c.id), swatch(c.id)));
        return { role, label: roleLabel(def, role), now: now === null ? usual : now, rows };
      });
    }
    if (!groups.length) return;
    const whose = whoseOf(list, def);
    const prep = list.length ? 'of' : 'for';
    const items = groups.length === 1
      ? [{ heading: groups[0].role.id === 'ink' ? `Colour of the words ${prep} ${whose}` : `Colour ${prep} ${whose}` }, ...groups[0].rows]
      : [{ heading: `Colours ${prep} ${whose}` }, ...groups.map((g) => ({ id: g.role.id, label: g.label, hint: nameOf(g.now), ...swatch(g.now), items: g.rows }))];
    host.menu.show({ id: 'colour', ...where, items });
  }

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
    const brushOf = list.length === 1 ? (list[0].type === 'stroke' ? list[0].brush : null) : !list.length && def && def.type === 'stroke' && tool.usual ? tool.usual.brush : null;
    const now = list.length ? agreed(list, 'weight') : nextWeightOf(brushOf);
    const pick = (v) => () => {
      for (const b of list) ctx.change(b.id, { weight: v }, { save: 'now' });
      if (!list.length || (list.length === 1 && takesNext(def, 'weight'))) setNextWeight(brushOf, v);
    };
    const lines = (t) => t === 'line' || t === 'stroke' || t === CONNECTOR;
    const border = list.length ? !list.every((b) => lines(b.type)) : def && !lines(def.type);
    const whose = list.length || def ? whoseOf(list, def) : 'new lines and borders';
    const items = [{ heading: `${border ? 'Border width' : 'Width'} ${list.length ? 'of' : 'for'} ${whose}` }];
    const samples = []; // the weight each choice row draws, in row order
    if (!list.length) {
      const usual = def ? (tool.makes === def.type && tool.usual && tool.usual.weight) || def.create().weight : null;
      items.push(choiceRow(null, 'Usual', now, pick(null), { hint: usual ? wbWeightName(usual) : '' }));
      samples.push(usual);
    }
    for (const w of WB_WEIGHTS) { items.push(choiceRow(w, wbWeightName(w), now, pick(w))); samples.push(w); }
    if (list.some((b) => b.stroke === 'none')) items.push({ separator: true }, { label: 'Pick a border colour to show it', disabled: true });
    host.menu.show({ id: 'width', className: 'wb-width-menu', ...where, items });
    // The menu has no picture slot but an icon, so each choice row gets a small line drawn at its weight.
    const menu = surface.getRootNode().querySelector('.wb-width-menu');
    if (menu) [...menu.querySelectorAll('.sdk-menu-item:not(:disabled)')].forEach((row, i) => {
      if (!samples[i]) return;
      const line = document.createElement('span');
      line.className = 'wb-width-sample';
      line.setAttribute('aria-hidden', 'true');
      line.style.setProperty('--sample', `${samples[i]}px`);
      row.insertBefore(line, row.firstChild);
    });
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
  function lineMenu(where, only) {
    const list = connectorsIn(only);
    if (!list.length && targets(only).length) {
      host.menu.show({ id: 'line', ...where, items: [{ label: 'Pick a connector to change its line style', disabled: true }] });
      return;
    }
    const whose = list.length > 1 ? `the ${list.length} picked connectors` : list.length ? 'this connector' : 'new connectors';
    host.menu.show({ id: 'line', ...where, items: [{ heading: `Line ${list.length ? 'of' : 'for'} ${whose}` }, ...lineGroups(list)] });
  }

  // Layers: one write moves a block (its z put between its new neighbours, lib-a's wbBetween). Only when two neighbours'
  // z are too close to split is every block numbered again, once. Several picked blocks move together and keep their
  // order among themselves: to the front or back as a stack, a layer up or down each past the next block not picked.
  function boxOf(b) {
    const el = renderer.element(b.id);
    return el ? { x0: el.offsetLeft, y0: el.offsetTop, x1: el.offsetLeft + el.offsetWidth, y1: el.offsetTop + el.offsetHeight } : null;
  }
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
  // a field someone else has changed since keeps their change, and so do the fields its block type links with it
  // (wbMergeBack); a block whose every such field someone else changed is left as it is. A block someone else deleted
  // since, which the step needs, is left out, and so is a connector whose block is gone. The person is told once, of both
  // when both happened (wbUndoNote). A block this person deleted comes back whole, with its own id, before the connectors
  // attached to it. The work is lib-g's (wbApplyChanges); this hands it the board.
  let undoButton = null;
  let redoButton = null;
  function historyButtons() {
    if (undoButton) undoButton.set({ disabled: !history.canUndo() });
    if (redoButton) redoButton.set({ disabled: !history.canRedo() });
  }
  function applyChanges(list) {
    const r = wbApplyChanges(list, {
      get: (id) => board.get(id),
      remove,
      put: (b) => commit(b, 'now'),
      canChange: (b) => policy.canChange(b),
      canCreate: () => policy.canCreate(),
      clean: wbClean,
      linkedOf: (b) => { const def = blockTypes.get(b.type); return (def && def.linked) || []; },
      pointsAt: (b) => { const def = blockTypes.get(b.type); return Boolean(def && def.refs); },
      missing: (b) => missingRefs(b).length > 0,
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
    if (!history || down !== null) return; // not in the middle of a drag or a stroke
    if (editing) { const ed = editing; editing = null; ed.finish(true); }
    const r = which === 'undo' ? history.undo(applyChanges) : history.redo(applyChanges);
    const told = wbUndoNote(r);
    if (told) note(told);
    historyButtons();
  }

  if (policy.canEdit) {
    undoButton = host.ui.toolbarButton({ id: 'undo', label: withKey('Undo', `${MOD} Z`), icon: 'rotate-left', iconOnly: true, disabled: true, onClick: () => { undoRedo('undo'); if (!history.canUndo()) keepKeyboard(); } });
    redoButton = host.ui.toolbarButton({ id: 'redo', label: withKey('Redo', `${MOD} Shift Z`), icon: 'rotate-right', iconOnly: true, disabled: true, onClick: () => { undoRedo('redo'); if (!history.canRedo()) keepKeyboard(); } });
    host.ui.toolbarButton({ id: 'colour', label: 'Colour', icon: 'palette', iconOnly: true, onClick: (e) => colourMenu(toolbarAt(e)) });
    host.ui.toolbarButton({ id: 'width', label: 'Width', icon: 'grip-lines', iconOnly: true, onClick: (e) => widthMenu(toolbarAt(e)) });
    if (tools.get('connector') && policy.canUseTool(tools.get('connector'))) host.ui.toolbarButton({ id: 'line', label: 'Line style and arrowheads', icon: 'stairs', iconOnly: true, onClick: (e) => lineMenu(toolbarAt(e)) });
  }
  host.ui.toolbarButton({
    id: 'zoom', label: 'Zoom', icon: 'magnifying-glass', iconOnly: true,
    onClick: (e) => host.menu.show({
      id: 'zoom',
      at: { x: e && Number.isFinite(e.x) ? e.x : 100000, y: 4 },
      items: [
        { id: 'in', label: 'Zoom in', icon: 'magnifying-glass-plus', hint: keyHint('+'), onClick: () => { renderer.zoomBy(1.25); updateStatus(); } },
        { id: 'out', label: 'Zoom out', icon: 'magnifying-glass-minus', hint: keyHint('-'), onClick: () => { renderer.zoomBy(0.8); updateStatus(); } },
        { id: 'fit', label: 'Show everything', icon: 'expand', hint: keyHint('0'), onClick: () => { renderer.fit(); updateStatus(); } },
        { id: 'actual', label: 'Actual size', icon: 'magnifying-glass', onClick: () => { renderer.reset(); updateStatus(); } },
      ],
    }),
  });

  // On a touch screen one finger on the board moves it; "Select many" makes it pick instead (lib-f-tool-select.js).
  if (window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches) {
    const manyButton = host.ui.toolbarButton({
      id: 'many', label: 'Select many', icon: 'object-group', iconOnly: true, on: false,
      onClick: () => { many = !many; manyButton.set({ on: many }); },
    });
  }

  // ---- copy, cut, paste and duplicate -----------------------------------------------------------------------------------
  // Only for someone who may change the board. The copies are new blocks: new ids, saved as this person's, on top of
  // everything (in the order the originals were), a step along each time (lib-h), and picked once they are there. Each is
  // saved whole, like any new block; a copy the server refuses (the module's storage is full) is taken off again and the
  // person told once (onRefused).
  const clipboard = createClipboard();
  // A connector that is not drawn (its block is gone) is never copied.
  const copyable = () => [...sel].map((id) => board.get(id)).filter((b) => b && !drafts.has(b.id) && !missingRefs(b).length);
  // What a copy holds: the picked blocks and every connector whose blocks are all among them (picked or not); a picked
  // connector with an end on a block left out has that end made a free point where it is drawn now (its type's loosen).
  function copySet() {
    const list = copyable();
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
  // The box round some blocks, in board units (a block whose height follows its words counts as one line high).
  function boundsOf(blocks) {
    const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const b of blocks) {
      const def = blockTypes.get(b.type);
      if (def.attached && def.refs(b).length === 2) continue; // where it runs follows its blocks
      const box = def.box(b);
      const x = (b.x || 0) + box.x; const y = (b.y || 0) + box.y;
      r.x0 = Math.min(r.x0, x); r.y0 = Math.min(r.y0, y); r.x1 = Math.max(r.x1, x + box.w); r.y1 = Math.max(r.y1, y + (box.h === null ? 32 : box.h));
    }
    if (!Number.isFinite(r.x0)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
    return r;
  }
  // Cut is a copy and a delete: the connectors attached to what is cut go too (the ones between them are in the copy).
  function copy({ cut = false } = {}) {
    if (!policy.canEdit || !copyable().length) return;
    const list = copySet();
    clipboard.copy(list, { cut });
    if (cut) removeMany(list.map((b) => b.id));
    setAdd();
  }
  function placeCopies(copies) {
    if (!policy.canCreate() || !copies.length) return;
    const top = Math.floor(board.topZ());
    const made = [];
    copies.forEach((c, i) => { const b = wbClean({ ...c, z: top + 1 + i }); if (b) { commit(b, 'now'); made.push(b.id); } });
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
  const clipRows = (at) => [
    { id: 'cut', label: 'Cut', icon: 'scissors', hint: keyHint(`${MOD} X`), onClick: () => copy({ cut: true }) },
    { id: 'copy', label: 'Copy', icon: 'copy', hint: keyHint(`${MOD} C`), onClick: () => copy() },
    { id: 'paste', label: 'Paste', icon: 'paste', hint: keyHint(`${MOD} V`), disabled: !clipboard.has(), onClick: () => paste(at) },
    { id: 'duplicate', label: 'Duplicate', icon: 'clone', hint: keyHint(`${MOD} D`), onClick: () => duplicate() },
  ];

  // ---- timers -------------------------------------------------------------------------------------------------------------
  // What a timer's controls do (lib-e-block-timer.js): Start, Pause and Reset are one write and one undo step each, and
  // anyone who may change the board may use them on any timer. The length menu sets a new length (the timer stops and
  // waits at it), Custom asks for minutes and seconds, and Mute keeps this person's timers quiet in this browser. A
  // timer reaching zero while the page watches is said once and, unless muted, plays one short soft tone (only once the
  // person has pressed or typed on the page: browsers play no sound before that; where it cannot play it is skipped).
  const timerDef = blockTypes.get('timer');
  const MUTE_KEY = 'whiteboard-timer-mute';
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* no storage: not muted */ }
  timerDef.now = () => sync.now();
  timerDef.controls = (b) => policy.canChange(b);
  timerDef.icon = (name) => iconSvg(name);
  timerDef.say = (text) => say(text);
  timerDef.done = () => { say('Time is up.'); if (!muted) chime(); };
  timerDef.act = (id, what, button) => {
    const b = board.get(id);
    if (!b || b.type !== 'timer' || !policy.canChange(b)) return;
    const now = sync.now();
    if (what === 'start') ctx.change(id, wbTimerStart(b, now));
    else if (what === 'pause') ctx.change(id, wbTimerPause(b, now));
    else if (what === 'reset') ctx.change(id, wbTimerReset(b));
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
    const set = (secs) => () => { const now = board.get(id); if (now && policy.canChange(now)) ctx.change(id, wbTimerSetLength(secs)); };
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
    if (b && policy.canChange(b)) ctx.change(b.id, wbTimerSetLength(total));
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
  // with a placeholder where it will be, and becomes an image block once its upload is there, saved once, one undo step.
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
    onPlaced(job, file) {
      renderer.pending(job.id, null);
      if (!policy.canCreate()) { pictures.forget(file.id, (u) => board.all().some((b) => b.upload === u)); updateStatus(); return; }
      const def = blockTypes.get('image');
      const b = wbClean({ ...def.create(), id: job.id, type: 'image', x: job.box.x, y: job.box.y, w: job.box.w, h: job.box.h, upload: file.id, z: Math.floor(board.topZ()) + 1 });
      if (!b) { updateStatus(); return; }
      commit(b, 'now'); // saved once, the upload there already: one step of the undo history
      // Picked, with the others added along with it, unless the person has picked something else meanwhile.
      const batch = job.batch;
      if (batch) {
        const same = sel.size === batch.picked.length && batch.picked.every((id) => sel.has(id));
        batch.made.push(b.id);
        if (same) select(batch.made.slice());
        batch.picked = [...sel];
      }
      updateStatus();
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
    pictures.add(list, at || renderer.center(), { batch: { made: [], picked: [...sel] } });
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
      if (id === 'paste') { paste(); return; }
      if (id === 'picture') { if (pictures) $('picker').click(); return; }
      if (id === 'connect') { connectPicked(); return; }
      const def = blockTypes.get(id);
      if (!def || def.attached) return;
      const c = renderer.center();
      const box = def.box({ ...def.create(), x: 0, y: 0 });
      const b = ctx.draft(id, { x: c.x - box.w / 2, y: c.y - (box.h || 24) / 2 });
      select(b.id);
      if (def.edit !== 'text') { ctx.save(b.id); renderer.element(b.id).focus({ preventScroll: true }); return; }
      // After the host's menu has closed and handed the focus back to the +, or that would end the editing at once.
      setTimeout(() => { if (board.has(b.id)) edit(b.id, { fresh: true }); }, 60);
    });
  }

  let statusFrame = 0;
  function updateStatus() {
    if (statusFrame) return;
    statusFrame = requestAnimationFrame(() => {
      statusFrame = 0;
      const n = board.size - drafts.size;
      const items = [{ text: n === 1 ? '1 block' : `${n} blocks`, icon: 'shapes' }];
      if (sel.size > 1) items.push({ text: `${sel.size} selected` });
      const coming = pictures ? pictures.count : 0;
      if (coming) items.push({ text: coming === 1 ? 'Adding a picture' : `Adding ${coming} pictures`, icon: 'image' });
      if (!policy.canEdit) items.push({ text: 'View only', title: 'You can look and move around, not change the board' });
      items.push({ text: `${Math.round(renderer.view.s * 100)}%`, quiet: true, end: true, title: 'Zoom' });
      if (host.status) host.status.set(items).catch(() => {});
      updateHint();
    });
  }
  function updateHint() {
    const hint = $('hint');
    hint.hidden = board.size > 0 || Boolean(pictures && pictures.count);
    if (hint.hidden) return;
    hint.textContent = !policy.canEdit ? 'Nothing on the board yet.'
      : tool.id === 'select' || tool.id === 'hand' ? `Pick a tool above, then click the board.${pictures ? ' Or paste or drop a picture here.' : ''}`
        : tool.makes === 'stroke' ? 'Press and drag to draw.'
          : tool.id === 'fill' ? KEYS ? `Click a block to fill it. ${ALT}-click one to take its colour.` : 'Tap a block to fill it.'
            : tool.id === 'connector' ? 'Press on a block and drag to another to join them.' : 'Click the board to put it there.';
  }

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
  // on Windows it asks after the release. A right drag opens no menu.
  let spaceHeld = false;
  let panning = null;
  const RIGHT_SLOP = 4; // screen pixels a right press may wander and still be a click (the select tool's SLOP)
  let rightDragEnd = -Infinity; // when the last right drag ended: the menu the browser asks for after it is not shown
  const panCursor = (on) => { surface.classList.toggle('wb-grab', on); };
  const pointOf = (e) => ({ ...renderer.toBoard(e.clientX, e.clientY), id: renderer.blockAt(e.target), handle: renderer.handleAt(e.target), pointerType: e.pointerType, event: e });
  const twoFingers = () => {
    const [a, b] = [...pointers.values()];
    return { d: Math.max(1, Math.hypot(a.sx - b.sx, a.sy - b.sy)), mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 };
  };

  // A control on a block (a timer's buttons) is a button of its own: the board leaves its presses and keys alone.
  const onControl = (e) => Boolean(e.target && e.target.closest && e.target.closest('.wb-ctl'));
  surface.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.wb-text-edit') || onControl(e)) return;
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
    // A press while words are being edited only ends the editing: it does not also draw or put a block there.
    if (editing) { const ed = editing; editing = null; ed.finish(true); surface.focus({ preventScroll: true, focusVisible: false }); return; }
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
      if (was.right && was.moved) rightDragEnd = performance.now();
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
    // A right press still down may yet be a drag: its menu waits for the release. One just after a right drag is not shown.
    if (panning && panning.right) { panning.menu = { target: panning.target, clientX: e.clientX, clientY: e.clientY }; return; }
    if (performance.now() - rightDragEnd < 500) { rightDragEnd = -Infinity; return; }
    contextMenu(e);
  });
  function contextMenu(e) {
    const id = renderer.blockAt(e.target) || (renderer.handleAt(e.target) ? one() : null); // a handle is its block's
    const box = host.rootElement.getBoundingClientRect();
    const at = { x: e.clientX - box.left, y: e.clientY - box.top };
    if (!id) {
      if (!policy.canEdit) return;
      const there = renderer.toBoard(e.clientX, e.clientY);
      host.menu.show({
        id: 'board',
        at,
        items: [
          { id: 'paste', label: 'Paste here', icon: 'paste', hint: keyHint(`${MOD} V`), disabled: !clipboard.has(), onClick: () => paste({ x: there.x, y: there.y }) },
          { id: 'all', label: 'Select all', icon: 'object-group', hint: keyHint(`${MOD} A`), disabled: board.size === 0, onClick: () => selectAll() },
        ],
      });
      return;
    }
    if (!sel.has(id)) select([id]);
    const ids = [...sel];
    const list = targets();
    const links = ids.length === 1 ? linkRows(id) : [];
    if (!list.length) {
      // Someone who may only look: the links, if there are any.
      if (links.length) host.menu.show({ id: 'block', at, items: links });
      return;
    }
    const single = list.length === 1 ? list[0] : null;
    const def = single && defOf(single);
    const lines = connectorsIn();
    host.menu.show({
      id: 'block',
      at,
      items: [
        ...(def && def.edit === 'text' ? [{ id: 'edit', label: def.editLabel || 'Edit', icon: 'pen', hint: keyHint('Enter'), onClick: () => edit(single.id) }] : []),
        { id: 'colour', label: 'Colour', icon: 'palette', onClick: () => { setTimeout(() => colourMenu({ at }), 0); } },
        ...(list.some((b) => defOf(b).weight) ? [{ id: 'width', label: 'Width', icon: 'grip-lines', onClick: () => { setTimeout(() => widthMenu({ at }), 0); } }] : []),
        ...(lines.length ? lineGroups(lines) : []),
        ...links,
        ...(pair() ? [{ id: 'connect', label: 'Connect them', icon: 'arrows-turn-right', onClick: () => connectPicked() }] : []),
        { heading: 'Layer' },
        ...LAYERS.map((l) => ({ ...l, disabled: !canLayer(ids, l.id), onClick: () => layer(ids, l.id) })),
        { separator: true },
        ...clipRows(null),
        { separator: true },
        { id: 'delete', label: list.length > 1 ? `Delete ${list.length} blocks` : 'Delete', icon: 'trash', hint: keyHint('Delete'), danger: true, onClick: () => removeMany(ids) },
      ],
    });
  }

  // ---- the keyboard -----------------------------------------------------------------------------------------------------
  // Tab reaches the board and then each block in turn; a block that takes the focus is selected (alone, unless it is one
  // of those picked already).
  surface.addEventListener('focusin', (e) => {
    const id = renderer.blockAt(e.target);
    if (id && !pointerFocus && !sel.has(id) && !e.target.closest('.wb-text-edit')) select([id]);
  });
  surface.addEventListener('keydown', (e) => {
    if (e.target.closest('.wb-text-edit') || e.altKey) return;
    if (onControl(e) && e.key !== 'Escape' && e.key !== 'Tab') return;
    if (e.key === ' ') { e.preventDefault(); if (!spaceHeld) { spaceHeld = true; panCursor(true); } return; } // held: drag moves the board
    const picked = targets(); // the picked blocks this person may change
    const b = one() && board.get(one());
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && k.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
    // Undo: Ctrl or Cmd Z; redo: with Shift, or Ctrl Y.
    const zy = mod ? (e.code === 'KeyZ' || k.toLowerCase() === 'z' ? 'z' : e.code === 'KeyY' || k.toLowerCase() === 'y' ? 'y' : '') : '';
    if (zy && history) { e.preventDefault(); undoRedo(zy === 'z' && !e.shiftKey ? 'undo' : 'redo'); return; }
    // Copy, cut, paste and duplicate (by the key's place too, so any keyboard layout).
    const letter = mod && !e.shiftKey ? (e.code && e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : k.toLowerCase()) : '';
    if (letter && 'cxvd'.includes(letter) && policy.canEdit) {
      if (letter === 'd') { e.preventDefault(); duplicate(); return; }
      // Copy, cut and paste go through the browser's own copy, cut and paste events (below), so a picture on the
      // computer's clipboard reaches a paste; where the browser sends none, the board does it a moment later.
      clipKey(letter);
      return;
    }
    if ((k === 'Delete' || k === 'Backspace') && picked.length) { e.preventDefault(); removeMany(picked.map((x) => x.id)); surface.focus({ preventScroll: true }); return; }
    if (k === 'Escape') {
      if (tool.id !== 'select') setTool('select'); else select(null);
      surface.focus({ preventScroll: true });
      return;
    }
    if (k === 'Enter' && b) { e.preventDefault(); edit(b.id); return; }
    if (k.startsWith('Arrow') && picked.length && !mod) {
      e.preventDefault();
      const step = e.shiftKey ? 1 : 10;
      const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
      const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
      if (history) history.tag(`nudge:${picked.map((x) => x.id).sort().join(',')}`); // a run of presses is one step
      for (const x of picked) ctx.change(x.id, wbMoved(x, dx, dy), { save: 'soon' });
      return;
    }
    if (mod) return;
    // ] forward one layer, [ back one; with Shift, to the front and to the back (by the key's place, so any keyboard layout).
    const bracket = e.code === 'BracketRight' || k === ']' || k === '}' ? 'up' : e.code === 'BracketLeft' || k === '[' || k === '{' ? 'down' : null;
    if (bracket && picked.length) {
      e.preventDefault();
      const ends = e.shiftKey || k === '}' || k === '{';
      layer(picked.map((x) => x.id), bracket === 'up' ? (ends ? 'front' : 'forward') : (ends ? 'back' : 'backward'));
      return;
    }
    if (k === '+' || k === '=') { renderer.zoomBy(1.25); updateStatus(); return; }
    if (k === '-') { renderer.zoomBy(0.8); updateStatus(); return; }
    if (k === '0') { renderer.fit(); updateStatus(); return; }
    const t = allowed.find((x) => x.key === k.toLowerCase());
    if (t) { e.preventDefault(); if (t.apart) toggleTool(t); else setTool(t.id); }
  });

  // ---- the computer's clipboard, and dropping files -----------------------------------------------------------------------
  // Ctrl or Cmd C, X and V reach the board as the browser's copy, cut and paste events. Copy and cut keep the blocks in
  // this page's clipboard (lib-h) as before and put a mark on the computer's clipboard (CLIP_MARK, no words or picture), so
  // a picture copied elsewhere earlier is no longer there to be pasted instead. A paste that carries picture files and
  // not the mark adds the pictures, where the pointer is over the board or else in the middle of what is in sight;
  // any other paste puts down the copied blocks. A browser that sends no event: the key does it after CLIP_WAIT.
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
    if (inField(e) || !policy.canEdit) return;
    clearTimeout(clipTimer);
    clipTimer = 0;
    if (!copyable().length) return;
    e.preventDefault();
    try { if (e.clipboardData) e.clipboardData.setData(CLIP_MARK, '1'); } catch { /* the page's own clipboard still has them */ }
    copy({ cut });
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
    if (inField(e) || !policy.canEdit) return;
    clearTimeout(clipTimer);
    clipTimer = 0;
    const data = e.clipboardData;
    const ours = Boolean(data && [...(data.types || [])].includes(CLIP_MARK));
    const files = ours ? [] : filesOf(data);
    e.preventDefault();
    if (files.length && pictures) { const p = hover && renderer.toBoard(hover.cx, hover.cy); addPictures(files, p && { x: p.x, y: p.y }); return; }
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
  surface.addEventListener('dragenter', (e) => { if (!pictures || !carriesFiles(e)) return; dragDepth += 1; showDropOver(true); });
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
    if (!pictures) return;
    const p = renderer.toBoard(e.clientX, e.clientY);
    addPictures(filesOf(e.dataTransfer), { x: p.x, y: p.y });
  });

  // ---- the width ------------------------------------------------------------------------------------------------------
  // The module's width, not the window's (a bundled module runs in the page). The stylesheet keys on `.app.narrow`.
  let fitted = false;
  new ResizeObserver(() => {
    const w = host.rootElement.clientWidth;
    $('app').classList.toggle('narrow', w > 0 && w < 520);
    if (!fitted && surface.clientWidth > 0) { fitted = true; renderer.fit(); updateStatus(); }
  }).observe(host.rootElement);
  window.addEventListener('pagehide', () => sync.flush());

  // ---- start ------------------------------------------------------------------------------------------------------------
  host.on('change', (e) => sync.handle(e));
  host.on('changes', (e) => sync.handleMany(e));
  let first;
  try { first = await sync.load(); } catch (err) { showMsg('The whiteboard could not be read', err.message); return; }
  for (const b of first) if (policy.canSee(b)) { known.set(b.id, b); board.put(b); renderer.draw(b); }
  sweepSoon();
  $('loading').hidden = true;
  $('app').hidden = false;
  if (surface.clientWidth > 0) { fitted = true; renderer.fit(); }
  updateStatus();
})();
