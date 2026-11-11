#!/usr/bin/env node
/*
 * check-tags.mjs -- the shared tags (documentation/plans/plan-tags.md, steps 1 and 5b; server/tags.js and its routes).
 * Part 1, on their own: the one cleaning function (case, whitespace, Unicode, invisible and direction characters, HTML,
 * length, odd input), the list (find-or-create, rename, recolour, delete, the 200 limit, ids that are unguessable and
 * never in two spaces, a tag of one space never read in another, a delete leaving a dead id that reads as dropped, a
 * file with hostile content), the stored file, and the move helper (decision 10; step 5b).
 * Part 2, a throwaway server: every route as the admin, an owner, a moderator, a member, a view-only member, a member of
 * another space, a guest, and no session; the module's opt-in (`"tags": true`); the permission to rename and delete (and
 * that a guest can never have it); names that try to carry HTML; body size; the write limit; events on the module
 * stream; the list kept across a restart and removed with the space.
 * Part 3, a hosted server (BASE_DOMAIN): a tag of one environment is not found from another, even with its space's id.
 * No network beyond localhost, no LiveKit.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { Tags, TagError, cleanName, cleanColor, moveTagIds, LIMITS, TONES, ID_RE } = require('../server/tags.js');
const { buildModule } = require('../server/module-build.js');
const { cleanManifest } = require('../server/modules.js');

let n = 0;
let failed = 0;
const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `check-tags-${label}-`));
const test = async (name, fn) => {
  try {
    await fn();
    n += 1;
  } catch (err) {
    failed += 1;
    console.error(`check-tags: ${name}: ${err.stack || err.message}`);
  }
};
const clean = (raw) => cleanName(raw).name;

// --- Part 1: the rules ------------------------------------------------------------------------------------------------

await test('a name is cleaned by one rule: case, whitespace, Unicode, dashes', () => {
  assert.equal(clean('Hotel'), 'hotel');
  assert.equal(clean('  Big   Trip '), 'big-trip', 'whitespace runs become one dash');
  assert.equal(clean('a\tb\nc'), 'a-b-c');
  assert.equal(clean('a b'), 'a-b', 'a no-break space is whitespace');
  assert.equal(clean('--a--b--'), 'a-b', 'dashes are tidied');
  assert.equal(clean('ＨＯＴＥＬ'), 'hotel', 'full-width letters fold (NFKC)');
  assert.equal(clean('Café'), clean('Café'), 'composed and decomposed are one name');
  assert.equal(clean('Café'), 'café');
  assert.equal(clean('日本語'), '日本語', 'any letter');
  assert.equal(clean('हिन्दी'), 'हिन्दी', 'letters that need combining marks');
  assert.equal(clean('Привет'), 'привет');
  assert.equal(clean('2026-trip'), '2026-trip', 'digits and dashes');
  assert.equal(clean('İstanbul'), clean(clean('İstanbul')), 'cleaning twice changes nothing');
  assert.equal(clean('x'.repeat(24)), 'x'.repeat(24), '24 characters');
  assert.equal(clean('日'.repeat(24)), '日'.repeat(24), '24 characters as a person counts them');
});

await test('invisible, zero-width and direction characters are taken out, so a name cannot look like another', () => {
  assert.equal(clean('ho​tel'), 'hotel', 'zero-width space');
  assert.equal(clean('h‌o‍tel'), 'hotel', 'zero-width non-joiner and joiner');
  assert.equal(clean('‮txet‬'), 'txet', 'right-to-left override');
  assert.equal(clean('⁦hotel⁩'), 'hotel', 'isolates');
  assert.equal(clean('‏hotel‎'), 'hotel', 'direction marks');
  assert.equal(clean('﻿hotel'), 'hotel', 'byte order mark');
  assert.equal(clean('hot­el'), 'hotel', 'soft hyphen');
  assert.equal(clean('ho\u0000tel'), 'hotel', 'a control character');
  assert.equal(clean('ho͏tel'), 'hotel', 'combining grapheme joiner');
  assert.equal(clean('hotel️'), 'hotel', 'variation selector');
  assert.equal(clean('hotel\u{E0041}'), 'hotel', 'a tag character');
  assert.equal(clean('hotelㅤ'), 'hotel', 'a blank Hangul filler');
  assert.ok(cleanName('​​').error && cleanName('ㅤ').error, 'nothing visible left is no name');
  assert.equal(clean('‮hotel'), clean('hotel'), 'so the same name cannot be added twice');
});

await test('a name that is not letters, digits and dashes, or is too long, is refused with one sentence', () => {
  const bad = ['<script>alert(1)</script>', '<b>x</b>', 'a&b', 'a"b', "a'b", 'a`b', 'a<b', 'a>b', 'a/b', 'a.b', 'a_b', 'a,b', '#hotel', 'hot el!', 'a:b', 'a;b', 'a\\b', '😀', 'hotel😀', '＜script＞', '', '   ', '---', 5, null, undefined, {}, [], true, ['a'], { toString: () => 'x' }];
  for (const b of bad) {
    const r = cleanName(b);
    assert.ok(r.error && !r.name, `${JSON.stringify(b)} is refused`);
    assert.match(r.error, /^A tag .+\.$/, 'one plain sentence');
  }
  assert.match(cleanName('x'.repeat(25)).error, /at most 24/, '25 characters');
  assert.match(cleanName('日'.repeat(25)).error, /at most 24/);
  assert.match(cleanName('x'.repeat(100000)).error, /at most 24/, 'a huge one is refused before it is worked on');
  assert.match(cleanName('ﷺﷺ').error, /at most 24/, 'a character that expands (NFKC) is counted after it expands');
  assert.equal(cleanName('́abc').error !== undefined, true, 'must start with a letter or digit, not a mark');
  for (const b of ['hotel', 'a-b', 'x1', '1', 'é']) assert.ok(cleanName(b).name, `${b} is fine`);
  // Whatever passes can be put in HTML as it is: none of < > & " ' is in it.
  for (const b of ['＜b＞', 'café-日本', 'İstanbul']) {
    const r = cleanName(b);
    assert.ok(!r.name || !/[<>&"'`]/.test(r.name), 'no HTML characters survive');
  }
});

await test('a colour is a tone from the fixed set or empty; a free colour is refused', () => {
  assert.equal(TONES.length > 0 && new Set(TONES).size === TONES.length, true);
  for (const t of TONES) assert.deepEqual(cleanColor(t), { color: t });
  for (const empty of [undefined, null, '']) assert.deepEqual(cleanColor(empty), { color: '' });
  for (const bad of ['#ff0000', 'ff0000', 'rgb(1,2,3)', 'Red', 'red ', 'url(x)', 'javascript:alert(1)', '<b>', 5, {}, [], true, 'constructor']) assert.ok(cleanColor(bad).error, `${JSON.stringify(bad)} is refused`);
});

const spaceA = 'abcd1234';
const spaceB = 'efgh5678';
await test('the list: find-or-create, case, rename, recolour, delete, ids', () => {
  const dir = tmp('list');
  let t = 1760000000000;
  const tags = new Tags(dir, () => t);
  const events = [];
  tags.on('change', (e) => events.push(e));
  const made = tags.add(spaceA, 'Hotel', 'blue', 'ann');
  assert.equal(made.made, true);
  assert.match(made.tag.id, ID_RE);
  assert.equal(made.tag.id.length, 10);
  assert.deepEqual(Object.keys(made.tag).sort(), ['color', 'id', 'name'], 'a page sees id, name, colour only');
  assert.deepEqual([made.tag.name, made.tag.color], ['hotel', 'blue']);
  const again = tags.add(spaceA, ' HOTEL​ ', 'red', 'bo');
  assert.deepEqual([again.made, again.tag.id, again.tag.color], [false, made.tag.id, 'blue'], 'the same name is found, whatever its case or spacing, and keeps its colour');
  assert.equal(tags.count(spaceA), 1);
  assert.deepEqual(events.map((e) => [e.spaceId, e.op, e.tag.name]), [[spaceA, 'added', 'hotel']], 'only the made one is told');
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'tags.json'), 'utf8'));
  assert.deepEqual(Object.keys(stored.spaces[spaceA][0]).sort(), ['at', 'by', 'color', 'id', 'name']);
  assert.deepEqual([stored.spaces[spaceA][0].by, stored.spaces[spaceA][0].at], ['ann', new Date(t).toISOString()]);
  assert.ok(!fs.existsSync(path.join(dir, 'tags.json.tmp')), 'written by rename');
  tags.add(spaceA, 'flights', '', 'ann');
  tags.add(spaceA, 'activities', '', 'ann');
  assert.deepEqual(tags.list(spaceA).map((x) => x.name), ['activities', 'flights', 'hotel'], 'name order');
  assert.throws(() => tags.add(spaceA, '<x>', '', 'ann'), (e) => e instanceof TagError && e.status === 400);
  assert.throws(() => tags.add(spaceA, 'ok', 'hotpink', 'ann'), (e) => e instanceof TagError && e.status === 400 && /colour/.test(e.message));
  assert.equal(tags.count(spaceA), 3, 'a refused one adds nothing');

  // rename, recolour
  events.length = 0;
  const renamed = tags.update(spaceA, made.tag.id, { name: 'Stays' });
  assert.deepEqual([renamed.id, renamed.name, renamed.color], [made.tag.id, 'stays', 'blue'], 'the id stays, so every use follows');
  assert.deepEqual(events.map((e) => [e.op, e.tag.name]), [['changed', 'stays']]);
  assert.deepEqual(tags.update(spaceA, made.tag.id, { color: 'green' }).color, 'green');
  assert.deepEqual(tags.update(spaceA, made.tag.id, { color: '' }).color, '', 'plain again');
  events.length = 0;
  tags.update(spaceA, made.tag.id, { name: 'STAYS' });
  assert.equal(events.length, 0, 'a change to nothing is not told');
  assert.throws(() => tags.update(spaceA, made.tag.id, { name: 'flights' }), (e) => e.status === 409 && /already has that name/.test(e.message));
  assert.throws(() => tags.update(spaceA, made.tag.id, { name: 'FLIGHTS ' }), (e) => e.status === 409, 'taken, ignoring case and spacing');
  assert.throws(() => tags.update(spaceA, made.tag.id, {}), (e) => e.status === 400);
  assert.throws(() => tags.update(spaceA, made.tag.id, { name: '<b>' }), (e) => e.status === 400);
  assert.throws(() => tags.update(spaceA, made.tag.id, { color: '#fff' }), (e) => e.status === 400);
  assert.throws(() => tags.update(spaceA, made.tag.id, null), (e) => e.status === 400);
  assert.throws(() => tags.update(spaceA, 'nosuchid00', { name: 'x' }), (e) => e.status === 404);
  assert.throws(() => tags.update(spaceA, '../../etc', { name: 'x' }), (e) => e.status === 404);
  assert.throws(() => tags.update(spaceA, { toString: () => made.tag.id }, { name: 'x' }), (e) => e.status === 404, 'an id is a string');
  assert.equal(tags.list(spaceA).find((x) => x.id === made.tag.id).name, 'stays', 'refused changes changed nothing');

  // delete
  events.length = 0;
  const gone = tags.remove(spaceA, made.tag.id);
  assert.equal(gone.id, made.tag.id);
  assert.deepEqual(events.map((e) => [e.op, e.tag.id]), [['removed', made.tag.id]]);
  assert.throws(() => tags.remove(spaceA, made.tag.id), (e) => e.status === 404);
  assert.deepEqual(tags.resolve(spaceA, [made.tag.id]), [], 'an object still holding the id reads it as dropped');
  assert.deepEqual(tags.cleanIds(spaceA, [made.tag.id]), []);
  const reborn = tags.add(spaceA, 'hotel', '', 'ann');
  assert.notEqual(reborn.tag.id, made.tag.id, 'a deleted tag\'s id is not handed to a new tag of the same name');
  assert.deepEqual(tags.resolve(spaceA, [made.tag.id]), [], 'so the old id still reads as dropped');

  // ids: ten random characters, never in two spaces, never repeated
  const seen = new Set();
  for (let i = 0; i < 150; i += 1) {
    const x = tags.add(spaceB, `t${i}`, '', 'ann').tag.id;
    assert.match(x, /^[a-z0-9]{10}$/);
    assert.ok(!seen.has(x));
    seen.add(x);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

await test('lists are per space: an id of one space is nothing in another', () => {
  const dir = tmp('spaces');
  const tags = new Tags(dir);
  const a = tags.add(spaceA, 'secret-plan', 'red', 'ann').tag;
  const b = tags.add(spaceB, 'secret-plan', 'blue', 'ann').tag;
  assert.notEqual(a.id, b.id, 'the same name in two spaces is two tags');
  assert.equal(tags.get(spaceB, a.id), null);
  assert.deepEqual(tags.resolve(spaceB, [a.id, b.id]).map((x) => x.id), [b.id], 'another space\'s id is dropped, this one\'s kept');
  assert.deepEqual(tags.cleanIds(spaceB, [a.id]), []);
  assert.throws(() => tags.update(spaceB, a.id, { name: 'taken-over' }), (e) => e.status === 404);
  assert.throws(() => tags.remove(spaceB, a.id), (e) => e.status === 404);
  assert.equal(tags.list(spaceA)[0].name, 'secret-plan');
  assert.deepEqual(tags.list('nowhere01'), []);
  for (const odd of ['__proto__', 'constructor', 'prototype', 'toString']) {
    assert.deepEqual(tags.list(odd), [], `${odd} has no tags`);
    if (['__proto__', 'constructor', 'prototype'].includes(odd)) assert.throws(() => tags.add(odd, 'x', '', 'ann'), (e) => e.status === 404, `${odd} is never a list`);
  }
  assert.ok(!('x' in Object.prototype) && ({}).secret === undefined);
  assert.equal(tags.forgetSpace(spaceA), 1);
  assert.deepEqual(tags.list(spaceA), []);
  assert.equal(tags.forgetSpace(spaceA), 0, 'again does nothing');
  assert.equal(tags.list(spaceB).length, 1, 'the other space keeps its list');
  assert.ok(!fs.readFileSync(path.join(dir, 'tags.json'), 'utf8').includes(spaceA), 'and the file no longer names the erased space');
  // Another environment is another folder: nothing is shared.
  const other = new Tags(tmp('other-env'));
  assert.deepEqual(other.list(spaceB), [], 'the same space id in another environment has no tags');
  assert.equal(other.get(spaceB, b.id), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

await test('limits: 200 to a list, 8 to an object', () => {
  const dir = tmp('limits');
  const tags = new Tags(dir);
  const ids = [];
  for (let i = 0; i < LIMITS.perList; i += 1) ids.push(tags.add(spaceA, `tag-${i}`, '', 'ann').tag.id);
  assert.equal(tags.count(spaceA), 200);
  assert.throws(() => tags.add(spaceA, 'one-more', '', 'ann'), (e) => e instanceof TagError && e.status === 409 && /200/.test(e.message));
  assert.equal(tags.add(spaceA, 'TAG-7', '', 'ann').made, false, 'a full list still finds a tag it has');
  assert.equal(tags.count(spaceA), 200);
  assert.equal(tags.add(spaceB, 'one-more', '', 'ann').made, true, 'another space\'s list is its own');
  assert.equal(tags.resolve(spaceA, ids).length, 8, 'an object reads at most 8');
  assert.deepEqual(tags.resolve(spaceA, ids).map((x) => x.id), ids.slice(0, 8), 'the first 8, in its order');
  assert.deepEqual(tags.cleanIds(spaceA, [ids[0], ids[0], ids[1], 'nope', 5, null, {}, [], ids[2]]), [ids[0], ids[1], ids[2]], 'each once; made-up and odd values dropped');
  assert.deepEqual(tags.resolve(spaceA, 'not a list'), []);
  tags.remove(spaceA, ids[0]);
  assert.equal(tags.add(spaceA, 'one-more', '', 'ann').made, true, 'it fits again after a delete');
  fs.rmSync(dir, { recursive: true, force: true });
});

await test('the file: kept across a restart; a damaged or hostile file reads as what is sound', () => {
  const dir = tmp('file');
  const a = new Tags(dir);
  const t = a.add(spaceA, 'kept', 'teal', 'ann').tag;
  const b = new Tags(dir);
  assert.deepEqual(b.list(spaceA), [t], 'read back as written');
  assert.throws(() => b.add(spaceA, 'kept', 'red', 'x') && (() => { throw new Error('found, not made'); })(), /found, not made/);
  fs.writeFileSync(path.join(dir, 'tags.json'), '{ not json');
  assert.deepEqual(new Tags(dir).list(spaceA), [], 'a damaged file is no tags');
  const good = { id: 'goodid0001', name: 'good', color: 'red', by: 'ann', at: 'x' };
  fs.writeFileSync(path.join(dir, 'tags.json'), `{"spaces":{"__proto__":[${JSON.stringify(good)}],"constructor":[${JSON.stringify(good)}],"${spaceA}":[
    ${JSON.stringify(good)},
    ${JSON.stringify({ ...good, id: 'goodid0002' })},
    ${JSON.stringify({ ...good, id: 'goodid0003', name: '<script>alert(1)</script>' })},
    ${JSON.stringify({ ...good, id: 'goodid0004', name: 'Fine​' })},
    ${JSON.stringify({ ...good, id: 'GOODID0005', name: 'upper' })},
    ${JSON.stringify({ ...good, id: '../..', name: 'path' })},
    ${JSON.stringify({ ...good, id: 'goodid0006', name: 'colourful', color: '#ff0000' })},
    ${JSON.stringify({ ...good, id: 'goodid0007', name: 'long'.repeat(10) })},
    ${JSON.stringify({ ...good, id: 'goodid0008', name: 'Hi', by: 'x'.repeat(500), at: 'y'.repeat(500) })},
    5, null, "str", [], {"id": 7}],
    "${spaceB}":[${JSON.stringify(good)}, ${JSON.stringify({ ...good, id: 'goodid0009', name: 'other' })}], "bad": 5}}`);
  const c = new Tags(dir);
  assert.deepEqual(c.list(spaceA).map((x) => [x.id, x.name, x.color]), [['goodid0006', 'colourful', ''], ['goodid0004', 'fine', 'red'], ['goodid0001', 'good', 'red'], ['goodid0008', 'hi', 'red']], 'only sound tags: a duplicate name, HTML, a bad id, a long name and junk are skipped; a name is cleaned; a free colour becomes plain');
  assert.ok(c.list(spaceA).every((x) => !/[<>&]/.test(x.name)));
  assert.deepEqual(c.list(spaceB).map((x) => x.id), ['goodid0009'], 'an id already used in another space is not a second tag');
  assert.deepEqual(c.list('__proto__'), []);
  assert.ok(!('goodid0001' in Object.prototype) && Object.getPrototypeOf({}) === Object.prototype);
  assert.equal(c.add(spaceA, 'new', '', 'ann').made, true);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'tags.json'), 'utf8'));
  assert.ok(!Object.keys(saved.spaces).includes('__proto__') && !Object.keys(saved.spaces).includes('constructor'), 'not written back');
  const over = [];
  for (let i = 0; i < 250; i += 1) over.push({ id: `idnumber${String(i).padStart(3, '0')}`.slice(0, 12), name: `n${i}`, color: '', by: '', at: '' });
  fs.writeFileSync(path.join(dir, 'tags.json'), JSON.stringify({ spaces: { [spaceA]: over } }));
  assert.equal(new Tags(dir).count(spaceA), 200, 'a file over the limit is cut at 200');
  // A write that fails leaves the list as it was.
  const d = new Tags(tmp('fail'));
  d.add(spaceA, 'before', '', 'ann');
  const was = d.save;
  d.save = () => { throw new Error('disk full'); };
  assert.throws(() => d.add(spaceA, 'after', '', 'ann'), /disk full/);
  assert.deepEqual(d.list(spaceA).map((x) => x.name), ['before'], 'the failed add is not kept');
  const idsBefore = d.ids.size;
  assert.throws(() => d.update(spaceA, d.list(spaceA)[0].id, { name: 'renamed' }), /disk full/);
  assert.throws(() => d.remove(spaceA, d.list(spaceA)[0].id), /disk full/);
  assert.deepEqual(d.list(spaceA).map((x) => x.name), ['before']);
  assert.equal(d.ids.size, idsBefore);
  d.save = was;
  fs.rmSync(dir, { recursive: true, force: true });
});

await test('moving an object to another space (step 5b): names re-made there, only with the right, limits kept, what does not fit reported', () => {
  const dir = tmp('move');
  const tags = new Tags(dir);
  const mk = (space, name, color = '') => tags.add(space, name, color, 'ann').tag;
  const hotel = mk(spaceA, 'hotel', 'blue');
  const food = mk(spaceA, 'food', 'red');
  const plain = mk(spaceA, 'plain');
  const there = mk(spaceB, 'food', 'green');

  // With the right: a tag of that name there is used (its colour is kept); another is made with the source's colour.
  const first = moveTagIds(tags, { ids: [hotel.id, food.id, plain.id], fromSpace: spaceA, toSpace: spaceB, mayCreate: true, by: 'bo' });
  assert.deepEqual(first.dropped, []);
  assert.equal(first.ids.length, 3);
  assert.equal(first.ids[1], there.id, 'the existing tag of that name is used');
  assert.equal(tags.get(spaceB, there.id).color, 'green', 'and is not recoloured');
  const madeHotel = tags.get(spaceB, first.ids[0]);
  assert.deepEqual([madeHotel.name, madeHotel.color], ['hotel', 'blue']);
  assert.notEqual(madeHotel.id, hotel.id, 'a new id: the source\'s ids never cross');
  assert.equal(tags.list(spaceA).length, 3, 'the source list is untouched');
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'tags.json'), 'utf8'));
  assert.equal(stored.spaces[spaceB].find((t) => t.id === madeHotel.id).by, 'bo', 'made by the person who moved it');
  const twice = moveTagIds(tags, { ids: [hotel.id, food.id, plain.id], fromSpace: spaceA, toSpace: spaceB, mayCreate: true, by: 'bo' });
  assert.deepEqual(twice.ids, first.ids, 'again finds the same tags, makes none');
  assert.equal(tags.count(spaceB), 3);

  // Without the right: existing names are used; the rest are dropped and named; none is made.
  const spaceC = 'ijkl9012';
  mk(spaceC, 'food');
  const noRight = moveTagIds(tags, { ids: [hotel.id, food.id], fromSpace: spaceA, toSpace: spaceC, mayCreate: false, by: 'bo' });
  assert.deepEqual(noRight.dropped, [{ name: 'hotel', why: 'no-right' }]);
  assert.equal(noRight.ids.length, 1);
  assert.equal(tags.count(spaceC), 1, 'nothing was made without the right');
  for (const falsy of [undefined, null, 0, '', 'yes', 1]) {
    if (falsy === 'yes' || falsy === 1) continue;
    assert.equal(moveTagIds(tags, { ids: [hotel.id], fromSpace: spaceA, toSpace: 'qqqq0000', mayCreate: falsy, by: 'bo' }).ids.length, 0);
  }
  assert.equal(tags.count('qqqq0000'), 0);

  // 8 to an object: the rest are dropped and reported, and no tag is made for them.
  const many = Array.from({ length: 11 }, (_, i) => mk(spaceA, `many-${i}`).id);
  const spaceD = 'mnop3456';
  const eight = moveTagIds(tags, { ids: many, fromSpace: spaceA, toSpace: spaceD, mayCreate: true, by: 'bo' });
  assert.equal(eight.ids.length, 8);
  assert.deepEqual(eight.dropped.map((d) => [d.name, d.why]), [['many-8', 'too-many'], ['many-9', 'too-many'], ['many-10', 'too-many']]);
  assert.equal(tags.count(spaceD), 8, 'only the ones that fit were made');

  // 200 to the destination's list: what does not fit is dropped and reported.
  const spaceE = 'qrst7890';
  for (let i = 0; i < 199; i += 1) mk(spaceE, `fill-${i}`);
  const full = moveTagIds(tags, { ids: [hotel.id, plain.id], fromSpace: spaceA, toSpace: spaceE, mayCreate: true, by: 'bo' });
  assert.deepEqual(full.dropped, [{ name: 'plain', why: 'list-full' }]);
  assert.deepEqual(full.ids.map((id) => tags.get(spaceE, id).name), ['hotel']);
  assert.equal(tags.count(spaceE), 200);

  // Never trusting the caller: ids that are not the source's, dead, repeated or odd are not moved; names come from the source.
  const spaceF = 'uvwx1234';
  const junk = moveTagIds(tags, { ids: [there.id, 'nosuchid00', hotel.id, hotel.id, 5, null, {}, [], '__proto__'], fromSpace: spaceA, toSpace: spaceF, mayCreate: true, by: 'bo' });
  assert.deepEqual(junk.dropped, []);
  assert.deepEqual(junk.ids.map((id) => tags.get(spaceF, id).name), ['hotel'], 'another space\'s id is not a tag of the source; the repeat is one');
  assert.deepEqual(moveTagIds(tags, { ids: 'hotel', fromSpace: spaceA, toSpace: spaceF, mayCreate: true }).ids, []);
  assert.deepEqual(moveTagIds(tags, {}).ids, []);
  assert.deepEqual(moveTagIds(tags, { ids: [hotel.id], fromSpace: spaceA, toSpace: spaceA, mayCreate: false }), { ids: [hotel.id], dropped: [] }, 'within one space nothing changes');
  // A stored name that no longer passes the rule is dropped, never re-made.
  tags.spaces[spaceA].push({ id: 'badname001', name: '<b>x</b>', color: 'red', by: '', at: '' });
  tags.ids.add('badname001');
  const bad = moveTagIds(tags, { ids: ['badname001'], fromSpace: spaceA, toSpace: spaceF, mayCreate: true, by: 'bo' });
  assert.deepEqual(bad.ids, []);
  assert.deepEqual(bad.dropped.map((d) => d.why), ['invalid']);
  assert.ok(bad.dropped.every((d) => !/[<>&]/.test(d.name)), 'and the report carries no HTML');
  assert.ok(!tags.list(spaceF).some((t) => /[<>&]/.test(t.name)));
  fs.rmSync(dir, { recursive: true, force: true });
});

await test('the manifest flag and the permission', () => {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'documents', 'module.json'), 'utf8'));
  const read = (extra) => cleanManifest({ ...base, ...extra }, new Set(['module.json', 'canvas.html']));
  assert.equal(read({ tags: true }).tags, true, '"tags": true is kept');
  for (const v of [false, 'true', 1, null, [], {}, 'yes']) assert.equal(read({ tags: v }).tags, false, `${JSON.stringify(v)} is not an opt-in`);
  assert.equal(read({}).tags, false, 'absent is off');
  const { Store } = require('../server/store.js');
  const dir = tmp('perm');
  const store = new Store(dir);
  const sets = Object.fromEntries(['moderator', 'member', 'guest', 'owner'].map((r) => [r, store.roleSet(r)]));
  assert.deepEqual([sets.moderator.manageTags, sets.member.manageTags, sets.guest.manageTags, sets.owner.manageTags], [true, false, false, true], 'moderator and owner by default; the admin has every permission');
  assert.equal(store.roleSet('admin').manageTags, true);
  assert.ok(store.allPermissions().some((p) => p.key === 'manageTags' && p.group === 'Moderation'), 'it is in the Roles grid');
  store.setRolePermissions('member', { manageTags: true });
  assert.equal(store.roleSet('member').manageTags, true, 'the owner may change it');
  store.setRolePermissions('moderator', { manageTags: false });
  assert.equal(store.roleSet('moderator').manageTags, false);
  assert.throws(() => store.setRolePermissions('owner', { manageTags: false }), /every permission/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- Part 2: the routes -----------------------------------------------------------------------------------------------

function startServer(dataDir, env = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ADMIN_PASSWORD: 'testpass1234', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 25000);
    const onData = () => {
      const m = /listening on :(\d+)/.exec(out);
      if (m) { clearTimeout(timer); resolve({ port: Number(m[1]), output: () => out, stop: () => new Promise((r) => { if (child.exitCode !== null) return r(); child.once('exit', r); child.kill('SIGTERM'); }) }); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
}

// One request. `host` is a subdomain of localhost for a hosted server, '' otherwise.
function request(server, host, method, urlPath, { body, cookie, raw, headers: more } = {}) {
  const payload = raw !== undefined ? Buffer.from(raw) : body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { accept: 'application/json', ...(host ? { host: `${host}.localhost:${server.port}` } : {}), ...more };
  if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = payload.length; }
  if (cookie) headers.cookie = cookie;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// A throwaway module that opts in to tags, made here: a manifest like Documents' (view and edit; the page is not used).
function tagModuleZip(dir) {
  const src = path.join(dir, 'tagnotes');
  fs.mkdirSync(path.join(src, 'src'), { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'documents', 'module.json'), 'utf8'));
  Object.assign(manifest, { id: 'tagnotes', name: 'Tag notes', version: '1.0.0', tags: true });
  fs.writeFileSync(path.join(src, 'module.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(src, 'src', 'tagnotes.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Tag notes</title><style>/*__CSS__*/</style></head><body><script>/*__JS__*/</script></body></html>');
  fs.writeFileSync(path.join(src, 'src', 'tagnotes.css'), 'body { margin: 0; }');
  fs.writeFileSync(path.join(src, 'src', 'tagnotes.js'), '// nothing: the check uses only the routes');
  return buildModule(src).zip;
}
async function installTagModule(server, host, cookie, dir) {
  const zip = tagModuleZip(dir);
  const r = await new Promise((resolve, reject) => {
    const headers = { 'content-type': 'application/zip', 'content-length': zip.length, cookie, ...(host ? { host: `${host}.localhost:${server.port}` } : {}) };
    const req = http.request({ host: '127.0.0.1', port: server.port, method: 'POST', path: '/api/modules', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(zip);
  });
  assert.equal(r.status, 201, `the tag module installs: ${r.text}`);
  const on = await request(server, host, 'PATCH', '/api/modules/tagnotes', { cookie, body: { enabled: true } });
  assert.equal(on.status, 200, `and turns on: ${on.text}`);
}

const dataDir = tmp('server');
const work = tmp('work');
let server = null;
try {
  server = await startServer(dataDir);
  const call = (method, urlPath, opts) => request(server, '', method, urlPath, opts);
  const sessionOf = async (login, password) => {
    const r = await call('POST', '/api/login', { body: { login, password } });
    assert.equal(r.status, 200, `${login} signs in: ${r.text}`);
    return `app_session=${r.json.token}`;
  };
  const expect = async (label, status, method, urlPath, opts) => {
    const r = await call(method, urlPath, opts);
    assert.equal(r.status, status, `${label}: ${method} ${urlPath} answered ${r.status} ${r.text}`);
    if (status >= 400 && status !== 429) assert.match(r.json?.error || '', /^[A-Z].*\.$/, `${label}: one plain sentence (${r.text})`);
    return r;
  };
  const admin = await sessionOf('admin', 'testpass1234');
  const mk = async (login, role = 'member') => (await call('POST', '/api/users', { cookie: admin, body: { login, displayName: login, role, password: 'memberpass1234' } })).json.user;
  const ownerUser = await mk('olive', 'owner');
  const pat = await mk('pat');
  const sam = await mk('sam');
  const moUser = await mk('mo');
  const outUser = await mk('out');
  await installTagModule(server, '', admin, work);
  const todo = await call('POST', '/api/modules/bundled/todo/install', { cookie: admin });
  assert.ok([200, 201].includes(todo.status), todo.text);
  if (!todo.json.module?.enabled) await expect('todo on', 200, 'PATCH', '/api/modules/todo', { cookie: admin, body: { enabled: true } });
  const S = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Trip', members: [pat.key, sam.key, moUser.key] } })).json.space.id;
  const T = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Other trip', members: [outUser.key] } })).json.space.id;
  await expect('mo moderates', 200, 'PATCH', `/api/users/${moUser.key}/spaces/${S}`, { cookie: admin, body: { permissions: { moderator: true } } });
  const sessions = { owner: await sessionOf('olive', 'memberpass1234'), pat: await sessionOf('pat', 'memberpass1234'), sam: await sessionOf('sam', 'memberpass1234'), mo: await sessionOf('mo', 'memberpass1234'), out: await sessionOf('out', 'memberpass1234') };
  for (const id of [S, T]) await expect('guests allowed', 200, 'PATCH', `/api/spaces/${id}`, { cookie: admin, body: { allowGuests: true } });
  const guestOf = async (id) => `?guest=${encodeURIComponent((await expect('guest link', 200, 'POST', `/api/spaces/${id}/guest-link`, { cookie: admin, body: {} })).json.space.guestToken)}`;
  const guestS = await guestOf(S);
  const guestT = await guestOf(T);
  const L = `/api/spaces/${S}/tags`;
  const make = (cookie, name, extra = {}, from = 'tagnotes', suffix = '') => call('POST', `${L}${suffix}`, { cookie, body: { name, from, ...extra } });

  await test('reading: members, the owner and the admin read; guests with the link read; others and nobody do not', async () => {
    assert.deepEqual((await expect('empty', 200, 'GET', L, { cookie: sessions.pat })).json, { tags: [] });
    await expect('admin', 200, 'GET', L, { cookie: admin });
    await expect('owner', 200, 'GET', L, { cookie: sessions.owner });
    await expect('guest with the link', 200, 'GET', `${L}${guestS}`);
    await expect('not in the space', 403, 'GET', L, { cookie: sessions.out });
    await expect('a guest of another space', 403, 'GET', `${L}${guestT}`);
    assert.ok([401, 403].includes((await call('GET', `${L}?guest=nonsense`)).status), 'a made-up guest token');
    await expect('nobody', 401, 'GET', L);
    await expect('no such space', 404, 'GET', '/api/spaces/nope/tags', { cookie: sessions.pat });
    await expect('a module that does not use tags', 403, 'GET', `${L}?from=todo`, { cookie: sessions.pat });
    await expect('a module that is not there', 404, 'GET', `${L}?from=nothing`, { cookie: sessions.pat });
    await expect('a module id that is not text', 404, 'GET', `${L}?from=tagnotes&from=todo`, { cookie: sessions.pat });
    await expect('a module that does', 200, 'GET', `${L}?from=tagnotes`, { cookie: sessions.pat });
    await expect('the access key opens no tags', 401, 'GET', L, { headers: { authorization: 'Bearer nonsense' } });
  });

  await test('creating: needs the calling module\'s write there; never a guest; 201 made, 200 found', async () => {
    const made = await expect('member makes', 201, 'POST', L, { cookie: sessions.pat, body: { name: 'Hotel', color: 'blue', from: 'tagnotes' } });
    assert.deepEqual(Object.keys(made.json), ['tag']);
    assert.deepEqual([made.json.tag.name, made.json.tag.color], ['hotel', 'blue']);
    assert.match(made.json.tag.id, /^[a-z0-9]{10}$/);
    const found = await expect('again finds', 200, 'POST', L, { cookie: sessions.sam, body: { name: ' HOTEL ', color: 'red', from: 'tagnotes' } });
    assert.deepEqual(found.json.tag, made.json.tag, 'the same tag, its colour kept');
    assert.equal((await make(sessions.owner, 'hotel​')).status, 200, 'an invisible character makes no second tag');
    assert.equal((await make(admin, 'flights')).status, 201, 'the admin makes');
    assert.equal((await make(sessions.owner, 'food', { color: '' })).status, 201, 'an owner makes');
    assert.equal((await make(sessions.mo, 'maps')).status, 201, 'a moderator makes');
    assert.deepEqual((await call('GET', L, { cookie: sessions.sam })).json.tags.map((t) => t.name), ['flights', 'food', 'hotel', 'maps'], 'a member reads them in name order');
    assert.deepEqual((await call('GET', `${L}${guestS}`)).json.tags.map((t) => t.name), ['flights', 'food', 'hotel', 'maps'], 'and a guest does');
    const body = JSON.stringify((await call('GET', L, { cookie: sessions.sam })).json);
    assert.ok(!body.includes(pat.key) && !/"by"|"at"/.test(body), 'who made a tag and when are not sent');
    // not allowed
    await expect('not in the space', 403, 'POST', L, { cookie: sessions.out, body: { name: 'x', from: 'tagnotes' } });
    await expect('nobody', 401, 'POST', L, { body: { name: 'x', from: 'tagnotes' } });
    const g = await expect('a guest', 403, 'POST', `${L}${guestS}`, { body: { name: 'guest-tag', from: 'tagnotes' } });
    assert.match(g.json.error, /^Guests can't make tags/);
    await expect('a guest of another space', 403, 'POST', `${L}${guestT}`, { body: { name: 'guest-tag', from: 'tagnotes' } });
    await expect('no module named', 404, 'POST', L, { cookie: sessions.pat, body: { name: 'x' } });
    await expect('a module that is not there', 404, 'POST', L, { cookie: sessions.pat, body: { name: 'x', from: 'nothing' } });
    await expect('a module id that is not text', 404, 'POST', L, { cookie: sessions.pat, body: { name: 'x', from: { id: 'tagnotes' } } });
    const noTags = await expect('a module that does not use tags', 403, 'POST', L, { cookie: sessions.pat, body: { name: 'x', from: 'todo' } });
    assert.equal(noTags.json.error, 'That module does not use tags.');
    await expect('the admin too', 403, 'POST', L, { cookie: admin, body: { name: 'x', from: 'todo' } });
    assert.ok(!(await call('GET', L, { cookie: admin })).json.tags.some((t) => t.name === 'guest-tag' || t.name === 'x'), 'nothing was made by the refused ones');
  });

  await test('creating without the right: a member whose role lacks the module\'s write is refused, and reading stays', async () => {
    await expect('take edit from members', 200, 'PATCH', '/api/roles/member', { cookie: admin, body: { 'module.tagnotes.edit': false } });
    const r = await expect('view-only member', 403, 'POST', L, { cookie: sessions.sam, body: { name: 'viewer-tag', from: 'tagnotes' } });
    assert.equal(r.json.error, 'Your role can\'t do that in this module.');
    await expect('view-only member finding an existing name is refused too', 403, 'POST', L, { cookie: sessions.sam, body: { name: 'hotel', from: 'tagnotes' } });
    await expect('still reads', 200, 'GET', `${L}?from=tagnotes`, { cookie: sessions.sam });
    assert.equal((await make(sessions.mo, 'moderators-can')).status, 201, 'a moderator holds edit by default');
    await expect('take view from members', 200, 'PATCH', '/api/roles/member', { cookie: admin, body: { 'module.tagnotes.view': false } });
    await expect('no view: no reading through the module', 403, 'GET', `${L}?from=tagnotes`, { cookie: sessions.sam });
    await expect('give view back', 200, 'PATCH', '/api/roles/member', { cookie: admin, body: { 'module.tagnotes.view': true } });
    await expect('give edit back', 200, 'PATCH', '/api/roles/member', { cookie: admin, body: { 'module.tagnotes.edit': true } });
    assert.equal((await make(sessions.sam, 'viewer-tag')).status, 201, 'and the member makes again');
    // a guest given edit in the module still cannot make a tag
    await expect('give guests edit', 200, 'PATCH', '/api/roles/guest', { cookie: admin, body: { 'module.tagnotes.edit': true } });
    await expect('a guest even with edit', 403, 'POST', `${L}${guestS}`, { body: { name: 'guest-tag', from: 'tagnotes' } });
    await expect('take it back', 200, 'PATCH', '/api/roles/guest', { cookie: admin, body: { 'module.tagnotes.edit': false } });
    await expect('turn the module off', 200, 'PATCH', '/api/modules/tagnotes', { cookie: admin, body: { enabled: false } });
    await expect('a module that is off', 404, 'POST', L, { cookie: sessions.pat, body: { name: 'x', from: 'tagnotes' } });
    await expect('and on again', 200, 'PATCH', '/api/modules/tagnotes', { cookie: admin, body: { enabled: true } });
  });

  await test('names that try to carry HTML, or are too long, or are not text, are a 400 with one sentence and change nothing', async () => {
    const before = (await call('GET', L, { cookie: admin })).json.tags.length;
    for (const [label, name] of [['script', '<script>alert(1)</script>'], ['image', '<img src=x onerror=alert(1)>'], ['entity', '&lt;b&gt;'], ['quote', 'a"onmouseover="x'], ['25 characters', 'x'.repeat(25)], ['empty', ''], ['spaces only', '   '], ['zero-width only', '​​'], ['a number', 5], ['null', null], ['a list', ['a']], ['an object', { a: 1 }], ['emoji', '😀'], ['a slash', 'a/b']]) {
      const r = await make(sessions.pat, name);
      assert.equal(r.status, 400, `${label}: ${r.text}`);
      assert.match(r.json.error, /^A tag .+\.$/, label);
    }
    assert.equal((await make(sessions.pat, undefined)).status, 400, 'no name');
    await expect('a free colour', 400, 'POST', L, { cookie: sessions.pat, body: { name: 'fine', color: '#ff0000', from: 'tagnotes' } });
    await expect('a colour that is not text', 400, 'POST', L, { cookie: sessions.pat, body: { name: 'fine', color: { a: 1 }, from: 'tagnotes' } });
    assert.equal((await call('GET', L, { cookie: admin })).json.tags.length, before, 'nothing was made');
    const all = (await call('GET', L, { cookie: admin })).text;
    assert.ok(!/[<>&"'`]/.test(all.replace(/"(id|name|color|tags)"|[{}\[\]:,]/g, '').replace(/"[a-z0-9à-鿿-]*"/g, '')), 'what is read carries no HTML characters');
    // A name that is made safe is stored safe.
    const odd = await make(sessions.pat, '‮Dinner  Plans​');
    assert.equal(odd.status, 201);
    assert.equal(odd.json.tag.name, 'dinner-plans');
    // Size: more than a tag's body is a 413, an array body is just no name.
    const big = await call('POST', L, { cookie: sessions.pat, raw: JSON.stringify({ name: 'x', from: 'tagnotes', pad: 'p'.repeat(2000) }) });
    assert.equal(big.status, 413);
    assert.match(big.json.error, /^That is too big/);
    assert.equal((await call('POST', L, { cookie: sessions.pat, raw: '[1,2]' })).status, 404, 'a list for a body names no module');
    assert.equal((await call('POST', L, { cookie: sessions.pat, raw: '{ not json' })).status, 400, 'a body that is not JSON is the framework\'s 400');
    const cross = await call('POST', L, { cookie: sessions.pat, body: { name: 'cross', from: 'tagnotes' }, headers: { origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' } });
    assert.equal(cross.status, 403, 'a request from another site is refused, as for every write');
  });

  await test('renaming, recolouring and deleting: the permission, moderators and owners by default, the admin always, never a guest', async () => {
    const list = () => call('GET', L, { cookie: admin }).then((r) => r.json.tags);
    const tag = (await list()).find((t) => t.name === 'maps');
    const P = `${L}/${tag.id}`;
    // without it
    await expect('a member', 403, 'PATCH', P, { cookie: sessions.pat, body: { name: 'nope' } });
    await expect('a member deleting', 403, 'DELETE', P, { cookie: sessions.pat });
    await expect('outside the space', 403, 'PATCH', P, { cookie: sessions.out, body: { name: 'nope' } });
    await expect('nobody', 401, 'PATCH', P, { body: { name: 'nope' } });
    await expect('nobody deleting', 401, 'DELETE', P);
    const g = await expect('a guest', 403, 'PATCH', `${P}${guestS}`, { body: { name: 'nope' } });
    assert.match(g.json.error, /^You can't rename, recolour or delete tags/);
    await expect('a guest deleting', 403, 'DELETE', `${P}${guestS}`);
    assert.equal((await list()).find((t) => t.id === tag.id).name, 'maps', 'nothing changed');
    // a member is told 403, not 404, for a tag that is not there: the permission comes first
    await expect('a member, no such tag', 403, 'DELETE', `${L}/nosuchid00`, { cookie: sessions.pat });
    // with it
    const renamed = await expect('the moderator renames', 200, 'PATCH', P, { cookie: sessions.mo, body: { name: 'Routes' } });
    assert.deepEqual(renamed.json.tag, { id: tag.id, name: 'routes', color: '' }, 'the id stays');
    const colored = await expect('the owner recolours', 200, 'PATCH', P, { cookie: sessions.owner, body: { color: 'green' } });
    assert.equal(colored.json.tag.color, 'green');
    await expect('the admin both', 200, 'PATCH', P, { cookie: admin, body: { name: 'maps', color: 'purple' } });
    assert.deepEqual((await list()).find((t) => t.id === tag.id), { id: tag.id, name: 'maps', color: 'purple' });
    await expect('plain again', 200, 'PATCH', P, { cookie: admin, body: { color: '' } });
    await expect('nothing to change', 400, 'PATCH', P, { cookie: admin, body: {} });
    await expect('a name already taken', 409, 'PATCH', P, { cookie: admin, body: { name: 'FOOD' } });
    await expect('a bad name', 400, 'PATCH', P, { cookie: admin, body: { name: '<b>' } });
    await expect('a free colour', 400, 'PATCH', P, { cookie: admin, body: { color: 'red; background:url(x)' } });
    for (const id of ['nosuchid00', 'NOSUCHID00', '..', '__proto__', 'a'.repeat(40), '%2e%2e', 'x']) {
      await expect(`no such tag ${id}`, 404, 'PATCH', `${L}/${id}`, { cookie: admin, body: { name: 'zzz' } });
      await expect(`no such tag ${id} (delete)`, 404, 'DELETE', `${L}/${id}`, { cookie: admin });
    }
    // the owner may take the permission from moderators, and give it to members; the admin stays able
    await expect('take it from moderators', 200, 'PATCH', '/api/roles/moderator', { cookie: admin, body: { manageTags: false } });
    await expect('a moderator without it', 403, 'PATCH', P, { cookie: sessions.mo, body: { name: 'nope' } });
    await expect('an owner still can', 200, 'PATCH', P, { cookie: sessions.owner, body: { color: 'blue' } });
    await expect('the admin still can', 200, 'PATCH', P, { cookie: admin, body: { color: 'red' } });
    await expect('give moderators it back', 200, 'PATCH', '/api/roles/moderator', { cookie: admin, body: { manageTags: true } });
    await expect('give it to members', 200, 'PATCH', '/api/roles/member', { cookie: admin, body: { manageTags: true } });
    await expect('a member with it', 200, 'PATCH', P, { cookie: sessions.pat, body: { color: 'teal' } });
    await expect('but not in a space they are not in', 403, 'PATCH', P, { cookie: sessions.out, body: { color: 'blue' } });
    await expect('take it from members', 200, 'PATCH', '/api/roles/member', { cookie: admin, body: { manageTags: false } });
    const noGuests = await expect('guests can never have it', 400, 'PATCH', '/api/roles/guest', { cookie: admin, body: { manageTags: true } });
    assert.match(noGuests.json.error, /Guests can never have/);
    await expect('a member who is not a moderator here (sam)', 403, 'PATCH', P, { cookie: sessions.sam, body: { name: 'nope' } });
    // another space's moderator has it in theirs only
    await expect('a moderator of one space is nobody in another', 403, 'GET', `/api/spaces/${T}/tags`, { cookie: sessions.mo });
    // delete
    await expect('the moderator deletes', 204, 'DELETE', P, { cookie: sessions.mo });
    assert.ok(!(await list()).some((t) => t.id === tag.id), 'gone');
    await expect('again is a 404', 404, 'DELETE', P, { cookie: sessions.mo });
    await expect('a module that does not use tags may not be the caller', 403, 'DELETE', `${L}/nosuchid00?from=todo`, { cookie: admin });
    await expect('a caller that is named and fine', 404, 'DELETE', `${L}/nosuchid00?from=tagnotes`, { cookie: admin });
    // the 404 leaks nothing: a deleted tag's id is not a tag
    assert.deepEqual((await call('GET', L, { cookie: sessions.pat })).json.tags.filter((t) => t.id === tag.id), []);
  });

  await test('spaces are separate: a tag of one space cannot be read, renamed or deleted through another', async () => {
    const mine = (await make(admin, 'only-in-trip')).json.tag;
    const M = `/api/spaces/${T}/tags`;
    assert.deepEqual((await call('GET', M, { cookie: admin })).json.tags, [], 'the other space\'s list does not hold it');
    await expect('rename through the other space', 404, 'PATCH', `${M}/${mine.id}`, { cookie: admin, body: { name: 'taken-over' } });
    await expect('delete through the other space', 404, 'DELETE', `${M}/${mine.id}`, { cookie: admin });
    assert.equal((await call('GET', L, { cookie: admin })).json.tags.find((t) => t.id === mine.id)?.name, 'only-in-trip', 'untouched');
    // the same name in the other space is another tag
    const other = await call('POST', M, { cookie: admin, body: { name: 'only-in-trip', from: 'tagnotes' } });
    assert.equal(other.status, 201);
    assert.notEqual(other.json.tag.id, mine.id);
    await expect('the other space\'s member makes there', 201, 'POST', M, { cookie: sessions.out, body: { name: 'mine', from: 'tagnotes' } });
    await expect('but not in the first', 403, 'POST', L, { cookie: sessions.out, body: { name: 'mine', from: 'tagnotes' } });
    assert.deepEqual((await call('GET', `${M}${guestT}`)).json.tags.map((t) => t.name), ['mine', 'only-in-trip'], 'its guest reads its list');
    assert.ok(!(await call('GET', `${M}${guestT}`)).text.includes(mine.id), 'and not the first space\'s');
  });

  await test('the module stream tells the space\'s people of a tag made, changed or removed, and nobody else', async () => {
    const listen = async (query, headers) => {
      const ac = new AbortController();
      let text = '';
      const res = await fetch(`http://127.0.0.1:${server.port}/api/modules/stream${query}`, { headers: { accept: 'text/event-stream', ...headers }, signal: ac.signal });
      assert.equal(res.status, 200);
      (async () => { try { for await (const c of res.body) text += Buffer.from(c).toString('utf8'); } catch { /* closed */ } })();
      return { text: () => text, stop: () => ac.abort() };
    };
    const member = await listen(`?space=${S}`, { cookie: sessions.sam });
    const guest = await listen(`?space=${S}&guest=${encodeURIComponent(guestS.slice(7))}`, {});
    const outsider = await listen(`?space=${S}`, { cookie: sessions.out });
    const elsewhere = await listen(`?space=${T}`, { cookie: sessions.out });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await wait(300);
    const t = (await make(sessions.pat, 'streamed', { color: 'pink' })).json.tag;
    await call('PATCH', `${L}/${t.id}`, { cookie: sessions.mo, body: { name: 'streamed-2' } });
    await call('DELETE', `${L}/${t.id}`, { cookie: sessions.mo });
    await wait(600);
    const events = (text) => [...text.matchAll(/event: tags\ndata: (.+)\n/g)].map((m) => JSON.parse(m[1]));
    for (const [who, l] of [['a member', member], ['a guest of the space', guest]]) {
      const got = events(l.text());
      assert.deepEqual(got.map((e) => [e.op, e.spaceId, e.tag.id, e.tag.name]), [['added', S, t.id, 'streamed'], ['changed', S, t.id, 'streamed-2'], ['removed', S, t.id, 'streamed-2']], `${who} hears all three`);
      assert.deepEqual(Object.keys(got[0]).sort(), ['op', 'spaceId', 'tag'], 'and only the tag, the op and the space');
      assert.deepEqual(Object.keys(got[0].tag).sort(), ['color', 'id', 'name']);
    }
    assert.deepEqual(events(outsider.text()), [], 'someone not in the space hears nothing of it, though their stream asked for it');
    assert.deepEqual(events(elsewhere.text()), [], 'nor does another space\'s stream');
    for (const l of [member, guest, outsider, elsewhere]) l.stop();
  });

  await test('a write limit like the module\'s other writes: 429 with Retry-After and one sentence', async () => {
    const codes = [];
    let last = null;
    for (let i = 0; i < 260; i += 1) {
      last = await make(sessions.sam, 'hotel');
      codes.push(last.status);
      if (last.status === 429) break;
    }
    assert.equal(codes.at(-1), 429, 'a flood is slowed');
    assert.ok(codes.length > 100 && codes.slice(0, -1).every((c) => c === 200), 'but ordinary use is far under it');
    assert.match(last.headers['retry-after'] || '', /^\d+$/);
    assert.match(last.json.error, /is busy\. Wait \d+ seconds? and it will carry on\.$/);
    const other = await make(sessions.pat, 'hotel');
    assert.equal(other.status, 200, 'it is counted per person');
  });

  await test('200 to a list is a 409; the Lobby and an aside\'s id have no such list', async () => {
    const U = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Big list', members: [pat.key] } })).json.space.id;
    const Q = `/api/spaces/${U}/tags`;
    for (let i = 0; i < 200; i += 1) {
      const r = await call('POST', Q, { cookie: admin, body: { name: `t${i}`, from: 'tagnotes' } });
      assert.equal(r.status, 201, `${i}: ${r.text}`);
    }
    const full = await expect('the 201st', 409, 'POST', Q, { cookie: admin, body: { name: 'one-more', from: 'tagnotes' } });
    assert.match(full.json.error, /200 tags/);
    assert.equal((await call('POST', Q, { cookie: admin, body: { name: 'T7', from: 'tagnotes' } })).status, 200, 'an existing one is still found');
    assert.equal((await call('GET', Q, { cookie: sessions.pat })).json.tags.length, 200);
    await expect('delete one', 204, 'DELETE', `${Q}/${(await call('GET', Q, { cookie: admin })).json.tags[0].id}`, { cookie: admin });
    assert.equal((await call('POST', Q, { cookie: admin, body: { name: 'one-more', from: 'tagnotes' } })).status, 201);
    await expect('no such space for an aside', 404, 'GET', '/api/spaces/aside-1234/tags', { cookie: admin });
    // the space is deleted: its list goes with it
    const file = path.join(dataDir, 'tags.json');
    assert.ok(fs.readFileSync(file, 'utf8').includes(U));
    await expect('delete the space', 200, 'DELETE', `/api/spaces/${U}`, { cookie: admin });
    assert.ok(!fs.readFileSync(file, 'utf8').includes(U), 'tags.json no longer names the erased space');
    await expect('and it is gone', 404, 'GET', Q, { cookie: admin });
    assert.ok(fs.readFileSync(file, 'utf8').includes(S), 'the other spaces keep theirs');
  });

  await test('the list is kept across a restart, and a restore of the file is read as sound', async () => {
    const before = (await call('GET', L, { cookie: admin })).json.tags;
    const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'tags.json'), 'utf8'));
    assert.ok(stored.spaces[S].length >= before.length);
    assert.ok(!JSON.stringify(stored).match(/<|>|&/), 'no HTML in the stored file');
    await server.stop();
    server = await startServer(dataDir);
    const sam2 = await sessionOf('sam', 'memberpass1234');
    assert.deepEqual((await request(server, '', 'GET', L, { cookie: sam2 })).json.tags, before, 'the same list after a restart');
  });
} catch (err) {
  failed += 1;
  console.error(`check-tags: the server part: ${err.stack || err.message}`);
  if (server) console.error(server.output());
} finally {
  if (server) await server.stop();
}

// --- Part 3: two environments ----------------------------------------------------------------------------------------

const HOST_LOGIN = 'boss';
const HOST_PASSWORD = 'host-password-1234';
const hostDir = tmp('hosted');
let hosted = null;
try {
  hosted = await startServer(hostDir, { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: HOST_LOGIN, ADMIN_PASSWORD: HOST_PASSWORD });
  const cookieOf = (res) => [].concat(res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  const hostLogin = await request(hosted, 'admin', 'POST', '/api/host/login', { body: { login: HOST_LOGIN, password: HOST_PASSWORD } });
  assert.equal(hostLogin.status, 200, hostLogin.text);
  const hostCookie = cookieOf(hostLogin);
  for (const slug of ['alpha', 'beta']) {
    const made = await request(hosted, 'admin', 'POST', '/api/host/environments', { cookie: hostCookie, body: { slug, name: slug, owner: { login: 'owner', password: 'owner-password-1' } } });
    assert.equal(made.status, 201, made.text);
  }
  const into = async (slug) => {
    const r = await request(hosted, slug, 'POST', '/api/login', { body: { login: HOST_LOGIN, password: HOST_PASSWORD } });
    assert.equal(r.status, 200, `${slug}: the host admin signs in: ${r.text}`);
    return cookieOf(r);
  };
  const alpha = await into('alpha');
  const beta = await into('beta');
  await installTagModule(hosted, 'alpha', alpha, work);
  await installTagModule(hosted, 'beta', beta, work);
  const spaceIn = async (slug, cookie) => (await request(hosted, slug, 'POST', '/api/spaces', { cookie, body: { name: 'Trip' } })).json.space.id;
  const sa = await spaceIn('alpha', alpha);
  const sb = await spaceIn('beta', beta);
  await test('another environment cannot read or touch a tag, even with the space\'s id; the same space id there is its own list', async () => {
    const tag = await request(hosted, 'alpha', 'POST', `/api/spaces/${sa}/tags`, { cookie: alpha, body: { name: 'alpha-only', from: 'tagnotes' } });
    assert.equal(tag.status, 201, tag.text);
    const read = (slug, cookie, space) => request(hosted, slug, 'GET', `/api/spaces/${space}/tags`, { cookie });
    assert.deepEqual((await read('alpha', alpha, sa)).json.tags.map((t) => t.name), ['alpha-only']);
    assert.equal((await read('beta', beta, sa)).status, 404, 'alpha\'s space is not there in beta');
    assert.deepEqual((await read('beta', beta, sb)).json, { tags: [] }, 'beta\'s own list holds nothing of alpha\'s');
    assert.equal((await read('beta', alpha, sb)).status, 401, 'alpha\'s session is nothing in beta');
    assert.equal((await request(hosted, 'beta', 'PATCH', `/api/spaces/${sb}/tags/${tag.json.tag.id}`, { cookie: beta, body: { name: 'mine-now' } })).status, 404, 'alpha\'s tag id is not a tag in beta');
    assert.equal((await request(hosted, 'beta', 'DELETE', `/api/spaces/${sb}/tags/${tag.json.tag.id}`, { cookie: beta })).status, 404);
    assert.equal((await request(hosted, 'beta', 'PATCH', `/api/spaces/${sa}/tags/${tag.json.tag.id}`, { cookie: beta, body: { name: 'mine-now' } })).status, 404);
    // the Lobby has the same id in every environment: it is still each one's own
    assert.deepEqual((await read('beta', beta, 'lobby')).json, { tags: [] });
    assert.deepEqual((await read('alpha', alpha, sa)).json.tags.map((t) => t.name), ['alpha-only'], 'and alpha\'s is untouched');
    const files = ['alpha', 'beta'].map((s) => path.join(hostDir, 'environments', s, 'tags.json'));
    assert.ok(fs.existsSync(files[0]) && !fs.existsSync(files[1]), 'each environment keeps its own file');
  });
} catch (err) {
  failed += 1;
  console.error(`check-tags: the hosted part: ${err.stack || err.message}`);
  if (hosted) console.error(hosted.output());
} finally {
  if (hosted) await hosted.stop();
}

for (const d of [dataDir, hostDir, work]) fs.rmSync(d, { recursive: true, force: true });
if (failed) {
  console.error(`check-tags: ${failed} failed`);
  process.exit(1);
}
console.log(`check-tags: ${n} groups OK`);
