#!/usr/bin/env node
/*
 * check-space-look.mjs -- the words and phases on a space's page (documentation/plans/plan-space-templates.md, step 2), in a real
 * browser against a throwaway seeded server with two spaces in one Travel environment: Lisbon (no template of its own) and Kyoto
 * (the Games template). No LiveKit. Covers:
 *   - words.js in node-free page terms: a space's look changes only the keys a space's template changes (the space, aside, canvas,
 *     module, object, moderator, member and guest words and the layout verb), never `environment`, `owner`, `home` or the enter verb,
 *     and it never reaches localStorage
 *   - the owner in Lisbon: the environment's words and six phases, exactly /api/branding's (a space with no template looks as before)
 *   - the owner in Kyoto: campaign words, no phase chip, and the environment's words in localStorage untouched
 *   - Home over a space, a move between the two spaces and leaving: the environment's words on Home, never the last space's words
 *   - a plain member (Mia, a member of Kyoto, not its moderator) and a moderator, read from GET /api/spaces/:id/look: the space's words
 *   - a person the server refuses a look (a member of Lisbon only, asking for Kyoto's): a 404 and the environment's words, no error shown
 *   - the Lobby and Home: the environment's words
 *   - a guest link and a door guest into Kyoto: the space's words once in (1280 and 390)
 *   - Set up's save sends only the phases the panel shows (a date for a phase the template lacks is never sent, never a change)
 *   - 1280 and 390 px wide; no horizontal overflow
 * With no Chromium it says SKIPPED (set CHROME_PATH); that is not a pass.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const { bootSeeded, stopServer, freePort, findBrowser, launch, Tab, sleep } = await import('./shots.mjs');

const bin = findBrowser();
if (!bin) {
  console.log('check-space-look: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.');
  process.exit(0);
}

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-space-look-'));
let server;
let browser;
const tabs = [];
try {
  const port = await freePort();
  const boot = await bootSeeded('travel', dataDir, port, { env: { ENABLE_GUEST_DOOR: 'true' } });
  server = boot.server;
  const { ctx, cookies } = boot;
  const jar = (as) => cookies[as].map((c) => `${c.name}=${c.value}`).join('; ');
  const api = async (method, url, body, as = 'admin') => {
    const r = await fetch(server.base + url, { method, headers: { 'content-type': 'application/json', cookie: jar(as) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json };
  };
  // Kyoto reads the Games template; Lisbon has no key. Dates for a Travel phase are set on Kyoto first, then it changes to Games,
  // so the server holds a date for a phase its template does not have.
  const branding = (await (await fetch(`${server.base}/api/branding`)).json());
  assert.equal(branding.words.space.one, 'trip');
  assert.equal(branding.phases.length, 6);
  const dated = await api('PATCH', `/api/spaces/${ctx.second}`, { phases: { [branding.phases[0].id]: { start: '2030-01-01' } } });
  assert.equal(dated.status, 200, JSON.stringify(dated.json));
  assert.equal((await api('PATCH', `/api/spaces/${ctx.second}`, { template: 'games' })).status, 200);
  const look = (await api('GET', `/api/spaces/${ctx.second}`)).json.look;
  assert.equal(look.words.space.one, 'campaign');
  assert.equal((await api('GET', `/api/spaces/${ctx.trip}`, undefined, 'sam')).status, 403, 'the server sends a plain member no look yet: the page must cope');
  const link = (await api('POST', `/api/spaces/${ctx.second}/guest-link`, {})).json;
  const token = link.token || link.guestToken || (link.space && link.space.guestToken);
  assert.ok(token, 'a guest link for Kyoto');

  browser = await launch(bin);
  const open = async (url, as, width, { cookie = null } = {}) => {
    const tab = new Tab(browser.cdp, ctx);
    await tab.open(width, 'light');
    tabs.push(tab);
    if (as) for (const c of cookies[as]) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: server.base, httpOnly: true }, tab.sid);
    if (cookie) await tab.cdp.send('Network.setCookie', { name: cookie.name, value: cookie.value, url: server.base, httpOnly: true }, tab.sid);
    await tab.cdp.send('Page.navigate', { url: server.base + url }, tab.sid);
    return tab;
  };
  const inSpace = async (tab) => { await tab.waitFor('body.in-space'); await sleep(900); };
  // What the page reads now: the live words.js state (the page's own module), the Set up label, the chip, the store.
  const state = (tab) => tab.eval(`(async () => {
    const w = await import('/words.js');
    const chip = document.getElementById('phase-chip');
    const setup = document.getElementById('setup');
    const kept = {};
    for (let i = 0; i < localStorage.length; i++) kept[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
    return {
      space: w.word('space'), spaces: w.word('space', { many: true }), member: w.word('member'), aside: w.word('aside'), env: w.word('environment'), owner: w.word('owner'), home: w.word('home'),
      layout: w.verb('layout'), enter: w.verb('enter'), scoped: w.hasSpaceLook(), envSpace: w.envWord('space'),
      chip: Boolean(chip && chip.getClientRects().length),
      setupLabel: setup ? (setup.getAttribute('aria-label') || setup.textContent || '').trim() : null,
      kept: JSON.stringify(kept), overflow: document.documentElement.scrollWidth > innerWidth + 1,
      inSpace: document.body.classList.contains('in-space'),
    };
  })()`);

  for (const width of [1280, 390]) {
    await test(`owner in Lisbon at ${width}: no template of its own reads exactly /api/branding, the chip shows`, async () => {
      const tab = await open(`/#join=${ctx.trip}`, 'admin', width);
      await inSpace(tab);
      const s = await state(tab);
      assert.equal(s.space, 'trip');
      assert.equal(s.member, 'member');
      assert.equal(s.chip, true, 'six phases, so the chip');
      assert.equal(s.overflow, false);
      const modules = await tab.eval(`[...document.querySelectorAll('section[data-module]')].map((e) => e.dataset.module + ': ' + e.textContent.replace(/\\s+/g, ' ')).join(' | ')`);
      assert.match(modules, /travel: Itinerary/, modules);
      assert.doesNotMatch(modules, /campaign|Campaign/, modules);
      const same = await tab.eval(`(async () => { const w = await import('/words.js'); const b = await (await fetch('/api/branding')).json(); const mine = w.words(); return Object.keys(b.words).filter((k) => !['host', 'admin'].includes(k)).every((k) => mine[k].one === b.words[k].one && mine[k].many === b.words[k].many); })()`);
      assert.equal(same, true);
      await tab.close();
    });

    await test(`owner in Kyoto at ${width}: campaign words, no chip, nothing scoped kept in the browser`, async () => {
      const tab = await open(`/#join=${ctx.second}`, 'admin', width);
      await inSpace(tab);
      const s = await state(tab);
      assert.equal(s.scoped, true);
      assert.equal(s.space, 'campaign');
      assert.equal(s.spaces, 'campaigns');
      assert.equal(s.member, 'player');
      assert.equal(s.aside, 'whisper');
      assert.equal(s.env, 'environment', 'the words above a space stay the environment\'s');
      assert.equal(s.owner, 'owner');
      assert.equal(s.home, 'Trips');
      assert.equal(s.enter, 'Enter');
      assert.equal(s.envSpace, 'trip');
      assert.equal(s.chip, false, 'Games has no phases');
      assert.equal(s.overflow, false);
      assert.doesNotMatch(s.kept, /campaign|player|whisper|Campaign/, `localStorage: ${s.kept}`);
      // The modules open on the canvas read the space's words and names through their own context (the server answers it per space).
      const modules = await tab.eval(`[...document.querySelectorAll('section[data-module]')].map((e) => e.dataset.module + ': ' + e.textContent.replace(/\\s+/g, ' ')).join(' | ')`);
      assert.match(modules, /travel: Campaign planner/, modules);
      assert.match(modules, /This campaign/, modules);
      assert.doesNotMatch(modules, /Itinerary|This trip/, modules);
      if (width > 700) assert.match(s.setupLabel || '', /Campaign/, `Set up reads ${s.setupLabel}`);
      await tab.close();
    });
  }

  await test('Home over a space, a move between spaces and leaving: never the last space\'s words', async () => {
    const tab = await open(`/#join=${ctx.second}`, 'admin', 1280);
    await inSpace(tab);
    assert.equal((await state(tab)).space, 'campaign');
    await tab.eval(`document.getElementById('spaces-link').click()`);
    await sleep(700);
    let s = await state(tab);
    assert.equal(s.inSpace, false, 'Home shows');
    assert.equal(s.space, 'trip', 'Home reads the environment\'s words');
    assert.equal(s.scoped, false);
    const headings = await tab.eval(`[...document.querySelectorAll('#join [data-word], #join [data-fill]')].map((e) => e.textContent).join(' | ')`);
    assert.doesNotMatch(headings, /campaign|Campaign|player/, headings);
    // Back to the space: its words return.
    await tab.eval(`document.querySelector('[data-space="${ctx.second}"] [data-join]').click()`);
    await sleep(900);
    s = await state(tab);
    assert.equal(s.inSpace, true);
    assert.equal(s.space, 'campaign');
    // From Kyoto to Lisbon through Home: its own (the environment's) words, six phases, no campaign left over.
    await tab.eval(`document.getElementById('spaces-link').click()`);
    await sleep(600);
    await tab.eval(`document.querySelector('[data-space="${ctx.trip}"] [data-join]').click()`);
    await tab.waitFor('body.in-space');
    await sleep(1000);
    s = await state(tab);
    assert.equal(s.space, 'trip');
    assert.equal(s.member, 'member');
    assert.equal(s.chip, true);
    assert.doesNotMatch(s.kept, /campaign|player|whisper/);
    await tab.close();
  });

  for (const width of [1280, 390]) {
    await test(`a plain member of Kyoto at ${width}: the server's look, the campaign words`, async () => {
      assert.equal((await api('GET', `/api/spaces/${ctx.second}`, undefined, 'mia')).status, 403, 'Mia is no moderator of Kyoto, so the full read is refused her');
      const tab = await open(`/#join=${ctx.second}`, 'mia', width);
      await inSpace(tab);
      const s = await state(tab);
      assert.equal(s.space, 'campaign');
      assert.equal(s.member, 'player');
      assert.equal(s.chip, false);
      assert.equal(s.overflow, false);
      assert.doesNotMatch(s.kept, /campaign|player|whisper/);
      await tab.close();
    });
  }

  await test('a person refused the look keeps the environment\'s words and sees no error (Sam is in Lisbon only)', async () => {
    const refused = await api('GET', `/api/spaces/${ctx.second}/look`, undefined, 'sam');
    assert.equal(refused.status, 404);
    assert.doesNotMatch(JSON.stringify(refused.json), /games|template|campaign/);
    const tab = await open(`/#join=${ctx.second}`, 'sam', 1280);
    await sleep(3500);
    const s = await state(tab);
    assert.equal(s.space, 'trip');
    assert.equal(s.scoped, false);
    assert.equal(await tab.eval(`document.getElementById('join-error').hidden || !document.getElementById('join-error').textContent.includes('look')`), true);
    await tab.close();
  });

  await test('the Lobby and Home read the environment\'s words', async () => {
    assert.equal((await api('GET', '/api/spaces/lobby/look')).status, 404);
    const tab = await open('/#join=lobby', 'admin', 1280);
    await sleep(2500);
    const s = await state(tab);
    assert.equal(s.inSpace, false);
    assert.equal(s.space, 'trip');
    assert.equal(s.scoped, false);
    await tab.close();
  });

  await test('the look route: no session, an unknown id and the access key are all a 404', async () => {
    assert.equal((await fetch(`${server.base}/api/spaces/${ctx.second}/look`)).status, 404);
    assert.equal((await api('GET', '/api/spaces/nosuchspace/look')).status, 404);
  });

  await test('a moderator reads the space\'s look: Mia moderates Lisbon (the environment\'s words), a member of Kyoto', async () => {
    const tab = await open(`/#join=${ctx.trip}`, 'mia', 1280);
    await inSpace(tab);
    const s = await state(tab);
    assert.equal(s.space, 'trip');
    assert.equal(s.chip, true);
    await tab.close();
  });

  for (const width of [1280, 390]) {
    await test(`a guest link into Kyoto at ${width}: the environment's words on the form, the space's once in`, async () => {
      const tab = await open(`/guest/${token}`, null, width);
      await tab.waitFor('#guest-name');
      await sleep(500);
      let s = await state(tab);
      assert.equal(s.space, 'trip', 'before entering');
      await tab.typeInto('#guest-name', 'Gus');
      await tab.eval(`document.querySelector('#guest-join button[type="submit"]').click()`);
      await tab.waitFor('body.in-space');
      await sleep(900);
      s = await state(tab);
      assert.equal(s.space, 'campaign');
      assert.equal(s.member, 'player');
      assert.equal(s.chip, false);
      assert.equal(s.overflow, false);
      assert.doesNotMatch(s.kept, /campaign|player|whisper/);
      await tab.close();
    });

    await test(`a door guest into Kyoto at ${width}: the space's words, and not Lisbon's look`, async () => {
      assert.equal((await api('PATCH', `/api/spaces/${ctx.second}`, { entry: 'guests' })).status, 200);
      const door = await fetch(`${server.base}/api/guest-door`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Dee', versions: {} }) });
      assert.equal(door.status, 201, await door.clone().text());
      const [nv] = door.headers.getSetCookie()[0].split(';');
      const cookie = { name: nv.slice(0, nv.indexOf('=')), value: nv.slice(nv.indexOf('=') + 1) };
      const look = await fetch(`${server.base}/api/spaces/${ctx.second}/look`, { headers: { cookie: `${cookie.name}=${cookie.value}` } });
      assert.equal(look.status, 200);
      assert.equal((await look.json()).look.words.space.one, 'campaign');
      assert.equal((await fetch(`${server.base}/api/spaces/${ctx.trip}/look`, { headers: { cookie: `${cookie.name}=${cookie.value}` } })).status, 404, 'a space the door does not open to them');
      const tab = await open(`/guest/${ctx.second}`, null, width, { cookie });
      await inSpace(tab);
      const s = await state(tab);
      assert.equal(s.space, 'campaign');
      assert.equal(s.overflow, false);
      assert.doesNotMatch(s.kept, /campaign|player|whisper/);
      await tab.close();
    });
  }

  await test('Set up sends only the phases it shows (setupPatch): a stale date is neither sent nor a change', async () => {
    const tab = await open(`/#join=${ctx.trip}`, 'admin', 1280);
    await inSpace(tab);
    const r = await tab.eval(`(async () => {
      const { setupPatch } = await import('/space-setup.js');
      const shown = ['planning', 'booking'];
      const before = { phases: { planning: { start: '2030-01-01' }, gone: { start: '2030-02-01', end: '2030-02-05' } } };
      return {
        same: setupPatch(before, { phases: { ...before.phases } }, { phaseIds: shown }),
        staleOnly: setupPatch(before, { phases: { planning: { start: '2030-01-01' }, gone: { start: '2031-01-01' } } }, { phaseIds: shown }),
        edit: setupPatch(before, { phases: { planning: { start: '2030-01-02' }, gone: before.phases.gone } }, { phaseIds: shown }),
        none: setupPatch(before, { phases: { planning: { start: '2030-01-01' } } }),
      };
    })()`);
    assert.deepEqual(r.same, {});
    assert.deepEqual(r.staleOnly, {}, 'a change to a date the template does not have is no change');
    assert.deepEqual(r.edit, { phases: { planning: { start: '2030-01-02' } } }, 'sent without the stale id');
    assert.ok(r.none.phases, 'without the list (an older caller) the whole map goes, as before');
    await tab.close();
  });

  await test('the server keeps a stale date and a save of the phases the page shows does not fail on it (Kyoto, Travel dates, Games words)', async () => {
    const held = (await api('GET', `/api/spaces/${ctx.second}`)).json.space.phases;
    assert.ok(held[branding.phases[0].id], 'the date for the Travel phase is still on the record');
    assert.equal((await api('PATCH', `/api/spaces/${ctx.second}`, { phases: {} })).status, 200, 'a save of none: no failure');
  });
} finally {
  for (const t of tabs) await t.close().catch(() => {});
  if (browser) await browser.close?.().catch?.(() => {});
  if (server) await stopServer(server);
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(failed ? `check-space-look: ${failed} FAILED, ${n} passed` : `check-space-look: OK (${n} tests)`);
process.exit(failed ? 1 : 0);
