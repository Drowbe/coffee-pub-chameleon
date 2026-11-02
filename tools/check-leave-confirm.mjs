// check-leave-confirm.mjs: Leave asks first, only while on a call (Thomas, 2026-11-01). Measured in the running product:
// headless Chromium, the screenshot seed, the call's client library replaced by tools/shots-livekit-stub.mjs.
// On a call, Leave shows "Leave and end your call?" with Leave and Stay; Stay keeps the space and the call; Leave leaves.
// Off a call, Leave leaves at once, with no question. At 1280 Leave is the space switcher's last entry (it reaches the page
// as app:enter-space { action: 'leave' }); at 390 it is the tab bar's own button. SHOT_DIR=<dir> also saves the question's picture.
// Usage: node tools/check-leave-confirm.mjs. With no Chromium it says SKIPPED and exits 0 (a skip, never a pass).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

const say = (...a) => console.log('check-leave-confirm:', ...a);
const failures = [];
const IN_SPACE = `document.body.classList.contains('in-space')`;
const ASKING = `!!document.querySelector('dialog.sdk-dialog-confirm[open]')`;

async function until(tab, expr, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await tab.eval(expr).catch(() => false)) return true; await sleep(100); }
  return false;
}

async function run(browser, S, size, mode, onCall) {
  const name = `${size} ${mode}, ${onCall ? 'on a call' : 'off a call'}`;
  const tab = new Tab(browser.cdp, S.ctx);
  await tab.open(size, mode, true);
  const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
  const leave = async () => {
    if (size <= 640) await tab.click('#leave-space');
    else await tab.eval(`document.dispatchEvent(new CustomEvent('app:enter-space', { detail: { id: 'x', action: 'leave' }, cancelable: true })) && 0`);
  };
  try {
    await driveScreen(tab, { id: 'leave', as: 'mia', url: '/#join={trip}', wait: 'button.sdk-strip-fact[data-module=budget]', call: onCall, steps: onCall ? [{ click: '#join-call' }] : [] }, S.base, S.cookies, S.ctx);
    if (onCall) await until(tab, `document.querySelectorAll('#grid .tile').length >= 1`, 15000);
    if (!await tab.eval(IN_SPACE)) { failures.push(`${name}: not in the space to start with`); return; }
    await leave();
    if (!onCall) {
      if (await tab.eval(ASKING)) failures.push(`${name}: Leave asked a question off a call`);
      if (!await until(tab, `!(${IN_SPACE})`)) failures.push(`${name}: Leave did not leave at once`);
      return;
    }
    if (!await until(tab, ASKING)) { failures.push(`${name}: Leave did not ask`); return; }
    const text = await tab.eval(`document.querySelector('dialog.sdk-dialog-confirm').innerText`);
    if (!/Leave and end your call\?/.test(text) || !/Stay/.test(text) || !/Leave\b/.test(text.replace('Leave and end your call?', ''))) failures.push(`${name}: the question reads ${JSON.stringify(text)}`);
    if (process.env.SHOT_DIR) {
      await sleep(400);
      const shot = await tab.cdp.send('Page.captureScreenshot', { format: 'png' }, tab.sid);
      fs.mkdirSync(process.env.SHOT_DIR, { recursive: true });
      fs.writeFileSync(path.join(process.env.SHOT_DIR, `leave-confirm-${size}-${mode}.png`), Buffer.from(shot.data, 'base64'));
    }
    await tab.click('dialog.sdk-dialog-confirm button', 'Stay');
    await sleep(600);
    if (await tab.eval(ASKING)) failures.push(`${name}: Stay left the question open`);
    if (!await tab.eval(IN_SPACE)) failures.push(`${name}: Stay still left the space`);
    await leave();
    if (!await until(tab, ASKING)) { failures.push(`${name}: the second Leave did not ask`); return; }
    await tab.click('dialog.sdk-dialog-confirm button', 'Leave');
    if (!await until(tab, `!(${IN_SPACE})`)) failures.push(`${name}: confirming did not leave`);
  } finally { await tab.close(); }
  say(name, 'done');
}

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leave-confirm-data-'));
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    browser = await launch(bin);
    for (const [size, mode, onCall] of [[1280, 'light', true], [1280, 'dark', true], [390, 'light', true], [390, 'dark', true], [1280, 'light', false], [390, 'light', false]]) await run(browser, S, size, mode, onCall);
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
