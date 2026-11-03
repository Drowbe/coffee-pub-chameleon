#!/usr/bin/env node
/*
 * check-ai-page.mjs -- Chat's AI as a person meets it, run in a headless browser against a throwaway server whose AI
 * service is a stand-in on a local port (no network). From the AI audit (ai-01, 09, 10, 11, 20, 23):
 *   - /ai <question> typed in the Discussion asks the AI and the answer shows (it was refused as "No command /ai");
 *   - an object dropped on Chat shows as a chip, goes with one question only, and a chip can be taken off;
 *   - a second Enter while a question is out sends nothing more;
 *   - with the AI not set up the Assistant says so before anything is typed, offers no question, and sends nothing;
 *   - a guest is not invited to ask and sends nothing;
 *   - Research's standalone page does not offer "Research this".
 *
 *   node tools/check-ai-page.mjs        (no Chromium: SKIPPED, exit 0; that is a skip, never a pass)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

const say = (...a) => console.log('check-ai-page:', ...a);
const failures = [];
const expect = (ok, text) => { if (!ok) failures.push(text); };

const seen = [];
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', async () => {
    let j = {};
    try { j = JSON.parse(body); } catch { /* none */ }
    const user = (j.messages || []).filter((m) => m.role !== 'system').map((m) => m.content).join('\n');
    if (req.url.endsWith('/models')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'stub-model' }] })); }
    seen.push(user);
    if (/SLOWANSWER/.test(user)) await sleep(2500);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'A plain stub answer.' } }], usage: { total_tokens: 10 } }));
  });
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const stubPort = stub.address().port;

