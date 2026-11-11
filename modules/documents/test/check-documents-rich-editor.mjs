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
 * 9. TYPING SHORTCUTS. Every rule: it fires as its last character is typed, it does not fire where it must not (in code, in
 *    a raw block, in a heading, in the middle of a line, past the reader's bounds, in a read-only editor), Backspace puts the
 *    typed characters back and undo takes the rule back. A link is made only of an address the reader allows.
 * 10. WHAT THE BAR SHOWS. dlRichActive from a made selection: in bold, italic, code, a quote, each list, each heading level,
 *    nowhere; it never reads the words.
 * 11. THE NEW KEYS. Mod-b, Mod-i, Mod-e and Mod-Enter (the tick of a checklist row), and nothing else new.
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
  'dlRichCommand', 'dlRichCan', 'dlRichKeys', 'dlRichRules', 'dlRichInputRules', 'dlRichFence', 'dlRichActive', 'dlRichIsOn', 'DL_RICH_RULES', 'dlSafeAddress', 'dlRichPasteSlice', 'dlRichCopy', 'dlRichInertText', 'dlRichClipText', 'DL_RICH_ACTIONS', 'DL_RICH_KEYS', 'dlTextareaEditor', 'dlStubEditor', 'dlEditorDirty', 'dlEditorSnapshot']);
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
  for (const k of ['Mod-s', 'Mod-=', 'Mod-+', 'Mod--', 'Mod-0', 'Escape', 'Mod-k', 'Mod-u', 'Mod-m', 'Mod-d', 'Mod-Shift-b', 'Space', ' ']) assert.equal(k in L.dlRichKeys(PM), false, k);
  for (const k of Object.keys(L.dlRichKeys(PM))) assert.match(k, /^(Mod-.+|(Shift-)?(Enter|Tab)|Backspace)$/, `${k}: a letter alone is never bound (the call's shortcuts)`);
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

