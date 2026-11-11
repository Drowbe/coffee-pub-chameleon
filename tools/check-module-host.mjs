#!/usr/bin/env node
/*
 * check-module-host.mjs -- the pointer shape modules and the host agree on, run on its own.
 *
 * Since plan-names step 5c a module speaks the server's names directly: a pointer is
 * { module, kind, id, scope: 'space' | 'environment' | 'person', space? }, and nothing translates between an old and a
 * new shape. Two places check a pointer's shape before it goes anywhere: the page side (public/module-host.js,
 * REF_SHAPE and cleanPointer) and the SDK in the module (public/sdk/host.js, cleanRef). This slices those few lines out
 * of each and checks that they accept the one shape, keep only its own fields, and refuse the old one (scope 'room'
 * with `room`, scope 'server'): the hard break of decision 2.
 *
 *   node tools/check-module-host.mjs
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

function slice(file, startMark, endMark) {
  const src = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const start = src.indexOf(startMark);
  const end = src.indexOf(endMark, start);
  if (start === -1 || end === -1) {
    console.error(`check-module-host: could not find "${startMark}" ... "${endMark}" in ${file}`);
    process.exit(1);
  }
  return src.slice(start, end + endMark.length);
}

const hostSrc = slice('public/module-host.js', 'const REF_SHAPE', 'const cleanPointer = (r) => ({ module: r.module, kind: r.kind, id: r.id, scope: r.scope, ...(r.scope === \'space\' ? { space: r.space } : {}) });');
const { REF_SHAPE, cleanPointer } = new Function(`${hostSrc}\nreturn { REF_SHAPE, cleanPointer };`)();
const sdkSrc = slice('public/sdk/host.js', 'function cleanRef(ref) {', '\n  }\n');
const cleanRef = new Function(`${sdkSrc}\nreturn cleanRef;`)();

const { changeStamp } = new Function(`${slice('public/module-host.js', 'export function changeStamp(d) {', '\n}\n').replace('export ', '')}\nreturn { changeStamp };`)();
let failed = 0;
let n = 0;
const pending = [];
const test = (name, fn) => {
  const bad = (err) => { failed += 1; console.error(`check-module-host: ${name}: ${err.message}`); };
  try { const r = fn(); if (r && typeof r.then === 'function') pending.push(r.then(() => { n += 1; }, bad)); else n += 1; } catch (err) { bad(err); }
};
const base = { module: 'todo', kind: 'task', id: 'abc' };
const inSpace = { ...base, scope: 'space', space: 'gq2zb7pq' };

// host.library.add sends who may see a file as given: a shape the server does not know is refused or passed on, never turned into "no word"
// (which the server reads as everyone). Run the handler's own lines up to the request, with the request stubbed.
test('library.add never sends a visibility that is not a word as no visibility', async () => {
  const src = slice('public/module-host.js', "async 'library.add'({ file, name, keepPosition, visibility, people, token }) {", "const target = libraryUrl(");
  const body = src.slice(src.indexOf('{', src.indexOf('token })')) + 1, src.lastIndexOf('const target = libraryUrl('));
  const lib = slice('public/module-host.js', 'const libraryUrl = (path = \'\', extra = {}) => {', '\n  };');
  class Blob {}
  // The URL the server would get: through the handler's own libraryUrl, which drops empty values (an empty word would otherwise read as everyone).
  const run = new Function('Blob', 'Object', 'URLSearchParams', `const scope = 'space'; const spaceId = 'sp1'; const base = '/api/modules/vault'; const word = () => 'a space'; ${lib}
    return async (file, visibility, people) => { ${body} return libraryUrl('', { name: 'n', keepPosition: '', ...who }); };`)(Blob, Object, URLSearchParams);
  for (const bad of [null, ['only-me'], 7, { a: 1 }, true, '', 'x'.repeat(21)]) await assert.rejects(() => run(new Blob(), bad), (e) => e.status === 400, `visibility ${JSON.stringify(bad)} reached the server as no word`);
  for (const bad of [null, 'a,b', { 0: 'a' }, [1], new Array(202).fill('k')]) await assert.rejects(() => run(new Blob(), 'people', bad), (e) => e.status === 400, `people ${JSON.stringify(bad)} was passed on`);
  const q = async (...a) => new URL(await run(new Blob(), ...a), 'http://x').searchParams;
  assert.equal((await q(undefined, undefined)).has('visibility'), false);
  assert.equal((await q('only-me', undefined)).get('visibility'), 'only-me');
  const pp = await q('people', ['a', 'b']);
  assert.equal(pp.get('visibility'), 'people'); assert.equal(pp.get('people'), 'a,b');
});
test('library.pickPeople takes the adder from the page and asks the library gate first', () => {
  const src = slice('public/module-host.js', "async 'library.pickPeople'({ chosen }) {", 'returnFocus: () => holder });');
  assert.ok(src.indexOf("api('GET', libraryUrl())") > 0 && src.indexOf("api('GET', libraryUrl())") < src.indexOf('loadMembers'), 'the library gate must come before the people are read');
  assert.match(src, /api\('GET', '\/api\/me'\)/, 'the adder must be read from the page\'s own sign-in');
  assert.ok(!/\badder\b[^:]*\}\)/.test(src.split('\n')[0]), 'the handler must not take an adder from the module');
  assert.ok(!/call\('library\.pickPeople', \{[^}]*adder/.test(fs.readFileSync(new URL('../public/sdk/host.js', import.meta.url), 'utf8')), 'host.js must not send an adder');
});

test('a pointer in a space, the environment or a person is accepted by both sides', () => {
  for (const p of [inSpace, { ...base, scope: 'environment' }, { ...base, scope: 'person' }]) {
    assert.ok(REF_SHAPE(p), `module-host refused ${JSON.stringify(p)}`);
    assert.deepEqual(cleanRef(p), p);
    assert.deepEqual(cleanPointer(p), p);
  }
});
test('each side keeps only the pointer\'s own fields, and a place only for a space', () => {
  const extra = { ...inSpace, title: 'not part of a pointer', room: 'old' };
  assert.deepEqual(cleanRef(extra), inSpace);
  assert.deepEqual(cleanPointer(extra), inSpace);
  assert.deepEqual(cleanRef({ ...base, scope: 'environment', space: 'x' }), { ...base, scope: 'environment' });
  assert.deepEqual(cleanPointer({ ...base, scope: 'environment', space: 'x' }), { ...base, scope: 'environment' });
});
test('the old shape is refused, not translated', () => {
  for (const p of [{ ...base, scope: 'room', room: 'gq2zb7pq' }, { ...base, scope: 'server' }, { ...base, scope: 'rooms' }, { ...base, scope: 'room', space: 'gq2zb7pq' }]) {
    assert.equal(Boolean(REF_SHAPE(p)), false, `module-host accepted ${JSON.stringify(p)}`);
    assert.equal(cleanRef(p), null, `the SDK accepted ${JSON.stringify(p)}`);
  }
});
test('a space pointer needs its space, of a sane length', () => {
  for (const p of [{ ...base, scope: 'space' }, { ...base, scope: 'space', space: 7 }, { ...base, scope: 'space', space: 'x'.repeat(65) }]) {
    assert.equal(Boolean(REF_SHAPE(p)), false);
    assert.equal(cleanRef(p), null);
  }
});
test('nothing is left of the old translation (WIRE_SCOPE, toSdk, toWire)', () => {
  const src = fs.readFileSync(new URL('../public/module-host.js', import.meta.url), 'utf8');
  for (const name of ['WIRE_SCOPE', 'SDK_SCOPE', 'toSdk', 'toWire', 'pointersIn']) assert.equal(src.includes(name), false, `${name} is still in module-host.js`);
});

// Where a module's call goes (placeOf in public/module-host.js; plan-calendar-destination, "SDK and the host"): a module's
// environment page may name one of the viewer's spaces with { space } (to read and write there, the server deciding), a
// mount in a space reaches only its own space, and the rules that were there before still hold.
{
  const src = slice('public/module-host.js', 'const SPACE_ID', '\n  return { scope: \'space\', space };\n}\n');
  const placeOf = new Function(`${src}\nreturn placeOf;`)();
  const env = { scope: 'environment', spaceId: null, moduleScopes: ['environment', 'space'] };
  const inSpace = { scope: 'space', spaceId: 'gq2zb7pq', moduleScopes: ['environment', 'space'] };
  const refused = (fn, re) => assert.throws(fn, (err) => err.status === 400 && (!re || re.test(err.message)));
  test('an environment page names a space with { space }, with or without scope "space"', () => {
    assert.deepEqual(placeOf(undefined, 'abc123', env), { scope: 'space', space: 'abc123' });
    assert.deepEqual(placeOf('context', 'abc123', env), { scope: 'space', space: 'abc123' });
    assert.deepEqual(placeOf('space', 'abc123', env), { scope: 'space', space: 'abc123' });
  });
  test('an environment page without a space stays in the environment, and reads across spaces as before', () => {
    assert.deepEqual(placeOf(undefined, undefined, env), { scope: 'environment', space: null });
    assert.deepEqual(placeOf('environment', null, env), { scope: 'environment', space: null });
    assert.deepEqual(placeOf('spaces', undefined, env), { scope: 'spaces', space: null });
    refused(() => placeOf('space', undefined, env), /not in a space/);
  });
  test('a space mount keeps to its own space and refuses another', () => {
    assert.deepEqual(placeOf(undefined, undefined, inSpace), { scope: 'space', space: 'gq2zb7pq' });
    assert.deepEqual(placeOf('space', undefined, inSpace), { scope: 'space', space: 'gq2zb7pq' });
    assert.deepEqual(placeOf(undefined, 'gq2zb7pq', inSpace), { scope: 'space', space: 'gq2zb7pq' });
    assert.deepEqual(placeOf('environment', undefined, inSpace), { scope: 'environment', space: null });
    refused(() => placeOf(undefined, 'other1', inSpace), /another space/);
    refused(() => placeOf('space', 'other1', inSpace), /another space/);
    refused(() => placeOf('spaces', undefined, inSpace), /environment page/);
  });
  test('a space goes only with scope "space", must look like an id, and needs a module with the space scope', () => {
    refused(() => placeOf('environment', 'abc123', env), /scope "space"/);
    refused(() => placeOf('spaces', 'abc123', env), /scope "space"/);
    refused(() => placeOf('person', 'abc123', { ...env, moduleScopes: ['environment', 'space', 'person'] }), /scope "space"/);
    for (const bad of ['a b', 'x'.repeat(65), '../x', 7]) refused(() => placeOf(undefined, bad, env), /not a space/);
    refused(() => placeOf(undefined, 'abc123', { ...env, moduleScopes: ['environment'] }), /no space scope/);
  });
  test('the person scope and the old names are as before', () => {
    refused(() => placeOf('person', undefined, env), /no personal scope/);
    assert.deepEqual(placeOf('person', undefined, { ...env, moduleScopes: ['environment', 'person'] }), { scope: 'person', space: null });
    for (const old of ['server', 'room', 'rooms']) refused(() => placeOf(old, undefined, env), /old name/);
    refused(() => placeOf('everywhere', undefined, env), /not one of/);
  });
  test('storage, schedule, notify and links pass the space on (module-host.js and the SDK)', () => {
    const host = fs.readFileSync(new URL('../public/module-host.js', import.meta.url), 'utf8');
    for (const call of ['storage.get', 'storage.set', 'storage.delete', 'storage.list', 'cancelSchedule']) {
      const at = host.indexOf(`async ${call.includes('.') ? `'${call}'` : call}(`);
      assert.ok(at > 0, `${call} is in module-host.js`);
      assert.match(host.slice(at, host.indexOf('\n    },', at)), /scopeOf\(s, space\)/, `${call} passes { space }`);
    }
    for (const call of ['schedule', 'notify']) {
      const at = host.indexOf(`async ${call}(spec)`);
      assert.match(host.slice(at, host.indexOf('\n    },', at)), /scopeOf\(spec\?\.scope, spec\?\.space\)[^\n]*space: undefined/, `${call} passes { space } and keeps it out of the body`);
    }
    assert.ok(host.includes("async 'objects.setLinks'({ from, to, space, kind, op })"), 'setLinks takes { space } (and the optional kind and op)');
    const setLinks = host.slice(host.indexOf("async 'objects.setLinks'"), host.indexOf("async 'objects.links'"));
    assert.match(setLinks, /scopeOf\('space', space === undefined/, 'setLinks checks the given { space } against the pointer\'s');
    const sdk = fs.readFileSync(new URL('../public/sdk/host.js', import.meta.url), 'utf8');
    assert.ok(sdk.includes("const opts = (o) => ({ scope: (o && o.scope) || 'context', ...(o && o.space ? { space: String(o.space) } : {}) });"), 'the SDK passes { space }');
  });
}

// host.objects.search (objectSearchParams in public/module-host.js; plan-map-destination, "SDK and the host"): an
// environment page may search every space at once and ask only for summaries with a place; a space mount may not.
{
  const placeSrc = slice('public/module-host.js', 'const SPACE_ID', '\n  return { scope: \'space\', space };\n}\n');
  const src = slice('public/module-host.js', 'function objectSearchParams(', '// --- end of the search');
  const objectSearchParams = new Function(`${placeSrc}\n${src}\nreturn objectSearchParams;`)();
  const env = { scope: 'environment', spaceId: null, moduleScopes: ['environment', 'space'] };
  const inSpace = { scope: 'space', spaceId: 'gq2zb7pq', moduleScopes: ['environment', 'space'] };
  const q = (o, mount) => Object.fromEntries(objectSearchParams('maps', o, mount));
  const refused = (fn) => assert.throws(fn, (err) => err.status === 400);
  test('search: an environment page asks every space at once, and only for places', () => {
    assert.deepEqual(q({ q: '', scope: 'spaces', has: 'place' }, env), { from: 'maps', q: '', scope: 'spaces', has: 'place' });
    assert.deepEqual(q({ q: 'cafe', scope: 'spaces' }, env), { from: 'maps', q: 'cafe', scope: 'spaces' });
  });
  test('search: a space mount, or a keyed page, cannot ask across spaces', () => {
    refused(() => q({ scope: 'spaces' }, inSpace));
    refused(() => q({ scope: 'spaces' }, { ...env, keyed: true }));
    refused(() => q({ scope: 'spaces', space: 'abc123' }, env));
  });
  test('search: one place as before, has only "place"', () => {
    assert.deepEqual(q({ q: 'x' }, inSpace), { from: 'maps', q: 'x', scope: 'space', space: 'gq2zb7pq' });
    assert.deepEqual(q({ q: 'x', scope: 'environment', has: 'place' }, inSpace), { from: 'maps', q: 'x', scope: 'environment', has: 'place' });
    assert.deepEqual(q({ scope: 'person' }, inSpace), { from: 'maps', q: '', scope: 'person' });
    assert.deepEqual(q({ space: 'abc123' }, env), { from: 'maps', q: '', scope: 'space', space: 'abc123' });
    refused(() => q({ space: 'other1' }, inSpace));
    refused(() => q({ has: 'date' }, env));
  });
}

// host.actions.list with the object a drop is about (decision 21): the host passes the pointer on, cleaned, and the drop
// asks with the dropped object, so the server lists only what can be done in that object's own place.
test('actions.list passes a valid ref on, cleaned, and drops a bad one; the drop menu asks with the dropped object', () => {
  const src = fs.readFileSync(new URL('../public/module-host.js', import.meta.url), 'utf8');
  const at = src.indexOf("async 'actions.list'(");
  const body = src.slice(at, src.indexOf('\n    },', at));
  const run = new Function('REF_SHAPE', 'cleanPointer', `return (${body.replace("async 'actions.list'", 'function')}\n    });`.replace(/\(await api\('GET', `\/api\/bus\/actions\?\$\{busQuery\(\{ from: module\.id, \.\.\.extra \}\)\}`\)\)\.actions\.map\(\(a\) => \(\{ \.\.\.a, open: openInPage\(a\.module\) \}\)\)/, 'extra'));
  const list = run(REF_SHAPE, cleanPointer);
  const ref = { module: 'todo', kind: 'task', id: 'list', scope: 'space', space: 'gq2zb7pq', title: 'x' };
  assert.deepEqual(list({ accepts: 'todo:task', ref }), { accepts: 'todo:task', ref: JSON.stringify({ module: 'todo', kind: 'task', id: 'list', scope: 'space', space: 'gq2zb7pq' }) });
  assert.deepEqual(list({ accepts: 'todo:task', ref: { module: 'todo', scope: 'room' } }), { accepts: 'todo:task' });
  assert.deepEqual(list({}), {});
  const sdk = fs.readFileSync(new URL('../public/sdk/host.js', import.meta.url), 'utf8');
  assert.ok(sdk.includes("list: (o) => call('actions.list', { accepts: o && o.accepts, self: Boolean(o && o.self), ref: o && o.ref }),"), 'the SDK passes ref');
  assert.ok(sdk.includes('host.actions.list({ accepts: `${d.ref.module}:${d.ref.kind}`, ref: d.ref })'), 'a drop asks with the dropped object');
});

// A destination's shared state (createDestination in public/module-host.js): the page sets what it owns, every part
// hears every change, and a part may set only what its destination lets it (the calendar: main sets the day and the
// period; the map: either part selects).
{
  const src = slice('public/module-host.js', '// --- destinations', '// --- end of destinations').replace('export function createDestination', 'function createDestination');
  const createDestination = new Function(`${hostSrc}\n${src}\nreturn createDestination;`)();
  const listen = (hub, part) => { const got = []; hub.join(part, (s) => got.push(s)); return got; };
  const status = (fn, code) => assert.throws(fn, (err) => err.status === code);
  test('the calendar: the page\'s state reaches every part, and only main sets the day and the period', () => {
    const hub = createDestination('calendar', { view: 'month', spaces: ['a1'], environment: true });
    const main = listen(hub, 'main');
    const panel = listen(hub, 'panel');
    const page = [];
    hub.onChange((s) => page.push(s));
    hub.update({ view: 'week' });
    assert.equal(main.at(-1).view, 'week');
    assert.equal(panel.at(-1).view, 'week');
    const period = { day: '2026-10-02', from: '2026-09-27', to: '2026-10-04' };
    hub.fromPart('main', period);
    assert.deepEqual(panel.at(-1), { view: 'week', spaces: ['a1'], environment: true, ...period });
    assert.deepEqual(main.at(-1), panel.at(-1));
    assert.equal(page.length, 2);
    status(() => hub.fromPart('panel', { day: '2026-10-03' }), 403);
    status(() => hub.fromPart('main', { view: 'day' }), 403);
    status(() => hub.fromPart('main', { selected: null }), 403);
    status(() => hub.fromPart('main', { reveal: 'panel' }), 403); // the calendar's parts do not ask
    status(() => hub.fromPart('main', { day: '2 October' }), 400);
    status(() => hub.fromPart('main', 'day'), 400);
    assert.equal(hub.state.day, '2026-10-02');
    hub.fromPart('main', { day: '2026-10-02' }); // nothing changed: nobody is told again
    assert.equal(panel.length, 2);
  });
  // The kinds of markers the calendar has shown (plan-calendar-markers.md), for the page's filter: main only, checked.
  test('the calendar: main tells the page the kinds of markers it shows, in shape; the panel cannot', () => {
    const hub = createDestination('calendar', { view: 'month' });
    const panel = listen(hub, 'panel');
    const kinds = [{ id: 'todo:task', label: 'Tasks due', icon: 'list-check', tint: 'green' }, { id: 'polls:poll', label: ' Polls closing ', icon: 'Bad Icon', tint: 'plaid', extra: 1 }];
    hub.fromPart('main', { markerKinds: kinds });
    assert.deepEqual(panel.at(-1).markerKinds, [{ id: 'todo:task', label: 'Tasks due', icon: 'list-check', tint: 'green' }, { id: 'polls:poll', label: 'Polls closing', icon: 'calendar-check', tint: null }]);
    hub.fromPart('main', { markerKinds: [] });
    assert.deepEqual(hub.state.markerKinds, []);
    status(() => hub.fromPart('panel', { markerKinds: [] }), 403);
    status(() => hub.fromPart('main', { markerKinds: 'todo:task' }), 400);
    status(() => hub.fromPart('main', { markerKinds: [{ id: 'no kind', label: 'x' }] }), 400);
    status(() => hub.fromPart('main', { markerKinds: [{ id: 'todo:task', label: '  ' }] }), 400);
    status(() => hub.fromPart('main', { markerKinds: Array.from({ length: 21 }, (_, i) => ({ id: `m${i}:k`, label: 'K' })) }), 400);
  });
  test('the map: either part selects, with a pointer or null, and a part that left hears nothing', () => {
    const hub = createDestination('map', { q: '' });
    const main = listen(hub, 'main');
    const got = [];
    const leave = hub.join('panel', (s) => got.push(s));
    const place = { module: 'places', kind: 'place', id: 'p1', scope: 'space', space: 'gq2zb7pq', title: 'not a pointer field' };
    hub.fromPart('panel', { selected: place });
    assert.deepEqual(main.at(-1).selected, { module: 'places', kind: 'place', id: 'p1', scope: 'space', space: 'gq2zb7pq' });
    hub.fromPart('main', { selected: null });
    assert.equal(got.at(-1).selected, null);
    status(() => hub.fromPart('main', { selected: { module: 'places', kind: 'place', id: 'p1', scope: 'room', room: 'x' } }), 400);
    status(() => hub.fromPart('panel', { day: '2026-10-02' }), 403);
    // Either part may ask the page to show a part (a phone's tabs); nothing else, and never the page's own `phone`.
    hub.fromPart('main', { reveal: 'panel' });
    assert.equal(main.at(-1).reveal, 'panel');
    status(() => hub.fromPart('main', { reveal: 'sideways' }), 400);
    status(() => hub.fromPart('panel', { phone: true }), 403);
    leave();
    hub.update({ q: 'cafe' });
    assert.equal(got.length, 3);
    assert.equal(main.at(-1).q, 'cafe');
  });
  test('an unknown destination is refused', () => {
    assert.throws(() => createDestination('kitchen'));
  });
  test('a part is told the destination and its state in the hello, and mounting checks the part', () => {
    const host = fs.readFileSync(new URL('../public/module-host.js', import.meta.url), 'utf8');
    // Every module hears the environment's name (decision 19: Where and the filter name the environment's own alike).
    assert.ok(host.includes('environment: { name: envName }'), 'the hello carries info.context.environment.name');
    assert.ok(/fetch\('\/api\/branding'\)/.test(host), 'from the public branding, asked once per page');
    for (const piece of ['destination: { id: destination.hub.id, part: destination.part }', 'destinationState: destination.hub.state', 'part is "main" or "panel"', 'destination.hub.join(destination.part,', 'leaveDestination();']) {
      assert.ok(host.includes(piece), `module-host.js has ${piece}`);
    }
    assert.ok(/async 'destination\.set'\(\{ patch \}\) \{\n\s+if \(!destination\)/.test(host), 'destination.set refuses a mount that is not a part');
  });
}

// host.presence.get (presenceForModule in public/module-host.js): a person's place as the viewer may know it (plan-primary-nav
// step 3) reaches the module: `aside` and `elsewhere` pass through, and `activeSpace` may be null.
{
  const src = slice('public/module-host.js', 'function presenceForModule(d) {', '\n}\n');
  const presenceForModule = new Function(`${src}\nreturn presenceForModule;`)();
  test('presence: aside, asidePrivate (only with an aside) and elsewhere pass through, and nothing else of the person', () => {
    const p = presenceForModule({ users: [
      { key: 'a', displayName: 'Ana', online: true, space: 'as1', aside: true, asidePrivate: true, elsewhere: false, inCall: true, isOwner: false, secret: 'x' },
      { key: 'b', displayName: 'Bo', online: true, space: null, aside: false, asidePrivate: true, elsewhere: true, inCall: false },
      { key: 'c', displayName: 'Cy', online: false, space: 'sp1' },
    ], activeSpace: null });
    assert.deepEqual(p.people, [
      { key: 'a', name: 'Ana', online: true, space: 'as1', aside: true, asidePrivate: true, elsewhere: false, inCall: true, isOwner: false },
      { key: 'b', name: 'Bo', online: true, space: null, aside: false, asidePrivate: false, elsewhere: true, inCall: false, isOwner: false },
      { key: 'c', name: 'Cy', online: false, space: 'sp1', aside: false, asidePrivate: false, elsewhere: false, inCall: false, isOwner: false },
    ]);
  });
  test('presence: activeSpace null, missing or a space id', () => {
    assert.equal(presenceForModule({ activeSpace: null }).activeSpace, null);
    assert.equal(presenceForModule({}).activeSpace, null);
    assert.equal(presenceForModule({ activeSpace: 'sp1' }).activeSpace, 'sp1');
    assert.deepEqual(presenceForModule({}).people, []);
  });
}

// A module's own window (public/module.js): Clear in the title bar's "..." runs clearModuleData, a top-level function.
// It once used start()'s local `scope` and failed with "scope is not defined". Run it with only the page's top-level
// names (id, spaceId, guestToken, api) and check what it asks the server to clear.
{
  const clearSrc = slice('public/module.js', 'async function clearModuleData() {', '\n}\n');
  const clearFor = (spaceId, guestToken) => {
    const calls = [];
    const api = async (method, url) => { calls.push([method, url]); };
    // clearWithUndo (public/module-host.js) sends the DELETE (the server holds what went for its Undo): here, that DELETE.
    const clearWithUndo = async (moduleId, query) => { calls.push(['DELETE', `/api/modules/${moduleId}/data?${query}`]); return null; };
    const fn = new Function('id', 'spaceId', 'guestToken', 'api', 'clearWithUndo', `${clearSrc}\nreturn clearModuleData;`)('todo', spaceId, guestToken, api, clearWithUndo);
    return fn().then(() => calls.map(([method, url]) => [method, url.replace(/&tz=[^&]*/, '')]));
  };
  const cases = [
    ['a module\'s window in a space clears that space', ['gq2zb7pq', null], [['DELETE', '/api/modules/todo/data?scope=space&space=gq2zb7pq']]],
    ['a guest\'s window in a space carries the guest token', ['gq2zb7pq', 'tok'], [['DELETE', '/api/modules/todo/data?scope=space&space=gq2zb7pq&guest=tok']]],
    ['a module\'s window with no space clears the environment\'s data', [null, null], [['DELETE', '/api/modules/todo/data?scope=environment']]],
  ];
  for (const [name, args, want] of cases) {
    try { assert.deepEqual(await clearFor(...args), want); n += 1; } catch (err) { failed += 1; console.error(`check-module-host: Clear in ${name}: ${err.message}`); }
  }
}

