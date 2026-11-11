  // ---- documents-lib-d-reader.js: Markdown -> plain description -> DOM steps (no page, no host) ----------------------------
  //
  // The parser is INJECTED: dlDescribe(markdown, lex) where lex(markdown) returns a `marked`-style token list. The description
  // is plain data (no HTML anywhere). dlBuild(description, doc, hooks) makes elements with createElement and textContent only;
  // nothing a person wrote is ever set as HTML. Raw HTML, pictures and unsafe links come out as text. Bounds: tables 200 x 20,
  // list depth 4, a formula 2000 characters; beyond them the source is shown as text.

  const DL_SCHEMES = ['http', 'https', 'mailto', 'object'];
  // Whitespace, control, invisible and direction characters inside an address are not an escape: take them all out first.
  const DL_ADDRESS_NOISE = /[\u0000- \u007f-\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u2066-\u206f\u3000\ufeff]/g;

  function dlDecodeEntities(s) {
    return s
      .replace(/&#x([0-9a-f]{1,6});?/gi, (m, h) => (parseInt(h, 16) <= 0x10ffff ? String.fromCodePoint(parseInt(h, 16)) : ''))
      .replace(/&#(\d{1,7});?/g, (m, d) => (Number(d) <= 0x10ffff ? String.fromCodePoint(Number(d)) : ''))
      .replace(/&(tab|newline|colon|nbsp);?/gi, (m, n) => ({ tab: '\t', newline: '\n', colon: ':', nbsp: ' ' }[n.toLowerCase()]));
  }
  // TEXT as Markdown means it. marked leaves the entities of a text run in its HTML-escaped form (&amp; &lt; &copy;) and decodes
  // the numeric ones itself; this takes them back to characters. The result is only ever put in a text node, never parsed.
  // A name that is not in the list, and a lone &, stay as written.
  const DL_NAMED = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '\u00a9', reg: '\u00ae', trade: '\u2122', deg: '\u00b0',
    plusmn: '\u00b1', times: '\u00d7', divide: '\u00f7', middot: '\u00b7', bull: '\u2022', hellip: '\u2026', ndash: '\u2013', mdash: '\u2014',
    lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', laquo: '\u00ab', raquo: '\u00bb', euro: '\u20ac', pound: '\u00a3',
    yen: '\u00a5', cent: '\u00a2', sect: '\u00a7', para: '\u00b6', larr: '\u2190', rarr: '\u2192', uarr: '\u2191', darr: '\u2193',
    hearts: '\u2665', check: '\u2713', ne: '\u2260', le: '\u2264', ge: '\u2265', infin: '\u221e', frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be',
    colon: ':', tab: '\t', newline: '\n', num: '#', dollar: '$', lbrack: '[', rbrack: ']', lsqb: '[', rsqb: ']', bsol: '\\', grave: '`',
  };
  function dlDecodeText(s) {
    if (typeof s !== 'string' || s.indexOf('&') < 0) return s;
    return s.replace(/&(?:#[xX]([0-9a-fA-F]{1,6})|#(\d{1,7})|([A-Za-z][A-Za-z0-9]{1,31}));/g, (m, h, d, n) => {
      if (n) return Object.prototype.hasOwnProperty.call(DL_NAMED, n) ? DL_NAMED[n] : m;
      const c = h ? parseInt(h, 16) : Number(d);
      return c === 0 || c > 0x10ffff || (c >= 0xd800 && c <= 0xdfff) ? '\ufffd' : String.fromCodePoint(c);
    });
  }
  // A chip or link label -> Markdown that reads back as the same label: a backslash before every character the reader would take
  // as syntax or decode (\ [ ] ( ) ` * _ ~ < > & $ ! |). A new line becomes a space (a label is one line).
  function dlEscapeLabel(text) {
    return String(text == null ? '' : text).replace(/\s*\n\s*/g, ' ').replace(/[\\\[\]()`*_~<>&$!|]/g, '\\$&');
  }
  // An address -> { kind:'link', href } | { kind:'object', module, kind2, id } | null (show it as text).
  function dlSafeAddress(raw) {
    if (typeof raw !== 'string' || raw.length > 2048) return null;
    let s = raw;
    for (let i = 0; i < 2; i += 1) s = dlDecodeEntities(s); // entities, and entities of entities
    s = s.replace(DL_ADDRESS_NOISE, '');
    const m = /^([a-z][a-z0-9+.-]*):/i.exec(s);
    if (!m) return null; // no scheme: relative, protocol-relative and fragment addresses are not allowed
    const scheme = m[1].toLowerCase();
    if (!DL_SCHEMES.includes(scheme)) return null;
    const rest = s.slice(m[0].length);
    if (scheme === 'object') {
      if (new RegExp(DL_ADDRESS_NOISE.source).test(raw.trim()) || /&/.test(raw)) return null; // an object address is exact: no spaces, no entities
      const o = /^([a-z][a-z0-9_-]{0,39}):([a-z][a-z0-9_-]{0,39}):([A-Za-z0-9._-]{1,64})$/.exec(rest);
      return o ? { kind: 'object', module: o[1], objectKind: o[2], id: o[3] } : null;
    }
    if (/[<>"'`\\]/.test(s)) return null;
    if (scheme === 'mailto') return /^[^@/?#]+@[^@/?#]+/.test(rest) ? { kind: 'link', href: `mailto:${rest}` } : null;
    return /^\/\/[^/?#:@]+/.test(rest) || /^\/\/[^/?#@]*@[^/?#]+/.test(rest) ? { kind: 'link', href: `${scheme}:${rest}` } : null;
  }

  const dlText = (v) => ({ t: 'text', v: dlCleanText(v) });
  const dlTitle = (t) => (typeof t === 'string' && t ? { title: dlCleanLine(dlDecodeText(t), 200) } : {});
  // Split a text run at $...$ (not "$5 and $6": the closing $ is not followed by a digit; the formula is 2000 characters at most).
  const DL_INLINE_MATH = /\$(?=\S)([^$\n]{1,2000}?\S|\S)\$(?!\d)/g;
  // A footnote mark ([^1], and [^1]: where its note starts). The reader draws no footnotes: the mark is shown as it is written,
  // as before, and flagged raw so a later editor keeps it word for word instead of escaping its brackets.
  const DL_NOTE_MARK = /\[\^[^\s\[\]^]{1,64}\]:?/g;
  function dlNoteSplit(v) {
    if (v.indexOf('[^') < 0) return [dlText(v)];
    const out = [];
    let last = 0;
    DL_NOTE_MARK.lastIndex = 0;
    let m;
    while ((m = DL_NOTE_MARK.exec(v))) {
      if (m.index > last) out.push(dlText(v.slice(last, m.index)));
      out.push({ ...dlText(m[0]), raw: true });
      last = m.index + m[0].length;
    }
    if (last < v.length) out.push(dlText(v.slice(last)));
    return out;
  }
  function dlMathSplit(v) {
    const out = [];
    let last = 0;
    DL_INLINE_MATH.lastIndex = 0;
    let m;
    while ((m = DL_INLINE_MATH.exec(v))) {
      if (m.index > last) out.push(...dlNoteSplit(v.slice(last, m.index)));
      out.push({ t: 'math', tex: dlCleanText(m[1]), display: false });
      last = m.index + m[0].length;
    }
    if (last < v.length) out.push(...dlNoteSplit(v.slice(last)));
    return out;
  }

  // A marked inline extension (give it to `new marked.Marked({ extensions: [DL_MARKED_MATH], hooks: DL_MARKED_HOOKS })`): it reads $...$ and $$...$$ BEFORE
  // marked's escape rule, so a formula keeps its backslashes (\, \{ \% \\). A $ followed by a digit or a space starts nothing,
  // and \$ is a literal dollar (the escape rule takes it first). The token is { type:'math', raw, text } and `text` is the TeX.
  const DL_MARKED_MATH = {
    name: 'math',
    level: 'inline',
    start: (src) => { const i = src.indexOf('$'); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^\$\$(?=\S)([^$]{1,2000}?)\$\$/.exec(src) || /^\$(?![\d\s$])([^$\n]{1,2000}?\S|\S)\$(?!\d)/.exec(src);
      return m ? { type: 'math', raw: m[0], text: m[1] } : undefined;
    },
  };
  // The hook for marked's emphasis pairing (give it as `hooks: DL_MARKED_HOOKS`): before * and _ are paired, every formula span is
  // filled with letters of the same length, so a * or _ inside a formula can neither open nor close an emphasis around it.
  // The tokenizer still reads the real text; only the pairing sees the mask. (Code spans and \$ are already masked by marked.)
  const DL_MATH_SPAN = /\$\$(?=\S)[^$]{1,2000}?\$\$|\$(?![\d\s$])(?:[^$\n]{1,2000}?\S|\S)\$(?!\d)/g;
  const DL_MARKED_HOOKS = { emStrongMask: (s) => s.replace(DL_MATH_SPAN, (m) => 'a'.repeat(m.length)) };
  // The label of a link as a person reads it: the lexer's decoded inline text (escapes already taken out), not the source.
  function dlPlain(tokens, depth = 0) {
    let s = '';
    if (!Array.isArray(tokens) || depth > 20) return s;
    for (const k of tokens) {
      if (!k || typeof k !== 'object') continue;
      if (Array.isArray(k.tokens) && k.tokens.length) s += dlPlain(k.tokens, depth + 1);
      else if (k.type === 'br') s += ' ';
      else if (k.type === 'math') s += `$${k.text || ''}$`;
      else if (k.type === 'text') s += dlDecodeText(String(k.text == null ? k.raw || '' : k.text));
      else if (k.type !== 'checkbox') s += String(k.text == null ? k.raw || '' : k.text);
    }
    return s;
  }

  function dlInline(tokens, depth = 0) {
    const out = [];
    if (!Array.isArray(tokens) || depth > 20) return out;
    for (const k of tokens) {
      if (!k || typeof k !== 'object') continue;
      const sub = () => dlInline(k.tokens, depth + 1);
      switch (k.type) {
        case 'text': case 'escape':
          if (Array.isArray(k.tokens) && k.tokens.length) out.push(...sub());
          else out.push(...dlMathSplit(k.type === 'text' ? dlDecodeText(String(k.text == null ? k.raw || '' : k.text)) : String(k.text == null ? k.raw || '' : k.text)));
          break;
        case 'strong': out.push({ t: 'strong', c: sub() }); break;
        case 'em': out.push({ t: 'em', c: sub() }); break;
        case 'del': out.push({ t: 'del', c: sub() }); break;
        case 'codespan': out.push({ t: 'code', v: dlCleanText(String(k.text || '')) }); break;
        case 'br': out.push({ t: 'br' }); break;
        case 'math': out.push({ t: 'math', tex: dlCleanText(String(k.text == null ? '' : k.text)), display: false }); break;
        case 'checkbox': break; // a loose item carries its box as an inline token; the item's own flag draws the one box
        case 'link': {
          const a = dlSafeAddress(String(k.href || ''));
          if (!a) out.push({ ...dlText(k.raw), raw: true }); // an address that is not allowed: the source, as text
          else if (a.kind === 'object') out.push({ t: 'object', module: a.module, objectKind: a.objectKind, id: a.id, label: dlCleanLine(Array.isArray(k.tokens) && k.tokens.length ? dlPlain(k.tokens) : dlDecodeText(String(k.text || '')), 200), ...dlTitle(k.title) });
          else out.push({ t: 'link', href: a.href, ...dlTitle(k.title), c: sub() });
          break;
        }
        default: out.push({ ...dlText(k.raw != null ? k.raw : k.text), raw: true }); // html, images, footnotes, anything else: its source, as text (raw: a later editor shows it as a source node)
      }
    }
    return out;
  }

  const dlSource = (raw) => ({ t: 'source', v: dlTrimBreaks(dlCleanText(String(raw || ''))) });
  const DL_DISPLAY_MATH = /^\$\$([\s\S]+?)\$\$$/;
  const dlTwoFormulas = (tex) => /[^$]\$\$+[^$]/.test(tex); // "$$a$$ and $$b$$": a $$ pair with words on both sides is two formulas in a paragraph, not one block

  // A task item whose first line still starts with "[ ] " or "[x] " as words (no box token in front of it): take those words out.
  function dlTaskTokens(it) {
    const toks = it.tokens;
    if (!it.task || !Array.isArray(toks) || !toks[0] || !Array.isArray(toks[0].tokens)) return toks;
    const inner = toks[0].tokens;
    if (!inner[0] || inner[0].type !== 'text' || typeof inner[0].text !== 'string' || !/^\[[ xX]\]\s+/.test(inner[0].text) || inner[0].tokens) return toks;
    const first = { ...inner[0], text: inner[0].text.replace(/^\[[ xX]\]\s+/, '') };
    return [{ ...toks[0], tokens: [first, ...inner.slice(1)] }, ...toks.slice(1)];
  }

  function dlBlocks(tokens, ctx) {
    const out = [];
    if (!Array.isArray(tokens)) return out;
    for (const k of tokens) {
      if (!k || typeof k !== 'object') continue;
      switch (k.type) {
        case 'space': case 'checkbox': break; // the task box is drawn from the item's own flag
        case 'heading': out.push({ t: 'heading', depth: Math.min(4, Math.max(1, Number(k.depth) || 1)), level: Math.min(6, Math.max(1, Number(k.depth) || 1)), c: dlInline(k.tokens) }); break;
        case 'paragraph': {
          const m = DL_DISPLAY_MATH.exec(String(k.raw || '').trim());
          if (m && !dlTwoFormulas(m[1])) out.push(m[1].trim().length <= DL.formulaMax ? { t: 'math', tex: dlCleanText(m[1].trim()), display: true } : dlSource(k.raw));
          else out.push({ t: 'paragraph', c: dlInline(k.tokens) });
          break;
        }
        case 'text': out.push({ t: 'paragraph', c: dlInline(k.tokens && k.tokens.length ? k.tokens : [k]) }); break;
        case 'blockquote':
          if (ctx.quote >= 8) out.push(dlSource(k.raw));
          else out.push({ t: 'quote', c: dlBlocks(k.tokens, { ...ctx, quote: ctx.quote + 1 }) });
          break;
        case 'code': {
          // The info string: its first word is the language, the rest is the info (kept for writing back; never drawn).
          const fence = k.codeBlockStyle === 'indented' ? '' : dlCleanLine(String(k.lang || ''), 240);
          const sp = fence.search(/\s/);
          const word = sp < 0 ? fence : fence.slice(0, sp);
          out.push({ t: 'codeblock', v: dlCleanText(String(k.text || '')), lang: word.slice(0, 40).replace(/[^A-Za-z0-9_+#.-]/g, ''), info: sp < 0 ? '' : fence.slice(sp).trim() });
          break;
        }
        case 'hr': out.push({ t: 'rule' }); break;
        case 'list': {
          if (ctx.list >= DL.listDepth || ctx.quote > 8) { out.push(dlSource(k.raw)); break; }
          const items = (k.items || []).map((it) => ({
            task: Boolean(it.task), checked: Boolean(it.task && it.checked), c: dlBlocks(dlTaskTokens(it), { ...ctx, list: ctx.list + 1 }),
          }));
          out.push({ t: 'list', ordered: Boolean(k.ordered), start: k.ordered && Number.isInteger(k.start) && k.start >= 0 && k.start < 1e6 ? k.start : 1, items });
          break;
        }
        case 'table': {
          const head = k.header || [];
          const rows = k.rows || [];
          if (rows.length > DL.gridRows || head.length > DL.gridCols || rows.some((r) => r.length > DL.gridCols)) { out.push(dlSource(k.raw)); break; }
          const align = (k.align || []).map((a) => (a === 'left' || a === 'center' || a === 'right' ? a : null));
          out.push({ t: 'table', align, head: head.map((c) => dlInline(c.tokens)), rows: rows.map((r) => r.map((c) => dlInline(c.tokens))) });
          break;
        }
        default: out.push(dlSource(k.raw != null ? k.raw : k.text)); // raw html and anything unknown: as text
      }
    }
    return out;
  }
  // -> description: an array of blocks. `lex(markdown)` is the parser's lexer; if it throws, the whole text is shown as text.
  function dlDescribe(markdown, lex) {
    const md = dlCleanText(markdown);
    if (md.length > DL.sizeMax) return [dlSource(md.slice(0, DL.sizeMax))];
    try { return dlBlocks(lex(md), { list: 0, quote: 0 }); } catch (err) { return [dlSource(md)]; }
  }

  // The words of a description as one run of plain text (blocks and table cells apart by a space, inline pieces joined as written):
  // what lists and search show.
  function dlDescribedText(desc, depth = 0) {
    let out = '';
    if (!Array.isArray(desc) || depth > 40) return out;
    for (const n of desc) {
      if (!n || typeof n !== 'object') continue;
      if (n.t === 'text' || n.t === 'code') out += n.v;
      else if (n.t === 'object') out += n.label;
      else if (n.t === 'br') out += ' ';
      else if (n.t === 'math') out += `${n.tex} `;
      else if (n.t === 'source' || n.t === 'codeblock') out += `${n.v} `;
      else if (n.t === 'table') for (const cell of [...n.head, ...n.rows.flat()]) out += `${dlDescribedText(cell, depth + 1)} `;
      else if (n.t === 'list') for (const it of n.items) out += `${dlDescribedText(it.c, depth + 1)} `;
      else if (Array.isArray(n.c)) out += n.t === 'paragraph' || n.t === 'heading' || n.t === 'quote' ? `${dlDescribedText(n.c, depth + 1)} ` : dlDescribedText(n.c, depth + 1);
    }
    return out;
  }

  // ---- description -> elements --------------------------------------------------------------------------------------------
  // hooks (all optional): math(el, tex, display) -> true when it drew the formula (the one place that may set HTML, and it is
  // the page's, not ours); object(el, ref) fills the chip of an object link, else the label shows.
  function dlBuild(desc, doc, hooks = {}) {
    const el = (tag, cls) => { const e = doc.createElement(tag); if (cls) e.className = cls; return e; };
    const txt = (v) => doc.createTextNode(v);
    const inline = (nodes, parent) => {
      for (const n of nodes) {
        if (n.t === 'text') parent.appendChild(txt(n.v));
        else if (n.t === 'br') parent.appendChild(el('br'));
        else if (n.t === 'code') { const e = el('code'); e.textContent = n.v; parent.appendChild(e); }
        else if (n.t === 'strong' || n.t === 'em' || n.t === 'del') { const e = el(n.t === 'del' ? 's' : n.t); inline(n.c, e); parent.appendChild(e); }
        else if (n.t === 'link') {
          const e = el('a');
          e.setAttribute('href', n.href);
          e.setAttribute('rel', 'noopener noreferrer');
          e.setAttribute('target', '_blank');
          inline(n.c, e);
          parent.appendChild(e);
        } else if (n.t === 'object') {
          const e = el('span', 'dl-object');
          e.setAttribute('data-module', n.module);
          e.setAttribute('data-kind', n.objectKind);
          e.setAttribute('data-id', n.id);
          e.textContent = n.label || 'Link';
          if (hooks.object) hooks.object(e, { module: n.module, kind: n.objectKind, id: n.id, label: n.label });
          parent.appendChild(e);
        } else if (n.t === 'math') parent.appendChild(formula(n));
      }
    };
    function formula(n) {
      const e = el(n.display ? 'div' : 'span', n.display ? 'dl-math dl-math-block' : 'dl-math');
      let drawn = false;
      if (hooks.math && n.tex.length <= DL.formulaMax) { try { drawn = hooks.math(e, n.tex, n.display) === true; } catch (err) { drawn = false; } }
      if (!drawn) { while (e.firstChild) e.removeChild(e.firstChild); e.textContent = n.display ? `$$${n.tex}$$` : `$${n.tex}$`; }
      return e;
    }
    const blocks = (list, parent) => {
      for (const b of list) {
        if (b.t === 'paragraph') { const e = el('p'); inline(b.c, e); parent.appendChild(e); }
        else if (b.t === 'heading') { const e = el(`h${b.depth}`); inline(b.c, e); parent.appendChild(e); }
        else if (b.t === 'quote') { const e = el('blockquote'); blocks(b.c, e); parent.appendChild(e); }
        else if (b.t === 'rule') parent.appendChild(el('hr'));
        else if (b.t === 'codeblock' || b.t === 'source') {
          const e = el('pre', b.t === 'source' ? 'dl-source' : '');
          const c = el('code');
          c.textContent = b.v;
          e.appendChild(c);
          parent.appendChild(e);
        } else if (b.t === 'math') parent.appendChild(formula(b));
        else if (b.t === 'list') {
          const e = el(b.ordered ? 'ol' : 'ul');
          if (b.ordered && b.start !== 1) e.setAttribute('start', String(b.start));
          for (const it of b.items) {
            const li = el('li', it.task ? 'dl-task' : '');
            if (it.task) {
              const box = el('input');
              box.setAttribute('type', 'checkbox');
              box.setAttribute('disabled', '');
              if (it.checked) box.setAttribute('checked', '');
              li.appendChild(box);
            }
            blocks(it.c, li);
            e.appendChild(li);
          }
          parent.appendChild(e);
        } else if (b.t === 'table') {
          const t = el('table');
          const row = (cells, tag, body) => {
            const tr = el('tr');
            cells.forEach((c, i) => { const cell = el(tag); if (b.align[i]) cell.setAttribute('style', `text-align:${b.align[i]}`); inline(c, cell); tr.appendChild(cell); });
            body.appendChild(tr);
          };
          const th = el('thead');
          row(b.head, 'th', th);
          t.appendChild(th);
          const tb = el('tbody');
          b.rows.forEach((r) => row(r, 'td', tb));
          t.appendChild(tb);
          parent.appendChild(t);
        }
      }
    };
    const root = el('div', 'dl-doc');
    blocks(desc, root);
    return root;
  }
  // The links to objects found in a description (for setLinks): [{ module, kind, id }], each once.
  function dlObjectLinks(desc) {
    const seen = new Map();
    const walk = (nodes) => {
      for (const n of nodes || []) {
        if (!n || typeof n !== 'object') continue;
        if (n.t === 'object') seen.set(`${n.module}:${n.objectKind}:${n.id}`, { module: n.module, kind: n.objectKind, id: n.id });
        walk(n.c); walk(n.items);
        if (n.head) walk(n.head.flat());
        if (n.rows) walk(n.rows.flat(2));
      }
    };
    walk(desc);
    return [...seen.values()];
  }
