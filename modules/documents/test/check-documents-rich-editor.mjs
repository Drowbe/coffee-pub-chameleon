#!/usr/bin/env node
/*
 * check-documents-rich-editor.mjs -- the rich editor behind the editor adapter (documents-lib-p-rich-editor.js), in Node with
 * no page: dlRichEditor(PM, doc, lex, null) is the same object the page uses, without the drawing. What needs a browser (the
 * caret, the keys as events, the clipboard, the toolbar) is checked live, not here.
 *
 * 1. THE CONTRACT. The names every editor has; the counter moves on a change of the text and on setText, never on a move of
 *    the caret or on getText; onChange is called once for each change; destroy lets go.
 * 2. OPEN, THEN DONE. For every corpus text: setText then getText gives the stored text character for character.
 * 3. TYPING. Words typed in one paragraph, one heading and one list row change that block's characters and no other.
 * 4. THE ACTIONS. Every name the bar has: the ones the rich editor does (bold, italic, code, h1 to h4, list, numbered,
 *    checklist, quote) do what they say and undo themselves on a second press; link, grid and formula do nothing and say false;
 *    an unknown name does nothing; a read-only editor does nothing. The reader's bounds hold.
 * 5. THE KEYS. Exactly the editor's own keys are bound (Mod-s is not); Enter makes a row, a checklist row an open one; Tab
 *    moves a row in and stops at the fourth level; Shift-Tab moves it out; Shift-Enter is a line break in a paragraph and
 *    nothing in a heading; undo and redo.
 * 6. WHAT MARKDOWN CANNOT SAY. Each state typing passes through (a space at an end, a line break at an end, an empty last
 *    row, line breaks at the end of code...) is written so that it reads back, with no whole-text rewrite and every other
 *    block's characters as stored; over the whole corpus too.
 * 7. PASTE. Plain text is read as Markdown through the reader; hostile text makes no link to a refused address and no node
 *    the schema refuses; inside code the text goes in as it is; 2,000,000 characters are held whole, quickly.
 * 8. COPY. The selection as Markdown.
 *
 * Usage: node modules/documents/test/check-documents-rich-editor.mjs [path to the src folder]. Exits 1 on any failure.
 */
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadRich, CASES, HOSTILE, sourceDocs } from './support/rich-corpus.mjs';

const t0 = Date.now();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(root, 'modules/documents/src'));
const { PM, L, lex } = loadRich(src, ['DL', 'DL_ACTIONS', 'DL_MARKED_MATH', 'DL_MARKED_HOOKS', 'dlRichHref', 'dlRichSchema', 'dlRichRead', 'dlRichText', 'dlRichEditor', 'dlRichTidy',
  'dlRichCommand', 'dlRichCan', 'dlRichKeys', 'dlRichPasteSlice', 'dlRichCopy', 'dlRichInertText', 'dlRichClipText', 'DL_RICH_ACTIONS', 'DL_RICH_KEYS', 'dlTextareaEditor', 'dlStubEditor', 'dlEditorDirty', 'dlEditorSnapshot']);
const schema = L.dlRichSchema(PM);
const N = schema.nodes;
const M = schema.marks;

let passed = 0;
const fails = [];
function test(name, fn) { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

const open = (md) => { const ed = L.dlRichEditor(PM, null, lex, null); ed.setText(md); return ed; };
const posOf = (doc, i) => { let p = 0; for (let k = 0; k < i; k += 1) p += doc.child(k).nodeSize; return p; };
const endOf = (doc, i) => posOf(doc, i) + doc.child(i).nodeSize - 1;
// Puts the selection in block i: from `a` to `b` characters into its words (the caret at `a` when `b` is not given).
const select = (ed, i, a = 0, b = a, deep = 1) => { const st = ed.state(); const at = posOf(st.doc, i) + deep; ed.dispatch(st.tr.setSelection(PM.TextSelection.create(st.doc, at + a, at + b))); };
// Where a word stands in the text (the position before it).
const wordAt = (doc, word) => { let at = -1; doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(word)) at = pos + n.text.indexOf(word); }); return at; };
const key = (ed, name) => L.dlRichKeys(PM)[name](ed.state(), ed.dispatch);
const text = (ed) => ed.state().doc.toString();
const TEXT = 'A __bold__ start\n\n* one\n* two\n\nTitle\n=====\n\n```\ncode\n```\n\n> said\n\nEnd _it_ here\n';

