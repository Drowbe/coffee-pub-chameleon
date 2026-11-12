#!/usr/bin/env node
/*
 * check-documents-coedit-gate.mjs -- the remote-update gate and the recovery of a shared document (documents-lib-t-coedit-gate.js), in
 * Node with no DOM. Plan: plan-documents-coediting.md, step 3. The stand-in view and network are support/yjs-peers.mjs.
 *
 * 1. THE HOSTILE-UPDATE CORPUS. ONE LIST of named cases (HOSTILE below); to add a case, add a line. Every case is built as the update a
 *    peer that is not our editor could send, then sent through BOTH checks: the reference (gateUpdate: a scratch copy, the whole result
 *    walked) and the live one (guard.receive: a shadow, only what the update touched). Each must give the same answer, and a refused
 *    update must: not be applied, leave the live document byte for byte as it was, give a reason, and take less than its time bound.
 *    A case marked `lib: 'clean'` is one y-prosemirror already handles (it removes the bad part itself); it is also sent to a stand-in view
 *    with NO gate and must leave a valid document with nothing hostile in it, so a library upgrade cannot regress that layer unseen.
 * 2. HONEST TRAFFIC. The gate refuses nothing honest peers send: the corpus, fuzz and the grid collisions go through guards in order
 *    (0 refusals) and shuffled and duplicated (only `pending` refusals, repaired by one state-vector exchange); all peers converge.
 * 3. RECOVERY. A poisoned live document is rebuilt from the last good snapshot and equals it; a bad snapshot is not trusted; the writer's
 *    check before a snapshot (verifyBeforeSnapshot) passes a good state and keeps the previous snapshot when the state is not fit.
 * 4. COST on a 150,000-character document (printed; the live check must stay within the budget of about 1 ms per update).
 *
 * Usage: node modules/documents/test/check-documents-coedit-gate.mjs [--fuzz=N] [path to the src folder]. Exits 1 on any failure.
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
const FUZZ = fuzzArg ? Math.max(1, Number(fuzzArg.slice(7)) || 0) : 40;
const src = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(root, 'modules/documents/src'));
const ctx = loadYjs(src);
const { PM, L, lex, schema } = ctx;
const G = L.dlCoeditGate(PM);

let passed = 0; const fails = []; const facts = [];
async function test(name, fn) { try { await fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }
const same = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const state = (d) => PM.encodeStateAsUpdate(d);

// ---- the victim's document and the rogue copy ---------------------------------------------------------------------------------------
const VICTIM_MD = 'Alpha one.\n\n| h1 | h2 |\n| --- | --- |\n| a1 | a2 |\n| b1 | b2 |\n\n```js\ncode\n```\n\n- [ ] task\n\nChip [m](object:maps:place:abc123).\n\nOmega.\n';
const FRAG = 'prosemirror';
// One fixed state (every copy shares its ids, so an update made on one copy fits every other copy).
const VICTIM_STATE = (() => { const doc = new PM.Doc(); PM.prosemirrorToYXmlFragment(L.dlRichRead(PM, VICTIM_MD, lex).doc, doc.getXmlFragment(FRAG)); return state(doc); })();
function victim() { const doc = new PM.Doc(); PM.applyUpdate(doc, VICTIM_STATE); return doc; }
const textOfDoc = (d) => { let s = ''; const walk = (n) => { if (n.toDelta) { for (const x of n.toDelta()) s += x.insert; } else if (n.toArray) n.toArray().forEach(walk); }; walk(d.getXmlFragment(FRAG)); return s; };
const el = (name, attrs = {}, kids = []) => { const e = new PM.XmlElement(name); for (const k in attrs) e.setAttribute(k, attrs[k]); if (kids.length) e.insert(0, kids); return e; };
const tx = (text, fmt) => { const t = new PM.XmlText(); t.insert(0, text, fmt); return t; };
const find = (frag, name) => { let hit = null; const walk = (n) => { if (hit) return; if (n.nodeName === name) { hit = n; return; } if (n.toArray) n.toArray().forEach(walk); }; walk(frag); return hit; };
// The update a rogue peer makes by changing a copy of the victim's document.
function rogue(mut, base = victim()) {
  const rg = new PM.Doc(); PM.applyUpdate(rg, state(base));
  const sv = PM.encodeStateVector(base);
  mut(rg.getXmlFragment(FRAG), rg);
  return PM.encodeStateAsUpdate(rg, sv);
}
const nest = (kind, depth) => (f) => { let parent = el(kind); f.insert(1, [parent]); for (let i = 1; i < depth; i++) { const c = el(kind); parent.insert(0, [c]); parent = c; } const p = el('paragraph'); parent.insert(0, [p]); const t = new PM.XmlText(); p.insert(0, [t]); t.insert(0, 'DEEP'); };

// ---- 1. the corpus: ONE LIST -----------------------------------------------------------------------------------------------------------
// name; build: (base doc) -> update bytes; expect: the reason it is refused, or 'applied'; limits: overrides; ms: the time bound (default 1000);
// lib: 'clean' (y-prosemirror alone leaves a valid, clean document), 'throws' (y-prosemirror alone throws out of applyUpdate), or absent.
const HOSTILE = [
  // what throws or exhausts
  { name: 'a top-level XmlText (39 bytes)', build: () => rogue((f) => f.insert(1, [tx('HOSTILE')])), expect: 'top_level_text', lib: 'throws' },
  { name: 'nesting 64 deep', build: () => rogue(nest('blockquote', 63)), expect: 'applied' },
  { name: 'nesting 65 deep', build: () => rogue(nest('blockquote', 65)), expect: 'depth' },
  { name: 'nesting 100 deep', build: () => rogue(nest('blockquote', 100)), expect: 'depth' },
  { name: 'nesting 2,500 deep (about 52 KB)', build: () => rogue(nest('blockquote', 2500)), expect: 'depth', ms: 500 },
  { name: 'nesting 8,000 deep, with the limit raised so the update gets to the walk', build: () => rogue(nest('blockquote', 8000)), expect: 'depth', limits: { bytes: 4194304 }, ms: 1500 },
  { name: 'a valid 10 MB paragraph: refused by the byte cap before it is decoded', build: () => rogue((f) => f.insert(1, [el('paragraph', {}, [tx('x'.repeat(10 * 1024 * 1024))])])), expect: 'too_big', ms: 50, undecoded: true },
  { name: '300,000 empty paragraphs (1.2 MB): over the byte cap', build: () => rogue((f) => f.insert(1, Array.from({ length: 300000 }, () => el('paragraph')))), expect: 'too_big', ms: 50, undecoded: true },
  { name: '300,000 empty paragraphs with the snapshot cap: still over it', build: () => rogue((f) => f.insert(1, Array.from({ length: 300000 }, () => el('paragraph')))), expect: 'too_big', limits: { bytes: 1048576 }, ms: 50, undecoded: true },
  { name: '40,000 empty paragraphs (about 160 KB) with the snapshot cap: over the node cap', build: () => rogue((f) => f.insert(1, Array.from({ length: 40000 }, () => el('paragraph')))), expect: 'nodes', limits: { bytes: 1048576 }, ms: 1500 },
  { name: 'more text than the document may hold', build: () => rogue((f) => f.insert(1, [el('paragraph', {}, [tx('y'.repeat(20000))])])), expect: 'text', limits: { textChars: 5000 } },
  // grids
  { name: 'a grid cell with colspan 2', build: () => rogue((f) => { const c = find(f, 'grid_cell'); c.setAttribute('colspan', 2); }), expect: 'grid_span', lib: 'clean' },
  { name: 'a grid cell with rowspan 3', build: () => rogue((f) => { find(f, 'grid_cell').setAttribute('rowspan', 3); }), expect: 'grid_span', lib: 'clean' },
  { name: 'a grid cell with colwidth [100]', build: () => rogue((f) => { find(f, 'grid_cell').setAttribute('colwidth', [100]); }), expect: 'attrs', lib: 'clean' },
  { name: 'a ragged grid (a row one cell short): applied on purpose, the writer repairs it', build: () => rogue((f) => { const rows = find(f, 'grid').toArray(); rows[2].delete(1, 1); }), expect: 'applied', ragged: true },
  { name: 'an empty grid: applied on purpose (two honest deletes make one), y-prosemirror removes it', build: () => rogue((f) => f.insert(1, [el('grid', {}, [])])), expect: 'applied', underfilled: true, lib: 'clean' },
  { name: 'a grid row with no cells: applied on purpose, y-prosemirror removes it', build: () => rogue((f) => { find(f, 'grid').insert(0, [el('grid_row')]); }), expect: 'applied', underfilled: true, lib: 'clean' },
  // places our schema does not have
  { name: 'a paragraph inside a paragraph', build: () => rogue((f) => f.insert(1, [el('paragraph', {}, [el('paragraph', {}, [tx('HOSTILE')])])])), expect: 'nesting', lib: 'clean' },
  { name: 'a grid cell directly in the document', build: () => rogue((f) => f.insert(1, [el('grid_cell', { colspan: 1, rowspan: 1 }, [tx('HOSTILE')])])), expect: 'nesting', lib: 'clean' },
  { name: 'a list row directly in the document', build: () => rogue((f) => f.insert(1, [el('list_item', {}, [el('paragraph', {}, [tx('HOSTILE')])])])), expect: 'nesting' },
  { name: 'a grid row holding only a paragraph', build: () => rogue((f) => { find(f, 'grid_row').insert(0, [el('paragraph', {}, [tx('HOSTILE')])]); }), expect: 'nesting', lib: 'clean' },
  { name: 'a page break inside a list', build: () => rogue((f) => f.insert(1, [el('bullet_list', {}, [el('list_item', { checked: null }, [el('page_break')])])])), expect: 'nesting', lib: 'clean' },
  { name: 'a state that decodes but fails node.check() (text in a grid row)', build: () => rogue((f) => { find(f, 'grid_row').insert(0, [tx('HOSTILE')]); }), expect: 'nesting', lib: 'clean' },
  { name: 'an unknown element (script)', build: () => rogue((f) => f.insert(1, [el('script', {}, [tx('HOSTILE')])])), expect: 'unknown_element', lib: 'clean' },
  { name: 'an unknown mark (blink)', build: () => rogue((f) => f.insert(1, [el('paragraph', {}, [tx('HOSTILE', { blink: {} })])])), expect: 'marks', lib: 'clean' },
  { name: 'a bold mark inside a code block', build: () => rogue((f) => f.insert(1, [el('code_block', { lang: '', info: '' }, [tx('HOSTILE', { strong: {} })])])), expect: 'marks', lib: 'clean' },
  { name: 'heading level 99', build: () => rogue((f) => f.insert(1, [el('heading', { level: 99 }, [tx('HOSTILE')])])), expect: 'attrs', lib: 'clean' },
  { name: 'a chip with a spaced, tagged id', build: () => rogue((f) => f.insert(1, [el('paragraph', {}, [el('object', { module: 'maps', kind: 'place', id: 'a b <img>', label: 'HOSTILE', title: '' })])])), expect: 'attrs', lib: 'clean' },
  { name: 'a code block with a quote in its language', build: () => rogue((f) => f.insert(1, [el('code_block', { lang: '"><script>', info: '' }, [tx('HOSTILE')])])), expect: 'attrs', lib: 'clean' },
  { name: 'a list row checked "yes"', build: () => rogue((f) => f.insert(1, [el('bullet_list', {}, [el('list_item', { checked: 'yes' }, [el('paragraph', {}, [tx('HOSTILE')])])])])), expect: 'attrs', lib: 'clean' },
  { name: 'a link mark to javascript:', build: () => rogue((f) => f.insert(1, [el('paragraph', {}, [tx('HOSTILE', { link: { href: 'javascript:alert(1)', title: '' } })])])), expect: 'marks', lib: 'clean' },
  { name: 'a formula with a blank line', build: () => rogue((f) => f.insert(1, [el('formula_block', { tex: 'a\n\nb' })])), expect: 'attrs', lib: 'clean' },
  { name: 'an attribute the schema does not have (__proto__, constructor)', build: () => rogue((f) => f.insert(1, [el('paragraph', { __proto__: 'x', constructor: 'y', toString: 'z' }, [tx('HOSTILE')])])), expect: 'attrs', lib: 'clean' },
  { name: 'an attribute that is a shared type', build: () => rogue((f) => { const p = el('paragraph', {}, [tx('HOSTILE')]); f.insert(1, [p]); p.setAttribute('x', el('paragraph')); }), expect: 'attrs' },
  { name: 'a second shared root next to the document', build: () => rogue((f, d) => { d.getXmlFragment('other').insert(0, [el('paragraph', {}, [tx('HOSTILE')])]); }), expect: 'unknown_root' },
  // bytes
  { name: 'a truncated update', build: () => { const u = rogue((f) => f.insert(1, [el('paragraph', {}, [tx('HOSTILE words that make the update longer than a few bytes')])])); return u.slice(0, Math.floor(u.length / 2)); }, expect: 'throws' },
  { name: 'bytes that are not an update', build: () => Uint8Array.from([255, 255, 255, 255, 255, 255, 1, 2, 3]), expect: 'throws' },
  { name: 'an update with a missing predecessor: not applied half, reported as pending', build: () => { const base = victim(); const rg = new PM.Doc(); PM.applyUpdate(rg, state(base)); const ups = []; rg.on('update', (u) => ups.push(u)); const f = rg.getXmlFragment(FRAG); f.insert(1, [el('paragraph', {}, [tx('first')])]); f.insert(2, [el('paragraph', {}, [tx('second')])]); return ups[1]; }, expect: 'pending' },
];

for (const c of HOSTILE) {
  await test(`hostile: ${c.name}`, () => {
    const bytes = c.build();
    const lim = c.limits || {};
    for (const path of ['reference', 'live']) {
      const doc = victim(); const before = state(doc);
      let r; const t = process.hrtime.bigint();
      let g = null; let reseeds = 0;
      if (path === 'reference') r = G.gateUpdate(doc, bytes, lim);
      else { g = G.guard(doc, lim, { bytes: lim.bytes }); g.prime(); reseeds = g.stats().reseeds; r = g.receive(bytes, 'rogue'); }
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      const where = `${c.name} [${path}]`;
      if (c.expect === 'applied') {
        assert.equal(r.ok, true, `${where}: refused (${r.reason}: ${r.detail})`);
        if (c.underfilled) assert.ok(r.underfilled >= 1 || path === 'reference', `${where}: not reported as underfilled`);
        if (path === 'live') {
          assert.equal(r.applied === false, false); // applied
          assert.ok(!same(state(doc), before), `${where}: not applied`);
        } else assert.ok(same(state(doc), before), `${where}: the reference check changed the live document`);
      } else {
        assert.equal(r.ok, false, `${where}: applied (it must be refused as ${c.expect})`);
        assert.equal(r.reason, c.expect, `${where}: refused as ${r.reason} (${r.detail}), not ${c.expect}`);
        assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
        assert.ok(same(state(doc), before), `${where}: the live document changed`);
        assert.ok(ms < (c.ms || 1000), `${where}: took ${ms.toFixed(1)} ms, bound ${c.ms || 1000}`);
        if (c.undecoded && g) assert.equal(g.stats().reseeds, reseeds, `${where}: the shadow was touched before the byte cap`);
        // the live document still takes an honest update afterwards (the guard mends its shadow)
        if (g) {
          const honest = rogue((f) => f.insert(1, [el('paragraph', {}, [tx('honest')])]), doc);
          const ok = g.receive(honest, 'friend');
          assert.equal(ok.ok, true, `${where}: an honest update after the refusal: ${ok.reason} ${ok.detail}`);
          assert.ok(textOfDoc(doc).includes('honest'));
        }
      }
      if (g) g.destroy();
    }
    if (c.ragged) {
      const doc = victim(); G.guard(doc).receive(c.build(), 'r');
      const widths = () => find(doc.getXmlFragment(FRAG), 'grid').toArray().map((r) => r.length);
      assert.ok(new Set(widths()).size > 1, 'the grid is not ragged');
      assert.equal(G.repairGrids(doc), 1); assert.equal(new Set(widths()).size, 1); assert.equal(G.repairGrids(doc), 0, 'a second repair wrote something');
    }
  });
}

// y-prosemirror alone, with no gate (the layer under the gate): what it cleans and what it does not
for (const c of HOSTILE.filter((x) => x.lib)) {
  await test(`library alone: ${c.name}`, () => {
    const net = new Net(ctx); const V = net.peer('V'); net.apply(V, VICTIM_STATE); V.out.length = 0;
    const bytes = c.build(); net.apply(V, bytes);
    if (c.lib === 'throws') { assert.ok(V.exc > 0, 'the library no longer throws: this case no longer needs the gate, read the plan again'); facts.push(`library alone, ${c.name.split(' (')[0]}: ${V.lastExc.slice(0, 40)}`); } else {
      assert.equal(V.exc, 0, `the library threw: ${V.lastExc}`); assert.equal(V.bad, 0, 'the library left an invalid document');
      assert.ok(!/javascript:|"script"|"blink"|<img>|"colspan":2|"rowspan":3/.test(JSON.stringify(V.view.state.doc.toJSON())), 'the hostile value is in the document');
    }
    net.destroy();
  });
}
await test('library alone: nesting 2,500 deep (the spike never ran it): what happens', () => {
  const net = new Net(ctx); const V = net.peer('V'); net.apply(V, VICTIM_STATE); V.out.length = 0;
  const bytes = rogue(nest('blockquote', 2500), V.ydoc); net.apply(V, bytes);
  facts.push(`2,500 deep, no gate: ${V.exc ? 'applyUpdate threw (' + V.lastExc.slice(0, 50) + ')' : 'applied'}, view ${V.bad ? 'invalid' : 'valid'}`);
  net.destroy();
});
await test('the byte cap is checked before anything is decoded (a 10 MB buffer of zeros)', () => {
  const doc = victim(); const g = G.guard(doc); const t = process.hrtime.bigint();
  const r = g.receive(new Uint8Array(10 * 1024 * 1024), 's');
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.equal(r.reason, 'too_big'); assert.ok(ms < 50, `${ms} ms`); assert.equal(g.stats().reseeds, 0);
  assert.equal(G.gateUpdate(doc, new Uint8Array(65537)).reason, 'too_big'); assert.equal(G.gateUpdate(doc, new Uint8Array(0)).reason, 'not_an_update'); assert.equal(G.gateUpdate(doc, 'x').reason, 'not_an_update');
  assert.equal(G.gateUpdate(doc, new Uint8Array(65537), { bytes: 1048576 }).reason !== 'too_big', true, 'the pull cap does not apply');
  g.destroy();
});
await test('the refusal counter flags a sender after 5 refusals in the window, and forgets after it', () => {
  let clock = 0; const doc = victim(); const g = G.guard(doc, {}, { now: () => clock });
  const bad = rogue((f) => f.insert(1, [el('script')]));
  for (let i = 0; i < 4; i++) { const r = g.receive(bad, 'mallory'); assert.equal(r.reason, 'unknown_element'); assert.equal(r.flagged, false, `flagged at ${i + 1}`); clock += 1000; }
  assert.equal(g.receive(bad, 'mallory').flagged, true);
  const good = rogue((f) => f.insert(1, [el('paragraph', {}, [tx('fine')])]), doc);
  const r = g.receive(good, 'mallory'); assert.equal(r.reason, 'sender_flagged'); assert.equal(r.applied, false); assert.ok(!textOfDoc(doc).includes('fine'));
  assert.equal(g.receive(good, 'alice').ok, true, 'another sender is not affected');
  clock += 61000; assert.equal(g.refusals.flagged('mallory'), false, 'the window passed');
  const c = G.refusals({ max: 2, windowMs: 10, now: () => clock }); assert.equal(c.note('x'), false); assert.equal(c.note('x'), true); c.clear('x'); assert.equal(c.flagged('x'), false);
  g.destroy();
});

await test('a live document that throws on an update the gate passed: reported as live_threw with rebuild set, nothing flagged as hostile text', () => {
  const doc = victim(); const g = G.guard(doc);
  doc.on('beforeTransaction', () => { throw new Error('the view could not draw it'); });
  const r = g.receive(rogue((f) => f.insert(1, [el('paragraph', {}, [tx('fine')])]), doc), 'p');
  assert.equal(r.ok, false); assert.equal(r.reason, 'live_threw'); assert.equal(r.rebuild, true); assert.equal(r.applied, false);
  g.destroy();
});

// ---- 2. honest traffic goes through --------------------------------------------------------------------------------------------------
class GNet extends Net {
  constructor(c, seed) { super(c, seed); this.refused = []; this.accepted = 0; }
  apply(q, u) {
    if (!q.guard) q.guard = G.guard(q.ydoc, {}, { origin: 'net' });
    const r = q.guard.receive(u, 'peer');
    if (r.ok) this.accepted += 1; else this.refused.push(r.reason);
    this.after(q);
  }
  destroy() { for (const p of this.peers) if (p.guard) p.guard.destroy(); super.destroy(); }
}
const KITCHEN = ['# Title here', 'Alpha paragraph one.', 'Beta paragraph two with **bold** and a [link](https://example.com).',
  '- item a\n- item b\n  - nested c', '1. first\n2. second', '> quote text',
  '| h1 | h2 | h3 |\n| --- | --- | --- |\n| a1 | a2 | a3 |\n| b1 | b2 | b3 |\n| c1 | c2 | c3 |',
  '```js\ncode here\n```', '$$\nx^2 + y^2\n$$', 'Inline $e=mc^2$ formula and chip [the map](object:maps:place:abc123) text.',
  '<div>raw html block</div>', '_ _ _', 'Gamma paragraph three.', 'Delta paragraph four.',
  '| gp | gq |\n| --- | --- |\n| gu | gv |', 'Last paragraph.'].join('\n\n') + '\n';
const pt = (p, s, nth) => posOfText(p.view.state.doc, s, nth);
const inCell = (p, txt) => p.view.dispatch(p.view.state.tr.setSelection(PM.TextSelection.create(p.view.state.doc, pt(p, txt) + 1)));
const run = (p, cmd) => assert.ok(cmd(p.view.state, p.view.dispatch.bind(p.view)), 'the grid command did not apply');
const valid = (...ps) => ps.every((p) => { try { p.view.state.doc.check(); return true; } catch { return false; } });
function kitchen(n, NetClass = GNet) {
  const net = new NetClass(ctx); const rd = L.dlRichRead(PM, KITCHEN, lex);
  const ps = [net.peer('A', { seed: rd.doc })]; for (let i = 1; i < n; i++) ps.push(net.peer('BCDEFGH'[i - 1]));
  net.sync(); net.deliver(); net.quiesce();
  return { net, ps };
}
await test('honest traffic: the grid collisions and typing go through the gate: 0 refusals, all converge', () => {
  { const { net, ps: [A, B] } = kitchen(2); typeChars(A, pt(A, 'Alpha') + 5, ' AAAA'); typeChars(B, pt(B, 'Alpha') + 5, ' BBBB'); net.quiesce(); assert.ok(net.converged()); assert.deepEqual(net.refused, []); net.destroy(); }
  { const { net, ps: [A, B] } = kitchen(2); inCell(A, 'a1'); run(A, PM.addRowAfter); inCell(B, 'b3'); run(B, PM.addColumnAfter); net.quiesce(); assert.ok(net.converged()); assert.deepEqual(net.refused, [], 'row against column was refused'); net.destroy(); }
  { const { net, ps: [A, B] } = kitchen(2); inCell(A, 'a2'); run(A, PM.deleteColumn); inCell(B, 'a2'); run(B, PM.deleteColumn); net.quiesce(); assert.ok(net.converged()); assert.deepEqual(net.refused, []); net.destroy(); }
  { const { net, ps: [A, B] } = kitchen(2); inCell(A, 'gp'); run(A, PM.deleteColumn); inCell(B, 'gq'); run(B, PM.deleteColumn); net.quiesce(); // two honest deletes empty the 2-column grid: an underfilled state, not a refusal
    assert.deepEqual(net.refused, [], 'an emptied grid was refused'); assert.ok(valid(A, B)); assert.ok(net.converged()); net.destroy(); }
  { const { net, ps: [A, B] } = kitchen(2); const g = nodesOfType(A.view.state.doc, 'paragraph').find((x) => x.n.textContent.startsWith('Gamma'));
    A.view.dispatch(A.view.state.tr.delete(g.pos, g.pos + g.n.nodeSize)); typeChars(B, pt(B, 'Gamma') + 5, ' TYPED'); net.quiesce(); assert.deepEqual(net.refused, []); assert.ok(net.converged()); net.destroy(); }
});
const texts = [...CASES.map((c) => c[1]), ...fuzzDocs(schema, FUZZ, false).map((d) => L.dlRichSerialise(PM, d)), ...fuzzDocs(schema, FUZZ, true).map((d) => L.dlRichSerialise(PM, d)), ...sourceDocs(FUZZ)]
  .filter((t) => t.length > 20 && !/[\ud800-\udfff]/.test(t));
function fuzzRun(shuffle) {
  const R = rng(777); let docs = 0; const reasons = new Map(); let accepted = 0;
  for (const md of texts) {
    const rd = L.dlRichRead(PM, md, lex); if (!rd.stored.entries) continue; docs++;
    const net = new GNet(ctx, docs); const ps = [net.peer('A', { seed: rd.doc }), net.peer('B'), net.peer('C')]; net.sync(); net.deliver();
    for (const p of ps) for (let k = 0; k < 3; k++) {
      const doc = p.view.state.doc; const tb = []; doc.descendants((n, pos) => { if (n.isTextblock && n.type.name !== 'code_block' && n.type.name !== 'source_block') tb.push(pos); });
      const top = []; doc.forEach((n, off) => top.push({ n, off })); const r = R();
      try {
        if (r < 0.6 && tb.length) { const pos = tb[Math.floor(R() * tb.length)]; const n = doc.nodeAt(pos); p.view.dispatch(p.view.state.tr.insertText(p.name + p.name, pos + 1 + Math.floor(R() * (n.content.size + 1)))); }
        else if (r < 0.8) { const t = top[Math.floor(R() * top.length)]; p.view.dispatch(p.view.state.tr.insert(t.off, schema.nodes.paragraph.create(null, schema.text('new-' + p.name)))); }
        else if (top.length > 2) { const t = top[Math.floor(R() * top.length)]; p.view.dispatch(p.view.state.tr.delete(t.off, t.off + t.n.nodeSize)); }
      } catch { /* an edit that does not fit this document */ }
      if (R() < 0.5) net.deliver(shuffle ? { shuffle: true, dup: 0.2 } : {});
    }
    net.quiesce(shuffle ? { shuffle: true, dup: 0.2 } : {}); net.sync(); net.quiesce();
    assert.ok(net.converged(), `diverged: ${md.slice(0, 80).replace(/\n/g, '/')} :: refused ${net.refused.join(',')} :: ${ps.map((p) => p.guard && JSON.stringify(p.guard.stats())).join(' ')} :: pend ${ps.map((p) => !!p.ydoc.store.pendingStructs).join(',')}`); assert.ok(valid(...ps), 'invalid document');
    for (const x of net.refused) reasons.set(x, (reasons.get(x) || 0) + 1);
    accepted += net.accepted; net.destroy();
  }
  return { docs, reasons, accepted };
}
await test(`honest traffic: ${texts.length} documents, 3 peers, in order: 0 refusals, converge`, () => {
  const r = fuzzRun(false);
  assert.deepEqual([...r.reasons], [], `refused: ${JSON.stringify([...r.reasons])}`);
  facts.push(`in order: ${r.docs} documents, ${r.accepted} updates, 0 refused`);
});
await test(`honest traffic: shuffled and duplicated: only "pending" is refused (and repaired by one state-vector exchange); converge`, () => {
  const r = fuzzRun(true);
  assert.deepEqual([...r.reasons.keys()].filter((k) => k !== 'pending'), [], `refused: ${JSON.stringify([...r.reasons])}`);
  facts.push(`shuffled: ${r.docs} documents, ${r.accepted} accepted, ${r.reasons.get('pending') || 0} pending (repaired)`);
});

