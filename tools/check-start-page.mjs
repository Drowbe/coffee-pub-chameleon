#!/usr/bin/env node
/*
 * check-start-page.mjs -- the start page (public/start.html, start.js, start.css; documentation/plans/plan-product-site.md,
 * slices 4 and 5) that replaced the product host's marketing pages. Two parts.
 *
 * 1. Read from the files (startProblems). The page is: a typed address with the base domain after it and Go, checked as the person
 *    types (GET /api/product/environment?slug=, after a pause); Recent under the address in one wide band, not drawn when empty; no sign-up
 *    form on the page and no password field anywhere; exactly one link out, from PRODUCT_SITE_URL (nothing written in the page); no demo;
 *    Go and Recent open only envUrl(slug); the header is the studio's (the 56px mark, "Coffee Pub" in the display face and bold, the
 *    product's name in coral at 24px or larger, a round theme button). The server has no use pages (PRODUCT_PAGES, livePages), no
 *    `pages` in /api/product, and the old files are gone. The same rules are run on planted copies of the OLD front page's habits
 *    (a password box, a dropdown of environments, a demo button, several links out, a check only on Go) and must fail on each.
 * 2. Live, in headless Chromium against a throwaway hosted server (BASE_DOMAIN=localhost, SIGNUP=on, PRODUCT_SITE_URL set; Chromium
 *    sends localhost and every *.localhost to this machine): at 1280 and 390 wide, the header (sticky), the one wide band, no sideways scroll,
 *    the name shown as the address is typed, one request for a fast typist, Enter before the name is found waiting and going,
 *    Recent (written, under the field, removed), the 429 sentence, light and dark, one
 *    external link, no password field. And a bad PRODUCT_SITE_URL refuses to start.
 * With no Chromium the live part says SKIPPED (not a pass), and fails when CI is set.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findBrowser, launch, freePort, sleep } from './shots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const say = (...a) => console.log('check-start-page:', ...a);
const read = (root, rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } };

// ---- 1. the files ----
// The page's palette, read from start.css: { light, dark } as { '--sp-name': 'value' }, from the three :root blocks (light; the picked dark;
// the browser's dark). null if a block is missing or the two dark blocks differ.
export function paletteOf(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const vars = (body) => Object.fromEntries([...body.matchAll(/(--sp-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const light = /(?:^|\})\s*:root\s*\{([^}]*)\}/.exec(clean);
  const dark = /:root\[data-theme-mode="dark"\]\s*\{([^}]*)\}/.exec(clean);
  const auto = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme-mode="light"\]\)\s*\{([^}]*)\}/.exec(clean);
  if (!light || !dark || !auto) return null;
  const out = { light: vars(light[1]), dark: vars(dark[1]) };
  if (JSON.stringify(vars(auto[1])) !== JSON.stringify(out.dark) || !Object.keys(out.light).length || JSON.stringify(Object.keys(out.light)) !== JSON.stringify(Object.keys(out.dark))) return null;
  return out;
}

export function startProblems(root) {
  const out = [];
  const html = read(root, 'public/start.html');
  const js = read(root, 'public/start.js');
  const css = read(root, 'public/start.css');
  const server = read(root, 'server/index.js') || '';
  if (html === null || js === null || css === null) return ['public/start.html, start.js and start.css are all needed'];
  const nocomment = (t) => t.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const H = nocomment(html); const J = nocomment(js); const C = nocomment(css);
  // typed address, the base domain after it, a Go
  if (!/<input[^>]*type="text"[^>]*>/.test(H) || !/id="sp-go"/.test(H) || !/id="sp-find-suffix"/.test(H)) out.push('start.html: no typed address field with the base domain after it and a Go');
  if (/<select\b|<datalist\b/i.test(H)) out.push('start.html: a list or dropdown of environments (the address is typed)');
  // checked as you type
  if (!/\/api\/product\/environment\?slug=/.test(J)) out.push('start.js: the address is not looked up at GET /api/product/environment?slug=');
  if (!/addEventListener\('input'[\s\S]{0,700}setTimeout\([\s\S]{0,400}\b400\)/.test(J)) out.push('start.js: no check as you type after a pause (about 400 ms)');
  if (!/answers\s*=\s*new Map\(\)/.test(J) || !/while \(running\)/.test(J)) out.push('start.js: an answer is not kept, or two requests can run at once');
  if (!/status === 429/.test(J) || !/Too many tries\. Wait a minute, then try again\./.test(J)) out.push('start.js: a 429 is not told with the sentence');
  // Recent under the address, in the same band, not drawn when empty, kept in the browser by kind
  if (!(H.indexOf('id="sp-recent"') > -1 && H.indexOf('id="sp-recent"') > H.indexOf('id="sp-find"'))) out.push('start.html: Recent is not under the address');
  if (!/id="sp-recent"[^>]*\bhidden\b/.test(H)) out.push('start.html: Recent is drawn when empty (it should be hidden)');
  if (!/RECENT_KEY = 'app\.recentEnvironments'/.test(J) || !/RECENT_MAX = 5/.test(J)) out.push('start.js: Recent is not the browser\'s own list of up to 5 under a key named by kind');
  // no sign-up on the page, no password anywhere
  if (/id="signup-|id="start"|Get your own/.test(H) || /signup|api\/product\/signup/i.test(J)) out.push('start.html/start.js: the sign-up is still on the start page');
  if (/type="password"|new-password|current-password|name="password"/i.test(H + J)) out.push('start.html/start.js: a password field (the owner chooses it on the environment\'s own page)');
  // no demo
  if (/demo/i.test(H + J + C)) out.push('start.html/start.js/start.css: the demo is named (it stays hidden)');
  // exactly one link out
  // Every link out is the studio's address (productSiteUrl) with a path on it. The one exception: the footer's "Elsewhere" column, three
  // pages that are not on the studio's address (listed here, exactly).
  const ELSEWHERE = ['https://willhavebeen.com', 'https://www.patreon.com/cw/CoffeePub', 'https://github.com/Drowbe'];
  const literal = [...(H + J).matchAll(/https?:\/\/[^\s"'`)<]*/g)].map((m) => m[0]).filter((u) => !/^https?:\/\/(?:\$\{|localhost)/.test(u) && !ELSEWHERE.includes(u.replace(/['",;\]]+$/, '')));
  if (literal.length) out.push(`start.html/start.js: an address is written in the page: ${literal.join(', ')}`);
  const hrefs = [...H.matchAll(/href="([^"]*)"/g)].map((m) => m[1]).filter((u) => !/^(#|\/|mailto:)/.test(u) && u !== '');
  if (hrefs.length) out.push(`start.html: links out that are not the page's own: ${hrefs.join(', ')}`);
  const external = [...J.matchAll(/\.href\s*=\s*([^;\n]+)/g)].map((m) => m[1].trim()).filter((v) => !/^envUrl\(|^to\.href$|^`mailto:/.test(v));
  const bad = external.filter((v) => !/^product\.productSiteUrl$|^siteLink\(|^outside \? to : siteLink\(to\)$/.test(v));
  if (bad.length || !external.length || !J.includes('function siteLink(path) { return new URL(path, siteOrigin()).href; }') || !/new URL\(product\.productSiteUrl\)\.origin/.test(J)) out.push(`start.js: a link out is not built from product.productSiteUrl's origin (found: ${bad.join(' | ') || 'none'})`);
  if (!/if \(!site\) return;/.test(J)) out.push('start.js: the studio\'s parts are drawn without PRODUCT_SITE_URL');
  // Go opens only envUrl(slug)
  const goes = [...J.matchAll(/location\.href\s*=\s*([^;\n]+)/g)].map((m) => m[1].trim());
  if (goes.some((g) => !/^envUrl\(env\.slug\)$|^to\.href$/.test(g)) || !goes.some((g) => g === 'envUrl(env.slug)')) out.push(`start.js: a go that is not envUrl(slug) (found: ${goes.join(' | ')})`);
  if (!/form-action 'none'/.test(html) || /<form[^>]*\baction=/i.test(H)) out.push('start.html: a form can post somewhere (form-action must be none)');
  // the studio's header
  if (!/class="sp-mark sp-mark-light"[^>]*width="56" height="56"/.test(H) || !/class="sp-mark sp-mark-dark"[^>]*width="56" height="56"/.test(H)) out.push('start.html: the header\'s mark is not the 56px Chameleon mark, light and dark');
  if (!/\.sp-mark \{[^}]*width: 56px; height: 56px/.test(C)) out.push('start.css: the mark is not 56px');
  if (!/\.sp-lockup-brand \{[^}]*font-family: var\(--font-display\); font-weight: 700; color: var\(--sp-text\)/.test(C)) out.push('start.css: "Coffee Pub" is not Fraunces Bold in the text colour');
  if (!/\.sp-lockup-product \{[^}]*color: var\(--sp-name-coral\)/.test(C)) out.push('start.css: the product\'s name is not the name coral token');
  const size = /\.sp-lockup \{[^}]*font-size: (?:var\(--text-(\d+)\)|(\d+(?:\.\d+)?)rem)/.exec(C);
  if (!size || (size[1] ? Number(size[1]) : Number(size[2]) * 16) < 24) out.push('start.css: the lockup is under 24px, where coral may not be used');
  if (/\.sp-lockup-(?:brand|product) \{[^}]*font-size/.test(C)) out.push('start.css: the two words are not one size');
  if (!/\.sp-theme \{[^}]*border-radius: 50%/.test(C) || !/id="sp-theme"/.test(H)) out.push('start.html/css: no round theme button');
  if (!/\.sp-body \{[^}]*background: var\(--sp-bg\)/.test(C)) out.push('start.css: the page ground is not the palette\'s page colour');
  // The page has a palette of its own (the :root blocks of start.css, the studio's design system) and reads no theme: a colour is written only in those blocks.
  const outsidePalette = C.replace(/:root[^{]*\{[^}]*\}/g, '');
  if (/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab|lch)\(/i.test(outsidePalette)) out.push('start.css: a colour written outside the palette blocks (use the --sp-* names)');
  if (/var\(--(?!sp-|art-|font-ui\b|font-display\b)[\w-]+/.test(C + H)) out.push(`start.css/html: a token of the app's theme (the page has its palette; found ${(C + H).match(/var\(--(?!sp-|art-|font-ui\b|font-display\b)[\w-]+/)[0]})`);
  if (/href="\/(?:theme|style)\.css"/.test(H)) out.push('start.html: loads the app\'s theme or style sheet (the page has its own palette)');
  if (/class="[^"]*\bsdk-/.test(H) || /'[^']*\bsdk-[a-z-]*/.test(J)) out.push('start.html/start.js: a system component (sdk-*) is used; it would bring the app\'s theme colours');
  if (!paletteOf(css)) out.push('start.css: the palette (light, dark and the browser\'s dark) is not complete and matching');
  // the server
  if (/PRODUCT_PAGES|livePages|landing\.html|travel\.html|games\.html/.test(server)) out.push('server/index.js: still knows the old product pages');
  if (!/page\('start\.html'\)/.test(server)) out.push('server/index.js: the product host does not send start.html');
  if (/\bpages:\s*livePages|json\([^)]*\bpages:/.test(server)) out.push('server/index.js: /api/product still lists pages');
  if (!/PRODUCT_SITE_URL/.test(server) || !/productSiteUrl: PRODUCT_SITE/.test(server)) out.push('server/index.js: PRODUCT_SITE_URL is not read and given as productSiteUrl');
  for (const f of ['landing.html', 'landing.js', 'landing.css', 'travel.html', 'games.html']) if (fs.existsSync(path.join(root, 'public', f))) out.push(`public/${f} still exists`);
  if (fs.existsSync(path.join(root, 'public/assets/images/brand/landing'))) out.push('public/assets/images/brand/landing still exists');
  if (fs.existsSync(path.join(root, 'tools/check-product-pages.mjs'))) out.push('tools/check-product-pages.mjs still exists');
  return out;
}

// Self-test: the real files pass; copies with the old front page's habits fail, each for its own reason.
function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'start-page-'));
  const copy = () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'tree-'));
    for (const rel of ['public/start.html', 'public/start.js', 'public/start.css', 'server/index.js']) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), fs.readFileSync(path.join(ROOT, rel)));
    }
    return dir;
  };
  const change = (rel, fn) => { const dir = copy(); fs.writeFileSync(path.join(dir, rel), fn(fs.readFileSync(path.join(dir, rel), 'utf8'))); return startProblems(dir); };
  const plant = (rel, a, b) => change(rel, (t) => { assert.ok(t.includes(a) || a instanceof RegExp, `self-test: ${rel} has no ${a}`); return t.replace(a, b); });
  const cases = [
    ['a password box', () => plant('public/start.html', '<label class="sp-label" for="sp-find-input">', '<label>Password<input type="password"></label><label class="sp-label" for="sp-find-input">'), /password field/],
    ['a dropdown of environments', () => plant('public/start.html', '<section class="sp-find" id="sp-find"', '<select><option>x</option></select><section class="sp-find" id="sp-find"'), /dropdown/],
    ['a demo button', () => plant('public/start.html', '<footer class="sp-site"', '<a class="btn" href="/">Try the demo</a><footer class="sp-site"'), /demo/],
    ['a second link out', () => plant('public/start.html', '<footer class="sp-site"', '<a href="https://example.com/pricing">Pricing</a><footer class="sp-site"'), /links out|address is written/],
    ['an address written in the script', () => plant('public/start.js', "$('sp-nav-support').href = siteLink('/support');", "$('sp-nav-support').href = 'https://example.com/x';"), /one link out|address is written/],
    ['a check only on Go', () => plant('public/start.js', "find.timer = setTimeout(() => {", "find.timer = 0; (() => {"), /after a pause|check as you type/],
    ['Recent above the address', () => change('public/start.html', (t) => { const m = /(\s*<!-- Shown only when[\s\S]*?<\/section>)/.exec(t); return t.replace(m[1], '').replace('<section class="sp-find" id="sp-find"', `${m[1]}\n        <section class="sp-find" id="sp-find"`); }), /Recent is not under/],
    ['the sign-up back on the page', () => plant('public/start.html', '<footer class="sp-site"', '<form id="signup-form"></form><footer class="sp-site"'), /sign-up is still/],
    ['a go to another address', () => plant('public/start.js', 'location.href = envUrl(env.slug);', "location.href = 'https://example.com/' + env.slug;"), /not envUrl|address is written/],
    ['the product name in the page', () => plant('public/start.css', 'color: var(--sp-name-coral)', 'color: var(--sp-text)'), /coral/],
    ['a coloured hex in the style', () => plant('public/start.css', 'color: var(--sp-name-coral)', 'color: #ff8264'), /coral|colour written/],
    ['an app theme token in the style', () => plant('public/start.css', 'background: var(--sp-bg); color: var(--sp-text); font: 18px', 'background: var(--surface-page); color: var(--sp-text); font: 18px'), /token of the app|page ground/],
    ['the app theme loaded', () => plant('public/start.html', '<link rel="stylesheet" href="/sdk/system.css">', '<link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/sdk/system.css">'), /app's theme/],
    ['a system component', () => plant('public/start.html', '<button class="sp-btn sp-go"', '<button class="btn btn-primary sdk-btn sp-go"'), /sdk-/],
    ['a dark palette that differs from the browser\'s dark', () => plant('public/start.css', '--sp-bg: #0E1A2B; --sp-band: #13243B; --sp-surface: #182C47;', '--sp-bg: #0E1A2C; --sp-band: #13243B; --sp-surface: #182C47;'), /palette/],
    ['the old pages in the server', () => plant('server/index.js', "page('start.html')", "page('landing.html')"), /old product pages|start\.html/],
  ];
  assert.deepEqual(startProblems(ROOT), [], 'the real start page has problems');
  for (const [name, run, expect] of cases) {
    const got = run();
    assert.ok(got.length > 0 && got.some((p) => expect.test(p)), `self-test: "${name}" was not caught (got: ${got.join(' | ') || 'nothing'})`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  say(`the files: OK (${cases.length} planted old-page habits all fail)`);
}

// ---- 2. live ----
let failed = 0;
let n = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-start-page: ${name}: ${err.stack || err.message}`); }
};

async function live() {
  const bin = findBrowser();
  if (!bin) {
    if (process.env.CI) { console.error('check-start-page: no Chromium, and CI is set'); process.exit(1); }
    say('live part SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.');
    return;
  }
  // a bad PRODUCT_SITE_URL refuses to start, with one sentence
  const bad = spawnSync(process.execPath, [path.join(ROOT, 'server', 'index.js')], { cwd: ROOT, encoding: 'utf8', timeout: 20000, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'start-page-bad-')), ADMIN_PASSWORD: 'testpass1234', BASE_DOMAIN: 'localhost', PRODUCT_SITE_URL: 'ftp://example.com/x' } });
  await test('a PRODUCT_SITE_URL that is not a web address stops the start with one sentence', () => {
    assert.notEqual(bad.status, 0, 'it started');
    assert.match(bad.stderr + bad.stdout, /PRODUCT_SITE_URL=ftp:\/\/example\.com\/x is not a web address/);
  });

  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-start-page-'));
  let log = '';
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), DATA_DIR: dataDir, BASE_DOMAIN: 'localhost', SIGNUP: 'on', PRODUCT_SITE_URL: 'https://example.com/products/thing', CONTACT_EMAIL: 'hello@example.com', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'check-start-page-1', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret' },
  });
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  let browser = null;
  try {
    const end = Date.now() + 25000;
    while (!/listening on :\d+/.test(log)) {
      if (child.exitCode !== null || Date.now() > end) throw new Error(`the throwaway server did not start:\n${log.slice(-600)}`);
      await sleep(100);
    }
    const front = `http://localhost:${port}/`;
    const made = await fetch(`${front}api/product/signup`, { method: 'POST', headers: { 'content-type': 'application/json', host: `localhost:${port}` }, body: JSON.stringify({ slug: 'alpha', name: 'The Alpha Crew', owner: { login: 'ownalpha' } }) });
    assert.equal(made.status, 201, 'the first environment is made');
    browser = await launch(bin);

    // A tab of its own: its own storage, `width` wide, light unless it says otherwise.
    async function openTab(width, { block429 = false, scheme = 'light' } = {}) {
      const { browserContextId } = await browser.cdp.send('Target.createBrowserContext');
      const { targetId } = await browser.cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
      const { sessionId } = await browser.cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const s = (m, p) => browser.cdp.send(m, p, sessionId);
      const requests = []; const problems = [];
      browser.cdp.listeners.push((m) => {
        if (m.sessionId !== sessionId) return;
        if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
        else if (m.method === 'Runtime.exceptionThrown') problems.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
        else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(`console: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
        else if (m.method === 'Fetch.requestPaused') s('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 429, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{"error":"slow down"}').toString('base64') }).catch(() => {});
      });
      await s('Page.enable'); await s('Runtime.enable'); await s('Network.enable');
      if (block429) await s('Fetch.enable', { patterns: [{ urlPattern: '*/api/product/environment?slug=busy*', requestStage: 'Request' }] });
      await s('Emulation.setDeviceMetricsOverride', { width, height: width <= 640 ? 844 : 800, deviceScaleFactor: 1, mobile: width <= 640 });
      await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }] }); // the browser's preference; the page follows it until the person picks
      const evaluate = async (expr) => {
        const r = await s('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
        return r.result.value;
      };
      const waitFor = async (expr, what, ms = 15000) => {
        const stop = Date.now() + ms;
        while (!(await evaluate(expr).catch(() => false))) {
          if (Date.now() > stop) throw new Error(`timed out waiting for ${what} (at ${await evaluate('location.href').catch(() => '?')})`);
          await sleep(60);
        }
      };
      const go = async (url) => { await s('Page.navigate', { url }); await waitFor("document.readyState === 'complete' && !!document.getElementById('sp-go') && !document.getElementById('sp-go').disabled || !!document.getElementById('sp-failed') && !document.getElementById('sp-failed').hidden", 'the page'); };
      const focus = (sel) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.select?.(); })()`);
      const typeKeys = async (sel, text, gap = 25) => { await focus(sel); for (const ch of text) { await s('Input.insertText', { text: ch }); await sleep(gap); } };
      const enter = async () => { await s('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); await s('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); };
      const click = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await s('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 }); };
      const close = () => browser.cdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
      return { s, evaluate, waitFor, go, focus, typeKeys, enter, click, close, requests, problems };
    }
    const lookups = (tab) => tab.requests.filter((u) => u.includes('/api/product/environment?slug=')).length;
    const SAY = (id) => `document.getElementById(${JSON.stringify(id)}).textContent`;

    for (const width of [1280, 390]) {
      await test(`${width}: the header, one wide band, light, Recent absent, the field first, no sign-up, no password, every link out the studio's, no demo`, async () => {
        const tab = await openTab(width);
        try {
          await tab.go(front);
          const g = await tab.evaluate(`(() => {
            const cs = (el) => getComputedStyle(el);
            const mark = [...document.querySelectorAll('.sp-mark')].find((m) => m.getClientRects().length);
            const brand = document.querySelector('.sp-lockup-brand'); const prod = document.querySelector('.sp-lockup-product');
            const theme = document.getElementById('sp-theme'); const cols = document.querySelector('.sp-find-band'); const doc = document.documentElement;
            const find = document.getElementById('sp-find');
            const vis = (e) => Boolean(e) && e.getClientRects().length > 0;
            const external = [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /^https?:/.test(h) && new URL(h).origin !== location.origin);
            return {
              markW: mark && mark.getBoundingClientRect().width, markH: mark && mark.getBoundingClientRect().height, markSrc: mark && mark.getAttribute('src'),
              brandText: brand && brand.textContent, brandFont: brand && cs(brand).fontFamily, brandWeight: brand && cs(brand).fontWeight, brandColour: brand && cs(brand).color, brandSize: brand && cs(brand).fontSize,
              prodText: prod && prod.textContent, prodColour: prod && cs(prod).color, prodSize: prod && cs(prod).fontSize,
              textColour: cs(document.body).color, themeW: theme.getBoundingClientRect().width, themeH: theme.getBoundingClientRect().height, themeRadius: cs(theme).borderTopLeftRadius === '50%' ? '999px' : cs(theme).borderTopLeftRadius,
              ground: cs(document.body).backgroundColor, bandPaint: cs(document.querySelector('.sp-band')).backgroundColor, headerPos: cs(document.querySelector('.sp-top')).position, headerTop: cs(document.querySelector('.sp-top')).top, mode: doc.dataset.themeMode || null,
              colW: cols.getBoundingClientRect().width, scroll: doc.scrollWidth - doc.clientWidth,
              recentShown: vis(document.getElementById('recent') || document.getElementById('sp-recent')),
              findTop: find.getBoundingClientRect().top, signup: document.querySelectorAll('[id^=signup-], #start').length,
              password: document.querySelectorAll('input[type=password]').length,
              external, text: document.body.innerText, active: document.activeElement && document.activeElement.id,
              suffix: document.getElementById('sp-find-suffix').textContent,
              title: document.title,
              heroTitle: document.getElementById('sp-title').textContent, badge: document.querySelector('.sp-badge').textContent, inviteText: document.getElementById('sp-invite').textContent, waysHead: document.getElementById('sp-ways-h').textContent,
            };
          })()`);
          assert.ok(Math.abs(g.markW - 56) < 0.6 && Math.abs(g.markH - 56) < 0.6, `the mark is ${g.markW}x${g.markH}`);
          assert.equal(g.markSrc, '/assets/images/brand/mark.svg', 'the light mark on a light page');
          assert.equal(g.brandText, 'Coffee Pub'); assert.equal(g.prodText, 'Chameleon');
          assert.match(g.brandFont, /Fraunces/); assert.equal(g.brandWeight, '700');
          assert.equal(g.brandColour, g.textColour, '"Coffee Pub" is in the text colour');
          assert.notEqual(g.prodColour, g.textColour, 'the product name is not in the text colour');
          assert.equal(g.prodColour, 'rgb(224, 85, 60)', 'the name coral on the light page');
          assert.equal(g.brandSize, g.prodSize, 'the two words are one size');
          assert.ok(parseFloat(g.prodSize) >= 24, `coral at ${g.prodSize}`);
          assert.ok(Math.abs(g.themeW - g.themeH) < 0.6 && g.themeW >= (width <= 640 ? 44 : 40), 'a round theme button, 40px (44px on a phone)');
          assert.ok(parseFloat(g.themeRadius) >= g.themeW / 2 - 0.6, `its radius is ${g.themeRadius}`);
          assert.equal(g.ground, 'rgb(251, 246, 236)', 'the studio\'s cream ground');
          assert.equal(g.headerPos + ' ' + g.headerTop, 'sticky 0px', 'the header sticks at the top');
          assert.equal(g.bandPaint, 'rgb(243, 233, 212)', 'the sign-in band is the studio\'s band colour');
          assert.equal(g.mode, null, 'no pick: the browser decides');
          assert.equal(g.title, `${g.brandText} ${g.prodText}`, 'the tab is named by the product');
          assert.equal(g.colW, width === 1280 ? 760 : width - 48, 'one wide band: 760px wide, or the window less its edges on a phone');
          assert.ok(g.scroll <= 0, `sideways scroll ${g.scroll}`);
          assert.equal(g.recentShown, false, 'Recent is not drawn when empty');
          assert.equal(g.suffix, '.localhost');
          assert.equal(g.signup, 0, 'no sign-up on the page');
          assert.equal(g.password, 0, 'no password field');
          const site = 'https://example.com';
          assert.ok(g.external.length >= 14 && g.external.every((u) => u.startsWith(`${site}/`) || ['https://willhavebeen.com/', 'https://www.patreon.com/cw/CoffeePub', 'https://github.com/Drowbe'].includes(u)), `every link out is the studio's or one of the three elsewhere: ${g.external.join(' ')}`);
          for (const want of ['/products/thing', '/contact', '/support', '/products/chameleon/travel', '/products/chameleon/games', '/products/chameleon/projects', '/products/chameleon/mentoring', '/products/chameleon/real-estate']) assert.ok(g.external.includes(`${site}${want}`), `a link to ${want}`);
          assert.equal(g.heroTitle, `${g.brandText} ${g.prodText}`, 'the hero title is the product name');
          assert.equal(g.badge, 'Private Beta'); assert.equal(g.inviteText, 'Request an Invite'); assert.equal(g.waysHead, `Ways to use ${g.prodText}`);
          assert.ok(!/demo/i.test(g.text), 'the demo is hidden');
          assert.deepEqual(tab.problems, [], 'console and exceptions');
        } finally { await tab.close(); }
      });
    }

    await test('1280: the name shows as the address is typed; a fast typist asks once; the same text is not asked twice; an unknown address says so', async () => {
      const tab = await openTab(1280);
      try {
        await tab.go(front);
        await tab.typeKeys('#sp-find-input', 'alpha');
        await tab.waitFor(`document.getElementById('sp-find-say').textContent.includes('The Alpha Crew')`, 'the name');
        assert.match(await tab.evaluate(SAY('sp-find-say')), /The Alpha Crew at alpha\.localhost/);
        assert.equal(lookups(tab), 1, 'one request for a fast typist');
        assert.equal(await tab.evaluate("document.getElementById('sp-go').disabled"), false, 'Go is on');
        await tab.typeKeys('#sp-find-input', 'alpha'); // the same text again
        await tab.waitFor(`document.getElementById('sp-find-say').textContent.includes('The Alpha Crew')`, 'the kept name');
        assert.equal(lookups(tab), 1, 'the same text is not asked twice');
        await tab.typeKeys('#sp-find-input', 'nosuchplace');
        await tab.waitFor(`document.getElementById('sp-find-say').textContent.includes('There is nothing at that address')`, 'the sentence');
        assert.equal(await tab.evaluate("document.getElementById('sp-find-input').value"), 'nosuchplace', 'the text stays');
        assert.equal(await tab.evaluate("document.getElementById('sp-go').disabled"), false, 'Go stays on');
        await tab.typeKeys('#sp-find-input', 'bad_name');
        await tab.waitFor(`document.getElementById('sp-find-say').textContent.includes('An address is 3 to 30')`, 'the shape sentence');
        assert.equal(lookups(tab), 2, 'a shape that cannot be an address is not asked');
        assert.deepEqual(tab.problems, []);
      } finally { await tab.close(); }
    });

    await test('1280: Enter before the name is found waits and then goes to that environment\'s own sign-in; Recent keeps it, under the field, and can drop it', async () => {
      const tab = await openTab(1280);
      try {
        await tab.go(front);
        await tab.typeKeys('#sp-find-input', 'alpha', 10);
        await tab.enter(); // before the pause ends: no name yet
        await tab.waitFor(`location.origin === 'http://alpha.localhost:${port}' && location.pathname === '/login'`, 'the environment\'s sign-in');
        assert.equal(lookups(tab), 1);
        await tab.go(front); // back to the start page in the same browser
        const r = await tab.evaluate(`(() => { const s = document.getElementById('sp-recent'); const f = document.getElementById('sp-find'); return { shown: s.getClientRects().length > 0, above: s.getBoundingClientRect().top >= f.getBoundingClientRect().bottom, rows: [...s.querySelectorAll('li')].map((li) => li.textContent.trim()), href: s.querySelector('a').href, stored: localStorage.getItem('app.recentEnvironments') }; })()`);
        assert.ok(r.shown && r.above, 'Recent is drawn under the address');
        assert.match(r.rows[0], /The Alpha Crew/);
        assert.equal(r.href, `http://alpha.localhost:${port}/login`);
        assert.deepEqual(JSON.parse(r.stored), [{ slug: 'alpha', name: 'The Alpha Crew' }]);
        await tab.evaluate("document.querySelector('#sp-recent .sp-chip-x').click()");
        await tab.waitFor("document.getElementById('sp-recent').getClientRects().length === 0 && document.activeElement && document.activeElement.id === 'sp-find-input'", 'Recent gone, the field has the focus');
        assert.equal(await tab.evaluate("localStorage.getItem('app.recentEnvironments')"), '[]');
        // a stale row: dropped when chosen, with Go's sentence
        await tab.evaluate(`localStorage.setItem('app.recentEnvironments', JSON.stringify([{ slug: 'oldcrew', name: 'Old Crew' }]))`);
        await tab.go(front);
        await tab.evaluate("document.querySelector('#sp-recent a').click()");
        await tab.waitFor(`document.getElementById('sp-recent-say').textContent.includes('Old Crew is gone from Recent')`, 'the stale row dropped');
        assert.equal(await tab.evaluate("localStorage.getItem('app.recentEnvironments')"), '[]');
        assert.deepEqual(tab.problems, []);
      } finally { await tab.close(); }
    });

    await test('390: a 429 says so, typing stops asking, and Go asks once more', async () => {
      const tab = await openTab(390, { block429: true });
      try {
        await tab.go(front);
        await tab.typeKeys('#sp-find-input', 'busy');
        await tab.waitFor(`document.getElementById('sp-find-say').textContent.includes('Too many tries. Wait a minute, then try again.')`, 'the 429 sentence');
        assert.equal(lookups(tab), 1);
        await tab.typeKeys('#sp-find-input', 'busyx');
        await sleep(900);
        assert.equal(lookups(tab), 1, 'typing no longer asks');
        await tab.typeKeys('#sp-find-input', 'busy');
        await tab.evaluate("document.getElementById('sp-go').click()");
        await sleep(500);
        assert.equal(lookups(tab), 2, 'Go asks once');
        // every control at least 44px tall, or with a 44px hit area
        const small = await tab.evaluate(`[...document.querySelectorAll('button, a[href], input:not([type=hidden])')].filter((e) => e.getClientRects().length && !e.closest('[hidden]') && (e.closest('.sp-address, .sdk-choice-row') || e).getBoundingClientRect().height < 43.5).map((e) => (e.id || e.type || e.textContent.trim()) + ' ' + Math.round(e.getBoundingClientRect().height))`);
        assert.deepEqual(small, [], 'controls under 44px');
      } finally { await tab.close(); }
    });



    // The palette: the page's computed colours are the palette's, light and dark, at both widths. The palette is read from start.css (paletteOf),
    // not typed here.
    const PAL = paletteOf(fs.readFileSync(path.join(ROOT, 'public/start.css'), 'utf8'));
    assert.ok(PAL, 'the palette in start.css');
    const rgb = (hex) => { const h = hex.replace('#', ''); return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`; };
    for (const width of [1280, 390]) {
      for (const mode of ['light', 'dark']) {
        await test(`${width} ${mode}: every colour on the page is the palette's, and each part is the colour it should be`, async () => {
          const tab = await openTab(width, { scheme: mode });
          try {
            const P = Object.fromEntries(Object.entries(PAL[mode]).map(([k, v]) => [k.replace('--sp-', ''), /^#/.test(v) ? rgb(v) : v]));
            await tab.go(front);
            await tab.evaluate(`localStorage.setItem('app.recentEnvironments', ${JSON.stringify(JSON.stringify([{ slug: 'alpha', name: 'The Alpha Crew' }]))})`);
            await tab.go(front);
            await tab.waitFor("document.getElementById('sp-recent').getClientRects().length > 0", 'Recent');
            assert.equal(await tab.evaluate('document.documentElement.dataset.themeMode || null'), null, 'no pick: the browser\'s preference decides');
            const got = await tab.evaluate(`(() => {
              const $ = (s) => document.querySelector(s); const cs = (s, pseudo) => getComputedStyle($(s), pseudo);
              const out = {
                bodyBg: cs('body').backgroundColor, html: getComputedStyle(document.documentElement).backgroundColor, bodyText: cs('body').color, bodyFont: cs('body').fontFamily, bodySize: cs('body').fontSize,
                headerBg: cs('.sp-top').backgroundColor, headerLine: cs('.sp-top').borderBottomColor,
                heroBand: cs('.sp-band').backgroundColor, heroGround: cs('.sp-herowrap').backgroundColor, siteBand: cs('.sp-site').backgroundColor, siteText: cs('.sp-site').color, siteLink: cs('.sp-site nav a').color, siteHead: cs('.sp-site nav h2').color, siteLine: cs('.sp-site').borderTopColor,
                title: cs('#sp-title').color, titleFont: cs('#sp-title').fontFamily, titleWeight: cs('#sp-title').fontWeight, lead: cs('#sp-lead').color,
                brand: cs('.sp-lockup-brand').color, brandFont: cs('.sp-lockup-brand').fontFamily, brandWeight: cs('.sp-lockup-brand').fontWeight, brandSize: cs('.sp-lockup-brand').fontSize,
                product: cs('.sp-lockup-product').color, productFont: cs('.sp-lockup-product').fontFamily, productWeight: cs('.sp-lockup-product').fontWeight,
                badge: cs('.sp-badge').color, card: cs('.sp-way').backgroundColor, cardLine: cs('.sp-way').borderTopColor, cardText: cs('.sp-way-line').color, soon: cs('.sp-soon').backgroundColor, soonText: cs('.sp-soon').color,
                signin: cs('.sp-find-band').backgroundColor, signinLine: cs('.sp-find-band').borderTopColor,
                input: cs('.sp-address').backgroundColor, inputLine: cs('.sp-address').borderTopColor, inputText: cs('#sp-find-input').color, suffix: cs('.sp-suffix').color,
                go: cs('#sp-go').backgroundColor, goText: cs('#sp-go').color, invite: cs('#sp-invite').backgroundColor, inviteText: cs('#sp-invite').color, more: cs('#sp-nav-more').backgroundColor, moreText: cs('#sp-nav-more').color, support: cs('#sp-nav-support').color,
                theme: cs('#sp-theme').color, themeLine: cs('#sp-theme').borderTopColor,
                chip: cs('.sp-chip').backgroundColor, chipLine: cs('.sp-chip').borderTopColor, chipName: cs('.sp-chip-name').color, chipAddr: cs('.sp-chip-addr').color, chipX: cs('.sp-chip-x').color,
                code: cs('.sp-where code').backgroundColor,
              };
              // every element and the two pseudo-elements that paint: the colours it computes to
              const seen = new Set(); const where = {};
              const note = (c, what) => { seen.add(c); (where[c] ||= []).push(what); };
              for (const el of document.querySelectorAll('body, body *')) {
                for (const pseudo of [null, '::before', '::after']) {
                  const c = getComputedStyle(el, pseudo); if (pseudo && c.content === 'none') continue;
                  const tag = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') + (pseudo || '');
                  note(c.color, tag + ' color'); note(c.backgroundColor, tag + ' background');
                  for (const side of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(c['border' + side + 'Width']) > 0 && c['border' + side + 'Style'] !== 'none') note(c['border' + side + 'Color'], tag + ' border');
                  if (parseFloat(c.outlineWidth) > 0 && c.outlineStyle !== 'none') note(c.outlineColor, tag + ' outline');
                }
              }
              out.seen = [...seen]; out.where = where;
              return out;
            })()`);
            const eq = (key, want) => assert.equal(got[key], want, `${key}: ${got[key]}, want ${want}`);
            eq('bodyBg', P.bg); eq('bodyText', P.text); eq('headerBg', P.bg); eq('headerLine', P.line);
            eq('heroBand', P.band); eq('heroGround', 'rgba(0, 0, 0, 0)'); eq('siteBand', P.band); eq('siteText', P.muted); eq('siteLink', P.muted); eq('siteHead', P.text); eq('siteLine', P.line);
            eq('title', P.text); eq('lead', P.muted); eq('brand', P.text); eq('product', P['name-coral']);
            eq('badge', P['coral-text']); eq('card', P.surface); eq('cardLine', P.line); eq('cardText', P.muted); eq('soon', P['coral-soft']); eq('soonText', P['coral-text']);
            eq('signin', P.surface); eq('signinLine', P.line); eq('input', P.surface); eq('inputLine', P.line); eq('inputText', P.text); eq('suffix', P.muted);
            eq('go', P.accent); eq('goText', P['accent-ink']); eq('invite', P.accent); eq('inviteText', P['accent-ink']); eq('more', P.accent); eq('moreText', P['accent-ink']); eq('support', P.muted);
            eq('theme', P.text); eq('themeLine', P.line2);
            eq('chip', P.surface); eq('chipLine', P.line); eq('chipName', P.text); eq('chipAddr', P.muted); eq('chipX', P.muted); eq('code', P['coral-soft']);
            for (const k of ['bodyFont', 'productFont']) assert.match(got[k], /^Figtree\b/, `${k}: ${got[k]}`);
            for (const k of ['titleFont', 'brandFont']) assert.match(got[k], /^Fraunces\b/, `${k}: ${got[k]}`);
            assert.deepEqual([got.titleWeight, got.brandWeight, got.productWeight], ['600', '700', '600'], 'Fraunces 600 for the title, 700 for the wordmark, Figtree 600 for the name');
            assert.equal(got.bodySize, width <= 900 ? '17px' : '18px');
            assert.equal(got.brandSize, width >= 1100 ? '32px' : width > 560 ? '25.6px' : '24px', 'the wordmark size');
            const allowed = new Set([...Object.values(P).filter((v) => /^rgb/.test(v)), 'rgba(0, 0, 0, 0)']);
            const off = got.seen.filter((c) => !allowed.has(c)).map((c) => `${c} (${got.where[c].slice(0, 3).join(', ')})`);
            assert.deepEqual(off, [], 'colours on the page that are not in the palette');
            assert.deepEqual(tab.problems, []);
          } finally { await tab.close(); }
        });
      }
    }

    for (const width of [1280, 390]) {
      await test(`${width}: with a Recent entry, a click anywhere but the chip goes nowhere; the chip goes to its sign-in; its x removes it without going`, async () => {
        const tab = await openTab(width);
        try {
          await tab.go(front);
          const seed = JSON.stringify([{ slug: 'alpha', name: 'The Alpha Crew' }]);
          await tab.evaluate(`localStorage.setItem('app.recentEnvironments', ${JSON.stringify(seed)})`);
          await tab.go(front);
          await tab.waitFor("document.getElementById('sp-recent').getClientRects().length > 0", 'the Recent chip');
          const here = `http://localhost:${port}/`;
          // The reach of the chip's link: nothing outside the chip may have it under the pointer.
          const stray = await tab.evaluate(`(() => { const chip = document.querySelector('.sp-chip'); const out = []; const h = innerHeight; const w = innerWidth;
            for (let y = 4; y < h; y += 40) for (let x = 4; x < w; x += 40) { const e = document.elementFromPoint(x, y); const r = chip.getBoundingClientRect(); const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; if (!inside && e && chip.contains(e)) out.push(x + ',' + y); }
            return out; })()`);
          assert.deepEqual(stray, [], 'the chip answers a click outside its own box');
          // Real clicks on the header, the hero (text and drawing), empty page, the Ways cards area and the footer.
          const aims = ["document.querySelector('.sp-top-in')", "document.getElementById('sp-title')", "document.querySelector('.sp-art')", "document.querySelector('.sp-ways-grid')", "document.getElementById('sp-ways-h')", "document.querySelector('.sp-foot-base')", "document.querySelector('.sp-find-band')", "document.querySelector('.sp-find > h2')"];
          for (const aim of aims) {
            await tab.evaluate(`${aim}.scrollIntoView({ block: 'center' })`);
            const at = await tab.evaluate(`(() => { const r = ${aim}.getBoundingClientRect(); const cards = [...document.querySelectorAll('.sp-way')]; const gap = ${aim}.classList.contains('sp-ways-grid') ? Math.round((cards[0].getBoundingClientRect().right + cards[1].getBoundingClientRect().left) / 2) : null; return { x: gap ?? Math.round(r.left + 6), y: Math.round(Math.min(Math.max(r.top + (gap ? cards[0].getBoundingClientRect().height / 2 : r.height / 2), document.querySelector(".sp-top").getBoundingClientRect().bottom + 8), innerHeight - 6)) }; })()`);
            at.under = await tab.evaluate(`(() => { const e = document.elementFromPoint(${at.x}, ${at.y}); return e && (e.tagName + '.' + e.className); })()`);
            await tab.click(at.x, at.y);
            await sleep(450);
            assert.equal(await tab.evaluate('location.href'), here, `a click at ${at.x},${at.y} (${aim}) left the page; under it: ${at.under}`);
          }
          for (const at of [{ x: 3, y: 300 }, { x: width - 3, y: 400 }]) { await tab.click(at.x, at.y); await sleep(450); assert.equal(await tab.evaluate('location.href'), here, `a click at ${at.x},${at.y} left the page`); }
          // The x removes it and goes nowhere.
          await tab.evaluate("document.querySelector('.sp-recent-band').scrollIntoView({ block: 'center' })");
          const x = await tab.evaluate("(() => { const r = document.querySelector('.sp-chip-x').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()");
          await tab.click(x.x, x.y);
          await sleep(450);
          assert.equal(await tab.evaluate('location.href'), here, 'the x went to the environment');
          assert.equal(await tab.evaluate("localStorage.getItem('app.recentEnvironments')"), '[]', 'the x removes the entry');
          // The chip itself goes to the sign-in.
          await tab.evaluate(`localStorage.setItem('app.recentEnvironments', ${JSON.stringify(seed)})`);
          await tab.go(front);
          await tab.evaluate("document.querySelector('.sp-recent-band').scrollIntoView({ block: 'center' })");
          const c = await tab.evaluate("(() => { const r = document.querySelector('.sp-chip').getBoundingClientRect(); return { x: Math.round(r.left + 14), y: Math.round(r.top + r.height / 2) }; })()");
          c.under = await tab.evaluate(`(() => { const e = document.elementFromPoint(${c.x}, ${c.y}); return e && (e.tagName + '.' + e.className); })()`);
          await tab.click(c.x, c.y);
          await tab.waitFor(`location.origin === 'http://alpha.localhost:${port}' && location.pathname === '/login'`, `the chip going to the sign-in (clicked ${c.x},${c.y}, under it ${c.under})`);
        } finally { await tab.close(); }
      });
    }

    await test('1280: the round button turns the page dark and back; the mark follows; the choice is kept', async () => {
      const tab = await openTab(1280);
      try {
        await tab.go(front);
        await tab.evaluate("document.getElementById('sp-theme').click()");
        const g = await tab.evaluate(`({ mode: document.documentElement.dataset.themeMode, ground: getComputedStyle(document.body).backgroundColor, stored: localStorage.getItem('app.themeMode'), prod: getComputedStyle(document.querySelector('.sp-lockup-product')).color, label: document.getElementById('sp-theme').getAttribute('aria-label'), dark: getComputedStyle(document.querySelector('.sp-mark-dark')).display, light: getComputedStyle(document.querySelector('.sp-mark-light')).display })`);
        assert.deepEqual([g.mode, g.stored, g.ground, g.prod, g.label, g.dark, g.light], ['dark', 'dark', 'rgb(14, 26, 43)', 'rgb(255, 130, 100)', 'Switch to light mode', 'block', 'none']);
        await tab.go(front); // remembered
        assert.equal(await tab.evaluate('document.documentElement.dataset.themeMode'), 'dark');
        await tab.evaluate("document.getElementById('sp-theme').click()");
        assert.equal(await tab.evaluate('document.documentElement.dataset.themeMode'), 'light');
        assert.deepEqual(tab.problems, []);
      } finally { await tab.close(); }
    });
  } finally {
    if (browser) { try { browser.cdp.ws.close(); } catch { /* gone */ } browser.child.kill(); }
    await new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

selfTest();
await live();
if (failed) { console.error(`check-start-page: ${failed} failed`); process.exit(1); }
say(`OK (${n} live cases)`);
