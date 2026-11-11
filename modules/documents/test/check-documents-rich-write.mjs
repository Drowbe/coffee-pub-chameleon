#!/usr/bin/env node
/*
 * check-documents-rich-write.mjs -- the rich editor's block-level write (plan-documents-rich-editor.md, "Stored form"), in Node
 * with no DOM:
 *   dlRichRead(PM, text, lex)        -> { doc, stored }: the editor's text, and one table entry for each top-level block of the
 *                                       stored text (its slice, the blank lines after it, the node it reads as)  (documents-lib-m-parse.js)
 *   dlRichText(PM, doc, stored, lex) -> the text the editor hands out: an untouched block word for word, a changed block in
 *                                       the editor's form, read back and compared before it is handed out      (documents-lib-o-write.js)
 *
 * 1. THE TABLE. Its slices and gaps add up to the stored text, entry by entry, for every corpus, fuzz and hostile text.
 * 2. OPEN, THEN DONE. With nothing changed the stored text comes back character for character and nothing is read: the very
 *    document, the document read again (equal nodes), and the document with an empty paragraph added at its end.
 * 3. THE WRITE, case by case: typing, insert, delete, move, split, join, a list row and a grid cell as one block, what stands
 *    between blocks, list marks, a link definition taken away, a block with no end of its own, empty paragraphs, a raw block
 *    edited, no table.
 * 4. THE ONE-BLOCK EDITS. For every corpus, fuzz and source-form text, each of eight kinds of edit, at every place it fits:
 *      type in a paragraph   the words " zq" at the end of a top-level paragraph
 *      edit a heading        the words "zq " at the start of a top-level heading
 *      edit a list row       " zq" at the end of the first paragraph of a top-level list's first row that starts with one
 *      edit a code block     a new last line "zq" in a top-level code block
 *      edit a grid cell      " zq" at the end of the first cell of a top-level grid's last row
 *      insert a block        a new paragraph "zq new" before each top-level block, and after the last
 *      delete a block        each top-level block taken out (texts of two blocks or more)
 *      move a block          each top-level block moved to the end, the last one to the start (texts of two blocks or more)
 *    A run PASSES when the text reads back as the edited document (so the edited block reads back as the edit) and every
 *    other block's characters are the stored ones. For the five kinds that edit in place, every character outside the edited
 *    block must be the stored one too (the blank lines as well). A run that does not pass must be of a known class:
 *      lists       two lists of one kind with one mark came to stand side by side: one is written again with another mark
 *      context     a kept block read as it did only because of another block (a link through a definition that was taken out)
 *      place       a kept block cannot stand, as stored, after the block it now follows (indented code after a list)
 *      serialiser  the edited document is one the serialiser cannot write so that it reads back (the mapping's known limit)
 *    Anything else fails the test. Whole-text rewrites are counted, and must be none.
 * 5. THE ACCEPTED CHANGES. An edited block is written exactly as the serialiser writes that block alone.
 * 6. THE HOSTILE CORPUS. Nothing throws, nothing is dropped, no address outside the allow-list comes out as a link.
 * 7. TIME AND BOUNDS. 56,000 and 142,000 characters, as prose and as the dense corpus: reading, and the write after one edit,
 *    are timed (printed with --report); 149,000 characters in 20,000 blocks, blocks in reverse, blocks all alike, long runs
 *    of line breaks, and 2,000,000 characters must stay quick (the cost grows with the length, not with its square).
 *
 * 250 documents of each fuzz kind here (a seeded subset); `--report` runs 4,000 of each and prints the tables; `--fuzz=N` any number.
 * Usage: node modules/documents/test/check-documents-rich-write.mjs [--report] [--fuzz=N] [path to the src folder]. Exits 1 on any failure.
 */
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadRich, CASES, HOSTILE, fuzzDocs, sourceDocs } from './support/rich-corpus.mjs';

const t0 = Date.now();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const report = args.includes('--report');
const fuzzArg = args.find((a) => a.startsWith('--fuzz='));
const FUZZ = fuzzArg ? Math.max(1, Number(fuzzArg.slice(7)) || 0) : report ? 4000 : 250;
const src = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(root, 'modules/documents/src'));
const { PM, L, lex } = loadRich(src, ['DL', 'DL_RICH', 'dlCleanText', 'DL_MARKED_MATH', 'DL_MARKED_HOOKS', 'dlRichHref', 'dlRichSchema', 'dlRichParse', 'dlRichSerialise', 'dlRichRead', 'dlRichText', 'dlRichMatch']);
const schema = L.dlRichSchema(PM);
const N = schema.nodes;
const M = schema.marks;
const P = (md) => L.dlRichParse(PM, md, lex);
const S = (doc, beside) => L.dlRichSerialise(PM, doc, beside);
const read = (md, lexer = lex) => { const r = L.dlRichRead(PM, md, lexer); return { doc: r.doc, table: r.stored }; }; // `table`: the plan's word for `stored`
const write = (doc, table) => L.dlRichText(PM, doc, table, lex);

let passed = 0;
const fails = [];
function test(name, fn) { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }
const say = (...a) => { if (report) console.log(...a); };
const timed = (fn) => { const s = performance.now(); const v = fn(); return [v, performance.now() - s]; };
const median = (fn, times = 9) => { const all = []; let v; for (let i = 0; i < times; i += 1) { const [r, ms] = timed(fn); v = r; all.push(ms); } all.sort((a, b) => a - b); return [v, all[Math.floor(times / 2)]]; };

