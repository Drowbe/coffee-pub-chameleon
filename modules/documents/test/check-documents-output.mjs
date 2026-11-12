#!/usr/bin/env node
/*
 * check-documents-output.mjs -- Print, Save as Markdown file, Open Markdown file (documents-lib-u-output.js and its wiring):
 * the file name cleaner, the Markdown payload, a file's bytes to a text (BOM, CRLF, size, binary), the print page rules, and source
 * guards (print CSS leaves the chrome out; the wiring offers Save for readers and Open for editors only; no upload, no innerHTML).
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const files = fs.readdirSync(src).filter((f) => /^documents-lib-[a-z]-.*\.js$/.test(f)).sort();
const code = files.map((f) => fs.readFileSync(path.join(src, f), 'utf8')).join('\n');
const L = new Function(`${code}\nreturn { DL, dlExportName, dlExportMarkdown, dlFileTitle, dlFileText, dlPrintRules };`)();
const enc = (s) => new TextEncoder().encode(s);
let passed = 0;
const fails = [];
function test(name, fn) { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

test('file name: unsafe characters go, never empty, cut, unicode kept', () => {
  assert.equal(L.dlExportName('Plan', 'Document'), 'Plan.md');
  assert.equal(L.dlExportName('a/b\\c:d*e?f"g<h>i|j', 'Document'), 'abcdefghij.md');
  assert.equal(L.dlExportName('', 'Document'), 'Document.md');
  assert.equal(L.dlExportName('   ', 'Document'), 'Document.md');
  assert.equal(L.dlExportName('///', 'Document'), 'Document.md');
  assert.equal(L.dlExportName('..hidden', 'Document'), 'hidden.md');
  assert.equal(L.dlExportName('x\u0000y\n', 'Document'), 'x y.md');
  assert.equal(L.dlExportName('x'.repeat(500), 'Document'), `${'x'.repeat(80)}.md`);
  assert.equal(L.dlExportName('Séance \u2014 café \u65e5\u672c\u8a9e \ud83c\udfb2', 'Document'), 'Séance \u2014 café \u65e5\u672c\u8a9e \ud83c\udfb2.md');
  assert.equal(L.dlExportName(null, 'Document'), 'Document.md');
});
test('the Markdown payload is the stored text', () => {
  const t = '# Plan\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\nSee [site](https://a.b) and $x^2$.\n\n```\n[x](object:a:b:c)\n```\n\tcode\n';
  assert.equal(L.dlExportMarkdown(t), t);
  assert.equal(L.dlExportMarkdown(''), '');
});
test('a file name to a title', () => {
  assert.equal(L.dlFileTitle('Session notes.md', 'Document'), 'Session notes');
  assert.equal(L.dlFileTitle('C:\\docs\\plan.MARKDOWN', 'Document'), 'plan');
  assert.equal(L.dlFileTitle('/home/a/b/readme.txt', 'Document'), 'readme');
  assert.equal(L.dlFileTitle('v1.2.final.md', 'Document'), 'v1.2.final');
  assert.equal(L.dlFileTitle('Meeting 2026.11.12', 'Document'), 'Meeting 2026.11.12');
  assert.equal(L.dlFileTitle('.md', 'Document'), 'Document');
  assert.equal(L.dlFileTitle('', 'Document'), 'Document');
  assert.equal(L.dlFileTitle('a\u202eb\u0000c  d.md', 'Document'), 'ab c d');
  assert.equal(L.dlFileTitle('é'.repeat(300) + '.md', 'Document').length, L.DL.titleMax);
});
test('a file to a text: BOM, CRLF, UTF-8', () => {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc('# Hi\r\n\r\nline\r\n')]);
  assert.deepEqual(L.dlFileText(bom), { ok: true, text: '# Hi\n\nline\n' });
  assert.deepEqual(L.dlFileText(enc('caf\u00e9 \u65e5\u672c \ud83c\udfb2')), { ok: true, text: 'caf\u00e9 \u65e5\u672c \ud83c\udfb2' });
  assert.deepEqual(L.dlFileText(enc('old mac\rline')), { ok: true, text: 'old mac\nline' });
  assert.deepEqual(L.dlFileText(enc('')), { ok: true, text: '' });
  assert.deepEqual(L.dlFileText(enc('a\tb')), { ok: true, text: 'a\tb' });
});
test('a file to a text: too big and not text', () => {
  assert.equal(L.dlFileText(enc('x'.repeat(L.DL.sizeMax))).ok, true);
  assert.deepEqual(L.dlFileText(enc('x'.repeat(L.DL.sizeMax + 1))), { ok: false, reason: 'big' });
  assert.deepEqual(L.dlFileText(new Uint8Array(L.DL.sizeMax * 4 + 1)), { ok: false, reason: 'big' });
  assert.deepEqual(L.dlFileText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0])), { ok: false, reason: 'binary' });
  assert.deepEqual(L.dlFileText(new Uint8Array([0x61, 0xff, 0xfe, 0x62])), { ok: false, reason: 'binary' }); // not UTF-8
  assert.deepEqual(L.dlFileText(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x00])), { ok: false, reason: 'binary' });
  assert.equal(L.dlFileText(enc('ab\u0001cd')).text, 'abcd'); // a stray control character is dropped like in any document text
});
test('a Markdown file saved and opened again is the same text', () => {
  const t = '# T\n\n1. a\n2. b\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n[l](https://x.y)\n';
  const back = L.dlFileText(enc(L.dlExportMarkdown(t)));
  assert.equal(back.text, t);
});
test('print rules: Paper size, margin and numbers; Fluid a plain page', () => {
  const paper = L.dlPrintRules({ layout: 'paper', pageSize: 'a4', pageNumbers: true });
  assert.match(paper, /size: 210mm 297mm/);
  assert.match(paper, /margin: 96px/);
  assert.match(paper, /@bottom-center \{ content: counter\(page\)/);
  const noNum = L.dlPrintRules({ layout: 'paper', pageSize: 'letter', pageNumbers: false });
  assert.match(noNum, /size: 8\.5in 11in/);
  assert.doesNotMatch(noNum, /counter\(page\)/);
  const fluid = L.dlPrintRules({ layout: 'fluid', pageSize: 'a4', pageNumbers: true });
  assert.doesNotMatch(fluid, /size:|counter/);
  assert.match(fluid, /margin: 18mm/);
  assert.match(L.dlPrintRules(null), /@page/);
});
test('print CSS leaves the chrome out and keeps rows and headings whole', () => {
  const css = fs.readFileSync(path.join(src, 'documents-lib-u-output.css'), 'utf8');
  assert.match(css, /@media print/);
  assert.match(css, /\.app\.dl-printing > :not\(#dl-print\) \{ display: none !important; \}/);
  assert.match(css, /tr, \.dl-print pre[^{]*\{ break-inside: avoid; \}/);
  assert.match(css, /h1, h2, h3, h4, h5, h6\) \{ break-after: avoid/);
  assert.match(css, /\.dl-print \.dl-flow \.dl-pagebreak \{[^}]*position: static[^}]*break-after: page/); // as specific as documents.css's own .dl-flow rule, which hides it on screen
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'no raw colours');
});
test('the wiring: Save for readers, Open and the file picker for editors only, nothing uploaded or set as HTML', () => {
  const page = fs.readFileSync(path.join(src, 'documents.js'), 'utf8');
  const lib = page.slice(page.indexOf('function outputWire('), page.indexOf('const output = outputWire('));
  assert.ok(lib.length > 500, 'outputWire is in documents.js');
  assert.match(page, /items = \[\{ type: 'button', id: 'save-md'[^\]]*placement: 'menu' \}\];\n\s+if \(canEdit\)/); // reading: not behind canEdit
  assert.match(page, /canEdit && !showTrash \? \[\{ id: 'new'[^\]]*\{ id: 'open', label: 'Open Markdown file'/);
  assert.match(lib, /if \(!canEdit \|\| busy \|\| !file\) return;/);
  assert.match(lib, /if \(!canEdit\) return;\n\s+if \(!input\)/);
  assert.match(lib, /offerPrint[\s\S]*host\.standard\.set\(on \? \{ print/);
  assert.doesNotMatch(lib, /innerHTML|insertAdjacentHTML|outerHTML|host\.uploads|fetch\(/);
  assert.match(lib, /That file is too big for a document\./);
  assert.match(lib, /That does not look like a text file\./);
});

if (fails.length) { console.error(fails.map((f) => `FAIL ${f}`).join('\n')); process.exit(1); }
console.log(`check-documents-output: ${passed} passed`);
