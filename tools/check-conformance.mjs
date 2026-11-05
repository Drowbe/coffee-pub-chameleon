// check-conformance.mjs: the module window is one component, the module frame (public/module-frame.js and the moduleframe
// block of public/sdk/system.css, approved on the Prototype page), measured in the running product. The design system's own checks read the CSS; this one loads the pages the way a person sees
// them and measures what the browser drew, so a module's own rule, a page that does not load the block, a container query or
// a selector that loses to another cannot make one module's band differ from another's without this failing.
//
// What it does. It starts a throwaway server with the screenshot seed (tools/shots.mjs, bootSeeded: the travel template, a
// trip with every bundled module on), adds a picture map so the Map is on too, and drives headless Chromium over its
// DevTools protocol:
//   - the Workspace at 1280 px in the light mode, with every module and both destinations (the Calendar and the Map) open,
//     docked as many as fit and the rest floating;
//   - the Workspace at 390 px in the dark mode, each module in turn through the phone's tab bar;
//   - each module's own page and each destination's page, at 1280 light and 390 dark.
// In each window it measures the bands (the title bar .mf-titlebar, the Chat's and the call's too; the toolbar .mf-toolbar, a
// destination's row and its panel's; any .sdk-toolbar a module drew, which has no look and so fails; the status bar
// .mf-status), every search field (the frame's .mf-search, any .sdk-search) and every control in a band, and holds them to
// the approved values in the moduleframe block (read from its tokens, so a value is changed in one place):
//   title bar --mf-title-h (36 px; 52 on a phone), its words 14 px, its first item --mf-inset (12 px) in and its last
//   --space-1 (4 px) from the end;
//   toolbar --mf-band-h (40 px; 56 on a phone; its hairline counted), its first item --mf-inset in; its end group (the search, then the
//   Filters button; or, where a host page has a right zone, that zone's last control) exactly --mf-inset from the end, the same
//   place in every window; with no end group, nothing closer;
//   status bar --mf-status-h (24 px), its first item --mf-inset in;
//   a search field and a control in a band (a button, the view switch, a tab, the "+", the menu, Close) --mf-ctl-h (28 px; 44 on a phone, a view switch's track 50);
//   the Filters button --mf-ctl-h too, a filter chip --mf-chip-h (24 px); nothing in a band is cut (its controls inside its padding);
//   a tab strip or view switch (the Tabs family in a band: the Chat's Discussion | Assistant row; the frame's switch and
//   tabs; and a row of tabs of a module's own, measured as a band of its own): centred in its band, as far from its top as
//   from its bottom;
//   the band under a title bar starts where the title bar ends (no room between them);
//   at 390 px (a phone), every button in a title bar or a toolbar has a tap area (its ::after, public/sdk/system.css, the
//   moduleframe block's tap areas) at least --mf-hit (44 px) tall and --mf-hit-w (36 px) wide, and no two tap areas overlap
//   (EXCEPTION: a joined view switch's choices and a tab strip's tabs touch, each its own width, so they are held to the
//   height and to not overlapping, not to the width).
// Every value is the same for every module by construction, so one table of expectations holds for all of them; a module
// may not differ. On a failure it prints, per module, every band and what it measured against what it should be.
//
// Robust to load: each page is waited for (its windows drawn, their frames filled, fonts in), then measured until two
// readings 300 ms apart agree; heights are compared to the half pixel. With no Chromium (CHROME_PATH, a Playwright or a
// system one) it says SKIPPED and exits 0: a skip, never a pass.
//
// Usage: node tools/check-conformance.mjs [--table] (--table prints every window's measurements, failing or not).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, fill, driveScreen } from './shots.mjs';

const HEIGHTS = process.argv.includes('--table');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7); // only the views whose name holds this text (for working on one)
const say = (...a) => console.log('check-conformance:', ...a);
const started = Date.now();

// The approved values: the moduleframe block's tokens (public/sdk/system.css), read from the file so the check follows the one
// place a value is changed. The same on every width (the Prototype: one frame at 1280 and at 390).
const FRAME = (() => {
  const sys = fs.readFileSync(path.join(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), 'public', 'sdk', 'system.css'), 'utf8');
  const block = sys.slice(sys.indexOf('/* moduleframe:start */'), sys.indexOf('/* moduleframe:end */'));
  const space = (n) => Number((sys.match(new RegExp(`--space-${n}: (\\d+)px;`)) || [])[1]);
  const tok = (name) => {
    const v = (block.match(new RegExp(`--${name}: ([^;]+);`)) || [])[1] || '';
    const px = /^(\d+)px$/.exec(v.trim());
    if (px) return Number(px[1]);
    const sp = /^var\(--space-(\d)\)$/.exec(v.trim());
    if (sp) return space(sp[1]);
    throw new Error(`the moduleframe block has no --${name} in pixels (got "${v}")`);
  };
  return { title: tok('mf-title-h'), toolbar: tok('mf-band-h'), status: tok('mf-status-h'), ctl: tok('mf-ctl-h'), chip: tok('mf-chip-h'), inset: tok('mf-inset'), end: space(1), hit: tok('mf-hit'), hitW: tok('mf-hit-w'), edge0: space(0) };
})();
const WANT = {
  title: FRAME.title, titleFont: 14, titleLeft: FRAME.inset, titleRight: FRAME.end, toolbar: FRAME.toolbar, toolbarLeft: FRAME.inset, toolbarEnd: FRAME.inset,
  status: FRAME.status, statusLeft: FRAME.inset, search: FRAME.ctl, button: FRAME.ctl, chip: FRAME.chip,
};

// A whole small PMTiles v3 picture (as tools/check-picture-map.mjs makes one), so the Map destination is on in the space.
function picture() {
  const dir = zlib.gzipSync(Buffer.from([1, 0, 1, 4, 1]));
  const tile = Buffer.from([1, 2, 3, 4]);
  const head = Buffer.alloc(127);
  head.write('PMTiles', 0, 'ascii'); head.writeUInt8(3, 7);
  head.writeBigUInt64LE(127n, 8); head.writeBigUInt64LE(BigInt(dir.length), 16);
  head.writeBigUInt64LE(BigInt(127 + dir.length), 56); head.writeBigUInt64LE(BigInt(tile.length), 64);
  head.writeUInt8(1, 97); head.writeUInt8(2, 98); head.writeUInt8(2, 99); head.writeUInt8(0, 100); head.writeUInt8(4, 101);
  [-180, -85, 180, 85].forEach((d, i) => head.writeInt32LE(Math.round(d * 1e7), 102 + i * 4));
  return Buffer.concat([head, dir, tile]);
}