const kids = (doc) => { const out = []; doc.forEach((b, off) => out.push({ b, off })); return out; };
const para = (text) => N.paragraph.create(null, text ? [schema.text(text)] : []);
// The document without the blocks that write nothing (an empty paragraph), as it can be read back.
const written = (doc) => { const out = []; doc.forEach((b) => { if (!(b.type === N.paragraph && b.childCount === 0)) out.push(b); }); return out; };
const readsAs = (text, doc) => { const back = P(text); const want = written(doc); return want.length ? back.childCount === want.length && want.every((b, i) => back.child(i).eq(b)) : back.childCount === 1 && back.firstChild.childCount === 0; };
// Edits, made as the editor makes them (a transform keeps the node of every block it does not touch).
const typeAt = (doc, pos, text) => new PM.Transform(doc).insert(pos, schema.text(text)).doc;
const endOf = (doc, i) => { const k = kids(doc)[i]; return k.off + k.b.nodeSize - 1; };
const typeIn = (doc, i, text) => typeAt(doc, endOf(doc, i), text);
const insertAt = (doc, i, node) => new PM.Transform(doc).insert(i < doc.childCount ? kids(doc)[i].off : doc.content.size, node).doc;
const deleteAt = (doc, i) => { const k = kids(doc)[i]; return new PM.Transform(doc).delete(k.off, k.off + k.b.nodeSize).doc; };
const moveTo = (doc, i, to) => insertAt(deleteAt(doc, i), to, doc.child(i));

// ---- 1. the table ----------------------------------------------------------------------------------------------------------------
const spike = fuzzDocs(schema, FUZZ, false).map((d) => S(d));
const extended = fuzzDocs(schema, FUZZ, true).map((d) => S(d));
const sourceForm = sourceDocs(FUZZ);
const SETS = [['corpus', CASES.map((c) => c[1])], ['fuzz, the spike\'s kind', spike], ['fuzz, the extended kind', extended], ['fuzz, source form', sourceForm]];
const ALL = SETS.flatMap((s) => s[1]).concat(HOSTILE.map((h) => h[1]));

test(`table: slices and gaps add up to the text, one entry for each top-level block (${ALL.length} texts)`, () => {
  let none = 0;
  for (const md of ALL) {
    const { doc, table } = read(md);
    assert.ok(doc.eq(P(md)), 'the document is not the one the mapping reads');
    assert.equal(table.text, md);
    assert.equal(table.doc, doc);
    if (!table.entries) { none += 1; continue; }
    const clean = L.dlCleanText(md);
    let at = table.lead.length;
    assert.ok(!table.lead.trim(), 'words before the first block');
    table.entries.forEach((e, i) => {
      assert.equal(e.from, at, `${JSON.stringify(md.slice(0, 80))}: entry ${i} starts elsewhere`);
      assert.equal(clean.slice(at, at + e.text.length), e.text);
      assert.ok(e.text && !/\n$/.test(e.text) && !e.gap.trim(), 'a slice ends in a line break, or a gap holds words');
      assert.equal(e.node, doc.child(i), 'an entry is not beside its node');
      at += e.text.length + e.gap.length;
    });
    assert.equal(at, clean.length);
    assert.equal(table.entries.length ? doc.childCount : 1, table.entries.length || 1);
  }
  assert.equal(none, 0, `${none} texts got no table`);
});
test('table: a last block with no end of its own is flagged open, and only that', () => {
  const open = (md) => { const e = read(md).table.entries; return e.map((x) => Boolean(x.open)); };
  assert.deepEqual(open('a\n\n```\ncode\n'), [false, true]);
  assert.deepEqual(open('a\n\n```\ncode\n```\n'), [false, false]);
  assert.deepEqual(open('~~~js\ncode'), [true]);
  assert.deepEqual(open('    indented\n'), [false]);
  assert.deepEqual(open('a\n\n<!-- never closed\n'), [false, true]);
  assert.deepEqual(open('<!-- closed -->\n'), [false]);
  assert.deepEqual(open('<script>\nalert(1)\n'), [true]);
  assert.deepEqual(open('<pre>\nx\n</pre>\n'), [false]);
  assert.deepEqual(open('<div>\nx\n'), [false]); // ends at the next blank line
  assert.deepEqual(open('- a\n\n> b\n\n| c |\n| --- |\n\nd'), [false, false, false, false]);
  const over = read(`${'x'.repeat(L.DL.sizeMax)}y\n`).table;
  assert.equal(over.entries.length, 1);
  assert.equal(over.entries[0].open, true);
});
test('table: an empty text and a text of blank lines have no entry; the text comes back as it is', () => {
  for (const md of ['', '\n', '\n\n  \n']) {
    const { doc, table } = read(md);
    assert.deepEqual(table.entries, []);
    assert.equal(table.lead, md);
    assert.equal(write(doc, table).text, md);
    assert.equal(write(typeIn(doc, 0, 'zq'), table).text, `${md}zq\n`);
  }
});

