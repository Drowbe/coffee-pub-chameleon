// The form standard's measured check (documentation/plans/plan-form-standard.md, step 2). Run as `npm run check:forms`;
// it is NOT part of `npm run check` (builders and quality-assurance run it whenever a form changes).
//
// It starts a throwaway server (PORT and DATA_DIR in a temp folder, its own process, stopped at the end), finds every moved
// form (a form with class="sdk-form" in a bundled module's html or script, the way tools/check-forms.mjs finds them), builds
// a fixture page for each from the module's own markup, host.css and the module's stylesheets, and opens it in headless
// Chromium in the editor window at 1280 px (a 560 px and an 880 px editor), at 700 px and at 390 px (the phone sheet), in
// light and dark. A built-in fixture written to the standard is always measured as well, and a built-in fixture with planted
// drift must fail (the check's own self-test), so a quiet run means something even when no module has moved yet.
//
// It measures: every one-line control is --field-h tall; in a row the controls on one line share a height, a top, and their
// labels share a top; nothing is clipped or overflows (form, fields, the window, a select's longest choice); every field and
// control has a label; focus is visible; a date field is the date picker's (.sdk-datefield); on a phone text is 16 px or more
// and a tick row 44 px or more. It drives Chromium over its DevTools protocol with Node's built-in WebSocket (no dependency).
// Browser: CHROME_PATH, else a Playwright or system Chromium. With none it says so and exits 0 (a skip, never a pass).
// Options: ONLY=<fixture id substring>, SHOTS=<folder> saves a screenshot per scenario.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { movedForms } from './check-forms.mjs';
import { startBrowser, stopBrowser } from './browser-launch.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCENARIOS = [
  { name: '1280/editor 560', width: 1280, editor: 560 },
  { name: '1280/editor 880', width: 1280, editor: 880 },
  { name: '700', width: 700, editor: 560 },
  { name: '390 phone', width: 390, editor: 560 },
];
const MODES = ['light', 'dark'];

// ---- find a browser ----
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

