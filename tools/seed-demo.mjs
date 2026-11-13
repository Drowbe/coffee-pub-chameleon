// The demo seeder: `npm run seed:demo`. Fills a running local server, through its own API, with ONE space named "Demo: Portugal":
// a full trip (Lisbon, Sintra, Porto; ten days starting about 45 days after the day it is run) with every module holding data,
// so a person can look at a real-feeling space. Run it in a second window against the server you already have running.
//
// This file is the thin command. It does the ENVIRONMENT-WIDE setup that only a throwaway environment should get (below), then
// hands over to the generic loader (server/demo-loader.js), which fills only the marked demo space and the marked demo people
// from the template's data file (templates/demo/<template id>.json; the trip data and its date offsets live there).
//
// Where: SEED_URL, else http://localhost:<PORT> when PORT is set in this window, else http://localhost:3000.
// Who: ADMIN_LOGIN (default "admin") and ADMIN_PASSWORD, from the environment; the password is never printed.
// Re-running resets only the demo space (found by its name and the marker in its description) and the demo people.
// Every bundled module is installed and turned on (a module that is on is on in every space), the place search is chosen
// (Photon, or SEED_SEARCH_URL, a Photon-compatible address) and, unless SEED_MAP=0, the small Lisbon, Sintra and Porto map file
// is made and ticked (tools/seed-demo-map.mjs; skipped with one message when offline). The earlier phases hold dated objects.
// A hosted install (BASE_DOMAIN) is refused unless DEMO_ALLOW_HOSTED=1 and DEMO_ENVIRONMENT names the ONE environment to fill;
// SEED_URL must then be that environment's own address (<id>.<base domain>), and ADMIN_LOGIN / ADMIN_PASSWORD an owner of it.
// It talks only to that address, so no other environment is touched. Hosted, the map files are the host's, so none is made.
// SEED_TODAY=YYYY-MM-DD fakes the day (for the check). SEED_NO_AI=1 skips the "/ai" exchanges that are otherwise made when an
// AI service is set up. Every date is worked out from today, so a nightly run keeps the demo ahead of the day.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadDemo, readDemoFile, DemoError, MARKER: LOADER_MARKER, dayPlus: loaderDayPlus } = require('../server/demo-loader.js');

export const SPACE_NAME = readDemoFile('travel').name;
export const MARKER = LOADER_MARKER;
export const dayPlus = loaderDayPlus;

export function resolveTarget(env = process.env) {
  if (env.SEED_URL) return env.SEED_URL.replace(/\/+$/, '');
  if (env.PORT) return `http://localhost:${env.PORT}`;
  return 'http://localhost:3000';
}

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
// The core modules first, then every other bundled module, so the demo space has them all on.
const MODULE_IDS = ['travel', 'maps', 'todo', 'polls', 'calendar', 'budget', 'research'];

class SeedError extends Error {}

