#!/usr/bin/env node
/*
 * check-restore-layout.mjs -- Workspaces, step 6 (documentation/plans/plan-workspaces.md, "First visit and restore"), in a
 * real browser against a throwaway seeded server (tools/shots.mjs; no LiveKit). Covers what a space opens on:
 *   - a first visit with no remembered layout opens the owner's default layout, and writes nothing
 *   - a change of layout is written (PUT .../last-layout); a reload opens it, and the restore writes nothing
 *   - the person's own last layout wins over the owner's default; someone with none still gets the default
 *   - a last layout the owner hid, or a saved layout that was deleted, falls back quietly to the default
 *   - a guest follows the owner's default (the Workspace when it is a tab they cannot have), has no fixed tab and writes nothing
 * The pure order (firstVisitLayout with `last`) runs in-process first. With no Chromium it says SKIPPED (set CHROME_PATH);
 * that is not a pass.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};

// --- the order, in-process ----------------------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-restore-layout-'));
  fs.copyFileSync(path.join(ROOT, 'public/opens-with.js'), path.join(dir, 'opens-with.mjs'));
  const { firstVisitLayout } = await import(pathToFileURL(path.join(dir, 'opens-with.mjs')).href);
  fs.rmSync(dir, { recursive: true, force: true });
  const fv = (layout) => ({ layout, opensWith: null });
  const cases = [
    ['no last: the owner\'s default', firstVisitLayout({ firstVisit: fv('calendar') }), 'calendar'],
    ['a last layout beats the owner\'s default', firstVisitLayout({ firstVisit: fv('conference'), last: 'calendar' }), 'calendar'],
    ['a last layout beats a remembered arrangement', firstVisitLayout({ firstVisit: fv('conference'), remembered: ['todo'], last: 'calendar' }), 'calendar'],
    ['a last Workspace keeps the Workspace over the owner\'s default', firstVisitLayout({ firstVisit: fv('calendar'), last: 'workspace' }), 'workspace'],
    ['a saved layout as last', firstVisitLayout({ firstVisit: fv('calendar'), last: 'labc123' }), 'labc123'],
    ['a guest has no last: the owner\'s default, a tab they cannot have gives the Workspace', firstVisitLayout({ firstVisit: fv('calendar'), guest: true, last: 'map' }), 'workspace'],
    ['a guest follows a shared default', firstVisitLayout({ firstVisit: fv('labc123'), guest: true, last: 'map' }), 'labc123'],
    ['not entering: the Workspace', firstVisitLayout({ firstVisit: fv('calendar'), last: 'map', entering: false }), 'workspace'],
    ['no last, a remembered arrangement: the Workspace', firstVisitLayout({ firstVisit: fv('calendar'), remembered: ['todo'] }), 'workspace'],
  ];
  for (const [label, got, want] of cases) await test(label, () => assert.equal(got, want));
}

const { bootSeeded, stopServer, freePort, findBrowser, launch, Tab, sleep } = await import('./shots.mjs');
const bin = findBrowser();
if (!bin) {
  console.log(`check-restore-layout: SKIPPED the browser part. No Chromium found (set CHROME_PATH). This is not a pass; ${n} in-process checks ran.`);
  process.exit(failed ? 1 : 0);
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-restore-layout-data-'));
let server;
let browser;
const tabs = [];
try {
  const port = await freePort();
  const boot = await bootSeeded('travel', dataDir, port);
  server = boot.server;
  const { ctx, cookies } = boot;
  browser = await launch(bin);
  const cookieOf = (as) => cookies[as].map((c) => `${c.name}=${c.value}`).join('; ');
  const api = async (as, method, url, body) => {
    const r = await fetch(server.base + url, { method, headers: { cookie: cookieOf(as), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json };
  };
  const layoutsAs = async (as) => (await api(as, 'GET', `/api/spaces/${ctx.trip}/layouts`)).json;
  // Every PUT .../last-layout the page makes is kept in window.__puts, from the first script on.
  const HOOK = `(() => { window.__puts = []; const f = window.fetch; window.fetch = function (u, o) { if (String(u).includes('/last-layout')) window.__puts.push({ url: String(u), method: (o && o.method) || 'GET', body: o && o.body }); return f.apply(this, arguments); }; })()`;
  const open = async (url, as, width = 1280) => {
    const tab = new Tab(browser.cdp, ctx);
    await tab.open(width, 'light');
    tabs.push(tab);
    if (as) for (const c of cookies[as]) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: server.base, httpOnly: true }, tab.sid);
    await tab.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK }, tab.sid);
    await tab.cdp.send('Page.navigate', { url: server.base + url }, tab.sid);
    return tab;
  };
  const enter = async (as) => {
    const tab = await open(`/#join=${ctx.trip}`, as);
    await tab.waitFor('#layout-tabs [data-layout-tab]');
    await sleep(1500); // the restored tab is pressed once the layouts are read
    return tab;
  };
  const reload = async (tab) => {
    await tab.cdp.send('Page.reload', {}, tab.sid);
    await tab.waitFor('#layout-tabs [data-layout-tab]');
    await sleep(1500);
  };
  const shown = (tab) => tab.eval(`document.querySelector('#layout-tabs [aria-current=page]')?.dataset.layoutTab || null`);
  const puts = (tab) => tab.eval(`window.__puts.length`);
  const asAdmin = (body) => api('admin', 'PATCH', `/api/spaces/${ctx.trip}`, body);

  await test('first visit: the owner\'s default opens, and nothing is written', async () => {
    assert.equal((await asAdmin({ defaultLayout: 'conference' })).status, 200);
    assert.equal((await layoutsAs('mia')).last, undefined, 'mia has no last layout yet');
    const tab = await enter('mia');
    assert.equal(await shown(tab), 'conference');
    assert.equal(await puts(tab), 0, 'no write on a first visit');
    assert.equal((await layoutsAs('mia')).last, undefined, 'still none on the server');
  });

  await test('a change is written; a reload opens it and the restore writes nothing', async () => {
    const tab = await enter('mia');
    await tab.click('#layout-tab-calendar, [data-layout-tab=calendar]');
    await sleep(800);
    assert.equal(await shown(tab), 'calendar');
    assert.equal(await puts(tab), 1, 'one write for the press');
    assert.equal((await layoutsAs('mia')).last, 'calendar');
    await reload(tab);
    assert.equal(await shown(tab), 'calendar', 'the last layout, over the owner\'s default (conference)');
    assert.equal(await puts(tab), 0, 'no write on restore');
    await tab.click('[data-layout-tab=workspace]');
    await sleep(600);
    assert.equal((await layoutsAs('mia')).last, 'workspace', 'back to the Workspace is a change too');
    await reload(tab);
    assert.equal(await shown(tab), 'workspace', 'a last Workspace is not pushed to the default');
    assert.equal(await puts(tab), 0);
  });

  await test('owner default: someone with no last layout still gets it; another person\'s last does not reach them', async () => {
    assert.equal((await layoutsAs('sam')).last, undefined);
    const tab = await enter('sam');
    assert.equal(await shown(tab), 'conference');
    assert.equal(await puts(tab), 0);
  });

  await test('a last layout the owner hid falls back quietly to the default', async () => {
    assert.equal((await api('mia', 'PUT', `/api/spaces/${ctx.trip}/last-layout`, { layout: 'calendar' })).status, 200);
    assert.equal((await asAdmin({ tabs: { hide: ['calendar'] } })).status, 200);
    assert.equal((await layoutsAs('mia')).last, undefined, 'the server no longer answers it');
    const tab = await enter('mia');
    assert.equal(await shown(tab), 'conference', 'the default');
    assert.equal(await puts(tab), 0);
    const error = await tab.eval(`!document.getElementById('join-error')?.hidden`);
    assert.equal(error, false, 'no error said');
    assert.equal((await asAdmin({ tabs: { hide: [] } })).status, 200);
  });

  await test('a saved layout that was deleted falls back quietly to the default', async () => {
    const made = await api('mia', 'POST', `/api/spaces/${ctx.trip}/layouts`, { name: 'Mine', modules: [{ id: 'budget', mode: 'dock', dockW: 360 }], snap: { all: false, pitch: 130 } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const id = made.json.layout.id;
    assert.equal((await api('mia', 'PUT', `/api/spaces/${ctx.trip}/last-layout`, { layout: id })).status, 200);
    const tab = await enter('mia');
    assert.equal(await shown(tab), id, 'a saved layout is opened as last');
    assert.equal(await puts(tab), 0);
    assert.equal((await api('mia', 'DELETE', `/api/spaces/${ctx.trip}/layouts/${id}`)).status, 204, 'deleted');
    assert.equal((await layoutsAs('mia')).last, undefined, 'the server dropped it');
    const again = await enter('mia');
    assert.equal(await shown(again), 'conference', 'the default');
    assert.equal(await puts(again), 0);
  });

  await test('a guest follows the owner\'s default (the Workspace for a tab they cannot have), has no fixed tab, writes nothing', async () => {
    const link = await api('admin', 'POST', `/api/spaces/${ctx.trip}/guest-link`, {});
    assert.equal(link.status, 200);
    const url = new URL(link.json.guestUrl);
    const tab = await open(url.pathname, null);
    await tab.waitFor('#guest-join:not([hidden]) #guest-name');
    await sleep(500);
    await tab.eval(`(() => { document.getElementById('guest-name').value = 'Visitor'; document.getElementById('guest-join').requestSubmit(); return true; })()`);
    await sleep(3000);
    const dbg = await tab.eval(`({ inSpace: document.body.classList.contains('in-space'), err: document.getElementById('guest-join-error')?.textContent, form: !document.getElementById('guest-join').hidden, status: document.getElementById('status')?.textContent })`);
    assert.equal(dbg.inSpace, true, JSON.stringify(dbg));
    assert.deepEqual(await tab.eval(`[...document.querySelectorAll('#layout-tabs [data-layout-tab]')].map((b) => b.dataset.layoutTab)`), ['workspace'], 'a guest has the Workspace and shared layouts only, no fixed tab');
    assert.equal(await shown(tab), 'workspace', 'the default (Conference) is a tab a guest cannot have: the Workspace');
    assert.equal(await tab.eval(`document.body.classList.contains('in-space')`), true, 'in the space');
    assert.equal(await tab.eval(`document.querySelector('body.view-conference') === null`), true, 'on the Workspace, not Conference');
    await tab.click('[data-layout-tab=workspace]');
    await sleep(500);
    assert.equal(await puts(tab), 0, 'nothing written for a guest, even on a press');
    assert.equal((await api('admin', 'PATCH', `/api/spaces/${ctx.trip}`, { defaultLayout: 'workspace' })).status, 200);
  });
} finally {
  for (const t of tabs) await t.close().catch(() => {});
  await browser?.close?.().catch?.(() => {});
  await stopServer(server);
  fs.rmSync(dataDir, { recursive: true, force: true });
}
if (failed) { console.error(`check-restore-layout: ${failed} failed`); process.exit(1); }
console.log(`check-restore-layout: ${n} checks ok`);
process.exit(0);
