#!/usr/bin/env node
/*
 * check-undo-page.mjs -- the page's half of Clear and its Undo, in a real browser against a throwaway seeded server
 * (tools/shots.mjs; no LiveKit, no network beyond localhost). See check-clear-undo.mjs for the server's half.
 *   - Undo note: Undo gets focus as the note shows; a failed Undo keeps the note open with the server's sentence and Undo ready
 *     again; two quick presses ask once; a good Undo says what came back and gives focus back.
 *   - Clear dialog: says the seconds the server gave for the module (for-space `undoSeconds`, else 30) and that Undo ends when
 *     the person leaves the page; a refused Clear (409, 429) shows the server's sentence inside the dialog.
 *   - A second session watching a To-do of 300 objects empties and draws back (one 'changes' event, one pass) in under 3 s each way.
 *   - Clear is offered once a module that was empty has data (for-space is read again after a change).
 *   - The Undo note does not cover the title bar's menu button.
 * With no Chromium it says SKIPPED (set CHROME_PATH); that is not a pass.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const { bootSeeded, stopServer, freePort, findBrowser, launch, Tab, sleep } = await import('./shots.mjs');

const bin = findBrowser();
if (!bin) {
  console.log('check-undo-page: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.');
  process.exit(0);
}

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};

const SECONDS = 8; // the server's undo time here (CLEAR_UNDO_SECONDS): short, so a case can wait a hold out
const WIDTH = Number(process.env.UNDO_PAGE_WIDTH) || 1280;
const MODE = process.env.UNDO_PAGE_MODE === 'light' ? 'light' : 'dark';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-undo-page-'));
let server;
let browser;
const tabs = [];
try {
  const port = await freePort();
  const boot = await bootSeeded('travel', dataDir, port, { env: { CLEAR_UNDO_SECONDS: String(SECONDS) } });
  server = boot.server;
  const { ctx, cookies } = boot;
  const T = ctx.trip;
  const jar = (as) => (cookies[as] || []).map((c) => `${c.name}=${c.value}`).join('; ');
  const call = async (method, url, body, as = 'admin') => {
    const r = await fetch(server.base + url, { method, headers: { 'content-type': 'application/json', accept: 'application/json', cookie: jar(as) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json };
  };
  const sp = `scope=space&space=${T}`;
  const forSpace = async (id) => (await call('GET', `/api/modules/for-space?space=${T}`)).json.modules.find((m) => m.id === id);
  browser = await launch(bin);
  const open = async (url, as = 'admin') => {
    const tab = new Tab(browser.cdp, ctx);
    await tab.open(WIDTH, MODE);
    tabs.push(tab);
    for (const c of cookies[as]) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: server.base, httpOnly: true }, tab.sid);
    await tab.cdp.send('Page.navigate', { url: server.base + url }, tab.sid);
    return tab;
  };

  // --- the Undo note, on any page that loads brand.js -------------------------------------------------------------
  const page = await open(`/modules/polls?space=${T}`);
  await page.waitFor('#module-frame');
  await sleep(800);
  const brand = (code) => page.eval(`(async () => { const b = { ...(await import('/brand.js')), ...(await import('/module-host.js')) }; ${code} })()`);

  await test('Undo note: focus moves to Undo, a failed Undo keeps the note open with the server\'s sentence, and Undo works again', async () => {
    await brand(`window.__calls = 0; window.__fail = true; document.body.insertAdjacentHTML('beforeend', '<button id="before" type="button">before</button>'); document.getElementById('before').focus();
      b.undoToast('Cleared Polls.', async () => { window.__calls += 1; if (window.__fail) throw Object.assign(new Error("Polls's storage is full, so nothing came back. Remove something and press Undo again."), {}); return 'Restored 3 objects.'; }, { until: Date.now() + 15000 }); return true;`);
    await page.waitFor('.sdk-toast [data-undo]');
    assert.equal(await page.eval(`document.activeElement && document.activeElement.hasAttribute('data-undo')`), true, 'focus is on Undo');
    await page.eval(`document.activeElement.click()`);
    await page.waitFor('.sdk-toast [data-undo-error]');
    const after = await page.eval(`(() => { const t = document.querySelector('.sdk-toast[data-undo]'); const u = t.querySelector('[data-undo]'); return { calls: window.__calls, open: t.dataset.state !== 'leaving', disabled: u.disabled, error: t.querySelector('[data-undo-error]').textContent, focus: document.activeElement === u }; })()`);
    assert.deepEqual([after.calls, after.open, after.disabled, after.focus], [1, true, false, true]);
    assert.match(after.error, /storage is full.*press Undo again/);
    await page.eval(`window.__fail = false`);
    // Two quick presses ask once.
    await page.eval(`(() => { const u = document.querySelector('.sdk-toast [data-undo]'); u.click(); u.click(); return true; })()`);
    await sleep(900);
    const done = await page.eval(`({ calls: window.__calls, notes: [...document.querySelectorAll('.sdk-toast-title')].map((e) => e.textContent), undoLeft: document.querySelectorAll('.sdk-toast[data-undo]:not([data-state="leaving"])').length, focus: document.activeElement && document.activeElement.id })`);
    assert.equal(done.calls, 2, 'one failed press, then one good press for two clicks');
    assert.ok(done.notes.includes('Restored 3 objects.'), JSON.stringify(done.notes));
    assert.equal(done.undoLeft, 0, 'the Undo note is gone');
    assert.equal(done.focus, 'before', 'focus is back where it was');
  });

  await test('Undo note: ends at its time even after a failure, and does not sit over the title bar of a module', async () => {
    await brand(`b.undoToast('Cleared Polls.', async () => { throw new Error('No.'); }, { until: Date.now() + 1500 }); return true;`);
    await page.waitFor('.sdk-toast [data-undo]');
    const place = await page.eval(`(() => { const t = document.querySelector('.sdk-toast[data-undo]').getBoundingClientRect(); const m = document.querySelector('.mf-titlebar'); const r = m ? m.getBoundingClientRect() : null; const more = document.querySelector('.mf-titlebar .mf-titlebar-menu'); const mr = more ? more.getBoundingClientRect() : null; const over = mr ? !(t.right <= mr.left || t.left >= mr.right || t.bottom <= mr.top || t.top >= mr.bottom) : false; return { toastTop: t.top, toastBottom: t.bottom, view: innerHeight, bar: r ? { top: r.top, bottom: r.bottom } : null, over, hasMore: Boolean(mr) }; })()`);
    if (place.bar) assert.ok(place.toastTop >= place.bar.bottom || place.toastBottom <= place.bar.top, `the note (${place.toastTop}-${place.toastBottom}) is clear of the title bar (${place.bar.top}-${place.bar.bottom})`);
    assert.equal(place.hasMore, true, 'the title bar has its More button');
    assert.equal(place.over, false, 'the note does not cover the More button');
    assert.ok(place.toastTop > place.view / 2, 'along the bottom edge');
    await sleep(2200);
    assert.equal(await page.eval(`document.querySelectorAll('.sdk-toast[data-undo]:not([data-state="leaving"])').length`), 0);
  });

  // --- the Clear dialog -----------------------------------------------------------------------------------------------
  await test('Clear dialog: the seconds are the server\'s for that module, and Undo ends when the person leaves the page', async () => {
    const want = (await forSpace('polls')).undoSeconds > 0 ? (await forSpace('polls')).undoSeconds : 30;
    await brand(`window.__asked = null; b.openClearMenu(document.getElementById('before'), async () => { window.__asked = 'cleared'; return null; }, { armed: true, name: 'Polls', undoSeconds: ${want} }); return true;`);
    await page.waitFor('dialog.sdk-dialog-confirm[open]');
    const said = await page.eval(`document.querySelector('dialog.sdk-dialog-confirm .sdk-dialog-body p').textContent`);
    assert.match(said, new RegExp(`You can undo it for ${want} seconds, until you leave this page\\.$`));
    await page.eval(`document.querySelector('dialog.sdk-dialog-confirm [data-close]').click()`);
  });

  await test('Clear dialog: a refusal (409, 429) is read inside the dialog, which stays open and can try again', async () => {
    await brand(`window.__n = 0; b.openClearMenu(document.getElementById('before'), async () => { window.__n += 1; throw Object.assign(new Error(window.__n === 1 ? 'Polls was just cleared; wait for the undo time to pass.' : 'Too many changes at once.'), { status: window.__n === 1 ? 409 : 429, serverSaid: true }); }, { armed: true, name: 'Polls', undoSeconds: 20 }); return true;`);
    await page.waitFor('dialog.sdk-dialog-confirm[open] input');
    await page.typeInto('dialog.sdk-dialog-confirm input', 'Polls');
    await page.click('dialog.sdk-dialog-confirm [data-ok]');
    await page.waitFor('dialog.sdk-dialog-confirm [data-error]');
    assert.equal(await page.eval(`document.querySelector('dialog.sdk-dialog-confirm [data-error]').textContent`), 'Polls was just cleared; wait for the undo time to pass.');
    await page.click('dialog.sdk-dialog-confirm [data-ok]');
    await sleep(400);
    assert.equal(await page.eval(`document.querySelector('dialog.sdk-dialog-confirm [data-error]').textContent`), 'Try again in a moment. Too many changes at once.');
    assert.equal(await page.eval(`document.querySelector('dialog.sdk-dialog-confirm').open`), true, 'the dialog stayed');
    await page.eval(`document.querySelector('dialog.sdk-dialog-confirm [data-close]').click()`);
  });

  // --- a second session watching a To-do of 300 -------------------------------------------------------------------------
  const COUNT = 300;
  await test(`a session watching a To-do of ${COUNT} objects empties and draws back in under 3 s each way`, async () => {
    const task = (i) => ({ id: `w${i}`, title: `Watch ${i}`, remind: false, done: false, doneAt: null, createdAt: 1, links: [], autoDone: false });
    for (let i = 0; i < COUNT; i += 1) assert.equal((await call('PUT', `/api/modules/todo/data/task:w${i}?${sp}`, { value: task(i) }, i % 2 ? 'sam' : 'admin')).status, 200);
    const watcher = await open(`/calendar?space=${T}`, 'mia');
    await watcher.waitFor('.dest-part-root');
    await sleep(1500);
    const rows = () => watcher.eval(`(() => { let n = 0; const walk = (r) => { n += [...r.querySelectorAll('[data-open]')].filter((b) => /Watch \\d/.test(b.textContent)).length; for (const e of r.querySelectorAll('*')) if (e.shadowRoot) walk(e.shadowRoot); }; walk(document); return n; })()`);
    const until = async (want, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await rows() === want) return Date.now() - t0; await sleep(50); } throw new Error(`rows stayed at ${await rows()}, wanted ${want}`); };
    const before = await rows();
    assert.ok(before >= COUNT, `the watcher draws ${before} rows (the To-do panel in the Calendar's page)`);
    const cleared = await call('DELETE', `/api/modules/todo/data?${sp}`, undefined, 'sam');
    assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
    const emptied = await until(0);
    assert.ok(emptied < 3000, `emptied in ${emptied} ms`);
    const back = await call('POST', `/api/modules/todo/data/restore?${sp}`, { restoreToken: cleared.json.restoreToken }, 'sam');
    assert.equal(back.status, 200, JSON.stringify(back.json));
    const drawn = await until(before);
    assert.ok(drawn < 3000, `drawn back in ${drawn} ms`);
    console.log(`  watching ${before} rows: empty in ${emptied} ms, back in ${drawn} ms`);
  });

  // --- Clear offered once there is data ---------------------------------------------------------------------------------
  await test('a module that was empty when the page loaded offers Clear once it has data (for-space is read again after a change)', async () => {
    const id = 'budget';
    await call('DELETE', `/api/modules/${id}/data?${sp}`); // emptied (the server holds it for its undo time: nothing to clear while it waits)
    assert.equal((await forSpace(id)).clear, false, `${id} is empty now`);
    await sleep(SECONDS * 1000 + 5000 + 1500); // the hold ends; the module stays empty
    const tab = await open(`/modules/${id}?space=${T}`);
    await tab.waitFor('#module-frame');
    await sleep(1200);
    const menu = async () => { if (!(await tab.eval(`Boolean(document.querySelector('.mf-titlebar .mf-titlebar-menu:not([hidden])'))`))) return []; await tab.click('.mf-titlebar .mf-titlebar-menu'); await sleep(300); const t = await tab.eval(`[...document.querySelectorAll('.host-menu-item, [role="menuitem"]')].map((e) => e.textContent.trim())`); await tab.key('Escape'); return t; };
    const items = await menu();
    assert.ok(!items.some((t) => /^Clear/.test(t)), `no Clear while empty: ${items}`);
    const r = await call('PUT', `/api/modules/${id}/data/cost:late1?${sp}`, { value: { id: 'late1', title: 'Late cost', amount: 10, category: 'food', date: '2026-10-20', paidBy: 'admin' } });
    assert.ok([200, 201].includes(r.status), JSON.stringify(r.json));
    await sleep(1500);
    assert.equal((await forSpace(id)).clear, true);
    const seen = await tab.eval(`(async () => { const m = await import('/module-host.js'); return typeof m.followClearable; })()`);
    assert.equal(seen, 'function');
    const after = await menu();
    assert.ok(after.some((t) => /^Clear/.test(t)), `Clear offered once it has data: ${after}`);
  });
  // --- the hold ends with data written during it -----------------------------------------------------------------------
  await test('hold ends with data written during it: Clear appears without a reload', async () => {
    const id = 'budget'; // it has the cost the case above added
    const tab = await open(`/modules/${id}?space=${T}`);
    await tab.waitFor('#module-frame');
    await sleep(1500);
    const menu = async () => { if (!(await tab.eval(`Boolean(document.querySelector('.mf-titlebar .mf-titlebar-menu:not([hidden])'))`))) return []; await tab.click('.mf-titlebar .mf-titlebar-menu'); await sleep(300); const t = await tab.eval(`[...document.querySelectorAll('.host-menu-item, [role="menuitem"]')].map((e) => e.textContent.trim())`); await tab.key('Escape'); return t; };
    assert.ok((await menu()).some((t) => /^Clear/.test(t)), 'Clear is offered while the module has data');
    const cleared = await call('DELETE', `/api/modules/${id}/data?${sp}`);
    assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
    await sleep(1200);
    assert.equal((await call('PUT', `/api/modules/${id}/data/cost:during1?${sp}`, { value: { id: 'during1', title: 'During the hold', amount: 5, category: 'food', date: '2026-10-21', paidBy: 'admin' } })).status, 200);
    await sleep(1200);
    assert.equal((await forSpace(id)).clear, false, 'nothing to clear while the hold waits');
    assert.ok(!(await menu()).some((t) => /^Clear/.test(t)), 'no Clear while the hold waits');
    await sleep(SECONDS * 1000 + 5000 + 1500); // the hold ends, and the page asks again (its undo time and a grace after the Clear)
    assert.equal((await forSpace(id)).clear, true, 'the server offers Clear now');
    const after = await menu();
    assert.ok(after.some((t) => /^Clear/.test(t)), `Clear offered when the hold ended, with no reload: ${after}`);
  });

  // --- the Undo note and the page's bottom bars ---------------------------------------------------------------------------
  // At 390 the note stands above the chat's composer and the tab bar; at 1280 an open menu is over it. Run again at each width
  // (UNDO_PAGE_WIDTH); the workspace is where the bars are.
  await test('Undo note: no overlap with the composer, the tab bar or an open menu on the workspace', async () => {
    const tab = await open('/#join=' + T);
    await tab.waitFor('button.sdk-strip-fact[data-module=budget]');
    await sleep(2500);
    await tab.eval(`(async () => { const b = await import('/brand.js'); b.undoToast('Cleared Polls.', async () => 'x', { until: Date.now() + 15000 }); return true; })()`);
    await tab.waitFor('.sdk-toast [data-undo]');
    await sleep(700);
    const boxes = () => tab.eval(`(() => { const r = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; }; const toast = r(document.querySelector('.sdk-toast[data-undo]')); const out = { toast, view: innerHeight }; for (const [k, s] of [['composer', '#chat-bar'], ['tabbar', '.sdk-tabbar'], ['menu', '.host-menu']]) { const e = document.querySelector(s); out[k] = e ? r(e) : null; } return out; })()`);
    const hit = (a, b) => a && b && !(a.r <= b.l || a.l >= b.r || a.b <= b.t || a.t >= b.b);
    const phone = WIDTH <= 640;
    const o = await boxes();
    if (phone) {
      assert.ok(o.tabbar, 'the tab bar is drawn on a phone');
      assert.equal(hit(o.toast, o.tabbar), false, `the note ${JSON.stringify(o.toast)} is clear of the tab bar ${JSON.stringify(o.tabbar)}`);
      if (o.composer) assert.equal(hit(o.toast, o.composer), false, `the note is clear of the composer ${JSON.stringify(o.composer)}`);
    } else {
      assert.equal(hit(o.toast, o.composer), false, 'the note is clear of the composer');
      // The Layout menu (the header's button) opens over the note: it is the top thing where they meet.
      await tab.click('#modules-toggle').catch(() => {});
      await sleep(500);
      const m = await boxes();
      if (m.menu && hit(m.toast, m.menu)) {
        const top = await tab.eval(`(() => { const t = document.querySelector('.sdk-toast[data-undo]').getBoundingClientRect(); const m = document.querySelector('.host-menu').getBoundingClientRect(); const x = (Math.max(t.left, m.left) + Math.min(t.right, m.right)) / 2; const y = (Math.max(t.top, m.top) + Math.min(t.bottom, m.bottom)) / 2; const el = document.elementFromPoint(x, y); return Boolean(el && el.closest('.host-menu')); })()`);
        assert.equal(top, true, 'where the open menu and the note meet, the menu is on top');
      }
    }
  });
} catch (err) {
  failed += 1;
  console.error(`FAIL setup\n${err.stack || err}`);
} finally {
  for (const t of tabs) await t.close().catch(() => {});
  if (browser) { try { browser.child.kill(); } catch { /* gone */ } }
  if (server) await stopServer(server);
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failed) {
  console.error(`check-undo-page: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-undo-page: OK (${n} checks, ${MODE} ${WIDTH})`);