// Push to talk in a space (public/space.js, typing to onKey): its key, Space by default, once took Space away from a
// focused button or host-menu entry, and the mic could stay open when the key's release never reached the page. Run the
// sliced handlers against stand-in elements: Space presses a control reached by keyboard and any menu entry, and talks
// on the page, on a link or on a button just clicked; releasing it always stops talking, wherever focus went and
// whatever modifier came down meanwhile; the window losing focus or being hidden stops it too; and every document that
// hears the keys also hears where focus came from and when its window goes away.
{
  const src = slice('public/space.js', '// Whether the key went to a text field.', '\n  event.preventDefault();\n}\n');
  // public/hotkeys.js's rule, without its navigator: the code, and exactly the combo's modifiers.
  const hotkeyMatches = (event, combo) => {
    const parts = combo.split('+');
    const code = parts.pop();
    return event.code === code && event.shiftKey === parts.includes('Shift') && event.ctrlKey === parts.includes('Ctrl') && event.altKey === parts.includes('Alt') && event.metaKey === parts.includes('Meta');
  };
  const el = (tagName, role, parent) => {
    const e = { tagName, role, parent, isContentEditable: false };
    e.matches = (sel) => sel.split(',').map((s) => s.trim()).some((s) => {
      const m = /^\[role=([a-z]+)\]$/.exec(s);
      return m ? e.role === m[1] : s.toUpperCase() === e.tagName;
    });
    e.closest = (sel) => { for (let at = e; at; at = at.parent) if (at.matches(sel)) return at; return null; };
    e.contains = (other) => { for (let at = other; at; at = at.parent) if (at === e) return true; return false; };
    return e;
  };
  const listening = () => {
    const heard = {};
    return { heard, addEventListener(type, fn) { (heard[type] ||= []).push(fn); } };
  };
  const run = (steps, pttKey, inSpace = true, inCall = true, isAway = false) => {
    const mic = [];
    const doc = { ...listening(), visibilityState: 'visible', body: { classList: { contains: (c) => inSpace && c === 'in-space' } } };
    const win = listening();
    const h = new Function('document', 'window', 'prefs', 'call', 'hotkeyMatches', 'reflectMic', 'inCall', 'isAway', `let pttHeld = false;\n${src}\nreturn { onKey, onKeyUp };`)(
      doc, win, { ptt: true, pttKey, muteKey: 'Mod+KeyD', camKey: 'Mod+KeyE' }, { localParticipant: { setMicrophoneEnabled: (on) => { mic.push(on); return Promise.resolve(); } } }, hotkeyMatches, () => {}, inCall, isAway);
    const prevented = [];
    for (const [type, target, code = pttKey, extra = {}] of steps) {
      if (type === 'blur' || type === 'pagehide') { for (const fn of win.heard[type] || []) fn({ type, target: win }); continue; }
      if (type === 'hidden' || type === 'visible') { doc.visibilityState = type; for (const fn of doc.heard.visibilitychange || []) fn({ type: 'visibilitychange', target: doc }); continue; }
      const event = { type, code, key: code === 'Space' ? ' ' : code.replace(/(Left|Right)$/, ''), repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
        ...extra, target, composedPath: () => [target], preventDefault() { prevented.push(type); } };
      // As in the browser: a key goes to the window's capture listeners first, then the page's; pointer presses and
      // focus to what the document hears.
      if (type === 'keydown') { for (const fn of win.heard.keydown || []) fn(event); h.onKey(event); } else if (type === 'keyup') h.onKeyUp(event);
      else for (const fn of doc.heard[type] || []) fn(event);
    }
    return { mic, prevented };
  };
  const body = el('BODY');
  const button = el('BUTTON', null, body);
  const icon = el('I', null, button);
  const menu = el('DIV', 'menu', body);
  const entry = el('BUTTON', 'menuitem', menu);
  const talks = { mic: [true, false], prevented: ['keydown', 'keyup'] };
  const leaves = { mic: [], prevented: [] };
  const press = (target, code) => [['keydown', target, code], ['keyup', target, code]];
  const tabTo = (target) => [['keydown', body, 'Tab'], ['focusin', target]];
  const click = (target, focused = target) => [['pointerdown', target], ['focusin', focused]];
  const link = el('A', null, body);
  const shift = { shiftKey: true };
  const cases = [
    ['Space on the page talks', press(body), talks],
    ['Space on a button reached by keyboard presses it', [...tabTo(button), ...press(button)], leaves],
    ['Space on a [role=button] reached by keyboard presses it', (() => { const b = el('DIV', 'button', body); return [...tabTo(b), ...press(b)]; })(), leaves],
    ['Space on a <summary> reached by keyboard presses it', (() => { const b = el('SUMMARY', null, body); return [...tabTo(b), ...press(b)]; })(), leaves],
    ['Space on a menu entry picks it, even when the menu was opened by a click', [...click(icon, button), ['focusin', entry], ...press(entry)], leaves],
    ['Space on a menu entry just pressed with the mouse picks it', [...click(icon, button), ['focusin', entry], ...click(entry), ...press(entry)], leaves],
    ['Space on a button reached by keyboard, then clicked, talks (the click moves no focus)', [...tabTo(button), ['pointerdown', icon], ...press(button)], talks],
    ['Space on a button just clicked talks (clicking the mic, then holding Space)', [...click(icon, button), ...press(button)], talks],
    ['Space after a menu entry picked by mouse talks (the menu gives its button focus back by script)', [...click(icon, button), ['focusin', entry], ...click(entry), ['focusin', button], ...press(button)], talks],
    ['Space after a menu closed by Escape presses its button again', [...tabTo(button), ['keydown', button, 'Enter'], ['focusin', entry], ['keydown', entry, 'Escape'], ['focusin', button], ...press(button)], leaves],
    ['Space on a button clicked, then tabbed away from and back to, presses it', [...click(icon, button), ...tabTo(el('BUTTON', null, body)), ...tabTo(button), ...press(button)], leaves],
    ['Space on a link talks (Space does not follow a link)', [...tabTo(link), ...press(link)], talks],
    ['Space in a text field types', press(el('INPUT', null, body)), leaves],
    ['a push-to-talk key a button does not use still talks on a button', [...tabTo(button), ...press(button, 'KeyT')], talks, 'KeyT'],
    ['Enter as the push-to-talk key presses a focused button', [...tabTo(button), ...press(button, 'Enter')], leaves, 'Enter'],
    ['Enter as the push-to-talk key talks on a link', [...tabTo(link), ...press(link, 'Enter')], talks, 'Enter'],
    ['push to talk does nothing outside a space', press(body), leaves, 'Space', false],
    // In a space but not in the call (entering never joins): holding the key must not open the microphone.
    ['push to talk does nothing out of the call', press(body), leaves, 'Space', true, false],
    ['push to talk does nothing out of the call, the key held and the window losing focus', [['keydown', body], ['blur'], ['hidden'], ['keyup', body]], leaves, 'Space', true, false],
    ['releasing after focus moved into a text field stops talking', [['keydown', body], ['keyup', el('INPUT', null, body)]], talks],
    ['releasing after focus moved onto a button stops talking', [['keydown', body], ['keyup', button]], talks],
    ['releasing with Shift pressed meanwhile stops talking', [['keydown', body], ['keydown', body, 'ShiftLeft', shift], ['keyup', body, 'Space', shift], ['keyup', body, 'ShiftLeft']], talks],
    ['releasing Shift+Space (the key set so) without Shift stops talking', [['keydown', body, 'Space', shift], ['keyup', body, 'ShiftLeft'], ['keyup', body, 'Space']], talks, 'Shift+Space'],
    ['a held key keeps talking through repeats, another key and the page coming back into view', [['keydown', body], ['keydown', body, 'Space', { repeat: true }], ['keydown', body, 'ShiftLeft', shift], ['keyup', body, 'ShiftLeft'], ['visible']], { mic: [true], prevented: ['keydown', 'keydown'] }],
    ['the window losing focus while the key is held stops talking', [['keydown', body], ['blur'], ['keyup', body]], { mic: [true, false], prevented: ['keydown'] }],
    ['the page hidden while the key is held stops talking', [['keydown', body], ['hidden']], { mic: [true, false], prevented: ['keydown'] }],
    ['the page going away while the key is held stops talking', [['keydown', body], ['pagehide']], { mic: [true, false], prevented: ['keydown'] }],
    ['the window losing focus with the key up changes nothing, and the next press talks', [['blur'], ['hidden'], ['visible'], ...press(body)], talks],
    // Away, nobody hears you (setAway): the key is the page's still (no scrolling), but it opens nothing.
    ['push to talk opens nothing while away', press(body), { mic: [], prevented: ['keydown'] }, 'Space', true, true, true],
  ];
  for (const [name, steps, want, pttKey = 'Space', inSpace = true, inCall = true, isAway = false] of cases) {
    try { assert.deepEqual(run(steps, pttKey, inSpace, inCall, isAway), want); n += 1; } catch (err) { failed += 1; console.error(`check-module-host: push to talk, ${name}: ${err.message.split('\n')[0]}`); }
  }
  test('every document that hears the call\'s keys hears pointer presses and focus, and its window going away, too (the page and both pop-outs)', () => {
    const page = fs.readFileSync(new URL('../public/space.js', import.meta.url), 'utf8');
    const count = (re) => (page.match(re) || []).length;
    const keys = count(/addEventListener\('keydown', onKey\)/g);
    assert.equal(keys, 3, 'keydown listeners');
    assert.equal(count(/addEventListener\('keyup', onKeyUp\)/g), keys, 'keyup listeners');
    assert.equal(count(/addEventListener\('keydown', noteKey, true\)/g), keys, 'keydown capture listeners');
    assert.equal(count(/addEventListener\('pointerdown', notePointer, true\)/g), keys, 'pointerdown listeners');
    assert.equal(count(/addEventListener\('focusin', noteFocus, true\)/g), keys, 'focusin listeners');
    assert.equal(count(/addEventListener\('blur', releaseTalk\)/g), keys, 'window blur listeners');
    assert.equal(count(/addEventListener\('pagehide', releaseTalk\)/g), keys, 'pagehide listeners');
    assert.equal(count(/addEventListener\('visibilitychange', releaseWhenHidden\)/g), keys, 'visibilitychange listeners');
  });
}

