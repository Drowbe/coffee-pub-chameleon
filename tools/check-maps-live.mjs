// check-maps-live.mjs: the Maps and Places pair in the running product (headless Chromium, the screenshot seed), each rule at the
// size where it once broke (the health audit of Maps and Places, MP-02, MP-03, MP-07, MP-08, MP-21).
//   1. The "+" on the Map page at a phone's and a narrow window's width opens Places' dialog where it can be seen: a box with a
//      width and a height (it opened inside the list part, which a narrow width hides, so the page froze behind nothing).
//   2. Places reads what points at its places in one request, not one per place.
//   3. The Itinerary tells the host what its cards point at: the seeded plan card that points at a place shows in that place's
//      backlinks once the Itinerary has been open (GET /api/objects/links), so Places can say "Used by" and warn before a delete.
//   4. A member whose role may not edit places is not shown the "+" on the Map page (it did nothing, silently).
//   5. The search field's words fit its field: short enough to be read whole.
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
    const refOf = (id) => encodeURIComponent(JSON.stringify({ module: 'places', kind: 'place', id, scope: 'space', space: S.ctx.trip }));
    const links = async () => (await api('GET', `/api/objects/links?from=places&dir=to&ref=${refOf('p1')}`, undefined, 'mia')).json;
    const before = await links();
    const v3 = await open(browser, S, 1280, 'mia', '/modules/travel?space={trip}', '#module-frame >>> .day-add');
    try { await sleep(2500); } finally { await v3.done(); }
    const after = await links();
    const names = ((after && after.summaries) || []).map((x) => `${x.module && x.module.id}:${x.ref && x.ref.id}`);
    if (!names.some((n) => /^travel:/.test(n))) failures.push(`the place p1 shows no link from the Itinerary after it was opened (before: ${JSON.stringify(before && before.summaries && before.summaries.length)}, after: ${JSON.stringify(names)})`);
    say(`backlinks of p1: before ${((before && before.summaries) || []).length}, after ${names.join(', ') || 'none'}`);

    // 4. A member who may not edit places or the map is not shown the "+".
    const members = await api('PATCH', '/api/roles/member', { 'module.places.edit': false, 'module.maps.edit': false }, 'admin');
    if (members.status !== 200) failures.push(`could not take the edit rights from the member role (${members.status})`);
    else {
      const v = await open(browser, S, 1280, 'sam', url, wait);
      try {
        const plus = await v.tab.eval(PLUS);
        if (plus) failures.push('the Map page shows "Add a place" to a member whose role may not edit places or the map');
        say(`a member who may not edit: the "+" is ${plus ? 'shown' : 'not shown'}`);
      } finally { await v.done(); await api('PATCH', '/api/roles/member', { 'module.places.edit': true, 'module.maps.edit': true }, 'admin'); }
    }
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
