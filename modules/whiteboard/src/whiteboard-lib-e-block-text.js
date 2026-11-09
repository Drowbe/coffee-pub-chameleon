  // ---- whiteboard-lib-e-block-text.js: words on the board -----------------------------------------------------------------
  // { ...block, w, text, ink, fill, stroke, weight }: words (ink) as wide as w and as tall as they need, with no box unless
  // a background (fill) or a border (stroke) is picked. A text block left empty when its editing ends is taken away (the
  // page decides that: textEmpty below).
  blockTypes.register({
    type: 'text',
    label: 'Text',
    noun: () => 'text block',
    edit: 'text',
    markup: true,
    textEmpty: 'remove',
    paint: { stroke: { extra: ['none'] }, fill: { extra: ['none'] }, ink: {} },
    weight: true,
    create: () => ({ w: 240, text: '', ink: 'ink', fill: 'none', stroke: 'none', weight: 2 }),
    clean: (raw) => ({ w: wb.size(raw.w, 40, 240), text: wb.text(raw.text) }),
    box: (b) => ({ x: 0, y: 0, w: b.w, h: null }),
    resize: { handles: 'corners', min: { w: 40 }, height: false }, // a corner changes the width; the words set the height
    linked: [['x', 'y', 'w']], // its box (the words set the height)
    render(b, el) {
      let words = el.querySelector('.wb-words');
      if (!words) { words = document.createElement('div'); words.className = 'wb-words'; el.replaceChildren(words); }
      wbShowWords(words, b.text);
    },
    textOf: (el) => el.querySelector('.wb-words'),
    describe: (b) => { const t = wbPlain(b.text); return t ? `Text: ${t.slice(0, 80)}` : 'Empty text'; },
  });
