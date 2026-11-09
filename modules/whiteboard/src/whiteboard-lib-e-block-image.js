  // ---- whiteboard-lib-e-block-image.js: a picture ------------------------------------------------------------------------
  // { ...block, upload, w, h, alt, stroke, weight }: a picture from the person's computer, kept as one of the module's
  // uploads (upload: its id; the bytes are never in the block), drawn w by h board units, with a few words that say what it
  // shows (alt: what a screen reader reads, and the tooltip) and a border only when one is picked (stroke 'none' at first).
  // A corner changes its size and always keeps its shape. Double-click (or Enter) to describe it. Copies share the upload,
  // and deleting the block leaves the upload where it is, so an undo brings the same picture back (lib-i, and the page).
  //
  // Where a picture is read from is the page's: it sets source(upload, thumb) -> a promise of the address. The thumbnail
  // (about 400 px) is shown while the block is small enough for it (its longest side, in the screen's pixels at 100%, fits
  // 400), else the whole picture, and the whole picture when there is no thumbnail. A picture that is not there any more
  // (its upload was removed) shows "Picture not found" in its place.
  {
    const THUMB = 400;
    const UPLOAD = /^[a-f0-9]{24}$/;
    const addresses = new Map(); // `${upload}:${thumb}` -> a promise of the address
    const noThumb = new Set(); // uploads whose thumbnail could not be read: the whole picture from then on
    // The words that describe a picture: one line, at most 300 characters.
    const altOf = (v) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').slice(0, 300) : '');

    function show(def, el, img, upload, thumb) {
      const t = thumb && !noThumb.has(upload);
      const want = `${upload}:${t ? 1 : 0}`;
      if (img.dataset.want === want) return;
      img.dataset.want = want;
      delete el.dataset.missing;
      if (!def.source) return;
      let address = addresses.get(want);
      if (!address) { address = Promise.resolve(def.source(upload, t)); addresses.set(want, address); }
      address.then((src) => { if (img.dataset.want === want) img.src = src; }, () => { addresses.delete(want); el.dataset.missing = 'true'; });
    }

    blockTypes.register({
      type: 'image',
      label: 'Picture',
      noun: () => 'picture',
      edit: 'text',
      // The words edited are the description: one short line under the picture.
      textField: 'alt',
      textLine: true,
      textLabel: 'Describe the picture',
      textMax: 300,
      editLabel: 'Describe',
      paint: { stroke: { extra: ['none'] } },
      weight: true,
      create: () => ({ upload: '', w: 320, h: 240, alt: '', stroke: 'none', weight: 2 }),
      clean(raw) {
        // A picture with no upload is not a block: nothing is ever saved that points at a file that is not there yet.
        if (typeof raw.upload !== 'string' || !UPLOAD.test(raw.upload)) return null;
        return { upload: raw.upload, w: wb.size(raw.w, 24, 320), h: wb.size(raw.h, 24, 240), alt: altOf(raw.alt) };
      },
      altOf,
      box: (b) => ({ x: 0, y: 0, w: b.w, h: b.h }),
      // keep: a corner always keeps the picture's shape (Shift is not needed).
      resize: { handles: 'corners', min: { w: 24, h: 24 }, keep: true },
      linked: [['x', 'y', 'w', 'h']], // its box
      source: null,
      render(b, el) {
        let img = el.querySelector('.wb-picture');
        if (!img) {
          img = document.createElement('img');
          img.className = 'wb-picture';
          img.alt = ''; // the block itself carries the description (its aria-label)
          img.draggable = false;
          img.decoding = 'async';
          img.addEventListener('error', () => {
            const [upload, t] = (img.dataset.want || ':').split(':');
            if (t === '1') { noThumb.add(upload); show(this, el, img, upload, false); } else el.dataset.missing = 'true';
          });
          const missing = document.createElement('div');
          missing.className = 'wb-missing';
          missing.setAttribute('aria-hidden', 'true');
          missing.textContent = 'Picture not found';
          const alt = document.createElement('div');
          alt.className = 'wb-alt';
          alt.setAttribute('aria-hidden', 'true');
          el.replaceChildren(img, missing, alt);
        }
        if (b.alt) el.title = b.alt; else el.removeAttribute('title');
        const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        show(this, el, img, b.upload, Math.max(b.w, b.h) * ratio <= THUMB);
      },
      textOf: (el) => el.querySelector('.wb-alt'),
      // Saved as a picture (lib-l): the upload put in as a data URL (the thumbnail while it is big enough for the picture's
      // pixels), so the picture holds it; one that cannot be read is drawn as "Picture not found". Printed, as it is shown.
      async exported(b, el, ctx) {
        if (ctx.live) return;
        const img = el.querySelector('.wb-picture');
        if (!img) return;
        img.removeAttribute('decoding');
        const src = await ctx.picture(b.upload, Math.max(b.w, b.h) * ctx.scale <= THUMB);
        if (src) { img.setAttribute('src', src); delete el.dataset.missing; } else { img.removeAttribute('src'); el.dataset.missing = 'true'; }
      },
      describe: (b) => (b.alt ? `Picture: ${b.alt.slice(0, 120)}` : 'Picture'),
    });
  }