// ---- 1. the contract -----------------------------------------------------------------------------------------------------------
test('the rich editor has every name of the contract', () => {
  const ed = open('x\n');
  const plain = L.dlStubEditor('x');
  for (const name of ['getText', 'setText', 'setReadOnly', 'focus', 'onChange', 'run', 'destroy', 'revision']) {
    assert.equal(typeof ed[name], 'function', name);
    assert.equal(typeof plain[name], 'function', `the stand-in has ${name} too`);
  }
  assert.equal(typeof ed.selectAll, 'function');
});
test('the counter moves on a change of the text and on setText, not on the caret or on getText', () => {
  const ed = L.dlRichEditor(PM, null, lex, null);
  let heard = 0;
  ed.onChange(() => { heard += 1; });
  const r0 = ed.revision();
  ed.setText('one\n\ntwo\n');
  const r1 = ed.revision();
  assert.equal(r1, r0 + 1, 'setText counts');
  assert.equal(heard, 0, 'setText is not a change a person made');
  select(ed, 1, 1);
  ed.getText(); ed.getText();
  ed.focus(); ed.setReadOnly(false);
  assert.equal(ed.revision(), r1, 'the caret, getText, focus and setReadOnly do not count');
  ed.dispatch(ed.state().tr.insertText('x'));
  assert.equal(ed.revision(), r1 + 1);
  assert.equal(heard, 1);
  ed.run('bold'); // nothing selected: the next words will be bold, the text is the same
  assert.equal(ed.revision(), r1 + 1, 'an action that changes no text does not count');
  select(ed, 0, 0, 3);
  ed.run('bold');
  assert.equal(ed.revision(), r1 + 2, 'an action that changes the text counts');
  assert.equal(heard, 2);
  ed.destroy();
  ed.dispatch(ed.state().tr.insertText('y'));
  assert.equal(heard, 2, 'destroy lets go of the listeners');
});
test('dirty and the one read at save time work on the rich editor as on the text box', () => {
  const ed = open('one\n');
  const saved = { text: 'one\n', title: 'T', paper: 'light-white' };
  const rev = ed.revision();
  assert.equal(L.dlEditorDirty(ed, rev, saved, 'T', 'light-white'), false);
  select(ed, 0, 3);
  ed.dispatch(ed.state().tr.insertText('!'));
  assert.equal(L.dlEditorDirty(ed, rev, saved, 'T', 'light-white'), true);
  const snap = L.dlEditorSnapshot(ed, saved, 'T', 'light-white');
  assert.deepEqual([snap.text, snap.changed, snap.rev], ['one!\n', true, rev + 1]);
  ed.dispatch(ed.state().tr.delete(4, 5)); // typed, then taken out again: the counter moved, the text did not
  const again = L.dlEditorSnapshot(ed, saved, 'T', 'light-white');
  assert.deepEqual([again.text, again.changed], ['one\n', false]);
});
test('selectAll selects the whole text', () => {
  const ed = open(TEXT);
  ed.selectAll();
  const sel = ed.state().selection;
  assert.deepEqual([sel.from, sel.to], [0, ed.state().doc.content.size]);
});

// ---- 2. open, then Done ------------------------------------------------------------------------------------------------------
test(`open then Done gives the stored text exactly (corpus ${CASES.length}, hostile ${HOSTILE.length})`, () => {
  for (const md of [...CASES.map((c) => c[1]), ...HOSTILE.map((h) => (Array.isArray(h) ? h[1] : h)).filter((h) => typeof h === 'string')]) {
    const ed = open(md);
    assert.equal(ed.getText(), md, JSON.stringify(md).slice(0, 80));
    assert.equal(ed.lastWrite().changed, false);
    ed.dispatch(ed.state().tr.setSelection(PM.Selection.atEnd(ed.state().doc)));
    assert.equal(ed.getText(), md, 'after a move of the caret');
  }
});
test('setText starts again: a new text, a new table, nothing to undo', () => {
  const ed = open('one\n');
  select(ed, 0, 3);
  ed.dispatch(ed.state().tr.insertText('!'));
  assert.equal(ed.getText(), 'one!\n');
  ed.setText('* a\n* b\n');
  assert.equal(ed.getText(), '* a\n* b\n');
  assert.equal(PM.undo(ed.state(), ed.dispatch), false, 'the changes before setText cannot be undone into the new text');
});

