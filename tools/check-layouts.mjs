#!/usr/bin/env node
/*
 * check-layouts.mjs -- saved layouts, step 1 (documentation/plans/plan-saved-layouts.md, GitHub #161): the pure shape
 * check cleanLayout(), the limits, DATA_DIR/layouts.json (shared per space, each person's own per space), the clean-up
 * when a space or a person is removed, and the four routes under /api/spaces/:id/layouts with their codes for an
 * owner, a moderator, a member, someone not in the space, a guest and nobody signed in. Step 4: a space's
 * defaultLayout (owners, the admin and moderators), cleared when its layout is deleted, carried by
 * GET /api/modules/for-space, and nothing stored before it changed. Favorite layouts, step 1
 * (documentation/plans/plan-favorite-layouts.md, GitHub #190): each person's own per space, in the order favorited, of
 * the layouts they can see, with no limit of their own; the clean-up when a layout or a person is removed; a file
 * without favorites; and GET's favorites with PUT and DELETE .../favorite. Steps 2 and 3's page parts: public/space.js
 * asks those routes, keeps their answer, and a guest never asks. The shape check, the file and the page parts run
 * in-process; the routes run against a throwaway server. Layout views, step 1 (documentation/plans/plan-layout-views.md):
 * layouts gain kind and icon; the system layouts workspace, calendar and map are made per space from what is on and
 * never stored; a person's own name, icon and tab for them are stored per person per space (PATCH
 * .../layouts/system/:systemId); the favorite routes take calendar and map; there is no limit on favorites. Step 5 (the
 * first visit as one choice): defaultLayout also takes calendar and map while they are on in the space, it and opensWith
 * are independent fields, and GET .../layouts and GET /api/modules/for-space carry the resolved `firstVisit`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { Layouts, LayoutError, cleanLayout, cleanSystemPatch, LAYOUT_LIMITS, SYSTEM_IDS } = require('../server/layouts.js');
import { pathToFileURL } from 'node:url';
const { Store } = require('../server/store.js');

let n = 0;
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `check-layouts-${name}-`));
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const good = () => ({
  name: 'Game night',
  modules: [
    { id: 'conference', mode: 'dock' },
    { id: 'chat', mode: 'float', box: { x: 0.7, y: 0.05, w: 0.27, h: 0.6 }, snap: false },
    { id: 'calendar', mode: 'dock', dockW: 360 },
  ],
  snap: { all: false, pitch: 130 },
});
const refused = (input, pattern, label, options) => {
  const out = cleanLayout(input, options);
  assert.ok(out.error && !out.layout, `${label}: refused (${JSON.stringify(out)})`);
  if (pattern) assert.match(out.error, pattern, label);
  assert.match(out.error, /^[^\n]+\.$/, `${label}: one sentence`);
  n += 1;
};

// --- the conference and the chat in a layout (plan-one-bar.md, step 6) ------------------------------------------
// They live in the always-on column, so the page's layoutOf() never saves them and placeLayout() leaves them alone;
// the server keeps accepting them in a stored layout (an older one, or one a phone saved), so nothing stored breaks.
{
  const dir = tmp('column');
  fs.copyFileSync(path.join(ROOT, 'public/snap-grid.js'), path.join(dir, 'snap-grid.mjs'));
  const src = fs.readFileSync(path.join(ROOT, 'public/layouts.js'), 'utf8');
  fs.writeFileSync(path.join(dir, 'layouts.mjs'), src.replace("from '/snap-grid.js'", "from './snap-grid.mjs'"));
  const { layoutOf, placeLayout, COLUMN_IDS } = await import(pathToFileURL(path.join(dir, 'layouts.mjs')).href);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual([...COLUMN_IDS], ['conference', 'chat'], 'the column holds the conference and the chat');
  const area = { x: 0, y: 0, w: 1200, h: 800 };
  const saved = layoutOf([{ id: 'conference', mode: 'dock', order: -1, flex: true }, { id: 'chat', mode: 'dock', order: 0, width: 320 }, { id: 'calendar', mode: 'dock', order: 1, width: 360 }], area);
  assert.deepEqual(saved.modules.map((m) => m.id), ['calendar'], 'layoutOf() leaves the two out');
  const placed = placeLayout(good(), area);
  assert.deepEqual(placed.modules.map((m) => m.id), ['calendar'], 'placeLayout() places neither');
  assert.deepEqual(placed.left, [], 'and names neither as left out');
  assert.ok(cleanLayout(good()).layout, 'the server still accepts a layout naming them');
  n += 1;
  // The composite (plan-calendar-todo.md, step 3; public/composites.js's aliasesFor): a stored `calendar` or `todo` is
  // placed as `dest:calendar`, once, with the first one's mode and places; the layout itself is not rewritten, and
  // where the Calendar is off a stored `dest:calendar` places the To-do alone. The page saves a composite under its
  // main module's id, so the server's store (module ids only) takes it.
  const on = { calendar: 'dest:calendar', todo: 'dest:calendar' };
  const old = { modules: [{ id: 'todo', mode: 'float', box: { x: 0.1, y: 0.1, w: 0.4, h: 0.5 } }, { id: 'notes', mode: 'dock', dockW: 300 }, { id: 'calendar', mode: 'dock', dockW: 360 }], snap: { all: false, pitch: 130 } };
  const before = JSON.stringify(old);
  const read = placeLayout(old, area, () => true, on);
  assert.deepEqual(read.modules.map((m) => [m.id, m.mode]), [['dest:calendar', 'float'], ['notes', 'dock']], 'placeLayout() reads todo and calendar as one composite, where the first is named, with its mode');
  assert.deepEqual(read.left, [], 'and leaves nothing out for it');
  assert.equal(JSON.stringify(old), before, 'the stored layout is not rewritten');
  const off = placeLayout(old, area, (id) => id !== 'calendar', { 'dest:calendar': ['todo'] });
  assert.deepEqual([off.modules.map((m) => m.id), off.left], [['todo', 'notes'], ['calendar']], 'with no aliases for them the parts place as themselves, canOpen deciding');
  const kept = placeLayout({ modules: [{ id: 'dest:calendar', mode: 'dock' }, { id: 'notes', mode: 'dock' }] }, area, () => true, { 'dest:calendar': ['todo'] });
  assert.deepEqual(kept.modules.map((m) => m.id), ['todo', 'notes'], 'a stored dest:calendar places the To-do alone where the Calendar is off');
  const none = placeLayout({ modules: [{ id: 'dest:calendar', mode: 'dock' }] }, area, () => true, { 'dest:calendar': [] });
  assert.deepEqual([none.modules, none.left], [[], []], 'and nothing, not left out, where neither is on');
  const saved2 = layoutOf([{ id: 'calendar', mode: 'dock', order: 1, width: 360 }, { id: 'todo', mode: 'float', order: 2, box: { x: 10, y: 10, w: 300, h: 300 } }], area, {}, on);
  assert.deepEqual(saved2.modules.map((m) => m.id), ['dest:calendar'], 'layoutOf() through the aliases saves the composite once');
  assert.ok(!cleanLayout({ modules: [{ id: 'dest:calendar', mode: 'dock' }], snap: { all: false, pitch: 130 } }).layout, 'the server\'s store takes module ids only, so the page saves a composite under its main\'s id');
  // The Map (plan-map-places.md, step 3): a stored `maps` places `dest:map` once while the space's Map is
  // shown; with no map file (no aliases for it) it places as itself, and a stored `dest:map` places Maps.
  const mapOn = { maps: 'dest:map' };
  const oldMap = { modules: [{ id: 'maps', mode: 'dock', dockW: 300 }, { id: 'travel', mode: 'dock', dockW: 360 }], snap: { all: false, pitch: 130 } };
  const beforeMap = JSON.stringify(oldMap);
  const readMap = placeLayout(oldMap, area, () => true, mapOn);
  assert.deepEqual(readMap.modules.map((m) => [m.id, m.mode]), [['dest:map', 'dock'], ['travel', 'dock']], 'placeLayout() reads maps as the Map, with its mode');
  assert.equal(JSON.stringify(oldMap), beforeMap, 'the stored layout is not rewritten');
  assert.deepEqual(placeLayout(oldMap, area, () => true, {}).modules.map((m) => m.id), ['maps', 'travel'], 'with no map file Maps places as itself');
  assert.deepEqual(placeLayout({ modules: [{ id: 'dest:map', mode: 'dock' }] }, area, () => true, { 'dest:map': ['maps'] }).modules.map((m) => m.id), ['maps'], 'a stored dest:map places Maps where there is no map file');
  assert.deepEqual(layoutOf([{ id: 'maps', mode: 'dock', order: 1, width: 360 }], area, {}, mapOn).modules.map((m) => m.id), ['dest:map'], 'layoutOf() through the aliases saves the Map once');
  // A module's own snap (Thomas, 2026-10-13: the canvas-level switch is the only one): an older stored layout with one
  // still places, the field ignored; the server still accepts it; the page never saves it.
  const oldSnap = { name: 'Old', modules: [{ id: 'todo', mode: 'float', box: { x: 0.1, y: 0.1, w: 0.4, h: 0.5 }, snap: true }], snap: { all: false, pitch: 130 } };
  assert.ok(cleanLayout(oldSnap).layout, 'the server still accepts a module\'s own snap');
  const oldPlaced = placeLayout(oldSnap, area);
  assert.deepEqual(oldPlaced.modules.map((m) => [m.id, m.snap, Boolean(m.cell)]), [['todo', false, false]], 'a module\'s own stored snap is ignored');
  assert.ok(placeLayout({ ...oldSnap, snap: { all: true, pitch: 130 } }, area).modules[0].cell, 'the canvas-level snap still snaps it');
  assert.ok(!('snap' in layoutOf([{ id: 'todo', mode: 'float', order: 1, box: { x: 10, y: 10, w: 300, h: 300 }, snap: true }], area).modules[0]), 'layoutOf() never saves a module\'s own snap');
  n += 1;
}

// --- cleanLayout: the shape -------------------------------------------------------------------------------------

{
  const out = cleanLayout(good());
  assert.deepEqual(out.layout, good(), 'a good layout comes back as sent');
  const trimmed = cleanLayout({ ...good(), name: '  Game \t night  ', shared: true, modules: [{ id: 'calendar', mode: 'dock', dockW: 360.4 }], snap: { all: true, pitch: 99.6 } }).layout;
  assert.equal(trimmed.name, 'Game night', 'the name is trimmed, its whitespace collapsed');
  assert.equal(trimmed.shared, true);
  assert.equal(trimmed.modules[0].dockW, 360, 'pixels rounded');
  assert.equal(trimmed.snap.pitch, 100);
  assert.ok(!('snap' in cleanLayout({ name: 'x', modules: [{ id: 'chat', mode: 'dock' }] }).layout), 'snap may be left out');
  assert.equal(cleanLayout({ ...good(), name: 'é'.repeat(LAYOUT_LIMITS.name) }).layout.name.length, 40, '40 characters is allowed');
  assert.equal(cleanLayout({ ...good(), modules: Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, mode: 'dock' })) }).layout.modules.length, 20, '20 modules is allowed');
  const edge = cleanLayout({ name: 'Edge', modules: [{ id: 'a', mode: 'dock', dockW: 160 }, { id: 'b', mode: 'dock', dockW: 2000 }, { id: 'c', mode: 'float', box: { x: 0, y: 1, w: 1, h: 0.01 } }], snap: { all: true, pitch: 320 } });
  assert.ok(edge.layout, `the limits themselves are allowed: ${edge.error}`);
  assert.ok(cleanLayout({ ...good(), snap: { all: false, pitch: 50 } }).layout);
  n += 1;

  refused(null, /JSON/, 'not an object');
  refused([], /JSON/, 'a list');
  refused({ ...good(), extra: 1 }, /"extra"/, 'an unknown top-level field');
  refused({ ...good(), name: undefined }, /name/, 'no name');
  refused({ ...good(), name: '   ' }, /name/, 'a blank name');
  refused({ ...good(), name: 7 }, /text/, 'a name that is not text');
  refused({ ...good(), name: 'x'.repeat(41) }, /40 characters/, 'a name of 41 characters');
  refused({ ...good(), shared: 'yes' }, /shared with true or false/, 'shared not a boolean');
  assert.deepEqual(cleanLayout({ name: 'Blank', modules: [], arrange: 'window' }).layout, { name: 'Blank', modules: [], arrange: 'window' }, 'an empty list is a blank layout, and keeps its arrange');
  assert.ok(!('arrange' in cleanLayout({ ...good() }).layout), 'arrange may be left out');
  refused({ ...good(), arrange: 'grid' }, /dock or window/, 'arrange must be dock or window');
  refused({ ...good(), modules: undefined }, /List the/, 'no modules key');
  refused({ ...good(), modules: 'chat' }, /List the/, 'modules not a list');
  refused({ ...good(), modules: Array.from({ length: 21 }, (_, i) => ({ id: `m${i}`, mode: 'dock' })) }, /at most 20/, '21 modules');
  refused({ ...good(), modules: ['chat'] }, /id and a mode/, 'a module that is a string');
  refused({ ...good(), modules: [{ id: 'Chat', mode: 'dock' }] }, /"Chat" is not a module id/, 'a bad id');
  refused({ ...good(), modules: [{ mode: 'dock' }] }, /null is not a module id/, 'no id');
  refused({ ...good(), modules: [{ id: 'chat', mode: 'dock' }, { id: 'chat', mode: 'float' }] }, /listed twice/, 'an id twice');
  refused({ ...good(), modules: [{ id: 'chat', mode: 'window' }] }, /dock or float/, 'mode window');
  refused({ ...good(), modules: [{ id: 'chat' }] }, /dock or float/, 'no mode');
  refused({ ...good(), modules: [{ id: 'chat', mode: 'dock', cell: 3 }] }, /"cell"/, 'an unknown module field');
  refused({ ...good(), modules: [{ id: 'chat', mode: 'dock', dockW: 159 }] }, /160 to 2000/, 'dockW 159');
  refused({ ...good(), modules: [{ id: 'chat', mode: 'dock', dockW: 2001 }] }, /160 to 2000/, 'dockW 2001');
  refused({ ...good(), modules: [{ id: 'chat', mode: 'dock', dockW: '300' }] }, /160 to 2000/, 'dockW as text');
  refused({ ...good(), modules: [{ id: 'chat', mode: 'float', box: { x: 0, y: 0, w: 1.2, h: 0.5 } }] }, /fraction/, 'a box wider than the canvas');
  refused({ ...good(), modules: [{ id: 'chat', mode: 'float', box: { x: -0.1, y: 0, w: 0.5, h: 0.5 } }] }, /fraction/, 'a negative fraction');
  refused({ ...good(), modules: [{ id: 'chat', mode: 'float', box: { x: 0, y: 0, w: 0, h: 0.5 } }] }, /above 0/, 'a box of no width');
  refused({ ...good(), modules: [{ id: 'chat', mode: 'float', box: { x: 0, y: 0, w: 0.5 } }] }, /fraction/, 'a box with no h');
  refused({ ...good(), modules: [{ id: 'chat', mode: 'float', box: { x: 0, y: 0, w: 0.5, h: 0.5, z: 1 } }] }, /fraction/, 'a box with z');
  refused({ ...good(), modules: [{ id: 'chat', mode: 'float', snap: 'yes' }] }, /snap must be true or false/, 'a module snap not a boolean');
  refused({ ...good(), snap: { all: false, pitch: 49 } }, /50 to 320/, 'pitch 49');
  refused({ ...good(), snap: { all: false, pitch: 321 } }, /50 to 320/, 'pitch 321');
  refused({ ...good(), snap: { pitch: 100 } }, /all true or false/, 'snap with no all');
  refused({ ...good(), snap: true }, /snap must be/, 'snap not an object');
  refused({ ...good(), snap: { all: true, pitch: 100, cells: 3 } }, /snap must be/, 'snap with an extra field');
  refused({ ...good(), modules: [{ id: 'chat', mode: 'dock' }, { id: 'map', mode: 'dock', dockW: 50 }] }, /"map"/, 'one bad entry refuses the whole layout');

  // A PUT: any of name, modules, snap; never shared.
  assert.deepEqual(cleanLayout({ name: 'Planning' }, { partial: true }).layout, { name: 'Planning' });
  assert.deepEqual(cleanLayout({}, { partial: true }).layout, {});
  assert.deepEqual(cleanLayout({ snap: { all: true, pitch: 80 } }, { partial: true }).layout, { snap: { all: true, pitch: 80 } });
  refused({ shared: true }, /moved between/, 'a PUT cannot move a layout between lists', { partial: true });
  refused({ name: '' }, /name/, 'a PUT with a blank name', { partial: true });
  assert.deepEqual(cleanLayout({ modules: [], arrange: 'dock' }, { partial: true }).layout, { modules: [], arrange: 'dock' }, 'a PUT may empty the list');
  refused({ modules: 'chat' }, /List the/, 'a PUT with modules not a list', { partial: true });
}

// --- the file: lists, limits, names, clean-up --------------------------------------------------------------------

{
  const dir = tmp('file');
  const layouts = new Layouts(dir);
  assert.ok(!fs.existsSync(path.join(dir, 'layouts.json')), 'nothing written until something is saved');
  const g = cleanLayout(good()).layout;
  const shared = layouts.add('s1', 'pat', { ...g, shared: true });
  assert.match(shared.id, /^l[a-z0-9]{6}$/);
  assert.equal(shared.by, 'pat');
  assert.ok(!Number.isNaN(Date.parse(shared.at)));
  assert.ok(!('shared' in shared), 'shared is where it is kept, not a field');
  const mine = layouts.add('s1', 'pat', { ...g, name: 'game NIGHT' });
  assert.notEqual(mine.id, shared.id, 'the same name in the other list is fine');
  const onDisk = readJson(path.join(dir, 'layouts.json'));
  assert.deepEqual(Object.keys(onDisk), ['spaces']);
  assert.equal(onDisk.spaces.s1.shared[0].id, shared.id);
  assert.equal(onDisk.spaces.s1.people.pat[0].id, mine.id);
  assert.deepEqual(new Layouts(dir).list('s1', 'pat'), layouts.list('s1', 'pat'), 'read back as written');
  assert.deepEqual(layouts.list('s1', null).mine, [], 'a guest has none of their own');
  assert.equal(layouts.list('s1', 'sam').mine.length, 0, "nobody sees another person's own");
  assert.equal(layouts.list('s1', 'sam').shared.length, 1, 'everyone sees the shared ones');
  assert.equal(layouts.find('s1', mine.id, 'sam'), null, "another person's own is not found for anyone else");

  // Names unique in their list, regardless of case: 409 with the id of the one that has it.
  assert.throws(() => layouts.add('s1', 'pat', { ...g, name: 'GAME night' }), (e) => e instanceof LayoutError && e.status === 409 && e.extra.id === mine.id && e.message === 'There is already a layout called game NIGHT.');
  assert.throws(() => layouts.add('s1', 'sam', { ...g, shared: true, name: 'Game Night' }), (e) => e.status === 409 && e.extra.id === shared.id);
  assert.equal(layouts.add('s2', 'pat', { ...g }).name, 'Game night', 'the same name in another space is fine');

  // 10 personal per person per space, 10 shared per space.
  for (let i = 1; i < 10; i += 1) layouts.add('s1', 'pat', { ...g, name: `Mine ${i}` });
  assert.throws(() => layouts.add('s1', 'pat', { ...g, name: 'Eleventh' }), (e) => e.status === 409 && e.message === 'You have 10 saved layouts here. Delete one first.');
  assert.ok(layouts.add('s1', 'sam', { ...g, name: 'Eleventh' }), 'the limit is per person');
  for (let i = 1; i < 10; i += 1) layouts.add('s1', 'sam', { ...g, shared: true, name: `Shared ${i}` });
  assert.throws(() => layouts.add('s1', 'pat', { ...g, shared: true, name: 'Eleventh shared' }), (e) => e.status === 409 && e.message === 'This space has 10 shared layouts. Delete one first.');

  // Rename and replace; a rename onto a taken name is a 409; renaming to its own name in another case is fine.
  assert.equal(layouts.update('s1', mine.id, 'pat', { name: 'Game Night' }).name, 'Game Night');
  assert.throws(() => layouts.update('s1', mine.id, 'pat', { name: 'mine 1' }), (e) => e.status === 409);
  const replaced = layouts.update('s1', shared.id, 'sam', { modules: [{ id: 'chat', mode: 'dock' }], snap: { all: true, pitch: 90 } });
  assert.deepEqual(replaced.modules, [{ id: 'chat', mode: 'dock' }]);
  assert.equal(replaced.by, 'pat', 'by stays who saved it first');
  assert.equal(layouts.update('s1', mine.id, 'sam', { name: 'Taken' }), null, "nobody changes another person's own");
  assert.equal(layouts.remove('s1', mine.id, 'sam'), false);
  assert.equal(layouts.remove('s1', mine.id, 'pat'), true);
  assert.equal(layouts.find('s1', mine.id, 'pat'), null);

  // A removed space takes its layouts; a removed person takes their own everywhere, and the shared ones they saved stay.
  layouts.forgetPerson('pat');
  const after = readJson(path.join(dir, 'layouts.json'));
  assert.ok(!after.spaces.s1.people.pat && !after.spaces.s2, "pat's own are gone, and s2 had nothing else");
  assert.ok(after.spaces.s1.shared.some((l) => l.id === shared.id), 'the shared one pat saved stays');
  layouts.forgetSpace('s1');
  assert.deepEqual(readJson(path.join(dir, 'layouts.json')), { spaces: {} });
  n += 1;

  // A later version's extra fields survive a read and a write here; malformed entries are dropped.
  const dir2 = tmp('extra');
  fs.writeFileSync(path.join(dir2, 'layouts.json'), JSON.stringify({ spaces: { s1: { shared: [{ id: 'lfuture', name: 'Future', by: 'x', at: 'now', modules: [{ id: 'chat', mode: 'dock', later: 1 }], later: true }, 'junk', { id: 7 }], people: { pat: 'junk' } } } }));
  const kept = new Layouts(dir2);
  kept.add('s1', 'pat', { ...g });
  const back = readJson(path.join(dir2, 'layouts.json')).spaces.s1;
  assert.equal(back.shared.length, 1);
  assert.equal(back.shared[0].later, true, 'a field this version does not know is kept');
  n += 1;

  // A file that is there but cannot be read is never written over: lists read empty, every change refused with a 500.
  const dir3 = tmp('broken');
  fs.writeFileSync(path.join(dir3, 'layouts.json'), '{ not json');
  const broken = new Layouts(dir3);
  assert.deepEqual(broken.list('s1', 'pat'), { mine: [], shared: [] });
  assert.throws(() => broken.add('s1', 'pat', { ...g }), (e) => e.status === 500 && /cannot be read/.test(e.message));
  broken.forgetSpace('s1');
  broken.forgetPerson('pat');
  assert.equal(fs.readFileSync(path.join(dir3, 'layouts.json'), 'utf8'), '{ not json', 'left exactly as it was');
  n += 1;
  for (const d of [dir, dir2, dir3]) fs.rmSync(d, { recursive: true, force: true });
}

// --- favorites in the file (plan-favorite-layouts.md, step 1) ------------------------------------------------------

{
  const dir = tmp('favorites');
  const file = path.join(dir, 'layouts.json');
  const layouts = new Layouts(dir);
  const g = cleanLayout(good()).layout;
  const shared = Array.from({ length: 10 }, (_, i) => layouts.add('s1', 'mod', { ...g, name: `Shared ${i}`, shared: true }));
  const patOwn = Array.from({ length: 10 }, (_, i) => layouts.add('s1', 'pat', { ...g, name: `Pat ${i}` }));
  const samOwn = layouts.add('s1', 'sam', { ...g, name: 'Sam' });
  const before = fs.readFileSync(file, 'utf8');
  assert.ok(!('favorites' in readJson(file).spaces.s1), 'no favorites key while nobody has one');
  assert.deepEqual(layouts.favorites('s1', 'pat'), []);
  assert.deepEqual(layouts.favorites('s1', null), [], 'a guest has none');

  // Own and shared, in the order favorited; repeats change nothing; each person's are separate.
  assert.deepEqual(layouts.setFavorite('s1', shared[3].id, 'pat', true), [shared[3].id]);
  assert.deepEqual(layouts.setFavorite('s1', patOwn[0].id, 'pat', true), [shared[3].id, patOwn[0].id]);
  assert.deepEqual(layouts.setFavorite('s1', shared[0].id, 'pat', true), [shared[3].id, patOwn[0].id, shared[0].id], 'appended, not sorted');
  const once = fs.readFileSync(file, 'utf8');
  assert.deepEqual(layouts.setFavorite('s1', shared[3].id, 'pat', true), [shared[3].id, patOwn[0].id, shared[0].id], 'a repeat favorite changes nothing');
  assert.equal(fs.readFileSync(file, 'utf8'), once, 'and writes nothing');
  assert.deepEqual(layouts.setFavorite('s1', shared[1].id, 'pat', false), [shared[3].id, patOwn[0].id, shared[0].id], 'unfavoriting one that is not a favorite changes nothing');
  assert.deepEqual(layouts.setFavorite('s1', shared[3].id, 'sam', true), [shared[3].id], "sam's are his own");
  assert.deepEqual(layouts.favorites('s1', 'pat'), [shared[3].id, patOwn[0].id, shared[0].id], "sam's favorite does not touch pat's");
  assert.deepEqual(layouts.setFavorite('s1', patOwn[0].id, 'pat', false), [shared[3].id, shared[0].id], 'unfavorite keeps the order of the rest');
  assert.deepEqual(layouts.setFavorite('s1', patOwn[0].id, 'pat', true), [shared[3].id, shared[0].id, patOwn[0].id], 'favoriting again puts it at the end');

  // Only a layout this person can see: not another person's own, not an unknown id, not one in another space.
  assert.equal(layouts.setFavorite('s1', samOwn.id, 'pat', true), null, "another person's own");
  assert.equal(layouts.setFavorite('s1', 'lnosuch', 'pat', true), null, 'an unknown id');
  assert.equal(layouts.setFavorite('s2', shared[0].id, 'pat', true), null, 'a layout of another space');
  assert.equal(layouts.setFavorite('s1', shared[0].id, null, true), null, 'a guest');

  // No limit (plan-layout-views.md, decision 13): a 4th, 5th and more are accepted, own and shared alike, appended in
  // order; unfavoriting still works at any count.
  assert.ok(!('favorites' in LAYOUT_LIMITS), 'there is no favorites limit');
  assert.deepEqual(layouts.favorites('s1', 'pat'), [shared[3].id, shared[0].id, patOwn[0].id]);
  for (const x of [shared[5], patOwn[1], shared[6], shared[7], patOwn[2], shared[8], patOwn[3], patOwn[4]]) layouts.setFavorite('s1', x.id, 'pat', true);
  assert.deepEqual(layouts.favorites('s1', 'pat'), [shared[3], shared[0], patOwn[0], shared[5], patOwn[1], shared[6], shared[7], patOwn[2], shared[8], patOwn[3], patOwn[4]].map((l) => l.id), '11 favorites, in order');
  for (const x of [shared[0], patOwn[1], shared[6], shared[7], patOwn[2], shared[8], patOwn[3], patOwn[4]]) layouts.setFavorite('s1', x.id, 'pat', false);
  assert.deepEqual(layouts.favorites('s1', 'pat'), [shared[3].id, patOwn[0].id, shared[5].id], 'unfavorite at any count');
  const all = readJson(file).spaces.s1.favorites.pat;
  assert.deepEqual(all, [shared[3].id, patOwn[0].id, shared[5].id], 'the file holds them');
  assert.deepEqual(new Layouts(dir).favorites('s1', 'pat'), layouts.favorites('s1', 'pat'), 'read back as written');

  // Deleting a layout takes it out of every person's favorites; a removed person takes their favorites.
  layouts.remove('s1', shared[3].id, 'mod');
  assert.ok(!layouts.favorites('s1', 'pat').includes(shared[3].id), "gone from pat's");
  assert.ok(!readJson(file).spaces.s1.favorites.sam, "sam's list was only that one, so it is dropped");
  layouts.remove('s1', patOwn[0].id, 'pat');
  assert.deepEqual(readJson(file).spaces.s1.favorites.pat, [shared[5].id], "pat's own layout deleted: gone from pat's favorites");
  layouts.setFavorite('s1', shared[4].id, 'sam', true);
  layouts.forgetPerson('pat');
  assert.deepEqual(Object.keys(readJson(file).spaces.s1.favorites), ['sam'], "pat's favorites are gone, sam's stay");
  layouts.forgetPerson('sam');
  assert.ok(!('favorites' in readJson(file).spaces.s1), 'an empty favorites is dropped');
  n += 1;

  // A file from before favorites reads and writes as before; stored ids that are junk, repeated, or of a layout that
  // is gone are not read back as favorites.
  const dir2 = tmp('favorites-old');
  fs.writeFileSync(path.join(dir2, 'layouts.json'), before);
  const old = new Layouts(dir2);
  assert.equal(old.list('s1', 'pat').mine.length, 10, 'its layouts read as before');
  assert.equal(old.list('s1', 'pat').shared.length, 10);
  assert.deepEqual(old.favorites('s1', 'pat'), [], 'no favorites key reads as none');
  old.add('s1', 'sam', { ...g, name: 'Later' });
  assert.ok(!('favorites' in readJson(path.join(dir2, 'layouts.json')).spaces.s1), 'and writing adds no key');
  const raw = readJson(path.join(dir2, 'layouts.json'));
  raw.spaces.s1.favorites = { pat: [shared[0].id, 7, shared[0].id, 'lgone12', patOwn[1].id], sam: 'junk', ann: [] };
  fs.writeFileSync(path.join(dir2, 'layouts.json'), JSON.stringify(raw));
  const odd = new Layouts(dir2);
  assert.deepEqual(odd.favorites('s1', 'pat'), [shared[0].id, patOwn[1].id], 'junk and repeats dropped, a gone layout not shown');
  assert.deepEqual(odd.favorites('s1', 'sam'), []);
  // Tidied on load: ids of a gone layout, or of a layout that person cannot see, are not kept.
  assert.deepEqual(odd.spaces.s1.favorites, { pat: [shared[0].id, patOwn[1].id] }, 'only ids pat can see are kept');
  n += 1;

  // A space entry holding only favorites that name nothing left is dropped on load; one naming a malformed layout too.
  const dir3 = tmp('favorites-orphan');
  fs.writeFileSync(path.join(dir3, 'layouts.json'), JSON.stringify({ spaces: {
    s9: { shared: [], people: {}, favorites: { pat: ['lgone12'] } },
    s8: { shared: [{ id: 'lbroken', name: 7, modules: [] }], people: {}, favorites: { pat: ['lbroken'] } },
  } }));
  const orphan = new Layouts(dir3);
  assert.deepEqual(orphan.spaces, {}, 'a space left with only favorites of no layout is dropped on load');
  n += 1;

  // setFavorite writes back only the ids the person can see, plus the change: hand-edited ids leave the file.
  const dir4 = tmp('favorites-hand');
  const hand = readJson(path.join(dir2, 'layouts.json'));
  hand.spaces.s1.favorites = { pat: [shared[0].id] };
  fs.writeFileSync(path.join(dir4, 'layouts.json'), JSON.stringify(hand));
  const edited = new Layouts(dir4);
  edited.spaces.s1.favorites.pat.push('lhand01', samOwn.id); // as if the constructor had let them through
  assert.deepEqual(edited.setFavorite('s1', patOwn[2].id, 'pat', true), [shared[0].id, patOwn[2].id]);
  assert.deepEqual(readJson(path.join(dir4, 'layouts.json')).spaces.s1.favorites.pat, [shared[0].id, patOwn[2].id], 'a favorite writes back the visible list');
  edited.spaces.s1.favorites.pat.push('lhand01');
  assert.deepEqual(edited.setFavorite('s1', shared[0].id, 'pat', false), [patOwn[2].id]);
  assert.deepEqual(readJson(path.join(dir4, 'layouts.json')).spaces.s1.favorites.pat, [patOwn[2].id], 'an unfavorite writes back the visible list');
  edited.spaces.s1.favorites.pat.push('lhand01');
  edited.setFavorite('s1', patOwn[2].id, 'pat', false);
  assert.ok(!('favorites' in readJson(path.join(dir4, 'layouts.json')).spaces.s1), 'none left visible: the key is dropped');
  n += 1;

  // A stored list of more than 3 (from before the limit was lifted, or longer) reads whole: every visible id, in order;
  // ids that are gone leave the file at the next write.
  const dir5 = tmp('favorites-long');
  const long = JSON.parse(before);
  const tooMany = ['lgone12', shared[6].id, patOwn[2].id, shared[1].id, shared[8].id, patOwn[7].id];
  long.spaces.s1.favorites = { pat: tooMany };
  fs.writeFileSync(path.join(dir5, 'layouts.json'), JSON.stringify(long));
  const kept = new Layouts(dir5);
  const visible = [shared[6].id, patOwn[2].id, shared[1].id, shared[8].id, patOwn[7].id];
  assert.deepEqual(kept.favorites('s1', 'pat'), visible, 'all the visible ones, in the order favorited');
  assert.deepEqual(kept.list('s1', 'pat').mine.length, 10, 'its layouts read as before');
  assert.deepEqual(readJson(path.join(dir5, 'layouts.json')).spaces.s1.favorites.pat, tooMany, 'reading changes nothing in the file');
  kept.add('s1', 'sam', { ...g, name: 'Later' });
  assert.deepEqual(readJson(path.join(dir5, 'layouts.json')).spaces.s1.favorites.pat, visible, 'the id of a gone layout leaves at the next write');
  assert.deepEqual(kept.setFavorite('s1', shared[2].id, 'pat', true), [...visible, shared[2].id], 'a 6th is accepted');
  assert.deepEqual(kept.setFavorite('s1', patOwn[2].id, 'pat', false), visible.filter((id) => id !== patOwn[2].id).concat(shared[2].id), 'an unfavorite writes back the rest');
  n += 1;
  for (const d of [dir, dir2, dir3, dir4, dir5]) fs.rmSync(d, { recursive: true, force: true });
}

// --- layout views, step 1: kind, icon and the system layouts' per-person record ----------------------------------------

{
  assert.deepEqual([...SYSTEM_IDS], ['workspace', 'calendar', 'map', 'conference', 'whiteboard', 'documents']);
  // cleanLayout takes an icon (an id from the list it is given); the rest is as before.
  assert.equal(cleanLayout({ ...good(), icon: 'couch' }, { icons: ['couch', 'columns'] }).layout.icon, 'couch', 'an icon from the list');
  assert.equal(cleanLayout({ ...good(), icon: 'couch' }).layout.icon, 'couch', 'any well-formed id when no list is given');
  refused({ ...good(), icon: 'sofa' }, /^Pick an icon from the list\.$/, 'an icon not in the list', { icons: ['couch'] });
  refused({ ...good(), icon: 7 }, /Pick an icon/, 'an icon that is not text');
  refused({ ...good(), icon: 'Bad Icon!' }, /Pick an icon/, 'a malformed icon id');
  assert.equal(cleanLayout({ icon: 'couch' }, { partial: true, icons: ['couch'] }).layout.icon, 'couch', 'a PUT may change only the icon');

  // Stored user layouts have no kind or icon; the list reads them as kind user with the default icon, the file untouched.
  const dir = tmp('system');
  const file = path.join(dir, 'layouts.json');
  const layouts = new Layouts(dir);
  const g = cleanLayout(good()).layout;
  const plain = layouts.add('s1', 'pat', { ...g });
  const iconed = layouts.add('s1', 'pat', { ...g, name: 'Iconed', icon: 'couch' });
  assert.ok(!('kind' in readJson(file).spaces.s1.people.pat[0]) && !('icon' in readJson(file).spaces.s1.people.pat[0]), 'nothing is rewritten with a kind or an icon');
  const listed = layouts.list('s1', 'pat');
  assert.deepEqual(listed.mine.map((l) => [l.kind, l.icon]), [['user', 'object-group'], ['user', 'couch']], 'kind user, the default icon, or the stored one');
  assert.equal(layouts.update('s1', iconed.id, 'pat', { icon: 'star' }).icon, 'star', 'a PUT changes a user layout\'s icon');
  assert.equal(layouts.list('s1', 'pat').shared.length, 0);
  layouts.remove('s1', plain.id, 'pat');
  layouts.remove('s1', iconed.id, 'pat');
  assert.deepEqual(readJson(file), { spaces: {} });

  // The per-person record: name, icon and tab, stored beside favorites, nothing else in the file.
  assert.deepEqual(layouts.systemOf('s1', 'pat'), {}, 'none to begin with');
  assert.deepEqual(layouts.systemOf('s1', null), {}, 'a guest has none');
  assert.deepEqual(layouts.setSystem('s1', 'pat', 'workspace', { name: 'Desk', icon: 'couch' }), { name: 'Desk', icon: 'couch' });
  assert.deepEqual(layouts.setSystem('s1', 'pat', 'map', { tab: false }), { tab: false });
  assert.deepEqual(readJson(file), { spaces: { s1: { shared: [], people: {}, system: { pat: { workspace: { name: 'Desk', icon: 'couch' }, map: { tab: false } } } } } }, 'stored per person per space');
  assert.deepEqual(layouts.systemOf('s1', 'sam'), {}, "pat's choices are pat's");
  assert.deepEqual(layouts.systemOf('s2', 'pat'), {}, 'and this space\'s');
  assert.deepEqual(new Layouts(dir).systemOf('s1', 'pat'), layouts.systemOf('s1', 'pat'), 'read back as written');
  const once = fs.readFileSync(file, 'utf8');
  layouts.setSystem('s1', 'pat', 'map', { tab: false });
  assert.equal(fs.readFileSync(file, 'utf8'), once, 'doing what is already so writes nothing');
  assert.deepEqual(layouts.setSystem('s1', 'pat', 'workspace', { name: null }), { icon: 'couch' }, 'null puts the default name back');
  assert.deepEqual(layouts.setSystem('s1', 'pat', 'map', { tab: true }), {}, 'tab true puts the tab back');
  assert.ok(!('map' in readJson(file).spaces.s1.system.pat), 'and leaves nothing stored for it');
  layouts.setSystem('s1', 'pat', 'workspace', { icon: null });
  assert.deepEqual(readJson(file), { spaces: {} }, 'a record with nothing left is dropped, and the space with it');
  // Beside favorites and layouts it is cleaned with them.
  const own = layouts.add('s1', 'pat', { ...g });
  layouts.setFavorite('s1', own.id, 'pat', true);
  layouts.setSystem('s1', 'pat', 'calendar', { name: 'Plans' });
  layouts.setSystem('s1', 'sam', 'calendar', { name: 'Ours' });
  layouts.forgetPerson('pat');
  assert.deepEqual(Object.keys(readJson(file).spaces.s1.system), ['sam'], "a removed person takes their record; sam's stays");
  layouts.forgetSpace('s1');
  assert.deepEqual(readJson(file), { spaces: {} }, 'a removed space takes the records');
  // An unreadable-looking record is cleaned on load: unknown ids, a long name, a tab off for the Workspace.
  const dir2 = tmp('system-junk');
  fs.writeFileSync(path.join(dir2, 'layouts.json'), JSON.stringify({ spaces: { s1: { shared: [], people: {}, system: {
    pat: { workspace: { name: 'x'.repeat(41), icon: 'Bad!', tab: false }, calendar: { name: ' Plans ', tab: false }, other: { name: 'no' } }, sam: 'junk', ann: {},
  } } } }));
  const junk = new Layouts(dir2);
  assert.deepEqual(junk.systemOf('s1', 'pat'), { calendar: { name: 'Plans', tab: false } }, 'only what this version knows');
  assert.deepEqual(Object.keys(junk.spaces.s1.system), ['pat']);
  assert.throws(() => { fs.writeFileSync(path.join(dir2, 'layouts.json'), '{ not json'); new Layouts(dir2).setSystem('s1', 'pat', 'map', { tab: false }); }, (e) => e.status === 500, 'an unreadable file is never written over');

  // The pure check of a person's change.
  assert.deepEqual(cleanSystemPatch({ name: '  Our \t plans ', icon: 'couch', tab: false }, { icons: ['couch'] }).patch, { name: 'Our plans', icon: 'couch', tab: false });
  assert.deepEqual(cleanSystemPatch({ name: null, icon: null }).patch, { name: null, icon: null }, 'null goes back to the default');
  const bad = (input, pattern, label, o) => { const out = cleanSystemPatch(input, o); assert.ok(out.error && !out.patch && pattern.test(out.error) && /^[^\n]+\.$/.test(out.error), `${label}: ${JSON.stringify(out)}`); };
  bad(null, /JSON/, 'not an object');
  bad({}, /Send a new name/, 'nothing');
  bad({ name: '   ' }, /Give the layout a name/, 'a blank name');
  bad({ name: 7 }, /must be text/, 'a name that is not text');
  bad({ name: 'x'.repeat(41) }, /40 characters/, 'a long name');
  bad({ icon: 'sofa' }, /^Pick an icon from the list\.$/, 'an icon not in the list', { icons: ['couch'] });
  bad({ icon: 4 }, /Pick an icon/, 'an icon that is not text');
  bad({ tab: 'no' }, /true or false/, 'a tab that is not a boolean');
  bad({ modules: [] }, /"modules"/, 'a field it does not take');
  n += 1;
  for (const d of [dir, dir2]) fs.rmSync(d, { recursive: true, force: true });
}

// --- favorites on the page (plan-favorite-layouts.md, steps 2 and 3): the page asks the routes the server has --------

{
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
  // The server's two routes, and the page's request to them: PUT to favorite, DELETE to stop, no body.
  assert.match(server, /app\.put\('\/api\/spaces\/:id\/layouts\/:layoutId\/favorite', layoutFavorite\(true\)\);/);
  assert.match(server, /app\.delete\('\/api\/spaces\/:id\/layouts\/:layoutId\/favorite', layoutFavorite\(false\)\);/);
  const setFn = space.slice(space.indexOf('async function setFavorite('), space.indexOf('async function setDefaultLayout('));
  assert.match(setFn, /layoutRequest\(on \? 'PUT' : 'DELETE', `\/api\/spaces\/\$\{encodeURIComponent\(id\)\}\/layouts\/\$\{encodeURIComponent\(layout\.id\)\}\/favorite`\)/, 'no body, no guest query');
  // It keeps what the answer says ({ favorites }) and GET's `favorites`, which the server answers for everyone.
  assert.match(setFn, /const \{ favorites, layout: answered \} = await layoutRequest\(/);
  assert.match(setFn, /if \(system\) system\.tab = answered && typeof answered\.tab === 'boolean' \? answered\.tab : on;/, 'Calendar and Map: the answer says whether their tab shows (plan-layout-views.md, step 2)');
  assert.match(setFn, /layoutList\.favorites = Array\.isArray\(favorites\) \? favorites : \[\];/);
  assert.match(server, /res\.json\(\{ mine, shared, system: systemLayoutsFor\(found\), defaultLayout: [^}]*favorites, canShare: found\.canShare, canSetDefault: found\.canSetDefault, \.\.\.\(found\.canSetDefault \? \{ tabs: tabsOf\(found\.space\.tabs\) \} : \{\}\) \}\);/);
  assert.match(space, /favorites: Array\.isArray\(got\.favorites\) \? got\.favorites : \[\]/);
  // A guest never asks: no ... entry, no favorite tabs (the server's 403 is the backstop).
  assert.match(space, /const mayFavorite = \(\) => !guestToken && Boolean\(me\?\.key\) && me\.role !== 'guest';/);
  assert.match(space, /favorites: mayFavorite\(\) && layoutList\.spaceId === layoutSpaceId\(\) \? layoutList\.favorites : \[\],/);
  // The first visit on the page (plan-layout-views.md, step 5): the list keeps the server's resolved firstVisit, a
  // system row is marked Default from it, and Make default sends `defaultLayout` alone (Opens with is never sent).
  assert.match(space, /firstVisit: got\.firstVisit && typeof got\.firstVisit\.layout === 'string' \? got\.firstVisit : null,/);
  assert.match(space, /tag: l\.id !== 'workspace' && l\.id === layoutList\.firstVisit\?\.layout \? 'Default' : undefined,/);
  const defaultFn = space.slice(space.indexOf('async function setDefaultLayout('), space.indexOf('async function replaceLayout('));
  assert.match(defaultFn, /api\('PATCH', `\/api\/spaces\/\$\{encodeURIComponent\(id\)\}`, \{ defaultLayout: layoutId \}\)/);
  assert.equal((defaultFn.match(/api\('PATCH'/g) || []).length, 1, 'Make default sends one PATCH, `defaultLayout` alone: never Opens with');
  const setupSrc = fs.readFileSync(path.join(ROOT, 'public/space-setup.js'), 'utf8');
  assert.match(setupSrc, /const fv = layouts\.firstVisit \|\| answer\.firstVisit;/, 'Set up starts from the resolved first visit');
  assert.match(setupSrc, /if \(nowLayout !== wasLayout\) patch\.defaultLayout = nowLayout;/, 'the layout goes only when it changed');
  // The layout tabs (plan-layout-views.md, steps 2 and 3) load the page's own copy, as a row in the menu does: a favorite
  // from the saved lists, Calendar and Map from GET's `system` list (their `modules`, the composite docked).
  assert.match(space, /const layout = tab && tab\.kind === 'system' \? findSystemLayout\(id\) : findLayout\(id\);\n\s*if \(!layout \|\| !Array\.isArray\(layout\.modules\)\) return;/);
  assert.match(space, /const findSystemLayout = \(id\) => layoutList\.system\.find\(\(l\) => l\.id === id\) \|\| null;/);
  assert.match(space, /system: Array\.isArray\(got\.system\) \? got\.system : \[\],/, 'GET\'s `system` list read for the tabs');
  n += 1;
}

// --- the store: removeSpace and removeUser take their layouts ---------------------------------------------------

{
  const dir = tmp('store');
  const store = new Store(dir);
  const pat = store.addUser({ login: 'pat', displayName: 'Pat', role: 'member', passwordHash: 'x' });
  const sam = store.addUser({ login: 'sam', displayName: 'Sam', role: 'member', passwordHash: 'x' });
  const a = store.addSpace({ name: 'A', members: [pat.key, sam.key] });
  const b = store.addSpace({ name: 'B', members: [pat.key, sam.key] });
  const g = cleanLayout(good()).layout;
  store.layouts.add(a.id, pat.key, { ...g });
  store.layouts.add(a.id, sam.key, { ...g, shared: true });
  store.layouts.add(b.id, pat.key, { ...g });
  store.layouts.add(b.id, sam.key, { ...g });
  store.removeSpace(a.id);
  let file = readJson(path.join(dir, 'layouts.json'));
  assert.ok(!file.spaces[a.id], 'a removed space takes its shared and personal layouts');
  store.removeUser(pat.key);
  file = readJson(path.join(dir, 'layouts.json'));
  assert.deepEqual(Object.keys(file.spaces[b.id].people), [sam.key], 'a removed person takes their own');
  assert.equal(path.dirname(store.layouts.file), dir, "layouts.json is in the environment's data folder, which its export and backup zip whole");
  fs.rmSync(dir, { recursive: true, force: true });
  n += 1;
}

// --- stacks (plan-panel-stacking.md, decision 4): cleanLayout() accepts and cleans them -----------------------------

{
  const dock = (id, extra = {}) => ({ id, mode: 'dock', dockW: 320, ...extra });
  const mods = (modules, options) => cleanLayout({ name: 'Stacked', modules }, options).layout?.modules;
  const stacked = [
    dock('calendar'),
    dock('todo', { stack: 's1', at: 0, h: 0.4 }),
    dock('polls', { stack: 's1', at: 1, h: 0.6, folded: true }),
  ];
  // A stack round-trips: the same shape comes back, and cleaning it again changes nothing.
  assert.deepEqual(mods(stacked), stacked, 'a stack of two round-trips');
  assert.deepEqual(mods(mods(stacked)), stacked, 'and cleaning it twice is the same');
  const three = [dock('todo', { stack: 'abc123', at: 0, h: 0.3 }), dock('polls', { stack: 'abc123', at: 1, h: 0.3 }), dock('notes', { stack: 'abc123', at: 2, h: 0.4, folded: false })];
  assert.deepEqual(mods(three), three, 'a stack of three round-trips, folded false kept');
  assert.deepEqual(mods([...stacked, dock('notes', { stack: 's2', at: 0 }), dock('budget', { stack: 's2', at: 1 })]).map((m) => m.stack), [undefined, 's1', 's1', 's2', 's2'], 'two stacks');
  // Old layouts, with no stack keys, are unchanged.
  assert.deepEqual(cleanLayout(good()).layout.modules, good().modules, 'a layout without stacks is as it was');
  n += 4;

  // Malformed shapes are cleaned, never refused and never trusted.
  const same = (input, expected, label) => { assert.deepEqual(mods(input), expected, label); n += 1; };
  same([dock('todo', { stack: 's1', at: 0, h: 0.5, folded: true })], [dock('todo')], 'one member is an ordinary column, all stack keys gone');
  same([dock('todo', { stack: 's1', at: 0 }), dock('polls', { stack: 's1', at: 1 }), dock('notes', { stack: 's1', at: 2 }), dock('budget', { stack: 's1', at: 3 })],
    [dock('todo', { stack: 's1', at: 0 }), dock('polls', { stack: 's1', at: 1 }), dock('notes', { stack: 's1', at: 2 }), dock('budget')], 'a fourth member becomes an ordinary column');
  same([dock('todo', { stack: 's1', at: 1 }), dock('polls', { stack: 's1', at: 0 })],
    [dock('polls', { stack: 's1', at: 0 }), dock('todo', { stack: 's1', at: 1 })], 'members come back in at order');
  same([dock('todo', { stack: 's1', at: 0 }), dock('x', { stack: 's1', at: 0 }), dock('polls', { stack: 's1', at: 7 })],
    [dock('todo', { stack: 's1', at: 0 }), dock('x', { stack: 's1', at: 1 }), dock('polls', { stack: 's1', at: 2 })], 'a repeated or out of range at keeps list order and is renumbered');
  same([dock('todo', { stack: 's1', at: 0 }), dock('calendar'), dock('polls', { stack: 's1', at: 1 })],
    [dock('todo', { stack: 's1', at: 0 }), dock('polls', { stack: 's1', at: 1 }), dock('calendar')], 'members are kept together at the first one');
  same([dock('todo', { stack: 's1', at: 0, h: 0.5 }), dock('polls', { stack: 's1', at: 1 })],
    [dock('todo', { stack: 's1', at: 0 }), dock('polls', { stack: 's1', at: 1 })], 'h on some members only is ignored');
  same([dock('todo', { stack: 's1', at: 0, h: 0.3 }), dock('polls', { stack: 's1', at: 1, h: 0.3 })],
    [dock('todo', { stack: 's1', at: 0 }), dock('polls', { stack: 's1', at: 1 })], 'h not adding up to 1 is ignored');
  same([dock('todo', { stack: 's1', at: 0, h: 'a' }), dock('polls', { stack: 's1', at: 1, h: 0.5 })],
    [dock('todo', { stack: 's1', at: 0 }), dock('polls', { stack: 's1', at: 1 })], 'h as text is ignored');
  same([dock('todo', { stack: 's1', at: 0, h: 0.02 }), dock('polls', { stack: 's1', at: 1, h: 0.98 })],
    [dock('todo', { stack: 's1', at: 0, h: 0.1 }), dock('polls', { stack: 's1', at: 1, h: 0.9 })], 'h is clamped to 0.1 and 0.9');
  same([dock('todo', { stack: 's1', at: 0, h: 0.02 }), dock('polls', { stack: 's1', at: 1, h: 0.5 })],
    [dock('todo', { stack: 's1', at: 0 }), dock('polls', { stack: 's1', at: 1 })], 'h that no longer adds up to 1 once clamped is ignored');
  same([dock('todo', { stack: 's1', at: 0, h: 0.1 }), dock('polls', { stack: 's1', at: 1, h: 0.9 })],
    [dock('todo', { stack: 's1', at: 0, h: 0.1 }), dock('polls', { stack: 's1', at: 1, h: 0.9 })], 'the edges of h are allowed');
  same([dock('todo', { stack: 's1', at: 0, h: 0.4, folded: 'yes' }), dock('polls', { stack: 's1', at: 1, h: 0.60004 })],
    [dock('todo', { stack: 's1', at: 0, h: 0.4 }), dock('polls', { stack: 's1', at: 1, h: 0.6 })], 'folded not a boolean is dropped, h rounded');
  for (const bad of ['', 'S1', 'a-b', 'x'.repeat(33), 7, null, {}]) {
    same([dock('todo', { stack: bad, at: 0 }), dock('polls', { stack: bad, at: 1 })], [dock('todo'), dock('polls')], `stack id ${JSON.stringify(bad)} is dropped`);
  }
  same([dock('todo', { stack: 's1', at: 0 }), dock('polls', { stack: 's1', at: 1 }), dock('notes', { stack: 's1', at: 1.5 })],
    [dock('todo', { stack: 's1', at: 0 }), dock('polls', { stack: 's1', at: 1 }), dock('notes', { stack: 's1', at: 2 })], 'a fractional at is not trusted');
  same([{ id: 'todo', mode: 'float', box: { x: 0, y: 0, w: 0.3, h: 0.3 }, stack: 's1', at: 0 }, dock('polls', { stack: 's1', at: 1 })],
    [{ id: 'todo', mode: 'float', box: { x: 0, y: 0, w: 0.3, h: 0.3 } }, dock('polls')], 'a floating module cannot be in a stack');
  assert.ok(cleanLayout({ name: 'x', modules: [dock('todo', { stack: 's1', at: 0, extra: 1 })] }).error, 'a key that is not a layout key is still refused');
  assert.ok(cleanLayout({ name: 'x', modules: [dock('todo', { stack: 's1' }), dock('todo', { stack: 's1' })] }).error, 'a module listed twice is still refused');
  n += 2;

  // Never stacked: the conference, Chat and the composites.
  same([dock('conference', { stack: 's1', at: 0 }), dock('polls', { stack: 's1', at: 1 })], [dock('conference'), dock('polls')], 'the conference cannot be stacked, so the other is alone');
  same([dock('chat', { stack: 's1', at: 0 }), dock('polls', { stack: 's1', at: 1 }), dock('todo', { stack: 's1', at: 2 })],
    [dock('chat'), dock('polls', { stack: 's1', at: 0 }), dock('todo', { stack: 's1', at: 1 })], 'Chat is left out of a stack, the rest stay stacked');
  assert.ok(cleanLayout({ name: 'x', modules: [dock('dest:calendar', { stack: 's1', at: 0 })] }).error, 'a composite is not a module id at all');
  assert.ok(!stackedOf(mods([dock('chat', { stack: 's1' }), dock('conference', { stack: 's1' })])), 'nothing is left stacked when only the refused were');
  n += 2;

  // The limits: a stack's members each count in the 20; the server holds no column limit.
  const twenty = Array.from({ length: 20 }, (_, i) => dock(`m${i}`, i < 3 ? { stack: 's1', at: i } : {}));
  assert.equal(mods(twenty).length, 20, '20 entries with a stack of three is allowed');
  assert.ok(cleanLayout({ name: 'x', modules: [...twenty, dock('m20')] }).error, 'the 21st is refused, stacked or not');
  // Nothing is lost to a bad stack: an entry a stack does not keep stays as an ordinary column, and the count is the same.
  const first = mods([dock('polls', { stack: 's1', at: 2 }), dock('todo', { stack: 's1', at: 0 }), dock('budget', { stack: 's1', at: 1 }), dock('notes', { stack: 's1', at: 0 })]);
  assert.equal(first.length, 4, 'the first-listed entry cut by the three-member limit is not lost');
  assert.deepEqual(first.map((m) => m.id).sort(), ['budget', 'notes', 'polls', 'todo'], 'every module is still there');
  assert.deepEqual(first.filter((m) => m.stack).map((m) => m.id), ['todo', 'notes', 'budget'], 'the three kept are the stack, in at order');
  assert.ok(!('stack' in first.find((m) => m.id === 'polls')), 'and the one cut is an ordinary column');
  const badAt = mods([dock('todo', { stack: 's1', at: 'x' }), dock('polls', { stack: 's1', at: 0 }), dock('notes', { stack: 's1', at: 1 }), dock('budget', { stack: 's1', at: 2 })]);
  assert.equal(badAt.length, 4, 'a first-listed entry with a bad at is not lost');
  assert.deepEqual(badAt.map((m) => m.id).sort(), ['budget', 'notes', 'polls', 'todo'], 'every module is still there (bad at)');
  const crafted = Array.from({ length: 20 }, (_, i) => dock(`m${i}`, { stack: 's1', at: 19 - i }));
  const craftedOut = mods(crafted);
  assert.equal(craftedOut.length, 20, 'twenty modules all in one stack come back as twenty');
  assert.deepEqual(craftedOut.map((m) => m.id).sort(), crafted.map((m) => m.id).sort(), 'none of the twenty is lost');
  assert.equal(craftedOut.filter((m) => m.stack).length, 3, 'three of them are the stack');
  // h is kept only when the members' own values add up to 1, before any clamping.
  same([dock('todo', { stack: 's1', at: 0, h: 1e308 }), dock('polls', { stack: 's1', at: 1, h: -1e308 })], [dock('todo', { stack: 's1', at: 0 }), dock('polls', { stack: 's1', at: 1 })], 'h of 1e308 and -1e308 is ignored');
  same([dock('todo', { stack: 's1', at: 0, h: 0.95 }), dock('polls', { stack: 's1', at: 1, h: 0.95 })], [dock('todo', { stack: 's1', at: 0 }), dock('polls', { stack: 's1', at: 1 })], 'h of 0.95 and 0.95 is ignored, not clamped to a sum of 1.8');
  const patched = cleanLayout({ modules: stacked }, { partial: true }).layout;
  assert.deepEqual(patched, { modules: stacked }, 'a PUT carries a stack too');
  n += 3;
}
function stackedOf(modules) { return modules.some((m) => 'stack' in m || 'at' in m || 'h' in m || 'folded' in m); }

// --- stacks, the page's half (plan-panel-stacking.md, step 6): public/layouts.js saves what cleanLayout() keeps -------
// layoutOf() saves a stack top first where its column is, with an id of its own in the layout and shares the server
// keeps as they are; placeLayout() reads it back, closing a stack up where a module is left out (one left is a column of
// its own) and taking equal heights where the server dropped the shares. The limits are the server's.
{
  const dir = tmp('stack-page');
  fs.copyFileSync(path.join(ROOT, 'public/snap-grid.js'), path.join(dir, 'snap-grid.mjs'));
  fs.writeFileSync(path.join(dir, 'layouts.mjs'), fs.readFileSync(path.join(ROOT, 'public/layouts.js'), 'utf8').replace("from '/snap-grid.js'", "from './snap-grid.mjs'"));
  const page = await import(pathToFileURL(path.join(dir, 'layouts.mjs')).href);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const k of ['stackMax', 'stackHMin', 'stackHMax', 'stackHSum', 'modules', 'dockWMin', 'dockWMax']) assert.equal(page.LAYOUT_LIMITS[k], LAYOUT_LIMITS[k], `the page's LAYOUT_LIMITS.${k} is the server's`);
  const area = { x: 0, y: 0, w: 1200, h: 800 };
  const open = [
    { id: 'travel', mode: 'dock', order: 1, width: 400 },
    { id: 'polls', mode: 'dock', order: 3, width: 300, stack: 'k2x9', at: 1, h: 0.3 },
    { id: 'todo', mode: 'dock', order: 2, width: 300, stack: 'k2x9', at: 0, h: 0.7, folded: true },
    { id: 'notes', mode: 'float', order: 4, box: { x: 10, y: 10, w: 300, h: 300 }, stack: 'k2x9', at: 2 },
  ];
  const saved = page.layoutOf(open, area);
  assert.deepEqual(saved.modules.map((m) => [m.id, m.stack, m.at, m.h, m.folded]), [['travel', undefined, undefined, undefined, undefined], ['todo', 's1', 0, 0.7, true], ['polls', 's1', 1, 0.3, false], ['notes', undefined, undefined, undefined, undefined]], 'layoutOf() saves the stack top first where its column is, and never a floating module in it');
  const kept = cleanLayout({ name: 'Stacked', ...saved }).layout;
  assert.deepEqual(kept.modules, saved.modules, 'the server keeps what the page saves, as it is');
  const back = page.placeLayout(kept, area);
  assert.deepEqual(back.modules.filter((m) => m.stack).map((m) => [m.id, m.at, m.h, m.folded]), [['todo', 0, 0.7, true], ['polls', 1, 0.3, false]], 'placeLayout() reads the stack back');
  const one = page.placeLayout(kept, area, (id) => id !== 'polls');
  assert.ok(!one.modules.some((m) => 'stack' in m) && one.left.includes('polls'), 'a stack left with one module is an ordinary column');
  const three = page.placeLayout({ modules: [{ id: 'a', mode: 'dock', stack: 'q', at: 0, h: 0.2 }, { id: 'b', mode: 'dock', stack: 'q', at: 1, h: 0.3 }, { id: 'c', mode: 'dock', stack: 'q', at: 2, h: 0.5 }] }, area, (id) => id !== 'b');
  assert.deepEqual(three.modules.map((m) => [m.id, m.at, m.h]), [['a', 0, 0.2857], ['c', 1, 0.7143]], 'one left out of three: the other two close up, their shares made whole');
  const dropped = cleanLayout({ name: 'x', modules: [{ id: 'a', mode: 'dock', stack: 'q', at: 0, h: 0.3 }, { id: 'b', mode: 'dock', stack: 'q', at: 1, h: 0.3 }] }).layout;
  assert.deepEqual(page.placeLayout(dropped, area).modules.map((m) => m.h), [0.5, 0.5], 'shares the server dropped are equal heights');
  const twenty = page.layoutOf(Array.from({ length: 21 }, (_, i) => ({ id: `m${i}`, mode: 'dock', order: i, ...(i >= 19 ? { stack: 'z', at: i - 19 } : {}) })), area);
  assert.ok(twenty.modules.length === 20 && !twenty.modules.some((m) => 'stack' in m), 'a stack cut by the 20 module limit is no stack');
  assert.ok(cleanLayout({ name: 'x', ...twenty }).layout, 'and the server takes it');
  n += 9;
}

// --- the store: a space's default layout (step 4) -----------------------------------------------------------------

{
  const dir = tmp('default');
  const store = new Store(dir);
  const pat = store.addUser({ login: 'pat', displayName: 'Pat', role: 'member', passwordHash: 'x' });
  const a = store.addSpace({ name: 'A', members: [pat.key] });
  const g = cleanLayout(good()).layout;
  store.updateSpace(a.id, { opensWith: ['chat'] });
  assert.ok(!('defaultLayout' in store.spaceById(a.id)), 'absent while not set');
  const shared = store.layouts.add(a.id, pat.key, { ...g, shared: true });
  const own = store.layouts.add(a.id, pat.key, { ...g, name: 'Mine' });

  // Setting it leaves Opens with alone (step 5: independent fields); refusals change nothing.
  let space = store.updateSpace(a.id, { defaultLayout: shared.id });
  assert.equal(space.defaultLayout, shared.id);
  assert.deepEqual(space.opensWith, ['chat'], "Opens with is not the layout's modules");
  assert.deepEqual(store.defaultLayoutOf(a.id), store.layouts.find(a.id, shared.id, null).layout, 'the whole layout');
  const storeRefused = (patch, status, pattern, label) => {
    const before = JSON.stringify(store.spaceById(a.id));
    assert.throws(() => store.updateSpace(a.id, { name: 'Renamed', ...patch }), (e) => e.status === status && pattern.test(e.message) && /^[A-Z][^\n]*\.$/.test(e.message), label);
    assert.equal(JSON.stringify(store.spaceById(a.id)), before, `${label}: nothing changed`);
    n += 1;
  };
  storeRefused({ defaultLayout: own.id }, 404, /no shared layout/, "a person's own layout cannot be the default");
  storeRefused({ defaultLayout: 'lnosuch' }, 404, /no shared layout/, 'no such layout');
  storeRefused({ defaultLayout: 7 }, 400, /shared layout's id/, 'not an id');
  storeRefused({ defaultLayout: 'calendar' }, 400, /Calendar is not on in this space/, 'Calendar with no way to tell it is on');
  store.systemLayoutOn = (spaceId, id) => spaceId === a.id && id === 'calendar';
  storeRefused({ defaultLayout: 'map' }, 400, /Map is not on in this space/, 'Map while it is off');
  space = store.updateSpace(a.id, { defaultLayout: 'calendar' });
  assert.deepEqual([space.defaultLayout, space.opensWith], ['calendar', ['chat']], 'a system id is kept as it is, Opens with too');
  assert.equal(store.defaultLayoutOf(a.id), null, 'defaultLayoutOf is a shared layout only');
  store.syncDefaultLayout(a.id);
  assert.equal(store.spaceById(a.id).defaultLayout, 'calendar', 'a system id is not cleared by a layout clean-up');
  space = store.updateSpace(a.id, { defaultLayout: 'workspace' });
  assert.ok(!('defaultLayout' in space), 'workspace is the same as none');
  space = store.updateSpace(a.id, { defaultLayout: shared.id, opensWith: ['notes'] });
  assert.deepEqual([space.defaultLayout, space.opensWith], [shared.id, ['notes']], 'both in one patch');
  store.updateSpace(a.id, { opensWith: ['chat'] });

  // Replacing its modules leaves Opens with; a rename does not touch it.
  store.layouts.update(a.id, shared.id, pat.key, { modules: [{ id: 'notes', mode: 'dock' }, { id: 'chat', mode: 'float', box: { x: 0, y: 0, w: 0.5, h: 0.5 } }] });
  store.syncDefaultLayout(a.id);
  assert.deepEqual(store.spaceById(a.id).opensWith, ['chat']);
  assert.equal(store.spaceById(a.id).defaultLayout, shared.id);

  // Kept across a restart.
  assert.equal(new Store(dir).spaceById(a.id).defaultLayout, shared.id, 'read back as written');
  store.updateSpace(a.id, { defaultLayout: 'calendar' });
  assert.equal(new Store(dir).spaceById(a.id).defaultLayout, 'calendar', 'a system id is read back as written');
  store.updateSpace(a.id, { defaultLayout: shared.id });

  // Opens with by hand keeps the default; null clears the default and keeps Opens with.
  space = store.updateSpace(a.id, { opensWith: ['chat', 'notes'] });
  assert.equal(space.defaultLayout, shared.id, 'changing Opens with keeps the default');
  assert.deepEqual(space.opensWith, ['chat', 'notes']);
  space = store.updateSpace(a.id, { opensWith: null });
  assert.equal(space.defaultLayout, shared.id, 'clearing Opens with keeps the default too');
  store.updateSpace(a.id, { opensWith: ['notes', 'chat'] });
  space = store.updateSpace(a.id, { defaultLayout: null });
  assert.ok(!('defaultLayout' in space), 'null clears it');
  assert.deepEqual(space.opensWith, ['notes', 'chat'], 'null leaves Opens with as it was');
  assert.equal(store.defaultLayoutOf(a.id), null);
  space = store.updateSpace(a.id, { defaultLayout: null, opensWith: null });
  assert.ok(!('opensWith' in space) && !('defaultLayout' in space), 'both cleared at once');
  store.updateSpace(a.id, { opensWith: ['notes', 'chat'] });

  // Deleting it clears the default and leaves Opens with; deleting another changes nothing.
  store.updateSpace(a.id, { defaultLayout: shared.id });
  const other = store.layouts.add(a.id, pat.key, { ...g, name: 'Other', shared: true });
  store.layouts.remove(a.id, other.id, pat.key);
  store.syncDefaultLayout(a.id);
  assert.equal(store.spaceById(a.id).defaultLayout, shared.id, 'deleting another shared layout keeps the default');
  store.layouts.remove(a.id, shared.id, pat.key);
  store.syncDefaultLayout(a.id);
  assert.ok(!('defaultLayout' in store.spaceById(a.id)), 'deleting the default layout clears it');
  assert.deepEqual(store.spaceById(a.id).opensWith, ['notes', 'chat'], 'and Opens with stays');
  n += 1;

  // Nothing stored breaks: a space from before this step (no defaultLayout) reads and writes as it did; a stored id
  // whose layout is gone reads as no default; a stored value that is not an id is dropped.
  const appFile = path.join(dir, 'app.json');
  const b = store.addSpace({ name: 'B', members: [] });
  const c = store.addSpace({ name: 'C', members: [] });
  const rawNow = readJson(appFile);
  const before = rawNow.spaces.find((r) => r.id === b.id);
  assert.ok(!('defaultLayout' in before), 'a new space has no defaultLayout key');
  rawNow.spaces.find((r) => r.id === a.id).defaultLayout = 'lgone12';
  rawNow.spaces.find((r) => r.id === c.id).defaultLayout = 'Not an id!';
  fs.writeFileSync(appFile, JSON.stringify(rawNow));
  const again = new Store(dir);
  assert.deepEqual(again.spaceById(b.id), store.spaceById(b.id), 'a space without a default reads exactly as before');
  assert.equal(again.spaceById(a.id).defaultLayout, 'lgone12', 'a stored id is kept as it is');
  assert.equal(again.defaultLayoutOf(a.id), null, 'and reads as no default while its layout is gone');
  assert.ok(!('defaultLayout' in again.spaceById(c.id)), 'a stored value that is not an id is dropped');
  fs.rmSync(dir, { recursive: true, force: true });
  n += 1;
}

// --- the routes, against a throwaway server -----------------------------------------------------------------------

const dataDir = tmp('server');
let child = null;
let port = 0;
let serverOut = '';
async function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir,
      ADMIN_PASSWORD: 'testpass1234',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverOut = '';
  child.stdout.on('data', (d) => { serverOut += d; });
  child.stderr.on('data', (d) => { serverOut += d; });
  port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${serverOut}`)); }, 25000);
    const onData = () => { const m = /listening on :(\d+)/.exec(serverOut); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${serverOut}`)); });
  });
}
const stopServer = () => new Promise((resolve) => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });

async function call(method, urlPath, { body, cookie } = {}) {
  const headers = { accept: 'application/json' };
  if (cookie) headers.cookie = `app_session=${cookie}`;
  let payload;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const expect = async (label, status, method, urlPath, options) => {
  const r = await call(method, urlPath, options);
  assert.equal(r.status, status, `${label}: ${method} ${urlPath} answered ${r.status} ${r.text}`);
  if (status >= 400) assert.match(r.json?.error || '', /^[A-Z"].*\.$/, `${label}: one plain sentence (${r.text})`);
  return r;
};

await startServer();
try {
  const login = async (name, password) => {
    const r = await call('POST', '/api/login', { body: { login: name, password } });
    assert.equal(r.status, 200, `${name} signs in: ${r.text}`);
    return r.json.token;
  };
  const owner = await login('admin', 'testpass1234');
  const mk = async (name) => (await call('POST', '/api/users', { cookie: owner, body: { login: name, displayName: name, role: 'member', password: 'memberpass1234' } })).json.user;
  const patUser = await mk('pat');
  const samUser = await mk('sam');
  const outUser = await mk('out');
  const space = (await call('POST', '/api/spaces', { cookie: owner, body: { name: 'Trip', members: [patUser.key, samUser.key] } })).json.space;
  const S = space.id;
  const L = `/api/spaces/${S}/layouts`;
  await expect('sam made moderator', 200, 'PATCH', `/api/users/${samUser.key}/spaces/${S}`, { cookie: owner, body: { permissions: { moderator: true } } });
  const pat = await login('pat', 'memberpass1234');
  const sam = await login('sam', 'memberpass1234');
  const out = await login('out', 'memberpass1234');
  await expect('guests allowed', 200, 'PATCH', `/api/spaces/${S}`, { cookie: owner, body: { allowGuests: true } });
  const guestToken = (await expect('guest link', 200, 'POST', `/api/spaces/${S}/guest-link`, { cookie: owner, body: {} })).json.space.guestToken;
  const asGuest = `?guest=${encodeURIComponent(guestToken)}`;

  // Who may read.
  // The system layouts (plan-layout-views.md, step 1): with no Calendar or Map on, only the Workspace; a guest has none.
  const workspace = { id: 'workspace', kind: 'system', name: 'Workspace', icon: 'columns', tab: true, shown: true, defaultName: 'Workspace', defaultIcon: 'columns', modules: [] };
  const empty = await expect('member reads', 200, 'GET', L, { cookie: pat });
  assert.deepEqual(empty.json, { mine: [], shared: [], system: [workspace], defaultLayout: null, firstVisit: { layout: 'workspace', opensWith: null }, favorites: [], canShare: false, canSetDefault: false });
  assert.deepEqual((await expect('moderator reads', 200, 'GET', L, { cookie: sam })).json, { mine: [], shared: [], system: [workspace], defaultLayout: null, firstVisit: { layout: 'workspace', opensWith: null }, favorites: [], canShare: true, canSetDefault: true, tabs: { order: [...SYSTEM_IDS], hide: [] } }, 'a moderator may set the default (plan-one-bar.md step 4)');
  assert.deepEqual((await expect('owner reads', 200, 'GET', L, { cookie: owner })).json, { mine: [], shared: [], system: [workspace], defaultLayout: null, firstVisit: { layout: 'workspace', opensWith: null }, favorites: [], canShare: true, canSetDefault: true, tabs: { order: [...SYSTEM_IDS], hide: [] } });
  assert.deepEqual((await expect('guest reads', 200, 'GET', `${L}${asGuest}`)).json, { mine: [], shared: [], system: [], defaultLayout: null, firstVisit: { layout: 'workspace', opensWith: null }, favorites: [], canShare: false, canSetDefault: false });
  await expect('nobody signed in', 401, 'GET', L);
  await expect('a member of another space', 404, 'GET', L, { cookie: out });
  await expect('no such space', 404, 'GET', '/api/spaces/nosuchsp/layouts', { cookie: pat });
  await expect('a guest of this space reading another', 403, 'GET', `/api/spaces/${(await call('GET', '/api/spaces', { cookie: owner })).json.spaces.find((s) => s.isLobby).id}/layouts${asGuest}`);
  n += 1;

  // Saving: personal for any member; shared for owners, the admin and the space's moderators; never a guest.
  const patOwn = await expect('member saves own', 201, 'POST', L, { cookie: pat, body: good() });
  assert.equal(patOwn.json.layout.name, 'Game night');
  assert.equal(patOwn.json.layout.by, patUser.key);
  const refusal = await expect('member saves shared', 403, 'POST', L, { cookie: pat, body: { ...good(), shared: true } });
  assert.equal(refusal.json.error, "Only owners, the admin and this space's moderators can change shared layouts.");
  await expect('guest saves', 403, 'POST', `${L}${asGuest}`, { body: good() });
  await expect('guest saves shared', 403, 'POST', `${L}${asGuest}`, { body: { ...good(), shared: true } });
  await expect('outsider saves', 404, 'POST', L, { cookie: out, body: good() });
  await expect('bad shape', 400, 'POST', L, { cookie: pat, body: { ...good(), modules: [{ id: 'chat', mode: 'window' }] } });
  // A blank layout (modules []) is saved like any layout: name required, the unique-name rule, a guest cannot create one.
  const blank = await expect('member saves a blank layout', 201, 'POST', L, { cookie: pat, body: { name: 'Blank one', modules: [], arrange: 'window' } });
  assert.deepEqual(blank.json.layout.modules, []);
  assert.equal(blank.json.layout.arrange, 'window', 'the arrangement mode is kept');
  assert.equal((await expect('blank name clash', 409, 'POST', L, { cookie: pat, body: { name: 'blank ONE', modules: [] } })).json.id, blank.json.layout.id);
  await expect('blank without a name', 400, 'POST', L, { cookie: pat, body: { modules: [] } });
  await expect('blank with a bad arrange', 400, 'POST', L, { cookie: pat, body: { name: 'Blank two', modules: [], arrange: 'x' } });
  await expect('guest saves a blank layout', 403, 'POST', `${L}${asGuest}`, { body: { name: 'Blank g', modules: [] } });
  assert.deepEqual((await call('GET', L, { cookie: pat })).json.mine.find((l) => l.id === blank.json.layout.id).modules, [], 'read back blank');
  await expect('delete the blank one', 204, 'DELETE', `${L}/${blank.json.layout.id}`, { cookie: pat });
  await expect('not JSON fields', 400, 'POST', L, { cookie: pat, body: { name: 'x' } });
  const samShared = await expect('moderator saves shared', 201, 'POST', L, { cookie: sam, body: { ...good(), name: 'Planning', shared: true } });
  const ownerShared = await expect('owner saves shared', 201, 'POST', L, { cookie: owner, body: { ...good(), shared: true } });
  const taken = await expect('name taken in own list', 409, 'POST', L, { cookie: pat, body: { ...good(), name: 'GAME NIGHT' } });
  assert.equal(taken.json.id, patOwn.json.layout.id, 'the 409 names the one with that name');
  assert.equal(taken.json.error, 'There is already a layout called Game night.');
  const takenShared = await expect('name taken in shared list', 409, 'POST', L, { cookie: sam, body: { ...good(), name: 'planning', shared: true } });
  assert.equal(takenShared.json.id, samShared.json.layout.id);
  n += 1;

  // Reading back: the shared ones for everyone, each person's own only for them.
  const patList = (await call('GET', L, { cookie: pat })).json;
  assert.deepEqual(patList.mine.map((l) => l.id), [patOwn.json.layout.id]);
  assert.deepEqual(patList.shared.map((l) => l.id), [samShared.json.layout.id, ownerShared.json.layout.id]);
  const guestList = (await call('GET', `${L}${asGuest}`)).json;
  assert.deepEqual(guestList.mine, []);
  assert.equal(guestList.shared.length, 2, 'a guest reads the shared ones');
  assert.deepEqual(guestList.shared.map((l) => l.id), patList.shared.map((l) => l.id), 'the same shared layouts a member reads');
  assert.deepEqual(guestList.system, [], 'a guest has no system layouts of their own');
  // Another space (B), with its own guest link: a guest reads only their own space's layouts, and every write is a 403.
  const spaceB = (await call('POST', '/api/spaces', { cookie: owner, body: { name: 'Other', members: [] } })).json.space;
  await expect('B allows guests', 200, 'PATCH', `/api/spaces/${spaceB.id}`, { cookie: owner, body: { allowGuests: true } });
  const guestB = `?guest=${encodeURIComponent((await expect('B guest link', 200, 'POST', `/api/spaces/${spaceB.id}/guest-link`, { cookie: owner, body: {} })).json.space.guestToken)}`;
  await expect('B owner saves shared', 201, 'POST', `/api/spaces/${spaceB.id}/layouts`, { cookie: owner, body: { ...good(), name: 'Only B', shared: true } });
  assert.deepEqual((await expect('guest of B reads B', 200, 'GET', `/api/spaces/${spaceB.id}/layouts${guestB}`)).json.shared.map((l) => l.name), ['Only B']);
  await expect('guest of A reads B', 403, 'GET', `/api/spaces/${spaceB.id}/layouts${asGuest}`);
  await expect('guest of B reads A', 403, 'GET', `${L}${guestB}`);
  assert.match((await expect('guest of A saves', 403, 'POST', `${L}${asGuest}`, { body: good() })).json.error, /load shared layouts but not save or change them/, 'a clear refusal');
  await expect('guest of A writes to B', 403, 'POST', `/api/spaces/${spaceB.id}/layouts${asGuest}`, { body: good() });
  const onlyB = (await call('GET', `/api/spaces/${spaceB.id}/layouts`, { cookie: owner })).json.shared[0].id;
  await expect('B layout removed again', 204, 'DELETE', `/api/spaces/${spaceB.id}/layouts/${onlyB}`, { cookie: owner });
  assert.deepEqual((await call('GET', L, { cookie: sam })).json.mine, [], "sam does not see pat's own");
  n += 1;

  // Changing: own by their person; shared by anyone who may share; guests never.
  const patPath = `${L}/${patOwn.json.layout.id}`;
  const samPath = `${L}/${samShared.json.layout.id}`;
  const renamed = await expect('member renames own', 200, 'PUT', patPath, { cookie: pat, body: { name: 'Quiet night' } });
  assert.equal(renamed.json.layout.name, 'Quiet night');
  assert.deepEqual(renamed.json.layout.modules, good().modules, 'a rename keeps the modules');
  const replaced = await expect('member replaces own', 200, 'PUT', patPath, { cookie: pat, body: { modules: [{ id: 'chat', mode: 'dock', dockW: 400 }], snap: { all: true, pitch: 100 } } });
  assert.equal(replaced.json.layout.name, 'Quiet night');
  assert.deepEqual(replaced.json.layout.snap, { all: true, pitch: 100 });
  await expect("someone else's own is not there", 404, 'PUT', patPath, { cookie: sam, body: { name: 'Mine now' } });
  await expect("the owner cannot reach a person's own either", 404, 'DELETE', patPath, { cookie: owner });
  await expect('member renames shared', 403, 'PUT', samPath, { cookie: pat, body: { name: 'Mine now' } });
  await expect('member deletes shared', 403, 'DELETE', samPath, { cookie: pat });
  await expect('guest renames shared', 403, 'PUT', `${samPath}${asGuest}`, { body: { name: 'Guest' } });
  await expect('guest deletes shared', 403, 'DELETE', `${samPath}${asGuest}`);
  await expect('owner renames the moderator\'s shared', 200, 'PUT', samPath, { cookie: owner, body: { name: 'Planning day' } });
  await expect('rename onto a taken shared name', 409, 'PUT', samPath, { cookie: sam, body: { name: 'game night' } });
  await expect('a PUT with nothing', 400, 'PUT', samPath, { cookie: sam, body: {} });
  await expect('a PUT moving lists', 400, 'PUT', samPath, { cookie: sam, body: { shared: false } });
  await expect('a PUT with a bad shape', 400, 'PUT', samPath, { cookie: sam, body: { snap: { all: true, pitch: 10 } } });
  await expect('no such layout', 404, 'PUT', `${L}/lnosuch`, { cookie: sam, body: { name: 'x' } });
  await expect('no such layout', 404, 'DELETE', `${L}/lnosuch`, { cookie: sam });
  await expect('moderator deletes the owner\'s shared', 204, 'DELETE', `${L}/${ownerShared.json.layout.id}`, { cookie: sam });
  assert.deepEqual((await call('GET', L, { cookie: pat })).json.shared.map((l) => l.name), ['Planning day']);
  n += 1;

  // The limits through the routes.
  for (let i = 1; i < 10; i += 1) await expect(`pat's own #${i + 1}`, 201, 'POST', L, { cookie: pat, body: { ...good(), name: `Mine ${i}` } });
  const full = await expect('the eleventh own', 409, 'POST', L, { cookie: pat, body: { ...good(), name: 'Eleventh' } });
  assert.equal(full.json.error, 'You have 10 saved layouts here. Delete one first.');
  for (let i = 1; i < 10; i += 1) await expect(`shared #${i + 1}`, 201, 'POST', L, { cookie: owner, body: { ...good(), name: `Shared ${i}`, shared: true } });
  const fullShared = await expect('the eleventh shared', 409, 'POST', L, { cookie: sam, body: { ...good(), name: 'Eleventh', shared: true } });
  assert.equal(fullShared.json.error, 'This space has 10 shared layouts. Delete one first.');
  const samMine = (await expect('sam may still save his own', 201, 'POST', L, { cookie: sam, body: { ...good(), name: 'Mine' } })).json.layout;
  n += 1;

  // Favorites (plan-favorite-layouts.md, step 1): each person's own, of the layouts they can see, in the order favorited.
  const seen = (await call('GET', L, { cookie: pat })).json;
  const patIds = seen.mine.map((l) => l.id);
  const sharedIds = seen.shared.map((l) => l.id);
  assert.equal(patIds.length + sharedIds.length, 20, 'pat sees 20 layouts');
  const fav = (id) => `${L}/${id}/favorite`;
  let r = await expect('favorite a shared layout', 200, 'PUT', fav(sharedIds[2]), { cookie: pat });
  assert.deepEqual(r.json, { favorites: [sharedIds[2]] });
  r = await expect('favorite own', 200, 'PUT', fav(patIds[0]), { cookie: pat });
  assert.deepEqual(r.json.favorites, [sharedIds[2], patIds[0]], 'appended');
  r = await expect('favorite again', 200, 'PUT', fav(sharedIds[2]), { cookie: pat });
  assert.deepEqual(r.json.favorites, [sharedIds[2], patIds[0]], 'a repeat changes nothing');
  r = await expect('unfavorite one that is not', 200, 'DELETE', fav(sharedIds[5]), { cookie: pat });
  assert.deepEqual(r.json.favorites, [sharedIds[2], patIds[0]], 'unfavoriting one that is not a favorite changes nothing');
  r = await expect('unfavorite own', 200, 'DELETE', fav(patIds[0]), { cookie: pat });
  assert.deepEqual(r.json.favorites, [sharedIds[2]]);
  r = await expect('unfavorite again', 200, 'DELETE', fav(patIds[0]), { cookie: pat });
  assert.deepEqual(r.json.favorites, [sharedIds[2]]);
  assert.deepEqual((await call('GET', L, { cookie: pat })).json.favorites, [sharedIds[2]], 'GET carries them');
  r = await expect('sam favorites a shared one', 200, 'PUT', fav(sharedIds[0]), { cookie: sam });
  assert.deepEqual(r.json.favorites, [sharedIds[0]], "sam's are separate");
  await expect('sam favorites his own', 200, 'PUT', fav(samMine.id), { cookie: sam });
  assert.deepEqual((await call('GET', L, { cookie: pat })).json.favorites, [sharedIds[2]], "pat's are untouched by sam's");
  assert.deepEqual((await call('GET', L, { cookie: owner })).json.favorites, [], 'the owner has none');
  assert.deepEqual((await call('GET', `${L}${asGuest}`)).json.favorites, [], 'a guest reads []');

  // Refusals: a guest 403, someone not in the space 404, nobody signed in 401; a layout this person cannot see 404.
  const guestFav = await expect('guest favorites', 403, 'PUT', `${fav(sharedIds[0])}${asGuest}`);
  assert.equal(guestFav.json.error, 'Guests can load shared layouts but not keep favorites.');
  await expect('guest unfavorites', 403, 'DELETE', `${fav(sharedIds[0])}${asGuest}`);
  await expect('outsider favorites', 404, 'PUT', fav(sharedIds[0]), { cookie: out });
  await expect('nobody signed in', 401, 'PUT', fav(sharedIds[0]));
  const notThere = await expect("another person's own", 404, 'PUT', fav(samMine.id), { cookie: pat });
  assert.equal(notThere.json.error, 'There is no such layout here.');
  await expect("another person's own, unfavorite", 404, 'DELETE', fav(samMine.id), { cookie: pat });
  await expect('an unknown layout', 404, 'PUT', fav('lnosuch'), { cookie: pat });
  await expect('no such space', 404, 'PUT', `/api/spaces/nosuchsp/layouts/${sharedIds[0]}/favorite`, { cookie: pat });
  assert.deepEqual((await call('GET', L, { cookie: pat })).json.favorites, [sharedIds[2]], 'refusals changed nothing');

  // No limit (plan-layout-views.md, decision 13): a 4th and a 5th PUT are a 200, appended; DELETE works at any count.
  for (const id of [patIds[3], sharedIds[0], sharedIds[6], patIds[7]]) await expect('favorite past 3', 200, 'PUT', fav(id), { cookie: pat });
  r = await expect('repeat past 3', 200, 'PUT', fav(patIds[3]), { cookie: pat });
  assert.deepEqual(r.json.favorites, [sharedIds[2], patIds[3], sharedIds[0], sharedIds[6], patIds[7]], 'five favorites, in order, a repeat changes nothing');
  await expect('unfavorite at five', 200, 'DELETE', fav(patIds[3]), { cookie: pat });
  r = await expect('and another', 200, 'DELETE', fav(patIds[7]), { cookie: pat });
  const order = [sharedIds[2], sharedIds[0], sharedIds[6]];
  assert.deepEqual(r.json.favorites, order);
  const stored = readJson(path.join(dataDir, 'layouts.json')).spaces[S].favorites;
  assert.deepEqual(stored[patUser.key], order, 'kept in layouts.json under favorites, by user key');
  assert.deepEqual(stored[samUser.key], [sharedIds[0], samMine.id]);

  // Deleting a shared layout takes it out of everyone's favorites.
  await expect('delete a shared favorite', 204, 'DELETE', `${L}/${sharedIds[0]}`, { cookie: owner });
  assert.deepEqual((await call('GET', L, { cookie: pat })).json.favorites, order.filter((id) => id !== sharedIds[0]), "gone from pat's");
  assert.deepEqual((await call('GET', L, { cookie: sam })).json.favorites, [samMine.id], "gone from sam's");
  assert.ok(!readJson(path.join(dataDir, 'layouts.json')).spaces[S].favorites[samUser.key].includes(sharedIds[0]), 'and from the file');
  await expect('a deleted layout', 404, 'PUT', fav(sharedIds[0]), { cookie: pat });
  await expect('replace the shared one deleted', 201, 'POST', L, { cookie: owner, body: { ...good(), name: 'Shared again', shared: true } });
  n += 1;

  // Kept across a restart, in DATA_DIR/layouts.json.
  await stopServer();
  const file = readJson(path.join(dataDir, 'layouts.json'));
  assert.equal(file.spaces[S].shared.length, 10);
  assert.equal(file.spaces[S].people[patUser.key].length, 10);
  await startServer();
  const pat2 = await login('pat', 'memberpass1234');
  assert.equal((await call('GET', L, { cookie: pat2 })).json.mine.length, 10, 'read back after a restart');
  assert.deepEqual((await call('GET', L, { cookie: pat2 })).json.favorites, order.filter((id) => id !== sharedIds[0]), 'favorites read back after a restart');

  // A stored list of more than 3 (from before the limit was lifted): GET answers all its visible ids, in order.
  await stopServer();
  const visibleNow = [...file.spaces[S].people[patUser.key], ...file.spaces[S].shared].map((l) => l.id);
  const longList = ['lgone12', ...visibleNow.slice(0, 6)];
  file.spaces[S].favorites[patUser.key] = longList;
  fs.writeFileSync(path.join(dataDir, 'layouts.json'), JSON.stringify(file));
  await startServer();
  const pat3 = await login('pat', 'memberpass1234');
  assert.deepEqual((await expect('GET with a long stored list', 200, 'GET', L, { cookie: pat3 })).json.favorites, visibleNow.slice(0, 6), 'all six visible');
  r = await expect('a 7th, over a long stored list', 200, 'PUT', fav(visibleNow[7]), { cookie: pat3 });
  assert.deepEqual(r.json.favorites, [...visibleNow.slice(0, 6), visibleNow[7]]);
  r = await expect('unfavorite one', 200, 'DELETE', fav(visibleNow[1]), { cookie: pat3 });
  assert.deepEqual(r.json.favorites, [visibleNow[0], ...visibleNow.slice(2, 6), visibleNow[7]]);
  assert.deepEqual(readJson(path.join(dataDir, 'layouts.json')).spaces[S].favorites[patUser.key], r.json.favorites, 'the file holds them, the gone id left');
  r = await expect('and favorite it again', 200, 'PUT', fav(visibleNow[1]), { cookie: pat3 });
  assert.deepEqual(r.json.favorites, [visibleNow[0], ...visibleNow.slice(2, 6), visibleNow[7], visibleNow[1]]);
  n += 1;

  // The default layout (step 4), in a space of its own: owners only, Opens with in step both ways, cleared by a delete.
  const owner2 = await login('admin', 'testpass1234');
  const sam2 = await login('sam', 'memberpass1234');
  const camp = (await call('POST', '/api/spaces', { cookie: owner2, body: { name: 'Camp', members: [patUser.key, samUser.key] } })).json.space;
  assert.ok(!('defaultLayout' in camp), 'a new space has none');
  const C = `/api/spaces/${camp.id}`;
  await expect('sam made moderator of Camp', 200, 'PATCH', `/api/users/${samUser.key}/spaces/${camp.id}`, { cookie: owner2, body: { permissions: { moderator: true } } });
  const night = (await expect('moderator saves shared in Camp', 201, 'POST', `${C}/layouts`, { cookie: sam2, body: { ...good(), shared: true } })).json.layout;
  const plan = (await expect('owner saves shared in Camp', 201, 'POST', `${C}/layouts`, { cookie: owner2, body: { ...good(), name: 'Planning', modules: [{ id: 'calendar', mode: 'dock' }], shared: true } })).json.layout;
  const ownCamp = (await expect('owner saves own in Camp', 201, 'POST', `${C}/layouts`, { cookie: owner2, body: { ...good(), name: 'Mine' } })).json.layout;
  const forSpace = async (cookie, query = '') => (await expect('for-space', 200, 'GET', `/api/modules/for-space?space=${camp.id}${query}`, { cookie })).json;
  assert.equal((await forSpace(pat2)).defaultLayout, null, 'for-space: null while none is set');
  assert.equal((await call('GET', `${C}/layouts`, { cookie: pat2 })).json.defaultLayout, null);

  // Owners, the admin and the space's moderators (plan-one-bar.md step 4): a member and a guest are refused, and
  // nothing changes. The moderator's set is undone so the owner's below starts from none.
  const memberSets = await call('PATCH', C, { cookie: pat2, body: { defaultLayout: night.id } });
  assert.equal(memberSets.status, 403, `member sets the default: ${memberSets.text}`);
  assert.equal((await call('PATCH', C, { body: { defaultLayout: night.id } })).status, 401, 'nobody signed in');
  assert.equal((await call('GET', `${C}/layouts`, { cookie: owner2 })).json.defaultLayout, null, 'refusals changed nothing');
  await expect('moderator sets the default', 200, 'PATCH', C, { cookie: sam2, body: { defaultLayout: night.id } });
  assert.equal((await call('GET', `${C}/layouts`, { cookie: pat2 })).json.defaultLayout, night.id, 'a moderator set it');
  await expect('moderator stops using it', 200, 'PATCH', C, { cookie: sam2, body: { defaultLayout: null } });
  await expect('moderator clears Opens with', 200, 'PATCH', C, { cookie: sam2, body: { opensWith: null } });
  assert.equal((await call('GET', `${C}/layouts`, { cookie: owner2 })).json.defaultLayout, null);
  await expect("a person's own layout", 404, 'PATCH', C, { cookie: owner2, body: { defaultLayout: ownCamp.id } });
  await expect('no such layout', 404, 'PATCH', C, { cookie: owner2, body: { defaultLayout: 'lnosuch' } });
  await expect('not an id', 400, 'PATCH', C, { cookie: owner2, body: { defaultLayout: 12 } });
  await expect('a layout of another space', 404, 'PATCH', C, { cookie: owner2, body: { defaultLayout: samShared.json.layout.id } });
  n += 1;

  // Opens with and the default layout are independent (step 5): both in one body are fine, setting a layout leaves
  // Opens with as it was; every reader sees the layout and the resolved first visit.
  let set = await expect('both at once', 200, 'PATCH', C, { cookie: owner2, body: { defaultLayout: night.id, opensWith: ['chat'] } });
  assert.deepEqual([set.json.space.defaultLayout, set.json.space.opensWith], [night.id, ['chat']], 'both stored as sent');
  set = await expect('owner sets the default', 200, 'PATCH', C, { cookie: owner2, body: { defaultLayout: night.id, opensWith: ['conference', 'chat', 'calendar'] } });
  set = await expect('owner sets the default again', 200, 'PATCH', C, { cookie: owner2, body: { defaultLayout: night.id } });
  assert.equal(set.json.space.defaultLayout, night.id);
  assert.deepEqual(set.json.space.opensWith, ['conference', 'chat', 'calendar'], 'Opens with is not the layout\'s modules and is not touched');
  for (const [label, cookie] of [['owner', owner2], ['moderator', sam2], ['member', pat2]]) {
    const got = (await call('GET', `${C}/layouts`, { cookie })).json;
    assert.equal(got.defaultLayout, night.id, `${label} reads the default's id`);
    assert.deepEqual(got.firstVisit, { layout: night.id, opensWith: ['conference', 'chat', 'calendar'] }, `${label}: the resolved first visit`);
    const fs1 = await forSpace(cookie);
    assert.deepEqual(fs1.defaultLayout, night, `${label}: for-space carries the whole layout`);
    assert.deepEqual(fs1.opensWith, ['conference', 'chat', 'calendar'], `${label}: for-space's opensWith`);
    assert.deepEqual(fs1.firstVisit, got.firstVisit, `${label}: for-space says the same first visit`);
  }
  await expect('guests allowed in Camp', 200, 'PATCH', C, { cookie: owner2, body: { allowGuests: true } });
  const campGuest = `?guest=${encodeURIComponent((await expect('Camp guest link', 200, 'POST', `${C}/guest-link`, { cookie: owner2, body: {} })).json.space.guestToken)}`;
  assert.equal((await call('GET', `${C}/layouts${campGuest}`)).json.defaultLayout, night.id, 'a guest reads the default too');
  assert.deepEqual((await call('GET', `/api/modules/for-space?space=${camp.id}&guest=${campGuest.slice(7)}`)).json.defaultLayout, night, 'and gets it from for-space');
  assert.equal((await call('PATCH', `${C}${campGuest}`, { body: { defaultLayout: null } })).status, 401, 'a guest cannot clear it');

  // Replacing the default's modules, renaming it or replacing another layout leaves Opens with alone.
  await expect('moderator replaces the default', 200, 'PUT', `${C}/layouts/${night.id}`, { cookie: sam2, body: { modules: [{ id: 'chat', mode: 'dock' }, { id: 'notes', mode: 'dock' }] } });
  assert.deepEqual((await forSpace(pat2)).opensWith, ['conference', 'chat', 'calendar'], 'Opens with does not follow a replace');
  await expect('rename the default', 200, 'PUT', `${C}/layouts/${night.id}`, { cookie: sam2, body: { name: 'Late night' } });
  await expect('replace another', 200, 'PUT', `${C}/layouts/${plan.id}`, { cookie: owner2, body: { modules: [{ id: 'map', mode: 'dock' }] } });
  let fs2 = await forSpace(pat2);
  assert.deepEqual(fs2.opensWith, ['conference', 'chat', 'calendar']);
  assert.equal(fs2.defaultLayout.name, 'Late night');

  // Changing Opens with by hand keeps the default (the two are independent).
  set = await expect('Opens with by hand', 200, 'PATCH', C, { cookie: owner2, body: { opensWith: ['chat'] } });
  assert.equal(set.json.space.defaultLayout, night.id, 'the default is kept');
  assert.deepEqual((await forSpace(pat2)).firstVisit, { layout: night.id, opensWith: ['chat'] });

  // null stops using it and keeps Opens with: the first visit is Workspace with it.
  await expect('set another', 200, 'PATCH', C, { cookie: owner2, body: { defaultLayout: plan.id } });
  set = await expect('stop using it', 200, 'PATCH', C, { cookie: owner2, body: { defaultLayout: null } });
  assert.ok(!('defaultLayout' in set.json.space));
  assert.deepEqual(set.json.space.opensWith, ['chat'], 'null leaves Opens with as it was');
  assert.deepEqual((await forSpace(pat2)).firstVisit, { layout: 'workspace', opensWith: ['chat'] });

  // Deleting the default clears it and keeps Opens with; deleting another keeps it.
  await expect('set the default', 200, 'PATCH', C, { cookie: owner2, body: { defaultLayout: night.id } });
  await expect('delete another', 204, 'DELETE', `${C}/layouts/${plan.id}`, { cookie: owner2 });
  assert.equal((await call('GET', `${C}/layouts`, { cookie: pat2 })).json.defaultLayout, night.id, 'deleting another keeps the default');
  await expect('delete the default', 204, 'DELETE', `${C}/layouts/${night.id}`, { cookie: sam2 });
  assert.equal((await call('GET', `${C}/layouts`, { cookie: pat2 })).json.defaultLayout, null, 'deleting the default clears it');
  fs2 = await forSpace(pat2);
  assert.equal(fs2.defaultLayout, null);
  assert.deepEqual(fs2.opensWith, ['chat'], 'and Opens with stays');
  assert.deepEqual(fs2.firstVisit, { layout: 'workspace', opensWith: ['chat'] });
  const campRecord = (await call('GET', C, { cookie: owner2 })).json.space;
  assert.ok(!('defaultLayout' in campRecord), 'the key is gone from the record');
  n += 1;

  // System layouts through the routes (plan-layout-views.md, step 1). First with the Calendar off: only the Workspace, and
  // the Calendar's and Map's ids are not there (404) for a PATCH or a favorite.
  const SYS = `${L}/system`;
  const idsOf = async (cookie) => (await call('GET', L, { cookie })).json.system.map((l) => l.id);
  assert.deepEqual(await idsOf(pat3), ['workspace'], 'no Calendar layout while the Calendar is off in the space');
  await expect('PATCH Calendar while off', 404, 'PATCH', `${SYS}/calendar`, { cookie: pat3, body: { name: 'x' } });
  await expect('favorite Calendar while off', 404, 'PUT', fav('calendar'), { cookie: pat3 });
  await expect('favorite Map with no Maps', 404, 'PUT', fav('map'), { cookie: pat3 });
  await expect('PATCH an unknown system id', 404, 'PATCH', `${SYS}/nosuch`, { cookie: pat3, body: { name: 'x' } });

  // The first visit cannot be Calendar or Map while it is not on in the space (step 5): one plain sentence, 404.
  r = await expect('Calendar as the default, off', 400, 'PATCH', `/api/spaces/${S}`, { cookie: owner2, body: { defaultLayout: 'calendar' } });
  assert.equal(r.json.error, "Calendar is not on in this space, so it can't be the first visit.");
  assert.ok(!('defaultLayout' in (await call('GET', `/api/spaces/${S}`, { cookie: owner2 })).json.space), 'nothing was stored');

  // Turn the Calendar on (installed, enabled, in every space): the system layout appears for everyone in the space.
  await expect('install the Calendar', 201, 'POST', '/api/modules/bundled/calendar/install', { cookie: owner2 });
  await expect('enable the Calendar', 200, 'PATCH', '/api/modules/calendar', { cookie: owner2, body: { enabled: true, allSpaces: true } });
  const calendar = { id: 'calendar', kind: 'system', name: 'Calendar', icon: 'calendar-days', tab: true, shown: true, defaultName: 'Calendar', defaultIcon: 'calendar-days', modules: [{ id: 'calendar', mode: 'dock' }] };
  assert.deepEqual((await call('GET', L, { cookie: pat3 })).json.system, [workspace, calendar], 'Workspace then Calendar; Calendar is a tab from the start');
  assert.deepEqual(await idsOf(sam2), ['workspace', 'calendar'], 'everyone in the space');
  assert.deepEqual((await call('GET', `${L}${asGuest}`)).json.system, [], 'a guest still has none');
  assert.deepEqual(await idsOf(pat3), ['workspace', 'calendar']);
  await expect('Map still off (Maps not on)', 404, 'PATCH', `${SYS}/map`, { cookie: pat3, body: { tab: false } });

  // Rename and change the icon: the person's own, per space; names clean as today.
  r = await expect('rename Calendar', 200, 'PATCH', `${SYS}/calendar`, { cookie: pat3, body: { name: '  Our   plans ', icon: 'couch' } });
  assert.deepEqual(r.json, { layout: { ...calendar, name: 'Our plans', icon: 'couch' } });
  r = await expect('rename Workspace', 200, 'PATCH', `${SYS}/workspace`, { cookie: pat3, body: { name: 'Desk' } });
  assert.deepEqual(r.json.layout, { ...workspace, name: 'Desk' });
  assert.deepEqual((await call('GET', L, { cookie: pat3 })).json.system.map((l) => [l.id, l.name, l.icon]), [['workspace', 'Desk', 'columns'], ['calendar', 'Our plans', 'couch']], 'GET carries the choices');
  assert.deepEqual((await call('GET', L, { cookie: sam2 })).json.system.map((l) => [l.name, l.icon]), [['Workspace', 'columns'], ['Calendar', 'calendar-days']], "sam's are his own");
  r = await expect('back to the defaults', 200, 'PATCH', `${SYS}/calendar`, { cookie: pat3, body: { name: null, icon: null } });
  assert.deepEqual(r.json.layout, calendar);
  await expect('rename Calendar again', 200, 'PATCH', `${SYS}/calendar`, { cookie: pat3, body: { name: 'Our plans', icon: 'couch' } });
  assert.deepEqual(readJson(path.join(dataDir, 'layouts.json')).spaces[S].system[patUser.key], { workspace: { name: 'Desk' }, calendar: { name: 'Our plans', icon: 'couch' } }, 'kept in layouts.json under system, by user key');
  const sysBad = async (label, status, body, sentence, who = pat3) => {
    const bad = await expect(label, status, 'PATCH', `${SYS}/calendar`, { cookie: who, body });
    if (sentence) assert.equal(bad.json.error, sentence, label);
  };
  await sysBad('an icon not in the list', 400, { icon: 'no-such-icon-here' }, 'Pick an icon from the list.');
  await sysBad('a blank name', 400, { name: '  ' }, 'Give the layout a name.');
  await sysBad('a long name', 400, { name: 'x'.repeat(41) }, "A layout's name can be at most 40 characters.");
  await sysBad('a name that is not text', 400, { name: 4 });
  await sysBad('nothing to change', 400, {});
  await sysBad('a field it does not take', 400, { modules: [] }, 'A system layout does not take "modules".');
  await expect('the Workspace tab off', 400, 'PATCH', `${SYS}/workspace`, { cookie: pat3, body: { tab: false } }).then((x) => assert.equal(x.json.error, 'The Workspace is always shown.'));
  await expect('guest changes a system layout', 403, 'PATCH', `${SYS}/calendar${asGuest}`, { body: { name: 'Guest' } });
  await expect('outsider changes a system layout', 404, 'PATCH', `${SYS}/calendar`, { cookie: out, body: { name: 'x' } });
  await expect('nobody signed in', 401, 'PATCH', `${SYS}/calendar`, { body: { name: 'x' } });
  assert.equal((await call('GET', L, { cookie: pat3 })).json.system[1].name, 'Our plans', 'refusals changed nothing');

  // Deleting, replacing and making a system layout the default are refused; the sentence names it as the person sees it.
  assert.equal((await expect('delete Workspace', 400, 'DELETE', `${L}/workspace`, { cookie: pat3 })).json.error, "Desk can't be deleted.");
  assert.equal((await expect('delete Calendar', 400, 'DELETE', `${L}/calendar`, { cookie: pat3 })).json.error, "Our plans can't be deleted.");
  assert.equal((await expect('replace Calendar', 400, 'PUT', `${L}/calendar`, { cookie: pat3, body: { modules: [{ id: 'chat', mode: 'dock' }] } })).json.error, "Our plans can't be replaced.");
  await expect('delete Map while off', 400, 'DELETE', `${L}/map`, { cookie: pat3 });
  await expect('guest deletes a system layout', 403, 'DELETE', `${L}/workspace${asGuest}`);
  assert.equal((await call('GET', L, { cookie: pat3 })).json.system.length, 2, 'still there');

  // Calendar as the first visit (plan-layout-views.md, step 5): accepted now it is on, nothing else moves, the first
  // visit says so (with the viewer's own view: a guest has no system layouts, so Workspace), and Map is still refused.
  const firstVisitOf = async (cookie, query = '') => (await expect('first visit', 200, 'GET', `${L}${query}`, { cookie })).json.firstVisit;
  await expect('Opens with for Trip', 200, 'PATCH', `/api/spaces/${S}`, { cookie: owner2, body: { opensWith: ['chat', 'notes'] } });
  set = await expect('Calendar as the default layout', 200, 'PATCH', `/api/spaces/${S}`, { cookie: owner2, body: { defaultLayout: 'calendar' } });
  assert.deepEqual([set.json.space.defaultLayout, set.json.space.opensWith], ['calendar', ['chat', 'notes']], 'Opens with is not touched');
  assert.deepEqual(await firstVisitOf(pat3), { layout: 'calendar', opensWith: ['chat', 'notes'] });
  assert.deepEqual(await firstVisitOf(null, asGuest), { layout: 'workspace', opensWith: ['chat', 'notes'] }, 'a guest has no system layouts');
  assert.equal((await call('GET', L, { cookie: pat3 })).json.defaultLayout, null, "GET's defaultLayout stays a shared layout's id or null");
  assert.deepEqual((await call('GET', `/api/modules/for-space?space=${S}`, { cookie: pat3 })).json.firstVisit, { layout: 'calendar', opensWith: ['chat', 'notes'] }, 'for-space carries it too');
  await expect('Map while Maps is not on', 400, 'PATCH', `/api/spaces/${S}`, { cookie: owner2, body: { defaultLayout: 'map' } });
  set = await expect('Opens with changed, the default kept', 200, 'PATCH', `/api/spaces/${S}`, { cookie: owner2, body: { opensWith: ['todo'] } });
  assert.deepEqual([set.json.space.defaultLayout, set.json.space.opensWith], ['calendar', ['todo']]);
  assert.deepEqual(await firstVisitOf(pat3), { layout: 'calendar', opensWith: ['todo'] });
  assert.equal((await call('PATCH', `/api/spaces/${S}`, { cookie: pat3, body: { defaultLayout: 'calendar' } })).status, 403, 'a member sets Calendar');
  // Calendar goes off: the stored value stays, the first visit falls back to Workspace.
  await expect('disable the Calendar', 200, 'PATCH', '/api/modules/calendar', { cookie: owner2, body: { enabled: false } });
  assert.deepEqual(await firstVisitOf(pat3), { layout: 'workspace', opensWith: ['todo'] }, 'Calendar off: Workspace with Opens with');
  assert.equal((await call('GET', `/api/spaces/${S}`, { cookie: owner2 })).json.space.defaultLayout, 'calendar', 'nothing is deleted');
  await expect('Calendar refused while off', 400, 'PATCH', `/api/spaces/${S}`, { cookie: owner2, body: { defaultLayout: 'calendar' } });
  await expect('enable the Calendar again', 200, 'PATCH', '/api/modules/calendar', { cookie: owner2, body: { enabled: true, allSpaces: true } });
  assert.equal((await firstVisitOf(pat3)).layout, 'calendar', 'and back on, Calendar again');
  await expect('null back to Workspace', 200, 'PATCH', `/api/spaces/${S}`, { cookie: owner2, body: { defaultLayout: null } });
  assert.deepEqual(await firstVisitOf(pat3), { layout: 'workspace', opensWith: ['todo'] });
  await expect('Opens with cleared', 200, 'PATCH', `/api/spaces/${S}`, { cookie: owner2, body: { opensWith: null } });
  assert.deepEqual(await firstVisitOf(pat3), { layout: 'workspace', opensWith: null });

  // Favorites: Calendar can be un-favorited (its tab off) and back; Workspace cannot be un-favorited; none counts toward
  // anything else, and the saved layouts' favorites are unchanged.
  const savedFavs = (await call('GET', L, { cookie: pat3 })).json.favorites;
  r = await expect('unfavorite Calendar', 200, 'DELETE', fav('calendar'), { cookie: pat3 });
  assert.equal(r.json.layout.tab, false);
  assert.deepEqual(r.json.favorites, savedFavs, 'the saved layouts\' favorites are unchanged');
  assert.equal((await call('GET', L, { cookie: pat3 })).json.system[1].tab, false, 'GET says its tab is off');
  assert.equal((await call('GET', L, { cookie: sam2 })).json.system[1].tab, true, "and sam's is still on");
  assert.deepEqual(readJson(path.join(dataDir, 'layouts.json')).spaces[S].system[patUser.key].calendar, { name: 'Our plans', icon: 'couch', tab: false });
  r = await expect('unfavorite Calendar again', 200, 'DELETE', fav('calendar'), { cookie: pat3 });
  assert.equal(r.json.layout.tab, false, 'again changes nothing');
  r = await expect('favorite Calendar', 200, 'PUT', fav('calendar'), { cookie: pat3 });
  assert.deepEqual([r.json.layout.tab, r.json.layout.name], [true, 'Our plans']);
  assert.ok(!('tab' in readJson(path.join(dataDir, 'layouts.json')).spaces[S].system[patUser.key].calendar), 'the tab is back and nothing is stored for it');
  assert.equal((await expect('unfavorite Workspace', 400, 'DELETE', fav('workspace'), { cookie: pat3 })).json.error, 'The Workspace is always shown.');
  r = await expect('favorite Workspace', 200, 'PUT', fav('workspace'), { cookie: pat3 });
  assert.equal(r.json.layout.tab, true, 'it always has its tab');
  await expect('guest favorites Calendar', 403, 'PUT', `${fav('calendar')}${asGuest}`);
  await expect('outsider favorites Calendar', 404, 'PUT', fav('calendar'), { cookie: out });

  // More than three saved favorites in a space where the system layouts also have tabs: all accepted.
  const many = (await call('GET', L, { cookie: pat3 })).json;
  const others = [...many.mine, ...many.shared].map((l) => l.id).filter((id) => !many.favorites.includes(id));
  for (const id of others.slice(0, 5)) await expect('another favorite', 200, 'PUT', fav(id), { cookie: pat3 });
  assert.equal((await call('GET', L, { cookie: pat3 })).json.favorites.length, many.favorites.length + 5, 'no limit');

  // User layouts carry kind and icon; a stored icon is checked against the icon list.
  const iconed = await expect('save with an icon', 201, 'POST', L, { cookie: sam2, body: { ...good(), name: 'With icon', icon: 'couch' } });
  assert.equal(iconed.json.layout.icon, 'couch');
  await expect('save with a bad icon', 400, 'POST', L, { cookie: sam2, body: { ...good(), name: 'Bad icon', icon: 'no-such-icon-here' } });
  const listedNow = (await call('GET', L, { cookie: sam2 })).json;
  assert.deepEqual(listedNow.mine.map((l) => [l.name, l.kind, l.icon]), [['Mine', 'user', 'object-group'], ['With icon', 'user', 'couch']], 'each own layout has kind user and an icon');
  assert.ok(listedNow.shared.every((l) => l.kind === 'user' && typeof l.icon === 'string'), 'and each shared one');
  r = await expect('change a layout\'s icon', 200, 'PUT', `${L}/${iconed.json.layout.id}`, { cookie: sam2, body: { icon: 'star' } });
  assert.equal(r.json.layout.icon, 'star');

  // Turning the Calendar off takes the layout away, and the person's choices stay stored for when it is back.
  await expect('Calendar off', 200, 'PATCH', '/api/modules/calendar', { cookie: owner2, body: { enabled: false } });
  assert.deepEqual(await idsOf(pat3), ['workspace'], 'the Calendar layout goes with the Calendar');
  await expect('PATCH Calendar once off', 404, 'PATCH', `${SYS}/calendar`, { cookie: pat3, body: { name: 'x' } });
  await expect('Calendar on again', 200, 'PATCH', '/api/modules/calendar', { cookie: owner2, body: { enabled: true } });
  assert.equal((await call('GET', L, { cookie: pat3 })).json.system[1].name, 'Our plans', 'and comes back as the person left it');
  n += 1;

  // Stacks through the routes (plan-panel-stacking.md, decision 4): a shared layout, a person's own, the space's default
  // layout and a replace all keep a stack; a malformed one is cleaned on the way in.
  const st = (id, extra) => ({ id, mode: 'dock', dockW: 320, ...extra });
  const stackBody = [st('calendar'), st('todo', { stack: 's1', at: 0, h: 0.5 }), st('polls', { stack: 's1', at: 1, h: 0.5 })];
  const stackedShared = (await expect('owner saves a shared layout with a stack', 201, 'POST', `${C}/layouts`, { cookie: owner2, body: { name: 'Stacked', modules: stackBody, shared: true } })).json.layout;
  assert.deepEqual(stackedShared.modules, stackBody, 'the shared layout answers with its stack');
  await expect('the stacked layout is the default', 200, 'PATCH', C, { cookie: owner2, body: { defaultLayout: stackedShared.id } });
  const listed = (await call('GET', `${C}/layouts`, { cookie: pat3 })).json;
  assert.deepEqual(listed.shared.find((l) => l.id === stackedShared.id).modules, stackBody, 'a member reads the stack');
  assert.equal(listed.defaultLayout, stackedShared.id, 'as the default layout');
  assert.deepEqual(listed.firstVisit.layout, stackedShared.id, 'and a first visit opens it');
  const stackedOwn = (await expect('a person saves their own with a stack', 201, 'POST', `${C}/layouts`, { cookie: pat3, body: { name: 'Mine stacked', modules: stackBody } })).json.layout;
  assert.deepEqual(stackedOwn.modules, stackBody, 'their own keeps it');
  assert.deepEqual(readJson(path.join(dataDir, 'layouts.json')).spaces[camp.id].people[patUser.key].find((l) => l.id === stackedOwn.id).modules, stackBody, 'and it is stored');
  const messy = [st('calendar', { stack: 's9', at: 0 }), st('chat', { stack: 'q', at: 0 }), st('todo', { stack: 'q', at: 1 }), st('polls', { stack: 'q', at: 2 })];
  const cleanedPut = (await expect('a replace is cleaned', 200, 'PUT', `${C}/layouts/${stackedOwn.id}`, { cookie: pat3, body: { modules: messy } })).json.layout;
  assert.deepEqual(cleanedPut.modules, [st('calendar'), st('chat'), st('todo', { stack: 'q', at: 0 }), st('polls', { stack: 'q', at: 1 })], 'a lone stack and Chat in a stack are cleaned');
  n += 1;

  // A removed person takes their own layouts; a removed space takes all of its layouts.
  await expect('remove Camp', 200, 'DELETE', C, { cookie: owner2 });
  await expect('remove pat', 200, 'DELETE', `/api/users/${patUser.key}`, { cookie: owner2 });
  assert.ok(!readJson(path.join(dataDir, 'layouts.json')).spaces[S].people[patUser.key], "pat's layouts are gone");
  assert.ok(!readJson(path.join(dataDir, 'layouts.json')).spaces[S].system?.[patUser.key], "and pat's system choices");
  assert.deepEqual(Object.keys(readJson(path.join(dataDir, 'layouts.json')).spaces[S].favorites), [samUser.key], "pat's favorites are gone, sam's stay");
  assert.equal(readJson(path.join(dataDir, 'layouts.json')).spaces[S].shared.length, 10, 'the shared ones stay');
  await expect('remove the space', 200, 'DELETE', `/api/spaces/${S}`, { cookie: owner2 });
  assert.deepEqual(readJson(path.join(dataDir, 'layouts.json')), { spaces: {} }, "the space's layouts are gone");
  await expect('its layouts route', 404, 'GET', L, { cookie: owner2 });
  n += 1;
} finally {
  await stopServer();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(`check-layouts: OK (${n} checks)`);