// ---------------------------------------------------------------------------------------------------------------------
export async function runSeed({ base, login = 'admin', adminPassword, today, say = console.log, allowHosted = false, demoEnvironment = '', searchUrl = '', noAi = false }) {
  if (!isDay(today)) throw new SeedError('SEED_TODAY must be a day, YYYY-MM-DD.');
  const jars = {};
  const call = async (as, method, url, body) => {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (jars[as]) headers.cookie = jars[as];
    let r;
    try { r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); } catch (e) { throw new SeedError(`No server answered at ${base}. Start it with npm run dev, or set SEED_URL.`); }
    let json = null; try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json, res: r };
  };
  const ok = async (as, method, url, body) => {
    const r = await call(as, method, url, body);
    if (r.status >= 300) throw new SeedError(`${method} ${url} answered ${r.status}: ${r.json && r.json.error ? r.json.error : JSON.stringify(r.json)}`);
    return r.json;
  };
  const signIn = async (as, name, pass) => {
    const r = await call(as, 'POST', '/api/login', { login: name, password: pass });
    if (r.status !== 200 || !r.json || !r.json.user) throw new SeedError(`Could not sign in as ${name} (${r.status}${r.json && r.json.error ? ': ' + r.json.error : ''}). Check ADMIN_LOGIN and ADMIN_PASSWORD.`);
    jars[as] = r.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    return r.json.user;
  };

  // --- is this a server to seed ---
  const brand = await call('none', 'GET', '/api/branding');
  if (brand.status !== 200) throw new SeedError(`The server at ${base} did not answer like this app (${brand.status}).`);
  if (brand.json.hosted) {
    if (!allowHosted) throw new SeedError('This server is a hosted install (BASE_DOMAIN is set), so the demo seeder will not run. Set DEMO_ALLOW_HOSTED=1 and DEMO_ENVIRONMENT=<the demo environment id> to fill that one environment.');
    if (!demoEnvironment) throw new SeedError('This server is a hosted install, so set DEMO_ENVIRONMENT to the id of the one environment to fill.');
    const labels = new URL(base).hostname.split('.');
    if (labels.length < 2 || labels[0] !== demoEnvironment) throw new SeedError(`SEED_URL must be the demo environment's own address (${demoEnvironment}.<your domain>); ${base} is not, so nothing was changed.`);
  }
  const configured = [];
  if (!adminPassword) throw new SeedError('Set ADMIN_PASSWORD (and ADMIN_LOGIN, if it is not "admin") in this window first.');
  const admin = await signIn('admin', login, adminPassword);
  say(`Signed in as ${admin.login || login}.`);

  // --- the environment-wide setup: the template (phases) and the modules. This is the seeder's, never the loader's. ---
  let phases = brand.json.phases || [];
  if (!phases.length) {
    const s = await ok('admin', 'GET', '/api/settings');
    if (s.settings.template) throw new SeedError(`This ${s.settings.words?.environment || 'environment'} uses a template without phases, so there is no plan to date. Use the travel template, or a fresh data folder.`);
    await ok('admin', 'PATCH', '/api/settings', { template: 'travel' });
    say('Switched the template to travel (it had none), for the phases.');
    phases = (await ok('admin', 'GET', '/api/branding')).phases || [];
  }
  if (phases.length < 6) throw new SeedError('The template has fewer than six phases; the demo plan needs the travel template.');
  const listed = await ok('admin', 'GET', '/api/modules');
  const have = new Map((listed.modules || []).map((m) => [m.id, m]));
  const moduleIds = [...MODULE_IDS, ...(listed.bundled || []).map((b) => b.id).filter((id) => !MODULE_IDS.includes(id))];
  const turnedOn = []; const notOn = [];
  for (const id of moduleIds) {
    const core = MODULE_IDS.includes(id);
    try {
      if (!have.has(id)) {
        const r = await call('admin', 'POST', `/api/modules/bundled/${id}/install`);
        if (r.status >= 300) throw new SeedError(`Could not install the ${id} module: ${r.json && r.json.error}`);
      }
      if (!have.get(id) || !have.get(id).enabled) await ok('admin', 'PATCH', `/api/modules/${id}`, { enabled: true });
      turnedOn.push(id);
    } catch (e) {
      if (core) throw e;
      notOn.push(id);
    }
  }
  configured.push(`Modules on for every space: ${turnedOn.join(', ')}.`);
  if (notOn.length) configured.push(`Could not turn on: ${notOn.join(', ')} (not in the plan, or not installable here).`);
  await ok('admin', 'PATCH', '/api/settings', { showCalendar: true, showMap: true });

  // --- the place search, which the Map's search field uses (Photon, the public service, unless SEED_SEARCH_URL is set) ---
  {
    const all = (await ok('admin', 'GET', '/api/module-settings/environment')).modules || [];
    const maps = all.find((m) => m.id === 'maps');
    const now = (key) => ((maps && maps.settings.find((x) => x.key === key)) || {}).value;
    if (searchUrl) {
      await ok('admin', 'PUT', '/api/modules/maps/settings/environment', { values: { searchProvider: 'custom', search: searchUrl, saveResults: true } });
      configured.push(`Place search: ${searchUrl} (SEED_SEARCH_URL), results saved.`);
    } else if (!now('searchProvider') || now('searchProvider') === 'none') {
      await ok('admin', 'PUT', '/api/modules/maps/settings/environment', { values: { searchProvider: 'photon', saveResults: true } });
      configured.push('Place search: Photon, the public service (photon.komoot.io), results saved.');
    } else {
      configured.push(`Place search: left as it was (${now('searchProvider')}).`);
    }
  }

  // --- the loader: the marked demo people and the marked demo space, from templates/demo/<template id>.json ---
  const templateId = ((await ok('admin', 'GET', '/api/settings')).settings.template || {}).id;
  let report;
  try { report = await loadDemo({ base, templateId, today, session: { cookie: jars.admin }, say }); } catch (e) { throw e instanceof DemoError ? new SeedError(e.message) : e; }
  if (!report.demo) throw new SeedError(report.message);
  if (report.refused.length) { const f = report.refused[0]; throw new SeedError(`The ${f.module} object ${f.key} was refused: ${f.why}`); }
  for (const s of report.skipped) configured.push(s.why);
  const { space, start: S } = report;
  const users = Object.fromEntries(report.people.map((p) => [p.login, p.key]));
  const pass = Object.fromEntries(report.people.map((p) => [p.login, p.password]));
  for (const p of report.people) await signIn(p.login, p.login, p.password);

  // --- the AI exchanges (the loader never asks the AI; this command does, when a service is set up) ---
  let aiDone = 0;
  if (!noAi) {
    const a = await call('mia', 'GET', `/api/spaces/${space.id}/ai`);
    if (a.status === 200 && a.json && a.json.available) {
      for (const q of ['What should we do on the free day in Lisbon?', 'Is the Lisboa Card worth it for three people?']) {
        const r = await call('mia', 'POST', `/api/spaces/${space.id}/ai`, { question: q, refs: [] });
        if (r.status < 300) aiDone += 1;
      }
    }
  }

  // --- counts ---
  const planRows = ((await ok('admin', 'GET', `/api/modules/travel/data?scope=space&space=${space.id}&prefix=plan:`)).items || []).map((i) => i.value);
  const c = report.created;
  const counts = { planner: planRows.length, places: c.maps, calendar: c.calendar, todo: c.todo, polls: c.polls, budget: c.budget, research: c.research, chat: c.chat + aiDone * 2 };
  const settings = (await ok('admin', 'GET', '/api/settings')).settings;
  const mapReason = settings.topBarReasons && settings.topBarReasons.map;
  return { space, S, users, pass, guestUrl: report.guestUrl, counts, mapReason, aiDone, planRows, configured, hosted: Boolean(brand.json.hosted), created: report.created, skipped: report.skipped };
}

