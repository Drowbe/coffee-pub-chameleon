#!/usr/bin/env node
/*
 * check-brand-mark.mjs -- the product's mark and icons are the brand kit's, under names of their kind, and nothing served
 * still points at the old Coffee Pub logos (documentation/plans/plan-rename-chameleon.md, step 4; GitHub #426 and #299).
 *
 * The old logos spelled the old product name inside the picture, where check-names cannot read it, so this check holds
 * them out by their file names instead:
 *   - the old files (brandmark-*, logo-light, logo-dark, the product pages' mark.webp) are gone from public/assets/images/brand;
 *   - no text file under server/, public/, modules/, templates/ or the Dockerfile names them;
 *   - the brand folder's own file names say what kind of file they are, never a product's name (CLAUDE.md, Names);
 *   - the new set is there: mark.svg and mark-dark.svg (56 x 56, the kit's colours), favicon.svg and favicon.ico,
 *     icon.svg, icon-192.png, icon-512.png and apple-touch-icon.png at their sizes;
 *   - the server's default site icon, /favicon.ico and the web app manifest use them, and the pages' mark and the host
 *     console's lockup come from brand.js.
 * The word itself (the old product names in text) is check-names' job, with its allow-list.
 *
 * Self-test: a planted tree with an old file name in a page fails; the same tree with the new names passes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = 'public/assets/images/brand';
const TARGETS = ['server', 'public', 'modules', 'templates', 'Dockerfile'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'pdfjs']);
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|zip|pmtiles|mp3|mp4|pdf)$/i;
// The old logos' file names, as a page or the server would name them.
const OLD_NAMES = [/brandmark-(?:color|white)\b/i, /\blogo-(?:light|dark)\.png\b/i, /brand\/landing\/mark\.webp\b/i];
const OLD_FILES = ['brandmark-color.png', 'brandmark-white.png', 'logo-light.png', 'logo-dark.png', 'landing/mark.webp'];
// A file in the brand folder is named by its kind: no product's or the brand's name in it. The words are written in
// pieces so this file does not hold the past product names check-names looks for.
const PRODUCT_WORDS = new RegExp(['coffee', 'pub', 'chameleon', ['colla', 'borator'].join(''), ['mag', 'pie'].join(''), ['tav', 'ern'].join(''), 'showrunner', 'studio'].join('|'), 'i');
const PNG_SIZES = { 'icon-192.png': 192, 'icon-512.png': 512, 'apple-touch-icon.png': 180 };
const MARK_COLOURS = { 'mark.svg': ['#0B7A84', '#F26B52', '#14243B'], 'mark-dark.svg': ['#5CC8CF', '#FF8264', '#F4ECDD'] };
const NEEDED = ['mark.svg', 'mark-dark.svg', 'favicon.svg', 'favicon.ico', 'icon.svg', ...Object.keys(PNG_SIZES)];

function walk(root, rel, out) {
  const abs = path.join(root, rel);
  let st;
  try { st = fs.statSync(abs); } catch { return; }
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(abs)) if (!SKIP_DIRS.has(name)) walk(root, path.posix.join(rel, name), out);
  } else if (st.isFile() && !BINARY.test(rel)) out.push(rel);
}

const read = (root, rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } };

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

export function problemsOf(root, { full = true } = {}) {
  const problems = [];
  const files = [];
  for (const t of TARGETS) walk(root, t, files);
  for (const rel of files) {
    const lines = read(root, rel).split('\n');
    lines.forEach((line, i) => {
      for (const re of OLD_NAMES) if (re.test(line)) problems.push(`${rel}:${i + 1} names an old logo file (${line.match(re)[0]}); use mark.svg / mark-dark.svg or the icons in ${BRAND}`);
    });
  }
  for (const f of OLD_FILES) if (fs.existsSync(path.join(root, BRAND, f))) problems.push(`${BRAND}/${f} is an old logo: remove it`);
  const brandDir = path.join(root, BRAND);
  for (const name of fs.existsSync(brandDir) ? fs.readdirSync(brandDir) : []) {
    if (PRODUCT_WORDS.test(name)) problems.push(`${BRAND}/${name}: name the file by its kind (mark.svg, icon-192.png), not after a product`);
  }
  for (const name of NEEDED) if (!fs.existsSync(path.join(brandDir, name))) problems.push(`${BRAND}/${name} is missing`);
  for (const [name, size] of Object.entries(PNG_SIZES)) {
    const file = path.join(brandDir, name);
    if (!fs.existsSync(file)) continue;
    const got = pngSize(file);
    if (!got || got[0] !== size || got[1] !== size) problems.push(`${BRAND}/${name} should be a ${size} x ${size} PNG, is ${got ? got.join(' x ') : 'not a PNG'}`);
  }
  for (const [name, colours] of Object.entries(MARK_COLOURS)) {
    const svg = read(root, `${BRAND}/${name}`);
    if (svg === null) continue;
    if (!/viewBox="0 0 56 56"/.test(svg)) problems.push(`${BRAND}/${name}: the kit's mark is 56 x 56 units`);
    for (const c of colours) if (!svg.includes(c)) problems.push(`${BRAND}/${name}: missing the kit's ${c}`);
    if (PRODUCT_WORDS.test(svg)) problems.push(`${BRAND}/${name}: carries a product's name; the page gives the name`);
  }
  if (!full) return problems;
  const server = read(root, 'server/index.js') || '';
  if (!/'favicon\.ico' : 'favicon\.svg'/.test(server)) problems.push('server/index.js: the default site icon is favicon.svg and /favicon.ico is favicon.ico');
  for (const icon of ['icon-192.png', 'icon-512.png', 'icon.svg']) {
    if (!server.includes(`/assets/images/brand/${icon}`)) problems.push(`server/index.js: the web app manifest does not list ${icon}`);
  }
  const brandJs = read(root, 'public/brand.js') || '';
  for (const src of ['/assets/images/brand/mark.svg', '/assets/images/brand/mark-dark.svg', '/assets/images/brand/apple-touch-icon.png']) {
    if (!brandJs.includes(src)) problems.push(`public/brand.js: ${src} is not used`);
  }
  if (!/replaceChildren\(productLockup\(/.test(read(root, 'public/host.js') || '')) problems.push('public/host.js: the host console bar shows productLockup()');
  for (const page of ['landing.html', 'travel.html', 'games.html']) {
    const html = read(root, `public/${page}`);
    if (html && !(html.includes('/assets/images/brand/mark.svg') && html.includes('/assets/images/brand/mark-dark.svg'))) problems.push(`public/${page}: the bar's mark is mark.svg on light and mark-dark.svg on dark`);
  }
  return problems;
}

function selfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-mark-'));
  try {
    const brand = path.join(dir, BRAND);
    fs.mkdirSync(brand, { recursive: true });
    for (const name of NEEDED) fs.copyFileSync(path.join(ROOT, BRAND, name), path.join(brand, name));
    fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'public', 'page.html'), '<img src="/assets/images/brand/mark.svg">\n');
    assert.deepEqual(problemsOf(dir, { full: false }), [], 'the new set passes');
    fs.writeFileSync(path.join(dir, 'public', 'page.html'), '<img src="/assets/images/brand/logo-light.png">\n');
    assert.ok(problemsOf(dir, { full: false }).some((p) => /page\.html:1 names an old logo file/.test(p)), 'an old name in a page fails');
    fs.writeFileSync(path.join(dir, 'public', 'page.html'), '\n');
    fs.writeFileSync(path.join(brand, 'brandmark-color.png'), 'x');
    assert.ok(problemsOf(dir, { full: false }).some((p) => /brandmark-color\.png is an old logo/.test(p)), 'an old file fails');
    fs.rmSync(path.join(brand, 'brandmark-color.png'));
    fs.copyFileSync(path.join(brand, 'mark.svg'), path.join(brand, 'chameleon-mark.svg'));
    assert.ok(problemsOf(dir, { full: false }).some((p) => /chameleon-mark\.svg: name the file by its kind/.test(p)), 'a product in a file name fails');
    fs.rmSync(path.join(brand, 'chameleon-mark.svg'));
    fs.copyFileSync(path.join(brand, 'icon-192.png'), path.join(brand, 'icon-512.png'));
    assert.ok(problemsOf(dir, { full: false }).some((p) => /icon-512\.png should be a 512 x 512 PNG/.test(p)), 'a wrong size fails');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

selfTest();
const problems = problemsOf(ROOT);
if (problems.length) {
  console.error(`check-brand-mark: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('check-brand-mark: OK (the kit\'s mark and icons, named by kind; no old logo file or name served)');
