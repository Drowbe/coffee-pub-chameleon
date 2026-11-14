// The screenshot tool (documentation/plans/plan-design-system.md, step 1): `npm run shots` renders the baseline, and
// `npm run shots:compare` renders the same set again and says which screens differ from it. It is NOT part of `npm run check`.
// Its job is to prove that a change meant to alter nothing a person sees altered nothing.
//
// What it does. It starts a throwaway server (a free port or SHOTS_PORT, DATA_DIR under the system temp folder, its own process,
// stopped at the end) and seeds a travel-template environment through the server's own API (tools/shots-seed.mjs: an admin and
// three members, three trips, chat with an AI answer, a link card and suggestion cards, Planner objects of every kind and
// markers, Places, To-do, Polls, Calendar, Budget, Research, phases on fixed dates). It then drives headless Chromium over its
// DevTools protocol (Node's built-in WebSocket, no dependency, as tools/check-forms-live.mjs does) and photographs every screen in
// tools/shots-screens.json, each in a browser context of its own (no cookie or storage shared), at the sizes and in the light and
// dark modes its tier names (core: 1280, 700 and 390 px, light and dark; state, for open menus, editors and error lines: 1280 and
// 390 px, light and dark). Both modes of a screen come from one load: the page is photographed in light, then switched with its
// own mode switch and photographed in dark.
//
// The screens table. tools/shots-screens.json is { tiers, screens }; add a screen by adding a row and running `npm run shots`
// again. A row: id (the file name), family (what it shows, for the report), as (admin, mia, sam, lee or none: whom the browser is
// signed in as; mia moderates the first trip, lee has no trip), url (with {trip}, {second}, {mia}, {sam} for the seeded ids), wait
// (a selector that must appear), steps (click, hover, wait, waitGone, scroll, type [selector, text], key, eval, sleep; a click or
// hover may name `text` to pick the element holding it, and a click may name `until` (and `untilText`), what must then be on the
// screen, else it is clicked again), tier, sizes and themes (override the tier), full (the whole page, up to 2600 px, not just
// the window), hide (selectors whose text is made invisible), space (true: the space page, left a moment to finish drawing), call
// (true: a screen of the call itself, drawn with a stand-in for the call's client library, see below). A selector may cross into a shadow root with " >>> ": the bundled modules run in the page, in a
// shadow root on #module-frame, so "#module-frame >>> button.day-add" is a button in the Planner. --dump prints the controls
// of each screen it runs and --html=<selector> the markup of what it matches, to help write steps.
//
// Where the images go. OUTSIDE git: tools/.shots/ (ignored), or SHOTS_DIR or --dir. `shots` writes <dir>/baseline (the images and
// manifest.json: screen id, size, theme, url, file, sha). `shots:compare` writes <dir>/current, and for every screen that
// differs a difference image in <dir>/diff (the baseline faded, each differing pixel red). Per screen it reports the pixels that
// differ and their share; a screen fails above SHOTS_THRESHOLD (a share of the pixels, 0 by default: any difference), counting a
// pixel when a colour channel differs by more than SHOTS_TOLERANCE (0 by default). A screen in the baseline that was not
// rendered, or the reverse, is reported too. The exit code is 1 when anything differs or failed.
//
// Why two runs on the same code give the same images. The server's clock starts on 2026-10-15 and its random keys and ids come
// from a seeded sequence (tools/shots-clock.cjs), so every date and every key it writes is the same in every run. The page's clock
// is frozen on the same day and Math.random is seeded. Animations, transitions, the caret and scrolling effects are off (also
// inside the modules' shadow roots), running animations are finished and SVG animations stopped, a page's heartbeat to the server
// is answered by the page itself (so nobody is "online" and several tabs at once change nothing), a toast stays until the picture is
// taken, fonts and images are waited for,
// and a picture is taken only when three in a row are identical. Chromium runs with the flags that make its drawing repeatable.
// Run on the same machine and browser; a different Chromium or fonts will differ everywhere.
//
// What it cannot photograph. There is no LiveKit server here. The space page needs none: entering a space is its live stream
// (plan-realtime-optional-livekit.md, step 5), so its bar, status strip, canvas, Set up and menus are drawn as they are. A screen
// of the call (marked "call": Start call pressed) loads tools/shots-livekit-stub.mjs in place of the call's client library, so
// the page joins a call nobody else is in. That is a test double for taking pictures: a call itself (people's tiles, the
// controls with real state, the popped-out window) is not shown, and is only checked in a real call. A hosted server's pages (the host console, the
// start page, the environment banner) need a base domain and are not in the set; nor is anything that needs a person in an
// aside (the ghost slot on Home) or a request still waiting (a loading skeleton).
//
// Seeds: the default seeds the travel template; `--seed=games` seeds the games template (two campaigns, tools/shots-seed.mjs) and runs
// only the screens that name `"seed": "games"`; a screen with no "seed" belongs to travel. The games run takes {lee} and {key} (the
// stream key, for the OBS view) as well. Keep the two runs' baselines apart with --dir.
// Options: --compare, --out=<folder> (render into that folder, as a set to keep), --diff <before> <after> (compare two such folders,
// no browser needed; differences go to a `diff` folder beside <after>), --only=<id text, several with commas>, --dir=<folder>, --size=<px>, --theme=light|dark, --jobs=<n>
// (one more than the cores, at most 6, by default), --list (print the table's screens), --dump, --html=<selector>.
// Environment: CHROME_PATH (the browser), SHOTS_DIR, SHOTS_THRESHOLD, SHOTS_TOLERANCE, SHOTS_PORT, SHOTS_JOBS, SHOTS_DEBUG.
// Browser: CHROME_PATH, else a Playwright or system Chromium. With none it says so and exits 0 (a skip, never a pass).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { startBrowser, stopBrowser } from './browser-launch.mjs';
import { fileURLToPath } from 'node:url';
import { SEEDS, seedChatFor, PASSWORD, TODAY } from './shots-seed.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const COMPARE = args.includes('--compare') && !opt('out');
const SEED = opt('seed') || 'travel'; // which seed (tools/shots-seed.mjs SEEDS): travel, or games; a screen with a "seed" field runs only for that one
const ONLY = opt('only'); // screen ids that hold this text (several, with commas)
const OUT = opt('out');
const ONLY_SIZE = opt('size');
const ONLY_THEME = opt('theme');
const DIR = path.resolve(opt('dir') || process.env.SHOTS_DIR || path.join(root, 'tools', '.shots'));
const THRESHOLD = Number(process.env.SHOTS_THRESHOLD || 0);
const TOLERANCE = Number(process.env.SHOTS_TOLERANCE || 0);
const JOBS = Math.max(1, Number(opt('jobs') || process.env.SHOTS_JOBS || Math.min(6, os.cpus().length + 1)));
const SIZES = [1280, 700, 390, 260]; // 260: a narrow module window (planner-narrow-stay)
const THEMES = ['light', 'dark'];
const HEIGHT = 900; // the window's height; a screen marked "full" grows to its page (up to MAX_FULL)
const MAX_FULL = 2600;
const SPACE_SETTLE_MS = 2500; // how long the space page is left to finish drawing before a screen's steps
const NOW = `${TODAY}T12:00:00.000Z`; // the page's clock, frozen
const say = (...a) => console.log('shots:', ...a);
const DEBUG = Boolean(process.env.SHOTS_DEBUG);
const HTML = opt('html'); // prints the markup of what a selector matches on each screen (to write the list's steps)
const DUMP = args.includes('--dump'); // prints the controls of each screen it runs, for writing the list's steps

