#!/usr/bin/env node
/*
 * check-surface-steps.mjs -- the five module surfaces (title bar, toolbar, content, row, status bar; the --mf-surface-* tokens in the
 * moduleframe block of public/sdk/system.css, with a theme's own overrides) each differ from the next by a minimum visible step, in every
 * theme of public/design-system/themes/ and in both modes (GitHub #371 item 5; Thomas's approved Prototype decision).
 *
 * How. The Prototype page (public/design-system/prototype.html?theme=..&mode=..) is loaded in headless Chromium against a throwaway server
 * (tools/shots.mjs), one theme and mode at a time. For each surface a probe element takes `background: var(--mf-surface-X)`, so the browser
 * resolves the real color-mix() expressions and the theme's overrides; the resolved colour is read back from a canvas as sRGB 8 bit.
 * With no Chromium it says SKIPPED and exits 0 (a skip, never a pass), and fails when CI is set.
 *
 * The measure. CIE deltaE 2000 (sRGB, D65, to Lab) between neighbouring surfaces, implemented below (no library). Neighbours, top down:
 * title vs toolbar, toolbar vs content, content vs row, row vs status. Each must be at least MIN_STEP. The status bar is the title bar's
 * tone by design, so that pair (title vs status) is asserted EQUAL (deltaE 0), not stepped.
 *
 * MIN_STEP is set just under the smallest step in the core theme (strong-coffee, light and dark), which Thomas approved on the Prototype;
 * a theme that is visibly flat falls under it. Do not lower it to hide a theme: list the theme in KNOWN with a reason instead.
 *
 * Usage: node tools/check-surface-steps.mjs [--table]   (--table prints every theme x mode x pair, failing or not)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findBrowser, launch, freePort, startServer, stopServer, Tab, sleep } from './shots.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TABLE = process.argv.includes('--table');
const say = (...a) => console.log('check-surface-steps:', ...a);

const MIN_STEP = 2.0; // deltaE 2000; see the comment at the head of the file for how it was chosen
const SURFACES = ['title', 'toolbar', 'content', 'row', 'status'];
const PAIRS = [['title', 'toolbar'], ['toolbar', 'content'], ['content', 'row'], ['row', 'status']];
const CORE = ['strong-coffee']; // the core theme: never on the known list
// Themes below the minimum today. Each is tolerated until the palette is redone; a theme not named here, or a core one, fails.
const KNOWN = {
  // 'theme': 'reason',
};

// sRGB (0-255) to CIE Lab (D65), then deltaE 2000 (Sharma, Wu, Dalal 2005), kl = kc = kh = 1.
function lab([r, g, b]) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047, Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B, Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
function deltaE2000(c1, c2) {
  const [L1, a1, b1] = lab(c1), [L2, a2, b2] = lab(c2), rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2, Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const hp = (b, a) => (b === 0 && a === 0 ? 0 : ((Math.atan2(b, a) * deg) + 360) % 360);
  const h1 = hp(b1, ap1), h2 = hp(b2, ap2);
  let dh = h2 - h1; if (Cp1 * Cp2 === 0) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  const dL = L2 - L1, dC = Cp2 - Cp1, dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dh / 2 * rad);
  const Lb = (L1 + L2) / 2, Cpb = (Cp1 + Cp2) / 2;
  let hb = h1 + h2; if (Cp1 * Cp2 === 0) hb = h1 + h2; else if (Math.abs(h1 - h2) <= 180) hb /= 2; else hb = (hb + (hb < 360 ? 360 : -360)) / 2;
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const Sl = 1 + 0.015 * (Lb - 50) ** 2 / Math.sqrt(20 + (Lb - 50) ** 2), Sc = 1 + 0.045 * Cpb, Sh = 1 + 0.015 * Cpb * T;
  const Rt = -2 * Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

const READ = `(() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  const out = {};
  for (const s of ${JSON.stringify(SURFACES)}) {
    const p = document.createElement('div'); p.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;background-color:var(--mf-surface-' + s + ')';
    document.body.appendChild(p);
    const c = getComputedStyle(p).backgroundColor; p.remove();
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
    out[s] = [...cx.getImageData(0, 0, 1, 1).data].slice(0, 3);
  }
  return out;
})()`;

async function main() {
  const themes = fs.readdirSync(path.join(root, 'public', 'design-system', 'themes')).filter((f) => f.endsWith('.css')).map((f) => f.slice(0, -4)).sort();
  for (const c of CORE) if (!themes.includes(c)) { say(`FAIL the core theme ${c} is not in public/design-system/themes/`); process.exit(1); }
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); process.exit(process.env.CI ? 1 : 0); }
  const started = Date.now();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'surface-steps-'));
  let server = null; let browser = null; const rows = [];
  try {
    server = await startServer(dataDir, await freePort(), 'first');
    browser = await launch(bin);
    for (const theme of themes) for (const mode of ['dark', 'light']) {
      const tab = new Tab(browser.cdp, {});
      await tab.open(1280, mode);
      try {
        await browser.cdp.send('Page.navigate', { url: `${server.base}/design-system/prototype.html?theme=${theme}&mode=${mode}&w=1280` }, tab.sid);
        let got = null;
        for (let i = 0; i < 60 && !got; i += 1) {
          await sleep(200);
          // ready when the page is complete, the mode and theme are set and the theme's stylesheet has loaded
          const ready = await tab.eval(`document.readyState === 'complete' && document.documentElement.dataset.themeMode === '${mode}' && document.documentElement.dataset.ppTheme === '${theme}' && !!document.getElementById('pp-theme-css').sheet`);
          if (ready) got = await tab.eval(READ);
        }
        if (!got) { say(`FAIL ${theme} ${mode}: the Prototype page did not load`); process.exitCode = 1; return; }
        rows.push({ theme, mode, c: got });
      } finally { await tab.close(); }
    }
  } finally {
    if (browser) { try { browser.child.kill(); } catch {} try { fs.rmSync(browser.dir, { recursive: true, force: true }); } catch {} }
    if (server) await stopServer(server);
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }

  const fails = []; const known = new Set(); const smallest = {};
  for (const { theme, mode, c } of rows) {
    const key = `${theme} ${mode}`; smallest[key] = Infinity;
    for (const [a, b] of PAIRS) {
      const d = deltaE2000(c[a], c[b]); smallest[key] = Math.min(smallest[key], d);
      const low = d < MIN_STEP;
      const tolerated = low && KNOWN[theme] && !CORE.includes(theme);
      if (TABLE) say(`${key.padEnd(24)} ${(a + ' vs ' + b).padEnd(20)} dE ${d.toFixed(2).padStart(6)} ${low ? (tolerated ? 'known' : 'LOW') : ''}`);
      if (!low) continue;
      if (tolerated) known.add(theme);
      else fails.push(`${theme} ${mode}: ${a} vs ${b} differ by deltaE ${d.toFixed(2)}, under the minimum ${MIN_STEP} (${a} rgb(${c[a]}), ${b} rgb(${c[b]}))`);
    }
    const eq = deltaE2000(c.title, c.status);
    if (TABLE) say(`${key.padEnd(24)} ${'title = status'.padEnd(20)} dE ${eq.toFixed(2).padStart(6)}`);
    if (eq !== 0) fails.push(`${theme} ${mode}: the status bar is not the title bar's tone (deltaE ${eq.toFixed(2)}); they are one tone by design`);
  }
  for (const [k, v] of Object.entries(smallest)) say(`smallest step ${k.padEnd(24)} dE ${v.toFixed(2)}`);
  for (const t of Object.keys(KNOWN)) if (!themes.includes(t) || CORE.includes(t)) fails.push(`the known list names ${t}, which is not a non-core theme in public/design-system/themes/`);
  say(`${rows.length} theme/mode views, minimum step ${MIN_STEP}; ${known.size} theme(s) on the known list${known.size ? ': ' + [...known].map((t) => `${t} (${KNOWN[t]})`).join('; ') : ''}; ${Math.round((Date.now() - started) / 1000)} s`);
  if (fails.length) { for (const f of fails) say('FAIL ' + f); process.exitCode = 1; return; }
  say('OK');
}
main().catch((e) => { console.error('check-surface-steps:', e.stack || e.message); process.exit(1); });
