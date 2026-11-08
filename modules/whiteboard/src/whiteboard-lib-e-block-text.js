  // ---- whiteboard-lib-e-block-text.js: words on the board -----------------------------------------------------------------
  // { ...block, w, text, tint }: words with no box, as wide as w and as tall as they need. A text block left empty when
  // its editing ends is taken away (the page decides that: textEmpty below).
  blockTypes.register({
    type: 'text',
    label: 'Text',
    edit: 'text',
    textEmpty: 'remove',
    create: () => ({ w: 240, text: '', tint: 'ink' }),
    clean: (raw) => ({ w: wb.size(raw.w, 40, 240), text: wb.text(raw.text), tint: wb.tint(raw.tint) }),
    box: (b) => ({ x: 0, y: 0, w: b.w, h: null }),
  resize: { handles: 'corners', min: { w: 40 }, height: false }, // a corner changes the width; the words set the height
    render(b, el) {
      let words = el.querySelector('.wb-words');
      if (!words) { words = document.createElement('div'); words.className = 'wb-words'; el.replaceChildren(words); }
      words.textContent = b.text;
    },
    textOf: (el) => el.querySelector('.wb-words'),
    describe: (b) => (b.text ? `Text: ${b.text.slice(0, 80)}` : 'Empty text'),
  });
