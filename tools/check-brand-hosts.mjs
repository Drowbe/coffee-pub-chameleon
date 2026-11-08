#!/usr/bin/env node
/*
 * check-brand-hosts.mjs -- no Coffee Pub domain or real deployment host in the code a stand-alone buyer installs
 * (documentation/plans/plan-domains.md, step 5 and "tools/check-names.mjs").
 *
 * Searched: server/, public/, modules/, templates/, tools/, .github/, the Dockerfile, docker-compose.yml and package.json.
 * Not searched: documentation/ (plans and guides may name the install), this check and its allow-list.
 * Looked for: the brand's domains (the brand name, then any more letters, then a top-level domain, any case, so the
 * studio's domains and a subdomain of any of them count too, without this check naming them) and the host label of
 * the real deployment. Use example.com or localhost in examples and tests.
 *
 * tools/check-brand-hosts-allow.json: [{ file, pattern, count, reason }]. `file` is a path from the repository's
 * root; `pattern` is a regular expression tested against the matched text; `count` is how many hits it may allow in
 * that file. The count may only fall: more hits than `count` fail, and so does an entry that allows more than it
 * finds (lower it or delete it). An entry without a reason fails.
 *
 * Self-test: a planted file with each form fails (the brand plus a top-level domain, the brand plus more letters plus
 * one, the deployment label); one with a brand-free host and the brand name alone ("Coffee Pub")
 * passes; an allow-list entry lets exactly its count and no more.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Written in pieces so this file does not hold what it looks for.
const BRAND = ['coffee', 'pub'].join('');
const DEPLOYMENT = ['the', 'pub'].join('');
const PATTERNS = [new RegExp(`${BRAND}[a-z]*\\.[a-z]{2,}`, 'gi'), new RegExp(`\\b${DEPLOYMENT}\\b`, 'gi')];
const TARGETS = ['server', 'public', 'modules', 'templates', 'tools', '.github', 'Dockerfile', 'docker-compose.yml', 'package.json'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.wiki-build']);
const SKIP_FILES = new Set(['tools/check-brand-hosts.mjs', 'tools/check-brand-hosts-allow.json']);
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|zip|pmtiles|mp3|mp4|pdf)$/i;

function walk(root, rel, out) {
  const abs = path.join(root, rel);
  let st;
  try { st = fs.statSync(abs); } catch { return; }
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(abs)) if (!SKIP_DIRS.has(name)) walk(root, path.posix.join(rel, name), out);
  } else if (st.isFile() && !SKIP_FILES.has(rel) && !BINARY.test(rel)) out.push(rel);
}

function scan(root) {
  const files = [];
  for (const t of TARGETS) walk(root, t, files);
  const hits = [];
  for (const rel of files) {
    const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const re of PATTERNS) for (const m of line.matchAll(re)) hits.push({ file: rel, line: i + 1, text: m[0] });
    });
  }
  return hits;
}

// Returns the problems: hits no entry allows, entries without a reason, and entries that allow more than they find.
function judge(hits, allow) {
  const problems = [];
  allow.forEach((e, i) => {
    if (!e || !e.file || !e.pattern || !Number.isInteger(e.count) || e.count < 1 || !String(e.reason || '').trim()) {
      problems.push(`allow-list entry ${i + 1} needs file, pattern, count (1 or more) and a reason`);
    }
  });
  if (problems.length) return problems;
  const used = allow.map(() => 0);
  for (const h of hits) {
    const k = allow.findIndex((e, i) => e.file === h.file && new RegExp(e.pattern, 'i').test(h.text) && used[i] < e.count);
    if (k === -1) problems.push(`${h.file}:${h.line}  "${h.text}"  (use a setting, or example.com or localhost)`);
    else used[k] += 1;
  }
  allow.forEach((e, i) => {
    if (used[i] < e.count) problems.push(`allow-list entry for ${e.file} (${e.pattern}) allows ${e.count} but finds ${used[i]}; lower the count or delete it`);
  });
  return problems;
}

function selfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-hosts-'));
  try {
    fs.mkdirSync(path.join(dir, 'server'));
    const file = path.join(dir, 'server', 'x.js');
    const planted = (s) => { fs.writeFileSync(file, s); return scan(dir); };
    assert.equal(planted(`const a = 'https://x.${BRAND}.ai';`).length, 1, 'a brand domain must be found');
    assert.equal(planted(`const a = 'SUB.${BRAND.toUpperCase()}.LIVE';`).length, 1, 'any case must be found');
    assert.equal(planted(`const a = 'https://x.${BRAND}studio.live';`).length, 1, 'the brand followed by more letters and a top-level domain must be found');
    assert.equal(planted(`const a = '${BRAND}studio.com/products';`).length, 1, 'the brand followed by more letters must be found under any top-level domain');
    assert.equal(planted(`// ${DEPLOYMENT}`).length, 1, 'the deployment label must be found');
    assert.equal(planted(`const a = 'example.com'; // Coffee Pub, coffee-pub`).length, 0, 'the brand name alone passes');
    assert.equal(planted(`// ${BRAND}studio, with no top-level domain`).length, 0, 'the brand and more letters without a domain pass');
    const two = planted(`'${BRAND}.ai'\n'${BRAND}.live'`);
    assert.equal(two.length, 2);
    assert.equal(judge(two, []).length, 2, 'no allow-list: fails');
    const entry = { file: 'server/x.js', pattern: BRAND, count: 2, reason: 'test' };
    assert.deepEqual(judge(two, [entry]), [], 'the allow-list passes its own count');
    assert.equal(judge(two, [{ ...entry, count: 1 }]).length, 1, 'one over the count fails');
    assert.equal(judge(two.slice(0, 1), [entry]).length, 1, 'counts may only fall: an unused allowance fails');
    assert.equal(judge(two, [{ ...entry, reason: '' }]).length, 1, 'no reason fails');
    assert.equal(judge(two, [{ ...entry, file: 'server/y.js' }]).length, 3, 'another file is not allowed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

selfTest();
const allow = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'check-brand-hosts-allow.json'), 'utf8'));
const hits = scan(ROOT);
const problems = judge(hits, allow);
if (problems.length) {
  console.error(`check-brand-hosts: FAIL\n${problems.map((p) => '  ' + p).join('\n')}`);
  process.exit(1);
}
console.log(`check-brand-hosts: ok (${hits.length} hits, all allowed; self-test passed)`);
