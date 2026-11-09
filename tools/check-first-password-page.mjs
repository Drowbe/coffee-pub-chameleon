#!/usr/bin/env node
/*
 * check-first-password-page.mjs -- the new owner's "choose your password" page (public/login-first-password.html and
 * .js, step 2 of documentation/plans/plan-first-password.md), live in headless Chromium over the DevTools protocol
 * (tools/shots.mjs) against a throwaway hosted server (BASE_DOMAIN=localhost, SIGNUP=on; Chromium sends localhost and
 * every *.localhost to this machine):
 *   - sign up on the product host's front page, follow the answer to the new environment's page: the fragment is gone
 *     from the address once the page has loaded; the owner's login is named and kept for a password manager;
 *   - too short a password gets the rule's sentence; a good one signs in (the session cookie) and lands on /;
 *   - a tab reloaded before the password is set names the owner again and still sets it;
 *   - the page then, reloaded, shows the form (the step lives in a cookie the page cannot read), and setting a password
 *     gets the dead-link sentence; the page asks the server nothing until the form is sent;
 *   - a link opened a second time, and a page with no link, show the dead-link sentence;
 *   - a 201-character password is kept whole (the field cuts nothing) and gets the "at most 200" sentence;
 *   - a new link opened in a tab that already shows the page (only the fragment changes, so the browser stays on the
 *     page) is used: the password can be set, and the fragment is gone from the address and the tab's history; and this
 *     check fails on the page served without its hashchange listener;
 *   - two links opened in quick succession in one tab, the older one's answer (and its cookie) reaching the browser
 *     last through a delaying proxy, with two owners awaiting a first password in one environment: the page names the
 *     newer link's owner, and the password it sets, and the session, are that owner's (fails on a page that opens both
 *     at once: it named one owner and set the other's password);
 *   - two tabs of one browser, a link in each: the older tab's form cannot set the newer owner's password (the set step
 *     refuses a login that is not the step's owner), and the newer tab still can;
 *   - a fragment that is no link (#x, an empty one) after a good link in the same tab leaves the form as it is and sends
 *     no exchange, and the password can still be set; at load it shows the dead-link sentence, with nothing sent;
 *   - too many tries from one address show the limit's sentence and a Try again button, and leave the link unspent;
 *   - with a second step required, the password leads to the enrolment step;
 *   - every request the page makes is to its own origin, carries no Referer and never the token; the only calls to
 *     the API are the branding read, the exchange and the set step;
 *   - at 390 and 1280 wide: no sideways scroll, no console error, and at 390 every control is at least 44px tall;
 *   - the fragment check itself fails on a page that does not take the fragment out (the page served without its
 *     history.replaceState).
 * `--shots=<dir>`: also writes a picture of each state at 390 and 1280, light and dark, into <dir>.
 * With no Chromium it says SKIPPED (not a pass).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findBrowser, launch, freePort, sleep } from './shots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEAD = 'This link has expired or was already used. Ask whoever runs this host for a new one.';
const SHORT = 'A password needs at least 8 characters.';
const LONG = 'A password can have at most 200 characters.';
const HOST_LOGIN = 'boss';
const HOST_PASSWORD = 'check-first-password-page-1';
const shotsArg = process.argv.find((a) => a.startsWith('--shots='));
const SHOTS = shotsArg ? path.resolve(shotsArg.slice('--shots='.length)) : '';
const PAGE_JS = fs.readFileSync(path.join(ROOT, 'public', 'login-first-password.js'), 'utf8');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-first-password-page: ${name}: ${err.stack || err.message}`); }
};

const bin = findBrowser();
if (!bin) {
  console.log('check-first-password-page: SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.');
  process.exit(0);
}

const port = await freePort();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-first-password-page-'));
let log = '';
const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), DATA_DIR: dataDir, BASE_DOMAIN: 'localhost', SIGNUP: 'on', ADMIN_LOGIN: HOST_LOGIN, ADMIN_PASSWORD: HOST_PASSWORD, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret' },
});
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });

// Each browser tab and each direct call comes "through the proxy" from its own address, so the sign-in limit of one
// case never touches another's.
let ipCount = 0;
const nextIp = () => { ipCount += 1; return `198.51.100.${ipCount}`; };
// One request by Host header ('' is the product host): { status, json, text, cookies }.
const call = (method, host, urlPath, body, headers = {}) => new Promise((resolve, reject) => {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: { host: `${host ? `${host}.` : ''}localhost:${port}`, accept: 'application/json', 'x-forwarded-for': nextIp(), ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}), ...headers } }, (res) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { text += d; });
    res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ } resolve({ status: res.statusCode, json, text, cookies: (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]) }); });
  });
  req.on('error', reject);
  if (payload) req.write(payload);
  req.end();
});
async function signupByCall(slug) {
  const res = await call('POST', '', '/api/product/signup', { slug, name: `Env ${slug}`, owner: { login: `own${slug}`, displayName: `Owner ${slug}` } });
  assert.equal(res.status, 201, res.text);
  return res.json.url;
}
async function crossSignIn(slug) {
  const res = await call('POST', slug, '/api/login', { login: HOST_LOGIN, password: HOST_PASSWORD });
  assert.equal(res.status, 200, `cross sign-in at ${slug}: ${res.text}`);
  return res.json.token;
}

let browser = null;
const tokens = [];

// A tab of its own (its own cookies and storage), `width` wide, light or dark, coming from its own address. Records
// every request, console error and exception. `mutate`: the page's script served changed (the replaceState proof).
// `sharedWith`: a second tab in that tab's browser context, so the two share their cookies.
async function openTab({ width = 1280, mode = 'light', from = nextIp(), mutate = null, sharedWith = null } = {}) {
  const { browserContextId } = sharedWith ? { browserContextId: sharedWith.browserContextId } : await browser.cdp.send('Target.createBrowserContext');
  const { targetId } = await browser.cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await browser.cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => browser.cdp.send(m, p, sessionId);
  const requests = [];
  const problems = [];
  const signupAnswers = [];
  const listener = (m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Network.requestWillBeSent') requests.push({ id: m.params.requestId, url: m.params.request.url, method: m.params.request.method, type: m.params.type, headers: m.params.request.headers, policy: m.params.request.referrerPolicy, page: m.params.documentURL });
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(`console: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    else if (m.method === 'Runtime.exceptionThrown') problems.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    // A refused call (401, 429) is logged by the browser as a failed resource: that is the page's own handling, not an error.
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && m.params.entry.source !== 'network') problems.push(`log: ${m.params.entry.text} ${m.params.entry.url || ''}`);
    else if (m.method === 'Fetch.requestPaused' && m.params.responseStatusCode !== undefined) {
      // The sign-up's answer, read on its way to the page: the token, to look for it everywhere afterwards.
      s('Fetch.getResponseBody', { requestId: m.params.requestId }).then(({ body, base64Encoded }) => {
        signupAnswers.push(base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body);
      }).catch(() => {}).finally(() => s('Fetch.continueRequest', { requestId: m.params.requestId }).catch(() => {}));
    } else if (m.method === 'Fetch.requestPaused') {
      const body = Buffer.from(mutate(PAGE_JS)).toString('base64');
      s('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }, { name: 'Cache-Control', value: 'no-store' }], body }).catch(() => {});
    }
  };
  browser.cdp.listeners.push(listener);
  await s('Page.enable');
  await s('Runtime.enable');
  await s('Log.enable');
  await s('Network.enable');
  await s('Network.setExtraHTTPHeaders', { headers: { 'X-Forwarded-For': from } });
  await s('Emulation.setDeviceMetricsOverride', { width, height: width <= 640 ? 844 : 800, deviceScaleFactor: 1, mobile: width <= 640 });
  await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await s('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('app.themeMode', ${JSON.stringify(mode)}); } catch (e) {}` });
  await s('Fetch.enable', { patterns: [{ urlPattern: '*/api/product/signup', requestStage: 'Response' }, ...(mutate ? [{ urlPattern: '*/login-first-password.js', requestStage: 'Request' }] : [])] });
  const evaluate = async (expr) => {
    const r = await s('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  };
  const waitFor = async (expr, what, ms = 15000) => {
    const end = Date.now() + ms;
    while (!(await evaluate(expr).catch(() => false))) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what} (at ${await evaluate('location.href').catch(() => '?')})`);
      await sleep(80);
    }
  };
  const go = async (url) => { await s('Page.navigate', { url }); };
  const visible = (id) => `(() => { const el = document.getElementById(${JSON.stringify(id)}); return Boolean(el) && !el.closest('[hidden]') && el.getClientRects().length > 0; })()`;
  const type = async (selector, text) => {
    await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select?.(); })()`);
    await s('Input.insertText', { text });
  };
  const cookies = async () => (await s('Network.getCookies', {})).cookies;
  const shot = async (name) => {
    if (!SHOTS) return;
    await sleep(250);
    const { data } = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(SHOTS, `${name}-${width}-${mode}.png`), Buffer.from(data, 'base64'));
  };
  // Sideways scroll, controls under 44px at a phone's width, and the console's errors so far.
  const layoutProblems = async () => {
    const found = await evaluate(`(() => {
      const out = [];
      const doc = document.documentElement;
      if (doc.scrollWidth > doc.clientWidth + 1) out.push('sideways scroll: ' + doc.scrollWidth + ' > ' + doc.clientWidth);
      if (innerWidth <= 640) {
        for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea')) {
          if (el.closest('[hidden]') || !el.getClientRects().length) continue;
          const r = el.getBoundingClientRect();
          if (r.height >= 44 - 0.5) continue;
          // A small button keeps its look and gets a 44px hit area past its box (system.css): pressed 21px above and
          // below its middle, it is still the one pressed.
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          const hits = [y - 21, y + 21].every((yy) => { const at = document.elementFromPoint(x, yy); return at === el || el.contains(at); });
          if (!hits) out.push((el.id || el.textContent.trim() || el.tagName) + ' is ' + Math.round(r.height) + 'px tall, with no 44px hit area');
        }
      }
      return out;
    })()`);
    return [...found, ...problems];
  };
  const close = async () => {
    browser.cdp.listeners = browser.cdp.listeners.filter((f) => f !== listener);
    if (sharedWith) await browser.cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    else await browser.cdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  };
  return { s, evaluate, waitFor, go, visible, type, cookies, shot, layoutProblems, requests, problems, signupAnswers, close, width, mode, browserContextId };
}

