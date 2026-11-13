#!/usr/bin/env node
/*
 * check-entry-switches.mjs -- Set up's four Who can enter switches and a space closed for set up (issue #762), in a real
 * browser against a throwaway seeded server (tools/shots.mjs; no LiveKit). Covers:
 *   - the first switch reads "<Members> of <the space's name>", set as text: a name with markup or quotes injects nothing,
 *     a long name is cut with an ellipsis and held whole in the title; the second names the environment
 *   - the nesting by real clicks (All members off turns Visiting guests off; Visiting guests on turns All members on)
 *   - Visiting guests is dimmed with one line while the host's guest sign-in is off, and works while it is on
 *   - closing dims the other three without changing them, and Save closes the space; a member then sees it listed as
 *     Closed for set up with nothing to open; the admin still enters; reopening restores the three
 * With no Chromium it says SKIPPED (set CHROME_PATH); that is not a pass. ENTRY_SHOTS=<dir> keeps screenshots.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const { bootSeeded, stopServer, freePort, findBrowser, launch, Tab, sleep } = await import('./shots.mjs');
const bin = findBrowser();
if (!bin) {
  console.log('check-entry-switches: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.');
  process.exit(0);
}
let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};
const SHOTS = process.env.ENTRY_SHOTS || '';
const HOSTILE = '<img src=x onerror="window.__hit=1"> "quoted" \'single\' & <b>bold</b> long long';

async function round(door) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-entry-switches-'));
  let server;
  let browser;
  const tabs = [];
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort(), { env: door ? { ENABLE_GUEST_DOOR: 'true' } : {} });
    server = boot.server;
    const { ctx, cookies } = boot;
    const jar = (as) => cookies[as].map((c) => `${c.name}=${c.value}`).join('; ');
    const api = async (method, url, body, as = 'admin') => {
      const r = await fetch(server.base + url, { method, headers: { 'content-type': 'application/json', cookie: jar(as) }, body: body === undefined ? undefined : JSON.stringify(body) });
      let json = null; try { json = await r.json(); } catch { /* none */ }
      return { status: r.status, json };
    };
    browser = await launch(bin);
    const open = async (url, as, width = 1280) => {
      const tab = new Tab(browser.cdp, ctx);
      await tab.open(width, 'light');
      tabs.push(tab);
      for (const c of cookies[as]) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: server.base, httpOnly: true }, tab.sid);
      await tab.cdp.send('Page.navigate', { url: server.base + url }, tab.sid);
      return tab;
    };
    const shot = async (tab, name) => { if (SHOTS) fs.writeFileSync(path.join(SHOTS, `${door ? 'door-on' : 'door-off'}-${name}.png`), Buffer.from((await tab.cdp.send('Page.captureScreenshot', { format: 'png' }, tab.sid)).data, 'base64')); };
    const openMembers = async () => {
      const tab = await open(`/#join=${ctx.trip}`, 'admin');
      await tab.waitFor('button.sdk-strip-fact[data-module=budget]');
      await sleep(600);
      await tab.click('#setup');
      await tab.waitFor('#space-setup .setup-tab');
      await sleep(700);
      await tab.click('#setup-tab-members');
      await tab.waitFor('#setup-open');
      await sleep(900);
      return tab;
    };
    const state = (tab) => tab.eval(`(() => { const v = (id) => { const e = document.querySelector(id); return e ? { on: e.checked, off: e.disabled } : null; }; return { open: v('#setup-open'), accounts: v('#setup-entry-accounts'), invited: v('#setup-allow-guests'), visiting: v('#setup-entry-guests'), closedNote: !document.getElementById('setup-closed-note').hidden, doorNote: !document.getElementById('setup-door-note').hidden }; })()`);

    await test(`${door ? 'door on' : 'door off'}: labels are text; the name is cut and held whole in the title; the environment is named`, async () => {
      assert.equal((await api('PATCH', `/api/spaces/${ctx.trip}`, { name: HOSTILE.slice(0, 40) })).status, 200);
      const tab = await openMembers();
      const l = await tab.eval(`(() => { const e = document.getElementById('setup-open-label'); return { text: e.textContent, title: e.title, kids: e.children.length, hit: window.__hit === 1, imgs: document.querySelectorAll('#space-setup img[src="x"]').length, env: document.getElementById('setup-environment-name').textContent, accounts: document.querySelector('#setup-entry-accounts').closest('label').textContent.trim() }; })()`);
      const name = HOSTILE.slice(0, 40);
      assert.equal(l.kids, 0, 'no element inside the label');
      assert.equal(l.hit, false, 'no handler ran');
      assert.equal(l.imgs, 0);
      assert.ok(l.text.endsWith('…') && l.text.includes(name.slice(0, 20)), `cut with an ellipsis: ${l.text}`);
      assert.ok(l.title.endsWith(name), 'the whole name is in the title');
      assert.ok(l.env && !/</.test(l.env), `the environment's name: ${l.env}`);
      assert.match(l.accounts, /^All .+ \S+$/);
      await shot(tab, '1-hostile-name');
      assert.equal((await api('PATCH', `/api/spaces/${ctx.trip}`, { name: '' })).status, 200);
      assert.equal((await api('PATCH', `/api/spaces/${ctx.trip}`, { name: 'Lisbon' })).status, 200);
    });

    await test(`${door ? 'door on' : 'door off'}: the nesting by real clicks`, async () => {
      const tab = await openMembers();
      let s = await state(tab);
      assert.deepEqual([s.open.on, s.accounts.on, s.invited.on, s.visiting.on], [true, false, true, false]);
      assert.equal(s.doorNote, !door);
      assert.equal(s.visiting.off, !door, 'Visiting guests is dimmed only while the host has not turned guest sign-in on');
      assert.equal(s.closedNote, false);
      await shot(tab, '2-default');
      if (door) {
        await tab.click('#setup-entry-guests');
        s = await state(tab);
        assert.deepEqual([s.accounts.on, s.visiting.on], [true, true], 'Visiting guests on turns All members on');
        await shot(tab, '3-visiting-on');
        await tab.click('#setup-entry-accounts');
        s = await state(tab);
        assert.deepEqual([s.accounts.on, s.visiting.on], [false, false], 'All members off turns Visiting guests off');
      } else {
        await tab.click('#setup-entry-guests');
        s = await state(tab);
        assert.equal(s.visiting.on, false, 'a dimmed switch does nothing');
        await shot(tab, '3-door-off-line');
        await tab.click('#setup-entry-accounts');
        s = await state(tab);
        assert.equal(s.accounts.on, true);
      }
    });

    await test(`${door ? 'door on' : 'door off'}: closing dims the other three and keeps them; Save closes; reopening restores`, async () => {
      assert.equal((await api('PATCH', `/api/spaces/${ctx.trip}`, { entry: door ? 'guests' : 'accounts', allowGuests: false })).status, 200);
      const tab = await openMembers();
      const before = await state(tab);
      await tab.click('#setup-open');
      const s = await state(tab);
      assert.equal(s.open.on, false);
      for (const k of ['accounts', 'invited', 'visiting']) { assert.equal(s[k].off, true, `${k} is dimmed`); assert.equal(s[k].on, before[k].on, `${k} keeps its value`); }
      assert.equal(s.closedNote, true);
      assert.equal(await tab.eval(`getComputedStyle(document.getElementById('setup-entry-accounts').closest('label')).opacity < 1`), true, 'visibly dimmed');
      await shot(tab, '4-closed-dimmed');
      await tab.eval(`document.querySelector('.action-bar-save').click()`);
      await sleep(1500);
      const rec = (await api('GET', `/api/spaces/${ctx.trip}`)).json.space;
      assert.equal(rec.closed, true);
      assert.equal(rec.allowGuests, false);
      assert.equal(rec.entry, door ? 'guests' : 'accounts');
    });

    await test(`${door ? 'door on' : 'door off'}: a member sees it as Closed for set up and cannot open it; the admin enters`, async () => {
      const home = await open('/', 'sam');
      await home.waitFor('.space-choice.requestable');
      await sleep(900);
      const card = await home.eval(`(() => { const c = document.querySelector('.space-choice[data-space="${ctx.trip}"]'); return c ? { text: c.textContent.replace(/\\s+/g, ' ').trim(), role: c.getAttribute('role'), join: !c.querySelector('[data-join]').closest('.space-choice-actions') || c.querySelector('.space-choice-actions').hidden, ask: c.querySelector('[data-ask]').hidden, state: c.querySelector('[data-ask-state]').textContent } : null; })()`);
      assert.ok(card, 'listed');
      assert.equal(card.state, 'Closed for set up');
      assert.equal(card.role, null, 'not a button');
      assert.equal(card.join, true, 'no Join');
      assert.equal(card.ask, true, 'nothing to ask');
      await shot(home, '5-member-home');
      const direct = await open(`/#join=${ctx.trip}`, 'sam');
      await sleep(3500);
      await shot(direct, '6-member-opens-it');
      const mia = await api('GET', `/api/spaces/${ctx.trip}/chat`, undefined, 'sam');
      assert.equal(mia.status, 403);
      assert.equal(await direct.eval(`/closed for set up/i.test(document.body.innerText)`), true, 'the page says it is closed');
      assert.equal((await api('GET', `/api/spaces/${ctx.trip}/chat`, undefined, 'mia')).status, 200, 'a moderator of the space still enters');
      assert.equal((await api('GET', `/api/spaces/${ctx.trip}/chat`, undefined, 'lee')).status, 403, 'so does not another account');
      const admin = await open(`/#join=${ctx.trip}`, 'admin');
      await admin.waitFor('button.sdk-strip-fact[data-module=budget]');
      await sleep(700);
      await shot(admin, '7-admin-enters');
      assert.equal(await admin.eval(`/closed for set up/i.test(document.body.innerText) && !document.querySelector('#setup')`), false);
      assert.equal((await api('PATCH', `/api/spaces/${ctx.trip}`, { closed: false })).status, 200);
      const rec = (await api('GET', `/api/spaces/${ctx.trip}`)).json.space;
      assert.deepEqual([rec.closed, rec.allowGuests, rec.entry], [undefined, false, door ? 'guests' : 'accounts'], 'reopened exactly as before');
      assert.equal((await api('GET', `/api/spaces/${ctx.trip}/chat`, undefined, 'sam')).status, 200);
    });

    if (!door) {
      await test('a moderator closes and reopens from the Settings tab and sees no other entry switch', async () => {
        const tab = await open(`/#join=${ctx.trip}`, 'mia');
        await tab.waitFor('button.sdk-strip-fact[data-module=budget]');
        await sleep(700);
        await tab.click('#setup');
        await tab.waitFor('#space-setup .setup-tab');
        await sleep(700);
        assert.equal(await tab.eval(`Boolean(document.querySelector('#setup-tab-members'))`), false, 'no Members tab');
        await tab.click('#setup-tab-modules');
        await tab.waitFor('#setup-open');
        assert.equal(await tab.eval(`['#setup-entry-accounts', '#setup-allow-guests', '#setup-entry-guests'].some((id) => document.querySelector(id))`), false, 'only the first switch');
        await tab.click('#setup-open');
        await shot(tab, '8-moderator-closes');
        await tab.eval(`document.querySelector('.action-bar-save').click()`);
        await sleep(1500);
        assert.equal((await api('GET', `/api/spaces/${ctx.trip}`)).json.space.closed, true);
        assert.equal((await api('PATCH', `/api/spaces/${ctx.trip}`, { closed: false })).status, 200);
      });
    }
  } finally {
    for (const t of tabs) await t.close().catch(() => {});
    if (browser) await browser.close?.().catch?.(() => {});
    if (server) await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

try {
  await round(false);
  await round(true);
} catch (err) {
  failed += 1;
  console.error(err.stack || err);
}
if (failed) {
  console.error(`check-entry-switches: ${failed} failed`);
  process.exit(1);
}
console.log(`check-entry-switches: ${n} cases ok`);
process.exit(0);
