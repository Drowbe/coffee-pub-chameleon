// The demo seeder: `npm run seed:demo`. Fills a running local server, through its own API, with ONE space named "Demo: Portugal":
// a full trip (Lisbon, Sintra, Porto; ten days starting about 45 days after the day it is run) with every module holding data,
// so a person can look at a real-feeling space. Run it in a second window against the server you already have running.
//
// Where: SEED_URL, else http://localhost:<PORT> when PORT is set in this window, else http://localhost:3000.
// Who: ADMIN_LOGIN (default "admin") and ADMIN_PASSWORD, from the environment; the password is never printed.
// Re-running resets only the demo space (found by its name and the marker in its description) and the demo people.
// A hosted server (BASE_DOMAIN) is refused unless DEMO_ALLOW_HOSTED=1. SEED_TODAY=YYYY-MM-DD fakes the day (for the check).
// SEED_NO_AI=1 skips the "/ai" exchanges that are otherwise made when an AI service is set up.
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const SPACE_NAME = 'Demo: Portugal';
export const MARKER = 'Demo data from npm run seed:demo.';
const PEOPLE = [['mia', 'Mia Alvarez', true], ['lee', 'Lee Chen', false], ['sam', 'Sam Okafor', false]];
const MODULE_IDS = ['travel', 'places', 'todo', 'polls', 'calendar', 'budget', 'research', 'maps'];

export function resolveTarget(env = process.env) {
  if (env.SEED_URL) return env.SEED_URL.replace(/\/+$/, '');
  if (env.PORT) return `http://localhost:${env.PORT}`;
  return 'http://localhost:3000';
}

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const dayPlus = (today, n) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const password = () => crypto.randomBytes(12).toString('base64url');

class SeedError extends Error {}

