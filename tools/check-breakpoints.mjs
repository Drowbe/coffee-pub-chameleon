#!/usr/bin/env node
// Drift guard: the product answers to three widths (documentation/plans/plan-design-system.md, (e)).
// A media query on width, (max-width: Npx) or (min-width: Npx), must use 640, 641, 900, 901, 1200 or 1201 (the "plus one"
// forms are the other side of the same line). Any other width is an offender. A container query (@container) is
// allowed at any width, because a module answers to its own width, not the window's. A width in em or rem is read as
// pixels at 16px to the em. It reads @media in the CSS files and in the CSS and window.matchMedia(...) strings inside the
// .js files of public and modules/*/src; not public/design-system or MapLibre.
//
// No page has a palette of its own: the start page too answers to these widths. @font-face blocks are not read.
// Today's strays are recorded per file and width in tools/check-breakpoints-allow.json. The check passes while no
// count is higher, fails on a higher count or a new file or width, and says when a count has dropped.
//   node tools/check-breakpoints.mjs                 the check
//   node tools/check-breakpoints.mjs --update        lower the allow-list to today's counts (never raises)
//   node tools/check-breakpoints.mjs --update --force-raise   also allow raising (how it was first made)
import { collectFiles, clean, lineOf, Tally, runRatchet, summary } from './lib/drift.mjs';

const OK = new Set([640, 641, 900, 901, 1200, 1201]);
const tally = new Tally();
const files = collectFiles();
for (const file of files) {
  const text = clean(file.text, file.kind);
  // A media query's text: from @media (or matchMedia('...')) to its opening brace or closing quote.
  const queries = [
    ...[...text.matchAll(/@media\b([^{;]*)/g)].map((m) => ({ at: m.index, q: m[1] })),
    ...[...text.matchAll(/matchMedia\(\s*(['"`])([^'"`]*)\1/g)].map((m) => ({ at: m.index, q: m[2] })),
  ];
  for (const { at, q } of queries) {
    for (const m of q.matchAll(/\(\s*(?:max|min)-width\s*:\s*(\d*\.?\d+)(px|em|rem)\s*\)/g)) {
      const width = Math.round(Number(m[1]) * (m[2] === 'px' ? 1 : 16));
      if (!OK.has(width)) tally.add(file.rel, `${width}px`, lineOf(text, at));
    }
    // The range form: (width <= 600px), (width > 900px)
    for (const m of q.matchAll(/\bwidth\s*[<>]=?\s*(\d*\.?\d+)(px|em|rem)/g)) {
      const width = Math.round(Number(m[1]) * (m[2] === 'px' ? 1 : 16));
      if (!OK.has(width)) tally.add(file.rel, `${width}px`, lineOf(text, at));
    }
  }
}

runRatchet({
  name: 'check-breakpoints',
  allowFile: 'check-breakpoints-allow.json',
  about: 'check-breakpoints: today\'s media-query widths other than 640 641 900 901 1200 1201 px, per file. Counts may only fall; lower them with: node tools/check-breakpoints.mjs --update',
  tally,
  unit: 'off-list media-query widths',
  extraReport: [...summary(tally, 'width')],
});
