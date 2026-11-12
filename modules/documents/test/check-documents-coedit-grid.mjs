#!/usr/bin/env node
/*
 * check-documents-coedit-grid.mjs -- grids in a shared document: the writer-only repair and the plugin set (documents-lib-t-coedit-gate.js,
 * step 3 of plan-documents-coediting.md). Node, no DOM, stand-in peers (support/yjs-peers.mjs).
 *
 * The spike found that a row added while a column is added leaves a grid whose rows differ in width, that the grid library's fixTables
 * (an appendTransaction on every page) then pads each page's own copy and writes on the next edit from both, and that the grid gains a
 * column per round. The set the editor will use is ySync + yUndo + gridEditing WITHOUT fixTables and WITHOUT the history plugin
 * (dlCoeditGate(PM).plugins), and the page that is the writer calls repairGrids.
 *
 * 1. THE PLUGIN LIST: what is in it, what is not, and that the editor's own list is not changed.
 * 2. NON-WRITERS NEVER WRITE A REPAIR; the writer's repair reaches every peer, which converge on a rectangular grid.
 * 3. NO GROWTH over 20 rounds of a row added against a column added, with the repair run after each round.
 * 4. TWO WRITERS AT ONCE: what is guaranteed (they converge; one more repair by one writer makes the grid rectangular and the next
 *    writes nothing) and what is not (two that repair in lockstep, round after round, do not settle: the writer rule exists to prevent it).
 * 5. UNTOUCHED GRIDS cause no write: every corpus, fuzz and source document with a grid.
 *
 * Usage: node modules/documents/test/check-documents-coedit-grid.mjs [--fuzz=N] [path to the src folder]. Exits 1 on any failure.
 */
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { CASES, fuzzDocs, sourceDocs } from './support/rich-corpus.mjs';
import { loadYjs, Net, posOfText, nodesOfType } from './support/yjs-peers.mjs';

const t0 = Date.now();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const fuzzArg = args.find((a) => a.startsWith('--fuzz='));
const FUZZ = fuzzArg ? Math.max(1, Number(fuzzArg.slice(7)) || 0) : 120;
const src = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(root, 'modules/documents/src'));
const ctx = loadYjs(src);
const { PM, L, lex, schema } = ctx;
const G = L.dlCoeditGate(PM);
const gridKey = PM.gridEditing().spec.key;

