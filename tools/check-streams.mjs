// check-streams.mjs: a space's Workspace keeps few event streams open, and its windows load over plain HTTP/1.1 (health audit
// MP-01; Thomas, 2026-11-02: window frames share the page's stream). Browsers allow six connections to one site over HTTP/1.1;
// each open event stream holds one for good, so with the notifications stream, the live stream, the page's module streams and a
// stream per window frame (the Map's /map?space=<id>&from=space, the Calendar's /calendar?...), every other request queued and
// the Map window never finished loading. A window frame on the Workspace now hears its module events from the page
// (public/module-host.js, the stream relay) and opens no stream of its own.
// Measured in the running product (headless Chromium over the DevTools protocol, the screenshot seed, a stand-in map file so the
// Map window is on), on plain HTTP/1.1 (the throwaway server speaks nothing else):
//   1. The Workspace with the default layout (the Map and Calendar windows) holds at most 3 open event streams, counted from
//      the browser's own network events (every EventSource the page and its frames opened and that has not ended).
//   2. Both windows finish loading within 10 s: the Map window's place list and the Calendar window's events are drawn, and no
//      request of the page or its frames is left waiting.
//   3. A change from a second session reaches a window frame: a place sam saves through the API appears in the Map window's
//      list within a few seconds (the frame heard it from the page's stream).
//   4. The page's relay stops when the window closes: the Map window closed, the streams it needed and only those are left.
//   5. A standalone /map?space=<id> (not in a frame) still opens its own stream and hears the same change.
// Before those, without a browser:
//   A. public/module-stream.js against a stand-in EventSource and clock: the plan (the page's view and one space on one
//      connection), a move from one connection to another that misses nothing and hands nothing on twice, a refusal, and
//      the relay: only the frame's own space and guest, only from the frame's window and this origin, a new page in the
//      frame starts over, leaving and closing the window let go of everything.
//   B. The server (the seeded throwaway one): GET /api/modules/stream?space=<id>&page=1 carries the space's view and the
//      page's (`view: 'page'`) on one connection, each event with the same `id:` as on the streams of their own.
// Usage: node tools/check-streams.mjs. With no Chromium the browser part says SKIPPED (a skip, never a pass); A and B still run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

// public/module-stream.js is a browser module (no package type here): read through a copy named .mjs.
const STREAM_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'streams-unit-'));
fs.copyFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'module-stream.js'), path.join(STREAM_TMP, 'module-stream.mjs'));
const { streamPlan, moduleStreamUrl, createStreamHub, createStreamRelay, createStreamRelayClient } = await import(pathToFileURL(path.join(STREAM_TMP, 'module-stream.mjs')).href);
fs.rmSync(STREAM_TMP, { recursive: true, force: true });

const say = (...a) => console.log('check-streams:', ...a);
const failures = [];
const MAX_STREAMS = 3;
const LOAD_MS = 10000;

