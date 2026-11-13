// check-stacking.mjs: panel stacking (documentation/plans/plan-panel-stacking.md, GitHub #387) in the running product
// (headless Chromium, the screenshot seed's trip, a person on the Workspace at 1280 px, light and dark). Two or three docked
// modules share one column, each in its own frame, with a divider between them and a collapse on each. Measured here:
//   1. Stack with... in a title bar menu stacks Polls under Maps: one column, equal heights, a divider that is a
//      separator with a name and a value, a group "Stacked: Maps, Polls", the note said, the keyboard back on the menu.
//   2. The divider: dragged it moves the two heights and stops at 156 px (a title bar and 120 px); Up, Down, Shift, Home, End
//      and Enter move it, Enter gives equal heights; its value follows.
//   3. Collapse: a section's chevron folds it to its title bar (aria-expanded), the other takes the height; the last open
//      section cannot be collapsed (its chevron says so, its menu's Collapse is off).
//   4. A third module joins (Research, by dragging its title bar over the stack: the preview says where it goes); a fourth
//      is refused, by the menu ("Full: three modules") and by a drop (the note says why).
//   5. A stack is one column of the docked limit: with the Itinerary and a stack, Research still docks; a floating module
//      whose Dock as a panel is off (the columns are full) can still be stacked from its menu.
//   6. Dragging a section to a column's edge gives it a column of its own; closing all but one leaves an ordinary column.
//   7. Reloading the space restores the stack, its order and its split.
//   8. The conference and Chat (the column beside the canvas) and a composite (the Calendar) never stack: no Stack with...
//      in their menus, and a drop onto or of the Calendar is refused with a note.
//   9. A phone (390 px): no stack is drawn (one view at a time, no divider, no collapse, no stack entries), the stack is
//      kept in what is remembered, and it is drawn again when the window is wide.
//  10. A short canvas collapses the lowest section by itself and opens it again when the height returns.
//  11. A saved layout carries the stack (the server keeps it), and loading it, and a reload, give the same stack back.
//  12. Unstack all, in the Modules tab of Set up (its id is show), puts every module of every stack in a column of its own.
//  13. Inside a stack Tab goes top section, divider, next section; nothing in a module starts again when the page's order
//      follows the stack; a drag inside a stack keeps the shares; Escape stops a drag; a module out of a stack has its own
//      width again; after Unstack all the keyboard is on Panel Mode.
//  14. Window Mode puts the stacks away and Panel Mode brings them back, with their heights and collapse, beside an ordinary
//      column; after a reload in between; closed up when a member was closed meanwhile; layouts saved meanwhile are kept.
// It cannot check a real tablet's touch, a screen reader, or a call (no LiveKit here).
// Usage: node tools/check-stacking.mjs [--mode=light|dark]. With no Chromium it says SKIPPED and exits 0 (a skip, never a pass).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

const say = (...a) => console.log('check-stacking:', ...a);
const failures = [];
const expect = (ok, what) => { if (!ok) failures.push(what); return ok; };
const KEYS = { ArrowUp: 38, ArrowDown: 40, Home: 36, End: 35, Enter: 13, Escape: 27 };

