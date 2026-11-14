#!/usr/bin/env node
/**
 * check-pdf-viewer.mjs -- the app's own PDF viewer in a real browser (documentation/plans/plan-attachments-vault.md,
 * decision 18, section 10, step 3; server/pdf-viewer.js, public/sdk/pdf-viewer.mjs).
 *
 * A throwaway server; a page of the app frames GET /viewer/pdf in <iframe sandbox="allow-scripts"> and hands it a PDF's
 * bytes by postMessage, as the viewer window will. Checked in headless Chromium:
 *   - the frame says ready, opens a real PDF (tools/fixtures/vault/link.pdf, made by LibreOffice) with its page count,
 *     and answers page, zoom, fit and search with its state;
 *   - a web link in the PDF reaches the page as a 'link' message, and nothing is opened by the frame itself;
 *   - a PDF with a script in it opens and its script does not run; a damaged one answers 'error' with its sentence;
 *   - inside the frame: its origin is "null", it can't read cookies or storage, can't reach the page that frames it,
 *     can't fetch anything (connect-src 'none'), and pdf.js parses there without starting a worker;
 *   - a message from anything but the page that frames it is ignored.
 * What can't be checked here: Safari and Firefox, a phone, full screen (the window's), and how it looks.
 * With no Chromium (CHROME_PATH) the browser part is skipped and says so; that is not a pass.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startBrowser, stopBrowser } from './browser-launch.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const ok = (cond, msg) => { if (cond) console.log(`  ok   ${msg}`); else { failures += 1; console.log(`  FAIL ${msg}`); } };

function findBrowser() {
  const cands = [process.env.CHROME_PATH];
  const pw = path.join(os.homedir(), '.cache', 'ms-playwright');
  for (const root of [pw, '/opt/pw-browsers']) {
    if (!fs.existsSync(root)) continue;
    for (const d of fs.readdirSync(root).sort().reverse()) cands.push(path.join(root, d, 'chrome-linux64', 'chrome'), path.join(root, d, 'chrome-linux', 'chrome'));
  }
  cands.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  return cands.find((c) => c && fs.existsSync(c)) || null;
}

async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-pdf-viewer-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, ADMIN_PASSWORD: 'testpass1234', TRUST_PROXY_HOPS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 25000);
    const look = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', look);
    child.stderr.on('data', look);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  return { port, dataDir, stop: () => new Promise((r) => { if (child.exitCode !== null) return r(); child.once('exit', r); child.kill('SIGTERM'); }) };
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result); return; }
      for (const fn of this.listeners) fn(m);
    });
  }
  send(method, params = {}, sessionId) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params, sessionId })); return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
}
async function launch(bin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-pdf-viewer-chrome-'));
  const child = startBrowser(bin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'], dir);
  const url = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error(`the browser did not start: ${buf.slice(-300)}`)), 20000);
    child.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); resolve(m[1]); } });
    child.on('exit', (c) => { clearTimeout(t); reject(new Error(`the browser exited (${c})`)); });
  }).catch(async (e) => { await stopBrowser(child, dir); throw e; }); // a browser that did not start is not left running
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('cannot reach the browser'))); });
  return { cdp: new Cdp(ws), child, dir, ws };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A PDF of one page for each text, in a standard font, and optionally an action on opening; its xref table written right.
function pdfWithText(texts, openAction = '') {
  const list = [].concat(texts);
  const objs = [
    `<< /Type /Catalog /Pages 2 0 R ${openAction} >>`,
    `<< /Type /Pages /Kids [${list.map((_, k) => `${4 + 2 * k} 0 R`).join(' ')}] /Count ${list.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  list.forEach((text, k) => {
    const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${5 + 2 * k} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.7\n';
  const at = [];
  objs.forEach((o, k) => { at.push(out.length); out += `${k + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const bin = findBrowser();
let note = '';
if (!bin) note = ' (browser part SKIPPED: no Chromium found; set CHROME_PATH. This is not a pass)';
else {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.port}`;
  const { cdp, child, dir, ws } = await launch(bin);
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => cdp.send(m, p, sessionId);
    // The frame may run in its own process (a sandboxed frame is isolated): its session, or its context in the page's.
    let frameSession = null;
    const contexts = [];
    const consoleLines = [];
    cdp.listeners.push((m) => {
      if (m.method === 'Target.attachedToTarget' && m.params.targetInfo.type === 'iframe') {
        frameSession = m.params.sessionId;
        cdp.send('Runtime.enable', {}, frameSession).catch(() => {});
        cdp.send('Runtime.runIfWaitingForDebugger', {}, frameSession).catch(() => {});
      }
      if (m.method === 'Runtime.executionContextCreated') contexts.push({ session: m.sessionId, ...m.params.context });
      if (m.method === 'Runtime.consoleAPICalled') consoleLines.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    });
    await s('Page.enable');
    await s('Runtime.enable');
    await s('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    const ev = async (expression, where = {}) => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...(where.contextId ? { contextId: where.contextId } : {}) }, where.session || sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    await s('Emulation.setDeviceMetricsOverride', { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
    await s('Page.navigate', { url: `${base}/login` });
    for (let i = 0; i < 100 && !(await ev("document.readyState === 'complete'").catch(() => false)); i += 1) await wait(100);

    // The page frames the viewer, as the viewer window will, and keeps what it says.
    await ev(`(() => {
      window.__msgs = [];
      const f = document.createElement('iframe');
      f.id = 'pv'; f.setAttribute('sandbox', 'allow-scripts'); f.title = 'PDF'; f.style.cssText = 'width:600px;height:500px;border:0';
      window.addEventListener('message', (e) => { if (e.source === f.contentWindow) window.__msgs.push({ origin: e.origin, data: e.data }); });
      f.src = '/viewer/pdf';
      document.body.append(f);
      window.__send = (m, t) => f.contentWindow.postMessage(m, '*', t || []);
      window.__open = (b64, extra) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); window.__send({ type: 'open', data: bytes.buffer, ...(extra || {}) }, [bytes.buffer]); };
      return true;
    })()`);
    const msgs = () => ev('JSON.stringify(window.__msgs)').then(JSON.parse);
    const until = async (fn, ms = 10000) => { const t0 = Date.now(); for (;;) { const all = await msgs(); const hit = fn(all); if (hit) return hit; if (Date.now() - t0 > ms) return null; await wait(100); } };
    const last = (all, type) => [...all].reverse().find((m) => m.data && m.data.type === type);

    const ready = await until((all) => last(all, 'ready'));
    ok(ready && ready.origin === 'null', `the frame says ready, from a null origin: ${JSON.stringify(ready)}`);

    // Inside the frame.
    let where = null;
    for (let i = 0; i < 50 && !where; i += 1) {
      if (frameSession) where = { session: frameSession };
      else {
        const tree = await s('Page.getFrameTree');
        const childFrame = (tree.frameTree.childFrames || [])[0]?.frame;
        const c = childFrame && contexts.find((x) => x.auxData && x.auxData.frameId === childFrame.id && x.auxData.isDefault);
        if (c) where = { contextId: c.id };
      }
      if (!where) await wait(100);
    }
    ok(Boolean(where), 'the frame\'s own context is found');
    if (where) {
      const inside = await ev(`(async () => {
        const out = { origin: self.origin, href: location.pathname };
        try { out.cookie = document.cookie; } catch (e) { out.cookie = 'refused:' + e.name; }
        try { out.storage = typeof localStorage.length; } catch (e) { out.storage = 'refused:' + e.name; }
        try { out.parent = typeof window.parent.document; } catch (e) { out.parent = 'refused:' + e.name; }
        try { await fetch('/api/me'); out.fetch = 'fetched'; } catch (e) { out.fetch = 'refused:' + e.name; }
        try { await fetch('https://example.com/'); out.away = 'fetched'; } catch (e) { out.away = 'refused:' + e.name; }
        out.worker = await new Promise((resolve) => {
          try {
            const w = new Worker(URL.createObjectURL(new Blob(['postMessage(1)'], { type: 'text/javascript' })));
            w.onmessage = () => resolve('ran');
            w.onerror = () => resolve('refused:error');
            setTimeout(() => resolve('refused:it never ran'), 1500);
          } catch (e) { resolve('refused:' + e.name); }
        });
        out.pdfjsWorker = typeof globalThis.pdfjsWorker;
        return out;
      })()`, where);
      ok(inside.origin === 'null', `the frame's origin is null: ${inside.origin}`);
      ok(String(inside.cookie).startsWith('refused'), `it can't read cookies: ${inside.cookie}`);
      ok(String(inside.storage).startsWith('refused'), `nor storage: ${inside.storage}`);
      ok(String(inside.parent).startsWith('refused'), `nor reach the page that frames it: ${inside.parent}`);
      ok(String(inside.fetch).startsWith('refused') && String(inside.away).startsWith('refused'), `nor fetch anything, here or away: ${inside.fetch}, ${inside.away}`);
      ok(inside.pdfjsWorker === 'object', 'pdf.js parses on the frame\'s own thread (its worker module is loaded in the frame)');
      ok(String(inside.worker).startsWith('refused'), `and no worker can be started: ${inside.worker}`);
    }

    // A real PDF, made by LibreOffice: opened, with its state.
    const linkPdf = fs.readFileSync(path.join(ROOT, 'tools', 'fixtures', 'vault', 'link.pdf')).toString('base64');
    await ev(`window.__open(${JSON.stringify(linkPdf)})`);
    const opened = await until((all) => last(all, 'opened') || last(all, 'error'));
    ok(opened && opened.data.type === 'opened' && opened.data.pages === 1, `the PDF opens: ${JSON.stringify(opened && opened.data)}`);
    // The state a message leaves, once what it set off (drawing, scrolling, a resize) has settled.
    const settled = async () => { await until((all) => last(all, 'state')); await wait(400); const r = last(await msgs(), 'state'); return r && r.data; };
    const after = async (message) => { await ev(`window.__msgs = []; window.__send(${JSON.stringify(message)})`); return settled(); };
    await wait(400);
    const st = last(await msgs(), 'state');
    ok(st && st.data.page === 1 && st.data.pages === 1 && st.data.fit === 'width' && st.data.scale > 0.5, `and says its state, fitted to the width: ${JSON.stringify(st && st.data)}`);
    const zoomed = await after({ type: 'zoom', step: 1 });
    ok(zoomed && zoomed.fit === null && zoomed.scale > st.data.scale, `zoom in: ${JSON.stringify(zoomed)}`);
    const fitted = await after({ type: 'fit', mode: 'page' });
    ok(fitted && fitted.fit === 'page' && fitted.scale < st.data.scale, `fit the whole page: ${JSON.stringify(fitted)}`);
    const exact = await after({ type: 'zoom', scale: 1.5 });
    ok(exact && exact.scale === 1.5 && exact.fit === null, `zoom to 150%: ${JSON.stringify(exact)}`);
    // Drawn: the page's canvas holds a picture, and its two links are there.
    if (where) {
      let drawn = null;
      for (let i = 0; i < 50 && !(drawn && drawn.links === 2 && drawn.width > 800); i += 1) {
        drawn = await ev("(() => { const c = document.querySelector('.pv-page canvas'); return { width: c ? c.width : 0, links: document.querySelectorAll('.pv-link').length }; })()", where);
        await wait(100);
      }
      ok(drawn && drawn.width > 800 && drawn.links === 2, `the page is drawn at that zoom, with its web and email links: ${JSON.stringify(drawn)}`);
      await ev("window.__msgs = []; document.querySelector('.pv-link').click(); true", where);
      const link = await until((all) => last(all, 'link'), 3000);
      ok(link && link.data.url === 'https://example.com/', `a web link reaches the page, which opens it: ${JSON.stringify(link && link.data)}`);
    }
    await ev("window.__msgs = []; window.__send({ type: 'search', query: 'WEB' })");
    const found = await until((all) => last(all, 'search'));
    ok(found && found.data.total >= 1 && found.data.index === 1 && found.data.page === 1, `search finds the text, case ignored: ${JSON.stringify(found && found.data)}`);
    await ev("window.__msgs = []; window.__send({ type: 'search', query: 'not in it at all' })");
    const none = await until((all) => last(all, 'search'));
    ok(none && none.data.total === 0 && none.data.index === 0, `and says when nothing matches: ${JSON.stringify(none && none.data)}`);

    // Several pages: page, next, previous, and a search that walks its matches.
    const three = pdfWithText(['First page', 'Second page Rome', 'Third page Rome']).toString('base64');
    await ev(`window.__msgs = []; window.__open(${JSON.stringify(three)}, { page: 2 })`);
    const o3 = await until((all) => last(all, 'opened') || last(all, 'error'));
    ok(o3 && o3.data.pages === 3, `a PDF of three pages opens: ${JSON.stringify(o3 && o3.data)}`);
    const at2 = await settled();
    ok(at2 && at2.page === 2, `at the page asked for: ${JSON.stringify(at2)}`);
    const step = async (m) => { const r = await after(m); return r && r.page; };
    ok((await step({ type: 'next' })) === 3, 'next: page 3');
    ok((await step({ type: 'next' })) === 3, 'next on the last page stays there');
    ok((await step({ type: 'page', page: 1 })) === 1, 'page 1');
    ok((await step({ type: 'previous' })) === 1, 'previous on the first page stays there');
    await ev("window.__msgs = []; window.__send({ type: 'search', query: 'rome' })");
    const r1 = await until((all) => last(all, 'search'));
    await ev("window.__msgs = []; window.__send({ type: 'search', query: 'rome' })");
    const r2 = await until((all) => last(all, 'search'));
    await ev("window.__msgs = []; window.__send({ type: 'search', query: 'rome', back: true })");
    const r3 = await until((all) => last(all, 'search'));
    ok(r1 && r2 && r3 && [r1.data.total, r1.data.page, r2.data.index, r2.data.page, r3.data.page].join() === '2,2,2,3,2', `a search walks its matches, and back: ${JSON.stringify([r1?.data, r2?.data, r3?.data])}`);

    // A PDF with a script on opening: it opens, and the script does not run (it would have set the title).
    const scripted = pdfWithText('Hello', '/OpenAction << /S /JavaScript /JS (this.title = "ran"; app.alert\\(1\\);) >>').toString('base64');
    await ev(`window.__msgs = []; window.__open(${JSON.stringify(scripted)})`);
    const so = await until((all) => last(all, 'opened') || last(all, 'error'));
    ok(so && so.data.type === 'opened', `a PDF with a script in it opens: ${JSON.stringify(so && so.data)}`);
    if (where) ok((await ev('document.title', where)) === 'PDF', 'and its script does not run');

    // A damaged PDF, and a message from something other than the page.
    await ev(`window.__msgs = []; window.__open(${JSON.stringify(Buffer.from('%PDF-1.7\nnot a pdf at all').toString('base64'))})`);
    const bad = await until((all) => last(all, 'error') || last(all, 'opened'));
    ok(bad && bad.data.type === 'error' && bad.data.code === 'failed' && bad.data.message === 'This PDF could not be opened here. Download it.', `a damaged PDF answers its error: ${JSON.stringify(bad && bad.data)}`);
    if (where) {
      // From inside the frame itself (not its parent): ignored.
      await ev('window.__msgs = []');
      await ev(`window.postMessage({ type: 'open', data: new Uint8Array([37]).buffer }, '*'); true`, where);
      await wait(500);
      ok(!(await msgs()).some((m) => m.data && (m.data.type === 'error' || m.data.type === 'opened')), 'a message that is not from the page that frames it is ignored');
    }
    ok(!consoleLines.some((l) => /Content Security Policy|Refused to/i.test(l) && !/fetch|worker|connect/i.test(l)), `nothing the viewer itself needs is refused by its CSP${consoleLines.length ? `: ${consoleLines.slice(0, 3).join(' | ')}` : ''}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${err.stack || err.message}`);
  } finally {
    try { ws.close(); } catch { /* gone */ }
    await stopBrowser(child, dir);
    await server.stop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* the browser's last writes */ }
    fs.rmSync(server.dataDir, { recursive: true, force: true });
  }
}

if (failures) { console.error(`check-pdf-viewer: ${failures} failed${note}`); process.exit(1); }
console.log(`check-pdf-viewer: OK${note}`);
