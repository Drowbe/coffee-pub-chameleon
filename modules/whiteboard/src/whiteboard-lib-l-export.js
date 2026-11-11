  // ---- whiteboard-lib-l-export.js: the board as a picture (PNG), and ready to print ----------------------------------------
  //
  // What is exported is what the board shows: each block's element, as its block type drew it (the words through
  // wbShowWords, the one HTML sink, so nothing a person wrote reaches the picture any other way), copied into an SVG
  // <foreignObject> the size of the part of the board exported. Nothing of the selection is in it: the frame, the handles,
  // the grips, the ports, the marquee, the Fill tool's mark, a table's active cell and an open text box are left out.
  //
  // A PNG: the copy, the module's own CSS rules that apply to it, the theme's tokens as they are now (read from the page,
  // never stored) and the page's fonts (fetched once, as data URLs) go into one SVG document, drawn on a canvas and saved
  // as a PNG. Everything in it is inline (a picture is fetched and put in as a data URL): an SVG image may load nothing from
  // outside, and the SVG goes in as a data: URL, since a blob: URL with a <foreignObject> taints the canvas in Chromium.
  // Text that cannot be in XML (control characters) is left out of the copy, never of the board. A picture that does not
  // load is drawn as its "Picture not found" frame.
  //
  // Print: the same copy, kept in the page (so it follows the colours the host shows while it prints, its light ones), in an
  // SVG as wide as the paper and at most a page tall (whiteboard.css, .wb-print). The host prints the module's content.
  //
  // A block type may draw its copy differently: exported?(block, el, ctx) changes the copy (el), and may answer a promise.
  // ctx: { live } (true: the copy stays in the page, for print), { scale } (the picture's pixels per board unit) and
  // picture(upload, thumb) -> a promise of a data URL of an upload, or null when it cannot be read.
  //
  // Not offered: an SVG file. The picture is HTML in a <foreignObject>, which a browser draws but most drawing programs and
  // viewers do not, so the PNG is the one format.
  const WB_EXPORT = {
    margin: 32, // board units round everything or the selection (none round what is in sight)
    side: 16384, // the longest side of a canvas most browsers make, in pixels
    area: 64 * 1024 * 1024, // the most pixels in one picture (a 2x board past it is made smaller, and the person told)
    thumb: 400, // a picture block at most this many pixels on its long side uses its thumbnail
    fontBytes: 1024 * 1024, // the most font data put in one picture
  };
  const WB_EXPORT_KINDS = [
    { id: 'all', label: 'Everything' },
    { id: 'selection', label: 'What is selected' },
    { id: 'view', label: 'What is in sight' },
  ];

  // Whether two boxes ({ x0, y0, x1, y1 }) overlap.
  const wbOverlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

  // Which blocks a kind of export takes, bottom to top. list: every block bottom to top as { id, rect ({ x0, y0, x1, y1 }:
  // all it draws on the board, or null when it is not drawn), refs (the ids it is attached to) }; picked: a Set of ids;
  // view: what is in sight, a box on the board. The selection takes the picked blocks and every connector whose blocks are
  // all among them, as a copy does. 'frame' is a frame's box (handed as view): every block it overlaps, the frame too.
  function wbExportPick(kind, list, { picked = new Set(), view = null } = {}) {
    const drawn = list.filter((x) => x && x.rect);
    if (kind === 'selection') {
      const ids = new Set(drawn.filter((x) => picked.has(x.id)).map((x) => x.id));
      if (!ids.size) return [];
      return drawn.filter((x) => ids.has(x.id) || (x.refs && x.refs.length && x.refs.every((r) => ids.has(r)))).map((x) => x.id);
    }
    if (kind === 'view' || kind === 'frame') return view ? drawn.filter((x) => wbOverlap(x.rect, view)).map((x) => x.id) : [];
    return drawn.map((x) => x.id);
  }

  // The part of the board a picture shows, in whole board units ({ x, y, w, h }), or null when there is nothing to show.
  // 'view' and 'frame': the box as it is (a frame's picture is the frame's size); else every rect with `margin` round them.
  function wbExportExtent(kind, rects, { view = null, margin = WB_EXPORT.margin } = {}) {
    let r = null;
    if (kind === 'view' || kind === 'frame') r = view;
    else {
      for (const q of rects) {
        if (!q) continue;
        r = r ? { x0: Math.min(r.x0, q.x0), y0: Math.min(r.y0, q.y0), x1: Math.max(r.x1, q.x1), y1: Math.max(r.y1, q.y1) } : { ...q };
      }
      if (r) r = { x0: r.x0 - margin, y0: r.y0 - margin, x1: r.x1 + margin, y1: r.y1 + margin };
    }
    if (!r || ![r.x0, r.y0, r.x1, r.y1].every(Number.isFinite)) return null;
    const x = Math.floor(r.x0);
    const y = Math.floor(r.y0);
    return { x, y, w: Math.max(1, Math.ceil(r.x1) - x), h: Math.max(1, Math.ceil(r.y1) - y) };
  }

  // The picture's size in pixels for an extent at a scale (pixels per board unit), kept inside what a browser can make:
  // { width, height, scale (the one used), clamped (true when it had to be smaller than asked) }.
  function wbExportSize(extent, scale, cap = WB_EXPORT) {
    const want = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const s = Math.min(want, cap.side / extent.w, cap.side / extent.h, Math.sqrt(cap.area / (extent.w * extent.h)));
    const width = Math.max(1, Math.min(cap.side, Math.floor(extent.w * s)));
    const height = Math.max(1, Math.min(cap.side, Math.floor(extent.h * s)));
    return { width, height, scale: s, clamped: s < want - 1e-9 };
  }

  // A file name: the board's name, the day and the time ("Whiteboard 2026-11-09 1405.png"), with nothing a computer's
  // file names refuse.
  function wbExportName(base, date, ext = 'png') {
    const name = String(base || '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Whiteboard';
    const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const two = (n) => String(n).padStart(2, '0');
    return `${name} ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}${two(d.getMinutes())}.${ext}`;
  }

  // Text made fit for XML: the characters XML 1.0 cannot hold (most control characters, a lone half of a surrogate pair,
  // U+FFFE and U+FFFF) left out. A string; anything else becomes ''.
  function wbXmlSafe(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  }

  // The words a person reads about a picture's size: "2400 × 1600 pixels".
  const wbExportPixels = (size) => `${size.width} × ${size.height} pixels`;

  // The exporter, for one board. root: the module's root (its stylesheets); world: the layer the blocks are drawn in;
  // picture(upload, thumb) -> a promise of a Blob of an upload (the page's).
  function createExporter({ root, world, picture }) {
    const SVG = 'http://www.w3.org/2000/svg';
    const XHTML = 'http://www.w3.org/1999/xhtml';
    const fonts = new Map(); // a font file's address -> a promise of its data URL, or '' when it could not be read

    const dataUrl = (blob) => new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error || new Error('could not read'));
      r.readAsDataURL(blob);
    });

    // The copy of a block's element, without anything of the selection or of editing, safe for XML.
    function copyOf(el) {
      const c = el.cloneNode(true);
      for (const n of c.querySelectorAll('.wb-text-edit, .wb-format, .wb-fr-notes')) n.remove();
      for (const n of [c, ...c.querySelectorAll('*')]) {
        n.classList.remove('wb-editing');
        if (n.dataset) delete n.dataset.mark;
        n.removeAttribute('tabindex');
        n.removeAttribute('id');
        for (const a of [...n.attributes]) {
          if (a.name.startsWith('aria-') || a.name === 'role') n.removeAttribute(a.name);
          else if (wbXmlSafe(a.value) !== a.value) n.setAttribute(a.name, wbXmlSafe(a.value));
        }
      }
      const walk = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
      for (let t = walk.nextNode(); t; t = walk.nextNode()) { const v = wbXmlSafe(t.data); if (v !== t.data) t.data = v; }
      return c;
    }

    // The SVG with the blocks' copies in it, showing `extent`. items: [{ block, el }] bottom to top. live: for print (it
    // stays in the page); scale: the picture's pixels per board unit; background: what its page is filled with (the
    // board's background as a CSS colour of theme tokens, for print; '' : nothing, the paper).
    async function scene(items, extent, { live = false, scale = 1, background = '' } = {}) {
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('viewBox', `${extent.x} ${extent.y} ${extent.w} ${extent.h}`);
      const fo = document.createElementNS(SVG, 'foreignObject');
      for (const [k, v] of Object.entries({ x: extent.x, y: extent.y, width: extent.w, height: extent.h })) fo.setAttribute(k, String(v));
      const page = document.createElementNS(XHTML, 'div');
      page.setAttribute('class', 'wb-export');
      page.style.width = `${extent.w}px`;
      page.style.height = `${extent.h}px`;
      if (background) page.style.background = background;
      const layer = document.createElementNS(XHTML, 'div');
      layer.setAttribute('class', 'wb-export-layer');
      layer.style.left = `${-extent.x}px`;
      layer.style.top = `${-extent.y}px`;
      page.append(layer);
      fo.append(page);
      svg.append(fo);
      const ctx = {
        live,
        scale,
        async picture(upload, thumb) {
          try { return await dataUrl(await picture(upload, thumb)); } catch { /* the whole picture, then none */ }
          if (!thumb) return null;
          try { return await dataUrl(await picture(upload, false)); } catch { return null; }
        },
      };
      const jobs = [];
      for (const { block, el } of items) {
        const c = copyOf(el);
        layer.append(c);
        const def = blockTypes.get(block.type);
        if (def && def.exported) jobs.push(Promise.resolve().then(() => def.exported(block, c, ctx)).catch(() => {}));
      }
      await Promise.all(jobs);
      return { svg, page };
    }

    // The CSS rules of the module's own stylesheets that apply to something on the board, as text. A rule whose selector
    // matches nothing in the world now (a hover, the narrow layout's) is left out; @media, @supports and @container keep
    // what is inside them that applies.
    function rules() {
      const sheets = [...(root.styleSheets || []), ...(root.adoptedStyleSheets || [])];
      const applies = (sel) => {
        const plain = sel.replace(/::?(before|after|placeholder|marker|selection|backdrop|-webkit-[\w-]+|-moz-[\w-]+)\b/g, '');
        try { return Boolean(world.querySelector(plain.trim() || '*')); } catch { return false; }
      };
      const keep = (list) => {
        const out = [];
        for (const rule of list) {
          if (rule.selectorText !== undefined && rule.style) { if (applies(rule.selectorText)) out.push(rule.cssText); continue; }
          if (rule.cssRules && /^@(media|supports|container)/i.test(rule.cssText)) {
            const inner = keep(rule.cssRules);
            if (inner.length) out.push(`${rule.cssText.slice(0, rule.cssText.indexOf('{'))}{${inner.join('\n')}}`);
          }
        }
        return out;
      };
      const out = [];
      for (const s of sheets) { let list; try { list = s.cssRules; } catch { continue; } out.push(...keep(list)); }
      return out.join('\n');
    }

    // The page's own font faces for the fonts the board's words use, each file put in as a data URL (an SVG image may not
    // fetch one); the system's fonts (local()) as they are. Up to WB_EXPORT.fontBytes in all.
    async function fontFaces(families) {
      const want = new Set(families.map((f) => f.trim().replace(/^["']|["']$/g, '').toLowerCase()).filter(Boolean));
      const faces = [];
      const visit = (list, base) => {
        for (const rule of list) {
          if (rule.cssRules && !rule.selectorText) { try { visit(rule.cssRules, base); } catch { /* not readable */ } continue; }
          if (!/^@font-face/i.test(rule.cssText || '')) continue;
          const fam = (rule.style.getPropertyValue('font-family') || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
          if (want.has(fam)) faces.push({ text: rule.cssText, base });
        }
      };
      for (const s of [...document.styleSheets, ...(root.styleSheets || [])]) {
        let list;
        try { list = s.cssRules; } catch { continue; }
        visit(list, s.href || document.baseURI);
      }
      let bytes = 0;
      const out = [];
      for (const face of faces) {
        let text = face.text;
        const urls = [...text.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)];
        let ok = true;
        for (const m of urls) {
          let href;
          try { href = new URL(m[2], face.base); } catch { ok = false; break; }
          if (href.protocol === 'data:') continue;
          if (href.origin !== location.origin) { ok = false; break; }
          if (!fonts.has(href.href)) fonts.set(href.href, fetch(href.href).then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? dataUrl(b) : '')).catch(() => ''));
          const data = await fonts.get(href.href);
          if (!data || bytes + data.length > WB_EXPORT.fontBytes) { ok = false; break; }
          bytes += data.length;
          text = text.split(m[0]).join(`url("${data}")`);
        }
        if (ok) out.push(text);
      }
      return out.join('\n');
    }

    // The theme's tokens the rules and the copies use, as they are now in the page, set on the picture's page.
    function tokens(page, css) {
      const seen = new Set();
      const inline = [...page.querySelectorAll('[style]')].map((n) => n.getAttribute('style')).join('\n');
      for (const m of `${css}\n${inline}`.matchAll(/var\(\s*(--[\w-]+)/g)) seen.add(m[1]);
      const cs = getComputedStyle(world);
      for (const name of seen) {
        if (name.startsWith('--wb-') && !name.startsWith('--wb-fixed-')) continue; // the board's own, set by its rules and on each block
        const v = cs.getPropertyValue(name).trim();
        if (v) page.style.setProperty(name, wbXmlSafe(v));
      }
      page.style.setProperty('--wb-scale', '1');
      for (const p of ['font-family', 'font-size', 'line-height', 'color', 'color-scheme', 'font-weight', 'letter-spacing']) {
        const v = cs.getPropertyValue(p);
        if (v) page.style.setProperty(p, wbXmlSafe(v));
      }
    }

    // The picture as a PNG Blob. items: [{ block, el }] bottom to top; extent on the board; size from wbExportSize;
    // background: a colour the canvas is filled with first (read from the page), or '' for see-through. step(words) hears
    // how far it is.
    async function png(items, extent, size, { background = '', step = () => {} } = {}) {
      step('Getting the pictures ready');
      const { svg, page } = await scene(items, extent, { scale: size.scale });
      step('Drawing the board');
      const css = rules();
      tokens(page, css);
      const families = getComputedStyle(world).fontFamily.split(',');
      const faces = await fontFaces(families);
      const style = document.createElementNS(SVG, 'style');
      style.textContent = wbXmlSafe(`${faces}\n${css}\n.wb-export { position: relative; overflow: hidden; margin: 0; }\n.wb-export-layer { position: absolute; width: 0; height: 0; }`);
      svg.insertBefore(style, svg.firstChild);
      svg.setAttribute('width', String(size.width));
      svg.setAttribute('height', String(size.height));
      svg.setAttribute('xmlns', SVG);
      const text = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.decoding = 'sync';
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
      try { await img.decode(); } catch { throw new Error('The board could not be drawn as a picture.'); }
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const g = canvas.getContext('2d');
      if (!g) throw new Error('The picture is too big for this browser. Try the normal size.');
      if (background) { g.fillStyle = background; g.fillRect(0, 0, size.width, size.height); }
      g.drawImage(img, 0, 0, size.width, size.height);
      step('Saving the picture');
      const blob = await new Promise((resolve) => { canvas.toBlob((b) => resolve(b), 'image/png'); });
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) throw new Error('The picture is too big for this browser. Try the normal size.');
      return blob;
    }

    return { scene, png, copyOf };
  }
