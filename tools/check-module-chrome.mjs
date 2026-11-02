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
  assert.match(make, /titlebar: \{ close: true, standard: \(\) => standardFor\(m\.id\), onAction: \(e\) => titlebarAction\(m\.id, e\) \}/, 'Close and the standard actions are the window\'s');
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
  assert.equal((sys.match(/--mf-title-h:/g) || []).length + (css.match(/--mf-title-h:/g) || []).length, 1, 'set in one place');
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
  // of sorting switches first. A module's own item has no say: the same words from a module are dropped.
  const noop = () => {};
  const zoned = R.cleanToolbarItems([
    { type: 'title', text: 'October 2026', send: noop, zone: 'start' },
    { id: 'prev', icon: 'chevron-left', title: 'Previous', send: noop, zone: 'start' },
    { type: 'tabs', id: 'mode', value: 'month', options: [{ id: 'month', label: 'Month' }], send: noop, zone: 'start' },
    { type: 'chips', id: 'f', label: 'Show', options: [{ id: 'a', label: 'A' }], send: noop },
    { type: 'tabs', id: 'panel', value: 'a', options: [{ id: 'a', label: 'Agenda' }, { id: 'b', label: 'To-do', count: 4 }], send: noop, zone: 'end', pin: true },
  ]);
  const zrow = R.frameToolbar(zoned);
  assert.deepEqual(zrow.map((e) => e.id || e.type), ['title', 'prev', 'mode', 'filters', 'panel'], 'the date group, the mode, the Filters button, then the right zone');
  assert.equal(zrow[4].zone, 'end');
  assert.equal(zrow[4].pin, true);
  assert.equal(zrow[4].options[1].count, 4, 'a switch choice keeps its count, which stays when its words fold');
  const stranger = R.cleanToolbarItems([{ type: 'tabs', id: 'panel', value: 'a', options: [{ id: 'a', label: 'A' }], zone: 'end', pin: true }]);
  assert.equal(stranger[0].zone, undefined, 'a module cannot put itself in the right zone');
  assert.equal(stranger[0].pin, undefined);
  assert.deepEqual(R.cleanStatusItems(Array.from({ length: 8 }, (_, i) => ({ text: `item ${i}` })), 6).length, 6, 'a page may keep more status items than the default');
  assert.equal(R.cleanStatusItems(Array.from({ length: 8 }, (_, i) => ({ text: `item ${i}` }))).length, 4, 'the default is four');
  // The title bar's actions: the header's icons, then the toolbar buttons placed there; past five, the menu.
  const header = R.cleanHeaderItems([{ id: 'pin', icon: 'thumbtack', title: 'Pin', on: true }, { id: 'del', icon: 'trash', title: 'Delete', danger: true }, { id: 'more', icon: 'gear', title: 'Options', overflow: true }]);
  const acts = R.titlebarActions(header, clean);
  assert.deepEqual(acts.map((a) => [a.id, a.from, a.placement, Boolean(a.danger)]), [['pin', 'header', 'bar', false], ['del', 'header', 'bar', true], ['more', 'header', 'menu', false], ['export', 'toolbar', 'bar', false]]);
  assert.equal(acts[0].on, true);
  const many = R.titlebarActions(R.cleanHeaderItems(Array.from({ length: 7 }, (_, i) => ({ id: `h${i}`, icon: 'star', title: `H${i}` }))), []);
  assert.deepEqual(many.map((a) => a.placement), ['bar', 'bar', 'bar', 'bar', 'bar', 'menu', 'menu'], 'more than five icons: the rest in the menu');
  // The frame draws a destructive action last in its menu, red, never as an icon.
  const frameJs = read('public/module-frame.js');
  assert.match(frameJs, /if \(a\.placement !== 'bar' \|\| a\.danger\) continue;/, 'a destructive action is never an icon');
  assert.match(frameJs, /const danger = \[\.\.\.actions\.filter\(\(a\) => a\.danger\)\.map\(entry\), \.\.\.hostDanger\];/, 'the destructive ones last: the module\'s, then the host\'s Clear');
  assert.match(frameJs, /const runs = \[own, standard, danger\]\.filter\(\(r\) => r\.length\);/, 'own, a line, the standard actions, a line, the destructive ones');
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

if (failures.length) {
  console.error(`check-module-chrome: ${failures.length} failed`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-module-chrome: OK (${passed} checks)`);
