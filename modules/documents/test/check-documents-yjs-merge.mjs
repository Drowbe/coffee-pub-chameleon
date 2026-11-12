#!/usr/bin/env node
/*
 * check-documents-yjs-merge.mjs -- what happens when people edit the same document at once through the vendored Yjs half of the
 * bundle (ySyncPlugin + yUndoPlugin on a stand-in view; support/yjs-peers.mjs says what that does and does not cover). Node, no DOM.
 * Plan: plan-documents-coediting.md; the numbers come from the spike (#665) and are asserted here so a library change shows.
 *
 * 1. SCENARIOS. Two peers on one document, updates shuffled: typing in one paragraph, in two paragraphs, in one grid cell; one
 *    deletes a block the other types in; two add a row at one spot; two delete one column; row against column. Every one
 *    converges to one document the schema accepts. Blocks nobody touched are written back word for word.
 * 2. THE KNOWN LIMITS, asserted so they cannot change unseen: text typed into a block, row or column another person deletes is gone
 *    (no breakage); a row added while a column is added leaves a grid that is not rectangular until the writer's page repairs it
 *    (dlCoeditGate(PM).repairGrids; the repair, the plugin set without fixTables and the gate are tested in check-documents-coedit-*.mjs).
 * 3. FUZZ. Three peers make random edits with shuffled and duplicated updates; one state-vector exchange; all converge and are valid.
 *    Dropped updates are not fixed by more of the same (pending structs) and ARE fixed by one state-vector exchange.
 * 4. HOSTILE UPDATES, THE LIBRARY ALONE. An update from a peer that is not our editor: what y-prosemirror throws away itself (unknown node,
 *    wrong nesting, bad attributes, a javascript: link) leaves a valid document and shows nothing hostile. What it does NOT catch
 *    (a top-level XmlText throws out of applyUpdate) is asserted so the layer under the gate cannot change unseen; the gate that
 *    closes it, and the whole hostile corpus, are in check-documents-coedit-gate.mjs.
 * 5. UNDO. yUndo undoes only the person's own edits, never another person's; redo; typed characters are grouped in 500 ms.
 *    (The ProseMirror history plugin must not be used together with ySyncPlugin: after a remote change its undo does nothing.)
 *
 * Usage: node modules/documents/test/check-documents-yjs-merge.mjs [--fuzz=N] [path to the src folder]. Exits 1 on any failure.
 */
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { CASES, fuzzDocs, sourceDocs } from './support/rich-corpus.mjs';
import { loadYjs, Net, rng, textOf, posOfText, nodesOfType, typeChars } from './support/yjs-peers.mjs';

const t0 = Date.now();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const fuzzArg = args.find((a) => a.startsWith('--fuzz='));
const FUZZ = fuzzArg ? Math.max(1, Number(fuzzArg.slice(7)) || 0) : 60;
const src = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(root, 'modules/documents/src'));
const ctx = loadYjs(src);
const { PM, L, lex, schema } = ctx;

