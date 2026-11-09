// What the Design System pages read from the bundled modules (modules/<id>/src): each module's stylesheets, as text, and the icons
// its files use. This is read at run time (the route /design-system/module-sources.js in server/index.js) and, for a snapshot opened
// from disk, written beside the page by tools/design-system-snapshot.mjs. It is NOT part of the committed public/design-system/sources.js,
// so a change inside modules/<id>/ never makes that generated file stale (tools/check-sources-modules.mjs).
const fs = require('node:fs');
const path = require('node:path');

const SKIP = new Set(['solid', 'regular', 'brands', 'fw', 'spin', 'pulse', 'lg', 'xs', 'sm', 'xl', '2x', '3x', '4x', '5x', 'rotate-90', 'rotate-180', 'rotate-270', 'flip-horizontal', 'flip-vertical', 'flip-both', 'stack', 'stack-1x', 'stack-2x', 'inverse', 'border', 'pull-left', 'pull-right', 'beat', 'fade', 'bounce', 'shake', 'beat-fade', 'spin-pulse', 'spin-reverse', 'li', 'ul', 'sharp', 'duotone', 'classic', 'light', 'thin', 'beat', 'width-auto', 'width-fixed', 'swap-opacity']);
const CLASS_RXS = [
  /\bfa-(?:solid|regular|brands)\s+fa-([a-z0-9-]+)/g,
  /\bfa-([a-z0-9]+(?:-[a-z0-9]+)*)(?=[\s"'`<.:,;)\]}])/g,
];
const NAMED_RXS = [/\bdata-icon="([a-z0-9-]+)"/g, /\bicon:\s*['"]([a-z0-9-]+)['"]/g, /"icon":\s*"([a-z0-9-]+)"/g, /\bui\.icon\(\s*['"]([a-z0-9-]+)['"]/g, /\bglyph:\s*['"]([a-z0-9-]+)['"]/g];

// The icon names a file's text uses (a stylesheet only by class; any other file by class and by the named patterns).
function iconNamesIn(text, isCss) {
  const out = [];
  for (const rx of CLASS_RXS) for (const m of text.matchAll(rx)) out.push(m[1]);
  if (!isCss) for (const rx of NAMED_RXS) for (const m of text.matchAll(rx)) out.push(m[1]);
  return out.filter((n) => /^[a-z0-9][a-z0-9-]*$/.test(n) && !SKIP.has(n));
}

// Module stylesheets, in the order a module page carries them (server/module-build.js): lib css, then its own.
function moduleStyles(root) {
  const out = {};
  const dir = path.join(root, 'modules');
  for (const id of fs.readdirSync(dir).sort()) {
    const src = path.join(dir, id, 'src');
    if (!fs.existsSync(src)) continue;
    const css = fs.readdirSync(src).filter((f) => f.endsWith('.css')).sort();
    if (!css.length) continue;
    const lib = css.filter((f) => f.startsWith(`${id}-lib-`));
    const own = css.filter((f) => f === `${id}.css`);
    const other = css.filter((f) => !lib.includes(f) && !own.includes(f));
    const entry = (f, page) => ({ file: `modules/${id}/src/${f}`, text: fs.readFileSync(path.join(src, f), 'utf8'), page });
    out[id] = { files: [...lib, ...own].map((f) => entry(f, true)).concat(other.map((f) => entry(f, false))) };
  }
  return out;
}

// The icons the modules' source files use: [{ name, count, files, svg }], only those in Font Awesome Free solid.
function moduleIcons(root, faDir) {
  const names = new Map();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['design-system', 'node_modules', 'models', 'maps-glyphs', 'assets', 'dist', 'test'].includes(e.name)) walk(p); continue; }
      if (!/\.(css|js|html|json)$/.test(e.name) || fs.statSync(p).size >= 3_000_000) continue;
      const file = path.relative(root, p).split(path.sep).join('/');
      for (const n of iconNamesIn(fs.readFileSync(p, 'utf8'), /\.css$/.test(e.name))) {
        const x = names.get(n) || { count: 0, files: new Map() };
        x.count += 1; x.files.set(file, (x.files.get(file) || 0) + 1); names.set(n, x);
      }
    }
  };
  walk(path.join(root, 'modules'));
  const out = [];
  for (const [name, x] of [...names].sort((a, b) => a[0].localeCompare(b[0]))) {
    const svgPath = path.join(faDir, 'svgs', 'solid', `${name}.svg`);
    if (!fs.existsSync(svgPath)) continue;
    out.push({ name, count: x.count, files: [...x.files.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 4).map(([f]) => f), svg: fs.readFileSync(svgPath, 'utf8').trim() });
  }
  return out;
}

// The script the Design System pages load after sources.js: adds the modules' stylesheets and icons to window.DS_SOURCES.
function moduleSourcesJs(root, faDir) {
  const data = { modules: moduleStyles(root), icons: moduleIcons(root, faDir) };
  const json = JSON.stringify(data).replace(/<\/(script|style)/gi, '<\\/$1').replace(/border-radius/g, 'border\\u002dradius');
  return `/* Generated at run time from the bundled sources (server/design-system-modules.js): do not edit. Adds the stylesheets and icons found there to window.DS_SOURCES. */
(function () {
  var D = ${json};
  var S = window.DS_SOURCES = window.DS_SOURCES || {};
  S.modules = D.modules;
  S.svgs = S.svgs || {};
  var icons = S.icons = S.icons || [];
  var by = {};
  icons.forEach(function (i) { by[i.name] = i; });
  D.icons.forEach(function (m) {
    S.svgs[m.name] = S.svgs[m.name] || m.svg;
    var e = by[m.name];
    if (e) { e.count += m.count; return; }
    e = { name: m.name, count: m.count, files: m.files, free: true };
    icons.push(e); by[m.name] = e;
  });
  icons.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
})();
`;
}

module.exports = { iconNamesIn, moduleStyles, moduleIcons, moduleSourcesJs, SKIP };
