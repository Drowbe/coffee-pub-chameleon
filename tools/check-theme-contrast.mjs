#!/usr/bin/env node
// Drift guard: the shipped themes stay readable (documentation/plans/plan-design-system.md, (e), and step 8).
// For each shipped theme (Strong Coffee, the built-in default in server/store.js DEFAULT_THEME, and the built-ins
// Calming Teal and Burnt Orange from BUILTIN_THEMES) and each mode (light, dark) it works out the WCAG 2 contrast
// ratio of the pairs people read, from the theme's own colours and the colours the server picks for it at render
// (public/theme-colour.js, the same code /theme.css and the theme editor use), and prints them all:
//   text-primary, text-muted      on the page, a panel, a card, a field and a menu (the derived surfaces are system.css's formulas)
//   the accent as text            the picked text-accent, on the page and a panel
//   text on the accent            the colour /theme.css writes (the theme's own while it reaches 4.5, else the pick)
//   text on each status fill      white or near-black, picked
//   each status colour as text    on the page and a panel
//   selected text                 text-selected (accent 55% mixed into text) on the selected fill (accent at 28%) over a panel and the page
//   marks (need 3)                the accent on the page (bars, focus ring), each status fill on the page (the OK green by its
//                                 picked mark), the scrollbar thumb (muted text) on its track
//   border on the page            no minimum, reported only
// Every text pair must reach 4.5 and every mark 3. The ones that do not today are recorded in
// tools/check-theme-contrast-allow.json as the ratio they have now (a floor). The check fails when a pair below its minimum is
// not recorded, or is worse than its recorded ratio, and says when a pair has got better and the record can be tightened.
// It reads the themes; it changes none.
//
//   node tools/check-theme-contrast.mjs                  the check (prints the table)
//   node tools/check-theme-contrast.mjs --update         raise the recorded floors and drop pairs that now pass (never lowers)
//   node tools/check-theme-contrast.mjs --update --force-raise   also record a new or worse pair (how it was first made)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseHex, mix, over, contrast } from './lib/contrast.mjs';

process.env.PRODUCT_NAME ||= 'Testname';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOW = path.join(ROOT, 'tools', 'check-theme-contrast-allow.json');

// BUILTIN_THEMES is not exported by the store, so its source is read and the list evaluated as it stands.
const require = createRequire(import.meta.url);
const { DEFAULT_THEME } = require('../server/store.js');
const TC = require('../public/theme-colour.js');
const src = fs.readFileSync(path.join(ROOT, 'server', 'store.js'), 'utf8');
const block = /const BUILTIN_THEMES = (\[[\s\S]*?\n\]);/.exec(src);
if (!block) throw new Error('check-theme-contrast: BUILTIN_THEMES not found in server/store.js');
const BUILTIN = vm.runInNewContext(block[1]);
const THEMES = [DEFAULT_THEME, ...BUILTIN];

const rows = []; // { id, theme, mode, pair, ratio, need }
for (const theme of THEMES) {
  for (const mode of ['light', 'dark']) {
    const set = theme[mode];
    if (!set) continue;
    const got = TC.resolve(set, mode);
    const c = Object.fromEntries(Object.entries(set).map(([k, v]) => [k, parseHex(v)]));
    const page = c['surface-page'];
    const panel = c['surface-panel'];
    const text = c['text-primary'];
    const add = (pair, fg, bg, need) => rows.push({ id: `${theme.name} / ${mode} / ${pair}`, theme: theme.name, mode, pair, ratio: contrast(fg, bg), need });
    // The derived surfaces, by system.css's formulas.
    const surfaces = [
      ['page', page],
      ['panel', panel],
      ['card', mix(panel, 92, text)],
      ['field', mix(page, 85, c['edge-hairline'])],
      ['menu', mix(panel, 96, text)],
    ];
    for (const [name, bg] of surfaces) {
      add(`text on ${name}`, text, bg, 4.5);
      add(`muted text on ${name}`, c['text-muted'], bg, 4.5);
    }
    // The brand's coral (ink-brand) is for large text only (24px and up), so it needs the 3 to 1 of large text, on the page and on the panel.
    if (c['ink-brand']) for (const [name, bg] of [['page', page], ['panel', panel]]) add(`brand name ink on ${name} (large text, 24px and up)`, c['ink-brand'], bg, 3);
    // What the server picks and the theme editor shows.
    for (const r of got.report) {
      if (r.id === 'text-on-page' || r.id === 'text-on-panel' || r.id === 'muted-on-page' || r.id === 'muted-on-panel') continue; // above
      add(r.label, parseHex(r.fg), parseHex(r.bg), r.kind === 'info' ? 0 : r.min);
    }
    // The selected fill is the accent at 28%; a theme that sets the chosen roles has the wash (wash-ink) at 30% instead, and the text on it is
    // the chosen ink (ink-chosen) mixed 55% into the text colour. (A theme with a wash-ink but no chosen roles is measured as it always was.)
    const own = Boolean(c['fill-chosen']);
    const wash = own ? c['wash-ink'] || c['fill-chosen'] : c['accent-fill'];
    const washPct = own ? 0.3 : 0.28;
    const selInk = mix(c['ink-chosen'] || c['accent-fill'], 55, text);
    add('selected text on selected fill (page)', selInk, over(wash, washPct, page), 4.5);
    add('selected text on selected fill (panel)', selInk, over(wash, washPct, panel), 4.5);
    if (c['fill-chosen']) add('text on the chosen fill', c['text-on-chosen'] || c['text-on-accent'], c['fill-chosen'], 4.5);
    add('scrollbar thumb (muted text) on its track', c['text-muted'], mix(panel, 88, text), 3);
  }
}

