#!/usr/bin/env node
/*
 * check-prototype-page.mjs -- the Prototype page (public/design-system/prototype.html) scrolls, and its Vault section stays light.
 * Measured in a headless Chromium against a throwaway server (tools/shots.mjs); with no Chromium it says SKIPPED and exits 0
 * (a skip, never a pass), and fails when CI is set.
 *
 * What it holds (Thomas, 2026-11-02: the page froze and would not scroll):
 *   1. Scrolls. At 390, 500, 700 and 1280, light and dark, on the URL Thomas used (phone frame with the call, chat view): the page is
 *      taller than the window, the page's own overflow is not hidden, a mouse wheel moves it, and the End key reaches the bottom. A
 *      rule written for the phone screen's own page (phone.html) once hid the overflow of this page too.
 *   2. Pinned jump lists. Pressing a Vault "Jump to" button lands on the part; the pinned lists (.pp-dock) are still in view; a wheel
 *      up moves the page up; "Back to top" returns to 0.
 *   4. File windows (Thomas, 2026-11-03): CAP_SENTENCE is the decided sentence; a fifth file at 1280 leaves four windows and one toast (a sixth
 *      does not stack another); every window has Close and moves by its title bar and resizes by its grip, staying inside the canvas; the
 *      Grid's banded head is 34px or less and cuts a name in the middle, keeping the extension; at 390 every button in a file window is 44px
 *      tall or has a 44px tap area.
 *   3. Light. Scrolling the whole Vault section top to bottom, then stopping at twelve places: panels live at any time stay at or
 *      under LIVE_MAX (the cap is 8 plus the ones on the screen); no task runs longer than LONG_MS; the section scrolls in under
 *      SCROLL_MS; the nodes left are under NODES_MAX. (Measured at the time of writing: about 2 s, tasks up to 500 ms (1 s at 390), 8,600 nodes,
 *      against 33 s, tasks up to 6 s and 43,000 nodes when every panel stayed drawn.)
 * Usage: node tools/check-prototype-page.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findBrowser, launch, freePort, startServer, stopServer, Tab, sleep } from './shots.mjs';

const LIVE_MAX = 12; // the cap is 8; a few more may be on the screen at once
const LONG_MS = 800; // the target is 200 ms on a laptop; a held menu or a window opening is 150 to 350 ms, and none shares a frame with another panel's draw
const SCROLL_MS = 10000; // the target is 5 s
const NODES_MAX = 16000;
const failures = [];
const fail = (m) => { failures.push(m); console.error(`check-prototype-page: ${m}`); };
const say = (m) => console.log(`check-prototype-page: ${m}`);

const URL_PATH = '/design-system/prototype.html?theme=strong-coffee&mode=MODE&w=W&phdevice=390&phcall=on&phview=chat&phsheet=none';

async function main() {
  const bin = findBrowser();
  if (!bin) {
    say('SKIPPED the browser parts. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.');
    process.exit(process.env.CI ? 1 : 0);
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-page-'));
  let server = null; let browser = null;
  try {
    server = await startServer(dataDir, await freePort(), 'first');
    browser = await launch(bin);
    const open = async (size, mode) => {
      const tab = new Tab(browser.cdp, {});
      await tab.open(size, mode);
      const send = (m, p) => browser.cdp.send(m, p, tab.sid);
      await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ entryTypes: ["longtask"] }); } catch (e) {}' });
      await send('Page.navigate', { url: server.base + URL_PATH.replace('MODE', mode).replace('W', String(size)) });
      for (let i = 0; i < 100; i += 1) { if (await tab.eval(`!!document.getElementById('pp-vault') && !!document.querySelector('.pp-dock')`)) break; await sleep(150); }
      await sleep(600);
      const wheel = async (dy) => { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(size / 2), y: 400, deltaX: 0, deltaY: dy }); await sleep(500); };
      return { tab, send, wheel };
    };
    const y = (tab) => tab.eval('Math.round(window.scrollY)');

    for (const size of [390, 500, 700, 1280]) {
      for (const mode of ['light', 'dark']) {
        const label = `${size} ${mode}`;
        const { tab, send, wheel } = await open(size, mode);
        try {
          const o = await tab.eval(`({ h: document.scrollingElement.scrollHeight, c: document.scrollingElement.clientHeight, ox: getComputedStyle(document.documentElement).overflowY, ob: getComputedStyle(document.body).overflowY })`);
          if (!(o.h > o.c)) fail(`${label}: the page is not taller than the window (${o.h} against ${o.c})`);
          if (o.ox === 'hidden' || o.ob === 'hidden') fail(`${label}: the page's overflow is hidden (html ${o.ox}, body ${o.ob}), so it cannot scroll`);
          await wheel(600);
          if ((await y(tab)) <= 0) fail(`${label}: a mouse wheel does not scroll the page`);
          await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
          await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
          await sleep(1200);
          if ((await y(tab)) < o.h - o.c - 300) fail(`${label}: the End key does not reach the bottom (${await y(tab)} of ${o.h - o.c})`);
          if (size === 700 || size === 390) {
            await tab.eval('window.scrollTo(0, 0)');
            await sleep(300);
            const picked = await tab.eval(`(() => { const b = [...document.querySelectorAll('nav[aria-label="Jump to a part of the Vault"] button')].find((x) => /Choosing/.test(x.textContent)); if (!b) return false; b.click(); return true; })()`);
            if (!picked) { fail(`${label}: no Vault "Jump to" button for Choosing several`); continue; }
            await sleep(900);
            const landed = await y(tab);
            const seen = await tab.eval(`(() => { const r = document.querySelector('.pp-dock').getBoundingClientRect(); const v = document.querySelector('nav[aria-label="Jump to a part of the Vault"]').getBoundingClientRect(); return r.top >= -1 && r.bottom > 0 && r.bottom < innerHeight && v.top >= -1 && v.bottom <= r.bottom + 1; })()`);
            if (landed <= 0) fail(`${label}: the jump did not move the page`);
            if (!seen) fail(`${label}: after a jump the pinned jump lists are not in view`);
            await wheel(-300);
            if ((await y(tab)) >= landed) fail(`${label}: after a jump a wheel up does not move the page up (${landed} to ${await y(tab)})`);
            await tab.eval(`document.querySelector('.pp-dock-top').click()`);
            await sleep(500);
            if ((await y(tab)) !== 0) fail(`${label}: "Back to top" does not return to the top (${await y(tab)})`);
          }
        } finally { await tab.close(); }
      }
    }

    // Light: scroll the whole Vault section, then stop in twelve places.
    for (const size of [1280, 390]) {
      const { tab } = await open(size, 'light');
      try {
        const m = await tab.eval(`(async () => {
          const sec = document.getElementById('pp-vault');
          const top = sec.getBoundingClientRect().top + scrollY; const end = sec.getBoundingClientRect().bottom + scrollY;
          const live = () => [...document.querySelectorAll('#pp-vault .vt-frame')].filter((f) => !f.classList.contains('is-pending') && f.childElementCount).length;
          const nodes = () => { const n = (root) => { let c = 0; for (const el of root.querySelectorAll('*')) { c += 1; if (el.shadowRoot) c += n(el.shadowRoot); } return c; }; return n(document); };
          const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const nodesBefore = nodes();
          let max = 0; const t0 = performance.now();
          for (let yy = top; yy < end; yy += 600) { scrollTo(0, yy); await frame(); max = Math.max(max, live()); }
          const scrollMs = Math.round(performance.now() - t0);
          const stops = 12;
          for (let i = 0; i < stops; i += 1) { scrollTo(0, top + ((end - top) * i) / stops); await wait(450); max = Math.max(max, live()); }
          await wait(600);
          const lt = window.__lt || [];
          return { scrollMs, max, live: live(), nodesBefore, nodes: nodes(), frames: document.querySelectorAll('#pp-vault .vt-frame').length, longest: Math.max(0, ...lt), over200: lt.filter((x) => x > 200).length };
        })()`);
        say(`Vault at ${size}: ${m.frames} panels, scroll ${m.scrollMs} ms, most live ${m.max}, live at the end ${m.live}, nodes ${m.nodesBefore} to ${m.nodes}, longest task ${m.longest} ms (${m.over200} over 200 ms)`);
        if (m.frames < 60) fail(`${size}: the Vault section has only ${m.frames} panels; the check measures the wrong thing`);
        if (m.max > LIVE_MAX) fail(`${size}: ${m.max} panels were drawn at once (the limit is ${LIVE_MAX})`);
        if (m.live > LIVE_MAX) fail(`${size}: ${m.live} panels stay drawn after the scroll (the limit is ${LIVE_MAX})`);
        if (m.scrollMs > SCROLL_MS) fail(`${size}: scrolling the whole section took ${m.scrollMs} ms (the limit is ${SCROLL_MS})`);
        if (m.longest > LONG_MS) fail(`${size}: a task ran ${m.longest} ms (the limit is ${LONG_MS})`);
        if (m.nodes > NODES_MAX) fail(`${size}: ${m.nodes} nodes are left in the page (the limit is ${NODES_MAX})`);
      } finally { await tab.close(); }
    }

    // File windows. (At 390 system.css gives every small button a 44px tap area; on a wide screen with a coarse pointer the Vault's own rule does.)
    const WIN_JS = `
      const allIn = (root, sel) => { const out = [...root.querySelectorAll(sel)]; for (const e of root.querySelectorAll('*')) if (e.shadowRoot) out.push(...allIn(e.shadowRoot, sel)); return out; };
      const first = () => document.querySelector('#pp-vault .vt-frame');
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const stageOf = () => document.querySelector('#pp-vault .vt-stage');
      const openers = () => allIn(stageOf(), 'button.sdk-open').filter((b) => b.title);
    `;
    {
      const { tab, send } = await open(1280, 'dark');
      try {
        await tab.eval(`(async () => { ${WIN_JS} first().scrollIntoView(); for (let i = 0; i < 60 && !(stageOf() && openers().length > 6); i += 1) await wait(150); })()`);
        const cap = await tab.eval(`(async () => { ${WIN_JS} return (await import('/design-system/prototype-vault-window.js')).CAP_SENTENCE; })()`);
        if (cap !== 'Close a window to open another.') fail(`CAP_SENTENCE is "${cap}", not the decided sentence`);
        const r = await tab.eval(`(async () => { ${WIN_JS}
          const bs = openers();
          for (let i = 0; i < 5; i += 1) { bs[i].click(); await wait(200); }
          const four = stageOf().querySelectorAll('.vt-win').length;
          const toasts1 = stageOf().querySelectorAll('.vt-toast[data-only="cap"]').length;
          const text = (stageOf().querySelector('.vt-toast[data-only="cap"]') || {}).textContent || '';
          bs[5].click(); await wait(200);
          const toasts2 = stageOf().querySelectorAll('.vt-toast[data-only="cap"]').length;
          const noClose = [...stageOf().querySelectorAll('.vt-win')].filter((w) => !w.querySelector('.mf-titlebar [aria-label="Close"], .mf-titlebar [aria-label^="Close"]')).length;
          return { four, toasts1, toasts2, text, noClose };
        })()`);
        if (r.four !== 4) fail(`1280: opening five files left ${r.four} windows, not 4`);
        if (r.toasts1 !== 1 || !r.text.includes('Close a window to open another.')) fail(`1280: the fifth file gave ${r.toasts1} cap toast(s): "${r.text}"`);
        if (r.toasts2 !== 1) fail(`1280: a sixth file stacked the cap toast (${r.toasts2})`);
        if (r.noClose) fail(`1280: ${r.noClose} window(s) have no Close in the title bar`);
        // Move by the title bar, resize by the grip, and stay inside the canvas.
        const geo = async () => tab.eval(`(() => { ${WIN_JS} const w = stageOf().querySelector('.vt-win.is-front'); const s = stageOf().getBoundingClientRect(); const b = w.getBoundingClientRect(); const t = w.querySelector('.mf-titlebar').getBoundingClientRect(); const g = w.querySelector('.vt-win-grip').getBoundingClientRect(); return { sx: s.left, sy: s.top, sr: s.right, sb: s.bottom, x: b.left, y: b.top, r: b.right, bt: b.bottom, w: b.width, h: b.height, tx: t.left + 60, ty: t.top + t.height / 2, gx: g.left + g.width / 2, gy: g.top + g.height / 2 }; })()`);
        await tab.eval(`(() => { ${WIN_JS} window.scrollTo(0, stageOf().getBoundingClientRect().top + scrollY - 20); })()`);
        await sleep(400);
        const drag = async (x, y, dx, dy) => {
          const m = (type, px, py) => send('Input.dispatchMouseEvent', { type, x: Math.round(px), y: Math.round(py), button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
          await m('mousePressed', x, y); await m('mouseMoved', x + dx / 2, y + dy / 2); await m('mouseMoved', x + dx, y + dy); await m('mouseReleased', x + dx, y + dy); await sleep(250);
        };
        let a = await geo();
        await drag(a.tx, a.ty, -40, -20);
        let b = await geo();
        if (Math.abs(b.x - a.x - -40) > 2 || Math.abs(b.y - a.y - -20) > 2) fail(`1280: dragging the title bar moved the window by ${Math.round(b.x - a.x)},${Math.round(b.y - a.y)}, not -40,-20`);
        await drag(b.gx, b.gy, 50, 40);
        const c = await geo();
        if (Math.abs(c.w - b.w - 50) > 2 || Math.abs(c.h - b.h - 40) > 2) fail(`1280: dragging the grip resized the window by ${Math.round(c.w - b.w)},${Math.round(c.h - b.h)}, not 50,40`);
        const d0 = await geo();
        await drag(d0.tx, d0.ty, -3000, -3000);
        const d = await geo();
        if (d.x < d.sx - 1 || d.y < d.sy - 1 || d.r > d.sr + 1 || d.bt > d.sb + 1) fail(`1280: a window dragged far away left the canvas`);
      } finally { await tab.close(); }
    }
    {
      const { tab } = await open(1280, 'dark');
      try {
        const g = await tab.eval(`(async () => { ${WIN_JS}
          const state = [...document.querySelectorAll('#pp-vault .pp-state')].find((x) => (x.querySelector('.pp-state-name') || {}).textContent === 'Grid, stacked head');
          state.scrollIntoView();
          const box = state.querySelector('.vt-frame');
          let cards = [];
          for (let i = 0; i < 60 && !cards.length; i += 1) { await wait(150); cards = allIn(box, '.vt-card:not(.vt-card-thumb) > .sdk-card-head'); }
          const heads = cards.map((c) => Math.round(c.getBoundingClientRect().height));
          const tails = allIn(box, '.vt-nm-tail').map((t) => t.textContent);
          const cut = allIn(box, '.vt-nm-head').filter((x) => x.scrollWidth > x.clientWidth + 1).length;
          return { n: cards.length, max: Math.max(0, ...heads), tails: tails.length, withDot: tails.filter((t) => t.includes('.')).length, cut };
        })()`);
        say(`Grid head at 1280: ${g.n} cards, tallest head ${g.max}px, ${g.cut} names cut in the middle`);
        if (!g.n) fail('1280: no banded Grid cards found');
        if (g.max > 34) fail(`1280: the Grid's banded head is ${g.max}px (the limit is 34)`);
        if (g.tails !== g.n || g.withDot < g.n - 3) fail(`1280: ${g.withDot} of ${g.n} Grid names keep their extension when cut`);
      } finally { await tab.close(); }
    }
    for (const size of [390, 800]) {
      const { tab, send } = await open(size, 'light');
      try {
        if (size > 640) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); // so (pointer: coarse) answers
        if (size > 640 && !(await tab.eval("matchMedia('(pointer: coarse)').matches"))) fail(`${size}: (pointer: coarse) did not answer, so nothing was measured`);
        const r = await tab.eval(`(async () => { ${WIN_JS}
          first().scrollIntoView();
          for (let i = 0; i < 60 && !(stageOf() && openers().length > 6); i += 1) await wait(150);
          const small = []; let count = 0;
          const scan = (tag) => { for (const w of stageOf().querySelectorAll('.vt-win')) for (const b of allIn(w, 'button')) { const r = b.getBoundingClientRect(); if (!r.height) continue; count += 1; const after = parseFloat(getComputedStyle(b, '::after').height) || 0; if (r.height < 43.5 && after < 43.5) small.push(tag + ': ' + (b.getAttribute('aria-label') || b.textContent || b.className).trim().slice(0, 30) + ' ' + Math.round(r.height)); } };
          const pick = (re) => openers().find((b) => re.test(b.title));
          pick(/\\.(jpe?g|png|webp)$/i).click(); await wait(500);
          const info = allIn(stageOf(), '.vt-win button').find((b) => b.getAttribute('aria-label') === 'Info'); if (info) info.click(); await wait(300);
          scan('picture');
          pick(/\\.pdf$/i).click(); await wait(500);
          const find = allIn(stageOf(), '.vt-win button').find((b) => /search/i.test(b.getAttribute('aria-label') || b.textContent)); if (find) find.click(); await wait(300);
          scan('pdf');
          return { small, wins: stageOf().querySelectorAll('.vt-win').length, buttons: count };
        })()`);
        if (r.wins < 1 || r.buttons < 15) fail(`${size}: the file window check found ${r.wins} window(s) and ${r.buttons} buttons; it measures the wrong thing`);
        for (const x of [...new Set(r.small)]) fail(`${size}: a button in a file window is under 44px with no 44px tap area (${x})`);
        say(`File windows at ${size}${size > 640 ? " (coarse pointer)" : ""}: ${r.buttons} buttons measured, ${new Set(r.small).size} short`);
      } finally { await tab.close(); }
    }
  } finally {
    if (browser) { try { browser.child.kill('SIGTERM'); } catch { /* gone */ } }
    if (server) await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  if (failures.length) { console.error(`check-prototype-page: ${failures.length} failure(s)`); process.exit(1); }
  say('OK');
}
main().catch((err) => { console.error(`check-prototype-page: ${err.stack || err.message}`); process.exit(1); });