// --- A. module-stream.js on its own ------------------------------------------------------------------------------------
function unitChecks() {
  const sources = [];
  class FakeES {
    constructor(url) { this.url = url; this.readyState = 0; this.on = new Map(); this.closed = false; sources.push(this); }
    addEventListener(type, fn) { if (!this.on.has(type)) this.on.set(type, []); this.on.get(type).push(fn); }
    close() { this.closed = true; this.readyState = 2; }
    fire(type, ev = {}) { for (const fn of this.on.get(type) || []) fn(ev); }
    opened() { this.readyState = 1; this.fire('open'); }
    send(type, data, id) { this.fire(type, { data: JSON.stringify(data), lastEventId: id === undefined ? '' : String(id) }); }
    refuse() { this.readyState = 2; this.fire('error'); }
  }
  let timers = [];
  const schedule = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const cancel = (t) => { if (timers[t - 1]) timers[t - 1].fn = null; };
  const run = () => { while (timers.some((t) => t.fn && t.ms === 0)) for (const t of timers) if (t.fn && t.ms === 0) { const f = t.fn; t.fn = null; f(); } };
  const live = () => sources.filter((s) => !s.closed).map((s) => s.url);

  // The plan.
  assert.deepEqual(streamPlan(new Set([''])), [{ space: null, page: false }], 'the page alone');
  assert.deepEqual(streamPlan(new Set(['', 's1'])), [{ space: 's1', page: true }], 'the page and a space: one connection');
  assert.deepEqual(streamPlan(new Set(['s1', 's2', '']), 's2'), [{ space: 's2', page: true }, { space: 's1', page: false }], 'the one kept rides on');
  assert.deepEqual(streamPlan(new Set(['s1'])), [{ space: 's1', page: false }]);
  assert.equal(moduleStreamUrl({ space: 's1', page: true, guest: 'g' }), '/api/modules/stream?space=s1&page=1&guest=g');
  assert.equal(moduleStreamUrl({}), '/api/modules/stream?', 'the page view alone keeps its address');

  // Home, then into a space: one connection at a time, the new one open before the old one goes, each event once.
  const hub = createStreamHub({ EventSourceImpl: FakeES, schedule, cancel });
  const dash = [];
  const canvas = [];
  hub.join(null, null, (t, d) => dash.push([t, d]));
  run();
  assert.deepEqual(live(), ['/api/modules/stream?'], 'Home: the page view');
  sources[0].opened();
  sources[0].send('change', { key: 'a', scope: 'environment' }, 1);
  const leaveCanvas = hub.join('s1', null, (t, d) => canvas.push([t, d]));
  run();
  assert.deepEqual(live(), ['/api/modules/stream?', '/api/modules/stream?space=s1&page=1'], 'the new connection opens beside the old one');
  sources[0].send('change', { key: 'b', scope: 'environment' }, 2);
  sources[1].send('change', { key: 'b', scope: 'environment', view: 'page' }, 2); // the same thing, on both
  sources[1].opened();
  assert.deepEqual(live(), ['/api/modules/stream?space=s1&page=1'], 'the old one goes once the new one is open');
  sources[1].send('change', { key: 'c', scope: 'space', spaceId: 's1' }, 3);
  sources[1].send('change', { key: 'c', scope: 'spaces', spaceId: 's1', view: 'page' }, 3);
  assert.deepEqual(dash.map(([, d]) => d.key), ['a', 'b', 'c'], 'the page view: everything once');
  assert.ok(dash.every(([, d]) => !('view' in d)), 'the label is not handed on');
  assert.deepEqual(canvas.map(([, d]) => [d.key, d.scope]), [['c', 'space']], 'the space view: only its own');
  // Back Home: the page view alone again, nothing missed meanwhile.
  leaveCanvas();
  run();
  assert.equal(live().length, 2, 'Home again: a page-only connection opens beside');
  sources[1].send('change', { key: 'd', scope: 'environment', view: 'page' }, 4);
  sources[2].opened();
  sources[2].send('change', { key: 'd', scope: 'environment' }, 4);
  assert.deepEqual(live(), ['/api/modules/stream?']);
  assert.deepEqual(dash.map(([, d]) => d.key), ['a', 'b', 'c', 'd']);
  assert.equal(canvas.length, 1, 'a view left hears nothing more');
  // Leaving and joining in the same turn keeps the connection.
  const before = sources.length;
  const again = hub.join('s1', null, () => {});
  again();
  run();
  assert.equal(sources.length, before, 'a join and leave in one turn open nothing');
  // A refusal (no such space): the page view gets a connection of its own; the space is not asked again.
  const leaveGone = hub.join('gone', null, () => {});
  run();
  const combined = sources[sources.length - 1];
  assert.equal(combined.url, '/api/modules/stream?space=gone&page=1');
  combined.refuse();
  run();
  assert.deepEqual(live(), ['/api/modules/stream?'], 'the page view on its own again, the space not asked again');
  leaveGone();
  run();
  // Everyone gone: nothing open.
  const solo = createStreamHub({ EventSourceImpl: FakeES, schedule, cancel });
  const leaveSolo = solo.join('s9', 'tok', () => {});
  run();
  assert.equal(sources[sources.length - 1].url, '/api/modules/stream?space=s9&guest=tok', 'a guest: its token on the address');
  leaveSolo();
  run();
  assert.equal(sources[sources.length - 1].closed, true, 'the last to leave closes it');
  assert.deepEqual(solo.connections(), []);

  // The relay: a frame hears only its own space, from its own page, and lets go when told or closed.
  const listeners = (w) => { w.handlers = []; w.addEventListener = (t, fn) => { if (t === 'message') w.handlers.push(fn); }; w.removeEventListener = (t, fn) => { w.handlers = w.handlers.filter((f) => f !== fn); }; return w; };
  const ORIGIN = 'http://site.test';
  const pageWin = listeners({});
  const toFrame = [];
  const frameWin = { postMessage: (m, o) => toFrame.push([m, o]) };
  const frame = { contentWindow: frameWin };
  const joined = [];
  const relayHub = { join: (space, guest, fn) => { const sub = { space, guest, fn, left: false }; joined.push(sub); return () => { sub.left = true; }; } };
  const stop = createStreamRelay({ win: pageWin, frame, origin: ORIGIN, allow: () => ({ space: 's1', guest: null }), join: relayHub.join });
  const say2 = (data, source = frameWin, origin = ORIGIN) => { for (const fn of [...pageWin.handlers]) fn({ data, source, origin }); };
  assert.equal(toFrame[0][0].type, 'app:streamhello', 'the relay says hello to a frame already there');
  say2({ type: 'app:streamjoin', doc: 'd1', sub: 's1', space: 's1', guest: null });
  assert.equal(joined.length, 1, 'its own space: joined');
  assert.deepEqual(toFrame.at(-1), [{ type: 'app:streamjoined', doc: 'd1', sub: 's1', ok: true }, ORIGIN], 'answered to this origin only');
  joined[0].fn('change', { key: 'x' });
  assert.deepEqual(toFrame.at(-1), [{ type: 'app:streamevent', doc: 'd1', sub: 's1', event: 'change', data: { key: 'x' } }, ORIGIN], 'an event goes to the frame as it came');
  say2({ type: 'app:streamjoin', doc: 'd1', sub: 's2', space: 'other', guest: null });
  say2({ type: 'app:streamjoin', doc: 'd1', sub: 's3', space: 's1', guest: 'someone-else' });
  say2({ type: 'app:streamjoin', doc: 'd1', sub: 's4', space: null, guest: null });
  assert.equal(joined.length, 1, 'another space, another guest token or the page view: refused');
  assert.equal(toFrame.at(-1)[0].ok, false);
  assert.equal(toFrame.at(-1)[0].error, 'this window may hear only the events of its own space');
  say2({ type: 'app:streamjoin', doc: 'd1', sub: 's5', space: 's1', guest: null }, {}, ORIGIN);
  say2({ type: 'app:streamjoin', doc: 'd1', sub: 's6', space: 's1', guest: null }, frameWin, 'http://evil.test');
  say2({ type: 'app:streamjoin', doc: 'bad doc!', sub: 's7', space: 's1', guest: null });
  assert.equal(joined.length, 1, 'another window, another origin or a malformed message: not heard');
  say2({ type: 'app:streamjoin', doc: 'd2', sub: 's1', space: 's1', guest: null });
  assert.equal(joined[0].left, true, 'a new page in the frame: the old page\'s go');
  assert.equal(joined.length, 2);
  say2({ type: 'app:streamjoin', doc: 'd2', sub: 's2', space: 's1', guest: null });
  say2({ type: 'app:streamleave', doc: 'd2', sub: 's1' });
  assert.deepEqual(joined.slice(1).map((j) => j.left), [true, false], 'one left');
  say2({ type: 'app:streamleave', doc: 'd2', sub: '*' });
  assert.equal(joined[2].left, true, 'the page going: all of its go');
  say2({ type: 'app:streamjoin', doc: 'd3', sub: 's1', space: 's1', guest: null });
  stop();
  assert.equal(joined[3].left, true, 'the window closed: everything goes');
  assert.equal(pageWin.handlers.length, 0, 'and the page stops listening');

  // The frame's side: joins through the page, hears only its page, asks again after the relay's hello.
  const parent = { posted: [], postMessage(m, o) { this.posted.push([m, o]); } };
  const self = { handlers: {}, addEventListener(t, fn) { (this.handlers[t] ||= []).push(fn); } };
  timers = [];
  const client = createStreamRelayClient({ parent, self, origin: ORIGIN, schedule, cancel });
  const heard = [];
  const leave = client.join('s1', null, (t, d) => heard.push([t, d]));
  const ask = parent.posted.at(-1);
  assert.equal(ask[1], ORIGIN);
  assert.equal(ask[0].type, 'app:streamjoin');
  assert.equal(ask[0].space, 's1');
  const doc = ask[0].doc;
  const tell = (data, source = parent, origin = ORIGIN) => { for (const fn of self.handlers.message) fn({ data, source, origin }); };
  tell({ type: 'app:streamjoined', doc, sub: ask[0].sub, ok: true });
  tell({ type: 'app:streamevent', doc, sub: ask[0].sub, event: 'change', data: { key: 'y' } });
  tell({ type: 'app:streamevent', doc, sub: ask[0].sub, event: 'change', data: { key: 'no' } }, {}, ORIGIN);
  tell({ type: 'app:streamevent', doc, sub: ask[0].sub, event: 'change', data: { key: 'no' } }, parent, 'http://evil.test');
  tell({ type: 'app:streamevent', doc: 'other', sub: ask[0].sub, event: 'change', data: { key: 'no' } });
  tell({ type: 'app:streamevent', doc, sub: ask[0].sub, event: 'nonsense', data: { key: 'no' } });
  assert.deepEqual(heard, [['change', { key: 'y' }]], 'only its page, its origin, its document and the stream\'s own event types');
  const count = parent.posted.length;
  tell({ type: 'app:streamhello' });
  assert.equal(parent.posted.length, count + 1, 'the relay made again: it joins again');
  for (const fn of self.handlers.pagehide) fn({});
  assert.deepEqual(parent.posted.at(-1)[0], { type: 'app:streamleave', sub: '*', doc }, 'going: says so');
  leave();
  assert.deepEqual(parent.posted.at(-1)[0], { type: 'app:streamleave', sub: ask[0].sub, doc });
  say('module-stream.js: the plan, the move between connections, a refusal and the relay hold');
}

