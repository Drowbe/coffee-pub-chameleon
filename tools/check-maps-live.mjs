// check-maps-live.mjs: Maps (the map and its list) in the running product (headless Chromium, the screenshot seed), each rule at the
// size where it once broke (the health audit of Maps and Places, before they were one module, MP-02, MP-03, MP-07, MP-08, MP-21).
//   1. The "+" on the Map page at a phone's and a narrow window's width opens Places' dialog where it can be seen: a box with a
//      width and a height (it opened inside the list part, which a narrow width hides, so the page froze behind nothing).
//   2. Places reads what points at its places in one request, not one per place.
//   3. The Itinerary tells the host what its cards point at: the seeded plan card that points at a place shows in that place's
//      backlinks once the Itinerary has been open (GET /api/objects/links), so Places can say "Used by" and warn before a delete.
//   4. A member whose role may not edit places is not shown the "+" on the Map page (it did nothing, silently).
//   5. The search field's words fit its field: short enough to be read whole.
//   6. The window (plan-places-and-maps.md, J2). With no map file the list is Maps' main view, with a short notice that a map needs a
//      file, and a place can be added with no map (no position, or one typed). With a map file the list sits beside the map when the
//      window is wide, and a List | Map switch shows one at a time when it is narrow. The list is there once.
// Usage: node tools/check-maps-live.mjs. With no Chromium it says SKIPPED and exits 0 (a skip, never a pass).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

const say = (...a) => console.log('check-maps-live:', ...a);
const failures = [];

// A whole PMTiles v3 vector file with no tiles in it: the map draws its background and the pins, which is all these rules need.
function emptyMap() {
  const dir = zlib.gzipSync(Buffer.from([0])); // no entries
  const head = Buffer.alloc(127);
  head.write('PMTiles', 0, 'ascii'); head.writeUInt8(3, 7);
  head.writeBigUInt64LE(127n, 8); head.writeBigUInt64LE(BigInt(dir.length), 16);
  head.writeBigUInt64LE(BigInt(127 + dir.length), 56);
  head.writeUInt8(1, 97); head.writeUInt8(2, 98); head.writeUInt8(1, 99); head.writeUInt8(0, 100); head.writeUInt8(6, 101);
  [-10, 36, 0, 42].forEach((d, i) => head.writeInt32LE(Math.round(d * 1e7), 102 + i * 4));
  return Buffer.concat([head, dir]);
}

const ROOTS = `const roots = []; (function walk(r) { roots.push(r); for (const x of r.querySelectorAll('*')) if (x.shadowRoot) walk(x.shadowRoot); })(document);`;
// The open dialog's box (the editor window), searched through every shadow root.
const DIALOG = `(() => { ${ROOTS} for (const r of roots) for (const d of r.querySelectorAll('dialog')) if (d.open) { const b = d.getBoundingClientRect(); return { id: d.id, w: Math.round(b.width), h: Math.round(b.height) }; } return null; })()`;
const PLUS = `(() => { ${ROOTS} for (const r of roots) for (const b of r.querySelectorAll('button[aria-label="Add a place"]')) if (b.getClientRects().length) return true; return false; })()`;
const WIN = `(() => { const r = document.getElementById('module-frame') && document.getElementById('module-frame').shadowRoot; if (!r) return null; const q = (s) => r.querySelector(s); const box = (e) => { if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height) }; }; const win = q('#window'); if (!win) return null; return { mode: win.dataset.mode, list: box(q('#list-view')), map: box(q('#map-view')), lists: r.querySelectorAll('#list-app').length, rows: r.querySelectorAll('.place-row').length, nopos: [...r.querySelectorAll('.place-row .nopos')].filter((e) => e.getClientRects().length).length, pinned: [...r.querySelectorAll('.place-row .pinned')].filter((e) => e.getClientRects().length).length, notice: box(q('#list-nomap')) ? q('#list-nomap').textContent.trim().replace(/\\s+/g, ' ') : '', switches: [...document.querySelectorAll('.mf-switch-btn')].map((b) => b.textContent.trim()) }; })()`;
const FIELD = `(() => { ${ROOTS} for (const r of roots) for (const i of r.querySelectorAll('.mf-search input')) if (i.getClientRects().length) return { placeholder: i.placeholder, width: Math.round(i.getBoundingClientRect().width) }; return null; })()`;

