  // ---- documents-lib-r-rich-link.js: the Link button of the rich editor, and Ctrl or Cmd with K (no page, no host) -----------
  //
  // The page asks for the address (host.ui.prompt) and shows the menu of an existing link (host.menu.show); everything it
  // needs to know or change is here, as plain functions of the editor's state:
  //   dlRichLinkAt(PM, state)              the link the caret or the selection is in -> { from, to, mark }, or null
  //   dlRichLinkFits(PM, state)            is there a link here, or can one be made here? (so the page asks only then)
  //   dlLinkProblem / dlRichLinkProblem    what is wrong with an address a person gave: a short message, or '' for none
  //   dlRichLinkAdd(PM, state, raw)        the change that links the selection; at a caret, the address itself as the words
  //   dlRichLinkEdit(PM, state, link, raw) the change that gives a link another address (its title is kept)
  //   dlRichLinkRemove(PM, state, link)    the change that takes the link off all of its words
  // An address is taken only when the reader takes it (dlSafeAddress, through dlRichLinkOf: the typing rule's own path), so
  // the button makes exactly what typing "[words](address)" makes: a link mark, or the chip for an object: address. Any
  // other address makes no change at all. The address is only ever a string in a mark's or a node's attributes.
  const DL_LINK = Object.freeze({ max: 2000, shown: 60 });
  const DL_LINK_SAY = Object.freeze({
    blank: 'Type an address',
    long: 'Use a shorter address',
    refused: `Use an address that starts with ${DL_SCHEMES.slice(0, -1).join(', ')} or ${DL_SCHEMES[DL_SCHEMES.length - 1]}:`,
    place: 'Select words in one paragraph for this address',
  });
  // The address a person gave, without the space around it.
  const dlLinkAddress = (raw) => (typeof raw === 'string' ? raw.trim() : '');
  // An address as a menu's heading shows it: one line, cut with three dots.
  const dlLinkShown = (href) => { const t = dlCleanLine(String(href || ''), DL_LINK.max); return t.length > DL_LINK.shown ? `${dlCut(t, DL_LINK.shown - 1)}…` : t; };
  // What is wrong with an address by itself: nothing typed, too long, or not one the reader takes. '' when it is fine.
  function dlLinkProblem(PM, raw) {
    const address = dlLinkAddress(raw);
    if (!address) return DL_LINK_SAY.blank;
    if (address.length > DL_LINK.max) return DL_LINK_SAY.long;
    return dlRichLinkOf(PM, address, 'x') ? '' : DL_LINK_SAY.refused;
  }

  // The link the caret or the selection is in -> { from, to, mark }: all the words in a row that have the same link. A
  // caret at either end of a link is in it; a selection is in it when the link holds all of it. null: no link, or the
  // selection reaches out of one.
  function dlRichLinkAt(PM, state) {
    const type = dlRichSchema(PM).marks.link;
    const { $from, $to, from, to, empty } = state.selection;
    const parent = $from.parent;
    if (!parent.inlineContent || !$from.sameParent($to)) return null;
    const runs = [];
    let run = null;
    parent.forEach((node, offset) => {
      const mark = type.isInSet(node.marks) || null;
      const at = $from.start() + offset;
      if (mark && run && run.mark.eq(mark)) run.to = at + node.nodeSize;
      else if (mark) { run = { from: at, to: at + node.nodeSize, mark }; runs.push(run); } else run = null;
    });
    if (!empty) return runs.find((r) => r.from <= from && to <= r.to) || null;
    return runs.find((r) => r.from < from && from < r.to) || runs.find((r) => r.to === from) || runs.find((r) => r.from === from) || null;
  }

  // The words of a part of the text as one line, for a chip's label: a chip gives its label, a line break a space.
  function dlRichLinkWords(PM, doc, from, to) {
    const N = dlRichSchema(PM).nodes;
    return doc.textBetween(from, to, ' ', (leaf) => (leaf.type === N.object ? leaf.attrs.label : leaf.type === N.formula ? leaf.attrs.tex : leaf.type === N.source ? leaf.attrs.src : ' '));
  }

  // Can a link be made of the selection? At a caret: in words that take a link (not in code, not between blocks). Over a
  // selection: there are words in it, and some of them are in a block that takes a link and are not a chip.
  function dlRichLinkable(PM, state) {
    const schema = dlRichSchema(PM);
    const { $from, from, to, empty } = state.selection;
    if (empty) return $from.parent.inlineContent && $from.parent.type.allowsMarkType(schema.marks.link);
    if (!dlRichLinkWords(PM, state.doc, from, to).trim()) return false;
    let some = false;
    state.doc.nodesBetween(from, to, (node, pos, parent) => { if (node.isInline && node.type !== schema.nodes.object && parent.type.allowsMarkType(schema.marks.link)) some = true; return !some; });
    return some;
  }

  // The change that links the selection to the address -> a transaction, or null when nothing can be linked (an address the
  // reader refuses, no words in the selection, a place that takes no link such as code). At a caret the address itself
  // goes in as the link's words. A chip in the selection stays a chip: the words on each side of it are linked. An
  // object: address makes the chip in place of the selected words, which must be in one block.
  function dlRichLinkAdd(PM, state, raw) {
    const schema = dlRichSchema(PM);
    const N = schema.nodes;
    const address = dlLinkAddress(raw);
    const { $from, $to, from, to, empty } = state.selection;
    if (!dlRichLinkable(PM, state)) return null;
    const made = dlRichLinkOf(PM, address, empty ? address : dlRichLinkWords(PM, state.doc, from, to));
    if (!made) return null;
    const tr = state.tr;
    if (made.chip) {
      if (!$from.sameParent($to) || !$from.parent.inlineContent || !$from.parent.canReplaceWith($from.index(), $to.indexAfter(), N.object)) return null;
      tr.replaceWith(from, to, made.chip);
      return tr.setSelection(PM.TextSelection.create(tr.doc, from + made.chip.nodeSize));
    }
    if (empty) {
      const text = made.mark.attrs.href; // the address in the form it is kept in
      tr.insert(from, schema.text(text, made.mark.addToSet(state.storedMarks || $from.marks())));
      return tr.setSelection(PM.TextSelection.create(tr.doc, from + text.length));
    }
    let at = from;
    const mark = (end) => { if (end > at) tr.addMark(at, end, made.mark); };
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type !== N.object) return true;
      mark(pos);
      at = pos + node.nodeSize;
      return false;
    });
    mark(to);
    return tr.steps.length ? tr : null;
  }

  // The change that gives the link another address -> a transaction, or null (a refused address, or the same address).
  // The link's title is kept. An object: address makes the chip of the link's words.
  function dlRichLinkEdit(PM, state, link, raw) {
    const N = dlRichSchema(PM).nodes;
    const made = link ? dlRichLinkOf(PM, dlLinkAddress(raw), dlRichLinkWords(PM, state.doc, link.from, link.to), link.mark.attrs.title) : null;
    if (!made) return null;
    const tr = state.tr;
    if (made.chip) {
      const $at = state.doc.resolve(link.from);
      if (!$at.parent.canReplaceWith($at.index(), state.doc.resolve(link.to).indexAfter(), N.object)) return null;
      tr.replaceWith(link.from, link.to, made.chip);
      return tr.setSelection(PM.TextSelection.create(tr.doc, link.from + made.chip.nodeSize));
    }
    if (made.mark.eq(link.mark)) return null;
    return tr.addMark(link.from, link.to, made.mark);
  }

  // The change that takes the link off all of its words (the words stay).
  function dlRichLinkRemove(PM, state, link) {
    return link ? state.tr.removeMark(link.from, link.to, dlRichSchema(PM).marks.link) : null;
  }

  // Is there a link here, or can one be made here? False in code, between blocks and over a selection with no words.
  const dlRichLinkFits = (PM, state) => Boolean(dlRichLinkAt(PM, state)) || dlRichLinkable(PM, state);

  // What is wrong with an address for where the selection is -> a short message, or '' when it can be used. The same
  // address a link already has is fine (nothing changes).
  function dlRichLinkProblem(PM, state, raw) {
    const problem = dlLinkProblem(PM, raw);
    if (problem) return problem;
    const link = dlRichLinkAt(PM, state);
    if (link) return dlRichLinkEdit(PM, state, link, raw) || dlRichLinkOf(PM, dlLinkAddress(raw), 'x').mark ? '' : DL_LINK_SAY.place;
    return dlRichLinkAdd(PM, state, raw) ? '' : DL_LINK_SAY.place;
  }