// --- B. the server's combined stream -----------------------------------------------------------------------------------
function rawStream(base, urlPath, cookie) {
  const u = new URL(base);
  const got = { events: [], status: 0 };
  let buf = '';
  const req = http.request({ host: u.hostname, port: u.port, path: urlPath, headers: { cookie, accept: 'text/event-stream' } }, (res) => {
    got.status = res.statusCode;
    res.on('data', (c) => {
      buf += c;
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const part of parts) {
        const event = /^event: (.+)$/m.exec(part)?.[1];
        const data = /^data: (.+)$/m.exec(part)?.[1];
        const id = /^id: (.+)$/m.exec(part)?.[1];
        if (event && data) got.events.push({ event, id, data: JSON.parse(data) });
      }
    });
    res.on('error', () => {});
  });
  req.on('error', () => {});
  req.end();
  got.close = () => req.destroy();
  return got;
}
async function serverChecks(S, jar, api) {
  const both = rawStream(S.base, `/api/modules/stream?space=${S.ctx.trip}&page=1`, jar('mia'));
  const spaceOnly = rawStream(S.base, `/api/modules/stream?space=${S.ctx.trip}`, jar('mia'));
  const pageOnly = rawStream(S.base, '/api/modules/stream', jar('mia'));
  await sleep(400);
  assert.deepEqual([both.status, spaceOnly.status, pageOnly.status], [200, 200, 200]);
  const w1 = await api('sam', 'PUT', `/api/modules/places/data/${encodeURIComponent('place:streamraw')}?scope=space&space=${S.ctx.trip}`, { value: { title: 'Raw stream place', owners: [] } });
  assert.equal(w1.status, 200, JSON.stringify(w1.json));
  await sleep(500);
  const pick = (s) => s.events.filter((e) => e.event === 'change' && e.data.key === 'place:streamraw');
  const [inSpace] = pick(spaceOnly);
  const [inPage] = pick(pageOnly);
  const inBoth = pick(both);
  assert.ok(inSpace && inPage, 'each stream of its own heard the change');
  assert.equal(inSpace.data.scope, 'space');
  assert.equal(inPage.data.scope, 'spaces');
  assert.equal(inBoth.length, 2, 'the combined stream: once for each view');
  assert.deepEqual(inBoth.map((e) => [e.data.scope, e.data.view]), [['space', undefined], ['spaces', 'page']], 'the page view\'s labelled, the space\'s as before');
  assert.ok(inSpace.id && inBoth.every((e) => e.id === inSpace.id) && inPage.id === inSpace.id, 'the same id on every stream for the same change');
  const lone = rawStream(S.base, '/api/modules/stream?page=1', jar('mia'));
  await sleep(300);
  assert.equal(lone.status, 200, 'page without a space: the page view, as before');
  for (const s of [both, spaceOnly, pageOnly, lone]) s.close();
  say('server: ?space=<id>&page=1 carries both views, the page\'s labelled, with the same ids as the streams of their own');
}

