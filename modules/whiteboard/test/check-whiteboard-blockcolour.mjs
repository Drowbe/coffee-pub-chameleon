#!/usr/bin/env node
/*
 * check-whiteboard-blockcolour.mjs -- block colours in the board background's groups (#544): fills, borders, words and lines
 * take Light and Dark colours (fixed, the same in both modes) beside the Tinted ones.
 * Guards: a block's clean keeps a fixed id for every colour role and still drops an unknown one; the labels are the
 * background's; the tinted ids are unchanged; the menu model's order (own rows, Light, Dark, Tinted, Custom); the words on
 * every fixed fill read at 4.5:1 with the ink the stylesheet gives its family.
 * Usage: node modules/whiteboard/test/check-whiteboard-blockcolour.mjs [path to the module's src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
const NAMES = ['WB_PALETTE', 'WB_FIXED_BACKGROUNDS', 'WB_FIXED_BY_ID', 'wbColourMenuModel', 'wbContrast', 'wb', 'wbClean', 'blockTypes'];
let passed = 0;
const fails = [];
const check = (ok, what) => { if (ok) passed += 1; else fails.push(what); };

let lib = {};
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-(a|e)-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  const grab = NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  lib = new Function(`${parts.join('\n')}\nreturn { ${grab} };`)();
} catch (err) { fails.push(`the libs do not load: ${err.message}`); }
const missing = NAMES.filter((n) => typeof lib[n] === 'undefined');
if (missing.length) fails.push(`the libs have no ${missing.join(', ')}`);

function main() {
  const css = fs.readFileSync(path.join(src, 'whiteboard.css'), 'utf8');
  const hexOf = (name) => { const m = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css); return m ? m[1] : null; };
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  // paint: a fixed id is a colour for the role, an unknown one still falls back, a tinted one is unchanged
  for (const f of lib.WB_FIXED_BACKGROUNDS) {
    check(lib.wb.paint(f.id, ['none'], 'ink') === f.id, `${f.id}: kept as a colour`);
    check(/^Pure White|Creme|Light |Black|Slate|Dark |Wine/.test(f.label), `${f.id}: the background's label`);
  }
  for (const c of lib.WB_PALETTE) check(lib.wb.paint(c.id, [], 'x') === c.id, `${c.id}: tinted id unchanged`);
  for (const v of ['light-', 'dark-red', 'Light-white', '#fff', '', null, 5]) check(lib.wb.paint(v, ['none'], 'ink') === 'ink', `${JSON.stringify(v)}: unknown falls back`);
  check(lib.wb.paint('none', ['none'], 'ink') === 'none', 'an extra choice is kept');
  // the blocks' own clean, per type that has a colour role
  const types = ['note', 'text', 'rect', 'table', 'frame'].filter((t) => lib.blockTypes.get && lib.blockTypes.get(t));
  check(types.length >= 4, 'the block types are there');
  for (const t of types) {
    const def = lib.blockTypes.get(t);
    for (const role of Object.keys(def.paint || {})) {
      const base = def.create();
      const out = lib.wbClean({ ...base, id: 'a', type: t, x: 0, y: 0, [role]: 'dark-slate' });
      if (out) check(out[role] === 'dark-slate', `${t}.${role}: a fixed id is kept by the clean`);
      const bad = lib.wbClean({ ...base, id: 'a', type: t, x: 0, y: 0, [role]: 'dark-nope' });
      if (bad) check(bad[role] !== 'dark-nope', `${t}.${role}: an unknown id falls back`);
    }
  }
  // the menu model: own rows, Light, Dark, Tinted, Custom
  const m = lib.wbColourMenuModel(['a', 'b']);
  const shape = m.map((e) => (e.kind === 'heading' ? `#${e.label}` : e.kind));
  const heads = shape.filter((s) => s.startsWith('#'));
  check(shape[0] === 'special' && shape[1] === 'special' && m[0].row === 'a', 'the role\'s own rows come first');
  check(heads.join('|') === '#Light colours|#Dark colours|#Tinted colours', 'the headings, in order');
  check(shape.at(-1) === 'custom' && m.at(-1).label === 'Custom colour (coming with the colour picker)', 'the Custom row is last');
  check(m.filter((e) => e.kind === 'fixed').map((e) => e.id).join() === lib.WB_FIXED_BACKGROUNDS.map((f) => f.id).join(), 'the fixed rows are the background list, in its order');
  check(m.filter((e) => e.kind === 'tint').map((e) => e.id).join() === lib.WB_PALETTE.map((c) => c.id).join(), 'the tinted rows are today\'s palette');
  check(lib.wbColourMenuModel().length === m.length - 2, 'no own rows, no extras');
  // automatic contrast: the family's ink on every fixed fill
  for (const f of lib.WB_FIXED_BACKGROUNDS) {
    const fill = hexOf(f.css);
    const ink = hexOf(f.family === 'light' ? '--wb-fixed-ink-light' : '--wb-fixed-ink-dark');
    check(Boolean(fill && ink) && lib.wbContrast(rgb(fill), rgb(ink)) >= 4.5, `${f.id}: words read at 4.5:1 on it`);
  }
  check(/\.wb-block\[data-fixed-fill="light"\][^}]*--text-primary: var\(--wb-fixed-ink-light\)/.test(css) && /\.wb-block\[data-fixed-fill="dark"\][^}]*--text-primary: var\(--wb-fixed-ink-dark\)/.test(css), 'the stylesheet gives each family its ink');
}
if (!fails.length) { try { main(); } catch (err) { fails.push(err.stack || err.message); } }
if (fails.length) {
  console.error(`check-whiteboard-blockcolour: ${fails.length} failed, ${passed} passed`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-whiteboard-blockcolour: ${passed} passed`);
