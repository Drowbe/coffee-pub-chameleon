#!/usr/bin/env node
// check-light-default.mjs: the environment's light default, live (headless Chromium, the demo seeder).
// The environment's default is Light and nobody has picked a mode of their own: <html> carries data-mode-shown="light" and no
// data-theme-mode. Every light-only rule in public/sdk/system.css must hold then too. This boots a throwaway server, fills it
// with the demo trip (tools/seed-demo.mjs), sets the environment's themeMode to light, checks that the member has no mode of
// their own, and opens the demo trip's Planner and Polls. On each page it asserts:
//   - <html> has data-mode-shown="light" and no data-theme-mode
//   - --card-kind-l is 0.38 and --card-disc-l is 0.5 (the light card tokens reached the page)
//   - every card kind label (the kind word beside a card's icon, .sdk-card-sub.sdk-tint-text) is at least 4.5 to 1 against
//     the background it sits on (its own colour, composited over every background behind it). The Planner's cards carry
//     kind labels; the Polls' do not, so Polls is checked for the mode and the tokens only.
// The colours are read as the browser paints them (a 1-pixel canvas), so oklch() and color-mix() are measured as drawn.
// Usage: node tools/check-light-default.mjs. With no Chromium it says SKIPPED and exits 0 (a skip, never a pass).
// Set CHROME_PATH to a Chromium to run it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findBrowser, launch, freePort, sleep } from './shots.mjs';
import { runSeed } from './seed-demo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const say = (...a) => console.log('check-light-default:', ...a);
const PASSWORD = 'testpass1234';
const MIN = 4.5;
const failures = [];

// The page's own test, run in the page: the light card tokens, the mode attributes, and each kind label with its colours.
// Canvas reads a colour string as the browser would paint it, as 8-bit sRGB with alpha.
const MEASURE = `(() => {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (css) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  // a over b (both non-premultiplied rgba)
  const over = (a, b) => { const al = a[3] + b[3] * (1 - a[3]); if (al === 0) return [0, 0, 0, 0]; const m = (i) => (a[i] * a[3] + b[i] * b[3] * (1 - a[3])) / al; return [m(0), m(1), m(2), al]; };
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  const roots = []; (function walk(r) { roots.push(r); for (const x of r.querySelectorAll('*')) if (x.shadowRoot) walk(x.shadowRoot); })(document);
  const labels = [];
  for (const r of roots) for (const e of r.querySelectorAll('.sdk-card-sub.sdk-tint-text')) if (e.getClientRects().length) labels.push(e);
  // The background behind an element: every ancestor's background (crossing a shadow host), composited from the farthest.
  const under = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement || (e.getRootNode && e.getRootNode().host) || null) {
      const c = rgba(getComputedStyle(e).backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
    }
    if (!layers.length || layers[layers.length - 1][3] < 1) layers.push(rgba(getComputedStyle(document.body).backgroundColor || 'white'));
    let acc = null;
    for (let i = layers.length - 1; i >= 0; i--) acc = acc ? over(layers[i], acc) : layers[i];
    return acc;
  };
  const out = labels.map((e) => {
    const fg = rgba(getComputedStyle(e).color);
    const bg = under(e);
    const text = (e.textContent || '').replace(/\\s+/g, ' ').trim();
    const shown = over(fg, bg);
    return { text, fg: fg.slice(0, 3), bg: bg.slice(0, 3).map(Math.round), ratio: Math.round(ratio(shown.slice(0, 3), bg.slice(0, 3)) * 100) / 100 };
  });
  return {
    themeMode: root.hasAttribute('data-theme-mode') ? root.getAttribute('data-theme-mode') : null,
    modeShown: root.getAttribute('data-mode-shown'),
    cardKindL: cs.getPropertyValue('--card-kind-l').trim(),
    cardDiscL: cs.getPropertyValue('--card-disc-l').trim(),
    labels: out,
  };
})()`;

