// Shared by the Vault's privacy checks (modules/vault/test/check-vault-privacy-*.mjs): a throwaway server with the Vault and a few people
// in a space, files added through the API with their visibility, a browser (headless Chromium, tools/shots.mjs; no LiveKit), and the small
// helpers the checks use. Not a check itself: it lives in test/lib/, which the module lane does not run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const shots = await import(path.join(ROOT, 'tools', 'shots.mjs'));
const seed = await import(path.join(ROOT, 'tools', 'shots-seed.mjs'));
export const { startServer, stopServer, freePort, findBrowser, launch, Tab, sleep } = shots;
export const { PASSWORD } = seed;

export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
export const SHOT_DIR = process.env.VAULT_SHOTS || '';

export function reporter(name) {
  const r = { passed: 0, failed: 0 };
  r.check = (ok, what) => { if (ok) r.passed += 1; else { r.failed += 1; console.error(`FAIL ${name}: ${what}`); } };
  r.say = (...a) => console.log(`${name}:`, ...a);
  r.done = () => {
    if (r.failed) { console.error(`${name}: ${r.failed} failed, ${r.passed} passed`); process.exit(1); }
    console.log(`${name}: OK (${r.passed} checks)`);
    process.exit(0);
  };
  return r;
}

// A throwaway environment: the travel template (so the words read "trip"), the Vault on, people and a space.
//   people: noor (an owner), mia (a moderator of the trip), lee, sam, ana, ben, chloe (members of the trip), zed (not in it).
export async function boot(name, { extraMembers = 0 } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  const server = await startServer(dataDir, await freePort(), 'first');
  const jars = {};
  const api = async (who, method, url, body, type) => {
    const headers = { accept: 'application/json' };
    if (jars[who]) headers.cookie = jars[who];
    if (body !== undefined) headers['content-type'] = type || 'application/json';
    const r = await fetch(server.base + url, { method, headers, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json, headers: r.headers };
  };
  const signIn = async (login) => {
    const r = await fetch(server.base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: PASSWORD }) });
    if (r.status !== 200) throw new Error(`cannot sign in as ${login}: ${r.status}`);
    jars[login] = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  };
  const ok = async (who, method, url, body, type) => {
    const r = await api(who, method, url, body, type);
    if (r.status >= 300) throw new Error(`${method} ${url} as ${who}: ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  };
  await signIn('admin');
  await ok('admin', 'PATCH', '/api/settings', { template: 'travel' });
  const keys = {};
  const person = async (login, displayName, role = 'member') => {
    keys[login] = (await ok('admin', 'POST', '/api/users', { login, displayName, role, password: PASSWORD })).user.key;
  };
  await person('noor', 'Noor Haddad', 'owner');
  for (const [login, name] of [['mia', 'Mia Alvarez'], ['lee', 'Lee Chen'], ['sam', 'Sam Okafor'], ['ana', 'Ana Costa'], ['ben', 'Ben Weiss'], ['chloe', 'Chloe Martin'], ['zed', 'Zed Outsider']]) await person(login, name);
  const extra = [];
  for (let i = 0; i < extraMembers; i += 1) {
    const login = `u${String(i).padStart(3, '0')}`;
    extra.push((await ok('admin', 'POST', '/api/users', { login, displayName: `Guest ${String(i).padStart(3, '0')}`, role: 'member', passwordless: true })).user.key);
  }
  await ok('admin', 'POST', '/api/modules/bundled/vault/install');
  await ok('admin', 'PATCH', '/api/modules/vault', { enabled: true });
  const members = ['noor', 'mia', 'lee', 'sam', 'ana', 'ben', 'chloe'].map((l) => keys[l]);
  const trip = (await ok('admin', 'POST', '/api/spaces', { name: 'Rome in October', members })).space.id;
  await ok('admin', 'PATCH', `/api/users/${keys.mia}/spaces/${trip}`, { permissions: { moderator: true } });
  for (const l of ['noor', 'mia', 'lee', 'sam', 'ana', 'ben', 'chloe', 'zed']) await signIn(l);
  const file = async (who, fileName, visibility, people, space = trip) => {
    const q = new URLSearchParams({ space, name: fileName });
    if (visibility) q.set('visibility', visibility);
    if (people && people.length) q.set('people', people.map((l) => keys[l] || l).join(','));
    const r = await api(who, 'POST', `/api/modules/vault/library?${q}`, PNG, 'image/png');
    if (r.status !== 201) throw new Error(`could not add ${fileName} as ${who}: ${r.status} ${JSON.stringify(r.json)}`);
    return r.json.file;
  };
  const listOf = async (who, space = trip) => ((await api(who, 'GET', `/api/modules/vault/library?space=${space}`)).json || {}).files || [];
  return { server, dataDir, api, ok, signIn, jars, keys, extra, trip, file, listOf, members };
}

export async function stop(env, browser, tab) {
  if (tab) await tab.close().catch(() => {});
  if (browser) { try { browser.child.kill(); } catch { /* gone */ } }
  if (env && env.server) await stopServer(env.server);
  if (env && env.dataDir) fs.rmSync(env.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

// A tab signed in as `who` on the Vault page of the space, in a size and a mode.
export async function openVault(env, browser, who, { size = 1280, mode = 'light', space, wait = '#module-frame >>> .vt-app:not([hidden])', touch = false } = {}) {
  const tab = new Tab(browser.cdp, {});
  await tab.open(size, mode);
  if (touch) { await tab.cdp.send('Emulation.setDeviceMetricsOverride', { width: size, height: 900, deviceScaleFactor: 1, mobile: true }, tab.sid); await tab.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, tab.sid); }
  for (const kv of env.jars[who].split('; ')) { const i = kv.indexOf('='); await tab.cdp.send('Network.setCookie', { name: kv.slice(0, i), value: kv.slice(i + 1), url: env.server.base, httpOnly: true }, tab.sid); }
  await tab.cdp.send('Page.navigate', { url: `${env.server.base}/modules/vault?space=${space || env.trip}&popout=1` }, tab.sid);
  await tab.waitFor(wait);
  await tab.settle();
  await tab.forceMode();
  await sleep(500);
  return tab;
}

// Text of the visible parts of the page, the module's shadow root included.
export const ROOTS = `const roots = []; (function walk(r) { roots.push(r); for (const x of r.querySelectorAll('*')) if (x.shadowRoot) walk(x.shadowRoot); })(document);`;
export const TEXT = (sel) => `(() => { ${ROOTS} const out = []; for (const r of roots) for (const e of r.querySelectorAll(${JSON.stringify(sel)})) if (e.getClientRects().length) out.push(e.innerText); return out.join(' | '); })()`;
export const COUNT = (sel) => `(() => { ${ROOTS} let n = 0; for (const r of roots) n += [...r.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.getClientRects().length).length; return n; })()`;
// Everything the page holds that a person or a reader could take a name from: all text, and every attribute, in the page and its
// shadow roots (titles, labels, data, values).
export const EVERYTHING = `(() => { ${ROOTS} const out = []; for (const r of roots) { for (const e of r.querySelectorAll('*')) { out.push(e.textContent && e.children.length === 0 ? e.textContent : ''); for (const a of e.attributes) out.push(a.value); } } return out.join('\\n'); })()`;
export const PRESS = (sel) => `(() => { ${ROOTS} for (const r of roots) { const e = r.querySelector(${JSON.stringify(sel)}); if (e) { e.click(); return true; } } return false; })()`;

export async function until(tab, expr, want, ms = 8000) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) { v = await tab.eval(expr); if (want(v)) return v; await sleep(150); }
  return v;
}

export async function shot(tab, name) {
  if (!SHOT_DIR) return null;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = path.join(SHOT_DIR, `${name}.png`);
  fs.writeFileSync(file, await tab.shoot());
  return file;
}

// Both themes: `fn(mode)` is run for light, then dark, on the same open page.
export async function inBoth(tab, fn) {
  for (const mode of ['light', 'dark']) { await tab.switchMode(mode); await sleep(400); await fn(mode); }
  await tab.switchMode('light');
  await sleep(300);
}

// The contrast of a colour pair as WCAG reads it; the colours are read from the page (any CSS colour) through a canvas.
export const CONTRAST = `(() => {
  const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d', { willReadFrequently: true });
  const rgb = (css) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = css; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lum = ([r, gg, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b); };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)); };
  // The colour behind an element: the first ancestor with a visible background, over the page's.
  const back = (e) => { const stack = []; for (let n = e; n; n = n.parentElement || (n.getRootNode() && n.getRootNode().host)) { const bg = rgb(getComputedStyle(n).backgroundColor); if (bg[3] > 0) { stack.push(bg); if (bg[3] >= 1) break; } } let base = [255, 255, 255]; for (const bg of stack.reverse()) base = over(bg, base); return base; };
  window.__ratio = (e) => { const s = getComputedStyle(e); const bg = back(e); const fgc = rgb(s.color); const fg = over(fgc, bg); const a = lum(fg); const b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  return true;
})()`;

// ---- the file window ----
export async function openWindow(tab, name) {
  await tab.click('#module-frame >>> .sdk-open', name);
  await tab.waitFor('.fv-win');
  await sleep(500);
}
export async function showInfo(tab) {
  await until(tab, `[...document.querySelectorAll('.fv-win.is-front .mf-toolbar button')].some((b) => b.getAttribute('aria-label') === 'Info')`, Boolean, 10000);
  if (!(await tab.eval(`!!document.querySelector('.fv-info')`))) await tab.eval(`[...document.querySelectorAll('.fv-win.is-front .mf-toolbar button')].find((b) => b.getAttribute('aria-label') === 'Info').click()`);
  await tab.waitFor('.fv-info');
  await sleep(400);
}
// Answer some requests as the page's own network would, for what a throwaway server does not do: `rules(request)` gives
// { status, body } to answer instead, or null to let it through; `edit(request, body)` may change a response.
export async function intercept(tab, { patterns, rules = () => null, edit = null }) {
  const s = (m, p) => tab.cdp.send(m, p, tab.sid);
  await s('Fetch.enable', { patterns });
  const hook = async (m) => {
    if (m.method !== 'Fetch.requestPaused' || m.sessionId !== tab.sid) return;
    const p = m.params; const id = p.requestId;
    try {
      if (p.responseStatusCode === undefined) {
        const answer = rules(p.request);
        if (answer) await s('Fetch.fulfillRequest', { requestId: id, responseCode: answer.status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(answer.body || { error: 'It did not work.' })).toString('base64') });
        else await s('Fetch.continueRequest', { requestId: id });
      } else if (edit) {
        const body = JSON.parse(Buffer.from((await s('Fetch.getResponseBody', { requestId: id })).body, 'base64').toString('utf8') || 'null');
        const changed = edit(p.request, body);
        await s('Fetch.fulfillRequest', { requestId: id, responseCode: p.responseStatusCode, responseHeaders: p.responseHeaders.filter((h) => h.name.toLowerCase() !== 'content-length'), body: Buffer.from(JSON.stringify(changed)).toString('base64') });
      } else await s('Fetch.continueResponse', { requestId: id });
    } catch { try { await s('Fetch.continueRequest', { requestId: id }); } catch { /* gone */ } }
  };
  tab.cdp.listeners.push(hook);
  return () => { tab.cdp.listeners = tab.cdp.listeners.filter((f) => f !== hook); return s('Fetch.disable').catch(() => {}); };
}
export async function press(tab, k, code, vk, text) {
  await tab.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) }, tab.sid);
  await tab.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }, tab.sid);
}