// ---- in the page: find every module window and measure it ----
// Answers { ready, windows: [{ name, kind, bands: [{ band, h, left, right, font?, buttons: [h...] }], searches: [h...] }] }.
// `ready` is false while a window's frame is still empty (a shadow root with nothing in it, a frame still loading).
const COLLECT = String.raw`(() => {
  const R = (e) => e.getBoundingClientRect();
  const shown = (e) => { if (!e || !e.getClientRects().length) return false; const r = R(e); if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none'; };
  const kids = (band) => [...band.children].filter((k) => shown(k) && !k.classList.contains('visually-hidden') && !['absolute', 'fixed'].includes(getComputedStyle(k).position));
  const px = (v) => Math.round(v * 2) / 2;
  const STRIPS = '.sdk-tabs, .tb-tabs, .subtabs, .setup-tabs, .mf-switch, .mf-tabs';
  const TABS = '.sdk-tab, .tb-tab, .subtab, .setup-tab, .mf-switch-btn, .mf-tab';
  // The controls of a band: the frame's (its buttons, its switch whole, its tabs, its search's magnifier, its Filters) and any
  // shared button a band holds (the Chat's and the call's). A chip-sized control is the Filters button or a filter chip.
  const CONTROLS = '.mf-btn, .mf-icon-btn, .mf-switch, .mf-tab, .mf-tabs-menu, .mf-chip, .mf-chips-menu, .btn, .sdk-icon-btn, .tb-tab';
  let ready = true;
  // Every root under a node: itself, the shadow roots below it and the documents of same-origin frames below it.
  const roots = (node) => {
    const out = [node];
    const walk = (r) => { for (const e of r.querySelectorAll('*')) { if (e.shadowRoot) { out.push(e.shadowRoot); walk(e.shadowRoot); } if (e.tagName === 'IFRAME') { let d = null; try { d = e.contentDocument; } catch (x) { d = null; } if (d && d.body) { if (d.readyState !== 'complete') ready = false; out.push(d.body); walk(d.body); } else ready = false; } } };
    walk(node);
    return out;
  };
  // A rectangle in the top page's coordinates (a frame's own are offset by where the frame is).
  const offsetOf = (e) => { let x = 0; let y = 0; let w = e.ownerDocument.defaultView; while (w && w.frameElement) { const f = w.frameElement.getBoundingClientRect(); x += f.left; y += f.top; w = w.parent; } return { x, y }; };
  const band = (kind, el) => {
    const r = R(el); const s = getComputedStyle(el);
    const k = kids(el);
    const bl = r.left + parseFloat(s.borderLeftWidth); const br = r.right - parseFloat(s.borderRightWidth);
    // The start inset is the start group's (a toolbar's end group, the search and Filters, has its own fixed place below).
    const startKids = k.filter((x) => !x.matches('.mf-spacer, .mf-search, .mf-search-open, .mf-filters'));
    const left = startKids.length ? px(Math.min(...startKids.map((x) => R(x).left)) - bl) : null;
    const right = k.length ? px(br - Math.max(...k.map((x) => R(x).right))) : null;
    const out = { band: kind, h: px(r.height), left, right, buttons: [], strips: [] };
    if (kind === 'title') { const t = el.querySelector('.mf-titlebar-title'); if (t) out.font = parseFloat(getComputedStyle(t).fontSize); }
    // Its end group (the frame's search, then its Filters button): where it ends, from the band's end (its padding counted).
    if (kind === 'toolbar') {
      const ends = [...el.children].filter((k) => shown(k) && k.matches('.mf-search, .mf-search-open, .mf-filters'));
      // A host page's right zone (the Calendar destination's Agenda / To-do switch, .mf-zone-end) is the row's last thing: it takes the
      // fixed place at the end, and the search and Filters button stand just before it.
      const zone = [...el.children].filter((k) => shown(k) && k.matches('.mf-zone-end'));
      if (zone.length) out.endAt = px(br - Math.max(...zone.map((x) => R(x).right)));
      else if (ends.length) out.endAt = px(br - Math.max(...ends.map((x) => R(x).right)));
      // Nothing cut: every control inside the band's padding (its scroll width its width).
      out.cut = el.scrollWidth > el.clientWidth + 1;
    }
    for (const b of el.querySelectorAll(CONTROLS)) {
      if (!shown(b) || b.closest('.sdk-search, .mf-search') || (b.matches('.mf-switch-btn, .tb-tab') && b.closest('.mf-switch'))) continue;
      if (b.matches('.mf-chip') && b.closest('.mf-quickset, .mf-chips')) { out.buttons.push({ h: px(R(b).height), chip: true, what: (b.textContent || '').trim().slice(0, 24) }); continue; }
      if (b.matches('.tb-tab, .mf-tab')) continue; // a tab is measured with its strip
      out.buttons.push({ h: px(R(b).height), chip: b.matches('.mf-chip, .mf-chips-menu:not(.mf-filters)'), what: (b.getAttribute('aria-label') || b.textContent || b.className).trim().replace(/\s+/g, ' ').slice(0, 24) });
    }
    // The tap areas of its buttons (on a phone, each button's ::after; elsewhere the button itself), in the top page's
    // coordinates: the title bar's buttons, and the toolbar's (not the search field's own close button).
    out.taps = [];
    const TAPS = kind === 'title' ? ':scope .mf-titlebar-tools > button' : kind === 'toolbar' ? '.mf-btn, .mf-icon-btn, .mf-chips-menu, .mf-tabs-menu, .mf-tab, .mf-chip, .mf-switch-btn, .btn-small' : null;
    if (TAPS) for (const b of el.querySelectorAll(TAPS)) {
      if (!shown(b) || b.closest('.mf-search')) continue;
      const br0 = R(b); const bs = getComputedStyle(b); const a = getComputedStyle(b, '::after'); const o = offsetOf(b);
      const grows = a.content !== 'none' && a.position === 'absolute';
      const n = (v) => parseFloat(v) || 0;
      const box = grows
        ? { x0: br0.left + n(bs.borderLeftWidth) + n(a.left), x1: br0.right - n(bs.borderRightWidth) - n(a.right), y0: br0.top + n(bs.borderTopWidth) + n(a.top), y1: br0.bottom - n(bs.borderBottomWidth) - n(a.bottom) }
        : { x0: br0.left, x1: br0.right, y0: br0.top, y1: br0.bottom };
      out.taps.push({ what: (b.getAttribute('aria-label') || b.textContent || b.className).trim().replace(/\s+/g, ' ').slice(0, 24), joined: b.matches('.mf-switch-btn, .mf-tab'), x0: px(box.x0 + o.x), x1: px(box.x1 + o.x), y0: px(box.y0 + o.y), y1: px(box.y1 + o.y) });
    }
    out.at = { x: Math.round(r.left + offsetOf(el).x), y: Math.round(r.top + offsetOf(el).y) };
    out.top = px(r.top + offsetOf(el).y); out.bottom = px(r.bottom + offsetOf(el).y); out.x0 = px(r.left + offsetOf(el).x); out.x1 = px(r.right + offsetOf(el).x);
    // The tab strips and view switches in the band (the Tabs family): each tab's height and the space above and below it in the band,
    // to the band's inner edges (its hairline is the edge between two levels, not extra space: the frame centres its controls in the band
    // above it).
    const it = r.top + parseFloat(s.borderTopWidth); const ib = r.bottom - parseFloat(s.borderBottomWidth);
    for (const st of el.querySelectorAll(STRIPS)) {
      if (!shown(st) || st.closest('.sdk-search, .sdk-menu, .host-menu, [role=dialog]')) continue;
      const tabs = st.matches('.mf-switch') ? [st] : [...st.children].filter((t) => shown(t) && t.matches(TABS));
      if (!tabs.length) continue;
      const rr = tabs.map(R);
      out.strips.push({ what: (st.id || st.className || '').toString().trim().split(/\s+/).slice(0, 2).join('.'), h: px(Math.max(...rr.map((x) => x.height))), hMin: px(Math.min(...rr.map((x) => x.height))), above: px(Math.min(...rr.map((x) => x.top)) - it), below: px(ib - Math.max(...rr.map((x) => x.bottom))) });
    }
    return out;
  };
  const windows = [];
  const seen = new Set();
  const measure = (name, kind, win, titleSel) => {
    const w = { name, kind, bands: [], searches: [] };
    const title = titleSel ? win.querySelector(titleSel) : null;
    if (title && shown(title)) { w.bands.push(band('title', title)); seen.add(title); }
    for (const r of roots(win)) {
      for (const t of r.querySelectorAll('.mf-titlebar')) if (shown(t) && !seen.has(t)) { seen.add(t); w.bands.push(band('title', t)); }
      for (const t of r.querySelectorAll('.mf-toolbar, .sdk-toolbar')) if (shown(t) && !seen.has(t)) { seen.add(t); w.bands.push(band('toolbar', t)); }
      for (const t of r.querySelectorAll('.mf-status')) if (shown(t) && !seen.has(t)) { seen.add(t); w.bands.push(band('status', t)); }
      // A tab strip or view switch outside those bands (a row of a module's own) is a band of its own: the row that holds it.
      for (const st of r.querySelectorAll(STRIPS)) {
        if (!shown(st) || st.closest('.mf-titlebar, .mf-toolbar, .sdk-toolbar, .mf-status, .sdk-field, .sdk-menu, .host-menu, [role=dialog], .sdk-editor, .pp-tools')) continue;
        const row = st.parentElement && st.parentElement !== r && st.parentElement.children.length > 1 ? st.parentElement : st;
        if (!seen.has(row)) { seen.add(row); w.bands.push(band('tabrow', row)); }
      }
      for (const f of r.querySelectorAll('.sdk-search, .mf-search')) if (shown(f) && !seen.has(f)) { seen.add(f); w.searches.push({ h: px(R(f).height), what: (f.className || '').replace(/sdk-search|mf-search/, '').trim() || 'search' }); }
      for (const m of r.querySelectorAll('.module-root')) { const sr = m.shadowRoot || m; if (!sr.querySelector('#app, .app, main, section, div')) ready = false; }
    }
    windows.push(w);
  };
  const nameOf = (win) => { const t = win.querySelector('.mf-titlebar-title'); return t ? t.textContent.trim() : '?'; };
  // Every module window is a frame: docked, floating, a composite (its page's own frame inside it), a module's own page and a
  // destination's page; the Chat draws the frame's bands in its own column.
  for (const win of document.querySelectorAll('.module-docked > .mod-content > .mf, .module-floating, #chat-content, body > .mf, .module-canvas > .mf')) {
    if (!shown(win)) continue;
    const kind = win.matches('.module-floating') ? 'floating' : win.id === 'chat-content' ? 'chat' : win.matches('.mf-docked') ? 'docked' : document.body.matches('.destination-page') ? 'destination page' : 'own page';
    measure(nameOf(win), kind, win, ':scope > .mf-titlebar, :scope > .mf > .mf-titlebar, :scope > .chat-head');
  }
  return { ready, windows };
})()`;

