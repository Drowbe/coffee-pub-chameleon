#!/usr/bin/env node
/*
 * check-system-css.mjs -- the design system's shared stylesheet, public/sdk/system.css (plan-design-system.md, migration plan, steps 2 and 10).
 *
 * The file holds tokens, colour roles and font faces ONLY. Since step 8 the colour roles are live: the theme sets the base roles
 * (server/theme-css.js), system.css derives the rest by named formulas, and the old colour tokens that unmoved files read are defined
 * from the roles in style.css. This check holds that:
 *   1. The file parses (balanced braces, every declaration ends) and holds no raw colour: no hex, and the only rgb()/rgba() are the
 *      approved shadow and scrim defaults. Mixes use the keywords black, white and transparent.
 *   2. The approved tokens equal the approved values: spacing, type scale, weights, leading, tracking, shadows, scrim, layers,
 *      motion, icon sizes, breakpoints (and the three widths written out in the file's comment) and the layout tokens.
 *   3. Every colour role exists (the base roles in style.css, the rest here), none of the tokens defined here collides with a token
 *      defined anywhere else, no role here reads an old token, the Auto formulas the theme editor sets (public/theme-colour.js
 *      AUTO_CSS) are the formulas written here, and the Auto status fills are style.css's.
 *   4. Browser (Chromium over its DevTools protocol, as tools/check-design-system.mjs does; skipped, said so, when there is none):
 *      with the real style.css, the real /theme.css rules of the three shipped themes in light and dark, and system.css, every colour
 *      role resolves to a computed colour; each old token that is defined from a role equals it; a theme that sets a role the old
 *      token has its own default for (the card, the secondary fills, the icon) reaches the old token too; and the picked colours
 *      reach their contrast on the computed colours (text on the accent 4.5 unless flagged, text on each status fill 4.5, the accent
 *      and each status colour as text 4.5, the OK mark and the scrollbar thumb 3).
 *   5. Fonts (switched on in step 11): the faces exist; the app's pages read --font-ui (style.css) and display text reads
 *      --font-display; no stylesheet or page names a font host. In the browser, the sign-in page asks for the files its text
 *      uses and nothing else: Figtree's Latin file and Fraunces (its heading), from our own server, never Figtree's Latin
 *      Extended file (no such letters on the page), and both faces load. The font files and their licences are served.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const problems = [];
const fail = (m) => problems.push(m);

const raw = read('public/sdk/system.css');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

// ---- 1. parses, no raw colour ----
{
  let depth = 0;
  for (const ch of css) { if (ch === '{') depth += 1; if (ch === '}') depth -= 1; if (depth < 0) break; }
  if (depth !== 0) fail('system.css: unbalanced braces');
  if (/#[0-9a-fA-F]{3,8}\b/.test(css.replace(/url\([^)]*\)/g, ''))) fail(`system.css: a hex colour (${css.match(/#[0-9a-fA-F]{3,8}\b/)[0]}); colours come from the tokens`);
  if (/\b(hsla?|hwb|lab|lch|oklab|oklch)\(/i.test(css.replace(/oklch\(from /g, ''))) fail('system.css: a colour function other than color-mix, relative oklch(from ...) and the approved rgba defaults');
  const rgbas = [...css.matchAll(/rgba?\([^)]*\)/g)].map((m) => m[0].replace(/\s+/g, ''));
  const approved = new Set(['rgba(0,0,0,0.35)', 'rgba(0,0,0,0.55)']); // the three shadows (dark, 2026-10-21) and the scrim
  for (const r of rgbas) if (!approved.has(r)) fail(`system.css: ${r} is not an approved palette default`);
  const named = css.replace(/@font-face[^}]*\}/g, '').match(/:\s*(red|green|blue|gray|grey|orange|yellow|purple|pink|brown|cyan|magenta|navy|teal|gold)\b/gi);
  if (named) fail(`system.css: a named colour (${named[0]})`);
  // No rule other than :root, the light-mode block, the phone block and the font faces: no element or component rules, except
  // inside a family's block, which sits between `/* <id>:start */` and `/* <id>:end */` (a family step moves its rules in there).
  const outsideFamilies = raw.replace(/\/\* ([a-z]+):start \*\/[\s\S]*?\/\* \1:end \*\//g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const heads = [...outsideFamilies.matchAll(/(^|\})(\s*)([^{}\s@][^{}]*)\{/g)].map((m) => m[3].trim());
  for (const h of heads) {
    if (!/^:root(\[data-theme-mode="light"\],\s*:root\[data-mode-shown="light"\]:not\(\[data-theme-mode="dark"\]\))?$/.test(h) && h !== ':root') fail(`system.css: a rule outside :root: "${h}"`);
  }
}

// ---- the declarations of :root ----
const defs = new Map(); // name -> [values]
for (const m of css.replace(/@font-face\s*\{[^}]*\}/g, '').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/g)) {
  if (!defs.has(m[1])) defs.set(m[1], []);
  defs.get(m[1]).push(m[2].trim().replace(/\s+/g, ' '));
}
const first = (n) => (defs.get(n) || [])[0];

// ---- 2. the approved values ----
const APPROVED = {
  '--space-0': '2px', '--space-1': '4px', '--space-2': '8px', '--space-3': '12px', '--space-4': '16px', '--space-5': '20px', '--space-6': '24px', '--space-7': '32px', '--space-8': '40px', '--space-9': '48px',
  '--text-9': '9px', '--text-11': '11px', '--text-12': '12px', '--text-13': '13px', '--text-14': '14px', '--text-16': '16px', '--text-18': '18px', '--text-22': '22px', '--text-28': '28px', '--text-40': '40px',
  '--weight-regular': '400', '--weight-medium': '500', '--weight-strong': '600',
  '--leading-body': '1.45', '--leading-ui': '1', '--leading-display': '1.15', '--leading-title': '1.2', '--leading-section': '1.25',
  '--tracking-tight': '-0.01em', '--tracking-normal': '0', '--tracking-caps': '0.06em',
  '--shadow-1': '0 1px 4px rgba(0, 0, 0, 0.35)', '--shadow-2': '0 2px 8px rgba(0, 0, 0, 0.35)', '--shadow-3': '0 4px 16px rgba(0, 0, 0, 0.35)', '--scrim': 'rgba(0, 0, 0, 0.55)',
  '--z-content': '0', '--z-bar': '20', '--z-window': '25', '--z-float': 'var(--z-window)', '--z-page': '30', '--z-dialog': '40', '--z-popover': '50', '--z-toast': '60', '--z-debug': '100',
  '--motion-fast': '120ms', '--motion-base': '200ms', '--ease-out': 'cubic-bezier(0.2, 0, 0, 1)',
  '--icon-12': 'var(--text-12)', '--icon-14': 'var(--text-14)', '--icon-16': 'var(--text-16)', '--icon-20': '20px', '--icon-24': '24px',
  '--bp-narrow': '640px', '--bp-medium': '900px', '--bp-wide': '1200px',
  '--topbar-h': '44px', '--page-pad': '16px', '--measure-reading': '720px', '--page-max': '1200px', '--module-head-h': '34px', '--status-h': '24px', '--bottom-bar-h': '54px',
  '--bottom-bar-total': 'calc(var(--bottom-bar-h) + var(--safe-bottom))',
  '--font-system': '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  '--font-ui': '"Figtree", "Figtree Fallback", var(--font-system)',
  '--font-display': '"Fraunces", "Fraunces Fallback", "Figtree", "Figtree Fallback", var(--font-system)',
};
for (const [n, v] of Object.entries(APPROVED)) if (first(n) !== v) fail(`${n}: expected "${v}", found "${first(n) ?? 'nothing'}"`);
// z-menu (26), toolbar-h (34px) and the radii are kept where they are.
for (const n of ['--z-menu', '--toolbar-h', '--radius-min', '--radius-small', '--radius-medium', '--radius-large', '--radius-round']) if (defs.has(n)) fail(`${n} is defined elsewhere (style.css) and must not be redefined in system.css`);
// Breakpoints: the three widths are written out in the header comment, and every max-width query in the file is one of them.
if (!/BREAKPOINTS: 640 900 1200/.test(raw)) fail('system.css: the header comment must list "BREAKPOINTS: 640 900 1200"');
for (const m of css.matchAll(/@media[^{]*\((?:max|min)-width:\s*(\d+)px\)/g)) if (![640, 900, 1200].includes(Number(m[1]))) fail(`system.css: a media query at ${m[1]}px is not one of 640, 900, 1200`);
// The light-mode shadows are the text colour at 8, 10 and 10 percent.
const lightShadow = (n) => (defs.get(n) || [])[1];
if (lightShadow('--shadow-1') !== '0 1px 4px color-mix(in srgb, var(--text-primary) 8%, transparent)') fail('--shadow-1 light value changed');
if (lightShadow('--shadow-2') !== '0 2px 8px color-mix(in srgb, var(--text-primary) 10%, transparent)') fail('--shadow-2 light value changed');
if (lightShadow('--shadow-3') !== '0 4px 16px color-mix(in srgb, var(--text-primary) 10%, transparent)') fail('--shadow-3 light value changed');

// ---- 3. the colour roles ----
const TC = require('../public/theme-colour.js');
const { DEFAULT_THEME } = require('../server/store.js');
// The base roles a theme sets, with the default (Strong Coffee dark) in style.css, plus the two status fills that are not tints.
const BASE = ['surface-page', 'surface-panel', 'edge-hairline', 'text-primary', 'text-muted', 'accent-fill', 'text-on-accent', 'status-danger-fill', 'status-ok-fill'];
// The roles system.css derives (formulas), some of which /theme.css also writes (the picks) or a theme may set.
const DERIVED = [
  'surface-card', 'surface-field', 'surface-menu', 'surface-popover', 'surface-toast', 'surface-tooltip', 'surface-chat-own',
  'surface-toolbar', 'surface-bar-top', 'surface-bar-nav', 'surface-bar-brand', 'surface-bar-right', 'surface-canvas', 'surface-track',
  'text-disabled', 'text-bar', 'text-bar-brand', 'text-bar-right', 'text-on-secondary', 'text-accent', 'text-link', 'text-selected', 'text-tooltip', 'icon-default', 'icon-bar',
  'edge-field', 'edge-bar', 'edge-menu', 'scrollbar-thumb',
  'accent-fill-hover', 'fill-hover', 'fill-selected', 'fill-today', 'fill-secondary', 'fill-secondary-hover', 'focus-ring', 'overlay-scrim', 'shadow-color',
  'status-warn-fill', 'status-info-fill', 'status-ok-mark',
  ...['danger', 'ok', 'warn', 'info'].flatMap((k) => ['text', 'tint', 'on-fill'].map((p) => `status-${k}-${p}`)),
];
const ROLES = [...BASE, 'icon-hover', ...DERIVED]; // icon-hover is a role too, defined in style.css beside the icon tokens
const styleDefs = new Map();
for (const m of read('public/style.css').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/g)) {
  if (!styleDefs.has(m[1])) styleDefs.set(m[1], []);
  styleDefs.get(m[1]).push(m[2].trim().replace(/\s+/g, ' '));
}
for (const r of BASE) {
  if (!styleDefs.has(`--${r}`)) fail(`base role --${r} is not defined in style.css (its default is there)`);
  if (defs.has(`--${r}`)) fail(`base role --${r} is defined in system.css; its default belongs in style.css`);
}
if (!styleDefs.has('--icon-hover')) fail('--icon-hover (a role a theme may set) is not defined in style.css');
for (const r of DERIVED) if (!defs.has(`--${r}`)) fail(`derived colour role --${r} is missing from system.css`);
// The base defaults in style.css are Strong Coffee's dark set.
for (const key of Object.keys(DEFAULT_THEME.dark)) if (styleDefs.get(`--${key}`)?.[0] !== DEFAULT_THEME.dark[key]) fail(`style.css --${key} is ${styleDefs.get(`--${key}`)?.[0]}, Strong Coffee's dark set says ${DEFAULT_THEME.dark[key]}`);
// The Auto status fills the server and the editor use are the ones style.css draws.
{
  const [dangerDark, okDark] = [styleDefs.get('--status-danger-fill')?.[0], styleDefs.get('--status-ok-fill')?.[0]];
  if (dangerDark !== TC.STATUS_AUTO.dark.danger || dangerDark !== TC.STATUS_AUTO.light.danger) fail(`Auto danger fill: style.css ${dangerDark}, theme-colour.js ${TC.STATUS_AUTO.dark.danger}`);
  if (okDark !== TC.STATUS_AUTO.dark.ok || okDark !== TC.STATUS_AUTO.light.ok) fail(`Auto ok fill: style.css ${okDark}, theme-colour.js ${TC.STATUS_AUTO.dark.ok}`);
  for (const [k, tint] of [['warn', '--tint-gold'], ['info', '--tint-blue']]) {
    const [dark, light] = styleDefs.get(tint) || [];
    if (dark !== TC.STATUS_AUTO.dark[k] || light !== TC.STATUS_AUTO.light[k]) fail(`Auto ${k} fill: style.css ${tint} is ${dark} / ${light}, theme-colour.js ${TC.STATUS_AUTO.dark[k]} / ${TC.STATUS_AUTO.light[k]}`);
  }
}
// The formulas the editor sets for an Auto field are the formulas written for the role.
for (const [role, formula] of Object.entries(TC.AUTO_CSS)) {
  const written = (defs.get(`--${role}`) || styleDefs.get(`--${role}`) || [])[0];
  if (written !== formula) fail(`--${role}: theme-colour.js AUTO_CSS says "${formula}", the stylesheet says "${written}"`);
}
// The old colour tokens (defined in style.css from the roles, deleted when their last consumer moves) are not read by a role here.
const OLD_COLOUR = ['--bg', '--bg-section', '--bg-card', '--bg-input', '--text', '--text-dim', '--border', '--accent', '--on-accent', '--header-bg', '--header-text',
  '--nav-primary-bg', '--nav-brand-bg', '--nav-brand-text', '--nav-right-bg', '--nav-right-text', '--selected-bg', '--danger', '--ok', '--on-danger', '--danger-text',
  '--accent-hover', '--primary-hover', '--secondary', '--secondary-text', '--secondary-hover', '--surface', '--surface-hover', '--shade', '--icon'];
