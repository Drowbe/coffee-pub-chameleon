#!/usr/bin/env node
/*
 * check-tags-sdk.mjs -- host.tags, the SDK half of the shared tags (documentation/plans/plan-tags.md, "SDK"; step 2).
 *
 * Runs on its own, no browser and no server: it slices the real source out of public/sdk/host.js (makeTags), public/module-host.js
 * (the bridge's tags.list and tags.add, cleanTag, the 'tags' stream event) and public/space-setup.js (the Tags section) and runs it
 * against stand-ins, and reads the rest as text. What it holds:
 *   - the tones are the theme's eight tints, the same list in the server (TONES), the SDK, the bridge and the toolbar's TINT;
 *   - the bridge lets only a module whose manifest says "tags": true in, only in a space, asks the server on its behalf
 *     (`from`) and passes on only a tag of the right shape; the mounts hand the flag over; for-space sends it;
 *   - the stream's 'tags' event reaches only a module that opted in, for its own space, cleaned;
 *   - the SDK keeps the list current from the event, chip() draws a name with textContent, filterOptions() gives a toolbar's options
 *     in the tag's tint, add() refuses a colour that is not a tint before asking, and a server refusal reaches the module as it came;
 *   - no tag text goes through innerHTML (SDK, bridge, Set up);
 *   - Set up's Tags section calls the server's routes, asks before deleting, and shows the server's sentence.
 *
 *   node tools/check-tags-sdk.mjs
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { TONES } = require('../server/tags.js');
const rd = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const slice = (file, from, to) => {
  const src = rd(file);
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  if (a === -1 || b === -1) { console.error(`check-tags-sdk: could not find "${from}" ... "${to}" in ${file}`); process.exit(1); }
  return src.slice(a, b + to.length);
};
let failed = 0;
let n = 0;
const pending = [];
const test = (name, fn) => {
  const bad = (err) => { failed += 1; console.error(`check-tags-sdk: ${name}: ${err.stack || err.message}`); };
  try { const r = fn(); if (r && typeof r.then === 'function') pending.push(r.then(() => { n += 1; }, bad)); else n += 1; } catch (err) { bad(err); }
};

const host = rd('public/sdk/host.js');
const bridge = rd('public/module-host.js');
const setup = rd('public/space-setup.js');
const css = rd('public/sdk/system.css');
const makeSrc = slice('public/sdk/host.js', "  const TAG_TONES = [", '  host.tags = makeTags();');

test('the tones are the theme\'s eight tints, one list everywhere', () => {
  const tints = ['gold', 'blue', 'green', 'teal', 'purple', 'red', 'orange', 'pink'];
  assert.deepEqual([...TONES].sort(), [...tints].sort(), 'server TONES');
  const list = (src, name) => new Function(`${src}\nreturn ${name};`)();
  assert.deepEqual([...list(makeSrc.slice(0, makeSrc.indexOf('\n', makeSrc.indexOf('const TAG_TONES'))), 'TAG_TONES')].sort(), [...tints].sort(), 'SDK TAG_TONES');
  assert.deepEqual([...list(slice('public/module-host.js', 'export const TAG_TONES = Object.freeze([', ']);').replace('export ', ''), 'TAG_TONES')].sort(), [...tints].sort(), 'bridge TAG_TONES');
  assert.match(rd('public/module-chrome.js'), /const TINT = \/\^\(gold\|blue\|green\|teal\|purple\|red\|orange\|pink\)\$\/;/, 'the toolbar takes the same eight');
  assert.match(setup, /const TAG_TONES = \['gold', 'blue', 'green', 'teal', 'purple', 'red', 'orange', 'pink'\];/, 'Set up offers the same eight');
  for (const t of tints) assert.ok(css.includes(`[data-tag-tone="${t}"] { --chip-tone: var(--tint-${t}); }`), `system.css draws ${t}`);
  assert.equal(/data-tag-tone="[^"]*"\][^}]*#[0-9a-f]{3,8}/i.test(css), false, 'no raw colour for a tag tone');
});

const cleanSrc = slice('public/module-host.js', 'export const TAG_TONES', 'export const cleanTagList = (list) => (Array.isArray(list) ? list : []).slice(0, 200).map(cleanTag).filter(Boolean);').replace(/export /g, '');
const { cleanTag, cleanTagList } = new Function(`${cleanSrc}\nreturn { cleanTag, cleanTagList };`)();

test('the bridge passes on only a tag of the right shape', () => {
  assert.deepEqual(cleanTag({ id: 'abcd1234ef', name: 'ski-trip', color: 'blue', by: 'x', at: 'y' }), { id: 'abcd1234ef', name: 'ski-trip', color: 'blue' });
  assert.deepEqual(cleanTag({ id: 'abcd1234ef', name: 'été', color: 'pink-ish' }), { id: 'abcd1234ef', name: 'été', color: '' }, 'a colour that is not a tint is plain');
  for (const bad of [null, 'x', [], {}, { id: 'ABCD1234', name: 'a' }, { id: 'abc', name: 'a' }, { id: 'abcd1234ef', name: '' }, { id: 'abcd1234ef', name: '<b>x</b>' },
    { id: 'abcd1234ef', name: 'a&b' }, { id: 'abcd1234ef', name: 'x'.repeat(25) }, { id: 'abcd1234ef', name: 'a b' }, { id: 'abcd1234ef', name: 7 }, { id: '../../etc/pass', name: 'a' }]) {
    assert.equal(cleanTag(bad), null, JSON.stringify(bad));
  }
  assert.equal(cleanTagList(new Array(500).fill({ id: 'abcd1234ef', name: 'a' })).length, 200);
  assert.deepEqual(cleanTagList('nope'), []);
});

test('the bridge: only a module that says "tags": true, only in a space, on its own behalf, as a guest with the pass', async () => {
  const handlers = slice('public/module-host.js', "    async 'tags.list'() {", "      return tag;\n    },");
  const place = slice('public/module-host.js', '  const tagsPlace = () => {', '\n  };');
  const make = (module, scope, spaceId, keyed, guestToken, api) => new Function('module', 'scope', 'spaceId', 'keyed', 'guestToken', 'api', 'word', 'cleanTag', 'cleanTagList', 'URLSearchParams',
    `${place}\nreturn { ${handlers} };`)(module, scope, spaceId, keyed, guestToken, api, (w, o) => (o && o.a ? 'a space' : w), cleanTag, cleanTagList, URLSearchParams);
  const calls = [];
  const api = async (method, url, body) => { calls.push({ method, url, body }); return method === 'GET' ? { tags: [{ id: 'abcd1234ef', name: 'a', color: 'red' }, { id: 'bad', name: '<i>' }] } : { tag: { id: 'abcd1234ef', name: 'ski', color: '' } }; };
  const h = make({ id: 'docs', tags: true }, 'space', 'sp1', null, null, api);
  assert.deepEqual(await h['tags.list'](), [{ id: 'abcd1234ef', name: 'a', color: 'red' }], 'a malformed tag is left out');
  assert.equal(calls[0].url, '/api/spaces/sp1/tags?from=docs');
  assert.deepEqual(await h['tags.add']({ name: 'ski', color: 'blue' }), { id: 'abcd1234ef', name: 'ski', color: '' });
  assert.deepEqual(calls[1], { method: 'POST', url: '/api/spaces/sp1/tags', body: { from: 'docs', name: 'ski', color: 'blue' } }, 'the module is named by the host, never by the module');
  await h['tags.add']({ name: 'ski' });
  assert.equal('color' in calls[2].body, false);
  await assert.rejects(() => h['tags.add']({ name: 5 }), (e) => e.status === 400);
  const g = make({ id: 'docs', tags: true }, 'space', 'sp1', null, 'g tok/1', api);
  await g['tags.list']();
  assert.equal(calls.at(-1).url, '/api/spaces/sp1/tags?from=docs&guest=g+tok%2F1');
  await g['tags.add']({ name: 'x' });
  assert.equal(calls.at(-1).url, '/api/spaces/sp1/tags?guest=g%20tok%2F1');
  const before = calls.length;
  for (const [what, bad, status] of [['no flag', make({ id: 'docs' }, 'space', 'sp1', null, null, api), 403], ['flag false', make({ id: 'docs', tags: false }, 'space', 'sp1', null, null, api), 403],
    ['flag as text', make({ id: 'docs', tags: 'true' }, 'space', 'sp1', null, null, api), 403], ['environment page', make({ id: 'docs', tags: true }, 'environment', null, null, null, api), 400],
    ['keyed page', make({ id: 'docs', tags: true }, 'space', 'sp1', { path: 'x' }, null, api), 400]]) {
    await assert.rejects(() => bad['tags.list'](), (e) => e.status === status, `list: ${what}`);
    await assert.rejects(() => bad['tags.add']({ name: 'a' }), (e) => e.status === status, `add: ${what}`);
  }
  assert.equal(calls.length, before, 'a refused call never reached the server');
  // A server refusal reaches the module as the server said it.
  const refused = make({ id: 'docs', tags: true }, 'space', 'sp1', null, null, async () => { throw Object.assign(new Error('This list already holds 200 tags. Delete one first.'), { status: 409 }); });
  await assert.rejects(() => refused['tags.add']({ name: 'a' }), (e) => e.status === 409 && /200 tags/.test(e.message));
});

test('the bridge: the mounts hand the flag over and for-space sends it; the stream event reaches only an opted-in module in its space', () => {
  assert.match(rd('public/canvas.js'), /module: \{ id: m\.id, version: m\.version, scope: m\.scope, budget: m\.budget === true, tags: m\.tags === true, content: m\.content \},/);
  assert.match(rd('public/module.js'), /module: \{ id: mod\.id, version: mod\.version, scope: mod\.scope, budget: mod\.budget === true, tags: mod\.tags === true, content: mod\.content \},/);
  assert.match(rd('server/index.js'), /budget: manifest\.budget === true, tags: manifest\.tags === true, scope: manifest\.scope, runMode/, 'GET /api/modules/for-space says which modules opted in');
  assert.match(rd('public/module-stream.js'), /STREAM_TYPES = Object\.freeze\(\[[^\]]*'tags'[^\]]*\]\)/, 'the shared stream listens for it, or the event never leaves the page (public/module-stream.js)');
  const ev = slice('public/module-host.js', "    if (type === 'tags') {", '      return;\n    }');
  assert.match(ev, /module\.tags === true && scope === 'space' && spaceId && d && d\.spaceId === spaceId && tag && TAG_OPS\.includes\(d\.op\)/);
  assert.ok(bridge.indexOf("if (type === 'tags') {") < bridge.indexOf("if (type !== 'bus' && type !== 'action'"), 'handled before the module filter, which would drop it');
  const run = (module, scope, spaceId, d) => {
    const sent = [];
    new Function('module', 'scope', 'spaceId', 'send', 'cleanTag', 'TAG_OPS', 'd', 'type', `${ev.replace(/return;\n    }$/, '}')}`)(module, scope, spaceId, (e, x) => sent.push([e, x]), cleanTag, ['added', 'changed', 'removed'], d, 'tags');
    return sent;
  };
  const tag = { id: 'abcd1234ef', name: 'ski', color: 'red', by: 'secret' };
  assert.deepEqual(run({ tags: true }, 'space', 'sp1', { op: 'added', spaceId: 'sp1', tag }), [['tags', { op: 'added', tag: { id: 'abcd1234ef', name: 'ski', color: 'red' } }]]);
  assert.deepEqual(run({ tags: false }, 'space', 'sp1', { op: 'added', spaceId: 'sp1', tag }), [], 'a module that did not opt in');
  assert.deepEqual(run({ tags: true }, 'space', 'sp1', { op: 'added', spaceId: 'sp2', tag }), [], 'another space');
  assert.deepEqual(run({ tags: true }, 'environment', null, { op: 'added', spaceId: 'sp1', tag }), [], 'an environment page');
  assert.deepEqual(run({ tags: true }, 'space', 'sp1', { op: 'explode', spaceId: 'sp1', tag }), [], 'an unknown op');
  assert.deepEqual(run({ tags: true }, 'space', 'sp1', { op: 'added', spaceId: 'sp1', tag: { id: 'abcd1234ef', name: '<script>' } }), [], 'a tag of the wrong shape');
});

// A stand-in for the SDK around makeTags: the call to the page, the event bus, the DOM it draws a chip with.
function sdkWith(callImpl) {
  const listeners = new Map();
  const hostStub = { on: (e, fn) => { if (!listeners.has(e)) listeners.set(e, new Set()); listeners.get(e).add(fn); }, util: { word: () => 'object' }, tags: null };
  const el = () => ({ className: '', dataset: {}, children: [], textContent: '', appendChild(c) { this.children.push(c); return c; } });
  const document = { createElement: () => el() };
  const calls = [];
  const call = async (m, p) => { calls.push([m, p]); return callImpl(m, p); };
  const make = new Function('host', 'call', 'readyPromise', 'document', 'openMenu', 'closeMenu', 'editorAt', 'env', 'menuStep', 'window', `${makeSrc}\nreturn host.tags;`);
  hostStub.tags = make(hostStub, call, Promise.resolve(), document, null, () => {}, () => null, { root: document, rootElement: {} }, () => 0, {});
  return { tags: hostStub.tags, calls, hear: (e, d) => { for (const fn of listeners.get(e) || []) fn(d); }, listeners };
}
const T = (id, name, color = '') => ({ id, name, color });

test('host.tags: list is kept and current; chip uses textContent; filterOptions are toolbar options in the tag\'s tint', async () => {
  const s = sdkWith(async (m) => (m === 'tags.list' ? [T('aaaaaaaa11', 'zebra', 'red'), T('bbbbbbbb22', 'apple'), { id: 'x', name: '<b>' }] : null));
  assert.equal(s.tags.chip('aaaaaaaa11'), null, 'before list() there is nothing to draw');
  const list = await s.tags.list();
  assert.deepEqual(list.map((t) => t.name), ['apple', 'zebra'], 'in name order, a bad shape left out');
  await s.tags.list();
  assert.equal(s.calls.filter(([m]) => m === 'tags.list').length, 1, 'kept, not asked again');
  const chip = s.tags.chip('aaaaaaaa11');
  assert.equal(chip.className, 'sdk-chip-tag');
  assert.equal(chip.dataset.tone, 'custom');
  assert.equal(chip.dataset.tagTone, 'red');
  assert.equal(chip.children[0].textContent, 'zebra', 'the name is text');
  assert.equal(s.tags.chip('bbbbbbbb22').dataset.tone, 'neutral');
  assert.equal(s.tags.chip('nope0000'), null, 'a dead id');
  assert.equal(s.tags.chip({}), null);
  assert.deepEqual(s.tags.filterOptions({ aaaaaaaa11: 3, bbbbbbbb22: 0, cccccccc33: 9 }), [
    { id: 'bbbbbbbb22', label: 'apple', default: false, count: 0 },
    { id: 'aaaaaaaa11', label: 'zebra', default: false, count: 3, tint: 'red' },
  ], 'only tags that are counts, in name order; a plain tag has no tint');
  assert.deepEqual(s.tags.filterOptions(new Map([['bbbbbbbb22', 2]])).map((o) => o.id), ['bbbbbbbb22']);
  assert.deepEqual(s.tags.filterOptions(null), []);
  // The event first, then the module's: rename, recolour, delete, add.
  s.hear('tags', { op: 'changed', tag: T('bbbbbbbb22', 'banana', 'teal') });
  assert.equal(s.tags.chip('bbbbbbbb22').children[0].textContent, 'banana');
  assert.equal(s.tags.chip('bbbbbbbb22').dataset.tagTone, 'teal');
  s.hear('tags', { op: 'removed', tag: T('aaaaaaaa11', 'zebra', 'red') });
  assert.equal(s.tags.chip('aaaaaaaa11'), null);
  s.hear('tags', { op: 'added', tag: T('dddddddd44', 'new') });
  assert.deepEqual((await s.tags.list()).map((t) => t.name), ['banana', 'new']);
  s.hear('tags', { op: 'added', tag: { id: 'zz', name: '<i>' } });
  s.hear('tags', { op: 'weird', tag: T('eeeeeeee55', 'no') });
  assert.equal((await s.tags.list()).length, 2, 'a bad event changes nothing');
  assert.equal((await s.tags.list({ fresh: true })).length, 2);
  assert.equal(s.calls.filter(([m]) => m === 'tags.list').length, 2, 'fresh asks again');
  assert.equal(s.listeners.get('tags').size, 1, 'the SDK listens once, first');
});

test('host.tags.add asks the page, refuses a colour that is not a tint before asking, and keeps what it made', async () => {
  const s = sdkWith(async (m, p) => (m === 'tags.list' ? [] : { id: 'ffffffff66', name: p.name, color: p.color }));
  await s.tags.list();
  const t = await s.tags.add('ski', { color: 'blue' });
  assert.deepEqual(t, T('ffffffff66', 'ski', 'blue'));
  assert.deepEqual(s.calls.at(-1), ['tags.add', { name: 'ski', color: 'blue' }]);
  assert.equal(s.tags.chip('ffffffff66').children[0].textContent, 'ski');
  const asked = s.calls.length;
  await assert.rejects(() => s.tags.add('x', { color: '#ff0000' }), (e) => e.status === 400);
  await assert.rejects(() => s.tags.add('x', { color: 'chartreuse' }), (e) => e.status === 400);
  await assert.rejects(() => s.tags.add(42), (e) => e.status === 400);
  assert.equal(s.calls.length, asked, 'nothing was asked');
  const refusing = sdkWith(async (m) => { if (m === 'tags.add') throw Object.assign(new Error("Your role can't do that in this module."), { status: 403 }); return []; });
  await assert.rejects(() => refusing.tags.add('a'), (e) => e.status === 403 && e.message === "Your role can't do that in this module.");
  const junk = sdkWith(async (m) => (m === 'tags.add' ? { id: 'x', name: '<script>' } : []));
  await assert.rejects(() => junk.tags.add('a'), (e) => e.status === 502);
});

test('no tag text goes through innerHTML, and the picker is the SDK\'s own pieces', () => {
  assert.equal(/innerHTML|insertAdjacentHTML|outerHTML/.test(makeSrc), false, 'makeTags');
  assert.equal(/innerHTML|insertAdjacentHTML/.test(slice('public/module-host.js', "    async 'tags.list'() {", "      return tag;\n    },")), false, 'the bridge');
  const tagsSet = slice('public/space-setup.js', '  const TAG_TONES = [', '  // The Modules tab (id `show`)');
  assert.equal(/innerHTML|insertAdjacentHTML/.test(tagsSet.replace(/function tagsSectionHtml[\s\S]*?\n  }\n/, '')), false, 'Set up\'s Tags section (its fixed intro aside)');
  assert.match(makeSrc, /menu\.className = 'sdk-menu sdk-tag-picker'/, 'the menu surface');
  assert.match(makeSrc, /search\.className = 'sdk-search'/, 'the search field');
  assert.match(makeSrc, /b\.className = 'sdk-menu-item'/, 'the menu item');
  assert.match(makeSrc, /openMenu = \{\s*id: 'tags-picker'/, 'one menu or picker at a time');
  assert.match(makeSrc, /dot\.className = 'sdk-chip-dot'/);
  assert.match(makeSrc, /text\.textContent = label;/);
  assert.match(makeSrc, /said = \(err && err\.message\)/, 'a refusal is the server\'s sentence');
  assert.equal(/#[0-9a-fA-F]{3,8}\b|rgb\(/.test(makeSrc), false, 'no raw colour in the SDK piece');
});

test('Set up\'s Tags section: the server\'s routes, asked before deleting, the server\'s sentence, not for the Lobby', () => {
  const src = slice('public/space-setup.js', '  const TAG_TONES = [', '  // The Modules tab (id `show`)');
  assert.match(src, /api\('PATCH', tagsPath\(spaceId, tag\.id\), patch\)/);
  assert.match(src, /api\('DELETE', tagsPath\(spaceId, tag\.id\)\)/);
  assert.match(src, /api\('GET', tagsPath\(space\.id\)\)/);
  assert.ok(src.indexOf('confirmDialog(') < src.indexOf("api('DELETE'"), 'asks first');
  assert.match(src, /kind: 'destructive'/);
  assert.match(src, /takes it off everything that uses it|taken off everything that uses it/);
  assert.match(src, /tagsSay\(err\.message, true\)/);
  assert.match(setup, /if \(!state\.space\.isLobby\) parts\.push\(tagsSectionHtml\(\)\);/);
  assert.match(setup, /loadModuleSettings\(space\); if \(!space\.isLobby\) loadTags\(space\);/);
  assert.match(src, /name\.value = t\.name;/);
  assert.match(src, /chip\.textContent = t\.name;/);
  assert.equal(/\.post|POST/.test(src), false, 'a tag is made from a module\'s picker, not here');
});

test('the SDK documents host.tags where the other pieces are, and a module can find the event', () => {
  assert.match(host, /host\.tags = makeTags\(\);/);
  assert.match(host, /host\.on\('tags', \(\{ op, tag \}\)/);
});

await Promise.all(pending);
if (failed) process.exit(1);
console.log(`check-tags-sdk: OK (${n} groups)`);