// ---- find a browser (as check-forms-live.mjs does) ----
function findBrowser() {
  const cands = [process.env.CHROME_PATH];
  const pw = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(pw)) {
    for (const d of fs.readdirSync(pw).sort().reverse()) {
      cands.push(path.join(pw, d, 'chrome-linux', 'chrome'), path.join(pw, d, 'chrome-linux', 'headless_shell'), path.join(pw, d, 'chrome-win', 'chrome.exe'), path.join(pw, d, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
    }
  }
  cands.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium');
  return cands.find((c) => c && fs.existsSync(c)) || null;
}

// ---- PNG: decode (8-bit, not interlaced, colour types 2 and 6, as Chromium writes them) and encode ----
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8; let w = 0; let h = 0; let depth = 0; let type = 0; let interlace = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); const kind = buf.toString('latin1', pos + 4, pos + 8); const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (type !== 2 && type !== 6)) throw new Error(`unsupported PNG (depth ${depth}, type ${type}, interlace ${interlace})`);
  const bpp = type === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0; const b = prev[i]; const c = i >= bpp ? prev[i - bpp] : 0;
      let add = 0;
      if (f === 1) add = a; else if (f === 2) add = b; else if (f === 3) add = (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = (line[i] + add) & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      out[o] = line[x * bpp]; out[o + 1] = line[x * bpp + 1]; out[o + 2] = line[x * bpp + 2]; out[o + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { w, h, data: out };
}
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function encodePng({ w, h, data }) {
  const chunk = (kind, body) => { const len = Buffer.alloc(4); len.writeUInt32BE(body.length); const td = Buffer.concat([Buffer.from(kind, 'latin1'), body]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; data.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
// Compares two decoded images. Answers { differing, total, w, h, diff } (diff: an image, the baseline faded and every
// differing pixel in red), or { sizeChanged: true } when the sizes differ.
function diffImages(a, b) {
  if (a.w !== b.w || a.h !== b.h) return { sizeChanged: true, a: [a.w, a.h], b: [b.w, b.h] };
  const out = Buffer.alloc(a.data.length);
  let differing = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]), Math.abs(a.data[i + 3] - b.data[i + 3]));
    if (d > TOLERANCE) { differing++; out[i] = 255; out[i + 1] = 0; out[i + 2] = 60; out[i + 3] = 255; } else { out[i] = 255 - ((255 - a.data[i]) >> 2); out[i + 1] = 255 - ((255 - a.data[i + 1]) >> 2); out[i + 2] = 255 - ((255 - a.data[i + 2]) >> 2); out[i + 3] = 255; }
  }
  return { differing, total: a.w * a.h, w: a.w, h: a.h, diff: { w: a.w, h: a.h, data: out } };
}

