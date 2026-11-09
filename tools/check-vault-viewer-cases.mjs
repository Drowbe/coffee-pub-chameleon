// The live cases for the file windows (plan-attachments-vault.md, step 3, decisions 18 to 20), run by check-vault-module.mjs on its throwaway
// server with real files (tools/fixtures/vault/*): every type opened in its window (a picture, an mp3, a small video, a Markdown file with
// planted HTML, a PDF in the sandboxed viewer, a PDF kept as download only, a file whose bytes are gone, a file that was removed), Previous and
// Next, Info, the cap of four windows and its sentence, an open file brought forward, Close all, Esc and where focus goes, Rename and Remove from
// the window's menu, what a member who may not change the file is offered, the Layout menu's Close all on a space's canvas, a phone's one sheet,
// and the colours' contrast in the dark and the light theme.
import fs from 'node:fs';
import path from 'node:path';
import { Tab, sleep, driveScreen } from './shots.mjs';

const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf', md: 'text/markdown', mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg', wav: 'audio/wav' };
const LOCKED = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\ntrailer << /Root 1 0 R /Encrypt 9 0 R /ID [<00> <00>] >>\nstartxref\n0\n%%EOF\n', 'latin1');
const PLANTED = Buffer.from('# Planted\n\n<img src=x onerror="window.__pwn=1"> <script>window.__pwn=1</script>\n\n[a link](https://example.com) and [bad](javascript:window.__pwn=1)\n\n- one\n- two\n');
const ROW = '#module-frame >>> .vt-row .sdk-open';
const WINS = `document.querySelectorAll('.fv-win').length`;
const FRONT = `(document.querySelector('.fv-win.is-front .mf-titlebar-title') || {}).textContent || ''`;
const SENTENCE = 'Close a window to open another.';

