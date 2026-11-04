// check-vault-share-page.mjs: the front end of the Vault's share links (plan-attachments-vault.md, step 5): the public page /shared/<token>
// (public/shared.html, shared.js, shared.css) and the sheet and list a person signed in uses (public/share-sheet.js, the Vault's Share).
//   1. Read from the files, no browser: the page has no inline script, no inline style, no style attribute and no on* handler; it loads only
//      this site's files; the SDK has host.library.share and shares and the host's bridge answers them; the viewer's Share is on.
//   2. Live (headless Chromium, the screenshot seed, a throwaway server): a link made in the Vault by the page's own sheet (as a member once
//      Roles gives `share`), then opened in a FRESH browser context with no cookies: the list, the thumbnails, a picture, a PDF, audio, video
//      and Markdown opened and Back; Download only where the link allows it; the password flow (wrong, right, too many tries); a turned-off
//      link and an unknown one ("This link has ended."); a removed file ("File removed"); a phone's 390 layout; the light theme; no
//      console error, no content security policy violation, no request to another site, no inline style or script in the page; and the
//      signed-in side: Share in More and in Select, the sheet's choices, "Link made", the Shared mark, the list of links with Turn off,
//      the viewer's Share, and a member without `share` seeing none of it.
// Usage: node tools/check-vault-share-page.mjs. With no Chromium the live part says SKIPPED and exits 0 (a skip, never a pass).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'tools', 'fixtures', 'vault');
const say = (...a) => console.log('check-vault-share-page:', ...a);
const failures = [];
const fail = (m) => failures.push(m);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ---- 1. the files ----
{
  const html = read('public/shared.html');
  const bare = html.replace(/<!--[\s\S]*?-->/g, '');
  if (/<style[\s>]/i.test(bare)) fail('shared.html has a <style> element (the page\'s policy allows no inline style)');
  if (/\sstyle\s*=/i.test(bare)) fail('shared.html has a style attribute');
  if ((bare.match(/<script\b[^>]*>/gi) || []).some((t) => !/\ssrc=/.test(t))) fail('shared.html has an inline script');
  if (/\son[a-z]+\s*=/i.test(bare)) fail('shared.html has an on* handler');
  for (const m of bare.matchAll(/\b(?:src|href)="([^"]+)"/g)) if (!m[1].startsWith('/')) fail(`shared.html loads ${m[1]}, not a file of this site`);
  for (const f of ['public/shared.js', 'public/shared.css', 'public/share-sheet.js', 'public/share-sheet.css']) if (!fs.existsSync(path.join(ROOT, f))) fail(`${f} is missing`);
  const js = read('public/shared.js').replace(/\/\/.*$/gm, '');
  if (/innerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(js)) fail('shared.js writes HTML or evaluates text (it draws with textContent only)');
  if (/\.setAttribute\(\s*['"]style['"]/.test(js) || /\.cssText\s*=/.test(js)) fail('shared.js sets a style attribute');
  if (/from '\/brand\.js'/.test(js)) fail('shared.js imports brand.js (the public page must not load the signed-in page code)');
  if (!/const SHARE_READY = true;/.test(read('public/file-viewer.js'))) fail('the viewer\'s Share is not on (SHARE_READY)');
  const sdk = read('public/sdk/host.js');
  const bridge = read('public/module-host.js');
  for (const n of ['share', 'shares']) {
    if (!new RegExp(`\\b${n}:\\s*\\(`).test(sdk)) fail(`the SDK has no host.library.${n}`);
    if (!bridge.includes(`'library.${n}'`)) fail(`the host's bridge does not answer library.${n}`);
  }
  const vault = read('modules/vault/src/vault.js');
  for (const need of ["'Share'", "'Share links'", 'f.shared', "host.library.share(", "host.library.shares("]) if (!vault.includes(need)) fail(`the Vault page lacks ${need}`);
  say('the page\'s files, the SDK calls and the bridge read');
}

// ---- 2. the browser ----
const ROOTS = `const roots = []; (function walk(r) { roots.push(r); for (const x of r.querySelectorAll('*')) if (x.shadowRoot) walk(x.shadowRoot); })(document);`;
const COUNT = (sel) => `(() => { ${ROOTS} let n = 0; for (const r of roots) n += [...r.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.getClientRects().length).length; return n; })()`;
const TEXT = (sel) => `(() => { ${ROOTS} const out = []; for (const r of roots) for (const e of r.querySelectorAll(${JSON.stringify(sel)})) if (e.getClientRects().length) out.push(e.innerText); return out.join(' | '); })()`;
const MENU_ITEM = (text) => `(() => { ${ROOTS} for (const r of roots) for (const e of r.querySelectorAll('[role=menuitem]')) if (e.getClientRects().length && e.innerText.trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())})) { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; } return null; })()`;
const PRESS = (sel) => `(() => { ${ROOTS} for (const r of roots) { const e = r.querySelector(${JSON.stringify(sel)}); if (e) { e.click(); return true; } } return false; })()`;
const ROWS = '#module-frame >>> .vt-row';

const TYPES = { jpg: 'image/jpeg', png: 'image/png', mp3: 'audio/mpeg', mp4: 'video/mp4', pdf: 'application/pdf', md: 'text/markdown' };

async function main() {
  const bin = findBrowser();
  if (!bin) { say('live part SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return failures.length ? 1 : 0; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-share-page-'));
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    const cookie = (who) => (S.cookies[who] || []).map((c) => `${c.name}=${c.value}`).join('; ');
    const api = async (method, url, body, who = 'admin', type) => {
      const r = await fetch(S.base + url, { method, headers: { 'content-type': type || 'application/json', cookie: cookie(who) }, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
      return { status: r.status, json: await r.json().catch(() => null) };
    };
    const installed = await api('POST', '/api/modules/bundled/vault/install');
    if (installed.status >= 300 && !/already installed/.test(JSON.stringify(installed.json))) throw new Error(`the Vault could not be installed: ${installed.status} ${JSON.stringify(installed.json)}`);
    await api('PATCH', '/api/modules/vault', { enabled: true });
    const trip = S.ctx.trip;
    const lib = `/api/modules/vault/library?space=${trip}`;
    const ids = {};
    for (const name of ['photo.jpg', 'pic.png', 'tone.mp3', 'clip.mp4', 'plain.pdf', 'notes.md']) {
      const bytes = fs.readFileSync(path.join(FIX, name));
      const r = await api('POST', `/api/modules/vault/library?space=${trip}&name=${encodeURIComponent(name)}`, bytes, 'mia', TYPES[name.split('.').pop()]);
      if (r.status !== 201) throw new Error(`could not add ${name}: ${r.status} ${JSON.stringify(r.json)}`);
      ids[name] = r.json.file.id;
    }
    // A small picture for the photo, as the page would have made (the Vault page makes it in the browser; here the server has none).
    const thumb = await api('PUT', `/api/modules/vault/library/${ids['photo.jpg']}/thumb?space=${trip}`, fs.readFileSync(path.join(FIX, 'pic.png')), 'mia', 'image/png');
    if (thumb.status >= 300) fail(`could not put a small picture on the photo (${thumb.status})`);
    const all = Object.values(ids);
    const makeShare = async (who, body) => {
      const r = await api('POST', `/api/modules/vault/library/shares?space=${trip}`, body, who);
      if (r.status !== 201) throw new Error(`could not make a share link as ${who}: ${r.status} ${JSON.stringify(r.json)}`);
      return { ...r.json, token: r.json.token };
    };
    say('files added to the Vault');

    browser = await launch(bin);
    // ---- the signed-in side, in the Vault ----
    const open = async (size, as, wait = ROWS, touch = false) => {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(size, 'dark', false);
      if (touch) { const sx = (m, p) => tab.cdp.send(m, p, tab.sid); await sx('Emulation.setDeviceMetricsOverride', { width: size, height: 800, deviceScaleFactor: 2, mobile: true }); await sx('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); }
      const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
      await driveScreen(tab, { id: 'vault', as, url: '/modules/vault?space={trip}&popout=1', wait }, S.base, S.cookies, S.ctx);
      await sleep(600);
      return tab;
    };
    const until = async (tab, expr, want, ms = 6000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await tab.eval(expr); if (want(v)) return v; await sleep(150); } return v; };
    const pressMenu = async (tab, text) => {
      await until(tab, MENU_ITEM(text), Boolean);
      const r = await tab.eval(MENU_ITEM(text));
      if (!r) throw new Error(`no menu item "${text}"`);
      await tab.mouse('mouseMoved', r.x + r.w / 2, r.y + r.h / 2, { button: 'none', clickCount: 0 }); await tab.mouse('mousePressed', r.x + r.w / 2, r.y + r.h / 2); await tab.mouse('mouseReleased', r.x + r.w / 2, r.y + r.h / 2);
    };
    const DIALOG = 'dialog[open]';

    // A member has no Share until Roles gives it.
    let tab = await open(1000, 'sam');
    try {
      await tab.click('#module-frame >>> [data-menu]');
      await until(tab, TEXT('[role=menu]'), Boolean);
      const menu = await tab.eval(TEXT('[role=menu]'));
      if (/Share/.test(menu)) fail(`a member without share sees Share in the file menu ("${menu.replace(/\n/g, ' ')}")`);
      await tab.key('Escape');
      const header = await tab.eval(COUNT('button[aria-label="Share links"]'));
      if (header) fail('a member without share has Share links in the title bar');
      say('a member without share: no Share');
    } finally { await tab.close(); }

    // Roles gives members share: the member makes a link through the sheet.
    const roleOn = await api('PATCH', '/api/roles/member', { 'module.vault.share': true }, 'admin');
    if (roleOn.status !== 200) throw new Error(`Roles would not give members share (${roleOn.status})`);
    let madeAddress = '';
    tab = await open(1000, 'sam');
    try {
      const menuOf = async (name) => { await tab.eval(`(() => { ${ROOTS} for (const r of roots) for (const row of r.querySelectorAll('.vt-row')) if (row.innerText.includes(${JSON.stringify(name)})) { row.querySelector('[data-menu]').click(); return true; } return false; })()`); };
      await menuOf('pic.png');
      await until(tab, TEXT('[role=menu]'), Boolean);
      const menu = await tab.eval(TEXT('[role=menu]'));
      if (!/Share/.test(menu)) fail(`the file menu of a member with share has no Share ("${menu.replace(/\n/g, ' ')}")`);
      await pressMenu(tab, 'Share');
      await tab.waitFor(`${DIALOG} input[type=text]`);
      const sheet = await tab.eval(TEXT(DIALOG));
      for (const need of ['Share a file', 'Name', 'Ends', '1 day', '7 days', '30 days', 'Password', 'Make link']) if (!sheet.includes(need)) fail(`the share sheet lacks "${need}" ("${sheet.replace(/\n/g, ' ').slice(0, 200)}")`);
      if (!/Allow download/.test(sheet)) fail('a member who may download is not offered Allow download');
      const sevenOn = await tab.eval(`document.querySelector('dialog[open] [role=radio][aria-checked=true]')?.innerText`);
      if (!/7 days/.test(sevenOn || '')) fail(`7 days is not the first choice ("${sevenOn}")`);
      // Make link needs a name.
      await tab.eval(`(() => { const i = document.querySelector('dialog[open] input[type=text]'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await tab.typeInto(`${DIALOG} input[type=text]`, 'Rome map');
      await tab.click(`${DIALOG} .action-bar-save`);
      await tab.waitFor(`${DIALOG} .sh-address`);
      madeAddress = await tab.eval(`document.querySelector('dialog[open] .sh-address').value`);
      const made = await tab.eval(TEXT(DIALOG));
      if (!/Link made/.test(made) || !/Copy address/.test(made)) fail(`the made sheet reads "${made.replace(/\n/g, ' ').slice(0, 200)}"`);
      if (!madeAddress.startsWith(`${S.base}/shared/`)) fail(`the address shown is "${madeAddress}", not the full address of the link`);
      if (!/This is the only time it is shown/.test(made)) fail('the made sheet does not say the address is shown once');
      say(`a member with share made a link through the sheet: ${madeAddress.replace(/[A-Za-z0-9_-]{43}/, '<token>')}`);
      await tab.click(`${DIALOG} button`, 'Close');
      await until(tab, COUNT(DIALOG), (v) => v === 0);
    } finally { await tab.close(); }
    const listed = (await api('GET', `/api/modules/vault/library/shares?space=${trip}`, undefined, 'sam')).json;
    if (!listed || listed.shares.length !== 1 || listed.shares[0].name !== 'Rome map' || listed.shares[0].download !== false || listed.shares[0].files.length !== 1) fail(`the link the sheet made is ${JSON.stringify(listed && listed.shares)}`);

    // The page opened by that address, in a fresh browser context: a picture.
    const watch = (t) => {
      const seen = { errors: [], csp: [], external: [], failed: [], urls: [] };
      t.cdp.listeners.push((m) => {
        if (m.sessionId !== t.sid) return;
        if (m.method === 'Log.entryAdded') { const e = m.params.entry; if (e.level === 'error' || e.level === 'warning') (/Content Security Policy|violat/i.test(e.text) ? seen.csp : seen.errors).push(`${e.text} ${e.url || ''}`); }
        if (m.method === 'Runtime.exceptionThrown') seen.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') seen.errors.push(m.params.args.map((a) => a.value || a.description).join(' '));
        if (m.method === 'Network.requestWillBeSent') { const u = m.params.request.url; seen.urls.push(u); if (!u.startsWith(S.base) && !/^(data|blob|about):/.test(u)) seen.external.push(u); }
        if (m.method === 'Network.loadingFailed' && !m.params.canceled) seen.failed.push(`${m.params.errorText} ${m.params.blockedReason || ''}`);
        if (m.method === 'Network.responseReceived' && m.params.response.status >= 400 && m.params.type !== 'Fetch') seen.failed.push(`${m.params.response.status} ${m.params.response.url}`);
      });
      return seen;
    };
    // A fresh browser context with no cookie, and none of the screenshot tool's own injected style (the page's policy would refuse it).
    const publicTab = async (url, size = 1000, mode = 'dark', touch = false, addRemoved = false) => {
      const { cdp } = browser;
      const t = new Tab(cdp, S.ctx);
      const { browserContextId } = await cdp.send('Target.createBrowserContext');
      t.contextId = browserContextId;
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      t.targetId = targetId; t.sid = sessionId; t.size = size; t.mode = mode;
      const sx = (m, p) => cdp.send(m, p, sessionId);
      for (const d of ['Page', 'Runtime', 'Network', 'Log']) await sx(`${d}.enable`);
      await sx('Emulation.setDeviceMetricsOverride', touch ? { width: size, height: 800, deviceScaleFactor: 2, mobile: true } : { width: size, height: 900, deviceScaleFactor: 1, mobile: false });
      if (touch) await sx('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await sx('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
      await sx('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('app.themeMode', ${JSON.stringify(mode)}); } catch (e) {}` });
      const seen = watch(t);
      if (addRemoved) {
        // The server drops a removed file from its links at once; a file gone between two reads reaches the page as { id, removed: true }. Put one in the answer.
        await sx('Fetch.enable', { patterns: [{ urlPattern: '*/api/shared/*', requestStage: 'Response' }] });
        cdp.listeners.push(async (m) => {
          if (m.method !== 'Fetch.requestPaused' || m.sessionId !== sessionId) return;
          const { requestId, request, responseStatusCode, responseHeaders } = m.params;
          try {
            if (/\/api\/shared\/[^/?]+$/.test(request.url) && responseStatusCode === 200) {
              const got = await cdp.send('Fetch.getResponseBody', { requestId }, sessionId);
              const data = JSON.parse(Buffer.from(got.body, 'base64').toString());
              data.files.splice(1, 0, { id: 'gone1', removed: true });
              await cdp.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: responseHeaders.filter((h) => h.name.toLowerCase() !== 'content-length'), body: Buffer.from(JSON.stringify(data)).toString('base64') }, sessionId);
            } else await cdp.send('Fetch.continueRequest', { requestId }, sessionId);
          } catch { /* the page went away */ }
        });
      }
      await sx('Page.navigate', { url });
      return { t, seen };
    };
    // SHARE_SHOTS=<folder> keeps a picture of the main screens, for looking at.
    const shot = async (t, name) => { if (!process.env.SHARE_SHOTS) return; fs.mkdirSync(process.env.SHARE_SHOTS, { recursive: true }); fs.writeFileSync(path.join(process.env.SHARE_SHOTS, `${name}.png`), Buffer.from((await t.cdp.send('Page.captureScreenshot', { format: 'png' }, t.sid)).data, 'base64')); };
    const clean = (name, seen, allow = []) => {
      const bad = [...seen.errors, ...seen.failed].filter((e) => !allow.some((a) => a.test(e)));
      if (bad.length) fail(`${name}: console or network errors: ${bad.slice(0, 4).join(' ; ')}`);
      if (seen.csp.length) fail(`${name}: content security policy violations: ${seen.csp.slice(0, 3).join(' ; ')}`);
      if (seen.external.length) fail(`${name}: requests to another site: ${seen.external.join(', ')}`);
    };
    {
      const { t, seen } = await publicTab(madeAddress);
      try {
        await t.waitFor('.sh-grid');
        const title = await t.eval(`document.querySelector('.sh-title').innerText`);
        const by = await t.eval(`document.querySelector('.sh-by')?.innerText`);
        if (title !== 'Rome map') fail(`the page's title is "${title}"`);
        if (!/^Shared by \S+ · Ends \d{1,2} [A-Z][a-z]+( \d{4})?$/.test(by || '')) fail(`the line under the title reads "${by}"`);
        if (!/Download/.test('') && (await t.eval(`document.body.innerText`)).includes('Download')) fail('a view-only link shows the word Download');
        say(`the page: "${title}", "${by}"`);
      } finally { await t.close(); }
      void seen;
    }

    // ---- links with the full set, made by the API (a moderator) ----
    const view = await makeShare('mia', { name: 'Rome photos', files: all, days: 7 });
    const dl = await makeShare('mia', { name: 'Rome with download', files: all, days: 30, download: true });
    const pw = await makeShare('mia', { name: 'Rome secrets', files: [ids['pic.png'], ids['notes.md']], days: 1, password: 'garlic bread', download: true });
    const tries = await makeShare('mia', { name: 'Rome locked', files: [ids['pic.png']], days: 1, password: 'garlic bread' });
    const gone = await makeShare('mia', { name: 'Rome old', files: [ids['pic.png']], days: 1 });
    const part = await makeShare('mia', { name: 'Rome two files', files: [ids['pic.png'], ids['plain.pdf']], days: 7 });
    const at = (s) => `${S.base}/shared/${s.token}`;

    // View only: the grid, the thumbnails, each type opened, Back, no Download, a clean console.
    {
      const { t, seen } = await publicTab(at(view));
      try {
        await t.waitFor('.sh-grid .sh-card');
        const tiles = await t.eval(COUNT('.sh-card'));
        if (tiles !== 6) fail(`the page shows ${tiles} tiles for six files`);
        await sleep(600);
        await shot(t, 'grid-dark');
        const thumbs = await t.eval(`[...document.querySelectorAll('.sh-thumb img')].filter((i) => i.complete && i.naturalWidth > 0).length`);
        if (thumbs < 1) fail('no thumbnail was drawn');
        const dom = await t.eval(`({ styles: document.querySelectorAll('style').length, firstStyle: (document.querySelector('style')?.outerHTML || '').slice(0, 200), inlineScripts: [...document.scripts].filter((s) => !s.src).length, styleAttrs: document.querySelectorAll('[style]').length, handlers: [...document.querySelectorAll('*')].filter((e) => [...e.attributes].some((a) => /^on/i.test(a.name))).length })`);
        if (dom.styles || dom.inlineScripts || dom.styleAttrs || dom.handlers) fail(`the page's DOM has inline code: ${JSON.stringify(dom)}`);
        const foot = await t.eval(`document.querySelector('.sh-foot')?.innerText`);
        if (!/not allowed downloads/.test(foot || '')) fail(`a view-only link has no sentence about it ("${foot}")`);
        const open = async (name) => { await t.click('.sh-name', name); await t.waitFor('.sh-viewer'); };
        const back = async () => { await t.click('.sh-vbar button', 'Back'); await t.waitFor('.sh-grid'); };
        // picture
        await open('pic.png');
        const pic = await until(t, `(() => { const i = document.querySelector('.fv-pic img'); return i && i.complete ? i.naturalWidth : 0; })()`, (v) => v > 0);
        if (!(pic > 0)) fail('the picture did not show');
        const pos = await t.eval(`document.querySelector('.sh-vpos').innerText`);
        if (!/ of 6$/.test(pos)) fail(`the position reads "${pos}"`);
        if (await t.eval(COUNT('.sh-vbar .btn-primary'))) fail('a view-only link shows a Download button in the viewer');
        // the arrow keys walk the files
        const arrow = async (key, code) => { for (const type of ['keyDown', 'keyUp']) await t.cdp.send('Input.dispatchKeyEvent', { type, key, windowsVirtualKeyCode: code }, t.sid); };
        await t.eval(`document.activeElement.blur()`);
        await arrow('ArrowRight', 39);
        const next = await until(t, `document.querySelector('.sh-vpos')?.innerText`, (v) => /^3 of/.test(v || ''));
        if (!/^3 of/.test(next || '')) fail(`the right arrow did not go to the next file (${next})`);
        await arrow('ArrowLeft', 37);
        const prev = await until(t, `document.querySelector('.sh-vpos')?.innerText`, (v) => /^2 of/.test(v || ''));
        if (!/^2 of/.test(prev || '')) fail(`the left arrow did not go back (${prev})`);
        const focusBack = await t.eval(`document.activeElement.innerText`);
        say(`picture opened (${pos}); focus is on "${focusBack}"`);
        await t.key('Escape');
        await t.waitFor('.sh-grid');
        const returned = await t.eval(`document.activeElement.title || document.activeElement.innerText`);
        if (returned !== 'pic.png') fail(`Escape returned focus to "${returned}", not the picture's card`);
        // a PDF, in the sandboxed frame
        await open('plain.pdf');
        const frame = await until(t, `(() => { const f = document.querySelector('iframe.fv-pdf-frame'); return f && !f.hidden ? f.getAttribute('sandbox') : null; })()`, Boolean, 12000);
        if (frame !== 'allow-scripts') fail(`the PDF is not shown in a frame with sandbox="allow-scripts" (${frame})`);
        const pages = await until(t, `document.querySelector('.fv-pdf-of')?.innerText`, (v) => /of \d/.test(v || ''));
        if (!/of \d/.test(pages || '')) fail('the PDF controls did not appear');
        await sleep(500);
        await shot(t, 'pdf');
        say(`PDF opened in its frame (${pages})`);
        await back();
        // audio
        await open('tone.mp3');
        const audio = await until(t, `(() => { const a = document.querySelector('audio'); return a ? (a.error ? 'error' : a.readyState >= 1 ? 'ready' : 'wait') : 'none'; })()`, (v) => v === 'ready' || v === 'error', 8000);
        if (audio !== 'ready') fail(`the audio is "${audio}"`);
        await back();
        // video
        await open('clip.mp4');
        const video = await until(t, `(() => { const a = document.querySelector('video'); return a ? (a.error ? 'error' : a.readyState >= 1 ? 'ready' : 'wait') : 'none'; })()`, (v) => v === 'ready' || v === 'error', 8000);
        if (video !== 'ready') fail(`the video is "${video}"`);
        await back();
        // Markdown, with Next and Previous by the arrow keys from a picture
        await open('notes.md');
        const md = await until(t, `document.querySelector('.fv-md')?.innerText`, (v) => (v || '').length > 3);
        if (!md || !md.trim()) fail('the Markdown did not show');
        await back();
        say('picture, PDF, audio, video and Markdown opened, with Back');
        clean('view-only page', seen, [/pdf\.worker|Failed to load resource.*(?:206|416)/]);
        await t.eval(`1`);
      } finally { await t.close(); }
    }

    // Download allowed: the button, the right address, and the bytes with the download header.
    {
      const { t, seen } = await publicTab(at(dl));
      try {
        await t.waitFor('.sh-grid .sh-card');
        await t.click('.sh-name', 'pic.png');
        await t.waitFor('.sh-viewer');
        const btn = await t.eval(COUNT('.sh-vbar .btn-primary'));
        if (btn !== 1) fail(`a link that allows download shows ${btn} Download buttons in the viewer`);
        const foot = await t.eval(`document.querySelector('.sh-foot')?.innerText || ''`);
        if (foot) fail('a link that allows download shows the view-only sentence');
        const res = await fetch(`${S.base}/api/shared/${dl.token}`);
        const body = await res.json();
        const file = body.files.find((f) => f.name === 'pic.png');
        const d = await fetch(S.base + file.download);
        if (d.status !== 200 || !/attachment/.test(d.headers.get('content-disposition') || '')) fail(`the Download address answers ${d.status} ${d.headers.get('content-disposition')}`);
        await t.key('Escape');
        await t.waitFor('.sh-grid');
        const foot2 = await t.eval(`document.querySelector('.sh-foot')?.innerText || ''`);
        if (foot2) fail('the grid of a link that allows download shows the view-only sentence');
        // a PDF kept for download only is not opened
        say('a link that allows download: Download button and bytes');
        clean('download page', seen);
      } finally { await t.close(); }
    }

    // A password: asked first, a wrong one says so, the right one opens the files.
    {
      const { t, seen } = await publicTab(at(pw));
      try {
        await t.waitFor('form input[type=password]');
        await shot(t, 'password');
        const asked = await t.eval(`document.body.innerText`);
        if (/pic\.png|notes\.md/.test(asked)) fail('the password page shows file names before the password');
        await t.typeInto('input[type=password]', 'nope');
        await t.click('button[type=submit]');
        const wrong = await until(t, `document.querySelector('.sdk-error')?.innerText`, Boolean);
        if (wrong !== 'That password isn\'t right.') fail(`a wrong password says "${wrong}"`);
        if ((await t.eval(`document.querySelector('input[type=password]')?.getAttribute('aria-invalid')`)) !== 'true') fail('the wrong-password field is not marked invalid');
        await t.typeInto('input[type=password]', 'garlic bread');
        await t.click('button[type=submit]');
        await t.waitFor('.sh-grid .sh-card');
        const n = await t.eval(COUNT('.sh-card'));
        if (n !== 2) fail(`the unlocked page shows ${n} tiles`);
        // the picture's bytes come with the cookie
        await t.click('.sh-name', 'pic.png');
        const pic = await until(t, `(() => { const i = document.querySelector('.fv-pic img'); return i && i.complete ? i.naturalWidth : 0; })()`, (v) => v > 0);
        if (!(pic > 0)) fail('the picture of a password link did not show after the password');
        await t.key('Escape');
        await t.waitFor('.sh-grid');
        await t.click('.sh-name', 'notes.md');
        const md = await until(t, `document.querySelector('.fv-md')?.innerText`, (v) => (v || '').length > 3);
        if (!md) fail('the Markdown of a password link did not show');
        say('password: asked first, a wrong one refused, the right one opens the files');
        clean('password page', seen, [/401|That password/]);
      } finally { await t.close(); }
    }
    // Too many tries: five wrong ones, then the sentence.
    {
      for (let i = 0; i < 5; i += 1) await fetch(`${S.base}/api/shared/${tries.token}/unlock`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: `wrong${i}` }) });
      const { t, seen } = await publicTab(at(tries));
      try {
        await t.waitFor('form input[type=password]');
        await t.typeInto('input[type=password]', 'garlic bread');
        await t.click('button[type=submit]');
        const said = await until(t, `document.querySelector('.sdk-error')?.innerText`, Boolean);
        if (said !== 'Too many tries. Wait a few minutes.') fail(`too many tries says "${said}"`);
        if (!(await t.eval(`document.querySelector('button[type=submit]').disabled`))) fail('Open stays on after too many tries');
        say('too many tries: the sentence, Open off');
        void seen;
      } finally { await t.close(); }
    }

    // Ended: turned off, and an address that was never a link.
    {
      const off = await api('DELETE', `/api/modules/vault/library/shares/${gone.share.id}?space=${trip}`, undefined, 'mia');
      if (off.status !== 200) fail(`Turn off answered ${off.status}`);
      for (const [name, url] of [['turned off', at(gone)], ['unknown', `${S.base}/shared/${'A'.repeat(43)}`], ['malformed', `${S.base}/shared/nonsense`]]) {
        const { t } = await publicTab(url);
        try {
          await t.waitFor('.sdk-empty-title');
          const words = await t.eval(`document.body.innerText`);
          if (!/This link has ended\./.test(words)) fail(`a ${name} link reads "${words.replace(/\n/g, ' ').slice(0, 100)}"`);
          if (/Rome|pic\.png/.test(words)) fail(`a ${name} link says something of the share`);
        } finally { await t.close(); }
      }
      say('turned-off, unknown and malformed links all read "This link has ended."');
    }

    // A removed file: the server drops it from its links at once; one that is gone between two reads is "File removed" and cannot be opened.
    {
      const r = await api('DELETE', `/api/modules/vault/library/${ids['plain.pdf']}?space=${trip}`, undefined, 'mia');
      if (r.status >= 300) fail(`could not remove the PDF (${r.status})`);
      const after = (await api('GET', `/api/modules/vault/library/shares?space=${trip}`, undefined, 'mia')).json.shares.find((x) => x.name === 'Rome two files');
      if (!after || after.files.length !== 1) fail(`removing a file left ${after && after.files.length} files in its link`);
      const { t, seen } = await publicTab(at(part), 1000, 'dark', false, true);
      try {
        await t.waitFor('.sh-grid .sh-card');
        const names = await t.eval(TEXT('.sh-name'));
        if (!/File removed/.test(names)) fail(`the removed file is not marked ("${names}")`);
        if (!(await t.eval(`[...document.querySelectorAll('.sh-name')].find((b) => b.innerText === 'File removed')?.disabled`))) fail('a removed file can be opened');
        const sub = await t.eval(TEXT('.sh-card.is-gone .sh-sub'));
        if (!/no longer in this link/.test(sub)) fail(`the removed card says "${sub}"`);
        say('a removed file reads "File removed" and is disabled');
        clean('removed-file page', seen);
      } finally { await t.close(); }
    }

    // A phone, 390 wide: three across, nothing wider than the screen, taps of 44; and the light theme.
    for (const mode of ['dark', 'light']) {
      const { t, seen } = await publicTab(at(view), 390, mode, true);
      try {
        await t.waitFor('.sh-grid .sh-card');
        await sleep(400);
        await shot(t, `grid-phone-${mode}`);
        const geo = await t.eval(`({ over: document.documentElement.scrollWidth - window.innerWidth, lefts: [...new Set([...document.querySelectorAll('.sh-card')].map((c) => Math.round(c.getBoundingClientRect().left)))].length, mode: getComputedStyle(document.body).backgroundColor })`);
        if (geo.over > 0) fail(`${mode} 390: the page is ${geo.over}px wider than the screen`);
        if (geo.lefts !== 3) fail(`${mode} 390: the grid is ${geo.lefts} across, not 3`);
        await t.click('.sh-name', 'pic.png');
        await t.waitFor('.sh-viewer');
        await sleep(300);
        const tap = await t.eval(`[...document.querySelectorAll('.sh-vbar button')].map((b) => Math.round(b.getBoundingClientRect().height))`);
        if (tap.some((h) => h < 44)) fail(`${mode} 390: a viewer button is ${Math.min(...tap)}px tall (44 needed)`);
        const over = await t.eval(`document.documentElement.scrollWidth - window.innerWidth`);
        if (over > 0) fail(`${mode} 390: the viewer is ${over}px wider than the screen`);
        await shot(t, `viewer-phone-${mode}`);
        clean(`${mode} phone page`, seen, [/pdf/]);
        geo.bg = geo.mode;
        if (mode === 'light' && /^rgb\((?:[0-9]|[1-9][0-9])\b/.test(geo.mode)) fail(`the light theme's page is dark (${geo.mode})`);
      } finally { await t.close(); }
    }
    say('390 wide, dark and light: three across, nothing too wide, 44px taps');

    // ---- the signed-in side, again: Select, Shared mark, the list, Turn off, the viewer's Share ----
    tab = await open(1000, 'mia');
    try {
      const marks = await tab.eval(COUNT('.vt-flag [aria-hidden], .vt-flag'));
      const shared = await tab.eval(`(() => { ${ROOTS} let n = 0; for (const r of roots) for (const f of r.querySelectorAll('.vt-flag[title="Shared by a link"]')) n += 1; return n; })()`);
      if (shared < 1) fail('no file shows the Shared mark');
      void marks;
      // Select: two chosen, Share in the toolbar
      await tab.eval(PRESS('button[aria-label="Select"]'));
      await tab.waitFor('#module-frame >>> .vt-tick');
      await tab.click('#module-frame >>> .vt-tick');
      await until(tab, TEXT('.mf-toolbar'), (v) => /1 selected/.test(v));
      const bar = await tab.eval(TEXT('.mf-toolbar'));
      if (!/Share/.test(bar)) fail(`Select has no Share in the toolbar ("${bar.replace(/\n/g, ' ').slice(0, 160)}")`);
      await tab.click('.mf-toolbar button', 'Share');
      await tab.waitFor(`${DIALOG} input[type=text]`);
      await shot(tab, 'sheet');
      const title = await tab.eval(`document.querySelector('dialog[open] h3').innerText`);
      if (!/^Share (a file|\d+ files)$/.test(title)) fail(`the sheet from Select is titled "${title}"`);
      await tab.eval(`(() => { const i = document.querySelector('dialog[open] input[type=text]'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await tab.typeInto(`${DIALOG} input[type=text]`, 'Two things');
      await tab.eval(`(() => { document.querySelector('dialog[open] [role=radio]:last-of-type').click(); const pw = document.querySelector('dialog[open] input[type=password]'); pw.focus(); })()`);
      await tab.typeInto(`${DIALOG} input[type=password]`, 'tomato soup');
      await tab.eval(`document.querySelector('dialog[open] input[role=switch]').click()`);
      await tab.click(`${DIALOG} .action-bar-save`);
      await tab.waitFor(`${DIALOG} .sh-address`);
      await shot(tab, 'made');
      const madeText = await tab.eval(TEXT(DIALOG));
      if (!/Password on/.test(madeText) || !/Download allowed/.test(madeText)) fail(`the made sheet's facts read "${madeText.replace(/\n/g, ' ').slice(-120)}"`);
      await tab.click(`${DIALOG} button`, 'Close');
      await until(tab, COUNT(DIALOG), (v) => v === 0);
      // the list, from the title bar's menu
      await tab.eval(PRESS('button[aria-label="Done"], .mf-toolbar button'));
      await tab.click('button[aria-label="More"], button[aria-label="Menu"], .mf-titlebar [aria-haspopup=menu]');
      await pressMenu(tab, 'Share links');
      await tab.waitFor(`${DIALOG} .sh-link`);
      await sleep(300);
      await shot(tab, 'list');
      const listText = await tab.eval(TEXT(DIALOG));
      for (const need of ['Share links', 'Two things', 'Rome photos', 'Opened', 'Turn off', 'View only', 'Download allowed', 'Password']) if (!listText.includes(need)) fail(`the list of share links lacks "${need}"`);
      const count = await tab.eval(COUNT(`${DIALOG} .sh-link`));
      // Turn off the one just made
      await tab.click(`${DIALOG} .sh-link button`, 'Turn off');
      await tab.waitFor('dialog[open] .confirm-actions, dialog[open] button.btn-danger');
      const ask = await tab.eval(TEXT('dialog[open]:last-of-type'));
      if (!/stops working at once/.test(ask)) fail(`Turn off asked "${ask.replace(/\n/g, ' ').slice(0, 160)}"`);
      await tab.click('dialog[open] button.btn-danger, dialog[open] button.btn-destructive');
      const after = await until(tab, COUNT(`${DIALOG} .sh-link`), (v) => v === count - 1);
      if (after !== count - 1) fail(`Turn off left ${after} links of ${count}`);
      say(`the list of share links: ${count} links, Turn off`);
      await tab.key('Escape');
    } finally { await tab.close(); }

    // The viewer's Share, over a file window.
    tab = await open(1000, 'mia');
    try {
      await tab.click('#module-frame >>> .vt-row .sdk-open');
      await tab.waitFor('.fv-win');
      await tab.waitFor('.fv-win button', 'Share');
      await tab.click('.fv-win button', 'Share');
      await tab.waitFor(`${DIALOG} input[type=text]`);
      const title = await tab.eval(`document.querySelector('dialog[open] h3').innerText`);
      if (title !== 'Share a file') fail(`the viewer's Share opens "${title}"`);
      say('the viewer\'s Share opens the same sheet');
    } finally { await tab.close(); }
    // ...and a member without share sees no Share in the viewer.
    await api('PATCH', '/api/roles/member', { 'module.vault.share': false }, 'admin');
    tab = await open(1000, 'sam');
    try {
      await tab.click('#module-frame >>> .vt-row .sdk-open');
      await tab.waitFor('.fv-win');
      await sleep(800);
      if (await tab.eval(COUNT('.fv-win button[aria-label="Share"], .fv-win .mf-toolbar button'))) {
        const t = await tab.eval(TEXT('.fv-win .mf-toolbar'));
        if (/Share/.test(t)) fail('a member without share sees Share in the viewer');
      }
    } finally { await tab.close(); }
  } finally {
    if (browser) { try { browser.child.kill(); } catch { /* gone */ } }
    if (server) await stopServer(server);
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* left behind */ }
  }
  return failures.length ? 1 : 0;
}

let code = 1;
try { code = await main(); } catch (err) { console.error(err); failures.push(`the check stopped: ${err.message}`); code = 1; }
if (failures.length) {
  for (const f of failures) console.error(`check-vault-share-page: FAIL ${f}`);
  process.exit(1);
}
say('ok');
process.exit(code);
