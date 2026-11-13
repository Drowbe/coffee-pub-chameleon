#!/usr/bin/env node
/*
 * check-credits.mjs -- the About tab's Open-source software list is complete (#773, #603).
 *
 * The list is public/credits.json, read by the About tab of the Manage page (public/admin.js, showCredits()). This check fails when
 *   - a runtime dependency in package.json has no entry (by name);
 *   - a row of any module's THIRD-PARTY.md table (a vendored library) has no entry (by name, or by the file it vendors);
 *   - a font, a model or a map-glyph file under public/, or the pdf.js folder, is not under any entry's "covers";
 *   - an image file in public/assets/images/backgrounds/ is not under any entry's "covers", or is missing from that folder's CREDITS.md;
 *   - an entry has no name, use, group, licence (an SPDX id), link (https) or licence file, or its licence file is not in the repository
 *     (an entry of kind "own", our own artwork, needs a name, use, group, covers and the notice "Made by Coffee Pub" instead, and no licence);
 *   - an entry's licence is GPL, AGPL or LGPL, or a licence that asks for a notice (MIT, BSD, ISC, OFL, CC BY, ODbL) has an empty notice;
 *   - an entry for an installed package says another version or licence than the package's own package.json;
 *   - the About tab does not draw the list (a cheap read of admin.html and admin.js).
 * It reads files only (no browser, no network) and proves itself on hostile copies of the real data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readThirdParty } from './vendored-lib.mjs';

const NEEDS_NOTICE = /^(MIT|ISC|0BSD|BSD-|OFL-|CC-BY|ODbL)/;
const FONT_FILES = /\.(woff2?|ttf|otf|tflite|pbf)$/i;

const clean = (s) => String(s).replace(/ \(.*$/, '').trim().toLowerCase();
const walk = (dir) => {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
};
const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');

export function checkCredits(root, credits) {
  const out = [];
  const list = Array.isArray(credits?.components) ? credits.components : null;
  if (!list) return ['public/credits.json has no "components" list'];
  const byName = new Map(list.map((e) => [clean(e.name), e]));
  const covers = list.flatMap((e) => (Array.isArray(e.covers) ? e.covers : []));
  const covered = (file) => covers.some((c) => file === c || file.startsWith(c.replace(/\/$/, '') + '/'));

  // each entry
  for (const e of list) {
    const who = `credits.json "${e?.name || 'no name'}"`;
    if (e?.kind === 'own') {
      for (const k of ['name', 'use', 'group']) if (typeof e[k] !== 'string' || !e[k].trim()) out.push(`${who}: "${k}" is empty`);
      if (e.notice !== 'Made by Coffee Pub.') out.push(`${who}: an entry of kind "own" must say "Made by Coffee Pub."`);
      if (!Array.isArray(e.covers) || !e.covers.length) out.push(`${who}: an entry of kind "own" must say what it covers`);
      for (const k of ['licence', 'link', 'licenceFile']) if (e[k]) out.push(`${who}: an entry of kind "own" must not have a "${k}"`);
      for (const c of Array.isArray(e.covers) ? e.covers : []) if (!fs.existsSync(path.join(root, c))) out.push(`${who}: covers ${c}, which does not exist`);
      continue;
    }
    if (e?.kind) out.push(`${who}: kind "${e.kind}" is not known (only "own")`);
    for (const k of ['name', 'use', 'group', 'licence', 'link', 'licenceFile']) if (typeof e[k] !== 'string' || !e[k].trim()) out.push(`${who}: "${k}" is empty`);
    if (typeof e.notice !== 'string') out.push(`${who}: "notice" must be text (empty when none is required)`);
    if (e.link && !/^https:\/\/\S+$/.test(e.link)) out.push(`${who}: the link is not an https address`);
    if (/\b(A?GPL|LGPL)\b/.test(e.licence || '') && !/\bOR\b/.test(e.licence)) out.push(`${who}: licence ${e.licence} is not allowed`);
    if (e.licence && e.licence.split(/ AND /).some((id) => NEEDS_NOTICE.test(id.trim())) && !String(e.notice || '').trim()) out.push(`${who}: the licence (${e.licence}) asks for a notice, and the notice is empty`);
    if (e.licenceFile) {
      const f = path.join(root, e.licenceFile);
      if (path.isAbsolute(e.licenceFile) || e.licenceFile.includes('..') || !fs.existsSync(f) || !fs.statSync(f).isFile()) out.push(`${who}: the licence file ${e.licenceFile} does not exist`);
      const m = e.licenceFile.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)\//);
      if (m && fs.existsSync(path.join(root, 'node_modules', m[1], 'package.json'))) {
        const pj = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', m[1], 'package.json'), 'utf8'));
        if (e.version !== pj.version) out.push(`${who}: says version ${e.version}, but ${m[1]} ${pj.version} is installed`);
        const strip = (s) => String(s).replace(/[()]/g, '').trim();
        if (strip(e.licence) !== strip(pj.license)) out.push(`${who}: says licence ${e.licence}, but ${m[1]} says ${pj.license}`);
      }
    }
    for (const c of Array.isArray(e.covers) ? e.covers : []) if (!fs.existsSync(path.join(root, c))) out.push(`${who}: covers ${c}, which does not exist`);
  }

  // runtime dependencies
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const dep of Object.keys(pkg.dependencies || {})) {
    const names = [dep, dep.replace(/^@fortawesome\/fontawesome-free$/, 'Font Awesome Free')];
    if (!names.some((n) => byName.has(clean(n)))) out.push(`package.json runtime dependency ${dep} has no entry in public/credits.json`);
  }

  // vendored libraries named in a module's THIRD-PARTY.md
  const modulesDir = path.join(root, 'modules');
  if (fs.existsSync(modulesDir)) {
    for (const d of fs.readdirSync(modulesDir, { withFileTypes: true }).filter((x) => x.isDirectory())) {
      for (const row of readThirdParty(root, d.name).entries) {
        const file = `modules/${d.name}/${row.file}`;
        if (!byName.has(clean(row.name)) && !covered(file)) out.push(`modules/${d.name}/THIRD-PARTY.md: ${row.name} (${row.file}) has no entry in public/credits.json`);
      }
      const vendorDir = path.join(modulesDir, d.name, 'vendor');
      if (walk(vendorDir).length && !readThirdParty(root, d.name).entries.length) out.push(`modules/${d.name}/vendor/ holds files but THIRD-PARTY.md lists none`);
    }
  }

  // fonts, models, glyphs and pdf.js under public/
  const pub = path.join(root, 'public');
  for (const f of walk(pub)) {
    const r = rel(root, f);
    if (FONT_FILES.test(f) || r.startsWith('public/sdk/pdfjs/')) if (!covered(r)) out.push(`${r} is a font, model, glyph or pdf.js file that no entry in public/credits.json covers`);
  }

  // our own background images: each is covered by an entry and listed in the folder's CREDITS.md
  const bgDir = path.join(pub, 'assets', 'images', 'backgrounds');
  const bgCredits = fs.existsSync(path.join(bgDir, 'CREDITS.md')) ? fs.readFileSync(path.join(bgDir, 'CREDITS.md'), 'utf8') : '';
  for (const f of walk(bgDir)) {
    const r = rel(root, f);
    if (!/\.(webp|png|jpe?g|gif|svg|avif)$/i.test(f)) continue;
    if (!covered(r)) out.push(`${r} is a background image that no entry in public/credits.json covers`);
    if (!bgCredits.includes(path.basename(f))) out.push(`${r} is not listed in public/assets/images/backgrounds/CREDITS.md`);
  }

  // the About tab draws it
  const html = fs.existsSync(path.join(pub, 'admin.html')) ? fs.readFileSync(path.join(pub, 'admin.html'), 'utf8') : '';
  const js = fs.existsSync(path.join(pub, 'admin.js')) ? fs.readFileSync(path.join(pub, 'admin.js'), 'utf8') : '';
  const aboutTab = html.match(/id="tab-about"[\s\S]*?<\/section>/)?.[0] || '';
  if (!/id="credits-list"/.test(aboutTab)) out.push('public/admin.html: the About tab has no #credits-list');
  if (!/Open-source software/.test(aboutTab)) out.push('public/admin.html: the About tab has no "Open-source software" heading');
  if (!/fetch\('\/credits\.json'\)/.test(js) || !/credits-list/.test(js) || !/if \(tab === 'about'\) showCredits\(\)/.test(js)) out.push('public/admin.js does not read /credits.json and draw it into #credits-list when the About tab opens');
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  let failed = 0;
  const ok = (c, m) => { if (!c) { failed++; console.error('FAIL ' + m); } else console.log('ok   ' + m); };
  const credits = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'credits.json'), 'utf8'));
  const real = checkCredits(ROOT, credits);
  ok(real.length === 0, `public/credits.json is complete (${credits.components.length} entries)${real.map((p) => '\n     ' + p).join('')}`);
  // hostile copies
  const copy = () => JSON.parse(JSON.stringify(credits));
  const fails = (name, mutate, re) => { const c = copy(); mutate(c.components); const p = checkCredits(ROOT, c); ok(p.some((x) => re.test(x)), `${name} fails (${p[0] || 'no problem found'})`); };
  const at = (c, n) => c.find((e) => e.name === n);
  fails('a missing runtime dependency', (c) => c.splice(c.findIndex((e) => e.name === 'express'), 1), /dependency express has no entry/);
  fails('a missing vendored library', (c) => c.splice(c.findIndex((e) => e.name === 'marked'), 1), /marked .* has no entry/);
  fails('a missing font', (c) => c.splice(c.findIndex((e) => e.name === 'Figtree'), 1), /figtree\/latin\.woff2 is a font/);
  fails('a missing model', (c) => c.splice(c.findIndex((e) => /Selfie/.test(e.name)), 1), /selfie_segmenter\.tflite is a font/);
  fails('a missing icon set', (c) => c.splice(c.findIndex((e) => e.name === 'Font Awesome Free'), 1), /fontawesome-free has no entry/);
  fails('a missing pdf.js', (c) => c.splice(c.findIndex((e) => e.name === 'pdf.js'), 1), /pdfjs\/.* no entry/);
  fails('a missing background-images entry', (c) => c.splice(c.findIndex((e) => e.kind === 'own'), 1), /background-fantasy-pattern-\S+ is a background image that no entry/);
  fails('an own entry with a licence', (c) => { at(c, 'Background images').licence = 'MIT'; }, /must not have a "licence"/);
  fails('an own entry that does not say who made it', (c) => { at(c, 'Background images').notice = ''; }, /must say "Made by Coffee Pub\."/);
  fails('no licence id', (c) => { at(c, 'qrcode').licence = ''; }, /"licence" is empty/);
  fails('no link', (c) => { at(c, 'qrcode').link = ''; }, /"link" is empty/);
  fails('an address that is not https', (c) => { at(c, 'qrcode').link = 'http://example.test'; }, /not an https address/);
  fails('a missing licence file', (c) => { at(c, 'qrcode').licenceFile = 'node_modules/qrcode/NOPE'; }, /does not exist/);
  fails('a GPL entry', (c) => { at(c, 'qrcode').licence = 'GPL-3.0-only'; }, /not allowed/);
  fails('an MIT entry with no notice', (c) => { at(c, 'yauzl').notice = ''; }, /asks for a notice/);
  fails('a version that is not the installed one', (c) => { at(c, 'express').version = '1.0.0'; }, /says version 1\.0\.0/);
  fails('a licence that is not the package\'s', (c) => { at(c, 'express').licence = 'ISC'; }, /says licence ISC/);
  ok(checkCredits(ROOT, { components: 'no' }).length === 1, 'a credits file with no list fails');
  console.log(failed ? `\n${failed} FAILED` : '\ncheck-credits: all passed');
  process.exit(failed ? 1 : 0);
}
