#!/usr/bin/env node
/*
 * check-documents-rich.mjs -- the rich editor's mapping (plan-documents-rich-editor.md, "Markdown in and out"), in Node with no DOM:
 *   P  Markdown -> the vendored marked lexer -> the reader's dlDescribe -> a ProseMirror document  (documents-lib-m-parse.js)
 *   S  a ProseMirror document -> Markdown                                                        (documents-lib-n-serialise.js)
 * over the schema in documents-lib-l-schema.js and the vendored bundle documents-lib-0-prosemirror.js.
 *
 * 1. The bundle loads with no page and hands out one object; markdown-it is not in it.
 * 2. The schema refuses values the reader would never make (a script address, a level 9 heading, a broken object address).
 * 3. THE CORPUS. Every case is read, written, read again and written again. A case is
 *      EXACT          the text written equals the text read
 *      CANONICALISED  the text differs, in the editor's form only: the document read back is the same node for node, the second
 *                     writing equals the first (a fixed point), and the reader shows the same (dlDescribe, compared as shown)
 *      LOST           as canonicalised, but words of the text are gone (allowed only for the plan's one accepted loss)
 *      CHANGED        anything else: a change in meaning. Must be 0.
 *    The written text of every case that is not exact is pinned below, so a change in the editor's form is a reviewed change.
 * 4. THE FUZZ. Random documents built in the schema (the spike's generator and seed, then a second one for the nodes the spike
 *    did not have), written as Markdown; then one reading, a writing and a second reading must give the first reading again, and
 *    the second writing the first. 250 + 250 documents here; `--fuzz=4000` runs any number.
 * 5. THE HOSTILE CORPUS. Script, event handlers, frames, script and data addresses, a hostile formula, direction and zero-width
 *    characters, and the bounds (200 rows by 20 cells, lists 4 deep, 150,000 characters, 60,000 nodes): nothing becomes a node
 *    that is not text or a source node, no address outside the allow-list is ever an attribute, and no text is dropped.
 *
 * Usage: node modules/documents/test/check-documents-rich.mjs [--report] [--fuzz=N] [path to the src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const t0 = Date.now();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const report = args.includes('--report');
const fuzzArg = args.find((a) => a.startsWith('--fuzz='));
const FUZZ = fuzzArg ? Math.max(1, Number(fuzzArg.slice(7)) || 0) : 250;
const src = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(root, 'modules/documents/src'));

const files = fs.readdirSync(src).filter((f) => /^documents-lib-[a-z]-.*\.js$/.test(f)).sort();
const code = files.map((f) => fs.readFileSync(path.join(src, f), 'utf8')).join('\n');
const bundleText = fs.readFileSync(path.join(src, 'documents-lib-0-prosemirror.js'), 'utf8');
// The bundle is one plain script that leaves one object, DlPM, exactly as the page's build splices it in. No page is given to it.
const PM = new Function(`${bundleText}\nreturn DlPM;`)();
const NAMES = ['DL', 'DL_RICH', 'dlCleanText', 'dlDescribe', 'dlSafeAddress', 'DL_MARKED_MATH', 'DL_MARKED_HOOKS', 'dlRichHref', 'dlRichSchema', 'dlRichParse', 'dlRichFromDescription', 'dlRichSerialise'];
const L = new Function(`${code}\nreturn { ${NAMES.join(', ')} };`)();
const markedLib = createRequire(import.meta.url)(path.join(src, 'documents-lib-0-marked.js'));
const reader = new markedLib.Marked({ gfm: true, extensions: [L.DL_MARKED_MATH], hooks: L.DL_MARKED_HOOKS });
const lex = (md) => reader.lexer(md);
const P = (md) => L.dlRichParse(PM, md, lex);
const S = (doc, beside) => L.dlRichSerialise(PM, doc, beside);
const schema = L.dlRichSchema(PM);
const N = schema.nodes;
const M = schema.marks;

let passed = 0;
const fails = [];
function test(name, fn) { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }
const say = (...a) => { if (report) console.log(...a); };

// Every node of a document, top down.
function nodesOf(doc) { const out = []; doc.descendants((n) => { out.push(n); return true; }); return out; }
const kinds = (doc) => [...new Set(nodesOf(doc).map((n) => n.type.name))].sort();
const sourcesOf = (doc) => nodesOf(doc).filter((n) => n.type === N.source || n.type === N.source_block).map((n) => (n.type === N.source ? n.attrs.src : n.textContent));

// ---- 1. the bundle ---------------------------------------------------------------------------------------------------------------
test('bundle: one object with the editor pieces, loaded with no page', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.DlPM, 'undefined', 'the bundle must not leave a global of its own');
  for (const k of ['Schema', 'Node', 'Fragment', 'Slice', 'Mark', 'DOMSerializer', 'EditorState', 'Plugin', 'PluginKey', 'TextSelection', 'NodeSelection', 'EditorView', 'Decoration',
    'DecorationSet', 'Transform', 'Step', 'toggleMark', 'setBlockType', 'wrapIn', 'baseKeymap', 'chainCommands', 'keymap', 'history', 'undo', 'redo', 'InputRule', 'inputRules',
    'wrappingInputRule', 'textblockTypeInputRule', 'wrapInList', 'splitListItem', 'liftListItem', 'sinkListItem', 'CellSelection', 'addRowAfter', 'addColumnAfter', 'deleteRow',
    'deleteColumn', 'goToNextCell', 'dropCursor', 'gapCursor', 'MarkdownSerializer', 'MarkdownSerializerState']) assert.ok(PM[k], `DlPM.${k} is missing`);
});
test('bundle: no markdown-it, no reader of its own, nothing that loads', () => {
  for (const k of ['MarkdownParser', 'defaultMarkdownParser', 'defaultMarkdownSerializer']) assert.equal(PM[k], undefined, `DlPM.${k} must not be there`);
  assert.ok(!/markdown-?it|argparse|linkify|punycode/i.test(bundleText), 'a markdown-it word in the bundle');
  assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|sendBeacon)\s*\(|\bimport\s*\(|\beval\s*\(|new Function\b/.test(bundleText), 'a loading or evaluating call in the bundle');
  assert.equal((bundleText.match(/\binnerHTML\b/g) || []).length, 4, 'the bundle has exactly the four clipboard innerHTML uses that THIRD-PARTY.md names');
  assert.ok(!/\b(outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|srcdoc)\b/.test(bundleText), 'another HTML sink in the bundle');
});
test('bundle: every innerHTML line is a named exemption in THIRD-PARTY.md, for this exact file', () => {
  const md = fs.readFileSync(path.join(src, '..', 'THIRD-PARTY.md'), 'utf8');
  const block = /```innerhtml-exemptions\n([\s\S]*?)\n```/.exec(md);
  assert.ok(block, 'THIRD-PARTY.md has no innerhtml-exemptions block');
  const named = JSON.parse(block[1]).filter((x) => x.file === 'src/documents-lib-0-prosemirror.js');
  const lines = bundleText.split('\n').filter((l) => /innerHTML/.test(l));
  assert.deepEqual(lines.slice().sort(), named.map((x) => x.line).sort());
  const hash = createHash('sha256').update(fs.readFileSync(path.join(src, 'documents-lib-0-prosemirror.js'))).digest('hex');
  for (const x of named) { assert.equal(x.sha256, hash); assert.ok(String(x.reason || '').length > 40, 'an exemption needs its reason'); }
  assert.ok(!/[^\x00-\x7f]/.test(bundleText), 'the bundle holds a character outside ASCII');
});
test('the mapping files have no page, host or HTML words', () => {
  for (const f of files.filter((x) => /-lib-[l-n]-/.test(x))) {
    const text = fs.readFileSync(path.join(src, f), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/\b(host|document|window|navigator)\.|\b(innerHTML|insertAdjacentHTML|outerHTML|parseDOM|DOMParser)\b/.test(text), `${f} has a forbidden word`);
  }
});

// ---- 2. the schema ---------------------------------------------------------------------------------------------------------------
test('schema: the nodes and marks the plan names, and no others', () => {
  assert.deepEqual(Object.keys(N).sort(), ['blockquote', 'bullet_list', 'code_block', 'doc', 'formula', 'formula_block', 'grid', 'grid_cell', 'grid_head', 'grid_row', 'hard_break',
    'heading', 'horizontal_rule', 'list_item', 'object', 'ordered_list', 'paragraph', 'source', 'source_block', 'text']);
  assert.deepEqual(Object.keys(M).sort(), ['code', 'em', 'link', 'strike', 'strong']);
  assert.equal(L.dlRichSchema(PM), schema, 'the schema is made once');
});
test('schema: a value the reader would never make is refused', () => {
  const p = (content) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });
  const bad = (json, why) => assert.throws(() => PM.Node.fromJSON(schema, json).check(), undefined, why);
  const good = (json) => PM.Node.fromJSON(schema, json).check();
  good(p([{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'https://example.com/a', title: 'T' } }] }]));
  for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', '//example.com/x', '/relative', 'https://exa mple.com', ' https://example.com',
    'https://example.com/"onmouseover="x', 'object:maps:place:p1', 'file:///etc/passwd', '&#106;avascript:alert(1)', 'java\tscript:alert(1)', '', 5, null, { a: 1 }]) {
    bad(p([{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href } }] }]), `link ${JSON.stringify(href)}`);
  }
  good(p([{ type: 'object', attrs: { module: 'maps', kind: 'place', id: 'p-1', label: 'A place' } }]));
  for (const attrs of [{ module: 'Maps', kind: 'place', id: 'p1' }, { module: 'maps', kind: 'pl ace', id: 'p1' }, { module: 'maps', kind: 'place', id: 'p 1' }, { module: 'maps', kind: 'place', id: 'x'.repeat(65) },
    { module: 'maps', kind: 'place', id: 'p1', label: 'x'.repeat(201) }, { module: 'maps', kind: 'place', id: 'p1', label: 'a\nb' }, { module: 'maps', kind: 'place', id: '<script>' }, { module: 'maps:x', kind: 'place', id: 'p1' }]) {
    bad(p([{ type: 'object', attrs }]), `object ${JSON.stringify(attrs).slice(0, 80)}`);
  }
  good({ type: 'doc', content: [{ type: 'heading', attrs: { level: 6 }, content: [{ type: 'text', text: 'x' }] }] });
  for (const level of [0, 7, 9, 1.5, '2', null]) bad({ type: 'doc', content: [{ type: 'heading', attrs: { level } }] }, `level ${level}`);
  good(p([{ type: 'formula', attrs: { tex: 'x^2' } }]));
  for (const tex of ['', ' x', 'x\n\ny', '$x', 'a$b', 'a\nb', 'x'.repeat(L.DL.formulaMax + 1), 5]) bad(p([{ type: 'formula', attrs: { tex } }]), `formula ${String(tex).slice(0, 20)}`);
  bad({ type: 'doc', content: [{ type: 'formula_block', attrs: { tex: 'x'.repeat(L.DL.formulaMax + 1) } }] }, 'a formula past the bound');
  for (const src0 of ['', 'a\nb', 5]) bad(p([{ type: 'source', attrs: { src: src0 } }]), `source ${src0}`);
  bad({ type: 'doc', content: [{ type: 'code_block', attrs: { lang: 'js"><script>' } }] }, 'code language');
  bad({ type: 'doc', content: [{ type: 'ordered_list', attrs: { order: -1 }, content: [{ type: 'list_item', content: [{ type: 'paragraph' }] }] }] }, 'list start');
  bad({ type: 'doc', content: [{ type: 'bullet_list', content: [{ type: 'list_item', attrs: { checked: 'yes' }, content: [{ type: 'paragraph' }] }] }] }, 'checklist state');
  bad({ type: 'doc', content: [{ type: 'grid', content: [{ type: 'grid_row', content: [{ type: 'grid_head', attrs: { align: 'left;background:url(x)' } }] }] }] }, 'alignment');
  bad(p([{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'https://example.com', title: 'x'.repeat(201) } }] }]), 'link title');
  assert.throws(() => PM.Node.fromJSON(schema, p([{ type: 'html', attrs: { html: '<b>' } }])), undefined, 'an unknown node');
  assert.throws(() => PM.Node.fromJSON(schema, p([{ type: 'text', text: 'x', marks: [{ type: 'style', attrs: { css: 'x' } }] }])), undefined, 'an unknown mark');
});
test('schema: an address is stored in one form, and reading it again changes nothing', () => {
  assert.equal(L.dlRichHref('HTTPS://Example.com/a b'), 'https://Example.com/ab');
  assert.equal(L.dlRichHref('https://example.com/?a=1&amp;b=2'), 'https://example.com/?a=1&amp;b=2');
  for (const raw of ['https://example.com/&#38;#38;#35;x', 'https://example.com/&#x26;#x26;#x23;', 'mailto:a@example.com', 'object:maps:place:p1']) {
    const once = L.dlRichHref(raw);
    assert.ok(once === null || L.dlRichHref(once) === once, raw);
  }
  for (const raw of ['javascript:alert(1)', 'java&#115;cript:alert(1)', '&#38;#106;avascript:alert(1)', 'data:x', '', null, undefined, 7]) assert.equal(L.dlRichHref(raw), null, String(raw));
});
test('schema: every node draws as elements and text only (toDOM specs hold no HTML string)', () => {
  const doc = P('# H\n\nA **b** [l](https://example.com) [c](object:maps:place:p1) $x$ <b>raw</b>\n\n- [x] t\n\n| a |\n| :-: |\n| b |\n\n$$y$$\n\n<div>z</div>\n\n```js\nc\n```\n\n---\n');
  const walk = (spec) => { if (typeof spec === 'string' || spec === 0) return; assert.ok(Array.isArray(spec) && /^[a-z0-9]+$/.test(spec[0]), `not an element spec: ${JSON.stringify(spec)}`);
    spec.slice(1).forEach((x, i) => { if (i === 0 && x && typeof x === 'object' && !Array.isArray(x)) { for (const [k, v] of Object.entries(x)) assert.ok(/^(class|href|rel|target|style|start|data-[a-z]+)$/.test(k) && typeof v === 'string', `attribute ${k}`); } else walk(x); }); };
  for (const n of nodesOf(doc)) { if (!n.isText) walk(n.type.spec.toDOM(n)); for (const m of n.marks) walk(m.type.spec.toDOM(m)); }
});

// ---- 3. the corpus ---------------------------------------------------------------------------------------------------------------
// What a reader is shown, in a form that can be compared: text runs joined (raw text is text), a line break in a paragraph as a space.
function shown(md) {
  const norm = (list) => {
    const out = [];
    for (const n of list || []) {
      if (n.t === 'text') {
        const v = n.v.replace(/\s*\n\s*/g, ' ');
        const last = out[out.length - 1];
        if (last && last.t === 'text') last.v += v; else if (v) out.push({ t: 'text', v });
      } else if (n.t === 'math') out.push({ ...n, tex: n.tex.replace(/\s*\n\s*/g, n.display ? '\n' : ' ').trim() });
      else if (n.c) out.push({ ...n, c: norm(n.c) });
      else if (n.items) out.push({ ...n, items: n.items.map((it) => ({ ...it, c: norm(it.c) })) });
      else if (n.head) out.push({ ...n, head: n.head.map(norm), rows: n.rows.map((r) => r.map(norm)) });
      else if (n.t === 'code') out.push({ ...n, v: n.v.replace(/\n/g, ' ') });
      else if (n.t === 'codeblock') out.push({ ...n, v: n.v.replace(/\n+$/, '') }); // a code block's last empty lines are not seen
      else out.push(n);
    }
    return out;
  };
  return JSON.stringify(norm(L.dlDescribe(md, lex)));
}
// Words of the text that the editor's document does not hold anywhere (its words, addresses, titles, labels, TeX and source).
// Entity names and a reference link's own label are not words of the text.
function lostWords(md, doc) {
  const words = (s) => (s.toLowerCase().match(/[a-z]{2,}/g) || []);
  const held = [];
  doc.descendants((n) => { held.push(n.isText ? n.text : n.type.name); for (const v of Object.values(n.attrs)) held.push(String(v)); for (const m of n.marks) for (const v of Object.values(m.attrs)) held.push(String(v)); return true; });
  const have = new Map();
  for (const w of words(held.join(' '))) have.set(w, (have.get(w) || 0) + 1);
  const lost = [];
  for (const w of words(md.replace(/&#?[A-Za-z0-9]{1,32};/g, ' ').replace(/\]\[[^\]]*\]/g, ']'))) { if (have.get(w)) have.set(w, have.get(w) - 1); else lost.push(w); }
  return lost;
}

// [name, the text, the text written back (when it is not the same), 'lost' when words may go]
const CASES = [
  ["heading 1-4", "# One\n\n## Two\n\n### Three\n\n#### Four\n"],
  ["heading 5 and 6", "##### Five\n\n###### Six\n"],
  ["setext heading", "Title\n=====\n\nSub\n---\n", "# Title\n\n## Sub\n"],
  ["bold, italic, code (asterisks)", "A **bold** and *italic* and `code` and ***both*** word.\n"],
  ["bold, italic (underscores)", "A __bold__ and _italic_ word.\n", "A **bold** and *italic* word.\n"],
  ["strikethrough", "A ~~struck~~ word.\n"],
  ["code with backticks inside", "Use `` a`b `` here.\n"],
  ["bullet list, 4 levels (- marks, 2 spaces)", "- one\n  - two\n    - three\n      - four\n- back\n"],
  ["bullet list with * marks and 4-space indent", "* one\n    * two\n* three\n", "- one\n  - two\n- three\n"],
  ["bullet list 5 levels (past the bound)", "- 1\n  - 2\n    - 3\n      - 4\n        - 5\n", "- 1\n  - 2\n    - 3\n      - 4\n\n        - 5\n"],
  ["numbered list", "1. first\n2. second\n3. third\n"],
  ["numbered list starting at 7, all \"1.\"", "7. seven\n1. eight\n1. nine\n", "7. seven\n8. eight\n9. nine\n"],
  ["numbered list with \")\"", "1) first\n2) second\n", "1. first\n2. second\n"],
  ["numbered inside bullets", "- a\n  1. x\n  2. y\n- b\n"],
  ["loose list (blank lines between rows)", "- one\n\n- two\n\n- three\n", "- one\n- two\n- three\n"],
  ["list row with two paragraphs", "- one\n\n  more\n- two\n"],
  ["checklist", "- [ ] open\n- [x] done\n  - [ ] nested open\n"],
  ["checklist with capital X", "- [X] done\n", "- [x] done\n"],
  ["quote", "> quoted line\n>\n> second paragraph\n"],
  ["quote in quote with a list", "> outer\n>\n> > inner\n>\n> - row\n"],
  ["lazy quote", "> first\nsecond\n", "> first second\n"],
  ["link", "See [the site](https://example.com/a?b=1&c=2) and [mail](mailto:ana@example.com).\n"],
  ["link with title", "See [the site](https://example.com \"A title\").\n"],
  ["link with brackets in the address", "[wiki](https://en.wikipedia.org/wiki/Foo_(bar))\n", "[wiki](https://en.wikipedia.org/wiki/Foo_\\(bar\\))\n"],
  ["bare address and <address>", "Go to https://example.com/x and <https://example.org/y>.\n", "Go to <https://example.com/x> and <https://example.org/y>.\n"],
  ["reference link", "See [the site][s].\n\n[s]: https://example.com/\n", "See [the site](https://example.com/).\n\n[s]: https://example.com/\n"],
  ["object link", "Open [the map](object:maps:place:abc123) and [a doc](object:documents:document:d-1).\n"],
  ["table with alignment", "| Left | Centre | Right | None |\n| :-- | :-: | --: | --- |\n| a | b | c | d |\n| **bold** | `code` | [x](https://example.com) | $x^2$ |\n"],
  ["table, other spacing and no outer pipes", "Left | Right\n:--- | ----:\na    | b\n", "| Left | Right |\n| :-- | --: |\n| a | b |\n"],
  ["table cell with an escaped pipe", "| a | b |\n| --- | --- |\n| x \\| y | `p\\|q` |\n"],
  ["inline maths", "The area is $x^2$ and $\\frac{a}{b}$, not $5 and $6.\n", "The area is $x^2$ and $\\frac{a}{b}$, not \\$5 and \\$6.\n"],
  ["inline maths with \\{, \\\\, _ and *", "Sets $\\{a_1, a_2\\}$ and $a*b*c$ and $x \\\\ y$.\n"],
  ["inline maths with a thin space (\\,) and a percent", "Area $\\int x\\,dx$ and $50\\%$ of it.\n", "Area $\\int x\\,dx$ and \\$50%\\$ of it.\n"],
  ["two lists in a row", "- a\n- b\n\n* c\n* d\n\n1. x\n\n1) y\n", "- a\n- b\n\n\n* c\n* d\n\n1. x\n\n\n1) y\n"],
  ["code block inside a list row", "- row\n\n  ```js\n  let a;\n  ```\n- next\n"],
  ["table inside a quote", "> | a | b |\n> | --- | --- |\n> | 1 | 2 |\n"],
  ["heading with closing marks and a hard break", "## Title ##\n\n# a \\#\n", "## Title\n\n# a \\#\n"],
  ["bold next to letters and with spaces inside", "in**side**word and ** not bold ** and *a*b.\n", "in**side**word and \\*\\* not bold \\*\\* and *a*b.\n"],
  ["link holding bold and code", "[**bold** and `code`](https://example.com/)\n"],
  ["empty list row and empty quote", "- \n- b\n\n>\n", "- \n- b\n\n> \n"],
  ["nbsp, tabs and emoji", "a\u00a0b\tc 😀 é\n"],
  ["text ending in a backslash", "path C:\\dir\\\n", "path C:\\\\dir\\\\\n"],
  ["block maths", "$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n", "$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$\n"],
  ["block maths on one line", "$$E = mc^2$$\n"],
  ["fenced code with a language", "```js\nconst a = 1 < 2 && \"x\";\n\n// *not bold*\n```\n"],
  ["fenced code with ~~~ and backticks inside", "~~~\n```\ninner\n```\n~~~\n", "````\n```\ninner\n```\n````\n"],
  ["indented code", "    indented code\n    second line\n", "```\nindented code\nsecond line\n```\n"],
  ["rules", "above\n\n---\n\n***\n\n___\n\nbelow\n", "above\n\n---\n\n---\n\n---\n\nbelow\n"],
  ["hard breaks (backslash)", "line one\\\nline two\n"],
  ["hard breaks (two spaces)", "line one  \nline two\n", "line one\\\nline two\n"],
  ["soft line break in a paragraph", "line one\nline two\n", "line one line two\n"],
  ["hostile raw HTML block", "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<div onclick=\"x()\">raw *block*</div>\n"],
  ["hostile raw HTML inline", "Text <b onmouseover=x>bold</b> and <svg onload=alert(1)> and <!-- c --> end.\n"],
  ["javascript: and data: links", "[x](javascript:alert(1)) [y](JaVa\tScript:alert(1)) [z](data:text/html,<script>alert(1)</script>) [w](&#106;avascript:alert(1))\n", "[x](javascript:alert(1)) \\[y\\](JaVa\tScript:alert(1)) [z](data:text/html,<script>alert(1)</script>) [w](&#106;avascript:alert(1))\n"],
  ["picture", "![alt text](https://example.com/p.png)\n"],
  ["escaped characters", "Not \\*bold\\*, not \\_italic\\_, not \\`code\\`, a \\\\ backslash, \\# no heading, 1\\. no list, \\[no\\](link), \\<b\\>, \\$5 and \\$6, \\| pipe.\n", "Not \\*bold\\*, not \\_italic\\_, not \\`code\\`, a \\\\ backslash, # no heading, 1. no list, \\[no\\](link), \\<b>, \\$5 and \\$6, | pipe.\n"],
  ["characters that need no escape", "snake_case_name, 2 * 3 = 6, a < b > c, AT&T, 100%, #tag, a|b, 5$.\n", "snake_case_name, 2 \\* 3 = 6, a < b > c, AT&T, 100%, #tag, a|b, 5$.\n"],
  ["entities", "Tom &amp; Jerry &lt;3 &copy; &#35; and a literal \\&amp;.\n", "Tom & Jerry <3 © # and a literal \\&amp;.\n"],
  ["line starts that look like blocks", "\\- not a list\n\n\\> not a quote\n\n\\# not a heading\n\n1\\. not a list\n\n\\+ not a list\n"],
  ["trailing newlines (none)", "no newline at the end", "no newline at the end\n"],
  ["trailing newlines (three)", "three newlines at the end\n\n\n", "three newlines at the end\n"],
  ["leading blank lines", "\n\nstarts after blank lines\n", "starts after blank lines\n"],
  ["footnote", "A claim.[^1]\n\n[^1]: The note.\n"],
  ["empty document", ""],
  ["windows line ends", "one\r\n\r\ntwo\r\n", "one\n\ntwo\n"],
  ["entity: &amp;", "Salt &amp; pepper\n", "Salt & pepper\n"],
  ["entity: &amp;amp; (a literal &amp;)", "Write &amp;amp; for an ampersand.\n", "Write \\&amp; for an ampersand.\n"],
  ["entity: &lt;b&gt;", "The tag &lt;b&gt; is bold.\n", "The tag \\<b> is bold.\n"],
  ["entity: &#35; at the start of a line", "&#35; not a heading\n", "\\# not a heading\n"],
  ["entity: AT&T", "AT&T and R&D; Q&A.\n"],
  ["entity: 2 &lt; 3", "2 &lt; 3 and 3 &gt; 2\n", "2 < 3 and 3 > 2\n"],
  ["entity: in a heading, a list row, a cell and a link", "# A &amp; B\n\n- C &amp; D\n\n| E &amp; F |\n| --- |\n| G &lt;i&gt; |\n\n[H &amp; I](https://example.com/?a=1&amp;b=2)\n", "# A & B\n\n- C & D\n\n| E & F |\n| --- |\n| G \\<i> |\n\n[H & I](https://example.com/?a=1&amp;b=2)\n"],
  ["entity: an unknown name and a lone &", "A &nosuch; name, a lone & and a &copy; sign.\n", "A \\&nosuch; name, a lone & and a © sign.\n"],
  ["code fence with an info string", "```js title=\"x\" {1,3}\nlet a;\n```\n"],
  ["code fence with ~~~ and a backtick in its info string", "~~~js a`b\nlet a;\n~~~\n"],
  ["link titles with a quote, a backslash and an entity", "[a](https://example.com \"say \\\"hi\\\"\") [b](https://example.com 'it\\\\s') [c](https://example.com \"R&amp;D &amp;amp; more\")\n", "[a](https://example.com \"say \\\"hi\\\"\") [b](https://example.com \"it\\\\s\") [c](https://example.com \"R&D &amp;amp; more\")\n"],
  ["object link with escapes in its label and a title", "Open [a \\[b\\] \\* c \\| d \\& e](object:maps:place:p-1 \"The \\\"title\\\"\") and [](object:todo:task:t.1).\n", "Open [a \\[b\\] \\* c | d \\& e](object:maps:place:p-1 \"The \\\"title\\\"\") and [](object:todo:task:t.1).\n"],
  ["object link in a grid cell, with a pipe in its label", "| a |\n| --- |\n| [x \\| y](object:maps:place:p1) |\n"],
  ["object link in bold", "See **[the map](object:maps:place:abc123)** now.\n"],
  ["heading 5 and 6 with formatting", "##### Five *em* `code`\n\n###### Six [l](https://example.com)\n"],
  ["block formula with \\, \\{ and \\%", "$$\n\\{a\\,b\\} = 50\\%\n$$\n", "$$\\{a\\,b\\} = 50\\%$$\n"],
  ["block formula on two lines", "$$\na\n= b\n$$\n", "$$a\n= b$$\n"],
  ["inline formula with \\, \\{ \\% in bold and in a grid cell", "**$\\{x\\,y\\}$** and $p\\%$\n\n| $a\\|b$ |\n| --- |\n| $\\frac{1}{2}$ |\n"],
  ["a formula, then a digit", "$a$&#53; and $$b$$7\n", "$$a$$5 and $$b$$7\n"],
  ["a formula that starts with a digit", "$5x$ alone\n\n$2^n$\n\n- $$3y$$ and $$4z$$\n", "$5x$ alone\n\n$2^n$\n\n- $3y$ and $4z$\n"],
  ["an empty block formula", "$$ $$\n"],
  ["a $ in prose", "It costs $5, or 5$, or US$ 5 and $ 6.\n\nBoth $a and b$ here.\n", "It costs \\$5, or 5$, or US$ 5 and \\$ 6.\n\nBoth $a and b$ here.\n"],
  ["source: an HTML comment block and an inline one", "<!-- a note\nover two lines -->\n\nText <!-- inline --> here.\n"],
  ["source: raw HTML inside bold", "A **<b>bold</b>** word and <span class=\"x\">a span</span>.\n"],
  ["source: a picture among words", "Before ![alt *text*](https://example.com/p.png \"T\") after.\n"],
  ["source: a refused address among words", "See [the file](file:///etc/passwd) and [rel](/a/b) and [ok](https://example.com).\n"],
  ["source: link-definition lines", "[a]: https://example.com/a\n[b]: <https://example.com/b> \"B\"\n\nUse [a] and [the b][b].\n", "[a]: https://example.com/a\n\n[b]: <https://example.com/b> \"B\"\n\nUse [a](https://example.com/a) and [the b](https://example.com/b \"B\").\n"],
  ["source: a footnote mark at the start of a line and a note with formatting", "[^note]: The **note** text.\n\nSee[^note] and [^2].\n"],
  ["source: a footnote mark before brackets", "A[^1]\\(x) and [^1]\\: y\n"],
  ["source: a quote 9 deep (past the bound)", "> > > > > > > > > deep\n"],
  ["source: a list 10 deep (past the bound)", "- 0\n  - 1\n    - 2\n      - 3\n        - 4\n          - 5\n            - 6\n              - 7\n                - 8\n                  - 9\n", "- 0\n  - 1\n    - 2\n      - 3\n\n        - 4\n          - 5\n            - 6\n              - 7\n                - 8\n                  - 9\n"],
  ["source: a grid with 21 columns (past the bound)", "| a | a | a | a | a | a | a | a | a | a | a | a | a | a | a | a | a | a | a | a | a |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| b | b | b | b | b | b | b | b | b | b | b | b | b | b | b | b | b | b | b | b | b |\n"],
  ["source: an ftp address", "Get ftp://example.com/file now.\n"],
  ["a | in a grid cell, in code and in words", "| a \\| b | `c \\| d` |\n| --- | --- |\n| e | f |\n"],
  ["a grid row with a cell beyond the header", "| a | b |\n| --- | --- |\n| 1 | 2 | extra |\n", "| a | b |\n| --- | --- |\n| 1 | 2 |\n", "lost"],
  ["a grid row with too few cells", "| a | b |\n| --- | --- |\n| 1 |\n", "| a | b |\n| --- | --- |\n| 1 |  |\n"],
  ["backticks in a code block and a longer fence", "````md\n```js\nlet a;\n```\n````\n"],
  ["code with a space at both ends, and only spaces", "A ``  two  `` and `` ` `` and `  ` end.\n", "A `  two  ` and `` ` `` and `  ` end.\n"],
  ["loose and tight lists together", "- tight\n- tight\n\n1. loose\n\n2. loose\n", "- tight\n- tight\n\n1. loose\n2. loose\n"],
  ["a checklist row with blocks under it", "- [ ] task\n\n  A paragraph under it.\n\n  ```\n  code\n  ```\n  - [x] sub\n- [x] done\n"],
  ["a loose checklist", "- [ ] one\n\n- [x] two\n", "- [ ] one\n- [x] two\n"],
  ["emphasis inside a word", "un*frigging*believable and snake_case_word and 2*3*4.\n"],
  ["an empty paragraph between two (blank lines only)", "one\n\n\n\ntwo\n", "one\n\ntwo\n"],
  ["an address written as plain words", "Not links: http\\://example.com, www\\.example.com and ana\\@example.com.\n"],
  ["www and mail addresses as links", "Visit www.example.com or write ana@example.com.\n", "Visit [www.example.com](http://www.example.com) or write [ana@example.com](mailto:ana@example.com).\n"],
  ["a line of | and - after a hard break", "a | b\\\n\\:-: | :-:\n"],
  ["a hard break before a line that looks like a list", "first\\\n\\- second\\\n1\\. third\n"],
  ["a numbered list that starts at 0 and one inside a row", "0. zero\n1. one\n\n- a\n\n  5. five\n"],
  ["a rule right under a paragraph", "words\n\n---\n"],
  ["a heading directly under a paragraph, and a list under a heading", "words\n# Head\n- row\n", "words\n\n# Head\n\n- row\n"],
  ["strikethrough with one tilde and bold italic together", "A ~one~ and ***both*** and **bold *and italic* inside**.\n", "A ~~one~~ and ***both*** and **bold *and italic* inside**.\n"],
  ["a code block in a quote in a list row", "- > ```\n  > code\n  > ```\n"],
  ["direction and zero-width characters are taken out", "a\u202eb\u200bc\u2066d\ufeff\n", "abcd\n"],
  ['table past the bounds (201 rows)', `| a |\n| --- |\n${'| r |\n'.repeat(201)}`],
];

const results = [];
for (const [name, md1, want, flag] of CASES) {
  let row;
  try {
    const doc1 = P(md1);
    doc1.check();
    const md2 = S(doc1);
    const doc2 = P(md2);
    const md3 = S(doc2);
    const sameDoc = doc2.eq(doc1);
    const stable = md3 === md2;
    const sameShown = shown(md1) === shown(md2);
    const lost = lostWords(md1, doc1);
    const status = md2 === md1 ? 'EXACT' : !(sameDoc && stable && sameShown) ? 'CHANGED' : lost.length ? 'LOST' : 'CANONICALISED';
    row = { name, status, sameDoc, stable, sameShown, lost, md1, md2, want: want === undefined ? md1 : want, flag };
  } catch (err) { row = { name, status: 'ERROR', err: String(err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err), md1, want }; }
  results.push(row);
}
const by = (st) => results.filter((r) => r.status === st);
test('corpus: no case changes in meaning, and none fails', () => {
  const bad = [...by('CHANGED'), ...by('ERROR')];
  assert.equal(bad.length, 0, bad.map((r) => `\n    ${r.name}: ${r.err || `same document ${r.sameDoc}, fixed point ${r.stable}, same for a reader ${r.sameShown}\n      in : ${JSON.stringify(r.md1)}\n      out: ${JSON.stringify(r.md2)}`}`).join(''));
});
test('corpus: the only loss is the plan\'s accepted one (grid cells beyond the header\'s columns)', () => {
  assert.deepEqual(by('LOST').map((r) => r.name), CASES.filter((c) => c[3] === 'lost').map((c) => c[0]));
});
test('corpus: every case writes exactly the pinned text', () => {
  const off = results.filter((r) => !r.err && r.md2 !== r.want);
  assert.equal(off.length, 0, off.map((r) => `\n    ${r.name}\n      wrote : ${JSON.stringify(r.md2)}\n      pinned: ${JSON.stringify(r.want)}`).join(''));
});
test('corpus: the whole corpus as one document is a fixed point and reads the same', () => {
  const whole = CASES.map((c) => c[1]).filter((s) => s.length < 2000 && !/\[s\]:|^\[\^/m.test(s)).join('\n\n');
  const d1 = P(whole); const m2 = S(d1); const d2 = P(m2);
  assert.ok(d2.eq(d1), 'the document read back differs');
  assert.equal(S(d2), m2);
  assert.equal(shown(m2), shown(whole));
});
test('corpus: a source node writes its Markdown back word for word', () => {
  for (const [name, md1] of CASES) {
    if (md1.length > 20000) continue;
    const doc = P(md1);
    const out = S(doc);
    for (const s of sourcesOf(doc)) for (const line of s.split('\n')) assert.ok(out.includes(line), `${name}: the source line ${JSON.stringify(line)} is not in ${JSON.stringify(out)}`);
  }
});

// A mark that Markdown would not read as written (bold that ends in punctuation against a letter) is written with &#8203; beside it.
test('marks: the gap entity makes a mark readable, reads as nothing, and ordinary text never gets one', () => {
  const para = (...kids) => N.doc.create(null, [N.paragraph.create(null, kids)]);
  const t = (text, ...marks) => schema.text(text, marks.map((m) => M[m].create()));
  const made = [
    [para(t('a.', 'strong'), t('b')), '**a.**&#8203;b\n'],
    [para(t('x'), t('.y', 'em')), 'x&#8203;*.y*\n'],
    [para(t('a'), t('(b)', 'strike'), t('c')), 'a&#8203;~~(b)~~&#8203;c\n'],
    [para(t('bold', 'strong'), t('italic', 'em')), '**bold**&#8203;*italic*\n'],
    [para(t('😀'), t('.a', 'strong')), '😀&#8203;**.a**\n'],
    [para(t('in'), t('side', 'strong'), t('word')), 'in**side**word\n'],
    [para(t('A '), t('bold.', 'strong'), t(' Next '), t('"quoted"', 'em'), t(', and '), t('both', 'strong', 'em'), t('!')), 'A **bold.** Next *"quoted"*, and ***both***!\n'],
  ];
  for (const [doc, want] of made) {
    assert.equal(S(doc), want);
    assert.ok(P(want).eq(doc), `${JSON.stringify(want)} reads back as ${P(want).toString()}`);
  }
  assert.ok(P('a&#8203;b').eq(para(t('ab'))), 'the gap is not read as nothing');
  assert.equal(shown('**a.**&#8203;b'), JSON.stringify([{ t: 'paragraph', c: [{ t: 'strong', c: [{ t: 'text', v: 'a.' }] }, { t: 'text', v: 'b' }] }]), 'the reader shows the gap');
  for (const r of results) if (!r.err && !r.md1.includes('&#8203;')) assert.ok(!r.md2.includes('&#8203;'), `${r.name}: a gap was written into ordinary text`);
});

// ---- 4. the fuzz -----------------------------------------------------------------------------------------------------------------
// Random documents built straight in the schema (what a person could make in the editor). `extended` false is the spike's
// generator with its seed (rich-spike/work/fuzz.mjs; the chip is a node here, not a link); true adds what the spike did not
// have: source nodes, heading levels 5 and 6, link and chip titles, and a code block's info.
// <fuzz-generator>
function fuzzDocs(count, extended) {
  let seed = extended ? 20261111 : 12345;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; // mulberry32
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const WORDS = ['alpha', 'beta', 'x', '2', 'snake_case', 'a_b', 'AT&T', '&amp;', '&#35;', '<b>', '</b>', '<!--', '*', '**', '_', '__', '`', '``', '~', '~~', '[', ']', '(', ')',
    '[x]', '[ ]', '![', '#', '##', '-', '+', '>', '1.', '1)', '=', '===', '---', '|', '$', '$5', '\\', '\\*', ':', '!', '"', "'", '{', '}', '%', '^', '.', ',', '```', '~~~', '<', '&', ':-:', 'é', '😀',
    'http://ex.am/p', 'www.ex.am', 'a@b.co'].concat(extended ? ['[^1]', '[^1]:', '&copy;', '&lt;', '5', '$$', 'ftp://ex.am', '\\&', '<a@b.co>', '<http://ex.am>', '&nosuch;'] : []);
  const words = (n) => { const out = []; for (let i = 0; i < n; i += 1) out.push(pick(WORDS)); return out.join(rnd() < 0.8 ? ' ' : ''); };
  const CHIP = 'chip';
  const link = () => M.link.create({ href: 'https://example.com/a_(b)', title: extended ? pick(['', '', 'A "t" & b\\c', '&amp; <i>']) : '' });
  const MARKS = [() => [], () => [], () => [], () => [M.strong.create()], () => [M.em.create()], () => [M.strike.create()], () => [M.code.create()], () => [M.strong.create(), M.em.create()], () => [link()], () => CHIP];
  function inline(allowBreak) {
    const out = [];
    const n = 1 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i += 1) {
      const r = rnd();
      if (r < 0.08) out.push(N.formula.create({ tex: pick(['x^2', '\\frac{a}{b}', 'a\\,b', '\\{1\\}', 'a|b', 'a_1*b_2*c'].concat(extended ? ['5x', '50\\%', '2'] : [])) }));
      else if (r < 0.14 && allowBreak && out.length) out.push(N.hard_break.create());
      else if (extended && r < 0.22 && !(out.length && out[out.length - 1].type === N.source)) out.push(N.source.create({ src: pick(['<b>', '</b>', '<!-- c -->', '![alt](https://example.com/p.png)', '[x](javascript:alert(1))', '[^1]', '<br>', '<span title="a|b">', '<img src=x onerror=alert(1)>']) }));
      else {
        let t = words(1 + Math.floor(rnd() * 4)).trim();
        const marks = pick(MARKS)();
        if (marks === CHIP) {
          t = t.replace(/\s+/g, ' ').slice(0, 200).trim();
          if (t) out.push(N.object.create({ module: 'maps', kind: 'place', id: 'p1', label: t, title: extended ? pick(['', '', 'A "t"']) : '' }));
        } else if (t) out.push(schema.text(t, schema.text('x', marks).marks));
      }
    }
    while (out.length && out[out.length - 1].type === N.hard_break) out.pop();
    return out;
  }
  function tidy(nodes) { const frag = N.paragraph.create(null, nodes).content; const out = []; frag.forEach((n) => out.push(n)); return out; } // text beside text is one text
  function block(depth) {
    const r = rnd();
    if (r < 0.4 || depth > 2) return N.paragraph.create(null, tidy(inline(true)));
    if (r < 0.5) return N.heading.create({ level: 1 + Math.floor(rnd() * (extended ? 6 : 4)) }, tidy(inline(false)));
    if (r < 0.6) return N.blockquote.create(null, [block(depth + 1), ...(rnd() < 0.4 ? [block(depth + 1)] : [])]);
    if (r < 0.75) {
      const rows = [];
      const k = 1 + Math.floor(rnd() * 3);
      const task = rnd() < 0.3;
      for (let i = 0; i < k; i += 1) rows.push(N.list_item.create({ checked: task ? rnd() < 0.5 : null }, [N.paragraph.create(null, tidy(inline(true))), ...(rnd() < 0.3 ? [block(depth + 1)] : [])]));
      return rnd() < 0.5 ? N.bullet_list.create(null, rows) : N.ordered_list.create({ order: pick([1, 1, 3]) }, rows);
    }
    if (r < 0.83) {
      const lang = pick(['', 'js']);
      const text = pick(['a < b', 'x\n\ny', '```\nin\n```', '  indented', '$x$ *a*'].concat(extended ? ['~~~\nin\n~~~', '<script>alert(1)</script>'] : []));
      return N.code_block.create({ lang, info: extended && lang ? pick(['', 'title="x" {1,3}', 'a`b']) : '' }, [schema.text(text)]);
    }
    if (r < 0.88) return N.horizontal_rule.create();
    if (r < 0.93) return N.formula_block.create({ tex: pick(['E = mc^2', '\\int_0^1 x\\,dx', 'a \\\\ b', 'a\n= b']) });
    if (extended && r < 0.96) return N.source_block.create(null, [schema.text(pick(['<div class="x">\nraw *html*\n</div>', '<!-- note -->', '[r]: https://example.com/r "T"', '<script>alert(1)</script>', '<img src=x onerror=alert(1)>']))]);
    const cols = 1 + Math.floor(rnd() * 3);
    const row = (type) => N.grid_row.create(null, Array.from({ length: cols }, (x, i) => type.create({ align: [null, 'left', 'center', 'right'][i % 4] }, tidy(inline(false)))));
    return N.grid.create(null, [row(N.grid_head), row(N.grid_cell)]);
  }
  const docs = [];
  for (let i = 0; i < count; i += 1) {
    const kids = [];
    const n = 1 + Math.floor(rnd() * 3);
    for (let j = 0; j < n; j += 1) kids.push(block(0));
    docs.push(N.doc.create(null, kids));
  }
  return docs;
}
// </fuzz-generator>
const fuzz = { n: 0, bad: [], same: [0, 0] };
for (const extended of [false, true]) {
  for (const doc of fuzzDocs(FUZZ, extended)) {
    fuzz.n += 1;
    try {
      doc.check();
      const md0 = S(doc); // what the editor would save
      const d1 = P(md0); // the first reading
      d1.check();
      const md1 = S(d1);
      const d2 = P(md1);
      if (d1.eq(doc)) fuzz.same[extended ? 1 : 0] += 1;
      if (!d2.eq(d1)) fuzz.bad.push(`a second reading differs from the first: ${JSON.stringify(md0)} -> ${JSON.stringify(md1)}`);
      else if (S(d2) !== md1) fuzz.bad.push(`a second writing differs from the first: ${JSON.stringify(md1)}`);
    } catch (err) { fuzz.bad.push(`threw ${err.message} on ${doc.toString().slice(0, 300)}`); }
  }
}
const pct = (k) => `${(100 * k / FUZZ).toFixed(1)}%`;
const fuzzSummary = `fuzz ${fuzz.n}: ${fuzz.n - fuzz.bad.length} fixed points, ${fuzz.bad.length} not (read back as the very document generated: ${pct(fuzz.same[0])} of the spike's kind, ${pct(fuzz.same[1])} of the extended kind)`;
test(`fuzz: ${fuzz.n} random documents: read, write, read gives the first reading again, and the second writing the first`, () => {
  // Known and not covered (documents-lib-n-serialise.js, dlRichMarks): bold inside italic whose closing mark has punctuation on
  // both sides, which marked pairs by counting. It is 1 document in the 8,000 of `--fuzz=4000` and none in the 500 run here.
  const known = Math.floor(fuzz.n / 4000);
  assert.ok(fuzz.bad.length <= known, `${fuzz.bad.length} of ${fuzz.n} (at most ${known} known):${fuzz.bad.slice(0, 5).map((b) => `\n    ${b.slice(0, 600)}`).join('')}`);
});

// ---- 5. the hostile corpus -------------------------------------------------------------------------------------------------------
// Tags a drawn node may be, and the attributes it may carry. Everything a person wrote is text inside these.
const TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'pre', 'code', 'hr', 'ul', 'ol', 'li', 'table', 'tbody', 'tr', 'th', 'td', 'div', 'span', 'br', 'a', 'strong', 'em', 's']);
const INVISIBLE = /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
// Nothing in the document is markup or a live address: every node and mark is one of the schema's, every address passes the
// allow-list in its stored form, every chip address matches the patterns, no attribute holds an invisible character, and every
// node draws as allowed elements whose attributes are the few the schema writes (a person's words are only ever text content).
function assertSafe(doc, what) {
  doc.check();
  const spec = (s) => {
    if (typeof s === 'string' || s === 0) return;
    assert.ok(Array.isArray(s) && TAGS.has(s[0]), `${what}: draws <${s && s[0]}>`);
    s.slice(1).forEach((x, i) => {
      if (i === 0 && x && typeof x === 'object' && !Array.isArray(x)) {
        for (const [k, v] of Object.entries(x)) {
          assert.ok(/^(class|href|rel|target|style|start|data-(module|kind|id|task))$/.test(k), `${what}: attribute ${k}`);
          if (k === 'href') assert.ok(/^(https?:\/\/|mailto:)/.test(v) && L.dlRichHref(v) === v, `${what}: href ${v}`);
          if (k === 'style') assert.ok(/^text-align:(left|center|right)$/.test(v), `${what}: style ${v}`);
          if (k === 'class') assert.ok(/^dl-[a-z -]+$/.test(v), `${what}: class ${v}`);
          if (k === 'start') assert.ok(/^\d{1,6}$/.test(v), `${what}: start ${v}`);
        }
      } else spec(x);
    });
  };
  doc.descendants((n) => {
    assert.ok(N[n.type.name] === n.type, `${what}: a node of an unknown type`);
    if (!n.isText) spec(n.type.spec.toDOM(n));
    for (const v of Object.values(n.attrs)) if (typeof v === 'string') assert.ok(!INVISIBLE.test(v), `${what}: an invisible character in an attribute`);
    if (n.isText) assert.ok(!INVISIBLE.test(n.text), `${what}: an invisible character in the words`);
    for (const m of n.marks) {
      assert.ok(M[m.type.name] === m.type, `${what}: a mark of an unknown type`);
      spec(m.type.spec.toDOM(m));
      if (m.type === M.link) assert.ok(/^(https?:\/\/|mailto:)/.test(m.attrs.href) && L.dlRichHref(m.attrs.href) === m.attrs.href, `${what}: a link to ${m.attrs.href}`);
    }
    if (n.type === N.object) assert.ok(/^[a-z][a-z0-9_-]{0,39}$/.test(n.attrs.module) && /^[a-z][a-z0-9_-]{0,39}$/.test(n.attrs.kind) && /^[A-Za-z0-9._-]{1,64}$/.test(n.attrs.id), `${what}: a chip address`);
    return true;
  });
}
const linksOf = (doc) => nodesOf(doc).flatMap((n) => n.marks.filter((m) => m.type === M.link).map((m) => m.attrs.href));
const depthOf = (doc, types) => { let max = 0; const walk = (n, d) => { const here = types.includes(n.type) ? d + 1 : d; if (here > max) max = here; n.forEach((c) => walk(c, here)); }; walk(doc, 0); return max; };
// [what, the text, what must hold beyond assertSafe: 'source' (all of it is held in source nodes), 'nolink' (no link), 'text' (no source node)]
const HOSTILE = [
  ['a script block', '<script>alert(1)</script>\n', 'source'],
  ['a script in a line', 'a <script>alert(1)</script> b\n', 'nolink'],
  ['an image with onerror', '<img src=x onerror=alert(1)>\n\ntext <img src=x onerror=alert(1)> text\n', 'nolink'],
  ['an iframe with a script address', '<iframe src="javascript:alert(1)"></iframe>\n', 'source'],
  ['svg onload and a script inside svg', '<svg onload=alert(1)>\n\n<svg><script>alert(1)</script></svg>\n\na <svg/onload=alert(1)> b\n', 'nolink'],
  ['a style block and a style attribute', '<style>body{display:none}</style>\n\n<p style="position:fixed;inset:0">cover</p>\n', 'source'],
  ['an anchor tag with a script address and onclick', '<a href="javascript:alert(1)" onclick="alert(1)">x</a>\n', 'nolink'],
  ['script addresses in links', '[a](javascript:alert(1)) [b](JAVASCRIPT:alert(1)) [c](java\tscript:alert(1)) [d](&#106;avascript:alert(1)) [e](&#x6A;avascript&colon;alert(1)) [f](jav&#x09;ascript:alert(1)) <javascript:alert(1)>\n', 'nolink'],
  ['a script address through a reference', '[x]: javascript:alert(1)\n\nClick [x] and [it][x].\n', 'nolink'],
  ['data, vbscript, file, relative and protocol-relative addresses', '[a](data:text/html,<script>alert(1)</script>) [b](data:text/html;base64,PHNjcmlwdD4=) [c](vbscript:msgbox(1)) [d](file:///etc/passwd) [e](//evil.example/x) [f](/relative) [g](#frag) [h](evil.example)\n', 'nolink'],
  ['a script address with direction and zero-width characters', '[a](java\u200bscript:alert(1)) [b](\u202ejavascript:alert(1)) [c](javascript\u2060:alert(1)) [d](java\u00adscript:alert(1))\n', 'nolink'],
  ['pictures', '![a](javascript:alert(1)) ![b](https://example.com/x.png "onerror=alert(1)") ![c](data:image/svg+xml,<svg onload=alert(1)>)\n', 'nolink'],
  ['an address that breaks out of its attribute', '[a](https://example.com/"onmouseover="alert(1)) <https://example.com/"onmouseover="alert(1)>\n', 'nolink'],
  ['a link title and a chip title with markup', '[a](https://example.com "\\"><script>alert(1)</script>") [b](object:maps:place:p1 "<img src=x onerror=alert(1)>")\n'],
  ['chip addresses that are not chip addresses', '[a](object:maps:place:<script>) [b](object:a:b:c d) [c](object:Maps:place:p1) [d](object:maps:place) [e](object:maps:place:p1:extra) [f](OBJECT:maps:place:p1&#32;)\n', 'nolink'],
  ['a chip label with markup', '[<img src=x onerror=alert(1)>](object:maps:place:p1) [**b** `c` <b>d</b>](object:maps:place:p2)\n'],
  ['entities that spell markup stay words', '&lt;script&gt;alert(1)&lt;/script&gt; &#60;img src=x onerror=alert(1)&#62; &#x3C;svg onload=alert(1)&#x3E;\n', 'text'],
  ['entities that spell a link stay words', '&#91;x&#93;&#40;javascript:alert(1)&#41; and &#33;&#91;p&#93;&#40;https://example.com/p.png&#41;\n', 'text'],
  ['a formula with \\href, \\url and markup', '$\\href{javascript:alert(1)}{x}$ and $\\url{javascript:alert(1)}$ and $<img src=x onerror=alert(1)>$\n\n$$\\href{javascript:alert(1)}{\\text{click}}$$\n\n$$<script>alert(1)</script>$$\n', 'nolink'],
  ['a code fence whose first line is markup', '```"><svg onload=alert(1)>\n<script>alert(1)</script>\n```\n\n~~~js <img src=x onerror=alert(1)>\nx\n~~~\n', 'nolink'],
  ['markup in a heading, a list row, a quote and a grid cell', '# <script>alert(1)</script>\n\n- <img src=x onerror=alert(1)>\n\n> <svg onload=alert(1)>\n\n| <b onclick=alert(1)>x</b> |\n| --- |\n| [y](javascript:alert(1)) |\n', 'nolink'],
  ['HTML around Markdown', '<div onclick="alert(1)">\n\n**bold** [ok](https://example.com)\n\n</div>\n'],
  ['a comment that hides a script', '<!-- --><script>alert(1)</script><!-- -->\n\n<!--\n<script>alert(1)</script>\n-->\n', 'nolink'],
  ['direction and zero-width characters in words', 'a\u202eb \u200bc\u2066d\ufeff e\u200d\u200c f\u061c\n', 'text'],
];
let hostileCount = 0;
for (const [what, md, must] of HOSTILE) {
  test(`hostile: ${what}`, () => {
    const doc = P(md);
    assertSafe(doc, what);
    const links = linksOf(doc);
    if (must === 'nolink' || must === 'source') assert.deepEqual(links, [], `${what}: a link was made`);
    if (must === 'source') assert.deepEqual(kinds(doc).filter((k) => k !== 'text'), ['source_block'], `${what}: not held as source alone`);
    if (must === 'text') assert.deepEqual(sourcesOf(doc), [], `${what}: a source node was made of words`);
    const out = S(doc);
    const back = P(out);
    assert.ok(back.eq(doc), `${what}: the document read back differs: ${JSON.stringify(out)}`);
    assertSafe(back, `${what} (read back)`);
    assert.equal(S(back), out);
    assert.equal(shown(out), shown(md), `${what}: the reader shows the written text differently`);
    for (const s of sourcesOf(doc)) for (const line of s.split('\n')) assert.ok(out.includes(line), `${what}: the source line ${JSON.stringify(line)} was not written back`);
  });
  hostileCount += 1;
}
const timed = (fn) => { const s = Date.now(); const v = fn(); return [v, Date.now() - s]; };
const bound = (name, fn) => { test(`bounds: ${name}`, fn); hostileCount += 1; };
bound('a grid of 1,000 rows is held as source; 200 rows by 20 cells is a grid; 201 rows and 21 cells are not', () => {
  const big = `| a |\n| --- |\n${'| <b>r</b> |\n'.repeat(1000)}`;
  const d = P(big);
  assertSafe(d, 'grid 1000');
  assert.deepEqual(kinds(d), ['source_block', 'text']);
  assert.equal(S(d), big);
  const row = (c, n) => `|${` ${c} |`.repeat(n)}\n`;
  const fits = row('h', 20) + row('---', 20) + row('c', 20).repeat(200);
  const g = P(fits);
  assertSafe(g, 'grid 200x20');
  assert.equal(g.firstChild.type, N.grid);
  assert.equal(g.firstChild.childCount, 201);
  assert.equal(g.firstChild.firstChild.childCount, 20);
  assert.equal(S(g), fits);
  assert.deepEqual(kinds(P(row('h', 20) + row('---', 20) + row('c', 20).repeat(201))), ['source_block', 'text']);
  assert.deepEqual(kinds(P(row('h', 21) + row('---', 21) + row('c', 21))), ['source_block', 'text']);
});
bound('lists nested 10 deep stop at 4, quotes nested 12 deep stop at 8; the rest is source, and nothing is dropped', () => {
  const list = `${Array.from({ length: 10 }, (x, i) => `${'  '.repeat(i)}- level${i}`).join('\n')}\n`;
  const d = P(list);
  assertSafe(d, 'list 10');
  assert.equal(depthOf(d, [N.bullet_list, N.ordered_list]), L.DL.listDepth);
  assert.ok(sourcesOf(d).join('\n').includes('level9'));
  for (let i = 0; i < 10; i += 1) assert.ok(S(d).includes(`level${i}`), `level${i} was dropped`);
  assert.ok(P(S(d)).eq(d));
  const quote = `${'> '.repeat(12)}deep <script>alert(1)</script>\n`;
  const q = P(quote);
  assertSafe(q, 'quote 12');
  assert.equal(depthOf(q, [N.blockquote]), 8);
  assert.ok(S(q).includes('deep <script>alert(1)</script>'));
  assert.ok(P(S(q)).eq(q));
});
bound('150,000 characters are read; one more, and 2,000,000, are held whole as one source block, quickly', () => {
  const para = 'word '.repeat(19).trim();
  const fits = `${para}\n\n`.repeat(1600).slice(0, L.DL.sizeMax - 1).replace(/\s$/, 'x') + '\n';
  assert.equal(fits.length, L.DL.sizeMax);
  const [d, ms] = timed(() => P(fits));
  assert.ok(d.childCount > 1000 && d.firstChild.type === N.paragraph, 'a text at the bound is read');
  assert.ok(ms < 3000, `reading 150,000 characters took ${ms} ms`);
  const [out, ms2] = timed(() => S(d));
  assert.ok(ms2 < 3000, `writing 150,000 characters took ${ms2} ms`);
  assert.equal(out, `${fits.replace(/\n+$/, '')}\n`);
  const over = P(`${fits}x`);
  assert.deepEqual(kinds(over), ['source_block', 'text']);
  assert.equal(over.textContent, `${fits}x`);
  const huge = '<script>alert(1)</script>\n[x](javascript:alert(1))\n'.repeat(40000).slice(0, 1999999) + '\n';
  assert.equal(huge.length, 2000000);
  const [h, ms3] = timed(() => P(huge));
  assert.ok(ms3 < 2000, `2,000,000 characters took ${ms3} ms`);
  assertSafe(h, '2,000,000 characters');
  assert.deepEqual(kinds(h), ['source_block', 'text']);
  assert.equal(h.childCount, 1);
  assert.equal(S(h), huge, 'nothing of a text over the bound is dropped');
});
bound('more than 60,000 nodes: the text is held whole as one source block; under it, it is read', () => {
  const many = 'a\n\n'.repeat(45000); // 45,000 paragraphs, 90,000 nodes
  assert.ok(many.length <= L.DL.sizeMax);
  const [d, ms] = timed(() => P(many));
  assert.ok(ms < 3000, `${ms} ms`);
  assert.deepEqual(kinds(d), ['source_block', 'text']);
  assert.equal(S(d), `${many.replace(/\n+$/, '')}\n`);
  const under = P('a\n\n'.repeat(25000));
  assert.equal(under.childCount, 25000);
  let count = 0;
  under.descendants(() => { count += 1; return true; });
  assert.ok(count <= L.DL_RICH.nodesMax);
});
bound('deep and long runs of marks, brackets and backslashes end, and stay words', () => {
  for (const md of ['*a'.repeat(5000), `${'['.repeat(3000)}a${']'.repeat(3000)}`, '\\'.repeat(20001), `${'**'.repeat(2000)}a${'**'.repeat(2000)}`, `${'<'.repeat(5000)}script>`, '$'.repeat(5000), `${'`'.repeat(4001)}a`, '&'.repeat(2000) + 'amp;'.repeat(2000)]) {
    const [d, ms] = timed(() => P(md));
    assert.ok(ms < 3000, `${md.slice(0, 12)}... took ${ms} ms`);
    assertSafe(d, md.slice(0, 12));
    assert.deepEqual(linksOf(d), []);
    const out = S(d);
    assert.ok(P(out).eq(d), `${md.slice(0, 12)}... is not a fixed point`);
  }
});
bound('a lexer that throws, a value that is not text, and an empty text', () => {
  const thrown = L.dlRichParse(PM, '# a <script>', () => { throw new Error('lexer'); });
  assert.deepEqual(kinds(thrown), ['source_block', 'text']);
  assert.equal(thrown.textContent, '# a <script>');
  for (const v of [null, undefined, 5, {}, []]) { const d = L.dlRichParse(PM, v, lex); assert.equal(d.childCount, 1); assert.equal(d.firstChild.type, N.paragraph); assert.equal(S(d), ''); }
  const odd = L.dlRichParse(PM, 'x', () => [{ type: 'paragraph', raw: 'x', tokens: [{ type: 'link', href: 'javascript:alert(1)', raw: '[x](javascript:alert(1))', text: 'x', tokens: [] }, { type: 'html', raw: '<script>' }, { type: 'nonsense', raw: '{{x}}' }] }, { type: 'table', header: Array.from({ length: 30 }, () => ({ tokens: [] })), rows: [], align: [], raw: 'T' }, null, 7]);
  assertSafe(odd, 'a made-up token list');
  assert.deepEqual(linksOf(odd), []);
  assert.deepEqual(sourcesOf(odd), ['[x](javascript:alert(1))<script>{{x}}', 'T']);
});

for (const st of ['EXACT', 'CANONICALISED', 'LOST', 'CHANGED', 'ERROR']) {
  say(`\n== ${st} (${by(st).length})`);
  for (const r of by(st)) {
    if (st === 'EXACT') { say(`  ${r.name}`); continue; }
    say(`  ${r.name}${r.err ? `: ${r.err}` : ''}${r.lost && r.lost.length ? `  [words gone: ${r.lost.join(' ')}]` : ''}`);
    if (!r.err) { say(`      in : ${JSON.stringify(r.md1.length > 300 ? `${r.md1.slice(0, 300)}...` : r.md1)}`); say(`      out: ${JSON.stringify(r.md2.length > 300 ? `${r.md2.slice(0, 300)}...` : r.md2)}`); }
  }
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const summary = `corpus ${CASES.length}: ${by('EXACT').length} exact, ${by('CANONICALISED').length} canonicalised, ${by('CHANGED').length + by('ERROR').length} changed, ${by('LOST').length} lost; ${fuzzSummary}; hostile ${hostileCount}`;
if (fails.length) { console.error(`documents rich mapping: ${fails.length} failed, ${passed} passed (${summary})`); for (const f of fails) console.error(`  - ${f}`); process.exit(1); }
console.log(`documents rich mapping: ${passed} tests passed in ${secs} s (${summary})`);
