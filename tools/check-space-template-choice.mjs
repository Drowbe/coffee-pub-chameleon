#!/usr/bin/env node
/*
 * check-space-template-choice.mjs -- a space's own template, the choices (documentation/plans/plan-space-templates.md, step 3), in a
 * real browser against a throwaway seeded server with two spaces in one Travel environment: Lisbon and Kyoto, neither with a template
 * of its own. No LiveKit. Covers, at 1280 and 390 px:
 *   - the owner in Set up's Space tab: a Template choice, "Same as the <environment> (Travel)" first, then the templates offered
 *     (the same list as GET /api/environment/template, hidden ones left out); choosing Games and pressing Save asks first, then the
 *     words in that space change at once (trip -> campaign) and in the other space they do not; choosing "Same as" clears it
 *   - a moderator of the space: the template named on Settings, with no control and no Template choice
 *   - a plain member: no Set up, and the space's own words in the space
 *   - Add <space>: a dialog with the same choice; Add makes the space with that template; "Same as" sends none
 *   - Manage's switch (Space templates): turning it off hides the choice in Set up and in Add (no dialog), and the words go back to the
 *     environment's at once; turning it on brings the choice (and the spaces' own templates) back
 *   - a refusal: the server's own sentence is read in Set up (and in the Add dialog) when the switch was turned off meanwhile
 *   - no horizontal overflow; the choice is reachable by keyboard (a native select)
 * With no Chromium it says SKIPPED (set CHROME_PATH); that is not a pass. STC_SHOTS=<dir> writes the pictures it takes there.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const { bootSeeded, stopServer, freePort, findBrowser, launch, Tab, sleep } = await import('./shots.mjs');

const bin = findBrowser();
if (!bin) {
  console.log('check-space-template-choice: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.');
  process.exit(0);
}

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};
const SHOTS = process.env.STC_SHOTS || '';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-space-template-choice-'));
let server;
let browser;
const tabs = [];
try {
  const port = await freePort();
  const boot = await bootSeeded('travel', dataDir, port);
  server = boot.server;
  const { ctx, cookies } = boot;
  const jar = (as) => cookies[as].map((c) => `${c.name}=${c.value}`).join('; ');
  const api = async (method, url, body, as = 'admin') => {
    const r = await fetch(server.base + url, { method, headers: { 'content-type': 'application/json', cookie: jar(as) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json };
  };
  const lookWord = async (id, as = 'admin') => (await api('GET', `/api/spaces/${id}/look`, undefined, as)).json.look.words.space.one;
  const setSwitch = async (on) => assert.equal((await api('PATCH', '/api/settings', { spaceTemplates: on })).status, 200);
  assert.equal(await lookWord(ctx.trip), 'trip');
  assert.equal(await lookWord(ctx.second), 'trip');
  const offered = (await api('GET', '/api/environment/template')).json;
  assert.ok(offered.choices.some((c) => c.id === 'games'), 'Games is offered');

  browser = await launch(bin);
  const open = async (url, as, width) => {
    const tab = new Tab(browser.cdp, ctx);
    await tab.open(width, 'light');
    tabs.push(tab);
    for (const c of cookies[as]) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: server.base, httpOnly: true }, tab.sid);
    await tab.cdp.send('Page.navigate', { url: server.base + url }, tab.sid);
    return tab;
  };
  const shot = async (tab, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, `${name}.png`), await tab.shoot()); } };
  const pageWord = (tab) => tab.eval(`(async () => { const w = await import('/words.js'); return w.word('space'); })()`);
  const noOverflow = (tab) => tab.eval(`document.documentElement.scrollWidth <= innerWidth + 1`);
  const inSpace = async (tab) => { await tab.waitFor('body.in-space'); await sleep(900); };
  // Set up, opened by its address on the Space tab, with the choices read.
  const setupOpen = async (as, width, id = ctx.trip, tab = '#space') => {
    const t = await open(`/?setup=${id}${tab}`, as, width);
    await t.waitFor('#space-setup .setup-tab');
    await sleep(1200);
    return t;
  };
  const save = async (tab, { confirm = true } = {}) => {
    await tab.eval(`document.querySelector('.action-bar-save').click()`);
    if (confirm) { await tab.waitFor('dialog.sdk-dialog-confirm[open] [data-ok]'); await tab.eval(`document.querySelector('dialog.sdk-dialog-confirm [data-ok]').click()`); }
    await sleep(1200);
  };
  const choose = (tab, value) => tab.eval(`(() => { const s = document.getElementById('setup-template'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);

  for (const width of [1280, 390]) {
    await test(`owner at ${width}: the Template choice lists "Same as ..." then what is offered; choosing Games changes that space's words only`, async () => {
      const tab = await setupOpen('admin', width);
      const choice = await tab.eval(`(() => {
        const s = document.getElementById('setup-template');
        const section = s && s.closest('[data-section]');
        return { shown: Boolean(section && !section.hidden && s.getClientRects().length), options: s ? [...s.options].map((o) => [o.value, o.textContent]) : [], value: s && s.value };
      })()`);
      assert.equal(choice.shown, true, 'the choice shows');
      assert.deepEqual(choice.options[0], ['', 'Same as the environment (Travel)']);
      assert.deepEqual(choice.options.slice(1).map((o) => o[0]), offered.choices.map((c) => c.id), 'exactly what this environment offers');
      assert.equal(choice.value, '', 'a space with none follows the environment');
      assert.equal(await noOverflow(tab), true);
      await shot(tab, `owner-setup-${width}`);
      // Dirty only once chosen; Save asks first.
      assert.equal(await choose(tab, 'games'), 'games');
      await tab.eval(`document.querySelector('.action-bar-save').click()`);
      await tab.waitFor('dialog.sdk-dialog-confirm[open] [data-ok]');
      const asked = await tab.eval(`document.querySelector('dialog.sdk-dialog-confirm').textContent.replace(/\\s+/g, ' ')`);
      assert.match(asked, /Change this trip to Games\?/);
      assert.match(asked, /Its words, phases and module names change now\. Nothing is removed\./);
      await shot(tab, `owner-confirm-${width}`);
      await tab.eval(`document.querySelector('dialog.sdk-dialog-confirm [data-ok]').click()`);
      await sleep(1500);
      assert.equal(await lookWord(ctx.trip), 'campaign');
      assert.equal(await lookWord(ctx.second), 'trip', 'the other space is as it was');
      assert.equal((await api('GET', `/api/spaces/${ctx.trip}`)).json.space.template, 'games');
      await tab.close();
      // The page reads the space's own words in Lisbon, the environment's in Kyoto.
      const lisbon = await open(`/#join=${ctx.trip}`, 'admin', width);
      await inSpace(lisbon);
      assert.equal(await pageWord(lisbon), 'campaign');
      await lisbon.close();
      const kyoto = await open(`/#join=${ctx.second}`, 'admin', width);
      await inSpace(kyoto);
      assert.equal(await pageWord(kyoto), 'trip');
      await kyoto.close();
    });

    await test(`owner at ${width}: Cancel on the question keeps the change unsaved; "Same as ..." clears the space's own`, async () => {
      const tab = await setupOpen('admin', width);
      assert.equal(await tab.eval(`document.getElementById('setup-template').value`), 'games', 'the saved choice is shown');
      await choose(tab, '');
      await tab.eval(`document.querySelector('.action-bar-save').click()`);
      await tab.waitFor('dialog.sdk-dialog-confirm[open] [data-ok]');
      assert.match(await tab.eval(`document.querySelector('dialog.sdk-dialog-confirm').textContent`), /Change this campaign to the environment's template\?/);
      await tab.eval(`document.querySelector('dialog.sdk-dialog-confirm .sdk-dialog-foot [data-close]').click()`);
      await sleep(600);
      assert.equal(await lookWord(ctx.trip), 'campaign', 'Cancel changed nothing');
      assert.equal(await tab.eval(`document.getElementById('space-setup') && !document.getElementById('space-setup').hidden`), true, 'Set up stays open');
      await save(tab);
      assert.equal(await lookWord(ctx.trip), 'trip');
      assert.equal((await api('GET', `/api/spaces/${ctx.trip}`)).json.space.template, null);
      await tab.close();
    });
  }

  await test('keyboard: the Template choice is a labelled select, reached by Tab from the description', async () => {
    const tab = await setupOpen('admin', 1280);
    const r = await tab.eval(`(() => { const s = document.getElementById('setup-template'); return { tag: s.tagName, label: s.closest('label') ? s.closest('label').querySelector('.visually-hidden').textContent.trim() : '', tabbable: s.tabIndex >= 0 && !s.disabled }; })()`);
    assert.deepEqual(r, { tag: 'SELECT', label: 'Template', tabbable: true });
    await tab.close();
  });

  for (const width of [1280, 390]) {
    await test(`moderator at ${width}: the template is named on Settings, with no choice; a member has no Set up and reads the space's words`, async () => {
      assert.equal((await api('PATCH', `/api/spaces/${ctx.trip}`, { template: 'games' })).status, 200);
      const mod = await setupOpen('mia', width, ctx.trip, '#modules');
      const seen = await mod.eval(`(() => {
        const s = document.querySelector('#space-setup [data-section="template-seen"]');
        return { text: s && !s.hidden ? s.textContent.replace(/\\s+/g, ' ').trim() : null, control: Boolean(document.getElementById('setup-template')) };
      })()`);
      assert.match(seen.text || '', /This campaign reads the .*games.* template\./i);
      assert.match(seen.text || '', /Only the owner can change it\./);
      assert.equal(seen.control, false, 'no control for a moderator');
      assert.equal(await noOverflow(mod), true);
      await shot(mod, `moderator-${width}`);
      await mod.close();
      assert.equal((await api('PATCH', `/api/spaces/${ctx.trip}`, { template: 'games' }, 'mia')).status, 403, 'and the server refuses a moderator');
      const member = await open(`/#join=${ctx.trip}`, 'sam', width);
      await inSpace(member);
      assert.equal(await pageWord(member), 'campaign');
      assert.equal(await member.eval(`!document.getElementById('setup-template') && !document.body.classList.contains('setting-up')`), true, 'no Set up and no Template choice for a member');
      assert.equal(await noOverflow(member), true);
      await member.close();
      assert.equal((await api('PATCH', `/api/spaces/${ctx.trip}`, { template: null })).status, 200);
    });
  }

  for (const width of [1280, 390]) {
    await test(`Add at ${width}: a dialog with the same choice; the space is made with the template, or none for "Same as ..."`, async () => {
      const before = (await api('GET', '/api/spaces')).json.spaces.length;
      const tab = await open('/', 'admin', width);
      await tab.waitFor('#home-add-space:not([hidden])');
      await sleep(600);
      await tab.eval(`document.getElementById('home-add-space').click()`);
      await tab.waitFor('dialog.template-add[open] #template-add-select');
      const d = await tab.eval(`(() => { const s = document.getElementById('template-add-select'); return { options: [...s.options].map((o) => [o.value, o.textContent]), title: document.getElementById('template-add-title').textContent, focus: document.activeElement === s }; })()`);
      assert.deepEqual(d.options[0], ['', 'Same as the environment (Travel)']);
      assert.deepEqual(d.options.slice(1).map((o) => o[0]), offered.choices.map((c) => c.id));
      assert.equal(d.title, 'Add Trip');
      assert.equal(d.focus, true, 'the keyboard starts on the choice');
      assert.equal(await tab.eval(`(() => { const r = document.querySelector('dialog.template-add').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; })()`), true, 'the dialog fits the screen');
      await tab.eval(`(() => { const s = document.getElementById('template-add-select'); s.value = 'games'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await shot(tab, `add-${width}`);
      await tab.eval(`document.querySelector('dialog.template-add [data-ok]').click()`);
      await sleep(2000);
      const made = (await api('GET', '/api/spaces')).json.spaces;
      assert.equal(made.length, before + 1);
      const fresh = made[made.length - 1];
      assert.equal((await api('GET', `/api/spaces/${fresh.id}`)).json.space.template, 'games');
      assert.equal(await lookWord(fresh.id), 'campaign');
      await tab.close();
      // Cancel makes nothing; "Same as ..." sends no template.
      const again = await open('/', 'admin', width);
      await again.waitFor('#home-add-space:not([hidden])');
      await sleep(600);
      await again.eval(`document.getElementById('home-add-space').click()`);
      await again.waitFor('dialog.template-add[open]');
      await again.eval(`document.querySelector('dialog.template-add [data-close].btn').click()`);
      await sleep(500);
      assert.equal((await api('GET', '/api/spaces')).json.spaces.length, before + 1, 'Cancel made nothing');
      await again.eval(`document.getElementById('home-add-space').click()`);
      await again.waitFor('dialog.template-add[open]');
      await again.eval(`document.querySelector('dialog.template-add [data-ok]').click()`);
      await sleep(2000);
      const last = (await api('GET', '/api/spaces')).json.spaces;
      assert.equal(last.length, before + 2);
      assert.equal((await api('GET', `/api/spaces/${last[last.length - 1].id}`)).json.space.template, null);
      await again.close();
    });
  }

  await test('Manage: the switch is there with its note; turning it off hides the choice (Set up and Add) and the words go back; on brings it back', async () => {
    const tab = await open('/admin#template', 'admin', 1280);
    await tab.waitFor('#set-space-templates');
    await sleep(900);
    const r = await tab.eval(`(() => ({
      on: document.getElementById('set-space-templates').checked,
      label: document.getElementById('set-space-templates').closest('label').textContent.trim(),
      note: document.getElementById('words-panel').textContent.includes('apply in every trip, whatever its template'),
    }))()`);
    assert.equal(r.on, true);
    assert.equal(r.label, 'Let a trip use its own template');
    assert.equal(r.note, true, 'the Words note');
    await shot(tab, 'manage-1280');
    assert.equal((await api('PATCH', `/api/spaces/${ctx.trip}`, { template: 'games' })).status, 200);
    await tab.eval(`document.getElementById('set-space-templates').click()`);
    await sleep(1200);
    assert.equal((await api('GET', '/api/branding')).json.spaceTemplates, false, 'saved');
    assert.equal(await lookWord(ctx.trip), 'trip', 'every space reads the environment\'s at once');
    await tab.close();
    for (const width of [1280, 390]) {
      const setup = await setupOpen('admin', width);
      assert.equal(await setup.eval(`(() => { const s = document.querySelector('#space-setup [data-section="template"]'); return !s || s.hidden; })()`), true, 'hidden in Set up');
      await setup.close();
      const home = await open('/', 'admin', width);
      await home.waitFor('#home-add-space:not([hidden])');
      await sleep(600);
      await home.eval(`document.getElementById('home-add-space').click()`);
      await sleep(1500);
      assert.equal(await home.eval(`Boolean(document.querySelector('dialog.template-add'))`), false, 'no dialog in Add');
      await home.close();
    }
    const mod = await setupOpen('mia', 390, ctx.trip, '#modules');
    assert.equal(await mod.eval(`(() => { const s = document.querySelector('#space-setup [data-section="template-seen"]'); return !s || s.hidden; })()`), true, 'a moderator is told nothing while it is off');
    await mod.close();
    await setSwitch(true);
    assert.equal(await lookWord(ctx.trip), 'campaign', 'the keys were kept: on again, the space reads Games');
    const back = await setupOpen('admin', 1280);
    assert.equal(await back.eval(`document.getElementById('setup-template').value`), 'games');
    await back.close();
    assert.equal((await api('PATCH', `/api/spaces/${ctx.trip}`, { template: null })).status, 200);
  });

  await test('Manage: the switch turns off and on from the page', async () => {
    const tab = await open('/admin#template', 'admin', 390);
    await tab.waitFor('#set-space-templates');
    await sleep(800);
    await tab.eval(`document.getElementById('set-space-templates').click()`);
    await sleep(1000);
    assert.equal((await api('GET', '/api/branding')).json.spaceTemplates, false);
    await tab.eval(`document.getElementById('set-space-templates').click()`);
    await sleep(1000);
    assert.equal((await api('GET', '/api/branding')).json.spaceTemplates, true);
    assert.equal(await noOverflow(tab), true);
    await tab.close();
  });

  await test('a refusal: the server\'s sentence is read in Set up and in the Add dialog, and nothing changes', async () => {
    const setup = await setupOpen('admin', 1280);
    await choose(setup, 'games');
    await setSwitch(false); // turned off in Manage while this panel was open
    await setup.eval(`document.querySelector('.action-bar-save').click()`);
    await setup.waitFor('dialog.sdk-dialog-confirm[open] [data-ok]');
    await setup.eval(`document.querySelector('dialog.sdk-dialog-confirm [data-ok]').click()`);
    await sleep(1500);
    const text = await setup.eval(`document.getElementById('space-setup').textContent.replace(/\\s+/g, ' ')`);
    assert.match(text, /can't use its own template while that is turned off in this environment/);
    assert.match(text, /Change it and press Save again, or Cancel\./);
    assert.equal(await setup.eval(`!document.getElementById('space-setup').hidden`), true, 'the panel stays open');
    assert.equal((await api('GET', `/api/spaces/${ctx.trip}`)).json.space.template, null, 'nothing was saved');
    await shot(setup, 'refusal-setup-1280');
    await setup.close();
    await setSwitch(true);
    const home = await open('/', 'admin', 390);
    await home.waitFor('#home-add-space:not([hidden])');
    await sleep(600);
    await home.eval(`document.getElementById('home-add-space').click()`);
    await home.waitFor('dialog.template-add[open] #template-add-select');
    await home.eval(`(() => { const s = document.getElementById('template-add-select'); s.value = 'games'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await setSwitch(false);
    const count = (await api('GET', '/api/spaces')).json.spaces.length;
    await home.eval(`document.querySelector('dialog.template-add [data-ok]').click()`);
    await sleep(1500);
    const problem = await home.eval(`document.querySelector('dialog.template-add [data-error]').textContent`);
    assert.match(problem, /can't use its own template while that is turned off in this environment/);
    assert.equal((await api('GET', '/api/spaces')).json.spaces.length, count, 'nothing was made');
    assert.equal(await home.eval(`document.querySelector('dialog.template-add [data-ok]').disabled`), false, 'Add can be pressed again');
    await shot(home, 'refusal-add-390');
    await home.close();
    await setSwitch(true);
  });
} finally {
  for (const t of tabs) await t.close().catch(() => {});
  if (browser) await browser.close?.().catch?.(() => {});
  if (server) await stopServer(server);
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(failed ? `check-space-template-choice: ${failed} FAILED, ${n} passed` : `check-space-template-choice: OK (${n} tests)`);
process.exit(failed ? 1 : 0);
