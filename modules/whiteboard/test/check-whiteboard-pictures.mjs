#!/usr/bin/env node
/*
 * check-whiteboard-pictures.mjs -- the Whiteboard's pictures (modules/whiteboard/src/whiteboard-lib-i-pictures.js and the
 * picture block, whiteboard-lib-e-block-image.js).
 * Guards: an upload this page sent whose block could not be put on the board is removed again (and only then); each
 * picture spends one of the server's counted upload calls (the put), not two; the picture block keeps only an upload id
 * the server could have made, a short one-line description and a sane size; its box goes back together on an undo. It
 * runs the module's own libs (lib-a, lib-e-*, lib-g, lib-i) in one scope as the page has them, with a fake host. No
 * network, no sleeps.
 * Usage: node modules/whiteboard/test/check-whiteboard-pictures.mjs [path to the module's src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
const NAMES = ['blockTypes', 'tools', 'wbClean', 'createPictures', 'wbSniffType', 'createHistory', 'wbApplyChanges'];

let passed = 0;
const fails = [];
const check = (ok, what) => { if (ok) passed += 1; else fails.push(what); };

let lib = {};
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-[a-z]-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  const grab = NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  lib = new Function('window', 'document', `${parts.join('\n')}\nreturn { ${grab} };`)({ devicePixelRatio: 1 }, undefined);
} catch (err) {
  fails.push(`the libs do not load: ${err.message}`);
}
const need = (...names) => { const missing = names.filter((n) => typeof lib[n] === 'undefined'); if (missing.length) throw new Error(`the lib has no ${missing.join(', ')}`); };
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => { setImmediate(r); }); };

const UP = 'a'.repeat(24);
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0];
// A file as the browser gives one: a name, a type and bytes (slice -> arrayBuffer).
const fileOf = (name, type, bytes) => {
  const all = new Uint8Array(bytes);
  return { name, type, size: all.length, slice: (a = 0, b = all.length) => ({ arrayBuffer: async () => all.slice(a, b).buffer }) };
};

// A fake host: what each uploads call was, and the counted ones (the server counts put and inspect, not thumb).
function fakeHost() {
  const calls = [];
  let n = 0;
  const host = {
    calls,
    counted: () => calls.filter((c) => c[0] === 'put' || c[0] === 'inspect').length,
    uploads: {
      put: async (blob, o) => { calls.push(['put', o && o.name]); n += 1; return { id: String(n).padStart(24, '0').replace(/^0/, 'b'), name: o && o.name }; },
      inspect: async () => { calls.push(['inspect']); return {}; },
      thumb: async (id) => { calls.push(['thumb', id]); return {}; },
      remove: async (id) => { calls.push(['remove', id]); return {}; },
    },
  };
  return host;
}
// The queue with a prepare that only says what it was asked (the browser's resize is not here).
function queue(host, opts = {}) {
  need('createPictures');
  const prepared = [];
  let ids = 0;
  const q = lib.createPictures({
    host,
    newId: () => `p${(ids += 1)}`,
    prepare: async (file, type) => { prepared.push(type); return { main: { type }, thumb: { type: 'image/webp' }, width: 800, height: 600 }; },
    wait: async () => {},
    ...opts,
  });
  return { q, prepared };
}

const cases = {
  async 'an upload whose block could not be put on the board is removed again'() {
    const host = fakeHost();
    const placed = [];
    const { q } = queue(host, { onPlaced: (job, file) => { placed.push(file.id); return false; } });
    q.add([fileOf('a.png', 'image/png', PNG)], { x: 0, y: 0 });
    await settle();
    const removed = host.calls.filter((c) => c[0] === 'remove').map((c) => c[1]);
    check(placed.length === 1 && JSON.stringify(removed) === JSON.stringify(placed), `onPlaced -> false: the upload is removed (placed ${JSON.stringify(placed)}, removed ${JSON.stringify(removed)})`);
    check(!q.mine(placed[0]), 'and it is no longer counted as this page\'s');
  },
  async 'an upload whose block could not be placed but that another block uses stays'() {
    const host = fakeHost();
    const { q } = queue(host, { onPlaced: () => false, inUse: () => true });
    q.add([fileOf('a.png', 'image/png', PNG)], { x: 0, y: 0 });
    await settle();
    check(!host.calls.some((c) => c[0] === 'remove'), 'onPlaced -> false, but a block uses the upload: not removed');
  },
  async 'an upload whose block was placed stays'() {
    for (const answer of [true, undefined]) {
      const host = fakeHost();
      const { q } = queue(host, { onPlaced: () => answer });
      q.add([fileOf('a.png', 'image/png', PNG), fileOf('b.png', 'image/png', PNG)], { x: 0, y: 0 });
      await settle();
      check(!host.calls.some((c) => c[0] === 'remove'), `onPlaced -> ${answer}: no upload removed`);
    }
  },
  async 'each picture spends one counted upload call'() {
    const host = fakeHost();
    const { q } = queue(host, { onPlaced: () => true });
    q.add([fileOf('a.png', 'image/png', PNG), fileOf('b.jpg', 'image/jpeg', JPEG), fileOf('c.webp', 'image/webp', WEBP)], { x: 0, y: 0 });
    await settle();
    check(host.counted() === 3, `three pictures: three counted calls (got ${host.counted()}: ${JSON.stringify(host.calls.map((c) => c[0]))})`);
    check(!host.calls.some((c) => c[0] === 'inspect'), 'the server is not asked what a picture is');
  },
  async 'a picture\'s true type comes from its first bytes'() {
    need('wbSniffType');
    const t = lib.wbSniffType;
    check(t(new Uint8Array(PNG)) === 'image/png' && t(new Uint8Array(JPEG)) === 'image/jpeg' && t(new Uint8Array(WEBP)) === 'image/webp' && t(new Uint8Array(GIF)) === 'image/gif', 'PNG, JPEG, WebP and GIF are known by their first bytes');
    check(t(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20])) === null && t(new Uint8Array([1, 2, 3])) === null && t(new Uint8Array(0)) === null && t(null) === null, 'anything else (a RIFF that is not WebP, a few bytes, none) is none of them');
    const host = fakeHost();
    const { q, prepared } = queue(host, { onPlaced: () => true });
    q.add([fileOf('wrong.png', 'image/png', JPEG), fileOf('anim.png', 'image/png', GIF), fileOf('odd.webp', 'image/webp', [1, 2, 3, 4])], { x: 0, y: 0 });
    await settle();
    check(JSON.stringify(prepared) === JSON.stringify(['image/jpeg', 'image/gif', 'image/webp']), `the bytes win over the name; no known bytes: the name's type (got ${JSON.stringify(prepared)})`);
  },
  async 'the picture block keeps only an upload id the server could have made'() {
    need('wbClean');
    const pic = (upload) => lib.wbClean({ id: 'p', type: 'image', x: 0, y: 0, w: 100, h: 80, upload });
    check(pic(UP) && pic(UP).upload === UP && pic('0123456789abcdef01234567'), 'a 24-character lower-case hex id is kept');
    const bad = { 'upper case': 'A'.repeat(24), 'mixed case': `${'a'.repeat(23)}F`, '23 long': 'a'.repeat(23), '25 long': 'a'.repeat(25), 'not hex': 'g'.repeat(24), 'a path': '../../../../etc/passwd', 'a path of 24': `../${'a'.repeat(21)}`, 'with a newline': `${'a'.repeat(24)}\n`, empty: '', null: null, missing: undefined, number: 123456789012345678901234, array: [UP], object: { id: UP }, boolean: true };
    for (const [what, upload] of Object.entries(bad)) check(pic(upload) === null, `an upload id that is ${what}: no block`);
  },
  async 'the picture block: description one line, at most 300 characters; size inside the limits'() {
    need('wbClean');
    const pic = (f) => lib.wbClean({ id: 'p', type: 'image', x: 0, y: 0, w: 100, h: 80, upload: UP, ...f });
    check(pic({ alt: 'a\r\nharbour\tat dusk' }).alt === 'a harbour at dusk', 'line breaks and tabs in the description become spaces');
    check(pic({ alt: 'x'.repeat(301) }).alt.length === 300 && pic({ alt: 'x'.repeat(300) }).alt.length === 300 && pic({ alt: 'y'.repeat(5000) }).alt === 'y'.repeat(300), 'the description is cut at 300 characters');
    check(pic({ alt: 42 }).alt === '' && pic({ alt: null }).alt === '' && pic({ alt: ['x'] }).alt === '', 'a description that is not words is none');
    const small = pic({ w: 3, h: -50 });
    check(small.w === 24 && small.h === 24, `too small: at least 24 by 24 (got ${small.w} by ${small.h})`);
    const big = pic({ w: 4000, h: 3999.96 });
    check(big.w === 4000 && big.h === 4000, `the largest size is kept, rounded (got ${big.w} by ${big.h})`);
    const odd = pic({ w: 4001, h: 'tall' });
    check(odd.w === 320 && odd.h === 240, `past the largest size, or not a number: the usual 320 by 240 (got ${odd.w} by ${odd.h})`);
    const nan = pic({ w: NaN, h: Infinity });
    check(nan.w === 320 && nan.h === 240, 'NaN and Infinity: the usual size');
    check(pic({ w: 100.26 }).w === 100.3, 'rounded to one decimal');
  },
  async 'a picture\'s corner keeps its shape, without Shift and with Snap to grid on'() {
    need('tools', 'wbClean');
    const select = lib.tools.get('select');
    const run = (type, extra, handle, mx, my) => {
      const start = lib.wbClean({ id: 'p', type, x: 100, y: 100, w: 200, h: 100, ...extra });
      const changes = [];
      const ctx = {
        policy: { canChange: () => true },
        selected: () => 'p',
        get: () => start,
        hold() {},
        scale: () => 1,
        snapping: () => true,
        change: (id, patch) => changes.push(patch),
        select() {}, isSelected: () => true, selection: () => ['p'], many: () => false,
        element: () => null, // the block's element on the page (a table measures its rows from it); none here
      };
      const ev = { shiftKey: false };
      select.down({ x: 0, y: 0, sx: 0, sy: 0, id: 'p', handle, pointerType: 'mouse', event: ev }, ctx);
      select.move({ x: 0, y: 0, sx: mx, sy: my, id: 'p', handle, pointerType: 'mouse', event: ev }, ctx);
      const out = changes[changes.length - 1];
      if (select.cancel) select.cancel(ctx); // let go of the tool's hold (it puts the block back: not looked at)
      return out;
    };
    for (const [handle, mx, my] of [['se', 90, 7], ['nw', -13, 60], ['ne', 50, 50], ['sw', -300, 2]]) {
      const c = run('image', { upload: UP }, handle, mx, my);
      check(c && Math.abs(c.w / c.h - 2) < 1e-9, `picture, corner ${handle} dragged ${mx},${my}: still 2 to 1 (got ${c && `${c.w} by ${c.h}`})`);
    }
    const tiny = run('image', { upload: UP }, 'se', -500, -500);
    check(tiny && tiny.h >= 24 && Math.abs(tiny.w / tiny.h - 2) < 1e-9, `picture made as small as it goes: at least 24 high, still 2 to 1 (got ${tiny && `${tiny.w} by ${tiny.h}`})`);
    const r = run('rect', {}, 'se', 90, 7);
    check(r && Math.abs(r.w / r.h - 2) > 0.1, `a rectangle's corner without Shift does not keep its shape (the check can tell; got ${r && `${r.w} by ${r.h}`})`);
  },
};

for (const [name, run] of Object.entries(cases)) {
  try { await run(); } catch (err) { fails.push(`${name}: ${err.message}`); }
}
if (fails.length) {
  for (const f of fails) console.error(`FAIL ${f}`);
  console.error(`check-whiteboard-pictures: ${fails.length} failed, ${passed} passed (${path.relative(root, src)})`);
  process.exit(1);
}
console.log(`check-whiteboard-pictures: OK, ${passed} cases`);