// ---- the contexts ----
async function openTab(browser, S, size, mode, url, { call = false, before = null } = {}) {
  const tab = new Tab(browser.cdp, S.ctx);
  await tab.open(size, mode, call);
  await cssOn(tab); // before the page loads: on a loaded space page CSS.enable can take longer than the protocol's wait
  for (const c of S.cookies.mia) await browser.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: S.base, httpOnly: true }, tab.sid);
  if (before) await browser.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: before }, tab.sid);
  await browser.cdp.send('Page.navigate', { url: S.base + fill(url, S.ctx) }, tab.sid);
  return tab;
}
// Measured once the page holds still: ready, and two readings 300 ms apart the same.
async function settled(tab, wantWindows = 1) {
  // Fonts in and the document loaded (not every request done: the space page keeps asking, and the readings below wait for
  // the page to hold still instead).
  await tab.eval(`(async () => { try { await document.fonts.ready; } catch (e) {} return document.readyState; })()`).catch(() => null);
  const end = Date.now() + 20000;
  let last = '';
  while (Date.now() < end) {
    const got = await tab.eval(COLLECT).catch(() => null);
    if (got && got.ready && got.windows.length >= wantWindows) {
      const key = JSON.stringify(got.windows);
      if (key === last) return got.windows;
      last = key;
    }
    await sleep(300);
  }
  const got = await tab.eval(COLLECT).catch(() => null);
  if (!got) throw new Error('the page could not be measured');
  return got.windows;
}

const failures = [];

