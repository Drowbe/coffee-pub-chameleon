  // ---- documents-lib-u-output.js: Print, Save as Markdown file, Open Markdown file ----------------------------------------------
  //
  // The pure rules (a file name to a title, a file's bytes to a text, the print page rules); the page side is outputWire in documents.js.
  // Nothing here is a host or SDK addition:
  //   Save as Markdown file: the stored text (dlExportMarkdown) in an in-page download link, as the Whiteboard saves a picture.
  //   Print: the standard Print action; run() draws the document into #dl-print (a plain page, white with dark ink, no chrome) and
  //     puts the page rules (size, margin, numbers) in a style in the document's head until the host says 'printed'.
  //   Open Markdown file: a file chosen or dropped is read in the page and made into a new document through the usual create().

  // A file name to a document title: the folder and a Markdown or text ending goes, the rest is cleaned like any title.
  function dlFileTitle(fileName, fallback) {
    const base = String(fileName == null ? '' : fileName).split(/[\/\\]/).pop();
    const noExt = base.replace(/\.(md|markdown|mdown|mkd|txt|text)$/i, '');
    const t = dlCleanLine(noExt, DL.titleMax);
    return t || fallback;
  }
  // A file's bytes (ArrayBuffer or Uint8Array) to the text of a new document.
  // -> { ok: true, text } or { ok: false, reason: 'big' | 'binary' }. UTF-8 only; a byte order mark and carriage returns go.
  function dlFileText(bytes) {
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u.length > DL.sizeMax * 4) return { ok: false, reason: 'big' }; // no character takes more than 4 bytes
    if (u.includes(0)) return { ok: false, reason: 'binary' };
    let s;
    try { s = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(u); } catch { return { ok: false, reason: 'binary' }; }
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    const text = dlCleanText(s);
    if (text.length > DL.sizeMax) return { ok: false, reason: 'big' };
    return { ok: true, text };
  }
  // The page rules for a printout, from the document's own page settings ({ layout, pageSize, pageNumbers }):
  // Paper: the page's size and its one-inch margin, and the number at the foot if the document has numbers; otherwise a plain page.
  function dlPrintRules(page) {
    const p = dlCleanPage(page);
    if (p.layout !== 'paper') return '@page { margin: 18mm; }';
    const g = dlPageGeometry(p.pageSize);
    const numbers = p.pageNumbers ? ' @bottom-center { content: counter(page); color: CanvasText; font-size: 10pt; }' : '';
    return `@page { size: ${g.atPage}; margin: ${g.margin}px;${numbers} }`;
  }