// The page's own requests are the ones it made once it was this environment's page.
function pageRequests(tab, origin) {
  return tab.requests.filter((r) => r.page && r.page.startsWith(`${origin}/login/first-password`));
}
function requestProblems(tab, origin, token) {
  const out = [];
  const allowedApi = new Set(['/api/branding', '/api/login/first-password', '/api/login/first-password/set']);
  for (const r of pageRequests(tab, origin)) {
    let u;
    try { u = new URL(r.url); } catch { out.push(`an odd address: ${r.url}`); continue; }
    if (u.protocol === 'data:') continue;
    if (u.origin !== origin) out.push(`a request to another origin: ${r.url}`);
    if (token && r.url.includes(token)) out.push(`the token in a request's address: ${r.method} ${u.pathname}`);
    if (u.hash) out.push(`a fragment in a request: ${u.pathname}`);
    // The page's own address (with or without its fragment) is never sent on: an empty Referer from the page, and a
    // stylesheet's font names only the stylesheet. The page's own request comes from the front page (its origin only).
    const referer = Object.entries(r.headers || {}).find(([h]) => h.toLowerCase() === 'referer')?.[1] || '';
    if (referer.includes('/login/first-password') || referer.includes('#') || (token && referer.includes(token))) out.push(`the page's address in a Referer, on ${u.pathname}`);
    if (u.pathname.startsWith('/api/') && !allowedApi.has(u.pathname)) out.push(`an API call besides the branding, the exchange and the set step: ${r.method} ${u.pathname}`);
    if (r.method !== 'GET' && !['/api/login/first-password', '/api/login/first-password/set'].includes(u.pathname)) out.push(`a ${r.method} to ${u.pathname}`);
  }
  return out;
}
// A proxy in front of the throwaway server that holds back the server's answer to one exchange (the one that sent
// `hold.token`) for `hold.ms`, after the server has answered it: that answer, and the cookie it sets, reach the browser
// late. (The DevTools protocol's own interception cannot do this: Chromium stores a held answer's cookie before the
// pause.) `answers`: the tokens of the exchanges, in the order their answers were let through.
async function delayingProxy() {
  const hold = { token: '', ms: 0 };
  const answers = [];
  const proxyPort = await freePort();
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const up = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers: req.headers }, (ur) => {
        const out = [];
        ur.on('data', (c) => out.push(c));
        ur.on('end', () => {
          const isExchange = req.method === 'POST' && req.url === '/api/login/first-password';
          let sent = '';
          if (isExchange) { try { sent = JSON.parse(body.toString('utf8')).token || ''; } catch { /* not JSON */ } }
          const delay = isExchange && hold.token && sent === hold.token ? hold.ms : 0;
          if (delay) hold.token = '';
          setTimeout(() => { if (isExchange) answers.push(sent); res.writeHead(ur.statusCode, ur.headers); res.end(Buffer.concat(out)); }, delay);
        });
      });
      up.on('error', () => { res.writeHead(502); res.end(); });
      up.end(body);
    });
  });
  await new Promise((resolve) => srv.listen(proxyPort, '127.0.0.1', resolve));
  return { port: proxyPort, hold, answers, close: () => new Promise((resolve) => { srv.closeAllConnections?.(); srv.close(resolve); }) };
}
const fragmentGone = (tab, origin) => tab.evaluate(`location.href === ${JSON.stringify(`${origin}/login/first-password`)} && location.hash === ''`);