// Collisions: a token system.css defines must not be defined in any other stylesheet or by the theme writer.
{
  const others = new Map();
  const note = (n, where) => { if (!others.has(n)) others.set(n, where); };
  const files = ['public/style.css', 'public/sdk/host.css', 'public/start.css', 'public/destination.css', 'public/diag.css'];
  for (const dir of ['modules']) {
    const walk = (d) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else if (/\.(css|html)$/.test(e.name) && !p.includes(`${path.sep}design${path.sep}`)) files.push(p); } };
    walk(dir);
  }
  // The Buttons block's per-button properties (--b-*, --btn-h) are meant to be set on one button by a rule that lays it out.
  // The Chips block's tone and icon colour are set on one chip by the module that knows its colour (a category, a calendar, a tag). An avatar's size and the surface behind it are set by the place that draws it.
  // `--s` is the surface a box sits on, set on one box by the rule that knows it (system.css does so on every block that reads it; a module row may too).
  const PER_BUTTON = /^--(b-(bg|bg-h|bg-a|fg|fg-h|bd)|btn-h|btn-gap|btn-pad-x|chip-tone|chip-glyph|av|av-font|av-surface|s)$/;
  for (const f of files) for (const m of read(f).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[a-z0-9-]+)\s*:/g)) if (!PER_BUTTON.test(m[1])) note(m[1], f);
  for (const f of ['server/theme-css.js', 'public/theme-colour.js']) for (const m of read(f).matchAll(/'(--[a-z0-9-]+)'/g)) note(m[1], f);
  for (const n of defs.keys()) if (others.has(n)) fail(`${n} is defined in system.css and in ${others.get(n)}`);
  // Every var(--x) system.css reads is defined (in itself or in style.css, where the base roles are) and is not an old colour token.
  // The Journey bar block's per-element properties are written by space.js on one band, slice, tick, pin or tooltip, from
  // journeyLayout (public/journey-layout.js): its place (--x, --w, --pin-x), its progress (--p), the tooltip's arrow, and today's
  // place in a band of the phases sheet (--at, phase-sheet.js).
  // The Pickers block's colour is data, set on one swatch or colour trigger by public/colour-pick.js from its palette (--sw).
  // The banded card's --card-fill and --card-head-base are set on one box that sits on another surface (a card on a tinted area); no module has to.
  const PER_ELEMENT = ['--x', '--w', '--p', '--pin-x', '--arrow-x', '--at', '--sw', '--card-fill', '--card-head-base'];
  const known = new Set([...defs.keys(), ...others.keys(), ...PER_ELEMENT]);
  for (const m of css.matchAll(/var\((--[a-z0-9-]+)/g)) {
    if (!known.has(m[1])) fail(`system.css reads ${m[1]}, which is defined nowhere`);
    if (OLD_COLOUR.includes(m[1])) fail(`system.css reads the old token ${m[1]}; the roles are written in terms of the base roles`);
  }
}

