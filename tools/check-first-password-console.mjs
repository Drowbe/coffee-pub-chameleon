#!/usr/bin/env node
/*
 * check-first-password-console.mjs -- the host console's "New first-password link" (plan-first-password.md, Decision 4,
 * step 3), live in headless Chromium over the DevTools protocol (tools/shots.mjs) against a throwaway hosted server
 * (BASE_DOMAIN=localhost, SIGNUP=on; Chromium sends localhost and every *.localhost to this machine):
 *   - the button shows on an environment's page (its Owners and two-step tab) only for an owner who has no password yet, named by login; an
 *     environment whose owner has a password has none;
 *   - pressed (from the keyboard), it shows the link once in a read-only field, with focus on it, the sentence "This link
 *     works once, for 24 hours. Send it to the owner." and Copy and Close; Copy copies it; Escape and Close hide it, clear
 *     the field and give focus back to the button; neither while it shows nor after is the link in the page's markup,
 *     localStorage or sessionStorage; and that check fails on a console that writes the link to sessionStorage;
 *   - the link works once at the environment's own page (the owner chooses a password and is signed in) and is dead the
 *     second time; a link replaced by a newer one is dead too; the page then no longer offers the button;
 *   - at 390 and 1280 wide: no sideways scroll, no console error, and at 390 every control of the first-password box
 *     has a 44px target (the page's other buttons are not this check's).
 * `--shots=<dir>`: also writes a picture of each state at 390 and 1280 (the console is always dark) into <dir>.
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
const SENTENCE = 'This link works once, for 24 hours. Send it to the owner.';
const HOST_LOGIN = 'boss';
const HOST_PASSWORD = 'check-first-password-console-1';
const shotsArg = process.argv.find((a) => a.startsWith('--shots='));
const SHOTS = shotsArg ? path.resolve(shotsArg.slice('--shots='.length)) : '';
const HOST_JS = fs.readFileSync(path.join(ROOT, 'public', 'host.js'), 'utf8');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-first-password-console: ${name}: ${err.stack || err.message}`); }
};

const bin = findBrowser();
if (!bin) {
  console.log('check-first-password-console: SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.');
  process.exit(0);
}

const port = await freePort();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-first-password-console-'));
let log = '';
const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), DATA_DIR: dataDir, BASE_DOMAIN: 'localhost', SIGNUP: 'on', ADMIN_LOGIN: HOST_LOGIN, ADMIN_PASSWORD: HOST_PASSWORD, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret' },
});
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });

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
// The owner sets their first password by direct calls (the exchange, then the set step).
async function finishByCall(slug, url, password) {
  const token = url.split('#')[1];
  const ex = await call('POST', slug, '/api/login/first-password', { token });
  assert.equal(ex.status, 200, ex.text);
  const pending = ex.cookies.find((c) => c.startsWith('mfa_pending='));
  const set = await call('POST', slug, '/api/login/first-password/set', { login: ex.json.login, password }, { cookie: pending });
  assert.equal(set.status, 200, set.text);
}

let browser = null;

// A tab of its own (its own cookies and storage), `width` wide, dark, from its own address. Records console errors and
// exceptions. `mutate`: the console's script served changed (the proof that the storage check notices a kept link).
async function openTab({ width = 1280, from = nextIp(), mutate = null } = {}) {
  const { browserContextId } = await browser.cdp.send('Target.createBrowserContext');
  const { targetId } = await browser.cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await browser.cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => browser.cdp.send(m, p, sessionId);
  const problems = [];
  const listener = (m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(`console: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    else if (m.method === 'Runtime.exceptionThrown') problems.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && m.params.entry.source !== 'network') problems.push(`log: ${m.params.entry.text} ${m.params.entry.url || ''}`);
    else if (m.method === 'Fetch.requestPaused') {
      if (new URL(m.params.request.url).pathname !== '/host.js') { s('Fetch.continueRequest', { requestId: m.params.requestId }).catch(() => {}); return; }
      const body = Buffer.from(mutate(HOST_JS)).toString('base64');
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
  await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await s('Emulation.setFocusEmulationEnabled', { enabled: true });
  if (mutate) await s('Fetch.enable', { patterns: [{ urlPattern: '*/host.js', requestStage: 'Request' }] });
  const evaluate = async (expr) => {
    const r = await s('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
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
  const visibleSel = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); return Boolean(el) && !el.closest('[hidden]') && el.getClientRects().length > 0; })()`;
  const type = async (selector, text) => {
    await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select?.(); })()`);
    await s('Input.insertText', { text });
  };
  const key = async (k, code, keyCode) => {
    await s('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: keyCode, ...(k === 'Enter' ? { text: '\r' } : {}) });
    await s('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: keyCode });
  };
  const shot = async (name) => {
    if (!SHOTS) return;
    await sleep(250);
    const { data } = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(SHOTS, `${name}-${width}-dark.png`), Buffer.from(data, 'base64'));
  };
  // Sideways scroll, controls under 44px at a phone's width (a small button's hit area grows past its box, system.css),
  // and the console's errors so far.
  const layoutProblems = async (within = 'body') => {
    const found = await evaluate(`(() => {
      const out = [];
      const doc = document.documentElement;
      if (doc.scrollWidth > doc.clientWidth + 1) out.push('sideways scroll: ' + doc.scrollWidth + ' > ' + doc.clientWidth);
      if (innerWidth <= 640) {
        for (const el of document.querySelector(${JSON.stringify(within)}).querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea')) {
          if (el.closest('[hidden]') || !el.getClientRects().length) continue;
          const r = el.getBoundingClientRect();
          if (r.height >= 44 - 0.5) continue;
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          const hits = [y - 21, y + 21].every((yy) => { const at = document.elementFromPoint(x, yy); return at === el || el.contains(at); });
          if (!hits) out.push((el.dataset.action || el.id || el.textContent.trim() || el.tagName) + ' is ' + Math.round(r.height) + 'px tall, with no 44px hit area');
        }
      }
      return out;
    })()`);
    return [...found, ...problems];
  };
  const close = async () => {
    browser.cdp.listeners = browser.cdp.listeners.filter((f) => f !== listener);
    await browser.cdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  };
  return { s, evaluate, waitFor, go, visibleSel, type, key, shot, layoutProblems, problems, close, width };
}

