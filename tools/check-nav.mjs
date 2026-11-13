#!/usr/bin/env node
/*
 * check-nav.mjs -- the nav-bar registry's rules, run without a browser.
 *
 * public/nav-bar.js is what both nav bars draw from (documentation/plans/plan-nav.md, "Modules register into the
 * bars"). Its ordering (groups by groupOrder, tools by order, the bands), its visibility rule and the cleaning of a
 * module's registration are pure, so this runs them in node and fails when any of them drifts.
 *
 *   node tools/check-nav.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// The page's file is plain ES module syntax under a .js name; node wants .mjs to load it without a warning, so it is
// imported from a temporary copy (the same way check-syntax.mjs parses the pages).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-check-'));
const copy = path.join(tmp, 'nav-bar.mjs');
fs.copyFileSync(path.join(ROOT, 'public/nav-bar.js'), copy);
const { arrange, isVisible, cleanModuleTools, bandOf, BANDS, DEFAULT_ORDER, phoneZones, tabBarZones, phoneTabs, phoneFold, TAB_MIN, TAB_GAP, isShown, foldSteps, foldCount, fitWidth, register, nav: navApi } = await import(pathToFileURL(copy).href);
// Who is here (Online, the space bar's left zone) gives way before the bar folds; its fitting and its reading of the live
// stream's presence (space-live.js) are pure.
const peopleCopy = path.join(tmp, 'space-people.mjs');
fs.copyFileSync(path.join(ROOT, 'public/space-people.js'), peopleCopy);
const { facesThatFit, hereWords, MAX_FACES } = await import(pathToFileURL(peopleCopy).href);
const liveCopy = path.join(tmp, 'space-live.mjs');
fs.copyFileSync(path.join(ROOT, 'public/space-live.js'), liveCopy);
const { peopleFromPresence, liveRetryDelay, liveStreamUrl } = await import(pathToFileURL(liveCopy).href);
// Whether the conference may show (the call service, the environment's switch, the permission): Join the call runs it.
const opensCopy = path.join(tmp, 'opens-with.mjs');
fs.copyFileSync(path.join(ROOT, 'public/opens-with.js'), opensCopy);
const { conferenceAllowed } = await import(pathToFileURL(opensCopy).href);
// The primary nav's pure parts (plan-primary-nav.md, step 2): the profile menu by role, the switcher, the bell, the breadcrumb.
const primaryCopy = path.join(tmp, 'primary-nav.mjs');
fs.copyFileSync(path.join(ROOT, 'public/primary-nav.js'), primaryCopy);
const { pageAnchor, profileEntries, profileDestinationLabel, seesUpdates, hostConsoleUrl, switcherEntries, switchPick, bellState, crumbSegments, anchorSegments, pageOpens, isHere, steppedOut, hereCount, asidePlaceholder, whereWords, offStream, destinationTools, layoutTabs, tabOverflow, layoutIconChoices, iconMatches, gridStep, tileRefTarget, tileHeading, hashPanel } = await import(pathToFileURL(primaryCopy).href);
// The server's presence by membership (plan-primary-nav.md, step 3), so the pages' reading is held against the real answer.
const { presenceView } = createRequire(import.meta.url)('../server/presence-view.js');
fs.rmSync(tmp, { recursive: true, force: true });

let n = 0;
const test = (name, fn) => {
  try {
    fn();
    n += 1;
  } catch (err) {
    console.error(`check-nav: ${name}\n  ${err.message}`);
    process.exit(1);
  }
};
const ids = (groups) => groups.map((g) => g.map((t) => t.id));
// The status strip's block of style.css (status-strip:start to :end).
const stripCssOf = (css) => css.slice(css.indexOf('/* status-strip:start'), css.indexOf('/* status-strip:end */'));

test('the space bar on a phone: the "..." follows the module tabs in the left zone, so the keyboard order is the screen order', () => {
  const click = () => {};
  const byZone = {
    left: [{ id: 'module-chooser', group: 'modules', order: 1, zone: 'left' }, { id: 'join-call', group: 'call', groupOrder: 1.5, order: 1, zone: 'left' }, { id: 'who-here', group: 'people', groupOrder: 2, order: 1, zone: 'left' }],
    right: [{ id: 'rejoin-call', order: 52, zone: 'right', onClick: click }, { id: 'subnav-more', group: 'leave', order: 998, afterTabs: true, zone: 'right' }, { id: 'leave-space', group: 'leave', groupOrder: 999, order: 999, zone: 'right', onClick: click }],
  };
  const z = tabBarZones(byZone);
  const ids = [...arrange(z.left), ...arrange(z.right)].flat().map((t) => t.id);
  assert.deepEqual(ids, ['module-chooser', 'subnav-more', 'join-call', 'who-here', 'rejoin-call', 'leave-space']);
  assert.deepEqual(tabBarZones({ left: [], right: [{ id: 'x', order: 1 }] }), { left: [], right: [{ id: 'x', order: 1 }] }, 'a tool that does not say afterTabs stays');
});

test('the bands: 1-10 core, 11-50 secondary, 51-100 utility, 101-998 a module, 999 last', () => {
  assert.equal(bandOf(1), 'core');
  assert.equal(bandOf(10), 'core');
  assert.equal(bandOf(11), 'secondary');
  assert.equal(bandOf(50), 'secondary');
  assert.equal(bandOf(51), 'utility');
  assert.equal(bandOf(100), 'utility');
  assert.equal(bandOf(101), 'module');
  assert.equal(bandOf(998), 'module');
  assert.equal(bandOf(999), 'last');
  assert.equal(bandOf(0), null);
  assert.equal(bandOf(1000), null);
  assert.equal(bandOf(DEFAULT_ORDER), 'module', 'a tool that names no order lands in the module band');
});

test('tools sort by order inside a group, ties by registration', () => {
  const groups = arrange([
    { id: 'c', order: 3, seq: 1 },
    { id: 'a', order: 1, seq: 2 },
    { id: 'b2', order: 2, seq: 4 },
    { id: 'b1', order: 2, seq: 3 },
  ]);
  assert.deepEqual(ids(groups), [['a', 'b1', 'b2', 'c']]);
});

test('groups sort by groupOrder; a group that names none takes its first tool\'s order', () => {
  const groups = arrange([
    { id: 'leave', group: 'leave', groupOrder: 999, order: 999, seq: 1 },
    { id: 'mod-x', group: 'mod:own', order: 500, seq: 2 }, // no groupOrder: 500
    { id: 'snap', group: 'space', groupOrder: 1, order: 2, seq: 3 },
    { id: 'dock', group: 'space', order: 1, seq: 4 }, // shares the group's groupOrder
  ]);
  assert.deepEqual(ids(groups), [['dock', 'snap'], ['mod-x'], ['leave']]);
});

test('the smallest groupOrder any tool of a group names wins for the group', () => {
  const groups = arrange([
    { id: 'p', group: 'g1', groupOrder: 40, order: 1, seq: 1 },
    { id: 'q', group: 'g1', groupOrder: 5, order: 2, seq: 2 },
    { id: 'r', group: 'g2', groupOrder: 20, order: 1, seq: 3 },
  ]);
  assert.deepEqual(ids(groups), [['p', 'q'], ['r']]);
});

test('the system stays ahead of a module without coordinating numbers', () => {
  const system = [
    { id: 'dock-all', group: 'space', groupOrder: 1, order: 1, seq: 1 },
    { id: 'fullscreen-toggle', group: 'space', order: 11, seq: 2 },
    { id: 'leave-space', group: 'leave', groupOrder: 999, order: 999, seq: 3 },
  ];
  const mod = cleanModuleTools('calendar', [
    { id: 'today', icon: 'calendar-day', label: 'Today', order: 1 }, // asks for 1, gets the band's floor
    { id: 'add', icon: 'plus', label: 'Add', order: 5000, groupOrder: 1 },
  ]);
  const groups = arrange([...system, ...mod.map((t, i) => ({ ...t, seq: 10 + i }))]);
  assert.deepEqual(ids(groups), [['dock-all', 'fullscreen-toggle'], ['calendar:today', 'calendar:add'], ['leave-space']]);
  assert.equal(mod[0].order, BANDS.module[0]);
  assert.equal(mod[1].order, BANDS.module[1]);
  assert.equal(mod[1].groupOrder, BANDS.module[0]);
});

test('visible: left out means shown; a boolean; a function; a throwing function counts as shown', () => {
  assert.equal(isVisible({}), true);
  assert.equal(isVisible({ visible: false }), false);
  assert.equal(isVisible({ visible: true }), true);
  assert.equal(isVisible({ visible: () => 0 }), false);
  assert.equal(isVisible({ visible: () => 'yes' }), true);
  assert.equal(isVisible({ visible: () => { throw new Error('bug'); } }), true);
});

test('hidden tools keep their place in the order, so showing one again moves nothing', () => {
  const groups = arrange([
    { id: 'a', order: 1, seq: 1 },
    { id: 'b', order: 2, visible: false, seq: 2 },
    { id: 'c', order: 3, seq: 3 },
  ]);
  assert.deepEqual(ids(groups), [['a', 'b', 'c']]);
});

test('a module\'s tools are namespaced: ids and groups carry the module id, and the module band clamps orders', () => {
  const [t] = cleanModuleTools('todo', [{ id: 'mine', icon: 'list-check', label: 'My tasks', group: 'views', title: 'Only my tasks' }]);
  assert.equal(t.id, 'todo:mine');
  assert.equal(t.own, 'mine');
  assert.equal(t.group, 'todo:views');
  assert.equal(t.bar, 'secondary');
  assert.equal(t.zone, 'right');
  assert.equal(t.order, DEFAULT_ORDER);
  assert.equal(t.groupOrder, DEFAULT_ORDER);
  assert.equal(t.visible, true);
  assert.equal(t.title, 'Only my tasks');
  const [u] = cleanModuleTools('todo', [{ id: 'all', icon: 'list', label: 'All', zone: 'middle', order: 200, groupOrder: 150, toggleable: true, active: true, badge: 3, visible: false }]);
  assert.equal(u.zone, 'right', 'a module tool naming the middle lands in the right zone, not refused (plan-two-zone-nav.md)');
  assert.equal(u.order, 200);
  assert.equal(u.groupOrder, 150);
  assert.equal(u.toggleable, true);
  assert.equal(u.active, true);
  assert.equal(u.badge, 3);
  assert.equal(u.visible, false);
  assert.equal(u.group, 'todo:own');
});

test('a module cannot name another module\'s or the system\'s ids', () => {
  assert.throws(() => cleanModuleTools('todo', [{ id: 'calendar:today', icon: 'x', label: 'x' }]), /letters, digits and hyphens/);
  const [t] = cleanModuleTools('todo', [{ id: 'leave-space', icon: 'x', label: 'x' }]);
  assert.equal(t.id, 'todo:leave-space', 'the system\'s leave-space is untouched: the module\'s tool is its own');
});

test('a registration needs an id, an icon and a label, once each', () => {
  assert.throws(() => cleanModuleTools('m', [{ icon: 'x', label: 'x' }]), /needs an id/);
  assert.throws(() => cleanModuleTools('m', [{ id: 'a', label: 'x' }]), /needs an icon/);
  assert.throws(() => cleanModuleTools('m', [{ id: 'a', icon: 'x' }]), /needs a label/);
  assert.throws(() => cleanModuleTools('m', [{ id: 'a', icon: 'x', label: 'x' }, { id: 'a', icon: 'y', label: 'y' }]), /twice/);
  assert.throws(() => cleanModuleTools('m', 'nope'), /list/);
  assert.throws(() => cleanModuleTools('m', Array.from({ length: 13 }, (_, i) => ({ id: `t${i}`, icon: 'x', label: 'x' }))), /at most 12/);
});

test('href: a path on this server or an https address, nothing else', () => {
  assert.equal(cleanModuleTools('m', [{ id: 'a', icon: 'x', label: 'x', href: '/modules/m' }])[0].href, '/modules/m');
  assert.equal(cleanModuleTools('m', [{ id: 'a', icon: 'x', label: 'x', href: 'https://example.org/' }])[0].href, 'https://example.org/');
  assert.throws(() => cleanModuleTools('m', [{ id: 'a', icon: 'x', label: 'x', href: 'javascript:alert(1)' }]), /href/);
  assert.throws(() => cleanModuleTools('m', [{ id: 'a', icon: 'x', label: 'x', href: '//evil.example/' }]), /href/);
  assert.throws(() => cleanModuleTools('m', [{ id: 'a', icon: 'x', label: 'x', href: 'http://example.org/' }]), /href/);
});

test('a module never chooses a bar: bar: \'primary\' and system: true are ignored, not refused; the tool is a Workspace tool of the right zone (the registry puts it where the page put the Workspace\'s toolbar)', () => {
  const tool = { id: 'a', icon: 'x', label: 'x', bar: 'primary', system: true };
  const [t] = cleanModuleTools('m', [tool]);
  assert.equal(t.bar, 'secondary', 'placed like any other tool');
  assert.equal(t.zone, 'right');
  assert.equal(t.workspace, 'only', 'a Workspace tool: shown on the Workspace view, in the top bar wider than a phone');
  assert.ok(!('system' in t), 'system is not carried');
  const [u] = cleanModuleTools('m', [{ ...tool, zone: 'middle' }], { allowPrimary: true });
  assert.equal(u.bar, 'secondary', 'even with the old option passed, nothing reaches the top bar');
  assert.equal(u.zone, 'right');
  // plan-two-zone-nav.md, step 5: every module tool goes in the space bar's right zone, where it can fold; `zone` is not read.
  for (const zone of ['left', 'middle', 'right', 'nowhere', undefined]) assert.equal(cleanModuleTools('m', [{ id: 'a', icon: 'x', label: 'x', zone }])[0].zone, 'right', `zone ${zone}: the right zone`);
  const navSrc = fs.readFileSync(path.join(ROOT, 'public/nav-bar.js'), 'utf8');
  const hostSrc = fs.readFileSync(path.join(ROOT, 'public/module-host.js'), 'utf8');
  assert.ok(!/allowPrimary/.test(navSrc + hostSrc), 'allowPrimary is gone from nav-bar.js and module-host.js');
  assert.ok(!/contextInfo\.module\.nav/.test(hostSrc), 'module-host.js no longer reads the manifest\'s surfaces.page.nav');
});

