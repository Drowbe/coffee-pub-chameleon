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
 *      tall or has a 44px tap area.
 *   3. Light. Scrolling the whole Vault section top to bottom, then stopping at twelve places: panels live at any time stay at or
 *      under LIVE_MAX (the cap is 8 plus the ones on the screen); the median of three runs' longest task is under LONG_MS (the goal is 200 ms
 *      on a laptop; this 4-core box measures near 1 s, so the limit is what a regression to about 1.3 s would break); the section scrolls in
 *      under SCROLL_MS; the nodes left are under NODES_MAX. (Measured at the time of writing: about 2 s, 8,600 nodes, against 33 s, tasks up to
 *      6 s and 43,000 nodes when every panel stayed drawn.)
 *   4. No sideways scroll. At 390, 500 and 700 the Prototype page is no wider than the window (the Phone section's switches once made it 783px wide).
 *   5. The phone screen's bottom bar (phone.html at 390 and 360, dark and light; Thomas, 2026-11-03, QA's cases): a sheet or dialog open puts the top
 *      bar, view, strip and bar out of reach (inert) and the focus inside it; Esc steps back one level (Replace to Edit the four to More to none) and the
 *      focus returns to the control that opened each, never the page; a sheet's title is at least the body's size; the space's name is not cut in the
 *      call; every bar and strip control is 56 by 56 or more; a place's count is gone while it is open; the Prototype's Switcher starts at Both and the
 *      two frames share the pins.
 * Usage: node tools/check-prototype-page.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findBrowser, launch, freePort, startServer, stopServer, Tab, sleep, decodePng } from './shots.mjs';

const LIVE_MAX = 12; // the cap is 8; a few more may be on the screen at once
const LONG_MS = 1000; // the median of three runs' longest task; the goal is 200 ms on a laptop (a held menu or a window opening is 150 to 350 ms)
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

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

    // Light: scroll the whole Vault section, then stop in twelve places. Three runs each; the long-task limit is on the median.
    for (const size of [1280, 390]) {
      const runs = [];
      for (let k = 0; k < 3; k += 1) {
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
      const r0 = runs[0];
      say(`Vault at ${size}: ${r0.frames} panels, scroll ${runs.map((m) => m.scrollMs).join(', ')} ms, most live ${Math.max(...runs.map((m) => m.max))}, live at the end ${Math.max(...runs.map((m) => m.live))}, nodes ${r0.nodesBefore} to ${Math.max(...runs.map((m) => m.nodes))}, longest task median ${med} ms (runs ${runs.map((m) => m.longest).join(', ')} ms; ${runs.map((m) => m.over200).join(', ')} over 200 ms)`);
      for (const m of runs) {
        if (m.frames < 60) fail(`${size}: the Vault section has only ${m.frames} panels; the check measures the wrong thing`);
        if (m.max > LIVE_MAX) fail(`${size}: ${m.max} panels were drawn at once (the limit is ${LIVE_MAX})`);
        if (m.live > LIVE_MAX) fail(`${size}: ${m.live} panels stay drawn after the scroll (the limit is ${LIVE_MAX})`);
        if (m.scrollMs > SCROLL_MS) fail(`${size}: scrolling the whole section took ${m.scrollMs} ms (the limit is ${SCROLL_MS})`);
        if (m.nodes > NODES_MAX) fail(`${size}: ${m.nodes} nodes are left in the page (the limit is ${NODES_MAX})`);
      }
      if (med > LONG_MS) fail(`${size}: the median of three runs' longest task is ${med} ms (the limit is ${LONG_MS})`);
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