const floor = (r) => Math.floor(r * 100) / 100;
const reportOnly = (r) => r.need === 0;
const allowed = fs.existsSync(ALLOW) ? JSON.parse(fs.readFileSync(ALLOW, 'utf8')).floors || {} : {};
const update = process.argv.includes('--update');
const forceRaise = process.argv.includes('--force-raise');

const failing = rows.filter((r) => !reportOnly(r) && r.ratio < r.need);
const fresh = failing.filter((r) => !(r.id in allowed));
const worse = failing.filter((r) => r.id in allowed && r.ratio < allowed[r.id] - 0.005);
const better = Object.keys(allowed).filter((id) => {
  const r = rows.find((x) => x.id === id);
  return !r || r.ratio >= r.need || r.ratio > allowed[id] + 0.01;
});

if (update) {
  if ((fresh.length || worse.length) && !forceRaise) {
    console.error('check-theme-contrast: refusing to update, a pair is new or worse than recorded (a ratchet only improves). Fix the theme, or pass --force-raise to record it on purpose:');
    for (const r of [...fresh, ...worse]) console.error(`  ${r.id}: ${r.ratio.toFixed(2)}`);
    process.exitCode = 1;
  } else {
    const next = Object.fromEntries(failing.sort((a, b) => a.id.localeCompare(b.id)).map((r) => [r.id, floor(r.ratio)]));
    fs.writeFileSync(ALLOW, `${JSON.stringify({ about: 'check-theme-contrast: the pairs of the shipped themes that read below their minimum (4.5 for text, 3 for a mark) today, each with the ratio it has (a floor). A pair may get better, never worse, and no new pair may fall below its minimum. Tighten with: node tools/check-theme-contrast.mjs --update', floors: next }, null, 2)}\n`);
    console.log(`check-theme-contrast: allow-list written, ${Object.keys(next).length} pair(s) recorded`);
  }
} else {
  const w = Math.max(...rows.map((r) => r.id.length));
  console.log(`${'pair'.padEnd(w)}  ratio  need  state`);
  for (const r of rows) {
    const state = reportOnly(r) ? 'report only'
      : r.ratio >= r.need ? 'ok'
        : fresh.includes(r) ? 'FAIL new' : worse.includes(r) ? `FAIL worse than ${allowed[r.id].toFixed(2)}` : `known (${allowed[r.id].toFixed(2)})`;
    console.log(`${r.id.padEnd(w)}  ${r.ratio.toFixed(2).padStart(5)}  ${String(r.need).padStart(4)}  ${state}`);
  }
  if (fresh.length || worse.length) {
    console.error(`check-theme-contrast: FAIL, ${fresh.length} pair(s) fall below their minimum that tools/check-theme-contrast-allow.json does not record, ${worse.length} are worse than recorded. Change the colours (or the formula) so they read better.`);
    process.exitCode = 1;
  } else {
    console.log(`check-theme-contrast: ${rows.length} pairs in ${THEMES.length} themes, ${failing.length} below their minimum and all recorded, none worse`);
    for (const id of better) console.log(`  can tighten: ${id} is now ${rows.find((x) => x.id === id)?.ratio.toFixed(2) ?? 'gone'}, recorded ${allowed[id].toFixed(2)}`);
    if (better.length) console.log('  run: node tools/check-theme-contrast.mjs --update');
  }
}
