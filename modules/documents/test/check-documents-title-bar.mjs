#!/usr/bin/env node
/*
 * check-documents-title-bar.mjs -- the document's title is in the title bar, not in the page (#781). Source read: this is not the page running.
 *   - the page has no heading for the title (no #read-title; #edit-title is a hidden copy), so neither the reader, the editor, Paper nor Fluid draw it;
 *   - the title bar gets ONE select (host.header.set, kind 'select', id doc-select) carrying the title, with the documents, New document, Rename, Delete;
 *   - the toolbar is made in the row's order: Back, Tags, the formats, Insert on the left; Page, Layout, Editor on the right;
 *   - Print still carries the title as its first heading, and Save as Markdown file is named by it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const page = fs.readFileSync(path.join(src, 'documents.js'), 'utf8');
const html = fs.readFileSync(path.join(src, 'documents.html'), 'utf8');
let passed = 0;
const test = (name, fn) => { try { fn(); passed += 1; } catch (err) { console.log(`FAIL ${name}\n  ${err.message}`); process.exitCode = 1; } };

test('the page draws no title', () => {
  assert.ok(!html.includes('read-title') && !page.includes('read-title'), 'no #read-title');
  assert.ok(!/<h1[^>]*doc-title/.test(html), 'no heading in the page');
  assert.ok(/<input id="edit-title" type="hidden">/.test(html), '#edit-title is a hidden copy, not a box');
  assert.ok(!html.includes('id="renamer"'), 'no inline rename form');
});
test('the title bar carries the title as a select with the three actions', () => {
  assert.ok(/kind: 'select', id: 'doc-select', label: titleNow\(\)/.test(page), 'the select shows the live title');
  for (const [id, label] of [['new', 'New document'], ['rename', 'Rename'], ['delete', 'Delete']]) assert.ok(page.includes(id === 'new' ? `{ id: '${id}', label: '${label}' }` : `{ id: '${id}', label: '${label}', ...off() }`), `${label} is in the menu`);
  assert.ok(page.includes("items.push({ divider: true }, ...acts)"), 'the actions sit behind a divider');
  assert.ok(page.includes('if (canEdit && !joining())'), 'only who may edit, and not while joining');
  assert.ok(page.includes("if (v === 'delete') { if (!canEdit) return; if (ed && ed.co) coRemove(); else if (!ed && openId) startRemove();"), 'Delete takes the read view\'s and the shared editor\'s paths');
  assert.ok(page.includes("const SELECT_DOCS = 40"), 'at most 40 documents, so the menu stays under the host\'s 50');
});
test('the toolbar is made in order', () => {
  // each anchor is the toolbar construction itself (host.ui.toolbarButton / viewSwitch), never an earlier use of the same words
  const anchors = ["host.ui.toolbarButton({ id: 'back'", "host.ui.toolbarButton({ id: 'tags'", 'host.ui.toolbarButton({ id: `fmt-${f.id}`', "host.ui.toolbarButton({ id: 'insert'", "host.ui.toolbarButton({ id: 'paper'", "host.ui.viewSwitch({ id: 'layout'", "host.ui.viewSwitch({ id: 'editview'"];
  const order = anchors.map((a) => page.indexOf(a));
  anchors.forEach((a, i) => assert.ok(order[i] > 0, `missing: ${a}`));
  order.forEach((n, i) => assert.ok(!i || n > order[i - 1], `out of order: ${anchors[i]} (${order})`));
  assert.ok(/id: 'paper'[^\n]*zone: 'end'/.test(page) && /id: 'layout'[^\n]*zone: 'end'/.test(page) && /id: 'editview'[^\n]*zone: 'end'/.test(page), 'the last three are the right zone');
  assert.ok(!page.includes("id: 'rename', label: 'Rename', icon: 'pen-to-square', placement: 'menu'"), 'no Rename or Delete left in the toolbar');
});
test('a locked shared document: Rename and Delete are off with the reason, the rest stay on', () => {
  const fn = page.slice(page.indexOf('function docsSelect()'), page.indexOf('let headerKey'));
  assert.ok(fn.includes('coRemoveRules(coLockNow())'), 'the select asks the lock rules');
  assert.ok(/const off = \(\) => \(rules\.off \? \{ disabled: true, hint: rules\.reason \} : \{\}\)/.test(fn), 'off = disabled with the reason as hint');
  assert.ok(fn.includes("label: 'Rename', ...off()") && fn.includes("label: 'Delete', ...off()"), 'Rename and Delete carry it');
  assert.ok(fn.includes("{ id: 'new', label: 'New document' }"), 'New document carries no off');
  assert.ok(!/id: 'd\.\$\{r\.id\}'[^\n]*disabled/.test(fn), 'picking another document stays on');
  assert.ok(page.includes('paintHeader(); // Rename and Delete in the title bar'), 'the select is redrawn when the lock changes');
  assert.ok(/if \(v === 'rename'\)[^\n]*coRename\(\)/.test(page) && /function coRename\(\)[\s\S]{0,400}if \(rules\.off\) \{ note\(rules\.reason\)/.test(page), 'the click guard stays');
});
test('the lock rules give the reason when locked and none otherwise (the real rules)', () => {
  const lib = fs.readFileSync(path.join(src, 'documents-lib-x-coedit-meta.js'), 'utf8');
  const dlCoRemoveRules = new Function(`${lib}\nreturn dlCoRemoveRules;`)();
  const lock = { by: 'sam', name: 'Sam', at: 1 };
  const mine = dlCoRemoveRules({ me: 'ann', role: 'member', lock, ownerWord: 'an owner' });
  assert.equal(mine.off, true); assert.match(mine.reason, /^Only Sam or an owner can unlock\./);
  assert.equal(dlCoRemoveRules({ me: 'ann', role: 'member', lock: null }).off, false, 'no lock: on');
  assert.equal(dlCoRemoveRules({ me: 'sam', role: 'member', lock }).off, false, 'the locker: on');
  assert.equal(dlCoRemoveRules({ me: 'ann', role: 'owner', lock }).off, false, 'an owner: on');
});
test('Print and Save as Markdown file keep the title', () => {
  assert.ok(page.includes("sheet.append(el('h1', 'doc-title', cur.title));"), 'the printout\'s first heading is the title');
  assert.ok(page.includes("dlExportName(cur.title, 'Document')"), 'the file is named by the title');
});
console.log(`documents title bar: ${passed} tests passed`);
