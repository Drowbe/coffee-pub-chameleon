// The fixed data tools/shots.mjs takes its screenshots of (documentation/plans/plan-design-system.md, step 1).
//
// Two seeds live here, chosen by `--seed=` in tools/shots.mjs: SEEDS.travel (seedServer, seedChat; the default) and SEEDS.games
// (seedGames, seedGamesChat; the games template, plan-template-games.md, "The seed for the product page screenshots"). Each is
// { seed(call) -> { trip, second, users, ... }, chat(dataDir, ids) }; the games one also answers `key`, the stream key, for the OBS view.
//
// seedServer(call) fills a throwaway server through its API: the travel template, an admin and two members, three modules'
// worth of everything (Planner, Maps, To-do, Polls, Calendar, Budget, Research), two trips, the phases with fixed dates.
// seedChat(dataDir, ids) then writes the chat (an AI answer with suggestion cards, a message with a link card, ordinary
// messages) straight into DATA_DIR, because the AI and the link reader are not available here. Run with the server stopped
// and with tools/shots-clock.cjs preloaded, so the message times are the same fixed day as the server's.
//
// Every date is fixed (the server's clock starts on 2026-10-15, see shots-clock.cjs, and the page's clock is frozen on the
// same day), so two runs hold the same data. Ids that the server makes (a trip's id, an object's id) differ from run to run
// and are never drawn.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const TODAY = '2026-10-15';
export const PASSWORD = 'testpass1234';
const day = (n) => { const d = new Date(`${TODAY}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export { day };

const MODULES = ['travel', 'maps', 'todo', 'polls', 'calendar', 'budget', 'research', 'assistant', 'stream'];

// `call(method, url, body, as)` answers { status, json }; `as` is 'admin' or a member's login. Throws on an unexpected refusal.
export async function seedServer(call) {
  const ok = async (method, url, body, as = 'admin') => {
    const r = await call(method, url, body, as);
    if (r.status >= 300) throw new Error(`seed: ${method} ${url} answered ${r.status}: ${JSON.stringify(r.json)}`);
    return r.json;
  };
  await ok('PATCH', '/api/settings', { template: 'travel' });
  await ok('PATCH', '/api/settings', { showCalendar: true });
  const users = {};
  for (const [login, displayName] of [['mia', 'Mia Alvarez'], ['sam', 'Sam Okafor'], ['lee', 'Lee Chen']]) {
    const made = await ok('POST', '/api/users', { login, displayName, role: 'member', password: PASSWORD });
    users[login] = made.user.key;
  }
  // Research and the Assistant need the AI service on; a key and a model are enough, nothing is ever asked of it here.
  await ok('PUT', '/api/ai', { source: 'custom', provider: 'openai', key: 'sk-shots-not-a-real-key', model: 'gpt-4o-mini', enabled: true });
  for (const id of MODULES) {
    const had = await call('POST', `/api/modules/bundled/${id}/install`, undefined, 'admin');
    if (had.status >= 300 && !/already installed/.test(JSON.stringify(had.json))) throw new Error(`seed: installing ${id} answered ${had.status}: ${JSON.stringify(had.json)}`);
    await ok('PATCH', `/api/modules/${id}`, { enabled: true });
  }
  const trip = (await ok('POST', '/api/spaces', { name: 'Lisbon in autumn', description: 'Ten days of trams, tiles and custard tarts.', members: [users.mia, users.sam] })).space;
  const second = (await ok('POST', '/api/spaces', { name: 'Kyoto in spring', description: 'Blossom season, if we are lucky.', members: [users.mia] })).space;
  await ok('POST', '/api/spaces', { name: 'Weekend in the Algarve', members: [users.sam] });
  await ok('PATCH', `/api/users/${users.mia}/spaces/${trip.id}`, { permissions: { moderator: true } });
  // The phases, on fixed days, whatever phases the template holds: the first starts a month before today, the ones before the main
  // phase follow at even steps, the main phase runs from day 10 to day 19 and the next phase starts the day after.
  const phaseList = (await ok('GET', '/api/branding')).phases || [];
  const main = Math.max(0, phaseList.findIndex((p) => p.main));
  const dates = {};
  phaseList.forEach((p, i) => {
    if (i < main) dates[p.id] = { start: day(-30 + Math.floor((38 * i) / main)) };
    else if (i === main) dates[p.id] = { start: day(10), end: day(19) };
    else if (i === main + 1) dates[p.id] = { start: day(20) };
  });
  if (phaseList.length) await ok('PATCH', `/api/spaces/${trip.id}`, { phases: dates });

  const put = (module, key, value, space = trip.id, as = 'admin') => ok('PUT', `/api/modules/${module}/data/${encodeURIComponent(key)}?scope=space&space=${space}`, { value }, as);
  const by = 'Mia Alvarez';

  // --- Planner: a trip, and one object of each kind on its days.
  await put('travel', 'trip:main', { title: 'Lisbon in autumn', start: day(10), end: day(19) });
  const plan = [
    ['a1', { kind: 'journey', mode: 'flight', title: 'Flight to Lisbon', date: day(10), time: '07:40', minutes: 175, operator: 'TAP Air Portugal', number: 'TP 205', fromCode: 'JFK', toCode: 'LIS', terminal: '1', gate: 'B22', seat: '14A', travelClass: 'Economy', confirm: 'QX81ZP', cost: 612, owners: [users.mia], order: 1 }],
    ['a2', { kind: 'journey', mode: 'train', title: 'Train to Sintra', date: day(12), time: '09:15', minutes: 40, operator: 'CP', fromCode: '', toCode: '', platform: '3', order: 1 }],
    ['a3', { kind: 'stay', type: 'hotel', title: 'Hotel Avenida Palace', date: day(10), checkOut: day(15), time: '15:00', checkOutTime: '11:00', address: 'Praca dos Restauradores', roomType: 'Double', guests: 2, confirm: 'HAP-4471', cost: 880, order: 2 }],
    ['a4', { kind: 'stop', type: 'restaurant', title: 'Dinner at Taberna da Rua', date: day(10), time: '20:00', minutes: 90, place: 'Taberna da Rua', address: 'Rua das Flores 18', partySize: 3, reservationName: 'Alvarez', owners: [users.mia, users.sam], estimate: 120, order: 3 }],
    ['a5', { kind: 'stop', type: 'museum', title: 'Tile Museum', date: day(11), time: '10:30', minutes: 120, place: 'Museu Nacional do Azulejo', admissionCount: 3, order: 1 }],
    ['a6', { kind: 'stop', type: 'cafe', title: 'Pastries in Belem', date: day(11), time: '15:00', minutes: 45, place: 'Pasteis de Belem', done: true, order: 2 }],
    ['a7', { kind: 'note', title: 'Bring a rain jacket', date: day(11), notes: 'Forecast says showers on the second afternoon. The trams are slippery when wet.', order: 3 }],
    ['a8', { kind: 'block', type: 'free', title: 'Free time', date: day(12), time: '14:00', minutes: 120, order: 2 }],
    ['a9', { kind: 'stop', type: 'sight', title: 'Castelo de Sao Jorge', date: day(12), time: '17:00', minutes: 90, order: 3, pinned: true }],
    ['a10', { kind: 'lane', type: 'rest', title: 'Rest day', after: day(12), order: 1 }],
    ['a11', { kind: 'link', title: 'Tram 28', date: day(13), ref: { module: 'maps', kind: 'place', id: 'p1', scope: 'space', space: trip.id }, order: 1 }],
    ['a12', { kind: 'stop', type: 'restaurant', title: 'Lunch near the market', date: day(13), time: '13:00', minutes: 60, order: 2, notes: 'Conflicts with the tour below.' }],
    ['a14', { kind: 'stop', type: 'show', title: 'Fado night', date: day(14), time: '21:00', minutes: 120, admissionCount: 3, gate: 'Door B', confirm: 'FD-22', order: 1 }],
    ['a15', { kind: 'journey', mode: 'bus', title: 'Airport shuttle bus', date: day(19), time: '10:00', minutes: 40, to: 'Humberto Delgado Airport', operator: 'Aerobus', order: 1 }],
    ['a13', { kind: 'stop', type: 'tour', title: 'Tuk-tuk tour', date: day(13), time: '13:30', minutes: 120, order: 3 }],
  ];
  for (const [id, v] of plan) await put('travel', `plan:${id}`, { by, ...v });

  // --- Places (kept by Maps)
  const places = [
    ['p1', { title: 'Tram 28 stop, Martim Moniz', category: 'transport', address: 'Largo Martim Moniz', point: { lat: 38.7167, lng: -9.1359 }, notes: 'Get there before 9 to find a seat.', owners: [users.mia] }],
    ['p2', { title: 'Time Out Market', category: 'food', status: 'want', address: 'Av. 24 de Julho 49', point: { lat: 38.7066, lng: -9.1459 }, notes: 'Lots of stalls, one bench for three.', owners: [] }],
    ['p3', { title: 'Miradouro da Senhora do Monte', category: 'sights', address: 'Largo Monte', point: { lat: 38.7203, lng: -9.1329 }, notes: '', owners: [users.sam] }],
    ['p4', { title: 'Cabo da Roca', category: 'nature', address: 'Colares', point: { lat: 38.7804, lng: -9.4989 }, notes: 'The westernmost point of mainland Europe.', owners: [] }],
    ['p5', { title: 'A bookshop with a cat', category: 'shopping', address: 'Rua Anchieta 4', point: { lat: 38.7108, lng: -9.1417 }, notes: '', owners: [] }],
  ];
  for (const [id, v] of places) await put('maps', `place:${id}`, { address: '', notes: '', owners: [], by, ...v });

  // --- To-do
  const tasks = [
    ['t1', { title: 'Book the Sintra train', notes: 'Tickets are cheaper online.', due: day(2) }],
    ['t2', { title: 'Exchange some euros', notes: '', due: day(5), remind: true }],
    ['t3', { title: 'Download offline maps', notes: '', due: null }],
    ['t4', { title: 'Renew passport', notes: 'Done in September.', due: day(-20), done: true, doneAt: Date.parse(`${day(-18)}T10:00:00Z`) }],
    ['t5', { title: 'Pack adapters', notes: '', due: day(9) }],
  ];
  for (const [id, v] of tasks) await put('todo', `task:${id}`, { id, remind: false, done: false, doneAt: null, createdAt: Date.parse(`${day(-12)}T10:00:00Z`), by, links: [], autoDone: false, ...v });

  // --- Polls
  const polls = [
    ['q1', { question: 'Where do we eat on the first night?', options: [{ id: 'o1', text: 'Taberna da Rua' }, { id: 'o2', text: 'Time Out Market' }, { id: 'o3', text: 'Somewhere near the hotel', desc: 'We will be tired.' }], multi: false, addable: true, closed: false, closesAt: null, createdAt: Date.parse(`${day(-5)}T10:00:00Z`), by, byKey: users.mia }],
    ['q2', { question: 'Which days for the day trip?', options: [{ id: 'o1', text: 'Sintra', date: day(12) }, { id: 'o2', text: 'Cascais', date: day(14) }], multi: true, addable: false, closed: true, closesAt: null, createdAt: Date.parse(`${day(-9)}T10:00:00Z`), by: 'Sam Okafor', byKey: users.sam }],
  ];
  for (const [id, v] of polls) await put('polls', `poll:${id}`, { id, ...v });
  // A vote is its voter's own (the Polls guards): each is put by the person who cast it.
  await put('polls', `vote:q1:${users.mia}`, { options: ['o1'], name: 'Mia Alvarez', at: Date.parse(`${day(-4)}T10:00:00Z`) }, trip.id, 'mia');
  await put('polls', `vote:q1:${users.sam}`, { options: ['o2'], name: 'Sam Okafor', at: Date.parse(`${day(-4)}T11:00:00Z`) }, trip.id, 'sam');

  // --- Calendar
  const events = [
    ['e1', { title: 'Passport photos', allDay: false, start: `${day(1)}T16:00:00.000Z`, end: `${day(1)}T16:30:00.000Z`, desc: '', remind: null, repeat: null }],
    ['e2', { title: 'Pack the suitcases', allDay: true, start: day(9), end: null, desc: '', remind: null, repeat: null }],
    ['e3', { title: 'Trip', allDay: true, start: day(10), end: day(19), desc: 'Lisbon and Sintra.', remind: null, repeat: null }],
    ['e4', { title: 'Weekly planning call', allDay: false, start: `${day(-3)}T19:00:00.000Z`, end: `${day(-3)}T19:45:00.000Z`, desc: '', remind: 15, repeat: { every: 'week', until: null } }],
    ['e5', { title: 'Farewell dinner', allDay: false, start: `${day(18)}T20:00:00.000Z`, end: null, desc: 'At the hotel.', remind: null, repeat: null }],
  ];
  for (const [id, v] of events) await put('calendar', `event:${id}`, { id, by, ...v });

  // --- Budget
  const costs = [
    ['c1', { title: 'Flights', category: 'transport', categoryName: 'Transport', planned: 1250, actual: 1224, amount: 1224, paidBy: users.mia, sharedBy: [users.mia, users.sam], date: day(-8) }],
    ['c2', { title: 'Hotel Avenida Palace', category: 'stay', categoryName: 'Stay', planned: 900, actual: 880, amount: 880, paidBy: users.sam, sharedBy: [users.mia, users.sam], date: day(-6) }],
    ['c3', { title: 'Dinners', category: 'food', categoryName: 'Food', planned: 600, amount: 600, paidBy: '', sharedBy: [], date: '' }],
    ['c4', { title: 'Museum tickets', category: 'activities', categoryName: 'Activities', planned: 90, amount: 90, paidBy: '', sharedBy: [], date: day(11) }],
  ];
  for (const [id, v] of costs) await put('budget', `cost:${id}`, { notes: '', by, ...v });

  // --- Research
  await put('research', 'note:n1', { title: 'Where to eat near the hotel', body: 'Three places the neighbours recommended, all within ten minutes.', tags: ['food'], icon: 'utensils', by, at: Date.parse(`${day(-7)}T10:00:00Z`) });
  await put('research', 'link:l1', { title: 'Lisbon tram guide', url: 'https://example.com/lisbon-trams', excerpt: 'Which lines are worth the ride, and when to avoid the crowds.', tags: [], by, at: Date.parse(`${day(-6)}T10:00:00Z`) });
  return { trip, second, users };
}

// The chat, written to DATA_DIR/chat.json and chat-private.json while the server is stopped: the same talk in Home's chat
// (the Lobby, the only chat a page can show without a call) and in the trip's.
export function seedChat(dataDir, { tripId, users }) {
  const { ChatHistory } = require(path.join(root, 'server', 'chat-history.js'));
  const h = new ChatHistory(dataDir);
  const at = (hh, mm) => Date.parse(`${TODAY}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
  for (const spaceId of ['lobby', tripId]) {
    const say = (key, who, text, when, extra = {}) => h.add(spaceId, { by: key, who, text, at: when, ...extra });
    say(users.mia, 'Mia Alvarez', 'I found a hotel near the square. Want to see it?', at(7, 40));
    say(users.sam, 'Sam Okafor', 'Yes please. Is breakfast included?', at(7, 44));
    const link = say(users.mia, 'Mia Alvarez', 'Here is the one I mean: https://example.com/avenida-palace', at(7, 50), { link: 'https://example.com/avenida-palace' });
    h.setPreview(spaceId, link.id, 'research', { title: 'Hotel Avenida Palace', description: 'A grand old hotel by Restauradores Square, with a tiled lobby and a breakfast hall.', at: at(7, 51) });
    say(users.mia, 'Mia Alvarez', 'What should we see on the second day?', at(8, 10), { kind: 'command', command: 'ai', visibility: 'private' });
    say(users.mia, 'Mia Alvarez',
      'The second day suits the old town. Start with this:\n\n{{summary:0}}\n\nThen, for lunch, **one good idea**:\n\n{{summary:1}}\n\nBook ahead if you can.',
      at(8, 11), {
        kind: 'ai',
        summaries: [
          { title: 'Tile Museum', kind: 'museum', description: 'Five hundred years of azulejos, in a former convent.', place: { name: 'Museu Nacional do Azulejo' }, date: day(11), tags: ['museum'], icon: 'landmark' },
          { title: 'Lunch at Cervejaria Ramiro', kind: 'restaurant', description: 'Seafood, loud and busy. Go early.', place: { name: 'Cervejaria Ramiro' }, date: day(11), tags: ['food'], icon: 'utensils' },
        ],
      });
    say(users.sam, 'Sam Okafor', 'That sounds good. I will add it to the plan.', at(8, 30));
    say(users.sam, 'Sam Okafor', '/poll Where do we eat on the first night?', at(8, 35), { kind: 'command', command: 'poll', module: 'polls' });
  }
  h.flush();
}

// ---------------------------------------------------------------------------------------------------------------------
// The games seed (plan-template-games.md): the games template, the admin as game master and three players, two campaigns.
// Invented names throughout; nothing from a published game. Same fixed day as the travel seed, 2026-10-15, a Thursday.
// ---------------------------------------------------------------------------------------------------------------------
const GAMES_MODULES = ['travel', 'todo', 'polls', 'calendar', 'research', 'stream'];

// A Character picture for a player: tools/fixtures/shots-games/<login>.png when experience-design has drawn one, else a flat
// stand-in (a head and shoulders in the player's colour on a clear ground) so the OBS view has something to show. Deterministic.
const CHARACTER_COLOURS = { mia: [0xc2, 0x5b, 0x3a], sam: [0x3a, 0x7c, 0xa5], lee: [0x6a, 0x8f, 0x3d] };
const crcLookup = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcLookup[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function standInPng(rgb) {
  const w = 192; const h = 256;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const head = (x - 96) ** 2 + (y - 90) ** 2 <= 46 ** 2;
      const body = y >= 150 && ((x - 96) / 80) ** 2 + ((y - 256) / 106) ** 2 <= 1;
      const o = y * (w * 4 + 1) + 1 + x * 4;
      if (head || body) { raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; raw[o + 3] = 255; }
    }
  }
  const chunk = (type, data) => { const t = Buffer.from(type, 'latin1'); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const characterPicture = (login) => {
  const drawn = path.join(root, 'tools', 'fixtures', 'shots-games', `${login}.png`);
  return fs.existsSync(drawn) ? fs.readFileSync(drawn) : standInPng(CHARACTER_COLOURS[login]);
};

// `call` as for seedServer; a Buffer body is sent as it is, as a PNG (see tools/shots.mjs).
export async function seedGames(call) {
  const ok = async (method, url, body, as = 'admin') => {
    const r = await call(method, url, body, as);
    if (r.status >= 300) throw new Error(`seed: ${method} ${url} answered ${r.status}: ${JSON.stringify(r.json)}`);
    return r.json;
  };
  await ok('PATCH', '/api/settings', { template: 'games' });
  const users = {};
  for (const [login, displayName] of [['mia', 'Mia Alvarez'], ['sam', 'Sam Okafor'], ['lee', 'Lee Chen']]) {
    const made = await ok('POST', '/api/users', { login, displayName, role: 'member', password: PASSWORD });
    users[login] = made.user.key;
  }
  // Research needs the AI service on; a key and a model are enough, nothing is ever asked of it here.
  await ok('PUT', '/api/ai', { source: 'custom', provider: 'openai', key: 'sk-shots-not-a-real-key', model: 'gpt-4o-mini', enabled: true });
  for (const id of GAMES_MODULES) {
    const had = await call('POST', `/api/modules/bundled/${id}/install`, undefined, 'admin');
    if (had.status >= 300 && !/already installed/.test(JSON.stringify(had.json))) throw new Error(`seed: installing ${id} answered ${had.status}: ${JSON.stringify(had.json)}`);
    await ok('PATCH', `/api/modules/${id}`, { enabled: true });
  }
  // Each player's Character picture, for the OBS view: the Online one and the Offline one (no call here, so the box shows the Offline one).
  for (const login of Object.keys(users)) {
    const png = characterPicture(login);
    for (const slot of ['character', 'characterOffline']) await ok('PUT', `/api/users/${users[login]}/images/${slot}`, png);
  }
  const campaign = (await ok('POST', '/api/spaces', { name: 'The Ashen Crown', description: 'A long campaign of ruined gates, quiet oaths and one stolen crown.', members: [users.mia, users.sam, users.lee] })).space;
  const oneShot = (await ok('POST', '/api/spaces', { name: 'The Lantern Fair', description: 'A one-shot for a single evening.', members: [users.mia, users.sam] })).space;
  await ok('PATCH', `/api/users/${users.mia}/spaces/${campaign.id}`, { permissions: { moderator: true } });

  const put = (module, key, value, space = campaign.id, as = 'admin') => ok('PUT', `/api/modules/${module}/data/${encodeURIComponent(key)}?scope=space&space=${space}`, { value }, as);
  const by = 'Admin';

  // --- The Campaign planner: the campaign's span, and four objects of its own on fixed days. The Sessions, the Quests with
  // due dates and the open poll join the timeline by themselves.
  await put('travel', 'trip:main', { title: 'The Ashen Crown', start: day(0), end: day(14) });
  const plan = [
    ['a1', { kind: 'note', title: 'Recap of session 13', date: day(0), notes: 'The party crossed the marsh, lost a mule and found the abbey door open. Mia kept the silver key.', order: 1 }],
    ['a2', { kind: 'stop', type: 'sight', title: 'The Ashen Gate', date: day(7), time: '19:30', minutes: 60, notes: 'A burnt gate that still smells of smoke.', order: 1 }],
    ['a3', { kind: 'stop', type: 'bar', title: 'The Drowned Lantern', date: day(7), time: '21:00', minutes: 90, notes: 'The cartographer drinks here on Thursdays.', order: 2 }],
    ['a4', { kind: 'note', title: 'Bring the map for the vault', date: day(14), notes: 'Everyone brings a pencil. The vault map is on the back of the recap.', order: 1 }],
  ];
  for (const [id, v] of plan) await put('travel', `plan:${id}`, { by, ...v });

  // --- Sessions (Calendar): every Thursday night from the first of the month, so the last two are done and the next two ahead.
  const night = (n, h = 19) => `${day(n)}T${String(h).padStart(2, '0')}:00:00.000Z`;
  await put('calendar', 'event:e1', { id: 'e1', by, title: 'Game night', allDay: false, start: night(-14), end: night(-14, 22), desc: 'The Ashen Crown, every Thursday.', remind: 60, repeat: { every: 'week', until: null } });

  // --- Polls
  await put('polls', 'poll:q1', { id: 'q1', question: 'Which night for session 14?', options: [{ id: 'o1', text: 'Thursday', date: day(7) }, { id: 'o2', text: 'Friday', date: day(8) }, { id: 'o3', text: 'Saturday', date: day(9) }], multi: true, addable: false, closed: false, closesAt: null, createdAt: Date.parse(`${day(-2)}T10:00:00Z`), by: 'Mia Alvarez', byKey: users.mia });
  await put('polls', `vote:q1:${users.mia}`, { options: ['o1', 'o2'], name: 'Mia Alvarez', at: Date.parse(`${day(-1)}T10:00:00Z`) }, campaign.id, 'mia');
  await put('polls', `vote:q1:${users.sam}`, { options: ['o1'], name: 'Sam Okafor', at: Date.parse(`${day(-1)}T11:00:00Z`) }, campaign.id, 'sam');
  await put('polls', `vote:q1:${users.lee}`, { options: ['o1', 'o3'], name: 'Lee Chen', at: Date.parse(`${day(-1)}T12:00:00Z`) }, campaign.id, 'lee');

  // --- Quests (To-do): five, two done, with due dates.
  const quests = [
    ['t1', { title: 'Find the cartographer in Vael', notes: 'She drinks at the Drowned Lantern.', due: day(7) }],
    ['t2', { title: 'Return the silver key to the abbey', notes: '', due: day(13), remind: true }],
    ['t3', { title: 'Scout the Ashen Gate', notes: 'Look for another way in.', due: day(6) }],
    ['t4', { title: "Free the prisoner at Crow's Ford", notes: 'Done in session 12.', due: day(-8), done: true, doneAt: Date.parse(`${day(-7)}T21:00:00Z`) }],
    ['t5', { title: 'Win the duel at the Drowned Lantern', notes: 'Sam won, barely.', due: day(-1), done: true, doneAt: Date.parse(`${day(-1)}T21:30:00Z`) }],
  ];
  for (const [id, v] of quests) await put('todo', `task:${id}`, { id, remind: false, done: false, doneAt: null, createdAt: Date.parse(`${day(-12)}T10:00:00Z`), by, links: [], autoDone: false, ...v });

  // --- Lore (Research): a place, a person, a rumour, a house rule, with tags.
  const lore = [
    ['n1', { title: 'The Ashen Gate', body: 'The north gate of Vael, burnt in the old war. The guards will not talk about it.', tags: ['place', 'vael'], icon: 'landmark', at: Date.parse(`${day(-9)}T10:00:00Z`) }],
    ['n2', { title: 'Odessa Quill', body: 'A cartographer who owes the crown a map and the party a favour.', tags: ['person', 'vael'], icon: 'user', at: Date.parse(`${day(-8)}T10:00:00Z`) }],
    ['n3', { title: 'The crown is not in the vault', body: 'Heard at the Drowned Lantern: the vault was emptied a year before the fire.', tags: ['rumour'], icon: 'comment', at: Date.parse(`${day(-5)}T10:00:00Z`) }],
    ['n4', { title: 'House rule: one reroll per night', body: 'Each player may reroll one die per session. Say so before the dice stop.', tags: ['rules'], icon: 'scale-balanced', at: Date.parse(`${day(-20)}T10:00:00Z`) }],
  ];
  for (const [id, v] of lore) await put('research', `note:${id}`, { by, ...v });

  const key = (await ok('GET', '/api/settings')).streamKey;
  return { trip: campaign, second: oneShot, users, key };
}

// The chat, written to DATA_DIR while the server is stopped: in-character talk with a link card and an Assistant answer, in the
// Common room (the Lobby) and in the campaign.
export function seedGamesChat(dataDir, { tripId, users }) {
  const { ChatHistory } = require(path.join(root, 'server', 'chat-history.js'));
  const h = new ChatHistory(dataDir);
  const at = (hh, mm) => Date.parse(`${TODAY}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
  for (const spaceId of ['lobby', tripId]) {
    const say = (key, who, text, when, extra = {}) => h.add(spaceId, { by: key, who, text, at: when, ...extra });
    say(users.mia, 'Mia Alvarez', 'I keep the silver key. Nobody touch the abbey door until Thursday.', at(7, 40));
    say(users.sam, 'Sam Okafor', 'Too late. My character already knocked.', at(7, 44));
    const link = say(users.lee, 'Lee Chen', 'The map I mean is this one: https://example.com/vael-map', at(7, 50), { link: 'https://example.com/vael-map' });
    h.setPreview(spaceId, link.id, 'research', { title: 'A map of Vael', description: 'The old town, its four gates and the river that floods the lower streets.', at: at(7, 51) });
    say(users.mia, 'Mia Alvarez', 'Where does the cartographer drink?', at(8, 10), { kind: 'command', command: 'ai', visibility: 'private' });
    say(users.mia, 'Mia Alvarez',
      'From the lore you saved, she drinks at the Drowned Lantern on Thursdays:\n\n{{summary:0}}\n\nThe gate is worth a look first:\n\n{{summary:1}}',
      at(8, 11), {
        kind: 'ai',
        summaries: [
          { title: 'Odessa Quill', kind: 'note', description: 'A cartographer who owes the crown a map and the party a favour.', date: day(7), tags: ['person'], icon: 'user' },
          { title: 'The Ashen Gate', kind: 'sight', description: 'The north gate of Vael, burnt in the old war.', place: { name: 'The Ashen Gate' }, date: day(7), tags: ['place'], icon: 'landmark' },
        ],
      });
    say(users.sam, 'Sam Okafor', 'Thursday, then. I will bring snacks.', at(8, 30));
    say(users.lee, 'Lee Chen', '/poll Which night for session 14?', at(8, 35), { kind: 'command', command: 'poll', module: 'polls' });
  }
  h.flush();
}

export const SEEDS = {
  travel: { seed: seedServer, chat: seedChat },
  games: { seed: seedGames, chat: seedGamesChat },
};
export const seedChatFor = (name, dataDir, ids) => SEEDS[name].chat(dataDir, ids);
