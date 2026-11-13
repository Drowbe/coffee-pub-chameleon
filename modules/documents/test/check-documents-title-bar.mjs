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
  for (const [id, label] of [['new', 'New document'], ['rename', 'Rename'], ['delete', 'Delete']]) assert.ok(page.includes(`{ id: '${id}', label: '${label}' }`), `${label} is in the menu`);
  assert.ok(page.includes("items.push({ divider: true }, ...acts)"), 'the actions sit behind a divider');
  assert.ok(page.includes('if (canEdit && !joining())'), 'only who may edit, and not while joining');
  assert.ok(page.includes("if (v === 'delete') { if (!canEdit) return; if (ed && ed.co) coRemove(); else if (!ed && openId) startRemove();"), 'Delete takes the read view\'s and the shared editor\'s paths');
  assert.ok(page.includes("const SELECT_DOCS = 40"), 'at most 40 documents, so the menu stays under the host\'s 50');
});
test('the toolbar is made in order', () => {
  const at = (s) => page.indexOf(s);
  const order = ["toolbarButton({ id: 'back'", "id: 'tags'", 'id: `fmt-${f.id}`', "toolbarButton({ id: 'insert'", "id: 'paper'", "viewSwitch({ id: 'layout'", "viewSwitch({ id: 'editview'"].map(at);
  assert.ok(order.every((n) => n > 0) && order.every((n, i) => !i || n > order[i - 1]), `order ${order}`);
  assert.ok(/id: 'paper'[^\n]*zone: 'end'/.test(page) && /id: 'layout'[^\n]*zone: 'end'/.test(page) && /id: 'editview'[^\n]*zone: 'end'/.test(page), 'the last three are the right zone');
  assert.ok(!page.includes("id: 'rename', label: 'Rename', icon: 'pen-to-square', placement: 'menu'"), 'no Rename or Delete left in the toolbar');
});
test('Print and Save as Markdown file keep the title', () => {
  assert.ok(page.includes("sheet.append(el('h1', 'doc-title', cur.title));"), 'the printout\'s first heading is the title');
  assert.ok(page.includes("dlExportName(cur.title, 'Document')"), 'the file is named by the title');
});
console.log(`documents title bar: ${passed} tests passed`);