async function open(browser, S, size, as, url, wait) {
  const tab = new Tab(browser.cdp, S.ctx);
  await tab.open(size, 'dark', false);
  const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
  const requests = [];
  const listener = (m) => { if (m.method === 'Network.requestWillBeSent' && m.sessionId === tab.sid) requests.push(`${m.params.request.method} ${m.params.request.url}`); };
  browser.cdp.listeners.push(listener);
  await driveScreen(tab, { id: 'map', as, url, wait }, S.base, S.cookies, S.ctx);
  await sleep(2500);
  return { tab, requests, done: () => { browser.cdp.listeners = browser.cdp.listeners.filter((f) => f !== listener); return tab.close(); } };
}

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maps-live-'));
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    const cookie = (who) => (S.cookies[who] || []).map((c) => `${c.name}=${c.value}`).join('; ');
    const api = async (method, url, body, who = 'admin') => {
      const r = await fetch(S.base + url, { method, headers: { 'content-type': 'application/json', cookie: cookie(who) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, json: await r.json().catch(() => null) };
    };
    // The Map on in the top bar, with a map file ticked (the Map page is not there without one).
    // The server reads the folder each time it is asked, so the file is simply put in the data folder (a map file is not uploaded).
    fs.mkdirSync(path.join(dataDir, 'modules', 'maps', 'map-tiles'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'modules', 'maps', 'map-tiles', 'empty.pmtiles'), emptyMap());
    const ticked = await api('PUT', '/api/modules/maps/settings/environment', { values: { map: ['empty.pmtiles'] } });
    if (ticked.status !== 200) throw new Error(`the map file could not be ticked: ${ticked.status} ${JSON.stringify(ticked.json)}`);
    const shown = await api('PATCH', '/api/settings', { showMap: true });
    if (shown.status !== 200) throw new Error(`the Map could not be turned on: ${shown.status}`);
    browser = await launch(bin);
    const url = '/map?space={trip}';
    const wait = '#dest-main';

    // 1 and 2. The "+" at 400 and 520 px; the links requests while the page loads.
    for (const size of [400, 520]) {
      const v = await open(browser, S, size, 'mia', url, wait);
      try {
        if (!(await v.tab.eval(PLUS))) { failures.push(`the Map page at ${size}px: no "Add a place" in the title bar for a member who may add`); continue; }
        const singles = v.requests.filter((r) => /^GET .*\/api\/objects\/links\?/.test(r));
        const batches = v.requests.filter((r) => /^POST .*\/api\/objects\/links\/batch/.test(r));
        if (singles.length || batches.length > 1) failures.push(`the Map page at ${size}px: Places asked what points at its places with ${singles.length} single requests and ${batches.length} batches (one batch, no singles)`);
        say(`Map page ${size}px: ${batches.length} backlinks batch, ${singles.length} single requests`);
        await v.tab.click('button[aria-label="Add a place"]');
        let box = null;
        for (let i = 0; i < 20 && !box; i += 1) { await sleep(250); box = await v.tab.eval(DIALOG); }
        if (!box) failures.push(`the Map page at ${size}px: "+" opened no dialog`);
        else if (box.w < 100 || box.h < 100) failures.push(`the Map page at ${size}px: "+" opened the dialog as a ${box.w}x${box.h} box (it is in a part the width hides)`);
        say(`Map page ${size}px: "+" opens ${box ? `${box.id} ${box.w}x${box.h}` : 'nothing'}`);
      } finally { await v.done(); }
    }

    // 5. The search field's words are short.
    {
      const v = await open(browser, S, 1280, 'mia', url, wait);
      try {
        const f = await v.tab.eval(FIELD);
        if (!f) failures.push('the Map page at 1280px: no search field in the row');
        else if (f.placeholder.length > 22) failures.push(`the search field says "${f.placeholder}" in ${f.width}px: too long to be read whole`);
        say(`search field: "${f && f.placeholder}" in ${f && f.width}px`);
      } finally { await v.done(); }
    }

    // 3. The Itinerary records what its cards point at. The seed's plan card a11 points at the place p1.
    const refOf = (id) => encodeURIComponent(JSON.stringify({ module: 'maps', kind: 'place', id, scope: 'space', space: S.ctx.trip }));
    const links = async () => (await api('GET', `/api/objects/links?from=maps&dir=to&ref=${refOf('p1')}`, undefined, 'mia')).json;
    const before = await links();
    const v3 = await open(browser, S, 1280, 'mia', '/modules/travel?space={trip}', '#module-frame >>> .day-add');
    try { await sleep(2500); } finally { await v3.done(); }
    const after = await links();
    const names = ((after && after.summaries) || []).map((x) => `${x.module && x.module.id}:${x.ref && x.ref.id}`);
    if (!names.some((n) => /^travel:/.test(n))) failures.push(`the place p1 shows no link from the Itinerary after it was opened (before: ${JSON.stringify(before && before.summaries && before.summaries.length)}, after: ${JSON.stringify(names)})`);
    say(`backlinks of p1: before ${((before && before.summaries) || []).length}, after ${names.join(', ') || 'none'}`);


    // 6a. With a map file, at the module's own page (the top bar's Map off, so the page is not the destination): wide, the list beside
    // the map; narrow, the List | Map switch.
    {
      const off = await api('PATCH', '/api/settings', { showMap: false });
      if (off.status !== 200) failures.push(`the Map could not be turned off: ${off.status}`);
      const wide = await open(browser, S, 1280, 'mia', '/modules/maps', '#module-frame >>> #window');
      try {
        const w = await wide.tab.eval(WIN);
        say(`window with a map file, 1280px: ${JSON.stringify(w)}`);
        if (!w || w.mode !== 'both' || !w.list || !w.map) failures.push(`the window with a map file at 1280px is not the list and the map side by side: ${JSON.stringify(w)}`);
        else if (w.list.x <= w.map.x || w.list.w < 200 || w.map.w < 300) failures.push(`the list is not beside the map at 1280px: ${JSON.stringify(w)}`);
        else if (w.lists !== 1) failures.push(`the list is mounted ${w.lists} times`);
        else if (w.switches.includes('Map')) failures.push('a wide window with a map file offers the List | Map switch');
        else if (w.notice) failures.push('the no-map notice is shown although there is a map file');
      } finally { await wide.done(); }
      const narrow = await open(browser, S, 390, 'mia', '/modules/maps', '#module-frame >>> #window');
      try {
        const n = await narrow.tab.eval(WIN);
        say(`window with a map file, 390px: ${JSON.stringify(n)}`);
        if (!n || n.mode !== 'list' || !n.list || n.map) failures.push(`the narrow window with a map file does not show the list alone first: ${JSON.stringify(n)}`);
        else if (!n.switches.includes('List') || !n.switches.includes('Map')) failures.push(`the narrow window has no List | Map switch: ${JSON.stringify(n.switches)}`);
        else {
          await narrow.tab.click('.mf-switch-btn', 'Map');
          await sleep(600);
          const m = await narrow.tab.eval(WIN);
          if (!m || m.mode !== 'map' || !m.map || m.list) failures.push(`the Map switch does not show the map alone: ${JSON.stringify(m)}`);
          await narrow.tab.click('.mf-switch-btn', 'List');
          await sleep(600);
          const l = await narrow.tab.eval(WIN);
          if (!l || l.mode !== 'list' || !l.list || l.map) failures.push(`the List switch does not show the list alone: ${JSON.stringify(l)}`);
          say(`narrow switch: Map -> ${m && m.mode}, List -> ${l && l.mode}`);
        }
      } finally { await narrow.done(); }
    }

    // 4. A member who may not edit places or the map is not shown the "+".
    const members = await api('PATCH', '/api/roles/member', { 'module.maps.edit': false }, 'admin');
    if (members.status !== 200) failures.push(`could not take the edit rights from the member role (${members.status})`);
    else {
      const v = await open(browser, S, 1280, 'sam', url, wait);
      try {
        const plus = await v.tab.eval(PLUS);
        if (plus) failures.push('the Map page shows "Add a place" to a member whose role may not edit places or the map');
        say(`a member who may not edit: the "+" is ${plus ? 'shown' : 'not shown'}`);
      } finally { await v.done(); await api('PATCH', '/api/roles/member', { 'module.maps.edit': true }, 'admin'); }
    }
  } finally {
    try { if (browser) { browser.cdp.ws.close(); browser.child.kill(); fs.rmSync(browser.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } } catch { /* best effort */ }
    if (server) await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  // 6b. No map file: the list is the main view and a place can be added with no map.
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'maps-live-nomap-'));
  let server2 = null; let browser2 = null;
  try {
    const boot2 = await bootSeeded('travel', dir2, await freePort());
    server2 = boot2.server;
    const S2 = { base: server2.base, ctx: boot2.ctx, cookies: boot2.cookies };
    browser2 = await launch(bin);
    for (const size of [1280, 390]) {
      const v = await open(browser2, S2, size, 'mia', '/modules/maps?space={trip}', '#module-frame >>> #window');
      try {
        const w = await v.tab.eval(WIN);
        say(`window with no map file, ${size}px: ${JSON.stringify(w)}`);
        if (!w || w.mode !== 'list' || !w.list || w.map) failures.push(`with no map file the list is not Maps' main view at ${size}px: ${JSON.stringify(w)}`);
        else if (!/^No map yet\./.test(w.notice) || !/ticks a map file in Manage/.test(w.notice)) failures.push(`the no-map notice reads "${w.notice}" at ${size}px`);
        else if (w.rows < 1) failures.push(`the list shows no places at ${size}px`);
        else if (w.switches.includes('Map')) failures.push('a window with no map file offers a Map switch');
        else if (!(await v.tab.eval(PLUS))) failures.push(`no "Add a place" with no map file at ${size}px`);
        if (size !== 1280 || !w) continue;
        // A place with no position, then one with a typed position; neither needs a map.
        let rows = w.rows;
        for (const [title, point] of [['Plain place', ''], ['Typed place', '38.7139, -9.1394']]) {
          await v.tab.click('button[aria-label="Add a place"]');
          let box = null;
          for (let i = 0; i < 20 && !box; i += 1) { await sleep(250); box = await v.tab.eval(DIALOG); }
          if (!box || box.w < 100 || box.h < 100) { failures.push(`"+" opened no dialog with no map file (${JSON.stringify(box)})`); break; }
          const pick = await v.tab.eval(`(() => { const r = document.getElementById('module-frame').shadowRoot; const b = r.getElementById('f-pick'); return !b || !b.getClientRects().length; })()`);
          if (!pick) failures.push('the dialog offers "pick the position on the map" with no map');
          await v.tab.typeInto('#module-frame >>> #f-title', title);
          if (point) await v.tab.typeInto('#module-frame >>> #f-point', point);
          await v.tab.click('#module-frame >>> #f-save');
          let after = null;
          for (let i = 0; i < 20; i += 1) { await sleep(300); after = await v.tab.eval(WIN); if (after && after.rows > rows) break; }
          if (!after || after.rows !== rows + 1) { failures.push(`"${title}" was not added with no map file (rows ${rows} -> ${after && after.rows})`); break; }
          rows = after.rows;
          say(`added "${title}" with no map file: ${rows} places, ${after.nopos} with no position, ${after.pinned} with one`);
          if (point && after.pinned < 1) failures.push('the place with a typed position does not say it has one');
          if (!point && after.nopos < 1) failures.push('the place with no position does not say so');
        }
      } finally { await v.done(); }
    }
  } finally {
    try { if (browser2) { browser2.cdp.ws.close(); browser2.child.kill(); fs.rmSync(browser2.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } } catch { /* best effort */ }
    if (server2) await stopServer(server2);
    fs.rmSync(dir2, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  if (failures.length) { for (const f of failures) say('FAIL', f); return 1; }
  say('ok');
  return 0;
}
process.exit(await main());
