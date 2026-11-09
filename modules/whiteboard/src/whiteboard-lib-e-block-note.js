  // ---- whiteboard-lib-e-block-note.js: a sticky note --------------------------------------------------------------------
  // { ...block, w, h, text, fill, stroke, ink, weight }: a square of its fill colour with words (ink) on it, a slight border
  // a little darker than the fill (stroke 'auto'; a colour of its own, or none, when one is picked) and a small shadow.
  // Double-click to change the words; drag a corner to change its size. Room for a pointer later (a tail to what the note
  // is about): another field of its own here, drawn by render outside the square.
  blockTypes.register({
    type: 'note',
    label: 'Note',
    edit: 'text',
    paint: { stroke: { extra: ['auto', 'none'] }, fill: {}, ink: {} },
    weight: true,
    create: () => ({ w: 180, h: 180, text: '', fill: 'gold', stroke: 'auto', ink: 'ink', weight: 1 }),
    clean: (raw) => ({ w: wb.size(raw.w, 40, 180), h: wb.size(raw.h, 40, 180), text: wb.text(raw.text) }),
    box: (b) => ({ x: 0, y: 0, w: b.w, h: b.h }),
    resize: { handles: 'corners', min: { w: 40, h: 40 } },
    linked: [['x', 'y', 'w', 'h']], // its box
    render(b, el) {
      let words = el.querySelector('.wb-words');
      if (!words) { words = document.createElement('div'); words.className = 'wb-words'; el.replaceChildren(words); }
      words.textContent = b.text;
    },
    textOf: (el) => el.querySelector('.wb-words'),
    describe: (b) => (b.text ? `Note: ${b.text.slice(0, 80)}` : 'Empty note'),
  });
