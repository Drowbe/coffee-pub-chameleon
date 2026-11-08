// We never hard-code a radius. Every border-radius in the product is one of five theme tokens, defined once on :root
// (public/style.css, and public/sdk/host.css for a module's page): --radius-min, -small, -medium, -large, -round.
// This check fails on any border-radius value that is not var(--radius-*), 0, inherit or unset, in every product CSS
// file and in the inline styles in JS and HTML (style strings, el.style.borderRadius), and when a token is missing
// from :root of either file. SVG rx/ry is not a CSS radius and is not read.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS = ['--radius-min', '--radius-small', '--radius-medium', '--radius-large', '--radius-round'];

// What cannot use a token, each with its reason. A whole file (a vendored library) or one exact value in one file.
const ALLOW_FILES = {
  'modules/maps/src/maps-lib-a-maplibre.css': 'MapLibre GL\'s own minified stylesheet (third-party, replaced whole on upgrade)',
  'modules/maps/src/maps-lib-a-maplibre.js': 'MapLibre GL\'s own minified bundle (third-party, replaced whole on upgrade)',
};
const ALLOW_VALUES = [
  { file: 'modules/maps/src/maps.css', value: '50% 50% 50% 4px', why: 'the map pin is a teardrop: a circle with one square-ish corner; CSS scales every corner by the same factor when the radii overflow, so 999px would shrink the 4px corner away' },
  { file: 'modules/travel/src/travel-lib-cards.css', value: '50% 50% 50% 4px', why: 'the same teardrop pin shape on the place badge' },
];

const SKIP_DIRS = new Set(['node_modules', 'design', 'fa', 'vendor', '.git']);
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(css|js|html)$/.test(e.name)) out.push(p);
  }
}
const files = [];
walk(path.join(root, 'public'), files);
for (const m of fs.readdirSync(path.join(root, 'modules'))) {
  const src = path.join(root, 'modules', m, 'src');
  if (fs.existsSync(src)) walk(src, files);
}