// ---- padding symmetry: a box owns its padding ----
// Each box of a shared family (below) that has an edge or a fill of its own: its content (the boxes of its children in the flow
// and its own words) as far from its top edge as from its bottom one, and, where its content fills its width (a card's lines, a
// chip's words), as far from its left edge as from its right; and the children of a stack (a card's lines, a message's words and
// cards) one gap apart. A child's margin that adds to the box's padding is what breaks it. Measured to the whole pixel, within 1px.
// `h: false`: only top and bottom (a band's or a row's content is laid from the start, so its end is wherever the content ends).
const SYMMETRY_FAMILIES = [
  { sel: '.message .chat-object, .message .chat-link', name: 'chat card', h: true, stack: '.chat-object' },
  { sel: '.message .message-body', name: 'message body', h: false, stack: '*', box: false },
  { sel: '.sdk-card:not(.sdk-card-banded)', name: 'card', h: true, stack: '*', stackExcept: '.sdk-card-foot' },
  { sel: '.user-card, .space-choice, .sdk-card-add, .space-choice-add', name: 'card (page)', h: false },
  { sel: ['.sdk-pan' + 'el', '.pan' + 'el'].join(', '), name: 'content box', h: false, stack: '*' },
  { sel: '.sdk-row', name: 'row', h: false },
  { sel: '.sdk-card-head, .message-head', name: 'band head', h: false },
  { sel: '.sdk-card-banded, .message', name: 'banded box', h: false, box: false, stack: '*' },
  { sel: '.sdk-chip, .sdk-strip-chip', name: 'chip', h: true, hExcept: '.sdk-strip-phase, .sdk-strip-attn' },
  { sel: '.mf-titlebar, .mf-toolbar, .sdk-toolbar, .mf-status', name: 'band', h: false },
  { sel: '.sdk-search, .mf-search', name: 'search field', h: false },
  { sel: '.btn, .tb-tab, .mf-btn, .mf-tab, .mf-switch-btn, .mf-chips-menu, .mf-tabs-menu', name: 'button', h: false },
  { sel: '.sdk-menu, .host-menu, .chat-command-menu, .sdk-kind-list', name: 'menu', h: false },
  { sel: '.sdk-menu-item, .host-menu-item, .chat-command-item, .sdk-kind-option', name: 'menu item', h: false },
  { sel: '.sdk-popover, .popover, .bell-list, .who-here-list, .chat-help-popup, .chat-emoji-popup, .sdk-dp', name: 'popover', h: false },
  { sel: '.sdk-editor-head, .phase-sheet-head, .bgpick-head, .sdk-dialog-head, .sdk-editor-actions, .sdk-editor-discard, .bgpick-foot, .sdk-dialog-foot, .action-bar', name: 'dialog band', h: false },
  { sel: '.sdk-editor > form, .layout-form-body, .sdk-dialog-body, .phase-sheet-body', name: 'dialog body', h: false, box: false, stack: '*', stackExcept: '.sdk-editor-actions, .sdk-editor-discard, .sdk-section' },
  { sel: '.sdk-toast, .sdk-banner', name: 'toast', h: false },
  { sel: '.sdk-empty', name: 'empty state', h: true },
  { sel: '.sdk-choice-row, .sdk-choice-boxed', name: 'choice row', h: false },
];
// EXCEPTIONS, each with its reason:
// - a banded box's body (.message-body, .sdk-card-body: 8px under the head band, 12px at the foot) is approved as 8/12/12 (Cards,
//   the banded card): its top sits against the band, not an edge, so it is not held to top = bottom;
// - the phase chip (.sdk-strip-phase) starts with its round dot 8px in and ends 10px after its words: the approved optical
//   correction (public/design-system/legacy/system-v1/proposed-journey.css, the Journey bar family), so it is held to top = bottom only;
// - a card with its "..." laid in its corner (an absolutely placed small button) keeps room for it at its end (the card's padding
//   plus the button), so it is held to top = bottom only;
// - a box that scrolls (its content taller than it) or whose content overflows it is not measured;
// - a card's foot (.sdk-card-foot) sits one step further from what is above it (8px gap and 4px: the approved Cards value), so the
//   gap before it is not held to the card's other gaps;
// - a box stretched by its row (cards in a grid or flex line as tall as the tallest) is judged at its own height: the room under
//   its content is the row's, not its padding;
// - the strip's attention pill (.sdk-strip-attn) starts with its icon: 6px before it and 8px after the count (4 and 6 on a phone),
//   the approved Journey bar value (public/design-system/legacy/system-v1/proposed-journey.css), so it is not held to left = right;
// - a dialog's button row (.sdk-editor-actions, or the discard row in its place) is a band of its own over a hairline, --pad-dialog-y
//   under the last field, so the gap before it is not held to the fields' gap; nor is the gap before a form's section (.sdk-section,
//   its title over a hairline --section-gap, 20px, under the field before: the form standard, public/sdk/host.css).
const SYMMETRY = String.raw`((families) => {
  const R = (e) => e.getBoundingClientRect();
  const shown = (e) => e && e.getClientRects().length && R(e).width >= 1 && R(e).height >= 1 && getComputedStyle(e).visibility !== 'hidden';
  const out = [];
  const allRoots = () => { const list = [document]; const walk = (r) => { for (const e of r.querySelectorAll('*')) { if (e.shadowRoot) { list.push(e.shadowRoot); walk(e.shadowRoot); } if (e.tagName === 'IFRAME') { try { const d = e.contentDocument; if (d && d.body) { list.push(d); walk(d); } } catch (x) {} } } }; walk(document); return list; };
  const roots = allRoots();
  const label = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + [...e.classList].slice(0, 3).map((c) => '.' + c).join('');
  for (const f of families) {
    for (const r of roots) for (const el of r.querySelectorAll(f.sel)) {
      if (!shown(el) || el.dataset.symmetryChecked) continue;
      el.dataset.symmetryChecked = '1';
      const cs = getComputedStyle(el);
      if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll|hidden/.test(cs.overflowY) && f.name !== 'band') continue;
      const kids = [...el.children].filter((k) => shown(k) && !['absolute', 'fixed'].includes(getComputedStyle(k).position) && !k.classList.contains('visually-hidden'));
      const inset = () => {
        const b = R(el);
        const inner = { top: b.top + parseFloat(cs.borderTopWidth), bottom: b.bottom - parseFloat(cs.borderBottomWidth), left: b.left + parseFloat(cs.borderLeftWidth), right: b.right - parseFloat(cs.borderRightWidth) };
        const parts = [];
        for (const k of kids) parts.push(R(k));
        // A bare text's range is its glyphs' box; its line box is that plus half the leading above and below (CSS puts it so).
        const lh = parseFloat(cs.lineHeight);
        for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { const rg = document.createRange(); rg.selectNodeContents(n); for (const x of rg.getClientRects()) { const half = lh > x.height ? (lh - x.height) / 2 : 0; parts.push({ top: x.top - half, bottom: x.bottom + half, left: x.left, right: x.right }); } }
        if (!parts.length) return null;
        const c = { top: Math.min(...parts.map((x) => x.top)), bottom: Math.max(...parts.map((x) => x.bottom)), left: Math.min(...parts.map((x) => x.left)), right: Math.max(...parts.map((x) => x.right)) };
        return { t: Math.round(c.top - inner.top), bo: Math.round(inner.bottom - c.bottom), l: Math.round(c.left - inner.left), ri: Math.round(inner.right - c.right) };
      };
      let got = inset();
      if (!got) continue;
      // A box stretched by its row (a grid or flex line of cards as tall as the tallest) is taller than its content by layout,
      // not by padding: measured again at its own height (for the moment of the reading) and judged on that.
      const parent = el.parentElement || (el.getRootNode() && el.getRootNode().host);
      if (f.box !== false && Math.abs(got.t - got.bo) > 1 && got.bo > got.t && parent && /flex|grid/.test(getComputedStyle(parent).display)) {
        const keep = el.getAttribute('style');
        el.style.setProperty('height', 'auto', 'important'); el.style.setProperty('align-self', 'start', 'important'); el.style.setProperty('flex-grow', '0', 'important');
        const own = inset();
        if (keep === null) el.removeAttribute('style'); else el.setAttribute('style', keep);
        if (own && Math.abs(own.t - own.bo) <= 1) got = own;
      }
      const { t, bo, l, ri } = got;
      if (t < 0 || bo < 0 || l < 0 || ri < 0) continue; // content past the edge: overflow, not padding
      const why = [];
      if (f.box !== false && Math.abs(t - bo) > 1) why.push('top ' + t + ' / bottom ' + bo);
      // Left and right only where the content runs from one padding edge to the other (a chip shrunk to its words, a card's
      // lines); a box wider than its content (a stretched chip, a row) lays it from the start, which is alignment, not padding.
      const reach = (v, pad) => v <= Math.round(pad) + 1;
      const cornerBtn = [...el.children].some((k) => getComputedStyle(k).position === 'absolute' && k.matches('.sdk-icon-btn, .sdk-more, .sdk-card-menu, [data-action=menu]'));
      if (f.box !== false && f.h && !cornerBtn && !(f.hExcept && el.matches(f.hExcept)) && Math.abs(l - ri) > 1 && reach(l, parseFloat(cs.paddingLeft)) && reach(ri, parseFloat(cs.paddingRight))) why.push('left ' + l + ' / right ' + ri);
      if (f.stack && (f.stack === '*' || el.matches(f.stack)) && kids.length > 2) {
        // Only a column: each part below the one before (a row of parts, a grid or a wrapped cluster is not a stack). A part's
        // negative bottom margin takes back space inside it by design (a form row's last 12px, the form standard), so its end is drawn back by it.
        const gaps = []; for (let i = 1; i < kids.length; i++) if (!(f.stackExcept && kids[i].matches(f.stackExcept))) gaps.push(Math.round(R(kids[i]).top - (R(kids[i - 1]).bottom + Math.min(0, parseFloat(getComputedStyle(kids[i - 1]).marginBottom) || 0))));
        if (gaps.length > 1 && gaps.every((g) => g >= -1) && Math.max(...gaps) - Math.min(...gaps) > 1) why.push('gaps ' + gaps.join(', '));
      }
      if (why.length) {
        const n = (window.__symN = (window.__symN || 0) + 1);
        el.dataset.symmetryOffender = String(n);
        // The children whose top or bottom margin adds to the padding or the gap: tagged, so the check can name the rule that sets it.
        const marginKids = kids.filter((k) => { const m = getComputedStyle(k); return parseFloat(m.marginTop) || parseFloat(m.marginBottom); }).slice(0, 4);
        marginKids.forEach((k, i) => { k.dataset.symmetryKid = n + '-' + i; });
        out.push({ n, kids: marginKids.length, sides: why.map((w) => w.split(' ')[0]), family: f.name, el: label(el), says: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40), why: why.join('; '), padding: cs.padding, margins: marginKids.map((k) => { const m = getComputedStyle(k); return label(k) + ' ' + m.marginTop + ' ' + m.marginBottom; }).join(' | ') });
      }
    }
  }
  for (const r of roots) for (const e of r.querySelectorAll('[data-symmetry-checked]')) delete e.dataset.symmetryChecked;
  return out;
})(${JSON.stringify(SYMMETRY_FAMILIES)})`;
const symmetryRows = [];
const screensMeasured = new Set();
// The app's screens measured for padding symmetry (ids in tools/shots-screens.json), each at 1280 px light and/or 390 px dark.
// The host console (a hosted server's /host pages) is not here: the seeded server is a single environment, which has none.
const BOTH = [1280, 390];
const SCREENS = [
  ['home-member', BOTH], ['home-admin', [1280]], ['home-empty', BOTH], ['home-user-menu', [1280]], ['home-notifications', [1280]],
  ['home-chat-message-menu', [390]], ['home-chat-slash', [1280]],
  ['manage-environment', BOTH], ['manage-users', BOTH], ['manage-modules', BOTH], ['manage-spaces', [1280]], ['manage-roles', [1280]],
  ['manage-template', [1280]], ['manage-theme', [1280]], ['manage-about', [390]], ['manage-module-config', [1280]],
  ['profile-profile', BOTH], ['profile-spaces', [1280]], ['profile-background-picker', [1280]],
  ['space-setup-space', [1280]], ['space-setup-members', [1280]], ['space-setup-phases', [1280]], ['space-setup-opens-with', [1280]], ['space-setup-modules', [1280]],
  ['space-setup-space-phone', [390]], ['space-setup-members-phone', [390]], ['space-setup-phases-phone', [390]], ['space-setup-modules-phone', [390]],
  ['space-phase-sheet', BOTH], ['space-layout-save-sheet', [1280]],
  ['planner-form-note', BOTH], ['places-form-add', [1280]], ['budget-form-target', [390]], ['polls-form-new', [1280]],
  ['space-menu-layout', [1280]], ['space-menu-user', [390]], ['space-menu-who-here', [1280]], ['planner-day-menu', [1280]], ['places-item-menu', [1280]],
  ['places-toast', [1280]],
  ['planner-empty', [1280]], ['places-empty', [390]], ['budget-empty', [1280]], ['polls-empty', [1280]], ['research-empty', [390]], ['space-empty', [1280]],
  ['login', BOTH],
];