// ---------------------------------------------------------------------------------------------------------------------
export async function runSeed({ base, login = 'admin', adminPassword, today, say = console.log, allowHosted = false, noAi = false }) {
  if (!isDay(today)) throw new SeedError('SEED_TODAY must be a day, YYYY-MM-DD.');
  const jars = {};
  const call = async (as, method, url, body, type) => {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = type || 'application/json';
    if (jars[as]) headers.cookie = jars[as];
    let r;
    try { r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : type ? body : JSON.stringify(body) }); } catch (e) { throw new SeedError(`No server answered at ${base}. Start it with npm run dev, or set SEED_URL.`); }
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
  if (brand.json.hosted && !allowHosted) throw new SeedError('This server is a hosted install (BASE_DOMAIN is set), so the demo seeder will not run. Set DEMO_ALLOW_HOSTED=1 to run it anyway.');
  if (!adminPassword) throw new SeedError('Set ADMIN_PASSWORD (and ADMIN_LOGIN, if it is not "admin") in this window first.');
  const admin = await signIn('admin', login, adminPassword);
  say(`Signed in as ${admin.login || login}.`);

  // --- the template (phases) and the modules ---
  let phases = brand.json.phases || [];
  if (!phases.length) {
    const s = await ok('admin', 'GET', '/api/settings');
    if (s.settings.template) throw new SeedError(`This ${s.settings.words?.environment || 'environment'} uses a template without phases, so there is no plan to date. Use the travel template, or a fresh data folder.`);
    await ok('admin', 'PATCH', '/api/settings', { template: 'travel' });
    say('Switched the template to travel (it had none), for the phases.');
    phases = (await ok('admin', 'GET', '/api/branding')).phases || [];
  }
  if (phases.length < 6) throw new SeedError('The template has fewer than six phases; the demo plan needs the travel template.');
  const have = new Map(((await ok('admin', 'GET', '/api/modules')).modules || []).map((m) => [m.id, m]));
  for (const id of MODULE_IDS) {
    if (!have.has(id)) {
      const r = await call('admin', 'POST', `/api/modules/bundled/${id}/install`);
      if (r.status >= 300) throw new SeedError(`Could not install the ${id} module: ${r.json && r.json.error}`);
    }
    if (!have.get(id) || !have.get(id).enabled) await ok('admin', 'PATCH', `/api/modules/${id}`, { enabled: true });
  }
  await ok('admin', 'PATCH', '/api/settings', { showCalendar: true, showMap: true });

  // --- the demo people ---
  const existing = (await ok('admin', 'GET', '/api/users')).users || [];
  const users = {}; const pass = {};
  for (const [name, displayName] of PEOPLE) {
    pass[name] = password();
    const found = existing.find((u) => u.login === name);
    if (found && found.displayName !== displayName) throw new SeedError(`An account called "${name}" already exists and is not a demo person (its name is not ${displayName}), so it is left alone. Rename or remove it first.`);
    if (found) { await ok('admin', 'PATCH', `/api/users/${found.key}`, { password: pass[name] }); users[name] = found.key; }
    else users[name] = (await ok('admin', 'POST', '/api/users', { login: name, displayName, role: 'member', password: pass[name] })).user.key;
  }
  const meKey = (await ok('admin', 'GET', '/api/me')).user?.key || admin.key;
  for (const [name] of PEOPLE) await signIn(name, name, pass[name]);

  // --- reset only the demo space ---
  for (const sp of (await ok('admin', 'GET', '/api/spaces')).spaces || []) {
    if (sp.name !== SPACE_NAME) continue;
    const full = (await ok('admin', 'GET', `/api/spaces/${sp.id}`)).space;
    if (!String(full.description || '').startsWith(MARKER)) throw new SeedError(`A space called "${SPACE_NAME}" exists but is not the demo (its description lacks the marker), so it is left alone.`);
    await ok('admin', 'DELETE', `/api/spaces/${sp.id}`);
    say('Removed the old demo space.');
  }
  const members = [...new Set([users.mia, users.lee, users.sam, meKey].filter(Boolean))];
  const space = (await ok('admin', 'POST', '/api/spaces', { name: SPACE_NAME, description: `${MARKER} Portugal in ten days: Lisbon, Sintra, Porto. Reset by running it again.`, members })).space;
  await ok('admin', 'PATCH', `/api/users/${users.mia}/spaces/${space.id}`, { permissions: { moderator: true } });

  const S = dayPlus(today, 45); // the trip's first day
  const d = (n) => dayPlus(S, n);
  const ids = phases.map((p) => p.id);
  const mainAt = Math.max(0, phases.findIndex((p) => p.main));
  const starts = [today, dayPlus(today, 8), dayPlus(today, 20), dayPlus(today, 34)];
  const dates = {};
  ids.forEach((id, i) => {
    if (i < mainAt) dates[id] = { start: starts[Math.min(i, starts.length - 1)] };
    else if (i === mainAt) dates[id] = { start: S, end: d(9) };
    else if (i === mainAt + 1) dates[id] = { start: d(10), end: d(30) };
  });
  await ok('admin', 'PATCH', `/api/spaces/${space.id}`, { phases: dates, budget: { amount: 6500, currency: 'EUR' } });
  const phaseOf = (i) => ids[i] || null;

  const put = (module, key, value, extra = {}) => ok('admin', 'PUT', `/api/modules/${module}/data/${encodeURIComponent(key)}?scope=space&space=${space.id}`, { value, tz: 'Europe/Lisbon', ...extra });
  const { mia, lee, sam } = users;
  const all = [mia, lee, sam];
  const MIA = 'Mia Alvarez'; const SAM = 'Sam Okafor'; const LEE = 'Lee Chen';

  // --- Places (before the Planner: the Planner points at some) ---
  const P = [
    // [id, title, category, type, lat, lng, address, status, notes]
    ['castelo', 'Castelo de Sao Jorge', 'sights', 'castle', 38.7139, -9.1334, 'Rua de Santa Cruz do Castelo', 'want', 'Go late in the day for the light over the river.'],
    ['jeronimos', 'Mosteiro dos Jeronimos', 'sights', 'monument', 38.6979, -9.2068, 'Praca do Imperio, Belem', 'booked', 'Closed on Mondays.'],
    ['belem', 'Torre de Belem', 'sights', 'tower', 38.6916, -9.2160, 'Av. Brasilia, Belem', 'want', ''],
    ['pasteis', 'Pasteis de Belem', 'food', 'bakery', 38.6975, -9.2032, 'Rua de Belem 84', 'favorite', 'Eat them warm, with cinnamon.'],
    ['maat', 'MAAT', 'sights', 'museum', 38.6957, -9.1930, 'Av. Brasilia', 'want', ''],
    ['timeout', 'Time Out Market', 'food', 'food-hall', 38.7068, -9.1460, 'Av. 24 de Julho 49', 'want', 'Lots of stalls, one bench for three.'],
    ['brasileira', 'Cafe A Brasileira', 'food', 'cafe', 38.7103, -9.1424, 'Rua Garrett 120', 'want', ''],
    ['ramiro', 'Cervejaria Ramiro', 'food', 'seafood', 38.7226, -9.1357, 'Av. Almirante Reis 1', 'want', 'Go early; there is a queue after 7.'],
    ['senhoramonte', 'Miradouro da Senhora do Monte', 'sights', 'viewpoint', 38.7203, -9.1329, 'Largo Monte', '', 'The best view of the castle.'],
    ['santaluzia', 'Miradouro de Santa Luzia', 'sights', 'viewpoint', 38.7118, -9.1296, 'Largo de Santa Luzia', '', ''],
    ['rossio', 'Rossio Station', 'transport', 'train-station', 38.7141, -9.1415, 'Praca Dom Joao da Camara', '', 'Trains to Sintra leave from here.'],
    ['apolonia', 'Santa Apolonia Station', 'transport', 'train-station', 38.7140, -9.1223, 'Av. Infante Dom Henrique', 'booked', 'Trains to Porto leave from here.'],
    ['lis', 'Lisbon Airport (LIS)', 'transport', 'airport', 38.7742, -9.1342, 'Alameda das Comunidades Portuguesas', '', ''],
    ['comercio', 'Praca do Comercio', 'sights', 'landmark', 38.7075, -9.1364, 'Praca do Comercio', '', ''],
    ['azulejo', 'Museu Nacional do Azulejo', 'sights', 'museum', 38.7253, -9.1139, 'Rua da Madre de Deus 4', '', 'Five hundred years of tiles.'],
    ['casalargo', 'Casa do Largo (Lisbon stay)', 'stay', 'hotel', 38.7134, -9.1393, 'Largo do Carmo 7', 'booked', 'Demo hotel. Breakfast from 7:30.'],
    ['lxfactory', 'LX Factory', 'shopping', 'market', 38.7033, -9.1783, 'Rua Rodrigues de Faria 103', '', 'Bookshop and a good coffee.'],
    ['santajusta', 'Elevador de Santa Justa', 'sights', 'landmark', 38.7121, -9.1393, 'Rua do Ouro', '', ''],
    ['tram28', 'Tram 28 stop, Martim Moniz', 'transport', 'tram', 38.7167, -9.1359, 'Largo Martim Moniz', 'favorite', 'Get there before 9 to find a seat.'],
    ['pena', 'Palacio da Pena', 'sights', 'castle', 38.7876, -9.3906, 'Estrada da Pena, Sintra', 'booked', 'Timed tickets. Take the bus from the station.'],
    ['regaleira', 'Quinta da Regaleira', 'sights', 'historic-site', 38.7966, -9.3963, 'Rua Barbosa du Bocage', 'want', 'Bring a torch for the well.'],
    ['piriquita', 'Casa Piriquita', 'food', 'bakery', 38.7973, -9.3875, 'Rua das Padarias 1, Sintra', 'want', 'Travesseiros.'],
    ['sintra', 'Sintra Station', 'transport', 'train-station', 38.7978, -9.3868, 'Av. Dr. Miguel Bombarda', '', ''],
    ['caboroca', 'Cabo da Roca', 'nature', 'viewpoint', 38.7804, -9.4989, 'Colares', '', 'The westernmost point of mainland Europe. Only if there is time.'],
    ['lello', 'Livraria Lello', 'shopping', 'bookshop', 41.1469, -8.6150, 'Rua das Carmelitas 144', 'want', 'Buy the ticket online.'],
    ['clerigos', 'Torre dos Clerigos', 'sights', 'tower', 41.1458, -8.6143, 'Rua de Sao Filipe de Nery', '', ''],
    ['saobento', 'Estacao de Sao Bento', 'sights', 'train-station', 41.1457, -8.6102, 'Praca Almeida Garrett', '', 'The tile panels in the hall.'],
    ['bolsa', 'Palacio da Bolsa', 'sights', 'historic-site', 41.1415, -8.6160, 'Rua de Ferreira Borges', 'booked', 'Guided tour only.'],
    ['bolhao', 'Mercado do Bolhao', 'food', 'market', 41.1488, -8.6064, 'Rua Formosa', '', ''],
    ['serralves', 'Fundacao de Serralves', 'sights', 'museum', 41.1594, -8.6597, 'Rua Dom Joao de Castro 210', 'want', 'Gardens are included.'],
    ['ribeira', 'Cais da Ribeira', 'sights', 'neighborhood', 41.1403, -8.6119, 'Cais da Ribeira', 'favorite', ''],
    ['luis', 'Ponte Dom Luis I', 'sights', 'bridge', 41.1399, -8.6094, 'Ponte Luiz I', '', 'Walk the upper deck at sunset.'],
    ['campanha', 'Porto Campanha Station', 'transport', 'train-station', 41.1488, -8.5855, 'Praca Almeida Garrett', '', ''],
    ['opo', 'Porto Airport (OPO)', 'transport', 'airport', 41.2481, -8.6814, 'Maia', '', ''],
    ['ribeiravelha', 'Pensao Ribeira Velha (Porto stay)', 'stay', 'hotel', 41.1411, -8.6124, 'Rua dos Mercadores 22', 'booked', 'Demo guesthouse.'],
    ['taylors', "Taylor's Port Cellars", 'activities', 'winery', 41.1384, -8.6162, 'Rua do Choupelo 250', 'want', ''],
    ['pinhao', 'Pinhao viewpoint', 'nature', 'viewpoint', 41.1887, -7.5440, 'Pinhao, Douro Valley', 'favorite', 'Terraced vineyards down to the river.'],
  ];
  for (const [id, title, category, type, lat, lng, address, status, notes] of P) {
    await put('places', `place:${id}`, { title, category, type, ...(status ? { status } : {}), address, point: { lat, lng }, notes, owners: [], by: MIA });
  }
  const placeRef = (id) => ({ module: 'places', kind: 'place', id, scope: 'space', space: space.id });
  const eventRef = (id) => ({ module: 'calendar', kind: 'event', id, scope: 'space', space: space.id });

  // --- Calendar (calendar-only events; the Planner's dated objects get their own twins from the server) ---
  const at = (day, hh, mm = 0) => `${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`;
  const events = [
    ['dm-trip', { title: 'Portugal trip', allDay: true, start: S, end: d(9), desc: 'Lisbon, Sintra and Porto.', remind: null, repeat: null }],
    ['dm-call', { title: 'Weekly planning call', allDay: false, start: at(dayPlus(today, 3), 19), end: at(dayPlus(today, 3), 19, 45), desc: 'Fifteen minutes on what is still open.', remind: 15, repeat: { every: 'week', until: dayPlus(S, -1) } }],
    ['dm-photos', { title: 'Passport photos', allDay: false, start: at(dayPlus(today, 5), 16), end: at(dayPlus(today, 5), 16, 30), desc: '', remind: 60, repeat: null }],
    ['dm-euros', { title: 'Exchange euros at the bank', allDay: false, start: at(dayPlus(today, 12), 12), end: null, desc: 'About 300 euros in small notes.', remind: 1440, repeat: null }],
    ['dm-sitter', { title: 'House sitter arrives', allDay: true, start: dayPlus(S, -1), end: null, desc: 'Keys under the flowerpot, plants on Tuesday.', remind: null, repeat: null }],
    ['dm-pack', { title: 'Pack the suitcases', allDay: true, start: dayPlus(S, -1), end: null, desc: '', remind: null, repeat: null }],
    ['dm-checkin', { title: 'Online check-in opens', allDay: false, start: at(dayPlus(S, -1), 19, 30), end: null, desc: 'Pick seats together.', remind: 30, repeat: null }],
    ['dm-card', { title: 'Lisboa Card runs out', allDay: false, start: at(d(4), 10), end: null, desc: 'The 72 hours end around now.', remind: 60, repeat: null }],
    ['dm-family', { title: 'Video call with family', allDay: false, start: at(d(4), 19), end: at(d(4), 19, 30), desc: 'From the hotel lobby, it has good wifi.', remind: null, repeat: null }],
    ['dm-return', { title: 'Back home: laundry and photos', allDay: true, start: d(11), end: null, desc: 'Share the best ones in Research.', remind: null, repeat: null }],
  ];
  for (const [id, v] of events) await put('calendar', `event:${id}`, { id, by: MIA, ...v });

  // --- Planner ---
  await put('travel', 'trip:main', { title: SPACE_NAME, destination: 'Portugal', start: S, end: d(9), currency: 'EUR', tz: 'Europe/Lisbon' });
  const plan = [];
  let order = 0;
  const add = (v) => { order += 1; plan.push({ by: MIA, order: order * 1000, ...v }); };
  const stop = (type, title, off, time, minutes, extra = {}) => add({ kind: 'stop', type, title, date: d(off), time, minutes, ...extra });
  // Day 1
  add({ kind: 'block', type: 'travel-day', title: 'Travel day', date: d(0) });
  add({ kind: 'note', title: 'Documents and chargers', date: d(0), notes: 'Passports (valid past March), the booking emails, a charger for each phone, two plug adapters, a rain jacket.' });
  add({ kind: 'block', type: 'meet-up', title: 'Meet at the departures hall', date: d(0), time: '17:30', notes: 'Terminal 1, by the check-in desks.' });
  add({ kind: 'journey', mode: 'flight', title: 'Flight to Lisbon', date: d(0), time: '19:30', arrives: `${d(1)}T07:20`, minutes: 410, operator: 'Lusa Air', number: 'LA 482', fromCode: 'BOS', toCode: 'LIS', from: 'Boston Logan', to: 'Lisbon Humberto Delgado', terminal: 'E', gate: 'E7', seat: '23A, 23B, 23C', travelClass: 'Economy', confirm: 'DEMO-4821', cost: 1344, paidBy: mia, owners: all, pinned: true });
  // Day 2
  add({ kind: 'journey', mode: 'rideshare', title: 'Rideshare to the hotel', date: d(1), time: '08:30', minutes: 35, from: 'Lisbon Airport', to: 'Casa do Largo', estimate: 28, owners: [mia] });
  add({ kind: 'stay', type: 'hotel', title: 'Casa do Largo', date: d(1), checkOut: d(6), time: '15:00', checkOutTime: '11:00', place: 'Casa do Largo (Lisbon stay)', address: 'Largo do Carmo 7, Lisbon', roomType: 'Triple', guests: 3, confirm: 'DEMO-HL-1107', cost: 1050, paidBy: sam, owners: all, pinned: true });
  stop('cafe', 'Coffee at A Brasileira', 1, '09:30', 45, { place: 'Cafe A Brasileira', address: 'Rua Garrett 120', estimate: 12 });
  stop('other', 'Collect the Lisboa Cards (72 hours)', 1, '10:30', 30, { notes: 'At the tourist office on Praca dos Restauradores. Covers the metro, trams and many entries.', cost: 60, paidBy: lee, admissionCount: 3 });
  stop('sight', 'Walk through Alfama', 1, '11:15', 120, { place: 'Miradouro de Santa Luzia' });
  stop('restaurant', 'Lunch at Cervejaria Ramiro', 1, '13:45', 90, { place: 'Cervejaria Ramiro', address: 'Av. Almirante Reis 1', partySize: 3, reservationName: 'Alvarez', estimate: 95, owners: [mia, sam] });
  stop('attraction', 'Ride Tram 28', 1, '15:45', 60, { place: 'Tram 28 stop, Martim Moniz' });
  stop('sight', 'Castelo de Sao Jorge', 1, '17:15', 90, { place: 'Castelo de Sao Jorge', admissionCount: 3, estimate: 45 });
  stop('restaurant', 'Dinner at Taberna da Rua das Flores', 1, '20:00', 90, { place: 'Taberna da Rua das Flores', address: 'Rua das Flores 103', partySize: 3, reservationName: 'Alvarez', estimate: 70 });
  // Day 3
  stop('cafe', 'Pasteis de Belem', 2, '09:30', 45, { place: 'Pasteis de Belem', address: 'Rua de Belem 84', estimate: 14 });
  stop('sight', 'Mosteiro dos Jeronimos', 2, '10:30', 90, { place: 'Mosteiro dos Jeronimos', admissionCount: 3, cost: 30, paidBy: sam });
  stop('sight', 'Torre de Belem', 2, '12:15', 45, { place: 'Torre de Belem', estimate: 18 });
  stop('restaurant', 'Lunch at Time Out Market', 2, '13:30', 75, { place: 'Time Out Market', address: 'Av. 24 de Julho 49', estimate: 54, owners: all });
  stop('museum', 'MAAT', 2, '15:30', 90, { place: 'MAAT', admissionCount: 3, estimate: 33 });
  add({ kind: 'journey', mode: 'taxi', title: 'Taxi back to the hotel', date: d(2), time: '17:45', minutes: 25, from: 'Belem', to: 'Casa do Largo', estimate: 16 });
  stop('show', 'Fado night with dinner', 2, '21:30', 120, { place: 'Fado house in Alfama', address: 'Rua de Sao Pedro 18', admissionCount: 3, gate: 'Door B', confirm: 'DEMO-FD-22', cost: 135, paidBy: sam, owners: all });
  // Day 4: Sintra
  add({ kind: 'block', type: 'meet-up', title: 'Meet at Rossio station', date: d(3), time: '08:45' });
  add({ kind: 'journey', mode: 'train', title: 'Train to Sintra', date: d(3), time: '09:15', arrives: `${d(3)}T09:55`, minutes: 40, operator: 'CP', from: 'Rossio', to: 'Sintra', platform: '3', seat: 'open seating', cost: 12.9, paidBy: lee });
  stop('sight', 'Palacio da Pena', 3, '10:45', 150, { place: 'Palacio da Pena', admissionCount: 3, confirm: 'DEMO-PN-31', cost: 57, paidBy: lee, pinned: true, notes: 'Timed entry. The bus from the station takes 15 minutes.' });
  stop('cafe', 'Travesseiros at Casa Piriquita', 3, '13:30', 45, { place: 'Casa Piriquita', estimate: 15 });
  stop('sight', 'Quinta da Regaleira', 3, '14:45', 120, { place: 'Quinta da Regaleira', admissionCount: 3, estimate: 36 });
  add({ kind: 'journey', mode: 'train', title: 'Train back to Lisbon', date: d(3), time: '17:35', minutes: 40, operator: 'CP', from: 'Sintra', to: 'Rossio' });
  add({ kind: 'block', type: 'leave-by', title: 'Leave the hotel by 8:20', date: d(3), time: '08:20' });
  // Day 5: free day
  add({ kind: 'block', type: 'free-day', title: 'Free day', date: d(4) });
  add({ kind: 'block', type: 'free-time', title: 'Wander, shop, nap', date: d(4), time: '10:00', minutes: 360 });
  stop('bar', 'Drinks at Pavilhao Chines', 4, '19:30', 90, { place: 'Pavilhao Chines', address: 'Rua Dom Pedro V 89', estimate: 30 });
  add({ kind: 'link', title: 'Lisboa Card runs out', date: null, ref: eventRef('dm-card') });
  add({ kind: 'link', title: 'Video call with family', date: null, ref: eventRef('dm-family') });
  add({ kind: 'link', title: 'Miradouro da Senhora do Monte', date: d(4), ref: placeRef('senhoramonte'), notes: '' });
  add({ kind: 'lane', type: 'rest', after: d(4) });
  // Day 6 stays empty: only the hotel covers it.
  // Day 7: train to Porto
  add({ kind: 'journey', mode: 'taxi', title: 'Taxi to Santa Apolonia', date: d(6), time: '08:30', minutes: 15, from: 'Casa do Largo', to: 'Santa Apolonia Station', estimate: 10 });
  add({ kind: 'journey', mode: 'train', title: 'Train to Porto', date: d(6), time: '09:35', arrives: `${d(6)}T12:20`, minutes: 165, operator: 'CP Alfa Pendular', number: 'AP 120', from: 'Lisboa Santa Apolonia', to: 'Porto Campanha', platform: '5', carriage: '4', seat: '41, 42, 43', travelClass: 'Second', confirm: 'DEMO-TR-9', cost: 118.5, paidBy: mia, owners: all });
  add({ kind: 'stay', type: 'hotel', title: 'Pensao Ribeira Velha', date: d(6), checkOut: d(9), time: '15:00', checkOutTime: '10:00', place: 'Pensao Ribeira Velha (Porto stay)', address: 'Rua dos Mercadores 22, Porto', roomType: 'Triple', guests: 3, confirm: 'DEMO-HP-2210', cost: 540, paidBy: mia, owners: all, pinned: true });
  stop('restaurant', 'Lunch at Cafe Santiago', 6, '13:45', 75, { place: 'Cafe Santiago', address: 'Rua de Passos Manuel 226', estimate: 36 });
  stop('shop', 'Livraria Lello', 6, '15:30', 60, { place: 'Livraria Lello', admissionCount: 3, cost: 15, paidBy: lee });
  stop('restaurant', 'Dinner at Taberna dos Mercadores', 6, '20:00', 90, { place: 'Taberna dos Mercadores', address: 'Rua dos Mercadores 36', partySize: 3, reservationName: 'Alvarez', estimate: 66 });
  add({ kind: 'note', title: 'Check the forecast', date: d(6), notes: 'Porto is wetter than Lisbon. If it pours, swap the Douro day with a museum day.' });
  // Day 8
  stop('tour', 'Palacio da Bolsa guided tour', 7, '10:00', 60, { place: 'Palacio da Bolsa', admissionCount: 3, confirm: 'DEMO-BS-5', cost: 42, paidBy: sam });
  stop('sight', 'Estacao de Sao Bento tiles', 7, '11:30', 30, { place: 'Estacao de Sao Bento' });
  stop('restaurant', 'Lunch at Mercado do Bolhao', 7, '12:30', 75, { place: 'Mercado do Bolhao', estimate: 40 });
  stop('museum', 'Fundacao de Serralves', 7, '15:00', 150, { place: 'Fundacao de Serralves', admissionCount: 3, estimate: 60 });
  add({ kind: 'journey', mode: 'car', title: 'Rental car, pick-up', date: d(7), time: '18:30', minutes: 2220, operator: 'Sunroad Rentals', pickup: 'Porto Campanha Station', dropoff: 'Porto Airport (OPO)', confirm: 'DEMO-CAR-77', cost: 185, paidBy: lee, owners: [lee, mia], notes: 'Drop-off is two days later at the airport, 7:30. Full tank on return.' });
  // Day 9: Douro
  add({ kind: 'block', type: 'meet-up', title: 'Meet in the hotel lobby', date: d(8), time: '08:30' });
  stop('tour', 'Douro winery tour and tasting', 8, '11:00', 120, { place: "Taylor's Port Cellars", admissionCount: 3, estimate: 120 });
  stop('restaurant', 'Lunch at the winery', 8, '13:30', 90, { estimate: 75 });
  stop('sight', 'Pinhao viewpoint', 8, '16:00', 45, { place: 'Pinhao viewpoint' });
  add({ kind: 'link', title: 'Ponte Dom Luis I at sunset', date: d(8), ref: placeRef('luis') });
  // Day 10: home
  add({ kind: 'journey', mode: 'flight', title: 'Flight home', date: d(9), time: '11:20', arrives: `${d(9)}T13:45`, minutes: 445, operator: 'Lusa Air', number: 'LA 483', fromCode: 'OPO', toCode: 'BOS', from: 'Porto', to: 'Boston Logan', terminal: '1', gate: 'A3', seat: '23A, 23B, 23C', travelClass: 'Economy', confirm: 'DEMO-4831', owners: all });
  add({ kind: 'lane', type: 'buffer', after: d(9) });
  // Unscheduled, with and without a phase
  const un = (title, notes, phaseIndex) => add({ kind: 'stop', type: 'other', title, date: null, after: null, notes, ...(phaseIndex !== undefined ? { phase: phaseOf(phaseIndex) } : {}) });
  un('Book the Douro winery', 'Two places left for the 11:00 tasting last time.', 1);
  un('Buy travel insurance', 'Compare two quotes.', 1);
  un('Reserve Pena Palace tickets', 'Timed entry sells out on weekends.', 1);
  un('Print the tickets and bookings', 'One folder, plus a copy on each phone.', 3);
  un('Check suitcase weight limits', '', 3);
  un('A pastelaria near the hotel', 'Someone said there is a tiny one on Rua do Carmo.');
  un('Day trip to Cascais?', 'Only if the Sintra day goes quickly.');
  un('Buy tiles for the kitchen', 'Measure the wall first.');
  for (let i = 0; i < plan.length; i += 1) await put('travel', `plan:d${String(i + 1).padStart(2, '0')}`, plan[i]);

  // --- To-do ---
  const planId = (title) => `d${String(plan.findIndex((x) => x.title === title) + 1).padStart(2, '0')}`;
  const task = (title, notes, due, extra = {}) => ({ title, notes, due, remind: false, done: false, doneAt: null, createdAt: Date.now(), by: MIA, links: [], ...extra });
  const doneAt = (n) => Date.parse(`${dayPlus(today, n)}T10:00:00Z`);
  const tasks = [
    task('Renew the passport', 'Mia. Valid until 2029, done.', dayPlus(today, 1), { done: true, doneAt: doneAt(0), by: MIA }),
    task('Book the Sintra train', 'Sam. Cheaper online.', dayPlus(today, 6), { by: SAM, links: [{ module: 'travel', kind: 'plan', id: planId('Train to Sintra'), scope: 'space', space: space.id }] }),
    task('Reserve Pena Palace tickets', 'Lee. Timed entry.', dayPlus(today, 9), { by: LEE, remind: true }),
    task('Exchange some euros', 'Mia. About 300 in small notes.', dayPlus(today, 12), { remind: true }),
    task('Buy travel insurance', 'Sam. Compare two quotes.', dayPlus(today, 14), { by: SAM }),
    task('Book the rental car', 'Lee. Automatic, a small one.', dayPlus(today, 16), { by: LEE, done: true, doneAt: doneAt(1) }),
    task('Reserve the Fado dinner', 'Sam. Ask about the early seating.', dayPlus(today, 18), { by: SAM, done: true, doneAt: doneAt(2) }),
    task('Download offline maps', 'Everyone. Lisbon, Sintra, Porto.', dayPlus(today, 28), { by: MIA }),
    task('Get an eSIM for each phone', 'Lee.', dayPlus(today, 30), { by: LEE }),
    task('Tell the bank we are travelling', 'Mia.', dayPlus(today, 33)),
    task('Pack adapters and chargers', 'Sam.', dayPlus(S, -3), { by: SAM }),
    task('Online check-in, seats together', 'Mia. Opens the day before.', dayPlus(S, -1), { remind: true }),
  ];
  for (let i = 0; i < tasks.length; i += 1) await put('todo', `task:dm${String(i + 1).padStart(2, '0')}`, { id: `dm${String(i + 1).padStart(2, '0')}`, ...tasks[i] });

  // --- Polls ---
  const when = (n, hh = 10) => Date.parse(`${dayPlus(today, n)}T${String(hh).padStart(2, '0')}:00:00Z`);
  const polls = [
    ['q1', { question: 'Where do we eat on the first night in Porto?', options: [{ id: 'o1', text: 'Taberna dos Mercadores' }, { id: 'o2', text: 'Mercado do Bolhao stalls' }, { id: 'o3', text: 'Somewhere near the hotel', desc: 'We will be tired after the train.' }], multi: false, addable: true, closed: false, closesAt: null, createdAt: when(2), by: MIA, byKey: mia }, { [mia]: ['o1'], [sam]: ['o1'], [lee]: ['o3'] }],
    ['q2', { question: 'Which day for the Sintra trip?', options: [{ id: 'o1', text: 'Day 3', date: d(2) }, { id: 'o2', text: 'Day 4', date: d(3) }, { id: 'o3', text: 'Day 6', date: d(5) }], multi: true, addable: false, closed: true, closesAt: null, createdAt: when(-0), by: SAM, byKey: sam }, { [mia]: ['o2'], [sam]: ['o2', 'o3'], [lee]: ['o2'] }],
    ['q3', { question: 'Rental car: manual or automatic?', options: [{ id: 'o1', text: 'Manual, it is cheaper' }, { id: 'o2', text: 'Automatic, steep hills' }], multi: false, addable: false, closed: false, closesAt: Date.parse(`${dayPlus(today, 20)}T12:00:00Z`), createdAt: when(4), by: LEE, byKey: lee }, { [lee]: ['o2'], [sam]: ['o2'] }],
  ];
  // A vote is its voter's own and a closed poll takes none (the Polls guards): each person casts theirs while the poll is
  // open, and a poll that ends closed is closed after.
  const loginOf = { [mia]: 'mia', [sam]: 'sam', [lee]: 'lee' };
  for (const [id, v, votes] of polls) {
    await put('polls', `poll:${id}`, { id, ...v, closed: false });
    for (const [key, options] of Object.entries(votes)) await ok(loginOf[key], 'PUT', `/api/modules/polls/data/${encodeURIComponent(`vote:${id}:${key}`)}?scope=space&space=${space.id}`, { value: { options, name: ({ [mia]: MIA, [sam]: SAM, [lee]: LEE })[key], at: when(3, 12) }, tz: 'Europe/Lisbon' });
    if (v.closed) await put('polls', `poll:${id}`, { id, ...v });
  }

  // --- Budget (its own costs; the Planner's costs show beside them) ---
  const CATS = { travel: 'Travel', lodging: 'Lodging', food: 'Food', supplies: 'Supplies', services: 'Services', fees: 'Fees', activities: 'Activities', other: 'Other' };
  const costs = [
    ['Travel insurance', 'services', 180, 172.6, mia, all, 3],
    ['eSIM data plans', 'supplies', 45, 39, sam, all, 5],
    ['Lisboa Cards, spare day', 'activities', 20, null, '', [], null],
    ['Quinta da Regaleira tickets', 'activities', 36, null, '', [], null],
    ['Douro winery tour deposit', 'activities', 60, 60, lee, all, 14],
    ['Fado night extras', 'food', 40, null, '', [], null],
    ['Plug adapters', 'supplies', 30, 27.8, mia, all, 7],
    ['Luggage scale and locks', 'supplies', 25, 21, lee, [lee, mia], 8],
    ['Guidebook', 'other', 24, 22.5, sam, [sam], 9],
    ['Rental car insurance', 'fees', 70, null, '', [], null],
    ['Fuel and tolls, Douro day', 'travel', 55, null, '', [], null],
    ['Hotel city tax', 'fees', 48, null, '', [], null],
    ['Airport snacks', 'food', 40, null, '', [], null],
    ['Laundry', 'services', 30, null, '', [], null],
    ['Tips and small change', 'other', 100, null, '', [], null],
    ['Metro and tram top-ups', 'travel', 40, 40, mia, all, 16],
    ['Souvenirs fund', 'other', 150, null, '', [], null],
    ['Welcome dinner deposit', 'food', 60, 60, sam, [sam, mia], 10],
  ];
  for (let i = 0; i < costs.length; i += 1) {
    const [title, category, planned, actual, paidBy, sharedBy, off] = costs[i];
    await put('budget', `cost:dm${String(i + 1).padStart(2, '0')}`, { title, category, categoryName: CATS[category], planned, ...(actual ? { actual } : {}), amount: actual || planned, done: Boolean(actual), ...(paidBy ? { paidBy } : {}), sharedBy, date: off === null ? '' : dayPlus(today, off), notes: '', by: MIA });
  }

  // --- Research ---
  const res = [
    ['note:r1', { kind: 'note', title: 'Phrases worth learning', body: 'Bom dia (good morning). Obrigado / obrigada (thanks). A conta, por favor (the bill, please). Uma bica (a short coffee).', tags: ['language'], icon: 'language', date: '', by: MIA, at: new Date(when(5)).toISOString() }],
    ['link:r2', { kind: 'link', title: 'Riding Tram 28 without the queue', url: 'https://example.com/lisbon-tram-28', excerpt: 'Board at the first stop, go before nine, and mind your pockets.', tags: ['lisbon'], date: '', by: SAM, at: new Date(when(6)).toISOString() }],
    ['link:r3', { kind: 'link', title: 'Sintra in one day', url: 'https://example.com/sintra-one-day', excerpt: 'Pena first, then Regaleira, with a bus between them. Skip the Moorish Castle if you are short of time.', tags: ['sintra'], date: d(3), by: LEE, at: new Date(when(7)).toISOString() }],
    ['answer:r4', { kind: 'answer', title: 'Is the Lisboa Card worth it?', content: 'For three days of trams, metro and two or three entries (Jeronimos, Belem Tower) it pays for itself. If you walk everywhere and visit one museum, buy single tickets instead.', tags: ['lisbon', 'money'], date: '', by: MIA, at: new Date(when(8)).toISOString() }],
  ];
  for (const [key, v] of res) await put('research', key, { text: v.body || v.excerpt || v.content, sub: '', ...v });

  // --- Guest link ---
  const guest = await call('admin', 'POST', `/api/spaces/${space.id}/guest-link`, {});
  const guestUrl = guest.status < 300 && guest.json ? guest.json.guestUrl : '';

  // --- Chat (all stamped with the time of the run: the API takes no time) ---
  const link = `${base}/modules/travel?space=${space.id}`;
  const talk = [
    [mia, 'Okay, the Demo: Portugal space is open. Ten days, three cities.'],
    [sam, 'Finally. Is the flight booked yet?'],
    [mia, 'Booked, seats 23A to C. Check the Planner.'],
    [lee, `Found it. Day one is just the flight: ${link}`],
    [sam, '> Day one is just the flight\nGood, we can pack in the morning.'],
    [lee, 'Did anyone look at the hotel in Lisbon?'],
    [mia, 'Casa do Largo, five nights, ten minutes from Rossio. Breakfast from 7:30.'],
    [sam, 'Perfect for the Sintra train.'],
    [lee, 'Poll time: manual or automatic for the rental car. I vote automatic, the hills in Porto are steep.'],
    [sam, 'Automatic. Voted.'],
    [mia, 'Adding the Fado night on day 3. Dinner is included.'],
    [lee, '> Dinner is included\nThen skip the late lunch that day.'],
    [sam, 'Budget check: we are at about 4,200 of 6,500 euros with everything planned.'],
    [mia, 'Good. Keep 300 for small things.'],
    [lee, 'Pena Palace tickets are timed. I will book for 10:45.'],
    [sam, 'Thanks Lee. I will buy the Sintra train tickets this week.'],
    [mia, 'Reminder: exchange some euros before the trip.'],
    [lee, 'Is anyone bringing a power bank?'],
    [sam, 'I have one. Bringing two cables.'],
    [mia, 'Weekly call Thursday at 7, fifteen minutes.'],
    [lee, 'I will be there. Also, the Douro day needs the rental car; pick-up is the evening before.'],
    [sam, '> pick-up is the evening before\nGot it, and drop-off at the airport on the last morning.'],
    [mia, 'Everything for the trip is in the Planner, Places and To-do. Add what you find.'],
    [lee, 'Added three places near the hotel to Places.'],
    [sam, 'Great. Two months and we are in Lisbon.'],
  ];
  const who = { [mia]: 'mia', [lee]: 'lee', [sam]: 'sam' };
  let posted = 0;
  for (const [key, text] of talk) {
    const r = await call(who[key], 'POST', `/api/spaces/${space.id}/chat`, { text });
    if (r.status >= 300) throw new SeedError(`Chat post answered ${r.status}: ${r.json && r.json.error}`);
    posted += 1;
  }
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
  const count = async (module, prefix) => ((await ok('admin', 'GET', `/api/modules/${module}/data?scope=space&space=${space.id}&prefix=${encodeURIComponent(prefix)}`)).items || []).length;
  const planRows = ((await ok('admin', 'GET', `/api/modules/travel/data?scope=space&space=${space.id}&prefix=plan:`)).items || []).map((i) => i.value);
  const counts = {
    planner: planRows.length,
    plannerOwn: plan.length,
    places: await count('places', 'place:'),
    calendar: await count('calendar', 'event:'),
    todo: await count('todo', 'task:'),
    polls: await count('polls', 'poll:'),
    budget: await count('budget', 'cost:'),
    research: (await count('research', 'note:')) + (await count('research', 'link:')) + (await count('research', 'answer:')),
    chat: posted + aiDone * 2,
  };
  const settings = (await ok('admin', 'GET', '/api/settings')).settings;
  const mapReason = settings.topBarReasons && settings.topBarReasons.map;
  return { space, S, users, pass, guestUrl, counts, plan, mapReason, aiDone, planRows };
}

// ---------------------------------------------------------------------------------------------------------------------
async function main() {
  const base = resolveTarget();
  console.log(`Using the server at ${base}.`);
  const today = process.env.SEED_TODAY || new Date().toISOString().slice(0, 10);
  const r = await runSeed({ base, login: process.env.ADMIN_LOGIN || 'admin', adminPassword: process.env.ADMIN_PASSWORD, today, allowHosted: process.env.DEMO_ALLOW_HOSTED === '1', noAi: process.env.SEED_NO_AI === '1' });
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
  if (r.mapReason) console.log('  The Map is on, but there is no map file yet. To get a small Lisbon, Sintra and Porto map, run: npm run seed:demo-map');
  console.log('  To reset: run npm run seed:demo again. It removes and rebuilds only this space and the three demo people.');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e instanceof SeedError ? e.message : `seed:demo failed: ${e.stack || e}`); process.exit(1); });
}
