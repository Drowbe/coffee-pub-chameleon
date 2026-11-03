#!/usr/bin/env node
/*
 * check-prototype-words.mjs -- the Prototype's Vault never says "room" for how much space is left (CLAUDE.md, Names; plan sentence
 * "This trip's Vault is full"). Reads public/design-system/prototype-vault*.js and fails on "no room", "room left", "the room",
 * "make room" and "room for", the ways it was said. A real room (a hotel room, a double room) is fine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'public', 'design-system');
const CAPACITY = /\b(no room|room left|room remaining|the room\b|make room|room for|enough room|more room)/i;
let n = 0;
const bad = [];
for (const f of fs.readdirSync(DIR).filter((x) => /^prototype-vault.*\.js$/.test(x)).sort()) {
  fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').forEach((line, i) => {
    n += 1;
    if (CAPACITY.test(line)) bad.push(`public/design-system/${f}:${i + 1}: "room" for capacity; say "Full", "This trip's Vault is full" or "what is left"`);
  });
}
if (bad.length) { console.error(`check-prototype-words: ${bad.join('\n')}`); process.exit(1); }
console.log(`check-prototype-words: ok (${n} lines read)`);