// ---- the page's prelude: runs in every document before its own scripts ----
function prelude(mode) {
  return `(() => {
  if (window.__shots) return; window.__shots = true;
  const FIXED = Date.parse(${JSON.stringify(NOW)});
  const Real = Date;
  class Fixed extends Real { constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); } static now() { return FIXED; } }
  window.Date = Fixed;
  let seed = 123456789; Math.random = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  window.__shotsMode = ${JSON.stringify(mode)};
  try { localStorage.setItem('app.themeMode', ${JSON.stringify(mode)}); } catch (e) {}
  // Work in flight, so a screen is taken only when the page has settled.
  window.__busy = 0;
  // Who is online comes from each open page's heartbeat; with several pages open at once that would change from run to run, so
  // a heartbeat is answered here and never sent: nobody is ever "around".
  const f = window.fetch;
  if (f) window.fetch = function (input, init) {
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (method === 'POST' && /\\/api\\/presence(\\?|$)/.test(String((input && input.url) || input))) return Promise.resolve(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
    window.__busy++;
    return f.apply(this, arguments).finally(() => { window.__busy--; });
  };
  // The same for the space page's live stream (GET /api/live): who is here lists only the page's own person, whatever
  // other screens are open in that space at the same moment.
  const ES = window.EventSource;
  if (ES) window.EventSource = class extends ES {
    constructor(url, opts) {
      super(url, opts);
      if (!/\\/api\\/live(\\?|$)/.test(String(url))) return;
      let you = null;
      const add = this.addEventListener.bind(this);
      this.addEventListener = (type, fn, o) => add(type, type !== 'message' ? fn : (event) => {
        let data = null; try { data = JSON.parse(event.data); } catch (e) { return fn(event); }
        if (data && data.type === 'ready') you = data.you;
        if (data && data.type === 'presence') return fn(new MessageEvent('message', { data: JSON.stringify({ ...data, people: (data.people || []).filter((p) => p.key === you) }) }));
        return fn(event);
      }, o);
    }
  };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () { window.__busy++; this.addEventListener('loadend', () => { window.__busy--; }); return send.apply(this, arguments); };
  // A toast goes away by itself after a few seconds, which a picture taken under load may or may not beat: it stays until the
  // picture is taken (the one place a timer is held back).
  const later = window.setTimeout;
  window.setTimeout = function (fn, delay) { if (typeof fn === 'function' && delay >= 3000 && delay <= 10000 && String(fn).includes('closeToast(t)')) return 0; return later.apply(this, arguments); };
  // A shadow root (where a bundled module runs) does not take the page's rules, so each one is given the same.
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) { const root = attach.call(this, init); const st = document.createElement('style'); st.textContent = ${JSON.stringify(FREEZE_CSS)}; root.appendChild(st); return root; };
  // The rest needs the document element, which a script that runs before the page is parsed may not have yet.
  const withRoot = (fn) => {
    if (document.documentElement) { fn(); return; }
    const wait = new MutationObserver(() => { if (document.documentElement) { wait.disconnect(); fn(); } });
    wait.observe(document, { childList: true });
  };
  withRoot(() => {
    const root = document.documentElement;
    root.dataset.themeMode = window.__shotsMode;
    // The page may take the mode away again (the account's own mode arrives after load); it is put back at once.
    new MutationObserver(() => { const m = window.__shotsMode; if (root.dataset.themeMode !== m) root.dataset.themeMode = m; if (root.dataset.modeShown !== m) root.dataset.modeShown = m; }).observe(root, { attributes: true, attributeFilter: ['data-theme-mode', 'data-mode-shown'] });
    const style = document.createElement('style'); style.id = 'shots-style';
    style.textContent = ${JSON.stringify(FREEZE_CSS)};
    const put = () => { if (!document.getElementById('shots-style')) (document.head || document.documentElement).appendChild(style); };
    put(); document.addEventListener('DOMContentLoaded', put);
    new MutationObserver(put).observe(root, { childList: true });
  });
})();`;
}
// Animations, transitions and the caret off; the text a screen's "hide" names is made invisible, never removed (its box keeps
// its width, so the layout does not move). The seeded data and the fixed clocks leave nothing that varies by itself.
const FREEZE_CSS = `
*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; }
input, textarea { caret-color: transparent !important; }
html { scrollbar-width: none; }
::-webkit-scrollbar { display: none; }
[data-shots-hide], [data-shots-hide] * { color: transparent !important; text-shadow: none !important; }
`;

// ---- Chromium over the DevTools protocol ----
class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    this.listeners = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.method) for (const f of this.listeners) f(m);
      if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else if (m.method) { this.events.push(m); if (this.events.length > 5000) this.events.splice(0, 2500); }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout: ' + method)); } }, 30000); });
  }
}
async function launch(bin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-chrome-'));
  const child = startBrowser(bin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--disable-font-subpixel-positioning', '--force-device-scale-factor=1', '--run-all-compositor-stages-before-draw', '--disable-partial-raster', '--disable-threaded-animation', '--disable-checker-imaging', '--disable-image-animation-resync', '--disable-new-content-rendering-timeout', '--disable-features=PaintHolding', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'], dir);
  const url = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('the browser did not start: ' + buf.slice(-300))), 20000);
    child.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); resolve(m[1]); } });
    child.on('exit', (c) => { clearTimeout(t); reject(new Error('the browser exited (' + c + '): ' + buf.slice(-300))); });
  }).catch(async (e) => { await stopBrowser(child, dir); throw e; }); // a browser that did not start is not left running
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('cannot reach the browser'))); });
  return { cdp: new Cdp(ws), child, dir };
}

