#!/usr/bin/env node
/*
 * check-vault-privacy-list.mjs -- the Vault's list and Grid with who can see which file (plan-vault-privacy.md, slice 3), in a real
 * browser against a throwaway server (no LiveKit). The adder's marks ("Only me", "3 people"), an owner's "Not shared with you", light and
 * dark at 1280 and at 390, and that a member who cannot see a file sees nothing of it: not in the list, the Grid, search, the counts, the
 * Added by choices, nor in any text, title, label or value on the page, and an empty list reads exactly as a Vault with no files.
 * With no Chromium it says SKIPPED (set CHROME_PATH); that is not a pass. VAULT_SHOTS=<folder> keeps a picture of each state.
 */
import { boot, stop, openVault, reporter, findBrowser, launch, TEXT, COUNT, EVERYTHING, until, shot, inBoth, sleep } from './lib/privacy-lib.mjs';

const r = reporter('check-vault-privacy-list');
const bin = findBrowser();
if (!bin) { console.log('check-vault-privacy-list: SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); process.exit(0); }
let env; let browser; let tab;
try {
  env = await boot('vault-privacy-list');
  const HIDDEN = ['Mia secret plan', 'Only for Lee', 'Chosen for three', 'Ana to Sam'];
  await env.file('lee', 'Everyone sees this.png');
  await env.file('lee', 'Only for Lee.png', 'only-me');
  await env.file('lee', 'Chosen for three.png', 'people', ['ana', 'ben', 'sam']);
  await env.file('mia', 'Mia secret plan.png', 'only-me');
  await env.file('ana', 'Ana to Sam.png', 'people', ['sam']);
  // A second trip where a member can see nothing of what is there, and a third with no file at all.
  const hiddenTrip = (await env.ok('admin', 'POST', '/api/spaces', { name: 'Hidden trip', members: [env.keys.lee, env.keys.sam] })).space.id;
  const emptyTrip = (await env.ok('admin', 'POST', '/api/spaces', { name: 'Empty trip', members: [env.keys.lee, env.keys.sam] })).space.id;
  await env.file('lee', 'Lee alone.png', 'only-me', null, hiddenTrip);
  browser = await launch(bin);

  // The adder (Lee): marks on his own files only, in both themes, at 1280.
  tab = await openVault(env, browser, 'lee');
  await tab.waitFor('#module-frame >>> .vt-row');
  const rows = await tab.eval(COUNT('.vt-row'));
  r.check(rows === 3, `Lee sees 3 rows (his three; Mia's and Ana's are not for him), saw ${rows}`);
  const text = await tab.eval(TEXT('.vt-row'));
  r.check(/Only for Lee[\s\S]*Only me/.test(text) && /Chosen for three[\s\S]*3 people/.test(text), `Lee's marks read "Only me" and "3 people" (${text.replace(/\n/g, ' ')})`);
  r.check(await tab.eval(`(() => { const rows = [...document.querySelector('#module-frame').shadowRoot.querySelectorAll('.vt-row')]; const plain = rows.find((x) => x.textContent.includes('Everyone sees this')); return plain && !plain.querySelector('.vt-vis'); })()`), 'a file for everyone carries no mark');
  r.check(!/Not shared with you/.test(await tab.eval(EVERYTHING)), 'Lee is never told "Not shared with you"');
  await inBoth(tab, async (mode) => { await shot(tab, `list-lee-1280-${mode}`); });
  await tab.click('.mf-switch-btn', 'Grid');
  await until(tab, COUNT('.vt-card'), (v) => v === 3);
  r.check((await tab.eval(COUNT('.vt-card-marks .vt-vis'))) === 2, 'the Grid draws the two marks on their own line under the facts');
  await inBoth(tab, async (mode) => { await shot(tab, `grid-lee-1280-${mode}`); });
  await tab.click('.mf-switch-btn', 'List');
  // The adder's search for a name he cannot see finds nothing.
  await tab.typeInto('.mf-search input', 'Mia secret');
  await until(tab, COUNT('.vt-empty-in'), (v) => v >= 1);
  const none = await tab.eval(TEXT('.vt-empty-in'));
  r.check(/No files match/.test(none) && !/Mia|secret/i.test(none), `searching a hidden name reads "No files match." and nothing more (${none.replace(/\n/g, ' ')})`);
  await tab.close();

  // A member (Sam) the files are shared with, and one they are not: nothing of the others anywhere.
  tab = await openVault(env, browser, 'sam');
  await tab.waitFor('#module-frame >>> .vt-row');
  const samNames = await tab.eval(TEXT('.vt-title'));
  r.check(/Everyone sees this/.test(samNames) && /Chosen for three/.test(samNames) && /Ana to Sam/.test(samNames), `Sam sees the three shared with him (${samNames})`);
  const gone = ['Only for Lee', 'Mia secret plan'];
  const all = await tab.eval(EVERYTHING);
  r.check(!gone.some((n) => all.includes(n)), 'nothing of the two files hidden from Sam is on his page (text, titles, labels)');
  const status = await tab.eval(TEXT('.mf-status'));
  r.check(/3 files/.test(status), `the status line counts only what Sam sees ("${status}")`);
  await tab.typeInto('.mf-search input', 'secret');
  await until(tab, COUNT('.vt-empty-in'), (v) => v >= 1);
  r.check(/No files match/.test(await tab.eval(TEXT('.vt-empty-in'))), 'Sam searching a hidden name gets "No files match."');
  await tab.close();

  // A member who can see nothing in a Vault that holds a file reads the same words as a Vault with none.
  const emptyText = async (space) => { const t = await openVault(env, browser, 'sam', { space, wait: '#module-frame >>> .vt-empty-in' }).catch(async (e) => { throw new Error(`${e.message}`); }); const v = await t.eval(TEXT('.vt-empty-in')); const s = await t.eval(TEXT('.mf-status')); const e = await t.eval(EVERYTHING); await t.close(); return { v, s, e }; };
  const a = await emptyText(hiddenTrip);
  const b = await emptyText(emptyTrip);
  r.check(a.v === b.v && a.s.replace(/Hidden trip|Empty trip/g, '') === b.s.replace(/Hidden trip|Empty trip/g, ''), `the empty list and status read the same with and without a hidden file ("${a.v.replace(/\n/g, ' ')}" / "${a.s}" vs "${b.v.replace(/\n/g, ' ')}" / "${b.s}")`);
  r.check(!a.e.includes('Lee alone'), 'the hidden file\'s name is not on the empty page');

  // The owner (Noor): every file, and "Not shared with you" on the ones not given to her.
  tab = await openVault(env, browser, 'noor');
  await tab.waitFor('#module-frame >>> .vt-row');
  r.check((await tab.eval(COUNT('.vt-row'))) === 5, 'the owner sees all five files');
  const noorText = await tab.eval(TEXT('.vt-row'));
  r.check((noorText.match(/Not shared with you/g) || []).length === 4, `four rows read "Not shared with you" for the owner (${(noorText.match(/Not shared with you/g) || []).length})`);
  r.check(!/Everyone sees this[^|]*Not shared/.test(noorText.replace(/\n/g, ' ')), 'the file for everyone is not marked for the owner');
  await inBoth(tab, async (mode) => { await shot(tab, `list-owner-1280-${mode}`); });
  await tab.click('.mf-switch-btn', 'Grid');
  await until(tab, COUNT('.vt-card'), (v) => v === 5);
  r.check((await tab.eval(COUNT('.vt-card-marks .vt-vis'))) === 4, 'the Grid marks the same four for the owner');
  await inBoth(tab, async (mode) => { await shot(tab, `grid-owner-1280-${mode}`); });
  await tab.close();

  // A moderator without See every file sees what is for everyone and her own, nothing else.
  tab = await openVault(env, browser, 'mia');
  await tab.waitFor('#module-frame >>> .vt-row');
  r.check((await tab.eval(COUNT('.vt-row'))) === 2, 'a moderator without See every file sees 2 files');
  await tab.close();
  await env.ok('admin', 'PATCH', '/api/roles/moderator', { 'module.vault.see_all': true });
  tab = await openVault(env, browser, 'mia');
  await tab.waitFor('#module-frame >>> .vt-row');
  r.check((await tab.eval(COUNT('.vt-row'))) === 5, 'with See every file on, the moderator sees all five');
  await tab.close();
  await env.ok('admin', 'PATCH', '/api/roles/moderator', { 'module.vault.see_all': false });

  // A phone: the marks wrap in the line under the name and nothing is cut, in the List and the Grid.
  for (const who of ['lee', 'noor']) {
    tab = await openVault(env, browser, who, { size: 390, touch: true });
    await tab.waitFor('#module-frame >>> [data-id]');
    await tab.click('.mf-switch-btn', 'List');
    await tab.waitFor('#module-frame >>> .vt-row');
    const cut = await tab.eval(`(() => { const root = document.querySelector('#module-frame').shadowRoot; const out = []; for (const m of root.querySelectorAll('.vt-vis')) { const b = m.getBoundingClientRect(); const p = m.closest('.vt-row, .vt-card').getBoundingClientRect(); if (b.right > p.right + 1 || b.left < p.left - 1) out.push(m.textContent); } return { out, overflow: document.documentElement.scrollWidth > innerWidth + 1 }; })()`);
    r.check(!cut.out.length && !cut.overflow, `390 list as ${who}: no mark is cut and the page does not scroll sideways (${JSON.stringify(cut)})`);
    await inBoth(tab, async (mode) => { await shot(tab, `list-${who}-390-${mode}`); });
    await tab.click('.mf-switch-btn', 'Grid');
    await until(tab, COUNT('.vt-card'), (v) => v >= 3);
    const gcut = await tab.eval(`(() => { const root = document.querySelector('#module-frame').shadowRoot; const out = []; for (const m of root.querySelectorAll('.vt-vis')) { const b = m.getBoundingClientRect(); const p = m.closest('.vt-card').getBoundingClientRect(); if (b.right > p.right + 1) out.push(m.textContent); } return out; })()`);
    r.check(!gcut.length, `390 Grid as ${who}: no mark is cut (${JSON.stringify(gcut)})`);
    await inBoth(tab, async (mode) => { await shot(tab, `grid-${who}-390-${mode}`); });
    await tab.close();
  }
  tab = null;
} catch (err) {
  r.check(false, err.stack || String(err));
} finally {
  await stop(env, browser, tab);
}
r.done();
