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
    let selected = null;
    let grips = null; // the selected block's handles: 'corners', 'ends' or null

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
      el.style.zIndex = String(Math.max(0, Math.round(block.z)));
    }

    function draw(block) {
      const def = blockTypes.get(block.type);
      if (!def) return null;
      shown.set(block.id, block);
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
      }
      el.dataset.tint = block.tint || 'ink';
      if (!el.classList.contains('wb-editing')) def.render(block, el);
      place(el, block, def);
      el.setAttribute('aria-label', def.describe(block));
      if (selected === block.id) showFrame();
      return el;
    }

    function remove(id) {
      const el = els.get(id);
      if (el) el.remove();
      els.delete(id);
      shown.delete(id);
      if (selected === id) select(null);
    }

    function clear() { for (const id of [...els.keys()]) remove(id); }

    // The selection is drawn as a frame round the block, a mark on the board and not a state of the block's own. Its
    // handles (when the page asks for them) sit on the frame's corners or on a line's ends, each at a point of the block's
    // element in board units (--hx, --hy) pushed out by --ox, --oy screen steps; whiteboard.css keeps their size on the
    // screen the same at any zoom. Which handle is pressed is its data-handle (the select tool reads it).
    const CORNERS = [['nw', 0, 0], ['ne', 1, 0], ['sw', 0, 1], ['se', 1, 1]];
    function handlePoints(el) {
      if (grips === 'corners') return CORNERS.map(([id, cx, cy]) => ({ id, x: cx * el.offsetWidth, y: cy * el.offsetHeight, ox: cx ? 1 : -1, oy: cy ? 1 : -1 }));
      const b = shown.get(selected);
      const def = b && blockTypes.get(b.type);
      if (grips !== 'ends' || !def) return [];
      const box = def.box(b);
      return [{ id: 'start', x: -box.x, y: -box.y, ox: 0, oy: 0 }, { id: 'end', x: -box.x + b.dx, y: -box.y + b.dy, ox: 0, oy: 0 }];
    }
    function showFrame() {
      const el = selected && els.get(selected);
      if (!el) { frame.hidden = true; frame.replaceChildren(); return; }
      frame.hidden = false;
      frame.style.left = `${el.offsetLeft}px`;
      frame.style.top = `${el.offsetTop}px`;
      frame.style.width = `${el.offsetWidth}px`;
      frame.style.height = `${el.offsetHeight}px`;
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
    function select(id, handles = null) {
      selected = id && els.has(id) ? id : null;
      grips = selected ? handles : null;
      showFrame();
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
  // fills the block (a note, a shape's label).
  function wbEditText(el, target, value, done, { grow: grows = false } = {}) {
    const box = document.createElement('textarea');
    box.className = 'wb-text-edit';
    box.value = value;
    box.setAttribute('aria-label', 'Words');
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
    box.addEventListener('input', grow);
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); finish(false); el.focus(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true); el.focus(); }
    });
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    box.addEventListener('blur', () => finish(true));
    grow();
    box.focus();
    box.select();
    return { finish };
  }
