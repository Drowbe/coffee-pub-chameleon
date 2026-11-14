#!/usr/bin/env node
/*
 * check-action-bar.mjs -- the action-bar rule (Thomas, 2026-10-13): every settings or edit surface has explicit Save and
 * Cancel buttons in an action bar locked to the bottom of the surface; nothing saves as you go; a click outside never
 * closes it; Escape and Cancel close it and drop the edits, asking "Discard changes?" first when something is
 * half-edited; Save is off until something changed and says "Saved" afterwards. Read as code (no browser):
 *   - public/action-bar.js: the shared piece (Save, Cancel, the question, Save off while clean, "Saved", Escape);
 *   - the styles: sticky to the bottom, the safe area, tokens only, 44 px on a phone;
 *   - each surface (the phase sheet, the Set up panel, the layout sheet) builds its bar with actionBar(), sends its
 *     changes only from Save, has no backdrop click, asks on Escape and Cancel, and the Set up panel has no Done and
 *     Cancel in the top bar;
 *   - a sweep: any script in public/ that opens a modal <dialog> or compares a click's target with its dialog must use
 *     actionBar() (or be one of the named exceptions), so a new settings surface that skips the bar fails here.
 * Add a surface: use actionBar() and list it in SURFACES. A confirmation or a menu is not an edit surface: it is not
 * listed and opens no <dialog> of its own.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let n = 0;
let failed = 0;
const test = (name, fn) => {
  try { fn(); n += 1; } catch (err) { failed += 1; console.error(`check-action-bar: ${name}: ${err.stack || err.message}`); }
};
const between = (text, from, to) => {
  const a = text.indexOf(from);
  assert.ok(a >= 0, `${from} is there`);
  const b = to ? text.indexOf(to, a + from.length) : text.length;
  return text.slice(a, b < 0 ? text.length : b);
};

const bar = read('public/action-bar.js');
const css = read('public/style.css');

test('the shared piece: Save and Cancel, Save off while clean, "Saved", the discard question, Escape', () => {
  assert.match(bar, /export function actionBar\(/);
  assert.match(bar, /onSave,\s*\n\s*onCancel,\s*\n\s*dirty/, 'actionBar({ onSave, onCancel, dirty })');
  assert.match(bar, /saveLabel = 'Save'/);
  assert.match(bar, /cancelLabel = 'Cancel'/);
  assert.match(bar, /savedWord = 'Saved'/, 'says "Saved" afterwards');
  assert.match(bar, /DISCARD_WORDS = 'Discard changes\?'/);
  assert.match(bar, /saveButton\.disabled = readOnly \|\| busy \|\| !d;/, 'Save is disabled until something changed');
  assert.match(bar, /if \(isDirty\(\)\) ask\(\);\s*\n\s*else if \(typeof onCancel === 'function'\) onCancel\(\);/, 'Cancel asks only when dirty');
  assert.match(bar, /event\.key !== 'Escape'/);
  assert.match(bar, /role="alertdialog"/, 'the question is announced');
  assert.match(bar, /role="status" aria-live="polite"/, 'what happened is read out');
  assert.match(bar, /class="btn btn-small btn-danger action-bar-discard">Discard</);
  assert.match(bar, /Keep editing/);
  assert.match(bar, /discardWords = DISCARD_WORDS,/, 'a surface may ask in its own words; "Discard changes?" unless it does');
  assert.match(bar, /askText\.textContent = discardWords;/);
  assert.ok(/readOnly/.test(bar) && /closeLabel/.test(bar), 'a reader sees Close, no Save');
});

test('the styles: locked to the bottom, the safe area, tokens only, 44 px on a phone', () => {
  const block = between(css, '/* action-bar:start', '/* action-bar:end */');
  assert.match(block, /\.action-bar \{[^}]*position: sticky;[^}]*bottom: 0;/, 'locked to the bottom');
  assert.match(block, /\.action-bar \{[^}]*padding: 12px 16px calc\(12px \+ env\(safe-area-inset-bottom, 0px\)\);/, 'respects the safe area');
  assert.match(block, /\.action-bar \{[^}]*background: var\(--bg-section\);/);
  assert.match(block, /\.action-content \{[^}]*overflow-y: auto;/, 'the content scrolls above it');
  // 44 px on a phone is the Buttons block's --btn-h (system.css); the bar only shares the row out.
  assert.match(block, /@media \(max-width: 640px\) \{[\s\S]*\.action-bar-buttons \.btn \{\s*flex: 1 1 0;/);
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(block) && !/rgba?\(/.test(block), 'tokens only');
});

