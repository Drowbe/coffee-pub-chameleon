  // ---- whiteboard-lib-e-block-note.js: a sticky note --------------------------------------------------------------------
  // { ...block, w, h, text, pointer, fill, stroke, ink, weight, size, align }: a square of its fill colour with words (ink) on it, a slight border
  // a little darker than the fill (stroke 'auto'; a colour of its own, or none, when one is picked) and a small shadow.
  // The words are markup (**bold**, lists, links: lib-j), drawn by the host's markdown, in a size and an alignment
  // (lib-a). Double-click to change the words; drag a corner to change its size.
  //
  // pointer: null, or { dx, dy }: a tail from the note to a tip, the tip dx, dy board units from the note's middle, so it
  // goes where the note goes. It is drawn as part of the note, one outline with the same fill, border and shadow: its base
  // sits on the side that faces the tip (worked out each time it is drawn, never saved), as wide as suits the note's size
  // and the tip's distance, and away from the corners. The tip stays between WB_POINTER.min and WB_POINTER.max board units
  // outside the note: a tip that would be inside it (the note made bigger) is pushed out past the nearest side, so every
  // save (a resize too) keeps it outside. Right-click menu: Add pointer, Remove pointer; with the note the one block
  // picked, its tip has a handle to drag (saved once, on the drop). The pointer is part of the note for a press, but not
  // part of its box: a corner resizes the note's body only. A screen reader is not told it is there.
  const WB_POINTER = { min: 12, max: 800 };
  // The tip's offset from the middle of a w x h note, kept outside it: between min and max board units from the nearest
  // point of the note; a tip inside it goes just outside the nearest side. Half a unit of slack, so a tip stored rounded
  // stays as it is when it is read again.
  function wbPointerClamp(w, h, dx, dy) {
    const hw = w / 2; const hh = h / 2;
    const round = (n) => Math.round(n * 10) / 10;
    const cx = Math.max(-hw, Math.min(hw, dx));
    const cy = Math.max(-hh, Math.min(hh, dy));
    const d = Math.hypot(dx - cx, dy - cy);
    if (d === 0) {
      // Inside: out past the side it is nearest, by min (straight down when it is in the very middle).
      const gaps = [['bottom', hh - dy], ['top', dy + hh], ['right', hw - dx], ['left', dx + hw]];
      const [side] = gaps.reduce((a, b) => (b[1] < a[1] ? b : a));
      if (side === 'bottom') return { dx: round(dx), dy: round(hh + WB_POINTER.min) };
      if (side === 'top') return { dx: round(dx), dy: round(-hh - WB_POINTER.min) };
      if (side === 'right') return { dx: round(hw + WB_POINTER.min), dy: round(dy) };
      return { dx: round(-hw - WB_POINTER.min), dy: round(dy) };
    }
    let k = 1;
    if (d < WB_POINTER.min - 0.5) k = WB_POINTER.min / d;
    else if (d > WB_POINTER.max + 0.5) k = WB_POINTER.max / d;
    return { dx: round(cx + (dx - cx) * k), dy: round(cy + (dy - cy) * k) };
  }
  // A new pointer: below the note and a little left of its middle.
  const wbPointerStart = (w, h) => wbPointerClamp(w, h, -w / 4, h / 2 + 48);
  // The outline of a note with its pointer, in the note's own units (0, 0 its top left corner): { side, base: [from, to]
  // along that side, path }. r: the corners' radius; i: how far in the outline runs (half the border, so the border is
  // inside the box as the note's own border is). The side is the one facing the tip across the wider gap, as a
  // connector's end picks one; the base is about 28% of the shorter side (12 to 56 units, narrower for a tip close by),
  // centred where the tip is along that side, kept clear of the corners. Plain arithmetic, tested on its own.
  function wbPointerShape(w, h, pointer, r = 0, i = 0) {
    const tx = w / 2 + pointer.dx; const ty = h / 2 + pointer.dy;
    const gx = Math.abs(pointer.dx) - w / 2; const gy = Math.abs(pointer.dy) - h / 2;
    const side = gx >= gy ? (pointer.dx >= 0 ? 'right' : 'left') : (pointer.dy >= 0 ? 'bottom' : 'top');
    const x0 = i; const y0 = i; const x1 = w - i; const y1 = h - i;
    const rr = Math.max(0, Math.min(r - i, (x1 - x0) / 2, (y1 - y0) / 2)); // the border's middle, as CSS rounds it
    const across = side === 'top' || side === 'bottom';
    const lo = across ? x0 + rr : y0 + rr; // the stretch of the side clear of the corners
    const hi = across ? x1 - rr : y1 - rr;
    const dist = across ? (side === 'top' ? y0 - ty : ty - y1) : (side === 'left' ? x0 - tx : tx - x1);
    let base = Math.max(12, Math.min(56, Math.min(w, h) * 0.28));
    base = Math.min(base, Math.max(10, dist * 1.5), Math.max(2, hi - lo - 2));
    const along = across ? tx : ty;
    const mid = Math.max(lo + base / 2, Math.min(hi - base / 2, along));
    const a = mid - base / 2; const b = mid + base / 2;
    const f = (n) => Math.round(n * 100) / 100;
    const L = (x, y) => `L${f(x)} ${f(y)}`;
    const arc = (x, y) => (rr > 0 ? `A${f(rr)} ${f(rr)} 0 0 1 ${f(x)} ${f(y)}` : '');
    const tip = L(tx, ty);
    let d = `M${f(x0 + rr)} ${f(y0)}`;
    if (side === 'top') d += L(a, y0) + tip + L(b, y0);
    d += L(x1 - rr, y0) + arc(x1, y0 + rr);
    if (side === 'right') d += L(x1, a) + tip + L(x1, b);
    d += L(x1, y1 - rr) + arc(x1 - rr, y1);
    if (side === 'bottom') d += L(b, y1) + tip + L(a, y1);
    d += L(x0 + rr, y1) + arc(x0, y1 - rr);
    if (side === 'left') d += L(x0, b) + tip + L(x0, a);
    d += `${L(x0, y0 + rr)}${arc(x0 + rr, y0)}Z`;
    return { side, base: [f(a), f(b)], path: d };
  }
  {
    // The radius of a note's corners, the theme's --radius-min, read once from a note on the board.
    let radius = null;
    const radiusOf = (el) => {
      if (radius === null && el.isConnected) radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      return radius || 0;
    };
    const pointerOf = (raw, w, h) => {
      const p = raw && typeof raw === 'object' ? raw : null;
      const dx = p ? wb.num(p.dx, WB_LIMITS.size) : null;
      const dy = p ? wb.num(p.dy, WB_LIMITS.size) : null;
      return dx === null || dy === null ? null : wbPointerClamp(w, h, dx, dy);
    };
    blockTypes.register({
      type: 'note',
      label: 'Note',
      edit: 'text',
      markup: true,
      valign: 'top', // the usual (a note without the field): the words start at the top
      paint: { stroke: { extra: ['auto', 'none'] }, fill: {}, ink: {} },
      weight: true,
      create: () => ({ w: 180, h: 180, text: '', pointer: null, fill: 'gold', stroke: 'auto', ink: 'ink', weight: 1, size: 'medium', align: 'left' }),
      clean(raw) {
        const w = wb.size(raw.w, 40, 180);
        const h = wb.size(raw.h, 40, 180);
        return { w, h, text: wb.text(raw.text), pointer: pointerOf(raw.pointer, w, h) };
      },
      box: (b) => ({ x: 0, y: 0, w: b.w, h: b.h }),
      // The body and the tip, with room for the border.
      reach(b) {
        if (!b.pointer) return { x: 0, y: 0, w: b.w, h: b.h };
        const tx = b.w / 2 + b.pointer.dx; const ty = b.h / 2 + b.pointer.dy;
        const pad = b.weight;
        const x = Math.min(0, tx - pad); const y = Math.min(0, ty - pad);
        return { x, y, w: Math.max(b.w, tx + pad) - x, h: Math.max(b.h, ty + pad) - y };
      },
      resize: { handles: 'corners', min: { w: 40, h: 40 } },
      // Its box. The pointer is a field of its own: its tip is kept from the note's middle, so a move leaves it as it is.
      linked: [['x', 'y', 'w', 'h']],
      grips: (b) => (b.pointer ? [{ id: 'tip', x: b.w / 2 + b.pointer.dx, y: b.h / 2 + b.pointer.dy }] : []),
      grip: (b, id, at) => (id === 'tip' ? { pointer: wbPointerClamp(b.w, b.h, at.x - (b.x + b.w / 2), at.y - (b.y + b.h / 2)) } : {}),
      actions: (b) => (b.pointer
        ? [{ id: 'pointer-remove', label: 'Remove pointer', icon: 'comment-slash', fields: { pointer: null } }]
        : [{ id: 'pointer-add', label: 'Add pointer', icon: 'comment', fields: { pointer: wbPointerStart(b.w, b.h) } }]),
      render(b, el) {
        let words = el.querySelector(':scope > .wb-words');
        if (!words) { words = document.createElement('div'); words.className = 'wb-words'; el.replaceChildren(words); }
        wbShowWords(words, b.text);
        // With a pointer, the note and its tail are one outline drawn behind the words (whiteboard.css, [data-pointer]).
        let svg = el.querySelector(':scope > .wb-note-shape');
        if (!b.pointer) { if (svg) svg.remove(); delete el.dataset.pointer; return; }
        if (!svg) {
          svg = wb.svg('svg', { class: 'wb-svg wb-note-shape', 'aria-hidden': 'true' });
          svg.append(wb.svg('path', { class: 'wb-hit wb-note-outline' }));
          el.insertBefore(svg, words);
        }
        el.dataset.pointer = '';
        svg.setAttribute('width', b.w); svg.setAttribute('height', b.h); svg.setAttribute('viewBox', `0 0 ${b.w} ${b.h}`);
        const inset = b.stroke === 'none' ? 0 : b.weight / 2;
        svg.firstChild.setAttribute('d', wbPointerShape(b.w, b.h, b.pointer, radiusOf(el), inset).path);
      },
      textOf: (el) => el.querySelector(':scope > .wb-words'),
      describe: (b) => { const t = wbPlain(b.text); return t ? `Note: ${t.slice(0, 80)}` : 'Empty note'; },
    });
  }
