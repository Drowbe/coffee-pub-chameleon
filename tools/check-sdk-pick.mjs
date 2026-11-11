#!/usr/bin/env node
/*
 * check-sdk-pick.mjs -- two SDK pieces and their first users: host.ui.timeField and host.objects.pick, in the Planner's stop editor
 * and the Calendar's editor (plan-places-and-maps.md: a stop's place can link a Place).
 *
 *   1. In Node. The clock text rules (parseClockText, clockText from public/sdk/host.js): what a person may type, what comes back as
 *      "HH:MM", what is shown on a 12-hour and a 24-hour clock. The pieces are in place: the SDK has timeField and objects.pick (the frame
 *      does not time a pick out), the page answers 'objects.pick', the Planner and the Calendar draw their times with timeField, the
 *      picker's filter and clean-up rules (public/object-pick.js).
 *   2. In Chromium (SKIPPED, said so, when there is none; it is not a pass), on the screenshot seed as a member who may edit, in dark
 *      and in Cream light, at 1280 and at a 390 touch screen:
 *        - the Planner's stop editor shows its time on the environment's 12-hour clock ("8:00 PM"); a typed "9:15p" is read as 21:15 and
 *          .value stays "HH:MM"; Up moves 5 minutes; Escape puts back the last good time and keeps the window open; with the setting at
 *          24 hours the same time reads "20:00";
 *        - Pick from Places opens the picker (rows with icons, only Places), typing narrows, Enter chooses: the editor shows the linked
 *          Place; Save records the link (GET /api/objects/links lists the stop under the place) and the card shows the place as a chip;
 *          Unlink and Save take the link away again;
 *        - on the touch screen the time field and the picker's search and rows are 44px tall and 16px, and the editor's buttons are 44px;
 *        - the text of the picker, the time field and the chip is 4.5:1 or better on what is behind it.
 * Usage: node tools/check-sdk-pick.mjs. Browser: CHROME_PATH, else a Playwright or system Chromium.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const failures = [];
let passed = 0;
const ok = (cond, m) => { if (cond) passed += 1; else failures.push(m); };
const say = (...a) => console.log('check-sdk-pick:', ...a);

// ---- 1. Node ----
const sdk = read('public/sdk/host.js');
const win = { addEventListener() {}, location: { search: '' } };
win.parent = win;
new Function('window', 'document', sdk)(win, { createElement: (tag) => ({ tag }) });
const { parseClockText: parse, clockText: show } = win.hostText;
for (const [text, clock, prev, want] of [
  ['10:30 pm', '12', '', '22:30'], ['1030p', '12', '', '22:30'], ['10.30 PM', '12', '', '22:30'], ['10p', '12', '', '22:00'], ['12a', '12', '', '00:00'], ['12:15 am', '12', '', '00:15'],
  ['7', '12', '', '07:00'], ['7', '12', '19:00', '19:00'], ['7:30', '12', '08:00', '07:30'], ['12', '12', '', '12:00'], ['22:30', '12', '', '22:30'], ['0:05', '12', '', '00:05'],
  ['930', '12', '', '09:30'], ['9:30', '24', '', '09:30'], ['1930', '24', '', '19:30'], ['7 pm', '24', '', '19:00'], ['7', '24', '', '07:00'], ['23:59', '24', '', '23:59'],
  ['25:00', '12', '', ''], ['10:75', '12', '', ''], ['13 pm', '12', '', ''], ['abc', '12', '', ''], ['', '12', '', ''], ['24:00', '24', '', ''],
]) ok(parse(text, clock, prev) === want, `parseClockText(${JSON.stringify(text)}, ${clock}h, ${JSON.stringify(prev)}) gave ${JSON.stringify(parse(text, clock, prev))}, wanted ${JSON.stringify(want)}`);
for (const [v, clock, want] of [['20:00', '12', '8:00 PM'], ['00:05', '12', '12:05 AM'], ['12:00', '12', '12:00 PM'], ['09:30', '12', '9:30 AM'], ['20:00', '24', '20:00'], ['', '12', ''], ['nope', '24', '']]) {
  ok(show(v, clock) === want, `clockText(${JSON.stringify(v)}, ${clock}h) gave ${JSON.stringify(show(v, clock))}, wanted ${JSON.stringify(want)}`);
}
ok(/timeField: \(input, o\) =>/.test(sdk) && /host\.ui\.timeField needs an <input>/.test(sdk), 'host.ui.timeField is missing from the SDK');
ok(/pick: \(o\) => \{[\s\S]{0,900}call\('objects\.pick'/.test(sdk), 'host.objects.pick is missing from the SDK or does not ask the page');
ok(/method === 'objects\.pick'/.test(sdk), "the frame's call times a pick out (a person takes as long as they take)");
const mh = read('public/module-host.js');
ok(/async 'objects\.pick'\(/.test(mh) && /pickObjects\(/.test(mh), "module-host.js does not answer 'objects.pick' with the picker");
const travelJs = read('modules/travel/src/travel.js');
for (const id of ['f-time', 'f-endTime', 'f-checkOutTime', 'f-arrival-time', 'f-back-time', 'f-back-endTime', 'f-back-arrival-time']) ok(travelJs.includes(`'${id}'`) && /host\.ui\.timeField\(\$\(tid\)\)/.test(travelJs), `the Planner's ${id} is not drawn with host.ui.timeField`);
const cal = read('modules/calendar/src/calendar.js');
ok(/host\.ui\.timeField\(\$\('f-time'\)\)/.test(cal) && /host\.ui\.timeField\(\$\('f-end'\)\)/.test(cal), "the Calendar's times are not drawn with host.ui.timeField");
ok(/host\.objects\.pick\(\{ modules: \['places'\]/.test(travelJs), 'the Planner does not pick a Place with host.objects.pick');
const pick = await import(`data:text/javascript;base64,${Buffer.from(read('public/object-pick.js')).toString('base64')}`);
const clean = pick.cleanPick({ title: '  Pick one ', multiple: 1, modules: ['places', 3, ''], kinds: 'x' });
ok(clean.title === 'Pick one' && clean.multiple === false && clean.modules.length === 1 && clean.kinds.length === 0, 'cleanPick keeps a clean title, only a true `multiple`, and only names');
const fits = (s, o) => pick.pickFits(s, pick.cleanPick(o));
const place = { ref: { module: 'places', kind: 'place', id: 'p1', scope: 'space' }, module: { id: 'places' }, title: 'A' };
ok(fits(place, { modules: ['places'] }) && fits(place, { kinds: ['place'] }) && fits(place, { kinds: ['places:place'] }) && !fits(place, { modules: ['todo'] }) && !fits(place, { kinds: ['task'] }) && fits(place, {}), 'pickFits keeps the modules and kinds asked for');
ok(!fits({ error: 'gone' }, {}) && !fits({ title: 'no ref' }, {}), 'pickFits drops an answer with no pointer or an error');

// ---- 2. Chromium ----
let note = '';
const bin = findBrowser();
if (!bin) note = ' (browser part SKIPPED: no Chromium found; set CHROME_PATH. This is not a pass)';
else {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-pick-'));
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    const cookie = (who) => (S.cookies[who] || []).map((c) => `${c.name}=${c.value}`).join('; ');
    const api = async (method, url, body, who = 'admin') => {
      const r = await fetch(S.base + url, { method, headers: { 'content-type': 'application/json', cookie: cookie(who) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, json: await r.json().catch(() => null) };
    };
    browser = await launch(bin);

    const DEEP = (sel, text) => `(() => { const out = []; const walk = (r) => { for (const e of r.querySelectorAll(${JSON.stringify(sel)})) { if (e.getClientRects().length && (!${JSON.stringify(text || '')} || e.textContent.trim().toLowerCase().includes(${JSON.stringify((text || '').toLowerCase())}))) { const b = e.getBoundingClientRect(); out.push([b.x + b.width / 2, b.y + b.height / 2]); } } for (const e of r.querySelectorAll('*')) if (e.shadowRoot) walk(e.shadowRoot); }; walk(document); return out; })()`;
    const planner = (id) => `__q('#module-frame >>> #${id}')`;
    // The sRGB of any CSS colour, and the ratio of text to what is behind it (the backgrounds laid over each other up the tree).
    const CONTRAST = `window.__contrast = (el) => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1; const g = cv.getContext('2d', { willReadFrequently: true });
      const rgba = (c) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
      const over = (top, under) => top[3] >= 1 ? top : [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat([1]);
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const layers = []; for (let n = el; n; n = n.parentElement || (n.getRootNode() && n.getRootNode().host)) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; }
      let bg = [255, 255, 255, 1]; for (const l of layers.reverse()) bg = over(l, bg);
      const fg = over(rgba(getComputedStyle(el).color), bg);
      const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }`;
    const ratios = async (tab, label, sels) => {
      await tab.eval(CONTRAST);
      for (const [name, sel] of sels) {
        const r = await tab.eval(`(() => { let found = null; const walk = (root) => { for (const e of root.querySelectorAll(${JSON.stringify(sel)})) if (!found && e.getClientRects().length) found = e; for (const e of root.querySelectorAll('*')) if (e.shadowRoot) walk(e.shadowRoot); }; walk(document); return found ? window.__contrast(found) : null; })()`);
        if (r === null) { failures.push(`${label}: no ${name} to measure`); continue; }
        ok(r >= 4.5, `${label}: ${name} is ${r.toFixed(2)}:1, wanted 4.5:1`);
      }
    };

    for (const [size, mode, coarse] of [[1280, 'dark', false], [390, 'dark', true], [1280, 'light', false], [390, 'light', true]]) {
      const label = `${size}px ${mode === 'light' ? 'Cream light' : 'dark'}`;
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(size, mode, false);
      const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
      const send = (m, p) => browser.cdp.send(m, p, tab.sid);
      if (coarse) {
        await send('Emulation.setDeviceMetricsOverride', { width: size, height: 844, deviceScaleFactor: 1, mobile: true });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      }
      const clickDeep = async (sel, text) => {
        let r; for (let i = 0; i < 40 && !r; i += 1) { r = (await tab.eval(DEEP(sel, text)))[0]; if (!r) await sleep(100); }
        if (!r) throw new Error(`nothing to click: ${sel} ${text || ''}`);
        await tab.mouse('mouseMoved', r[0], r[1], { button: 'none', clickCount: 0 }); await tab.mouse('mousePressed', r[0], r[1]); await tab.mouse('mouseReleased', r[0], r[1]);
      };
      const key = async (k, mods = 0) => {
        const code = { Escape: 27, Enter: 13, Tab: 9, ArrowDown: 40, ArrowUp: 38 }[k];
        const base = { key: k, code: k, windowsVirtualKeyCode: code, modifiers: mods };
        await send('Input.dispatchKeyEvent', k === 'Enter' ? { type: 'keyDown', ...base, text: '\r' } : { type: 'rawKeyDown', ...base });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
        await sleep(120);
      };
      const typeInto = async (id, text) => { await tab.eval(`(() => { const i = ${planner(id)}; i.focus(); i.select(); return 1; })()`); await send('Input.insertText', { text }); await sleep(120); };
      const shown = (id) => tab.eval(`(() => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').get.call(${planner(id)}))()`);
      const valueOf = (id) => tab.eval(`${planner(id)}.value`);
      const dialogOpen = () => tab.eval(`(() => { let n = 0; const walk = (r) => { for (const d of r.querySelectorAll('dialog')) if (d.open) n += 1; for (const e of r.querySelectorAll('*')) if (e.shadowRoot) walk(e.shadowRoot); }; walk(document); return n; })()`);
      const links = async () => (await api('GET', `/api/objects/links?from=places&dir=to&ref=${encodeURIComponent(JSON.stringify({ module: 'places', kind: 'place', id: 'p1', scope: 'space', space: S.ctx.trip }))}`, undefined, 'mia')).json;
      const waitFor = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(150); } return null; };

      // Open the seeded dinner stop's editor.
      await driveScreen(tab, { id: 'sdk-pick', as: 'mia', url: '/modules/travel?space={trip}', wait: '#module-frame >>> .day-add' }, S.base, S.cookies, S.ctx);
      await sleep(1500);
      const openDinner = async () => {
        await tab.eval(`(() => { const c = __all('#module-frame >>> article.card.meal').find((e) => /Taberna da Rua/.test(e.textContent)); c.scrollIntoView({ block: 'center' }); c.querySelector('.menu-btn').setAttribute('data-sdk-pick', '1'); return 1; })()`);
        await sleep(500);
        await clickDeep('[data-sdk-pick="1"]');
        await sleep(400);
        await clickDeep('.sdk-menu-item', 'Edit');
        await waitFor(() => tab.eval(`!!${planner('f-time')}`));
        await sleep(300);
      };
      await openDinner();
      const isCoarse = await tab.eval(`matchMedia('(pointer: coarse)').matches`);
      ok(isCoarse === coarse, `${label}: the page is ${isCoarse ? 'coarse' : 'fine'}, wanted ${coarse ? 'coarse' : 'fine'}`);

      // The time field: the environment's clock, "HH:MM" underneath.
      ok((await shown('f-time')) === '8:00 PM' && (await valueOf('f-time')) === '20:00', `${label}: the start time shows ${JSON.stringify(await shown('f-time'))} with value ${JSON.stringify(await valueOf('f-time'))}, wanted "8:00 PM" and "20:00" (the 12-hour clock)`);
      ok(await tab.eval(`${planner('f-time')}.type === 'text' && ${planner('f-time')}.classList.contains('sdk-timefield')`), `${label}: the time field is not the SDK's`);
      await typeInto('f-time', '9:15p');
      ok((await valueOf('f-time')) === '20:00', `${label}: a time changed while it was still being typed (${await valueOf('f-time')})`);
      await key('Tab');
      ok((await valueOf('f-time')) === '21:15' && (await shown('f-time')) === '9:15 PM', `${label}: "9:15p" was read as ${await valueOf('f-time')} / ${await shown('f-time')}, wanted 21:15 / "9:15 PM"`);
      await tab.eval(`${planner('f-time')}.focus()`);
      await key('ArrowUp');
      ok((await valueOf('f-time')) === '21:20', `${label}: Up moved the time to ${await valueOf('f-time')}, wanted 21:20`);
      await typeInto('f-time', 'zzz');
      await key('Escape');
      ok((await shown('f-time')) === '9:20 PM' && (await dialogOpen()) >= 1, `${label}: Escape did not put back the last good time and keep the window (${await shown('f-time')}, ${await dialogOpen()} open)`);
      await typeInto('f-time', 'zzz');
      await key('Tab');
      ok(await tab.eval(`${planner('f-time')}.getAttribute('aria-invalid') === 'true'`) && (await valueOf('f-time')) === '', `${label}: text that is not a time is not flagged and emptied`);
      await typeInto('f-time', '8pm');
      await key('Tab');
      ok((await valueOf('f-time')) === '20:00' && !(await tab.eval(`${planner('f-time')}.hasAttribute('aria-invalid')`)), `${label}: a good time after a bad one did not clear the flag`);
      const name = await tab.eval(`(() => { const i = ${planner('f-time')}; return i.labels && i.labels[0] ? i.labels[0].textContent : ''; })()`);
      ok(/Start time/.test(name), `${label}: the time field has no label ("${name}")`);
      const box = await tab.eval(`(() => { const i = ${planner('f-time')}; const r = i.getBoundingClientRect(); return { h: Math.round(r.height), font: parseFloat(getComputedStyle(i).fontSize) }; })()`);
      if (coarse) ok(box.h >= 44 && box.font >= 16, `${label}: the time field is ${box.h}px tall with ${box.font}px text; a touch screen needs 44px and 16px`);

      // Pick from Places.
      await clickDeep('#f-place-pick');
      ok(await waitFor(() => tab.eval(`!!document.querySelector('dialog.sdk-dialog-pick[open]')`)), `${label}: Pick from Places opened no picker`);
      await waitFor(() => tab.eval(`document.querySelectorAll('.sdk-pick-row').length > 0`));
      const rows = await tab.eval(`[...document.querySelectorAll('.sdk-pick-row')].map((r) => ({ t: r.querySelector('.sdk-row-title').textContent, icon: Boolean(r.querySelector('.sdk-card-icon i')), h: Math.round(r.getBoundingClientRect().height), m: r.querySelector('.sdk-row-meta') ? r.querySelector('.sdk-row-meta').textContent : '' }))`);
      ok(rows.length >= 5 && rows.every((r) => r.icon && r.m === 'Place'), `${label}: the picker shows ${rows.length} rows (${rows.map((r) => r.m).join(',')}); wanted the seed's Places, each with an icon`);
      ok(rows.some((r) => r.t === 'Time Out Market') && !rows.some((r) => /Dinner|Lisbon/.test(r.t) && r.m !== 'Place'), `${label}: the picker lacks a seeded Place or shows another module's objects`);
      const pk = await tab.eval(`(() => { const d = document.querySelector('dialog.sdk-dialog-pick'); const i = d.querySelector('input'); const r = d.getBoundingClientRect(); const rr = d.querySelector('.sdk-pick-row').getBoundingClientRect(); const c = d.querySelector('.sdk-dialog-foot .btn').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight, inputH: Math.round(i.getBoundingClientRect().height), font: parseFloat(getComputedStyle(i).fontSize), row: Math.round(rr.height), btn: Math.round(c.height), focus: document.activeElement === d.querySelector('input'), role: i.getAttribute('role'), modal: d.getAttribute('aria-modal'), name: document.getElementById(d.getAttribute('aria-labelledby')).textContent }; })()`);
      ok(pk.focus && pk.role === 'combobox' && pk.modal === 'true' && pk.name === 'Pick a place', `${label}: the picker's focus, roles or name are wrong (${JSON.stringify(pk)})`);
      if (size === 390) ok(pk.w === pk.vw && pk.h === pk.vh, `${label}: the picker is ${pk.w}x${pk.h} in ${pk.vw}x${pk.vh}, wanted a full-height sheet on a phone`);
      else ok(pk.w === 560 || (pk.w >= 400 && pk.w <= 600), `${label}: the picker is ${pk.w}px wide`);
      if (coarse) ok(pk.inputH >= 44 && pk.font >= 16 && pk.row >= 44 && pk.btn >= 44, `${label}: on touch the picker's search is ${pk.inputH}px/${pk.font}px, its rows ${pk.row}px and its Cancel ${pk.btn}px; wanted 44px, 16px, 44px, 44px`);
      await ratios(tab, `${label} picker`, [['the title', '.sdk-dialog-pick .sdk-dialog-title'], ['a row title', '.sdk-pick-row .sdk-row-title'], ['a row subtitle', '.sdk-pick-row .sdk-row-sub'], ['a row kind', '.sdk-pick-row .sdk-row-meta'], ['the count', '.sdk-pick-status']]);
      if (mode === 'dark' && size === 1280) await send('Page.captureScreenshot', { format: 'png' }).then((s) => process.env.SHOTS_DIR && fs.writeFileSync(path.join(process.env.SHOTS_DIR, `sdk-pick-${size}-${mode}.png`), Buffer.from(s.data, 'base64')));
      // Escape closes it with nothing chosen and the editor stays.
      await key('Escape');
      ok(!(await tab.eval(`!!document.querySelector('dialog.sdk-dialog-pick')`)) && (await tab.eval(`!!${planner('f-place')}`)), `${label}: Escape in the picker did not close just the picker`);
      await clickDeep('#f-place-pick');
      await waitFor(() => tab.eval(`document.querySelectorAll('.sdk-pick-row').length > 0`));
      await send('Input.insertText', { text: 'tram' });
      await waitFor(() => tab.eval(`document.querySelectorAll('.sdk-pick-row').length === 1`));
      ok(await tab.eval(`document.querySelectorAll('.sdk-pick-row').length === 1 && /Tram 28/.test(document.querySelector('.sdk-pick-row').textContent)`), `${label}: typing "tram" did not narrow the list to the one Place`);
      await key('Enter');
      ok(await waitFor(() => tab.eval(`!${planner('f-place-linked')}.hidden`)), `${label}: choosing a Place did not link it in the editor`);
      ok((await tab.eval(`${planner('f-place')}.value`)) === 'Tram 28 stop, Martim Moniz', `${label}: the place name is ${await tab.eval(`${planner('f-place')}.value`)}`);
      ok(await tab.eval(`${planner('f-place-open')}.hidden === false && ${planner('f-place-unlink')}.hidden === false && ${planner('f-place-save')}.hidden === true`), `${label}: Open in maps and Unlink should show, and Save as a place not, once a Place is linked`);
      const abox = await tab.eval(`(() => { const r = ${planner('f-place-open')}.getBoundingClientRect(); return Math.round(r.height); })()`);
      if (coarse) ok(abox >= 44, `${label}: Open in maps is ${abox}px tall; a touch screen needs 44px`);
      await ratios(tab, `${label} editor`, [['the time field', '#f-time'], ['the place chip', '.tv-place-linked .sdk-chip-tag']]);
      await clickDeep('#f-save');
      ok(await waitFor(() => tab.eval(`!${planner('f-time')}`)), `${label}: Save did not close the editor`);
      // The plan recorded the link, and the card shows the place as a chip.
      const linked = await waitFor(async () => { const l = await links(); return l && (l.summaries || l).some && (l.summaries || l).some((s) => /Dinner at Taberna/.test(s.title)) ? l : null; });
      ok(Boolean(linked), `${label}: after Save the Place's backlinks do not list the stop (${JSON.stringify(await links()).slice(0, 200)})`);
      const chip = await waitFor(() => tab.eval(`(() => { const c = __all('#module-frame >>> article.card.meal').find((e) => /Taberna da Rua/.test(e.textContent)); const b = c && c.querySelector('button.place-chip'); return b ? b.textContent.trim() : ''; })()`));
      ok(chip === 'Tram 28 stop, Martim Moniz', `${label}: the card's place chip says ${JSON.stringify(chip)}`);
      await ratios(tab, `${label} card`, [['the place chip', 'button.place-chip']]);
      // Unlink and Save: the link goes.
      await openDinner();
      ok(await tab.eval(`!${planner('f-place-linked')}.hidden`), `${label}: the editor does not show the linked Place when it is opened again`);
      await clickDeep('#f-place-unlink');
      ok(await tab.eval(`${planner('f-place-linked')}.hidden === true && ${planner('f-place')}.value === 'Tram 28 stop, Martim Moniz'`), `${label}: Unlink did not keep the name and drop the link`);
      await clickDeep('#f-save');
      await waitFor(() => tab.eval(`!${planner('f-time')}`));
      const gone = await waitFor(async () => { const l = await links(); return l && !(l.summaries || l).some((s) => /Dinner at Taberna/.test(s.title)) ? true : null; });
      ok(Boolean(gone), `${label}: after Unlink and Save the Place's backlinks still list the stop`);
      ok(!(await tab.eval(`(() => { const c = __all('#module-frame >>> article.card.meal').find((e) => /Taberna da Rua/.test(e.textContent)); return Boolean(c && c.querySelector('button.place-chip')); })()`)), `${label}: the chip is still on the card after Unlink`);
      await tab.close();
    }

    // The 24-hour clock: the same stop, the setting changed.
    const set = await api('PATCH', '/api/settings', { clock: '24' }, 'admin');
    ok(set.status === 200, `the clock setting could not be changed (${set.status})`);
    {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(1280, 'dark', false);
      const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
      await driveScreen(tab, { id: 'sdk-pick-24', as: 'mia', url: '/modules/travel?space={trip}', wait: '#module-frame >>> .day-add' }, S.base, S.cookies, S.ctx);
      await sleep(1500);
      await tab.eval(`(() => { const c = __all('#module-frame >>> article.card.meal').find((e) => /Taberna da Rua/.test(e.textContent)); c.scrollIntoView({ block: 'center' }); c.querySelector('.menu-btn').setAttribute('data-sdk-pick', '1'); return 1; })()`);
      await sleep(500);
      const at = (await tab.eval(DEEP('[data-sdk-pick="1"]')))[0];
      await tab.mouse('mouseMoved', at[0], at[1], { button: 'none', clickCount: 0 }); await tab.mouse('mousePressed', at[0], at[1]); await tab.mouse('mouseReleased', at[0], at[1]);
      await sleep(400);
      const edit = (await tab.eval(DEEP('.sdk-menu-item', 'Edit')))[0];
      await tab.mouse('mouseMoved', edit[0], edit[1], { button: 'none', clickCount: 0 }); await tab.mouse('mousePressed', edit[0], edit[1]); await tab.mouse('mouseReleased', edit[0], edit[1]);
      for (let i = 0; i < 40 && !(await tab.eval(`!!${planner('f-time')}`)); i += 1) await sleep(100);
      const t24 = await tab.eval(`(() => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').get.call(${planner('f-time')}))()`);
      ok(t24 === '20:00', `with a 24-hour clock the start time shows ${JSON.stringify(t24)}, wanted "20:00"`);
      ok((await tab.eval(`${planner('f-time')}.placeholder`)) === 'HH:MM', 'with a 24-hour clock the placeholder is not HH:MM');
      await tab.close();
    }
  } catch (err) {
    failures.push(`browser part: ${err.stack || err.message}`);
  } finally {
    if (browser) { try { browser.child.kill('SIGTERM'); } catch (e) { /* closing */ } }
    if (server) await stopServer(server);
    await sleep(300);
    try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 }); } catch (e) { /* still closing */ }
  }
}

if (failures.length) {
  console.error(`check-sdk-pick: ${failures.length} problem(s):\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
say(`${passed} checks passed${note}.`);