// ---- the throwaway server ----
function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); }); }
// `env`: more of the server's environment variables, for a check that needs one (CLEAR_UNDO_SECONDS).
async function startServer(dataDir, port, seed, env = {}) {
  const child = spawn(process.execPath, ['--require', path.join(root, 'tools', 'shots-clock.cjs'), 'server/index.js'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), DATA_DIR: dataDir, TZ: 'UTC', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ADMIN_PASSWORD: PASSWORD, SHOTS_NOW: `${TODAY}T09:00:00.000Z`, SHOTS_SEED: seed, ...env },
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    try { const r = await fetch(base + '/healthz'); if (r.ok) return { base, child, log: () => log }; } catch { /* not up yet */ }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error('the throwaway server did not start: ' + log.slice(-400));
}
async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return;
  const gone = new Promise((r) => server.child.once('exit', r));
  server.child.kill('SIGTERM'); // this process only, never by name
  await Promise.race([gone, new Promise((r) => setTimeout(r, 8000))]);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- driving a screen ----
const fill = (s, ctx) => String(s).replace(/\{(trip|second|mia|sam|lee|key)\}/g, (_, k) => ctx[k]);
// A selector that may cross into a shadow root: "a >>> b" is b inside the shadow root of a. The bundled modules run in the
// page, each in a shadow root on #module-frame, so their own buttons are reached with "#module-frame >>> .btn".
const DEEP = `const __all = (sel) => { let roots = [document]; const parts = String(sel).split('>>>').map((x) => x.trim()); let found = []; parts.forEach((part, i) => { found = []; for (const r of roots) found.push(...r.querySelectorAll(part)); roots = found.map((e) => e.shadowRoot || e); }); return found; };
const __q = (sel, text) => { let all = __all(sel); if (text) all = all.filter((e) => (e.getAttribute('aria-label') || e.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase().includes(String(text).toLowerCase())); return all.find((e) => e.getClientRects().length) || all[0] || null; };`;
class Tab {
  constructor(cdp, ctx) { this.cdp = cdp; this.ctx = ctx; }
  async open(size, mode, stub = false) {
    const { cdp } = this;
    // A browser context of its own, so no cookie, storage or cache is shared with another screen.
    const { browserContextId } = await cdp.send('Target.createBrowserContext');
    this.contextId = browserContextId;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    this.targetId = targetId; this.sid = sessionId; this.size = size; this.mode = mode;
    const s = (m, p) => cdp.send(m, p, sessionId);
    await s('Page.enable'); await s('Runtime.enable'); await s('Network.enable');
    await s('Network.setBypassServiceWorker', { bypass: true });
    await s('Emulation.setDeviceMetricsOverride', { width: size, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
    await s('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
    await s('Emulation.setLocaleOverride', { locale: 'en-US' });
    await s('Emulation.setFocusEmulationEnabled', { enabled: true });
    await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: mode }] });
    await s('Page.addScriptToEvaluateOnNewDocument', { source: prelude(mode) });
    this.unstable = false;
    if (stub) {
      // The call's client library replaced by tools/shots-livekit-stub.mjs (see there): the page is drawn as if connected.
      const body = Buffer.from(fs.readFileSync(path.join(root, 'tools', 'shots-livekit-stub.mjs'))).toString('base64');
      await s('Fetch.enable', { patterns: [{ urlPattern: '*/lib/livekit-client.esm.mjs', requestStage: 'Request' }] });
      this.fetchHook = (m) => {
        if (m.method !== 'Fetch.requestPaused' || m.sessionId !== sessionId) return;
        cdp.send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }, { name: 'Cache-Control', value: 'no-store' }], body }, sessionId).catch(() => {});
      };
      cdp.listeners.push(this.fetchHook);
    }
  }
  async close() {
    if (this.fetchHook) this.cdp.listeners = this.cdp.listeners.filter((f) => f !== this.fetchHook);
    await this.cdp.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {});
    await this.cdp.send('Target.disposeBrowserContext', { browserContextId: this.contextId }).catch(() => {});
  }
  async eval(expr) {
    const r = await this.cdp.send('Runtime.evaluate', { expression: `(async () => { ${DEEP}\n return (${expr}); })()`, returnByValue: true, awaitPromise: true }, this.sid);
    if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async rect(sel, text) {
    const expr = `(() => { const e = __q(${JSON.stringify(sel)}, ${JSON.stringify(text || '')}); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`;
    let r = null;
    for (let i = 0; i < 60 && !r; i++) { r = await this.eval(expr); if (!r) await sleep(100); }
    if (!r) throw new Error(`nothing matches ${sel}${text ? ' with ' + text : ''}`);
    return r;
  }
  async mouse(type, x, y, extra = {}) { await this.cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra }, this.sid); }
  async click(sel, text) { const r = await this.rect(sel, text); const x = r.x + r.w / 2; const y = r.y + r.h / 2; await this.mouse('mouseMoved', x, y, { button: 'none', clickCount: 0 }); await this.mouse('mousePressed', x, y); await this.mouse('mouseReleased', x, y); }
  async hover(sel, text) { const r = await this.rect(sel, text); await this.mouse('mouseMoved', r.x + r.w / 2, r.y + r.h / 2, { button: 'none', clickCount: 0 }); }
  async waitFor(sel, text, ms = 15000) {
    const expr = `!!__q(${JSON.stringify(sel)}, ${JSON.stringify(text || '')})`;
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await this.eval(expr).catch(() => false)) return; await sleep(100); }
    throw new Error(`${sel} did not appear`);
  }
  async key(key) {
    const codes = { Escape: 27, Enter: 13, Tab: 9, ArrowDown: 40, ArrowUp: 38 };
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: codes[key] || 0 }, this.sid);
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: codes[key] || 0 }, this.sid);
  }
  async typeInto(sel, value, text) {
    await this.click(sel, text);
    await this.cdp.send('Input.insertText', { text: value }, this.sid);
  }
  // Loaded: fonts and images in, no request in flight, the document complete. A page that keeps changing (a clock, a poll)
  // does not hold this up; shoot() waits for two identical pictures instead.
  async settle() {
    const probe = `(async () => { try { await document.fonts.ready; } catch (e) {} try { document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) { a.cancel(); } }); } catch (e) {} const still = (r) => { for (const v of r.querySelectorAll('svg')) { try { v.pauseAnimations(); v.setCurrentTime(0); } catch (e) {} } for (const e of r.querySelectorAll('*')) if (e.shadowRoot) still(e.shadowRoot); }; still(document); const imgs = []; const walk = (r) => { for (const i of r.querySelectorAll('img')) imgs.push(i); for (const e of r.querySelectorAll('*')) if (e.shadowRoot) walk(e.shadowRoot); }; walk(document); return { busy: window.__busy || 0, imgs: imgs.filter((i) => !i.complete).length, ready: document.readyState === 'complete' }; })()`;
    const end = Date.now() + 15000;
    let stable = 0;
    while (Date.now() < end) {
      const r = await this.cdp.send('Runtime.evaluate', { expression: probe, awaitPromise: true, returnByValue: true }, this.sid).catch(() => null);
      const v = r && r.result && r.result.value;
      stable = v && v.busy === 0 && v.imgs === 0 && v.ready ? stable + 1 : 0;
      if (stable >= 2) return;
      await sleep(100);
    }
  }
  // The account's own mode may arrive after the page loaded and take the attribute away; set it again, through the page's own
  // switch where it has one, so a module's frame is sent its colours too.
  async forceMode() {
    await this.eval(`((m) => { window.__shotsMode = m; try { if (window.appTheme) window.appTheme.mode(m); } catch (e) {} document.documentElement.dataset.themeMode = m; document.documentElement.dataset.modeShown = m; try { localStorage.setItem('app.themeMode', m); } catch (e) {} })(${JSON.stringify(this.mode)})`);
  }
  // The other mode on the page already open (the page's own switch), so a screen is loaded and driven once for both.
  async switchMode(mode) {
    this.mode = mode;
    await this.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: mode }] }, this.sid);
    await this.forceMode();
  }
  async shoot(full) {
    const s = (m, p) => this.cdp.send(m, p, this.sid);
    let height = HEIGHT;
    if (full) {
      height = Math.min(MAX_FULL, Math.max(HEIGHT, await this.eval('Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)')));
    }
    await s('Emulation.setDeviceMetricsOverride', { width: this.size, height, deviceScaleFactor: 1, mobile: false });
    await this.forceMode();
    await sleep(150);
    await this.settle();
    // The picture is taken when three in a row are the same (a page still drawing, a list still scrolling to its end, or a
    // frame still loading is not), with a growing wait between them.
    const grab = async () => Buffer.from((await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64');
    let last = await grab();
    let same = 1;
    for (let i = 0; i < 16; i++) {
      await sleep(i < 2 ? 250 : 400);
      const next = await grab();
      same = next.equals(last) ? same + 1 : 1;
      last = next;
      if (same >= 3) return next;
    }
    this.unstable = true;
    return last;
  }
}

// What a person could click on a screen, with a selector for each, for writing the list's steps (--dump).
async function dumpControls(tab, screen) {
  const expr = `(() => { const css = (e) => { if (e.id) return '#' + e.id; const c = typeof e.className === 'string' ? e.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2).map((x) => '.' + x).join('') : ''; const d = [...e.attributes].filter((a) => /^data-(action|tab|view|kind|id|module|space|key|ed|type)/.test(a.name)).map((a) => '[' + a.name + '="' + a.value.slice(0, 30) + '"]').join(''); return e.tagName.toLowerCase() + c + d; }; const out = []; const walk = (root, prefix) => { for (const e of root.querySelectorAll('button, a[href], [role=tab], [role=menuitem], [role=option], input, select, textarea, summary, label.sdk-check')) if (e.getClientRects().length) out.push(prefix + css(e) + ' | ' + (e.getAttribute('aria-label') || e.title || e.textContent || e.placeholder || e.value || '').trim().replace(/\\s+/g, ' ').slice(0, 40)); for (const h of root.querySelectorAll('*')) if (h.shadowRoot) walk(h.shadowRoot, prefix + css(h) + ' >>> '); }; walk(document, ''); return out.slice(0, 250); })()`;
  await sleep(2500);
  const top = await tab.eval(expr);
  console.log(`--- ${screen.id}: ${top.length} controls\n${top.join('\n')}`);
}
// Opens a screen of the table in `tab` (already a fresh context: the caller opened it) and drives it to the state the table names:
// signed in, loaded, settled, its steps done, the pointer away. tools/check-conformance.mjs measures the same screens with it.
async function driveScreen(tab, screen, base, cookies, ctx, lap = () => {}) {
  const jar = cookies[screen.as || 'admin'];
  for (const c of jar || []) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: base, httpOnly: true }, tab.sid);
  await tab.cdp.send('Page.navigate', { url: base + fill(screen.url, ctx) }, tab.sid);
  lap('navigated');
  if (screen.wait) await tab.waitFor(fill(screen.wait, ctx));
  lap('waited');
  await tab.settle();
  lap('settled');
  // The space page keeps drawing for a while after it is connected (its modules, the phase track, the chat's scroll to its end).
  if (screen.space || screen.call) await sleep(SPACE_SETTLE_MS);
  await tab.forceMode();
  await tab.settle();
  // A chat that scrolls itself to its newest message is sometimes still on its way when the picture is taken: always at the end.
  await tab.eval(`(() => { const m = document.getElementById('messages'); if (m) m.scrollTop = m.scrollHeight; })()`).catch(() => {});
  lap('forced');
  for (const st of screen.steps || []) {
    if (st.click) {
      await tab.click(fill(st.click, ctx), st.text);
      // A control may not be wired the moment it is drawn: when the effect named by "until" is not there, click again.
      for (let again = 0; st.until && again < 5; again++) {
        const want = fill(st.until, ctx);
        const end = Date.now() + 1500;
        let seen = false;
        while (!seen && Date.now() < end) { seen = await tab.eval(`!!__q(${JSON.stringify(want)}, ${JSON.stringify(st.untilText === undefined ? (st.text || '') : st.untilText)})`).catch(() => false); if (!seen) await sleep(100); }
        if (seen) break;
        await tab.click(fill(st.click, ctx), st.text);
      }
    }
    else if (st.hover) await tab.hover(fill(st.hover, ctx), st.text);
    else if (st.wait) await tab.waitFor(fill(st.wait, ctx), st.text);
    else if (st.waitGone) { const end = Date.now() + 10000; while (Date.now() < end && await tab.eval(`!!__q(${JSON.stringify(st.waitGone)})`)) await sleep(100); }
    else if (st.scroll) await tab.rect(fill(st.scroll, ctx), st.text);
    else if (st.key) await tab.key(st.key);
    else if (st.type) await tab.typeInto(fill(st.type[0], ctx), st.type[1], st.text);
    else if (st.eval) await tab.eval(fill(st.eval, ctx));
    else if (st.sleep) await sleep(st.sleep);
    await tab.settle();
  }
  // The pointer out of the way, so no hover is left on anything the screen did not ask for.
  await tab.mouse('mouseMoved', 0, 0, { button: 'none', clickCount: 0 });
  for (const sel of screen.hide || []) await tab.eval(`__all(${JSON.stringify(sel)}).forEach((e) => e.setAttribute('data-shots-hide', ''))`).catch(() => {});
  lap('steps done');
}
async function runScreen(tab, screen, base, cookies, size, modes, ctx) {
  const t0 = Date.now(); const lap = (what) => { if (DEBUG) say(`  ${screen.id} ${what} +${Date.now() - t0} ms`); };
  await tab.open(size, modes[0], screen.call === true); lap('opened');
  try {
    await driveScreen(tab, screen, base, cookies, ctx, lap);
    if (DUMP) await dumpControls(tab, screen);
    if (HTML) { await sleep(1500); console.log(`--- ${screen.id}: ${HTML}\n` + (await tab.eval(`__all(${JSON.stringify(HTML)}).slice(0, ${Number(process.env.SHOTS_HTML_COUNT || 3)}).map((e) => { for (let i = 0; i < ${Number(process.env.SHOTS_HTML_UP || 0)}; i++) e = e.parentElement || e; return e; }).map((e) => e.outerHTML.replace(/<svg[\\s\\S]*?<\\/svg>/g, '<svg/>').slice(0, ${Number(process.env.SHOTS_HTML_LEN || 1800)})).join('\\n-----\\n')`))); }
    const out = new Map();
    for (const mode of modes) {
      if (tab.mode !== mode) { await tab.switchMode(mode); await tab.settle(); }
      out.set(mode, await tab.shoot(Boolean(screen.full)));
      lap(`shot ${mode}`);
    }
    return out;
  } finally { await tab.close(); }
}

