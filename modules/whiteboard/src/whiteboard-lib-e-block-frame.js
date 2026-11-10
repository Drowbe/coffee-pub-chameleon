  // ---- whiteboard-lib-e-block-frame.js: a frame, a titled area that holds blocks, and presenting the frames ---------------
  // { ...block, w, h, title, fill, stroke, ink, weight }: a box with a faint wash (fill), a quiet border (stroke, weight
  // wide) and a title on a small tab above its top left corner (ink), one line of plain text (at most WB_FRAME.title
  // characters). Its colours are 'usual' until one is picked: the wash is the card colour, the border the field's edge,
  // the title the muted words (whiteboard.css), so a frame reads on every background. A frame is a `container` (lib-a):
  //   - it sits under the other blocks: a new one goes below every block that is not a frame and above the frames
  //     (wbFrameZ); the layer commands still move it like any block;
  //   - it is picked only by its tab or its border (a strip WB_FRAME.hit screen pixels wide, at any zoom: wbFrameHit says
  //     where a point is), never by its empty inside, so a press inside it does what it does on the board (a rectangle
  //     with Select, a drawing with a tool, the board moved with the Hand) and a click on a block inside picks that block;
  //     the rectangle that picks blocks picks a frame only when it covers the whole frame (wbFrameInRect); Tab still
  //     reaches it, and Enter on it, or a double-click on its tab, edits its title;
  //   - a block counts as inside it when its whole box (its type's box) is inside the frame's box at the moment of the
  //     action (wbFrameContents; a frame inside another counts as a block inside it). Moving a frame (a drag, the arrow
  //     keys, align or distribute) moves every block inside it by the same amount, in the same undo step; a locked block
  //     inside stays (wbFrameFollow). A copy, a cut or a duplicate of a frame takes the blocks inside it. A delete takes the
  //     frame alone. A resize moves nothing else;
  //   - no connector attaches to it (it is not wbAttachable).
  // Presenting (the page's, whiteboard.js "presenting"): the frames one at a time, each fitted in the view, in reading
  // order (wbFrameOrder), stepped through with a small bar and keys. The order, the steps and the view are the plain
  // functions below (wbPresent*), tested on their own; the page draws and listens.
  const WB_FRAME = {
    w: 480, h: 320, // a new frame's size (a click with the Frame tool, Add a frame in the +)
    min: { w: 80, h: 60 }, // the least a corner can make it
    title: 80, // the most characters in a title
    tab: 24, gap: 4, // the tab's height above the frame, and the gap under it, in board units
    hit: 8, touch: 16, // the border strip a press picks it by, in screen pixels (a finger: touch)
    margin: 48, // screen pixels round a frame fitted in the view while presenting
    bar: 56, // screen pixels at the bottom of the board the present bar takes
  };
  const WB_FRAME_WORD = 'Frame'; // a new frame's title, and what an untitled one is called
  // A title: one line (any run of line breaks or tabs is a space), at most WB_FRAME.title characters.
  const wbFrameTitle = (v) => (typeof v === 'string' ? v.replace(/[\r\n\t\u2028\u2029]+/g, ' ').slice(0, WB_FRAME.title) : '');
  // Whether a block is a frame (any block type marked container).
  const wbIsFrame = (b) => { const d = b && blockTypes.get(b.type); return Boolean(d && d.container); };

  // Whether box a ({ x0, y0, x1, y1 }) lies wholly inside box b: touching an edge is inside.
  const wbBoxInside = (a, b) => Boolean(a && b) && a.x0 >= b.x0 && a.y0 >= b.y0 && a.x1 <= b.x1 && a.y1 <= b.y1;
  // The ids of the blocks inside a frame now, among `blocks` (the frame itself and connectors never: a connector follows
  // its blocks). measure(block) -> the height as drawn, for a block whose height follows its words (wbRect, lib-m).
  function wbFrameContents(frame, blocks, measure = () => 0) {
    const box = wbRect(frame, measure);
    const out = [];
    for (const b of blocks) {
      if (b.id === frame.id) continue;
      const r = wbRect(b, measure);
      if (r && wbBoxInside(r, box)) out.push(b.id);
    }
    return out;
  }
  // What moves along with some moving blocks: moves are [{ id, dx, dy }] (a drag: the amounts do not matter); each frame
  // among them that is not locked takes the blocks inside it that are not among the moves themselves, each by its
  // frame's amount (a block inside two moving frames goes with the smaller, the one nearest it). A locked block inside
  // stays and is counted, unless keepLocked (a copy: it takes a locked frame's blocks too, and the locked ones inside).
  // Answers { moves: [{ id, dx, dy }] (the blocks taken along, in the order of `blocks`), locked }.
  function wbFrameFollow(moves, blocks, { measure = () => 0, keepLocked = false } = {}) {
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const moving = new Set(moves.map((m) => m.id));
    const owner = new Map(); // content id -> { move, area } of the smallest moving frame round it
    for (const m of moves) {
      const f = byId.get(m.id);
      if (!f || !wbIsFrame(f) || (f.locked === true && !keepLocked)) continue;
      const area = f.w * f.h;
      for (const id of wbFrameContents(f, blocks, measure)) {
        if (moving.has(id)) continue;
        const was = owner.get(id);
        if (!was || area < was.area) owner.set(id, { move: m, area });
      }
    }
    const out = [];
    let locked = 0;
    for (const b of blocks) {
      const o = owner.get(b.id);
      if (!o) continue;
      if (b.locked === true && !keepLocked) { locked += 1; continue; }
      out.push({ id: b.id, dx: o.move.dx, dy: o.move.dy });
    }
    return { moves: out, locked };
  }
  // The changes that move blocks by moves ([{ id, dx, dy }], blocks that may be moved) and every block inside a frame
  // among them along with it: [{ id, fields }] (each block type's move, wbMoved), and how many locked blocks inside were
  // left. The page saves them all in one turn: one undo step.
  function wbFrameMoveChanges(moves, blocks, { measure = () => 0 } = {}) {
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const along = wbFrameFollow(moves, blocks, { measure });
    const changes = [...moves, ...along.moves].filter((m) => byId.has(m.id)).map((m) => ({ id: m.id, fields: wbMoved(byId.get(m.id), m.dx, m.dy) }));
    return { changes, locked: along.locked };
  }
  // Whether the rectangle dragged to pick blocks (board units, any two corners) takes a frame: only when it covers the
  // frame's whole box.
  function wbFrameInRect(frameBox, r) {
    const q = { x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1), x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1) };
    return wbBoxInside(frameBox, q);
  }
  // Where a point on the board is for a frame: 'tab' (its title tab, above its top left corner: tab { w, h } in board
  // units, as drawn), 'border' (within half the strip of its outline, hit screen pixels in all, at this scale), 'inside'
  // (its empty middle: not the frame's) or 'outside'. The stylesheet draws the same parts (whiteboard.css, .wb-fr-edge and
  // .wb-fr-tab) and the browser finds them; this is the rule they follow.
  function wbFrameHit(frame, p, { scale = 1, hit = WB_FRAME.hit, tab = null } = {}) {
    const t = tab || { w: Math.min(frame.w, 120), h: WB_FRAME.tab };
    const x0 = frame.x; const y0 = frame.y; const x1 = frame.x + frame.w; const y1 = frame.y + frame.h;
    const tabTop = y0 - WB_FRAME.gap - t.h;
    if (p.x >= x0 && p.x <= x0 + t.w && p.y >= tabTop && p.y <= y0 - WB_FRAME.gap) return 'tab';
    const half = hit / 2 / (scale > 0 ? scale : 1);
    const near = p.x >= x0 - half && p.x <= x1 + half && p.y >= y0 - half && p.y <= y1 + half;
    if (!near) return 'outside';
    const deep = p.x > x0 + half && p.x < x1 - half && p.y > y0 + half && p.y < y1 - half;
    return deep ? 'inside' : 'border';
  }

  // The z for a new frame among `blocks`: under every block that is not a frame, over the frames already under them, so a
  // frame drawn inside another shows over it. (z may be any number, lib-a's wbBetween.)
  function wbFrameZ(blocks) {
    const others = blocks.filter((b) => !wbIsFrame(b));
    const low = others.length ? Math.min(...others.map((b) => b.z)) : Math.max(0, ...blocks.map((b) => b.z)) + 1;
    const under = blocks.filter((b) => wbIsFrame(b) && b.z < low);
    if (!under.length) return Math.floor(low) - 1;
    const high = Math.max(...under.map((b) => b.z));
    return (high + low) / 2;
  }

  // Reading order: by the top left corner. The frames are taken in rows: a row starts at the topmost frame left (the
  // leftmost of those as high) and holds every frame whose top is within half that first frame's height of its top; a
  // row is read left to right (ties: the higher, then by id), then the next row. Answers the ids in order.
  function wbFrameOrder(frames) {
    const left = frames.slice().sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
    const out = [];
    while (left.length) {
      const first = left[0];
      const reach = first.y + first.h / 2;
      const row = left.filter((f) => f.y <= reach);
      row.sort((a, b) => a.x - b.x || a.y - b.y || (a.id < b.id ? -1 : 1));
      for (const f of row) { out.push(f.id); left.splice(left.indexOf(f), 1); }
    }
    return out;
  }
  // The view ({ x, y, s }: the board's offset in screen pixels and its scale) that shows a box ({ x, y, w, h } in board
  // units) whole, in the middle of a w x h screen less `bottom` pixels at its foot (the present bar), with `margin` pixels
  // round it, at a scale held to [min, max] (a frame too small for max is shown at max, one too big for min at min).
  function wbFitView(box, w, h, { margin = WB_FRAME.margin, bottom = 0, min = 0.2, max = 4 } = {}) {
    const W = Math.max(1, w);
    const H = Math.max(1, h - bottom);
    const m = Math.min(margin, W / 4, H / 4);
    const s = Math.min(max, Math.max(min, Math.min((W - m * 2) / Math.max(1, box.w), (H - m * 2) / Math.max(1, box.h))));
    return { x: W / 2 - (box.x + box.w / 2) * s, y: H / 2 - (box.y + box.h / 2) * s, s };
  }

  // Presenting, as plain state: { order: frame ids in reading order, i: the one shown, view: the view to put back }.
  // Start: the frames on the board now (blocks; the others are ignored), the view as it is, and the frame to start at (its
  // id; else the first). null when there is no frame.
  function wbPresentStart(blocks, view, at = null) {
    const order = wbFrameOrder(blocks.filter(wbIsFrame));
    if (!order.length) return null;
    const i = at && order.includes(at) ? order.indexOf(at) : 0;
    return { order, i, view: { x: view.x, y: view.y, s: view.s } };
  }
  // A step: 'next', 'back', 'first', 'last' (held at the ends: next on the last stays there).
  function wbPresentGo(state, how) {
    if (!state) return null;
    const n = state.order.length;
    const i = how === 'next' ? state.i + 1 : how === 'back' ? state.i - 1 : how === 'first' ? 0 : how === 'last' ? n - 1 : state.i;
    return { ...state, i: Math.max(0, Math.min(n - 1, i)) };
  }
  // The frames changed while presenting (someone added, moved or deleted one): the order again; the frame shown stays
  // when it is still there, else the one now in its place (the last when it was past the end). null when none is left.
  // `same`: whether the frame shown is the same one.
  function wbPresentSync(state, blocks) {
    if (!state) return null;
    const order = wbFrameOrder(blocks.filter(wbIsFrame));
    if (!order.length) return null;
    const id = state.order[state.i];
    const keep = order.indexOf(id);
    const i = keep >= 0 ? keep : Math.min(state.i, order.length - 1);
    return { ...state, order, i, same: keep >= 0 };
  }
  // What is said for the frame shown: "Frame 2 of 5: Plan".
  function wbPresentWords(state, title) {
    const t = wbFrameTitle(title).trim();
    return `Frame ${state.i + 1} of ${state.order.length}${t ? `: ${t}` : ''}`;
  }

  // The dim while presenting (the Present bar's slider): how much of the board outside the frame shown is darkened, 0 to 100
  // in steps of 5, 60 at first. This person's choice in this browser, never in the board's data. store() -> localStorage.
  const WB_DIM = { key: 'whiteboard-present-dim', def: 60, max: 85 }; // max: the most the darkening shows at 100%, so shapes still read
  const wbDimValue = (v) => { const n = typeof v === 'string' && /^\d{1,3}$/.test(v) ? Number(v) : typeof v === 'number' ? v : NaN; return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n / 5) * 5 : WB_DIM.def; };
  function wbDimLoad(store) {
    try { const s = store(); return wbDimValue(s ? s.getItem(WB_DIM.key) : null); } catch { return WB_DIM.def; }
  }
  function wbDimSave(store, v) {
    try { const s = store(); if (!s) return false; s.setItem(WB_DIM.key, String(wbDimValue(v))); return true; } catch { return false; }
  }
  // The scrim's strength in percent of black for a dim value (0: none).
  const wbDimStrength = (v) => Math.round(wbDimValue(v) * WB_DIM.max) / 100;

  blockTypes.register({
    type: 'frame',
    label: 'Frame',
    container: true,
    edit: 'text',
    textField: 'title',
    textLine: true,
    textLabel: 'Frame title',
    textMax: WB_FRAME.title,
    editLabel: 'Rename',
    paint: { fill: { extra: ['none', 'usual'] }, stroke: { extra: ['none', 'usual'] }, ink: { label: 'Title', extra: ['usual'] } },
    weight: true,
    create: () => ({ w: WB_FRAME.w, h: WB_FRAME.h, title: WB_FRAME_WORD, fill: 'usual', stroke: 'usual', ink: 'usual', weight: 2 }),
    clean: (raw) => ({ w: wb.size(raw.w, WB_FRAME.min.w, WB_FRAME.w), h: wb.size(raw.h, WB_FRAME.min.h, WB_FRAME.h), title: wbFrameTitle(raw.title) }),
    box: (b) => ({ x: 0, y: 0, w: b.w, h: b.h }),
    // All it draws: the tab above it too.
    reach: (b) => ({ x: 0, y: -(WB_FRAME.tab + WB_FRAME.gap), w: b.w, h: b.h + WB_FRAME.tab + WB_FRAME.gap }),
    resize: { handles: 'corners', min: WB_FRAME.min },
    linked: [['x', 'y', 'w', 'h']], // its box
    render(b, el) {
      let tab = el.querySelector('.wb-fr-tab');
      if (!tab) {
        const face = document.createElement('div');
        face.className = 'wb-fr-face';
        const edges = ['n', 'e', 's', 'w'].map((side) => {
          const e = document.createElement('div');
          e.className = `wb-fr-edge wb-fr-${side}`;
          return e;
        });
        tab = document.createElement('div');
        tab.className = 'wb-fr-tab';
        const words = document.createElement('span');
        words.className = 'wb-words';
        tab.append(words);
        el.replaceChildren(face, ...edges, tab);
      }
      el.style.setProperty('--wb-fr-tab', `${WB_FRAME.tab}px`);
      el.style.setProperty('--wb-fr-gap', `${WB_FRAME.gap}px`);
      el.style.setProperty('--wb-fr-hit', `${WB_FRAME.hit}px`); // the border strip on the screen (a finger's: whiteboard.css)
      el.style.setProperty('--wb-fr-touch', `${WB_FRAME.touch}px`);
      const words = tab.querySelector('.wb-words');
      const t = b.title.trim();
      words.textContent = t || WB_FRAME_WORD;
      if (t) delete tab.dataset.empty; else tab.dataset.empty = 'true';
    },
    textOf: (el) => el.querySelector('.wb-fr-tab .wb-words'),
    describe: (b) => { const t = b.title.trim(); return t ? `Frame: ${t}` : 'Frame, untitled'; },
  });
