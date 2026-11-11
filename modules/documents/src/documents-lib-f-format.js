  // ---- documents-lib-f-format.js: the formatting bar's text changes (no page, no host) --------------------------------------
  //
  // Each takes { value, start, end } (the text and the selection) and returns it changed, in the same shape. Nothing here
  // touches a page.
  const DL_SCHEME = 'obj' + 'ect'; // the address form of a link to another object
  const dlSel = (s) => {
    const value = String(s && s.value != null ? s.value : '');
    let start = Math.max(0, Math.min(value.length, Number.isInteger(s && s.start) ? s.start : value.length));
    let end = Math.max(0, Math.min(value.length, Number.isInteger(s && s.end) ? s.end : start));
    if (end < start) [start, end] = [end, start];
    return { value, start, end };
  };
  // The lines the selection touches: [from, to) in the text.
  function dlLineSpan(value, start, end) {
    const from = value.lastIndexOf('\n', start - 1) + 1;
    let to = value.indexOf('\n', end > start && value[end - 1] === '\n' ? end - 1 : end);
    if (to < 0) to = value.length;
    return [from, to];
  }

  // Bold, italic, inline code: wrap the selection; wrapped already, take the marks off; nothing selected: marks and the cursor between.
  function dlWrap(sel, mark, placeholder = '') {
    const { value, start, end } = dlSel(sel);
    const m = mark.length;
    if (start >= m && value.slice(start - m, start) === mark && value.slice(end, end + m) === mark && !(mark === '*' && value[start - 2] === '*' && value[end + 1] === '*' && false)) {
      return { value: value.slice(0, start - m) + value.slice(start, end) + value.slice(end + m), start: start - m, end: end - m };
    }
    const inner = value.slice(start, end);
    if (inner.length >= 2 * m && inner.startsWith(mark) && inner.endsWith(mark)) {
      const core = inner.slice(m, inner.length - m);
      return { value: value.slice(0, start) + core + value.slice(end), start, end: start + core.length };
    }
    const body = inner || placeholder;
    const next = value.slice(0, start) + mark + body + mark + value.slice(end);
    return { value: next, start: start + m, end: start + m + body.length };
  }
  const dlBold = (sel) => dlWrap(sel, '**', 'bold');
  const dlItalic = (sel) => dlWrap(sel, '*', 'italic');
  const dlCode = (sel) => dlWrap(sel, '`', 'code');

  // Per-line prefixes. `strip` matches an existing prefix of the same kind; present on every line: remove; else set.
  function dlPrefixLines(sel, make, strip) {
    const { value, start, end } = dlSel(sel);
    const [from, to] = dlLineSpan(value, start, end);
    const lines = value.slice(from, to).split('\n');
    const all = lines.some((l) => l.trim() !== '') && lines.every((l) => l.trim() === '' || strip.test(l));
    let n = 0;
    const out = lines.map((l) => {
      if (all) return l.replace(strip, '');
      n += 1;
      return make(l.replace(strip, ''), n);
    });
    const body = out.join('\n');
    return { value: value.slice(0, from) + body + value.slice(to), start: from, end: from + body.length };
  }
  const dlList = (sel) => dlPrefixLines(sel, (l) => `- ${l}`, /^(\s*)- (?!\[[ xX]\] )/);
  const dlNumbered = (sel) => dlPrefixLines(sel, (l, n) => `${n}. ${l}`, /^\s*\d+[.)] /);
  const dlChecklist = (sel) => dlPrefixLines(sel, (l) => `- [ ] ${l}`, /^(\s*)- \[[ xX]\] /);
  const dlQuote = (sel) => dlPrefixLines(sel, (l) => `> ${l}`, /^ {0,3}> ?/);

  // Heading 1 to 4: sets the level on the lines the cursor is in; the same level again takes it off.
  function dlHeading(sel, level) {
    const lv = Math.min(4, Math.max(1, Number(level) || 1));
    const { value, start, end } = dlSel(sel);
    const [from, to] = dlLineSpan(value, start, end);
    const line = value.slice(from, to);
    const m = /^(#{1,6}) /.exec(line);
    const plain = line.replace(/^#{1,6} /, '');
    const next = m && m[1].length === lv ? plain : `${'#'.repeat(lv)} ${plain}`;
    return { value: value.slice(0, from) + next + value.slice(to), start: from, end: from + next.length };
  }

  // A link: the selection is its text (or a placeholder) and the address is selected to be typed over.
  function dlLink(sel, address = 'https://') {
    const { value, start, end } = dlSel(sel);
    const text = value.slice(start, end) || 'link';
    const ins = `[${text}](${address})`;
    const a = start + text.length + 3;
    return { value: value.slice(0, start) + ins + value.slice(end), start: a, end: a + address.length };
  }
  // An object link: [label](object:<module>:<kind>:<id>); null when the reference is not plain.
  function dlObjectLink(sel, ref) {
    if (!ref || !/^[a-z][a-z0-9_-]{0,39}$/.test(ref.module || '') || !/^[a-z][a-z0-9_-]{0,39}$/.test(ref.kind || '') || !/^[A-Za-z0-9._-]{1,64}$/.test(ref.id || '')) return null;
    const label = dlCleanLine(String(ref.label || '').replace(/[\[\]\\]/g, ''), 200) || 'Link';
    const { value, start, end } = dlSel(sel);
    const ins = `[${label}](${DL_SCHEME}:${ref.module}:${ref.kind}:${ref.id})`;
    return { value: value.slice(0, start) + ins + value.slice(end), start: start + ins.length, end: start + ins.length };
  }
  // A table skeleton (cols x rows, a header and the rule line), on its own lines; the first header cell is selected.
  function dlGrid(sel, cols = 3, rows = 2) {
    const c = Math.min(DL.gridCols, Math.max(1, cols));
    const r = Math.min(DL.gridRows, Math.max(1, rows));
    const { value, start, end } = dlSel(sel);
    const line = (f) => `| ${Array.from({ length: c }, (_, i) => f(i)).join(' | ')} |`;
    const table = [line((i) => `Heading ${i + 1}`), line(() => '---'), ...Array.from({ length: r }, () => line(() => '   '))].join('\n');
    const before = value.slice(0, start);
    const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const after = value.slice(end);
    const trail = after === '' || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
    const at = start + lead.length + 2;
    return { value: before + lead + table + trail + after, start: at, end: at + 'Heading 1'.length };
  }
  // A formula: inline $...$ around the selection, or a block $$ ... $$ on its own lines.
  function dlFormula(sel, block = false) {
    const { value, start, end } = dlSel(sel);
    const inner = value.slice(start, end);
    if (!block) {
      if (start >= 1 && value[start - 1] === '$' && value[end] === '$') return { value: value.slice(0, start - 1) + inner + value.slice(end + 1), start: start - 1, end: end - 1 };
      const body = inner || 'x';
      return { value: `${value.slice(0, start)}$${body}$${value.slice(end)}`, start: start + 1, end: start + 1 + body.length };
    }
    const body = inner || 'x';
    const before = value.slice(0, start);
    const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const after = value.slice(end);
    const trail = after === '' || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
    const at = start + lead.length + 3;
    return { value: `${before}${lead}$$\n${body}\n$$${trail}${after}`, start: at, end: at + body.length };
  }