// The browser's own count of the event streams a tab holds open: every EventSource request (the page's and its frames', which
// share the tab's session) that has not finished or failed. `pending()` lists the other requests still waiting.
function watchNetwork(tab) {
  const open = new Map(); // requestId -> url
  const waiting = new Map(); // requestId -> { url, at }
  const hook = (m) => {
    if (m.sessionId !== tab.sid) return;
    const p = m.params || {};
    if (m.method === 'Network.requestWillBeSent') {
      if (p.type === 'EventSource') open.set(p.requestId, p.request.url);
      else if (/^https?:/.test(p.request.url)) waiting.set(p.requestId, { url: p.request.url, at: Date.now() });
    } else if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') {
      open.delete(p.requestId);
      waiting.delete(p.requestId);
    }
  };
  tab.cdp.listeners.push(hook);
  return {
    streams: () => [...open.values()].map((u) => new URL(u).pathname + new URL(u).search),
    pending: (olderThan) => [...waiting.values()].filter((w) => Date.now() - w.at > olderThan).map((w) => new URL(w.url).pathname),
    stop: () => { tab.cdp.listeners = tab.cdp.listeners.filter((f) => f !== hook); },
  };
}

// In a window frame on the Workspace (iframe.composite-frame whose page is `path`), or in the page itself (`path` null): the
// text of every row the bundled modules drew there, searched through their shadow roots.
const ROWS = (where, sel) => `(() => {
  let d = document;
  if (${JSON.stringify(where)}) { const f = [...document.querySelectorAll('iframe.composite-frame')].find((x) => { try { return x.contentWindow.location.pathname === ${JSON.stringify(where)}; } catch { return false; } }); if (!f || !f.contentDocument) return null; d = f.contentDocument; }
  const roots = [d]; (function walk(r) { for (const x of r.querySelectorAll('*')) if (x.shadowRoot) { roots.push(x.shadowRoot); walk(x.shadowRoot); } })(d);
  const out = []; for (const r of roots) for (const e of r.querySelectorAll(${JSON.stringify(sel)})) if (e.getClientRects().length) out.push(e.textContent.replace(/\\s+/g, ' ').trim());
  return out; })()`;
