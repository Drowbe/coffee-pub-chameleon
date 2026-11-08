#!/usr/bin/env node
/*
 * check-themes.mjs -- themes as files (documentation/plans/plan-themes.md, GitHub #67): server/theme-file.js and
 * Store.importTheme on their own, then a real server on a throwaway DATA_DIR:
 *   - every built-in and Strong Coffee exports with every key per set and imports back to the same colors,
 *     named "(2)", and /theme.css with the import applied says what it said with the original;
 *   - each refusal in the plan's order, with its sentence: over 16 KB, not JSON, not an object, format not "theme" or
 *     formatVersion not a whole number, a marker from before the formats were named by kind (plan-kind-names.md), a newer
 *     formatVersion, no complete set;
 *   - unknown keys dropped and named; a bad color drops its set; an import never changes the active theme or mode;
 *   - the top bar's colour keys (plan-two-zone-nav.md decision 8): a file with them round-trips, a bad one goes back to
 *     Auto and is named, and a theme file, a template's theme and the bundled templates without them still load;
 *   - CSS typed into a color (`red; background: url(x)`) never reaches /theme.css;
 *   - control and format characters never reach a name or author; the 101st theme is refused;
 *   - an import from another origin is refused; a body the parser can't read is 400, not 500; and no owner write
 *     route reads a body another origin can send without asking (text/plain, a form, multipart).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// A made-up product name for the server code this check loads and the server it starts, so a sentence that hard-codes the default
// fails here (plan-kind-names.md, The guard).
const PRODUCT = 'Testname';
process.env.PRODUCT_NAME = PRODUCT;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tf = require('../server/theme-file.js');
const { Store, BUILTIN_THEME_IDS, DEFAULT_THEME } = require('../server/store.js');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    n += 1;
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}\n${err.stack || err}`);
  }
};
const EVIL = 'red; background: url(x)';
const set = (over = {}) => ({ 'surface-page': '#ffffff', 'surface-panel': '#f5f7f8', 'edge-hairline': '#dde3e6', 'text-primary': '#222222', 'text-muted': '#6b7479', 'accent-fill': '#1c7c8c', 'text-on-accent': '#ffffff', ...over });
const file = (over = {}) => ({ format: 'theme', formatVersion: 1, name: 'Harbour', author: 'Thomas', light: set(), dark: null, ...over });
// The old-format theme fixture (tools/fixtures/format-old/), found by its kind so no product name is written here.
const OLD_DIR = path.join(ROOT, 'tools', 'fixtures', 'format-old');
const oldThemeFiles = () => fs.readdirSync(OLD_DIR).filter((f) => f.endsWith('-theme.json')).sort().map((f) => fs.readFileSync(path.join(OLD_DIR, f), 'utf8'));
const { PAST_BLOCK_LABELS } = require('../server/file-format.js');
const refusedWith = (sentence) => (err) => err instanceof tf.ThemeFileError && err.status === 400 && err.message === sentence;

// --- on their own ----------------------------------------------------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-themes-'));
const store = new Store(dir);
const sanitize = (t) => store.sanitizeTheme(t);

await test('export: every key of each set, null for Auto and for a set the theme lacks; Strong Coffee\'s dark written out', () => {
  for (const id of BUILTIN_THEME_IDS) {
    const theme = store.themes.find((t) => t.id === id);
    const out = tf.themeToFile(theme);
    assert.deepEqual(Object.keys(out), ['format', 'formatVersion', 'name', 'light', 'dark']);
    assert.deepEqual([out.format, out.formatVersion], ['theme', 1]);
    for (const mode of ['light', 'dark']) assert.deepEqual(Object.keys(out[mode]), tf.SET_KEYS, `${id} ${mode}: every key`);
  }
  const coffee = tf.themeToFile(null);
  assert.equal(coffee.name, 'Strong Coffee');
  assert.equal(coffee.dark['surface-page'], DEFAULT_THEME.dark['surface-page']);
  assert.equal(coffee.dark['fill-secondary'], null);
  const one = tf.themeToFile({ name: 'Only light', light: set(), dark: null });
  assert.equal(one.dark, null);
  assert.equal(tf.themeFileName('Strong Coffee'), 'strong-coffee.theme.json');
  assert.equal(tf.themeFileName('  Ünïcode & "quotes"!! '), 'n-code-quotes.theme.json');
  assert.equal(tf.themeFileName('***'), 'theme.theme.json');
  assert.equal(tf.themeFileName(''), 'theme.theme.json');
});

await test('import refusals, each with its sentence, in the plan\'s order', () => {
  const read = (x) => () => tf.readThemeFile(x, sanitize);
  assert.throws(read(`{"format":"theme","formatVersion":1,"name":"${'x'.repeat(17 * 1024)}"}`), refusedWith(tf.NOT_A_THEME_FILE), 'over 16 KB');
  assert.throws(read('not json'), refusedWith(tf.NOT_A_THEME_FILE));
  assert.throws(read('[1,2]'), refusedWith(tf.NOT_A_THEME_FILE));
  assert.throws(read('"a string"'), refusedWith(tf.NOT_A_THEME_FILE));
  assert.throws(read(file({ formatVersion: undefined })), refusedWith(tf.NOT_A_THEME_FILE));
  assert.throws(read(file({ formatVersion: 1.5 })), refusedWith(tf.NOT_A_THEME_FILE));
  assert.throws(read(file({ formatVersion: '1' })), refusedWith(tf.NOT_A_THEME_FILE));
  assert.throws(read(file({ formatVersion: 0 })), refusedWith(tf.NOT_A_THEME_FILE));
  assert.throws(read(file({ format: 'template' })), refusedWith(tf.NOT_A_THEME_FILE), 'another kind');
  const { format, formatVersion, ...unmarked } = file();
  assert.throws(read(unmarked), refusedWith(tf.NOT_A_THEME_FILE), 'no marker');
  // A marker from before the formats were named by kind: a past label and the kind, built from the one list.
  for (const label of PAST_BLOCK_LABELS) assert.throws(read({ ...unmarked, [`${label}Theme`]: 1 }), refusedWith(tf.OLD_THEME_FILE), label);
  // Any other key ending in the kind is not an old marker (plan-kind-names.md, F4).
  assert.throws(read({ ...unmarked, someTheme: 1 }), refusedWith(tf.NOT_A_THEME_FILE), 'an unknown xxxTheme key');
  assert.equal(tf.OLD_THEME_FILE, 'That theme file is in an older format. Export the theme again and import the new file.');
  // A newer version is refused before anything else is looked at, even a file with nothing usable in it.
  assert.throws(read({ format: 'theme', formatVersion: 2 }), refusedWith(tf.NEWER));
  // The sentences that name the product take it from PRODUCT_NAME.
  assert.equal(tf.NOT_A_THEME_FILE, `That isn't a ${PRODUCT} theme file.`);
  assert.equal(tf.NEWER, `This theme was made by a newer version of ${PRODUCT}.`);
  assert.throws(read(file({ light: null })), refusedWith(tf.NO_COMPLETE_SET));
  assert.throws(read(file({ light: set({ 'accent-fill': undefined }) })), refusedWith(tf.NO_COMPLETE_SET), 'a base color missing');
  assert.throws(read(file({ light: set({ 'accent-fill': EVIL }) })), refusedWith(tf.NO_COMPLETE_SET), 'a base color that is CSS');
  assert.throws(read(file({ light: 'red' })), refusedWith(tf.NO_COMPLETE_SET));
  // A file whose sets use the keys from before the colour roles has no complete set: it is not read.
  const earlier = { bg: '#ffffff', bgSection: '#f5f7f8', border: '#dde3e6', text: '#222222', textDim: '#6b7479', accent: '#1c7c8c', onAccent: '#ffffff' };
  assert.throws(read(file({ light: earlier, dark: earlier })), refusedWith(tf.NO_COMPLETE_SET), 'the earlier key names');
});

await test('import: unknown keys dropped and named; a bad color drops its set or goes back to Auto; name and author cleaned', () => {
  const got = tf.readThemeFile({ ...file({ dark: set({ 'surface-page': EVIL }), light: { ...set({ 'fill-secondary': EVIL, 'icon-default': '#ABCDEF' }), glow: '#ffffff', bgCard: '#000000' } }), font: 'Comic Sans' }, sanitize);
  assert.deepEqual(got.dropped, ['font', 'light.glow', 'light.bgCard', 'light.fill-secondary', 'dark']);
  assert.equal(got.dark, null);
  assert.equal(got.light['fill-secondary'], null, 'CSS in an optional color is Auto');
  assert.equal(got.light['icon-default'], '#abcdef');
  assert.equal(got.author, 'Thomas');
  const named = tf.readThemeFile(file({ name: `  ${'N'.repeat(50)}  `, author: `A\u0007b${'c'.repeat(80)}` }), sanitize);
  assert.equal(named.name.length, 40);
  assert.equal(named.author.length, 60);
  assert.ok(!/\p{Cc}/u.test(named.author));
  const bare = tf.readThemeFile({ format: 'theme', formatVersion: 1, dark: set({ 'surface-page': '#10181b' }) }, sanitize);
  assert.deepEqual([bare.name, 'author' in bare, bare.light, bare.dark['surface-page'], bare.dropped], ['Theme', false, null, '#10181b', []]);
  assert.deepEqual(tf.readThemeFile(file({ name: 5, author: ['x'] }), sanitize).dropped, ['name', 'author']);
});

const NAV = { 'surface-bar-brand': '#102030', 'text-bar-brand': '#f0e0d0', 'surface-bar-right': '#203040', 'text-bar-right': '#e0d0c0' };
const STATUS = { 'status-danger-fill': '#aa2222', 'status-ok-fill': '#22aa22', 'status-warn-fill': '#aaaa22', 'status-info-fill': '#2222aa' };
await test('the top bar keys and the four status fills: in every exported set; a file with them round-trips; a bad one goes back to Auto and is named; formatVersion stays 1', () => {
  for (const key of [...Object.keys(NAV), ...Object.keys(STATUS)]) assert.ok(tf.SET_KEYS.includes(key), key);
  assert.equal(tf.THEME_FILE_VERSION, 1);
  const got = tf.readThemeFile(file({ light: set({ ...NAV, ...STATUS }), dark: set({ 'surface-page': '#10181b', 'surface-bar-right': '#ABCDEF', 'status-ok-fill': '#00AA00' }) }), sanitize);
  assert.deepEqual(got.dropped, []);
  for (const [key, value] of Object.entries({ ...NAV, ...STATUS })) assert.equal(got.light[key], value, key);
  assert.deepEqual([got.dark['surface-bar-right'], got.dark['surface-bar-brand'], got.dark['status-ok-fill'], got.dark['status-warn-fill']], ['#abcdef', null, '#00aa00', null]);
  const out = tf.themeToFile({ name: 'Harbour', light: got.light, dark: got.dark });
  assert.equal(out.formatVersion, 1);
  assert.deepEqual(tf.readThemeFile(JSON.stringify(out), sanitize).light, got.light, 'export then import: the same set');
  const bad = tf.readThemeFile(file({ light: set({ ...NAV, 'surface-bar-brand': EVIL, 'text-bar-right': 'blue', 'status-info-fill': EVIL }) }), sanitize);
  assert.deepEqual(bad.dropped, ['light.surface-bar-brand', 'light.text-bar-right', 'light.status-info-fill']);
  assert.deepEqual([bad.light['surface-bar-brand'], bad.light['text-bar-right'], bad.light['text-bar-brand'], bad.light['status-info-fill']], [null, null, NAV['text-bar-brand'], null]);
});

await test('a theme file, a template\'s theme and the bundled templates that set none of the optional keys still load, on Auto', () => {
  const plain = tf.readThemeFile(file(), sanitize); // file() sets only the seven base colours
  assert.deepEqual(plain.dropped, []);
  for (const key of [...Object.keys(NAV), ...Object.keys(STATUS)]) assert.equal(plain.light[key], null, key);
  const templates = require('../server/templates.js');
  const embedded = templates.readEmbeddedTheme({ name: 'Trip', light: set(), dark: null });
  assert.deepEqual(embedded.dropped, []);
  for (const key of Object.keys(NAV)) assert.equal(embedded.theme.light[key], null, key);
  for (const id of BUILTIN_THEME_IDS) {
    const theme = store.themes.find((t) => t.id === id);
    for (const mode of ['light', 'dark']) for (const key of [...Object.keys(NAV), ...Object.keys(STATUS)]) assert.ok(theme[mode][key] == null, `${id} ${mode} ${key}`);
  }
  for (const mode of ['light', 'dark']) for (const key of Object.keys(NAV)) assert.ok(DEFAULT_THEME[mode][key] == null, `Strong Coffee ${mode} ${key}`);
});

await test('Store.importTheme: a new id, "Name (2)" on a clash (Strong Coffee\'s name too), author kept, nothing applied', () => {
  const before = { active: store.settings.activeThemeId || null, mode: store.settings.themeMode };
  const a = store.importTheme(tf.readThemeFile(file(), sanitize));
  const b = store.importTheme(tf.readThemeFile(file({ name: 'harbour' }), sanitize));
  const c = store.importTheme(tf.readThemeFile(file(), sanitize));
  const d = store.importTheme(tf.readThemeFile(file({ name: 'Strong Coffee' }), sanitize));
  const long = store.importTheme(tf.readThemeFile(file({ name: 'L'.repeat(40) }), sanitize));
  const long2 = store.importTheme(tf.readThemeFile(file({ name: 'L'.repeat(40) }), sanitize));
  assert.deepEqual([a.name, b.name, c.name, d.name], ['Harbour', 'harbour (2)', 'Harbour (3)', 'Strong Coffee (2)']);
  assert.equal(long2.name, `${'L'.repeat(36)} (2)`);
  assert.equal(new Set([a.id, b.id, c.id, d.id, long.id]).size, 5);
  assert.equal(a.author, 'Thomas');
  assert.deepEqual({ active: store.settings.activeThemeId || null, mode: store.settings.themeMode }, before);
  // Kept on disk, and cleaned by sanitizeTheme like everything else about a theme.
  const again = new Store(dir).themes.find((t) => t.id === a.id);
  assert.equal(again.author, 'Thomas');
  assert.equal(store.sanitizeTheme({ ...again, author: `x${'y'.repeat(70)}` }).author.length, 60);
  assert.equal('author' in store.sanitizeTheme({ name: 'Plain', light: set() }), false, 'a theme made in Manage has none');
});

await test('control and format characters (direction marks, zero-width ones) are dropped from a name and author, from a file or the editor', () => {
  const hidden = '\u202e\u200b\u200f\u2066\ufeff\u00ad\u0007\u007f\u0085';
  const got = tf.readThemeFile(file({ name: `${hidden} Har${hidden}bour ${hidden}`, author: `Tho\nmas${hidden}\t` }), sanitize);
  assert.deepEqual([got.name, got.author], ['Harbour', 'Tho mas']);
  const empty = tf.readThemeFile(file({ name: ` ${hidden} `, author: hidden }), sanitize);
  assert.deepEqual([empty.name, 'author' in empty], ['Theme', false], 'nothing left: "Theme", and no author');
  assert.equal(store.sanitizeTheme({ name: `A\u202eb`, author: `c\u200bd`, light: set() }).name, 'Ab');
  const made = store.addTheme({ name: `Ma\u200bde\u202e`, mode: 'light', ...set() });
  assert.equal(made.name, 'Made');
  assert.equal(store.updateTheme(made.id, { name: `Re\u2066named` }).name, 'Renamed');
  assert.equal(store.updateTheme(made.id, { name: hidden }).name, 'Renamed', 'a rename to nothing keeps the name');
  store.removeTheme(made.id);
  // The zero-width joiner holds a combined emoji together, so it stays between two characters; alone, at an edge or
  // beside a space it goes. U+2028 and U+2029 are line breaks, so they become spaces.
  const family = '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}';
  const named = (name) => tf.readThemeFile(file({ name }), sanitize).name;
  assert.equal(named(`Family ${family}`), `Family ${family}`);
  assert.equal(named('\u200d'), 'Theme');
  assert.equal(named(' \u200dA\u200d\u200d\u200dB\u200d '), 'A\u200dB');
  assert.equal(named('A B C'), 'A B C');
  // Cut at 40 characters by code point, never between the halves of one.
  const smiles = '\u{1f600}'.repeat(45);
  assert.equal(named(smiles), '\u{1f600}'.repeat(40));
  assert.equal(named(`${'x'.repeat(39)}\u{1f600}\u{1f600}`), `${'x'.repeat(39)}\u{1f600}`);
  assert.ok(!/[\ud800-\udfff](?![\udc00-\udfff])/.test(named(`${'x'.repeat(39)}\u{1f600}`).replace(/[\ud800-\udbff][\udc00-\udfff]/g, '')), 'no half emoji');
  const first = store.importTheme(tf.readThemeFile(file({ name: smiles }), sanitize));
  const second = store.importTheme(tf.readThemeFile(file({ name: smiles }), sanitize));
  assert.equal(second.name, `${'\u{1f600}'.repeat(36)} (2)`, 'the "(2)" name is cut by code point too');
  store.removeTheme(first.id);
  store.removeTheme(second.id);
});

await test('Store.importTheme: the 101st theme is refused with its sentence, and nothing is added', () => {
  assert.equal(require('../server/store.js').MAX_THEMES, 100);
  while (store.themes.length < 100) store.importTheme(tf.readThemeFile(file({ name: 'Fill' }), sanitize));
  assert.throws(() => store.importTheme(tf.readThemeFile(file(), sanitize)), (err) => err.status === 400 && err.message === 'This environment has 100 themes, the most it can hold. Delete one to import another.');
  assert.equal(store.themes.length, 100);
  store.removeTheme(store.themes.at(-1).id);
  assert.ok(store.importTheme(tf.readThemeFile(file(), sanitize)).id, 'one deleted, one more comes in');
});

// Only these parsers in the app read a body a page on another origin can send without asking first (text/plain, a
// form, multipart): the theme import and the host's theme file check, the template and objects imports (a module's check, and Chat's), which refuse anything but their own origin. Every other body is JSON, which the browser won't send cross-origin without a
// preflight the server never answers. A new parser taking one of those types must be added here, with its guard.
await test('only /api/themes/import, the host\'s theme check, the two template imports and the objects checks read a body another origin can send; each is behind sameOriginOnly', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  const SIMPLE = /text\/|x-www-form-urlencoded|multipart\/form-data|\*\/\*|=>/;
  const found = [];
  for (const m of src.matchAll(/(?:const (\w+) = )?express\.(json|text|raw|urlencoded)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
    const [, name = '(inline)', kind, opts] = m;
    const type = /type:\s*([^,}]+(?:\[[^\]]*\])?)/.exec(opts)?.[1] || '';
    const takesSimple = type ? SIMPLE.test(type) : kind === 'text' || kind === 'urlencoded';
    if (takesSimple) found.push(name);
  }
  assert.deepEqual(found.sort(), ['objectsFileText', 'templateFileText', 'themeFileText']);
  const uses = [...src.matchAll(/(?:app|hostRouter)\.(?:post|put|patch|delete)\(([^\n]*?\b(?:themeFileText|templateFileText|objectsFileText)\b[^\n]*)/g)].map((m) => m[1]);
  assert.equal(uses.filter((u) => u.includes('templateFileText')).length, 2, 'the template file parser is used by the two imports only');
  assert.equal(uses.filter((u) => u.includes('objectsFileText')).length, 2, 'the objects file parser is used by the module and Chat checks only');
  assert.equal(uses.filter((u) => u.includes('themeFileText')).length, 2, 'the theme file parser is used by the import and the host\'s theme check only');
  for (const u of uses) {
    if (u.includes('themeFileText')) assert.match(u, /^'\/api\/(themes\/import', requireOwner|host\/themes\/check', requireHostAdmin), sameOriginOnly, themeFileText,/);
    else if (u.includes('objectsFileText')) assert.match(u, /^'\/api\/(modules|spaces)\/:id\/objects\/check', sameOriginOnly, objectsFileType, objectsFileText,/);
    else assert.match(u, /^'\/api\/(templates\/import', requireOwner|host\/templates\/import', requireHostAdmin), sameOriginOnly, templateFileText,/);
  }
});
fs.rmSync(dir, { recursive: true, force: true });

// --- a real server ---------------------------------------------------------------------------------------------
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-themes-live-'));
const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, PRODUCT_NAME: PRODUCT, ADMIN_PASSWORD: 'testpass1234' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
  const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
});
let cookie = '';
async function call(method, urlPath, { body, type = 'application/json', raw = false, headers: extra = {} } = {}) {
  const headers = { accept: 'application/json', ...(cookie ? { cookie } : {}), ...extra };
  if (body !== undefined) headers['content-type'] = type;
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  if (!raw) { try { json = JSON.parse(text); } catch { /* not JSON */ } }
  return { status: res.status, json, text, headers: res.headers };
}
const css = async () => (await call('GET', '/theme.css', { raw: true })).text;
const apply = async (id) => assert.equal((await call('PATCH', '/api/settings', { body: { activeThemeId: id } })).status, 200);
// /theme.css as { light: { '--bg': '#...', ... }, dark: {...} }: the default mode's block is
// ':root:not([data-theme-mode="<other>"])', the other's ':root[data-theme-mode="<other>"]'; a mode with no block is {}.
const modeBlocks = (text) => {
  const def = /default mode: (light|dark)/.exec(text)[1];
  const other = def === 'light' ? 'dark' : 'light';
  const out = { light: {}, dark: {} };
  for (const [, selector, body] of text.matchAll(/(:root[^{]*)\{([^}]*)\}/g)) {
    out[selector.includes(':not(') ? def : other] = Object.fromEntries([...body.matchAll(/(--[a-z-]+): ([^;]+);/g)].map((x) => [x[1], x[2]]));
  }
  return out;
};

