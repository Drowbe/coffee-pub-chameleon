#!/usr/bin/env node
/*
 * check-maps-list.mjs -- run the Places module's model (modules/maps/src/maps-list-lib.js) and the SDK's geo helpers on their own.
 * The library is written to be inlined into a module page, so it is loaded here as a function body with the SDK's `geo`
 * and a small in-memory stand-in for the SDK's store.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

// The real SDK, run against a bare window, for its geo helpers.
const sdk = fs.readFileSync(new URL('../public/sdk/host.js', import.meta.url), 'utf8');
const win = { addEventListener() {}, location: { search: '' } };
win.parent = win;
new Function('window', 'document', sdk)(win, { createElement: (tag) => ({ tag }) }); // ready() adds the SDK's shared styles: a <style> stand-in
const geo = win.createHost({ call: async () => ({}), root: { appendChild() {} }, rootElement: {} }).host.util.geo;

// The bundled types library, which the module build inlines ahead of the lib as `LIB_TYPES` (server/module-build.js).
const TYPES_FILE = JSON.parse(fs.readFileSync(new URL('../modules/maps/src/maps-list-lib-types.json', import.meta.url), 'utf8'));
const lib = new Function('geo', 'LIB_TYPES', 'word', `${fs.readFileSync(new URL('../modules/maps/src/maps-list-lib.js', import.meta.url), 'utf8')}\nreturn { cleanPlace, placeValue, placeFromRequest, createPlaces, createBookmarks, movePlace, homeFor, ticksOf, defaultTicks, ticksFromIn, narrows, marksOnly, bookmarkKey, cleanBookmark, cleanForward, markedFor, shownOnce, searchOn, readEntry, PLACE_PREFIX, CATEGORIES, DEFAULT_CATEGORIES, OLD_CATEGORIES, findCategory, TYPES, typeOf, typeFromOsm, STATUSES, TINTS, categoryColor, cssColor, lookOf, typeGroups, iconOptions, findDuplicate, metresBetween };`)(geo, TYPES_FILE, (key) => key); // `word`: the page's, a stand-in

// An in-memory SDK: the store (with versions and 409s), events, ids, pointers and the actions a page provides.
function fakeHost() {
  const data = new Map();
  const handlers = {};
  let n = 0;
  const links = [];
  const host = {
    storage: {
      list: async (prefix) => [...data].filter(([k]) => k.startsWith(prefix)).map(([key, x]) => ({ key, value: x.value, version: x.version })),
      get: async (key) => (data.has(key) ? { key, ...data.get(key) } : null),
      // As the server: a version says which one was read (0: nothing there), and a write over a newer one is a 409.
      set: async (key, value, o) => {
        const cur = data.get(key);
        if (o && o.version !== undefined && (cur ? cur.version : 0) !== o.version) throw Object.assign(new Error('changed'), { status: 409 });
        const version = (cur ? cur.version : 0) + 1;
        data.set(key, { value: JSON.parse(JSON.stringify(value)), version });
        return { version };
      },
      delete: async (key) => { data.delete(key); },
    },
    on: () => () => {},
    util: { id: () => `id${(n += 1)}` },
    objects: { make: (kind, id) => ({ module: 'maps', kind, id, scope: 'space', space: 'r' }), setLinks: async (from, to) => { links.push([from.id, to.length]); } },
    actions: { provide: (h) => Object.assign(handlers, h) },
  };
  return { host, data, handlers, links };
}

let n = 0;
const test = async (name, fn) => { await fn(); n += 1; };

await test('geo: typed coordinates and pasted links', () => {
  assert.equal(geo.coord('38.7', 90), 38.7);
  assert.equal(geo.coord(' -9,13 ', 180), -9.13);
  assert.equal(geo.coord('91', 90), null);
  assert.equal(geo.coord('abc', 90), null);
  const want = { lat: 38.7075, lng: -9.1364 };
  assert.deepEqual(geo.parsePoint('38.7075, -9.1364'), want);
  assert.deepEqual(geo.parsePoint('38.7075 -9.1364'), want);
  assert.deepEqual(geo.parsePoint('geo:38.7075,-9.1364?q=38.7075,-9.1364(Pier)'), want);
  assert.deepEqual(geo.parsePoint('https://maps.example.org/?ll=38.7075,-9.1364&z=12'), want);
  assert.deepEqual(geo.parsePoint('https://maps.example.org/place/x/@38.7075,-9.1364,15z/data'), want);
  assert.deepEqual(geo.parsePoint('https://maps.example.org/?mlat=38.7075&mlon=-9.1364#map=15/38.7/-9.1'), want);
  assert.deepEqual(geo.parsePoint('https://maps.example.org/#map=15/38.7075/-9.1364'), want);
  assert.deepEqual(geo.parsePoint('https://maps.example.org/data=!3d38.7075!4d-9.1364'), want);
  assert.equal(geo.parsePoint('lunch at the pier'), null);
  assert.equal(geo.parsePoint('95, 10'), null);
  assert.equal(geo.parsePoint('12'), null);
  assert.equal(geo.parsePoint(''), null);
  assert.equal(geo.coordsText(38.7075, -9.1364), '38.70750, -9.13640');
});

await test('geo: the link to the person\'s own maps app', () => {
  // A desktop browser has nothing registered for geo: (Windows opens a blank page), so only Android gets one.
  const setAgent = (userAgent) => Object.defineProperty(globalThis, 'navigator', { value: { userAgent }, configurable: true });
  setAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120');
  assert.equal(geo.mapsLink(1.5, 2.5, 'Old (pier)', false), 'https://www.openstreetmap.org/?mlat=1.5&mlon=2.5#map=17/1.5/2.5');
  assert.equal(geo.mapsSearch('Fontane', false), 'https://www.openstreetmap.org/search?query=Fontane');
  setAgent('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile');
  assert.equal(geo.mapsLink(1.5, 2.5, 'Old (pier)', false), 'geo:1.5,2.5?q=1.5,2.5(Old%20%20pier%20)');
  assert.equal(geo.mapsSearch('Fontane', false), 'geo:0,0?q=Fontane');
  assert.equal(geo.mapsSearch('Fontane', true), 'https://maps.apple.com/?q=Fontane');
  assert.match(geo.mapsLink(1.5, 2.5, 'Pier', true), /^https:\/\/maps\.apple\.com\/\?ll=1\.5,2\.5&q=Pier$/);
  assert.equal(geo.oneLine(' a \n\t b ', 10), 'a b');
});

await test('a place needs a name; the point is optional and checked', () => {
  assert.equal(lib.cleanPlace('a', { title: '' }), null);
  assert.equal(lib.cleanPlace('a', null), null);
  const bare = lib.cleanPlace('a', { title: ' Museum ', address: 'Rua 1,\n Lisboa', category: 'No pe!' });
  assert.equal(bare.title, 'Museum');
  assert.equal(bare.address, 'Rua 1, Lisboa');
  assert.equal(bare.category, 'other');
  // An id that is well formed is kept even when no category has it any more (the page shows it under Other); stored places are never rewritten.
  assert.equal(lib.cleanPlace('a', { title: 'x', category: 'inn' }).category, 'inn');
  assert.equal(lib.cleanPlace('a', { title: 'x', category: 5 }).category, 'other');
  assert.deepEqual(lib.CATEGORIES, ['food', 'stay', 'sights', 'nature', 'activities', 'nightlife', 'shopping', 'transport', 'services', 'health', 'other']);
  assert.equal(bare.point, null);
  assert.equal(lib.cleanPlace('a', { title: 'x', point: { lat: 91, lng: 2 } }).point, null);
  assert.equal(lib.cleanPlace('a', { title: 'x', point: { lat: 'no', lng: 2 } }).point, null);
  const p = lib.cleanPlace('a', { title: 'Pier', category: 'eat', point: { lat: 38.7075123456, lng: -9.1364 }, owners: ['u1', 'u1', 5], by: 'u1', ref: { module: 'm', kind: 'k', id: '7', scope: 'space', space: 'r' } });
  assert.deepEqual(p.point, { lat: 38.707512, lng: -9.1364 });
  assert.equal(p.category, 'eat');
  assert.deepEqual(p.owners, ['u1']);
  assert.deepEqual(p.ref, { module: 'm', kind: 'k', id: '7', scope: 'space', space: 'r' });
  assert.equal(lib.cleanPlace('a', { title: 'x', ref: { module: 'm' } }).ref, null);
});

await test('what is stored leaves out the point when there is none (so its summary has no place)', () => {
  const withNone = lib.placeValue(lib.cleanPlace('a', { title: 'x', address: 'y' }));
  assert.ok(!('point' in withNone));
  assert.ok(!('ref' in withNone));
  const withPoint = lib.placeValue(lib.cleanPlace('a', { title: 'x', point: { lat: 1, lng: 2 } }));
  assert.deepEqual(withPoint.point, { lat: 1, lng: 2 });
});

await test('a request to add a place is checked', () => {
  assert.throws(() => lib.placeFromRequest({ title: '  ' }, 'u'), /name/);
  assert.throws(() => lib.placeFromRequest({ title: 'x', lat: 10 }, 'u'), /range/);
  assert.throws(() => lib.placeFromRequest({ title: 'x', lat: 95, lng: 1 }, 'u'), /range/);
  const a = lib.placeFromRequest({ title: 'Cafe', address: 'Rua', category: 'eat' }, 'u1');
  assert.equal(a.point, null);
  assert.equal(a.by, 'u1');
  const b = lib.placeFromRequest({ title: 'Cafe', lat: 38.7, lng: -9.1, notes: 'n', ref: { module: 'm', kind: 'k', id: '1' } }, 'u1');
  assert.deepEqual(b.point, { lat: 38.7, lng: -9.1 });
  assert.equal(b.ref.id, '1');
});

await test('a place is saved and given a position in its store', async () => {
  const { host, data } = fakeHost();
  const places = lib.createPlaces(host);
  await places.load();
  const p = await places.save(lib.placeFromRequest({ title: 'Cafe', address: 'Rua 1' }, 'me'));
  const key = `place:${p.id}`;
  assert.ok(data.has(key));
  assert.ok(!('point' in data.get(key).value));
  assert.equal(data.get(key).value.by, 'me');
  const moved = await places.setPoint(p.id, { lat: 38.7, lng: -9.1 });
  assert.equal(moved.id, p.id);
  assert.deepEqual(data.get(key).value.point, { lat: 38.7, lng: -9.1 });
  await assert.rejects(places.setPoint(p.id, { lat: 200, lng: 0 }), /range/);
  await assert.rejects(places.setPoint('nope', { lat: 1, lng: 1 }), /no such place/);
  assert.equal(places.list().length, 1);
});

await test('editing keeps versions: a stale save is refused, remove forgets the links', async () => {
  const { host, links } = fakeHost();
  const places = lib.createPlaces(host);
  await places.load();
  const p = await places.save({ id: '', title: 'A', category: 'do', address: '', point: null, notes: '', owners: [], by: 'u', ref: { module: 'm', kind: 'k', id: '1' } });
  const v = places.versionOf(p.id);
  await places.save({ ...p, title: 'B' }, v);
  await assert.rejects(places.save({ ...p, title: 'C' }, v), (e) => e.status === 409);
  assert.equal(places.get(p.id).title, 'B');
  assert.ok(links.some(([id, count]) => id === p.id && count === 1));
  await places.remove(p.id);
  assert.equal(places.list().length, 0);
  assert.ok(links.some(([id, count]) => id === p.id && count === 0));
});

await test('what a bar entry means', () => {
  assert.deepEqual(lib.readEntry('38.7075, -9.1364'), { title: '', point: { lat: 38.7075, lng: -9.1364 }, find: false });
  assert.deepEqual(lib.readEntry('Bar do Peixe 38.71, -9.14'), { title: 'Bar do Peixe', point: { lat: 38.71, lng: -9.14 }, find: false });
  assert.deepEqual(lib.readEntry('Pier https://maps.example.org/@38.7,-9.1,15z'), { title: 'Pier', point: { lat: 38.7, lng: -9.1 }, find: false });
  assert.deepEqual(lib.readEntry('colosseo'), { title: 'colosseo', point: null, find: true });
  assert.equal(lib.readEntry('x').find, false);
});

await test('whether a search is set up', () => {
  assert.equal(lib.searchOn({ searchProvider: 'none', search: 'https://x' }), false);
  assert.equal(lib.searchOn({ searchProvider: 'photon' }), true);
  assert.equal(lib.searchOn({ searchProvider: 'custom', search: 'https://s.example/api' }), true);
  assert.equal(lib.searchOn({ searchProvider: 'custom', search: '' }), false);
  assert.equal(lib.searchOn({ searchProvider: 'custom', search: 'javascript:1' }), false);
  assert.equal(lib.searchOn(null), false);
});

await test('one way to add a place in every context: Where, the same finish, the picture map, the refusal', () => {
  const page = fs.readFileSync(new URL('../modules/maps/src/maps-list.js', import.meta.url), 'utf8');
  // Shows in: ticks, not a dropdown; a new place is never put anywhere the ticks did not say.
  assert.match(page, /const canAdd = \(\) => canEveryone\(\) \|\| canHere\(\) \|\| canMine\(\) \|\| \(!inSpace && otherSpaces\(\)\.some\(\(r\) => r\.write === true\)\);/);
  assert.match(page, /const target = targetOf\(ticksNow\(\)\);\n\s+if \(target\.error\) return editorError\(whereLine\(target\)\);/);
  assert.ok(!/w = asPart \? \$\('f-where'\)\.value : view/.test(page), 'a new place never lands in the remembered view unseen');
  assert.ok(!/stores\[view\]\.save/.test(page), 'a found place opens the dialog too');
  assert.match(page, /host\.ui\.toast\(String\(text\)\)/, 'a note is a toast');
  assert.doesNotMatch(page, /\$\('note'\)/, 'nothing is drawn inline as a note');
  assert.match(page, /if \(!entries\(\)\.some\(\(x\) => x\.w === to && x\.p\.id === done\.id\)\) say\(`Saved in \$\{whereName\(to\)\}, which is not shown now\.`\);/, 'said only when the place is not on the list shown');
  assert.match(page, /which is not shown now\./);
  // After saving: selected beside the map; on a canvas or pop-out shown through the show action.
  assert.match(page, /if \(asPart\) selectPlace\(to, done\.id\);\n\s+else if \(showAction && inSpace\) host\.actions\.request\(showAction\.action, \{ ref: placeRef\(to, done\.id\) \}\)/);
  // The picture map hides the maps app, the coordinates and the outside search.
  assert.match(page, /const onPicture = \(\) => Boolean\(host\.environment && host\.environment\.pictureMap\);/);
  assert.match(page, /if \(!onPicture\(\)\) items\.push\(\{ id: 'open-in-maps'/);
  assert.match(page, /if \(p\.point && !onPicture\(\)\) \{/);
  assert.match(page, /hide\(\$\('f-links-out'\), !e\.id \|\| onPicture\(\)\)/);
  assert.match(page, /state\.search = searchOn\(v\) && !onPicture\(\)/);
  // The target beside Position: tucks the editor (state kept), asks a map to pick, and comes back with the spot or none.
  const html = fs.readFileSync(new URL('../modules/maps/src/maps-list.html', import.meta.url), 'utf8');
  assert.match(html, /id="f-pick" hidden aria-label="Pick the position on the map" data-tip="Click the map to set the position"/);
  // Only a map open in this page answers (the host's `open`), asked for this page only (`here`): a map in another tab never takes it.
  assert.match(page, /pickAction = list\.find\(\(a\) => a\.name === 'pickPoint' && a\.open === true\)/);
  assert.match(page, /host\.actions\.request\(pickAction\.action, \{\}, \{ wait: true, here: true \}\)/);
  // No map answered in time: the dialog comes back at once with "no map is open", and the target is hidden until the next open.
  assert.match(page, /if \(out\.status !== 'done'\) \{ pickAction = null; \$\('f-pick'\)\.hidden = true; throw new Error\('no map is open'\); \}/);
  const placesManifest = JSON.parse(fs.readFileSync(new URL('../modules/maps/module.json', import.meta.url), 'utf8'));
  const picked = placesManifest.actions.provides.find((a) => a.name === 'positionPicked');
  assert.ok(picked && picked.input.page === 'string?' && picked.input.pageUntil === 'number?', 'positionPicked takes the host\'s page fields, so only this page\'s Places hears it');
  // The picture map is live: host.on('environment') redraws what depends on it, without a reload.
  assert.match(page, /host\.on\('environment', \(\) => \{ host\.menu\.close\(\); useSettings\(lastSettings\); pictureParts\(\); \}\);/);
  assert.match(page, /function pictureParts\(\) \{[\s\S]*?hide\(\$\('f-links-out'\), !e\.id \|\| onPicture\(\)\);[\s\S]*?\$\('f-point'\)\.placeholder = onPicture\(\) \?/);
  assert.match(page, /const useSettings = \(v\) => \{ lastSettings = v; useSearch\(v\);/, 'the outside search is decided again');
  // The owner's category colours, for the map in this page.
  const colorsAction = placesManifest.actions.provides.find((a) => a.name === 'categoryColors');
  assert.ok(colorsAction && colorsAction.local === true && colorsAction.input.page === 'string?' && colorsAction.input.pageUntil === 'number?', 'categoryColors is a local action for this page');
  assert.match(page, /categoryColors: async \(\) => \{\n\s+await catsRead;[\s\S]*?col\.hex \|\| col\.tint;[\s\S]*?return \{ data: \{ colors \} \};/);
  assert.match(page, /onClose: \(\) => \{ if \(!state\.picking\) state\.editing = null; \}/);
  assert.match(page, /\$\('f-pick'\)\.hidden = !pickAction/);
  assert.match(page, /positionPicked: async \(input\) => \{/);
  assert.match(page, /if \(point\) \{ \$\('f-point'\)\.value = geo\.coordsText\(point\.lat, point\.lng\); readPoint\(\); \}/);
  assert.ok(JSON.parse(fs.readFileSync(new URL('../modules/maps/module.json', import.meta.url), 'utf8')).actions.provides.some((a) => a.name === 'positionPicked' && a.local === true));
  // The category list is the owner's (the `categories` setting): it starts as the eleven of the library, Other can never be removed, and every
  // place of the page goes through catOf, so an id that is off the list shows under Other and is not rewritten.
  const manifest = JSON.parse(fs.readFileSync(new URL('../modules/maps/module.json', import.meta.url), 'utf8'));
  const catDef = manifest.settings.find((d) => d.key === 'categories');
  assert.ok(catDef && catDef.type === 'list' && catDef.scope === 'environment' && catDef.fixed.includes('other'));
  assert.deepEqual(catDef.default, lib.DEFAULT_CATEGORIES, 'the manifest\'s default list and the page\'s are the same eleven rows');
  assert.equal(catDef.default.length, 11);
  assert.ok(!/CAT_ORDER|CAT_LABEL|CAT_ICON/.test(page), 'no hard-coded category lists are left in the page');
  assert.match(page, /const catRow = \(id\) => findCategory\(cats, id\) \|\| findCategory\(cats, 'other'\)/);
  assert.match(page, /catOf\(x\.p\)\.id === c\.id/);
  assert.match(page, /host\.settings\.onChange\(\(v\) => useSettings\(v\)\)/);
  assert.doesNotMatch(html, /<option value="do">/, 'the editor select is filled from the list');
  // The Map reads this sentence to take its add tools away, so it must stay as it is.
  assert.match(page, /const REFUSED = 'you may not add places here';/);
  assert.match(page, /if \(!canAdd\(\)\) throw new Error\(REFUSED\);/);
});

await test('the types library is valid', async () => {
  const sdkIcons = new Set(fs.readdirSync(new URL('../node_modules/@fortawesome/fontawesome-free/svgs/solid/', import.meta.url)).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)));
  const ids = new Set();
  const catIds = new Set(lib.CATEGORIES);
  assert.equal(TYPES_FILE.length, 153);
  assert.ok(TYPES_FILE.length <= 300);
  for (const t of TYPES_FILE) {
    assert.match(t.id, /^[a-z][a-z0-9-]{0,29}$/, `${t.id}: id`);
    assert.ok(!ids.has(t.id), `${t.id}: repeated id`);
    ids.add(t.id);
    assert.ok(typeof t.label === 'string' && t.label.length > 0 && t.label.length <= 30, `${t.id}: label`);
    assert.ok(catIds.has(t.category), `${t.id}: category ${t.category} is not a default category`);
    assert.ok(sdkIcons.has(t.icon), `${t.id}: icon ${t.icon} is not in Font Awesome Free solid`);
    assert.ok(Array.isArray(t.aliases) && t.aliases.length <= 12, `${t.id}: aliases`);
    assert.equal(new Set(t.aliases.map((a) => a.toLowerCase())).size, t.aliases.length, `${t.id}: repeated alias`);
    for (const a of t.aliases) assert.ok(a && a.length <= 30 && a.toLowerCase() !== t.label.toLowerCase(), `${t.id}: alias "${a}"`);
    if (t.osm !== undefined) for (const o of t.osm) assert.match(o, /^[a-z_]+:[a-z_]+$/, `${t.id}: osm`);
  }
  // every category has types, and the categories' own icons exist, with ids that fit the summary (30)
  for (const c of lib.DEFAULT_CATEGORIES) {
    assert.ok(sdkIcons.has(c.icon), `category ${c.id}: icon ${c.icon}`);
    assert.ok(c.id.length <= 30 && c.label.length <= 30);
    assert.ok(TYPES_FILE.some((t) => t.category === c.id), `${c.id} has no type`);
  }
  for (const s of lib.STATUSES) assert.ok(sdkIcons.has(s.icon), `status ${s.id}: icon`);
  assert.ok(sdkIcons.has('tag') && sdkIcons.has('flag') && sdkIcons.has('check'), 'icons the page uses itself');
  // an OpenStreetMap tag names one type at most
  const tags = TYPES_FILE.flatMap((t) => t.osm || []);
  assert.equal(new Set(tags).size, tags.length, 'an osm tag is on two types');
  assert.equal(lib.typeFromOsm('amenity:cafe').id, 'cafe');
  assert.equal(lib.typeFromOsm(['x:y', 'tourism:hotel']).id, 'hotel');
  assert.equal(lib.typeFromOsm('nothing:here'), null);
  // The words Thomas named find what he expects (the picker's own matching, the SDK's kindMatches)
  const kindWords = (str) => String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const finds = (q) => lib.typeGroups(lib.DEFAULT_CATEGORIES).flatMap((g) => g.options).filter((o) => kindWords(q).every((p) => [...kindWords(o.label), ...o.words.flatMap(kindWords)].some((w) => w.startsWith(p)))).map((o) => o.id);
  assert.ok(finds('coffee').includes('cafe'));
  for (const q of ['subway', 'metro', 'underground']) assert.ok(finds(q).includes('subway'), q);
  assert.ok(finds('beach').includes('beach'));
  assert.ok(finds('cafe').includes('cafe'), 'accents are ignored');
});

await test('picker data: one group per category in the list, Other last; types of a removed category go to Other', () => {
  const groups = lib.typeGroups(lib.DEFAULT_CATEGORIES);
  assert.equal(groups.length, 11);
  assert.equal(groups[0].label, 'Food & Drink');
  assert.equal(groups[10].label, 'Personal & Other');
  assert.ok(groups[10].options.some((o) => o.id === 'custom' && o.label === 'Custom Location'), 'the default type, Custom Location, is in Personal & Other');
  assert.ok(groups.every((g) => g.options.every((o) => o.id !== '_none')), 'no "No type" entry');
  assert.equal(groups.reduce((n, g) => n + g.options.length, 0), 153);
  assert.deepEqual(Object.keys(groups[0].options[0]).sort(), ['color', 'icon', 'id', 'label', 'words']);
  assert.equal(groups[0].options[0].color, 'var(--tint-blue)');
  // Shopping off the list and Other first in the owner's order: its types are in Other, which is still drawn last
  const cats = lib.DEFAULT_CATEGORIES.filter((c) => c.id !== 'shopping');
  const without = lib.typeGroups(cats);
  assert.equal(without.length, 10);
  assert.ok(!without.some((g) => g.label === 'Shopping'));
  assert.ok(without[9].options.some((o) => o.id === 'souvenir-shop'), 'Souvenir Shop is under Other');
  assert.equal(without[9].label, 'Personal & Other');
  // icon options carry the words of the types that use them
  const icons = lib.iconOptions(null);
  const umbrella = icons.find((o) => o.id === 'umbrella-beach');
  assert.ok(umbrella && umbrella.words.includes('Beach') && umbrella.words.includes('Resort'));
  assert.equal(new Set(icons.map((o) => o.id)).size, icons.length);
});

await test('old category ids are read as the new ones, and a stored list is kept', () => {
  assert.deepEqual(lib.OLD_CATEGORIES, { eat: 'food', do: 'activities', travel: 'transport' });
  // a request with an old id lands on the new one; stay and other are the same
  assert.equal(lib.placeFromRequest({ title: 'x', category: 'eat' }, 'u').category, 'food');
  assert.equal(lib.placeFromRequest({ title: 'x', category: 'do' }, 'u').category, 'activities');
  assert.equal(lib.placeFromRequest({ title: 'x', category: 'travel' }, 'u').category, 'transport');
  assert.equal(lib.placeFromRequest({ title: 'x', category: 'stay' }, 'u').category, 'stay');
  // a type gives the category when none is asked, and its icon
  const t = lib.placeFromRequest({ title: 'x', type: 'cafe' }, 'u');
  assert.deepEqual([t.type, t.category, t.icon], ['cafe', 'food', 'mug-hot']);
  assert.equal(lib.placeFromRequest({ title: 'x', type: 'nope' }, 'u').type, '');
  // an old stored place is not rewritten, and is found in the new list...
  const old = lib.cleanPlace('a', { title: 'x', category: 'eat' });
  assert.equal(old.category, 'eat');
  assert.equal(lib.findCategory(lib.DEFAULT_CATEGORIES, 'eat').id, 'food');
  assert.equal(lib.findCategory(lib.DEFAULT_CATEGORIES, 'do').id, 'activities');
  assert.equal(lib.findCategory(lib.DEFAULT_CATEGORIES, 'travel').id, 'transport');
  assert.equal(lib.findCategory(lib.DEFAULT_CATEGORIES, 'stay').id, 'stay');
  // ...and a list stored before the library (do, eat, stay, travel, other) keeps working both ways
  const stored = [{ id: 'do', label: 'Things to do', icon: 'ticket', color: '#888888' }, { id: 'eat', label: 'Food', icon: 'utensils', color: '#888888' }, { id: 'other', label: 'Other', icon: 'note-sticky', color: '#888888' }];
  assert.equal(lib.findCategory(stored, 'eat').id, 'eat');
  assert.equal(lib.findCategory(stored, 'food').id, 'eat', 'a new id finds the old row');
  assert.equal(lib.findCategory(stored, 'sights'), null);
  assert.equal(lib.lookOf({ title: 'x', category: 'sights' }, stored).cat.id, 'other', 'a category not on the list shows under Other');
});

await test('what a place is drawn with: place, then type, then category', () => {
  const cats = lib.DEFAULT_CATEGORIES;
  const base = { title: 'x', category: 'food' };
  // no type, no choice: the category's icon and its automatic tint (the first of the eight)
  let look = lib.lookOf(lib.cleanPlace('a', base), cats);
  assert.deepEqual([look.icon, look.color], ['utensils', { tint: 'blue' }]);
  // a type gives its icon; the colour stays the category's
  look = lib.lookOf(lib.cleanPlace('a', { ...base, type: 'cafe' }), cats);
  assert.deepEqual([look.icon, look.color], ['mug-hot', { tint: 'blue' }]);
  // the place's own icon and colour win over both
  look = lib.lookOf(lib.cleanPlace('a', { ...base, type: 'cafe', icon: 'star', iconOwn: true, color: 'red' }), cats);
  assert.deepEqual([look.icon, look.color], ['star', { tint: 'red' }]);
  // a stored icon that was not chosen is only what the summary carries: the type's still wins on the page
  look = lib.lookOf(lib.cleanPlace('a', { ...base, type: 'cafe', icon: 'star' }), cats);
  assert.equal(look.icon, 'mug-hot');
  // a colour the owner chose for the category beats the automatic tint
  const chosen = cats.map((c) => (c.id === 'food' ? { ...c, color: '#336699' } : c));
  assert.deepEqual(lib.lookOf(lib.cleanPlace('a', base), chosen).color, { hex: '#336699' });
  assert.deepEqual(lib.lookOf(lib.cleanPlace('a', { ...base, color: 'gold' }), chosen).color, { tint: 'gold' });
  // the eight tints repeat down the list
  assert.deepEqual(cats.map((c) => lib.categoryColor(cats, c).tint), ['blue', 'green', 'teal', 'purple', 'orange', 'pink', 'gold', 'red', 'blue', 'green', 'teal']);
  assert.equal(lib.cssColor({ tint: 'teal' }), 'var(--tint-teal)');
  assert.equal(lib.cssColor({ hex: '#336699' }), '#336699');
  // the drawn icon is what the page stores, and the summary maps it
  const manifest = JSON.parse(fs.readFileSync(new URL('../modules/maps/module.json', import.meta.url), 'utf8'));
  const summary = manifest.refs.produces.find((r) => r.kind === 'place').summary;
  assert.equal(summary.icon, 'icon');
  assert.equal(summary.visit, 'status');
  assert.equal(summary.color, 'color', 'the summary carries the place\'s own colour (a tint name) for Maps');
  assert.ok(lib.TINTS.includes(lib.cleanPlace('a', { title: 'x', color: 'pink' }).color) && lib.placeValue(lib.cleanPlace('a', { title: 'x', color: 'pink' })).color === 'pink', 'a colour is stored as a tint name');
  const pageSrc = fs.readFileSync(new URL('../modules/maps/src/maps-list.js', import.meta.url), 'utf8');
  assert.match(pageSrc, /colors\[c\.id\] = col\.hex \|\| col\.tint;/, 'categoryColors answers a tint name for the automatic categories');
  assert.equal(summary.category, 'category');
});

await test('type, icon, colour and visit status are stored and read back checked', () => {
  const p = lib.cleanPlace('a', { title: 'x', type: 'cafe', icon: 'star', iconOwn: true, color: 'pink', status: 'booked' });
  assert.deepEqual([p.type, p.icon, p.iconOwn, p.color, p.status], ['cafe', 'star', true, 'pink', 'booked']);
  const v = lib.placeValue(p);
  assert.deepEqual([v.type, v.icon, v.iconOwn, v.color, v.status], ['cafe', 'star', true, 'pink', 'booked']);
  const bad = lib.cleanPlace('a', { title: 'x', type: 'No!', icon: 'Bad Icon', iconOwn: true, color: '#ff0000', status: 'maybe' });
  assert.deepEqual([bad.type, bad.icon, bad.iconOwn, bad.color, bad.status], ['', '', false, '', '']);
  const plain = lib.placeValue(lib.cleanPlace('a', { title: 'x' }));
  for (const k of ['type', 'icon', 'iconOwn', 'color', 'status']) assert.ok(!(k in plain), `${k} is left out when empty`);
  assert.deepEqual(lib.STATUSES.map((s) => [s.id, s.label]), [['want', 'Want to go'], ['booked', 'Booked'], ['visited', 'Visited'], ['favorite', 'Favorite']]);
});

await test('the form: one row of type, icon and colour, the status, and the words', () => {
  const page = fs.readFileSync(new URL('../modules/maps/src/maps-list.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../modules/maps/src/maps-list.html', import.meta.url), 'utf8');
  assert.match(page, /host\.ui\.kindPicker\(\$\('f-type'\)/, 'the type is the SDK kind picker');
  assert.doesNotMatch(page, /kindPicker\(\$\('f-icon'\)/, 'the icon is a button with a flyout, not a second picker');
  for (const id of ['f-look', 'f-type', 'f-icon', 'f-color', 'f-status']) assert.match(html, new RegExp(`id="${id}"`));
  // the row: type, then the icon and colour buttons, in that order, inside one group
  const row = html.slice(html.indexOf('id="f-look"'), html.indexOf('</div>', html.indexOf('id="f-color"')));
  assert.ok(row.indexOf('id="f-type"') < row.indexOf('id="f-icon"') && row.indexOf('id="f-icon"') < row.indexOf('id="f-color"'), 'type, icon, colour');
  assert.match(row, /<button[^>]*id="f-icon"/);
  assert.match(row, /<button[^>]*id="f-color"/);
  // no category field, no "No type", no Look disclosure, no separate old swatches
  assert.doesNotMatch(html, /f-category|<select|<summary>Look|<details class="look"|tpl-swatch/);
  assert.doesNotMatch(page, /f-category|NO_TYPE|No type|Not set/);
  // the order: Name, the row, Shows in, Address, Position, Visit, Notes, Whose
  const at = (k) => html.indexOf(k);
  const order = ['id="f-title"', 'id="f-look"', 'id="f-where"', 'id="f-address"', 'id="f-point"', 'id="f-status"', 'id="f-notes"', 'id="f-owners"'].map(at);
  assert.ok(order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1])), 'the form is in the agreed order');
  // a type is always set; the reset entries and the aria labels
  assert.match(page, /const DEFAULT_TYPE = 'custom'/);
  assert.match(page, /\(id \? '' : DEFAULT_TYPE\)/, 'a new place starts as Custom Location');
  assert.match(page, /'Same as the type'/);
  assert.match(page, /'Same as the category'/);
  assert.match(page, /aria-selected/);
  assert.match(page, /setAttribute\('aria-label', `Icon,/);
  assert.match(page, /setAttribute\('aria-label', `Colour,/);
  assert.match(page, /setAttribute\('role', 'listbox'\)/);
  assert.match(page, /place\.icon = lookOf\(place, cats\)\.icon;/, 'the drawn icon is stored');
  assert.match(page, /typeFromOsm\(h\.osm \|\| h\.category\)/);
  assert.match(page, /id: 'status',\n\s+label: 'Status'/, 'a Status submenu in the place menu');
  const css = fs.readFileSync(new URL('../modules/maps/src/maps-list.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,6}\b(?![^{]*\{)/);
  const mine = css.slice(css.indexOf('/* ---- type, look and visit status ---- */'));
  assert.match(css, /\.look-btn \{[^}]*width: var\(--field-h\)[^}]*height: var\(--field-h\)/, 'the icon and colour buttons are as high as a field (38 px, 44 px on a phone)');
  assert.match(css, /max-width: 640px\) \{[^@]*\.look-type \{ flex-basis: 100%; \}/, 'the phone: type on its own line');
  assert.doesNotMatch(mine, /border-radius:\s*(?!var\(--radius-(min|small|medium|large|round)\))\d/, 'radii from tokens');
  assert.doesNotMatch(mine, /#[0-9a-fA-F]{3,8}\b/, 'theme tokens only');
  assert.doesNotMatch(mine, /border(?!-radius)[^;]*:\s*[^;]*solid/, 'selected states are fills');
  const manifest = JSON.parse(fs.readFileSync(new URL('../modules/maps/module.json', import.meta.url), 'utf8'));
  const help = manifest.settings.find((d) => d.key === 'categories').help;
  assert.match(help, /removes no place and no type/);
});

