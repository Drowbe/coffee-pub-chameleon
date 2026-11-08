#!/usr/bin/env node
/*
 * check-setup-tabs.mjs -- the Set up panel's tabs, the top bar's Manage button and Set up's tooltip, in a real browser against
 * a throwaway seeded server (tools/shots.mjs; no LiveKit). Covers:
 *   - tab order and names: Modules | the space's word | Members | Phases | Settings; no First visit tab
 *   - the First visit section is in the Settings tab, and a change there marks the Settings tab unsaved and saves
 *   - the module list is gone from Settings; the note on where modules are turned on is at the foot of the Modules tab
 *   - every tab shows at 1280 and 1024 wide; the "..." appears when the panel is narrowed
 *   - Manage is a gear button in the top bar for the admin, not in the profile menu, and not there for a member
 *   - Set up's tooltip and name: "<space word> Configuration"
 * With no Chromium it says SKIPPED (set CHROME_PATH); that is not a pass.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const { bootSeeded, stopServer, freePort, findBrowser, launch, Tab, sleep } = await import('./shots.mjs');

const bin = findBrowser();
if (!bin) {
  console.log('check-setup-tabs: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.');
  process.exit(0);
}

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};
const SHOTS = process.env.SETUP_TABS_SHOTS || '';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-setup-tabs-'));
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
  const strip = (tab) => tab.eval(`(() => {
    const ts = [...document.querySelectorAll('#setup-tabs > .setup-tab')];
    const strip = document.getElementById('setup-tabs').getBoundingClientRect();
    return { labels: ts.map((t) => t.querySelector('.setup-tab-label').textContent), ids: ts.map((t) => t.dataset.tab), out: ts.filter((t) => t.classList.contains('layout-tab-out')).length, more: !document.getElementById('setup-tabs-more').hidden, boxWidth: document.getElementById('space-setup').getBoundingClientRect().width, strip: strip.width, vw: innerWidth };
  })()`);

  for (const width of [1280, 1024]) {
    await test(`tabs at ${width}: Modules, Trip, Members, Phases, Settings, all showing, no First visit tab`, async () => {
      const tab = await inSpace('admin', width);
      await openSetup(tab);
      const s = await strip(tab);
      assert.deepEqual(s.labels, ['Modules', 'Trip', 'Members', 'Phases', 'Settings']);
      assert.deepEqual(s.ids, ['show', 'space', 'members', 'phases', 'modules']);
      assert.ok(!s.labels.includes('First visit'), 'no First visit tab');
      assert.equal(s.out, 0, 'every tab shows');
      assert.equal(s.more, false, 'no "..." when they all fit');
      assert.ok(s.boxWidth <= s.vw, 'the panel is not wider than the window');
      // A long word still fits at the default width: the widest realistic tab words are measured, not guessed.
      await tab.eval(`(() => { document.querySelector('#setup-tab-space .setup-tab-label').textContent = 'Campaign'; document.querySelector('#setup-tab-members .setup-tab-label').textContent = 'Party Members'; window.dispatchEvent(new Event('resize')); return true; })()`);
      await sleep(400);
      const wide = await strip(tab);
      const need = await tab.eval(`(() => { const ts = [...document.querySelectorAll('#setup-tabs > .setup-tab')]; const gap = parseFloat(getComputedStyle(document.getElementById('setup-tabs')).columnGap) || 0; return ts.reduce((a, t) => a + t.getBoundingClientRect().width, 0) + gap * (ts.length - 1); })()`);
      assert.ok(need <= wide.strip, `Campaign and Party Members: the five tabs need ${Math.round(need)}px of the ${Math.round(wide.strip)}px strip`);
      assert.equal(wide.out, 0);
      if (SHOTS) console.log(`width ${width}: panel ${wide.boxWidth}px, strip ${Math.round(wide.strip)}px, five tabs with Campaign and Party Members need ${Math.round(need)}px`);
    });
  }

  await test('the "..." appears when the panel is narrowed, and holds the tabs that do not fit', async () => {
    const tab = await inSpace('admin', 1280);
    await openSetup(tab);
    await tab.eval(`document.getElementById('space-setup').style.width = '250px'`);
    await sleep(500);
    const s = await strip(tab);
    assert.equal(s.more, true);
    assert.ok(s.out > 0);
  });

  await test('Settings holds First visit; changing it marks Settings unsaved and Save keeps it; no module list; the foot note is on Modules', async () => {
    const tab = await inSpace('admin', 1280);
    await openSetup(tab);
    const note = await tab.eval(`document.getElementById('setup-modules-note')?.textContent`);
    assert.equal(note, 'Modules are turned on for the whole environment in Manage.', 'the note at the foot of the Modules tab');
    await tab.click('#setup-tab-modules');
    await sleep(900);
    const s = await tab.eval(`({ heading: document.getElementById('setup-first-visit-heading')?.closest('#setup-content-modules') !== null && document.getElementById('setup-first-visit-heading')?.textContent, list: Boolean(document.getElementById('setup-module-list')), note: Boolean(document.querySelector('#setup-content-modules #setup-modules-note')), dot: !document.querySelector('#setup-tab-modules .setup-tab-dot').hidden })`);
    assert.equal(s.heading, 'First visit');
    assert.equal(s.list, false, 'no read-only module list');
    assert.equal(s.note, false, 'the note is not on Settings');
    assert.equal(s.dot, false, 'nothing changed yet');
    await tab.eval(`(() => { const i = document.querySelector('#setup-opens-with input'); i.click(); return true; })()`);
    await sleep(300);
    assert.equal(await tab.eval(`!document.querySelector('#setup-tab-modules .setup-tab-dot').hidden`), true, 'Settings shows the unsaved dot');
    await tab.eval(`document.querySelector('.action-bar-save').click()`);
    await sleep(1500);
    const r = await fetch(`${server.base}/api/spaces/${ctx.trip}`, { headers: { cookie: cookies.admin.map((c) => `${c.name}=${c.value}`).join('; ') } });
    const space = await r.json();
    assert.ok(Array.isArray((space.space || space).opensWith), 'Opens with was saved');
  });

  await test('Manage: a gear button in the top bar for the admin, gone from the profile menu, absent for a member; Set up says "Trip Configuration"', async () => {
    const tab = await inSpace('admin', 1280);
    const b = await tab.eval(`(() => { const m = document.querySelector('[data-nav-tool="manage-tool"]'); const s = document.querySelector('[data-nav-tool="setup"]'); return { shown: Boolean(m && m.getClientRects().length), icon: m?.querySelector('i')?.className || '', label: m?.getAttribute('aria-label'), tip: m?.getAttribute('data-tip'), setupIcon: s?.querySelector('i')?.className || '', setupLabel: s?.getAttribute('aria-label'), setupTip: s?.getAttribute('data-tip'), next: m && s ? Boolean(m.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) : false }; })()`);
    assert.equal(b.shown, true);
    assert.match(b.icon, /fa-gear/);
    assert.equal(b.label, 'Manage');
    assert.equal(b.tip, 'Manage');
    assert.match(b.setupIcon, /fa-sliders/, 'Set up keeps its own icon');
    assert.equal(b.setupLabel, 'Trip Configuration');
    assert.equal(b.setupTip, 'Trip Configuration');
    assert.equal(b.next, true, 'Manage sits just before Set up');
    await tab.click('[data-nav-tool="setup"]');
    await tab.waitFor('#space-setup .setup-tab');
    const title = await tab.eval(`({ h: document.getElementById('space-setup-title').textContent, row: document.getElementById('setup-tabs').getAttribute('aria-label'), labelled: document.getElementById('space-setup').getAttribute('aria-labelledby') })`);
    assert.equal(title.h, b.setupLabel, 'the panel title and the button say the same words');
    assert.equal(title.row, b.setupLabel, 'and so does the tab row\'s name');
    assert.equal(title.labelled, 'space-setup-title');
    await tab.click('#whoami-link');
    await sleep(500);
    const items = await tab.eval(`[...document.querySelectorAll('.host-menu .host-menu-item')].map((e) => e.textContent.trim())`);
    assert.ok(items.some((t) => /Sign out/.test(t)), 'the profile menu opened');
    assert.ok(!items.some((t) => /^Manage/.test(t)), `no Manage in the profile menu: ${JSON.stringify(items)}`);
    const member = await inSpace('sam', 1280);
    assert.equal(await member.eval(`Boolean(document.querySelector('[data-nav-tool="manage-tool"]')?.getClientRects().length)`), false, 'a member has no Manage button');
    await member.click('[data-nav-tool="setup"]');
    await member.waitFor('#space-setup');
    await sleep(600);
    assert.equal(await member.eval(`document.getElementById('space-setup-title').textContent`), 'Modules', 'a person who cannot configure has only the Modules tab, and its title');
    const home = await open('/', 'admin', 1280);
    await home.waitFor('#whoami-link');
    await sleep(800);
    assert.equal(await home.eval(`Boolean(document.querySelector('[data-nav-tool="manage-tool"]')?.getClientRects().length)`), true, 'and it is on Home too');
    assert.equal(await home.eval(`Boolean(document.querySelector('[data-nav-tool="setup"]')?.getClientRects().length)`), false, 'Home has no Set up button');
  });

  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const [width, mode] of [[1280, 'light'], [1280, 'dark'], [1024, 'light']]) {
      const tab = await inSpace('admin', width, mode);
      await openSetup(tab);
      fs.writeFileSync(path.join(SHOTS, `modules-${width}-${mode}.png`), await tab.shoot(false));
      await tab.click('#setup-tab-modules');
      await sleep(900);
      fs.writeFileSync(path.join(SHOTS, `settings-${width}-${mode}.png`), await tab.shoot(false));
    }
  }
} finally {
  for (const t of tabs) await t.close().catch(() => {});
  if (browser) await browser.close?.().catch?.(() => {});
  if (server) await stopServer(server);
}
console.log(failed ? `check-setup-tabs: ${failed} FAILED, ${n} passed` : `check-setup-tabs: OK (${n} tests)`);
process.exit(failed ? 1 : 0);