// ---- 3. recovery -------------------------------------------------------------------------------------------------------------------
await test('rollback: after a poisoned update the live document is rebuilt from the last good snapshot and equals it', () => {
  const net = new Net(ctx); const rd = L.dlRichRead(PM, VICTIM_MD, lex);
  const V = net.peer('V', { seed: rd.doc }); net.sync(); net.deliver(); V.out.length = 0;
  typeChars(V, pt(V, 'Omega') + 5, '!!'); // some editing before the snapshot
  const snapshot = state(V.ydoc); const goodText = textOf(V);
  const bad = rogue((f) => f.insert(1, [tx('HOSTILE')]), V.ydoc);
  net.apply(V, bad); // no gate: the poison
  assert.ok(V.exc > 0, 'the update did not throw: no poison to recover from');
  const r = G.rebuildFromGood(snapshot);
  assert.equal(r.ok, true, `${r.reason} ${r.detail}`);
  assert.ok(same(state(r.doc), snapshot), 'the rebuilt document is not the snapshot');
  const frag = r.doc.getXmlFragment(FRAG);
  assert.equal(PM.yXmlFragmentToProseMirrorRootNode(frag, schema).textContent, goodText, 'the text is not the snapshot\'s');
  // a new view on the rebuilt document works and takes an honest update through a guard
  assert.ok(G.guard(r.doc).receive(rogue((f) => f.insert(1, [el('paragraph', {}, [tx('after')])]), r.doc), 'p').ok, 'the rebuilt document does not take an honest update');
  net.destroy();
});
await test('rollback: a snapshot that is itself bad, too big or incomplete is not trusted', () => {
  const doc = new PM.Doc(); const frag = doc.getXmlFragment(FRAG); frag.insert(0, [el('script', {}, [tx('x')])]);
  assert.equal(G.rebuildFromGood(state(doc)).reason, 'unknown_element');
  assert.equal(G.rebuildFromGood(new Uint8Array(2 * 1048576)).reason, 'too_big');
  assert.equal(G.rebuildFromGood(null).reason, 'not_an_update');
  const d2 = new PM.Doc(); const f2 = d2.getXmlFragment(FRAG); f2.insert(0, [tx('x')]);
  assert.equal(G.rebuildFromGood(state(d2)).reason, 'top_level_text');
  const r = G.rebuildFromGood(new Uint8Array([1, 2, 3])); assert.equal(r.ok, false); assert.ok(r.doc instanceof PM.Doc);
});
await test('writer check: a good state passes, with the untouched blocks word for word', () => {
  const stored = L.dlRichRead(PM, KITCHEN, lex);
  const doc = new PM.Doc(); PM.prosemirrorToYXmlFragment(stored.doc, doc.getXmlFragment(FRAG));
  const v = G.verifyBeforeSnapshot(lex, doc, KITCHEN);
  assert.equal(v.ok, true, `${v.reason}: ${v.detail}`); assert.equal(v.text, KITCHEN); assert.ok(v.expected >= 16, `${v.expected}`);
  // one block edited: the text changes in that block only
  const net = new Net(ctx); const A = net.peer('A', { seed: stored.doc }); net.deliver();
  typeChars(A, pt(A, 'Gamma') + 5, ' EDIT');
  const v2 = G.verifyBeforeSnapshot(lex, A.ydoc, KITCHEN);
  assert.equal(v2.ok, true, `${v2.reason}: ${v2.detail}`); assert.ok(v2.text.includes('Gamma EDIT paragraph three.')); assert.equal(v2.kept, v2.expected);
  net.destroy();
});
await test('writer check: a state that is not fit keeps the previous snapshot and says why', () => {
  const stored = L.dlRichRead(PM, KITCHEN, lex);
  const bad1 = new PM.Doc(); PM.prosemirrorToYXmlFragment(stored.doc, bad1.getXmlFragment(FRAG)); bad1.getXmlFragment(FRAG).insert(1, [el('script', {}, [tx('x')])]);
  assert.equal(G.verifyBeforeSnapshot(lex, bad1, KITCHEN).reason, 'unknown_element');
  const bad2 = new PM.Doc(); bad2.getXmlFragment(FRAG).insert(0, [tx('x')]);
  assert.equal(G.verifyBeforeSnapshot(lex, bad2, KITCHEN).reason, 'top_level_text');
  const big = new PM.Doc(); PM.prosemirrorToYXmlFragment(stored.doc, big.getXmlFragment(FRAG));
  assert.equal(G.verifyBeforeSnapshot(lex, big, KITCHEN, { bytes: 100 }).reason, 'too_big');
  // the verify works on a copy: a mended document is not changed behind the caller's back
  const under = new PM.Doc(); PM.prosemirrorToYXmlFragment(stored.doc, under.getXmlFragment(FRAG)); find(under.getXmlFragment(FRAG), 'grid').insert(0, [el('grid_row')]);
  const before = state(under); G.verifyBeforeSnapshot(lex, under, KITCHEN); assert.ok(same(state(under), before), 'the verify changed the document it was given');
});