// --- belonging: one home, marks, Mine (plan-places-library.md, Part A; step 3) ----------------------------------------------
// A stand-in for the server's store rules, shared by several people: the environment's store is read and written by anyone
// signed in (never a guest on a guest link), a space's only by its members (and that space's guest), a person's only by
// that person. Each person gets their own host, as each browser has one.
function fakeServer(members) {
  const files = new Map(); // scope key -> Map(key -> { value, version })
  const file = (k) => { if (!files.has(k)) files.set(k, new Map()); return files.get(k); };
  const refuse = () => Object.assign(new Error('not for you'), { status: 403 });
  let n = 0;
  function hostFor(user, here, guestOf) {
    const scopeKey = (o) => {
      const sc = (o && o.scope) || 'space';
      if (sc === 'person') { if (guestOf) throw refuse(); return `person:${user}`; }
      if (sc === 'environment') { if (guestOf) throw refuse(); return 'environment'; }
      const space = (o && o.space) || here;
      if (guestOf ? guestOf !== space : !(members[space] || []).includes(user)) throw refuse();
      return `space:${space}`;
    };
    const links = [];
    return {
      links,
      storage: {
        list: async (prefix, o) => [...file(scopeKey(o))].filter(([k]) => k.startsWith(prefix)).map(([key, x]) => ({ key, value: x.value, version: x.version })),
        get: async (key, o) => { const f = file(scopeKey(o)); return f.has(key) ? { key, ...f.get(key) } : null; },
        set: async (key, value, o) => {
          const f = file(scopeKey(o));
          const cur = f.get(key);
          if (o && o.version !== undefined && (cur ? cur.version : 0) !== o.version) throw Object.assign(new Error('changed'), { status: 409 });
          const version = (cur ? cur.version : 0) + 1;
          f.set(key, { value: JSON.parse(JSON.stringify(value)), version });
          return { version };
        },
        delete: async (key, o) => { file(scopeKey(o)).delete(key); },
      },
      on: () => () => {},
      util: { id: () => `p${(n += 1)}` },
      objects: {
        make: (kind, id, o) => (o && (o.scope === 'person' || o.scope === 'environment') ? { module: 'maps', kind, id: String(id), scope: o.scope } : { module: 'maps', kind, id: String(id), scope: 'space', space: (o && o.space) || here }),
        setLinks: async (from, to) => { links.push([from, to.length]); },
      },
    };
  }
  return { hostFor, files, file };
}
const place = (title, more) => ({ id: '', title, category: 'food', address: 'Rua 1', point: { lat: 38.7, lng: -9.1 }, notes: 'the code is 1234', owners: [], by: 'u', ref: null, spaces: [], ...more });

