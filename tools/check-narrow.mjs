// check-narrow.mjs: three layout rules measured in the running product (headless Chromium, the screenshot seed), each at the
// size where it once broke.
//   1. Maps: its notice (#state, "Maps is not set up yet") sits in the content area, below the search field (the module frame's
//      toolbar field, .mf-search, in the module's window), never over it
//      (the Workspace with Maps open in a window; Maps' own page at 390 px).
//   2. Planner (Itinerary): in a narrow window (260 px) no word of a card's title is broken across lines (a word is only ever
//      split when it is longer than the line).
//   3. Budget: with no target, "Target left over time" has no empty band between its title and its words.
//   4. Budget's Costs: the sort is a button on the left of the row that says the order ("Sort: Date, earliest first"), shown
//      or folded into More but never cut, and not a filter: the Filters button counts nothing while nothing is filtered
//      (Thomas, 2026-10-29), at 1280 and 390 px.
//   5. Calendar: clicking an event in its window on the Workspace opens the editor window over the screen and leaves the
//      Calendar drawn in its window behind it (the window was left blank: the frame holding the page shrank to the
//      editor's size), at 1280 and 390 px; and the page keeps the layout it had: the frame keeps its width, so the page's
//      media queries answer as before (a 758 px window at 1280, a 600 px window at 1280, 390 px).
//   6. Banded cards (every module's, the shared head in public/sdk/system.css): in a card under 300px wide (Itinerary at 260
//      px) the kind label is above the title and the icon above both; a plain head (Polls at 260 px) whose title wraps keeps
//      4px between its text and the band's edges.
//   7. Budget's Costs in a thin column (240 and 200 px): no word of a cost's title is broken across lines (the amounts beside it
//      once left the title a letter wide).
//   8. A switch of 10 choices (icons only) beside a right-zone button (zone 'end', pinned) in a row at 390, 430, 560 and 1280 px: the row
//      is never cut, the right-zone button keeps its place at the far end past the More button, only the switch's LAST choices go
//      into More (more of them the narrower the row, at least two stay), the chosen choice always stays in the row (even the
//      last one), and the folded choices are the ones More offers.
// Usage: node tools/check-narrow.mjs. With no Chromium it says SKIPPED and exits 0 (a skip, never a pass).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

const say = (...a) => console.log('check-narrow:', ...a);
const failures = [];

// In the page: every shadow root (each bundled module runs in one), searched from the document.
const ROOTS = `const roots = []; (function walk(r) { roots.push(r); for (const x of r.querySelectorAll('*')) if (x.shadowRoot) walk(x.shadowRoot); })(document);`;
const shown = `const shown = (e) => e && !e.hidden && e.getClientRects().length > 0;`;

const MAPS = `(() => { ${ROOTS} ${shown}
  const out = [];
  for (const r of roots) { const st = r.querySelector('#state'); const win = r.host ? r.host.closest('.mf, .module-floating, body') : null; const se = win ? win.querySelector('.mf-toolbar .mf-search') : null;
    if (!shown(st) || st.querySelector('.sdk-skel')) continue;
    const a = st.getBoundingClientRect(); const own = a.top;
    const title = st.querySelector('.sdk-empty-title'); const t = title ? title.getBoundingClientRect() : null;
    out.push({ search: shown(se) ? se.getBoundingClientRect().bottom : null, state: own, title: t ? t.top : null, area: st.parentElement.getBoundingClientRect().top }); }
  return out; })()`;

const TITLES = `(() => { ${ROOTS}
  const out = [];
  for (const r of roots) for (const h of r.querySelectorAll('.card h3, .card .kicker + h3')) {
    if (!h.getClientRects().length) continue;
    const saved = h.innerHTML; const text = h.textContent;
    h.replaceChildren(...text.split(/(\\s+)/).map((w) => { if (/^\\s*$/.test(w)) return document.createTextNode(w); const s = document.createElement('span'); s.textContent = w; return s; }));
    for (const s of h.querySelectorAll('span')) if (s.getClientRects().length > 1) out.push({ title: text.trim(), word: s.textContent, width: Math.round(h.clientWidth) });
    h.innerHTML = saved; }
  return out; })()`;

