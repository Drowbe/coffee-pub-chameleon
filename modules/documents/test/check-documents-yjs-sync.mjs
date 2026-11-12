#!/usr/bin/env node
/*
 * check-documents-yjs-sync.mjs -- the Yjs half of the vendored bundle (documents-lib-0-prosemirror.js: ProseMirror + Yjs +
 * y-prosemirror), in Node with no DOM. Plan: plan-documents-coediting.md. Stand-in view and network: support/yjs-peers.mjs.
 *
 * 1. THE BUNDLE. The names the co-editing steps use are exported (and Awareness and every provider are not); the bundle starts no
 *    network, storage or timer of its own; the one outside address is gone; Yjs's "already imported" message is intact.
 * 2. THE ROUND TRIP. Every corpus, fuzz, source-form and hostile text: the document goes into a Y.Doc and a second, empty peer
 *    reads it back equal (node for node, marks and attributes included), and the Markdown it writes is the stored text.
 * 3. THE TWO y-prosemirror PATCHES (recipe in THIRD-PARTY.md). (a) Marks on inline atoms (chip, formula, raw inline) survive the
 *    round trip (Yjs keeps marks only on text, so without the patch they are lost); this test fails on the unpatched library.
 *    (b) A selected node that another peer deletes does not throw in the receiving peer (restoreRelativeSelection).
 *
 * Usage: node modules/documents/test/check-documents-yjs-sync.mjs [--fuzz=N] [path to the src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { CASES, BREAK_CASES, HOSTILE, fuzzDocs, sourceDocs } from './support/rich-corpus.mjs';
import { loadYjs, Net, nodesOfType } from './support/yjs-peers.mjs';

const t0 = Date.now();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const fuzzArg = args.find((a) => a.startsWith('--fuzz='));
const FUZZ = fuzzArg ? Math.max(1, Number(fuzzArg.slice(7)) || 0) : 120;
const src = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(root, 'modules/documents/src'));
const bundleText = fs.readFileSync(path.join(src, 'documents-lib-0-prosemirror.js'), 'utf8');
const ctx = loadYjs(src);
const { PM, L, lex, schema } = ctx;

let passed = 0; const fails = [];
function test(name, fn) { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

// ---- 1. the bundle ------------------------------------------------------------------------------------------------------------------
test('bundle: the names the co-editing steps use', () => {
  for (const k of ['Doc', 'applyUpdate', 'encodeStateAsUpdate', 'encodeStateVector', 'transact', 'mergeUpdates', 'diffUpdate', 'snapshot', 'UndoManager', 'XmlFragment', 'XmlElement', 'XmlText', 'YMap',
    'createRelativePositionFromTypeIndex', 'createAbsolutePositionFromRelativePosition', 'PermanentUserData',
    'ySyncPlugin', 'yUndoPlugin', 'yUndo', 'yRedo', 'prosemirrorToYXmlFragment', 'prosemirrorToYDoc', 'prosemirrorJSONToYDoc', 'prosemirrorJSONToYXmlFragment',
    'yXmlFragmentToProseMirrorRootNode', 'yXmlFragmentToProsemirrorJSON', 'yDocToProsemirrorJSON', 'initProseMirrorDoc', 'absolutePositionToRelativePosition', 'relativePositionToAbsolutePosition',
    'gridEditing', 'tableEditing']) assert.equal(typeof PM[k], 'function', `DlPM.${k} is missing`);
  for (const k of ['ySyncPluginKey', 'yUndoPluginKey']) assert.equal(typeof PM[k].getState, 'function', `DlPM.${k} is missing`);
  for (const k of ['Awareness', 'yCursorPlugin', 'WebsocketProvider', 'WebrtcProvider', 'IndexeddbPersistence']) assert.equal(PM[k], undefined, `DlPM.${k} must not be there`);
});
test('bundle: nothing that loads, stores or connects was added', () => {
  assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection|BroadcastChannel|importScripts|sendBeacon)\b/.test(bundleText), 'a network word in the bundle');
  assert.ok(!/\beval\s*\(|new Function\b|\bimport\s*\(/.test(bundleText), 'eval, new Function or import() in the bundle');
  assert.ok(!/indexedDB|sessionStorage|document\.cookie|serviceWorker/.test(bundleText), 'a storage word in the bundle');
  // lib0 names localStorage in its storage helper (3 mentions); nothing in the bundle's exports calls it
  assert.equal((bundleText.match(/localStorage/g) || []).length, 3, 'the localStorage mentions (lib0 storage helper, unused) changed: read them again');
  assert.equal((bundleText.match(/\binnerHTML\b/g) || []).length, 4, 'innerHTML must stay the four clipboard lines');
});
test('bundle: no address of Yjs is left, its other message is intact', () => {
  assert.ok(!/github\.com\/yjs/.test(bundleText), 'a github.com/yjs address is in the bundle');
  assert.ok(/Yjs was already imported\. This breaks constructor checks and will lead to issues!/.test(bundleText), 'the message text was cut too far');
  assert.ok(!/[^\x00-\x7f]/.test(bundleText), 'the bundle holds a character outside ASCII');
});
test('bundle: it names the Yjs packages and what was modified', () => {
  const head = bundleText.slice(0, bundleText.indexOf('*/'));
  for (const w of ['yjs 13.6.33', 'y-prosemirror 1.3.7', 'lib0 0.2.120', 'isomorphic.js 0.2.5', 'Kevin Jahns', 'RWTH Aachen']) assert.ok(head.includes(w), `the header lacks ${w}`);
});
test('bundle: the two patches are in (the recipe asserts each applied)', () => {
  assert.ok(bundleText.includes('"_marks"') || bundleText.includes("'_marks'"), 'patch (a): the _marks attribute is missing');
  assert.ok(/NodeSelection\.isSelectable|\.isSelectable\(/.test(bundleText), 'patch (b): the NodeSelection guard is missing');
});

// ---- 2. the round trip --------------------------------------------------------------------------------------------------------------
function trip(doc, label, stored) {
  const net = new Net(ctx);
  try {
    const a = net.peer('A', { seed: doc }); const b = net.peer('B'); net.sync(); net.deliver();
    assert.ok(a.view.state.doc.eq(doc), `${label}: the seeding peer reads another document`);
    assert.ok(b.view.state.doc.eq(doc), `${label}: the second peer reads another document\n   ${JSON.stringify(b.view.state.doc.toJSON()).slice(0, 300)}\n   ${JSON.stringify(doc.toJSON()).slice(0, 300)}`);
    assert.equal(a.bad + b.bad, 0, `${label}: a peer holds a document the schema refuses`);
    assert.equal(L.dlRichSerialise(PM, b.view.state.doc), L.dlRichSerialise(PM, doc), `${label}: the Markdown differs`);
    if (stored) assert.equal(L.dlRichText(PM, b.view.state.doc, stored.stored, lex).text, stored.text, `${label}: the stored text is not kept`);
  } finally { net.destroy(); }
}
function sets() {
  return {
    corpus: CASES.map((c) => c[1]), breaks: BREAK_CASES.map((c) => c[1]), hostile: HOSTILE.map((h) => h[1]),
    fuzz: fuzzDocs(schema, FUZZ, false).map((d) => L.dlRichSerialise(PM, d)),
    fuzzExt: fuzzDocs(schema, FUZZ, true).map((d) => L.dlRichSerialise(PM, d)),
    source: sourceDocs(FUZZ),
  };
}
const counts = {};
for (const [name, texts] of Object.entries(sets())) {
  test(`round trip: ${name} (${texts.length} texts): PM to Y to PM is equal, the stored text is kept`, () => {
    let n = 0;
    for (const md of texts) { const rd = L.dlRichRead(PM, md, lex); trip(rd.doc, `${name} #${n}`, { stored: rd.stored, text: rd.stored.text }); n++; }
    counts[name] = n;
  });
}

// ---- 3. the patches -----------------------------------------------------------------------------------------------------------------
const N = schema.nodes, M = schema.marks;
test('patch (a): a mark on a chip, a formula and a raw inline survives the round trip', () => {
  const strong = M.strong.create(), em = M.em.create(), link = M.link.create({ href: 'https://example.com/a' }), code = M.code.create();
  const chip = N.object.create({ module: 'maps', kind: 'place', id: 'abc123', label: 'the map', title: '' });
  const doc = N.doc.create(null, [
    N.paragraph.create(null, [schema.text('a '), chip.mark([strong]), schema.text(' b '), N.formula.create({ tex: 'e=mc^2' }, null, [em, strong]), schema.text(' c '), N.source.create({ src: '<b>x</b>' }, null, [link]), schema.text(' d')]),
    N.paragraph.create(null, [N.formula.create({ tex: 'x' }, null, [code]).mark([code])]),
  ]);
  doc.check();
  trip(doc, 'marked atoms');
  const net = new Net(ctx);
  try { const a = net.peer('A', { seed: doc }); const b = net.peer('B'); net.sync(); net.deliver();
    const marks = [];
    b.view.state.doc.descendants((n) => { if (n.isAtom && n.isInline && !n.isText) marks.push(`${n.type.name}:${n.marks.map((m) => m.type.name).sort().join('+')}`); });
    assert.deepEqual(marks, ['object:strong', 'formula:em+strong', 'source:link', 'formula:code']);
    // an edit that only adds a mark to an atom reaches the other peer
    const at = nodesOfType(a.view.state.doc, 'object')[0];
    a.view.dispatch(a.view.state.tr.removeMark(at.pos, at.pos + 1, M.strong)); net.quiesce();
    assert.equal(nodesOfType(b.view.state.doc, 'object')[0].n.marks.length, 0, 'removing a mark from a chip did not reach the other peer');
    a.view.dispatch(a.view.state.tr.addMark(at.pos, at.pos + 1, M.em.create())); net.quiesce();
    assert.deepEqual(nodesOfType(b.view.state.doc, 'object')[0].n.marks.map((m) => m.type.name), ['em']);
    assert.ok(net.converged());
  } finally { net.destroy(); }
});
test('patch (b): another peer deletes the node this peer has selected: no throw, still valid', () => {
  const rd = L.dlRichRead(PM, 'Alpha one.\n\n$$\nx^2\n$$\n', lex);
  const net = new Net(ctx);
  try {
    const a = net.peer('A', { seed: rd.doc }); const b = net.peer('B'); net.sync(); net.deliver();
    const f = nodesOfType(b.view.state.doc, 'formula_block')[0];
    b.view.dispatch(b.view.state.tr.setSelection(PM.NodeSelection.create(b.view.state.doc, f.pos)));
    assert.ok(b.view.state.selection instanceof PM.NodeSelection);
    const g = nodesOfType(a.view.state.doc, 'formula_block')[0];
    a.view.dispatch(a.view.state.tr.delete(g.pos, g.pos + g.n.nodeSize));
    net.quiesce(); // the update reaches B's binding: it restores B's selection, which names a node that is gone
    assert.equal(b.exc + a.exc, 0, `an update threw: ${b.lastExc}${a.lastExc}`);
    assert.equal(nodesOfType(b.view.state.doc, 'formula_block').length, 0);
    assert.ok(net.converged());
    assert.equal(a.bad + b.bad, 0);
  } finally { net.destroy(); }
});

const secs = ((Date.now() - t0) / 1000).toFixed(1);
const summary = Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ');
if (fails.length) { console.error(`documents yjs sync: ${fails.length} failed, ${passed} passed (${summary})`); for (const f of fails) console.error(`  - ${f}`); process.exit(1); }
console.log(`documents yjs sync: ${passed} tests passed in ${secs} s (round trip: ${summary})`);
