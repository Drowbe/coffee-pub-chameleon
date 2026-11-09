  // ---- whiteboard-lib-e-block-shape.js: a rectangle and an ellipse --------------------------------------------------------
  // { ...block, w, h, text, stroke, fill, ink, weight }: an outline (stroke, weight wide, or none) round a light fill (or
  // none) with words (ink) in the middle. Double-click to change the words. Both types are made by the one definition
  // below; another closed shape is one more entry in SHAPES. Each is drawn inside its box: the outline's middle is half its
  // width in from the edge.
  {
    const SHAPES = [
      { type: 'rect', label: 'Rectangle', draw: (w, h, i) => wb.svg('rect', { x: i, y: i, width: Math.max(1, w - i * 2), height: Math.max(1, h - i * 2), rx: 4 }) },
      { type: 'ellipse', label: 'Ellipse', draw: (w, h, i) => wb.svg('ellipse', { cx: w / 2, cy: h / 2, rx: Math.max(1, w / 2 - i), ry: Math.max(1, h / 2 - i) }) },
    ];
    for (const shape of SHAPES) {
      blockTypes.register({
        type: shape.type,
        label: shape.label,
        edit: 'text',
        paint: { stroke: { extra: ['none'] }, fill: { extra: ['none'] }, ink: {} },
        weight: true,
        create: () => ({ w: 160, h: 100, text: '', stroke: 'ink', fill: 'ink', ink: 'ink', weight: 3 }),
        clean: (raw) => ({ w: wb.size(raw.w, 8, 160), h: wb.size(raw.h, 8, 100), text: wb.text(raw.text) }),
        box: (b) => ({ x: 0, y: 0, w: b.w, h: b.h }),
        resize: { handles: 'corners', min: { w: 16, h: 16 } },
        render(b, el) {
          const svg = wb.svg('svg', { class: 'wb-svg', width: b.w, height: b.h, viewBox: `0 0 ${b.w} ${b.h}`, 'aria-hidden': 'true' });
          const body = shape.draw(b.w, b.h, b.stroke === 'none' ? 0.5 : b.weight / 2);
          body.setAttribute('class', 'wb-hit wb-shape-body');
          svg.append(body);
          const words = document.createElement('div');
          words.className = 'wb-words';
          words.textContent = b.text;
          el.replaceChildren(svg, words);
        },
        textOf: (el) => el.querySelector('.wb-words'),
        describe: (b) => (b.text ? `${shape.label}: ${b.text.slice(0, 80)}` : shape.label),
      });
    }
  }