await test('the ticks decide the home: Everyone keeps it in the environment, one space in that space, Mine alone private', () => {
  assert.deepEqual(lib.homeFor({ everyone: true, spaces: [], mine: false }), { scope: 'environment', marks: [], mine: false });
  assert.deepEqual(lib.homeFor({ everyone: true, spaces: ['trip1'], mine: false }), { scope: 'environment', marks: ['trip1'], mine: false }, 'Everyone and this trip: the trip is a mark');
  assert.deepEqual(lib.homeFor({ everyone: true, spaces: ['trip1', 'trip2', 'trip1'], mine: true }), { scope: 'environment', marks: ['trip1', 'trip2'], mine: true }, 'Mine beside it is a bookmark');
  assert.deepEqual(lib.homeFor({ everyone: false, spaces: ['trip1'], mine: false }), { scope: 'space', space: 'trip1', marks: [], mine: false });
  assert.deepEqual(lib.homeFor({ everyone: false, spaces: ['trip1'], mine: true }), { scope: 'space', space: 'trip1', marks: [], mine: true });
  assert.deepEqual(lib.homeFor({ everyone: false, spaces: [], mine: true }), { scope: 'person', marks: [], mine: false }, 'only Mine: private');
  // refused for now: two spaces without Everyone, and nothing ticked
  assert.deepEqual(lib.homeFor({ everyone: false, spaces: ['trip1', 'trip2'], mine: true }), { error: 'spaces' });
  assert.deepEqual(lib.homeFor({ everyone: false, spaces: [], mine: false }), { error: 'none' });
  assert.equal(lib.homeFor({ everyone: true, spaces: Array.from({ length: 30 }, (_, i) => `s${i}`) }).marks.length, 20, 'at most 20 marks');
  // and back: a place's ticks from its home
  assert.deepEqual(lib.ticksOf({ scope: 'environment' }, { spaces: ['trip1'] }, true), { everyone: true, spaces: ['trip1'], mine: true });
  assert.deepEqual(lib.ticksOf({ scope: 'space', space: 'trip1' }, { spaces: [] }, false), { everyone: false, spaces: ['trip1'], mine: false });
  assert.deepEqual(lib.ticksOf({ scope: 'person' }, { spaces: [] }, false), { everyone: false, spaces: [], mine: true });
  // narrowing takes it away from people, and is asked first
  assert.equal(lib.narrows({ scope: 'environment' }, { scope: 'space', space: 't' }), 'environment');
  assert.equal(lib.narrows({ scope: 'environment' }, { scope: 'person' }), 'environment');
  assert.equal(lib.narrows({ scope: 'space', space: 't' }, { scope: 'person' }), 'space');
  assert.equal(lib.narrows({ scope: 'person' }, { scope: 'environment' }), '', 'sharing widens');
  assert.equal(lib.narrows({ scope: 'space', space: 't' }, { scope: 'environment' }), '', 'widening');
  assert.equal(lib.narrows({ scope: 'environment' }, { scope: 'environment' }), '');
});

