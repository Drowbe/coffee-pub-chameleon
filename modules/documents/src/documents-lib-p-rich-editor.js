  // ---- documents-lib-p-rich-editor.js: the rich editor behind the editor adapter (documents-lib-k-editor.js) ----------------
  //
  // dlRichEditor(PM, doc, lex, element) is the same contract as the plain text box (getText, setText, setReadOnly, focus,
  // onChange, run, destroy, revision, selectAll), over ProseMirror. Markdown stays the stored form:
  //   setText(text)   reads the text through dlRichRead (the safe reader's one gate) and keeps the table made beside it.
  //   getText()       writes the text with dlRichText, block by block: an untouched block word for word. It is costly, so it
  //                   is called only at save, Done, Copy and the switch back to the text box, never for a key (decision 24).
  //   revision()      a counter, one more for every change of the text. Asking "is it changed" never reads the text.
  // `PM` is the vendored ProseMirror object (DlPM), `doc` the page's document, `lex` the injected lexer, `element` where the
  // editor is drawn. With no element (a test in Node) the same object runs with no page: its text, keys and actions are the same.
  // WHAT COMES IN. Typing, and a paste or a drop as PLAIN TEXT read as Markdown through dlRichRead. The clipboard's HTML is
  // never read: the page takes the paste and drop events before the library does, and the library's own HTML reader is given
  // an empty string if it is ever reached. The schema has no rule for reading the browser's own changes to the page, so a
  // change the browser makes by itself can only bring words.
  // WHAT GOES OUT. Copy and cut give Markdown as the plain text (the library also writes its own HTML of the selection).
  const DL_RICH_ACTIONS = ['bold', 'italic', 'code', 'h1', 'h2', 'h3', 'h4', 'list', 'numbered', 'checklist', 'quote'];
  const DL_RICH_KEYS = ['Enter', 'Shift-Enter', 'Tab', 'Shift-Tab', 'Backspace', 'Mod-z', 'Mod-Shift-z', 'Mod-y', 'Mod-b', 'Mod-i', 'Mod-e', 'Mod-Enter'];
  const DL_RICH_PASTE = Object.freeze({ htmlMax: 4000000 });
  const dlRichCan = (action) => DL_RICH_ACTIONS.includes(action);

  // Where the selection sits in a list: { list, at (the position before the list), rows: [{ node, at }] } for the rows the
  // selection touches, in the innermost list that holds all of it; null outside a list.
  function dlRichRows(PM, state) {
    const N = dlRichSchema(PM).nodes;
    const { $from, $to } = state.selection;
    const range = $from.blockRange($to, (n) => n.type === N.bullet_list || n.type === N.ordered_list);
    if (!range || !range.depth) return null;
    const rows = [];
    let at = range.start;
    for (let i = range.startIndex; i < range.endIndex; i += 1) { const node = range.parent.child(i); rows.push({ node, at }); at += node.nodeSize; }
    return { list: range.parent, at: $from.before(range.depth), rows };
  }
  // How many lists, and how many quotes, the start of the selection sits in.
  function dlRichDepth(PM, state) {
    const N = dlRichSchema(PM).nodes;
    const $from = state.selection.$from;
    let lists = 0;
    let quotes = 0;
    for (let d = $from.depth; d > 0; d -= 1) {
      const t = $from.node(d).type;
      if (t === N.bullet_list || t === N.ordered_list) lists += 1; else if (t === N.blockquote) quotes += 1;
    }
    return { lists, quotes };
  }
  // The deepest run of lists inside a node (a row with a list in it: 1).
  function dlRichListsIn(PM, node) {
    const N = dlRichSchema(PM).nodes;
    let most = 0;
    node.forEach((c) => { const own = c.type === N.bullet_list || c.type === N.ordered_list ? 1 : 0; if (!c.isTextblock && !c.isLeaf) most = Math.max(most, own + dlRichListsIn(PM, c)); });
    return most;
  }

  // The deepest run of lists in the blocks the selection touches (a list with a list in a row: 2).
  function dlRichListsAt(PM, state) {
    const N = dlRichSchema(PM).nodes;
    const range = state.selection.$from.blockRange(state.selection.$to);
    let most = 0;
    if (range) for (let i = range.startIndex; i < range.endIndex; i += 1) { const c = range.parent.child(i); most = Math.max(most, (c.type === N.bullet_list || c.type === N.ordered_list ? 1 : 0) + (c.isTextblock || c.isLeaf ? 0 : dlRichListsIn(PM, c))); }
    return most;
  }

  // How many checklist rows have a heading or a quote as their first block. Markdown reads only words after a box ("- [ ] # a"
  // is the words "# a"), so such a row cannot be written.
  function dlRichBoxedHeads(PM, doc) {
    const N = dlRichSchema(PM).nodes;
    let n = 0;
    doc.descendants((node) => { if (node.type === N.list_item && node.attrs.checked !== null && node.firstChild && (node.firstChild.type === N.heading || node.firstChild.type === N.blockquote)) n += 1; });
    return n;
  }
  // A command that does nothing (and says false) when it would put a heading or a quote on the first line of a checklist row.
  function dlRichRefuseAfterBox(PM, command) {
    return (state, dispatch, view) => {
      let made = null;
      if (!command(state, (tr) => { made = tr; }, view)) return false;
      if (made && dlRichBoxedHeads(PM, made.doc) > dlRichBoxedHeads(PM, state.doc)) return false;
      if (dispatch && made) dispatch(made);
      return true;
    };
  }

  // An action of the bar, by name -> a ProseMirror command (state, dispatch) => true when it applies; null for a name the rich
  // editor has no action for yet (link, grid, formula). The reader's bounds hold: a list goes four deep.
  function dlRichCommand(PM, action) {
    const schema = dlRichSchema(PM);
    const N = schema.nodes;
    const M = schema.marks;
    if (!dlRichCan(action)) return null;
    const h = /^h([1-4])$/.exec(action);
    if (h) {
      const level = Number(h[1]);
      return dlRichRefuseAfterBox(PM, (state, dispatch) => {
        const { $from, $to } = state.selection;
        const on = $from.sameParent($to) && $from.parent.type === N.heading && $from.parent.attrs.level === level;
        return on ? PM.setBlockType(N.paragraph)(state, dispatch) : PM.setBlockType(N.heading, { level })(state, dispatch);
      });
    }
    if (action === 'bold') return PM.toggleMark(M.strong);
    if (action === 'italic') return PM.toggleMark(M.em);
    if (action === 'code') return PM.toggleMark(M.code);
    // A quote goes around the blocks, or comes off them: one press never puts a quote in a quote.
    if (action === 'quote') return dlRichRefuseAfterBox(PM, (state, dispatch) => (dlRichDepth(PM, state).quotes ? PM.lift(state, dispatch) : PM.wrapIn(N.blockquote)(state, dispatch)));
    // The three lists. In a list of the kind asked for: the rows leave the list. In a list of another kind: the list changes
    // kind. Outside a list: the blocks become one. A checklist is a bullet list whose rows have a box.
    const kind = action === 'numbered' ? N.ordered_list : N.bullet_list;
    const boxes = action === 'checklist';
    return (state, dispatch) => {
      const here = dlRichRows(PM, state);
      const boxed = (tr, rows, checked) => { for (const r of rows) if ((r.node.attrs.checked === null) !== (checked === null)) tr.setNodeMarkup(r.at, null, { ...r.node.attrs, checked }); return tr; };
      if (!here) {
        if (dlRichDepth(PM, state).lists + dlRichListsAt(PM, state) >= DL.listDepth) return false; // a fifth level: nothing happens
        let made = null;
        if (!PM.wrapInList(kind)(state, (tr) => { made = tr; })) return false;
        if (dispatch) {
          if (boxes) { const now = dlRichRows(PM, { selection: made.selection }); if (now) boxed(made, now.rows, false); }
          dispatch(made.scrollIntoView());
        }
        return true;
      }
      const tasks = here.rows.length > 0 && here.rows.every((r) => r.node.attrs.checked !== null);
      if (boxes) { if (dispatch) dispatch(boxed(state.tr, here.rows, tasks ? null : false).scrollIntoView()); return true; }
      if (here.list.type !== kind) { if (dispatch) dispatch(state.tr.setNodeMarkup(here.at, kind, kind === N.ordered_list ? { order: 1 } : null).scrollIntoView()); return true; }
      if (kind === N.bullet_list && tasks) { if (dispatch) dispatch(boxed(state.tr, here.rows, null).scrollIntoView()); return true; }
      return PM.liftListItem(N.list_item)(state, dispatch);
    };
  }

  // The editor's own keys (everything else is the library's base keys: Enter, Backspace and Delete join and split, Mod-a).
  // Enter in a list row makes the next row (a checklist row an open one), Tab moves a row in, Shift-Tab out, Shift-Enter is a
  // line break in a paragraph and in code; a heading is one line. Mod-z, Mod-Shift-z and Mod-y are undo and redo.
  // Enter after "```" makes a code block (dlRichFence); Backspace straight after a typing shortcut puts the typed characters
  // back, and is the library's own Backspace otherwise. Mod-b, Mod-i and Mod-e are Bold, Italic and Code, the bar's own
  // actions; they are always taken while the editor can be typed in, so the browser never does its own bold. Mod-Enter ticks
  // or clears the checklist row the caret is in, and is the library's own (leave a code block) anywhere else.
  // Nothing else is bound: a key the editor does not use goes on to the page (Mod-s, the zoom keys, the call's shortcuts).
  function dlRichKeys(PM) {
    const N = dlRichSchema(PM).nodes;
    const rowAt = (state) => { const $from = state.selection.$from; for (let d = $from.depth; d > 0; d -= 1) if ($from.node(d).type === N.list_item) return $from.node(d); return null; };
    const mark = (action) => (state, dispatch, view) => {
      if (view && !view.editable) return false;
      dlRichCommand(PM, action)(state, dispatch, view);
      return true;
    };
    return {
      Enter: (state, dispatch) => {
        const fence = dlRichFence(PM, state);
        if (fence) { if (dispatch) dispatch(fence); return true; }
        const row = rowAt(state);
        return PM.splitListItem(N.list_item, row && row.attrs.checked !== null ? { checked: false } : undefined)(state, dispatch);
      },
      'Shift-Enter': (state, dispatch) => {
        if (PM.newlineInCode(state, dispatch)) return true;
        const { $from, $to } = state.selection;
        if ($from.parent.type === N.paragraph && $from.sameParent($to) && dispatch) dispatch(state.tr.replaceSelectionWith(N.hard_break.create()).scrollIntoView());
        return true;
      },
      Tab: (state, dispatch) => {
        const row = rowAt(state);
        if (!row) return false;
        if (dlRichDepth(PM, state).lists + dlRichListsIn(PM, row) >= DL.listDepth) return true; // a fifth level: nothing happens
        return PM.sinkListItem(N.list_item)(state, dispatch);
      },
      'Shift-Tab': PM.liftListItem(N.list_item),
      Backspace: PM.undoInputRule,
      'Mod-z': PM.undo,
      'Mod-Shift-z': PM.redo,
      'Mod-y': PM.redo,
      'Mod-b': mark('bold'),
      'Mod-i': mark('italic'),
      'Mod-e': mark('code'),
      'Mod-Enter': (state, dispatch, view) => {
        const $from = state.selection.$from;
        if ((view && !view.editable) || $from.parent.type.spec.code) return false;
        for (let d = $from.depth; d > 0; d -= 1) {
          const row = $from.node(d);
          if (row.type !== N.list_item) continue;
          if (row.attrs.checked === null) return false;
          if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(d), null, { ...row.attrs, checked: !row.attrs.checked }));
          return true;
        }
        return false;
      },
    };
  }
  const dlRichPluginSets = new WeakMap();
  function dlRichPlugins(PM) {
    if (!dlRichPluginSets.has(PM)) dlRichPluginSets.set(PM, [PM.keymap(dlRichKeys(PM)), PM.keymap(PM.baseKeymap), dlRichInputRules(PM), PM.history(), PM.gapCursor(), PM.dropCursor({ color: false, class: 'dl-drop', width: 2 })]);
    return dlRichPluginSets.get(PM);
  }

  // WHAT MARKDOWN CANNOT SAY, TAKEN OUT BEFORE THE TEXT IS WRITTEN. While a person types, the editor's text holds things no
  // Markdown says: spaces at the start or the end of a paragraph or a heading, a line break at the start or end of a
  // paragraph or anywhere in a heading, line breaks at the end of code, an empty last row of a list, an empty paragraph in a
  // row or a quote. dlRichTidy gives the text without them, so that what is written reads back as what was written. Only the
  // blocks a person changed are looked at: a block that is still the stored node is never touched. The editor's own text is
  // not changed; this is for the write alone. -> the same `top` when there is nothing to take out.
  function dlRichTidy(PM, top, stored) {
    const schema = dlRichSchema(PM);
    const N = schema.nodes;
    const M = schema.marks;
    const kept = new Set();
    if (stored && stored.entries) for (const e of stored.entries) kept.add(e.node);
    else if (stored && stored.doc) stored.doc.forEach((b) => kept.add(b));
    const blank = (n) => n.type === N.paragraph && n.childCount === 0;
    const isBreak = (n) => n.type === N.hard_break;
    const empty = (n) => (n.type === N.heading && !n.childCount) || (n.type === N.blockquote && n.childCount === 1 && (blank(n.firstChild) || empty(n.firstChild)));
    const plain = (n) => n.isText && !n.marks.some((m) => m.type.name === 'code');
    function words(node) {
      const heading = node.type === N.heading;
      let kids = [];
      node.forEach((c) => kids.push(heading && isBreak(c) ? schema.text(' ', c.marks) : c));
      // A space just inside the end or the start of bold, italic or strike ("**word **") is written outside the mark, as the
      // reader reads it: only that mark comes off the space, the other marks (a link) stay.
      const spans = (m) => m.type === M.strong || m.type === M.em || m.type === M.strike;
      const outside = (c, prev, next) => {
        if (!plain(c) || !c.marks.some(spans)) return [c];
        const lead = /^[ \t]*/.exec(c.text)[0];
        const trail = /[ \t]*$/.exec(c.text.slice(lead.length))[0];
        const body = c.text.slice(lead.length, c.text.length - trail.length);
        const strip = (marks, test) => marks.filter((m) => !(spans(m) && test(m)));
        const out = [];
        const opens = (m) => !(prev && m.isInSet(prev.marks));
        const closes = (m) => !(next && m.isInSet(next.marks));
        if (!body) { // only spaces: off every mark that opens or closes here
          const marks = strip(c.marks, (m) => opens(m) || closes(m));
          return marks.length === c.marks.length ? [c] : [c.mark(marks)];
        }
        if (lead) { const marks = strip(c.marks, opens); out.push(c.type.schema.text(lead, marks)); }
        out.push(c.type.schema.text(body, c.marks));
        if (trail) { const marks = strip(c.marks, closes); out.push(c.type.schema.text(trail, marks)); }
        return out.length === 1 && out[0].text === c.text ? [c] : out;
      };
      if (kids.some((c) => plain(c) && /^[ \t]|[ \t]$/.test(c.text) && c.marks.some(spans))) {
        const next = [];
        kids.forEach((c, i) => { for (const x of outside(c, kids[i - 1] || null, kids[i + 1] || null)) next.push(x); });
        kids = PM.Fragment.fromArray(next).content; // adjacent words with the same marks are one again
      }
      const start = (from) => { // spaces and line breaks at the start of a line
        for (;;) {
          const c = kids[from];
          if (!c) return;
          if (isBreak(c) && from === 0) { kids.splice(from, 1); continue; }
          if (!plain(c)) return;
          const t = c.text.replace(/^[ \t]+/, '');
          if (t === c.text) return;
          if (t) { kids[from] = c.withText(t); return; }
          kids.splice(from, 1);
        }
      };
      start(0);
      for (let i = 1; i < kids.length; i += 1) if (isBreak(kids[i - 1])) start(i);
      for (;;) { // line breaks and spaces at the end
        const c = kids[kids.length - 1];
        if (!c) break;
        if (isBreak(c)) { kids.pop(); continue; }
        if (!plain(c)) break;
        const t = c.text.replace(/[ \t]+$/, '');
        if (t === c.text) break;
        if (t) { kids[kids.length - 1] = c.withText(t); break; }
        kids.pop();
      }
      const made = PM.Fragment.fromArray(kids);
      return made.eq(node.content) ? node : node.copy(made);
    }
    // -> the node as it is, a tidied copy, or null when nothing of it is left.
    function tidy(node) {
      if (node.type === N.paragraph || node.type === N.heading) return words(node);
      if (node.type === N.code_block) { const t = dlTrimBreaks(node.textContent); return t === node.textContent ? node : node.copy(t ? PM.Fragment.from(schema.text(t)) : PM.Fragment.empty); }
      const list = node.type === N.bullet_list || node.type === N.ordered_list;
      if (!list && node.type !== N.list_item && node.type !== N.blockquote) return node;
      const kids = [];
      let same = true;
      node.forEach((c, offset, i) => {
        const t = tidy(c);
        if (t !== c) same = false;
        if (t && !(blank(t) && !list && i > 0)) kids.push(t); else if (t) same = false; // an empty paragraph after the first block
      });
      // A row's first line cannot be an empty heading or quote ("- # " has no words to read): it is an empty paragraph, as typing leaves it.
      if (node.type === N.list_item && kids.length && empty(kids[0])) { kids[0] = N.paragraph.create(); same = false; }
      if (list) while (kids.length && kids[kids.length - 1].childCount === 1 && blank(kids[kids.length - 1].firstChild)) { kids.pop(); same = false; }
      if (!list && kids.length > 1 && blank(kids[0]) && node.type === N.blockquote) { kids.shift(); same = false; }
      if (same) return node;
      if (!kids.length) return list ? null : node.copy(PM.Fragment.from(N.paragraph.create()));
      return node.copy(PM.Fragment.fromArray(kids));
    }
    const out = [];
    let same = true;
    top.forEach((b) => {
      const t = kept.has(b) ? b : tidy(b);
      if (t !== b) same = false;
      if (t) out.push(t);
    });
    if (same) return top;
    return top.copy(PM.Fragment.fromArray(out.length ? out : [N.paragraph.create()]));
  }

  // A pasted or dropped plain text, read as Markdown through the one gate (dlRichRead) -> what to put in, or null for nothing.
  // A paragraph at its start or end joins the words it lands in. No HTML is ever given to this.
  function dlRichPasteSlice(PM, text, lex) {
    const N = dlRichSchema(PM).nodes;
    if (typeof text !== 'string' || !text) return null;
    const top = dlRichRead(PM, text, lex).doc;
    if (top.childCount === 1 && top.firstChild.type === N.paragraph && !top.firstChild.childCount) return null;
    return new PM.Slice(top.content, top.firstChild.type === N.paragraph ? 1 : 0, top.lastChild.type === N.paragraph ? 1 : 0);
  }
  // The words of an HTML clipboard that has no plain text: read in a document of its own that draws nothing, runs nothing and
  // loads nothing (DOMParser), and only its text is taken. '' when that cannot be done.
  function dlRichInertText(html, doc) {
    try {
      const Parser = doc && doc.defaultView && doc.defaultView.DOMParser;
      if (!Parser || typeof html !== 'string' || !html || html.length > DL_RICH_PASTE.htmlMax) return '';
      const made = new Parser().parseFromString(html, 'text/html');
      for (const x of made.querySelectorAll('script, style, template, noscript, head')) x.remove();
      return made.body ? String(made.body.textContent || '') : '';
    } catch (err) { return ''; }
  }
  // The plain text of a clipboard or of what is dragged: its text/plain; with none, the words of its HTML (dlRichInertText).
  function dlRichClipText(data, doc) {
    if (!data) return '';
    let text = '';
    try { text = String(data.getData('text/plain') || ''); } catch (err) { text = ''; }
    if (text) return text;
    let html = '';
    try { html = String(data.getData('text/html') || ''); } catch (err) { html = ''; }
    return html ? dlRichInertText(html, doc) : '';
  }
  // What is copied, as Markdown: `slice` is the selection's content. Words inside one block are written as words, whole
  // blocks as blocks, rows as a list. What the serialiser cannot take (part of a grid) is given as its plain words.
  function dlRichCopy(PM, slice) {
    const N = dlRichSchema(PM).nodes;
    const c = slice.content;
    if (!c.childCount) return '';
    try {
      const first = c.firstChild;
      const top = N.doc.create(null, first.isInline ? [N.paragraph.create(null, c)] : first.type === N.list_item ? [N.bullet_list.create(null, c)] : c);
      top.check();
      return dlTrimBreaks(dlRichSerialise(PM, top));
    } catch (err) { return c.textBetween(0, c.size, '\n\n'); }
  }

  function dlRichEditor(PM, doc, lex, element) {
    const schema = dlRichSchema(PM);
    const N = schema.nodes;
    const plugins = dlRichPlugins(PM);
    const fns = [];
    const selFns = [];
    let rev = 0;
    let readOnly = false;
    let stored = null;
    let last = null; // what the last getText made: { text, changed, same, whole, ... } (dlRichText)
    let state = null; // the editor's state when there is no page
    let view = null;
    const now = () => (view ? view.state : state);
    const fresh = (text) => {
      const read = dlRichRead(PM, text, lex);
      stored = read.stored;
      last = null;
      return PM.EditorState.create({ doc: read.doc, plugins });
    };
    // Every change goes through here. Only a change of the text counts: moving the caret does not (onSelect hears both).
    const dispatch = (tr) => {
      const next = now().apply(tr);
      if (view) view.updateState(next); else state = next;
      if (tr.docChanged) { rev += 1; for (const fn of fns) fn(); }
      for (const fn of selFns) fn();
    };
    // Puts a plain text in as Markdown at the selection (or at `at`); inside code it goes in as it is.
    const insert = (text, at) => {
      if (readOnly) return false;
      const tr = now().tr;
      if (Number.isInteger(at)) tr.setSelection(PM.Selection.near(tr.doc.resolve(Math.max(0, Math.min(at, tr.doc.content.size)))));
      if (tr.selection.$from.parent.type.spec.code) {
        const clean = dlCleanText(String(text || ''));
        if (!clean) return false;
        tr.insertText(clean);
      } else {
        const slice = dlRichPasteSlice(PM, text, lex);
        if (!slice) return false;
        tr.replaceSelection(slice);
      }
      dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
      return true;
    };
    const getText = () => {
      last = dlRichText(PM, dlRichTidy(PM, now().doc, stored), stored, lex);
      return last.text;
    };
    state = fresh('');
    if (element) {
      view = new PM.EditorView(element, {
        state,
        dispatchTransaction: dispatch,
        editable: () => !readOnly,
        attributes: { class: 'page', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Text', spellcheck: 'true' },
        // The paste and the drop are taken here, before the library's own handlers: the library never sees them.
        handleDOMEvents: {
          paste(v, e) {
            e.preventDefault();
            insert(dlRichClipText(e.clipboardData, doc));
            return true;
          },
          drop(v, e) {
            if (v.dragging) return false; // the editor's own words being moved: the library moves its own nodes, no HTML is read
            e.preventDefault();
            const data = e.dataTransfer;
            if (!data || (data.files && data.files.length)) return true; // files are not taken
            let text = '';
            try { text = String(data.getData('text/plain') || ''); } catch (err) { text = ''; }
            const at = text ? v.posAtCoords({ left: e.clientX, top: e.clientY }) : null;
            if (at && insert(text, at.pos)) v.focus();
            return true;
          },
        },
        // If the library's own reader is ever reached all the same: its HTML is nothing, its text goes through the same gate.
        transformPastedHTML: () => '',
        clipboardTextParser: (text) => dlRichPasteSlice(PM, text, lex) || PM.Slice.empty,
        clipboardTextSerializer: (slice, v) => {
          const sel = v.state.selection;
          if (sel.$from.sameParent(sel.$to) && sel.$from.parent.type.spec.code) return slice.content.textBetween(0, slice.content.size, '\n');
          if (sel.from <= 1 && sel.to >= v.state.doc.content.size - 1 && slice.content.size >= v.state.doc.content.size - 2) return getText(); // the whole text: as it is saved
          return dlRichCopy(PM, slice);
        },
        // A press on a checklist row's box (the row itself, beside its words) ticks it or clears it.
        handleClickOn(v, pos, node, nodePos, e, direct) {
          if (readOnly || !direct || node.type !== N.list_item || node.attrs.checked === null || e.target !== v.nodeDOM(nodePos)) return false;
          dispatch(v.state.tr.setNodeMarkup(nodePos, null, { ...node.attrs, checked: !node.attrs.checked }));
          return true;
        },
      });
      state = null;
    }
    return {
      getText,
      setText: (text) => { const next = fresh(text); if (view) view.updateState(next); else state = next; rev += 1; for (const fn of selFns) fn(); },
      setReadOnly: (on) => { readOnly = Boolean(on); if (view) view.setProps({ editable: () => !readOnly }); },
      focus: () => { if (view) view.focus(); },
      onChange: (fn) => { fns.push(fn); },
      // For the bar: fn is called after every change of the selection or the text (cheap to call: it reads nothing), and
      // active() says which formats the selection is in (dlRichActive). The page asks at most once a frame.
      onSelect: (fn) => { selFns.push(fn); },
      active: () => dlRichActive(PM, now()),
      revision: () => rev,
      // -> true when the action was applied. A name with no action here (link, grid, formula), an action that does not fit
      // where the selection is, and a read-only editor: false, and nothing happens. The editor keeps its selection and takes
      // the keyboard back, because a press on a toolbar button or a menu takes it away.
      run(action) {
        const command = dlRichCommand(PM, action);
        const done = Boolean(command) && !readOnly && command(now(), dispatch, view || undefined);
        if (view && !readOnly) view.focus();
        return done;
      },
      can: dlRichCan,
      // Copy's fallback for a browser without the clipboard: select what is there.
      selectAll: () => { dispatch(now().tr.setSelection(new PM.AllSelection(now().doc))); if (view) view.focus(); },
      destroy: () => { fns.length = 0; selFns.length = 0; if (view) { view.destroy(); view = null; } },
      // What the last getText found: `same` false means a block was written that does not read back exactly as it stands.
      lastWrite: () => last,
      // For the page's checks and the tests: the editor's state, a change, a plain text put in as a paste puts it, and
      // words typed one character at a time as the keyboard types them (so the typing shortcuts run).
      state: now,
      dispatch,
      paste: (text) => insert(text),
      type(text) {
        if (readOnly) return false;
        for (const ch of Array.from(String(text == null ? '' : text))) {
          const st = now();
          const { from, to } = st.selection;
          const typing = view || { state: st, composing: false, editable: true, dispatch };
          if (!plugins.some((p) => p.props.handleTextInput && p.props.handleTextInput(typing, from, to, ch))) dispatch(st.tr.insertText(ch, from, to).scrollIntoView());
        }
        return true;
      },
    };
  }
