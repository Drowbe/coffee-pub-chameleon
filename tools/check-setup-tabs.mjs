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

  await test('the Modules tab\'s menu fills the panel: its right edge is at the content\'s right edge, rows and Layouts included', async () => {
    const tab = await inSpace('admin', 1280);
    await openSetup(tab);
    await sleep(600);
    const m = await tab.eval(`(() => {
      const body = document.querySelector('#space-setup .setup-body');
      const cs = getComputedStyle(body);
      const edge = body.getBoundingClientRect().right - parseFloat(cs.paddingRight) - (body.offsetWidth - body.clientWidth);
      const menu = document.querySelector('#setup-show .host-menu-inline').getBoundingClientRect();
      const rows = [...document.querySelectorAll('#setup-show .host-menu-item')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
      return { edge, menuRight: menu.right, rowRights: rows.map((r) => Math.round(r.right)), widest: Math.max(...rows.map((r) => r.width)) };
    })()`);
    assert.ok(Math.abs(m.menuRight - m.edge) <= 3, `the menu's right edge ${m.menuRight} is the content's ${m.edge}`);
    assert.ok(m.widest > 400, `rows are wide (${m.widest}px), not the floating menu's cap`);
  });

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

  // Delete is the last thing on the space tab (Thomas, 2026-11): after Budget and every other section, just before the footer.
  const spaceTabEnd = (tab) => tab.eval(`(() => {
    const panel = document.getElementById('space-setup');
    const content = document.getElementById('setup-content-space');
    const shown = (e) => e.getClientRects().length > 0 && !e.closest('[hidden]');
    const sections = [...content.querySelectorAll(':scope > .setup-section')].filter(shown).map((e) => ({ id: e.dataset.section, heading: e.querySelector('.setup-heading')?.textContent.trim() }));
    const all = [...document.querySelectorAll('#space-setup a[href], #space-setup button, #space-setup input, #space-setup select, #space-setup textarea, #space-setup [tabindex]')].filter((e) => !e.disabled && e.tabIndex >= 0 && shown(e) && !e.classList.contains('visually-hidden'));
    const inTab = all.filter((e) => content.contains(e));
    const last = inTab[inTab.length - 1];
    const after = last ? all[all.indexOf(last) + 1] : null;
    return { sections, delete: Boolean(document.getElementById('setup-delete')), lastControl: last ? last.id : null, nextControl: after ? (after.className + ' ' + after.id) : null, allIds: content.querySelectorAll('[data-section]').length, budgetSection: Boolean(content.querySelector('[data-section=budget]')), rawOrder: [...content.querySelectorAll(':scope > [data-section]')].map((e) => e.dataset.section), footer: Boolean(panel.querySelector('.action-bar-save')) };
  })()`);

  await test('space tab: for an owner the Delete section is last (after Budget) and its button is the last control before the footer', async () => {
    const tab = await inSpace('admin', 1280);
    await openSetup(tab);
    await tab.click('#setup-tab-space');
    await sleep(700);
    const r = await spaceTabEnd(tab);
    assert.ok(r.delete, 'an owner/admin has Delete');
    assert.equal(r.sections[r.sections.length - 1].id, 'danger', `Delete is the last section shown: ${JSON.stringify(r.sections.map((x) => x.id))}`);
    assert.match(r.sections[r.sections.length - 1].heading, /^Delete this /);
    assert.equal(r.rawOrder[r.rawOrder.length - 1], 'danger', `last in the markup: ${JSON.stringify(r.rawOrder)}`);
    const b = r.rawOrder.indexOf('budget');
    if (b >= 0) assert.ok(b < r.rawOrder.indexOf('danger'), 'Budget comes before Delete');
    assert.equal(r.lastControl, 'setup-delete', 'the Delete button is the last control on the tab');
    assert.ok(/action-bar/.test(r.nextControl || ''), `the next control in tab order is in the footer: ${r.nextControl}`);
  });

  await test('space tab: the Lobby has no Delete, and a moderator has none', async () => {
    // The Lobby is Home and has no Set up panel to open (plan-home-lobby.md, step 2): no Set up button, no Delete anywhere.
    // The panel's own Lobby guard is read as code: Delete is drawn only for `id === 'space' && !space.isLobby`.
    const lobby = await open('/#join=lobby', 'admin', 1280);
    await lobby.waitFor('#whoami-link');
    await sleep(1200);
    assert.equal(await lobby.eval(`Boolean(document.querySelector('[data-nav-tool="setup"]')?.getClientRects().length) || Boolean(document.getElementById('setup-delete'))`), false, 'the Lobby has no Set up and no Delete');
    assert.match(fs.readFileSync(new URL('../public/space-setup.js', import.meta.url), 'utf8'), /id === 'space' && !space\.isLobby \? dangerSectionHtml\(\)/, 'the panel draws no Delete for the Lobby');
    const mod = await inSpace('mia', 1280);
    await openSetup(mod);
    // A moderator has Phases and Settings only (MODERATOR_TABS): no space tab, so no Delete anywhere in the panel.
    const m = await mod.eval(`({ spaceTab: Boolean(document.getElementById('setup-tab-space')), spaceContent: Boolean(document.getElementById('setup-content-space')), del: Boolean(document.getElementById('setup-delete')), danger: Boolean(document.querySelector('#space-setup [data-section=danger]')), tabs: document.querySelectorAll('#setup-tabs > .setup-tab').length })`);
    assert.ok(m.tabs > 0, 'a moderator has a Set up panel');
    assert.deepEqual([m.spaceTab, m.spaceContent, m.del, m.danger], [false, false, false, false], 'a moderator has no Delete');
  });

  for (const [width, mode] of [[1280, 'dark'], [1280, 'light'], [390, 'dark']]) {
    await test(`What AI may see, Only these, at ${width} ${mode}: every module switch is at the right edge, its label at the left`, async () => {
      const tab = await inSpace('admin', width, mode);
      // The section shows only when the server has an AI service: save one, as the admin does.
      const put = await tab.eval(`fetch('/api/ai', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true, provider: 'compatible', address: 'http://127.0.0.1:9', model: 'm', key: 'check-key' }) }).then((r) => r.status)`);
      assert.equal(put, 200, 'the AI service is saved');
      await tab.eval('location.reload()');
      await tab.waitFor('button.sdk-strip-fact[data-module=budget]');
      await sleep(600);
      if (width < 600) { await tab.eval(`document.querySelector('[data-nav-tool="setup"]').click()`); await tab.waitFor('#space-setup .setup-tab'); await sleep(900); } else await openSetup(tab);
      await tab.click('#setup-tab-modules');
      await sleep(600);
      assert.equal(await tab.eval(`document.getElementById('setup-ai-sees-follow').click() || document.getElementById('setup-ai-sees-follow').checked`), false, 'its own choice, not the environment\'s');
      await sleep(300);
      await tab.eval(`(() => { const r = document.getElementById('setup-ai-sees-modules-some'); r.scrollIntoView({ block: 'center' }); r.click(); return true; })()`);
      await sleep(400);
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, `ai-modules-${width}-${mode}.png`), await tab.shoot(false)); }
      const m = await tab.eval(`(() => {
        const list = document.getElementById('setup-ai-sees-module-list');
        const rows = [...list.querySelectorAll('.sdk-choice-row')].map((row) => {
          const r = row.getBoundingClientRect(); const sw = row.querySelector('.sdk-switch').getBoundingClientRect(); const lab = row.querySelector('.sdk-choice-label').getBoundingClientRect();
          return { rowL: r.left, rowR: r.right, swR: sw.right, labL: lab.left, swL: sw.left };
        });
        return { rows, hidden: list.hidden };
      })()`);
      assert.equal(m.hidden, false, 'the list is open');
      assert.ok(m.rows.length >= 5, `the module switches are listed (${m.rows.length})`);
      const first = m.rows[0];
      for (const r of m.rows) {
        assert.ok(r.rowR - r.swR <= 16 + 3, `the switch sits at the row's right edge (gap ${r.rowR - r.swR}px)`);
        assert.ok(Math.abs(r.swR - first.swR) <= 1, `every switch is in one column (${r.swR} vs ${first.swR})`);
        assert.ok(r.labL - r.rowL <= 16 + 3, `the label starts at the row's left edge (gap ${r.labL - r.rowL}px)`);
        assert.ok(r.swL > r.labL, 'the label comes before the switch');
      }
      const above = await tab.eval(`document.getElementById('setup-ai-sees-follow').getBoundingClientRect().right`);
      assert.ok(Math.abs(above - first.swR) <= 3, `the module switches line up with the switches above (${first.swR} vs ${above})`);
    });
  }

  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const [width, mode] of [[1280, 'light'], [1280, 'dark'], [1024, 'light']]) {
      const tab = await inSpace('admin', width, mode);
      await openSetup(tab);
      fs.writeFileSync(path.join(SHOTS, `modules-${width}-${mode}.png`), await tab.shoot(false));
      await tab.eval(`document.querySelector('#space-setup .setup-body').scrollTop = 99999`);
      await sleep(300);
      fs.writeFileSync(path.join(SHOTS, `modules-bottom-${width}-${mode}.png`), await tab.shoot(false));
      await tab.click('#setup-tab-space');
      await sleep(500);
      await tab.eval(`document.querySelector('#space-setup .setup-body').scrollTop = 99999`);
      await sleep(300);
      fs.writeFileSync(path.join(SHOTS, `space-bottom-${width}-${mode}.png`), await tab.shoot(false));
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
