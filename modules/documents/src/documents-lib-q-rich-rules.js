  // ---- documents-lib-q-rich-rules.js: what the rich editor makes of the marks a person types, and what the bar shows (no page) ----
  //
  // TYPING SHORTCUTS (dlRichRules -> [{ name, rule }], dlRichInputRules -> the one plugin). A rule fires as its last character
  // is typed, and only on words being typed: never in a code block or a raw block (both are `code` in the schema), never in
  // words that are code, never in a read-only editor. Backspace straight after a rule puts the typed characters back
  // (undoInputRule); undo takes the rule back as one step of its own.
  //   At the start of a paragraph (never in a heading, a grid cell or code):
  //     heading    "# " to "#### "      a heading of level 1 to 4 (five and six marks stay words)
  //     bullet     "- " or "* "         a bulleted list; it joins a bulleted list directly above
  //     numbered   "1. "                a numbered list; it joins a numbered list directly above (no other number starts one)
  //     checklist  "[ ] " or "[x] "     a checklist row; in the first line of a list row, that row gets its box (so "- [ ] ")
  //     quote      "> "                 a quote, to the reader's eight levels
  //     codeblock  "```" then a space   a code block; Enter does the same, and after "```js" names the language (dlRichFence)
  //     rule       "---"                a rule, in a paragraph that holds nothing else
  //   Anywhere in a line of words:
  //     bold "**x**", italic "*x*" and "_x_", strike "~~x~~", code "`x`"; the words start and end without a space
  //     link "[words](address)": only an address the reader allows (dlSafeAddress: http, https, mailto, object:); any other
  //     address is left as the words typed. An object: address makes the chip, as reading the same Markdown does.
  //   A bare address is never made a link, and no mark is read inside an address being typed.
  // The reader's bounds hold: no fifth list level, no ninth quote. In the first line of a list row no heading and no quote is
  // made (an empty one there cannot be written by the block: "- # " with no words yet), and in a checklist row no code
  // block either (Markdown reads only words after a box). Nothing here reads HTML or sets it.
  //
  // WHAT THE BAR SHOWS (dlRichActive): which formats the selection is in, from the selection alone. It reads marks and node
  // kinds, never the words, so it is cheap enough to run once a frame while the caret moves.
  const DL_RICH_RULES = ['heading', 'bullet', 'numbered', 'checklist', 'quote', 'codeblock', 'rule', 'bold', 'italic', 'italic_', 'strike', 'code', 'link'];
  const DL_RICH_QUOTES = 8; // the reader shows a ninth quote in a quote as text
  const DL_RICH_LOOK = 20000; // how far into a long selection the bar looks for a mark
  const DL_RICH_FENCE = /^```([A-Za-z0-9_+#.-]{0,40})$/;
  // The words before an opening mark end in an address still being typed: after "](", after a scheme's "://", after "mailto:".
  const DL_RICH_IN_ADDRESS = /(?:\]\(|:\/\/|mailto:)\S*$/i;

  // Is this the first line of a checklist row? Markdown reads only words after a box ("- [ ] ```" is no code block), so no
  // rule makes a code block there (and none makes a heading or a quote in the first line of any row).
  const dlRichAfterBox = (PM, $pos) => { const row = $pos.depth > 1 ? $pos.node(-1) : null; return Boolean(row) && row.type === dlRichSchema(PM).nodes.list_item && $pos.index(-1) === 0 && row.attrs.checked !== null; };

  // What an address makes of the words it is given, for the typing rule and for the Link button alike (the one place a
  // link is made from an address a person gave): { chip } for an object: address (the chip node, the words its label),
  // { mark } for an address the reader allows (the link mark, in the one form dlRichHref gives), null for any other address.
  // `title` is a link's title to keep (the button, when a link's address is changed); the typing rule has none.
  function dlRichLinkOf(PM, raw, words, title) {
    const schema = dlRichSchema(PM);
    const address = dlSafeAddress(raw);
    if (!address) return null;
    const kept = dlCleanLine(String(title || ''), DL_RICH.titleMax);
    if (address.kind === 'object') return { chip: schema.nodes.object.create({ module: address.module, kind: address.objectKind, id: address.id, label: dlCleanLine(String(words || ''), DL_RICH.labelMax), title: kept }) };
    const href = dlRichHref(raw);
    if (!href || /^object:/i.test(href)) return null;
    return { mark: schema.marks.link.create({ href, title: kept }) };
  }

  const dlRichRuleSets = new WeakMap();
  function dlRichRules(PM) {
    if (dlRichRuleSets.has(PM)) return dlRichRuleSets.get(PM);
    const schema = dlRichSchema(PM);
    const N = schema.nodes;
    const M = schema.marks;
    // Every rule: not in words that are code, and its change is one step of undo of its own.
    const rule = (regexp, fn) => new PM.InputRule(regexp, (state, match, start, end) => {
      const tr = fn(state, match, start, end);
      return tr ? PM.closeHistory(tr.scrollIntoView()) : null;
    }, { inCodeMark: false });
    // A rule for the start of a paragraph: `fn` also gets where the paragraph's words start.
    const atStart = (regexp, fn) => rule(regexp, (state, match, start, end) => {
      const $start = state.doc.resolve(start);
      if ($start.depth < 1 || $start.parent.type !== N.paragraph || $start.parentOffset !== 0 || end > $start.end()) return null;
      return fn(state, match, start, end, $start);
    });
    const firstLineOfRow = ($start) => $start.node(-1).type === N.list_item && $start.index(-1) === 0;
    const afterBox = ($start) => dlRichAfterBox(PM, $start);
    const alone = ($start, start, end) => $start.parent.content.size === end - start; // the paragraph holds the typed marks only
    // Takes the typed marks out and puts the paragraph in a list or a quote; `row` is the new row's attributes.
    const wrap = (state, start, end, type, attrs, row, join) => {
      const tr = state.tr.delete(start, end);
      const range = tr.doc.resolve(start).blockRange();
      const wrapping = range && PM.findWrapping(range, type, attrs);
      if (!wrapping) return null;
      tr.wrap(range, row ? wrapping.map((w) => (w.type === N.list_item ? { type: w.type, attrs: row } : w)) : wrapping);
      const before = join ? tr.doc.resolve(start - 1).nodeBefore : null;
      if (before && before.type === type && PM.canJoin(tr.doc, start - 1)) tr.join(start - 1);
      return tr;
    };
    const list = (state, start, end, $start, type, attrs, row) => {
      if (firstLineOfRow($start)) return null; // "- - x" is not typed into being
      if (dlRichDepth(PM, state).lists >= DL.listDepth) return null; // a fifth level: the marks stay words
      return wrap(state, start, end, type, attrs, row, true);
    };
    // What is typed next is not in the mark the rule made: it gets what the closing mark itself would have got.
    const after = (state, end, type) => (state.storedMarks || state.doc.resolve(end).marks()).filter((m) => m.type !== type);
    // A mark typed around words: `open` is the mark on each side. match[1] is what stands before the opening mark, match[2]
    // the words. The last characters of the closing mark are the ones being typed; all the rest is already in the text.
    const around = (regexp, open, type, more) => rule(regexp, (state, match, start, end) => {
      const n = open.length;
      const typed = match[0].length - (end - start);
      if (typed < 0 || typed > n) return null;
      if (state.doc.textBetween(start, end, null, '\ufffc') !== match[0].slice(0, end - start)) return null; // typed over other words
      const from = start + match[1].length;
      const wordsFrom = from + n;
      const wordsTo = wordsFrom + match[2].length;
      if (!match[2].trim() || !state.doc.resolve(from).parent.type.allowsMarkType(type)) return null;
      if (state.doc.rangeHasMark(from, wordsFrom, M.code)) return null; // an opening mark that is code is words
      if (DL_RICH_IN_ADDRESS.test(match.input.slice(0, match.index + match[1].length))) return null;
      if (more && !more(state, end)) return null;
      const tr = state.tr;
      if (end > wordsTo) tr.delete(wordsTo, end);
      tr.delete(from, wordsFrom);
      tr.addMark(from, wordsTo - n, type.create());
      return tr.setStoredMarks(after(state, end, type));
    });
    // "_x_" closes only when no letter, digit or _ follows (snake_case_name is words).
    const notInWord = (state, end) => { const after = state.doc.resolve(end).nodeAfter; return !(after && after.isText && /^[\p{L}\p{N}_]/u.test(after.text)); };

    const rules = [
      ['heading', atStart(/^(#{1,4}) $/, (state, match, start, end, $start) => {
        if (firstLineOfRow($start) || !$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), N.heading)) return null;
        return state.tr.delete(start, end).setBlockType(start, start, N.heading, { level: match[1].length });
      })],
      ['bullet', atStart(/^[-*] $/, (state, match, start, end, $start) => list(state, start, end, $start, N.bullet_list, null, null))],
      ['numbered', atStart(/^1\. $/, (state, match, start, end, $start) => list(state, start, end, $start, N.ordered_list, { order: 1 }, null))],
      ['checklist', atStart(/^\[([ xX])\] $/, (state, match, start, end, $start) => {
        const checked = match[1] !== ' ';
        if (!firstLineOfRow($start)) return list(state, start, end, $start, N.bullet_list, null, { checked });
        const row = $start.node(-1);
        if (row.attrs.checked !== null) return null; // the row has its box already
        return state.tr.delete(start, end).setNodeMarkup($start.before(-1), null, { ...row.attrs, checked });
      })],
      ['quote', atStart(/^> $/, (state, match, start, end, $start) => (firstLineOfRow($start) || dlRichDepth(PM, state).quotes >= DL_RICH_QUOTES ? null : wrap(state, start, end, N.blockquote, null, null, false)))],
      ['codeblock', atStart(/^``` $/, (state, match, start, end, $start) => {
        if (afterBox($start) || !alone($start, start, end) || !$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), N.code_block)) return null;
        return state.tr.delete(start, end).setBlockType(start, start, N.code_block);
      })],
      ['rule', atStart(/^---$/, (state, match, start, end, $start) => {
        const holder = $start.node(-1);
        const index = $start.index(-1);
        if (!alone($start, start, end) || firstLineOfRow($start) || !holder.canReplaceWith(index, index + 1, N.horizontal_rule)) return null; // "- ---" reads as a rule, not a row
        const next = holder.maybeChild(index + 1);
        const tr = state.tr.replaceWith($start.before(), $start.after(), next && next.isTextblock ? [N.horizontal_rule.create()] : [N.horizontal_rule.create(), N.paragraph.create()]);
        return tr.setSelection(PM.TextSelection.create(tr.doc, $start.before() + 2)); // in the block after the rule
      })],
      ['bold', around(/(^|[^*])\*\*([^*\s\ufffc](?:[^*\ufffc]*[^*\s\ufffc])?)\*\*$/, '**', M.strong)],
      ['italic', around(/(^|[^*])\*([^*\s\ufffc](?:[^*\ufffc]*[^*\s\ufffc])?)\*$/, '*', M.em)],
      ['italic_', around(/(^|[^\p{L}\p{N}_])_([^_\s\ufffc](?:[^_\ufffc]*[^_\s\ufffc])?)_$/u, '_', M.em, notInWord)],
      ['strike', around(/(^|[^~])~~([^~\s\ufffc](?:[^~\ufffc]*[^~\s\ufffc])?)~~$/, '~~', M.strike)],
      ['code', around(/(^|[^`])`([^`\ufffc]+)`$/, '`', M.code)],
      ['link', rule(/(^|[^!])\[([^[\]\ufffc]+)\]\(([^()\s\ufffc]+)\)$/, (state, match, start, end) => {
        const typed = match[0].length - (end - start);
        if (typed < 0 || typed > 1 || state.doc.textBetween(start, end, null, '\ufffc') !== match[0].slice(0, end - start)) return null;
        const from = start + match[1].length;
        const wordsFrom = from + 1;
        const wordsTo = wordsFrom + match[2].length;
        if (!match[2].trim() || state.doc.rangeHasMark(from, end, M.code)) return null;
        const made = dlRichLinkOf(PM, match[3], match[2]); // the reader's own rule: any other address stays the words typed
        if (!made) return null;
        const $from = state.doc.resolve(from);
        if (made.chip) {
          if (!$from.parent.canReplaceWith($from.index(), $from.index(), N.object)) return null;
          return state.tr.replaceWith(from, end, made.chip);
        }
        if (!$from.parent.type.allowsMarkType(M.link)) return null;
        const tr = state.tr.delete(wordsTo, end).delete(from, wordsFrom);
        tr.addMark(from, wordsTo - 1, made.mark);
        return tr.setStoredMarks(after(state, end, M.link));
      })],
    ].map(([name, made]) => ({ name, rule: made }));
    dlRichRuleSets.set(PM, rules);
    return rules;
  }

  // The plugin that runs the rules as text is typed. One for each ProseMirror object, because Backspace (undoInputRule) and
  // Enter after "```" (dlRichFence) look it up in the editor's state. A read-only editor runs none.
  const dlRichRulePlugins = new WeakMap();
  function dlRichInputRules(PM) {
    if (dlRichRulePlugins.has(PM)) return dlRichRulePlugins.get(PM);
    const plugin = PM.inputRules({ rules: dlRichRules(PM).map((r) => r.rule) });
    const typedText = plugin.props.handleTextInput;
    plugin.props.handleTextInput = (view, from, to, text) => view.editable !== false && typedText(view, from, to, text);
    dlRichRulePlugins.set(PM, plugin);
    return plugin;
  }

  // Enter at the end of a paragraph that holds only "```" (or "```js"): the change that makes it a code block, or null.
  // It is marked as a typing rule, so Backspace straight after puts the three marks back.
  function dlRichFence(PM, state) {
    const N = dlRichSchema(PM).nodes;
    const sel = state.selection;
    const $from = sel.$from;
    const para = $from.parent;
    if (!sel.empty || $from.depth < 1 || para.type !== N.paragraph || para.childCount !== 1 || $from.parentOffset !== para.content.size) return null;
    const words = para.firstChild;
    const m = words.isText && !words.marks.length ? DL_RICH_FENCE.exec(words.text) : null;
    if (!m || dlRichAfterBox(PM, $from) || !$from.node(-1).canReplaceWith($from.index(-1), $from.indexAfter(-1), N.code_block)) return null;
    const start = $from.start();
    const tr = state.tr.delete(start, $from.end()).setBlockType(start, start, N.code_block, { lang: m[1] });
    tr.setMeta(dlRichInputRules(PM), { transform: tr, from: start, to: start, text: '' });
    return PM.closeHistory(tr.scrollIntoView());
  }

  // Which formats the selection is in -> { bold, italic, code, heading (0, or its level 1 to 6), list, numbered, checklist,
  // quote }. The same answers the actions give: a second press of a button that is `on` takes its format off. Marks: at a
  // caret, what the next typed character gets; over a selection, whether any of it has the mark. A heading: the selection is
  // inside one heading. A list: the kind of the innermost list that holds the selection (a bulleted list whose rows all have
  // a box is a checklist, not a bulleted list; a numbered one with boxes is both). Reads no words.
  function dlRichActive(PM, state) {
    const schema = dlRichSchema(PM);
    const N = schema.nodes;
    const M = schema.marks;
    const sel = state.selection;
    const { $from, $to } = sel;
    const seen = new Set();
    if (sel.empty) for (const m of state.storedMarks || $from.marks()) seen.add(m.type);
    else state.doc.nodesBetween(sel.from, Math.min(sel.to, sel.from + DL_RICH_LOOK), (node) => { if (node.isInline) for (const m of node.marks) seen.add(m.type); return true; });
    const here = dlRichRows(PM, state);
    const boxes = Boolean(here) && here.rows.length > 0 && here.rows.every((r) => r.node.attrs.checked !== null);
    return {
      bold: seen.has(M.strong),
      italic: seen.has(M.em),
      code: seen.has(M.code),
      heading: $from.sameParent($to) && $from.parent.type === N.heading ? $from.parent.attrs.level : 0,
      list: Boolean(here) && here.list.type === N.bullet_list && !boxes,
      numbered: Boolean(here) && here.list.type === N.ordered_list,
      checklist: boxes,
      quote: dlRichDepth(PM, state).quotes > 0,
    };
  }
  // Is the bar's button `id` on, for what dlRichActive gave? (Heading is on in a heading of any level.)
  const dlRichIsOn = (active, id) => Boolean(active) && (id === 'heading' ? active.heading > 0 : active[id] === true);
