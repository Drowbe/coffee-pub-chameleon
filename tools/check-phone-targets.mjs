// check-phone-targets.mjs: what a thumb meets on a phone, measured in the running product (headless Chromium, the screenshot seed,
// a 375 px wide window, a touch screen). On a phone (640 px and narrower) the controls below must be at least 44 CSS px tall (and 44 wide where noted),
// by their box or by an enlarged hit area (a transparent ::after), and the brand link in the top bar must not be clipped by the
// left edge of the window. The 11-12 px text, the layout and the navigation are not judged here.
// Usage: node tools/check-phone-targets.mjs. With no Chromium it says SKIPPED and exits 0 (a skip, never a pass).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

const say = (...a) => console.log('check-phone-targets:', ...a);
const WIDTH = 375;
const MIN = 44;
const failures = [];

// In the page: for each selector, every drawn match (in the document and its same-origin frames) with the largest of its box and its
// ::after, and the box's left and right edge in the top window.
const MEASURE = (specs) => `(() => {
  const specs = ${JSON.stringify(specs)};
  const out = {};
  const px = (v) => (parseFloat(v) || 0);
  const scan = (root, off) => {
    const doc = root.ownerDocument || root; const win = doc.defaultView;
    for (const [sel] of specs) {
      for (const e of root.querySelectorAll(sel)) {
        if (!e.getClientRects().length || win.getComputedStyle(e).visibility === 'hidden') continue;
        const b = e.getBoundingClientRect();
        if (!b.width && !b.height) continue;
        const a = win.getComputedStyle(e, '::after');
        const hit = a.content !== 'none' && a.position === 'absolute' ? { w: px(a.width), h: px(a.height) } : { w: 0, h: 0 };
        (out[sel] = out[sel] || []).push({ w: Math.max(b.width, hit.w), h: Math.max(b.height, hit.h), left: b.left + off.x, right: b.right + off.x, text: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24) });
      }
    }
    for (const e of root.querySelectorAll('*')) {
      if (e.shadowRoot) scan(e.shadowRoot, off);
      if (e.tagName === 'IFRAME') {
        try { if (e.contentDocument) { const r = e.getBoundingClientRect(); scan(e.contentDocument, { x: off.x + r.left, y: off.y + r.top }); } } catch { /* another origin */ }
      }
    }
  };
  scan(document, { x: 0, y: 0 });
  return { out, vw: innerWidth }; })()`;

const BAR = [['#notifications-bell', 'h', 'w'], ['#nav-toggle', 'h', 'w']];
const SCREENS = [
  { id: 'Home', as: 'mia', url: '/', wait: '.space-choice', specs: [...BAR, ['.mini-head button', 'h', 'w']] },
  { id: 'a space page', as: 'mia', url: '/#join={trip}', wait: 'button.sdk-strip-fact[data-module=budget]', space: true, specs: [...BAR, ['#phase-chip', 'h']] },
  { id: 'Set up', as: 'admin', url: '/#join={trip}', wait: 'button.sdk-strip-fact[data-module=budget]', space: true,
    steps: [{ click: '#nav-toggle' }, { click: '#setup' }, { wait: '.setup-tab' }, { sleep: 800 }],
    specs: [...BAR, ['.setup-tab', 'h'], ['#setup-save', 'h'], ['#setup-cancel-button', 'h'], ['#setup-bar-name', 'h']] },
  { id: 'Set up, Settings', as: 'admin', url: '/#join={trip}', wait: 'button.sdk-strip-fact[data-module=budget]', space: true,
    steps: [{ click: '#nav-toggle' }, { click: '#setup' }, { wait: '#setup-tab-modules' }, { click: '#setup-tab-modules' }, { sleep: 800 }],
    specs: [['input.sdk-switch', 'h', 'w']] },
  { id: 'Set up, Members', as: 'admin', url: '/#join={trip}', wait: 'button.sdk-strip-fact[data-module=budget]', space: true,
    steps: [{ click: '#nav-toggle' }, { click: '#setup' }, { wait: '#setup-tab-members' }, { click: '#setup-tab-members' }, { sleep: 800 }],
    specs: [['#setup-content-members button.btn', 'h']] },
  { id: 'Planner', as: 'mia', url: '/modules/travel?space={trip}', wait: '#module-frame >>> .day-add', specs: [...BAR, ['.jointadd', 'h', 'w'], ['.day-add', 'h'], ['.mf-switch-btn', 'h', 'w']] },
  { id: 'Manage, General', as: 'admin', url: '/admin#general', wait: '#tab-environment:not([hidden])', specs: [...BAR, ['.subtab', 'h'], ['.slot-paste', 'h', 'w']] },
  { id: 'Manage, Modules', as: 'admin', url: '/admin#modules', wait: '#tab-modules:not([hidden])', specs: [...BAR, ['.subtab', 'h']] },
];

async function measure(browser, S, screen) {
  const tab = new Tab(browser.cdp, S.ctx);
  await tab.open(WIDTH, 'light', screen.space === true);
  const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
  const send = (m, p) => tab.cdp.send(m, p, tab.sid);
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 800, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  try {
    await driveScreen(tab, screen, S.base, S.cookies, S.ctx);
    await sleep(800);
    const got = await tab.eval(MEASURE(screen.specs));
    const brand = await tab.eval(`(() => { const a = document.getElementById('brand-home-link'); if (!a) return null; const r = a.getBoundingClientRect(); return { left: r.left, right: r.right, vw: innerWidth }; })()`);
    return { ...got, brand };
  } finally { await tab.close(); }
}

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-targets-'));
  let server = null; let browser = null; let measured = 0; let brands = 0;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    browser = await launch(bin);
    for (const screen of SCREENS) {
      let got;
      try { got = await measure(browser, S, screen); } catch (e) { failures.push(`${screen.id}: could not be opened (${String(e.message || e).slice(0, 120)})`); continue; }
      for (const [sel, ...dims] of screen.specs) {
        const list = got.out[sel] || [];
        if (!list.length) { failures.push(`${screen.id}: nothing matched ${sel}, so nothing was measured`); continue; }
        for (const m of list) {
          measured++;
          if (dims.includes('h') && m.h < MIN - 0.5) failures.push(`${screen.id}: ${sel} "${m.text}" is ${Math.round(m.h)}px tall at ${WIDTH} (44 is the least)`);
          if (dims.includes('w') && m.w < MIN - 0.5) failures.push(`${screen.id}: ${sel} "${m.text}" is ${Math.round(m.w)}px wide at ${WIDTH} (44 is the least)`);
        }
      }
      if (got.brand) {
        brands++;
        if (got.brand.left < -0.5 || got.brand.right > got.brand.vw + 0.5) failures.push(`${screen.id}: #brand-home-link is clipped by the window (left ${Math.round(got.brand.left)}, right ${Math.round(got.brand.right)} of ${got.brand.vw})`);
      }
    }
    say(`${measured} controls measured, ${brands} brand links, on ${SCREENS.length} screens at ${WIDTH} px wide`);
    if (!brands) failures.push('no #brand-home-link was found on any screen');
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
