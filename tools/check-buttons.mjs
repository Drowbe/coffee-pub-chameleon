#!/usr/bin/env node
/*
 * check-buttons.mjs -- the Buttons family is defined once, in public/sdk/system.css (design system step 12).
 *
 * Four roles (Primary .btn-primary, Secondary .btn, Danger .btn-danger and Quiet .btn-quiet), two sizes (--btn-h, --btn-h-small) and
 * one icon-only button (.sdk-icon-btn) live in the block between `buttons:start` and `buttons:end` of system.css. This fails when:
 *   - the block is missing or has no rule for a role, a size, a state or the phone hit area; the heights are not 38px, 44px on a
 *     phone and 30px; a colour in the block is not a token; a state sets a border colour;
 *   - the old button selectors (.action-btn, .sdk-field-btn, .sdk-more, .icon-btn, .msg-btn, .tb-btn, .mod-add, .btn-accent, .sdk-dp-btn) are
 *     used in a stylesheet, in a script, or in the pages' markup;
 *   - a rule outside system.css, ending in a button class, restyles it (colour, fill, edge, size, type, corners): the page, the
 *     module stylesheets, host.css and the UI_CSS string may lay a button out (margin, flex, position) and may set the role's
 *     custom properties (--b-*, --btn-h), nothing more;
 *   - the call's round buttons (.fbtn) are sized outside their base rule (a smaller one sets --action-btn-h), or stop being buttons of
 *     the call bar, or the chat form gets a Send button again, or the host draws a module action bar again.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const problems = [];
const fail = (msg) => problems.push(msg);

// The innermost rules of a stylesheet, { selector, decls: [[prop, value]] }, comments taken out.
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

// 1. The block.
const system = read('public/sdk/system.css');
const blockMatch = /\/\* buttons:start \*\/([\s\S]*?)\/\* buttons:end \*\//.exec(system);
if (!blockMatch) fail('public/sdk/system.css: needs one buttons:start ... buttons:end block');
else {
  const block = blockMatch[1];
  const rs = rules(block);
  const has = (re) => rs.some((r) => re.test(r.selector));
  const need = [
    [/\.btn-primary/, 'Primary (.btn-primary)'], [/\.btn-danger(?!\.)/, 'Danger (.btn-danger)'], [/\.btn-danger\.solid/, 'the solid Danger (.btn-danger.solid)'],
    [/\.btn-quiet/, 'Quiet (.btn-quiet)'], [/\.btn-small/, 'the small size (.btn-small)'], [/\.sdk-icon-btn/, 'the icon-only button (.sdk-icon-btn)'],
    [/:hover/, 'the hover state'], [/:active/, 'the pressed state'], [/:focus-visible/, 'the focus ring'], [/:disabled/, 'the disabled state'],
    [/aria-busy/, 'the loading state'], [/\.on/, 'the selected state (.on, aria-pressed)'], [/::after/, 'the 44px hit area on a phone'],
  ];
  for (const [re, what] of need) if (!has(re)) fail(`system.css buttons block: no rule for ${what}`);
  if (/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(block)) fail('system.css buttons block: a raw colour; colours come from the tokens');
  for (const r of rs) {
    if (/:(hover|active|focus-visible|disabled)/.test(r.selector) && r.decls.some(([k]) => /^border(-color)?$/.test(k) && !/transparent|var\(--b-bd\)/.test(r.decls.find(([kk]) => kk === k)[1]))) fail(`system.css buttons block: "${r.selector}" changes the edge; a state is a fill`);
  }
  const tokens = read('public/sdk/system.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const tok = (name) => (new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(tokens) || [])[1]?.trim();
  if (tok('--btn-h') !== '38px') fail(`--btn-h must be 38px, it is ${tok('--btn-h')}`);
  if (tok('--btn-h-small') !== '30px') fail(`--btn-h-small must be 30px, it is ${tok('--btn-h-small')}`);
  if (!/@media \(max-width: 640px\)\s*\{\s*:root\s*\{[^}]*--btn-h:\s*44px/.test(tokens)) fail('--btn-h must be 44px at 640px and narrower');
  const shape = rs.find((r) => /^:is\(\.btn, \.sdk-btn, \.sdk-icon-btn\)$/.test(r.selector));
  const get = (p) => shape && (shape.decls.find(([k]) => k === p) || [])[1];
  if (!shape) fail('system.css buttons block: no shape rule for .btn, .sdk-btn and .sdk-icon-btn');
  else {
    if (get('height') !== 'var(--btn-h)') fail('the shape rule: height must be var(--btn-h)');
    if (get('border-radius') !== 'var(--radius-small)') fail('the shape rule: corners must be var(--radius-small)');
  }
  const icon = rs.find((r) => r.selector === '.sdk-icon-btn');
  if (!icon || (icon.decls.find(([k]) => k === 'width') || [])[1] !== 'var(--btn-h)') fail('.sdk-icon-btn must be square: width var(--btn-h)');
}

// 2. The old names are gone everywhere.
const OLD = /(^|[^-\w])(action-btn|sdk-field-btn|sdk-more|icon-btn|msg-btn|tb-btn|mod-add|btn-accent|sdk-dp-btn|sdk-editor-close-btn)(?![-\w])/;
const files = [];
const walk = (dir, accept) => {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/^(design-system|fa|fonts|maps-glyphs|models|assets|node_modules|design)$/.test(e.name)) walk(rel, accept); }
    else if (accept.test(e.name)) files.push(rel);
  }
};
walk('public', /\.(css|js|html)$/);
walk('modules', /\.(css|js|html)$/);
for (const rel of files) {
  if (/maplibre|\.min\./.test(rel)) continue;
  const lines = read(rel).split('\n');
  lines.forEach((line, i) => {
    const code = line.replace(/\/\*.*?\*\//g, '').replace(/(^|\s)\/\/.*$/, '');
    // "sdk-icon-btn" contains "icon-btn" after a hyphen, which the pattern skips; .menu-btn and .look-btn are other things.
    const m = OLD.exec(code);
    if (m) fail(`${rel}:${i + 1}: the old button name "${m[2]}"; the button is .btn or .sdk-icon-btn with a role class`);
  });
}

// 3. No restyle outside system.css: a rule ending in a button class may lay it out and set its custom properties, not restyle it.
const BTN = /(\.btn(-primary|-danger|-quiet|-small)?|\.sdk-btn|\.sdk-icon-btn)((:[\w-]+(\([^)]*\))?)|\[[^\]]+\]|\.(on|solid|primary))*$/;
const LOOK = /^(background(-[a-z]+)?|border(-[a-z]+)*|color|padding(-[a-z]+)*|height|min-height|max-height|font(-[a-z]+)?|line-height|box-shadow|opacity|outline(-[a-z]+)?)$/;
const SIZE_ONLY_OK = new Set(['width', 'min-width', 'max-width']);
// .seg (Polls' joined buttons) goes with the Tabs step (host.ui.viewSwitch). The popped-out titlebar stretches its buttons to the bar.
const LAYOUT_OK = [/^body\.module-popout \.module-titlebar \.sdk-icon-btn$/, /^\.subnav \.sdk-icon-btn$/, /^\.topbar > \.nav-right > \.sdk-icon-btn/, /^\.sdk-editor-close$/];
const sheets = ['public/style.css', 'public/sdk/host.css', 'public/destination.css', ...files.filter((f) => /^modules\/[^/]+\/src\/[^/]+\.css$/.test(f))];
for (const rel of sheets) {
  for (const r of rules(read(rel))) {
    for (const sel of r.selector.split(',').map((x) => x.trim())) {
      if (!BTN.test(sel) || /nav-text/.test(sel)) continue;
      if (LAYOUT_OK.some((re) => re.test(sel))) continue;
      const bad = r.decls.filter(([k]) => LOOK.test(k));
      if (bad.length) fail(`${rel}: "${sel}" sets ${bad.map(([k]) => k).join(', ')}; a button's look is the Buttons block in system.css (use a role or a size class; --b-* and --btn-h are the exceptions)`);
      void SIZE_ONLY_OK;
    }
  }
}
// UI_CSS in the SDK script carries no button rule.
if (/\n\.(btn|sdk-btn|sdk-icon-btn)[\s{,.:]/.test(read('public/sdk/host.js'))) fail('public/sdk/host.js: UI_CSS has a button rule; the Buttons block in system.css is the one');

// 4. The call's round buttons.
const style = read('public/style.css');
const space = read('public/space.html');
for (const m of space.matchAll(/<button\b[^>]*class="([^"]*(?<![\w-])fbtn(?![\w-])[^"]*)"[^>]*>/g)) {
  const id = (/\bid="([^"]+)"/.exec(m[0]) || [])[1] || '?';
  if (/\baction-btn\b/.test(m[1])) fail(`public/space.html: the call control #${id} still has the old .action-btn class`);
}
const base = rules(style).find((r) => r.selector === '.fbtn');
const bget = (p) => base && (base.decls.find(([k]) => k === p) || [])[1];
if (!base) fail('public/style.css: the base rule .fbtn is missing');
else {
  if (bget('width') !== 'var(--action-btn-h)' || bget('height') !== 'var(--action-btn-h)') fail('.fbtn: width and height must be var(--action-btn-h)');
  if (bget('font-size') !== 'calc(var(--action-btn-h) * var(--action-icon-ratio))') fail('.fbtn: font-size must be calc(var(--action-btn-h) * var(--action-icon-ratio))');
  if (bget('border-radius') !== 'var(--radius-round)') fail('.fbtn must stay a circle (--radius-round)');
}
const SIZE_PROPS = /^(width|height|min-width|min-height|max-width|max-height|padding|padding-[a-z]+|font|font-size|line-height)$/;
for (const r of rules(style)) {
  if (r.selector === '.fbtn' || /#floatbar-overflow/.test(r.selector)) continue;
  const parts = r.selector.split(',').map((s) => s.trim()).filter((s) => /\.fbtn(?![-\w])/.test(s));
  const onButton = parts.some((s) => /\.fbtn(:[\w-]+|\.[\w-]+|#[\w-]+)*$/.test(s) || /\s(i|svg|\.glyph i)$/.test(s));
  const sizing = r.decls.filter(([k]) => SIZE_PROPS.test(k));
  if (onButton && sizing.length) fail(`public/style.css: "${r.selector}" sets ${sizing.map(([k]) => k).join(', ')}; a call button is sized only by its base rule (set --action-btn-h for a smaller one)`);
}
const chatForm = /<form id="chat-form">[\s\S]*?<\/form>/.exec(space);
if (!chatForm) fail('public/space.html: the chat form is missing');
else if (/type="submit"|<button\b/.test(chatForm[0])) fail('public/space.html: the chat form must have no Send button (Enter sends)');
const host = read('public/module-host.js');
if (/drawModuleBar|quick-add-go|className = 'quick-add'/.test(host)) fail('public/module-host.js: the host draws a module action bar again; host.bar.set folds into the titlebar\'s "+"');
if (!/async 'bar\.set'\(\{ items \}\) \{[\s\S]{0,1400}drawAddSlot\(\);/.test(host)) fail('public/module-host.js: host.bar.set must fold its buttons into the "+" (drawAddSlot)');
// The "+" is the frame's title bar icon button, the same as its menu and Close (the moduleframe block: bare, square, a fill
// on hover), its plus the accent (public/module-frame.js).
const frameJs = read('public/module-frame.js');
if (!/button\('mf-icon-btn mf-titlebar-btn mf-add-btn', \{ label: add\.label \|\| 'Add', iconName: 'plus', words: false \}\)/.test(frameJs)) fail('public/module-frame.js: the title bar\'s "+" is the frame\'s icon button');
if (!/\.mf-icon-btn\.mf-add-btn, \.mf-add-btn:hover \{ color: var\(--text-accent\); \}/.test(read('public/sdk/system.css'))) fail('public/sdk/system.css: the "+" is the frame\'s icon button with its plus in the accent');
for (const r of rules(style)) if (/\.(dock-bar|module-floating-bar|module-bar)\b/.test(r.selector)) fail(`public/style.css: "${r.selector}" styles the old module action bar, which is gone`);

if (problems.length) {
  for (const p of problems) console.error(`check-buttons: ${p}`);
  process.exit(1);
}
console.log('check-buttons: OK (the Buttons family is defined once, in public/sdk/system.css)');