// ---- 2. open, then Done ----------------------------------------------------------------------------------------------------------
const exact = {};
for (const [name, list] of SETS.concat([['hostile', HOSTILE.map((h) => h[1])]])) {
  let n = 0;
  const off = [];
  for (const md of list) {
    const { doc, table } = read(md);
    const same = [write(doc, table), write(P(md), table), write(insertAt(doc, doc.childCount, para('')), table)];
    if (same.every((r) => r.text === md && r.changed === false && r.same === true && r.reads === 0)) n += 1; else off.push(md);
  }
  exact[name] = [n, list.length];
  test(`open, then Done: the stored text comes back exactly, and nothing is read (${name}: ${list.length})`, () => {
    assert.equal(off.length, 0, off.slice(0, 3).map((md) => `\n    ${JSON.stringify(md.slice(0, 200))}`).join(''));
  });
}
test('open, then Done: a text typed and taken back, and a text of other line ends, come back as stored', () => {
  const md = 'One\r\n\r\n* two\r\n';
  const { doc, table } = read(md);
  const there = typeIn(doc, 0, ' zq');
  const back = new PM.Transform(there).delete(endOf(there, 0) - 3, endOf(there, 0)).doc;
  assert.ok(back !== doc && back.eq(doc));
  assert.equal(write(back, table).text, md);
  assert.equal(write(there, table).text, 'One zq\n\n* two\n'); // a change: the cleaned text is what the slices are cut from
});