await test('the default ticks: Everyone and this trip on a trip, Mine (with Everyone) in the Mine view, where you are without Everyone', () => {
  const all = { everyone: true, here: true, mine: true };
  assert.deepEqual(lib.defaultTicks('space', 'trip1', all), { everyone: true, spaces: ['trip1'], mine: false });
  assert.deepEqual(lib.defaultTicks('my', 'trip1', all), { everyone: true, spaces: [], mine: true });
  assert.deepEqual(lib.defaultTicks('global', 'trip1', all), { everyone: true, spaces: [], mine: false });
  assert.deepEqual(lib.defaultTicks('', null, all), { everyone: true, spaces: [], mine: false }, 'beside the environment\'s map: Everyone');
  assert.deepEqual(lib.defaultTicks('space', 'trip1', { everyone: false, here: true, mine: true }), { everyone: false, spaces: ['trip1'], mine: false }, 'no Everyone: where you are');
  assert.deepEqual(lib.defaultTicks('global', 'trip1', { everyone: false, here: false, mine: true }), { everyone: false, spaces: [], mine: true });
  assert.deepEqual(lib.defaultTicks('my', null, { everyone: false, here: false, mine: true }), { everyone: false, spaces: [], mine: true });
  // what another module's `in` asks
  assert.equal(lib.ticksFromIn(undefined, 'trip1'), null);
  assert.equal(lib.ticksFromIn('', 'trip1'), null);
  assert.deepEqual(lib.ticksFromIn('environment space', 'trip1'), { everyone: true, spaces: ['trip1'], mine: false });
  assert.deepEqual(lib.ticksFromIn(['person'], 'trip1'), { everyone: false, spaces: [], mine: true });
  assert.deepEqual(lib.ticksFromIn('space,person', 'trip1'), { everyone: false, spaces: ['trip1'], mine: true });
  assert.throws(() => lib.ticksFromIn('nowhere', 'trip1'), /environment, space or person/);
  assert.throws(() => lib.ticksFromIn('space', null), /no space/);
});