export async function viewerCases({ S, api, say, fail, browser, until, open, dataDir, trip }) {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const fixtures = path.join(root, 'tools', 'fixtures', 'vault');
  const put = (who, name, bytes, type) => api('POST', `/api/modules/vault/library?space=${trip}&name=${encodeURIComponent(name)}`, bytes, who, type);
  for (const f of ['photo.jpg', 'tone.mp3', 'clip.webm', 'clip.mp4', 'notes.md', 'link.pdf', 'plain.pdf']) {
    const r = await put('mia', f, fs.readFileSync(path.join(fixtures, f)), TYPES[f.split('.').pop()]);
    if (r.status !== 201) throw new Error(`could not add ${f}: ${r.status} ${JSON.stringify(r.json)}`);
  }
  await put('mia', 'planted.md', PLANTED, 'text/markdown');
  await put('mia', 'locked.pdf', LOCKED, 'application/pdf');
  const gone = (await put('mia', 'gone.png', fs.readFileSync(path.join(fixtures, 'pic.png')), 'image/png')).json.file;
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(dataDir)) if (path.basename(f) === `${gone.id}.bin`) fs.rmSync(f);

  const press = async (tab, key, code, vk) => {
    await tab.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk }, tab.sid);
    await tab.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }, tab.sid);
  };
  // Open a file by its name in the Vault's list, as a person does: the button takes focus, then the press.
  const openNamed = (tab, name) => tab.eval(`(() => { const b = __q(${JSON.stringify(ROW)}, ${JSON.stringify(name)}); if (!b) return false; b.focus(); b.click(); return true; })()`);
  const front = (tab) => tab.eval(FRONT);
  const text = (tab, sel) => tab.eval(`(() => { const e = document.querySelector('.fv-win.is-front ${sel}'); return e ? e.innerText : null; })()`);
  const buttons = (tab) => tab.eval(`[...document.querySelectorAll('.fv-win.is-front .mf-toolbar button')].filter((b) => b.getClientRects().length).map((b) => b.getAttribute('aria-label') || b.textContent.trim())`);
  // The window is up with its title at once (the Vault gives the name); it is loaded when the toolbar has Info.
  const settleWin = (tab, name) => until(tab, `(() => { const w = document.querySelector('.fv-win.is-front'); return w && w.querySelector('.mf-titlebar-title').textContent === ${JSON.stringify(name)} && [...w.querySelectorAll('.mf-toolbar button')].some((b) => b.getAttribute('aria-label') === 'Info'); })()`, Boolean);
  const menuOf = async (tab) => {
    await until(tab, `![...document.querySelectorAll('[role=menuitem]')].some((e) => e.getClientRects().length)`, Boolean);
    await tab.eval(`(() => { const b = [...document.querySelectorAll('.fv-win.is-front .mf-titlebar button')].find((x) => /more/i.test(x.getAttribute('aria-label') || '')); b.click(); })()`);
    await until(tab, `[...document.querySelectorAll('[role=menuitem]')].some((e) => e.getClientRects().length)`, Boolean);
  };
  const pickMenu = (tab, label) => tab.eval(`(() => { const e = [...document.querySelectorAll('[role=menuitem]')].filter((x) => x.getClientRects().length).find((x) => x.innerText.trim().toLowerCase().includes(${JSON.stringify(label.toLowerCase())})); if (!e) return false; e.click(); return true; })()`);
  const names = async (who = 'mia') => ((await api('GET', `/api/modules/vault/library?space=${trip}`, undefined, who)).json?.files || []).map((f) => f.name);

  // ---- every type, one window at a time (a wide window, the dark theme) ----
  let tab = await open(1280, 'mia');
  try {
    await tab.eval(`(() => { window.__errs = []; window.addEventListener('unhandledrejection', (e) => window.__errs.push(String(e.reason && e.reason.message || e.reason))); return true; })()`);
    // a picture
    await openNamed(tab, 'photo.jpg');
    await settleWin(tab, 'photo.jpg');
    const pic = await until(tab, `(() => { const i = document.querySelector('.fv-win.is-front .fv-pic img'); return i ? i.naturalWidth : 0; })()`, (v) => v > 0, 8000);
    if (!(pic > 0)) fail('a picture does not load in its window');
    const tools = await buttons(tab);
    for (const want of ['Previous', 'Next', 'Info', 'Download', 'Full screen']) if (!tools.includes(want)) fail(`the picture window's toolbar has ${tools.join(', ')}, not ${want}`);
    // Share is built (step 5): it is shown only where the person may share (this tab's person may; others' menus are checked in the role cases).
    const pos = ((await text(tab, '.mf-toolbar')) || '').replace(/\s+/g, ' ');
    if (!/\d+ of \d+/.test(pos)) fail(`the toolbar says "${pos}", not where the file is in the list ("n of N")`);
    const zoomed = await (async () => { await tab.eval(`document.querySelector('.fv-win.is-front .fv-zoombar button[aria-label="Zoom in"]').click()`); return text(tab, '.fv-zoom-level'); })();
    if (!/150%/.test(zoomed || '')) fail(`Zoom in shows "${zoomed}", not 150%`);
    say(`picture: loaded, toolbar ${tools.join(', ')}, "${pos.trim()}", zoom ${zoomed}`);
    // Previous and Next by the buttons and by the arrow keys; the window keeps its place
    const before = await front(tab);
    await tab.eval(`document.querySelector('.fv-win.is-front .fv-zoombar button[aria-label="Fit to window"], .fv-win.is-front .fv-zoom-level').click()`);
    await tab.eval(`[...document.querySelectorAll('.fv-win.is-front .mf-toolbar button')].find((b) => b.getAttribute('aria-label') === 'Next').click()`);
    const next = await until(tab, FRONT, (v) => v !== before);
    if (next === before) fail('Next did not show another file');
    await tab.eval(`document.querySelector('.fv-win.is-front').focus && document.querySelector('.fv-win.is-front .mf').focus()`);
    await press(tab, 'ArrowLeft', 'ArrowLeft', 37);
    const back = await until(tab, FRONT, (v) => v === before);
    if (back !== before) fail(`the left arrow key did not walk back to ${before} (it shows ${back})`);
    say(`Previous and Next: ${before} -> ${next} -> ${back}`);
    // Info
    await tab.eval(`[...document.querySelectorAll('.fv-win.is-front .mf-toolbar button')].find((b) => b.getAttribute('aria-label') === 'Info').click()`);
    const info = await until(tab, `(() => { const i = document.querySelector('.fv-win.is-front .fv-info'); return i ? i.innerText : ''; })()`, (v) => /Where it is used/.test(v) && !/Looking/.test(v));
    if (!/Picture/.test(info) || !/Added by/.test(info) || !/Not linked from anywhere/.test(info)) fail(`Info says "${info.replace(/\n/g, ' | ')}"`);
    say(`Info: ${info.replace(/\n/g, ' | ').slice(0, 110)}`);
    await tab.key('Escape');
    await until(tab, WINS, (v) => v === 0);

    // audio (mp3) and video (webm plays; mp4 may need codecs this browser lacks, and then says so)
    await openNamed(tab, 'tone.mp3');
    await settleWin(tab, 'tone.mp3');
    const au = await until(tab, `(() => { const a = document.querySelector('.fv-win.is-front audio'); return a ? { controls: a.controls, error: a.error && a.error.code, state: a.readyState } : null; })()`, (v) => v && (v.state >= 1 || v.error), 8000);
    if (!au || !au.controls) fail('audio has no controls of its own');
    else if (au.error) say(`audio: this browser can't play the mp3 (it must show the sentence): "${await text(tab, '.fv-state')}"`);
    else say(`audio: controls, ready ${au.state}`);
    await tab.key('Escape');
    await openNamed(tab, 'clip.webm');
    await settleWin(tab, 'clip.webm');
    const vid = await until(tab, `(() => { const v = document.querySelector('.fv-win.is-front video'); return v ? { controls: v.controls, inline: v.hasAttribute('playsinline'), error: v.error && v.error.code, state: v.readyState } : null; })()`, (v) => v && (v.state >= 1 || v.error), 8000);
    if (!vid || !vid.controls || !vid.inline || vid.error) fail(`the video window: ${JSON.stringify(vid)} (controls and playsinline, no error)`);
    else say(`video: controls, playsinline, ready ${vid.state}`);
    await tab.key('Escape');
    await openNamed(tab, 'clip.mp4');
    await settleWin(tab, 'clip.mp4');
    const mp4 = await until(tab, `(() => { const v = document.querySelector('.fv-win.is-front video'); const s = document.querySelector('.fv-win.is-front .fv-state'); return { video: v ? { error: v.error && v.error.code, state: v.readyState } : null, said: s ? s.innerText : '' }; })()`, (v) => (v.video && v.video.state >= 1) || /can't play/.test(v.said), 8000);
    if (!((mp4.video && mp4.video.state >= 1) || /This browser can't play this file\./.test(mp4.said))) fail(`an mp4 neither plays nor says it can't be played: ${JSON.stringify(mp4)}`);
    say(`mp4: ${mp4.video && mp4.video.state >= 1 ? 'plays' : `says "${mp4.said.split('\n')[0]}"`}`);
    await tab.key('Escape');

    // Markdown: planted HTML shows as text and never runs; the link opens safely; the javascript: one is no link
    await openNamed(tab, 'planted.md');
    await settleWin(tab, 'planted.md');
    await until(tab, `!!document.querySelector('.fv-win.is-front .fv-md h1')`, Boolean);
    const md = await tab.eval(`(() => { const m = document.querySelector('.fv-win.is-front .fv-md'); return { text: m.innerText, elements: m.querySelectorAll('script, img, iframe, [onerror]').length, links: [...m.querySelectorAll('a')].map((a) => a.getAttribute('href') + '|' + a.rel + '|' + a.target), pwn: window.__pwn || null }; })()`);
    if (md.elements || md.pwn) fail(`planted HTML in Markdown became ${md.elements} element(s) (pwn ${md.pwn})`);
    if (!/<script>/.test(md.text)) fail('planted HTML does not show as text in the Markdown view');
    if (md.links.length !== 1 || !/noopener noreferrer/.test(md.links[0]) || /javascript/i.test(md.links.join())) fail(`Markdown links are ${md.links.join(' ; ')}`);
    say('Markdown: planted HTML shown as text, one safe link');
    await tab.key('Escape');

    // a PDF in the sandboxed viewer: page count, zoom, fit, search
    await openNamed(tab, 'plain.pdf');
    await settleWin(tab, 'plain.pdf');
    const pdf = await until(tab, `(() => { const f = document.querySelector('.fv-win.is-front iframe'); const bar = document.querySelector('.fv-win.is-front .fv-pdfbar'); return f ? { sandbox: f.getAttribute('sandbox'), src: f.getAttribute('src'), shown: !f.hidden && bar && !bar.hidden, pages: (document.querySelector('.fv-win.is-front .fv-pdf-of') || {}).textContent } : null; })()`, (v) => v && v.shown, 12000);
    if (!pdf || !pdf.shown) fail(`the PDF did not open in its viewer: ${JSON.stringify(pdf)}`);
    else {
      if (pdf.sandbox !== 'allow-scripts' || pdf.src !== '/viewer/pdf') fail(`the PDF frame is ${pdf.sandbox} ${pdf.src}, not sandbox="allow-scripts" at /viewer/pdf`);
      if (!/of 1/.test(pdf.pages || '')) fail(`the PDF says "${pdf.pages}", not its page count`);
      await tab.eval(`document.querySelector('.fv-win.is-front .fv-pdfbar button[aria-label="Zoom in"]').click()`);
      const level = await until(tab, `document.querySelector('.fv-win.is-front .fv-pdfbar .fv-zoom-level').innerText`, (v) => /%/.test(v));
      if (!/%/.test(level)) fail(`Zoom in on a PDF shows "${level}"`);
      await tab.eval(`document.querySelector('.fv-win.is-front .fv-pdfbar .fv-zoom-level').click()`);
      const fit = await until(tab, `document.querySelector('.fv-win.is-front .fv-pdfbar .fv-zoom-level').innerText`, (v) => /Fit/.test(v));
      await tab.eval(`document.querySelector('.fv-win.is-front .fv-pdfbar button[aria-label="Search in the PDF"]').click()`);
      await tab.eval(`(() => { const i = document.querySelector('.fv-win.is-front .fv-pdf-search input'); i.value = 'plain'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      const found = await until(tab, `document.querySelector('.fv-win.is-front .fv-pdf-count').innerText`, (v) => /of/.test(v));
      if (!/1 of 1/.test(found)) fail(`searching the PDF for "plain" says "${found}"`);
      say(`PDF: sandboxed frame, ${pdf.pages.trim()}, zoom ${level}, ${fit}, search ${found}`);
    }
    await tab.key('Escape');
    await openNamed(tab, 'link.pdf');
    await settleWin(tab, 'link.pdf');
    const lp = await until(tab, `(() => { const bar = document.querySelector('.fv-win.is-front .fv-pdfbar'); return bar && !bar.hidden; })()`, Boolean, 12000);
    if (!lp) fail('a PDF with a web link did not open');
    await tab.key('Escape');

    // a PDF kept as download only, a file whose bytes are gone, a file that was removed
    await openNamed(tab, 'locked.pdf');
    await settleWin(tab, 'locked.pdf');
    const lk = await until(tab, `(() => { const s = document.querySelector('.fv-win.is-front .fv-state'); return s ? { said: s.innerText, frames: document.querySelectorAll('.fv-win.is-front iframe').length, dl: !!s.querySelector('button') } : null; })()`, Boolean);
    if (!lk || !lk.said.includes("This PDF can't be opened here. Download it.") || lk.frames || !lk.dl) fail(`a download-only PDF shows ${JSON.stringify(lk)}`);
    say('download-only PDF: the sentence, a Download button, no frame');
    await tab.key('Escape');
    await openNamed(tab, 'gone.png');
    await settleWin(tab, 'gone.png');
    const gp = await until(tab, `(() => { const s = document.querySelector('.fv-win.is-front .fv-state'); return s ? s.innerText : ''; })()`, (v) => /File missing/.test(v), 8000);
    if (!/File missing/.test(gp)) fail(`a file with no bytes shows "${gp}", not File missing`);
    await tab.key('Escape');
    await tab.eval(`(async () => { const m = await import('/file-viewer.js'); m.openFile({ ref: { module: 'vault', kind: 'file', id: 'abcdef0123456789abcdef01', scope: 'space', space: ${JSON.stringify(trip)} }, doc: document }); })()`);
    const rm = await until(tab, `(() => { const s = document.querySelector('.fv-win.is-front .fv-state'); return s ? s.innerText : ''; })()`, (v) => /File removed/.test(v), 8000);
    if (!/File removed/.test(rm)) fail(`a file that is gone from the list shows "${rm}", not File removed`);
    say('a file with no bytes: File missing; a file that was removed: File removed');
    await tab.key('Escape');
    const errs = await tab.eval('window.__errs');
    if (errs.length) fail(`unhandled errors while opening files: ${errs.join(' ; ')}`);
    await until(tab, WINS, (v) => v === 0);
  } finally { await tab.close(); }

  // ---- several windows, the cap, an open file brought forward, Esc and focus, Close all, Rename and Remove ----
  tab = await open(1280, 'mia');
  try {
    for (const n of ['photo.jpg', 'tone.mp3', 'notes.md', 'clip.webm']) { await openNamed(tab, n); await settleWin(tab, n); }
    if ((await tab.eval(WINS)) !== 4) fail(`${await tab.eval(WINS)} windows open for four files`);
    await openNamed(tab, 'link.pdf');
    const toast = await until(tab, `document.body.innerText.includes(${JSON.stringify(SENTENCE)})`, Boolean, 4000);
    if (!toast) fail(`a fifth file did not say "${SENTENCE}"`);
    if ((await tab.eval(WINS)) !== 4) fail(`a fifth window opened (${await tab.eval(WINS)})`);
    // an open file comes forward instead of a second window
    await openNamed(tab, 'photo.jpg');
    await sleep(400);
    if ((await tab.eval(WINS)) !== 4 || (await front(tab)) !== 'photo.jpg') fail(`an open file did not come forward (${await tab.eval(WINS)} windows, front ${await front(tab)})`);
    say(`four windows, "${SENTENCE}" at the fifth, an open file comes forward`);
    // the windows' places: inside the page, each a window of its own
    const inside = await tab.eval(`[...document.querySelectorAll('.fv-win')].every((w) => { const r = w.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })`);
    if (!inside) fail('a file window reaches outside the page');
    // Esc closes the window that has focus; focus goes back to what opened the file
    await tab.eval(`document.querySelector('.fv-win.is-front .mf').focus()`);
    await tab.key('Escape');
    await until(tab, WINS, (v) => v === 3);
    if ((await tab.eval(WINS)) !== 3) fail('Esc did not close the focused window');
    const focused = await until(tab, `(() => { const r = document.querySelector('#module-frame').shadowRoot; const a = r && r.activeElement; return a ? (a.textContent || '').trim() : ''; })()`, (v) => v === 'photo.jpg');
    if (focused !== 'photo.jpg') fail(`after Esc focus is on "${focused}", not on the file's button that opened it`);
    say('Esc closes the focused window and focus returns to the opener');
    // Close all from a window's menu
    await menuOf(tab);
    const items = await tab.eval(`[...document.querySelectorAll('[role=menuitem]')].filter((e) => e.getClientRects().length).map((e) => e.innerText.trim()).join(' | ')`);
    for (const want of ['Rename', 'Where it is used', 'Close all', 'Remove']) if (!items.includes(want)) fail(`a window's menu is "${items}", with no ${want}`);
    await pickMenu(tab, 'Close all');
    await until(tab, WINS, (v) => v === 0);
    if ((await tab.eval(WINS)) !== 0) fail('Close all left windows open');
    say(`a window's menu: ${items}; Close all closes every window`);

    // Rename from the window's menu
    await openNamed(tab, 'notes.md');
    await settleWin(tab, 'notes.md');
    await menuOf(tab);
    await pickMenu(tab, 'Rename');
    await until(tab, `!!document.querySelector('dialog.fv-rename input')`, Boolean);
    // Rename is off until the name changes; Escape with an edited name asks "Discard changes?" and Keep editing goes back.
    const SAVE = `document.querySelector('dialog.fv-rename .action-bar-save')`;
    if (!(await tab.eval(`${SAVE}.disabled`))) fail('Rename was on before the name changed');
    const typeName = (v) => tab.eval(`(() => { const i = document.querySelector('dialog.fv-rename input'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await typeName('Notes renamed');
    if (await tab.eval(`${SAVE}.disabled`)) fail('Rename stayed off after the name changed');
    await tab.key('Escape');
    const discard = await until(tab, `(() => { const a = document.querySelector('dialog.fv-rename .action-bar-ask'); return a && !a.hidden ? a.innerText : ''; })()`, Boolean);
    if (!/Discard changes\?/.test(discard)) fail(`Escape with an edited name showed "${discard}"`);
    await tab.click('dialog.fv-rename .action-bar-keep');
    if (!(await tab.eval(`!!document.querySelector('dialog.fv-rename')`))) fail('Keep editing closed the Rename dialog');
    await tab.eval(`document.querySelector('dialog.fv-rename form').requestSubmit()`);
    const renamed = await until(tab, FRONT, (v) => /Notes renamed/.test(v));
    if (!/Notes renamed/.test(renamed)) fail(`Rename left the window's title "${renamed}"`);
    if (!(await names()).includes('Notes renamed.md')) fail('Rename from the window did not reach the server');
    say(`Rename from the window: ${renamed}`);
    // Remove, with the same confirm as the list
    await menuOf(tab);
    await pickMenu(tab, 'Remove');
    const asked = await until(tab, `(() => { const d = document.querySelector('dialog[open]'); return d ? d.innerText : ''; })()`, (v) => /can't be undone/.test(v));
    if (!/Remove "Notes renamed.md"\?/.test(asked) || !/can't be undone/.test(asked)) fail(`Remove asked "${asked}"`);
    const count = (await names()).length;
    await tab.click('dialog[open] button', 'Remove');
    let left = count;
    for (let i = 0; i < 20 && left === count; i += 1) { await sleep(250); left = (await names()).length; }
    if (left !== count - 1) fail(`Remove from the window left ${left} of ${count} files`);
    say('Remove from the window: the same confirm, the file is gone');
    await tab.key('Escape');
  } finally { await tab.close(); }

  // ---- a member: someone else's file has no Rename or Remove in the window's menu ----
  tab = await open(1280, 'sam');
  try {
    await openNamed(tab, 'photo.jpg');
    await settleWin(tab, 'photo.jpg');
    await menuOf(tab);
    const items = await tab.eval(`[...document.querySelectorAll('[role=menuitem]')].filter((e) => e.getClientRects().length).map((e) => e.innerText.trim()).join(' | ')`);
    if (/Rename|Remove/.test(items)) fail(`a member's window menu for someone else's file is "${items}"`);
    if (!items.includes('Where it is used')) fail(`a member's window menu is "${items}", with no Where it is used`);
    say(`a member's window menu: ${items}`);
  } finally { await tab.close(); }
  const off = await api('PATCH', '/api/roles/member', { 'module.vault.download': false }, 'admin');
  tab = await open(1280, 'sam');
  try {
    await openNamed(tab, 'photo.jpg');
    await settleWin(tab, 'photo.jpg');
    const tools = await buttons(tab);
    if (off.status === 200 && tools.includes('Download')) fail('a member who may not download is shown Download in the window');
    say(`a member who may not download: ${tools.join(', ')}`);
  } finally { await tab.close(); await api('PATCH', '/api/roles/member', { 'module.vault.download': true }, 'admin'); }

  // ---- a space's canvas: a window opens over the modules; the Layout menu closes them all ----
  tab = new Tab(browser.cdp, S.ctx);
  await tab.open(1280, 'dark', true);
  {
    const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
    try {
      await driveScreen(tab, { id: 'workspace', as: 'mia', url: '/#join={trip}', wait: 'button.sdk-strip-fact[data-module=budget]', call: true, space: true }, S.base, S.cookies, S.ctx);
      await sleep(1500);
      await tab.eval(`__q('[data-module-root=vault] >>> .vt-row .sdk-open', 'plain.pdf').click()`);
      const winOn = await until(tab, WINS, (v) => v === 1, 8000);
      if (winOn !== 1) fail('a file did not open in a window over the space\'s canvas');
      await tab.click('#setup');
      await until(tab, `[...document.querySelectorAll('[role=menuitem]')].some((e) => /Close all/.test(e.innerText))`, Boolean);
      const hasClose = await tab.eval(`[...document.querySelectorAll('[role=menuitem]')].some((e) => /Close all/.test(e.innerText))`);
      if (!hasClose) fail('the Layout menu has no Close all while a file window is open');
      await tab.eval(`[...document.querySelectorAll('[role=menuitem]')].find((e) => /Close all/.test(e.innerText)).click()`);
      await until(tab, WINS, (v) => v === 0);
      if ((await tab.eval(WINS)) !== 0) fail('Close all in the Layout menu left a window open');
      say('space canvas: the window opens over the modules; the Layout menu\'s Close all closes it');
    } finally { await tab.close(); }
  }

  // ---- a phone: one full-screen sheet, a new file replaces it, Download is a large button ----
  tab = await open(390, 'mia');
  try {
    await openNamed(tab, 'photo.jpg');
    await settleWin(tab, 'photo.jpg');
    await openNamed(tab, 'tone.mp3');
    await settleWin(tab, 'tone.mp3');
    const sheet = await tab.eval(`(() => { const w = document.querySelector('.fv-win'); const r = w.getBoundingClientRect(); const d = document.querySelector('.fv-win .fv-dlbig'); const dr = d && d.getBoundingClientRect(); return { n: document.querySelectorAll('.fv-win').length, x: r.x, y: r.y, w: r.width, h: r.height, iw: innerWidth, ih: innerHeight, dl: dr ? { h: dr.height, shown: !!d.getClientRects().length } : null, toolbarDownload: [...document.querySelectorAll('.fv-win .mf-toolbar button')].some((b) => b.getClientRects().length && b.getAttribute('aria-label') === 'Download') }; })()`);
    if (sheet.n !== 1) fail(`a phone shows ${sheet.n} windows; a new file must replace the sheet`);
    if (Math.abs(sheet.w - sheet.iw) > 1 || Math.abs(sheet.h - sheet.ih) > 1 || sheet.x || sheet.y) fail(`the phone's sheet is ${JSON.stringify(sheet)}, not the whole screen`);
    if (!sheet.dl || !sheet.dl.shown || sheet.dl.h < 44) fail(`the phone's Download button is ${JSON.stringify(sheet.dl)} (44px or more high)`);
    if (sheet.toolbarDownload) fail('the phone shows Download in the toolbar too');
    say(`phone: one sheet ${sheet.w}x${sheet.h}, a new file replaced it, Download ${sheet.dl ? sheet.dl.h : 'missing'}px high`);
    await tab.eval(`document.querySelector('.fv-win .mf').focus()`);
    await tab.key('Escape');
    await until(tab, WINS, (v) => v === 0);
    if ((await tab.eval(WINS)) !== 0) fail('Esc did not close the phone\'s sheet');
    // the PDF bar on a phone: a 44px page field
    await openNamed(tab, 'plain.pdf');
    await until(tab, `(() => { const i = document.querySelector('.fv-win .fv-pdf-page'); return i && i.getClientRects().length ? Math.round(i.getBoundingClientRect().height) : 0; })()`, (v) => v > 0, 12000);
    const field = await tab.eval(`Math.round(document.querySelector('.fv-win .fv-pdf-page').getBoundingClientRect().height)`);
    if (field < 44) fail(`the PDF's page field is ${field}px high on a phone (44 or more)`);
    say(`phone PDF: page field ${field}px`);
  } finally { await tab.close(); }

  // ---- contrast of the viewers' words in both themes (4.5:1 for text) ----
  for (const mode of ['dark', 'light']) {
    const t = new Tab(browser.cdp, S.ctx);
    await t.open(1280, mode, false);
    const settle = t.settle.bind(t); t.settle = () => Promise.race([settle(), sleep(3000)]);
    try {
      await driveScreen(t, { id: 'vault', as: 'mia', url: '/modules/vault?space={trip}&popout=1', wait: ROW }, S.base, S.cookies, S.ctx);
      await sleep(400);
      const measure = (sel) => `(() => { const lum = (c) => { const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
        const rgba = (s) => { const m = /rgba?\\(([^)]+)\\)/.exec(s); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
        const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
        let bg = null; for (let n = e; n && !bg; n = n.parentElement) { const x = rgba(getComputedStyle(n).backgroundColor); if (x && x.a > 0.99) bg = x.c; }
        const fg = rgba(getComputedStyle(e).color); if (!bg || !fg) return null;
        const a = lum(fg.c) + 0.05; const b = lum(bg) + 0.05; return Math.max(a, b) / Math.min(a, b); })()`;
      await openNamed(t, 'tone.mp3');
      await settleWin(t, 'tone.mp3');
      await t.eval(`[...document.querySelectorAll('.fv-win.is-front .mf-toolbar button')].find((b) => b.getAttribute('aria-label') === 'Info').click()`);
      await sleep(600);
      const checks = { 'audio size': '.fv-win.is-front .fv-audio-meta', 'info label': '.fv-win.is-front .fv-info-list dt', 'info value': '.fv-win.is-front .fv-info-list dd', 'info none': '.fv-win.is-front .fv-info-none', 'file name': '.fv-win.is-front .fv-audio-name', 'status': '.fv-win.is-front .mf-status-text' };
      const out = [];
      for (const [label, sel] of Object.entries(checks)) { const r = await t.eval(measure(sel)); if (r !== null && r < 4.5) fail(`${mode} theme: ${label} has contrast ${r.toFixed(2)}:1 (4.5:1 needed)`); out.push(`${label} ${r === null ? '-' : r.toFixed(1)}`); }
      await t.key('Escape');
      await openNamed(t, 'locked.pdf');
      await settleWin(t, 'locked.pdf');
      for (const [label, sel] of Object.entries({ 'state title': '.fv-win.is-front .sdk-empty-title', 'state text': '.fv-win.is-front .sdk-empty-text', 'state button': '.fv-win.is-front .fv-state .btn' })) { const r = await t.eval(measure(sel)); if (r !== null && r < 4.5) fail(`${mode} theme: ${label} has contrast ${r.toFixed(2)}:1 (4.5:1 needed)`); out.push(`${label} ${r === null ? '-' : r.toFixed(1)}`); }
      say(`contrast, ${mode}: ${out.join(', ')}`);
    } finally { await t.close(); }
  }
}

// ---- the QA's findings on the file windows (feedback build), run after viewerCases (its files are in the library) ----
const SHADOW_ACTIVE = `(() => { const r = document.querySelector('#module-frame'); const a = r && r.shadowRoot && r.shadowRoot.activeElement; return a ? (a.textContent || '').trim() : (document.activeElement === document.body ? 'BODY' : ''); })()`;
export async function viewerFixCases({ S, api, say, fail, browser, until, open, trip }) {
  const press = (tab, key, code, vk) => tab.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk }, tab.sid).then(() => tab.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }, tab.sid));
  const openNamed = (tab, name, then = 'b.click()') => tab.eval(`(() => { const b = __q(${JSON.stringify(ROW)}, ${JSON.stringify(name)}); if (!b) return false; b.focus(); ${then}; return true; })()`);
  const settleWin = (tab, name) => until(tab, `(() => { const w = [...document.querySelectorAll('.fv-win')].find((x) => x.querySelector('.mf-titlebar-title').textContent === ${JSON.stringify(name)}); return w && [...w.querySelectorAll('.mf-toolbar button')].some((b) => b.getAttribute('aria-label') === 'Info'); })()`, Boolean);
  const frontWin = (tab, name) => tab.eval(`(() => { const w = [...document.querySelectorAll('.fv-win')].find((x) => x.querySelector('.mf-titlebar-title').textContent === ${JSON.stringify(name)}); if (!w) return false; w.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); w.querySelector('.mf').focus(); return true; })()`);
  const buttons = (tab) => tab.eval(`[...document.querySelectorAll('.fv-win.is-front .mf-toolbar button')].filter((b) => b.getClientRects().length).map((b) => b.getAttribute('aria-label') || b.textContent.trim())`);
  const frontBox = (tab) => tab.eval(`(() => { const r = document.querySelector('.fv-win.is-front').getBoundingClientRect(); const c = document.getElementById('canvas'); const k = c && !c.hidden ? c.getBoundingClientRect() : { left: 0, top: 0, right: innerWidth, bottom: innerHeight }; return { l: r.left, t: r.top, r: r.right, b: r.bottom, cl: k.left, ct: k.top, cr: k.right, cb: k.bottom }; })()`);
  const lightLook = `(async () => { const v = await import('/file-viewer-views.js'); const s = document.createElement('span'); s.style.cssText = 'position:absolute;visibility:hidden;color:' + v.AROUND_PAGES; document.body.append(s); const c = getComputedStyle(s).color; s.remove();
    const cv = document.createElement('canvas'); cv.width = cv.height = 1; const x = cv.getContext('2d', { colorSpace: 'srgb' }); x.fillStyle = c; x.fillRect(0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data;
    const lum = (a) => { const q = a.map((n) => { n /= 255; return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }); return 0.2126 * q[0] + 0.7152 * q[1] + 0.0722 * q[2]; };
    return 1.05 / (lum([d[0], d[1], d[2]]) + 0.05); })()`;

  // F2: a double-click, and several opens in the same breath, on a page that has not opened a window yet, make one window.
  let tab = await open(1280, 'mia');
  try {
    await openNamed(tab, 'photo.jpg', 'b.click(); b.click(); b.click()');
    await sleep(1500);
    const n = await tab.eval(WINS);
    if (n !== 1) fail(`three quick opens of one file on a fresh page made ${n} windows, not one`);
    say(`three quick opens of one file: ${n} window`);

    // F1: focus goes back to what opened THAT window
    await openNamed(tab, 'tone.mp3');
    await settleWin(tab, 'tone.mp3');
    await frontWin(tab, 'photo.jpg');
    await press(tab, 'Escape', 'Escape', 27);
    await until(tab, WINS, (v) => v === 1);
    const back = await until(tab, SHADOW_ACTIVE, (v) => v === 'photo.jpg');
    if (back !== 'photo.jpg') fail(`Esc on the photo's window put focus on "${back}", not on the photo's own row`);
    // a refused fifth open leaves no trace: closing any window goes to its own row, not the refused one
    for (const f of ['photo.jpg', 'planted.md', 'clip.webm']) { await openNamed(tab, f); await settleWin(tab, f); }
    await openNamed(tab, 'link.pdf');
    const cap = await until(tab, `document.body.innerText.includes('Four windows are open') && document.body.innerText.includes(${JSON.stringify(SENTENCE)})`, Boolean, 4000);
    if (!cap) fail(`a fifth file did not say "Four windows are open" and "${SENTENCE}"`);
    await frontWin(tab, 'clip.webm');
    await press(tab, 'Escape', 'Escape', 27);
    await until(tab, WINS, (v) => v === 3);
    const afterCap = await until(tab, SHADOW_ACTIVE, (v) => v === 'clip.webm');
    if (afterCap !== 'clip.webm') fail(`after a refused fifth open, closing the clip's window put focus on "${afterCap}", not the clip's row`);
    // Close all from a window's menu: focus lands on a row, never on the page
    await tab.eval(`(() => { const b = [...document.querySelectorAll('.fv-win.is-front .mf-titlebar button')].find((x) => /more/i.test(x.getAttribute('aria-label') || '')); b.click(); })()`);
    await until(tab, `[...document.querySelectorAll('[role=menuitem]')].some((e) => e.getClientRects().length)`, Boolean);
    await tab.eval(`[...document.querySelectorAll('[role=menuitem]')].filter((e) => e.getClientRects().length).find((e) => /Close all/.test(e.innerText)).click()`);
    await until(tab, WINS, (v) => v === 0);
    const all = await until(tab, SHADOW_ACTIVE, (v) => v !== 'BODY' && v !== '');
    if (all === 'BODY' || all === '') fail('after Close all focus fell to the page, not to a row');
    say(`focus returns to the window's own opener ("photo.jpg", "clip.webm"), also after a refused fifth open and Close all ("${all}")`);

    // F6: a message is believed only from the PDF frame's own (null) origin
    await openNamed(tab, 'plain.pdf');
    await until(tab, `(() => { const bar = document.querySelector('.fv-win.is-front .fv-pdfbar'); return bar && !bar.hidden; })()`, Boolean, 12000);
    const msg = await tab.eval(`(() => { const f = document.querySelector('.fv-win.is-front iframe'); const calls = []; const real = window.open; window.open = (u) => { calls.push(u); return null; };
      const send = (origin) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'link', url: 'https://example.com/x' }, source: f.contentWindow, origin }));
      send(location.origin); const other = calls.length; send('null'); const own = calls.length; window.open = real; return { other, own }; })()`);
    if (msg.other !== 0 || msg.own !== 1) fail(`a link message from an origin other than null opened ${msg.other} tab(s), and from null ${msg.own} (0 and 1)`);
    say('the PDF frame is believed only from its null origin');
    await tab.key('Escape');
  } finally { await tab.close(); }

  // F10: the colour around the pages stands apart from white pages (1.5:1), in the light theme and the dark
  for (const mode of ['light', 'dark']) {
    const t = new Tab(browser.cdp, S.ctx);
    await t.open(1280, mode, false);
    const settle = t.settle.bind(t); t.settle = () => Promise.race([settle(), sleep(3000)]);
    try {
      await driveScreen(t, { id: 'vault', as: 'mia', url: '/modules/vault?space={trip}&popout=1', wait: ROW }, S.base, S.cookies, S.ctx);
      await sleep(400);
      const ratio = await t.eval(lightLook);
      if (!(ratio >= 1.5)) fail(`${mode} theme: the colour around PDF pages has contrast ${ratio && ratio.toFixed ? ratio.toFixed(2) : ratio}:1 with white pages (1.5:1 needed)`);
      say(`${mode} theme: the colour around PDF pages against white ${ratio.toFixed(2)}:1`);
    } finally { await t.close(); }
  }
  tab = await open(1280, 'mia');
  try {
    // F8: a file with no bytes has no Download in the toolbar
    await openNamed(tab, 'gone.png');
    await until(tab, `(() => { const s = document.querySelector('.fv-win.is-front .fv-state'); return s ? s.innerText : ''; })()`, (v) => /File missing/.test(v), 8000);
    await sleep(300);
    const gone = await buttons(tab);
    if (gone.includes('Download')) fail(`a file that is missing has ${gone.join(', ')} in its toolbar, with Download`);
    say(`a missing file: toolbar ${gone.join(', ')}`);
    await tab.key('Escape');
    // F11: at the smallest size Info is not offered (it would hide the file); the file stays shown
    await openNamed(tab, 'tone.mp3');
    await settleWin(tab, 'tone.mp3');
    const g = await tab.rect('.fv-win.is-front .fv-grip');
    await tab.mouse('mouseMoved', g.x + g.w / 2, g.y + g.h / 2, { button: 'none', clickCount: 0 });
    await tab.mouse('mousePressed', g.x + g.w / 2, g.y + g.h / 2);
    await tab.mouse('mouseMoved', g.x - 600, g.y - 600);
    await tab.mouse('mouseReleased', g.x - 600, g.y - 600);
    await sleep(300);
    const small = await tab.eval(`(() => { const w = document.querySelector('.fv-win.is-front'); const r = w.getBoundingClientRect(); const v = w.querySelector('.fv-view').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), view: Math.round(v.height), info: [...w.querySelectorAll('.mf-toolbar button')].some((b) => b.getAttribute('aria-label') === 'Info' && b.getClientRects().length) }; })()`);
    if (small.w !== 300 || small.h !== 200) fail(`the smallest window is ${small.w}x${small.h}, not 300x200`);
    if (small.info) fail('at 300x200 the toolbar still offers Info, which would hide the file');
    if (small.view < 60) fail(`at 300x200 the file has ${small.view}px of height`);
    say(`smallest window ${small.w}x${small.h}: no Info, the file ${small.view}px high`);
    await tab.key('Escape');
  } finally { await tab.close(); }

  // F7: someone outside the space opens one of its files: a plain capitalised sentence, no Try again
  {
    const t = new Tab(browser.cdp, S.ctx);
    await t.open(1280, 'dark', false);
    const settle = t.settle.bind(t); t.settle = () => Promise.race([settle(), sleep(3000)]);
    try {
      await driveScreen(t, { id: 'home', as: 'lee', url: '/', wait: 'body' }, S.base, S.cookies, S.ctx);
      const id = (await api('GET', `/api/modules/vault/library?space=${trip}`, undefined, 'mia')).json.files[0].id;
      await t.eval(`(async () => { const m = await import('/file-viewer.js'); m.openFile({ ref: { module: 'vault', kind: 'file', id: ${JSON.stringify(id)}, scope: 'space', space: ${JSON.stringify(trip)} }, doc: document }); })()`);
      const said = await until(t, `(() => { const s = document.querySelector('.fv-win .fv-state'); return s ? { text: s.innerText, retry: !![...s.querySelectorAll('button')].length } : null; })()`, (v) => v && !/Opening/.test(v.text), 8000);
      if (!said || !/^[A-Z]/.test(said.text) || said.retry || /not available in that/.test(said.text)) fail(`someone outside the space opening its file sees ${JSON.stringify(said)} (a capitalised sentence, no Try again)`);
      say(`outside the space: "${said && said.text.replace(/\n+/g, ' ')}"`);
    } finally { await t.close(); }
  }

  // F9 and the context asked again for each window: a member who may not download
  const off = await api('PATCH', '/api/roles/member', { 'module.vault.download': false }, 'admin');
  tab = await open(1280, 'sam');
  try {
    await openNamed(tab, 'locked.pdf');
    const lk = await until(tab, `(() => { const s = document.querySelector('.fv-win.is-front .fv-state'); return s ? { said: s.innerText, dl: !![...s.querySelectorAll('button')].length } : null; })()`, (v) => v && !/Opening/.test(v.said), 8000);
    if (off.status === 200 && (!lk || lk.dl || !/your role can't download it/.test(lk.said))) fail(`a member who may not download, opening a download-only PDF, sees ${JSON.stringify(lk)}`);
    say(`no download, download-only PDF: "${lk && lk.said.split('\n')[0]}"`);
    await tab.key('Escape');
  } finally { await tab.close(); await api('PATCH', '/api/roles/member', { 'module.vault.download': true }, 'admin'); }
  tab = await open(1280, 'sam');
  try {
    await openNamed(tab, 'photo.jpg');
    await settleWin(tab, 'photo.jpg');
    if (!(await buttons(tab)).includes('Download')) fail('a member who may download has no Download');
    await api('PATCH', '/api/roles/member', { 'module.vault.download': false }, 'admin');
    await openNamed(tab, 'tone.mp3');
    await settleWin(tab, 'tone.mp3');
    const now = await buttons(tab);
    await api('PATCH', '/api/roles/member', { 'module.vault.download': true }, 'admin');
    if (now.includes('Download')) fail('after the download permission was turned off, the next window on the same page still shows Download');
    say('a change of the download permission reaches the next window without a reload');
  } finally { await tab.close(); await api('PATCH', '/api/roles/member', { 'module.vault.download': true }, 'admin'); }

  // F3: host.files.open opens a file of this space only, and only for a module that was approved to link to files
  tab = await open(1280, 'mia');
  try {
    const id = (await api('GET', `/api/modules/vault/library?space=${trip}`, undefined, 'mia')).json.files[0].id;
    const r = await tab.eval(`(async () => { const h = window.host; if (!h || !h.files) return 'nohost'; try { await h.files.open({ module: 'vault', kind: 'file', id: ${JSON.stringify(id)}, scope: 'space', space: ${JSON.stringify(S.ctx.second)} }); return 'opened'; } catch (e) { return 'refused ' + e.message; } })()`);
    await sleep(500);
    const n = await tab.eval(WINS);
    if (r === 'nohost') say('(host.files.open could not be called from the page here; the cross-space rule is read from the source)');
    else if (!/^refused/.test(r) || n !== 0) fail(`host.files.open with a pointer to another space answered "${r}" and left ${n} window(s)`);
    else say(`host.files.open to another space: ${r}`);
  } finally { await tab.close(); }
  const stranger = await api('POST', '/api/objects/resolve', { from: 'stream', refs: [{ module: 'vault', kind: 'file', id: 'abcdef0123456789abcdef01', scope: 'space', space: trip }] }, 'mia');
  const ans = stranger.json && stranger.json.summaries && stranger.json.summaries[0];
  if (!ans || ans.status !== 403) fail(`a module that never consumed the file kind is answered ${JSON.stringify(ans)} (403), the answer files.open relies on`);
  const src = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'module-host.js'), 'utf8');
  const handler = src.slice(src.indexOf("async 'files.open'"), src.indexOf("async 'library.download'"));
  if (!/ref\.space !== spaceId/.test(handler) || !/\/api\/objects\/resolve/.test(handler) || !/ref\.module !== module\.id/.test(handler)) fail("files.open does not check the pointer's space and the module's approval");
  say('files.open: the space is the mount\'s own; another module needs the approval the server checks');

  // F4: on the space page a window stays inside the canvas
  tab = new Tab(browser.cdp, S.ctx);
  await tab.open(1280, 'dark', true);
  {
    const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
    try {
      await driveScreen(tab, { id: 'workspace', as: 'mia', url: '/#join={trip}', wait: 'button.sdk-strip-fact[data-module=budget]', call: true, space: true }, S.base, S.cookies, S.ctx);
      await sleep(1500);
      await tab.eval(`__q('[data-module-root=vault] >>> .vt-row .sdk-open', 'plain.pdf').click()`);
      await until(tab, WINS, (v) => v === 1, 8000);
      await sleep(400);
      const first = await frontBox(tab);
      if (first.t < first.ct || first.l < first.cl) fail(`the first window opens at ${Math.round(first.l)},${Math.round(first.t)}, outside the canvas (${Math.round(first.cl)},${Math.round(first.ct)})`);
      const bar = await tab.rect('.fv-win.is-front .mf-titlebar-title');
      const x = bar.x + 4; const y = bar.y + bar.h / 2;
      await tab.mouse('mouseMoved', x, y, { button: 'none', clickCount: 0 });
      await tab.mouse('mousePressed', x, y);
      await tab.mouse('mouseMoved', x - 900, y - 600);
      await tab.mouse('mouseReleased', x - 900, y - 600);
      await sleep(300);
      const b = await frontBox(tab);
      if (b.t < b.ct - 0.5 || b.l < b.cl - 0.5 || b.b > b.cb + 0.5 || b.r > b.cr + 0.5) fail(`a window dragged to the corner is at ${Math.round(b.l)},${Math.round(b.t)} and the canvas starts at ${Math.round(b.cl)},${Math.round(b.ct)}`);
      say(`space page: first window at ${Math.round(first.l)},${Math.round(first.t)}; dragged to the corner it stops at ${Math.round(b.l)},${Math.round(b.t)} (the canvas starts at ${Math.round(b.cl)},${Math.round(b.ct)})`);
      await tab.key('Escape');
    } finally { await tab.close(); }
  }
}

// The picture opens the file too: a real mouse click on the middle of each file's picture (or its type tile) in the Grid and in the List,
// at a wide and a narrow width, opens the file's window; in Select mode it ticks the file instead. (Thomas, 2026-11-04: the thumbnail did
// not open the file, only the name did.)
export async function thumbOpensCases({ S, say, fail, open, until }) {
  const names = ['photo.jpg', 'tone.mp3', 'clip.webm', 'planted.md', 'plain.pdf', 'locked.pdf', 'gone.png'];
  const spot = (tab, name) => tab.eval(`(() => { const b = __q(${JSON.stringify(ROW)}, ${JSON.stringify(name)}) || __q('#module-frame >>> .vt-card .sdk-open', ${JSON.stringify(name)}); if (!b) return null; const t = b.closest('[data-id]').querySelector('.vt-thumb'); if (!t) return null; t.scrollIntoView({ block: 'center' }); const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  for (const [width, view] of [[1280, 'Grid'], [1280, 'List'], [390, 'Grid'], [390, 'List']]) {
    const tab = await open(width, 'mia', view === 'List' ? '#module-frame >>> .vt-card' : undefined); // the choice is kept: the Grid is what the page shows after a Grid round
    try {
      await tab.click('.mf-switch-btn', view);
      await sleep(600);
      let opened = 0; const bad = [];
      for (const name of names) {
        const p = await spot(tab, name);
        if (!p) { bad.push(`${name} (no picture found)`); continue; }
        await sleep(150);
        await tab.mouse('mouseMoved', p.x, p.y, { button: 'none', clickCount: 0 }); await tab.mouse('mousePressed', p.x, p.y); await tab.mouse('mouseReleased', p.x, p.y);
        const n = await until(tab, WINS, (v) => v >= 1, 2500).catch(() => 0);
        if (n >= 1) { opened++; await tab.key('Escape'); await until(tab, WINS, (v) => v === 0, 3000).catch(() => {}); } else bad.push(name);
        if (n < 1) say(`  not opened: ${name}`);
      }
      if (bad.length) fail(`${view} at ${width}px: a click on the picture did not open ${bad.join(', ')}`);
      say(`${view} at ${width}px: a click on the picture opened ${opened} of ${names.length} files`);
    } finally { await tab.close(); }
  }
  // Select mode: the picture ticks the file, as the name does
  const tab = await open(1280, 'mia');
  try {
    await tab.click('.mf-switch-btn', 'Grid'); await sleep(500);
    await tab.eval(`(() => { const r = []; (function walk(x) { r.push(x); for (const e of x.querySelectorAll('*')) if (e.shadowRoot) walk(e.shadowRoot); })(document); for (const x of r) { const b = x.querySelector('button[aria-label="Select"]'); if (b) { b.click(); return true; } } return false; })()`);
    await sleep(400);
    const p = await spot(tab, 'photo.jpg');
    await tab.mouse('mouseMoved', p.x, p.y, { button: 'none', clickCount: 0 }); await tab.mouse('mousePressed', p.x, p.y); await tab.mouse('mouseReleased', p.x, p.y);
    await sleep(400);
    const ticked = await tab.eval(`(() => { const b = __q('#module-frame >>> .vt-card .sdk-open', 'photo.jpg'); return b ? b.closest('[data-id]').getAttribute('aria-selected') : 'none'; })()`);
    const n = await tab.eval(WINS);
    if (ticked !== 'true' || n !== 0) fail(`in Select mode a click on the picture ticked ${ticked} and opened ${n} window(s) (ticked, none)`);
    await tab.click('.mf-switch-btn', 'List'); await sleep(400); // the choice is kept, and the next window starts as a List
    say(`Select mode: the picture ticks the file (${ticked}), no window (${n})`);
  } finally { await tab.close(); }
}
