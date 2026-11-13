#!/usr/bin/env node
/*
 * check-module-layout.mjs -- a module lays out its own content and draws none of the shared window
 * (documentation/plans/plan-unified-layout.md; the rules are in server/module-layout.js).
 *
 * The host draws the title row, the toolbar, the tab strip, the status line and the slot's padding. Cards, rows, lists, tables,
 * forms, fields, tabs and chips are the design system's. A module's CSS and markup fail the check when they:
 *   - give any property at all to a rule on a shared class (.sdk-card*, .sdk-row*, .sdk-list*, .sdk-table*, .sdk-form*,
 *     .sdk-field*, .sdk-tab*, .sdk-chip*, .sdk-toolbar*, .sdk-titlebar*, .sdk-status*, and the old hooks .tb-*, .mod-header*,
 *     .mod-toolbar*, .mod-status*, .mod-title*, .mod-content*);
 *   - style a <header>, or set padding, margin, height or min-height on html, body, .app, #app or the slot, or on a class
 *     named for a band (titlebar, toolbar, tabs, page-bar, status-line);
 *   - draw a bar of its own in markup (a <header>, an element with a band class, a host.toolbar.set fallback).
 * Dashboard widget files (*-widget.*) and the vendored MapLibre library are not read.
 *
 * What is still there today is on tools/check-module-layout-allow.json: { module, selector, reason, count }. A finding with no
 * entry fails, as does one over its entry's count; an entry with no reason, for a module that is not there, or that allows more
 * than the check finds fails, so the list only shrinks as modules move to the host-drawn components.
 *   node tools/check-module-layout.mjs                  the check (with its self-tests)
 *   node tools/check-module-layout.mjs --update         lower the counts to today's, drop entries now at zero (never raises)
 *   node tools/check-module-layout.mjs --init           write the list from today's findings (how it was first made)
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { scanSources, tally } = createRequire(import.meta.url)('../server/module-layout.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOW_FILE = path.join(ROOT, 'tools', 'check-module-layout-allow.json');

// The findings of one module folder (modules/<id>), as Map(selector -> count); null when it has no src/.
export function scanModuleDir(dir) {
  const src = path.join(dir, 'src');
  if (!fs.existsSync(src)) return null;
  const id = path.basename(dir);
  const files = fs.readdirSync(src)
    .filter((f) => /\.(css|html|js)$/.test(f) && !/-widget\./.test(f) && !/maplibre/i.test(f))
    .map((f) => ({ name: `modules/${id}/src/${f}`, kind: f.slice(f.lastIndexOf('.') + 1), text: fs.readFileSync(path.join(src, f), 'utf8') }));
  return tally(scanSources(files));
}

// The findings of every module under `root`/modules, as Map(module -> Map(selector -> count)).
export function scanModules(root) {
  const out = new Map();
  const dir = path.join(root, 'modules');
  for (const id of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    const found = scanModuleDir(path.join(dir, id));
    if (found) out.set(id, found);
  }
  return out;
}

// What a module folder breaks, as plain lines (empty when it passes), against the allow-list: a module in this repository is
// held to its entries, any other module (a buyer's) to none.
export function layoutProblems(dir) {
  const found = scanModuleDir(dir);
  if (!found) return [];
  const id = path.basename(dir);
  let allow = { entries: [] };
  try { allow = JSON.parse(fs.readFileSync(ALLOW_FILE, 'utf8')); } catch { /* none */ }
  return compare(new Map([[id, found]]), { entries: (allow.entries || []).filter((e) => e.module === id) }).problems;
}

// Problems (plain sentences) when `found` and `allow.entries` disagree; `notes` for counts that could drop.
export function compare(found, allow) {
  const problems = [];
  const notes = [];
  const entries = Array.isArray(allow?.entries) ? allow.entries : [];
  const seen = new Set();
  for (const e of entries) {
    const key = `${e.module}\u0000${e.selector}`;
    if (typeof e.module !== 'string' || typeof e.selector !== 'string' || !Number.isInteger(e.count) || e.count < 1) { problems.push(`allow-list entry ${JSON.stringify(e)} needs a module, a selector and a count of 1 or more`); continue; }
    if (seen.has(key)) problems.push(`allow-list lists ${e.module} "${e.selector}" twice`);
    seen.add(key);
    if (typeof e.reason !== 'string' || !e.reason.trim()) problems.push(`allow-list entry ${e.module} "${e.selector}" has no reason`);
    if (!found.has(e.module)) { problems.push(`allow-list names ${e.module}, which is not a module here`); continue; }
    const have = found.get(e.module).get(e.selector) || 0;
    if (e.count > have) problems.push(`${e.module} "${e.selector}": the list allows ${e.count} but the check finds ${have}; lower it (node tools/check-module-layout.mjs --update)`);
    else if (have > e.count) problems.push(`${e.module} "${e.selector}": ${have} found, ${e.count} allowed`);
  }
  for (const [id, sel] of found) {
    for (const [selector, count] of sel) {
      if (!seen.has(`${id}\u0000${selector}`)) problems.push(`${id} "${selector}": ${count} found, none allowed. Use the host-drawn component, or ask Thomas for an exception with his reason`);
    }
  }
  return { problems, notes };
}

