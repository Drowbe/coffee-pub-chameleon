  // ---- whiteboard-lib-n-overview.js: the overview, a small map of the whole board ---------------------------------------
  //
  // A small panel at the bottom right of the board (Show overview, in the title bar's menu): every block as a small box,
  // each frame as an outline, and the part of the board in sight as a rectangle in the accent colour. A press anywhere on
  // it puts the middle of the view there; dragging moves the view along. It only reads the board and the view, so someone
  // who may only look can use it. Each person's own choice, kept in this browser (off at first), never in the board's data.
  //
  // The work is plain functions on boxes ({ x0, y0, x1, y1 } in board units, as lib-m's wbRect gives them), so the
  // checks run it with no page; createOverview is the panel itself, made only by the page.
  const WB_OVERVIEW = {
    key: 'whiteboard-overview', // the browser's storage: '1' shown, anything else hidden
    cap: 2000, // the most blocks drawn (the lowest first, by z); the rest are left out, and the map says nothing of it
    least: { w: 360, h: 320 }, // a module smaller than this has no room for it
    size: { w: 160, h: 110 }, // CSS pixels
    small: { w: 120, h: 84 }, // in a narrow module
    pad: 4, // CSS pixels inside the panel's edge
    margin: 0.06, // round what is shown: this much of its longer side, each way
    marginLeast: 40, // and at least this many board units
  };

  // What the map shows: the box round every block and the view, and a margin round that. null for no blocks.
  function wbOverviewBounds(rects, view, { margin = WB_OVERVIEW.margin, least = WB_OVERVIEW.marginLeast } = {}) {
    const list = (rects || []).filter((r) => r && [r.x0, r.y0, r.x1, r.y1].every(Number.isFinite));
    if (!list.length) return null;
    const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const q of view ? [...list, view] : list) {
      r.x0 = Math.min(r.x0, q.x0); r.y0 = Math.min(r.y0, q.y0);
      r.x1 = Math.max(r.x1, q.x1); r.y1 = Math.max(r.y1, q.y1);
    }
    const m = Math.max(least, Math.max(r.x1 - r.x0, r.y1 - r.y0) * margin);
    return { x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m };
  }

  // How the board fits the map (W x H CSS pixels, pad inside the edge): map = board * s + (ox, oy), the board's shape
  // kept and centred.
  function wbOverviewFit(bounds, W, H, pad = WB_OVERVIEW.pad) {
    const bw = Math.max(1, bounds.x1 - bounds.x0);
    const bh = Math.max(1, bounds.y1 - bounds.y0);
    const s = Math.max(1e-6, Math.min((W - pad * 2) / bw, (H - pad * 2) / bh));
    return { s, ox: (W - bw * s) / 2 - bounds.x0 * s, oy: (H - bh * s) / 2 - bounds.y0 * s };
  }
  const wbOverviewToMap = (fit, p) => ({ x: p.x * fit.s + fit.ox, y: p.y * fit.s + fit.oy });
  const wbOverviewToBoard = (fit, m) => ({ x: (m.x - fit.ox) / fit.s, y: (m.y - fit.oy) / fit.s });

  // The view ({ x, y, s }, the renderer's) with the board point p in the middle of a board W x H pixels, at the same zoom.
  function wbOverviewCentre(p, view, W, H) {
    return { x: W / 2 - p.x * view.s, y: H / 2 - p.y * view.s, s: view.s };
  }

  // Where the middle of the view goes while its rectangle is dragged: the board point under the pointer less where in the
  // rectangle it was pressed (grab: the press less the view's middle), held inside what the map shows.
  function wbOverviewDrag(p, grab, bounds) {
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    return { x: clamp(p.x - grab.x, bounds.x0, bounds.x1), y: clamp(p.y - grab.y, bounds.y0, bounds.y1) };
  }
  // Whether a board point is inside a box.
  const wbOverviewInside = (p, r) => Boolean(r && p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1);

  // The boxes drawn: the first `cap` by z (the lowest first, so frames, which sit under the blocks, are kept), in the
  // order they are drawn. list: [{ z, ... }].
  function wbOverviewPick(list, cap = WB_OVERVIEW.cap) {
    const sorted = (list || []).slice().sort((a, b) => (a.z || 0) - (b.z || 0));
    return sorted.length > cap ? sorted.slice(0, cap) : sorted;
  }

  // Whether the panel is hidden: turned off, while presenting, in a module too small for it, or with nothing on the board.
  function wbOverviewHidden({ on, width, height, count, presenting }) {
    return !on || Boolean(presenting) || !(width >= WB_OVERVIEW.least.w) || !(height >= WB_OVERVIEW.least.h) || !(count > 0);
  }
  // The panel's size, by the module's width (narrow: the stylesheet's `.app.narrow`).
  const wbOverviewSize = (narrow) => (narrow ? WB_OVERVIEW.small : WB_OVERVIEW.size);

  // The person's choice, in the browser's storage when there is one (store() -> localStorage; it may throw, or there may
  // be none): off when it cannot be read. Saving answers whether it was kept.
  function wbOverviewLoad(store) {
    try { const s = store(); return Boolean(s) && s.getItem(WB_OVERVIEW.key) === '1'; } catch { return false; }
  }
  function wbOverviewSave(store, on) {
    try { const s = store(); if (!s) return false; s.setItem(WB_OVERVIEW.key, on ? '1' : '0'); return true; } catch { return false; }
  }

  // The panel: a small SVG in the board's corner. centre(p) puts the middle of the view at the board point p (the page
  // moves the view). The page hands it the boxes (blocks(list), [{ x0, y0, x1, y1, z, frame }]) when the board changes and
  // the view's box (view(r)) when the view moves; it draws once a frame at most, and not at all while hidden. While the
  // view's rectangle is dragged the map keeps its scale, so the rectangle moves under the pointer and not the map.
  function createOverview({ layer, centre }) {
    const NS = 'http://www.w3.org/2000/svg';
    const panel = document.createElement('div');
    panel.className = 'wb-overview';
    panel.setAttribute('role', 'img');
    panel.setAttribute('aria-label', 'Overview of the board');
    panel.hidden = true;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    const g = document.createElementNS(NS, 'g');
    const frames = document.createElementNS(NS, 'g');
    const boxes = document.createElementNS(NS, 'g');
    const viewEl = document.createElementNS(NS, 'rect');
    viewEl.setAttribute('class', 'wb-ov-view');
    g.append(frames, boxes, viewEl);
    svg.append(g);
    panel.append(svg);
    panel.style.width = `${WB_OVERVIEW.size.w}px`;
    panel.style.height = `${WB_OVERVIEW.size.h}px`;
    layer.append(panel);

    let size = WB_OVERVIEW.size;
    let all = []; // the boxes, as last handed in
    let picked = []; // the ones drawn
    let dirty = true; // the boxes changed since they were drawn
    let viewBox = null;
    let fit = null; // as last drawn
    let bounds = null;
    let hidden = true;
    let frame = 0;
    let drag = null; // { id, grab, fit, bounds } while a pointer is down on the panel
    const pools = { frames: [], boxes: [] };

    function soon() {
      if (frame || hidden) return;
      frame = requestAnimationFrame(() => { frame = 0; draw(); });
    }
    function setRect(el, r) {
      const v = [r.x0, r.y0, Math.max(0, r.x1 - r.x0), Math.max(0, r.y1 - r.y0)].map((n) => String(Math.round(n * 100) / 100));
      const key = v.join(' ');
      if (el.dataset.at === key) return;
      el.dataset.at = key;
      el.setAttribute('x', v[0]); el.setAttribute('y', v[1]); el.setAttribute('width', v[2]); el.setAttribute('height', v[3]);
    }
    function fill(group, pool, list, cls) {
      while (pool.length < list.length) { const el = document.createElementNS(NS, 'rect'); el.setAttribute('class', cls); group.append(el); pool.push(el); }
      while (pool.length > list.length) pool.pop().remove();
      list.forEach((r, i) => setRect(pool[i], r));
    }
    function draw() {
      if (hidden) return;
      if (dirty) {
        dirty = false;
        picked = wbOverviewPick(all);
        fill(frames, pools.frames, picked.filter((r) => r.frame), 'wb-ov-frame');
        fill(boxes, pools.boxes, picked.filter((r) => !r.frame), 'wb-ov-block');
      }
      if (drag) { ({ fit, bounds } = drag); } else {
        bounds = wbOverviewBounds(all, viewBox);
        fit = bounds ? wbOverviewFit(bounds, size.w, size.h) : null;
      }
      if (!fit) return;
      g.setAttribute('transform', `matrix(${fit.s} 0 0 ${fit.s} ${fit.ox} ${fit.oy})`);
      if (viewBox) setRect(viewEl, viewBox);
    }

    // A point on the panel (a pointer event) on the board, by the map as drawn (or as it was when the drag began).
    const boardAt = (e, f) => { const r = panel.getBoundingClientRect(); return wbOverviewToBoard(f, { x: e.clientX - r.left, y: e.clientY - r.top }); };
    const mid = (r) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
    panel.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (drag || !fit || !viewBox || (e.pointerType === 'mouse' && e.button !== 0)) return;
      try { panel.setPointerCapture(e.pointerId); } catch { /* the pointer is gone already */ }
      const p = boardAt(e, fit);
      // On the view's rectangle: it moves from where it was pressed; elsewhere, the view's middle goes there first.
      const c = mid(viewBox);
      const grab = wbOverviewInside(p, viewBox) ? { x: p.x - c.x, y: p.y - c.y } : { x: 0, y: 0 };
      drag = { id: e.pointerId, grab, fit, bounds };
      panel.classList.add('wb-ov-dragging');
      centre(wbOverviewDrag(p, grab, bounds));
    });
    panel.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      e.stopPropagation();
      centre(wbOverviewDrag(boardAt(e, drag.fit), drag.grab, drag.bounds));
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      e.stopPropagation();
      drag = null;
      panel.classList.remove('wb-ov-dragging');
      soon(); // the map fits the view again
    };
    panel.addEventListener('pointerup', end);
    panel.addEventListener('pointercancel', end);
    for (const type of ['contextmenu', 'dblclick', 'click']) panel.addEventListener(type, (e) => { e.stopPropagation(); e.preventDefault(); });

    return {
      el: panel,
      blocks(list) { all = list || []; dirty = true; soon(); },
      view(r) { viewBox = r; soon(); },
      size(s) {
        if (s.w === size.w && s.h === size.h) return;
        size = s;
        panel.style.width = `${s.w}px`;
        panel.style.height = `${s.h}px`;
        soon();
      },
      hide(on) {
        if (hidden === Boolean(on)) return;
        hidden = Boolean(on);
        panel.hidden = hidden;
        if (hidden) { drag = null; panel.classList.remove('wb-ov-dragging'); cancelAnimationFrame(frame); frame = 0; } else soon();
      },
      get hidden() { return hidden; },
      // For the checks in a browser: the map as drawn.
      get fit() { return fit; },
    };
  }