// ---- 3. typing ---------------------------------------------------------------------------------------------------------------
test('typing in one paragraph, one heading, one list row changes that block only', () => {
  const blocks = TEXT.split('\n\n');
  const typed = (i, deep, expectBlock) => {
    const ed = open(TEXT);
    const at = endOf(ed.state().doc, i) - (deep - 1);
    ed.dispatch(ed.state().tr.insertText(' zq', at));
    const out = ed.getText().split('\n\n');
    assert.equal(out.length, blocks.length);
    out.forEach((b, k) => { if (k === i) assert.equal(b, expectBlock, `block ${i}`); else assert.equal(b, blocks[k], `block ${k} is as stored when ${i} is typed in`); });
    assert.deepEqual([ed.lastWrite().same, ed.lastWrite().whole], [true, false]);
  };
  typed(0, 1, 'A **bold** start zq');
  typed(2, 1, '# Title zq');
  typed(1, 3, '- one\n- two zq');
  typed(5, 1, 'End *it* here zq\n');
});

// ---- 4. the actions ----------------------------------------------------------------------------------------------------------
test('every action the bar has is known: done by the rich editor, or false and nothing', () => {
  assert.deepEqual(L.DL_ACTIONS.filter((a) => !L.dlRichCan(a)), ['link', 'grid', 'formula']);
  for (const a of L.DL_ACTIONS) assert.equal(Boolean(L.dlRichCommand(PM, a)), L.dlRichCan(a), a);
  for (const a of ['link', 'grid', 'formula', 'nope', '', undefined, 'h5', 'constructor', '__proto__']) {
    const ed = open(TEXT);
    select(ed, 0, 0, 5);
    const before = ed.state().doc;
    const rev = ed.revision();
    assert.equal(ed.run(a), false, String(a));
    assert.ok(ed.state().doc === before, `${a} changes nothing`);
    assert.equal(ed.revision(), rev);
    assert.equal(ed.getText(), TEXT);
  }
});
test('bold, italic and code are put on the selection and taken off again', () => {
  for (const [action, mark, written] of [['bold', M.strong, '**plain**'], ['italic', M.em, '*plain*'], ['code', M.code, '`plain`']]) {
    const ed = open('some plain words\n\nnext __one__\n');
    select(ed, 0, 5, 10);
    assert.equal(ed.run(action), true);
    assert.ok(ed.state().doc.rangeHasMark(6, 11, mark), action);
    const sel = ed.state().selection;
    assert.deepEqual([sel.from, sel.to], [6, 11], 'the selection is kept');
    assert.equal(ed.getText(), `some ${written} words\n\nnext __one__\n`);
    assert.equal(ed.run(action), true);
    assert.equal(ed.getText(), 'some plain words\n\nnext __one__\n', 'taken off again: the stored text, exactly');
  }
});
test('a heading level is set, changed, and taken off by the same level again', () => {
  const ed = open('one\n\ntwo __x__\n');
  select(ed, 0, 1);
  assert.equal(ed.run('h2'), true);
  assert.equal(ed.getText(), '## one\n\ntwo __x__\n');
  assert.equal(ed.run('h4'), true);
  assert.equal(ed.getText(), '#### one\n\ntwo __x__\n');
  assert.equal(ed.run('h4'), true);
  assert.equal(ed.getText(), 'one\n\ntwo __x__\n');
});
test('the three lists: made, changed from one kind to another, and left', () => {
  const ed = open('one\n\ntwo __x__\n');
  select(ed, 0, 1);
  assert.equal(ed.run('list'), true);
  assert.equal(ed.getText(), '- one\n\ntwo __x__\n');
  assert.equal(ed.run('numbered'), true);
  assert.equal(ed.getText(), '1. one\n\ntwo __x__\n');
  assert.equal(ed.run('checklist'), true);
  assert.equal(ed.getText(), '1. [ ] one\n\ntwo __x__\n');
  assert.equal(ed.run('list'), true);
  assert.equal(ed.getText(), '- [ ] one\n\ntwo __x__\n');
  assert.equal(ed.run('list'), true, 'a bullet list with boxes: the boxes go first');
  assert.equal(ed.getText(), '- one\n\ntwo __x__\n');
  assert.equal(ed.run('list'), true);
  assert.equal(ed.getText(), 'one\n\ntwo __x__\n', 'out of the list: the stored text, exactly');
  assert.equal(ed.run('checklist'), true);
  assert.equal(ed.getText(), '- [ ] one\n\ntwo __x__\n');
  assert.equal(ed.run('checklist'), true);
  assert.equal(ed.getText(), '- one\n\ntwo __x__\n');
  assert.equal(ed.run('numbered'), true);
  assert.equal(ed.run('numbered'), true);
  assert.equal(ed.getText(), 'one\n\ntwo __x__\n');
});
test('a quote is put around the block and taken off again', () => {
  const ed = open('one\n\ntwo __x__\n');
  select(ed, 0, 1);
  assert.equal(ed.run('quote'), true);
  assert.equal(ed.getText(), '> one\n\ntwo __x__\n');
  assert.equal(ed.run('quote'), true);
  assert.equal(ed.getText(), 'one\n\ntwo __x__\n');
});
test('an action that does not fit where the selection is does nothing and says false', () => {
  const ed = open('```\ncode\n```\n\n---\n');
  select(ed, 0, 0, 3);
  for (const a of ['bold', 'italic', 'code']) assert.equal(ed.run(a), false, a);
  assert.equal(ed.getText(), '```\ncode\n```\n\n---\n');
});
test('a read-only editor does nothing: no action, no paste', () => {
  const ed = open('one two\n');
  select(ed, 0, 0, 3);
  ed.setReadOnly(true);
  for (const a of L.DL_ACTIONS) assert.equal(ed.run(a), false, a);
  assert.equal(ed.paste('pasted'), false);
  assert.equal(ed.getText(), 'one two\n');
  ed.setReadOnly(false);
  assert.equal(ed.run('bold'), true);
  assert.equal(ed.getText(), '**one** two\n');
});
test('the bounds hold: no fifth list level by an action', () => {
  const ed = open('- 1\n  - 2\n    - 3\n      - 4\n');
  const st = ed.state();
  let deepest = 0;
  st.doc.descendants((n, pos) => { if (n.isText && n.text === '4') deepest = pos; });
  ed.dispatch(st.tr.setSelection(PM.TextSelection.create(st.doc, deepest)));
  const before = ed.state().doc;
  assert.equal(L.dlRichKeys(PM).Tab(ed.state(), ed.dispatch), true, 'Tab is taken');
  assert.ok(ed.state().doc === before, 'and nothing happens');
  // a selection from a paragraph into a list four deep: a list around both would be a fifth level
  const mixed = open('before\n\n- 1\n  - 2\n    - 3\n      - 4\n');
  mixed.dispatch(mixed.state().tr.setSelection(PM.TextSelection.create(mixed.state().doc, 2, wordAt(mixed.state().doc, '4'))));
  const was = mixed.state().doc;
  for (const a of ['list', 'numbered', 'checklist']) assert.equal(mixed.run(a), false, a);
  assert.ok(mixed.state().doc === was);
  const three = open('before\n\n- 1\n  - 2\n    - 3\n');
  three.dispatch(three.state().tr.setSelection(PM.TextSelection.create(three.state().doc, 2, wordAt(three.state().doc, '3'))));
  assert.equal(three.run('list'), true, 'three levels may go into a list: four in all');
  const depth = (n) => { let most = 0; n.forEach((c) => { most = Math.max(most, (/_list$/.test(c.type.name) ? 1 : 0) + depth(c)); }); return most; };
  assert.equal(depth(three.state().doc), 4);
});