// ---- run ----
async function main() {
  const list = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'shots-screens.json'), 'utf8'));
  if (!SEEDS[SEED]) { say(`--seed=${SEED}: there is no such seed (${Object.keys(SEEDS).join(', ')}).`); return 1; }
  list.screens = list.screens.filter((s) => (s.seed || 'travel') === SEED);
  const screens = list.screens.filter((s) => !ONLY || ONLY.split(',').some((x) => s.id.includes(x)));
  if (args.includes('--list')) {
    for (const s of list.screens) console.log(`${s.id.padEnd(34)} ${(s.family || '').padEnd(28)} ${s.url}`);
    console.log(`${list.screens.length} screens`);
    return 0;
  }
  // Two folders already rendered, compared with no browser: `--diff <before> <after>` (each a folder with a manifest.json).
  if (args.includes('--diff')) {
    const [before, after] = args.filter((a) => !a.startsWith('--')).map((a) => path.resolve(a));
    if (!before || !after) { say('--diff needs two folders: before and after.'); return 1; }
    const load = (d) => JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8'));
    return compareRuns(load(before), load(after).images, [], Date.now(), { baseDir: before, curDir: after, diffDir: path.join(path.dirname(after), 'diff') });
  }
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was captured.'); return 0; }
  const sizes = SIZES.filter((s) => !ONLY_SIZE || String(s) === ONLY_SIZE);
  const themes = THEMES.filter((t) => !ONLY_THEME || t === ONLY_THEME);
  // --out=<folder>: render into that folder (images and manifest.json), for a set to be compared later with --diff.
  const outDir = OUT ? path.resolve(OUT) : path.join(DIR, COMPARE ? 'current' : 'baseline');
  const baseDir = path.join(DIR, 'baseline');
  const manifestPath = path.join(OUT ? outDir : baseDir, 'manifest.json');
  let baseManifest = null;
  if (COMPARE) {
    if (!fs.existsSync(manifestPath)) { say(`no baseline in ${baseDir}. Run \`npm run shots\` first.`); return 1; }
    baseManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  }
  if (!ONLY || COMPARE) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  if (COMPARE) fs.rmSync(path.join(DIR, 'diff'), { recursive: true, force: true });
  const started = Date.now();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-data-'));
  const port = Number(process.env.SHOTS_PORT) || await freePort();
  let server = null; let browser = null;
  const entries = [];
  const failures = [];
  try {
    const boot = await bootSeeded(SEED, dataDir, port);
    server = boot.server;
    const { ctx, cookies } = boot;
    browser = await launch(bin);
    const queue = [];
    screens.forEach((screen, si) => {
      const tier = (list.tiers || {})[screen.tier || 'core'] || {};
      const sz = (screen.sizes || tier.sizes || SIZES).filter((x) => sizes.includes(x));
      const th = (screen.themes || tier.themes || THEMES).filter((x) => themes.includes(x));
      for (const size of sz) if (th.length) queue.push({ screen, si, size, modes: th });
    });
    const total = queue.reduce((n, j) => n + j.modes.length, 0);
    say(`${screens.length} screens, ${total} images (${queue.length} page loads), ${JOBS} at a time${COMPARE ? ', compare' : ''}`);
    let done = 0;
    const worker = async () => {
      const tab = new Tab(browser.cdp, ctx);
      for (let job = queue.shift(); job; job = queue.shift()) {
        const { screen, si, size, modes } = job;
        let pngs = null;
        for (let attempt = 1; attempt <= 2 && !pngs; attempt++) {
          try { pngs = await runScreen(tab, screen, server.base, cookies, size, modes, ctx); } catch (e) { if (attempt === 2) { for (const mode of modes) failures.push({ id: screen.id, size, theme: mode, error: e.message }); say(`ERROR ${screen.id} at ${size}: ${e.message}`); } }
        }
        done += modes.length;
        if (Math.floor((done - modes.length) / 25) !== Math.floor(done / 25) || done === total) say(`${done}/${total} (${Math.round((Date.now() - started) / 1000)} s)`);
        if (!pngs) continue;
        for (const [mode, png] of pngs) {
          const file = `${screen.id}-${size}-${mode}.png`;
          if (tab.unstable) say(`SHIFTING ${file}: the page never held still, so two runs may differ`);
          fs.writeFileSync(path.join(outDir, file), png);
          entries.push({ si, id: screen.id, family: screen.family || '', size, theme: mode, url: screen.url, file, sha: crypto.createHash('sha256').update(png).digest('hex').slice(0, 16) });
        }
        tab.unstable = false;
      }
    };
    await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) || 1 }, worker));
    entries.sort((x, y) => x.si - y.si || SIZES.indexOf(y.size) - SIZES.indexOf(x.size) || THEMES.indexOf(x.theme) - THEMES.indexOf(y.theme));
    for (const e of entries) delete e.si;
    if (!COMPARE) {
      let merged = entries;
      if (ONLY && fs.existsSync(manifestPath)) {
        const keep = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).images.filter((e) => !entries.some((x) => x.file === e.file));
        merged = [...keep, ...entries];
      }
      fs.writeFileSync(manifestPath, JSON.stringify({ about: 'tools/shots.mjs baseline', clock: NOW, browser: path.basename(path.dirname(bin)), screens: [...new Set(merged.map((e) => e.id))].length, images: merged }, null, 2) + '\n');
      say(`${OUT ? "set" : "baseline"}: ${entries.length} images in ${OUT ? outDir : baseDir} (manifest.json), ${Math.round((Date.now() - started) / 1000)} s`);
      return failures.length ? 1 : 0;
    }
    return compareRuns(baseManifest, entries, failures, started);
  } finally {
    try {
      if (browser) {
        browser.cdp.ws.close();
        await stopBrowser(browser.child, browser.dir);
      }
    } catch { /* best effort */ }
    await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}


