#!/usr/bin/env node
/*
 * check-documents-lib.mjs -- the pure library (modules/documents/src/documents-lib-*.js): record cleaning, chunk split and join,
 * the lock rules, the reader (hand-made token lists, a fake DOM), the Markdown export, the formatting bar, and a hostile corpus
 * for the link allow-list and the sanitisers. No page, no host, no network.
 * Usage: node modules/documents/test/check-documents-lib.mjs [path to the src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/documents/src'));
const files = fs.readdirSync(src).filter((f) => /^documents-lib-[a-z]-.*\.js$/.test(f)).sort();
const code = files.map((f) => fs.readFileSync(path.join(src, f), 'utf8')).join('\n');
const NAMES = ['DL', 'dlCleanText', 'dlTrimBreaks', 'dlCleanLine', 'dlCut', 'dlCleanDoc', 'dlCleanChunk', 'dlCleanLock', 'dlNewId', 'dlSplit', 'dlJoin',
  'dlPlanChunks', 'dlDroppedChunks', 'dlLeftoverChunks', 'dlExcerpt', 'DL_LOCK', 'dlLockSeenAt', 'dlLockStale', 'dlLockTakePlan',
  'dlLockTakeResult', 'dlLockRefreshResult', 'dlLockNext', 'dlLockHear', 'dlLockEditState', 'dlSafeAddress', 'dlDescribe', 'dlBuild',
  'dlObjectLinks', 'dlDescribedText', 'dlDecodeText', 'dlEscapeLabel', 'DL_MARKED_MATH', 'DL_MARKED_HOOKS', 'dlPlain', 'dlExportMarkdown', 'dlExportName', 'dlCleanTrash', 'dlTrashKey', 'dlTrashExpired', 'dlBold', 'dlItalic', 'dlCode', 'dlList', 'dlNumbered', 'dlChecklist', 'dlQuote',
  'dlHeading', 'dlLink', 'dlObjectLink', 'dlGrid', 'dlFormula',
  'DL_SAVE', 'dlPlanSave', 'dlIsDirty', 'dlCommitResult', 'dlAutosaveDelay', 'dlWriteWait', 'dlSaveWord',
  'DL_PAPERS', 'DL_PAPER_DEFAULT', 'dlCleanPaper', 'dlPaperMenuModel', 'dlContrast', 'dlInkFor', 'dlHexRgb',
  'dlPreview', 'dlCleanPreview', 'dlThumbText', 'DL_LISTVIEWS', 'dlCleanListView', 'DL_EDITVIEWS', 'dlEditViewId', 'dlEditViewIsRich',
  'dlTagsKey', 'dlCleanTagIds', 'dlCleanTags', 'dlKnownTagIds', 'dlTagsDelta', 'dlTagsApply', 'dlTagsCommit', 'dlTagCounts', 'dlTagsMatch', 'DL_TAGS_MAX',
  'dlResyncPlan', 'dlResyncAfterHidden', 'DL_VIEW', 'dlCleanView', 'dlViewStore', 'dlViewRead', 'dlViewLabel', 'dlViewSheet', 'dlViewStep', 'dlViewKey',
  'dlCleanLayout', 'dlCleanPageSize', 'dlCleanPageNumbers', 'dlCleanPage', 'dlSamePage', 'DL_PAGE_SIZES', 'dlPageGeometry', 'DL_PAGE_FIT_MAX', 'dlPageFit', 'DL_PAGE_FLOOR', 'dlPaperNarrow', 'dlThumbPreview', 'DL_LAYOUTS', 'dlPageMenuModel', 'dlPageBreak', 'DL_PAGE_BREAK_LINE', 'dlPageBreaks',
  'DL_ACTIONS', 'dlTextareaEditor', 'dlStubEditor', 'dlEditorDirty', 'dlEditorSnapshot'];
const L = new Function(`${code}\nreturn { ${NAMES.join(', ')} };`)();
const markedLib = createRequire(import.meta.url)(path.join(src, 'documents-lib-0-marked.js'));
const reader = new markedLib.Marked({ gfm: true, extensions: [L.DL_MARKED_MATH], hooks: L.DL_MARKED_HOOKS });
const lex = (m) => reader.lexer(m);
let passed = 0;
const fails = [];
const pending = [];
function test(name, fn) { try { const r = fn(); if (r && typeof r.then === 'function') pending.push(r.then(() => { passed += 1; }, (err) => { fails.push(`${name}: ${err.message}`); })); else passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

const doc = { id: 'abcd1234', type: 'doc', title: 'Plan', rev: 2, chunks: ['aaaa1111'], size: 10, excerpt: 'Hi', paper: 'light-white', layout: 'fluid', pageSize: 'letter', pageNumbers: false, by: 'u1', at: '2026-11-11T10:00:00.000Z', editedBy: 'u1', editedByName: 'Ana', editedAt: '2026-11-11T10:00:00.000Z' };
const lock = { id: 'lock', type: 'lock', doc: 'abcd1234', holder: 'u1', name: 'Ana', at: '2026-11-11T10:00:00.000Z', seq: 1, by: 'u1' };

test('the library has no page, host or Documents words', () => {
  assert.ok(!/\b(host|document)\.|\b(innerHTML|insertAdjacentHTML|outerHTML)\b/.test(code.replace(/\/\/.*$/gm, '')), 'a forbidden word');
  assert.ok(!/documents?\b/i.test(code.replace(/\/\/.*$/gm, '')), 'a Documents word');
});
test('preview: short text kept, long text cut at a line boundary within 400', () => {
  assert.equal(L.dlPreview('# Hi\n\nText'), '# Hi\n\nText');
  const long = `${'word '.repeat(18)}\n`.repeat(10);
  const p = L.dlPreview(long);
  assert.ok(p.length <= 400 && p.length > 300 && !p.endsWith('\n') && long.startsWith(p));
  assert.equal(L.dlPreview('x'.repeat(900)).length, 400); // no line break: cut at 400
});
test('preview: never splits a surrogate pair', () => {
  const p = L.dlPreview('a'.repeat(399) + '\u{1F600}'.repeat(5));
  assert.equal(p.length, 399);
  assert.ok(!/[\ud800-\udbff]$/.test(L.dlPreview('a'.repeat(398) + '\u{1F600}\u{1F600}')));
});
test('line breaks at the end of a text are taken off in one pass, however long a run of them stands in the middle', () => {
  assert.equal(L.dlTrimBreaks('a\n\nb\n\n\n'), 'a\n\nb');
  assert.equal(L.dlTrimBreaks('a \n'), 'a ');
  assert.equal(L.dlTrimBreaks('\n\n'), '');
  assert.equal(L.dlTrimBreaks(''), '');
  const md = `<pre>${'\n'.repeat(100000)}x</pre>\n`; // /\n+$/ took seconds on this
  const s = Date.now();
  const desc = L.dlDescribe(md, lex);
  assert.ok(Date.now() - s < 1000, `${Date.now() - s} ms`);
  assert.deepEqual(desc.map((b) => [b.t, b.v.length]), [['source', md.length - 1]]);
});
test('preview: invisible and control characters out', () => {
  assert.equal(L.dlPreview('a\u202eb\u200bc\u0000d\r\ne'), 'abcd\ne');
});
test('preview: hostile text stays text (the reader makes it safe), and is capped on reading', () => {
  const hostile = '<img src=x onerror=alert(1)>\n[x](javascript:alert(1))\n' + 'z'.repeat(1e6);
  const rec = L.dlCleanDoc({ ...doc, preview: hostile });
  assert.ok(rec.preview.length <= 400 && rec.preview.includes('<img'));
  const desc = L.dlDescribe(rec.preview, (md) => [{ type: 'html', raw: '<img src=x onerror=alert(1)>' }, { type: 'paragraph', raw: '', tokens: [{ type: 'link', href: 'javascript:alert(1)', text: 'x', raw: '[x](javascript:alert(1))', tokens: [] }] }]);
  assert.ok(!JSON.stringify(desc).includes('"href"') && desc[0].t === 'source');
});
test('preview: not trusted from a record: wrong type, none, or too big', () => {
  assert.equal(L.dlCleanDoc({ ...doc, preview: 5 }).preview, undefined);
  assert.equal(L.dlCleanDoc({ ...doc, preview: { a: 1 } }).preview, undefined);
  assert.equal(L.dlCleanDoc(doc).preview, undefined);
  assert.equal(L.dlCleanDoc({ ...doc, preview: '\u202e\u200b' }).preview, undefined);
  assert.ok(L.dlCleanDoc({ ...doc, preview: 'q'.repeat(5e6) }).preview.length === 400);
});
test('preview: a record without one shows its excerpt; a save writes one', () => {
  assert.equal(L.dlThumbText(L.dlCleanDoc(doc)), 'Hi');
  assert.equal(L.dlThumbText({ preview: 'P', excerpt: 'E' }), 'P');
  assert.equal(L.dlThumbText(null), '');
  const plan = L.dlPlanSave({ old: [{ id: 'aaaa1111', text: 'x' }], text: '# T\n\nbody', title: 'Plan', rec: doc, me: 'u1', name: 'Ana', now: '2026-11-11T11:00:00.000Z', fresh: () => 'bbbb2222', lex });
  assert.equal(plan.record.preview, '# T\n\nbody');
});
test('list view: only thumbs is thumbs; two options with icons', () => {
  assert.equal(L.dlCleanListView('thumbs'), 'thumbs');
  for (const v of ['list', '', null, undefined, 'x', 3, {}]) assert.equal(L.dlCleanListView(v), 'list');
  assert.deepEqual(L.DL_LISTVIEWS.map((o) => o.id), ['list', 'thumbs']);
  assert.ok(L.DL_LISTVIEWS.every((o) => o.icon && o.label));
});
test('the editor switch: Markdown first, then Rich text, each with an icon and a word; only rich is rich', () => {
  assert.deepEqual(L.DL_EDITVIEWS.map((o) => [o.id, o.label, o.icon]), [['markdown', 'Markdown', 'hashtag'], ['rich', 'Rich text', 'align-left']]);
  assert.equal(L.dlEditViewId(true), 'rich');
  assert.equal(L.dlEditViewId(false), 'markdown');
  assert.equal(L.dlEditViewIsRich('rich'), true);
  for (const v of ['markdown', '', null, undefined, 'x', 1, true, {}]) assert.equal(L.dlEditViewIsRich(v), false);
  assert.ok(Object.isFrozen(L.DL_EDITVIEWS));
});

// ---- the page's layout: Fluid or Paper, the page size, the numbers (plan-documents-paper-layout.md, step 1)
test('layout fields: cleaned on reading; a missing one reads as Fluid, Letter, no numbers', () => {
  const bare = { ...doc }; delete bare.layout; delete bare.pageSize; delete bare.pageNumbers;
  const r = L.dlCleanDoc(bare);
  assert.deepEqual([r.layout, r.pageSize, r.pageNumbers], ['fluid', 'letter', false]);
  const paper = L.dlCleanDoc({ ...doc, layout: 'paper', pageSize: 'a4', pageNumbers: true });
  assert.deepEqual([paper.layout, paper.pageSize, paper.pageNumbers], ['paper', 'a4', true]);
  for (const v of ['Paper', 'PAPER', 'page', '', 5, null, {}, [], 'paper;x', true]) assert.equal(L.dlCleanDoc({ ...doc, layout: v }).layout, 'fluid', JSON.stringify(v));
  for (const v of ['A4', 'legal', '', 5, null, {}, 'a4;x']) assert.equal(L.dlCleanDoc({ ...doc, pageSize: v }).pageSize, 'letter', JSON.stringify(v));
  for (const v of ['true', 1, 'yes', null, {}, [], 'on']) assert.equal(L.dlCleanDoc({ ...doc, pageNumbers: v }).pageNumbers, false, JSON.stringify(v));
  assert.equal(L.dlCleanDoc({ ...doc, size: 10 }).size, 10); // size is still the text's length
  assert.deepEqual(L.dlCleanPage(undefined), { layout: 'fluid', pageSize: 'letter', pageNumbers: false });
});
test('layout fields: a save carries them, and a change makes the page dirty (the page colour\'s path)', () => {
  const base = { old: [{ id: 'aaaa1111', text: 'Hi' }], text: 'Hi', title: 'Plan', rec: doc, me: 'u1', name: 'Ana', now: '2026-11-11T11:00:00.000Z', fresh: () => 'bbbb2222', lex };
  const same = L.dlPlanSave(base).record;
  assert.deepEqual([same.layout, same.pageSize, same.pageNumbers], ['fluid', 'letter', false]);
  const set = L.dlPlanSave({ ...base, page: { layout: 'paper', pageSize: 'a4', pageNumbers: true } }).record;
  assert.deepEqual([set.layout, set.pageSize, set.pageNumbers, set.rev, set.size], ['paper', 'a4', true, 3, 2]);
  assert.deepEqual(L.dlCleanDoc(set), set); // the record cleans to itself
  assert.equal(L.dlPlanSave({ ...base, page: { layout: 'bogus', pageSize: 'x', pageNumbers: 'y' } }).record.layout, 'fluid');
  const a = { text: 'a', title: 't', paper: 'p' };
  assert.equal(L.dlIsDirty(a, { ...a }), false);
  assert.equal(L.dlIsDirty({ ...a, page: L.dlCleanPage(null) }, { ...a, page: L.dlCleanPage(null) }), false);
  assert.equal(L.dlIsDirty({ ...a, page: L.dlCleanPage(null) }, { ...a, page: { layout: 'paper', pageSize: 'letter', pageNumbers: false } }), true);
  assert.equal(L.dlIsDirty({ ...a, page: L.dlCleanPage(null) }, { ...a, page: { layout: 'fluid', pageSize: 'a4', pageNumbers: false } }), true);
  assert.equal(L.dlIsDirty({ ...a, page: L.dlCleanPage(null) }, { ...a, page: { layout: 'fluid', pageSize: 'letter', pageNumbers: true } }), true);
  const e = L.dlStubEditor('x');
  const saved = { text: 'x', title: 'T', paper: 'p', page: L.dlCleanPage(null) };
  assert.equal(L.dlEditorDirty(e, e.revision(), saved, 'T', 'p', L.dlCleanPage(null)), false);
  assert.equal(L.dlEditorDirty(e, e.revision(), saved, 'T', 'p', { layout: 'paper' }), true);
  const snap = L.dlEditorSnapshot(e, saved, 'T', 'p', { layout: 'paper' });
  assert.equal(snap.changed, true);
  assert.equal(snap.page.layout, 'paper');
  assert.equal(L.dlEditorSnapshot(e, saved, 'T', 'p', L.dlCleanPage(null)).changed, false);
});
test('page sizes: Letter 816 by 1056, A4 794 by 1123, one inch margins; one place', () => {
  const l = L.dlPageGeometry('letter');
  assert.deepEqual([l.w, l.h, l.margin, l.textW, l.textH, l.atPage], [816, 1056, 96, 624, 864, '8.5in 11in']);
  const a = L.dlPageGeometry('a4');
  assert.deepEqual([a.w, a.h, a.margin, a.textW, a.textH, a.atPage], [794, 1123, 96, 602, 931, '210mm 297mm']);
  for (const v of ['', 'legal', null, undefined, 5]) assert.equal(L.dlPageGeometry(v).w, 816);
  assert.deepEqual(Object.keys(L.DL_PAGE_SIZES), ['letter', 'a4']);
  assert.ok(Object.isFrozen(L.DL_PAGE_SIZES) && Object.isFrozen(L.DL_PAGE_SIZES.a4));
  assert.equal(L.dlPageFit(408, 816), 0.5);
  assert.equal(L.dlPageFit(816, 816), 1);
  assert.equal(L.dlPageFit(5000, 816), 2); // never more than 200%
  for (const v of [0, -1, NaN, undefined]) assert.equal(L.dlPageFit(v, 816), 1);
});
test('the narrow floor and the Paper tile preview', () => {
  assert.equal(L.DL_PAGE_FLOOR, 0.6);
  assert.equal(L.dlPaperNarrow(500, 816, false), false); // 490 is the floor
  assert.equal(L.dlPaperNarrow(489, 816, false), true);
  assert.equal(L.dlPaperNarrow(495, 816, true), true); // inside the hysteresis: stays Fluid
  assert.equal(L.dlPaperNarrow(498, 816, true), false);
  assert.equal(L.dlPaperNarrow(477, 794, false), false);
  assert.equal(L.dlPaperNarrow(476, 794, false), true);
  for (const v of [0, NaN, undefined]) assert.equal(L.dlPaperNarrow(v, 816, true), true);
  assert.equal(L.dlThumbPreview('One\n\nTwo\n\n_ _ _\n\nThree'), 'One\n\nTwo');
  assert.equal(L.dlThumbPreview('No break'), 'No break');
  assert.equal(L.dlThumbPreview('_ _ _\nAfter'), '');
});
test('the layout switch: Fluid then Paper, each with an icon and a word, icons not used by the other switches', () => {
  assert.deepEqual(L.DL_LAYOUTS.map((o) => [o.id, o.label, o.icon]), [['fluid', 'Fluid', 'align-justify'], ['paper', 'Paper', 'file']]);
  const others = [...L.DL_LISTVIEWS, ...L.DL_EDITVIEWS].map((o) => o.icon);
  for (const o of L.DL_LAYOUTS) assert.ok(!others.includes(o.icon));
  assert.ok(Object.isFrozen(L.DL_LAYOUTS));
  assert.equal(L.dlCleanLayout('paper'), 'paper');
  assert.equal(L.dlCleanLayout('fluid'), 'fluid');
});
test('the Page menu: the size pair (the current one marked), the numbers entry (marked when on), no page break (it is in Insert)', () => {
  const m = L.dlPageMenuModel({ layout: 'paper', pageSize: 'a4', pageNumbers: true });
  assert.deepEqual(m.filter((x) => x.kind === 'size').map((x) => [x.label, x.current]), [['Letter', false], ['A4', true]]);
  assert.deepEqual(m.filter((x) => x.kind === 'numbers').map((x) => [x.label, x.current]), [['Page numbers', true]]);
  assert.ok(!m.some((x) => x.kind === 'break'));
  const d = L.dlPageMenuModel(null);
  assert.deepEqual(d.filter((x) => x.kind === 'size').map((x) => x.current), [true, false]);
  assert.equal(d.find((x) => x.kind === 'numbers').current, false);
});

// ---- the manual page break (step 2): `_ _ _` as a top-level rule line of its own
test('reader: a top-level `_ _ _` rule is a page break; every other rule stays a rule', () => {
  const kinds = (md) => L.dlDescribe(md, lex).map((b) => b.t);
  assert.deepEqual(kinds('a\n\n_ _ _\n\nb\n'), ['paragraph', 'pagebreak', 'paragraph']);
  assert.deepEqual(kinds('_ _ _'), ['pagebreak']);
  assert.deepEqual(kinds('_ _ _\n\n\n\n'), ['pagebreak']);
  assert.deepEqual(kinds('a\n_ _ _\nb'), ['paragraph', 'pagebreak', 'paragraph']);
  assert.deepEqual(kinds('_ _ _\n\n_ _ _\n'), ['pagebreak', 'pagebreak']);
  for (const other of ['---', '***', '___', '_ _ _ _', '_  _  _', '__ _ _', '* * *', '- - -', ' _ _ _', '_ _ _ ', '\\_ _ _']) {
    assert.ok(!kinds(`a\n\n${other}\n\nb`).includes('pagebreak'), JSON.stringify(other));
  }
  assert.deepEqual(kinds('---\n\n***\n\n___'), ['rule', 'rule', 'rule']);
  // inside a list or a quote it is an ordinary rule
  const inQuote = L.dlDescribe('> a\n>\n> _ _ _\n', lex);
  assert.deepEqual(inQuote[0].c.map((b) => b.t), ['paragraph', 'rule']);
  const inList = L.dlDescribe('- a\n\n  _ _ _\n\n  b\n', lex);
  assert.deepEqual(inList[0].items[0].c.map((b) => b.t), ['paragraph', 'rule', 'paragraph']);
  assert.ok(!JSON.stringify(L.dlDescribe('> > - _ _ _\n', lex)).includes('pagebreak'));
  // inside a code block it is words
  assert.deepEqual(kinds('```\n_ _ _\n```'), ['codeblock']);
  assert.deepEqual(kinds('    _ _ _'), ['codeblock']);
});
test('the Markdown box: Page break puts `_ _ _` on a line of its own after the block with the caret', () => {
  const at = (value, start, end) => L.dlPageBreak({ value, start, end });
  assert.equal(L.DL_PAGE_BREAK_LINE, '_ _ _');
  assert.equal(at('', 0).value, '_ _ _');
  assert.equal(at('a\n', 1).value, 'a\n\n_ _ _\n');
  assert.equal(at('a\n\nb\n', 0).value, 'a\n\n_ _ _\n\nb\n');
  assert.equal(at('a\nb\n\nc\n', 2).value, 'a\nb\n\n_ _ _\n\nc\n');
  assert.equal(at('abc', 3).value, 'abc\n\n_ _ _');
  assert.equal(at('```\nx\n\ny\n```\n\nz\n', 5).value, '```\nx\n\ny\n```\n\n_ _ _\n\nz\n'); // not inside a fence
  const out = at('a\n\nb\n', 0);
  assert.equal(out.start, out.end);
  assert.equal(out.value.slice(0, out.start), 'a\n\n_ _ _');
  assert.deepEqual(L.dlDescribe(out.value, lex).map((b) => b.t), ['paragraph', 'pagebreak', 'paragraph']);
  assert.ok(L.DL_ACTIONS.includes('pagebreak'));
  const e = L.dlStubEditor('a\n');
  e.run('pagebreak');
  assert.equal(e.getText(), 'a\n[pagebreak]');
});
test('doc record: good kept, unknown dropped', () => {
  assert.deepEqual(L.dlCleanDoc({ ...doc, extra: 1 }), doc);
});
test('doc record: limits', () => {
  const bad = [null, 5, [], { ...doc, type: 'x' }, { ...doc, id: 'ABC' }, { ...doc, id: 'abc' }, { ...doc, id: 'a'.repeat(17) }, { ...doc, title: '' }, 
    { ...doc, title: 5 }, { ...doc, rev: 0 }, { ...doc, rev: 1.5 }, { ...doc, chunks: [] }, { ...doc, chunks: Array.from({ length: 7 }, (_, i) => `aaaaaaa${i}`) },
    { ...doc, chunks: ['aaaa111'] }, { ...doc, chunks: ['AAAA1111'] }, { ...doc, chunks: ['aaaa1111', 'aaaa1111'] }, { ...doc, size: 150001 }, { ...doc, size: -1 },
    { ...doc, by: 'a b' }, { ...doc, at: 'soon' }, { ...doc, editedAt: 5 }, { ...doc, excerpt: 'x'.repeat(601) }];
  for (const v of bad) assert.equal(L.dlCleanDoc(v), null, JSON.stringify(v).slice(0, 80));
  assert.equal(L.dlCleanDoc({ ...doc, title: 'a'.repeat(120) }).title.length, 120);
  assert.equal(L.dlCleanDoc({ ...doc, title: 'a'.repeat(121) }).title.length, 120);
  assert.equal(L.dlCleanDoc({ ...doc, chunks: Array.from({ length: 6 }, (_, i) => `aaaaaaa${i}`) }).chunks.length, 6);
  assert.equal(L.dlCleanDoc({ ...doc, size: 150000 }).size, 150000);
});
test('doc record: strings cleaned, excerpt and name cut', () => {
  const c = L.dlCleanDoc({ ...doc, title: '  A\u202eB\u200b\tC\n ', editedByName: 'N'.repeat(60), excerpt: 'e'.repeat(400) });
  assert.equal(c.title, 'AB C');
  assert.equal(c.editedByName.length, 40);
  assert.equal(c.excerpt.length, 300);
});
test('chunk record', () => {
  const c = { id: 'bbbb2222', doc: 'abcd1234', text: 'hello' };
  assert.deepEqual(L.dlCleanChunk({ ...c, x: 1 }), c);
  for (const v of [null, {}, { ...c, text: 5 }, { ...c, id: 'B' }, { ...c, doc: 'x' }, { ...c, text: '"'.repeat(24000) }]) assert.equal(L.dlCleanChunk(v), null);
  assert.equal(L.dlCleanChunk({ ...c, text: 'a\u200bb\u0001c\r\nd' }).text, 'abc\nd');
  assert.ok(L.dlCleanChunk({ ...c, text: 'a'.repeat(47900) }));
});
test('lock record', () => {
  assert.deepEqual(L.dlCleanLock({ ...lock, extra: 1 }), lock);
  for (const v of [null, {}, { ...lock, id: 'x' }, { ...lock, type: 'x' }, { ...lock, doc: 'x' }, { ...lock, holder: '' }, { ...lock, holder: 'a b' }]) assert.equal(L.dlCleanLock(v), null);
  const c = L.dlCleanLock({ ...lock, name: '', seq: -3, at: 'x' });
  assert.deepEqual([c.name, c.seq, c.at], ['Someone', 0, '']);
});
test('trash record', () => {
  const t = { id: 'abcd1234', type: 'trash', doc, by: 'u1', name: 'Ana', at: '2026-11-11T10:00:00.000Z' };
  assert.deepEqual(L.dlCleanTrash({ ...t, extra: 1 }), t);
  for (const v of [null, {}, { ...t, id: 'zzzzzzzz' }, { ...t, doc: { ...doc, rev: 0 } }, { ...t, by: '' }, { ...t, at: 'x' }]) assert.equal(L.dlCleanTrash(v), null);
  assert.equal(L.dlTrashKey('abcd1234'), '_trash:abcd1234');
  assert.equal(L.dlTrashExpired(t, Date.parse(t.at) + 6.9 * 86400000), false);
  assert.equal(L.dlTrashExpired(t, Date.parse(t.at) + 7 * 86400000), true);
});
test('new ids match the pattern', () => {
  let n = 0;
  const id = L.dlNewId(() => (n++ % 10) / 10);
  assert.match(id, /^[a-z0-9]{8}$/);
  assert.match(L.dlNewId(() => 1), /^[a-z0-9]{8}$/);
});

// ---- chunks
test('split: empty, short, join round trip', () => {
  assert.deepEqual(L.dlSplit(''), { ok: true, chunks: [''] });
  assert.deepEqual(L.dlSplit('abc'), { ok: true, chunks: ['abc'] });
});
test('split: cuts at a blank line, then a line break, then a character', () => {
  const para = (c) => `${c.repeat(20000)}\n\n`;
  let r = L.dlSplit(para('a') + para('b') + para('c'));
  assert.ok(r.ok && r.chunks.length === 2 && r.chunks[0].endsWith('\n\n'), 'blank line');
  const line = (c) => `${c.repeat(20000)}\n`;
  r = L.dlSplit(line('a') + line('b') + line('c'));
  assert.ok(r.ok && r.chunks[0].endsWith('\n') && !r.chunks[0].endsWith('\n\n') && r.chunks.every((c) => c.length <= 48000), 'line break');
  const big = 'x'.repeat(100000);
  r = L.dlSplit(big);
  assert.ok(r.ok && r.chunks.length === 3 && L.dlJoin(r.chunks) === big, 'character');
});
test('split: each chunk record is within 48000 JSON characters, worst case quotes', () => {
  const t = '"\n'.repeat(60000);
  const r = L.dlSplit(t.slice(0, 100000));
  assert.ok(!r.ok && r.reason === 'long' || r.ok);
  const q = '"'.repeat(70000);
  const s = L.dlSplit(q);
  assert.ok(s.ok && s.chunks.length >= 3);
  for (const c of s.chunks) assert.ok(JSON.stringify({ id: 'x'.repeat(8), doc: 'x'.repeat(16), text: c }).length <= 48000);
  assert.equal(L.dlJoin(s.chunks), q);
});
test('split: never splits a surrogate pair', () => {
  const t = '\u{1F600}'.repeat(30000);
  const r = L.dlSplit(t);
  assert.ok(r.ok && r.chunks.length > 1);
  for (const c of r.chunks) { assert.ok(!/[\ud800-\udbff]$/.test(c) && !/^[\udc00-\udfff]/.test(c)); assert.ok(JSON.stringify({ id: 'x'.repeat(8), doc: 'x'.repeat(16), text: c }).length <= 48000); }
  assert.equal(L.dlJoin(r.chunks), t);
  const odd = 'a' + '\u{1F600}'.repeat(30000);
  assert.equal(L.dlJoin(L.dlSplit(odd).chunks), odd);
});
test('split: too long is refused', () => {
  assert.equal(L.dlSplit('a'.repeat(150001)).ok, false);
  assert.equal(L.dlSplit('a'.repeat(150000)).reason, undefined);
  const r = L.dlSplit('"'.repeat(150000)); // escaped, needs more than 6 chunks
  assert.deepEqual([r.ok, r.reason], [false, 'long']);
  assert.equal(L.dlSplit(5).ok, false);
});
test('plan: unchanged chunks keep their id and are not written', () => {
  let n = 0;
  const fresh = () => `new0000${n++}`;
  const p = L.dlPlanChunks([{ id: 'old00001', text: 'a' }, { id: 'old00002', text: 'b' }], ['a', 'B', 'c'], fresh);
  assert.deepEqual(p.map((x) => [x.id, x.write]), [['old00001', false], ['new00000', true], ['new00001', true]]);
  assert.deepEqual(L.dlDroppedChunks(['old00001', 'old00002'], ['old00001', 'new00000']), ['old00002']);
  assert.deepEqual(L.dlLeftoverChunks(['a'], ['a', 'z']), ['z']);
});
test('excerpt: plain, 300 characters', () => {
  assert.equal(L.dlExcerpt('| A | B |\n|:--|--:|\n| 1 | 2 |', lex), 'A B 1 2');
  assert.equal(L.dlExcerpt('# Title\n\n**bold** and [a link](https://x.y) `code`\n- [ ] task', lex), 'Title bold and a link code task');
  assert.equal(L.dlExcerpt('a'.repeat(400), lex).length, 300);
});

// ---- the lock
test('lock: stale rules', () => {
  const n = 1e6;
  assert.equal(L.dlLockStale(n - 34999, n), false);
  assert.equal(L.dlLockStale(n - 35000, n), true);
  assert.equal(L.dlLockStale(NaN, n), true);
  assert.equal(L.dlLockSeenAt(n, 5000), n - 5000);
  assert.equal(n - L.dlLockSeenAt(n, 99999), 35000 - 12000);
  assert.equal(L.dlLockSeenAt(n, undefined), L.dlLockSeenAt(n, 40000));
  assert.deepEqual([L.DL_LOCK.beat, L.DL_LOCK.stale, L.DL_LOCK.wait], [10000, 35000, 12000]);
});
test('lock: take plan', () => {
  const p = (o) => L.dlLockTakePlan({ canEdit: true, me: 'u2', rec: lock, fresh: true, mine: false, ...o });
  assert.equal(p({}), 'busy');
  assert.equal(p({ canEdit: false }), 'denied');
  assert.equal(p({ me: null }), 'denied');
  assert.equal(p({ rec: null }), 'take');
  assert.equal(p({ fresh: false }), 'take');
  assert.equal(p({ me: 'u1' }), 'other-window');
  assert.equal(p({ me: 'u1', mine: true }), 'take');
  assert.equal(L.dlLockTakeResult({ status: 409 }), 'busy');
  assert.equal(L.dlLockTakeResult({ status: 500 }), 'failed');
  assert.equal(L.dlLockRefreshResult({ status: 409 }), 'lost');
  assert.equal(L.dlLockRefreshResult({ status: 429 }), 'retry');
});
test('lock: next, hear, edit state', () => {
  assert.equal(L.dlLockNext('abcd1234', 'u1', 'Ana', 't', lock).seq, 2);
  assert.equal(L.dlLockNext('abcd1234', 'u1', 'Ana', 't', null).seq, 0);
  assert.equal(L.dlLockHear({ rec: { ...lock, holder: 'u2' }, fresh: true, me: 'u1', editing: true }), 'lost');
  assert.equal(L.dlLockHear({ rec: lock, fresh: true, me: 'u1', editing: true }), 'none');
  assert.equal(L.dlLockHear({ rec: { ...lock, holder: 'u2' }, fresh: true, me: 'u1', editing: false }), 'none');
  assert.equal(L.dlLockEditState({ canEdit: true, me: 'u2', rec: lock, fresh: true }).reason, 'Ana is editing this. You can read it as it changes.');
  assert.equal(L.dlLockEditState({ canEdit: true, me: 'u1', rec: lock, fresh: true }).reason, 'You are editing this in another window.');
  assert.equal(L.dlLockEditState({ canEdit: true, me: 'u1', rec: null }).enabled, true);
});

// ---- the reader
const T = (type, o = {}) => ({ type, raw: o.raw || o.text || '', ...o });
const txt = (s) => T('text', { text: s });
const fakeDoc = () => {
  const sinks = [];
  const node = (tag) => {
    const n = { tag, attrs: {}, kids: [], className: '', _t: '' };
    n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
    n.appendChild = (c) => { n.kids.push(c); return c; };
    n.removeChild = (c) => { n.kids = n.kids.filter((k) => k !== c); };
    Object.defineProperty(n, 'firstChild', { get: () => n.kids[0] || null });
    Object.defineProperty(n, 'textContent', { get: () => n._t + n.kids.map((k) => k.textContent).join(''), set: (v) => { n.kids = []; n._t = String(v); } });
    for (const s of ['innerHTML', 'outerHTML']) Object.defineProperty(n, s, { set: (v) => sinks.push(v), get: () => '' });
    n.insertAdjacentHTML = (p, v) => sinks.push(v);
    return n;
  };
  return { sinks, createElement: node, createTextNode: (v) => ({ tag: '#text', textContent: v, kids: [] }) };
};
const all = (n, out = []) => { out.push(n); (n.kids || []).forEach((k) => all(k, out)); return out; };
const render = (tokens, hooks) => { const d = fakeDoc(); const root = L.dlBuild(L.dlDescribe('x', () => tokens), d, hooks); return { root, d, nodes: all(root) }; };
const link = (href, text = 'go') => T('link', { href, text, raw: `[${text}](${href})`, tokens: [txt(text)] });
test('reader: a page break is a separator named "Page break", with no HTML set and no words in the excerpt', () => {
  const d = fakeDoc();
  const root = L.dlBuild(L.dlDescribe('a\n\n_ _ _\n\nb', lex), d);
  const sep = all(root).find((n) => n.attrs && n.attrs.role === 'separator');
  assert.ok(sep);
  assert.deepEqual([sep.tag, sep.className, sep.attrs['aria-label']], ['div', 'dl-pagebreak', 'Page break']);
  assert.equal(sep.kids[0].attrs['aria-hidden'], 'true');
  assert.equal(sep.textContent, 'Page break');
  assert.equal(d.sinks.length, 0);
  assert.equal(all(root).filter((n) => n.tag === 'hr').length, 0);
  assert.equal(L.dlDescribedText(L.dlDescribe('a\n\n_ _ _\n\nb', lex)).trim(), 'a b');
  assert.equal(L.dlExcerpt('a\n\n_ _ _\n\nb', lex), 'a b');
});
const para = (...tokens) => T('paragraph', { raw: 'p', tokens });

test('reader: each form becomes elements', () => {
  const { root } = render([
    T('heading', { depth: 6, tokens: [txt('H')] }),
    para(T('strong', { tokens: [txt('b')] }), T('em', { tokens: [txt('i')] }), T('codespan', { text: 'c' }), T('br'), link('https://a.b/c')),
    T('blockquote', { tokens: [para(txt('q'))] }),
    T('code', { text: 'let x;' }), T('hr'),
    T('list', { ordered: true, start: 3, items: [{ task: true, checked: true, tokens: [txt('t')] }, { tokens: [txt('u')] }] }),
    T('table', { align: ['left', null], header: [{ tokens: [txt('A')] }, { tokens: [txt('B')] }], rows: [[{ tokens: [txt('1')] }, { tokens: [txt('2')] }]] }),
  ]);
  const tags = all(root).map((n) => n.tag);
  for (const t of ['h4', 'strong', 'em', 'code', 'br', 'a', 'blockquote', 'pre', 'hr', 'ol', 'li', 'input', 'table', 'thead', 'th', 'td']) assert.ok(tags.includes(t), t);
  const a = all(root).find((n) => n.tag === 'a');
  assert.deepEqual(a.attrs, { href: 'https://a.b/c', rel: 'noopener noreferrer', target: '_blank' });
  assert.equal(all(root).find((n) => n.tag === 'ol').attrs.start, '3');
  assert.equal(all(root).find((n) => n.tag === 'th').attrs.style, 'text-align:left');
  assert.equal(all(root).find((n) => n.tag === 'input').attrs.checked, '');
});
test('reader: a task box token from the lexer inside an item draws nothing of its own', () => {
  const { root } = render([T('list', { items: [{ task: true, checked: true, tokens: [T('checkbox', { checked: true }), txt('Read')] }] })]);
  assert.equal(root.textContent, 'Read');
  assert.equal(all(root).filter((n) => n.tag === 'input').length, 1);
});
test('reader: raw html, pictures and footnotes are text, never elements or HTML', () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(1)</script>';
  const { root, d } = render([T('html', { raw: evil, text: evil }), para(T('image', { raw: '![a](http://x/y.png)', href: 'http://x/y.png', text: 'a' }), T('html', { raw: '<b onclick=1>', text: '<b onclick=1>' }))]);
  assert.deepEqual(d.sinks, []);
  const tags = all(root).map((n) => n.tag);
  assert.ok(!tags.includes('script') && !tags.includes('img') && !tags.includes('b'));
  assert.ok(root.textContent.includes(evil) && root.textContent.includes('![a](http://x/y.png)'));
});
test('reader: bounds', () => {
  const cell = (s) => ({ tokens: [txt(s)] });
  const big = (rows, cols) => T('table', { raw: 'RAW-TABLE', align: [], header: Array.from({ length: cols }, () => cell('h')), rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => cell('c'))) });
  assert.ok(render([big(200, 20)]).nodes.some((n) => n.tag === 'table'));
  for (const t of [big(201, 20), big(2, 21)]) { const r = render([t]); assert.ok(!r.nodes.some((n) => n.tag === 'table') && r.root.textContent === 'RAW-TABLE'); }
  const nest = (n) => (n === 0 ? txt('leaf') : T('list', { raw: `RAW${n}`, items: [{ tokens: [nest(n - 1)] }] }));
  assert.equal(render([nest(4)]).nodes.filter((n) => n.tag === 'ul').length, 4);
  const deep = render([nest(5)]);
  assert.equal(deep.nodes.filter((n) => n.tag === 'ul').length, 4);
  assert.ok(deep.root.textContent.includes('RAW1'));
  const f = (n) => T('paragraph', { raw: `$$${'x'.repeat(n)}$$`, tokens: [txt('t')] });
  assert.ok(render([f(2000)]).nodes.some((n) => n.attrs && /dl-math/.test(n.className)));
  assert.ok(!render([f(2001)]).nodes.some((n) => /dl-math/.test(n.className || '')));
  assert.ok(render([para(txt(`a $${'x'.repeat(2001)}$ b`))]).root.textContent.includes('x'.repeat(2001)));
});
test('reader: formulas, drawn by the hook, source on failure', () => {
  const t = [para(txt('a $x^2$ b and $5 or $6'))];
  assert.equal(render(t).root.textContent, 'a $x^2$ b and $5 or $6');
  let seen = null;
  const r = render(t, { math: (el, tex, display) => { seen = [tex, display]; el.textContent = 'DRAWN'; return true; } });
  assert.deepEqual(seen, ['x^2', false]);
  assert.equal(r.root.textContent, 'a DRAWN b and $5 or $6');
  const bad = render([T('paragraph', { raw: '$$\\bad$$', tokens: [] })], { math: () => { throw new Error('x'); } });
  assert.equal(bad.root.textContent, '$$\\bad$$');
  const half = render(t, { math: (el) => { el.textContent = 'partial'; return false; } });
  assert.ok(half.root.textContent.includes('$x^2$') && !half.root.textContent.includes('partial'));
});
test('reader: object links, links in the text, backlink list', () => {
  const o = link('object:whiteboard:board:b-1', 'The board');
  const r = render([para(o, txt(' and '), link('object:documents:document:abcd1234', 'Plan'), link('object:whiteboard:board:b-1', 'again'))], { object: (el, ref) => { el.attrs.hooked = ref.id; } });
  const chips = r.nodes.filter((n) => n.className === 'dl-object');
  assert.equal(chips.length, 3);
  assert.deepEqual([chips[0].textContent, chips[0].attrs.hooked, chips[0].attrs['data-module']], ['The board', 'b-1', 'whiteboard']);
  assert.ok(!r.nodes.some((n) => n.tag === 'a'));
  const desc = L.dlDescribe('x', () => [para(o, link('object:documents:document:abcd1234', 'Plan'), link('object:whiteboard:board:b-1', 'again'))]);
  assert.deepEqual(L.dlObjectLinks(desc), [{ module: 'whiteboard', kind: 'board', id: 'b-1' }, { module: 'documents', kind: 'document', id: 'abcd1234' }]);
  const inTable = L.dlDescribe('x', () => [T('table', { align: [], header: [{ tokens: [o] }], rows: [[{ tokens: [link('object:a:b:c-1')] }]] })]);
  assert.equal(L.dlObjectLinks(inTable).length, 2);
});
test('reader: a failing parser shows the text', () => {
  const d = fakeDoc();
  const root = L.dlBuild(L.dlDescribe('hello <b>', () => { throw new Error('boom'); }), d);
  assert.equal(root.textContent, 'hello <b>');
  assert.equal(L.dlDescribe('a'.repeat(150001), () => []).length, 1);
});
test('reader: direction and zero-width characters are removed from rendered text', () => {
  const r = render([para(txt('a\u202eb\u200bc\u2066d\ufeffe'))]);
  assert.equal(r.root.textContent, 'abcde');
});

// ---- the hostile corpus
const OK = ['http://a.b', 'https://a.b/c?d=e#f', 'HTTPS://A.B', 'mailto:a@b.c', 'mailto:a@b.c?subject=x', 'object:whiteboard:board:b-1', 'object:documents:document:abcd1234', 'HTTP://x.y'];
const BAD = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', 'java\rscript:alert(1)', ' javascript:alert(1)', '\u0001javascript:alert(1)',
  'java\u0000script:1', 'java\u200bscript:1', '\u202ejavascript:1', 'java\u00a0script:1', 'java\u2028script:1', 'java\u3000script:1', 'javascript&colon;alert(1)', 'javascript&#58;alert(1)',
  'javascript&#x3a;alert(1)', '&#106;avascript:alert(1)', '&#x6A;avascript:alert(1)', 'java&Tab;script:1', 'java&#9;script:1', 'java&newline;script:1', '&amp;#106;avascript:1', 'jav&#x09;ascript:1',
  'data:text/html,<script>alert(1)</script>', 'DATA:text/html;base64,AAAA', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'ftp://a.b', 'blob:https://a.b/x', 'about:blank', 'chrome://x', 'tel:123',
  '//evil.com', '/relative', 'relative/path', '#frag', '', '   ', 'http:', 'http://', 'https:///x', 'mailto:', 'mailto:nobody', 'object:', 'object:a', 'object:a:b', 'object:a:b:c:d', 'object:A:b:c', 'object:a:b:<x>',
  'object:a:b:c d', 'object:../x:b:c', 'https://a.b/"onmouseover="x', 'https://a.b/<script>', "https://a.b/'x", 'https://a.b/\\x', 'x'.repeat(3000), 'http\u200b:\u200b//a.b/' + '"', null, undefined, 5, {}];
test('allow-list: good addresses pass', () => { for (const a of OK) assert.ok(L.dlSafeAddress(a), a); });
test('allow-list: hostile addresses are refused', () => { for (const a of BAD) assert.equal(L.dlSafeAddress(a), null, JSON.stringify(a)); });
test('allow-list: the kept address has no noise and a scheme from the list', () => {
  const a = L.dlSafeAddress('ht\ttp s://a.b'.replace(' ', ''));
  assert.deepEqual(a, { kind: 'link', href: 'https://a.b' });
  assert.deepEqual(L.dlSafeAddress('object:whiteboard:board:b-1'), { kind: 'object', module: 'whiteboard', objectKind: 'b-1'.length ? 'board' : '', id: 'b-1' });
});
test('corpus: a hostile link never becomes an anchor; its source is text', () => {
  for (const a of BAD.filter((x) => typeof x === 'string' && x.trim())) {
    const r = render([para(link(a, 'click'))]);
    assert.ok(!r.nodes.some((n) => n.tag === 'a'), a);
    assert.equal(r.root.textContent, `[click](${a})`.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '').replace(/\r\n?/g, '\n'));
    assert.deepEqual(r.d.sinks, []);
  }
});
test('corpus: sanitisers', () => {
  assert.equal(L.dlCleanLine('a\u0000b\u001fc\u007fd\u0085e\u2028f', 50), 'a b c d e f');
  assert.equal(L.dlCleanLine('\u202e\u200b\u200f', 50), '');
  assert.equal(L.dlCleanLine(5, 50), '');
  assert.equal(L.dlCleanText('\u202ea\u2069\u061cb\u0000\u0008c\td\re'), 'abc\td\ne');
  assert.equal(L.dlCut('a\u{1F600}', 2), 'a');
  assert.equal(L.dlCut('ab\u{1F600}', 3), 'ab');
  assert.equal(L.dlCleanDoc({ ...doc, title: '<script>x</script>' }).title, '<script>x</script>'); // kept as text; drawn with textContent only
  assert.equal(L.dlCleanDoc({ ...doc, title: 'x'.repeat(2000) }), null);
});
test('corpus: stored script text in a document is inert in the build', () => {
  const evil = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>', '</div><iframe src=javascript:1>'];
  const r = render([para(...evil.map((e) => txt(e))), T('code', { text: evil[0] }), T('heading', { depth: 1, tokens: [txt(evil[1])] }), T('table', { align: [], header: [{ tokens: [txt(evil[2])] }], rows: [[{ tokens: [txt(evil[3])] }]] })]);
  assert.deepEqual(r.d.sinks, []);
  assert.deepEqual([...new Set(r.nodes.map((n) => n.tag))].filter((t) => ['script', 'img', 'svg', 'iframe'].includes(t)), []);
  assert.ok(r.root.textContent.includes(evil[0]));
});
test('corpus: the source never uses an HTML sink', () => {
  assert.ok(!/(innerHTML|insertAdjacentHTML|outerHTML|document\.write|eval\(|new Function)/.test(code));
});

// ---- export
test('export: object links become their text', () => {
  assert.equal(L.dlExportMarkdown('See [the plan](object:documents:document:abcd1234) and [site](https://a.b) and [**b** x](object:a:b:c).'), 'See the plan and [site](https://a.b) and **b** x.');
  assert.equal(L.dlExportMarkdown('```\n[x](object:a:b:c)\n```\n[y](object:a:b:c)'), '```\n[x](object:a:b:c)\n```\ny');
  assert.equal(L.dlExportMarkdown('$x$ and $$\na\n$$\n\ttab'), '$x$ and $$\na\n$$\n\ttab');
  assert.equal(L.dlExportMarkdown('[a](OBJECT:a:b:c) [b](<object:a:b:c>)'), 'a b');
  assert.equal(L.dlExportMarkdown(null), '');
});
test('export: file names', () => {
  assert.equal(L.dlExportName('Plan'), 'Plan.md');
  assert.equal(L.dlExportName('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij.md');
  assert.equal(L.dlExportName('x\u0000y\n'), 'x y.md');
  assert.equal(L.dlExportName('x'.repeat(200)), `${'x'.repeat(80)}.md`);
  assert.equal(L.dlExportName('///'), 'Untitled.md');
  assert.equal(L.dlExportName('..secret'), 'secret.md');
  assert.equal(L.dlExportName(null), 'Untitled.md');
});

// ---- the formatting bar
const S = (value, start, end = start) => ({ value, start, end });
test('format: bold, italic, code wrap and unwrap', () => {
  assert.deepEqual(L.dlBold(S('a word b', 2, 6)), S('a **word** b', 4, 8));
  assert.deepEqual(L.dlBold(S('a **word** b', 4, 8)), S('a word b', 2, 6));
  assert.deepEqual(L.dlBold(S('a **word** b', 2, 10)), S('a word b', 2, 6));
  assert.deepEqual(L.dlBold(S('ab', 1)), S('a**bold**b', 3, 7));
  assert.deepEqual(L.dlItalic(S('x', 0, 1)), S('*x*', 1, 2));
  assert.deepEqual(L.dlCode(S('x', 0, 1)), S('`x`', 1, 2));
  assert.deepEqual(L.dlBold(S('abc', 99, 0)), S('**abc**', 2, 5));
});
test('format: heading', () => {
  assert.deepEqual(L.dlHeading(S('one\ntwo', 5), 2), S('one\n## two', 4, 10));
  assert.equal(L.dlHeading(S('## two', 3), 2).value, 'two');
  assert.equal(L.dlHeading(S('# two', 0), 3).value, '### two');
  assert.equal(L.dlHeading(S('x', 0), 9).value, '#### x');
});
test('format: lists, checklist, quote', () => {
  assert.equal(L.dlList(S('a\nb\nc', 0, 3)).value, '- a\n- b\nc');
  assert.equal(L.dlList(S('- a\n- b', 0, 7)).value, 'a\nb');
  assert.equal(L.dlNumbered(S('a\nb', 0, 3)).value, '1. a\n2. b');
  assert.equal(L.dlChecklist(S('a\n- [x] b', 0, 9)).value, '- [ ] a\n- [ ] b');
  assert.equal(L.dlChecklist(S('- [ ] a', 0)).value, 'a');
  assert.equal(L.dlList(S('- [ ] a', 0)).value, '- - [ ] a');
  assert.equal(L.dlQuote(S('a\nb', 0, 3)).value, '> a\n> b');
  assert.equal(L.dlQuote(S('> a', 0)).value, 'a');
  assert.equal(L.dlList(S('', 0)).value, '- ');
});
test('format: link, object link, grid, formula', () => {
  const l = L.dlLink(S('see here now', 4, 8));
  assert.equal(l.value, 'see [here](https://) now');
  assert.equal(l.value.slice(l.start, l.end), 'https://');
  assert.equal(L.dlLink(S('', 0)).value, '[link](https://)');
  const o = L.dlObjectLink(S('a ', 2), { module: 'whiteboard', kind: 'board', id: 'b-1', label: 'My [board]' });
  assert.equal(o.value, 'a [My board](object:whiteboard:board:b-1)');
  assert.equal(o.start, o.value.length);
  for (const bad of [null, { module: 'A', kind: 'b', id: 'c' }, { module: 'a', kind: 'b', id: 'c)' }, { module: 'a', kind: 'b', id: '' }]) assert.equal(L.dlObjectLink(S('', 0), bad), null);
  const t = L.dlGrid(S('intro', 5));
  assert.equal(t.value, 'intro\n\n| Heading 1 | Heading 2 | Heading 3 |\n| --- | --- | --- |\n|     |     |     |\n|     |     |     |');
  assert.equal(t.value.slice(t.start, t.end), 'Heading 1');
  assert.equal(L.dlGrid(S('', 0), 99, 999).value.split('\n').length, 202);
  assert.deepEqual(L.dlFormula(S('x', 0, 1)), S('$x$', 1, 2));
  assert.equal(L.dlFormula(S('$x$', 1, 2)).value, 'x');
  assert.equal(L.dlFormula(S('', 0)).value, '$x$');
  assert.equal(L.dlFormula(S('a', 1), true).value, 'a\n\n$$\nx\n$$');
  assert.equal(L.dlFormula(S('', 0), true).value, '$$\nx\n$$');
});

// ---- saving: the plan, the commit's outcome, the timing --------------------------------------------------------------------
{
  let n = 0;
  const fresh = () => `new${String(n++).padStart(5, '0')}`;
  const base = { rec: doc, me: 'u2', name: 'Bo', now: '2026-11-11T11:00:00.000Z', title: 'Plan', lex };
  test('save plan: only changed chunks are written, rev goes up, record is filled', () => {
    const p = L.dlPlanSave({ ...base, old: [{ id: 'aaaa1111', text: 'Hi' }], text: 'Hi', fresh });
    assert.equal(p.ok, true);
    assert.equal(p.writes.length, 0);
    assert.deepEqual(p.record.chunks, ['aaaa1111']);
    assert.equal(p.record.rev, 3);
    assert.equal(p.record.editedBy, 'u2');
    assert.equal(p.record.editedByName, 'Bo');
    assert.equal(p.record.size, 2);
    const q = L.dlPlanSave({ ...base, old: [{ id: 'aaaa1111', text: 'Hi' }], text: 'Hi there', fresh });
    assert.equal(q.writes.length, 1);
    assert.notEqual(q.writes[0].id, 'aaaa1111');
    assert.deepEqual(q.dropped, ['aaaa1111']);
    assert.ok(L.dlCleanDoc(q.record), 'the record cleans');
  });
  test('save plan: several chunks, one changed, the rest kept; a shorter text drops chunks', () => {
    const big = `${'a'.repeat(30000)}\n\n${'b'.repeat(30000)}\n\n${'c'.repeat(1000)}`;
    const first = L.dlPlanSave({ ...base, old: [{ id: 'aaaa1111', text: '' }], text: big, fresh });
    assert.ok(first.chunks.length >= 2);
    const old = first.chunks.map((c) => ({ id: c.id, text: c.text }));
    const edited = big.slice(0, -1) + 'Z';
    const next = L.dlPlanSave({ ...base, rec: { ...doc, chunks: old.map((o) => o.id) }, old, text: edited, fresh });
    assert.equal(next.writes.length, 1);
    assert.deepEqual(next.dropped, [old[old.length - 1].id]);
    const short = L.dlPlanSave({ ...base, old, text: 'x', fresh });
    assert.equal(short.chunks.length, 1);
    assert.equal(short.dropped.length, old.length);
  });
  test('save plan: refuses an empty title and a too long text before any write', () => {
    assert.deepEqual(L.dlPlanSave({ ...base, title: '  ', old: [], text: 'x', fresh }), { ok: false, reason: 'title' });
    assert.deepEqual(L.dlPlanSave({ ...base, old: [], text: 'x'.repeat(150001), fresh }), { ok: false, reason: 'long' });
  });
  test('dirty: text or title', () => {
    assert.equal(L.dlIsDirty({ text: 'a', title: 't' }, { text: 'a', title: 't' }), false);
    assert.equal(L.dlIsDirty({ text: 'a', title: 't' }, { text: 'b', title: 't' }), true);
    assert.equal(L.dlIsDirty({ text: 'a', title: 't' }, { text: 'a', title: 'u' }), true);
  });
  test('commit result: 409 is a conflict, other errors are tried again', () => {
    assert.equal(L.dlCommitResult(null), 'saved');
    assert.equal(L.dlCommitResult({ status: 409 }), 'conflict');
    assert.equal(L.dlCommitResult({ status: 429 }), 'failed');
    assert.equal(L.dlCommitResult(new Error('x')), 'failed');
  });
  test('autosave: 3 s after the last key, never within 3 s of the last save', () => {
    const d = (o) => L.dlAutosaveDelay({ now: 10000, lastKey: 9000, lastSave: -Infinity, dirty: true, force: false, ...o });
    assert.equal(d({ dirty: false }), null);
    assert.equal(d({}), 2000);
    assert.equal(d({ lastKey: 7000 }), 0);
    assert.equal(d({ lastKey: 7000, lastSave: 9000 }), 2000);
    assert.equal(d({ force: true }), 0);
    assert.equal(d({ force: true, lastSave: 9500 }), 2500);
    assert.equal(d({ lastKey: NaN }), 0);
  });
  test('write budget: a minute of writes stays under the cap', () => {
    assert.equal(L.dlWriteWait([], 100000, 7), 0);
    const log = Array.from({ length: 199 }, (_, i) => 100000 + i);
    assert.equal(L.dlWriteWait(log, 100200, 1), 0);
    assert.equal(L.dlWriteWait(log, 100200, 3), 100000 + 1 + 60000 - 100200);
    assert.equal(L.dlWriteWait([1000], 100000, 5), 0, 'old writes do not count');
  });
  test('save word', () => {
    assert.equal(L.dlSaveWord({ dirty: false, saving: false, failed: false }), 'Saved');
    assert.equal(L.dlSaveWord({ dirty: true, saving: false, failed: false }), 'Not saved yet');
    assert.equal(L.dlSaveWord({ dirty: true, saving: true, failed: false }), 'Saving');
    assert.equal(L.dlSaveWord({ dirty: true, saving: false, failed: true }), 'Not saved');
  });
}

test('page colour: cleaning keeps known ids only, the default otherwise', () => {
  for (const p of L.DL_PAPERS) assert.equal(L.dlCleanDoc({ ...doc, paper: p.id }).paper, p.id);
  const { paper, ...old } = doc;
  assert.equal(L.dlCleanDoc(old).paper, 'light-white', 'a record without the field is white');
  for (const v of ['red', 'LIGHT-WHITE', '#000', 'url(x)', '', 5, null, {}, [], 'light-white;x']) assert.equal(L.dlCleanDoc({ ...doc, paper: v }).paper, L.DL_PAPER_DEFAULT, JSON.stringify(v));
  assert.equal(L.DL_PAPER_DEFAULT, 'light-white');
  assert.ok(L.DL_PAPERS.length >= 3 && L.DL_PAPERS.length <= 8);
});
test('page colour: a save carries it, and a change makes the page dirty', () => {
  const base = { old: [{ id: 'aaaa1111', text: 'Hi' }], text: 'Hi', title: 'Plan', rec: doc, me: 'u1', name: 'Ana', now: '2026-11-11T11:00:00.000Z', fresh: () => 'bbbb2222', lex };
  assert.equal(L.dlPlanSave(base).record.paper, 'light-white');
  assert.equal(L.dlPlanSave({ ...base, paper: 'dark-slate' }).record.paper, 'dark-slate');
  assert.equal(L.dlPlanSave({ ...base, paper: 'bogus' }).record.paper, 'light-white');
  assert.equal(L.dlIsDirty({ text: 'a', title: 't', paper: 'light-white' }, { text: 'a', title: 't', paper: 'dark-black' }), true);
  assert.equal(L.dlIsDirty({ text: 'a', title: 't', paper: 'light-white' }, { text: 'a', title: 't', paper: 'light-white' }), false);
});
test('page colour: the menu model has both groups and every colour once', () => {
  const m = L.dlPaperMenuModel();
  assert.deepEqual(m.filter((e) => e.kind === 'heading').map((e) => e.label), ['Light colours', 'Dark colours']);
  assert.deepEqual(m.filter((e) => e.kind === 'paper').map((e) => e.id).sort(), L.DL_PAPERS.map((p) => p.id).sort());
  assert.equal(m[0].kind, 'heading');
  assert.equal(m.find((e) => e.id === 'light-white').label, 'Pure White');
  const heads = m.map((e, i) => (e.kind === 'heading' ? i : -1)).filter((i) => i >= 0);
  assert.ok(m.slice(heads[0] + 1, heads[1]).every((e) => L.DL_PAPERS.find((p) => p.id === e.id).family === 'light'));
});
test('page colour: the ink reads at 4.5:1 or better on every colour (values read from documents.css)', () => {
  const css = fs.readFileSync(path.join(src, 'documents.css'), 'utf8');
  const val = (name) => { const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,6})`).exec(css); assert.ok(m, `${name} defined`); return L.dlHexRgb(m[1]); };
  const dark = val('--doc-fixed-ink-light');
  const light = val('--doc-fixed-ink-dark');
  for (const p of L.DL_PAPERS) {
    const fill = val(p.css);
    const pick = L.dlInkFor(fill, dark, light);
    assert.equal(pick, p.family === 'light' ? 'dark' : 'light', `${p.id} ink for a ${p.family} colour`);
    assert.ok(L.dlContrast(fill, pick === 'dark' ? dark : light) >= 4.5, `${p.id} contrast`);
  }
  for (const p of L.DL_PAPERS) assert.ok(css.includes(`.sheet[data-paper="${p.id}"]`), `${p.id} has a rule`);
});
test('contrast helpers', () => {
  assert.equal(Math.round(L.dlContrast([0, 0, 0], [255, 255, 255])), 21);
  assert.equal(L.dlInkFor([255, 255, 255], [0, 0, 0], [255, 255, 255]), 'dark');
  assert.equal(L.dlInkFor([0, 0, 0], [0, 0, 0], [255, 255, 255]), 'light');
  assert.equal(L.dlInkFor(null, [0, 0, 0], [1, 1, 1]), null);
  assert.equal(L.dlInkFor([1, 2], [0, 0, 0], [1, 1, 1]), null);
  assert.deepEqual(L.dlHexRgb('#f5eedb'), [245, 238, 219]);
  assert.deepEqual(L.dlHexRgb('#fff'), [255, 255, 255]);
  assert.equal(L.dlHexRgb('red'), null);
  assert.equal(L.dlHexRgb(5), null);
});

test('view: clean, store, read, label', () => {
  assert.equal(L.dlCleanView('fit'), 'fit');
  assert.equal(L.dlCleanView(125), 125);
  assert.equal(L.dlCleanView('150'), 150);
  for (const bad of [undefined, null, 'x', 60, '60', 0, -100, NaN, {}, '1e2']) assert.equal(L.dlCleanView(bad), 'fit');
  assert.equal(L.dlViewStore(200), '200');
  assert.equal(L.dlViewStore('junk'), 'fit');
  assert.equal(L.dlViewRead('75'), 75);
  assert.equal(L.dlViewRead(null), 'fit');
  assert.equal(L.dlViewLabel('fit'), 'Fit width');
  assert.equal(L.dlViewLabel(125), '125%');
  assert.equal(L.dlViewLabel('nope'), 'Fit width');
});
test('view: the sheet for a view', () => {
  assert.deepEqual({ ...L.dlViewSheet('fit') }, { zoom: 1, widthRem: null, maxRem: 120 });
  assert.deepEqual({ ...L.dlViewSheet(100) }, { zoom: 1, widthRem: 48, maxRem: 48 });
  assert.deepEqual({ ...L.dlViewSheet(50) }, { zoom: 0.5, widthRem: 48, maxRem: 48 });
  assert.equal(L.dlViewSheet(200).zoom, 2);
  assert.equal(L.dlViewSheet('junk').widthRem, null);
});
test('view: zoom steps', () => {
  assert.equal(L.dlViewStep(100, 1), 125);
  assert.equal(L.dlViewStep(100, -1), 75);
  assert.equal(L.dlViewStep(50, -1), 50);
  assert.equal(L.dlViewStep(200, 1), 200);
  assert.equal(L.dlViewStep('fit', 1), 125);
  assert.equal(L.dlViewStep('fit', -1), 75);
  let v = 50; const seen = [v];
  for (let i = 0; i < 8; i += 1) { v = L.dlViewStep(v, 1); seen.push(v); }
  assert.deepEqual(seen.slice(0, 6), [50, 75, 100, 125, 150, 200]);
  assert.equal(seen.at(-1), 200);
});
test('view: keys', () => {
  assert.equal(L.dlViewKey({ key: '+', ctrlKey: true }), 'in');
  assert.equal(L.dlViewKey({ key: '=', metaKey: true }), 'in');
  assert.equal(L.dlViewKey({ key: '-', ctrlKey: true }), 'out');
  assert.equal(L.dlViewKey({ key: '0', metaKey: true }), 'actual');
  assert.equal(L.dlViewKey({ key: '-' }), null);
  assert.equal(L.dlViewKey({ key: '0', ctrlKey: true, altKey: true }), null);
  assert.equal(L.dlViewKey({ key: 'a', ctrlKey: true }), null);
  assert.equal(L.dlViewKey(null), null);
});

// ---- tags ----
const T1 = 'tagaaaa1', T2 = 'tagbbbb2', T3 = 'tagcccc3';
const known = new Map([T1, T2, T3].map((t) => [t, { id: t }]));
test('tags: ids cleaned strictly (shape, duplicates, cap 8, never a name)', () => {
  assert.deepEqual(L.dlCleanTagIds([T1, T1, 'ski-trip', 'Short', 'UPPERCASE1', 5, null, {}, '<b>x</b>', T2]), [T1, T2]);
  assert.deepEqual(L.dlCleanTagIds('nope'), []);
  const many = Array.from({ length: 12 }, (_, i) => `tagnum${String(i).padStart(2, '0')}`);
  assert.equal(L.dlCleanTagIds(many).length, 8);
  assert.deepEqual(L.dlCleanTagIds(many), many.slice(0, 8));
  assert.deepEqual(L.dlCleanTagIds(['a'.repeat(13), 'a'.repeat(7), 'a'.repeat(8), 'a'.repeat(12)]), ['a'.repeat(8), 'a'.repeat(12)]);
});
test('tags: the record is cleaned on reading (type, id, extra fields dropped)', () => {
  assert.equal(L.dlCleanTags({ id: 'abcd1234', type: 'tags', tags: [T1, 'x'], by: 'u1', at: '2026-11-11T10:00:00.000Z', evil: '<script>' }, 'abcd1234').tags.length, 1);
  assert.ok(!('evil' in L.dlCleanTags({ id: 'abcd1234', type: 'tags', tags: [], evil: 1 }, 'abcd1234')));
  assert.equal(L.dlCleanTags({ id: 'other123', type: 'tags', tags: [] }, 'abcd1234'), null);
  assert.equal(L.dlCleanTags({ id: 'abcd1234', type: 'doc', tags: [] }, 'abcd1234'), null);
  assert.equal(L.dlCleanTags([], 'abcd1234'), null);
  assert.equal(L.dlTagsKey('abcd1234'), 'tags:abcd1234');
});
test('tags: the small text record has no tags field; a stray one is dropped', () => {
  assert.ok(!('tags' in L.dlCleanDoc({ ...doc, tags: [T1] })));
});
test('tags: unknown (deleted) ids are dropped on read', () => {
  assert.deepEqual(L.dlKnownTagIds([T1, 'deleted01', T2], known), [T1, T2]);
  assert.deepEqual(L.dlKnownTagIds([T1], new Map()), []);
});
test('tags: delta and apply: removals out, additions in, dead ids dropped, 8 at most', () => {
  assert.deepEqual(L.dlTagsDelta([T1], [T1, T2]), { add: [T2], remove: [] });
  assert.deepEqual(L.dlTagsDelta([T1, T2], [T2, T3]), { add: [T3], remove: [T1] });
  assert.deepEqual(L.dlTagsApply([T1], { add: [T2], remove: [] }, known), { ids: [T1, T2], full: false });
  assert.deepEqual(L.dlTagsApply([T1, T2], { add: [], remove: [T1] }, known), { ids: [T2], full: false });
  assert.deepEqual(L.dlTagsApply([T1, 'deleted01'], { add: [T2], remove: [] }, known).ids, [T1, T2]);
  const big = new Map(Array.from({ length: 10 }, (_, i) => [`tagnum${String(i).padStart(2, '0')}`, 1]));
  const ids = [...big.keys()];
  const r = L.dlTagsApply(ids.slice(0, 8), { add: [ids[8]], remove: [] }, big);
  assert.equal(r.ids.length, 8); assert.ok(r.full);
  assert.equal(L.dlTagsApply(ids.slice(0, 8), { add: [ids[8]], remove: [ids[0]] }, big).full, false);
});
test('tags: the picker opens ticked with the open record\'s current ids (stored, minus dead ids), also after someone else tags', () => {
  const stored = [T1, 'deleted01', T3];
  assert.deepEqual(L.dlKnownTagIds(stored, known), [T1, T3]); // what `selected` carries
  const afterOther = L.dlTagsApply(stored, { add: [T2], remove: [T1] }, known).ids; // another person's change, then `set(ids)`
  assert.deepEqual(L.dlKnownTagIds(afterOther, known), [T3, T2]);
  assert.deepEqual(L.dlKnownTagIds(afterOther, new Map([[T2, 1]])), [T2]); // a tag deleted in Set up is no longer ticked
});
// A store with compare-and-set, as host.storage.set with { version }.
function fakeStore() {
  const m = new Map();
  const writes = [];
  return {
    m, writes, hook: null,
    async get(k) { const e = m.get(k); return e ? { value: JSON.parse(JSON.stringify(e.value)), version: e.version } : null; },
    async set(k, v, o = {}) {
      if (this.hook) { const h = this.hook; this.hook = null; await h(); }
      const e = m.get(k);
      if ((o.version !== undefined) && (e ? e.version : 0) !== o.version) throw Object.assign(new Error('conflict'), { status: 409 });
      const version = (e ? e.version : 0) + 1;
      m.set(k, { value: JSON.parse(JSON.stringify(v)), version });
      writes.push(k);
      return { version };
    },
  };
}
test('tags: a tag change is saved; a second person tagging first is merged, not lost (retry on 409)', async () => {
  const s = fakeStore();
  const ID = 'abcd1234';
  await L.dlTagsCommit({ store: s, id: ID, delta: { add: [T1], remove: [] }, known, me: 'u1', now: 'n' });
  // while u2 is about to write, u3 writes first: u2's write 409s, reads again and adds its own on top
  s.hook = async () => { await L.dlTagsCommit({ store: s, id: ID, delta: { add: [T3], remove: [] }, known, me: 'u3', now: 'n' }); };
  const out = await L.dlTagsCommit({ store: s, id: ID, delta: { add: [T2], remove: [] }, known, me: 'u2', now: 'n' });
  assert.deepEqual([...out.ids].sort(), [T1, T2, T3]);
  assert.deepEqual([...s.m.get(L.dlTagsKey(ID)).value.tags].sort(), [T1, T2, T3]);
});
test('tags: a removal and an addition by two people both stand', async () => {
  const s = fakeStore();
  const ID = 'abcd1234';
  await L.dlTagsCommit({ store: s, id: ID, delta: { add: [T1, T2], remove: [] }, known, me: 'u1', now: 'n' });
  s.hook = async () => { await L.dlTagsCommit({ store: s, id: ID, delta: { add: [T3], remove: [] }, known, me: 'u3', now: 'n' }); };
  await L.dlTagsCommit({ store: s, id: ID, delta: { add: [], remove: [T1] }, known, me: 'u2', now: 'n' });
  assert.deepEqual([...s.m.get(L.dlTagsKey(ID)).value.tags].sort(), [T2, T3]);
});
test('tags: a text save and a tag change write different keys, so neither can 409 or lose the other', async () => {
  const s = fakeStore();
  const ID = 'abcd1234';
  await s.set(`doc:${ID}`, { ...doc, id: ID }, { version: 0 });
  const docVersion = (await s.get(`doc:${ID}`)).version;
  // a tag change lands between the editor's read and its commit
  s.hook = async () => { await L.dlTagsCommit({ store: s, id: ID, delta: { add: [T1], remove: [] }, known, me: 'u2', now: 'n' }); };
  const plan = L.dlPlanSave({ old: [{ id: 'aaaa1111', text: 'Hi' }], text: 'Hi there', title: 'Plan', paper: 'light-white', rec: { ...doc, id: ID }, me: 'u1', name: 'Ana', now: '2026-11-11T11:00:00.000Z', fresh: () => 'zzzz0000', lex });
  assert.ok(plan.ok);
  await s.set(`doc:${ID}`, plan.record, { version: docVersion }); // no 409
  assert.deepEqual(s.m.get(L.dlTagsKey(ID)).value.tags, [T1]);
  assert.equal(s.m.get(`doc:${ID}`).value.rev, 3);
  // and a tag change under a held text lock or a later text save does not disturb the record's rev or the other way round
  const rev = s.m.get(`doc:${ID}`).value.rev;
  await L.dlTagsCommit({ store: s, id: ID, delta: { add: [T2], remove: [] }, known, me: 'u2', now: 'n' });
  assert.equal(s.m.get(`doc:${ID}`).value.rev, rev);
  assert.equal(s.m.get(`doc:${ID}`).version, 2);
  // a text save does not write the tags key
  const before = s.writes.filter((k) => k === L.dlTagsKey(ID)).length;
  const v2 = (await s.get(`doc:${ID}`)).version;
  await s.set(`doc:${ID}`, { ...plan.record, rev: rev + 1 }, { version: v2 });
  assert.equal(s.writes.filter((k) => k === L.dlTagsKey(ID)).length, before);
  assert.deepEqual([...s.m.get(L.dlTagsKey(ID)).value.tags].sort(), [T1, T2]);
});
test('tags: a conflict that never clears gives up with the 409 after the tries', async () => {
  const s = { async get() { return null; }, async set() { throw Object.assign(new Error('c'), { status: 409 }); } };
  await assert.rejects(L.dlTagsCommit({ store: s, id: 'abcd1234', delta: { add: [T1], remove: [] }, known, me: 'u', now: 'n', tries: 3 }), (e) => e.status === 409);
  const s2 = { async get() { return null; }, async set() { throw Object.assign(new Error('no'), { status: 403 }); } };
  await assert.rejects(L.dlTagsCommit({ store: s2, id: 'abcd1234', delta: { add: [T1], remove: [] }, known, me: 'u', now: 'n' }), (e) => e.status === 403);
});
test('tags: the filter is AND over the chosen tags, ignores dead ones, and counts only known tags', () => {
  assert.ok(L.dlTagsMatch([T1, T2], [T1, T2], known));
  assert.ok(!L.dlTagsMatch([T1], [T1, T2], known));
  assert.ok(L.dlTagsMatch([], [], known));
  assert.ok(L.dlTagsMatch([T1], ['deleted01'], known)); // a deleted chosen tag no longer filters
  assert.ok(!L.dlTagsMatch([], [T3], known));
  const c = L.dlTagCounts([[T1, T2], [T1, 'deleted01'], []], known);
  assert.equal(c.get(T1), 2); assert.equal(c.get(T2), 1); assert.ok(!c.has('deleted01'));
});

test('resync: the list state redraws the list', () => {
  const p = L.dlResyncPlan({ state: 'list', shownRev: 0, rec: null, ok: true });
  assert.ok(p.apply && p.redrawList && !p.redrawReading && !p.checkLock && !p.touchText);
});
test('resync: reading replaces only on a higher rev', () => {
  assert.ok(L.dlResyncPlan({ state: 'reading', shownRev: 2, rec: { rev: 3 }, ok: true }).redrawReading);
  assert.ok(!L.dlResyncPlan({ state: 'reading', shownRev: 3, rec: { rev: 3 }, ok: true }).redrawReading);
  assert.ok(!L.dlResyncPlan({ state: 'reading', shownRev: 4, rec: { rev: 3 }, ok: true }).redrawReading);
  const gone = L.dlResyncPlan({ state: 'reading', shownRev: 3, rec: null, ok: true });
  assert.ok(gone.closeReading && !gone.redrawReading);
});
test('resync: editing never replaces the text, whatever the stored rev', () => {
  for (const rec of [null, { rev: 1 }, { rev: 99 }]) {
    const p = L.dlResyncPlan({ state: 'editing', shownRev: 1, rec, ok: true });
    assert.ok(p.apply && p.checkLock && !p.touchText && !p.redrawReading && !p.redrawList && !p.closeReading);
  }
});
test('resync: a failed read leaves everything as it was', () => {
  for (const state of ['list', 'reading', 'editing']) {
    const p = L.dlResyncPlan({ state, shownRev: 1, rec: { rev: 9 }, ok: false });
    assert.ok(Object.values(p).every((v) => v === false), state);
  }
});
test('resync: a gap after hiding is more than 30 s', () => {
  assert.ok(L.dlResyncAfterHidden(1000, 32000));
  assert.ok(!L.dlResyncAfterHidden(1000, 31000));
  assert.ok(!L.dlResyncAfterHidden(0, 99999));
});

// ---- the reader with the real (vendored) marked: formulas, loose checklists, chip labels, and the flags
const real = (md, hooks) => { const d = fakeDoc(); const desc = L.dlDescribe(md, (m) => reader.lexer(m)); const root = L.dlBuild(desc, d, hooks); return { desc, root, d, nodes: all(root) }; };
// emphasis around a formula: the * or _ inside a formula must not pair with the emphasis outside it
const emOf = (md) => L.dlDescribe(md, lex)[0].c.map((n) => (n.c ? [n.t, n.c.map((m) => (m.t === 'math' ? `$${m.tex}$` : m.v)).join('')] : [n.t, n.t === 'math' ? `$${n.tex}$` : n.v]));
test('real marked: a * inside a formula does not end the italic', () => {
  assert.deepEqual(emOf('*x $a*b$ y*'), [['em', 'x $a*b$ y']]);
});
test('real marked: a _ inside a formula does not end the italic or bold', () => {
  assert.deepEqual(emOf('_x $a_b$ y_'), [['em', 'x $a_b$ y']]);
  assert.deepEqual(emOf('**x $a_b$ y**'), [['strong', 'x $a_b$ y']]);
  assert.deepEqual(emOf('**x $a**b$ y**'), [['strong', 'x $a**b$ y']]);
});
test('real marked: ordinary emphasis beside a formula still works', () => {
  assert.deepEqual(emOf('*a* $x^2$ **b**'), [['em', 'a'], ['text', ' '], ['math', '$x^2$'], ['text', ' '], ['strong', 'b']]);
  assert.deepEqual(emOf('*a $x$ b* and z'), [['em', 'a $x$ b'], ['text', ' and z']]);
  assert.deepEqual(emOf('a * b $c$ * d'), [['text', 'a * b '], ['math', '$c$'], ['text', ' * d']]);
});
// every text made from a document for display comes from the reader's description, never from the Markdown source
test('the excerpt, preview, thumbnail and search text never show the zero-width entity or character', () => {
  const md = '# T\n\n**a.**&#8203;b and ​c';
  const plan = L.dlPlanSave({ old: [{ id: 'aaaa1111', text: 'x' }], text: md, title: 'Plan', rec: doc, me: 'u1', name: 'Ana', now: '2026-11-11T11:00:00.000Z', fresh: () => 'bbbb2222', lex });
  const rec = plan.record;
  const bad = /&#8203;|&amp;#8203;|​/i;
  assert.equal(rec.excerpt, 'T a.b and c');
  // the stored preview is Markdown for the thumbnail and keeps the entity (without it the bold would not close); what is shown is the description
  assert.ok(!/\u200b/.test(rec.preview), 'preview');
  const shown = L.dlBuild(L.dlDescribe(L.dlThumbText(rec), lex), fakeDoc()).textContent;
  assert.ok(!bad.test(shown) && shown.includes('a.b'), 'thumbnail');
  const search = `${rec.title} ${rec.excerpt}`.toLowerCase();
  assert.ok(!bad.test(search) && search.includes('a.b'), 'search');
  assert.equal(L.dlBuild(L.dlDescribe(L.dlCleanDoc({ ...doc, preview: 'x&#8203;y &#x200B;z' }).preview, lex), fakeDoc()).textContent, 'xy z');
});
test('real marked: a formula keeps its backslashes and is shown as visible TeX', () => {
  const r = real('Is $\\int x\\,dx$ and $\\{a\\}\\%$ and $a\\\\b$ ok');
  const maths = r.nodes.filter((n) => n.className === 'dl-math');
  assert.deepEqual(maths.map((n) => n.textContent), ['$\\int x\\,dx$', '$\\{a\\}\\%$', '$a\\\\b$']);
  assert.equal(r.root.textContent, 'Is $\\int x\\,dx$ and $\\{a\\}\\%$ and $a\\\\b$ ok');
});
test('real marked: $$ in a paragraph, a digit or a space after $, and \\$ are not formulas', () => {
  const r = real('Costs $5 and $6, then \\$x\\$ and $ y $ end');
  assert.ok(!r.nodes.some((n) => (n.className || '').startsWith('dl-math')));
  assert.equal(r.root.textContent, 'Costs $5 and $6, then $x$ and $ y $ end');
  const d = real('$$\\{a\\}\\%$$');
  assert.equal(d.nodes.filter((n) => n.className === 'dl-math dl-math-block').length, 1);
  assert.equal(d.root.textContent, '$$\\{a\\}\\%$$');
  const m = real('a $$x\\,y$$ b');
  assert.equal(m.root.textContent, 'a $x\\,y$ b');
});
test('real marked: a drawn formula gets its TeX with the backslashes', () => {
  const seen = [];
  real('$\\{a\\}\\%$', { math: (el, tex) => { seen.push(tex); return false; } });
  assert.deepEqual(seen, ['\\{a\\}\\%']);
});
test('real marked: a loose checklist has one box per item and no stray words', () => {
  for (const md of ['- [ ] one\n\n- [x] two\n', '- [ ] one\n- [x] two\n']) {
    const r = real(md);
    const boxes = r.nodes.filter((n) => n.tag === 'input');
    assert.equal(boxes.length, 2, md);
    assert.equal(boxes[0].attrs.checked, undefined);
    assert.equal(boxes[1].attrs.checked, '');
    assert.equal(r.root.textContent, 'onetwo', md);
  }
  // words "[ ] " left in front of the text (a lexer that keeps them) are taken out of a task item, and only there
  const kept = L.dlDescribe('x', () => [T('list', { items: [{ task: true, checked: false, tokens: [T('paragraph', { tokens: [txt('[ ] one')] })] }, { task: false, tokens: [T('paragraph', { tokens: [txt('[ ] plain')] })] }] })]);
  const r2 = L.dlBuild(kept, fakeDoc());
  assert.equal(r2.textContent, 'one[ ] plain');
});
test('real marked: a chip label is the decoded text, not the source', () => {
  const r = real('See [Board \\[2\\] \\\\ *old*](object:whiteboard:board:b-1) now', { object: (el, ref) => { el.attrs.label = ref.label; } });
  const chip = r.nodes.find((n) => n.className === 'dl-object');
  assert.equal(chip.textContent, 'Board [2] \\ old');
  assert.equal(chip.attrs['data-id'], 'b-1');
  assert.equal(L.dlObjectLinks(r.desc).length, 1);
});
test('reader: the code fence language is kept in the description only', () => {
  const d = L.dlDescribe('x', () => [T('code', { text: 'a', lang: 'js' }), T('code', { text: 'b', lang: '"><script>', codeBlockStyle: undefined }), T('code', { text: 'c', codeBlockStyle: 'indented' })]);
  assert.deepEqual(d.map((b) => b.lang), ['js', 'script', '']);
  const r = L.dlBuild(d, fakeDoc());
  for (const n of all(r)) assert.ok(!Object.keys(n.attrs || {}).some((k) => /lang|class/.test(k)), 'no attribute for the language');
});
test('reader: text shown as source is flagged raw; plain text is not', () => {
  const d = L.dlDescribe('x', () => [T('paragraph', { tokens: [txt('plain'), T('html', { raw: '<b>' }), T('image', { raw: '![a](http://x/y.png)', href: 'http://x/y.png', text: 'a' }), link('javascript:alert(1)', 'bad')] })]);
  const c = d[0].c;
  assert.equal(c[0].raw, undefined);
  assert.deepEqual(c.slice(1).map((n) => [n.t, n.raw]), [['text', true], ['text', true], ['text', true]]);
});
// ---- reader fields for the rich editor: fence word and info, real heading level, link title, entities, formula fields, label escape
test('real marked: a code fence keeps its first word as lang and the rest as info; the drawing is unchanged', () => {
  const r = real('```js title="x" {1,3}\nlet a;\n```\n\n```\nplain\n```\n\n~~~ py\nx\n~~~');
  assert.deepEqual(r.desc.map((b) => [b.lang, b.info]), [['js', 'title="x" {1,3}'], ['', ''], ['py', '']]);
  const pre = r.nodes.filter((n) => n.tag === 'pre');
  assert.equal(pre.length, 3);
  for (const n of r.nodes) assert.ok(!Object.keys(n.attrs || {}).some((k) => /lang|info|title|class|data/.test(k)), 'the code block carries no attribute of the info');
  assert.equal(pre[0].textContent, 'let a;');
  const h = real('```"><script> onload=1\nx\n```');
  assert.equal(h.desc[0].lang, 'script');
  assert.deepEqual(h.d.sinks, []);
});
test('real marked: a heading keeps its real level; levels 5 and 6 are drawn as 4', () => {
  const r = real('# a\n\n### c\n\n##### e\n\n###### f');
  assert.deepEqual(r.desc.map((b) => [b.level, b.depth]), [[1, 1], [3, 3], [5, 4], [6, 4]]);
  assert.deepEqual(r.nodes.filter((n) => /^h\d$/.test(n.tag)).map((n) => n.tag), ['h1', 'h3', 'h4', 'h4']);
});
test('real marked: a link title is kept in the description and never drawn', () => {
  const r = real('[go](https://a.b/ "The title") and [chip](object:m:k:id1 "Tip") and [plain](https://c.d)');
  const kids = r.desc[0].c;
  assert.equal(kids.find((n) => n.t === 'link' && n.href === 'https://a.b/').title, 'The title');
  assert.equal(kids.find((n) => n.t === 'object').title, 'Tip');
  assert.equal('title' in kids.find((n) => n.t === 'link' && n.href === 'https://c.d'), false);
  for (const n of r.nodes) assert.ok(!('title' in (n.attrs || {})), 'no title attribute');
});
test('real marked: entities read as the characters they mean, in text only', () => {
  const r = real('A &amp; B &lt;b&gt; &#35; &#x26; &copy; &hellip; AT&T &bogus; x < y &amp;amp; &#0; **&quot;q&quot;**');
  assert.equal(r.root.textContent, 'A & B <b> # & © … AT&T &bogus; x < y &amp; � "q"');
  assert.deepEqual(r.d.sinks, []);
  assert.ok(!r.nodes.some((n) => n.tag === 'b'), 'an entity never becomes a tag');
  // not in text: code, a fence and a raw source stay as written
  assert.equal(real('`&amp;`').root.textContent, '&amp;');
  assert.equal(real('```\n&amp;\n```').root.textContent, '&amp;');
  assert.equal(real('<b>&amp;</b>').root.textContent, '<b>&</b>'); // the tags are shown as their source; the text between them is text
  assert.equal(real('\\&amp;').root.textContent, '&amp;');
  // in a heading, a list item, a table cell and a link label
  assert.equal(real('# a &amp; b').root.textContent, 'a & b');
  assert.equal(real('- a &lt; b').root.textContent, 'a < b');
  assert.equal(real('|a|\n|-|\n|&amp;|').root.textContent, 'a&');
  assert.equal(real('[x &amp; y](https://a.b/)').root.textContent, 'x & y');
});
test('real marked: entities with markup look-alikes stay text', () => {
  for (const md of ['&lt;script&gt;alert(1)&lt;/script&gt;', '&#60;img src=x onerror=1&#62;', '&#x3c;svg onload=1&#x3e;', '[&lt;i&gt;](object:a:b:c)']) {
    const r = real(md);
    assert.deepEqual(r.d.sinks, [], md);
    for (const n of r.nodes) assert.ok(!['script', 'img', 'svg', 'i'].includes(n.tag), `${n.tag} from ${md}`);
  }
  assert.equal(real('&lt;script&gt;alert(1)&lt;/script&gt;').root.textContent, '<script>alert(1)</script>');
});
test('real marked: a formula node carries its TeX and whether it is inline or block', () => {
  const r = real('Is $a\\,b$ here\n\n$$\\frac{1}{2}$$');
  const inl = r.desc[0].c.find((n) => n.t === 'math');
  assert.deepEqual([inl.tex, inl.display], ['a\\,b', false]);
  assert.deepEqual([r.desc[1].t, r.desc[1].tex, r.desc[1].display], ['math', '\\frac{1}{2}', true]);
});
test('real marked: two $$ formulas in one paragraph are a paragraph, not one block formula (loose list, top level); a true block still is one', () => {
  const shape = (n) => (n.t === 'math' ? `${n.display ? 'D' : 'I'}:${n.tex}` : `${n.t}${n.raw ? '!' : ''}:${n.v}`);
  const top = L.dlDescribe('$$a$$ and $$b$$', lex);
  assert.equal(top.length, 1);
  assert.equal(top[0].t, 'paragraph');
  assert.ok(!top[0].c.some((n) => n.display));
  assert.equal(top[0].c.map(shape).join('|').replace(/[ID]:/g, '$:').includes('and'), true);
  const loose = L.dlDescribe('- one\n\n- $$a$$ and $$b$$\n', lex);
  const item = loose[0].items[1].c;
  assert.equal(item.length, 1);
  assert.equal(item[0].t, 'paragraph');
  assert.ok(!item[0].c.some((n) => n.display));
  const block = L.dlDescribe('$$\nx\n$$', lex);
  assert.deepEqual([block[0].t, block[0].tex, block[0].display], ['math', 'x', true]);
  const inBlock = L.dlDescribe('- one\n\n- $$\n  x\n  $$\n', lex);
  assert.deepEqual([inBlock[0].items[1].c[0].t, inBlock[0].items[1].c[0].display], ['math', true]);
  const two = L.dlDescribe('see $a$ and $b$ here', lex);
  assert.equal(two[0].c.filter((n) => n.t === 'math').length, 2);
});
test('real marked: a footnote mark is shown as it is written and flagged raw; nothing else about the line changes', () => {
  const r = real('A claim.[^1] More [^note-2].\n\n[^1]: The **note** text.');
  assert.deepEqual(r.desc[0].c, [{ t: 'text', v: 'A claim.' }, { t: 'text', v: '[^1]', raw: true }, { t: 'text', v: ' More ' }, { t: 'text', v: '[^note-2]', raw: true }, { t: 'text', v: '.' }]);
  assert.deepEqual(r.desc[1].c.slice(0, 2), [{ t: 'text', v: '[^1]:', raw: true }, { t: 'text', v: ' The ' }]);
  assert.equal(r.desc[1].c[2].t, 'strong');
  assert.equal(r.root.textContent, 'A claim.[^1] More [^note-2].[^1]: The note text.');
  assert.deepEqual(r.d.sinks, []);
  // not a mark: its brackets escaped, a space inside, nothing inside, a second ^, or inside code
  for (const md of ['A \\[^1\\] b', 'A [^ 1] b', 'A [^] b', 'A [^a^b] b', 'A `[^1]` b', `A [^${'x'.repeat(65)}] b`]) {
    const flat = JSON.stringify(real(md).desc);
    assert.ok(!flat.includes('"raw":true'), md);
  }
  // a formula found in the words is still found, and the words on both sides of it are still read
  const m = real('x [^1] $5 or$ y [^2]');
  assert.deepEqual(m.desc[0].c.map((n) => (n.t === 'math' ? `$${n.tex}$` : `${n.raw ? 'RAW:' : ''}${n.v}`)), ['x ', 'RAW:[^1]', ' ', '$5 or$', ' y ', 'RAW:[^2]']);
  // a hostile mark is still only text
  const h = real('[^<script>alert(1)</script>] [^1]: <img src=x onerror=alert(1)>');
  assert.deepEqual(h.d.sinks, []);
  assert.ok(!h.nodes.some((n) => ['script', 'img'].includes(n.tag)));
});
test('dlEscapeLabel: a written label reads back as the same label', () => {
  const labels = ['Plain', 'Board [2]', 'a \\ b', 'trailing \\', '`code`', 'a & b', '&amp; &lt; &#35; &copy;', '*star* _under_ ~tilde~', '<b>x</b>', '$a$ and $b$', '![x]', 'a|b', '\\[x\\]', '[]', ']\\[', '\\\\', '&', 'x &amp', 'one\ntwo', '"quote" \'single\'', 'a (b) [c](d)', '[a](b)', '](x)', 'f(x) = [1](2)'];
  for (const label of labels) {
    const want = label.replace(/\s*\n\s*/g, ' ');
    const r = real(`[${L.dlEscapeLabel(label)}](object:m:k:id)`);
    const chip = r.desc[0].c[0];
    assert.equal(chip.t, 'object', JSON.stringify(label));
    assert.equal(chip.label, want, JSON.stringify(label));
    assert.equal(r.desc[0].c.length, 1, JSON.stringify(label));
    assert.deepEqual(r.d.sinks, []);
  }
  assert.equal(L.dlEscapeLabel('a[b]\\'), 'a\\[b\\]\\\\');
  assert.equal(L.dlEscapeLabel(null), '');
});
test('corpus (real marked): hostile text never becomes markup or a live address', () => {
  const lines = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '[x](javascript:alert(1))', '![a](javascript:alert(1))', '$<img src=x onerror=alert(1)>$', '$$<script>1</script>$$',
    '[$\\{x\\}$](javascript:1)', '- [ ] <b onclick=1>\n\n- [x] [a](data:text/html,x)', '[<i>](object:a:b:c d)', '```"><svg onload=1>\n<x>\n```', '[\\[<script>\\]](object:wb:board:b-1)', '$a\\$ <iframe src=javascript:1> $b$'];
  for (const md of lines) {
    const r = real(md);
    assert.deepEqual(r.d.sinks, [], md);
    const tags = r.nodes.map((n) => n.tag);
    for (const bad of ['script', 'img', 'iframe', 'svg', 'b', 'i', 'x']) assert.ok(!tags.includes(bad), `${bad} in ${md}`);
    for (const n of r.nodes) {
      if (n.tag === 'a') assert.ok(/^(https?:|mailto:)/.test(n.attrs.href), md);
      for (const [k, v] of Object.entries(n.attrs || {})) assert.ok(!/^on/i.test(k) && !/javascript:/i.test(v), `${k}=${v} in ${md}`);
    }
  }
  assert.ok(real(lines[0]).root.textContent.includes('<script>alert(1)</script>'));
  assert.equal(real('$<img src=x onerror=alert(1)>$').root.textContent, '$<img src=x onerror=alert(1)>$');
});
const dlStub = L.dlStubEditor;

