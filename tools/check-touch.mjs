// check-touch.mjs: what a phone person meets when a field takes focus, measured in the running product (headless Chromium, the
// screenshot seed, touch emulation: Emulation.setTouchEmulationEnabled plus a mobile device override, so (pointer: coarse) answers).
//   1. iOS Safari zooms the page when a field with text under 16px takes focus. Every visible text field, text area and select on
//      the Workspace, Research, Maps, Polls, the home page's chat and an open editor window must compute to 16px or more,
//      at 390 and 360 wide and in landscape (844x390).
//   2. The host console (hosted: BASE_DOMAIN set) must not scroll sideways at 360 or 390: its Host tab holds long web addresses.
//      Booting a hosted server needs a host name that resolves to this machine, so that part reads the CSS rule instead
//      (the facts list wraps long values and its grid column may shrink).
// It cannot prove how a real iPhone behaves: only that the size the browser computes is 16px or more where the pointer is coarse.
// Usage: node tools/check-touch.mjs. With no Chromium it says SKIPPED and exits 0 (a skip, never a pass).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

const say = (...a) => console.log('check-touch:', ...a);
const failures = [];
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// In the page: every text field, text area and select that is drawn, in the document, its shadow roots and its same-origin frames.
const FIELDS = `(() => {
  const FIELD = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=button]):not([type=submit]),textarea,select';
  const out = { coarse: matchMedia('(pointer: coarse)').matches, n: 0, small: [] };
  const scan = (r) => {
    for (const e of r.querySelectorAll('*')) {
      if (e.shadowRoot) scan(e.shadowRoot);
      if (e.tagName === 'IFRAME') { try { if (e.contentDocument) scan(e.contentDocument); } catch { /* another origin */ } }
      if (!e.matches(FIELD)) continue;
      if (!e.getClientRects().length) continue;
      const win = e.ownerDocument.defaultView; const cs = win.getComputedStyle(e);
      if (cs.visibility === 'hidden') continue;
      out.n++;
      const px = parseFloat(cs.fontSize);
      if (px < 16) out.small.push((e.id ? '#' + e.id : '') + '.' + String(e.className).trim().split(/\\s+/).slice(0, 2).join('.') + ' <' + e.tagName.toLowerCase() + '> ' + (e.placeholder || e.getAttribute('aria-label') || '') + ' ' + px + 'px');
    }
  };
  scan(document);
  return out; })()`;

async function touchView(browser, S, w, h, screen, wait = 1500) {
  const tab = new Tab(browser.cdp, S.ctx);
  await tab.open(w, 'light', screen.call === true);
  const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
  const s = (m, p) => tab.cdp.send(m, p, tab.sid);
  await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  try { await driveScreen(tab, screen, S.base, S.cookies, S.ctx); await sleep(wait); return await tab.eval(FIELDS); } finally { await tab.close(); }
}

async function main() {
  // 2, static part: the host console's rule is in the page's own CSS.
  const hostCss = fs.readFileSync(path.join(root, 'public', 'host.html'), 'utf8') + fs.readdirSync(path.join(root, 'public')).filter((f) => /^host.*\.css$/.test(f)).map((f) => fs.readFileSync(path.join(root, 'public', f), 'utf8')).join('\n');
  if (!/#host-facts[^{]*\{[^}]*(overflow-wrap:\s*anywhere|word-break:\s*break-all)/.test(hostCss + fs.readFileSync(path.join(root, 'public', 'style.css'), 'utf8'))) failures.push('the host console facts list (#host-facts) has no rule that wraps a long value (overflow-wrap: anywhere), so a web address makes the page scroll sideways on a phone');
  const pop = fs.readFileSync(path.join(root, 'public', 'popout.html'), 'utf8');
  if (!/<meta name="viewport" content="width=device-width, initial-scale=1/.test(pop)) failures.push('public/popout.html has no meta viewport, so a phone draws it 980px wide');

  const bin = findBrowser();
  if (!bin) { say('SKIPPED the live part. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); for (const f of failures) say('FAIL', f); return failures.length ? 1 : 0; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'touch-data-'));
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    browser = await launch(bin);
    const mod = (id, wait, steps) => ({ id, as: 'mia', url: `/modules/${id}?space={trip}`, wait, steps });
    const W = { id: 'workspace', as: 'mia', url: '/#join={trip}', wait: 'button.sdk-strip-fact[data-module=budget]', call: true };
    const HOME = { id: 'home chat', as: 'mia', url: '/', wait: '.space-choice' };
    const RESEARCH = mod('research', '#module-frame >>> button');
    const POLLS = mod('polls', '#module-frame >>> .poll');
    const MAPS = mod('maps', '#module-frame >>> *');
    // Each screen at the sizes where it once failed (the run stays near 30 seconds).
    const runs = [[390, 844, [W, HOME, RESEARCH, MAPS]], [844, 390, [W, POLLS]], [360, 780, [MAPS]]];
    let total = 0; let views = 0;
    for (const [w, h, screens] of runs) {
      for (const screen of screens) {
        const got = await touchView(browser, S, w, h, screen, 1000);
        views++;
        if (!got || !got.coarse) { failures.push(`${screen.id} at ${w}x${h}: (pointer: coarse) did not answer, so nothing was measured`); continue; }
        total += got.n;
        for (const f of got.small) failures.push(`${screen.id} at ${w}x${h}: ${f}, under 16px (iOS zooms the page when it takes focus)`);
      }
    }
    say(`${total} fields measured in ${views} views (390x844, 844x390, 360x780) with a coarse pointer`);
    if (!total) failures.push('no field was found on any screen, so nothing was measured');
  } finally {
    try { if (browser) { browser.cdp.ws.close(); browser.child.kill(); fs.rmSync(browser.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } } catch { /* best effort */ }
    if (server) await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  if (failures.length) { for (const f of failures) say('FAIL', f); return 1; }
  say('ok');
  return 0;
}
process.exit(await main());
