  // ---- documents-lib-n-serialise.js: the rich editor's nodes -> Markdown (no page, no host) ---------------------------------
  //
  // Built on ProseMirror's MarkdownSerializer (the one source file of prosemirror-markdown, in the vendored bundle) with our own
  // node and mark writers. The forms it writes (the editor's form): `-` bullets, 2 spaces of indent, `1.` numbering running on
  // from the first number, `[x]`, `#` headings with their real level, backtick fences, a backslash for a hard break, `**` `*`
  // `~~`, grids as `| a | b |` with `:--` `:-:` `--:` `---`, a block formula as `$$...$$`, an address as <address> when its words
  // are the address, tight lists. A source node is written word for word. Words are escaped so they read back as the same words:
  // a backslash before Markdown's own marks, before a tag or entity start, before a `$` that would pair into a formula, and
  // inside an address that would otherwise turn into a link.
  const DL_RICH_ALIGN_ROW = { left: ':--', center: ':-:', right: '--:' };
  // An & that starts what the reader would decode as an entity (the same shapes as dlDecodeText reads, whatever the name).
  const DL_RICH_ENTITY = /&(?=(?:#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,31});)/g;

  // A title inside "...": the reader takes the backslashes out, then decodes entities, so both are written back in.
  const dlRichTitle = (title) => (title ? ` "${String(title).replace(DL_RICH_ENTITY, '&amp;').replace(/["\\]/g, '\\$&')}"` : '');
  // The longest run of `ch` in a text, for a fence or a code mark that must be longer.
  const dlRichRun = (text, ch) => { let n = 0; let cur = 0; for (const c of text) { cur = c === ch ? cur + 1 : 0; if (cur > n) n = cur; } return n; };

  // THE MARKS ** * ~~ AND THE CHARACTERS BESIDE THEM. Markdown reads such a mark only when the characters on both sides allow
  // it: "**a.**b" is not bold, because the mark ends in punctuation against a letter. Each of our own marks is first written with
  // a control character beside it (one before an opening mark, one after a closing mark; the reader takes control characters
  // out, so no text can hold them), and dlRichMarks then looks at every run of marks: where it would not be read, it puts
  // &#8203; beside it. That entity is punctuation to Markdown, which makes the run readable, and the reader takes the character
  // it stands for out, so nothing is added to the words. The rules are marked's (its emStrong and del rules): an opening run
  // followed by punctuation needs a space, punctuation or a ~ before it; a closing run after punctuation needs a space or
  // punctuation after it; a closing run directly followed by an opening one is kept apart from it; an escaped character counts
  // as punctuation, a ~ beside a * run as a letter. Not covered: bold and italic woven through each other more than once
  // (italic that ends and starts again inside one bold run, with no space between); marked pairs those by counting.
  const DL_RICH_OPENS = '\u0001';
  const DL_RICH_CLOSED = '\u0002';
  const DL_RICH_GAP = '&#8203;';
  function dlRichMarks(text) {
    if (text.indexOf(DL_RICH_OPENS) < 0 && text.indexOf(DL_RICH_CLOSED) < 0) return text;
    const own = (c) => c === DL_RICH_OPENS || c === DL_RICH_CLOSED;
    const space = (c) => c === '' || /\s/.test(c);
    const mark = (c) => c !== '~' && /[\p{P}\p{S}]/u.test(c);
    const runs = /(?:\u0001\*+|\*+\u0002)+|(?:\u0001~+|~+\u0002)+/g;
    // A formula right after a closing run: the reader pairs the marks with every formula filled with letters (DL_MARKED_HOOKS),
    // so what follows the run is a letter to it, not the punctuation a `$` is.
    const formula = new RegExp(DL_MATH_SPAN.source, 'y');
    const formulaAt = (i) => { if (text[i] !== '$') return false; formula.lastIndex = i; return formula.test(text); };
    let out = '';
    let last = 0;
    let m;
    while ((m = runs.exec(text))) {
      let a = m.index;
      let b = m.index + m[0].length;
      while (a > 0 && own(text[a - 1])) a -= 1;
      while (b < text.length && own(text[b])) b += 1;
      const before = a > 0 ? Array.from(text.slice(Math.max(0, a - 2), a)).pop() : '';
      const after = b < text.length ? String.fromCodePoint(text.codePointAt(b)) : '';
      let slashes = 0;
      for (let j = a - before.length - 1; j >= 0 && text[j] === '\\'; j -= 1) slashes += 1;
      const markBefore = mark(before) || slashes % 2 === 1; // punctuation, or an escaped character
      const markAfter = mark(after);
      const cut = m[0].lastIndexOf(DL_RICH_CLOSED) + 1; // closing marks come first, then opening ones
      const closing = m[0].slice(0, cut);
      const opening = m[0].slice(cut);
      let made;
      if (closing && opening) made = closing + DL_RICH_GAP + opening;
      else if (opening) made = markAfter && !(space(before) || (markBefore && before.length === 1) || before === '~') ? DL_RICH_GAP + opening : opening; // marked sees half of a two-unit character (an emoji) there: a letter
      else made = markBefore && !(space(after) || (markAfter && !formulaAt(b))) ? closing + DL_RICH_GAP : closing;
      out += text.slice(last, m.index) + made;
      last = m.index + m[0].length;
    }
    return (out + text.slice(last)).replace(/[\u0001\u0002]/g, '');
  }

  const dlRichSerialisers = new WeakMap();
  function dlRichSerialiser(PM) {
    if (dlRichSerialisers.has(PM)) return dlRichSerialisers.get(PM);
    const name = (node) => (node ? node.type.name : '');
    // A node's inline content as a string, without touching the output so far (for grid cells).
    const inlineString = (state, node) => {
      const keep = { out: state.out, delim: state.delim, closed: state.closed };
      state.out = ''; state.delim = ''; state.closed = null;
      state.renderInline(node, false);
      const s = state.out;
      state.out = keep.out; state.delim = keep.delim; state.closed = keep.closed;
      return s;
    };
    // The mark of a list: not the mark of the list of its own kind directly before it (two lists in a row would read as one),
    // nor, for the last block written, of a kept list directly after it. state.options.dlBeside names the kept lists beside the
    // blocks being written: { before: { kind, mark }, after: { kind, mark } }.
    const listMark = (state, node, parent, index, marks) => {
      const beside = state.options.dlBeside;
      const chosen = state.options.dlChosen;
      const top = name(parent) === 'doc';
      let prev = null;
      if (index > 0 && parent.child(index - 1).type === node.type) prev = chosen.get(parent.child(index - 1)) || null;
      else if (top && index === 0 && beside && beside.before && beside.before.kind === name(node)) prev = beside.before.mark;
      const next = top && index === parent.childCount - 1 && beside && beside.after && beside.after.kind === name(node) ? beside.after.mark : null;
      const mark = marks.find((x) => x !== prev && x !== next) || marks.find((x) => x !== prev);
      chosen.set(node, mark);
      return mark;
    };
    const box = (node) => (node.attrs.checked === null ? '' : node.attrs.checked ? '[x] ' : '[ ] ');
    // A link whose words are its own address is written <address>.
    const plainAddress = (link, parent, index) => {
      if (!/^https?:\/\//.test(link.attrs.href) || link.attrs.title) return false;
      const content = parent.child(index);
      if (!content.isText || content.text !== link.attrs.href || content.marks.length !== 1) return false;
      return index === parent.childCount - 1 || !link.isInSet(parent.child(index + 1).marks);
    };
    // A code mark's backticks: one more than the longest run inside, and a space inside each end when the words hold a backtick
    // or have a space at both ends (the reader takes one space off each end).
    const ticksFor = (node, side) => {
      const text = node.isText ? node.text : '';
      const ticks = '`'.repeat(dlRichRun(text, '`') + 1);
      const pad = text.includes('`') || (/^ .* $/.test(text) && /[^ ]/.test(text)) ? ' ' : '';
      return side < 0 ? `${ticks}${pad}` : `${pad}${ticks}`;
    };
    // The `$` signs a line of words holds, wherever they sit: two or more could pair into a formula.
    const dollars = (state, parent) => {
      const known = state.options.dlDollars;
      if (known.has(parent)) return known.get(parent);
      let n = 0;
      const count = (s) => { for (const c of String(s || '')) if (c === '$') n += 1; };
      parent.forEach((c) => {
        if (c.isText) count(c.text);
        else if (name(c) === 'formula') n += 2;
        else if (name(c) === 'source') count(c.attrs.src);
        else if (name(c) === 'object') count(c.attrs.title);
        for (const m of c.marks) if (m.type.name === 'link') { count(m.attrs.href); count(m.attrs.title); }
      });
      known.set(parent, n);
      return n;
    };
    // $...$ is not read when a digit follows it, nor when the TeX starts with a digit and holds more than plain signs: $$...$$ is.
    const twoDollars = (parent, index) => {
      const tex = String(parent.child(index).attrs.tex);
      const next = parent.maybeChild(index + 1);
      return (/^\d/.test(tex) && !/^[A-Za-z0-9 ^+=.,()-]+$/.test(tex)) || Boolean(next && next.isText && /^\d/.test(next.text));
    };
    // Lines written as they are, each after the block's prefix (in one step: a source block may be the whole text).
    const lines = (state, text) => { state.write(); state.out += state.delim ? text.split('\n').join(`\n${state.delim}`) : text; };
    const oneLine = (parent) => name(parent) === 'heading' || name(parent) === 'grid_head' || name(parent) === 'grid_cell';

    const nodes = {
      paragraph(state, node) { state.renderInline(node); state.closeBlock(node); },
      heading(state, node) {
        state.write(`${'#'.repeat(Math.min(6, Math.max(1, node.attrs.level)))} `);
        state.renderInline(node, false);
        const closing = /#+$/.exec(state.out.slice(-80)); // "# a #": the closing marks are words
        if (closing) state.out = `${state.out.slice(0, state.out.length - closing[0].length)}\\${closing[0]}`;
        state.closeBlock(node);
      },
      blockquote(state, node) { state.wrapBlock('> ', null, node, () => state.renderContent(node)); },
      code_block(state, node) {
        const text = node.textContent;
        const first = `${node.attrs.lang || ''}${node.attrs.lang && node.attrs.info ? ' ' : ''}${node.attrs.info || ''}`;
        const ch = first.includes('`') ? '~' : '`'; // a backtick fence cannot hold a backtick on its first line
        const fence = ch.repeat(Math.max(3, dlRichRun(text, ch) + 1));
        state.write(`${fence}${first}\n`);
        lines(state, text);
        state.write('\n');
        state.write(fence);
        state.closeBlock(node);
      },
      source_block(state, node) { lines(state, node.textContent); state.closeBlock(node); },
      horizontal_rule(state, node) { state.write('---'); state.closeBlock(node); },
      page_break(state, node) { state.write(DL_PAGE_BREAK_LINE); state.closeBlock(node); },
      bullet_list(state, node, parent, index) {
        const mark = listMark(state, node, parent, index, ['-', '*', '+']);
        state.renderList(node, '  ', (i) => `${mark} ${box(node.child(i))}`);
      },
      ordered_list(state, node, parent, index) {
        const dot = listMark(state, node, parent, index, ['.', ')']);
        const start = Number.isInteger(node.attrs.order) ? node.attrs.order : 1;
        const width = String(start + node.childCount - 1).length;
        if (start !== 1 && state.inTightList) state.flushClose(2); // only a list that starts at 1 may follow a line directly
        state.renderList(node, ' '.repeat(width + 2), (i) => {
          const n = String(start + i);
          return `${n}${dot}${' '.repeat(width - n.length)} ${box(node.child(i))}`;
        });
      },
      list_item(state, node) { state.renderContent(node); },
      grid(state, node) {
        const rows = [];
        node.forEach((row) => { const cells = []; row.forEach((c) => cells.push(inlineString(state, c).replace(/\n/g, ' ').replace(/\|/g, '\\|').trim())); rows.push(cells); });
        const cols = Math.max(...rows.map((r) => r.length));
        const line = (cells) => `| ${Array.from({ length: cols }, (x, i) => cells[i] || '').join(' | ')} |`;
        const align = Array.from({ length: cols }, (x, i) => { const c = node.child(0).maybeChild(i); return (c && DL_RICH_ALIGN_ROW[c.attrs.align]) || '---'; });
        const lines = [line(rows[0]), line(align), ...rows.slice(1).map(line)];
        lines.forEach((l, i) => { state.write(l); if (i < lines.length - 1) state.ensureNewLine(); });
        state.closeBlock(node);
      },
      formula_block(state, node) { lines(state, `$$${String(node.attrs.tex).trim().replace(/\n[ \t]*\n/g, '\n')}$$`); state.closeBlock(node); },
      formula(state, node, parent, index) {
        // A paragraph that starts and ends with $$ would be read as one block formula: the gap in front keeps it a line of words.
        const gap = index === 0 && name(parent) === 'paragraph' && twoDollars(parent, 0) && name(parent.lastChild) === 'formula' && twoDollars(parent, parent.childCount - 1);
        state.text(`${gap ? DL_RICH_GAP : ''}${twoDollars(parent, index) ? `$$${node.attrs.tex}$$` : `$${node.attrs.tex}$`}`, false);
      },
      object(state, node) {
        const a = node.attrs;
        // The label is escaped so it reads back as the same label; a pipe needs no escape (and must have none in a grid cell).
        state.text(`[${dlEscapeLabel(a.label).replace(/\\\|/g, '|')}](${DL_SCHEME}:${a.module}:${a.kind}:${a.id}${dlRichTitle(a.title)})`, false);
      },
      source(state, node) { state.text(node.attrs.src, false); },
      hard_break(state, node, parent, index) {
        for (let i = index + 1; i < parent.childCount; i += 1) {
          if (parent.child(i).type !== node.type) { state.write(oneLine(parent) ? ' ' : '\\\n'); return; } // a heading or a cell is one line
        }
      },
      text(state, node, parent, index) {
        let t = node.text;
        const before = index > 0 ? parent.child(index - 1) : null;
        const afterBreak = name(before) === 'hard_break' && !oneLine(parent);
        if (index === 0 || afterBreak) t = t.replace(/^[ \t]+/, ''); // leading space would read as a code block
        if (!t) return;
        if (afterBreak && !node.marks.length) state.atBlockStart = true; // a new line: "- x", "# x", "> x" need their backslash
        state.write(); // close the block before, write the line's prefix
        if (state.inAutolink) { state.out += t; return; }
        const lineStart = state.atBlockStart;
        let written = state.esc(t.replace(/\n/g, ' '), lineStart);
        if (dollars(state, parent) >= 2) written = written.replace(/\$/g, '\\$'); // two in one run of words would read as a formula
        if (!node.marks.some((m) => m.type.name === 'link')) {
          // words that are not a link must not turn into one: an address, www. and a mail address
          written = written.replace(/(https?|ftp):\/\//gi, '$1\\://').replace(/www\./gi, 'www\\.').replace(/([A-Za-z0-9._+-])@(?=[A-Za-z0-9_-]+\.)/g, '$1\\@');
        }
        if (name(before) === 'source' && /\]$/.test(before.attrs.src)) written = written.replace(/^\(/, '\\(').replace(/^:/, '\\:'); // "[^1]" then "(x)" is not a link
        if (lineStart) {
          written = written.replace(/^(\s*\d+)([.)])(?=\s|$)/, '$1\\$2').replace(/^\+$/, '\\+').replace(/^(=+|-+)$/, '\\$1').replace(/^(\s*)~~~/, '$1\\~~~')
            .replace(/^(\s*)([|:])(?=[\s|:-]*$)/, '$1\\$2'); // a line of | : - under a line with a | would make a grid
        }
        state.out += written;
      },
    };
    const marks = {
      link: {
        open(state, mark, parent, index) { state.inAutolink = plainAddress(mark, parent, index); return state.inAutolink ? '<' : '['; },
        close(state, mark) {
          const auto = state.inAutolink;
          state.inAutolink = undefined;
          return auto ? '>' : `](${mark.attrs.href.replace(/[()]/g, '\\$&')}${dlRichTitle(mark.attrs.title)})`;
        },
        mixable: true,
      },
      strong: { open: `${DL_RICH_OPENS}**`, close: `**${DL_RICH_CLOSED}`, mixable: true, expelEnclosingWhitespace: true },
      em: { open: `${DL_RICH_OPENS}*`, close: `*${DL_RICH_CLOSED}`, mixable: true, expelEnclosingWhitespace: true },
      strike: { open: `${DL_RICH_OPENS}~~`, close: `~~${DL_RICH_CLOSED}`, mixable: true, expelEnclosingWhitespace: true },
      code: {
        open(state, mark, parent, index) { return ticksFor(parent.child(index), -1); },
        close(state, mark, parent, index) { return ticksFor(parent.child(index - 1), 1); },
        escape: false,
      },
    };
    // beyond the library's own set: a tag or entity start, and a picture mark
    const made = new PM.MarkdownSerializer(nodes, marks, { escapeExtraCharacters: new RegExp(`<(?=[A-Za-z/!?])|${DL_RICH_ENTITY.source}|!(?=\\[)`, 'g') });
    dlRichSerialisers.set(PM, made);
    return made;
  }

  // S: the editor's text -> Markdown, ending with exactly one line break (an empty text is ''). `beside`, when only some blocks
  // are written, names the kept lists directly before and after them (see listMark). Each top-level block is written on its own
  // and the blocks are joined by a blank line (two between two lists of one kind, as the library does), so the cost grows with
  // the length of the text and not with its square.
  function dlRichSerialise(PM, top, beside) {
    const made = dlRichSerialiser(PM);
    const options = { ...made.options, tightLists: true, dlBeside: beside || null, dlChosen: new Map(), dlDollars: new WeakMap() };
    const parts = [];
    let before = null;
    top.forEach((block, offset, index) => {
      const state = new PM.MarkdownSerializerState(made.nodes, made.marks, options);
      state.render(block, top, index);
      if (state.out) parts.push(parts.length ? (before.type === block.type && /_list$/.test(block.type.name) ? '\n\n\n' : '\n\n') : '', state.out);
      before = block;
    });
    const out = dlRichMarks(parts.join(''));
    return out ? `${dlTrimBreaks(out)}\n` : '';
  }