// ---- 5. the keys -------------------------------------------------------------------------------------------------------------
test('exactly the editor\'s own keys are bound; Mod-s and the zoom keys are not', () => {
  assert.deepEqual(Object.keys(L.dlRichKeys(PM)).sort(), [...L.DL_RICH_KEYS].sort());
  for (const k of ['Mod-s', 'Mod-=', 'Mod-+', 'Mod--', 'Mod-0', 'Escape', 'Mod-b', 'Mod-i']) assert.equal(k in L.dlRichKeys(PM), false, k);
  for (const k of ['Mod-s', 'Mod-=', 'Mod--', 'Mod-0', 'Escape']) assert.equal(k in PM.baseKeymap, false, `the base keys do not bind ${k}`);
  for (const k of ['Enter', 'Backspace', 'Delete', 'Mod-a']) assert.equal(k in PM.baseKeymap, true, `the base keys bind ${k}`);
});
test('Enter in a list row makes the next row; a checklist row makes an open one', () => {
  const ed = open('* one\n* two\n\nend __x__\n');
  const st = ed.state();
  ed.dispatch(st.tr.setSelection(PM.TextSelection.create(st.doc, 6))); // after "one"
  assert.equal(key(ed, 'Enter'), true);
  assert.equal(ed.state().doc.firstChild.childCount, 3);
  ed.dispatch(ed.state().tr.insertText('new'));
  assert.equal(ed.getText(), '- one\n- new\n- two\n\nend __x__\n');
  const boxes = open('- [x] done\n');
  boxes.dispatch(boxes.state().tr.setSelection(PM.TextSelection.create(boxes.state().doc, 7)));
  assert.equal(key(boxes, 'Enter'), true);
  boxes.dispatch(boxes.state().tr.insertText('next'));
  assert.equal(boxes.getText(), '- [x] done\n- [ ] next\n');
  const para = open('one\n');
  select(para, 0, 3);
  assert.equal(key(para, 'Enter'), false, 'outside a list Enter is the base keys\'');
  assert.equal(PM.baseKeymap.Enter(para.state(), para.dispatch), true);
  assert.equal(para.state().doc.childCount, 2);
});
test('Tab moves a row in, Shift-Tab out; outside a list Tab is not taken', () => {
  const ed = open('- one\n- two\n\nend __x__\n');
  const st = ed.state();
  ed.dispatch(st.tr.setSelection(PM.TextSelection.create(st.doc, 11))); // in "two"
  assert.equal(key(ed, 'Tab'), true);
  assert.equal(ed.getText(), '- one\n  - two\n\nend __x__\n');
  assert.equal(key(ed, 'Shift-Tab'), true);
  assert.equal(ed.getText(), '- one\n- two\n\nend __x__\n');
  select(ed, 1, 1);
  const before = ed.state().doc;
  assert.equal(key(ed, 'Tab'), false, 'in a paragraph Tab is the browser\'s: the keyboard can leave the editor');
  assert.ok(ed.state().doc === before);
});
test('Shift-Enter is a line break in a paragraph, a new line in code, nothing in a heading', () => {
  const ed = open('one two\n\n# Head\n\n```\nab\n```\n');
  select(ed, 0, 3);
  assert.equal(key(ed, 'Shift-Enter'), true);
  assert.equal(ed.getText(), 'one\\\ntwo\n\n# Head\n\n```\nab\n```\n');
  select(ed, 1, 2);
  const before = ed.state().doc;
  assert.equal(key(ed, 'Shift-Enter'), true, 'taken, so the browser adds no line of its own');
  assert.ok(ed.state().doc === before, 'a heading is one line');
  select(ed, 2, 1);
  assert.equal(key(ed, 'Shift-Enter'), true);
  assert.equal(ed.getText(), 'one\\\ntwo\n\n# Head\n\n```\na\nb\n```\n');
});
test('undo and redo, and Backspace joins two blocks', () => {
  const ed = open('one\n\ntwo\n');
  select(ed, 0, 3);
  ed.dispatch(ed.state().tr.insertText(' more'));
  assert.equal(ed.getText(), 'one more\n\ntwo\n');
  assert.equal(key(ed, 'Mod-z'), true);
  assert.equal(ed.getText(), 'one\n\ntwo\n', 'undone: the stored text, exactly');
  assert.equal(key(ed, 'Mod-Shift-z'), true);
  assert.equal(ed.getText(), 'one more\n\ntwo\n');
  assert.equal(key(ed, 'Mod-z'), true);
  assert.equal(key(ed, 'Mod-y'), true);
  assert.equal(ed.getText(), 'one more\n\ntwo\n');
  select(ed, 1, 0);
  assert.equal(PM.baseKeymap.Backspace(ed.state(), ed.dispatch), true);
  assert.equal(ed.getText(), 'one moretwo\n');
});

