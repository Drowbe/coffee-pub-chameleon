#!/usr/bin/env node
/*
 * check-vault-privacy-add.mjs -- Add files with "Who can see this", and the people picker (plan-vault-privacy.md, slice 3), in a real
 * browser against a throwaway server (no LiveKit). The three choices and the sentence that it applies to every file added now; Choose
 * people and Change people; what the server holds after files are added under each choice; the picker: the people of the trip, owners
 * shown as Always can, searching, no match, no one to choose, N of 200, the keyboard, a phone's picker (chips wrap whole, rows 44px), light
 * and dark. With no Chromium it says SKIPPED (set CHROME_PATH); that is not a pass. VAULT_SHOTS=<folder> keeps a picture of each state.
 */
import { boot, stop, openVault, reporter, findBrowser, startBrowser, TEXT, COUNT, PRESS, until, shot, inBoth, sleep, ROOTS } from './lib/privacy-lib.mjs';

const r = reporter('check-vault-privacy-add');
const bin = findBrowser();
if (!bin) { console.log('check-vault-privacy-add: SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); process.exit(0); }
let env; let browser; let tab;
const key = async (t, k, code, vk, text) => {
  await t.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) }, t.sid);
  await t.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }, t.sid);
};
const give = (name) => `(() => { ${ROOTS} for (const r of roots) { const i = r.querySelector('#picker'); if (i) { const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))], ${JSON.stringify(name)}, { type: 'image/png' })); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; } } return false; })()`;
const PICKER = 'dialog.vp-sheet[open]';
const openAdd = async (t) => { await t.eval(PRESS('button[aria-label="Add files"]')); await t.waitFor('#module-frame >>> #who-choices input'); await sleep(300); };
const choose = async (t, word) => { await t.click('#module-frame >>> #who-choices label', word); await sleep(200); };
try {
  env = await boot('vault-privacy-add');
  const solo = (await env.ok('admin', 'POST', '/api/spaces', { name: 'Just Lee', members: [env.keys.lee] })).space.id;
  browser = await startBrowser(bin);
  tab = await openVault(env, browser, 'lee', { wait: '#module-frame >>> .vt-empty-in' });
  await openAdd(tab);

  // The three choices, the default, and the sentence.
  const labels = await tab.eval(TEXT('#who-choices .sdk-choice-label'));
  r.check(labels === 'Everyone in this trip | Only me | Chosen people', `the three choices read as drawn, in the trip's word (${labels})`);
  r.check(await tab.eval(`document.querySelector('#module-frame').shadowRoot.querySelector('#who-choices input[value=everyone]').checked`), 'Everyone is the default');
  r.check(await tab.eval(`document.querySelector('#module-frame').shadowRoot.querySelector('#who-choices').getAttribute('role') === 'radiogroup'`), 'the choices are a radio group');
  let line = await tab.eval(TEXT('#add-line'));
  r.check(/Everyone in this trip can see what you add\. This is the default\. It applies to every file you add now\./.test(line), `the default sentence (${line})`);
  await inBoth(tab, async (mode) => { await shot(tab, `add-everyone-1280-${mode}`); });
  await choose(tab, 'Only me');
  line = await tab.eval(TEXT('#add-line'));
  r.check(/Only you and the owners can see what you add\. It applies to every file you add now\./.test(line), `the Only me sentence (${line})`);
  r.check((await tab.eval(COUNT('#who-pick'))) === 0, 'Choose people is not shown for Only me');
  await choose(tab, 'Chosen people');
  r.check((await tab.eval(TEXT('#who-pick'))).includes('Choose people'), 'Chosen people shows a Choose people button');
  line = await tab.eval(TEXT('#add-line'));
  r.check(/Only you and the owners until you choose someone\./.test(line), `no one chosen yet says so (${line})`);
  await inBoth(tab, async (mode) => { await shot(tab, `add-chosen-none-1280-${mode}`); });

  // Chosen people with no one picked adds the file as Only me (the server refuses an empty list; the two read the same).
  await tab.eval(give('Nobody picked.png'));
  await until(tab, `(async () => (await (await fetch('/api/modules/vault/library?space=${env.trip}')).json()).files.length)()`, (v) => v >= 1);
  const first = (await env.listOf('lee')).find((f) => f.name === 'Nobody picked.png');
  r.check(first && first.visibility === 'only-me', `a batch for Chosen people with no one chosen is held as Only me (${first && first.visibility})`);
  await sleep(1800);

  // The picker.
  await openAdd(tab);
  r.check(await tab.eval(`document.querySelector('#module-frame').shadowRoot.querySelector('#who-choices input[value=everyone]').checked`), 'Add files starts at Everyone again: the choice is not remembered');
  await choose(tab, 'Chosen people');
  await tab.click('#module-frame >>> #who-change');
  await tab.waitFor(PICKER);
  await sleep(300);
  const rows = await tab.eval(TEXT('.vp-person'));
  r.check(/Noor Haddad[\s\S]*Always can/.test(rows) && /Ana Costa/.test(rows) && /Mia Alvarez/.test(rows) && !/Lee Chen/.test(rows) && !/Zed/.test(rows), `the picker lists the trip's people but not Lee (the adder) nor Zed (not in it); the owner is "Always can" (${rows.replace(/\n/g, ' ')})`);
  r.check((await tab.eval(COUNT('.vp-locked input'))) === 0, 'an owner row cannot be ticked');
  r.check((await tab.eval(TEXT('.vp-count'))) === '0 of 200 chosen', 'the count reads 0 of 200 chosen');
  await shot(tab, 'picker-open-1280-light');
  await tab.typeInto('.vp-sheet .sdk-search input', 'zzz');
  r.check(/No one matches "zzz"\./.test(await tab.eval(TEXT('.vp-people'))), 'a search with no match says so');
  await shot(tab, 'picker-nomatch-1280-light');
  await tab.eval(`(() => { const i = document.querySelector('.vp-sheet .sdk-search input'); i.value = 'a'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const found = await tab.eval(TEXT('.vp-person'));
  r.check(/Ana/.test(found) && !/Ben/.test(found), `searching "a" narrows the list (${found.replace(/\n/g, ' ')})`);
  await tab.eval(`(() => { const i = document.querySelector('.vp-sheet .sdk-search input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  for (const n of ['Ana Costa', 'Ben Weiss', 'Chloe Martin']) await tab.click('.vp-person', n);
  r.check((await tab.eval(TEXT('.vp-count'))) === '3 of 200 chosen', 'three ticked: 3 of 200 chosen');
  const chips = await tab.eval(TEXT('.vp-chosen'));
  r.check(/Lee Chen \(you\)/.test(chips) && /Ana Costa/.test(chips) && /Chloe Martin/.test(chips), `the chips: the adder first, then the three (${chips.replace(/\n/g, ' ')})`);
  r.check((await tab.eval(COUNT('.vp-chosen .sdk-avatar'))) === 4 && (await tab.eval(COUNT('.vp-person .sdk-avatar'))) >= 6, 'people are shown by name with a small avatar');
  await inBoth(tab, async (mode) => { await shot(tab, `picker-three-1280-${mode}`); });
  // Keyboard: the x on a chip takes someone off and the focus stays among the chips; Escape cancels.
  await tab.eval(`(() => { document.querySelector('.vp-chosen .sdk-chip-x').focus(); })()`);
  await key(tab, 'Enter', 'Enter', 13, '\r');
  await sleep(200);
  r.check((await tab.eval(TEXT('.vp-count'))) === '2 of 200 chosen', 'Enter on a chip\'s x takes the person off');
  r.check(await tab.eval(`document.activeElement && document.activeElement.classList.contains('sdk-chip-x')`), 'the focus moves to the next chip\'s x');
  await tab.eval(`document.querySelector('.vp-person input').focus()`);
  await key(tab, ' ', 'Space', 32, ' ');
  await sleep(150);
  r.check((await tab.eval(TEXT('.vp-count'))) === '3 of 200 chosen', 'Space ticks the focused person');
  await key(tab, 'Escape', 'Escape', 27);
  await sleep(300);
  r.check((await tab.eval(COUNT(PICKER))) === 1 && (await tab.eval(`!document.querySelector('${PICKER} .action-bar-ask').hidden`)), 'Escape on a changed choice asks "Discard changes?" first');
  await tab.click(`${PICKER} .action-bar-discard`);
  await sleep(300);
  r.check((await tab.eval(COUNT(PICKER))) === 0, 'Discard closes the picker');
  r.check(/Choose people/.test(await tab.eval(TEXT('#who-change'))), 'cancelling changes nothing (still Choose people)');
  await tab.click('#module-frame >>> #who-change');
  await tab.waitFor(PICKER);
  for (const n of ['Ana Costa', 'Ben Weiss', 'Chloe Martin']) await tab.click('.vp-person', n);
  await tab.click(`${PICKER} .btn-primary`);
  await sleep(300);
  r.check((await tab.eval(COUNT(PICKER))) === 0, 'Done closes the picker');
  r.check(/Change people/.test(await tab.eval(TEXT('#who-change'))), 'the button now reads Change people');
  r.check(/Ana Costa, Ben Weiss and Chloe Martin/.test(await tab.eval(TEXT('#who-names'))), 'the names chosen show beside it');
  line = await tab.eval(TEXT('#add-line'));
  r.check(/You, the owners and 3 people can see what you add\. It applies to every file you add now\./.test(line), `the sentence counts the people (${line})`);
  await inBoth(tab, async (mode) => { await shot(tab, `add-chosen-three-1280-${mode}`); });
  await tab.eval(give('For three.png'));
  const got = await until(tab, `(async () => (await (await fetch('/api/modules/vault/library?space=${env.trip}')).json()).files.map((f) => f.name).join())`, (v) => /For three/.test(v));
  const three = (await env.listOf('lee')).find((f) => f.name === 'For three.png');
  r.check(three && three.visibility === 'people' && three.people.length === 3 && [env.keys.ana, env.keys.ben, env.keys.chloe].every((k) => three.people.includes(k)), `the file is held for the three people (${JSON.stringify(three && three.people)}; ${got})`);
  await sleep(1800);
  await tab.close();

  // Only me.
  tab = await openVault(env, browser, 'lee');
  await openAdd(tab);
  await choose(tab, 'Only me');
  await shot(tab, 'add-onlyme-1280-light');
  await tab.eval(give('Mine only.png'));
  await until(tab, `(async () => (await (await fetch('/api/modules/vault/library?space=${env.trip}')).json()).files.map((f) => f.name).join())`, (v) => /Mine only/.test(v));
  r.check((await env.listOf('lee')).find((f) => f.name === 'Mine only.png')?.visibility === 'only-me', 'Only me is held as only-me');
  r.check(!(await env.listOf('sam')).some((f) => f.name === 'Mine only.png'), 'Sam does not get it');
  await tab.close();

  // A batch still going up: the choices are off, so a file is never published wider than the screen said when it started.
  tab = await openVault(env, browser, 'lee');
  await openAdd(tab);
  await choose(tab, 'Only me');
  const slowed = [];
  const hold = (m) => {
    if (m.method !== 'Fetch.requestPaused' || m.sessionId !== tab.sid) return;
    const q = m.params;
    if (q.request.method === 'POST' && /\/library\?/.test(q.request.url)) setTimeout(() => tab.cdp.send('Fetch.continueRequest', { requestId: q.requestId }, tab.sid).catch(() => {}), 3000);
    else tab.cdp.send('Fetch.continueRequest', { requestId: q.requestId }, tab.sid).catch(() => {});
  };
  tab.cdp.listeners.push(hold);
  await tab.cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/library?*', requestStage: 'Request' }] }, tab.sid);
  for (let i = 1; i <= 4; i += 1) { await tab.eval(give(`Slow ${i}.png`)); slowed.push(`Slow ${i}.png`); }
  await sleep(200);
  const locked = await tab.eval(`(() => { const root = document.querySelector('#module-frame').shadowRoot; return { off: [...root.querySelectorAll('#who-choices input')].every((i) => i.disabled), pick: root.querySelector('#who-change').disabled, line: root.querySelector('#add-line').innerText }; })()`);
  r.check(locked.off && locked.pick, 'while files are waiting or going up the three choices and Choose people are off');
  r.check(/keep the choice they were picked with/.test(locked.line) && !/applies to every file you add now/.test(locked.line), `the sentence says the waiting files keep their choice (${locked.line})`);
  await tab.eval(`(() => { const i = document.querySelector('#module-frame').shadowRoot.querySelector('#who-choices input[value=everyone]'); i.disabled = false; i.click(); })()`).catch(() => {});
  await until(tab, `(async () => (await (await fetch('/api/modules/vault/library?space=${env.trip}')).json()).files.filter((f) => /^Slow /.test(f.name)).length)()`, (v) => v === 4, 30000);
  const heldFiles = (await env.listOf('lee')).filter((f) => /^Slow /.test(f.name));
  r.check(heldFiles.length === 4 && heldFiles.every((f) => f.visibility === 'only-me'), `all four slowed files were held as only-me, as the screen said when they were picked (${heldFiles.map((f) => f.visibility)})`);
  await tab.cdp.send('Fetch.disable', {}, tab.sid);
  tab.cdp.listeners = tab.cdp.listeners.filter((f) => f !== hold);
  await tab.close();

  // A file the server turned away with a 503 waits for Try again: the choices stay off, and it lands as it was picked.
  tab = await openVault(env, browser, 'lee');
  await openAdd(tab);
  let refuse = true;
  const gate = (m) => {
    if (m.method !== 'Fetch.requestPaused' || m.sessionId !== tab.sid) return;
    const q = m.params;
    if (refuse && q.request.method === 'POST' && /\/library\?/.test(q.request.url)) tab.cdp.send('Fetch.fulfillRequest', { requestId: q.requestId, responseCode: 503, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{"error":"Busy."}').toString('base64') }, tab.sid).catch(() => {});
    else tab.cdp.send('Fetch.continueRequest', { requestId: q.requestId }, tab.sid).catch(() => {});
  };
  tab.cdp.listeners.push(gate);
  await tab.cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/library?*', requestStage: 'Request' }] }, tab.sid);
  await tab.eval(give('Retry 1.png'));
  await tab.waitFor('#module-frame >>> .vt-up-bad', '', 30000);
  const waiting = await tab.eval(`(() => { const root = document.querySelector('#module-frame').shadowRoot; return { off: [...root.querySelectorAll('#who-choices input')].every((i) => i.disabled) && root.querySelector('#who-change').disabled, line: root.querySelector('#add-line').innerText }; })()`);
  r.check(waiting.off && /waiting to be tried again/.test(waiting.line) && !/applies to every file you add now/.test(waiting.line), `a file waiting for Try again keeps the choices off and the sentence says so (${waiting.line})`);
  refuse = false;
  await tab.click('#module-frame >>> button', 'Try adding');
  await until(tab, `(async () => (await (await fetch('/api/modules/vault/library?space=${env.trip}')).json()).files.filter((f) => /^Retry 1/.test(f.name)).length)()`, (v) => v === 1, 30000);
  r.check((await env.listOf('lee')).find((f) => /^Retry 1/.test(f.name))?.visibility === 'everyone', 'the retried file lands as it was picked (Everyone)');
  await tab.cdp.send('Fetch.disable', {}, tab.sid);
  tab.cdp.listeners = tab.cdp.listeners.filter((f) => f !== gate);
  await tab.close();

  // No one to choose.
  tab = await openVault(env, browser, 'lee', { space: solo, wait: '#module-frame >>> .vt-empty-in' });
  await openAdd(tab);
  await choose(tab, 'Chosen people');
  await tab.click('#module-frame >>> #who-change');
  await tab.waitFor(PICKER);
  r.check(/No one else is in this trip yet\. Only you and the owners can see what you add\./.test(await tab.eval(TEXT('.vp-people'))), 'a trip with only the adder says no one is there');
  await shot(tab, 'picker-nobody-1280-light');
  await tab.close();

  // A phone: the Add files choices and the picker.
  tab = await openVault(env, browser, 'lee', { size: 390, touch: true });
  await openAdd(tab);
  await choose(tab, 'Chosen people');
  const small = await tab.eval(`(() => { const root = document.querySelector('#module-frame').shadowRoot; return [...root.querySelectorAll('#who-choices .sdk-choice-row, #who-change')].map((e) => Math.round(e.getBoundingClientRect().height)); })()`);
  r.check(small.every((h) => h >= 44), `390: the choices and the button are 44px or taller (${small})`);
  await inBoth(tab, async (mode) => { await shot(tab, `add-chosen-390-${mode}`); });
  await tab.click('#module-frame >>> #who-change');
  await tab.waitFor(PICKER);
  await sleep(300);
  const ph = await tab.eval(`(() => { const d = document.querySelector('${PICKER}'); const b = d.getBoundingClientRect(); const rows = [...d.querySelectorAll('.vp-person')].map((e) => e.getBoundingClientRect().height); const btn = [...d.querySelectorAll('.btn')].map((e) => e.getBoundingClientRect().height).filter((h) => h > 0); return { w: Math.round(b.width), vw: innerWidth, rows: Math.min(...rows), btn: Math.min(...btn) }; })()`);
  r.check(ph.w >= ph.vw - 40 && ph.rows >= 44 && ph.btn >= 44, `390: a sheet that fills the width, rows and buttons 44px (${JSON.stringify(ph)})`);
  await inBoth(tab, async (mode) => { await shot(tab, `picker-390-${mode}`); });
  await tab.close();
  tab = null;
} catch (err) {
  r.check(false, err.stack || String(err));
} finally {
  await stop(env, browser, tab);
}
r.done();