await test('an old place shape still reads: no marks means none; a forward is not a place', () => {
  const old = lib.cleanPlace('a', { title: 'Pier', category: 'eat', address: 'x', notes: '', owners: [], by: 'u' });
  assert.deepEqual(old.spaces, []);
  assert.ok(!('spaces' in lib.placeValue(old)), 'no marks are written for a place without them');
  const marked = lib.cleanPlace('a', { title: 'Pier', spaces: ['trip1', 'trip1', 7, 'bad id!', 'trip2'] });
  assert.deepEqual(marked.spaces, ['trip1', 'trip2']);
  assert.equal(lib.cleanPlace('a', { title: 'Pier', movedTo: { scope: 'environment' } }), null);
  assert.deepEqual(lib.cleanForward({ title: 'Pier', movedTo: { scope: 'space', space: 'trip1' }, notes: 'x' }), { title: 'Pier', movedTo: { scope: 'space', space: 'trip1' } });
  assert.equal(lib.cleanForward({ title: 'Pier', movedTo: { scope: 'nowhere' } }), null);
  assert.equal(lib.cleanForward({ title: 'Pier' }), null);
  // a change of marks only, and a change of anything else
  const p = lib.cleanPlace('a', { title: 'Pier', spaces: ['trip1'], by: 'u1' });
  assert.ok(lib.marksOnly({ ...p, spaces: ['trip1', 'trip2'], by: 'u2' }, p));
  assert.ok(!lib.marksOnly({ ...p, spaces: ['trip2'], notes: 'new' }, p));
});

