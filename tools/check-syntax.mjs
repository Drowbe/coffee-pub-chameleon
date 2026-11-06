#!/usr/bin/env node
/*
 * check-syntax.mjs -- syntax-check the server and browser scripts.
 *
 * `node --check file.js` reads a .js file that uses import/export as a plain script and passes it without
 * parsing it as a module, so errors that only a module parse finds (a name declared twice, say) slipped
 * through. This checks any file that uses import or export from a temporary .mjs copy instead, where
 * `node --check` does parse it as a module, and checks the rest as they are. It also refuses an inline script in a
 * page whose own content security policy would block it, and a password, secret or key field that isn't masked.
 *
 *   node tools/check-syntax.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Every script of ours: the server, the pages and the SDK, and each module's source (a module's scripts are
// wrapped in a function and hold a placeholder comment where the build inlines shared code, so they parse as they are).
const list = (dir, re = /\.js$/) => (fs.existsSync(path.join(ROOT, dir)) ? fs.readdirSync(path.join(ROOT, dir)).filter((n) => re.test(n)).map((n) => `${dir}/${n}`) : []);
const FILES = [
  ...list('server'), ...list('public'), ...list('public/sdk'),
  ...(fs.existsSync(path.join(ROOT, 'modules')) ? fs.readdirSync(path.join(ROOT, 'modules')).flatMap((m) => list(`modules/${m}/src`)) : []),
];
// A raw control byte inside a module's source (a NUL in a regular expression, say) survives a plain syntax check but is turned
// into U+FFFD when the build inlines the script into the page, and the page dies. Write such characters as escapes.
const RAW = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;
let rawBytes = 0;
for (const dir of fs.existsSync(path.join(ROOT, 'modules')) ? fs.readdirSync(path.join(ROOT, 'modules')) : []) {
  for (const f of list(`modules/${dir}/src`, /\.(js|css|html)$/)) {
    if (RAW.test(fs.readFileSync(path.join(ROOT, f), 'utf8'))) { rawBytes += 1; console.error(`${f}: has a raw control character; write it as an escape (\\x00)`); }
  }
}
// A page whose content security policy allows scripts from this site only ("script-src 'self'", no 'unsafe-inline')
// never runs an inline <script>: the browser blocks it without a word on the page (#18, bad-link.html). Its script goes in a file.
let inline = 0;
for (const f of list('public', /\.html$/)) {
  const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(html);
  const scriptSrc = csp && /(?:^|;)\s*script-src([^;]*)/.exec(csp[1]);
  if (!scriptSrc || /'unsafe-inline'/.test(scriptSrc[1])) continue;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    // One the policy names by its hash (space.html's import map) is allowed, as long as the hash still matches.
    const hash = `'sha256-${crypto.createHash('sha256').update(m[2]).digest('base64')}'`;
    if (!/\bsrc=/.test(m[1]) && m[2].trim() && !scriptSrc[1].includes(hash)) {
      inline += 1;
      console.error(`${f}: an inline <script> its content security policy blocks; move it to a file and load it with src=`);
    }
  }
}
// Print puts a PDF in a hidden frame whose src is a blob: URL (file-viewer.js printBlob). A page that can mount a module
// (the pop-out, a destination page) names blob: in frame-src, or the browser blocks the frame and Print prints an error
// page. No other directive on any page takes blob: for frames, and no other page needs it (#401). keyed.html does not
// name blob: for frames (its img-src, media-src and worker-src already do, as before): keyed viewers (access key, no session) are refused by the library routes, so Print can't work there.
let blobFrames = 0;
const PRINT_PAGES = new Set(['module.html', 'destination.html']);
for (const f of list('public', /\.html$/)) {
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  if (!csp) continue;
  const frame = /(?:^|;)\s*frame-src([^;]*)/.exec(csp[1]);
  if (PRINT_PAGES.has(path.basename(f)) !== !!(frame && /\bblob:/.test(frame[1]))) {
    blobFrames += 1; console.error(`${f}: frame-src ${PRINT_PAGES.has(path.basename(f)) ? 'must' : 'must not'} name blob: (Print uses a blob: frame)`);
  }
  if (path.basename(f) === 'keyed.html' && /(?:^|;)\s*(?:frame-src|child-src|default-src)[^;]*\bblob:/.test(csp[1])) {
    blobFrames += 1; console.error(`${f}: must not name blob: in frame-src, child-src or default-src (keyed viewers cannot reach library files, so Print never runs there)`);
  }
  if (path.basename(f) === 'space.html') continue; // its child-src already covers the frame
  if (/blob:/.test(csp[1].replace(/(?:^|;)\s*(?:frame-src|img-src|media-src|worker-src|child-src)[^;]*/g, ''))) {
    blobFrames += 1; console.error(`${f}: blob: appears in a directive besides frame-src, img-src, media-src, worker-src and child-src`);
  }
}
// A field for a password, secret, token or key is a masked input (type="password"), never plain text a person nearby can
// read (#61). Said by its id or name (new-password, a "key" field) or by the words of the <label> it sits in.
const SECRET_NAME = /(?:^|[-_])(?:password|passwd|passphrase|secret|token|api-?key|key)(?:[-_](?:field|input|value|box|text))?$/i;
const SECRET_LABEL = /\b(?:password|passphrase|secret|token|(?:api|access|stream|private|license|auth|encryption)\s+key)\b|^\s*key\s*$/i;
// accessKey -> access-key, so a camelCase id is read like a hyphenated one.
const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2');
// An attribute's value, however it is quoted ("x", 'x' or bare), or undefined.
function attrOf(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}
const words = (html) => html.replace(/<[^>]*>/g, ' ');
function unmaskedSecretInputs(text) {
  const found = [];
  // Labels joined to their field by for="id", anywhere in the file.
  const forLabels = new Map();
  for (const m of text.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)) {
    const id = attrOf(` ${m[1]}`, 'for');
    if (id) forLabels.set(id, `${forLabels.get(id) || ''} ${words(m[2])}`);
  }
  // The words of any element with an id, for aria-labelledby.
  const byId = new Map();
  for (const m of text.matchAll(/<(\w+)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const id = attrOf(` ${m[2]}`, 'id');
    if (id) byId.set(id, words(m[3]));
  }
  for (const m of text.matchAll(/<(?:input|textarea)\b[^>]*>/gi)) {
    const tag = m[0];
    const attr = (n) => attrOf(tag, n);
    const type = (attr('type') || 'text').toLowerCase();
    if (type !== 'text') continue; // password already, or a checkbox, number, url... (and a type built at run time)
    const before = text.slice(Math.max(0, m.index - 300), m.index);
    const open = before.toLowerCase().lastIndexOf('<label');
    const label = open >= 0 && !before.slice(open).toLowerCase().includes('</label>') ? words(before.slice(open)) : '';
    const id = attr('id') || '';
    const labelledby = (attr('aria-labelledby') || '').split(/\s+/).map((i) => byId.get(i) || '').join(' ');
    const secret = SECRET_NAME.test(kebab(id)) || SECRET_NAME.test(kebab(attr('name') || ''))
      || SECRET_LABEL.test(labelledby) || (attr('placeholder') || '').trim().split(/\s+/).length <= 3 && SECRET_LABEL.test(attr('placeholder') || '')
      || SECRET_LABEL.test(label) || SECRET_LABEL.test(forLabels.get(id) || '') || SECRET_LABEL.test(attr('aria-label') || '')
      || /^(?:new|current)-password$/i.test(attr('autocomplete') || '');
    if (secret) found.push(tag);
  }
  return found;
}
// The rule's own cases, so a loosened or tightened pattern shows here first.
for (const [html, want] of [
  ['<label>Password<input id="x" type="text"></label>', 1], ['<label>New password<input id="p"></label>', 1],
  ['<input id="new-password" type="text">', 1], ['<input name="key" type="text">', 1], ['<input id="api-token">', 1],
  ["<input id='new-password' type='text'>", 1], ["<input name='secret'>", 1], ['<input id=api-key>', 1],
  ['<label for="pw">Password</label><p>more</p><input id="pw" type="text">', 1],
  ['<input id="f1" aria-label="Password">', 1], ['<input id="f2" type="text" autocomplete="new-password">', 1],
  ['<input id="f3" autocomplete="current-password">', 1], ['<input id="access-key-field" type="text">', 1],
  ['<label>Access key<input id="a"></label>', 1], ['<LABEL>Stream key<INPUT id="s" type="text"></LABEL>', 1],
  ['<input id="accessKey" type="text">', 1], ['<input name="streamKey">', 1], ['<input placeholder="Password">', 1],
  ['<span id="l1">Password</span><input aria-labelledby="l1">', 1], ['<textarea id="privateKey"></textarea>', 1],
  ['<label>Access key<textarea id="a"></textarea></label>', 1], ['<input id="monkeyKey2" type="password">', 0],
  ['<span id="l2">Name</span><input aria-labelledby="l2">', 0], ['<textarea id="notes"></textarea>', 0],
  ['<label>Password<input id="p" type="password"></label>', 0], ['<label>Hotkey<input id="hotkey-mute" type="text"></label>', 0],
  ["<label>Password<input id='p' type='password'></label>", 0], ['<input id="x" type="password" autocomplete="new-password">', 0],
  ['<input type="checkbox" data-key="x">', 0], ['<label>Login<input id="login" type="text"></label>', 0],
  ['<label class="sdk-choice-row"><input id="new-link" type="checkbox"> Personal link (no password needed)</label>', 0],
  ['<label>Monkey<input id="monkey" type="text"></label>', 0], ['<input id="hotkey-field" type="text">', 0],
  ['<label for="login">Login</label><input id="login"><label for="pw">Password</label><input id="pw" type="password">', 0],
  ['<input id="search" aria-label="Search" autocomplete="username">', 0], ['<input id="keyword-input" type="text">', 0],
]) {
  if (unmaskedSecretInputs(html).length !== want) { console.error(`check-syntax: the unmasked-secret rule is wrong about ${html}`); process.exit(1); }
}
let unmasked = 0;
for (const f of [...list('public', /\.(html|js)$/), ...list('public/sdk'), ...(fs.existsSync(path.join(ROOT, 'modules')) ? fs.readdirSync(path.join(ROOT, 'modules')).flatMap((m) => list(`modules/${m}/src`, /\.(js|html)$/)) : [])]) {
  for (const tag of unmaskedSecretInputs(fs.readFileSync(path.join(ROOT, f), 'utf8'))) {
    unmasked += 1;
    console.error(`${f}: a password, secret or key field shown as plain text; make it type="password": ${tag}`);
  }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-check-'));
let failed = rawBytes + blobFrames + inline + unmasked;
for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  const source = fs.readFileSync(file, 'utf8');
  let target = file;
  if (/^\s*(import|export)\s/m.test(source)) {
    target = path.join(tmp, rel.replace(/[\\/]/g, '__').replace(/\.js$/, '.mjs'));
    fs.writeFileSync(target, source);
  }
  const run = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
  if (run.status !== 0) {
    failed += 1;
    console.error(`${rel}:\n${run.stderr.replace(new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), rel)}`);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
// A module page as the browser gets it: the build (server/module-build.js) puts its library -- src/<id>-lib.js, then
// src/<id>-lib-*.js by name -- where the page's script has the placeholder comment, inside the page's own function. Each
// file parses on its own, but a name declared in a library and again in the page ("const addDays" and "function addDays")
// stops the whole page, which then never loads. So each page that takes the library is parsed once with it spliced in.
let pages = 0;
const LIB_MARK = '/*__LIB__*/';
for (const id of fs.existsSync(path.join(ROOT, 'modules')) ? fs.readdirSync(path.join(ROOT, 'modules')) : []) {
  const src = path.join(ROOT, 'modules', id, 'src');
  if (!fs.existsSync(src)) continue;
  const libFile = `${id}-lib.js`;
  const libNames = fs.readdirSync(src).filter((f) => f === libFile || (f.startsWith(`${id}-lib-`) && f.endsWith('.js')))
    .sort((x, y) => (x === libFile ? -1 : y === libFile ? 1 : x.localeCompare(y)));
  if (!libNames.length) continue;
  const lib = libNames.map((f) => fs.readFileSync(path.join(src, f), 'utf8')).join('\n');
  for (const page of fs.readdirSync(src).filter((f) => f.endsWith('.js') && !libNames.includes(f))) {
    const code = fs.readFileSync(path.join(src, page), 'utf8');
    if (!code.includes(LIB_MARK)) continue;
    pages += 1;
    try {
      new vm.Script(code.replace(LIB_MARK, () => lib), { filename: `modules/${id}/src/${page}` });
    } catch (err) {
      failed += 1;
      console.error(`modules/${id}/src/${page} with ${libNames.join(', ')} spliced in as the build does: ${err.message}`);
    }
  }
}
if (failed) process.exit(1);
console.log(`check-syntax: OK (${FILES.length} files, ${pages} module pages with their library)`);
