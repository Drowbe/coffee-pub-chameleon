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
 *      Grid's banded head is 32px or less and cuts a name in the middle, keeping the extension, and the cut name reads flush: the gap between the
 *      ellipsis and the extension is 2px or less at 1280 and 700 (read from the picture: the ink, not the boxes); at 390 every button in a file window is 44px
 *      tall or has a 44px tap area. The right zone (Thomas, 2026-11-03): at 700 and 1280 the file window's last right-zone control (Full screen; the
 *      phone sheet's Download) ends within 16px of the window's inner right edge, Download, Share, Full screen keep their order, nothing overlaps, and
 *      at the 240px minimum the left zone folds into More (Next file first) while the right zone stays pinned.
 *   3. Light. Scrolling the whole Vault section top to bottom, then stopping at twelve places: panels live at any time stay at or
 *      under LIVE_MAX (the cap is 8 plus the ones on the screen); the median of five runs' longest task is under LONG_MS (1500 ms) and the
 *      median count of tasks over 200 ms is under LONG_OVER_MAX (15) (the goal is 200 ms on a laptop; a regression to about 1.3 s is meant to
 *      show in the count, since it stays under LONG_MS); when the box's load average is above its core count these two are not checked and
 *      a NOTE says so; the section scrolls in under SCROLL_MS; the nodes left are under NODES_MAX. (Measured at the time of writing: about 2 s, 8,600 nodes, against 33 s, tasks up to
 *      6 s and 43,000 nodes when every panel stayed drawn.)
 *   4. No sideways scroll. At 390, 500 and 700 the Prototype page is no wider than the window (the Phone section's switches once made it 783px wide).
 *   5. The phone screen's bottom bar (phone.html at 390 and 360, dark and light; Thomas, 2026-11-03, QA's cases): a sheet or dialog open puts the top
 *      bar, view, strip and bar out of reach (inert) and the focus inside it; Esc steps back one level (Replace to Edit the four to More to none) and the
 *      focus returns to the control that opened each, never the page; a sheet's title is at least the body's size; the space's name is not cut in the
 *      call; every bar and strip control is 56 by 56 or more; a place's count is gone while it is open; the Prototype's Switcher starts at Both and the
 *      two frames share the pins.
 *   6. Maps (plan-map-options.md, step 0; Thomas, 2026-11-04): the Prototype's MAP_MIN (prototype-maps.js) is the module's
 *      (modules/maps/src/maps-lib-d-style.js). On the map screen (map-screen.html), each map theme (Light, Dark) under a dark and a light app
 *      theme, in two shipped themes: the colours as drawn are the same whatever the app theme, the module's own guardMap moves none of them, and
 *      every name, road and fill holds MAP_MIN; with the pins as recommended (edge=map, the section's question 2) a pin's edge or ring and
 *      the selected pin's edge or fill are 3:1 on the land, a pin's name 4.5:1 on its chip, the search results 4.5:1. Map options is in the "..." menu and opens the panel with the focus on the chosen theme; choosing Dark redraws the map; Escape
 *      closes it and the focus is back on "..."; a click outside closes it. At a real 390 viewport every row of the panel and its close button
 *      is a 44px tap and the panel is inside the screen. A picture map shows the one line and no choices. The section is on the Prototype page,
 *      with its jump list, and its first drawing loads. --skip-maps leaves this part out; --maps-only runs only this part.
 * Usage: node tools/check-prototype-page.mjs [--skip-maps | --maps-only]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findBrowser, launch, freePort, startServer, stopServer, Tab, sleep, decodePng } from './shots.mjs';

const LIVE_MAX = 12; // the cap is 8; a few more may be on the screen at once
const RUNS = 5; // runs per size; the limits are on the median of the runs
const LONG_MS = 1500; // the median of the runs' longest task; the goal is 200 ms on a laptop (a held menu or a window opening is 150 to 350 ms).
// A regression to about 1.3 s median stays under LONG_MS, so the second limit is the one meant to catch it: LONG_OVER_MAX is the median count
// of tasks over 200 ms per run. Healthy runs on the loaded 4-core box counted 18 to 24, so the limit is not yet proven on an unloaded box.
const LONG_OVER_MAX = 15;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
// The long-task limits are timing measures: when the box is busier than its cores (1-minute load average above the core count) they are not
// checked, and a note says so. The other Vault limits (panels, scroll time, nodes) are still checked.
const load = () => os.loadavg()[0];
const cores = () => os.cpus().length;