// Budget's cost titles: each word that is drawn on more than one line (a word only splits when it is longer than the line).
const COSTS = `(() => { ${ROOTS}
  const out = [];
  for (const r of roots) for (const h of r.querySelectorAll('#view-costs .cost-row .title')) {
    if (!h.getClientRects().length) continue;
    const saved = h.innerHTML; const text = h.textContent; let word = '';
    h.replaceChildren(...text.split(/(\\s+)/).map((w) => { if (/^\\s*$/.test(w)) return document.createTextNode(w); const s = document.createElement('span'); s.textContent = w; return s; }));
    for (const s of h.querySelectorAll('span')) if (!word && s.getClientRects().length > 1) word = s.textContent;
    out.push({ title: text.trim(), word, width: Math.round(h.clientWidth) });
    h.innerHTML = saved; }
  return out; })()`;

const BURN = `(() => { ${ROOTS} ${shown}
  for (const r of roots) { const t = r.querySelector('#burn-tile'); if (!t || !shown(t)) continue;
    const head = t.querySelector('.sdk-card-title').getBoundingClientRect(); const words = t.querySelector('#burn-words').getBoundingClientRect();
    return { gap: Math.round(words.top - head.bottom), words: t.querySelector('#burn-words').textContent.trim() }; }
  return null; })()`;

const SORT = `(() => { ${shown}
  const bar = document.querySelector('#module-main .mf-toolbar'); if (!bar) return null;
  const sort = [...bar.querySelectorAll('.mf-btn')].find((b) => (b.getAttribute('aria-label') || '').startsWith('Sort: '));
  const filters = bar.querySelector('.mf-filters');
  const r = sort && sort.getBoundingClientRect(); const b = bar.getBoundingClientRect();
  return { name: sort ? sort.getAttribute('aria-label') : null, shown: Boolean(sort && shown(sort) && sort.offsetParent), moved: Boolean(sort && sort.classList.contains('is-moved')),
    inRow: Boolean(r && r.left >= b.left && r.right <= b.right), left: Boolean(r && filters && r.right <= filters.getBoundingClientRect().left),
    count: filters && filters.querySelector('.sdk-badge') ? filters.querySelector('.sdk-badge').textContent : '' }; })()`;

const BANDED = `(() => { ${ROOTS}
  const out = [];
  for (const r of roots) for (const c of r.querySelectorAll('.sdk-card-banded')) {
    const t = c.querySelector('.sdk-card-title'); const hd = c.querySelector('.sdk-card-head'); if (!t || !hd || !t.getClientRects().length) continue;
    const i = c.querySelector('.sdk-card-icon'); const k = c.querySelector('.sdk-card-sub.sdk-tint-text'); const tr = t.getBoundingClientRect(); const hr = hd.getBoundingClientRect();
    out.push({ title: t.textContent.trim(), width: Math.round(hr.width), lines: Math.round(tr.height / 20), iconAbove: i ? i.getBoundingClientRect().bottom <= tr.top + 1 : null, kindAbove: k ? k.getBoundingClientRect().top < tr.top : null, top: Math.round(tr.top - hr.top), bottom: Math.round(hr.bottom - tr.bottom) }); }
  return out; })()`;

async function view(browser, S, size, mode, screen, expr, wait = 1500) {
  const tab = new Tab(browser.cdp, S.ctx);
  await tab.open(size, mode, screen.call === true);
  const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
  try { await driveScreen(tab, screen, S.base, S.cookies, S.ctx); await sleep(wait); return await tab.eval(expr); } finally { await tab.close(); }
}

