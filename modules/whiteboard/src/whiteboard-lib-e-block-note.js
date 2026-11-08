  // ---- whiteboard-lib-e-block-note.js: a sticky note --------------------------------------------------------------------
  // { ...block, w, h, text, tint }: a square of colour with words on it. Double-click to change the words.
  blockTypes.register({
    type: 'note',
    label: 'Note',
    edit: 'text',
    create: () => ({ w: 180, h: 180, text: '', tint: 'gold' }),
    clean: (raw) => ({ w: wb.size(raw.w, 40, 180), h: wb.size(raw.h, 40, 180), text: wb.text(raw.text), tint: wb.tint(raw.tint, 'gold') }),
    box: (b) => ({ x: 0, y: 0, w: b.w, h: b.h }),
    render(b, el) {
      let words = el.querySelector('.wb-words');
      if (!words) { words = document.createElement('div'); words.className = 'wb-words'; el.replaceChildren(words); }
      words.textContent = b.text;
    },
    textOf: (el) => el.querySelector('.wb-words'),
    describe: (b) => (b.text ? `Note: ${b.text.slice(0, 80)}` : 'Empty note'),
  });
