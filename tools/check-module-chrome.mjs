#!/usr/bin/env node
/*
 * check-module-chrome.mjs -- a module window's bands as the SDK asks for them: the "+" (host.add.set), the status bar
 * (host.status.set), the title bar's icons (host.header.set) and the toolbar row (host.toolbar.set); step 1 of
 * documentation/plans/plan-module-titlebar-add.md and the module frame (public/module-frame.js). public/module-chrome.js
 * holds the pure rules and maps them onto the frame; module-host.js draws with them (createFrameBands) and canvas.js,
 * module.js and destination.js give each window its frame. This fails when:
 *   - the "+"'s entries are not cleaned to the contract (the caps, one level, a one-leaf category as its leaf);
 *   - one leaf does not run at once with its label as the name, or several do not open the menu (categories as flyouts);
 *   - the status items are not cleaned (4 at most, one end item and last, 60 characters, no pill), the same items are not
 *     seen as the same, or the frame does not get the words at the start (cut first) and the end item at the end;
 *   - the read-out speaks on the first draw, before 1.5 s of quiet, a quiet item, or the same text twice;
 *   - no titlebar does not answer false;
 *   - host.bar.set (kept for modules written for the old bar) stops folding its buttons into the "+" (the primary first,
 *     a quick-add a leaf sending an empty value, host.add.set's list winning), or the old bar comes back anywhere;
 *   - a bundled module calls host.bar.set (step 6: every one of them draws the "+");
 *   - a window stops getting its frame (a window, popped out and the module's own page), its status bar stops being a
 *     labelled region, or moveModule rebuilds the frame instead of moving it;
 *   - the toolbar's items are not cleaned and mapped to the frame's one row (the switches, words and buttons on the left;
 *     the search and one Filters button holding every chips group at the end), or the title bar's actions lose their
 *     placement (an icon, the menu, a destructive one last).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
// Copied to a .mjs so Node reads it as the module it is (the package has no "type").
const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'check-module-chrome-')), 'module-chrome.mjs');
fs.copyFileSync(path.join(ROOT, 'public/module-chrome.js'), copy);
const R = await import(pathToFileURL(copy).href);
fs.rmSync(path.dirname(copy), { recursive: true, force: true });

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; } catch (err) { failures.push(`${name}: ${err.message}`); }
}

test('the "+": entries cleaned to the contract', () => {
  const clean = R.cleanAddEntries([
    { divider: true },
    { id: 'note', label: 'Note', icon: 'note-sticky', tint: 'blue', hint: 'N' },
    { id: '', label: 'no id' },
    { id: 'x', label: '' },
    { id: 'bad', label: 'Bad icon', icon: 'Not An Icon!', tint: '#fff' },
    { divider: true },
    { divider: true },
    { label: 'Travel', icon: 'plane', items: [{ id: 'flight', label: 'Flight' }, { id: 'train', label: 'Train' }, { label: 'Nested', items: [{ id: 'z', label: 'Z' }] }] },
    { label: 'Stay', items: [{ id: 'hotel', label: 'Hotel' }] },
    { label: 'Empty', items: [] },
    { label: '', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
    { divider: true },
  ]);
  assert.deepEqual(clean, [
    { id: 'note', label: 'Note', disabled: false, icon: 'note-sticky', tint: 'blue', hint: 'N' },
    { id: 'bad', label: 'Bad icon', disabled: false },
    { divider: true },
    { label: 'Travel', icon: 'plane', items: [{ id: 'flight', label: 'Flight', disabled: false }, { id: 'train', label: 'Train', disabled: false }] },
    { id: 'hotel', label: 'Hotel', disabled: false },
  ], 'no divider first, last or twice; one level; a one-leaf category is its leaf; an empty or unnamed one goes');
  assert.equal(R.cleanAddEntries([{ id: 'l', label: 'x'.repeat(80) }])[0].label.length, 40, 'labels up to 40');
  assert.deepEqual(R.cleanAddEntries(null), []);
  assert.deepEqual(R.cleanAddEntries('nope'), []);
});

test('the "+": the caps (8 top-level, 12 per category, 40 leaves)', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, label: `T${i}` }));
  assert.equal(R.cleanAddEntries(many).length, 8, '8 top-level');
  const cat = { label: 'Big', items: Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, label: `C${i}` })) };
  assert.equal(R.cleanAddEntries([cat])[0].items.length, 12, '12 per category');
  const cats = Array.from({ length: 5 }, (_, k) => ({ label: `K${k}`, items: Array.from({ length: 12 }, (_, i) => ({ id: `k${k}-${i}`, label: `L${i}` })) }));
  const leaves = R.cleanAddEntries(cats).reduce((n, e) => n + (e.items ? e.items.length : 1), 0);
  assert.equal(leaves, 40, '40 leaves in all');
});

test('the "+": one leaf runs at once, several open the menu, none takes it away', () => {
  assert.deepEqual(R.addPlan(R.cleanAddEntries([])), { kind: 'none' });
  assert.deepEqual(R.addPlan(R.cleanAddEntries([{ divider: true }])), { kind: 'none' });
  const one = R.addPlan(R.cleanAddEntries([{ id: 'event', label: 'Add event', icon: 'plus' }]));
  assert.equal(one.kind, 'direct');
  assert.equal(one.leaf.id, 'event');
  assert.equal(one.leaf.label, 'Add event', 'the tooltip and the name are the leaf\'s label');
  const oneInCategory = R.addPlan(R.cleanAddEntries([{ label: 'Stay', items: [{ id: 'hotel', label: 'Hotel' }] }]));
  assert.equal(oneInCategory.kind, 'direct', 'a category of one is its leaf, so it runs at once too');
  assert.deepEqual(R.addPlan(R.cleanAddEntries([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }])), { kind: 'menu', label: 'Add' });
  assert.equal(R.addPlan(R.cleanAddEntries([{ label: 'Travel', items: [{ id: 'f', label: 'Flight' }, { id: 't', label: 'Train' }] }])).kind, 'menu', 'one category of several: the menu');
});

test('the "+": the menu is the shared menu\'s shape, categories with items (flyouts), a pick sends the leaf\'s id', () => {
  const picked = [];
  const items = R.addMenuItems(R.cleanAddEntries([
    { id: 'note', label: 'Note', icon: 'note-sticky' },
    { divider: true },
    { label: 'Travel', icon: 'plane', items: [{ id: 'flight', label: 'Flight', tint: 'blue' }, { id: 'train', label: 'Train', disabled: true }] },
  ]), (id) => picked.push(id));
  assert.equal(items.length, 3);
  assert.equal(items[0].label, 'Note');
  assert.equal(items[0].icon, 'note-sticky');
  assert.deepEqual(items[1], { divider: true });
  assert.equal(items[2].label, 'Travel');
  assert.ok(Array.isArray(items[2].items) && items[2].items.length === 2, 'a category: its leaves in `items`, which the shared menu opens as a flyout');
  assert.equal(items[2].onPick, undefined, 'a category itself sends nothing');
  assert.equal(items[2].items[0].tint, 'blue');
  assert.equal(items[2].items[1].disabled, true);
  items[0].onPick();
  items[2].items[0].onPick();
  assert.deepEqual(picked, ['note', 'flight']);
});

test('the status bar: items cleaned (4 at most, one end item and last, 60 characters, the title)', () => {
  const clean = R.cleanStatusItems([
    { text: 'Updated now', quiet: true, end: true },
    { text: '12 of 40' },
    { text: '' },
    null,
    { text: 'Links', chip: true, icon: 'link' },
    { text: 'Second end', end: true },
    { text: 'x'.repeat(100), title: 'The whole long thing' },
    { text: 'one too many' },
  ]);
  assert.equal(clean.length, 4, '4 at most');
  assert.deepEqual(clean.map((i) => i.text), ['12 of 40', 'Links', 'Second end', 'Updated now'], 'in order, a second end item a plain one');
  assert.equal(clean[3].end, true, 'the end item goes last');
  assert.equal(clean.filter((i) => i.end).length, 1, 'one end item');
  assert.equal('chip' in clean[1], false, 'no pill: a status item is words');
  assert.equal(clean[1].icon, 'link');
  assert.equal(clean[0].title, '12 of 40', 'the title is the text unless given');
  const long = R.cleanStatusItems([{ text: 'y'.repeat(100), title: 'The whole long thing' }])[0];
  assert.equal(long.text.length, 60, 'text up to 60');
  assert.equal(long.title, 'The whole long thing');
  assert.deepEqual(R.cleanStatusItems(undefined), []);
});

test('the status bar: the same items are the same, the text read out, the bar\'s title, the frame\'s start and end', () => {
  const a = R.cleanStatusItems([{ text: '3 open' }, { text: 'Updated 2 min ago', quiet: true, end: true }]);
  const b = R.cleanStatusItems([{ text: '3 open' }, { text: 'Updated 2 min ago', quiet: true, end: true }]);
  assert.equal(R.statusKey(a), R.statusKey(b), 'the same items: nothing drawn again');
  assert.notEqual(R.statusKey(a), R.statusKey(R.cleanStatusItems([{ text: '4 open' }])));
  assert.equal(R.statusSpoken(a), '3 open', 'a quiet item is not read out');
  assert.equal(R.statusTitle(a), '3 open · Updated 2 min ago', 'the bar\'s title is every item\'s text');
  const f = R.statusFrame(R.cleanStatusItems([{ text: '12 of 40', icon: 'list' }, { text: 'Links' }, { text: 'Saved', end: true, title: 'Saved a moment ago' }]));
  assert.deepEqual(f.lead.map((i) => i.text), ['12 of 40', 'Links'], 'the words at the start, in order (one span, cut with an ellipsis from its end)');
  assert.equal(f.lead[0].icon, 'list');
  assert.deepEqual(f.items.map((i) => i.text), ['Saved'], 'the end item at the end, never cut');
  assert.equal(f.items[0].title, 'Saved a moment ago');
  assert.equal(f.title, '12 of 40 · Links · Saved', 'the bar\'s tooltip is every item');
  assert.deepEqual(R.statusFrame([]), { lead: [], items: [], title: '' }, 'nothing: the bar hides');
  const frameJs = read('public/module-frame.js');
  assert.match(frameJs, /status\.hidden = !st\.text && items\.length === 0 && lead\.length === 0;/, 'hidden while it holds nothing');
  const block = read('public/sdk/system.css').slice(read('public/sdk/system.css').indexOf('/* moduleframe:start */'), read('public/sdk/system.css').indexOf('/* moduleframe:end */'));
  assert.match(block, /\.mf-status-text \{[^}]*flex: 1 1 auto;[^}]*min-width: 0;[^}]*overflow: hidden;[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/, 'the start gives way first, cut with an ellipsis');
  assert.match(block, /\.mf-status-items \{[^}]*flex: none;/, 'the end never gives way');
});