const OK_PART = /^(var\(--radius-(min|small|medium|large|round)\)|0|inherit|unset)$/;
const re = /border(?:-(?:top|bottom)-(?:left|right))?-radius\s*:\s*([^;}"'`]+)/g;
const bad = [];
let seen = 0;
for (const f of files) {
  const rel = path.relative(root, f).split(path.sep).join('/');
  if (ALLOW_FILES[rel]) continue;
  const text = fs.readFileSync(f, 'utf8');
  for (const m of text.matchAll(re)) {
    seen++;
    const value = m[1].replace(/\s*!important\s*$/, '').trim();
    if (value.split(/\s+/).every((p) => OK_PART.test(p))) continue;
    if (ALLOW_VALUES.some((a) => a.file === rel && a.value === value)) continue;
    const line = text.slice(0, m.index).split('\n').length;
    bad.push(`${rel}:${line}  border-radius: ${value}`);
  }
  // el.style.borderRadius = '6px' and { borderRadius: '6px' }
  for (const m of text.matchAll(/\bborder(?:Top|Bottom)?(?:Left|Right)?Radius\s*[=:]\s*(['"`])([^'"`]*)\1/g)) {
    seen++;
    const value = m[2].trim();
    if (value.split(/\s+/).every((p) => OK_PART.test(p))) continue;
    const line = text.slice(0, m.index).split('\n').length;
    bad.push(`${rel}:${line}  borderRadius = ${value}`);
  }
}
assert.deepEqual(bad, [], `a radius that is not a token (use var(--radius-min|small|medium|large|round)):\n  ${bad.join('\n  ')}`);
assert.ok(seen > 100, 'the scanner found the radii it should');

for (const css of ['public/style.css', 'public/sdk/host.css']) {
  const text = fs.readFileSync(path.join(root, css), 'utf8');
  const rootBlock = text.match(/(^|\n):root \{([\s\S]*?)\n\}/);
  assert.ok(rootBlock, `${css} has a :root block`);
  for (const t of TOKENS) {
    assert.match(rootBlock[2], new RegExp(`\\n\\s*${t}:\\s*[0-9]+px;`), `${css} :root defines ${t}`);
  }
}
const values = (css) => TOKENS.map((t) => fs.readFileSync(path.join(root, css), 'utf8').match(new RegExp(`${t}:\\s*([0-9]+px)`))[1]).join();
assert.equal(values('public/style.css'), values('public/sdk/host.css'), 'the radius tokens are the same in style.css and host.css');

console.log(`check-radius: ${seen} radii in ${files.length} files, all tokens`);

// ---- --radius-round is for true circles only (Thomas, 2026-10-29: no pills) ----
// A circle: an avatar or portrait, a status dot, a round icon button that is a square box, the toggle switch, a progress
// bar (and the range track) and the microphone's fill. The count (.sdk-badge) is the one circle drawn another way: its corner
// is --radius-small and a clip cuts it to a circle only while it is one digit (asserted below). Every
// rectangle with words in it (a chip, tag, filter chip, status label, phase chip, marker, day chip, nav badge, search
// field, button) takes --radius-small. So var(--radius-round) may stand only in the rules listed here, each by its file and
// selector with the reason it is a circle, and only as many times as listed: a new use fails, and an entry no longer used
// fails too (take it out), so the list only shrinks.
const ROUND_SKIP = {
  'public/design-system/sources.js': 'a generated snapshot of the modules\' sources (tools/design-system-snapshot.mjs), not CSS that is served',
};
const ROUND_SKIP_DIRS = ['public/design-system/legacy/']; // the archived first proposals, kept as they were
const ROUND_OK = [
  // public/sdk/system.css
  { file: 'public/sdk/system.css', sel: ':is(.sdk-tabs, .tb-tabs, .subtabs, .setup-tabs, .layout-tabs) > :is(.sdk-tab, .tb-tab, .subtab, .setup-tab, .core-link) > :is(.sdk-tab-dot, .setup-tab-dot)', why: 'a 7px dot on a tab' },
  { file: 'public/sdk/system.css', sel: '.sdk-chip-dot', why: 'a 7px dot in a chip' },
  { file: 'public/sdk/system.css', sel: '.sdk-badge-micro', why: 'the corner count: the count\'s 14px circle on an icon' },
  { file: 'public/sdk/system.css', sel: '.sdk-dot', why: 'a 7px dot' },
  { file: 'public/sdk/system.css', sel: '.sdk-card-icon', why: 'the card\'s icon: a solid 36px disc (a square box, a true circle)' },
  { file: 'public/sdk/system.css', sel: '.sdk-avatar', why: 'an avatar' },
  { file: 'public/sdk/system.css', sel: '.sdk-avatar > img', why: 'an avatar\'s picture' },
  { file: 'public/sdk/system.css', sel: '.sdk-member-dot', why: 'the online dot on a member tile' },
  { file: 'public/sdk/system.css', sel: '.sdk-cal-compact .sdk-cal-event', why: 'an event as a 7px dot in the compact month' },
  { file: 'public/sdk/system.css', sel: '.sdk-daychip::after', why: 'the 4px today dot under a day chip\'s number' },
  { file: 'public/sdk/system.css', sel: '.sdk-daychip-dot', why: 'a 7px dot in a day chip\'s corner' },
  { file: 'public/sdk/system.css', sel: 'input[type="range"]::-webkit-slider-runnable-track', why: 'the range track: a bar, as the progress bar' },
  { file: 'public/sdk/system.css', sel: 'input[type="range"]::-moz-range-track', why: 'the range track: a bar, as the progress bar' },
  { file: 'public/sdk/system.css', sel: 'input[type="range"]::-webkit-slider-thumb', why: 'the range thumb: a circle' },
  { file: 'public/sdk/system.css', sel: 'input[type="range"]::-moz-range-thumb', why: 'the range thumb: a circle' },
  { file: 'public/sdk/system.css', sel: ':where(input[type="radio"])', why: 'a radio button' },
  { file: 'public/sdk/system.css', sel: 'input[type="radio"]::before', why: 'a radio button\'s dot' },
  { file: 'public/sdk/system.css', sel: 'input[type="checkbox"].sdk-switch', why: 'the toggle switch' },
  { file: 'public/sdk/system.css', sel: 'input[type="checkbox"].sdk-switch::before', why: 'the toggle switch\'s knob' },
  { file: 'public/sdk/system.css', sel: '.sdk-strip-dot', why: 'the phase\'s 10px dot in the phase chip' },
  { file: 'public/sdk/system.css', sel: '.host-menu-switch', why: 'the toggle switch in a menu row' },
  { file: 'public/sdk/system.css', sel: '.host-menu-switch::before', why: 'its knob' },
  { file: 'public/sdk/system.css', sel: '.message-portrait', why: 'a chat message\'s portrait' },
  { file: 'public/sdk/system.css', sel: '.sdk-swatch > i', why: 'the 16px tick on a chosen colour swatch' },
  { file: 'public/sdk/system.css', sel: '.sdk-banner-icon', why: 'a banner\'s 20px icon disc' },
  { file: 'public/sdk/system.css', sel: '.sdk-skel-dot', why: 'the skeleton\'s 32px avatar' },
  { file: 'public/sdk/system.css', sel: '.sdk-spinner', why: 'the spinner\'s ring' },
  { file: 'public/sdk/system.css', sel: '.sdk-progress', why: 'the progress bar' },
  { file: 'public/sdk/system.css', sel: '.sdk-progress-fill', why: 'the progress bar\'s fill' },
  { file: 'public/sdk/system.css', sel: '.sdk-progress .sdk-progress-planned', why: 'the progress bar\'s planned share' },
  { file: 'public/sdk/system.css', sel: 'progress.sdk-progress::-webkit-progress-value', why: 'the progress bar\'s fill' },
  { file: 'public/sdk/system.css', sel: 'progress.sdk-progress::-moz-progress-bar', why: 'the progress bar\'s fill' },
  { file: 'public/sdk/system.css', sel: '.sdk-mic', why: 'the microphone\'s 40px circle and its level fill' },
  { file: 'public/sdk/system.css', sel: '.mf-empty-icon', why: 'the empty state\'s icon disc' },
  // public/style.css
  { file: 'public/style.css', sel: '.sdk-member .call-mark', why: 'the 15px on-the-call mark on a member tile' },
  { file: 'public/style.css', sel: '.whoami img', why: 'your picture in the top bar' },
  { file: 'public/start.css', sel: '.sp-theme', why: 'the start page\'s light and dark button: a 44px square box, a true circle' },
  { file: 'public/style.css', sel: '.tile.has-bg-image .placeholder', why: 'a call tile\'s round picture' },
  { file: 'public/style.css', sel: '.dot', why: 'a 10px status dot' },
  { file: 'public/style.css', sel: '.fbtn', why: 'the call toolbar\'s round buttons (check-buttons holds it)' },
  { file: 'public/style.css', sel: '.fbtn-caret', why: 'the 12px caret disc on a call button' },
  { file: 'public/style.css', sel: '.fbtn.ptt .glyph::after', why: 'a 7px dot' },
  { file: 'public/style.css', sel: '.tile-aside', why: 'a 34px round button on a call tile' },
  { file: 'public/style.css', sel: '.tile-admin-btn', why: 'a 34px round button on a call tile' },
  { file: 'public/style.css', sel: '.tile-pip', why: 'a 26px round button on a call tile' },
  { file: 'public/style.css', sel: '.theme-mode-track', why: 'the light and dark toggle switch' },
  { file: 'public/style.css', sel: '.theme-mode-knob', why: 'its knob' },
  { file: 'public/style.css', sel: '.topbar .topbar-theme-mode .theme-mode-track', why: 'the toggle switch in the top bar' },
  { file: 'public/style.css', sel: '.slot-remove', why: 'a 22px round remove button' },
  { file: 'public/style.css', sel: '.module-editor-close', why: 'a 36px round close button' },
  { file: 'public/style.css', sel: '.whos-around .dashboard-person-where::before', why: 'a 7px dot' },
  { file: 'public/style.css', sel: '.slot-paste', why: 'a 22px round paste button' },
  { file: 'public/style.css', sel: '.setup-member-face', why: 'a member\'s picture' },
  { file: 'public/style.css', sel: '.side-column-rail-face', why: 'a face on the collapsed column\'s rail' },
  // public/sdk/host.css
  { file: 'public/sdk/host.css', sel: '.sdk-kind-chip', why: 'the kind\'s 26px icon disc' },
  // public/design-system/ds.css (the catalog's own pages)
  { file: 'public/design-system/ds.css', sel: '.ds-bar', why: 'an 8px bar, as the progress bar' },
  // modules
  { file: 'modules/budget/src/budget.css', sel: '.mark', why: 'a 24px icon disc' },
  { file: 'modules/budget/src/budget.css', sel: '.avatar', why: 'a person\'s 26px initials' },
  { file: 'modules/calendar/src/calendar-widget.css', sel: '.mini-day.has::after', why: 'a 5px dot' },
  { file: 'public/design-system/prototype-phone.css', sel: '.ph .ph-round-disc', why: 'the Prototype\'s round More button: a 44px disc inset in its 56px target (the bar\'s switcher, option B)' },
  { file: 'public/design-system/prototype-phone.css', sel: '.ph-callbtn .ph-dot', why: 'the Prototype\'s live dot on the call button: an 8px disc' },
  { file: 'modules/maps/src/maps.css', sel: '.pin-badge', why: 'a 16px disc on a pin' },
  { file: 'modules/maps/src/maps.css', sel: '.pin.cluster .pin-body', why: 'a 38px cluster circle' },
  { file: 'modules/maps/src/maps.css', sel: '.pin[data-scope="person"]::after', why: 'a 12px person mark' },
  { file: 'modules/places/src/places.css', sel: '.owner', why: 'a person\'s 20px initials' },
  { file: 'modules/places/src/places.css', sel: '.found-row .mark', why: 'a 32px icon disc' },
  { file: 'modules/places/src/places.css', sel: '.found-row .source::before', why: 'a 6px dot' },
  { file: 'modules/places/src/places.css', sel: '.look-dot', why: 'an 18px colour dot' },
  { file: 'modules/research/src/research.css', sel: '.rcard .by span', why: 'a person\'s 18px initials' },
  { file: 'modules/research/src/research.css', sel: '.upload progress', why: 'a progress bar' },
  { file: 'modules/stream/src/stream.css', sel: '.avatar', why: 'an avatar' },
  { file: 'modules/travel/src/travel-lib-cards.css', sel: '.rail .dot', why: 'a 12px dot on the day rail' },
  { file: 'modules/travel/src/travel-lib-cards.css', sel: '.owner', why: 'a person\'s 20px initials' },
  { file: 'modules/travel/src/travel-lib-cards.css', sel: ':is(.pass, .admit) .stub::before, :is(.pass, .admit) .stub::after', why: 'the ticket stub\'s two 16px notches' },
  { file: 'modules/travel/src/travel-lib-cards.css', sel: '.jointadd', why: 'a 24px round add button' },
];

// Comments and quoted strings blanked to spaces (same length), so a brace or the token in them is not read.
export function blankCss(text) {
  return text.replace(/\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, (m) => m.replace(/[^\n]/g, ' '));
}
// The selector of the rule each var(--radius-round) stands in: back to its unclosed "{", then back to the "{", "}" or ";"
// before that. Returns [{ sel, line }].
export function roundUses(text) {
  const t = blankCss(text);
  const out = [];
  for (const m of t.matchAll(/var\(\s*--radius-round\s*\)/g)) {
    let k = m.index - 1;
    for (let depth = 0; k >= 0; k--) {
      if (t[k] === '}') depth++;
      else if (t[k] === '{') { if (depth === 0) break; depth--; }
    }
    let s = k - 1;
    while (s >= 0 && !'{};'.includes(t[s])) s--;
    const sel = k < 0 ? '' : text.slice(s + 1, k).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[\s\S]*\*\//, '').replace(/\s+/g, ' ').trim();
    out.push({ sel, line: text.slice(0, m.index).split('\n').length });
  }
  return out;
}
// The uses not in the list, and the list's entries not used (each entry allows `n` uses, 1 unless it says).
export function roundProblems(uses, ok) {
  const left = new Map(ok.map((o) => [`${o.file}\n${o.sel}`, o.n || 1]));
  const bad = [];
  for (const u of uses) {
    const key = `${u.file}\n${u.sel}`;
    if ((left.get(key) || 0) > 0) left.set(key, left.get(key) - 1);
    else bad.push(`${u.file}:${u.line}  ${u.sel || '(no rule)'}  uses var(--radius-round): a rectangle takes var(--radius-small); a true circle goes in the list in tools/check-radius.mjs with its reason`);
  }
  for (const o of ok) if (left.get(`${o.file}\n${o.sel}`) === (o.n || 1)) bad.push(`${o.file}  ${o.sel}  is in the circles list but no longer uses var(--radius-round): take it out of the list`);
  return bad;
}

// Self-tests: a pill fails, a listed circle passes, a definition and a comment are not uses, an unused entry fails, a rule
// inside @media and over several lines is read, a count over the list fails.
{
  const css = ':root { --radius-round: 999px; }\n/* round: var(--radius-round) { } */\n.av { width: 20px;\n  border-radius: var(--radius-round); }\n@media (max-width: 640px) {\n  .a,\n  .b::after { border-radius: var( --radius-round ); }\n}\n.pill { content: "}"; border-radius: var(--radius-round); }';
  const uses = roundUses(css);
  assert.deepEqual(uses, [{ sel: '.av', line: 4 }, { sel: '.a, .b::after', line: 7 }, { sel: '.pill', line: 9 }], 'the selector of each use, with comments, strings and definitions left out');
  const f = (u) => u.map((x) => ({ ...x, file: 'x.css' }));
  assert.equal(roundProblems(f(uses), [{ file: 'x.css', sel: '.av' }, { file: 'x.css', sel: '.a, .b::after' }]).length, 1, 'a pill that is not listed fails');
  assert.match(roundProblems(f(uses), [{ file: 'x.css', sel: '.av' }, { file: 'x.css', sel: '.a, .b::after' }])[0], /x\.css:9 {2}\.pill/);
  assert.deepEqual(roundProblems(f(uses), [{ file: 'x.css', sel: '.av' }, { file: 'x.css', sel: '.a, .b::after' }, { file: 'x.css', sel: '.pill' }]), [], 'every use listed passes');
  assert.equal(roundProblems(f(uses), [{ file: 'x.css', sel: '.av' }, { file: 'x.css', sel: '.a, .b::after' }, { file: 'x.css', sel: '.pill' }, { file: 'x.css', sel: '.gone' }]).length, 1, 'an entry no longer used fails');
  assert.equal(roundProblems(f([...uses, uses[0]]), [{ file: 'x.css', sel: '.av' }, { file: 'x.css', sel: '.a, .b::after' }, { file: 'x.css', sel: '.pill' }]).length, 1, 'a second use in a listed rule fails unless the entry says n: 2');
  assert.equal(roundProblems(f([{ sel: '.a', line: 1 }]), [{ file: 'y.css', sel: '.a' }]).length, 2, 'an entry is for its own file only');
}

{
  const uses = [];
  for (const f of files) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    if (ALLOW_FILES[rel] || ROUND_SKIP[rel] || ROUND_SKIP_DIRS.some((d) => rel.startsWith(d))) continue;
    const text = fs.readFileSync(f, 'utf8');
    if (!text.includes('--radius-round')) continue;
    if (rel.endsWith('.css')) for (const u of roundUses(text)) uses.push({ ...u, file: rel });
    else for (const m of text.matchAll(/var\(\s*--radius-round\s*\)/g)) uses.push({ file: rel, sel: '(a style in a script or a page)', line: text.slice(0, m.index).split('\n').length });
  }
  if (process.env.RADIUS_ROUND_LIST) for (const u of uses) console.log(`${u.file}:${u.line}\t${u.sel}`);
  const bad = roundProblems(uses, ROUND_OK);
  assert.deepEqual(bad, [], `--radius-round is for true circles only:\n  ${bad.join('\n  ')}`);
  console.log(`check-radius: ${uses.length} uses of --radius-round, every one a listed circle (${ROUND_OK.length} rules)`);
}

// The count (.sdk-badge): a circle for one digit only (Thomas, 2026-10-30). Its rule takes the small corner, and a clip that
// is the 50% circle while the box is the 18px square (one digit) and lets go of it from two digits up; see system.css.
{
  const sys = fs.readFileSync(path.join(root, 'public/sdk/system.css'), 'utf8');
  const rule = (sys.match(/\n\.sdk-badge \{[^}]*\}/) || [''])[0];
  assert.match(rule, /border-radius: var\(--radius-small\);/, 'the count (.sdk-badge) has the small corner: two or more digits are a box, never a pill');
  assert.match(rule, /min-width: 18px;[\s\S]*height: 18px;/, 'the count is 18px high and at least 18px wide: one digit is the square the circle is cut from');
  assert.match(rule, /clip-path: circle\(max\(50%, \(100% - 18\.5px\) \* 100\)\);/, 'the count is cut to a circle while it is one digit, and only then');
  console.log('check-radius: the count is a circle for one digit and a small-cornered box for two or more');
}
