  // ---- whiteboard-lib-e-block-shape.js: the closed shapes, flowchart ones too --------------------------------------------
  // { ...block, w, h, text, stroke, fill, ink, weight }: an outline (stroke, weight wide, or none) round a light fill (or
  // none) with words (ink) in the middle. Double-click to change the words. Every shape is its own block type, made by the
  // one definition below; another closed shape is one more entry in SHAPES: its type, its label, its usual size (w, h) and
  // smallest size (min, so its words still fit), draw(w, h, i) -> the SVG element of its outline, inset(w, h) -> where its
  // words sit ([top, right, bottom, left] in from the box), and, when a side's middle is not on the outline, anchorIn(w, h)
  // -> how far in a connector's end goes on that side ({ left, right, top, bottom }). Each is drawn inside its box: the
  // outline's middle is i (half its width) in from the edge.
  {
    const box = (w, h, i, rx) => wb.svg('rect', { x: i, y: i, width: Math.max(1, w - i * 2), height: Math.max(1, h - i * 2), rx: Math.max(0, rx) });
    const polygon = (pts) => wb.svg('polygon', { points: pts.map((p) => p.join(',')).join(' ') });
    // The parallelogram's slant: how far its top edge is pushed right of its bottom edge.
    const slant = (w, h) => Math.min(h * 0.35, w * 0.25);
    const SHAPES = [
      { type: 'rect', label: 'Rectangle', w: 160, h: 100, min: { w: 16, h: 16 }, draw: (w, h, i) => box(w, h, i, 4) },
      { type: 'ellipse', label: 'Ellipse', w: 160, h: 100, min: { w: 16, h: 16 }, draw: (w, h, i) => wb.svg('ellipse', { cx: w / 2, cy: h / 2, rx: Math.max(1, w / 2 - i), ry: Math.max(1, h / 2 - i) }) },
      // Flowchart shapes: a step (rounded box), a choice (diamond), a start or an end (pill), what goes in or out (parallelogram).
      { type: 'rounded', label: 'Rounded box', w: 160, h: 100, min: { w: 40, h: 28 }, draw: (w, h, i) => box(w, h, i, Math.min(16, w / 4, h / 4)) },
      {
        type: 'diamond',
        label: 'Diamond',
        w: 160,
        h: 120,
        min: { w: 64, h: 48 },
        draw: (w, h, i) => polygon([[w / 2, i], [w - i, h / 2], [w / 2, h - i], [i, h / 2]]),
        inset: (w, h) => [h / 4, w / 4, h / 4, w / 4], // the largest box inside a diamond is half as wide and half as high
      },
      {
        type: 'pill',
        label: 'Pill',
        w: 160,
        h: 64,
        min: { w: 56, h: 28 },
        draw: (w, h, i) => box(w, h, i, Math.min(w, h) / 2 - i),
        inset: (w, h) => [6, Math.min(w, h) * 0.3 + 4, 6, Math.min(w, h) * 0.3 + 4],
      },
      {
        type: 'parallelogram',
        label: 'Parallelogram',
        w: 180,
        h: 100,
        min: { w: 64, h: 32 },
        draw: (w, h, i) => { const s = slant(w, h); return polygon([[s + i, i], [w - i, i], [w - s - i, h - i], [i, h - i]]); },
        inset: (w, h) => { const s = slant(w, h) * 0.6 + 8; return [8, s, 8, s]; },
        anchorIn: (w, h) => { const s = slant(w, h) / 2; return { left: s, right: s }; },
      },
    ];
    for (const shape of SHAPES) {
      blockTypes.register({
        type: shape.type,
        label: shape.label,
        edit: 'text',
        markup: true,
        paint: { stroke: { extra: ['none'] }, fill: { extra: ['none'] }, ink: {} },
        weight: true,
        create: () => ({ w: shape.w, h: shape.h, text: '', stroke: 'ink', fill: 'ink', ink: 'ink', weight: 3 }),
        clean: (raw) => ({ w: wb.size(raw.w, shape.min.w, shape.w), h: wb.size(raw.h, shape.min.h, shape.h), text: wb.text(raw.text) }),
        box: (b) => ({ x: 0, y: 0, w: b.w, h: b.h }),
        resize: { handles: 'corners', min: shape.min },
        linked: [['x', 'y', 'w', 'h']], // its box
        ...(shape.anchorIn ? { anchorIn: (b) => shape.anchorIn(b.w, b.h) } : {}),
        render(b, el) {
          el.classList.add('wb-shape');
          const svg = wb.svg('svg', { class: 'wb-svg', width: b.w, height: b.h, viewBox: `0 0 ${b.w} ${b.h}`, 'aria-hidden': 'true' });
          const body = shape.draw(b.w, b.h, b.stroke === 'none' ? 0.5 : b.weight / 2);
          body.setAttribute('class', 'wb-hit wb-shape-body');
          svg.append(body);
          const words = document.createElement('div');
          words.className = 'wb-words';
          wbShowWords(words, b.text);
          const inset = shape.inset ? shape.inset(b.w, b.h) : [8, 8, 8, 8];
          el.style.setProperty('--wb-inset', inset.map((n) => `${Math.round(n)}px`).join(' '));
          el.replaceChildren(svg, words);
        },
        textOf: (el) => el.querySelector('.wb-words'),
        describe: (b) => { const t = wbPlain(b.text); return t ? `${shape.label}: ${t.slice(0, 80)}` : shape.label; },
      });
    }
  }