// ---- 3. the write, case by case --------------------------------------------------------------------------------------------------
const STORED = 'Title\n=====\n\nA __bold__ word\non two lines.\n\n* one\n* two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n    code\n\n***\n\nLast _one_';
const good = (r) => { assert.equal(r.changed, true); assert.equal(r.same, true); assert.equal(r.whole, false); assert.equal(r.alone, 0); assert.equal(r.reads, 1); return r.text; };
test('write: typing in one block changes that block alone, to the editor\'s form', () => {
  const { doc, table } = read(STORED);
  assert.equal(good(write(typeIn(doc, 1, ' zq'), table)), STORED.replace('A __bold__ word\non two lines.', 'A **bold** word on two lines. zq'));
  assert.equal(good(write(typeAt(doc, 1, 'zq '), table)), STORED.replace('Title\n=====', '# zq Title'));
  assert.equal(good(write(typeIn(doc, 4, '\nzq'), table)), STORED.replace('    code', '```\ncode\nzq\n```'));
  assert.equal(good(write(typeIn(doc, 6, ' zq'), table)), STORED.replace('Last _one_', 'Last *one* zq'));
});
test('write: a list row and a grid cell edited: the list, or the grid, is the one block written', () => {
  const { doc, table } = read(STORED);
  const row = kids(doc)[2];
  assert.equal(good(write(typeAt(doc, row.off + 1 + row.b.firstChild.nodeSize - 2, ' zq'), table)), STORED.replace('* one\n* two', '- one zq\n- two'));
  const grid = kids(doc)[3];
  assert.equal(good(write(typeAt(doc, grid.off + grid.b.nodeSize - 3, ' zq'), table)), STORED.replace('| a | b |\n|---|---|\n| 1 | 2 |', '| a | b |\n| --- | --- |\n| 1 | 2 zq |'));
});
test('write: insert, delete and move keep every other block word for word', () => {
  const { doc, table } = read(STORED);
  assert.equal(good(write(insertAt(doc, 2, para('new')), table)), STORED.replace('\n\n* one', '\n\nnew\n\n* one'));
  assert.equal(good(write(insertAt(doc, 0, para('new')), table)), `new\n\n${STORED}`);
  assert.equal(good(write(insertAt(doc, 7, para('new')), table)), `${STORED}\n\nnew\n`);
  assert.equal(good(write(deleteAt(doc, 2), table)), STORED.replace('* one\n* two\n\n', ''));
  assert.equal(good(write(deleteAt(doc, 0), table)), STORED.replace('Title\n=====\n\n', ''));
  assert.equal(good(write(deleteAt(doc, 6), table)), STORED.replace('\n\nLast _one_', '\n'));
  assert.equal(good(write(moveTo(doc, 2, 0), table)), `* one\n* two\n\n${STORED.replace('* one\n* two\n\n', '')}`);
  assert.equal(good(write(moveTo(doc, 0, 6), table)), `${STORED.replace('Title\n=====\n\n', '')}\n\nTitle\n=====\n`);
  const all = doc.copy(PM.Fragment.from(kids(doc).map((k) => k.b).reverse()));
  assert.equal(good(write(all, table)), 'Last _one_\n\n***\n\n    code\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n* one\n* two\n\nA __bold__ word\non two lines.\n\nTitle\n=====\n');
});
test('write: split and join write the blocks they touch, and no other', () => {
  const { doc, table } = read(STORED);
  const split = new PM.Transform(doc).split(kids(doc)[1].off + 4).doc;
  assert.equal(split.childCount, 8);
  assert.equal(good(write(split, table)), STORED.replace('A __bold__ word\non two lines.', 'A **b**\n\n**old** word on two lines.'));
  const two = read('one\n\n\ntwo __x__\n\n\n\n* three\n');
  const joined = new PM.Transform(two.doc).join(kids(two.doc)[1].off).doc;
  assert.equal(joined.childCount, 2);
  assert.equal(good(write(joined, two.table)), 'onetwo **x**\n\n\n\n* three\n');
});
test('write: what stands between blocks: stored around an edit in place, a blank line where a block is new or changes kind', () => {
  const tight = read('words\n# Head\n- row\n\n\n\nend');
  assert.equal(good(write(typeIn(tight.doc, 0, ' zq'), tight.table)), 'words zq\n# Head\n- row\n\n\n\nend');
  assert.equal(good(write(typeIn(tight.doc, 1, ' zq'), tight.table)), 'words\n# Head zq\n- row\n\n\n\nend');
  assert.equal(good(write(typeIn(tight.doc, 3, ' zq'), tight.table)), 'words\n# Head\n- row\n\n\n\nend zq');
  const head = kids(tight.doc)[1];
  const plain = new PM.Transform(tight.doc).setBlockType(head.off + 1, head.off + 2, N.paragraph).doc; // the heading becomes a paragraph: it would run into "words"
  assert.equal(good(write(plain, tight.table)), 'words\n\nHead\n\n- row\n\n\n\nend');
  assert.equal(good(write(insertAt(tight.doc, 1, para('new')), tight.table)), 'words\n\nnew\n\n# Head\n- row\n\n\n\nend');
  assert.equal(good(write(deleteAt(tight.doc, 2), tight.table)), 'words\n# Head\n\nend');
  const seven = new PM.Transform(tight.doc).setNodeMarkup(kids(tight.doc)[2].off, N.ordered_list, { order: 7 }).doc; // another kind of block
  assert.equal(good(write(seven, tight.table)), 'words\n# Head\n\n7. row\n\n\n\nend');
  const code = read('- row\n\ntext\n\n    code\n'); // the text taken out: the indented code would be read as part of the row
  assert.equal(good(write(deleteAt(code.doc, 1), code.table)), '- row\n\n```\ncode\n```\n');
});
test('write: a list beside a list takes another mark, and a kept list that comes to stand after its like is written again', () => {
  const { doc, table } = read('* a\n\ntext\n\n* b\n\n1. c\n');
  const row = (t) => N.list_item.create(null, [para(t)]);
  assert.equal(good(write(insertAt(doc, 1, N.bullet_list.create(null, [row('new')])), table)), '* a\n\n- new\n\ntext\n\n* b\n\n1. c\n');
  assert.equal(good(write(insertAt(doc, 3, N.ordered_list.create(null, [row('new')])), table)), '* a\n\ntext\n\n* b\n\n1) new\n\n\n1. c\n');
  const r = write(deleteAt(doc, 1), table); // the two bullet lists now stand side by side
  assert.equal(r.text, '* a\n\n- b\n\n1. c\n');
  assert.deepEqual([r.same, r.whole, r.alone, r.reads], [true, false, 0, 1]);
});
test('write: a link definition taken out: the block that read through it is written again alone, and nothing else', () => {
  const { doc, table } = read('See [the site][s] and __this__.\n\n* kept\n\n[s]: https://example.com/\n');
  const r = write(deleteAt(doc, 2), table);
  assert.equal(r.text, 'See [the site](https://example.com/) and **this**.\n\n* kept\n');
  assert.deepEqual([r.same, r.whole, r.alone, r.reads], [true, false, 1, 2]);
  assert.equal(good(write(typeIn(doc, 0, ' zq'), table)), 'See [the site](https://example.com/) and **this**. zq\n\n* kept\n\n[s]: https://example.com/\n');
});
test('write: a block with no end of its own is kept at the end, and written closed when a block follows it', () => {
  const { doc, table } = read('a\n\n~~~\ncode\n');
  assert.equal(good(write(typeIn(doc, 0, ' zq'), table)), 'a zq\n\n~~~\ncode\n');
  assert.equal(good(write(insertAt(doc, 2, para('new')), table)), 'a\n\n```\ncode\n```\n\nnew\n');
  assert.equal(write(insertAt(doc, 2, para('')), table).text, 'a\n\n~~~\ncode\n'); // an empty paragraph after it writes nothing
});
test('write: a block that writes nothing (an empty paragraph) is left out; a text of them alone is empty', () => {
  const { doc, table } = read('a\n\n\nb\n');
  const r = write(typeIn(insertAt(insertAt(doc, 1, para('')), 0, para('')), 3, ' zq'), table);
  assert.equal(good(r), 'a\n\n\nb zq\n');
  assert.deepEqual(r.blocks.map((b) => [b.index, b.entry, r.text.slice(b.from, b.to)]), [[1, 0, 'a'], [3, -1, 'b zq']]);
  const none = write(N.doc.create(null, [para(''), para('')]), table);
  assert.deepEqual([none.text, none.same, none.blocks.length], ['', true, 0]);
});
test('write: a text that cannot read back is still handed out, with `same` false (a raw block edited; a raw block never closed)', () => {
  const raw = read('a\n\n<div>x</div>\n');
  const at = kids(raw.doc)[1].off + 1;
  const edited = new PM.Transform(raw.doc).delete(at, at + 5).doc; // "<div>" taken off the raw block: its words read as a paragraph now
  const r = write(edited, raw.table);
  assert.equal(r.text, 'a\n\nx</div>\n');
  assert.deepEqual([r.same, r.whole, r.changed, r.alone, r.reads], [false, false, true, 0, 1]);
  const space = write(typeAt(raw.doc, 1, ' '), raw.table); // words that start with a space: Markdown reads them without it
  assert.deepEqual([space.text, space.same, space.whole, space.alone, space.reads], ['a\n\n<div>x</div>\n', false, false, 0, 1]);
  const open = read('<!-- never closed\n');
  const after = write(insertAt(open.doc, 1, para('new')), open.table);
  assert.equal(after.text, '<!-- never closed\n\nnew\n');
  assert.deepEqual([after.same, after.whole, after.alone], [false, false, 0]);
  const kept = read('<script>\nx\n</script>\n\n* kept __as it is__\n');
  const closed = kids(kept.doc)[0];
  const opened = write(new PM.Transform(kept.doc).delete(closed.off + closed.b.nodeSize - 10, closed.off + closed.b.nodeSize - 1).doc, kept.table); // "</script>" taken off
  assert.deepEqual([opened.text, opened.same, opened.whole, opened.alone], ['<script>\nx\n\n* kept __as it is__\n', false, false, 0]); // the kept block is not written again for it
});
test('write: with no table (the tokens do not add up to the text) nothing is kept by the block: unchanged is exact, a change writes the whole text', () => {
  const odd = (md) => lex(md).map((t, i) => (i === 0 ? { ...t, raw: `${t.raw} ` } : t));
  const md = 'A __bold__ word.\n\n* one\n';
  const { doc, table } = read(md, odd);
  assert.equal(table.entries, null);
  assert.ok(doc.eq(P(md)));
  assert.equal(L.dlRichText(PM, doc, table, lex).text, md);
  assert.equal(L.dlRichText(PM, P(md), table, lex).text, md);
  const r = L.dlRichText(PM, typeIn(doc, 0, ' zq'), table, lex);
  assert.deepEqual([r.text, r.whole, r.same], ['A **bold** word. zq\n\n- one\n', true, true]);
});
test('write: the same document and table give the same text, and the table is left as it was', () => {
  const { doc, table } = read(STORED);
  const before = JSON.stringify(table.entries.map((e) => [e.text, e.gap, e.from, e.open]));
  const edited = moveTo(typeIn(doc, 1, ' zq'), 4, 0);
  const a = write(edited, table);
  const b = write(edited, table);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(table.entries.map((e) => [e.text, e.gap, e.from, e.open])), before);
  assert.equal(write(doc, table).text, STORED);
});
test('match: the very node first, then an equal one; a stored block is used once', () => {
  const { doc, table } = read('---\n\n***\n\n___\n\na\n\na\n');
  const e = table.entries;
  assert.deepEqual(L.dlRichMatch(e, kids(doc).map((k) => k.b)), [0, 1, 2, 3, 4]);
  assert.deepEqual(L.dlRichMatch(e, kids(deleteAt(doc, 0)).map((k) => k.b)), [1, 2, 3, 4]); // not the first rule's slice
  assert.deepEqual(L.dlRichMatch(e, kids(P('---\n\n---\n\n---\n\na\n\na\n')).map((k) => k.b)), [0, 1, 2, 3, 4]);
  assert.deepEqual(L.dlRichMatch(e, [para('a'), para('a'), para('a'), para('b')]), [3, 4, -1, -1]);
  assert.equal(write(deleteAt(doc, 0), table).text, '***\n\n___\n\na\n\na\n');
});