// ---- 4. cost on a 150,000-character document ----------------------------------------------------------------------------------------
await test('cost: a 150,000-character document, about 1,200 blocks: the live check stays within about 1 ms per update', () => {
  const words = 'the quick brown fox jumps over a lazy dog while writing notes for the next session'.split(' ');
  const rnd = rng(7); const sent = (n) => Array.from({ length: n }, () => words[Math.floor(rnd() * words.length)]).join(' ');
  const blocks = []; let len = 0, i = 0;
  while (len < 148000) { i++; blocks.push(i % 25 === 1 ? '## Heading ' + i : sent(18) + '. ' + sent(6) + '.'); len += blocks[blocks.length - 1].length + 2; }
  const md = blocks.join('\n\n') + '\n'; const rd = L.dlRichRead(PM, md, lex);
  const live = new PM.Doc(); PM.prosemirrorToYXmlFragment(rd.doc, live.getXmlFragment(FRAG));
  const peer = new PM.Doc(); PM.applyUpdate(peer, state(live)); const ups = []; peer.on('update', (u) => ups.push(u));
  const pf = peer.getXmlFragment(FRAG);
  for (let k = 0; k < 400; k++) pf.get(1 + (k * 3) % 900).get(0).insert(2, 'x');
  const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * p)];
  const ms = (fn) => { const t = process.hrtime.bigint(); const r = fn(); return [Number(process.hrtime.bigint() - t) / 1e6, r]; };
  const refT = []; { const d = new PM.Doc(); PM.applyUpdate(d, state(live)); for (const u of ups.slice(0, 60)) { const [t, r] = ms(() => G.gateUpdate(d, u)); assert.equal(r.ok, true); refT.push(t); PM.applyUpdate(d, u); } }
  const heap = () => { if (global.gc) global.gc(); return process.memoryUsage().heapUsed; };
  const d = new PM.Doc(); PM.applyUpdate(d, state(live)); const h0 = heap();
  const [seedT] = ms(() => { const g = G.guard(d); g.receive(ups[0], 's'); return g; });
  const g2 = G.guard(d); g2.receive(ups[1], 's'); const h1 = heap();
  const liveT = []; for (const u of ups.slice(2)) { const [t, r] = ms(() => g2.receive(u, 's')); assert.equal(r.ok, true, r.reason); liveT.push(t); }
  const plain = []; { const d3 = new PM.Doc(); PM.applyUpdate(d3, state(live)); for (const u of ups) { const [t] = ms(() => PM.applyUpdate(d3, u)); plain.push(t); } }
  const [rebuildT, rb] = ms(() => G.rebuildFromGood(state(live))); assert.equal(rb.ok, true);
  const [verifyT, vv] = ms(() => G.verifyBeforeSnapshot(lex, live, md)); assert.equal(vv.ok, true, vv.reason + vv.detail);
  const f = (x) => x.toFixed(3);
  facts.push(`150k doc (${rd.doc.childCount} blocks, snapshot ${state(live).length} B): update gate p50/p95 ms: live ${f(pct(liveT, .5))}/${f(pct(liveT, .95))}, reference ${f(pct(refT, .5))}/${f(pct(refT, .95))}, plain applyUpdate ${f(pct(plain, .5))}/${f(pct(plain, .95))}; guard first check (makes the shadow) ${seedT.toFixed(1)} ms; rebuildFromGood ${rebuildT.toFixed(1)} ms; verifyBeforeSnapshot ${verifyT.toFixed(1)} ms${global.gc ? `; two guards added ${((h1 - h0) / 1e6).toFixed(1)} MB heap` : ''}`);
  assert.ok(pct(liveT, .5) < 1, `live p50 ${pct(liveT, .5)} ms`); assert.ok(pct(liveT, .95) < 10, `live p95 ${pct(liveT, .95)} ms`);
  g2.destroy();
});

const secs = ((Date.now() - t0) / 1000).toFixed(1);
if (fails.length) { console.error(`documents coedit gate: ${fails.length} failed, ${passed} passed`); for (const f of fails) console.error(`  - ${f}`); process.exit(1); }
console.log(`documents coedit gate: ${passed} tests passed in ${secs} s (${facts.join('; ')})`);
