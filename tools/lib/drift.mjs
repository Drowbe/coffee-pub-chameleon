// Shared by the drift guards (check-no-raw-colours, check-spacing, check-type-scale, check-icons, check-breakpoints).
// What they have in common, in plain words:
//   - which files are product styling (collectFiles): public/*.css, public/sdk/*.css, modules/*/src/*.css and the
//     inline CSS in public/**/*.js and modules/*/src/*.js, never public/design-system/, node_modules or a vendored
//     library (MapLibre);
//   - how to read declarations out of CSS and out of CSS written inside JS strings (declarations);
//   - the ratchet (runRatchet): a JSON allow-list holds today's offenders as a count per file and key. The check passes
//     while no count is higher than recorded and no new file or key appears. It says plainly when a count has dropped
//     and the allow-list can be tightened. `--update` rewrites the allow-list downward only, and refuses to raise a
//     count unless `--force-raise` is also given (which is how an allow-list is first created).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP_DIRS = new Set(['node_modules', 'design-system', 'design', 'fa', 'vendor', '.git', 'assets', 'models', 'maps-glyphs']);
// Third-party files, replaced whole on upgrade.
const VENDORED = /maplibre/i;

function walk(dir, out, exts) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, exts);
    else if (exts.test(e.name) && !VENDORED.test(e.name)) out.push(p);
  }
}

// [{ rel, kind: 'css' | 'js' | 'html', text }] for every product file of the given extensions.
// `root` is only for tests, to scan a copy of the tree.
export function collectFiles(exts = /\.(css|js)$/, root = process.env.DRIFT_ROOT || ROOT) {
  const paths = [];
  walk(path.join(root, 'public'), paths, exts);
  const modulesDir = path.join(root, 'modules');
  if (fs.existsSync(modulesDir)) {
    for (const m of fs.readdirSync(modulesDir)) walk(path.join(modulesDir, m, 'src'), paths, exts);
  }
  return paths.sort().map((p) => ({
    rel: path.relative(root, p).split(path.sep).join('/'),
    kind: p.endsWith('.css') ? 'css' : p.endsWith('.html') ? 'html' : 'js',
    text: fs.readFileSync(p, 'utf8'),
  }));
}

// Blank out comments and `${...}` placeholders, keeping every other character in place so line numbers stay right.
const blank = (s) => s.replace(/[^\n]/g, ' ');
export function clean(text, kind) {
  let t = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (kind === 'js') {
    t = t.replace(/(^|\s)\/\/[^\n]*/g, (m, lead) => lead + blank(m.slice(lead.length)));
    t = t.replace(/\$\{[^{}\n]*\}/g, (m) => '_'.repeat(m.length));
  }
  return t;
}

// The line (from 1) an index falls on; the line starts of the last text asked about are kept so a big file is not re-read.
let lineText = null;
let lineStarts = [];
export function lineOf(text, index) {
  if (text !== lineText) {
    lineText = text;
    lineStarts = [0];
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lineStarts.push(i + 1);
  }
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= index) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}
const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