// ---- the editor adapter: no text per key ----------------------------------------------------------------------------------------
test('editor: 300 keys, schedule and dirty checks read the text 0 times; save reads it once', () => {
  const e = dlStub('hello');
  const saved = { text: 'hello', title: 'T', paper: 'p' };
  let savedRev = e.revision();
  let timers = 0;
  e.onChange(() => { timers += 1; L.dlEditorDirty(e, savedRev, saved, 'T', 'p'); });
  assert.equal(L.dlEditorDirty(e, savedRev, saved, 'T', 'p'), false);
  for (let i = 0; i < 300; i++) e.type(`hello${'x'.repeat(i + 1)}`);
  assert.equal(timers, 300);
  assert.equal(e.calls.getText, 0);
  assert.equal(L.dlEditorDirty(e, savedRev, saved, 'T', 'p'), true);
  const snap = L.dlEditorSnapshot(e, saved, 'T', 'p');
  assert.equal(e.calls.getText, 1);
  assert.equal(snap.changed, true);
  savedRev = snap.rev;
  assert.equal(L.dlEditorDirty(e, savedRev, saved, 'T', 'p'), false);
});
test('editor: typed then deleted back is dirty by counter, but the save finds nothing to write', () => {
  const e = dlStub('abc');
  const saved = { text: 'abc', title: 'T', paper: 'p' };
  const savedRev = e.revision();
  e.type('abcd'); e.type('abc');
  assert.equal(L.dlEditorDirty(e, savedRev, saved, 'T', 'p'), true);
  const snap = L.dlEditorSnapshot(e, saved, 'T', 'p');
  assert.equal(snap.changed, false);
  assert.equal(e.calls.getText, 1);
  assert.equal(L.dlEditorDirty(e, snap.rev, saved, 'T', 'p'), false);
});
test('editor: a changed title or paper is dirty without any key, and reads no text', () => {
  const e = dlStub('abc');
  const saved = { text: 'abc', title: 'T', paper: 'p' };
  assert.equal(L.dlEditorDirty(e, e.revision(), saved, 'T2', 'p'), true);
  assert.equal(L.dlEditorDirty(e, e.revision(), saved, 'T', 'q'), true);
  assert.equal(e.calls.getText, 0);
});
test('editor: setText and run count as changes; every action name has a function', () => {
  const e = dlStub('a');
  const r0 = e.revision();
  e.setText('b'); assert.ok(e.revision() > r0);
  const r1 = e.revision();
  e.run('bold'); assert.ok(e.revision() > r1);
  for (const a of L.DL_ACTIONS) { const q = e.revision(); e.run(a); assert.ok(e.revision() > q, a); }
  const q = e.revision(); e.run('nonsense'); assert.equal(e.revision(), q);
});
test('editor: the textarea adapter reads and writes the box, counts input events and destroys cleanly', () => {
  const ls = [];
  const ta = { value: '', readOnly: false, selectionStart: 0, selectionEnd: 0, addEventListener: (t, f) => ls.push(f), removeEventListener: (t, f) => ls.splice(ls.indexOf(f), 1), focus() {}, select() {}, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; } };
  const e = L.dlTextareaEditor(ta, {});
  let n = 0; e.onChange(() => { n += 1; });
  e.setText('hi'); assert.equal(ta.value, 'hi'); assert.equal(e.getText(), 'hi');
  e.setReadOnly(true); assert.equal(ta.readOnly, true);
  const r = e.revision(); ls.forEach((f) => f()); assert.equal(n, 1); assert.equal(e.revision(), r + 1);
  ta.setSelectionRange(0, 2); e.run('bold'); assert.equal(ta.value, '**hi**'); assert.equal(n, 2);
  e.destroy(); assert.equal(ls.length, 0);
});

