#!/usr/bin/env node
/*
 * check-whiteboard-live.mjs -- the Whiteboard page (modules/whiteboard/src/whiteboard.js) in a real browser against a
 * throwaway server (tools/shots.mjs; no LiveKit), for what the lib checks cannot reach:
 *   - a paste of words copied elsewhere, after blocks were copied here (the mark on the computer's clipboard), puts
 *     nothing down; a paste that carries the mark puts the copied blocks down;
 *   - three pictures dropped at once: each spends one counted upload call (no inspect), and they are one undo step (one
 *     Ctrl Z takes all three away, one Ctrl Shift Z brings all three back, on the board and on the server);
 *   - an undo of a line this person moved, stretched by someone else since: the line stays as they left it, the page's
 *     own linkedOf and the words the person is told ("Left a block as it is: someone else changed it since.").
 * Clipboard and drop events are sent as synthetic events (a headless browser has no computer clipboard to paste from).
 * With no Chromium it says SKIPPED (set CHROME_PATH); that is not a pass.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { startServer, stopServer, freePort, findBrowser, launch, Tab, sleep } = await import('../../../tools/shots.mjs');
const { PASSWORD } = await import('../../../tools/shots-seed.mjs');

const bin = findBrowser();
if (!bin) {
  console.log('check-whiteboard-live: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.');
  process.exit(0);
}

let failed = 0;
let passed = 0;
const check = (ok, what) => { if (ok) passed += 1; else { failed += 1; console.error(`FAIL ${what}`); } };
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-whiteboard-live-'));
let server;
let browser;
const tabs = [];
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
  browser = await launch(bin);

  // A space with these blocks, opened in a tab of its own; the page's upload calls are counted.
  const at = () => new Date().toISOString();
  const keyUrl = (space, id) => `/api/modules/whiteboard/data/${encodeURIComponent(`block:main:${id}`)}?scope=space&space=${space}`;
  async function board(name, blocks) {
    const space = (await call('POST', '/api/spaces', { name })).space.id;
    for (const b of blocks) await call('PUT', keyUrl(space, b.id), { value: { ...b, by: 'someone', at: at() } });
    const tab = new Tab(browser.cdp, {});
    tabs.push(tab);
    await tab.open(1200, 'light');
    await tab.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__uploads = []; window.__wbErrors = []; window.addEventListener('error', (e) => window.__wbErrors.push(e.message)); { const f = window.fetch; window.fetch = function (input, init) { const u = String((input && input.url) || input); if (/\\/uploads/.test(u)) window.__uploads.push(String((init && init.method) || 'GET').toUpperCase() + ' ' + u.replace(/^https?:\\/\\/[^/]+/, '').replace(/\\?.*$/, '')); return f.apply(this, arguments); }; }` }, tab.sid);
    for (const kv of cookie.split('; ')) { const i = kv.indexOf('='); await tab.cdp.send('Network.setCookie', { name: kv.slice(0, i), value: kv.slice(i + 1), url: server.base, httpOnly: true }, tab.sid); }
    await tab.cdp.send('Page.navigate', { url: `${server.base}/modules/whiteboard?space=${space}&popout=1` }, tab.sid);
    await tab.waitFor('#module-frame >>> #board');
    await sleep(1000);
    return { space, tab };
  }
  const BOARD = `__q('#module-frame >>> #board')`;
  const count = (tab, sel = '.wb-block') => tab.eval(`__all('#module-frame >>> ${sel}').length`);
  const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(150); } return false; };
  const press = async (tab, key, code, modifiers = 0) => {
    const vk = key.toUpperCase().charCodeAt(0);
    await tab.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, windowsVirtualKeyCode: vk }, tab.sid);
    await tab.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode: vk }, tab.sid);
  };
  const CTRL = 2;
  const SHIFT = 8;
  const stored = async (space) => ((await call('GET', `/api/modules/whiteboard/data?scope=space&space=${space}&prefix=block:`)).items || []);

  // ---- a paste of words copied elsewhere ----
  {
    const note = { id: 'n1', type: 'note', x: 0, y: 0, z: 1, w: 180, h: 160, text: 'One', fill: 'gold', stroke: 'auto', ink: 'ink', weight: 1 };
    const { tab } = await board('Paste', [note]);
    await tab.click('#module-frame >>> .wb-block[data-id="n1"]');
    await sleep(300);
    const marked = await tab.eval(`(() => { const dt = new DataTransfer(); ${BOARD}.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true, composed: true })); return [...dt.types]; })()`);
    check(marked.includes('application/x-coffee-whiteboard-blocks'), `a copy puts the mark on the computer's clipboard (got ${JSON.stringify(marked)})`);
    const before = await count(tab);
    await tab.eval(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'words from elsewhere'); ${BOARD}.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true })); return true; })()`);
    await sleep(600);
    check((await count(tab)) === before, `a paste of words copied elsewhere puts nothing on the board (blocks ${before} -> ${await count(tab)})`);
    await tab.eval(`(() => { const dt = new DataTransfer(); dt.setData('application/x-coffee-whiteboard-blocks', '1'); ${BOARD}.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true })); return true; })()`);
    check(await until(async () => (await count(tab)) === before + 1, 3000), `a paste with the mark puts the copied block down (blocks ${before} -> ${await count(tab)})`);
  }

  // ---- three pictures at once: one counted upload each, one undo step ----
  {
    const { space, tab } = await board('Pictures', []);
    await tab.eval(`(async () => {
      const files = [];
      for (const [i, colour] of ['#c33', '#3c3', '#33c'].entries()) {
        const c = document.createElement('canvas'); c.width = 120 + i * 10; c.height = 80;
        const g = c.getContext('2d'); g.fillStyle = colour; g.fillRect(0, 0, c.width, c.height);
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        files.push(new File([blob], 'picture-' + i + '.png', { type: 'image/png' }));
      }
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      const el = ${BOARD}; const r = el.getBoundingClientRect();
      const opts = { dataTransfer: dt, bubbles: true, cancelable: true, composed: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
      el.dispatchEvent(new DragEvent('dragenter', opts)); el.dispatchEvent(new DragEvent('dragover', opts)); el.dispatchEvent(new DragEvent('drop', opts));
      return true;
    })()`);
    const all = await until(async () => (await count(tab, '.wb-block[data-type="image"]')) === 3 || (await count(tab)) === 3, 30000);
    await sleep(800);
    check(all, `three dropped pictures are on the board (got ${await count(tab)})`);
    const calls = await tab.eval('window.__uploads');
    const puts = calls.filter((c) => /^POST .*\/uploads$/.test(c)).length;
    const inspects = calls.filter((c) => /\/uploads\/inspect$/.test(c)).length;
    check(puts === 3 && inspects === 0, `each picture spends one counted upload call: 3 sent, none inspected (got ${puts} sent, ${inspects} inspected: ${JSON.stringify(calls)})`);
    const images = async () => (await stored(space)).filter((i) => i.value && i.value.type === 'image').length;
    check(await until(async () => (await images()) === 3, 5000), 'the three picture blocks are saved');
    await tab.eval(`${BOARD}.focus()`);
    await press(tab, 'z', 'KeyZ', CTRL);
    check(await until(async () => (await count(tab)) === 0, 3000), `one Ctrl Z takes all three pictures away (left ${await count(tab)})`);
    check(await until(async () => (await images()) === 0, 5000), 'and off the server');
    await press(tab, 'z', 'KeyZ', CTRL | SHIFT);
    check(await until(async () => (await count(tab)) === 3, 3000), `one Ctrl Shift Z brings all three back (got ${await count(tab)})`);
    check(await until(async () => (await images()) === 3, 5000), 'and on the server');
  }

  // ---- an undo of a line moved here and stretched by someone else since ----
  {
    const line = { id: 'l1', type: 'line', x: 100, y: 200, z: 1, dx: 300, dy: 0, stroke: 'ink', weight: 4 };
    const { space, tab } = await board('Linked', [line]);
    await tab.click('#module-frame >>> .wb-block[data-id="l1"]');
    await sleep(300);
    await press(tab, 'ArrowRight', 'ArrowRight');
    const saved = await until(async () => { const i = (await stored(space)).find((x) => x.key === 'block:main:l1'); return i && i.value.x === 110; }, 5000);
    check(saved, 'the line is moved and saved here');
    const now = (await stored(space)).find((x) => x.key === 'block:main:l1').value;
    await call('PUT', keyUrl(space, 'l1'), { value: { ...now, dx: 380, by: 'someone', at: at() } }); // someone else stretches it
    const heard = await until(async () => tab.eval(`(() => { const el = __q('#module-frame >>> .wb-block[data-id="l1"]'); return el ? el.getBoundingClientRect().width : 0; })()`).then((w) => w > 330), 5000);
    check(heard, 'the page shows the line stretched by someone else');
    await tab.eval(`${BOARD}.focus()`);
    await press(tab, 'z', 'KeyZ', CTRL);
    const told = await until(async () => tab.eval(`document.body.innerText.includes('Left a block as it is: someone else changed it since.')`), 3000);
    check(told, 'the person is told "Left a block as it is: someone else changed it since."');
    await sleep(800);
    const after = (await stored(space)).find((x) => x.key === 'block:main:l1').value;
    check(after.x === 110 && after.dx === 380, `the line stays as the other person left it (got x ${after.x}, dx ${after.dx})`);
  }
  for (const t of tabs) { const errors = await t.eval('window.__wbErrors'); check(errors.length === 0, `no page errors (${errors.join(' | ')})`); }
} catch (err) {
  failed += 1;
  console.error(`FAIL ${err.stack || err}`);
} finally {
  for (const t of tabs) await t.close().catch(() => {});
  if (browser) { try { browser.child.kill(); } catch { /* gone */ } }
  if (server) await stopServer(server);
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
if (failed) {
  console.error(`check-whiteboard-live: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`check-whiteboard-live: OK, ${passed} cases`);
