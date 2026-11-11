#!/usr/bin/env node
/*
 * check-no-outside-urls.mjs -- nothing a bundled module ships loads from, or talks to, an outside address
 * (plan-documents.md decision 9: no CDN scripts, fonts or CSS, no outside service).
 *
 * For each module in tools/vendored-scope.json "covered", every .js, .mjs, .css, .html and .svg under the module (except test/,
 * design/ and node_modules/), its own source and every vendored file, is scanned for http:, https:, ws: and wss: addresses and for
 * protocol-relative addresses that open a string, a url( ) or an attribute. It looks at every such address, whether it sits in
 * <script src>, <link href>, @import, url( ), fetch, XHR, import( ), new URL( ), a comment or a licence line, so a URL cannot
 * hide by looking like text. Each one must be named, per file and with a reason, in tools/check-no-outside-urls-allow.json
 * (namespaces, licence headers, inert text). An unlisted address fails; so does an allow entry with no reason or one that no
 * longer matches anything. Not caught: an address assembled from pieces at run time (a new vendored file is read for that).
 * The check then proves itself on hostile fixtures in a temporary folder.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, loadScope, checkOutsideUrls, findUrls } from './vendored-lib.mjs';

let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.error('FAIL ' + m); } else console.log('ok   ' + m); };

const scope = loadScope();
ok(scope.problems.length === 0, `every module is covered or listed as not covered${scope.problems.map((p) => '\n     ' + p).join('')}`);
const allow = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'check-no-outside-urls-allow.json'), 'utf8'));
delete allow._about;
const real = checkOutsideUrls(ROOT, scope.covered, allow);
ok(real.length === 0, `no outside address in ${scope.covered.join(', ')} beyond the allow list${real.map((p) => '\n     ' + p).join('')}`);

// --- hostile fixtures -------------------------------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-urls-'));
let n = 0;
function fixture(file, body) {
  const root = path.join(tmp, 'r' + n++);
  const p = path.join(root, 'modules', 'm', file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return root;
}
const run = (root, a = {}) => checkOutsideUrls(root, ['m'], a);
const caught = (name, file, body, url) => {
  const p = run(fixture(file, body));
  ok(p.length === 1 && p[0].includes(url), `${name} fails (${p[0] ? p[0].slice(0, 110) : 'nothing found'})`);
};
const X = 'https://cdn.example.test/x';
caught('<script src>', 'src/a.html', `<script src="${X}.js"></script>`, X);
caught('<link href>', 'src/a.html', `<link rel="stylesheet" href='${X}.css'>`, X);
caught('an <img src> in a page', 'src/a.html', `<img src=${X}.png>`, X);
caught('fetch()', 'vendor/a.js', `fetch("${X}")`, X);
caught('XMLHttpRequest', 'src/a.js', `x.open('GET', '${X}')`, X);
caught('import()', 'vendor/a.mjs', `const m = await import(\`${X}.mjs\`);`, X);
caught('new URL()', 'src/a.js', `new URL('${X}', location)`, X);
caught('a script element made in code', 'src/a.js', `s.src = "${X}.js"; document.head.append(s);`, X);
caught('a WebSocket', 'src/a.js', `new WebSocket("wss://live.example.test/s")`, 'wss://live.example.test/s');
caught('@import in CSS', 'src/a.css', `@import "${X}.css";`, X);
caught('@import url() in CSS', 'src/a.css', `@import url(${X}.css);`, X);
caught('url() in CSS (a font)', 'vendor/a.css', `@font-face { src: url("${X}.woff2"); }`, X);
caught('a protocol-relative <script>', 'src/a.html', `<script src="//cdn.example.test/x.js"></script>`, '//cdn.example.test/x.js');
caught('a protocol-relative url()', 'src/a.css', `a { background: url(//cdn.example.test/p.png); }`, '//cdn.example.test/p.png');
caught('a protocol-relative import()', 'src/a.js', `import('//cdn.example.test/m.js')`, '//cdn.example.test/m.js');
caught('an address inside a comment (it must be named)', 'src/a.js', `/* see ${X} */ var a = 1;`, X);
caught('an SVG with an outside image', 'src/a.svg', `<svg><image href="${X}.png"/></svg>`, X);
caught('an address on a later line of a minified-style file', 'vendor/a.js', `var a=1;\n// header\nvar b=2;var c="${X}";`, X);
ok(run(fixture('src/a.js', 'var rows: 1; // not //a.b: the word rows:\nvar s = a // b;\n')).length === 0, 'fixture: "rows:" and a plain // comment are not addresses');
ok(run(fixture('test/a.js', `fetch("${X}")`)).length === 0, 'fixture: a file under test/ is not scanned');
ok(run(fixture('src/a.html', 'x'), {}).length === 0, 'fixture: a page with no address passes');
{
  const svgNs = 'http://www.w3.org/2000/svg';
  const root = fixture('src/a.js', `document.createElementNS("${svgNs}", "svg");`);
  ok(run(root).length === 1, 'fixture: a namespace string fails until it is on the allow list');
  ok(run(root, { 'modules/m/src/a.js': [{ url: svgNs, reason: 'SVG namespace, a name and not an address' }] }).length === 0, 'fixture: the same namespace passes when listed with a reason');
  ok(run(root, { 'modules/m/src/other.js': [{ url: svgNs, reason: 'wrong file' }] }).length >= 1, 'fixture: an allow entry for another file does not help');
  ok(run(root, { 'modules/m/src/a.js': [{ url: svgNs, reason: '' }] }).some((p) => /has no reason/.test(p)), 'fixture: an allow entry with no reason fails');
  ok(run(root, { 'modules/m/src/a.js': [{ url: svgNs, reason: 'ns' }, { url: 'http://gone.example.test/', reason: 'old' }] }).some((p) => /no longer in the file/.test(p)), 'fixture: a stale allow entry fails');
  const r2 = fixture('vendor/lib.js', `/* ${svgNs} */\nfetch("${X}");`);
  const p2 = run(r2, { 'modules/m/vendor/lib.js': [{ url: svgNs, reason: 'ns' }] });
  ok(p2.length === 1 && p2[0].includes(X), 'fixture: a vendored file with a listed namespace and an unlisted fetch still fails');
}
ok(findUrls('a "http://x.test/a)b" c').map((u) => u.url).join() === 'http://x.test/a', 'an address ends at a closing bracket');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : '\ncheck-no-outside-urls: all passed');
process.exit(failed ? 1 : 0);