// ---- 6. what Markdown cannot say ---------------------------------------------------------------------------------------------
const row = (checked = null) => N.list_item.create({ checked }, [N.paragraph.create()]);
const STATES = [
  ['a space at the start of a paragraph', (tr) => tr.insertText(' ', 1), TEXT],
  ['a space at the end of a paragraph', (tr, d) => tr.insertText(' ', endOf(d, 0)), TEXT],
  ['a space at the end of the last row of a list', (tr, d) => tr.insertText(' ', endOf(d, 1) - 2), TEXT],
  ['a space at each end of a heading', (tr, d) => tr.insertText(' ', endOf(d, 2)).insertText(' ', posOf(d, 2) + 1), TEXT],
  ['a line break at the end of a paragraph', (tr, d) => tr.insert(endOf(d, 0), N.hard_break.create()), TEXT],
  ['a line break at the start of a paragraph', (tr) => tr.insert(1, N.hard_break.create()), TEXT],
  ['an empty last row', (tr, d) => tr.insert(endOf(d, 1), row()), TEXT],
  ['an empty row inside the last row', (tr, d) => tr.insert(endOf(d, 1) - 1, N.bullet_list.create(null, [row()])), TEXT],
  ['a list whose rows are all empty', (tr, d) => tr.replaceWith(posOf(d, 1), posOf(d, 1) + d.child(1).nodeSize, N.bullet_list.create(null, [row(), row()])), 'A __bold__ start\n\nTitle\n=====\n\n```\ncode\n```\n\n> said\n\nEnd _it_ here\n'],
  ['a line break at the end of code', (tr, d) => tr.insertText('\n', endOf(d, 3)), TEXT],
  ['an empty paragraph at the end of a quote', (tr, d) => tr.insert(endOf(d, 4), N.paragraph.create()), TEXT],
  ['an empty paragraph at the start of a quote', (tr, d) => tr.insert(posOf(d, 4) + 1, N.paragraph.create()), TEXT],
  ['an empty paragraph in a row', (tr, d) => tr.insert(endOf(d, 1) - 1, N.paragraph.create()), TEXT],
  ['an empty paragraph between two blocks', (tr, d) => tr.insert(posOf(d, 1), N.paragraph.create()), TEXT],
];
test(`what Markdown cannot say is left out of the write, and every other character is as stored (${STATES.length} states)`, () => {
  for (const [name, change, want] of STATES) {
    const ed = open(TEXT);
    const st = ed.state();
    ed.dispatch(change(st.tr, st.doc));
    const before = ed.state().doc;
    assert.equal(ed.getText(), want, name);
    assert.deepEqual([ed.lastWrite().same, ed.lastWrite().whole], [true, false], name);
    assert.ok(ed.state().doc === before, `${name}: the editor's own text is not changed by the write`);
  }
});
test('a block nobody changed is never tidied: the stored node is written as stored', () => {
  const read = L.dlRichRead(PM, TEXT, lex);
  assert.ok(L.dlRichTidy(PM, read.doc, read.stored) === read.doc);
  const odd = N.doc.create(null, [N.heading.create({ level: 1 }, [schema.text(' kept as it is ')])]);
  assert.ok(L.dlRichTidy(PM, odd, { entries: [{ node: odd.firstChild }] }) === odd, 'a stored block with spaces at its ends is left alone');
  assert.equal(L.dlRichTidy(PM, odd, { entries: [] }).firstChild.textContent, 'kept as it is', 'the same block, changed by a person, is tidied');
});
test('the states typing passes through, at every place of the corpus: all read back, none rewrites the whole text', () => {
  let runs = 0;
  const bad = [];
  for (const md of [...CASES.map((c) => c[1]), ...sourceDocs(40)]) {
    const base = L.dlRichRead(PM, md, lex);
    const spots = [];
    base.doc.descendants((node, pos) => {
      const end = pos + node.nodeSize - 1;
      if (node.type === N.paragraph || node.type === N.heading) spots.push(['space at the end', (tr) => tr.insertText(' ', end)], ['space at the start', (tr) => tr.insertText(' ', pos + 1)]);
      if (node.type === N.paragraph) spots.push(['line break at the end', (tr) => tr.insert(end, N.hard_break.create())]);
      if (node.type === N.code_block) spots.push(['line break at the end of code', (tr) => tr.insertText('\n', end)]);
      if (node.type === N.bullet_list || node.type === N.ordered_list) spots.push(['empty last row', (tr) => tr.insert(end, row(node.lastChild.attrs.checked === null ? null : false))]);
      if (node.type === N.list_item) spots.push(['empty row inside a row', (tr) => tr.insert(end, N.bullet_list.create(null, [row()]))]);
      return !node.isTextblock;
    });
    for (const [name, change] of spots) {
      const ed = open(md);
      let tr = null;
      try { tr = change(ed.state().tr); } catch (err) { tr = null; } // a place the schema does not allow it
      if (!tr) continue;
      ed.dispatch(tr);
      ed.getText();
      runs += 1;
      if (!ed.lastWrite().same || ed.lastWrite().whole) bad.push(`${name}: ${JSON.stringify(md).slice(0, 70)}`);
    }
  }
  assert.ok(runs > 1000, `runs: ${runs}`);
  assert.deepEqual(bad.slice(0, 5), []);
});
test('a block that does not read back is still written as typed, and the write says so (same: false)', () => {
  const ed = open('<div>a</div>\n\nnext __x__\n');
  select(ed, 0, 1);
  ed.dispatch(ed.state().tr.insertText('y')); // a raw block, changed by a person
  const out = ed.getText();
  assert.equal(out, '<ydiv>a</div>\n\nnext __x__\n');
  assert.equal(ed.lastWrite().same, false);
});

