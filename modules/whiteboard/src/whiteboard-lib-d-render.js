  // ---- whiteboard-lib-d-render.js: drawing the board ---------------------------------------------------------------------
  //
  // The board is drawn with the page's own HTML and SVG: one element per block in a "world" layer that the view moves and
  // scales (pan and zoom), so words wrap and are edited as ordinary text, and every colour is a theme token in CSS. The
  // renderer owns the view and the elements; what a block looks like is its block type's render. It saves nothing.
  // icon(name) -> a promise of an icon's SVG (the lock mark's padlock). onView() is told each time the view moves (the
  // overview follows it).
  function createRenderer({ surface, world, frame, icon = null, onView = null }) {
    const els = new Map(); // block id -> its element
    const floats = new Map(); // block id -> its type, for the blocks the type draws itself (floating)
    const shown = new Map(); // block id -> the block as it was last drawn
    const view = { x: 0, y: 0, s: 1 };
    const MIN = 0.2;
    const MAX = 4;
    let selected = new Set(); // the picked blocks' ids
    let grips = null; // the one picked block's handles: 'corners', 'ends' or null
    const eachFrames = new Map(); // block id -> its own frame, while more than one block is picked
    let marqueeEl = null; // the rectangle dragged to pick blocks, while it is dragged
    // Connectors (attached block types): what each was last drawn as (its layout), and, for each block, the connectors
    // attached to it, so moving, resizing or removing a block draws them again. A connector whose block is not on the board
    // is kept in that list (it comes back with the block, an undo) but not drawn.
    const geoms = new Map(); // connector id -> its layout, or null while it is not drawn
    const deps = new Map(); // block id -> Set of the ids of connectors attached to it
    const refsOf = new Map(); // connector id -> the block ids it is attached to

    function applyView() {
      world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
      world.style.setProperty('--wb-scale', String(view.s));
      let step = wbGrid.size * view.s;
      while (step < 12) step *= 2; // zoomed far out, every other dot, so the ground never turns grey
      // A dot is drawn in the middle of its tile: the tiles start half a step back, so the dots sit on the grid's
      // multiples (board 0, 24, 48 ...), where Snap to grid puts blocks; a line is at its tile's start (wbGridOffset).
      const at = wbGridOffset(wbGrid.style, view, step);
      surface.style.setProperty('--wb-grid', `${step}px`);
      surface.style.setProperty('--wb-grid-x', `${at.x}px`);
      surface.style.setProperty('--wb-grid-y', `${at.y}px`);
      if (onView) onView();
    }

    function place(el, block, def) {
      const box = def.box(block);
      el.style.left = `${block.x + box.x}px`;
      el.style.top = `${block.y + box.y}px`;
      el.style.width = `${box.w}px`;
      el.style.height = box.h === null ? '' : `${box.h}px`;
    }

    // The stack: z can be any number (a block moved one layer sits between its neighbours), so each element's z-index is
    // its place in the order, 1 at the bottom. Worked out again only when a block's z changes or one comes or goes.
    let restackFrame = 0;
    function restack() {
      if (restackFrame) return;
      restackFrame = requestAnimationFrame(() => {
        restackFrame = 0;
        const order = [...shown.values()].sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
        order.forEach((b, i) => {
          const el = els.get(b.id);
          if (el) el.style.zIndex = String(i + 1);
          const lock = locks.get(b.id);
          if (lock) lock.style.zIndex = String(i + 1); // over its own block (it comes later), under the blocks above it
        });
      });
    }

    // A locked block's mark (lib-a): a small padlock on the top right corner of its box (a connector's: where it starts), over
    // its block and under the blocks above it, never over its words. Not part of the block: a picture of the board leaves
    // it out. The block's spoken description says "locked" instead.
    const locks = new Map(); // block id -> its lock mark
    let padlock = null; // the padlock's SVG, once it is in
    // The mark shows only on mouseover of its block, with the keyboard on it, or when it is picked (whiteboard.css).
    const lockHot = new Set(); // ids of blocks under the pointer or with the keyboard on them
    function lockState(id) {
      const m = locks.get(id);
      if (!m) return;
      m.classList.toggle('wb-lock-hot', lockHot.has(id));
      m.classList.toggle('wb-lock-pick', selected.has(id));
    }
    function lockWire(id) {
      const el = els.get(id);
      if (!el || el.dataset.lockWired) return;
      el.dataset.lockWired = '1';
      const set = (on) => { if (on) lockHot.add(id); else lockHot.delete(id); lockState(id); };
      el.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') set(true); });
      el.addEventListener('pointerleave', () => { if (!el.matches(':focus-visible')) set(false); });
      el.addEventListener('focusin', () => { if (el.matches(':focus-visible')) set(true); });
      el.addEventListener('focusout', () => set(false));
    }
    function showLock(block, def, at) {
      let m = locks.get(block.id);
      if (!block.locked || !at) { if (m) { m.remove(); locks.delete(block.id); } return; }
      if (!m) {
        m = document.createElement('div');
        m.className = 'wb-lock';
        m.setAttribute('aria-hidden', 'true');
        const ic = document.createElement('span');
        ic.className = 'ic';
        m.append(ic);
        world.insertBefore(m, frame);
        locks.set(block.id, m);
        const el = els.get(block.id);
        if (el && el.style.zIndex) m.style.zIndex = el.style.zIndex;
        if (padlock) ic.innerHTML = padlock;
        else if (icon) Promise.resolve(icon('lock')).then((svg) => { if (!svg) return; padlock = svg; for (const x of locks.values()) { const i = x.querySelector('.ic'); if (i && !i.innerHTML) i.innerHTML = svg; } }, () => {});
      }
      m.style.left = `${at.x}px`;
      m.style.top = `${at.y}px`;
      lockWire(block.id);
      lockState(block.id);
    }

    // A block's colours and width, as custom properties whiteboard.css draws with: --wb-fill, --wb-stroke and --wb-ink are
    // the role's theme token (unset for 'none' or 'auto', which data-fill and data-stroke tell the stylesheet), --wb-weight
    // the width in board units.
    function paint(el, block, def) {
      for (const role of WB_ROLES) {
        const v = def.paint && def.paint[role.id] ? block[role.id] : undefined;
        const c = v && WB_PALETTE_BY_ID.get(v);
        if (v) el.dataset[role.id] = v; else delete el.dataset[role.id];
        // A fixed colour is used as it is (full strength, whatever the theme); a fixed fill also tells the stylesheet whether it
        // is light or dark (data-fixed-fill), which gives the block its own readable words and lines.
        const f = v && WB_FIXED_BY_ID.get(v);
        if (f) el.style.setProperty(`--wb-${role.id}`, `var(${f.css})`);
        else if (c) el.style.setProperty(`--wb-${role.id}`, c.token); else el.style.removeProperty(`--wb-${role.id}`);
        if (role.id === 'fill') { if (f) el.dataset.fixedFill = f.family; else delete el.dataset.fixedFill; }
      }
      if (def.weight) el.style.setProperty('--wb-weight', `${block.weight}px`); else el.style.removeProperty('--wb-weight');
      // The words' size (a type token) and how they line up, for a block whose words take markup.
      const size = def.markup && WB_SIZE_BY_ID.get(block.size);
      if (size) el.style.setProperty('--wb-size', size.token); else el.style.removeProperty('--wb-size');
      if (def.valign && WB_VALIGN_BY_ID.has(block.valign)) el.dataset.valign = block.valign; else delete el.dataset.valign;
      if (def.markup && WB_ALIGN_BY_ID.has(block.align)) { el.dataset.align = block.align; el.style.setProperty('--wb-align', block.align); } else { delete el.dataset.align; el.style.removeProperty('--wb-align'); }
    }

    // A block's box on the board ({ x, y, w, h, in? }), for a connector attached to it, or null when it is not on the board
    // or cannot take one. The height of a block whose words set it is read from its element.
    function boxOf(id) {
      const b = shown.get(id);
      const def = b && blockTypes.get(b.type);
      if (!wbAttachable(def)) return null;
      const box = def.box(b);
      let h = box.h;
      if (h === null) { const el = els.get(id); h = el ? el.offsetHeight : 0; }
      const r = { x: b.x + box.x, y: b.y + box.y, w: box.w, h };
      if (def.anchorIn) r.in = def.anchorIn(b);
      return r;
    }
    const find = (id) => shown.get(id) || null;
    function linkRefs(block, def) {
      const now = def.refs ? def.refs(block) : [];
      const was = refsOf.get(block.id) || [];
      if (was.length === now.length && was.every((id, i) => id === now[i])) return;
      for (const id of was) { const s = deps.get(id); if (s) { s.delete(block.id); if (!s.size) deps.delete(id); } }
      if (!now.length) { refsOf.delete(block.id); return; }
      refsOf.set(block.id, now);
      for (const id of now) { let s = deps.get(id); if (!s) { s = new Set(); deps.set(id, s); } s.add(block.id); }
    }
    // The connectors attached to a block, drawn again (it moved, changed size, came or went).
    function redrawDeps(id) {
      for (const cid of [...(deps.get(id) || [])]) { const c = shown.get(cid); if (c) draw(c); }
    }

    function draw(block) {
      const def = blockTypes.get(block.type);
      if (!def) return null;
      if (def.floating) { floats.set(block.id, def); def.float(block); return null; } // the type draws it itself (the timer's clock)
      const before = shown.get(block.id);
      shown.set(block.id, block);
      if (!before || before.z !== block.z) restack();
      let el = els.get(block.id);
      if (!el || el.dataset.type !== block.type) {
        if (el) el.remove();
        el = document.createElement('div');
        el.className = `wb-block wb-type-${block.type}`;
        el.dataset.id = block.id;
        el.dataset.type = block.type;
        el.tabIndex = 0;
        el.setAttribute('role', def.role || 'button'); // a table is a group round a table of its own
        world.insertBefore(el, frame);
        els.set(block.id, el);
        restack();
      }
      paint(el, block, def);
      if (def.attached) {
        // Drawn from the boxes of the blocks it is attached to; not at all while one of them is not on the board.
        linkRefs(block, def);
        const g = def.layout(block, boxOf);
        geoms.set(block.id, g);
        el.hidden = !g;
        if (g) {
          if (!el.classList.contains('wb-editing')) def.render(block, el, g);
          el.style.left = `${g.box.x}px`;
          el.style.top = `${g.box.y}px`;
          el.style.width = `${g.box.w}px`;
          el.style.height = `${g.box.h}px`;
        }
        showLock(block, def, g ? g.points[0] : null); // at its start: its label is at its middle
      } else {
        if (!el.classList.contains('wb-editing')) def.render(block, el);
        place(el, block, def);
        const box = def.box(block);
        showLock(block, def, { x: block.x + box.x + box.w, y: block.y + box.y });
      }
      el.setAttribute('aria-label', `${def.describe(block, find)}${block.locked ? ', locked' : ''}`);
      if (selected.has(block.id)) frameSoon();
      if (!def.attached) redrawDeps(block.id);
      return el;
    }

    // A block taken away while it has the keyboard (an undo of the block just made) hands the keyboard to the board, so
    // the next key (a redo) still reaches it.
    function remove(id) {
      const fd = floats.get(id);
      if (fd) { floats.delete(id); fd.floatGone(id); return; }
      const el = els.get(id);
      if (el) {
        const root = el.getRootNode();
        const had = Boolean(root && root.activeElement && el.contains(root.activeElement));
        el.remove();
        if (had) surface.focus({ preventScroll: true });
      }
      els.delete(id);
      const lock = locks.get(id);
      if (lock) { lock.remove(); locks.delete(id); lockHot.delete(id); }
      const was = shown.get(id);
      shown.delete(id); // no restack: taking one away leaves the others in the same order (a gap in the z-indexes is harmless; the next add or move numbers them again)
      if (selected.has(id)) { selected.delete(id); if (selected.size !== 1) grips = null; frameSoon(); }
      if (refsOf.has(id)) linkRefs({ id }, {});
      if (marked === id) marked = null;
      geoms.delete(id);
      if (was) redrawDeps(id); // its connectors are not drawn while it is gone
    }

    function clear() { for (const id of [...floats.keys(), ...els.keys()]) remove(id); deps.clear(); refsOf.clear(); }

    // The selection is drawn as a frame round the block, a mark on the board and not a state of the block's own; with more
    // than one block picked, a frame round each and one dashed box round them all (#frame), with no handles. The handles
    // (when the page asks for them, for one block) sit on the frame's corners or on a line's ends, each at a point of the block's
    // element in board units (--hx, --hy) pushed out by --ox, --oy screen steps; whiteboard.css keeps their size on the
    // screen the same at any zoom. Which handle is pressed is its data-handle (the select tool reads it).
    const CORNERS = [['nw', 0, 0], ['ne', 1, 0], ['sw', 0, 1], ['se', 1, 1]];
    function handlePoints(el) {
      const b = shown.get([...selected][0]);
      const def = b && blockTypes.get(b.type);
      // A block type's own handles (a note's pointer tip, a table's lines and its +), after its resize handles: kind 'col'
      // or 'row' is a grab bar len board units long, 'add' a +; ox, oy push it out from the box as a corner's are.
      const own = def && def.grips && grips ? def.grips(b, el).map((g) => ({ id: g.id, x: g.x, y: g.y, ox: g.ox || 0, oy: g.oy || 0, kind: g.kind || '', len: g.len || 0 })) : [];
      if (grips === 'corners') return [...CORNERS.map(([id, cx, cy]) => ({ id, x: cx * el.offsetWidth, y: cy * el.offsetHeight, ox: cx ? 1 : -1, oy: cy ? 1 : -1 })), ...own];
      if (grips !== 'ends' || !def) return [];
      if (def.attached) {
        const g = geoms.get(b.id);
        if (!g) return [];
        const first = g.points[0];
        const last = g.points[g.points.length - 1];
        return [{ id: 'start', x: first.x - g.box.x, y: first.y - g.box.y, ox: 0, oy: 0 }, { id: 'end', x: last.x - g.box.x, y: last.y - g.box.y, ox: 0, oy: 0 }];
      }
      const box = def.box(b);
      return [{ id: 'start', x: -box.x, y: -box.y, ox: 0, oy: 0 }, { id: 'end', x: -box.x + b.dx, y: -box.y + b.dy, ox: 0, oy: 0 }];
    }
    let framePending = false;
    function frameSoon() {
      if (framePending) return;
      framePending = true;
      queueMicrotask(() => { framePending = false; showFrame(); });
    }
    const boxIn = (el) => ({ x0: el.offsetLeft, y0: el.offsetTop, x1: el.offsetLeft + el.offsetWidth, y1: el.offsetTop + el.offsetHeight });
    // All a block draws, on the board: its element's box, and further where its type reaches past it (a note's pointer).
    function reachIn(el) {
      const r = boxIn(el);
      const b = shown.get(el.dataset.id);
      const def = b && blockTypes.get(b.type);
      if (!def || !def.reach || def.attached) return r;
      const q = def.reach(b);
      return { x0: Math.min(r.x0, b.x + q.x), y0: Math.min(r.y0, b.y + q.y), x1: Math.max(r.x1, b.x + q.x + q.w), y1: Math.max(r.y1, b.y + q.y + q.h) };
    }
    const putBox = (node, r) => {
      node.style.left = `${r.x0}px`;
      node.style.top = `${r.y0}px`;
      node.style.width = `${r.x1 - r.x0}px`;
      node.style.height = `${r.y1 - r.y0}px`;
    };
    function showFrame() {
      const picked = [...selected].map((id) => els.get(id)).filter((el) => el && !el.hidden);
      const group = picked.length > 1;
      for (const [id, f] of eachFrames) if (!group || !selected.has(id)) { f.remove(); eachFrames.delete(id); }
      if (!picked.length) { frame.hidden = true; frame.replaceChildren(); frame.classList.remove('wb-frame-group'); return; }
      frame.hidden = false;
      frame.classList.toggle('wb-frame-group', group);
      if (group) {
        const all = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        for (const el of picked) {
          const r = reachIn(el);
          all.x0 = Math.min(all.x0, r.x0); all.y0 = Math.min(all.y0, r.y0); all.x1 = Math.max(all.x1, r.x1); all.y1 = Math.max(all.y1, r.y1);
          let f = eachFrames.get(el.dataset.id);
          if (!f) { f = document.createElement('div'); f.className = 'wb-frame-each'; f.setAttribute('aria-hidden', 'true'); world.insertBefore(f, frame); eachFrames.set(el.dataset.id, f); }
          putBox(f, r);
        }
        putBox(frame, all);
        frame.replaceChildren();
        return;
      }
      const el = picked[0];
      putBox(frame, boxIn(el));
      const points = handlePoints(el);
      if (frame.children.length !== points.length || [...frame.children].some((h, i) => h.dataset.handle !== points[i].id)) {
        frame.replaceChildren(...points.map((pt) => {
          const h = document.createElement('div');
          h.className = `wb-handle wb-handle-${pt.id}${pt.kind ? ` wb-handle-${pt.kind}` : ''}`;
          h.dataset.handle = pt.id;
          h.setAttribute('aria-hidden', 'true');
          return h;
        }));
      }
      points.forEach((pt, i) => {
        const h = frame.children[i];
        h.style.setProperty('--hx', String(pt.x));
        h.style.setProperty('--hy', String(pt.y));
        h.style.setProperty('--ox', String(pt.ox));
        h.style.setProperty('--oy', String(pt.oy));
        if (pt.len) h.style.setProperty('--hl', String(pt.len)); else h.style.removeProperty('--hl');
      });
    }
    // Pick the blocks with these ids (an array; [] for none); handles only when it is one block.
    function select(ids, handles = null) {
      const was = selected;
      selected = new Set((ids || []).filter((id) => els.has(id)));
      for (const id of new Set([...was, ...selected])) { const e = els.get(id); if (e) e.classList.toggle('wb-picked', selected.has(id)); } // the frame's notes mark shows on a picked frame
      grips = selected.size === 1 ? handles : null;
      for (const id of locks.keys()) lockState(id);
      showFrame();
    }
    // The rectangle being dragged to pick blocks, in board units ({ x0, y0, x1, y1 }), or null to take it away.
    function marquee(r) {
      if (!r) { if (marqueeEl) marqueeEl.remove(); marqueeEl = null; return; }
      if (!marqueeEl) { marqueeEl = document.createElement('div'); marqueeEl.className = 'wb-marquee'; marqueeEl.setAttribute('aria-hidden', 'true'); world.append(marqueeEl); }
      putBox(marqueeEl, { x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1), x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1) });
    }

    // The connection points of some blocks (the Connector tool, and dragging a connector's end): a small square on the
    // middle of each side. list: [{ block, side }] ('auto', or the side that is marked), [] to take them away.
    let portEls = [];
    function ports(list) {
      for (const p of portEls) p.remove();
      portEls = [];
      for (const { block, side } of list || []) {
        const r = boxOf(block);
        if (!r) continue;
        for (const s of WB_SIDES) {
          const pt = wbSidePoint(r, s);
          const dot = document.createElement('div');
          dot.className = `wb-port${s === side ? ' wb-port-on' : ''}`;
          dot.setAttribute('aria-hidden', 'true');
          dot.style.left = `${pt.x}px`;
          dot.style.top = `${pt.y}px`;
          world.insertBefore(dot, frame);
          portEls.push(dot);
        }
      }
    }

    // Guides (lib-m, wbGuideSnap) while a block is dragged: thin lines on the board, [{ axis, at, from, to }], [] for none.
    const guideEls = [];
    function guides(list) {
      const want = list || [];
      while (guideEls.length > want.length) guideEls.pop().remove();
      want.forEach((g, i) => {
        let el = guideEls[i];
        if (!el) { el = document.createElement('div'); el.setAttribute('aria-hidden', 'true'); world.insertBefore(el, frame); guideEls.push(el); }
        el.className = `wb-guide wb-guide-${g.axis}`;
        if (g.axis === 'x') putBox(el, { x0: g.at, y0: g.from, x1: g.at, y1: g.to });
        else putBox(el, { x0: g.from, y0: g.at, x1: g.to, y1: g.at });
      });
    }

    // A picture on its way (lib-i): a placeholder where its block will be, with a spinner and a word for how far it is.
    // box in board units ({ x, y, w, h }), or null to take it away. It is not a block: nothing picks, moves or saves it.
    const pendings = new Map(); // job id -> its placeholder
    function pending(id, box, text = '') {
      let el = pendings.get(id);
      if (!box) { if (el) el.remove(); pendings.delete(id); return; }
      if (!el) {
        el = document.createElement('div');
        el.className = 'wb-pending';
        el.setAttribute('aria-hidden', 'true'); // the status line says how many are on their way
        const spin = document.createElement('span');
        spin.className = 'sdk-spinner sdk-spinner-lg';
        const words = document.createElement('span');
        words.className = 'wb-pending-text';
        el.append(spin, words);
        world.insertBefore(el, frame);
        pendings.set(id, el);
      }
      el.lastChild.textContent = text;
      putBox(el, { x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.h });
    }

    // A block marked by a tool (the Fill tool: the block under the pointer, 'ok' it can be filled, 'no' it cannot), or null.
    let marked = null;
    function mark(id, kind = 'ok') {
      const was = marked && els.get(marked);
      if (was && marked !== id) delete was.dataset.mark;
      const el = id ? els.get(id) : null;
      marked = el ? id : null;
      if (el) el.dataset.mark = kind;
    }
    // A small swatch of a colour by the pointer ({ sx, sy } on the screen, and the colour's token), or null to take it away.
    // The Eraser's circle by the pointer ({ sx, sy } on the screen, or null to take it away): 12 screen pixels across (css).
    let ringEl = null;
    function ring(at) {
      if (!at) { if (ringEl) ringEl.hidden = true; return; }
      if (!ringEl) {
        ringEl = document.createElement('div');
        ringEl.className = 'wb-eraser-ring';
        ringEl.setAttribute('aria-hidden', 'true');
        surface.append(ringEl);
      }
      ringEl.hidden = false;
      ringEl.style.transform = `translate3d(${at.sx - 6}px, ${at.sy - 6}px, 0)`; // moved by transform: no layout, no repaint of the blocks
    }
    let swatchEl = null;
    function swatch(at, token) {
      if (!at) { if (swatchEl) swatchEl.hidden = true; return; }
      if (!swatchEl) {
        swatchEl = document.createElement('div');
        swatchEl.className = 'wb-swatch';
        swatchEl.setAttribute('aria-hidden', 'true');
        surface.append(swatchEl);
      }
      swatchEl.hidden = false;
      swatchEl.style.left = `${at.sx}px`;
      swatchEl.style.top = `${at.sy}px`;
      swatchEl.style.setProperty('--wb-swatch', token);
    }

    // A point on the screen (a pointer event's clientX and clientY) on the board, in board units.
    function toBoard(cx, cy) {
      const r = surface.getBoundingClientRect();
      return { x: (cx - r.left - view.x) / view.s, y: (cy - r.top - view.y) / view.s, sx: cx - r.left, sy: cy - r.top };
    }
    // The block under a pointer event, or null.
    function blockAt(target) {
      const el = target && target.closest ? target.closest('.wb-block') : null;
      return el && world.contains(el) ? el.dataset.id : null;
    }
    // The selected block's handle under a pointer event ('nw', 'se', 'start', ...), or null.
    function handleAt(target) {
      const h = target && target.closest ? target.closest('.wb-handle') : null;
      return h && frame.contains(h) ? h.dataset.handle : null;
    }

    function zoomAt(s, sx, sy) {
      const next = Math.min(MAX, Math.max(MIN, s));
      const bx = (sx - view.x) / view.s;
      const by = (sy - view.y) / view.s;
      view.s = next;
      view.x = sx - bx * next;
      view.y = sy - by * next;
      applyView();
    }
    function panBy(dx, dy) { view.x += dx; view.y += dy; applyView(); }
    // Put the view as given ({ x, y, s }; the scale held to the limits): presenting a frame, and back.
    function setView(v) {
      view.s = Math.min(MAX, Math.max(MIN, v.s));
      view.x = v.x;
      view.y = v.y;
      applyView();
    }
    function center() {
      return { x: (surface.clientWidth / 2 - view.x) / view.s, y: (surface.clientHeight / 2 - view.y) / view.s };
    }
    // Every block in sight, or the board's origin at 100% when there are none.
    function fit() {
      const w = surface.clientWidth || 400;
      const h = surface.clientHeight || 300;
      const seen = [...els.values()].filter((el) => !el.hidden);
      if (!seen.length) { view.s = 1; view.x = w / 2; view.y = h / 2; applyView(); return; }
      let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
      for (const el of seen) {
        const r = reachIn(el);
        x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0);
        x1 = Math.max(x1, r.x1); y1 = Math.max(y1, r.y1);
      }
      const pad = 32;
      const s = Math.min(1, Math.max(MIN, Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, y1 - y0))));
      view.s = s;
      view.x = w / 2 - ((x0 + x1) / 2) * s;
      view.y = h / 2 - ((y0 + y1) / 2) * s;
      applyView();
    }

    applyView();
    return {
      view,
      redrawGrid: applyView,
      draw,
      remove,
      clear,
      select,
      marquee,
      pending,
      mark,
      swatch,
      ring,
      element: (id) => els.get(id) || null,
      // A connector as it is drawn now ({ points, box, mid, head }), or null while it is not drawn.
      geometry: (id) => geoms.get(id) || null,
      // The ids of the connectors attached to a block.
      attachedTo: (id) => [...(deps.get(id) || [])],
      boxOf,
      // All a block draws, on the board ({ x0, y0, x1, y1 }), or null when it is not drawn.
      reachOf: (id) => { const el = els.get(id); return el && !el.hidden ? reachIn(el) : null; },
      // A block's box as drawn, on the board ({ x0, y0, x1, y1 }), or null when it is not drawn.
      rectOf: (id) => { const el = els.get(id); return el && !el.hidden ? boxIn(el) : null; },
      guides,
      ports,
      refreshFrame: showFrame,
      toBoard,
      blockAt,
      handleAt,
      zoomAt,
      zoomBy: (f) => zoomAt(view.s * f, surface.clientWidth / 2, surface.clientHeight / 2),
      reset: () => zoomAt(1, surface.clientWidth / 2, surface.clientHeight / 2),
      panBy,
      setView,
      limits: { min: MIN, max: MAX },
      center,
      fit,
    };
  }


  // The words of a block that takes markup (a note, a text block, a shape), drawn into its words element. This is the one
  // place on the board that sets HTML from what a person wrote, and the HTML is only ever the host's markdown()
  // (public/sdk/host.js), which escapes everything first and makes only its own few elements, with links only to http and
  // https addresses. Words with no markup in them go in as text, as they always did. Each link is checked again (anything
  // but http or https becomes its words), cannot be dragged and is not in the Tab order; the browser never follows one on
  // a click: the page does, by its own rule (whiteboard.js, "links").
  const wbShown = new WeakMap(); // words element -> the words last drawn in it, so a drag does not draw them again
  function wbShowWords(words, text) {
    const t = typeof text === 'string' ? text : '';
    if (wbShown.get(words) === t) return;
    wbShown.set(words, t);
    if (!wbMarkup.html || !wbHasMarkup(t)) {
      words.textContent = t;
      words.classList.remove('wb-md');
      return;
    }
    words.innerHTML = wbMarkup.html(t); // the host's markdown: escaped first, the one sanctioned HTML
    words.classList.add('wb-md');
    for (const a of words.querySelectorAll('a')) {
      const href = a.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(href)) { a.replaceWith(...a.childNodes); continue; }
      a.draggable = false;
      a.tabIndex = -1;
      a.title = wbMarkup.linkTip ? `${href}\n${wbMarkup.linkTip}` : href;
    }
  }
  // The address of the link under a pointer (an event's target) in a block's words, or null.
  function wbLinkAt(target) {
    const a = target && target.closest ? target.closest('.wb-words a[href]') : null;
    const href = a ? a.getAttribute('href') : '';
    return a && /^https?:\/\//i.test(href) ? href : null;
  }
  // The addresses of the links in a block's words (at most `most`), for the right-click menu.
  function wbLinksIn(el, most = 3) {
    const out = [];
    for (const a of el ? el.querySelectorAll('.wb-words a[href]') : []) {
      const href = a.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href) && !out.includes(href)) out.push(href);
      if (out.length >= most) break;
    }
    return out;
  }

  // The formatting bar's buttons, in order: what each does to the words (lib-j) and its key with Ctrl or Cmd.
  const WB_FORMATS = [
    { id: 'bold', label: 'Bold', icon: 'bold', key: 'B' },
    { id: 'italic', label: 'Italic', icon: 'italic', key: 'I' },
    { id: 'code', label: 'Code', icon: 'code', key: 'E' },
    { id: 'ul', label: 'Bulleted list', icon: 'list-ul' },
    { id: 'ol', label: 'Numbered list', icon: 'list-ol' },
    { id: 'heading', label: 'Heading', icon: 'heading' },
    { id: 'link', label: 'Link', icon: 'link', key: 'K' },
  ];
  const WB_HEADING_NAMES = ['none', 'large', 'medium', 'small'];

  // Editing a block's words in place: a text box over the words, the same size and look. Enter makes a new line; leaving
  // the box, or Ctrl or Cmd with Enter, keeps what was typed; Escape puts the words back. done(text) is called once, with
  // the words to keep (the same words when nothing changed). grow: the box grows with the words (a text block); else it
  // fills the block (a note, a shape's label). line: one line (a picture's description), where Enter keeps it; label: the
  // box's name for a screen reader; max: the most characters; home: what takes the focus back when the editing is ended
  // by a key (else el); keys(e, finish): a key of the caller's first, true when it took it (a table's Tab and Enter).
  // bar: words that take markup get a small formatting bar over the block ({ layer: the board, the element it sits in;
  // icon(name) -> a promise of an icon's SVG; mod: 'Ctrl' or 'Cmd', null to name no keys on a touch screen }). Its
  // buttons and Ctrl or Cmd with B, I, E and K change the words in the box (lib-j), the box's own undo keeps each change;
  // the words are still saved once, when the editing ends. A press on the bar keeps the box open; Link asks for the
  // address in a field of the bar.
  function wbEditText(el, target, value, done, { grow: grows = false, line = false, label = 'Words', max = 0, bar = null, home = null, keys = null } = {}) {
    const box = document.createElement('textarea');
    box.className = `wb-text-edit${line ? ' wb-text-line' : ''}`;
    box.value = value;
    box.setAttribute('aria-label', label);
    if (line) { box.rows = 1; box.placeholder = label; }
    if (max) box.maxLength = max;
    box.spellcheck = true;
    el.classList.add('wb-editing');
    target.after(box);
    let over = false;
    let marks = null; // the formatting bar, while there is one
    const inside = (n) => Boolean(n && (n === box || (marks && marks.el.contains(n))));
    const grow = () => { if (!grows) return; box.style.height = 'auto'; box.style.height = `${box.scrollHeight}px`; };
    const finish = (keep) => {
      if (over) return;
      over = true;
      const text = keep ? box.value : value;
      if (marks) marks.remove();
      box.remove();
      el.classList.remove('wb-editing');
      done(text);
    };
    box.addEventListener('input', () => {
      if (line && /[\r\n]/.test(box.value)) box.value = box.value.replace(/[\r\n]+/g, ' '); // pasted lines become one
      grow();
      if (marks) marks.update();
    });
    const back = () => (home || el).focus();
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (keys && !e.isComposing && keys(e, finish)) return;
      if (e.key === 'Escape') { e.preventDefault(); finish(false); back(); return; }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || line)) { e.preventDefault(); finish(true); back(); return; }
      if (marks && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        // By the key's place too, so any keyboard layout.
        const k = (e.code && e.code.startsWith('Key') ? e.code.slice(3) : e.key || '').toUpperCase();
        const f = WB_FORMATS.find((x) => x.key === k);
        if (f) { e.preventDefault(); marks.run(f.id); }
      }
    });
    if (bar) for (const type of ['keyup', 'pointerup', 'select']) box.addEventListener(type, () => { if (marks) marks.update(); });
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    box.addEventListener('blur', (e) => { if (!inside(e.relatedTarget)) finish(true); });
    if (bar) marks = wbFormatBar({ ...bar, anchor: el, box, max, inside, finish, escape: () => { finish(false); back(); } });
    grow();
    box.focus();
    box.select();
    if (marks) marks.place();
    return { finish };
  }

  // The formatting bar over a block being edited (see wbEditText). It sits just above the block (below it when there is
  // no room above), inside the board and above a phone's on-screen keyboard, and wraps onto two rows when narrow.
  function wbFormatBar({ layer, anchor, box, icon, mod = 'Ctrl', max = 0, align = null, inside, finish, escape }) {
    const bar = document.createElement('div');
    bar.className = 'wb-format';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Formatting');
    let asking = null; // the link's address row, while it is asked for
    let switching = false; // the focus is moved on purpose between the box and the address field

    const iconSpan = (name) => {
      const ic = document.createElement('span');
      ic.className = 'ic';
      ic.setAttribute('aria-hidden', 'true');
      if (icon) Promise.resolve(icon(name)).then((svg) => { if (svg) ic.innerHTML = svg; }, () => {}); // the host's own icon SVG
      return ic;
    };
    const button = (id, words, iconName) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sdk-icon-btn btn-quiet wb-format-btn';
      b.dataset.format = id;
      b.setAttribute('aria-label', words);
      b.title = words;
      b.append(iconSpan(iconName));
      return b;
    };

    // Put new words in the box, as one change of the box's own (its undo takes it back), and select what they say.
    function put(next) {
      if (!next || (max && next.value.length > max)) return;
      const old = box.value;
      let p = 0;
      while (p < old.length && p < next.value.length && old[p] === next.value[p]) p += 1;
      let q = 0;
      while (q < old.length - p && q < next.value.length - p && old[old.length - 1 - q] === next.value[next.value.length - 1 - q]) q += 1;
      switching = true;
      box.focus({ preventScroll: true });
      switching = false;
      box.setSelectionRange(p, old.length - q);
      let ok = false;
      try { ok = document.execCommand('insertText', false, next.value.slice(p, next.value.length - q)); } catch { ok = false; }
      if (!ok || box.value !== next.value) box.value = next.value;
      box.setSelectionRange(next.start, next.end);
      box.dispatchEvent(new Event('input', { bubbles: false }));
    }
    function run(id) {
      if (id === 'link') { askLink(); return; }
      const v = box.value;
      const a = box.selectionStart;
      const z = box.selectionEnd;
      if (id === 'bold' || id === 'italic' || id === 'code') put(wbToggleMark(v, a, z, id));
      else if (id === 'ul' || id === 'ol') put(wbToggleList(v, a, z, id));
      else if (id === 'heading') put(wbCycleHeading(v, a, z));
    }

    const buttons = WB_FORMATS.map((f) => {
      const b = button(f.id, f.key && mod ? `${f.label} (${mod} ${f.key})` : f.label, f.icon);
      b.addEventListener('click', () => run(f.id));
      return b;
    });
    const headingButton = buttons[WB_FORMATS.findIndex((f) => f.id === 'heading')];
    const level = document.createElement('span');
    level.className = 'wb-format-level';
    level.setAttribute('aria-hidden', 'true');
    headingButton.append(level);
    const row = document.createElement('div');
    row.className = 'wb-format-row';
    const marks = document.createElement('div');
    marks.className = 'wb-format-group';
    marks.append(...buttons);
    row.append(marks);
    // Alignment, its own group: align = { read() -> { align, valign } (valign null: the block has none), set(field, value) }
    // for the block being edited. The chosen one is pressed.
    const alignButtons = [];
    if (align) {
      const groupFor = (field, choices, name) => {
        const g = document.createElement('div');
        g.className = 'wb-format-group';
        g.setAttribute('role', 'group');
        g.setAttribute('aria-label', name);
        for (const c of choices) {
          const b = button(`${field}-${c.id}`, `Align ${c.label.toLowerCase()}`, c.icon);
          b.setAttribute('aria-pressed', 'false');
          b.addEventListener('click', () => { align.set(field, c.id); showAlign(); });
          alignButtons.push({ field, id: c.id, b });
          g.append(b);
        }
        return g;
      };
      const h = groupFor('align', WB_ALIGNS, 'Align');
      const v = groupFor('valign', WB_VALIGNS, 'Vertical align');
      row.append(h);
      if (align.read() && align.read().valign !== null) row.append(v);
    }
    function showAlign() {
      const now = align && align.read();
      if (!now) return;
      for (const { field, id, b } of alignButtons) b.setAttribute('aria-pressed', String(now[field] === id));
    }
    showAlign();
    bar.append(row);

    // Link: the address in a field of the bar. Enter or the tick puts the link round the selection; Escape or the cross
    // goes back to the words. Only an http or https address is taken (lib-j, wbLinkAddress).
    function askLink() {
      if (asking) return;
      const a = box.selectionStart;
      const z = box.selectionEnd;
      const was = /^\[[^\]\n]+\]\(([^\s)]*)\)$/.exec(box.value.slice(a, z));
      const field = document.createElement('input');
      field.type = 'url';
      field.inputMode = 'url';
      field.className = 'wb-format-address';
      field.placeholder = 'https://';
      field.setAttribute('aria-label', 'Link address');
      field.autocomplete = 'off';
      field.spellcheck = false;
      field.value = was ? was[1] : '';
      const ok = button('link-ok', 'Add the link', 'check');
      const no = button('link-cancel', 'Cancel', 'xmark');
      const why = document.createElement('p');
      why.className = 'wb-format-why';
      why.setAttribute('aria-live', 'polite');
      why.hidden = true;
      const ask = document.createElement('div');
      ask.className = 'wb-format-row wb-format-ask';
      ask.append(field, ok, no);
      asking = { a, z, field, ask, why };
      row.hidden = true;
      bar.append(ask, why);
      const add = () => {
        const href = wbLinkAddress(field.value);
        if (!href) {
          why.textContent = 'Only a web address (http or https) can be a link.';
          why.hidden = false;
          field.setAttribute('aria-invalid', 'true');
          field.focus();
          return;
        }
        back();
        put(wbLinkMarkup(box.value, a, z, href));
      };
      field.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); add(); }
        if (e.key === 'Escape') { e.preventDefault(); back(); }
      });
      field.addEventListener('input', () => { why.hidden = true; field.removeAttribute('aria-invalid'); });
      ok.addEventListener('click', add);
      no.addEventListener('click', () => back());
      switching = true;
      field.focus();
      switching = false;
      place();
    }
    // Back from the address to the words, with the same selection.
    function back() {
      if (!asking) return;
      const { a, z, ask, why } = asking;
      asking = null;
      switching = true;
      box.focus({ preventScroll: true });
      box.setSelectionRange(a, z);
      switching = false;
      ask.remove();
      why.remove();
      row.hidden = false;
      place();
    }

    // A press on the bar keeps the box open and its selection (not on the address field, which takes the focus).
    for (const type of ['pointerdown', 'mousedown']) {
      bar.addEventListener(type, (e) => {
        e.stopPropagation();
        if (!e.target.closest('input')) e.preventDefault();
      });
    }
    for (const type of ['click', 'dblclick', 'contextmenu', 'wheel', 'pointerup', 'copy', 'cut', 'paste']) bar.addEventListener(type, (e) => e.stopPropagation());
    bar.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); if (asking) back(); else escape(); }
    });
    // The focus leaving both the box and the bar ends the editing, as leaving the box always has.
    bar.addEventListener('focusout', (e) => { if (!switching && !inside(e.relatedTarget)) finish(true); });

    // Where it sits: above the block, else below it, kept inside the board and above the on-screen keyboard.
    let frame = 0;
    function place() {
      if (!bar.isConnected) return;
      const L = layer.getBoundingClientRect();
      const r = anchor.getBoundingClientRect();
      const w = bar.offsetWidth;
      const h = bar.offsetHeight;
      const vv = window.visualViewport;
      const seen = vv ? Math.min(L.bottom, vv.offsetTop + vv.height) : L.bottom;
      const gap = 8;
      let top = r.top - L.top - h - gap;
      if (top < 4) top = r.bottom - L.top + gap;
      if (L.top + top + h > seen - 4) top = Math.max(4, Math.min(r.top - L.top - h - gap, seen - L.top - h - 4));
      const left = Math.max(4, Math.min(r.left - L.left, L.width - w - 4));
      bar.style.left = `${Math.round(left)}px`;
      bar.style.top = `${Math.round(Math.max(4, top))}px`;
    }
    const soon = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; place(); }); };
    // The heading button shows the level of the line the caret is on.
    function update() {
      const n = wbHeadingOf(box.value, box.selectionStart, box.selectionEnd);
      level.textContent = n ? String(n) : '';
      showAlign();
      const words = `Heading, now ${WB_HEADING_NAMES[n]}`;
      headingButton.setAttribute('aria-label', words);
      headingButton.title = words;
      soon();
    }
    layer.append(bar);
    layer.addEventListener('wheel', soon, { passive: true });
    window.addEventListener('resize', soon);
    if (window.visualViewport) { window.visualViewport.addEventListener('resize', soon); window.visualViewport.addEventListener('scroll', soon); }
    update();
    return {
      el: bar,
      run,
      update,
      place,
      remove() {
        layer.removeEventListener('wheel', soon);
        window.removeEventListener('resize', soon);
        if (window.visualViewport) { window.visualViewport.removeEventListener('resize', soon); window.visualViewport.removeEventListener('scroll', soon); }
        if (frame) cancelAnimationFrame(frame);
        bar.remove();
      },
    };
  }
