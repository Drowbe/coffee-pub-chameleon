/*
 * gate-gen.mjs -- a generator of hostile and honest blocks for the co-editing gate's tests (check-documents-coedit-gate.mjs). Not a test.
 * genBlock(PM, R) makes ONE top-level block as shared types (not yet inserted); R is a seeded generator (rng in yjs-peers.mjs).
 * The text is picked from pieces that are hard to write as Markdown and read back: control, line-break, NUL and direction characters,
 * fences, Markdown marks at the start of a line, emoji, right-to-left words and lone surrogates.
 */
const PIECES = ['a', 'bc', 'word', ' ', '  ', 'x y', '\n', '\r', '\r\n', '\u0000', '\u0001', '\u007f', '\t', '‮', '⁦', '​', '﻿', '؜',
  '```', '~~~', '```js', '``', '`', '*', '**', '_', '~~', '#', '# ', '> ', '- ', '1. ', '1) ', '- [ ] ', '|', ' | ', '[', ']', '(', ')', '[a](b)', '$', '$$', '\\', '<', '&', '<div>', '---', '___', '_ _ _', '=',
  '\u{1F600}', '\u{1F468}‍\u{1F469}', 'שלום', 'ال', '\ud800', '\udc00', ' ', ' ', '\u0085', ' ', '�', 'é', '\u{e0041}'];
const MARKS = ['strong', 'em', 'strike', 'code', 'link'];

export function genText(R, max = 6) { let s = ''; for (let i = Math.floor(R() * max); i >= 0; i -= 1) s += PIECES[Math.floor(R() * PIECES.length)]; return s; }
const pick = (R, a) => a[Math.floor(R() * a.length)];

export function genBlock(PM, R, depthBias = 0) {
  const el = (name, attrs = {}, kids = []) => { const e = new PM.XmlElement(name); for (const k in attrs) e.setAttribute(k, attrs[k]); if (kids.length) e.insert(0, kids); return e; };
  const run = (text, fmt) => { const t = new PM.XmlText(); t.insert(0, text, fmt); return t; };
  const marks = () => { const f = {}; for (const m of MARKS) if (R() < 0.12) f[m] = m === 'link' ? { href: pick(R, ['https://example.com', 'http://a.b/c?d=e', 'mailto:a@b.c']), title: '' } : {}; return Object.keys(f).length ? f : undefined; };
  const inline = () => {
    const out = []; const n = Math.floor(R() * 4);
    for (let i = 0; i < n; i += 1) {
      const r = R();
      if (r < 0.72) out.push(run(genText(R), marks()));
      else if (r < 0.8) out.push(el('hard_break'));
      else if (r < 0.86) out.push(el('formula', { tex: pick(R, ['x^2', 'a+b', 'e=mc^2', '\\frac{1}{2}', 'a b', 'x_1']) }));
      else if (r < 0.93) out.push(el('object', { module: 'maps', kind: 'place', id: 'abc123', label: pick(R, ['Map', 'a b', 'x]y', '[z]', 'q‮', '']), title: '' }));
      else out.push(el('source', { src: genText(R, 3) || 'x' }));
    }
    return out;
  };
  const para = () => el('paragraph', {}, inline());
  const leaf = () => {
    const r = R();
    if (r < 0.4) return para();
    if (r < 0.5) return el('heading', { level: 1 + Math.floor(R() * 6) }, inline());
    if (r < 0.6) return el('code_block', { lang: pick(R, ['', 'js', 'c++']), info: pick(R, ['', 'x y']) }, [run(genText(R, 8))]);
    if (r < 0.66) return el('source_block', {}, [run(genText(R, 8))]);
    if (r < 0.7) return el('horizontal_rule');
    if (r < 0.74) return el('formula_block', { tex: pick(R, ['x^2', 'a\nb', 'a b', '\\sum_i i']) });
    if (r < 0.84) { // a grid
      const cols = 1 + Math.floor(R() * 3); const rows = [];
      for (let i = 0; i < 1 + Math.floor(R() * 3); i += 1) { const cells = []; for (let j = 0; j < cols; j += 1) cells.push(el(i === 0 ? 'grid_head' : 'grid_cell', { colspan: 1, rowspan: 1, align: pick(R, [null, 'left', 'center', 'right']) }, inline())); rows.push(el('grid_row', {}, cells)); }
      return el('grid', {}, rows);
    }
    return para();
  };
  const wrap = (inner, depth) => {
    let node = inner;
    for (let i = 0; i < depth; i += 1) {
      const r = R();
      if (r < 0.34) node = el('blockquote', {}, [node, ...(R() < 0.2 ? [para()] : [])]);
      else if (r < 0.67) node = el('bullet_list', {}, [el('list_item', { checked: pick(R, [null, null, true, false]) }, [node, ...(R() < 0.2 ? [para()] : [])]), ...(R() < 0.2 ? [el('list_item', { checked: null }, [para()])] : [])]);
      else node = el('ordered_list', { order: pick(R, [1, 1, 3, 0]) }, [el('list_item', { checked: null }, [node])]);
    }
    return node;
  };
  const r = R();
  if (r < 0.55) return leaf();
  const depth = r < 0.8 ? 1 + Math.floor(R() * 3) : r < 0.95 ? 1 + Math.floor(R() * 9) : 3 + depthBias + Math.floor(R() * 14);
  return wrap(leaf(), depth);
}
