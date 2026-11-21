#!/usr/bin/env node
/*
 * check-agent-pages.mjs -- the agent pages (documentation/plans/plan-agent-access.md, step 2), live in headless Chromium against
 * throwaway servers (AGENT_TOKENS=true, and one without it):
 *   - Manage > Users, the Agents section: with the server variable off it says so and offers no switch and no "Add an agent";
 *     with it on, the owner turns the switch on (saved on the server), and "Add an agent" appears;
 *   - Add an agent (name box, default Claude) opens the agent's page; its row in the list reads "<name> (agent)", has Open
 *     and none of Mute, Kick, two-step, calendar feed or an Edit profile link, and Open goes to the page;
 *   - the agent's page: rename, Make token (the token is in a dialog once, with the plain warning and Copy; after Done and after
 *     a reload it is on no page, and the server never tells it again), Revoke, Turn off and Turn on (a token can't be made while it
 *     is off, the server's sentence is read), Delete (typed confirm) and What it did (the log in plain words, notes for a line over
 *     its limit or a refused token, paged with Show older);
 *   - no Post in Chat switch: the agent's page says what agents may do is set on Roles (plan-agent-matrix.md); What it did
 *     reads the Chat lines (Read Chat, Posted in Chat, Refused post);
 *   - the Roles grid (plan-agent-matrix.md, step 2): the Agent column only when the server's `columns` has it; a cell on the server's
 *     `never.agent` list has no box (and is kept aligned); the Agents row has a box only under Agent; the sentence of what an agent
 *     never does is under the grid; a tick saves as it is clicked and is kept; the links to Roles resolve; 1280 and 390 wide;
 *   - set-up agents (plan-admin-agent.md, step 1): the Set-up agents switch only with AGENT_SETUP, the kind offered only while it
 *     is on, a set-up agent made from the page and shown as "Claude (set-up agent)", and the grid's Set-up agent column (its two
 *     rows boxed only there, every other cell of it boxless, a tick saved);
 *   - the set-up agent's page (plan-admin-agent.md, step 4): Waiting for you with Approve and Decline (a 409's plain sentence, the list
 *     drawn again), Undo on each change (off with the server's reason; a made space asks "Remove this space?" first, Cancel keeps
 *     it), What it did in plain words with no person's name, the connect guide for a set-up agent, what it has left today, the bell
 *     line's address opening the right agent, and no such lists on an ordinary agent's page; "Made by Claude (set-up agent)" with Keep
 *     on Manage's spaces list and on Home (owners and the admin only, one question, Keep does not enter the space); 1280 and 390 wide;
 *   - a member has no Manage page and the server refuses them the agent's token and log (403);
 *   - a script-looking name, route, action, address, message and space name is drawn as text: no element is made, nothing runs;
 *   - a space's Set up, Members: the agent is there as "<name> (agent)" with no moderator tick, and adds like a member;
 *   - at 390 wide: nothing scrolls sideways and the buttons on the agent's page and in the token dialog are at least 44 px tall
 *     (by their box or a hit area), and the page reads the same way.
 * `--shots=<dir>`: also writes pictures (the Users tab, the agent's page, the token dialog; dark, and light for the page and the dialog).
 * With no Chromium it says SKIPPED (not a pass).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stopBrowser } from './browser-launch.mjs';
import { findBrowser, launch, freePort, startServer, stopServer, Tab, sleep } from './shots.mjs';
import { PASSWORD, TODAY } from './shots-seed.mjs';

const say = (...a) => console.log('check-agent-pages:', ...a);
const failures = [];
const expect = (ok, text) => { if (!ok) failures.push(text); };
const shotsArg = process.argv.find((a) => a.startsWith('--shots='));
const SHOTS = shotsArg ? path.resolve(shotsArg.slice('--shots='.length)) : '';
const HOSTILE = '<img src=x onerror=window.__pwn=1>';
const WARNING = 'This is shown once. If you lose it, make a new one; the old one then stops working.';
const NEVER_NOTE = 'A token that never expires works until you revoke it. Keep it private, and revoke it if it leaks.';
const SPACE_NAME = 'Paris <b>trip</b>';

const jarOf = (res) => res.headers.getSetCookie().map((c) => { const [nv] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1) }; });

// The env-var choice in the connect guide (root = 'dialog.agent-token-dialog' or '#agent-page'): its heading, address, variable name,
// the three commands and the steps. `token` is what must be in the commands (the real token or the placeholder).
const ENV_HEAD = 'Codex (an app with environment-variable fields)';
async function envChoice(t, root, token, origin, label) {
  const v = await t.eval(`(() => { const r = document.querySelector(${JSON.stringify(root)}); const h = [...r.querySelectorAll('h4')].find((e) => e.textContent === ${JSON.stringify(ENV_HEAD)}); const ol = r.querySelector('[data-agent-env]'); const sf = r.querySelector('[data-agent-env-safer]'); const ci = r.querySelector('[data-agent-codex-signin]'); const hs = [...r.querySelectorAll('h4')].map((e) => e.textContent); const hint = h && h.nextElementSibling ? h.nextElementSibling.textContent : ''; const sh = [...r.querySelectorAll('h4')].some((e) => e.textContent === 'Safer, needs a terminal'); if (!h || !ol || !sf || !ci) return null; const copies = (o) => [...o.querySelectorAll('.agent-copy-text')].map((e) => e.textContent); const labs = (o) => [...o.querySelectorAll('.agent-copy > p.hint')].map((e) => e.textContent); const steps = (o) => [...o.children].map((e) => e.firstChild.textContent); const box = ol.getBoundingClientRect(); const box2 = sf.getBoundingClientRect(); const all = [...ol.querySelectorAll('.agent-copy-text'), ...sf.querySelectorAll('.agent-copy-text')]; return { ci: steps(ci), hs, hint, ci0: ci.compareDocumentPosition(ol) & 4, c: copies(ol), lab: labs(ol), steps: steps(ol), c2: copies(sf), lab2: labs(sf), steps2: steps(sf), sh, right: Math.max(box.right, box2.right), width: window.innerWidth, sideways: document.documentElement.scrollWidth - window.innerWidth, wrap: all.every((e) => e.getBoundingClientRect().right <= window.innerWidth + 1) }; })()`);
  expect(!!v, `${label}: the Codex choice is missing`);
  if (!v) return;
  expect(v.c.length === 2 && v.c[0] === `${origin}/mcp` && v.c[1] === `Bearer ${token}`, `${label}: the address or the header value is wrong (${JSON.stringify(v.c)})`);
  expect(v.lab.join('|') === 'Address|Header value', `${label}: the labels are ${v.lab.join('|')}`);
  expect(v.steps.length === 9 && /^Open Connect to a custom MCP, and type Chameleon \(or the server's name\) in Name\./.test(v.steps[0]) && /^Under Type, choose Streamable HTTP, not STDIO\./.test(v.steps[1]) && /^Leave Bearer token env var empty\./.test(v.steps[3]) && /^Under Headers, choose Add header\. Key: Authorization\./.test(v.steps[4]) && /^Leave Headers from environment variables empty\./.test(v.steps[5]) && /^Save the server, then select Restart\./.test(v.steps[6]) && /^In a Codex conversation type \/mcp: Chameleon should be listed and Enabled\./.test(v.steps[7]) && /^Start a new Codex conversation and ask the first question above\./.test(v.steps[8]), `${label}: the steps are not as written`);
  expect(v.ci.length === 5 && /^Add the server with only the address \(the URL above\)/.test(v.ci[0]) && /Leave Bearer token env var and Headers empty\./.test(v.ci[0]) && /^Save, then select Restart\./.test(v.ci[1]) && /^Select Authenticate next to Chameleon in the server list\. A Chameleon page opens: choose the agent and Allow\./.test(v.ci[2]) && /^In a Codex conversation type \/mcp: Chameleon should be listed and Enabled\./.test(v.ci[3]) && /^Start a new Codex conversation/.test(v.ci[4]), `${label}: the Codex sign-in steps are not as written`);
  const order = ['Sign in (first choice)', "If it can't sign in, use a token", 'Safer, needs a terminal'].map((x) => v.hs.indexOf(x));
  expect(order[0] > v.hs.indexOf(ENV_HEAD) && order[1] > order[0] && order[2] > order[1] && v.ci0 === 4, `${label}: the Codex paths are not in order: sign in, token, safer (${JSON.stringify(order)})`);
  expect(v.hint.includes('This worked in a test on 21 November 2026 with a token header. Signing in from this app has not been tested yet.') && !v.hint.includes('not tested end to end') && v.hint.includes("ChatGPT's own chat (Plugins) takes custom servers only on some plans, Business and Enterprise, and needs sign-in, not a token; Codex works on other plans.") && !/Plus/.test(v.hint), `${label}: the Codex note is not as written`);
  expect(v.sh, `${label}: the Safer, needs a terminal heading is missing`);
  expect(v.c2.length === 4 && v.c2[0] === 'CHAMELEON_TOKEN', `${label}: the variable name is wrong (${JSON.stringify(v.c2.slice(0, 1))})`);
  expect(v.c2[1] === `setx CHAMELEON_TOKEN "${token}"` && v.c2[2] === `echo 'export CHAMELEON_TOKEN="${token}"' >> ~/.zshrc` && v.c2[3] === `echo 'export CHAMELEON_TOKEN="${token}"' >> ~/.bashrc`, `${label}: the three system commands are wrong (${JSON.stringify(v.c2.slice(1))})`);
  expect(v.lab2.join('|') === 'Variable name|Windows (PowerShell)|macOS (Terminal)|Linux (shell)', `${label}: the safer labels are ${v.lab2.join('|')}`);
  expect(v.steps2.length === 4 && /^Bearer token env var: type the name of a variable, not the token\./.test(v.steps2[0]) && /^Leave Headers empty\./.test(v.steps2[1]) && /^Quit the app and open it again/.test(v.steps2[3]), `${label}: the safer steps are not as written`);
  expect(v.sideways <= 1 && v.wrap && v.right <= v.width + 1, `${label}: the choice runs outside the window (${JSON.stringify({ s: v.sideways, r: v.right, w: v.width })})`);
}

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const dirs = [];
  const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pages-')); dirs.push(d); return d; };
  let server = null; let plain = null; let browser = null; let exp = null; let setup = null;
  try {
    plain = await startServer(tmp(), await freePort(), 'first', { AGENT_TOKENS: '' });
    const dataDir = tmp();
    server = await startServer(dataDir, await freePort(), 'first', { AGENT_TOKENS: 'true' });
    const jars = {};
    const call = async (as, method, url, body, srv = server, bearer = null) => {
      const headers = { 'content-type': 'application/json', accept: 'application/json', origin: srv.base };
      if (bearer) headers.authorization = `Bearer ${bearer}`;
      else if (jars[`${srv.base}|${as}`]) headers.cookie = jars[`${srv.base}|${as}`].map((c) => `${c.name}=${c.value}`).join('; ');
      const res = await fetch(srv.base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      let json = null; try { json = await res.json(); } catch { /* none */ }
      return { status: res.status, json, res };
    };
    const signIn = async (login, srv = server) => {
      const r = await call('__none', 'POST', '/api/login', { login, password: PASSWORD }, srv);
      expect(r.status === 200, `cannot sign in as ${login}: ${r.status}`);
      jars[`${srv.base}|${login}`] = jarOf(r.res);
    };
    await signIn('admin'); await signIn('admin', plain);
    expect((await call('admin', 'POST', '/api/users', { login: 'mia', displayName: 'Mia', role: 'member', password: PASSWORD })).status === 201, 'could not make the member');
    await signIn('mia');
    const space = (await call('admin', 'POST', '/api/spaces', { name: SPACE_NAME, description: '', members: [] })).json.space;

    browser = await launch(bin);
    const open = async (size, mode, as, srv = server) => {
      const tab = new Tab(browser.cdp, {});
      await tab.open(size, mode, false);
      for (const c of jars[`${srv.base}|${as}`] || []) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: srv.base, httpOnly: true }, tab.sid);
      const problems = [];
      tab.cdp.listeners.push((m) => {
        if (m.sessionId !== tab.sid) return;
        if (m.method === 'Runtime.exceptionThrown') problems.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
      });
      tab.problems = problems;
      tab.srv = srv;
      return tab;
    };
    // Through a blank page first, so an address that differs only by its #part is a real load, as a reload is.
    const go = async (tab, url) => { await tab.cdp.send('Page.navigate', { url: 'about:blank' }, tab.sid); await sleep(100); await tab.cdp.send('Page.navigate', { url: tab.srv.base + url }, tab.sid); await sleep(300); await tab.settle(); if (url.includes('#agent/') && !url.endsWith('/nobody')) await tab.waitFor('[data-agent-title]:not(:empty)', '', 40000).catch(() => {}); }; // the agent's page has drawn before a step reads it
    const shot = async (tab, name, full = true) => { if (SHOTS) fs.writeFileSync(path.join(SHOTS, `${name}.png`), await tab.shoot(full)); };
    const text = (tab, sel) => tab.eval(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
    const hiddenOf = (tab, sel) => tab.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !e || e.hidden || !e.getClientRects().length; })()`);
    const waitText = async (tab, sel, want, ms = 8000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { if ((await text(tab, sel)).includes(want)) return true; await sleep(100); }
      return false;
    };
    const dialogOpen = (tab) => tab.eval(`!!document.querySelector('dialog[open]')`);
    const waitDialog = async (tab, on, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await dialogOpen(tab) === on) return true; await sleep(100); } return false; };
    const wide = (tab) => tab.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    // The tallest of a control's box and its enlarged hit area (a transparent ::after), as check-phone-targets measures it.
    const hit = (tab, sel) => tab.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return 0; const b = e.getBoundingClientRect(); const a = getComputedStyle(e, '::after'); const h = a.content !== 'none' && a.position === 'absolute' ? parseFloat(a.height) || 0 : 0; return Math.max(b.height, h); })()`);
    // A click after the control is brought to the middle of the window: nearest would leave it under the top bar's tabs.
    const press = async (tab, sel) => { await tab.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.scrollIntoView({ block: 'center' }); })()`); await sleep(100); await tab.click(sel); };
    const pwn = (tab) => tab.eval(`window.__pwn === undefined ? 0 : 1`);

    // ---- the server's variable off: the section says so, nothing to switch or add ----
    {
      const tab = await open(1280, 'dark', 'admin', plain);
      await go(tab, '/admin#users');
      await tab.waitFor('#agents-off-server:not([hidden])').catch(() => {});
      expect(!(await hiddenOf(tab, '#agents-off-server')), 'the server variable is off and the page does not say so');
      expect((await text(tab, '#agents-off-server')) === 'Agents are off on this server. The person who runs the server sets AGENT_TOKENS=true and restarts it.', `the off-server sentence is "${await text(tab, '#agents-off-server')}"`);
      expect(await hiddenOf(tab, '#agents-on-server') && await hiddenOf(tab, '#add-agent-toggle'), 'the server variable is off and the page still offers the switch or "Add an agent"');
      expect(tab.problems.length === 0, `server variable off: ${tab.problems.join('; ')}`);
      await tab.close();
    }

    // ---- the owner: the switch, add an agent, the row ----
    const tab = await open(1280, 'dark', 'admin');
    await go(tab, '/admin#users');
    await tab.waitFor('#agents-on-server:not([hidden])');
    expect(await tab.eval(`!document.getElementById('set-agents').checked`) && await hiddenOf(tab, '#add-agent-toggle'), 'before the switch is on, the page offers "Add an agent"');
    if (SHOTS) await shot(tab, 'users-before-switch-1280-dark');
    await tab.click('#set-agents');
    await tab.waitFor('#add-agent-toggle:not([hidden])');
    await sleep(300);
    expect((await call('admin', 'GET', '/api/settings')).json.settings.agents === true, 'the switch did not turn Agents on on the server');
    await tab.click('#add-agent-toggle');
    await tab.waitFor('#new-agent-name');
    expect(await tab.eval(`document.getElementById('new-agent-name').value`) === 'Claude', 'the name box does not start as Claude');
    await tab.eval(`(() => { const i = document.getElementById('new-agent-name'); i.value = ${JSON.stringify(HOSTILE)}; })()`);
    await tab.click('#add-agent button[type="submit"]');
    await tab.waitFor('#agent-page:not([hidden])');
    await sleep(300);
    const agents = (await call('admin', 'GET', '/api/users')).json.users.filter((u) => u.agent);
    expect(agents.length === 1 && agents[0].displayName === HOSTILE, 'Add an agent did not make one agent with the typed name');
    const agent = agents[0];
    expect(await tab.eval(`location.hash`) === `#agent/${agent.key}`, `the address after Add is ${await tab.eval('location.hash')}`);
    expect((await text(tab, '[data-agent-title]')) === `${HOSTILE} (agent)`, 'a script-looking name is not drawn as text in the title');
    expect(await tab.eval(`document.querySelectorAll('#agent-page img, #agent-page script').length`) === 0 && !(await pwn(tab)), 'a script-looking name made an element or ran');
    expect(await tab.eval(`document.getElementById('users-main').hidden`), 'the list shows beside the agent page');

    // The name, renamed to Claude.
    await tab.eval(`(() => { const i = document.querySelector('[data-agent-name]'); i.value = 'Claude'; })()`);
    await press(tab, '[data-agent="rename"]');
    expect(await waitText(tab, '[data-agent-title]', 'Claude (agent)'), 'Save name did not change the title');
    expect((await call('admin', 'GET', `/api/users/${agent.key}`)).json.user.displayName === 'Claude', 'Save name did not save on the server');

    // The row in the list.
    await press(tab, '[data-agent="back"]');
    await tab.waitFor('#users-main:not([hidden])');
    const row = await tab.eval(`(() => { const c = document.querySelector('#users .user-card[data-key="${agent.key}"]'); if (!c) return null; const vis = (s) => { const e = c.querySelector(s); return !!e && !e.hidden && e.getClientRects().length > 0; }; const open = c.querySelector('[data-action="edit"]'); return { name: c.querySelector('[data-name]').textContent, mute: vis('[data-action="mute"]'), kick: vis('[data-action="kick"]'), mfa: vis('[data-mfa]'), feed: vis('[data-feed]'), feedOff: vis('[data-action="feed-off"]'), open: open.textContent, href: open.getAttribute('href'), text: c.textContent }; })()`);
    expect(row && row.name === 'Claude (agent)', `the agent's row reads "${row && row.name}"`);
    expect(row && !row.mute && !row.kick && !row.mfa && !row.feed && !row.feedOff, 'the agent row has a call, two-step or feed control');
    expect(row && row.open === 'Open' && row.href === `#agent/${agent.key}`, `the agent row's link is "${row && row.open}" to ${row && row.href}, not Open to its page`);
    expect(row && !/password|personal link|moderator/i.test(row.text), 'the agent row mentions a password, a personal link or a moderator');
    expect(await tab.eval(`document.querySelectorAll('#users .user-card:not([data-key="${agent.key}"]) [data-action="edit"]')[0].textContent`) === 'Edit profile', 'a person\'s row no longer says Edit profile');
    await shot(tab, 'users-1280-dark');
    await tab.click(`#users .user-card[data-key="${agent.key}"] [data-action="edit"]`);
    await tab.waitFor('#agent-page:not([hidden])');
    expect(await tab.eval(`location.hash`) === `#agent/${agent.key}`, 'Open did not go to the agent page');

    // Seed the log: a space it works in, and older lines (a previous day), some of them hostile.
    expect((await call('admin', 'PATCH', `/api/spaces/${space.id}`, { members: ['mia', agent.key] })).status === 200, 'could not add the agent to the space');
    const logDir = path.join(dataDir, 'agent-log', agent.key);
    fs.mkdirSync(logDir, { recursive: true });
    // The module's name as this environment shows it (the page reads it from GET /api/modules, installed first, then bundled).
    const modulesAnswer = (await call('admin', 'GET', '/api/modules')).json;
    const sched = (modulesAnswer.modules || []).find((m) => m.id === 'schedule') || (modulesAnswer.bundled || []).find((m) => m.id === 'schedule');
    const SCHEDULE_NAME = sched && (sched.displayName || sched.name);
    expect(SCHEDULE_NAME, 'the schedule module has no name in GET /api/modules');
    const lines = [];
    const at = (n) => new Date(Date.UTC(2026, 9, 14, 8, 0, 0) + n * 1000).toISOString();
    // A client's health check: four /mcp handshake lines in one minute from one address (one displayed line), then a tool call after them (its own line).
    for (let i = 0; i < 4; i++) lines.push({ at: at(-10 + i), agent: agent.key, token: 'tok1', method: i === 3 ? 'GET' : 'POST', route: '/mcp', space: null, module: null, action: null, request: null, message: null, status: i === 3 ? 405 : 200, address: '203.0.113.9', kind: 'read' });
    lines.push({ at: at(-6), agent: agent.key, token: 'tok1', method: 'GET', route: '/api/objects/search', space: null, module: null, action: null, request: null, message: null, status: 200, address: '203.0.113.9', kind: 'read' });
    for (let i = 0; i < 120; i++) lines.push({ at: at(i), agent: agent.key, token: 'tok1', method: 'GET', route: '/api/modules/:id/data', space: space.id, action: null, request: null, message: null, status: 200, address: '203.0.113.9', kind: 'read', module: 'schedule' });
    lines.push({ at: at(200), agent: agent.key, token: 'tok1', method: 'POST', route: '/api/spaces/:id/action', space: space.id, module: 'schedule', action: 'schedule:addMilestone', request: 7, message: null, status: 202, address: '203.0.113.9', kind: 'write' });
    lines.push({ at: at(201), agent: agent.key, token: 'tok1', method: 'GET', route: HOSTILE, space: null, module: HOSTILE, action: HOSTILE, request: null, message: '<b>hi</b>', status: 200, address: HOSTILE, kind: 'read' });
    lines.push({ at: at(205), agent: agent.key, token: 'tok1', method: 'GET', route: '/api/modules/:id/data', space: space.id, module: HOSTILE, action: null, request: null, message: null, status: 200, address: '203.0.113.9', kind: 'read' });
    lines.push({ at: at(206), agent: agent.key, token: 'tok1', method: 'GET', route: '/api/modules/:id/data/:key', space: space.id, module: 'to-do-list', action: null, request: null, message: null, status: 200, address: '203.0.113.9', kind: 'read' });
    const wrongMethod = (n, method, route) => lines.push({ at: at(n), agent: agent.key, token: 'tok1', method, route, space: space.id, module: 'schedule', action: null, request: null, message: null, status: 403, address: '203.0.113.9', kind: 'read' });
    wrongMethod(207, 'DELETE', '/api/modules/:id/data');
    wrongMethod(208, 'POST', '/api/modules/:id/data/:key');
    wrongMethod(209, 'POST', '/api/spaces/:id/actions');
    wrongMethod(210, 'DELETE', '/api/spaces/:id/action/:requestId');
    wrongMethod(211, 'GET', '/api/spaces/:id/action');
    lines.push({ at: at(202), agent: agent.key, token: 'tok1', method: 'POST', route: '/api/spaces/:id/action', space: space.id, action: `x:${HOSTILE}`, request: 8, message: null, status: 202, address: '<script>window.__pwn=1</script>', kind: 'write' });
    lines.push({ at: at(203), agent: agent.key, token: 'tok1', method: 'GET', route: '/api/modules/:x/data/:x', space: null, module: null, action: null, request: null, message: null, status: 403, address: '203.0.113.9', kind: 'read' });
    lines.push({ at: at(204), agent: agent.key, token: 'tok1', method: 'GET', route: '/api/agent/me', space: null, module: null, action: null, request: null, message: null, status: 401, address: '203.0.113.9', kind: null });
    const chatLine = (n, method, status, message) => ({ at: at(n), agent: agent.key, token: 'tok1', method, route: '/api/spaces/:id/chat', space: space.id, action: null, request: null, message, status, address: '203.0.113.9', kind: method === 'GET' ? 'read' : 'write' });
    lines.push(chatLine(205, 'GET', 200, 12), chatLine(206, 'GET', 200, 1), chatLine(207, 'POST', 200, 'a1b2c3d4e5f6'), chatLine(208, 'POST', 403, null), chatLine(209, 'GET', 200, 0));
    // The shapes are the server's own (server/agent-log.js): a read's count is a NUMBER, a post's id a 12-hex string.
    fs.writeFileSync(path.join(logDir, '2026-10-14.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

    // The token: made, shown once.
    await go(tab, `/admin#agent/${agent.key}`);
    await tab.waitFor('[data-agent="make"]');
    expect(await text(tab, '[data-agent-token-state]') === 'No token yet.', `with no token the page says "${await text(tab, '[data-agent-token-state]')}"`);
    expect(await text(tab, '[data-agent="make"]') === 'Make token' && await hiddenOf(tab, '[data-agent="revoke"]'), 'Make token / Revoke are not as they are before a token');
    {
      // In no space, then in one: the page's line follows the space's members within the refresh window.
      await call('admin', 'PATCH', `/api/spaces/${space.id}`, { members: ['mia'] });
      await go(tab, `/admin#agent/${agent.key}`);
      await tab.waitFor('[data-agent="make"]');
      expect(await waitText(tab, '[data-agent-spaces]', "Not in any space yet. Add it under a space's Set up, then Members."), `the page says "${await text(tab, '[data-agent-spaces]')}" for an agent in no space`);
      await shot(tab, 'agent-page-no-space-1280-dark');
      await call('admin', 'PATCH', `/api/spaces/${space.id}`, { members: ['mia', agent.key] });
      expect(await waitText(tab, '[data-agent-spaces]', `In 1 space: ${SPACE_NAME}`, 16000), 'the page did not follow the agent being added to a space');
    }
    await shot(tab, 'agent-page-empty-1280-dark');
    // How long should it work: the five words in order, 30 days first; the note shows only for Never expires; the page sends the choice.
    {
      const pick = (v) => tab.eval(`(() => { const s = document.querySelector('[data-agent-lifetime]'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      const choice = await tab.eval(`(() => { const s = document.querySelector('[data-agent-lifetime]'); return { label: s.closest('label').firstChild.textContent, value: s.value, options: [...s.options].map((o) => o.value + '|' + o.textContent) }; })()`);
      expect(choice.label === 'How long should it work?' && choice.value === '30d' && choice.options.join(',') === '30d|30 days (recommended),60d|60 days,90d|90 days,1y|1 year,never|Never expires', `the lifetime choice is ${JSON.stringify(choice)}`);
      expect(await hiddenOf(tab, '[data-agent-never]'), 'the never-expires note shows with 30 days chosen');
      await pick('never');
      expect(!(await hiddenOf(tab, '[data-agent-never]')) && await text(tab, '[data-agent-never]') === NEVER_NOTE, `the never-expires note reads "${await text(tab, '[data-agent-never]')}"`);
      await pick('1y');
      expect(await hiddenOf(tab, '[data-agent-never]'), 'the never-expires note stays after another choice');
    }
    await press(tab, '[data-agent="make"]');
    expect(await waitDialog(tab, true), 'Make token showed no dialog');
    const made = await tab.eval(`(() => { const d = document.querySelector('dialog.agent-token-dialog[open]'); if (!d) return null; return { token: d.querySelector('.agent-token-value').textContent, warning: d.querySelector('.agent-token-warning').textContent, copy: !!d.querySelector('[data-agent="copy"]'), title: d.querySelector('.sdk-dialog-title').textContent, focus: document.activeElement && document.activeElement.textContent }; })()`);
    expect(made && /^agt_[A-Za-z0-9_-]{43}$/.test(made.token), 'the dialog does not show a token');
    expect(made && made.warning === WARNING, `the warning reads "${made && made.warning}"`);
    expect(made && made.copy && made.title === 'Token for Claude (agent)', `the dialog's title is "${made && made.title}" or Copy is missing`);
    const token = made ? made.token : '';
    expect(await tab.eval(`[...document.querySelectorAll('dialog.agent-token-dialog p.hint')].some((e) => /^Works for 1 year, until [A-Z][a-z]{2} \\d{1,2}, \\d{4}\\. Keep it as a secret, never in a chat\\.$/.test(e.textContent))`), 'the token window does not say "Works for 1 year, until <date>."');
    expect(await tab.eval(`(() => { const d = document.querySelector('dialog.agent-token-dialog'); const end = [...d.querySelectorAll('p.hint')].find((e) => e.textContent.startsWith('Works for')); return !!end && !!(end.compareDocumentPosition(d.querySelector('.agent-connect')) & Node.DOCUMENT_POSITION_FOLLOWING); })()`), 'the end is not above the Connect Claude steps');
    expect((await call('admin', 'GET', `/api/users/${agent.key}/token`)).json.token.lifetime === '1y', 'the page did not send the chosen lifetime (expires) with the request');
    {
      const guide = await tab.eval(`(() => { const d = document.querySelector('dialog.agent-token-dialog[open]'); const t = (sel) => [...d.querySelectorAll(sel)].map((e) => e.textContent); return { origin: location.origin, live: d.querySelector('[data-agent-connected]').textContent, steps: t('.agent-steps:not([data-agent-env]):not([data-agent-env-safer]):not([data-agent-codex-signin]) > li').length, command: t('.agent-copy-text:not([data-agent-signin] *)')[0], first: t('.agent-copy-text:not([data-agent-signin] *)')[1], link: d.querySelector('a[href]').href, file: d.querySelector('details.agent-file') && !d.querySelector('details.agent-file').open, tries: t('.agent-try li'), apps: t('.agent-steps:not([data-agent-env]):not([data-agent-env-safer]):not([data-agent-codex-signin]) > li').slice(5), copies: t('.agent-copy-text:not([data-agent-signin] *)'), hint: t('p.hint').filter((x) => x.startsWith('Tested in the Claude app')) }; })()`);
      expect(await tab.eval(`(() => { const s = document.querySelector('dialog.agent-token-dialog [data-agent-signin]'); return !!s && s.querySelector('.agent-copy-text').textContent === location.origin + '/mcp' && /^Using an app that can sign in\\? Give it this address:$/.test(s.querySelector('p').textContent); })()`), 'the token window has no sign-in address block (plan-mcp-oauth.md)');
      expect(guide.copies[2] === `${guide.origin}/mcp` && guide.copies[3] === `Bearer ${token}`, `the Claude apps block's address or header value is "${guide.copies[2]}" / "${guide.copies[3]}"`);
      expect(guide.steps === 10 && guide.apps.length === 5 && guide.apps[0].startsWith('Open the Claude app: Customize, then Connectors, then Add custom connector.') && guide.apps[2] === 'Under Authentication, choose No sign-in.' && guide.apps[4].includes('Which spaces can you see?'), 'the Claude apps steps are not as written');
      expect(guide.hint.length === 1 && guide.hint[0] === "Tested in the Claude app on 2026-11-20. The header value is shown once by the app and never again; if you make a new token, edit the connector's header.", 'the Claude apps honest line is not as written');
      expect(!guide.copies.slice(0, 3).some((x) => x.includes('agt_YOUR')) && guide.copies.filter((x) => x.includes(token)).length === 7, 'the real token is not in exactly the command, the header value, the project file, the Codex header value and the three system commands');
      expect(guide.live === 'Not connected yet', `the window's live line reads "${guide.live}" before any use`);
      expect(guide.steps === 10 && guide.command.includes(token) && guide.first === 'Use the chameleon tools. Which spaces can you see, and what is in the to-do list?', 'the window does not show the ten steps, the command with the token and the first question');
      expect(guide.link === 'https://code.claude.com/docs' && guide.file && guide.tries.length === 3, 'the Claude Code link, the closed project-file disclosure or the three things to try are not as written');
    }
    await envChoice(tab, 'dialog.agent-token-dialog', token, await tab.eval('location.origin'), '1280 token window');
    expect(await waitText(tab, 'dialog.agent-token-dialog [data-agent-spaces]', `In 1 space: ${SPACE_NAME}`), 'the window does not say which space the agent is in');
    expect((await call('x', 'GET', '/api/agent/me', undefined, server, token)).status === 200, 'the token shown does not work');
    expect(await waitText(tab, 'dialog.agent-token-dialog [data-agent-connected]', 'Claude connected, ', 16000), 'the live line in the window did not flip to "Claude connected" within the refresh window');
    await shot(tab, 'token-dialog-1280-dark', false);
    await tab.switchMode('light'); await tab.settle();
    await shot(tab, 'token-dialog-1280-light', false);
    await tab.switchMode('dark'); await tab.settle();
    await press(tab, '[data-agent="token-done"]');
    expect(await waitDialog(tab, false), 'Done did not close the token dialog');
    expect(!(await tab.eval(`document.documentElement.outerHTML.includes(${JSON.stringify(token)}) || document.body.innerText.includes(${JSON.stringify(token)})`)), 'the token is still on the page after Done');
    expect(await text(tab, '[data-agent="make"]') === 'Make a new token' && !(await hiddenOf(tab, '[data-agent="revoke"]')), 'after a token is made the page does not offer a new one and Revoke');
    expect(/^Claude connected, /.test(await text(tab, '[data-agent-connected]')) && (await tab.eval(`document.querySelector('[data-agent-connect] .agent-copy-text:not([data-agent-signin] *)').textContent`)).includes('agt_YOUR_TOKEN'), 'the page does not show "Claude connected" and the command with the placeholder');
    await envChoice(tab, '#agent-page', 'agt_YOUR_TOKEN', await tab.eval('location.origin'), '1280 page');
    expect(await tab.eval(`(() => { const c = [...document.querySelectorAll('[data-agent-connect] .agent-copy-text:not([data-agent-signin] *)')].map((e) => e.textContent); return c.includes('Bearer agt_YOUR_TOKEN') && !c.some((x) => x.includes(${JSON.stringify(token)})); })()`), 'the page does not show the header value with the placeholder only');
    expect(/^Works for 1 year, until [A-Z][a-z]{2} \d{1,2}, \d{4}\.$/.test(await text(tab, '[data-agent-token-state]')), `the token state reads "${await text(tab, '[data-agent-token-state]')}"`);
    expect(await tab.eval(`document.querySelector('[data-agent-lifetime]').value`) === '30d', 'the choice remembered the last lifetime');
    await go(tab, `/admin#agent/${agent.key}`);
    await tab.waitFor('[data-agent="make"]');
    expect(!(await tab.eval(`document.documentElement.outerHTML.includes(${JSON.stringify(token)}) || document.body.innerText.includes(${JSON.stringify(token)})`)), 'the token is on the page after a reload');
    const again = await call('admin', 'GET', `/api/users/${agent.key}/token`);
    expect(again.status === 200 && !JSON.stringify(again.json).includes(token) && again.json.token && !('token' in again.json.token), 'the server told the token again');

    // The log: the agent's own calls, then over its limit.
    for (let i = 0; i < 62; i++) await call('x', 'GET', '/api/agent/me', undefined, server, token);
    expect((await call('x', 'GET', '/api/agent/me', undefined, server, token)).status === 429, 'the agent was not over its limit after 62 reads');
    await go(tab, `/admin#agent/${agent.key}`);
    await tab.waitFor('[data-agent-log] li');
    await tab.waitFor('[data-agent="older"]:not([hidden])').catch(() => {});
    const log = await tab.eval(`(() => { const items = [...document.querySelectorAll('[data-agent-log] li')]; return { whats: items.map((l) => l.querySelector('.agent-log-what').textContent), details: items.map((l) => l.textContent), count: items.length, older: !document.querySelector('[data-agent="older"]').hidden, markup: document.querySelectorAll('[data-agent-log] img, [data-agent-log] script, [data-agent-log] b').length, notes: document.querySelectorAll('[data-agent-log] .is-note').length }; })()`);
    expect(log.whats.includes('Looked at its own limits'), 'the log has no "Looked at its own limits" line');
    expect(log.whats.includes('Over its limit') && log.notes >= 1, 'the log has no "Over its limit" note');
    expect(log.whats[0] === 'Over its limit' || log.whats.slice(0, 3).includes('Over its limit'), `the newest lines are not the newest first (${log.whats.slice(0, 3).join(' | ')})`);
    expect(log.count === 100 && log.older, `the first page is ${log.count} lines with Show older ${log.older ? 'shown' : 'hidden'}, not 100 with it shown`);
    expect(log.whats.includes('Ask for add milestone in ' + SPACE_NAME), `no "Ask for add milestone in ${SPACE_NAME}" line (${log.whats.filter((w) => /Ask/.test(w)).join(' | ')})`);
    expect(log.whats.includes('Refused: GET /api/modules/:x/data/:x'), `no "Refused: GET /api/modules/:x/data/:x" line (${log.whats.filter((w) => /Refused/.test(w)).join(' | ')})`);
    for (const w of ['Refused: DELETE /api/modules/:id/data', 'Refused: POST /api/modules/:id/data/:key', 'Refused: POST /api/spaces/:id/actions', 'Refused: DELETE /api/spaces/:id/action/:requestId', 'Refused: GET /api/spaces/:id/action']) expect(log.whats.includes(w), `a wrong method on a read route is not "${w}" (${log.whats.filter((x) => /Refused/.test(x)).join(' | ')})`);
    expect(log.whats.includes(`Read ${SCHEDULE_NAME} data in ${SPACE_NAME}`), `a data read with a module is not "Read ${SCHEDULE_NAME} data in <space>"`);
    expect(log.whats.includes(`Read To Do List data in ${SPACE_NAME}`), 'an unknown module is not its id, title-cased, "Read To Do List data in <space>"');
    expect(log.whats.includes(`Read data in ${SPACE_NAME}`), 'a script-looking module id is not dropped, leaving "Read data in <space>"');
    expect(log.whats.includes('Token refused'), 'no "Token refused" note for a kind-null 401 line');
    expect(log.whats.includes(`Refused: GET ${HOSTILE}`), 'a script-looking route is not read out as text');
    expect(log.whats.some((w) => w === `Ask for ${('x:' + HOSTILE).split(':').pop().replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()} in ${SPACE_NAME}`), 'a script-looking action is not read out as text');
    expect(log.details.some((d) => d.includes(HOSTILE)) && log.details.some((d) => d.includes('<script>window.__pwn=1</script>')) && log.details.some((d) => d.includes('<b>hi</b>')), 'a script-looking address or message is not shown as text');
    expect(log.markup === 0 && !(await pwn(tab)), 'a value in the log made an element or ran');
    {
      const chatRows = await tab.eval(`[...document.querySelectorAll('[data-agent-log] li')].filter((l) => /Chat|post/.test(l.querySelector('.agent-log-what').textContent)).map((l) => ({ what: l.querySelector('.agent-log-what').textContent, text: l.textContent }))`);
      const row = (what) => chatRows.find((r) => r.what === what);
      expect(chatRows.filter((r) => r.what === 'Read Chat in ' + SPACE_NAME).length === 3, `the log has ${chatRows.filter((r) => r.what === 'Read Chat in ' + SPACE_NAME).length} "Read Chat in ${SPACE_NAME}" lines, not 3 (${chatRows.map((r) => r.what).join(' | ')})`);
      expect(chatRows.some((r) => r.what === 'Read Chat in ' + SPACE_NAME && r.text.includes('12 messages')) && chatRows.some((r) => r.what === 'Read Chat in ' + SPACE_NAME && /1 message(?!s)/.test(r.text)) && chatRows.some((r) => r.what === 'Read Chat in ' + SPACE_NAME && r.text.includes('0 messages')), 'a Chat read (count as a number) does not say "12 messages", "1 message" and "0 messages"');
      expect(row('Posted in Chat in ' + SPACE_NAME) && !row('Posted in Chat in ' + SPACE_NAME).text.includes('a1b2c3d4e5f6'), 'a post is not "Posted in Chat in <space>", or it shows the message id');
      expect(row('Refused post in ' + SPACE_NAME) && row('Refused post in ' + SPACE_NAME).text.includes('didn\'t work (403)'), 'a refused post is not "Refused post in <space>"');
    }
    await shot(tab, 'agent-page-1280-dark');
    await tab.switchMode('light'); await tab.settle();
    await shot(tab, 'agent-page-1280-light');
    await tab.switchMode('dark'); await tab.settle();
    await press(tab, '[data-agent="older"]');
    await sleep(800);
    expect(await tab.eval(`document.querySelectorAll('[data-agent-log] li').length`) > 100, 'Show older did not add older lines');
    expect(await tab.eval(`(() => { const items = [...document.querySelectorAll('[data-agent-log] li .agent-log-what')].map((e) => e.textContent); return items.filter((w) => w === 'Read ${SCHEDULE_NAME} data in ${SPACE_NAME}').length; })()`) >= 20, 'the older page is not the older lines');
    for (let i = 0; i < 5 && !(await hiddenOf(tab, '[data-agent="older"]')); i++) { await press(tab, '[data-agent="older"]'); await sleep(800); }
    expect(await hiddenOf(tab, '[data-agent="older"]'), 'Show older stays after the last page');
    {
      const whats = await tab.eval(`[...document.querySelectorAll('[data-agent-log] li .agent-log-what')].map((e) => e.textContent)`);
      const at = whats.indexOf('Connected through MCP (4 messages)');
      expect(at >= 1 && whats.filter((w) => /^Connected through MCP/.test(w)).length === 1, `four /mcp lines are not one line "Connected through MCP (4 messages)" (${whats.filter((w) => /MCP/.test(w)).join(' | ')})`);
      expect(/^Searched /.test(whats[at - 1]), `the tool call after the /mcp lines is "${whats[at - 1]}", not its own line`);
    }

    // Post in Chat is gone (plan-agent-matrix.md): Send chat messages is a row of the Roles grid's Agent column, and the page says so.
    {
      expect(!(await tab.eval(`!!document.querySelector('[data-agent-chat-post]')`)), 'the Post in Chat switch is still on the agent page');
      expect((await tab.eval(`document.querySelector('#agent-page').textContent`)).includes('What agents may do is set on Roles.'), 'the agent page does not say what agents may do is set on Roles');
    }
    // The Roles grid (plan-agent-matrix.md, step 2): its columns are the server's, the Agent column only when it names one, a
    // cell an agent can never have shows no box, the Agents row has a box only under Agent, the sentence under the grid, a tick
    // saves as it is clicked, the links to Roles resolve, and it works at 390 and 1280.
    {
      const grid = (t) => t.eval(`(() => {
        const heads = [...document.querySelectorAll('#roles-table thead th')].slice(1).map((h) => h.textContent.trim());
        const rows = [...document.querySelectorAll('#roles-table tbody tr:not(.sdk-table-group)')].map((tr) => ({ cells: tr.children.length, perm: (tr.querySelector('input') || {}).dataset ? tr.querySelector('input').dataset.perm : null, label: tr.children[0].textContent, boxes: [...tr.querySelectorAll('td')].map((td) => !!td.querySelector('input')) }));
        const groups = [...document.querySelectorAll('#roles-table .sdk-table-group')].map((g) => g.textContent.trim());
        const s = document.getElementById('roles-agent-never');
        return { heads, rows, groups, sentence: s.textContent, sentenceShown: !s.hidden && s.getClientRects().length > 0 };
      })()`);
      // Without the Agent column: four columns, no Agents group, no sentence.
      {
        const t = await open(1280, 'dark', 'admin', plain);
        await go(t, '/admin#roles');
        await t.waitFor('#roles-table tbody tr');
        const g = await grid(t);
        expect(g.heads.length === 4 && !g.heads.includes('Agent'), `AGENT_TOKENS off: the columns are ${g.heads.join(', ')}`);
        expect(!g.groups.includes('Agents') && !g.sentenceShown, 'AGENT_TOKENS off: the grid shows the Agents group or the agent sentence');
        expect(t.problems.length === 0, `roles grid, agents off: ${t.problems.join('; ')}`);
        await t.close();
      }
      const roles = (await call('admin', 'GET', '/api/roles')).json;
      expect(roles.columns.join() === 'owner,moderator,member,guest,agent', `the server's columns are ${roles.columns}`);
      const neverAgent = new Set(roles.never.agent);
      const SENTENCE = "An agent never deletes or erases anything, changes roles, makes tokens or other agents, changes this environment's settings or billing, uses the host console, works outside its own spaces, or becomes a moderator, owner or admin.";
      for (const [width, mode] of [[1280, 'dark'], [390, 'dark']]) {
        const t = await open(width, mode, 'admin');
        await go(t, '/admin#roles');
        await t.waitFor('#roles-table tbody tr');
        const g = await grid(t);
        expect(g.heads.join() === 'Owner,Moderator,Member,Guest,Agent', `at ${width}: the columns are ${g.heads.join(', ')}`);
        expect(g.rows.length > 5 && g.rows.every((r) => r.cells === 6 && r.boxes.length === 5), `at ${width}: a row is not six cells wide (the cells are not aligned)`);
        // A never cell has no box, and every other cell of the Agent column has one.
        const bad = g.rows.filter((r) => r.perm !== null || r.boxes.some(Boolean)).filter((r) => {
          const key = r.perm; const agentBox = r.boxes[4];
          return key && (neverAgent.has(key) ? agentBox : !agentBox);
        });
        expect(bad.length === 0, `at ${width}: the Agent column's boxes are not the server's never list (${bad.map((r) => r.label).join(', ')})`);
        const neverRows = roles.permissions.filter((p) => neverAgent.has(p.key) && !p.agentOnly);
        expect(neverRows.length > 3, 'the server lists too few never rows for the Agent column');
        const drawn = await t.eval(`(() => { const out = {}; for (const b of document.querySelectorAll('#roles-table input[data-role="agent"]')) out[b.dataset.perm] = true; return out; })()`);
        expect(!Object.keys(drawn).some((k) => neverAgent.has(k)), `at ${width}: a box is drawn on a never cell`);
        expect(await t.eval(`[...document.querySelectorAll('#roles-table td:last-child')].every((td) => !td.querySelector('.is-disabled, [disabled], .sdk-table-dim') && (td.textContent.trim() === ''))`), `at ${width}: a never cell holds a dash, a label or a greyed box`);
        // The Agents group: its row has a box under Agent only.
        const agentRows = roles.permissions.filter((p) => p.agentOnly);
        expect(g.groups.includes('Agents') && agentRows.length >= 1, `at ${width}: the Agents group is not drawn`);
        for (const p of agentRows) {
          const row = g.rows.find((r) => r.perm === p.key);
          expect(row && row.boxes.join() === 'false,false,false,false,true', `at ${width}: the "${p.label}" row's boxes are ${row && row.boxes} (only the Agent column has one)`);
        }
        expect(g.sentenceShown && g.sentence.trim() === SENTENCE, `at ${width}: the sentence under the grid reads "${g.sentence.trim()}"`);
        expect(await t.eval(`(() => { const s = document.getElementById('roles-agent-never'); const w = document.querySelector('.sdk-table-wrap'); return !!(w.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) && s.closest('#tab-roles') !== null; })()`), `at ${width}: the sentence is not under the grid`);
        expect(!/\b(items?|rooms?|tables?|stages?|panes?|tenants?)\b/i.test(g.sentence), `at ${width}: the sentence uses an old word`);
        expect(await wide(t) <= 0, `at ${width}: the Roles page scrolls sideways`);
        if (width === 390) expect(await t.eval(`(() => { const w = document.querySelector('#tab-roles .sdk-table-wrap'); return w.scrollWidth >= w.clientWidth && w.clientWidth <= window.innerWidth; })()`), 'at 390: the grid does not stay inside its own box');
        await shot(t, `roles-agent-${width}-${mode}`);
        if (width === 1280) {
          // A tick saves as it is clicked, and is kept after a reload.
          const before = (await call('admin', 'GET', '/api/roles')).json.roles.agent['chat'] === true;
          await press(t, '#roles-table input[data-role="agent"][data-perm="chat"]');
          await sleep(500);
          const after = (await call('admin', 'GET', '/api/roles')).json.roles.agent['chat'] === true;
          expect(before !== after, 'a tick in the Agent column did not save on the server');
          await go(t, '/admin#roles');
          await t.waitFor('#roles-table tbody tr');
          expect(await t.eval(`document.querySelector('#roles-table input[data-role="agent"][data-perm="chat"]').checked`) === after, 'the Agent column tick is not kept after a reload');
          if (before === after) say('note: chat tick unchanged');
          await call('admin', 'PATCH', '/api/roles/agent', { chat: before }); // back to how it was
        }
        expect(t.problems.length === 0, `roles grid at ${width}: ${t.problems.join('; ')}`);
        await t.close();
      }
      // The links to Roles: the admin Chat panel's, from the agent's page, goes to the Roles tab; the connect guide's resolves.
      {
        const t = await open(1280, 'dark', 'admin');
        await go(t, `/admin#agent/${agent.key}`);
        await t.waitFor('#agent-page:not([hidden])');
        const href = await t.eval(`(document.querySelector('#agent-page [data-agent-roles-link]') || {}).getAttribute ? document.querySelector('#agent-page [data-agent-roles-link]').getAttribute('href') : null`);
        expect(href === '#roles' && (await text(t, '#agent-page')).includes('What agents may do is set on Roles.'), `the Chat panel's Roles link is ${href}`);
        await press(t, '#agent-page [data-agent-roles-link]');
        await t.waitFor('#tab-roles:not([hidden])').catch(() => {});
        expect(await t.eval(`location.hash`) === '#roles' && !(await hiddenOf(t, '#tab-roles')) && await hiddenOf(t, '#agent-page'), 'the Chat panel link does not open Manage > Roles');
        await go(t, `/admin#agent/${agent.key}`);
        await t.waitFor('[data-agent-connect] a');
        const guideLink = await t.eval(`(() => { const a = [...document.querySelectorAll('#agent-page [data-agent-connect] a')].find((x) => x.textContent === 'Roles'); return a ? { href: a.getAttribute('href'), target: a.target, rel: a.rel } : null; })()`);
        expect(guideLink && guideLink.href === '/admin#roles' && guideLink.target === '_blank' && /noopener/.test(guideLink.rel), `the guide's Roles link is ${JSON.stringify(guideLink)}`);
        const page = await fetch(server.base + '/admin', { headers: { cookie: jars[`${server.base}|admin`].map((c) => `${c.name}=${c.value}`).join('; ') } });
        expect(page.status === 200 && (await page.text()).includes('data-tab="roles"'), 'the address /admin#roles has no Roles tab to open');
        expect(t.problems.length === 0, `Roles links: ${t.problems.join('; ')}`);
        await t.close();
      }
    }
    // Revoke.
    await press(tab, '[data-agent="revoke"]');
    expect(await waitDialog(tab, true), 'Revoke asked nothing');
    await tab.click('dialog [data-ok]');
    expect(await waitDialog(tab, false), 'the Revoke question did not close');
    expect(await waitText(tab, '[data-agent-token-state]', 'No token yet.'), 'after Revoke the page still shows a token');
    expect((await call('x', 'GET', '/api/agent/me', undefined, server, token)).status === 401, 'a revoked token still works');
    expect((await call('admin', 'GET', `/api/users/${agent.key}/token`)).json.token === null, 'the server still holds the revoked token');

    // Turn off and on: a token can't be made while it is off.
    await press(tab, '[data-agent="off"]');
    expect(await waitText(tab, '[data-agent="off"]', 'Turn on'), 'Turn off did not change the button to Turn on');
    expect(await text(tab, '[data-agent-state]') === 'Off', 'the state is not Off');
    expect((await call('admin', 'GET', `/api/users/${agent.key}`)).json.user.off === true, 'Turn off did not turn the agent off on the server');
    await press(tab, '[data-agent="make"]');
    expect(await waitText(tab, '[data-agent-status]', 'This agent is turned off. Turn it on first.'), `Make token while off said "${await text(tab, '[data-agent-status]')}"`);
    expect(!(await dialogOpen(tab)), 'a dialog opened while the agent is off');
    await press(tab, '[data-agent="back"]');
    await tab.waitFor('#users-main:not([hidden])');
    expect(!(await hiddenOf(tab, `#users .user-card[data-key="${agent.key}"] [data-off]`)), 'the row does not say the agent is off');
    await tab.click(`#users .user-card[data-key="${agent.key}"] [data-action="edit"]`);
    await tab.waitFor('#agent-page:not([hidden])');
    await press(tab, '[data-agent="off"]');
    expect(await waitText(tab, '[data-agent="off"]', 'Turn off') && await text(tab, '[data-agent-state]') === 'On', 'Turn on did not turn it on');
    expect((await call('admin', 'GET', `/api/users/${agent.key}`)).json.user.off === false, 'Turn on did not turn the agent on on the server');

    // Set up, Members (before the delete): "(agent)", no moderator tick, adds like a member.
    {
      const t = await open(1280, 'dark', 'admin');
      await go(t, `/?setup=${encodeURIComponent(space.id)}#members`);
      await t.waitFor(`[data-member="${agent.key}"]`);
      const m = await t.eval(`(() => { const sw = document.querySelector('[data-member="${agent.key}"]'); const row = sw.closest('label'); return { label: row.querySelector('.sdk-choice-label').textContent, on: sw.checked, moderator: /moderator/i.test(document.querySelector('#setup-members').textContent), ticks: document.querySelectorAll('#setup-members input:not([data-member])').length }; })()`);
      expect(m.label === 'Claude (agent)', `the member row reads "${m.label}"`);
      expect(m.on && !m.moderator && m.ticks === 0, 'the agent row has a moderator tick, or is not on as the server has it');
      await t.click(`[data-member="${agent.key}"]`);
      await t.click('#setup-save');
      await sleep(1200);
      const members = (await call('admin', 'GET', `/api/spaces/${space.id}`)).json.space.members || [];
      expect(!members.includes(agent.key), 'switching the agent off in Set up and saving did not take it out of the space');
      await shot(t, 'setup-members-1280-dark', false);
      expect(t.problems.length === 0, `Set up: ${t.problems.join('; ')}`);
      await t.close();
    }

    // Modules > Configuration > Recent activity: a line names its asker from the fields, as text (the list is stubbed, so the
    // lines are exact: the server's own are read by check-agent-asker).
    {
      const lines = [
        { at: '2026-10-15T08:55:00.000Z', moduleName: 'Planner', what: 'saved a milestone', askerName: 'Claude (agent)', askerAgent: true, carrierName: 'Mia', byName: "Claude (agent), carried out by Mia's page" },
        { at: '2026-10-15T08:50:00.000Z', moduleName: 'Planner', what: 'saved a note', askerName: HOSTILE, askerAgent: true, carrierName: HOSTILE, byName: 'x' },
        { at: '2026-10-15T08:45:00.000Z', moduleName: 'Planner', what: 'saved work', askerName: '<b>Zed</b>', askerAgent: false, byName: '<b>Zed</b>' },
        { at: '2026-10-15T08:40:00.000Z', moduleName: 'Planner', what: 'saved an old line', byName: 'Old Name' },
        { at: '2026-10-15T08:35:00.000Z', moduleName: 'Planner', what: 'saved a person line named like an agent', askerName: 'Claude (agent)', askerAgent: false },
      ];
      for (const size of [1280, 390]) {
        const t = await open(size, 'dark', 'admin');
        await t.cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/modules/activity' }] }, t.sid);
        t.cdp.listeners.push((m) => {
          if (m.method !== 'Fetch.requestPaused' || m.sessionId !== t.sid) return;
          t.cdp.send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify({ activity: lines })).toString('base64') }, t.sid).catch(() => {});
        });
        await go(t, '/admin#modules');
        await t.waitFor('#module-activity li');
        const rows = await t.eval(`[...document.querySelectorAll('#module-activity li .activity-event')].map((e) => ({ text: e.textContent, marks: e.querySelectorAll('.activity-agent').length, markup: e.querySelectorAll('img, b, script').length }))`);
        expect(rows.length === 5, `${size}: the activity list has ${rows.length} rows, not 5`);
        expect(rows[0] && /^saved a milestone by Claude agent, carried out by Mia's page$/.test(rows[0].text) && rows[0].marks === 1, `${size}: an agent line with a carrier reads "${rows[0] && rows[0].text}" with ${rows[0] && rows[0].marks} marks`);
        expect(rows[1] && rows[1].text.includes(`by ${HOSTILE} agent, carried out by ${HOSTILE}'s page`) && rows[1].markup === 0, `${size}: a script-looking asker or carrier is not drawn as text`);
        expect(rows[2] && rows[2].text === 'saved work by <b>Zed</b>' && rows[2].marks === 0 && rows[2].markup === 0, `${size}: a plain person line reads "${rows[2] && rows[2].text}"`);
        expect(rows[3] && rows[3].text === 'saved an old line by Old Name' && rows[3].marks === 0, `${size}: a line with only byName reads "${rows[3] && rows[3].text}"`);
        expect(rows[4] && rows[4].marks === 0, `${size}: the agent mark is drawn without askerAgent`);
        expect(!(await pwn(t)) && await wide(t) <= 1, `${size}: the activity list ran a script or scrolls sideways`);
        await t.eval(`(() => { const b = document.getElementById('activity-box'); b.scrollIntoView({ block: 'center' }); })()`);
        await shot(t, `activity-${size}-dark`, false);
        await t.switchMode('light'); await t.settle();
        await shot(t, `activity-${size}-light`, false);
        await t.close();
      }
    }

    // A member: no Manage page, no agent controls, the server refuses.
    {
      const t = await open(1280, 'dark', 'mia');
      await go(t, '/admin#users');
      await sleep(1500);
      expect(await t.eval(`document.getElementById('agents-section') === null || document.getElementById('agents-section').getClientRects().length === 0`) && /Owners only/.test(await t.eval(`document.body.innerText`)), 'a member is shown the Manage page, or its agent controls');
      await t.close();
      expect((await call('mia', 'GET', `/api/users/${agent.key}/token`)).status === 403, 'a member could read the agent\'s token record');
      expect((await call('mia', 'POST', `/api/users/${agent.key}/token`)).status === 403, 'a member could make a token');
      expect((await call('mia', 'GET', `/api/users/${agent.key}/agent-log`)).status === 403, 'a member could read the agent\'s log');
      expect((await call('mia', 'POST', '/api/users', { agent: true })).status === 403, 'a member could add an agent');
      expect((await call('mia', 'PATCH', '/api/settings', { agents: false })).status === 403, 'a member could turn Agents off');
    }

    // 390 wide: the agent's page and the token dialog.
    {
      const t = await open(390, 'dark', 'admin');
      await go(t, `/admin#agent/${agent.key}`);
      await t.waitFor('[data-agent="make"]');
      await sleep(400);
      expect(await wide(t) <= 1, '390: the agent page scrolls sideways');
      for (const sel of ['[data-agent="make"]', '[data-agent="off"]', '[data-agent="delete"]', '[data-agent="rename"]']) expect(await hit(t, sel) >= 43.5, `390: ${sel} is ${await hit(t, sel)} px tall (44 is the least)`);
      await shot(t, 'agent-page-390-dark');
      await t.switchMode('light'); await t.settle();
      await shot(t, 'agent-page-390-light');
      await t.switchMode('dark'); await t.settle();
      await press(t, '[data-agent="make"]');
      expect(await waitDialog(t, true), '390: Make token showed no dialog');
      expect(await wide(t) <= 1, '390: the token dialog makes the page scroll sideways');
      const tokenWide = await t.eval(`(() => { const d = document.querySelector('dialog.agent-token-dialog'); const r = d.getBoundingClientRect(); const k = d.querySelector('.agent-token-value').getBoundingClientRect(); return { left: r.left, right: r.right, kLeft: k.left, kRight: k.right, width: window.innerWidth }; })()`);
      expect(tokenWide.left >= 0 && tokenWide.right <= tokenWide.width && tokenWide.kLeft >= tokenWide.left && tokenWide.kRight <= tokenWide.right + 1, `390: the token box is outside the dialog or the window (${JSON.stringify(tokenWide)})`);
      for (const sel of ['dialog [data-agent="copy"]', 'dialog [data-agent="token-done"]']) expect(await hit(t, sel) >= 43.5, `390: ${sel} is ${await hit(t, sel)} px tall (44 is the least)`);
      const tok390 = await t.eval(`document.querySelector('.agent-token-value').textContent`);
      await envChoice(t, 'dialog.agent-token-dialog', tok390, await t.eval('location.origin'), '390 token window');
      await shot(t, 'token-dialog-390-dark', false);
      await t.switchMode('light'); await t.settle();
      await shot(t, 'token-dialog-390-light', false);
      await t.switchMode('dark'); await t.settle();
      await t.key('Escape');
      expect(await waitDialog(t, false), '390: Escape did not close the token dialog');
      await go(t, '/admin#users');
      await t.waitFor(`#users .user-card[data-key="${agent.key}"]`);
      expect(await wide(t) <= 1, '390: the Users tab scrolls sideways');
      expect(await hit(t, `#users .user-card[data-key="${agent.key}"] [data-action="edit"]`) >= 43.5, '390: the agent row\'s Open is under 44 px tall');
      expect(await hit(t, '#add-agent-toggle') >= 43.5, '390: Add an agent is under 44 px tall');
      await shot(t, 'users-390-dark');
      expect(t.problems.length === 0, `390: ${t.problems.join('; ')}`);
      await t.close();
    }

    // Delete: a typed confirm, then the list without it.
    await go(tab, `/admin#agent/${agent.key}`);
    await tab.waitFor('[data-agent="delete"]');
    await press(tab, '[data-agent="delete"]');
    expect(await waitDialog(tab, true), 'Delete asked nothing');
    expect(await tab.eval(`document.querySelector('dialog [data-ok]').disabled`), 'Delete is on before the name is typed');
    await tab.typeInto('dialog input', 'Claude');
    await tab.click('dialog [data-ok]');
    expect(await waitDialog(tab, false), 'the Delete question did not close');
    await tab.waitFor('#users-main:not([hidden])');
    expect(await tab.eval(`location.hash`) === '#users', `after Delete the address is ${await tab.eval('location.hash')}`);
    expect(await tab.eval(`!document.querySelector('#users .user-card[data-key="${agent.key}"]')`), 'the deleted agent is still in the list');
    expect((await call('admin', 'GET', `/api/users/${agent.key}`)).status === 404, 'Delete did not delete the agent on the server');
    expect(tab.problems.length === 0, `Manage: ${tab.problems.join('; ')}`);
    await tab.close();

    // Set-up agents (plan-admin-agent.md, step 1): the switch only with the server's AGENT_SETUP, the kind to choose only while
    // it is on here, the account shown as "(set-up agent)", and the Roles grid's Set-up agent column (plan-agent-matrix.md,
    // decision 3): headed in plain words, its two rows boxed only there, every other cell of it boxless.
    {
      const t0 = await open(1280, 'dark', 'admin');
      await go(t0, '/admin#users');
      await t0.waitFor('#agents-on-server:not([hidden])');
      expect(await hiddenOf(t0, '#setup-agents-on-server'), 'without AGENT_SETUP the Set-up agents switch shows');
      expect(t0.problems.length === 0, `users, no AGENT_SETUP: ${t0.problems.join('; ')}`);
      await t0.close();
      const dir = tmp(); const port = await freePort();
      setup = await startServer(dir, port, 'first', { AGENT_TOKENS: 'true', AGENT_SETUP: 'true' });
      await signIn('admin', setup);
      expect((await call('admin', 'PATCH', '/api/settings', { agents: true }, setup)).status === 200, 'could not turn Agents on for the set-up block');
      const t = await open(1280, 'dark', 'admin', setup);
      await go(t, '/admin#users');
      await t.waitFor('#setup-agents-on-server:not([hidden])');
      expect(!(await t.eval(`document.getElementById('set-setup-agents').checked`)), 'Set-up agents start on');
      await press(t, '#add-agent-toggle');
      expect(await hiddenOf(t, '#new-agent-kind-field'), 'the kind shows while Set-up agents are off');
      await press(t, '#set-setup-agents');
      await sleep(600);
      expect((await call('admin', 'GET', '/api/settings', undefined, setup)).json.settings.setupAgents === true, 'the switch did not save');
      expect(!(await hiddenOf(t, '#new-agent-kind-field')), 'the kind does not show once Set-up agents are on');
      const kinds = await t.eval(`[...document.querySelectorAll('#new-agent-kind option')].map((o) => o.textContent)`);
      expect(kinds.join() === 'Works in spaces,Sets up spaces', `the kinds read ${kinds}`);
      await t.eval(`document.getElementById('new-agent-kind').value = 'setup'`);
      await press(t, '#add-agent button[type="submit"]');
      await t.waitFor('#agent-page:not([hidden])');
      const made = (await call('admin', 'GET', '/api/users', undefined, setup)).json.users.find((u) => u.agent);
      expect(made && made.kind === 'setup', `the page made ${made && made.kind}`);
      expect(await waitText(t, '[data-agent-title]', 'Claude (set-up agent)'), `its page is titled ${await text(t, '[data-agent-title]')}`);
      await go(t, '/admin#users');
      await t.waitFor('#users .user-card');
      expect((await text(t, `#users .user-card[data-key="${made.key}"] [data-name]`)) === 'Claude (set-up agent)', 'its row does not read Claude (set-up agent)');
      const roles = (await call('admin', 'GET', '/api/roles', undefined, setup)).json;
      expect(roles.columns.join() === 'owner,moderator,member,guest,agent,setup', `the server's columns are ${roles.columns}`);
      await go(t, '/admin#roles');
      await t.waitFor('#roles-table tbody tr');
      const g = await t.eval(`(() => ({
        heads: [...document.querySelectorAll('#roles-table thead th')].slice(1).map((h) => h.textContent.trim()),
        rows: [...document.querySelectorAll('#roles-table tbody tr:not(.sdk-table-group)')].map((tr) => ({ key: (tr.querySelector('input') || { dataset: {} }).dataset.perm || null, cells: tr.children.length, boxes: [...tr.querySelectorAll('td')].map((td) => !!td.querySelector('input')) })),
      }))()`);
      expect(g.heads.join() === 'Owner,Moderator,Member,Guest,Agent,Set-up agent', `the columns are ${g.heads.join(', ')}`);
      expect(g.rows.every((r) => r.cells === 7), 'a row is not seven cells wide');
      for (const key of ['agentMakeSpaces', 'agentChangeSpaces', 'agentAskPeople']) {
        const row = g.rows.find((r) => r.key === key);
        expect(row && row.boxes.join() === 'false,false,false,false,false,true', `the ${key} row's boxes are ${row && row.boxes}`);
      }
      const members = g.rows.find((r) => r.key === 'agentMembers');
      expect(members && members.boxes.join() === 'false,false,false,false,true,false', `the agentMembers row's boxes are ${members && members.boxes}`);
      expect(g.rows.filter((r) => r.key && !['agentMakeSpaces', 'agentChangeSpaces', 'agentAskPeople'].includes(r.key)).every((r) => !r.boxes[5]), 'a box under Set-up agent on a row it can never have');
      await press(t, '#roles-table input[data-role="setup"][data-perm="agentMakeSpaces"]');
      await sleep(500);
      expect((await call('admin', 'GET', '/api/roles', undefined, setup)).json.roles.setup.agentMakeSpaces === true, 'a tick in the Set-up agent column did not save');
      await shot(t, 'roles-setup-agent-1280-dark');
      expect(t.problems.length === 0, `set-up agents: ${t.problems.join('; ')}`);
      await t.close();
    }

    // How long a token lasts, (the page counts days by its own clock, frozen by tools/shots.mjs): the default,
    // Never expires (no date, never "NaN"), the warning inside 7 days, and the line once it has ended (stored tokens, the server restarted).
    {
      const dir = tmp(); const port = await freePort();
      const env = { AGENT_TOKENS: 'true' };
      const NOW = Date.parse(`${TODAY}T12:00:00.000Z`); // the page's clock, frozen (tools/shots.mjs)
      exp = await startServer(dir, port, 'first', env);
      await signIn('admin', exp);
      expect((await call('admin', 'PATCH', '/api/settings', { agents: true }, exp)).status === 200, 'could not turn Agents on for the lifetime block');
      const ag = (await call('admin', 'POST', '/api/users', { agent: true }, exp)).json.user;
      const page = `/admin#agent/${ag.key}`;
      const stored = () => call('admin', 'GET', `/api/users/${ag.key}/token`, undefined, exp);
      const DATE = '[A-Z][a-z]{2} \\d{1,2}, \\d{4}';
      const state = async (t) => ({ line: await text(t, '[data-agent-token-state]'), warn: await text(t, '[data-agent-ending]'), warnHidden: await hiddenOf(t, '[data-agent-ending]'), used: await text(t, '[data-agent-used]'), make: await text(t, '[data-agent="make"]') });
      let t = await open(1280, 'dark', 'admin', exp);
      await go(t, page);
      await t.waitFor('[data-agent="make"]');
      // Never expires.
      await t.eval(`(() => { const s = document.querySelector('[data-agent-lifetime]'); s.value = 'never'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await shot(t, 'agent-page-make-token-never-1280-dark');
      await press(t, '[data-agent="make"]');
      expect(await waitDialog(t, true), 'Make token (never) showed no dialog');
      expect(await t.eval(`[...document.querySelectorAll('dialog.agent-token-dialog p.hint')].some((e) => e.textContent === 'Never expires. Keep it as a secret, never in a chat.')`), 'the token window does not say "Never expires."');
      expect(!(await t.eval(`document.querySelector('dialog.agent-token-dialog').textContent.includes('NaN') || document.querySelector('dialog.agent-token-dialog').textContent.includes('Invalid')`)), 'a never-expires window shows NaN or an invalid date');
      const never = (await stored()).json.token;
      expect(never.lifetime === 'never' && never.expiresAt === null, `the page did not send expires: never (stored ${JSON.stringify(never)})`);
      await press(t, '[data-agent="token-done"]');
      expect(await waitDialog(t, false), 'Done did not close the window (never)');
      let st = await state(t);
      expect(st.line === 'Never expires.' && st.warnHidden && st.used === 'Not used yet.' && st.make === 'Make a new token', `a never-expiring token reads ${JSON.stringify(st)}`);
      // The default: 30 days.
      await press(t, '[data-agent="make"]');
      expect(await waitDialog(t, true), 'Make token (default) showed no dialog');
      const secret = await t.eval(`document.querySelector('dialog.agent-token-dialog .agent-token-value').textContent`);
      const hintRe = `^Works for 30 days, until ${DATE}\\. Keep`;
      expect(await t.eval(`[...document.querySelectorAll('dialog.agent-token-dialog p.hint')].some((e) => new RegExp(${JSON.stringify(hintRe)}).test(e.textContent))`), 'the default token window does not say "Works for 30 days, until <date>."');
      expect((await stored()).json.token.lifetime === '30d', 'the default was not 30 days');
      await press(t, '[data-agent="token-done"]');
      expect(await waitDialog(t, false), 'Done did not close the window (30 days)');
      expect(!(await t.eval(`document.documentElement.outerHTML.includes(${JSON.stringify(secret)}) || document.body.innerText.includes(${JSON.stringify(secret)})`)), 'the 30-day token is on the page after Done');
      st = await state(t);
      expect(new RegExp(`^Works for 30 days, until ${DATE}\\.$`).test(st.line) && st.warnHidden && !/NaN|Invalid/.test(st.line), `a 30-day token reads ${JSON.stringify(st)}`);
      await t.close();
      // Stored tokens with an end in 3 days, then one that has passed.
      const restartWith = async (createdAt, expiresAt) => {
        await stopServer(exp);
        const file = path.join(dir, 'tokens.json');
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        data.tokens = data.tokens.map((x) => ({ ...x, lifetime: '30d', createdAt, expiresAt }));
        fs.writeFileSync(file, JSON.stringify(data));
        exp = await startServer(dir, port, 'second', env);
        await signIn('admin', exp);
      };
      const DAY = 86400000;
      await restartWith(new Date(NOW - 27 * DAY).toISOString(), new Date(NOW + 3 * DAY - 3600000).toISOString());
      t = await open(1280, 'dark', 'admin', exp);
      await go(t, page);
      await t.waitFor('[data-agent="make"]');
      st = await state(t);
      expect(st.warn === 'This token ends in 3 days. Make a new token before then, and update Claude with it.' && !st.warnHidden && st.make === 'Make a new token', `a token ending in 3 days reads ${JSON.stringify(st)}`);
      expect(new RegExp(`^Works for 30 days, until ${DATE}\\.$`).test(st.line), `the near-end line reads "${st.line}"`);
      expect(await t.eval(`(() => { const w = document.querySelector('[data-agent-ending]'); const b = document.querySelector('[data-agent="make"]'); return w.closest('.panel') === b.closest('.panel') && !!(w.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); })()`), 'the warning is not in the Token section above the Make a new token button');
      await shot(t, 'agent-page-token-ends-soon-1280-dark');
      await t.close();
      await restartWith(new Date(NOW - 30 * DAY).toISOString(), new Date(NOW - 3600000).toISOString());
      t = await open(1280, 'dark', 'admin', exp);
      await go(t, page);
      await t.waitFor('[data-agent="make"]');
      st = await state(t);
      expect(st.warn === 'This token has ended. Make a new token.' && !st.warnHidden && st.make === 'Make a new token' && /^The token ended /.test(st.line), `an ended token reads ${JSON.stringify(st)}`);
      await shot(t, 'agent-page-token-ended-1280-dark');
      expect(t.problems.length === 0, `lifetime block: ${t.problems.join('; ')}`);
      await t.close();
    }
    // The set-up agent's page (plan-admin-agent.md, step 4): Waiting for you (Approve, Decline, a 409's sentence), Undo on each change
    // (disabled with its reason; a made space asks first), What it did, the connect guide, what it has left today, and the mark
    // "Made by Claude (set-up agent)" with Keep on Manage's spaces list and on Home. Run on the throwaway server with AGENT_SETUP.
    {
      const MARK = 'Made by Claude (set-up agent)';
      const adm = async (method, url, body) => call('admin', method, url, body, setup);
      expect((await adm('PATCH', '/api/roles/setup', { agentMakeSpaces: true, agentChangeSpaces: true, agentAskPeople: true })).status === 200, 'could not tick the set-up agent rows');
      expect((await adm('POST', '/api/users', { login: 'olga', displayName: 'Olga', role: 'owner', password: PASSWORD })).status === 201, 'could not make the owner (set-up block)');
      expect((await adm('POST', '/api/users', { login: 'mia', displayName: 'Mia', role: 'member', password: PASSWORD })).status === 201, 'could not make the member (set-up block)');
      await signIn('olga', setup); await signIn('mia', setup);
      const users = (await adm('GET', '/api/users')).json.users;
      const mia = users.find((u) => u.login === 'mia');
      const agent = users.find((u) => u.agent && u.kind === 'setup');
      expect((await adm('PATCH', `/api/users/${agent.key}`, { displayName: 'Builder' })).status === 200, 'could not name the set-up agent');
      const other = (await adm('POST', '/api/users', { agent: true, kind: 'setup', displayName: 'Other' })).json.user;
      const token = (await adm('POST', `/api/users/${agent.key}/token`)).json.token;
      const bot = (method, url, body) => call('__none', method, url, body, setup, token);
      const template = (await bot('GET', '/api/agent/templates')).json.templates[0].id;
      const icons = (await bot('GET', '/api/agent/icons')).json.icons;
      const make = async (name) => { const r = await bot('POST', '/api/agent/spaces', { name, template }); expect(r.status === 200, `the agent could not make ${name}: ${r.status}`); return r.json.space; };
      const lisbon = await make('Lisbon');
      const porto = await make(`Porto ${HOSTILE}`);
      const quiet = await make('Quiet');
      expect((await bot('PATCH', `/api/agent/spaces/${lisbon.id}`, { name: 'Lisbon 2027' })).status === 200, 'the agent could not rename');
      expect((await bot('PATCH', `/api/agent/spaces/${quiet.id}`, { icon: icons[1] })).status === 200, 'the agent could not change an icon');
      const askAdd = await bot('POST', `/api/agent/spaces/${lisbon.id}/asks`, { ask: 'add', person: mia.key });
      expect(askAdd.status === 202, `the ask was ${askAdd.status}`);
      const asksUrl = `/api/users/${agent.key}/asks`;
      const page = `/admin#agent/${agent.key}`;
      const listed = async () => (await adm('GET', asksUrl)).json.asks;
      const t = await open(1280, 'dark', 'admin', setup);
      await go(t, page);
      await t.waitFor('[data-agent-ask]');
      expect(await waitText(t, '[data-agent-title]', 'Builder (set-up agent)'), `the page is titled ${await text(t, '[data-agent-title]')}`);
      const view = await t.eval(`(() => {
        const vis = (sel) => { const e = document.querySelector(sel); return !!e && !e.hidden && e.getClientRects().length > 0; };
        const panel = (title) => [...document.querySelectorAll('#agent-page .panel')].find((p) => (p.querySelector('h2') || {}).textContent === title);
        const shown = (title) => { const p = panel(title); return !!p && !p.hidden && p.getClientRects().length > 0; };
        return {
          waiting: shown('Waiting for you'), undo: shown('Changes you can undo'), can: shown('What it can do'), chat: shown('Chat'),
          asks: [...document.querySelectorAll('[data-agent-ask]')].map((li) => ({ text: li.querySelector('.agent-ask-what > span').textContent, buttons: [...li.querySelectorAll('button')].map((b) => b.textContent) })),
          changes: [...document.querySelectorAll('[data-agent-change]')].map((li) => ({ text: li.querySelector('.agent-change-text').textContent, undo: !!li.querySelector('[data-agent-undo]') && !li.querySelector('[data-agent-undo]').disabled })),
          limits: [...document.querySelectorAll('[data-agent-limits] li')].map((l) => l.textContent),
          log: [...document.querySelectorAll('[data-agent-log] .agent-log-what')].map((l) => l.textContent),
          connect: document.querySelector('[data-agent-connect]').textContent,
          steps: document.querySelectorAll('[data-agent-connect] .agent-steps')[0].children.length,
        };
      })()`);
      expect(view.waiting && view.undo && view.can && !view.chat, `the set-up agent's panels are ${JSON.stringify({ w: view.waiting, u: view.undo, c: view.can, chat: view.chat })}`);
      expect(view.asks.length === 1 && view.asks[0].buttons.join() === 'Approve,Decline', `waiting reads ${JSON.stringify(view.asks)}`);
      expect(view.asks[0].text === (await listed())[0].text && /asks to add Mia to Lisbon 2027\./.test(view.asks[0].text), `the ask reads "${view.asks[0].text}"`);
      expect(view.changes.length === 5 && view.changes.every((c) => c.undo), `the changes are ${JSON.stringify(view.changes)}`);
      expect(view.changes.some((c) => c.text === 'Renamed the space Lisbon 2027') && view.changes.some((c) => c.text === 'Changed the icon of the space Quiet') && view.changes.some((c) => c.text === 'Made the space Quiet'), `the changes read ${JSON.stringify(view.changes.map((c) => c.text))}`);
      expect(view.limits.join('|') === 'Spaces it can still make today: 2 of 5|Changes it can still make today: 28 of 30|Waiting for you: 1', `the limits read ${view.limits.join('|')}`);
      expect(view.log.includes('Asked to add a person to the space Lisbon 2027') && view.log.includes('Renamed the space Lisbon 2027') && view.log.includes('Made the space Quiet'), `What it did reads ${JSON.stringify(view.log)}`);
      expect(!view.log.some((l) => /Mia/.test(l)) && !view.changes.some((c) => /Mia/.test(c.text)), 'a person is named in What it did or in the changes');
      expect(view.steps === 4 && !/Add this agent to a space/.test(view.connect) && /waits for your yes/.test(view.connect) && /can't read what is inside/.test(view.connect) && /Set-up agent column/.test(view.connect), `the connect guide reads wrong (${view.steps} steps)`);
      expect(await pwn(t) === 0 && !(await t.eval(`!!document.querySelector('#agent-page img[src="x"]')`)), 'a script-looking space name ran or became an element');
      expect(await wide(t) <= 0, `the set-up agent's page scrolls sideways at 1280 (${await wide(t)})`);
      await shot(t, 'setup-agent-page-1280-dark');
      // Another agent's bell line opens its own page.
      await signIn('olga', setup);
      const bell = (await call('olga', 'GET', '/api/notifications', undefined, setup)).json.notifications.find((x) => /asks to add Mia to Lisbon 2027/.test(x.title));
      expect(bell && bell.href === page, `the bell line opens ${bell && bell.href}`);
      await go(t, `/admin#agent/${other.key}`);
      expect(await waitText(t, '[data-agent-title]', 'Other (set-up agent)'), 'the other set-up agent\'s page did not open');
      expect((await t.eval(`document.querySelectorAll('[data-agent-ask]').length`)) === 0 && !(await hiddenOf(t, '[data-agent-asks-empty]')), 'another agent shows this one\'s asks');
      await go(t, bell.href);
      // The title is drawn at once; the asks list fills after the page's own request, so wait for the ask, not the title.
      await t.waitFor('[data-agent-ask]').catch(() => {});
      expect(await waitText(t, '[data-agent-title]', 'Builder (set-up agent)') && await t.eval(`document.querySelectorAll('[data-agent-ask]').length`) === 1, 'the bell line did not open the right agent with its ask');
      // An ordinary agent's page has none of this.
      const ord = (await adm('POST', '/api/users', { agent: true, displayName: 'Reader' })).json.user;
      await go(t, `/admin#agent/${ord.key}`);
      expect(await waitText(t, '[data-agent-title]', 'Reader (agent)') && await hiddenOf(t, '[data-agent-asks]') && await hiddenOf(t, '[data-agent-changes]') && !(await hiddenOf(t, '[data-agent-connect]')), 'the ordinary agent\'s page shows the set-up agent\'s lists');
      expect(/Add this agent to a space/.test(await text(t, '[data-agent-connect]')), 'the ordinary agent\'s guide lost its first step');
      // The set-up agent's guide has the environment-variable choice too: the placeholder on the page, the real token only in the window.
      await go(t, `/admin#agent/${other.key}`);
      await t.waitFor('[data-agent="make"]');
      await envChoice(t, '#agent-page', 'agt_YOUR_TOKEN', await t.eval('location.origin'), 'set-up page');
      await press(t, '[data-agent="make"]');
      expect(await waitDialog(t, true), 'the set-up agent\'s Make token showed no dialog');
      const otherToken = await t.eval(`document.querySelector('.agent-token-value').textContent`);
      await envChoice(t, 'dialog.agent-token-dialog', otherToken, await t.eval('location.origin'), 'set-up token window');
      await press(t, '[data-agent="token-done"]');
      expect(await waitDialog(t, false), 'Done did not close the set-up agent\'s token window');
      expect(!(await t.eval(`document.documentElement.outerHTML.includes(${JSON.stringify(otherToken)}) || document.body.innerText.includes(${JSON.stringify(otherToken)})`)), 'the set-up agent\'s token is still on the page after Done');
      await go(t, page);
      await t.waitFor('[data-agent-ask]');
      // A 409: the owner answered elsewhere; the page's Decline gets the server's sentence, and the list is drawn again.
      expect((await adm('POST', `${asksUrl}/${askAdd.json.ask.id}`, { decision: 'approve' })).status === 200, 'could not approve by the API');
      await press(t, '[data-agent-answer="decline"]');
      expect(await waitText(t, '[data-agent-asks-status]', '.'), 'a 409 said nothing');
      const sentence = (await adm('POST', `${asksUrl}/${askAdd.json.ask.id}`, { decision: 'decline' }));
      expect(sentence.status === 409 && (await text(t, '[data-agent-asks-status]')) === sentence.json.error, `the 409 reads "${await text(t, '[data-agent-asks-status]')}" and the server says "${sentence.json.error}"`);
      expect(await t.eval(`document.querySelectorAll('[data-agent-ask]').length`) === 0 && !(await hiddenOf(t, '[data-agent-asks-empty]')), 'the answered ask is still listed');
      // Approve works: a moderator tick for Mia, now a member of Lisbon.
      const mod = await bot('POST', `/api/agent/spaces/${lisbon.id}/asks`, { ask: 'moderator', person: mia.key, on: true });
      expect(mod.status === 202, `the moderator ask was ${mod.status}`);
      await go(t, page);
      await t.waitFor('[data-agent-ask]');
      expect(/moderator/i.test(await text(t, '[data-agent-ask] .agent-ask-what')), 'the moderator ask does not read as one');
      await press(t, '[data-agent-answer="approve"]');
      expect(await waitText(t, '[data-agent-asks-status]', 'Approved'), `Approve said "${await text(t, '[data-agent-asks-status]')}"`);
      expect((await listed()).find((a) => a.id === mod.json.ask.id).state === 'approved' && await t.eval(`document.querySelectorAll('[data-agent-ask]').length`) === 0, 'Approve did not end the ask');
      // Undo: a rename puts the name back, with no question; a made space asks first, and Cancel keeps it.
      const spaceStatus = async (id) => (await adm('GET', `/api/spaces/${id}`)).status;
      const nameOf = async (id) => ((await adm('GET', `/api/spaces/${id}`)).json.space || {}).name;
      const undoIdOf = (what) => t.eval(`(() => { const li = [...document.querySelectorAll('[data-agent-change]')].find((x) => x.querySelector('.agent-change-text').textContent === ${JSON.stringify(what)}); const b = li && li.querySelector('[data-agent-undo]'); return b ? b.dataset.agentUndo : ''; })()`);
      const renameId = await undoIdOf('Renamed the space Lisbon 2027');
      expect(renameId !== '', 'the rename has no Undo');
      await press(t, `[data-agent-undo="${renameId}"]`);
      expect(await waitText(t, '[data-agent-changes-status]', 'Undone'), `Undo said "${await text(t, '[data-agent-changes-status]')}"`);
      expect(await nameOf(lisbon.id) === 'Lisbon', `the name after Undo is ${await nameOf(lisbon.id)}`);
      expect(await t.eval(`(() => { const li = [...document.querySelectorAll('[data-agent-change]')].find((x) => x.textContent.includes('Renamed')); return !!li && li.classList.contains('is-undone') && !li.querySelector('[data-agent-undo]') && /Undone/.test(li.textContent); })()`), 'an undone change still offers Undo');
      const quietId = await undoIdOf('Made the space Quiet');
      await press(t, `[data-agent-undo="${quietId}"]`);
      expect(await waitDialog(t, true), 'undoing a made space asked nothing');
      const ask = await t.eval(`(() => { const d = document.querySelector('dialog[open]'); return d.textContent; })()`);
      expect(/Remove this space\?/.test(ask) && /Everything in it goes\./.test(ask), `the question reads "${ask}"`);
      await t.click('dialog[open] button', 'Cancel');
      expect(await waitDialog(t, false) && await spaceStatus(quiet.id) === 200, 'Cancel did not keep the space');
      await press(t, `[data-agent-undo="${quietId}"]`);
      expect(await waitDialog(t, true), 'the question did not come again');
      await t.click('dialog[open] button', 'Remove');
      expect(await waitDialog(t, false), 'Remove did not close the question');
      for (let i = 0; i < 40 && await spaceStatus(quiet.id) !== 404; i += 1) await sleep(100);
      expect(await spaceStatus(quiet.id) === 404, 'Remove did not erase the space');
      const quietListed = () => t.eval(`[...document.querySelectorAll('.agent-change-text')].some((x) => x.textContent.includes('Quiet'))`);
      for (let i = 0; i < 40 && await quietListed(); i += 1) await sleep(100);
      expect(!(await quietListed()), 'the erased space\'s changes are still listed');
      // The mark and Keep on Manage's list.
      await go(t, '/admin#spaces');
      await t.waitFor(`#spaces [data-space="${porto.id}"] [data-made-keep]`);
      const mark = await t.eval(`(() => ({ lisbon: (document.querySelector('#spaces [data-space="${lisbon.id}"] .made-mark') || {}).textContent, porto: (document.querySelector('#spaces [data-space="${porto.id}"] .made-mark') || {}).textContent, lobby: !!document.querySelector('#spaces .lobby .made-mark') }))()`);
      expect(mark.lisbon === MARK && mark.porto === MARK && !mark.lobby, `the marks read ${JSON.stringify(mark)}`);
      expect(await pwn(t) === 0 && !(await t.eval(`!!document.querySelector('#spaces img[src="x"]')`)), 'a script-looking space name ran on Manage\'s list');
      await shot(t, 'setup-agent-mark-manage-1280-dark');
      await press(t, `[data-made-keep="${porto.id}"]`);
      expect(await waitDialog(t, true), 'Keep asked nothing');
      expect(/^Keep "Porto/.test(await t.eval(`document.querySelector('dialog[open] .sdk-dialog-title').textContent`)) && /Claude can no longer change it/.test(await t.eval(`document.querySelector('dialog[open]').textContent`)), 'the Keep question reads wrong');
      await t.click('dialog[open] button', 'Cancel');
      expect(await waitDialog(t, false) && !(await hiddenOf(t, `#spaces [data-space="${porto.id}"] .made-mark`)), 'Cancel on Keep removed the mark');
      await press(t, `[data-made-keep="${porto.id}"]`);
      await waitDialog(t, true);
      await t.click('dialog[open] button', 'Keep');
      expect(await waitDialog(t, false), 'Keep did not close its question');
      for (let i = 0; i < 40 && !(await hiddenOf(t, `#spaces [data-space="${porto.id}"] [data-made]`)); i += 1) await sleep(100);
      expect(await hiddenOf(t, `#spaces [data-space="${porto.id}"] [data-made]`) && !(await hiddenOf(t, `#spaces [data-space="${lisbon.id}"] [data-made]`)), 'Keep did not clear the mark on Porto alone');
      expect(!('madeBy' in (await adm('GET', `/api/spaces/${porto.id}`)).json.space) && 'madeBy' in (await adm('GET', `/api/spaces/${lisbon.id}`)).json.space, 'the server did not clear madeBy on Porto alone');
      // After Keep, Undo of that made space is off, with the server's reason.
      await go(t, page);
      await t.waitFor('[data-agent-change]');
      const kept = await t.eval(`(() => { const li = [...document.querySelectorAll('[data-agent-change]')].find((x) => x.querySelector('.agent-change-text').textContent.startsWith('Made the space Porto')); const b = li && li.querySelector('[data-agent-undo]'); return li ? { disabled: !!b && b.disabled, why: (li.querySelector('[data-agent-why]') || {}).textContent || '' } : null; })()`);
      expect(kept && kept.disabled && kept.why === 'An owner chose Keep for this space, so it stays.', `a kept space's Undo reads ${JSON.stringify(kept)}`);
      // The mark on Home: owners see it and Keep; a member does not. Keep there does not enter the space.
      const mHome = await open(1280, 'dark', 'mia', setup);
      await go(mHome, '/');
      await mHome.waitFor(`.space-choice[data-space="${lisbon.id}"]`);
      expect(await hiddenOf(mHome, `.space-choice[data-space="${lisbon.id}"] [data-made]`) && !(await mHome.eval(`document.body.textContent.includes(${JSON.stringify(MARK)})`)), 'a member sees the mark on Home');
      await mHome.close();
      const home = await open(1280, 'dark', 'admin', setup);
      await go(home, '/');
      await home.waitFor(`.space-choice[data-space="${lisbon.id}"] [data-made-keep]`);
      expect(await text(home, `.space-choice[data-space="${lisbon.id}"] .made-mark`) === MARK, 'Home does not show the mark to the admin');
      await shot(home, 'setup-agent-mark-home-1280-dark', false);
      await press(home, `[data-made-keep="${lisbon.id}"]`);
      expect(await waitDialog(home, true), 'Keep on Home asked nothing');
      await home.click('dialog[open] button', 'Keep');
      for (let i = 0; i < 50 && !(await hiddenOf(home, `.space-choice[data-space="${lisbon.id}"] [data-made]`)); i += 1) await sleep(100);
      expect(await hiddenOf(home, `.space-choice[data-space="${lisbon.id}"] [data-made]`) && !(await home.eval(`document.body.classList.contains('in-space')`)), 'Keep on Home did not clear the mark, or entered the space');
      expect(!('madeBy' in (await adm('GET', `/api/spaces/${lisbon.id}`)).json.space), 'the server did not clear madeBy for Lisbon');
      expect(home.problems.length === 0, `Home: ${home.problems.join('; ')}`);
      await home.close();
      // 390 wide: a waiting ask and an undoable change.
      const faro = await make('Faro');
      expect((await bot('POST', `/api/agent/spaces/${faro.id}/asks`, { ask: 'add', person: mia.key })).status === 202, 'could not make the 390 ask');
      await t.close();
      const ph = await open(390, 'dark', 'admin', setup);
      await go(ph, page);
      await ph.waitFor('[data-agent-ask]');
      await ph.waitFor('[data-agent-undo]:not([disabled])');
      expect(await wide(ph) <= 0, `the set-up agent's page scrolls sideways at 390 (${await wide(ph)})`);
      for (const sel of ['[data-agent-answer="approve"]', '[data-agent-answer="decline"]', '[data-agent-undo]:not([disabled])']) expect(await hit(ph, sel) >= 44, `${sel} is ${await hit(ph, sel)} px tall at 390`);
      await shot(ph, 'setup-agent-page-390-dark');
      await go(ph, '/admin#spaces');
      await ph.waitFor(`#spaces [data-space="${faro.id}"] [data-made-keep]`);
      expect(await wide(ph) <= 0 && await hit(ph, `[data-made-keep="${faro.id}"]`) >= 44, `Manage's list at 390: ${await wide(ph)} wide, Keep ${await hit(ph, `[data-made-keep="${faro.id}"]`)} px`);
      await shot(ph, 'setup-agent-mark-manage-390-dark');
      expect(ph.problems.length === 0, `390: ${ph.problems.join('; ')}`);
      await ph.close();
      expect(t.problems.length === 0, `set-up agent's page: ${t.problems.join('; ')}`);
    }
    // An address that names no agent opens the list.
    {
      const t = await open(1280, 'dark', 'admin');
      await go(t, '/admin#agent/nobody');
      await t.waitFor('#users-main:not([hidden])');
      expect(await hiddenOf(t, '#agent-page') && await t.eval(`location.hash`) === '#users', 'an address with no such agent shows the agent page');
      await t.close();
    }
  } catch (err) {
    for (const f of failures) console.error('check-agent-pages: ' + f); // what failed before it stopped
    throw err;
  } finally {
    if (browser) await stopBrowser(browser.child, browser.dir);
    await stopServer(server);
    await stopServer(plain);
    await stopServer(exp);
    await stopServer(setup);
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
  if (failures.length) { for (const f of failures) console.error('check-agent-pages: ' + f); return 1; }
  say('ok');
  return 0;
}
process.exitCode = await main();