// The surfaces this rule holds: where they are and how to read their code.
const SURFACES = [
  { name: 'the phase sheet', file: 'public/phase-sheet.js', from: 'export function openPhaseSheet(' },
  { name: 'the Set up panel', file: 'public/space-setup.js', from: 'export function createSpaceSetup(' },
  { name: 'the layout sheet', file: 'public/space.js', from: 'function openLayoutSheet(', to: 'function openSaveLayout(' },
  { name: 'the layout icon sheet', file: 'public/space.js', from: 'function openIconSheet(', to: 'function startChangeIcon(' },
];

for (const s of SURFACES) {
  test(`${s.name}: the shared action bar, no backdrop click, no saving as you go, Escape and Cancel ask when dirty`, () => {
    const whole = read(s.file);
    const code = between(whole, s.from, s.to);
    assert.match(whole, /import \{ actionBar \} from '(\.|\/)\/?action-bar\.js';/, 'imports the shared piece');
    assert.match(code, /actionBar\(\{/, 'builds its bar with actionBar()');
    assert.match(code, /onSave:/);
    assert.match(code, /onCancel:/);
    assert.match(code, /dirty:/, 'tells the bar what would be lost');
    assert.match(code, /\.appendChild\(\s*(state\.)?bar\.el\)/, 'the bar is a child of the surface');
    assert.ok(!/event\.target === (dlg|dialog|el|overlay|backdrop)\b/.test(code), 'a click outside does not close it');
    assert.ok(!/addEventListener\('(pointerdown|mousedown)'/.test(code) || !/outside|away/i.test(code), 'nothing watches for a press outside');
    assert.ok(!/scheduleSave|SAVE_AFTER|setTimeout\(\s*flush/.test(code), 'nothing saves as you go');
    assert.ok(/bindEscape\(|requestCancel\(/.test(code), 'Escape and Cancel go through the bar, which asks when dirty');
    assert.match(code, /'Escape'|bindEscape\(/, 'Escape is handled by the surface');
  });
}

test('the phase sheet: one PATCH from Save, edits held until then, no Close-and-save, a reader sees Close only', () => {
  const sheet = read('public/phase-sheet.js');
  const code = between(sheet, 'export function openPhaseSheet(');
  assert.equal((code.match(/await save\(/g) || []).length, 1, 'save() is called from one place: the bar\'s Save');
  assert.match(code, /onSave: async \(\) => \{\s*\n\s*const sending = draft;/, 'the whole phases object, once');
  assert.match(code, /readOnly: !canEdit,/);
  assert.match(code, /dirty: \(\) => canEdit && !sameDates\(draft, kept\)/);
  assert.ok(!/dlg\.addEventListener\('click'/.test(code), 'no click handler on the dialog (the backdrop)');
  assert.match(code, /dlg\.addEventListener\('cancel', \(event\) => \{ event\.preventDefault\(\); bar\.requestCancel\(\); \}\);/, 'the browser\'s own close request asks too');
  assert.match(code, /phase-sheet-close'\)\.addEventListener\('click', \(\) => bar\.requestCancel\(\)\)/, 'the X asks too');
  assert.match(code, /update\(\);\s*\n\s*close\(\);[^\n]*\n\s*return true;/, 'a kept save closes the sheet');
  const close = between(code, "dlg.addEventListener('close'");
  assert.ok(!/save\(/.test(close.slice(0, 200)), 'closing saves nothing');
});

test('the Set up panel: Save and Cancel are the panel\'s bar, not the top bar\'s; the dates and the module settings are drafts saved with it; no outside close', () => {
  const setup = read('public/space-setup.js');
  const space = read('public/space.js');
  assert.ok(!/id: 'setup-done'|id: 'setup-cancel'/.test(space), 'no Done or Cancel tool in the top bar');
  assert.ok(!/setup-row-done|setup-row-cancel|>Done</.test(setup), 'no Done');
  assert.match(setup, /ids: \{ save: 'setup-save', cancel: 'setup-cancel-button' \}/);
  // The phase dates are drawn in the panel and saved with its Save (plan-setup-panel.md, step 4); the chip's sheet keeps its own.
  assert.match(setup, /A phase with no dates is skipped\. Saved with Save\./);
  assert.ok(!/save as you set them|The dates have their own Save in the sheet/.test(setup), 'the old lines are gone');
  assert.ok(!/openPhases/.test(setup), 'the panel no longer opens the sheet');
  // The module settings are drawn without their own Saves (module-settings.js, draft mode); the panel's Save sends them.
  assert.match(setup, /deps\.renderModuleSettings\(box, \{ scope: 'space', space: space\.id, draft: true, onChange: \(\) => refresh\(\) \}\)/);
  const ms = read('public/module-settings.js');
  assert.match(ms, /\$\{draft \? '' : '<div class="row"><button class="btn btn-primary btn-small" data-save type="button">Save<\/button>/, 'no Save on a card in the draft mode');
  assert.match(ms, /if \(draft\) \{ if \(event\.target\.closest\('\[data-list\], \[data-icon-choice\]'\)\) told\(\); return; \}/, 'a press in the draft mode sends nothing');
  assert.match(setup, /dirty: isDirty,/);
  assert.match(setup, /discardWords: 'Discard your changes\?',/, 'the panel asks host.ui.editor\'s question');
  assert.match(setup, /if \(hideDeleteConfirm\(\{ focus: true \}\)\) return;\n\s*state\.bar\.requestCancel\(\);/, 'Escape: Keep on the Delete question first, else Cancel (which asks when dirty)');
  assert.match(space, /onClick: \(\) => \(settingUp \? spaceSetup\.cancel\(\) : enterSetup\(\{ tab: '#show' \}\)\)/, 'the pressed Set up tool is Cancel too, asking when dirty');
  // Every field is a draft: the panel sends nothing but from Save, Delete, and the invite, guest link and Approve or Deny actions.
  const sends = [...setup.matchAll(/api\('(PATCH|PUT|POST|DELETE)', `([^`]*)`/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(sends.sort(), [
    'DELETE /api/spaces/${encodeURIComponent(space.id)}',
    'DELETE /api/spaces/${encodeURIComponent(space.id)}/image',
    'DELETE /api/spaces/${id}/guest-link',
    'PATCH /api/spaces/${encodeURIComponent(space.id)}',
    'POST /api/spaces/${id}/guest-link',
    'POST /api/spaces/${encodeURIComponent(space.id)}/access-requests/${encodeURIComponent(r.id)}',
    'PUT /api/modules/${encodeURIComponent(change.id)}/settings/space',
    'PUT /api/spaces/${encodeURIComponent(space.id)}/image',
  ].sort(), 'the requests: Save\'s PATCH, picture and module settings, Delete, the guest link, an answer to a request to come in');
  const save = between(setup, '  async function done() {', '  return { el, open');
  assert.ok(save.indexOf("api('PATCH'") < save.indexOf("api('PUT', `/api/spaces/") && save.indexOf("api('PUT', `/api/spaces/") < save.indexOf("api('PUT', `/api/modules/"), 'in order: the space, the picture, the module settings');
  assert.match(save, /\} catch \(err\) \{\n\s*if \(saved\.length && typeof opts\.onSaved === 'function'\) opts\.onSaved\(answered, saved\);\n\s*return refused\(saved, `module:\$\{change\.id\}`, err\.message\);/, 'a refused module stops the save and says what did save');
  assert.equal((setup.match(/api\('PATCH', `/g) || []).length, 1, 'one PATCH of the space, from Save');
  // The one other thing that goes at once: a space's shared tags, renamed, recoloured and deleted by the people the Roles grid lets (the
  // Tags section says so in its own line; plan-tags.md, decisions 4 and 8). Through the server's tag routes only; none is made here.
  assert.deepEqual([...setup.matchAll(/api\('(PATCH|PUT|POST|DELETE)', tagsPath\(/g)].map((m) => m[1]).sort(), ['DELETE', 'PATCH'], 'the tag requests: rename or recolour, and delete');
  assert.match(setup, /function cancel\(\) \{\s*\n\s*if \(!state \|\| state\.saving\) return;\s*\n\s*state\.bar\.requestCancel\(\);/, 'Cancel asks when dirty');
  const outside = between(space, '// --- Set up (space-setup.js)', '// --- end Set up ---');
  assert.ok(!/pointerdown|mousedown|click-?outside/i.test(outside.replace(/\/\/[^\n]*/g, '')), 'no press outside closes the panel');
  const rules = between(css, '/* space-setup:start', '/* space-setup:end */');
  assert.ok(!/\.setup-actions/.test(rules), 'the old button row\'s styles are gone');
  assert.match(rules, /@media \(max-width: 640px\) \{\s*\n\s*\.space-setup \{[^}]*height: 100dvh;/, 'a full-screen sheet on a phone');
});

test('the layout sheet: Save is the submit button, Enter saves, Save and Rename share the sheet', () => {
  const code = between(read('public/space.js'), 'function openLayoutSheet(', 'function openSaveLayout() {');
  assert.match(code, /submit: true,/);
  assert.match(code, /form\.addEventListener\('submit', \(event\) => \{\s*\n\s*event\.preventDefault\(\);\s*\n\s*bar\.save\(\);/);
});

// The sweep: a script that opens a modal <dialog> of its own is a surface (the editor window, host.ui.editor, is the
// model and has its own discard row; a confirmation is a menu row, not a <dialog>). Anything new must use the bar.
// The Dialogs family of the design system page opens real <dialog>s only to show how the proposed ones behave (Escape, Tab, the backdrop): a spec demo on a review page, not a surface of the product.
// The styled confirm (public/confirm.js) is a question, not an edit surface: nothing in it is saved, and a click outside it is the answer No.
// The styled prompt (public/prompt.js, host.ui.prompt) is the confirm's twin with one text field: a question, nothing in it is saved, and a click outside it is the answer null.
// The Share dialog (public/module-actions.js, the standard Share) hands out a link to copy: nothing in it is saved, and it closes
// on Close and Escape only.
// The Prototype's Vault dialogs (public/design-system/prototype-vault-dialogs.js) are drawings for review: the share sheet, the questions and the file chooser in the
// confirm look (public/confirm.js, above). They save nothing, and a click outside never closes them; the built module opens them with host.ui and the shared bar.
// The Add <space> dialog (public/template-choice.js) is a choice, as the confirm is: one Template select, nothing half-edited to lose, and a click outside it is Cancel.
// The object picker (public/object-pick.js, host.objects.pick) is a choice, not an edit surface: nothing in it is saved, and a click outside it is the answer "nothing chosen", as the confirm's.
const EXCEPTIONS = new Set(['public/design-system/prototype-vault-dialogs.js', 'public/sdk/host.js', 'public/action-bar.js', 'public/confirm.js', 'public/prompt.js', 'public/object-pick.js', 'public/template-choice.js', 'public/module-actions.js', 'public/design-system/legacy/system-v1/proposed-dialogs.js']);
const files = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'vendor' || e.name === 'node_modules' ? [] : files(`${dir}/${e.name}`)) : [`${dir}/${e.name}`]));
test('the sweep: every script in public/ that opens a modal dialog or closes one on its backdrop uses the action bar', () => {
  const offenders = [];
  for (const f of files('public').filter((x) => x.endsWith('.js') && !EXCEPTIONS.has(x))) {
    const text = read(f);
    const opens = /\.showModal\(\)/.test(text);
    const backdrop = /\b(e|event|ev)\.target === (dlg|dialog|backdrop)\b/.test(text) || /backdrop\.addEventListener\('(click|pointerdown|mousedown)'/.test(text);
    if ((opens || backdrop) && !/from '(\.|\/)\/?action-bar\.js'/.test(text)) offenders.push(`${f}: opens a dialog without the shared action bar (public/action-bar.js)`);
    if (backdrop) offenders.push(`${f}: closes a dialog on a click outside it`);
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('the lifted editor window (a module in a frame): a click on the host\'s backdrop does nothing; Escape and Close ask', () => {
  const host = read('public/module-host.js');
  const lift = between(host, '  function lift(open, size, height) {', '  return { lift, release');
  assert.match(lift, /backdrop\.className = 'module-editor-backdrop';/);
  assert.ok(!/backdrop\.addEventListener\(/.test(lift), 'no handler on the backdrop: a click outside leaves the window open');
  assert.match(lift, /close\.addEventListener\('click', \(\) => dismiss\(\)\);/, 'the host\'s Close still closes it');
  assert.match(host, /if \(e\.key !== 'Escape'\) return;[\s\S]{0,300}top\.dismiss\(\);/, 'Escape still closes it');
  assert.match(host, /tell: \(\) => send\('editordismiss', \{\}\)/, 'through the module\'s editor, which asks when something is half-edited');
  assert.match(read('public/sdk/host.js'), /host\.on\('editordismiss', \(\) => \{ const top = \[\.\.\.openEditors\.entries\(\)\]\.filter\(\(\[d\]\) => d\.open\)\.pop\(\); if \(top\) top\[1\]\.dismiss\(\); \}\);/);
});

test('the model stays: the editor window asks "Discard your changes?" and sticks its button row to the bottom', () => {
  const host = read('public/sdk/host.js');
  const dialogs = read('public/sdk/system.css'); // the Dialogs block
  assert.match(host, /Discard your changes\?/);
  assert.match(dialogs, /\.sdk-editor-actions \{\s*\n\s*position: sticky;\s*\n\s*bottom: 0;/);
  assert.match(dialogs, /\.sdk-editor-discard \{\s*\n\s*position: sticky;\s*\n\s*bottom: 0;/);
});

if (failed) {
  console.error(`check-action-bar: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-action-bar: OK (${n} tests)`);