// Every declaration in a file: { prop, value, index, selector, line }. In CSS the selector is the rule's own; in JS it is
// '' (a style string has none that can be told apart reliably). JS gets three shapes: `prop: value;` inside a string,
// `{ camelProp: 'value' }`, and `el.style.camelProp = 'value'` or a `prop="value"` attribute.
export function declarations(file) {
  const text = clean(file.text, file.kind);
  const out = [];
  const seen = new Set();
  const add = (prop, value, index, selector) => {
    if (seen.has(index)) return;
    seen.add(index);
    out.push({ prop: prop.toLowerCase(), value, index, selector, line: lineOf(text, index) });
  };
  if (file.kind === 'css') {
    for (const rule of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim();
      // An @font-face block describes a font file (its weight is a range such as 100 900), not a style used anywhere.
      if (/@font-face$/i.test(selector)) continue;
      const bodyStart = rule.index + rule[0].indexOf('{') + 1;
      for (const d of rule[2].matchAll(/(--[\w-]+|-?[a-zA-Z][\w-]*)\s*:\s*([^;]*)/g)) {
        add(d[1], d[2], bodyStart + d.index + d[0].indexOf(d[2]), selector);
      }
    }
    return out;
  }
  for (const d of text.matchAll(/(--[\w-]+|-?[a-zA-Z][\w-]*)\s*:\s*([^;{}\n'"`]*)/g)) add(d[1], d[2], d.index + d[0].indexOf(d[2]), '');
  for (const d of text.matchAll(/\b([a-z]+(?:[A-Z][a-z0-9]*)*)\s*[=:]\s*(['"`])([^'"`\n]*)\2/g)) {
    add(kebab(d[1]), d[3], d.index + d[0].indexOf(d[2]) + 1, '');
  }
  return out;
}

// Remove the inside of every function call (var(), calc(), min() ...), so a pixel number in there is not read as a plain one.
export function stripCalls(value) {
  let v = value;
  for (let i = 0; i < 6; i += 1) {
    const next = v.replace(/[a-zA-Z-]*\([^()]*\)/g, ' ');
    if (next === v) break;
    v = next;
  }
  return v;
}

// A tally of offenders: file -> key -> { n, lines: [first few line numbers] }.
export class Tally {
  constructor() { this.files = new Map(); }
  add(rel, key, line) {
    if (!this.files.has(rel)) this.files.set(rel, new Map());
    const keys = this.files.get(rel);
    if (!keys.has(key)) keys.set(key, { n: 0, lines: [] });
    const e = keys.get(key);
    e.n += 1;
    if (e.lines.length < 3) e.lines.push(line);
  }
  total() { let t = 0; for (const k of this.files.values()) for (const e of k.values()) t += e.n; return t; }
  byKey() { const m = new Map(); for (const k of this.files.values()) for (const [key, e] of k) m.set(key, (m.get(key) || 0) + e.n); return m; }
  byFile() { return [...this.files].map(([f, k]) => [f, [...k.values()].reduce((a, e) => a + e.n, 0)]).sort((a, b) => b[1] - a[1]); }
}

const asObject = (tally) => {
  const o = {};
  for (const [f, keys] of [...tally.files].sort((a, b) => a[0].localeCompare(b[0]))) {
    o[f] = {};
    for (const [k, e] of [...keys].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) o[f][k] = e.n;
  }
  return o;
};

// The whole ratchet. `name` is the check's name, `allowFile` the JSON file name under tools/, `about` a sentence put in the
// allow-list file. Sets process.exitCode and prints.
export function runRatchet({ name, allowFile, about, tally, unit = 'offenders', extraReport = [], argv = process.argv.slice(2) }) {
  const allowPath = path.join(process.env.DRIFT_ALLOW_DIR || path.join(ROOT, 'tools'), allowFile);
  const update = argv.includes('--update');
  const forceRaise = argv.includes('--force-raise');
  const exists = fs.existsSync(allowPath);
  const found = asObject(tally);
  const allowJson = exists ? JSON.parse(fs.readFileSync(allowPath, 'utf8')) : {};
  const allowed = allowJson.counts || {};
  // `reasons`: file -> key -> why that entry stays on purpose (a recorded exception). --update keeps them; one whose count has reached zero is dropped.
  const reasons = {};
  for (const [f, keys] of Object.entries(allowJson.reasons || {})) {
    for (const [k, why] of Object.entries(keys)) if (found[f]?.[k]) (reasons[f] ||= {})[k] = why;
  }

  const raised = [];
  const dropped = [];
  const keysOf = (o) => Object.keys(o || {});
  for (const f of new Set([...keysOf(found), ...keysOf(allowed)])) {
    for (const k of new Set([...keysOf(found[f]), ...keysOf(allowed[f])])) {
      const have = found[f]?.[k] || 0;
      const was = allowed[f]?.[k] || 0;
      if (have > was) raised.push({ f, k, have, was, lines: tally.files.get(f)?.get(k)?.lines || [] });
      else if (have < was) dropped.push({ f, k, have, was });
    }
  }

  if (update) {
    if (raised.length && !forceRaise) {
      console.error(`${name}: refusing to update, ${raised.length} count(s) would go up (a ratchet only goes down). Fix them, or pass --force-raise to record them on purpose:`);
      printRaised(raised);
      process.exitCode = 1;
      return;
    }
    if (!raised.length && !dropped.length && exists) { console.log(`${name}: nothing to tighten`); return; }
    fs.writeFileSync(allowPath, `${JSON.stringify(Object.keys(reasons).length ? { about, counts: found, reasons } : { about, counts: found }, null, 2)}\n`);
    console.log(`${name}: allow-list ${exists ? 'rewritten' : 'created'}; ${dropped.length} entr${dropped.length === 1 ? 'y' : 'ies'} lowered, ${raised.length} raised`);
    return;
  }

  if (!exists) {
    console.error(`${name}: tools/${allowFile} is missing. Create it with: node tools/${name}.mjs --update --force-raise`);
    process.exitCode = 1;
    return;
  }
  if (raised.length) {
    console.error(`${name}: FAIL, ${raised.length} entr${raised.length === 1 ? 'y has' : 'ies have'} more ${unit} than tools/${allowFile} allows (${tally.total()} in all). Use the design system's value instead; if it is on purpose, say so in the report and record it with --update --force-raise.`);
    printRaised(raised);
    process.exitCode = 1;
    return;
  }
  for (const line of extraReport) console.log(line);
  console.log(`${name}: ${tally.total()} ${unit} in ${tally.files.size} files, none more than recorded`);
  if (dropped.length) {
    for (const d of dropped.slice(0, 25)) console.log(`  can tighten: ${d.f} ${d.k} is ${d.have}, allow-list says ${d.was}`);
    if (dropped.length > 25) console.log(`  ... and ${dropped.length - 25} more`);
    console.log(`  run: node tools/${name}.mjs --update   (rewrites the allow-list downward only)`);
  }
}

function printRaised(raised) {
  const w = Math.max(...raised.map((r) => r.f.length), 4);
  console.error(`  ${'file'.padEnd(w)}  ${'key'.padEnd(15)}  found  allowed  first lines`);
  for (const r of raised.slice(0, 60)) console.error(`  ${r.f.padEnd(w)}  ${String(r.k).padEnd(15)}  ${String(r.have).padStart(5)}  ${String(r.was).padStart(7)}  ${r.lines.join(', ')}`);
  if (raised.length > 60) console.error(`  ... and ${raised.length - 60} more`);
}

// A short baseline for the report a passing check prints: the top files and the commonest keys.
export function summary(tally, keyLabel = 'value', top = 5) {
  const lines = [];
  lines.push(`  top files: ${tally.byFile().slice(0, top).map(([f, n]) => `${f} ${n}`).join(', ') || 'none'}`);
  const keys = [...tally.byKey()].sort((a, b) => b[1] - a[1]);
  if (keys.length) lines.push(`  by ${keyLabel}: ${keys.slice(0, 14).map(([k, n]) => `${k} (${n})`).join(', ')}${keys.length > 14 ? `, +${keys.length - 14} more` : ''}`);
  return lines;
}