// The person's own other calendars (plan-google-calendar.md, Part 2): host.external.events asks the module's route with
// only `from` and `to`, and the stream's `external` event reaches only the modules the server named.
await (async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-module-host: ${name}: ${err.message}`); }
})('external: events asks the route with from and to only; the stream event reaches only the modules named', async () => {
  const src = fs.readFileSync(new URL('../public/module-host.js', import.meta.url), 'utf8');
  const at = src.indexOf("async 'external.events'(");
  assert.ok(at > 0, "module-host.js answers 'external.events'");
  const body = src.slice(at, src.indexOf('\n    },', at)).replace("async 'external.events'", 'async function');
  const asked = [];
  const api = async (method, u) => { asked.push([method, u]); return { calendars: [], events: [] }; };
  const url = (path, place, extra) => `${path}?${new URLSearchParams(Object.entries(extra).filter(([, v]) => v !== undefined))}`;
  const make = (externalHere) => new Function('api', 'url', 'scopeOf', 'externalHere', `return (${body}\n    });`)(api, url, () => ({ scope: 'environment' }), externalHere);
  const run = make(true);
  assert.deepEqual(await run({ from: '2026-10-01', to: '2026-11-01', extra: 'no' }), { calendars: [], events: [] });
  await run({});
  assert.deepEqual(asked, [['GET', '/external-events?from=2026-10-01&to=2026-11-01'], ['GET', '/external-events?']]);
  assert.deepEqual(await make(false)({ from: '2026-10-01' }), { calendars: [], events: [] }, 'within a space: none, and nothing asked');
  assert.equal(asked.length, 2);
  const stream = src.slice(src.indexOf("if (type === 'external') {"), src.indexOf("if (type !== 'bus'", src.indexOf("if (type === 'external') {")));
  const deliver = (moduleId, d, here = true) => { const sent = []; new Function('type', 'd', 'module', 'send', 'externalHere', `${stream}`)('external', d, { id: moduleId }, (e, x) => sent.push([e, x]), here); return sent; };
  assert.deepEqual(deliver('calendar', { modules: ['calendar'] }), [['external', {}]]);
  assert.deepEqual(deliver('calendar', { modules: ['calendar'] }, false), [], 'within a space it is never heard');
  assert.deepEqual(deliver('todo', { modules: ['calendar'] }), []);
  assert.deepEqual(deliver('calendar', {}), []);
  assert.match(fs.readFileSync(new URL('../public/module-stream.js', import.meta.url), 'utf8'), /STREAM_TYPES = Object.freeze\(\[[^\]]*'external'[^\]]*\]\)/, 'the shared stream listens for it (public/module-stream.js)');
  // Never within a space, whatever the scope says (the coordinator's decision for #42 Part 2).
  const rule = new Function(`${slice('public/module-host.js', 'export function externalAllowedHere', '// --- end of externalAllowedHere').replace('export function', 'function')}\nreturn externalAllowedHere;`)();
  assert.equal(rule({ scope: 'environment', search: '' }), true, 'the module\'s own page');
  assert.equal(rule({ scope: 'environment', search: '?' }), true, '/calendar');
  assert.equal(rule({ scope: 'space', search: '' }), false, 'a space\'s canvas');
  assert.equal(rule({ scope: 'environment', overCall: true, search: '?from=space&spaceName=Keep' }), false, 'a page opened over a call');
  assert.equal(rule({ scope: 'environment', search: '?from=space' }), false, 'a page that says it is over a call');
  assert.equal(rule({ scope: 'environment', search: '?space=gq2zb7pq&popout=1' }), false, 'a window popped out of a space');
  assert.equal(rule({ scope: 'environment', keyed: true }), false, 'a keyed page');
  assert.match(src, /const externalHere = externalAllowedHere\(\{ scope, keyed: Boolean\(keyed\), overCall: withinSpacePage\(\), search: location\.search \}\);/, 'each mount asks the rule');
  const sdk = fs.readFileSync(new URL('../public/sdk/host.js', import.meta.url), 'utf8');
  assert.ok(sdk.includes("events: (o) => call('external.events', { from: o && o.from, to: o && o.to }),"), 'the SDK passes from and to');
});

// Markers (plan-calendar-markers.md): host.objects.markers asks the module's own route with `from` and `to` in the
// mount's place, answers the list, and a keyed page asks nothing; the stream's `markers` event reaches only the modules
// the server named, with no data.
await (async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-module-host: ${name}: ${err.message}`); }
})('markers: objects.markers asks the route with from and to; the stream event reaches only the modules named', async () => {
  const src = fs.readFileSync(new URL('../public/module-host.js', import.meta.url), 'utf8');
  const at = src.indexOf("async 'objects.markers'(");
  assert.ok(at > 0, "module-host.js answers 'objects.markers'");
  const body = src.slice(at, src.indexOf('\n    },', at)).replace("async 'objects.markers'", 'async function');
  const asked = [];
  const api = async (method, u) => { asked.push([method, u]); return { markers: [{ title: 'Pack' }] }; };
  const url = (path, place, extra) => `${path}?${new URLSearchParams({ ...place, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)) })}`;
  const make = (keyed) => new Function('api', 'url', 'scopeOf', 'keyed', `return (${body}\n    });`)(api, url, () => ({ scope: 'space', space: 'gq2zb7pq' }), keyed);
  assert.deepEqual(await make(null)({ from: '2026-10-01', to: '2026-10-31', extra: 'no' }), [{ title: 'Pack' }]);
  assert.deepEqual(asked, [['GET', '/markers?scope=space&space=gq2zb7pq&from=2026-10-01&to=2026-10-31']]);
  assert.deepEqual(await make({ path: '/keyed' })({ from: '2026-10-01', to: '2026-10-31' }), [], 'a keyed page has none');
  assert.equal(asked.length, 1);
  const stream = src.slice(src.indexOf("if (type === 'markers') {"), src.indexOf("if (type !== 'bus'", src.indexOf("if (type === 'markers') {")));
  const deliver = (moduleId, d) => { const sent = []; new Function('type', 'd', 'module', 'send', `${stream}`)('markers', d, { id: moduleId }, (e, x) => sent.push([e, x])); return sent; };
  assert.deepEqual(deliver('calendar', { modules: ['calendar'] }), [['markers', {}]]);
  assert.deepEqual(deliver('todo', { modules: ['calendar'] }), []);
  assert.deepEqual(deliver('calendar', {}), []);
  assert.match(fs.readFileSync(new URL('../public/module-stream.js', import.meta.url), 'utf8'), /STREAM_TYPES = Object.freeze\(\[[^\]]*'markers'[^\]]*\]\)/, 'the shared stream listens for it (public/module-stream.js)');
  const sdk = fs.readFileSync(new URL('../public/sdk/host.js', import.meta.url), 'utf8');
  assert.ok(sdk.includes("markers: (o) => call('objects.markers', { from: o && o.from, to: o && o.to }),"), 'the SDK passes from and to');
});

