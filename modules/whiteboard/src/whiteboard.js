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
  let selected = null;
  let editing = null; // { id, finish }
  let tool = tools.get('select');
  let tint = null; // the colour picked for new blocks; null: each type's own

  // ---- the one path for changes made here -----------------------------------------------------------------------------
  // Every local change lands here: drawn at once, and saved now, soon (after a pause) or not yet (while a drag or a stroke
  // goes on). Undo and redo, when they come, record { before, after } here.
  function commit(next, save) {
    board.put(next);
    renderer.draw(next);
    if (save) persist(next, save);
    updateStatus();
  }
  function persist(b, how) {
    const stamped = { ...b, by: me, at: new Date().toISOString() };
    board.put(stamped);
    drafts.delete(b.id);
    waiting.delete(b.id); // ours is newer than what waited
    if (how === 'soon') sync.saveSoon(stamped); else sync.save(stamped);
  }

  // What tools and block types may ask of the board: they never touch storage or permissions themselves.
  const ctx = {
    policy,
    get: (id) => board.get(id),
    scale: () => renderer.view.s,
    panBy: (dx, dy) => renderer.panBy(dx, dy),
    draft(type, fields) {
      const def = blockTypes.get(type);
      const own = def.create();
      const b = wbClean({ ...own, tint: tint || own.tint, ...fields, id: host.util.id(), type, z: board.topZ() + 1 });
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
      if (selected === id) select(null);
      updateStatus();
    },
    remove: (id) => remove(id),
    select: (id) => select(id),
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
    board.remove(id);
    renderer.remove(id);
    held.delete(id);
    waiting.delete(id);
    sync.remove(id);
    if (selected === id) select(null);
    updateStatus();
  }

  // ---- what comes from elsewhere ------------------------------------------------------------------------------------
  function onRemote(change) {
    if (change.op === 'remove') {
      const { id } = change;
      if (editing && editing.id === id) { const e = editing; editing = null; e.finish(false); }
      held.delete(id);
      waiting.delete(id);
      drafts.delete(id);
      board.remove(id);
      renderer.remove(id);
      if (selected === id) select(null);
    } else {
      const b = change.block;
      if (held.has(b.id)) { waiting.set(b.id, change); return; }
      if (!policy.canSee(b)) return;
      board.put(b);
      renderer.draw(b);
    }
    updateStatus();
  }
  function onRefused(err) {
    const text = err && err.status === 403 ? 'You may not change this whiteboard.' : `That change was not saved. ${(err && err.message) || ''}`.trim();
    host.ui.toast(text).catch(() => {});
  }
  async function reload() {
    let list;
    try { list = await sync.load(); } catch (err) { host.ui.toast('The whiteboard could not be read again. Reload the page.').catch(() => {}); return; }
    if (editing) { const e = editing; editing = null; e.finish(false); }
    board.clear();
    renderer.clear();
    drafts.clear();
    held.clear();
    waiting.clear();
    for (const b of list) { if (!policy.canSee(b)) continue; board.put(b); renderer.draw(b); }
    select(null);
    updateStatus();
  }

  const sync = createSync({ host, board: WB_BOARD, clean: wbClean, onRemote, onReload: reload, onRefused });

  // ---- selecting and editing ----------------------------------------------------------------------------------------
  let deleteButton = null;
  function select(id) {
    selected = id && board.has(id) ? id : null;
    renderer.select(selected);
    const can = Boolean(selected) && policy.canDelete(board.get(selected));
    if (can && !deleteButton) deleteButton = host.ui.toolbarButton({ id: 'delete', label: 'Delete', icon: 'trash', iconOnly: true, onClick: () => { if (selected) remove(selected); } });
    if (!can && deleteButton) { deleteButton.destroy(); deleteButton = null; }
  }

  function edit(id, { fresh = false } = {}) {
    const b = board.get(id);
    const def = b && blockTypes.get(b.type);
    const el = renderer.element(id);
    if (!def || !el || !def.edit) return;
    if (!drafts.has(id) && !policy.canChange(b)) return;
    if (editing) { const e = editing; editing = null; e.finish(true); }
    if (def.edit === 'tint') {
      const r = el.getBoundingClientRect();
      const box = host.rootElement.getBoundingClientRect();
      tintMenu({ at: { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 } }, id);
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
  const allowed = tools.list().filter((t) => policy.canUseTool(t));
  const toolSwitch = allowed.length > 1
    ? host.ui.viewSwitch({ id: 'tool', value: tool.id, options: allowed.map((t) => ({ id: t.id, label: t.label, icon: t.icon })), onChange: (v) => setTool(v) })
    : null;
  function setTool(id) {
    const next = tools.get(id);
    if (!next || !policy.canUseTool(next) || next === tool) { if (toolSwitch) toolSwitch.set(tool.id); return; }
    if (tool.deactivate) tool.deactivate(ctx);
    tool = next;
    if (tool.activate) tool.activate(ctx);
    surface.dataset.tool = tool.id;
    surface.style.cursor = tool.cursor || '';
    if (toolSwitch) toolSwitch.set(tool.id);
    updateHint();
  }
  surface.dataset.tool = tool.id;

  const tokenOf = (id) => (id === 'ink' ? 'var(--text-primary)' : `var(--tint-${id})`);
  function tintMenu(where, only) {
    const target = only || selected;
    const b = target && board.get(target);
    const recolour = b && policy.canChange(b);
    const now = recolour ? b.tint : tint;
    host.menu.show({
      id: 'colour',
      ...where,
      items: [
        { heading: recolour ? 'Colour of this block' : 'Colour of new blocks' },
        ...WB_TINTS.map((c) => ({
          id: c.id,
          label: c.label,
          icon: 'circle',
          iconColor: tokenOf(c.id),
          hint: c.id === now ? 'Chosen' : '',
          onClick: () => {
            tint = c.id;
            if (recolour) ctx.change(b.id, { tint: c.id }, { save: 'now' });
          },
        })),
      ],
    });
  }
  if (policy.canEdit) {
    host.ui.toolbarButton({ id: 'colour', label: 'Colour', icon: 'palette', iconOnly: true, onClick: (e) => tintMenu({ at: { x: e && Number.isFinite(e.x) ? e.x : 100000, y: 4 } }) });
  }
  host.ui.toolbarButton({
    id: 'zoom', label: 'Zoom', icon: 'magnifying-glass', iconOnly: true,
    onClick: (e) => host.menu.show({
      id: 'zoom',
      at: { x: e && Number.isFinite(e.x) ? e.x : 100000, y: 4 },
      items: [
        { id: 'in', label: 'Zoom in', icon: 'magnifying-glass-plus', hint: '+', onClick: () => { renderer.zoomBy(1.25); updateStatus(); } },
        { id: 'out', label: 'Zoom out', icon: 'magnifying-glass-minus', hint: '-', onClick: () => { renderer.zoomBy(0.8); updateStatus(); } },
        { id: 'fit', label: 'Show everything', icon: 'expand', hint: '0', onClick: () => { renderer.fit(); updateStatus(); } },
        { id: 'actual', label: 'Actual size', icon: 'magnifying-glass', onClick: () => { renderer.reset(); updateStatus(); } },
      ],
    }),
  });

  // The +: the same blocks, put in the middle of what is in sight (for the keyboard, and for anyone who looks for it there).
  if (policy.canEdit && host.add) {
    host.add.set([
      { id: 'note', label: 'Add a note', icon: 'note-sticky' },
      { id: 'text', label: 'Add text', icon: 'font' },
      { id: 'rect', label: 'Add a rectangle', icon: 'square' },
    ]).catch(() => {});
    host.on('add', ({ id }) => {
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
      : tool.id === 'select' ? 'Pick a tool above, then click the board.'
        : tool.id === 'pen' ? 'Press and drag to draw.' : 'Click the board to put it there.';
  }

  // ---- the pointer ------------------------------------------------------------------------------------------------------
  const pointers = new Map(); // pointer id -> its last point on the screen
  let down = null; // the pointer the tool is following
  let pinch = null; // two fingers on the board: { d, s, mx, my }
  const pointOf = (e) => ({ ...renderer.toBoard(e.clientX, e.clientY), id: renderer.blockAt(e.target), pointerType: e.pointerType, event: e });
  const twoFingers = () => {
    const [a, b] = [...pointers.values()];
    return { d: Math.max(1, Math.hypot(a.sx - b.sx, a.sy - b.sy)), mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 };
  };

  surface.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.wb-text-edit')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
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
    (el || surface).focus({ preventScroll: true, focusVisible: false }); // the ring is for the keyboard
    if (tool.edits && !policy.canUseTool(tool)) return;
    down = e.pointerId;
    tool.down(p, ctx);
  });
  surface.addEventListener('pointermove', (e) => {
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
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    if (down !== e.pointerId) return;
    down = null;
    if (e.type === 'pointercancel') { if (tool.cancel) tool.cancel(ctx); } else if (tool.up) tool.up(pointOf(e), ctx);
  };
  surface.addEventListener('pointerup', lift);
  surface.addEventListener('pointercancel', lift);
  surface.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = surface.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) renderer.zoomAt(renderer.view.s * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    else renderer.panBy(-e.deltaX, -e.deltaY);
    updateStatus();
  }, { passive: false });

  // Right-click (or a long press) on a block: what can be done with it.
  surface.addEventListener('contextmenu', (e) => {
    const id = renderer.blockAt(e.target);
    if (!id || e.target.closest('.wb-text-edit')) return;
    e.preventDefault();
    select(id);
    const b = board.get(id);
    const def = blockTypes.get(b.type);
    const box = host.rootElement.getBoundingClientRect();
    const at = { x: e.clientX - box.left, y: e.clientY - box.top };
    if (!policy.canChange(b)) return;
    host.menu.show({
      id: 'block',
      at,
      items: [
        ...(def.edit === 'text' ? [{ id: 'edit', label: 'Edit', icon: 'pen', onClick: () => edit(id) }] : []),
        { id: 'colour', label: 'Colour', icon: 'palette', onClick: () => { setTimeout(() => tintMenu({ at }, id), 0); } },
        { id: 'front', label: 'Bring to front', icon: 'arrow-up', onClick: () => ctx.change(id, { z: board.topZ() + 1 }) },
        { separator: true },
        { id: 'delete', label: 'Delete', icon: 'trash', danger: true, onClick: () => remove(id) },
      ],
    });
  });

  // ---- the keyboard -----------------------------------------------------------------------------------------------------
  // Tab reaches the board and then each block in turn; a block that takes the focus is selected.
  surface.addEventListener('focusin', (e) => {
    const id = renderer.blockAt(e.target);
    if (id && id !== selected && !e.target.closest('.wb-text-edit')) select(id);
  });
  surface.addEventListener('keydown', (e) => {
    if (e.target.closest('.wb-text-edit') || e.altKey) return;
    const b = selected && board.get(selected);
    const k = e.key;
    if ((k === 'Delete' || k === 'Backspace') && b) { e.preventDefault(); remove(b.id); surface.focus({ preventScroll: true }); return; }
    if (k === 'Escape') {
      if (tool.id !== 'select') setTool('select'); else select(null);
      surface.focus({ preventScroll: true });
      return;
    }
    if (k === 'Enter' && b) { e.preventDefault(); edit(b.id); return; }
    if (k.startsWith('Arrow') && b && policy.canChange(b) && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const step = e.shiftKey ? 1 : 10;
      const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
      const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
      ctx.change(b.id, { x: b.x + dx, y: b.y + dy }, { save: 'soon' });
      return;
    }
    if (e.ctrlKey || e.metaKey) return;
    if (k === '+' || k === '=') { renderer.zoomBy(1.25); updateStatus(); return; }
    if (k === '-') { renderer.zoomBy(0.8); updateStatus(); return; }
    if (k === '0') { renderer.fit(); updateStatus(); return; }
    const t = allowed.find((x) => x.key === k.toLowerCase());
    if (t) { e.preventDefault(); setTool(t.id); }
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
  for (const b of first) if (policy.canSee(b)) { board.put(b); renderer.draw(b); }
  $('loading').hidden = true;
  $('app').hidden = false;
  if (surface.clientWidth > 0) { fitted = true; renderer.fit(); }
  updateStatus();
})();