test('on a phone the primary bar folds: the left stays, the bell stays (phone: \'bar\'), and everything else goes into the menu, your picture too', () => {
  const t = (id, zone, extra = {}) => ({ id, bar: 'primary', zone, ...extra });
  const byZone = {
    left: [t('spaces-slot', 'left', { order: 1 }), t('topbar-crumb', 'left', { order: 2 })],
    right: [t('menu-home', 'right', { order: 2 }), t('notifications-bell', 'right', { order: 90, phone: 'bar' }), t('whoami-link', 'right', { group: 'you', order: 999 }), t('account-profile', 'right', { group: 'you', order: 999 })],
  };
  const z = phoneZones(byZone);
  assert.deepEqual(z.left.map((run) => run.map((x) => x.id)), [['spaces-slot', 'topbar-crumb']], 'the left zone stays (Spaces hides itself there)');
  assert.deepEqual(z.bar.map((run) => run.map((x) => x.id)), [['notifications-bell']], 'only the bell stays in the bar, in the phone\'s place (#core-nav)');
  assert.deepEqual(z.right.map((run) => run.map((x) => x.id)), [[], ['menu-home', 'whoami-link', 'account-profile']], 'everything else from the right, without the bell, in the menu (the first run, a left tool that says phone: \'menu\', is empty here)');
  assert.ok(!('middle' in z), 'no middle zone (plan-two-zone-nav.md)');
  // The registry's rule (plan-one-bar.md, step 8): left-zone tools that say phone: 'menu' are the menu's first entries,
  // their own run ahead of the right zone's; the switcher stays in the row (the phase chip is not in the top bar: it is
  // the status strip's, plan-space-status-strip.md). No space tool says it any more
  // (the views became layout tabs, plan-layout-views.md step 3), but the rule stays the registry's.
  const inSpace = {
    left: [t('space-switcher', 'left', { group: 'where', order: 9.5 }), t('topbar-crumb', 'left', { group: 'where', order: 10 }), t('menu-first-a', 'left', { group: 'views', groupOrder: 12, order: 1, phone: 'menu' }), t('menu-first-b', 'left', { group: 'views', groupOrder: 12, order: 2, phone: 'menu' })],
    right: [t('menu-environment', 'right', { group: 'menu-where', groupOrder: 1, order: 1 }), t('notifications-bell', 'right', { order: 90, phone: 'bar' }), t('whoami-link', 'right', { group: 'you', order: 999 })],
  };
  const s = phoneZones(inSpace);
  assert.deepEqual(s.left.map((run) => run.map((x) => x.id)), [['space-switcher', 'topbar-crumb']], 'the row: the switcher (the stylesheet hides the breadcrumb beside it)');
  assert.deepEqual(s.bar.map((run) => run.map((x) => x.id)), [['notifications-bell']], 'the bell');
  assert.deepEqual(s.right.map((run) => run.map((x) => x.id)), [['menu-first-a', 'menu-first-b'], ['menu-environment', 'whoami-link']], 'the phone: \'menu\' tools first, then the menu\'s own entries');
  assert.deepEqual(phoneZones(inSpace), s, 'the same answer for the same input');
  const navSrc = fs.readFileSync(path.join(ROOT, 'public/nav-bar.js'), 'utf8');
  assert.match(navSrc, /place: el\.querySelector\(':scope > \.nav-middle'\)/, 'the top bar\'s #core-nav is where the phone\'s bell is drawn');
  const brand = fs.readFileSync(path.join(ROOT, 'public/brand.js'), 'utf8');
  assert.match(brand, /id: 'notifications-bell'[^\n]*phone: 'bar'/, 'the bell says phone: \'bar\'');
  for (const id of ['spaces-slot']) assert.match(brand, new RegExp(`id: '${id}'[^\\n]*visible: \\(\\) => wide\\(\\) && signedIn\\(\\) && !inSpace`), `${id} leaves the bar on a phone, and in a space (the switcher takes its place)`);
  assert.match(brand, /for \(const \[t, visible\] of \[\[menu, \(\) => inMenuOnly\(\) && !inSpace\]\]\)/, 'the environment\'s Calendar and Map leave the phone menu in a space (the tab bar holds the space\'s Calendar and Map as their composites)');
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  assert.ok(!/phone: 'menu'/.test(space), 'the space page registers no views for the phone\'s menu (plan-layout-views.md, step 3): the tab bar reaches Calendar and Map');
  assert.match(navSrc, /right: \[byZone\.left\.filter\(toMenu\), byZone\.right\.filter\(\(t\) => !stays\(t\)\)\]/, 'the menu\'s first run is the left zone\'s phone: \'menu\' tools');
  assert.match(navSrc, /if \(phoneNow && bar === 'primary'\) \{\n\s*for \(const t of tools\.values\(\)\) \{\n[^\n]*\n\s*try \{ t\.fit\(Infinity\); \}/, 'on a phone every fitting tool of the top bar is whole again (the layout tabs are never left folded)');
  const src = fs.readFileSync(path.join(ROOT, 'public/nav-bar.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'public/brand.js'), 'utf8');
  assert.ok(!/keepOnPhone/.test(src), 'keepOnPhone is gone: nothing stays in the bar on a phone');
});

test('a divider only separates groups that show something: a tool hidden by its owner (your picture, for a guest) counts as not shown', () => {
  const hidden = new Set(['whoami-link']);
  const hiddenOf = (t) => hidden.has(t.id);
  const you = [{ id: 'whoami-link' }, { id: 'account-profile', visible: () => false }, { id: 'account-sign-out', visible: false }];
  assert.equal(you.some((t) => isShown(t, hiddenOf)), false, 'a guest\'s "you" group shows nothing, so no divider goes before it');
  hidden.clear();
  assert.equal(isShown(you[0], hiddenOf), true, 'shown again once its owner shows it');
  assert.equal(isShown({ id: 'x', visible: true }, () => true), true, 'a tool with `visible` follows it, not the element');
  const src = fs.readFileSync(path.join(ROOT, 'public/nav-bar.js'), 'utf8');
  assert.match(src, /shown = group\.filter\(\(t\) => isShown\(/, 'flatten() decides dividers with isShown');
  assert.match(src, /watchHidden\(t\.id, el\)/, 'the bar is drawn again when a page toggles a tool\'s hidden');
});

test('the phone menu: opening it focuses its first entry, Escape from inside returns to the button; the picture is a label there and a width change closes the account menu', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/brand.js'), 'utf8');
  const wire = src.slice(src.indexOf('function wireNavMenu('), src.indexOf('function firstEntry('));
  assert.match(wire, /if \(on && !wasOpen\) firstEntry\(menu\)\?\.focus\(\)/);
  assert.match(wire, /if \(!on && wasOpen && focus\) toggle\.focus\(\)/);
  assert.match(wire, /Escape/);
  const paint = src.slice(src.indexOf('function paintWhoami('), src.indexOf('function viewProfile('));
  assert.ok(paint.indexOf('closeHostMenu()') > -1 && paint.indexOf('closeHostMenu()') < paint.indexOf('if (onPhone())'), 'paintWhoami closes the account menu before repainting');
  assert.match(paint, /aria-disabled', 'true'/);
  assert.match(paint, /removeAttribute\('aria-disabled'\)/);
});

test('the phone menu closes when focus leaves it and its button, from either (Tab on from the button into the page too)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/brand.js'), 'utf8');
  const wire = src.slice(src.indexOf('function wireNavMenu('), src.indexOf('function firstEntry('));
  assert.match(wire, /menu\.addEventListener\('focusout', leaving\)/);
  assert.match(wire, /toggle\.addEventListener\('focusout', leaving\)/);
  assert.match(wire, /!menu\.contains\(to\) && to !== toggle\) setOpen\(false\)/);
});

test('the phone menu closes when the width crosses the phone line, and focus it held goes to something shown', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/brand.js'), 'utf8');
  const wire = src.slice(src.indexOf('function wireNavMenu('), src.indexOf('function firstEntry('));
  const change = wire.slice(wire.indexOf("phoneQuery.addEventListener('change'"));
  assert.ok(change.length > 0, 'wireNavMenu watches the phone width');
  assert.match(change, /setOpen\(false\)/);
  assert.match(change, /\(shown\(was\) \? was : onPhone\(\) \? toggle : firstEntry\(menu\)\)\?\.focus\(\)/, 'back to what had focus if still shown, else the menu button on a phone or the bar\'s first entry');
  assert.match(wire, /header\.addEventListener\('focusin'/, 'the header remembers what last had focus, since a redraw can drop it');
  assert.match(src, /matchMedia\('\(max-width: 640px\)'\)/, 'the same width as nav-bar.js folds at');
  assert.match(fs.readFileSync(path.join(ROOT, 'public/nav-bar.js'), 'utf8'), /matchMedia\('\(max-width: 640px\)'\)/);
});

test('the space bar folds by band, each from its end: secondary, a module\'s, core (the slider with its switch), utility; never Leave or the "..."', () => {
  const click = () => {};
  const right = [
    { id: 'dock-all', order: 1, onClick: click },
    { id: 'snap-all', order: 2, onClick: click },
    { id: 'snap-size', order: 3, element: {} },
    { id: 'fullscreen-toggle', order: 11, onClick: click },
    { id: 'popout', order: 12, onClick: click },
    { id: 'recall-button', order: 51, onClick: click },
    { id: 'rejoin-call', order: 52, onClick: click },
    { id: 'm:a', order: 101 },
    { id: 'm:b', order: 102 },
    { id: 'subnav-more', order: 998, element: {}, fold: false },
    { id: 'leave-space', order: 999, onClick: click },
  ];
  assert.deepEqual(foldSteps(right), [['popout'], ['fullscreen-toggle'], ['m:b'], ['m:a'], ['snap-all', 'snap-size'], ['dock-all'], ['rejoin-call'], ['recall-button']]);
  assert.deepEqual(foldSteps([{ id: 'x', order: 20, fold: false }, { id: 'y', order: 21, onClick: click }]), [['y']], 'fold: false keeps a tool in the bar');
  assert.deepEqual(foldSteps([{ id: 'e', order: 5, element: {} }]), [['e']], 'an element with nothing before it folds on its own');
});

test('the space bar folds only as much as it must: two zones, the left taking what the right does not', () => {
  const steps = [40, 40, 120];
  // One grid gap of 12 between the two zones.
  assert.equal(foldCount({ width: 1000, gap: 12, left: 300, right: 300, more: 30, steps }), 0);
  assert.equal(foldCount({ width: 612, gap: 12, left: 300, right: 300, more: 30, steps }), 0, 'exactly full: nothing folds');
  assert.equal(foldCount({ width: 611, gap: 12, left: 300, right: 300, more: 30, steps }), 1, 'a pixel short: one step folds');
  assert.equal(foldCount({ width: 600, gap: 12, left: 300, right: 300, more: 30, steps: [20, 20, 120] }), 3, 'the "..." takes width too: 300+30-20-20 is still too wide');
  assert.equal(foldCount({ width: 600, gap: 12, left: 300, right: 300, more: 30, steps }), 2);
  assert.equal(foldCount({ width: 700, gap: 12, left: 300, right: 420, more: 30, steps: [100, 40] }), 1);
  // Nothing fits: everything that can fold does, and no more.
  assert.equal(foldCount({ width: 100, gap: 12, left: 300, right: 300, more: 30, steps }), 3);
  assert.equal(foldCount({ width: 100, gap: 12, left: 300, right: 300, more: 30, steps: [] }), 0);
  // A middle, if anyone still passes one, is not read.
  assert.equal(foldCount({ width: 612, gap: 12, middle: 500, left: 300, right: 300, more: 30, steps }), 0);
  const src = fs.readFileSync(path.join(ROOT, 'public/nav-bar.js'), 'utf8');
  assert.ok(!/middleCentred|middleWidth|dataset\.middle/.test(src), 'middleCentred(), middleWidth() and data-middle are gone');
  assert.match(src, /^const ZONES = \['left', 'right'\];/m, 'two zones');
});

test('the space bar\'s "..." uses the shared menu, shows a toggle\'s state and clicks the tool itself', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/nav-bar.js'), 'utf8');
  const menu = src.slice(src.indexOf('async function openFoldMenu('));
  assert.match(menu, /openHostMenu\(fold\.more, \[\.\.\.tabItems, /);
  assert.match(menu, /checked: t\.toggleable && !relabelled \? on : undefined/);
  assert.match(menu, /label: relabelled \? t\.activeLabel : t\.label/, 'a toggle on with its own words reads them ("Pop it back in")');
  assert.match(menu, /onPick: \(\) => \{\s*fold\.picked = c;\s*c\.click\(\);/);
  // After a pick the keyboard goes to the tool, else the "..." while it shows, else the left zone (the module chooser).
  const fit = src.slice(src.indexOf('function fitBar('), src.indexOf('function paintMoreBadge('));
  assert.match(fit, /\[focusable\(picked\), fold\.more\.hidden \? null : fold\.more, inLeft\(\)\]/);
  // The "..." had the keyboard and hides (the bar grew): to a tool it held, else the left zone; never <body>.
  assert.match(fit, /wasFocused === fold\.more && fold\.more\.hidden/);
  assert.match(fit, /heldBefore\.has\(c\.dataset\.navTool\)/);
  assert.match(src, /more\.className = 'sdk-icon-btn btn-quiet btn-small nav-more'/);
  const hm = fs.readFileSync(path.join(ROOT, 'public/host-menu.js'), 'utf8');
  assert.match(hm, /'menuitemcheckbox'/);
  assert.match(hm, /aria-checked/);
});

test('the phone\'s tab bar (plan-phone-space-bar.md): phoneTabs() shows the tabs that fit at 56 px, the rest and the tools in the "..."', () => {
  assert.equal(TAB_MIN, 56, 'decision 7: the least width of a tab');
  const tabs = (k) => Array.from({ length: k }, (_, i) => `t${i + 1}`);
  // 390 px: the bar's inner width 382 (4 px padding each side), Online and Leave 48 each; the "..." 48.
  const at390 = { width: 382, fixed: 96, more: 48 };
  const at320 = { width: 312, fixed: 96, more: 48 };
  assert.deepEqual(phoneTabs({ ...at390, tabs: tabs(3), shown: 't1' }), { shown: tabs(3), folded: [] }, 'three tabs: all shown, no "..."');
  assert.deepEqual(phoneTabs({ ...at390, tabs: tabs(5), shown: 't1' }), { shown: tabs(5), folded: [] }, 'five tabs: all shown');
  assert.deepEqual(phoneTabs({ ...at390, tabs: tabs(8), shown: 't1' }), { shown: tabs(4), folded: ['t5', 't6', 't7', 't8'] }, 'eight tabs: four and the "..."');
  assert.deepEqual(phoneTabs({ ...at390, fixed: 96 + 48, tabs: tabs(5), shown: 't1' }), { shown: tabs(3), folded: ['t4', 't5'] }, 'Join showing: it takes its own 48 px, so the "..." comes and one tab fewer than without Join');
  assert.deepEqual(phoneTabs({ ...at390, fixed: 96 + 48, tabs: tabs(4), shown: 't1' }), { shown: tabs(4), folded: [] }, 'Join showing: four still fit with no "..."');
  assert.deepEqual(phoneTabs({ ...at390, tabs: tabs(5), shown: 't1', foldsTools: true }), { shown: tabs(4), folded: ['t5'] }, 'a tool already folded: the "..." is reserved');
  assert.deepEqual(phoneTabs({ ...at390, tabs: tabs(3), shown: 't1', foldsTools: true }), { shown: tabs(3), folded: [] }, 'a tool folded and every tab fits beside the "..."');
  assert.deepEqual(phoneTabs({ ...at390, tabs: tabs(8), shown: 't7' }), { shown: ['t1', 't2', 't3', 't7'], folded: ['t4', 't5', 't6', 't8'] }, 'the shown view past the cut takes the last place');
  assert.deepEqual(phoneTabs({ ...at320, tabs: tabs(8), shown: 't1' }), { shown: tabs(3), folded: tabs(8).slice(3) }, '320 px: three and the "..."');
  assert.deepEqual(phoneTabs({ ...at320, fixed: 96 + 48 + 48 + 48, tabs: tabs(8), shown: 't6' }), { shown: ['t6'], folded: ['t1', 't2', 't3', 't4', 't5', 't7', 't8'] }, 'never fewer than one tab, the shown view\'s');
  assert.deepEqual(phoneTabs({ ...at320, tabs: [], shown: null, foldsTools: true }), { shown: [], folded: [] }, 'no tabs');
  assert.deepEqual(phoneTabs({ ...at390, tabs: tabs(8), shown: 'gone' }), phoneTabs({ ...at390, tabs: tabs(8), shown: null }), 'a shown view with no tab changes nothing');
  const input = { ...at390, tabs: tabs(8), shown: 't6', foldsTools: true };
  assert.deepEqual(phoneTabs(input), phoneTabs({ ...input }), 'the same answer for the same input');
  assert.deepEqual(input.tabs, tabs(8), 'the input is left alone');
});

test('the phone\'s fold of the space bar\'s right zone: every tool but Leave and Rejoin call (phone: \'bar\') and the "..."; Full screen and Pop out only popped out', () => {
  const click = () => {};
  const right = [
    { id: 'fullscreen-toggle', order: 11, phone: 'popout', onClick: click },
    { id: 'popout', order: 12, phone: 'popout', onClick: click },
    { id: 'recall-button', order: 51, onClick: click },
    { id: 'rejoin-call', order: 52, phone: 'bar', onClick: click },
    { id: 'm:a', order: 101 },
    { id: 'm:b', order: 102 },
    { id: 'subnav-more', order: 998, element: {}, fold: false },
    { id: 'leave-space', order: 999, phone: 'bar', onClick: click },
  ];
  assert.deepEqual(phoneFold(right), ['recall-button', 'm:a', 'm:b'], 'a phone or a narrow main window: Pull participants back and the module tools');
  assert.deepEqual(phoneFold(right, { popped: true }), ['fullscreen-toggle', 'popout', 'recall-button', 'm:a', 'm:b'], 'a narrow pop-out: Full screen and Pop out too, in the bar\'s order');
  // The page marks them so; a module can set none of it.
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  assert.match(space, /id: 'leave-space', order: 999, phone: 'bar',/);
  assert.match(space, /id: 'rejoin-call', order: 52, phone: 'bar', short: 'Rejoin',/);
  assert.match(space, /id: 'fullscreen-toggle',[^\n]*activeLabel: 'Exit full screen', phone: 'popout',/);
  assert.match(space, /id: 'popout',[^\n]*activeLabel: 'Pop it back in', phone: 'popout',/);
  const [m] = cleanModuleTools('todo', [{ id: 'a', icon: 'x', label: 'x', phone: 'bar', short: 'A', activeLabel: 'B', fold: false }]);
  for (const key of ['phone', 'short', 'activeLabel', 'fold']) assert.ok(!(key in m), `a module tool's ${key} is dropped`);
  assert.deepEqual(phoneFold([{ ...m, seq: 1 }]), ['todo:a'], 'so a module tool always goes into the "..." on a phone');
});

test('the phone\'s tab bar is drawn: fitBar() folds on a phone too, every tab one slot of TAB_MIN, the module tabs, the "...", then the pinned call item and Leave; no Conference tab', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/nav-bar.js'), 'utf8');
  const fit = src.slice(src.indexOf('function fitBar('), src.indexOf('function paintMoreBadge('));
  assert.ok(!/if \(!phoneNow/.test(fit), 'fitBar() no longer skips a phone');
  assert.match(fit, /if \(phoneNow\) \{\n\s*if \(width > 0 && shownEl\(el\)\) \(\{ ids, tabs \} = fitPhone\(b, el, width\)\);/);
  const phone = src.slice(src.indexOf('function fitPhone('), src.indexOf('function fitBar('));
  assert.match(phone, /phoneFold\(shown, \{ popped: /);
  assert.match(phone, /phoneTabs\(\{/);
  assert.match(phone, /t\.fit\(width\)/, 'Online draws its short count again in the window it is in (the narrow pop-out\'s full words, #160)');
  assert.ok(!/in-call/.test(src), 'no in-call dot on the "...": the conference is not a tab, the call item says it (space.js, paintCallTab)');
  assert.equal(TAB_GAP, 4, 'tabs 4px apart');
  assert.match(phone, /const slot = TAB_MIN \+ TAB_GAP;/, 'every tab is one slot of the bar');
  assert.match(phone, /width: width \+ TAB_GAP,\n\s*fixed: pinned \* slot,\n\s*more: slot,\n\s*tabMin: slot,/, 'the tools still shown (Join, Online, Rejoin call, Leave) take a slot each and never fold; the "..." one');
  // 390 px (382 inside): six slots; Join, Online and Leave pinned: two module tabs and the "..."; on the call (no Join), three.
  const slots = (inner, pinned, n) => phoneTabs({ width: inner + TAB_GAP, fixed: pinned * (TAB_MIN + TAB_GAP), more: TAB_MIN + TAB_GAP, tabMin: TAB_MIN + TAB_GAP, tabs: Array.from({ length: n }, (_, i) => `t${i + 1}`), shown: 't1' }).shown.length;
  assert.equal(slots(382, 3, 8), 2, '390: Join, Online, Leave and the "...": two module tabs');
  assert.equal(slots(382, 2, 8), 3, '390 on the call: three module tabs');
  assert.equal(slots(312, 3, 8), 1, '320: one module tab, the chat');
  assert.equal(slots(382, 3, 3), 3, 'three module tabs and the three pinned fit with no "..."');
  // On a phone every tool shown in the space bar is a tab; the module tabs are canvas.js's.
  assert.match(src, /if \(bar === 'secondary'\) markTabs\(b, phoneNow\);/);
  assert.match(src, /if \(tab\) tab\.classList\.toggle\('sdk-tabbar-tab', phoneNow && t\.bar === 'secondary'\);/);
  assert.match(src, /s\.className = 'sdk-tabbar-label';/, 'a tool\'s short word is its tab\'s label');
  assert.match(src, /for \(const tab of fold\.tabs\) n \+= unreadOf\(tab\);/, 'the folded tabs\' unread counts on the "..."');
  const menu = src.slice(src.indexOf('async function openFoldMenu('));
  assert.match(menu, /\[\.\.\.tabItems, \.\.\.\(tabItems\.length && items\.length \? \[\{ divider: true \}\] : \[\]\), \.\.\.items\]/, 'the folded tabs, a divider, then the tools');
  assert.match(menu, /fold\.picked = key;\s*tab\.click\(\);/, 'a folded tab\'s entry clicks the tab itself');
  const canvasJs = fs.readFileSync(path.join(ROOT, 'public/canvas.js'), 'utf8');
  const update = canvasJs.slice(canvasJs.indexOf('  function update() {'), canvasJs.indexOf('  function bindDoc(doc) {'));
  assert.ok(update.lastIndexOf("nav.draw('secondary');") > update.lastIndexOf('menu.appendChild(b);'), 'update() asks for the fold again after drawing the tabs');
  assert.match(update, /filter\(\(def\) => def\.id !== 'conference' && /, 'the conference is not a tab on a phone: the call is the pinned call item');
  assert.match(update, /b\.className = 'sdk-tabbar-tab';/);
  assert.match(update, /<span class="sdk-tabbar-glyph"><i class="fa-solid fa-\$\{escapeHtml\(icon\)\} fa-fw" aria-hidden="true"><\/i>\$\{n \? `<span class="sdk-badge-micro" aria-hidden="true">/, 'the icon in its box, the Chips micro count at the box\'s corner');
  assert.match(update, /if \(current\) b\.setAttribute\('aria-current', 'page'\);/);
  assert.match(canvasJs, /view = shown\.includes\('chat'\) \? 'chat' : /, 'the chat is the view a phone starts on');
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  const sys = fs.readFileSync(path.join(ROOT, 'public/sdk/system.css'), 'utf8');
  const look = sys.slice(sys.indexOf('/* tabbar:start */'), sys.indexOf('/* tabbar:end */'));
  assert.match(look, new RegExp(`--tabbar-min: ${TAB_MIN}px;`), 'the stylesheet\'s tab least width is TAB_MIN');
  assert.match(look, /--tabbar-gap: var\(--space-1\);/, 'and its gap TAB_GAP (4px)');
  assert.match(look, /\.sdk-tabbar \.sdk-tabbar-tab \{[^}]*flex: 1 1 0;[^}]*min-width: var\(--tabbar-min\);/, 'every tab one share of the bar, at least TAB_MIN');
  assert.match(look, /--tabbar-box: var\(--icon-24\);/, 'the 24 by 24 icon box');
  assert.match(look, /--tabbar-icon: var\(--icon-20\);/, 'a 20px icon');
  assert.match(look, /\.sdk-tabbar \.sdk-tabbar-glyph > \.sdk-badge-micro \{ top: var\(--tabbar-badge-top\); right: var\(--tabbar-badge-right\); \}/, 'a module tab\'s count at its box\'s corner');
  assert.match(look, /\.sdk-tabbar \.sdk-tabbar-tab > \.sdk-badge-micro \{\n\s*top: calc\(var\(--tabbar-pad-top\) \+ \(var\(--tabbar-icon\) - var\(--tabbar-box\)\) \/ 2 \+ var\(--tabbar-badge-top\)\);\n\s*right: calc\(50% - var\(--tabbar-box\) \/ 2 \+ var\(--tabbar-badge-right\)\);/, 'a tool\'s count at the same corner, measured from the centred box');
  assert.ok(!/\.subnav:has\(\.join-call/.test(css), 'no #165 rule narrows the tabs while Join shows');
  assert.match(css, /body\.in-space \.subnav\.sdk-tabbar \{\n\s*display: flex;/, 'the space bar is a row of tabs on a phone');
  assert.match(css, /body\.in-space \.sdk-tabbar #subnav-more \{\n\s*order: 1;[\s\S]*?body\.in-space \.sdk-tabbar #join-call \{\n\s*order: 2;[\s\S]*?body\.in-space \.sdk-tabbar :is\(#who-here-toggle, #rejoin-call\) \{\n\s*order: 3;[\s\S]*?body\.in-space \.sdk-tabbar #leave-space \{\n\s*order: 4;/, 'the module tabs, the "...", then Join, Online or Rejoin call, and Leave at the right end');
  assert.match(css, /\.subnav \.sdk-tabbar-label \{\n\s*display: none;/, 'their short words only in the tab bar');
  assert.match(css, /body\.in-space\.popout \.subnav \{\n\s*flex: 0 0 calc\(100% \+ 20px\);/, 'a narrow pop-out\'s bar is its own row');
  assert.match(css, /body\.in-space\.popout \.subnav \{\n\s*flex: 0 0 calc\(100% \+ 20px\);\n\s*min-width: 0;/, 'and never wider than the window');
  assert.match(css, /body\.in-space\.popout \.subnav > \.nav-left,\n\s*body\.in-space\.popout \.subnav > \.nav-right \{\n\s*margin: 0;\n\s*padding: 0;/, 'the header\'s zone padding and edge margins (.topbar .nav-left, .nav-right) are not the pop-out tab bar\'s');
  // Moving between windows: the bar folds again in its new window, and a frame left pending in a closed pop-out does not block it.
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const placeSub = space.slice(space.indexOf('function placeSubnav()'), space.indexOf('\nplaceSubnav();'));
  assert.match(placeSub, /nav\.draw\('secondary'\);/);
  assert.match(placeSub, /subnav\.classList\.toggle\('sdk-tabbar', tabs\);/, 'the bar is the Tab bar family\'s on a phone');
  // The call item: Online on the call shows the conference, carries the call's colour and is current while it is shown.
  assert.match(space, /canvas\.showBuiltin\('conference'\); \/\/ shows the conference view/, 'Call settings shows the conference without a tab');
  assert.match(space, /toggle\.classList\.toggle\('in-call', phone && inCall\);/);
  assert.match(space, /toggle\.classList\.toggle\('on', callTabShown\(\)\);/);
  assert.match(space, /event\.stopPropagation\(\); \/\/ the conference instead of the list\n\s*canvas\.showBuiltin\('conference'\);/);
  assert.match(space, /joinCallButton\.dataset\.role = 'join';/);
  assert.match(space, /tabRole\('leave-space', 'leave'\);/);
  const schedule = src.slice(src.indexOf('function scheduleFit(bar)'), src.indexOf('function watchFit('));
  assert.match(schedule, /if \(f\.frame && f\.frameView !== view\) \{/);
});

test('who is here drops portraits, then shows only its count, before the bar folds anything', () => {
  const sizes = { base: 60, first: 26, step: 17, plus: 24 };
  assert.equal(MAX_FACES, 4);
  assert.equal(facesThatFit({ avail: Infinity, count: 9, ...sizes }), 4, 'at most four, the rest a "+N"');
  assert.equal(facesThatFit({ avail: Infinity, count: 3, ...sizes }), 3, 'everyone when they fit, no "+N"');
  assert.equal(facesThatFit({ avail: 60 + 26 + 17 * 2, count: 3, ...sizes }), 3);
  assert.equal(facesThatFit({ avail: 60 + 26 + 17 * 2 - 1, count: 3, ...sizes }), 1, 'one fewer needs a "+1" too, which does not fit either');
  assert.equal(facesThatFit({ avail: 60 + 26 + 17 + 24, count: 9, ...sizes }), 2);
  assert.equal(facesThatFit({ avail: 60 + 26 + 24, count: 9, ...sizes }), 1);
  assert.equal(facesThatFit({ avail: 60 + 26 + 23, count: 9, ...sizes }), 0, 'the count alone');
  assert.equal(facesThatFit({ avail: 10, count: 9, ...sizes }), 0, 'the count alone is the smallest; the bar folds after that');
  assert.equal(facesThatFit({ avail: 500, count: 0, ...sizes }), 0);
});

test('Online gets the width the rest of the left zone and the right zone leave, so it shrinks before anything folds', () => {
  const steps = [40, 40, 120];
  // The bar's width, less the gap between the zones, the right zone at its full width and the rest of the left zone.
  assert.equal(fitWidth({ width: 1000, gap: 12, left: 140, right: 300 }), 1000 - 12 - 140 - 300);
  // A tool that takes exactly that width folds nothing; a little more folds the right zone.
  for (const [width, rest, right] of [[1000, 140, 300], [800, 140, 230], [641, 140, 201], [700, 130, 420]]) {
    const w = fitWidth({ width, gap: 12, left: rest, right });
    assert.equal(rest + w + right + 12, width, `${width}: the rest, the tool, the right zone and the gap fill the row`);
    assert.equal(foldCount({ width, gap: 12, left: rest + w, right, more: 30, steps }), 0, `${width}: nothing folds at that width`);
    assert.ok(foldCount({ width, gap: 12, left: rest + w + 2, right, more: 30, steps }) > 0, `${width}: a little more folds the right zone`);
  }
  // At 641 with the right zone wide (Rejoin call and Pull participants back showing), the portraits go first.
  const sizes = { base: 60, first: 26, step: 17, plus: 24 };
  assert.equal(facesThatFit({ avail: fitWidth({ width: 641, gap: 12, left: 140, right: 420 }), count: 9, ...sizes }), 0, 'the count alone');
  // The fold gives it that width, measured from the rest of the left zone (the tool itself left out, a gap before it).
  const src = fs.readFileSync(path.join(ROOT, 'public/nav-bar.js'), 'utf8');
  // The fitting of a bar's left zone is one function for both bars (fitLeft, plan-one-bar.md step 7: fitBar(bar)).
  const left = src.slice(src.indexOf('function fitLeft('), src.indexOf('function fitBar('));
  assert.match(left, /t\.bar === bar && t\.zone === 'left' && typeof t\.fit === 'function'/, 'a left-zone tool that can shrink, of the bar being fitted');
  assert.match(left, /const rest = naturalWidth\(b\.zones\.left, els\.get\(t\.id\), \{ margins: false \}\);/);
  assert.match(left, /fitWidth\(\{ width, gap, left: rest\.w \+ \(rest\.n \? rest\.gap : 0\), right \}\)/);
  const fit = src.slice(src.indexOf('function fitBar('), src.indexOf('function paintMoreBadge('));
  assert.match(fit, /fitLeft\(bar, \{ width, gap, right: r\.w \}\);/, 'Online (and the top bar\'s layout tabs and favorites) is given the width the right zone at its full width leaves');
  assert.ok(fit.indexOf('fitLeft(bar') < fit.indexOf('const leftWidth'), 'the left zone is measured after it has shrunk');
  assert.match(fit, /foldCount\(\{ width, gap, left: leftWidth, right: r\.w, more: moreWidth, steps: stepWidths \}\)/);
  const bar = src.slice(src.indexOf('function fitBar('), src.indexOf('function paintMoreBadge('));
  assert.ok(!/fitSecondary/.test(src), 'one fit for both bars: fitSecondary() is gone');
  assert.match(bar, /const list = \[\.\.\.tools\.values\(\)\]\.filter\(\(t\) => t\.bar === bar && t\.zone === 'right' && els\.has\(t\.id\) && \(bar === 'secondary' \|\| t\.workspace\)\);/, 'the space bar folds its right zone as before; in the top bar only the Workspace\'s tools fold');
  assert.match(bar, /if \(phoneNow && bar === 'primary'\) \{\n[\s\S]*?\n\s*return;\n\s*\}/, 'the top bar\'s one row on a phone fits nothing (step 8: each fitting tool is made whole and the row is the stylesheet\'s)');
  assert.match(src, /scheduleFit\(bar\);\n\}/, 'every draw fits its bar');
  assert.match(src, /scheduleFit\(bar\); \/\/ the fit after the pick says where the keyboard goes/, 'a pick from either "..." fits its own bar');
});

test('the Layout menu (plan-layout-menu.md; Thomas, 2026-10-13): the page\'s shared menu under an icon button beside Set up, with Show as switches that keep it open, Arrange as Panel Mode and Window Mode, Snap to grid and Clean up in Window Mode only, the note last; nothing of it in the bars', () => {
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const canvasJs = fs.readFileSync(path.join(ROOT, 'public/canvas.js'), 'utf8');
  const menuJs = fs.readFileSync(path.join(ROOT, 'public/host-menu.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  // Not registered with the bars: the modes, the snap switch and Clean up are the menu's.
  for (const id of ['dock-all', 'snap-all', 'snap-size', 'clean-up']) assert.ok(!new RegExp(`nav\\.register\\([^\\n]*id: '${id}'`).test(space), `${id} is not a bar tool`);
  // The button is gone (Thomas, 2026-11-08: the Show menu is the first tab of Set up): Set up's button opens on that tab,
  // for everyone wider than a phone; nothing registers a Layout button.
  assert.ok(!/modules-toggle/.test(space), 'no Layout button, no #modules-toggle');
  assert.match(space, /const canShowTab = \(\) => Boolean\(currentSpace\) && !viewingHome && !phoneWidth\(\);/);
  assert.match(space, /show: canShowTab\(\) \? \(holder\) => canvas\.mountMenu\(holder\) : null,/);
  assert.match(space, /icon: 'sliders', label: setupLabel\(\), toggleable: true, active: false, visible: setupShown, onClick: \(\) => \(settingUp \? spaceSetup\.cancel\(\) : enterSetup\(\{ tab: '#show' \}\)\)/);
  assert.match(space, /function setupLabel\(\) \{\n\s*return configurationLabel\(word, inAside\(\)\);/, 'Set up\'s tooltip and name come from configurationLabel, the panel\'s title helper');
  assert.match(space, /function registerWordTools\(\) \{\n\s*nameModuleChooser\(\);\n\s*paintSetupLabel\(\);/, 'and follow the environment\'s words once they are in');
  assert.ok(!/label: 'Set up'/.test(space), 'no fixed "Set up" label on the tool');
  // The menu is the shared one (host-menu.js), drawn from the canvas's items: Show, then Arrange, then the page's
  // (the Layouts section), then the note.
  assert.match(canvasJs, /import \{ mountHostMenu \} from '\/host-menu\.js';/);
  assert.match(canvasJs, /mountHostMenu\(container, layoutMenuItems\);/);
  const items = canvasJs.slice(canvasJs.indexOf('  function layoutMenuItems() {'), canvasJs.indexOf('  let menuView = null;'));
  assert.ok(items.indexOf("{ heading: 'Show' }") < items.indexOf("{ heading: 'Arrange' }") && items.indexOf("{ heading: 'Arrange' }") < items.indexOf('const extra = typeof menuItems') && items.indexOf('const extra') < items.indexOf('if (noteEl) items.push({ element: noteEl });'), 'Show, Arrange, the page\'s entries, the note');
  // Show: a switch per module (toggle items, the shared switch look), on while the module is shown, flipping it.
  assert.match(items, /items\.push\(\{ toggle: true, checked: shown\(m\.id\), icon: m\.icon, tint: colorOf\(m\.id\), label: m\.name, \.\.\.\(m\.description \? \{ hint: m\.description, clamp: true \} : \{\}\), badge: unreadOf\(m\.id\), onPick: \(\) => flipShown\(m\.id\) \}\);/);
  // Arrange (not on a narrow canvas): Panel Mode and Window Mode as a set (radio items, the chosen one checked, the
  // menu kept open), then in Window Mode only Snap to grid (a switch), the grid's size while it is on, and Clean up.
  assert.match(items, /if \(!isNarrow\(\)\) \{\n\s*const windowMode = arrangeMode\(\) === 'window';/);
  assert.match(items, /\{ radio: true, checked: !windowMode, keepOpen: true, icon: 'fa-solid fa-table-columns', label: 'Panel Mode', onPick: \(\) => setArrangeMode\('panel'\) \}/);
  assert.match(items, /\{ radio: true, checked: windowMode, keepOpen: true, icon: 'window-restore', label: 'Window Mode', onPick: \(\) => setArrangeMode\('window'\) \}/);
  const windowOnly = items.slice(items.indexOf('if (windowMode) {'), items.indexOf('const extra = typeof menuItems'));
  assert.match(windowOnly, /\{ toggle: true, checked: snapAllOn\(\), icon: 'border-all', label: 'Snap to grid', onPick: \(\) => setSnapAll\(!snapAllOn\(\)\) \}/);
  assert.match(windowOnly, /if \(snapAllOn\(\)\) \{[\s\S]*?items\.push\(\{ element: snapSizeRow \}\);/);
  assert.match(windowOnly, /\{ icon: 'fa-solid fa-broom', label: 'Clean up', onPick: \(\) => cleanUp\(\) \}/);
  assert.ok(!/Dock all|Snap to a grid/.test(items), 'Dock all is Panel Mode now, Snap to a grid reads Snap to grid');
  // The modes: remembered per person per space (__mode; Panel Mode where nothing is stored), Panel Mode docks everything
  // (dockAll), Window Mode floats what can float, new modules follow the mode, a loaded layout sets it.
  assert.match(canvasJs, /const arrangeMode = \(\) => \(saved\.__mode === 'window' \? 'window' : 'panel'\);/);
  const setMode = canvasJs.slice(canvasJs.indexOf('  function setArrangeMode(mode) {'), canvasJs.indexOf('  function dockAll() {'));
  // Panel Mode docks every floating module, then brings back the stacks Window Mode put away (plan-panel-stacking.md).
  assert.match(setMode, /saved\.__mode = want;\n\s*persist\(\);\n\s*if \(want === 'panel'\) \{[\s\S]*?\n\s*dockAll\(\);\n\s*if \(!isNarrow\(\)\) restoreStacks\(floating\);\n\s*return;\n\s*\}/);
  assert.match(setMode, /for \(const p of columns\) setMode\(p\.id, 'float'\);/);
  assert.match(setMode, /tidyBoxes\(live\.map/, 'a module with no place of its own is tidied around the rest');
  assert.match(canvasJs, /if \(arrangeMode\(\) === 'window'\) return supports\(p, 'float'\) \? 'float' : 'dock';/, 'preferredMode follows the mode');
  assert.match(canvasJs, /if \(plan\.modules\.length\) saved\.__mode = plan\.modules\.every\(\(want\) => want\.mode === 'float'\) \? 'window' : 'panel';/, 'loadLayout sets the mode from the layout');
  // Snap to grid moves nothing between docked and floating (the mode does that): on, every floating module to its
  // nearest free cells; off, free again.
  const snapAll = canvasJs.slice(canvasJs.indexOf('  function setSnapAll(on) {'), canvasJs.indexOf('  // --- the arrange mode'));
  assert.ok(!/setMode\(/.test(snapAll), 'setSnapAll() never docks or floats a module');
  assert.match(snapAll, /applySnapLayout\(mods\);/);
  // The Layout menu's switch is the only one (Thomas, 2026-10-13): no snap button on a module's titlebar, no setSnap,
  // and a module's own stored `snap` is ignored and never written.
  assert.ok(!/data-snap|function setSnap\(|function paintSnap\(/.test(canvasJs), 'a module window has no snap switch of its own');
  assert.match(canvasJs, /const snapping = \(\) => snapAllOn\(\);/, 'snapping is the space-wide switch alone');
  assert.ok(!/remember\([^)]*\bsnap:/.test(canvasJs) && !/before: \{\}/.test(canvasJs), 'a module\'s own snap and __snap.before are never written');
  // host-menu.js: the item kinds the Layout menu needs, in the one shared component.
  for (const needle of ['item.toggle', 'item.radio', 'item.keepOpen', 'item.heading', 'item.element', 'item.more', "'menuitemcheckbox'", "'menuitemradio'", 'export function refreshHostMenu()', 'export function hostMenuOpen(trigger)', 'export function mountHostMenu(container, items)']) assert.ok(menuJs.includes(needle), `host-menu.js has ${needle}`);
  assert.match(menuJs, /if \(item\.keepOpen \|\| item\.toggle\) \{/, 'a switch or a keepOpen item leaves the menu open and draws it again');
  // The switch look is the Fields' switch (36 by 20, thumb 14), drawn by the Menus block of system.css at the row's end.
  const menusCss = fs.readFileSync(path.join(ROOT, 'public/sdk/system.css'), 'utf8');
  assert.match(menusCss, /\.host-menu-switch \{[\s\S]*?width: 36px;\s*height: 20px;/);
  assert.match(menusCss, /\.host-menu-item\[aria-checked="true"\] > \.host-menu-switch \{ background: var\(--accent-fill\); \}/);
  // The old panel is gone: no section rules, no hand-rolled list under the button.
  for (const cls of ['.module-chooser-arrange', '.module-chooser-show', '.module-chooser-section', '.module-chooser-action', '.module-chooser-layouts', '.module-chooser-toggle']) assert.ok(!css.includes(cls), `${cls} is gone from the stylesheet`);
  assert.ok(!/setMenuOpen|positionMenu/.test(canvasJs), 'canvas.js draws no menu of its own');
  // The note: the page's element, the menu's last row, still role="status" (check-canvas holds the rest).
  assert.match(space, /noteEl: menuNote,/);
  assert.match(space, /menuItems: \(\) => layoutMenuItems\(\),/);
});

test('the Layout menu\'s Layouts section (plan-saved-layouts.md, step 3; in the shared menu): entries that load and keep the menu open, a ... with Favorite, Make default, Replace, Rename and Delete, New layout and Save as new layout in a small sheet; read again as the menu opens; hidden on a narrow canvas', () => {
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  const items = space.slice(space.indexOf('function layoutMenuItems() {'), space.indexOf('function layoutRowItems(layoutId) {'));
  // Nothing where there is nothing to load or save, or on a narrow canvas; shared first, then your own; Default marked;
  // a favorite's heart; a press loads it and keeps the menu open; the ... for those who may do something with it.
  assert.match(items, /const canSave = Boolean\(layoutList\.spaceId\) && !guestMode;/);
  assert.match(items, /if \(empty \|\| canvas\.isNarrow\(\)\) return \[\];/);
  assert.match(items, /const items = \[\{ heading: 'Layouts' \}\];[\s\S]*for \(const l of layoutList\.system\) \{[\s\S]*\n[\s\S]*for \(const l of shared\) withModified\(l, true\);\n\s*for \(const l of mine\) withModified\(l, false\);/, 'the system layouts first (plan-layout-views.md, step 2), then shared, then your own');
  assert.match(items, /tag: l\.id === layoutList\.defaultLayout \? 'Default' : undefined,/);
  assert.match(items, /mark: isFavorite\(l\.id\) \? 'heart' : undefined,/);
  assert.match(items, /keepOpen: true,\n\s*radio: true,\n\s*checked: l\.id === currentLayoutTab,[^\n]*\n\s*onPick: \(\) => \{ pressLayoutTab\(l\.id\); \},/, 'a press shows it as current; the row is marked');
  assert.match(items, /more: mayFavorite\(\) \|\| mayChangeLayout\(isShared\) \|\| maySetDefault\(isShared\) \? \(\) => layoutRowItems\(l\.id\) : undefined,/);
  assert.match(items, /No saved layouts yet\./);
  // Both commands, together, only where canSave holds (a guest never saves): New layout, then Save as new layout.
  assert.match(items, /if \(canSave\) \{\n\s*items\.push\(\{ icon: 'plus', label: 'New layout', onPick: \(\) => openSaveLayout\(\{ blank: true \}\) \}\);\n\s*items\.push\(\{ icon: 'floppy-disk', label: 'Save as new layout', onPick: \(\) => openSaveLayout\(\) \}\);\n\s*\}/);
  assert.ok(!items.includes('Save this layout'), 'the old label is gone');
  // Modified: a row under the layout shown; Update only where this person may change it, else the word alone.
  assert.match(items, /layoutModified && l\.id === currentLayoutTab/);
  assert.match(items, /mayChangeLayout\(isShared\)\n\s*\? \{ icon: 'arrows-rotate', label: 'Update', tag: 'Modified', keepOpen: true, onPick: \(\) => updateLayout\(l\.id\) \}\n\s*: \{ label: 'Modified', disabled: true \}/);
  assert.match(space, /const mayChangeLayout = \(shared\) => !guestMode && \(!shared \|\| layoutList\.canShare\);/, 'a guest changes nothing; shared ones only with the right');
  // The ...: Replace with this layout, Rename, Delete (confirmed in the menu's own confirm row, under the Layout button).
  const menuFn = space.slice(space.indexOf('function layoutRowItems(layoutId) {'), space.indexOf('async function setFavorite('));
  for (const label of ['Replace with this layout', 'Rename', 'Delete']) assert.ok(menuFn.includes(`label: '${label}'`), `the ... offers ${label}`);
  assert.match(menuFn, /openConfirmMenu\(trigger\(\), \{\n\s*label: 'Delete', confirm: `Delete \$\{layout\.name\}\?`, armed: true/);
  assert.ok(!/host\.menu\.show/.test(menuFn), 'the host\'s own menu, not a module\'s');
  // Read again as the menu opens (canvas.js's onMenu), drawn again while it is open, and after each change.
  assert.match(space, /onMenu: \(open\) => \{ if \(open\) refreshLayouts\(\); \},/);
  assert.match(space, /function renderLayouts\(\) \{\n\s*renderLayoutTabs\(\);[^\n]*\n[\s\S]*?\n\s*canvas\.refreshMenu\(\);[^\n]*\n\}/);
  assert.match(space, /`\/api\/spaces\/\$\{encodeURIComponent\(id\)\}\/layouts/);
  // The sheet: a <dialog> with Name, the share switch (a real switch, its words from the space word), the refusal,
  // Save and Cancel; Save this layout and Rename open it; a taken name offers Replace it; the server's refusals are
  // shown as it says them; a guest never saves.
  const sheet = space.slice(space.indexOf('function openLayoutSheet('), space.indexOf('function openSaveLayout({'));
  assert.match(sheet, /dlg\.className = 'layout-sheet';/);
  for (const needle of ['<span class="layout-field-label">Name</span>', 'id="layout-name"', '<input type="checkbox" class="sdk-switch" role="switch" id="layout-shared">', "submit: true,", "ids: { save: 'layout-save', cancel: 'layout-cancel' },"]) assert.ok(sheet.includes(needle), `the sheet has ${needle}`);
  assert.match(sheet, /querySelector\('#layout-shared-label'\)\.textContent = `For everyone in this \$\{word\('space'\)\}`;/);
  assert.match(sheet, /b\.textContent = 'Replace it';/);
  assert.match(sheet, /dlg\.showModal\(\);/);
  assert.match(space, /sheet\.error\(err\.message, err\.status === 409 \? err\.id : null\);/);
  assert.match(space, /title: blank \? 'New layout' : 'Save as new layout',\n\s*share: layoutList\.canShare \? false : null,/);
  // New layout saves modules [] with the arrangement mode as it is; Save as new layout saves the canvas; both then show the new layout.
  assert.match(space, /const captured = blank \? \{ modules: \[\], arrange: now\.arrange,/);
  assert.match(space, /pressLayoutTab\(layout\.id, null, \{ load: blank \}\);/);
  assert.ok(!space.includes('nothingOpen'), 'a blank layout is valid: nothing to refuse');
  assert.match(space, /title: 'Rename',\n\s*name: layout\.name,/);
  // The look: the menu's own for the entries; the sheet from the tokens.
  assert.match(fs.readFileSync(path.join(ROOT, 'public/sdk/system.css'), 'utf8'), /:is\(\.sdk-editor, \.layout-sheet, [^)]*\) \{[^}]*background: var\(--surface-panel\);/, 'the sheet is the dialog shell (the Dialogs block of system.css)');
  assert.ok(fs.readFileSync(path.join(ROOT, 'public/host-menu.js'), 'utf8').includes("tag.className = 'sdk-chip-tag';"), 'a menu entry\'s tag is the Chips tag');
  assert.match(fs.readFileSync(path.join(ROOT, 'public/sdk/system.css'), 'utf8'), /\.host-menu-mark \{[^}]*color: var\(--text-muted\);/);
  // An aside has no layouts.
  assert.match(space, /const layoutSpaceId = \(\) => \(currentSpace && !currentSpace\.isAside \? currentSpace\.id : null\);/);
});

test('the default layout (plan-saved-layouts.md, step 4): Make default in a shared row\'s ..., restore() on a first visit, the Set up panel\'s line', () => {
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const canvasJs = fs.readFileSync(path.join(ROOT, 'public/canvas.js'), 'utf8');
  const settings = fs.readFileSync(path.join(ROOT, 'public/space-setup.js'), 'utf8');
  const settingsHtml = settings; // the panel draws its markup in space-setup.js (space-settings.html is gone)
  // Only on a shared row, only for those the server says may set it (canSetDefault), never a guest.
  assert.match(space, /const maySetDefault = \(shared\) => !guestMode && shared && layoutList\.canSetDefault;/);
  assert.match(space, /canSetDefault: Boolean\(got\.canSetDefault\)/, 'read from GET .../layouts');
  assert.match(space, /more: mayFavorite\(\) \|\| mayChangeLayout\(isShared\) \|\| maySetDefault\(isShared\) \? \(\) => layoutRowItems\(l\.id\) : undefined,/, 'the ... shows for one who may only set the default (and for anyone signed in, to favorite)');
  assert.match(space, /tag: l\.id === layoutList\.defaultLayout \? 'Default' : undefined,/, 'the default entry is marked Default');
  const menuFn = space.slice(space.indexOf('function layoutRowItems(layoutId) {'), space.indexOf('async function setDefaultLayout('));
  assert.match(menuFn, /if \(maySetDefault\(shared\)\) \{/);
  assert.match(menuFn, /layoutList\.defaultLayout === layoutId\n\s*\? \{ icon: 'star', regular: true, label: 'Stop using as default', onPick: \(\) => setDefaultLayout\(null, layout\) \}\n\s*: \{ icon: 'star', label: 'Make default', onPick: \(\) => setDefaultLayout\(layoutId, layout\) \}\);/);
  const setFn = space.slice(space.indexOf('async function setDefaultLayout('), space.indexOf('async function replaceLayout('));
  assert.match(setFn, /api\('PATCH', `\/api\/spaces\/\$\{encodeURIComponent\(id\)\}`, \{ defaultLayout: layoutId \}\)/);
  assert.match(setFn, /await refreshLayouts\(/, 'the list again, for the Default mark');
  // Replace and delete read the list again (the server moves Opens with, or clears the default).
  const replaceFn = space.slice(space.indexOf('async function replaceLayout('), space.indexOf('function startRename('));
  assert.match(replaceFn, /await refreshLayouts\(/);
  assert.match(menuFn, /await layoutRequest\('DELETE', layoutUrl\(layoutSpaceId\(\), layoutId\)\);[\s\S]*?await refreshLayouts\(/);
  // restore(): on entering, a first visit (or a guest) whose first visit is a shared layout loads it through loadLayout,
  // whether or not Opens with is set (plan-layout-views.md, step 5); a remembered layout wins; a fresh request to open
  // one object wins over both. Calendar or Map: the Workspace opens and restore() answers the tab the page presses.
  const restore = canvasJs.slice(canvasJs.indexOf('  function restore() {'), canvasJs.indexOf('  // --- saved layouts'));
  assert.match(restore, /const firstLayout = request \? 'workspace' : firstVisitLayout\(\{ firstVisit: spaceFirstVisit, remembered: saved\.__open, guest, entering: enteringNow \}\);/);
  assert.match(restore, /if \(firstLayout !== 'workspace' && !SYSTEM_TABS\.includes\(firstLayout\) && spaceDefaultLayout && spaceDefaultLayout\.id === firstLayout\) \{[\s\S]*?loadLayout\(spaceDefaultLayout\);\n\s*return null;/);
  assert.ok(!/Array\.isArray\(spaceOpensWith\) &&/.test(restore), 'a layout no longer needs Opens with to be set');
  assert.ok(restore.indexOf('loadLayout(spaceDefaultLayout)') < restore.indexOf('whatOpens({'), 'before the module list');
  assert.match(restore, /return tab && !isNarrow\(\) \? tab : null;/, 'Calendar or Map: the tab, wider than a phone');
  assert.match(canvasJs, /const enteringNow = entering;\n\s*entering = false;/, 'only the restore on entering (not the Workspace tab\'s) shows the first visit\'s layout');
  assert.match(canvasJs, /entering = Boolean\(id\);/, 'refresh() of a space arms it');
  assert.match(space, /const firstTab = canvas\.restore\(\);[^\n]*\n[\s\S]*?refreshLayouts\(\)\.then\(\(\) => showFirstVisitTab\(firstTab, enteredId\)\);/, 'the tab is pressed once the layouts are read');
  const showFirst = space.slice(space.indexOf('function showFirstVisitTab('), space.indexOf('function layoutTabList() {'));
  assert.match(showFirst, /if \(!id \|\| currentLayoutTab !== 'workspace' \|\| layoutSpaceId\(\) !== spaceId \|\| layoutList\.spaceId !== spaceId\) return;\n\s*if \(layoutTabList\(\)\.some\(\(t\) => t\.layout === id\)\) pressLayoutTab\(id\);/, 'through the tab\'s own press, so the Workspace stays behind');
  assert.match(canvasJs, /spaceDefaultLayout = answer\.defaultLayout && Array\.isArray\(answer\.defaultLayout\.modules\) \? answer\.defaultLayout : null;/, 'from GET /api/modules/for-space');
  assert.match(canvasJs, /spaceFirstVisit = answer\.firstVisit && typeof answer\.firstVisit\.layout === 'string'\n\s*\? answer\.firstVisit/, 'the first visit as the server resolved it');
  // Make default sets the default alone, and says what a first visit opens.
  assert.ok(!/defaultLayout: layoutId, opensWith|opensWith[^\n]*defaultLayout: layoutId/.test(setFn), 'Make default never sends Opens with');
  assert.match(setFn, /`A first visit opens \$\{layout\.name\} now\.`/);
  // Availability is gone from the pages (plan-layout-views.md, step 6): no "every space" checkbox on Manage > Modules,
  // no per-module switches in space settings' Modules tab, and the Lobby note beside Enable.
  const adminSrc = fs.readFileSync(path.join(ROOT, 'public/admin.js'), 'utf8');
  assert.doesNotMatch(adminSrc, /data-module-all-spaces|Available in every|allSpaces/, 'Manage > Modules has no availability checkbox');
  assert.match(adminSrc, /m\.lobby === false \? `<span class="hint">\$\{escapeHtml\(notInLobby\(\)\)\}<\/span>`/, 'the not-in-Lobby note stays, beside Enable');
  assert.doesNotMatch(settings, /allSpaces|\.spaces\b|on for every|data-module|switchRowHtml/, 'the Set up panel has no availability switches ("off in this" left out: Turn AI off in this space is the panel\'s own AI switch)');
  assert.doesNotMatch(settings, /setup-module-list|paintModuleList|keeps only chat, the call/, 'the Settings tab has no read-only module list (Thomas): not the list, its loading state, nor the Lobby hint');
  assert.doesNotMatch(settings, /Turn one on or off on the/, 'the old line under the list is gone from Settings');
  assert.match(settings, /<p class="hint setup-modules-note" id="setup-modules-note">\$\{esc\(modulesWord\(true\)\)\} are turned on for the whole \$\{esc\(word\('environment'\)\)\} in Manage\.<\/p>/, 'the Modules tab says at its foot where modules are turned on');
  assert.match(settings, /\$\{state\.owner \? `<p class="hint setup-modules-note"/, 'and only to owners and the admin');
  assert.doesNotMatch(settingsHtml, /Switch one on|marked on for every/, 'the Modules hint no longer offers a switch');
  // #237: a module is reviewed with its one-line description beside its name: the Layout menu's Show rows (hint, clamped,
  // read after the name) and the composite keeps it. (The Set up panel's own read-only list is gone.)
  assert.match(canvasJs, /\.\.\.\(m\.description \? \{ hint: m\.description, clamp: true \} : \{\}\)/, 'the Layout menu\'s Show rows carry the description');
  assert.match(fs.readFileSync(path.join(ROOT, 'public/host-menu.js'), 'utf8'), /aria-describedby/, 'the menu reads the description after the name');
  assert.match(fs.readFileSync(path.join(ROOT, 'public/composites.js'), 'utf8'), /icon: m\.icon, description: m\.description,/, 'a composite keeps its main\'s description');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8'), /\.setup-module-(about|list|text)/, 'the list\'s styles went with it');
  // Space settings: the line and Stop using it; a list set by hand refreshes it from the answered space.
  assert.match(settingsHtml, /<button type="button" class="btn btn-small" id="setup-opens-with-layout-stop">Stop using it<\/button>/);
  assert.ok(settingsHtml.indexOf('id="setup-opens-with-layout"') < settingsHtml.indexOf('id="setup-opens-with"'), 'above the switches');
  assert.match(settings, /`Opens with the layout \$\{known\.name\}`/);
  // Moved to the panel: Calendar or Map as the first visit are choices of their own, named from the layouts payload.
  assert.match(settings, /system\.filter\(\(l\) => l\.id === 'calendar' \|\| l\.id === 'map'\)\.map\(\(l\) => \(\{ id: l\.id, name: l\.name,/, 'Calendar and Map are named choices');
  // Changed on purpose: the page PATCHed defaultLayout and opensWith at once; the panel keeps both as drafts for Save.
  assert.match(settings, /function stopUsingLayout\(\) \{\n\s*state\.draft\.defaultLayout = null;/, 'Stop using it is a draft change, saved with Save');
  assert.match(settings, /state\.draft\.opensWith = ticked\.length \? ticked : null; \/\/ the first visit's choice stays as it is/, 'a list set by hand leaves the first visit alone');
});

test('favorite layouts, step 2 (plan-favorite-layouts.md): a ... on every row for anyone signed in, Favorite or Unfavorite first with its heart, the row\'s heart, the notes; a guest gets none', () => {
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  // Who: anyone signed in; never a guest (no guest link, no guest role).
  assert.match(space, /const mayFavorite = \(\) => !guestToken && Boolean\(me\?\.key\) && me\.role !== 'guest';/);
  // The list carries this person's favorites from GET .../layouts, [] when it has none.
  assert.match(space, /favorites: Array\.isArray\(got\.favorites\) \? got\.favorites : \[\]/);
  assert.equal((space.match(/defaultLayout: null, favorites: \[\], canShare: false, canSetDefault: false \};/g) || []).length, 3, 'every empty list has no favorites');
  // The row: the ... for anyone who may favorite; a favorite's heart after the name, hidden from a screen reader, which
  // hears ", favorite" in the row's name instead.
  const row = space.slice(space.indexOf('function layoutMenuItems() {'), space.indexOf('function layoutRowItems(layoutId) {'));
  assert.match(row, /more: mayFavorite\(\) \|\| mayChangeLayout\(isShared\) \|\| maySetDefault\(isShared\) \? \(\) => layoutRowItems\(l\.id\) : undefined,/);
  assert.match(row, /mark: isFavorite\(l\.id\) \? 'heart' : undefined,/);
  assert.ok(row.indexOf("mark: isFavorite") > row.indexOf('label: l.name') && row.indexOf("mark: isFavorite") < row.indexOf('tag: l.id'), 'after the name, before Default');
  assert.match(fs.readFileSync(path.join(ROOT, 'public/sdk/system.css'), 'utf8'), /\.host-menu-mark \{[^}]*color: var\(--text-muted\);/);
  // The menu: Favorite (outline heart) or Unfavorite (filled heart) first, a divider before Make default.
  const menuFn = space.slice(space.indexOf('function layoutRowItems(layoutId) {'), space.indexOf('async function setFavorite('));
  assert.match(menuFn, /if \(mayFavorite\(\)\) \{\n\s*entries\.push\(isFavorite\(layoutId\)\n\s*\? \{ icon: 'heart', label: 'Unfavorite', onPick: \(\) => setFavorite\(layout, false\) \}\n\s*: \{ icon: 'heart', regular: true, label: 'Favorite', onPick: \(\) => setFavorite\(layout, true\) \}\);/, 'Unfavorite or Favorite, always on');
  // No limit (plan-layout-views.md, decision 13: the limit of 3 was part of a legacy system).
  assert.ok(!/FAVORITE_LIMIT|favoriteLimitText|You can have \d+ favorite/.test(space), 'no favorites limit on the page');
  assert.ok(menuFn.indexOf("label: 'Favorite'") < menuFn.indexOf("label: 'Make default'"), 'Favorite comes first');
  assert.match(menuFn, /if \(maySetDefault\(shared\)\) \{\n\s*if \(entries\.length\) entries\.push\(\{ divider: true \}\);/, 'a divider after it when Make default follows');
  assert.match(menuFn, /if \(entries\.length\) entries\.push\(\{ divider: true \}\);\n\s*return \[/, 'and when Replace, Rename and Delete follow');
  assert.match(menuFn, /if \(!mayChangeLayout\(shared\)\) return entries;/, "a member's ... on a shared layout holds Favorite only");
  // The request, its words, the list again with the keyboard back on the row; a refusal reads the list again.
  const setFn = space.slice(space.indexOf('async function setFavorite('), space.indexOf('async function setDefaultLayout('));
  assert.match(setFn, /layoutRequest\(on \? 'PUT' : 'DELETE', `\/api\/spaces\/\$\{encodeURIComponent\(id\)\}\/layouts\/\$\{encodeURIComponent\(layout\.id\)\}\/favorite`\)/);
  assert.match(setFn, /layoutNote\(on \? `\$\{layout\.name\} is a favorite\.` : `\$\{layout\.name\} is no longer a favorite\.`\);/);
  assert.match(setFn, /renderLayouts\(\);/);
  assert.match(setFn, /await refreshLayouts\(\);/, 'a layout gone (404): the list again');
  assert.ok(!/host\.menu\.show/.test(menuFn), 'the host\'s own menu');
});

test('the layout tabs (plan-layout-views.md, steps 2 and 3): after the switcher in the left zone, from layoutTabs(), a press loads the layout (Calendar and Map too), only the Workspace remembers, the "..." takes the tabs that do not fit first (never the Workspace or the tab shown), and the favorites left the right zone', () => {
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  const src = fs.readFileSync(path.join(ROOT, 'public/nav-bar.js'), 'utf8');
  const canvasJs = fs.readFileSync(path.join(ROOT, 'public/canvas.js'), 'utf8');
  // One element tool in the views' group, right after the switcher (group `where`); the favorites give way before
  // anything folds, after Who is here (the one `yieldFirst` there, Thomas 2026-10-14). The phase chip is not in the top
  // bar (plan-space-status-strip.md, step 1).
  assert.match(space, /nav\.register\(\{ id: 'layout-tabs', bar: 'primary', zone: 'left', group: 'views', groupOrder: 12, order: 10, icon: 'columns', label: 'Layouts', element: layoutTabsEl, visible: layoutTabsWanted, fit: fitLayoutTabs \}\);/);
  assert.ok(!/id: 'layout-tabs'[^\n]*yieldFirst/.test(space), 'the tabs give way after Who is here, not before it');
  assert.ok(!/id: 'phase-chip', bar: 'primary'/.test(space), 'the chip is not in the top bar');
  assert.ok(!/nav\.register\(\{ [^\n]*bar: 'primary'[^\n]*element: (phaseChip|statusStrip)/.test(space), 'nor is the strip');
  assert.equal((space.match(/fit: fitLayoutTabs/g) || []).length, 1, 'the layout tabs are the top bar\'s one left-zone tool that gives way');
  const left = [
    { id: 'layout-tabs', group: 'views', groupOrder: 12, order: 10, seq: 5 },
    { id: 'space-switcher', group: 'where', order: 9.5, seq: 2 },
  ];
  assert.deepEqual(arrange(left).flat().map((t) => t.id), ['space-switcher', 'layout-tabs'], 'the switcher, the tabs');
  assert.ok(!/id: 'view-workspace'|`dest-\$\{|spaceViews/.test(space), 'no view tools beside the tabs (plan-layout-views.md, step 3)');
  assert.match(space, /const layoutTabsWanted = \(\) => oneBar\(\) && !inAside\(\) && !phoneWidth\(\) && layoutTabList\(\)\.length > 0;/, 'never for a guest, in an aside, home over the space, or on a phone');
  assert.match(css, /@media \(max-width: 640px\) \{\n\s*\.topbar > \.nav-left > \.layout-tabs \{\n\s*display: none;/);
  // The group and its tabs: ids `layout-tab-<id>`, the link look, the current one marked, a "..." after them.
  assert.match(space, /layoutTabsEl\.id = 'layout-tabs';/);
  assert.match(space, /layoutTabsEl\.setAttribute\('role', 'group'\);\nlayoutTabsEl\.setAttribute\('aria-label', 'Layouts'\);/);
  assert.match(space, /layoutTabsMore\.id = 'layout-tabs-more';/);
  assert.match(space, /layoutTabsMore\.setAttribute\('aria-haspopup', 'menu'\);/);
  const render = space.slice(space.indexOf('function renderLayoutTabs('), space.indexOf('function fitLayoutTabs('));
  assert.match(render, /b\.id = t\.id;\n\s*b\.className = 'core-link layout-tab';\n\s*b\.dataset\.layoutTab = t\.layout;\n\s*b\.title = t\.label;\n\s*b\.setAttribute\('aria-label', t\.label\);/);
  assert.match(render, /if \(on\) b\.setAttribute\('aria-current', 'page'\); else b\.removeAttribute\('aria-current'\);/);
  assert.match(space, /function renderLayouts\(\) \{\n\s*renderLayoutTabs\(\);/, 'drawn whenever the menu\'s list is');
  assert.match(space, /const shownLayoutTab = \(\) => currentLayoutTab;/, 'the tab shown is the canvas\'s, no view over it');
  // A press: Workspace puts back the remembered arrangement; any other tab, Calendar and Map (system layouts, their
  // composite docked) as a saved favorite, holds the Workspace's memory and loads through canvas.loadLayout; the bars
  // are drawn again (the focused module's own tools change with the layout; the Layout menu, Full screen and Pop out stay).
  const press = space.slice(space.indexOf('function pressLayoutTab('), space.indexOf("layoutTabsEl.addEventListener('click'"));
  assert.match(press, /currentLayoutTab = 'workspace';\n\s*canvas\.resumeMemory\(\);[^\n]*\n\s*rebaseLayout\(\);\n\s*renderLayoutTabs\(\);[^\n]*\n\s*nav\.draw\(\);\n\s*canvas\.refreshMenu\(\);/);
  assert.match(press, /const layout = tab && tab\.kind === 'system' \? findSystemLayout\(id\) : findLayout\(id\);\n\s*if \(!layout \|\| !Array\.isArray\(layout\.modules\)\) return;/, 'Calendar and Map are their system layout, loaded as a saved one is');
  assert.match(press, /canvas\.holdMemory\(\);[^\n]*\n\s*currentLayoutTab = id;\n\s*layoutBase = null;\n\s*renderLayoutTabs\(\);[^\n]*\n\s*nav\.draw\(\);[\s\S]*canvas\.loadLayout\(layout\);/);
  assert.ok(press.indexOf('canvas.holdMemory()') < press.indexOf('canvas.loadLayout(layout)'), 'held before the load writes anything');
  assert.ok(!/showView|viewFrame|destinationsNow/.test(press), 'no view code: one path for every tab');
  assert.ok(!/function showView\(|function drawViews\(|function markViews\(|let currentView\b|currentView ===/.test(space), 'the view code is gone');
  assert.match(space, /currentLayoutTab = 'workspace'; \/\/ entering a space opens on the Workspace tab/);
  // Only the Workspace remembers (decision 15): canvas.js writes nothing while held, and a space change drops the hold.
  assert.match(canvasJs, /if \(!spaceId \|\| holdStore \|\| held\) return;/);
  assert.match(canvasJs, /held = \{ space: spaceId, saved: structuredClone\(saved\) \};/);
  assert.match(canvasJs, /saved = back;\n\s*restore\(\);/);
  assert.match(canvasJs, /held = null; \/\/ a hold is the space left's/);
  // The fit: tabOverflow, the keyboard on a tab that leaves to the "..."; the "..." menu on the shared menu.
  const fit = space.slice(space.indexOf('function fitLayoutTabs('), space.indexOf('function pressLayoutTab('));
  assert.match(fit, /const current = tabs\.findIndex\(\(b\) => b\.dataset\.layoutTab === shownLayoutTab\(\)\);/, 'the tab shown is told to the fit');
  assert.match(fit, /tabOverflow\(\{ avail: Math\.floor\(avail\) - 1, gap, widths: tabs\.map\(w\), more, current \}\)/);
  assert.match(fit, /b\.classList\.toggle\('layout-tab-out', out\.includes\(i\)\)/);
  assert.match(fit, /focused\.closest\('\.layout-tab-out'\)\) layoutTabsMore\.focus\(\);/);
  assert.match(space, /openHostMenu\(layoutTabsMore, items\);/);
  assert.match(css, /\.layout-tabs > \.layout-tab-out,/);
  // nav-bar.js: a `yieldFirst` tool is fitted with the others at their fullest, before them.
  const fitL = src.slice(src.indexOf('function fitLeft('), src.indexOf('function fitBar('));
  assert.match(fitL, /if \(fitting\.some\(\(t\) => t\.yieldFirst\)\) for \(const t of fitting\) \{ if \(!t\.yieldFirst\) \{ try \{ t\.fit\(Infinity\); \}/);
  // The favorites left the right zone: no group, no right-zone fit, no shortened names; the note hangs under the tabs.
  assert.ok(!/id: 'layout-favorites'|fitFavorites|labelsThatFit|FAVORITE_NAME_/.test(space), 'no favorites group in the right zone');
  assert.ok(!/function fitRight\(|labelsThatFit/.test(src), 'no right-zone fit in nav-bar.js');
  assert.ok(!/\.layout-favorites \{|\.layout-favorite \{|\.layout-favorite-name/.test(css), 'no favorites rules in the stylesheet');
  assert.match(space, /favoritesNote\.id = 'layout-favorites-note';/);
  assert.match(space, /favoritesNote\.setAttribute\('aria-hidden', 'true'\);/);
  assert.match(space, /if \(noteUnderFavorites && t\) showFavoritesNote\(t\);/, 'a tab\'s load note under the tab (and #layout-announce as before)');
  assert.match(space, /favoritesNoteTimer = setTimeout\(\(\) => showFavoritesNote\(''\), 6000\);/);
  assert.match(css, /\.layout-favorites-note \{[^}]*position: fixed;[^}]*background: var\(--bg-section\);/);
  // The Layout menu: the system rows first, each with a ... for anyone signed in (systemRowItems, step 4).
  const items = space.slice(space.indexOf('function layoutMenuItems() {'), space.indexOf('function layoutRowItems(layoutId) {'));
  assert.match(items, /for \(const l of layoutList\.system\) \{/);
  assert.match(items, /more: mayFavorite\(\) \? \(\) => systemRowItems\(l\.id\) : undefined,/);
  assert.match(items, /onPick: \(\) => pressLayoutTab\(l\.id\),/);
});

test('Rename and Change icon (plan-layout-views.md, step 4): a system row\'s ... holds Favorite or Unfavorite (not the Workspace), Rename and Change icon, never Delete; a saved row\'s gains Change icon; Rename on a system layout PATCHes, an empty name its default; Change icon is a sheet on the shared action bar with a radiogroup grid', () => {
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  // The system row's ...: anyone signed in; Favorite/Unfavorite only off the Workspace; Rename and Change icon; no Delete.
  const sysFn = space.slice(space.indexOf('function systemRowItems(systemId) {'), space.indexOf('// A layout\'s ...: Favorite or Unfavorite first'));
  assert.match(sysFn, /if \(!l \|\| !mayFavorite\(\)\) return \[\];/, 'never for a guest');
  assert.match(sysFn, /if \(l\.id !== 'workspace'\) \{\n\s*entries\.push\(l\.tab !== false\n\s*\? \{ icon: 'heart', label: 'Unfavorite', onPick: \(\) => setFavorite\(l, false\) \}\n\s*: \{ icon: 'heart', regular: true, label: 'Favorite', onPick: \(\) => setFavorite\(l, true\) \}\);/, 'the Workspace is never unfavorited');
  assert.match(sysFn, /\{ icon: 'pen', label: 'Rename', onPick: \(\) => startRename\(l\.id\) \},\n\s*\{ icon: 'icons', label: 'Change icon', onPick: \(\) => startChangeIcon\(l\.id\) \},/);
  assert.ok(!/Delete|Replace|Make default/.test(sysFn), 'a system layout is not deleted, replaced or made the default here');
  // A saved row: Change icon after Rename, where the layout may be changed (the server refuses a member's PUT on a shared one).
  const rowFn = space.slice(space.indexOf('function layoutRowItems(layoutId) {'), space.indexOf('async function setFavorite('));
  assert.match(rowFn, /label: 'Rename', onPick: \(\) => startRename\(layoutId\) \},\n\s*\{ icon: 'icons', label: 'Change icon', onPick: \(\) => startChangeIcon\(layoutId\) \},\n\s*\{ icon: 'trash', label: 'Delete'/);
  assert.ok(rowFn.indexOf("label: 'Change icon'") > rowFn.indexOf('if (!mayChangeLayout(shared)) return entries;'), 'only where the layout may be changed');
  // The row wears its chosen icon; one never chosen keeps the shared or own look.
  assert.match(space, /const userLayoutIcon = \(l, isShared\) => \(\/\^\[a-z0-9-\]\{1,40\}\$\/\.test\(l\.icon \|\| ''\) && l\.icon !== 'object-group' \? l\.icon : isShared \? 'user-group' : 'object-group'\);/);
  assert.match(space, /icon: userLayoutIcon\(l, isShared\),/);
  // Rename: the same sheet; a system layout's through PATCH .../system/:id, an empty name null (its default), with the
  // placeholder and the line saying so; a saved layout's through PUT, a name required.
  const rename = space.slice(space.indexOf('// Rename: the same sheet with the name filled in;'), space.indexOf('function openIconSheet('));
  assert.match(rename, /const systemLayoutUrl = \(id, systemId\) => `\/api\/spaces\/\$\{encodeURIComponent\(id\)\}\/layouts\/system\/\$\{encodeURIComponent\(systemId\)\}`;/);
  assert.match(rename, /emptyName: system \? system\.defaultName \|\| '' : '',/);
  assert.match(rename, /if \(system\) await layoutRequest\('PATCH', systemLayoutUrl\(layoutSpaceId\(\), layoutId\), \{ name: name \|\| null \}\);\n\s*else await layoutRequest\('PUT', layoutUrl\(layoutSpaceId\(\), layoutId\), \{ name \}\);/);
  assert.match(rename, /sheet\.close\(\);\n\s*await refreshLayouts\(\);/, 'the tab and the row drawn again');
  const sheet = space.slice(space.indexOf('function openLayoutSheet('), space.indexOf('function openSaveLayout({'));
  assert.match(sheet, /if \(!value && !emptyName\) \{ sheet\.error\('Give the layout a name\.'\); return false; \}/);
  assert.match(sheet, /hint\.textContent = `Leave it empty for \$\{emptyName\}\.`;/);
  assert.match(sheet, /input\.placeholder = emptyName;/);
  // Change icon: a <dialog> on the shared action bar, Save off until another icon is picked, no outside close, Escape asks.
  const icon = space.slice(space.indexOf('function openIconSheet('), space.indexOf('function startChangeIcon('));
  assert.match(icon, /dlg\.className = 'layout-sheet layout-icon-sheet';/);
  assert.match(icon, /const choices = layoutIconChoices\(\{ icons: getIcons\(\), system: layoutList\.system, current \}\);/, 'the set the server takes');
  assert.match(icon, /<div class="icon-grid layout-icon-grid" id="layout-icon-grid" role="radiogroup" aria-label="Icon"><\/div>/);
  assert.match(icon, /role="radio" aria-checked="false" tabindex="-1" data-icon-choice="\$\{escapeHtml\(c\.id\)\}" aria-label="\$\{escapeHtml\(c\.label\)\}"/, 'each icon a radio named by its words');
  assert.match(icon, /<i class="fa-solid fa-\$\{escapeHtml\(c\.id\)\} fa-fw" aria-hidden="true"><\/i>/, 'drawn as the tabs draw an icon');
  assert.match(icon, /b\.setAttribute\('aria-checked', on \? 'true' : 'false'\);\n\s*b\.classList\.toggle\('selected', on\);\n\s*b\.tabIndex = b === stop \? 0 : -1;/, 'the current one marked, one Tab stop');
  assert.match(icon, /const next = gridStep\(at, event\.key, shown\.length, columns\);/);
  assert.match(icon, /b\.hidden = !iconMatches\(c, search\.value\);/);
  assert.match(icon, /id="layout-icon-search"/);
  assert.match(icon, /\$\{defaultIcon \? '<button type="button" class="btn btn-small layout-icon-reset" id="layout-icon-reset">Reset to default<\/button>' : ''\}/);
  assert.match(icon, /ids: \{ save: 'layout-icon-save', cancel: 'layout-icon-cancel' \},\n\s*dirty: \(\) => chosen !== current,/);
  assert.match(icon, /dlg\.addEventListener\('cancel', \(event\) => \{ event\.preventDefault\(\); bar\.requestCancel\(\); \}\);/);
  const change = space.slice(space.indexOf('function startChangeIcon('), space.indexOf('// --- the layout tabs (plan-layout-views.md'));
  assert.match(change, /if \(system\) await layoutRequest\('PATCH', systemLayoutUrl\(layoutSpaceId\(\), layoutId\), \{ icon: icon === system\.defaultIcon \? null : icon \}\);\n\s*else await layoutRequest\('PUT', layoutUrl\(layoutSpaceId\(\), layoutId\), \{ icon \}\);/, 'the default icon saved as null, so it follows the default');
  assert.match(change, /await refreshLayouts\(\);/);
  // The tabs redraw on a new icon or name (their key holds both).
  assert.match(space, /const key = JSON\.stringify\(list\.map\(\(t\) => \[t\.id, t\.icon, t\.label, t\.temp === true\]\)\);/);
  assert.match(css, /\.layout-icon-grid \{[^}]*overflow-y: auto;/);
  assert.match(css, /\.layout-field-hint \{[^}]*color: var\(--text-dim\);/);
});

test('layoutIconChoices(), iconMatches() and gridStep() (plan-layout-views.md, step 4): the set, the search, the arrows', () => {
  const icons = [
    { id: 'couch', classes: 'fa-solid fa-couch', label: 'couch' },
    { id: 'github', classes: 'fa-brands fa-github', label: 'github' },
    { id: 'star', classes: 'fa-regular fa-star', label: 'star' },
    { id: 'dragon', classes: 'fa-solid fa-dragon fa-fw', label: 'Dragon' },
    { id: 'BAD id', classes: 'fa-solid fa-BAD id' },
    { id: 'couch', classes: 'fa-solid fa-couch', label: 'again' },
  ];
  const system = [
    { id: 'workspace', icon: 'couch', defaultIcon: 'columns' },
    { id: 'calendar', icon: 'calendar-check', defaultIcon: 'calendar-check' },
  ];
  const list = layoutIconChoices({ icons, system, current: 'mug-hot' });
  assert.deepEqual(list.map((c) => c.id), ['columns', 'object-group', 'couch', 'calendar-check', 'calendar-days', 'map-location-dot', 'dragon', 'mug-hot'], 'the defaults, the environment\'s solid ones once each, then the current one');
  assert.equal(list.find((c) => c.id === 'dragon').label, 'Dragon', 'the list\'s own label');
  assert.equal(list.find((c) => c.id === 'map-location-dot').label, 'map location dot', 'else the id\'s words');
  assert.ok(!list.some((c) => c.id === 'github' || c.id === 'star'), 'a brand or regular icon is not drawn as fa-solid, so not offered');
  assert.deepEqual(layoutIconChoices().map((c) => c.id), ['columns', 'object-group', 'calendar-days', 'map-location-dot'], 'nothing read yet: the defaults');
  assert.equal(layoutIconChoices({ current: 'Not<ok>' }).length, 4, 'a malformed current is left out');
  assert.equal(iconMatches({ id: 'map-location-dot', label: 'map location dot' }, 'map dot'), true);
  assert.equal(iconMatches({ id: 'map-location-dot', label: 'map location dot' }, 'MAP-loc'), true, 'the id with its hyphens too, any case');
  assert.equal(iconMatches({ id: 'couch', label: 'couch' }, 'map'), false);
  assert.equal(iconMatches({ id: 'couch', label: 'couch' }, '  '), true, 'an empty search shows everything');
  // 10 icons, 4 to a row: 0 1 2 3 / 4 5 6 7 / 8 9.
  assert.equal(gridStep(0, 'ArrowRight', 10, 4), 1);
  assert.equal(gridStep(9, 'ArrowRight', 10, 4), 0, 'Right wraps to the first');
  assert.equal(gridStep(0, 'ArrowLeft', 10, 4), 9, 'Left wraps to the last');
  assert.equal(gridStep(1, 'ArrowDown', 10, 4), 5);
  assert.equal(gridStep(6, 'ArrowDown', 10, 4), 6, 'no icon below: stays');
  assert.equal(gridStep(5, 'ArrowUp', 10, 4), 1);
  assert.equal(gridStep(2, 'ArrowUp', 10, 4), 2, 'the top row: stays');
  assert.equal(gridStep(5, 'Home', 10, 4), 0);
  assert.equal(gridStep(5, 'End', 10, 4), 9);
  assert.equal(gridStep(5, 'Enter', 10, 4), -1, 'not an arrow');
  assert.equal(gridStep(0, 'ArrowRight', 0, 4), -1, 'an empty grid');
  assert.equal(gridStep(3, 'ArrowDown', 10, 0), 4, 'columns at least one');
});

test('layoutTabs() (plan-layout-views.md, step 2): Workspace first, Calendar and Map while their tab holds, then favorites in order with no limit; none for a guest or an aside', () => {
  const system = [
    { id: 'workspace', kind: 'system', name: 'Workspace', icon: 'columns', tab: true },
    { id: 'calendar', kind: 'system', name: 'Calendar', icon: 'calendar-days', tab: true },
    { id: 'map', kind: 'system', name: 'Map', icon: 'map-location-dot', tab: true },
  ];
  const layouts = ['la', 'lb', 'lc', 'ld', 'le'].map((id) => ({ id, name: id.toUpperCase(), icon: 'object-group' }));
  const t = layoutTabs({ system, favorites: ['lc', 'la', 'le', 'lb', 'ld'], layouts, space: 'keep' });
  assert.deepEqual(t.map((x) => x.id), ['layout-tab-workspace', 'layout-tab-calendar', 'layout-tab-map', 'layout-tab-lc', 'layout-tab-la', 'layout-tab-le', 'layout-tab-lb', 'layout-tab-ld'], 'five favorites, in the order favorited, after the system tabs');
  assert.deepEqual(t.map((x) => x.current), [true, false, false, false, false, false, false, false], 'the Workspace is current by default');
  assert.deepEqual(t.slice(0, 3).map((x) => [x.kind, x.icon, x.label]), [['system', 'columns', 'Workspace'], ['system', 'calendar-days', 'Calendar'], ['system', 'map-location-dot', 'Map']]);
  assert.equal(t[3].kind, 'user');
  assert.deepEqual(layoutTabs({ system: [system[0], { ...system[1], tab: false }, system[2]], space: 'keep' }).map((x) => x.layout), ['workspace', 'map'], 'Calendar unfavorited: no tab');
  assert.deepEqual(layoutTabs({ system: [system[0], system[1]], space: 'keep' }).map((x) => x.layout), ['workspace', 'calendar'], 'no Map listed (off, or no map file): no tab');
  assert.deepEqual(layoutTabs({ system: [{ ...system[0], tab: false }], space: 'keep' }).map((x) => x.layout), ['workspace'], 'the Workspace is always a tab');
  assert.deepEqual(layoutTabs({ space: 'keep' }).map((x) => [x.layout, x.label, x.icon]), [['workspace', 'Workspace', 'columns']], 'the list not read yet: the Workspace alone');
  assert.equal(layoutTabs({ system: [{ ...system[0], name: 'Desk', icon: 'couch' }], space: 'keep' })[0].label, 'Desk', 'renamed');
  assert.equal(layoutTabs({ system: [{ ...system[0], icon: 'bad icon!' }], space: 'keep' })[0].icon, 'columns', 'a malformed icon: the default');
  assert.deepEqual(layoutTabs({ system, favorites: ['gone', 'la', 'la', 'map'], layouts, space: 'keep' }).map((x) => x.layout), ['workspace', 'calendar', 'map', 'la'], 'a favorite gone, listed twice, or a system id: left out');
  assert.equal(layoutTabs({ system, favorites: ['la'], layouts, space: 'keep', current: 'la' }).find((x) => x.current).layout, 'la');
  assert.equal(layoutTabs({ system, space: 'keep', current: 'map' }).find((x) => x.current).layout, 'map');
  assert.deepEqual(layoutTabs({ system: [system[0]], favorites: ['la'], layouts: layouts.slice(0, 2), space: 'keep', guest: true }).map((x) => x.layout), ['workspace', 'la', 'lb'], 'a guest: the Workspace and every shared layout the list holds, no favorites');
  assert.deepEqual(layoutTabs({ system, layouts, space: 'keep', guest: true, aside: true }), [], 'a guest in an aside: none');
  assert.deepEqual(layoutTabs({ system, favorites: ['la'], layouts, space: 'keep', aside: true }), [], 'an aside: none');
  assert.deepEqual(layoutTabs({ system }), [], 'no space: none');
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `l${i}`, name: `L${i}` }));
  assert.equal(layoutTabs({ system, favorites: many.map((l) => l.id), layouts: many, space: 'keep' }).length, 15, 'no limit on favorites');
});

test('tabOverflow() (plan-layout-views.md, decisions 14 and 17; Thomas, 2026-10-13): all while they fit; else the tabs leave from the right into the "...", never the Workspace or the tab shown', () => {
  const widths = [100, 90, 60, 80];
  const all = 100 + 90 + 60 + 80 + 3 * 2;
  assert.deepEqual(tabOverflow({ avail: 1000, gap: 2, widths, more: 30 }), { out: [], count: 4, more: false }, 'wide enough: every tab, no "..."');
  assert.deepEqual(tabOverflow({ avail: all, gap: 2, widths, more: 30 }), { out: [], count: 4, more: false }, 'exactly the width: every tab');
  assert.deepEqual(tabOverflow({ avail: all - 1, gap: 2, widths, more: 30 }), { out: [3], count: 3, more: true }, 'a pixel short: the last tab into the "..."');
  assert.deepEqual(tabOverflow({ avail: 100 + 90 + 60 + 2 * 2 + 2 + 30, gap: 2, widths, more: 30 }), { out: [3], count: 3, more: true }, 'three and the "..."');
  assert.deepEqual(tabOverflow({ avail: 100 + 90 + 60 + 2 * 2 + 2 + 29, gap: 2, widths, more: 30 }), { out: [2, 3], count: 2, more: true }, 'one more leaves, from the right');
  assert.deepEqual(tabOverflow({ avail: 100 + 2 + 30, gap: 2, widths, more: 30 }), { out: [1, 2, 3], count: 1, more: true }, 'the Workspace and the "..."');
  assert.deepEqual(tabOverflow({ avail: 40, gap: 2, widths, more: 30 }), { out: [1, 2, 3], count: 1, more: true }, 'the Workspace never leaves, even where it does not fit (the bar\'s other tools give way after it)');
  assert.deepEqual(tabOverflow({ avail: 0, gap: 2, widths, more: 30 }), { out: [1, 2, 3], count: 1, more: true });
  assert.deepEqual(tabOverflow({ avail: Infinity, widths }), { out: [], count: 4, more: false });
  assert.deepEqual(tabOverflow({ avail: 10, widths: [] }), { out: [], count: 0, more: false }, 'no tabs: nothing');
  assert.deepEqual(tabOverflow({ avail: 10, widths: [100] }), { out: [], count: 1, more: false }, 'the Workspace alone: no "..." for nothing');
  // The tab shown stays where it is, with the Workspace; the others leave from the right.
  assert.deepEqual(tabOverflow({ avail: 100 + 80 + 2 + 2 + 30, gap: 2, widths, more: 30, current: 3 }), { out: [1, 2], count: 2, more: true }, 'the last tab shown: it stays, the two before it leave');
  assert.deepEqual(tabOverflow({ avail: 100 + 90 + 80 + 2 * 2 + 2 + 30, gap: 2, widths, more: 30, current: 3 }), { out: [2], count: 3, more: true }, 'the rightmost of the others leaves first, not the tab shown');
  assert.deepEqual(tabOverflow({ avail: 100 + 2 + 30, gap: 2, widths, more: 30, current: 1 }), { out: [2, 3], count: 2, more: true }, 'the second tab shown: it stays past the width');
  assert.deepEqual(tabOverflow({ avail: 0, gap: 2, widths, more: 30, current: 0 }), tabOverflow({ avail: 0, gap: 2, widths, more: 30 }), 'the Workspace shown: as with none');
  assert.deepEqual(tabOverflow({ avail: 0, gap: 2, widths: [100, 90], more: 30, current: 1 }), { out: [], count: 2, more: false }, 'nothing that may leave: no "..."');
  for (let current = -1; current < widths.length; current += 1) {
    for (let avail = 0; avail <= all + 5; avail += 1) {
      const { out, count, more } = tabOverflow({ avail, gap: 2, widths, more: 30, current });
      assert.ok(!out.includes(0) && !out.includes(current), `at ${avail} px the Workspace and tab ${current} stay`);
      assert.equal(count, widths.length - out.length);
      assert.equal(more, out.length > 0);
      const others = [1, 2, 3].filter((i) => i !== current);
      assert.deepEqual(out, others.slice(others.length - out.length), 'the tabs that leave are the rightmost of the others, in order');
      const shown = widths.map((_, i) => i).filter((i) => !out.includes(i));
      const used = shown.reduce((sum, i) => sum + widths[i], 0) + 2 * (shown.length - 1) + (more ? 2 + 30 : 0);
      const onlyPinned = shown.every((i) => i === 0 || i === current);
      if (!onlyPinned) assert.ok(used <= avail + 0.5, `at ${avail} px what shows fits`);
    }
  }
});

test('the top bar\'s space segment and the Spaces slot wear the top bar\'s link look (core-link), and nothing restyles them on a wider screen', () => {
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  const seg = space.slice(space.indexOf('function crumbSegmentHtml('), space.indexOf('function updateCrumb()'));
  assert.match(seg, /<button type="button" class="crumb-here core-link crumb-link"/, 'an aside\'s parent segment');
  assert.match(seg, /<div class="crumb-here core-link"/, 'the space\'s segment, a div so .brand span does not size it');
  const brand = fs.readFileSync(path.join(ROOT, 'public/brand.js'), 'utf8');
  for (const cls of ['core-link nav-slot', 'core-link nav-slot-caret']) assert.ok(brand.includes(cls), `the Spaces slot\'s ${cls}`);
  // Outside the phone's block, no rule on a segment, its label or its icon sets a size, weight or colour of its own
  // (the separator, the .crumb box and the hover reset of the current space excepted).
  const phone = css.indexOf('@media (max-width: 640px) {');
  const wide = css.slice(0, phone) + css.slice(css.indexOf('\n}\n', phone));
  for (const m of wide.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (!/crumb-here|crumb-label|crumb-link|\.crumb span|\.crumb i\b|nav-slot(?!-pair)/.test(sel) || /:hover|:not\(\.core-link\)|aria-expanded/.test(sel)) continue;
    const own = m[2].split(';').map((d) => d.trim()).filter((d) => /^(font-size|font-weight|font|color)\s*:/.test(d) && !/:\s*inherit$/.test(d));
    assert.deepEqual(own, [], `${sel} restyles the segment`);
  }
});

test('the space bar in two zones: Layout (the module chooser), then Online, on the left; one colour; no #subnav-middle', () => {
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  assert.ok(!/subnav-middle|nav-middle/.test(space), 'the space bar\'s markup has no middle');
  assert.match(space, /<div class="nav-left subnav-left"><\/div>\n  <span class="nav-right subnav-tools"><\/span>/);
  assert.match(space, /nav\.register\(\{ bar: 'secondary', zone: 'left', group: 'modules', id: 'module-chooser', order: 1,/);
  // The chooser is the phone's tab bar, named by the module word; the Layout button (the environment's layout verb,
  // its own icon: not the snap switch's border-all, the dock columns or the conference's view grid) is the top bar's,
  // and its menu opens with a Show heading.
  assert.match(space, /id: 'module-chooser', order: 1, fold: false, icon: 'object-group', label: word\('module', \{ many: true, cap: true \}\), element: moduleChooser, visible: \(\) => phoneWidth\(\), workspace: 'only' \}\);/);
  assert.match(space, /function nameModuleChooser\(\) \{\n  moduleChooser\.querySelector\('#modules-menu'\)\.setAttribute\('aria-label', word\('module', \{ many: true, cap: true \}\)\);/);
  const canvasJs = fs.readFileSync(path.join(ROOT, 'public/canvas.js'), 'utf8');
  assert.match(canvasJs, /const items = \[\{ heading: 'Show' \}\];/);
  assert.match(space, /nav\.register\(\{ bar: 'secondary', zone: 'left', group: 'people', groupOrder: 2, id: 'who-here', order: 1, fold: false,[^\n]*fit: whoHere\.fit,/, 'Online after Modules, never folding, with fit');
  // In drawing order, Modules then Online, two groups (a divider between).
  const left = arrange([{ id: 'who-here', group: 'people', groupOrder: 2, order: 1, seq: 1 }, { id: 'module-chooser', group: 'modules', order: 1, seq: 2 }]);
  assert.deepEqual(ids(left), [['module-chooser'], ['who-here']]);
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  const dest = fs.readFileSync(path.join(ROOT, 'public/destination.css'), 'utf8');
  assert.match(css, /body\.in-space \.subnav \{\s*display: grid;\s*grid-column: 1 \/ -1;[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/, 'the left zone takes what the right does not');
  assert.ok(!/data-middle|subnav-middle/.test(css + dest), 'no data-middle and no #subnav-middle rules');
  assert.ok(!/\.subnav[^{,]*\.nav-middle/.test(css + dest), 'no rule for a middle in the space bar or a page bar');
  assert.ok(!/body\.destination-page \.subnav/.test(dest), 'the destination page has no bar of its own under the top bar: its module frame\'s title bar is its bar');
  assert.match(dest, /body\.destination-page > \.mf \{\s*flex: 1 1 auto;/, 'the frame fills the page under the top bar');
  // One colour: the bar's own, and no rule gives either zone a background.
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, sel, body] of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/background/.test(body)) continue;
    for (const one of sel.split(',').map((x) => x.trim())) {
      assert.ok(!/(^|\s)\.topbar \.nav-(left|right)$|\.subnav[^>]*\.nav-(left|right)$|\.subnav-(left|tools)$/.test(one), `no background on the space bar's zones (${one})`);
    }
  }
  assert.match(css, /\n\.subnav \{[^}]*background: var\(--nav-secondary-bg\);/, 'the whole bar is --nav-secondary-bg');
  // The phone's tab bar: Online is a tab of the bar (its wrapper holds no box of its own), no divider there.
  assert.match(css, /body\.in-space \.sdk-tabbar \.who-here \{\s*display: contents;/);
  assert.match(css, /body\.in-space \.subnav \.nav-divider,[^{]*\{\s*display: none;/);
});

test('Who is here in the top bar (Thomas, 2026-10-14): the space\'s, after the layout tabs, giving way first; the tab bar\'s count on a phone; out of the column', () => {
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const people = fs.readFileSync(path.join(ROOT, 'public/space-people.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'public/space.html'), 'utf8');
  // Wider than a phone: an element tool at the end of the top bar's left zone, with its fit, giving way first.
  assert.match(space, /const whoHereTop = \{ id: 'who-here', bar: 'primary', zone: 'left', group: 'people', groupOrder: 13, order: 1, icon: 'user-group', label: 'Who is here', element: whoHere\.el, fit: whoHere\.fit, yieldFirst: true, visible: whoHereTopWanted \};/);
  // In a space, call or no call; not while Home shows, not in an aside, not on a phone (the tab bar has it there).
  assert.match(space, /const whoHereTopWanted = \(\) => Boolean\(currentSpace\) && !viewingHome && !inAside\(\) && entered && !phoneWidth\(\);/);
  assert.ok(!/inCall/.test(space.match(/const whoHereTopWanted = [^\n]*/)[0]), 'it does not wait for the call');
  // The top bar wider than a phone, the tab bar on a phone: the same element, registered where it goes.
  assert.match(space, /const people = wide \? whoHereTop : whoHereBar;\n  if \(nav\.get\('who-here'\)\?\.bar !== people\.bar\) nav\.register\(people\);/);
  // The groups in drawing order: the switcher, the layout tabs, then Who is here.
  const left = arrange([{ id: 'who-here', group: 'people', groupOrder: 13, order: 1, seq: 9 }, { id: 'layout-tabs', group: 'views', groupOrder: 12, order: 10, seq: 5 }, { id: 'space-switcher', group: 'where', order: 9.5, seq: 2 }]);
  assert.deepEqual(left.flat().map((t) => t.id), ['space-switcher', 'layout-tabs', 'who-here']);
  // Not in the call's column any more.
  assert.ok(!/side-column-online/.test(html + space + css), 'no Online row in the column');
  assert.ok(!/\.side-column-online'\)\.appendChild\(whoHere\.el\)/.test(space));
  // Its name is "Who is here"; how many is its description; its list escapes the top bar's clipped left zone.
  assert.match(people, /aria-label="Who is here" aria-describedby="who-here-said"/);
  assert.match(css, /\.topbar > \.nav-left > \.who-here \.who-here-list \{\s*position: fixed;/);
  assert.match(people, /listEl\.style\.left = `\$\{Math\.round\(x - box\.left\)\}px`;/, 'placed from where the list starts, absolute or fixed');
});

test('Join the call (GitHub #165): in the space bar\'s left zone, Layout, then Join the call, then Online', () => {
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  // The three left-zone registrations as space.js makes them, arranged as the registry draws them.
  const reg = (id) => {
    const m = space.match(new RegExp(`nav\\.register\\(\\{ bar: 'secondary', zone: 'left', group: '([\\w-]+)',(?: groupOrder: ([\\d.]+),)? id: '${id}', order: (\\d+),`));
    assert.ok(m, `space.js registers ${id} in the space bar's left zone`);
    return { id, group: m[1], groupOrder: m[2] === undefined ? undefined : Number(m[2]), order: Number(m[3]) };
  };
  const left = [reg('who-here'), reg('join-call'), reg('module-chooser')].map((t, i) => ({ ...t, seq: i + 1 }));
  assert.deepEqual(ids(arrange(left)), [['module-chooser'], ['join-call'], ['who-here']], 'Layout, Join the call, Online: three groups, a divider between each');
  // Its own button: a phone icon, the words "Start call" or "Join call" (its accessible name, by whether a call is
  // running; on a phone the tab reads "Start" or "Join"), the accent look and the Layout button's size, nothing new in
  // colour. Wider than a phone it sits first in the call's title bar tools (#call-head-tools).
  assert.match(space, /joinCallButton\.id = 'join-call';/);
  assert.match(space, /joinCallButton\.className = 'btn btn-small btn-primary join-call nav-text';/);
  assert.match(space, /joinCallButton\.setAttribute\('aria-label', 'Start call'\);/);
  assert.match(space, /joinCallButton\.innerHTML = '<i class="fa-solid fa-phone fa-fw" aria-hidden="true"><\/i> <span class="join-call-label sdk-tabbar-label"><span class="join-call-verb">Start<\/span><span class="join-call-more"> call<\/span><\/span>';/);
  assert.match(space, /const verb = running \? 'Join' : 'Start';/, 'Join call while a call runs, Start call while none does');
  assert.match(space, /\$\('call-head-tools'\)\?\.prepend\(joinCallButton\)/, 'wider than a phone it is in the call\'s title bar (plan-workspaces.md, decision 28)');
  assert.match(space, /id: 'join-call', order: 1, icon: 'phone', label: 'Start call', element: joinCallButton, visible: joinCallWanted \}\);/);
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  assert.match(css, /\n\.join-call\[hidden\] \{\s*display: none;/, 'hidden means hidden, whatever its display');
  const own = [...css.matchAll(/([^{}]*\.join-call[^{}]*)\{([^{}]*)\}/g)].map((m) => m[2]).join('');
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(own), 'its rules use theme tokens only');
});

test('Join the call shows only out of the call, in the space, where the conference may show; it joins through joinTheCall()', () => {
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const m = space.match(/const joinCallWanted = \(\) => ([^;]+);/);
  assert.ok(m, 'space.js says when Join the call shows (joinCallWanted)');
  // Run the rule itself against each state.
  const wanted = (s) => new Function('currentSpace', 'homeChatSpace', 'entered', 'inCall', 'conferenceAllowed', 'features', 'canDo', `return (${m[1]});`)(
    s.space === undefined ? { id: 'lobby' } : s.space,
    s.home ? { id: 'lobby', isLobby: true } : null,
    s.entered !== false,
    Boolean(s.inCall),
    conferenceAllowed,
    { conferenceEnabled: s.enabled !== false, callService: s.callService !== false },
    () => s.permitted !== false,
  );
  assert.equal(wanted({}), true, 'in a space (its live stream open), out of the call: shown');
  assert.equal(wanted({ inCall: true }), false, 'in the call: hidden (Leave and Hang up stay as they are)');
  assert.equal(wanted({ space: { id: 'a1', isAside: true } }), true, 'in an aside out of its call: shown (the aside\'s call)');
  assert.equal(wanted({ space: null }), false, 'not in a space: hidden');
  assert.equal(wanted({ entered: false }), false, 'still entering, or left: hidden');
  assert.equal(wanted({ home: true }), false, 'Home\'s chat shows (Home over a space): no Start call or Join call; a call belongs to a space (GitHub #326)');
  assert.equal(wanted({ home: true, inCall: true }), false, 'in the call on Home: the button stays hidden, and the call bar keeps Leave and mute');
  assert.equal(wanted({ enabled: false }), false, 'the environment turned the conference off: hidden');
  assert.equal(wanted({ permitted: false }), false, 'may not see the conference: hidden');
  assert.equal(wanted({ callService: false }), false, 'no call service on the server (no LiveKit keys): hidden, not greyed out');
  // A press shows the conference as its switch does and joins through the one join path; the bar draws again when the
  // call state changes.
  assert.match(space, /joinCallButton\.addEventListener\('click', \(\) => joinTheCall\(\)\);/);
  assert.match(space, /function joinTheCall\(\) \{\n  if \(!canvas\.showBuiltin\('conference'\)\) return;\n  startCall\(\)\.catch\(\(err\) => setStatus\(`call: \$\{err\.message\}`, true\)\);\n\}/);
  const sync = space.slice(space.indexOf('function syncCallControl('), space.indexOf('\n}\n', space.indexOf('function syncCallControl(')));
  assert.match(sync, /nav\.draw\('secondary'\)/, 'syncCallControl() (called as the call starts and stops) draws the bar again');
  const canvasJs = fs.readFileSync(path.join(ROOT, 'public/canvas.js'), 'utf8');
  const show = canvasJs.slice(canvasJs.indexOf('const api_showBuiltin = (id) => {'), canvasJs.indexOf('\n  };\n', canvasJs.indexOf('const api_showBuiltin = (id) => {')));
  assert.match(show, /if \(!opened\.has\(id\)\) api_openBuiltin\(id\);/, 'closed: opened as the switch opens it');
  assert.match(show, /else setView\(id\);/, 'open behind another view: shown, as the switch does');
  assert.ok(!/closeBuiltin/.test(show), 'showing never closes (closing the conference hangs up)');
  assert.match(canvasJs, /\n    showBuiltin: api_showBuiltin,\n/);
});

test('the registry has two zones: register() refuses the middle, as any unknown zone', () => {
  assert.throws(() => register({ id: 'x', bar: 'secondary', zone: 'middle', icon: 'x', label: 'x' }), /zone must be left or right/);
  assert.throws(() => register({ id: 'x', bar: 'primary', zone: 'middle', icon: 'x', label: 'x' }), /zone must be left or right/);
  assert.throws(() => register({ id: 'x', bar: 'secondary', zone: 'top', icon: 'x', label: 'x' }), /zone must be left or right/);
  assert.ok(!('middleCentred' in navApi) && !('middleWidth' in navApi) && 'fitWidth' in navApi, 'the registry\'s object');
  for (const f of ['brand.js', 'primary-nav.js', 'space.js', 'destination.js']) assert.ok(!/zone: 'middle'/.test(fs.readFileSync(path.join(ROOT, 'public', f), 'utf8')), `${f} registers nothing in a middle zone`);
  const sdk = fs.readFileSync(path.join(ROOT, 'public/sdk/host.js'), 'utf8');
  assert.match(sdk, /`zone` is ignored/, 'the SDK says a module\'s zone is ignored');
});

test('who is here reads the live stream: you first, then by name, with who is on the call', () => {
  const list = [
    { key: 'z', name: 'Zoe', onCall: true, away: true, awayMessage: 'tea' },
    { key: 'a', name: 'Al', onCall: false },
    { key: 'me', name: 'Me', onCall: false },
    { key: 'n', name: '', onCall: true },
    { name: 'no key' },
  ];
  const people = peopleFromPresence(list, { you: 'me', meOnCall: true });
  assert.deepEqual(people.map((p) => [p.name, p.you, p.onCall]), [['Me', true, true], ['Al', false, false], ['n', false, true], ['Zoe', false, true]]);
  assert.deepEqual(people.find((p) => p.key === 'z'), { key: 'z', name: 'Zoe', you: false, onCall: true, away: true, awayMessage: 'tea' });
  assert.deepEqual(peopleFromPresence(null), []);
  assert.deepEqual(peopleFromPresence([], { you: 'me', youName: 'Me' }), [{ key: 'me', name: 'Me', you: true, onCall: false, away: false, awayMessage: '' }], 'before the first presence, just you');
  assert.deepEqual(hereWords(people, 'space'), { shown: '4 here', said: '4 people in this space, 3 on the call' });
  assert.deepEqual(hereWords(people.slice(0, 1).map((p) => ({ ...p, onCall: false })), 'aside'), { shown: 'Just you', said: 'Just you in this aside' });
  assert.deepEqual([1, 2, 3, 5, 6, 7, 40].map(liveRetryDelay), [2000, 4000, 8000, 32000, 60000, 60000, 60000], 'tried again after 2, 4, 8 ... seconds, at most a minute');
  assert.equal(liveStreamUrl({ space: 's1' }), '/api/live?space=s1');
  assert.equal(liveStreamUrl({ space: 's1', guest: 'tok', pass: 'p.q' }), '/api/live?space=s1&guest=tok&pass=p.q');
});

test('the space bar\'s lists draw above the modules and under a page opened over the call', () => {
  // The header (.topbar) is its own stacking layer, under the floating modules' layer, so a list inside it can't rise
  // above a module by its own z-index: the header rises to the menus' level while one is open, and the lists and the
  // page's shared menu sit at that level (above .module-layer, under .page-overlay).
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  const block = (sel) => {
    const at = css.search(new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`));
    assert.ok(at > -1, `style.css has ${sel}`);
    return css.slice(at, css.indexOf('}', at));
  };
  const z = (sel) => (block(sel).match(/z-index:\s*([^;]+);/) || [])[1]?.trim();
  const menu = Number((css.match(/--z-menu:\s*(\d+);/) || [])[1]);
  // A layer token (system.css, Foundations) read as its number.
  const sys = fs.readFileSync(path.join(ROOT, 'public/sdk/system.css'), 'utf8');
  const zNum = (v) => { const t = /^var\(--z-([a-z]+)\)$/.exec(v || ''); return t ? Number((sys.match(new RegExp(`--z-${t[1]}:\\s*(\\d+);`)) || [])[1]) : Number(v); };
  assert.ok(menu > zNum(z('.module-layer')), '--z-menu is above the floating modules\' layer');
  assert.ok(menu < Number(z('.page-overlay')), '--z-menu is under a page opened over the call');
  assert.ok(zNum(z('.topbar')) < zNum(z('.module-layer')), 'the header stays under a module dragged over it when nothing is open');
  // The space bar's own lists sit at the menus' level (under a page opened over the call). The page's shared menu is also opened from
  // inside a page, a dialog and a popover, and an Undo toast must never hide a long one, so while it is open it is the topmost thing:
  // one above the toast layer, and so above the floating modules (--z-menu), a page over the call and a dialog.
  for (const sel of ['.module-chooser-list', '.who-here-list']) assert.equal(z(sel), 'var(--z-menu)', `${sel} is at the menus' level`);
  assert.match(z('.host-menu'), /^calc\(var\(--z-toast\) \+ 1\)$/, '.host-menu is one above the toast layer');
  const toast = zNum('var(--z-toast)');
  for (const [name, v] of [['the floating modules\' layer', zNum(z('.module-layer'))], ['a page opened over the call', Number(z('.page-overlay'))], ['the menus\' level', menu], ['a dialog', zNum('var(--z-dialog)')], ['a popover', zNum('var(--z-popover)')]]) {
    assert.ok(toast + 1 > v, `.host-menu (${toast + 1}) is above ${name} (${v})`);
  }
  const lift = css.match(/\n\.topbar:has\(([^)]*\)[^{]*)\)\s*\{([^}]*)\}/);
  assert.ok(lift, 'the header rises while one of its lists is open (.topbar:has(...))');
  for (const list of ['.module-chooser-list:not([hidden])', '.who-here-list:not([hidden])']) assert.ok(lift[1].includes(list), `the header rises while ${list} is open`);
  assert.match(lift[2], /z-index:\s*var\(--z-menu\)/);
});

test('nothing around the space bar\'s lists cuts them off: no overflow but visible on the space bar or its zones', () => {
  // The Modules list and who's here hang below the space bar, out of its zones' boxes. The space bar sits inside the
  // header (.topbar), so a rule meant for the top bar's own zones (`.topbar .nav-left`) reaches the space bar's too
  // unless it is a child selector (`.topbar > .nav-left`): an `overflow: hidden` there hid the Modules list as it opened.
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const around = ['subnav', 'subnav-left', 'subnav-tools', 'page-bar', 'dest-bar', 'nav-left', 'nav-right', 'module-chooser', 'who-here'];
  const bad = [];
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|[;\s])overflow(-[xy])?\s*:\s*(hidden|clip|auto|scroll)/.test(body)) continue;
    for (const sel of selectors.split(',').map((x) => x.trim())) {
      const m = sel.match(/(\s*>\s*|\s+)?([^\s>+~]+)$/);
      if (!m) continue;
      const classes = [...m[2].replace(/:[\w-]+(\([^)]*\))?/g, '').matchAll(/\.([\w-]+)/g)].map((c) => c[1]);
      if (!classes.some((c) => around.includes(c))) continue;
      const child = (m[1] || '').includes('>');
      const before = sel.slice(0, sel.length - m[0].length).trim();
      // A zone selected as the top bar's own child is not the space bar's; anything else may match it.
      if (child && /(^|\s)\.topbar$/.test(before) && !classes.includes('subnav')) continue;
      bad.push(sel);
    }
  }
  assert.deepEqual(bad, [], 'these rules clip the space bar or its zones, and so its Modules list or who\'s here');
  assert.match(css, /\n\.topbar > \.nav-left \{\s*overflow: hidden;/, 'the top bar\'s own left zone still cuts a long breadcrumb');
});

test('the top bar\'s slots, left to right: logo, environment, the destinations, Spaces, the anchor, then online people, the bell and the profile', () => {
  // The order is the registrations' in brand.js (primary-nav.js's SLOTS list, read by nothing else, is gone). No Modules
  // slot: Thomas removed it on 2026-10-02 (a module page is reached from its tile on home, or at /modules/<id>).
  const brand = fs.readFileSync(path.join(ROOT, 'public/brand.js'), 'utf8');
  const reg = (id) => {
    const m = brand.match(new RegExp(`nav\\.register\\(\\{ id: '${id}', bar: 'primary', zone: '(\\w+)'[^\\n]*?order: (\\d+)`));
    assert.ok(m, `brand.js registers ${id}`);
    return { zone: m[1], order: Number(m[2]) };
  };
  const left = ['spaces-slot', 'topbar-crumb', 'topbar-status'].map(reg);
  assert.ok(left.every((t) => t.zone === 'left'), 'Spaces and the anchor are the left zone');
  assert.deepEqual(left.map((t) => t.order), [9, 10, 11], 'Spaces, then the anchor, after the destinations (orders 1 to 8)');
  assert.match(brand, /id: 'spaces-slot', bar: 'primary', zone: 'left', group: 'where'/, 'Spaces in the group `where`, with the destinations');
  const dests = destinationTools(Array.from({ length: 9 }, (_, i) => ({ id: `d${'abcdefghi'[i]}x`, name: `D${i}`, href: `/d${i}` })));
  assert.ok(dests.every((d) => d.bar.zone === 'left' && d.bar.group === 'where' && d.bar.order < 9), 'every destination ahead of Spaces (at most 8)');
  const html = brand.slice(brand.indexOf('header.innerHTML = `'), brand.indexOf('nav.attach(\'primary\', header)'));
  assert.ok(html.indexOf('brand-logo') > -1 && html.indexOf('brand-logo') < html.indexOf('data-brand="environmentName"'), 'the logo box, then the environment\'s name, in the left zone\'s markup ahead of the tools');
  assert.ok(reg('notifications-bell').zone === 'right' && reg('whoami-link').zone === 'right', 'the bell and the profile are the right zone');
  assert.match(brand, /id: 'notifications-bell'[^\n]*groupOrder: 90/);
  assert.match(brand, /id: 'whoami-link'[^\n]*groupOrder: 999/, 'the profile last');
});

test('no Modules slot in the top bar (Thomas, 2026-10-02): no modules-nav, no module page entries in the phone menu, no Modules menu or its counts', () => {
  const brand = fs.readFileSync(path.join(ROOT, 'public/brand.js'), 'utf8');
  assert.ok(!/modules-nav|moduleMenuItems|openModulePage|modulePages|loadModuleNav|refreshModuleNav|module-nav-loaded/.test(brand), 'brand.js draws no Modules slot, menu or count');
  assert.ok(!/id: `page-\$\{/.test(brand), 'no page-<id> entries in the phone menu');
  assert.ok(!/\/api\/modules\/nav/.test(brand), 'the bar does not ask for the module pages');
  const admin = fs.readFileSync(path.join(ROOT, 'public/admin.js'), 'utf8');
  assert.ok(!/refreshModuleNav/.test(admin), 'Manage no longer refreshes a bar entry that is gone');
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  assert.ok(!/module-nav-link|module-nav-label/.test(css), 'no styles left for the old module page links');
  // The space bar's own Modules chooser (the canvas's switches) stays.
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  assert.match(space, /id: 'module-chooser'/);
});

test('gone from the top bar: the clock, the lock or luggage icon beside the logo, the theme switch, the module page links', () => {
  const brand = fs.readFileSync(path.join(ROOT, 'public/brand.js'), 'utf8');
  assert.ok(!/topbar-clock|startClock/.test(brand), 'no clock');
  assert.ok(!/id: 'spaces-link'|spacesTool/.test(brand), 'the Spaces slot replaced the spaces-link tool');
  assert.ok(!/zone: 'middle'/.test(brand), 'nothing of the system\'s in the middle zone');
  assert.ok(!/zone: 'middle'/.test(fs.readFileSync(path.join(ROOT, 'public/primary-nav.js'), 'utf8')), 'the destinations are not in the middle zone either (plan-two-zone-nav.md)');
  assert.match(brand, /id: 'theme-mode-switch'[^\n]*visible: \(\) => inMenu\(\) && offers\('theme'\)/, 'the theme switch is in the phone menu only; the profile menu has Dark mode');
  assert.match(brand, /id: 'admin-link'[^\n]*visible: \(\) => inMenu\(\) && offers\('manage'\)/, 'on a phone Manage is the menu\'s entry (as Set up is)');
  assert.match(brand, /id: 'manage-tool', bar: 'primary', zone: 'right', group: 'space', groupOrder: 85, order: 0, place: 'end', icon: 'gear', label: 'Manage'[^\n]*visible: \(\) => !onPhone\(\) && signedInHere\(\) && offers\('manage'\)/, 'wider than a phone Manage is a gear button in the top bar beside Set up, for those profileEntries gives Manage (owners and the admin)');
  assert.ok(!/id: 'setup'[^\n]*icon: 'gear'/.test(fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8')), 'Set up keeps its own icon, apart from Manage\'s gear');
  assert.match(brand, /<img data-brand="icon"[^>]*><i [^>]*data-brand="home-icon"/, 'the uploaded logo and the home icon share one box');
  assert.match(brand, /if \(img\) img\.hidden = !b\.hasIcon;/, 'the uploaded logo shows only when there is one');
  assert.match(brand, /if \(icon\) icon\.hidden = Boolean\(b\.hasIcon\);/, 'never both');
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  assert.ok(!/id="space-name"/.test(space), 'the space bar no longer names the space (decision 14)');
  assert.match(space, /anchorSegments\(/, 'the space page draws the breadcrumb with anchorSegments (crumbSegments inside)');
});

test('the profile menu names the environment\'s pages Global Calendar and Global Map; ids and routes unchanged', () => {
  assert.equal(profileDestinationLabel('calendar', 'Calendar'), 'Global Calendar');
  assert.equal(profileDestinationLabel('map', 'Maps'), 'Global Map');
  assert.equal(profileDestinationLabel('map', 'Map'), 'Global Map');
  assert.equal(profileDestinationLabel('calendar', 'Itinerary'), 'Global Itinerary', 'a template\'s name kept');
  const brand = fs.readFileSync(path.join(ROOT, 'public/brand.js'), 'utf8');
  assert.match(brand, /label: profileDestinationLabel\(d\.id, d\.name\), onPick: \(\) => openDestination\(d\.href\)/);
});

test('the profile menu by role: owners get Manage; the single install\'s admin Manage only; the host admin\'s stand-in Manage and Host console; members and moderators nothing more; Install only while offered; no menu for a guest', () => {
  const base = ['profile', 'theme'];
  assert.deepEqual(profileEntries({ role: 'member' }), [...base, 'sign-out']);
  assert.deepEqual(profileEntries({ role: 'member', installOffered: true }), [...base, 'install', 'sign-out']);
  assert.deepEqual(profileEntries({ role: 'owner' }), [...base, 'manage', 'sign-out']);
  assert.deepEqual(profileEntries({ role: 'owner', hosted: true, installOffered: true }), [...base, 'manage', 'install', 'sign-out']);
  assert.deepEqual(profileEntries({ role: 'admin', hosted: false }), [...base, 'manage', 'sign-out'], 'a single install: Manage only, no host console');
  assert.deepEqual(profileEntries({ role: 'admin', hosted: false, hostAdmin: true }), [...base, 'manage', 'sign-out'], 'no host console without a hosted server');
  assert.deepEqual(profileEntries({ role: 'admin', hosted: true, hostAdmin: true }), [...base, 'manage', 'host-console', 'sign-out']);
  assert.deepEqual(profileEntries({ role: 'admin', hosted: true, hostAdmin: true, installOffered: true }), [...base, 'manage', 'host-console', 'install', 'sign-out']);
  assert.deepEqual(profileEntries({ role: 'member', themeSwitch: false }), ['profile', 'sign-out']);
  assert.deepEqual(profileEntries({ role: 'guest', installOffered: true }), [], 'a guest: no menu, no install');
  assert.deepEqual(profileEntries({}), []);
  // plan-one-bar.md, decision 6: the environment's Calendar and Map, between Dark mode and Manage, for every account.
  assert.deepEqual(profileEntries({ role: 'member', destinations: ['calendar', 'map'] }), [...base, 'dest-calendar', 'dest-map', 'sign-out']);
  assert.deepEqual(profileEntries({ role: 'owner', destinations: ['calendar'] }), [...base, 'dest-calendar', 'manage', 'sign-out']);
  assert.deepEqual(profileEntries({ role: 'member', themeSwitch: false, destinations: ['map', 'x y', ''] }), ['profile', 'dest-map', 'sign-out'], 'a malformed id is left out');
  assert.deepEqual(profileEntries({ role: 'guest', destinations: ['calendar'] }), [], 'never a guest');
  assert.equal(seesUpdates('owner') && seesUpdates('admin'), true);
  assert.equal(seesUpdates('member') || seesUpdates('guest') || seesUpdates(undefined), false);
  const brand = fs.readFileSync(path.join(ROOT, 'public/brand.js'), 'utf8');
  const menu = brand.slice(brand.indexOf('function accountMenuItems('), brand.indexOf('\n}\n', brand.indexOf('function accountMenuItems(')));
  assert.match(menu, /new Set\(profileFor\(\)\)/, 'the menu under your picture follows profileEntries');
  assert.match(menu, /label: 'Dark mode', checked: modeNow\(\) === 'dark'/, 'Dark mode is a checkbox entry');
  assert.match(menu, /\.\.\.destinationList\.filter\(\(d\) => has\.has\(`dest-\$\{d\.id\}`\)\)\.map\(\(d\) => \(\{ icon: d\.icon, label: profileDestinationLabel\(d\.id, d\.name\), onPick: \(\) => openDestination\(d\.href\) \}\)\)/, 'Global Calendar and Global Map after Dark mode, each what the server lists');
  assert.ok(!/Manage|manage/.test(menu), 'the profile menu no longer holds Manage: it is a button in the top bar');
  assert.ok(menu.indexOf('destinationList.filter') < menu.indexOf("has.has('host-console')"), 'destinations before the Host console');
  assert.match(brand, /destinations: destinationList\.map\(\(d\) => d\.id\)/, 'profileFor passes the destinations');
  assert.match(brand, /function openDestination\(href\) \{\n\s*openPage\(keepingQuery\(href\), 'destination'\);/, 'opened as a page: over the space while present, else the page itself');
  assert.equal(pageOpens({ kind: 'destination', present: false }), 'page');
  assert.equal(pageOpens({ kind: 'destination', present: true }), 'overlay');
});

test('the host console\'s address, from an environment\'s own; none on a single install', () => {
  assert.equal(hostConsoleUrl({ protocol: 'https:', hostname: 'sandbox.example.org', port: '' }, 'sandbox'), 'https://admin.example.org/');
  assert.equal(hostConsoleUrl({ protocol: 'http:', hostname: 'sandbox.localhost', port: '3000' }, 'sandbox'), 'http://admin.localhost:3000/');
  assert.equal(hostConsoleUrl({ protocol: 'https:', hostname: 'example.org' }, ''), null);
  assert.equal(hostConsoleUrl({ protocol: 'https:', hostname: 'other.example.org' }, 'sandbox'), null);
});

test('the space switcher: your spaces in the list\'s order, never an aside, a mark where you are present, the count; a pick enters or goes back', () => {
  const spaces = [
    { id: 'lobby', name: 'Lobby', mine: true },
    { id: 'paris', name: 'Paris', mine: false },
    { id: 'disney', name: 'Disneyland', mine: true },
    { id: 'aside1', name: 'Aside', mine: true, isAside: true },
  ];
  const users = [{ key: 'a', online: true, space: 'disney' }, { key: 'b', online: true, space: 'disney' }, { key: 'c', online: false, space: 'disney' }, { key: 'd', online: true, space: 'lobby' }];
  assert.deepEqual(switcherEntries({ spaces, users, present: 'disney' }), [
    { id: 'lobby', name: 'Lobby', here: false, count: 1 },
    { id: 'disney', name: 'Disneyland', here: true, count: 2 },
    { id: 'disney', leave: true },
  ], 'present in Disneyland: Leave for it last (plan-one-bar.md, step 5)');
  assert.deepEqual(switcherEntries({ spaces, users, present: null }).map((e) => e.id), ['lobby', 'disney'], 'present nowhere: no Leave');
  assert.deepEqual(switcherEntries({ spaces, users, present: 'paris' }).map((e) => e.id), ['lobby', 'disney'], 'present in a space not in the list: no Leave');
  assert.deepEqual(switcherEntries({}), []);
  // The Lobby is Home itself (plan-home-lobby.md, step 2): its record stays, marked isLobby, and is never offered.
  const homeBacked = spaces.map((s) => (s.id === 'lobby' ? { ...s, isLobby: true } : s));
  assert.deepEqual(switcherEntries({ spaces: homeBacked, users, present: 'disney' }).map((e) => e.id), ['disney', 'disney'], 'never the Lobby: Disneyland and its Leave');
  assert.deepEqual(switcherEntries({ spaces: homeBacked, users, present: 'lobby' }).map((e) => e.id), ['disney'], 'present in the Lobby (a guest link, an old page): no entry for it, no Leave');
  assert.equal(switchPick(null, 'disney'), 'enter', 'present nowhere: enter');
  assert.equal(switchPick('disney', 'disney'), 'back', 'present there: back to it');
  assert.equal(switchPick('lobby', 'disney'), 'enter', 'present elsewhere: enter, until the visit view');
});

test('Leave in the switcher (plan-one-bar.md, step 5): the top bar draws it last, the phone menu leaves it out, the space page leaves on it; the bar\'s Leave only where it is the tab bar; the Workspace toolbar\'s view class', () => {
  const brand = fs.readFileSync(path.join(ROOT, 'public/brand.js'), 'utf8');
  const switcher = brand.slice(brand.indexOf('async function openSwitcher('), brand.indexOf('let menuSpaceIds'));
  assert.match(switcher, /const leave = entries\.find\(\(e\) => e\.leave\);/);
  assert.match(switcher, /entries\.filter\(\(e\) => !e\.leave\)\.map\(/, 'the Leave entry is not drawn as a space');
  const lines = switcher.split('\n').filter((l) => l.includes('items.push'));
  assert.match(lines[lines.length - 1], /if \(leave\) items\.push\([^\n]*icon: 'right-from-bracket', label: `Leave \$\{word\('space'\)\}`, onPick: \(\) => pickSpace\(leave\.id, 'leave'\)/, 'Leave <space> is the last entry, after New <space>');
  assert.match(brand, /async function refreshMenuSpaces\(\) \{[\s\S]*?switcherEntries\([^\n]*\)\.filter\(\(e\) => !e\.leave\);/, 'the phone menu lists no Leave (decision 3: the tab bar keeps it)');
  assert.match(brand, /function pickSpace\(id, action = switchPick\(presentSpaceNow\(\), id\)\)/);
  assert.match(brand, /if \(!unhandled \|\| action === 'leave'\) return;/, 'with no space page to take it, Leave goes nowhere');
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const handler = space.slice(space.indexOf("document.addEventListener('app:enter-space'"), space.indexOf('window.appApplyCallPrefs'));
  assert.match(handler, /if \(action === 'leave'\) \{\n\s*if \(connected\) leaveSpace\(\);\n\s*return;\n\s*\}/, 'the space page leaves on it, as its Leave button did');
  assert.match(space, /id: 'leave-space', order: 999, phone: 'bar',[^\n]*visible: \(\) => phoneWidth\(\),/, 'the bar\'s Leave shows only where the bar is the phone\'s tab bar');
  // The views became layout tabs (plan-layout-views.md, step 3): no body.view-<id>; the page starts on the Workspace tab,
  // and wider than a phone the second row hides itself when empty (the Workspace's tools are the top bar's).
  assert.ok(!/showSpaceView|classList\.add\(`view-/.test(space), 'no body.view-<id> any more');
  assert.match(space, /^let currentLayoutTab = 'workspace';$/m, 'the Workspace is the tab the page starts on');
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  assert.ok(!/body\.view-|\.view-workspace|\.view-frame/.test(css), 'no view rules in the stylesheet');
});

test('the Workspace\'s controls in the top bar (Thomas, 2026-10-13): Workspace tools go where setWorkspace() puts them, sit nearest the middle, show on the Workspace view, fold into the top bar\'s "..."; the empty second row is not drawn', () => {
  const { wideZones, setWorkspace, get } = navApi;
  assert.equal(typeof setWorkspace, 'function');
  // wideZones: in the top bar the Workspace tools are the last run of the left zone and the first of the right; a
  // Workspace tool with a `place` sits among the bar's own ('own': the favorites and Layout, in the bell's group) or
  // in a last run after them ('end': Full screen and Pop out, right of your picture; Thomas, 2026-10-13), and so may one
  // of the bar's own (Set up, first in that run: "Settings should go right before the window controls").
  const t = (id, zone, extra = {}) => ({ id, bar: 'primary', zone, ...extra });
  const byZone = {
    left: [t('space-switcher', 'left', { group: 'where', order: 9.5 }), t('layout-tabs', 'left', { group: 'views', groupOrder: 12, order: 10 })],
    right: [t('setup', 'right', { group: 'space', groupOrder: 85, order: 1, place: 'end' }), t('notifications-bell', 'right', { group: 'notices', groupOrder: 90, order: 90 }), t('fullscreen-toggle', 'right', { group: 'space', groupOrder: 1, order: 11, workspace: 'only', place: 'end' }), t('todo:mine', 'right', { group: 'todo:own', groupOrder: 500, order: 500, workspace: 'only' }), t('topbar-more', 'right', { group: 'more', groupOrder: 999, order: 998, workspace: 'every', more: 'primary' }), t('whoami-link', 'right', { group: 'you', groupOrder: 999, order: 999 }), t('recall-button', 'right', { group: 'space', groupOrder: 1, order: 51, workspace: 'every' }), t('popout', 'right', { group: 'space', groupOrder: 1, order: 12, workspace: 'only', place: 'end' })],
  };
  const w = wideZones(byZone);
  assert.deepEqual(w.left.map((run) => run.map((x) => x.id)), [['space-switcher', 'layout-tabs'], []], 'the left zone: the bar\'s own (the layout tabs after the switcher; the chip is the status strip\'s), then the Workspace\'s (none now)');
  assert.deepEqual(w.right.map((run) => run.map((x) => x.id)), [['todo:mine', 'topbar-more', 'recall-button'], ['notifications-bell', 'whoami-link'], ['setup', 'fullscreen-toggle', 'popout']], 'the right zone: the Workspace\'s tools and the "..." first, then the bar\'s own with Layout (no favorites: they are tabs now), then Set up, Full screen and Pop out');
  assert.deepEqual(w.bar, [], 'nothing in the phone\'s place');
  assert.deepEqual(ids(arrange(w.right[0])), [['recall-button'], ['todo:mine'], ['topbar-more']], 'within the run: the space\'s group, a module\'s groups, then the "..."');
  assert.deepEqual(ids(arrange(w.right[1])), [['notifications-bell'], ['whoami-link']], 'the bar\'s own run: Layout and the bell together (no divider), then you (Thomas, 2026-10-13)');
  assert.deepEqual(ids(arrange(w.right[2])), [['setup', 'fullscreen-toggle', 'popout']], 'the last run, one group: Set up, Full screen, then Pop out');
  // The whole right end as drawn, left to right.
  assert.deepEqual(w.right.flatMap((run) => arrange(run).flat()).map((x) => x.id).slice(3), ['notifications-bell', 'whoami-link', 'setup', 'fullscreen-toggle', 'popout'], 'the bell, you, Set up, Full screen, Pop out');
  // On a phone `place` is not read: Set up keeps its place, before the bell and you (these test tools name no `phone`).
  const ph = navApi.phoneZones({ left: [], right: byZone.right.filter((x) => !x.workspace) });
  assert.deepEqual(ph.right[1].length ? arrange(ph.right[1]).flat().map((x) => x.id) : [], ['setup', 'notifications-bell', 'whoami-link'], 'the phone\'s order: Set up, the bell, you, as before');
  // One small equal gap between the right end's controls, from a layout token (style.css).
  const cssW = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  assert.match(cssW, /--topbar-gap: 4px;/);
  assert.match(cssW, /@media \(min-width: 641px\) \{\n\s*\.topbar > \.nav-right \{\n\s*gap: var\(--topbar-gap\);/);
  const src = fs.readFileSync(path.join(ROOT, 'public/nav-bar.js'), 'utf8');
  assert.match(src, /const wide = !fold && bar === 'primary';\n(?:.*\n)?\s*const runs = fold \? phoneZones\(byZone\) : wide \? wideZones\(byZone\) : \{ left: \[byZone\.left\], right: \[byZone\.right\], bar: \[\] \};/, 'the top bar wider than a phone draws wideZones(); the space bar and the phone as before');
  assert.match(src, /bar === 'secondary' && view && typeof view\.matchMedia === 'function' && view\.matchMedia\('\(max-width: 640px\)'\)\.matches\) Object\.assign\(byZone, tabBarZones\(byZone\)\)/, 'the space bar on a phone draws the "..." after the module tabs');
  assert.match(src, /flattenRuns\(list, doc, \{ divide: wide \}\)/, 'a divider between the two runs, in the top bar only');
  // setWorkspace: a Workspace tool registered on either bar goes to the bar named; the "..." stays its bar's own.
  register({ id: 'ws-test-a', bar: 'secondary', zone: 'right', icon: 'x', label: 'x', workspace: 'only', order: 11 });
  register({ id: 'ws-test-b', bar: 'secondary', zone: 'left', icon: 'x', label: 'x', workspace: 'every', order: 1 });
  register({ id: 'ws-test-c', bar: 'secondary', zone: 'right', icon: 'x', label: 'x', order: 52 });
  assert.equal(get('ws-test-a').bar, 'secondary', 'until the page says otherwise, the space bar');
  setWorkspace({ bar: 'primary' });
  assert.equal(get('ws-test-a').bar, 'primary');
  assert.equal(get('ws-test-b').bar, 'primary');
  assert.equal(get('ws-test-c').bar, 'secondary', 'a tool that is not the Workspace\'s stays');
  register({ id: 'ws-test-d', bar: 'secondary', zone: 'right', icon: 'x', label: 'x', workspace: 'only' });
  assert.equal(get('ws-test-d').bar, 'primary', 'registered later, with the space bar named: still the top bar');
  register({ id: 'ws-test-a', bar: 'secondary', zone: 'right', icon: 'x', label: 'x', workspace: 'only', order: 11 });
  assert.equal(get('ws-test-a').bar, 'primary', 'registered again (the words loaded): still the top bar');
  setWorkspace({ bar: 'secondary' });
  assert.equal(get('ws-test-a').bar, 'secondary', 'back to the space bar on a phone');
  assert.throws(() => setWorkspace({ bar: 'middle' }), /primary or secondary/);
  for (const id of ['ws-test-a', 'ws-test-b', 'ws-test-c', 'ws-test-d']) navApi.unregister(id);
  assert.match(src, /if \(isWorkspaceTool\(rec\)\) rec\.bar = workspace\.bar;/, 'register() puts a Workspace tool where the page put the toolbar');
  assert.match(src, /const isWorkspaceTool = \(t\) => Boolean\(t\.workspace\) && !t\.more;/, 'the bars\' own "..." never moves');
  assert.match(src, /if \(prev && prev\.bar !== rec\.bar\) draw\(prev\.bar\);/, 'the bar a tool left is drawn again');
  // The view rule: a 'only' tool is hidden while the Workspace is not the view (shown may be a function, read on each draw).
  assert.match(src, /if \(t\.workspace === 'only' && !onView\) want = true;/);
  assert.match(src, /const workspaceShown = \(\) => \{\n\s*if \(typeof workspace\.shown !== 'function'\) return Boolean\(workspace\.shown\);/);
  assert.match(src, /if \(el\.hidden !== want\) el\.hidden = want;/, 'written only when it changes, so the hidden watch never loops');
  // The top bar's own "...": #topbar-more, last of the Workspace run, never folds, never moves.
  assert.match(src, /more\.id = bar === 'secondary' \? 'subnav-more' : 'topbar-more';/);
  assert.match(src, /register\(\{ bar, zone: 'right', group: 'more', groupOrder: 999, id: 'topbar-more', order: 998, fold: false, workspace: 'every', more: bar, icon: 'ellipsis-vertical', label: 'More', element: more, visible: \(\) => fold\.showMore \}\);/);
  assert.match(src, /register\(\{ bar, zone: 'right', group: 'leave', id: 'subnav-more', order: 998, afterTabs: true, fold: false, icon: 'ellipsis-vertical', label: 'More', element: more, visible: \(\) => fold\.showMore \}\);/, 'the space bar\'s "..." as before');
  assert.match(src, /attachFold\(bar, el\);\n\s*draw\(bar\);/, 'both bars get a "..."');
  // The space page: Layout, Full screen and Pop out show on every layout tab, not in an aside; Pull participants back
  // in every view; Rejoin call only where the bar is the tab bar (the top bar's aside-rejoin is the other); the view and the
  // phone's width decide where they go and whether they show.
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  assert.match(space, /id: 'module-chooser', order: 1, fold: false, icon: 'object-group', label: word\('module', \{ many: true, cap: true \}\), element: moduleChooser, visible: \(\) => phoneWidth\(\), workspace: 'only' \}\);/);
  assert.match(space, /id: 'fullscreen-toggle',[^\n]*phone: 'popout', workspace: 'only', place: 'end',/);
  assert.match(space, /id: 'popout',[^\n]*phone: 'popout', workspace: 'only', place: 'end',/);
  assert.match(space, /id: 'recall-button', order: 51,[^\n]*labelled: true, workspace: 'every', visible: \(\) => recallWanted\(\),/);
  assert.match(space, /id: 'rejoin-call', order: 52, phone: 'bar', short: 'Rejoin',[^\n]*visible: \(\) => Boolean\(currentSpace && currentSpace\.isAside && currentSpace\.origin\) && phoneWidth\(\),/);
  assert.match(space, /const workspaceShown = \(\) => phoneWidth\(\) \|\| !inAside\(\);\nnav\.setWorkspace\(\{ shown: workspaceShown \}\);/, 'the Layout menu, Full screen and Pop out on every layout tab, hidden only in an aside (plan-layout-views.md, decision 5: "the layout menu stays where it is and as it is")');
  assert.ok(!/workspaceShown = [^\n]*currentLayoutTab/.test(space), 'which tab is shown never hides the Workspace\'s tools');
  assert.ok(!/modules-toggle/.test(space), 'the Layout button is gone: Set up\'s Show tab holds the menu');
  const placeSub = space.slice(space.indexOf('function placeSubnav()'), space.indexOf('\nplaceSubnav();'));
  assert.match(placeSub, /nav\.setWorkspace\(\{ bar: tabs \? 'secondary' : 'primary' \}\);/, 'placeSubnav() names the bar by the header\'s own window');
  const pressed = space.slice(space.indexOf('function pressLayoutTab('), space.indexOf("layoutTabsEl.addEventListener('click'"));
  assert.equal((pressed.match(/renderLayoutTabs\(\);[^\n]*\n\s*nav\.draw\(\);/g) || []).length, 2, 'a tab change draws the bars again, to the Workspace and away from it');
  assert.match(space, /function updateRecallButton\(\) \{\n\s*nav\.draw\(\);/, 'Pull participants back is drawn in whichever bar it is in');
  assert.ok(!/nav\.setWorkspace/.test(fs.readFileSync(path.join(ROOT, 'public/brand.js'), 'utf8')), 'only the space page moves the Workspace\'s tools');
  // The stylesheet: the empty second row is not drawn wider than a phone; the top bar's fold and "..." are styled; the
  // Layout panel may hang out of the top bar's clipped left zone.
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  assert.match(css, /body\.in-space \.subnav:not\(:has\(> \.nav-left > :not\(\[hidden\], \[data-nav-divider\], \.nav-folded\)\)\):not\(:has\(> \.nav-right > :not\(\[hidden\], \[data-nav-divider\], \.nav-folded\)\)\) \{\n\s*display: none;/, 'the second row hides itself with nothing in it');
  assert.ok(css.indexOf('@media (min-width: 641px)') < css.indexOf('body.in-space .subnav:not(:has(> .nav-left'), 'wider than a phone only');
  assert.match(css, /\.subnav \.nav-folded,\n\.topbar > \.nav-right > \.nav-folded \{\n\s*display: none !important;/);
  assert.match(css, /\.topbar > \.nav-right > \.sdk-icon-btn,\n\.subnav \.sdk-icon-btn \{\n\s*--b-fg:/);
  assert.match(css, /\.topbar:has\(> \.nav-left > \.layout-tabs > \.layout-favorites-note:not\(\[hidden\]\)\) \{\n\s*z-index: var\(--z-menu\);/);
});

// One presence answer, as GET /api/presence gives it to `viewer` (decision 6, step 3). Bo, Cy and Di are in the
// Hall; Bo and Cy stepped out of it into an aside (private when `priv`); Di stays; Ed is in the Cellar, which the
// member Al does not belong to.
function presenceAnswer(viewer, { priv = false } = {}) {
  const spaces = [
    { id: 'hall', name: 'Hall', members: ['al', 'bo', 'cy', 'di'] },
    { id: 'cellar', name: 'Cellar', members: ['ed'] },
  ];
  const asides = [{ id: 'aside-1', origin: 'hall', private: priv, members: ['bo', 'cy'] }];
  const online = new Map([
    ['al', { key: 'al', space: 'hall', inCall: true }],
    ['bo', { key: 'bo', space: 'aside-1', inCall: true }],
    ['cy', { key: 'cy', space: 'aside-1', inCall: true }],
    ['di', { key: 'di', space: 'hall', inCall: false }],
    ['ed', { key: 'ed', space: 'cellar', inCall: true }],
  ]);
  const users = ['al', 'bo', 'cy', 'di', 'ed'].map((key) => ({ key, displayName: key.toUpperCase() }));
  const view = presenceView(viewer, {
    users, spaces, asides, online, present: () => false, activeSpace: 'cellar',
    describeUser: (u) => ({ key: u.key, displayName: u.displayName }), describeSpace: (r) => ({ ...r }),
  });
  // As space.js lists them: the asides after the spaces, marked.
  return { ...view, list: [...view.spaces, ...view.asides.map((a) => ({ ...a, isAside: true }))], user: (k) => view.users.find((u) => u.key === k) };
}

test('presence by membership: those stepped out into an aside are not here, in the cards, the switcher or the count', () => {
  const p = presenceAnswer({ key: 'al', owner: false });
  assert.equal(p.user('bo').space, 'hall', 'the stand-in answer: Bo reads as the Hall');
  assert.equal(p.user('bo').aside, true);
  assert.equal(p.user('ed').elsewhere, true, 'Ed is somewhere Al cannot see');
  assert.equal(steppedOut(p.user('bo'), 'hall'), true);
  assert.equal(isHere(p.user('bo'), 'hall'), false, 'stepped out: not here');
  assert.equal(isHere(p.user('di'), 'hall'), true);
  assert.equal(isHere(p.user('ed'), 'hall'), false);
  const hallPeople = ['al', 'bo', 'cy', 'di'].map(p.user);
  assert.equal(hereCount(hallPeople, 'hall'), '2 here · 1 in the call', 'Al and Di here, Al on the call; Bo and Cy left out');
  assert.equal(hereCount([p.user('bo')], 'hall'), 'Nobody here');
  assert.deepEqual(switcherEntries({ spaces: p.spaces, users: p.users, present: 'hall' }).filter((e) => !e.leave).map((e) => [e.id, e.count]), [['hall', 2]], 'the switcher: only the Hall, 2 here');
  // An aside's own people (an owner sees the aside itself) are in it, not stepped out of it.
  const o = presenceAnswer({ key: 'zz', owner: true });
  assert.equal(o.user('bo').space, 'aside-1');
  assert.equal(isHere(o.user('bo'), 'aside-1', { aside: true }), true);
  assert.equal(isHere(o.user('bo'), 'hall'), false);
  assert.equal(hereCount(['al', 'bo', 'cy', 'di'].map(o.user), 'hall'), '2 here · 1 in the call', 'an owner counts the same');
  // A guest of the Hall: the cut-down answer, the same count.
  const g = presenceAnswer({ guestSpace: 'hall' });
  assert.deepEqual(g.spaces.map((s) => s.id), ['hall']);
  assert.equal(hereCount(g.users.filter((u) => ['al', 'bo', 'cy', 'di'].includes(u.key)), 'hall'), '2 here · 1 in the call');
  // The page draws it this way.
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  assert.ok(!/function hereCount\(/.test(space), 'space.js uses primary-nav.js\'s hereCount, not its own');
  assert.match(space, /const here = isHere\(u, spaceId, \{ aside: isAside \}\);/, 'renderMembers reads here with isHere');
});

test('presence by membership: the "In an aside" placeholder tiles come from the answer, and a private one names nobody', () => {
  const hall = { id: 'hall', members: ['al', 'bo', 'cy', 'di'] };
  for (const priv of [false, true]) {
    const p = presenceAnswer({ key: 'al', owner: false }, { priv });
    assert.equal(p.asides.length, 0, 'Al is not in the aside, so it is not listed');
    // From the answer alone (asidePrivate, so it holds after a reload): a placeholder, naming nobody.
    assert.equal(p.user('bo').asidePrivate, priv, 'the answer says which kind');
    assert.deepEqual(asidePlaceholder(p.user('bo'), hall, p.list), { private: priv, members: [] });
    assert.equal(asidePlaceholder(p.user('di'), hall, p.list), null, 'Di is here');
    assert.equal(asidePlaceholder(p.user('ed'), hall, p.list), null, 'Ed is elsewhere, not aside from here');
    // With what the live stream's aside-started message said.
    const said = { private: priv, members: priv ? [] : ['bo', 'cy'] };
    assert.deepEqual(asidePlaceholder(p.user('bo'), hall, p.list, said), priv ? { private: true, members: [] } : { private: false, members: ['bo', 'cy'] });
    // An owner sees the aside record itself; a private one still names nobody.
    const o = presenceAnswer({ key: 'zz', owner: true }, { priv });
    assert.deepEqual(asidePlaceholder(o.user('bo'), hall, o.list), priv ? { private: true, members: [] } : { private: false, members: ['bo', 'cy'] });
    // In the aside myself: its own people are not placeholders.
    const b = presenceAnswer({ key: 'bo', owner: false }, { priv });
    assert.equal(asidePlaceholder(b.user('cy'), { id: 'aside-1', isAside: true, members: ['bo', 'cy'] }, b.list), null);
    // A guest of the Hall sees the placeholder too.
    const g = presenceAnswer({ guestSpace: 'hall' }, { priv });
    assert.deepEqual(asidePlaceholder(g.users.find((u) => u.key === 'bo'), hall, g.list), { private: priv, members: [] });
    // A message that names people for a private aside still names nobody.
    assert.deepEqual(asidePlaceholder(p.user('bo'), hall, p.list, { private: false, members: ['bo', 'cy'] }), priv ? { private: true, members: [] } : { private: false, members: ['bo', 'cy'] });
  }
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const reconcile = space.slice(space.indexOf('function reconcileGhostTiles('), space.indexOf('\n}\n', space.indexOf('function reconcileGhostTiles(')));
  assert.match(reconcile, /asidePlaceholder\(user, currentSpace, presenceSpaces, startedAsides\.get\(key\)\)/, 'the tiles come from asidePlaceholder');
  const started = space.slice(space.indexOf("data.type === 'aside-started'"), space.indexOf("data.type === 'aside-recall'"));
  assert.ok(started, 'asideNudge() reads aside-started before aside-recall');
  assert.match(started, /data\.private/, 'the aside-started message is read for private');
  assert.match(started, /pending: true/, 'the pulled member\'s join still finds the pending entry');
  assert.ok(!/Array\.isArray\(data\.members\)\)\s*\{/.test(started), 'a private message with no members is still read');
  assert.match(started, /if \(priv \|\| !said\.length\) loadPresence\(\);/, 'a private message asks presence at once for who stepped out');
  assert.match(started, /asideEntry\(\{ id: data\.spaceId, members: priv \? \[\] : said,/, 'a private entry keeps no members, so it never reads "Private with ..."');
});

test('presence by membership: Who\'s around says "in an aside" and "in another <space>"; the stream somewhere unseen', () => {
  const p = presenceAnswer({ key: 'al', owner: false });
  const words = { aside: 'a side chat', space: 'trip' };
  assert.equal(whereWords(p.user('di'), p.list, words), 'in Hall');
  assert.equal(whereWords(p.user('bo'), p.list, words), 'in a side chat');
  assert.equal(whereWords(p.user('ed'), p.list, words), 'in another trip');
  assert.equal(whereWords({ online: true, space: null }, p.list, words), '');
  const o = presenceAnswer({ key: 'zz', owner: true });
  assert.equal(whereWords(o.user('bo'), o.list, words), 'in a side chat', 'an owner, who sees the aside: still the aside word');
  // Private, from the answer: "in a private conversation", for members and owners alike.
  const pp = presenceAnswer({ key: 'al', owner: false }, { priv: true });
  assert.equal(whereWords(pp.user('bo'), pp.list, words), 'in a private conversation');
  const op = presenceAnswer({ key: 'zz', owner: true }, { priv: true });
  assert.equal(whereWords(op.user('bo'), op.list, words), 'in a private conversation');
  // The home cards' tooltip on a card other than the parent's: stepped out reads as the aside, never "in Hall".
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const members = space.slice(space.indexOf('function renderMembers('), space.indexOf('\n}\n', space.indexOf('function renderMembers(')));
  assert.match(members, /const there = u\.online && !here && !u\.aside && !u\.elsewhere \?/, 'a stepped-out person is not "in" their parent space');
  assert.match(members, /whereWords\(u, presenceSpaces,/, 'the tooltip takes the aside words from whereWords');
  // The stream is in the Cellar, which Al can't see: activeSpace is null.
  assert.equal(p.activeSpace, null);
  assert.equal(offStream(p.user('di'), p.activeSpace, true), true, 'Di is off the stream');
  assert.equal(offStream(p.user('ed'), p.activeSpace, true), false, 'Ed may be on it: not marked');
  assert.equal(offStream(p.user('ed'), 'hall', true), true, 'the stream in the Hall: Ed is off it');
  assert.equal(offStream(p.user('di'), null, false), false, 'no owner online: no stream to be off');
  // Stepped out of the space the stream hears: off it, on its own (not only through the aside badge).
  assert.equal(offStream(p.user('bo'), 'hall', true), true, 'the stream in the Hall, Bo stepped out of it: off');
  assert.equal(offStream(p.user('bo'), null, true), false, 'the stream somewhere unseen (perhaps Bo\'s aside): not marked');
  assert.equal(offStream(o.user('bo'), 'aside-1', true, ['aside-1']), false, 'an owner, the stream following the aside Bo is in: on it');
  assert.equal(offStream(o.user('bo'), 'hall', true, ['aside-1']), true, 'an owner, the stream in the Hall: Bo is off it');
  assert.equal(offStream(p.user('di'), 'hall', true), false, 'Di, in the Hall with the stream: on it');
  const dash = fs.readFileSync(path.join(ROOT, 'public/dashboard.js'), 'utf8');
  assert.match(dash, /whereWords\(u, spaces,/, 'Who\'s around uses whereWords');
  assert.ok(!/activeSpace = active \|\| LOBBY/.test(space), 'activeSpace null is kept, not read as the Lobby');
  assert.match(members, /offStream\(u, activeSpace, ownerOnline, presenceSpaces\.filter\(\(r\) => r\.isAside\)/, 'off stream knows the asides I can see');
});

test('the bell: unread notices for everyone, and module updates for owners and the admin only', () => {
  assert.deepEqual(bellState({ unread: 2, updates: 3, role: 'member', moduleWord: 'module' }), { count: 2, updates: 0, title: 'Notifications, 2 unread' });
  assert.deepEqual(bellState({ unread: 2, updates: 3, role: 'owner', moduleWord: 'module' }), { count: 5, updates: 3, title: 'Notifications, 2 unread, 3 module updates' });
  assert.deepEqual(bellState({ unread: 0, updates: 1, role: 'admin', moduleWord: 'tool' }), { count: 1, updates: 1, title: 'Notifications, 0 unread, 1 tool update' });
  const brand = fs.readFileSync(path.join(ROOT, 'public/brand.js'), 'utf8');
  assert.ok(!/nav\.setBadge\('admin-link'/.test(brand), 'the update count is off your picture: it is on the bell');
  assert.match(brand, /for \(const id of \['manage-tool', 'admin-link', 'page-bar-manage'\]\) nav\.setBadge/, 'and on the Manage button');
});

test('the breadcrumb: nothing on home; a space\'s name; an aside\'s parent (Rejoin call) then the aside word and the others\' first names', () => {
  assert.deepEqual(crumbSegments({ space: null }), []);
  assert.deepEqual(crumbSegments({ space: { name: 'Disneyland' } }), [{ label: 'Disneyland', current: true }]);
  assert.deepEqual(crumbSegments({ space: { isAside: true }, parentName: 'Disneyland', asideWord: 'Aside', others: ['Michelle Obama', 'Sam'] }), [
    { label: 'Disneyland', current: false, action: 'rejoin', title: 'Rejoin call in Disneyland' },
    { label: 'Aside: Michelle, Sam', current: true },
  ]);
  assert.deepEqual(crumbSegments({ space: { isAside: true }, asideWord: 'Side chat' }), [{ label: 'Side chat', current: true }]);
});

test('the anchor on the space page: the space\'s breadcrumb, nothing while home shows over it, a guest link\'s space; entering any space clears home', () => {
  assert.deepEqual(anchorSegments({ space: { name: 'Paris' } }), [{ label: 'Paris', current: true }]);
  assert.deepEqual(anchorSegments({ space: { name: 'Paris' }, viewingHome: true }), [], 'home over the space: empty (the pill is a later step)');
  assert.deepEqual(anchorSegments({ space: null, viewingHome: true }), []);
  assert.deepEqual(anchorSegments({ space: null, guestSpaceName: 'Disneyland' }), [{ label: 'Disneyland', current: true }]);
  assert.equal(anchorSegments({ space: { isAside: true }, parentName: 'Disneyland', asideWord: 'Aside', others: ['Max'] })[0].title, 'Rejoin call in Disneyland');
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const crumb = space.slice(space.indexOf('function updateCrumb('), space.indexOf('\n}\n', space.indexOf('function updateCrumb(')));
  assert.match(crumb, /anchorSegments\(\{ space, viewingHome,/, 'updateCrumb draws anchorSegments');
  // Every way into a space clears "home over the space": join() itself, enterSpace() (every join, pull, invitation
  // and reload lands there) and a dropped connection.
  const join = space.slice(space.indexOf("async function join(spaceId = 'lobby'"), space.indexOf('\n}\n', space.indexOf("async function join(spaceId = 'lobby'")));
  assert.match(join, /viewingHome = false;/, 'join() clears viewingHome');
  const setup = space.slice(space.indexOf('function enterSpace('), space.indexOf('async function startCall('));
  assert.ok(setup.indexOf('viewingHome = false;') > -1 && setup.indexOf('viewingHome = false;') < setup.indexOf('updateCrumb();'), 'enterSpace() clears viewingHome before it draws the breadcrumb');
  assert.match(space, /function leaveSpaceNow\(.*\) \{\n\s*entered = false;\n\s*viewingHome = false;/, 'leaving the space clears it');
  assert.match(space, /aria-label="\$\{escapeHtml\(seg\.title \|\| seg\.label\)\}"/, 'the parent segment says what it does to a screen reader');
});

test('in an aside, picking the parent space in the switcher does what Rejoin call does: returnFromAside, never a move of my own', () => {
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const at = space.indexOf("document.addEventListener('app:enter-space'");
  assert.ok(at > -1, 'the space page takes the switcher\'s picks');
  const handler = space.slice(at, space.indexOf('\n});\n', at));
  const aside = handler.indexOf('currentSpace.isAside && currentSpace.origin === id) returnFromAside()');
  assert.ok(aside > -1, 'a pick of the aside\'s parent calls returnFromAside()');
  assert.ok(aside < handler.indexOf('joinInvitedSpace(id)'), 'checked before any move (joinInvitedSpace would strand the others)');
});

test('no ☰ with nothing in its menu (a guest), and the place outlasts your name and the environment\'s between the phone and a wide screen', () => {
  const brand = fs.readFileSync(path.join(ROOT, 'public/brand.js'), 'utf8');
  const wire = brand.slice(brand.indexOf('function wireNavMenu('), brand.indexOf('function firstEntry('));
  assert.match(wire, /const any = \[\.\.\.menu\.children\]\.some\(\(c\) => !c\.hidden && !\('navDivider' in c\.dataset\)\);/);
  assert.match(wire, /toggle\.hidden = !any/);
  assert.match(wire, /new MutationObserver\(syncToggle\)\.observe\(menu, \{ childList: true, subtree: true, attributes: true, attributeFilter: \['hidden'\] \}\)/);
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  assert.match(css, /\.topbar \.nav-toggle\[hidden\] \{\s*display: none;/, 'the phone rule that shows the button gives way to [hidden]');
  assert.match(css, /@media \(min-width: 641px\) and \(max-width: 1200px\) \{\s*\.topbar button\.whoami #whoami \{\s*display: none;/, 'your name goes first');
  assert.match(css, /@media \(min-width: 641px\) and \(max-width: 900px\) \{\s*\.topbar \.brand-home \.brand-name \{\s*display: none;/, 'then the environment\'s');
  assert.match(css, /\.topbar \.nav-left > \.crumb \{\s*flex: 0 1 auto;\s*min-width: 6em;/, 'the place keeps a few letters and its ellipsis at any width');
});

test('a module page opened from home while present in a space slides over the space (option (a)); present nowhere it is a real page', () => {
  assert.equal(pageOpens({ kind: 'module', present: true }), 'overlay');
  assert.equal(pageOpens({ kind: 'module', present: false }), 'page');
  assert.equal(pageOpens({ kind: 'manage', present: false }), 'overlay', 'Manage and the rest open over the page as before');
  assert.equal(pageOpens({ kind: 'host-console', present: true }), 'new-tab');
  // The real handlers, run against a stand-in document: dashboard.js's click on a card's heading and space.js's
  // app:open-page listener.
  const dash = fs.readFileSync(path.join(ROOT, 'public/dashboard.js'), 'utf8');
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const handlerOf = (src, head, first = '') => {
    const at = src.indexOf(head + first);
    assert.ok(at > -1, `found: ${head}${first}`);
    return src.slice(at + head.length, src.indexOf('\n});\n', at));
  };
  assert.match(dash, /<a class="dashboard-widget-title" href="\$\{escapeHtml\(href\)\}"/, 'the heading stays a real link (new tab, present nowhere)');
  // To the module's page, or (plan-calendar-destination, decision 16) the destination it is a part of while that shows:
  // the server's `href`, a path on this server.
  assert.match(dash, /const \{ page, path \} = tileHeading\(w\.href, w\.id\);/, 'to the server\'s href, else the module\'s page (tileHeading)');
  assert.match(dash, /card\(\{ id: w\.id, [^\n]*href: page,/, 'the heading uses it');
  assert.match(dash, /title="Open \$\{escapeHtml\(name \|\| title\)\}" data-page-link>/, 'a heading says it is a page link, whatever its address');
  const dashClick = handlerOf(dash, "document.addEventListener('click', (event) => {", '\n  if (event.defaultPrevented');
  const spaceOpen = handlerOf(space, "document.addEventListener('app:open-page', (event) => {");
  const run = (present, click = {}) => {
    const listeners = {};
    const doc = {
      addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
      dispatchEvent: (e) => { for (const fn of listeners[e.type] || []) fn(e); return !e.defaultPrevented; },
    };
    class CustomEvent {
      constructor(type, { detail, cancelable } = {}) { Object.assign(this, { type, detail, cancelable, defaultPrevented: false }); }
      preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
    }
    const loc = { href: 'http://h.test/', origin: 'http://h.test' };
    const opened = [];
    new Function('document', 'pageOpens', 'currentSpace', 'closePopout', 'openOverlay', 'window',
      `document.addEventListener('app:open-page', (event) => {${spaceOpen}\n});`)(
      doc, pageOpens, present ? { id: 'lobby' } : null, () => {}, (h) => opened.push(h), { open: () => {} });
    new Function('document', 'location', 'CustomEvent', 'URL', `document.addEventListener('click', (event) => {${dashClick}\n});`)(doc, loc, CustomEvent, URL);
    const link = { href: click.href || 'http://h.test/modules/todo', target: '', hasAttribute: (a) => Boolean(click.pageLink) && a === 'data-page-link' };
    const event = {
      type: 'click', button: 0, defaultPrevented: false, ...click,
      target: { closest: (sel) => (sel === '#dashboard a[href]' ? link : null) },
      preventDefault() { this.defaultPrevented = true; },
    };
    doc.dispatchEvent(event);
    return { navigated: !event.defaultPrevented, opened };
  };
  assert.deepEqual(run(true), { navigated: false, opened: ['/modules/todo'] }, 'present: the heading opens over the space and the page stays');
  assert.deepEqual(run(false), { navigated: true, opened: [] }, 'present nowhere: the link navigates');
  assert.deepEqual(run(true, { ctrlKey: true }), { navigated: true, opened: [] }, 'a click meant for a new tab is left to the browser');
  // A tile heading that leads to a destination (/calendar) goes the same way: over the space while present, a page otherwise.
  const toDest = { href: 'http://h.test/calendar#day=2026-10-02', pageLink: true };
  assert.deepEqual(run(true, toDest), { navigated: false, opened: ['/calendar#day=2026-10-02'] }, 'present: a destination heading opens over the space');
  assert.deepEqual(run(false, toDest), { navigated: true, opened: [] }, 'present nowhere: it navigates');
  assert.deepEqual(run(true, { href: 'http://h.test/calendar' }), { navigated: true, opened: [] }, 'another link on home, not a heading, is left alone');
  // A panel tile's heading (/calendar#panel=todo) keeps its hash over the space; present nowhere the link itself goes.
  const toPanel = { href: 'http://h.test/calendar#panel=todo', pageLink: true };
  assert.deepEqual(run(true, toPanel), { navigated: false, opened: ['/calendar#panel=todo'] }, 'present: a panel heading opens over the space, hash and all');
  assert.deepEqual(run(false, toPanel), { navigated: true, opened: [] }, 'present nowhere: it navigates (the link has the hash)');
  // The widget's own "open in full" and an object out of a space go the same way, never straight to location.href.
  assert.ok(!/location\.href = `\/modules/.test(dash), 'dashboard.js never navigates to a module page directly');
  assert.match(dash, /openModulePage\(href\);/, 'a widget\'s "open in full" goes through openModulePage');
});

// Home's tiles (plan-calendar-destination.md, decisions 16 and 20 to 22): an event or a task in the Calendar or To-do
// tile opens the Calendar destination on it while that shows (over the space while present in one, a new tab on Ctrl
// or the middle button); with no destination shown, today's way (its space, or its module's page). The Polls tile is
// unchanged, and the Planner has no tile.
test('home tiles: an object opens where its tile\'s heading goes (the destination), else its space or its module\'s page', () => {
  const ev = { module: 'calendar', kind: 'event', id: 'e1', scope: 'space', space: 'paris' };
  const own = { module: 'todo', kind: 'task', id: 't1', scope: 'environment' };
  const hash = (r) => `#ref=${encodeURIComponent(JSON.stringify(r))}`;
  assert.deepEqual(tileRefTarget(ev, { page: '/calendar', module: 'calendar' }), { how: 'page', href: `/calendar${hash(ev)}` }, 'the destination shows: an event in a space opens there');
  assert.deepEqual(tileRefTarget(own, { page: '/calendar', module: 'todo' }), { how: 'page', href: `/calendar${hash(own)}` }, 'a task too (the To-do part)');
  assert.deepEqual(tileRefTarget({ ...own, scope: 'space', space: 'p' }, { page: '/calendar', module: 'todo' }).how, 'page');
  assert.deepEqual(tileRefTarget(ev, { page: '/modules/calendar', module: 'calendar' }), { how: 'space', href: `/modules/calendar?space=paris${hash(ev)}` }, 'no destination: into its space (the href for a new tab)');
  assert.deepEqual(tileRefTarget(own, { page: '/modules/todo', module: 'todo' }), { how: 'page', href: `/modules/todo${hash(own)}` }, 'no destination: an environment task on its module\'s page');
  assert.equal(tileRefTarget(ev, { page: '/calendar', module: 'polls' }).how, 'space', 'another module\'s object never goes to this tile\'s destination');
  const poll = { module: 'polls', kind: 'poll', id: 'p1', scope: 'space', space: 'paris' };
  assert.equal(tileRefTarget(poll, { page: '/modules/polls', module: 'polls' }).how, 'space', 'a poll still goes into its space');
  assert.equal(tileRefTarget(ev, { page: '', module: 'calendar' }).how, 'space', 'no heading address: today\'s way');

  // dashboard.js's own openRef, run against stand-ins: what it opens, and how.
  const dash = fs.readFileSync(path.join(ROOT, 'public/dashboard.js'), 'utf8');
  const body = dash.slice(dash.indexOf('let openInSpace = null;'), dash.indexOf('// A plain click on a link to a module page on home'));
  assert.match(body, /function openRef\(/);
  assert.match(dash, /onOpenRef: \(ref, o = \{\}\) => openRef\(ref, \{ page, module: w\.id, newTab: o\.newTab \}\)/, 'a widget\'s objects go by its heading\'s address');
  assert.match(dash, /onOpenPage: \(hash, o = \{\}\) => \{\n\s*const href = hash \? `\$\{path\}#\$\{hash\}` : page;\n\s*if \(o\.newTab\) return openNewTab\(href\);/, 'a day: where the heading goes (its place replacing a #panel=), a new tab when asked');
  const run = ({ present = false, page, module, ref, newTab = false, hooks = true }) => {
    const out = { pages: [], spaces: [], tabs: [], navigated: null };
    const doc = { dispatchEvent: (e) => { if (present) { out.pages.push(e.detail.href); return false; } return true; } };
    class CustomEvent { constructor(type, init) { Object.assign(this, { type }, init); } }
    const loc = { set href(h) { out.navigated = h; } };
    const win = { open: (h, t, f) => out.tabs.push([h, t, f]) };
    const api = new Function('document', 'location', 'window', 'CustomEvent', 'tileRefTarget', `${body}\nreturn { openRef, set: (f) => { openInSpace = f; } };`)(doc, loc, win, CustomEvent, tileRefTarget);
    if (hooks) api.set((space, mod) => out.spaces.push([space, mod]));
    api.openRef(ref, { page, module, newTab });
    return out;
  };
  const r1 = run({ present: true, page: '/calendar', module: 'calendar', ref: ev });
  assert.deepEqual([r1.pages, r1.spaces, r1.navigated], [[`/calendar${hash(ev)}`], [], null], 'present: the destination opens over the space, the space is not entered');
  const r2 = run({ present: false, page: '/calendar', module: 'calendar', ref: ev });
  assert.equal(r2.navigated, `/calendar${hash(ev)}`, 'present nowhere: a real page');
  const r3 = run({ present: true, page: '/calendar', module: 'todo', ref: own, newTab: true });
  assert.deepEqual([r3.tabs, r3.pages], [[[`/calendar${hash(own)}`, '_blank', 'noopener']], []], 'Ctrl or middle click: a new tab, and nothing else');
  const r4 = run({ present: true, page: '/modules/calendar', module: 'calendar', ref: ev });
  assert.deepEqual([r4.spaces, r4.pages], [[['paris', 'calendar']], []], 'Show Calendar off: into the event\'s space, as before');
  const r5 = run({ present: false, page: '/modules/polls', module: 'polls', ref: poll });
  assert.deepEqual(r5.spaces, [['paris', 'polls']], 'a poll: into its space');

  // The module host hands the click's wish on; the SDK sends it.
  const hostSrc = fs.readFileSync(path.join(ROOT, 'public/module-host.js'), 'utf8');
  assert.match(hostSrc, /onOpenRef\(cleanPointer\(ref\), \{ newTab: newTab === true \}\)/);
  assert.match(hostSrc, /onOpenPage\(h, \{ newTab: newTab === true \}\)/);
  const sdk = fs.readFileSync(path.join(ROOT, 'public/sdk/host.js'), 'utf8');
  assert.match(sdk, /open: \(ref, o\) => call\('objects\.open', \{ ref, newTab: Boolean\(o && o\.newTab\), \.\.\.\(o && Array\.isArray\(o\.list\)/); // o.list: the file window's other files
  assert.match(sdk, /open: \(hash, o\) => call\('page\.open', \{ hash, newTab: Boolean\(o && o\.newTab\) \}\)/);
  // The two tiles ask for a new tab on Ctrl, Cmd, Shift or the middle button, for a day, an event and a task.
  for (const [id, sel] of [['calendar', 'data-event'], ['todo', 'data-task']]) {
    const w = fs.readFileSync(path.join(ROOT, `modules/${id}/src/${id}-widget.js`), 'utf8');
    assert.match(w, /const newTab = Boolean\(e\.ctrlKey \|\| e\.metaKey \|\| e\.shiftKey \|\| e\.button === 1\);/, `${id}: a new tab on a modifier or the middle button`);
    assert.match(w, /root\.addEventListener\('auxclick', \(e\) => \{ if \(e\.button === 1\) opened\(e\); \}\);/, `${id}: the middle button`);
    assert.match(w, /host\.objects\.open\([^\n]*\{ newTab \}\)/, `${id}: the object, with the wish`);
    assert.match(w, /if \(e\.key !== 'Enter' \|\| !\(e\.ctrlKey \|\| e\.metaKey\)/, `${id}: Ctrl or Cmd + Enter from the keyboard`);
    assert.ok(w.includes(`'${sel}'`) || w.includes(`[${sel}]`), `${id}: its objects`);
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'modules/calendar/src/calendar-widget.js'), 'utf8'), /host\.page\.open\('day=' \+ day\.dataset\.day, \{ newTab \}\)/, 'calendar: a day, with the wish');
  // The Planner has no tile on home (decision 22); the Polls tile is still there.
  const manifest = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, `modules/${id}/module.json`), 'utf8'));
  assert.equal(manifest('travel').surfaces.widget, undefined, 'no Trips tile');
  assert.ok(manifest('polls').surfaces.widget, 'the Polls tile stays');
});

// The space page's own functions, cut from the source and run against stand-ins: home over the space, and a page over it.
function homeHarness({ present = true, inSpace = true, home = false, overlayOpen = false } = {}) {
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const fn = (name) => {
    const at = space.indexOf(`function ${name}(`);
    assert.ok(at > -1, `space.js has ${name}()`);
    return space.slice(at, space.indexOf('\n}\n', at) + 2);
  };
  const at = space.indexOf("const HOME_LINKS = '");
  assert.ok(at > -1, 'space.js names the home links once');
  const links = space.slice(at, space.indexOf('\n', at));
  const listener = space.slice(space.indexOf("document.addEventListener('click', (event) => {\n  if (event.target.closest(HOME_LINKS))"), space.indexOf('\n});\n', space.indexOf('if (event.target.closest(HOME_LINKS)) goHome(event)')) + 4);
  assert.match(listener, /goHome\(event\)/, 'the page\'s Spaces, logo and menu home go through goHome()');
  const state = { away: [], navigated: true, classes: new Set(inSpace ? ['in-space'] : []), frameHidden: !overlayOpen };
  const listeners = [];
  const doc = { addEventListener: (type, f) => { if (type === 'click') listeners.push(f); }, body: { classList: { contains: (c) => state.classes.has(c), remove: (c) => state.classes.delete(c) } } };
  const $ = (id) => (id === 'page-overlay-frame' ? { get hidden() { return state.frameHidden; }, set hidden(v) { state.frameHidden = v; }, src: '' } : {});
  const api = new Function('document', '$', 'setAway', 'state', 'currentSpace', 'guestToken', 'guestMode', `
    let viewingHome = ${home};
    function showSpaceList() { setAway(true); viewingHome = true; document.body.classList.remove('in-space'); }
    function refreshNotices() {}
    ${fn('closeOverlay')}
    ${fn('goHome')}
    ${links}
    ${listener}
    return { closeOverlay, viewingHome: () => viewingHome };
  `)(doc, $, (on) => state.away.push(on), state, present ? { id: 'lobby' } : null, null);
  const click = () => {
    const event = { target: { closest: (sel) => (sel.includes('#spaces-link') ? {} : null) }, preventDefault() { state.navigated = false; } };
    for (const f of listeners) f(event);
  };
  return { state, click, ...api };
}

test('Spaces or the logo on home while present stays in the page (the call keeps running); present nowhere it navigates', () => {
  let h = homeHarness({ inSpace: true });
  h.click();
  assert.equal(h.state.navigated, false, 'from the space: home over it');
  assert.equal(h.viewingHome(), true);
  h = homeHarness({ inSpace: false, home: true });
  h.click();
  assert.equal(h.state.navigated, false, 'again on home over the space: still no navigation');
  assert.deepEqual(h.state.away, [], 'and Away is left as it is');
  h = homeHarness({ inSpace: false, home: true, overlayOpen: true });
  h.click();
  assert.equal(h.state.navigated, false);
  assert.equal(h.state.frameHidden, true, 'a page open over home closes');
  assert.ok(!h.state.away.includes(false), 'without clearing Away');
  h = homeHarness({ present: false, inSpace: false, home: false });
  h.click();
  assert.equal(h.state.navigated, true, 'present nowhere: a real navigation');
  // The same links in the header of a page opened over the call (target _top) go the same way.
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  assert.match(space, /\$\('page-overlay-frame'\)\.addEventListener\('load', \(\) => \{[\s\S]*?doc\?\.addEventListener\('click', \(event\) => \{\n\s*if \(event\.target\.closest\?\.\(HOME_LINKS\)\) goHome\(event\);/);
});

test('closing a page opened from home keeps Away; Away clears only back on the space\'s canvas', () => {
  let h = homeHarness({ inSpace: false, home: true, overlayOpen: true });
  h.closeOverlay();
  assert.deepEqual(h.state.away, [], 'closed onto home over the space: still Away');
  h = homeHarness({ inSpace: true, home: false, overlayOpen: true });
  h.closeOverlay();
  assert.deepEqual(h.state.away, [false], 'closed onto the space: Away clears');
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const back = space.slice(space.indexOf('function returnToCanvas('), space.indexOf('\n}\n', space.indexOf('function returnToCanvas(')));
  assert.match(back, /viewingHome = false;[\s\S]*setAway\(false\);/, 'returnToCanvas() clears Away');
});

// The top bar's destinations (plan-calendar-destination.md, step 5; plan-two-zone-nav.md, decision 2): a left-zone entry
// per destination the server lists for this viewer, ahead of Spaces, none when it lists none; on a phone an entry in the
// menu after the Spaces slot's entries.
test('destinations: an entry each in the left zone, in the server\'s order, ahead of Spaces, current on its own page', () => {
  const list = [{ id: 'calendar', name: 'Calendar', icon: 'calendar-days', href: '/calendar' }, { id: 'map', name: 'Maps', icon: 'map', href: '/map' }];
  const t = destinationTools(list, { path: '/calendar' });
  assert.deepEqual(t.map((x) => x.bar.id), ['dest-calendar', 'dest-map']);
  assert.ok(t.every((x) => x.bar.zone === 'left' && x.bar.group === 'where'), 'the left zone, in Spaces\' group: no divider between Map and Spaces');
  assert.deepEqual(t.map((x) => x.bar.order), [1, 2]);
  assert.deepEqual(t.map((x) => [x.bar.label, x.bar.icon, x.bar.href]), [['Calendar', 'calendar-days', '/calendar'], ['Maps', 'map', '/map']]);
  assert.deepEqual(t.map((x) => x.bar.current), [true, false]);
  assert.equal(destinationTools(list, { present: true })[0].bar.overlay, true);
  assert.equal(destinationTools(list)[0].bar.overlay, false);
});
// A panel tile's heading (plan-calendar-destination.md): the server gives a panel's tile `href: '/calendar#panel=<id>'`;
// home keeps the hash on every way there, and the destination page opens on that panel (its bottom tab on a phone),
// once, then remembered as a pick. An unknown or unreadable id is ignored; #ref= and #day= still work beside it.
test('a panel tile\'s heading: /calendar#panel=<id> survives home and the overlay, and opens that panel', () => {
  assert.deepEqual(tileHeading('/calendar#panel=todo', 'todo'), { page: '/calendar#panel=todo', path: '/calendar' });
  assert.deepEqual(tileHeading('/calendar', 'calendar'), { page: '/calendar', path: '/calendar' });
  assert.deepEqual(tileHeading('/calendar#ref=x', 'todo'), { page: '/modules/todo', path: '/modules/todo' }, 'only #panel= is a heading\'s hash');
  assert.deepEqual(tileHeading('https://evil.test/x', 'todo'), { page: '/modules/todo', path: '/modules/todo' });
  assert.deepEqual(tileHeading(undefined, 'polls'), { page: '/modules/polls', path: '/modules/polls' });
  const own = { module: 'todo', kind: 'task', id: 't1', scope: 'environment' };
  assert.deepEqual(tileRefTarget(own, { page: '/calendar#panel=todo', module: 'todo' }), { how: 'page', href: `/calendar#ref=${encodeURIComponent(JSON.stringify(own))}` }, 'a task from a panel tile: one hash, the pointer');

  const keys = ['panel:calendar', 'panel:todo'];
  assert.deepEqual(hashPanel('panel=todo', keys), { key: 'panel:todo', found: true, rest: '' });
  assert.deepEqual(hashPanel('panel=nope', keys), { key: '', found: true, rest: '' }, 'unknown: ignored');
  assert.deepEqual(hashPanel('panel=%E0%A4%A', keys), { key: '', found: true, rest: '' }, 'unreadable: ignored');
  assert.deepEqual(hashPanel('panel=todo&day=2026-10-02', keys), { key: 'panel:todo', found: true, rest: 'day=2026-10-02' });
  assert.deepEqual(hashPanel('day=2026-10-02', keys), { key: '', found: false, rest: 'day=2026-10-02' });
  assert.deepEqual(hashPanel('ref=%7B%7D', keys), { key: '', found: false, rest: 'ref=%7B%7D' });

  // The space page's overlay puts its ?from=space… before the hash.
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const ov = space.slice(space.indexOf('function overlayParams() {'), space.indexOf('\n}\n', space.indexOf('function openOverlay(path) {'))) + '\n}';
  const frame = { hidden: true, src: '' };
  new Function('$', 'document', 'spaceName', 'setAway', `${ov}\nopenOverlay('/calendar#panel=todo');`)(() => frame, { querySelector: () => null }, 'Paris', () => {});
  assert.equal(frame.src, '/calendar?from=space&spaceName=Paris#panel=todo', 'over the space: the query, then the hash');

  // destination.js's takeHash, run against stand-ins.
  const dest = fs.readFileSync(path.join(ROOT, 'public/destination.js'), 'utf8');
  assert.match(dest, /import \{ hashPanel \} from '\/primary-nav\.js';/);
  const take = dest.slice(dest.indexOf('function takeHash() {'), dest.indexOf('\n}\n', dest.indexOf('function takeHash() {'))) + '\n}';
  const runDest = (hash, { phone = false, saved = {} } = {}) => {
    const out = { stored: { ...saved }, delivered: [], refs: [], address: null, layouts: 0, shown: [] };
    const st = { panel: saved.panel || 'panel:calendar', tab: saved.tab || 'main' };
    const location = { hash: hash ? `#${hash}` : '', pathname: '/calendar', search: '?from=space' };
    const history = { state: null, replaceState: (s, t, u) => { out.address = u; } };
    const parts = [{ key: 'main', mounted: { deliver: (k, v) => out.delivered.push(v.hash) } }, { key: 'panel:calendar' }, { key: 'panel:todo' }];
    const f = new Function('location', 'history', 'parts', 'hashPanel', 'onPhone', 'remember', 'layout', 'show', 'openRef', 'st',
      `let panel = st.panel, tab = st.tab;\n${take}\ntakeHash();\nreturn { panel, tab };`);
    const r = f(location, history, parts, hashPanel, () => phone, (p) => Object.assign(out.stored, p), () => { out.layouts++; },
      (k) => out.shown.push(k), (ref) => out.refs.push(ref), st);
    return { ...out, ...r };
  };
  const wide = runDest('panel=todo', { saved: { panel: 'panel:calendar' } });
  assert.deepEqual([wide.panel, wide.stored.panel, wide.layouts, wide.address, wide.shown], ['panel:todo', 'panel:todo', 1, '/calendar?from=space', []], 'wide: the To-do panel, remembered, the hash taken out (the query kept)');
  const phone = runDest('panel=todo', { phone: true, saved: { tab: 'main' } });
  assert.deepEqual([phone.tab, phone.stored.tab, phone.shown], ['panel:todo', 'panel:todo', []], 'phone: the To-do tab, remembered; not the main part');
  const unknown = runDest('panel=nope', { saved: { panel: 'panel:calendar' } });
  assert.deepEqual([unknown.panel, unknown.stored, unknown.layouts, unknown.delivered], ['panel:calendar', { panel: 'panel:calendar' }, 0, []], 'unknown: ignored, never handed to the main part');
  const withDay = runDest('panel=todo&day=2026-10-02');
  assert.deepEqual([withDay.panel, withDay.delivered], ['panel:todo', ['day=2026-10-02']], 'with a day: both');
  assert.deepEqual(runDest('day=2026-10-02').delivered, ['day=2026-10-02'], 'a day alone, as before');
  assert.deepEqual(runDest(`ref=${encodeURIComponent(JSON.stringify(own))}`).refs, [own], 'a pointer alone, as before');
  assert.match(dest, /takeHash\(\);\n\s*window\.addEventListener\('hashchange', takeHash\);/, 'on load and on hashchange');
});

test('destinations: none listed (the option off, the Calendar off or unreadable, a guest) means no entry; a malformed one is left out', () => {
  assert.deepEqual(destinationTools([]), []);
  assert.deepEqual(destinationTools(undefined), []);
  const bad = [{ id: 'Cal', name: 'x', href: '/x' }, { id: 'calendar', name: '', href: '/calendar' }, { id: 'calendar', name: 'C', href: 'https://elsewhere.example/calendar' }, { id: 'calendar', name: 'C', href: '/calendar?x=1' }];
  assert.deepEqual(destinationTools(bad), []);
  assert.equal(destinationTools([{ id: 'calendar', name: 'Calendar', icon: '<b>', href: '/calendar' }])[0].bar.icon, 'puzzle-piece');
});
test('destinations: on a phone the entry is in the menu after the Spaces slot\'s entries, before New <space>', () => {
  const [d] = destinationTools([{ id: 'calendar', name: 'Calendar', icon: 'calendar-days', href: '/calendar' }]);
  const tools = [
    { id: 'menu-environment', zone: 'right', group: 'menu-where', groupOrder: 1, order: 1, seq: 1 },
    { id: 'menu-home', zone: 'right', group: 'menu-where', order: 2, seq: 2 },
    { id: 'menu-new-space', zone: 'right', group: 'menu-new', groupOrder: 2, order: 1, seq: 3 },
    { ...d.bar, seq: 4 },
    { ...d.menu, seq: 5 },
    { id: 'menu-space-a', zone: 'right', group: 'menu-where', order: 3, seq: 6 },
    { id: 'menu-space-b', zone: 'right', group: 'menu-where', order: 4, seq: 7 },
  ];
  const byZone = { left: tools.filter((t) => t.zone === 'left'), right: tools.filter((t) => t.zone === 'right') };
  const z = phoneZones(byZone);
  // The left-zone entry is hidden on a phone (brand.js: visible only wider), so the menu's own entry is the one read.
  const menu = z.right.flatMap((run) => arrange(run).flatMap((g) => g.map((t) => t.id))).filter((id) => id !== 'dest-calendar');
  assert.deepEqual(menu, ['menu-environment', 'menu-home', 'menu-space-a', 'menu-space-b', 'menu-dest-calendar', 'menu-new-space']);
});
test('the top bar is two zones: no middle centred from 1001px, the phone\'s place for the bell not drawn wider, the entries icons only from 641 to 900px', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  assert.ok(!/min-width: 1001px/.test(css), 'no 1001px rule centring a middle zone');
  assert.ok(!/\.topbar:has\(> \.nav-middle/.test(css), 'nothing reads what the middle holds');
  assert.match(css, /\n\.topbar \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/, 'the left zone takes what the right does not');
  assert.match(css, /@media \(min-width: 641px\) \{\s*\.topbar > \.nav-middle \{\s*display: none;/, '#core-nav is the phone\'s place only');
  assert.match(css, /@media \(min-width: 641px\) and \(max-width: 900px\) \{\s*\.topbar > \.nav-left > \.core-link\[data-destination\] \.core-label \{\s*display: none;/, 'from 641 to 900px the entries in the left zone are their icons only');
  assert.ok(!/\.nav-middle \.core-link/.test(css), 'no rule for entries in a middle zone');
  assert.match(css, /\.topbar > \.nav-left > \.core-link\[data-destination\] \{\s*flex: none;/, 'the destinations never shrink');
  // Their names keep the nav text in the branding's zone: the wordmark's larger size is the environment's name's alone
  // (no `.brand span` rule reaching every word in the zone, which the old `font-size: inherit` resets undid one by one).
  assert.ok(!/(^|\n)\.brand span \{/.test(css), 'no rule sizes every span in the branding\'s zone');
  assert.match(css, /\n\.brand > span\[data-brand="environmentName"\],\n\.topbar \.brand-name \{\n\s*font-family: var\(--font-display\);\n\s*font-size: var\(--text-18\);\n\s*font-weight: var\(--weight-strong\);/, 'only the environment\'s name, the wordmark, is larger: Fraunces 600 at 18px (C3)');
  assert.match(css, /@media \(max-width: 640px\) \{\n\s*\.brand > span\[data-brand="environmentName"\],\n\s*\.topbar \.brand-name \{\n\s*font-family: var\(--font-ui\);\n\s*font-size: var\(--text-16\);/, 'below 640px the wordmark is Figtree at 16px (C3)');
  assert.match(fs.readFileSync(path.join(ROOT, 'public/brand.js'), 'utf8'), /el\.title = tool\.label;/, 'and keep their name as the tooltip');
  const navSrc = fs.readFileSync(path.join(ROOT, 'public/nav-bar.js'), 'utf8');
  assert.match(navSrc, /const lookOf = \(t\) => \(t\.bar === 'primary' && t\.zone === 'left' \? 'core'/, 'the core links\' look in the top bar\'s left zone');
  const html = fs.readFileSync(path.join(ROOT, 'public/brand.js'), 'utf8');
  assert.match(html, /<div class="nav-middle core-nav" id="core-nav"><\/div>/, '#core-nav kept, for the bell on a phone');
});

// The top bar holds places, not a breadcrumb (plan-two-zone-nav.md, decisions 7 and 10): only the space page adds
// segments; every other page names itself in its page bar, and on a phone in the anchor, as a plain label.
test('the anchor: nothing wider than a phone, the page\'s name as a plain label on one; only space.js sets segments', () => {
  assert.equal(pageAnchor({ phone: false, name: 'Calendar', icon: 'calendar-days' }), null, 'wider: nothing (the entry is current, or the page bar names it)');
  assert.deepEqual(pageAnchor({ phone: true, name: ' Calendar ', icon: 'calendar-days' }), { label: 'Calendar', icon: 'calendar-days', title: 'Calendar', current: 'page' });
  assert.equal(pageAnchor({ phone: true, name: '' }), null, 'no name yet: nothing');
  const read = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  for (const f of ['destination.js', 'admin.js', 'profile.js', 'space-setup.js', 'module-config.js', 'module.js', 'host.js']) {
    const src = read(f);
    assert.ok(!/crumbLink\(/.test(src), `${f} calls no crumbLink()`);
    assert.ok(!/setTopbarLocation\(/.test(src), `${f} sets no segment`);
    assert.ok(!/renderTopbar\(\{[^}]*location: [^'}]/.test(src), `${f} passes renderTopbar() no location`);
  }
  assert.match(read('space.js'), /setTopbarLocation\(segs\.map/, 'the space page keeps its breadcrumb');
  const brand = read('brand.js');
  assert.ok(!/export function crumbLink/.test(brand), 'crumbLink() is gone with its last caller');
  const paint = brand.slice(brand.indexOf('function paintPageAnchor('), brand.indexOf('\n}\n', brand.indexOf('function paintPageAnchor(')));
  assert.match(paint, /pageAnchor\(\{ phone: onPhone\(\), name, icon \}\)/);
  assert.ok(!/crumb-sep|<a /.test(paint), 'no separator, not a link');
  assert.match(paint, /setAttribute\('aria-current', a\.current\)/);
  const bar = brand.slice(brand.indexOf('export function renderPageBar('), brand.indexOf('function paintPageAnchor('));
  assert.match(bar, /phoneQuery\.addEventListener\('change', paint\)/, 'painted again as the window crosses 640px');
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  assert.match(css, /\.topbar \.crumb \[aria-current="location"\],\s*\.topbar \.crumb \[aria-current="page"\] \{/, 'the label reads as the current place');
});

test('the page bar: one shared builder, its name first, a Manage link for owners and the admin, the page\'s tabs inside it', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  const brand = read('brand.js');
  const bar = brand.slice(brand.indexOf('export function renderPageBar('), brand.indexOf('function paintPageAnchor('));
  assert.ok(bar.length > 0, 'brand.js exports renderPageBar()');
  assert.match(bar, /el\.className = `subnav page-bar\$\{/, 'a .subnav.page-bar row');
  assert.match(bar, /nav\.attach\('secondary', el\)/, 'attached as the secondary bar, so it folds as the space bar does');
  assert.match(bar, /'<div class="nav-left"><\/div><span class="nav-right"><\/span>'/, 'two zones');
  assert.match(bar, /id: 'page-bar-name', bar: 'secondary', zone: 'left'[^\n]*visible: \(\) => !onPhone\(\) && Boolean\(state\.name\)/, 'the name in the left zone, not on a phone (the anchor has it)');
  assert.match(bar, /id: 'page-bar-manage', bar: 'secondary', zone: 'left', group: 'page-manage', groupOrder: 1[^\n]*visible: \(\) => seesUpdates\(account\?\.role\)/, 'the Manage link first, owners and the admin only');
  assert.match(bar, /href: keepingQuery\(manage\)/, 'keeping ?from=space');
  assert.match(bar, /zone: 'left', group: 'page', order: 2 \+ i, fold: false, element: c/, 'the page\'s controls after the name, never folding');
  assert.match(brand, /nav\.draw\(\); \/\/ both bars/, 'the Manage link appears once the role is known');
  // Each page in the plan's table.
  assert.match(read('admin.js'), /renderPageBar\(\{ name: 'Manage', icon: 'gear', controls: \[\$\('subtabs'\)\] \}\)/);
  assert.match(read('profile.js'), /renderPageBar\(\{ name: editingKey \? '' : 'Profile', icon: 'user', manage: editingKey \? '\/admin#users' : '', controls: \[\$\('subtabs'\)\] \}\)/);
  assert.match(read('profile.js'), /if \(editingKey\) renderPageBar\(\{ name: user\.displayName/);
  // The space-settings page bar is gone on purpose: the Set up panel opens inside the space page, under its bar, so it
  // draws no page bar and no #subtabs of its own (its tabs are .setup-tab).
  assert.ok(!/renderPageBar|id="subtabs"/.test(read('space-setup.js')), 'the Set up panel draws no page bar');
  assert.ok(!fs.existsSync(path.join(ROOT, 'public', 'ai-config.js')), 'the AI service is set up on its tab on Manage > Modules, not a page of its own');
  assert.match(read('module-config.js'), /renderPageBar\(\{ manage: '\/admin#modules' \}\)/);
  // A module's own page and a destination's page are one module frame (public/module-frame.js) under the top bar: the frame's
  // title bar names the page and holds its "+" and icons, so neither draws a page bar.
  const modJs = read('module.js');
  assert.ok(!/renderPageBar/.test(modJs), 'a module\'s own page draws no page bar');
  assert.match(modJs, /createModuleFrame\(\{\s*\n\s*title: mod\.name,\s*\n\s*icon: mod\.icon,/, 'its frame\'s title bar names it');
  assert.match(modJs, /chrome\.setTitle\(title \|\| mod\.name\);/, 'and follows the module\'s own title');
  const dest = read('destination.js');
  assert.ok(!/renderPageBar/.test(dest), 'Calendar and Map draw no page bar');
  assert.match(dest, /page = createModuleFrame\(\{\s*\n\s*title: d\.name,\s*\n\s*icon: d\.icon,\s*\n\s*variant: 'page',/, 'Calendar and Map: the frame names the page');
  assert.ok(!/bar\.className = 'subnav dest-bar'/.test(dest), 'no copy of the bar in destination.js');
  assert.ok(!/renderPageBar/.test(read('host.js')), 'the host console has no page bar');
  // The tabs keep their ids; the page bar's look.
  for (const f of ['admin.html', 'profile.html']) assert.match(read(f), /<nav class="subtabs" id="subtabs">/, `${f} keeps #subtabs`);
  assert.doesNotMatch(read('admin.html'), /MIT licen[sc]e/i, 'About does not call the product MIT-licensed');
  assert.match(read('admin.html'), /<p>Proprietary software\. All rights reserved\.<\/p>/, 'About says the product is proprietary');
  const css = read('style.css');
  assert.match(css, /\.subnav\.page-bar \.nav-left > \.subtabs \{\s*flex: 0 1 auto;\s*min-width: 0;/, 'the tabs give way inside the bar and scroll sideways');
  assert.match(read('sdk/system.css'), /:is\(\[hidden\], \.layout-tab-out\) \{ display: none; \}/, 'a hidden tab stays hidden (space settings\' Modules), in the Tabs component');
  assert.match(css, /@media \(max-width: 640px\) \{\s*\.topbar > \.page-bar:not\(:has\(/, 'on a phone a bar with nothing to show is not drawn');
});

test('the top bar\'s colour areas: the branding and the right zone, with defaults that look as before, by child selectors', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  const root = css.slice(css.indexOf(':root {'), css.indexOf('\n}\n', css.indexOf(':root {')));
  assert.match(root, /--nav-primary-edge-bg: color-mix\(in srgb, var\(--header-bg\) 97%, black\);/, 'the shade, opaque');
  assert.match(root, /--nav-brand-bg: var\(--surface-bar-brand, var\(--nav-primary-edge-bg\)\);/);
  assert.match(root, /--nav-brand-text: var\(--text-bar-brand, var\(--header-text\)\);/);
  assert.match(root, /--nav-right-bg: var\(--surface-bar-right, var\(--nav-primary-edge-bg\)\);/);
  assert.match(root, /--nav-right-text: var\(--text-bar-right, var\(--header-text\)\);/);
  assert.match(css, /\n\.topbar > \.nav-left > \.brand-home \{\s*--header-text: var\(--nav-brand-text\);[^}]*background: var\(--nav-brand-bg\);/, 'the branding area, its text through --header-text');
  assert.match(css, /@media \(min-width: 641px\) \{\s*\.topbar > \.nav-right \{\s*--header-text: var\(--nav-right-text\);\s*color: var\(--header-text\);\s*background: var\(--nav-right-bg\);/, 'the right zone, wider than a phone');
  assert.ok(!/\.topbar \.nav-left,\s*\.topbar \.nav-right \{[^}]*background/.test(css), 'no descendant rule paints the zones (it reached the space bar)');
  assert.ok(!/(^|\n)\.page-bar[^{]*\.nav-(left|right)[^{]*\{[^}]*background/.test(css), 'a page bar is one colour');
  assert.match(css, /\.theme-preview-header > \.theme-preview-brand,\s*\.theme-preview-header > span:last-child \{/, 'Manage > Theme\'s sample header shows the two areas');
});

test('destinations: brand.js registers them from GET /api/destinations, wider only and phone only, and opens them over a space while present', () => {
  const brand = fs.readFileSync(path.join(ROOT, 'public/brand.js'), 'utf8');
  const load = brand.slice(brand.indexOf('async function loadDestinations('), brand.indexOf('\n}\n', brand.indexOf('function markDestinations(')));
  assert.match(load, /fetch\('\/api\/destinations'\)/);
  assert.match(load, /destinationTools\(list/);
  assert.match(load, /for \(const \{ menu \} of destinationTools\(list/, 'the phone menu\'s entries only: the bar\'s are the profile menu\'s and a space\'s views (plan-one-bar.md, step 7)');
  assert.match(load, /\[\[menu, \(\) => inMenuOnly\(\) && !inSpace\]\]/, 'the phone menu\'s entry, not in a space (there the view is the entry: step 8)');
  assert.ok(!/\[\[inBar, wide\]/.test(load), 'no left-zone entry outside a space');
  assert.match(load, /new CustomEvent\('app:destinations', \{ detail: \{ destinations: destinationList \} \}\)/, 'the space page hears the list');
  assert.match(brand, /export const destinationsNow = \(\) => destinationList;/);
  assert.match(load, /setAttribute\('aria-current', 'page'\)/);
  assert.match(load, /toggleAttribute\('data-overlay-link', over\)/);
  assert.match(load, /const over = Boolean\(presentSpaceNow\(\)\) && !overCall\(\);/);
  assert.match(brand, /presentSpace = id \|\| null;\n  markDestinations\(\);/, 'entering or leaving a space marks them again');
  assert.match(brand, /loadDestinations\(\{ wide: \(\) => wide\(\) && signedIn\(\), inMenuOnly \}\);/);
  assert.match(load, /for \(const id of destinationIds\) nav\.unregister\(id\);/, 'asked again, the old entries go first');
  assert.match(brand, /export function refreshDestinations\(\)/, 'a page can ask again');
  assert.match(fs.readFileSync(path.join(ROOT, 'public/module-config.js'), 'utf8'), /refreshDestinations\(\); \/\/ the bar's entry comes or goes/, 'a module\'s configuration asks again after its Show in the top bar switch');
  assert.match(load, /window\.location\.pathname\.toLowerCase\(\)/, '/CALENDAR is current too');
  // A guest's bar and the host console return before the menu's entries are registered, so they have no entry.
  const sys = brand.slice(brand.indexOf('function registerSystemTools('), brand.indexOf('loadDestinations({'));
  assert.match(sys, /if \(guest \|\| hostConsole\) return;/);
});

// The phase chip and its sheet (plan-one-bar.md, decisions 7 to 10, step 3; plan-space-status-strip.md, step 1;
// plan-space-story-strip.md, steps 1 and 2): the status strip that holds the chip, its sentence and the journey bar, the
// bands' widths, the today line, the boundaries the sheet offers and the sentences a person reads.
const sheetCopy = path.join(tmp, 'phase-sheet.mjs');
fs.mkdirSync(tmp, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'public/phase-sheet.js'), sheetCopy);
fs.copyFileSync(path.join(ROOT, 'public/action-bar.js'), path.join(tmp, 'action-bar.js')); // the sheet imports it
const { bandShares, todayPercent, rowsOf, plainDays, tintOf, TINTS, factsInSheet, FACT_CHIPS_HIDDEN_AT } = await import(pathToFileURL(sheetCopy).href);
const Phases = createRequire(import.meta.url)('../public/phases.js');
fs.rmSync(tmp, { recursive: true, force: true });
const TRAVEL = [{ id: 'planning', label: 'Planning' }, { id: 'booking', label: 'Booking' }, { id: 'buffer', label: 'Buffer' }, { id: 'pre-trip', label: 'Pre-trip' }, { id: 'trip', label: 'Trip', main: true }, { id: 'post-trip', label: 'Post-trip' }];
const CREATED = '2026-09-01T12:00:00.000Z';

test('the facts are reachable at every width: where the strip hides its chips (760px and below), the phase sheet lists them', () => {
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  // One number for the stylesheet's rule and the page's: the chips are hidden at FACT_CHIPS_HIDDEN_AT and below.
  assert.equal(FACT_CHIPS_HIDDEN_AT, 760);
  assert.match(css, new RegExp(`@media \\(max-width: ${FACT_CHIPS_HIDDEN_AT}px\\) \\{\\n\\s*\\.sdk-strip \\.sdk-strip-facts \\{\\n\\s*display: none;`), 'the stylesheet hides the chips at the same width');
  for (const [width, inSheet] of [[390, true], [640, true], [641, true], [700, true], [760, true], [761, false], [1280, false]]) {
    assert.equal(factsInSheet(width), inSheet, `at ${width}px the sheet ${inSheet ? 'lists' : 'leaves out'} the facts`);
    // At every width a fact is somewhere: a chip, or the sheet.
    const chipsShown = width > FACT_CHIPS_HIDDEN_AT; // the stylesheet's rule, pinned above
    assert.ok(chipsShown || factsInSheet(width), `at ${width}px a fact is reachable`);
  }
  assert.match(space, /if \(view\.matchMedia\(`\(max-width: \$\{FACT_CHIPS_HIDDEN_AT\}px\)`\)\.matches\) return true;/, 'the page asks the same width, in the header\'s own window');
  assert.match(space, /return factsInOrder\(\)\.length > statusFacts\.querySelectorAll\('\.sdk-strip-fact:not\(\[hidden\]\)'\)\.length;/, 'wider, a fact the line could not fit is in the sheet too');
  assert.ok(!/facts: phoneWidth\(\)/.test(space), 'not only on a phone (641 to 760px had no way to them)');
});

test('a fact\'s day: worded by the host against the viewer\'s own today, dropped once it has passed (#216)', () => {
  const next = { id: 'next', icon: 'plane', text: 'SJC → ONT', when: '2026-10-16', order: 20 };
  const spent = { id: 'spent', icon: 'coins', text: '$2,340 of $4,000', budget: true };
  const at = (today) => Phases.factsToday([spent, next], today, 'en-US');
  assert.deepEqual(at('2026-10-16').map((f) => f.text), ['$2,340 of $4,000', 'Today · SJC → ONT']);
  assert.deepEqual(at('2026-10-15').map((f) => f.text), ['$2,340 of $4,000', 'Tomorrow · SJC → ONT']);
  assert.deepEqual(at('2026-10-14').map((f) => f.text)[1], 'Fri · SJC → ONT', 'within the week: the weekday');
  assert.deepEqual(at('2026-10-01').map((f) => f.text)[1], 'Oct 16 · SJC → ONT', 'further out: the month and day');
  assert.deepEqual(at('2026-10-17'), [spent], 'the day after: the booking is gone, the budget (no day) stays');
  assert.deepEqual(at('2027-01-01'), [spent], 'long after: still gone, never a stale "tomorrow"');
  assert.equal(Phases.whenWords('2026-10-21', '2026-10-14', 'en-US'), 'Oct 21', 'a week ahead');
  assert.equal(Phases.whenWords('2026-10-20', '2026-10-14', 'en-US'), 'Tue', 'six days ahead');
  assert.equal(Phases.whenWords('2026-10-13', '2026-10-14'), null, 'yesterday: passed');
  assert.equal(Phases.whenWords('2026-02-30', '2026-02-01'), null, 'not a day');
  assert.equal(Phases.whenWords('2027-01-01', '2026-12-31', 'en-US'), 'Tomorrow', 'across a year');
  assert.deepEqual(Phases.factsToday([{ ...next, when: 'soon' }], '2026-10-14'), [], 'a day the host cannot read is left out');
  assert.equal(at('2026-10-15')[1].when, '2026-10-16', 'the day itself is kept');
  // The page reads every fact through it: the chips, a chip's menu and the phase sheet, against my own today.
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  assert.match(space, /const factsNow = \(list\) => \(phaseRule\(\) && phaseRule\(\)\.factsToday \? phaseRule\(\)\.factsToday\(list, phaseToday\(\)\)/);
  assert.match(space, /spaceFacts\.modules\.forEach\(\(m, mi\) => factsNow\(m\.facts\)\.forEach/, 'the chips and the sheet');
  assert.match(space, /for \(const f of factsNow\(m\.facts\)\) \{/, 'a chip\'s menu');
});

test('the status strip: the chip and its journey bar, a tool of the space bar\'s left zone with no fit, a line under the top row on a phone', () => {
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  const sys = fs.readFileSync(path.join(ROOT, 'public/sdk/system.css'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'public/space.html'), 'utf8');
  const look = sys.slice(sys.indexOf('/* journey:start */'), sys.indexOf('/* journey:end */'));
  assert.ok(look.length > 0, 'the Journey bar block is in system.css');
  // Registered on the space bar's left zone (the row wider than a phone), with no fit: the bar gives way instead.
  assert.match(space, /const STATUS_STRIP_TOOL = \{ id: 'phase-chip', bar: 'secondary', zone: 'left', group: 'status', order: 1, [^\n]*element: statusStrip, visible: phaseChipWanted \};/, 'the strip is the space bar\'s left-zone tool');
  assert.ok(!/id: 'phase-chip'[^\n]*(fit:|fitFirst|yieldFirst)/.test(space), 'no fit on the chip in the strip');
  assert.ok(!/function fitPhaseChip|applyPhaseChipFit|chipFit/.test(space), 'the chip\'s old fit is gone');
  assert.ok(!/export function chipFit/.test(fs.readFileSync(path.join(ROOT, 'public/phase-sheet.js'), 'utf8')), 'and so is chipFit');
  // The strip and its chips keep their ids; the classes are the Journey bar family's.
  assert.match(space, /statusStrip\.id = 'status-strip';\nstatusStrip\.className = 'sdk-strip';/);
  assert.match(space, /phaseChip\.id = 'phase-chip';/);
  assert.match(space, /phaseChip\.className = 'sdk-strip-chip sdk-strip-phase';/, 'the phase chip is a header chip');
  assert.match(space, /phaseChip\.setAttribute\('aria-haspopup', 'dialog'\)/);
  assert.match(space, /phaseChip\.innerHTML = '<span class="sdk-strip-dot" aria-hidden="true"><\/span><span class="sdk-strip-sentence"><\/span>';/, 'the chip ends with its words: no caret, and one label at every width');
  assert.ok(!/phase-chip-caret|phase-chip-short/.test(space + css), 'no caret class on the chip, and no phone-only short words');
  assert.ok(!/▾/.test(space.slice(space.indexOf('// --- the status strip'), space.indexOf('// --- end the status strip ---')) + stripCssOf(css) + look), 'no caret, not even in the comments (plan-space-story-strip.md, decision 1)');
  assert.ok(!/\b(status-track|status-band|status-togo|status-today|phase-chip-label|phase-dot|attention-count)\b/.test(css + sys + space.replace(/'attention-count'/g, '')), 'the old class names are gone from the page and its stylesheets');
  // The chip, the days to go and a press on the bar (wider than a phone) open the sheet; on the phone's line a tap on a
  // band says its name and dates.
  assert.match(space, /phaseChip\.addEventListener\('click', \(\) => openPhaseSheetFrom\(phaseChip\)\);/);
  assert.match(space, /statusTrack\.addEventListener\('click', \(\) => \{\n\s*if \(journeyPhone\(\)\) return;[^\n]*\n\s*openPhaseSheetFrom\(phaseChip\);/, 'the bar opens the sheet wider than a phone; the phone\'s line is for seeing');
  assert.match(space, /band\.dataset\.tip = tip;\n\s*band\.setAttribute\('aria-label', tip\);/, 'a band\'s name and dates are the shared tooltip (data-tip, public/tooltip.js) and its name');
  assert.ok(!/sdk-journey-tip|showJourneyTip/.test(space + sys), 'no tooltip of its own: the Tooltips family\'s');
  assert.match(space, /statusToGo\.addEventListener\('click', \(\) => openPhaseSheetFrom\(phaseChip\)\);/);
  assert.match(space, /statusToGo\.className = 'sdk-strip-chip sdk-strip-count';/, 'the days to go is a header chip, a button');
  // A region named Status; the chip's words in one polite status, written only when they change; the bar a group named
  // Journey, each band named by its name and dates, the pin by today's date.
  assert.match(space, /statusStrip\.setAttribute\('role', 'region'\);\nstatusStrip\.setAttribute\('aria-label', 'Status'\);/);
  assert.match(space, /statusSaid\.setAttribute\('role', 'status'\);/);
  assert.match(space, /statusSaid\.appendChild\(phaseChip\);\n/);
  assert.match(space, /statusStrip\.append\(statusSaid, statusTrack, statusToGo, statusFacts, statusAttention\);/, 'the sentence, the bar, the days to go, the facts, then the count last');
  assert.match(space, /statusTrack\.setAttribute\('role', 'group'\);\nstatusTrack\.setAttribute\('aria-label', 'Journey'\);/);
  // The facts (host.facts, plan-space-story-strip.md step 5): a group of chips, not a live region, drawn again only when
  // the facts change, at most three, each a header chip opening the shared menu; they give way one by one from the end
  // while the journey bar has less than its room.
  assert.match(space, /statusFacts\.setAttribute\('role', 'group'\);/, 'the facts are a group of buttons');
  assert.ok(!/statusFacts\.setAttribute\('(aria-live|role)', '(polite|status|assertive)'\)/.test(space), 'not a live region');
  assert.match(space, /const MAX_FACT_CHIPS = 3;/, 'up to three chips');
  assert.match(space, /const shown = phaseChipWanted\(\) \? factsInOrder\(\)\.slice\(0, MAX_FACT_CHIPS\) : \[\];/, 'only where the strip shows, three at most');
  assert.match(space, /if \(key !== factsDrawn\) \{\n\s*factsDrawn = key;\n\s*statusFacts\.replaceChildren\(\.\.\.shown\.map\(factChip\)\);/, 'drawn again only when the facts change');
  assert.match(space, /b\.className = 'sdk-strip-chip sdk-strip-fact';/, 'a fact is a header chip');
  assert.match(space, /b\.addEventListener\('click', \(\) => openHostMenu\(b, \(\) => factMenuItems\(f\.module\)\)\);/, 'a chip opens the shared menu');
  assert.match(space, /const JOURNEY_LEAST = 480;/, 'the day grid keeps 480px before a fact gives way');
  assert.match(space, /for \(let i = chips\.length - 1; i >= 0 && crowded\(\); i -= 1\) chips\[i\]\.hidden = true;/, 'the last chip gives way first, one by one');
  assert.match(space, /facts: factsHiddenInStrip\(\) \? factsInOrder\(\)/, 'where the chips are hidden (a phone too) the facts head the phase sheet');
  // The words are the story sentence (Phases.storyParts), written only when it changes, each clause after the first its
  // own span so the end gives way whole and the label's text stays the whole sentence.
  const chipUpdate = space.slice(space.indexOf('function updatePhaseChip('), space.indexOf('async function savePhases('));
  assert.match(chipUpdate, /const parts = R\.storyParts\(bands, today\);\n\s*const words = parts\.join\(' · '\);/, 'the chip says the story sentence');
  assert.ok(!/chipWords/.test(chipUpdate), 'not the old words');
  assert.match(space, /if \(phaseChip\.querySelector\('\.sdk-strip-sentence'\)\.textContent !== words\) \{\n\s*writeStory\(parts\);/, 'the status changes only when the sentence changes');
  assert.match(space, /span\.className = i \? 'story-part' : 'story-part story-lead';\n\s*span\.textContent = i \? ` · \$\{part\}` : part;/, 'the clauses, their separators in their text');
  // Shown only with phases, never for a guest, in an aside, or with home over the space; redrawn from the presence poll.
  assert.match(space, /const phaseChipWanted = \(\) => Boolean\(currentSpace\) && !inAside\(\) && !viewingHome && !guestToken && me\?\.role !== 'guest' && \(phasesWanted\(\) \|\| attentionSeen\);/, 'no strip with no phases (unless a count has arrived), for a guest, in an aside, or with home over the space');
  assert.match(space, /const phasesWanted = \(\) => templatePhases\.length > 0 && Boolean\(phaseRule\(\)\);/, 'phases wanted: the template has some and the rule is loaded');
  assert.ok(!/phaseChipWanted = [^\n]*(currentLayoutTab|workspaceShown)/.test(space), 'on every layout tab');
  assert.match(space, /updatePhaseChip\(\); \/\/ the space's dates ride on its presence record/, 'redrawn from the presence poll');
  // The bar: the day grid of journeyLayout (public/journey-layout.js, loaded before the page's script), laid out again
  // when its width changes; dated phases by their days, an open-ended one two weeks past today, the undated ones as stubs.
  assert.ok(html.indexOf('<script src="/journey-layout.js"></script>') > html.indexOf('<script src="/phases.js"></script>') && html.indexOf('<script src="/journey-layout.js"></script>') < html.indexOf('<script type="module" src="/space.js"></script>'), 'space.html loads the layout before the page');
  const track = space.slice(space.indexOf('function layoutJourney('), space.indexOf('// A band\'s name and dates: on hover and focus'));
  assert.match(track, /const lay = L\.journeyLayout\(dated\.map\(\(b\) => \(\{ n: b\.label, i: phaseIcons\[b\.id\] \|\| '', t: b\.tint, s: b\.start, e: endOf\(b\) \}\)\), today, width, \{ zone: phone \? 14 : 28, offs: offs\.length \}\);/, 'the bar is journeyLayout\'s, a 14px zone on a phone');
  assert.match(track, /const endOf = \(b\) => b\.end \|\| R\.addDays\(today > b\.start \? today : b\.start, OPEN_DAYS_PAST_TODAY\);/, 'an open-ended phase runs two weeks past today');
  assert.match(track, /band\.dataset\.state = b\.state;\n\s*band\.dataset\.tint = b\.t;/, 'each band carries its state and its phase\'s tint (Phases.tintOf)');
  assert.match(track, /band\.setAttribute\('aria-label', tip\);\n\s*band\.tabIndex = 0;/, 'each band is named and reached by the keyboard');
  assert.match(track, /icon\.className = `fa-solid fa-\$\{b\.i\} sdk-band-icon`;/, 'a band\'s icon, when the template gives one');
  assert.match(track, /pin\.setAttribute\('role', 'img'\);/, 'the pin is named by today\'s date');
  assert.match(space, /if \(typeof ResizeObserver === 'function'\) new ResizeObserver\(\(\) => layoutJourney\(\)\)\.observe\(statusTrack\);/, 'laid out again as its width changes');
  assert.match(space, /const togo = R\.countdown\(bands, today\);\n\s*const doc = statusToGo\.ownerDocument;\n\s*statusToGo\.hidden = !togo;/, 'the days to go, gone when there are none');
  // placeSubnav() places it: the registry's tool wider than a phone, out of the registry and into the header on a phone.
  const placeSub = space.slice(space.indexOf('function placeSubnav()'), space.indexOf('\nplaceSubnav();'));
  assert.match(placeSub, /placeStatusStrip\(tabs\);/);
  assert.ok(placeSub.indexOf('placeStatusStrip(tabs)') < placeSub.indexOf('if (popped)'), 'popped out too: the strip follows the header');
  const place = space.slice(space.indexOf('placeStatusStrip = (tabs) => {'), space.indexOf('placeStatusStrip(phoneWidth());'));
  assert.match(place, /if \(nav\.get\('phase-chip'\)\) nav\.unregister\('phase-chip'\);/);
  assert.match(place, /topbarEl\.insertBefore\(statusStrip, before\)/);
  assert.match(place, /nav\.register\(STATUS_STRIP_TOOL\);/);
  // The stylesheets: the heights (tokens), the row on every layout tab, the 57px grid wider than a phone, the 28px line.
  assert.match(css, /\n\s*--status-strip-h: 57px;\n\s*--status-strip-slim-h: 28px;/, 'the tokens: 57px with the day grid wider than a phone, a slim line on a phone');
  assert.match(look, /\.sdk-strip \{\n\s*position: relative;\n\s*display: flex;\n\s*flex-wrap: nowrap;[^}]*height: calc\(var\(--status-strip-h\) - 1px\);[^}]*overflow: hidden;/, 'one line, the row\'s rule and the 56px grid');
  assert.match(css, /body\.in-space \.subnav:has\(> \.nav-left > \.sdk-strip:not\(\[hidden\]\)\) \{\n\s*box-sizing: border-box;\n\s*height: var\(--status-strip-h\);/, 'the row is the strip\'s height');
  assert.match(look, /\.sdk-journey \{[^}]*flex: 1 1 360px;[^}]*min-width: 48px;[^}]*height: calc\(var\(--status-strip-h\) - 1px\);/, 'the bar asks for 360px, shrinks to 48px, and is the grid\'s height');
  assert.match(look, /--jr-band-h: 24px;/, 'a band is 24px');
  assert.match(look, /--jr-bar-top: 15px;/, 'the bar sits under the pin\'s row');
  assert.match(look, /@media \(max-width: 640px\) \{\n\s*\.sdk-strip \{ height: var\(--status-strip-slim-h\);/, 'on a phone the slim line');
  assert.match(look, /\.sdk-strip \.sdk-journey \{ position: absolute;[^}]*left: 0; right: 0; bottom: var\(--jr-line-foot\);[^}]*height: var\(--jr-line\);/, 'on a phone a 2px line along the foot');
  assert.match(look, /--jr-line: 2px;/);
  assert.match(look, /\.sdk-strip \.sdk-journey > :is\(\.sdk-gap, \.sdk-tick, \.sdk-tick-label\) \{ display: none; \}/, 'on a phone no ticks or dates');
  assert.match(look, /\.sdk-strip :is\(\.sdk-strip-count, \.sdk-strip-facts\) \{ display: none; \}/, 'on a phone no days to go and no facts');
  // The facts give way first, at 760px (FACT_CHIPS_HIDDEN_AT); the sentence's later clauses whole, the first cut last.
  assert.match(look, /\.sdk-strip-facts \{ display: flex; flex: none;/, 'the facts give way whole rather than squeeze');
  assert.match(look, /\.sdk-strip-chip \{[^}]*height: var\(--jr-chip-h\);[^}]*border: 1px solid transparent;[^}]*background: color-mix\(in srgb, var\(--text-bar\) var\(--jr-fact\), transparent\);/, 'a chip is a neutral fill, no edge');
  assert.match(look, /--jr-chip-h: 30px;/, 'every header chip is 30px');
  assert.match(look, /\.sdk-strip-fact > \.sdk-strip-fact-fill \{[^}]*width: var\(--p, 0%\);[^}]*background: color-mix\(in srgb, var\(--accent-fill\) 22%, transparent\);/, 'progress is a fill of the accent');
  assert.match(look, /\.sdk-strip-sentence \{ display: flex; flex-wrap: wrap;[^}]*overflow: hidden; \}/, 'the sentence\'s later clauses drop whole');
  assert.match(look, /\.sdk-strip-sentence > \.story-lead \{ flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; \}/, 'the first clause is cut last, with an ellipsis');
  // The phases' colours are fills (Thomas, 2026-10-14: "no colored borders"): past 12%, ahead 22%, the current band the
  // selected fill with its name in the accent mix; the dot a fill of the tint; nothing coloured on an edge.
  assert.match(look, /\.sdk-band \{[^}]*border: 1px solid var\(--edge-hairline\);[^}]*border-radius: var\(--radius-medium\);[^}]*background: color-mix\(in srgb, var\(--tint, var\(--accent-fill\)\) var\(--jr-ahead\), transparent\);/, 'a band ahead of today: a soft wash of its tint, in the neutral hairline');
  assert.match(look, /\.sdk-band\[data-state="past"\] \{ background: color-mix\(in srgb, var\(--tint, var\(--accent-fill\)\) var\(--jr-past\), transparent\); \}/, 'past bands paler');
  assert.match(look, /\.sdk-band\[data-state="current"\] \{ background: var\(--fill-selected\); color: var\(--jr-now\); font-weight: var\(--weight-strong\); \}/, 'today\'s band the selected fill');
  assert.match(look, /--jr-past: 12%;\n\s*--jr-ahead: 22%;/);
  assert.match(look, /\.sdk-strip-dot \{[^}]*background: var\(--tint, var\(--accent-fill\)\);/, 'the chip\'s dot in the tint');
  assert.match(space, /const here = bands\.find\(\(b\) => b\.current\) \|\| [^\n]*\n\s*const dot = phaseChip\.querySelector\('\.sdk-strip-dot'\);\n\s*if \(here\) dot\.dataset\.tint = here\.tint;/, 'the chip\'s dot takes the tint of the phase today is in');
  for (const m of (look + stripCssOf(css)).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const borders = m[2].split(';').map((d) => d.trim()).filter((d) => /^border(-top|-right|-bottom|-left)?(-color)?\s*:/.test(d));
    for (const d of borders) assert.ok(!/--tint|--accent|currentColor/.test(d), `${m[1].trim()}: a coloured border (${d})`);
  }
  assert.deepEqual(Phases.TINTS, TINTS, 'the sheet and the rule share one list of tints');
  assert.deepEqual(Phases.timelineOf(TRAVEL, {}, { created: CREATED }).map((b, i) => b.tint === tintOf(i)), [true, true, true, true, true, true], 'every band\'s tint is the sheet\'s tintOf');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(stripCssOf(css) + look), 'theme tokens only in the strip');
  assert.match(css, /body\.in-space\.in-aside \.subnav \{\n\s*display: none;/, 'no strip row in an aside');
});

test('the journey bar\'s day grid: one journeyLayout, word for word the Proposed page\'s, a band as wide as its days, the pin at today', () => {
  const region = (text) => { const a = text.indexOf('// journey-layout:start'); const b = text.indexOf('// journey-layout:end'); assert.ok(a >= 0 && b > a, 'the markers'); return text.slice(text.indexOf('\n', a) + 1, b).trimEnd(); };
  const product = fs.readFileSync(path.join(ROOT, 'public/journey-layout.js'), 'utf8');
  const proposed = fs.readFileSync(path.join(ROOT, 'public/design-system/legacy/system-v1/proposed-journey.js'), 'utf8');
  assert.equal(region(product), region(proposed), 'public/journey-layout.js and proposed-journey.js hold the same journeyLayout');
  const { journeyLayout: L } = createRequire(import.meta.url)('../public/journey-layout.js');
  const ph = (n, s, e) => ({ n, s, e, i: 'x' });
  let r = L([ph('A', '2026-11-06', '2026-11-06'), ph('B', '2026-11-07', '2026-11-07'), ph('C', '2026-11-08', '2026-11-08')], '2026-11-07', 300);
  assert.ok(Math.abs(r.dayW - 100) < 0.001 && r.bands.every((b, k) => Math.abs(b.w - 98) < 0.001 && Math.abs(b.x - (1 + k * 100)) < 0.001), 'three days in 300px: each band 98px at its day');
  assert.ok(Math.abs(r.pin.x - 150) < 0.001 && r.pin.where === 'in', 'the pin at the middle of today\'s slice');
  assert.deepEqual(r.bands.map((b) => b.state), ['past', 'current', 'ahead']);
  r = L([ph('A', '2026-10-01', '2026-10-10'), ph('B', '2026-10-15', '2026-10-25')], '2026-10-12', 250);
  assert.ok(r.gaps.length === 1 && r.gaps[0].days === 4, 'the days no phase covers are a gap');
  r = L([ph('A', '2026-11-01', '2026-11-10')], '2026-10-20', 328);
  assert.ok(r.pin.where === 'lead' && Math.abs(r.pin.x - 14) < 0.001, 'today before the trip: the pin in the 28px lead zone');
  r = L([ph('A', '2026-11-01', '2026-11-10')], '2026-11-02', 176, { offs: 1 });
  assert.ok(r.offs.length === 1 && Math.abs(r.dayW - 16) < 0.001, 'a phase with no dates keeps 16px at the end');
  assert.equal(L([ph('A', '2026-09-01', '2026-11-29')], '2026-10-01', 800).tickMode, 'week', 'ticks each Monday up to 120 days');
});

test('the sheet\'s bar: each band\'s share is its days, an open-ended one runs past today, an undated one has none, the today line in its band', () => {
  const today = '2026-10-02';
  const bands = Phases.timelineOf(TRAVEL, { booking: { start: '2026-09-10' }, trip: { start: '2026-10-01', end: '2026-10-01' }, 'post-trip': { start: '2026-10-02' } }, { today, created: CREATED });
  const shares = bandShares(bands, { today, rule: Phases });
  assert.deepEqual(shares.map((s) => [s.id, s.days, s.grow]), [['planning', 9, 9], ['booking', 21, 21], ['buffer', 0, 0], ['pre-trip', 0, 0], ['trip', 1, 1], ['post-trip', 15, 15]], 'Post-trip, open-ended from today, runs two weeks past it');
  assert.equal(todayPercent(bands[5], shares[5].days, today, { rule: Phases }), (0.5 / 15) * 100, 'today is Post-trip\'s first day');
  assert.equal(todayPercent(bands[1], shares[1].days, today, { rule: Phases }), null, 'not in Booking');
  assert.equal(todayPercent(bands[2], 0, today, { rule: Phases }), null, 'never in an undated band');
  assert.equal(todayPercent(bands[1], shares[1].days, '2026-09-20', { rule: Phases }), 50, 'the middle of Booking');
  assert.deepEqual(bandShares([], { today, rule: Phases }), []);
  assert.deepEqual([0, 7, 8, 9].map(tintOf), [TINTS[0], TINTS[7], TINTS[0], TINTS[1]], 'eight tints, round again');
});

test('the sheet\'s rows: one per phase in order, dates, length, what may be edited or skipped, the pickers\' bounds', () => {
  const today = '2026-09-12';
  const of = (dates) => rowsOf(Phases.timelineOf(TRAVEL, dates, { today, created: CREATED }), { rule: Phases });
  const full = of({ booking: { start: '2026-09-10' }, trip: { start: '2026-10-01', end: '2026-10-07' }, 'post-trip': { start: '2026-10-08' } });
  assert.deepEqual(full.map((r) => [r.id, r.dated, r.start, r.end, r.days, r.open, r.current, r.main]), [
    ['planning', true, '2026-09-01', '2026-09-09', 9, false, false, false],
    ['booking', true, '2026-09-10', '2026-09-30', 21, false, true, false],
    ['buffer', false, null, null, null, false, false, false],
    ['pre-trip', false, null, null, null, false, false, false],
    ['trip', true, '2026-10-01', '2026-10-07', 7, false, false, true],
    ['post-trip', true, '2026-10-08', null, null, true, false, false],
  ]);
  assert.deepEqual(full.map((r) => [r.endEditable, r.canSkip]), [[true, false], [true, true], [false, false], [false, false], [true, true], [true, true]], 'every dated phase takes an end, the last one too; the first is never skipped; an undated row has neither');
  assert.deepEqual([full[1].minStart, full[1].maxStart, full[1].minEnd], ['2026-09-02', '2026-09-30', '2026-09-10'], 'Booking: after Planning\'s first day, not after its own end; its end not before its start');
  assert.deepEqual([full[0].minStart, full[4].minStart, full[5].maxStart], [null, '2026-09-11', null], 'the first start is free; Trip starts after Booking\'s first day (the skipped phases between do not count); an open end has no bound');
  // Nothing dated: the first phase from the created day, open-ended, its end editable; the rest undated.
  const none = of({});
  assert.deepEqual(none.map((r) => [r.dated, r.open, r.endEditable]), [[true, true, true], [false, false, false], [false, false, false], [false, false, false], [false, false, false], [false, false, false]]);
  // The main phase last in order keeps its end editable.
  const mainLast = rowsOf(Phases.timelineOf([{ id: 'plan', label: 'Plan' }, { id: 'go', label: 'Go', main: true }], { go: { start: '2026-10-01' } }, { today, created: CREATED }), { rule: Phases });
  assert.deepEqual(mainLast.map((r) => [r.id, r.endEditable, r.open]), [['plan', true, false], ['go', true, true]]);
  assert.deepEqual(rowsOf([], { rule: Phases }), []);
  assert.equal(plainDays('Booking must start after Planning starts, 2026-09-01.', (d) => `<${d}>`), 'Booking must start after Planning starts, <2026-09-01>.');
});

test('the sheet: one row per phase with native date inputs, Skip and Add dates, the first step, the rule\'s three edits, Escape and the opener', () => {
  const sheet = fs.readFileSync(path.join(ROOT, 'public/phase-sheet.js'), 'utf8');
  assert.match(sheet, /R\.setPhaseDate\(list, draft, id, edge, day, \{ created \}\)/, 'every date edit goes through the rule');
  assert.match(sheet, /R\.skipPhase\(list, draft, id, \{ created \}\)/);
  assert.match(sheet, /R\.addDatesFor\(list, draft, id, \{ created, today \}\)/);
  assert.match(sheet, /<input type="date" class="phase-date" data-edge="start">/);
  assert.match(sheet, /<input type="date" class="phase-date" data-edge="end">/);
  assert.match(sheet, /class="btn btn-small phase-skip">Skip</);
  assert.match(sheet, /Add dates</);
  assert.match(sheet, /Not scheduled/);
  assert.match(sheet, /Start the first phase on/);
  assert.match(sheet, /role="status" aria-live="polite"/, 'a refusal is read out');
  assert.match(sheet, /if \(j >= 0 && !before\[j\]\.dated\) focusNext = after\[j\]\.id;/, 'an end that dates the next phase puts the keyboard on its end');
  assert.match(sheet, /start\.disabled = !canEdit \|\| !r\.dated;/, 'read-only: the same rows, disabled');
  assert.match(sheet, /if \(!typing && v === '' && input\.dataset\.edge === 'end' && current\(\) !== ''\) commit\(input\.dataset\.id, 'end', ''\);/, 'an emptied end is given up, on leaving or Enter');
  assert.match(sheet, /end\.disabled = !canEdit \|\| !r\.endEditable;/);
  assert.match(sheet, /\? `\$\{me\.label\} runs \$\{fmt\(me\.start\)\} to \$\{fmt\(me\.end\)\}\.`/, 'the last phase ended: "Post-trip runs Oct 20 to Oct 25."');
  assert.match(fs.readFileSync(path.join(ROOT, 'public/space-setup.js'), 'utf8'), /phaseSet\(input\.dataset\.id, 'end', ''\)/, 'Set up\'s rows give an end up the same way');
  assert.match(sheet, /if \(opener && typeof opener\.focus === 'function' && opener\.isConnected\) opener\.focus\(\);/, 'focus goes back to the chip');
  assert.ok(!/Set when \$\{/.test(sheet), 'no "Set when X starts" buttons');
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  const block = css.slice(css.indexOf('/* phase-sheet:start'), css.indexOf('/* phase-sheet:end */'));
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(block.replace(/rgba\(0, 0, 0, 0\.45\)/g, '')), 'tokens only (the shadow\'s black aside)');
  assert.match(block, /grid-template-areas: "name name" "start end" "days tools" "problem problem";/, 'on a phone the rows stack: the name, then start and end side by side');
  assert.match(block, /min-height: 44px;/);
});

// Set up (plan-one-bar.md, decision 5, step 4; plan-setup-panel.md, steps 1 to 6; public/space-setup.js): the tool in
// the bar (pressed while open), the tabs each role sees, the fragment that picks one, the address that opens it, the
// dirty dots, the one PATCH of what changed, the field a refusal is about, and the line said after Save.
const setupCopy = path.join(tmp, 'space-setup.mjs');
fs.mkdirSync(tmp, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'public/space-setup.js'), setupCopy);
// Every file the panel imports from beside it (action-bar.js, phase-sheet.js, ai-sees.js...), and what those import, so a
// new import never breaks the copy.
{
  const copied = new Set();
  const copyImports = (file) => {
    for (const m of fs.readFileSync(path.join(ROOT, 'public', file), 'utf8').matchAll(/^import\s[^;]*?from\s+'\.\/([\w.-]+\.js)'/gm)) {
      if (copied.has(m[1])) continue;
      copied.add(m[1]);
      fs.copyFileSync(path.join(ROOT, 'public', m[1]), path.join(tmp, m[1]));
      copyImports(m[1]);
    }
  };
  copyImports('space-setup.js');
  assert.ok(['action-bar.js', 'phase-sheet.js', 'ai-sees.js'].every((f) => copied.has(f)), 'the panel\'s imports are copied with it');
}
const { setupTabs, pickTab, setupAddress, setupPatch, dirtyTabs, takeSaved, problemField, setupSaidWords, configurationLabel, MODERATOR_FIELDS, tabOfField, budgetEntryProblem, budgetWanted, BUDGET_NOT_A_NUMBER } = await import(pathToFileURL(setupCopy).href);
fs.rmSync(tmp, { recursive: true, force: true });

test('Set up: a right-zone tool after your picture, before the window controls, for owners, the admin and moderators; Save and Cancel are the panel\'s action bar, not the top bar\'s', () => {
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  assert.match(space, /nav\.register\(\{ id: 'setup', bar: 'primary', zone: 'right', group: 'space', groupOrder: 85, order: 1, place: 'end', [^\n]*toggleable: true, active: false, visible: setupShown, onClick: \(\) => \(settingUp \? spaceSetup\.cancel\(\) : enterSetup\(\{ tab: '#show' \}\)\) \}\)/, 'wider than a phone in the last run, first of the window controls\' group (Thomas, 2026-10-13: "Settings should go right before the window controls"); on a phone still before the bell (90) and the you group (999)');
  assert.ok(!/id: 'setup-done'|id: 'setup-cancel'/.test(space), 'Done and Cancel left the top bar: the panel\'s action bar has Save and Cancel (Thomas, 2026-10-13)');
  assert.match(space, /const canSetUp = \(\) => Boolean\(currentSpace\) && !inAside\(\) && !viewingHome && !guestToken && Boolean\(me\) && me\.role !== 'guest' && \(hasOwnerRights\(me\) \|\| isModeratorHere\(\)\)/, 'owners, the admin and this space\'s moderators; never a guest, an aside or home over the space');
  assert.match(space, /const setupShown = \(\) => canOpenSetup\(\);/, 'the tool stays while the panel is open');
  assert.match(space, /const canOpenSetup = \(\) => canSetUp\(\) \|\| canShowTab\(\);/, 'a person who may not set up still has the Modules tab');
  assert.match(space, /nav\.setActive\('setup', true\);/, 'and shows pressed');
  assert.match(space, /settingUp = false;\n\s*document\.body\.classList\.remove\('setting-up'\);\n\s*nav\.setActive\('setup', false\);/, 'not pressed once it closes');
  assert.match(space, /function enterSetup\(\{ tab = location\.hash \} = \{\}\) \{/, 'the address fragment picks the tab, unless an address opening Set up asked for one');
  assert.match(space, /    tab,\n\s*nameInput: setupNameInput,/);
  assert.match(space, /onTab: setupTabInAddress,/, 'and follows it while open');
  assert.match(space, /document\.body\.classList\.add\('setting-up'\)/, 'the mode is body.setting-up');
  assert.match(space, /placeSetupName\(\); \/\/ while setting up, the current segment is the name's input/, 'the breadcrumb carries the input after every draw');
  const html = fs.readFileSync(path.join(ROOT, 'public/space.html'), 'utf8');
  // Step 6: the card's two links are one Set up link to /?setup=<id>, for whoever may set up (owners, the admin, moderators).
  assert.ok(!/data-edit/.test(html) && !/data-edit/.test(space), 'the card has no Set up button (Thomas, 2026-10-14); Set up is the top bar tool inside the space, or /?setup=<id>');
  assert.ok(!/data-module-settings|title="Full settings"/.test(html), 'the moderators\' sliders link and Full settings are gone');
  assert.ok(!/module-settings\?space=|`\/spaces\/\$\{/.test(space), 'space.js links to neither old page');
  // The order: Modules (id show) | the space's own | Members | Phases | Settings (id modules); no First visit tab.
  assert.deepEqual(setupTabs({ owner: true, show: true }), ['show', 'space', 'members', 'phases', 'modules'], 'tab order: Modules, the space, Members, Phases, Settings');
  assert.deepEqual(setupTabs({ owner: true }), ['space', 'members', 'phases', 'modules']);
  assert.ok(!setupTabs({ owner: true, show: true }).includes('opens-with'), 'no First visit tab: it is a section of Settings');
  assert.deepEqual(setupTabs({ owner: true, moderator: true }), ['space', 'members', 'phases', 'modules'], 'an owner who is also ticked moderator sees everything');
  assert.deepEqual(setupTabs({ moderator: true }), ['phases', 'modules'], 'what the server lets a moderator PATCH (phases, opensWith, defaultLayout): Settings holds First visit and the module settings');
  assert.deepEqual(setupTabs({ owner: true, phases: false }), ['space', 'members', 'modules'], 'no phases in the template: no Phases tab');
  assert.deepEqual(setupTabs({ moderator: true, phases: false }), ['modules'], 'a moderator always has Settings: First visit is in it');
  assert.deepEqual(setupTabs({}), [], 'a member has no panel');
  assert.equal(tabOfField('aiOff'), 'modules');
  assert.equal(tabOfField('module:todo'), 'modules', 'a module\'s settings live on the Settings tab');
  assert.equal(tabOfField('opensWith'), 'modules', 'First visit is a section of the Settings tab');
  assert.equal(tabOfField('defaultLayout'), 'modules');
  assert.equal(tabOfField('phases'), 'phases');
  assert.deepEqual([...MODERATOR_FIELDS], ['phases', 'opensWith', 'defaultLayout', 'budget'], 'the server\'s MODERATOR_SPACE_FIELDS');
  const owner = setupTabs({ owner: true });
  assert.equal(pickTab(owner, '#members'), 'members', 'the fragment picks the tab');
  assert.equal(pickTab(owner, '#modules'), 'modules', 'the old page\'s #modules lands on the Settings tab');
  assert.equal(pickTab(owner, '#space'), 'space', 'and #space on the space tab');
  assert.equal(pickTab(setupTabs({ owner: true, phases: false }), '#phases'), 'space', 'a tab left out: the first tab');
  assert.equal(pickTab(owner, '#join=abcd'), 'space', 'an unknown fragment: the first tab, never an error');
  assert.equal(pickTab(owner, ''), 'space');
  assert.equal(pickTab(setupTabs({ moderator: true }), '#members'), 'phases', 'a tab the person may not see: their first');
  // Opening by address (step 6): /?setup=<id>#<tab>.
  assert.deepEqual(setupAddress('?setup=abcd1234', '#members'), { id: 'abcd1234', tab: 'members' });
  assert.deepEqual(setupAddress('?setup=lobby', ''), { id: 'lobby', tab: '' });
  assert.deepEqual(setupAddress('?from=space&setup=abcd1234', '#nonsense'), { id: 'abcd1234', tab: 'nonsense' }, 'an unknown fragment is pickTab\'s to fall back from');
  assert.equal(setupAddress('', '#members'), null, 'no ?setup: nothing to open');
  assert.equal(setupAddress('?setup=', ''), null);
  assert.equal(setupAddress('?setup=../x', ''), null, 'only an id');
  assert.equal(pickTab(owner, `#${setupAddress('?setup=abcd1234', '#nonsense').tab}`), 'space', 'an unknown fragment: the first tab');
  const initFn = space.slice(space.indexOf('async function init() {'));
  assert.match(initFn, /const setupAsked = setupAddress\(location\.search, location\.hash\);[\s\S]*?if \(setupAsked\) \{\n\s*const rest = new URLSearchParams\(location\.search\);\n\s*rest\.delete\('setup'\);[^\n]*\n[^\n]*\n\s*openSetupFor\(setupAsked\.id, setupAsked\.tab\);\n\s*\} else if \(invited\) \{/, 'the address opens it once; a reload does not, and the remembered space is not entered instead');
  const openFor = space.slice(space.indexOf('async function openSetupFor('), space.indexOf('// After Save:'));
  assert.match(openFor, /await joinInvitedSpace\(id\);\n\s*if \(entered && currentSpace\?\.id === id && canSetUp\(\)\) enterSetup\(\{ tab: hash \}\);/, 'enters the space (not the call); the panel only for whoever may set up');
  assert.match(space, /else if \(action === 'setup'\) openSetupFor\(id, event\.detail\.tab \|\| ''\);/, 'Manage over a call asks the space page underneath');
  const adminJs = fs.readFileSync(path.join(ROOT, 'public/admin.js'), 'utf8');
  assert.match(adminJs, /const setupHref = \(id\) => `\/\?setup=\$\{encodeURIComponent\(id\)\}`;/);
  assert.match(adminJs, /const edit = row\.querySelector\('\[data-action="edit"\]'\);\n\s*edit\.hidden = space\.isLobby;\n\s*edit\.href = setupHref\(space\.id\);/, 'Manage\'s Edit link (hidden for Home, set up for every other space)');
  assert.match(adminJs, /openSetup\(space\.id\); \/\/ into the new space with Set up open/, 'and its jump after making a space');
  assert.ok(!/`\/spaces\/\$\{/.test(adminJs), 'Manage no longer links to the old page');
  const setup = fs.readFileSync(path.join(ROOT, 'public/space-setup.js'), 'utf8');
  // The tab row and the panels: role="tablist", a tab per id with aria-controls, the dot and its words for a reader.
  assert.match(setup, /class="setup-tabs setup-tabs-fit" id="setup-tabs" role="tablist"/);
  assert.match(setup, /id="setup-tabs-more" data-tip="More tabs" aria-label="More tabs" aria-haspopup="menu" aria-expanded="false" hidden/, "tabs that do not fit go into a ... (More) menu");
  assert.match(setup, /fitTabs\(\); \/\/ the tab shown never stays in the "..."/);
  assert.match(setup, /const TAB_HTML = \{ show:/, "the Modules tab (id show) is the first tab of Set up");
  assert.match(setup, /role="tab" class="setup-tab" id="setup-tab-\$\{id\}" data-tab="\$\{id\}" aria-controls="setup-content-\$\{id\}"/);
  assert.match(setup, /role="tabpanel" class="setup-tab-content" id="setup-content-\$\{id\}"/);
  assert.match(setup, /<span class="setup-tab-dot" aria-hidden="true" hidden><\/span><span class="visually-hidden setup-tab-unsaved"><\/span>/);
  assert.match(setup, /textContent = on \? ', unsaved changes' : '';/, 'the dot is said to a screen reader');
  assert.match(setup, /ArrowRight: at \+ 1, ArrowLeft: at - 1, Home: 0, End: all\.length - 1/, 'the arrows move between tabs');
  assert.equal(configurationLabel((k, o) => (k === 'aside' ? 'whisper' : 'campaign').replace(/^./, (c) => (o && o.cap ? c.toUpperCase() : c))), 'Campaign Configuration', 'the space word');
  assert.equal(configurationLabel((k, o) => (k === 'aside' ? 'whisper' : 'campaign').replace(/^./, (c) => (o && o.cap ? c.toUpperCase() : c)), true), 'Whisper Configuration', 'the aside\'s word in an aside');
  assert.match(setup, /<h2 id="space-setup-title">\$\{esc\(one \? tabLabel\(tabs\[0\]\) : configLabel\(\)\)\}<\/h2>/, 'the panel\'s title is the button\'s name; a person with only the Modules tab sees "Modules"');
  assert.match(setup, /aria-label="\$\{esc\(configLabel\(\)\)\}"/, 'the tab row is named the same');
  assert.match(setup, /show: modulesWord\(true\), space: word\('space', \{ cap: true \}\), members: membersWord\(true\), phases: 'Phases', modules: 'Settings' \}\)\[id\]/, 'tab labels: Modules and the space and Members in the environment\'s words, Phases, Settings');
  assert.ok(!/setup-full|Full settings/.test(setup), 'the panel\'s Full settings link is gone (step 6)');
  assert.match(setup, /discardWords: 'Discard your changes\?',/, 'Escape and Cancel ask host.ui.editor\'s question');
  // The space tab (step 2) and the members tab (step 3).
  for (const id of ['setup-picture-file', 'setup-name', 'setup-description', 'setup-profile', 'setup-link', 'setup-link-icon', 'setup-publish-calendar', 'setup-delete', 'setup-delete-confirm', 'setup-members', 'setup-allow-guests', 'setup-make-invite', 'setup-guest-link-on', 'setup-guest-link-new', 'setup-guest-link-off', 'setup-guest-link-copy']) {
    assert.match(setup, new RegExp(`id="${id}"`), `the panel has #${id}`);
  }
  assert.match(setup, /if \(!space\.isLobby\) \{\n\s*parts\.push\(sectionHtml\('calendar'/, 'the Lobby has no calendar switch and no Delete');
  assert.match(setup, /\$\{id === 'space' && !space\.isLobby \? dangerSectionHtml\(\) : ''\}<\/div>`/, 'Delete is drawn last on the space tab, after the budget section, and not on the Lobby');
  assert.ok(setup.indexOf("${id === budgetTabOf(tabs) && !space.isLobby ? budgetSectionHtml() : ''}${id === 'space'") > 0, 'Budget comes before Delete');
  assert.ok(!/parts\.push\(sectionHtml\('danger'/.test(setup), 'spaceTabHtml no longer puts Delete in the middle');
  assert.match(setup, /space\.isLobby\n\s*\? `<p class="hint">Everyone belongs to the/, 'the Lobby has no member switches');
  assert.match(setup, /Delete \$\{state\.space\.name\}\? Its \$\{membersWord\(\)\} stay in the Lobby\./, 'Delete\'s question names the space');
  assert.match(setup, />Delete<\/button>\n\s*<button type="button" class="btn btn-small" id="setup-delete-keep">Keep<\/button>/);
  assert.match(setup, /Happens at once; it does not wait for Save\./);
  assert.match(setup, /These work at once; they are not part of Save\./, 'the invite and the guest link say they are actions');
  assert.ok(!/setup-people|#\$\{PEOPLE_TAB\}|PEOPLE_TAB/.test(setup), 'the link to the page\'s Members tab is gone');
  assert.ok(!/addEventListener\('change', async/.test(setup), 'nothing in the panel saves as it is clicked');
  assert.match(setup, /state\.links = \{ guestToken: answer\.space\.guestToken \|\| null, allowGuests: answer\.space\.allowGuests !== false \};/, 'the guest link reads the record the in-space controls read');
  assert.match(space, /onLinks: \(\) => loadPresence\(\)\.then\(\(\) => renderGuestLink\(\)\),/, 'and the in-space controls follow the panel');
  assert.match(space, /function setupDeleted\(space\) \{\n\s*forgetSpace\(\);\n\s*if \(entered\) leaveSpaceNow\(\);/, 'after Delete: Home, and a reload does not try it');
  assert.ok(!/conference character/i.test(setup), 'the panel never says "conference character"');
  assert.ok(!/switchRowHtml\([^)]*'module'\)|data-module-switch|\{ spaces \}/.test(setup), 'no module switches: availability per space was removed (an enabled module is on in every space)');
  // Phases inline (step 4): the sheet's rows, every edit through the rule, a draft in the one PATCH.
  for (const id of ['setup-phase-list', 'setup-phase-first', 'setup-phase-first-day', 'setup-phase-first-go', 'setup-phases-status', 'setup-opens-with-layout', 'setup-opens-with-layout-stop', 'setup-ai-off', 'setup-module-settings']) {
    assert.match(setup, new RegExp(`id="${id}"`), `the panel has #${id}`);
  }
  assert.match(setup, /state\.rule\.setPhaseDate\(state\.phaseList, state\.draft\.phases, id, edge, day, \{ created \}\)/);
  assert.match(setup, /state\.rule\.skipPhase\(state\.phaseList, state\.draft\.phases, id,/);
  assert.match(setup, /state\.rule\.addDatesFor\(state\.phaseList, state\.draft\.phases, id,/);
  assert.match(setup, /const rows = rowsOf\(bands, \{ rule: R \}\);/, 'the sheet\'s rows');
  assert.match(setup, /state\.draft\.phases = answer\.dates;/, 'an edit kept is the draft, sent by Save');
  assert.match(space, /phases: templatePhases, \/\/ drawn inline/);
  assert.match(space, /phaseChip\.addEventListener\('click', \(\) => openPhaseSheetFrom\(phaseChip\)\);/, 'the chip\'s sheet is unchanged');
  // First visit complete: the kept ids said why (the old page's notes), and Stop using it for a default layout, a draft.
  assert.match(setup, /if \(!m\) return \{ id, name: id, icon: 'puzzle-piece', note: 'not installed' \};/);
  assert.match(setup, /if \(!m\.enabled\) return \{ \.\.\.shown, note: 'turned off' \};/);
  assert.match(setup, /note: `can't open on the \$\{word\('canvas'\)\}`/);
  assert.match(setup, /`Opens with the layout \$\{known\.name\}`/);
  assert.match(setup, /function stopUsingLayout\(\) \{\n\s*state\.draft\.defaultLayout = null;/, 'Stop using it is a draft, as every field is');
  // The modules tab (step 5): what is on, Turn AI off (an owner's space field), the module settings in the draft mode.
  assert.ok(!/dropTab/.test(setup), 'Settings is never dropped: the First visit section is always in it');
  assert.match(setup, /aiSection\.hidden = !ai \|\| !ai\.active \|\| ai\.active\.provider === 'none';/, 'Turn AI off only with an AI service');
  // First visit (plan-layout-views.md, step 5): one choice, radios of one name in a fieldset named by the heading; the
  // Workspace first with the Opens with switches directly under it, then Calendar and Map from the layouts' `system`
  // list, then the shared layouts; no select, no "Picking one sets Opens with".
  assert.match(setup, /<h3 class="setup-heading" id="setup-first-visit-heading">First visit<\/h3>/);
  assert.match(setup, /<fieldset class="setup-first-visit" id="setup-first-visit" aria-labelledby="setup-first-visit-heading"/);
  assert.match(setup, /<input type="radio" name="setup-first-visit" value="workspace" id="setup-first-workspace">[\s\S]*?<div class="setup-workspace-content">[\s\S]*?id="setup-opens-with" role="group"[\s\S]*?<\/div>\n\s*<div class="setup-first-layouts" id="setup-first-visit-layouts"><\/div>/, 'the switches between the Workspace and the other choices');
  assert.match(setup, /system\.filter\(\(l\) => l\.id === 'calendar' \|\| l\.id === 'map'\)/, 'Calendar and Map only while the payload lists them');
  assert.match(setup, /\.\.\.shared\.map\(\(l\) => \(\{ id: l\.id, name: l\.name,/, 'the shared layouts by name');
  assert.match(setup, /state\.draft\.defaultLayout = event\.target\.value === 'workspace' \? null : event\.target\.value; \/\/ Opens with stays as it is/);
  assert.match(setup, /state\.draft\.opensWith = ticked\.length \? ticked : null; \/\/ the first visit's choice stays as it is\n\s*paintOpensWith\(\);/, 'a switch never touches the layout');
  assert.ok(!/Picking one sets Opens with|id="setup-layout"|picked\.modules\.map/.test(setup), 'the old drop-the-list wording and behaviour are gone');
  assert.ok(!/state\.draft\.opensWith = [^;\n]*modules/.test(setup), 'picking a layout never writes Opens with');
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  assert.match(css, /\.setup-first-visit \{[^}]*border: 0;/);
  assert.match(css, /\.setup-choice:has\(input:focus-visible\) \{[^}]*outline: 2px solid var\(--accent\);/, 'the keyboard ring on the row');
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*?#setup-opens-with-layout-stop,\n\s*\.setup-choice \{\n\s*min-height: 44px;/, 'a 44px row on a phone');
  assert.match(css, /\.space-setup \.phase-row \{\n\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);\n\s*grid-template-areas: "name name" "start end" "days tools" "problem problem";/, 'the rows as cards in the narrow panel');
  assert.match(css, /\.setup-status \{\n\s*margin: 8px 0 0;/, 'the refusal line stands clear of the last hint');
});

test('Set up: one PATCH of what changed; the first visit\'s layout and Opens with are independent, each sent only when it changed', () => {
  const before = { name: 'Lisbon', profile: 'participants', opensWith: ['chat', 'todo'], defaultLayout: null };
  assert.deepEqual(setupPatch(before, { ...before }), {});
  assert.deepEqual(setupPatch(before, { ...before, name: '  Porto ' }), { name: 'Porto' }, 'trimmed');
  assert.deepEqual(setupPatch(before, { ...before, name: '   ' }), {}, 'an empty name is no change');
  assert.deepEqual(setupPatch(before, { ...before, profile: 'characters' }), { profile: 'characters' });
  assert.deepEqual(setupPatch(before, { ...before, opensWith: ['todo', 'chat'] }), { opensWith: ['todo', 'chat'] }, 'the order counts');
  assert.deepEqual(setupPatch(before, { ...before, opensWith: null }), { opensWith: null }, 'every switch off: not set');
  assert.deepEqual(setupPatch(before, { ...before, opensWith: [] }), { opensWith: null }, 'an empty list is not set too');
  assert.deepEqual(setupPatch(before, { ...before, defaultLayout: 'l1' }), { defaultLayout: 'l1' }, 'a layout picked goes alone: Opens with is not touched');
  assert.deepEqual(setupPatch(before, { ...before, defaultLayout: 'calendar' }), { defaultLayout: 'calendar' }, 'Calendar');
  assert.deepEqual(setupPatch(before, { ...before, defaultLayout: 'map' }), { defaultLayout: 'map' }, 'Map');
  assert.deepEqual(setupPatch(before, { ...before, defaultLayout: 'l1', opensWith: ['calendar'] }), { defaultLayout: 'l1', opensWith: ['calendar'] }, 'both changed: both go, each as it is');
  assert.deepEqual(setupPatch(before, { ...before, defaultLayout: 'workspace' }), {}, 'the Workspace is no layout: no change from none');
  const withLayout = { ...before, defaultLayout: 'l1' };
  assert.deepEqual(setupPatch(withLayout, { ...withLayout, defaultLayout: null }), { defaultLayout: null }, 'back to the Workspace, the list kept');
  assert.deepEqual(setupPatch(withLayout, { ...withLayout, defaultLayout: 'workspace' }), { defaultLayout: null }, 'the Workspace picked goes as null');
  assert.deepEqual(setupPatch(withLayout, { ...withLayout, opensWith: ['chat'] }), { opensWith: ['chat'] }, 'a changed list leaves the layout');
  assert.deepEqual(setupPatch(withLayout, { ...withLayout, opensWith: null }), { opensWith: null }, 'every switch off leaves the layout too');
  assert.deepEqual(setupPatch(withLayout, { ...withLayout, defaultLayout: 'map' }), { defaultLayout: 'map' }, 'one layout for another');
  assert.deepEqual(setupPatch(withLayout, { ...withLayout }), {}, 'the same layout again is no change');
  assert.deepEqual(setupPatch(before, { name: 'Porto' }), { name: 'Porto' }, 'fields left out of the draft are unchanged');
  assert.deepEqual(setupPatch({ name: 'A' }, { name: 'A', profile: 'participants', opensWith: null, defaultLayout: null }), {}, 'a space with nothing set, a draft saying so');
});

test('Set up: the budget (#216) goes in the one PATCH only when it changed, as null, { currency } or { amount, currency? }; on the phases tab (the moderator too); a refusal names it', () => {
  const none = { name: 'Lisbon', budget: { amount: '', currency: '' } };
  assert.deepEqual(setupPatch(none, { ...none }), {}, 'none before, none now');
  assert.deepEqual(setupPatch(none, { ...none, budget: { amount: '4000', currency: '' } }), { budget: { amount: 4000 } }, 'an amount: no currency is the module\'s own');
  assert.deepEqual(setupPatch(none, { ...none, budget: { amount: '4000', currency: 'EUR' } }), { budget: { amount: 4000, currency: 'EUR' } });
  const set = { name: 'Lisbon', budget: { amount: '4000', currency: '' } };
  assert.deepEqual(setupPatch(set, { ...set, budget: { amount: '4000.00', currency: '' } }), {}, 'the same amount written another way is no change');
  assert.deepEqual(setupPatch(set, { ...set, budget: { amount: '', currency: 'EUR' } }), { budget: { currency: 'EUR' } }, 'the amount emptied, a currency chosen: the currency alone, no amount');
  assert.deepEqual(setupPatch(set, { ...set, budget: { amount: '', currency: '' } }), { budget: null }, 'both empty: cleared');
  assert.deepEqual(setupPatch(set, { ...set, budget: { amount: '4000', currency: 'EUR' } }), { budget: { amount: 4000, currency: 'EUR' } }, 'a changed currency goes with the stored amount (a currency alone would replace the target)');
  const onlyCurrency = { name: 'Lisbon', budget: { amount: '', currency: 'EUR' } };
  assert.deepEqual(setupPatch(onlyCurrency, { ...onlyCurrency }), {}, 'a stored currency alone is no change');
  assert.deepEqual(setupPatch(onlyCurrency, { ...onlyCurrency, budget: { amount: '', currency: '' } }), { budget: null }, 'and clearing it clears');
  assert.deepEqual(setupPatch(onlyCurrency, { ...onlyCurrency, budget: { amount: '5', currency: 'EUR' } }), { budget: { amount: 5, currency: 'EUR' } });
  assert.deepEqual(setupPatch(set, { ...set, budget: { amount: 'lots', currency: '' } }), { budget: { amount: null } }, 'not a number: sent so the server says why');
  assert.deepEqual(setupPatch({ name: 'Lisbon' }, { name: 'Lisbon' }), {}, 'a draft without the field is no change');
  assert.deepEqual([...dirtyTabs({ budget: null })], ['phases'], 'the phases tab\'s');
  assert.deepEqual([...dirtyTabs({ budget: null }, { tabs: ['phases', 'modules'] })], ['phases']);
  assert.deepEqual([...dirtyTabs({ budget: null }, { tabs: ['space', 'members', 'modules'] })], ['space'], 'no phases in the template: an owner\'s space tab');
  assert.deepEqual([...dirtyTabs({ budget: null }, { tabs: ['modules'] })], ['modules'], 'and a moderator\'s Settings tab');
  assert.equal(tabOfField('budget'), 'phases');
  assert.equal(tabOfField('budget', ['modules']), 'modules');
  assert.ok(setupTabs({ moderator: true }).includes(tabOfField('budget', setupTabs({ moderator: true }))), 'a tab a moderator has');
  assert.equal(problemField({ name: 'P', budget: { amount: 0 } }, 'The budget must be an amount above zero.'), 'budget');
  assert.equal(problemField({ link: 'x', budget: { amount: 5, currency: 'QQQ' } }, 'QQQ is not a currency this server knows. Choose one from the list, such as USD.'), 'budget');
  assert.ok(MODERATOR_FIELDS.includes('budget'), 'a moderator\'s field (plan-budget-module.md, decision 5)');
  assert.equal(setupSaidWords({ saved: ['budget'] }), 'Saved the budget. Everyone sees it now; press Set up to change more.');
  const setup = fs.readFileSync(path.join(ROOT, 'public/space-setup.js'), 'utf8');
  assert.match(setup, /return sectionHtml\('budget', [^\n]*\n(?:[^\n]*\n){4}\s*<p class="hint" id="setup-budget-hint"><\/p>`, \{ hidden: true \}\);/, 'drawn hidden, shown once it is known a module reads it or one is set');
  assert.match(setup, /if \(show && state\.ownerPartsIn\) section\.hidden = false;/, 'shown only after the space\'s own record (the stored budget) has come');
  assert.match(setup, /<input type="number" id="setup-budget-amount"/, 'a number field');
  assert.match(setup, /<select id="setup-budget-currency"><\/select>/, 'and the currency');
  assert.match(setup, /id === budgetTabOf\(tabs\) && !space\.isLobby \? budgetSectionHtml\(\)/, 'drawn on the tab budgetTabOf names');
  assert.match(setup, /else if \(opts\.moderator && !space\.isLobby\) loadModeratorParts\(space\);/, 'a moderator reads the stored target from their own answer');
  assert.ok(!/const entry = state\.owner/.test(setup), 'a moderator\'s unreadable entry is refused too');
  const page = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  assert.match(page, /budget: budgetReported\(\) \? budgetSource\(\) : null,/, 'the page offers it while a module here reports a fact marked budget');
  assert.match(page, /if \(settingUp && budgetReported\(\)\) spaceSetup\.offerBudget\(budgetSource\(\)\);/, 'and when the facts come after Set up opened (by address)');
});

test('Set up: a budget the field cannot read is refused before anything is sent; only an empty field clears it (#216)', () => {
  // A number field holding `12-3` or `1e` reports '' with validity.badInput: the draft keeps `bad`, never "empty".
  const set = { name: 'Lisbon', budget: { amount: '4000', currency: '' } };
  assert.equal(budgetEntryProblem({ amount: '', currency: '', bad: true }), BUDGET_NOT_A_NUMBER, 'a bad entry (12-3, 1e) is refused');
  assert.equal(budgetEntryProblem({ amount: '1e999', currency: '' }), BUDGET_NOT_A_NUMBER, 'a number too big to be finite');
  assert.equal(budgetEntryProblem({ amount: 'Infinity', currency: '' }), BUDGET_NOT_A_NUMBER);
  assert.equal(budgetEntryProblem({ amount: '', currency: '' }), null, 'empty is fine: no budget');
  assert.equal(budgetEntryProblem({ amount: '4000.50', currency: 'EUR' }), null, 'a number is fine');
  assert.match(BUDGET_NOT_A_NUMBER, /^The budget must be a number[^\n]*\.$/, 'one plain sentence');
  assert.deepEqual(setupPatch(set, { ...set, budget: { amount: '', currency: '', bad: true } }), { budget: { amount: null } }, 'were it ever sent, a bad entry goes as no amount (refused by the server), never as null (which clears)');
  assert.notDeepEqual(setupPatch(set, { ...set, budget: { amount: '', currency: '', bad: true } }), { budget: null });
  assert.deepEqual(setupPatch(set, { ...set, budget: { amount: '', currency: '' } }), { budget: null }, 'only a truly empty field clears');
  assert.deepEqual([...dirtyTabs(setupPatch({ name: 'L', budget: { amount: '', currency: '' } }, { name: 'L', budget: { amount: '', currency: '', bad: true } }))], ['phases'], 'a bad entry is a change, so Save is offered and refuses it');
  const setup = fs.readFileSync(path.join(ROOT, 'public/space-setup.js'), 'utf8');
  assert.match(setup, /const bad = Boolean\(budgetAmount\.validity && budgetAmount\.validity\.badInput\);/, 'the field\'s badInput is read on each edit');
  const done = setup.slice(setup.indexOf('async function done()'), setup.indexOf('const patch = patchNow();', setup.indexOf('async function done()')));
  assert.match(done, /if \(entry\) return refused\(\[\], 'budget', entry\);/, 'refused before the PATCH: the panel stays on the field, the cursor in it');
  assert.equal(problemField({ budget: { amount: null } }, BUDGET_NOT_A_NUMBER), 'budget');
  assert.equal(setupSaidWords({ saved: [], failed: 'budget', problem: BUDGET_NOT_A_NUMBER }), `The budget was not saved. ${BUDGET_NOT_A_NUMBER} Change it and press Save again, or Cancel.`);
});

test('Set up: the Budget section shows while a module that reads the target is on, a fact asked for it, or one is set; never in the Lobby (#216)', () => {
  const planner = { id: 'travel', name: 'Planner', displayName: 'Trip plan', enabled: true, scope: ['environment', 'space'], budget: true };
  assert.deepEqual(budgetWanted({ installed: [planner] }), { show: true, name: 'Trip plan' }, 'the Planner is on: shown before anyone opened it, named after it');
  assert.deepEqual(budgetWanted({ installed: [{ ...planner, enabled: false }] }), { show: false, name: '' }, 'turned off: not offered');
  assert.deepEqual(budgetWanted({ installed: [{ ...planner, budget: false }] }), { show: false, name: '' }, 'a module without the marker');
  assert.deepEqual(budgetWanted({ reported: { name: 'Planner' } }), { show: true, name: 'Planner' }, 'a fact marked budget');
  assert.deepEqual(budgetWanted({ stored: { amount: 4000 } }), { show: true, name: '' }, 'one is set');
  assert.deepEqual(budgetWanted({ stored: { currency: 'EUR' } }), { show: true, name: '' }, 'a currency alone counts as set');
  const listed = { id: 'travel', name: 'Planner', scope: ['space'], budget: true };
  assert.deepEqual(budgetWanted({ installed: [listed] }), { show: true, name: 'Planner' }, 'a moderator\'s list (for-space) carries no enabled flag: it lists enabled modules only');
  assert.deepEqual(budgetWanted({ lobby: true, installed: [planner], stored: { amount: 1 } }), { show: false, name: '' }, 'never the Lobby');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules/travel/module.json'), 'utf8'));
  assert.equal(manifest.budget, true, 'the Planner\'s manifest says it reads the budget');
  assert.match(fs.readFileSync(path.join(ROOT, 'server/modules.js'), 'utf8'), /const budget = raw\.budget === true;/, 'and the manifest keeps the mark');
});

test('Set up: the new fields go in the one PATCH only when changed; the dots name the tabs; a refusal names its field', () => {
  const before = { name: 'Lisbon', description: 'Sun', profile: 'participants', link: '', linkIcon: 'link', publishCalendar: true, members: ['a', 'b'], allowGuests: true, opensWith: null, defaultLayout: null };
  assert.deepEqual(setupPatch(before, { ...before, members: ['b', 'a'] }), {}, 'the members are a set');
  assert.deepEqual(setupPatch(before, { ...before, members: ['a'] }), { members: ['a'] });
  assert.deepEqual(setupPatch(before, { ...before, description: ' Sun ' }), {}, 'the description is trimmed');
  assert.deepEqual(setupPatch(before, { ...before, description: '' }), { description: '' }, 'an empty description is a change');
  assert.deepEqual(setupPatch(before, { ...before, link: ' https://x.example ' }), { link: 'https://x.example' });
  assert.deepEqual(setupPatch({ ...before, link: 'https://x.example' }, { ...before, link: '' }), { link: '' }, 'no link: sent empty');
  assert.deepEqual(setupPatch(before, { ...before, linkIcon: 'dice' }), { linkIcon: 'dice' });
  assert.deepEqual(setupPatch(before, { ...before, publishCalendar: false }), { publishCalendar: false });
  assert.deepEqual(setupPatch({ ...before, publishCalendar: undefined }, { ...before, publishCalendar: true }), {}, 'in the calendar unless false');
  assert.deepEqual(setupPatch(before, { ...before, allowGuests: false }), { allowGuests: false });
  assert.deepEqual([...dirtyTabs(setupPatch(before, { ...before, name: 'Porto', allowGuests: false }))].sort(), ['members', 'space'], 'two tabs, two dots');
  assert.deepEqual([...dirtyTabs({ opensWith: ['chat'] })], ['modules'], 'First visit changes mark the Settings tab');
  assert.deepEqual([...dirtyTabs({ defaultLayout: 'map' })], ['modules']);
  assert.deepEqual([...dirtyTabs({}, { image: true })], ['space'], 'a picture chosen is the space tab\'s');
  assert.deepEqual([...dirtyTabs({})], []);
  assert.equal(problemField({ name: 'P', link: 'ftp://x' }, 'link must be a valid http(s) URL'), 'link');
  assert.equal(problemField({ linkIcon: 'x', link: 'https://x' }, 'unknown link icon'), 'linkIcon', 'the icon before the link');
  assert.equal(problemField({ name: 'P', defaultLayout: 'map' }, 'Map is not on in this space, so it can\'t be the first visit.'), 'defaultLayout');
  assert.equal(problemField({ name: 'P', members: [] }, 'owners only'), 'name', 'no field named: the first');
  // Step 4: the phase dates, whole, only when a start or end changed; step 5: Turn AI off and the module settings.
  const dated = { ...before, phases: { arrive: { start: '2026-10-01' }, stay: { start: '2026-10-05', end: '2026-10-09' } } };
  assert.deepEqual(setupPatch(dated, { ...dated, phases: { stay: { end: '2026-10-09', start: '2026-10-05' }, arrive: { start: '2026-10-01' } } }), {}, 'the order of the keys is no change');
  assert.deepEqual(setupPatch(dated, { ...dated, phases: { arrive: { start: '2026-10-02' }, stay: { start: '2026-10-05', end: '2026-10-09' } } }), { phases: { arrive: { start: '2026-10-02' }, stay: { start: '2026-10-05', end: '2026-10-09' } } }, 'one date moved: the whole set goes');
  assert.deepEqual(setupPatch(before, { ...before, phases: {} }), {}, 'none before, none now');
  assert.deepEqual(setupPatch(before, { ...before, aiOff: true }), { aiOff: true });
  assert.deepEqual(setupPatch({ ...before, aiOff: true }, { ...before, aiOff: true }), {});
  assert.deepEqual([...dirtyTabs({ phases: {} })], ['phases']);
  assert.deepEqual([...dirtyTabs({ aiOff: true })], ['modules']);
  // A partial save: the PATCH went through with a link the server normalized, then the picture was refused. The draft
  // takes the server's answer for what the PATCH sent, so only the refused step stays dirty and the next Save does
  // not send the link again; a full save leaves nothing dirty.
  const typed = { ...before, link: 'https://example.com', description: 'Sun and sea', members: ['a'] };
  const sent = setupPatch(before, typed);
  assert.deepEqual(sent, { link: 'https://example.com', description: 'Sun and sea', members: ['a'] });
  const answer = { ...before, link: 'https://example.com/', description: 'Sun and sea', members: ['a'] };
  const after = takeSaved(before, typed, Object.keys(sent), answer);
  assert.deepEqual(setupPatch(after.before, after.draft), {}, 'the normalized link is no change');
  assert.deepEqual([...dirtyTabs(setupPatch(after.before, after.draft))], [], 'no dot after the save');
  assert.deepEqual([...dirtyTabs(setupPatch(after.before, after.draft), { image: true })], ['space'], 'the refused picture keeps its dot');
  assert.equal(after.draft.link, 'https://example.com/');
  assert.notEqual(after.draft.members, answer.members, 'a copy, not the answer\'s list');
  // A field the PATCH did not send keeps the draft's value (a moderator's draft holds no owner field to send).
  const kept = takeSaved(before, { ...typed }, ['description'], answer);
  assert.deepEqual(setupPatch(kept.before, kept.draft), { link: 'https://example.com', members: ['a'] }, 'only what was sent is taken');
  assert.deepEqual([...dirtyTabs({}, { modules: true })], ['modules'], 'a module\'s settings changed: the modules tab\'s dot');
  assert.equal(problemField({ name: 'P', aiOff: true }, 'AI is turned off'), 'aiOff');
  assert.equal(problemField({ name: 'P', phases: {} }, 'Stay must start after Arrive starts, 2026-10-01.'), 'phases');
  assert.equal(setupSaidWords({ saved: ['phases', 'module:todo'] }, { words: { 'module:todo': 'the To-do settings' } }), 'Saved the phase dates and the To-do settings. Everyone sees it now; press Set up to change more.');
  assert.equal(setupSaidWords({ saved: ['name'], failed: 'module:maps', problem: 'Map files: there is no file called x' }, { words: { 'module:maps': 'the Maps settings' } }), 'The Maps settings were not saved. Map files: there is no file called x. The name was saved. Change it and press Save again, or Cancel.', 'a module refused after the space saved');
});

test('Set up: the line after Save says what was saved and what to do next', () => {
  assert.equal(setupSaidWords({ saved: [] }), 'Nothing changed. Press Set up to change something.');
  assert.equal(setupSaidWords({ saved: ['name'] }), 'Saved the name. Everyone sees it now; press Set up to change more.');
  assert.equal(setupSaidWords({ saved: ['name', 'opensWith', 'image'] }), 'Saved the name, Opens with and the picture. Everyone sees it now; press Set up to change more.');
  assert.equal(setupSaidWords({ saved: ['image', 'imageRemoved'] }), 'Saved the picture. Everyone sees it now; press Set up to change more.', 'one field named once');
  assert.equal(setupSaidWords({ saved: [], failed: 'name', problem: 'owners only' }), 'The name was not saved. Owners only. Change it and press Save again, or Cancel.');
  assert.equal(setupSaidWords({ saved: ['name'], failed: 'image', problem: 'too big.' }), 'The picture was not saved. Too big. The name was saved. Change it and press Save again, or Cancel.', 'what went through before stays said');
  assert.equal(setupSaidWords({ saved: [] }, { setUp: 'Einrichten' }), 'Nothing changed. Press Einrichten to change something.', 'the tool\'s own word');
  assert.equal(setupSaidWords({ saved: ['name', 'members'] }, { words: { members: 'the players' } }), 'Saved the name and the players. Everyone sees it now; press Set up to change more.', 'the environment\'s words');
  assert.equal(setupSaidWords({ saved: ['name', 'allowGuests'], failed: 'image', problem: 'not an image' }, { words: { allowGuests: 'Allow Guests' } }), 'The picture was not saved. Not an image. The name and Allow Guests were saved. Change it and press Save again, or Cancel.', 'a refusal after two tabs saved');
});

// The one bar (plan-one-bar.md, decisions 1, 6, 9 and 10, step 7): in a space the top bar's left zone is the space's
// name with the switcher's caret as one control, the layout tabs (plan-layout-views.md: Calendar and Map are layouts,
// their composite on the canvas), then the chip; the right zone Set up, the bell and your picture. The environment's
// Calendar and Map are in the profile menu. A guest's bar is the name alone; an aside's the switcher, Rejoin call and
// your picture.
test('the one bar: the switcher in the Spaces slot\'s place, the layout tabs after it; no view frame, the composite\'s frame keeps the links a view\'s page had', () => {
  const primary = fs.readFileSync(path.join(ROOT, 'public/primary-nav.js'), 'utf8');
  assert.ok(!/export function spaceViews\(/.test(primary), 'spaceViews() is gone (plan-layout-views.md, step 3)');
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  assert.match(space, /nav\.register\(\{ id: 'space-switcher', bar: 'primary', zone: 'left', group: 'where', order: 9\.5, [^\n]*element: spaceSwitcher, visible: \(\) => oneBar\(\) \}\)/, 'the switcher after the Spaces slot (9), before the breadcrumb (10), at every width (step 8: the phone\'s row too)');
  assert.match(space, /const oneBar = \(\) => Boolean\(currentSpace\) && !viewingHome && !guestToken && me\?\.role !== 'guest';/, 'in a space, not home over it, never a guest');
  assert.match(space, /spaceSwitcherButton\.setAttribute\('aria-haspopup', 'menu'\)/);
  assert.match(space, /spaceSwitcherButton\.addEventListener\('click', \(\) => openSpaceSwitcher\(spaceSwitcherButton\)\)/, 'one control: the name and the caret open the switcher');
  assert.match(space, /const text = `\$\{label\}\. Switch \$\{word\('space'\)\}`;/, 'named for a screen reader');
  assert.match(space, /setInSpace\(oneBar\(\)\);/, 'the Spaces slot leaves the bar');
  assert.ok(!/drawViews|app:destinations', \(\) => draw/.test(space), 'no views drawn from the destinations');
  assert.ok(!/view-frame|viewFrame/.test(space), 'nothing reads a view frame');
  assert.equal((space.match(/canvas\.showFloating\(false\)/g) || []).length, 1, 'floating modules hide only for home over the space, never for a tab');
  assert.match(space, /currentLayoutTab = 'workspace'; \/\/ entering a space opens on the Workspace tab \(plan-layout-views\.md\), never the last space's/, 'entering a space shows the Workspace');
  // The links inside the Calendar's or Map's page, which the view frame handled, are the composite frame's now: the page
  // gets the handoff a page over the call gets (?from=space, the names: a page a link leads on to keeps its way back and
  // the switcher's picks reach this page), its home links stay in this page, and its Back returns the frame to the page.
  assert.match(space, /frameParams: \(\) => \(guestMode \? new URLSearchParams\(\) : overlayParams\(\)\),\n\s*onCompositeLoad: \(frame\) => homeLinksIn\(frame\),/);
  const canvasJs = fs.readFileSync(path.join(ROOT, 'public/canvas.js'), 'utf8');
  assert.match(canvasJs, /if \(guestToken\) q\.set\('guest', guestToken\);\n\s*else if \(typeof frameParams === 'function'\) for \(const \[k, v\] of frameParams\(\)\) if \(!q\.has\(k\)\) q\.set\(k, v\);/, 'the composite\'s page gets the handoff, its space kept');
  assert.match(canvasJs, /post\(\{ type: 'app:compositehello' \}\);\n\s*if \(typeof onCompositeLoad === 'function'\) \{ try \{ onCompositeLoad\(frame\); \}/, 'every page that loads in the frame is handed to the space page');
  const homeIn = space.slice(space.indexOf('function homeLinksIn(frame) {'), space.indexOf("$('page-overlay-frame').addEventListener('load'"));
  assert.match(homeIn, /doc = frame\.contentDocument;[\s\S]*if \(event\.target\.closest\?\.\(HOME_LINKS\)\) goHome\(event\);/, 'home inside the frame is home over the space, the call kept');
  assert.match(space, /window\.closeProfileOverlay = \(\) => \{\n\s*if \(!\$\('page-overlay-frame'\)\.hidden\) closeOverlay\(\);\n\s*else backInComposite\(document\.activeElement\);/, 'a Back inside a composite\'s frame goes back to its page');
  assert.match(space, /function backInComposite\(frame\) \{\n\s*if \(!frame \|\| !frame\.matches\?\.\('iframe\[data-composite\]'\)\) return;[^\n]*\n\s*const own = frame\.getAttribute\('src'\);\n\s*if \(own\) frame\.src = own;/);
  assert.match(space, /nav\.register\(\{ id: 'aside-rejoin', bar: 'primary', zone: 'right', group: 'aside', groupOrder: 80, order: 1, [^\n]*labelled: true, visible: \(\) => oneBar\(\) && inAside\(\) && Boolean\(currentSpace\.origin\) && !phoneWidth\(\), onClick: \(\) => returnFromAside\(\) \}\)/, 'an aside\'s bar: Rejoin call before Set up (85), the bell (90) and you');
  assert.match(space, /if \(nav\.isVisible\(nav\.get\('space-switcher'\)\)\) \{\n\s*spaceSwitcher\.replaceChildren\(setupNameInput\);/, 'Set up\'s name input takes the switcher\'s place');
  const html = fs.readFileSync(path.join(ROOT, 'public/space.html'), 'utf8');
  assert.ok(!/view-frame/.test(html), 'no view frame between the column and the canvas');
  assert.match(html, /<\/aside>\n[\s\S]*?<main class="canvas" id="canvas" hidden>/, 'the column, then the canvas');
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  assert.ok(!/\.view-frame/.test(css), 'the canvas never gives its place to a view');
  assert.match(css, /\n\.topbar > \.nav-left > \.space-switcher:not\(\[hidden\]\) ~ \.crumb \{\n\s*display: none;/, 'the breadcrumb is not drawn beside the switcher, at any width (step 8)');
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*?\.topbar \.space-switcher-button \{\n\s*height: auto;\n\s*min-height: 44px;/, 'on a phone the switcher is the row\'s name, a 44px target');
  assert.match(css, /@media \(max-width: 640px\) \{\n\s*\.topbar:has\(> \.sdk-strip:not\(\[hidden\]\)\) \{\n\s*flex-wrap: wrap;/, 'on a phone the strip is a line of the header under the top row');
  assert.match(fs.readFileSync(path.join(ROOT, 'public/sdk/system.css'), 'utf8'), /\.sdk-strip :is\(\.sdk-strip-count, \.sdk-strip-facts\) \{ display: none; \}/, 'on a phone the line is the sentence and the thin line: no days to go, no facts');
  assert.ok(!/\.topbar \.(phase-chip|sdk-strip-phase)/.test(css), 'no rule for a chip in the top row');
  assert.ok(!/\.phase-chip-short/.test(space), 'one sentence at every width: the phone\'s line gives way clause by clause');
  assert.ok(!/\.crumb-here:has\(> \.setup-bar-name\)/.test(css) && !/crumb-here\[aria-current="location"\] \.crumb-label/.test(space), 'Set up\'s input has one place, the switcher, at every width (nothing left in the breadcrumb)');
  assert.match(css, /body\.in-space\.in-aside \.subnav \{\n\s*display: none;/, 'no Workspace toolbar in an aside');
  assert.match(css, /\.topbar\.nav-measuring > \.nav-left \{\n\s*max-width: none;\n\s*width: max-content;/, 'the top bar is measured at its full width as the space bar is');
  const brand = fs.readFileSync(path.join(ROOT, 'public/brand.js'), 'utf8');
  assert.match(brand, /export function setInSpace\(on\) \{\n\s*inSpace = Boolean\(on\);\n\s*nav\.draw\('primary'\);/);
  assert.match(brand, /export async function openSwitcher\(trigger\)/, 'the switcher\'s menu is the one the Spaces slot opens');
  assert.match(brand, /frame\.id === 'page-overlay-frame' \|\| frame\.hasAttribute\('data-composite'\)/, 'a page in a composite\'s frame is within the space page (no other calendars shown over a call), as the view frame\'s was');
});

// Add <space> on Home (GitHub #233): a button in the row above the space cards, for owners and the admin only (the same
// test the top bar's "New <space>" entry makes: hasOwnerRights), never a guest; it makes the space with the request
// Manage's Add button makes (POST /api/spaces, no new route), then enters it and opens Set up.
test('Add <space> on Home: owners and the admin, the existing request, then into the space with Set up open', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/space.html'), 'utf8');
  assert.match(html, /<h2 class="space-list-title" id="space-list-title"><\/h2>\n\s*<\/div>/, 'the row above the cards holds the home word only');
  assert.match(html, /<div class="space-list" id="spaces">[^<]*(<!--[\s\S]*?-->)?\s*<button class="space-choice-add" id="home-add-space" type="button" hidden>[^\n]*<\/button>\n\s*<\/div>/, 'Add <space> is the ghost card inside the grid (hidden until the page knows who is looking)');
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  assert.match(space, /const label = `Add \$\{word\('space', \{ cap: true \}\)\}`;/, 'the button reads Add <Space> in the template\'s word');
  assert.match(space, /button\.hidden = Boolean\(guestMode\) \|\| !hasOwnerRights\(me\);/, 'owners and the admin only, never a guest');
  assert.match(space, /await api\('POST', '\/api\/spaces', \{ name: `\$\{word\('space', \{ cap: true \}\)\} \$\{count\}`, description: '', members: \[\] \}\)/, 'the request Manage\'s Add button makes');
  assert.match(space, /await loadPresence\(\);[^\n]*\n\s*await joinInvitedSpace\(space\.id\);\n\s*if \(entered && currentSpace\?\.id === space\.id\) enterSetup\(\);/, 'then into the new space, and Set up opens once in');
  assert.match(space, /\$\('home-add-space'\)\?\.addEventListener\('click', addSpace\);/);
  const admin = fs.readFileSync(path.join(ROOT, 'public/admin.js'), 'utf8');
  assert.match(admin, /await api\('POST', '\/api\/spaces', \{ name: `\$\{word\('space', \{ cap: true \}\)\} \$\{spaces\.length\}`, description: '', members: \[\] \}\)/, 'Manage\'s own request is unchanged');
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  const sysCss = fs.readFileSync(path.join(ROOT, 'public/sdk/system.css'), 'utf8');
  assert.match(sysCss, /:where\(\.sdk-card-add, \.space-choice-add\) \{[^}]*border: 1px dashed var\(--edge-hairline\);/, 'the ghost card is a dashed hairline (the Cards family in system.css)');
  assert.match(sysCss, /:is\(\.sdk-card-add, \.space-choice-add\):focus-visible/, 'and has a focus outline');
  assert.match(sysCss, /:is\(\.sdk-card-add, \.space-choice-add\):is\(\.sdk-card-add, \.space-choice-add\):hover/, 'and fills softly on hover');
  assert.match(space, /list\.insertBefore\(card, \$\('home-add-space'\)\)/, 'cards go before the ghost card, which stays last');
});

// One nav text (Thomas, 2026-10-14: "we need to be using the same classes for things ... The correct one is the
// Workspace, Calendar, etc."): the --nav-* tokens set once, the .nav-text class (with .core-link, the reference) the one
// rule that reads them, every element tool with words carrying the class, and no rule of those elements restating a
// size or weight of its own. The environment's name (the wordmark) is the one larger word, by Thomas's decision.
test('one nav text: the tokens set once, one rule, every element tool with words wears it, no one-off sizes', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  for (const token of ['--nav-font-size: var(--text-13);', '--nav-font-weight: var(--weight-strong);', '--nav-letter-spacing: normal;', '--nav-line-height: normal;']) {
    assert.equal(css.split(token).length - 1, 1, `${token} set once`);
  }
  assert.match(css, /\n\.nav-text,\n\.btn\.nav-text,\n\.core-link \{\n\s*font-family: inherit;\n\s*font-size: var\(--nav-font-size\);\n\s*font-weight: var\(--nav-font-weight\);\n\s*letter-spacing: var\(--nav-letter-spacing\);\n\s*line-height: var\(--nav-line-height\);\n\}/, 'the one rule: the layout tabs\' type (.core-link) and .nav-text, a labelled button\'s too');
  assert.match(css, /\n\.nav-text:where\(:not\(\.btn\)\),\n\.core-link \{\n\s*color: var\(--icon-bar\);/, 'and the bar\'s link colour at rest');
  // Each element tool with words carries the class where it is made.
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const brand = fs.readFileSync(path.join(ROOT, 'public/brand.js'), 'utf8');
  const people = fs.readFileSync(path.join(ROOT, 'public/space-people.js'), 'utf8');
  const navSrc = fs.readFileSync(path.join(ROOT, 'public/nav-bar.js'), 'utf8');
  assert.match(space, /spaceSwitcherButton\.className = 'core-link space-switcher-button';/, 'the space switcher');
  assert.match(space, /joinCallButton\.className = 'btn btn-small btn-primary join-call nav-text';/, 'Join the call');
  // The status strip's chips and bands are not the nav text: they are the Journey bar family's header chips (13px,
  // weight 500; design system step 30), in system.css.
  assert.ok(!/(phaseChip|statusToGo)\.className = '[^']*nav-text/.test(space), 'the strip\'s chips are header chips');
  assert.match(people, /<button class="who-here-toggle nav-text" id="who-here-toggle"/, 'Who is here');
  assert.match(brand, /whoami\.className = 'whoami nav-text';/, 'your name');
  assert.match(brand, /nameEl\.className = 'page-bar-name nav-text';/, 'a page bar\'s name');
  assert.match(css, /\n\.crumb \{[^}]*font-size: var\(--nav-font-size\);[^}]*font-weight: var\(--nav-font-weight\);/, 'a page\'s anchor on a phone and the separators, by the crumb\'s box');
  assert.match(navSrc, /const LOOK_CLASSES = \{ core: \['core-link'\], labelled: \['btn', 'btn-small', 'nav-text'\], icon: \['icon-link'\] \};/, 'a labelled tool the registry draws, as the core links');
  // No rule on those elements sets a size or weight of its own (the phone's tab bar, inside body.in-space .subnav, and
  // the phone menu's rows are not the bar; the portraits' letters, the caption and icons are not words of the nav).
  const own = /^(font-size|font-weight|font)\s*:/;
  const subject = /(\.core-link|\.nav-text|\.space-switcher-button|\.who-here-toggle|\.who-here-count|button\.whoami|\.whoami\b(?![-\w])|\.join-call|\.page-bar-name|\.page-bar \.subtab|\.crumb-here|\.crumb-label|\.topbar-status)\s*$/;
  const skip = /menu-open|body\.in-space (\.subnav|\.who-here)/;
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const sel of m[1].split(',').map((s) => s.trim().replace(/^\/\*[\s\S]*?\*\/\s*/, ''))) {
      if (!subject.test(sel.replace(/(:[\w-]+(\([^)]*\))?|\[[^\]]*\])+$/, '')) || skip.test(sel)) continue;
      const decls = m[2].split(';').map((d) => d.trim()).filter((d) => own.test(d) && !/var\(--nav-|:\s*inherit$/.test(d));
      if (/^(\.nav-text|\.btn\.nav-text|\.core-link)$/.test(sel)) continue;
      assert.deepEqual(decls, [], `${sel} sets its own type`);
    }
  }
  // The one exception, by Thomas's decision: the environment's name, the wordmark.
  assert.match(css, /the one exception to it in the top bar/, 'the wordmark\'s exception said where it is set');
});

// Thomas's rule: a selected, active, on or current state is shown with a FILL (a theme token), never with an added border,
// outline or ring ("I found ANOTHER button border. Stop adding them."). This reads every stylesheet the pages and the
// bundled modules use and fails on a state rule that declares a border, an outline colour, or an inset or ring shadow,
// other than: the keyboard focus ring (:focus-visible, :focus), a border colour that is the same as the rule's own
// background (the fill covers the border, nothing shows), and the deliberate exceptions listed here, each with its reason.
test('a selected, active, on or current state is a fill: no state rule adds a border, outline or ring', () => {
  const files = ['public/style.css'];
  for (const dir of ['public/sdk', ...fs.readdirSync(path.join(ROOT, 'modules')).map((m) => `modules/${m}/src`)]) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) if (f.endsWith('.css') && !/-lib-/.test(f)) files.push(`${dir}/${f}`);
  }
  // [selector (whole, as written), why it stays]
  const KEEP = [
    ['.pin.selected[data-cat] .pin-body', 'a map marker (the Maps module): a pin is drawn on the map, not a control; its ring is how a marker is picked out on a busy map'],
    ['.pin.selected .pin-body', 'a map marker, as above'],
    ['.pin[data-cat]:not(.selected) .pin-body', 'a map marker\'s own edge at rest, not the selected state'],
  ];
  const STATE = /\.(on|active|selected|current|is-active|is-on|checked|sel|today)(?![\w-])|\.[\w]+-(?:on|active|current|selected)(?![\w-])|\[aria-(?:pressed|selected|checked|current)(?:=["']?(?:true|page|step)["']?)?\]|:checked/;
  const PROP = /^(border|border-(top|right|bottom|left)|border-(top|right|bottom|left)?-?color|outline|outline-color|box-shadow)$/;
  const bad = [];
  for (const rel of files) {
    const css = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const decls = m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]);
      const fill = decls.filter(([k]) => /^background(-color)?$/.test(k)).map(([, v]) => v);
      for (const sel of m[1].split(/,(?![^()]*\))/).map((x) => x.trim().replace(/\s+/g, ' '))) { // a comma inside :is( ) or :not( ) is not a selector break
        if (!STATE.test(sel) || /:focus(-visible|-within)?\b/.test(sel) || KEEP.some(([k]) => k === sel)) continue;
        for (const [k, v] of decls) {
          if (!PROP.test(k)) continue;
          if (/^(0|none|transparent|inherit|initial|unset|currentcolor)(\s|$)/i.test(v)) continue;
          if (k === 'box-shadow' && !/\binset\b|^0 0 0 \d/.test(v)) continue; // a drop shadow or a glow is not a ring
          if (/color$/.test(k) && fill.includes(v)) continue; // the same colour as the fill: nothing shows
          if (k === 'border' && fill.some((f) => v.endsWith(f))) continue;
          bad.push(`${rel}: ${sel} { ${k}: ${v} }`);
        }
      }
    }
  }
  assert.deepEqual(bad, [], `show the state with a fill token, not a border, outline or ring (--selected-bg):\n  ${bad.join('\n  ')}`);
});

const layoutsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-layouts-')); // layouts.js takes the grid arithmetic from /snap-grid.js; the copy reads it beside it
for (const f of ['layouts.js', 'snap-grid.js']) fs.writeFileSync(path.join(layoutsDir, f.replace('.js', '.mjs')), fs.readFileSync(path.join(ROOT, 'public', f), 'utf8').replace(/from '\/([\w-]+)\.js'/g, "from './$1.mjs'"));
const { layoutDiffers } = await import(pathToFileURL(path.join(layoutsDir, 'layouts.mjs')).href);
test('Modified and the temporary tab (layout menu, 2026-11-11): layoutDiffers() compares arrangements; a shown layout that is not pinned gets a temporary tab; Update and who sees it', () => {
  const base = () => ({ arrange: 'dock', snap: { all: false, pitch: 100 }, modules: [{ id: 'chat', mode: 'dock', dockW: 400 }, { id: 'todo', mode: 'dock', dockW: 360 }] });
  assert.equal(layoutDiffers(base(), base()), false, 'equal');
  assert.equal(layoutDiffers(base(), { ...base(), modules: [{ id: 'chat', mode: 'dock', dockW: 401 }, { id: 'todo', mode: 'dock', dockW: 359 }] }), false, 'a width within 2 pixels is noise');
  assert.equal(layoutDiffers(base(), { ...base(), modules: [{ id: 'chat', mode: 'dock', dockW: 460 }, base().modules[1]] }), true, 'resized');
  assert.equal(layoutDiffers(base(), { ...base(), modules: [base().modules[1], base().modules[0]] }), true, 'columns moved');
  assert.equal(layoutDiffers(base(), { ...base(), modules: base().modules.slice(0, 1) }), true, 'a module closed');
  assert.equal(layoutDiffers(base(), { ...base(), modules: [...base().modules, { id: 'maps', mode: 'dock' }] }), true, 'a module opened');
  assert.equal(layoutDiffers(base(), { ...base(), arrange: 'window' }), true, 'the mode changed');
  const win = () => ({ arrange: 'window', modules: [{ id: 'chat', mode: 'float', box: { x: 0.1, y: 0.1, w: 0.3, h: 0.4 } }] });
  assert.equal(layoutDiffers(win(), win()), false, 'a window, equal');
  assert.equal(layoutDiffers(win(), { ...win(), modules: [{ id: 'chat', mode: 'float', box: { x: 0.2, y: 0.1, w: 0.3, h: 0.4 } }] }), true, 'a window moved');
  assert.equal(layoutDiffers(win(), { ...win(), modules: [{ id: 'chat', mode: 'float', box: { x: 0.1, y: 0.1, w: 0.3, h: 0.5 } }] }), true, 'a window resized');
  assert.equal(layoutDiffers(win(), { ...win(), modules: [{ id: 'chat', mode: 'float', box: { x: 0.1004, y: 0.1, w: 0.3, h: 0.4 }, z: 9, scroll: 40, zoom: 2 }] }), false, 'z-order, scroll, zoom and a hair of movement are noise');
  assert.equal(layoutDiffers({ modules: [] }, { modules: [], arrange: 'dock' }), false, 'a blank layout without arrange reads as dock');
  assert.equal(layoutDiffers({ modules: [], arrange: 'window' }, { modules: [], arrange: 'dock' }), true, 'a blank layout in the other mode');
  // The temporary tab: the layout shown, saved, not a favorite; gone once another is shown; a favorite keeps its own tab.
  const system = [{ id: 'workspace', kind: 'system', name: 'Workspace', icon: 'columns', tab: true }];
  const layouts = [{ id: 'la', name: 'A' }, { id: 'lb', name: 'B' }];
  const tabs = layoutTabs({ system, favorites: ['lb'], layouts, current: 'la', space: 'keep' });
  assert.deepEqual(tabs.map((x) => [x.layout, x.temp === true, x.current]), [['workspace', false, false], ['lb', false, false], ['la', true, true]], 'the shown layout, not pinned, is a temporary tab');
  assert.deepEqual(layoutTabs({ system, favorites: ['lb'], layouts, current: 'lb', space: 'keep' }).map((x) => [x.layout, x.temp === true]), [['workspace', false], ['lb', false]], 'a favorite is its own tab, none temporary');
  assert.ok(!layoutTabs({ system, favorites: [], layouts, current: 'gone', space: 'keep' }).some((x) => x.temp), 'an id that is not a layout makes no tab');
  assert.deepEqual(layoutTabs({ system, layouts, current: 'la', guest: true, space: 'keep' }).map((x) => x.temp === true), [false, false, false], 'a guest sees every shared layout as a tab, none temporary');
  // The code: Update is a PUT of the canvas, with the toast; Modified is computed once a frame from persist(); a guest has no baseline;
  // the mark shows Update only where the layouts routes let this person change the layout.
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const canvasJs = fs.readFileSync(path.join(ROOT, 'public/canvas.js'), 'utf8');
  assert.match(space, /await layoutRequest\('PUT', layoutUrl\(id, layoutId\), captured\);\n\s*layoutBase = captured;\n\s*layoutNote\(`Updated \$\{layout\.name\}\.`\);\n\s*setModified\(false\);/, 'Update: PUT, then the toast and the mark cleared');
  assert.match(space, /if \(!layoutBase \|\| layoutCheckFrame\) return;\n\s*layoutCheckFrame = requestAnimationFrame\(/, 'once a frame, never per mouse move');
  assert.match(space, /if \(!findLayout\(id\) \|\| guestToken \|\| me\?\.role === 'guest'\) return;/, 'a guest, the Workspace, Calendar and Map have no baseline, so no mark');
  assert.match(space, /if \(mayChangeLayout\(shared\)\) \{\n\s*const b = layoutModifiedEl\.ownerDocument\.createElement\('button'\);/, 'Update only where this person may change the layout; else the word alone');
  assert.match(space, /onArrange: \(\) => arrangementChanged\(\),/);
  assert.match(canvasJs, /if \(spaceId && !suspended && !restoring\) onArrange\?\.\(\);/);
  assert.match(space, /pin\.setAttribute\('aria-label', `Favorite \$\{t\.label\}`\);/, 'the temporary tab\'s heart pins it');
  assert.ok(!/localStorage[^\n]*layoutBase|layoutModified[^\n]*localStorage/.test(space), 'Modified is not stored');
});

fs.rmSync(layoutsDir, { recursive: true, force: true });
console.log(`check-nav: OK (${n} tests)`);
