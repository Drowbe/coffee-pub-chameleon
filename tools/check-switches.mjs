#!/usr/bin/env node
/*
 * check-switches.mjs -- the view switch is built once.
 *
 * A view switch (host.ui.viewSwitch in a module's toolbar or its own page, Chat's Private | Shared, a destination's
 * switches) is a .tb-tabs of .tb-tab choices, each an icon and a word. Its rules sit between the markers
 * tabs:start and tabs:end in public/sdk/system.css (the Tabs component, once), and its
 * drawing and fit are hostSwitch in public/sdk/host.js (fill, fit, watch): while the words do not fit the switch's
 * container, the switch shows its icons only. This fails when:
 *   - the Tabs block is missing, an old copy of the rules is back in style.css or host.css, or the icons-only rule is gone;
 *   - host.ui.viewSwitch drops an option's icon on the way to the toolbar, or draws anywhere but the toolbar (its `element`
 *     option is gone: the host draws the toolbar wherever a module is drawn; plan-unified-layout.md);
 *   - a choice in icons only loses its word as its accessible name and tooltip, a choice without an icon loses its word,
 *     the fit changes what is selected, or the words do not come back once they fit again;
 *   - a bundled module, or a host stylesheet outside the shared rules, sizes the switch itself;
 *   - the host's toolbar, Chat or the destination page stop drawing or fitting their switches the shared way;
 *   - a bundled module's view switch has a choice without an icon;
 *   - the segmented switch (.mf-switch) is not a radio group with one Tab stop whose arrow keys, Home and End move and choose
 *     with focus kept in the group (hostSwitch.keydown and rove, on a stand-in DOM), also when its click draws it again.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const problems = [];
const fail = (msg) => problems.push(msg);
let n = 0;
const test = async (name, fn) => {
  try {
    await fn();
    n += 1;
  } catch (err) {
    fail(`${name}: ${err.message}`);
  }
};

// --- 1. The rules ---------------------------------------------------------------------------------------------------
const SIZE_PROPS = /^(width|height|min-width|min-height|max-width|max-height|padding|padding-[a-z]+|font|font-size|line-height|gap)$/;

function rules(text) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length));
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) {
    const selector = m[1].trim();
    if (selector.startsWith('@')) continue;
    const decls = m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const i = d.indexOf(':');
      return [d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim()];
    });
    out.push({ selector, decls });
  }
  return out;
}
// A selector aimed at the switch or one of its parts (its last compound names a tb-tab class).
const aimsAtSwitch = (selector) => selector.split(',').some((s) => /\.tb-tab(s|-glyph|-word|-icon)?\b(?![-\w])/.test(s.trim().split(/\s+|>|~|\+/).filter(Boolean).pop() || ''));

const system = read('public/sdk/system.css');
const TABS_BLOCK = /\/\* tabs:start[\s\S]*?\/\* tabs:end \*\//g;
const found = [...system.matchAll(TABS_BLOCK)];
let a = null;
if (found.length !== 1) fail(`public/sdk/system.css: needs exactly one tabs:start ... tabs:end block, found ${found.length}`);
else a = found[0][0];
// The old copies are gone: the view switch's rules are the Tabs component in system.css, once.
for (const rel of ['public/style.css', 'public/sdk/host.css']) {
  if (/\/\* view-switch:start/.test(read(rel))) fail(`${rel}: still has a view-switch:start block; the view switch's rules live once, in the Tabs block of public/sdk/system.css`);
}
if (a) {
  const declared = rules(a);
  const has = (s) => declared.some((r) => r.selector.replace(/\s+/g, ' ').includes(s));
  for (const s of ['.tb-tabs', '.tb-tab', '.on', '.tb-tab-glyph', '.tb-tabs-compact > :is(.sdk-tab, .tb-tab) > :is(.sdk-tab-glyph, .tb-tab-glyph) ~ :is(.sdk-tab-word, .tb-tab-word)']) {
    if (!has(s)) fail(`the Tabs block has no rule for ${s}`);
  }
  // Icons only hides the word only where there is an icon before it: a choice without one keeps its word.
  const HIDE = /^\.tb-tabs-compact > :is\(\.sdk-tab, \.tb-tab\) > :is\(\.sdk-tab-glyph, \.tb-tab-glyph\) ~ :is\(\.sdk-tab-word, \.tb-tab-word\)$/;
  const hide = declared.find((r) => HIDE.test(r.selector.replace(/\s+/g, ' ').trim()));
  if (hide && !hide.decls.some(([k, v]) => k === 'display' && v === 'none')) fail('the icons-only rule must hide the word (display: none) after an icon');
  for (const r of declared) {
    if (/-tab-word/.test(r.selector) && r.decls.some(([k, v]) => k === 'display' && v === 'none') && !HIDE.test(r.selector.replace(/\s+/g, ' ').trim())) {
      fail(`"${r.selector}" hides a choice's word outside icons only, or without an icon before it`);
    }
  }
  // Colours are the theme's tokens.
  for (const r of declared) {
    for (const [k, v] of r.decls) if (/color|background|border/.test(k) && /#[0-9a-f]{3,8}\b|rgb\(/i.test(v)) fail(`the Tabs block's ${r.selector} { ${k} } uses a fixed colour; use a theme token`);
  }
}

// Outside the shared rules nothing sizes the switch: the host's stylesheets (their own placement, colours and
// flex are theirs) and every bundled module's CSS, inline <style> and script-made CSS.
const hostSheets = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.css')).map((f) => `public/${f}`).concat('public/sdk/host.css');
for (const rel of hostSheets) {
  const text = read(rel);
  for (const r of rules(text)) {
    if (!aimsAtSwitch(r.selector)) continue;
    const sized = r.decls.filter(([k]) => SIZE_PROPS.test(k)).map(([k]) => k);
    if (sized.length) fail(`${rel}: "${r.selector}" sizes the view switch (${sized.join(', ')}) outside the shared view-switch rules`);
  }
}
const moduleFiles = [];
for (const id of fs.readdirSync(path.join(ROOT, 'modules'))) {
  const src = path.join(ROOT, 'modules', id, 'src');
  if (!fs.existsSync(src)) continue;
  for (const f of fs.readdirSync(src)) if (/\.(css|html|js)$/.test(f) && !/-lib-|\.min\./.test(f)) moduleFiles.push(`modules/${id}/src/${f}`);
}
for (const rel of moduleFiles) {
  const text = read(rel);
  const css = rel.endsWith('.css') ? text : rel.endsWith('.html') ? [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n') : text;
  for (const r of rules(css)) {
    if (!aimsAtSwitch(r.selector)) continue;
    const sized = r.decls.filter(([k]) => SIZE_PROPS.test(k)).map(([k]) => k);
    if (sized.length) fail(`${rel}: "${r.selector.replace(/\s+/g, ' ').slice(-80)}" sizes the view switch (${sized.join(', ')}); the SDK's view-switch rules size it`);
  }
}

// --- 2. The SDK and the shared fit, run on their own ----------------------------------------------------------------
// A small stand-in for the DOM: class selectors only (".a", ":scope > .a", "[data-x]"), a width per element that
// follows the shared rules (a word shows unless its switch is in icons only and an icon comes before it).
class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { for (const x of c) this.set.add(x); }
  remove(...c) { for (const x of c) this.set.delete(x); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) { const on = force === undefined ? !this.set.has(c) : Boolean(force); if (on) this.set.add(c); else this.set.delete(c); return on; }
}
class FakeEl {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.tagName = tag.toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentElement = null;
    this.attrs = new Map();
    this.dataset = {};
    this.classList = new ClassList();
    this.text = '';
    this.listeners = {};
    this.style = {};
    this.fixedWidth = null;
  }
  get className() { return [...this.classList.set].join(' '); }
  set className(v) { this.classList = new ClassList(); for (const c of String(v).split(/\s+/).filter(Boolean)) this.classList.add(c); }
  get title() { return this.attrs.get('title') || ''; }
  set title(v) { this.attrs.set('title', String(v)); }
  get isConnected() { return true; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
  append(...cs) { for (const c of cs) if (typeof c === 'string') this.text += c; else this.appendChild(c); }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children = []; this.text = String(v); }
  set innerHTML(v) { this.children = []; this.text = ''; this.html = String(v); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  click() { for (const fn of this.listeners.click || []) fn({ target: this }); let p = this.parentElement; while (p) { for (const fn of p.listeners.click || []) fn({ target: this }); p = p.parentElement; } }
  matchesOne(s) {
    const is = /^:is\((.*)\)$/.exec(s);
    if (is) return is[1].split(',').some((x) => this.matchesOne(x.trim()));
    if (s.includes(',')) return s.split(',').some((x) => this.matchesOne(x.trim()));
    if (s.startsWith('[data-')) return Object.prototype.hasOwnProperty.call(this.dataset, s.slice(6, -1).replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
    if (s.startsWith('.')) return s.slice(1).split('.').every((c) => this.classList.contains(c));
    return this.tagName === s.toUpperCase();
  }
  closest(s) { let e = this; while (e) { if (e.matchesOne(s)) return e; e = e.parentElement; } return null; }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(s) {
    const scoped = /^:scope\s*>\s*(.+)$/.exec(s);
    return scoped ? this.children.filter((c) => c.matchesOne(scoped[1].trim())) : this.all().filter((c) => c.matchesOne(s));
  }
  querySelector(s) { return this.querySelectorAll(s)[0] || null; }
  contains(e) { return e === this || this.all().includes(e); }
  // Widths: a glyph 15, a word 7 a letter, a choice's padding and border 22, the parts' gap 5.
  naturalWidth() {
    if (this.fixedWidth !== null) return this.fixedWidth;
    if (this.classList.contains('tb-tab') || this.classList.contains('mf-switch-btn')) {
      const compact = this.parentElement && this.parentElement.classList.contains('tb-tabs-compact');
      const glyph = this.querySelector(':scope > :is(.tb-tab-glyph, i)');
      const word = this.querySelector(':scope > :is(.tb-tab-word, .mf-word)');
      const wordShows = word && !(compact && glyph);
      return 22 + (glyph ? 15 : 0) + (wordShows ? word.textContent.length * 7 : 0) + (glyph && wordShows ? 5 : 0);
    }
    return this.children.reduce((sum, c) => sum + c.naturalWidth(), 0);
  }
  getBoundingClientRect() { const w = this.naturalWidth(); return { width: w, height: 24, left: 0, top: 0, right: w, bottom: 24 }; }
  get clientWidth() { return this.boxWidth ?? this.naturalWidth(); }
  get scrollWidth() { return Math.max(this.clientWidth, this.naturalWidth()); }
}
const observers = [];
const view = {
  addEventListener() {},
  requestAnimationFrame: (fn) => { fn(); return 1; },
  ResizeObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe(el) { this.el = el; } },
  document: null,
};
const fakeDoc = { createElement: (tag) => new FakeEl(fakeDoc, tag), defaultView: view, head: null };
view.document = fakeDoc;
fakeDoc.head = fakeDoc.createElement('head');

const sdk = read('public/sdk/host.js');
const win = { addEventListener() {}, location: { search: '' } };
win.parent = win;
new Function('window', 'document', sdk)(win, fakeDoc);

const calls = [];
const call = async (method, params) => {
  calls.push([method, params]);
  if (method === 'hello') return { module: { id: 'todo' }, context: { scope: 'space', spaceId: 'r' } };
  if (method === 'icons.svg') return `<svg data-name="${params.name}" data-style="${params.style}"></svg>`;
  return true;
};
const { host, emit } = win.createHost({ call, root: fakeDoc, rootElement: fakeDoc.createElement('div') });
const tick = () => new Promise((r) => setTimeout(r, 0));
const sw = win.hostSwitch;

await test('the SDK shares the switch with the host pages (hostSwitch: fill, fit, watch)', () => {
  assert.ok(sw && typeof sw.fill === 'function' && typeof sw.fit === 'function' && typeof sw.watch === 'function');
});

await test('host.ui.viewSwitch takes an icon per choice and sends it to the toolbar', async () => {
  calls.length = 0;
  let picked = null;
  const s = host.ui.viewSwitch({ id: 'view', options: [{ id: 'month', label: 'Month', icon: 'calendar-days' }, { id: 'open', label: 'Open', icon: 'circle', regular: true }, { id: 'all', label: 'All' }], value: 'month', onChange: (v) => { picked = v; } });
  await tick();
  const set = calls.filter(([m]) => m === 'toolbar.set').pop();
  assert.ok(set, 'no toolbar.set');
  const opts = set[1].items[0].options;
  assert.equal(opts[0].icon, 'calendar-days');
  assert.equal(opts[1].icon, 'circle');
  assert.equal(opts[1].regular, true);
  assert.equal(opts[2].icon, undefined);
  emit('toolbar', { id: 'view', value: 'all' });
  assert.equal(picked, 'all');
  s.destroy();
});

const container = (width) => {
  const box = fakeDoc.createElement('div');
  box.boxWidth = width;
  const g = fakeDoc.createElement('span');
  g.className = 'tb-tabs';
  box.appendChild(g);
  return { box, g };
};
const choice = (g, o, on) => {
  const btn = fakeDoc.createElement('button');
  sw.fill(btn, o);
  if (on) btn.classList.add('on');
  btn.setAttribute('aria-pressed', String(Boolean(on)));
  g.appendChild(btn);
  return btn;
};

await test('a choice shows its icon and its word, its word its accessible name', () => {
  const { g } = container(400);
  const btn = choice(g, { id: 'week', label: 'Week', icon: 'calendar-week' });
  const glyph = btn.querySelector(':scope > .tb-tab-glyph');
  assert.ok(glyph, 'no icon');
  assert.ok(/fa-calendar-week/.test(glyph.className) && /fa-solid/.test(glyph.className), glyph.className);
  assert.equal(glyph.getAttribute('aria-hidden'), 'true');
  assert.equal(btn.querySelector(':scope > .tb-tab-word').textContent, 'Week');
  assert.equal(btn.getAttribute('aria-label'), 'Week');
  assert.equal(btn.dataset.tip, undefined, 'a choice that shows its word needs no tooltip');
  const reg = choice(g, { id: 'open', label: 'Open', icon: 'circle', regular: true });
  assert.ok(/fa-regular/.test(reg.querySelector(':scope > .tb-tab-glyph').className));
  const bad = choice(g, { id: 'x', label: 'X', icon: 'not an icon"' });
  assert.equal(bad.querySelector(':scope > .tb-tab-glyph'), null, 'an icon name that is not one is not drawn');
});

await test('wide: the switch keeps its words; narrow: icons only, each word kept as title and aria-label', () => {
  const { box, g } = container(1000);
  const day = choice(g, { id: 'day', label: 'Day', icon: 'calendar-day' }, true);
  const agenda = choice(g, { id: 'list', label: 'Agenda', icon: 'list' });
  const plain = choice(g, { id: 'all', label: 'All' });
  sw.fit(box);
  assert.equal(g.classList.contains('tb-tabs-compact'), false, 'compact when the words fit');
  assert.equal(day.dataset.tip, undefined);
  box.boxWidth = 120; // narrower than the words (about 200), wide enough for the icons
  sw.fit(box);
  assert.equal(g.classList.contains('tb-tabs-compact'), true, 'not compact when the words do not fit');
  for (const [btn, word] of [[day, 'Day'], [agenda, 'Agenda']]) {
    assert.equal(btn.getAttribute('aria-label'), word, `${word}: accessible name lost in icons only`);
    assert.equal(btn.dataset.tip, word, `${word}: no tooltip in icons only`);
    assert.equal(btn.querySelector(':scope > .tb-tab-word').textContent, word, `${word}: the word is gone, not hidden`);
  }
  // A choice without an icon keeps its word: there is no icon for the rule to hide it after.
  assert.equal(plain.querySelector(':scope > .tb-tab-glyph'), null);
  assert.equal(plain.querySelector(':scope > .tb-tab-word').textContent, 'All');
  assert.ok(plain.naturalWidth() > 22, 'a choice without an icon lost its word');
  // What is selected does not change.
  assert.equal(day.classList.contains('on'), true);
  assert.equal(day.getAttribute('aria-pressed'), 'true');
  assert.equal(agenda.classList.contains('on'), false);
  // The words fit again: the words come back and the tooltips the fit added go.
  box.boxWidth = 1000;
  sw.fit(box);
  assert.equal(g.classList.contains('tb-tabs-compact'), false, 'still compact once the words fit again');
  assert.equal(day.dataset.tip, undefined);
  assert.equal(day.getAttribute('aria-label'), 'Day');
});

await test('a title the page set itself is kept; a hidden container keeps the words', () => {
  const { box, g } = container(40);
  const btn = choice(g, { id: 'private', label: 'Private', icon: 'lock' });
  btn.title = 'Only you see AI answers';
  sw.fit(box);
  assert.equal(btn.title, 'Only you see AI answers');
  box.boxWidth = 1000;
  sw.fit(box);
  assert.equal(btn.title, 'Only you see AI answers');
  const hidden = container(0);
  choice(hidden.g, { id: 'a', label: 'Alpha', icon: 'lock' });
  sw.fit(hidden.box);
  assert.equal(hidden.g.classList.contains('tb-tabs-compact'), false);
});

await test('an icon-only choice (iconOnly) always has its word as title and aria-label', () => {
  const { g } = container(400);
  const btn = choice(g, { id: 'grid', label: 'Cards', icon: 'grip', iconOnly: true });
  assert.equal(btn.querySelector(':scope > .tb-tab-word'), null);
  assert.equal(btn.dataset.tip, 'Cards');
  assert.equal(btn.getAttribute('aria-label'), 'Cards');
  assert.ok(btn.classList.contains('tb-tab-icon'));
});

await test('the frame\'s joined switch (.mf-switch, Chat\'s Discussion | Assistant) fits the same way', () => {
  const box = fakeDoc.createElement('div');
  const g = box.appendChild(fakeDoc.createElement('span'));
  g.className = 'mf-switch';
  const part = (label, icon) => {
    const b = g.appendChild(fakeDoc.createElement('button'));
    b.className = 'mf-switch-btn';
    const i = b.appendChild(fakeDoc.createElement('i'));
    i.className = `fa-solid fa-${icon} fa-fw`;
    const w = b.appendChild(fakeDoc.createElement('span'));
    w.className = 'mf-word';
    w.textContent = label;
    return b;
  };
  const talk = part('Discussion', 'comments');
  part('Assistant', 'wand-magic-sparkles');
  box.boxWidth = 1000;
  sw.fit(box);
  assert.equal(g.classList.contains('tb-tabs-compact'), false, 'compact when the words fit');
  box.boxWidth = 80;
  sw.fit(box);
  assert.equal(g.classList.contains('tb-tabs-compact'), true, 'not compact when the words do not fit');
  assert.equal(talk.getAttribute('aria-label'), 'Discussion');
  assert.equal(talk.dataset.tip, 'Discussion', 'no tooltip in icons only');
  box.boxWidth = 1000;
  sw.fit(box);
  assert.equal(talk.dataset.tip, undefined, 'the tooltip the fit added stays once the words fit again');
});

await test('watch fits again when its container changes size', () => {
  const { box, g } = container(1000);
  choice(g, { id: 'money', label: 'Money', icon: 'coins' });
  sw.watch(box);
  assert.equal(g.classList.contains('tb-tabs-compact'), false);
  box.boxWidth = 30;
  const ro = observers.find((o) => o.el === box);
  assert.ok(ro, 'not observed');
  ro.fn([]);
  assert.equal(g.classList.contains('tb-tabs-compact'), true);
});

await test('host.ui.viewSwitch is always in the toolbar: an `element` is not drawn in', async () => {
  const el = fakeDoc.createElement('span');
  calls.length = 0;
  const s = host.ui.viewSwitch({ id: 'filter-elementless', element: el, options: [{ id: 'open', label: 'Open', icon: 'circle', regular: true }, { id: 'all', label: 'All' }], value: 'open', onChange: () => {} });
  const sets = calls.filter(([m]) => m === 'toolbar.set');
  assert.equal(sets.length, 1, 'the switch went to the toolbar');
  assert.ok(sets[0][1].items.some((i) => i.type === 'tabs' && i.id === 'filter-elementless'), 'as a tabs item');
  assert.equal(el.querySelectorAll(':scope > .tb-tab').length, 0, 'nothing is drawn in the element');
  s.destroy();
});

// The segmented switch's keyboard (hostSwitch.keydown, the document's listener; hostSwitch.rove): a radio group. A small
// stand-in DOM of its own: a document with activeElement, a group, its parts (focus, click, tabIndex, data-key).
const keyDoc = () => {
  const d = { activeElement: null, groups: [], defaultView: { getComputedStyle: () => ({ direction: 'ltr' }) } };
  d.querySelectorAll = (s) => (s === '.mf-switch-btn' ? d.groups.flatMap((g) => (g.isConnected ? g.children : [])) : []);
  d.querySelector = (s) => d.querySelectorAll(s)[0] || null;
  return d;
};
const keyGroup = (d, words, chosen, onPick) => {
  const g = { isConnected: true, children: [], classList: { contains: (c) => c === 'mf-switch' } };
  for (const w of words) {
    const b = {
      nodeType: 1, ownerDocument: d, parentElement: g, disabled: false, hidden: false, tabIndex: 0, dataset: { key: `switch:view:${w}` }, attrs: { 'aria-checked': String(w === chosen) },
      classList: { contains: (c) => c === 'mf-switch-btn' },
      get isConnected() { return g.isConnected; },
      matches: (s) => s === '.mf-switch > .mf-switch-btn',
      getAttribute(k) { return this.attrs[k] ?? null; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getRootNode: () => d,
      focus() { d.activeElement = this; },
      click() { onPick(w, g); },
      word: w,
    };
    g.children.push(b);
  }
  d.groups.push(g);
  return g;
};
const press = (b, key, extra = {}) => { const e = { key, defaultPrevented: false, altKey: false, ctrlKey: false, metaKey: false, ...extra, composedPath: () => [b], preventDefault() { this.defaultPrevented = true; } }; sw.keydown(e); return e; };
const stops = (g) => g.children.filter((b) => b.tabIndex === 0).map((b) => b.word);

await test('the segmented switch is a radio group: arrows move and choose, Home and End, focus stays in it, one Tab stop (Tab leaves)', () => {
  assert.equal(typeof sw.keydown, 'function', 'hostSwitch.keydown');
  assert.equal(typeof sw.rove, 'function', 'hostSwitch.rove');
  const d = keyDoc();
  const pick = (w, g) => { for (const b of g.children) b.setAttribute('aria-checked', String(b.word === w)); };
  const g = keyGroup(d, ['list', 'month', 'map'], 'month', pick);
  sw.rove(g);
  assert.deepEqual(stops(g), ['month'], 'the chosen part is the one Tab stop, so Tab leaves the group');
  const [list, month, map] = g.children;
  month.focus();
  const chosen = () => g.children.find((b) => b.getAttribute('aria-checked') === 'true').word;
  assert.ok(press(month, 'ArrowRight').defaultPrevented, 'an arrow is the switch\'s, not the page\'s');
  assert.equal(chosen(), 'map', 'Right chooses the next');
  assert.equal(d.activeElement, map, 'and focus moves with it');
  assert.deepEqual(stops(g), ['map'], 'the Tab stop follows the choice');
  press(map, 'ArrowDown');
  assert.equal(chosen(), 'list', 'Down past the end goes round to the first');
  assert.equal(d.activeElement, list);
  press(list, 'ArrowLeft');
  assert.equal(chosen(), 'map', 'Left before the first goes round to the last');
  press(map, 'ArrowUp');
  assert.equal(chosen(), 'month', 'Up chooses the one before');
  press(month, 'Home');
  assert.equal(chosen(), 'list', 'Home: the first');
  press(list, 'End');
  assert.equal(chosen(), 'map', 'End: the last');
  assert.ok(g.children.includes(d.activeElement), 'focus never left the group');
  const tab = press(map, 'Tab');
  assert.equal(tab.defaultPrevented, false, 'Tab is left to the browser: with one Tab stop it leaves the group');
  assert.equal(press(map, 'ArrowRight', { altKey: true }).defaultPrevented, false, 'a key with a modifier is not the switch\'s');
  // A disabled or hidden part is passed over.
  month.disabled = true;
  press(list, 'ArrowRight');
  assert.equal(chosen(), 'map', 'a disabled part is skipped');
  month.disabled = false;
  // Nothing chosen (the Planner's "How you get there" before a way is set): the first part is the Tab stop.
  const none = keyGroup(keyDoc(), ['walk', 'drive'], null, pick);
  sw.rove(none);
  assert.deepEqual(stops(none), ['walk'], 'with none chosen, the first part is the Tab stop');
});

await test('a switch drawn again by its own click (the module frame) keeps the focus on the same part, found by its key', () => {
  const d = keyDoc();
  let g = null;
  const redraw = (w, old) => { old.isConnected = false; g = keyGroup(d, ['day', 'week', 'month'], w, redraw); };
  g = keyGroup(d, ['day', 'week', 'month'], 'day', redraw);
  sw.rove(g);
  g.children[0].focus();
  press(g.children[0], 'ArrowRight');
  assert.equal(d.activeElement && d.activeElement.word, 'week', 'focus is on the new week part');
  assert.ok(g.children.includes(d.activeElement), 'in the switch drawn again');
  assert.deepEqual(stops(g), ['week'], 'which is the Tab stop');
});

// --- 3. Every switch draws and fits the shared way, and every bundled one has its icons ------------------------------
// A module's switch is drawn by the module frame (public/module-frame.js, drawSwitch): each choice its icon and its word,
// and the row is fitted as one (fit: the switches show only their icons while the row is too narrow, the words their
// tooltips), again as the row changes size.
const frameJs = read('public/module-frame.js');
const switchDraw = frameJs.slice(frameJs.indexOf('  function drawSwitch(it) {'), frameJs.indexOf('  function tabsMenu('));
if (!/if \(o\.icon\) b\.append\(icon\(o\.icon, '', o\.regular\)\);/.test(switchDraw) || !/b\.append\(word\(o\.label\)\)/.test(switchDraw)) fail('public/module-frame.js: a switch\'s choice is its icon and its word');
if (!/role: 'radiogroup'/.test(switchDraw) || !/role: 'radio', 'aria-checked': String\(o\.id === it\.value\)/.test(switchDraw)) fail('public/module-frame.js: a switch is a radio group and each choice a radio that says whether it is chosen');
if (!/const FOLDS = \['chips', 'switch',/.test(frameJs) || !/\.mf-fold-switch \.mf-switch-btn:has\(> i\) > \.mf-word \{ display: none; \}/.test(read('public/sdk/system.css'))) fail('public/module-frame.js: the switch shows only its icons while the row is too narrow');
if (!/if \(iconic\(b\)\) b\.dataset\.tip = name;/.test(frameJs)) fail('public/module-frame.js: a folded choice\'s word is its tooltip');
if (!/observer = new win\.ResizeObserver\(later\);/.test(frameJs)) fail('public/module-frame.js: the row is fitted again as it changes size');
if (!/label: plain\(o\?\.label, TOOLBAR_LIMITS\.label\), icon: icon\(o\?\.icon\)/.test(read('public/module-chrome.js'))) fail('public/module-chrome.js: cleanToolbarItems must keep a tabs option\'s icon');
if (!/if \(i\.type === 'tabs'\) place\(\{ type: 'switch', id: i\.id, label: i\.label \|\| SWITCH_LABEL, value: i\.value, options: i\.options\.map/.test(read('public/module-chrome.js'))) fail('public/module-chrome.js: a tabs item is the frame\'s switch, its options (and icons) kept');
const destination = read('public/destination.js');
// The destination's view switch and panel switch are tabs items of its one toolbar row (the frame draws and fits them).
if ((destination.match(/type: 'tabs'/g) || []).length < 2 || !/bands\.toolbar\(\[/.test(destination)) fail('public/destination.js: the view switch and the panel switch must be tabs items of the page\'s toolbar row (its frame)');
if (!/options: [a-z]+\.map\(\(p\) => \(\{ id: p\.key, label: p\.part\.label, icon:/.test(destination)) fail('public/destination.js: every panel in the panel switch needs an icon');
const destViews = /calendar:\s*\{\s*views:\s*\[([^\]]*)\]/.exec(destination);
if (!destViews || (destViews[1].match(/\{[^}]*\}/g) || []).some((o) => !/icon:/.test(o))) fail('public/destination.js: every view of the Calendar destination needs an icon');
function fnBodyOf(src, head) { const at = src.indexOf(head); if (at < 0) return ''; let d = 0; for (let i = src.indexOf('{', at); i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) return src.slice(at, i + 1); } return src.slice(at); }
// Chat's two views, Discussion | Assistant (GitHub #203), in place of the All | Private | Public filter: the module frame's
// view switch (.mf-switch, joined, the chosen part filled; Thomas, 2026-10-29), a radio group of two, the chosen one checked, each its
// own icon and word, the word its aria-label, the Discussion chosen to start; fitted to icons only by hostSwitch when narrow.
// Start call is a button of its own after the switch, never a part of it.
const chatInputJs = read('public/chat-input.js');
if (!/hostSwitch\.watch\(g\)/.test(chatInputJs)) fail('public/chat-input.js: Chat\'s Discussion | Assistant must be fitted with hostSwitch.watch');
const hostJs = read('public/sdk/host.js');
if (!/container\.querySelectorAll\('\.tb-tabs, \.mf-switch'\)/.test(hostJs) || !/g\.querySelectorAll\('\.tb-tab, \.mf-switch-btn'\)/.test(hostJs)) fail('public/sdk/host.js: hostSwitch.fit fits the frame\'s switch (.mf-switch) as well as the tabs');
if (!/\.mf-switch\.tb-tabs-compact > \.mf-switch-btn:has\(> i\) > \.mf-word \{\s*display: none;/.test(read('public/sdk/system.css'))) fail('public/sdk/system.css: a fitted .mf-switch drops its words, keeping its icons');
const spaceHtml = read('public/space.html');
if (/chat-ai-share|chat-ai-private|chat-ai-shared|chat-filter/.test(spaceHtml + chatInputJs)) fail('public/space.html: the old switches (#chat-ai-share, the #chat-filter filter) are gone');
if (!/<div class="mf-toolbar chat-views" id="chat-views" hidden>\s*<span class="mf-switch" role="radiogroup" aria-label="Chat views">/.test(spaceHtml)) fail('public/space.html: #chat-views holds the frame\'s view switch (.mf-switch, a named radio group) in the chat\'s toolbar (the frame\'s band), hidden until a space');
const chatRow = /<div class="mf-toolbar chat-views" id="chat-views" hidden>([\s\S]*?)<\/div>/.exec(spaceHtml)?.[1] || '';
if (/tb-tab|role="tab/.test(chatRow)) fail('public/space.html: Chat\'s views are not tabs any more (no .tb-tab, no tablist)');
for (const [id, icon, word, on] of [['chat-view-discussion', 'comments', 'Discussion', true], ['chat-view-assistant', 'wand-magic-sparkles', 'Assistant', false]]) {
  const m = new RegExp(`<button[^>]*id="${id}"[^>]*>([\\s\\S]*?)</button>`).exec(spaceHtml);
  if (!m) { fail(`public/space.html: #${id} is missing`); continue; }
  if (!/class="mf-switch-btn"/.test(m[0])) fail(`public/space.html: #${id} is a part of the frame's switch (.mf-switch-btn)`);
  if (!new RegExp(`<i class="fa-solid fa-${icon} fa-fw" aria-hidden="true"></i>`).test(m[1])) fail(`public/space.html: #${id} needs the ${icon} icon`);
  if (!new RegExp(`<span class="mf-word">${word}</span>`).test(m[1])) fail(`public/space.html: #${id} needs its word, ${word} (.mf-word)`);
  if (!new RegExp(`aria-label="${word}"`).test(m[0])) fail(`public/space.html: #${id} needs its word as aria-label`);
  if (!/aria-controls="messages"/.test(m[0])) fail(`public/space.html: #${id} controls #messages`);
  if (!new RegExp(`role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}"`).test(m[0])) fail(`public/space.html: #${id} is a radio that starts ${on ? 'chosen, the Tab stop' : 'not chosen, out of the Tab order'}`);
}
if (!/<p class="visually-hidden" id="chat-view-news" role="status" aria-live="polite"><\/p>/.test(spaceHtml)) fail('public/space.html: the Assistant\'s news is read out from a polite live region');
// Remembered per space for the browser session; the old filter's key is not read.
if (!/export const viewKey = \(spaceId\) => `chat-view:\$\{spaceId\}`;/.test(chatInputJs) || /chat-ai-share:|filterKey/.test(chatInputJs)) fail('public/chat-input.js: the view is kept as chat-view:<spaceId>, and the old keys are not read');
if (!/sessionStorage\.setItem\(viewKey\(id\), view\)/.test(chatInputJs) || !/readView\(sessionStorage\.getItem\(viewKey\(id\)\)\)/.test(chatInputJs)) fail('public/chat-input.js: the view is remembered in sessionStorage');
// The chosen part is checked and the Tab stop; the keys are the SDK's (no tablist of its own).
if (!/el\.setAttribute\('aria-checked', v === view \? 'true' : 'false'\);/.test(chatInputJs) || !/window\.hostSwitch\.rove\(/.test(chatInputJs)) fail('public/chat-input.js: the chosen view\'s button is checked and the switch roved');
if (/aria-selected|focusTab|ArrowRight: at \+ 1/.test(fnBodyOf(chatInputJs, 'function setView(') + chatInputJs.slice(chatInputJs.indexOf("for (const v of CHAT_VIEWS) {\n    $(`chat-view-${v}`)"), chatInputJs.indexOf("$('chat-command').addEventListener"))) ) fail('public/chat-input.js: no tab selection or tablist keys on Chat\'s switch');
// Start call: the shared primary button, put at the end of the row (after the switch, not in it).
if (!/\$\('chat-views'\)\?\.appendChild\(joinCallButton\)/.test(read('public/space.js'))) fail('public/space.js: Start call goes at the end of the chat\'s view row, after the switch');
// The page only filters: #messages carries data-view, each line data-in, and the stylesheet hides the rest.
const styleCss = read('public/style.css');
if (!/#messages\[data-view="discussion"\] > \[data-in="assistant"\],\s*#messages\[data-view="assistant"\] > :not\(\[data-in="assistant"\]\):not\(\[data-in="both"\]\):not\(\.chat-view-empty\) \{\s*display: none;/.test(styleCss)) fail('public/style.css: each view hides the lines it leaves out, and only those');
if (!/list\.dataset\.view = view;/.test(chatInputJs) || !/el\.dataset\.in = viewOf\(\{ visibility: state, kind, mine \}\);/.test(read('public/space.js'))) fail('public/chat-input.js and space.js: #messages carries data-view and each message data-in');

// Every bundled module's view switch: each choice has an icon. Its options are an array in the call, or a const array.
for (const rel of moduleFiles.filter((f) => f.endsWith('.js'))) {
  const text = read(rel);
  for (const m of text.matchAll(/host\.ui\.viewSwitch\(\{([\s\S]*?)\}\)/g)) {
    const optionsAt = /options:\s*(\[[\s\S]*?\]|[A-Za-z_$][\w$]*)/.exec(m[1]);
    if (!optionsAt) continue;
    let list = optionsAt[1];
    if (!list.startsWith('[')) {
      const def = new RegExp(`const ${list}\\s*=\\s*(\\[[\\s\\S]*?\\])`).exec(text);
      if (!def) continue;
      list = def[1];
    }
    for (const o of list.match(/\{[^{}]*\bid:[^{}]*\}/g) || []) {
      if (!/\bicon:\s*'[a-z0-9-]+'/.test(o)) fail(`${rel}: a view switch choice has no icon: ${o.replace(/\s+/g, ' ')}`);
    }
  }
}

// A sort is an order, not a filter (Thomas, 2026-10-29): Budget's Sort is a button on the left of its row that says the order
// now ("Sort: Date, earliest first") and opens the orders under it, one to pick; never a group in the Filters menu, where it
// was counted as applied whenever it was not the first order.
{
  const budget = read('modules/budget/src/budget.js');
  if (/type: 'chips', id: 'sort'/.test(budget)) fail('modules/budget/src/budget.js: the sort is back in the Filters menu (a chips group); it is a button on the left of the row');
  if (!/\{ type: 'button', id: 'sort', label: `Sort: \$\{SORT_WORDS\[state\.sort\]\}`, icon: '[a-z0-9-]+' \}/.test(budget)) fail('modules/budget/src/budget.js: the Sort button says the order now ("Sort: " and its words) and has an icon');
  if (!/else if \(e\.id === 'sort'\) chooser\(e, SORTS\.map\(\(id\) => \(\{ id, label: SORT_WORDS\[id\] \}\)\), state\.sort,/.test(budget)) fail('modules/budget/src/budget.js: the Sort button opens the orders under it, the one in use marked');
}

if (problems.length) {
  console.error(`check-switches: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`check-switches: ok (${n} cases, the shared rules, and every switch drawn the shared way with its icons)`);