// The canvas as a person sees it: each docked module's column and height, the dividers, the groups, the note.
const STATE = `(() => ({
  docked: [...document.querySelectorAll('#canvas > .module-docked')].map((e) => { const c = e.querySelector(':scope > .mod-content'); const r = c.getBoundingClientRect();
    return { id: e.dataset.module, col: c.style.gridColumn, h: Math.round(r.height), x: Math.round(r.left), w: Math.round(r.width), top: Math.round(r.top), stacked: e.classList.contains('in-stack'), folded: e.classList.contains('stack-folded') }; }),
  floats: [...document.querySelectorAll('.module-floating')].map((e) => e.dataset.module),
  dividers: [...document.querySelectorAll('#canvas > .stack-divider')].map((d) => ({ role: d.getAttribute('role'), orient: d.getAttribute('aria-orientation'), label: d.getAttribute('aria-label'), now: Number(d.getAttribute('aria-valuenow')), min: Number(d.getAttribute('aria-valuemin')), max: Number(d.getAttribute('aria-valuemax')), tab: d.tabIndex, off: d.classList.contains('stack-divider-off'), h: Math.round(d.getBoundingClientRect().height) })),
  groups: [...document.querySelectorAll('#canvas > .stack-group')].map((g) => g.getAttribute('aria-label')),
  folds: [...document.querySelectorAll('.stack-fold')].map((b) => ({ label: b.getAttribute('aria-label'), expanded: b.getAttribute('aria-expanded'), disabled: b.getAttribute('aria-disabled') })),
  said: document.getElementById('layout-announce')?.textContent || document.getElementById('modules-menu-note')?.textContent || '',
  canvasH: document.getElementById('canvas').clientHeight,
}))()`;

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stacking-data-'));
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    browser = await launch(bin);
    const KEY = `app.canvas.${S.ctx.trip}`;
    const only = process.argv.find((a) => a.startsWith('--mode='))?.slice(7);
    // Each look by another person of the trip, so nothing one tab left (its presence on the trip) meets the next.
    for (const [mode, who] of (only ? [only] : ['light', 'dark']).map((m) => [m, m === 'dark' ? 'sam' : 'mia'])) {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(1280, mode, true);
      // A page after a reload can take longer than 15 s on a busy machine; wait longer before calling it missing.
      const waitFor = tab.waitFor.bind(tab); tab.waitFor = (sel, text, ms = 45000) => waitFor(sel, text, ms);
      const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
      const errors = [];
      const listen = (m) => {
        if (m.sessionId !== tab.sid) return;
        if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      };
      tab.cdp.listeners.push(listen);
      const L = `[${mode}]`;
      const state = () => tab.eval(STATE);
      const stored = async () => JSON.parse(await tab.eval(`localStorage.getItem(${JSON.stringify(KEY)}) || '{}'`));
      const size = async (w, h = 900) => { await tab.cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }, tab.sid); await sleep(1200); };
      const key = async (k, shift = false) => {
        for (const type of ['keyDown', 'keyUp']) await tab.cdp.send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: KEYS[k], modifiers: shift ? 8 : 0, ...(k === 'Enter' && type === 'keyDown' ? { text: '\r' } : {}) }, tab.sid);
        await sleep(120);
      };
      const menuOf = async (id) => { await tab.eval(`document.querySelector('.module-docked[data-module="${id}"] .mf-titlebar-menu, .module-floating[data-module="${id}"] .mf-titlebar-menu').click()`); await sleep(350); };
      const menuItems = () => tab.eval(`[...document.querySelectorAll('.host-menu .host-menu-item')].map((b) => ({ text: b.querySelector('.host-menu-label')?.textContent.trim() || b.textContent.trim(), off: b.disabled }))`);
      const pick = async (text) => {
        const ok = await tab.eval(`(() => { const b = [...document.querySelectorAll('.host-menu .host-menu-item')].find((b) => (b.querySelector('.host-menu-label')?.textContent.trim() || b.textContent.trim()).startsWith(${JSON.stringify(text)})); if (!b || b.disabled) return false; b.click(); return true; })()`);
        await sleep(450);
        return ok;
      };
      const closeMenus = async () => { await key('Escape'); await key('Escape'); await sleep(150); };
      const box = (id) => tab.eval(`(() => { const r = document.querySelector('.module-docked[data-module="${id}"] > .mod-content').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, r: r.right, t: r.top, b: r.bottom }; })()`);
      // A title bar dragged to (x, y) in steps; what was drawn just before letting go.
      const drag = async (id, to) => {
        const t = await tab.eval(`(() => { const r = document.querySelector('.module-docked[data-module="${id}"] .mf-titlebar-title').getBoundingClientRect(); return { x: r.left + 16, y: r.top + r.height / 2 }; })()`);
        await tab.mouse('mouseMoved', t.x, t.y, { button: 'none', clickCount: 0 });
        await tab.mouse('mousePressed', t.x, t.y);
        for (let k = 1; k <= 10; k++) await tab.mouse('mouseMoved', t.x + ((to.x - t.x) * k) / 10, t.y + ((to.y - t.y) * k) / 10, { button: 'left', buttons: 1, clickCount: 0 });
        await sleep(120);
        const drawn = await tab.eval(`({ ghost: document.querySelector('.stack-zones .stack-ghost-words')?.textContent || '', line: document.querySelector('.stack-zones .stack-line-words')?.textContent || '', hidden: document.querySelector('.stack-zones')?.getAttribute('aria-hidden') })`);
        await tab.mouse('mouseReleased', to.x, to.y);
        await sleep(450);
        return drawn;
      };
      // The Modules tab of Set up (#setup-show) (the modules' switches, Arrange): opened from the top bar's Set up, closed with Escape.
      const showTab = async () => { await tab.eval(`document.getElementById('setup').click()`); await tab.waitFor('#setup-show .host-menu-item'); await sleep(300); };
      const openFromLayoutMenu = async (name) => { await showTab(); await pick(name); await closeMenus(); await sleep(400); };
      // Enter the trip with a remembered layout of these modules, docked (Panel Mode, what nothing remembered reads as).
      const enter = async (open, records = {}) => {
        await driveScreen(tab, { id: 'storage', as: who, url: '/healthz', wait: 'body' }, S.base, S.cookies, S.ctx);
        await tab.eval(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify({ __open: open, ...records }))})`);
        try {
          await driveScreen(tab, { id: 'workspace', as: who, url: '/#join={trip}', wait: '#canvas .module-docked', call: true }, S.base, S.cookies, S.ctx);
        } catch (e) {
          const shot = await tab.cdp.send('Page.captureScreenshot', { format: 'png' }, tab.sid).catch(() => null);
          if (shot) fs.writeFileSync(path.join(os.tmpdir(), 'check-stacking-enter.png'), Buffer.from(shot.data, 'base64'));
          throw new Error(`${e.message} (a picture: ${path.join(os.tmpdir(), 'check-stacking-enter.png')}; at ${await tab.eval('location.href').catch(() => '?')})`);
        }
        await sleep(800);
      };
      try {
        // Maps and Polls remember shares from before (a new stack still starts equal) and Polls its own width (given back
        // when it leaves the stack).
        await enter(['travel', 'maps', 'polls'], { maps: { h: 0.8 }, polls: { h: 0.2, dockW: 300 } });
        let s = await state();
        expect(s.docked.map((d) => d.id).join() === 'travel,maps,polls' && new Set(s.docked.map((d) => d.col)).size === 3, `${L} the trip did not open with the Itinerary, Maps and Polls in three columns: ${JSON.stringify(s.docked)}`);

        // 1. Stack with... from Polls' menu.
        await menuOf('polls');
        const polls = await menuItems();
        expect(polls.some((x) => x.text === 'Stack with...' && !x.off), `${L} Polls' menu has no Stack with...: ${JSON.stringify(polls)}`);
        await pick('Stack with...');
        const fly = await menuItems();
        expect(['Above Maps', 'Below Maps', 'Above Itinerary', 'Below Itinerary'].every((t) => fly.some((x) => x.text === t)), `${L} Stack with... does not list Above and Below each column: ${JSON.stringify(fly.map((x) => x.text))}`);
        await pick('Below Maps');
        s = await state();
        const pl = s.docked.find((d) => d.id === 'maps'); const po = s.docked.find((d) => d.id === 'polls');
        expect(pl.col === po.col && pl.stacked && po.stacked && po.top > pl.top, `${L} Polls is not under Maps in one column: ${JSON.stringify(s.docked)}`);
        expect(Math.abs(pl.h - po.h) <= 2 && pl.h + po.h >= s.canvasH - 2, `${L} a new stack starts with equal heights that fill the column (${pl.h} and ${po.h} of ${s.canvasH})`);
        const d0 = s.dividers[0];
        expect(s.dividers.length === 1 && d0.role === 'separator' && d0.orient === 'horizontal' && d0.label === 'Resize Maps and Polls' && d0.now === 50 && d0.tab === 0, `${L} the divider is not a named separator at 50 that takes the keyboard: ${JSON.stringify(s.dividers)}`);
        expect(d0.h === 8, `${L} the divider is the splitter's 8 px on a mouse, not ${d0.h}`);
        expect(s.groups.includes('Stacked: Maps, Polls'), `${L} the stack is not a group named "Stacked: Maps, Polls": ${JSON.stringify(s.groups)}`);
        expect(s.said === 'Polls was stacked under Maps.', `${L} the note says "${s.said}", not "Polls was stacked under Maps."`);
        expect(await tab.eval(`document.activeElement?.matches('.module-docked[data-module="polls"] .mf-titlebar-menu')`), `${L} after Stack with... the keyboard is not on Polls' menu button`);
        const kept = await stored();
        expect(kept.maps?.stack && kept.maps.stack === kept.polls?.stack && kept.maps.at === 0 && kept.polls.at === 1, `${L} the stack is not remembered (stack, at): ${JSON.stringify({ maps: kept.maps, polls: kept.polls })}`);

        // 2. The divider: drag, the 156 px least, the keys.
        const dv = await tab.eval(`(() => { const r = document.querySelector('#canvas > .stack-divider').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        await tab.mouse('mouseMoved', dv.x, dv.y, { button: 'none', clickCount: 0 });
        await tab.mouse('mousePressed', dv.x, dv.y);
        for (let y = dv.y; y <= dv.y + 600; y += 50) await tab.mouse('mouseMoved', dv.x, y, { button: 'left', buttons: 1, clickCount: 0 });
        await tab.mouse('mouseReleased', dv.x, dv.y + 600);
        await sleep(250);
        s = await state();
        let lower = s.docked.find((d) => d.id === 'polls').h;
        expect(lower === 156, `${L} dragged far down, the lower section is ${lower} px, not the least, 156`);
        await tab.eval(`document.querySelector('#canvas > .stack-divider').focus()`);
        await key('ArrowUp');
        s = await state();
        expect(s.docked.find((d) => d.id === 'polls').h === 172, `${L} Up moved the divider to make Polls ${s.docked.find((d) => d.id === 'polls').h}, not 156 + 16`);
        await key('ArrowUp', true);
        s = await state();
        expect(s.docked.find((d) => d.id === 'polls').h === 236, `${L} Shift+Up made Polls ${s.docked.find((d) => d.id === 'polls').h}, not 172 + 64`);
        await key('Home');
        s = await state();
        expect(s.docked.find((d) => d.id === 'maps').h === 156 && s.dividers[0].now === s.dividers[0].min, `${L} Home: Maps is ${s.docked.find((d) => d.id === 'maps').h} px (156 wanted) and the value ${s.dividers[0].now} (its least ${s.dividers[0].min})`);
        await key('End');
        s = await state();
        expect(s.docked.find((d) => d.id === 'polls').h === 156 && s.dividers[0].now === s.dividers[0].max, `${L} End: Polls is ${s.docked.find((d) => d.id === 'polls').h} px (156 wanted) and the value ${s.dividers[0].now} (its most ${s.dividers[0].max})`);
        await key('Enter');
        s = await state();
        expect(Math.abs(s.docked.find((d) => d.id === 'maps').h - s.docked.find((d) => d.id === 'polls').h) <= 2 && s.dividers[0].now === 50, `${L} Enter did not give equal heights: ${JSON.stringify(s.docked)}`);
        expect(await tab.eval(`document.activeElement?.classList.contains('stack-divider')`), `${L} the divider lost the keyboard while it moved`);
        await key('ArrowDown'); await key('ArrowDown');
        const split = (await state()).docked.find((d) => d.id === 'maps').h;

        // 3. Collapse; the last one open stays open.
        await tab.eval(`document.querySelector('.module-docked[data-module="maps"] .stack-fold').click()`);
        await sleep(250);
        s = await state();
        const fp = s.docked.find((d) => d.id === 'maps'); const fq = s.docked.find((d) => d.id === 'polls');
        expect(fp.folded && fp.h === 36 && fq.h === s.canvasH - 36, `${L} collapsed, Maps is ${fp.h} px (its title bar, 36) and Polls ${fq.h} (the rest)`);
        expect(s.folds.some((f) => f.label === 'Expand Maps' && f.expanded === 'false') && s.folds.some((f) => f.label === 'Collapse Polls' && f.disabled === 'true'), `${L} the chevrons do not say Expand Maps and that Polls, the last one open, cannot collapse: ${JSON.stringify(s.folds)}`);
        expect(s.dividers[0].off && s.dividers[0].tab === -1, `${L} the divider beside a collapsed section still moves or takes the keyboard`);
        await tab.eval(`document.querySelector('.module-docked[data-module="polls"] .stack-fold').click()`);
        await sleep(250);
        s = await state();
        expect(!s.docked.find((d) => d.id === 'polls').folded && /The last open one stays open/.test(s.said), `${L} the last open section collapsed, or nothing said why (${s.said})`);
        await menuOf('polls');
        expect((await menuItems()).some((x) => x.text === 'Collapse' && x.off), `${L} Polls' menu offers Collapse while it is the last one open`);
        await closeMenus();
        await tab.eval(`document.querySelector('.module-docked[data-module="maps"] .stack-fold').click()`);
        await sleep(250);
        s = await state();
        expect(Math.abs(s.docked.find((d) => d.id === 'maps').h - split) <= 1, `${L} expanded again, Maps is ${s.docked.find((d) => d.id === 'maps').h} px, not the ${split} it had`);

        // 5 (first half). A stack is one column: Research docks beside the Itinerary and the stack (the limit at this width is 3).
        await openFromLayoutMenu('Research');
        s = await state();
        expect(s.docked.some((d) => d.id === 'research') && !s.floats.includes('research'), `${L} Research did not dock in the third column (a stack is one column): ${JSON.stringify(s)}`);
        // A NEW stack starts with equal heights even when a module brings a share from the stack it leaves (decision 6):
        // Polls, unequal under Maps, stacked under Research; then back under Maps (again a new stack of two).
        const hOf = async (id) => (await stored())[id]?.h;
        expect(Math.abs((await hOf('polls')) - 0.5) > 0.01, `${L} Polls' share under Maps is ${await hOf('polls')}, so a new stack's equal start is not measured`);
        await menuOf('polls'); await pick('Stack with...'); await pick('Below Research');
        s = await state();
        expect(s.groups.includes('Stacked: Research, Polls') && (await hOf('research')) === 0.5 && (await hOf('polls')) === 0.5 && Math.abs(s.docked.find((d) => d.id === 'research').h - s.docked.find((d) => d.id === 'polls').h) <= 2, `${L} a new stack of Research and Polls did not start with equal heights: ${JSON.stringify({ research: await hOf('research'), polls: await hOf('polls') })}`);
        await menuOf('polls'); await pick('Stack with...'); await pick('Below Maps');

        // 4. A third joins by the drag; a fourth is refused. Joining moves Maps and Polls after Research in the page (the
        // keyboard's order), and nothing in them starts again: each module's own content is the same, and a frame put in
        // Polls keeps its page (moveBefore; a frame moved the old way would load again).
        await tab.eval(`(() => { window.__kept = {}; for (const s of document.querySelectorAll('#canvas > .module-docked')) { const r = s.querySelector('.module-root'); window.__kept[s.dataset.module] = r && r.shadowRoot ? r.shadowRoot.firstElementChild : null; }
          const f = document.createElement('iframe'); f.id = 'check-stacking-frame'; f.srcdoc = '<p>kept</p>'; f.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0'; document.querySelector('.module-docked[data-module="polls"] > .mod-content').append(f); return true; })()`);
        await sleep(400);
        await tab.eval(`(() => { const f = document.getElementById('check-stacking-frame'); f.contentWindow.__kept = 'yes'; window.__loads = 0; f.addEventListener('load', () => { window.__loads += 1; }); })()`);
        let b = await box('maps');
        const third = await drag('research', { x: b.x, y: b.t + 30 });
        expect(third.ghost === 'Research goes above Maps' && third.hidden === 'true', `${L} dragging Research over Maps' upper half drew "${third.ghost}" (aria-hidden ${third.hidden}), not "Research goes above Maps"`);
        s = await state();
        const cols = new Set(['research', 'maps', 'polls'].map((id) => s.docked.find((d) => d.id === id)?.col));
        expect(cols.size === 1 && s.groups.includes('Stacked: Research, Maps, Polls') && s.dividers.length === 2, `${L} Research did not join the stack on top: ${JSON.stringify({ docked: s.docked, groups: s.groups })}`);
        expect(s.said === 'Research was stacked above Maps.', `${L} the note says "${s.said}"`);
        const untouched = await tab.eval(`(() => { const f = document.getElementById('check-stacking-frame'); const out = { frame: Boolean(f && f.contentWindow && f.contentWindow.__kept === 'yes' && window.__loads === 0) }; for (const s of document.querySelectorAll('#canvas > .module-docked')) { const r = s.querySelector('.module-root'); out[s.dataset.module] = Boolean(r && r.shadowRoot && r.shadowRoot.firstElementChild === window.__kept[s.dataset.module]); } f?.remove(); return out; })()`);
        expect(Object.values(untouched).every(Boolean), `${L} a module started again when the stack was put in order in the page: ${JSON.stringify(untouched)}`);
        // The keyboard: top section, divider, next section, divider, last section (the plan's Accessibility).
        await tab.eval(`document.querySelector('.module-docked[data-module="research"] .stack-fold').focus()`);
        const where = `(() => { const a = document.activeElement; if (a.closest('.stack-divider')) return 'divider'; const sec = a.closest('#canvas > .module-docked'); return sec ? sec.dataset.module : 'elsewhere'; })()`;
        const walk = [];
        for (let k = 0; k < 80 && walk.filter((w) => w === 'elsewhere' || w === 'travel').length === 0; k++) { const w = await tab.eval(where); if (walk[walk.length - 1] !== w) walk.push(w); await key('Tab'); }
        expect(walk.slice(0, 5).join() === 'research,divider,maps,divider,polls', `${L} Tab goes ${walk.join(' > ')}, not top section, divider, next section`);
        // A drag inside the stack keeps every section's share (only a new stack starts equal).
        await tab.eval(`document.querySelectorAll('#canvas > .stack-divider')[0].focus()`);
        await key('ArrowDown'); await key('ArrowDown');
        const shares = async () => { const r = await stored(); return ['research', 'maps', 'polls'].map((id) => Math.round((r[id]?.h || 0) * 100) / 100).join(); }; // to the hundredth: cleaning may move the fourth place
        const sharesBefore = await shares();
        b = await box('research');
        await drag('polls', { x: b.x, y: b.t + 30 });
        s = await state();
        expect(s.docked.filter((d) => d.stacked).sort((x, y) => x.top - y.top).map((d) => d.id).join() === 'polls,research,maps' && await shares() === sharesBefore, `${L} Polls dragged above Research inside the stack: ${s.docked.filter((d) => d.stacked).map((d) => d.id)} with shares ${await shares()}, not the ${sharesBefore} they had`);
        b = await box('maps');
        await drag('polls', { x: b.x, y: b.b - 30 });
        s = await state();
        expect(s.docked.filter((d) => d.stacked).sort((x, y) => x.top - y.top).map((d) => d.id).join() === 'research,maps,polls' && await shares() === sharesBefore, `${L} Polls dragged back under Maps did not keep the shares (${await shares()} for ${sharesBefore})`);
        await menuOf('travel');
        await pick('Stack with...');
        const full = await menuItems();
        expect(full.some((x) => x.text === 'Full: three modules' && x.off) && !full.some((x) => x.text.startsWith('Above ') || x.text.startsWith('Below ')), `${L} a full stack is offered to a fourth: ${JSON.stringify(full.map((x) => x.text))}`);
        await closeMenus();
        b = await box('polls');
        const fourth = await drag('travel', { x: b.x, y: b.y });
        s = await state();
        expect(!fourth.ghost && s.said === 'A stack holds three modules at most.' && s.docked.find((d) => d.id === 'travel').col !== s.docked.find((d) => d.id === 'polls').col, `${L} a fourth was not refused with its note: drew "${fourth.ghost}", said "${s.said}"`);

        // Escape during a title bar drag: nothing changes.
        const colsNow = async () => (await state()).docked.map((d) => `${d.id}:${d.col}`).join();
        const colsBefore = await colsNow();
        b = await box('polls');
        const tp = await tab.eval(`(() => { const r = document.querySelector('.module-docked[data-module="polls"] .mf-titlebar-title').getBoundingClientRect(); return { x: r.left + 16, y: r.top + r.height / 2 }; })()`);
        await tab.mouse('mouseMoved', tp.x, tp.y, { button: 'none', clickCount: 0 });
        await tab.mouse('mousePressed', tp.x, tp.y);
        for (let k = 1; k <= 6; k++) await tab.mouse('mouseMoved', tp.x + ((b.r - 8 - tp.x) * k) / 6, tp.y + ((b.y - tp.y) * k) / 6, { button: 'left', buttons: 1, clickCount: 0 });
        await key('Escape');
        await tab.mouse('mouseReleased', b.r - 8, b.y);
        await sleep(300);
        expect(await colsNow() === colsBefore && !(await tab.eval(`document.getElementById('canvas').classList.contains('reordering') || Boolean(document.querySelector('.stack-zones > *'))`)), `${L} Escape during a drag changed the columns: ${await colsNow()} (was ${colsBefore})`);

        // 6. Out by the drag: a column of its own; then closing all but one.
        b = await box('polls');
        const out = await drag('polls', { x: b.r - 8, y: b.y });
        s = await state();
        expect(out.line === 'Its own column here' && !s.docked.find((d) => d.id === 'polls').stacked && s.docked.find((d) => d.id === 'polls').col !== s.docked.find((d) => d.id === 'maps').col, `${L} dragging Polls to the edge did not give it its own column (the line said "${out.line}"): ${JSON.stringify(s.docked)}`);
        expect(s.groups.includes('Stacked: Research, Maps'), `${L} the stack left is not Research and Maps: ${JSON.stringify(s.groups)}`);
        const own = (await stored()).polls || {};
        expect(own.dockW === 300 && !('ownW' in own), `${L} out of the stack Polls did not get its own width (300) back: ${JSON.stringify(own)}`);
        await menuOf('polls');
        await pick('Stack with...');
        await pick('Below Maps');
        // 7. Reload: the stack comes back, in its order and split.
        const inOrder = (st) => st.docked.filter((d) => d.stacked).sort((a, b) => a.top - b.top).map((d) => `${d.id}:${d.h}`).join();
        const before = inOrder(await state());
        await tab.cdp.send('Page.reload', {}, tab.sid);
        await tab.waitFor('#canvas .module-docked.in-stack');
        await sleep(2500);
        s = await state();
        const after = inOrder(s);
        expect(after === before, `${L} after a reload the stack is ${after}, not ${before}`);
        // Close all but one: an ordinary column at once.
        await tab.eval(`document.querySelector('.module-docked[data-module="research"] .mf-close-btn').click()`);
        await sleep(300);
        await tab.eval(`document.querySelector('.module-docked[data-module="polls"] .mf-close-btn').click()`);
        await sleep(300);
        s = await state();
        const alone = s.docked.find((d) => d.id === 'maps');
        expect(!alone.stacked && alone.h === s.canvasH && !s.dividers.length && !s.groups.length && !s.folds.length, `${L} Maps left alone is not an ordinary column at once: ${JSON.stringify(s)}`);
        expect(s.said === 'Maps has its own column again.', `${L} the note says "${s.said}"`);
        const left = await stored();
        expect(!('stack' in (left.maps || {})), `${L} Maps alone still remembers a stack: ${JSON.stringify(left.maps)}`);

        // 5 (second half). The columns full: a floating module's Dock as a panel is off, its Stack with... is not.
        await openFromLayoutMenu('Polls');
        await openFromLayoutMenu('Research');
        await openFromLayoutMenu('Budget');
        s = await state();
        if (expect(s.floats.includes('budget'), `${L} with three columns Budget did not wait floating: ${JSON.stringify(s)}`)) {
          await menuOf('budget');
          const bm = await menuItems();
          expect(bm.some((x) => x.text === 'Dock as a panel' && x.off) && bm.some((x) => x.text === 'Stack with...' && !x.off), `${L} Budget, floating with the columns full: ${JSON.stringify(bm)}`);
          await pick('Stack with...');
          await pick('Below Polls');
          s = await state();
          const bu = s.docked.find((d) => d.id === 'budget');
          expect(bu && bu.stacked && bu.col === s.docked.find((d) => d.id === 'polls').col && !s.floats.includes('budget'), `${L} Budget did not dock and stack under Polls in one step: ${JSON.stringify(s)}`);
        }

        // 8. The conference, Chat and a composite never stack.
        const chatMenu = await tab.eval(`(() => { const b = document.querySelector('#side-column .mf-titlebar-menu, #side-column [aria-haspopup="menu"]'); if (!b) return null; b.click(); return true; })()`);
        if (chatMenu) { await sleep(300); expect(!(await menuItems()).some((x) => x.text === 'Stack with...'), `${L} the call and chat column offers Stack with...`); await closeMenus(); }
        expect(await tab.eval(`!document.querySelector('#side-column .stack-fold, #side-column .stack-divider') && !document.querySelector('#canvas > .module-docked[data-module="conference"], #canvas > .module-docked[data-module="chat"]')`), `${L} the conference or Chat is drawn as a column of the canvas`);
        // Back to the Itinerary and Maps over Polls, then the Calendar beside them.
        for (const id of ['budget', 'research']) { await tab.eval(`document.querySelector('[data-module="${id}"] .mf-close-btn')?.click()`); await sleep(300); }
        await menuOf('polls'); await pick('Stack with...'); await pick('Below Maps');
        await openFromLayoutMenu('Calendar');
        s = await state();
        if (expect(s.docked.some((d) => d.id === 'dest:calendar'), `${L} the Calendar did not dock beside the stack: ${JSON.stringify(s)}`)) {
          await menuOf('dest:calendar');
          expect(!(await menuItems()).some((x) => x.text === 'Stack with...'), `${L} the Calendar's menu offers Stack with...`);
          await closeMenus();
          await menuOf('travel'); await pick('Stack with...');
          expect(!(await tab.eval(`[...document.querySelectorAll('.host-menu .host-menu-heading')].map((h) => h.textContent)`)).some((t) => /Calendar/.test(t)), `${L} Stack with... offers the Calendar's column`);
          await closeMenus();
          b = await box('maps');
          await drag('dest:calendar', { x: b.x, y: b.b - 60 });
          s = await state();
          expect(s.said === "Calendar can't be in a stack." && !s.docked.find((d) => d.id === 'dest:calendar').stacked, `${L} the Calendar dropped on Maps: "${s.said}"`);
          b = await box('dest:calendar');
          const onto = await drag('travel', { x: b.x, y: b.y });
          s = await state();
          expect(!onto.ghost && s.said === "Calendar can't hold a stack." && !s.docked.find((d) => d.id === 'travel').stacked, `${L} the Itinerary dropped on the Calendar: drew "${onto.ghost}", said "${s.said}"`);
        }
        await tab.eval(`document.querySelector('.module-docked[data-module="dest:calendar"] .mf-close-btn')?.click()`);
        await sleep(300);

        // 10. A short canvas collapses the lowest by itself, and opens it again.
        await openFromLayoutMenu('Research');
        await menuOf('research'); await pick('Stack with...'); await pick('Below Polls');
        await size(1280, 520);
        s = await state();
        const low = s.docked.find((d) => d.id === 'research');
        expect(low.folded && low.h === 36 && s.canvasH < 3 * 156, `${L} at ${s.canvasH} px the lowest section did not collapse by itself: ${JSON.stringify(s.docked)}`);
        await size(1280, 900);
        s = await state();
        expect(!s.docked.find((d) => d.id === 'research').folded && s.docked.filter((d) => d.stacked).every((d) => d.h >= 156), `${L} the height back, the section did not open again: ${JSON.stringify(s.docked)}`);

        // 9. A phone: nothing of the stack is drawn; it is kept for a wide window.
        await size(390, 844);
        s = await state();
        expect(!s.dividers.length && !s.groups.length && !s.folds.length && !s.docked.some((d) => d.stacked), `${L} at 390 px a stack is drawn: ${JSON.stringify(s)}`);
        expect(s.docked.filter((d) => d.h > 0).length === 1, `${L} at 390 px more than one view is shown: ${JSON.stringify(s.docked)}`);
        const phone = await stored();
        expect(phone.maps?.stack && phone.maps.stack === phone.polls?.stack && phone.polls.stack === phone.research?.stack, `${L} the phone dropped the remembered stack: ${JSON.stringify(phone)}`);
        await tab.eval(`[...document.querySelectorAll('#canvas > .module-docked')].find((e) => e.querySelector('.mod-content').getClientRects().length)?.querySelector('.mf-titlebar-menu')?.click()`);
        await sleep(300);
        expect(!(await menuItems()).some((x) => /^(Stack with|Move up|Move down|Move out|Collapse|Expand|Equal heights)/.test(x.text)), `${L} a phone's menu has stack entries`);
        await closeMenus();
        await size(1280, 900);
        s = await state();
        expect(s.groups.includes('Stacked: Maps, Polls, Research'), `${L} back at 1280 the stack is not drawn again: ${JSON.stringify(s.groups)}`);

        // A saved layout carries the stack (plan step 6; server/layouts.js keeps stack, at, h, folded): saved from the Modules tab,
        // it is what the server answers, and loading it after Unstack all, and again after a reload, gives the same stack.
        const shape = (st) => st.docked.filter((d) => d.stacked).sort((a, b) => a.top - b.top).map((d) => `${d.id}:${d.h}`).join();
        const want = shape(await state());
        await showTab();
        await pick('Save as new layout');
        await tab.waitFor('dialog.layout-sheet[open] input');
        await tab.eval(`(() => { const i = document.querySelector('dialog.layout-sheet[open] input:not([type]), dialog.layout-sheet[open] input[type=text]'); i.value = 'Stacked'; i.dispatchEvent(new Event('input', { bubbles: true })); [...document.querySelectorAll('dialog.layout-sheet[open] button')].find((b) => b.textContent.trim() === 'Save').click(); })()`);
        await sleep(1200);
        const lists = await tab.eval(`fetch('/api/spaces/${S.ctx.trip}/layouts').then((r) => r.json())`);
        const savedLayout = [...(lists.mine || []), ...(lists.shared || [])].find((x) => x.name === 'Stacked');
        const members = (savedLayout?.modules || []).filter((m) => m.stack);
        expect(members.map((m) => `${m.id}:${m.at}`).join() === 'maps:0,polls:1,research:2' && new Set(members.map((m) => m.stack)).size === 1 && Math.abs(members.reduce((a, m) => a + m.h, 0) - 1) <= 0.01 && members.every((m) => typeof m.folded === 'boolean'), `${L} the saved layout does not carry the stack: ${JSON.stringify(savedLayout?.modules)}`);
        await closeMenus();

        // Unstack all (the Modules tab's Arrange): every module in a column of its own; past the limit the last one waits, floating.
        await showTab();
        expect((await menuItems()).some((x) => x.text === 'Unstack all' && !x.off), `${L} Arrange has no Unstack all while there is a stack`);
        // By the keyboard in light, by the pointer in dark: either way the keyboard stays in Arrange, on Panel Mode.
        if (mode === 'light') {
          await tab.eval(`[...document.querySelectorAll('#setup-show .host-menu-item')].find((b) => b.textContent.trim() === 'Unstack all').focus()`);
          await key('Enter');
          await sleep(450);
        } else {
          const u = await tab.eval(`(() => { const r = [...document.querySelectorAll('#setup-show .host-menu-item')].find((b) => b.textContent.trim() === 'Unstack all').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
          await tab.mouse('mouseMoved', u.x, u.y, { button: 'none', clickCount: 0 }); await tab.mouse('mousePressed', u.x, u.y); await tab.mouse('mouseReleased', u.x, u.y);
          await sleep(450);
        }
        const focusAt = await tab.eval(`document.activeElement?.closest('#setup-show') ? document.activeElement.textContent.trim() : (document.activeElement?.id || document.activeElement?.tagName)`);
        expect(focusAt === 'Panel Mode', `${L} after Unstack all the keyboard is on "${focusAt}", not Panel Mode in Arrange`);
        s = await state();
        expect(!s.groups.length && !s.docked.some((d) => d.stacked) && s.floats.includes('research') && /too narrow for another column/.test(s.said), `${L} Unstack all: ${JSON.stringify({ groups: s.groups, floats: s.floats, said: s.said })}`);
        expect((await menuItems()).some((x) => x.text === 'Unstack all' && x.off), `${L} Unstack all is still offered with no stack left`);
        await closeMenus();
        await showTab();
        await pick('Stacked');
        await sleep(1200);
        await closeMenus();
        s = await state();
        const near = (a, b) => { const x = a.split(','); const y = b.split(','); return x.length === y.length && x.every((v, i) => v.split(':')[0] === y[i].split(':')[0] && Math.abs(Number(v.split(':')[1]) - Number(y[i].split(':')[1])) <= 2); };
        expect(near(shape(s), want), `${L} loading the saved layout gives ${shape(s)}, not ${want}`);
        await tab.cdp.send('Page.reload', {}, tab.sid);
        await tab.waitFor('#canvas .module-docked.in-stack');
        await sleep(2500);
        expect(near(shape(await state()), want), `${L} after a reload the loaded stack is ${shape(await state())}, not ${want}`);

        // 14. Window Mode and back (Thomas, 2026-11-09): the stacks come back, with their order, heights and collapse, beside the
        // ordinary column; after a reload in between; closed up when a member was closed meanwhile; the layout saved in
        // between and after is one the server keeps.
        const arrangeTo = async (label) => { await showTab(); await pick(label); await closeMenus(); await sleep(900); };
        const whole = (st) => st.docked.filter((d) => d.stacked).sort((a, b) => a.top - b.top).map((d) => `${d.id}:${d.h}:${d.folded}`).join();
        const sameStack = (a, b) => { const x = a.split(','); const y = b.split(','); return Boolean(a) && x.length === y.length && x.every((v, i) => { const [ia, ha, fa] = v.split(':'); const [ib, hb, fb] = y[i].split(':'); return ia === ib && fa === fb && Math.abs(Number(ha) - Number(hb)) <= 2; }); };
        const saveLayout = async (name) => {
          await showTab();
          await pick('Save as new layout');
          await tab.waitFor('dialog.layout-sheet[open] input');
          await tab.eval(`(() => { const i = document.querySelector('dialog.layout-sheet[open] input:not([type]), dialog.layout-sheet[open] input[type=text]'); i.value = ${JSON.stringify(name)}; i.dispatchEvent(new Event('input', { bubbles: true })); [...document.querySelectorAll('dialog.layout-sheet[open] button')].find((b) => b.textContent.trim() === 'Save').click(); })()`);
          await sleep(1200);
          await closeMenus();
          const all = await tab.eval(`fetch('/api/spaces/${S.ctx.trip}/layouts').then((r) => r.json())`);
          return [...(all.mine || []), ...(all.shared || [])].find((x) => x.name === name) || null;
        };
        // Uneven heights and the lowest collapsed, in a stack of three beside the Itinerary.
        await tab.eval(`document.querySelectorAll('#canvas > .stack-divider')[0].focus()`);
        await key('ArrowDown'); await key('ArrowDown'); await key('ArrowDown');
        await tab.eval(`document.querySelector('.module-docked[data-module="research"] .stack-fold').click()`);
        await sleep(300);
        const three = whole(await state());
        expect(/research:36:true$/.test(three) && !(await state()).docked.find((d) => d.id === 'travel').stacked, `${L} the stack to put away is not three with Research collapsed beside the Itinerary: ${three}`);
        await arrangeTo('Window Mode');
        s = await state();
        expect(!s.groups.length && ['maps', 'polls', 'research'].every((id) => s.floats.includes(id)), `${L} Window Mode did not float the stack's modules: ${JSON.stringify(s)}`);
        const away = await stored();
        expect(Array.isArray(away.__stacks) && away.__stacks[0]?.ids?.join() === 'maps,polls,research' && !['maps', 'polls', 'research'].some((id) => 'stack' in (away[id] || {})), `${L} the stack is not kept aside in the remembered layout (and off the floating modules): ${JSON.stringify(away.__stacks)}`);
        const floatingSaved = await saveLayout('Windows');
        expect(floatingSaved && floatingSaved.modules.every((m) => !('stack' in m)), `${L} a layout saved in Window Mode was not kept as a plain one: ${JSON.stringify(floatingSaved)}`);
        await arrangeTo('Panel Mode');
        s = await state();
        expect(sameStack(whole(s), three) && !s.docked.find((d) => d.id === 'travel').stacked && s.groups.length === 1, `${L} Panel Mode brought back ${whole(s)}, not ${three}`);
        // A reload in Window Mode, then Panel Mode.
        await arrangeTo('Window Mode');
        await tab.cdp.send('Page.reload', {}, tab.sid);
        await tab.waitFor('.module-floating[data-module="maps"]');
        await sleep(2500);
        await arrangeTo('Panel Mode');
        s = await state();
        expect(sameStack(whole(s), three), `${L} after a reload in Window Mode, Panel Mode brought back ${whole(s)}, not ${three}`);
        // A member closed meanwhile: the other two come back as a stack of two, uneven as they were.
        await arrangeTo('Window Mode');
        await tab.eval(`document.querySelector('.module-floating[data-module="research"] .mf-close-btn').click()`);
        await sleep(400);
        await arrangeTo('Panel Mode');
        s = await state();
        const two = whole(s);
        expect(/^maps:\d+:false,polls:\d+:false$/.test(two) && s.groups.includes('Stacked: Maps, Polls') && Math.abs(s.docked.find((d) => d.id === 'maps').h - s.docked.find((d) => d.id === 'polls').h) > 20, `${L} with Research closed in Window Mode, Panel Mode brought back ${two}`);
        // A stack of two, there and back.
        await arrangeTo('Window Mode');
        await arrangeTo('Panel Mode');
        s = await state();
        expect(sameStack(whole(s), two), `${L} a stack of two came back as ${whole(s)}, not ${two}`);
        const backSaved = await saveLayout('Back');
        const back2 = (backSaved?.modules || []).filter((m) => m.stack);
        expect(back2.map((m) => `${m.id}:${m.at}`).join() === 'maps:0,polls:1' && Math.abs(back2.reduce((a, m) => a + (m.h || 0), 0) - 1) <= 0.01, `${L} the layout saved after Panel Mode does not carry the stack as the server keeps it: ${JSON.stringify(backSaved?.modules)}`);
        expect(!('__stacks' in (await stored())), `${L} the stacks put away are still kept after they came back`);
        // A phone keeps the stack's remembered width: reloading at 390 px (where a column is clamped) and then at 1280 gives the same dockW.
        const widths = async () => { const r = await stored(); return ['maps', 'polls'].map((id) => r[id]?.dockW).join(); };
        await tab.eval(`(() => { const k = ${JSON.stringify(KEY)}; const r = JSON.parse(localStorage.getItem(k) || '{}'); for (const id of ['maps', 'polls']) if (r[id]) r[id].dockW = 460; localStorage.setItem(k, JSON.stringify(r)); })()`);
        await tab.cdp.send('Page.reload', {}, tab.sid);
        await tab.waitFor('#canvas .module-docked.in-stack');
        await sleep(1500);
        expect(await widths() === '460,460', `${L} before the phone the stack's stored width is ${await widths()}, not 460,460`);
        await size(390, 844);
        await tab.cdp.send('Page.reload', {}, tab.sid);
        await tab.waitFor('#canvas .module-docked');
        await sleep(1500);
        expect(await widths() === '460,460', `${L} a reload at 390 px rewrote the stack's stored width: ${await widths()}`);
        await size(1280, 900);
        await tab.cdp.send('Page.reload', {}, tab.sid);
        await tab.waitFor('#canvas .module-docked.in-stack');
        await sleep(1500);
        expect(await widths() === '460,460', `${L} after 390 px and a reload at 1280 the stack's stored width is ${await widths()}, not 460,460`);

        if (errors.length) failures.push(`${L} the page threw: ${errors.slice(0, 3).join(' | ')}`);
        say(`${mode}: stacked by menu and drag, divider 8 px within 156 px by pointer and keys, collapse and the last one open, a fourth refused, one column of the limit, out by the drag, reload, close to one, composites refused, short canvas, phone, a saved layout's stack, Unstack all, Window Mode and back`);
      } finally {
        tab.cdp.listeners = tab.cdp.listeners.filter((f) => f !== listen);
        await tab.close();
      }
    }
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
