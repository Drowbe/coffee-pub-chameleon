// check-vault-link-live.mjs: a module linking its objects to library files (plan-attachments-vault.md, step 4), live in headless Chromium
// on a seeded throwaway server (the screenshot tool's travel trip; no LiveKit, so the call is stubbed as the screenshot tool does).
//   - The Planner's stay and journey carry file chips on their cards; a click opens the file window over the space's canvas, with Previous and
//     Next walking that stay's files ("1 of 3"), none for a journey with one file, and the Vault is not brought forward;
//   - the editor's Attachments row: the chips with Unlink, Add file opening the chooser, a pick shows up as a chip, Save links it
//     (the Vault's "Where it is used" names the stay) and Unlink + Save takes the link away;
//   - the server's push: a file added, renamed and removed by someone else shows in the Vault's list and an open file window within 2 seconds
//     (the poll is 15), and a removed file's chip reads "File removed" with Remove link for an editor;
//   - Cream light too, and 390 wide.
// Usage: node tools/check-vault-link-live.mjs. With no Chromium it says SKIPPED and exits 0 (a skip, never a pass). SHOTS_KEEP=<dir> keeps pictures.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const say = (...a) => console.log('check-vault-link-live:', ...a);
const failures = [];
const fail = (m) => failures.push(m);
const fixture = (name) => fs.readFileSync(path.join(ROOT, 'tools', 'fixtures', 'vault', name));
const WINS = `document.querySelectorAll('.fv-win').length`;
const KEEP = process.env.SHOTS_KEEP || '';

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-link-live-'));
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
    await api('PATCH', '/api/modules/vault', { enabled: true, allSpaces: true });
    const trip = S.ctx.trip;
    const put = async (who, name, bytes, type) => (await api('POST', `/api/modules/vault/library?space=${trip}&name=${encodeURIComponent(name)}`, bytes, who, type)).json?.file;
    const files = {
      pdf: await put('mia', 'Hotel booking.pdf', fixture('plain.pdf'), 'application/pdf'),
      jpg: await put('mia', 'Room photo.jpg', fixture('photo.jpg'), 'image/jpeg'),
      png: await put('mia', 'Map.png', fixture('pic.png'), 'image/png'),
      mp3: await put('mia', 'Flight chime.mp3', fixture('tone.mp3'), 'audio/mpeg'),
    };
    for (const [k, f] of Object.entries(files)) if (!f) throw new Error(`the ${k} fixture was not kept`);
    const ptr = (f) => ({ module: 'vault', kind: 'file', id: f.id, scope: 'space', space: trip });

    // The Planner's demo stay and journey get their files, as the editor would save them: on the object, and as link records.
    const list = (await api('GET', `/api/modules/travel/data?scope=space&space=${trip}&prefix=plan:`, undefined, 'mia')).json.items;
    const stay = list.find((i) => i.value.kind === 'stay');
    const journey = list.find((i) => i.value.kind === 'journey' && i.value.date);
    if (!stay || !journey) throw new Error('the demo stay and journey are not in the seed');
    const attach = async (item, fs2) => {
      const saved = await api('PUT', `/api/modules/travel/data/${encodeURIComponent(item.key)}?scope=space&space=${trip}`, { value: { ...item.value, files: fs2.map(ptr) }, version: item.version }, 'mia');
      if (saved.status !== 200) throw new Error(`could not save ${item.key}: ${saved.status} ${JSON.stringify(saved.json)}`);
      const id = item.key.slice('plan:'.length);
      const linked = await api('POST', '/api/objects/links', { module: 'travel', from: { module: 'travel', kind: 'plan', id, scope: 'space', space: trip }, to: fs2.map(ptr), kind: 'file', op: 'add' }, 'mia');
      if (linked.status !== 200) throw new Error(`could not link ${item.key}: ${linked.status} ${JSON.stringify(linked.json)}`);
      return id;
    };
    const stayId = await attach(stay, [files.pdf, files.jpg, files.png]);
    const journeyId = await attach(journey, [files.mp3]);

    browser = await launch(bin);
    const shoot = async (tab, name) => { if (!KEEP) return; fs.mkdirSync(KEEP, { recursive: true }); fs.writeFileSync(path.join(KEEP, `${name}.png`), await tab.shoot(false)); };
    const until = async (tab, expr, want, ms = 6000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await tab.eval(expr); if (want(v)) return v; await sleep(100); } return v; };
    const canvas = async (size, mode, as = 'mia') => {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(size, mode, true);
      // What the page's event streams hear of the library, for the diagnosis when a window or a chip does not follow.
      await tab.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const E = window.EventSource; window.__heard = []; window.EventSource = class extends E { constructor(u, o) { super(u, o); this.addEventListener('library', (e) => window.__heard.push(e.data)); } }; })()` }, tab.sid);
      const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
      await driveScreen(tab, { id: 'workspace', as, url: '/#join={trip}', wait: 'button.sdk-strip-fact[data-module=budget]', call: true, space: true }, S.base, S.cookies, S.ctx);
      await sleep(1500);
      return tab;
    };
    const opened = (tab, id) => tab.eval(`!!__q('[data-module-root=${id}]')`);
    const chipsOf = (tab) => tab.eval(`__all('[data-module-root=travel] >>> .sdk-file-chip').map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`);

    // ---- 1. dark, 1280: the Planner on the canvas, chips on the stay's card, a click opens the window ----
    let tab = await canvas(1280, 'dark');
    try {
      if (!(await opened(tab, 'travel'))) {
        await tab.eval(`(() => { const b = __q('[data-open-module=travel]') || __q('#setup'); if (b) b.click(); })()`).catch(() => {});
      }
      await tab.waitFor('[data-module-root=travel] >>> .sdk-file-chip', '', 15000).catch(() => {});
      const chips = await chipsOf(tab);
      if (chips.length !== 4) fail(`the Planner's cards show ${chips.length} file chips, not 4 (${JSON.stringify(chips)})`);
      for (const f of ['Hotel booking.pdf', 'Room photo.jpg', 'Map.png', 'Flight chime.mp3']) if (!chips.some((c) => c.startsWith(f))) fail(`no chip for ${f}: ${JSON.stringify(chips)}`);
      const vaultBefore = await opened(tab, 'vault');
      await shoot(tab, 'planner-chips-dark-1280');
      // A journey with one file: no Previous and Next.
      await tab.click('[data-module-root=travel] >>> .sdk-file-chip', 'Flight chime.mp3');
      await until(tab, WINS, (v) => v === 1, 8000);
      await sleep(900);
      const solo = await tab.eval(`(() => { const w = [...document.querySelectorAll('.fv-win')].find((x) => /Flight chime/.test(x.innerText + (x.querySelector('.mf-titlebar-title')?.innerText || ''))); return w ? /\\d+ of \\d+/.test(w.innerText) : null; })()`);
      if (solo !== false) fail(`the journey's single file window ${solo === null ? `did not open (${JSON.stringify(await tab.eval("[...document.querySelectorAll('.fv-win')].map((w) => w.innerText.replace(/\\s+/g, ' ').slice(0, 90))"))})` : 'shows Previous and Next'}`);
      await tab.key('Escape');
      await until(tab, WINS, (v) => v === 0, 3000);
      if ((await tab.eval(WINS)) !== 0) fail('Escape did not close the journey file window');

      await tab.click('[data-module-root=travel] >>> .sdk-file-chip', 'Room photo.jpg');
      const wins = await until(tab, WINS, (v) => v === 1, 8000);
      if (wins !== 1) fail(`a click on a chip opened ${wins} file windows, not 1`);
      await sleep(800);
      const title = await tab.eval(`document.querySelector('.fv-win .mf-titlebar-title')?.innerText || ''`);
      if (title.trim() !== 'Room photo.jpg') fail(`the window is titled "${title}", not the file's name`);
      const count = await tab.eval(`document.querySelector('.fv-win')?.innerText.match(/(\\d+) of (\\d+)/)?.[0] || ''`);
      if (count !== '2 of 3') fail(`Previous and Next read "${count}", not "2 of 3" (the stay's three files, in order)`);
      if ((await opened(tab, 'vault')) !== vaultBefore) fail('opening a linked file brought the Vault forward (or put it away)');
      const inCanvas = await tab.eval(`(() => { const w = document.querySelector('.fv-win'); const c = document.getElementById('canvas'); if (!w || !c) return false; const a = w.getBoundingClientRect(); const b = c.getBoundingClientRect(); return a.left >= b.left - 1 && a.top >= b.top - 1 && a.right <= b.right + 1 && a.bottom <= b.bottom + 1; })()`);
      if (!inCanvas) fail('the file window is not inside the canvas');
      await shoot(tab, 'planner-file-window-dark-1280');
      say(`stay chips: ${chips.length}; the window "${title.trim()}" opens over the canvas, ${count}, the Vault ${vaultBefore ? 'was on the canvas and stayed as it was' : 'is not on the canvas'}`);

      // ---- the push: someone else renames, removes and adds; windows and chips follow within 2 seconds ----
      const t0 = Date.now();
      await api('PATCH', `/api/modules/vault/library/${files.jpg.id}?space=${trip}`, { name: 'Balcony view.jpg' }, 'mia');
      const renamed = await until(tab, `[...document.querySelectorAll('.fv-win .mf-titlebar-title')].map((e) => e.innerText.trim()).join('|')`, (v) => /Balcony view/.test(v), 2500);
      if (!/Balcony view/.test(renamed)) fail(`the page heard ${JSON.stringify(await tab.eval('window.__heard'))}; an open window kept the old name after a rename (${renamed}) -- the push should show it within 2 seconds`);
      const chipRenamed = await until(tab, `__all('[data-module-root=travel] >>> .sdk-file-chip').map((e) => e.innerText).join('|')`, (v) => /Balcony view/.test(v), 2500);
      if (!/Balcony view/.test(chipRenamed)) fail('the Planner\'s chip kept the old name after a rename');
      say(`rename: the window's title and the chip changed in ${Date.now() - t0} ms`);
      const t1 = Date.now();
      await api('DELETE', `/api/modules/vault/library/${files.jpg.id}?space=${trip}`, undefined, 'mia');
      const removed = await until(tab, `[...document.querySelectorAll('.fv-win')].map((e) => e.innerText).join('|')`, (v) => /File removed/.test(v), 2500);
      if (!/File removed/.test(removed)) fail('the window of a removed file did not say "File removed" within 2 seconds');
      const chipGone = await until(tab, `__all('[data-module-root=travel] >>> .sdk-file-chip').map((e) => e.innerText).join('|')`, (v) => /File removed/.test(v), 2500);
      if (!/File removed/.test(chipGone)) fail('the Planner\'s chip did not read "File removed"');
      const removeLink = await until(tab, `__all('[data-module-root=travel] >>> .sdk-file-chip-remove').map((e) => e.innerText.trim())`, (v) => v.length > 0, 2500);
      if (!removeLink.includes('Remove link')) fail('an editor is not offered Remove link beside a removed file');
      say(`remove: the window and the chip say File removed in ${Date.now() - t1} ms; ${JSON.stringify(removeLink)}`);
      await shoot(tab, 'planner-removed-dark-1280');
      // The link record stays (not deleted), and the file's "where it is used" no longer exists with it.
      const remaining = (await api('GET', `/api/objects/links?from=travel&dir=from&ref=${encodeURIComponent(JSON.stringify({ module: 'travel', kind: 'plan', id: stayId, scope: 'space', space: trip }))}`, undefined, 'mia')).json?.summaries || [];
      if (!remaining.some((s) => s.removed)) fail(`the stay's link to the removed file is not kept and said (${JSON.stringify(remaining.map((s) => s.title))})`);
      // Remove link takes the pointer off the stay.
      await tab.click('[data-module-root=travel] >>> .sdk-file-chip-remove', 'Remove link');
      const after = await until(tab, `__all('[data-module-root=travel] >>> .sdk-file-chip').map((e) => e.innerText).join('|')`, (v) => !/File removed/.test(v), 4000);
      if (/File removed/.test(after)) fail('Remove link did not take the chip off the card');
    } finally { await tab.close(); }

    // ---- 2. the Vault's list follows the server's push, not the 15 second poll ----
    {
      const vtab = new Tab(browser.cdp, S.ctx);
      await vtab.open(1000, 'dark', false);
      const settle = vtab.settle.bind(vtab); vtab.settle = () => Promise.race([settle(), sleep(3000)]);
      try {
        await driveScreen(vtab, { id: 'vault', as: 'mia', url: '/modules/vault?space={trip}&popout=1', wait: '#module-frame >>> .vt-row' }, S.base, S.cookies, S.ctx);
        await sleep(800);
        const rows = () => vtab.eval(`__all('#module-frame >>> .vt-row').map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`);
        const before = (await rows()).length;
        const t = Date.now();
        const added = await put('sam', 'Dinner menu.pdf', fixture('plain.pdf'), 'application/pdf');
        const grew = await until(vtab, `__all('#module-frame >>> .vt-row').length`, (n) => n === before + 1, 2500);
        if (grew !== before + 1) fail(`the Vault's list had ${grew} rows 2.5 seconds after a file was added by someone else, not ${before + 1} (the poll is every 15 seconds)`);
        const tAdd = Date.now() - t;
        const t2 = Date.now();
        await api('PATCH', `/api/modules/vault/library/${added.id}?space=${trip}`, { name: 'Dinner menu v2.pdf' }, 'sam');
        const renamed = await until(vtab, `__all('#module-frame >>> .vt-row').map((e) => e.innerText).join('|')`, (v) => /Dinner menu v2/.test(v), 2500);
        if (!/Dinner menu v2/.test(renamed)) fail('the Vault\'s list did not show a rename within 2 seconds');
        const tRename = Date.now() - t2;
        const t3 = Date.now();
        await api('DELETE', `/api/modules/vault/library/${added.id}?space=${trip}`, undefined, 'sam');
        const shrank = await until(vtab, `__all('#module-frame >>> .vt-row').length`, (n) => n === before, 2500);
        if (shrank !== before) fail(`the Vault's list had ${shrank} rows 2.5 seconds after a removal, not ${before}`);
        say(`the Vault's list followed an add in ${tAdd} ms, a rename in ${tRename} ms and a removal in ${Date.now() - t3} ms`);
      } finally { await vtab.close(); }
    }

    // ---- 3. the editor's Attachments row ----
    tab = await canvas(1280, 'dark');
    try {
      await tab.waitFor('[data-module-root=travel] >>> .sdk-file-chip', '', 15000).catch(() => {});
      // Open the stay's editor from its card's menu.
      await tab.click('[data-module-root=travel] >>> .card.stay:has(.sdk-file-chip) [data-action="move-menu"]');
      await sleep(600);
      await shoot(tab, 'planner-menu-dark-1280');
      const menuItem = await tab.eval(`(() => { const roots = [document]; const walk = (r) => { for (const e of r.querySelectorAll('*')) if (e.shadowRoot) { roots.push(e.shadowRoot); walk(e.shadowRoot); } }; walk(document); for (const r of roots) for (const e of r.querySelectorAll('[role=menuitem], [role=menu] button, .sdk-menu-item')) if (/^Edit$/.test(e.textContent.trim())) { const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; } return null; })()`);
      if (!menuItem) throw new Error('the card\'s menu has no Edit');
      await tab.mouse('mouseMoved', menuItem.x, menuItem.y, { button: 'none', clickCount: 0 });
      await tab.mouse('mousePressed', menuItem.x, menuItem.y);
      await tab.mouse('mouseReleased', menuItem.x, menuItem.y);
      await tab.waitFor('[data-module-root=travel] >>> #f-files-section', '', 8000);
      await sleep(500);
      const row = await tab.eval(`(() => { const s = __q('[data-module-root=travel] >>> #f-files-section'); return { shown: !!s && s.getClientRects().length > 0, chips: __all('[data-module-root=travel] >>> #f-files .sdk-file-chip').length, unlink: __all('[data-module-root=travel] >>> #f-files .sdk-file-chip-remove').map((e) => e.innerText.trim()), add: !!__q('[data-module-root=travel] >>> #f-files-add') }; })()`);
      if (!row.shown) fail('the editor has no Attachments row for a stay');
      if (row.chips !== 2 || !row.unlink.every((u) => u === 'Unlink') || row.unlink.length !== 2) fail(`the editor's chips: ${JSON.stringify(row)} (two files are left on the stay, each with Unlink)`);
      await shoot(tab, 'planner-editor-dark-1280');
      // Unlink one, add one from the chooser, save.
      await tab.click('[data-module-root=travel] >>> #f-files .sdk-file-chip-remove', 'Unlink');
      await sleep(500);
      say(`Add file button: ${JSON.stringify(await tab.eval(`(() => { const b = __q('[data-module-root=travel] >>> #f-files-add'); return b ? { hidden: b.hidden, disabled: b.disabled, rects: b.getClientRects().length, display: getComputedStyle(b).display } : null; })()`))}`);
      await tab.eval(`(() => { const b = __q('[data-module-root=travel] >>> #f-files-add'); b.scrollIntoView({ block: 'center' }); })()`);
      await sleep(300);
      await tab.click('[data-module-root=travel] >>> #f-files-add');
      await sleep(1500);
      await shoot(tab, 'planner-picker-dark-1280');
      const opened = await tab.eval(`!!document.querySelector('dialog.sdk-dialog-pick[open]')`);
      if (!opened) fail('Add file did not open the chooser');
      await tab.click('dialog.sdk-dialog-pick .sdk-pick-row', 'Flight chime');
      await tab.click('dialog.sdk-dialog-pick button', 'Pick');
      await sleep(900);
      const picked = await tab.eval(`__all('[data-module-root=travel] >>> #f-files .sdk-file-chip').map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`);
      if (picked.length !== 2 || !picked.some((c) => c.startsWith('Flight chime.mp3')) || !picked.some((c) => c.startsWith('Map.png'))) fail(`after Unlink and a pick the editor shows ${JSON.stringify(picked)}, not Map.png and Flight chime.mp3`);
      await shoot(tab, 'planner-editor-picked-dark-1280');
      await tab.click('[data-module-root=travel] >>> #f-save');
      await sleep(1500);
      const saved = (await api('GET', `/api/modules/travel/data/${encodeURIComponent(`plan:${stayId}`)}?scope=space&space=${trip}`, undefined, 'mia')).json?.item?.value;
      const savedNames = (saved?.files || []).map((f) => f.id).sort();
      if (savedNames.join() !== [files.png.id, files.mp3.id].sort().join()) fail(`the stay was saved with files ${JSON.stringify(savedNames)}`);
      const uses = async (f) => ((await api('GET', `/api/modules/vault/library/${f.id}/uses?space=${trip}`, undefined, 'mia')).json?.uses || []).map((u) => u.title);
      const [usesChime, usesPdf, usesPng] = [await uses(files.mp3), await uses(files.pdf), await uses(files.png)];
      if (!usesChime.includes(stay.value.title)) fail(`"Where it is used" for the file just added does not name the stay (${JSON.stringify(usesChime)})`);
      if (usesPdf.length) fail(`the file that was unlinked is still used by ${JSON.stringify(usesPdf)}`);
      if (!usesPng.includes(stay.value.title)) fail(`the file that stayed linked lost its link (${JSON.stringify(usesPng)})`);
      say(`the editor: Unlink and a pick, Save; the stay holds Map.png and Flight chime.mp3; "Where it is used": chime ${JSON.stringify(usesChime)}, unlinked pdf ${JSON.stringify(usesPdf)}`);
    } finally { await tab.close(); }

    // ---- 4. Cream light at 1280, and a phone at 390 on the Planner's own page: the chips and the window read the same, the window is a sheet ----
    tab = await canvas(1280, 'light');
    try {
      await tab.waitFor('[data-module-root=travel] >>> .sdk-file-chip', '', 15000).catch(() => {});
      await shoot(tab, 'planner-chips-light-1280');
      await tab.click('[data-module-root=travel] >>> .sdk-file-chip', 'Map.png');
      const wins = await until(tab, WINS, (v) => v === 1, 8000);
      if (wins !== 1) fail('in the light theme a click on a chip did not open the window');
      await sleep(900);
      await shoot(tab, 'planner-file-window-light-1280');
      const contrast = await tab.eval(`(() => { const e = document.querySelector('[data-module-root=travel]'); const chip = (e && e.shadowRoot ? e.shadowRoot : document).querySelector('.sdk-file-chip-name'); return chip ? getComputedStyle(chip).color : ''; })()`);
      say(`light, 1280: the window opens; a chip's name is drawn in ${contrast || 'the theme colour'}`);
    } finally { await tab.close(); }
    {
      const ptab = new Tab(browser.cdp, S.ctx);
      await ptab.open(390, 'dark', false);
      const settle = ptab.settle.bind(ptab); ptab.settle = () => Promise.race([settle(), sleep(3000)]);
      try {
        await driveScreen(ptab, { id: 'planner', as: 'mia', url: '/modules/travel?space={trip}&popout=1', wait: '#module-frame >>> .sdk-file-chip' }, S.base, S.cookies, S.ctx);
        await sleep(600);
        await shoot(ptab, 'planner-chips-dark-390');
        await ptab.click('#module-frame >>> .sdk-file-chip', 'Map.png');
        const wins = await until(ptab, WINS, (v) => v === 1, 8000);
        if (wins !== 1) fail('on a phone a click on a chip did not open the window');
        await sleep(900);
        const sheet = await ptab.eval(`(() => { const w = document.querySelector('.fv-win'); const r = w.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight }; })()`);
        if (sheet.w < sheet.vw - 2) fail(`on a phone the file window is ${sheet.w} wide in a ${sheet.vw} wide screen, not a full-screen sheet`);
        await shoot(ptab, 'planner-file-window-dark-390');
        say(`phone, 390: the window is a sheet ${sheet.w} x ${sheet.h}`);
      } finally { await ptab.close(); }
    }
  } finally {
    try { if (browser) { browser.cdp.ws.close(); browser.child.kill(); fs.rmSync(browser.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } } catch { /* best effort */ }
    if (server) await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  return failures.length ? 1 : 0;
}

const code = await main().catch((err) => { console.error(err); return 1; });
for (const m of failures) console.error('check-vault-link-live: FAIL ' + m);
if (!code) say('OK');
process.exit(code);