await test('a move: the new home first, then a forward with the title only; links move; a failed second write leaves it readable', async () => {
  const srv = fakeServer({ trip1: ['ana', 'ben'] });
  const ana = srv.hostFor('ana', 'trip1');
  const trip = lib.createPlaces(ana, { scope: 'space', here: 'trip1' });
  const env = lib.createPlaces(ana, { scope: 'environment' });
  await Promise.all([trip.load(), env.load()]);
  const p = await trip.save(place('Blue Door', { ref: { module: 'travel', kind: 'plan', id: 'x1', scope: 'space', space: 'trip1' } }));
  // widen: from the trip to Everyone, still marked into the trip
  const out = await lib.movePlace(trip, env, { ...p, spaces: ['trip1'] }, trip.versionOf(p.id));
  assert.equal(out.forwarded, true);
  assert.equal(out.place.id, p.id, 'the id is kept');
  assert.deepEqual(srv.file('environment').get(`place:${p.id}`).value.spaces, ['trip1']);
  const fwd = srv.file('space:trip1').get(`place:${p.id}`).value;
  assert.deepEqual(fwd, { title: 'Blue Door', movedTo: { scope: 'environment' } }, 'the forward keeps the title only: no address, position or notes');
  assert.equal(trip.list().length, 0, 'the list hides a forward');
  assert.deepEqual(trip.forwardOf(p.id), { title: 'Blue Door', movedTo: { scope: 'environment' } });
  assert.ok(ana.links.some(([from, n]) => from.scope === 'environment' && from.id === p.id && n === 1), 'links set from the new pointer');
  assert.ok(ana.links.some(([from, n]) => from.scope === 'space' && from.id === p.id && n === 0), 'and taken off the old one');
  // and back again: the trip's own forward is replaced, never another place
  const back = await lib.movePlace(env, trip, { ...env.get(p.id), spaces: [] }, env.versionOf(p.id));
  assert.equal(back.forwarded, true);
  assert.equal(trip.get(p.id).title, 'Blue Door');
  assert.deepEqual(srv.file('environment').get(`place:${p.id}`).value.movedTo, { scope: 'space', space: 'trip1' });
  // a place with that id already in the new home: refused, nothing changed
  const other = await env.save({ ...place('Other'), id: 'clash' });
  await trip.save({ ...place('Already here'), id: 'clash' });
  await assert.rejects(trip.adopt({ ...other }), (e) => e.status === 409);
  assert.equal(trip.get('clash').title, 'Already here');
  // the second write fails: the place is in its new home, and the old record is still there to read
  const q = await trip.save(place('Harbour'));
  const failing = { ...trip, forward: async () => { throw new Error('the network went away'); } };
  const half = await lib.movePlace(failing, env, { ...q, spaces: [] }, trip.versionOf(q.id));
  assert.equal(half.forwarded, false);
  assert.match(String(half.error.message), /network/);
  assert.equal(env.get(q.id).title, 'Harbour', 'readable in its new home');
  assert.equal(trip.get(q.id).title, 'Harbour', 'and the old one is not lost');
});

await test('Mine is private: another member cannot read it; shared to the trip it is readable, and only then', async () => {
  const srv = fakeServer({ trip1: ['ana', 'ben'], trip2: ['ben', 'cy'] });
  const ana = srv.hostFor('ana', 'trip1');
  const ben = srv.hostFor('ben', 'trip1');
  const anaMine = lib.createPlaces(ana, { scope: 'person' });
  const anaEnv = lib.createPlaces(ana, { scope: 'environment' });
  const anaTrip = lib.createPlaces(ana, { scope: 'space', here: 'trip1' });
  await Promise.all([anaMine.load(), anaEnv.load(), anaTrip.load()]);
  const secret = await anaMine.save(place('My hideaway'));
  const benMine = lib.createPlaces(ben, { scope: 'person' });
  const benEnv = lib.createPlaces(ben, { scope: 'environment' });
  const benTrip = lib.createPlaces(ben, { scope: 'space', here: 'trip1' });
  await Promise.all([benMine.load(), benEnv.load(), benTrip.load()]);
  assert.equal(benMine.get(secret.id), null, 'Ben\'s own store is his: Ana\'s place is not in it, even by its id');
  assert.equal(benEnv.get(secret.id), null);
  assert.equal(benTrip.get(secret.id), null);
  assert.equal(ana.links.length, 0, 'a private place is never linked');
  // Ana shares it to the trip alone: the trip's store holds it, her own a forward
  const shared = await lib.movePlace(anaMine, anaTrip, { ...secret, spaces: [] }, anaMine.versionOf(secret.id));
  assert.equal(shared.forwarded, true);
  await benTrip.load();
  assert.equal(benTrip.get(secret.id).notes, 'the code is 1234', 'shared, Ben reads it, notes too');
  assert.deepEqual(srv.file('person:ana').get(`place:${secret.id}`).value, { title: 'My hideaway', movedTo: { scope: 'space', space: 'trip1' } });
  // Cy is not in trip1: the trip's store is refused to him, so he never reads it
  const cy = srv.hostFor('cy', 'trip2');
  await assert.rejects(lib.createPlaces(cy, { scope: 'space', space: 'trip1' }).load(), (e) => e.status === 403);
  // a member never gains write access to a space he is not in: Cy cannot write into trip1
  await assert.rejects(lib.createPlaces(cy, { scope: 'space', space: 'trip1' }).save(place('Sneaky')), (e) => e.status === 403);
});

