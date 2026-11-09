#!/usr/bin/env node
/*
 * check-theme.mjs -- light and dark (GitHub #62) and the colour roles (plan-design-system.md, step 8): /theme.css carries both of
 * the live theme's sets, each under its own <html data-theme-mode>, the default one also covering a page without the attribute
 * (server/theme-css.js); the keys of a set are the colour roles (`surface-page` sets `--surface-page`); the colours the server
 * picks (text on the accent and on each status fill, the accent and the status colours as text, the OK mark) are written with
 * them and reach their contrast; a person's own mode is kept on their account (Store.setThemeMode), absent while they follow the
 * environment's default; a bad mode, the owner's or a person's, is refused and changes nothing; the optional keys (the top bar's
 * areas, the four status fills...) are written only when set, null (Auto) when not a color; a stored theme in the format from before
 * the roles is not read -- it is dropped on load, one line is logged, and the default theme shows.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { themeCss, themeVersion } = require('../server/theme-css.js');
const { Store, THEME_BASE, THEME_OPTIONAL, DEFAULT_THEME } = require('../server/store.js');
const TC = require('../public/theme-colour.js');
let n = 0;
const test = (name, fn) => {
  try {
    fn();
    n += 1;
  } catch (err) {
    console.error(`check-theme: ${name}`);
    throw err;
  }
};
const withStore = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-theme-'));
  try {
    fn(new Store(dir), dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const set = (page, panel, edge, text, muted, accent, onAccent, more = {}) => ({ 'surface-page': page, 'surface-panel': panel, 'edge-hairline': edge, 'text-primary': text, 'text-muted': muted, 'accent-fill': accent, 'text-on-accent': onAccent, ...more });
const LIGHT = set('#ffffff', '#f7f7f7', '#e0e0e0', '#333333', '#767676', '#e45628', '#ffffff', { 'surface-bar-top': '#eeeeee' });
const DARK = set('#111111', '#222222', '#333333', '#eeeeee', '#999999', '#e45628', '#ffffff');
const NAV = { 'surface-bar-brand': '#102030', 'text-bar-brand': '#f0e0d0', 'surface-bar-right': '#203040', 'text-bar-right': '#e0d0c0' };
const STATUS = { 'status-danger-fill': '#aa2222', 'status-ok-fill': '#22aa22', 'status-warn-fill': '#aaaa22', 'status-info-fill': '#2222aa' };
const blockOf = (css, selector) => new RegExp(`${selector.replace(/[[\]().*+?^$|]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
const prop = (body, name) => new RegExp(`^ {2}${name}: ([^;]+);$`, 'm').exec(body)?.[1] ?? null;

test('the keys of a set are the colour roles: seven base ones, and the optional ones including the four status fills', () => {
  assert.deepEqual(THEME_BASE, ['surface-page', 'surface-panel', 'edge-hairline', 'text-primary', 'text-muted', 'accent-fill', 'text-on-accent']);
  for (const key of ['surface-card', 'surface-bar-top', 'text-bar', 'surface-bar-brand', 'text-bar-brand', 'surface-bar-right', 'text-bar-right', 'icon-default', 'icon-hover', 'accent-fill-hover', 'fill-secondary', 'text-on-secondary', 'fill-secondary-hover', 'status-danger-fill', 'status-ok-fill', 'status-warn-fill', 'status-info-fill', 'fill-chosen', 'text-on-chosen', 'ink-chosen', 'ink-brand', 'ink-neutral', 'icon-bar', 'surface-message', 'tone-gold', 'tone-blue', 'tone-green', 'tone-teal', 'tone-purple', 'tone-red', 'tone-orange', 'tone-pink']) assert.ok(THEME_OPTIONAL.includes(key), key);
  assert.equal(THEME_OPTIONAL.length, 41);
  assert.equal(new Set([...THEME_BASE, ...THEME_OPTIONAL]).size, THEME_BASE.length + THEME_OPTIONAL.length);
});

test('both sets are sent, each under its own selector, the default one also covering no attribute', () => {
  const css = themeCss({ light: LIGHT, dark: DARK }, 'dark');
  assert.match(css, /:root:not\(\[data-theme-mode="light"\]\) \{[^}]*--surface-page: #111111;/);
  assert.match(css, /:root\[data-theme-mode="light"\] \{[^}]*--surface-page: #ffffff;/);
  const flipped = themeCss({ light: LIGHT, dark: DARK }, 'light');
  assert.match(flipped, /:root:not\(\[data-theme-mode="dark"\]\) \{[^}]*--surface-page: #ffffff;/);
  assert.match(flipped, /:root\[data-theme-mode="dark"\] \{[^}]*--surface-page: #111111;/);
  assert.doesNotMatch(css, /--bg:|--bg-section|--text:|--accent:/, 'no old token names are written for a role that has none of its own');
});

test('an optional color one mode sets stays in that mode', () => {
  const css = themeCss({ light: LIGHT, dark: DARK }, 'light');
  assert.doesNotMatch(blockOf(css, ':root[data-theme-mode="dark"]'), /--surface-bar-top/);
  assert.match(css, /--surface-bar-top: #eeeeee;/);
});

test("a null set writes nothing; an odd default mode reads as dark", () => {
  const css = themeCss({ light: LIGHT, dark: null }, 'nonsense');
  assert.doesNotMatch(css, /:root:not/);
  assert.match(css, /:root\[data-theme-mode="light"\]/);
  assert.notEqual(themeVersion({ light: LIGHT, dark: null }, 'dark'), themeVersion({ light: LIGHT, dark: null }, 'light'));
  assert.equal(themeCss({ light: null, dark: null }, 'dark'), '/* default mode: dark */\n');
});