// ---- 4. the one-block edits ------------------------------------------------------------------------------------------------------
const KINDS = ['type in a paragraph', 'edit a heading', 'edit a list row', 'edit a code block', 'edit a grid cell', 'insert a block', 'delete a block', 'move a block'];
const IN_PLACE = KINDS.slice(0, 5);
// Every edit of every kind that fits a document: { kind, doc, from: for each block of the edited document, the stored block it is (-1: the edited or new one) }
function edits(doc) {
  const out = [];
  const ks = kids(doc);
  const n = ks.length;
  const same = ks.map((x, i) => i);
  const typed = (kind, i, pos, text) => out.push({ kind, doc: typeAt(doc, pos, text), from: same.map((j) => (j === i ? -1 : j)) });
  ks.forEach(({ b, off }, i) => {
    const empty = b.content.size === 0;
    if (b.type === N.paragraph) typed(KINDS[0], i, off + b.nodeSize - 1, empty ? 'zq' : ' zq');
    if (b.type === N.heading) typed(KINDS[1], i, off + 1, empty ? 'zq' : 'zq ');
    if (b.type === N.bullet_list || b.type === N.ordered_list) {
      let pos = off + 1;
      let done = false;
      b.forEach((item) => {
        if (!done && item.firstChild.type === N.paragraph) { done = true; typed(KINDS[2], i, pos + 1 + item.firstChild.nodeSize - 1, item.firstChild.content.size ? ' zq' : 'zq'); }
        pos += item.nodeSize;
      });
    }
    if (b.type === N.code_block) typed(KINDS[3], i, off + b.nodeSize - 1, empty ? 'zq' : '\nzq');
    if (b.type === N.grid) {
      let pos = off + 1;
      for (let r = 0; r < b.childCount - 1; r += 1) pos += b.child(r).nodeSize;
      const cell = b.lastChild.firstChild;
      typed(KINDS[4], i, pos + 1 + cell.nodeSize - 1, cell.content.size ? ' zq' : 'zq');
    }
  });
  for (let p = 0; p <= n; p += 1) { const from = same.slice(); from.splice(p, 0, -1); out.push({ kind: KINDS[5], doc: insertAt(doc, p, para('zq new')), from }); }
  if (n > 1) {
    for (let i = 0; i < n; i += 1) {
      out.push({ kind: KINDS[6], doc: deleteAt(doc, i), from: same.filter((j) => j !== i) });
      const to = i < n - 1 ? n - 1 : 0;
      const from = same.filter((j) => j !== i);
      from.splice(to, 0, i);
      out.push({ kind: KINDS[7], doc: moveTo(doc, i, to), from });
    }
  }
  return out;
}
const isList = (b) => b.type === N.bullet_list || b.type === N.ordered_list;
// One run -> { pass, strict, whole, alone, classes: why it did not pass }
function oneEdit(md, table, e) {
  const r = write(e.doc, table);
  const reads = readsAs(r.text, e.doc);
  const by = new Map((r.blocks || []).map((b) => [b.index, b]));
  const changed = []; // the other blocks whose characters are not the stored ones
  e.from.forEach((old, j) => {
    if (old < 0 || !table.entries[old]) return; // the edited block; a stored empty text has one empty paragraph and no entry
    const b = by.get(j);
    if (!b || r.text.slice(b.from, b.to) !== table.entries[old].text) changed.push(j);
  });
  let strict = true;
  if (IN_PLACE.includes(e.kind)) {
    const j = e.from.indexOf(-1);
    const b = by.get(j);
    const old = table.entries[j];
    const clean = L.dlCleanText(md);
    strict = Boolean(b) && (old ? r.text.slice(0, b.from) === clean.slice(0, old.from) && r.text.slice(b.to) === clean.slice(old.from + old.text.length) : true);
  }
  const classes = new Set();
  if (!reads || r.same !== reads) classes.add(!reads && !P(S(e.doc)).eq(N.doc.create(null, written(e.doc).length ? written(e.doc) : [para('')])) ? 'serialiser' : 'unexplained');
  for (const j of changed) {
    const b = e.doc.child(j);
    const old = table.entries[e.from[j]];
    const beside = [e.doc.maybeChild(j - 1), e.doc.maybeChild(j + 1)].some((x) => x && x.type === b.type);
    const alone = P(old.text);
    const prev = e.doc.maybeChild(j - 1);
    const after = prev && e.from[j - 1] >= 0 && e.from[j - 1] !== e.from[j] - 1 ? read(`${table.entries[e.from[j - 1]].text}\n\n${old.text}`).doc : null;
    if (isList(b) && beside) classes.add('lists');
    else if (!(alone.childCount === 1 && alone.firstChild.eq(old.node))) classes.add('context');
    else if (after && !(after.childCount === 2 && after.child(0).eq(prev) && after.child(1).eq(b))) classes.add('place');
    else classes.add('unexplained');
  }
  if (!strict) classes.add('unexplained');
  return { pass: reads && !changed.length, strict, whole: r.whole, alone: r.alone, reads: r.reads, classes: [...classes], out: r.text };
}
const editStats = {};
for (const [name, list] of SETS) {
  const st = { docs: list.length, runs: 0, pass: 0, whole: 0, alone: 0, reads: 0, kinds: Object.fromEntries(KINDS.map((k) => [k, { runs: 0, pass: 0 }])), classes: {}, inPlace: {}, examples: {}, notStrict: 0 };
  for (const md of list) {
    const { doc, table } = read(md);
    for (const e of edits(doc)) {
      const r = oneEdit(md, table, e);
      st.runs += 1; st.kinds[e.kind].runs += 1; st.reads += r.reads;
      if (r.pass) { st.pass += 1; st.kinds[e.kind].pass += 1; }
      if (r.whole) st.whole += 1;
      if (r.alone) st.alone += 1;
      if (!r.strict) st.notStrict += 1;
      if (!r.pass && !r.classes.length) r.classes.push('unexplained');
      for (const c of r.classes) {
        st.classes[c] = (st.classes[c] || 0) + 1;
        if (IN_PLACE.includes(e.kind)) st.inPlace[c] = (st.inPlace[c] || 0) + 1;
        const list = st.examples[c] || (st.examples[c] = []);
        if (list.length < (report ? 6 : 3)) list.push(`${e.kind}: ${JSON.stringify(md.slice(0, 400))} -> ${JSON.stringify(r.out.slice(0, 400))}`);
      }
    }
  }
  editStats[name] = st;
  const pct = (100 * st.pass / st.runs).toFixed(2);
  st.line = `${name}: ${st.pass} of ${st.runs} (${pct}%)`;
  test(`one-block edits, ${name}: every run passes or is of a known class (${st.pass} of ${st.runs}, ${pct}%)`, () => {
    assert.equal(st.classes.unexplained || 0, 0, `${st.classes.unexplained} unexplained:${(st.examples.unexplained || []).map((u) => `\n    ${u}`).join('')}`);
    assert.ok(st.pass / st.runs >= 0.98, `only ${pct}% pass`);
  });
  test(`one-block edits, ${name}: typing in a block changes no character outside it, and fails only where the serialiser cannot write the edit`, () => {
    assert.equal(st.notStrict, 0, `${st.notStrict} runs changed a character outside the edited block`);
    assert.deepEqual(Object.keys(st.inPlace).filter((c) => c !== 'serialiser'), []);
    const runs = IN_PLACE.reduce((a, k) => a + st.kinds[k].runs, 0);
    assert.ok((st.inPlace.serialiser || 0) <= Math.ceil(runs / 500), `${st.inPlace.serialiser} of ${runs} typing runs cannot be written`);
  });
  test(`one-block edits, ${name}: the whole text is never written again`, () => { assert.equal(st.whole, 0); });
}

