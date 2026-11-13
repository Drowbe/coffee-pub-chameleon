#!/usr/bin/env node
/*
 * check-research.mjs -- run the Research module's model (modules/research/src/research-lib.js) on its own, with the SDK's geo helpers
 * and a small in-memory stand-in for the SDK's store: items and their checking, tags, what quick add makes of what was typed,
 * filtering, the answer pieces of an AI reply, and saving, removing and the actions other modules ask, with an object handed
 * in (plan-object-handoff.md, step 6: saveNote, saveLink and savePhoto).
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const sdk = fs.readFileSync(new URL('../public/sdk/host.js', import.meta.url), 'utf8');
const win = { addEventListener() {}, location: { search: '' } };
win.parent = win;
new Function('window', 'document', sdk)(win, { createElement: (tag) => ({ tag }) }); // ready() adds the SDK's shared styles: a <style> stand-in
const geo = win.createHost({ call: async () => ({}), root: { appendChild() {} }, rootElement: {} }).host.util.geo;

const names = ['KINDS', 'cleanItem', 'itemValue', 'textOf', 'parseTags', 'cleanTags', 'cleanUrl', 'readEntry', 'filterItems', 'tagCounts', 'fitSize', 'captionOf', 'noteIcon', 'createResearch', 'objectNote', 'objectLink', 'objectDay'];
// The SDK's own text helpers (host.util.plain, localWhen and detailLines), which an object handed in is mapped with.
const { plain, localWhen, detailLines } = win.hostText;
const util = { plain, localWhen, detailLines };
const lib = new Function('geo', `${fs.readFileSync(new URL('../modules/research/src/research-lib.js', import.meta.url), 'utf8')}\nreturn { ${names.join(', ')} };`)(geo);

function fakeHost() {
  const data = new Map();
  const handlers = {};
  const removedFiles = [];
  const files = []; // this place's uploads: { id, hasThumb }
  const links = [];
  let n = 0;
  const host = {
    storage: {
      list: async (prefix) => [...data].filter(([k]) => k.startsWith(prefix)).map(([key, x]) => ({ key, value: x.value, version: x.version })),
      set: async (key, value, o) => {
        const cur = data.get(key);
        if (o && o.version !== undefined && (!cur || cur.version !== o.version)) throw Object.assign(new Error('changed'), { status: 409 });
        const version = (cur ? cur.version : 0) + 1;
        data.set(key, { value: JSON.parse(JSON.stringify(value)), version });
        return { version };
      },
      delete: async (key) => { data.delete(key); },
    },
    on: () => () => {},
    util: { id: () => `id${(n += 1)}`, ...util },
    objects: { make: (kind, id) => ({ module: 'research', kind, id, scope: 'space', space: 'r' }), setLinks: async (from, to) => { links.push([from.id, to.length]); } },
    uploads: {
      remove: async (id) => { removedFiles.push(id); },
      list: async () => files.map((f) => ({ ...f })),
    },
    actions: { provide: (h) => Object.assign(handlers, h) },
  };
  return { host, data, handlers, removedFiles, links, files };
}
let n = 0;
const test = async (name, fn) => { await fn(); n += 1; };
const FILE = 'a'.repeat(24);

await test('items are checked: what a kind needs, and nothing else', () => {
  assert.equal(lib.cleanItem('note', 'a', null), null);
  assert.equal(lib.cleanItem('thing', 'a', { title: 'x' }), null);
  assert.equal(lib.cleanItem('link', 'a', { title: 'x', url: 'javascript:alert(1)' }), null);
  assert.equal(lib.cleanItem('link', 'a', { url: 'https://u:p@x.example' }), null);
  assert.equal(lib.cleanItem('photo', 'a', { title: 'x' }), null); // a photo needs its file
  const link = lib.cleanItem('link', 'a', { url: 'https://www.example.org/page', excerpt: 'the part that mattered', image: 'https://cdn.example.org/hero.jpg', tags: ['Hotel', 'hotel', 'Two Words'] });
  assert.equal(link.title, 'example.org');
  assert.equal(link.site, 'example.org');
  assert.equal(link.image, 'https://cdn.example.org/hero.jpg');
  assert.equal(lib.itemValue(link).image, 'https://cdn.example.org/hero.jpg');
  assert.equal(lib.cleanItem('link', 'a', { url: 'https://example.org/a', image: 'javascript:alert(1)' }).image, '');
  assert.deepEqual(link.tags, ['hotel', 'twowords']);
  const note = lib.cleanItem('note', 'b', { body: 'First line\nsecond', date: '2026-02-30', point: { lat: 95, lng: 0 } });
  assert.equal(note.title, 'First line');
  assert.equal(note.date, '');
  assert.equal(note.point, null);
  assert.equal(note.icon, 'note-sticky');
  assert.equal(lib.cleanItem('note', 'b', { title: 'x', icon: 'plane' }).icon, 'plane');
  assert.equal(lib.cleanItem('note', 'b', { title: 'x', icon: 'note' }).icon, 'note-sticky');
  assert.equal(lib.cleanItem('note', 'b', { title: 'x', icon: 'nope' }).icon, 'note-sticky');
  assert.equal(lib.noteIcon('bed'), 'hotel');
  assert.equal(lib.noteIcon('note', 'flight'), 'plane');
  assert.equal(lib.noteIcon('plane', 'hotel'), 'plane');
  assert.equal(lib.noteIcon('', 'restaurant'), 'utensils');
  assert.equal(lib.noteIcon('coins'), 'wallet');
  assert.equal(lib.itemValue(lib.cleanItem('note', 'b', { title: 'x', icon: 'map' })).icon, 'map');
  assert.equal(lib.itemValue(link).icon, undefined);
  assert.equal(lib.cleanItem('note', 'b', { title: 'x', date: '2026-02-28', point: { lat: 1, lng: 2, name: 'Pier' } }).point.name, 'Pier');
  const photo = lib.cleanItem('photo', 'c', { title: 'Harbour', file: { id: FILE, hasThumb: true } });
  assert.deepEqual(photo.file, { id: FILE, hasThumb: true });
  assert.equal(lib.cleanItem('photo', 'c', { title: 'x', file: { id: '../../etc' } }), null);
  const answer = lib.cleanItem('answer', 'd', { title: 'Hotels', content: 'Near the station.', ai: { question: 'where?', sources: [{ module: 'maps', kind: 'place', id: 'p1' }, { bad: 1 }] } });
  assert.equal(answer.ai.sources.length, 1);
  // What is stored: only what the kind uses, plus the words its summary carries.
  const v = lib.itemValue(link);
  assert.equal(v.text, 'the part that mattered');
  assert.equal(v.sub, 'example.org');
  assert.ok(!('body' in v) && !('content' in v));
  assert.equal(lib.itemValue(note).text, 'First line\nsecond');
  assert.equal(lib.itemValue(photo).text, 'Harbour');
});

await test('tags and quick add', () => {
  assert.deepEqual(lib.parseTags('#Hotel, lisbon  food;food'), ['hotel', 'lisbon', 'food']);
  assert.equal(lib.parseTags(Array(20).fill('a').map((x, i) => x + i).join(' ')).length, 8);
  assert.deepEqual(lib.readEntry('https://example.org/x'), { kind: 'link', url: 'https://example.org/x', title: '', excerpt: '' });
  assert.equal(lib.readEntry('see https://example.org/x for more').kind, 'note');
  assert.deepEqual({ ...lib.readEntry('Hotel ideas\nnear the station\nquiet') }, { kind: 'note', title: 'Hotel ideas', body: 'near the station\nquiet', point: null });
  assert.equal(lib.readEntry('   '), null);
  assert.equal(lib.readEntry('javascript:alert(1)').kind, 'note');
  assert.equal(lib.captionOf('IMG_2041-b.jpeg'), 'IMG 2041 b');
  assert.deepEqual(lib.fitSize(4000, 3000, 2000), { width: 2000, height: 1500 });
  assert.deepEqual(lib.fitSize(300, 200, 2000), { width: 300, height: 200 });
});

await test('filtering: words, a kind, and all the chosen tags', () => {
  const items = [
    lib.cleanItem('note', '1', { title: 'Hotels near the station', body: 'quiet street', tags: ['hotel', 'lisbon'], at: '2026-09-01T00:00:00Z' }),
    lib.cleanItem('link', '2', { url: 'https://hotels.example.org', title: 'Hotel list', tags: ['hotel'], at: '2026-09-03T00:00:00Z' }),
    lib.cleanItem('photo', '3', { title: 'Harbour', file: { id: FILE }, tags: ['lisbon'], at: '2026-09-02T00:00:00Z' }),
  ];
  assert.deepEqual(lib.filterItems(items, {}).map((i) => i.id), ['2', '3', '1']); // newest first
  assert.deepEqual(lib.filterItems(items, { q: 'hotel' }).map((i) => i.id), ['2', '1']);
  assert.deepEqual(lib.filterItems(items, { q: 'quiet station' }).map((i) => i.id), ['1']);
  assert.deepEqual(lib.filterItems(items, { kind: 'photo' }).map((i) => i.id), ['3']);
  assert.deepEqual(lib.filterItems(items, { tags: ['hotel', 'lisbon'] }).map((i) => i.id), ['1']);
  assert.deepEqual(lib.tagCounts(items), [{ tag: 'hotel', count: 2 }, { tag: 'lisbon', count: 2 }]);
});

await test('the store: save, edit with versions, remove (and the picture), and what others ask', async () => {
  const f = fakeHost();
  const r = lib.createResearch(f.host, { scope: 'space' });
  f.host.on = (ev, fn) => fn; // events are not needed here
  const note = await r.save({ kind: 'note', title: 'Ideas', body: 'first', tags: ['a'], by: 'u1' });
  assert.ok(f.data.has(`note:${note.id}`));
  assert.equal(r.list().length, 1);
  await assert.rejects(r.save({ ...note, title: 'Stale' }, 99), (e) => e.status === 409);
  await r.save({ ...note, title: 'Ideas 2' }, r.versionOf(note.id));
  assert.equal(r.get(note.id).title, 'Ideas 2');
  await assert.rejects(r.save({ kind: 'link', url: 'nope', by: 'u1' }), /not complete, or not valid/);
  const photo = await r.save({ kind: 'photo', title: 'Harbour', file: { id: FILE, hasThumb: true }, by: 'u1' });
  await r.remove(photo.id);
  assert.deepEqual(f.removedFiles, [FILE]);
  assert.equal(r.list().length, 1);
  const again = lib.createResearch(f.host, { scope: 'space' });
  await again.load();
  assert.equal(again.list().length, 1);
  r.provide('u1');
  const out = await f.handlers.saveNote({ title: 'From elsewhere', body: 'text', tags: '#Hotel, Lisbon', ref: { module: 'maps', kind: 'place', id: 'p' } }, { by: 'u2' });
  assert.equal(out.ref.kind, 'note');
  assert.equal(r.get(out.ref.id).by, 'u2', 'a note asked for by someone else is theirs, not the open page\'s');
  assert.deepEqual(r.get(out.ref.id).tags, ['hotel', 'lisbon']);
  const flight = await f.handlers.saveNote({ title: 'SJC to SNA', body: 'Morning', icon: 'note', kind: 'flight' });
  assert.equal(r.get(flight.ref.id).icon, 'plane');
  const stay = await f.handlers.saveNote({ title: 'The inn', body: 'Two nights', icon: 'bed' });
  assert.equal(r.get(stay.ref.id).icon, 'hotel');
  assert.equal(f.links.at(-1)[1], 1);
  await assert.rejects(f.handlers.saveNote({ title: '' }), /title/);
  const link = await f.handlers.saveLink({ url: 'https://example.org/a', excerpt: 'because' });
  assert.equal(r.get(link.ref.id).excerpt, 'because');
  assert.equal(r.get(link.ref.id).by, 'u1', 'the page\'s own request is its own person\'s');
  const kept = await f.handlers.saveLink({ url: 'https://example.org/kept' }, { by: 'u2' });
  assert.equal(r.get(kept.ref.id).by, 'u2', 'a link kept from Chat is the keeper\'s');
  const long = `https://example.org/${'l'.repeat(280)}`;
  assert.equal(long.length, 300);
  const whole = await f.handlers.saveLink({ url: long }, { by: 'u2' });
  assert.equal(r.get(whole.ref.id).url, long, 'a 300-character address is saved whole');
  await assert.rejects(f.handlers.saveLink({ url: `https://example.org/${'l'.repeat(481)}` }), /web address/, 'over 500 is refused');
  await assert.rejects(f.handlers.saveLink({ url: 'ftp://x' }), /web address/);
  // A person's own items are private: nothing is linked.
  const mine = lib.createResearch(f.host, { scope: 'person' });
  mine.provide('u1');
  const before = f.links.length;
  await f.handlers.saveNote({ title: 'Private', ref: { module: 'maps', kind: 'place', id: 'p' } });
  assert.equal(f.links.length, before);
});

// --- objects handed in (plan-object-handoff.md, step 6) ----------------------------------------------------------------

// Thomas's Southwest flight (#182) as the bus hands it over (server/object-format.js's cleanHandoff).
const SOUTHWEST = { kind: 'flight', icon: 'plane', title: 'Southwest **2483**', content: 'Booked with **points**.', date: '2026-11-13', basis: 'imported', tags: ['Trip', 'trip', 'two words'], details: { airline: 'Southwest', number: '2483', from: { code: 'MDW', name: 'Chicago Midway' }, to: { code: 'SJC' }, departs: '2026-11-14T12:50', minutes: 275, reference: 'ABC123' }, links: [{ title: 'Booking', url: 'https://southwest.com/b' }] };

await test('objectNote: a note of any object, its details as lines, Markdown kept in the body, the title plain', () => {
  const note = lib.objectNote(SOUTHWEST, util);
  assert.equal(note.kind, 'note');
  assert.equal(note.title, 'Southwest 2483', 'the title is plain text');
  assert.equal(note.body, 'Booked with **points**.\n\nAirline: Southwest\nNumber: 2483\nFrom: Chicago Midway (MDW)\nTo: SJC\nDeparts: 2026-11-14 12:50\nLength: 4 h 35 min\nReference: ABC123\n\nLinks:\n- Booking: https://southwest.com/b\nExternal source', 'nothing is lost; the body keeps its Markdown');
  assert.equal(note.icon, 'plane', 'the kind\'s icon kept');
  assert.equal(note.date, '2026-11-14', 'the details\' day wins over the object\'s own');
  assert.deepEqual(note.tags, ['trip', 'twowords']);
  assert.equal(note.point, null);
  // A message's words: the first line is the title, so the body is the rest; one line has no body.
  assert.deepEqual(lib.objectNote({ title: 'Dinner Friday', content: 'Dinner Friday\nat **the** pier' }, util).body, 'at **the** pier');
  assert.equal(lib.objectNote({ title: 'Dinner Friday at 7', content: 'Dinner Friday at 7' }, util).body, '');
  assert.equal(lib.objectNote({ title: 'Dinner', content: 'Dinner', date: '2026-02-30' }, util).date, '', 'no real day: none');
  // A place: with a position, the note's; a name alone, a line.
  const placed = lib.objectNote({ kind: 'sight', title: 'Belem', content: 'Tower', place: { name: 'Belem Tower', lat: 38.6916, lng: -9.216 } }, util);
  assert.deepEqual(placed.point, { lat: 38.6916, lng: -9.216, name: 'Belem Tower' });
  assert.equal(placed.icon, 'landmark');
  assert.equal(lib.objectNote({ kind: 'note', title: 'Cafe', content: 'Good', place: { name: 'Rua Augusta' } }, util).body, 'Good\n\nPlace: Rua Augusta');
  // A long object keeps its tail (the links and "External source") within 8000.
  const long = lib.objectNote({ ...SOUTHWEST, content: 'x'.repeat(9000) }, util);
  assert.equal(long.body.length <= 8000, true);
  assert.ok(long.body.endsWith('External source'));
  assert.equal(lib.objectDay({ kind: 'task', title: 'T', details: { due: '09:00' }, date: '2026-11-12' }, util), '2026-11-12', 'a time alone takes the object\'s own day');
});

await test('objectLink: the address given, else the object\'s first link; the excerpt from the object without its own address', () => {
  const link = lib.objectLink({ kind: 'link', title: 'Time Out **Lisbon**', content: 'The *best* pastel de nata.', links: [{ title: 'Time Out', url: 'https://timeout.com/lisbon' }, { title: 'Map', url: 'https://maps.example/x' }] }, util, {});
  assert.equal(link.url, 'https://timeout.com/lisbon');
  assert.equal(link.title, 'Time Out Lisbon');
  assert.equal(link.excerpt, 'The *best* pastel de nata.\n\nLinks:\n- Map: https://maps.example/x', 'its own address is not repeated');
  const given = lib.objectLink({ title: 'From chat', content: 'see this' }, util, { url: 'https://example.org/a', title: 'Example', excerpt: 'A page' });
  assert.deepEqual([given.url, given.title, given.excerpt], ['https://example.org/a', 'Example', 'A page'], 'what the flat fields give wins');
  assert.equal(lib.objectLink({ title: 'No link', content: 'x' }, util, {}), null);
  assert.equal(lib.objectLink({ title: 'Bad', content: 'x', links: [{ url: 'javascript:alert(1)' }] }, util, {}), null);
});

await test('saveNote, saveLink and savePhoto with an object; the flat fields as before', async () => {
  const f = fakeHost();
  const r = lib.createResearch(f.host, { scope: 'space' });
  f.host.on = (ev, fn) => fn;
  let thumbs = 0;
  let readied = 0;
  r.provide('u1', { ready: async () => { readied += 1; }, makeThumb: async (id) => { thumbs += 1; f.files.find((x) => x.id === id).hasThumb = true; } });
  const note = await f.handlers.saveNote({ title: 'Southwest 2483', object: SOUTHWEST, ref: { module: 'maps', kind: 'place', id: 'p' } }, { by: 'u2' });
  const kept = r.get(note.ref.id);
  assert.equal(kept.title, 'Southwest 2483');
  assert.ok(kept.body.startsWith('Booked with **points**.\n\nAirline: Southwest'));
  assert.equal(kept.icon, 'plane');
  assert.equal(kept.date, '2026-11-14');
  assert.equal(kept.by, 'u2');
  assert.equal(f.links.at(-1)[1], 1, 'linked to the object it came with');
  const words = await f.handlers.saveNote({ title: 'Dinner Friday', object: { title: 'Dinner Friday', content: 'Dinner Friday\nat 7' } });
  assert.equal(r.get(words.ref.id).body, 'at 7');
  await assert.rejects(f.handlers.saveNote({ object: { title: '  ', content: 'x' } }), /title/);
  const link = await f.handlers.saveLink({ url: 'https://timeout.com/lisbon', object: { kind: 'link', title: 'Time Out', content: 'Nata', tags: ['food'], links: [{ title: 'Time Out', url: 'https://timeout.com/lisbon' }] } }, { by: 'u2' });
  assert.deepEqual([r.get(link.ref.id).url, r.get(link.ref.id).title, r.get(link.ref.id).excerpt, r.get(link.ref.id).tags], ['https://timeout.com/lisbon', 'Time Out', 'Nata', ['food']]);
  await assert.rejects(f.handlers.saveLink({ url: 'ftp://x', object: { title: 'x', content: 'y' } }), /web address/);
  // A picture: in this place's uploads, not a photo yet; its thumbnail made here, its caption the picture's name.
  const FILE2 = 'b'.repeat(24);
  f.files.push({ id: FILE2, hasThumb: false });
  const photo = await f.handlers.savePhoto({ object: { kind: 'image', title: 'From chat', date: '2026-11-14', details: { upload: FILE2, name: 'IMG_2041.jpg' } } }, { by: 'u2' });
  const p = r.get(photo.ref.id);
  assert.deepEqual([p.kind, p.title, p.file, p.by, p.date], ['photo', 'IMG 2041', { id: FILE2, hasThumb: true }, 'u2', '2026-11-14']);
  assert.equal(thumbs, 1);
  assert.ok(readied >= 1, 'the place\'s items are loaded before it looks for the picture');
  await assert.rejects(f.handlers.savePhoto({ object: { kind: 'image', title: 'x', details: { upload: FILE2 } } }), /already a photo/);
  await assert.rejects(f.handlers.savePhoto({ object: { kind: 'image', title: 'x', details: { upload: 'c'.repeat(24) } } }), /not here any more/);
  await assert.rejects(f.handlers.savePhoto({ object: { kind: 'note', title: 'x', details: { upload: FILE2 } } }), /not a picture/);
  await assert.rejects(f.handlers.savePhoto({ object: { kind: 'image', title: 'x', details: { upload: '../x' } } }), /not a picture/);
  // Someone else's file: its thumbnail cannot be made here, so the photo shows the picture itself.
  const FILE3 = 'd'.repeat(24);
  f.files.push({ id: FILE3, hasThumb: false });
  const r2 = lib.createResearch(f.host, { scope: 'space' });
  r2.provide('u1', { makeThumb: async () => { throw Object.assign(new Error('only the person who added it can do that'), { status: 403 }); } });
  const plainPhoto = await f.handlers.savePhoto({ object: { kind: 'image', title: 'beach', details: { upload: FILE3 } } });
  assert.deepEqual(r2.get(plainPhoto.ref.id).file, { id: FILE3, hasThumb: false });
  assert.equal(r2.get(plainPhoto.ref.id).title, 'beach', 'no name: the object\'s title');
  // Not this person's file: makeThumb says false, asks nothing, and the photo shows the picture; one with a thumbnail keeps it.
  const FILE4 = 'e'.repeat(24);
  const FILE5 = 'f'.repeat(24);
  f.files.push({ id: FILE4, hasThumb: false, by: 'u9' }, { id: FILE5, hasThumb: true, by: 'u9' });
  const asked = [];
  const r3 = lib.createResearch(f.host, { scope: 'space' });
  r3.provide('u1', { makeThumb: async (id, file) => { asked.push(id); return file.by === 'u1'; } });
  const notMine = await f.handlers.savePhoto({ object: { kind: 'image', title: 'theirs', details: { upload: FILE4 } } });
  assert.deepEqual(r3.get(notMine.ref.id).file, { id: FILE4, hasThumb: false });
  const hadOne = await f.handlers.savePhoto({ object: { kind: 'image', title: 'had one', details: { upload: FILE5 } } });
  assert.deepEqual(r3.get(hadOne.ref.id).file, { id: FILE5, hasThumb: true });
  assert.deepEqual(asked, [FILE4], 'a file with a thumbnail is not given another');
  // The page's own makeThumb: it skips a file that is not the person's unless they are an owner, and reads the picture upright.
  const page = fs.readFileSync(new URL('../modules/research/src/research.js', import.meta.url), 'utf8');
  assert.match(page, /if \(!file \|\| \(file\.by !== me && role !== 'owner' && role !== 'admin'\)\) return false;/);
  assert.match(page, /createImageBitmap\(await got\.blob\(\), \{ imageOrientation: 'from-image' \}\)/);
});

await test('the window title is the name alone, never "Research 2" (#191)', () => {
  const page = fs.readFileSync(new URL('../modules/research/src/research.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../modules/research/src/research.html', import.meta.url), 'utf8');
  assert.match(page, /host\.setTitle\(info\.module\.name\);/, 'the titlebar gets the name as it is');
  assert.doesNotMatch(page, /setTitle\(`|\$\{name\} \$\{n\}/, 'no count built into the title');
  assert.doesNotMatch(html, /rs-head[^]*?data-slot="count"/, 'no count beside the name in the harness header either');
});

await test('a plain click on a card opens or closes it to read; the editor is the pen, a double click or Shift+Enter (#217)', () => {
  const dir = new URL('../modules/research/src/', import.meta.url);
  const js = fs.readFileSync(new URL('research.js', dir), 'utf8');
  const html = fs.readFileSync(new URL('research.html', dir), 'utf8');
  const css = fs.readFileSync(new URL('research.css', dir), 'utf8');
  const both = js.slice(js.indexOf("root.addEventListener('click'"), js.indexOf('// An object can be dragged out'));
  const click = both.slice(0, both.indexOf("root.addEventListener('dblclick'"));
  assert.match(click, /toggleCard\(cardEl\)/, 'a click toggles the card');
  assert.deepEqual(click.split('\n').filter((l) => /openEditor\(cardEl/.test(l) && !/action === 'edit'/.test(l)), [], 'and a click on the card itself never opens the editor');
  assert.match(click, /closest\('\.menu, a, button, \[data-action\]'\)/, 'links and buttons inside the card keep their own click');
  assert.match(both, /dblclick[^]*openEditor\(cardEl\.dataset\.id\)/, 'a double click edits');
  const keys = js.slice(js.indexOf("root.addEventListener('keydown'"), js.indexOf('// --- adding'));
  assert.match(keys, /ev\.key === 'Enter' && ev\.shiftKey\) \{[^}]*openEditor/, 'Shift+Enter edits');
  assert.match(keys, /ev\.key === 'Enter' \|\| ev\.key === ' '\) \{[^}]*toggleCard/, 'Enter and Space toggle');
  assert.doesNotMatch(keys, /\.click\(\)/, 'a key no longer fakes a click');
  assert.match(html, /<button class="edit sdk-icon-btn btn-quiet btn-small"[^>]*data-action="edit"/, 'the card has an edit button');
  assert.match(html, /<article class="sdk-card-banded rcard" tabindex="0">\s*<header class="sdk-card-head">/, 'a focusable banded card (Cards), its band first, whose focus outline and hover fill are system.css');
  assert.doesNotMatch(css, /\.rcard:focus-visible|\.rcard:hover/, 'the module draws no focus or hover of its own');
  assert.match(js, /classList\.toggle\('on', open\)/, 'an open card is a selected card (the selected fill)');
});

console.log(`check-research: OK (${n} checks)`);