let passed = 0; const fails = []; const facts = [];
async function test(name, fn) { try { await fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

const KITCHEN = ['# Title here', 'Alpha paragraph one.', 'Beta paragraph two with **bold** and a [link](https://example.com).',
  '- item a\n- item b\n  - nested c', '1. first\n2. second', '> quote text',
  '| h1 | h2 | h3 |\n| --- | --- | --- |\n| a1 | a2 | a3 |\n| b1 | b2 | b3 |\n| c1 | c2 | c3 |',
  '```js\ncode here\n```', '$$\nx^2 + y^2\n$$', 'Inline $e=mc^2$ formula and chip [the map](object:maps:place:abc123) text.',
  '<div>raw html block</div>', '_ _ _', 'Gamma paragraph three.', 'Delta paragraph four.',
  '| p | q |\n| --- | --- |\n| u | v |', 'Last paragraph.'].join('\n\n') + '\n';

// Two (or more) peers on the kitchen-sink document, all in sync.
function fresh(n = 2) {
  const net = new Net(ctx); const rd = L.dlRichRead(PM, KITCHEN, lex);
  const ps = [net.peer('A', { seed: rd.doc })]; for (let i = 1; i < n; i++) ps.push(net.peer('BCDEFGH'[i - 1]));
  net.sync(); net.deliver(); net.quiesce();
  return { net, rd, ps };
}
// The text the writer would store from this peer, and how much of the stored text it kept word for word.
function save(p, rd) {
  const r = L.dlRichText(PM, p.view.state.doc, rd.stored, lex);
  const now = new Map(); for (const e of L.dlRichRead(PM, r.text, lex).stored.entries) now.set(e.text, (now.get(e.text) || 0) + 1);
  let kept = 0; for (const e of rd.stored.entries) if (now.get(e.text) > 0) { kept++; now.set(e.text, now.get(e.text) - 1); }
  return { ...r, storedBlocks: rd.stored.entries.length, kept, changedOrGone: rd.stored.entries.length - kept };
}
const pt = (p, s, nth) => posOfText(p.view.state.doc, s, nth);
const widths = (p) => { const g = nodesOfType(p.view.state.doc, 'grid')[0].n; const w = []; g.forEach((r) => w.push(r.childCount)); return w; };
const ragged = (p) => { let bad = 0; for (const { n } of nodesOfType(p.view.state.doc, 'grid')) { const w = n.firstChild.childCount; n.forEach((row) => { if (row.childCount !== w) bad++; }); } return bad; };
const inCell = (p, txt) => p.view.dispatch(p.view.state.tr.setSelection(PM.TextSelection.create(p.view.state.doc, pt(p, txt) + 1)));
const run = (p, cmd) => assert.ok(cmd(p.view.state, p.view.dispatch.bind(p.view)), 'the grid command did not apply');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const valid = (...ps) => ps.every((p) => { try { p.view.state.doc.check(); return true; } catch { return false; } });

// ---- 1 and 2. scenarios -----------------------------------------------------------------------------------------------------------
await test('typing in one paragraph, same spot and other spots: every character is kept', () => {
  const { net, ps: [A, B] } = fresh();
  typeChars(A, pt(A, 'Alpha') + 5, ' AAAA'); typeChars(B, pt(B, 'Alpha') + 5, ' BBBB'); typeChars(B, pt(B, 'one.'), 'xx'); typeChars(A, pt(A, 'Alpha'), 'Z');
  net.quiesce({ shuffle: true });
  assert.ok(net.converged()); assert.ok(valid(A, B));
  const para = nodesOfType(A.view.state.doc, 'paragraph').find((x) => x.n.textContent.includes('Alpha')).n.textContent;
  for (const w of ['AAAA', 'BBBB', 'xx', 'Z']) assert.ok(para.includes(w), `${w} lost: ${para}`);
  assert.equal(para.replace(/[AB]{4}|xx|Z|\s/g, ''), 'Alphaparagraphone.');
  net.destroy();
});
await test('typing in two paragraphs: the blocks nobody touched are written back word for word', () => {
  const { net, rd, ps: [A, B] } = fresh();
  typeChars(A, pt(A, 'Gamma') + 5, ' AA'); typeChars(B, pt(B, 'Delta') + 5, ' BB'); net.quiesce({ shuffle: true });
  assert.ok(net.converged());
  const a = save(A, rd), b = save(B, rd);
  assert.equal(a.text, b.text, 'two peers write different text');
  assert.equal(a.whole, false); assert.equal(a.storedBlocks, 16); assert.ok(a.changedOrGone <= 2, `${a.changedOrGone} of ${a.storedBlocks} blocks changed (the two edited blocks only)`);
  facts.push(`2 peers, 2 blocks edited: ${a.kept} of ${a.storedBlocks} blocks word for word`);
  net.destroy();
});
await test('typing in one grid cell: all three edits are kept', () => {
  const { net, ps: [A, B] } = fresh();
  typeChars(A, pt(A, 'b2') + 2, ' from-A'); typeChars(B, pt(B, 'b2') + 2, ' from-B'); typeChars(B, pt(B, 'b2'), '<<'); net.quiesce({ shuffle: true });
  assert.ok(net.converged()); assert.ok(valid(A, B));
  const cell = nodesOfType(A.view.state.doc, 'grid_cell').find((x) => x.n.textContent.includes('b2')).n.textContent;
  for (const w of ['from-A', 'from-B', '<<']) assert.ok(cell.includes(w), `${w} lost: ${cell}`);
  net.destroy();
});
await test('one deletes a block while the other types in it: converges; the typed text is gone (known limit)', () => {
  const { net, ps: [A, B] } = fresh();
  const g = nodesOfType(A.view.state.doc, 'paragraph').find((x) => x.n.textContent.startsWith('Gamma'));
  A.view.dispatch(A.view.state.tr.delete(g.pos, g.pos + g.n.nodeSize)); typeChars(B, pt(B, 'Gamma') + 5, ' TYPED-BY-B'); net.quiesce({ shuffle: true });
  assert.ok(net.converged()); assert.ok(valid(A, B)); assert.ok(!textOf(A).includes('Gamma')); assert.ok(!textOf(A).includes('TYPED-BY-B'), 'the limit changed: typed text now survives a delete');
  net.destroy();
});
await test('grid: both add a row at one spot keeps both rows and stays rectangular', () => {
  const { net, ps: [A, B] } = fresh(); inCell(A, 'a1'); inCell(B, 'a1'); run(A, PM.addRowAfter); run(B, PM.addRowAfter); net.quiesce({ shuffle: true });
  assert.ok(net.converged()); assert.equal(nodesOfType(A.view.state.doc, 'grid')[0].n.childCount, 6); assert.equal(ragged(A), 0); assert.ok(valid(A, B));
  net.destroy();
});
await test('grid: a row added while a column is added converges; the grid is not rectangular until the writer\'s page repairs it (known); the repair makes it so', () => {
  const { net, ps: [A, B] } = fresh(); inCell(A, 'a1'); run(A, PM.addRowAfter); inCell(B, 'b3'); run(B, PM.addColumnAfter); net.quiesce({ shuffle: true });
  assert.ok(net.converged()); assert.ok(valid(A, B));
  facts.push(`row against column: widths ${widths(A).join(',')} (${ragged(A)} short rows)`);
  assert.ok(ragged(A) > 0, 'the grid is now rectangular by itself: the writer\'s repair may not be needed, read the plan again');
  assert.ok(L.dlCoeditGate(PM).repairGrids(A.ydoc) > 0); net.quiesce({ shuffle: true });
  assert.ok(net.converged()); assert.equal(ragged(A), 0); assert.equal(ragged(B), 0); assert.ok(valid(A, B));
  net.destroy();
});
await test('grid: delete a row or a column while the other types in it: converges, valid, rectangular', () => {
  { const { net, ps: [A, B] } = fresh(); inCell(A, 'b1'); run(A, PM.deleteRow); typeChars(B, pt(B, 'b2') + 2, ' B-TYPED'); net.quiesce({ shuffle: true });
    assert.ok(net.converged()); assert.ok(valid(A, B)); assert.equal(nodesOfType(A.view.state.doc, 'grid')[0].n.childCount, 3); assert.equal(ragged(A), 0); net.destroy(); }
  { const { net, ps: [A, B] } = fresh(); inCell(A, 'a2'); run(A, PM.deleteColumn); typeChars(B, pt(B, 'c2') + 2, ' B-TYPED'); net.quiesce({ shuffle: true });
    assert.ok(net.converged()); assert.ok(valid(A, B)); assert.deepEqual(widths(A), [2, 2, 2, 2]); assert.equal(ragged(A), 0); net.destroy(); }
});
await test('grid: both delete the same column: it goes once', () => {
  const { net, ps: [A, B] } = fresh(); inCell(A, 'a2'); run(A, PM.deleteColumn); inCell(B, 'a2'); run(B, PM.deleteColumn); net.quiesce({ shuffle: true });
  assert.ok(net.converged()); assert.deepEqual(widths(A), [2, 2, 2, 2]); assert.equal(ragged(A), 0); net.destroy();
});

// ---- 3. fuzz ----------------------------------------------------------------------------------------------------------------------
const texts = [...CASES.map((c) => c[1]), ...fuzzDocs(schema, FUZZ, false).map((d) => L.dlRichSerialise(PM, d)), ...fuzzDocs(schema, FUZZ, true).map((d) => L.dlRichSerialise(PM, d)), ...sourceDocs(FUZZ)]
  .filter((t) => t.length > 20 && !/[\ud800-\udfff]/.test(t)); // a character outside the Basic Plane is an offset-in-UTF-16 corner of the spike's generator, counted in the report
await test(`fuzz: ${texts.length} documents, 3 peers, random type/insert/delete, shuffled and duplicated updates: converge, valid, untouched blocks exact`, () => {
  const R = rng(4242); let docs = 0, exact = 0;
  for (const md of texts) {
    const rd = L.dlRichRead(PM, md, lex); if (!rd.stored.entries) continue; docs++;
    const net = new Net(ctx, docs); const ps = [net.peer('A', { seed: rd.doc }), net.peer('B'), net.peer('C')]; net.sync(); net.deliver();
    for (const p of ps) for (let k = 0; k < 3; k++) {
      const doc = p.view.state.doc; const tb = []; doc.descendants((n, pos) => { if (n.isTextblock && n.type.name !== 'code_block' && n.type.name !== 'source_block') tb.push(pos); });
      const top = []; doc.forEach((n, off) => top.push({ n, off })); const r = R();
      try {
        if (r < 0.6 && tb.length) { const pos = tb[Math.floor(R() * tb.length)]; const n = doc.nodeAt(pos); p.view.dispatch(p.view.state.tr.insertText(p.name + p.name, pos + 1 + Math.floor(R() * (n.content.size + 1)))); }
        else if (r < 0.8) { const t = top[Math.floor(R() * top.length)]; p.view.dispatch(p.view.state.tr.insert(t.off, schema.nodes.paragraph.create(null, schema.text('new-' + p.name)))); }
        else if (top.length > 2) { const t = top[Math.floor(R() * top.length)]; p.view.dispatch(p.view.state.tr.delete(t.off, t.off + t.n.nodeSize)); }
      } catch { /* an edit that does not fit this document */ }
      if (R() < 0.5) net.deliver({ shuffle: true, dup: 0.2 });
    }
    net.quiesce({ shuffle: true, dup: 0.2 }); net.sync(); net.quiesce();
    assert.equal(ps.reduce((n, p) => n + p.exc, 0), 0, `an update threw: ${ps.map((p) => p.lastExc).join('')} :: ${md.slice(0, 60)}`);
    assert.ok(net.converged(), `diverged: ${md.slice(0, 80).replace(/\n/g, '/')}`); assert.ok(valid(...ps), 'invalid document');
    // the stored blocks still in the final document are written back word for word
    const pool = []; ps[0].view.state.doc.forEach((n) => pool.push(n)); let expect = 0;
    for (const e of rd.stored.entries) { const i = pool.findIndex((n) => n.eq(e.node)); if (i >= 0) { pool.splice(i, 1); expect++; } }
    const s = save(ps[0], rd); assert.ok(s.kept >= expect, `kept ${s.kept} < ${expect} untouched blocks: ${md.slice(0, 60).replace(/\n/g, '/')}`); exact++;
    net.destroy();
  }
  facts.push(`fuzz: ${docs} documents converged, valid, untouched blocks exact`);
});
await test('loss: dropped and duplicated updates leave pending structs; one state-vector exchange repairs all peers', () => {
  const { net, ps } = fresh(4);
  for (let r = 0; r < 6; r++) for (const p of ps) { typeChars(p, pt(p, 'Last paragraph.') + 4 + (r % 5), p.name); net.deliver({ shuffle: true, drop: 0.25, dup: 0.1 }); }
  net.quiesce({ shuffle: true, drop: 0.25 });
  net.sync(); net.quiesce();
  assert.ok(net.converged(), 'one exchange of what each peer is missing did not converge'); assert.ok(valid(...ps));
  assert.ok(ps.every((p) => !p.ydoc.store.pendingStructs && !p.ydoc.store.pendingDs), 'a peer is still holding pending structs');
  net.destroy();
});

// ---- 4. hostile updates -------------------------------------------------------------------------------------------------------------
const el = (name, attrs = {}, kids = []) => { const e = new PM.XmlElement(name); for (const k in attrs) e.setAttribute(k, attrs[k]); if (kids.length) e.insert(0, kids); return e; };
const tx = (text, fmt) => { const t = new PM.XmlText(); t.insert(0, text, fmt); return t; };
const find = (frag, name) => { let hit = null; const walk = (n) => { if (hit) return; if (n.nodeName === name) { hit = n; return; } if (n.toArray) n.toArray().forEach(walk); }; walk(frag); return hit; };
const HOSTILE_MD = 'Alpha one.\n\n| h1 | h2 |\n| --- | --- |\n| a1 | a2 |\n\n```js\ncode\n```\n\nChip [m](object:maps:place:abc123).\n';
// What a peer that is not our editor can send: a mutation of a copy of the victim's document, as an update.
function attack(mut) {
  const rd = L.dlRichRead(PM, HOSTILE_MD, lex); const net = new Net(ctx);
  const V = net.peer('V', { seed: rd.doc }); net.sync(); net.deliver(); V.out.length = 0;
  const rogue = new PM.Doc(); PM.applyUpdate(rogue, PM.encodeStateAsUpdate(V.ydoc));
  const sv = PM.encodeStateVector(V.ydoc); mut(rogue.getXmlFragment('prosemirror'));
  const u = PM.encodeStateAsUpdate(rogue, sv); net.apply(V, u);
  const out = { threw: V.exc ? V.lastExc : null, valid: valid(V), json: JSON.stringify(V.view.state.doc.toJSON()), blocks: V.view.state.doc.childCount };
  net.destroy(); return out;
}
const cleaned = [
  ['an unknown node name (script)', (f) => f.insert(1, [el('script', {}, [tx('HOSTILE')])])],
  ['a paragraph inside a paragraph', (f) => f.insert(1, [el('paragraph', {}, [el('paragraph', {}, [tx('HOSTILE')])])])],
  ['a grid cell directly in the document', (f) => f.insert(1, [el('grid_cell', { colspan: 1, rowspan: 1 }, [tx('HOSTILE')])])],
  ['heading level 99', (f) => f.insert(1, [el('heading', { level: 99 }, [tx('HOSTILE')])])],
  ['a chip with a spaced, tagged id', (f) => f.insert(1, [el('paragraph', {}, [el('object', { module: 'maps', kind: 'place', id: 'a b <img>', label: 'HOSTILE', title: '' })])])],
  ['a list row checked "yes"', (f) => f.insert(1, [el('bullet_list', {}, [el('list_item', { checked: 'yes' }, [el('paragraph', {}, [tx('HOSTILE')])])])])],
  ['a link mark to javascript:', (f) => f.insert(1, [el('paragraph', {}, [tx('HOSTILE', { link: { href: 'javascript:alert(1)', title: '' } })])])],
  ['an unknown mark (blink)', (f) => f.insert(1, [el('paragraph', {}, [tx('HOSTILE', { blink: {} })])])],
  ['a grid cell with colspan 2', (f) => { const c = find(f, 'grid_cell'); c.setAttribute('colspan', 2); c.toArray()[0].insert(0, 'HOSTILE'); }],
  ['a grid row holding only a paragraph', (f) => find(f, 'grid_row').insert(0, [el('paragraph', {}, [tx('HOSTILE')])])],
  ['an empty grid', (f) => f.insert(1, [el('grid', {}, [])])],
  ['a formula with a blank line', (f) => f.insert(1, [el('formula_block', { tex: 'a\n\nb' })])],
];
for (const [name, mut] of cleaned) {
  await test(`hostile update, ${name}: no throw, the document stays valid, nothing hostile shows`, () => {
    const o = attack(mut);
    assert.equal(o.threw, null); assert.ok(o.valid, 'invalid document');
    assert.ok(!/javascript:|"script"|"blink"|<img>/.test(o.json), 'the hostile value is in the document');
  });
}
await test('hostile update, a 5 MB text in one paragraph: a valid update is applied, quickly (size is a gate\'s job, step 3)', () => {
  const t = Date.now(); const o = attack((f) => f.insert(1, [el('paragraph', {}, [tx('HOSTILE' + 'x'.repeat(5 * 1024 * 1024))])]));
  assert.equal(o.threw, null); assert.ok(o.valid); assert.ok(Date.now() - t < 5000, 'took ' + (Date.now() - t) + ' ms');
});
await test('hostile update, text directly in the document (a top-level XmlText): the library alone throws out of applyUpdate; the gate (check-documents-coedit-gate.mjs) refuses it before', () => {
  const o = attack((f) => f.insert(1, [tx('HOSTILE')]));
  assert.ok(o.threw !== null, 'the gap is closed in the library: the gate\'s special case (top_level_text) is then a second guard only');
  facts.push(`top-level XmlText: applyUpdate throws (${String(o.threw).slice(0, 40)}) without the gate`);
});

// ---- 5. undo ----------------------------------------------------------------------------------------------------------------------
await test('undo: yUndo takes back only my own edits; redo puts them back', async () => {
  const net = new Net(ctx); const rd = L.dlRichRead(PM, 'Alpha one.\n\nBeta two.\n\nGamma three.\n', lex);
  const A = net.peer('A', { seed: rd.doc }), B = net.peer('B'); net.sync(); net.deliver(); await wait(20);
  typeChars(B, pt(B, 'Beta') + 4, ' BEE'); net.quiesce();
  typeChars(A, pt(A, 'Alpha') + 5, ' AYE'); await wait(600); typeChars(A, pt(A, 'Gamma') + 5, ' AGAIN'); net.quiesce();
  assert.ok(PM.yUndo(A.view.state) !== undefined); net.quiesce();
  assert.ok(!textOf(A).includes('AGAIN') && textOf(A).includes('AYE') && textOf(A).includes('BEE'), textOf(A));
  assert.ok(net.converged());
  PM.yUndo(A.view.state); net.quiesce(); assert.ok(!textOf(A).includes('AYE') && textOf(A).includes('BEE'), textOf(A));
  PM.yUndo(A.view.state); net.quiesce(); assert.ok(textOf(A).includes('BEE'), "A's undo took B's text away");
  PM.yRedo(A.view.state); net.quiesce(); assert.ok(textOf(A).includes('AYE') && textOf(B).includes('AYE') && net.converged());
  net.destroy();
});
await test('undo: typing 100 ms apart is one undo step, 700 ms apart are separate steps', async () => {
  const net = new Net(ctx); const rd = L.dlRichRead(PM, 'Alpha one.\n\nGamma three.\n', lex);
  const A = net.peer('A', { seed: rd.doc }); await wait(20);
  const gp = pt(A, 'Gamma'); const len = () => textOf(A).length;
  for (let i = 0; i < 5; i++) { A.view.dispatch(A.view.state.tr.insertText('k', gp + 5 + i)); await wait(100); }
  let before = len(); PM.yUndo(A.view.state); assert.equal(before - len(), 5, 'five fast keys are one step');
  await wait(600);
  for (let i = 0; i < 3; i++) { A.view.dispatch(A.view.state.tr.insertText('m', gp + 5 + i)); await wait(700); }
  before = len(); PM.yUndo(A.view.state); assert.equal(before - len(), 1, 'slow keys are one step each');
  net.destroy();
});
await test('undo: restoring a block the person deleted reaches the other peer', async () => {
  const net = new Net(ctx); const rd = L.dlRichRead(PM, 'Alpha one.\n\nBeta two.\n\nGamma three.\n', lex);
  const A = net.peer('A', { seed: rd.doc }), B = net.peer('B'); net.sync(); net.deliver(); await wait(600);
  const g = nodesOfType(A.view.state.doc, 'paragraph').find((x) => x.n.textContent.startsWith('Beta'));
  A.view.dispatch(A.view.state.tr.delete(g.pos, g.pos + g.n.nodeSize)); net.quiesce(); assert.ok(!textOf(B).includes('Beta'));
  PM.yUndo(A.view.state); net.quiesce(); assert.ok(textOf(B).includes('Beta two.') && net.converged());
  net.destroy();
});

const secs = ((Date.now() - t0) / 1000).toFixed(1);
if (fails.length) { console.error(`documents yjs merge: ${fails.length} failed, ${passed} passed`); for (const f of fails) console.error(`  - ${f}`); process.exit(1); }
console.log(`documents yjs merge: ${passed} tests passed in ${secs} s (${facts.join('; ')})`);