// Starts the throwaway server in dataDir on port, seeds `seedName` through the API (stops, writes the chat, starts again) and
// signs everyone in. Answers { server, ctx (the seeded ids, for fill()), cookies (by login) }. tools/check-conformance.mjs uses it too.
async function bootSeeded(seedName, dataDir, port, { env = {} } = {}) {
  let server = await startServer(dataDir, port, 'first', env);
  const jars = {};
  const call = async (method, url, body, as = 'admin') => {
    const headers = { 'content-type': Buffer.isBuffer(body) ? 'image/png' : 'application/json', accept: 'application/json' };
    if (jars[as]) headers.cookie = jars[as].map((c) => `${c.name}=${c.value}`).join('; ');
    const r = await fetch(server.base + url, { method, headers, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json, res: r };
  };
  const signIn = async (login) => {
    const r = await call('POST', '/api/login', { login, password: PASSWORD }, '__none');
    if (r.status !== 200) throw new Error(`cannot sign in as ${login}: ${r.status}`);
    jars[login] = r.res.headers.getSetCookie().map((c) => { const [nv] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1) }; });
  };
  try {
    await signIn('admin');
    say('seeding the throwaway environment');
    const seeded = await SEEDS[seedName].seed(async (m, u, b, as) => { if (as !== 'admin' && !jars[as]) await signIn(as); return call(m, u, b, as); });
    await stopServer(server);
    execSeedChat(dataDir, seeded.trip.id, seeded.users, seedName);
    server = await startServer(dataDir, port, 'second', env);
    await signIn('admin'); await signIn('mia'); await signIn('sam'); await signIn('lee');
    const ctx = { trip: seeded.trip.id, second: seeded.second.id, mia: seeded.users.mia, sam: seeded.users.sam, lee: seeded.users.lee, key: seeded.key };
    const cookies = { admin: jars.admin, mia: jars.mia, sam: jars.sam, lee: jars.lee, none: [] };
    return { server, ctx, cookies };
  } catch (e) { await stopServer(server); throw e; }
}

