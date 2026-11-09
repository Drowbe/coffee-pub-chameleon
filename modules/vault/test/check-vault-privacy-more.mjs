#!/usr/bin/env node
/*
 * check-vault-privacy-more.mjs -- the rest of the Vault's privacy interface (plan-vault-privacy.md, slice 3), in a real browser against a
 * throwaway server (no LiveKit): the picker at 200 of 200 (and on a phone), an owner's and the admin's notice in the file window, the
 * read-only line for a person a file is shared with (the server does not send the word to them yet, so the answer is edited in the
 * browser; marked below), the share sheet's sentence for a restricted file, a link to a hidden file (the server's answer carries no name
 * and reads hidden; "File removed" only to those who could see it), the "See every file" row in Roles (words, locks, contrast), and no
 * colour outside the theme tokens in what this change added. Light and dark. With no Chromium it says SKIPPED (set CHROME_PATH).
 * VAULT_SHOTS=<folder> keeps a picture of each state.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, stop, openVault, openWindow, showInfo, intercept, reporter, findBrowser, launch, TEXT, COUNT, until, shot, inBoth, sleep, CONTRAST, Tab } from './lib/privacy-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const r = reporter('check-vault-privacy-more');

// No colour outside the tokens, in the files this change added or changed (no browser needed).
{
  const files = ['modules/vault/src/vault.js', 'modules/vault/src/vault.css', 'modules/vault/src/vault.html', 'public/vault-privacy.js', 'public/vault-privacy.css', 'public/share-sheet.css'];
  const raw = /#[0-9a-fA-F]{3,8}(?![\w-])|\brgba?\(|\bhsla?\(|\bhwb\(|\blab\(|\boklch\(/;
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n').replace(/'[^'\n]*\$\{[^}]*\}[^'\n]*'/g, '');
    const hit = text.split('\n').find((l) => raw.test(l.replace(/&#\d+;/g, '').replace(/url\([^)]*\)/g, '')));
    r.check(!hit, `${f} has a colour outside the theme tokens: ${hit && hit.trim().slice(0, 100)}`);
  }
}

const bin = findBrowser();
if (!bin) { console.log('check-vault-privacy-more: SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); process.exit(r.failed ? 1 : 0); }
let env; let browser; let tab;
const PICKER = 'dialog.vp-sheet[open]';
try {
  env = await boot('vault-privacy-more', { extraMembers: 200 });
  const K = env.keys;
  await env.ok('admin', 'PATCH', `/api/spaces/${env.trip}`, { members: [...env.members, ...env.extra] });
  await env.ok('admin', 'POST', '/api/modules/bundled/travel/install');
  await env.ok('admin', 'PATCH', '/api/modules/travel', { enabled: true });
  await env.ok('admin', 'PATCH', '/api/roles/member', { 'module.vault.share': true });
  const big = await env.file('lee', 'Two hundred.png', 'people', env.extra);
  const only = await env.file('lee', 'Only for Lee.png', 'only-me');
  const forSam = await env.file('lee', 'For Sam.png', 'people', ['sam']);
  const open = await env.file('lee', 'For everyone.png');
  browser = await launch(bin);

  // 200 of 200, at 1280 and on a phone.
  for (const size of [1280, 390]) {
    tab = await openVault(env, browser, 'lee', { size, touch: size < 500 });
    await openWindow(tab, 'Two hundred.png');
    await showInfo(tab);
    await tab.click('.vp-change');
    await tab.click('[role=menuitemradio]', 'Chosen people');
    await tab.waitFor(PICKER);
    await sleep(400);
    r.check((await tab.eval(TEXT('.vp-count'))) === '200 of 200 chosen', `${size}: the picker holds 200 of 200 chosen`);
    const lim = await tab.eval(`(() => { const d = document.querySelector('${PICKER}'); const boxes = [...d.querySelectorAll('.vp-person input')]; const ch = d.querySelector('.vp-chosen'); const chips = [...ch.querySelectorAll('.sdk-chip-removable')]; const box = ch.getBoundingClientRect(); return { limit: !d.querySelector('.vp-limit').hidden && d.querySelector('.vp-limit').offsetHeight > 0, off: boxes.filter((b) => !b.checked).every((b) => b.disabled), unticked: boxes.filter((b) => !b.checked).length, scrolls: ch.scrollHeight > ch.clientHeight, cutSide: chips.some((c) => c.getBoundingClientRect().right > box.right + 1), maxH: ch.clientHeight, more: /more\\. Search/.test(d.querySelector('.vp-people').innerText) }; })()`);
    r.check(lim.limit, `${size}: a message says why nothing more can be ticked`);
    r.check(lim.off && lim.scrolls && !lim.cutSide, `${size}: the rest of the list is off, the chips scroll and none is cut at the side (${JSON.stringify(lim)})`);
    if (size === 390) r.check(lim.maxH <= 140, `390: the chips show whole rows in at most 140px (${lim.maxH})`);
    await inBoth(tab, async (mode) => { await shot(tab, `picker-200-${size}-${mode}`); });
    await tab.close();
  }

  // An owner and the admin open a file that was not shared with them.
  for (const [who, because] of [['noor', /because you are an owner\./], ['admin', /because you are the admin\./]]) {
    tab = await openVault(env, browser, who);
    await openWindow(tab, 'Only for Lee.png');
    await showInfo(tab);
    const t = await tab.eval(TEXT('.vp-who-info'));
    r.check(/This file is not shared with you\./.test(t) && because.test(t) && /Lee Chen can see it\./.test(t), `${who}: the window says it is not shared with them (${t.replace(/\n/g, ' ')})`);
    r.check((await tab.eval(COUNT('.vp-change'))) === 1, `${who}: the same control changes who can see it`);
    await inBoth(tab, async (mode) => { await shot(tab, `window-${who}-1280-${mode}`); });
    await tab.close();
  }

  // The person it is shared with. The server does not send them the word yet, so the list answer is edited in the browser.
  tab = await openVault(env, browser, 'sam');
  const stopEdit = await intercept(tab, { patterns: [{ urlPattern: '*/library?space=*', requestStage: 'Response' }], edit: (q, body) => (body && body.files ? { ...body, files: body.files.map((f) => (f.name === 'For Sam.png' ? { ...f, visibility: 'people' } : f)) } : body) });
  await tab.cdp.send('Page.reload', {}, tab.sid);
  await tab.waitFor('#module-frame >>> .vt-row');
  await openWindow(tab, 'For Sam.png');
  await showInfo(tab);
  const ro = await tab.eval(TEXT('.fv-info'));
  r.check(/Shared with you and others\./.test(ro) && (await tab.eval(COUNT('.vp-change, .vp-namelist'))) === 0 && !/Ana|Chen|Lee/.test(await tab.eval(TEXT('.vp-readonly'))), 'a person it is shared with gets one read-only line: no control, no names, no count');
  await inBoth(tab, async (mode) => { await shot(tab, `window-readonly-1280-${mode}`); });
  await stopEdit();
  await tab.close();
  tab = await openVault(env, browser, 'sam');
  await openWindow(tab, 'For everyone.png');
  await showInfo(tab);
  r.check((await tab.eval(COUNT('.vp-who-info'))) === 0, 'a file for everyone has no "Who can see this" block for a member');
  await tab.close();

  // The share sheet for a restricted file says the link ends.
  tab = await openVault(env, browser, 'lee');
  await openWindow(tab, 'Only for Lee.png');
  await tab.eval(`[...document.querySelectorAll('.fv-win.is-front .mf-toolbar button')].find((b) => /Share/.test(b.innerText)).click()`);
  await tab.waitFor('dialog.sh-sheet[open] .sh-restrict');
  const sh = await tab.eval(TEXT('dialog.sh-sheet .sh-restrict'));
  r.check(/Anyone with this link can open a file that is not shared with everyone here, even people it is not shared with\. The link ends if you can no longer see the file\./.test(sh), `the share sheet says it (${sh})`);
  await inBoth(tab, async (mode) => { await shot(tab, `share-sheet-1280-${mode}`); });
  await tab.close();

  // A link to a hidden file reads hidden, never the name; after the file is deleted only those who could see it read "File removed".
  const ptr = (f) => ({ module: 'vault', kind: 'file', id: f.id, scope: 'space', space: env.trip });
  await env.api('mia', 'PUT', `/api/modules/travel/data/${encodeURIComponent('plan:p2')}?scope=space&space=${env.trip}`, { value: { kind: 'stay', title: 'Linked stay', date: '2026-10-24', files: [ptr(only)] } });
  await env.api('mia', 'POST', '/api/objects/links', { module: 'travel', from: { module: 'travel', kind: 'plan', id: 'p2', scope: 'space', space: env.trip }, to: [ptr(only)], kind: 'file', op: 'add' });
  const from = `/api/objects/links?from=travel&dir=from&ref=${encodeURIComponent(JSON.stringify({ module: 'travel', kind: 'plan', id: 'p2', scope: 'space', space: env.trip }))}`;
  const asSam = await env.api('sam', 'GET', from);
  r.check(asSam.status === 200 && !JSON.stringify(asSam.json).includes('Only for Lee') && !JSON.stringify(asSam.json).includes(only.id), 'a member who cannot see the file gets no name and no id in the link answer');
  r.check(!JSON.stringify(asSam.json).includes('File removed'), 'and it is not "File removed"');
  const sdk = fs.readFileSync(path.join(ROOT, 'public/sdk/host.js'), 'utf8');
  r.check(/state === 'removed'[\s\S]{0,200}File removed/.test(sdk) && /Not available to you/.test(sdk) && /s\.state === 'gone' \? 'removed' : 'hidden'/.test(sdk), 'the file chips say "Not available to you" for hidden and "File removed" for gone (read as code)');
  await env.api('lee', 'DELETE', `/api/modules/vault/library/${only.id}?space=${env.trip}`);
  const gone = await env.api('sam', 'GET', from);
  r.check(!JSON.stringify(gone.json).includes('File removed'), 'after deletion, a member who could never see the file reads nothing of it');
  // Whether the person who could see it should read "File removed" is the server's gone-link rule (plan-vault-privacy.md, decision 10,
  // slice 4); the page draws what the server sends, so this only reports what it sends now.
  const goneLee = await env.api('lee', 'GET', from);
  r.say(`after deletion the person who could see the file is sent ${JSON.stringify(goneLee.json).slice(0, 120)} (the server's gone-link rule, slice 4, decides this)`);

  // Roles: the new row.
  tab = new Tab(browser.cdp, {});
  await tab.open(1280, 'light');
  for (const kv of env.jars.admin.split('; ')) { const i = kv.indexOf('='); await tab.cdp.send('Network.setCookie', { name: kv.slice(0, i), value: kv.slice(i + 1), url: env.server.base, httpOnly: true }, tab.sid); }
  await tab.cdp.send('Page.navigate', { url: `${env.server.base}/admin#roles` }, tab.sid);
  await tab.waitFor('#roles-table tbody tr th', 'See every file');
  await until(tab, `(() => { const t = document.getElementById('tab-roles'); return !!t && !t.hidden; })()`, Boolean, 8000);
  await sleep(500);
  await tab.waitFor('#roles-table tbody tr th', 'See every file');
  const row = await tab.eval(`(() => { const th = [...document.querySelectorAll('#roles-table tbody th[scope=row]')].find((x) => x.textContent.includes('See every file')); const tr = th.parentElement; return { text: th.innerText.replace(/\\n/g, ' '), boxes: [...tr.querySelectorAll('input')].map((i) => ({ role: i.dataset.role, off: i.disabled, on: i.checked, title: i.title })) }; })()`);
  r.check(/Lets this role open files that were not shared with them\. Off by default for moderators; owners always can\./.test(row.text), `the row explains itself (${row.text})`);
  const by = Object.fromEntries(row.boxes.map((b) => [b.role, b]));
  r.check(by.owner.off && by.owner.on && by.guest.off && !by.guest.on && !by.moderator.off && !by.moderator.on && !by.member.on && /never do this/.test(by.guest.title), `owners locked on, guests locked off, moderators and members off and editable (${JSON.stringify(row.boxes.map((b) => [b.role, b.on, b.off]))})`);
  await tab.eval(`document.querySelector('#roles-table tbody th[scope=row] .sdk-table-sub').scrollIntoView({ block: 'center' })`);
  await tab.eval(CONTRAST);
  await inBoth(tab, async (mode) => {
    const ratio = await tab.eval(`window.__ratio([...document.querySelectorAll('#roles-table .sdk-table-sub')].find((e) => /Lets this role/.test(e.textContent)))`);
    r.check(ratio >= 4.5, `the row's description is ${ratio.toFixed(2)}:1 in ${mode}`);
    await shot(tab, `roles-1280-${mode}`);
  });
  await tab.eval(`document.querySelector('#roles-table input[data-role="moderator"][data-perm="module.vault.see_all"]').click()`);
  await until(tab, `document.getElementById('roles-status').textContent`, (v) => /saved/.test(v), 5000);
  r.check((await env.ok('admin', 'GET', '/api/roles')).roles.moderator['module.vault.see_all'] === true, 'ticking the moderator box turns it on');
  await tab.close();
  tab = null;
} catch (err) {
  r.check(false, err.stack || String(err));
} finally {
  await stop(env, browser, tab);
}
r.done();