// ---- the rule that wins: for each offender, the file and selector that set the padding or the margin that broke it ----
// Over the DevTools protocol (DOM and CSS): the element's matched rules, the last one (or the inline style, or an !important one)
// that sets the property or its shorthand. A rule in a stylesheet with an address names the file and line; one in an inline
// <style> (a module in the page: its host.css, system.css and own CSS in one sheet in its shadow root) is found by its selector
// in the stylesheets of the repository.
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let cssSources = null;
function sourceFiles() {
  if (cssSources) return cssSources;
  const out = [];
  const add = (f) => { try { out.push({ rel: path.relative(ROOT, f), lines: fs.readFileSync(f, 'utf8').split('\n') }); } catch { /* none */ } };
  for (const f of fs.readdirSync(path.join(ROOT, 'public'))) if (f.endsWith('.css')) add(path.join(ROOT, 'public', f));
  for (const f of fs.readdirSync(path.join(ROOT, 'public', 'sdk'))) if (f.endsWith('.css')) add(path.join(ROOT, 'public', 'sdk', f));
  for (const m of fs.readdirSync(path.join(ROOT, 'modules'))) { const d = path.join(ROOT, 'modules', m, 'src'); if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (f.endsWith('.css')) add(path.join(d, f)); }
  cssSources = out;
  return out;
}
function findSelector(selector, inModule) {
  const first = selector.trim().replace(/\s+/g, ' ');
  const forms = [first, first.replace(/:host/g, 'body'), first.replace(/:host/g, 'html')];
  const files = sourceFiles();
  const order = inModule ? [...files.filter((f) => f.rel.startsWith('modules')), ...files.filter((f) => f.rel.startsWith('public/sdk')), ...files.filter((f) => !f.rel.startsWith('modules') && !f.rel.startsWith('public/sdk'))] : files;
  for (const exact of [true, false]) {
    for (const f of order) {
      const i = f.lines.findIndex((l) => forms.some((x) => exact ? (l.trim().startsWith(x + ' {') || l.trim().startsWith(x + ',') || l.trim() === x + ' {') : l.includes(x)));
      if (i >= 0) return `${f.rel}:${i + 1}`;
    }
  }
  return 'an inline <style>';
}
const SHORT = { 'padding-top': ['padding-top', 'padding-block', 'padding-block-start', 'padding'], 'padding-bottom': ['padding-bottom', 'padding-block', 'padding-block-end', 'padding'], 'padding-left': ['padding-left', 'padding-inline', 'padding-inline-start', 'padding'], 'padding-right': ['padding-right', 'padding-inline', 'padding-inline-end', 'padding'], 'margin-top': ['margin-top', 'margin-block', 'margin-block-start', 'margin'], 'margin-bottom': ['margin-bottom', 'margin-block', 'margin-block-end', 'margin'], gap: ['gap', 'row-gap'] };
async function cssOn(tab) {
  if (tab.css) return;
  tab.css = { sheets: new Map() };
  const hook = (m) => { if (m.sessionId === tab.sid && m.method === 'CSS.styleSheetAdded') tab.css.sheets.set(m.params.header.styleSheetId, m.params.header); };
  tab.cdp.listeners.push(hook);
  tab.css.hook = hook;
  await tab.cdp.send('DOM.enable', {}, tab.sid);
  await tab.cdp.send('CSS.enable', {}, tab.sid);
}
async function winningRules(tab, find, props) {
  const s = (m, p) => tab.cdp.send(m, p, tab.sid);
  try {
    await cssOn(tab);
    await s('DOM.getDocument', { depth: -1, pierce: true });
    const r = await s('Runtime.evaluate', { expression: `(() => { ${find} })()`, returnByValue: false });
    if (!r.result || !r.result.objectId) return [];
    const { nodeId } = await s('DOM.requestNode', { objectId: r.result.objectId });
    if (!nodeId) return [];
    const m = await s('CSS.getMatchedStylesForNode', { nodeId });
    const out = [];
    for (const prop of props) {
      const names = SHORT[prop] || [prop];
      const sets = (style) => (style && style.cssProperties || []).filter((p) => names.includes(p.name) && p.value && !p.disabled && p.parsedOk !== false).pop();
      let win = null;
      const inline = sets(m.inlineStyle);
      const rules = (m.matchedCSSRules || []).filter((x) => x.rule.origin !== 'user-agent');
      for (let i = rules.length - 1; i >= 0 && !win; i--) { const d = sets(rules[i].rule.style); if (d && d.important) win = { rule: rules[i].rule, d }; }
      if (!win && inline) win = { inline: true, d: inline };
      for (let i = rules.length - 1; i >= 0 && !win; i--) { const d = sets(rules[i].rule.style); if (d) win = { rule: rules[i].rule, d }; }
      if (!win) continue;
      if (win.inline) { out.push(`${prop}: the element's own style (${win.d.name}: ${win.d.value})`); continue; }
      const sel = win.rule.selectorList.text.replace(/\s+/g, ' ');
      const head = tab.css.sheets.get(win.rule.styleSheetId);
      let where;
      if (head && head.sourceURL && !head.isInline) { where = `${head.sourceURL.replace(/^https?:\/\/[^/]+\//, 'public/').replace(/\?.*$/, '')}:${(win.rule.style.range ? win.rule.style.range.startLine : 0) + 1}`; }
      else where = findSelector(win.rule.selectorList.text, true);
      out.push(`${prop} from ${where} ${sel.slice(0, 110)} { ${win.d.name}: ${win.d.value} }`);
    }
    return [...new Set(out)];
  } catch (e) { return [`(the rule could not be read: ${e.message})`]; }
}
async function closeTab(tab) { if (tab.css) tab.cdp.listeners = tab.cdp.listeners.filter((f) => f !== tab.css.hook); await tab.close(); }
const deepFind = (attr, value) => `const walk = (r) => { const e = r.querySelector('[${attr}="${value}"]'); if (e) return e; for (const x of r.querySelectorAll('*')) { if (x.shadowRoot) { const f = walk(x.shadowRoot); if (f) return f; } } return null; }; return walk(document);`;