await test('marks: a member in two trips sees a marked place once; an outsider not at all; a guest sees none of the environment\'s', async () => {
  const srv = fakeServer({ trip1: ['ana', 'ben'], trip2: ['ana'] });
  const ana = srv.hostFor('ana', 'trip1');
  const env = lib.createPlaces(ana, { scope: 'environment' });
  await env.load();
  const p = await env.save(place('Viewpoint', { spaces: ['trip1', 'trip2'] }));
  await env.save(place('Unmarked'));
  // Ana is in both trips: the trips' lists and Everyone's list together show it once, keyed by its home
  const envList = env.list();
  const rows = lib.shownOnce([
    [].map((x) => x), // trip1's own store: empty
    lib.markedFor(envList, 'trip1').map((x) => ({ p: x, w: 'global' })),
    lib.markedFor(envList, 'trip2').map((x) => ({ p: x, w: 'global' })),
    envList.map((x) => ({ p: x, w: 'global' })),
  ]);
  assert.deepEqual(rows.map((r) => r.p.title), ['Unmarked', 'Viewpoint'], 'each place once');
  assert.deepEqual(lib.markedFor(envList, 'trip1').map((x) => x.id), [p.id]);
  assert.deepEqual(lib.markedFor(envList, 'trip3').map((x) => x.id), [], 'nothing marked for another trip');
  // a guest on trip1's guest link: the trip's store yes, the environment's never (so no marked place either)
  const guest = srv.hostFor('guest', 'trip1', 'trip1');
  await assert.rejects(lib.createPlaces(guest, { scope: 'environment' }).load(), (e) => e.status === 403);
  await lib.createPlaces(guest, { scope: 'space' }).load();
  await assert.rejects(lib.createPlaces(guest, { scope: 'person' }).load(), (e) => e.status === 403);
  await assert.rejects(lib.createBookmarks(guest).load(), (e) => e.status === 403, 'and no list of their own');
});

await test('marks only: two people ticking two trips at once both win (one retry on a conflict)', async () => {
  const srv = fakeServer({ trip1: ['ana', 'ben'], trip2: ['ben'] });
  const anaEnv = lib.createPlaces(srv.hostFor('ana', 'trip1'), { scope: 'environment' });
  const benEnv = lib.createPlaces(srv.hostFor('ben', 'trip1'), { scope: 'environment' });
  await anaEnv.load();
  const p = await anaEnv.save(place('Market'));
  await benEnv.load();
  await benEnv.mark(p.id, ['trip2'], [], 'ben');
  // Ana's copy is stale; her tick for trip1 conflicts, is read again, and applied to what is there now
  await anaEnv.mark(p.id, ['trip1'], [], 'ana');
  assert.deepEqual(srv.file('environment').get(`place:${p.id}`).value.spaces.sort(), ['trip1', 'trip2']);
  await anaEnv.mark(p.id, [], ['trip2'], 'ana');
  assert.deepEqual(srv.file('environment').get(`place:${p.id}`).value.spaces, ['trip1'], 'taking one off');
  // a space's or a person's place carries no marks
  const trip = lib.createPlaces(srv.hostFor('ana', 'trip1'), { scope: 'space', here: 'trip1' });
  const q = await trip.save(place('Inn', { spaces: ['trip2'] }));
  assert.ok(!('spaces' in srv.file('space:trip1').get(`place:${q.id}`).value));
});

await test('the list of Mine: a bookmark in the person\'s own store, the home\'s pointer; a bookmark to a deleted place is found gone', async () => {
  const srv = fakeServer({ trip1: ['ana', 'ben'] });
  const ana = srv.hostFor('ana', 'trip1');
  const ben = srv.hostFor('ben', 'trip1');
  const env = lib.createPlaces(ana, { scope: 'environment' });
  await env.load();
  const p = await env.save(place('Gelato'));
  const marks = lib.createBookmarks(ana);
  await marks.load();
  const ref = ana.objects.make('place', p.id, { scope: 'environment' });
  await marks.add(ref, p.title);
  assert.ok(marks.has(ref));
  assert.deepEqual(srv.file('person:ana').get(lib.bookmarkKey(ref)).value, { ref: { module: 'maps', kind: 'place', id: p.id, scope: 'environment' }, title: 'Gelato' });
  assert.ok(!('saved' in srv.file('environment').get(`place:${p.id}`).value) && !JSON.stringify(srv.file('environment').get(`place:${p.id}`).value).includes('ana'), 'never written on the shared record');
  const benMarks = lib.createBookmarks(ben);
  await benMarks.load();
  assert.equal(benMarks.list().length, 0, 'nobody else sees who saved it');
  // Ben deletes it for everyone: Ana's bookmark stays, and the place is gone from its home (the page shows "No longer shared with you")
  const benEnv = lib.createPlaces(ben, { scope: 'environment' });
  await benEnv.load();
  await benEnv.remove(p.id);
  await env.load();
  await marks.load();
  assert.equal(marks.list().length, 1);
  assert.equal(env.get(p.id), null);
  assert.equal(env.forwardOf(p.id), null, 'not moved: gone');
  await marks.remove(ref);
  assert.equal(marks.list().length, 0, 'Take off my list');
  // keys: one per home, and only a shared home can be saved
  assert.equal(lib.bookmarkKey({ scope: 'space', space: 'trip1', id: 'a1' }), 'saved:s:trip1:a1');
  assert.equal(lib.bookmarkKey({ scope: 'environment', id: 'a1' }), 'saved:e:a1');
  assert.equal(lib.cleanBookmark('saved:e:a1', { ref: { scope: 'person', id: 'a1' } }), null);
  // A bookmark whose pointer names another module (one saved before Places folded into Maps) is not read: no reader for the old id.
  assert.equal(lib.cleanBookmark('saved:e:a1', { ref: { module: 'places', kind: 'place', scope: 'environment', id: 'a1' }, title: 'x' }), null, 'an old places pointer is dropped');
  assert.equal(lib.cleanBookmark('saved:e:a1', { ref: { scope: 'environment', id: 'a1' }, title: 'x' }), null, 'a pointer with no module is dropped');
  assert.deepEqual(lib.cleanBookmark('saved:e:a1', { ref: { module: 'maps', kind: 'place', scope: 'environment', id: 'a1' }, title: 'x' }), { key: 'saved:e:a1', ref: { module: 'maps', kind: 'place', id: 'a1', scope: 'environment' }, title: 'x' });
  assert.equal(lib.cleanBookmark('saved:e:zz', { ref: { scope: 'environment', id: 'a1' } }), null, 'the key must match its pointer');
});

