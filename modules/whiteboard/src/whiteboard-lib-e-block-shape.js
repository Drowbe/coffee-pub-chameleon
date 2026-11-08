  // ---- whiteboard-lib-e-block-shape.js: a rectangle and an ellipse --------------------------------------------------------
  // { ...block, w, h, text, tint }: an outline with a light fill of its colour and words in the middle. Double-click to
  // change the words. Both types are made by the one definition below; another closed shape is one more entry in SHAPES.
  {
    const SHAPES = [
      { type: 'rect', label: 'Rectangle', draw: (w, h) => wb.svg('rect', { x: 1.5, y: 1.5, width: Math.max(1, w - 3), height: Math.max(1, h - 3), rx: 4 }) },
      { type: 'ellipse', label: 'Ellipse', draw: (w, h) => wb.svg('ellipse', { cx: w / 2, cy: h / 2, rx: Math.max(1, w / 2 - 1.5), ry: Math.max(1, h / 2 - 1.5) }) },
    ];
    for (const shape of SHAPES) {
      blockTypes.register({
        type: shape.type,
        label: shape.label,
        edit: 'text',
        create: () => ({ w: 160, h: 100, text: '', tint: 'ink' }),
        clean: (raw) => ({ w: wb.size(raw.w, 8, 160), h: wb.size(raw.h, 8, 100), text: wb.text(raw.text), tint: wb.tint(raw.tint) }),
        box: (b) => ({ x: 0, y: 0, w: b.w, h: b.h }),
        render(b, el) {
          const svg = wb.svg('svg', { class: 'wb-svg', width: b.w, height: b.h, viewBox: `0 0 ${b.w} ${b.h}`, 'aria-hidden': 'true' });
          const body = shape.draw(b.w, b.h);
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
