// check-call-bars.mjs: the call's title bar and toolbar lie over the tiles, so showing and hiding them never
// changes a tile's size (measured in the running product: headless Chromium, the screenshot seed, the call's client library
// replaced by tools/shots-livekit-stub.mjs). For 2 and 4 people in the call it pops the call out into a window of its own and records
// every tile's box while the bars are brought up and sent away: a pointer move, the idle wait, the window's blur and focus,
// the keyboard on a toolbar button (focus-within). Every box must be the same in every state, the bars must be out of the
// flow (position absolute or fixed), they must really be shown and hidden, and a mousemove that does not move the pointer
// (what Chromium sends after a layout change under a resting pointer) must not bring them back.
// It also looks at the call's own title bar in the column (plan-workspaces.md, decisions 15, 16, 18, 28): drawn with no call,
// Start call on it and no large one in the column (it belongs to a call that fills an area of its own), Chat's menu with nothing of the call, and on the call the collapsed
// rail's icon with its dot and its name. And at the Conference layout (step 4): the large Start call there and only there,
// the call filling the page beside the chat at the width the chat had, and the call staying on across the Workspace and back.
// And the call's controls through a pop-out (runPopout): before, in the popup, after the window is closed, after Bring the call back.
// Usage: node tools/check-call-bars.mjs. With no Chromium it says SKIPPED and exits 0 (a skip, never a pass).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

const say = (...a) => console.log('check-call-bars:', ...a);
const failures = [];
const IDLE_WAIT_MS = 4000; // longer than the call's idle delay (space.js, CHROME_IDLE_MS)

// In the opener (the space page): the call's own window, found by its name (canvas.js, openBuiltinWindow).
const POPOUT = `window.open('', 'app-conference')`;
const MEASURE = `(() => { const w = ${POPOUT}; const d = w.document;
  const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10).join(','); };
  const head = d.querySelector('.conference-head'); const bar = d.querySelector('.video-bar'); const top = d.querySelector('.topbar');
  const shown = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.bottom > 1 && r.top < w.innerHeight - 1 && w.getComputedStyle(e).visibility !== 'hidden' && Number(w.getComputedStyle(e).opacity) > 0.05; };
  return { popped: d.body.classList.contains('conference-window'), idle: Boolean(d.querySelector('.canvas.idle')),
    tiles: [...d.querySelectorAll('#grid .tile')].map(box), grid: box(d.getElementById('grid')),
    pos: { head: head && w.getComputedStyle(head).position, bar: bar && w.getComputedStyle(bar).position, top: top && w.getComputedStyle(top).position },
    shown: { head: shown(head), bar: shown(bar) } }; })()`;
// Events dispatched in the popped-out window, as a person's would arrive there.
const ev = (js) => `(() => { const w = ${POPOUT}; const d = w.document; ${js}; return true; })()`;
// A mousemove at the screen position of the last real one (the window sits at an offset on the screen, so screen is not client).
const WATCH = ev(`d.addEventListener('mousemove', (e) => { w.__lastReal = { cx: e.clientX, cy: e.clientY, sx: e.screenX, sy: e.screenY }; }, true)`);
const REPEAT = ev(`const r = w.__lastReal; if (!r) throw new Error('no real mousemove seen'); d.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: r.cx, clientY: r.cy, screenX: r.sx, screenY: r.sy }))`);