// ---- fonts: files and faces ----
for (const f of ['figtree/latin.woff2', 'figtree/latin-ext.woff2', 'figtree/OFL.txt', 'fraunces/latin.woff2', 'fraunces/OFL.txt']) {
  if (!fs.existsSync(path.join(root, 'public/fonts', f))) fail(`public/fonts/${f} is missing`);
}
for (const m of raw.matchAll(/url\((\/fonts\/[^)]+)\)/g)) if (!fs.existsSync(path.join(root, 'public', m[1]))) fail(`system.css points at ${m[1]}, which is not in public/`);
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
if (faces.length !== 6) fail(`expected 6 @font-face rules (Figtree 2, its fallback 2, Fraunces 1, its fallback 1), found ${faces.length}`);
for (const f of faces) {
  if (/url\(/.test(f) && !/font-display:\s*swap/.test(f)) fail('a bundled @font-face without font-display: swap');
  if (!/ascent-override/.test(f) || !/descent-override/.test(f)) fail('an @font-face without its metric overrides');
}
if (!/size-adjust:\s*100\.59%/.test(css) || !/size-adjust:\s*95\.67%/.test(css) || !/size-adjust:\s*111\.60%/.test(css)) fail('a fallback face lost its size-adjust (100.59%, 95.67%, 111.60%)');
// Applied: the pages' own font is --font-ui, display text reads --font-display, and nothing names a font host.
{
  const style = read('public/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rootBlock = /:root\s*\{([^}]*)\}/.exec(style)?.[1] || '';
  if (!/font-family:\s*var\(--font-ui\)/.test(rootBlock)) fail('public/style.css: the page font (:root) is not var(--font-ui)');
  if (!/font-family:\s*var\(--font-display\)/.test(style)) fail('public/style.css: no display text reads var(--font-display)');
  if (!/var\(--font-ui\b/.test(read('public/sdk/host.css'))) fail('public/sdk/host.css does not read --font-ui');
  // The start page takes its fonts from system.css (the six faces and the two families), not a copy: it links system.css and names no face of its own.
  const start = read('public/start.css').replace(/\/\*[\s\S]*?\*\//g, '');
  if (!/href="\/sdk\/system\.css"/.test(read('public/start.html'))) fail('public/start.html: the page does not load system.css, where the fonts are');
  if (/@font-face/.test(start)) fail('public/start.css: it names a font face of its own; the faces are system.css\'s');
  if (!/\.sp-lockup-brand \{[^}]*var\(--font-display\)/.test(start) || !/\.sp-body \{[^}]*var\(--font-ui\)/.test(start)) fail('public/start.css: the page is not the UI face, or its lockup\'s brand word not the display face');
  const pages = fs.readdirSync(path.join(root, 'public')).filter((f) => /\.(css|html)$/.test(f)).map((f) => `public/${f}`);
  for (const f of [...pages, 'public/sdk/host.css', 'public/sdk/host.js', 'public/sdk/system.css']) {
    if (/fonts\.(googleapis|gstatic)\.com|use\.typekit|fonts\.bunny|@import\s+url\(\s*["']?https?:/i.test(read(f))) fail(`${f} names a font host; the fonts are ours (public/fonts)`);
  }
}

// ---- 4 and 5. the browser ----
function findBrowser() {
  const cands = [process.env.CHROME_PATH];
  const pw = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(pw)) for (const d of fs.readdirSync(pw).sort().reverse()) cands.push(path.join(pw, d, 'chrome-linux', 'chrome'), path.join(pw, d, 'chrome-linux', 'headless_shell'), path.join(pw, d, 'chrome-win', 'chrome.exe'), path.join(pw, d, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
  cands.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  return cands.find((c) => c && fs.existsSync(c)) || null;
}
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []; ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else if (m.method) for (const h of this.handlers) h(m); }); }
  send(method, params = {}, sessionId) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params, sessionId })); return new Promise((res, rej) => { this.pending.set(id, { res, rej }); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout: ' + method)); } }, 30000); }); }
}
async function launch(bin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sysc-chrome-'));
  const child = spawn(bin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let buf = ''; const t = setTimeout(() => reject(new Error('the browser did not start: ' + buf.slice(-300))), 20000);
    child.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); resolve(m[1]); } });
    child.on('exit', (c) => { clearTimeout(t); reject(new Error('the browser exited (' + c + ')')); });
  });
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('cannot reach the browser'))); });
  return { cdp: new Cdp(ws), child, dir };
}
function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); }); }
async function startServer() {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sysc-data-'));
  const child = spawn(process.execPath, ['server/index.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ADMIN_PASSWORD: 'testpass1234', BASE_DOMAIN: '' } });
  let log = ''; child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try { const r = await fetch(base + '/healthz'); if (r.ok) return { base, child, dataDir }; } catch { /* not up yet */ }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error('the throwaway server did not start: ' + log.slice(-300));
}

let note = '';
if (!problems.length) {
  const bin = findBrowser();
  if (!bin) note = ' (browser part SKIPPED: no Chromium found; set CHROME_PATH. This is not a pass)';
  else {
    const { themeCss } = require('../server/theme-css.js');
    const { Store } = require('../server/store.js');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sysc-store-'));
    const store = new Store(tmp);
    const themes = [{ name: 'Strong Coffee', ...store.defaultTheme }, ...store.themes];
    fs.rmSync(tmp, { recursive: true, force: true });
    if (themes.length < 3) fail(`expected the three shipped themes, found ${themes.length}`);
    const server = await startServer();
    const { cdp, child, dir } = await launch(bin);
    try {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Page.enable', {}, sessionId); await cdp.send('Network.enable', {}, sessionId);
      const requests = [];
      const statuses = new Map();
      cdp.handlers.push((m) => {
        if (m.sessionId !== sessionId) return;
        if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
        if (m.method === 'Network.responseReceived') statuses.set(m.params.response.url, m.params.response.status);
      });
      const ev = async (expression) => { const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
      // A normal page load: the sign-in page links style.css, theme.css and system.css.
      await cdp.send('Page.navigate', { url: `${server.base}/login` }, sessionId);
      for (let i = 0; i < 100 && !(await ev("document.readyState === 'complete'").catch(() => false)); i += 1) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 800));
      if (!requests.some((u) => u.endsWith('/sdk/system.css'))) fail('the sign-in page did not request /sdk/system.css');
      else if (statuses.get(`${server.base}/sdk/system.css`) !== 200) fail('/sdk/system.css was not served (200)');
      // Only the files the page's text uses, from our own server: Figtree Latin (the page) and Fraunces (its heading).
      await ev('document.fonts.ready.then(() => true)');
      const fontReqs = requests.filter((u) => /\/fonts\/|\.woff2?(\?|$)/.test(u) && !/\/fa\/webfonts\//.test(u));
      for (const u of fontReqs) if (!u.startsWith(`${server.base}/fonts/`)) fail(`a font was asked for from somewhere else: ${u}`);
      const want = ['/fonts/figtree/latin.woff2', '/fonts/fraunces/latin.woff2'];
      for (const w of want) if (!fontReqs.some((u) => u === server.base + w)) fail(`the sign-in page did not ask for ${w} (asked: ${fontReqs.join(', ') || 'none'})`);
      if (fontReqs.some((u) => u.endsWith('/fonts/figtree/latin-ext.woff2'))) fail('the sign-in page asked for Figtree\'s Latin Extended file, which its text does not use');
      if (new Set(fontReqs).size !== fontReqs.length) fail(`a font file was asked for twice: ${fontReqs.join(', ')}`);
      const faceInfo = await ev(`JSON.stringify([...document.fonts].map((f) => [f.family.replace(/"/g, ''), f.status, f.unicodeRange]).filter((x) => /Figtree|Fraunces/.test(x[0])))`);
      const faces = JSON.parse(faceInfo);
      if (faces.length < 6) fail(`the page registered ${faces.length} of 6 faces`);
      for (const fam of ['Figtree', 'Fraunces']) if (!faces.some((x) => x[0] === fam && x[1] === 'loaded')) fail(`${fam} did not load on the sign-in page: ${faceInfo}`);
      const used = await ev(`(() => { const h = document.querySelector('.brand.big > [data-brand="environmentName"]'); return JSON.stringify([getComputedStyle(document.body).fontFamily, h ? getComputedStyle(h).fontFamily : 'no heading at ' + location.pathname]); })()`);
      const [bodyFont, headFont] = JSON.parse(used);
      if (!/^"?Figtree"?,/.test(bodyFont)) fail(`the sign-in page's text is not Figtree: ${bodyFont}`);
      if (!/^"?Fraunces"?,/.test(headFont)) fail(`the sign-in page's heading is not Fraunces: ${headFont}`);
      // The files are served.
      for (const f of ['figtree/latin.woff2', 'figtree/latin-ext.woff2', 'figtree/OFL.txt', 'fraunces/latin.woff2', 'fraunces/OFL.txt']) {
        const r = await fetch(`${server.base}/fonts/${f}`); if (!r.ok) fail(`/fonts/${f} is not served (${r.status})`);
      }
      // The colour roles, in every shipped theme and both modes.
      const probe = `(${function probe(roles, themeRules, flagged, legacy) {
        const out = [];
        // The page's own /theme.css (the default theme, which sets optional roles) is off, so a theme tried here is judged alone, as it is when it is the live one.
        const own = [...document.querySelectorAll('link[rel="stylesheet"]')].filter((l) => /\/theme\.css/.test(l.getAttribute('href') || ''));
        for (const l of own) l.disabled = true;
        const style = document.createElement('style'); document.head.appendChild(style);
        const outer = document.createElement('div'); outer.style.color = 'rgb(1, 2, 3)'; // a role that does not resolve inherits this
        const inner = document.createElement('div'); outer.appendChild(inner); document.body.appendChild(outer);
        const colour = (expr) => { inner.style.color = ''; inner.style.cssText = `color: ${expr}`; return getComputedStyle(inner).color; };
        const parse = (c) => {
          const n = (c.match(/-?[\d.]+(?:e-?\d+)?%?/g) || []).map((x) => (x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x)));
          const k = /^color\(/.test(c) ? 255 : 1;
          return { r: n[0] * k, g: n[1] * k, b: n[2] * k, a: n.length > 3 ? n[3] : 1 };
        };
        const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
        const lum = (c) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
        const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const role = (r) => parse(colour(`var(--${r})`));
        // Each old token that is defined from a role equals the role (a theme that sets none of the roles that have their own old default).
        const SAME = [['--bg', '--surface-page'], ['--bg-section', '--surface-panel'], ['--border', '--edge-hairline'], ['--text', '--text-primary'], ['--text-dim', '--text-muted'],
          ['--accent', '--accent-fill'], ['--on-accent', '--text-on-accent'], ['--bg-input', '--surface-field'], ['--shade', '--surface-field'], ['--bg-card', '--surface-field'],
          ['--selected-bg', '--fill-selected'], ['--header-bg', '--surface-bar-top'], ['--header-text', '--text-bar'], ['--nav-brand-bg', '--surface-bar-brand'],
          ['--nav-right-bg', '--surface-bar-right'], ['--nav-brand-text', '--text-bar-brand'], ['--nav-right-text', '--text-bar-right'], ['--accent-hover', '--accent-fill-hover'],
          ['--primary-hover', '--accent-fill-hover'], ['--secondary-text', '--text-on-secondary'], ['--danger', '--status-danger-fill'], ['--ok', '--status-ok-fill'],
          ['--danger-text', '--status-danger-text'], ['--on-danger', '--status-danger-on-fill'], ['--icon-hover', '--accent-fill']];
        for (const [theme, rules] of themeRules) {
          for (const mode of ['light', 'dark']) {
            const at = `${theme} ${mode}`;
            style.textContent = rules; document.documentElement.setAttribute('data-theme-mode', mode);
            for (const r of roles) {
              const got = colour(`var(--${r})`);
              if (got === 'rgb(1, 2, 3)' || !/^(rgb|color)/.test(got)) out.push(`${at}: --${r} does not resolve (${got})`);
            }
            for (const [old, r] of SAME) { if (old === '--bg-card' && /--surface-card:/.test(rules)) continue; /* a theme that sets the card has its own old card token */ const a = colour(`var(${old})`); const b = colour(`var(${r})`); if (a !== b) out.push(`${at}: ${old} is ${a}, ${r} is ${b}`); }
            // The picked colours, on the colours the browser computes.
            const page = role('surface-page'); const panel = role('surface-panel');
            const min = (what, fg, bg, need) => { const x = ratio(fg.a < 1 ? over(fg, bg) : fg, bg); if (x < need - 0.005) out.push(`${at}: ${what} is ${x.toFixed(2)} : 1, needs ${need}`); };
            if (!flagged[`${at}|accent`]) min('text on the accent', role('text-on-accent'), role('accent-fill'), 4.5);
            min('the accent as text on the page', role('text-accent'), page, 4.5);
            min('the accent as text on a panel', role('text-accent'), panel, 4.5);
            for (const k of ['danger', 'ok', 'warn', 'info']) {
              const text = role(`status-${k}-text`);
              min(`the ${k} colour as text on the page`, text, page, 4.5);
              min(`the ${k} colour as text on a panel`, text, panel, 4.5);
              min(`the ${k} colour as text on its tint`, text, over(role(`status-${k}-tint`), panel), 4.5);
              if (!flagged[`${at}|${k}`]) min(`text on the ${k} fill`, role(`status-${k}-on-fill`), role(`status-${k}-fill`), 4.5);
            }
            min('the OK mark on the page', role('status-ok-mark'), page, 3);
            min('the OK mark on a panel', role('status-ok-mark'), panel, 3);
            min('the scrollbar thumb on its track', role('scrollbar-thumb'), role('surface-track'), 3);
          }
        }
        // A theme that sets the roles whose old token has a default of its own reaches the old token too.
        style.textContent = legacy.rules; document.documentElement.setAttribute('data-theme-mode', 'dark');
        for (const [old, want] of legacy.expect) { const got = colour(`var(${old})`); if (got !== colour(want)) out.push(`legacy: ${old} is ${got}, the theme set ${want}`); }
        style.remove(); outer.remove(); document.documentElement.removeAttribute('data-theme-mode');
        for (const l of own) l.disabled = false;
        return out;
      }})`;
      const themeRules = themes.map((t) => [t.name, themeCss({ light: t.light, dark: t.dark }, 'dark')]);
      const flagged = {};
      for (const t of themes) {
        for (const mode of ['light', 'dark']) {
          const got = t[mode] && TC.resolve(t[mode], mode);
          for (const f of got?.flags || []) flagged[`${t.name} ${mode}|${/accent/.test(f) ? 'accent' : Object.keys(TC.STATUS_WORD).find((k) => f.includes(`the ${TC.STATUS_WORD[k]} fill`))}`] = true;
        }
      }
      const legacySet = { ...DEFAULT_THEME.dark, 'surface-card': '#123456', 'fill-secondary': '#234567', 'fill-secondary-hover': '#345678', 'icon-default': '#456789' };
      const legacy = { rules: themeCss({ light: null, dark: legacySet }, 'dark'), expect: [['--bg-card', '#123456'], ['--secondary', '#234567'], ['--secondary-hover', '#345678'], ['--icon', '#456789'], ['--surface-card', '#123456'], ['--fill-secondary', '#234567']] };
      const bad = await ev(`JSON.stringify(${probe}(${JSON.stringify(ROLES)}, ${JSON.stringify(themeRules)}, ${JSON.stringify(flagged)}, ${JSON.stringify(legacy)}))`);
      for (const b of JSON.parse(bad)) fail(b);
    } finally {
      try { cdp.ws.close(); } catch { /* closing */ }
      const gone = (c) => (c.exitCode !== null ? Promise.resolve() : new Promise((r) => { c.once('exit', r); setTimeout(r, 3000); }));
      child.kill(); server.child.kill();
      await Promise.all([gone(child), gone(server.child)]);
      for (const d of [dir, server.dataDir]) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a temp folder left behind is harmless */ } }
    }
  }
}

if (problems.length) {
  console.error(`check-system-css: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`check-system-css: ok (${defs.size} tokens, ${ROLES.length} colour roles, ${faces.length} font faces, the fonts on, only the used files asked for)${note}`);
process.exit(0);
