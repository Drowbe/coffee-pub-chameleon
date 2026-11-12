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
import { NAMES } from './support/yjs-peers.mjs';
import { loadRich } from './support/rich-corpus.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(root, 'modules/documents/src'));
const { PM, L, lex } = loadRich(src, [...NAMES, 'DL', 'dlSplit']);
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

// The saver's own figure: the text getText writes, and dlSplit's cap (refuses only above DL.sizeMax).
const saverSays = (ed) => L.dlSplit(ed.getText()).ok;
const cap = L.DL.sizeMax;
const bigShared = () => { const told = []; return { told, ...shared(cap, told) }; };
const paraOf = (n, ch = 'x') => ch.repeat(n);

test('1,000 paragraphs, then one 49,500-character paragraph: refused as the saver would refuse it, nothing diverges', () => {
  const { ed, frag, told } = bigShared();
  const body = Array.from({ length: 1000 }, (_, i) => `${String(i).padStart(4, '0')}${paraOf(95)}`).join('\n\n'); // 99 characters each
  assert.equal(ed.paste(body), true); assert.equal(saverSays(ed), true);
  const plain = ed.state().doc.textContent.length + 49500; assert.ok(plain <= cap, 'the old count (words + raw) would have let it in');
  const sent = []; frag.doc.on('update', (u) => sent.push(u));
  const before = ed.getText();
  const took = ed.paste(paraOf(49500, 'y'));
  assert.equal(took, false, 'the saver would refuse this text');
  assert.equal(ed.getText(), before); assert.equal(sent.length, 0); assert.equal(told.length, 1); assert.equal(saverSays(ed), true);
  assert.equal(ed.paste(paraOf(40000, 'y')), true, 'a smaller one still fits'); assert.equal(saverSays(ed), true);
});
test('1,000 short paragraphs and one 49,500-character paragraph: accepted, and the saver saves it', () => {
  const { ed, told } = bigShared();
  assert.equal(ed.paste(`${Array.from({ length: 1000 }, (_, i) => `p${i}`).join('\n\n')}\n\n${paraOf(49500)}`), true);
  assert.equal(told.length, 0); assert.equal(saverSays(ed), true);
});
test('a paste with CRLF that fits as LF is accepted', () => {
  const told = []; const { ed } = shared(2000, told);
  const lf = paras(60); assert.ok(lf.length < 2000 - 100);
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.equal(ed.paste(crlf), true); assert.equal(told.length, 0);
  assert.equal(saverSays(ed), true);
});
test('a saved text of exactly the cap is accepted and saves; one more is refused (the saver adds one line break at the end)', () => {
  for (const extra of [0, 1]) {
    const told = []; const { ed } = shared(cap, told);
    const ok = ed.paste(paraOf(cap - 1 + extra)); // one paragraph of n characters is saved as n + 1 characters
    if (extra === 0) { assert.equal(ok, true); assert.equal(ed.getText().length, cap); assert.equal(saverSays(ed), true); }
    else { assert.equal(ok, false); assert.equal(told.length, 1); assert.equal(ed.state().doc.childCount, 1); assert.equal(ed.getText().length, 0); }
  }
});
test('random pastes: accepted by the guard means the saver saves (2,000 cases)', () => {
  let seed = 12345; const rnd = (n) => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return (((t ^ (t >>> 14)) >>> 0) % n); };
  const small = 3000; let accepted = 0; let refused = 0;
  for (let k = 0; k < 2000; k += 1) {
    const told = []; const { ed } = shared(small, told);
    const gap = ['\n\n', '\r\n\r\n', '\n', '\n\n\n'][rnd(4)];
    const blocks = Array.from({ length: 1 + rnd(60) }, () => (['# ', '- ', '', '> ', '1. '][rnd(5)]) + 'w'.repeat(rnd(200)) + 'a');
    const text = blocks.join(gap);
    const first = ed.paste(text); const second = ed.paste(blocks.slice(0, 1 + rnd(blocks.length)).join(gap));
    const out = ed.getText().length;
    assert.ok(out <= small, `case ${k}: the document is ${out}, over the cap`);
    assert.equal(out <= small, true);
    if (first) accepted += 1; else refused += 1;
  }
  assert.ok(accepted > 100 && refused > 100, `mix ${accepted}/${refused}`);
});
test('the refusal changes nothing and uses the one note', () => {
  const { ed, frag, told } = bigShared(); const sent = [];
  frag.doc.on('update', (u) => sent.push(u));
  assert.equal(ed.paste(paraOf(cap + 5)), false);
  assert.equal(sent.length, 0); assert.equal(told.length, 1);
});

if (fails.length) { console.error(`documents coedit paste: ${fails.length} failed, ${passed} passed`); for (const f of fails) console.error(`  - ${f}`); process.exit(1); }
console.log(`documents coedit paste: ${passed} tests passed`);