async function run(browser, S, people) {
  const tab = new Tab(browser.cdp, S.ctx);
  await tab.open(1280, 'light', true);
  const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
  const states = [];
  try {
    await tab.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('shots.call.people', '${people - 1}'); } catch (e) {}` }, tab.sid);
    await driveScreen(tab, { id: 'call', as: 'mia', url: '/#join={trip}', wait: 'button.sdk-strip-fact[data-module=budget]', call: true, steps: [{ click: '#join-call' }] }, S.base, S.cookies, S.ctx);
    const end = Date.now() + 15000;
    while (Date.now() < end && (await tab.eval(`document.querySelectorAll('#grid .tile').length`)) < people) await sleep(200);
    // Pop the call out, as its title bar's button does (a click is a user gesture, so the window is not blocked).
    await tab.cdp.send('Runtime.evaluate', { expression: `document.getElementById('call-head-popout').click()`, userGesture: true }, tab.sid);
    const end2 = Date.now() + 10000;
    while (Date.now() < end2 && !(await tab.eval(`(() => { try { const w = ${POPOUT}; return w.document.body.classList.contains('conference-window') && w.document.querySelectorAll('#grid .tile').length >= ${people}; } catch (e) { return false; } })()`))) await sleep(200);
    await sleep(800);
    // The window's own page, for real input there: the pointer and the keyboard as a person's arrive.
    const { targetInfos } = await tab.cdp.send('Target.getTargets');
    const target = targetInfos.find((t) => t.type === 'page' && t.url.endsWith('/popout.html') && t.browserContextId === tab.contextId);
    if (!target) throw new Error('the call\'s window was not found');
    const { sessionId } = await tab.cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const input = (m, p) => tab.cdp.send(m, p, sessionId);
    const move = (x, y) => input('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
    const key = async (k, code) => { await input('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code }); await input('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code }); };
    const record = async (name) => { const m = await tab.eval(MEASURE); states.push({ name, ...m }); return m; };
    const barAt = async () => tab.eval(`(() => { const r = ${POPOUT}.document.querySelector('.video-bar').getBoundingClientRect(); return { x: Math.round(r.x + 6), y: Math.round(r.y + r.height / 2) }; })()`);
    await tab.eval(WATCH);
    await move(200, 150); await sleep(500); await record('pointer moved');
    await sleep(IDLE_WAIT_MS); await record('idle');
    // A mousemove at the same place, as Chromium sends after a layout change under a resting pointer: not a movement.
    await tab.eval(REPEAT); await sleep(500); await record('mousemove that does not move');
    await move(240, 160); await sleep(500); await record('pointer moved again');
    await tab.eval(ev(`w.dispatchEvent(new w.FocusEvent('blur'))`)); await sleep(500); await record('window blur');
    await tab.eval(ev(`w.dispatchEvent(new w.FocusEvent('focus'))`)); await sleep(500); await record('window focus');
    await sleep(IDLE_WAIT_MS); await record('idle again');
    const at = await barAt();
    await move(at.x, at.y); await sleep(IDLE_WAIT_MS); await record('pointer resting on the toolbar');
    await move(240, 160); await sleep(IDLE_WAIT_MS); await record('idle, pointer resting on the tiles');
    // The keyboard: Tab until the focus is on a toolbar button (focus-within), and it stays up while the focus is there.
    for (let i = 0; i < 30 && !(await tab.eval(`(() => { const d = ${POPOUT}.document; return Boolean(d.activeElement && d.activeElement.closest('.video-bar, .conference-head')); })()`)); i++) await key('Tab', 9);
    await sleep(500); await record('keyboard on a bar (focus-within)');
    await sleep(IDLE_WAIT_MS); await record('focus-within, after the idle wait');
    await tab.eval(ev(`d.activeElement && d.activeElement.blur()`));
    await sleep(IDLE_WAIT_MS); await record('idle, focus gone');
    await tab.eval(ev(`d.dispatchEvent(new w.TouchEvent('touchstart', { bubbles: true }))`)); await sleep(500); await record('touch');
  } finally { await tab.close(); }
  const name = `${people} tiles`;
  if (!states.length || !states[0].popped) { failures.push(`${name}: the call did not pop out, so nothing was measured`); return; }
  const first = states[0];
  if (first.tiles.length < people) failures.push(`${name}: ${first.tiles.length} tiles in the popped-out window, wanted ${people}`);
  for (const s of states) {
    say(`${name}, ${s.name}: ${s.idle ? 'idle' : 'awake'}; bars ${s.shown.head ? 'shown' : 'hidden'}/${s.shown.bar ? 'shown' : 'hidden'}; position ${s.pos.head}/${s.pos.bar}; tiles ${s.tiles.join(' | ')}`);
    if (s.tiles.join('|') !== first.tiles.join('|')) failures.push(`${name}, ${s.name}: the tiles moved or changed size (${s.tiles.join(' | ')}; first ${first.tiles.join(' | ')})`);
    for (const k of ['head', 'bar']) if (!['absolute', 'fixed'].includes(s.pos[k])) failures.push(`${name}, ${s.name}: the call's ${k === 'head' ? 'title bar' : 'toolbar'} is in the flow (position ${s.pos[k]}), so it takes height from the tiles`);
  }
  const want = { 'pointer moved': true, idle: false, 'mousemove that does not move': false, 'pointer moved again': true, 'window blur': true, 'window focus': true, 'idle again': false, 'pointer resting on the toolbar': true, 'idle, pointer resting on the tiles': false, 'keyboard on a bar (focus-within)': true, 'focus-within, after the idle wait': true, 'idle, focus gone': false, touch: true };
  for (const s of states) if (s.name in want && (s.shown.head !== want[s.name] || s.shown.bar !== want[s.name])) failures.push(`${name}, ${s.name}: the bars are ${s.shown.head ? 'shown' : 'hidden'}/${s.shown.bar ? 'shown' : 'hidden'}, wanted ${want[s.name] ? 'shown' : 'hidden'}`);
}