// ---- 5. the accepted changes -----------------------------------------------------------------------------------------------------
test('accepted changes: an edited block is written exactly as the serialiser writes that block alone', () => {
  let n = 0;
  for (const md of SETS[0][1].concat(sourceForm.slice(0, 100))) {
    const { doc, table } = read(md);
    for (const e of edits(doc)) {
      if (!IN_PLACE.includes(e.kind)) continue;
      const r = write(e.doc, table);
      const j = e.from.indexOf(-1);
      const b = r.blocks.find((x) => x.index === j);
      const block = e.doc.child(j);
      const alone = N.doc.create(null, [block]);
      const forms = isList(block) ? [null, '-', '*', '+', '.', ')'].map((mark) => S(alone, mark ? { before: { kind: block.type.name, mark } } : null)) : [S(alone)];
      assert.ok(forms.some((f) => f === `${r.text.slice(b.from, b.to)}\n`), `${e.kind} in ${JSON.stringify(md.slice(0, 120))}: wrote ${JSON.stringify(r.text.slice(b.from, b.to))}`);
      assert.equal(b.entry, -1);
      n += 1;
    }
  }
  assert.ok(n > 300, `only ${n} edits`);
});

// ---- 6. the hostile corpus -------------------------------------------------------------------------------------------------------
const linksOf = (doc) => { const out = []; doc.descendants((x) => { for (const m of x.marks) if (m.type === M.link) out.push(m.attrs.href); return true; }); return out; };
let hostileCount = 0;
for (const [what, md] of HOSTILE) {
  test(`hostile: ${what}`, () => {
    const { doc, table } = read(md);
    const allowed = linksOf(doc);
    for (const e of edits(doc)) {
      const r = write(e.doc, table);
      const back = P(r.text);
      back.check();
      for (const href of linksOf(back)) assert.ok(/^(https?:\/\/|mailto:)/.test(href) && L.dlRichHref(href) === href && allowed.includes(href), `${e.kind}: a link to ${href}`);
      assert.equal(r.whole, false, `${e.kind}: the whole text was written again`);
      e.from.forEach((old, j) => { // nothing kept is dropped or altered: every stored block still there stands word for word
        if (old < 0) return;
        const b = (r.blocks || []).find((x) => x.index === j);
        assert.ok(b && r.text.slice(b.from, b.to) === table.entries[old].text, `${e.kind}: the block ${JSON.stringify(table.entries[old].text.slice(0, 80))} was not kept word for word`);
      });
      const can = readsAs(S(e.doc), e.doc); // a raw piece that was raw only through a definition now gone cannot be written at all
      assert.equal(readsAs(r.text, e.doc), can, `${e.kind}: reads back differently: ${JSON.stringify(r.text.slice(0, 300))}`);
      assert.equal(r.same, can);
    }
  });
  hostileCount += 1;
}