// ---- 7. paste ----------------------------------------------------------------------------------------------------------------
const linksOf = (doc) => { const out = []; doc.descendants((n) => { for (const m of n.marks) if (m.type === M.link) out.push(m.attrs.href); }); return out; };
test('a pasted plain text is read as Markdown and joins the words it lands in', () => {
  const ed = open('one two\n\nend __x__\n');
  select(ed, 0, 4);
  assert.equal(ed.paste('**bold** and [a link](https://example.com/a) '), true);
  assert.equal(ed.getText(), 'one **bold** and [a link](https://example.com/a) two\n\nend __x__\n');
  const lists = open('one\n\nend __x__\n');
  select(lists, 0, 3);
  assert.equal(lists.paste('\n\n- a\n- b\n'), true);
  assert.equal(lists.getText(), 'one\n\n- a\n- b\n\nend __x__\n');
  assert.equal(lists.paste(''), false);
  assert.equal(lists.paste('\n\n'), false, 'blank lines alone put nothing in');
  assert.equal(lists.paste(null), false);
});
test('inside code a pasted text goes in as it is', () => {
  const ed = open('```\nab\n```\n');
  select(ed, 0, 1);
  assert.equal(ed.paste('**x**\r\n<b>'), true);
  assert.equal(ed.getText(), '```\na**x**\n<b>b\n```\n');
});
const HOSTILE_PASTE = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<img src="https://evil.example/pixel.png">',
  '[click](javascript:alert(1))',
  '[click](JaVaScRiPt:alert(1)) and [d](data:text/html,<script>alert(1)</script>) and [v](vbscript:x)',
  '<a href="javascript:alert(1)">x</a>',
  '<div><p><span onclick="alert(1)"><b><i><svg onload=alert(1)><iframe src="https://evil.example/"></iframe></svg></i></b></span></p></div>',
  '![pic](https://evil.example/a.png) and ![x](javascript:alert(1))',
  '<https://ok.example/> <javascript:alert(1)>',
  '[ref]\n\n[ref]: javascript:alert(1)',
  '<style>@import url(https://evil.example/a.css)</style><link rel=stylesheet href=https://evil.example/b.css>',
  '<meta http-equiv="refresh" content="0;url=https://evil.example/">',
  '&lt;script&gt;alert(1)&lt;/script&gt; &#x6a;avascript:alert(1)',
  '[x](&#106;avascript:alert(1))',
  '‮[x](https://example.com/​)\u0000\u0007',
];
test(`hostile pastes: no link to a refused address, nothing the schema refuses (${HOSTILE_PASTE.length} texts)`, () => {
  for (const hostile of HOSTILE_PASTE) {
    const ed = open('one two\n');
    select(ed, 0, 3);
    ed.paste(hostile);
    const doc = ed.state().doc;
    doc.check();
    for (const href of linksOf(doc)) {
      assert.match(href, /^(https?:\/\/|mailto:)/, `${hostile} -> ${href}`);
      assert.equal(L.dlRichHref(href), href);
    }
    assert.equal(/evil\.example|script/i.test(linksOf(doc).join(' ')), false, hostile);
    const out = ed.getText();
    assert.equal(typeof out, 'string');
    const back = L.dlRichRead(PM, out, lex).doc;
    for (const href of linksOf(back)) assert.match(href, /^(https?:\/\/|mailto:)/, `saved and read again: ${href}`);
  }
});
test('2,000,000 pasted characters are held whole, quickly', () => {
  const big = `${'<img src=x onerror=alert(1)> [x](javascript:alert(1)) '.repeat(37100)}`.slice(0, 2000000);
  assert.equal(big.length, 2000000);
  const ed = open('one\n');
  select(ed, 0, 3);
  const s = performance.now();
  assert.equal(ed.paste(big), true);
  const out = ed.getText();
  const ms = performance.now() - s;
  assert.ok(out.length >= 2000000);
  assert.deepEqual(linksOf(ed.state().doc), []);
  assert.ok(ms < 5000, `took ${Math.round(ms)} ms`);
});
test('an HTML clipboard is never read as HTML: with no page there are no words; a clipboard gives its plain text', () => {
  assert.equal(L.dlRichInertText('<b>x</b>', null), '');
  assert.equal(L.dlRichInertText('<b>x</b>', {}), '');
  const clip = (types) => ({ getData: (t) => types[t] || '' });
  assert.equal(L.dlRichClipText(clip({ 'text/plain': 'plain', 'text/html': '<b>html</b>' }), null), 'plain');
  assert.equal(L.dlRichClipText(clip({ 'text/html': '<b>html</b>' }), null), '', 'no page here: nothing');
  assert.equal(L.dlRichClipText(null, null), '');
  assert.equal(L.dlRichClipText({ getData() { throw new Error('no'); } }, null), '');
  // With a page: the words come from a document of its own (DOMParser), with its scripts and styles taken out first.
  let asked = null;
  const made = { body: { textContent: 'the words' }, querySelectorAll: (q) => { asked = q; return []; } };
  const page = { defaultView: { DOMParser: class { parseFromString(html, type) { assert.equal(type, 'text/html'); return made; } } } };
  assert.equal(L.dlRichInertText('<b>the words</b>', page), 'the words');
  assert.match(asked, /script/);
  assert.equal(L.dlRichClipText(clip({ 'text/html': '<b>the words</b>' }), page), 'the words');
});

