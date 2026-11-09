#!/usr/bin/env node
/*
 * check-vault-privacy-window.mjs -- the file window's "Who can see this" (plan-vault-privacy.md, slice 3), in a real browser against a
 * throwaway server (no LiveKit). The control and its menu (three radio choices that set and show the choice, the keyboard), the question
 * before a change takes sight from people (the people who lose it, the link from an object, the share link that ends; Cancel changes
 * nothing; the danger button's contrast), widening that asks nothing, the failed change in the window and the failed save in the picker,
 * light and dark. With no Chromium it says SKIPPED (set CHROME_PATH); that is not a pass. VAULT_SHOTS=<folder> keeps a picture of each state.
 */
import { boot, stop, openVault, openWindow, showInfo, intercept, press, reporter, findBrowser, startBrowser, TEXT, COUNT, until, shot, inBoth, sleep, CONTRAST } from './lib/privacy-lib.mjs';

const r = reporter('check-vault-privacy-window');
const bin = findBrowser();
if (!bin) { console.log('check-vault-privacy-window: SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); process.exit(0); }
let env; let browser; let tab;
const PICKER = 'dialog.vp-sheet[open]';
const ASK = 'dialog.sdk-dialog-confirm[open]:not(.vp-sheet)';
try {
  env = await boot('vault-privacy-window');
  await env.ok('admin', 'POST', '/api/modules/bundled/travel/install');
  await env.ok('admin', 'PATCH', '/api/modules/travel', { enabled: true });
  await env.ok('admin', 'PATCH', '/api/roles/member', { 'module.vault.share': true });
  const K = env.keys;
  const linked = await env.file('lee', 'Hotel Roma booking.png', 'people', ['ana', 'ben', 'sam', 'mia']);
  const plain = await env.file('lee', 'Plain picture.png', 'people', ['ana']);
  const ptr = (f) => ({ module: 'vault', kind: 'file', id: f.id, scope: 'space', space: env.trip });
  const saved = await env.api('mia', 'PUT', `/api/modules/travel/data/${encodeURIComponent('plan:p1')}?scope=space&space=${env.trip}`, { value: { kind: 'stay', title: 'Hotel Roma', date: '2026-10-24', files: [ptr(linked)] } });
  r.check(saved.status === 200, `a Planner stay was saved (${saved.status} ${JSON.stringify(saved.json)})`);
  const lk = await env.api('mia', 'POST', '/api/objects/links', { module: 'travel', from: { module: 'travel', kind: 'plan', id: 'p1', scope: 'space', space: env.trip }, to: [ptr(linked)], kind: 'file', op: 'add' });
  r.check(lk.status === 200, `the stay is linked to the file (${lk.status})`);
  const share = await env.api('mia', 'POST', `/api/modules/vault/library/shares?space=${env.trip}`, { name: 'Rome, October', files: [linked.id], days: 7 });
  r.check(share.status === 201 || share.status === 200, `Mia made a share link (${share.status} ${JSON.stringify(share.json).slice(0, 80)})`);
  const now = async (f, who = 'lee') => (await env.listOf(who)).find((x) => x.id === f.id);
  browser = await startBrowser(bin);
  tab = await openVault(env, browser, 'lee');
  await openWindow(tab, 'Hotel Roma booking.png');
  await showInfo(tab);

  // The control, and its menu.
  const info = await tab.eval(TEXT('.vp-who-info'));
  r.check(/Who can see this/i.test(info) && /Chosen people · 4/.test(info) && /Ana Costa/.test(info) && /Mia Alvarez/.test(info), `Info shows the control and the four names (${info.replace(/\n/g, ' ')})`);
  r.check(/You added this file, and owners and the admin can always see it\./.test(info), 'it says owners and the admin can always see it');
  await inBoth(tab, async (mode) => { await shot(tab, `window-people-1280-${mode}`); });
  await tab.click('.vp-change');
  await tab.waitFor('[role=menu]');
  const items = await tab.eval(`[...document.querySelectorAll('[role=menu] [role=menuitemradio]')].map((e) => e.innerText.trim() + ':' + e.getAttribute('aria-checked'))`);
  r.check(items.join('|') === 'Everyone in this trip:false|Only me:false|Chosen people:true', `the menu is three radio choices with the current one checked (${items})`);
  await inBoth(tab, async (mode) => { await shot(tab, `window-menu-1280-${mode}`); });
  // Keyboard: Escape closes it and the focus goes back to the control.
  await press(tab, 'Escape', 'Escape', 27);
  await sleep(250);
  r.check((await tab.eval(COUNT('[role=menu]'))) === 0 && (await tab.eval(`document.activeElement && document.activeElement.classList.contains('vp-change')`)), 'Escape closes the menu and the focus returns to the control');
  await tab.eval(`document.querySelector('.vp-change').focus()`);
  await press(tab, 'Enter', 'Enter', 13, '\r');
  await tab.waitFor('[role=menu]');
  const seen = [await tab.eval(`document.activeElement.innerText.trim()`)];
  for (let i = 0; i < 2; i += 1) { await press(tab, 'ArrowDown', 'ArrowDown', 40); seen.push(await tab.eval(`document.activeElement.innerText.trim()`)); }
  r.check(new Set(seen).size === 3, `the arrow keys move through the three choices (${seen})`);
  await press(tab, 'Escape', 'Escape', 27);

  // Narrowing: Only me, with a link from the Planner and a share link of Mia's.
  await tab.click('.vp-change');
  await tab.click('[role=menuitemradio]', 'Only me');
  await tab.waitFor(ASK);
  await sleep(300);
  const ask = await tab.eval(TEXT(ASK));
  r.check(/Change who can see this file\?/.test(ask) && /Hotel Roma booking\.png will be seen only by you and the owners\./.test(ask), `the question and what it leads to (${ask.replace(/\n/g, ' ')})`);
  r.check(/Ana Costa, Ben Weiss, Mia Alvarez and Sam Okafor can no longer see the file\./.test(ask), 'it lists the four people who lose sight (not the owner, not Lee)');
  r.check(/Linked from 1 place: Hotel Roma in .+\. For Ana Costa, Ben Weiss, Mia Alvarez and Sam Okafor the link shows hidden\./.test(ask), 'it says the link shows hidden for them');
  r.check(/In 1 share link, "Rome, October", made by Mia Alvarez\. It ends, because Mia Alvarez can no longer see the file\./.test(ask), 'it names the share link that ends');
  r.check(await tab.eval(`!!document.querySelector('${ASK} .btn-danger.solid') && document.querySelector('${ASK} .btn-danger.solid').innerText.trim() === 'Make it only me'`), 'the action is a solid danger button, "Make it only me"');
  await tab.eval(CONTRAST);
  await inBoth(tab, async (mode) => {
    const ratio = await tab.eval(`window.__ratio(document.querySelector('${ASK} .btn-danger.solid'))`);
    r.check(ratio >= 4.5, `the danger button is ${ratio.toFixed(2)}:1 in ${mode} (4.5 needed)`);
    await shot(tab, `ask-onlyme-1280-${mode}`);
  });
  await tab.click(`${ASK} button`, 'Cancel');
  await sleep(400);
  r.check((await now(linked)).visibility === 'people', 'Cancel changes nothing on the server');
  await tab.click('.vp-change');
  await tab.click('[role=menuitemradio]', 'Only me');
  await tab.waitFor(ASK);
  await tab.click(`${ASK} button`, 'Make it only me');
  await until(tab, TEXT('.vp-change'), (v) => /Only me/.test(v));
  r.check((await now(linked)).visibility === 'only-me', 'confirming makes it only-me on the server');
  r.check(/Only me/.test(await tab.eval(TEXT('.vp-change'))) && (await tab.eval(COUNT('.vp-namelist'))) === 0, 'the control shows Only me and no names');
  r.check(!(await env.listOf('mia')).some((f) => f.id === linked.id) && !(await env.listOf('sam')).some((f) => f.id === linked.id), 'Mia and Sam no longer get the file');
  // Widening asks nothing.
  await tab.click('.vp-change');
  await tab.click('[role=menuitemradio]', 'Everyone in this trip');
  await until(tab, TEXT('.vp-change'), (v) => /Everyone in this trip/.test(v));
  r.check((await tab.eval(COUNT(ASK))) === 0 && (await now(linked)).visibility === 'everyone', 'widening to Everyone asks no question and is saved');
  await sleep(300);
  r.check(await tab.eval(`!!document.querySelector('.vp-change') && document.activeElement === document.querySelector('.vp-change')`), 'the focus stays on the control after a change: ' + await tab.eval(`document.activeElement.tagName + '.' + document.activeElement.className`));

  // Chosen people: the picker, then the question for the person taken off.
  await env.api('lee', 'PATCH', `/api/modules/vault/library/${linked.id}?space=${env.trip}`, { visibility: 'people', people: [K.ana, K.ben, K.sam, K.mia] });
  await tab.close();
  tab = await openVault(env, browser, 'lee');
  await openWindow(tab, 'Hotel Roma booking.png');
  await showInfo(tab);
  await tab.click('.vp-change');
  await tab.click('[role=menuitemradio]', 'Chosen people');
  await tab.waitFor(PICKER);
  r.check((await tab.eval(TEXT('.vp-count'))) === '4 of 200 chosen', 'the picker opens with the four chosen');
  await tab.click('.vp-chosen .sdk-chip-x[aria-label="Take off Sam Okafor"]');
  await tab.click(`${PICKER} .btn-primary`);
  await tab.waitFor(ASK);
  const ask2 = await tab.eval(TEXT(ASK));
  r.check(/Sam Okafor can no longer see the file\./.test(ask2) && /Remove those people/.test(ask2) && /seen by you, the owners and Ana Costa, Ben Weiss and Mia Alvarez\./.test(ask2), `the question for one person taken off (${ask2.replace(/\n/g, ' ')})`);
  await shot(tab, 'ask-remove-1280-light');
  await tab.click(`${ASK} button`, 'Remove those people');
  await until(tab, COUNT(PICKER), (v) => v === 0);
  const after = await now(linked);
  r.check(after.visibility === 'people' && after.people.length === 3 && !after.people.includes(K.sam), 'Sam is off the list on the server');
  r.check(/Chosen people · 3/.test(await tab.eval(TEXT('.vp-change'))), 'the control reads Chosen people · 3');
  await tab.eval(`document.querySelector('.fv-win .mf-titlebar [aria-label="Close"], .fv-win [aria-label="Close"]')?.click()`);
  await tab.close();

  // A file with no links and no share link: a narrowing just happens, with no question; a failed change says so and changes nothing.
  tab = await openVault(env, browser, 'lee');
  await openWindow(tab, 'Plain picture.png');
  await showInfo(tab);
  const stop1 = await intercept(tab, { patterns: [{ urlPattern: '*/library/*', requestStage: 'Request' }], rules: (q) => (q.method === 'PATCH' ? { status: 500, body: { error: 'Something broke inside.' } } : null) });
  await tab.click('.vp-change');
  await tab.click('[role=menuitemradio]', 'Only me');
  await tab.waitFor('.vp-save-error:not([hidden])');
  const err = await tab.eval(TEXT('.vp-save-error'));
  r.check(/We couldn't change who can see this file\. Nothing changed\. Try again\./.test(err) && !/Something broke/.test(err), `a failed change is said in the window (${err})`);
  r.check(await tab.eval(`document.querySelector('.vp-save-error').getAttribute('role') === 'alert' && document.querySelector('.vp-change').getAttribute('aria-describedby') === document.querySelector('.vp-save-error').id`), 'the line is an alert and the control points at it');
  r.check((await now(plain)).visibility === 'people' && /Chosen people/.test(await tab.eval(TEXT('.vp-change'))), 'the control still shows the setting that is true');
  await inBoth(tab, async (mode) => { await shot(tab, `window-error-1280-${mode}`); });
  // The picker's failed save.
  await tab.click('.vp-change');
  await tab.click('[role=menuitemradio]', 'Chosen people');
  await tab.waitFor(PICKER);
  await tab.click('.vp-person', 'Ben Weiss');
  await tab.click(`${PICKER} .btn-primary`);
  await tab.waitFor(`${PICKER} .vp-error:not([hidden])`);
  const perr = await tab.eval(TEXT(`${PICKER} .vp-error`));
  r.check(/We couldn't save who can see this\. Nothing changed\. Try again\./.test(perr) && (await tab.eval(`document.querySelector('${PICKER} .vp-error').getAttribute('role')`)) === 'alert', `a failed save is said at the top of the picker (${perr})`);
  r.check((await tab.eval(COUNT(PICKER))) === 1 && (await tab.eval(TEXT('.vp-count'))) === '2 of 200 chosen', 'the picker stays open with the choices as they were');
  await inBoth(tab, async (mode) => { await shot(tab, `picker-error-1280-${mode}`); });
  await stop1();
  await tab.click(`${PICKER} .btn-primary`);
  await until(tab, COUNT(PICKER), (v) => v === 0);
  r.check((await now(plain)).people.length === 2, 'Done again, with the network back, saves it');
  // A narrowing with nothing linked just happens.
  await tab.click('.vp-change');
  await tab.click('[role=menuitemradio]', 'Only me');
  await until(tab, TEXT('.vp-change'), (v) => /Only me/.test(v));
  r.check((await tab.eval(COUNT(ASK))) === 0 && (await now(plain)).visibility === 'only-me', 'a narrowing with no links and no share link asks nothing');
  await tab.close();
  tab = null;
} catch (err) {
  r.check(false, err.stack || String(err));
} finally {
  await stop(env, browser, tab);
}
r.done();
