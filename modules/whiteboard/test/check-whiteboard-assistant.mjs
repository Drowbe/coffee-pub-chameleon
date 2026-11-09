#!/usr/bin/env node
/*
 * check-whiteboard-assistant.mjs -- the Whiteboard's Send to Assistant (whiteboard-lib-m-ask.js): the question made from the
 * picked blocks' words. Guards: the markup's marks taken out with the host's own plain text (lines kept), a table as one
 * line per row with its cells joined by " | ", a picture's description and a connector's label, the blocks with no words
 * left out (line, stroke, highlight, timer), reading order (top to bottom, left to right along a line, not the stacking
 * order), a blank selection giving no question, and the 1000-character limit counted as Chat counts (an emoji or an
 * "é" is one character) while the host's own cut (1000 units of the browser's string, an emoji is two) is kept to too.
 * It runs the module's own libs in one scope as the page has them, with the SDK's plain text (public/sdk/host.js) as
 * the page's host.util.plain. No network, no browser.
 * Usage: node modules/whiteboard/test/check-whiteboard-assistant.mjs [path to the module's src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
const NAMES = ['wbAskText', 'wbAskWords', 'wbAskOrder', 'WB_ASK', 'wbMarkup'];
const fails = [];
let passed = 0;
let api = {};
// The SDK's plain text, as the page hands it to the board (wbMarkup.plain = host.util.plain): from "const BLOCK_TAGS" to
// the end of plainText in public/sdk/host.js.
let plain = null;
try {
  const sdk = fs.readFileSync(path.join(root, 'public/sdk/host.js'), 'utf8');
  const start = sdk.indexOf('  const BLOCK_TAGS');
  const fn = sdk.indexOf('  function plainText(', start);
  const end = sdk.indexOf('\n  }\n', fn);
  if (start < 0 || fn < 0 || end < 0) throw new Error('plainText was not found in public/sdk/host.js');
  plain = new Function(`${sdk.slice(start, end + 4)}\nreturn plainText;`)();
} catch (err) {
  fails.push(`the SDK's plain text does not load: ${err.message}`);
}
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-[a-z]-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  const grab = NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  api = new Function('window', 'document', `${parts.join('\n')}\nreturn { ${grab} };`)({ devicePixelRatio: 1 }, undefined);
  if (api.wbMarkup && plain) api.wbMarkup.plain = plain;
} catch (err) {
  fails.push(`the libs do not load: ${err.message}`);
}
const { wbAskText, wbAskWords, WB_ASK } = api;
const t = (name, fn) => { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } };
const R = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
const at = (block, rect) => ({ block, rect });

t('a note: markup taken out, lines kept', () => assert.equal(wbAskWords({ type: 'note', text: '**Solve** for *x*:\n\n\n`2x + 3 = 7`  now' }), 'Solve for x:\n\n2x + 3 = 7 now'));
t('a link reads as words and address', () => assert.equal(wbAskWords({ type: 'text', text: '[help](https://example.com)' }), 'help (https://example.com)'));
t('a shape: its words', () => assert.equal(wbAskWords({ type: 'diamond', text: '# Is x > 2?' }), 'Is x > 2?'));
t('a picture: its description', () => assert.equal(wbAskWords({ type: 'image', alt: '  a right   triangle ' }), 'a right triangle'));
t('a connector: its label', () => assert.equal(wbAskWords({ type: 'connector', label: 'divide by 2' }), 'divide by 2'));
t('a table: rows on lines, cells joined, empty rows and trailing empty cells left out', () => assert.equal(
  wbAskWords({ type: 'table', cells: [['x', 'y', ''], [], ['**1**', '2'], ['', '4']] }), 'x | y\n1 | 2\n | 4'));
t('no words: line, stroke, highlight, timer', () => {
  for (const type of ['line', 'stroke', 'highlight', 'timer']) assert.equal(wbAskWords({ type, text: 'x', label: 'x' }), '', type);
});
t('reading order: top to bottom, left to right along a line, not stacking order', () => {
  const list = [
    at({ type: 'note', text: 'D' }, R(0, 300, 100, 400)),
    at({ type: 'note', text: 'B' }, R(200, 10, 300, 110)), // starts above the middle of A: on A's line
    at({ type: 'note', text: 'A' }, R(0, 0, 100, 100)),
    at({ type: 'note', text: 'C' }, R(0, 120, 100, 220)),
    at({ type: 'text', text: 'none' }, null), // not drawn: last
  ];
  assert.equal(wbAskText(list).text, 'A\n\nB\n\nC\n\nD\n\nnone');
});
t('omitted and blank blocks leave no gap', () => {
  const list = [at({ type: 'note', text: 'one' }, R(0, 0, 10, 10)), at({ type: 'stroke' }, R(0, 20, 10, 30)), at({ type: 'note', text: '   ' }, R(0, 40, 10, 50)), at({ type: 'note', text: 'two' }, R(0, 60, 10, 70))];
  assert.equal(wbAskText(list).text, 'one\n\ntwo');
});
t('a blank selection: no question', () => {
  assert.deepEqual(wbAskText([]), { text: '', count: 0, over: 0 });
  assert.equal(wbAskText([at({ type: 'timer' }, R(0, 0, 1, 1)), at({ type: 'image', alt: '' }, R(0, 0, 1, 1))]).text, '');
});
t('the limit is 1000', () => assert.equal(WB_ASK.max, 1000));
t('1000 characters fit; 1001 is one over', () => {
  assert.equal(wbAskText([at({ type: 'text', text: 'a'.repeat(1000) }, R(0, 0, 1, 1))]).over, 0);
  assert.deepEqual(wbAskText([at({ type: 'text', text: 'a'.repeat(1001) }, R(0, 0, 1, 1))]), { text: 'a'.repeat(1001), count: 1001, over: 1 });
});
t('"é" is one character', () => {
  const q = wbAskText([at({ type: 'text', text: 'é'.repeat(1000) }, R(0, 0, 1, 1))]);
  assert.equal(q.count, 1000); assert.equal(q.over, 0);
});
t('an emoji is one character as Chat counts, but the host cuts at 1000 string units: kept to as well', () => {
  const q = wbAskText([at({ type: 'text', text: '😀'.repeat(500) }, R(0, 0, 1, 1))]);
  assert.equal(q.count, 500); assert.equal(q.over, 0); // 1000 units: fits exactly
  const q2 = wbAskText([at({ type: 'text', text: '😀'.repeat(501) }, R(0, 0, 1, 1))]);
  assert.equal(q2.count, 501); assert.equal(q2.over, 2);
});
t('the separators count', () => {
  const q = wbAskText([at({ type: 'text', text: 'a'.repeat(499) }, R(0, 0, 1, 1)), at({ type: 'text', text: 'b'.repeat(499) }, R(0, 10, 1, 11))]);
  assert.equal(q.count, 1000); assert.equal(q.over, 0);
});

if (fails.length) {
  console.error(`check-whiteboard-assistant: ${fails.length} failed, ${passed} passed`);
  for (const f of fails) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(`check-whiteboard-assistant: ${passed} passed`);