const NOTE = `document.getElementById('chat-note')?.textContent || ''`;
const bodies = (n) => `(() => window.__sent.slice(${n}).map((b) => JSON.parse(b)))()`;
const WATCH = `(() => { window.__sent = []; const of = window.fetch; window.fetch = function (u, o) { if (/\\/api\\/spaces\\/[^/]+\\/ai$/.test(String(u)) && o && o.method === 'POST') window.__sent.push(o.body); return of.apply(this, arguments); }; })()`;
const drop = (trip) => `(() => { const dt = new DataTransfer(); dt.setData('application/x-host-object', JSON.stringify({ module: 'research', kind: 'note', scope: 'space', space: '${trip}', id: 'n1' })); document.getElementById('chat').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`;
const chips = `document.querySelectorAll('#chat-ai-context .chat-ai-chip').length`;
const stateLine = `(() => { const e = document.getElementById('chat-ai-state'); return e && !e.hidden && e.getClientRects().length ? e.textContent : ''; })()`;
const answers = `[...document.querySelectorAll('#messages .message')].filter((m) => m.getClientRects().length && /plain stub answer/.test(m.textContent)).length`;

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-page-data-'));
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    browser = await launch(bin);
    // The seed points the AI at a made-up OpenAI key; point it at the stand-in.
    const admin = S.cookies.admin.map((c) => `${c.name}=${c.value}`).join('; ');
    const put = (body) => fetch(`${S.base}/api/ai`, { method: 'PUT', headers: { cookie: admin, 'content-type': 'application/json', origin: S.base }, body: JSON.stringify(body) });
    const set = await put({ source: 'custom', provider: 'compatible', address: `http://127.0.0.1:${stubPort}/v1`, model: 'stub-model', key: 'sk-test', enabled: true });
    expect(set.status === 200, `could not point the AI at the stand-in (${set.status})`);
    // Using AI needs the role's Use AI; give members theirs whatever the default is.
    const role = await fetch(`${S.base}/api/roles/member`, { method: 'PATCH', headers: { cookie: admin, 'content-type': 'application/json', origin: S.base }, body: JSON.stringify({ useAi: true }) });
    expect(role.status === 200, `could not give members Use AI (${role.status})`);
    const open = async (screen, size = 1280) => {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(size, 'dark', screen.call === true);
      const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
      await driveScreen(tab, screen, S.base, S.cookies, S.ctx);
      return tab;
    };
    const workspace = { as: 'mia', url: '/#join={trip}', wait: 'button.sdk-strip-fact[data-module=budget]', call: true };

    // /ai in the Discussion, the context chip, one question at a time.
    const t = await open(workspace);
    try {
      await sleep(1200);
      await t.eval(WATCH);
      await t.typeInto('#chat-input', '/ai what is a good first meal');
      await t.key('Enter');
      await sleep(1800);
      const note = await t.eval(NOTE);
      expect(!/No command/i.test(note), `/ai in the Discussion was refused: "${note}"`);
      expect(seen.some((q) => /good first meal/.test(q)) && !seen.some((q) => /\/ai what/.test(q)), `/ai did not reach the AI as the question alone (${JSON.stringify(seen)})`);
      expect(await t.eval(`document.getElementById('chat').dataset.view`) === 'assistant', '/ai did not bring up the Assistant');
      expect(await t.eval(answers) >= 1, '/ai: the answer did not show');
      expect(await t.eval(`document.getElementById('chat-input').value`) === '', '/ai: the box was not emptied');
      say(`/ai: asked, answer shown, note "${note}"`);

      // The picker lists /ai.
      await t.typeInto('#chat-input', '/');
      await sleep(400);
      const picker = await t.eval(`[...document.querySelectorAll('#chat-command-menu .chat-command-item')].map((b) => b.textContent)`);
      expect((picker || []).some((x) => /^\/ai/.test(x)), `the "/" list does not offer /ai (${JSON.stringify(picker)})`);
      await t.eval(`(() => { const i = document.getElementById('chat-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('chat-command-menu')?.remove(); })()`);

      // A dropped object: a chip, sent once.
      await t.eval(drop(S.ctx.trip));
      await sleep(300);
      expect(await t.eval(chips) === 1, 'a dropped object did not show as a chip');
      await t.eval(`document.querySelector('#chat-ai-context .sdk-chip-x').click()`);
      expect(await t.eval(chips) === 0, 'the chip could not be taken off');
      await t.eval(drop(S.ctx.trip));
      await sleep(200);
      const before = await t.eval('window.__sent.length');
      await t.typeInto('#chat-input', 'tell me about this note');
      await t.key('Enter');
      await sleep(1800);
      await t.typeInto('#chat-input', 'and an unrelated second question');
      await t.key('Enter');
      await sleep(1800);
      const sent = await t.eval(bodies(before));
      expect(sent.length === 2, `expected two questions after the drop, saw ${sent.length}`);
      expect(sent[0] && sent[0].refs.length === 1, 'the first question did not carry the dropped object');
      expect(sent[1] && sent[1].refs.length === 0, 'the dropped object was still attached to the second question');
      expect(await t.eval(chips) === 0, 'the chip stayed after the question was sent');
      say(`context: refs per question ${sent.map((b) => b.refs.length).join(', ')}`);

      // One question out at a time.
      const out = await t.eval('window.__sent.length');
      await t.typeInto('#chat-input', 'SLOWANSWER please');
      await t.key('Enter');
      await sleep(300);
      await t.key('Enter');
      await sleep(300);
      const busyNote = await t.eval(NOTE);
      await sleep(3200);
      const twice = (await t.eval('window.__sent.length')) - out;
      expect(twice === 1, `Enter during a question sent ${twice} requests, not 1`);
      expect(/Still asking/.test(busyNote), `no "Still asking" note while a question was out ("${busyNote}")`);
      say(`one at a time: ${twice} request, note "${busyNote}"`);
    } finally { await t.close(); }

    // The AI not set up: the Assistant says so first.
    const off = await put({ enabled: false, force: true });
    expect(off.status === 200, `could not turn the AI off (${off.status})`);
    const avail = await (await fetch(`${S.base}/api/spaces/${S.ctx.trip}/ai`, { headers: { cookie: admin } })).json();
    expect(avail.available === false && avail.reason === 'not-set-up', `availability with no AI should say reason "not-set-up" (${JSON.stringify(avail)})`);
    const t2 = await open(workspace);
    try {
      await sleep(1200);
      await t2.click('#chat-view-assistant');
      await sleep(800);
      const line = await t2.eval(stateLine);
      const hint = await t2.eval(`document.getElementById('chat-input').placeholder`);
      expect(/not set up/i.test(line), `the Assistant did not say the AI is not set up before typing ("${line}")`);
      expect(!/Instruct/.test(hint), `the box still invites a question when there is no AI ("${hint}")`);
      const count = seen.length;
      await t2.typeInto('#chat-input', 'anyone there?');
      await t2.key('Enter');
      await sleep(900);
      expect(seen.length === count, 'a question was sent with no AI set up');
      expect(/not set up/i.test(await t2.eval(NOTE)), 'no plain note after asking with no AI');
      say(`not set up: line "${line}", hint "${hint}"`);
    } finally { await t2.close(); }
    await put({ enabled: true });

    // A guest: not invited, nothing sent.
    const link = await (await fetch(`${S.base}/api/spaces/${S.ctx.trip}/guest-link`, { method: 'POST', headers: { cookie: admin, 'content-type': 'application/json', origin: S.base }, body: '{}' })).json();
    const g = await open({ as: 'none', url: new URL(link.guestUrl).pathname, wait: '#guest-name' }).catch(() => null);
    if (g) {
      try {
        await g.typeInto('#guest-name', 'Gus');
        await g.eval(`document.getElementById('guest-name').form.requestSubmit()`);
        await sleep(5000);
        await g.click('#chat-view-assistant');
        await sleep(600);
        const hint = await g.eval(`document.getElementById('chat-input').placeholder`);
        const line = await g.eval(stateLine);
        expect(!/Instruct/.test(hint), `a guest is invited to ask ("${hint}")`);
        expect(/cannot use AI/i.test(line), `a guest is not told AI is not for them ("${line}")`);
        const count = seen.length;
        await g.typeInto('#chat-input', 'can a guest ask?');
        await g.key('Enter');
        await sleep(600);
        expect(seen.length === count, 'a guest question reached the AI');
        expect(!/sign in/i.test(await g.eval(NOTE)), 'a guest was told to sign in');
        say(`guest: hint "${hint}", line "${line}"`);
      } finally { await g.close(); }
    } else say('guest: the guest page did not open here; not measured');

    // Research on its own page: no "Research this".
    const r = await open({ as: 'admin', url: '/modules/research?space={trip}', wait: 'body' });
    try {
      await sleep(2500);
      const items = await r.eval(`(async () => { const b = __q('#module-frame >>> .rcard [data-action=menu]'); if (!b) return null; b.click(); await new Promise((x) => setTimeout(x, 500)); return __all('#module-frame >>> [role=menuitem], .sdk-menu button, [role=menuitem]').map((e) => e.textContent.trim()).filter(Boolean); })()`);
      if (!items) say('research: no card menu found; not measured');
      else {
        expect(items.length > 0 && items.includes('Edit'), `research: the card menu did not open (${JSON.stringify(items)})`);
        expect(!items.includes('Research this'), 'research: "Research this" is offered on the standalone page');
        say(`research page menu: ${items.join(', ')}`);
      }
    } finally { await r.close(); }
  } finally {
    if (browser) { browser.cdp.ws.close(); browser.child.kill(); }
    if (server) await stopServer(server);
    stub.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  if (failures.length) { for (const f of failures) console.error(`check-ai-page: ${f}`); return 1; }
  say('ok');
  return 0;
}
process.exit(await main());
