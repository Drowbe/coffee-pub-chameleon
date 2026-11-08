#!/usr/bin/env node
// Drift guard: colours come from tokens (documentation/plans/plan-design-system.md, (e)).
// A hard-coded colour is a #hex, an rgb()/rgba()/hsl()/hsla()/hwb()/lab()/lch()/oklab()/oklch() with no var() inside, or a
// named colour (red, gold ...; not transparent, currentColor or inherit; named colours are only read in colour
// properties and in custom properties). A raw colour is an offender wherever it sits except in a token definition: the
// `:root` blocks, and the `:root[data-theme-mode=...]` / `:root[data-mode-shown=...]` blocks, of public/style.css,
// public/sdk/host.css and public/sdk/system.css (the server's theme code lives in server/ and is not read).
//
// Black and white used as a shadow or a scrim are counted apart, under the key "shadow-scrim", and are allowed for now:
// pure black or white (#000, #fff, rgba(0,0,0,.5), black, white) in a shadow or filter property, or with an alpha below
// 1, or as the mixing colour inside color-mix(). Anything else, including an opaque black or white text colour, is "raw".
//
// It reads public/*.css, public/sdk/*.css, modules/*/src/*.css and the CSS inside the .js files of public and
// modules/*/src (style strings, el.style.color, { background: '#fff' }, fill="#fff" attributes); not public/design-system
// or MapLibre. A colour a script keeps as plain data (a palette array) is not in a declaration and is not read; nor is a palette
// NAME that is the whole value of a quoted object property ({ fill: 'gold' }). A hex or rgb() there, an assignment
// (el.style.fill = 'gold') and an attribute (fill="gold") are still read.
//
// The admin theme editor's native colour inputs (public/admin.html, type="color") hold a colour the person picks and the code draws none, so there is nothing to read there.
// No page has a palette of its own: the start page too reads the theme tokens. @font-face blocks are not read.
// Today's offenders are recorded per file and kind in tools/check-no-raw-colours-allow.json. The check passes while no
// count is higher, fails on a higher count or a new file, and says when a count has dropped.
//   node tools/check-no-raw-colours.mjs                 the check
//   node tools/check-no-raw-colours.mjs --list          also print every hit, file:line
//   node tools/check-no-raw-colours.mjs --update        lower the allow-list to today's counts (never raises)
//   node tools/check-no-raw-colours.mjs --update --force-raise   also allow raising (how it was first made)
import { collectFiles, declarations, Tally, runRatchet, summary } from './lib/drift.mjs';

const TOKEN_FILES = new Set(['public/style.css', 'public/sdk/host.css', 'public/sdk/system.css']);
// :root, optionally with attribute and :not() parts, and nothing else (no descendant): a token definition.
const TOKEN_SELECTOR = /^:root(?:\[[^\]]*\]|:not\((?:[^()]|\([^()]*\))*\))*$/;

const NAMED = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' '));
const COLOUR_PROP = /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|outline(?:-color)?|box-shadow|text-shadow|text-decoration(?:-color)?|text-emphasis(?:-color)?|-webkit-text-stroke(?:-color)?|-webkit-text-fill-color|-webkit-tap-highlight-color|fill|stroke|stop-color|flood-color|lighting-color|caret-color|accent-color|column-rule(?:-color)?|scrollbar-color|filter|backdrop-filter|mask-image)$/;
const COLOUR_CUSTOM = /colou?r|bg|background|fill|stroke|border|shadow|accent|text|ink|tint|surface|scrim|overlay|glow|edge|line|dot/i;
const FUNC = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi;

// Take url(...) and quoted strings out of a value (kept the same length), so a "#fff" in a data URI or a content string is not read.
function plain(value) {
  return value
    .replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\)/gi, (m) => ' '.repeat(m.length))
    .replace(/(["'])(?:(?!\1).)*\1/g, (m) => ' '.repeat(m.length));
}

// Index of the ")" that closes the "(" at `open`, or -1.
function closeOf(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === '(') depth += 1;
    else if (s[i] === ')' && (depth -= 1) === 0) return i;
  }
  return -1;
}