// In the Calendar's frame on the Workspace: where the first event is (screen pixels), the frame and the page's box, and what
// of the Calendar is still drawn (its lists' visible nodes) and whether its editor is open.
const CAL = (pick) => `(() => { const f = document.querySelector('iframe.composite-frame'); if (!f || !f.contentDocument) return null;
  const fr = f.getBoundingClientRect(); const d = f.contentDocument; const mf = d.querySelector('body > .mf'); if (!mf) return null;
  const roots = [...d.querySelectorAll('*')].filter((x) => x.shadowRoot).map((x) => x.shadowRoot).filter((r) => r.querySelector('#body'));
  let pos = null;
  if (${pick}) for (const r of roots) { const e = r.querySelector('#body [data-open]'); if (e && e.getClientRects().length) { const b = e.getBoundingClientRect(); pos = { x: fr.left + b.left + Math.min(b.width / 2, 40), y: fr.top + b.top + b.height / 2 }; break; } }
  const drawn = roots.reduce((n, r) => n + [...r.querySelectorAll('#body *')].filter((x) => x.getClientRects().length).length, 0);
  const m = mf.getBoundingClientRect();
  const cw = f.contentWindow;
  return { pos, mq: { m900: cw.matchMedia('(max-width: 900px)').matches, m640: cw.matchMedia('(max-width: 640px)').matches, iw: cw.innerWidth }, frame: { w: Math.round(fr.width), h: Math.round(fr.height), lifted: f.classList.contains('module-editor-lifted') }, page: { x: Math.round(m.left + fr.left), y: Math.round(m.top + fr.top), w: Math.round(m.width), h: Math.round(m.height) },
    drawn, open: roots.some((r) => { const e = r.querySelector('#editor'); return Boolean(e && e.open); }), win: { w: innerWidth, h: innerHeight } }; })()`;


