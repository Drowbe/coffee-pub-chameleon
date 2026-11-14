#!/usr/bin/env node
/*
 * check-prompt.mjs -- the styled prompt (host.ui.prompt), the one-line question dialog beside the confirm.
 *
 * Fails when:
 *   1. Static. public/prompt.js uses innerHTML, outerHTML, insertAdjacentHTML, document.write or eval (every string a module sends is
 *      text: textContent, .value, .placeholder only; the close icon is built with createElement); the SDK has no host.ui.prompt that asks 'ui.prompt', refuses a missing title and runs validate in the
 *      module; the frame's call times out a prompt after 30s; module-host.js has no 'ui.prompt' handler that uses promptDialog(cleanPrompt(o)).
 *   2. The rules, in Node. cleanPrompt refuses a missing title (400), caps every string, defaults maxLength to 200 and caps it at 2000.
 *   3. In Chromium (skipped, said so, when there is none), with real keys: Enter returns the typed text; Escape, Cancel, the close button
 *      and the backdrop return null; the dialog is the confirm's (same classes, 360px at 1280), named by its title; the input has focus;
 *      Tab stays inside; focus goes back to the opener; a second prompt while one is open resolves null; hostile strings (an <img onerror>,
 *      a 100,000-character title) are drawn as text, capped, and run nothing; maxLength stops the typing; the SDK's validate error is shown
 *      under the field and the question is asked again with what was typed; nothing is left in the page after any answer.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startBrowser, stopBrowser } from './browser-launch.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const failures = [];
let passed = 0;
const fail = (m) => failures.push(m);
const ok = (cond, m) => { if (cond) passed += 1; else fail(m); };

// ---- 1. static ----
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
{
  const code = stripComments(read('public/prompt.js'));
  ok(!/\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval)\b|new Function|createContextualFragment|DOMParser/.test(code), 'public/prompt.js: builds HTML or runs code from a string; a module\'s strings must only be text');
  ok(/textContent/.test(code) && /input\.value = o\.value/.test(code), 'public/prompt.js: the text is not set with textContent / .value');
  const sdk = read('public/sdk/host.js');
  ok(/prompt: async \(o\) => \{[\s\S]{0,1800}call\('ui\.prompt'/.test(sdk), 'public/sdk/host.js: host.ui.prompt does not ask the page (call "ui.prompt")');
  ok(/prompt: async \(o\) => \{[\s\S]{0,400}typeof t\.title !== 'string'/.test(sdk), 'public/sdk/host.js: host.ui.prompt does not refuse a missing title');
  const askLine = /call\('ui\.prompt', \{[^\n]*\}\);/.exec(sdk);
  ok(Boolean(askLine) && !/validate/.test(askLine[0]), 'public/sdk/host.js: validate is sent across the bridge');
  ok(/method === 'ui\.prompt'[^\n]*\) return;[\s\S]{0,80}setTimeout/.test(sdk), 'public/sdk/host.js: a frame\'s prompt times out after 30s (it should wait for the person)');
  const mh = read('public/module-host.js');
  ok(/import \{ promptDialog, cleanPrompt \} from '\/prompt\.js'/.test(mh) && /'ui\.prompt'\(o\)\s*\{\s*return promptDialog\(cleanPrompt\(o\)\)/.test(mh), 'public/module-host.js: no "ui.prompt" handler that asks with promptDialog(cleanPrompt(o))');
}

// ---- 2. the rules, in Node ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-prompt-'));
fs.copyFileSync(path.join(ROOT, 'public/prompt.js'), path.join(tmp, 'prompt.mjs'));
const { cleanPrompt, promptDialog } = await import(pathToFileURL(path.join(tmp, 'prompt.mjs')).href);
const throws = (fn) => { try { fn(); } catch (e) { return e.status === 400; } return false; };
ok(throws(() => cleanPrompt({})) && throws(() => cleanPrompt({ title: '  ' })) && throws(() => cleanPrompt(null)), 'cleanPrompt: a missing title is not refused (400)');
{
  const c = cleanPrompt({ title: 'T'.repeat(9999), label: 'L'.repeat(9999), placeholder: 'P'.repeat(9999), action: 'A'.repeat(999), value: 'v'.repeat(9999), error: 'E'.repeat(999), html: '<b>' });
  ok(c.title.length === 200 && c.label.length === 200 && c.placeholder.length === 200 && c.action.length === 40 && c.error.length === 200, 'cleanPrompt: a string is not capped');
  ok(c.maxLength === 200 && c.value.length === 200, 'cleanPrompt: maxLength should default to 200 and cut the value to it');
  ok(cleanPrompt({ title: 'x', maxLength: 99999 }).maxLength === 2000 && cleanPrompt({ title: 'x', maxLength: 0 }).maxLength === 1 && cleanPrompt({ title: 'x', maxLength: 'a' }).maxLength === 200, 'cleanPrompt: maxLength is not held to 1..2000');
  ok(cleanPrompt({ title: 'x', value: 5, label: {} }).value === '' && cleanPrompt({ title: 'x', label: {} }).label === '' && !('html' in c), 'cleanPrompt: a non-string is not dropped');
  ok(cleanPrompt({ title: 'x' }).action === 'OK', 'cleanPrompt: the action should default to OK');
}
for (const bad of [undefined, {}, { title: '' }]) {
  let outcome = 'resolved';
  await promptDialog(bad, {}).then(() => {}, (e) => { outcome = e && e.status === 400 ? 'rejected' : 'rejected-other'; });
  ok(outcome === 'rejected', `promptDialog(${JSON.stringify(bad)}) should reject with a 400; it ${outcome}`);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-prompt-chrome-'));
  const child = startBrowser(bin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'], dir);
  const url = await new Promise((resolve, reject) => {
    let buf = ''; const t = setTimeout(() => reject(new Error('the browser did not start: ' + buf.slice(-300))), 20000);
    child.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); resolve(m[1]); } });
    child.on('exit', (c) => { clearTimeout(t); reject(new Error('the browser exited (' + c + ')')); });
  }).catch(async (e) => { await stopBrowser(child, dir); throw e; }); // a browser that did not start is not left running
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
      const b = { key: k, code: k, windowsVirtualKeyCode: code, modifiers: mods };
      await s('Input.dispatchKeyEvent', k === 'Enter' ? { type: 'keyDown', ...b, text: '\r' } : { type: 'rawKeyDown', ...b });
      await s('Input.dispatchKeyEvent', { type: 'keyUp', ...b });
    };
    const click = async (x, y) => { await s('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); };
    const state = () => ev(`(() => { const a = document.activeElement; return JSON.stringify({ open: Boolean(document.querySelector('dialog.sdk-dialog-prompt')?.open), active: a ? (a.dataset.ok !== undefined ? 'action' : a.dataset.close !== undefined ? (a.classList.contains('sdk-dialog-close') ? 'close' : 'cancel') : a.tagName === 'INPUT' ? 'input' : a.id || a.tagName) : null, overflow: document.documentElement.style.overflow, count: document.querySelectorAll('dialog').length }); })()`).then(JSON.parse);
    const ask = async (opts) => {
      await ev(`(() => { window.__r = 'pending'; const o = document.getElementById('opener'); o.focus(); window.__p = window.__pd(${JSON.stringify(opts)}).then((v) => { window.__r = 'resolved:' + JSON.stringify(v); }, (e) => { window.__r = 'rejected:' + e.message; }); return true; })()`);
      await wait(120);
    };
    const result = async () => { await wait(60); return ev('window.__r'); };
    const afterAnswer = async (what, want) => {
      const r = await result();
      ok(r === want, `${what}: the promise was ${r}, wanted ${want}`);
      const st = await state();
      ok(st.count === 0, `${what}: a dialog is left in the page`);
      ok(st.overflow === '', `${what}: the page's scroll lock was not cleared`);
      ok(st.active === 'opener', `${what}: focus did not go back to the opener (it is on ${st.active})`);
    };
    await s('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await s('Page.navigate', { url: `${base}/t.html` });
    for (let i = 0; i < 100 && !(await ev("document.readyState === 'complete'").catch(() => false)); i += 1) await wait(100);
    await ev(`import('/prompt.js').then((m) => { window.__pd = m.promptDialog; window.__x = 0; return true; })`);
    await ev('document.fonts.ready.then(() => true)');

    await ask({ title: 'Rename the map', label: 'Name', value: 'Old name', action: 'Rename', placeholder: 'A name' });
    let st = await state();
    ok(st.open && st.active === 'input', `the prompt did not open with the field focused (${JSON.stringify(st)})`);
    const shape = JSON.parse(await ev(`(() => { const d = document.querySelector('dialog.sdk-dialog-prompt'); const i = d.querySelector('input'); const r = d.getBoundingClientRect(); return JSON.stringify({ cls: d.className, role: d.getAttribute('role'), name: document.getElementById(d.getAttribute('aria-labelledby')).textContent, w: Math.round(r.width), value: i.value, sel: i.selectionEnd - i.selectionStart, ph: i.placeholder, ml: i.maxLength, ok: d.querySelector('[data-ok]').textContent, okCls: d.querySelector('[data-ok]').className, label: d.querySelector('.sdk-label').textContent, order: [...d.querySelectorAll('button')].map((b) => b.textContent.trim() || b.getAttribute('aria-label')).join('|') }); })()`));
    ok(/sdk-dialog-confirm/.test(shape.cls) && shape.role === 'alertdialog' && shape.name === 'Rename the map', 'the prompt is not the confirm\'s dialog named by its title');
    ok(shape.w === 360, `the prompt is ${shape.w}px wide, wanted 360`);
    ok(shape.value === 'Old name' && shape.sel === 8 && shape.ph === 'A name' && shape.ml === 200 && shape.ok === 'Rename' && /btn-primary/.test(shape.okCls) && shape.label === 'Name' && shape.order === 'Close|Cancel|Rename', `the prompt's parts are off (${JSON.stringify(shape)})`);
    await key('Tab'); st = await state(); ok(st.active === 'cancel', `Tab from the field should reach Cancel (${st.active})`);
    await key('Tab'); st = await state(); ok(st.active === 'action', `Tab should reach the action (${st.active})`);
    await key('Tab'); st = await state(); ok(st.active === 'close', `Tab from the last control should wrap to Close (${st.active})`);
    await key('Tab', 8); st = await state(); ok(st.active === 'action', `Shift+Tab from the first control should wrap to the last (${st.active})`);
    await ev("document.querySelector('dialog.sdk-dialog-prompt input').focus()");
    // A second call while one is open: null at once, the first stays.
    ok((await ev("window.__pd({ title: 'Second' }).then((v) => String(v))")) === 'null', 'a second prompt while one is open should resolve null');
    ok((await state()).count === 1 && (await result()) === 'pending', 'the second prompt disturbed the first');
    await s('Input.insertText', { text: 'New name' });
    await key('Enter');
    await afterAnswer('Enter', 'resolved:"New name"');

    // The start value is selected, so typing replaces it; Enter with nothing typed returns the start value.
    await ask({ title: 'Rename', value: 'Same' });
    await key('Enter');
    await afterAnswer('Enter, untouched', 'resolved:"Same"');
    await ask({ title: 'Rename', value: 'Same' });
    await ev("document.querySelector('[data-ok]').click()");
    await afterAnswer('the action', 'resolved:"Same"');
    // An empty answer is "" (not null).
    await ask({ title: 'Rename' });
    await key('Enter');
    await afterAnswer('Enter, empty', 'resolved:""');
    // null: Escape, Cancel, Close, the backdrop.
    await ask({ title: 'Rename', value: 'x' }); await key('Escape'); await afterAnswer('Escape', 'resolved:null');
    await ask({ title: 'Rename', value: 'x' }); await ev("document.querySelector('.sdk-dialog-foot [data-close]').click()"); await afterAnswer('Cancel', 'resolved:null');
    await ask({ title: 'Rename', value: 'x' }); await ev("document.querySelector('.sdk-dialog-close').click()"); await afterAnswer('Close', 'resolved:null');
    await ask({ title: 'Rename', value: 'x' }); await click(2, 2); await afterAnswer('the backdrop', 'resolved:null');
    // maxLength stops the typing; a huge maxLength is held at 2000.
    await ask({ title: 'Short', maxLength: 5 });
    await s('Input.insertText', { text: 'abcdefghij' });
    await key('Enter');
    await afterAnswer('maxLength', 'resolved:"abcde"');
    await ask({ title: 'Long', maxLength: 99999 });
    ok((await ev("document.querySelector('dialog.sdk-dialog-prompt input').maxLength")) === 2000, 'maxLength is not held at 2000');
    await key('Escape'); await afterAnswer('Escape (long)', 'resolved:null');
    // The error line.
    await ask({ title: 'Rename', value: 'bad', error: 'That name is taken.' });
    ok(await ev("(() => { const d = document.querySelector('dialog.sdk-dialog-prompt'); const e = d.querySelector('.sdk-error'); return e.textContent === 'That name is taken.' && getComputedStyle(e).display !== 'none' && d.querySelector('input').getAttribute('aria-invalid') === 'true'; })()"), 'the error is not shown under the field');
    await key('Escape'); await afterAnswer('Escape (error)', 'resolved:null');
    // Hostile strings: text only, capped, nothing runs.
    const evil = '<img src=x onerror="window.__x=1"><script>window.__x=2<\/script>';
    await ask({ title: evil + 'T'.repeat(100000), label: evil, value: evil, placeholder: evil, action: evil, error: evil });
    const hostile = JSON.parse(await ev(`(() => { const d = document.querySelector('dialog.sdk-dialog-prompt'); return JSON.stringify({ imgs: d.querySelectorAll('img, script').length, title: d.querySelector('.sdk-dialog-title').textContent.length, titleText: d.querySelector('.sdk-dialog-title').textContent.startsWith('<img'), val: d.querySelector('input').value.length, ph: d.querySelector('input').placeholder.length, act: d.querySelector('[data-ok]').textContent.length, x: window.__x, h: Math.round(d.getBoundingClientRect().height), wide: d.scrollWidth > d.clientWidth }); })()`));
    ok(hostile.imgs === 0 && hostile.titleText && hostile.x === 0, `a hostile string was drawn as HTML (${JSON.stringify(hostile)})`);
    ok(hostile.title === 200 && hostile.act === 40 && hostile.ph === evil.length && hostile.val === evil.length, `a hostile string was not capped (${JSON.stringify(hostile)})`);
    ok(hostile.h < 700 && !hostile.wide, `the dialog grew to ${hostile.h}px (or sideways) with long strings`);
    await key('Escape'); await afterAnswer('Escape (hostile)', 'resolved:null');
    // Bad input rejects.
    await ask({ message: 'no title' });
    ok((await result()).startsWith('rejected:') && (await state()).count === 0, 'a prompt with no title should reject and leave nothing');

    // The SDK's host.ui.prompt with validate: the module runs it, and the page is asked again with the message and what was typed.
    const sdkSrc = read('public/sdk/host.js');
    const m = /prompt: async \(o\) => \{[\s\S]*?\n      \},\n/.exec(sdkSrc);
    ok(Boolean(m), 'cannot find host.ui.prompt in the SDK to run');
    if (m) {
      const out = await ev(`(async () => {
        const seen = [];
        const call = (method, p) => { seen.push(JSON.stringify(p)); return window.__pd(p); };
        const ui = { ${m[0].replace(/,\n$/, '')} };
        const first = ui.prompt({ title: 'Name', value: 'ab', validate: (a) => (a.length < 3 ? 'Too short.' : '') });
        await new Promise((r) => setTimeout(r, 150));
        const d1 = document.querySelector('dialog.sdk-dialog-prompt');
        const e1 = d1.querySelector('.sdk-error').textContent;
        d1.querySelector('input').focus();
        d1.querySelector('[data-ok]').click();
        await new Promise((r) => setTimeout(r, 150));
        const d2 = document.querySelector('dialog.sdk-dialog-prompt');
        const e2 = d2 && d2.querySelector('.sdk-error').textContent;
        const v2 = d2 && d2.querySelector('input').value;
        if (d2) { d2.querySelector('input').value = 'abc'; d2.querySelector('[data-ok]').click(); }
        const answer = await first;
        const second = ui.prompt({ title: 'Name', validate: () => 'never' });
        await new Promise((r) => setTimeout(r, 150));
        document.querySelector('dialog.sdk-dialog-prompt .sdk-dialog-close').click();
        return JSON.stringify({ e1, e2, v2, answer, cancelled: await second, sentValidate: seen.some((x) => x.includes('validate')), noTitle: await ui.prompt({}).then(() => 'resolved', (e) => e.status) });
      })()`).then(JSON.parse);
      ok(out.e1 === '' && out.e2 === 'Too short.' && out.v2 === 'ab' && out.answer === 'abc' && out.cancelled === null && !out.sentValidate && out.noTitle === 400, `host.ui.prompt with validate misbehaved (${JSON.stringify(out)})`);
    }
  } catch (err) {
    fail(`browser part: ${err.message}`);
  } finally {
    try { ws.close(); } catch (e) { /* closing */ }
    server.close();
    await stopBrowser(child, dir);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });

if (failures.length) {
  console.error(`check-prompt: ${failures.length} problem(s):\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`check-prompt: ${passed} checks passed${note}.`);
