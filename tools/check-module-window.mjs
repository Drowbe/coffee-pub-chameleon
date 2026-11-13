#!/usr/bin/env node
/*
 * check-module-window.mjs -- the module window's rules that can be checked mechanically (see
 * documentation/architecture/architecture-module-window.md, "Rules"). Today: every "..." in the host is the one
 * icon, Font Awesome's `ellipsis-vertical` -- the host's overflow buttons, a card's own menu, a day's, the call's
 * More. Not the horizontal `ellipsis`, and not a text glyph standing in for it. Drift here was found by hand once
 * (a vertical glyph on a poll, a horizontal icon everywhere else); this keeps it from coming back.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
const walk = (dir, keep) => {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) { if (name !== 'node_modules' && name !== 'dist' && name !== 'lib') walk(p, keep); } else if (keep(p)) files.push(p);
  }
};
walk(path.join(root, 'public'), (p) => /\.(js|html)$/.test(p) && !/[/\\](livekit|maplibre|pmtiles)/.test(p));
walk(path.join(root, 'modules'), (p) => /[/\\]src[/\\][^/\\]+\.(js|html)$/.test(p) && !/-lib-a-|maplibre/.test(p));

// A "..." drawn any way but the one icon: the horizontal Font Awesome icon (in a class, a data-icon, an icon name
// handed to the SDK), or a glyph standing in for the icon (the vertical or horizontal ellipsis character or entity).
const WRONG = [
  { re: /fa-ellipsis(?![-\w])/, why: 'the horizontal fa-ellipsis; use fa-ellipsis-vertical' },
  { re: /data-icon="ellipsis"/, why: 'data-icon="ellipsis" (horizontal); use ellipsis-vertical' },
  { re: /(icon|ui\.icon\(|wantIcon\(|menuIcon\()\s*[:(]?\s*['"]ellipsis['"]/, why: "the icon name 'ellipsis' (horizontal); use 'ellipsis-vertical'" },
  { re: /&#894[23];|&#x22e[ef];|[⋮⋯]/, why: 'an ellipsis character standing in for the icon; use the ellipsis-vertical icon' },
];

const problems = [];
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const { re, why } of WRONG) if (re.test(line)) problems.push(`${path.relative(root, file)}:${i + 1}: ${why}`);
    // A "..." trigger in markup must be the shared button (.sdk-icon-btn with btn-quiet and btn-small), or in a title bar the
    // module frame's own (.mf-icon-btn.mf-titlebar-btn, the band the Chat and the call share with every module). The call's
    // More is its own .fbtn.
    if (/\.html$/.test(file) && /<button\b/.test(line) && /ellipsis-vertical/.test(line) && !/sdk-icon-btn/.test(line) && !/class="mf-icon-btn mf-titlebar-btn"/.test(line) && !/\bfbtn\b/.test(line) && !/floatbar-more/.test(line)) {
      problems.push(`${path.relative(root, file)}:${i + 1}: a "..." button must use the shared sdk-icon-btn class (or the frame's title bar button)`);
    }
  });
}
// The editor window (documentation/plans/plan-editor-window.md): a module's Add or Edit form opens as a modal <dialog>
// through host.ui.editor, sized to the form and never clipped by the module's box. Once a bundled module is migrated
// (steps 3 to 8 of the plan add it here), its #editor is a <dialog class="sdk-editor"> and its stylesheet keeps no
// overlay rule (`.editor { position: absolute; inset: 0 }`) that would draw the form inside the module's window.
const EDITOR_MIGRATED = ['todo', 'calendar', 'travel', 'polls', 'research', 'maps', 'budget'];
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
// An icon scan that waits for each pending icon separately attaches a scan to every other pending icon too: a form opened
// while its icons load scanned itself 2^n times and froze the Planner (#192). Pending icons are waited for together, once.
for (const file of files) {
  if (!/[/\\]modules[/\\]/.test(file) || !file.endsWith('.js')) continue;
  read(path.relative(root, file)).split('\n').forEach((line, i) => {
    if (/wantIcon\([^)]*\)\s*\.then\(\s*\(\)\s*=>\s*hydrate\(/.test(line)) problems.push(`${path.relative(root, file)}:${i + 1}: a scan per pending icon; collect the pending names and wait for them together (Promise.all), then scan once`);
  });
}
for (const id of EDITOR_MIGRATED) {
  const src = path.join(root, 'modules', id, 'src');
  const html = fs.readdirSync(src).filter((n) => n.endsWith('.html')).map((n) => `modules/${id}/src/${n}`);
  // The script that holds the module's form: Maps' is its list part (the Places editor moved in; the map has no form).
  const formScript = id === 'maps' ? 'maps-lib-g-list-view.js' : `${id}.js`;
  // The module's script: Cancel goes through the handle's cancel() (the same question as Escape and Close), never by
  // clicking the SDK's own button, and the dialog is shown and hidden by the handle, never by `hidden`.
  for (const name of fs.readdirSync(src).filter((n) => n.endsWith('.js') && !/-lib-a-/.test(n))) {
    const rel = `modules/${id}/src/${name}`;
    const lines = read(rel).split('\n');
    lines.forEach((line, i) => {
      if (/querySelector\(\s*['"]\.sdk-editor-close['"]\s*\)/.test(line)) problems.push(`${rel}:${i + 1}: clicks the SDK's Close button; call editor.cancel() instead`);
      if (/\$\(\s*['"]editor['"]\s*\)\.hidden\b/.test(line)) problems.push(`${rel}:${i + 1}: "$('editor').hidden"; the handle's open() and close() show and hide the dialog`);
    });
    if (name === formScript && !/\beditor\.cancel\(\)/.test(lines.join('\n'))) problems.push(`${rel}: the form's Cancel must call editor.cancel() (the "Discard your changes?" question when something was typed)`);
    // A read-only form (To-do, Calendar: a task or event the viewer may not change) has nothing to lose, takes no input and
    // opens with focus on the window itself, not on a picker or a button.
    if (name === `${id}.js` && (id === 'todo' || id === 'calendar')) {
      const text = lines.join('\n');
      const dirty = /isDirty:\s*\(\)\s*=>[^\n]*/.exec(text);
      if (!dirty || !/readOnly/.test(dirty[0])) problems.push(`${rel}: isDirty must answer false for a read-only form (editing.readOnly)`);
      if (!/focus:\s*readOnly\s*\?\s*\$\('editor'\)/.test(text)) problems.push(`${rel}: a read-only form opens with focus on the window itself (focus: readOnly ? $('editor') : ...)`);
    }
    if (name === 'research.js' && !/setFormEditable[^\n]*#f-icons button/.test(lines.join('\n'))) problems.push(`${rel}: setFormEditable must disable the type buttons (#f-icons button) too`);
    // The Planner: a new object's row gets focus again after each redraw that follows the save (the change echo redraws too).
    if (name === 'travel.js') {
      const text = lines.join('\n');
      if (!/state\.focusAfterRedraw\s*=\s*\{\s*id:/.test(text) || !/function refocusNewRow/.test(text) || !/refocusNewRow\(\);/.test(text)) problems.push(`${rel}: after saving a new object, render() must focus its row again (state.focusAfterRedraw, refocusNewRow)`);
    }
  }
  const editor = html.map((rel) => [rel, /<dialog\b[^>]*\bid="editor"[^>]*>/.exec(read(rel))]).find(([, m]) => m);
  if (!editor) problems.push(`modules/${id}: #editor must be a <dialog> (host.ui.editor), not a div overlay`);
  else if (!/\bclass="[^"]*(?<![\w-])sdk-editor(?![\w-])[^"]*"/.test(editor[1][0])) problems.push(`${editor[0]}: <dialog id="editor"> must carry class="sdk-editor"`);
  const css = [...fs.readdirSync(src).filter((n) => n.endsWith('.css')).map((n) => [`modules/${id}/src/${n}`, read(`modules/${id}/src/${n}`)]),
    ...html.map((rel) => [rel, [...read(rel).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')])];
  for (const [rel, text] of css) {
    for (const m of text.matchAll(/(^|[\s,}])\.editor\s*\{([^}]*)\}/g)) {
      if (/position\s*:\s*absolute/.test(m[2]) && /inset\s*:\s*0/.test(m[2])) problems.push(`${rel}: ".editor { position: absolute; inset: 0 }" draws the form inside the module's window; the <dialog> is the window now`);
    }
  }
}

// The SDK's own editor: its two sizes and the sentence it throws for anything but a <dialog>, sliced out of
// public/sdk/host.js and run (as check-module-host does for pointers), and /sdk/host.css's widths held to the same numbers.
{
  const sdk = read('public/sdk/host.js');
  const start = sdk.indexOf('const EDITOR_SIZES');
  const endMark = '\n    return api;\n  }\n';
  const end = sdk.indexOf(endMark, start);
  if (start === -1 || end === -1) problems.push('public/sdk/host.js: could not find EDITOR_SIZES ... createEditor to run');
  else {
    const { EDITOR_SIZES, createEditor } = new Function(`${sdk.slice(start, end + endMark.length)}\nreturn { EDITOR_SIZES, createEditor };`)();
    if (EDITOR_SIZES.medium !== 560 || EDITOR_SIZES.large !== 880) problems.push(`public/sdk/host.js: EDITOR_SIZES must be { medium: 560, large: 880 }, not ${JSON.stringify(EDITOR_SIZES)}`);
    for (const wrong of [null, undefined, {}, { nodeType: 1, tagName: 'DIV' }, { nodeType: 3, tagName: 'DIALOG' }]) {
      let thrown = '';
      try { createEditor(wrong, {}, {}); } catch (err) { thrown = err.message; }
      if (thrown !== 'host.ui.editor needs a <dialog> element') problems.push(`public/sdk/host.js: host.ui.editor on ${JSON.stringify(wrong)} must throw "host.ui.editor needs a <dialog> element", not ${JSON.stringify(thrown)}`);
    }
    // The handle a <dialog> gets: open, close, cancel (the module's Cancel button), isOpen, element.
    const fakeDialog = { nodeType: 1, tagName: 'DIALOG', ownerDocument: {}, classList: { add() {}, remove() {} }, hasAttribute: () => true, addEventListener() {} };
    let handle = null;
    try { handle = createEditor(fakeDialog, {}, {}); } catch (err) { problems.push(`public/sdk/host.js: host.ui.editor on a <dialog> threw ${JSON.stringify(err.message)}`); }
    for (const need of ['open', 'close', 'cancel']) {
      if (handle && typeof handle[need] !== 'function') problems.push(`public/sdk/host.js: the editor handle must have ${need}()`);
    }
    // The editor window's rules are the Dialogs block of public/sdk/system.css (between "dialogs:start" and "dialogs:end"): the two
    // sizes are its tokens, held to the SDK's.
    const css = read('public/sdk/system.css');
    const block = /\/\* dialogs:start[\s\S]*?\/\* dialogs:end \*\//.exec(css);
    if (!block) problems.push('public/sdk/system.css: the editor window\'s rules must sit between "dialogs:start" and "dialogs:end"');
    else {
      const medium = /--dlg-w-form:\s*(\d+)px/.exec(block[0]);
      const large = /--dlg-w-browse:\s*(\d+)px/.exec(block[0]);
      if (!medium || Number(medium[1]) !== EDITOR_SIZES.medium) problems.push(`public/sdk/system.css: --dlg-w-form must be ${EDITOR_SIZES.medium}px`);
      if (!large || Number(large[1]) !== EDITOR_SIZES.large) problems.push(`public/sdk/system.css: --dlg-w-browse must be ${EDITOR_SIZES.large}px`);
      if (!/--dlg-w:\s*var\(--dlg-w-form\);[\s\S]*?width:\s*min\(var\(--dlg-w\),\s*100vw - 32px\)/.test(block[0])) problems.push('public/sdk/system.css: .sdk-editor must be width: min(var(--dlg-w), 100vw - 32px) with --dlg-w the form size');
      if (!/:is\(\.sdk-editor-large[^)]*\) \{ --dlg-w: var\(--dlg-w-browse\); \}/.test(block[0])) problems.push('public/sdk/system.css: .sdk-editor-large must take the browse size');
      for (const need of ['::backdrop', '.sdk-editor-close', '.sdk-editor-head', '.sdk-editor-actions', '.sdk-editor-discard', '@media (max-width: 640px)', 'height: 100dvh', 'prefers-reduced-motion', 'var(--scrim)', 'var(--shadow-3)']) {
        if (!block[0].includes(need)) problems.push(`public/sdk/system.css: the editor window's rules must include "${need}"`);
      }
      if (/inset\s*:\s*0/.test(block[0])) problems.push('public/sdk/system.css: the editor window must not use inset: 0 (top: 0 with height: 100dvh on a phone; see architecture-canvas.md)');
      for (const m of block[0].matchAll(/#[0-9a-f]{3,8}\b|\brgba?\((?!0,\s*0,\s*0)/gi)) problems.push(`public/sdk/system.css: the editor window's rules use a fixed colour "${m[0]}"; use the theme tokens`);
      if (/\/\* editor:start/.test(read('public/sdk/host.css'))) problems.push('public/sdk/host.css: the editor window\'s rules moved to system.css (the Dialogs block); none are kept here');
    }
    // The date picker (host.ui.datePicker) follows its field: disabled with it, so a read-only form has no Pick a date.
    const dp = sdk.indexOf('datePicker: (input, o)');
    const dpText = dp === -1 ? '' : sdk.slice(dp, sdk.indexOf('return { close, refresh', dp));
    if (!/if \(input\.disabled\) return;/.test(dpText) || !/btn\.disabled = Boolean\(input\.disabled\)/.test(dpText)) problems.push('public/sdk/host.js: the date picker must follow a disabled field (its button disabled, open() a no-op)');
    // The words a person reads, as the plan fixes them.
    const words = sdk.slice(start, end);
    for (const need of ["'Discard your changes?'", "'Keep editing'", "'Discard'", "'Close'"]) {
      if (!words.includes(need)) problems.push(`public/sdk/host.js: the editor window must say ${need}`);
    }
    // In a sandboxed frame (step 11 of the plan): the frame boot hands the SDK `lift`, the editor asks for the lift before
    // showModal() and for it to be put back when the last open editor closes, and shows it again after a move.
    if (!sdk.includes("lift: (open, size, height) => call('editor.lift', { open: Boolean(open), size, height }),")) problems.push("public/sdk/host.js: the frame boot must pass lift: (open, size, height) => call('editor.lift', { open: Boolean(open), size, height })");
    if (!sdk.includes('lift: env.lift')) problems.push('public/sdk/host.js: editorDeps must carry lift: env.lift');
    if (!/dialog\.showModal\(\);[^\n]*\n\s+deps\.opened\.set\(dialog, \{ reopen, dismiss \}\);\n\s+watch\(\);\n\s+lift\(true\);/.test(words)) problems.push('public/sdk/host.js: open() must ask for the lift (lift(true)) once the dialog is shown (showModal() first, so a dialog not in the page lifts nothing)');
    if (!/deps\.opened\.delete\(dialog\);\n\s+lift\(false\);/.test(words)) problems.push("public/sdk/host.js: the dialog's close must put the frame back (lift(false)) once the editor is out of `opened`");
    if (!/\[\.\.\.deps\.opened\.keys\(\)\]\.some\(\(d\) => d !== dialog && d\.open\)/.test(words)) problems.push('public/sdk/host.js: lift(false) must wait for the last open editor in the module');
    if (!/try \{ dialog\.showModal\(\); \} catch \(err\) \{ console\.error\(err\); return; \}\n\s+deps\.opened\.set\(dialog, \{ reopen, dismiss \}\);\n\s+lift\(true\);/.test(words)) problems.push('public/sdk/host.js: reopen() after a move must ask for the lift again');
    // The lifted frame is the window: the dialog fills it (.sdk-editor-lifted), set once the host says it lifted.
    if (!/const did = Boolean\(r && r\.lifted === true\) && dialog\.open;[\s\S]*?dialog\.classList\.toggle\('sdk-editor-lifted', did\)/.test(words)) problems.push("public/sdk/host.js: the editor must mark the dialog sdk-editor-lifted when the host answers that it lifted the frame");
    if (!/\.sdk-editor\.sdk-editor-lifted\s*\{[^}]*width: 100vw;[^}]*height: 100dvh;/.test(block ? block[0] : '')) problems.push('public/sdk/host.css: .sdk-editor.sdk-editor-lifted must fill the frame (width: 100vw; height: 100dvh)');
    // The host's side of the lift, in public/style.css between "lift:start" and "lift:end": the frame exactly the
    // editor's width (the SDK's sizes), the phone sheet, the tokens.
    const pageCss = read('public/style.css');
    const lift = /\/\* lift:start[\s\S]*?\/\* lift:end \*\//.exec(pageCss);
    if (!lift) problems.push('public/style.css: the lifted frame\'s rules must sit between "lift:start" and "lift:end"');
    else {
      // The widths are the Dialogs block's tokens (--dlg-w-form and --dlg-w-browse, held to the SDK's sizes above).
      if (!/iframe\.module-editor-lifted\s*\{[^}]*?width:\s*min\(var\(--dlg-w-form\),\s*100vw - 32px\)/.test(lift[0])) problems.push('public/style.css: iframe.module-editor-lifted must be width: min(var(--dlg-w-form), 100vw - 32px)');
      if (!/iframe\.module-editor-lifted\.module-editor-lifted-large\s*\{[^}]*?width:\s*min\(var\(--dlg-w-browse\),\s*100vw - 32px\)/.test(lift[0])) problems.push('public/style.css: iframe.module-editor-lifted.module-editor-lifted-large must be width: min(var(--dlg-w-browse), 100vw - 32px)');
      for (const need of ['.module-editor-backdrop', 'position: fixed', 'z-index: var(--z-dialog)', '@media (max-width: 640px)', 'height: 100dvh', 'prefers-reduced-motion', 'var(--scrim)', 'var(--shadow-3)']) {
        if (!lift[0].includes(need)) problems.push(`public/style.css: the lifted frame's rules must include "${need}"`);
      }
      if (/inset\s*:\s*0/.test(lift[0])) problems.push('public/style.css: the lifted frame must not use inset: 0 (top: 0 with height: 100dvh on a phone; see architecture-canvas.md)');
      for (const m of lift[0].matchAll(/#[0-9a-f]{3,8}\b|\brgba?\((?!0,\s*0,\s*0)/gi)) problems.push(`public/style.css: the lifted frame's rules use a fixed colour "${m[0]}"; use the theme tokens`);
    }
  }
}

// The SDK's kind picker (host.ui.kindPicker; plan-editor-window.md, Part 2): its filtering, its recent list and the markup it
// builds, sliced out of public/sdk/host.js and run on a small stand-in for the DOM; /sdk/host.css's rules between
// "kind:start" and "kind:end".
{
  const sdk = read('public/sdk/host.js');
  const start = sdk.indexOf('const KIND_RECENT_MAX');
  const endMark = '\n    return api;\n  }\n';
  const from = sdk.indexOf('function createKindPicker', start);
  const end = from === -1 ? -1 : sdk.indexOf(endMark, from);
  if (start === -1 || end === -1) problems.push('public/sdk/host.js: could not find KIND_RECENT_MAX ... createKindPicker to run');
  else {
    // A stand-in element: enough of the DOM for the picker to build its row and its list.
    let seq = 0;
    const doc = { nodeType: 9 };
    const element = (tag) => {
      const el = {
        nodeType: 1, tagName: String(tag).toUpperCase(), ownerDocument: doc, children: [], attrs: {}, dataset: {}, style: { setProperty(k, v) { el.styles[k] = v; }, removeProperty(k) { delete el.styles[k]; } }, styles: {}, listeners: {}, hidden: false, textContent: '', innerHTML: '', value: '', disabled: false, uid: ++seq,
        classList: { add: (...c) => c.forEach((x) => el.classes.add(x)), remove: (...c) => c.forEach((x) => el.classes.delete(x)), toggle: (c, on) => (on ? el.classes.add(c) : el.classes.delete(c)), contains: (c) => el.classes.has(c) }, classes: new Set(),
        setAttribute(k, v) { el.attrs[k] = String(v); }, getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; }, removeAttribute(k) { delete el.attrs[k]; }, hasAttribute(k) { return k in el.attrs; },
        appendChild(c) { if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c); c.parent = el; el.children.push(c); return c; }, append(...cs) { cs.forEach((c) => el.appendChild(c)); }, prepend(c) { el.appendChild(c); el.children.unshift(el.children.pop()); }, replaceChildren(...cs) { el.children = []; cs.forEach((c) => el.appendChild(c)); }, remove() { if (el.parent) el.parent.children = el.parent.children.filter((x) => x !== el); el.parent = null; },
        addEventListener(t, f) { (el.listeners[t] = el.listeners[t] || []).push(f); }, removeEventListener() {}, contains(x) { return x === el || el.children.some((c) => c.contains(x)); }, focus() { doc.activeElement = el; }, select() {}, scrollIntoView() {}, getBoundingClientRect: () => ({ left: 10, top: 10, right: 310, bottom: 48, width: 300, height: 38 }), get scrollHeight() { return 200; }, get id() { return el.attrs.id || ''; }, set id(v) { el.attrs.id = String(v); }, get className() { return [...el.classes].join(' '); }, set className(v) { el.classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
      };
      return el;
    };
    doc.createElement = element;
    doc.body = element('body');
    const docListeners = [];
    doc.addEventListener = (t, f, c) => docListeners.push(`${t}:${c ? 'capture' : 'bubble'}`); doc.removeEventListener = () => {};
    const stored = new Map();
    const fakeWindow = { innerWidth: 1280, innerHeight: 800, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {} };
    const fakeStorage = { getItem: (k) => (stored.has(k) ? stored.get(k) : null), setItem: (k, v) => stored.set(k, String(v)) };
    const run = new Function('window', 'localStorage', 'console', `${sdk.slice(start, end + endMark.length)}\nreturn { KIND_RECENT_MAX, kindMatches, kindRank, kindPickerGroups, kindRecentAdd, createKindPicker };`);
    const { KIND_RECENT_MAX, kindMatches, kindRank, kindPickerGroups, kindRecentAdd, createKindPicker } = run(fakeWindow, fakeStorage, console);
    const groups = [
      { label: 'Getting there', options: [{ id: 'flight', label: 'Flight', icon: 'plane', color: 'red', words: ['plane', 'air'] }, { id: 'train', label: 'Train', icon: 'train' }, { id: 'bus', label: 'Bus', icon: 'bus' }] },
      { label: 'Eat and drink', options: [{ id: 'cafe', label: 'Caf\u00e9', icon: 'mug-hot' }, { id: 'bar', label: 'Bar' }, { id: 'restaurant', label: 'Restaurant' }] },
      { label: 'See and do', options: [{ id: 'sight', label: 'Sight', words: ['shop'] }, { id: 'show', label: 'Show' }] },
      { label: 'Markers', options: [{ id: 'marker:free-time', label: 'Free time', icon: 'face-smile', color: '#14b8a6' }, { id: 'marker:travel-day', label: 'Travel day' }, { id: 'marker:rest', label: 'Rest' }] },
    ];
    const ids = (gs) => gs.map((g) => `${g.label}:${g.options.map((o) => o.id).join(',')}`).join('|');
    const expect = (what, got, want) => { if (got !== want) problems.push(`public/sdk/host.js: the kind picker ${what}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); };
    // Filtering: the start of any word of the name or the words, without case or accents; a group with nothing left goes.
    expect('matches the start of a word', kindMatches({ label: 'Free time' }, 'ti'), true);
    expect('does not match the middle of a word', kindMatches({ label: 'Flight' }, 'light'), false);
    expect('matches the words given', kindMatches({ label: 'Flight', words: ['plane'] }, 'PLA'), true);
    expect('matches without accents', kindMatches({ label: 'Caf\u00e9' }, 'cafe'), true);
    expect('needs every word typed to match', kindMatches({ label: 'Travel day' }, 'tra x'), false);
    expect('filters "tra" to Train and Travel day', ids(kindPickerGroups(groups, 'tra', [], 4)), 'Getting there:train|Markers:marker:travel-day');
    expect('gives [] when nothing matches', kindPickerGroups(groups, 'zzz', [], 4).length, 0);
    // Recent first, up to max, only ids in the groups, not repeated in their groups below, and only with nothing typed.
    // The order: a name that is the query, then one that starts with it, then a later word of the name, then the words.
    expect('ranks an exact name first', [kindRank({ label: 'Rest' }, 'rest'), kindRank({ label: 'Restaurant' }, 'rest'), kindRank({ label: 'Free time' }, 'ti'), kindRank({ label: 'Sight', words: ['shop'] }, 'sho'), kindRank({ label: 'Bar' }, 'x')].join(','), '0,1,2,3,4');
    expect('"rest" puts Rest before Restaurant, its group first', ids(kindPickerGroups(groups, 'rest', [], 4)), 'Markers:marker:rest|Eat and drink:restaurant');
    expect('"sho" puts Show before Sight', ids(kindPickerGroups(groups, 'sho', [], 4)), 'See and do:show,sight');
    expect('shows every group with nothing typed and nothing recent', ids(kindPickerGroups(groups, '', [], 4)), 'Getting there:flight,train,bus|Eat and drink:cafe,bar,restaurant|See and do:sight,show|Markers:marker:free-time,marker:travel-day,marker:rest');
    expect('puts Recent first', ids(kindPickerGroups(groups, '', ['bar', 'flight', 'gone', 'bar'], 4)), 'Recent:bar,flight|Getting there:train,bus|Eat and drink:cafe,restaurant|See and do:sight,show|Markers:marker:free-time,marker:travel-day,marker:rest');
    expect('keeps Recent to max', kindPickerGroups(groups, '', ['bar', 'flight', 'bus', 'cafe', 'train'], 2)[0].options.length, 2);
    expect('drops Recent while typing', ids(kindPickerGroups(groups, 'b', ['bar'], 4)), 'Getting there:bus|Eat and drink:bar');
    expect('has 4 recent by default', KIND_RECENT_MAX, 4);
    expect('moves a choice to the front of the recent ids, once', kindRecentAdd(['bus', 'bar', 'flight'], 'bar').join(','), 'bar,bus,flight');
    // The thrown sentence.
    for (const wrong of [null, undefined, {}, { nodeType: 3 }]) {
      let thrown = '';
      try { createKindPicker(wrong, {}, {}); } catch (err) { thrown = err.message; }
      if (thrown !== 'host.ui.kindPicker needs an element') problems.push(`public/sdk/host.js: host.ui.kindPicker on ${JSON.stringify(wrong)} must throw "host.ui.kindPicker needs an element", not ${JSON.stringify(thrown)}`);
    }
    // The markup: the ARIA combobox pattern, closed and open, and the recent list kept in this browser per module.
    const deps = { root: doc, rootElement: doc.body, icon: () => Promise.resolve(''), editorAt: () => null, moduleId: 'travel' };
    const box = element('div');
    const changes = [];
    const picker = createKindPicker(box, { label: 'What is it', groups, value: 'train', recent: { key: 'add', max: 4 }, onChange: (id) => changes.push(id) }, deps);
    const byClass = (el, c) => (el.classes && el.classes.has(c) ? [el] : []).concat(...(el.children || []).map((x) => byClass(x, c)));
    const input = byClass(box, 'sdk-kind-input')[0];
    const chip = byClass(box, 'sdk-kind-chip')[0];
    if (!input || input.tagName !== 'INPUT') problems.push('public/sdk/host.js: the kind picker must draw an input.sdk-kind-input');
    else {
      expect('field is a combobox', input.getAttribute('role'), 'combobox');
      expect('field lists', input.getAttribute('aria-autocomplete'), 'list');
      expect('field starts closed', input.getAttribute('aria-expanded'), 'false');
      expect('field is named by the label', input.getAttribute('aria-label'), 'What is it');
      expect('field shows the chosen name', input.value, 'Train');
      expect('field is linked to its list only while the list exists', input.getAttribute('aria-controls'), null);
      expect('chip shows the chosen icon', chip && chip.dataset.kindIcon, 'train');
      expect('value is the chosen id', picker.value, 'train');
      stored.set('app:kind:travel:add', JSON.stringify(['bar', 'flight']));
      picker.open();
      const list0 = () => byClass(doc.body, 'sdk-kind-list')[0];
      expect('field says it is open', input.getAttribute('aria-expanded'), 'true');
      expect('field is linked to its list while open', input.getAttribute('aria-controls'), `${list0().attrs.id}`);
      const list = byClass(doc.body, 'sdk-kind-list')[0];
      if (!list) problems.push('public/sdk/host.js: the open kind picker must draw ul.sdk-kind-list in the module\'s root');
      else {
        expect('list is a listbox', list.getAttribute('role'), 'listbox');
        expect('list id matches aria-controls', list.attrs.id, input.getAttribute('aria-controls'));
        const groupsDrawn = byClass(list, 'sdk-kind-group');
        expect('list has Recent then the groups', groupsDrawn.map((g) => byClass(g, 'sdk-kind-group-title')[0].textContent).join('|'), 'Recent|Getting there|Eat and drink|See and do|Markers');
        expect('a group is role=group named by its title', groupsDrawn.every((g) => g.getAttribute('role') === 'group' && g.getAttribute('aria-labelledby') === byClass(g, 'sdk-kind-group-title')[0].attrs.id), true);
        expect('the list follows a scroll of the module\'s root (capture), not only the document\'s', docListeners.includes('scroll:capture'), true);
        const rows = byClass(list, 'sdk-kind-option');
        expect('every kind is an option with an id', rows.every((r) => r.getAttribute('role') === 'option' && r.attrs.id && r.dataset.id), true);
        expect('the chosen kind is selected', rows.filter((r) => r.getAttribute('aria-selected') === 'true').map((r) => r.dataset.id).join(','), 'train');
        expect('the active option is the chosen one', input.getAttribute('aria-activedescendant'), rows.find((r) => r.dataset.id === 'train').attrs.id);
        expect('a kind carries its colour', rows.find((r) => r.dataset.id === 'flight').styles['--kind-color'], 'red');
        expect('a marker carries its own colour', rows.find((r) => r.dataset.id === 'marker:free-time').styles['--kind-color'], '#14b8a6');
        // Typing filters; nothing matching says so; choosing fires onChange, closes and is remembered.
        input.value = 'tra'; input.listeners.input[0]();
        expect('typing "tra" leaves Train and Travel day', byClass(list, 'sdk-kind-option').map((r) => r.dataset.id).join(','), 'train,marker:travel-day');
        input.value = 'zzz'; input.listeners.input[0]();
        expect('nothing matching says "Nothing matches"', byClass(list, 'sdk-kind-empty').map((r) => r.textContent).join(), 'Nothing matches');
        expect('"Nothing matches" is not an option', byClass(list, 'sdk-kind-empty')[0].getAttribute('role') !== 'option' && !input.getAttribute('aria-activedescendant'), true);
        input.value = 'fl'; input.listeners.input[0]();
        input.listeners.keydown[0]({ key: 'Enter', preventDefault() {} });
        expect('Enter chooses the active match', changes.join(','), 'flight');
        expect('choosing closes the list', input.getAttribute('aria-expanded'), 'false');
        expect('the chosen name is back in the field', input.value, 'Flight');
        expect('the choice is kept in this browser for the module', stored.get('app:kind:travel:add'), JSON.stringify(['flight', 'bar']));
        picker.set('bus');
        expect('set() chooses without onChange', `${picker.value}:${changes.length}:${input.value}`, 'bus:1:Bus');
        expect('the chosen name is back in the field after set()', input.getAttribute('aria-controls'), null);
        // A kind the groups do not have (a marker type an owner removed): the field empty, "Unknown kind", never another kind.
        picker.set('marker:gone');
        expect('set() of an unknown id clears the field and keeps the id', `${picker.value}:${input.value}:${input.placeholder}:${chip.hidden}`, 'marker:gone::Unknown kind:true');
        picker.set('bus');
        picker.setGroups(groups.slice(1));
        expect('setGroups() dropping the chosen kind reports it and shows it unknown', `${changes.join(',')}:${picker.value}:${input.value}:${input.placeholder}`, 'flight,bus:bus:' + ':Unknown kind');
        picker.remember('cafe');
        expect('remember() records a kind without choosing it', `${stored.get('app:kind:travel:add')}:${picker.value}`, JSON.stringify(['cafe', 'flight', 'bar']) + ':bus');
      }
    }
    const unknown = createKindPicker(element('div'), { groups, value: 'marker:trip-start' }, deps);
    expect('a value not in the groups is kept and shown as unknown, not as the first kind', `${unknown.value}:${byClass(unknown.element, 'sdk-kind-input')[0].value}:${byClass(unknown.element, 'sdk-kind-input')[0].placeholder}`, 'marker:trip-start::Unknown kind');
    expect('recent.max 0 or negative means 4', kindPickerGroups(groups, '', ['bar', 'flight', 'bus', 'cafe', 'train'], createKindPicker(element('div'), { groups, recent: { key: 'x', max: 0 } }, deps) && 0)[0].options.length, 4);
    // A picker with start: 'recent' begins on the kind chosen last.
    const again = createKindPicker(element('div'), { groups, value: 'bus', start: 'recent', recent: { key: 'add' } }, deps);
    expect('starts on the kind chosen last with start: recent', again.value, 'cafe');
    expect('starts on value without it', createKindPicker(element('div'), { groups, value: 'bus', recent: { key: 'add' } }, deps).value, 'bus');
    // The words a person reads.
    for (const need of ["'Nothing matches'", "'Recent'", "'Unknown kind'"]) if (!sdk.slice(start, end).includes(need)) problems.push(`public/sdk/host.js: the kind picker must say ${need}`);
    if (!/Number\(options\.recent\.max\) > 0/.test(sdk.slice(from, end))) problems.push('public/sdk/host.js: recent.max of 0 or less must fall back to KIND_RECENT_MAX');
    const css = read('public/sdk/host.css');
    const block = /\/\* kind:start[\s\S]*?\/\* kind:end \*\//.exec(css);
    if (!block) problems.push('public/sdk/host.css: the kind picker\'s rules must sit between "kind:start" and "kind:end"');
    else {
      for (const need of ['.sdk-kind-field', '.sdk-kind-chip', 'var(--bar-control-h', 'var(--kind-color)', '@media (max-width: 640px)']) {
        if (!block[0].includes(need)) problems.push(`public/sdk/host.css: the kind picker's rules must include "${need}"`);
      }
      // The list and its rows are the Menus family's (the Menus block of system.css).
      const menus = /\/\* menus:start \*\/[\s\S]*?\/\* menus:end \*\//.exec(read('public/sdk/system.css'));
      for (const need of ['.sdk-kind-list', '.sdk-kind-option', '.sdk-kind-group-title', '.sdk-kind-empty', 'max-height: min(360px']) {
        if (!menus || !menus[0].includes(need)) problems.push(`public/sdk/system.css: the Menus block must include "${need}" (the kind picker's list)`);
      }
      for (const m of block[0].matchAll(/#[0-9a-f]{3,8}\b|\brgba?\((?!0,\s*0,\s*0)/gi)) problems.push(`public/sdk/host.css: the kind picker's rules use a fixed colour "${m[0]}"; use the theme tokens`);
      if (!/\.sdk-kind-option\[aria-selected="true"\] \.sdk-kind-icon \{[^}]*var\(--kind-color/.test(read('public/sdk/system.css'))) problems.push('public/sdk/system.css: the chosen kind\'s icon must show the kind\'s colour (a tint of it behind the glyph)');
    }
  }
}

if (problems.length) {
  console.error(`check-module-window: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-module-window: OK (${files.length} files, the "..." icon; the editor window: ${EDITOR_MIGRATED.length} module(s) migrated, Cancel through editor.cancel(), icons waited for together, the SDK's sizes, handle and thrown sentence, the lift of a sandboxed frame; the kind picker's filtering, recent list and markup)`);