// ---- 7. time and bounds ----------------------------------------------------------------------------------------------------------
// Two kinds of text: every corpus case one after another (dense: many small blocks, every kind of mark), and plain prose
// (headings, long paragraphs with a few marks and links, short lists), which is what a text of this size mostly is.
const pool = CASES.map((c) => c[1].replace(/\n+$/, '')).filter((s) => s && s.length < 2000);
const dense = (size) => { let text = ''; for (let i = 0; text.length < size; i += 1) text += `${pool[i % pool.length]}\n\n`; return L.dlCleanText(text); };
const PROSE = 'The party reached the **old mill** at dusk, and [the map](https://example.com/map) showed a path along the river that none of them had walked before. They made camp, set a watch, and argued about the bridge until the fire burned low and the *wind* turned cold. ';
const prose = (size) => { let text = ''; for (let i = 0; text.length < size; i += 1) text += i % 8 === 0 ? `Session ${i / 8 + 1}\n---------\n\n` : i % 8 === 5 ? '* loot: 40 gold\n* a `silver` key\n* [ ] ask the miller\n\n' : `${PROSE}${PROSE}\n\n`; return text; };
const times = [];
for (const [kind, make, size] of [['prose', prose, 56000], ['prose', prose, 142000], ['dense', dense, 56000], ['dense', dense, 142000]]) {
  test(`time: ${size.toLocaleString('en')} characters (${kind}): read, then the text after one edit`, () => {
    const md = make(size);
    const [made, msRead] = median(() => read(md));
    const { doc, table } = made;
    const mid = kids(doc).findIndex((k, i) => i > doc.childCount / 2 && k.b.type === N.paragraph);
    const edited = typeIn(doc, mid, ' zq');
    const [r, msWrite] = median(() => write(edited, table));
    const [, msSame] = median(() => write(doc, table));
    const [, msAgain] = median(() => write(P(md), table), 3);
    const [, msMove] = median(() => write(moveTo(doc, 0, doc.childCount - 1), table), 3);
    assert.deepEqual([r.same, r.whole, r.alone, r.reads], [true, false, 0, 1]);
    const b = r.blocks.find((x) => x.index === mid);
    const old = table.entries[mid];
    assert.ok(r.text.slice(0, b.from) === md.slice(0, old.from) && r.text.slice(b.to) === md.slice(old.from + old.text.length), 'a character outside the edited block changed');
    times.push(`${md.length.toLocaleString('en')} characters, ${kind}, ${doc.childCount} blocks: read ${msRead.toFixed(1)} ms; the text after typing in one block ${msWrite.toFixed(1)} ms (matching, writing and one read back); unchanged ${msSame.toFixed(3)} ms; unchanged but read again ${msAgain.toFixed(1)} ms; after a move ${msMove.toFixed(1)} ms`);
    assert.ok(msWrite < 1500 && msRead < 1500 && msSame < 50, times[times.length - 1]);
  });
}
const quick = (name, limit, fn) => test(`bounds: ${name}`, () => { const [, ms] = timed(fn); times.push(`${name}: ${ms.toFixed(0)} ms`); assert.ok(ms < limit, `${ms.toFixed(0)} ms`); });
quick('149,000 characters in 20,000 blocks: one edit, the blocks in reverse, one block taken out of the middle', 6000, () => {
  const md = Array.from({ length: 20000 }, (x, i) => `p${i}`).join('\n\n');
  const { doc, table } = read(md);
  assert.ok(md.length > 148000 && md.length < L.DL.sizeMax && doc.childCount === 20000, `${md.length} characters, ${doc.childCount} blocks`);
  const a = write(typeIn(doc, 12000, ' zq'), table);
  assert.deepEqual([a.same, a.reads, a.text.length], [true, 1, md.length + 3]);
  const b = write(doc.copy(PM.Fragment.from(kids(doc).map((k) => k.b).reverse())), table);
  assert.deepEqual([b.same, b.whole, b.alone, b.reads], [true, false, 0, 1]);
  const again = write(doc.copy(PM.Fragment.from(kids(P(md)).map((k) => k.b).reverse())), table); // equal nodes, none the very node
  assert.equal(again.text, b.text);
  const c = write(deleteAt(doc, 12000), table);
  assert.deepEqual([c.same, c.reads], [true, 1]);
});
quick('12,000 blocks all alike, and 2,000 that differ only in their last words: read again, reversed, one taken out', 6000, () => {
  for (const md of [`${'same words\n\n'.repeat(12000)}`, Array.from({ length: 2000 }, (x, i) => `${'the same first words of a block '.repeat(2)}${i}`).join('\n\n')]) {
    const { doc, table } = read(md);
    assert.ok(doc.childCount >= 2000);
    assert.equal(write(P(md), table).text, md);
    const fresh = P(md);
    const r = write(fresh.copy(PM.Fragment.from(kids(fresh).map((k) => k.b).reverse())), table);
    assert.equal(r.same, true);
    assert.equal(write(deleteAt(fresh, 1000), table).same, true);
  }
});
quick('long runs of line breaks (100,000 in a code block, in a raw block, between blocks): read, write, edit', 4000, () => {
  for (const md of [`\`\`\`\n${'\n'.repeat(100000)}x\n\`\`\`\n\nend\n`, `<pre>${'\n'.repeat(100000)}x</pre>\n\nend\n`, `a${'\n'.repeat(100000)}b\n`, `a\n\n\`\`\`\n${'\n'.repeat(100000)}`]) {
    const { doc, table } = read(md);
    assert.equal(write(doc, table).text, md);
    const r = write(typeIn(doc, doc.childCount - 1, doc.lastChild.type === N.code_block ? 'zq' : ' zq'), table);
    assert.equal(r.same, true);
    assert.equal(S(doc).length > 0, true);
  }
});
quick('2,000,000 characters: held whole, handed back exactly, and written after an edit', 4000, () => {
  const huge = '<script>alert(1)</script>\n[x](javascript:alert(1))\n'.repeat(40000).slice(0, 1999999) + '\n';
  const { doc, table } = read(huge);
  assert.equal(doc.childCount, 1);
  assert.equal(table.entries.length, 1);
  assert.equal(write(doc, table).text, huge);
  assert.equal(write(P(huge), table).text, huge);
  const r = write(typeIn(doc, 0, ' zq'), table);
  assert.equal(r.text, `${huge.slice(0, -1)} zq\n`);
  assert.deepEqual([r.same, r.over, r.reads], [true, true, 1]);
  const after = write(insertAt(doc, 1, para('new')), table); // a block after a text held whole is read as part of it
  assert.ok(after.text.startsWith(huge.slice(0, -1)) && after.text.endsWith('new\n'));
  assert.deepEqual([after.same, after.over, after.reads], [false, true, 1]);
  const full = read(`${'word '.repeat(29999)}word\n`); // 150,000 characters: one more and the reader holds the text whole
  assert.equal(full.table.text.length, L.DL.sizeMax);
  const grown = write(typeIn(full.doc, 0, ' zq'), full.table);
  assert.deepEqual([grown.text.length, grown.same, grown.over, grown.whole, grown.reads], [L.DL.sizeMax + 3, false, true, false, 1]);
});