// The call's own area (the column) with no call, on a call, and collapsed. Pure reading of the page; no pop-out.
async function runArea(browser, S) {
  const tab = new Tab(browser.cdp, S.ctx);
  await tab.open(1280, 'light', true);
  const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
  const box = (id) => `(() => { const e = document.getElementById('${id}'); if (!e) return null; const r = e.getBoundingClientRect(); return { shown: !e.hidden && r.width > 0 && r.height > 0, w: Math.round(r.width), h: Math.round(r.height), label: e.getAttribute('aria-label'), parent: e.parentElement && e.parentElement.id } })()`;
  const items = `[...document.querySelectorAll('[role=menu] [role=menuitem], [role=menu] [role=menuitemradio]')].map((e) => e.textContent.trim())`;
  try {
    await driveScreen(tab, { id: 'area', as: 'mia', url: '/#join={trip}', wait: 'button.sdk-strip-fact[data-module=budget]', call: true, steps: [] }, S.base, S.cookies, S.ctx);
    const head = await tab.eval(box('call-head')); const join = await tab.eval(box('join-call')); const big = await tab.eval(box('call-start')); const empty = await tab.eval(box('call-empty'));
    if (!head?.shown) failures.push('no call: the call\'s title bar is not drawn (decision 15)');
    if (!join?.shown || join.parent !== 'call-head-tools' || join.label !== 'Start call') failures.push(`no call: Start call is not on the call's title bar (${JSON.stringify(join)})`);
    if (big?.shown || empty?.shown) failures.push(`no call: the large Start call must not show in the side column (${JSON.stringify([big, empty])})`);
    const strip = await tab.eval(box('side-column-strip'));
    if (strip?.shown && strip.h > 2) failures.push(`no call: an empty call band is left under the title bar (${JSON.stringify(strip)})`);
    if ((await tab.eval(`(document.getElementById('call-head-name') || {}).textContent`)) !== 'Call') failures.push('no call: the title bar does not read Call');
    // The call's menu holds the call items; Chat's holds only the chat's.
    await tab.click('#call-more'); await sleep(300);
    const callMenu = await tab.eval(items);
    await tab.click('#call-more'); await sleep(300);
    for (const want of ['Pop out the call', 'Call position']) if (!callMenu.includes(want)) failures.push(`no call: the call's menu lacks "${want}" (${callMenu.join(' / ')})`);
    await tab.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(200);
    await tab.click('#chat-more'); await sleep(300);
    const chatMenu = await tab.eval(items);
    if (chatMenu.some((l) => /call/i.test(l)) || !chatMenu.includes('Save the chat')) failures.push(`Chat's menu has something of the call, or lacks Save the chat (${chatMenu.join(' / ')})`);
    await tab.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(200);
    say(`no call: title bar, Start call (${join?.w}px, in the bar), no large one (${big?.shown ? 'SHOWN' : 'hidden'}), strip ${strip?.h}px; call menu: ${callMenu.join(' / ')}; chat menu: ${chatMenu.join(' / ')}`);
    // Collapsed, no call: the call's icon beside the chat's, no dot; pressing it opens the column and starts nothing.
    await tab.click('#side-column-toggle'); await sleep(400);
    const rail = await tab.eval(box('side-column-rail-call')); const dot0 = await tab.eval(box('side-column-rail-call-dot'));
    if (!rail?.shown || rail.label !== 'Show the call' || dot0?.shown) failures.push(`collapsed, no call: the rail's call icon is not there named "Show the call" without a dot (${JSON.stringify(rail)} ${JSON.stringify(dot0)})`);
    await tab.click('#side-column-rail-call'); await sleep(500);
    if (await tab.eval(`document.getElementById('side-column').classList.contains('collapsed') || document.getElementById('side-column').classList.contains('in-call')`)) failures.push('the rail\'s call icon did not open the column, or it started a call');
    // On the call: the title bar loses Start call and the large one; collapsed, the dot and the name.
    await tab.click('#join-call');
    const end = Date.now() + 10000;
    while (Date.now() < end && !(await tab.eval(`document.getElementById('side-column').classList.contains('in-call')`))) await sleep(200);
    await sleep(500);
    const j2 = await tab.eval(box('join-call')); const e2 = await tab.eval(box('call-empty')); const pop = await tab.eval(box('call-head-popout'));
    if (j2?.shown || e2?.shown || !pop?.shown) failures.push(`on the call: Start call and the large button should be gone and Pop out shown (${JSON.stringify([j2, e2, pop])})`);
    await tab.click('#side-column-toggle'); await sleep(400);
    const rail2 = await tab.eval(box('side-column-rail-call')); const dot1 = await tab.eval(box('side-column-rail-call-dot'));
    if (!rail2?.shown || !dot1?.shown || !/in a call/.test(rail2.label || '')) failures.push(`collapsed, on the call: the rail's call icon should show its dot and say it in its name (${JSON.stringify(rail2)} ${JSON.stringify(dot1)})`);
    // The keyboard: Tab from the handle reaches the icon through the chat's.
    await tab.eval(`document.getElementById('side-column-toggle').focus()`);
    const seen = [];
    for (let i = 0; i < 4; i++) { await tab.key('Tab'); await sleep(100); seen.push(await tab.eval(`document.activeElement && document.activeElement.id`)); }
    if (!seen.includes('side-column-rail-call')) failures.push(`the rail's call icon is not in the tab order (${seen.join(', ')})`);
    say(`collapsed on the call: icon named "${rail2?.label}", dot ${dot1?.shown ? 'shown' : 'hidden'}; tab order ${seen.join(', ')}`);
  } finally { await tab.close(); }
}

