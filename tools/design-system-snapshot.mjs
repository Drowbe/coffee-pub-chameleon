#!/usr/bin/env node
/*
 * design-system-snapshot.mjs -- the design system page (public/design-system/) as a self-contained static folder, for a
 * private review copy (documentation/plans/plan-design-system.md, "The review copy"). Reads only the fixed list of files
 * below (public/, each module's src stylesheets, the Font Awesome package) and never DATA_DIR.
 *
 *   node tools/design-system-snapshot.mjs            builds the folder OUT (default /tmp/ds-snapshot) and prints its files and size
 *   node tools/design-system-snapshot.mjs --sources  rewrites public/design-system/sources.js (the module stylesheets, the icons
 *                                                    the product uses and their SVGs), which the page itself reads when it is
 *                                                    served by the app; the snapshot always rebuilds it
 *
 *   PAGE=proposed OUT=/tmp/ds-proposed node tools/design-system-snapshot.mjs
 *                                                    builds System v1 instead (public/design-system/legacy/system-v1/proposed.html,
 *                                                    the drawings the production system was built from, written as the folder's
 *                                                    index.html): index.html, style.css, theme.css, fa/, ds.css, pages.css,
 *                                                    proposed.css, proposed.js, proposed-families.json, every file that manifest names
 *                                                    (each family's script and stylesheet) and fonts/ (the bundled woff2 files and their
 *                                                    OFL.txt) only. No sources.js, no components, no inventory. The manifest is also written
 *                                                    into index.html (window.DS_PROPOSED_MANIFEST), so the folder works from a file on disk
 *
 * The folder of the default page (PAGE=today, the Design System page, index.html) holds: index.html (paths made relative), ds.css,
 * pages.css, ds.js, components*.js, sources.js (every stylesheet and the SDK as text, so the page works from disk and from any static
 * host), style.css, theme.css (Strong Coffee's light set; the dark set is style.css's own), fa/ (Font Awesome's stylesheet and fonts),
 * no external script. Its page links (Proposed, Prototype, Legacy) point to pages the folder does not hold. Stylesheets are the only
 * thing the page loads by link. Fails above 12 MB.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const LIMIT = 12 * 1024 * 1024;
const FA = path.join(root, 'node_modules', '@fortawesome', 'fontawesome-free');
const DS = path.join(root, 'public', 'design-system');
const V1 = path.join(DS, 'legacy', 'system-v1'); // System v1: the drawings (the old Proposed page), kept on Legacy
const rd = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const rel = (p) => path.relative(root, p).split(path.sep).join('/');

// System v1's families (public/design-system/legacy/system-v1/proposed-families.json): the one list the page and this tool both read.
export function proposedManifest() {
  const m = JSON.parse(fs.readFileSync(path.join(V1, 'proposed-families.json'), 'utf8'));
  if (!m || !Array.isArray(m.families)) throw new Error('proposed-families.json has no "families" list');
  for (const f of m.families) {
    if (!f.id || !/^[a-z0-9-]+$/.test(f.id)) throw new Error(`proposed-families.json: a family needs an id of lower-case letters, digits and hyphens (${JSON.stringify(f.id)})`);
    for (const k of ['js', 'css']) if (f[k] && (!/^[A-Za-z0-9._-]+$/.test(f[k]) || !fs.existsSync(path.join(V1, f[k])))) throw new Error(`proposed-families.json: ${f.id}: ${k} file ${f[k]} is missing or not a plain file name`);
  }
  return m;
}

// ---- module stylesheets, in the order a module page carries them (server/module-build.js): lib css, then its own ----
export function moduleStyles() {
  const out = {};
  for (const id of fs.readdirSync(path.join(root, 'modules')).sort()) {
    const src = path.join(root, 'modules', id, 'src');
    if (!fs.existsSync(src)) continue;
    const css = fs.readdirSync(src).filter((f) => f.endsWith('.css')).sort();
    if (!css.length) continue;
    const lib = css.filter((f) => f.startsWith(`${id}-lib-`));
    const own = css.filter((f) => f === `${id}.css`);
    const other = css.filter((f) => !lib.includes(f) && !own.includes(f));
    out[id] = { files: [...lib, ...own].map((f) => ({ file: `modules/${id}/src/${f}`, text: fs.readFileSync(path.join(src, f), 'utf8'), page: true }))
      .concat(other.map((f) => ({ file: `modules/${id}/src/${f}`, text: fs.readFileSync(path.join(src, f), 'utf8'), page: false }))) };
  }
  return out;
}

// ---- the icons the product uses ----
const SKIP = new Set(['solid', 'regular', 'brands', 'fw', 'spin', 'pulse', 'lg', 'xs', 'sm', 'xl', '2x', '3x', '4x', '5x', 'rotate-90', 'rotate-180', 'rotate-270', 'flip-horizontal', 'flip-vertical', 'flip-both', 'stack', 'stack-1x', 'stack-2x', 'inverse', 'border', 'pull-left', 'pull-right', 'beat', 'fade', 'bounce', 'shake', 'beat-fade', 'spin-pulse', 'spin-reverse', 'li', 'ul', 'sharp', 'duotone', 'classic', 'light', 'thin', 'beat', 'width-auto', 'width-fixed', 'swap-opacity']);
function scanFiles() {
  const list = [];
  const walk = (dir, filter) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (['design-system', 'node_modules', 'models', 'maps-glyphs', 'assets'].includes(e.name)) continue; walk(p, filter); } else if (filter(e.name)) list.push(p); } };
  walk(path.join(root, 'public'), (n) => /\.(css|js|mjs|html)$/.test(n));
  walk(path.join(root, 'modules'), (n) => /\.(css|js|html|json)$/.test(n));
  for (const n of fs.readdirSync(path.join(root, 'server'))) if (/\.(js|json)$/.test(n) && n !== 'airports.json') list.push(path.join(root, 'server', n));
  return list.filter((p) => !rel(p).startsWith('modules/dist') && fs.statSync(p).size < 3_000_000);
}
function groupOf(file) {
  if (/^modules\//.test(file)) return 'Modules';
  if (/^server\//.test(file)) return 'Server pages and templates';
  if (/(nav-bar|primary-nav|brand|host-menu|menu-flyout|action-bar|environment-banner|theme-mode)/.test(file)) return 'Navigation and the top bar';
  if (/(chat|message)/.test(file)) return 'Chat';
  if (/(space|canvas|call|dashboard|layouts|phase|status|snap|slot|opens-with|switch-list|module-host|module-chrome|module-settings|module-config|module)/.test(file)) return 'Space, canvas and call';
  if (/(admin|ai-|profile|login|register|setup|template|destination|keyed|diag|bad-link|mfa|word|background)/.test(file)) return 'Manage, accounts and pages';
  if (/sdk\//.test(file)) return 'SDK';
  return 'Other';
}
export function iconsUsed() {
  const names = new Map(); // name -> { count, files: Map(file -> n) }
  const add = (name, file) => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || SKIP.has(name)) return;
    const e = names.get(name) || { count: 0, files: new Map() };
    e.count += 1; e.files.set(file, (e.files.get(file) || 0) + 1); names.set(name, e);
  };
  const rxs = [
    /\bfa-(?:solid|regular|brands)\s+fa-([a-z0-9-]+)/g,
    /\bfa-([a-z0-9]+(?:-[a-z0-9]+)*)(?=[\s"'`<.:,;)\]}])/g,
  ];
  const named = [/\bdata-icon="([a-z0-9-]+)"/g, /\bicon:\s*['"]([a-z0-9-]+)['"]/g, /"icon":\s*"([a-z0-9-]+)"/g, /\bui\.icon\(\s*['"]([a-z0-9-]+)['"]/g, /\bglyph:\s*['"]([a-z0-9-]+)['"]/g];
  for (const p of scanFiles()) {
    const text = fs.readFileSync(p, 'utf8');
    const file = rel(p);
    for (const rx of rxs) for (const m of text.matchAll(rx)) add(m[1], file);
    if (!/\.css$/.test(file)) for (const rx of named) for (const m of text.matchAll(rx)) add(m[1], file);
  }
  const have = (n) => fs.existsSync(path.join(FA, 'svgs', 'solid', `${n}.svg`));
  const icons = []; const unknown = [];
  for (const [name, e] of names) {
    if (!have(name)) { unknown.push(name); continue; }
    const byGroup = new Map();
    for (const [f, n] of e.files) byGroup.set(groupOf(f), (byGroup.get(groupOf(f)) || 0) + n);
    const group = [...byGroup.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    icons.push({ name, group, count: e.count, files: [...e.files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([f]) => f), free: true });
  }
  icons.sort((a, b) => a.name.localeCompare(b.name));
  const svgs = {};
  for (const i of icons) svgs[i.name] = fs.readFileSync(path.join(FA, 'svgs', 'solid', `${i.name}.svg`), 'utf8').trim();
  return { icons, svgs, unknown };
}

export function buildSources({ withFiles } = {}) {
  const { icons, svgs, unknown } = iconsUsed();
  const data = { generated: 'by tools/design-system-snapshot.mjs', modules: moduleStyles(), icons, svgs };
  if (withFiles) {
    const { themeCss } = require('../server/theme-css.js');
    const { DEFAULT_THEME } = require('../server/store.js');
    data.files = {
      'style.css': rd('public/style.css'), 'host.css': rd('public/sdk/host.css'), 'host.js': rd('public/sdk/host.js'), 'tooltip.js': rd('public/tooltip.js'),
      'destination.css': rd('public/destination.css'), 'diag.css': rd('public/diag.css'),
      'theme.css': themeCss({ light: DEFAULT_THEME.light, dark: null }, 'dark'),
    };
  }
  return { data, js: sourcesJs(data, withFiles), unknown };
}
function sourcesJs(data, withFiles) {
  return `/* Generated by tools/design-system-snapshot.mjs${withFiles ? '' : ' --sources'}: do not edit. The page reads these as text (a hyphen in border-radius is written \\u002d so the radius check, which reads the product's own rules, does not read a copy). */\nwindow.DS_SOURCES = ${JSON.stringify(data).replace(/<\/(script|style)/gi, '<\\/$1').replace(/border-radius/g, 'border\\u002dradius')};\n`;
}

function copy(from, to) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
function walkSize(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...walkSize(p)); else out.push({ file: rel2(dir, p), size: fs.statSync(p).size, abs: p }); }
  return out;
}
const rel2 = (dir, p) => p;

export function buildSnapshot(out, page = 'today') {
  if (page !== 'today' && page !== 'proposed') throw new Error(`PAGE must be today or proposed, not ${page}`);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  // The page, paths made relative (System v1 reads the shared pages.css from two folders up).
  const from = page === 'proposed' ? V1 : DS;
  let html = fs.readFileSync(path.join(from, page === 'proposed' ? 'proposed.html' : 'index.html'), 'utf8');
  html = html.replace('href="/fa/css/all.min.css"', 'href="fa/css/all.min.css"').replace('href="/sdk/system.css"', 'href="system.css"').replace('href="/style.css"', 'href="style.css"').replace('href="/theme.css"', 'href="theme.css"').replace('href="../../pages.css"', 'href="pages.css"');
  let keep;
  if (page === 'proposed') {
    // The families the manifest names, and the manifest itself (also written into the page: a file on disk cannot read it by XHR).
    const m = proposedManifest();
    const names = new Set(['ds.css', 'proposed.js', 'proposed.css', 'proposed-families.json']);
    for (const f of m.families) for (const k of ['js', 'css']) if (f[k]) names.add(f[k]);
    keep = (f) => names.has(f);
    const tag = `<script>window.DS_PROPOSED_MANIFEST = ${JSON.stringify(m).replace(/</g, '\\u003c')};</script>\n  `;
    if (!html.includes('<script src="proposed.js">')) throw new Error('proposed.html does not load proposed.js');
    html = html.replace('<script src="proposed.js">', tag + '<script src="proposed.js">');
  } else {
    const rx = /^(ds\.css|pages\.css|ds\.js|components[-0-9]*\.js)$/;
    keep = (f) => rx.test(f);
  }
  fs.writeFileSync(path.join(out, 'index.html'), html);
  for (const f of fs.readdirSync(from)) if (keep(f)) copy(path.join(from, f), path.join(out, f));
  if (page === 'proposed') copy(path.join(DS, 'pages.css'), path.join(out, 'pages.css'));
  // The proposed page's bundled fonts (fonts/<family>/*.woff2 and each OFL.txt), self-hosted beside it. Today's page carries none.
  if (page === 'proposed' && fs.existsSync(path.join(V1, 'fonts'))) {
    const walkCopy = (from, to) => { for (const e of fs.readdirSync(from, { withFileTypes: true })) { const a = path.join(from, e.name); const b = path.join(to, e.name); if (e.isDirectory()) walkCopy(a, b); else if (/\.(woff2|txt)$/.test(e.name)) copy(a, b); } };
    walkCopy(path.join(V1, 'fonts'), path.join(out, 'fonts'));
  }
  let data; let unknown = [];
  if (page === 'proposed') {
    // Only the two stylesheets the frames read; no sources.js, no module stylesheets, no icon scan.
    const { themeCss } = require('../server/theme-css.js');
    const { DEFAULT_THEME } = require('../server/store.js');
    data = { files: { 'style.css': rd('public/style.css'), 'theme.css': themeCss({ light: DEFAULT_THEME.light, dark: null }, 'dark') }, icons: [] };
  } else {
    const built = buildSources({ withFiles: true });
    data = built.data; unknown = built.unknown;
    fs.writeFileSync(path.join(out, 'sources.js'), built.js);
  }
  // system.css names its fonts from the server root (/fonts/...): in the snapshot they sit beside it (fonts/), and the Design System page reads
  // system.css as text too (sources.js), so it gets the same relative copy.
  const systemCss = rd('public/sdk/system.css').replace(/url\(\/fonts\//g, 'url(fonts/');
  fs.writeFileSync(path.join(out, 'system.css'), systemCss);
  if (page === 'today') { data.files['system.css'] = systemCss; fs.writeFileSync(path.join(out, 'sources.js'), sourcesJs(data, true)); }
  const fontsDir = path.join(root, 'public', 'fonts');
  const copyFonts = (from, to) => { for (const e of fs.readdirSync(from, { withFileTypes: true })) { const a = path.join(from, e.name); const b = path.join(to, e.name); if (e.isDirectory()) copyFonts(a, b); else if (/\.(woff2|txt)$/.test(e.name)) copy(a, b); } };
  copyFonts(fontsDir, path.join(out, 'fonts'));
  fs.writeFileSync(path.join(out, 'style.css'), data.files['style.css']);
  fs.writeFileSync(path.join(out, 'theme.css'), data.files['theme.css']);
  // Font Awesome: the stylesheet and its fonts, beside it as the stylesheet expects (../webfonts/).
  copy(path.join(FA, 'css', 'all.min.css'), path.join(out, 'fa', 'css', 'all.min.css'));
  for (const f of fs.readdirSync(path.join(FA, 'webfonts'))) copy(path.join(FA, 'webfonts', f), path.join(out, 'fa', 'webfonts', f));
  copy(path.join(FA, 'LICENSE.txt'), path.join(out, 'fa', 'LICENSE.txt'));
  const files = walkSize(out).map((f) => ({ file: path.relative(out, f.abs).split(path.sep).join('/'), size: f.size }));
  const total = files.reduce((a, f) => a + f.size, 0);
  return { files, total, unknown, icons: data.icons.length };
}

async function main() {
  if (process.argv.includes('--sources')) {
    const { js, data, unknown } = buildSources();
    fs.writeFileSync(path.join(DS, 'sources.js'), js);
    console.log(`design-system-snapshot: wrote public/design-system/sources.js (${Math.round(js.length / 1024)} KB: ${Object.keys(data.modules).length} modules, ${data.icons.length} icons${unknown.length ? `; not in Font Awesome Free: ${unknown.join(', ')}` : ''})`);
    return 0;
  }
  const out = path.resolve(process.env.OUT || (process.env.PAGE === 'proposed' ? '/tmp/ds-proposed' : '/tmp/ds-snapshot'));
  const page = process.env.PAGE || 'today';
  const r = buildSnapshot(out, page);
  for (const f of r.files) console.log(`  ${String(f.size).padStart(9)}  ${f.file}`);
  console.log(`design-system-snapshot: ${r.files.length} files, ${(r.total / 1024 / 1024).toFixed(2)} MB in ${out}${r.unknown.length ? `\n  names that look like icons but are not in Font Awesome Free solid (left out): ${r.unknown.join(', ')}` : ''}`);
  if (r.total > LIMIT) { console.error(`design-system-snapshot: over the ${LIMIT / 1024 / 1024} MB limit`); return 1; }
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main());
