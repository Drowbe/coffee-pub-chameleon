// check-vault-module.mjs: the Vault module (modules/vault, plan-attachments-vault.md step 2), in two parts.
//   1. Read from the files, no browser: the manifest builds and declares what the plan says (the `library` hook, the space scope, the five
//      permissions with guests off, the `file` kind), every host.library call the page makes exists in the SDK and the host's bridge, the
//      and both templates show the module under their own word.
//   2. Live (headless Chromium, the screenshot seed): files added through the server and through the page's own Add files, the List and
//      the Grid, search, Rename, Remove, Select, a member who may not change someone else's file, a member who may not add, and a phone's
//      width (one column of rows with 44px height, the Grid three across); then the file windows (check-vault-viewer-cases.mjs): every type
//      opened with real files, Previous and Next, Info, the cap of four, Close all, Esc and focus, Rename and Remove, the Layout menu on a
//      space's canvas, a phone's one sheet and the contrast in both themes.
// Usage: node tools/check-vault-module.mjs. With no Chromium the live part says SKIPPED and exits 0 (a skip, never a pass).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const say = (...a) => console.log('check-vault-module:', ...a);
const failures = [];
const fail = (m) => failures.push(m);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ---- 1. the files ----
{
  const { buildModule } = createRequire(import.meta.url)('../server/module-build.js');
  const { manifest } = buildModule(path.join(ROOT, 'modules', 'vault'));
  if (manifest.id !== 'vault') fail('the module is not called vault');
  if (manifest.library !== true) fail('the manifest does not declare library: true');
  if (manifest.scope.join() !== 'space') fail(`the Vault's scope is ${manifest.scope.join()}, not space`);
  const perms = Object.fromEntries(manifest.permissions.map((p) => [p.key, p.default]));
  for (const k of ['view', 'add', 'download', 'remove_any', 'share']) {
    if (!perms[k]) fail(`the permission ${k} is missing`);
    else if (perms[k].guest) fail(`the permission ${k} is on for guests`);
  }
  if (perms.remove_any && (perms.remove_any.member || !perms.remove_any.moderator)) fail('remove_any should be on for moderators and off for members');
  if (perms.share && (perms.share.member || !perms.share.moderator)) fail('share should be on for moderators and off for members');
  if (!manifest.refs.produces.some((p) => p.kind === 'file' && p.open && p.backlinks)) fail('the file kind is not declared with open and backlinks');
  const js = read('modules/vault/src/vault.js');
  const sdk = read('public/sdk/host.js');
  const bridge = read('public/module-host.js');
  const block = sdk.slice(sdk.indexOf('    library: {'), sdk.indexOf('    // The module\'s settings, as chosen'));
  for (const name of new Set([...js.matchAll(/host\.library\.(\w+)/g)].map((m) => m[1]))) {
    if (!new RegExp(`\\b${name}:`).test(block)) fail(`the page calls host.library.${name}, which the SDK does not have`);
    if (!bridge.includes(`'library.${name}'`)) fail(`the page calls host.library.${name}, which the host's bridge does not answer`);
  }
  if (!/\bopen:\s*\(pointer, o\) => call\('files\.open'/.test(sdk)) fail('the SDK has no host.files.open');
  if (!bridge.includes("'files.open'")) fail("the host's bridge does not answer files.open");
  for (const f of ['public/file-viewer.js', 'public/file-viewer-views.js', 'public/file-viewer.css']) if (!fs.existsSync(path.join(ROOT, f))) fail(`${f} is missing`);
  if (!/sandbox', 'allow-scripts'\)/.test(read('public/file-viewer-views.js')) || /allow-same-origin/.test(read('public/file-viewer-views.js').replace(/\/\/.*$/gm, ''))) fail('the PDF frame must be sandbox="allow-scripts" and never allow-same-origin');
  const travel = JSON.parse(read('templates/travel.json'));
  const games = JSON.parse(read('templates/games.json'));
  if (travel.moduleNames.vault !== 'Documents' || !travel.modules.includes('vault')) fail('the travel template does not show the Vault as Documents');
  if (games.moduleNames.vault !== 'Handouts' || !games.modules.includes('vault')) fail('the games template does not show the Vault as Handouts');
  say('manifest, SDK calls and templates read');
}

// ---- 2. the browser ----
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\ntrailer\n<< /Root 1 0 R /Size 4 >>\nstartxref\n0\n%%EOF\n');
const MD = Buffer.from('# Day one\n\nSee Rome.\n');
const ROOTS = `const roots = []; (function walk(r) { roots.push(r); for (const x of r.querySelectorAll('*')) if (x.shadowRoot) walk(x.shadowRoot); })(document);`;
const COUNT = (sel) => `(() => { ${ROOTS} let n = 0; for (const r of roots) n += [...r.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.getClientRects().length).length; return n; })()`;
const TEXT = (sel) => `(() => { ${ROOTS} const out = []; for (const r of roots) for (const e of r.querySelectorAll(${JSON.stringify(sel)})) if (e.getClientRects().length) out.push(e.innerText); return out.join(' | '); })()`;
const MENU_ITEM = (text) => `(() => { ${ROOTS} for (const r of roots) for (const e of r.querySelectorAll('[role=menuitem]')) if (e.getClientRects().length && e.innerText.trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())})) { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; } return null; })()`;
const SET_VALUE = (sel, value) => `(() => { ${ROOTS} for (const r of roots) { const e = r.querySelector(${JSON.stringify(sel)}); if (e) { e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); return true; } } return false; })()`;
const PRESS = (sel) => `(() => { ${ROOTS} for (const r of roots) { const e = r.querySelector(${JSON.stringify(sel)}); if (e) { e.click(); return true; } } return false; })()`;
const ROWS = '#module-frame >>> .vt-row';

async function main() {
  const bin = findBrowser();
  if (!bin) { say('live part SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return failures.length ? 1 : 0; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-module-'));
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
    const put = (who, name, bytes, type) => api('POST', `/api/modules/vault/library?space=${trip}&name=${encodeURIComponent(name)}`, bytes, who, type);
    const names = async (who = 'mia') => ((await api('GET', `/api/modules/vault/library?space=${trip}`, undefined, who)).json?.files || []).map((f) => f.name).sort();
    for (const [name, bytes, type] of [['Rome map.png', PNG, 'image/png'], ['Hotel Roma booking.pdf', PDF, 'application/pdf'], ['Day one.md', MD, 'text/markdown']]) {
      const r = await put('mia', name, bytes, type);
      if (r.status !== 201) throw new Error(`could not add ${name}: ${r.status} ${JSON.stringify(r.json)}`);
    }
    browser = await launch(bin);
    const open = async (size, as) => {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(size, 'dark', false);
      const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
      await driveScreen(tab, { id: 'vault', as, url: '/modules/vault?space={trip}&popout=1', wait: ROWS }, S.base, S.cookies, S.ctx);
      await sleep(600);
      return tab;
    };
    const until = async (tab, expr, want, ms = 6000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await tab.eval(expr); if (want(v)) return v; await sleep(150); } return v; };

    // The List, search, the Grid, Rename, Remove, Select (a moderator).
    let tab = await open(1000, 'mia');
    try {
      const n = await tab.eval(COUNT('.vt-row'));
      if (n !== 3) fail(`the List shows ${n} rows for three files`);
      say(`List: ${n} rows`);
      const status = await tab.eval(TEXT('.mf-status'));
      if (!/3 files/.test(status)) fail(`the status line says "${status}", not the count of files`);
      await tab.typeInto('.mf-search input', 'rom');
      const found = await until(tab, COUNT('.vt-row'), (v) => v === 2);
      if (found !== 2) fail(`searching "rom" shows ${found} rows (two names hold it)`);
      say(`search "rom": ${found} rows`);
      await tab.eval(SET_VALUE('.mf-search input', ''));
      await tab.click('.mf-switch-btn', 'Grid');
      const tiles = await until(tab, COUNT('.vt-card'), (v) => v === 3);
      if (tiles !== 3) fail(`the Grid shows ${tiles} tiles for three files`);
      await tab.click('.mf-switch-btn', 'List');
      await until(tab, COUNT('.vt-row'), (v) => v === 3 || v === 2);
      // Rename
      await tab.click('#module-frame >>> [data-menu]');
      await until(tab, MENU_ITEM('Rename'), Boolean);
      const items = await tab.eval(TEXT('[role=menu]'));
      if (!/Open/.test(items) || !/Rename/.test(items) || !/Remove/.test(items)) fail(`a moderator's file menu is "${items.replace(/\n/g, ' ')}"`);
      const ri = await tab.eval(MENU_ITEM('Rename'));
      await tab.mouse('mouseMoved', ri.x + ri.w / 2, ri.y + ri.h / 2, { button: 'none', clickCount: 0 }); await tab.mouse('mousePressed', ri.x + ri.w / 2, ri.y + ri.h / 2); await tab.mouse('mouseReleased', ri.x + ri.w / 2, ri.y + ri.h / 2);
      await tab.waitFor('#module-frame >>> #rename-name');
      await tab.eval(SET_VALUE('#rename-name', 'Renamed by the check'));
      await tab.click('#module-frame >>> #rename-form button[type=submit]');
      let after = [];
      for (let i = 0; i < 20 && !after.includes('Renamed by the check.md') && !after.includes('Renamed by the check.png') && !after.includes('Renamed by the check.pdf'); i += 1) { await sleep(250); after = await names(); }
      if (!after.some((x) => x.startsWith('Renamed by the check'))) fail(`Rename did not reach the server (${after.join(', ')})`);
      say(`Rename: ${after.filter((x) => x.startsWith('Renamed')).join()}`);
      // Select, two chosen
      // A control may not be wired the moment a dialog has closed over it: press again when nothing changed.
      for (let again = 0; again < 4 && !(await tab.eval(COUNT('.vt-tick'))); again += 1) { await sleep(500); await tab.eval(PRESS('button[aria-label="Select"]')); await sleep(700); }
      await tab.waitFor('#module-frame >>> .vt-tick');
      await tab.click('#module-frame >>> .vt-tick');
      const picked = await until(tab, TEXT('.mf-toolbar'), (v) => /1 selected/.test(v));
      if (!/1 selected/.test(picked)) fail(`Select shows "${picked}" after one is chosen`);
      say('Select: one chosen');
    } finally { await tab.close(); }

    // Remove (the confirmation, then the file goes)
    tab = await open(1000, 'mia');
    try {
      const before = (await names()).length;
      await tab.click('#module-frame >>> [data-menu]');
      await until(tab, MENU_ITEM('Remove'), Boolean);
      const rm = await tab.eval(MENU_ITEM('Remove'));
      await tab.mouse('mouseMoved', rm.x + rm.w / 2, rm.y + rm.h / 2, { button: 'none', clickCount: 0 }); await tab.mouse('mousePressed', rm.x + rm.w / 2, rm.y + rm.h / 2); await tab.mouse('mouseReleased', rm.x + rm.w / 2, rm.y + rm.h / 2);
      const asked = await until(tab, TEXT('dialog[open]'), (v) => /can't be undone/.test(v));
      if (!/can't be undone/.test(asked)) fail(`Remove asked "${asked}"`);
      await tab.click('dialog[open] button', 'Remove');
      let left = before;
      for (let i = 0; i < 20 && left === before; i += 1) { await sleep(250); left = (await names()).length; }
      if (left !== before - 1) fail(`Remove left ${left} files of ${before}`);
      say(`Remove: ${before} files, then ${left}`);
    } finally { await tab.close(); }

    // Add files through the page: a Markdown file goes in, a program is refused with the sentence.
    tab = await open(1000, 'mia');
    try {
      await tab.eval(PRESS('button[aria-label="Add files"]'));
      await tab.waitFor('#module-frame >>> #picker');
      const give = (name, type, text) => `(() => { ${ROOTS} for (const r of roots) { const i = r.querySelector('#picker'); if (i) { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} })); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; } } return false; })()`;
      await tab.eval(give('From the page.md', 'text/markdown', '# Hello\n'));
      await tab.eval(give('program.exe', 'application/octet-stream', 'MZ'));
      const queue = await until(tab, TEXT('.vt-queue'), (v) => /can't be added here/.test(v) && /Added/.test(v), 8000);
      if (!/can't be added here/.test(queue)) fail(`a program was not refused with the server's sentence ("${queue}")`);
      if (!(await names()).includes('From the page.md')) fail('Add files did not put the Markdown file in the Vault');
      say('Add files: a Markdown file added, a program refused');
    } finally { await tab.close(); }

    // A member: someone else's file has no Rename or Remove; with Add off there is no Add files.
    tab = await open(1000, 'sam');
    try {
      await tab.click('#module-frame >>> [data-menu]');
      await until(tab, MENU_ITEM('Open'), Boolean);
      const menu = await tab.eval(TEXT('[role=menu]'));
      if (/Rename|Remove/.test(menu)) fail(`a member's menu for someone else's file offers "${menu.replace(/\n/g, ' ')}"`);
      if (!(await tab.eval(COUNT('button[aria-label="Add files"]')))) fail('a member who may add is not shown Add files');
      say(`a member's menu for someone else's file: ${menu.replace(/\n/g, ', ')}`);
    } finally { await tab.close(); }
    const off = await api('PATCH', '/api/roles/member', { 'module.vault.add': false }, 'admin');
    if (off.status !== 200) fail(`could not take add from the member role (${off.status})`);
    tab = await open(1000, 'sam');
    try {
      if (await tab.eval(COUNT('button[aria-label="Add files"]'))) fail('a member who may not add is shown Add files');
      say('a member who may not add: no Add files');
    } finally { await tab.close(); await api('PATCH', '/api/roles/member', { 'module.vault.add': true }, 'admin'); }

    // A phone: rows 44px or more high, the Grid three across.
    tab = await open(390, 'mia');
    try {
      const h = await tab.eval(`(() => { ${ROOTS} for (const r of roots) { const e = r.querySelector('.vt-row'); if (e) return Math.round(e.getBoundingClientRect().height); } return 0; })()`);
      if (h < 44) fail(`at 390px a row is ${h}px high (44 or more)`);
      await tab.click('.mf-switch-btn', 'Grid');
      await until(tab, COUNT('.vt-card'), (v) => v >= 3);
      const across = await tab.eval(`(() => { ${ROOTS} const xs = new Set(); for (const r of roots) for (const e of r.querySelectorAll('.vt-card')) xs.add(Math.round(e.getBoundingClientRect().left)); return xs.size; })()`);
      if (across !== 3) fail(`at 390px the Grid is ${across} across (three)`);
      say(`phone: rows ${h}px high, Grid ${across} across`);
    } finally { await tab.close(); }

    // The file windows (step 3): every type, the cap, Close all, Esc, focus, the phone's sheet, contrast.
    const { viewerCases } = await import('./check-vault-viewer-cases.mjs');
    await viewerCases({ S, api, say, fail, browser, until, open, dataDir, trip });
  } finally {
    try { if (browser) { browser.cdp.ws.close(); browser.child.kill(); fs.rmSync(browser.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } } catch { /* best effort */ }
    if (server) await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  if (failures.length) { for (const f of failures) say('FAIL', f); return 1; }
  say('ok');
  return 0;
}
process.exit(await main());