// ---- fixtures ----
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
function formsOf(text, isScript) {
  // The raw markup of each moved form, for the fixture page.
  const out = [];
  const re = isScript ? /<form\b[^>]*\bsdk-form\b[\s\S]*?<\/form>/g : /<form\b[^>]*\bsdk-form\b[\s\S]*?<\/form>/g;
  for (const m of text.matchAll(re)) out.push(isScript ? m[0].replace(/\$\{[^}]*\}/g, 'Sample text') : m[0]);
  return out;
}
const GOOD = `<form class="sdk-form" id="fx-form">
  <label class="sdk-field sdk-full"><span class="sdk-label">Title</span><input id="t" type="text" value="Flight to Lisbon"><span class="sdk-hint"></span></label>
  <div class="sdk-form-row">
    <div class="sdk-field sdk-m" role="group" aria-labelledby="l-day"><span class="sdk-label" id="l-day">Departure day</span><div class="sdk-datefield sdk-group"><input type="date" id="d" value="2026-10-09" aria-labelledby="l-day"><button type="button" class="sdk-icon-btn btn-small btn-quiet" aria-label="Open the calendar">&#9633;</button></div><span class="sdk-hint">Fri</span></div>
    <label class="sdk-field sdk-s"><span class="sdk-label">Departure time</span><input id="tm" type="time" value="10:30"><span class="sdk-hint"></span></label>
    <div class="sdk-field sdk-m" role="group" aria-labelledby="l-dur"><span class="sdk-label" id="l-dur">Flight time</span><div class="sdk-group sdk-duration"><input id="h" type="text" inputmode="numeric" value="2" aria-label="Hours"><span class="sdk-unit">h</span><input id="mi" type="text" inputmode="numeric" value="30" aria-label="Minutes"><span class="sdk-unit">min</span></div><span class="sdk-hint"></span></div>
  </div>
  <div class="sdk-form-row">
    <label class="sdk-field sdk-m"><span class="sdk-label">Class</span><select id="c"><option>Economy</option><option>Premium economy</option><option>Business</option></select><span class="sdk-hint"></span></label>
    <label class="sdk-field sdk-l"><span class="sdk-label">Address</span><input id="a" type="text" value="Rua Augusta 100, Lisboa"><span class="sdk-hint"></span></label>
  </div>
  <div class="sdk-choice-list"><label class="sdk-choice-row"><input type="checkbox" id="rt"> Round trip</label></div>
  <label class="sdk-field sdk-full"><span class="sdk-label">Notes</span><textarea id="n" rows="3"></textarea><span class="sdk-hint"></span></label>
</form>`;
// Planted drift: a field 30 px tall, a label pushed down, a wide select that is cut, a field with no label, a bare date field.
const BAD = `<form class="sdk-form" id="fx-form">
  <div class="sdk-form-row">
    <label class="sdk-field sdk-m"><span class="sdk-label">Day</span><input id="d" type="date" style="height:30px"><span class="sdk-hint"></span></label>
    <label class="sdk-field sdk-s"><span class="sdk-label" style="margin-top:9px">Time</span><input id="tm" type="time"><span class="sdk-hint"></span></label>
    <label class="sdk-field sdk-s"><span class="sdk-label">Pick</span><select id="c" style="width:70px"><option>A very long choice that cannot fit in the box at all</option></select><span class="sdk-hint"></span></label>
    <label class="sdk-field sdk-s"><input id="nolabel" type="text"></label>
  </div>
</form>`;
const fixtures = new Map(); // id -> { title, formHtml, css (inline text), builtIn, planted }
fixtures.set('built-in/good', { title: 'built-in fixture written to the standard', formHtml: GOOD, css: '' });
fixtures.set('built-in/planted-drift', { title: 'built-in fixture with planted drift (must fail)', formHtml: BAD, css: '', planted: true });
function collectModuleFixtures() {
  for (const m of fs.readdirSync(path.join(root, 'modules'))) {
    const src = path.join(root, 'modules', m, 'src');
    if (!fs.existsSync(src)) continue;
    const files = fs.readdirSync(src);
    const css = files.filter((f) => f.endsWith('.css')).map((f) => read(`modules/${m}/src/${f}`)).join('\n');
    for (const f of files.filter((f) => /\.(html|js)$/.test(f))) {
      const text = read(`modules/${m}/src/${f}`);
      const isScript = f.endsWith('.js');
      const raws = formsOf(text, isScript);
      const nodes = movedForms(text, isScript);
      raws.forEach((raw, i) => fixtures.set(`modules/${m}/${f}#${i + 1}`, { title: `modules/${m}/src/${f} form ${i + 1}${nodes[i]?.attrs.id ? ' #' + nodes[i].attrs.id : ''}`, formHtml: raw, css, mount: true }));
    }
  }
}
// The app's own forms (Set up, the Phases sheet, Manage) join here when they move (plan steps 10 to 12).
const APP_FORMS = [];

// The page script that mounts the SDK's pickers the way a module's own script does at runtime. A module's markup holds plain
// inputs; its script then calls host.ui.datePicker / currencySelect / kindPicker on them. The fixture loads the real
// /sdk/host.js (in its host-page mode, which exposes createHost) with a stand-in transport and mounts the same pickers on the
// same kinds of field: every date and date-time input, a select whose id or name says "currency", and a kind box
// (#f-types, a .sdk-kind-box or [data-kind-box]). The mounted controls are then the real ones, measured as a person sees them.
const MOUNT_SCRIPT = `
window.__mounted = (async () => {
  if (!window.createHost) return 'no SDK';
  const locale = { language: 'en', clock: '12', currency: 'USD', currencies: ['EUR', 'GBP', 'JPY', 'USD'] };
  const { host } = window.createHost({ call: async (m) => (m === 'hello' ? { locale } : {}), root: document, rootElement: document.body });
  try { await host.ready(); } catch (e) { /* the stand-in answers enough for the pickers */ }
  const form = document.querySelector('#fx-dialog form');
  if (!form) return 'no form';
  const errs = [];
  const tryMount = (what, fn) => { try { fn(); } catch (e) { errs.push(what + ': ' + e.message); } };
  for (const i of form.querySelectorAll('input[type=date], input[type=datetime-local]')) tryMount('datePicker #' + i.id, () => host.ui.datePicker(i, { clearable: !i.required }));
  for (const s of form.querySelectorAll('select')) if (/currency/i.test(s.id + ' ' + (s.getAttribute('name') || ''))) tryMount('currencySelect #' + s.id, () => host.ui.currencySelect(s, { value: '', empty: true }));
  for (const b of form.querySelectorAll('#f-types, .sdk-kind-box, [data-kind-box]')) {
    tryMount('kindPicker #' + b.id, () => host.ui.kindPicker(b, { label: 'What is it', value: 'sight', groups: [
      { label: 'Places', options: [{ id: 'sight', label: 'Sight', icon: 'landmark', color: '#c47a2c', words: 'sight' }, { id: 'food', label: 'Food and drink', icon: 'utensils', color: '#2c7ac4', words: 'food' }] },
      { label: 'Getting about', options: [{ id: 'flight', label: 'Flight', icon: 'plane', color: '#7a2cc4', words: 'flight' }] }] }));
  }
  return errs.join('; ');
})();`;