try {
  const login = await call('POST', '/api/login', { body: { login: 'admin', password: 'testpass1234' } });
  assert.equal(login.status, 200, login.text);
  cookie = `app_session=${login.json.token}`;

  await test('live: export answers a download for every built-in and Strong Coffee; 404 for an unknown id; owners only', async () => {
    for (const [id, name] of [['default', 'strong-coffee'], ['staying-blonde', 'calming-teal'], ['willhavebeen', 'burnt-orange']]) {
      const r = await call('GET', `/api/themes/${id}/export`);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.headers.get('content-disposition'), `attachment; filename="${name}.theme.json"`);
      assert.match(r.headers.get('content-type'), /application\/json/);
      assert.deepEqual(Object.keys(r.json).slice(0, 2), ['format', 'formatVersion']);
      assert.deepEqual([r.json.format, r.json.formatVersion], ['theme', 1]);
    }
    assert.deepEqual(await call('GET', '/api/themes/nope/export').then((r) => [r.status, r.json]), [404, { error: 'no such theme' }]);
    const saved = cookie;
    cookie = '';
    assert.equal((await call('GET', '/api/themes/default/export')).status, 401);
    assert.equal((await call('POST', '/api/themes/import', { body: file() })).status, 401);
    cookie = saved;
  });

  await test('live: each exported theme imports back to the same colors, named "(2)", and applied it writes the same /theme.css', async () => {
    for (const id of ['default', ...BUILTIN_THEME_IDS]) {
      const before = await call('GET', '/api/themes');
      const exported = (await call('GET', `/api/themes/${id}/export`)).json;
      const imported = await call('POST', '/api/themes/import', { body: exported });
      assert.equal(imported.status, 200, imported.text);
      assert.deepEqual(imported.json.dropped, []);
      const theme = imported.json.theme;
      assert.equal(theme.name, `${exported.name} (2)`);
      for (const mode of ['light', 'dark']) assert.deepEqual(tf.themeToFile(theme)[mode], exported[mode], `${id} ${mode}: the same colors`);
      // Nothing was applied by the import.
      assert.equal((await call('GET', '/api/themes')).json.activeThemeId, before.json.activeThemeId);
      await apply(id === 'default' ? null : id);
      const original = modeBlocks(await css());
      await apply(theme.id);
      const again = modeBlocks(await css());
      assert.deepEqual(again.light, original.light, `${id}: the light block`);
      assert.deepEqual(again.dark, original.dark, `${id}: the dark block`);
      // Every set is written whole now, Strong Coffee's dark one too: the seven base colours and the picks.
      for (const mode of ['light', 'dark']) for (const prop of ['--surface-page', '--text-on-accent', '--text-accent', '--status-danger-text', '--status-ok-mark']) assert.ok(original[mode][prop], `${id} ${mode} ${prop}`);
    }
    await apply(null);
  });

  await test('live: the top bar and status keys -- set with PATCH, written to /theme.css, a bad one back on Auto; exported and imported back the same', async () => {
    const made = await call('POST', '/api/themes', { body: { name: 'Nav', mode: 'light', ...set() } });
    assert.equal(made.status, 200, made.text);
    const id = made.json.theme.id;
    await apply(id);
    const before = modeBlocks(await css());
    assert.ok(!Object.keys(before.light).some((p) => p.startsWith('--surface-bar-') || p.startsWith('--text-bar-') || /^--status-[a-z]+-fill$/.test(p)), 'none set, none written');
    const patched = await call('PATCH', `/api/themes/${id}`, { body: { mode: 'light', ...NAV, 'text-bar-right': EVIL, 'status-warn-fill': '#AAAA22' } });
    assert.equal(patched.status, 200, patched.text);
    assert.deepEqual([patched.json.theme.light['surface-bar-brand'], patched.json.theme.light['text-bar-right'], patched.json.theme.light['status-warn-fill']], [NAV['surface-bar-brand'], null, '#aaaa22']);
    const after = modeBlocks(await css());
    assert.deepEqual([after.light['--surface-bar-brand'], after.light['--text-bar-brand'], after.light['--surface-bar-right'], after.light['--text-bar-right'], after.light['--status-warn-fill']], [NAV['surface-bar-brand'], NAV['text-bar-brand'], NAV['surface-bar-right'], undefined, '#aaaa22']);
    assert.notEqual(after.light['--status-warn-text'], before.light['--status-warn-text'], 'the text picked for the status colour follows its fill');
    const exported = (await call('GET', `/api/themes/${id}/export`)).json;
    assert.equal(exported.formatVersion, 1);
    assert.deepEqual([exported.light['surface-bar-brand'], exported.light['text-bar-right'], exported.light['status-warn-fill']], [NAV['surface-bar-brand'], null, '#aaaa22']);
    const imported = await call('POST', '/api/themes/import', { body: exported });
    assert.equal(imported.status, 200, imported.text);
    assert.deepEqual(imported.json.dropped, []);
    assert.deepEqual(tf.themeToFile(imported.json.theme).light, exported.light);
    await apply(imported.json.theme.id);
    assert.deepEqual(modeBlocks(await css()).light, after.light);
    await apply(null);
    await call('DELETE', `/api/themes/${imported.json.theme.id}`);
    await call('DELETE', `/api/themes/${id}`);
  });

  await test('live: every refusal answers 400 with its sentence, however the file is sent, and adds nothing', async () => {
    const count = async () => (await call('GET', '/api/themes')).json.themes.length;
    const had = await count();
    const cases = [
      [JSON.stringify(file({ name: 'x'.repeat(20 * 1024) })), 'application/json', tf.NOT_A_THEME_FILE],
      [JSON.stringify(file({ name: 'x'.repeat(80 * 1024) })), 'application/json', tf.NOT_A_THEME_FILE],
      [JSON.stringify(file({ name: 'x'.repeat(20 * 1024) })), 'application/octet-stream', tf.NOT_A_THEME_FILE],
      ['{ not json', 'application/json', tf.NOT_A_THEME_FILE],
      ['{ not json', 'text/plain', tf.NOT_A_THEME_FILE],
      ['[1]', 'application/json', tf.NOT_A_THEME_FILE],
      ['', 'application/json', tf.NOT_A_THEME_FILE],
      [JSON.stringify(file({ formatVersion: undefined })), 'application/json', tf.NOT_A_THEME_FILE],
      [JSON.stringify(file({ formatVersion: 2 })), 'application/json', tf.NEWER],
      ...oldThemeFiles().flatMap((old) => [[old, 'application/json', tf.OLD_THEME_FILE], [old, 'text/plain', tf.OLD_THEME_FILE]]),
      [JSON.stringify({ ...file(), format: undefined, formatVersion: undefined, someTheme: 1 }), 'application/json', tf.NOT_A_THEME_FILE],
      [JSON.stringify(file({ light: set({ 'surface-page': EVIL }) })), 'application/json', tf.NO_COMPLETE_SET],
      [JSON.stringify(file({ light: null, dark: null })), 'text/plain', tf.NO_COMPLETE_SET],
    ];
    for (const [body, type, sentence] of cases) {
      const r = await call('POST', '/api/themes/import', { body, type });
      assert.deepEqual([r.status, r.json], [400, { error: sentence }], `${type} ${body.slice(0, 40)}`);
    }
    assert.equal(await count(), had);
    // The file's own text with another type is read as well as JSON is.
    const asText = await call('POST', '/api/themes/import', { body: JSON.stringify(file({ name: 'As text' })), type: 'application/octet-stream' });
    assert.deepEqual([asText.status, asText.json.theme.name, asText.json.theme.author], [200, 'As text', 'Thomas']);
  });

  await test('live: a hand-edited file -- an unknown key, CSS in a color, no dark set -- comes in with what was dropped, and no CSS reaches /theme.css', async () => {
    const edited = { format: 'theme', formatVersion: 1, name: 'Harbour', author: 'Thomas', font: 'x', light: { ...set({ 'fill-secondary': EVIL, 'surface-bar-top': '#123456' }), glow: EVIL }, dark: { ...set({ 'accent-fill': EVIL }) } };
    const r = await call('POST', '/api/themes/import', { body: edited });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.dropped, ['font', 'light.glow', 'light.fill-secondary', 'dark']);
    assert.deepEqual([r.json.theme.name, r.json.theme.author, r.json.theme.dark, r.json.theme.light['fill-secondary'], r.json.theme.light['surface-bar-top']], ['Harbour', 'Thomas', null, null, '#123456']);
    const listed = (await call('GET', '/api/themes')).json.themes.find((t) => t.id === r.json.theme.id);
    assert.equal(listed.author, 'Thomas', 'GET /api/themes answers the author');
    await apply(r.json.theme.id);
    const text = await css();
    assert.ok(!/url\(|background:|;\s*;|red/.test(text), text);
    assert.ok(text.includes('--surface-bar-top: #123456;'));
    for (const line of text.split('\n').filter((l) => l.includes(': ') && !l.trim().startsWith('/*'))) assert.match(line, /^ {2}--[a-z-]+: #[0-9a-f]{6};$/, line);
    // Imported twice: the second is "Harbour (2)"; exported again, it still names its author.
    const second = await call('POST', '/api/themes/import', { body: edited });
    assert.equal(second.json.theme.name, 'Harbour (2)');
    const back = (await call('GET', `/api/themes/${r.json.theme.id}/export`)).json;
    assert.deepEqual([back.name, back.author, back.dark, back.light['fill-secondary']], ['Harbour', 'Thomas', null, null]);
    await apply(null);
  });

  await test('live: an import from another origin is refused -- Sec-Fetch-Site other than same-origin, or an Origin that isn\'t this one -- and adds nothing; this origin, a proxied one and a Bearer token are not', async () => {
    const count = async () => (await call('GET', '/api/themes')).json.themes.length;
    const had = await count();
    const refused = { error: 'This request came from another site, so it was refused.' }; // sameOriginOnly, as every write (tools/check-origin.mjs)
    const self = `http://127.0.0.1:${port}`;
    for (const headers of [
      { 'sec-fetch-site': 'same-site' },
      { 'sec-fetch-site': 'cross-site' },
      { origin: 'https://other.example.com' },
      { origin: 'null' },
      { origin: `http://127.0.0.1:${port + 1}` },
      { origin: self, 'sec-fetch-site': 'same-site' },
      { origin: 'https://other.example.com', 'sec-fetch-site': 'same-origin' },
    ]) {
      for (const type of ['text/plain', 'application/json']) {
        const r = await call('POST', '/api/themes/import', { body: JSON.stringify(file({ name: 'Cross' })), type, headers });
        assert.deepEqual([r.status, r.json], [403, refused], `${type} ${JSON.stringify(headers)}`);
      }
    }
    assert.equal(await count(), had);
    const ok = async (headers, bearer = false) => {
      const saved = cookie;
      if (bearer) cookie = '';
      const r = await call('POST', '/api/themes/import', { body: JSON.stringify(file({ name: 'Same' })), type: 'text/plain', headers: bearer ? { ...headers, authorization: `Bearer ${saved.slice('app_session='.length)}` } : headers });
      cookie = saved;
      assert.equal(r.status, 200, `${JSON.stringify(headers)} ${r.text}`);
      await call('DELETE', `/api/themes/${r.json.theme.id}`);
    };
    await ok({ origin: self, 'sec-fetch-site': 'same-origin' });
    await ok({ 'sec-fetch-site': 'none' });
    await ok({ origin: 'https://env.example.com', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'env.example.com' });
    await ok({}, true);
    assert.equal(await count(), had);
  });

  await test('live: a body the parser can\'t read -- an unknown charset or content-encoding, bytes that don\'t unzip -- is 400 with the sentence, not 500', async () => {
    const body = JSON.stringify(file({ name: 'Encoded' }));
    for (const [type, headers] of [
      ['text/plain; charset=bogus', {}],
      ['application/json; charset=bogus', {}],
      ['application/octet-stream; charset=bogus', {}],
      ['text/plain', { 'content-encoding': 'bogus' }],
      ['application/json', { 'content-encoding': 'bogus' }],
      ['text/plain', { 'content-encoding': 'gzip' }],
      ['application/json', { 'content-encoding': 'deflate' }],
    ]) {
      const r = await call('POST', '/api/themes/import', { body, type, headers });
      assert.deepEqual([r.status, r.json], [400, { error: tf.NOT_A_THEME_FILE }], `${type} ${JSON.stringify(headers)}`);
    }
  });

  await test('live: a body a page on another origin can send without asking (text/plain, a form, multipart) is never read by an owner write route', async () => {
    const fields = { environmentName: 'Taken over', name: 'From text', login: 'fromtext', password: 'fromtext1234', mode: 'light', themeMode: 'light', ...set() };
    const bodies = [
      ['text/plain', JSON.stringify(fields)],
      ['application/x-www-form-urlencoded', new URLSearchParams(fields).toString()],
      ['multipart/form-data; boundary=x', `${Object.entries(fields).map(([k, v]) => `--x\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('')}--x--\r\n`],
    ];
    const state = async () => ({
      environmentName: (await call('GET', '/api/settings')).json.settings.environmentName,
      themes: (await call('GET', '/api/themes')).json.themes.map((t) => t.name).sort(),
      spaces: (await call('GET', '/api/spaces')).json.spaces.map((s) => s.name).sort(),
      users: (await call('GET', '/api/users')).json.users.map((u) => u.login).sort(),
      themeMode: (await call('GET', '/api/me')).json.user.themeMode ?? null,
    });
    const before = await state();
    for (const [method, route] of [['PATCH', '/api/settings'], ['POST', '/api/themes'], ['PATCH', '/api/themes/staying-blonde'], ['POST', '/api/spaces'], ['POST', '/api/users'], ['PATCH', '/api/me']]) {
      for (const [type, body] of bodies) {
        const r = await call(method, route, { body, type });
        assert.ok(r.status < 500, `${method} ${route} ${type}: ${r.status} ${r.text}`);
        if (r.json?.space) await call('DELETE', `/api/spaces/${r.json.space.id}`); // made without reading the body
      }
    }
    const after = await state();
    assert.deepEqual(after, before);
  });

  await test('live: the 101st theme is refused with its sentence', async () => {
    let themes = (await call('GET', '/api/themes')).json.themes.length;
    while (themes < 100) {
      assert.equal((await call('POST', '/api/themes/import', { body: file({ name: 'Fill' }) })).status, 200);
      themes += 1;
    }
    const r = await call('POST', '/api/themes/import', { body: file() });
    assert.deepEqual([r.status, r.json], [400, { error: 'This environment has 100 themes, the most it can hold. Delete one to import another.' }]);
    assert.equal((await call('GET', '/api/themes')).json.themes.length, 100);
  });
} finally {
  await new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
  fs.rmSync(dataDir, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-themes: ${failed} group${failed === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log(`check-themes: ${n} groups OK`);