// A real frame (public/module-frame.js) drawn in a box of the given width, a 10-choice switch and a right-zone button in its
// toolbar, with `value` chosen; what the row shows, and what More offers.
const FOLD = (w, value) => `(async () => {
  const { createModuleFrame } = await import('/module-frame.js');
  const box = document.createElement('div'); box.style.cssText = 'position:fixed;left:0;top:0;width:${w}px;height:200px;z-index:99999;background:#fff';
  document.body.append(box);
  const opts = Array.from({ length: 10 }, (_, k) => ({ id: 't' + k, label: 'Tool ' + k, icon: 'star', iconOnly: true }));
  const frame = createModuleFrame({ title: 'T', bands: { titlebar: false, status: false }, toolbar: [
    { type: 'switch', id: 'tool', label: 'Tools', value: '${value}', options: opts },
    { type: 'button', id: 'snap', label: 'Snap to grid', icon: 'border-all', kind: 'icon', zone: 'end', pin: true }], onAction: () => {} });
  box.append(frame.el); frame.fit();
  await new Promise((r) => setTimeout(r, 400)); frame.fit(); await new Promise((r) => setTimeout(r, 200));
  const tb = box.querySelector('.mf-toolbar'); const tr = tb.getBoundingClientRect();
  const shown = (e) => e.getClientRects().length > 0;
  const parts = [...tb.querySelectorAll('.mf-switch-btn')];
  const more = tb.querySelector('.mf-more'); const snap = tb.querySelector('.mf-zone-end');
  const out = { visible: parts.filter(shown).map((b) => b.getAttribute('aria-label')), current: parts.find((b) => b.getAttribute('aria-checked') === 'true')?.getAttribute('aria-label'),
    currentShown: shown(parts.find((b) => b.getAttribute('aria-checked') === 'true')), hiddenCount: parts.filter((b) => !shown(b)).length,
    moreShown: Boolean(more && shown(more)), snapShown: Boolean(snap && shown(snap)),
    snapRight: snap ? Math.round(snap.getBoundingClientRect().right) : null, snapLeft: snap ? Math.round(snap.getBoundingClientRect().left) : null,
    moreRight: more && shown(more) ? Math.round(more.getBoundingClientRect().right) : null, switchRight: Math.round(Math.max(...parts.filter(shown).map((b) => b.getBoundingClientRect().right))),
    width: Math.round(tr.width), cut: tb.scrollWidth > tb.clientWidth + 1 };
  if (out.moreShown) { more.click(); await new Promise((r) => setTimeout(r, 300)); const items = [...document.querySelectorAll('[role=menuitemradio], [role=menuitem], .sdk-menu-item')].filter(shown).map((e) => e.textContent.trim()); out.moreItems = items; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }
  box.remove(); return out; })()`;

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'narrow-data-'));
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    browser = await launch(bin);

    // 1. Maps' notice below its search field.
    const workspace = { id: 'workspace', as: 'mia', url: '/#join={trip}', wait: 'button.sdk-strip-fact[data-module=budget]', call: true };
    const page = { id: 'maps-page', as: 'mia', url: '/modules/maps?space={trip}', wait: '#module-frame >>> *' };
    for (const [name, size, screen] of [['Workspace 1280', 1280, workspace], ['Maps page 390', 390, page], ['Maps page 1280', 1280, page]]) {
      const got = await view(browser, S, size, 'light', screen, MAPS, 3000);
      const states = (got || []).filter((x) => x.search !== null);
      if (!states.length) failures.push(`${name}: Maps showed no notice with a search field (the seed has no map file), so nothing was measured`);
      for (const x of states) if (x.state < x.search - 0.5) failures.push(`${name}: the notice starts at ${Math.round(x.state)}px, over the search field that ends at ${Math.round(x.search)}px`);
      say(`${name}: ${states.length ? states.map((x) => `notice top ${Math.round(x.state)} / search bottom ${Math.round(x.search)}`).join('; ') : 'no search field over a notice'}`);
    }

    // 2. Itinerary in a narrow window: no word of a card title broken.
    const planner = { id: 'planner', as: 'mia', url: '/modules/travel?space={trip}', wait: '#module-frame >>> .day-add' };
    for (const size of [260, 220]) {
      const got = await view(browser, S, size, 'light', planner, TITLES);
      for (const x of got || []) failures.push(`Itinerary at ${size}px: the word "${x.word}" of "${x.title}" is broken across lines (title ${x.width}px wide)`);
      say(`Itinerary ${size}px: ${(got || []).length} broken words`);
    }

    // 3. Budget, no target: no empty band under the title. (The seed has no target.)
    const budget = { id: 'budget', as: 'mia', url: '/modules/budget?space={trip}', wait: '#module-frame >>> #target-edit' };
    for (const size of [1280, 390]) {
      const got = await view(browser, S, size, 'light', budget, BURN);
      if (!got) { failures.push(`Budget at ${size}px: the "Target left over time" card was not found`); continue; }
      if (got.gap > 16) failures.push(`Budget at ${size}px: ${got.gap}px between "Target left over time" and its words`);
      say(`Budget ${size}px: ${got.gap}px between the title and "${got.words}"`);
    }

    // 4. Budget's Costs: Sort is a button on the left that says the order, not a counted filter.
    const costs = { ...budget, id: 'budget-costs', steps: [{ click: 'button.mf-switch-btn', text: 'Costs', until: 'button.mf-filters' }] };
    for (const size of [1280, 390]) {
      const got = await view(browser, S, size, 'dark', costs, SORT);
      if (!got || !got.name) { failures.push(`Budget's Costs at ${size}px: no Sort button in the toolbar`); continue; }
      if (got.name !== 'Sort: Date, earliest first') failures.push(`Budget's Costs at ${size}px: the Sort button says "${got.name}", not the order ("Sort: Date, earliest first")`);
      if (!got.moved && !(got.shown && got.inRow && got.left)) failures.push(`Budget's Costs at ${size}px: the Sort button is neither in the row's left side nor in More`);
      if (got.count) failures.push(`Budget's Costs at ${size}px: the Filters button counts ${got.count} with nothing filtered (the sort is not a filter)`);
      say(`Budget's Costs ${size}px: "${got.name}" ${got.moved ? 'in More' : 'on the left of the row'}, Filters count ${got.count || 'none'}`);
    }

    // 5. Calendar: the editor window opens over the screen and the Calendar stays drawn in its window behind it.
    for (const [size, phone, win] of [[1280, false, 0], [390, true, 0], [1280, false, 758], [1280, false, 600]]) {
      const cal = { id: 'workspace', as: 'mia', url: '/#join={trip}', wait: 'button.sdk-strip-fact[data-module=budget]', call: true, space: true };
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(size, 'light', true);
      const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
      try {
        await driveScreen(tab, cal, S.base, S.cookies, S.ctx);
        if (phone) { await tab.eval(`document.querySelector('#layout-tab-calendar').click()`); await sleep(1000); } // a phone shows one module at a time
        if (win) { await tab.eval(`(() => { for (const w of document.querySelectorAll('.module-floating')) if (w.querySelector('iframe.composite-frame')) { w.style.width = '${win}px'; w.style.left = '20px'; } window.dispatchEvent(new Event('resize')); })()`); await sleep(1000); }
        await sleep(2500);
        const before = await tab.eval(CAL(true));
        if (!before || !before.pos) { failures.push(`Calendar at ${size}px: no event to click in its window, so nothing was measured`); continue; }
        await tab.mouse('mouseMoved', before.pos.x, before.pos.y); await tab.mouse('mousePressed', before.pos.x, before.pos.y); await tab.mouse('mouseReleased', before.pos.x, before.pos.y);
        await sleep(1500);
        const after = await tab.eval(CAL(false));
        const same = (a, b) => Math.abs(a - b) <= 1;
        if (!after.open) failures.push(`Calendar at ${size}px: clicking an event did not open the editor window`);
        if (!after.frame.lifted || after.frame.h !== after.win.h || Math.abs(after.frame.w - before.frame.w) > 1) failures.push(`Calendar at ${size}px${win ? ` (window ${win}px)` : ''}: the editor window does not cover the screen's height with the window's width (the frame is ${after.frame.w}x${after.frame.h} of ${after.win.w}x${after.win.h}, it was ${before.frame.w} wide)`);
        if (after.mq.m900 !== before.mq.m900 || after.mq.m640 !== before.mq.m640 || Math.abs(after.mq.iw - before.mq.iw) > 1) failures.push(`Calendar at ${size}px${win ? ` (window ${win}px)` : ''}: the page's media queries changed while the editor was open (max-width 900px ${before.mq.m900} -> ${after.mq.m900}, 640px ${before.mq.m640} -> ${after.mq.m640}, width ${before.mq.iw} -> ${after.mq.iw})`);
        if (!same(after.page.x, before.page.x) || !same(after.page.y, before.page.y) || !same(after.page.w, before.page.w) || !same(after.page.h, before.page.h)) failures.push(`Calendar at ${size}px: the Calendar moved from ${JSON.stringify(before.page)} to ${JSON.stringify(after.page)} when the editor opened (its window went blank)`);
        if (after.drawn < 1 || after.drawn < before.drawn * 0.8) failures.push(`Calendar at ${size}px: ${before.drawn} of its nodes were drawn before the editor opened and ${after.drawn} after (its list went blank)`);
        await tab.key('Escape'); await sleep(1200);
        const closed = await tab.eval(CAL(false));
        if (closed.open || closed.frame.lifted || !same(closed.page.x, before.page.x) || !same(closed.page.w, before.page.w) || !same(closed.page.h, before.page.h)) failures.push(`Calendar at ${size}px: after Escape the editor is ${closed.open ? 'still open' : 'closed'} and the Calendar is ${JSON.stringify(closed.page)}, not back in its window ${JSON.stringify(before.page)}`);
        say(`Calendar ${size}px${win ? ` (window ${win}px)` : ''}: media 900/640 ${before.mq.m900}/${before.mq.m640} -> ${after.mq.m900}/${after.mq.m640}; editor ${after.open ? 'open' : 'closed'}; frame ${after.frame.w}x${after.frame.h}; page box ${JSON.stringify(before.page)} -> ${JSON.stringify(after.page)}; ${before.drawn} -> ${after.drawn} nodes drawn`);
      } finally { await tab.close(); }
    }

    // 6. Banded cards under 300px: the kind label above the title, the icon above both; a wrapped plain head keeps 4px.
    const got6 = await view(browser, S, 260, 'light', planner, BANDED);
    const kinds = (got6 || []).filter((x) => x.kindAbove !== null);
    if (!kinds.length) failures.push('Banded cards at 260px: Itinerary showed no card with a kind label, so nothing was measured');
    for (const x of kinds) { if (!x.kindAbove) failures.push(`Banded card "${x.title}" (${x.width}px): the kind label is below the title`); if (x.iconAbove === false) failures.push(`Banded card "${x.title}" (${x.width}px): the icon is beside the title under 300px`); }
    say(`Banded cards 260px: ${kinds.length} with a kind label, ${kinds.filter((x) => x.kindAbove && x.iconAbove !== false).length} in order`);
    const polls = { id: 'polls', as: 'mia', url: '/modules/polls?space={trip}', wait: '#module-frame >>> .poll' };
    const got6b = (await view(browser, S, 260, 'light', polls, BANDED)) || [];
    const wrapped = got6b.filter((x) => x.lines >= 2 && x.kindAbove === null && x.iconAbove === null);
    if (!wrapped.length) failures.push('Banded cards at 260px: no poll question wrapped to two lines, so nothing was measured');
    for (const x of wrapped) if (x.top < 4 || x.bottom < 4) failures.push(`Poll "${x.title}" (${x.width}px): ${x.top}px above and ${x.bottom}px below its two-line title, under 4px`);
    say(`Polls 260px: ${wrapped.map((x) => `${x.top}/${x.bottom}px`).join(', ') || 'none wrapped'} between a wrapped title and the band's edges`);

    // 7. Budget's Costs in a thin column (docked at about 200px): no word of a cost's title is broken across lines (the amounts
    //    beside the title once left it a letter wide, one letter per line).
    for (const size of [240, 200]) {
      const got = (await view(browser, S, size, 'dark', costs, COSTS)) || [];
      if (!got.length) failures.push(`Budget's Costs at ${size}px: no cost was shown, so nothing was measured`);
      for (const x of got.filter((c) => c.word)) failures.push(`Budget's Costs at ${size}px: the word "${x.word}" of "${x.title}" is broken across lines (title ${x.width}px wide)`);
      say(`Budget's Costs ${size}px: ${got.length} costs, ${got.filter((c) => c.word).length} broken words, narrowest title ${Math.min(...got.map((c) => c.width))}px`);
    }

    // 8. A 10-choice switch with a right-zone button: only its last choices fold into More.
    const foldPage = { id: 'maps-page', as: 'mia', url: '/modules/maps?space={trip}', wait: '#module-frame >>> *' };
    let widest = 0;
    for (const [w, value] of [[390, 't0'], [430, 't0'], [560, 't0'], [390, 't9'], [1280, 't0']]) {
      const got = await view(browser, S, Math.max(w, 390), 'light', foldPage, FOLD(w, value), 1500);
      const tag = `A 10-choice switch at ${w}px (chosen ${value})`;
      if (!got) { failures.push(`${tag}: nothing was measured`); continue; }
      if (got.cut) failures.push(`${tag}: the row is cut`);
      if (!got.snapShown) failures.push(`${tag}: the right-zone button is not shown`);
      else if (got.snapRight < got.width - 20) failures.push(`${tag}: the right-zone button is not at the far end (${got.snapRight} of ${got.width})`);
      if (got.moreRight !== null && got.snapLeft < got.moreRight) failures.push(`${tag}: the right-zone button overlaps More`);
      if (got.snapLeft < got.switchRight) failures.push(`${tag}: the right-zone button overlaps the switch`);
      if (!got.currentShown) failures.push(`${tag}: the chosen choice is not in the row`);
      if (w <= 430) {
        if (got.visible.length < 2) failures.push(`${tag}: ${got.visible.length} choice(s) stayed in the row; at least two fit`);
        if (got.hiddenCount < 1 || !got.moreShown) failures.push(`${tag}: nothing folded into More`);
        else {
          const names = (got.moreItems || []).filter((x) => /^Tool \d$/.test(x));
          if (names.length !== got.hiddenCount) failures.push(`${tag}: More offers ${names.length} choices, ${got.hiddenCount} are folded`);
          if (names.some((n) => got.visible.includes(n))) failures.push(`${tag}: More offers a choice that is already in the row`);
        }
        if (value === 't0' && got.visible[0] !== 'Tool 0') failures.push(`${tag}: the first choice is not the one that stays first`);
      } else if (w >= 1000 && got.hiddenCount) failures.push(`${tag}: ${got.hiddenCount} choices folded where all fit`);
      if (value === 't0') { if (w === 390) widest = got.visible.length; if (w === 430 && got.visible.length <= widest) failures.push(`${tag}: no more choices stay than at 390 px`); }
      say(`${tag}: ${got.visible.length} in the row, ${got.hiddenCount} in More, right-zone button ${got.snapLeft}-${got.snapRight} of ${got.width}`);
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
