#!/usr/bin/env node
/*
 * check-design-system.mjs -- the Design System page (public/design-system/index.html, what is in production) opened in a real browser, and
 * System v1 (public/design-system/legacy/system-v1/proposed.html, the frozen drawings the production system was built from) loaded as a smoke test.
 * What the page's classes, family blocks and the Prototype page's classes hold is checked without a browser by tools/check-design-system-catalog.mjs;
 * the real screens (bands, padding, tap areas) by tools/check-conformance.mjs. This check holds what only a browser on this page shows.
 *
 * Static (every run): the page's files exist; the snapshot script (tools/design-system-snapshot.mjs) builds both pages into temp folders, each
 * with an index.html that loads no script and links nothing from outside or from the server root, with system.css linked, under 12 MB; the
 * System v1 snapshot carries its manifest inline and every file the manifest names, and none of the Design System's own files; index.html loads
 * nothing of System v1 and links the Proposed page; proposed.html loads nothing of the Design System and links back to it.
 * Fails when sources.js holds module stylesheets (they come from module-sources.js, read at run time).
 *
 * Browser, per scenario (a width, 1280 or 390, and a mode, light or dark), in one headless Chromium with one tab at a fixed viewport:
 *   the Design System page, served by the app and as its snapshot opened from disk: no console error, exception or page error; the page
 *   finishes drawing; every example frame loads; at least 20 families, 40 tokens and 20 icons drawn; no sideways scroll; still at its top
 *   (a frame that takes focus must not scroll it away); a screenshot that is not empty; the body font Figtree (/sdk/system.css linked); the
 *   Light and Dark switch sets data-theme-mode.
 *   System v1, served and as its snapshot: no console error, exception or page error; it finishes drawing; renderAll draws every family and
 *   every frame loads; it does not load the Design System's inventory; no sideways scroll. Nothing else: it is a frozen record.
 *
 * Usage: node tools/check-design-system.mjs [--scenario=1280:light[,390:dark...]]   (default: all four, one after another)
 *   npm run check runs --scenario=1280:light; npm run check:design (and .github/workflows/design-check.yml, one job per scenario) runs all four.
 * Browser: CHROME_PATH, else a Playwright Chromium (PLAYWRIGHT_BROWSERS_PATH, ~/.cache/ms-playwright) or a system one. With none it says
 * SKIPPED (not a pass), and fails when CI is set. SHOTS=<folder> saves a screenshot of each page per scenario.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSnapshot, buildSources, proposedManifest } from './design-system-snapshot.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DS = path.join(root, 'public', 'design-system');
const V1 = path.join(DS, 'legacy', 'system-v1');
const started = Date.now();
const failures = [];
const warnings = [];
const fail = (m) => failures.push(m);
const say = (m) => console.log('check-design-system: ' + m);

// ---- the scenarios ----
const ALL = ['1280:light', '1280:dark', '390:light', '390:dark'];
const arg = process.argv.find((a) => a.startsWith('--scenario='));
const wanted = arg ? arg.slice(11).split(',').filter(Boolean) : ALL;
for (const s of wanted) if (!ALL.includes(s)) { console.error(`check-design-system: --scenario=${s} is not one of ${ALL.join(', ')}`); process.exit(2); }
const scenarios = wanted.map((s) => { const [w, m] = s.split(':'); return { width: Number(w), mode: m, name: s }; });

// ---- files ----
const manifest = proposedManifest();
for (const f of ['index.html', 'ds.css', 'ds.js', 'components.js', 'components-2.js', 'components-3.js', 'sources.js']) {
  if (!fs.existsSync(path.join(DS, f))) fail(`public/design-system/${f} is missing`);
}
for (const f of ['proposed.html', 'ds.css', 'proposed.js', 'proposed.css', 'proposed-families.json', ...manifest.families.flatMap((f) => [f.js, f.css].filter(Boolean))]) {
  if (!fs.existsSync(path.join(V1, f))) fail(`public/design-system/legacy/system-v1/${f} is missing`);
}
if (failures.length) { for (const f of failures) console.error('check-design-system: FAIL ' + f); process.exit(1); }

// ---- the snapshots, into temp folders: the Design System, and System v1 ----
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-snapshot-check-'));
const outP = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-snapshot-check-p-'));
const snap = buildSnapshot(out);
const snapP = buildSnapshot(outP, 'proposed');
for (const [label, dir, sn] of [['design system', out, snap], ['system v1', outP, snapP]]) {
  if (!fs.existsSync(path.join(dir, 'index.html'))) { fail(`the ${label} snapshot has no index.html`); continue; }
  if (sn.total > 12 * 1024 * 1024) fail(`the ${label} snapshot is ${(sn.total / 1024 / 1024).toFixed(1)} MB, over 12 MB`);
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    if (/^(https?:)?\/\//i.test(m[1]) || m[1].startsWith('/')) fail(`the ${label} snapshot's index.html loads a script from ${m[1]}`);
  }
  if (!fs.existsSync(path.join(dir, 'system.css'))) fail(`the ${label} snapshot has no system.css`);
  if (!/<link\b[^>]*href="system\.css"/.test(html)) fail(`the ${label} snapshot's index.html does not link system.css`);
  for (const m of html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    if (/^(https?:)?\/\//i.test(m[1]) || m[1].startsWith('/')) fail(`the ${label} snapshot's index.html links ${m[1]}, not a relative path`);
  }
  for (const f of sn.files) if (/\.(js|html)$/.test(f.file) && f.file !== 'sources.js' && f.file !== 'module-sources.js') {
    const t = fs.readFileSync(path.join(dir, f.file), 'utf8');
    if (/<script\b[^>]*\bsrc\s*=\s*["'](https?:)?\/\//i.test(t)) fail(`${label}: ${f.file} loads an external script`);
  }
}
// The pages stay apart: System v1 loads none of the Design System; the Design System carries nothing of System v1.
{
  const names = new Set(snapP.files.map((f) => f.file));
  for (const bad of ['sources.js', 'ds.js', 'components.js', 'components-2.js', 'components-3.js']) if (names.has(bad)) fail(`the system v1 snapshot holds ${bad}, which is the Design System's`);
  for (const need of ['index.html', 'style.css', 'theme.css', 'ds.css', 'proposed.css', 'proposed.js', 'proposed-families.json', 'fa/css/all.min.css', ...manifest.families.flatMap((f) => [f.js, f.css].filter(Boolean))]) if (!names.has(need)) fail(`the system v1 snapshot has no ${need}`);
  if (fs.existsSync(path.join(outP, 'index.html')) && !fs.readFileSync(path.join(outP, 'index.html'), 'utf8').includes('DS_PROPOSED_MANIFEST')) fail('the system v1 snapshot does not carry the manifest in index.html (a file on disk cannot read proposed-families.json)');
  const ph = fs.readFileSync(path.join(V1, 'proposed.html'), 'utf8');
  if (/sources\.js|components|ds\.js/.test(ph.replace(/<!--[\s\S]*?-->/g, ''))) fail('legacy/system-v1/proposed.html loads something of the Design System (sources.js, components, ds.js)');
  if (!/href="\.\.\/\.\.\/index\.html"/.test(ph)) fail('legacy/system-v1/proposed.html has no link to the Design System page (../../index.html)');
  const th = fs.readFileSync(path.join(DS, 'index.html'), 'utf8');
  if (/proposed(-[a-z0-9-]+)?\.(js|css|json)\b/.test(th)) fail('index.html loads System v1 (a proposed.* or proposed-* file)');
  if (!/href="proposed\.html"/.test(th)) fail('index.html has no link to proposed.html');
  if (snap.files.some((f) => /^proposed[.-]/.test(f.file))) fail('the design system snapshot holds a proposed.* or proposed-* file');
}
// sources.js holds nothing from modules/ (a module change must not make it stale); the module stylesheets and icons come from module-sources.js.
{
  const c = { window: {} }; vm.createContext(c); vm.runInContext(fs.readFileSync(path.join(DS, 'sources.js'), 'utf8'), c);
  if (c.window.DS_SOURCES.modules) fail('public/design-system/sources.js holds module stylesheets; they come from module-sources.js at run time');
  if (!snap.files.some((f) => f.file === 'module-sources.js')) fail('the design system snapshot has no module-sources.js (the modules\' stylesheets and icons)');
}

// ---- the browser ----
function findBrowser() {
  const cands = [process.env.CHROME_PATH];
  const dirs = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), '.cache', 'ms-playwright')].filter(Boolean);
  for (const pw of dirs) {
    if (!fs.existsSync(pw)) continue;
    for (const d of fs.readdirSync(pw).filter((n) => /^chromium/.test(n)).sort().reverse()) {
      for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux/headless_shell', 'chrome-win/chrome.exe', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) cands.push(path.join(pw, d, sub));
    }
  }
  cands.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  return cands.find((c) => c && fs.existsSync(c) && fs.statSync(c).isFile()) || null;
}
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []; ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && this.pending.has(m.id)) { const { res, rej, timer } = this.pending.get(m.id); clearTimeout(timer); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else if (m.method) for (const h of this.handlers) h(m); }); }
  send(method, params = {}, sessionId) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params, sessionId })); return new Promise((res, rej) => { const timer = setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout: ' + method)); } }, 90000); this.pending.set(id, { res, rej, timer }); }); }
}
async function launch(bin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-chrome-'));
  const child = spawn(bin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars', '--no-first-run', '--allow-file-access-from-files', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-data-'));
  const child = spawn(process.execPath, ['server/index.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ADMIN_PASSWORD: 'testpass1234', BASE_DOMAIN: '' } });
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

// One tab for the whole run, at the scenario's fixed viewport; each page is a navigation in it.
async function openTab(cdp) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const tab = { targetId, sessionId, problems: null, expected: null };
  cdp.handlers.push((m) => {
    if (m.sessionId !== sessionId || !tab.problems) return;
    const p = tab.problems;
    if (m.method === 'Runtime.exceptionThrown') p.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') p.push('console.error: ' + m.params.args.map((a) => a.value || a.description).join(' '));
    if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId && m.params.frame.url !== tab.expected) p.push(`the page navigated itself to ${m.params.frame.url.slice(0, 120)}`);
    if (m.method === 'Inspector.targetCrashed') p.push('the tab crashed');
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') p.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
  });
  for (const d of ['Inspector', 'Runtime', 'Log', 'Page']) await cdp.send(`${d}.enable`, {}, sessionId);
  tab.ev = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return tab;
}

// Waits in the page (no polling from here) until the page says it has finished drawing, up to 60 s.
const WAIT_READY = `new Promise((res) => { const t0 = Date.now(); const tick = () => { if (window.__dsStats && window.__dsStats.ready) res(true); else if (Date.now() - t0 > 60000) res(false); else setTimeout(tick, 50); }; tick(); })`;

async function visit(cdp, tab, sc, label, url, kind, shots) {
  const where = `${label} ${sc.width} ${sc.mode}`;
  const problems = [];
  tab.problems = problems;
  tab.expected = `${url}${url.includes('?') ? '&' : '?'}mode=${sc.mode}`;
  const t0 = Date.now();
  await cdp.send('Page.navigate', { url: tab.expected }, tab.sessionId);
  const ev = tab.ev;
  let stats = null;
  try {
    if (!(await ev(WAIT_READY))) { problems.push('the page did not finish drawing'); return finish(); }
    if (kind === 'v1') {
      if (await ev('typeof (window.DS_PROPOSED && window.DS_PROPOSED.renderAll)') !== 'function') problems.push('the page has no window.DS_PROPOSED.renderAll');
      else await ev('window.DS_PROPOSED.renderAll().then(() => true)');
    }
    stats = JSON.parse(await ev('JSON.stringify({ ...window.__dsStats, errors: window.__dsStats.errors.slice(0, 5) })'));
    if (stats.errors.length) problems.push(`page errors: ${stats.errors.join('; ')}`);
    if (stats.loaded !== stats.frames) problems.push(`${stats.loaded} of ${stats.frames} example frames loaded`);
    const sideways = await ev('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    if (sideways > 1) problems.push(`the page scrolls sideways by ${sideways}px`);
    if (kind === 'v1') {
      if (stats.families < 1) problems.push(`too little drawn (${stats.families} families)`);
      if (await ev("typeof window.DS_FAMILIES !== 'undefined' || typeof window.DS_SOURCES !== 'undefined'")) problems.push("it loaded the Design System's inventory (DS_FAMILIES or DS_SOURCES is set)");
    } else {
      if (stats.families < 20 || stats.tokens < 40 || stats.icons < 20) problems.push(`too little drawn (${stats.families} families, ${stats.tokens} tokens, ${stats.icons} icons)`);
      const sy = await ev('window.scrollY');
      if (sy > 1) problems.push(`the page is scrolled to ${sy}px when the screenshot is taken (a frame took focus and scrolled it)`);
      const h = await ev('document.documentElement.scrollHeight');
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: sc.width, height: Math.min(h, 2400), scale: 1 } }, tab.sessionId);
      const png = Buffer.from(shot.data, 'base64');
      if (png.length < 8000) problems.push(`the screenshot is nearly empty (${png.length} bytes)`);
      if (shots) { fs.mkdirSync(shots, { recursive: true }); fs.writeFileSync(path.join(shots, `${label}-${sc.width}-${sc.mode}.png`), png); }
      const bodyFont = await ev('getComputedStyle(document.body).fontFamily');
      if (!/^"?Figtree/.test(bodyFont)) problems.push(`the body font is ${bodyFont}, not Figtree (is /sdk/system.css linked?)`);
      // The Light and Dark switch (after the screenshot: it clicks). The click sets the mode at once, so no wait.
      if (await ev("!!document.querySelector('#ds-mode')")) {
        const after = (m) => ev(`(document.querySelector('#ds-mode button[data-mode="${m}"]').click(), document.documentElement.dataset.themeMode)`);
        const l = await after('light'); const d = await after('dark');
        if (l !== 'light' || d !== 'dark') problems.push(`clicking Light then Dark left data-theme-mode at ${l} then ${d}`);
      } else problems.push('the page has no Light and Dark switch (#ds-mode)');
    }
  } catch (e) {
    problems.push('the browser check stopped: ' + e.message);
  }
  return finish();
  function finish() {
    tab.problems = null;
    const ms = Date.now() - t0;
    say(`${where}: ${problems.length ? 'FAIL' : 'ok'} in ${(ms / 1000).toFixed(1)} s${stats ? ` (${stats.families} families, ${stats.frames} frames)` : ''}`);
    for (const p of problems) fail(`${where}: ${p}`);
  }
}

let browserNote = '';
const bin = findBrowser();
if (!bin) {
  const msg = 'browser part SKIPPED (no Chromium found: set CHROME_PATH, or install one with npx playwright install chromium). This is not a pass; the pages were not opened.';
  if (process.env.CI) fail(msg.replace('SKIPPED', 'could not run') + ' CI is set, so this fails.');
  else browserNote = msg;
} else {
  let server = null; let br = null;
  try {
    server = await startServer();
    br = await launch(bin);
    const shots = process.env.SHOTS ? path.resolve(process.env.SHOTS) : null;
    const pages = [
      ['served', `${server.base}/design-system/index.html`, 'ds'],
      ['snapshot', pathToFileURL(path.join(out, 'index.html')).href, 'ds'],
      ['served-v1', `${server.base}/design-system/legacy/system-v1/proposed.html`, 'v1'],
      ['snapshot-v1', pathToFileURL(path.join(outP, 'index.html')).href, 'v1'],
    ];
    for (const sc of scenarios) {
      const tab = await openTab(br.cdp);
      await br.cdp.send('Emulation.setDeviceMetricsOverride', { width: sc.width, height: 900, deviceScaleFactor: 1, mobile: sc.width < 500 }, tab.sessionId);
      for (const [label, url, kind] of pages) await visit(br.cdp, tab, sc, label, url, kind, shots);
      await br.cdp.send('Target.closeTarget', { targetId: tab.targetId });
    }
    browserNote = `${scenarios.map((s) => s.name).join(', ')}: the Design System and System v1, served and from the snapshot on disk`;
  } catch (e) {
    fail('the browser part could not run: ' + e.message);
  } finally {
    if (br) { try { br.cdp.ws.close(); br.child.kill(); } catch { /* gone */ } fs.rmSync(br.dir, { recursive: true, force: true }); }
    if (server) {
      if (server.child.exitCode === null) await new Promise((r) => { server.child.once('exit', r); server.child.kill(); setTimeout(r, 5000); });
      try { fs.rmSync(server.dataDir, { recursive: true, force: true }); } catch { /* a temp folder; the system clears it */ }
    }
  }
}
fs.rmSync(out, { recursive: true, force: true });
fs.rmSync(outP, { recursive: true, force: true });

for (const w of warnings) say('warning: ' + w);
const secs = ((Date.now() - started) / 1000).toFixed(1);
if (failures.length) { for (const f of failures) console.error('check-design-system: FAIL ' + f); console.error(`check-design-system: ${failures.length} problem(s) in ${secs} s`); process.exit(1); }
say(`ok in ${secs} s. Snapshots ${snap.files.length} files, ${(snap.total / 1024 / 1024).toFixed(2)} MB (design system) and ${snapP.files.length} files, ${(snapP.total / 1024 / 1024).toFixed(2)} MB (system v1). ${browserNote}`);
