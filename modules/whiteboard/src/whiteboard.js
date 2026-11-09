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
  // The key named in hints: Cmd on a Mac, iPhone or iPad, else Ctrl. Keys are named (in menus, in a button's name) only
  // where there is a mouse or a trackpad: on a touch screen alone they are noise.
  const MOD = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '') ? 'Cmd' : 'Ctrl';
  const KEYS = Boolean(window.matchMedia && window.matchMedia('(any-pointer: fine)').matches);
  const keyHint = (keys) => (KEYS ? keys : undefined);
  const withKey = (label, keys) => (KEYS ? `${label} (${keys})` : label);
  // The board's spoken help: the keys in this device's words (Command on a Mac), and only where there is a mouse or a
  // trackpad, as in the buttons' names; on a touch screen alone, what a finger does. MOVE_HELP is how the board moves.
  const MOVE_HELP = 'Hold the spacebar and drag, or pick the Hand tool (H), to move the board.';
  const boardHelp = () => {
    if (!KEYS) return 'Whiteboard. Tap a block to pick it and drag it to move it; press it long for more. Drag the board with one finger to move it, pinch to zoom.';
    const M = MOD === 'Cmd' ? 'Command' : 'Ctrl';
    return `Whiteboard. Tab moves through the blocks; Enter edits one, the arrow keys move what is selected, Delete takes it away. Shift-click adds a block to the selection, ${M} A selects all, Escape clears. ${M} C, X, V and D copy, cut, paste and duplicate; ${M} Z undoes, ${M} Shift Z redoes. ${MOVE_HELP}`;
  };
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
      const own = def.create();
      for (const role of Object.keys(next)) if (next[role] !== null && takesNext(def, role)) own[role] = next[role];
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
    save(id) { const b = board.get(id); if (b) { persist(b, 'now'); updateStatus(); } },
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
  };

  function release(id) {
    held.delete(id);
    const w = waiting.get(id);
    waiting.delete(id);
    if (w) onRemote(w);
  }

  function remove(id) {
    const b = board.get(id);
    if (!b) return;
    if (drafts.has(id)) { ctx.discard(id); return; }
    if (!policy.canDelete(b)) return;
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
    updateStatus();
  }

  const sync = createSync({ host, board: WB_BOARD, clean: wbClean, onRemote, onReload: reload, onRefused, onBusy });

  // ---- selecting and editing ----------------------------------------------------------------------------------------
  let deleteButton = null;
  // Pick exactly these blocks (an array of ids; [] or null for none).
  function select(ids) {
    sel.clear();
    for (const id of ids || []) if (board.has(id)) sel.add(id);
    renderer.select([...sel], handlesOf(one()));
    const can = [...sel].some((id) => policy.canDelete(board.get(id)));
    if (can && !deleteButton) deleteButton = host.ui.toolbarButton({ id: 'delete', label: 'Delete', icon: 'trash', iconOnly: true, onClick: () => removeMany([...sel]) });
    if (!can && deleteButton) { deleteButton.destroy(); deleteButton = null; }
    updateStatus();
  }
  function selectAll() { select(board.all().filter((x) => !drafts.has(x.id)).map((x) => x.id)); }
  // Every block a rectangle on the board (board units, any two corners) touches, by each block type's box.
  function blocksIn(r) {
    const x0 = Math.min(r.x0, r.x1); const x1 = Math.max(r.x0, r.x1);
    const y0 = Math.min(r.y0, r.y1); const y1 = Math.max(r.y0, r.y1);
    const out = [];
    for (const b of board.all()) {
      if (drafts.has(b.id)) continue;
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
    const handle = wbEditText(el, def.textOf(el), b.text || '', (text) => {
      if (editing && editing.id === id) editing = null;
      const now = board.get(id);
      if (now) {
        if (!text.trim() && def.textEmpty === 'remove') remove(id);
        else if (text !== now.text || drafts.has(id)) ctx.change(id, { text }, { save: 'now' });
        else renderer.draw(now);
      }
      release(id);
      renderer.refreshFrame();
    }, { grow: b.type === 'text' });
    editing = { id, finish: handle.finish, fresh };
  }

  // ---- the host's bands: the tools, the colour and zoom menus, the +, the status line -----------------------------
  // The tools are one switch; a tool marked `apart` (the Hand) is its own on/off button beside it (the switch holds 8).
  const allowed = tools.list().filter((t) => policy.canUseTool(t));
  const inSwitch = allowed.filter((t) => !t.apart);
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
  const showTool = () => {
    if (toolSwitch) toolSwitch.set(tool.apart ? '' : tool.id);
    for (const a of apartButtons) a.button.set({ on: a.tool === tool });
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
    const now = list.length ? agreed(list, 'weight') : next.weight;
    const pick = (v) => () => {
      for (const b of list) ctx.change(b.id, { weight: v }, { save: 'now' });
      if (!list.length || (list.length === 1 && takesNext(def, 'weight'))) next.weight = v;
    };
    const lines = (t) => t === 'line' || t === 'stroke';
    const border = list.length ? !list.every((b) => lines(b.type)) : def && !lines(def.type);
    const whose = list.length || def ? whoseOf(list, def) : 'new lines and borders';
    const items = [{ heading: `${border ? 'Border width' : 'Width'} ${list.length ? 'of' : 'for'} ${whose}` }];
    const samples = []; // the weight each choice row draws, in row order
    if (!list.length) {
      const usual = def ? def.create().weight : null;
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
  // since, which the step needs, is left out. The person is told once, of both when both happened (wbUndoNote). A block
  // this person deleted comes back whole, with its own id. The work is lib-g's (wbApplyChanges); this hands it the board.
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
  const copyable = () => [...sel].map((id) => board.get(id)).filter((b) => b && !drafts.has(b.id));
  // The box round some blocks, in board units (a block whose height follows its words counts as one line high).
  function boundsOf(blocks) {
    const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const b of blocks) {
      const box = blockTypes.get(b.type).box(b);
      const x = b.x + box.x; const y = b.y + box.y;
      r.x0 = Math.min(r.x0, x); r.y0 = Math.min(r.y0, y); r.x1 = Math.max(r.x1, x + box.w); r.y1 = Math.max(r.y1, y + (box.h === null ? 32 : box.h));
    }
    return r;
  }
  function copy({ cut = false } = {}) {
    const list = copyable();
    if (!policy.canEdit || !list.length) return;
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
    placeCopies(wbCopies(copyable(), { newId: () => host.util.id(), dx: WB_PASTE_STEP, dy: WB_PASTE_STEP }));
  }
  const clipRows = (at) => [
    { id: 'cut', label: 'Cut', icon: 'scissors', hint: keyHint(`${MOD} X`), onClick: () => copy({ cut: true }) },
    { id: 'copy', label: 'Copy', icon: 'copy', hint: keyHint(`${MOD} C`), onClick: () => copy() },
    { id: 'paste', label: 'Paste', icon: 'paste', hint: keyHint(`${MOD} V`), disabled: !clipboard.has(), onClick: () => paste(at) },
    { id: 'duplicate', label: 'Duplicate', icon: 'clone', hint: keyHint(`${MOD} D`), onClick: () => duplicate() },
  ];

  // The +: the same blocks, put in the middle of what is in sight (for the keyboard, and for anyone who looks for it there).
  // Paste is there too, greyed until something is copied.
  function setAdd() {
    if (!policy.canEdit || !host.add) return;
    host.add.set([
      { id: 'note', label: 'Add a note', icon: 'note-sticky' },
      { id: 'text', label: 'Add text', icon: 'font' },
      { id: 'rect', label: 'Add a rectangle', icon: 'square' },
      { divider: true },
      { id: 'paste', label: 'Paste', icon: 'paste', hint: keyHint(`${MOD} V`), disabled: !clipboard.has() },
    ]).catch(() => {});
  }
  if (policy.canEdit && host.add) {
    setAdd();
    host.on('add', ({ id }) => {
      if (id === 'paste') { paste(); return; }
      const def = blockTypes.get(id);
      if (!def) return;
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
      if (!policy.canEdit) items.push({ text: 'View only', title: 'You can look and move around, not change the board' });
      items.push({ text: `${Math.round(renderer.view.s * 100)}%`, quiet: true, end: true, title: 'Zoom' });
      if (host.status) host.status.set(items).catch(() => {});
      updateHint();
    });
  }
  function updateHint() {
    const hint = $('hint');
    hint.hidden = board.size > 0;
    if (hint.hidden) return;
    hint.textContent = !policy.canEdit ? 'Nothing on the board yet.'
      : tool.id === 'select' || tool.id === 'hand' ? 'Pick a tool above, then click the board.'
        : tool.id === 'pen' ? 'Press and drag to draw.' : 'Click the board to put it there.';
  }

  // ---- the pointer ------------------------------------------------------------------------------------------------------
  const pointers = new Map(); // pointer id -> its last point on the screen
  let down = null; // the pointer the tool is following
  let pinch = null; // two fingers on the board: { d, s, mx, my }
  let pointerFocus = false; // a press is moving the focus
  // Moving the board with any tool: Space held, or the middle mouse button. { id, lx, ly } while it goes on.
  let spaceHeld = false;
  let panning = null;
  const panCursor = (on) => { surface.classList.toggle('wb-grab', on); };
  const pointOf = (e) => ({ ...renderer.toBoard(e.clientX, e.clientY), id: renderer.blockAt(e.target), handle: renderer.handleAt(e.target), pointerType: e.pointerType, event: e });
  const twoFingers = () => {
    const [a, b] = [...pointers.values()];
    return { d: Math.max(1, Math.hypot(a.sx - b.sx, a.sy - b.sy)), mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 };
  };

  surface.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.wb-text-edit')) return;
    const middle = e.pointerType === 'mouse' && e.button === 1;
    if (e.pointerType === 'mouse' && e.button !== 0 && !middle) return;
    e.preventDefault();
    if ((middle || spaceHeld) && !editing && down === null && !pinch) {
      try { surface.setPointerCapture(e.pointerId); } catch { /* the pointer is gone already */ }
      panning = { id: e.pointerId, lx: e.clientX, ly: e.clientY };
      surface.classList.add('wb-grabbing');
      return;
    }
    // A press while words are being edited only ends the editing: it does not also draw or put a block there.
    if (editing) { const ed = editing; editing = null; ed.finish(true); surface.focus({ preventScroll: true, focusVisible: false }); return; }
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
    if (panning && panning.id === e.pointerId) { panning = null; surface.classList.remove('wb-grabbing'); return; }
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
    const id = renderer.blockAt(e.target);
    const box = host.rootElement.getBoundingClientRect();
    const at = { x: e.clientX - box.left, y: e.clientY - box.top };
    if (!id) {
      e.preventDefault();
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
    e.preventDefault();
    if (!sel.has(id)) select([id]);
    const ids = [...sel];
    const list = targets();
    if (!list.length) return;
    const single = list.length === 1 ? list[0] : null;
    const def = single && defOf(single);
    host.menu.show({
      id: 'block',
      at,
      items: [
        ...(def && def.edit === 'text' ? [{ id: 'edit', label: 'Edit', icon: 'pen', hint: keyHint('Enter'), onClick: () => edit(single.id) }] : []),
        { id: 'colour', label: 'Colour', icon: 'palette', onClick: () => { setTimeout(() => colourMenu({ at }), 0); } },
        ...(list.some((b) => defOf(b).weight) ? [{ id: 'width', label: 'Width', icon: 'grip-lines', onClick: () => { setTimeout(() => widthMenu({ at }), 0); } }] : []),
        { heading: 'Layer' },
        ...LAYERS.map((l) => ({ ...l, disabled: !canLayer(ids, l.id), onClick: () => layer(ids, l.id) })),
        { separator: true },
        ...clipRows(null),
        { separator: true },
        { id: 'delete', label: list.length > 1 ? `Delete ${list.length} blocks` : 'Delete', icon: 'trash', hint: keyHint('Delete'), danger: true, onClick: () => removeMany(ids) },
      ],
    });
  });

  // ---- the keyboard -----------------------------------------------------------------------------------------------------
  // Tab reaches the board and then each block in turn; a block that takes the focus is selected (alone, unless it is one
  // of those picked already).
  surface.addEventListener('focusin', (e) => {
    const id = renderer.blockAt(e.target);
    if (id && !pointerFocus && !sel.has(id) && !e.target.closest('.wb-text-edit')) select([id]);
  });
  surface.addEventListener('keydown', (e) => {
    if (e.target.closest('.wb-text-edit') || e.altKey) return;
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
      e.preventDefault();
      if (letter === 'c') copy(); else if (letter === 'x') copy({ cut: true }); else if (letter === 'v') paste(); else duplicate();
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
      for (const x of picked) ctx.change(x.id, { x: x.x + dx, y: x.y + dy }, { save: 'soon' });
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
  $('loading').hidden = true;
  $('app').hidden = false;
  if (surface.clientWidth > 0) { fitted = true; renderer.fit(); }
  updateStatus();
})();