test('the read-out: polite and debounced (never the first draw, 1.5 s of quiet, never the same twice)', () => {
  let now = 0;
  let timers = [];
  const said = [];
  const a = R.createAnnouncer({
    write: (t) => said.push(t),
    setTimer: (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t; },
    clearTimer: (t) => { timers = timers.filter((x) => x !== t); },
  });
  const tick = (ms) => { now += ms; for (const t of timers.filter((x) => x.at <= now)) { timers = timers.filter((x) => x !== t); t.fn(); } };
  assert.equal(R.STATUS_QUIET_MS, 1500);
  a.update('Day 1 of 26');
  tick(5000);
  assert.deepEqual(said, [], 'never on the first draw');
  a.update('Day 2 of 26');
  tick(500);
  a.update('Day 3 of 26');
  tick(500);
  a.update('Day 4 of 26');
  tick(1499);
  assert.deepEqual(said, [], 'nothing while it keeps changing');
  tick(1);
  assert.deepEqual(said, ['Day 4 of 26'], 'once, after 1.5 s without a change');
  a.update('Day 4 of 26');
  tick(2000);
  assert.deepEqual(said, ['Day 4 of 26'], 'not the same text twice');
  a.update('Day 5 of 26');
  tick(700);
  a.update('Day 4 of 26');
  tick(2000);
  assert.deepEqual(said, ['Day 4 of 26'], 'back to what was last read out: nothing');
  a.update('');
  tick(2000);
  assert.deepEqual(said, ['Day 4 of 26'], 'the bar going away says nothing');
  a.update('Day 9 of 26');
  a.stop();
  tick(2000);
  assert.deepEqual(said, ['Day 4 of 26'], 'stopped: nothing more');
});

const host = read('public/module-host.js');
const canvas = read('public/canvas.js');
const sdk = read('public/sdk/host.js');
const css = read('public/style.css');
const sdkCss = read('public/sdk/host.css');
const moduleJs = read('public/module.js');
const moduleHtml = read('public/module.html');

test('the old bar folded into the "+": each button a leaf, the primary first, a quick-add a leaf with no text', () => {
  const { entries, quick } = R.foldBarItems([
    { id: 'link', label: 'Add a link', icon: 'link' },
    { id: 'add', label: 'Add a note', icon: 'note-sticky', primary: true },
    { id: 'find', type: 'quickadd', placeholder: 'Search, or paste a link' },
    { id: 'go', type: 'quickadd', label: 'Add a place', icon: 'magnifying-glass' },
    { id: 'more', label: 'Export', overflow: true, iconOnly: true },
    { id: '', label: 'no id' },
    { id: 'x', label: '' },
  ]);
  assert.deepEqual(entries, [
    { id: 'add', label: 'Add a note', disabled: false, icon: 'note-sticky' },
    { id: 'link', label: 'Add a link', disabled: false, icon: 'link' },
    { id: 'find', label: 'Search, or paste a link', disabled: false, icon: 'plus' },
    { id: 'go', label: 'Add a place', disabled: false, icon: 'magnifying-glass' },
    { id: 'more', label: 'Export', disabled: false },
  ], 'the primary first, the rest in order; a quick-add named by its label, else its placeholder');
  assert.deepEqual([...quick], ['find', 'go'], 'the quick-adds, whose pick sends an empty value');
  assert.equal(R.foldBarItems([{ id: 'q', type: 'quickadd' }]).entries[0].label, 'Add', 'a quick-add with no words reads Add');
  assert.equal(R.foldBarItems(Array.from({ length: 14 }, (_, i) => ({ id: `b${i}`, label: `B${i}` }))).entries.length, 10, '10 at most, as the bar took');
  assert.deepEqual(R.foldBarItems(null).entries, []);
  // One button folds to one leaf: the "+" runs it at once, named by it.
  assert.equal(R.addPlan(R.cleanAddEntries(R.foldBarItems([{ id: 'add', label: 'New todo', icon: 'plus', primary: true }]).entries)).kind, 'direct');
});