// The chat is written by a short child process with the same fixed clock as the server.
function execSeedChat(dataDir, tripId, users, seedName = SEED) {
  const code = `import('${path.join(root, 'tools', 'shots-seed.mjs').replace(/\\/g, '/')}').then((m) => m.seedChatFor(process.env.SEED, process.env.DATA_DIR, { tripId: process.env.TRIP, users: JSON.parse(process.env.USERS) }))`;
  const r = spawnSyncNode(['--require', path.join(root, 'tools', 'shots-clock.cjs'), '-e', code], { DATA_DIR: dataDir, SEED: seedName, TRIP: tripId, USERS: JSON.stringify(users), SHOTS_NOW: `${TODAY}T09:00:00.000Z`, SHOTS_SEED: 'chat' });
  if (r.status !== 0) throw new Error('the chat could not be seeded: ' + r.stderr);
}
import { spawnSync } from 'node:child_process';
function spawnSyncNode(argv, env) { return spawnSync(process.execPath, argv, { cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, TZ: 'UTC', ...env }, encoding: 'utf8' }); }

function compareRuns(baseManifest, entries, failures, started, { baseDir = path.join(DIR, 'baseline'), curDir = path.join(DIR, 'current'), diffDir = path.join(DIR, 'diff') } = {}) {
  const byFile = new Map(baseManifest.images.map((e) => [e.file, e]));
  const rows = [];
  let bad = 0; let same = 0; let fresh = 0;
  fs.rmSync(diffDir, { recursive: true, force: true });
  fs.mkdirSync(diffDir, { recursive: true });
  for (const e of entries) {
    const was = byFile.get(e.file);
    if (!was) { fresh++; rows.push(`  NEW        ${e.file} (no baseline)`); continue; }
    byFile.delete(e.file);
    if (was.sha === e.sha) { same++; continue; }
    const a = decodePng(fs.readFileSync(path.join(baseDir, e.file)));
    const b = decodePng(fs.readFileSync(path.join(curDir, e.file)));
    const d = diffImages(a, b);
    if (d.sizeChanged) { bad++; rows.push(`  DIFFERENT  ${e.file}: size ${d.a.join('x')} -> ${d.b.join('x')}`); continue; }
    const share = d.differing / d.total;
    if (share > THRESHOLD) {
      bad++;
      fs.writeFileSync(path.join(diffDir, e.file), encodePng(d.diff));
      rows.push(`  DIFFERENT  ${e.file}: ${d.differing} of ${d.total} pixels (${(share * 100).toFixed(3)} %), ${path.join(diffDir, e.file)}`);
    } else same++;
  }
  const onlySome = ONLY || ONLY_SIZE || ONLY_THEME;
  const missing = onlySome ? [] : [...byFile.keys()];
  for (const f of missing) rows.push(`  MISSING    ${f} (in the baseline, not rendered now)`);
  for (const f of failures) rows.push(`  ERROR      ${f.id}-${f.size}-${f.theme}: ${f.error}`);
  console.log(rows.join('\n'));
  const failed = bad + missing.length + failures.length;
  say(`compare: ${same} identical, ${bad} different, ${fresh} new, ${missing.length} missing, ${failures.length} errors; threshold ${THRESHOLD}, tolerance ${TOLERANCE}; ${Math.round((Date.now() - started) / 1000)} s`);
  say(failed ? 'FAIL' : 'ok: nothing a person sees has changed.');
  return failed ? 1 : 0;
}

export { decodePng, encodePng, diffImages, findBrowser, launch, freePort, startServer, stopServer, bootSeeded, Tab, sleep, fill, driveScreen };
if (process.argv[1] === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c), (e) => { console.error('shots: ERROR ' + (e.stack || e)); process.exit(1); });