// The slice (plan-unified-layout.md) that moves a selector off the list, for the first list's reasons.
const SLICE = { calendar: 2, maps: 2, todo: 3, polls: 4, research: 5, budget: 7, travel: 8, stream: 9, assistant: 9 };
function sliceFor(id, selector) {
  if (/sdk-(row|list)/.test(selector)) return 10;
  if (/sdk-card/.test(selector)) return 11;
  if (/sdk-(form|field)/.test(selector)) return 12;
  if (/sdk-table/.test(selector)) return 13;
  return SLICE[id] || 9;
}

function readAllow() {
  return JSON.parse(fs.readFileSync(ALLOW_FILE, 'utf8'));
}

function writeAllow(allow) {
  fs.writeFileSync(ALLOW_FILE, JSON.stringify(allow, null, 2) + '\n');
}

const ABOUT = 'check-module-layout: what a module still draws or restyles that the host should (plan-unified-layout.md). Each entry is a module, a selector, the reason it is allowed and a count; counts may only fall, and an entry the check no longer finds is deleted. Lower them with: node tools/check-module-layout.mjs --update';

function selfTest() {
  const scan = (files) => tally(scanSources(files));
  const css = (text) => scan([{ name: 'm.css', kind: 'css', text }]);
  const html = (text) => scan([{ name: 'm.html', kind: 'html', text }]);
  const js = (text) => scan([{ name: 'm.js', kind: 'js', text }]);
  // each rule, planted
  assert.equal(css('.sdk-card { padding: 4px }').get('.sdk-card'), 1, 'a shared class with a property fails');
  assert.equal(css('.x .sdk-row-title { color: red }').size, 1, 'any property on a shared class fails, even in a longer selector');
  assert.equal(css('@media (max-width: 400px) { .sdk-chip { margin: 0 } }').get('.sdk-chip'), 1, 'inside @media too');
  assert.equal(css('.sdk-tabs, .tb-tab { gap: 2px }').size, 2, 'each selector of a list counts');
  assert.equal(css('.mod-header { height: 30px }').size, 1, 'an old hook class fails');
  assert.equal(css('header.bar { display: flex }').size, 1, 'a header bar fails');
  assert.equal(css('body { padding: 10px }').size, 1, "the slot's padding fails");
  assert.equal(css('.app { min-height: 100% }').size, 1, "the slot's height fails");
  assert.equal(css('html, body { height: 100%; margin: 0 }').size, 2, 'html and body each');
  assert.equal(css('.my-toolbar { height: 40px }').size, 1, 'a band of its own with a height fails');
  assert.equal(css('.my-toolbar { color: red }').size, 0, 'a band class with a non-box property alone is not a layout finding');
  assert.equal(css('.grid .cell { padding: 4px } .pin { height: 8px } body { color: red } @keyframes k { from { height: 1px } }').size, 0, 'domain content and non-box slot properties pass');
  assert.equal(css('/* .sdk-card { padding: 1px } */ .sdk-card {}').size, 0, 'comments and empty rules are not read');
  assert.equal(html('<header class="bar"></header>').get('markup: <header>'), 1, 'a header element fails');
  assert.equal(html('<header class="sdk-card-head"></header>').size, 0, "the shared banded card's own head is not a header bar");
  assert.equal(html('<header class="sdk-card-headx"></header>').get('markup: <header>'), 1, 'a look-alike class still fails');
  assert.equal(html('<div class="sdk-toolbar"></div>').get('markup: class sdk-toolbar'), 1, 'a toolbar of its own fails');
  assert.equal(css('.mf-titlebar { color: red }').size, 1, "the frame's title bar class fails");
  assert.equal(css('.mf-icon-btn:hover { color: red }').size, 1, "any frame class fails");
  assert.equal(html('<div class="mf-toolbar"></div>').get('markup: class mf-toolbar'), 1, "the frame's toolbar in markup fails");
  assert.equal(html('<footer class="mf-status"></footer>').get('markup: class mf-status'), 1, "the frame's status band in markup fails");
  assert.equal(html('<div class="a page-bar"></div>').get('markup: class page-bar'), 1, 'a page-bar fails');
  assert.equal(html('<div class="tabs"></div>').get('markup: class tabs'), 1, 'a tabs strip fails');
  assert.equal(html('<div class="sdk-card sdk-row sdk-field"></div>').size, 0, 'using the shared classes in markup is the rule, not a finding');
  assert.equal(js("el.className = 'x sdk-titlebar'; row.classList.add('sdk-status-line');").size, 2, 'script class assignments are read');
  assert.equal(js('const html = `<div class="sdk-tabs">x</div>`;').get('markup: class sdk-tabs'), 1, 'markup in a script template');
  assert.equal(js('if (!host.toolbar.set({ items: [] })) drawMyBar();').get('markup: host.toolbar.set fallback'), 1, 'a toolbar.set fallback fails');
  assert.equal(js('host.toolbar.set({ items: [] });').size, 0, 'a plain toolbar.set call passes');
  assert.equal(js('// <header class="sdk-toolbar">\nconst a = 1;').size, 0, 'script comments are not read');
  // a planted module on disk, through the same reader
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'layout-'));
  try {
    const dir = path.join(tmp, 'modules', 'bad', 'src');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bad.css'), '.sdk-card { padding: 9px }\n');
    fs.writeFileSync(path.join(dir, 'bad.html'), '<header class="bar"></header>\n');
    fs.writeFileSync(path.join(dir, 'bad-widget.css'), '.sdk-card { padding: 9px }\n');
    const found = scanModules(tmp);
    assert.deepEqual([...found.get('bad')].sort(), [['.sdk-card', 1], ['markup: <header>', 1]], 'the planted module is read, its widget is not');
    // the allow-list rules
    const ok = { entries: [{ module: 'bad', selector: '.sdk-card', reason: 'because', count: 1 }, { module: 'bad', selector: 'markup: <header>', reason: 'because', count: 1 }] };
    assert.equal(compare(found, ok).problems.length, 0, 'an exact list passes');
    assert.equal(compare(found, { entries: ok.entries.slice(1) }).problems.length, 1, 'a finding with no entry fails');
    assert.equal(compare(found, { entries: [{ ...ok.entries[0], count: 2 }, ok.entries[1]] }).problems.length, 1, 'an entry that allows more than it finds fails');
    assert.equal(compare(new Map([['bad', new Map([['.sdk-card', 3], ['markup: <header>', 1]])]]), ok).problems.length, 1, 'a count that rose fails');
    assert.equal(compare(found, { entries: [{ ...ok.entries[0], reason: ' ' }, ok.entries[1]] }).problems.length, 1, 'a missing reason fails');
    assert.equal(compare(found, { entries: [...ok.entries, { module: 'gone', selector: 'x', reason: 'r', count: 1 }] }).problems.length, 1, 'an entry for a module that is not there fails');
    assert.equal(compare(found, { entries: [...ok.entries, ok.entries[0]] }).problems.length >= 1, true, 'a duplicate entry fails');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  selfTest();
  const found = scanModules(ROOT);
  if (process.argv.includes('--init')) {
    const entries = [];
    for (const [module, sel] of found) {
      for (const [selector, count] of [...sel].sort((a, b) => a[0].localeCompare(b[0]))) {
        entries.push({ module, selector, reason: `not yet moved to the host-drawn component (plan-unified-layout.md slice ${sliceFor(module, selector)})`, count });
      }
    }
    writeAllow({ about: ABOUT, entries });
    console.log(`wrote ${entries.length} entries`);
    process.exit(0);
  }
  const allow = readAllow();
  if (process.argv.includes('--update')) {
    const entries = [];
    for (const e of allow.entries) {
      const have = found.get(e.module)?.get(e.selector) || 0;
      if (have > 0) entries.push({ ...e, count: Math.min(e.count, have) });
    }
    writeAllow({ about: ABOUT, entries });
    console.log(`kept ${entries.length} of ${allow.entries.length} entries`);
    process.exit(0);
  }
  const { problems } = compare(found, allow);
  if (problems.length) {
    console.error('check-module-layout failed:\n' + problems.map((p) => `  ${p}`).join('\n'));
    process.exit(1);
  }
  const per = {};
  for (const e of allow.entries) per[e.module] = (per[e.module] || 0) + e.count;
  console.log(`check-module-layout: ok (${allow.entries.length} allowed entries, ${Object.values(per).reduce((a, b) => a + b, 0)} finds: ${Object.entries(per).map(([k, v]) => `${k} ${v}`).join(', ')})`);
}
