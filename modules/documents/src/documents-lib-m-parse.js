  // ---- documents-lib-m-parse.js: Markdown -> the reader's description -> the rich editor's nodes (no page, no host) ---------
  //
  // dlDescribe is THE ONE GATE: a stored text, and later a paste, becomes the reader's plain description first, so the same safe
  // rules (raw HTML as text, the link allow-list, the bounds, entity decoding) cover everything the editor is ever given. This
  // file only turns that description into nodes; it reads no Markdown itself. What the reader shows as text becomes a source node.
  // One bound is added here: a text that would make more than DL_RICH.nodesMax nodes is held whole, as one source block.
  // Nothing is ever dropped: a text over the size bound, or one that fails for any reason, is also held whole as one source block.
  const DL_RICH_OVER = { over: true };

  // desc: dlDescribe's output. -> the top-level nodes. Throws DL_RICH_OVER past the node bound.
  function dlRichBlocks(PM, desc) {
    const schema = dlRichSchema(PM);
    const N = schema.nodes;
    const M = schema.marks;
    let count = 0;
    const made = (node) => { count += 1; if (count > DL_RICH.nodesMax) throw DL_RICH_OVER; return node; };
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
    function blocks(list) {
      const out = [];
      for (const b of list || []) {
        if (!b || typeof b !== 'object') continue;
        if (b.t === 'paragraph') out.push(para(inline(b.c, [], [])));
        else if (b.t === 'heading') out.push(made(N.heading.create({ level: Math.min(6, Math.max(1, Math.trunc(Number(b.level || b.depth)) || 1)) }, inline(b.c, [], []))));
        else if (b.t === 'quote') { const c = blocks(b.c); out.push(made(N.blockquote.create(null, c.length ? c : [para([])]))); }
        else if (b.t === 'rule') out.push(made(N.horizontal_rule.create()));
        else if (b.t === 'codeblock') {
          const v = String(b.v || '').replace(/\n+$/, '');
          const lang = /^[A-Za-z0-9_+#.-]{0,40}$/.test(String(b.lang || '')) ? String(b.lang || '') : '';
          out.push(made(N.code_block.create({ lang, info: dlCleanLine(String(b.info || ''), DL_RICH.infoMax) }, v ? [made(schema.text(v))] : [])));
        } else if (b.t === 'source') { if (b.v) out.push(made(N.source_block.create(null, [made(schema.text(String(b.v)))]))); }
        else if (b.t === 'math') {
          const tex = String(b.tex || '').trim();
          if (dlRichTexOk(tex, true)) out.push(made(N.formula_block.create({ tex })));
          else out.push(made(N.source_block.create(null, [made(schema.text(`$$${tex.replace(/\n[ \t]*\n/g, '\n') || ' '}$$`))]))); // an empty one: kept as written
        } else if (b.t === 'list') {
          const rows = (b.items || []).map((it) => {
            const c = blocks(it.c);
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
    return blocks(desc);
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
    const v = text.replace(/\n+$/, '');
    return schema.nodes.doc.create(null, [v ? schema.nodes.source_block.create(null, [schema.text(v)]) : schema.nodes.paragraph.create()]);
  }
  // P: Markdown -> the editor's text. `lex` is the injected marked lexer, exactly as the reader takes it (with DL_MARKED_MATH).
  // Never throws and never drops text.
  function dlRichParse(PM, markdown, lex) {
    const md = dlCleanText(typeof markdown === 'string' ? markdown : '');
    if (md.length > DL.sizeMax) return dlRichWhole(PM, md);
    try { return dlRichFromDescription(PM, dlDescribe(md, lex)); } catch (err) { return dlRichWhole(PM, md); }
  }
