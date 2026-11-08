#!/usr/bin/env node
/*
 * check-product-pages.mjs -- the product's pages at the bare base domain (documentation/plans/plan-product-pages.md,
 * decision 8): public/landing.html (the front page) and each use page (public/travel.html, games.html, projects.html) share one header, footer and
 * sign-in block, and the page head's fixed lines. Sign in is a typed address and Go: no page lists environments or takes a password to sign in (plan-product-site.md, slice 0). They are plain files with no build step, so this check is what keeps
 * the copies the same. Also: every use page file is in server/index.js's PRODUCT_PAGES table, and each page has its own
 * <title> and description. The routing itself (200, 404, `pages`) is checked in check-origin.mjs.
 * Go opens only the environment whose cleaned slug passed the shape test and the lookup: read from public/landing.js,
 * and live in headless Chromium (CHROME_PATH) against a throwaway server, where an address with another site's name after
 * the slug never leaves the base domain. Without Chromium the live part says SKIPPED (not a pass).
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

// Go opens only the checked environment: the Sign in handler (public/landing.js) cleans the field to a slug once, tests
// its shape, looks it up, and only then navigates, to envUrl(slug) and nowhere else. envUrl puts the slug in front of the
// base domain and nothing else. Across the whole script the only navigations are that one and sign-up's answer.
const NAVIGATES = /\blocation(?:\.href)?\s*=(?!=)|\blocation\.(?:assign|replace)\s*\(|\bwindow\.open\s*\(/g;
export function goProblems(js) {
  const problems = [];
  const envUrl = "const envUrl = (slug, path = '/login') => `${location.protocol}//${slug}.${product.baseDomain}${location.port ? `:${location.port}` : ''}${path}`;";
  if (!js.includes(envUrl)) problems.push('envUrl is not the slug in front of the base domain');
  const handler = /signinForm\.addEventListener\('submit', async \(e\) => \{([\s\S]*?)\n {2}\}\);/.exec(js);
  if (!handler) return [...problems, 'no Sign in handler'];
  const body = handler[1];
  const at = (s) => body.indexOf(s);
  const clean = at('const slug = addressSlug(field.value);');
  const shape = at('if (!slugOk(slug)) {');
  const lookup = at('await fetch(`/api/product/environment?slug=${encodeURIComponent(slug)}`)');
  const missing = at('if (res.status === 404) {');
  const go = at('location.href = envUrl(slug);');
  if (clean < 0) problems.push('the slug is not cleaned from the field once, by addressSlug');
  if ((body.match(/field\.value/g) || []).length !== 1) problems.push('the handler reads the field more than once');
  if (/(?<![\w?&.$])slug\s*=(?!=)/.test(body.replace('const slug = addressSlug(field.value);', ''))) problems.push('the slug is changed after it is cleaned');
  if (shape < 0 || shape < clean) problems.push('the slug\'s shape is not tested before the lookup');
  if (lookup < 0 || lookup < shape) problems.push('the slug is not looked up');
  if (missing < 0 || missing < lookup) problems.push('an unknown address does not stop Go');
  const navigations = body.match(NAVIGATES) || [];
  if (go < 0 || go < missing || navigations.length !== 1) problems.push(`Go does not open envUrl(slug) alone, after the lookup (${navigations.length} navigations)`);
  const all = [...js.matchAll(new RegExp(`^.*(?:${NAVIGATES.source}).*$`, 'gm'))].map((m) => m[0].trim());
  const allowed = ['location.href = envUrl(slug);', "location.href = data.url || envUrl(body.slug, '/login');"];
  for (const line of all) if (!allowed.includes(line)) problems.push(`another navigation: ${line}`);
  return problems;
}
test('Go opens only envUrl(slug), with the slug that passed the shape test and the lookup', () => {
  const js = fs.readFileSync(path.join(PUBLIC, 'landing.js'), 'utf8');
  assert.deepEqual(goProblems(js), []);
  for (const [what, bad, re] of [
    ['the slug changed', js.replace('location.href = envUrl(slug);', 'slug = slug.replace(/x/, \'.\'); location.href = envUrl(slug);'), /changed after it is cleaned/],
    ['the raw field', js.replace('location.href = envUrl(slug);', 'location.href = envUrl(field.value);'), /Go does not open envUrl\(slug\)|another navigation/],
    ['the field read again', js.replace('location.href = envUrl(slug);', 'location.href = envUrl(addressSlug(field.value));'), /reads the field more than once/],
    ['no lookup', js.replace('const res = await fetch(`/api/product/environment?slug=${encodeURIComponent(slug)}`);', 'const res = { ok: true, status: 200 };'), /not looked up/],
    ['a second navigation', js.replace('location.href = envUrl(slug);', 'location.href = envUrl(slug); window.open(field.value);'), /navigations|another navigation/],
    ['a navigation elsewhere', js.replace('function start() {', 'function start() {\n  if (location.hash) location.assign(location.hash.slice(1));'), /another navigation/],
    ['envUrl changed', js.replace('${slug}.${product.baseDomain}', '${slug}'), /envUrl/],
  ]) {
    assert.notEqual(bad, js, `${what}: the change did not apply`);
    const found = goProblems(bad);
    assert.ok(found.some((p) => re.test(p)), `${what}: ${found.join(' | ') || 'no problem found'}`);
  }
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

// --- live: Go, in a browser (headless Chromium over the DevTools protocol, tools/shots.mjs) ---------------------------
// A throwaway server with BASE_DOMAIN=localhost (Chromium sends localhost and every *.localhost to this machine) and one
// environment, acme. On the front page, each typed address is put in the field and Go pressed; every page the tab then
// asks for is recorded (one outside the base domain is stopped before it goes out). acme followed by another site's name
// opens acme's own /login and nothing else; an unknown name opens nothing. With no Chromium it says SKIPPED (not a pass).
const { findBrowser, launch, freePort, sleep } = await import('./shots.mjs');
const bin = findBrowser();
if (!bin) {
  console.log('check-product-pages: live Go SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.');
} else {
  const { spawn } = await import('node:child_process');
  const os = await import('node:os');
  const http = await import('node:http');
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-product-pages-'));
  let log = '';
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), DATA_DIR: dataDir, BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'host', ADMIN_PASSWORD: 'hostpass1234', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret' },
  });
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  // One request by Host header: { status, json, cookies }.
  const call = (method, host, urlPath, body, headers = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: { host: `${host}:${port}`, accept: 'application/json', ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}), ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ } resolve({ status: res.statusCode, json, text, cookies: (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]) }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
  let browser = null;
  try {
    const end = Date.now() + 25000;
    while (!/listening on :\d+/.test(log)) {
      if (child.exitCode !== null || Date.now() > end) throw new Error(`the throwaway server did not start:\n${log.slice(-600)}`);
      await sleep(100);
    }
    const signedIn = await call('POST', 'admin.localhost', '/api/host/login', { login: 'host', password: 'hostpass1234' });
    assert.equal(signedIn.status, 200, signedIn.text);
    const made = await call('POST', 'admin.localhost', '/api/host/environments', { slug: 'acme', name: 'Acme', owner: { login: 'ownacme', password: 'ownerpass1234' } }, { cookie: signedIn.cookies.join('; ') });
    assert.equal(made.status, 201, made.text);

    browser = await launch(bin);
    const { browserContextId } = await browser.cdp.send('Target.createBrowserContext');
    const { targetId } = await browser.cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await browser.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => browser.cdp.send(m, p, sessionId);
    await s('Page.enable');
    await s('Runtime.enable');
    // Every page the tab asks for is recorded; one outside the base domain is failed before it leaves the machine.
    const opened = [];
    const inBase = (u) => { try { const h = new URL(u).hostname; return h === 'localhost' || h.endsWith('.localhost'); } catch { return false; } };
    browser.cdp.listeners.push((m) => {
      if (m.method !== 'Fetch.requestPaused' || m.sessionId !== sessionId) return;
      const { requestId, request, resourceType } = m.params;
      if (resourceType === 'Document') opened.push(request.url);
      const next = resourceType === 'Document' && !inBase(request.url) ? s('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }) : s('Fetch.continueRequest', { requestId });
      next.catch(() => {});
    });
    await s('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    const evaluate = async (expr) => {
      const r = await s('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      return r.result.value;
    };
    const front = `http://localhost:${port}/`;
    const acmeLogin = `http://acme.localhost:${port}/login`;
    const pressGo = async (typed) => {
      await s('Page.navigate', { url: front });
      const ready = Date.now() + 15000;
      while (!(await evaluate("location.href === '" + front + "' && document.querySelector('[data-signin-domain]')?.textContent === '.localhost' && !document.getElementById('signin-env').disabled").catch(() => false))) {
        if (Date.now() > ready) throw new Error(`the front page did not get its base domain (${typed})`);
        await sleep(100);
      }
      opened.length = 0;
      await evaluate("document.getElementById('signin-env').focus()");
      await s('Input.insertText', { text: typed });
      await evaluate("document.getElementById('signin-go').click()");
      // Until a page is asked for, or the note answers, or two seconds have passed.
      const wait = Date.now() + 2000;
      while (Date.now() < wait && !opened.length && !(await evaluate("!document.getElementById('signin-note').hidden").catch(() => false))) await sleep(50);
      await sleep(300);
      return [...opened];
    };
    const problems = [];
    for (const typed of ['acme', 'acme.evil.example', 'acme@evil.example', 'acme/..//evil.example', `https://acme.localhost:${port}/admin`, 'ACME.evil.example:443/x']) {
      const went = await pressGo(typed);
      if (went.some((u) => !inBase(u))) problems.push(`${typed}: left the base domain for ${went.join(', ')}`);
      if (went.length !== 1 || went[0] !== acmeLogin) problems.push(`${typed}: opened ${went.join(', ') || 'nothing'}, not ${acmeLogin} alone`);
    }
    for (const typed of ['evil.example', 'https://evil.example', '//evil.example', 'nope@acme']) {
      const went = await pressGo(typed);
      if (went.length) problems.push(`${typed}: opened ${went.join(', ')}, not nothing`);
    }
    assert.deepEqual(problems, [], 'Go opens only the looked-up environment\'s own sign-in');
    n += 1;
  } finally {
    if (browser) {
      const done = new Promise((r) => browser.child.once('exit', r));
      browser.child.kill('SIGTERM'); // this browser only
      await Promise.race([done, sleep(5000)]);
      try { fs.rmSync(browser.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a browser still closing may hold its profile a moment longer: the folder is left, not a failure */ }
    }
    await new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

console.log(`check-product-pages: ${n} OK (${files.join(', ')})`);
