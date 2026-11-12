#!/usr/bin/env node
/*
 * check-title-select.mjs -- the module title bar's select, as the FRAME draws it (public/module-frame.js drawTitleSelect), in real
 * Chromium over the DevTools protocol: the real module-chrome.js cleaning feeds the real frame, the host's menu (host-menu.js)
 * opens under the button, and a pick reaches the frame's action handler (module-host.js turns it into the module's 'header'
 * event { id, value }; that mapping is asserted in check-module-chrome.mjs). This fails when, at 1280 and at 390 px:
 *   - the menu is not directly under the button (its top is not within 12 px of the button's bottom);
 *   - a pick does not arrive as { id: <select id>, value: <picked item id> }, or the button itself sends an event;
 *   - hostile labels (<img onerror>, a script tag, control characters, huge strings) are not drawn as inert text;
 *   - Escape or a pick does not close the menu, give focus back to the button and set aria-expanded back to false;
 *   - ArrowDown on the button does not open the menu, or Enter on it does not;
 *   - a category's child cannot be picked (a flyout at 1280, a drill-in with Back at 390).
 * Skipped, and said so, when there is no Chromium (set CHROME_PATH). A skip is not a pass.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser, launch, Tab, sleep } from './shots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
let passed = 0;
const ok = (c, m) => { if (c) passed += 1; else failures.push(m); };
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/sdk/system.css"></head><body><div id="mount" style="height:500px"></div></body></html>';

const bin = findBrowser();
let note = '';
if (!bin) note = ' (browser part SKIPPED: no Chromium found; set CHROME_PATH. This is not a pass)';
else {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/t.html') { res.setHeader('content-type', 'text/html'); res.end(PAGE); return; }
    const root = path.join(ROOT, 'public');
    const file = path.join(root, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end(); return; }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { cdp, child, dir } = await launch(bin);
  try {
    for (const width of [1280, 390]) {
      const tab = new Tab(cdp, {});
      await tab.open(width, 'light');
      await cdp.send('Page.navigate', { url: `${base}/t.html` }, tab.sid);
      for (let i = 0; i < 100 && !(await tab.eval("document.readyState === 'complete'").catch(() => false)); i += 1) await sleep(100);
      const hostile = '<img src=x onerror="window.__pwn=1"> ' + 'W'.repeat(200);
      await tab.eval(`(async () => {
        const [{ createModuleFrame }, { cleanHeaderItems, titlebarActions }] = await Promise.all([import('/module-frame.js'), import('/module-chrome.js')]);
        window.__ev = [];
        const header = cleanHeaderItems([{ kind: 'select', id: 'sel', label: 'Board 1', title: 'Boards', items: [
          { id: 'one', label: 'Board 1', current: true }, { id: 'two', label: 'Board 2' }, { id: 'evil', label: ${JSON.stringify(hostile)} },
          { id: 'ctl', label: 'A\\u0007B\\u0000C' }, { divider: true },
          { id: 'manage', label: 'Manage boards…', items: [{ id: 'new', label: 'New board' }, { id: 'off', label: 'Delete board', disabled: true }] }] }]);
        const f = createModuleFrame({ title: 'Whiteboard', titlebar: { actions: titlebarActions(header, []) }, onAction: (e) => window.__ev.push({ id: e.id, value: e.value }) });
        document.getElementById('mount').append(f.el);
        await document.fonts.ready;
        return true;
      })()`);
      await sleep(300);
      const btnSel = '.mf-titlebar-select-btn';
      const state = () => tab.eval(`(() => { const b = document.querySelector('${btnSel}'); const m = document.querySelector('.host-menu'); const br = b.getBoundingClientRect(); const mr = m ? m.getBoundingClientRect() : null; return { expanded: b.getAttribute('aria-expanded'), open: Boolean(m), focusOnButton: document.activeElement === b, gap: mr ? Math.round((mr.top - br.bottom) * 10) / 10 : null, ev: window.__ev, pwn: window.__pwn || 0, imgs: m ? m.querySelectorAll('img, script').length : 0, labels: m ? [...m.querySelectorAll('.host-menu-label')].map((x) => x.textContent) : [], count: document.querySelectorAll('.host-menu').length }; })()`);
      const L = String(width);

      let s = await state();
      ok(s.expanded === 'false' && !s.open, `${L}: the menu starts closed with aria-expanded false`);
      await tab.click(btnSel);
      await sleep(250);
      s = await state();
      ok(s.open && s.expanded === 'true', `${L}: a click opens the host menu and aria-expanded is true (${s.expanded})`);
      ok(s.gap !== null && s.gap >= 0 && s.gap <= 12, `${L}: the menu's top is ${s.gap}px under the button's bottom, wanted 0 to 12`);
      ok(s.ev.length === 0, `${L}: the button itself sent an event`);
      ok(s.imgs === 0 && s.pwn === 0, `${L}: a hostile label drew an element or ran code`);
      ok(s.labels.includes(hostile.replace(/\s+/g, ' ').slice(0, 60)) && s.labels.includes('A B C'), `${L}: hostile and control-character labels are text, cut to 60 and one line (${JSON.stringify(s.labels)})`);
      // Escape closes it, focus on the button, aria-expanded false, no event.
      await tab.key('Escape');
      await sleep(250);
      s = await state();
      ok(!s.open && s.focusOnButton && s.expanded === 'false' && s.ev.length === 0, `${L}: Escape closes, focus is on the button, aria-expanded false, no event (${JSON.stringify([s.open, s.focusOnButton, s.expanded, s.ev.length])})`);
      // ArrowDown on the button opens it.
      await tab.key('ArrowDown');
      await sleep(250);
      s = await state();
      ok(s.open && s.expanded === 'true', `${L}: ArrowDown on the button opens the menu`);
      await tab.key('Escape');
      await sleep(200);
      // Enter on the button opens it (a native button click).
      await tab.eval("document.querySelector('.mf-titlebar-select-btn').focus()");
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, tab.sid);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, tab.sid);
      await sleep(250);
      s = await state();
      ok(s.open && s.expanded === 'true', `${L}: Enter on the button opens the menu`);
      await tab.key('Escape');
      await sleep(200);
      // A pick: Board 2.
      await tab.click(btnSel);
      await sleep(250);
      await tab.click('.host-menu-item', 'Board 2');
      await sleep(300);
      s = await state();
      ok(JSON.stringify(s.ev) === JSON.stringify([{ id: 'sel', value: 'two' }]), `${L}: a pick arrives as { id: 'sel', value: 'two' } (${JSON.stringify(s.ev)})`);
      ok(!s.open && s.focusOnButton && s.expanded === 'false', `${L}: after a pick the menu is closed, focus on the button, aria-expanded false`);
      // A category's child: New board.
      await tab.eval('window.__ev.length = 0');
      await tab.click(btnSel);
      await sleep(250);
      await tab.click('.host-menu-item', 'Manage boards');
      await sleep(400);
      if (width === 390) {
        ok((await tab.eval("[...document.querySelectorAll('.host-menu-item')].some((x) => x.textContent.trim().startsWith('Back'))")), `${L}: a category drills in with Back first`);
      } else {
        ok((await tab.eval("document.querySelectorAll('.host-menu-flyout').length")) >= 1, `${L}: a category opens a flyout beside the row`);
      }
      const off = await tab.eval("(() => { const b = [...document.querySelectorAll('.host-menu-item')].find((x) => x.textContent.includes('Delete board')); return b ? (b.disabled || b.getAttribute('aria-disabled') === 'true') : null; })()");
      ok(off === true, `${L}: a disabled child is off`);
      await tab.click('.host-menu-item', 'New board');
      await sleep(300);
      s = await state();
      ok(JSON.stringify(s.ev) === JSON.stringify([{ id: 'sel', value: 'new' }]) && !s.open && s.count === 0 && s.focusOnButton, `${L}: a child's pick arrives as value 'new' and the menu closes with focus back on the button (${JSON.stringify(s.ev)})`);
      await tab.close();
    }
  } catch (err) {
    failures.push(`browser part: ${err.message}`);
  } finally {
    try { child.kill(); } catch { /* gone */ }
    server.close();
    await sleep(300);
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); } catch { /* still closing */ }
  }
}
if (failures.length) {
  console.error(`check-title-select: ${failures.length} problem(s):\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`check-title-select: ${passed} checks passed${note}.`);
process.exit(0);