// The lift (plan-editor-window.md, step 11): an editor window in a sandboxed frame asks the host (editor.lift) to lift
// the frame over the canvas. module-host.js answers it for a frame only (false in the page and in a window of its own),
// gives the frame the class, puts a backdrop before it, makes everything else inert the way a modal <dialog> does, and
// puts all of it back on close, when the frame loads another document, and when the mount is destroyed; canvas.js puts
// it back before moving a module; module.js asks for none in a popped-out window.
test('editor.lift: lifts a frame over the page, makes the rest inert and puts it all back', () => {
  const src = fs.readFileSync(new URL('../public/module-host.js', import.meta.url), 'utf8');
  const at = src.indexOf("async 'editor.lift'(");
  assert.ok(at > 0, "module-host.js answers 'editor.lift'");
  const handler = src.slice(at, src.indexOf('\n    },', at));
  assert.ok(handler.includes('if (!lift) return false;') && handler.includes('if (pageMode) return liftUp ?'), 'a module in the page answers false unless it is a composite\'s part (liftUp), and a mount with lift: false is answered false');
  assert.ok(src.includes("frame.addEventListener('load', () => releaseLift());"), 'the frame loading another document puts it back');
  assert.ok(/destroy\(\) \{\n\s+if \(!pageMode\) releaseLift\(\);/.test(src), 'destroy() puts it back');
  assert.ok(src.includes('lift = true, onLift = null, liftUp = null, onChanges = null }) {'), 'mountModule takes lift, onLift, liftUp and onChanges');
  // The lift itself, run on a stand-in page: body > [header, main > [section > [bar, frame], other]].
  const pageStart = src.indexOf('const inertCount = new WeakMap();'); // the page-wide lift state, above mountModule
  const pageEnd = src.indexOf('// A module\'s bands in a frame (createModuleFrame', pageStart);
  assert.ok(pageStart > 0 && pageEnd > pageStart, 'module-host.js has the page-wide lift state');
  assert.ok(src.includes('export function createFrameLift(frame, {'), 'module-host.js has createFrameLift');
  const el = (tag, cls = '') => {
    const e = { tag, classes: new Set(cls.split(' ').filter(Boolean)), dataset: {}, children: [], parentNode: null, inert: false, focused: 0 };
    e.classList = { add: (...c) => c.forEach((x) => e.classes.add(x)), remove: (...c) => c.forEach((x) => e.classes.delete(x)), toggle: (c, on) => (on ? e.classes.add(c) : e.classes.delete(c)), contains: (c) => e.classes.has(c) };
    e.append = (...cs) => cs.forEach((c) => { c.parentNode = e; e.children.push(c); });
    e.insertBefore = (c, ref) => { c.parentNode = e; e.children.splice(ref ? e.children.indexOf(ref) : e.children.length, 0, c); };
    Object.defineProperty(e, 'nextSibling', { get: () => (e.parentNode ? e.parentNode.children[e.parentNode.children.indexOf(e) + 1] || null : null) });
    e.remove = () => { if (e.parentNode) e.parentNode.children = e.parentNode.children.filter((x) => x !== e); e.parentNode = null; };
    e.focus = () => { e.focused += 1; doc.activeElement = e; };
    e.setAttribute = () => {};
    e.addEventListener = () => {};
    e.style = { removeProperty() {}, setProperty() {} };
    Object.defineProperty(e, 'isConnected', { get: () => { let x = e; while (x.parentNode) x = x.parentNode; return x === doc.body; } });
    Object.defineProperty(e, 'className', { get: () => [...e.classes].join(' '), set: (v) => { e.classes = new Set(String(v).split(/\s+/).filter(Boolean)); } });
    return e;
  };
  const doc = { body: el('body'), activeElement: null, createElement: (tag) => el(tag), addEventListener() {}, removeEventListener() {}, defaultView: { innerWidth: 1200, addEventListener() {}, removeEventListener() {} } };
  const [header, main, section, bar, frame, other, floater] = ['header', 'main', 'section', 'div', 'iframe', 'section', 'div'].map((t) => el(t));
  frame.ownerDocument = doc;
  frame.getClientRects = () => [{}]; // on screen: liftFrame refuses a frame that takes no space
  frame.closest = () => null; // not under another lift or a dialog
  doc.body.append(header, main, floater);
  main.append(section, other);
  section.append(bar, frame);
  doc.activeElement = frame;
  const lifts = [];
  const { liftFrame, releaseLift } = new Function('frame', 'onLift', 'mine', 'send', 'MutationObserver', `${src.slice(pageStart, pageEnd).replace('export function createFrameLift', 'function createFrameLift')}\nconst fl = createFrameLift(frame, { mount: mine, tell: () => send('editordismiss', {}), onLift });\nreturn { liftFrame: fl.lift, releaseLift: fl.release };`)(frame, (open, size) => lifts.push([open, size]), { frame }, () => {}, class { observe() {} disconnect() {} });
  releaseLift();
  assert.deepEqual(lifts, [], 'putting back what was never lifted does nothing');
  liftFrame(true, 'large');
  assert.ok(frame.classes.has('module-editor-lifted') && frame.classes.has('module-editor-lifted-large'), 'the frame gets the classes');
  const backdrop = section.children[section.children.indexOf(frame) - 1];
  assert.ok(backdrop && backdrop.classes.has('module-editor-backdrop'), 'div.module-editor-backdrop goes right before the frame');
  assert.deepEqual([header, floater, other, bar].map((x) => x.inert), [true, true, true, true], 'the header, the other modules, the floating layer and the module\'s own bar are inert');
  assert.deepEqual([main, section, frame, backdrop].map((x) => x.inert), [false, false, false, false], 'the frame and its ancestors are not');
  assert.deepEqual(lifts, [[true, 'large']], 'onLift hears the lift');
  liftFrame(true, 'medium');
  assert.ok(!frame.classes.has('module-editor-lifted-large'), 'lifting again sets the size asked');
  assert.equal(section.children.filter((x) => x.classes.has('module-editor-backdrop')).length, 1, 'one backdrop, not two');
  liftFrame(false);
  assert.ok(!frame.classes.has('module-editor-lifted') && !backdrop.parentNode, 'put back: the classes and the backdrop go');
  assert.deepEqual([header, floater, other, bar].map((x) => x.inert), [false, false, false, false], 'nothing is inert any more');
  assert.equal(lifts.at(-1)[0], false, 'onLift hears it');
  assert.equal(frame.focused, 0, 'focus is left where it is');
  // Something already inert before the lift stays inert after it.
  other.inert = true;
  liftFrame(true, 'medium');
  releaseLift();
  assert.equal(other.inert, true, 'what was inert before the lift stays so');
  // A composite's frame (the Calendar's or the Map's page) is lifted over the whole screen and answers with the box it had, so the
  // page stays drawn there behind the editor window (the window was left blank when the frame shrank to the editor's size).
  frame.getBoundingClientRect = () => ({ top: 142, left: 497, right: 1197, bottom: 700 });
  doc.defaultView.innerHeight = 900;
  const cover = new Function('frame', 'MutationObserver', `${src.slice(pageStart, pageEnd).replace('export function createFrameLift', 'function createFrameLift')}\nreturn createFrameLift(frame, { mount: {}, tell() {}, cover: true });`)(frame, class { observe() {} disconnect() {} });
  const got = cover.lift(true, 'medium', 600);
  assert.deepEqual(got.cover, { top: 142, right: 3, bottom: 200, left: 497 }, 'a covering lift answers with the frame\'s box');
  assert.ok(frame.classes.has('module-editor-cover'), 'and marks the frame as covering the screen');
  frame.getBoundingClientRect = () => ({ top: 0, left: 0, right: 1200, bottom: 900 });
  assert.deepEqual(cover.lift(true, 'medium', 900).cover, { top: 142, right: 3, bottom: 200, left: 497 }, 'lifting again keeps the first box');
  cover.release();
  assert.ok(!frame.classes.has('module-editor-cover') && !frame.classes.has('module-editor-lifted'), 'put back: the covering class goes');
  const canvas = fs.readFileSync(new URL('../public/canvas.js', import.meta.url), 'utf8');
  assert.ok(/createFrameLift\(frame, \{[\s\S]*?cover: true,/.test(canvas), 'canvas.js lifts a composite\'s frame with cover');
  assert.ok(/function coverPage\(open, result\)/.test(fs.readFileSync(new URL('../public/destination.js', import.meta.url), 'utf8')), 'the destination page keeps itself in its box while covered');
  assert.ok(/function moveModule\(id, mode\) \{[\s\S]*?mod\.mount\?\.lift\?\.\(false\);[\s\S]*?opened\.delete\(id\);/.test(canvas), 'canvas.js puts the frame back before moving a module');
  assert.ok(canvas.includes('onLift: (open) => {'), 'canvas.js hears the lift (to bring a floating box to the front)');
  const page = fs.readFileSync(new URL('../public/module.js', import.meta.url), 'utf8');
  assert.ok(page.includes('lift: !popout,'), 'module.js asks for no lift in a window of its own');
});

// A request for the asking page only ({ here: true }; Places' target button asking Maps for a spot): the host fills `page` and
// `pageUntil` itself, and a mount in another page, or one that comes after the limit, never hears it. Before this, two tabs of
// /map raced for the pick and the other tab's map often took it.
test('a request asked { here: true } is heard only in the asking page, and only in time', () => {
  const src = fs.readFileSync(new URL('../public/module-host.js', import.meta.url), 'utf8');
  const { pageInput, forThisPage, PAGE_WAIT_MS } = new Function(`${slice('public/module-host.js', 'export const PAGE_WAIT_MS', '// --- end of pageInput').replace(/export /g, '')}\nreturn { pageInput, forThisPage, PAGE_WAIT_MS };`)();
  assert.ok(PAGE_WAIT_MS >= 3000 && PAGE_WAIT_MS <= 6000, 'a few seconds');
  assert.deepEqual(pageInput({ lat: 1 }, true, 'p1', 1000), { lat: 1, page: 'p1', pageUntil: 1000 + PAGE_WAIT_MS });
  assert.deepEqual(pageInput({ lat: 1, page: 'forged', pageUntil: 9e15 }, false, 'p1', 1000), { lat: 1 }, 'a module\'s own page fields are dropped');
  assert.deepEqual(pageInput({ page: 'forged' }, true, 'p1', 1000), { page: 'p1', pageUntil: 1000 + PAGE_WAIT_MS }, 'the host\'s own, never the module\'s');
  assert.deepEqual(pageInput(undefined, true, 'p1', 0), { page: 'p1', pageUntil: PAGE_WAIT_MS });
  assert.equal(forThisPage({ lat: 1 }, 'p1', 5), true, 'a request with no page goes to any page, as before');
  assert.equal(forThisPage(undefined, 'p1', 5), true);
  assert.equal(forThisPage({ page: 'p2', pageUntil: 100 }, 'p1', 5), false, 'another page never hears it');
  assert.equal(forThisPage({ page: 'p1', pageUntil: 100 }, 'p1', 5), true, 'the asking page does');
  assert.equal(forThisPage({ page: 'p1', pageUntil: 100 }, 'p1', 101), false, 'and not after the limit');
  // Wired in: the request fills them, the stream's `action` event and the pending list filter by them, the list says `open`.
  assert.match(src, /async 'actions\.request'\(\{ action, input, here \}\)/);
  assert.match(src, /input: pageInput\(input, here === true, thisPage\.id, Date\.now\(\)\)/);
  assert.match(src, /\.actions\.filter\(\(a\) => forThisPage\(a\.input, thisPage\.id, Date\.now\(\)\)\)/, 'actions.pending');
  assert.match(src, /if \(d\.provider === module\.id && d\.scope === here && forThisPage\(d\.input, thisPage\.id, Date\.now\(\)\)\) send\('action'/, 'the stream\'s action event');
  assert.match(src, /\.actions\.map\(\(a\) => \(\{ \.\.\.a, open: openInPage\(a\.module\) \}\)\)/, 'actions.list says which are open in this page');
  assert.match(src, /thisPage\.open\.add\(inPage\);/);
  assert.match(src, /thisPage\.open\.delete\(inPage\);/, 'a destroyed mount is no longer open');
  // One page across the frames in it and the windows it opened.
  assert.match(src, /window\.parent && window\.parent !== window\) near\.push\(window\.parent\)/);
  assert.match(src, /if \(window\.opener\) near\.push\(window\.opener\)/);
  const sdk = fs.readFileSync(new URL('../public/sdk/host.js', import.meta.url), 'utf8');
  assert.ok(sdk.includes("await call('actions.request', { action, input, ...(o && o.here ? { here: true } : {}) });"), 'the SDK passes `here`, and nothing more when it is not asked');
});

// host.environment is live: an environment setting change reads the context again, and a mount whose facts changed hears
// 'environment'; the SDK answers the new facts before its listeners run. Before this a picture map set or cleared while a
// page was open reached Maps (its own setting) but not Places until a reload.
test('host.environment follows the picture map while the page is open', () => {
  const src = fs.readFileSync(new URL('../public/module-host.js', import.meta.url), 'utf8');
  const environmentFacts = new Function(`${slice('public/module-host.js', 'export function environmentFacts', '\n}\n').replace('export ', '')}\nreturn environmentFacts;`)();
  const pm = { file: 'a.pmtiles', minZoom: 0, maxZoom: 3, tileType: 'webp' };
  assert.deepEqual(environmentFacts({ environment: { pictureMap: pm } }), { pictureMap: pm });
  assert.deepEqual(environmentFacts({ environment: { pictureMap: null } }), { pictureMap: null });
  assert.deepEqual(environmentFacts({}), { pictureMap: null });
  assert.deepEqual(environmentFacts({ environment: { pictureMap: 'x' } }), { pictureMap: null });
  assert.match(src, /environment: \(toldFacts = environmentFacts\(contextInfo\)\),/, 'the hello tells the facts and keeps them');
  assert.match(src, /if \(type === 'settings' && d\.scope === 'environment'\) recheckFacts\(\);\n\s+if \(type !== 'bus'/, 'any module\'s environment setting change looks again, before the per-module filter');
  assert.match(src, /if \(JSON\.stringify\(facts\) === JSON\.stringify\(toldFacts\)\) return;\n\s+toldFacts = facts;\n\s+send\('environment', facts\);/, 'told only when they differ');
  const sdk = fs.readFileSync(new URL('../public/sdk/host.js', import.meta.url), 'utf8');
  const emitAt = sdk.indexOf('  function emit(event, data) {');
  const emitBody = sdk.slice(emitAt, sdk.indexOf('\n  }\n', emitAt));
  assert.match(emitBody, /if \(event === 'environment' && info && data && typeof data === 'object'\) info\.environment = /, 'the SDK updates host.environment');
  assert.ok(emitBody.indexOf("event === 'environment'") < emitBody.indexOf('for (const fn of listeners'), 'before the listeners hear it');
  assert.match(sdk, /get environment\(\) \{ return \{ pictureMap: \(info && info\.environment && info\.environment\.pictureMap\) \|\| null \}; \}/, 'read live, not copied once');
});

test('the phases event: the page tells every mounted module and pop-out, the SDK keeps host.space() current and adds the timeline', () => {
  const page = fs.readFileSync(new URL('../public/space.js', import.meta.url), 'utf8');
  assert.match(page, /window\.dispatchEvent\(new CustomEvent\('app:phases', \{ detail \}\)\)/, 'space.js tells the modules in its page');
  assert.match(page, /phasesChannel\.postMessage\(detail\)/, 'and the pop-outs by a BroadcastChannel');
  assert.match(page, /function updatePhaseChip\(\) \{\n  announcePhases\(\);/, 'every refresh of the strip says a change');
  assert.match(page, /announcePhases\(\);\n\s+if \(saved\.includes\('image'\)/, 'a save from Set up says it');
  assert.match(page, /if \(sig === phasesSaid\) return;/, 'said only when different');
  const src = fs.readFileSync(new URL('../public/module-host.js', import.meta.url), 'utf8');
  assert.match(src, /window\.addEventListener\('app:phases', onPhasesEvent\)/, 'a mount hears the page');
  assert.match(src, /phasesChannel\.onmessage = /, 'and the channel');
  assert.match(src, /if \(key === toldPhases\) return;\n\s+toldPhases = key;[\s\S]*?send\('phases', /, 'told only when they differ');
  assert.match(src, /toldPhases = answer\.space \? phasesKey/, 'the hello is what it was last told');
  assert.match(src, /window\.removeEventListener\('app:phases', onPhasesEvent\)/, 'let go on destroy');
  const sdk = fs.readFileSync(new URL('../public/sdk/host.js', import.meta.url), 'utf8');
  const at = sdk.indexOf("host.on('phases', (e) => {");
  assert.ok(at > 0, 'the SDK keeps its own listener on phases');
  const body = sdk.slice(at, sdk.indexOf('\n  });', at));
  assert.match(body, /info\.space\.phases = e\.phases/, 'host.space().phases follows');
  assert.match(body, /e\.timeline = host\.util\.phaseTimeline\(\)/, 'the module is given the timeline');
  assert.ok(at < sdk.indexOf("host.on('moved'"), 'registered with the SDK\'s own, before any module can listen');
});

test('host.facts (plan-space-story-strip.md step 5): set and clear in the SDK, a route for this space and module only, the shape cut, the strip told', () => {
  const sdk = fs.readFileSync(new URL('../public/sdk/host.js', import.meta.url), 'utf8');
  assert.match(sdk, /facts: \{\n\s*set: \(list\) => call\('facts\.set', \{ facts: Array\.isArray\(list\) \? list : \[\] \}\),\n\s*clear: \(\) => call\('facts\.clear'\),\n\s*\},/, 'host.facts.set and clear call the host');
  assert.match(sdk, /Detect it with `if \(host\.facts\)`/, 'the SDK says how to detect it');
  const src = fs.readFileSync(new URL('../public/module-host.js', import.meta.url), 'utf8');
  assert.match(src, /const factsPlace = \(\) => \(scope === 'space' && spaceId && !guestToken && !keyed \? `\/api\/spaces\/\$\{encodeURIComponent\(spaceId\)\}\/facts\/\$\{encodeURIComponent\(module\.id\)\}` : null\);/, 'the route is this space\'s and this module\'s; none outside a space, for a guest or a keyed page');
  assert.match(src, /async 'facts\.set'\(\{ facts \} = \{\}\) \{\n\s*const place = factsPlace\(\);\n\s*if \(!place\) return false;/, 'set resolves false where there is no space');
  assert.match(src, /async 'facts\.clear'\(\) \{\n\s*const place = factsPlace\(\);\n\s*return place \? sendFacts\('DELETE', place\) : false;/, 'clear resolves false where there is no space');
  assert.match(src, /\.slice\(0, 6\)\.map\(\(f\) => \{/, 'at most six facts are sent');
  assert.match(src, /const cut = \(v, n\) => \[\.\.\.String\(v \?\? ''\)\]\.slice\(0, n\)\.join\(''\);/, 'cut by code points, so an emoji is never split');
  assert.match(src, /text: cut\(f\?\.text, 40\)/, 'the words cut to 40');
  assert.match(src, /fact\.value = cut\(f\.value, 24\)/, 'the value to 24');
  assert.match(src, /if \(typeof f\?\.when === 'string' && f\.when\) fact\.when = f\.when\.slice\(0, 10\);/, 'a fact\'s day goes as sent, for the page to word');
  assert.match(src, /fact\.progress = Math\.min\(1, Math\.max\(0, progress\)\)/, 'progress kept to 0..1');
  assert.match(src, /const kept = await \(list\.length \? sendFacts\('PUT', place, \{ facts: list \}\) : sendFacts\('DELETE', place\)\);/, 'an empty list clears');
  assert.match(src, /if \(err\.status === 401 \|\| err\.status === 403 \|\| err\.status === 404\) return false; \/\/ not in this space, or the role cannot write here\n\s*throw err;\n\s*\}\n\s*factsSent = /, 'a role that may not write is answered false, other errors reject');
  assert.match(src, /if \(sig === factsSent\.sig && Date\.now\(\) - factsSent\.at < 3600000\) return true;/, 'the same list within the hour is not sent again');
  assert.match(src, /new CustomEvent\('app:facts', \{ detail: \{ space: spaceId \} \}\)/, 'the page is told so the strip reads again');
  assert.ok(!/facts[^\n]*guest=/.test(src), 'no guest token on the facts route');
});

test('the module objects the pages read carry content: flush for Maps and Whiteboard, padded for the rest', () => {
  const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  assert.match(read('server/index.js'), /return \{ name: d\.name \|\| m\.name, icon: d\.icon \|\| m\.icon, content: m\.content === 'flush' \? 'flush' : 'padded' \};/, 'shownModule (spread into nav, for-space, the parts and the context) gives content');
  const content = (id) => JSON.parse(read(`modules/${id}/module.json`)).content ?? 'padded';
  const flush = ['maps', 'whiteboard'];
  for (const id of flush) assert.equal(content(id), 'flush', `${id} is flush`);
  for (const id of fs.readdirSync(new URL('../modules/', import.meta.url)).filter((d) => !flush.includes(d) && fs.existsSync(new URL(`../modules/${d}/module.json`, import.meta.url)))) assert.equal(content(id), 'padded', `${id} is padded`);
});

test('the budget target: a module is let in by its manifest flag, which the mounts hand the host; set() never clears by omission', () => {
  const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  assert.match(read('public/canvas.js'), /module: \{ id: m\.id, version: m\.version, scope: m\.scope, budget: m\.budget === true, tags: m\.tags === true, content: m\.content \},/, 'the canvas passes the flag');
  assert.match(read('public/module.js'), /module: \{ id: mod\.id, version: mod\.version, scope: mod\.scope, budget: mod\.budget === true, tags: mod\.tags === true, content: mod\.content \},/, 'a pop-out passes the flag');
  const host = read('public/module-host.js');
  assert.match(host, /if \(module\.budget !== true \|\| scope !== 'space'/, 'can() needs the flag');
  assert.match(host, /if \(module\.budget !== true\) throw[^\n]*\n\s*if \(budget === undefined\) throw/, 'set() needs the flag and a target');
  assert.equal(/budget === undefined \? null/.test(host), false, 'the host never turns nothing into a clear');
  assert.equal(/target === undefined \? null/.test(read('public/sdk/host.js')), false, 'the SDK never turns nothing into a clear');
});

test('the budget target (#216): the hello carries host.space().budget, the page says a change, the SDK keeps it current', () => {
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.match(server, /space: here \? \{ id: here\.id, name: here\.name, createdAt: here\.createdAt, phases: here\.phases, budget: \(who\.user && here\.budget\) \|\| null, guestsSeeHidden: here\.guestsSeeHidden === true \} : null,/, 'the context gives the budget to a signed-in person, null while none and always for a guest');
  const page = fs.readFileSync(new URL('../public/space.js', import.meta.url), 'utf8');
  // The space's record on the page no longer carries the budget (the presence list leaves it out): the phases' detail
  // has none, so a member's modules never hear it cleared; an owner's save says it at once.
  assert.match(page, /const detail = \{ space: space\.id, phases: space\.phases \|\| \{\}, created: space\.createdAt \|\| null \};/, 'the phases go without the budget');
  assert.match(page, /if \(saved\.includes\('budget'\)\) announceBudget\(space\.id, space\.budget \|\| null\);/, 'an owner\'s save says the budget');
  assert.match(page, /function announceBudget\(spaceId, budget\) \{\n\s*const detail = \{ space: spaceId, budget: budget && typeof budget === 'object' \? budget : null \};/);
  const src = fs.readFileSync(new URL('../public/module-host.js', import.meta.url), 'utf8');
  assert.match(src, /if \(JSON\.stringify\(b\) === JSON\.stringify\(contextInfo\.space\.budget \|\| null\)\) return;\n\s*contextInfo\.space = \{ \.\.\.contextInfo\.space, budget: b \};\n\s*send\('space', \{ budget: b \}\);/, 'a mount says \'space\' only when the budget changed');
  assert.match(src, /if \('budget' in d\) tellSpace\(d\.budget\);/, 'heard from the page and the channel');
  assert.match(src, /tellSpace\(a\.space\.budget\); \} \}\)\.catch/, 'and a module page alone reads it again');
  assert.match(src, /if \(list\.some\(\(f\) => f\.budget\)\) \{\n\s*api\('GET', url\('\/context', scope\)\)\.then\(\(a\) => \{ if \(a && a\.space\) tellSpace\(a\.space\.budget\); \}\)/, 'a module reporting a budget fact reads the target again, so its next report is against the current one');
  const sdk = fs.readFileSync(new URL('../public/sdk/host.js', import.meta.url), 'utf8');
  const at = sdk.indexOf("host.on('space', (e) => {");
  assert.ok(at > 0 && at < sdk.indexOf("host.on('moved'"), 'the SDK keeps its own listener on space, before any module\'s');
  assert.match(sdk.slice(at, sdk.indexOf('\n  });', at)), /info\.space\.budget = e\.budget \|\| null/, 'host.space().budget follows');
});

// A keys-only 'changes' event (a big Clear or Undo comes without values) is read with ONE storage.list for the keys' prefix; a read
// that fails is asked once more, and nothing is dropped silently: after two failures none of the event is drawn and the person is told.
{
  const body = slice('public/sdk/host.js', 'async function readKeysOnly(changes, scope, spaceId) {', '\n  }\n');
  const make = (call) => new Function('call', 'opts', `${body}\nreturn readKeysOnly;`)(call, (o) => o || {});
  const keys = Array.from({ length: 1700 }, (_, i) => ({ key: `task:t${i}` }));
  const store = keys.map((c, i) => ({ key: c.key, value: { n: i }, version: 1 }));
  test('keys only: one storage.list for the prefix, values joined by key, a key not listed is deleted', async () => {
    const calls = [];
    const read = make(async (name, args) => { calls.push([name, args]); return store.slice(0, 1699); });
    const full = await read(keys, 'space', 's1');
    assert.equal(calls.length, 1, `${calls.length} calls`);
    assert.equal(calls[0][0], 'storage.list');
    assert.equal(calls[0][1].prefix, 'task:t');
    assert.equal(full.length, 1700);
    assert.deepEqual(full[5].value, { n: 5 });
    assert.equal(full[1699].deleted, true);
  });
  test('keys only: a failed read is asked again once; two failures drop nothing silently (null, and the person is told)', async () => {
    let tries = 0;
    const once = make(async (name) => { if (name === 'storage.list' && ++tries === 1) throw new Error('network'); return store; });
    const full = await once(keys, undefined, undefined);
    assert.equal(tries, 2);
    assert.equal(full.filter((c) => c.value).length, 1700, 'every object came, after the retry');
    const told = [];
    const failing = make(async (name, args) => { if (name === 'ui.toast') { told.push(args.text); return true; } throw new Error('down'); });
    assert.equal(await failing(keys), null);
    assert.match(told.join(' '), /Reload the page/);
  });
}
// host.library.print is bound by the Vault's rule for a PDF kept as download only (decision 18, #401): it looks the file up and refuses one with
// viewable false. It does not wait for the list before the bytes (on a slow connection that was two trips one after the other, then the printing
// code's own load: 5 to 10 s, Thomas 2026-11-05): the note shows first, the printing code, the list and the bytes are asked for at once, and the
// note goes when it ends.
{
  const printSrc = slice('public/module-host.js', "async 'library.print'({ id }) {", 'finally { stop(); }');
  assert.match(printSrc, /viewable === false\) \{ ctl\.abort\(\); throw/, 'host.library.print must refuse a file that is not viewable, and drop the bytes');
  const at = (re) => { const m = printSrc.search(re); assert.ok(m >= 0, `host.library.print: ${re} is missing`); return m; };
  const note = at(/progressNote\('Preparing to print\.\.\.'\)/);
  const viewer = at(/import\('\/file-viewer\.js'\)/);
  const bytes = at(/fetch\(libraryUrl\(`\/\$\{encodeURIComponent\(fid\)\}\/content`/);
  const list = at(/api\('GET', libraryUrl\(\)\)/);
  const waits = at(/await listing/);
  assert.ok(note < viewer && note < bytes && note < list, 'host.library.print must show its note before it asks for anything');
  assert.ok(viewer < waits && bytes < waits && list < waits, 'host.library.print must ask for the code, the bytes and the list before waiting on any of them');
  assert.ok(!/await (api|fetch|import)\(/.test(printSrc.slice(0, waits)), 'host.library.print must not wait on a request before the others have started');
  const viewerSrc = slice('public/file-viewer.js', 'async function printIt(w, f) {', 'finally { stop(); }');
  assert.ok(viewerSrc.includes("progressNote('Preparing to print...')") && viewerSrc.indexOf('progressNote(') < viewerSrc.indexOf('fetch('), 'the file window\'s Print must show its note before it fetches');
}
// A live 'change' carries the server's `updatedAt` on to the module (changeStamp in public/module-host.js).
{
  const test2 = (name, fn) => { try { fn(); n += 1; } catch (err) { failed += 1; console.error(`check-module-host: ${name}: ${err.message}`); } };
  test2('a change carries the updatedAt the server sent, as sent', () => {
    const at = '2026-11-09T10:20:30.456Z';
    assert.deepEqual(changeStamp({ key: 'k', updatedAt: at }), { updatedAt: at });
    assert.equal(changeStamp({ updatedAt: at }).updatedAt, at);
    assert.deepEqual(changeStamp({ updatedAt: 1762683630456 }), { updatedAt: 1762683630456 });
  });
  test2('a change without a usable updatedAt carries none', () => {
    for (const d of [{}, null, undefined, { updatedAt: null }, { updatedAt: '' }, { updatedAt: 'soon' }, { updatedAt: NaN }, { updatedAt: Infinity }, { updatedAt: {} }, { updatedAt: true }, { updatedAt: '2026-11-09T10:20:30Z'.padEnd(60, ' ') }]) {
      assert.deepEqual(changeStamp(d), {}, JSON.stringify(d));
      assert.equal('updatedAt' in changeStamp(d), false);
    }
  });
  test2('the change event sends it through changeStamp', () => {
    assert.match(fs.readFileSync(new URL('../public/module-host.js', import.meta.url), 'utf8'), /send\('change', \{[^}]*\.\.\.changeStamp\(d\) \}\)/);
  });
}
await Promise.all(pending);
if (failed) process.exit(1);
console.log(`check-module-host: OK (${n} groups)`);
// host.toast(text, { kind }): only the text and the kind cross the bridge, and the page turns an unknown kind into info.
{
  const rd = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  const hostSrc = slice('public/sdk/host.js', '      toast: (text, opts) =>', '.then(() => true),');
  assert.ok(/call\('ui\.toast', \{ text: String\(text \?\? ''\), kind: [^}]*\}\)/.test(hostSrc), 'host.toast must send the text and the kind only');
  assert.ok(rd('public/sdk/host.js').includes("'warning' (stays 6 s)"), 'the comment above host.toast must name the kinds');
  const handler = slice('public/module-host.js', "async 'ui.toast'({ text, kind }) {", 'return true;');
  assert.ok(handler.includes("showNote(text, '', kind)"), 'ui.toast must pass the kind to showNote');
  const brand = rd('public/brand.js');
  assert.ok(brand.includes("Object.hasOwn(NOTE_KINDS, kind) ? kind : 'info'"), 'showNote must make an unknown kind info');
  for (const k of ['info', 'success', 'warning', 'danger']) assert.ok(new RegExp(`\\n  ${k}: \\{ kind: `).test(brand), `NOTE_KINDS must have ${k}`);
}
