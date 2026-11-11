/*
 * rich-corpus.mjs -- what the rich editor's tests share (check-documents-rich.mjs, the mapping; check-documents-rich-write.mjs,
 * the block-level write): the corpus, the hostile corpus, the two fuzz generators, and the loader. Not a test: the module's
 * tests are the files directly in test/ (tools/check-module-tests.mjs), and this folder is not in the module's zip.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// The library files as the page's build joins them, the vendored bundle and the vendored lexer, with no page.
export function loadRich(src, names) {
  const files = fs.readdirSync(src).filter((f) => /^documents-lib-[a-z]-.*\.js$/.test(f)).sort();
  const code = files.map((f) => fs.readFileSync(path.join(src, f), 'utf8')).join('\n');
  const PM = new Function(`${fs.readFileSync(path.join(src, 'documents-lib-0-prosemirror.js'), 'utf8')}\nreturn DlPM;`)();
  const L = new Function(`${code}\nreturn { ${names.join(', ')} };`)();
  const markedLib = createRequire(import.meta.url)(path.join(src, 'documents-lib-0-marked.js'));
  const reader = new markedLib.Marked({ gfm: true, extensions: [L.DL_MARKED_MATH], hooks: L.DL_MARKED_HOOKS });
  return { PM, L, lex: (md) => reader.lexer(md), files };
}

// ---- the corpus ------------------------------------------------------------------------------------------------------------------
// [name, the text, the text written back (when it is not the same), 'lost' when words may go]
export const CASES = [
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

// ---- the fuzz ----------------------------------------------------------------------------------------------------------------------
// Random documents built straight in the schema (what a person could make in the editor). `extended` false is the spike's
// generator with its seed (rich-spike/work/fuzz.mjs; the chip is a node here, not a link); true adds what the spike did not
// have: source nodes, heading levels 5 and 6, link and chip titles, and a code block's info.
// <fuzz-generator>
export function fuzzDocs(schema, count, extended) {
  const N = schema.nodes;
  const M = schema.marks;
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

// ---- the hostile corpus ------------------------------------------------------------------------------------------------------------
// [what, the text, what must hold beyond assertSafe: 'source' (all of it is held in source nodes), 'nolink' (no link), 'text' (no source node)]
export const HOSTILE = [
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

// ---- the source-form fuzz ----------------------------------------------------------------------------------------------------------
// Random texts as a person could have typed them in the box, in any Markdown form: two to five corpus cases one after another,
// with a blank line between them (or, now and then, only a line break), ending with one line break, none or two.
export function sourceDocs(count) {
  let seed = 20261112;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; // mulberry32
  const pool = CASES.map((c) => c[1].replace(/\n+$/, '')).filter((s) => s && s.length < 2000);
  const docs = [];
  for (let i = 0; i < count; i += 1) {
    const k = 2 + Math.floor(rnd() * 4);
    let text = '';
    for (let j = 0; j < k; j += 1) text += (j ? (rnd() < 0.85 ? '\n\n' : '\n') : '') + pool[Math.floor(rnd() * pool.length)];
    const end = rnd();
    docs.push(text + (end < 0.8 ? '\n' : end < 0.9 ? '' : '\n\n'));
  }
  return docs;
}