test('an untouched environment: the default theme, the studio colours, both its sets sent', () => withStore((store) => {
  const sets = store.activeThemeSets();
  assert.equal(sets.dark['surface-page'], DEFAULT_THEME.dark['surface-page']);
  assert.equal(sets.light['surface-page'], DEFAULT_THEME.light['surface-page']);
  assert.equal(DEFAULT_THEME.light['surface-page'], '#fbf6ec', 'the studio\'s cream');
  assert.equal(DEFAULT_THEME.dark['surface-page'], '#0e1a2b', 'the studio\'s navy');
  assert.equal(store.settings.themeMode, 'dark');
  const css = themeCss(sets, 'dark');
  assert.match(blockOf(css, ':root:not([data-theme-mode="light"])'), /--surface-page: #0e1a2b;/);
}));

test('a theme with one set shows it in both modes', () => withStore((store) => {
  const theme = store.addTheme({ name: 'One', mode: 'light', ...LIGHT });
  store.updateSettings({ activeThemeId: theme.id });
  const sets = store.activeThemeSets();
  assert.equal(sets.light['surface-page'], '#ffffff');
  assert.equal(sets.dark['surface-page'], '#ffffff');
}));

test("the owner's default mode: light or dark only; anything else is refused and nothing changes", () => withStore((store) => {
  store.updateSettings({ themeMode: 'light' });
  assert.equal(store.settings.themeMode, 'light');
  assert.throws(() => store.updateSettings({ environmentName: 'Changed', themeMode: 'purple' }), /the mode is light or dark/);
  assert.equal(store.settings.themeMode, 'light');
  assert.notEqual(store.settings.environmentName, 'Changed');
}));

test("a person's own mode is kept on the account, survives a reload, and null follows the default again", () => withStore((store, dir) => {
  const user = store.addUser({ login: 'pat', role: 'member' });
  assert.equal(user.themeMode, undefined);
  assert.equal(store.setThemeMode(user.key, 'dark'), 'dark');
  assert.equal(store.setThemeMode(user.key, 'light'), 'light');
  store.save();
  const again = new Store(dir);
  assert.equal(again.userByKey(user.key).themeMode, 'light');
  assert.equal(again.setThemeMode(user.key, null), null);
  assert.equal('themeMode' in again.userByKey(user.key), false);
}));

test("a bad mode for a person is refused and changes nothing; an unknown account is a 404", () => withStore((store) => {
  const user = store.addUser({ login: 'sam', role: 'member' });
  store.setThemeMode(user.key, 'dark');
  for (const bad of ['Light', 'purple', '', 1, true, undefined, {}]) {
    assert.throws(() => store.setThemeMode(user.key, bad), /the mode is light or dark/);
  }
  assert.equal(store.userByKey(user.key).themeMode, 'dark');
  assert.throws(() => store.setThemeMode('nosuchkey', 'dark'), (err) => err.status === 404);
}));

test('a stored mode that is not light or dark is dropped on load', () => withStore((store, dir) => {
  const user = store.addUser({ login: 'lee', role: 'member' });
  store.save();
  const file = path.join(dir, 'app.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.users.find((u) => u.key === user.key).themeMode = 'sepia';
  fs.writeFileSync(file, JSON.stringify(raw));
  assert.equal('themeMode' in new Store(dir).userByKey(user.key), false);
}));

test('a set with the four top-bar keys writes them to /theme.css; one without them writes nothing for them', () => {
  const css = themeCss({ light: { ...LIGHT, ...NAV }, dark: DARK }, 'light');
  const light = blockOf(css, ':root:not([data-theme-mode="dark"])');
  for (const [key, value] of Object.entries(NAV)) assert.equal(prop(light, `--${key}`), value, key);
  assert.doesNotMatch(blockOf(css, ':root[data-theme-mode="dark"]'), /--surface-bar-|--text-bar-/);
  assert.doesNotMatch(themeCss({ light: LIGHT, dark: DARK }, 'dark'), /--surface-bar-brand|--text-bar-/);
  assert.doesNotMatch(themeCss({ light: { ...LIGHT, 'surface-bar-brand': null, 'text-bar-right': null }, dark: null }, 'dark'), /--surface-bar-brand|--text-bar-right/);
});

test('the optional keys: set by addTheme and updateTheme, a value that is not a color goes back to Auto (null), null puts one back on Auto', () => withStore((store) => {
  const theme = store.addTheme({ name: 'Nav', mode: 'light', ...LIGHT, ...NAV, 'surface-bar-right': 'red; background: url(x)' });
  assert.deepEqual(Object.fromEntries(Object.keys(NAV).map((k) => [k, theme.light[k]])), { ...NAV, 'surface-bar-right': null });
  store.updateTheme(theme.id, { mode: 'light', 'surface-bar-right': '#ABCDEF', 'text-bar-brand': null, 'surface-bar-brand': 'blue', 'status-warn-fill': '#aaaa22' });
  const after = store.themes.find((t) => t.id === theme.id).light;
  assert.deepEqual([after['surface-bar-right'], after['text-bar-brand'], after['surface-bar-brand'], after['text-bar-right'], after['status-warn-fill']], ['#abcdef', null, null, NAV['text-bar-right'], '#aaaa22']);
  store.updateSettings({ activeThemeId: theme.id });
  const css = themeCss(store.activeThemeSets(), 'light');
  assert.match(css, /--surface-bar-right: #abcdef;/);
  assert.doesNotMatch(css, /--surface-bar-brand|--text-bar-brand/);
}));

test('the old keys are not read: a set under the earlier names has no complete set', () => withStore((store) => {
  const old = { bg: '#ffffff', bgSection: '#f7f7f7', border: '#e0e0e0', text: '#333333', textDim: '#767676', accent: '#e45628', onAccent: '#ffffff' };
  assert.throws(() => store.addTheme({ name: 'Old', mode: 'light', ...old }), /every color is required/);
  assert.equal(store.sanitizeTheme({ id: 'x', name: 'Old', light: old, dark: old }), null);
  assert.equal(store.sanitizeTheme({ id: 'x', name: 'Old', ...old }), null);
}));

test('a stored theme in the format from before the roles is dropped on load: one line is logged, the default shows, nothing crashes', () => withStore((store, dir) => {
  const theme = store.addTheme({ name: 'Mine', mode: 'light', ...LIGHT });
  store.updateSettings({ activeThemeId: theme.id });
  store.save();
  const file = path.join(dir, 'app.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const old = { bg: '#ffffff', bgSection: '#f7f7f7', border: '#e0e0e0', text: '#333333', textDim: '#767676', accent: '#e45628', onAccent: '#ffffff' };
  const stored = raw.settings.themes.find((t) => t.id === theme.id);
  stored.light = old;
  stored.dark = null;
  const builtin = raw.settings.themes.find((t) => t.id === 'staying-blonde');
  builtin.light = old;
  builtin.dark = old;
  fs.writeFileSync(file, JSON.stringify(raw));
  const lines = [];
  const warn = console.warn;
  console.warn = (...args) => lines.push(args.join(' '));
  let again;
  try { again = new Store(dir); } finally { console.warn = warn; }
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /^themes: 2 saved themes in an older format could not be read and were removed$/);
  assert.equal(again.themes.some((t) => t.id === theme.id), false, 'the unreadable theme is gone');
  assert.equal(again.settings.activeThemeId, null, 'the default theme is live again');
  const teal = again.themes.find((t) => t.id === 'staying-blonde');
  assert.equal(teal.name, 'Calming Teal', 'a shipped theme is put back as shipped');
  assert.equal(teal.dark['accent-fill'], '#0dc9ca');
  assert.equal(themeCss(again.activeThemeSets(), 'dark').includes('--surface-page: #0e1a2b;'), true, 'the default theme is what /theme.css says');
  assert.equal(themeCss(new Store(dir).activeThemeSets(), 'dark'), themeCss(again.activeThemeSets(), 'dark'), 'and it stays that way');
}));

test('the colours the server picks are written with the set, and reach their contrast', () => {
  const css = themeCss({ light: set('#ffffff', '#f7f9fa', '#e1e8e8', '#333333', '#767676', '#0dc9ca', '#ffffff'), dark: null }, 'light');
  const body = blockOf(css, ':root:not([data-theme-mode="dark"])');
  // The theme's own text on the accent (white on teal, 1.9 : 1) is replaced by the pick.
  assert.equal(prop(body, '--text-on-accent'), '#0a0a0a');
  assert.ok(TC.contrast(prop(body, '--text-on-accent'), '#0dc9ca') >= 4.5);
  assert.ok(TC.contrast(prop(body, '--text-accent'), '#ffffff') >= 4.5 && TC.contrast(prop(body, '--text-accent'), '#f7f9fa') >= 4.5);
  for (const k of TC.STATUSES) {
    assert.ok(TC.contrast(prop(body, `--status-${k}-text`), '#ffffff') >= 4.5, k);
    assert.match(prop(body, `--status-${k}-on-fill`), /^#(ffffff|0a0a0a)$/);
  }
  assert.ok(TC.contrast(prop(body, '--status-ok-mark'), '#ffffff') >= 3);
  // A text on the accent that already reaches 4.5 : 1 is the theme's own, byte for byte.
  const coffee = themeCss({ light: null, dark: DEFAULT_THEME.dark }, 'dark');
  assert.equal(prop(blockOf(coffee, ':root:not([data-theme-mode="light"])'), '--text-on-accent'), '#0e1a2b');
  // The accent as text is the accent itself while it already reaches 4.5 : 1 on the page and on a panel.
  assert.equal(prop(blockOf(coffee, ':root:not([data-theme-mode="light"])'), '--text-accent'), '#5cc8cf');
});

test('when neither white nor near-black reaches 4.5 : 1 on the accent, the better one is written and the set says so', () => {
  const css = themeCss({ light: { ...DEFAULT_THEME.light, 'accent-fill': '#a8692a' }, dark: null }, 'light'); // an accent neither white nor near-black reaches 4.5 : 1 on (Strong Coffee's own old accent: white on #a8692a is 4.45)
  const body = blockOf(css, ':root:not([data-theme-mode="dark"])');
  assert.equal(prop(body, '--text-on-accent'), '#ffffff');
  assert.match(body, /\/\* flagged: Neither white nor near-black reaches 4\.5 : 1 on the accent\. \*\//);
  assert.doesNotMatch(themeCss({ light: null, dark: DEFAULT_THEME.dark }, 'dark'), /flagged/);
});

test('a status fill the theme sets is the fill its text and its text-on-fill are picked from; Auto uses the mode\'s own fill', () => {
  const css = themeCss({ light: { ...LIGHT, ...STATUS }, dark: DARK }, 'light');
  const light = blockOf(css, ':root:not([data-theme-mode="dark"])');
  for (const [key, value] of Object.entries(STATUS)) assert.equal(prop(light, `--${key}`), value, key);
  assert.doesNotMatch(blockOf(css, ':root[data-theme-mode="dark"]'), /--status-[a-z]+-fill/, 'the dark set did not set them');
  const auto = themeCss({ light: LIGHT, dark: DARK }, 'light');
  assert.doesNotMatch(auto, /--status-[a-z]+-fill/, 'Auto writes no fill (style.css and system.css have it)');
  const warn = (mode) => TC.resolve(mode === 'light' ? LIGHT : DARK, mode).fills.warn;
  assert.deepEqual([warn('light'), warn('dark')], ['#94680a', '#d9a93c']);
  assert.notEqual(prop(blockOf(auto, ':root:not([data-theme-mode="dark"])'), '--status-warn-text'), prop(blockOf(auto, ':root[data-theme-mode="dark"]'), '--status-warn-text'));
});

test('CSS typed into a color never reaches /theme.css, and every line it writes is a #rrggbb colour, a comment or a selector', () => withStore((store) => {
  const theme = store.addTheme({ name: 'Evil', mode: 'light', ...LIGHT, 'icon-default': 'red; background: url(x)', 'status-info-fill': 'url(x)' });
  store.updateSettings({ activeThemeId: theme.id });
  const css = themeCss(store.activeThemeSets(), 'light');
  assert.doesNotMatch(css, /url\(|red/);
  for (const line of css.split('\n')) assert.match(line, /^( {2}--[a-z-]+: #[0-9a-f]{6};| {2}\/\* flagged: [^*]*\*\/|\/\* default mode: (light|dark) \*\/|:root[^{]*\{|\})?$/, line);
}));

test('the old tokens that a role has its own default for are also written when the theme sets the role (scaffolding, deleted with the old tokens)', () => {
  const css = themeCss({ light: { ...LIGHT, 'surface-card': '#123456', 'surface-field': '#567890', 'fill-secondary': '#234567', 'fill-secondary-hover': '#345678', 'icon-default': '#456789' }, dark: null }, 'light');
  const body = blockOf(css, ':root:not([data-theme-mode="dark"])');
  for (const [role, old, value] of [['surface-card', '--bg-card', '#123456'], ['fill-secondary', '--secondary', '#234567'], ['fill-secondary-hover', '--secondary-hover', '#345678'], ['icon-default', '--icon', '#456789'], ['surface-field', '--bg-input', '#567890']]) {
    assert.equal(prop(body, `--${role}`), value, role);
    assert.equal(prop(body, old), value, old);
  }
  assert.deepEqual(Object.keys(TC.LEGACY).sort(), ['fill-secondary', 'fill-secondary-hover', 'icon-default', 'surface-card', 'surface-field']);
});

test('style.css has the default theme dark set as the default of the base roles, and the old tokens are defined from the roles', () => {
  const style = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const root = /^:root \{([\s\S]*?)\n\}/m.exec(style)[1];
  for (const key of THEME_BASE) assert.ok(root.includes(`--${key}: ${DEFAULT_THEME.dark[key]};`), `--${key}`);
  for (const [old, role] of [['--bg', 'surface-page'], ['--bg-section', 'surface-panel'], ['--border', 'edge-hairline'], ['--text', 'text-primary'], ['--text-dim', 'text-muted'], ['--accent', 'accent-fill'], ['--on-accent', 'text-on-accent']]) {
    assert.ok(root.includes(`${old}: var(--${role});`), `${old} is defined from --${role}`);
  }
  assert.doesNotMatch(root, /--(bg|bg-section|border|text|text-dim|accent|on-accent|ok|danger):\s*#/, 'no old token holds a colour of its own');
});

test("the theme editor's fields: a row for every optional key in the same order, the status fills among them, each with its Auto box", () => {
  const admin = fs.readFileSync(new URL('../public/admin.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
  const base = admin.match(/const THEME_FIELDS = \[([\s\S]*?)\n\];/);
  assert.ok(base, 'THEME_FIELDS');
  assert.deepEqual([...base[1].matchAll(/\['([\w-]+)', '--([\w-]+)', '([\w-]+)'\]/g)].map((m) => m[3]), THEME_BASE);
  for (const m of base[1].matchAll(/\['([\w-]+)', '--([\w-]+)', '([\w-]+)'\]/g)) assert.equal(m[2], m[3], 'the CSS property is the role');
  const list = admin.match(/const THEME_OPTIONAL_FIELDS = \[([\s\S]*?)\n\]\.map/);
  assert.ok(list, 'THEME_OPTIONAL_FIELDS');
  const rows = [...list[1].matchAll(/\['([\w-]+)', '([\w-]+)'\]/g)].map((m) => m.slice(1));
  assert.deepEqual(rows.map((r) => r[1]), THEME_OPTIONAL, 'the editor has a field for every optional key, in the same order');
  for (const [id] of rows) assert.ok(new RegExp(`<label>(?:<span data-word="module" data-word-form="cap"></span>)?[^<]+<input id="${id}" type="color"></label><label class="sdk-choice-row"><input type="checkbox" data-auto-for="${id}"><span class="sdk-choice-text">Auto</span></label>`).test(html), `${id} row with its Auto box`);
});

test("the theme editor's contrast panel: the pairs it lists, a warning for each under 4.5 (text) or 3 (a mark), and the Auto-fix for the text on the accent", () => {
  const html = fs.readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
  const admin = fs.readFileSync(new URL('../public/admin.js', import.meta.url), 'utf8');
  assert.match(html, /<div class="theme-contrast" id="theme-contrast" role="status" aria-live="polite"><\/div>/);
  assert.match(html, /<script src="\/theme-colour\.js"><\/script>/, 'the picks are loaded by the page');
  assert.match(admin, /renderThemeContrast\(\);/, 'the panel is drawn on every change');
  assert.match(admin, /data-fix-on-accent|fixOnAccent/, 'the Auto-fix button');
  // Calming Teal, light: white text on the teal (1.9 : 1) is replaced by the pick (Auto-fix shows it); the accent as a mark is under 3 : 1.
  const teal = TC.resolve({ ...set('#ffffff', '#f7f9fa', '#e1e8e8', '#333333', '#767676', '#0dc9ca', '#ffffff') }, 'light');
  const byId = (id) => teal.report.find((r) => r.id === id);
  assert.deepEqual([byId('on-accent').picked, byId('on-accent').pick, byId('on-accent').ok], [true, '#0a0a0a', true]);
  assert.ok(byId('on-accent').own < 4.5, 'the colour the theme typed is the one that falls short');
  assert.equal(byId('accent-mark-on-page').ok, false);
  assert.ok(byId('accent-mark-on-page').ratio < 3);
  assert.equal(byId('border-on-page').min, 0, 'the border has no minimum');
  for (const id of ['text-on-page', 'text-on-panel', 'muted-on-page', 'muted-on-panel', 'accent-text-on-page', 'accent-text-on-panel', 'on-accent', 'danger-on-fill', 'ok-on-fill', 'warn-on-fill', 'info-on-fill', 'ok-mark']) assert.ok(byId(id), `the report has ${id}`);
  // Text that already reads is not touched and nothing is flagged.
  const fine = TC.resolve({ ...DEFAULT_THEME.dark }, 'dark');
  assert.deepEqual([fine.report.find((r) => r.id === 'on-accent').picked, fine.flags], [false, []]);
  // A text colour under 4.5 : 1 on the page is a warning row.
  const dim = TC.resolve({ ...DEFAULT_THEME.dark, 'text-muted': '#3b2e24' }, 'dark');
  assert.equal(dim.report.find((r) => r.id === 'muted-on-page').ok, false);
  // A mid-grey accent that neither white nor near-black reaches 4.5 : 1 on is flagged.
  const mid = TC.resolve({ ...DEFAULT_THEME.dark, 'accent-fill': '#777777', 'text-on-accent': '#ffffff' }, 'dark');
  assert.equal(mid.report.find((r) => r.id === 'on-accent').ok, false);
  assert.match(mid.flags[0], /Neither white nor near-black/);
});

test('the tones: style.css reads each --tone-* with the fixed colour as its fallback, in both modes, and theme-colour.js TONE_AUTO holds the same colours', () => {
  const style = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const found = { dark: {}, light: {} };
  const all = [...style.matchAll(/^ {2}--tint-(gold|blue|green|teal|purple|red|orange|pink): var\(--tone-\1, (#[0-9a-f]{6})\);/gm)];
  assert.equal(all.length, 16, 'eight tints in each of the two blocks, each from its tone');
  all.forEach((m, i) => { found[i < 8 ? 'dark' : 'light'][m[1]] = m[2]; });
  assert.deepEqual(found, TC.TONE_AUTO);
});

console.log(`check-theme: ${n} checks passed`);