// ---- the report ------------------------------------------------------------------------------------------------------------------
for (const [name, st] of Object.entries(editStats)) {
  say(`\n== one-block edits, ${st.line}; ${st.docs} documents; whole-text rewrites ${st.whole}; runs with a kept block written again alone ${st.alone}; read-backs ${(st.reads / st.runs).toFixed(3)} a run`);
  for (const k of KINDS) say(`   ${k.padEnd(20)} ${String(st.kinds[k].pass).padStart(6)} of ${String(st.kinds[k].runs).padStart(6)}  ${st.kinds[k].runs ? (100 * st.kinds[k].pass / st.kinds[k].runs).toFixed(2) : '-'}%`);
  say(`   not passed, by class: ${Object.entries(st.classes).map(([c, n]) => `${c} ${n}`).join(', ') || 'none'}`);
  for (const [c, list] of Object.entries(st.examples)) for (const x of list) say(`     ${c}: ${x}`);
}
say('');
for (const t of times) say(`   ${t}`);
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const summary = `open-then-Done exact ${Object.entries(exact).map(([k, [a, b]]) => `${k} ${a}/${b}`).join(', ')}; one-block edits ${Object.values(editStats).map((s) => s.line).join(', ')}; whole-text rewrites ${Object.values(editStats).reduce((a, s) => a + s.whole, 0)}; hostile ${hostileCount}`;
if (fails.length) { console.error(`documents rich write: ${fails.length} failed, ${passed} passed (${summary})`); for (const f of fails) console.error(`  - ${f}`); process.exit(1); }
console.log(`documents rich write: ${passed} tests passed in ${secs} s (${summary})`);