// ---- 8. copy -----------------------------------------------------------------------------------------------------------------
test('what is copied is Markdown: words as words, blocks as blocks, rows as a list', () => {
  const doc = L.dlRichRead(PM, 'some **bold** words\n\n# Head\n\n- one\n- two\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n', lex).doc;
  const copy = (from, to) => L.dlRichCopy(PM, doc.slice(from, to));
  assert.equal(copy(6, 13), '**bold** wo');
  assert.equal(copy(0, posOf(doc, 2)), 'some **bold** words\n\n# Head');
  assert.equal(copy(posOf(doc, 2), posOf(doc, 3)), '- one\n- two');
  assert.equal(copy(posOf(doc, 2) + 1, posOf(doc, 3) - 1), '- one\n- two', 'rows without their list');
  assert.equal(copy(5, 5), '');
  const cells = copy(posOf(doc, 3) + 3, posOf(doc, 3) + 9);
  assert.equal(typeof cells, 'string', 'part of a grid: its plain words, never an error');
});

const secs = ((Date.now() - t0) / 1000).toFixed(1);
if (fails.length) {
  for (const f of fails) console.error(`FAIL ${f}`);
  console.error(`documents rich editor: ${fails.length} failed, ${passed} passed in ${secs} s`);
  process.exit(1);
}
console.log(`documents rich editor: ${passed} tests passed in ${secs} s (open-then-Done exact on the corpus; ${STATES.length} states Markdown cannot say; ${HOSTILE_PASTE.length} hostile pastes)`);
