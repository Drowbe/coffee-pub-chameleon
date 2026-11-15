#!/usr/bin/env node
/*
 * check-defaults.mjs -- the reactions and icons every environment starts with (GitHub #169, server/default-lists.js):
 * a fresh store has the curated sets; the once-only move from the old defaults takes an environment still on exactly
 * them (reactions and icons judged separately, single and hosted alike, since each environment has its own store),
 * leaves one an owner changed alone, and changes nothing the second time; a template may carry the full reaction set
 * and icon set; and every default icon draws from the Font Awesome Free this server ships.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
process.env.PRODUCT_NAME = 'Testname';
const lists = require('../server/default-lists.js');
const { Store, cleanReactions } = require('../server/store.js');
const { buildEnvironment } = require('../server/environment.js');
const templates = require('../server/templates.js');
const { bundledModules } = require('../server/module-build.js');

const { DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST, OLD_DEFAULT_REACTIONS, OLD_DEFAULT_ICONS } = lists;
const FA = path.dirname(require.resolve('@fortawesome/fontawesome-free/package.json'));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-defaults-'));
let n = 0;
let failed = 0;
const test = (name, fn) => {
  try { fn(); n += 1; } catch (err) { failed += 1; console.error(`check-defaults: ${name}: ${err.stack || err.message}`); }
};
const quiet = () => {};
let dirs = 0;
// An environment folder holding `settings` (and nothing else of note) as an app.json from before #169.
function oldEnvironment(settings) {
  const dir = path.join(base, `env-${(dirs += 1)}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify({ settings: { iconsSeeded: true, ...settings } }));
  return dir;
}
const stored = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8')).settings;
const clone = (v) => structuredClone(v);

test('the curated lists themselves', () => {
  assert.equal(DEFAULT_REACTION_LIST.length, 105, '105 reactions');
  assert.equal(DEFAULT_ICON_LIST.length, 113, '113 icons');
  assert.deepEqual(DEFAULT_REACTION_LIST.slice(0, 6).map((r) => r.label), ['Heart', 'Black Heart', '100%', 'Hi', 'Thumbs up', 'Thumbs down'], 'the 1-6 shortcuts');
  const byId = Object.fromEntries(DEFAULT_REACTION_LIST.map((r) => [r.id, r.label]));
  assert.deepEqual([byId.alligator, byId.avocado, byId['santa-claus'], byId['mrs-claus'], byId.hen, byId.rooster, byId.chicken],
    ['Alligator', 'Avocado', 'Santa Claus', 'Mrs. Claus', 'Hen', 'Rooster', 'Chicken'], 'the spellings and the two chickens');
  for (const r of DEFAULT_REACTION_LIST) assert.ok(!/^r[a-z0-9]{6}$/.test(r.id) || r.id === 'rooster', `no made-up id: ${r.id}`);
  assert.equal(new Set(DEFAULT_REACTION_LIST.map((r) => r.id)).size, 105, 'reaction ids are unique');
  assert.equal(new Set(DEFAULT_ICON_LIST.map((i) => i.id)).size, 113, 'icon ids are unique (no repeats)');
  // Each survives the store's own cleaning unchanged: the field shapes and id rules hold.
  assert.deepEqual(cleanReactions(clone(DEFAULT_REACTION_LIST)), DEFAULT_REACTION_LIST, 'cleanReactions keeps every reaction as it is');
  const store = new Store(path.join(base, 'shape'));
  store.updateSettings({ icons: clone(DEFAULT_ICON_LIST), reactions: clone(DEFAULT_REACTION_LIST) });
  assert.deepEqual(store.settings.icons, DEFAULT_ICON_LIST, 'the store takes all 113 icons as they are');
  assert.deepEqual(store.settings.reactions, DEFAULT_REACTION_LIST, 'the store takes all 105 reactions as they are');
  const dice = DEFAULT_ICON_LIST.find((i) => i.id === 'dice-d20');
  assert.deepEqual(dice, { id: 'dice-d20', classes: 'fa-solid fa-dice-d20', label: 'dice d20' }, 'an icon entry');
  assert.deepEqual(DEFAULT_ICON_LIST.find((i) => i.id === 'xbox'), { id: 'xbox', classes: 'fa-brands fa-xbox', label: 'xbox' }, 'a brands entry');
});

test('every default icon draws from the bundled Font Awesome Free', () => {
  const css = fs.readFileSync(path.join(FA, 'css', 'all.css'), 'utf8');
  for (const icon of DEFAULT_ICON_LIST) {
    const [style, name] = icon.classes.split(' ').map((c) => c.slice(3));
    assert.ok(['solid', 'brands'].includes(style), `${icon.id}: solid or brands`);
    assert.ok(fs.existsSync(path.join(FA, 'svgs', style, `${name}.svg`)), `${icon.id}: svgs/${style}/${name}.svg ships`);
    assert.ok(css.includes(`.fa-${name} {`), `${icon.id}: all.css draws .fa-${name}`);
  }
});

test('a fresh store starts with the curated sets', () => {
  const dir = path.join(base, 'fresh');
  const store = new Store(dir);
  assert.deepEqual(store.settings.reactions, DEFAULT_REACTION_LIST);
  assert.deepEqual(store.settings.icons, DEFAULT_ICON_LIST);
  const s = stored(dir);
  assert.deepEqual([s.reactionsCuratedSeeded, s.iconsCuratedSeeded], [true, true], 'the once-only flags are stored');
  assert.deepEqual(s.reactions, DEFAULT_REACTION_LIST, 'and saved');
});

test('an untouched environment moves to the curated sets', () => {
  const dir = oldEnvironment({ reactions: clone(OLD_DEFAULT_REACTIONS), icons: clone(OLD_DEFAULT_ICONS) });
  const store = new Store(dir);
  assert.deepEqual(store.settings.reactions, DEFAULT_REACTION_LIST);
  assert.deepEqual(store.settings.icons, DEFAULT_ICON_LIST);
  assert.deepEqual(stored(dir).icons, DEFAULT_ICON_LIST, 'saved');
});

test('an environment from before the starter icons, with none, gets the curated icons', () => {
  const dir = path.join(base, 'pre-seed');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify({ settings: { reactions: clone(OLD_DEFAULT_REACTIONS) } }));
  const store = new Store(dir);
  assert.deepEqual(store.settings.icons, DEFAULT_ICON_LIST);
  assert.deepEqual(store.settings.reactions, DEFAULT_REACTION_LIST);
});

test('a customised environment is left alone, and the two lists are judged separately', () => {
  const reactions = clone(OLD_DEFAULT_REACTIONS);
  reactions[5].label = 'Natural 20';
  const icons = [...clone(OLD_DEFAULT_ICONS), { id: 'dragon', classes: 'fa-solid fa-dragon', label: 'dragon' }];
  const dir = oldEnvironment({ reactions, icons });
  const store = new Store(dir);
  assert.deepEqual(store.settings.reactions, reactions, 'a relabelled reaction keeps the owner\'s list');
  assert.deepEqual(store.settings.icons, icons, 'an added icon keeps the owner\'s list');

  const reordered = [OLD_DEFAULT_REACTIONS[1], OLD_DEFAULT_REACTIONS[0], ...OLD_DEFAULT_REACTIONS.slice(2)].map(clone);
  const one = new Store(oldEnvironment({ reactions: reordered, icons: clone(OLD_DEFAULT_ICONS) }));
  assert.deepEqual(one.settings.reactions, reordered, 'reordered reactions are a change');
  assert.deepEqual(one.settings.icons, DEFAULT_ICON_LIST, 'while untouched icons still move');

  const fewer = clone(OLD_DEFAULT_ICONS).slice(1);
  const two = new Store(oldEnvironment({ reactions: clone(OLD_DEFAULT_REACTIONS), icons: fewer }));
  assert.deepEqual(two.settings.reactions, DEFAULT_REACTION_LIST, 'untouched reactions move');
  assert.deepEqual(two.settings.icons, fewer, 'while a shortened icon list stays');

  const off = new Store(oldEnvironment({ reactions: [], icons: clone(OLD_DEFAULT_ICONS) }));
  assert.deepEqual(off.settings.reactions, [], 'reactions turned off stay off');
});

test('running twice changes nothing, and the old list picked again later is kept', () => {
  const dir = oldEnvironment({ reactions: clone(OLD_DEFAULT_REACTIONS), icons: clone(OLD_DEFAULT_ICONS) });
  new Store(dir);
  const once = fs.readFileSync(path.join(dir, 'app.json'), 'utf8');
  new Store(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'), once, 'a second load writes nothing new');
  const store = new Store(dir);
  store.updateSettings({ reactions: clone(OLD_DEFAULT_REACTIONS), icons: clone(OLD_DEFAULT_ICONS) });
  const again = new Store(dir);
  assert.deepEqual(again.settings.reactions, OLD_DEFAULT_REACTIONS, 'an owner who picks the old six keeps them');
  assert.deepEqual(again.settings.icons, OLD_DEFAULT_ICONS, 'an owner who picks the old 21 keeps them');
});

test('a hosted install: each environment\'s store moves on its own', () => {
  const untouched = oldEnvironment({ reactions: clone(OLD_DEFAULT_REACTIONS), icons: clone(OLD_DEFAULT_ICONS) });
  const custom = oldEnvironment({ reactions: [{ id: 'yes', glyph: '✅', label: 'Yes' }], icons: clone(OLD_DEFAULT_ICONS) });
  const a = buildEnvironment(untouched, { slug: 'one', log: quiet });
  const b = buildEnvironment(custom, { slug: 'two', log: quiet });
  try {
    assert.deepEqual(a.store.settings.reactions, DEFAULT_REACTION_LIST);
    assert.deepEqual(a.store.settings.icons, DEFAULT_ICON_LIST);
    assert.deepEqual(b.store.settings.reactions, [{ id: 'yes', glyph: '✅', label: 'Yes' }]);
    assert.deepEqual(b.store.settings.icons, DEFAULT_ICON_LIST);
  } finally {
    for (const env of [a, b]) env.close?.();
  }
});

// plan-templates-redesign.md, decision 12: the core reactions and icons are fixed; a template only adds to them.
test('a template only adds reactions and icons: a repeat of the core set is refused', () => {
  const travel = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'travel.json'), 'utf8'));
  const problems = (patch) => templates.problemsOf({ ...travel, ...patch }, { file: 'travel.json' });
  const core = clone(DEFAULT_REACTION_LIST).slice(0, 2);
  assert.deepEqual(problems({ reactions: core }), core.map((r, i) => `reactions[${i}]: ${r.glyph} is in the core set already; a template only adds.`));
  const solid = DEFAULT_ICON_LIST.filter((i) => i.classes.startsWith('fa-solid ')).map((i) => i.id).slice(0, 1);
  assert.deepEqual(problems({ iconSet: solid }), [`iconSet: "${solid[0]}" is in the core set already; a template only adds.`]);
  assert.deepEqual(problems({ reactions: [{ id: 'die', glyph: '\u{1f3b2}', label: 'Die' }] }), [], 'an addition is accepted');
});

fs.rmSync(base, { recursive: true, force: true });
if (failed) {
  console.error(`check-defaults: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-defaults: ${n} passed`);
