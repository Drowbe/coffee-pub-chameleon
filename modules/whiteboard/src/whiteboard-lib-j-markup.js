  // ---- whiteboard-lib-j-markup.js: the formatting bar's changes to the words, as plain text ------------------------------
  //
  // What Bold, Italic, Code, the lists, Heading and Link do to the words being edited: each takes the words and the
  // selection ({ value, start, end }) and gives them back changed ({ value, start, end }), so the editor (lib-d) puts the
  // new words in the box and selects what it says. Nothing here touches the page: it is the same markup chat's composer
  // writes, read by the host's markdown. A mark already round the selection (or just outside it) is taken off again.

  // A mark round words: bold '**', italic '*' (or '_', only taken off), code '`'.
  const WB_MARKS = {
    bold: { mark: '**', also: [] },
    italic: { mark: '*', also: ['_'] },
    code: { mark: '`', also: [] },
  };
  // How many of `ch` run from i in the direction step (1 or -1).
  function wbRun(s, i, ch, step) {
    let n = 0;
    while (i >= 0 && i < s.length && s[i] === ch) { n += 1; i += step; }
    return n;
  }
  // Whether a run of n of a mark's character holds the mark: bold is two or more stars, italic an odd count (one, or
  // three for bold and italic), code one or more.
  function wbHolds(mark, n) {
    if (mark === '**') return n >= 2;
    if (mark === '*' || mark === '_') return n % 2 === 1;
    return n >= 1;
  }
  // The words of one line with the mark on or off. on: true, false, or null to toggle.
  function wbMarkLine(line, mark, also, on) {
    const lead = line.length - line.trimStart().length;
    const tail = line.length - line.trimEnd().length;
    const core = line.slice(lead, line.length - tail);
    if (!core) return { line, had: false };
    for (const m of [mark, ...also]) {
      const ch = m[0];
      const a = wbRun(core, 0, ch, 1);
      const b = wbRun(core, core.length - 1, ch, -1);
      if (a < core.length && wbHolds(m, a) && wbHolds(m, b)) {
        const inner = core.slice(m.length, core.length - m.length);
        if (on === true) return { line, had: true };
        return { line: line.slice(0, lead) + inner + line.slice(line.length - tail), had: true };
      }
    }
    if (on === false) return { line, had: false };
    return { line: line.slice(0, lead) + mark + core + mark + line.slice(line.length - tail), had: false };
  }

  // Bold, italic or code on the selection, or off when it is there already. With nothing selected, a pair of marks with the
  // caret between them (or, between an empty pair, the pair taken away). A selection over several lines marks each line.
  function wbToggleMark(value, start, end, kind) {
    const spec = WB_MARKS[kind];
    if (!spec) return { value, start, end };
    const { mark, also } = spec;
    const m = mark.length;
    const ch = mark[0];
    if (start === end) {
      // Between an empty pair: take it away.
      if (value.slice(start - m, start) === mark && value.slice(end, end + m) === mark && wbHolds(mark, wbRun(value, start - 1, ch, -1)) && wbHolds(mark, wbRun(value, end, ch, 1))) {
        return { value: value.slice(0, start - m) + value.slice(end + m), start: start - m, end: start - m };
      }
      return { value: value.slice(0, start) + mark + mark + value.slice(end), start: start + m, end: start + m };
    }
    // The mark just outside the selection: taken off there.
    for (const mk of [mark, ...also]) {
      const c = mk[0];
      const before = wbRun(value, start - 1, c, -1);
      const after = wbRun(value, end, c, 1);
      const sel = value.slice(start, end);
      if (!sel.includes('\n') && sel.trim() === sel && wbHolds(mk, before) && wbHolds(mk, after)) {
        const k = mk.length;
        return { value: value.slice(0, start - k) + sel + value.slice(end + k), start: start - k, end: end - k };
      }
    }
    const lines = value.slice(start, end).split('\n');
    const filled = lines.filter((l) => l.trim());
    // Off when every line with words has it; else on for every line.
    const allHave = filled.length > 0 && filled.every((l) => wbMarkLine(l, mark, also, false).had);
    const out = lines.map((l) => wbMarkLine(l, mark, also, allHave ? false : true).line).join('\n');
    const next = value.slice(0, start) + out + value.slice(end);
    if (lines.length === 1 && filled.length) {
      // One line: its words are selected, inside the marks.
      const lead = out.length - out.trimStart().length;
      const tail = out.length - out.trimEnd().length;
      const k = allHave ? 0 : m;
      return { value: next, start: start + lead + k, end: start + out.length - tail - k };
    }
    return { value: next, start, end: start + out.length };
  }

  // The lines the selection touches: from the start of its first line to the end of its last.
  function wbLinesOf(value, start, end) {
    const from = value.lastIndexOf('\n', start - 1) + 1;
    let to = value.indexOf('\n', end > start && value[end - 1] === '\n' ? end - 1 : end);
    if (to < 0) to = value.length;
    return { from, to };
  }
  const WB_LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
  const WB_HEAD_RE = /^#{1,6}\s+/;

  // A bulleted ('ul') or numbered ('ol') list on the lines the selection touches, or off when they are one already.
  // A heading mark on a line goes when it becomes a list.
  function wbToggleList(value, start, end, kind) {
    const { from, to } = wbLinesOf(value, start, end);
    const lines = value.slice(from, to).split('\n');
    const isKind = (l) => (kind === 'ol' ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/).test(l);
    const filled = lines.filter((l) => l.trim());
    const off = filled.length > 0 && filled.every(isKind);
    let n = 0;
    const out = lines.map((l) => {
      if (!l.trim()) return l;
      const bare = l.replace(WB_LIST_RE, '$1').replace(WB_HEAD_RE, '');
      if (off) return bare;
      n += 1;
      const indent = /^\s*/.exec(bare)[0];
      return `${indent}${kind === 'ol' ? `${n}.` : '-'} ${bare.slice(indent.length)}`;
    }).join('\n');
    if (!filled.length) {
      // An empty line: the list's first mark, the caret after it.
      const mark = kind === 'ol' ? '1. ' : '- ';
      return { value: value.slice(0, from) + mark + value.slice(from), start: from + mark.length, end: from + mark.length };
    }
    return { value: value.slice(0, from) + out + value.slice(to), start: from, end: from + out.length };
  }

  // The heading level of the first line with words the selection touches: 0 (none) to 3.
  function wbHeadingOf(value, start, end) {
    const { from, to } = wbLinesOf(value, start, end);
    const first = value.slice(from, to).split('\n').find((l) => l.trim()) || '';
    const m = /^(#{1,6})\s+/.exec(first);
    return m ? Math.min(3, m[1].length) : 0;
  }
  // Heading: none, then a large heading (#), a middle one (##), a small one (###), then none again, on the lines the
  // selection touches. A list mark on a line goes when it becomes a heading.
  function wbCycleHeading(value, start, end) {
    const { from, to } = wbLinesOf(value, start, end);
    const level = (wbHeadingOf(value, start, end) + 1) % 4;
    const lines = value.slice(from, to).split('\n');
    const out = lines.map((l) => {
      if (!l.trim() && lines.length > 1) return l;
      const bare = l.replace(WB_HEAD_RE, '').replace(WB_LIST_RE, '');
      return level ? `${'#'.repeat(level)} ${bare}` : bare;
    }).join('\n');
    const next = value.slice(0, from) + out + value.slice(to);
    if (start === end) {
      // The caret stays in the same place in the words, after the heading's mark.
      const at = Math.max(from + (level ? level + 1 : 0), Math.min(from + out.length, start + (out.length - (to - from))));
      return { value: next, start: at, end: at };
    }
    return { value: next, start: from, end: from + out.length };
  }

  // The address a person typed for a link, made safe: an http or https address (one with no scheme is taken as https),
  // or null for anything else (javascript:, data:, a file, words). Brackets are written as %28 and %29 so the markup's
  // (address) ends where it should.
  function wbLinkAddress(input) {
    let s = String(input == null ? '' : input).replace(/[\u0000- \u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, '');
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) {
      // Another scheme ("javascript:", "data:", "mailto:") is refused; "example.com:8080" is a host and a port.
      if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s) || s.startsWith('//') || !/^[^/?#]+\.[^/?#]/.test(s)) return null;
      s = `https://${s}`;
    }
    let u;
    try { u = new URL(s); } catch { return null; }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null;
    const href = u.href.replace(/\(/g, '%28').replace(/\)/g, '%29');
    return /^https?:\/\/[^\s)]+$/i.test(href) && href.length <= 2000 ? href : null;
  }

  // A link round the selection: [words](address). With nothing selected the address is the words too. A selection that
  // is a link already gets the new address. The words end up selected.
  function wbLinkMarkup(value, start, end, address) {
    const sel = value.slice(start, end).replace(/[\r\n]+/g, ' ');
    const was = /^\[([^\]\n]+)\]\((?:[^\s)]*)\)$/.exec(sel);
    const words = (was ? was[1] : sel.trim() ? sel : address).replace(/[[\]]/g, '');
    const out = `[${words}](${address})`;
    return { value: value.slice(0, start) + out + value.slice(end), start: start + 1, end: start + 1 + words.length };
  }

  // Whether words hold any markup the host's markdown would change. Words with none are drawn as they always were (as
  // text, line breaks and spaces as typed), so a plain note looks exactly as before.
  function wbHasMarkup(text) {
    return /[*_`]|\]\(|https?:\/\/|^\s*(?:#{1,3}\s|>|-\s|\d+[.)]\s)/m.test(String(text || ''));
  }