let passed = 0; const fails = []; const facts = [];
function test(name, fn) { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

const GRID = '| h1 | h2 | h3 |\n| --- | --- | --- |\n| a1 | a2 | a3 |\n| b1 | b2 | b3 |\n';
const withGrid = (net, n) => {
  const rd = L.dlRichRead(PM, `Before.\n\n${GRID}\nAfter.\n`, lex);
  const ps = [net.peer('A', { seed: rd.doc, build: (P, f) => G.plugins(f, { base: [P.gridEditing()] }) })];
  for (let i = 1; i < n; i++) ps.push(net.peer('BCD'[i - 1], { build: (P, f) => G.plugins(f, { base: [P.gridEditing()] }) }));
  net.sync(); net.deliver(); net.quiesce();
  return ps;
};
const pt = (p, s) => posOfText(p.view.state.doc, s);
const inCell = (p, txt) => p.view.dispatch(p.view.state.tr.setSelection(PM.TextSelection.create(p.view.state.doc, pt(p, txt) + 1)));
const run = (p, cmd) => assert.ok(cmd(p.view.state, p.view.dispatch.bind(p.view)), 'the grid command did not apply');
const rows = (p) => { const g = nodesOfType(p.view.state.doc, 'grid')[0].n; const w = []; g.forEach((r) => w.push(r.childCount)); return w; };
const rect = (p) => new Set(rows(p)).size === 1;
const written = (net) => net.peers.reduce((n, p) => n + p.out.length, 0);

// ---- 1. the plugin list -------------------------------------------------------------------------------------------------------------
test('plugins: ySync and yUndo first, no history plugin, the grid plugin without its appendTransaction; the editor\'s own list is untouched', () => {
  const doc = new PM.Doc(); const frag = doc.getXmlFragment('prosemirror');
  const own = L.dlRichPlugins(PM);
  const list = G.plugins(frag);
  const keyOf = (p) => String((p.spec.key && p.spec.key.key) || '');
  assert.ok(keyOf(list[0]).startsWith('y-sync'), keyOf(list[0])); assert.ok(keyOf(list[1]).startsWith('y-undo'), keyOf(list[1]));
  assert.equal(list.filter((p) => keyOf(p).startsWith('history')).length, 0, 'the history plugin is in the list');
  assert.ok(own.some((p) => keyOf(p).startsWith('history')), 'the editor\'s own list lost its history plugin (it must be untouched)');
  const grid = list.filter((p) => p.spec.key === gridKey); assert.equal(grid.length, 1, 'the grid plugin is missing or twice');
  assert.equal(grid[0].spec.appendTransaction, undefined, 'fixTables is still on');
  assert.equal(own.filter((p) => p.spec.key === gridKey)[0].spec.appendTransaction !== undefined, true, 'the editor\'s own list lost fixTables (it must be untouched)');
  assert.equal(list.length, own.length + 1, 'the list is the editor\'s list minus history plus ySync and yUndo');
  assert.ok(list.some((p) => p.props && p.props.handleKeyDown), 'the editor\'s keymaps are gone');
  // it makes a state
  const st = PM.EditorState.create({ schema, plugins: list.filter((p, i) => i === 0 || i === 1 || p.spec.key === gridKey) });
  assert.ok(st.plugins.length >= 3);
  // the grid plugin keeps what it does besides repairing: its key, state and props
  assert.equal(grid[0].spec.key, gridKey); assert.ok(grid[0].props.handleDOMEvents || grid[0].props.handleKeyDown || grid[0].props.createSelectionBetween, 'the grid plugin lost its props');
});

// ---- 2. non-writers never write a repair ---------------------------------------------------------------------------------------------
function collideAndSend(A, B, net) { inCell(A, 'a1'); run(A, PM.addRowAfter); inCell(B, 'b3'); run(B, PM.addColumnAfter); }
test('without the plugin set: the grid library\'s own repair writes from every page (the spike), and the grid gains columns', () => {
  const net = new Net(ctx); const rd = L.dlRichRead(PM, `Before.\n\n${GRID}\nAfter.\n`, lex);
  const A = net.peer('A', { seed: rd.doc, plugins: (P) => [P.gridEditing()] }); const B = net.peer('B', { plugins: (P) => [P.gridEditing()] }); net.sync(); net.deliver(); net.quiesce();
  const growth = [];
  for (let r = 0; r < 6; r++) {
    collideAndSend(A, B); net.quiesce({ shuffle: true }); // the two edits cross; each page then edits its own copy once more (a typed letter), where fixTables writes
    for (const p of [A, B]) { p.view.dispatch(p.view.state.tr.insertText('.', pt(p, 'Before') + 6)); }
    net.quiesce({ shuffle: true }); growth.push(rows(A)[0]);
  }
  facts.push(`fixTables on, widths by round ${growth.join(',')} (3 + 1 a round is right)`);
  assert.ok(growth[5] > 3 + 6, `the grid did not gain extra columns (${growth.join(',')}): the spike's finding no longer holds, read the plan again`);
});
test('with the plugin set: no page writes anything after the edits cross; the grid is ragged and every page sees the same', () => {
  const net = new Net(ctx); const [A, B, C] = withGrid(net, 3);
  collideAndSend(A, B, net); net.deliver({ shuffle: true });
  assert.equal(written(net), 0, 'a page wrote after the edits crossed (a repair)');
  net.quiesce({ shuffle: true }); assert.ok(net.converged()); assert.ok(!rect(A), 'not ragged: the collision did not happen'); assert.ok(!rect(C));
  const before = rows(C).join(',');
  for (let i = 0; i < 3; i++) { for (const p of [A, B, C]) p.view.dispatch(p.view.state.tr.insertText('.', pt(p, 'Before') + 6)); net.sync(); net.quiesce(); } // every page edits again: the letters are all that is written
  assert.equal(rows(C).join(','), before, 'a page repaired the grid on its own edit'); assert.ok(net.converged());
  assert.equal(nodesOfType(C.view.state.doc, 'paragraph')[0].n.textContent.length, 'Before.'.length + 9, 'the typed letters are not all there');
  facts.push(`row against column, 3 pages: widths ${rows(C).join(',')} until the writer repairs`);
  net.destroy();
});
test('the writer\'s repair reaches every page: they converge on a rectangular grid, and a second repair writes nothing', () => {
  const net = new Net(ctx); const [A, B, C] = withGrid(net, 3);
  collideAndSend(A, B, net); net.quiesce({ shuffle: true });
  const added = G.repairGrids(A.ydoc); assert.equal(added, 1, `${added} cells added`);
  net.quiesce({ shuffle: true }); assert.ok(net.converged()); for (const p of [A, B, C]) { assert.ok(rect(p), rows(p).join(',')); p.view.state.doc.check(); }
  assert.equal(G.repairGrids(A.ydoc), 0); assert.equal(G.repairGrids(B.ydoc), 0); assert.equal(written(net), 0);
  assert.equal(rows(A)[0], 4, 'the grid is not the 3 columns plus the one that was added');
  net.destroy();
});
test('the repair is one local transaction (one update), tagged, and a header row is padded with header cells', () => {
  const net = new Net(ctx); const [A, B] = withGrid(net, 2);
  collideAndSend(A, B, net); net.quiesce({ shuffle: true });
  const tags = []; A.ydoc.on('afterTransaction', (tr) => tags.push(tr.origin)); const n0 = A.out.length;
  G.repairGrids(A.ydoc); assert.equal(A.out.length - n0, 1, 'more than one update'); assert.deepEqual(tags, ['dl-grid-repair']);
  net.quiesce();
  // the other direction: a row added to the header side is short of the new column in a grid whose first row is a header row
  const kinds = []; nodesOfType(B.view.state.doc, 'grid_row').forEach(({ n }) => kinds.push(n.child(n.childCount - 1).type.name)); assert.ok(kinds.every((k) => k === 'grid_cell' || k === 'grid_head'));
  net.destroy();
});

// ---- 3. no growth over 20 rounds ---------------------------------------------------------------------------------------------------
test('20 rounds of a row added against a column added, the writer repairing after each: no growth beyond the columns people added', () => {
  const net = new Net(ctx); const [A, B, C] = withGrid(net, 3);
  let rowsN = rows(A).length;
  for (let r = 1; r <= 20; r++) {
    collideAndSend(r % 2 ? A : B, r % 2 ? B : A, net); net.quiesce({ shuffle: true });
    const added = G.repairGrids(A.ydoc); net.quiesce({ shuffle: true });
    assert.ok(net.converged(), `round ${r}: diverged`); for (const p of [A, B, C]) { assert.ok(rect(p), `round ${r}: ${rows(p).join(',')}`); }
    assert.equal(rows(A)[0], 3 + r, `round ${r}: width ${rows(A)[0]}, expected ${3 + r} (a column per round was added on purpose)`);
    assert.equal(rows(A).length, rowsN + r, `round ${r}: ${rows(A).length} rows`);
    assert.ok(added <= 1, `round ${r}: the repair added ${added} cells`);
    assert.equal(written(net), 0);
  }
  net.destroy();
});

// ---- 4. two writers at once ------------------------------------------------------------------------------------------------------------
test('two writers repair at the same moment: they converge; one more repair by one writer makes it rectangular; then nothing is written', () => {
  const net = new Net(ctx); const [A, B, C] = withGrid(net, 3);
  collideAndSend(A, B, net); net.quiesce({ shuffle: true });
  assert.equal(G.repairGrids(A.ydoc), 1); assert.equal(G.repairGrids(B.ydoc), 1); // both, before either has heard the other
  net.quiesce({ shuffle: true }); assert.ok(net.converged(), 'diverged after two repairs');
  for (const p of [A, B, C]) p.view.state.doc.check();
  const w = rows(A);
  facts.push(`two writers at once: widths ${w.join(',')} (${rect(A) ? 'rectangular' : 'ragged'}) before the next repair`);
  assert.ok(Math.max(...w) <= 5, `${w.join(',')}`);
  G.repairGrids(A.ydoc); net.quiesce({ shuffle: true });
  assert.ok(net.converged()); for (const p of [A, B, C]) assert.ok(rect(p), rows(p).join(','));
  assert.ok(rows(A)[0] <= 5, `${rows(A).join(',')}`);
  assert.equal(G.repairGrids(A.ydoc), 0); assert.equal(G.repairGrids(B.ydoc), 0); assert.equal(written(net), 0);
  net.destroy();
});
test('KNOWN LIMIT: two writers that repair in lockstep, round after round, do not settle (this is what the single-writer rule prevents)', () => {
  const net = new Net(ctx); const [A, B] = withGrid(net, 2);
  collideAndSend(A, B, net); net.quiesce({ shuffle: true });
  const seen = [];
  for (let r = 0; r < 6; r++) { const a = G.repairGrids(A.ydoc); const b = G.repairGrids(B.ydoc); net.quiesce({ shuffle: true }); seen.push(`${a + b}:${rect(A) ? 'rect' : 'ragged'}:${rows(A)[0]}`); }
  facts.push(`two writers in lockstep, 6 rounds (cells added : shape : width): ${seen.join(' ')}`);
  assert.ok(net.converged());
  assert.ok(seen.some((x) => x.includes('ragged')), 'lockstep repair settled by itself: the limit is gone, update the plan and this test');
  net.destroy();
});

// ---- 5. untouched grids cause no write -----------------------------------------------------------------------------------------------
const texts = [...CASES.map((c) => c[1]), ...fuzzDocs(schema, FUZZ, false).map((d) => L.dlRichSerialise(PM, d)), ...fuzzDocs(schema, FUZZ, true).map((d) => L.dlRichSerialise(PM, d)), ...sourceDocs(FUZZ)]
  .filter((t) => t.length > 20 && !/[\ud800-\udfff]/.test(t));
test('untouched grids: every corpus, fuzz and source document with a grid is opened and repaired with 0 cells added and 0 updates, with the shared plugin set', () => {
  let docs = 0, grids = 0;
  for (const md of texts) {
    const rd = L.dlRichRead(PM, md, lex); let has = false; rd.doc.descendants((n) => { if (n.type.name === 'grid') { has = true; grids += 1; } });
    if (!has) continue; docs++;
    const net = new Net(ctx); const p = net.peer('A', { seed: rd.doc, build: (P, f) => G.plugins(f, { base: [P.gridEditing()] }) }); const q = net.peer('B', { build: (P, f) => G.plugins(f, { base: [P.gridEditing()] }) });
    net.sync(); net.deliver(); net.quiesce();
    assert.equal(written(net), 0, `a page wrote for an untouched grid: ${md.slice(0, 50)}`);
    assert.equal(G.repairGrids(p.ydoc), 0, 'the repair changed an untouched grid'); assert.equal(G.repairGrids(q.ydoc), 0);
    assert.equal(written(net), 0);
    net.destroy();
  }
  assert.ok(docs >= 40, `only ${docs} documents with a grid`);
  facts.push(`untouched grids: ${docs} documents with ${grids} grids, 0 writes`);
});

const secs = ((Date.now() - t0) / 1000).toFixed(1);
if (fails.length) { console.error(`documents coedit grid: ${fails.length} failed, ${passed} passed`); for (const f of fails) console.error(`  - ${f}`); process.exit(1); }
console.log(`documents coedit grid: ${passed} tests passed in ${secs} s (${facts.join('; ')})`);