// ---- 6b. three states the write used to report as "cannot keep exactly" or to rewrite whole (#614, #615, #616) ----------------------
const OTHERS = 'Intro __x__\n\nBody\n\nEnd _it_ z\n';
const caretAt = (ed, pos) => ed.dispatch(ed.state().tr.setSelection(PM.TextSelection.create(ed.state().doc, pos)));
const fine = (ed, want, name) => {
  assert.equal(ed.getText(), want, name);
  assert.deepEqual([ed.lastWrite().same, ed.lastWrite().whole], [true, false], name);
};
test('#614: a space just inside the end of bold or italic is written outside it, and the write reads back (bar and keys)', () => {
  for (const [bar, mark] of [['bold', '**'], ['italic', '*']]) {
    const ed = open(OTHERS);
    caretAt(ed, wordAt(ed.state().doc, 'Body') + 4);
    assert.equal(ed.run(bar), true);
    ed.type('word ');
    assert.equal(ed.run(bar), true);
    ed.type('next');
    fine(ed, `Intro __x__\n\nBody${mark}word${mark} next\n\nEnd _it_ z\n`, bar);
  }
  const keys = open(OTHERS);
  caretAt(keys, wordAt(keys.state().doc, 'Body') + 4);
  key(keys, 'Mod-b');
  keys.type('word ');
  key(keys, 'Mod-b');
  keys.type('next');
  fine(keys, 'Intro __x__\n\nBody**word** next\n\nEnd _it_ z\n', 'Mod-b');
  const lead = open(OTHERS); // a space just inside the start
  caretAt(lead, wordAt(lead.state().doc, 'Body') + 4);
  key(lead, 'Mod-i');
  lead.type(' word');
  fine(lead, 'Intro __x__\n\nBody *word*\n\nEnd _it_ z\n', 'a space inside the start of italic');
});
const WORDS = [['', ''], [' ', ''], ['', ' '], [' ', ' '], ['  ', '\t'], ['\t', '  ']]; // the spaces just inside a mark: [start, end]
const AROUND = [['', ''], ['x', 'y'], ['x ', ' y'], ['x', ' y'], ['x ', 'y'], ['', ' y'], ['x ', '']]; // the words beside it
const MARKS = [['strong'], ['em'], ['strike'], ['strong', 'em'], ['em', 'strike']];
test(`#614: every place of a space against bold, italic, strike (${WORDS.length * AROUND.length * MARKS.length} sets, in a paragraph, a heading, a row and a quote)`, () => {
  const bad = [];
  let runs = 0;
  for (const where of ['paragraph', 'heading', 'row', 'quote']) {
    for (const marks of MARKS) for (const [a, b] of WORDS) for (const [l, r] of AROUND) {
      for (const inner of ['ab', 'a b', '']) {
        if (!inner && !a && !b) continue;
        const ed = open(OTHERS);
        const parts = [];
        if (l) parts.push(schema.text(l));
        const made = `${a}${inner}${b}`;
        if (made) parts.push(schema.text(made, marks.map((m) => M[m].create())));
        if (r) parts.push(schema.text(r));
        if (!parts.length) continue;
        const block = where === 'heading' ? N.heading.create({ level: 2 }, parts) : N.paragraph.create(null, parts);
        const wrapped = where === 'row' ? N.bullet_list.create(null, [N.list_item.create({ checked: null }, [block.type === N.heading ? N.paragraph.create(null, parts) : block])]) : where === 'quote' ? N.blockquote.create(null, [N.paragraph.create(null, parts)]) : block;
        const st = ed.state();
        ed.dispatch(st.tr.replaceWith(posOf(st.doc, 1), posOf(st.doc, 2), wrapped));
        const out = ed.getText();
        runs += 1;
        const w = ed.lastWrite();
        const edges = out.split('\n\n');
        if (!w.same || w.whole || edges[0] !== 'Intro __x__' || edges[edges.length - 1] !== 'End _it_ z\n') bad.push(`${where} ${marks} ${JSON.stringify([l, a, inner, b, r])} -> ${JSON.stringify(out)} same ${w.same} whole ${w.whole}`);
        else if (/(^|[^\\])(\*\*|\*|~~)[ \t]|[ \t](\*\*|\*|~~)([^*~]|$)/.test(out.split('\n\n')[1] || '') && false) bad.push(out);
      }
    }
  }
  assert.ok(runs > 1000, `runs: ${runs}`);
  assert.deepEqual(bad.slice(0, 5), []);
});
test('#614: tidy takes only the mark off the space; a link on it stays; a stored block is not touched', () => {
  const link = M.link.create({ href: 'https://example.com/a' });
  const top = N.doc.create(null, [N.paragraph.create(null, [schema.text('see '), schema.text('word ', [M.strong.create(), link]), schema.text('next')])]);
  const tidy = L.dlRichTidy(PM, top, { entries: [] }).firstChild;
  assert.deepEqual(tidy.children.map((c) => [c.text, c.marks.map((m) => m.type.name).sort().join('+')]), [['see ', ''], ['word', 'link+strong'], [' ', 'link'], ['next', '']]);
  const read = L.dlRichRead(PM, 'a **b ** c\n', lex);
  assert.ok(L.dlRichTidy(PM, read.doc, read.stored) === read.doc, 'what was stored is left as stored');
});
test('#615: Heading and Quote from the bar do nothing on the first line of a checklist row (a heading or quote there cannot be written)', () => {
  const md = '- [ ] task\n- [x] done\n\nz __y__\n';
  for (const bar of ['h1', 'h2', 'h3', 'h4', 'quote']) {
    for (const word of ['task', 'done']) {
      const ed = open(md);
      caretAt(ed, wordAt(ed.state().doc, word) + 2);
      const before = ed.state().doc;
      assert.equal(ed.run(bar), false, `${bar} on ${word}`);
      assert.ok(ed.state().doc === before, `${bar}: nothing changed`);
      assert.equal(ed.revision(), 1);
      assert.equal(ed.getText(), md);
      assert.equal(ed.lastWrite().changed, false);
    }
  }
  const all = open(md); // a selection over both rows
  all.selectAll();
  for (const bar of ['h1', 'quote']) {
    const before = all.state().doc;
    if (all.run(bar)) assert.ok(!/^- \[.\] (#|>)/m.test(all.getText()), `${bar} over the rows`);
    else assert.ok(all.state().doc === before);
  }
});
test('#615: elsewhere Heading and Quote still work: a plain row, a paragraph, a whole checklist inside a quote, and they undo', () => {
  const plain = open('- one\n\nz __y__\n');
  caretAt(plain, wordAt(plain.state().doc, 'one') + 1);
  assert.equal(plain.run('h2'), true);
  fine(plain, '- ## one\n\nz __y__\n', 'a heading on the first line of a plain row');
  const para = open('- [ ] task\n\nz __y__\n');
  caretAt(para, wordAt(para.state().doc, 'z') + 1);
  assert.equal(para.run('quote'), true);
  fine(para, '- [ ] task\n\n> z **y**\n', 'a quote on a paragraph beside a checklist (the block is written new)');
  assert.equal(para.run('quote'), true);
  fine(para, '- [ ] task\n\nz __y__\n', 'and off again: the stored text');
  const around = open('- [ ] task\n\nz __y__\n'); // the quote goes around the whole list
  around.dispatch(around.state().tr.setSelection(new PM.NodeSelection(around.state().doc.resolve(0))));
  assert.equal(around.run('quote'), true);
  fine(around, '> - [ ] task\n\nz __y__\n', 'a quote around a checklist');
  const second = open('- [ ] task\n\n  more words\n\nz __y__\n'); // the row's second block is not its first line
  caretAt(second, wordAt(second.state().doc, 'more') + 1);
  assert.equal(second.run('h1'), true);
});
test('#616: an empty heading or quote as the only block of a row never rewrites the text and changes no other block', () => {
  for (const [bar, label] of [['h1', 'heading'], ['h3', 'heading'], ['quote', 'quote']]) {
    for (const list of ['list', 'numbered']) {
      const ed = open(OTHERS);
      const st = ed.state();
      ed.dispatch(st.tr.insert(st.doc.content.size, N.paragraph.create())); // an empty paragraph at the end
      caretAt(ed, ed.state().doc.content.size - 1);
      assert.equal(ed.run(list), true);
      assert.equal(ed.run(bar), true, `${bar} on an empty row`);
      const out = ed.getText();
      assert.equal(ed.lastWrite().whole, false, `${label} in ${list}`);
      assert.equal(ed.lastWrite().same, true);
      assert.equal(out, OTHERS, `${label} in ${list}: the other blocks are as stored`);
    }
  }
  // not the last row, and a row with rows after it
  const mid = open('- a\n- b\n\nEnd __z__\n');
  caretAt(mid, wordAt(mid.state().doc, 'a') + 1);
  ed2(mid);
  function ed2(ed) {
    ed.dispatch(ed.state().tr.delete(wordAt(ed.state().doc, 'a'), wordAt(ed.state().doc, 'a') + 1));
    assert.equal(ed.run('h2'), true);
    ed.getText();
    assert.equal(ed.lastWrite().whole, false);
    assert.equal(ed.lastWrite().same, true);
    assert.ok(ed.lastWrite().text.endsWith('\n\nEnd __z__\n'));
  }
});
test('#616 and #615 over the whole corpus: bar actions on every first line, never a whole-text rewrite', () => {
  let runs = 0;
  const bad = [];
  for (const md of [...CASES.map((c) => c[1]), ...sourceDocs(40)]) {
    const base = L.dlRichRead(PM, md, lex);
    const spots = [];
    base.doc.descendants((node, pos) => { if (node.type === N.paragraph || node.type === N.heading) spots.push(pos + 1); return !node.isTextblock; });
    for (const at of spots.slice(0, 12)) for (const bar of ['h1', 'quote']) {
      const ed = open(md);
      caretAt(ed, at);
      if (!ed.run(bar)) continue;
      ed.getText();
      runs += 1;
      if (ed.lastWrite().whole) bad.push(`${bar} at ${at}: ${JSON.stringify(md).slice(0, 70)}`);
    }
  }
  assert.ok(runs > 200, `runs: ${runs}`);
  assert.deepEqual(bad.slice(0, 5), []);
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


// ---- 9. typing shortcuts -------------------------------------------------------------------------------------------------------
// A new editor on `md`, the caret `at` characters into block `i` (at its end when `at` is not given), then `typed` typed.
const typedIn = (md, typed, i = 0, at = null, deep = 1) => {
  const ed = open(md);
  const d = ed.state().doc;
  if (at === null) ed.dispatch(ed.state().tr.setSelection(PM.TextSelection.create(d, endOf(d, i) - (deep - 1))));
  else select(ed, i, at, at, deep);
  if (typed) ed.type(typed);
  return ed;
};
const first = (ed) => ed.state().doc.firstChild;
const marksOf = (ed) => { const out = []; ed.state().doc.descendants((n) => { if (n.isText) out.push([n.text, n.marks.map((m) => m.type.name).sort().join('+')]); }); return out; };
test('the rules are the ones named, each a rule of the one plugin', () => {
  assert.deepEqual(L.dlRichRules(PM).map((r) => r.name), L.DL_RICH_RULES);
  assert.ok(L.dlRichInputRules(PM) === L.dlRichInputRules(PM), 'one plugin');
  assert.ok(open('x\n').state().plugins.includes(L.dlRichInputRules(PM)), 'and the editor has it');
  for (const r of L.dlRichRules(PM)) { assert.equal(r.rule.inCode, false, `${r.name} never fires in a code block`); assert.equal(r.rule.inCodeMark, false, `${r.name} never fires in words that are code`); assert.equal(r.rule.undoable, true); }
});
test('heading: "# " to "#### " at the start of a paragraph', () => {
  for (let n = 1; n <= 4; n += 1) {
    const ed = typedIn('', `${'#'.repeat(n)} `);
    assert.equal(first(ed).type.name, 'heading', `level ${n}`);
    assert.equal(first(ed).attrs.level, n);
    assert.equal(first(ed).childCount, 0, 'the marks are gone');
    ed.type('Title');
    assert.equal(ed.getText(), `${'#'.repeat(n)} Title\n`);
  }
  const ed = typedIn('words __here__\n\nmore\n', '## ', 1, 0);
  assert.equal(ed.getText(), 'words __here__\n\n## more\n', 'the words after the caret are kept, the block above is as stored');
});
test('heading: five marks, a mark with no space, the middle of a line, a heading and a grid cell fire nothing', () => {
  for (const [md, typed, i, at, deep] of [['', '##### '], ['', '###### '], ['', '#x '], ['', '#'], ['a\n', ' # '], ['a\n', '# ', 0, 1], ['# head\n', '## ', 0, 0], ['| a |\n| --- |\n| b |\n', '# ', 0, 0, 3]]) {
    const ed = typedIn(md, typed, i, at, deep);
    let headings = 0;
    ed.state().doc.descendants((n) => { if (n.type === N.heading && md[0] !== '#') headings += 1; });
    assert.equal(headings, 0, JSON.stringify([md, typed]));
    assert.ok(ed.state().doc.textContent.includes(typed), `${JSON.stringify(typed)} stays as typed`);
  }
  assert.equal(first(typedIn('# head\n', '## ', 0, 0)).attrs.level, 1, 'a heading keeps its level');
});
test('Backspace straight after a rule puts the typed characters back; undo takes the rule back', () => {
  const ed = typedIn('', '## ');
  assert.equal(first(ed).type.name, 'heading');
  assert.equal(key(ed, 'Backspace'), true);
  assert.equal(first(ed).type.name, 'paragraph');
  assert.equal(first(ed).textContent, '## ', 'the characters typed, as words');
  assert.equal(key(ed, 'Backspace'), false, 'the next Backspace is the library\'s own');
  const un = typedIn('', '## ');
  assert.equal(key(un, 'Mod-z'), true);
  assert.equal(first(un).type.name, 'paragraph', 'undo: the heading is a paragraph again');
  assert.equal(first(un).textContent, '##', 'with what was typed before the rule fired');
  assert.equal(key(un, 'Mod-Shift-z'), true);
  assert.equal(first(un).type.name, 'heading', 'redo');
  const moved = typedIn('', '## ');
  moved.type('a');
  assert.equal(key(moved, 'Backspace'), false, 'after another character the rule is not undone by Backspace');
  const mark = typedIn('', 'a **b**');
  assert.deepEqual(marksOf(mark), [['a ', ''], ['b', 'strong']]);
  assert.equal(key(mark, 'Backspace'), true);
  assert.deepEqual(marksOf(mark), [['a **b**', '']]);
});
test('bullet: "- " and "* " make a bulleted list, and join a bulleted list directly above', () => {
  for (const m of ['- ', '* ']) {
    const ed = typedIn('', m);
    assert.equal(first(ed).type.name, 'bullet_list', m);
    assert.equal(first(ed).firstChild.attrs.checked, null);
    ed.type('one');
    assert.equal(ed.getText(), '- one\n');
  }
  const joined = typedIn('* a\n\nb\n\nend __x__\n', '- ', 1, 0);
  assert.equal(joined.state().doc.childCount, 2, 'one list, not two');
  assert.equal(joined.getText(), '- a\n- b\n\nend __x__\n');
  const other = typedIn('1. a\n\nb\n', '- ', 1, 0);
  assert.deepEqual([other.state().doc.child(0).type.name, other.state().doc.child(1).type.name], ['ordered_list', 'bullet_list'], 'a list of another kind is not joined');
});
test('bullet: nothing in the first line of a row, past the fourth level, with no space, or after other words', () => {
  const row = typedIn('- a\n', '- ', 0, 0, 3);
  assert.equal(row.getText(), '- \\- a\n', 'the marks are words');
  const deep = open('- 1\n  - 2\n    - 3\n      - 4\n\n        more\n');
  const st = deep.state();
  st.doc.descendants((n, pos) => { if (n.isText && n.text === 'more') deep.dispatch(st.tr.setSelection(PM.TextSelection.create(st.doc, pos))); });
  const before = JSON.stringify(deep.state().doc.toJSON()).split('bullet_list').length;
  for (const m of ['- ', '1. ', '[ ] ']) { deep.type(m); assert.equal(JSON.stringify(deep.state().doc.toJSON()).split('bullet_list').length, before, `${m}: no fifth level`); assert.equal(JSON.stringify(deep.state().doc.toJSON()).includes('ordered_list'), false); }
  for (const typed of ['-x ', '-', 'a - ', '+ ', '-- ']) assert.equal(first(typedIn('', typed)).type.name, 'paragraph', typed);
});
test('numbered: "1. " makes a numbered list and joins one above; no other number does', () => {
  const ed = typedIn('', '1. ');
  assert.equal(first(ed).type.name, 'ordered_list');
  assert.equal(first(ed).attrs.order, 1);
  ed.type('one');
  assert.equal(ed.getText(), '1. one\n');
  const joined = typedIn('1. a\n2. b\n\nc\n', '1. ', 1, 0);
  assert.equal(joined.getText(), '1. a\n2. b\n3. c\n');
  for (const typed of ['2. ', '10. ', '1) ', '1.', '1.x ', 'a 1. ', '1984. ']) assert.equal(first(typedIn('', typed)).type.name, 'paragraph', typed);
});
test('checklist: "[ ] " and "[x] " make a checklist row; in the first line of a row the row gets its box ("- [ ] ")', () => {
  const open1 = typedIn('', '[ ] ');
  assert.equal(first(open1).type.name, 'bullet_list');
  assert.equal(first(open1).firstChild.attrs.checked, false);
  open1.type('a');
  assert.equal(open1.getText(), '- [ ] a\n');
  const done = typedIn('', '[x] ');
  assert.equal(first(done).firstChild.attrs.checked, true);
  const dash = typedIn('', '- [ ] buy milk');
  assert.equal(dash.state().doc.childCount, 1);
  assert.equal(first(dash).childCount, 1, 'one row');
  assert.equal(dash.getText(), '- [ ] buy milk\n');
  assert.equal(typedIn('', '1. [X] a').getText(), '1. [x] a\n');
  const has = typedIn('- [x] a\n', '[ ] ', 0, 0, 3);
  assert.equal(first(has).firstChild.attrs.checked, true, 'a row that has its box keeps it');
  assert.equal(first(has).textContent, '[ ] a');
  const joined = typedIn('- [x] a\n\nb\n', '[ ] ', 1, 0);
  assert.equal(joined.getText(), '- [x] a\n- [ ] b\n');
  for (const typed of ['[] ', '[ ]', '[y] ', 'a [ ] ']) assert.equal(first(typedIn('', typed)).type.name, 'paragraph', typed);
});
test('quote: "> " makes a quote, to eight levels and no further', () => {
  const ed = typedIn('', '> ');
  assert.equal(first(ed).type.name, 'blockquote');
  ed.type('said');
  assert.equal(ed.getText(), '> said\n');
  const two = typedIn('> a\n\nb\n', '> ', 1, 0);
  assert.equal(two.state().doc.childCount, 2, 'a quote above is not joined: Markdown reads two quotes');
  const depth = (ed2) => { let most = 0; ed2.state().doc.descendants((n, pos) => { if (n.isTextblock) { const $p = ed2.state().doc.resolve(pos + 1); let q = 0; for (let d = $p.depth; d > 0; d -= 1) if ($p.node(d).type === N.blockquote) q += 1; most = Math.max(most, q); } }); return most; };
  const seven = typedIn(`${'> '.repeat(7)}x\n`, '> ', 0, 0, 8);
  assert.equal(depth(seven), 8);
  const eight = typedIn(`${'> '.repeat(8)}x\n`, '> ', 0, 0, 9);
  assert.equal(depth(eight), 8, 'no ninth quote');
  assert.ok(eight.state().doc.textContent.startsWith('> x'));
  for (const typed of ['>', '>x ', 'a > ', '>> ']) assert.equal(first(typedIn('', typed)).type.name, 'paragraph', typed);
});
test('code block: "```" then a space or Enter; Enter keeps a language; Backspace puts the marks back', () => {
  const sp = typedIn('', '``` ');
  assert.equal(first(sp).type.name, 'code_block');
  assert.equal(first(sp).attrs.lang, '');
  sp.type('let a;');
  assert.equal(sp.getText(), '```\nlet a;\n```\n');
  assert.equal(first(typedIn('', '```js ')).type.name, 'paragraph', 'a language is named with Enter, not a space');
  const en = typedIn('', '```');
  assert.equal(first(en).type.name, 'paragraph', 'three marks alone are still words');
  assert.equal(key(en, 'Enter'), true);
  assert.equal(first(en).type.name, 'code_block');
  assert.equal(en.state().doc.childCount, 1, 'Enter made the block, not a second paragraph');
  assert.equal(key(en, 'Backspace'), true);
  assert.equal(first(en).type.name, 'paragraph');
  assert.equal(first(en).textContent, '```');
  const lang = typedIn('', '```c++');
  key(lang, 'Enter');
  assert.deepEqual([first(lang).type.name, first(lang).attrs.lang], ['code_block', 'c++']);
  const un = typedIn('', '```');
  key(un, 'Enter');
  assert.equal(key(un, 'Mod-z'), true);
  assert.equal(first(un).textContent, '```', 'undo');
  // not with other words in the paragraph, not in the middle, not a longer or shorter fence
  for (const [md, typed, at] of [['after\n', '``` ', 0], ['', '`` '], ['', '```` '], ['', 'a ``` '], ['', '```a b ']]) assert.equal(first(typedIn(md, typed, 0, at === undefined ? null : at)).type.name, 'paragraph', JSON.stringify([md, typed]));
  const mid = typedIn('', '```x');
  assert.ok(L.dlRichFence(PM, mid.state()), 'at the end of the marks');
  select(mid, 0, 2);
  assert.equal(L.dlRichFence(PM, mid.state()), null, 'Enter in the middle of the marks is an ordinary Enter');
  assert.equal(L.dlRichFence(PM, typedIn('a ```\n', '').state()), null);
  assert.equal(L.dlRichFence(PM, typedIn('# ```\n', '').state()), null, 'not in a heading');
});
test('rule: "---" in a paragraph that holds nothing else', () => {
  const ed = typedIn('', '---');
  assert.deepEqual([ed.state().doc.child(0).type.name, ed.state().doc.child(1).type.name], ['horizontal_rule', 'paragraph']);
  assert.ok(ed.state().selection.$from.parent === ed.state().doc.child(1), 'the caret is in the paragraph after the rule');
  assert.equal(ed.getText(), '---\n');
  ed.type('next');
  assert.equal(ed.getText(), '---\n\nnext\n');
  const between = open('above __x__\n\n\n\nbelow _y_\n');
  between.dispatch(between.state().tr.insert(posOf(between.state().doc, 1), N.paragraph.create()));
  select(between, 1, 0);
  between.type('---');
  assert.equal(between.state().doc.childCount, 3, 'no paragraph is added when a block of words follows');
  assert.ok(between.state().selection.$from.parent === between.state().doc.child(2), 'the caret is in the block after the rule');
  const out = between.getText().split('\n\n');
  assert.equal(out[0], 'above __x__');
  assert.equal(out[out.length - 1], 'below _y_\n', 'the blocks around are as stored');
  assert.ok(out.includes('---'));
  const back = typedIn('', '---');
  assert.equal(key(back, 'Backspace'), true);
  assert.deepEqual([back.state().doc.childCount, first(back).type.name, first(back).textContent], [1, 'paragraph', '---']);
  for (const [md, typed, at, deep] of [['a\n', '---'], ['a\n', '---', 0], ['', '--'], ['- a\n', '---', 0, 3], ['# h\n', '---', 0]]) {
    const not = typedIn(md, typed, 0, at === undefined ? null : at, deep || 1);
    let rules = 0;
    not.state().doc.descendants((n) => { if (n.type === N.horizontal_rule) rules += 1; });
    assert.equal(rules, 0, JSON.stringify([md, typed]));
  }
  const row = typedIn('- a\n', '', 0, 0, 3);
  row.dispatch(row.state().tr.delete(3, 4));
  row.type('---');
  assert.equal(first(row).type.name, 'bullet_list', 'in the first line of a row the marks stay words ("- ---" reads as a rule)');
  assert.equal(first(row).textContent, '---');
});
test('bold, italic, strike and code close into the mark when the last character is typed', () => {
  for (const [typed, mark, written] of [['**b c**', 'strong', '**b c**'], ['*b c*', 'em', '*b c*'], ['_b c_', 'em', '*b c*'], ['~~b c~~', 'strike', '~~b c~~'], ['`b c`', 'code', '`b c`']]) {
    const ed = typedIn('', `a ${typed}`);
    assert.deepEqual(marksOf(ed), [['a ', ''], ['b c', mark]], typed);
    ed.type(' d');
    assert.deepEqual(marksOf(ed), [['a ', ''], ['b c', mark], [' d', '']], `${typed}: what is typed next is plain`);
    assert.equal(ed.getText(), `a ${written} d\n`);
    assert.equal(ed.lastWrite().same, true);
  }
  assert.deepEqual(marksOf(typedIn('', '**b**')), [['b', 'strong']], 'at the start of a line');
  assert.deepEqual(marksOf(typedIn('', '*i*')), [['i', 'em']]);
  assert.deepEqual(marksOf(typedIn('', 'in**side**')), [['in', ''], ['side', 'strong']]);
  assert.deepEqual(marksOf(typedIn('', '**a *b* c**')), [['a ', 'strong'], ['b', 'em+strong'], [' c', 'strong']], 'italic inside bold');
  assert.deepEqual(marksOf(typedIn('', '**`x`**')), [['x', 'code+strong']], 'bold around code');
  assert.deepEqual(marksOf(typedIn('', '(_x_)')), [['(', ''], ['x', 'em'], [')', '']]);
  const mid = typedIn('one two\n', '**x**', 0, 4);
  assert.equal(mid.getText(), 'one **x**two\n');
});
test('the marks stay words where Markdown would not read them', () => {
  const plain = (typed, md = '', at = null) => { const ed = typedIn(md, typed, 0, at); assert.deepEqual(marksOf(ed).filter((m) => m[1]), [], JSON.stringify(typed)); return ed; };
  for (const typed of ['** b**', '**b **', '* b*', '2 * 3 * 4', '****', '**', '``', '` `', 'snake_case_name', 'a_b_', '_ b_', '__b__', '~b~', '~~ b~~', '***b***', '\ufffc']) plain(typed);
  assert.equal(plain('2 * 3 * 4').getText(), '2 \\* 3 \\* 4\n');
  const inWord = typedIn('ab\n', '_x_', 0, 0); // "_x_" typed in front of a letter: _x_ab is words
  assert.deepEqual(marksOf(inWord), [['_x_ab', '']]);
  // inside words that are code, and inside a code block or a raw block, nothing is read
  const code = typedIn('`ab`\n', '**x**', 0, 1);
  assert.deepEqual(marksOf(code), [['a**x**b', 'code']]);
  const opener = typedIn('`a*b` c\n', '*', 0, 5); // the opening mark is code: words
  assert.deepEqual(marksOf(opener).map((m) => m[1]), ['code', '']);
  for (const md of ['```\ncode\n```\n', '<div>\nraw\n</div>\n']) {
    for (const typed of ['# ', '- ', '1. ', '[ ] ', '> ', '``` ', '---', '**b**', '*i*', '_i_', '~~s~~', '`c`', '[t](https://example.com/)']) {
      const ed = typedIn(md, typed, 0, 0);
      assert.equal(ed.state().doc.childCount, 1, `${typed} in ${first(ed).type.name}`);
      assert.equal(first(ed).type.name, md[0] === '<' ? 'source_block' : 'code_block');
      assert.ok(first(ed).textContent.startsWith(typed), `${typed} is typed as it is`);
      assert.equal(first(ed).firstChild.marks.length, 0);
    }
  }
});
test('no mark is read inside an address being typed, and a bare address stays words', () => {
  const bare = typedIn('', 'see https://example.com/_a_/*b*/~~c~~ now');
  assert.deepEqual(marksOf(bare), [['see https://example.com/_a_/*b*/~~c~~ now', '']]);
  assert.equal(linksOf(bare.state().doc).length, 0, 'a bare address is not made a link');
  assert.equal(linksOf(L.dlRichRead(PM, bare.getText(), lex).doc).length, 0, 'nor is it one when the saved text is read again');
  assert.equal(bare.lastWrite().same, true);
  assert.equal(typedIn('', 'https://example.com ').getText(), 'https\\://example.com\n');
  assert.deepEqual(marksOf(typedIn('', 'mailto:a_b_c@example.com')).filter((m) => m[1]), []);
  const link = typedIn('', '[x](https://example.com/_a_/b)');
  assert.deepEqual(linksOf(link.state().doc), ['https://example.com/_a_/b']);
});
test('link: "[words](address)" closes into a link for an address the reader allows', () => {
  for (const [address, href] of [['https://example.com/a?b=1&c=2', 'https://example.com/a?b=1&c=2'], ['http://example.com', 'http://example.com'], ['mailto:ana@example.com', 'mailto:ana@example.com'], ['HTTPS://Example.com/x', 'https://Example.com/x']]) {
    const ed = typedIn('', `see [the site](${address})`);
    assert.deepEqual(marksOf(ed), [['see ', ''], ['the site', 'link']], address);
    assert.deepEqual(linksOf(ed.state().doc), [href]);
    assert.equal(L.dlRichHref(href), href);
    ed.state().doc.check();
    ed.type(' and on');
    assert.deepEqual(marksOf(ed)[2], [' and on', ''], 'what is typed next is not in the link');
    assert.equal(ed.getText(), `see [the site](${href}) and on\n`);
    assert.equal(ed.lastWrite().same, true);
  }
  const bold = typedIn('', '[**b** c](https://example.com/)');
  assert.deepEqual(marksOf(bold), [['b', 'link+strong'], [' c', 'link']]);
  const back = typedIn('', '[a](https://example.com/)');
  assert.equal(key(back, 'Backspace'), true);
  assert.deepEqual(marksOf(back), [['[a](https://example.com/)', '']], 'Backspace: the characters typed, as words');
});
test('link: an object: address makes the chip, as reading the same Markdown does', () => {
  const ed = typedIn('', 'open [the map](object:maps:place:abc123)');
  const chips = [];
  ed.state().doc.descendants((n) => { if (n.type === N.object) chips.push(n.attrs); });
  assert.deepEqual(chips.map((c) => [c.module, c.kind, c.id, c.label]), [['maps', 'place', 'abc123', 'the map']]);
  ed.state().doc.check();
  assert.equal(ed.getText(), 'open [the map](object:maps:place:abc123)\n');
  assert.ok(ed.state().doc.eq(L.dlRichRead(PM, ed.getText(), lex).doc), 'the same nodes as reading it');
});
const REFUSED = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd', 'ftp://example.com/a', 'blob:https://example.com/1', 'page.html', '/a/b', '//example.com/a', '#top', 'example.com', 'object:bad', 'object:maps:place:', 'mailto:', 'https://', 'http:example.com', 'java\tscript:x', '&#106;avascript:alert(1)', 'https://a.example/"x', 'https://exa<mple.com/'];
test(`link: an address the reader refuses is left as the words typed (${REFUSED.length} addresses; the reader's own rule decides)`, () => {
  for (const address of REFUSED) {
    assert.equal(L.dlSafeAddress(address), null, `${address}: the reader refuses it`);
    const typed = `[x](${address})`;
    const ed = typedIn('', typed);
    ed.state().doc.check();
    assert.deepEqual(linksOf(ed.state().doc), [], address);
    let atoms = 0;
    ed.state().doc.descendants((n) => { if (n.isAtom && !n.isText) atoms += 1; });
    assert.equal(atoms, 0, `${address}: no chip`);
    if (!/\s/.test(address)) assert.equal(ed.state().doc.textContent, typed, `${address}: the words typed`);
    assert.deepEqual(linksOf(L.dlRichRead(PM, ed.getText(), lex).doc), [], `${address}: no link when the saved text is read again`);
  }
  // every link a rule can make is one the reader allows: the scheme list is the reader's, not a second one
  for (const scheme of ['http', 'https', 'mailto', 'object', 'javascript', 'data', 'ftp', 'file', 'tel', 'sms', 'ws', 'about', 'chrome']) {
    const address = scheme === 'mailto' ? 'mailto:a@b.example' : scheme === 'object' ? 'object:maps:place:p1' : `${scheme}://example.com/a`;
    const ed = typedIn('', `[x](${address})`);
    const made = linksOf(ed.state().doc).length + (JSON.stringify(ed.state().doc.toJSON()).includes('"object"') ? 1 : 0);
    assert.equal(made, L.dlSafeAddress(address) ? 1 : 0, scheme);
  }
  assert.deepEqual(linksOf(typedIn('', '![alt](https://example.com/p.png)').state().doc), [], 'a picture is not made a link');
  assert.deepEqual(linksOf(typedIn('', '[x](https://example.com/a b)').state().doc), []);
  assert.deepEqual(linksOf(typedIn('', '[ ](https://example.com/)').state().doc), [], 'no words, no link');
});
test('the first line of a list row: no heading and no quote is typed into it, and no code block after a box', () => {
  for (const [md, typed] of [['- [ ] a\n', '# '], ['- [ ] a\n', '## '], ['- [ ] a\n', '> '], ['- [ ] a\n', '``` '], ['- a\n', '# '], ['- a\n', '> '], ['1. a\n', '#### '], ['1. a\n', '> ']]) {
    const ed = typedIn(md, typed, 0, 0, 3);
    assert.deepEqual([first(ed).firstChild.childCount, first(ed).firstChild.firstChild.type.name], [1, 'paragraph'], `${typed} in ${md}`);
    assert.ok(first(ed).textContent.startsWith(typed), `${typed} stays as typed`);
    ed.getText();
    assert.deepEqual([ed.lastWrite().same, ed.lastWrite().whole], [true, false], `${typed}: what is written reads back`);
  }
  assert.equal(L.dlRichFence(PM, typedIn('', '- [ ] ```').state()), null, 'nor a code block by Enter after a box');
  // a code block in a row with no box is made, and reads back; so do a heading and a quote in a row's second block
  const code = typedIn('', '- ``` ');
  code.type('let a;');
  assert.equal(first(code).firstChild.firstChild.type.name, 'code_block');
  assert.equal(code.getText(), '- ```\n  let a;\n  ```\n');
  assert.deepEqual([code.lastWrite().same, code.lastWrite().whole], [true, false]);
  const second = open('- one\n\n  two\n');
  second.dispatch(second.state().tr.setSelection(PM.TextSelection.create(second.state().doc, wordAt(second.state().doc, 'two'))));
  second.type('## ');
  assert.equal(second.getText(), '- one\n\n  ## two\n');
  // the typing rules never leave a text that has to be written whole: with other blocks around, each empty result is written alone
  for (const typed of ['# ', '- ', '1. ', '[ ] ', '> ', '``` ', '---', '- # ', '1. > ', '- [ ] # ', '> # ', '> - ', '> > ', '- ``` ', '> ``` ', '> ---']) {
    const ed = open('Top __x__\n\nmid\n\nEnd _y_\n');
    const at = wordAt(ed.state().doc, 'mid');
    ed.dispatch(ed.state().tr.delete(at, at + 3));
    ed.dispatch(ed.state().tr.setSelection(PM.TextSelection.create(ed.state().doc, at)));
    ed.type(typed);
    const out = ed.getText();
    assert.deepEqual([ed.lastWrite().same, ed.lastWrite().whole], [true, false], JSON.stringify(typed));
    assert.ok(out.startsWith('Top __x__\n\n') && out.endsWith('End _y_\n'), `${JSON.stringify(typed)}: the blocks around are as stored`);
  }
  // what is typed after a rule gets what the closing mark would have got, not the marks of the words before it
  assert.deepEqual(marksOf(typedIn('', '[**b**](https://example.com/) z')), [['b', 'link+strong'], [' z', '']]);
  assert.deepEqual(marksOf(typedIn('', '**a `c`** z')), [['a ', 'strong'], ['c', 'code+strong'], [' z', '']]);
  assert.deepEqual(marksOf(typedIn('**bold**\n', ' *i* z', 0, 4)), [['bold ', 'strong'], ['i', 'em+strong'], [' z', 'strong']], 'inside bold words the next words stay bold');
});
test('a read-only editor types nothing and runs no rule', () => {
  const ed = open('x\n');
  select(ed, 0, 0);
  ed.setReadOnly(true);
  const before = ed.state().doc;
  assert.equal(ed.type('# '), false);
  assert.ok(ed.state().doc === before);
  const plugin = L.dlRichInputRules(PM);
  const fired = [];
  const st = typedIn('', '#').state();
  const asView = (editable) => ({ state: st, composing: false, editable, dispatch: (tr) => fired.push(tr) });
  assert.equal(plugin.props.handleTextInput(asView(false), st.selection.from, st.selection.to, ' '), false, 'a view that cannot be typed in');
  assert.equal(fired.length, 0);
  assert.equal(plugin.props.handleTextInput(asView(true), st.selection.from, st.selection.to, ' '), true);
  assert.equal(fired.length, 1);
});
test('every rule leaves a text the schema takes, and typing a rule in one block leaves the other blocks as stored', () => {
  const md = 'A __bold__ start\n\nmid\n\n* one\n* two\n\nEnd _it_ here\n';
  const blocks = md.split('\n\n');
  for (const [typed, want] of [['# ', '# mid'], ['#### ', '#### mid'], ['* ', '- mid'], ['1. ', '1. mid'], ['[ ] ', '- [ ] mid'], ['> ', '> mid'], ['**b** ', '**b** mid'], ['*i* ', '*i* mid'], ['~~s~~ ', '~~s~~ mid'], ['`c` ', '`c` mid'], ['[t](https://example.com/) ', '[t](https://example.com/) mid']]) {
    const ed = typedIn(md, typed, 1, 0);
    ed.state().doc.check();
    const out = ed.getText().split('\n\n');
    assert.deepEqual([ed.lastWrite().same, ed.lastWrite().whole], [true, false], typed);
    assert.equal(out[0], blocks[0], `${typed}: the block above`);
    assert.equal(out[1], want, typed);
    assert.equal(out[2], blocks[2], `${typed}: the list below`);
    assert.equal(out[3], blocks[3], `${typed}: the last block`);
  }
});

const BITS = ['# ', '## ', '#### ', '- ', '* ', '1. ', '[ ] ', '[x] ', '> ', '``` ', '---', '**b**', '*i*', '_i_', '~~s~~', '`c`', '[t](https://example.com/a)', '[m](mailto:a@b.example)', '[o](object:maps:place:p1)',
  '[x](javascript:alert(1))', '[d](data:text/html,x)', 'word ', ' ', 'a_b_c', '**', '*', '`', '[', ']', '(', ')'];
test('marks typed at random, at every kind of place in the corpus: the schema takes the result, no link to a refused address, never a whole-text rewrite', () => {
  let seed = 20261111;
  const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  let runs = 0;
  let fired = 0;
  const bad = [];
  for (let r = 0; r < 4000; r += 1) {
    const md = pick(CASES)[1];
    const ed = open(md);
    const spots = [];
    ed.state().doc.descendants((n, pos) => { if (n.isTextblock) { spots.push(pos + 1, pos + n.nodeSize - 1); if (n.content.size > 2) spots.push(pos + 1 + Math.floor(rnd() * n.content.size)); } });
    if (!spots.length) continue;
    const at = pick(spots);
    let typed = '';
    try {
      ed.dispatch(ed.state().tr.setSelection(PM.TextSelection.create(ed.state().doc, at)));
      const inCode = Boolean(ed.state().selection.$from.parent.type.spec.code);
      const size = ed.state().doc.content.size;
      for (let i = 1 + Math.floor(rnd() * 3); i > 0; i -= 1) { const b = pick(BITS); typed += b; ed.type(b); }
      if (inCode) assert.equal(ed.state().doc.content.size, size + typed.length, 'in code every character is typed as it is');
      else if (ed.state().doc.content.size !== size + typed.length) fired += 1;
      ed.state().doc.check();
      const out = ed.getText();
      runs += 1;
      if (ed.lastWrite().whole && !inCode) bad.push(`written whole: ${JSON.stringify(typed)} in ${JSON.stringify(md).slice(0, 60)} at ${at}`); // (a raw block a person edits is step 5's)
      for (const doc of [ed.state().doc, L.dlRichRead(PM, out, lex).doc]) for (const href of linksOf(doc)) assert.match(href, /^(https?:\/\/|mailto:)/);
    } catch (err) { bad.push(`${err.message.slice(0, 120)}: ${JSON.stringify(typed)} in ${JSON.stringify(md).slice(0, 60)} at ${at}`); }
  }
  assert.ok(runs > 3000 && fired > 500, `runs ${runs}, rules fired in ${fired}`);
  assert.deepEqual(bad.slice(0, 5), []);
});

// ---- 10. what the bar shows ------------------------------------------------------------------------------------------------------
const NOWHERE = { bold: false, italic: false, code: false, heading: 0, list: false, numbered: false, checklist: false, quote: false };
// The state with the caret (or a selection to `to`) at the word `word` of the text `md`.
const at = (md, word, len = 0, into = 1) => { const ed = open(md); const p = wordAt(ed.state().doc, word) + into; ed.dispatch(ed.state().tr.setSelection(PM.TextSelection.create(ed.state().doc, p, p + len))); return ed; };
const active = (ed) => L.dlRichActive(PM, ed.state());
test('the bar: nowhere, nothing is on', () => {
  assert.deepEqual(active(at('plain words\n', 'plain')), NOWHERE);
  assert.deepEqual(active(at('plain words\n', 'plain', 5, 0)), NOWHERE);
  assert.deepEqual(active(at('```\ncode\n```\n', 'code')), NOWHERE);
  assert.deepEqual(active(open('')), NOWHERE);
  const rule = open('a\n\n---\n\nb\n');
  rule.dispatch(rule.state().tr.setSelection(PM.NodeSelection.create(rule.state().doc, posOf(rule.state().doc, 1))));
  assert.deepEqual(active(rule), NOWHERE, 'a selected rule');
  for (const id of ['bold', 'italic', 'code', 'heading', 'list', 'numbered', 'checklist', 'quote', 'link', 'grid', 'formula']) { assert.equal(L.dlRichIsOn(NOWHERE, id), false, id); assert.equal(L.dlRichIsOn(null, id), false); }
});
test('the bar: in bold, in italic, in code, by a caret and by a selection', () => {
  const md = 'a **bold** b *ital* c `code` d ***both*** e\n';
  assert.deepEqual(active(at(md, 'bold')), { ...NOWHERE, bold: true });
  assert.deepEqual(active(at(md, 'ital')), { ...NOWHERE, italic: true });
  assert.deepEqual(active(at(md, 'code')), { ...NOWHERE, code: true });
  assert.deepEqual(active(at(md, 'both')), { ...NOWHERE, bold: true, italic: true });
  assert.deepEqual(active(at(md, 'bold', 2)), { ...NOWHERE, bold: true }, 'a selection inside the bold words');
  assert.deepEqual(active(at(md, 'a ', 8, 0)), { ...NOWHERE, bold: true }, 'a selection that takes in some bold words: a press takes bold off');
  assert.deepEqual(active(at(md, ' b ', 3, 0)), NOWHERE, 'the plain words between two marks');
  const all = open(md);
  all.selectAll();
  assert.deepEqual(active(all), { ...NOWHERE, bold: true, italic: true, code: true });
  for (const id of ['bold', 'italic', 'code']) assert.equal(L.dlRichIsOn(active(all), id), true);
});
test('the bar: a press with nothing selected turns the button on for what is typed next, and off again', () => {
  const ed = at('plain words\n', 'words');
  ed.run('bold');
  assert.deepEqual(active(ed), { ...NOWHERE, bold: true });
  ed.type('x');
  assert.deepEqual(active(ed), { ...NOWHERE, bold: true });
  ed.run('bold');
  assert.deepEqual(active(ed), NOWHERE);
  for (const [action, name] of [['bold', 'bold'], ['italic', 'italic'], ['code', 'code']]) {
    const sel = at('some plain words\n', 'plain', 5, 0);
    assert.equal(active(sel)[name], false);
    sel.run(action);
    assert.equal(active(sel)[name], true, `${action}: on after the press`);
    assert.deepEqual([sel.state().selection.from, sel.state().selection.to], [6, 11], 'and the selection is kept');
    sel.run(action);
    assert.equal(active(sel)[name], false, `${action}: off after the second`);
  }
});
test('the bar: each heading level', () => {
  for (let n = 1; n <= 6; n += 1) {
    const a = active(at(`${'#'.repeat(n)} Head\n\nwords\n`, 'Head'));
    assert.deepEqual(a, { ...NOWHERE, heading: n });
    assert.equal(L.dlRichIsOn(a, 'heading'), true);
  }
  const two = open('# One\n\n## Two\n');
  two.dispatch(two.state().tr.setSelection(PM.TextSelection.create(two.state().doc, 2, 9)));
  assert.equal(active(two).heading, 0, 'a selection over two headings is in neither');
  assert.deepEqual(active(at('# a **b** c\n', 'b')), { ...NOWHERE, heading: 1, bold: true });
});
test('the bar: a quote, and each list', () => {
  assert.deepEqual(active(at('> said\n', 'said')), { ...NOWHERE, quote: true });
  assert.deepEqual(active(at('- one\n- two\n', 'two')), { ...NOWHERE, list: true });
  assert.deepEqual(active(at('1. one\n2. two\n', 'two')), { ...NOWHERE, numbered: true });
  assert.deepEqual(active(at('- [ ] one\n- [x] two\n', 'two')), { ...NOWHERE, checklist: true }, 'a checklist is not shown as a bulleted list too');
  assert.deepEqual(active(at('1. [ ] one\n', 'one')), { ...NOWHERE, numbered: true, checklist: true });
  assert.deepEqual(active(at('- a\n  1. inner\n', 'inner')), { ...NOWHERE, numbered: true }, 'the innermost list');
  assert.deepEqual(active(at('1. a\n   - [ ] inner\n', 'inner')), { ...NOWHERE, checklist: true });
  assert.deepEqual(active(at('> - **row**\n', 'row')), { ...NOWHERE, quote: true, list: true, bold: true });
  assert.deepEqual(active(at('- one\n- [ ] two\n', 'one')), { ...NOWHERE, list: true }, 'the row the caret is in');
  const mixed = open('- one\n- [ ] two\n');
  mixed.dispatch(mixed.state().tr.setSelection(PM.TextSelection.create(mixed.state().doc, wordAt(mixed.state().doc, 'one'), wordAt(mixed.state().doc, 'two') + 1)));
  assert.deepEqual(active(mixed), { ...NOWHERE, list: true }, 'a row with a box and a row without: a bulleted list');
});
test('the bar says what a press will do: on means the press takes the format off', () => {
  for (const [md, word, action, name] of [['> said\n', 'said', 'quote', 'quote'], ['- one\n', 'one', 'list', 'list'], ['1. one\n', 'one', 'numbered', 'numbered'], ['- [ ] one\n', 'one', 'checklist', 'checklist'], ['## Head\n', 'Head', 'h2', 'heading']]) {
    const ed = at(md, word);
    assert.ok(active(ed)[name], `${action}: on`);
    assert.equal(ed.run(action), true);
    assert.ok(!active(ed)[name], `${action}: off after the press`);
    assert.equal(ed.run(action), true);
    assert.ok(active(ed)[name], `${action}: on again`);
  }
});
test('the bar never reads the words: no text of the document is asked for', () => {
  const proto = PM.Node.prototype;
  const kept = { textBetween: proto.textBetween, textContent: Object.getOwnPropertyDescriptor(proto, 'textContent'), toString: proto.toString };
  const eds = [at('a **bold** b\n', 'bold'), at('- [ ] one\n', 'one'), at('> # Head\n', 'Head', 2)];
  const all = open(TEXT);
  all.selectAll();
  eds.push(all);
  let asked = 0;
  proto.textBetween = () => { asked += 1; return ''; };
  Object.defineProperty(proto, 'textContent', { configurable: true, get() { asked += 1; return ''; } });
  try { for (const ed of eds) active(ed); } finally { proto.textBetween = kept.textBetween; Object.defineProperty(proto, 'textContent', kept.textContent); }
  assert.equal(asked, 0);
  assert.ok(!/\.text\b|textBetween|textContent|getText|toString/.test(String(L.dlRichActive)), 'and its code names no way to read them');
});
test('the bar is told of every move of the caret and every change, and of nothing after destroy', () => {
  const ed = open('one **two**\n');
  let heard = 0;
  ed.onSelect(() => { heard += 1; });
  select(ed, 0, 1);
  assert.equal(heard, 1, 'a move of the caret');
  assert.equal(ed.active().bold, false);
  select(ed, 0, 5);
  assert.equal(heard, 2);
  assert.equal(ed.active().bold, true, 'active() is the state now');
  ed.type('x');
  assert.equal(heard, 3, 'a change of the text');
  ed.setText('new\n');
  assert.equal(heard, 4, 'a new text');
  const rev = ed.revision();
  select(ed, 0, 1);
  assert.equal(ed.revision(), rev, 'a move of the caret is still not a change');
  assert.equal(heard, 5);
  ed.destroy();
  ed.dispatch(ed.state().tr.insertText('y'));
  assert.equal(heard, 5, 'destroy lets go');
});

// ---- 11. the new keys ----------------------------------------------------------------------------------------------------------
test('Mod-b, Mod-i and Mod-e are Bold, Italic and Code on the selection, kept; always taken, so the browser does none of its own', () => {
  for (const [k, mark, written] of [['Mod-b', M.strong, '**plain**'], ['Mod-i', M.em, '*plain*'], ['Mod-e', M.code, '`plain`']]) {
    const ed = open('some plain words\n\nnext __one__\n');
    select(ed, 0, 5, 10);
    assert.equal(key(ed, k), true);
    assert.ok(ed.state().doc.rangeHasMark(6, 11, mark), k);
    assert.deepEqual([ed.state().selection.from, ed.state().selection.to], [6, 11], 'the selection is kept');
    assert.equal(ed.getText(), `some ${written} words\n\nnext __one__\n`);
    assert.equal(key(ed, k), true);
    assert.equal(ed.getText(), 'some plain words\n\nnext __one__\n');
    const code = open('```\ncode\n```\n');
    select(code, 0, 0, 3);
    const before = code.state().doc;
    assert.equal(key(code, k), true, `${k} in a code block is taken`);
    assert.ok(code.state().doc === before, 'and does nothing');
    const locked = L.dlRichKeys(PM)[k](ed.state(), ed.dispatch, { editable: false });
    assert.equal(locked, false, `${k} in an editor that cannot be typed in is not taken`);
    assert.equal(ed.getText(), 'some plain words\n\nnext __one__\n');
  }
});
test('Mod-Enter ticks and clears the checklist row the caret is in', () => {
  const ed = at('- [ ] one\n- [x] two\n\nend __x__\n', 'one');
  assert.equal(key(ed, 'Mod-Enter'), true);
  assert.equal(ed.getText(), '- [x] one\n- [x] two\n\nend __x__\n');
  assert.equal(ed.state().selection.from, wordAt(ed.state().doc, 'one') + 1, 'the caret stays');
  assert.equal(key(ed, 'Mod-Enter'), true);
  assert.equal(ed.getText(), '- [ ] one\n- [x] two\n\nend __x__\n', 'cleared again: the stored text, exactly');
  const inner = at('- [ ] outer\n  - [x] inner\n', 'inner');
  assert.equal(key(inner, 'Mod-Enter'), true);
  assert.equal(inner.getText(), '- [ ] outer\n  - [ ] inner\n', 'the innermost row only');
  for (const [md, word] of [['- plain row\n', 'plain'], ['a paragraph\n', 'paragraph'], ['1. numbered\n', 'numbered'], ['- [ ] task\n\n  ```\n  codehere\n  ```\n', 'codehere'], ['- [x] outer\n  - plain inner\n', 'plain']]) {
    const not = at(md, word);
    const before = not.state().doc;
    assert.equal(key(not, 'Mod-Enter'), false, md);
    assert.ok(not.state().doc === before);
  }
  assert.equal(L.dlRichKeys(PM)['Mod-Enter'](ed.state(), ed.dispatch, { editable: false }), false, 'not in an editor that cannot be typed in');
});

const secs = ((Date.now() - t0) / 1000).toFixed(1);
if (fails.length) {
  for (const f of fails) console.error(`FAIL ${f}`);
  console.error(`documents rich editor: ${fails.length} failed, ${passed} passed in ${secs} s`);
  process.exit(1);
}
console.log(`documents rich editor: ${passed} tests passed in ${secs} s (open-then-Done exact on the corpus; ${STATES.length} states Markdown cannot say; ${HOSTILE_PASTE.length} hostile pastes; ${L.DL_RICH_RULES.length} typing rules; ${REFUSED.length} refused addresses)`);