await test('the page: Shows in, its line, the narrowing question, the menu, sharePlace and the guest', () => {
  const page = fs.readFileSync(new URL('../modules/maps/src/maps-list.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../modules/maps/src/maps-list.html', import.meta.url), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(new URL('../modules/maps/module.json', import.meta.url), 'utf8'));
  assert.match(html, /<fieldset id="f-where" class="sdk-section where" aria-describedby="f-where-line" hidden>\s*<legend class="sdk-section-title">Shows in<\/legend>/);
  assert.match(html, /<template id="tpl-tick"><label class="sdk-choice-row"><input type="checkbox">/, 'native checkboxes, the label the whole row');
  assert.doesNotMatch(html, /<select id="f-where"/, 'no dropdown');
  assert.match(page, /if \(target\.scope === 'environment'\) return `\$\{everyoneIn\(\)\} sees it\.`;/);
  assert.match(page, /return `Only people in \$\{spaceName\(target\.space\)\} see it\.`;/);
  assert.match(page, /return 'Only you see it\.';/);
  assert.match(page, /if \(target\.error === 'spaces'\) return `To show it in more than one \$\{word\('space'\)\}, it must be in \$\{everyoneName\(\)\} too\.`;/);
  assert.match(page, /'On your own list\. Only you see that you saved it\.'/);
  assert.match(page, /`Its notes will be seen by \$\{who\}\.`/);
  assert.match(html, /data-action="keep-shared">Keep it shared<\/button><button class="btn btn-small btn-danger sdk-banner-action" type="button" data-action="take-away">Take it away<\/button>/);
  assert.match(page, /will no longer see it\./);
  assert.match(page, /ticks = \(seed && seed\.ticks\) \|\| defaultTicks\(at, here, \{ everyone: canEveryone\(\), here: canHere\(\), mine: canMine\(\) \}\);/);
  // the copies are gone; the menu has the marks and the list
  assert.doesNotMatch(page, /copyTo|'Save to mine'|Share to this/);
  assert.match(page, /label: `Take off \$\{spaceName\(here\)\}`/);
  assert.match(page, /label: on \? 'Take off my list' : 'Add to my list'/);
  assert.match(page, /`Delete it for everyone\? It is in \$\{andList\(where\)\}\.`/);
  assert.match(page, /'No longer shared with you'/);
  // a guest on a guest link reads only the space: never the environment's store or a list
  assert.match(page, /personal \? ensureLoaded\('global'\)\.catch\(\(\) => \{\}\) : null,/);
  assert.match(page, /const saved = personal \? createBookmarks\(host\) : null;/);
  assert.match(page, /if \(w === 'my' \|\| w === 'global'\) return personal && canEdit;/);
  // another space's store is never written from a space's canvas
  assert.match(page, /if \(w\.startsWith\('in:'\)\) \{ if \(inSpace\) return false;/);
  // other modules: addPlace takes `in`, sharePlace is local (only the person's own page reads their private place)
  const add = manifest.actions.provides.find((a) => a.name === 'addPlace');
  const share = manifest.actions.provides.find((a) => a.name === 'sharePlace');
  assert.equal(add.input.in, 'string?');
  assert.ok(share && share.local === true && share.input.place === 'ref:maps:place' && share.input.in === 'string?');
  assert.match(page, /if \(!ownRequest\(ctx\) \|\| !personal\) throw new Error\('only that person can share it'\);/);
  assert.match(page, /if \(asked && asked\.mine && !own\) throw new Error\('only that person can add to their own list'\);/);
  assert.equal(manifest.refs.produces[0].summary.spaces, 'spaces', 'the summary carries the marks');
  assert.match(manifest.version, /^0\.\d+\.\d+$/, 'Maps has a version');
});

test('a new place that repeats one is found: the same search result, or the same name within about 30 m', () => {
  const at = (id, title, lat, lng, extra) => ({ w: 'global', p: { id, title, point: lat === null ? null : { lat, lng }, ...extra } });
  const list = [at('a', 'Torre de Belém', 38.69159, -9.21593, { origin: 'osm:123' }), at('b', 'Taberna da Rua', 38.7, -9.1), at('c', 'No position', null, null)];
  assert.equal(lib.findDuplicate(list, { origin: 'osm:123', title: 'Anything', point: { lat: 10, lng: 10 } }).p.id, 'a', 'the same search key, wherever it is');
  assert.equal(lib.findDuplicate(list, { title: 'torre de belem', point: { lat: 38.69161, lng: -9.21595 } }).p.id, 'a', 'the same name (case and accents aside) within 30 m');
  assert.equal(lib.findDuplicate(list, { title: 'Torre de Belém', point: { lat: 38.6925, lng: -9.21593 } }), null, 'the same name 100 m away is another place');
  assert.equal(lib.findDuplicate(list, { title: 'Another name', point: { lat: 38.69159, lng: -9.21593 } }), null, 'another name in the same spot is another place');
  assert.equal(lib.findDuplicate(list, { title: 'Torre de Belém', point: null }), null, 'no position and no key: nothing to compare');
  assert.ok(lib.metresBetween({ lat: 38.69159, lng: -9.21593 }, { lat: 38.69168, lng: -9.21593 }) < 12);
  // The search key is kept on the place, and only when there is one.
  assert.equal(lib.cleanPlace('x', { title: 'T', origin: 'osm:1' }).origin, 'osm:1');
  assert.ok(!('origin' in lib.cleanPlace('x', { title: 'T' })), 'no key, no field');
  assert.equal(lib.placeValue(lib.cleanPlace('x', { title: 'T', origin: 'osm:1' })).origin, 'osm:1');
  const page = fs.readFileSync(new URL('../modules/maps/src/maps-list.js', import.meta.url), 'utf8');
  assert.match(page, /if \(!e\.id && !e\.dupOk\) \{\s*const dup = findDuplicate\(entries\(\), \{ origin: e\.origin, title, point: e\.point \}\);\s*if \(dup\) return askDuplicate\(dup\);/, 'saving a new place asks first');
  const html = fs.readFileSync(new URL('../modules/maps/src/maps-list.html', import.meta.url), 'utf8');
  assert.ok(html.includes('data-action="open-duplicate">Open it</button>') && html.includes('data-action="save-anyway">Save anyway</button>'), 'Open it and Save anyway');
  assert.match(page, /`Already in \$\{whereName\(dup\.w\)\}`/, 'a result already in a list says where');
  assert.ok(page.includes("h.source === 'server' ? 'From earlier searches'") && !page.includes('Saved on this server'), 'the saved search results are "From earlier searches"');
  assert.match(page, /if \(i > 0 \|\| dup\) b\.classList\.remove\('btn-primary'\)/, 'one main Save in a list of results');
  assert.match(page, /function uniqueResults\(list\)/, 'the same result once');
});

test('the list sorts by number, not as text', () => {
  const rows = ['QA place 10', 'QA place 2', 'QA place 1', 'QA place 11'].map((title, i) => ({ w: 'global', p: { id: String(i), title } }));
  assert.deepEqual(lib.shownOnce([rows]).map((x) => x.p.title), ['QA place 1', 'QA place 2', 'QA place 10', 'QA place 11']);
});

test('the dialog opens where it is seen, the "+" is the viewer\'s, backlinks come in one request, and delete says who uses the place', () => {
  const page = fs.readFileSync(new URL('../modules/maps/src/maps-list.js', import.meta.url), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(new URL('../modules/maps/module.json', import.meta.url), 'utf8'));
  // A phone shows one part at a time: the dialog is Places' own, so Places shows its part first (the "+" and a new place asked for).
  assert.match(page, /const revealPart = \(\) => \{ if \(asPart && host\.destination\) host\.destination\.set\(\{ reveal: 'panel' \}\)/);
  assert.match(page, /host\.on\('add', \(e\) => \{ if \(e\.id === 'place' && canAdd\(\)\) \{ closeFound\(\); revealPart\(\); openEditor\(null, null\); \} \}\);/);
  assert.match(page, /closeFound\(\);\s*revealPart\(\);\s*openEditor\(null, null, \{ title:/, 'newPlace (the map\'s ask) shows the part too');
  // The map hides its "+" when this says no.
  const may = manifest.actions.provides.find((a) => a.name === 'mayAdd');
  assert.ok(may && may.local === true, 'mayAdd is a local action');
  assert.match(page, /mayAdd: async \(\) => \{[\s\S]*?return \{ data: \{ may: state\.loaded \? canAdd\(\) : true \} \};/);
  // One request for all the places, never one each.
  assert.match(page, /host\.objects\.linksToAll\(todo\.map\(\(x\) => x\.ref\)\)/);
  assert.ok(!/host\.objects\.linksTo\(/.test(page), 'no request per place');
  // The delete question names the modules that point at the place.
  assert.match(page, /usedByWords\(w, id\)/);
  assert.match(page, /\$\{andList\(names\)\} \$\{names\.length > 1 \? 'use' : 'uses'\} it\./);
  // "On the map" only while the map says it is drawn; a position alone is "Has a position"; no "?" owner mark.
  assert.match(page, /asPart && state\.mapOn \? 'On the map' : 'Has a position'/);
  assert.match(page, /p\.owners\.filter\(\(k\) => nameOf\(k\)\)/);
  // A place with no type shows its category, not "Custom Location".
  assert.match(page, /value: typeOf\(e\.type\) \? e\.type : e\.id \? '' : DEFAULT_TYPE/);
  // Beside the map a change is told to the map through the page.
  assert.match(page, /host\.destination\.set\(\{ changed: tellCount \}\)/);
  const css = fs.readFileSync(new URL('../modules/maps/src/maps-list.css', import.meta.url), 'utf8');
  assert.match(css, /\.place-row\.on :is\(\.sub, \.pinned, \.nopos, \.scope-mark, \.saved-state\) \{ color: var\(--text-primary\); \}/, 'the selected row\'s words read in dark');
  assert.ok(!/\.found-row \.source \{[^}]*opacity/.test(css), 'a result\'s source line is not dimmed');
});

console.log(`check-maps-list: OK (${n} checks)`);
