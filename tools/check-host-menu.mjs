#!/usr/bin/env node
/*
 * check-host-menu.mjs -- a menu's categories and their flyouts (Thomas, 2026-10-13), and the module titlebar's "...".
 *
 * public/menu-flyout.js holds the pure rules: whether a category flies out or drills in, where its flyout goes, whether
 * the pointer is on its way to it, and what a key does. The page's shared menu (public/host-menu.js) imports them; the
 * SDK's host.menu.show (public/sdk/host.js) carries a copy of the block between the markers. This fails when:
 *   - a rule gives the wrong answer for one of the cases below;
 *   - the SDK's copy is not word for word the same as menu-flyout.js's block, or does not give the same answers;
 *   - either menu stops drawing a category as a flyout (aria-haspopup, aria-expanded, a role="menu" flyout) or stops
 *     using the rules;
 *   - a module's titlebar draws Dock, Window or Pop out again, or its "..." stops offering them (canvas.js);
 *   - a menu row's "..." (`more`) stops flying out beside its row (a drill-in with Back only at 640px and below);
 *   - either menu stops honouring `tip`, or a row whose tip is its full wording ("Add a flight" for "Flight") is not
 *     heard by it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
import os from 'node:os';
// Copied to a .mjs so Node reads it as the module it is (the package has no "type").
const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'check-host-menu-')), 'menu-flyout.mjs');
fs.copyFileSync(path.join(ROOT, 'public/menu-flyout.js'), copy);
const rules = await import(pathToFileURL(copy).href);
fs.rmSync(path.dirname(copy), { recursive: true, force: true });

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; } catch (err) { failures.push(`${name}: ${err.message}`); }
}

// The block between the markers, each line's indent taken off.
const START = '// --- menu-flyout ---';
const END = '// --- end menu-flyout ---';
function block(text) {
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a < 0 || b < a) return null;
  return text.slice(a, b + END.length).split('\n').map((l) => l.replace(/^\s+/, '')).join('\n');
}
const ownBlock = block(read('public/menu-flyout.js'));
const sdkSrc = read('public/sdk/host.js');
const sdkBlock = block(sdkSrc);
// The SDK's copy, run on its own, for the same answers.
// Its answers come from another realm: copied into this one so they compare as plain values.
const sdkRaw = sdkBlock ? vm.runInNewContext(`${sdkBlock}\n({ MENU_NARROW, submenuStyle, flyoutPlace, inSafeZone, menuStep, menuKeyAction })`) : null;
const sdkRules = sdkRaw && Object.fromEntries(Object.entries(sdkRaw).map(([k, v]) => [k, typeof v === 'function' ? (...a) => { const out = v(...a); return out && typeof out === 'object' ? JSON.parse(JSON.stringify(out)) : out; } : v]));

for (const [who, r] of [['menu-flyout.js', rules], ['the SDK\'s copy', sdkRules]]) {
  test(`${who}: flyout or drill`, () => {
    assert.ok(r, 'the block is there');
    const { submenuStyle } = r;
    assert.equal(r.MENU_NARROW, 640);
    assert.equal(submenuStyle({ width: 1280 }), 'flyout', 'a wide window: flyout');
    assert.equal(submenuStyle({ width: 641 }), 'flyout');
    assert.equal(submenuStyle({ width: 640 }), 'drill', '640px and below drills in');
    assert.equal(submenuStyle({ width: 390 }), 'drill', 'a phone drills in');
    assert.equal(submenuStyle({}), 'drill', 'no width known: the safe way');
    // A module's frame is the module's width, not the window's.
    assert.equal(submenuStyle({ width: 460, framed: true, boxWidth: 460, need: 420 }), 'flyout', 'a docked module wide enough: flyout');
    assert.equal(submenuStyle({ width: 360, framed: true, boxWidth: 360, need: 420 }), 'drill', 'too narrow for both: drill');
    assert.equal(submenuStyle({ width: 460, framed: true, touch: true, boxWidth: 460, need: 420 }), 'drill', 'a touch screen: drill');
    assert.equal(submenuStyle({ width: 900, framed: true, touch: true }), 'flyout', 'a wide frame flies out, touch or not');
  });

  test(`${who}: where the flyout goes`, () => {
    const { flyoutPlace } = r;
    const view = { w: 1280, h: 800 };
    const size = { w: 200, h: 240 };
    assert.deepEqual(flyoutPlace({ row: { left: 100, right: 320, top: 150 }, size, view }), { x: 322, y: 146, side: 'right' }, 'it fits on the right: beside it, level with its row');
    assert.deepEqual(flyoutPlace({ row: { left: 1000, right: 1220, top: 150 }, size, view }), { x: 798, y: 146, side: 'left' }, 'near the right edge: flipped to the left');
    assert.deepEqual(flyoutPlace({ row: { left: 100, right: 320, top: 700 }, size, view }), { x: 322, y: 556, side: 'right' }, 'near the bottom: shifted up to stay on screen');
    assert.deepEqual(flyoutPlace({ row: { left: 100, right: 320, top: 2 }, size, view }), { x: 322, y: 4, side: 'right' }, 'at the top: kept inside');
    // Fits on neither side: the wider side, shifted to stay inside (over the menu).
    assert.deepEqual(flyoutPlace({ row: { left: 60, right: 300, top: 50 }, size: { w: 200, h: 100 }, view: { w: 400, h: 400 } }), { x: 196, y: 46, side: 'right' });
    assert.deepEqual(flyoutPlace({ row: { left: 120, right: 360, top: 50 }, size: { w: 200, h: 100 }, view: { w: 400, h: 400 } }), { x: 4, y: 46, side: 'left' });
  });

  test(`${who}: the pointer on its way to the flyout`, () => {
    const { inSafeZone } = r;
    const rect = { left: 322, right: 522, top: 146, bottom: 386 };
    const from = { x: 300, y: 160 };
    assert.equal(inSafeZone({ x: 310, y: 180 }, from, rect, 'right'), true, 'down and toward it: on its way');
    assert.equal(inSafeZone({ x: 310, y: 158 }, from, rect, 'right'), true, 'straight toward it');
    assert.equal(inSafeZone({ x: 250, y: 190 }, from, rect, 'right'), false, 'back into the menu: not');
    assert.equal(inSafeZone({ x: 302, y: 400 }, from, rect, 'right'), false, 'straight down: not');
    const left = { left: 98, right: 298, top: 146, bottom: 386 };
    assert.equal(inSafeZone({ x: 310, y: 200 }, { x: 320, y: 160 }, left, 'left'), true, 'a flyout on the left');
    assert.equal(inSafeZone({ x: 310, y: 200 }, null, rect, 'right'), false, 'no exit point: not');
  });

  test(`${who}: the arrow keys`, () => {
    const { menuStep } = r;
    assert.equal(menuStep(5, 0, 1), 1);
    assert.equal(menuStep(5, 4, 1), 0, 'Down at the end: the first');
    assert.equal(menuStep(5, 0, -1), 4, 'Up at the start: the last');
    assert.equal(menuStep(5, -1, 1), 0, 'none had the keyboard: Down, the first');
    assert.equal(menuStep(5, -1, -1), 4, 'none had the keyboard: Up, the last');
    assert.equal(menuStep(5, 2, 'first'), 0);
    assert.equal(menuStep(5, 2, 'last'), 4);
    assert.equal(menuStep(0, 0, 1), -1, 'no rows');
  });

  test(`${who}: what a key does`, () => {
    const { menuKeyAction } = r;
    assert.equal(menuKeyAction('ArrowDown'), 'next');
    assert.equal(menuKeyAction('ArrowUp', { inFlyout: true }), 'prev', 'Up and Down in the flyout too');
    assert.equal(menuKeyAction('Home'), 'first');
    assert.equal(menuKeyAction('End', { inFlyout: true }), 'last');
    assert.equal(menuKeyAction('ArrowRight', { onCategory: true }), 'open', 'Right on a category opens it');
    assert.equal(menuKeyAction('ArrowRight'), null, 'Right on a plain row: not the menu\'s (a row\'s "...")');
    assert.equal(menuKeyAction('ArrowRight', { inFlyout: true, onCategory: true }), null);
    assert.equal(menuKeyAction('ArrowLeft', { inFlyout: true }), 'back', 'Left closes just the flyout');
    assert.equal(menuKeyAction('ArrowLeft', { drilled: true }), 'back', 'Left leaves a drilled-in category');
    assert.equal(menuKeyAction('ArrowLeft'), null);
    assert.equal(menuKeyAction('Escape', { inFlyout: true }), 'back', 'Escape closes just the flyout');
    assert.equal(menuKeyAction('Escape'), 'close', 'Escape in the menu closes it');
    assert.equal(menuKeyAction('Tab', { inFlyout: true }), 'close');
    assert.equal(menuKeyAction('Enter', { onCategory: true }), null, 'Enter presses the row itself');
  });
}

test('the SDK carries the same rules, word for word', () => {
  assert.ok(ownBlock, 'public/menu-flyout.js has the block between its markers');
  assert.ok(sdkBlock, 'public/sdk/host.js has the block between its markers');
  assert.equal(sdkBlock, ownBlock);
});

test('the page\'s shared menu: categories fly out, or drill in on a phone', () => {
  const src = read('public/host-menu.js');
  assert.match(src, /import \{ submenuStyle, flyoutPlace, inSafeZone, menuStep, menuKeyAction \} from '\/menu-flyout\.js';/);
  assert.match(src, /b\.setAttribute\('aria-haspopup', 'menu'\);\n\s*b\.setAttribute\('aria-expanded', 'false'\);/, 'a category says it opens a menu, and whether it is open');
  assert.match(src, /el\.className = 'host-menu host-menu-flyout';\n\s*el\.setAttribute\('role', 'menu'\);/, 'the flyout is a menu');
  assert.ok(src.includes("submenuStyle({ width: view.innerWidth }) === 'drill'"), 'the window\'s width decides');
  assert.ok(src.includes('flyoutPlace({ row: { left: m.left, right: m.right, top: r.top }'), 'placed by the rule');
  assert.ok(src.includes('inSafeZone({ x: event.clientX, y: event.clientY }, fly.exit'), 'a row crossed on the way waits');
  assert.ok(src.includes("menuKeyAction(e.key, { inFlyout, onCategory, drilled: Boolean(sub && sub.label) })"));
  assert.ok(src.includes("sub = { items: entriesOf(item) || [], back: rows.indexOf(b), label: item.label }"), 'a phone drills in with Back');
  const css = read('public/sdk/system.css');
  assert.match(css, /:is\(\.sdk-menu-caret, \.host-menu-caret\) \{[^}]*color: var\(--text-muted\);/, 'the caret, from the roles (the Menus block)');
  assert.match(css, /:is\(\.sdk-menu-item, \.host-menu-item\):is\(\[aria-expanded="true"\], \.open\) \{ background: var\(--menu-hover\); \}/, 'a category keeps the quiet fill while its flyout is open');
  const surface = css.slice(css.indexOf(':is(.sdk-menu, .host-menu, .chat-command-menu, .sdk-kind-list) {'));
  const surfaceBlock = surface.slice(0, surface.indexOf('\n}'));
  assert.match(surfaceBlock, /background-attachment: local, scroll;/, 'a scrolling menu shows a fade at the bottom edge only while more is below (#661)');
  assert.match(surfaceBlock, /color-mix\(in srgb, var\(--text-primary\)/, 'the scroll cue comes from a theme token');
});

test('host.menu.show: categories fly out in a module too', () => {
  const show = sdkSrc.slice(sdkSrc.indexOf('  function showMenu('), sdkSrc.indexOf('  const host = {\n'));
  assert.match(show, /b\.setAttribute\('aria-haspopup', 'menu'\); b\.setAttribute\('aria-expanded', 'false'\);/);
  assert.ok(show.includes("el.className = `sdk-menu sdk-menu-flyout${narrow ? ' narrow' : ''}${className ? ` ${className}` : ''}`;\n      el.setAttribute('role', 'menu');"), 'the flyout is a menu');
  assert.ok(show.includes("submenuStyle({ width: window.innerWidth, framed, touch, boxWidth: bounds().w, need: menu.offsetWidth + 180 }) === 'drill'"));
  assert.ok(show.includes('flyoutPlace({ row:'));
  assert.ok(show.includes('inSafeZone({ x: e.clientX, y: e.clientY }, fly.exit'));
  assert.ok(show.includes("menuKeyAction(e.key, { inFlyout, onCategory, drilled: Boolean(sub) })"));
  assert.ok(show.includes("{ label: 'Back', icon: 'arrow-left', back: true }, { heading: sub.label }"), 'drilled in: Back and the category\'s name');
  assert.match(read('public/sdk/system.css'), /:is\(\.sdk-menu-caret, \.host-menu-caret\) \{[^}]*var\(--text-muted\)/, 'the caret, from the roles (the Menus block)');
  assert.ok(sdkSrc.includes('// An item with `items` (or `submenu`'), 'the contract says so');
});

test('a module\'s title bar: Dock, Window and Pop out are in its "..."', () => {
  const src = read('public/canvas.js');
  assert.ok(!/data-popout|data-mode="(float|dock)"/.test(src), 'no Dock, Window or Pop out button in a title bar');
  const make = src.slice(src.indexOf('  function makeFrame('), src.indexOf('  // The page a composite holds'));
  assert.ok(make.includes('titlebar: { close: true, standard: () => standardFor(m.id), extra: () => stackMenu(m.id), onAction: (e) => titlebarAction(m.id, e) }'), 'every module, a composite too, has the frame\'s "..." (standard actions, then the stack entries: plan-panel-stacking.md) and Close');
  const frameJs = read('public/module-frame.js');
  const drawTb = frameJs.slice(frameJs.indexOf('  function drawTitlebar() {'), frameJs.indexOf('  function showMenuButton() {'));
  assert.ok(drawTb.indexOf("'mf-icon-btn mf-titlebar-btn mf-titlebar-menu'") < drawTb.indexOf("'mf-icon-btn mf-titlebar-btn mf-close-btn'"), 'Close last');
  assert.ok(drawTb.indexOf('mf-add-btn') < drawTb.indexOf('mf-titlebar-menu'), 'the "+" before the menu');
  const ways = src.slice(src.indexOf('  function standardFor(id) {'), src.indexOf('  // Everything this module holds in this space.'));
  assert.ok(ways.includes('if (isNarrow()) return out;'), 'none on a phone');
  assert.ok(ways.includes("if (mod.mode === 'dock' && supports(mod, 'float')) out.window = true;"), 'Open as a window while docked');
  assert.ok(ways.includes("out.dock = why ? { hint: why, disabled: true } : true;"), 'Dock as a panel while floating, unavailable and why while it cannot');
  assert.ok(ways.includes('out.popout = true;'), 'Open in its own window');
  assert.ok(ways.includes('out.clear = !compositeOf(mod.m) && mod.m.clear === true;'), 'Clear, not a composite\'s, and only where the server says this person may');
  assert.ok(ways.includes("if (e.id === 'window') return setMode(id, 'float');") && ways.includes("if (e.id === 'dock') return setMode(id, 'dock');") && ways.includes("if (e.id === 'popout') return popOut(id);"), 'each does what it says');
  assert.ok(ways.includes("if (e.id === 'clear' && e.el) openClearMenu(e.el, () => clearModuleData(opened.get(id) || mod), { armed: true, name: (opened.get(id) || mod).m.name || '', undoSeconds: (opened.get(id) || mod).m.undoSeconds });"), 'Clear still asks first, with the undo time the server gave');
  // The frame's menu: the module's own actions, a line, the standard actions, a line, the destructive ones last.
  assert.ok(frameJs.includes("{ id: 'dock', label: 'Dock as a panel', icon: 'table-columns', tip: 'Dock beside the video', off: true },"));
  assert.ok(frameJs.includes("{ id: 'window', label: 'Open as a window', icon: 'window-restore', regular: true, tip: 'Float over the call' },"));
  assert.ok(frameJs.includes("{ id: 'popout', label: 'Open in its own window', icon: 'up-right-from-square', tip: 'Pop out of this page' },"));
  assert.ok(frameJs.includes("{ id: 'clear', label: 'Clear', icon: 'trash', danger: true, off: true },"));
  assert.ok(frameJs.includes('return runs.flatMap((r, at) => (at ? [{ divider: true }, ...r] : r));'), 'after the module\'s own entries, below a line');
  assert.ok(frameJs.includes("const runs = [own, standard, Array.isArray(extra) ? extra : [], danger].filter((r) => r.length);"), 'the window\'s own entries (titlebar.extra: the stack entries) after the standard ones, before the destructive ones');
  assert.ok(frameJs.includes("menu.addEventListener('click', () => openHostMenu(menu, titlebarMenu));"), 'on the shared menu');
  assert.ok(read('public/host-menu.js').includes('if (item.tip) b.title = item.tip;'), 'the old tooltips, on the entries');
});

test('the page\'s shared menu: a row\'s "..." (`more`) flies out beside it, the menu open behind it; on a phone it drills in', () => {
  const src = read('public/host-menu.js');
  const pair = src.slice(src.indexOf('if (item.more && !item.disabled && moreOf) {'), src.indexOf('  // Draw the entries'));
  assert.ok(pair, 'the "..." is drawn');
  assert.ok(pair.includes("more.setAttribute('aria-haspopup', 'menu');") && pair.includes("more.setAttribute('aria-expanded', 'false');"), 'it says it opens a menu, and whether it is open');
  assert.ok(pair.includes("const moreItem = { label: item.label || '', items: item.more };"), 'its entries are a category\'s: one code path');
  assert.ok(pair.includes('openFly(moreItem, more, { focus: event.detail === 0 });'), 'a click or a key opens the flyout (the keyboard in it after a key)');
  assert.ok(pair.includes('if (drills()) {') && pair.includes('sub = { items: entries, back: rows.indexOf(b), label: item.label };'), 'a phone or a narrow window drills in, Back and the row\'s name first');
  assert.ok(pair.includes("more.addEventListener('pointerenter', (event) => hover(moreItem, more, event));"), 'hover opens it after the short wait');
  assert.ok(pair.includes('fly.exit = { x: event.clientX, y: event.clientY }'), 'the way to the flyout is safe');
  assert.ok(!/sub = \{ items: entries, back: rows\.indexOf\(b\) \};/.test(src), 'the old drill-in that replaced the menu on a wide screen is gone');
  assert.ok(src.includes('if (b && menu.moreOf && [...menu.moreOf.values()].includes(b)) return b;'), 'Right on the "..." opens it, as on a category; Left and Escape close just the flyout');
  const css = read('public/style.css');
  assert.match(read('public/sdk/system.css'), /\.host-menu-more:hover, \.host-menu-more\.open \{ background: var\(--menu-hover\)/, 'the "..." keeps its look while its flyout is open');
  // The only user, the Layout menu's saved layouts (space.js), hands its entries over unchanged.
  assert.ok(read('public/space.js').includes('more: mayFavorite() || mayChangeLayout(isShared) || maySetDefault(isShared) ? () => layoutRowItems(l.id) : undefined,'));
});

// A menu row's accessible name (Thomas, 2026-10-13: the Planner's short rows, "Flight", carry "Add a flight" as `tip`).
const nameFn = (src, marker) => {
  const at = src.indexOf(marker);
  assert.ok(at >= 0, `${marker} is there`);
  const indent = marker.match(/^ */)[0];
  const end = src.indexOf(`\n${indent}}\n`, at);
  const body = src.slice(at, end + indent.length + 2).replace(/^\s*export /, '');
  return vm.runInNewContext(`${body}\nmenuItemName`);
};
for (const [who, src, marker] of [['the page\'s menu', read('public/host-menu.js'), 'export function menuItemName('], ['host.menu.show', read('public/sdk/host.js'), '  function menuItemName(']]) {
  test(`${who}: a row is heard by its full wording`, () => {
    const name = nameFn(src, marker);
    assert.equal(name({ label: 'Flight', tip: 'Add a flight' }), 'Add a flight', 'the tip that holds the label names it');
    assert.equal(name({ label: 'Free time', tip: 'Add free time at a time' }), 'Add free time at a time');
    assert.equal(name({ label: 'Rest', tip: 'Mark the day: rest' }), 'Mark the day: rest');
    assert.equal(name({ label: 'Open as a window', tip: 'Float over the call' }), null, 'a tip that does not hold the label stays a tooltip: what is heard keeps the word on screen');
    assert.equal(name({ label: 'Delete' }), null, 'no tip: the row\'s own words');
    assert.equal(name({ label: 'Delete', tip: 'Delete' }), null);
    assert.equal(name({ label: 'Flight', ariaLabel: 'Add a flight to day 3' }), 'Add a flight to day 3', 'ariaLabel outright');
  });
}
test('both menus put the tip and the name on the row', () => {
  const page = read('public/host-menu.js');
  assert.ok(page.includes("if (item.tip) b.title = item.tip;\n    const spoken = menuItemName(item);\n    if (spoken) b.setAttribute('aria-label', spoken);"));
  const show = sdkSrc.slice(sdkSrc.indexOf('  function showMenu('), sdkSrc.indexOf('  const host = {\n'));
  assert.ok(show.includes("if (item.tip) b.title = item.tip;\n      const spoken = menuItemName(item);\n      if (spoken) b.setAttribute('aria-label', spoken);"), 'host.menu.show honours `tip` and the name');
  assert.ok(sdkSrc.includes('regular?, hint?, tip?, ariaLabel?, disabled?'), 'the contract says so');
});

if (failures.length) {
  console.error(`check-host-menu: ${failures.length} failed`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-host-menu: OK (${passed} checks)`);