// The Conference layout (plan-workspaces.md, step 4): its tab hides the canvas and the call fills the page beside the chat,
// which keeps the width it had. With no call the large Start call shows there (and only there); it presses the title bar's
// own button. Switching to the Workspace and back never hangs up. The call is the stub's: a real one is not tried here.
async function runConference(browser, S) {
  const tab = new Tab(browser.cdp, S.ctx);
  await tab.open(1280, 'light', true);
  const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
  const M = `(() => { const r = (id) => { const e = document.getElementById(id); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), shown: !e.hidden && b.width > 0 && b.height > 0 }; };
    const col = document.getElementById('side-column');
    return { view: document.body.classList.contains('view-conference'), page: col.classList.contains('call-page'), inCall: col.classList.contains('in-call'), win: innerWidth, column: r('side-column'), chat: r('side-column-chat'), head: r('call-head'),
      empty: r('call-empty'), start: r('call-start'), startLabel: (document.getElementById('call-start-label') || {}).textContent, note: (document.getElementById('call-empty-note') || {}).textContent, strip: r('side-column-strip'), grid: r('grid'), canvas: r('canvas'), toggle: r('side-column-toggle'),
      tiles: document.querySelectorAll('#grid .tile').length, join: r('join-call'), joinParent: (document.getElementById('join-call')?.parentElement || {}).id, tab: (document.querySelector('[data-layout-tab][aria-current=page]') || { dataset: {} }).dataset.layoutTab,
      wider: document.documentElement.scrollWidth - innerWidth }; })()`;
  const items = `[...document.querySelectorAll('[role=menu] [role=menuitem], [role=menu] [role=menuitemradio]')].map((e) => e.textContent.trim())`;
  // A press on a layout tab, then the page as the press leaves it: the tab marked as shown and the Conference layout on or
  // off with it (both are set in the press itself), waited for rather than timed, then a moment for the modules to draw.
  // `quick`: no waiting at all, only that many milliseconds, for the round trips a person makes in a hurry.
  const tabState = `(() => ({ tab: (document.querySelector('[data-layout-tab][aria-current=page]') || { dataset: {} }).dataset.layoutTab || '', view: document.body.classList.contains('view-conference') }))()`;
  const press = async (id, quick = null) => {
    await tab.eval(`document.querySelector('[data-layout-tab="${id}"]').click()`);
    if (quick !== null) { await sleep(quick); return; }
    const end = Date.now() + 8000;
    let now = null;
    while (Date.now() < end) { now = await tab.eval(tabState); if (now.tab === id && now.view === (id === 'conference')) break; await sleep(100); }
    if (!now || now.tab !== id || now.view !== (id === 'conference')) failures.push(`the ${id} tab was pressed and 8 seconds later the page shows ${JSON.stringify(now)}`);
    await sleep(900);
  };
  // The page settled on a layout: the same answer three times, 400ms apart (a late change would show between them).
  const settled = async (id) => {
    let same = 0;
    const end = Date.now() + 12000;
    while (Date.now() < end && same < 3) { const now = await tab.eval(tabState); same = now.tab === id && now.view === (id === 'conference') ? same + 1 : 0; await sleep(400); }
    await sleep(1500); // and past the moment a module the Workspace opened would ask for another
    return tab.eval(M);
  };
  const waitCall = async (on) => { const end = Date.now() + 10000; while (Date.now() < end && (await tab.eval(`document.getElementById('side-column').classList.contains('in-call')`)) !== on) await sleep(200); await sleep(700); };
  const near = (a, b, by = 2) => Math.abs(a - b) <= by;
  try {
    await driveScreen(tab, { id: 'conference', as: 'mia', url: '/#join={trip}', wait: 'button.sdk-strip-fact[data-module=budget]', call: true, steps: [] }, S.base, S.cookies, S.ctx);
    const before = await tab.eval(M);
    const open = `JSON.stringify((window.hostModules.captureLayout().modules || []).map((m) => m.id + ':' + m.mode).sort())`;
    const openBefore = await tab.eval(open);
    if (!(await tab.eval(`Boolean(document.querySelector('[data-layout-tab=conference]'))`))) { failures.push('Conference: there is no Conference tab in the top bar'); return; }
    if (before.view || before.page || before.empty?.shown) failures.push(`Conference: the Workspace already looks like the Conference layout (${JSON.stringify(before)})`);
    // No call: the page is the chat and the call's area with the large Start call.
    await press('conference');
    const idle = await tab.eval(M);
    if (!idle.view || !idle.page || idle.tab !== 'conference') failures.push(`Conference, no call: the tab did not show the Conference layout (${JSON.stringify({ view: idle.view, page: idle.page, tab: idle.tab })})`);
    if (idle.canvas?.shown) failures.push(`Conference, no call: the canvas is still drawn (${JSON.stringify(idle.canvas)})`);
    if (!near(idle.chat?.w, before.column.w)) failures.push(`Conference, no call: the chat is ${idle.chat?.w}px wide, it was ${before.column.w}px in the Workspace`);
    if (!near(idle.column?.w, idle.win)) failures.push(`Conference, no call: the call and the chat do not fill the page (${idle.column?.w}px of ${idle.win}px)`);
    if (!idle.head?.shown || !near(idle.head.w, idle.win - idle.chat.w)) failures.push(`Conference, no call: the call's title bar does not span the rest of the page (${JSON.stringify(idle.head)}, chat ${idle.chat?.w}px)`);
    if (!idle.empty?.shown || !idle.start?.shown || idle.startLabel !== 'Start call' || idle.start.h < 44) failures.push(`Conference, no call: the large Start call is not shown (${JSON.stringify([idle.empty, idle.start, idle.startLabel])})`);
    if (!/not in a call/i.test(idle.note || '')) failures.push(`Conference, no call: no plain line says there is no call ("${idle.note}")`);
    if (idle.empty?.shown && !near(idle.empty.w, idle.win - idle.chat.w)) failures.push(`Conference, no call: the call's area is ${idle.empty.w}px wide, the page leaves ${idle.win - idle.chat.w}px`);
    if (idle.toggle?.shown) failures.push('Conference: the fold handle is still drawn (there is nothing to fold to)');
    if (idle.join?.shown || idle.joinParent !== 'call-head-tools') failures.push(`Conference, no call: the title bar's Start call must be hidden (the large one is shown) but stay in the title bar (${JSON.stringify([idle.join, idle.joinParent])})`);
    if (idle.wider > 0) failures.push(`Conference, no call: the page is ${idle.wider}px wider than the window`);
    await tab.click('#call-more'); await sleep(300);
    const menu = await tab.eval(items);
    await tab.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(200);
    for (const want of ['Pop out the call', 'Call position']) if (!menu.includes(want)) failures.push(`Conference, no call: the call's menu lacks "${want}" (${menu.join(' / ')})`);
    say(`Conference, no call: chat ${idle.chat?.w}px (the column was ${before.column.w}px), call area ${idle.empty?.w}x${idle.empty?.h}px of a ${idle.win}px page, large "${idle.startLabel}" ${idle.start?.w}x${idle.start?.h}px, "${idle.note}"; menu: ${menu.join(' / ')}`);
    // The large button joins (it presses the title bar's): the call fills the page beside the chat.
    await tab.click('#call-start'); await waitCall(true);
    const on = await tab.eval(M);
    if (!on.inCall || on.tiles < 1) failures.push(`Conference: the large Start call did not start the call (${JSON.stringify({ inCall: on.inCall, tiles: on.tiles })})`);
    if (on.empty?.shown || on.join?.shown) failures.push('Conference, on the call: Start call is still shown');
    if (!near(on.chat?.w, before.column.w)) failures.push(`Conference, on the call: the chat is ${on.chat?.w}px wide, it was ${before.column.w}px`);
    if (!on.strip?.shown || !near(on.strip.w, on.win - on.chat.w) || !near(on.strip.x, on.chat.x + on.chat.w, 3)) failures.push(`Conference, on the call: the call does not fill the page beside the chat (${JSON.stringify(on.strip)}, chat ${JSON.stringify(on.chat)})`);
    if (on.strip && on.column && on.strip.h + (on.head?.h || 0) < on.column.h - 2) failures.push(`Conference, on the call: the call is ${on.strip.h + (on.head?.h || 0)}px tall in a ${on.column.h}px page (the 55% rule is lifted here)`);
    if (on.canvas?.shown || on.wider > 0) failures.push(`Conference, on the call: the canvas is drawn or the page is wider than the window (${JSON.stringify([on.canvas, on.wider])})`);
    say(`Conference, on the call: ${on.tiles} tiles, the call ${on.strip?.w}x${on.strip?.h}px beside a ${on.chat?.w}px chat, tiles' grid ${on.grid?.w}x${on.grid?.h}px`);
    // Every way out of the Conference layout, on the call: the call goes back to the column at its saved Call position,
    // its tiles seen there, the canvas back, no large Start call, and the call never hung up. Then back in, each time.
    const inColumn = (m, how) => {
      const bad = [];
      if (!m.inCall || m.tiles !== on.tiles) bad.push(`the call did not stay on (${m.tiles} tiles)`);
      if (m.view || m.page) bad.push('the Conference layout is still marked');
      if (!m.canvas?.shown) bad.push('the canvas is not back');
      if (!near(m.column?.w, before.column.w)) bad.push(`the column is ${m.column?.w}px, it was ${before.column.w}px`);
      if (!m.strip?.shown || m.strip.h < 60 || m.strip.w > before.column.w + 1 || !m.grid?.shown || m.grid.x + m.grid.w > before.column.x + before.column.w + 1) bad.push(`the call's tiles are not seen in the column (strip ${JSON.stringify(m.strip)}, tiles ${JSON.stringify(m.grid)})`);
      if (m.strip && m.column && m.strip.h + (m.head?.h || 0) > Math.round(m.column.h * 0.55) + 2) bad.push(`the call takes ${m.strip.h + (m.head?.h || 0)}px of a ${m.column.h}px column (over 55%)`);
      if (m.empty?.shown || m.start?.shown) bad.push('the large Start call shows in the column');
      if (m.wider > 0) bad.push(`the page is ${m.wider}px wider than the window`);
      if (bad.length) failures.push(`out of Conference by ${how}: ${bad.join('; ')}`);
      return !bad.length;
    };
    const inConference = (m, how) => {
      const ok = m.view && m.page && m.tab === 'conference' && m.inCall && m.tiles === on.tiles && !m.canvas?.shown && m.strip?.shown && near(m.strip.w, m.win - m.chat.w) && near(m.chat.w, before.column.w);
      if (!ok) failures.push(`back in Conference after ${how}: the call does not fill the page beside the chat (${JSON.stringify({ view: m.view, page: m.page, tab: m.tab, inCall: m.inCall, tiles: m.tiles, strip: m.strip, chat: m.chat })})`);
      return ok;
    };
    const has = (id) => tab.eval(`Boolean(document.querySelector('[data-layout-tab="${id}"]'))`);
    const ways = [];
    const way = async (how, out) => {
      await out();
      for (const end = Date.now() + 8000; Date.now() < end && (await tab.eval(tabState)).view;) await sleep(100); // out of the layout, waited for
      await sleep(1300);
      const a = inColumn(await tab.eval(M), how);
      await press('conference');
      const b = inConference(await tab.eval(M), how);
      ways.push(`${how} ${a && b ? 'ok' : 'FAILED'}`);
    };
    await way('the Workspace tab', () => press('workspace'));
    if (await has('calendar')) await way('the Calendar tab', () => press('calendar'));
    if (await has('map')) await way('the Map tab', () => press('map'));
    for (const id of ['whiteboard', 'documents']) if (await has(id)) await way(`the ${id} tab`, () => press(id));
    const saved = await tab.eval(`([...document.querySelectorAll('[data-layout-tab]')].map((b) => b.dataset.layoutTab).find((id) => !['workspace', 'calendar', 'map', 'conference', 'whiteboard', 'documents'].includes(id)) || '')`);
    if (saved) await way('a saved layout tab', () => press(saved));
    await way('the keyboard on the Workspace tab', async () => {
      await tab.eval(`document.querySelector('[data-layout-tab=workspace]').focus()`);
      for (const type of ['keyDown', 'keyUp']) await tab.cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) }, tab.sid);
    });
    const pick = `(() => { const ids = ${JSON.stringify(['budget', 'polls', 'research', 'maps', 'places'])}; return ids.find((id) => (window.hostModules.NAME(id), window.hostModules.isOpen(id))) || ''; })()`;
    let openedId = '';
    await way('a module opened by the page (a link, a strip fact)', async () => { openedId = await tab.eval(pick.replace('NAME', 'open')); });
    if (!openedId) failures.push('out of Conference by a module opened by the page: no module opened');
    else if ((await tab.eval(M)).tab !== 'conference') failures.push('back in Conference after a module was opened: the tab is not Conference');
    await way('a module shown by the page (Send to, Keep)', async () => { await tab.eval(pick.replace('NAME', 'show')); });
    // A phone's width and back: the call is the phone's tab meanwhile, then the Conference layout again.
    const size = (w) => tab.cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false }, tab.sid);
    await size(390); await sleep(1500);
    const phone = await tab.eval(M);
    if (!phone.inCall || phone.tiles !== on.tiles || phone.view || !phone.grid?.shown || phone.grid.w < 300 || !phone.canvas?.shown) failures.push(`a phone's width from Conference: the call is not the tab shown (${JSON.stringify({ inCall: phone.inCall, tiles: phone.tiles, view: phone.view, grid: phone.grid, canvas: phone.canvas })})`);
    await size(1280); await sleep(1500);
    inConference(await tab.eval(M), 'a phone\'s width and back');
    ways.push(`a phone's width and back (tiles' area ${phone.grid?.w}x${phone.grid?.h}px at 390)`);
    say(`ways out of Conference, on the call: ${ways.join('; ')}`);
    // Five unhurried round trips on the call, each press waited for: Conference every time.
    let steady = 0;
    for (let i = 0; i < 5; i++) { await press('workspace'); await press('conference'); if (inConference(await tab.eval(M), `round trip ${i + 1}`)) steady += 1; }
    say(`5 round trips on the call, each waited for: Conference shown ${steady} of 5 times`);
    // Quick round trips, on the call. A module the Workspace opens asks for another a moment later (Maps asks Places for
    // its colours): pressed meanwhile, the Conference layout must stay (it was thrown back to the Workspace before).
    for (let i = 0; i < 5; i++) { await press('workspace', 150 + i * 150); await press(i % 2 && (await has('calendar')) ? 'calendar' : 'workspace', 100); await press('conference', 100); }
    const quick = await settled('conference');
    if (inConference(quick, '5 quick round trips')) say(`5 quick round trips on the call: Conference stayed (${quick.tiles} tiles, the call ${quick.strip?.w}x${quick.strip?.h}px)`);
    // Hang up: the large Start call is back here; in the Workspace it is not. And the same round trips with no call.
    await tab.eval(`document.getElementById('hangup').click()`); await waitCall(false);
    const off = await tab.eval(M);
    if (off.inCall || !off.view || !off.start?.shown || !near(off.empty?.w, off.win - off.chat.w)) failures.push(`Conference, hung up: the large Start call did not come back (${JSON.stringify({ inCall: off.inCall, view: off.view, start: off.start, empty: off.empty })})`);
    for (let i = 0; i < 5; i++) { await press(i % 2 && (await has('calendar')) ? 'calendar' : 'workspace', 150 + i * 150); await press('conference', 100); }
    const idle2 = await settled('conference');
    if (!idle2.view || idle2.tab !== 'conference' || !idle2.start?.shown || idle2.canvas?.shown) failures.push(`5 quick round trips with no call: the Conference layout with its large Start call is not shown (${JSON.stringify({ view: idle2.view, tab: idle2.tab, start: idle2.start, canvas: idle2.canvas })})`);
    await press('workspace');
    const end = await tab.eval(M);
    if (end.empty?.shown || end.start?.shown || end.view || !end.canvas?.shown) failures.push(`Workspace, no call: the large Start call shows in the side column, or the canvas is not back (${JSON.stringify([end.empty, end.start, end.view])})`);
    if (!end.join?.shown || end.joinParent !== 'call-head-tools') failures.push(`Workspace column, no call: the title bar's Start call must be shown (${JSON.stringify([end.join, end.joinParent])})`);
    // The Workspace is as it was: the same modules in the same modes (only the Workspace remembers).
    await sleep(800);
    const openAfter = await tab.eval(open);
    if (openAfter !== openBefore) failures.push(`Workspace after Conference: its modules are not as they were (${openAfter}; before ${openBefore})`);
    say(`hung up: large Start call ${off.start?.shown ? 'shown' : 'hidden'} on Conference, ${idle2.start?.shown ? 'shown' : 'hidden'} after 5 quick round trips, ${end.start?.shown ? 'SHOWN' : 'hidden'} in the Workspace; the Workspace's modules ${openAfter === openBefore ? 'as they were' : 'CHANGED'}`);
  } finally { await tab.close(); }
}

