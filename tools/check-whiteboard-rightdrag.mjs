#!/usr/bin/env node
/*
 * check-whiteboard-rightdrag.mjs -- the Whiteboard's right mouse button (modules/whiteboard/src/whiteboard.js: pointerdown,
 * pointermove, the release, contextmenu), in a real browser against a throwaway server (tools/shots.mjs; no LiveKit).
 * Guards: a right-drag moves the board and opens no menu; a right-click opens it; the menu a browser asks for just after a
 * drag is not shown, and nothing else is swallowed: not a real right-click right after a drag, not the menu key, not a
 * menu asked for after the wait, whether the browser asks for the menu on the press (Mac, Linux), after the release
 * (Windows) or not at all, the drag let go outside the board, or cancelled. A table of event orders, sent as synthetic
 * pointer and contextmenu events on the board, then two rows with the real mouse.
 * With no Chromium it says SKIPPED (set CHROME_PATH); that is not a pass.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { startServer, stopServer, freePort, findBrowser, launch, Tab, sleep } = await import('./shots.mjs');
const { PASSWORD } = await import('./shots-seed.mjs');

const bin = findBrowser();
if (!bin) {
  console.log('check-whiteboard-rightdrag: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.');
  process.exit(0);
}

// D press, M move 40 px, U release, O release outside the board (the board holds the pointer), X pointercancel, C the
// menu asked for with the right button, K the menu key (no button), W wait 600 ms. [name, events, menu shown, board moved]
const ROWS = [
  ['Mac/Linux: right-click', 'DCU', 1, false],
  ['Mac/Linux: right-drag', 'DCMU', 0, true],
  ['Windows: right-click', 'DUC', 1, false],
  ['Windows: right-drag', 'DMUC', 0, true],
  ['no menu asked after a drag, then the menu key at once', 'DMUK', 1, true],
  ['no menu asked after a drag, then a mouse menu 600 ms later with no press', 'DMUWC', 1, true],
  ['no menu asked after a drag, then a quick Windows right-click', 'DMUDUC', 1, true],
  ['no menu asked after a drag, then a quick Mac right-click', 'DMUDCU', 1, true],
  ['Windows drag let go outside the board (its menu goes elsewhere), then a quick right-click', 'DMODUC', 1, true],
  ['Mac drag let go outside the board, then a quick right-click', 'DCMODCU', 1, true],
  ['Windows: a quick right-click right after a right-drag', 'DMUCDUC', 1, true],
  ['Mac/Linux: a quick right-click right after a right-drag', 'DCMUDCU', 1, true],
  ['Windows: the menu key right after a right-drag', 'DMUCK', 1, true],
  ['Windows: a second mouse menu after the drag\'s own, with no press', 'DMUCC', 1, true],
  ['a right-drag the browser cancels', 'DMX', 0, true],
  ['a right-drag cancelled, then the menu key', 'DMXK', 1, true],
  ['a right press cancelled before it moved (Mac order)', 'DCX', 0, false],
  ['the menu key alone', 'K', 1, false],
];

let failed = 0;
let passed = 0;
const check = (ok, what) => { if (ok) passed += 1; else { failed += 1; console.error(`FAIL ${what}`); } };
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-whiteboard-rightdrag-'));
let server;
let browser;
let tab;
try {
  const port = await freePort();
  server = await startServer(dataDir, port, 'first');
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(server.base + url, { method, headers: { 'content-type': 'application/json', accept: 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.getSetCookie();
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    let json = null; try { json = await r.json(); } catch { /* none */ }
    if (r.status >= 300) throw new Error(`${method} ${url}: ${r.status} ${JSON.stringify(json)}`);
    return json;
  };
  await call('POST', '/api/login', { login: 'admin', password: PASSWORD });
  await call('POST', '/api/modules/bundled/whiteboard/install');
  await call('PATCH', '/api/modules/whiteboard', { enabled: true });
  const space = (await call('POST', '/api/spaces', { name: 'Right drag' })).space.id;
  const note = { id: 'n1', type: 'note', x: 0, y: 0, z: 1, w: 180, h: 160, text: 'One', fill: 'gold', stroke: 'auto', ink: 'ink', weight: 1, by: 'x', at: new Date().toISOString() };
  await call('PUT', `/api/modules/whiteboard/data/${encodeURIComponent('block:main:n1')}?scope=space&space=${space}`, { value: note });

  browser = await launch(bin);
  tab = new Tab(browser.cdp, {});
  await tab.open(1200, 'light');
  for (const kv of cookie.split('; ')) { const i = kv.indexOf('='); await tab.cdp.send('Network.setCookie', { name: kv.slice(0, i), value: kv.slice(i + 1), url: server.base, httpOnly: true }, tab.sid); }
  await tab.cdp.send('Page.navigate', { url: `${server.base}/modules/whiteboard?space=${space}&popout=1` }, tab.sid);
  await tab.waitFor('#module-frame >>> .wb-block[data-id="n1"]');
  await sleep(800);
  await tab.eval(`(() => { window.__wbErrors = []; window.addEventListener('error', (e) => window.__wbErrors.push(e.message)); return true; })()`);
  const BOARD = `__q('#module-frame >>> #board')`;
  const spot = await tab.eval(`(() => { const r = ${BOARD}.getBoundingClientRect(); return { x: r.x + 80, y: r.y + r.height - 80 }; })()`);
  const menus = () => tab.eval(`__all('#module-frame >>> [role=menu]').concat(__all('[role=menu]')).filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').length`);
  const noteAt = () => tab.eval(`(() => { const r = __q('#module-frame >>> .wb-block[data-id="n1"]').getBoundingClientRect(); return { x: r.x, y: r.y }; })()`);
  const escape = async () => { await tab.key('Escape'); await sleep(650); }; // past any wait left from the row before

  for (const [name, seq, want, pans] of ROWS) {
    await escape();
    const a = await noteAt();
    await tab.eval(`(async () => {
      const el = ${BOARD};
      const x0 = ${spot.x}; const y0 = ${spot.y};
      let x = x0; let y = y0;
      const pe = (type, extra) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, ...extra }));
      for (const s of ${JSON.stringify(seq)}) {
        if (s === 'D') pe('pointerdown', { button: 2, buttons: 2 });
        else if (s === 'M') { for (let i = 0; i < 4; i += 1) { x += 10; y -= 5; pe('pointermove', { button: -1, buttons: 2 }); } }
        else if (s === 'U') pe('pointerup', { button: 2, buttons: 0 });
        else if (s === 'O') { x = -40; y = -40; pe('pointerup', { button: 2, buttons: 0 }); }
        else if (s === 'X') pe('pointercancel', { button: -1, buttons: 0 });
        else if (s === 'C') el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, button: 2, clientX: Math.max(x, 1), clientY: Math.max(y, 1) }));
        else if (s === 'K') el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, button: 0, clientX: x0, clientY: y0 }));
        else if (s === 'W') await new Promise((r) => { setTimeout(r, 600); });
      }
      return true;
    })()`);
    await sleep(250);
    const got = await menus();
    const c = await noteAt();
    const moved = Math.abs(c.x - a.x) > 1 || Math.abs(c.y - a.y) > 1;
    check(got === want && moved === pans, `${name} [${seq}]: want ${want ? 'the menu' : 'no menu'}${pans ? ' and the board moved' : ''}; got ${got} menu(s), ${moved ? 'moved' : 'not moved'}`);
  }

  // The real mouse (Chromium on Linux asks for the menu on the press).
  await escape();
  const a = await noteAt();
  const m = (type, x, y, extra = {}) => tab.mouse(type, x, y, { button: 'right', clickCount: 1, ...extra });
  await m('mouseMoved', spot.x, spot.y, { button: 'none', clickCount: 0 });
  await m('mousePressed', spot.x, spot.y);
  for (let i = 1; i <= 8; i += 1) await m('mouseMoved', spot.x + i * 7.5, spot.y - i * 4, { buttons: 2 });
  await m('mouseReleased', spot.x + 60, spot.y - 32);
  await sleep(250);
  const c = await noteAt();
  check((await menus()) === 0 && Math.abs(c.x - a.x - 60) < 2, `real mouse: a right-drag moves the board 60 px and opens no menu (got ${await menus()} menu(s), moved ${c.x - a.x})`);
  await m('mousePressed', spot.x, spot.y);
  await m('mouseReleased', spot.x, spot.y);
  await sleep(250);
  check((await menus()) === 1, 'real mouse: a right-click right after the drag opens the menu');
  const errors = await tab.eval('window.__wbErrors');
  check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
} catch (err) {
  failed += 1;
  console.error(`FAIL ${err.stack || err}`);
} finally {
  if (tab) await tab.close().catch(() => {});
  if (browser) { try { browser.child.kill(); } catch { /* gone */ } }
  if (server) await stopServer(server);
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
if (failed) {
  console.error(`check-whiteboard-rightdrag: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`check-whiteboard-rightdrag: OK, ${passed} cases`);
