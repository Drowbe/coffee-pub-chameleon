#!/usr/bin/env node
/*
 * check-confirm.mjs -- the styled confirm (design system step 19: Dialogs and sheets, the confirm).
 *
 * The browser's own window.confirm is gone: every question asks through public/confirm.js (confirmDialog; pages) or host.ui.confirm
 * (modules; the SDK asks the page, module-host.js answers with confirmDialog). This fails when:
 *   1. Static. A native confirm( call is left in public/ or modules/ (the allow-list is zero; the design-system pages, which write
 *      about it, and vendored libraries in public/lib are not code that asks). The SDK has no host.ui.confirm that asks 'ui.confirm'
 *      and refuses a missing title; the frame's call times out a question after 30s; module-host.js has no 'ui.confirm' handler that
 *      uses confirmDialog; the system.css confirm block is missing or draws a width other than 360.
 *   2. The rules, in Node. cleanConfirm refuses a missing title and an unknown kind (status 400), trims and caps, and only a final
 *      confirm keeps `typed`; confirmDialog rejects (it does not resolve false) when it is asked badly.
 *   3. In Chromium (skipped, said so, when there is none), with the real keys sent over the DevTools protocol: the promise resolves true
 *      on the action and false on Cancel, Escape, the close button and the backdrop (never rejects for a no); the dialog is an
 *      alertdialog, named by its title and described by its message; it is 360px wide at 1280 and not full screen at 390; focus starts
 *      on Cancel for a destructive or final confirm and on the action for a plain one; Tab and Shift+Tab stay inside the dialog; Enter
 *      presses the focused button; a typed final confirm keeps its action off until the name matches; focus goes back to the control that
 *      opened it; the page's scroll lock is set and cleared; nothing is left in the page after any answer.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const failures = [];
let passed = 0;
const fail = (m) => failures.push(m);
const ok = (cond, m) => { if (cond) passed += 1; else fail(m); };

// ---- 1. static ----
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'lib' || e.name === 'design-system') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(js|mjs|html)$/.test(e.name)) out.push(p);
  }
  return out;
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const NATIVE = /(?:\b(?:window|globalThis|self|top|parent)\s*\.\s*confirm\s*\(|(?:^|[^\w.$])confirm\s*\()/;
for (const file of [...walk(path.join(ROOT, 'public')), ...walk(path.join(ROOT, 'modules'))]) {
  const rel = path.relative(ROOT, file);
  if (rel.includes(`${path.sep}dist${path.sep}`)) continue;
  stripComments(fs.readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
    if (NATIVE.test(line)) fail(`${rel}:${i + 1}: a native confirm( call; ask with confirmDialog (pages) or host.ui.confirm (modules)`);
  });
}
{
  const sdk = read('public/sdk/host.js');
  ok(/confirm:\s*\(o\)\s*=>[\s\S]{0,400}call\('ui\.confirm'/.test(sdk), 'public/sdk/host.js: host.ui.confirm does not ask the page (call "ui.confirm")');
  ok(/typeof t\.title !== 'string'[\s\S]{0,200}Promise\.reject/.test(sdk), 'public/sdk/host.js: host.ui.confirm does not reject a missing title');
  ok(/if \(method === 'ui\.confirm'( \|\| method === 'objects\.pick')?\) return;[\s\S]{0,80}setTimeout/.test(sdk), 'public/sdk/host.js: a frame\'s question times out after 30s (it should wait for the person)');
  const mh = read('public/module-host.js');
  ok(/import \{ confirmDialog \} from '\/confirm\.js'/.test(mh) && /'ui\.confirm'\(o\)\s*\{[\s\S]{0,80}confirmDialog\(o\)/.test(mh), 'public/module-host.js: no "ui.confirm" handler that asks with confirmDialog');
  const css = read('public/sdk/system.css');
  const block = /\/\* confirm:start \*\/([\s\S]*?)\/\* confirm:end \*\//.exec(css);
  ok(Boolean(block), 'public/sdk/system.css: no confirm:start / confirm:end block');
  const dialogs = /\/\* dialogs:start \*\/([\s\S]*?)\/\* dialogs:end \*\//.exec(css);
  ok(Boolean(dialogs), 'public/sdk/system.css: no dialogs:start / dialogs:end block');
  if (block && dialogs) {
    // The confirm takes the shell from the Dialogs block (no copy of it in its own): it is named in the shell's list, at the
    // confirm width, and its head, title and foot are the shared ones. The block holds only the confirm's own rules.
    const shell = /:is\(([^)]*)\) \{\s*--dlg-w: var\(--dlg-w-form\);[\s\S]*?\n\}/.exec(dialogs[1]);
    ok(Boolean(shell) && /\.sdk-dialog-confirm/.test(shell[1]), 'system.css: the dialog shell does not name .sdk-dialog-confirm');
    ok(/--dlg-w-confirm:\s*360px/.test(dialogs[1]) && /:is\(\.aside-overlay-card, \.sdk-dialog-confirm\) \{ --dlg-w: var\(--dlg-w-confirm\); \}/.test(dialogs[1]), 'system.css dialogs block: the confirm is not 360px wide');
    ok(shell && /box-shadow:\s*var\(--shadow-3\)/.test(shell[0]) && /\.sdk-dialog-confirm\)::backdrop \{ background: var\(--scrim\); \}/.test(dialogs[1]), 'system.css dialogs block: no --shadow-3 or --scrim for the confirm');
    for (const part of ['sdk-dialog-head', 'sdk-dialog-title', 'sdk-dialog-close', 'sdk-dialog-foot']) ok(new RegExp(`\\.${part}\\b`).test(dialogs[1]), `system.css dialogs block: no .${part}`);
    ok(!/border-radius|box-shadow|--dlg-pad-x:|width:\s*min\(360px/.test(block[1]), 'system.css confirm block: it repeats the shell rules the Dialogs block holds');
    ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(block[1]), 'system.css confirm block: a raw colour');
  }
}

// ---- 2. the rules, in Node ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-confirm-'));
fs.copyFileSync(path.join(ROOT, 'public/confirm.js'), path.join(tmp, 'confirm.mjs'));
const { cleanConfirm, confirmDialog } = await import(pathToFileURL(path.join(tmp, 'confirm.mjs')).href);
const throws = (fn, m) => { try { fn(); } catch (e) { return e.status === 400 && (!m || m.test(e.message)); } return false; };
ok(throws(() => cleanConfirm({}), /title/), 'cleanConfirm: a missing title is not refused (400)');
ok(throws(() => cleanConfirm({ title: '   ' }), /title/), 'cleanConfirm: a blank title is not refused');
ok(throws(() => cleanConfirm({ title: 'x', kind: 'loud' }), /kind/), 'cleanConfirm: an unknown kind is not refused');
ok(throws(() => cleanConfirm(null)), 'cleanConfirm: null is not refused');
{
  const c = cleanConfirm({ title: ' Delete? ', message: ' Gone. ', typed: 'Paris' });
  ok(c.title === 'Delete?' && c.message === 'Gone.' && c.action === 'OK' && c.cancel === 'Cancel' && c.kind === 'plain' && c.typed === '', 'cleanConfirm: defaults and trimming (plain, OK, Cancel, no typed name)');
  ok(cleanConfirm({ title: 'x', kind: 'final', typed: 'Paris' }).typed === 'Paris', 'cleanConfirm: a final confirm lost its typed name');
  ok(cleanConfirm({ title: 'x'.repeat(500) }).title.length === 200, 'cleanConfirm: the title is not cut to 200');
}
for (const bad of [undefined, {}, { title: '' }, { title: 'x', kind: 'nope' }]) {
  let outcome = 'resolved';
  await confirmDialog(bad, {}).then(() => { outcome = 'resolved'; }, (e) => { outcome = e && e.status === 400 ? 'rejected' : 'rejected-other'; });
  ok(outcome === 'rejected', `confirmDialog(${JSON.stringify(bad)}) should reject with a 400; it ${outcome}`);
}
{
  let outcome = 'resolved';
  await confirmDialog({ title: 'x' }, null).then(() => {}, () => { outcome = 'rejected'; });
  ok(outcome === 'rejected', 'confirmDialog with no page should reject');
}

// ---- 3. the browser ----
function findBrowser() {
  const cands = [process.env.CHROME_PATH];
  const pw = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(pw)) {
    for (const d of fs.readdirSync(pw).sort().reverse()) {
      cands.push(path.join(pw, d, 'chrome-linux', 'chrome'), path.join(pw, d, 'chrome-linux', 'headless_shell'), path.join(pw, d, 'chrome-win', 'chrome.exe'),
        path.join(pw, d, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
    }
  }
  cands.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium');
  return cands.find((c) => c && fs.existsSync(c)) || null;
}
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
const PAGE = `<!doctype html><html data-theme-mode="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/sdk/system.css"></head>
<body><button id="opener" type="button">Open</button><button id="after" type="button">After</button><div style="height:3000px"></div></body></html>`;
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/t.html') { res.setHeader('content-type', 'text/html'); res.end(PAGE); return; }
    const file = path.join(ROOT, 'public', path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end(); return; }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } }); }
  send(method, params = {}, sessionId) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params, sessionId })); return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
}
async function launch(bin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-confirm-chrome-'));
  const child = spawn(bin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let buf = ''; const t = setTimeout(() => reject(new Error('the browser did not start: ' + buf.slice(-300))), 20000);
    child.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); resolve(m[1]); } });
    child.on('exit', (c) => { clearTimeout(t); reject(new Error('the browser exited (' + c + ')')); });
  });
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('cannot reach the browser'))); });
  return { cdp: new Cdp(ws), child, dir, ws };
}

let note = '';
const bin = findBrowser();
if (!bin) note = ' (browser part SKIPPED: no Chromium found; set CHROME_PATH. This is not a pass)';
else {
  const { server, base } = await serve();
  const { cdp, child, dir, ws } = await launch(bin);
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => cdp.send(m, p, sessionId);
    await s('Page.enable');
    const ev = async (expression) => {
      const r = await s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const key = async (k, mods = 0) => {
      const code = { Escape: 27, Tab: 9, Enter: 13 }[k];
      const base = { key: k, code: k, windowsVirtualKeyCode: code, modifiers: mods };
      await s("Input.dispatchKeyEvent", k === "Enter" ? { type: "keyDown", ...base, text: "\r" } : { type: "rawKeyDown", ...base });
      await s('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    };
    const click = async (x, y) => { await s('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); };
    const state = () => ev(`(() => { const d = document.querySelector('dialog.sdk-dialog-confirm'); const a = document.activeElement; return JSON.stringify({ open: Boolean(d && d.open), active: a ? (a.dataset.ok !== undefined ? 'action' : a.dataset.close !== undefined ? (a.classList.contains('sdk-dialog-close') ? 'close' : 'cancel') : a.tagName === 'INPUT' ? 'input' : a.id || a.tagName) : null, overflow: document.documentElement.style.overflow, count: document.querySelectorAll('dialog').length }); })()`).then(JSON.parse);
    // Ask a question from the opener; the promise's outcome is kept on window.__r.
    const ask = async (opts) => {
      await ev(`(() => { window.__r = 'pending'; const o = document.getElementById('opener'); o.focus(); window.__p = window.__cd(${JSON.stringify(opts)}).then((v) => { window.__r = 'resolved:' + v; }, (e) => { window.__r = 'rejected:' + e.message; }); return true; })()`);
      await wait(120);
    };
    const result = async () => { await wait(60); return ev('window.__r'); };
    const afterAnswer = async (what, want) => {
      const r = await result();
      ok(r === want, `${what}: the promise was ${r}, wanted ${want}`);
      const st = await state();
      ok(st.count === 0, `${what}: a dialog is left in the page`);
      ok(st.overflow === '', `${what}: the page's scroll lock was not cleared (${st.overflow})`);
      ok(st.active === 'opener', `${what}: focus did not go back to the opener (it is on ${st.active})`);
    };

    for (const [width, label] of [[1280, '1280'], [390, '390']]) {
      await s('Emulation.setDeviceMetricsOverride', { width, height: width === 390 ? 780 : 800, deviceScaleFactor: 1, mobile: width === 390 });
      await s('Page.navigate', { url: `${base}/t.html` });
      for (let i = 0; i < 100 && !(await ev("document.readyState === 'complete'").catch(() => false)); i += 1) await wait(100);
      await ev(`import('/confirm.js').then((m) => { window.__cd = m.confirmDialog; return true; })`);
      await ev("document.fonts.ready.then(() => true)");

      const destructive = { title: 'Delete the Paris trip?', message: 'Its places and notes are deleted.\n\nThis cannot be undone.', action: 'Delete', kind: 'destructive' };
      await ask(destructive);
      let st = await state();
      ok(st.open, `${label}: the dialog did not open`);
      ok(st.active === 'cancel', `${label}: a destructive confirm should focus Cancel (focus is on ${st.active})`);
      ok(st.overflow === 'hidden', `${label}: the page behind is not locked while the dialog is open`);
      const shape = JSON.parse(await ev(`(() => { const d = document.querySelector('dialog.sdk-dialog-confirm'); const r = d.getBoundingClientRect(); const t = document.getElementById(d.getAttribute('aria-labelledby')); const m = document.getElementById(d.getAttribute('aria-describedby')); const cs = getComputedStyle(d);
        const ok = d.querySelector('[data-ok]'); return JSON.stringify({ role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), title: t && t.textContent, paras: m ? m.querySelectorAll('p').length : -1, w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow !== 'none', fx: Math.round(r.left + r.width / 2), fy: Math.round(r.top + r.height / 2),
        order: [...d.querySelectorAll('button')].map((b) => b.textContent.trim() || b.getAttribute('aria-label')).join('|'), okText: ok.textContent, okClass: ok.className, okBg: getComputedStyle(ok).backgroundColor, parts: [...d.querySelectorAll('.sdk-dialog-body > *')].map((c) => c.tagName + ':' + Math.round(c.getBoundingClientRect().height) + ':' + getComputedStyle(c).display).join(' ') + ' // ' + [...d.children].map((c) => c.className + ':' + Math.round(c.getBoundingClientRect().height)).join(' ') }); })()`));
      ok(shape.role === 'alertdialog' && shape.modal === 'true', `${label}: the confirm is not an alertdialog with aria-modal`);
      ok(shape.title === 'Delete the Paris trip?', `${label}: the dialog is not named by its title (${shape.title})`);
      ok(shape.paras === 2, `${label}: the message should be two paragraphs (${shape.paras})`);
      ok(shape.order === 'Close|Cancel|Delete', `${label}: the buttons are ${shape.order}, wanted Close|Cancel|Delete (Cancel before the action)`);
      ok(/btn-danger/.test(shape.okClass) && !/solid/.test(shape.okClass), `${label}: a destructive confirm should use the soft Danger (${shape.okClass})`);
      if (width === 1280) ok(shape.w === 360, `${label}: the confirm is ${shape.w}px wide, wanted 360`);
      else ok(shape.w === shape.vw - 32 && shape.h < shape.vh - 100, `${label}: on a phone the confirm should stay a card (${shape.w}x${shape.h} in ${shape.vw}x${shape.vh}), not full screen (${shape.parts})`);
      ok(shape.h < 400, `${label}: the confirm is ${shape.h}px tall; it should fit its words`);
      ok(shape.radius !== '0px' && shape.shadow, `${label}: the confirm has no radius or no shadow`);
      // Focus trap: Tab from the action wraps to the close; Shift+Tab from the close wraps to the action.
      await key('Tab'); st = await state(); ok(st.active === 'action', `${label}: Tab from Cancel should reach the action (${st.active})`);
      await key('Tab'); st = await state(); ok(st.active === 'close', `${label}: Tab from the last control should wrap to the first (${st.active})`);
      await key('Tab', 8); st = await state(); ok(st.active === 'action', `${label}: Shift+Tab from the first control should wrap to the last (${st.active})`);
      // Escape cancels: resolves false.
      await key('Escape');
      await afterAnswer(`${label} Escape`, 'resolved:false');

      // The action (a click) resolves true.
      await ask(destructive);
      await ev("document.querySelector('[data-ok]').click()");
      await afterAnswer(`${label} action`, 'resolved:true');
      // Cancel, and the close button, resolve false.
      await ask(destructive);
      await ev("document.querySelector('.sdk-dialog-foot [data-close]').click()");
      await afterAnswer(`${label} Cancel`, 'resolved:false');
      await ask(destructive);
      await ev("document.querySelector('.sdk-dialog-close').click()");
      await afterAnswer(`${label} close button`, 'resolved:false');
      // The backdrop: a click outside the card.
      await ask(destructive);
      await click(2, 2);
      await afterAnswer(`${label} backdrop`, 'resolved:false');
      // A click inside the card but not on a button does nothing.
      await ask(destructive);
      await click(shape.fx, shape.fy - 20);
      ok((await result()) === 'pending' && (await state()).open, `${label}: a click inside the card closed it`);
      await key('Escape');
      await afterAnswer(`${label} Escape (again)`, 'resolved:false');

      // A plain question: the action is the main button and holds the focus; Enter presses it.
      await ask({ title: 'Make a new address?', message: 'The old address stops working.', action: 'Make new' });
      st = await state();
      ok(st.active === 'action', `${label}: a plain confirm should focus its action (focus is on ${st.active})`);
      ok(/btn-primary/.test(await ev("document.querySelector('[data-ok]').className")), `${label}: a plain confirm's action should be Primary`);
      await key('Enter');
      await afterAnswer(`${label} Enter on the action`, 'resolved:true');
      // Enter on Cancel (destructive's start) cancels, it does not delete.
      await ask(destructive);
      await key('Enter');
      await afterAnswer(`${label} Enter on Cancel`, 'resolved:false');
      // No message: the body is not drawn, and the dialog has no description.
      await ask({ title: 'Turn this off?' });
      ok(await ev("(() => { const d = document.querySelector('dialog.sdk-dialog-confirm'); return !d.hasAttribute('aria-describedby') && getComputedStyle(d.querySelector('.sdk-dialog-body')).display === 'none'; })()"), `${label}: a confirm with no message still draws an empty body`);
      await key('Escape');
      await afterAnswer(`${label} no message`, 'resolved:false');

      // A final confirm with a typed name: the action stays off until it matches.
      await ask({ title: 'Delete Paris trip for good?', message: 'It cannot be brought back.', action: 'Delete for good', kind: 'final', typed: 'Paris trip' });
      st = await state();
      ok(st.active === 'input', `${label}: a typed final confirm should focus the name field (${st.active})`);
      ok(/solid/.test(await ev("document.querySelector('[data-ok]').className")), `${label}: a final confirm's action should be the solid Danger`);
      ok(await ev("document.querySelector('[data-ok]').disabled"), `${label}: the final action should start off`);
      await key('Enter');
      ok((await result()) === 'pending', `${label}: Enter in the name field answered before the name matched`);
      await s('Input.insertText', { text: 'Paris tri' });
      ok(await ev("document.querySelector('[data-ok]').disabled"), `${label}: the final action turned on before the name matched`);
      await s('Input.insertText', { text: 'p' });
      ok(!(await ev("document.querySelector('[data-ok]').disabled")), `${label}: the final action did not turn on when the name matched`);
      await key('Enter');
      await afterAnswer(`${label} typed final`, 'resolved:true');

      // Bad input rejects; a "no" never does.
      await ask({ message: 'no title' });
      ok((await result()).startsWith('rejected:'), `${label}: a confirm with no title should reject`);
      ok((await state()).count === 0, `${label}: a rejected confirm left a dialog`);
      await ask({ title: 'x', kind: 'sideways' });
      ok((await result()).startsWith('rejected:'), `${label}: an unknown kind should reject`);
    }
  } catch (err) {
    fail(`browser part: ${err.message}`);
  } finally {
    try { ws.close(); } catch (e) { /* closing */ }
    child.kill();
    server.close();
    await new Promise((r) => setTimeout(r, 300)); try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); } catch (e) { /* the browser is still closing */ }
  }
}
fs.rmSync(tmp, { recursive: true, force: true });

if (failures.length) {
  console.error(`check-confirm: ${failures.length} problem(s):\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`check-confirm: ${passed} checks passed${note}.`);