// The call's controls keep responding through a pop-out (the bug fixed in #793: after the popped-out window was closed
// the browser had removed the listeners of the shut-down popup page, and the buttons did nothing). Real mouse events
// press deafen, react, layout and away (the stub microphone cannot toggle in any state, so it is not tried) before the
// pop-out, in the popup, after the popup is closed from the opener, and after "Bring the call back"; on the Workspace
// and on the Conference layout. Any control that does not respond fails. The call is the stub's: a real one is not tried.
async function runPopout(browser, S, conference) {
  const tab = new Tab(browser.cdp, S.ctx);
  await tab.open(1280, 'light', true);
  const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
  const where = conference ? 'Conference' : 'Workspace';
  const STATE = (D) => `(() => { const g = (id) => ${D}.getElementById(id); return { deafenOff: g('deafen')?.classList.contains('off'), away: g('away-overlay') ? !g('away-overlay').hidden : null, tray: g('react-tray') ? !g('react-tray').hidden : null, layout: g('layout-glyph')?.className }; })()`;
  const RECT = (D, id) => `(() => { const e = ${D}.getElementById('${id}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; })()`;
  const controls = async (label, D, sid) => {
    const input = (m, p) => tab.cdp.send(m, p, sid);
    const click = async (id) => {
      const r = await tab.eval(RECT(D, id)); if (!r || !r.w) return false;
      await input('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y, button: 'none', clickCount: 0 }); await sleep(150);
      await input('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      await input('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      await sleep(500); return true;
    };
    await input('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 60, y: 200, button: 'none', clickCount: 0 }); await sleep(300); // wake the bars
    const s0 = await tab.eval(STATE(D)); const out = {};
    await click('deafen'); let s = await tab.eval(STATE(D)); out.deafen = s.deafenOff !== s0.deafenOff; await click('deafen');
    await click('react-toggle'); s = await tab.eval(STATE(D)); out.react = s.tray !== s0.tray; await click('react-toggle');
    await click('layout'); s = await tab.eval(STATE(D)); out.layout = s.layout !== s0.layout;
    await click('away-toggle'); s = await tab.eval(STATE(D)); out.away = s.away !== s0.away;
    if (out.away) { await tab.eval(`${D}.getElementById('away-cancel').click()`); await sleep(300); }
    const dead = Object.keys(out).filter((k) => !out[k]);
    if (dead.length) failures.push(`${where}, ${label}: the call's controls did not respond: ${dead.join(', ')}`);
    return dead.length ? `NOT responding: ${dead.join(', ')}` : 'respond';
  };
  const popOut = async () => {
    await tab.cdp.send('Runtime.evaluate', { expression: `document.getElementById('call-head-popout').click()`, userGesture: true }, tab.sid);
    const end = Date.now() + 10000;
    while (Date.now() < end && !(await tab.eval(`(() => { try { const w = ${POPOUT}; return w.document.body.classList.contains('conference-window') && w.document.querySelectorAll('#grid .tile').length >= 1; } catch (e) { return false; } })()`))) await sleep(200);
    await sleep(800);
    const { targetInfos } = await tab.cdp.send('Target.getTargets');
    const target = targetInfos.find((t) => t.type === 'page' && t.url.endsWith('/popout.html') && t.browserContextId === tab.contextId);
    if (!target) throw new Error('the call\'s window was not found');
    const { sessionId } = await tab.cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    await tab.cdp.send('Runtime.enable', {}, sessionId);
    return sessionId;
  };
  const reopenColumn = async () => { if (await tab.eval(`document.getElementById('side-column').classList.contains('collapsed')`)) { await tab.eval(`document.getElementById('side-column-toggle').click()`); await sleep(800); } };
  const seen = [];
  try {
    await driveScreen(tab, { id: 'popout', as: 'mia', url: '/#join={trip}', wait: 'button.sdk-strip-fact[data-module=budget]', call: true, steps: [] }, S.base, S.cookies, S.ctx);
    if (conference) { await tab.eval(`document.querySelector('[data-layout-tab=conference]').click()`); await sleep(1200); }
    await tab.click(conference ? '#call-start' : '#join-call');
    const end = Date.now() + 15000;
    while (Date.now() < end && !(await tab.eval(`document.getElementById('side-column').classList.contains('in-call')`))) await sleep(200);
    await sleep(800);
    if (!(await tab.eval(`document.getElementById('side-column').classList.contains('in-call')`))) { failures.push(`${where}: the call did not start`); return; }
    seen.push(`before the pop-out ${await controls('before the pop-out', 'document', tab.sid)}`);
    // Round 1: popped out, tried in the popup, then the window closed from the opener.
    let sid = await popOut();
    seen.push(`in the popup ${await controls('in the popup', `${POPOUT}.document`, sid)}`);
    await tab.eval(`${POPOUT}.close()`); await sleep(2500);
    await reopenColumn();
    seen.push(`after the window was closed ${await controls('after the popup window was closed', 'document', tab.sid)}`);
    // Round 2: popped out again, then "Bring the call back".
    sid = await popOut();
    await tab.click('#call-back'); await sleep(1500);
    await reopenColumn();
    seen.push(`after Bring the call back ${await controls('after Bring the call back', 'document', tab.sid)}`);
    say(`${where}, pop-out (deafen, react, layout, away): ${seen.join('; ')}`);
  } finally { await tab.close(); }
}

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'call-bars-data-'));
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    browser = await launch(bin);
    for (const people of [2, 4]) await run(browser, S, people);
    await runArea(browser, S);
    await runConference(browser, S);
    await runPopout(browser, S, false);
    await runPopout(browser, S, true);
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