test('the host: no old bar; bar.set folds into the "+", add.set\'s list wins, a fold pick sends the bar event', () => {
  assert.match(host, /async 'add\.set'\(\{ entries \}\) \{\s*\n\s*if \(!bands\) return false;/);
  assert.match(host, /async 'status\.set'\(\{ items \}\) \{\s*\n\s*if \(!bands\) return false;\s*\n\s*return bands\.status\(items\);/);
  assert.match(host, /if \(key === statusLast\) return true;/, 'the same items draw nothing');
  assert.match(host, /async 'bar\.set'\(\{ items \}\) \{\s*\n\s*\(\{ entries: barFold, quick: barQuick \} = foldBarItems\(items\)\);\s*\n\s*drawAddSlot\(\);\s*\n\s*return true;/, 'bar.set folds and answers true');
  assert.match(host, /const drawAddSlot = \(\) => \{ if \(bands\) bands\.add\(addOwn !== null \? addOwn : barFold\); \};/, 'add.set\'s list wins over the fold');
  assert.match(host, /if \(event === 'add' && folding\(\)\) send\('bar', barQuick\.has\(data\.id\) \? \{ id: data\.id, value: '' \} : \{ id: data\.id \}\);/, 'a fold pick is the old bar event');
  for (const gone of ['drawModuleBar', 'barObserver', 'onBar', 'quick-add-go', 'createToolbar', 'createAddSlot', 'createStatusSlot', 'drawHeaderItems', 'splitOverflow', 'drawMoreButton']) assert.ok(!host.includes(gone), `module-host.js: ${gone} is gone`);
  for (const [rel, code] of [['public/canvas.js', canvas], ['public/module.js', moduleJs], ['public/module.html', moduleHtml], ['public/style.css', css], ['public/sdk/host.css', sdkCss]]) {
    assert.ok(!/dock-bar|module-floating-bar|has-bar|id="module-bar"|\$\('module-bar'\)/.test(code), `${rel}: the old bar is gone`);
    assert.ok(!/mod-header|mod-toolbar|mod-status|titlebar-add(?!\.md)|titlebar-custom|data-header-add|page-bar-add|module-titlebar(?![-\w])/.test(code), `${rel}: the old title bar, toolbar and status are gone`);
  }
  assert.match(sdk, /add: \{\s*\n\s*set: \(entries\) => call\('add\.set', \{ entries \}\),/);
  assert.match(sdk, /status: \{\s*\n\s*set: \(items\) => call\('status\.set', \{ items \}\),/);
  assert.match(sdk, /folds the buttons into\n\s*\/\/ the titlebar's "\+"/, 'the SDK\'s contract says bar.set folds into the "+"');
  assert.match(sdk, /'add' \(\{ id \}\)/, 'the add event is in the contract');
});

test('the "+" and the status bar as drawn: names, the shared menu, the live node, focus back to the "+"', () => {
  assert.match(host, /import \{ cleanAddEntries, foldBarItems, cleanStatusItems, statusKey, statusSpoken, statusFrame, createAnnouncer, topmostAt, cleanToolbarItems, cleanHeaderItems, titlebarActions, frameToolbar, frameAdd, cleanStandardActions, cleanShareResult \} from '\/module-chrome\.js';/);
  // The plan: several open the shared menu, one runs at once (its id the event's value), none takes the "+" away.
  const picked = [];
  const several = R.frameAdd(R.cleanAddEntries([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]), (id) => picked.push(id));
  assert.equal(several.label, 'Add');
  assert.equal(typeof several.items, 'function', 'several: the shared menu\'s items, asked as it opens');
  several.items()[1].onPick();
  assert.deepEqual(picked, ['b']);
  assert.deepEqual(R.frameAdd(R.cleanAddEntries([{ id: 'event', label: 'Add event', disabled: true }]), () => {}), { label: 'Add event', disabled: true, value: 'event' }, 'one: at once, named by its label');
  assert.equal(R.frameAdd([], () => {}), null, 'none: no "+"');
  assert.match(host, /add\(entries\) \{ frame\.setTitlebar\(\{ add: frameAdd\(cleanAddEntries\(entries\), \(id\) => send\('add', \{ id \}\)\) \}\); \}/, 'the host draws the plan in the frame\'s title bar');
  assert.match(host, /if \(e\.id === 'add'\) \{ if \(e\.value !== undefined\) send\('add', \{ id: e\.value \}\); return; \}/, 'one: its pick sends the leaf\'s id');
  const frameJs = read('public/module-frame.js');
  assert.match(frameJs, /button\('mf-icon-btn mf-titlebar-btn mf-add-btn', \{ label: add\.label \|\| 'Add', iconName: 'plus', words: false \}\)/, 'the "+" is named by its label (its tooltip too)');
  assert.match(frameJs, /b\.setAttribute\('aria-haspopup', 'menu'\);\s*\n\s*b\.setAttribute\('aria-expanded', 'false'\);\s*\n\s*b\.addEventListener\('click', \(\) => openHostMenu\(b, items\)\);/, 'several: the shared menu');
  assert.match(frameJs, /b\.disabled = Boolean\(add\.disabled\);/);
  assert.match(frameJs, /const live = el\('span', 'visually-hidden', \{ 'aria-live': 'polite' \}\);/, 'a polite live node');
  assert.match(host, /createAnnouncer\(\{ write: \(t\) => frame\.announce\(t\)/, 'read out through the frame\'s live node');
  assert.match(host, /announcer\.update\(statusSpoken\(clean\)\);/, 'a quiet item is not read out');
  assert.match(frameJs, /const status = el\('footer', 'mf-status', \{ role: 'region' \}\);/, 'the status bar is a region');
  assert.match(frameJs, /status\.setAttribute\('aria-label', text \? `\$\{text\} status` : 'Status'\);/, 'named by the module');
  assert.match(host, /event === 'nav' \|\| event === 'add' \|\| event === 'standard'\)\) opener =/, 'focus goes back to the "+" (or the menu) when its editor closes');
});

test('the window: a frame for every module, moved (not rebuilt) between docked and floating', () => {
  const make = canvas.slice(canvas.indexOf('  function makeFrame('), canvas.indexOf('  // The page a composite holds'));
  assert.match(make, /createModuleFrame\(\{/, 'the canvas draws a module window with the frame');
  assert.match(make, /titlebar: \{ close: true, standard: \(\) => standardFor\(m\.id\), extra: \(\) => stackMenu\(m\.id\), onAction: \(e\) => titlebarAction\(m\.id, e\) \}/, 'Close, the standard actions and the stack entries (plan-panel-stacking.md) are the window\'s');
  assert.match(make, /onAction: \(e\) => opened\.get\(m\.id\)\?\.mount\?\.bandEvent\?\.\(e\)/, 'the module\'s own controls go to its mount');
  const floating = canvas.slice(canvas.indexOf('  function openModuleFloating('), canvas.indexOf('  function openModuleDocked('));
  const docked = canvas.slice(canvas.indexOf('  function openModuleDocked('), canvas.indexOf('  function moveModule('));
  const move = canvas.slice(canvas.indexOf('  function moveModule('), canvas.indexOf('  // --- built-in modules'));
  for (const [name, code] of [['floating', floating], ['docked', docked]]) {
    assert.ok(/const frame = reuse \? reuse\.frame : makeFrame\(m, '(float|dock)', holderElement\(m\)\);/.test(code), `${name}: the frame moved in, else made`);
    assert.ok(/if \(reuse\) mod\.mount = reuse\.mount;/.test(code), `${name}: the mount kept`);
  }
  assert.ok(move.includes('const reuse = { frame: mod.frame, mount: mod.mount };'), 'moveModule carries the frame and the mount');
  assert.ok(canvas.includes('      chrome: mod.frame,\n'), 'the mount draws its bands in the frame');
  assert.match(canvas, /mod\.frame\?\.destroy\(\);/, 'closing lets the frame go');
});

test('popped out and on the module\'s own page: the frame fills the page', () => {
  assert.match(moduleHtml, /<main class="module-canvas" id="module-main">/, 'the place the frame fills');
  assert.match(moduleHtml, /<iframe class="module-holder" id="module-frame"/, 'the module\'s own frame, in the frame\'s content');
  assert.match(moduleJs, /const chrome = createModuleFrame\(\{[\s\S]*?variant: 'page',[\s\S]*?\}\);\s*\n\s*\$\('module-main'\)\.prepend\(chrome\.el\);/, 'a module\'s own page is the frame\'s page variant');
  assert.match(moduleJs, /\? \{ close: true, standard: \(\) => popoutStandard\(mod\)/, 'popped out: Close, and the way back in the menu');
  assert.ok(/\n    chrome,\n/.test(moduleJs), 'the mount draws its bands in it');
  const sys = read('public/sdk/system.css');
  assert.match(sys, /\.mf\.mf-page > \.mf-status \{ height: calc\(var\(--mf-status-h\) \+ var\(--safe-bottom\)\); padding-bottom: var\(--safe-bottom\); \}/, 'clear of the home indicator where the page ends the screen');
  assert.match(sys, /\.mf\.mf-page \{ border: 0; border-radius: 0; box-shadow: none; \}/, 'a page: no edge, no corner');
});

test('no bundled module calls host.bar.set (every one draws the "+")', () => {
  const dir = path.join(ROOT, 'modules');
  const callers = [];
  for (const id of fs.readdirSync(dir).sort()) {
    const src = path.join(dir, id, 'src');
    if (!fs.existsSync(src)) continue;
    for (const file of fs.readdirSync(src).sort()) {
      if (!/\.(js|mjs|html)$/.test(file)) continue;
      const text = read(`modules/${id}/src/${file}`).replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
      if (/\bbar\s*\.\s*set\s*\(|\bcall\(\s*['"]bar\.set['"]|\.on\(\s*['"]bar['"]/.test(text)) callers.push(`modules/${id}/src/${file}`);
    }
  }
  assert.deepEqual(callers, [], 'host.bar.set is for modules written for the old bar; a bundled module uses host.add.set');
  assert.match(sdk, /bar: \{\s*\n\s*set: \(items\) => call\('bar\.set', \{ items \}\),/, 'host.bar.set stays in the SDK');
});

test('the styles: the status bar 24px in the moduleframe block, one line, tokens only', () => {
  const sys = read('public/sdk/system.css');
  const block = sys.slice(sys.indexOf('/* moduleframe:start */'), sys.indexOf('/* moduleframe:end */'));
  assert.ok(block.length > 100, 'the moduleframe block is in system.css');
  assert.ok(!sys.includes('/* modulechrome:start */'), 'the old Module window block is gone');
  assert.match(block, /--mf-status-h: 24px;/);
  assert.match(block, /\.mf-status \{[^}]*height: var\(--mf-status-h\);[^}]*border-top: 1px solid var\(--mf-edge\);[^}]*background: var\(--mf-surface-status\);[^}]*color: var\(--text-muted\);[^}]*font-size: var\(--text-12\);/, 'one line on the status bar\'s surface, muted 12px words under a hairline');
  assert.match(block, /\.mf-status\[hidden\] \{ display: none; \}/);
  assert.match(block, /\.mf-status-text \{[^}]*text-overflow: ellipsis;/);
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(block) && !/rgba?\(/.test(block), 'tokens only');
  for (const gone of ['.mod-status {', '.mod-status-item {', '.mod-header {', '.mod-toolbar {', '.module-floating-head {', '.tb-sep {', '--status-bar-h:', '--module-header-h:', '--toolbar-h:']) {
    assert.ok(!css.includes(gone) && !sys.includes(gone) && !sdkCss.includes(gone), `${gone} is gone`);
  }
});

test('the title bar\'s height: --mf-title-h, no padding above or below, its buttons --mf-ctl-h', () => {
  const sys = read('public/sdk/system.css');
  const block = sys.slice(sys.indexOf('/* moduleframe:start */'), sys.indexOf('/* moduleframe:end */'));
  assert.match(block, /--mf-title-h: 36px;/, 'the one token');
  assert.equal((sys.match(/--mf-title-h: \d+px/g) || []).length + (css.match(/--mf-title-h:/g) || []).length, 1, 'set in one place (a phone only recalculates it from --mf-hit)');
  const rule = (sel) => { const m = block.match(new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`)); return m ? m[2] : null; };
  const head = rule('.mf-titlebar');
  assert.ok(head, 'the title bar is in the moduleframe block');
  assert.match(head, /height: var\(--mf-title-h\);/);
  assert.match(head, /padding: 0 var\(--space-1\) 0 var\(--mf-inset\);/, 'no padding above or below: the height is the token\'s alone');
  assert.match(read('public/space.html'), /<header class="mf-titlebar chat-head">/, 'the chat\'s header is the frame\'s title bar');
  assert.match(read('public/space.html'), /<header class="mf-titlebar conference-head">/, 'so is the call\'s');
  assert.match(block, /--mf-ctl-h: 28px;/, 'nothing in a title bar is taller than its buttons');
  for (const m of (css + '\n' + block).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (!/\.mf-titlebar\b|\.chat-head|\.conference-head|\.side-column-call-head/.test(sel) || /\.mf-titlebar-|\.canvas\.narrow/.test(sel)) continue;
    for (const decl of m[2].split(';')) {
      const d = decl.match(/^\s*(min-height|height|padding(?:-top|-bottom)?|margin(?:-top|-bottom)?)\s*:\s*(.+)$/);
      if (!d) continue;
      if (d[1] === 'min-height') assert.fail(`${sel} sets a min-height (${d[2].trim()}): the title bar is the token's height`);
      if (d[1] === 'height') { assert.equal(d[2].trim(), 'var(--mf-title-h)', `${sel} sets its own height`); continue; }
      if (/^padding$|^margin$/.test(d[1])) {
        const v = d[2].trim().split(/\s+/);
        const [top, bottom] = [v[0], v[2] ?? v[0]];
        assert.ok(/^0(px)?$/.test(top) && /^0(px)?$/.test(bottom), `${sel} pads the title bar above or below (${d[1]}: ${d[2].trim()})`);
      }
      else assert.ok(/^0(px)?$/.test(d[2].trim()), `${sel} sets ${d[1]}: ${d[2].trim()}`);
    }
  }
  // canvas.js reads the token (a floating window's height is its content's plus the title bar's), never a fixed number.
  assert.ok(!/HEAD_H = \d+/.test(canvas), 'no fixed title bar height');
  assert.ok(canvas.includes("getPropertyValue('--mf-title-h')"), 'the token, read where it is used');
});

// Issue #60: the drop lands on what is on top, not on the first module mounted.
test('the drop target is the topmost visible module at the point', () => {
  const box = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b });
  const polls = { id: 'polls', rect: box(0, 0, 400, 300), z: 1, order: 0, visible: true };
  const calendar = { id: 'calendar', rect: box(100, 50, 500, 350), z: 2, order: 1, visible: true };
  assert.equal(R.topmostAt([polls, calendar], 200, 100).id, 'calendar', 'both under the point: the higher one, whatever the mount order');
  assert.equal(R.topmostAt([calendar, polls], 200, 100).id, 'calendar', 'the order of the list does not matter');
  assert.equal(R.topmostAt([polls, calendar], 50, 20).id, 'polls', 'the point only inside the lower one');
  assert.equal(R.topmostAt([polls], 200, 100).id, 'polls', 'one module under the pointer is unchanged');
  assert.equal(R.topmostAt([polls, { ...calendar, visible: false }], 200, 100).id, 'polls', 'a hidden one never wins');
  assert.equal(R.topmostAt([polls, { ...calendar, rect: box(100, 50, 500, 350) }], 450, 340).id, 'calendar');
  assert.equal(R.topmostAt([polls, calendar], 900, 900), null, 'nothing there');
  assert.equal(R.topmostAt([{ ...polls, z: 3 }, { ...calendar, z: 3, order: 5 }], 200, 100).id, 'calendar', 'a tie goes to the later one');
  const cover = { id: null, blocks: true, rect: box(100, 50, 500, 90), z: 9, visible: true };
  assert.equal(R.topmostAt([polls, cover], 200, 60).id, null, 'a window titlebar on top covers the module under it');
  const host = read('public/module-host.js');
  assert.ok(/function ptrTarget[\s\S]*?elementsFromPoint[\s\S]*?topmostAt\(/.test(host), 'ptrTarget reads the page\'s stacking');
});

// Issue #155: a toolbar drawn again keeps the keyboard on the same control; the search and the Filters button are kept.
test('a toolbar redraw puts focus back on the same control', () => {
  const frameJs = read('public/module-frame.js');
  const redraw = frameJs.slice(frameJs.indexOf('  function redraw('), frameJs.indexOf('  // ---- 3. the content ----'));
  assert.ok(redraw.indexOf('active.dataset.key') > -1 && redraw.indexOf('active.dataset.key') < redraw.indexOf('drawToolbar()'), 'focus is read before the row is drawn again');
  assert.ok(redraw.indexOf('again.focus(') > redraw.indexOf('drawToolbar()'), 'and put back after it is drawn');
  for (const key of ["b.dataset.key = `switch:${it.id}:${o.id}`;", "b.dataset.key = `btn:${it.id}`;", "c.dataset.key = `chip:${it.id}:${o.id}`;", "input.dataset.key = key;", "b.dataset.key = 'filters';", "moreBtn.dataset.key = 'more';"]) {
    assert.ok(frameJs.includes(key), `every control carries its key (${key})`);
  }
  assert.match(frameJs, /b = el\('button', 'mf-switch-btn', \{ type: 'button', role: 'radio', 'aria-checked': String\(o\.id === it\.value\), tabindex: o\.id === stop \? '0' : '-1'/, 'a switch choice is a radio that says whether it is chosen, the chosen one the Tab stop');
  // The search and the Filters button live on between draws: typing, focus and an open menu survive the module drawing again.
  assert.match(frameJs, /const kept = new Map\(\);/);
  assert.match(frameJs, /let k = kept\.get\(key\);\s*\n\s*if \(!k\) \{\s*\n\s*const form = el\('form', 'mf-search'/, 'the search is made once');
  assert.match(frameJs, /if \(k\.given !== value\) \{ k\.given = value; if \(k\.input\.value !== value\) k\.input\.value = value; \}/, 'the module\'s value only when it changed what it said, never under the person\'s typing');
  assert.match(frameJs, /parts\.forEach\(\(p, at\) => \{ if \(toolbar\.childNodes\[at\] !== p\) toolbar\.insertBefore\(p, toolbar\.childNodes\[at\] \|\| null\); \}\);/, 'a kept element is not moved when it is already in place (moving a focused field would blur it)');
});

// The toolbar's items (plan-unified-layout.md, "One toolbar row") and their place in the frame's row.
test('the toolbar row: items cleaned, the rest dropped', () => {
  const clean = R.cleanToolbarItems([
    { type: 'title', text: 'October 2026' },
    { type: 'search', id: 'find', placeholder: 'Find a place', value: 'paris' },
    { type: 'search' }, // no id
    { type: 'chips', id: 'show', label: 'Trips', options: [{ id: 'a', label: 'Paris', icon: 'plane', tint: 'blue', on: true }, { id: 'b', label: 'Rome', on: false, tint: 'nope' }, { id: 'c', label: 'Tags', default: false, count: 3 }, { id: '', label: 'x' }] },
    { type: 'chips', id: 'kind', label: 'Kind', single: true, value: 'nope', options: [{ id: 'all', label: 'All' }, { id: 'note', label: 'Notes', count: 2 }] },
    { type: 'chips', id: 'none', options: [] },
    { id: 'prev', icon: 'chevron-left', title: 'Previous' },
    { id: 'export', icon: 'file-export', title: 'Export', placement: 'titlebar' },
    { type: 'tabs', id: 'view', value: 'month', options: [{ id: 'month', label: 'Month', icon: 'calendar-days' }] },
    { separator: true },
    { type: 'progress', value: 3 },
    { type: 'slider', id: 's', value: 2 },
    { type: 'nonsense', id: 'x', label: 'X' },
    { type: 'title', text: 'x', send: () => {} },
  ]);
  assert.deepEqual(clean.map((i) => i.type), ['title', 'search', 'chips', 'chips', 'button', 'button', 'tabs', 'title'], 'no separator, progress, slider or unknown type');
  assert.equal(clean[1].label, 'Find a place', 'a search is named by its placeholder when it has no label');
  assert.equal(clean[1].value, 'paris');
  assert.deepEqual(clean[2].options.map((o) => [o.id, o.on, o.default, o.tint || null, o.icon || null, o.count ?? null]), [['a', true, true, 'blue', 'plane', null], ['b', false, true, null, null, null], ['c', false, false, null, null, 3]], 'a switch is on unless off; its default on unless given');
  assert.equal(clean[3].single, true);
  assert.equal(clean[3].value, 'all', 'a single choice falls back to its first option');
  assert.equal(clean[4].title, 'Previous', 'an icon button keeps its title');
  assert.equal(clean[4].placement, 'row');
  assert.equal(clean[5].placement, 'titlebar');
  assert.equal(typeof clean[7].send, 'function', 'the host page\'s own items keep their send');
  assert.equal(R.cleanToolbarItems(Array.from({ length: 30 }, (_, i) => ({ type: 'text', text: String(i) }))).length, R.TOOLBAR_LIMITS.items);
  // The row: Thomas's order on the left (switches, words, buttons), the search, then one Filters button with every group.
  const row = R.frameToolbar(clean);
  assert.deepEqual(row.map((e) => e.type), ['switch', 'title', 'title', 'button', 'search', 'filters']);
  assert.equal(row[3].kind, 'icon', 'an icon with no words is an icon button');
  assert.equal(row[3].tip, 'Previous');
  const filters = row[5];
  assert.deepEqual(filters.groups.map((g) => [g.id, g.heading, g.single]), [['show', 'Trips', false], ['kind', 'Kind', true]], 'every chips item a group, under its label');
  assert.equal(R.frameToolbar([]).length, 0, 'nothing: no row');
  assert.ok(!R.frameToolbar(R.cleanToolbarItems([{ type: 'search', id: 'q' }])).some((e) => e.type === 'filters'), 'no chips: no Filters button');
  // The Calendar destination's zones (Thomas, 2026-11-02): a host page's own items (they carry `send`) may say `zone: 'end'` (the
  // row's right zone, after the search and Filters) and `pin` (never moved into More); any zone keeps the order given instead
  // of sorting switches first. A module's own item may say `zone` too, but never `pin` (below).
  const noop = () => {};
  const zoned = R.cleanToolbarItems([
    { type: 'title', text: 'October 2026', send: noop, zone: 'start' },
    { id: 'prev', icon: 'chevron-left', title: 'Previous', send: noop, zone: 'start' },
    { type: 'tabs', id: 'mode', value: 'month', options: [{ id: 'month', label: 'Month' }], send: noop, zone: 'start' },
    { type: 'chips', id: 'f', label: 'Show', options: [{ id: 'a', label: 'A' }], send: noop },
    { type: 'tabs', id: 'part', value: 'a', options: [{ id: 'a', label: 'Agenda' }, { id: 'b', label: 'To-do', count: 4 }], send: noop, zone: 'end', pin: true },
  ]);
  const zrow = R.frameToolbar(zoned);
  assert.deepEqual(zrow.map((e) => e.id || e.type), ['title', 'prev', 'mode', 'filters', 'part'], 'the date group, the mode, the Filters button, then the right zone');
  assert.equal(zrow[4].zone, 'end');
  assert.equal(zrow[4].pin, true);
  assert.equal(zrow[4].options[1].count, 4, 'a switch choice keeps its count, which stays when its words fold');
  // A module's own items (no `send`) may say `zone: 'end'` too (Thomas, 2026-11-09): default stays left in the order made, 'end'
  // goes right after the search and Filters in the order made, a value other than 'start' or 'end' is ignored, and a module can
  // neither pin nor change the order of the left zone.
  const mod = R.frameToolbar(R.cleanToolbarItems([
    { id: 'snap', title: 'Snap', icon: 'border-all', on: false, zone: 'end' },
    { id: 'a', label: 'A' },
    { type: 'tabs', id: 'view', value: 'x', options: [{ id: 'x', label: 'X' }] },
    { id: 'grid', label: 'Grid', zone: 'end' },
    { id: 'b', label: 'B', zone: 'start' },
    { id: 'bad1', label: 'Bad 1', zone: 'END' },
    { id: 'bad2', label: 'Bad 2', zone: 'right' },
    { id: 'bad3', label: 'Bad 3', zone: { x: 1 } },
    { type: 'search', id: 'q', zone: 'end' },
    { type: 'chips', id: 'f', label: 'Show', options: [{ id: 'a', label: 'A' }], zone: 'end' },
  ]));
  assert.deepEqual(mod.map((e) => e.id || e.type), ['view', 'a', 'b', 'bad1', 'bad2', 'bad3', 'q', 'filters', 'snap', 'grid'], 'left zone sorted as ever, search and Filters, then the module\'s right zone in the order made');
  assert.deepEqual(mod.filter((e) => e.zone === 'end').map((e) => e.id), ['snap', 'grid'], 'only exactly "end" goes right; a bad value stays left');
  assert.deepEqual(mod.filter((e) => e.pin).map((e) => e.id), ['snap'], 'a module\'s right zone holds only its icon-only buttons (the Snap toggle); the labelled one folds into More as needed');
  assert.equal(R.cleanToolbarItems([{ id: 'p', label: 'P', pin: true }])[0].pin, undefined, 'a module cannot pin a left item');
  assert.equal(R.cleanToolbarItems([{ id: 'p', label: 'P', zone: 'end', pin: true }])[0].pin, undefined, 'a module cannot pin a right-zone item either');
  // At most two of a module's right-zone buttons are held (so 16 of them cannot cut the row); a right-zone switch is never held.
  const manyRight = R.frameToolbar(R.cleanToolbarItems([
    ...Array.from({ length: 12 }, (_, k) => ({ id: `r${k}`, title: `R${k}`, icon: 'star', zone: 'end' })),
    { type: 'tabs', id: 'sw', value: 'a', options: [{ id: 'a', label: 'A', icon: 'star' }, { id: 'b', label: 'B', icon: 'star' }], zone: 'end' },
  ]));
  assert.equal(manyRight.filter((e) => e.pin).length, 2, 'two right-zone buttons held, no more');
  assert.ok(!manyRight.find((e) => e.id === 'sw').pin, 'a right-zone switch is not held (it folds its own choices)');
  // A destination page wraps a module's cleaned items with `send` (partItems): they keep no pin, no zone, and do not fix the order.
  const wrapped = R.cleanToolbarItems(R.cleanToolbarItems([
    { id: 'b', label: 'B' }, { type: 'tabs', id: 'v', value: 'a', options: [{ id: 'a', label: 'A' }] }, { id: 'snap', title: 'Snap', icon: 'border-all', zone: 'end' },
  ]).map(({ pin, zone, ...item }) => ({ ...item, send: noop })));
  assert.ok(wrapped.every((i) => !i.pin && !i.zone), 'wrapped module items keep no pin and no zone');
  assert.deepEqual(R.frameToolbar(wrapped).map((e) => e.id), ['v', 'b', 'snap'], 'the switch still leads (not the page\'s order)');
  assert.ok(/map\(\(\{ pin, zone, \.\.\.item \}\) =>/.test(read('public/destination.js')), 'partItems strips a module item\'s pin and zone');
  const modOnly = R.frameToolbar(R.cleanToolbarItems([{ id: 'x', label: 'X' }, { type: 'tabs', id: 'v', value: 'a', options: [{ id: 'a', label: 'A' }] }, { id: 'r', label: 'R', zone: 'end' }]));
  assert.deepEqual(modOnly.map((e) => e.id), ['v', 'x', 'r'], 'a module right-zone item does not stop the switches leading the left zone');
  // A switch holds up to 12 options (the Whiteboard's Select, Hand, drawing tools and Select many in one); the 13th is cut.
  const opts = (n) => Array.from({ length: n }, (_, k) => ({ id: `o${k}`, label: `Option ${k}`, icon: 'star' }));
  for (const [n, kept] of [[10, 10], [12, 12], [13, 12]]) {
    assert.equal(R.cleanToolbarItems([{ type: 'tabs', id: 'sw', value: 'o0', options: opts(n) }])[0].options.length, kept, `${n} options: ${kept} kept`);
  }
  assert.equal(R.TOOLBAR_LIMITS.tabs, 12);
  // The switch's name is "Tools" (its accessible name and its heading in More); a module may give its own, plain text of at most 30
  // characters; a non-string, an empty one or one with HTML in it is ignored.
  const named = (label) => R.frameToolbar(R.cleanToolbarItems([{ type: 'tabs', id: 'sw', value: 'a', label, options: [{ id: 'a', label: 'A' }] }]))[0].label;
  assert.equal(named(undefined), 'Tools', 'the default name');
  assert.equal(named('Board'), 'Board', 'a module\'s own name');
  assert.equal(named('  Board   tools '), 'Board tools', 'spaces tidied');
  assert.equal(named('x'.repeat(50)), 'x'.repeat(30), 'cut at 30');
  for (const bad of ['', '   ', '<b>Board</b>', 'a > b', 42, { x: 1 }, ['a'], null]) assert.equal(named(bad), 'Tools', `ignored: ${JSON.stringify(bad)}`);
  // A switch's name loses direction controls and zero-width characters.
  assert.equal(named('Bo\u202Eard'), 'Board');
  assert.equal(named('\u200BBo\u2066a\u2069r\u2060d\uFEFF'), 'Board');
  assert.equal(named('\u202A\u202B\u202C\u202D\u202E'), 'Tools', 'only invisible characters: the default');
  const frameSrc = read('public/module-frame.js');
  assert.ok(!/'View'/.test(frameSrc), 'the frame never says "View" for a switch');
  assert.ok(/'aria-label': it\.label \|\| 'Tools'/.test(frameSrc) && /it\.type === 'switch' \? 'Tools'/.test(frameSrc), 'the frame names a switch "Tools" in the row and in More');
  // host.ui.toolbarButton / viewSwitch pass the same whitelisted field to host.toolbar.set.
  const hostSrc = read('public/sdk/host.js');
  assert.ok(/const zoneOf = \(z\) => \(z === 'start' \|\| z === 'end' \? \{ zone: z \} : \{\}\);/.test(hostSrc), 'the SDK whitelists zone to start or end');
  assert.ok(/toolbarButton: \(\{[^}]*\bzone\b[^}]*\}\) =>/.test(hostSrc) && /viewSwitch: \(\{[^}]*\bzone\b[^}]*\blabel\b[^}]*\}\) =>/.test(hostSrc), 'toolbarButton takes zone, viewSwitch zone and label');
  assert.equal((hostSrc.match(/\.\.\.zoneOf\(zone\)/g) || []).length, 2, 'both draw the whitelisted zone');
  // A toolbar button with no `on` is not a toggle: the SDK sends no `on`, and the page keeps none (no tick in More); true or false is kept.
  assert.ok(!/on: Boolean\(on\)/.test(hostSrc), 'toolbarButton does not turn a missing on into false');
  const plain = R.cleanToolbarItems([{ type: 'button', id: 'b1', label: 'One' }, { type: 'button', id: 'b2', label: 'Two', on: false }, { type: 'button', id: 'b3', label: 'Three', on: true }]);
  assert.deepEqual(plain.map((i) => i.on), [null, false, true], 'on stays unset, false or true as given');
  assert.deepEqual(R.cleanStatusItems(Array.from({ length: 8 }, (_, i) => ({ text: `item ${i}` })), 6).length, 6, 'a page may keep more status items than the default');
  assert.equal(R.cleanStatusItems(Array.from({ length: 8 }, (_, i) => ({ text: `item ${i}` }))).length, 4, 'the default is four');
  // The title bar's actions: the header's icons, then the toolbar buttons placed there; past five, the menu.
  const header = R.cleanHeaderItems([{ id: 'pin', icon: 'thumbtack', title: 'Pin', on: true }, { id: 'del', icon: 'trash', title: 'Delete', danger: true }, { id: 'more', icon: 'gear', title: 'Options', overflow: true }]);
  const acts = R.titlebarActions(header, clean);
  assert.deepEqual(acts.map((a) => [a.id, a.from, a.placement, Boolean(a.danger)]), [['pin', 'header', 'bar', false], ['del', 'header', 'bar', true], ['more', 'header', 'menu', false], ['export', 'toolbar', 'bar', false]]);
  assert.equal(acts[0].on, true);
  const many = R.titlebarActions(R.cleanHeaderItems(Array.from({ length: 7 }, (_, i) => ({ id: `h${i}`, icon: 'star', title: `H${i}` }))), []);
  assert.deepEqual(many.map((a) => a.placement), ['bar', 'bar', 'bar', 'bar', 'bar', 'menu', 'menu'], 'more than five icons: the rest in the menu');
  const frameJs0 = () => read('public/module-frame.js');
  // The title bar's select (host.header.set, kind 'select'): a clean shape, only the first, its label cut, not an icon, and
  // its menu `items` as data (the host draws it). No items: dropped.
  const IT = [{ id: 'a', label: 'A', current: true }];
  const sel = R.cleanHeaderItems([{ id: 'a', icon: 'star', title: 'A' }, { kind: 'select', id: 'boards-pick', label: `  Board\n 1 ${'x'.repeat(80)}`, title: 'Boards', disabled: 1, icon: 'star', danger: true, items: IT }, { kind: 'select', id: 'second', label: 'Two', items: IT }, { kind: 'select', id: '', label: 'No id', items: IT }, { kind: 'select', id: 'nolabel', label: '  ', items: IT }]);
  assert.deepEqual(sel.map((i) => i.id), ['a', 'boards-pick'], 'only the first select is kept; one with no id or no label is dropped');
  assert.deepEqual(sel[1], { kind: 'select', id: 'boards-pick', label: sel[1].label, title: 'Boards', disabled: true, items: [{ id: 'a', label: 'A', current: true }] }, 'a select is { kind, id, label, title, disabled, items } and nothing else (no icon, no danger)');
  assert.ok(sel[1].label.length === R.HEADER_SELECT_LABEL && sel[1].label.startsWith('Board 1 x'), `the label is one line, trimmed and cut to ${R.HEADER_SELECT_LABEL}`);
  assert.equal(R.cleanHeaderItems(Array.from({ length: 12 }, (_, i) => ({ kind: 'select', id: `s${i}`, label: 'L', items: IT }))).length, 1, 'twelve selects give one');
  assert.equal(R.cleanHeaderItems([...Array.from({ length: 10 }, (_, i) => ({ id: `h${i}`, icon: 'star', title: 'H' })), { kind: 'select', id: 's', label: 'L', items: IT }]).some((i) => i.kind === 'select'), false, 'the select counts in the 10 items');
  const withSel = R.titlebarActions(R.cleanHeaderItems([{ kind: 'select', id: 'pick', label: 'Board 1', title: 'Boards', items: IT }, ...Array.from({ length: 6 }, (_, i) => ({ id: `h${i}`, icon: 'star', title: `H${i}` }))]), []);
  assert.deepEqual(withSel.map((a) => a.placement), [undefined, 'bar', 'bar', 'bar', 'bar', 'bar', 'menu'], 'the select is not one of the five icons beside the menu');
  assert.equal(withSel[0].kind, 'select');
  assert.deepEqual(withSel[0].items, [{ id: 'a', label: 'A', current: true }], 'the frame gets the items');
  // The select's menu items.
  const one = (items) => R.cleanHeaderItems([{ kind: 'select', id: 's', label: 'L', items }]);
  const itemsOf = (items) => (one(items)[0] || {}).items;
  assert.equal(one(undefined).length, 0, 'a select with no items is dropped');
  assert.equal(one([]).length, 0, 'a select with an empty list is dropped');
  assert.equal(one([{ divider: true }, { heading: 'Only' }, { id: 'BAD ID', label: 'x' }, { id: 'ok', label: '' }, { id: 'n', label: 7 }, { id: 5, label: 'five' }]).length, 0, 'a select with nothing to pick is dropped');
  assert.deepEqual(itemsOf([{ id: 'a', label: 'A', icon: 'star', className: 'x', onClick() {}, hint: 'h', danger: true, disabled: true, extra: 1 }]), [{ id: 'a', label: 'A', disabled: true }], 'unknown keys (an icon, a class, a function, a hint) are dropped');
  assert.deepEqual(itemsOf([{ id: 'a', label: 'A', current: 'yes' }, { id: 'b', label: 'B', current: true }, { id: 'c', label: 'C', current: true }]), [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', current: true }, { id: 'c', label: 'C' }], 'current must be true and only the first one is kept');
  assert.deepEqual(itemsOf([{ id: 'a', label: 'A' }, { id: 'a', label: 'Again' }, { id: 'b', label: 'B', items: [{ id: 'a', label: 'dup in child' }, { id: 'c', label: 'C' }] }]), [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', items: [{ id: 'c', label: 'C' }] }], 'a duplicate id is dropped, in a child too');
  assert.deepEqual(itemsOf([{ id: 'a', label: 'A' }, { divider: true }, { divider: true }, { heading: '  Group ' }, { id: 'b', label: 'B' }, { divider: true }]), [{ id: 'a', label: 'A' }, { divider: true }, { heading: 'Group' }, { id: 'b', label: 'B' }], 'dividers: never first, twice in a row or last; a heading is text');
  const deep = itemsOf([{ id: 'm', label: 'M', items: [{ id: 'k', label: 'K', items: [{ id: 'g', label: 'G' }] }, { id: 'k2', label: 'K2' }] }]);
  assert.deepEqual(deep, [{ id: 'm', label: 'M', items: [{ id: 'k', label: 'K' }, { id: 'k2', label: 'K2' }] }], 'one level of children: a grandchild is dropped');
  assert.deepEqual(itemsOf([{ id: 'a', label: 'A' }, { id: 'm', label: 'M', items: [{ id: 'x', label: '' }] }]), [{ id: 'a', label: 'A' }, { id: 'm', label: 'M' }], 'a category with no usable child is a plain row');
  for (const bad of ['', 'a'.repeat(41), 'A', 'a b', 'a/b', 'é', '<b>']) assert.equal(itemsOf([{ id: bad, label: 'x' }, { id: 'keep', label: 'K' }]).length, 1, `id ${JSON.stringify(bad)} is dropped`);
  for (const good of ['a', 'a'.repeat(40), 'b.1', 'go-x_y', '0']) assert.ok(itemsOf([{ id: good, label: 'x' }]).some((r) => r.id === good), `id ${JSON.stringify(good)} is kept`);
  assert.equal(itemsOf(Array.from({ length: 80 }, (_, i) => ({ id: `r${i}`, label: `R${i}` }))).length, R.HEADER_MENU_MAX, 'at most 50 entries');
  const mixed = itemsOf([{ id: 'm', label: 'M', items: Array.from({ length: 70 }, (_, i) => ({ id: `c${i}`, label: 'C' })) }, ...Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, label: 'R' }))]);
  assert.equal(mixed.reduce((n, r) => n + 1 + (r.items ? r.items.length : 0), 0), 50, 'the 50 count the children too');
  // Hostile labels are text: no tags kept as markup, control characters out, long ones cut, a non-string dropped.
  const hostile = itemsOf([{ id: 'h', label: '<img src=x onerror=alert(1)>' }, { id: 'c', label: 'a\u0000b\u0007c\u202ed\u2028e' }, { id: 'l', label: 'y'.repeat(5000) }, { id: 'o', label: { toString: () => 'obj' } }, { id: 'n', label: null }, { id: 'f', label: () => 'fn' }]);
  assert.deepEqual(hostile.map((r) => r.id), ['h', 'c', 'l'], 'only string labels are kept');
  assert.equal(hostile[0].label, '<img src=x onerror=alert(1)>', 'markup stays as plain text (the frame sets it with textContent; check-title-select.mjs proves it inert)');
  assert.ok(!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(hostile[1].label), 'control characters are removed');
  assert.equal(hostile[2].label.length, R.HEADER_ITEM_LABEL, `a long label is cut to ${R.HEADER_ITEM_LABEL}`);
  const hostSel = R.cleanHeaderItems([{ kind: 'select', id: 's', label: 'y\u0000'.repeat(100), title: 'T'.repeat(500), items: IT }])[0];
  assert.ok(hostSel.label.length === R.HEADER_SELECT_LABEL && hostSel.title.length === 40 && !/[\u0000-\u001f]/.test(hostSel.label), 'the select label (40) and title (40) are cut and clean too');
  assert.equal(R.cleanHeaderItems([{ kind: 'select', id: 's', label: 'L', items: 'not a list' }]).length, 0, 'items that are not a list: dropped');
  // An ordinary icon item's title is cleaned the same way.
  const iconTitle = (title) => R.cleanHeaderItems([{ id: 'a', icon: 'star', title }])[0];
  assert.equal(iconTitle('Pi‮n​s').title, 'Pins', 'icon title: override and zero-width space removed');
  assert.equal(iconTitle('A B').title, 'A B', 'icon title: U+2028 becomes a space');
  assert.equal(iconTitle('שלום').title, 'שלום', 'icon title: RTL letters stay');
  assert.equal(iconTitle('x'.repeat(10240)).title.length, 40, 'icon title: 10 KB cut to 40');
  assert.equal(iconTitle('‮​⁦').title, '', 'icon title: only invisible characters is empty');
  assert.equal(iconTitle(undefined).title, '', 'icon title: missing is empty, the item stays');
  // Invisible and direction characters, one case per class: gone from the select label, title, item labels and headings.
  const classes = { 'bidi override (U+202A-202E)': '‪‫‬‭‮', 'bidi isolate (U+2066-2069)': '⁦⁧⁨⁩', 'marks (U+200E, U+200F, U+061C)': '‎‏؜', 'zero width (U+200B-200D, U+2060, U+FEFF)': '​‌‍⁠﻿' };
  for (const [name, chars] of Object.entries(classes)) {
    const s2 = one([{ heading: `H${chars}ead` }, { id: 'a', label: `A${chars}B` }]).length ? R.cleanHeaderItems([{ kind: 'select', id: 's', label: `L${chars}x`, title: `T${chars}t`, items: [{ heading: `H${chars}ead` }, { id: 'a', label: `A${chars}B` }] }])[0] : null;
    assert.ok(s2 && s2.label === 'Lx' && s2.title === 'Tt' && s2.items[0].heading === 'Head' && s2.items[1].label === 'AB', `${name}: removed from label, title, heading and item label`);
    assert.equal(one([{ id: 'a', label: chars }]).length, 0, `${name}: a label of only these is empty, so the item is dropped`);
  }
  const sep = one([{ id: 'a', label: 'A B C\u0085D' }])[0].items[0];
  assert.equal(sep.label, 'A B C D', 'line and paragraph separators and U+0085 become spaces');
  assert.equal(one([{ id: 'a', label: '  \u0085' }]).length, 0, 'line separators only: dropped');
  assert.equal(one([{ id: 'a', label: 'שלום עולם مرحبا' }])[0].items[0].label, 'שלום עולם مرحبا', 'right-to-left letters (Hebrew, Arabic) survive');
  assert.equal(one([{ id: 'a', label: 'Fun 🎉 🚀' }])[0].items[0].label, 'Fun 🎉 🚀', 'plain emoji survive');
  assert.equal(one([{ id: 'a', label: '👩‍🚀' }])[0].items[0].label, '👩🚀', 'U+200D is stripped everywhere (the safe choice), so a joined emoji shows as separate emoji');
  // Size caps, and an untrusted module never breaks the title bar.
  const huge = R.cleanHeaderItems([{ kind: 'select', id: 's', label: 'x'.repeat(10240), items: Array.from({ length: 5000 }, (_, i) => ({ id: `i${i}`, label: 'y'.repeat(10240) })) }])[0];
  assert.ok(huge.label.length === R.HEADER_SELECT_LABEL && huge.items.length === R.HEADER_MENU_MAX && huge.items.every((r) => r.label.length === R.HEADER_ITEM_LABEL), '5000 items and 10 KB labels are cut to 50 entries and 60-character labels, without throwing');
  const bad = Array.from({ length: 5000 }, () => ({ id: 'BAD ID', label: 'z' }));
  assert.equal(R.cleanHeaderItems([{ kind: 'select', id: 's', label: 'L', items: [...bad, { id: 'late', label: 'Late' }] }]).length, 0, 'only the first 50 entries are looked at');
  const cyc = { kind: 'select', id: 's', label: 'L', items: [{ id: 'a', label: 'A' }] };
  cyc.items[0].items = cyc.items; cyc.self = cyc;
  assert.doesNotThrow(() => R.cleanHeaderItems([cyc, cyc]), 'a cyclic items object does not throw');
  assert.equal(R.cleanHeaderItems([cyc])[0].items[0].items, undefined, 'a cycle gives no children (one level, only rows with ids count)');
  const evil = { kind: 'select', id: 's', label: 'L', items: [{ id: 'a', label: 'A' }] };
  Object.defineProperty(evil, 'title', { get() { throw new Error('boom'); } });
  const evilRow = { kind: 'select', id: 's2', label: 'L', items: [{ id: 'a', get label() { throw new Error('boom'); } }] };
  const okIcon = { id: 'ok', icon: 'star', title: 'Ok' };
  let evilOut;
  assert.doesNotThrow(() => { evilOut = R.cleanHeaderItems([evil, evilRow, { get id() { throw new Error('boom'); } }, okIcon]); }, 'getters that throw do not throw out of the cleaner');
  assert.deepEqual(evilOut.map((i) => i.id), ['ok'], 'the items that threw are dropped, the others stay');
  assert.doesNotThrow(() => R.cleanHeaderItems({ get length() { throw new Error('boom'); } }), 'a non-array items value is no items');
  assert.match(read('public/module-host.js'), /try \{ clean = cleanHeaderItems\(items\); \} catch/, 'the header.set handler also catches whatever the cleaner could not');
  const hostJs = read('public/module-host.js');
  assert.match(hostJs, /if \(a\.kind === 'select'\) \{ if \(typeof e\.value === 'string'\) to\(a, 'header', \{ id: a\.id, value: e\.value \}, e\.el\); \}/, 'a pick in the select arrives as the header event with id and value, and the button itself sends nothing');
  assert.ok(!/x: xOf\(e\.el\) \} : \{\}\) \}, e\.el\)/.test(hostJs.split("if (a.from === 'header')")[1].split('\n').slice(0, 4).join('\n')), 'the select\'s old x field is gone');
  assert.match(hostJs, /async 'focus\.opener'\(\)[\s\S]*?doc\.activeElement !== frame[\s\S]*?o\.el\.focus\(\)/, 'a menu a module draws with no anchor gives focus back to the control it answered (toolbar and icon buttons), only while the keyboard is in the module');
  const frameSrc2 = frameJs0();
  assert.match(frameSrc2, /openHostMenu\(b, selectItems\(a, b\)\)/, 'the select opens the host menu under its button');
  assert.ok(!/settleKey|wasOpen/.test(frameSrc2), 'the old "the module draws the menu" bookkeeping is gone (host-menu.js keeps aria-expanded and the focus)');
  assert.match(read('public/sdk/host.js'), /else if \(!outside && framed\)[^\n]*focus\.opener/, 'the shared menu asks for the focus back only when it was not closed by a press elsewhere');
  assert.match(frameSrc2, /filter\(\(a\) => a\.kind !== 'select'\)/, 'the select is never an icon or a menu entry');
  // The frame draws a destructive action last in its menu, red, never as an icon.
  const frameJs = read('public/module-frame.js');
  assert.match(frameJs, /if \(a\.placement !== 'bar' \|\| a\.danger\) continue;/, 'a destructive action is never an icon');
  assert.match(frameJs, /const danger = \[\.\.\.actions\.filter\(\(a\) => a\.danger\)\.map\(entry\), \.\.\.hostDanger\];/, 'the destructive ones last: the module\'s, then the host\'s Clear');
  assert.match(frameJs, /const runs = \[own, standard, Array\.isArray\(extra\) \? extra : \[\], danger\]\.filter\(\(r\) => r\.length\);/, 'own, a line, the standard actions, a line, the window\'s own entries (the stack entries), a line, the destructive ones');
});

test('the "+": one entry for one add (Thomas, 2026-10-14: the Map\'s "+" offered "Add a place" twice)', () => {
  // The same add sent twice by one module (a redraw that did not replace the list) is one entry.
  const twice = R.cleanAddEntries([{ id: 'place', label: 'Add a place', icon: 'location-dot' }, { id: 'place2', label: 'Add a place', icon: 'location-dot' }]);
  assert.equal(twice.length, 1, 'the same label and icon twice is one');
  assert.equal(R.cleanAddEntries([{ id: 'a', label: 'Add a place', icon: 'location-dot' }, { id: 'b', label: 'Add a place', icon: 'plane' }]).length, 2, 'the same words with another icon are two adds');
  const cats = R.cleanAddEntries([{ label: 'A', items: [{ id: 'x', label: 'Same' }, { id: 'y', label: 'Other' }] }, { label: 'B', items: [{ id: 'z', label: 'Same' }, { id: 'w', label: 'Else' }] }]);
  assert.equal(cats.reduce((n, e) => n + e.items.length, 0), 4, 'a name in two categories is two adds');
  // Two parts of one page (a composite's Map and its Places panel) offering the same add: the later one leaves it out.
  const parts = R.dropRepeatedAdds([
    [{ id: 'place', label: 'Add a place', icon: 'location-dot' }],
    [{ id: 'place', label: 'Add a place', icon: 'location-dot' }, { id: 'other', label: 'Add a note' }],
  ]);
  assert.deepEqual(parts, [[{ id: 'place', label: 'Add a place', icon: 'location-dot' }], [{ id: 'other', label: 'Add a note' }]], 'the first part keeps it');
  assert.deepEqual(R.dropRepeatedAdds([[], null]), [[], []]);
  // destination.js builds the composite's "+" through it, and the bundled Map and Places both still offer "Add a place".
  assert.match(read('public/destination.js'), /dropRepeatedAdds\(parts\.map\(\(p\) => p\.adds\)\)/, 'the composite\'s "+" drops an add two parts both offer');
  const label = (f) => (read(f).match(/ADD_PLACE = (?:\{[^}]*label: |)'([^']+)'/) || [])[1];
  assert.equal(label('modules/maps/src/maps.js'), label('modules/places/src/places.js'), 'Map and Places word the add alike, which is how the two are seen as one');
});

test('a composite\'s editor window: the Workspace lifts the frame, as it does a sandboxed module\'s', () => {
  const canvas = read('public/canvas.js');
  const dest = read('public/destination.js');
  const host = read('public/module-host.js');
  assert.match(host, /export function createFrameLift\(/, 'one lift for both kinds of frame');
  assert.match(host, /\.\.\.\(liftUp \? \{ lift:/, 'a part in a composite\'s page gives its SDK the lift');
  assert.match(canvas, /createFrameLift\(frame, \{/, 'the composite\'s frame is lifted by the canvas');
  assert.match(canvas, /app:compositelift/, 'the canvas answers the page\'s lift');
  assert.match(dest, /liftUp: liftComposite/, 'the destination page asks for it when it is in a composite\'s frame');
  assert.match(dest, /app:compositeevent/, 'the Workspace\'s Close reaches the part as editordismiss');
});

// Settings, Share and Print: the engine's standard actions, reusable by every module (Thomas, 2026-10-29). A module hands the
// host a handler (host.standard.set); the host draws the entry, the same everywhere, only for a handler it has.
test('Settings, Share and Print: drawn by the host for the handlers a module gave, the same in every module', () => {
  assert.deepEqual(R.MODULE_STANDARD, ['settings', 'share', 'print'], 'the order: Settings, Share, Print');
  assert.deepEqual(R.cleanStandardActions({ settings: true, share: { disabled: 1, hint: '  Nothing to share yet  ', label: 'Send' }, print: false, clear: true, dock: true }),
    { settings: {}, share: { disabled: true, hint: 'Nothing to share yet' } }, 'only the three, true or { disabled, hint }; never the module\'s words, never a window action');
  assert.deepEqual(R.cleanStandardActions(null), {}, 'nothing given: none drawn');
  assert.equal(R.cleanStandardActions({ print: { hint: 'x'.repeat(90) } }).print.hint.length, 40, 'a hint is cut to 40');
  // What Share shows: a whole https address, or a path on this server made whole; nothing else.
  const o = 'https://example.test';
  assert.deepEqual(R.cleanShareResult({ url: '/s/abc', title: 'Share the list', message: '  Anyone  with it  can see it. ' }, o), { url: 'https://example.test/s/abc', title: 'Share the list', message: 'Anyone with it can see it.' });
  assert.equal(R.cleanShareResult({ url: 'https://a.test/x' }, o).title, 'Share', 'the heading is Share unless given');
  for (const bad of [null, {}, { url: '' }, { url: 'javascript:alert(1)' }, { url: '//evil.test/x' }, { url: 'data:text/html,x' }, { url: 'x'.repeat(2001) }]) assert.equal(R.cleanShareResult(bad, o), null, JSON.stringify(bad).slice(0, 40));
  // The frame: the three are the host's entries (words, icons, order) and come only from moduleStandard, picked through onPick.
  const frameJs = read('public/module-frame.js');
  assert.ok(frameJs.includes("{ id: 'settings', label: 'Settings', icon: 'gear', module: true },"));
  assert.ok(frameJs.includes("{ id: 'share', label: 'Share', icon: 'share-nodes', module: true },"));
  assert.ok(frameJs.includes("{ id: 'print', label: 'Print', icon: 'print', module: true },"));
  assert.ok(frameJs.indexOf("id: 'popout'") < frameJs.indexOf("id: 'settings'") && frameJs.indexOf("id: 'print'") < frameJs.indexOf("id: 'clear'"), 'after the ways to show it, before Clear');
  assert.ok(frameJs.includes("const v = s.module ? (typeof mod.onPick === 'function' ? mod[s.id] : false) : std[s.id] === undefined ? !s.off : std[s.id];"), 'drawn only for a handler the module gave, never by the window');
  assert.ok(frameJs.includes("label: (!s.module && o.label) || s.label"), 'the host\'s words, never the module\'s');
  assert.ok(frameJs.includes('onPick: s.module ? () => mod.onPick(s.id, menuEl) : () => tbFire({ id: s.id, standard: true, el: menuEl }),'), 'a pick goes to the module\'s handler');
  for (const [file, text] of [['public/module.js', read('public/module.js')], ['public/canvas.js', canvas], ['public/destination.js', read('public/destination.js')]]) {
    assert.ok(!/settings: false|share: false|print: false/.test(text), `${file}: a window no longer lists Settings, Share or Print (the module's, not the window's)`);
  }
  // The host: the module's declaration drawn in the frame; Share and Print answered only within a minute of the pick.
  assert.match(host, /standard\(spec\) \{\n\s+const clean = cleanStandardActions\(spec\);\n\s+frame\.setTitlebar\(\{ moduleStandard: \{ \.\.\.clean, onPick: \(id, el\) => \{ asked = \{ id, at: Date\.now\(\), el \}; send\('standard', \{ id \}\); \} \} \}\);/, 'createFrameBands draws them and sends the pick');
  assert.match(host, /const answering = \(id\) => asked && asked\.id === id && Date\.now\(\) - asked\.at < 60000;/, 'never unasked');
  assert.match(host, /shareDialog\(frame\.el\.ownerDocument, clean\);/, 'one Share dialog, the host\'s');
  assert.match(host, /return printFrame\(frame\.el, \{ iframe, height \}\);/, 'Print prints the frame\'s content area');
  assert.match(host, /async 'standard\.set'\(\{ actions \}\) \{\n\s+if \(!standardOut\) return false;/, 'false on a destination\'s part and a widget');
  const sdk = read('public/sdk/host.js');
  assert.match(sdk, /standard: \{\n\s+set: \(spec\) => setStandard\(spec\),\n\s+\},/, 'host.standard.set');
  assert.match(sdk, /if \(!o \|\| \(o\.permission && !host\.can\(o\.permission\)\)\) continue;/, 'left out for a person without the permission it names');
  assert.match(sdk, /if \(r\) await call\('share\.show', r\);/, 'Share: what the handler answered goes to the host\'s dialog');
  assert.match(sdk, /if \(\(await fn\(\)\) === false\) return;/, 'Print: the handler may stop it');
  const actions = read('public/module-actions.js');
  assert.match(actions, /const copy = make\('button', 'btn btn-primary', 'Copy link'\);/, 'the Share dialog copies the link');
  assert.match(actions, /win\.print\(\);/, 'Print prints the window the frame is in');
  const sys = read('public/sdk/system.css');
  const block = sys.slice(sys.indexOf('/* moduleframe:start */'), sys.indexOf('/* moduleframe:end */'));
  assert.match(block, /@media print \{[\s\S]*?\.mf\.mf-printing > :not\(\.mf-content\) \{ display: none; \}/, 'printed: the content area alone');
  // No bundled module had a Settings, Share or Print of its own to move onto the engine (checked 2026-10-29), so none
  // registers one yet; the Prototype shows all three.
  assert.match(read('public/design-system/prototype.js'), /moduleStandard: \{ settings: true, share: true, print: true, onPick:/, 'the Prototype shows all three');
});

test('module-given text everywhere is cleaned like the title bar select\'s (toolbar, "+", old bar, status, share)', () => {
  const hostile = (w) => `${w}‮​ ؜\u0007x`; // override, zero-width space, line separator, Arabic mark, control char
  const clean = (w) => `${w} x`; // the separator and the control become one space; the rest is gone
  const tb = (item) => R.cleanToolbarItems([item])[0];
  const L = R.TOOLBAR_LIMITS;
  // toolbar sites
  for (const type of ['text', 'title']) {
    assert.equal(tb({ type, text: hostile('ab') }).text, clean('ab'), `${type}: text cleaned`);
    assert.equal(tb({ type, text: 'שלום' }).text, 'שלום', `${type}: RTL stays`);
    assert.equal(tb({ type, text: 'y'.repeat(10240) }).text.length, L[type], `${type}: 10 KB cut to its cap`);
    assert.equal(tb({ type, text: '‮​ ؜' }), undefined, `${type}: invisible only is empty, dropped`);
  }
  const tabs = (label) => tb({ type: 'tabs', id: 't', label, options: [{ id: 'a', label, icon: 'star' }] });
  assert.equal(tabs(hostile('ab')).options[0].label, clean('ab'), 'tab option label cleaned');
  assert.equal(tabs(hostile('ab')).label, clean('ab'), 'switch label cleaned');
  assert.equal(tabs('שלום').options[0].label, 'שלום', 'tab label: RTL stays');
  assert.equal(tabs('y'.repeat(10240)).options[0].label.length, L.label, 'tab label: 10 KB cut to its cap');
  assert.equal(tabs('‮​ ؜').options[0].label, '', 'tab label: invisible only is empty (the icon keeps the option)');
  assert.equal(tabs('‮​ ؜').label, undefined, 'switch label: invisible only is left out');
  const search = (o) => tb({ type: 'search', id: 'q', ...o });
  assert.equal(search({ placeholder: hostile('ab') }).placeholder, clean('ab'), 'search placeholder cleaned');
  assert.equal(search({ label: hostile('ab') }).label, clean('ab'), 'search label cleaned');
  assert.equal(search({ label: 'שלום', placeholder: 'שלום' }).label, 'שלום', 'search: RTL stays');
  assert.equal(search({ placeholder: 'y'.repeat(10240) }).placeholder.length, L.placeholder, 'search placeholder: 10 KB cut');
  assert.equal(search({ label: 'y'.repeat(10240) }).label.length, L.placeholder, 'search label: 10 KB cut');
  assert.equal(search({ label: '‮​', placeholder: '​' }).label, 'Search', 'search: invisible only falls back to the default');
  const chips = (o) => tb({ type: 'chips', id: 'c', label: 'L', options: [{ id: 'a', label: 'A' }], ...o });
  assert.equal(chips({ options: [{ id: 'a', label: hostile('ab'), note: hostile('n') }] }).options[0].label, clean('ab'), 'chip option label cleaned');
  assert.equal(chips({ options: [{ id: 'a', label: 'A', note: hostile('n') }] }).options[0].note, clean('n'), 'chip note cleaned');
  assert.equal(chips({ label: hostile('ab') }).label, clean('ab'), 'chips label cleaned');
  assert.equal(chips({ label: 'שלום', options: [{ id: 'a', label: 'שלום' }] }).options[0].label, 'שלום', 'chips: RTL stays');
  assert.equal(chips({ label: 'y'.repeat(10240), options: [{ id: 'a', label: 'y'.repeat(10240) }] }).label.length, 60, 'chips label: 10 KB cut to 60');
  assert.equal(chips({ options: [{ id: 'a', label: 'y'.repeat(10240) }] }).options[0].label.length, 40, 'chip option label: 10 KB cut to 40');
  assert.equal(chips({ label: '‮​' }).label, 'Filter', 'chips label: invisible only falls back to the default');
  assert.equal(tb({ type: 'chips', id: 'c', options: [{ id: 'a', label: '‮​ ' }] }), undefined, 'chip option: invisible only is empty, dropped');
  const button = (o) => tb({ id: 'b', label: 'B', ...o });
  assert.equal(button({ label: hostile('ab') }).label, clean('ab'), 'button label cleaned');
  assert.equal(button({ title: hostile('ab') }).title, clean('ab'), 'button title cleaned');
  assert.equal(button({ label: 'שלום', title: 'שלום' }).title, 'שלום', 'button: RTL stays');
  assert.equal(button({ label: 'y'.repeat(10240) }).label.length, L.label, 'button label: 10 KB cut');
  assert.equal(button({ title: 'y'.repeat(10240) }).title.length, 40, 'button title: 10 KB cut to 40');
  assert.equal(tb({ id: 'b', label: '‮​' }), undefined, 'button label: invisible only is empty, no icon: dropped');
  assert.equal(tb({ id: 'b', label: '‮​', icon: 'star' }).label, '', 'button label: invisible only is empty, the icon keeps it');
  // ids and values are not text: left as they were
  assert.equal(search({ value: 'a‮b' }).value, 'a‮b', 'a search value is not cleaned');
  // "+" entries, old bar, status, share, standard hint
  const add = R.cleanAddEntries([{ id: 'a', label: hostile('ab'), hint: hostile('h') }, { label: hostile('cat'), items: [{ id: 'c1', label: 'C1' }, { id: 'c2', label: 'C2' }] }]);
  assert.equal(add[0].label, clean('ab'), '"+" label cleaned');
  assert.equal(add[0].hint, clean('h'), '"+" hint cleaned');
  assert.equal(add[1].label, clean('cat'), '"+" category label cleaned');
  assert.equal(R.cleanAddEntries([{ id: 'a', label: 'שלום' }])[0].label, 'שלום', '"+": RTL stays');
  assert.equal(R.cleanAddEntries([{ id: 'a', label: 'y'.repeat(10240), hint: 'y'.repeat(10240) }])[0].label.length, R.ADD_LIMITS.label, '"+": 10 KB cut');
  assert.equal(R.cleanAddEntries([{ id: 'a', label: '‮​' }]).length, 0, '"+": invisible only label is dropped');
  const bar = R.foldBarItems([{ id: 'a', label: hostile('ab') }, { id: 'q', type: 'quickadd', label: '​', placeholder: hostile('ph') }]).entries;
  assert.deepEqual(bar.map((e) => e.label), [clean('ab'), clean('ph')], 'old bar: label and quick-add placeholder cleaned');
  const st = R.cleanStatusItems([{ text: hostile('ab'), title: hostile('tt') }, { text: '‮​' }, { text: 'שלום' }, { text: 'y'.repeat(10240), title: 'y'.repeat(10240) }]);
  assert.deepEqual([st[0].text, st[0].title], [clean('ab'), clean('tt')], 'status text and title cleaned');
  assert.equal(st.length, 3, 'status: invisible only text is dropped');
  assert.equal(st[1].text, 'שלום', 'status: RTL stays');
  assert.deepEqual([st[2].text.length, st[2].title.length], [R.STATUS_LIMITS.text, R.STATUS_LIMITS.title], 'status: 10 KB cut to the caps');
  assert.equal(R.cleanShareResult({ url: 'https://example.com/a', title: hostile('ab') }).title, clean('ab'), 'share title cleaned');
  assert.equal(R.cleanStandardActions({ share: { hint: hostile('ab') } }).share.hint, clean('ab'), 'standard action hint cleaned');
  // a throwing getter or a cyclic object drops that item (or entry), the others stay, nothing throws
  const boom = { get type() { throw new Error('boom'); } };
  const boomText = { type: 'text', get text() { throw new Error('boom'); } };
  const cyc = { type: 'text', text: 'c' }; cyc.self = cyc; cyc.options = [cyc];
  const cycTabs = { type: 'tabs', id: 't', options: [{ id: 'a', label: 'A' }] }; cycTabs.options.push(cycTabs);
  const ok = { type: 'text', text: 'ok' };
  let out;
  assert.doesNotThrow(() => { out = R.cleanToolbarItems([boom, boomText, ok, cycTabs]); }, 'toolbar: hostile items do not throw');
  assert.deepEqual(out.map((i) => i.text || i.id), ['ok', 't'], 'toolbar: the throwing items are dropped, the rest stay');
  assert.doesNotThrow(() => R.cleanToolbarItems(new Proxy([], { get() { throw new Error('boom'); } })), 'toolbar: an unreadable list does not throw');
  assert.equal(R.cleanToolbarItems(cyc).length, 0, 'toolbar: not a list');
  assert.deepEqual(R.cleanToolbarItems([cyc]).map((i) => i.text), ['c'], 'toolbar: a cyclic object is fine');
  const boomAdd = { id: 'a', get label() { throw new Error('boom'); } };
  assert.deepEqual(R.cleanAddEntries([boomAdd, { id: 'b', label: 'B' }, { get items() { throw new Error('boom'); } }]).map((e) => e.id), ['b'], '"+": throwing entries dropped');
  assert.deepEqual(R.foldBarItems([{ get id() { throw new Error('boom'); } }, { id: 'b', label: 'B' }]).entries.map((e) => e.id), ['b'], 'old bar: a throwing item dropped');
  assert.deepEqual(R.cleanStatusItems([{ get text() { throw new Error('boom'); } }, { text: 'ok' }]).map((i) => i.text), ['ok'], 'status: a throwing item dropped');
  // the host: toolbar.set never throws out
  assert.match(read('public/module-host.js'), /try \{ toolbarOut\(items\); \} catch/, 'toolbar.set: the handler does not throw out');
});

if (failures.length) {
  console.error(`check-module-chrome: ${failures.length} failed`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-module-chrome: OK (${passed} checks)`);