// The gap, in device pixels, between the ink of a head's last letter (or its ellipsis) and the tail's first ink: the background columns just
// left of the tail's left edge, scanned over its height. Ink is a pixel that differs from the box's most common colour.
function inkGap(img, b) {
  const x1 = Math.round(b.x); const x0 = Math.max(0, x1 - 30);
  const y0 = Math.max(0, Math.round(b.y)); const y1 = Math.min(img.h, Math.round(b.y + b.h));
  const px = (x, y) => { const o = (y * img.w + x) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2]]; };
  const seen = new Map();
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) { const k = px(x, y).join(','); seen.set(k, (seen.get(k) || 0) + 1); }
  let bg = [0, 0, 0]; let best = -1;
  for (const [k, n] of seen) if (n > best) { best = n; bg = k.split(',').map(Number); }
  const ink = (x, y) => { const p = px(x, y); return Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 40; };
  for (let x = x1 - 1; x >= x0; x -= 1) { for (let y = y0; y < y1; y += 1) if (ink(x, y)) return x1 - x - 1; }
  return x1 - x0;
}
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
    if (process.argv.includes('--maps-only')) { await checkMaps(browser, server); return true; } // reported below, after the browser is closed

    for (const size of [390, 500, 700, 1280]) {
      for (const mode of ['light', 'dark']) {
        const label = `${size} ${mode}`;
        const { tab, send, wheel } = await open(size, mode);
        try {
          const o = await tab.eval(`({ h: document.scrollingElement.scrollHeight, c: document.scrollingElement.clientHeight, ox: getComputedStyle(document.documentElement).overflowY, ob: getComputedStyle(document.body).overflowY })`);
          if (!(o.h > o.c)) fail(`${label}: the page is not taller than the window (${o.h} against ${o.c})`);
          if (size <= 700) { const sw = await tab.eval('document.documentElement.scrollWidth'); if (sw > size) fail(`${label}: the page scrolls sideways (${sw}px wide in a ${size}px window)`); }
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

    // The phone screen's bottom bar, in the compact shape.
    for (const size of [390, 360]) {
      for (const mode of ['dark', 'light']) {
        const label = `phone ${size} ${mode}`;
        const tab = new Tab(browser.cdp, {});
        await tab.open(size, mode);
        const send = (m, p) => browser.cdp.send(m, p, tab.sid);
        try {
          await send('Page.navigate', { url: `${server.base}/design-system/phone.html?theme=strong-coffee&mode=${mode}${mode === 'light' ? '&light=cream' : ''}&call=on&view=module&sheet=none&bar=middle` });
          for (let i = 0; i < 60; i += 1) { if (await tab.eval(`!!document.querySelector('.ph-bar')`)) break; await sleep(150); }
          await sleep(400);
          const r = await tab.eval(`(async () => {
            const out = []; const D = document; const $ = (s) => D.querySelector(s);
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            const click = async (s) => { const e = $(s); if (!e) { out.push('no ' + s); return; } e.focus(); e.click(); await wait(60); };
            const esc = async () => { D.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(60); };
            const active = () => { const a = D.activeElement; return a ? (a.dataset.key || a.dataset.tab || a.getAttribute('aria-label') || a.tagName) : 'none'; };
            const inside = (s) => !!D.activeElement && !!D.activeElement.closest(s);
            const inertAll = () => ['.ph-top', '.ph-view', '.ph-strip', '.ph-bar'].every((s) => !$(s) || $(s).inert);
            // controls and the space's name
            for (const e of D.querySelectorAll('.ph-bar .sdk-tabbar-tab, .ph-bar .ph-round, .ph-strip button')) { const b = e.getBoundingClientRect(); if (b.width < 55.5 || b.height < 55.5) out.push('control ' + (e.dataset.tab || e.getAttribute('aria-label')) + ' is ' + Math.round(b.width) + 'x' + Math.round(b.height)); }
            for (const call of ['on', 'muted']) { /* the name, in the call */ }
            const sp = $('.ph-space'); if (sp.scrollWidth > sp.clientWidth) out.push('the space name is cut (' + sp.scrollWidth + ' over ' + sp.clientWidth + ')'); if (sp.title !== sp.textContent) out.push('the space name has no title');
            const chatTab = $('[data-tab="chat"]'); chatTab.focus(); chatTab.click(); await wait(60);
            if ($('[data-tab="chat"] .sdk-badge-micro')) out.push('Chat shows a count while it is open');
            if (D.activeElement === D.body) out.push('focus fell to the page after a tap on a place');
            $('[data-tab="planner"]').click(); await wait(60);
            // More, Edit the four, Replace
            await click('[data-tab="more"]');
            if (!inertAll()) out.push('the page is not inert under More'); if (!inside('.ph-sheet')) out.push('focus is not in More: ' + active());
            const title = getComputedStyle($('.ph-sheet-title')).fontSize; if (parseFloat(title) < parseFloat(getComputedStyle(D.body).fontSize)) out.push('the sheet title is ' + title);
            await click('[data-key="toggle"]');
            if ($('.ph-sheet-title').textContent !== 'Edit the four') out.push('the sheet is titled ' + $('.ph-sheet-title').textContent);
            await click('[data-key="slot-3"]');
            if (!$('.ph-bottom')) out.push('Replace did not open'); else {
              if (!$('.ph-sheet').inert) out.push('Edit the four is not inert under Replace'); if (!inside('.ph-bottom')) out.push('focus is not in Replace: ' + active());
              const t = getComputedStyle($('.ph-bottom-title')); if (parseFloat(t.fontSize) < 16 || parseFloat(t.fontSize) < parseFloat(getComputedStyle(D.body).fontSize)) out.push('the Replace title is ' + t.fontSize + ', not a title');
            }
            await esc();
            if (!$('.ph-sheet') || $('.ph-bottom')) out.push('Esc in Replace did not leave Edit the four open'); else if (active() !== 'slot-3') out.push('after Esc in Replace focus is on ' + active() + ', not the place');
            await esc();
            if (!$('.ph-sheet') || $('.ph-sheet-title').textContent !== 'More') out.push('the second Esc did not return to More'); else if (active() !== 'toggle') out.push('after Esc in Edit the four focus is on ' + active());
            await esc();
            if ($('.ph-sheet')) out.push('the third Esc did not close More'); if (D.activeElement === D.body || active() !== 'more') out.push('after More closes focus is on ' + active());
            // the menu, Leave and Stay; Online
            await click('[data-key="menu"]'); if (!inertAll()) out.push('the page is not inert under the menu');
            await click('.host-menu-item.danger'); if (!$('[role="alertdialog"]')) out.push('Leave? did not open');
            { const t = getComputedStyle($('.ph-bottom-title')); if (parseFloat(t.fontSize) < 16) out.push('the Leave title is ' + t.fontSize); }
            await click('.ph-bottom-foot .btn:not(.solid)'); if (active() !== 'menu') out.push('after Stay focus is on ' + active());
            await click('[data-key="online"]'); await esc(); if (active() !== 'online') out.push('after Online closes focus is on ' + active());
            return out;
          })()`);
          for (const m of r) fail(`${label}: ${m}`);
        } finally { await tab.close(); }
      }
    }

    // The Prototype: Switcher starts at Both; the pins follow into the other frame.
    {
      const { tab } = await open(1280, 'dark');
      try {
        const m = await tab.eval(`(async () => {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const fr = [...document.querySelectorAll('iframe.phf-screen')];
          if (fr.length !== 2) return 'the Phone section shows ' + fr.length + ' screens, not 2 (Both)';
          for (let i = 0; i < 40 && !fr.every((f) => f.contentDocument && f.contentDocument.querySelector('.ph-bar')); i += 1) await wait(150);
          const a = fr[0].contentDocument; const b = fr[1].contentDocument;
          a.querySelector('[data-tab="more"]').click(); await wait(200);
          a.querySelector('[data-key="toggle"]').click(); await wait(100);
          a.querySelector('[data-key="slot-3"]').click(); await wait(100);
          a.querySelector('[data-key="pick-budget"]').click(); await wait(300);
          const names = (d) => [...d.querySelectorAll('.ph-bar [data-tab]:not([data-tab="more"])')].map((x) => x.dataset.tab).join();
          if (names(a) !== names(b)) return 'the two frames differ after a pin: ' + names(a) + ' and ' + names(b);
          if (!names(b).includes('budget')) return 'the pin did not reach the bar: ' + names(b);
          return '';
        })()`);
        if (m) fail(`Both: ${m}`);
      } finally { await tab.close(); }
    }

    // Light: scroll the whole Vault section, then stop in twelve places. Five runs each; the long-task limits are on the median.
    for (const size of [1280, 390]) {
      const runs = [];
      const loadBefore = load();
      for (let k = 0; k < RUNS; k += 1) {
        const { tab } = await open(size, 'light');
        try {
          runs.push(await tab.eval(`(async () => {
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
        })()`));
        } finally { await tab.close(); }
      }
      const med = median(runs.map((m) => m.longest));
      const medOver = median(runs.map((m) => m.over200));
      const loaded = Math.max(loadBefore, load()) > cores();
      const r0 = runs[0];
      say(`Vault at ${size}: ${r0.frames} panels, scroll ${runs.map((m) => m.scrollMs).join(', ')} ms, most live ${Math.max(...runs.map((m) => m.max))}, live at the end ${Math.max(...runs.map((m) => m.live))}, nodes ${r0.nodesBefore} to ${Math.max(...runs.map((m) => m.nodes))}, longest task median ${med} ms (runs ${runs.map((m) => m.longest).join(', ')} ms), median ${medOver} tasks over 200 ms (runs ${runs.map((m) => m.over200).join(', ')})`);
      if (loaded) say(`NOTE: the load average is ${Math.max(loadBefore, load()).toFixed(2)} on ${cores()} cores, so the long-task limits were not checked at Vault ${size} this time (not a pass or a fail for them).`);
      for (const m of runs) {
        if (m.frames < 60) fail(`${size}: the Vault section has only ${m.frames} panels; the check measures the wrong thing`);
        if (m.max > LIVE_MAX) fail(`${size}: ${m.max} panels were drawn at once (the limit is ${LIVE_MAX})`);
        if (m.live > LIVE_MAX) fail(`${size}: ${m.live} panels stay drawn after the scroll (the limit is ${LIVE_MAX})`);
        if (m.scrollMs > SCROLL_MS) fail(`${size}: scrolling the whole section took ${m.scrollMs} ms (the limit is ${SCROLL_MS})`);
        if (m.nodes > NODES_MAX) fail(`${size}: ${m.nodes} nodes are left in the page (the limit is ${NODES_MAX})`);
      }
      if (!loaded && med > LONG_MS) fail(`${size}: the median of ${RUNS} runs' longest task is ${med} ms (the limit is ${LONG_MS})`);
      if (!loaded && medOver > LONG_OVER_MAX) fail(`${size}: the median of ${RUNS} runs has ${medOver} tasks over 200 ms (the limit is ${LONG_OVER_MAX})`);
    }

    // File windows. (At 390 system.css gives every small button a 44px tap area; on a wide screen with a coarse pointer the Vault's own rule does.)
    const WIN_JS = `
      const allIn = (root, sel) => { const out = [...root.querySelectorAll(sel)]; for (const e of root.querySelectorAll('*')) if (e.shadowRoot) out.push(...allIn(e.shadowRoot, sel)); return out; };
      const first = () => document.querySelector('#pp-vault .vt-frame');
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const stageOf = () => document.querySelector('#pp-vault .vt-canvas');
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
    // The banded Grid at 1280 and 700: the heads, the cut names, and the gap after each ellipsis, read from the picture (the ink of the
    // head's last letter or ellipsis to the tail's first ink, in pixels).
    for (const size of [1280, 700]) {
      const { tab, send } = await open(size, 'dark');
      try {
        const g = await tab.eval(`(async () => { ${WIN_JS}
          const state = [...document.querySelectorAll('#pp-vault .pp-state')].find((x) => (x.querySelector('.pp-state-name') || {}).textContent === 'Grid, stacked head');
          state.scrollIntoView();
          const box = state.querySelector('.vt-frame');
          let cards = [];
          for (let i = 0; i < 60 && !cards.length; i += 1) { await wait(150); cards = allIn(box, '.vt-card:not(.vt-card-thumb) > .sdk-card-head'); }
          const heads = cards.map((c) => Math.round(c.getBoundingClientRect().height));
          const tails = allIn(box, '.vt-nm-tail').map((t) => t.textContent);
          // A cut name: its head ends with the ellipsis, or its head is clipped (a CSS ellipsis has no text of its own).
          const cut = allIn(box, '.vt-nm-head').filter((x) => x.textContent.endsWith('…') || x.scrollWidth > x.clientWidth + 1);
          const inView = cut.map((hd) => hd.nextElementSibling.getBoundingClientRect()).filter((r) => r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight);
          return {
            n: cards.length, max: Math.max(0, ...heads), tails: tails.length, withDot: tails.filter((t) => t.includes('.')).length, cut: cut.length,
            sample: cut.slice(0, 2).map((x) => x.textContent + '|' + x.nextElementSibling.textContent),
            boxes: inView.slice(0, 12).map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height })),
          };
        })()`);
        await sleep(300);
        const shot = decodePng(Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        const gaps = g.boxes.map((b) => inkGap(shot, b));
        const gap = Math.max(0, ...gaps);
        say(`Grid head at ${size}: ${g.n} cards, tallest head ${g.max}px, ${g.cut} names cut in the middle, ${gaps.length} read from the picture, widest ink gap ${gap}px (${g.sample.join(' ; ')})`);
        if (!g.n) fail(`${size}: no banded Grid cards found`);
        if (g.max > 32) fail(`${size}: the Grid's banded head is ${g.max}px (the limit is 32)`);
        if (g.tails !== g.n || g.withDot < g.n - 3) fail(`${size}: ${g.withDot} of ${g.n} Grid names keep their extension when cut`);
        if (!g.cut) fail(`${size}: no Grid name is cut in the middle; the check measures the wrong thing`);
        if (!gaps.length) fail(`${size}: no cut Grid name is in the picture to measure`);
        if (gap > 2) fail(`${size}: a cut Grid name has a ${gap}px gap after the ellipsis (the limit is 2)`);
      } finally { await tab.close(); }
    }
    // The file window's right zone (Thomas, 2026-11-03: Download, Share and Full screen are right-justified, Full screen last). Measured at 700
    // (a canvas of 640 or less is the phone sheet: Download is its large foot button) and at 1280 (a window; then narrowed by its grip to the 240px minimum).
    // The right zone's last control (Full screen; Download when it is the sheet's foot) sits within 16px of the window's inner right edge, the
    // zone keeps its order, and no two controls in the row overlap. Download itself does not also sit at that edge while Full screen comes after
    // it: at 1280 it ends about 48px in, which is the order asked for.
    const RZ_JS = `
      const winOf = () => stageOf().querySelector('.vt-win.is-front');
      const innerRight = (win) => { const f = win.querySelector(':scope > .mf'); return f.getBoundingClientRect().right - (parseFloat(getComputedStyle(f).borderRightWidth) || 0); };
      const shownIn = (win) => [...win.querySelectorAll('.mf-toolbar > *')].filter((e) => e.getClientRects().length && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0);
      const overlapping = (els) => { let n = 0; for (let i = 0; i < els.length; i += 1) for (let j = i + 1; j < els.length; j += 1) { const a = els[i].getBoundingClientRect(); const b = els[j].getBoundingClientRect(); if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) n += 1; } return n; };
      const rzState = () => {
        const win = winOf(); if (!win) return { none: true };
        const inner = innerRight(win);
        const els = shownIn(win);
        const label = (e) => e.getAttribute('aria-label') || e.textContent.trim();
        const names = els.map(label);
        const rightmost = els.reduce((a, b) => (b.getBoundingClientRect().right > a.getBoundingClientRect().right ? b : a));
        const foot = allIn(win, '.vt-dlbar')[0]; // inside the window's shadow root
        const sheet = Boolean(foot && getComputedStyle(foot).display !== 'none');
        const bigDl = sheet ? allIn(win, '.vt-dlbig')[0] : null;
        const dl = els.find((e) => label(e) === 'Download');
        const share = els.find((e) => label(e) === 'Share');
        const full = els.find((e) => label(e) === 'Full screen');
        const order = [dl, share, full].filter(Boolean).map((e) => els.indexOf(e));
        const ordered = order.every((v, i) => i === 0 || v > order[i - 1]);
        return { inner, sheet, names, edge: label(rightmost), gap: inner - rightmost.getBoundingClientRect().right, footGap: bigDl ? inner - bigDl.getBoundingClientRect().right : null, ordered, fullLast: !full || rightmost === full, overlaps: overlapping(els), hasFull: Boolean(full), width: win.getBoundingClientRect().width };
      };
    `;
    for (const size of [700, 1280]) {
      const { tab, send } = await open(size, 'dark');
      try {
        const st = await tab.eval(`(async () => { ${WIN_JS} ${RZ_JS}
          first().scrollIntoView();
          for (let i = 0; i < 60 && !(stageOf() && openers().length > 6); i += 1) await wait(150);
          const pick = openers().find((b) => /\\.(jpe?g|png|webp)$/i.test(b.title));
          if (!pick) return { none: true };
          pick.click(); await wait(500);
          return rzState();
        })()`);
        if (st.none) { fail(`${size}: no file window was found; the check measures the wrong thing`); continue; }
        say(`File window right zone at ${size} (${st.sheet ? 'phone sheet' : 'window'}, ${Math.round(st.width)}px): ${st.names.join(', ')}; ${st.edge} ends ${Math.round(st.gap)}px from the inner edge${st.sheet ? `; the foot Download ends ${Math.round(st.footGap)}px` : ''}`);
        if (!st.hasFull) fail(`${size}: no Full screen control in the file window; the check measures the wrong thing`);
        if (st.gap < 0 || st.gap > 16) fail(`${size}: the right zone's last control (${st.edge}) ends ${Math.round(st.gap)}px from the window's inner right edge (the limit is 16)`);
        if (st.sheet && (st.footGap === null || st.footGap < 0 || st.footGap > 16)) fail(`${size}: the phone sheet's Download foot button ends ${Math.round(st.footGap)}px from the window's inner right edge (the limit is 16)`);
        if (!st.ordered) fail(`${size}: the right zone is not in the order Download, Share, Full screen`);
        if (!st.fullLast) fail(`${size}: Full screen is not the rightmost control`);
        if (st.overlaps) fail(`${size}: ${st.overlaps} pair(s) of controls overlap in the file window's toolbar`);
        if (size === 1280) {
          // Narrowed by its grip: the left zone folds into More, the right zone stays pinned at the edge and nothing overlaps.
          const grip = await tab.eval(`(() => { ${WIN_JS} const g = stageOf().querySelector('.vt-win.is-front .vt-win-grip').getBoundingClientRect(); const w = stageOf().querySelector('.vt-win.is-front').getBoundingClientRect().width; return { x: g.left + g.width / 2, y: g.top + g.height / 2, w }; })()`);
          const m = (type, px, py) => send('Input.dispatchMouseEvent', { type, x: Math.round(px), y: Math.round(py), button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
          const dx = -Math.max(0, grip.w - 240);
          await m('mousePressed', grip.x, grip.y); await m('mouseMoved', grip.x + dx / 2, grip.y); await m('mouseMoved', grip.x + dx, grip.y); await m('mouseReleased', grip.x + dx, grip.y); await sleep(400);
          const n = await tab.eval(`(() => { ${WIN_JS} ${RZ_JS} return rzState(); })()`);
          say(`File window right zone narrowed at ${size}: ${Math.round(n.width)}px wide; ${n.names.join(', ')}; ${n.edge} ends ${Math.round(n.gap)}px from the inner edge`);
          if (n.width > 250) fail(`${size}: the grip narrowed the file window to ${Math.round(n.width)}px, not the 240px minimum`);
          if (!n.hasFull || n.gap < 0 || n.gap > 16) fail(`${size}: narrowed, the right zone's last control (${n.edge}) ends ${Math.round(n.gap)}px from the inner edge (the limit is 16)`);
          if (!n.ordered || !n.fullLast) fail(`${size}: narrowed, the right zone is out of order`);
          if (n.overlaps) fail(`${size}: narrowed, ${n.overlaps} pair(s) of controls overlap`);
          if (!n.names.includes('More') || n.names.includes('Next file')) fail(`${size}: narrowed, the left zone did not fold into More (${n.names.join(', ')})`);
        }
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
    // 7. Panel stacking (plan-panel-stacking.md, step 0): at 390 the page is no wider than the window with the section in view and at its end
    // (a hidden element inside a module frame once escaped the drawing's own sideways scroll and made the page 923px wide).
    {
      const tab = new Tab(browser.cdp, {});
      await tab.open(390, 'dark');
      try {
        await browser.cdp.send('Page.navigate', { url: `${server.base}/design-system/prototype.html?theme=strong-coffee&mode=dark&w=390` }, tab.sid);
        for (let i = 0; i < 100; i += 1) { if (await tab.eval(`!!document.getElementById('pps-try')`).catch(() => false)) break; await sleep(150); }
        for (const id of ['pps-try', 'pps-questions']) {
          await tab.eval(`document.getElementById('${id}').scrollIntoView()`);
          for (let i = 0; i < 40; i += 1) { if (await tab.eval(`!!document.querySelector('#${id} .pps-canvas, #${id} .pps-list-words')`)) break; await sleep(150); }
          await sleep(300);
          const r = await tab.eval(`({ sw: document.documentElement.scrollWidth, vw: innerWidth, frames: document.querySelectorAll('#pp-panel-stacking .mf').length })`);
          if (!r.frames) fail(`panel stacking at 390 (${id}): no module frame is drawn; the check measures the wrong thing`);
          if (r.sw > r.vw) fail(`panel stacking at 390 (${id}): the page scrolls sideways (${r.sw}px wide in a ${r.vw}px window)`);
          say(`Panel stacking at 390 (${id}): page ${r.sw}px in ${r.vw}px, ${r.frames} frames`);
        }
        // The first column of a canvas is flexible and never narrower than FLEX_MIN (280); a canvas narrower than that clips every drawing in it.
        const sets = await tab.eval(`[...document.querySelectorAll('#pp-panel-stacking .pps-set')].map((e) => e.id)`);
        for (const id of sets) {
          await tab.eval(`document.getElementById('${id}').scrollIntoView()`);
          await sleep(250);
        }
        const wide = await tab.eval(`[...document.querySelectorAll('#pp-panel-stacking .pps-canvas')].map((c) => ({ set: c.closest('.pps-set')?.id, w: c.offsetWidth, first: parseFloat(getComputedStyle(c).gridTemplateColumns) })).filter((c) => !(c.first <= c.w + 0.5))`);
        const total = await tab.eval(`document.querySelectorAll('#pp-panel-stacking .pps-canvas').length`);
        if (total < 10) fail(`panel stacking: only ${total} canvases are drawn; the width check measures too little`);
        for (const c of wide) fail(`panel stacking (${c.set}): a canvas ${c.w}px wide has a first column ${c.first}px wide, so the drawing is clipped`);
        say(`Panel stacking: ${total} canvases, none narrower than its first column`);
        // The stack's divider is the call and chat column's splitter (.side-column-splitter-h in style.css), turned to lie between two
        // sections: an 8px strip that adds no height (14px on a coarse pointer), its cursor, its colours at rest and under the pointer.
        const send = (m, p) => browser.cdp.send(m, p, tab.sid);
        const DIV = `document.querySelector('#pps-divider .pps-cell .pps-div')`;
        const measure = `(() => { const ref = document.createElement('div'); ref.className = 'side-column-splitter side-column-splitter-h'; ref.style.display = 'block'; document.body.append(ref);
          const pick = (e) => { const c = getComputedStyle(e); return { h: e.getBoundingClientRect().height, mt: c.marginTop, mb: c.marginBottom, cursor: c.cursor, touch: c.touchAction, bg: c.backgroundColor, z: c.zIndex }; };
          const out = { div: pick(${DIV}), ref: pick(ref) }; ref.remove(); return out; })()`;
        await tab.eval(`document.getElementById('pps-divider').scrollIntoView({ block: 'center' })`);
        for (let i = 0; i < 40; i += 1) { if (await tab.eval(`!!${DIV}`)) break; await sleep(150); }
        await sleep(300);
        const fine = await tab.eval(measure);
        if (fine.div.h !== 8) fail(`panel stacking: the stack divider's hit strip is ${fine.div.h}px tall, not 8px like the real splitter`);
        for (const k of ['h', 'mt', 'mb', 'cursor', 'touch', 'bg', 'z']) if (fine.div[k] !== fine.ref[k]) fail(`panel stacking: the stack divider's ${k} is ${fine.div[k]}, the real splitter's ${fine.ref[k]}`);
        // The divider itself to the middle of the window (the parts drawn as they come near move what is below them), and it is what is under the point.
        await tab.eval(`${DIV}.scrollIntoView({ block: 'center' })`);
        await sleep(300);
        const box = await tab.eval(`(() => { const d = ${DIV}; const r = d.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + r.height / 2; return { x, y, hit: document.elementFromPoint(x, y) === d }; })()`);
        if (!box.hit) fail('panel stacking: the stack divider is not what is under its own middle, so the pointer checks below measure nothing');
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
        await sleep(300);
        const hover = await tab.eval(`(() => { const p = document.createElement('div'); p.style.background = 'color-mix(in srgb, var(--accent) 50%, transparent)'; document.body.append(p); const want = getComputedStyle(p).backgroundColor; p.remove(); return { got: getComputedStyle(${DIV}).backgroundColor, want }; })()`);
        if (hover.got !== hover.want) fail(`panel stacking: under the pointer the stack divider is ${hover.got}, not the real splitter's ${hover.want}`);
        const now = () => tab.eval(`(() => { const d = ${DIV}; const s = [...d.parentElement.querySelectorAll(':scope > .pps-sec')].map((e) => e.offsetHeight); return { v: Number(d.getAttribute('aria-valuenow')), s }; })()`);
        const before = await now();
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y + 40, button: 'left', buttons: 1 });
        const moved = await now();
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y - 1000, button: 'left', buttons: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y - 1000, button: 'left', clickCount: 1 });
        const clamped = await now();
        if (!(moved.s[0] === before.s[0] + 40)) fail(`panel stacking: dragging the divider 40px down moved it from ${before.s[0]} to ${moved.s[0]}`);
        if (clamped.s[0] !== 156) fail(`panel stacking: dragged far up, the upper section is ${clamped.s[0]}px, not the least (156)`);
        await tab.eval(`(() => { const d = ${DIV}; d.focus(); d.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); })()`);
        const ended = await now();
        if (ended.s[1] !== 156) fail(`panel stacking: End left the lower section ${ended.s[1]}px, not the least (156)`);
        await tab.eval(`${DIV}.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))`);
        const up = await now();
        if (up.s[0] !== ended.s[0] - 16) fail(`panel stacking: Up moved the divider from ${ended.s[0]} to ${up.s[0]}, not 16px`);
        say(`Panel stacking divider: ${fine.div.h}px strip, cursor ${fine.div.cursor}, hover ${hover.got}; drag ${before.s[0]} to ${moved.s[0]}, clamped at ${clamped.s[0]}, End and Up by key`);
        await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        if (!(await tab.eval("matchMedia('(pointer: coarse)').matches"))) fail('panel stacking: (pointer: coarse) did not answer, so the finger strip was not measured');
        const coarse = await tab.eval(measure);
        if (coarse.div.h !== 14) fail(`panel stacking: on a coarse pointer the stack divider's hit strip is ${coarse.div.h}px tall, not 14px like the real splitter`);
        if (coarse.div.mt !== coarse.ref.mt || coarse.div.mb !== coarse.ref.mb) fail(`panel stacking: on a coarse pointer the divider's margins (${coarse.div.mt}, ${coarse.div.mb}) are not the real splitter's (${coarse.ref.mt}, ${coarse.ref.mb})`);
        say(`Panel stacking divider on a coarse pointer: ${coarse.div.h}px strip, margins ${coarse.div.mt} ${coarse.div.mb}`);
        await send('Emulation.setTouchEmulationEnabled', { enabled: false });
        // A drop that would be refused draws no line: in the docked limit's canvas (two columns, full) Polls dragged out of its stack to
        // the right edge would need a third column. The Planner, a column of its own, dragged to the same edge does draw one.
        await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
        await tab.eval(`document.getElementById('pps-limit').scrollIntoView({ block: 'start' })`);
        for (let i = 0; i < 40; i += 1) { if (await tab.eval(`!!document.querySelector('#pps-limit .pps-canvas .mf[data-id="polls"]')`)) break; await sleep(150); }
        await sleep(300);
        const lineFor = async (id) => {
          await tab.eval(`document.querySelector('#pps-limit .pps-canvas').scrollIntoView({ block: 'center' })`);
          await sleep(300);
          const p = await tab.eval(`(() => { const c = document.querySelector('#pps-limit .pps-canvas'); const e = c.querySelector('.mf[data-id="${id}"] .mf-titlebar-title'); const t = e.getBoundingClientRect(); const r = c.getBoundingClientRect(); const x = t.left + 4; const y = t.top + t.height / 2; return { x, y, ex: r.right - 6, ey: r.top + r.height / 2, hit: e.contains(document.elementFromPoint(x, y)) }; })()`);
          if (!p.hit) fail(`panel stacking: ${id}'s title is not what is under the point the drag starts from`);
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
          // First past the 6px threshold while still on the title bar (it lifts on its own moves, as a real pointer's first steps are), then away.
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + 10, y: p.y, button: 'left', buttons: 1 });
          for (const k of [0.3, 0.6, 1]) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + (p.ex - p.x) * k, y: p.y + (p.ey - p.y) * k, button: 'left', buttons: 1 });
          await sleep(100);
          const r = await tab.eval(`({ line: document.querySelectorAll('#pps-limit .pps-line').length, lifted: document.querySelectorAll('#pps-limit .pps-lifted').length })`);
          await tab.eval(`document.querySelector('#pps-limit .mf[data-id="${id}"] .mf-titlebar').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.ex, y: p.ey, button: 'left', clickCount: 1 });
          await tab.eval(`document.querySelector('#pps-limit .pps-bar .btn').click()`);
          await sleep(100);
          return r;
        };
        const refused = await lineFor('polls');
        const allowed = await lineFor('planner');
        if (!refused.lifted || !allowed.lifted) fail(`panel stacking: the title bar drag did not start (${refused.lifted}, ${allowed.lifted}); the refused line is not measured`);
        if (refused.line) fail('panel stacking: a drop that would be refused (a third column does not fit) draws a line');
        if (!allowed.line) fail('panel stacking: a drop that is allowed draws no line, so the refused case measures nothing');
        say(`Panel stacking: a refused drop draws ${refused.line} line(s), an allowed one ${allowed.line}`);
      } finally { await tab.close(); }
    }
    if (!process.argv.includes('--skip-maps')) await checkMaps(browser, server);
  } finally {
    if (browser) { try { browser.child.kill('SIGTERM'); } catch { /* gone */ } }
    if (server) await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  if (failures.length) { console.error(`check-prototype-page: ${failures.length} failure(s)`); process.exit(1); }
  say('OK');
}

// ---- 6. Maps: the map themes and Map options (plan-map-options.md, step 0) ----
async function checkMaps(browser, server) {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const lib = new Function(`${read('modules/maps/src/maps-lib-d-style.js')}\nreturn { guardMap, MAP_MIN };`)();
  const copy = read('public/design-system/prototype-maps.js').match(/export const MAP_MIN = (\{[^}]*\});/);
  const theirs = copy ? Function(`return (${copy[1]});`)() : null;
  if (!theirs) fail('maps: no MAP_MIN copy in public/design-system/prototype-maps.js');
  else if (JSON.stringify(theirs) !== JSON.stringify(lib.MAP_MIN)) fail(`maps: the Prototype's MAP_MIN (${JSON.stringify(theirs)}) is not the module's (${JSON.stringify(lib.MAP_MIN)})`);
  const screen = async (w, hgt, query) => {
    const tab = new Tab(browser.cdp, {});
    await tab.open(w, new URLSearchParams(query).get('mode') === 'light' ? 'light' : 'dark'); // the screenshot prelude holds the page to this mode
    const send = (m, p) => browser.cdp.send(m, p, tab.sid);
    const errors = [];
    const hook = (m) => { if (m.sessionId === tab.sid && (m.method === 'Runtime.exceptionThrown' || (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error'))) errors.push(JSON.stringify(m.params).slice(0, 200)); };
    browser.cdp.listeners.push(hook);
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${server.base}/design-system/map-screen.html?${query}` });
    let ok = false;
    for (let i = 0; i < 100 && !ok; i += 1) { ok = await tab.eval('document.documentElement.dataset.ready === "1"').catch(() => false); if (!ok) await sleep(150); }
    await sleep(300);
    const done = async () => { browser.cdp.listeners = browser.cdp.listeners.filter((f) => f !== hook); await tab.close(); };
    return { tab, send, ok, errors, done };
  };
  const key = (k) => ({ type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: k === 'Escape' ? 27 : 0 });
  // b, c: the colours and their numbers
  const seen = {};
  for (const theme of ['strong-coffee', 'calming-teal']) {
    for (const map of ['light', 'dark']) {
      for (const mode of ['dark', 'light']) {
        const label = `maps ${map} map, ${theme} ${mode}`;
        const s = await screen(900, 560, `theme=${theme}&mode=${mode}&map=${map}&scene=map&edge=map`); // the pins as recommended (question 2)
        try {
          if (!s.ok) { fail(`${label}: the map screen did not draw`); continue; }
          for (const e of s.errors) fail(`${label}: an error on the page (${e})`);
          const m = await s.tab.eval('window.mapMeasure()');
          if (m.map !== map) fail(`${label}: the screen drew the ${m.map} map`);
          const sig = JSON.stringify(m.colours);
          if (seen[map] && seen[map] !== sig) fail(`${label}: the map's colours differ from another app theme's (a map theme is the same under every app theme)`);
          seen[map] = seen[map] || sig;
          const out = lib.guardMap(m.colours, m.tok);
          const moved = Object.keys(m.colours).filter((k) => JSON.stringify(m.colours[k]) !== JSON.stringify(out[k]));
          if (moved.length) fail(`${label}: the clamp (guardMap) moves ${moved.join(', ')}; a shipped map theme holds MAP_MIN on its own`);
          const r = m.ratios; const N = lib.MAP_MIN;
          for (const [k, need] of [['label', N.label], ['labelWater', N.labelWater], ['city', N.label], ['cityWater', N.labelWater], ['region', N.label], ['regionWater', N.labelWater], ['roadMinor', N.roadMinor], ['roadMedium', N.roadMedium], ['roadMajor', N.roadMajor], ['water', N.water], ['park', N.park], ['wood', N.wood], ['building', N.building], ['boundary', N.boundary], ['results', 4.5]]) {
            if (!(r[k] >= need)) fail(`${label}: ${k} is ${r[k].toFixed(2)}:1 (needs ${need})`);
          }
          for (const [name, p] of [['a pin', m.pin], ['the selected pin', m.selected]]) {
            if (!p) { fail(`${label}: no ${name} to measure`); continue; }
            if (!(Math.max(p.edge, p.ring, name === 'a pin' ? 0 : p.fill) >= 3)) fail(`${label}: ${name}'s edge (${p.edge.toFixed(2)}) and ring (${p.ring.toFixed(2)}) are under 3:1 on the land`);
            if (!(p.name >= 4.5)) fail(`${label}: ${name}'s name is ${p.name.toFixed(2)}:1 on its chip`);
          }
          if (theme === 'strong-coffee') say(`Maps ${map} map, ${mode} app theme: names ${r.label.toFixed(2)} on land, ${r.labelWater.toFixed(2)} on water; towns ${r.city.toFixed(2)}/${r.cityWater.toFixed(2)}; regions ${r.region.toFixed(2)}/${r.regionWater.toFixed(2)}; roads ${r.roadMinor.toFixed(2)}, ${r.roadMedium.toFixed(2)}, ${r.roadMajor.toFixed(2)}; water ${r.water.toFixed(2)}; pin edge ${m.pin.edge.toFixed(2)}, ring ${m.pin.ring.toFixed(2)}; selected pin edge ${m.selected.edge.toFixed(2)}, fill ${m.selected.fill.toFixed(2)}; results ${r.results.toFixed(2)}; clamp moves ${moved.length}`);
        } finally { await s.done(); }
      }
    }
  }
  // d, e, f: the menu, the panel, the keyboard
  {
    const s = await screen(900, 560, 'theme=strong-coffee&mode=dark&map=default&scene=map');
    try {
      if (!s.ok) fail('maps: the map screen did not draw for the menu');
      else {
        await s.tab.click('.mf-titlebar-menu');
        await sleep(300);
        const items = await s.tab.eval(`[...document.querySelectorAll('.host-menu .host-menu-item')].map((b) => b.textContent.trim())`);
        if (items[0] !== 'Map options') fail(`maps: the "..." menu does not start with Map options (${items.join(', ')})`);
        await s.tab.click('.host-menu .host-menu-item', 'Map options');
        await sleep(300);
        const st = await s.tab.eval(`(() => { const sr = document.querySelector('.ms-host').shadowRoot; const p = sr.querySelector('.mo-pop'); const a = sr.activeElement; return { open: !!p && !p.hidden, focus: a ? (a.value || a.className) : null, title: p ? p.querySelector('.mo-title').textContent : '', words: p ? [...p.querySelectorAll('.sdk-choice-label')].map((x) => x.textContent) : [] }; })()`);
        if (!st.open) fail('maps: Map options did not open the panel');
        if (st.focus !== 'default') fail(`maps: the panel opened with the focus on ${st.focus}, not the chosen theme`);
        if (st.title !== 'Map options' || st.words.join('|') !== 'Theme default|Light|Dark') fail(`maps: the panel's words are ${st.title}: ${st.words.join(', ')}`);
        const before = await s.tab.eval('window.mapMeasure().colours.land.join()');
        await s.tab.click('.ms-host >>> .sdk-choice-row[data-choice="dark"]');
        await sleep(300);
        const after = await s.tab.eval(`({ land: window.mapMeasure().colours.land.join(), theme: document.querySelector('.ms-host').shadowRoot.getElementById('map').dataset.mapTheme })`);
        if (after.theme !== 'dark' || after.land === before) fail(`maps: choosing Dark did not redraw the map (${after.theme}, land ${before} to ${after.land})`);
        await s.send('Input.dispatchKeyEvent', key('Escape'));
        await s.send('Input.dispatchKeyEvent', { ...key('Escape'), type: 'keyUp' });
        await sleep(300);
        const esc = await s.tab.eval(`({ open: !document.querySelector('.ms-host').shadowRoot.querySelector('.mo-pop').hidden, focus: document.activeElement && document.activeElement.classList.contains('mf-titlebar-menu') })`);
        if (esc.open) fail('maps: Escape did not close the panel');
        if (!esc.focus) fail('maps: after Escape the focus is not back on "..."');
        await s.tab.click('.mf-titlebar-menu'); await sleep(200);
        await s.tab.click('.host-menu .host-menu-item', 'Map options'); await sleep(300);
        await s.tab.mouse('mousePressed', 200, 400); await s.tab.mouse('mouseReleased', 200, 400); await sleep(300);
        if (await s.tab.eval(`!document.querySelector('.ms-host').shadowRoot.querySelector('.mo-pop').hidden`)) fail('maps: a click outside did not close the panel');
        say(`Maps menu and panel: ${items.join(', ')}; opened with the focus on ${st.focus}; Dark redraws; Escape and a click outside close it`);
      }
    } finally { await s.done(); }
  }
  // j: the held "..." menu is over everything, the pins too (the drawing at 390, and the wider one)
  for (const [mode, w, hgt] of [['dark', 390, 760], ['light', 390, 760], ['dark', 700, 420], ['light', 700, 420]]) {
    const s = await screen(w, hgt, `theme=strong-coffee&mode=${mode}&map=default&scene=menu`);
    try {
      if (!s.ok) { fail(`maps menu ${w} ${mode}: the screen did not draw`); continue; }
      const r = await s.tab.eval(`(() => { const m = document.querySelector('.host-menu.ms-menu-open'); m.inert = false; // the held copy is inert; a hit test skips an inert node
        const items = [...m.querySelectorAll('.host-menu-item')]; const bad = [];
        for (const it of items) { const b = it.getBoundingClientRect(); const x = b.left + b.width / 2; const y = b.top + b.height / 2; const hit = document.elementFromPoint(x, y); if (!hit || !m.contains(hit)) bad.push(it.textContent.trim() + ' hit ' + (hit ? hit.tagName + '.' + hit.className : 'nothing')); }
        m.inert = true; return { n: items.length, bad }; })()`);
      if (r.n < 2) fail(`maps menu ${w} ${mode}: only ${r.n} items in the held menu; the check measures the wrong thing`);
      for (const b of r.bad) fail(`maps menu ${w} ${mode}: an item of the held menu is under something else (${b})`);
      say(`Maps held menu at ${w} (${mode}): ${r.n} items, ${r.bad.length} covered`);
    } finally { await s.done(); }
  }
  // k: every place name sits whole inside the map, and so does every pin and its chip (the themes drawings, at three widths)
  for (const [w, hgt] of [[1280, 640], [900, 560], [390, 760]]) {
    for (const [mode, map] of [['dark', 'light'], ['light', 'dark']]) {
      const s = await screen(w, hgt, `theme=strong-coffee&mode=${mode}&map=${map}&scene=map&edge=map`);
      try {
        if (!s.ok) { fail(`maps names ${w}: the screen did not draw`); continue; }
        const r = await s.tab.eval(`(() => { const sr = document.querySelector('.ms-host').shadowRoot; const m = sr.getElementById('map').getBoundingClientRect(); const out = [];
          const names = [...sr.querySelectorAll('.ms-name')];
          for (const e of names) { const b = e.getBoundingClientRect(); if (b.left < m.left - 0.5 || b.right > m.right + 0.5 || b.top < m.top - 0.5 || b.bottom > m.bottom + 0.5) out.push('name ' + e.textContent); }
          const pins = [...sr.querySelectorAll('.ms-pins .pin')];
          for (const e of pins) for (const n of [e, ...e.querySelectorAll('*')]) { const b = n.getBoundingClientRect(); if (!b.width) continue; if (b.left < m.left - 0.5 || b.right > m.right + 0.5 || b.top < m.top - 0.5 || b.bottom > m.bottom + 0.5) { out.push('pin ' + (e.getAttribute('aria-label') || e.textContent)); break; } }
          return { names: names.length, pins: pins.length, out }; })()`);
        if (r.names < 8) fail(`maps names ${w}: only ${r.names} names; the check measures the wrong thing`);
        for (const o of r.out) fail(`maps names ${w} ${mode}: ${o} reaches past the map's edge`);
        say(`Maps names at ${w} (${map} map): ${r.names} names, ${r.pins} pins, ${r.out.length} past the edge`);
      } finally { await s.done(); }
    }
  }
  // g: 44px taps at a real 390 viewport; h: the picture map
  for (const [mode, scene] of [['dark', 'options'], ['light', 'later'], ['dark', 'guest']]) {
    const s = await screen(390, 760, `theme=strong-coffee&mode=${mode}&map=default&scene=${scene}`);
    try {
      if (!s.ok) { fail(`maps 390 ${scene}: the screen did not draw`); continue; }
      const r = await s.tab.eval(`(() => { const sr = document.querySelector('.ms-host').shadowRoot; const p = sr.querySelector('.mo-pop'); const pr = p.getBoundingClientRect(); const short = []; let n = 0;
        for (const e of p.querySelectorAll('.sdk-choice-row, .mo-close, .mf-switch-btn')) { const b = e.getBoundingClientRect(); if (!b.height) continue; n += 1; const after = parseFloat(getComputedStyle(e, '::after').height) || 0; if (b.height < 43.5 && after < 43.5) short.push((e.textContent.trim() || e.getAttribute('aria-label')) + ' ' + Math.round(b.height)); }
        return { n, short, left: pr.left, right: pr.right, vw: innerWidth, sw: document.documentElement.scrollWidth }; })()`);
      if (r.n < 4) fail(`maps 390 ${scene}: only ${r.n} controls in the panel; the check measures the wrong thing`);
      for (const x of r.short) fail(`maps 390 ${scene}: a control in the panel is under 44px (${x})`);
      if (r.left < 0 || r.right > r.vw || r.sw > r.vw) fail(`maps 390 ${scene}: the panel or the page reaches past the screen (${Math.round(r.left)} to ${Math.round(r.right)}, page ${r.sw})`);
      say(`Maps panel at 390 (${scene}, ${mode}): ${r.n} controls, ${r.short.length} short`);
    } finally { await s.done(); }
  }
  {
    const s = await screen(900, 560, 'theme=strong-coffee&mode=dark&map=default&scene=picture');
    try {
      const r = await s.tab.eval(`(() => { const p = document.querySelector('.ms-host').shadowRoot.querySelector('.mo-pop'); return { note: (p.querySelector('.mo-note') || {}).textContent, radios: p.querySelectorAll('input[type=radio]').length }; })()`);
      if (r.note !== 'A picture map keeps its own colours.' || r.radios) fail(`maps: a picture map's panel shows "${r.note}" and ${r.radios} choices`);
    } finally { await s.done(); }
  }
  // i: the section on the Prototype page
  {
    const tab = new Tab(browser.cdp, {});
    await tab.open(1280, 'dark');
    try {
      await browser.cdp.send('Page.navigate', { url: `${server.base}/design-system/prototype.html?theme=strong-coffee&mode=dark&w=700` }, tab.sid);
      for (let i = 0; i < 100; i += 1) { if (await tab.eval(`!!document.getElementById('pp-maps') && !!document.querySelector('.pp-dock')`).catch(() => false)) break; await sleep(150); }
      const jumps = await tab.eval(`[...document.querySelectorAll('nav[aria-label="Jump to a part of Maps"] button')].map((b) => b.textContent)`);
      if (jumps.length < 6) fail(`maps: the section's jump list has ${jumps.length} buttons`);
      const page = await tab.eval(`[...document.querySelectorAll('nav[aria-label="Jump to a section of the page"] button')].some((b) => b.textContent === 'Maps')`);
      if (!page) fail('maps: the page\'s jump list has no Maps');
      await tab.eval(`document.getElementById('mp-themes').scrollIntoView()`);
      let ready = false;
      for (let i = 0; i < 100 && !ready; i += 1) { ready = await tab.eval(`(() => { const f = window.mapsSection && window.mapsSection.frames[0]; return !!f && f.ready && !!f.out.querySelector('table'); })()`); if (!ready) await sleep(150); }
      if (!ready) fail('maps: the first map of the section did not draw its numbers');
      say(`Maps section: ${jumps.length} parts (${jumps.join(', ')}), the first map drawn with its numbers`);
    } finally { await tab.close(); }
  }
}

main().then((mapsOnly) => {
  if (!mapsOnly) return;
  if (failures.length) { console.error(`check-prototype-page: ${failures.length} failure(s)`); process.exit(1); }
  say('OK (Maps only)');
}).catch((err) => { console.error(`check-prototype-page: ${err.stack || err.message}`); process.exit(1); });
