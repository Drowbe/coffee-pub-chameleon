#!/usr/bin/env node
// check-titles-ink.mjs: in the default theme (Chameleon) no title is drawn in the accent, live (headless Chromium, the demo seeder).
// The studio's rule: every title and heading is the text ink (navy in light, cream in dark); the accent (teal) is for primary buttons,
// links, "on" switches, the focus ring and small accents. This boots a throwaway server with the demo trip, opens a set of screens in
// light and in dark (Home, a space with its modules, the Set up flyout, a dialog, Manage, Profile, the sign-in page), and fails when
// anything that has a heading or title role (h1 to h6, [role=heading], .mf-titlebar-title, the top bar's brand name and its icon, a
// dialog's or an editor's title, a section title on Home) or anything inside one (its icon, a link in it) computes the theme's accent
// (--accent-fill, --text-accent) as its colour. The other built-in themes are not held to this: a title may be accent there.
// The colours are read as the browser paints them (a 1-pixel canvas), shadow roots included (the modules draw in them).
// Usage: node tools/check-titles-ink.mjs. With no Chromium it says SKIPPED and exits 0 (a skip, never a pass), and fails when CI is set.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser, launch, freePort, bootSeeded, Tab, sleep, driveScreen, stopServer } from './shots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const say = (...a) => console.log('check-titles-ink:', ...a);
const SCREENS = ['home-member', 'home-admin', 'space-workspace', 'space-setup-space', 'space-setup-members', 'space-layout-save-sheet', 'space-menu-spaces',
  'manage-environment', 'manage-theme', 'manage-modules', 'profile-profile', 'calendar-month'];
const TITLES = 'h1, h2, h3, h4, h5, h6, [role="heading"], .mf-titlebar-title, .sdk-dialog-title, .sdk-editor-title, .layout-sheet-title, .brand-name, .brand-logo, .product-lockup-brand, .mf-titlebar-icon, .space-list-title, .whos-around-title, .dashboard-widget-title, .crumb-label';

// Run in the page: every visible element with a title role, or inside one, that has text or an icon of its own and whose colour is the accent.
const MEASURE = `(() => {
  const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgb = (css) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return d[0] + ',' + d[1] + ',' + d[2]; };
  const root = getComputedStyle(document.documentElement);
  const accents = new Set(['--accent-fill', '--text-accent', '--accent-hover', '--text-link'].map((k) => root.getPropertyValue(k).trim()).filter(Boolean).map(rgb));
  const roots = []; (function walk(r) { roots.push(r); for (const x of r.querySelectorAll('*')) if (x.shadowRoot) walk(x.shadowRoot); })(document);
  const seen = new Set(); const found = []; let titles = 0;
  for (const r of roots) for (const t of r.querySelectorAll(${JSON.stringify(TITLES)})) {
    if (!t.getClientRects().length) continue;
    titles += 1;
    for (const e of [t, ...t.querySelectorAll('*')]) {
      if (seen.has(e) || !e.getClientRects().length) continue;
      seen.add(e);
      const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const icon = e.tagName === 'I' && /(^|\\s)fa-/.test(e.className);
      if (!own && !icon) continue;
      const colour = getComputedStyle(e).color;
      if (accents.has(rgb(colour))) found.push(e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') + ' "' + (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30) + '" ' + colour);
    }
  }
  return { titles, found, accents: [...accents] };
})()`;

const bin = findBrowser();
if (!bin) {
  const msg = 'SKIPPED (no Chromium found: set CHROME_PATH, or install one with npx playwright install chromium). This is not a pass; no page was opened.';
  if (process.env.CI) { console.error('check-titles-ink: could not run: no Chromium found, and CI is set, so this fails.'); process.exit(1); }
  say(msg); process.exit(0);
}
const all = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'shots-screens.json'), 'utf8')).screens;
const failures = [];
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'titles-ink-'));
let boot = null; let browser = null;
try {
  boot = await bootSeeded('travel', dataDir, await freePort());
  const S = { base: boot.server.base, ctx: boot.ctx, cookies: boot.cookies };
  browser = await launch(bin);
  let total = 0;
  for (const mode of ['light', 'dark']) {
    for (const id of SCREENS) {
      const sc = all.find((s) => s.id === id);
      if (!sc) { failures.push(`${id}: not in tools/shots-screens.json`); continue; }
      const tab = new Tab(browser.cdp, S.ctx);
      try {
        await tab.open(1280, mode, Boolean(sc.call || sc.space));
        await driveScreen(tab, sc, S.base, S.cookies, S.ctx);
        await sleep(300);
        const got = await tab.eval(`JSON.stringify(${MEASURE})`).then(JSON.parse);
        total += got.titles;
        if (!got.titles) failures.push(`${id} (${mode}): no title was found on the page, so nothing was checked`);
        for (const f of got.found) failures.push(`${id} (${mode}): ${f} is the accent (${got.accents.join(' or ')}); a title is the text ink`);
      } catch (e) { failures.push(`${id} (${mode}): ${String(e.message || e).slice(0, 160)}`); }
      await tab.close().catch(() => {});
    }
  }
  say(`${total} titles on ${SCREENS.length} screens, light and dark`);
} catch (e) { failures.push(String(e.message || e)); }
finally {
  try { browser?.child.kill(); } catch { /* gone */ }
  if (boot) await stopServer(boot.server).catch(() => {});
}
if (failures.length) { for (const f of failures) console.error('check-titles-ink: FAIL ' + f); process.exit(1); }
say('OK: no title is the accent in the default theme');
process.exit(0);
