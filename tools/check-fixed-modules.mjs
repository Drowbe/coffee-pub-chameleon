#!/usr/bin/env node
/**
 * The Modules tab by kind of workspace (plan-workspaces.md, decisions 33 to 35, step 12): a Fixed Workspace (Conference, Calendar,
 * Map, Whiteboards, Documents) shows only the switches from `settings` in GET /api/spaces/:id/layouts, or "There is nothing to
 * configure here."; the Workspace (a Customizable Workspace) keeps the canvas menu.
 *   - pure helpers (no browser)
 *   - live: Calendar shows the To-do switch and toggling it persists (read back from the server); a member sees it disabled with
 *     the reason; Conference shows the message and no canvas controls; the Workspace is unchanged
 * With no Chromium it says SKIPPED (set CHROME_PATH); that is not a pass. Run it under the browser lock when machines share.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const { bootSeeded, stopServer, freePort, findBrowser, launch, Tab, sleep } = await import('./shots.mjs');

// --- the Modules tab by kind of workspace: the pure helpers (no browser) ---
{
  const { fixedWorkspaceOf, modulesTabView, fixedSwitchReason, NOTHING_TO_CONFIGURE, FIXED_WORKSPACES } = await import('../public/space-setup.js');
  assert.equal(NOTHING_TO_CONFIGURE, 'There is nothing to configure here.');
  const todo = { module: 'todo', moduleName: 'To-do', key: 'inCalendar', label: 'Show in the Calendar', type: 'boolean', scope: 'environment', value: true, canChange: true, help: 'Also in the side panel.' };
  const system = [
    { id: 'workspace', name: 'Workspace' },
    { id: 'calendar', name: 'Calendar', settings: [todo] },
    ...['map', 'conference', 'whiteboard', 'documents'].map((id) => ({ id, name: id, settings: [] })),
  ];
  assert.deepEqual([...FIXED_WORKSPACES].sort(), ['calendar', 'conference', 'documents', 'map', 'whiteboard']);
  assert.equal(fixedWorkspaceOf(system, 'workspace'), null, 'the Workspace is a Customizable Workspace');
  assert.equal(fixedWorkspaceOf(system, 'some-saved-layout'), null, 'a saved layout is a Customizable Workspace');
  assert.equal(fixedWorkspaceOf([], 'calendar'), null, 'no entry yet: the canvas menu, not a guess');
  assert.equal(fixedWorkspaceOf([{ id: 'calendar' }], 'calendar'), null, 'an entry with no settings key is not a Fixed Workspace answer');
  assert.equal(fixedWorkspaceOf(system, 'calendar').id, 'calendar');
  const custom = modulesTabView(null);
  assert.deepEqual([custom.fixed, custom.canvasControls, custom.rows.length, custom.empty], [false, true, 0, ''], 'a Customizable Workspace keeps the canvas controls');
  const cal = modulesTabView(fixedWorkspaceOf(system, 'calendar'));
  assert.deepEqual([cal.fixed, cal.canvasControls, cal.heading, cal.empty], [true, false, 'Calendar', ''], 'Calendar: switches, no canvas controls, no message');
  assert.equal(cal.rows.length, 1);
  assert.deepEqual([cal.rows[0].id, cal.rows[0].label, cal.rows[0].on, cal.rows[0].disabled, cal.rows[0].note], ['todo:inCalendar', 'Show in the Calendar', true, false, 'Also in the side panel.']);
  const cannot = modulesTabView({ ...system[1], settings: [{ ...todo, canChange: false, value: false }] }).rows[0];
  assert.deepEqual([cannot.on, cannot.disabled], [false, true], 'a person who may not change it sees it off or on as it is, disabled');
  assert.equal(cannot.note, `Also in the side panel. ${fixedSwitchReason('environment')}`, 'the reason follows the help');
  assert.equal(fixedSwitchReason('environment'), 'Only the owner can change this.');
  for (const id of ['map', 'conference', 'whiteboard', 'documents']) {
    const v = modulesTabView(fixedWorkspaceOf(system, id));
    assert.deepEqual([v.fixed, v.canvasControls, v.rows.length, v.empty], [true, false, 0, NOTHING_TO_CONFIGURE], `${id}: the message, nothing else`);
  }
  const odd = modulesTabView({ id: 'calendar', settings: [{ ...todo, type: 'choice' }, { ...todo, module: 5 }, null] });
  assert.equal(odd.rows.length, 0, 'only boolean settings with a module and a key are drawn');
  assert.equal(modulesTabView({ ...system[1], settings: [{ ...todo, label: '<img src=x onerror=alert(1)>' }] }).rows[0].label, '<img src=x onerror=alert(1)>', 'text stays text here; the page sets it with textContent');
}

const bin = findBrowser();
if (!bin) {
  console.log('check-fixed-modules: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.');
  process.exit(0);
}

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};
const SHOTS = process.env.FIXED_MODULES_SHOTS || '';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-fixed-modules-'));
let server;
let browser;
const tabs = [];
try {
  const port = await freePort();
  const boot = await bootSeeded('travel', dataDir, port);
  server = boot.server;
  const { ctx, cookies } = boot;
  browser = await launch(bin);
  const open = async (url, as, width, mode = 'light') => {
    const tab = new Tab(browser.cdp, ctx);
    await tab.open(width, mode);
    tabs.push(tab);
    for (const c of cookies[as]) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: server.base, httpOnly: true }, tab.sid);
    await tab.cdp.send('Page.navigate', { url: server.base + url }, tab.sid);
    return tab;
  };
  const inSpace = async (as, width, mode) => {
    const tab = await open(`/#join=${ctx.trip}`, as, width, mode);
    await tab.waitFor('button.sdk-strip-fact[data-module=budget]');
    await sleep(600);
    return tab;
  };
  const openSetup = async (tab) => {
    await tab.click('#setup');
    await tab.waitFor('#space-setup .setup-tab');
    await sleep(900);
  };

  // --- the Modules tab of a Fixed Workspace (step 12) ---
  const cookieOf = (as) => cookies[as].map((c) => `${c.name}=${c.value}`).join('; ');
  const layoutsAs = async (as) => (await fetch(`${server.base}/api/spaces/${ctx.trip}/layouts`, { headers: { cookie: cookieOf(as) } })).json();
  const pressTab = async (tab, id) => {
    await tab.waitFor(`[data-layout-tab="${id}"]`);
    await tab.click(`[data-layout-tab="${id}"]`);
    await sleep(1200);
  };
  const modulesTab = async (tab) => {
    await tab.waitFor('#setup-show .host-menu-item, #setup-fixed-heading');
    return modulesTabNow(tab);
  };
  const modulesTabNow = (tab) => tab.eval(`(() => {
    const holder = document.getElementById('setup-show');
    const vis = (e) => Boolean(e) && e.getClientRects().length > 0;
    return {
      heading: document.getElementById('setup-fixed-heading')?.textContent || null,
      empty: document.getElementById('setup-fixed-empty')?.textContent || null,
      switches: [...document.querySelectorAll('#setup-fixed-switches .sdk-choice-row')].map((r) => ({ label: r.querySelector('.sdk-choice-label').textContent, note: r.querySelector('.sdk-choice-desc')?.textContent || '', on: r.querySelector('input').checked, disabled: r.querySelector('input').disabled })),
      canvasMenu: Boolean(holder.querySelector('.host-menu-item')), arrange: [...holder.querySelectorAll('.host-menu-item')].some((e) => /Arrange/.test(e.textContent)), layouts: [...holder.querySelectorAll('.host-menu-item, .host-menu-heading')].some((e) => /Layouts/.test(e.textContent)),
      hintShown: vis(document.getElementById('setup-show-hint')),
    };
  })()`);
  await test('Workspace: the Modules tab is the canvas menu, as before', async () => {
    const tab = await inSpace('admin', 1280);
    await openSetup(tab);
    const m = await modulesTab(tab);
    assert.equal(m.canvasMenu, true);
    assert.equal(m.heading, null);
    assert.equal(m.switches.length, 0);
  });
  await test('Calendar: the owner sees only the To-do switch; no Arrange, no Layouts; the switch writes inCalendar and the Workspace gets the menu back', async () => {
    const tab = await inSpace('admin', 1280);
    await pressTab(tab, 'calendar');
    await openSetup(tab);
    const m = await modulesTab(tab);
    assert.equal(m.heading, 'Calendar');
    assert.equal(m.canvasMenu, false, 'no canvas menu rows');
    assert.equal(m.hintShown, false, 'not the "open for you" hint');
    assert.equal(m.switches.length, 1);
    assert.equal(m.switches[0].label, 'Show in the Calendar');
    assert.equal(m.switches[0].disabled, false);
    assert.equal(m.empty, null);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, 'fixed-calendar-owner.png'), await tab.shoot(false)); }
    await tab.eval(`document.querySelector('#setup-fixed-switches input').click()`);
    await sleep(900);
    const layouts = (await layoutsAs('admin')).system.find((l) => l.id === 'calendar').settings[0].value;
    assert.equal(layouts, false, 'the answer says the switch is off now');
    assert.equal(await tab.eval(`document.getElementById('setup-fixed-status').textContent`), 'Saved.');
    assert.equal(await tab.eval(`document.querySelector('#setup-fixed-switches input').checked`), false);
    await tab.eval(`document.querySelector('#setup-fixed-switches input').click()`); // back on, for the next test
    await sleep(700);
    await pressTab(tab, 'workspace');
    const back = await modulesTab(tab);
    assert.equal(back.canvasMenu, true, 'the Workspace has the canvas menu again');
    assert.equal(back.heading, null);
  });
  await test('Calendar: a member sees the switch disabled, with the reason', async () => {
    const tab = await inSpace('sam', 1280);
    await pressTab(tab, 'calendar');
    await openSetup(tab);
    const m = await modulesTab(tab);
    assert.equal(m.switches.length, 1);
    assert.equal(m.switches[0].disabled, true);
    assert.ok(m.switches[0].note.endsWith('Only the owner can change this.'), m.switches[0].note);
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'fixed-calendar-member.png'), await tab.shoot(false));
  });
  for (const id of ['conference']) {
    await test(`${id}: the Modules tab says there is nothing to configure, and has no canvas controls`, async () => {
      const tab = await inSpace('admin', 1280);
      await pressTab(tab, id);
      await openSetup(tab);
      const m = await modulesTab(tab);
      assert.equal(m.empty, 'There is nothing to configure here.');
      assert.equal(m.switches.length, 0);
      assert.equal(m.canvasMenu, false);
      if (SHOTS) fs.writeFileSync(path.join(SHOTS, `fixed-${id}-owner.png`), await tab.shoot(false));
    });
  }

} finally {
  for (const t of tabs) await t.close?.().catch(() => {});
  await browser?.close?.().catch(() => {});
  if (server) await stopServer(server);
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(failed ? `check-fixed-modules: ${failed} FAILED, ${n} passed` : `check-fixed-modules: OK (${n} live tests)`);
process.exit(failed ? 1 : 0);