async function symmetry(tab, context) {
  const list = await tab.eval(SYMMETRY).catch((e) => [{ family: 'load', el: '-', why: e.message, padding: '', margins: '' }]);
  for (const o of list) {
    const key = `${o.family} ${o.el}: ${o.why}`;
    if (symmetryRows.some((x) => x.key === key)) continue; // the same box in another view says nothing new
    const rules = [];
    if (o.n) {
      const props = [];
      if (o.sides.includes('top')) props.push('padding-top', 'padding-bottom');
      if (o.sides.includes('left')) props.push('padding-left', 'padding-right');
      if (o.sides.includes('gaps')) props.push('gap');
      rules.push(...await winningRules(tab, deepFind('data-symmetry-offender', o.n), props));
      for (let i = 0; i < o.kids; i++) rules.push(...(await winningRules(tab, deepFind('data-symmetry-kid', `${o.n}-${i}`), ['margin-top', 'margin-bottom'])).map((r) => `child ${i + 1}: ${r}`));
    }
    symmetryRows.push({ key, context, ...o, rules });
    failures.push({ context, window: o.el, what: `padding symmetry (${o.family})`, got: o.why, should: 'symmetrical' });
  }
  await tab.eval(`(() => { const all = [document]; const walk = (r) => { for (const e of r.querySelectorAll('*')) if (e.shadowRoot) { all.push(e.shadowRoot); walk(e.shadowRoot); } }; walk(document); for (const r of all) for (const e of r.querySelectorAll('[data-symmetry-offender], [data-symmetry-kid]')) { delete e.dataset.symmetryOffender; delete e.dataset.symmetryKid; } })()`).catch(() => {});
}
const results = [];
// On a phone (640 px and narrower) the buttons are drawn --mf-hit tall (#394): a control and the search are --mf-hit, the title bar
// 8 px more, the toolbar 12 px more, a view switch's track its parts plus its edge and padding.
const PHONE_WANT = { ...WANT, title: FRAME.hit + 8, toolbar: FRAME.hit + 12, search: FRAME.hit, button: FRAME.hit };
function judge(context, phone, windows) {
  const want = phone ? PHONE_WANT : WANT;
  for (const w of windows) {
    const rows = [];
    const bad = (what, got, should) => { failures.push({ context, window: `${w.name} (${w.kind})`, what, got, should }); rows.push(`    !! ${what}: ${got}, should be ${should}`); };
    // The band under the title bar (a toolbar, a view switch, a tab row) starts where the title bar ends: no room between them
    // (a destination's frame once drew its page's header padding there, so its band read 4 px taller than the others).
    const title = w.bands.find((b) => b.band === 'title');
    for (const b of w.bands) {
      if (!title || b === title || !['toolbar', 'tabrow'].includes(b.band)) continue;
      const gap = b.top - title.bottom;
      if (gap > 0.5 && gap <= 12 && b.x0 < title.x1 && b.x1 > title.x0) bad(`gap between the title bar and the ${b.band} under it`, `${gap}px`, '0px');
    }
    for (const b of w.bands) {
      const exp = b.band === 'title' ? want.title : b.band === 'toolbar' || b.band === 'tabrow' ? want.toolbar : want.status;
      if (b.band === 'tabrow') { /* a module's own row of tabs: its height is its own; its tabs are held below */ }
      rows.push(`    ${b.band.padEnd(8)} h ${String(b.h).padStart(5)}  in ${b.left ?? '-'} / ${b.right ?? '-'}${b.endAt !== undefined ? `  end group ${b.endAt}` : ''}${b.font ? `  words ${b.font}px` : ''}  controls ${b.buttons.map((x) => x.h).join(',') || '-'}  at ${b.at.x},${b.at.y}`);
      for (const st of b.strips) rows.push(`      tabs ${st.what.padEnd(22)} h ${st.hMin === st.h ? st.h : `${st.hMin}-${st.h}`}  above ${st.above} / below ${st.below}`);
      // The status bar of a page that ends the screen grows by the home-indicator inset (0 here: no phone's safe area).
      if (b.band !== 'tabrow' && Math.abs(b.h - exp) > 0.5) bad(`${b.band} height`, b.h, exp);
      // The Tabs family in a band (system.css, tabs and moduleframe): a strip or view switch sits in its band centred, as far from
      // the band's top as from its bottom (its hairline counted, to the half pixel); the band's first item --mf-inset in.
      if (b.band === 'tabrow') {
        if (b.left !== null && Math.abs(b.left - want.toolbarLeft) > 0.5) bad('tab row inset, start', b.left, want.toolbarLeft);
        if (b.right !== null && b.right < want.toolbarLeft - 0.5) bad('tab row inset, end', b.right, `at least ${want.toolbarLeft}`);
      }
      for (const st of b.strips) {
        // A strip in a band (the frame's switch and tabs, the Chat's tab strip) is the frame's control height; a module's own row of
        // tabs (a tab row) its small tabs, 30 px.
        const tabWant = b.band === 'tabrow' && !/mf-(switch|tabs)/.test(st.what) ? 30 : phone && /mf-switch/.test(st.what) ? FRAME.hit + 2 + 2 * FRAME.edge0 : want.button;
        if (Math.abs(st.h - tabWant) > 0.5 || Math.abs(st.hMin - tabWant) > 0.5) bad(`tab height in the ${b.band} (${st.what})`, st.hMin === st.h ? st.h : `${st.hMin}-${st.h}`, tabWant);
        if (b.band !== 'tabrow' && Math.abs(st.above - st.below) > 0.5) bad(`tabs centred in the ${b.band} (${st.what})`, `above ${st.above} / below ${st.below}`, 'the same above and below');
      }
      if (b.band === 'title') {
        if (b.font && b.font !== want.titleFont) bad('title words', `${b.font}px`, `${want.titleFont}px`);
        if (b.left !== null && Math.abs(b.left - want.titleLeft) > 0.5) bad('title bar inset, start', b.left, want.titleLeft);
        // EXCEPTION: the Chat's title bar ends under the side column's own toggle (#side-column-toggle, laid over the bar's end,
        // style.css), so its tools stop 40 px from the end: 4 px, the 28 px toggle and the 8 px around it.
        const endWant = w.kind === 'chat' ? 40 : want.titleRight;
        if (b.right !== null && Math.abs(b.right - endWant) > 0.5) bad('title bar inset, end', b.right, endWant);
      }
      if (b.band === 'toolbar') {
        if (b.left !== null && Math.abs(b.left - want.toolbarLeft) > 0.5) bad('toolbar inset, start', b.left, want.toolbarLeft);
        if (b.right !== null && b.right < want.toolbarEnd - 0.5) bad('toolbar inset, end', b.right, `at least ${want.toolbarEnd}`);
        // The end group (the search, then Filters) in its fixed place: exactly --mf-inset from the end in every window.
        if (b.endAt !== undefined && Math.abs(b.endAt - want.toolbarEnd) > 0.5) bad('toolbar end group (search, Filters) inset', b.endAt, want.toolbarEnd);
        if (b.cut) bad('toolbar: a control cut', 'scrolls', 'nothing cut (it folds into More)');
      }
      if (b.band === 'status' && b.left !== null && Math.abs(b.left - want.statusLeft) > 0.5) bad('status bar inset, start', b.left, want.statusLeft);
      for (const x of b.buttons) {
        // Every control in a band is the frame's --mf-ctl-h, on every width (the Prototype at 390 too), the Filters button too; a
        // filter chip is the chip's --mf-chip-h.
        const should = x.chip ? want.chip : phone && /^View$/.test(x.what) ? FRAME.hit + 2 + 2 * FRAME.edge0 : want.button;
        if (Math.abs(x.h - should) > 0.5) bad(`control in the ${b.band} (${x.what})`, x.h, should);
      }
    }
    for (const s of w.searches) {
      rows.push(`    search   h ${String(s.h).padStart(5)}  ${s.what}`);
      if (Math.abs(s.h - want.search) > 0.5) bad(`search field (${s.what})`, s.h, want.search);
    }
    // On a phone: every button's tap area --mf-hit tall and --mf-hit-w wide (a joined choice or a tab: its own width), and
    // no two overlapping (to the half pixel).
    if (phone) {
      const taps = w.bands.flatMap((b) => (b.taps || []).map((t) => ({ ...t, band: b.band })));
      if (taps.length) rows.push(`    taps     ${taps.map((t) => `${t.what || '?'} ${Math.round((t.x1 - t.x0) * 2) / 2}x${Math.round((t.y1 - t.y0) * 2) / 2}`).join(', ')}`);
      for (const t of taps) {
        const tw = t.x1 - t.x0; const th = t.y1 - t.y0;
        if (th < FRAME.hit - 0.5) bad(`tap area height in the ${t.band} (${t.what})`, th, `at least ${FRAME.hit}`);
        if (!t.joined && tw < FRAME.hitW - 0.5) bad(`tap area width in the ${t.band} (${t.what})`, tw, `at least ${FRAME.hitW}`);
      }
      for (let i = 0; i < taps.length; i++) for (let j = i + 1; j < taps.length; j++) {
        const a = taps[i]; const b = taps[j];
        const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0); const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        if (ox > 0.5 && oy > 0.5) bad(`tap areas overlap (${a.what} and ${b.what})`, `${Math.round(ox * 2) / 2}x${Math.round(oy * 2) / 2}px`, 'none');
      }
    }
    results.push({ context, head: `  ${w.name} (${w.kind})`, rows, failed: rows.some((r) => r.includes('!!')) });
  }
}

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.'); return 0; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conformance-data-'));
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    const admin = boot.cookies.admin.map((c) => `${c.name}=${c.value}`).join('; ');
    const api = (method, url, body, type = 'application/json') => fetch(S.base + url, { method, headers: { cookie: admin, 'content-type': type }, body: Buffer.isBuffer(body) ? body : JSON.stringify(body) });
    // The Map: a picture map for Maps, and the Map on in the top bar, so the space's canvas has the Map composite too.
    const up = await api('PUT', '/api/modules/maps/files/image-map?name=world.pmtiles', picture(), 'application/octet-stream');
    if (!up.ok) throw new Error(`the picture map was refused: ${up.status} ${await up.text()}`);
    const map = await api('PATCH', '/api/settings', { showMap: true });
    if (!map.ok) throw new Error(`the Map could not be turned on: ${map.status}`);
    const mods = await (await fetch(S.base + `/api/modules?space=${S.ctx.trip}`, { headers: { cookie: admin } })).json().catch(() => ({}));
    const list = (Array.isArray(mods) ? mods : mods.modules || []).filter((m) => m && m.enabled !== false);
    const pages = list.filter((m) => m.surfaces && (m.surfaces.page || m.surfaces.canvas)).map((m) => m.id);

    browser = await launch(bin);
    const jobs = [];
    // 1. The Workspace, wide and light: everything open (the canvas's own remembered list), docked as far as they fit.
    jobs.push(['Workspace, 1280', async () => {
      const open = ['dest:calendar', 'dest:map', 'research', 'travel', 'budget', 'polls', 'assistant'];
      const before = `try { localStorage.setItem('app.canvas.${S.ctx.trip}', ${JSON.stringify(JSON.stringify({ __open: open }))}); } catch (e) {}`;
      const tab = await openTab(browser, S, 1280, 'light', '/#join={trip}', { call: true, before });
      try {
        await tab.waitFor('.mf-titlebar .mf-titlebar-title', '', 45000);
        await sleep(2500);
        judge('Workspace, 1280 px, light', false, await settled(tab, 4));
        await symmetry(tab, 'Workspace, 1280 px, light');
        // The status strip (the Journey bar family) owns its row's inset: its first chip var(--space-3) from the window's start and
        // nothing closer than that to its end (where a fact gave way, the bar does not always take its room back: space.js fitFacts).
        const stripExpr = `(() => { const s = document.querySelector('.sdk-strip'); if (!s || !s.getClientRects().length) return null; const k = [...s.children].filter((e) => e.getClientRects().length && e.getBoundingClientRect().width > 0); return { left: Math.round(Math.min(...k.map((e) => e.getBoundingClientRect().left))), right: Math.round(innerWidth - Math.max(...k.map((e) => e.getBoundingClientRect().right))) }; })()`;
        // Read until two readings 300 ms apart agree (the facts give way one by one as the bar finds its room).
        let strip = null; let prev = '';
        for (let n = 0; n < 30; n++) { strip = await tab.eval(stripExpr); const key = JSON.stringify(strip); if (key === prev) break; prev = key; await sleep(300); }
        const rows = [`    strip    in ${strip ? `${strip.left} / ${strip.right}` : 'none'}`];
        if (!strip || strip.left !== 12 || strip.right < 12) { failures.push({ context: 'Workspace, 1280 px, light', window: 'status strip', what: 'status strip inset', got: strip ? `${strip.left} / ${strip.right}` : 'none', should: '12 / at least 12' }); rows.push(`    !! status strip inset: ${strip ? `${strip.left} / ${strip.right}` : 'none'}, should be 12 / at least 12`); }
        results.push({ context: 'Workspace, 1280 px, light', head: '  Status strip', rows, failed: rows.length > 1 });
      } finally { await closeTab(tab); }
    }]);
    // 2. The Workspace on a phone, dark: each module through the tab bar.
    jobs.push(['Workspace, 390', async () => {
      const tab = await openTab(browser, S, 390, 'dark', '/#join={trip}', { call: true });
      try {
        await tab.waitFor('#modules-menu [data-module]', '', 45000);
        await sleep(1500);
        const ids = await tab.eval(`[...document.querySelectorAll('#modules-menu [data-module]')].map((b) => b.dataset.module)`);
        for (const id of ids) {
          await tab.eval(`(() => { const b = document.querySelector('#modules-menu [data-module="${id}"]'); if (b) b.click(); })()`);
          await sleep(600);
          const wins = (await settled(tab, 1)).filter((w) => w.kind !== 'chat');
          judge(`Workspace, 390 px, dark: ${id}`, true, wins);
          await symmetry(tab, `Workspace, 390 px, dark: ${id}`);
        }
      } finally { await closeTab(tab); }
    }]);
    // 2b. The Filters menu follows the picks made in it while it is open (QA e6a659d): three single choices in a row each show as
    // the one chosen (the module draws its row again between them), and Clear filters unmarks them.
    jobs.push(['Filters menu', async () => {
      const tab = await openTab(browser, S, 1280, 'light', '/modules/budget?space={trip}');
      const ctx = 'Budget, 1280 px, light: the Filters menu';
      const bad = (what, got, should) => failures.push({ context: ctx, window: 'Budget (own page)', what, got, should });
      const checkedIn = `(() => { const m = document.querySelector('.host-menu'); if (!m) return null; const rows = [...m.querySelectorAll('[role=menuitemradio]')]; return rows.filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.textContent.trim().replace(/\\s*\\d+$/, '')); })()`;
      const click = (expr) => tab.eval(`(() => { const b = ${expr}; if (b) b.click(); return Boolean(b); })()`);
      try {
        await tab.waitFor('.mf-switch-btn', '', 45000);
        await sleep(1000);
        await click(`[...document.querySelectorAll('.mf-switch-btn')].find((b) => b.textContent.trim() === 'Costs')`);
        await sleep(800);
        if (!(await click(`document.querySelector('button.mf-filters')`))) { bad('Filters button', 'none', 'one'); return; }
        await sleep(400);
        let last = null;
        for (const name of ['Travel', 'Lodging', 'Food']) {
          const found = await click(`[...document.querySelectorAll('.host-menu [role=menuitemradio]')].find((r) => r.textContent.trim().startsWith('${name}'))`);
          if (!found) { bad(`the option ${name}`, 'missing', 'in the menu'); continue; }
          await sleep(700);
          last = await tab.eval(checkedIn);
          const cat = (last || []).filter((x) => !/^(Date|Amount|Title|Anyone|Nobody|Paid)/.test(x));
          if (cat.length !== 1 || cat[0] !== name) bad(`after picking ${name}, the menu marks`, JSON.stringify(cat), `["${name}"]`);
        }
        if (!(await click(`[...document.querySelectorAll('.host-menu .host-menu-item')].find((r) => r.textContent.trim() === 'Clear filters')`))) bad('Clear filters', 'missing', 'in the menu');
        await sleep(700);
        const after = (await tab.eval(checkedIn)) || [];
        if (!after.includes('All categories') || after.some((x) => ['Travel', 'Lodging', 'Food'].includes(x))) bad('after Clear filters, the menu marks', JSON.stringify(after), 'All categories, nothing picked');
        results.push({ context: ctx, head: '  Filters menu', rows: [`    marked after the last pick: ${JSON.stringify(last)}; after Clear filters: ${JSON.stringify(after)}`], failed: false });
      } finally { await closeTab(tab); }
    }]);
    // 3. Each module's own page and each destination's page.
    const urls = [...pages.map((id) => `/modules/${id}?space={trip}`), '/calendar', '/map'];
    for (const url of urls) {
      for (const [size, mode] of [[1280, 'light'], [390, 'dark']]) {
        jobs.push([`${url} ${size}`, async () => {
          const tab = await openTab(browser, S, size, mode, url);
          try {
            await sleep(1500);
            const view = `${url.replace('?space={trip}', '')}, ${size} px, ${mode}`;
            judge(view, size <= 640, await settled(tab, 1));
            await symmetry(tab, view);
          } finally { await closeTab(tab); }
        }]);
      }
    }
    // 4. The app's own pages and states, from the screenshot table (tools/shots-screens.json): Home, Manage, Profile, Set up,
    // the phase sheet, dialogs, menus, a toast, empty states. Padding symmetry only (the bands above are the modules' windows).
    // They run after the windows above (a space page's strip shows the Budget's fact once the Workspace has opened it), with the
    // Map off and its picture map removed (with a map file, Places is part of the Map and /modules/places goes to /map).
    const screenJobs = [];
    const screenList = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'shots-screens.json'), 'utf8')).screens;
    for (const [id, sizes] of SCREENS) {
      const screen = screenList.find((x) => x.id === id);
      if (!screen) { failures.push({ context: 'screens', window: id, what: 'no such screen in tools/shots-screens.json', got: '', should: '' }); continue; }
      for (const size of sizes) {
        const mode = size <= 640 ? 'dark' : 'light';
        screenJobs.push([`${id} ${size}`, async () => {
          const tab = new Tab(browser.cdp, S.ctx);
          await tab.open(size, mode, screen.call === true);
          await cssOn(tab);
          // The screenshot's settle waits up to 15 s for no request in flight; a space page with no call server keeps one open, so
          // every step would wait it out. Measuring needs the fonts in and the page drawn: the same probe, 3 s at most.
          const settle = tab.settle.bind(tab);
          tab.settle = () => Promise.race([settle(), sleep(3000)]);
          try {
            await driveScreen(tab, screen, S.base, S.cookies, S.ctx);
            await sleep(300);
            const view = `${id}, ${size} px, ${mode}`;
            screensMeasured.add(view);
            await symmetry(tab, view);
          } finally { await closeTab(tab); }
        }]);
      }
    }
    const keep = (name) => !ONLY || ONLY.split(',').some((x) => name.includes(x));
    const width = Math.min(4, Math.max(2, os.cpus().length));
    const times = [];
    const pool = async (todo) => { let i = 0; await Promise.all(Array.from({ length: width }, async () => { while (i < todo.length) { const [jobName, job] = todo[i++]; const t0 = Date.now(); try { await job(); } catch (e) { failures.push({ context: 'load', window: jobName, what: e.message, got: '', should: '' }); } times.push([jobName, Date.now() - t0]); } })); };
    await pool(jobs.filter(([name]) => keep(name)));
    const off = await api('PATCH', '/api/settings', { showMap: false });
    if (!off.ok) throw new Error(`the Map could not be turned off: ${off.status}`);
    const gone = await api('DELETE', '/api/modules/maps/files/world.pmtiles?folder=image-map');
    if (!gone.ok) throw new Error(`the picture map could not be removed: ${gone.status} ${await gone.text()}`);
    await pool(screenJobs.filter(([name]) => keep(name)));
    if (process.env.CONFORMANCE_TIMES) for (const [n, ms] of times.sort((a, b) => b[1] - a[1]).slice(0, 15)) say(`${String(Math.round(ms / 100) / 10).padStart(5)} s  ${n}`);

    const contexts = [...new Set(results.map((t) => t.context))];
    if (HEIGHTS || failures.length) {
      for (const c of contexts) {
        const ts = results.filter((t) => t.context === c && (HEIGHTS || t.failed));
        if (!ts.length) continue;
        console.log(c);
        for (const t of ts) { console.log(t.head); for (const r of t.rows) console.log(r); }
      }
    }
    if (symmetryRows.length) {
      console.log('Padding symmetry: each box (family, element), what differs, its padding and its children\'s margins (top bottom):');
      for (const o of symmetryRows) {
        console.log(`  ${o.family.padEnd(24)} ${o.el.padEnd(44)}${o.says ? ` "${o.says}"` : ''} ${o.why}  padding ${o.padding}${o.margins ? `  child margins ${o.margins}` : ''}  (${o.context})`);
        for (const r of o.rules || []) console.log(`      ${r}`);
      }
    }
    for (const f of failures.filter((x) => x.context === 'load')) console.log(`  could not measure ${f.window}: ${f.what}`);
    const windows = results.length;
    if (failures.length) {
      const byWhat = new Map();
      for (const f of failures) byWhat.set(f.what.replace(/ \(.*\)$/, ''), (byWhat.get(f.what.replace(/ \(.*\)$/, '')) || 0) + 1);
      say(`FAIL: ${failures.length} deviations in ${new Set(failures.map((f) => f.context + f.window)).size} of ${windows} windows (${[...byWhat].map(([k, n]) => `${k} ${n}`).join(', ')}); ${Math.round((Date.now() - started) / 1000)} s`);
      return 1;
    }
    say(`${windows} windows in ${contexts.length} views and ${screensMeasured.size} screens measured; every title bar, toolbar, tab row, status bar, search and band control is the frame's size, every toolbar's search and Filters in their fixed place and nothing cut, every tab strip in a band centred, every band under a title bar meets it, every title bar and toolbar button on a phone has a tap area ${FRAME.hit} px tall and ${FRAME.hitW} wide with none overlapping, and every box measured holds its padding symmetrical; ${Math.round((Date.now() - started) / 1000)} s`);
    return 0;
  } finally {
    try { if (browser) { browser.cdp.ws.close(); browser.child.kill(); fs.rmSync(browser.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } } catch { /* best effort */ }
    await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().then((c) => process.exit(c), (e) => { console.error('check-conformance: ERROR ' + (e.stack || e)); process.exit(1); });
