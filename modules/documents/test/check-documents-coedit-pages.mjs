#!/usr/bin/env node
/*
 * check-documents-coedit-pages.mjs -- the page spacers of the rich editor survive a change that comes from another person
 * (documents-lib-t-editor-pages.js, step 3 of plan-documents-coediting.md). Node, no DOM.
 *
 * The spike found that after ONE remote change the spacers went from 14 to 0 on the page while the plugin's list still said 14, and stayed 0:
 * y-prosemirror hands a remote change over as one step that replaces the whole document, mapping a decoration through that drops it, and the
 * next reading found the list unchanged and drew nothing. This checks the decoration set itself on stand-in peers (the real y-prosemirror binding,
 * a stub view with no DOM); what is on the screen is checked in a real browser by the build's own script, not here.
 *
 * Usage: node modules/documents/test/check-documents-coedit-pages.mjs [path to the src folder]. Exits 1 on any failure.
 */
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadYjs, Net, posOfText, typeChars, nodesOfType } from './support/yjs-peers.mjs';

const t0 = Date.now();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(root, 'modules/documents/src'));
const ctx = loadYjs(src);
const { PM, L, lex, schema } = ctx;
let passed = 0; const fails = [];
function test(name, fn) { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

const many = (n) => Array.from({ length: n }, (_, i) => `para ${i} text`).join('\n\n') + '\n';
const heights = (h) => (view) => { const out = []; view.state.doc.forEach((n) => out.push({ height: n.type.name === 'page_break' ? 0 : h, kind: n.type.name === 'page_break' ? 'pagebreak' : 'block' })); return out; };
const found = (ctl, view) => ctl.plugin.props.decorations(view.state).find().length;

function twoPeers(h = 300, n = 12) {
  const net = new Net(ctx); const rd = L.dlRichRead(PM, many(n), lex);
  const mk = (name, seed) => {
    const ctl = L.dlEditorPagesPlugin(PM, { read: heights(h), after: () => () => {} });
    const p = net.peer(name, { seed, plugins: () => [ctl.plugin] }); p.ctl = ctl; return p;
  };
  const A = mk('A', rd.doc); const B = mk('B');
  net.sync(); net.deliver(); net.quiesce();
  B.ctl.setPaged(B.view, true, 'letter'); A.ctl.setPaged(A.view, true, 'letter');
  return { net, A, B };
}

test('spacers: a remote character, a remote paragraph and a remote delete leave every spacer on the set (and a local edit too)', () => {
  const { net, A, B } = twoPeers();
  const want = B.ctl.info(B.view.state).spacers.length; assert.ok(want >= 4, `${want} spacers to start with`);
  assert.equal(found(B.ctl, B.view), want);
  typeChars(A, posOfText(A.view.state.doc, 'para 3') + 6, 'Z'); net.quiesce();
  assert.ok(B.view.state.doc.textContent.includes('para 3Z'), 'the remote character did not arrive'); assert.equal(found(B.ctl, B.view), want, 'after a remote character');
  A.view.dispatch(A.view.state.tr.insert(posOfText(A.view.state.doc, 'para 5') - 1, schema.nodes.paragraph.create(null, schema.text('new one')))); net.quiesce();
  assert.ok(B.view.state.doc.textContent.includes('new one')); assert.equal(found(B.ctl, B.view), want, 'after a remote paragraph');
  const g = nodesOfType(A.view.state.doc, 'paragraph').find((x) => x.n.textContent.startsWith('para 8')); A.view.dispatch(A.view.state.tr.delete(g.pos, g.pos + g.n.nodeSize)); net.quiesce();
  assert.ok(!B.view.state.doc.textContent.includes('para 8')); assert.equal(found(B.ctl, B.view), want, 'after a remote delete');
  typeChars(B, posOfText(B.view.state.doc, 'para 1 ') + 7, 'Y'); net.quiesce();
  assert.equal(found(B.ctl, B.view), want, 'after a local edit');
  assert.equal(A.ctl.info(A.view.state).spacers.length, found(A.ctl, A.view), 'the writer-side peer lost spacers too');
  net.destroy();
});
test('spacers: after a remote change the next reading still puts them where the new heights say', () => {
  const { net, A, B } = twoPeers(300, 12);
  A.view.dispatch(A.view.state.tr.insert(posOfText(A.view.state.doc, 'para 0') - 1, schema.nodes.paragraph.create(null, schema.text('first')))); net.quiesce();
  B.ctl.measure(B.view); // 13 blocks of 300: the same pages as the list says
  assert.equal(found(B.ctl, B.view), B.ctl.info(B.view.state).spacers.length);
  net.destroy();
});
test('spacers: without Yjs a change that drops decorations (a whole-document replace) redraws them too', () => {
  const ed = L.dlRichEditor(PM, null, lex, null); ed.setText(many(12));
  const ctl = L.dlEditorPagesPlugin(PM, { read: heights(300), after: () => () => {} });
  let state = PM.EditorState.create({ doc: ed.state().doc, plugins: [...ed.state().plugins, ctl.plugin] });
  const view = { composing: false, dom: null, get state() { return state; }, dispatch(tr) { state = state.apply(tr); } };
  ctl.setPaged(view, true, 'letter'); const want = ctl.info(state).spacers.length; assert.ok(want >= 4);
  state = state.apply(state.tr.replaceWith(0, state.doc.content.size, state.doc.content).setMeta('addToHistory', false)); // no key: a plain replace
  assert.equal(found(ctl, view), want, 'a whole-document replace dropped the spacers');
  state = state.apply(state.tr.insertText('x', 3)); assert.equal(found(ctl, view), want, 'a typed letter changed the spacers');
});
test('spacers: a manual page break is a node decoration and survives a remote change too', () => {
  const net = new Net(ctx); const rd = L.dlRichRead(PM, 'one\n\n_ _ _\n\ntwo\n\nthree\n', lex);
  const mk = (name, seed) => { const ctl = L.dlEditorPagesPlugin(PM, { read: heights(100), after: () => () => {} }); const p = net.peer(name, { seed, plugins: () => [ctl.plugin] }); p.ctl = ctl; return p; };
  const A = mk('A', rd.doc); const B = mk('B'); net.sync(); net.deliver(); net.quiesce(); B.ctl.setPaged(B.view, true, 'letter');
  const want = found(B.ctl, B.view); assert.ok(want >= 1);
  typeChars(A, posOfText(A.view.state.doc, 'two') + 3, 'Z'); net.quiesce(); assert.equal(found(B.ctl, B.view), want);
  net.destroy();
});

const secs = ((Date.now() - t0) / 1000).toFixed(1);
if (fails.length) { console.error(`documents coedit pages: ${fails.length} failed, ${passed} passed`); for (const f of fails) console.error(`  - ${f}`); process.exit(1); }
console.log(`documents coedit pages: ${passed} tests passed in ${secs} s`);