// ---- the automatic page breaks (documents-lib-s-pages.js) ------------------------------------------------------------------------------
{
  const B = (height, kind = 'block', rows) => ({ height, kind, ...(rows ? { rows } : {}) });
  const BR = { height: 0, kind: 'pagebreak' };
  const shape = (r) => r.pages.map((p) => p.items.map((x) => (x.from === undefined ? x.i : `${x.i}[${x.from}-${x.to}]`)));
  const H = L.dlPageGeometry('letter').textH;
  const H4 = L.dlPageGeometry('a4').textH;
  test('pages: the text areas are 864 and 931 px', () => { assert.equal(H, 864); assert.equal(H4, 931); });
  test('pages: nothing is no page', () => { assert.deepEqual(L.dlPageBreaks([], H), { pages: [], before: [] }); assert.deepEqual(L.dlPageBreaks(null, H).pages, []); });
  test('pages: one block is one page', () => { assert.deepEqual(shape(L.dlPageBreaks([B(40)], H)), [[0]]); });
  test('pages: an exact fit stays, one px more moves on', () => {
    assert.deepEqual(shape(L.dlPageBreaks([B(400), B(464)], H)), [[0, 1]]);
    assert.deepEqual(shape(L.dlPageBreaks([B(400), B(465)], H)), [[0], [1]]);
    assert.deepEqual(shape(L.dlPageBreaks([B(400), B(531)], H4)), [[0, 1]]);
    assert.deepEqual(shape(L.dlPageBreaks([B(400), B(532)], H4)), [[0], [1]]);
  });
  test('pages: a block taller than a page has a page of its own and is marked tall', () => {
    const r = L.dlPageBreaks([B(100), B(2000, 'code'), B(100)], H);
    assert.deepEqual(shape(r), [[0], [1], [2]]);
    assert.deepEqual(r.pages.map((p) => p.tall), [false, true, false]);
    assert.deepEqual(shape(L.dlPageBreaks([B(900), B(10)], H)), [[0], [1]]);
  });
  test('pages: a manual break starts a page and is in no items', () => {
    const r = L.dlPageBreaks([B(10), BR, B(10)], H);
    assert.deepEqual(shape(r), [[0], [2]]);
    assert.deepEqual(r.pages[0].breaks, [1]);
  });
  test('pages: a break first or last makes no empty page', () => {
    const a = L.dlPageBreaks([BR, B(10), B(10)], H);
    assert.deepEqual(shape(a), [[1, 2]]);
    assert.deepEqual(a.before, [0]);
    const z = L.dlPageBreaks([B(10), BR], H);
    assert.deepEqual(shape(z), [[0]]);
    assert.deepEqual(z.pages[0].breaks, [1]);
    assert.deepEqual(shape(L.dlPageBreaks([BR], H)), []);
  });
  test('pages: consecutive breaks make an empty page each', () => {
    assert.deepEqual(shape(L.dlPageBreaks([B(10), BR, BR, B(10)], H)), [[0], [], [3]]);
    assert.deepEqual(shape(L.dlPageBreaks([B(10), BR, BR, BR, B(10)], H)), [[0], [], [], [4]]);
    assert.deepEqual(shape(L.dlPageBreaks([BR, BR, B(10)], H)), [[], [2]]);
    assert.deepEqual(shape(L.dlPageBreaks([B(10), BR, BR], H)), [[0], []]);
  });
  test('pages: a grid breaks between rows and the rest goes on', () => {
    const rows = [30, 400, 400, 400, 400];
    const r = L.dlPageBreaks([B(100), B(1630, 'grid', rows)], H);
    assert.deepEqual(shape(r), [[0, '1[0-2]'], ['1[2-4]'], ['1[4-5]']]);
    assert.deepEqual(shape(L.dlPageBreaks([B(100), B(830, 'grid', [30, 400, 400])], H)), [[0, '1[0-2]'], ['1[2-3]']]);
  });
  test('pages: a grid that fits whole stays whole; the head row is never alone', () => {
    assert.deepEqual(shape(L.dlPageBreaks([B(800), B(150, 'grid', [30, 60, 60])], H)), [[0], [1]]);
    assert.deepEqual(shape(L.dlPageBreaks([B(800), B(500, 'grid', [30, 100, 100, 100, 100, 100, 70])], H)), [[0], [1]]);
    assert.deepEqual(shape(L.dlPageBreaks([B(700), B(500, 'grid', [30, 100, 100, 100, 100, 100, 70])], H)), [[0, '1[0-2]'], ['1[2-7]']]);
  });
  test('pages: a row taller than a page is not cut', () => {
    const r = L.dlPageBreaks([B(1500, 'grid', [30, 1470])], H);
    assert.deepEqual(shape(r), [['0[0-1]'], ['0[1-2]']]);
    assert.ok(r.pages.some((p) => p.tall));
  });
  test('pages: a heading goes with what follows it', () => {
    assert.deepEqual(shape(L.dlPageBreaks([B(800), B(30, 'heading'), B(100)], H)), [[0], [1, 2]]);
    assert.deepEqual(shape(L.dlPageBreaks([B(800), B(30, 'heading'), B(30, 'heading'), B(100)], H)), [[0], [1, 2, 3]]);
    assert.deepEqual(shape(L.dlPageBreaks([B(800), B(30, 'heading'), B(30)], H)), [[0, 1, 2]]);
    assert.deepEqual(shape(L.dlPageBreaks([B(800), B(30, 'heading'), B(30, 'code')], H)), [[0, 1, 2]]);
  });
  test('pages: a heading before a grid takes the head row and one more', () => {
    assert.deepEqual(shape(L.dlPageBreaks([B(800), B(30, 'heading'), B(500, 'grid', [30, 100, 100, 100, 100, 100, 70])], H)), [[0], [1, 2]]);
  });
  test('pages: a heading before a manual break is not held back, and one before a page-sized block goes with it', () => {
    assert.deepEqual(shape(L.dlPageBreaks([B(820), B(30, 'heading'), BR, B(10)], H)), [[0, 1], [3]]);
    assert.deepEqual(shape(L.dlPageBreaks([B(30, 'heading'), B(3000, 'code')], H)), [[0, 1]]);
    assert.deepEqual(shape(L.dlPageBreaks([B(100), B(30, 'heading'), B(3000, 'code')], H)), [[0], [1, 2]]);
  });
  test('pages: 100 manual pages', () => {
    const list = [];
    for (let n = 0; n < 100; n += 1) { list.push(B(300), B(30, 'heading'), B(200)); if (n < 99) list.push(BR); }
    const r = L.dlPageBreaks(list, H);
    assert.equal(r.pages.length, 100);
    assert.ok(r.pages.every((p) => p.items.length === 3));
  });
  test('pages: every block is placed once, in order, whatever the heights', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const kinds = ['block', 'heading', 'code', 'formula', 'grid', 'pagebreak'];
    for (let round = 0; round < 200; round += 1) {
      const list = [];
      for (let n = 0; n < 40; n += 1) {
        const kind = kinds[Math.floor(rnd() * kinds.length)];
        if (kind === 'pagebreak') list.push(BR);
        else if (kind === 'grid') { const rows = Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => 20 + Math.floor(rnd() * 200)); list.push(B(rows.reduce((a, x) => a + x, 0) + 12, 'grid', rows)); }
        else list.push(B(Math.floor(rnd() * 1200), kind));
      }
      const r = L.dlPageBreaks(list, H);
      const seen = [];
      for (const p of r.pages) {
        let used = 0;
        for (const x of p.items) { if (x.from === undefined || x.from === 0) seen.push(x.i); used += x.from === undefined ? list[x.i].height : list[x.i].rows.slice(x.from, x.to).reduce((a, y) => a + y, 0); }
        if (!p.tall) assert.ok(used <= H + 12, `a page of ${used} px in round ${round}`);
      }
      const want = list.map((b, i) => (b.kind === 'pagebreak' ? -1 : i)).filter((i) => i >= 0);
      assert.deepEqual(seen, want);
    }
  });
}

await Promise.all(pending);
if (fails.length) { console.error(`documents lib: ${fails.length} failed, ${passed} passed`); for (const f of fails) console.error(`  - ${f}`); process.exit(1); }
console.log(`documents lib: ${passed} tests passed`);