function pageHtml(fx, hostCssUrl) {
  const sdkUrl = hostCssUrl.replace(/host\.css$/, 'host.js');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${hostCssUrl.replace(/sdk\/host\.css$/, 'style.css')}"><link rel="stylesheet" href="${hostCssUrl.replace(/host\.css$/, 'system.css')}"><link rel="stylesheet" href="${hostCssUrl}">${fx.mount ? `<script data-host-sdk src="${sdkUrl}"></script>` : ''}<style>${fx.css}</style><style>html,body{margin:0;background:var(--bg);color:var(--text);font:14px system-ui,sans-serif}</style></head>
<body><dialog class="sdk-editor" id="fx-dialog">${fx.formHtml}</dialog>
<script>
const q = new URLSearchParams(location.search);
document.documentElement.dataset.themeMode = q.get('mode') || 'light';
const d = document.getElementById('fx-dialog');
if (q.get('editor') === '880') d.classList.add('sdk-editor-large');
d.showModal();
const kind = q.get('kind');
if (kind) { const f = d.querySelector('form'); f.dataset.kind = kind; for (const e of f.querySelectorAll('[data-types]')) e.hidden = !e.dataset.types.split(/[\\s,]+/).includes(kind); }
${fx.mount ? MOUNT_SCRIPT : 'window.__mounted = Promise.resolve("");'}
</script></body></html>`;
}

// ---- the measurement (runs in the page) ----
function measure() {
  const out = [];
  const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const dlg = document.getElementById('fx-dialog');
  const form = dlg.querySelector('form');
  if (!form) return [{ rule: 'setup', where: 'page', detail: 'no form in the fixture' }];
  const fieldH = parseFloat(getComputedStyle(form).getPropertyValue('--field-h')) || 0;
  const phone = fieldH >= 44;
  const nm = (e) => e.id ? '#' + e.id : (e.getAttribute('name') ? '[name=' + e.getAttribute('name') + ']' : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : ''));
  const add = (rule, where, detail) => out.push({ rule, where, detail });
  const oneLine = (e) => e.matches('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=range]):not([type=file]):not([type=color]), select') && vis(e);
  const r1 = (n) => Math.round(n * 10) / 10;
  if (!(fieldH > 0)) add('tokens', 'form', '--field-h is not defined');
  // Labels and focus.
  const controls = [...form.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(vis);
  for (const c of controls) {
    const field = c.closest('.sdk-field');
    const check = c.closest('.sdk-choice-row, .sdk-people, .sdk-kind'); // the kind picker is a self-contained control, labelled by aria-label
    if (!field && !check) { add('field', nm(c), 'is not inside a .sdk-field or .sdk-choice-row'); continue; }
    const named = (c.labels && [...c.labels].some((l) => l.textContent.trim())) || c.getAttribute('aria-label') || c.getAttribute('aria-labelledby') || (field && field.querySelector('.sdk-label')?.textContent.trim() && field.tagName === 'LABEL');
    if (!named) add('label', nm(c), 'has no label');
  }
  for (const f of [...form.querySelectorAll('.sdk-field')].filter(vis)) {
    const l = f.querySelector('.sdk-label');
    if (!l || !l.textContent.trim()) add('label', nm(f), 'field has no label text');
  }
  const kinds = new Set();
  for (const c of controls) {
    if (c.matches('input[type=checkbox], input[type=radio]') || c.disabled) continue;
    c.focus();
    const cs = getComputedStyle(c.closest('.sdk-kind-field') || c); // the kind picker rings its whole field, not the bare input
    const ring = (cs.boxShadow && cs.boxShadow !== 'none') || (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0);
    if (document.activeElement === c && !ring) add('focus', nm(c), 'shows no focus ring');
    kinds.add(c.type);
  }
  document.activeElement && document.activeElement.blur();
  // Heights of one-line controls.
  // (The kind picker's typing input sits inside its field, which is the control and is measured below.)
  for (const c of [...form.querySelectorAll('.sdk-field *')].filter((e) => oneLine(e) && !e.matches('.sdk-kind-input'))) {
    const h = c.getBoundingClientRect().height;
    if (Math.abs(h - fieldH) > 0.5) add('height', nm(c), `is ${r1(h)} px tall, the field height is ${fieldH} px`);
    if (c.matches('input, select')) {
      const fs = parseFloat(getComputedStyle(c).fontSize);
      if (phone && fs < 16) add('phone-text', nm(c), `text is ${fs} px, a phone needs 16 px`);
    }
    if (c.matches('input[type=date]') && !c.closest('.sdk-datefield')) add('date-picker', nm(c), 'is a date field that is not the date picker\'s (.sdk-datefield)');
    if (c.scrollWidth > c.clientWidth + 1 && c.tagName === 'SELECT') add('clipped', nm(c), `a choice is cut off (${c.scrollWidth} > ${c.clientWidth})`);
  }
  for (const k of [...form.querySelectorAll('.sdk-kind-field')].filter(vis)) {
    const h = k.getBoundingClientRect().height;
    if (Math.abs(h - fieldH) > 0.5) add('height', 'kind picker', `is ${r1(h)} px tall, the field height is ${fieldH} px`);
    const inp = k.querySelector('input');
    if (inp && phone && parseFloat(getComputedStyle(inp).fontSize) < 16) add('phone-text', 'kind picker', 'text is under 16 px, a phone needs 16 px');
  }
  for (const s of [...form.querySelectorAll('select')].filter(vis)) {
    const cv = document.createElement('canvas').getContext('2d');
    const cs = getComputedStyle(s);
    cv.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const longest = Math.max(0, ...[...s.options].map((o) => cv.measureText(o.text).width));
    const shown = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 20;
    if (longest > shown + 1) add('clipped', nm(s), `its longest choice is ${Math.round(longest)} px wide, the box shows ${Math.round(shown)} px`);
  }
  // Tick rows.
  for (const c of [...form.querySelectorAll('.sdk-choice-row')].filter(vis)) {
    const h = c.getBoundingClientRect().height;
    if (h < (phone ? 44 : 32) - 0.5) add('tick-row', nm(c), `is ${r1(h)} px tall, it needs ${phone ? 44 : 32} px`);
  }
  // Rows: fields on one line.
  for (const row of [...form.querySelectorAll('.sdk-form-row, .sdk-when')].filter(vis)) {
    const fields = [...row.querySelectorAll('.sdk-field')].filter((f) => vis(f) && f.closest('.sdk-form-row, .sdk-when') === row);
    const lines = [];
    for (const f of fields.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)) {
      const t = f.getBoundingClientRect().top;
      const line = lines.find((l) => Math.abs(l.top - t) < 20);
      if (line) line.fields.push(f); else lines.push({ top: t, fields: [f] });
    }
    lines.forEach((line, i) => {
      if (line.fields.length < 2) return;
      const where = `row ${nm(row)}${lines.length > 1 ? ' line ' + (i + 1) : ''}`;
      const names = (fs) => fs.map((f) => nm(f.querySelector('input, select, textarea') || f)).join(', ');
      const tops = line.fields.map((f) => { const l = f.querySelector('.sdk-label'); return l ? l.getBoundingClientRect().top : NaN; }).filter((n) => !Number.isNaN(n));
      if (tops.length && Math.max(...tops) - Math.min(...tops) > 1) add('label-top', where, `labels start at different heights (${tops.map(r1).join(', ')}): ${names(line.fields)}`);
      // The kind picker's typing input is measured by its field (the control in the row).
      const ctl = line.fields.map((f) => [...f.querySelectorAll('*')].find(oneLine)).filter(Boolean).map((c) => c.closest('.sdk-kind-field') || c);
      const ct = ctl.map((c) => c.getBoundingClientRect().top);
      const ch = ctl.map((c) => c.getBoundingClientRect().height);
      if (ct.length > 1 && Math.max(...ct) - Math.min(...ct) > 1) add('control-top', where, `controls sit at different heights (${ct.map(r1).join(', ')}): ${names(line.fields)}`);
      if (ch.length > 1 && Math.max(...ch) - Math.min(...ch) > 1) add('row-height', where, `controls in one row have different heights (${ch.map(r1).join(', ')}): ${names(line.fields)}`);
    });
  }
  // Nothing clipped or overflowing.
  const over = (e, what) => { if (e.scrollWidth > e.clientWidth + 1) add('overflow', what, `scrollWidth ${e.scrollWidth} > clientWidth ${e.clientWidth}`); };
  over(form, 'form'); over(dlg, 'window');
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) add('overflow', 'page', 'the page scrolls sideways');
  const fr = form.getBoundingClientRect();
  for (const f of [...form.querySelectorAll('.sdk-field')].filter(vis)) {
    over(f, 'field ' + nm(f.querySelector('input, select, textarea') || f));
    const r = f.getBoundingClientRect();
    if (r.right > fr.right + 1 || r.left < fr.left - 1) add('overflow', 'field ' + nm(f.querySelector('input, select, textarea') || f), 'sticks out of the form');
    for (const c of f.querySelectorAll('input, select, textarea, button')) {
      if (!vis(c)) continue;
      const cr = c.getBoundingClientRect();
      if (cr.right > r.right + 1) add('overflow', nm(c), `reaches ${r1(cr.right - r.right)} px past its field`);
    }
  }
  return out;
}

// ---- Chromium over the DevTools protocol ----
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else if (m.method) this.events.push(m); }); }
  send(method, params = {}, sessionId) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params, sessionId })); return new Promise((res, rej) => { this.pending.set(id, { res, rej }); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout: ' + method)); } }, 20000); }); }
}
async function launch(bin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forms-live-chrome-'));
  const child = startBrowser(bin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'], dir);
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
async function startServer() {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forms-live-data-'));
  const child = spawn(process.execPath, ['server/index.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ADMIN_PASSWORD: 'testpass1234', BASE_DOMAIN: '' } });
  let log = '';
  child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(base + '/healthz'); if (r.ok) return { base, child, dataDir }; } catch { /* not up yet */ }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error('the throwaway server did not start: ' + log.slice(-400));
}

// ---- run ----
async function main() {
  const bin = findBrowser();
  if (!bin) { console.log('check-forms-live: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.'); return 0; }
  collectModuleFixtures();
  const only = process.env.ONLY;
  const server = await startServer();
  let browser = null; let fx;
  const results = [];
  let planted = null;
  try {
    const hostCssUrl = server.base + '/sdk/host.css';
    const cssRes = await fetch(hostCssUrl);
    if (!cssRes.ok) throw new Error(`the server did not serve ${hostCssUrl} (${cssRes.status})`);
    // Fixture pages are served by this script, with the app server's host.css.
    fx = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const f = fixtures.get(decodeURIComponent(u.pathname.slice(1)));
      if (!f) { res.writeHead(404); res.end('no such fixture'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(pageHtml(f, hostCssUrl));
    });
    await new Promise((r) => fx.listen(0, '127.0.0.1', r));
    const fxBase = `http://127.0.0.1:${fx.address().port}`;
    browser = await launch(bin);
    const { cdp } = browser;
    const runOne = async (id, sc, mode, kind) => {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      try {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: sc.width, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
        await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
        await cdp.send('Page.enable', {}, sessionId);
        const q = new URLSearchParams({ mode, editor: String(sc.editor) });
        if (kind) q.set('kind', kind);
        await cdp.send('Page.navigate', { url: `${fxBase}/${encodeURIComponent(id)}?${q}` }, sessionId);
        for (let i = 0; i < 100; i++) {
          const r = await cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, sessionId);
          if (r.result.value === 'complete') break;
          await new Promise((r2) => setTimeout(r2, 100));
        }
        const mounted = await cdp.send('Runtime.evaluate', { expression: 'window.__mounted', awaitPromise: true, returnByValue: true }, sessionId);
        if (mounted.result.value) throw new Error(`the SDK pickers did not mount in ${id}: ${mounted.result.value}`);
        await cdp.send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => 1)', awaitPromise: true }, sessionId);
        const r = await cdp.send('Runtime.evaluate', { expression: `(${measure.toString()})()`, returnByValue: true }, sessionId);
        if (r.exceptionDetails) throw new Error('measure failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        if (process.env.SHOTS) {
          const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
          fs.mkdirSync(process.env.SHOTS, { recursive: true });
          fs.writeFileSync(path.join(process.env.SHOTS, `${id.replace(/[^\w]+/g, '_')}-${sc.name.replace(/[^\w]+/g, '_')}-${mode}${kind ? '-' + kind : ''}.png`), Buffer.from(shot.data, 'base64'));
        }
        return r.result.value;
      } finally { await cdp.send('Target.closeTarget', { targetId }).catch(() => {}); }
    };
    let scenarios = 0;
    for (const [id, f] of fixtures) {
      if (only && !id.includes(only)) continue;
      const kindList = [...new Set([...f.formHtml.matchAll(/data-types="([^"]*)"/g)].flatMap((m) => m[1].split(/[\s,]+/).filter(Boolean)))];
      for (const sc of SCENARIOS) for (const mode of MODES) for (const kind of (kindList.length ? kindList : [null])) {
        scenarios++;
        const fails = await runOne(id, sc, mode, kind);
        for (const x of fails) (f.planted ? (planted ||= []) : results).push({ id, sc: sc.name, mode, kind, ...x });
      }
    }
    console.log(`check-forms-live: ${fixtures.size} form fixture${fixtures.size === 1 ? '' : 's'} (${[...fixtures.keys()].filter((k) => k.startsWith('modules/')).length} moved module form${[...fixtures.keys()].filter((k) => k.startsWith('modules/')).length === 1 ? '' : 's'}, ${APP_FORMS.length} app form${APP_FORMS.length === 1 ? '' : 's'}, 2 built-in), ${scenarios} scenarios (${SCENARIOS.length} sizes x ${MODES.length} themes).`);
  } finally {
    try {
      if (browser) {
        browser.cdp.ws.close();
        await stopBrowser(browser.child, browser.dir);
      }
    } catch { /* best effort */ }
    fx?.close();
    const gone = new Promise((r) => server.child.once('exit', r));
    server.child.kill();
    await Promise.race([gone, new Promise((r) => setTimeout(r, 5000))]);
    fs.rmSync(server.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  // The self-test: planted drift must be caught, in at least the label, height, clipped, label-top and date-picker rules.
  const caught = new Set((planted || []).map((p) => p.rule));
  const need = ['height', 'label-top', 'clipped', 'label', 'date-picker'];
  const missed = only && !'built-in/planted-drift'.includes(only) ? [] : need.filter((n) => !caught.has(n));
  if (missed.length) { console.log(`check-forms-live: SELF-TEST FAILED. The planted drift was not caught by: ${missed.join(', ')}.`); return 1; }
  if (results.length) {
    const w = [28, 16, 6, 12, 40];
    const rowOf = (a) => a.map((c, i) => String(c ?? '').padEnd(w[i] ?? 0)).join(' ');
    console.log('\nFAILURES');
    console.log(rowOf(['form', 'size', 'theme', 'rule', 'where']) + ' detail');
    const seen = new Set();
    for (const r of results) {
      const line = rowOf([r.id + (r.kind ? ' [' + r.kind + ']' : ''), r.sc, r.mode, r.rule, r.where]) + ' ' + r.detail;
      if (seen.has(line)) continue; seen.add(line); console.log(line);
    }
    console.log(`\ncheck-forms-live: FAIL (${seen.size} failure${seen.size === 1 ? '' : 's'}).`);
    return 1;
  }
  console.log(`check-forms-live: ok (self-test: planted drift caught by ${[...caught].sort().join(', ')}).`);
  return 0;
}
main().then((c) => process.exit(c), (e) => { console.error('check-forms-live: ERROR ' + (e.stack || e)); process.exit(1); });
