// check-calendar-todo.mjs: the Calendar destination page and its To-do panel, measured in the running product (headless Chromium
// over DevTools, as tools/check-conformance.mjs does; a throwaway server with the screenshot seed, tools/shots.mjs bootSeeded).
// With no Chromium it says SKIPPED and exits 0 (a skip, never a pass), and fails when CI is set.
//
//   1. The toolbar's zones (Thomas, 2026-11-02): the date group (the period's title, back, Today, forward) is left of the Month /
//      Week / Day switch; the Agenda / To-do switch is in the right zone, its right edge on the row's inset from the end, and is
//      still there, never moved into More, at 1280, in a 520 px and a 360 px window; nothing of the row is cut.
//   2. Contrast, measured on what the browser drew, dark and light (4.5 to 1): the chosen day's number and "+N more", an
//      overdue task's marker on the month, the To-do's overdue date; and the light mode's chosen day is not the solid accent.
//   3. The month by keyboard: one Tab stop in the grid, Enter on a day keeps the focus on it, an arrow moves it.
//   4. An Itinerary copy: its marker and tooltip, its time as written in the trip's own zone for a viewer in another zone.
//   5. The status bar keeps the To-do's "overdue" beside the calendar's items.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep } from './shots.mjs';

const say = (...a) => console.log('check-calendar-todo:', ...a);
const failures = [];
let checks = 0;
const ok = (cond, what, got) => { checks += 1; if (!cond) failures.push(`${what}${got === undefined ? '' : ` (got ${typeof got === 'string' ? got : JSON.stringify(got)})`}`); };

// Computed text colour against the colour it is drawn on (the ancestors' backgrounds laid over each other), as a WCAG ratio.
const MEASURE = (sels) => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; } const s = c.match(/color\(srgb ([^)]+)\)/); if (s) { const p = s[1].split(/[ /]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]; } return null; };
  const up = (el) => el.parentElement || (el.parentNode && el.parentNode.host) || null;
  const bgOf = (el) => { const layers = []; for (let e = el; e; e = up(e)) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } } let base = [0, 0, 0]; const all = layers.reverse(); if (!all.length || all[0][3] < 1) base = [26, 20, 16]; for (const c of all) base = base.map((v, i) => v * (1 - c[3]) + c[i] * c[3]); return base; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const all = (sel) => { let roots = [document]; const parts = sel.split('>>>').map((x) => x.trim()); let found = []; parts.forEach((p) => { found = []; for (const r of roots) found.push(...r.querySelectorAll(p)); roots = found.map((e) => e.shadowRoot || e); }); return found; };
  return sels.map((sel) => {
    const el = all(sel).find((e) => e.getClientRects().length);
    if (!el) return { sel, missing: true };
    const cs = getComputedStyle(el);
    let fg = parse(cs.color);
    const bg = bgOf(el);
    fg = fg[3] < 1 ? fg.map((v, i) => (i < 3 ? v * fg[3] + bg[i] * (1 - fg[3]) : 1)) : fg;
    return { sel, text: (el.textContent || '').trim().slice(0, 24), ratio: ratio(fg, bg), opacity: Number(cs.opacity), bg: bg.map(Math.round) };
  });
};

const KEYS = { ArrowRight: 39, ArrowLeft: 37, ArrowDown: 40, ArrowUp: 38, Enter: 13 };
async function key(tab, k) {
  await tab.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: KEYS[k] }, tab.sid);
  await tab.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: KEYS[k] }, tab.sid);
}