// The environment's page, on its Owners and two-step tab (plan-host-console.md): where the button and the link are.
const card = (slug) => `#environment-page[data-slug="${slug}"]`;
async function openOwners(tab, slug) {
  await tab.evaluate(`location.hash = ${JSON.stringify(`#environments/${slug}/owners`)}`);
  await tab.waitFor(`${tab.visibleSel(card(slug))} && ${tab.visibleSel('#env-pane-owners')}`, `the Owners tab of ${slug}`);
}
async function signInToConsole(tab) {
  await tab.go(`http://admin.localhost:${port}/`);
  await tab.waitFor(tab.visibleSel('#login-form'), 'the console sign-in');
  await tab.type('#login-name', HOST_LOGIN);
  await tab.type('#login-password', HOST_PASSWORD);
  await tab.evaluate("document.querySelector('#login-form button[type=submit]').click()");
  await tab.waitFor(`${tab.visibleSel('#env-table')} && document.querySelectorAll('#env-rows tr[data-slug]').length >= 2`, 'the environments table');
}
// The box that shows the link, on the page: whether it shows, the field's value, whether it is read-only, the sentence.
const madeState = (tab, slug) => tab.evaluate(`(() => {
  const made = document.querySelector(${JSON.stringify(`${card(slug)} [data-slot="first-password-made"]`)});
  const field = made.querySelector('[data-slot="first-password-url"]');
  return { shown: !made.closest('[hidden]'), value: field.value, readOnly: field.readOnly, hint: made.querySelector('.hint').textContent, label: field.closest('label').textContent.trim(), focused: document.activeElement === field };
})()`);
// Where the page keeps a link's token: its markup, localStorage, sessionStorage (keys or values). [] when nowhere.
const linkKept = (tab, url) => tab.evaluate(`(() => {
  const t = ${JSON.stringify(url.split('#')[1])};
  const out = [];
  if (document.documentElement.outerHTML.includes(t)) out.push('the page');
  const holds = (store) => { for (let i = 0; i < store.length; i += 1) { const k = store.key(i); if (k.includes(t) || String(store.getItem(k)).includes(t)) return true; } return false; };
  if (holds(localStorage)) out.push('localStorage');
  if (holds(sessionStorage)) out.push('sessionStorage');
  return out;
})()`);
const focusedIsButton = (tab, slug, login) => tab.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(`${card(slug)} [data-action="first-password"][data-login="${login}"]`)})`);

try {
  const end = Date.now() + 25000;
  while (!/listening on :\d+/.test(log)) {
    if (child.exitCode !== null || Date.now() > end) throw new Error(`the throwaway server did not start:\n${log.slice(-600)}`);
    await sleep(100);
  }
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  browser = await launch(bin);
  await browser.cdp.send('Browser.grantPermissions', { origin: `http://admin.localhost:${port}`, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});

  // Each width its own pair: one owner waiting for a first password, one who has set it.
  for (const [width, waiting, done] of [[1280, 'alpha', 'bravo'], [390, 'charlie', 'delta']]) {
    await test(`${width}: the button only for an owner with no password; the link once, Copy, Escape, Close; it works once`, async () => {
      await signupByCall(waiting);
      await finishByCall(done, await signupByCall(done), `${done}-password-1`);
      const tab = await openTab({ width });
      try {
        await signInToConsole(tab);
        const login = `own${waiting}`;
        await openOwners(tab, done);
        assert.equal(await tab.evaluate(`document.querySelectorAll(${JSON.stringify(`${card(done)} [data-action="first-password"]`)}).length`), 0, 'no button where the owner has a password');
        assert.equal(await tab.evaluate(`Boolean(document.querySelector(${JSON.stringify(`${card(done)} [data-slot="first-password"]`)}).closest('[hidden]'))`), true, 'nor its box');
        await openOwners(tab, waiting);
        const buttonSel = `${card(waiting)} [data-action="first-password"]`;
        assert.ok(await tab.evaluate(tab.visibleSel(buttonSel)), 'the button shows for the waiting owner');
        assert.deepEqual(await tab.evaluate(`[...document.querySelectorAll(${JSON.stringify(buttonSel)})].map((b) => [b.dataset.login, b.textContent, b.className])`), [[login, 'New first-password link', 'btn btn-small']]);
        assert.equal(await tab.evaluate(`document.querySelector(${JSON.stringify(`${card(waiting)} [data-slot="first-password-rows"]`)}).textContent.includes(${JSON.stringify(`${login} has no password yet.`)})`), true);
        assert.equal((await madeState(tab, waiting)).shown, false, 'no link before the button is pressed');
        await tab.evaluate(`document.querySelector(${JSON.stringify(buttonSel)}).scrollIntoView({ block: 'center' })`);
        await tab.shot('console-button');
        assert.deepEqual(await tab.layoutProblems(`${card(waiting)} [data-slot="first-password"]`), [], 'the button');

        // Pressed from the keyboard.
        await tab.evaluate(`document.querySelector(${JSON.stringify(buttonSel)}).focus()`);
        await tab.key('Enter', 'Enter', 13);
        await tab.waitFor(`${tab.visibleSel(`${card(waiting)} [data-slot="first-password-made"]`)}`, 'the link');
        let made = await madeState(tab, waiting);
        assert.match(made.value, new RegExp(`^http://${waiting}\\.localhost:${port}/login/first-password#[A-Za-z0-9_-]{43}$`));
        assert.deepEqual([made.readOnly, made.hint, made.label, made.focused], [true, SENTENCE, `Link for ${login}`, true]);
        const first = made.value;
        assert.deepEqual(await linkKept(tab, first), [], 'while it shows, the link is only in the field: not in the markup or storage');
        await tab.shot('console-link');
        assert.deepEqual(await tab.layoutProblems(`${card(waiting)} [data-slot="first-password"]`), [], 'the link, its field and its buttons');

        // Copy.
        await tab.evaluate(`document.querySelector(${JSON.stringify(`${card(waiting)} [data-action="first-password-copy"]`)}).click()`);
        await tab.waitFor(`document.querySelector(${JSON.stringify(`${card(waiting)} [data-slot="first-password-status"]`)}).textContent === 'copied'`, 'copied');
        const clip = await tab.evaluate('navigator.clipboard.readText().catch(() => null)');
        if (clip !== null) assert.equal(clip, first, 'the clipboard has the link');

        // Escape hides it, clears it and gives focus back to the button.
        await tab.evaluate(`document.querySelector(${JSON.stringify(`${card(waiting)} [data-slot="first-password-url"]`)}).focus()`);
        await tab.key('Escape', 'Escape', 27);
        made = await madeState(tab, waiting);
        assert.deepEqual([made.shown, made.value], [false, ''], 'Escape closes it');
        assert.ok(await focusedIsButton(tab, waiting, login), 'focus is back on the button');
        assert.deepEqual(await linkKept(tab, first), [], 'the page keeps no link, in its markup or its storage');
        await tab.shot('console-closed');

        // A second link replaces the first; Close hides it.
        await tab.evaluate(`document.querySelector(${JSON.stringify(buttonSel)}).click()`);
        await tab.waitFor(`document.querySelector(${JSON.stringify(`${card(waiting)} [data-slot="first-password-url"]`)}).value !== ''`, 'the second link');
        const second = (await madeState(tab, waiting)).value;
        assert.notEqual(second, first);
        await tab.evaluate(`document.querySelector(${JSON.stringify(`${card(waiting)} [data-action="first-password-close"]`)}).click()`);
        made = await madeState(tab, waiting);
        assert.deepEqual([made.shown, made.value], [false, ''], 'Close closes it');
        assert.ok(await focusedIsButton(tab, waiting, login), 'focus is back on the button after Close');
        assert.deepEqual(await linkKept(tab, second), [], 'after Close the page keeps no link, in its markup or its storage');
        assert.deepEqual(await linkKept(tab, first), [], 'nor the first one');
        assert.deepEqual(await tab.layoutProblems(`${card(waiting)} [data-slot="first-password"]`), [], 'the console');

        // The replaced link is dead; the newer one works once, at the environment's own page.
        const owner = await openTab({ width });
        try {
          await owner.go(first);
          await owner.waitFor(owner.visibleSel('#fp-dead-text'), 'the dead-link sentence for the replaced link');
          assert.equal(await owner.evaluate("document.getElementById('fp-dead-text').textContent"), DEAD);
          await owner.go('about:blank');
          await owner.go(second);
          await owner.waitFor(owner.visibleSel('#fp-password'), 'the choose-your-password form');
          assert.equal(await owner.evaluate("document.getElementById('fp-login').value"), login);
          await owner.type('#fp-password', `${waiting}-password-1`);
          await owner.evaluate("document.getElementById('fp-submit').click()");
          await owner.waitFor(`location.origin === ${JSON.stringify(`http://${waiting}.localhost:${port}`)} && location.pathname === '/'`, 'Home, signed in');
          await owner.go('about:blank');
          await owner.go(second);
          await owner.waitFor(owner.visibleSel('#fp-dead-text'), 'the dead-link sentence the second time');
          assert.equal(await owner.evaluate("document.getElementById('fp-dead-text').textContent"), DEAD);
        } finally { await owner.close(); }
        const signedIn = await call('POST', waiting, '/api/login', { login, password: `${waiting}-password-1` });
        assert.equal(signedIn.status, 200, 'the password works at the sign-in');

        // The page no longer offers the button.
        await tab.s('Page.reload', {});
        await tab.waitFor(`${tab.visibleSel(card(waiting))} && ${tab.visibleSel('#env-pane-owners')}`, 'the page again');
        assert.equal(await tab.evaluate(`document.querySelectorAll(${JSON.stringify(buttonSel)}).length`), 0, 'no button once the password is set');
      } finally { await tab.close(); }
    });
  }

  await test('the storage check fails on a console that writes the link to sessionStorage', async () => {
    const keep = (js) => js.replace('  field.value = url;\n', "  field.value = url;\n  sessionStorage.setItem('kept', url);\n");
    assert.notEqual(keep(HOST_JS), HOST_JS, 'the line that shows the link was found');
    await signupByCall('foxtrot');
    const tab = await openTab({ mutate: keep });
    try {
      await signInToConsole(tab);
      await openOwners(tab, 'foxtrot');
      await tab.evaluate(`document.querySelector(${JSON.stringify(`${card('foxtrot')} [data-action="first-password"]`)}).click()`);
      await tab.waitFor(`document.querySelector(${JSON.stringify(`${card('foxtrot')} [data-slot="first-password-url"]`)}).value !== ''`, 'the link');
      const url = (await madeState(tab, 'foxtrot')).value;
      assert.deepEqual(await linkKept(tab, url), ['sessionStorage'], 'while it shows');
      await tab.evaluate(`document.querySelector(${JSON.stringify(`${card('foxtrot')} [data-action="first-password-close"]`)}).click()`);
      assert.equal((await madeState(tab, 'foxtrot')).value, '', 'Close cleared the field');
      assert.deepEqual(await linkKept(tab, url), ['sessionStorage'], 'after Close');
    } finally { await tab.close(); }
  });

  await test('a refusal shows its sentence on the page', async () => {
    // The owner sets the password in another way while the page still offers the button: the server's sentence shows.
    const url = await signupByCall('echo');
    const tab = await openTab({ width: 390 });
    try {
      await signInToConsole(tab);
      await openOwners(tab, 'echo');
      await finishByCall('echo', url, 'echo-password-1');
      await tab.evaluate(`document.querySelector(${JSON.stringify(`${card('echo')} [data-action="first-password"]`)}).click()`);
      const status = `${card('echo')} [data-slot="first-password-status"]`;
      await tab.waitFor(`document.querySelector(${JSON.stringify(status)}).textContent !== ''`, 'the refusal');
      assert.equal(await tab.evaluate(`document.querySelector(${JSON.stringify(status)}).textContent`), 'This owner has a password already, so there is no first password to set.');
      assert.equal(await tab.evaluate(`document.querySelector(${JSON.stringify(status)}).classList.contains('error')`), true);
      assert.equal((await madeState(tab, 'echo')).shown, false, 'no link');
      await tab.evaluate(`document.querySelector(${JSON.stringify(status)}).scrollIntoView({ block: 'center' })`);
      await tab.shot('console-refused');
    } finally { await tab.close(); }
  });
} catch (err) {
  failed += 1;
  console.error(`check-first-password-console: ${err.stack || err.message}`);
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
  console.error(`check-first-password-console: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-first-password-console: ${n} OK${SHOTS ? ` (pictures in ${SHOTS})` : ''}`);