// ---------------------------------------------------------------------------------------------------------------------
async function main() {
  const base = resolveTarget();
  console.log(`Using the server at ${base}.`);
  const today = process.env.SEED_TODAY || new Date().toISOString().slice(0, 10);
  const login = process.env.ADMIN_LOGIN || 'admin';
  const r = await runSeed({ base, login, adminPassword: process.env.ADMIN_PASSWORD, today, allowHosted: process.env.DEMO_ALLOW_HOSTED === '1', demoEnvironment: process.env.DEMO_ENVIRONMENT || '', searchUrl: process.env.SEED_SEARCH_URL || '', noAi: process.env.SEED_NO_AI === '1' });
  // The map file: made and ticked here unless SEED_MAP=0. Hosted, the map files are the host's, so none is made.
  if (process.env.SEED_MAP === '0') r.configured.push('Map file: skipped (SEED_MAP=0).');
  else if (r.hosted) r.configured.push('Map file: not made on a hosted install (the host keeps the map files); the host ticks one for this environment.');
  else {
    const { seedMap } = await import('./seed-demo-map.mjs');
    let message;
    try { message = (await seedMap({ base, login, adminPassword: process.env.ADMIN_PASSWORD, say: () => {}, folded: true })).message; } catch (e) { message = `not made (${e.message}). Run npm run seed:demo-map to try again.`; }
    r.configured.push(`Map file: ${message}`);
  }
  const c = r.counts;
  console.log('');
  console.log(`Done. The demo space "${SPACE_NAME}" is ready (the trip runs ${r.S} to ${dayPlus(r.S, 9)}).`);
  console.log(`  Open it:  ${base}/#join=${r.space.id}`);
  console.log(`  Planner:  ${base}/modules/travel?space=${r.space.id}`);
  if (r.guestUrl) console.log(`  Guest link: ${r.guestUrl}`);
  console.log('  People (one-time passwords, new on every run):');
  console.log(`    mia (moderator)  ${r.pass.mia}`);
  console.log(`    lee (member)     ${r.pass.lee}`);
  console.log(`    sam (member)     ${r.pass.sam}`);
  console.log('    You, the admin, are in the space too.');
  console.log(`  Planner ${c.planner} objects | Places ${c.places} | Calendar ${c.calendar} events | To-do ${c.todo} | Polls ${c.polls} | Budget ${c.budget} costs | Research ${c.research} | Chat ${c.chat} messages${r.aiDone ? ' (with /ai answers)' : ''}`);
  console.log('  Set up for you:');
  for (const line of r.configured) console.log(`    ${line}`);
  console.log('  To reset: run npm run seed:demo again. It removes and rebuilds only this space and the three demo people.');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e instanceof SeedError ? e.message : `seed:demo failed: ${e.stack || e}`); process.exit(1); });
}
