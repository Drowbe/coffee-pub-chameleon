#!/usr/bin/env node
/*
 * check-whiteboard-resync.mjs -- the board read again after a missed stream (modules/whiteboard/src/whiteboard-lib-r-resync.js).
 * Guards: wbResyncPlan(known, remoteList, pending) => { put, remove }: a new remote block appears; a newer version replaces;
 * equal or older versions are left alone; a block being edited, dragged or waiting to be saved (pending) is neither put nor
 * removed; a block gone remotely is removed only when it is not pending; entries that are not blocks are cleaned by wbClean
 * (or left out) and never remove a block they might stand for. It runs the module's libs in one scope, with no page.
 * Usage: node modules/whiteboard/test/check-whiteboard-resync.mjs [path to the src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
let passed = 0;
const fails = [];
let L = {};
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-[a-z]-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  L = new Function(`${parts.join('\n')}\nreturn { plan: typeof wbResyncPlan === 'undefined' ? undefined : wbResyncPlan, wbClean };`)();
} catch (err) {
  fails.push(`the libs do not load: ${err.message}`);
}
function test(name, fn) {
  try {
    if (!L.plan) throw new Error('the libs have no wbResyncPlan');
    fn();
    passed += 1;
  } catch (err) {
    fails.push(`${name}: ${err.message}`);
  }
}
const entry = (id, version, text = 'hi', more = {}) => ({ key: `block:main:${id}`, version, value: { id, type: 'note', x: 0, y: 0, w: 100, h: 80, z: 1, text, ...more } });
const ids = (l) => l.map((p) => p.block.id);

test('a new remote block appears', () => {
  const r = L.plan(new Map([['a', 1]]), [entry('a', 1), entry('b', 1)], new Set());
  assert.deepEqual(ids(r.put), ['b']);
  assert.equal(r.put[0].version, 1);
  assert.deepEqual(r.remove, []);
});
test('a newer version replaces; equal and older are untouched', () => {
  const r = L.plan(new Map([['a', 1], ['b', 2], ['c', 5]]), [entry('a', 2, 'new'), entry('b', 2), entry('c', 3)], new Set());
  assert.deepEqual(ids(r.put), ['a']);
  assert.equal(r.put[0].block.text, 'new');
  assert.deepEqual(r.remove, []);
});
test('a pending block (editing, dragged, waiting to be saved) is kept as it is', () => {
  const r = L.plan(new Map([['a', 1], ['b', 1]]), [entry('a', 9, 'theirs')], ['a', 'b']);
  assert.deepEqual(r.put, []);
  assert.deepEqual(r.remove, []);
});
test('a block gone remotely is removed, unless it is pending', () => {
  const r = L.plan(new Map([['a', 1], ['b', 1], ['c', 0]]), [], new Set(['c']));
  assert.deepEqual(r.remove.sort(), ['a', 'b']);
});
test('a block with no version yet that the server holds is put; one not on the page and pending is not', () => {
  const r = L.plan(new Map([['a', 0]]), [entry('a', 1), entry('n', 1)], new Set(['n']));
  assert.deepEqual(ids(r.put), ['a']);
});
test('hostile entries are cleaned by wbClean or left out, and do not remove what they might stand for', () => {
  const evil = [null, 5, 'x', {}, { value: null }, { value: { id: 'k', type: 'nope' } }, { value: { id: 'a', type: 'note', x: 'NaN', y: {}, w: -5, text: 7 }, version: 4 }, entry('b', 1, '<img src=x onerror=1>')];
  const r = L.plan(new Map([['k', 1], ['a', 1], ['gone', 1]]), evil, new Set());
  assert.deepEqual(r.remove, ['gone'], 'k stays: the server holds a block with its id that this page cannot read');
  for (const p of r.put) assert.deepEqual(p.block, L.wbClean(p.block), 'what is put is already clean');
  assert.ok(ids(r.put).includes('b'));
});
test('not a list: nothing to put, and nothing is removed from an empty read of a bad shape', () => {
  assert.deepEqual(L.plan({ a: 1 }, 'nope', []).put, []);
  assert.deepEqual(L.plan(null, null, null), { put: [], remove: [] });
});

if (fails.length) {
  console.error(`check-whiteboard-resync: ${fails.length} failed, ${passed} passed`);
  for (const f of fails) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(`check-whiteboard-resync: OK (${passed} checks)`);
