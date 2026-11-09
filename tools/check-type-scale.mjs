#!/usr/bin/env node
// Drift guard: type stays on the scale (documentation/plans/plan-design-system.md, (e)).
// A font-size in pixels must be one of 9, 11, 12, 13, 14, 16, 18, 22, 28 or 40 (em, rem, % and var() are not read). A
// font-weight must be 400, 500, 600 or 700 (normal and bold count as 400 and 700; the display face's own weights are not
// told apart yet, so 700 is allowed for everyone for now); 650, 800, 300, 900 and the like are offenders. The `font`
// shorthand is read for both. Line-height and letter-spacing are not checked.
// It reads public/*.css, public/sdk/*.css, modules/*/src/*.css and the CSS inside the .js files of public and
// modules/*/src; not public/design-system or MapLibre.
//
// No page has a palette of its own: the start page too is on the scale. @font-face blocks are not read.
// Today's offenders are recorded per file in tools/check-type-scale-allow.json under keys like "size 15px" and
// "weight 650". The check passes while no count is higher, fails on a higher count or a new file or key, and says when
// a count has dropped.
//   node tools/check-type-scale.mjs                 the check
//   node tools/check-type-scale.mjs --update        lower the allow-list to today's counts (never raises)
//   node tools/check-type-scale.mjs --update --force-raise   also allow raising (how it was first made)
import { collectFiles, declarations, stripCalls, Tally, runRatchet, summary } from './lib/drift.mjs';

const SIZES = new Set([9, 11, 12, 13, 14, 16, 18, 22, 28, 40]);
const WEIGHTS = new Set([400, 500, 600, 700]);
const WORD_WEIGHT = { normal: 400, bold: 700 };
const SIZE_RE = /(?<![\w.$#-])(\d*\.?\d+)px\b/g;

const tally = new Tally();
const size = (file, d, v) => { if (!SIZES.has(Number(v))) tally.add(file.rel, `size ${Number(v)}px`, d.line); };
const weight = (file, d, w) => { if (!WEIGHTS.has(w)) tally.add(file.rel, `weight ${w}`, d.line); };
const files = collectFiles();
for (const file of files) {
  for (const d of declarations(file)) {
    const value = stripCalls(d.value).trim().toLowerCase();
    if (d.prop === 'font-size') {
      for (const m of value.matchAll(SIZE_RE)) size(file, d, m[1]);
    } else if (d.prop === 'font-weight') {
      const t = value.split(/\s+/)[0];
      if (/^\d+$/.test(t)) weight(file, d, Number(t));
      else if (t in WORD_WEIGHT) weight(file, d, WORD_WEIGHT[t]);
      else if (t === 'bolder' || t === 'lighter') tally.add(file.rel, `weight ${t}`, d.line);
    } else if (d.prop === 'font') {
      // [style] [variant] [weight] size[/line-height] family
      const m = /^(?:(?:italic|oblique|normal|small-caps|bold|bolder|lighter|\d{3})\s+)*(\d*\.?\d+)px/.exec(value);
      if (!m) continue;
      size(file, d, m[1]);
      const w = /\b(\d{3}|bold|bolder|lighter)\b/.exec(value.slice(0, m[0].length));
      if (w) weight(file, d, /^\d+$/.test(w[1]) ? Number(w[1]) : (WORD_WEIGHT[w[1]] ?? 0));
    }
  }
}

runRatchet({
  name: 'check-type-scale',
  allowFile: 'check-type-scale-allow.json',
  about: 'check-type-scale: today\'s font sizes (not 9 11 12 13 14 16 18 22 28 40 px) and font weights (not 400 500 600 700), per file. Counts may only fall; lower them with: node tools/check-type-scale.mjs --update',
  tally,
  unit: 'off-scale type values',
  extraReport: [...summary(tally, 'value')],
});
