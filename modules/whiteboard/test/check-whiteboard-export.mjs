#!/usr/bin/env node
/*
 * check-whiteboard-export.mjs -- the Whiteboard's Save as image and Print (whiteboard-lib-l-export.js), the parts that are
 * plain sums: which blocks each kind takes (Everything; What is selected, with the connectors between picked blocks;
 * What is in sight), the part of the board the picture shows (a margin round everything or the selection, none round
 * what is in sight; rounded outward; nothing to show), its size in pixels kept inside what a browser can make (the
 * longest side and the most pixels, and saying when it had to be smaller), the words for its size, the file's name
 * (nothing a computer's file names refuse) and text made fit for XML. Drawing the picture itself needs a browser: the
 * stage's live probe does that by hand. It runs the module's own libs in one scope as the page has them. No network.
 * Usage: node modules/whiteboard/test/check-whiteboard-export.mjs [path to the module's src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
const NAMES = ['wbExportPick', 'wbExportExtent', 'wbExportSize', 'wbExportName', 'wbXmlSafe', 'wbOverlap', 'WB_EXPORT', 'wbExportPixels'];
const fails = [];
let passed = 0;
let api = {};
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-[a-z]-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  const grab = NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  api = new Function('window', 'document', `${parts.join('\n')}\nreturn { ${grab} };`)({ devicePixelRatio: 1 }, undefined);
} catch (err) {
  fails.push(`the libs do not load: ${err.message}`);
}
const { wbExportPick, wbExportExtent, wbExportSize, wbExportName, wbXmlSafe, WB_EXPORT, wbExportPixels } = api;
const t = (name, fn) => { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } };
const R = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
const list = [
  { id: 'a', rect: R(0, 0, 100, 100), refs: [] },
  { id: 'b', rect: R(200, 0, 300, 50), refs: [] },
  { id: 'gone', rect: null, refs: [] },
  { id: 'c1', rect: R(100, 20, 200, 30), refs: ['a', 'b'] },
  { id: 'c2', rect: R(100, 20, 500, 30), refs: ['a', 'x'] },
  { id: 'far', rect: R(5000, 5000, 5100, 5100), refs: [] },
];
t('all: every drawn block, bottom to top', () => assert.deepEqual(wbExportPick('all', list), ['a', 'b', 'c1', 'c2', 'far']));
t('selection: picked + connectors whose ends are all picked', () => assert.deepEqual(wbExportPick('selection', list, { picked: new Set(['a', 'b']) }), ['a', 'b', 'c1']));
t('selection: none picked -> nothing', () => assert.deepEqual(wbExportPick('selection', list, { picked: new Set() }), []));
t('selection: a picked block not drawn is ignored', () => assert.deepEqual(wbExportPick('selection', list, { picked: new Set(['gone']) }), []));
t('view: overlapping only', () => assert.deepEqual(wbExportPick('view', list, { view: R(-10, -10, 150, 150) }), ['a', 'c1', 'c2']));
t('view: touching edge is not overlap', () => assert.deepEqual(wbExportPick('view', list, { view: R(300, 0, 400, 25) }), ['c2']));
t('extent all with margin', () => assert.deepEqual(wbExportExtent('all', [R(0, 0, 100, 100), R(200, 0, 300, 50)], { margin: 32 }), { x: -32, y: -32, w: 364, h: 164 }));
t('extent rounds outward', () => assert.deepEqual(wbExportExtent('all', [R(0.4, 0.6, 10.2, 10.1)], { margin: 0 }), { x: 0, y: 0, w: 11, h: 11 }));
t('extent default margin', () => assert.equal(wbExportExtent('all', [R(0, 0, 10, 10)]).w, 10 + 2 * WB_EXPORT.margin));
t('extent view: the view itself, no margin', () => assert.deepEqual(wbExportExtent('view', [], { view: R(-12.5, 3, 387.5, 303) }), { x: -13, y: 3, w: 401, h: 300 }));
t('extent empty -> null', () => assert.equal(wbExportExtent('all', []), null));
t('extent NaN -> null', () => assert.equal(wbExportExtent('all', [R(NaN, 0, 1, 1)]), null));
t('size 1x', () => assert.deepEqual(wbExportSize({ w: 800, h: 600 }, 1), { width: 800, height: 600, scale: 1, clamped: false }));
t('size 2x', () => assert.deepEqual(wbExportSize({ w: 800, h: 600 }, 2), { width: 1600, height: 1200, scale: 2, clamped: false }));
t('size bad scale -> 1', () => assert.equal(wbExportSize({ w: 10, h: 10 }, NaN).scale, 1));
t('size side cap', () => { const s = wbExportSize({ w: 20000, h: 100 }, 2); assert.ok(s.clamped); assert.ok(s.width <= WB_EXPORT.side); assert.equal(s.width, 16384); });
t('size area cap', () => { const s = wbExportSize({ w: 10000, h: 10000 }, 2); assert.ok(s.clamped); assert.ok(s.width * s.height <= WB_EXPORT.area, `${s.width * s.height}`); assert.ok(s.width <= 16384 && s.height <= 16384); });
t('size area cap 1x large', () => { const s = wbExportSize({ w: 9000, h: 9000 }, 1); assert.ok(s.clamped); assert.ok(s.width * s.height <= WB_EXPORT.area); });
t('size custom cap', () => assert.deepEqual(wbExportSize({ w: 100, h: 50 }, 2, { side: 100, area: 1e9 }), { width: 100, height: 50, scale: 1, clamped: true }));
t('size never 0', () => { const s = wbExportSize({ w: 1, h: 100000 }, 1); assert.ok(s.width >= 1 && s.height <= 16384); });
t('pixels words', () => assert.equal(wbExportPixels({ width: 2400, height: 1600 }), '2400 × 1600 pixels'));
const d = new Date(2026, 10, 9, 14, 5);
t('name', () => assert.equal(wbExportName('Whiteboard', d), 'Whiteboard 2026-11-09 1405.png'));
t('name hostile chars', () => assert.equal(wbExportName('a/b\\c:d*e?"<x>|\u0000y', d), 'a b c d e x y 2026-11-09 1405.png'));
t('name empty', () => assert.equal(wbExportName('  ', d, 'png'), 'Whiteboard 2026-11-09 1405.png'));
t('name long', () => assert.ok(wbExportName('x'.repeat(500), d).length <= 100));
t('name: the board name, cleaned', () => assert.equal(wbExportName('Plan B', d), 'Plan B 2026-11-09 1405.png'));
t('name: dots only / hidden / dotdot', () => { for (const n of ['..', '.', '...', '.hidden', '../../etc/passwd']) { const r = wbExportName(n, d); assert.ok(!r.startsWith('.') && !r.includes('/') && !r.includes('..'), r); } });
t('name: bidi and invisible marks go', () => assert.equal(wbExportName('a\u202Eb\u200Fc\u2066d\uFEFFe', d), 'a b c d e 2026-11-09 1405.png'));
t('name: very long in emoji stays whole characters', () => { const r = wbExportName('😀'.repeat(300), d); assert.ok(r.length <= 200); assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(r)); });
t('name: null / undefined', () => { assert.equal(wbExportName(null, d), 'Whiteboard 2026-11-09 1405.png'); assert.equal(wbExportName(undefined, d), 'Whiteboard 2026-11-09 1405.png'); });
t('xml safe controls', () => assert.equal(wbXmlSafe('a\u0000b\u0008c\u000Bd\u001Fe\tf\ng\rh'), 'abcde\tf\ng\rh'));
t('xml safe surrogates', () => assert.equal(wbXmlSafe('ok😀 lone\uD800x \uDC00y ￾￿'), 'ok😀 lonex y '));
t('xml safe keeps markup chars (escaped by the serialiser)', () => assert.equal(wbXmlSafe('</foreignObject><script>'), '</foreignObject><script>'));
t('xml safe non-string', () => assert.equal(wbXmlSafe(null), ''));

if (fails.length) {
  for (const f of fails) console.error(`FAIL ${f}`);
  console.error(`check-whiteboard-export: ${fails.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`check-whiteboard-export: OK, ${passed} cases`);