try {
  const end = Date.now() + 25000;
  while (!/listening on :\d+/.test(log)) {
    if (child.exitCode !== null || Date.now() > end) throw new Error(`the throwaway server did not start:\n${log.slice(-600)}`);
    await sleep(100);
  }
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  browser = await launch(bin);
  const front = `http://localhost:${port}/`;
  const originOf = (slug) => `http://${slug}.localhost:${port}`;

  // --- sign up by call (the start page has no form), open the link, choose a password, signed in; then reload --------------------------
  for (const [width, slug] of [[1280, 'alpha'], [390, 'bravo']]) {
    await test(`${width}: sign up by call, open the link, the fragment is gone, a short password, a good one, signed in; a reload is dead`, async () => {
      const tab = await openTab({ width });
      try {
        const origin = originOf(slug);
        const url = await signupByCall(slug); // the sign-up form is gone from the start page: the call is made directly, the link is opened in the browser
        const token = String(url || '').split('#')[1];
        assert.match(token || '', /^[A-Za-z0-9_-]{43}$/, 'the sign-up answered a link');
        tokens.push(token);
        await tab.go(url);
        await tab.waitFor(`location.origin === ${JSON.stringify(origin)} && ${tab.visible('fp-password')}`, 'the choose-your-password form');
        const doc = tab.requests.find((r) => r.type === 'Document' && r.url.startsWith(`${origin}/login/first-password`));
        assert.ok(doc, 'the page was opened');
        assert.ok(!doc.url.includes('#'), 'the fragment is not part of the page request');
        assert.ok(await fragmentGone(tab, origin), `the address still has its fragment: ${await tab.evaluate('location.href')}`);
        assert.equal(await tab.evaluate("document.getElementById('fp-login').value"), `own${slug}`, 'the login for a password manager');
        assert.equal(await tab.evaluate("document.getElementById('fp-login').autocomplete"), 'username');
        assert.equal(await tab.evaluate("document.getElementById('fp-password').autocomplete"), 'new-password');
        assert.equal(await tab.evaluate("document.getElementById('fp-lede').textContent"), `Choose the password you will sign in with as own${slug}.`);
        assert.equal(await tab.evaluate("document.activeElement?.id"), 'fp-password', 'the password field has focus');
        assert.equal(await tab.evaluate("document.querySelector('[data-brand=environmentName]').textContent"), `Env ${slug}`);
        assert.ok(!(await tab.evaluate('document.documentElement.outerHTML + JSON.stringify(Object.entries(localStorage)) + JSON.stringify(Object.entries(sessionStorage)) + document.cookie + document.title')).includes(token), 'the token is not in the page, its storage or its readable cookies');
        await tab.shot('choose');
        await tab.evaluate("document.querySelector('[data-reveal=fp-password]').click()");
        assert.equal(await tab.evaluate("document.getElementById('fp-password').type"), 'text', 'Show shows the password');
        await tab.evaluate("document.querySelector('[data-reveal=fp-password]').click()");
        assert.equal(await tab.evaluate("document.getElementById('fp-password').type"), 'password', 'Hide hides it');
        await tab.type('#fp-password', 'short');
        await tab.evaluate("document.getElementById('fp-submit').click()");
        await tab.waitFor(tab.visible('fp-error'), 'the rule sentence');
        assert.equal(await tab.evaluate("document.getElementById('fp-error').textContent"), SHORT);
        assert.equal(await tab.evaluate("document.getElementById('fp-password').getAttribute('aria-invalid')"), 'true');
        await tab.shot('too-short');
        assert.deepEqual(await tab.layoutProblems(), [], 'the form, with its error');
        await tab.type('#fp-password', `${slug}-password-1`);
        await tab.evaluate("document.getElementById('fp-submit').click()");
        await tab.waitFor(`location.origin === ${JSON.stringify(origin)} && location.pathname === '/'`, 'Home, signed in');
        assert.ok((await tab.cookies()).some((c) => c.name === 'app_session' && c.domain.includes(`${slug}.localhost`) && c.value), 'a session cookie');
        const signedIn = await call('POST', slug, '/api/login', { login: `own${slug}`, password: `${slug}-password-1` });
        assert.equal(signedIn.status, 200, 'the password works at the sign-in');
        const firstPageCalls = requestProblems(tab, origin, token);
        assert.deepEqual(firstPageCalls, [], 'the page\'s requests');
        // Back on the page (a reload, a saved address): the form, and the set step says the link is dead.
        tab.requests.length = 0;
        await tab.go(`${origin}/login/first-password`);
        await tab.waitFor(tab.visible('fp-password'), 'the form again');
        assert.ok(!tab.requests.some((r) => r.url.endsWith('/api/login/first-password')), 'no exchange without a link');
        await tab.type('#fp-password', 'another-password-1');
        await tab.evaluate("document.getElementById('fp-submit').click()");
        await tab.waitFor(tab.visible('fp-dead-text'), 'the dead-link sentence');
        assert.equal(await tab.evaluate("document.getElementById('fp-dead-text').textContent"), DEAD);
        assert.equal(await tab.evaluate("document.activeElement?.id"), 'fp-signin', 'the way on has focus');
        assert.equal(await tab.evaluate("document.querySelector('#fp-dead a.btn').getAttribute('href')"), '/login');
        assert.deepEqual(requestProblems(tab, origin, null), []);
        assert.deepEqual(await tab.layoutProblems(), [], 'the dead-link view');
      } finally { await tab.close(); }
    });
  }

  // --- a link used twice; no link at all; a reload before setting still sets it ------------------------------------
  await test('a link opened twice: the second tab gets the dead-link sentence, with no hint of why', async () => {
    const url = await signupByCall('charlie');
    const token = url.split('#')[1];
    tokens.push(token);
    const one = await openTab();
    const two = await openTab({ width: 390, mode: 'dark' });
    try {
      await one.go(url);
      await one.waitFor(one.visible('fp-password'), 'the form');
      await two.go(url);
      await two.waitFor(two.visible('fp-dead-text'), 'the dead-link sentence');
      assert.equal(await two.evaluate("document.getElementById('fp-dead-text').textContent"), DEAD);
      assert.ok(await fragmentGone(two, originOf('charlie')), 'the fragment is gone on the dead page too');
      assert.ok(!(await two.evaluate('document.body.innerHTML')).includes(token), 'the token is not in the page');
      assert.deepEqual(requestProblems(two, originOf('charlie'), token), []);
      assert.deepEqual(requestProblems(one, originOf('charlie'), token), []);
      assert.deepEqual(await two.layoutProblems(), []);
      // The first tab, reloaded before the password is chosen, still names the owner and sets it (the step is in the
      // cookie; the tab keeps the login it names).
      await one.s('Page.reload', {});
      await one.waitFor(`${one.visible('fp-password')} && document.getElementById('fp-login').value === 'owncharlie'`, 'the form after a reload, naming the owner');
      assert.equal(await one.evaluate("document.getElementById('fp-lede').textContent"), 'Choose the password you will sign in with as owncharlie.');
      await one.type('#fp-password', 'charlie-password-1');
      await one.evaluate("document.getElementById('fp-submit').click()");
      await one.waitFor("location.pathname === '/'", 'Home, signed in after a reload');
    } finally { await one.close(); await two.close(); }
  });

  await test('no link: the form, no call until it is sent, then the dead-link sentence', async () => {
    const tab = await openTab({ width: 390 });
    try {
      const origin = originOf('alpha');
      await tab.go(`${origin}/login/first-password`);
      await tab.waitFor(tab.visible('fp-password'), 'the form');
      await sleep(300);
      assert.ok(!pageRequests(tab, origin).some((r) => r.method === 'POST'), 'nothing sent before the form is');
      // A password longer than the rule allows is kept whole (no silent cut) and gets the rule's sentence.
      await tab.type('#fp-password', 'x'.repeat(201));
      assert.equal(await tab.evaluate("document.getElementById('fp-password').value.length"), 201, 'the whole password is kept');
      await tab.evaluate("document.getElementById('fp-submit').click()");
      await tab.waitFor(tab.visible('fp-error'), 'the rule sentence for a long password');
      assert.equal(await tab.evaluate("document.getElementById('fp-error').textContent"), LONG);
      assert.ok(!pageRequests(tab, origin).some((r) => r.method === 'POST'), 'nothing sent for a password the rule refuses');
      await tab.type('#fp-password', 'longenough-1');
      await tab.evaluate("document.getElementById('fp-submit').click()");
      await tab.waitFor(tab.visible('fp-dead-text'), 'the dead-link sentence');
      assert.equal(await tab.evaluate("document.getElementById('fp-dead-text').textContent"), DEAD);
      // An empty fragment is no link either: the exchange is never called with an empty token.
      tab.requests.length = 0;
      await tab.go('about:blank');
      await tab.go(`${origin}/login/first-password#`);
      await tab.waitFor(tab.visible('fp-password'), 'the form');
      await sleep(300);
      assert.ok(!tab.requests.some((r) => r.url.endsWith('/api/login/first-password')), 'no exchange for an empty fragment');
      assert.deepEqual(requestProblems(tab, origin, null), []);
      assert.deepEqual(await tab.layoutProblems(), []);
    } finally { await tab.close(); }
  });

  await test('too many tries from one address: the limit sentence and Try again; the link is left unspent', async () => {
    const url = await signupByCall('delta');
    tokens.push(url.split('#')[1]);
    const from = '203.0.113.77';
    for (let i = 0; i < 10; i += 1) await call('POST', 'delta', '/api/login/first-password', { token: `wrong${i}` }, { 'x-forwarded-for': from });
    const tab = await openTab({ width: 390, from });
    try {
      await tab.go(url);
      await tab.waitFor(tab.visible('fp-retry'), 'Try again');
      assert.match(await tab.evaluate("document.getElementById('fp-wait-text').textContent"), /^Too many tries from here\./);
      assert.equal(await tab.evaluate("document.activeElement?.id"), 'fp-retry');
      assert.ok(await fragmentGone(tab, originOf('delta')));
      assert.deepEqual(await tab.layoutProblems(), []);
      await tab.shot('too-many');
      // Another address may still use the link: it was not spent.
      const ok = await call('POST', 'delta', '/api/login/first-password', { token: url.split('#')[1] });
      assert.equal(ok.status, 200, ok.text);
    } finally { await tab.close(); }
  });

  await test('with a second step required, the password leads to the enrolment step', async () => {
    const url = await signupByCall('echo');
    tokens.push(url.split('#')[1]);
    const bearer = await crossSignIn('echo');
    const on = await call('PATCH', 'echo', '/api/settings', { mfaRequired: true }, { authorization: `Bearer ${bearer}` });
    assert.equal(on.status, 200, on.text);
    const tab = await openTab({ width: 390 });
    try {
      await tab.go(url);
      await tab.waitFor(tab.visible('fp-password'), 'the form');
      await tab.type('#fp-password', 'echo-password-1');
      await tab.evaluate("document.getElementById('fp-submit').click()");
      await tab.waitFor(`location.pathname === '/login/enrol' && ${tab.visible('enrol')}`, 'the enrolment step');
      assert.equal(await tab.evaluate('location.search'), '?next=/');
      assert.ok(!(await tab.cookies()).some((c) => c.name === 'app_session' && c.value), 'no session before the second step is set up');
      assert.deepEqual(requestProblems(tab, originOf('echo'), null), []);
    } finally { await tab.close(); }
  });

  // --- the fragment check is real: the page without its replaceState fails it ---------------------------------------
  await test('the fragment check fails on a page that leaves the fragment in the address', async () => {
    const without = (js) => js.replace(/^\s*if \(.*\) history\.replaceState\([^;]*\);$/m, '');
    assert.notEqual(without(PAGE_JS), PAGE_JS, 'the replaceState line was found to take out');
    const url = await signupByCall('foxtrot');
    tokens.push(url.split('#')[1]);
    const tab = await openTab({ mutate: without });
    try {
      await tab.go(url);
      await tab.waitFor(tab.visible('fp-password'), 'the form (from the changed page)');
      assert.equal(await fragmentGone(tab, originOf('foxtrot')), false, 'the check did not notice the fragment left in the address');
    } finally { await tab.close(); }
  });

  // --- a new link opened in a tab that already shows the page (only the fragment changes: no new page) --------------
  // Opens the page with a dead link, then the same tab at a new, good link's address. Returns what went wrong: the new
  // link not used, or its fragment left in the address or in the tab's history.
  const sameTabNewLink = async (tab, slug, ms) => {
    const out = [];
    const origin = originOf(slug);
    const url = await signupByCall(slug);
    const token = url.split('#')[1];
    tokens.push(token);
    await tab.go(`${origin}/login/first-password#${'d'.repeat(43)}`);
    await tab.waitFor(tab.visible('fp-dead-text'), 'the dead-link sentence');
    assert.ok(await fragmentGone(tab, origin), 'the dead link is out of the address');
    await tab.evaluate('window.samePage = true');
    await tab.go(url);
    try {
      await tab.waitFor(`${tab.visible('fp-password')} && document.getElementById('fp-login').value === ${JSON.stringify(`own${slug}`)}`, 'the form for the new link', ms);
    } catch { out.push('the new link was not used'); }
    assert.equal(await tab.evaluate('window.samePage === true'), true, 'the browser stayed on the page (a jump within it, not a new page)');
    if (!(await fragmentGone(tab, origin))) out.push('the address keeps the fragment');
    const { entries } = await tab.s('Page.getNavigationHistory', {});
    if (entries.some((e) => e.url.includes('#') || e.url.includes(token))) out.push('the history keeps the fragment');
    if (requestProblems(tab, origin, token).length) out.push(...requestProblems(tab, origin, token));
    return out;
  };
  await test('a new link opened in a tab already on the page is used, and taken out of the address and history', async () => {
    const tab = await openTab({ width: 390 });
    try {
      assert.deepEqual(await sameTabNewLink(tab, 'golf', 15000), []);
      await tab.type('#fp-password', 'golf-password-1');
      await tab.evaluate("document.getElementById('fp-submit').click()");
      await tab.waitFor(`location.origin === ${JSON.stringify(originOf('golf'))} && location.pathname === '/'`, 'Home, signed in');
      assert.equal((await call('POST', 'golf', '/api/login', { login: 'owngolf', password: 'golf-password-1' })).status, 200, 'the password was set');
    } finally { await tab.close(); }
  });
  await test('the same-tab check fails on a page that does not listen for a new fragment', async () => {
    const without = (js) => js.replace(/^window\.addEventListener\('hashchange', takeNewLink\);$/m, '');
    assert.notEqual(without(PAGE_JS), PAGE_JS, 'the hashchange listener was found to take out');
    const tab = await openTab({ mutate: without });
    try {
      const out = await sameTabNewLink(tab, 'hotel', 3000);
      assert.ok(out.includes('the new link was not used'), JSON.stringify(out));
      assert.ok(out.includes('the address keeps the fragment'), JSON.stringify(out));
      assert.ok(out.includes('the history keeps the fragment'), JSON.stringify(out));
    } finally { await tab.close(); }
  });

  // --- two owners awaiting a first password in one environment, a console link for each ------------------------------
  // The environment's first owner sets their password; they add two more owners through /api/users; the host admin
  // makes each of those a first-password link in the console.
  const twoOwners = async (slug) => {
    const url = await signupByCall(slug);
    tokens.push(url.split('#')[1]);
    const first = await call('POST', slug, '/api/login/first-password', { token: url.split('#')[1] });
    assert.equal(first.status, 200, first.text);
    const set = await call('POST', slug, '/api/login/first-password/set', { password: `${slug}-password-0`, login: `own${slug}` }, { cookie: first.cookies.join('; ') });
    assert.equal(set.status, 200, set.text);
    const signIn = await call('POST', slug, '/api/login', { login: `own${slug}`, password: `${slug}-password-0` });
    assert.equal(signIn.status, 200, signIn.text);
    const session = signIn.cookies.filter((c) => !c.endsWith('=')).join('; ');
    const a = `${slug}a`;
    const b = `${slug}b`;
    for (const login of [a, b]) {
      const added = await call('POST', slug, '/api/users', { login, displayName: `Owner ${login}`, role: 'owner' }, { cookie: session });
      assert.ok(added.status >= 200 && added.status < 300, `adding ${login}: ${added.status} ${added.text}`);
    }
    const host = await call('POST', 'admin', '/api/host/login', { login: HOST_LOGIN, password: HOST_PASSWORD });
    assert.equal(host.status, 200, host.text);
    const link = async (login) => {
      const res = await call('POST', 'admin', `/api/host/environments/${slug}/owners/${login}/first-password`, {}, { cookie: host.cookies.join('; ') });
      assert.equal(res.status, 200, res.text);
      tokens.push(res.json.url.split('#')[1]);
      return res.json.url;
    };
    return { a, b, linkA: await link(a), linkB: await link(b) };
  };
  // After a tab sent the form: whom its session names, and for whom the password it sent now works.
  const signedInAs = async (tab, slug) => {
    const session = (await tab.cookies()).find((c) => c.name === 'app_session' && c.value && c.domain.includes(`${slug}.localhost`));
    if (!session) return '';
    const me = await call('GET', slug, '/api/me', undefined, { cookie: `app_session=${session.value}` });
    return me.json?.user?.login || '';
  };
  const passwordWorksFor = async (slug, logins, password) => {
    const out = [];
    for (const login of logins) if ((await call('POST', slug, '/api/login', { login, password })).status === 200) out.push(login);
    return out;
  };
  const sendForm = async (tab, password) => {
    await tab.type('#fp-password', password);
    await tab.evaluate("document.getElementById('fp-submit').click()");
    await tab.waitFor(`location.pathname === '/' || ${tab.visible('fp-dead-text')}`, 'the answer to the form');
  };

  // Two links opened one after the other in one tab (only the fragment changes), the older one's exchange answered
  // last: the server spends the older link and sets its step's cookie, and that answer reaches the browser after the
  // newer one's. Whatever the page then names, the password it sets must be for that owner, and the browser must be
  // signed in as that owner; the page names the newer link's owner.
  // Returns what went wrong, [] when nothing did.
  const raceTwoLinks = async (slug, mutate = null) => {
    const { a, b, linkA, linkB } = await twoOwners(slug);
    const proxy = await delayingProxy();
    const viaProxy = (u) => u.replace(`:${port}/`, `:${proxy.port}/`);
    const origin = `http://${slug}.localhost:${proxy.port}`;
    const tokenA = linkA.split('#')[1];
    const tab = await openTab({ mutate });
    const out = [];
    try {
      await tab.go(`${origin}/login/first-password`);
      await tab.waitFor(tab.visible('fp-password'), 'the form, with no link yet');
      proxy.hold.token = tokenA;
      proxy.hold.ms = 1500;
      await tab.go(viaProxy(linkA));
      await sleep(100);
      await tab.go(viaProxy(linkB));
      const end = Date.now() + 15000;
      while (proxy.answers.length < 2 && Date.now() < end) await sleep(80);
      assert.equal(proxy.answers.length, 2, 'both links were exchanged');
      await tab.waitFor(`${tab.visible('fp-password')} && document.getElementById('fp-login').value !== ''`, 'the form for a link');
      await sleep(300);
      const named = await tab.evaluate("document.getElementById('fp-login').value");
      const lede = await tab.evaluate("document.getElementById('fp-lede').textContent");
      if (!(await fragmentGone(tab, origin))) out.push('the address keeps the fragment');
      await sendForm(tab, `${slug}-race-1`);
      const who = await signedInAs(tab, slug);
      const works = await passwordWorksFor(slug, [a, b], `${slug}-race-1`);
      const order = proxy.answers.map((t) => (t === tokenA ? 'older' : 'newer'));
      const said = `named ${named}, signed in as ${who || 'nobody'}, the password works for ${JSON.stringify(works)}; the answers reached the browser: ${order.join(', ')}`;
      if (who !== named) out.push(`signed in as another owner than the page named: ${said}`);
      if (JSON.stringify(works) !== JSON.stringify([named])) out.push(`the password was set for another owner than the page named: ${said}`);
      if (named !== b) out.push(`the page does not name the newer link's owner: ${said}`);
      if (lede !== `Choose the password you will sign in with as ${named}.`) out.push(`the sentence names someone else: ${lede}`);
    } finally { await tab.close(); await proxy.close(); }
    return out;
  };
  await test('two links in quick succession in one tab, the older answered last: the page names the newer owner and sets their password', async () => {
    assert.deepEqual(await raceTwoLinks('india'), []);
  });
  await test('the two-links check fails on a page that opens a new link while another is being opened', async () => {
    const without = (js) => js.replace(/^\s*if \(busy\) \{ queued = found; return; \}.*$/m, '');
    assert.notEqual(without(PAGE_JS), PAGE_JS, 'the line that makes a new link wait was found to take out');
    const out = await raceTwoLinks('indigo', without);
    assert.ok(out.length > 0, 'the check did not notice the two links opened at once');
  });

  // The same link opened twice in quick succession in one tab (only the fragment changes): the first exchange is good,
  // a second exchange of the same, spent token would answer 401 and tell the owner the link is dead though the step is
  // live. The second, identical link is ignored: the form stays, names the owner, and the password sets. `held`: the
  // second link comes while the first is still being answered; otherwise after it was answered.
  const sameLinkTwice = async (slug, held, mutate = null) => {
    const url = await signupByCall(slug);
    tokens.push(url.split('#')[1]);
    const proxy = await delayingProxy();
    const origin = `http://${slug}.localhost:${proxy.port}`;
    const link = url.replace(`:${port}/`, `:${proxy.port}/`);
    const tab = await openTab({ mutate });
    const out = [];
    try {
      await tab.go(`${origin}/login/first-password`);
      await tab.waitFor(tab.visible('fp-password'), 'the form, with no link yet');
      if (held) { proxy.hold.token = url.split('#')[1]; proxy.hold.ms = 800; }
      await tab.go(link);
      if (held) await sleep(150);
      else { const end = Date.now() + 10000; while (proxy.answers.length < 1 && Date.now() < end) await sleep(50); await sleep(300); }
      await tab.go(link);
      await sleep(held ? 1500 : 700);
      if (await tab.evaluate(tab.visible('fp-dead'))) out.push('the dead-link sentence is showing though the step is live');
      if (!(await tab.evaluate(tab.visible('fp-password')))) out.push('the form is not showing');
      if ((await tab.evaluate("document.getElementById('fp-login').value")) !== `own${slug}`) out.push('the form does not name the owner');
      if (!(await fragmentGone(tab, origin))) out.push('the address keeps the fragment');
      if (out.length === 0) {
        await sendForm(tab, `${slug}-same-1`);
        if ((await signedInAs(tab, slug)) !== `own${slug}`) out.push('the password did not set');
      }
    } finally { await tab.close(); await proxy.close(); }
    return out;
  };
  for (const held of [true, false]) {
    await test(`the same link twice in one tab, the second ${held ? 'while the first is being answered' : 'after it was answered'}: the form stays and the password sets`, async () => {
      assert.deepEqual(await sameLinkTwice(held ? 'lima' : 'mike', held), []);
    });
  }

  // Two tabs of one browser share the step's cookie: a link opened in the second tab replaces the first tab's step.
  // The first tab, still naming its owner, must not set the second owner's password: the set step refuses it.
  await test("two tabs of one browser, a link in each: the older tab's form cannot set the newer owner's password", async () => {
    const slug = 'juliet';
    const { a, b, linkA, linkB } = await twoOwners(slug);
    const one = await openTab();
    const two = await openTab({ sharedWith: one });
    try {
      await one.go(linkA);
      await one.waitFor(`${one.visible('fp-password')} && document.getElementById('fp-login').value === ${JSON.stringify(a)}`, 'the first tab naming its owner');
      await two.go(linkB);
      await two.waitFor(`${two.visible('fp-password')} && document.getElementById('fp-login').value === ${JSON.stringify(b)}`, 'the second tab naming its owner');
      await sendForm(one, `${slug}-tab-1`);
      const who = await signedInAs(one, slug);
      const works = await passwordWorksFor(slug, [a, b], `${slug}-tab-1`);
      assert.equal(who, '', `the first tab, naming ${a}, signed in as ${who}`);
      assert.deepEqual(works, [], `the first tab, naming ${a}, set a password for ${JSON.stringify(works)}`);
      assert.equal(await one.evaluate("document.getElementById('fp-dead-text').textContent"), DEAD, 'the first tab says its link is dead');
      // The second tab's step is untouched by the refusal.
      await sendForm(two, `${slug}-tab-2`);
      assert.equal(await signedInAs(two, slug), b, 'the second tab signs in as its owner');
      assert.deepEqual(await passwordWorksFor(slug, [a, b], `${slug}-tab-2`), [b]);
    } finally { await two.close(); await one.close(); }
  });

  // A fragment that is not a link (`#x`, or an empty one) opened in a tab that already shows the form leaves the form
  // as it is and sends nothing; the step is still open, and the password can still be set. At load, it is dead at once.
  await test('a fragment that is no link, after a good link in the same tab, leaves the form as it is', async () => {
    const slug = 'kilo';
    const origin = originOf(slug);
    const url = await signupByCall(slug);
    tokens.push(url.split('#')[1]);
    const tab = await openTab({ width: 390 });
    try {
      await tab.go(url);
      await tab.waitFor(`${tab.visible('fp-password')} && document.getElementById('fp-login').value === 'own${slug}'`, 'the form');
      tab.requests.length = 0;
      await tab.evaluate('window.samePage = true');
      for (const junk of ['x', '', 'not-a-link']) {
        await tab.go(`${origin}/login/first-password#${junk}`);
        await sleep(400);
        assert.equal(await tab.evaluate('window.samePage === true'), true, 'the browser stayed on the page');
        assert.ok(await tab.evaluate(tab.visible('fp-password')), `the form is still there after #${junk}`);
        assert.equal(await tab.evaluate("document.getElementById('fp-login').value"), `own${slug}`, `the form still names its owner after #${junk}`);
        assert.ok(!(await tab.evaluate(tab.visible('fp-dead'))), `no dead-link panel after #${junk}`);
        assert.ok(await fragmentGone(tab, origin), `#${junk} is out of the address`);
      }
      assert.ok(!tab.requests.some((r) => r.url.endsWith('/api/login/first-password')), 'no exchange for a fragment that is no link');
      await sendForm(tab, `${slug}-password-1`);
      assert.equal(await signedInAs(tab, slug), `own${slug}`, 'the step was still open');
      // At load, a fragment that is no link: the dead-link sentence, with no exchange sent.
      tab.requests.length = 0;
      await tab.go('about:blank');
      await tab.go(`${origin}/login/first-password#x`);
      await tab.waitFor(tab.visible('fp-dead-text'), 'the dead-link sentence');
      assert.ok(await fragmentGone(tab, origin));
      assert.ok(!tab.requests.some((r) => r.url.endsWith('/api/login/first-password')), 'no exchange for a fragment that is no link, at load');
    } finally { await tab.close(); }
  });

  // --- pictures of each state, 390 and 1280, light and dark ----------------------------------------------------------
  if (SHOTS) {
    await test('pictures', async () => {
      let i = 0;
      for (const width of [390, 1280]) {
        for (const mode of ['light', 'dark']) {
          i += 1;
          const slug = `pic${i}`;
          const url = await signupByCall(slug);
          const tab = await openTab({ width, mode });
          try {
            await tab.go(url);
            await tab.waitFor(tab.visible('fp-password'), 'the form');
            await tab.shot('choose');
            await tab.type('#fp-password', 'short');
            await tab.evaluate("document.getElementById('fp-submit').click()");
            await tab.waitFor(tab.visible('fp-error'), 'the error');
            await tab.shot('too-short');
            await tab.go('about:blank'); // the same address again is a new page, not a jump within this one
            await tab.go(url);
            await tab.waitFor(tab.visible('fp-dead-text'), 'the dead sentence');
            await tab.shot('dead');
            assert.deepEqual(await tab.layoutProblems(), [], `${width} ${mode}`);
          } finally { await tab.close(); }
        }
      }
    });
  }

  await test('the token is in nothing the server wrote', async () => {
    for (const t of tokens) assert.ok(!log.includes(t), 'the server output carries a token');
  });
} catch (err) {
  failed += 1;
  console.error(`check-first-password-page: ${err.stack || err.message}`);
} finally {
  if (browser) {
    const done = new Promise((r) => browser.child.once('exit', r));
    browser.child.kill('SIGTERM'); // this browser only
    await Promise.race([done, sleep(5000)]);
    try { fs.rmSync(browser.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a browser still closing may hold its profile a moment longer */ }
  }
  await new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
  fs.rmSync(dataDir, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-first-password-page: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-first-password-page: ${n} OK${SHOTS ? ` (pictures in ${SHOTS})` : ''}`);