const COOKIE_NAMES = (setCookies) => setCookies.map((c) => c.split(';')[0]).map((nv) => { const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1) }; });

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-default-'));
  const base = `http://127.0.0.1:${port}`;
  let log = '';
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TZ: 'UTC', PORT: String(port), DATA_DIR: dataDir, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ADMIN_PASSWORD: PASSWORD },
  });
  child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  let browser = null;
  try {
    for (let i = 0; i < 150; i++) {
      try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ }
      if (child.exitCode !== null) throw new Error('the throwaway server did not start: ' + log.slice(-400));
      await sleep(200);
    }
    // Signs in and returns the session cookies for a login.
    const signIn = async (login, password) => {
      const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ login, password }) });
      if (r.status !== 200) throw new Error(`cannot sign in as ${login}: ${r.status}`);
      return COOKIE_NAMES(r.headers.getSetCookie());
    };
    const jar = (cookies) => cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const adminJar = await signIn('admin', PASSWORD);

    // The demo trip, and the environment's default mode set to light (the owner's setting, PATCH /api/settings).
    const today = new Date().toISOString().slice(0, 10);
    const seeded = await runSeed({ base, login: 'admin', adminPassword: PASSWORD, today, noAi: true, say: () => {} });
    const trip = seeded.space.id;
    const set = await fetch(`${base}/api/settings`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: jar(adminJar) }, body: JSON.stringify({ themeMode: 'light' }) });
    if (set.status !== 200) throw new Error(`the environment's mode could not be set to light: ${set.status}`);

    // A member with no mode of their own: the demo's Mia, whose account has no themeMode.
    const miaJar = await signIn('mia', seeded.pass.mia);
    const me = await (await fetch(`${base}/api/me`, { headers: { cookie: jar(miaJar), accept: 'application/json' } })).json();
    const own = me.user && me.user.themeMode;
    if (own !== null && own !== undefined) failures.push(`Mia has a mode of her own (${own}); the check needs none`);

    browser = await launch(bin);
    // A browser context of its own: no cookie or storage is shared with anything else.
    const { browserContextId } = await browser.cdp.send('Target.createBrowserContext');
    const { targetId } = await browser.cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await browser.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => browser.cdp.send(m, p, sessionId);
    await s('Page.enable'); await s('Runtime.enable'); await s('Network.enable');
    await s('Network.setBypassServiceWorker', { bypass: true });
    await s('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await s('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
    await s('Emulation.setLocaleOverride', { locale: 'en-US' });
    // Mia's session, set on the page's own address: nothing else is put on the page (no mode, no storage), so the default shows.
    for (const c of miaJar) await s('Network.setCookie', { name: c.name, value: c.value, url: base, httpOnly: true });

    const evaluate = async (expr) => {
      const r = await s('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    };
    // The module is drawn in the canvas's own frame (a shadow root under #module-frame): wait until its first element is there.
    const open = async (url, ready) => {
      await s('Page.navigate', { url: base + url });
      const end = Date.now() + 20000;
      while (Date.now() < end) {
        const seen = await evaluate(`(() => { const roots = []; (function walk(r) { roots.push(r); for (const x of r.querySelectorAll('*')) if (x.shadowRoot) walk(x.shadowRoot); })(document); return roots.some((r) => r.querySelector(${JSON.stringify(ready)})); })()`).catch(() => false);
        if (seen) break;
        await sleep(150);
      }
      await sleep(2500); // the page keeps drawing for a moment after it is there
    };

    const pages = [
      ['Planner', `/modules/travel?space=${trip}`, '.day-add'],
      ['Polls', `/modules/polls?space=${trip}`, 'button'],
    ];
    for (const [name, url, ready] of pages) {
      await open(url, ready);
      const m = await evaluate(MEASURE);
      if (m.themeMode !== null) failures.push(`${name}: <html> has data-theme-mode="${m.themeMode}" (the check needs none)`);
      if (m.modeShown !== 'light') failures.push(`${name}: <html> has data-mode-shown="${m.modeShown}", not light`);
      if (m.cardKindL !== '0.38') failures.push(`${name}: --card-kind-l is ${m.cardKindL || '(unset)'}, not 0.38`);
      if (m.cardDiscL !== '0.5') failures.push(`${name}: --card-disc-l is ${m.cardDiscL || '(unset)'}, not 0.5`);
      // The Planner's cards carry kind labels; the Polls' cards do not (none to measure there, the tokens and modes still are).
      if (name === 'Planner' && !m.labels.length) failures.push(`${name}: no card kind labels found to measure`);
      const worst = m.labels.filter((l) => l.ratio < MIN);
      for (const l of worst) failures.push(`${name}: "${l.text}" is ${l.ratio} to 1 (needs ${MIN})`);
      say(`${name}: data-mode-shown=${m.modeShown}, data-theme-mode=${m.themeMode ?? '(none)'}, --card-kind-l ${m.cardKindL}, --card-disc-l ${m.cardDiscL}`);
      const kinds = new Map();
      for (const l of m.labels) kinds.set(l.text, Math.min(kinds.get(l.text) ?? Infinity, l.ratio));
      say(`${name}: ${m.labels.length} card kind labels, ${kinds.size} kinds, lowest ${Math.min(...m.labels.map((l) => l.ratio))} to 1`);
      for (const [text, ratio] of kinds) say(`  ${name}  ${text}: ${ratio} to 1`);
    }
  } catch (e) {
    failures.push(`could not run: ${e.message}`);
  } finally {
    if (browser) {
      const done = new Promise((r) => browser.child.once('exit', r));
      browser.child.kill();
      await Promise.race([done, sleep(5000)]);
      try { fs.rmSync(browser.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a browser still closing may hold its profile a moment longer: the temporary folder is left, not a failure */ }
    }
    if (child.exitCode === null) {
      const gone = new Promise((r) => child.once('exit', r));
      child.kill('SIGTERM');
      await Promise.race([gone, sleep(8000)]);
    }
    try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* as above */ }
  }
  if (failures.length) {
    for (const f of failures) console.error('check-light-default: FAIL ' + f);
    return 1;
  }
  say('ok: the light default holds the light card tokens, and every Planner card kind label reads at 4.5 to 1 or better');
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error('check-light-default: ERROR ' + (e.stack || e)); process.exit(1); });
