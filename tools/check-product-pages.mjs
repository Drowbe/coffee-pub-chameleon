#!/usr/bin/env node
/*
 * check-product-pages.mjs -- the product's pages at the bare base domain (documentation/plans/plan-product-pages.md,
 * decision 8): public/landing.html (the front page) and each use page (public/travel.html, games.html, projects.html) share one header, footer and
 * sign-in block, and the page head's fixed lines. Sign in is a typed address and Go: no page lists environments or takes a password to sign in (plan-product-site.md, slice 0). They are plain files with no build step, so this check is what keeps
 * the copies the same. Also: every use page file is in server/index.js's PRODUCT_PAGES table, and each page has its own
 * <title> and description. The routing itself (200, 404, `pages`) is checked in check-origin.mjs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const USE_PAGES = ['travel.html', 'games.html', 'projects.html'];
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const one = (html, re) => { const m = re.exec(html); return m ? squash(m[0]) : null; };

// The shared blocks of a page: name -> its text (whitespace squashed), or null when the page does not have it.
export function blocksOf(html) {
  return {
    'viewport': one(html, /<meta name="viewport"[^>]*>/),
    'content security policy': one(html, /<meta http-equiv="Content-Security-Policy"[^>]*>/),
    'stylesheet': one(html, /<link rel="stylesheet" href="\/landing\.css">/),
    'script': one(html, /<head>[\s\S]*<script src="\/landing\.js"><\/script>[\s\S]*<\/head>/) && '<script src="/landing.js"></script> in <head>',
    'theme meta': one(html, /<meta name="color-scheme"[^>]*>\s*<meta name="theme-color"[^>]*>/),
    'brand': one(html, /<a class="brand"[^>]*>[\s\S]*?<\/a>/),
    'light / dark switch': one(html, /<header class="top">[\s\S]*?<button [^>]*id="theme-switch"[^>]*>[\s\S]*?<\/button>[\s\S]*?<\/header>/) && one(html, /<button [^>]*id="theme-switch"[^>]*>[\s\S]*?<\/button>/),
    'sign in button': one(html, /<a [^>]*id="nav-signin"[^>]*>[\s\S]*?<\/a>/),
    'get started button': one(html, /<a [^>]*data-contact-link[^>]*>[\s\S]*?<\/a>/),
    'sign-in section': one(html, /<section id="signin"[\s\S]*?<\/section>/),
    'footer': one(html, /<footer class="foot">[\s\S]*?<\/footer>/),
  };
}

// Blocks a page must have but may word differently: a use page's Get started goes to the front page's form (decision 9).
const MAY_DIFFER = new Set(['get started button']);

// The problems among pages ({ name: html }): a block a page lacks, or one that differs from the front page's.
export function problemsOf(pages) {
  const problems = [];
  const names = Object.keys(pages);
  const reference = blocksOf(pages[names[0]]);
  for (const name of names) {
    const html = pages[name];
    const blocks = blocksOf(html);
    for (const [block, text] of Object.entries(blocks)) {
      if (text === null) problems.push(`${name}: the ${block} is missing.`);
      else if (!MAY_DIFFER.has(block) && reference[block] !== null && text !== reference[block]) problems.push(`${name}: the ${block} differs from ${names[0]}'s.`);
    }
    const title = one(html, /<title[^>]*>[\s\S]*?<\/title>/);
    const description = /<meta name="description" content="([^"]+)"/.exec(html);
    if (!title) problems.push(`${name}: it has no <title>.`);
    if (!description) problems.push(`${name}: it has no meta description.`);
    if (/href="#signin"/.test(html) && !blocks['sign-in section']) problems.push(`${name}: it links to #signin but has no sign-in section.`);
  }
  const titles = names.map((n) => one(pages[n], /<title[^>]*>[\s\S]*?<\/title>/));
  const descriptions = names.map((n) => (/<meta name="description" content="([^"]+)"/.exec(pages[n]) || [])[1]);
  if (new Set(titles).size !== titles.length) problems.push('Two pages share a <title>.');
  if (new Set(descriptions).size !== descriptions.length) problems.push('Two pages share a description.');
  return problems;
}

let n = 0;
const test = (name, fn) => { fn(); n += 1; };

const files = fs.readdirSync(PUBLIC).filter((f) => f === 'landing.html' || USE_PAGES.includes(f)).sort((a, b) => (a === 'landing.html' ? -1 : b === 'landing.html' ? 1 : a.localeCompare(b)));
const pages = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(PUBLIC, f), 'utf8')]));

test('the front page is there', () => assert.equal(files[0], 'landing.html'));
test('the product pages share the header, sign-in and footer blocks', () => assert.deepEqual(problemsOf(pages), []));
test('every use page is in the server\'s table', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  const table = /const PRODUCT_PAGES = \[([\s\S]*?)\];/.exec(src);
  assert.ok(table, 'PRODUCT_PAGES in server/index.js');
  for (const f of files.slice(1)) assert.ok(table[1].includes(`file: '${f}'`), `${f} has no row in PRODUCT_PAGES`);
});

// The check itself: it fails on a changed footer, a missing block and a shared title.
test('it fails on a changed footer', () => {
  const [front, ...rest] = files;
  const second = rest[0] || front;
  const changed = pages[second].replace('Self-host it', 'Host it yourself');
  const found = problemsOf({ [front]: pages[front], 'changed.html': changed.replace('<title', '<title data-x="1"').replace(/<meta name="description" content="[^"]*"/, '<meta name="description" content="Another."') });
  assert.ok(found.some((p) => /changed\.html: the footer differs/.test(p)), found.join(' | '));
});
test('it fails on a missing sign-in section, a changed brand and a shared title', () => {
  const front = pages['landing.html'];
  const found = problemsOf({ 'landing.html': front, 'a.html': front.replace(/<section id="signin"[\s\S]*?<\/section>/, '').replace('class="brand"', 'class="mark"') });
  assert.ok(found.some((p) => /a\.html: the sign-in section is missing/.test(p)), found.join(' | '));
  assert.ok(found.some((p) => /a\.html: the brand is missing/.test(p)), found.join(' | '));
  assert.ok(found.some((p) => /Two pages share a <title>/.test(p)), found.join(' | '));
});
test('it fails on a page without the Light / Dark switch, or with the script out of <head>', () => {
  const front = pages['landing.html'];
  const bare = front.replace(/<button [^>]*id="theme-switch"[\s\S]*?<\/button>/, '').replace('<script src="/landing.js"></script>', '').replace('</body>', '<script src="/landing.js"></script></body>');
  const found = problemsOf({ 'landing.html': front, 'b.html': bare.replace('<title', '<title data-x="1"').replace(/<meta name="description" content="[^"]*"/, '<meta name="description" content="Other."') });
  assert.ok(found.some((p) => /b\.html: the light \/ dark switch is missing/.test(p)), found.join(' | '));
  assert.ok(found.some((p) => /b\.html: the script is missing/.test(p)), found.join(' | '));
});

// Light by default, whatever the browser prefers: dark is keyed on <html data-theme="dark">, which landing.js sets before the
// first paint from the visitor's own choice, never on prefers-color-scheme; the switch names what it turns the page to.
test('light or dark is chosen, not followed from the browser', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'landing.css'), 'utf8');
  const js = fs.readFileSync(path.join(PUBLIC, 'landing.js'), 'utf8');
  assert.ok(!/prefers-color-scheme/.test(css), 'landing.css follows prefers-color-scheme');
  assert.ok(/:root\[data-theme="dark"\] \.landing \{[^}]*--l-bg:/.test(css), 'landing.css: the dark palette is not keyed on [data-theme="dark"]');
  for (const f of files) assert.ok(!/prefers-color-scheme/.test(pages[f]), `${f} follows prefers-color-scheme`);
  for (const f of files) assert.ok(/<meta name="color-scheme" content="light">/.test(pages[f]), `${f}: color-scheme is not light`);
  for (const f of files) assert.ok(/id="theme-switch"[^>]*aria-label="Dark"[^>]*title="Dark"/.test(pages[f]), `${f}: the switch has no name`);
  const early = js.slice(0, js.indexOf('function themeSwitch'));
  assert.ok(/^setTheme\(savedTheme\(\)\);$/m.test(early), 'landing.js does not set the theme before the page is read');
  assert.ok(/localStorage\.getItem[\s\S]*catch/.test(early), 'landing.js: reading the saved theme is not wrapped');
  assert.ok(/return 'light';/.test(early), 'landing.js: light is not the default');
});

// The bar's Sign in reads "Sign in" for everyone and goes to the Sign in section; it never names an environment.
test('the bar names no environment', () => {
  const js = fs.readFileSync(path.join(PUBLIC, 'landing.js'), 'utf8');
  for (const f of files) assert.ok(/<a class="btn btn-quiet" href="#signin" id="nav-signin">Sign in<\/a>/.test(pages[f]), `${f}: the bar's Sign in is not plain`);
  assert.ok(!/nav-signin/.test(js), 'landing.js changes the bar\'s Sign in');
});

// plan-product-site.md, slice 0 (decisions 1 and 3): Sign in is a typed address and Go. No page lists environments, takes a
// password to sign in, or posts a form to an environment's /login. The one password field left is sign-up's, for the new
// owner's account, posted to this host's own /api/product/signup.
export function signinProblems(name, html) {
  const problems = [];
  const section = one(html, /<section id="signin"[\s\S]*?<\/section>/) || '';
  const outsideSignup = html.replace(/<form class="signup-form"[\s\S]*?<\/form>/, '');
  if (/type="password"/i.test(outsideSignup)) problems.push(`${name}: it has a password field outside sign-up.`);
  if (/current-password/i.test(html)) problems.push(`${name}: it asks for a current password.`);
  if (/<form\b[^>]*\baction="[^"]*login/i.test(html)) problems.push(`${name}: a form posts to a sign-in.`);
  if (/<form\b[^>]*\bmethod="post"/i.test(html)) problems.push(`${name}: a form posts by itself, not through the page's script.`);
  if (/<select\b/i.test(section)) problems.push(`${name}: Sign in has a list to choose from.`);
  if (!/<label for="signin-env">[^<]+<\/label>/.test(section) || !/<input id="signin-env"[^>]*type="text"/.test(section) || !/data-signin-domain/.test(section)) problems.push(`${name}: Sign in has no typed address with the base domain after it.`);
  return problems;
}
test('Sign in is a typed address: no list, no password, no form post to /login', () => {
  for (const f of files) assert.deepEqual(signinProblems(f, pages[f]), [], f);
  const js = fs.readFileSync(path.join(PUBLIC, 'landing.js'), 'utf8');
  assert.ok(!/\/api\/product\/environments/.test(js), 'landing.js asks for the list of environments');
  assert.ok(/\/api\/product\/environment\?slug=/.test(js), 'landing.js does not check the typed address');
  assert.ok(!/form\.action\s*=/.test(js), 'landing.js points a form somewhere');
});
test('the Sign in check fails on the old dropdown and password post', () => {
  const old = '<section id="signin" class="signin"><form class="signin-form" id="signin-form" method="post" action="https://x.example.com/login"><select id="signin-env"></select><input id="signin-password" name="password" type="password" autocomplete="current-password"></form></section>';
  const found = signinProblems('old.html', pages['landing.html'].replace(/<section id="signin"[\s\S]*?<\/section>/, old));
  for (const re of [/password field outside sign-up/, /current password/, /posts to a sign-in/, /posts by itself/, /list to choose from/, /no typed address/]) assert.ok(found.some((p) => re.test(p)), `${re}: ${found.join(' | ')}`);
});

// The sign-up name note (public/landing.js slugChecker) and the host console's Sign-up line (public/host.js signupFact),
// run from their source with stubs.
const fromSource = (file, name) => {
  const src = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
  const m = new RegExp(`^function ${name}\\([\\s\\S]*?^}$`, 'm').exec(src);
  assert.ok(m, `${name} in public/${file}`);
  return new Function(`${m[0]}; return ${name};`)();
};
const slugChecker = fromSource('landing.js', 'slugChecker');
const signupFact = fromSource('host.js', 'signupFact');
const addressSlug = fromSource('landing.js', 'addressSlug');
test('Sign in cleans what is typed to a slug: lower case, trimmed, a pasted address cut to its first label', () => {
  for (const [typed, slug] of [['acme', 'acme'], ['  Acme ', 'acme'], ['acme.example.com', 'acme'], ['https://Acme.example.com/login?x=1', 'acme'], ['acme.example.com:3000/', 'acme'], ['http://acme', 'acme'], ['', ''], ['   ', '']]) {
    assert.equal(addressSlug(typed), slug, JSON.stringify(typed));
  }
});
{
  const timers = [];
  const wait = (fn) => { timers.push(fn); return timers.length; };
  const cancel = (id) => { if (id) timers[id - 1] = null; };
  const run = async () => { for (const [i, fn] of timers.entries()) if (fn) { timers[i] = null; await fn(); } };
  let note = '';
  let reply = { ok: true, json: async () => ({ free: true }) };
  const check = slugChecker({ say: (t) => { note = t; }, hint: 'HINT', slugOk: (s) => /^[a-z0-9-]{3,30}$/.test(s), baseDomain: 'x.test', get: async () => reply, wait, cancel });
  check('abc'); await run();
  assert.equal(note, 'abc.x.test is free.');
  check('abcd'); assert.equal(note, 'HINT', 'typing clears the old answer during the pause');
  reply = { ok: false, json: async () => ({}) };
  await run();
  assert.equal(note, 'HINT', 'a 429 leaves no answer for an earlier name');
  reply = { ok: true, json: async () => ({ free: true }) };
  check('abcde'); check('ab'); await run();
  assert.equal(note, 'HINT', 'a name too short shows the hint');
  n += 1;
}
test('the host Sign-up line names the product host when it is not the base domain', () => {
  assert.equal(signupFact({ signup: true, baseDomain: 'a.test', productDomain: 'a.test' }), 'on, at the base domain, on the free plan');
  assert.equal(signupFact({ signup: true, baseDomain: 'a.test', productDomain: 'p.a.test' }), 'on, at p.a.test, on the free plan');
  assert.equal(signupFact({ signup: false, baseDomain: 'a.test', productDomain: 'p.a.test' }), 'off (SIGNUP=off)');
});

console.log(`check-product-pages: ${n} OK (${files.join(', ')})`);
