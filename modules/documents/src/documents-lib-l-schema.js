  // ---- documents-lib-l-schema.js: the rich editor's schema (no page, no host) ---------------------------------------------
  //
  // The schema holds exactly what the safe reader draws and nothing else: no node or mark carries HTML. `PM` is the vendored
  // ProseMirror object (documents-lib-0-prosemirror.js makes it as DlPM); it is handed in, as the lexer is handed to the reader,
  // so these files load and run in a test with no page.
  //   blocks   paragraph, heading (level 1 to 6; 5 and 6 are drawn as 4), blockquote, code_block (lang, info), horizontal_rule, page_break (top level only),
  //            bullet_list and ordered_list (order) of list_item (checked: null, or true/false for a checklist row),
  //            grid > grid_row > grid_head | grid_cell (align), formula_block (tex), source_block (its text is raw Markdown)
  //   inline   text, hard_break, object (the chip: module, kind, id, label, title), formula (tex), source (src: raw Markdown)
  //   marks    link (href, title), strong, em, strike, code
  // A source node holds Markdown the reader shows as text (raw HTML and comments, pictures, footnote marks, link-definition lines,
  // a link with a refused address, anything past the bounds, anything unknown) and writes it back word for word.
  // Every attribute has a `validate` rule, so node.check() and Node.fromJSON refuse a value the reader would not have made.
  // There is no rule that reads the browser's own changes to the page back (parseDOM), on purpose: what the editor drew is
  // read back as the node it was drawn from, and anything the browser adds by itself can only bring words, never a mark, a
  // node or an attribute (documents-lib-p-rich-editor.js). Not here yet: what the grid editing library needs on the grid nodes
  // (its role key and the span attributes).
  const DL_RICH = Object.freeze({ nodesMax: 60000, labelMax: 200, titleMax: 200, langMax: 40, infoMax: 240 });
  const DL_RICH_ALIGN = ['left', 'center', 'right'];
  const DL_RICH_PART = /^[a-z][a-z0-9_-]{0,39}$/;
  const DL_RICH_ID = /^[A-Za-z0-9._-]{1,64}$/;

  // An address in the one form dlSafeAddress hands back, or null. Reading the result again gives the same result (an address
  // whose entities hide entities is taken down until it stops changing), so a stored address never changes on the next reading.
  function dlRichHref(raw) {
    let cur = typeof raw === 'string' ? raw : '';
    for (let i = 0; i < 4; i += 1) {
      const a = dlSafeAddress(cur);
      if (!a) return null;
      const next = a.kind === 'object' ? `${DL_SCHEME}:${a.module}:${a.objectKind}:${a.id}` : a.href;
      if (next === cur) return next;
      cur = next;
    }
    return null;
  }
  // A formula as the reader takes it: some TeX, at most formulaMax characters, no blank line; an inline one is one line with no $.
  const dlRichTexOk = (tex, block) => typeof tex === 'string' && tex.length > 0 && tex.length <= DL.formulaMax && tex.trim() === tex
    && !/\n[ \t]*\n/.test(tex) && (block || !/[$\n]/.test(tex));

  const dlRichSchemas = new WeakMap();
  function dlRichSchema(PM) {
    if (dlRichSchemas.has(PM)) return dlRichSchemas.get(PM);
    const must = (ok, what) => { if (!ok) throw new RangeError(`not a valid ${what}`); };
    const line = (max, what) => (v) => must(typeof v === 'string' && v.length <= max && !/[\n\r]/.test(v), what);
    const one = (what) => ({ default: 1, validate: (v) => must(v === 1, what) }); // the grid library reads spans; a grid cell spans exactly one
    const cell = (tag, role) => ({
      content: 'inline*', isolating: true, gridRole: role,
      attrs: { colspan: one('column span'), rowspan: one('row span'), colwidth: { default: null, validate: (v) => must(v === null, 'column width') }, align: { default: null, validate: (v) => must(v === null || DL_RICH_ALIGN.includes(v), 'alignment') } },
      toDOM: (node) => [tag, node.attrs.align ? { style: `text-align:${node.attrs.align}` } : {}, 0],
    });
    const nodes = {
      doc: { content: '(block | page_break)+' }, // a page break stands between the top-level blocks only
      paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
      heading: {
        group: 'block', content: 'inline*', defining: true,
        attrs: { level: { default: 1, validate: (v) => must(Number.isInteger(v) && v >= 1 && v <= 6, 'heading level') } },
        toDOM: (node) => [`h${Math.min(4, node.attrs.level)}`, 0],
      },
      blockquote: { group: 'block', content: 'block+', defining: true, toDOM: () => ['blockquote', 0] },
      code_block: {
        group: 'block', content: 'text*', marks: '', code: true, defining: true,
        attrs: {
          lang: { default: '', validate: (v) => must(typeof v === 'string' && v.length <= DL_RICH.langMax && /^[A-Za-z0-9_+#.-]*$/.test(v), 'code language') },
          info: { default: '', validate: line(DL_RICH.infoMax, 'code info') },
        },
        toDOM: () => ['pre', ['code', 0]],
      },
      source_block: { group: 'block', content: 'text*', marks: '', code: true, defining: true, toDOM: () => ['pre', { class: 'dl-source' }, ['code', 0]] },
      horizontal_rule: { group: 'block', toDOM: () => ['hr'] },
      // The manual page break: its own node, not the rule's (kept blocks are matched by Node.eq, so a rule typed before a kept
      // break would take the break's stored line). Top level only, as the reader makes it. Written as the line `_ _ _`.
      page_break: { toDOM: () => ['div', { class: 'dl-pagebreak', role: 'separator', 'aria-label': 'Page break' }, ['span', { class: 'dl-pagebreak-label', 'aria-hidden': 'true' }, 'Page break']] },
      bullet_list: { group: 'block', content: 'list_item+', toDOM: () => ['ul', 0] },
      ordered_list: {
        group: 'block', content: 'list_item+',
        attrs: { order: { default: 1, validate: (v) => must(Number.isInteger(v) && v >= 0 && v < 1e6, 'list start') } },
        toDOM: (node) => (node.attrs.order === 1 ? ['ol', 0] : ['ol', { start: String(node.attrs.order) }, 0]),
      },
      list_item: {
        content: 'block+', defining: true,
        attrs: { checked: { default: null, validate: (v) => must(v === null || v === true || v === false, 'checklist state') } },
        toDOM: (node) => (node.attrs.checked === null ? ['li', 0] : ['li', { class: 'dl-task', 'data-task': node.attrs.checked ? 'done' : 'open' }, 0]),
      },
      grid: { group: 'block', content: 'grid_row+', isolating: true, gridRole: 'table', toDOM: () => ['table', ['tbody', 0]] },
      grid_row: { gridRole: 'row', content: '(grid_head | grid_cell)+', toDOM: () => ['tr', 0] },
      grid_head: cell('th', 'header_cell'),
      grid_cell: cell('td', 'cell'),
      formula_block: {
        group: 'block', atom: true, selectable: true,
        attrs: { tex: { validate: (v) => must(dlRichTexOk(v, true), 'formula') } },
        toDOM: (node) => ['div', { class: 'dl-math dl-math-block' }, `$$${node.attrs.tex}$$`],
      },
      formula: {
        group: 'inline', inline: true, atom: true, selectable: true,
        attrs: { tex: { validate: (v) => must(dlRichTexOk(v, false), 'formula') } },
        toDOM: (node) => ['span', { class: 'dl-math' }, `$${node.attrs.tex}$`],
      },
      object: {
        group: 'inline', inline: true, atom: true, selectable: true,
        attrs: {
          module: { validate: (v) => must(typeof v === 'string' && DL_RICH_PART.test(v), 'chip address') },
          kind: { validate: (v) => must(typeof v === 'string' && DL_RICH_PART.test(v), 'chip address') },
          id: { validate: (v) => must(typeof v === 'string' && DL_RICH_ID.test(v), 'chip address') },
          label: { default: '', validate: line(DL_RICH.labelMax, 'label') },
          title: { default: '', validate: line(DL_RICH.titleMax, 'title') },
        },
        toDOM: (node) => ['span', { class: 'dl-object', 'data-module': node.attrs.module, 'data-kind': node.attrs.kind, 'data-id': node.attrs.id }, node.attrs.label || 'Link'],
      },
      source: {
        group: 'inline', inline: true, atom: true, selectable: true,
        attrs: { src: { validate: (v) => must(typeof v === 'string' && v.length > 0 && !/[\n\r]/.test(v), 'source') } },
        toDOM: (node) => ['span', { class: 'dl-source-inline' }, node.attrs.src],
      },
      hard_break: { group: 'inline', inline: true, selectable: false, toDOM: () => ['br'] },
      text: { group: 'inline' },
    };
    const marks = {
      link: {
        inclusive: false,
        attrs: {
          href: { validate: (v) => must(typeof v === 'string' && !/^object:/i.test(v) && dlRichHref(v) === v, 'address') },
          title: { default: '', validate: line(DL_RICH.titleMax, 'title') },
        },
        toDOM: (mark) => ['a', { href: mark.attrs.href, rel: 'noopener noreferrer', target: '_blank' }, 0],
      },
      strong: { toDOM: () => ['strong', 0] },
      em: { toDOM: () => ['em', 0] },
      strike: { toDOM: () => ['s', 0] },
      code: { toDOM: () => ['code', 0] },
    };
    const schema = new PM.Schema({ nodes, marks });
    dlRichSchemas.set(PM, schema);
    return schema;
  }