// The colours in a value: [{ text, index, kind: 'hex' | 'func' | 'named' }].
function coloursIn(value, named) {
  const out = [];
  for (const m of value.matchAll(/(?<![\w&#/])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![\w-])/gi)) out.push({ text: m[0], index: m.index, kind: 'hex' });
  for (const m of value.matchAll(FUNC)) {
    const open = m.index + m[0].length - 1;
    const close = closeOf(value, open);
    if (close === -1) continue;
    const text = value.slice(m.index, close + 1);
    if (/\bvar\(/.test(text)) continue; // built from a token
    out.push({ text, index: m.index, kind: 'func' });
  }
  if (named) {
    for (const m of value.matchAll(/(?<![\w-])[a-z]+(?![\w-])/gi)) {
      if (NAMED.has(m[0].toLowerCase())) out.push({ text: m[0], index: m.index, kind: 'named' });
    }
  }
  return out;
}

// Pure black or white, with its alpha: { alpha } or null.
function blackOrWhite(c) {
  const t = c.text.toLowerCase().replace(/\s+/g, '');
  if (c.kind === 'named') return t === 'black' || t === 'white' ? { alpha: 1 } : null;
  if (c.kind === 'hex') {
    const h = t.slice(1);
    const full = h.length <= 4 ? [...h].map((x) => x + x).join('') : h;
    const rgb = full.slice(0, 6);
    if (rgb !== '000000' && rgb !== 'ffffff') return null;
    return { alpha: full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1 };
  }
  const m = /^(?:rgba?)\((\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)(?:[ ,/]+(\d*\.?\d+)(%?))?\)$/.exec(t);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map(Number);
  if (!((r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255))) return null;
  return { alpha: m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1) };
}

const LIST = process.argv.includes("--list"); // print every hit, file:line
const tally = new Tally();
const files = collectFiles();
for (const file of files) {
  for (const d of declarations(file)) {
    if (d.prop === 'value' || d.prop === 'css-text') continue; // an input's value; cssText is read as the declarations inside it
    if (file.kind === 'css' && TOKEN_FILES.has(file.rel) && d.selector.split(',').every((s) => TOKEN_SELECTOR.test(s.trim()))) continue;
    const value = plain(d.value);
    const named = COLOUR_PROP.test(d.prop) || (d.prop.startsWith('--') && COLOUR_CUSTOM.test(d.prop));
    // Spans of color-mix(...) so the white or black it mixes toward can be told.
    const mixes = [];
    for (const m of value.matchAll(/color-mix\(/gi)) mixes.push([m.index, closeOf(value, m.index + m[0].length - 1)]);
    for (const c of coloursIn(value, named)) {
      if (d.data && c.kind === 'named' && value.trim() === c.text) continue; // { fill: 'gold' }: a palette name kept as data
      const bw = blackOrWhite(c);
      const inMix = mixes.some(([a, b]) => c.index > a && c.index < b);
      const shadowProp = /shadow|filter/.test(d.prop);
      const scrim = bw && (shadowProp || bw.alpha < 1 || inMix);
      if (LIST) console.log(`${file.rel}:${d.line}  ${scrim ? "shadow-scrim" : "raw"}  ${d.prop}: ${c.text}`);
      tally.add(file.rel, scrim ? 'shadow-scrim' : 'raw', d.line);
    }
  }
}

const by = tally.byKey();
runRatchet({
  name: 'check-no-raw-colours',
  allowFile: 'check-no-raw-colours-allow.json',
  about: 'check-no-raw-colours: today\'s hard-coded colours outside the token blocks, per file. "raw" is a real colour to move onto a token; "shadow-scrim" is pure black or white used as a shadow or scrim (allowed for now). Counts may only fall; lower them with: node tools/check-no-raw-colours.mjs --update',
  tally,
  unit: 'hard-coded colours',
  extraReport: [`  raw: ${by.get('raw') || 0}, shadow-scrim: ${by.get('shadow-scrim') || 0}`, ...summary(tally, 'kind')],
});
