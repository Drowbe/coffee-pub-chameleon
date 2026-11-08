  // ---- whiteboard-lib-d-render.js: drawing the board ---------------------------------------------------------------------
  //
  // The board is drawn with the page's own HTML and SVG: one element per block in a "world" layer that the view moves and
  // scales (pan and zoom), so words wrap and are edited as ordinary text, and every colour is a theme token in CSS. The
  // renderer owns the view and the elements; what a block looks like is its block type's render. It saves nothing.
  function createRenderer({ surface, world, frame }) {
    const els = new Map(); // block id -> its element
    const shown = new Map(); // block id -> the block as it was last drawn
    const view = { x: 0, y: 0, s: 1 };
    const MIN = 0.2;
    const MAX = 4;
    let selected = new Set(); // the picked blocks' ids
    let grips = null; // the one picked block's handles: 'corners', 'ends' or null
    const eachFrames = new Map(); // block id -> its own frame, while more than one block is picked
    let marqueeEl = null; // the rectangle dragged to pick blocks, while it is dragged

    function applyView() {
      world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
      world.style.setProperty('--wb-scale', String(view.s));
      let step = 24 * view.s;
      while (step < 12) step *= 2; // zoomed far out, every other dot, so the ground never turns grey
      surface.style.setProperty('--wb-grid', `${step}px`);
      surface.style.setProperty('--wb-grid-x', `${view.x}px`);
      surface.style.setProperty('--wb-grid-y', `${view.y}px`);
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
        order.forEach((b, i) => { const el = els.get(b.id); if (el) el.style.zIndex = String(i + 1); });
      });
    }

    // A block's colours and width, as custom properties whiteboard.css draws with: --wb-fill, --wb-stroke and --wb-ink are
    // the role's theme token (unset for 'none' or 'auto', which data-fill and data-stroke tell the stylesheet), --wb-weight
    // the width in board units.
    function paint(el, block, def) {
      for (const role of WB_ROLES) {
        const v = def.paint && def.paint[role.id] ? block[role.id] : undefined;
        const c = v && WB_PALETTE_BY_ID.get(v);
        if (v) el.dataset[role.id] = v; else delete el.dataset[role.id];
        if (c) el.style.setProperty(`--wb-${role.id}`, c.token); else el.style.removeProperty(`--wb-${role.id}`);
      }
      if (def.weight) el.style.setProperty('--wb-weight', `${block.weight}px`); else el.style.removeProperty('--wb-weight');
    }

    function draw(block) {
      const def = blockTypes.get(block.type);
      if (!def) return null;
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
        el.setAttribute('role', 'button');
        world.insertBefore(el, frame);
        els.set(block.id, el);
        restack();
      }
      paint(el, block, def);
      if (!el.classList.contains('wb-editing')) def.render(block, el);
      place(el, block, def);
      el.setAttribute('aria-label', def.describe(block));
      if (selected.has(block.id)) frameSoon();
      return el;
    }

    function remove(id) {
      const el = els.get(id);
      if (el) el.remove();
      els.delete(id);
      if (shown.delete(id)) restack();
      if (selected.has(id)) { selected.delete(id); if (selected.size !== 1) grips = null; frameSoon(); }
    }

    function clear() { for (const id of [...els.keys()]) remove(id); }

    // The selection is drawn as a frame round the block, a mark on the board and not a state of the block's own; with more
    // than one block picked, a frame round each and one dashed box round them all (#frame), with no handles. The handles
    // (when the page asks for them, for one block) sit on the frame's corners or on a line's ends, each at a point of the block's
    // element in board units (--hx, --hy) pushed out by --ox, --oy screen steps; whiteboard.css keeps their size on the
    // screen the same at any zoom. Which handle is pressed is its data-handle (the select tool reads it).
    const CORNERS = [['nw', 0, 0], ['ne', 1, 0], ['sw', 0, 1], ['se', 1, 1]];
    function handlePoints(el) {
      if (grips === 'corners') return CORNERS.map(([id, cx, cy]) => ({ id, x: cx * el.offsetWidth, y: cy * el.offsetHeight, ox: cx ? 1 : -1, oy: cy ? 1 : -1 }));
      const b = shown.get([...selected][0]);
      const def = b && blockTypes.get(b.type);
      if (grips !== 'ends' || !def) return [];
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
    const putBox = (node, r) => {
      node.style.left = `${r.x0}px`;
      node.style.top = `${r.y0}px`;
      node.style.width = `${r.x1 - r.x0}px`;
      node.style.height = `${r.y1 - r.y0}px`;
    };
    function showFrame() {
      const picked = [...selected].map((id) => els.get(id)).filter(Boolean);
      const group = picked.length > 1;
      for (const [id, f] of eachFrames) if (!group || !selected.has(id)) { f.remove(); eachFrames.delete(id); }
      if (!picked.length) { frame.hidden = true; frame.replaceChildren(); frame.classList.remove('wb-frame-group'); return; }
      frame.hidden = false;
      frame.classList.toggle('wb-frame-group', group);
      if (group) {
        const all = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        for (const el of picked) {
          const r = boxIn(el);
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
          h.className = `wb-handle wb-handle-${pt.id}`;
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
      });
    }
    // Pick the blocks with these ids (an array; [] for none); handles only when it is one block.
    function select(ids, handles = null) {
      selected = new Set((ids || []).filter((id) => els.has(id)));
      grips = selected.size === 1 ? handles : null;
      showFrame();
    }
    // The rectangle being dragged to pick blocks, in board units ({ x0, y0, x1, y1 }), or null to take it away.
    function marquee(r) {
      if (!r) { if (marqueeEl) marqueeEl.remove(); marqueeEl = null; return; }
      if (!marqueeEl) { marqueeEl = document.createElement('div'); marqueeEl.className = 'wb-marquee'; marqueeEl.setAttribute('aria-hidden', 'true'); world.append(marqueeEl); }
      putBox(marqueeEl, { x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1), x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1) });
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
    function center() {
      return { x: (surface.clientWidth / 2 - view.x) / view.s, y: (surface.clientHeight / 2 - view.y) / view.s };
    }
    // Every block in sight, or the board's origin at 100% when there are none.
    function fit() {
      const w = surface.clientWidth || 400;
      const h = surface.clientHeight || 300;
      if (!els.size) { view.s = 1; view.x = w / 2; view.y = h / 2; applyView(); return; }
      let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
      for (const el of els.values()) {
        x0 = Math.min(x0, el.offsetLeft); y0 = Math.min(y0, el.offsetTop);
        x1 = Math.max(x1, el.offsetLeft + el.offsetWidth); y1 = Math.max(y1, el.offsetTop + el.offsetHeight);
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
      draw,
      remove,
      clear,
      select,
      marquee,
      pending,
      element: (id) => els.get(id) || null,
      refreshFrame: showFrame,
      toBoard,
      blockAt,
      handleAt,
      zoomAt,
      zoomBy: (f) => zoomAt(view.s * f, surface.clientWidth / 2, surface.clientHeight / 2),
      reset: () => zoomAt(1, surface.clientWidth / 2, surface.clientHeight / 2),
      panBy,
      center,
      fit,
    };
  }

  // Editing a block's words in place: a text box over the words, the same size and look. Enter makes a new line; leaving
  // the box, or Ctrl or Cmd with Enter, keeps what was typed; Escape puts the words back. done(text) is called once, with
  // the words to keep (the same words when nothing changed). grow: the box grows with the words (a text block); else it
  // fills the block (a note, a shape's label). line: one line (a picture's description), where Enter keeps it; label: the
  // box's name for a screen reader; max: the most characters.
  function wbEditText(el, target, value, done, { grow: grows = false, line = false, label = 'Words', max = 0 } = {}) {
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
    const grow = () => { if (!grows) return; box.style.height = 'auto'; box.style.height = `${box.scrollHeight}px`; };
    const finish = (keep) => {
      if (over) return;
      over = true;
      const text = keep ? box.value : value;
      box.remove();
      el.classList.remove('wb-editing');
      done(text);
    };
    box.addEventListener('input', () => {
      if (line && /[\r\n]/.test(box.value)) box.value = box.value.replace(/[\r\n]+/g, ' '); // pasted lines become one
      grow();
    });
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); finish(false); el.focus(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || line)) { e.preventDefault(); finish(true); el.focus(); }
    });
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    box.addEventListener('blur', () => finish(true));
    grow();
    box.focus();
    box.select();
    return { finish };
  }