const until = async (tab, expr, test, ms) => {
  const end = Date.now() + ms;
  let last = null;
  while (Date.now() < end) { last = await tab.eval(expr).catch(() => null); if (test(last)) return { ok: true, value: last }; await sleep(150); }
  return { ok: false, value: last };
};

async function main() {
  try { unitChecks(); } catch (err) { failures.push(`module-stream.js: ${err.message}`); }
  const bin = findBrowser();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'streams-data-'));
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    const jar = (who) => S.cookies[who].map((c) => `${c.name}=${c.value}`).join('; ');
    const api = async (who, method, url, body) => {
      const r = await fetch(S.base + url, { method, headers: { cookie: jar(who), 'content-type': 'application/json', accept: 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      let json = null; try { json = await r.json(); } catch { /* none */ }
      return { status: r.status, json };
    };
    // A map file, so the Map window is on (a stand-in: the map is not drawn, the place list is).
    const tiles = path.join(dataDir, 'modules', 'maps', 'map-tiles');
    fs.mkdirSync(tiles, { recursive: true });
    fs.writeFileSync(path.join(tiles, 'world.pmtiles'), Buffer.from('PMTiles stand-in, not a real map'));
    const ticked = await api('admin', 'PUT', '/api/modules/maps/settings/environment', { values: { map: ['world.pmtiles'] } });
    if (ticked.status !== 200) throw new Error(`ticking the map file answered ${ticked.status}: ${JSON.stringify(ticked.json)}`);
    try { await serverChecks(S, jar, api); } catch (err) { failures.push(`the server's stream: ${err.message}`); }
    if (!bin) {
      say('browser part SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; the Workspace was not measured.');
      return finish(' (module-stream.js and the server only; the browser part was skipped)');
    }
    browser = await launch(bin);

    // 1-4. The Workspace, as mia, with the default layout.
    {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(1280, 'light', true);
      const net = watchNetwork(tab);
      try {
        const started = Date.now();
        await driveScreen(tab, { id: 'workspace', as: 'mia', url: '/#join={trip}' }, S.base, S.cookies, S.ctx);
        const map = await until(tab, ROWS('/map', '.place-row'), (v) => Array.isArray(v) && v.length > 0, LOAD_MS);
        const mapMs = Date.now() - started;
        const cal = await until(tab, ROWS('/calendar', '#body [data-open]'), (v) => Array.isArray(v) && v.length > 0, Math.max(500, LOAD_MS - mapMs));
        const calMs = Date.now() - started;
        if (!map.ok) failures.push(`the Map window's place list was not drawn within ${LOAD_MS / 1000} s (${map.value === null ? 'no Map window' : `${map.value.length} rows`})`);
        if (!cal.ok) failures.push(`the Calendar window's events were not drawn within ${LOAD_MS / 1000} s (${cal.value === null ? 'no Calendar window' : `${cal.value.length} events`})`);
        say(`Map window: ${map.ok ? `${map.value.length} places drawn after ${(mapMs / 1000).toFixed(1)} s` : 'not loaded'}; Calendar window: ${cal.ok ? `${cal.value.length} events drawn after ${(calMs / 1000).toFixed(1)} s` : 'not loaded'}`);
        await sleep(1500);
        const stuck = net.pending(5000);
        if (stuck.length) failures.push(`${stuck.length} requests waited over 5 s and never returned: ${[...new Set(stuck)].slice(0, 6).join(', ')}`);
        const streams = net.streams();
        say(`open event streams on the Workspace: ${streams.length} (${streams.join(', ')})`);
        if (streams.length > MAX_STREAMS) failures.push(`the Workspace holds ${streams.length} event streams open, over ${MAX_STREAMS}: ${streams.join(', ')}`);
        if (streams.some((u) => u.startsWith('/api/modules/stream') && u.includes('from='))) failures.push('a window frame opened a stream of its own');

        // 3. sam saves a place in the trip; it reaches the Map window's list.
        if (map.ok) {
          const title = 'Stream check viewpoint';
          const put = await api('sam', 'PUT', `/api/modules/places/data/${encodeURIComponent('place:streamcheck1')}?scope=space&space=${S.ctx.trip}`, { value: { title, address: '', notes: '', owners: [], point: { lat: 38.7139, lng: -9.1334 } } });
          if (put.status !== 200) failures.push(`sam could not save a place through the API (${put.status}: ${JSON.stringify(put.json)})`);
          const t0 = Date.now();
          const seen = await until(tab, ROWS('/map', '.place-row'), (v) => Array.isArray(v) && v.some((x) => x.includes(title)), 5000);
          if (!seen.ok) failures.push('a place sam saved did not reach the Map window\'s list within 5 s (the frame did not hear the page\'s stream)');
          say(`a place saved by a second session: ${seen.ok ? `in the Map window after ${((Date.now() - t0) / 1000).toFixed(1)} s` : 'never reached the Map window'}`);
        }

        // 4. The Map window closed: what it needed goes with it, nothing else.
        const closed = await tab.eval(`(() => { const f = [...document.querySelectorAll('iframe.composite-frame')].find((x) => { try { return x.contentWindow.location.pathname === '/map'; } catch { return false; } }); const w = f && f.closest('.module-floating, .mf, [data-module-id]'); const b = w && w.querySelector('button[aria-label^="Close"]'); if (!b) return false; b.click(); return true; })()`);
        if (closed) {
          await sleep(1500);
          const after = net.streams();
          say(`after closing the Map window: ${after.length} open (${after.join(', ')})`);
          if (after.length > streams.length) failures.push(`closing the Map window left more streams open (${after.length}) than before (${streams.length})`);
          const stillMap = await tab.eval(`[...document.querySelectorAll('iframe.composite-frame')].some((x) => { try { return x.contentWindow.location.pathname === '/map'; } catch { return false; } })`);
          if (stillMap) failures.push('the Map window did not close');
        } else say('no Close button found on the Map window; step 4 not measured');
      } finally { net.stop(); await tab.close(); }
    }

    // 5. A standalone /map?space=<id>: its own stream, and the change still reaches it.
    {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(1280, 'light', false);
      const net = watchNetwork(tab);
      try {
        await driveScreen(tab, { id: 'map', as: 'mia', url: '/map?space={trip}' }, S.base, S.cookies, S.ctx);
        const map = await until(tab, ROWS(null, '.place-row'), (v) => Array.isArray(v) && v.length > 0, LOAD_MS);
        const streams = net.streams();
        say(`standalone /map?space: ${map.ok ? `${map.value.length} places` : 'not loaded'}, ${streams.length} open streams (${streams.join(', ')})`);
        if (!map.ok) failures.push('the standalone Map page did not draw its place list');
        if (!streams.some((u) => u.startsWith('/api/modules/stream'))) failures.push('the standalone Map page opened no module stream of its own');
        const title = 'Stream check harbour';
        await api('sam', 'PUT', `/api/modules/places/data/${encodeURIComponent('place:streamcheck2')}?scope=space&space=${S.ctx.trip}`, { value: { title, address: '', notes: '', owners: [], point: { lat: 38.705, lng: -9.145 } } });
        const seen = await until(tab, ROWS(null, '.place-row'), (v) => Array.isArray(v) && v.some((x) => x.includes(title)), 5000);
        if (!seen.ok) failures.push('a place sam saved did not reach the standalone Map page within 5 s');
      } finally { net.stop(); await tab.close(); }
    }
  } finally {
    try { if (browser) { browser.cdp.ws.close(); browser.child.kill(); fs.rmSync(browser.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } } catch { /* best effort */ }
    if (server) await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  return finish();
}
function finish(note = '') {
  if (failures.length) { for (const f of failures) say('FAIL', f); return 1; }
  say(`ok${note}`);
  return 0;
}
process.exit(await main());
