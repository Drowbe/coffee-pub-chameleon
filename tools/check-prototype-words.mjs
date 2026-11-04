#!/usr/bin/env node
/*
 * check-prototype-words.mjs -- the Prototype's Vault never uses the old word for how much capacity is left (CLAUDE.md, Names; plan
 * sentence "This trip's Vault is full"). Reads public/design-system/prototype-vault*.js and fails on the ways it was said ("no X",
 * "X left", "the X", "make X", "X for"). The word is built from pieces below so this file does not itself use it. A real one
 * (a hotel one, a double one) is fine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'public', 'design-system');
const W = ['ro', 'om'].join('');
const CAPACITY = new RegExp(`\\b(no ${W}|${W} left|${W} remaining|the ${W}\\b|make ${W}|${W} for|enough ${W}|more ${W})`, 'i');
let n = 0;
const bad = [];
for (const f of fs.readdirSync(DIR).filter((x) => /^prototype-vault.*\.js$/.test(x)).sort()) {
  fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').forEach((line, i) => {
    n += 1;
    if (CAPACITY.test(line)) bad.push(`public/design-system/${f}:${i + 1}: the old word for capacity; say "Full", "This trip's Vault is full" or "what is left"`);
  });
}
if (bad.length) { console.error(`check-prototype-words: ${bad.join('\n')}`); process.exit(1); }
console.log(`check-prototype-words: ok (${n} lines read)`);