async function main() {
  const bin = findBrowser();
  if (!bin) {
    if (process.env.CI) { say('FAIL: no Chromium found, and CI is set.'); return 1; }
    say('SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.');
    return 0;
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-todo-data-'));
  let server = null;
  let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    const admin = boot.cookies.admin.map((c) => `${c.name}=${c.value}`).join('; ');
    // An overdue task, and one due today, in the trip.
    for (const [id, value] of [['zz1', { title: 'Renew passport', notes: 'Photos first.', due: '2026-10-13', remind: false, done: false }], ['zz2', { title: 'Buy sunscreen', notes: '', due: '2026-10-15', remind: false, done: false }]]) {
      const r = await fetch(`${S.base}/api/modules/todo/data/${encodeURIComponent(`task:${id}`)}?scope=space&space=${S.ctx.trip}`, { method: 'PUT', headers: { cookie: admin, 'content-type': 'application/json' }, body: JSON.stringify({ value: { id, ...value, by: 'Mia Alvarez', createdAt: Date.now() } }) });
      if (!r.ok) throw new Error(`the task could not be added: ${r.status}`);
    }
    browser = await launch(bin);
    const open = async (size, mode, url, tz = 'UTC') => {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(size, mode);
      await browser.cdp.send('Emulation.setTimezoneOverride', { timezoneId: tz }, tab.sid);
      for (const c of S.cookies.mia) await browser.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: S.base, httpOnly: true }, tab.sid);
      await browser.cdp.send('Page.navigate', { url: S.base + url }, tab.sid);
      return tab;
    };
    const MAIN = '#dest-main .dest-part-root >>> ';
    const space = `/calendar?space=${S.ctx.trip}`;

    // ---- 1. the zones
    const ROW = `(() => {
      const tb = document.querySelector('#dest-frame .mf-toolbar');
      const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right }; };
      const vis = (list) => [...list].filter((e) => e.offsetParent);
      const sw = vis(tb.querySelectorAll('.mf-switch'));
      const mode = sw.find((e) => e.querySelector('[data-key^="switch:dest-view:"]'));
      const panel = sw.find((e) => e.querySelector('[data-key^="switch:dest-panel:"]'));
      const date = vis(tb.querySelectorAll('.mf-tb-title, [data-key^="btn:main~"]'));
      const more = tb.querySelector('.mf-more');
      return { tb: box(tb), mode: mode && box(mode), panel: panel && box(panel), dateRight: date.length ? Math.max(...date.map((e) => box(e).r)) : null, dateLeft: date.length ? Math.min(...date.map((e) => box(e).l)) : null, filters: tb.querySelector('.mf-filters') && box(tb.querySelector('.mf-filters')), moreShown: Boolean(more && more.offsetParent), over: tb.scrollWidth > tb.clientWidth + 1, panelMoved: Boolean(panel && panel.classList.contains('is-moved')) };
    })()`;
    const judgeRow = (name, row) => {
      ok(row && row.panel, `${name}: the Agenda / To-do switch is in the row`);
      if (!row || !row.panel) return;
      ok(Math.abs(row.tb.r - 12 - row.panel.r) <= 1.5, `${name}: the panel switch's right edge is on the row's inset from its end`, `${Math.round(row.tb.r - row.panel.r)} px from the end`);
      ok(row.mode && row.mode.r <= row.panel.l, `${name}: the Month / Week / Day switch is left of the panel switch`);
      if (row.dateRight !== null && row.mode) ok(row.dateRight <= row.mode.l + 0.5, `${name}: the date group is left of the Month / Week / Day switch`, `${row.dateRight} vs ${row.mode.l}`);
      else ok(row.moreShown, `${name}: the date group is in More when it has no room`);
      if (row.filters) ok(row.filters.r <= row.panel.l + 0.5, `${name}: the Filters button is left of the panel switch`);
      ok(!row.over, `${name}: nothing in the row is cut`);
    };
    {
      const tab = await open(1280, 'light', space);
      try {
        await tab.waitFor('#dest-frame .mf-toolbar [data-key^="switch:dest-panel:"]', '', 45000);
        await sleep(1500);
        judgeRow('1280 px', await tab.eval(ROW));
      } finally { await tab.close(); }
    }
    for (const w of [520, 360]) {
      const tab = await open(w, 'dark', '/healthz');
      try {
        await tab.eval(`(async () => { const f = document.createElement('iframe'); f.id = 'cal'; f.src = ${JSON.stringify(space)}; f.style.cssText = 'width:${w}px;height:700px;border:0'; document.body.style.margin = '0'; document.body.append(f); await new Promise((r) => f.addEventListener('load', r)); return 1; })()`);
        let row = null;
        for (let i = 0; i < 80 && !(row && row.panel); i++) { await sleep(250); row = await tab.eval(`(() => { const d = document.getElementById('cal').contentDocument; if (!d.querySelector('#dest-frame .mf-toolbar [data-key^="switch:dest-panel:"]')) return null; return (${ROW.replace(/document\./g, 'd.')}); })()`).catch(() => null); }
        await sleep(1200);
        row = await tab.eval(`(() => { const d = document.getElementById('cal').contentDocument; return (${ROW.replace(/document\./g, 'd.')}); })()`);
        judgeRow(`${w} px window`, row);
      } finally { await tab.close(); }
    }

    // ---- 2 to 5, in both modes
    const CONTRAST = [
      ['the chosen day\'s number', `${MAIN}.sdk-cal-cell.is-selected .sdk-cal-n`],
      ['"+N more" on the chosen day', `${MAIN}.sdk-cal-cell.is-selected .sdk-cal-more`],
      ['an overdue task\'s marker on the month', `${MAIN}.sdk-cal-cell[data-day="2026-10-13"] .sdk-cal-event.is-overdue`],
      ['a chip on the chosen day', `${MAIN}.sdk-cal-cell.is-selected .sdk-cal-event`],
    ];
    for (const mode of ['dark', 'light']) {
      const tab = await open(1280, mode, space);
      try {
        await tab.waitFor(`${MAIN}.sdk-cal-cell[data-day="2026-10-27"]`, '', 45000);
        await sleep(2500);
        // a day with more than three events (the 27th), picked by keyboard, which also checks 3
        const cell = `${MAIN}.sdk-cal-cell[data-day="2026-10-13"]`;
        const stops = () => tab.eval(`(() => { const r = document.querySelector('#dest-main .dest-part-root').shadowRoot; return [...r.querySelectorAll('.sdk-cal-cell[tabindex="0"]')].map((e) => e.dataset.day); })()`);
        const activeDay = () => tab.eval(`(() => { const r = document.querySelector('#dest-main .dest-part-root').shadowRoot; const a = r.activeElement; return a && a.dataset ? a.dataset.day + (a.classList.contains('is-selected') ? ' selected' : '') : String(a && a.tagName); })()`);
        ok((await stops()).length === 1, `${mode}: the month has one Tab stop`, await stops());
        await tab.eval(`(() => { document.querySelector('#dest-main .dest-part-root').shadowRoot.querySelector('.sdk-cal-cell[data-day="2026-10-13"]').focus(); return 1; })()`);
        await key(tab, 'Enter');
        await sleep(1500);
        ok((await activeDay()) === '2026-10-13 selected', `${mode}: Enter on a day keeps the focus on it, chosen`, await activeDay());
        await key(tab, 'ArrowRight');
        await sleep(300);
        ok((await activeDay()) === '2026-10-14', `${mode}: ArrowRight moves the focus one day`, await activeDay());
        ok(JSON.stringify(await stops()) === '["2026-10-14"]', `${mode}: the one Tab stop goes with the arrows`, await stops());
        // now pick the 27th with the pointer
        await tab.eval(`(() => { document.querySelector('#dest-main .dest-part-root').shadowRoot.querySelector('.sdk-cal-cell[data-day="2026-10-27"]').click(); return 1; })()`);
        await sleep(1200);
        const got = await tab.eval(`(${MEASURE.toString()})(${JSON.stringify(CONTRAST.map((c) => c[1]))})`);
        got.forEach((g, i) => {
          if (g.missing) return ok(false, `${mode}: ${CONTRAST[i][0]} is on the page`);
          ok(g.ratio >= 4.5 && g.opacity >= 1, `${mode}: ${CONTRAST[i][0]} reads at 4.5 to 1 and is not dimmed`, `${g.ratio.toFixed(2)} (opacity ${g.opacity})`);
        });
        // light: the chosen day is not a solid block of the accent; today wears a ring
        if (mode === 'light') {
          const look = await tab.eval(`(() => { const r = document.querySelector('#dest-main .dest-part-root').shadowRoot; const sel = getComputedStyle(r.querySelector('.sdk-cal-cell.is-selected')); const today = getComputedStyle(r.querySelector('.sdk-cal-cell.is-today')); const probe = document.createElement('i'); probe.style.background = 'var(--accent-fill)'; document.body.append(probe); const accent = getComputedStyle(probe).backgroundColor; probe.remove(); return { sel: sel.backgroundColor, accent, todayRing: today.boxShadow }; })()`);
          ok(look.sel !== look.accent, 'light: the chosen day is not the solid accent', look);
          ok(/inset/.test(look.todayRing) && !/rgba\(0, 0, 0, 0\)\s+0px 0px 0px 1px/.test(look.todayRing), 'light: today wears a ring', look.todayRing);
        }
        // the To-do panel: the overdue date, and the status bar keeping "overdue"
        await tab.click('[data-key="switch:dest-panel:panel:todo"]');
        await sleep(1500);
        const late = await tab.eval(`(${MEASURE.toString()})(${JSON.stringify(['#dest-panel-todo .dest-part-root >>> .due.late'])})`);
        ok(late[0] && !late[0].missing && late[0].ratio >= 4.5, `${mode}: the To-do's overdue date reads at 4.5 to 1`, late[0] && late[0].ratio && late[0].ratio.toFixed(2));
        const status = await tab.eval(`(document.querySelector('.mf-status') || {}).textContent || ''`);
        ok(/overdue/.test(status), `${mode}: the status bar keeps the To-do's overdue count`, status);
        const badge = await tab.eval(`[...document.querySelectorAll('[data-key$="~filter:open"] .sdk-badge')].map((e) => e.textContent).join()`);
        ok(/^\d+$/.test(badge), `${mode}: the Open count is a badge that stays when the words fold`, badge);
      } finally { await tab.close(); }
    }

    // ---- 4. an Itinerary copy, seen from the trip's own zone and from another
    for (const [tz, shifted] of [['UTC', false], ['America/New_York', true]]) {
      const tab = await open(1280, 'dark', space, tz);
      try {
        await tab.waitFor(`${MAIN}.sdk-cal-cell[data-day="2026-10-25"]`, '', 45000);
        for (let i = 0; i < 40; i++) { await sleep(250); if (await tab.eval(`Boolean(document.querySelector('#dest-main .dest-part-root').shadowRoot.querySelector('.sdk-cal-event.is-copy'))`)) break; }
        const chips = await tab.eval(`[...document.querySelector('#dest-main .dest-part-root').shadowRoot.querySelectorAll('.sdk-cal-cell[data-day="2026-10-25"] .sdk-cal-event.is-copy')].map((e) => ({ text: e.textContent.trim(), title: e.title, icon: Boolean(e.querySelector('.copy-mark svg')) }))`);
        const flight = chips.find((c) => /Flight to Lisbon/.test(c.text));
        ok(Boolean(flight), `${tz}: the Itinerary's flight is a marked copy on the month`);
        if (flight) {
          ok(/from /.test(flight.title), `${tz}: a copy says which module it is from`, flight.title);
          ok(/7:40 AM/.test(flight.text), `${tz}: the flight reads as written in the trip's zone (7:40 AM)`, flight.text);
          ok(shifted ? /UTC time/.test(flight.title) : !/ time\)/.test(flight.title), `${tz}: the zone is named only where the viewer's differs`, flight.title);
        }
      } finally { await tab.close(); }
    }
  } finally {
    if (browser) { browser.child.kill(); }
    if (server) await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  if (failures.length) {
    for (const f of failures) console.error(`check-calendar-todo: FAIL ${f}`);
    say(`${failures.length} of ${checks} checks failed`);
    return 1;
  }
  say(`ok: ${checks} checks`);
  return 0;
}

main().then((code) => process.exit(code)).catch((err) => { console.error(err); process.exit(1); });
