  // ---- documents-lib-m-parse.js: Markdown -> the reader's description -> the rich editor's nodes (no page, no host) ---------
  //
  // dlDescribe is THE ONE GATE: a stored text, and later a paste, becomes the reader's plain description first, so the same safe
  // rules (raw HTML as text, the link allow-list, the bounds, entity decoding) cover everything the editor is ever given. This
  // file only turns that description into nodes; it reads no Markdown itself. What the reader shows as text becomes a source node.
  // One bound is added here: a text that would make more than DL_RICH.nodesMax nodes is held whole, as one source block.
  // Nothing is ever dropped: a text over the size bound, or one that fails for any reason, is also held whole as one source block.
  //
  // THE TABLE BESIDE THE TEXT (dlRichRead -> { doc, stored }). Reading makes two things: the editor's text, and a table
  // (`stored`: { text, clean, doc, lead, entries }) with one entry for each top-level block of the stored text, in order:
  //   { text   the block's own characters, exactly as stored (its slice of the text, without the line breaks at its end)
  //     gap    what stands between it and the next block (those line breaks and any blank lines), exactly as stored
  //     from   where the slice starts in the text
  //     node   the node it reads as, in the whole text (a link through a definition elsewhere reads as that link)
  //     open   true on a last block that has no end of its own (a code fence or a raw block never closed, a text held whole):
  //            anything written after it would be read as part of it }
  // `lead` is the blank lines before the first block, `text` the text as it was given, `clean` whether cleaning left it as it
  // was. documents-lib-o-write.js writes the text from this table and the editor's text, so an untouched block is written
  // word for word. `entries` is null when the lexer's tokens do not add up to the text (never seen; then nothing is kept by
  // the block and a change writes the whole text again).
  const DL_RICH_OVER = { over: true };

  // desc: dlDescribe's output. -> the top-level nodes. Throws DL_RICH_OVER past the node bound. `tally` ({ n }) carries the
  // count of nodes from one call to the next, when a text is turned into nodes block by block.
  function dlRichBlocks(PM, desc, tally = { n: 0 }) {
    const schema = dlRichSchema(PM);
    const N = schema.nodes;
    const M = schema.marks;
    const made = (node) => { tally.n += 1; if (tally.n > DL_RICH.nodesMax) throw DL_RICH_OVER; return node; };
    const para = (kids) => made(N.paragraph.create(null, kids));
    // Raw Markdown shown as text, in a line: one source node; two in a row with the same marks are one.
    const source = (out, src, marks) => {
      const v = String(src || '').replace(/\s*\n\s*/g, ' ');
      if (!v) return;
      const last = out[out.length - 1];
      if (last && last.type === N.source && PM.Mark.sameSet(last.marks, marks)) out[out.length - 1] = N.source.create({ src: last.attrs.src + v }, null, marks);
      else out.push(made(N.source.create({ src: v }, null, marks)));
    };
    function inline(list, marks, out) {
      for (const n of list || []) {
        if (!n || typeof n !== 'object') continue;
        if (n.t === 'text') {
          if (n.raw) source(out, n.v, marks);
          else { const v = String(n.v || '').replace(/\n/g, ' '); if (v) out.push(made(schema.text(v, marks))); } // a line break inside a paragraph reads as a space
        } else if (n.t === 'br') out.push(made(N.hard_break.create()));
        else if (n.t === 'code') { const v = String(n.v || '').replace(/\n/g, ' '); if (v) out.push(made(schema.text(v, M.code.create().addToSet(marks)))); }
        else if (n.t === 'strong' || n.t === 'em') inline(n.c, M[n.t].create().addToSet(marks), out);
        else if (n.t === 'del') inline(n.c, M.strike.create().addToSet(marks), out);
        else if (n.t === 'link') {
          const href = dlRichHref(n.href);
          inline(n.c, href && !/^object:/.test(href) ? M.link.create({ href, title: dlCleanLine(String(n.title || ''), DL_RICH.titleMax) }).addToSet(marks) : marks, out);
        } else if (n.t === 'object') {
          const label = dlCleanLine(String(n.label || ''), DL_RICH.labelMax);
          if (DL_RICH_PART.test(String(n.module)) && DL_RICH_PART.test(String(n.objectKind)) && DL_RICH_ID.test(String(n.id))) {
            out.push(made(N.object.create({ module: n.module, kind: n.objectKind, id: n.id, label, title: dlCleanLine(String(n.title || ''), DL_RICH.titleMax) }, null, marks)));
          } else if (label) out.push(made(schema.text(label, marks)));
        } else if (n.t === 'math') {
          const tex = String(n.tex || '').replace(/\s*\n\s*/g, ' ').trim();
          if (dlRichTexOk(tex, false)) out.push(made(N.formula.create({ tex }, null, marks)));
          else if (tex) source(out, `$${tex}$`, marks); // too long to draw: shown as text, kept as written
        }
      }
      return out;
    }
    // A paragraph in a list row never starts with spaces (an indented line there reads as words): the serialiser writes none.
    const lead = (c) => (c && c[0] && c[0].t === 'text' && !c[0].raw ? [{ ...c[0], v: String(c[0].v || '').replace(/^[ \t]+/, '') }, ...c.slice(1)] : c);
    function blocks(list, row, top) {
      const out = [];
      for (const b of list || []) {
        if (!b || typeof b !== 'object') continue;
        if (b.t === 'paragraph') out.push(para(inline(row ? lead(b.c) : b.c, [], [])));
        else if (b.t === 'heading') out.push(made(N.heading.create({ level: Math.min(6, Math.max(1, Math.trunc(Number(b.level || b.depth)) || 1)) }, inline(b.c, [], []))));
        else if (b.t === 'quote') { const c = blocks(b.c); out.push(made(N.blockquote.create(null, c.length ? c : [para([])]))); }
        else if (b.t === 'rule') out.push(made(N.horizontal_rule.create()));
        else if (b.t === 'pagebreak') out.push(made(top ? N.page_break.create() : N.horizontal_rule.create())); // the reader makes none inside a list or quote
        else if (b.t === 'codeblock') {
          const v = dlTrimBreaks(String(b.v || ''));
          const lang = /^[A-Za-z0-9_+#.-]{0,40}$/.test(String(b.lang || '')) ? String(b.lang || '') : '';
          out.push(made(N.code_block.create({ lang, info: dlCleanLine(String(b.info || ''), DL_RICH.infoMax) }, v ? [made(schema.text(v))] : [])));
        } else if (b.t === 'source') { if (b.v) out.push(made(N.source_block.create(null, [made(schema.text(String(b.v)))]))); }
        else if (b.t === 'math') {
          const tex = String(b.tex || '').trim();
          if (dlRichTexOk(tex, true)) out.push(made(N.formula_block.create({ tex })));
          else out.push(made(N.source_block.create(null, [made(schema.text(`$$${tex.replace(/\n[ \t]*\n/g, '\n') || ' '}$$`))]))); // an empty one: kept as written
        } else if (b.t === 'list') {
          const rows = (b.items || []).map((it) => {
            const c = blocks(it.c, true);
            return made(N.list_item.create({ checked: it.task ? Boolean(it.checked) : null }, c.length ? c : [para([])]));
          });
          if (rows.length) out.push(made(b.ordered ? N.ordered_list.create({ order: Number.isInteger(b.start) && b.start >= 0 && b.start < 1e6 ? b.start : 1 }, rows) : N.bullet_list.create(null, rows)));
        } else if (b.t === 'table') {
          const cols = Math.max(1, (b.head || []).length);
          if (cols > DL.gridCols || (b.rows || []).length > DL.gridRows) continue; // the reader never hands these over; refuse them anyway
          const align = (i) => (DL_RICH_ALIGN.includes((b.align || [])[i]) ? b.align[i] : null);
          const row = (cells, type) => made(N.grid_row.create(null, Array.from({ length: cols }, (x, i) => made(type.create({ align: align(i) }, inline((cells || [])[i], [], []))))));
          out.push(made(N.grid.create(null, [row(b.head, N.grid_head), ...(b.rows || []).map((r) => row(r, N.grid_cell))])));
        }
      }
      return out;
    }
    return blocks(desc, false, true);
  }

  // A description -> the editor's whole text as one node. Throws DL_RICH_OVER past the node bound, and if a value fails the schema.
  function dlRichFromDescription(PM, desc) {
    const N = dlRichSchema(PM).nodes;
    const c = dlRichBlocks(PM, desc);
    const top = N.doc.create(null, c.length ? c : [N.paragraph.create()]);
    top.check();
    return top;
  }
  // A text held whole, word for word, as one source block (an empty text is one empty paragraph).
  function dlRichWhole(PM, text) {
    const schema = dlRichSchema(PM);
    const v = dlTrimBreaks(text);
    return schema.nodes.doc.create(null, [v ? schema.nodes.source_block.create(null, [schema.text(v)]) : schema.nodes.paragraph.create()]);
  }
  // The lexer's token types that the reader makes no block of (dlBlocks): every other top-level token is exactly one block.
  const DL_RICH_NO_BLOCK = ['space', 'checkbox'];
  // Is a last block without an end of its own? Read it again with a paragraph after it: closed, the paragraph stands alone.
  function dlRichOpen(token, slice, lex) {
    if (token.type !== 'html' && !(token.type === 'code' && token.codeBlockStyle !== 'indented')) return false;
    try {
      const again = lex(`${slice}\n\nx`).filter((t) => t && t.type !== 'space');
      return !(again.length === 2 && dlTrimBreaks(String(again[0].raw)) === slice && again[1].type === 'paragraph' && again[1].raw === 'x');
    } catch (err) { return true; }
  }
  // P with its table: Markdown -> { doc, stored }. `lex` is the injected marked lexer, exactly as the reader takes it (with
  // DL_MARKED_MATH). Never throws and never drops text. The text goes through dlDescribe once, whole; the description's blocks
  // are then set beside the lexer's top-level tokens, whose `raw` are the slices. The cost grows with the length of the text.
  function dlRichRead(PM, markdown, lex) {
    const text = typeof markdown === 'string' ? markdown : '';
    const md = dlCleanText(text);
    const N = dlRichSchema(PM).nodes;
    const result = (doc, lead, entries) => ({ doc, stored: { text, clean: md === text, doc, lead, entries } });
    const whole = () => {
      const doc = dlRichWhole(PM, md);
      const v = dlTrimBreaks(md);
      return result(doc, v ? '' : md, v ? [{ text: v, gap: md.slice(v.length), from: 0, node: doc.firstChild, open: true }] : []);
    };
    if (md.length > DL.sizeMax) return whole();
    try {
      let tokens = null;
      const desc = dlDescribe(md, (v) => { tokens = lex(v); return tokens; });
      const tally = { n: 0 };
      const nodes = [];
      const entries = [];
      let lead = '';
      let pos = 0;
      let next = 0;
      let last = null;
      if (!Array.isArray(tokens)) return whole(); // the lexer threw: the reader holds the text whole
      let ok = true;
      for (const token of tokens) {
        const raw = token && typeof token === 'object' && typeof token.raw === 'string' ? token.raw : null;
        if (raw === null || !md.startsWith(raw, pos)) { ok = false; break; }
        if (DL_RICH_NO_BLOCK.includes(token.type)) {
          if (raw.trim()) { ok = false; break; } // only blank lines may stand between two blocks
          if (entries.length) entries[entries.length - 1].gap += raw; else lead += raw;
        } else {
          const made = next < desc.length ? dlRichBlocks(PM, [desc[next]], tally) : [];
          const slice = dlTrimBreaks(raw);
          next += 1;
          if (made.length !== 1 || !slice) { ok = false; break; }
          entries.push({ text: slice, gap: raw.slice(slice.length), from: pos, node: made[0] });
          nodes.push(made[0]);
          last = token;
        }
        pos += raw.length;
      }
      if (!ok || pos !== md.length || next !== desc.length) return result(dlRichFromDescription(PM, desc), '', null);
      const doc = N.doc.create(null, nodes.length ? nodes : [N.paragraph.create()]);
      doc.check();
      if (last && dlRichOpen(last, entries[entries.length - 1].text, lex)) entries[entries.length - 1].open = true;
      return result(doc, lead, entries);
    } catch (err) { return whole(); }
  }
  // P: Markdown -> the editor's text. `lex` is the injected marked lexer, exactly as the reader takes it (with DL_MARKED_MATH).
  // Never throws and never drops text.
  function dlRichParse(PM, markdown, lex) { return dlRichRead(PM, markdown, lex).doc; }
