#!/usr/bin/env node
/*
 * check-documents-coedit-paste.mjs -- a paste that would take a shared document over the saver's size cap is refused before it is a change
 * (dlRichEditor with env.shared, documents-lib-p-rich-editor.js). Node, no DOM: the editor runs with no element. The page's reading of the
 * clipboard, the message on the screen and Back while joining are checked in a real browser by the build's own script, not here.
 *
 * Usage: node modules/documents/test/check-documents-coedit-paste.mjs [path to the src folder]. Exits 1 on any failure.
 */
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadYjs } from './support/yjs-peers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(root, 'modules/documents/src'));
const { PM, L, lex } = loadYjs(src);
let passed = 0; const fails = [];
function test(name, fn) { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

const shared = (cap, told) => {
  const ydoc = new PM.Doc(); const frag = ydoc.getXmlFragment('prosemirror');
  const ed = L.dlRichEditor(PM, null, lex, null, { shared: { frag }, sizeMax: cap, onTooBig: () => told.push(1) });
  return { ed, frag };
};
const paras = (n) => Array.from({ length: n }, (_, i) => `paragraph ${i} of the paste`).join('\n\n');

test('a paste under the cap goes in', () => {
  const told = []; const { ed, frag } = shared(2000, told);
  assert.equal(ed.paste(paras(10)), true); assert.ok(ed.state().doc.childCount >= 10); assert.equal(told.length, 0);
});
test('a paste over the cap is refused: nothing in the document, nothing shared, said once, not counted as a change', () => {
  const told = []; const { ed, frag } = shared(2000, told); const rev = ed.revision(); const sent = [];
  frag.doc.on('update', (u) => sent.push(u));
  const text = paras(200); assert.ok(text.length > 2000);
  assert.equal(ed.paste(text), false);
  assert.equal(ed.state().doc.childCount, 1, 'nothing was inserted'); assert.equal(sent.length, 0, 'nothing was sent'); assert.equal(told.length, 1, 'said once'); assert.equal(ed.revision(), rev, 'not a change');
});
test('over the cap together with what is there: refused; and a document without the cap setting is not guarded', () => {
  const told = []; const { ed, frag } = shared(300, told);
  assert.equal(ed.paste(paras(10)), true); const before = ed.state().doc.childCount;
  assert.equal(ed.paste(paras(10)), false); assert.equal(ed.state().doc.childCount, before); assert.equal(told.length, 1);
  const plain = L.dlRichEditor(PM, null, lex, null); assert.equal(plain.paste(paras(200)), true);
});

if (fails.length) { console.error(`documents coedit paste: ${fails.length} failed, ${passed} passed`); for (const f of fails) console.error(`  - ${f}`); process.exit(1); }
console.log(`documents coedit paste: ${passed} tests passed`);
