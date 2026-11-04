// Chat's one input: ordinary messages, module commands (a short or a full word), the Assistant's questions, and paste import.
// Chat never names a module; commands and Keep actions come from the space APIs.

const OBJECT_MIME = 'application/x-host-object';
// A kind as a person counts it, one and many: a `hotel` is any stay (plan-object-handoff.md, "Kinds and their details").
const KIND_WORDS = {
  bus: ['bus', 'buses'], ferry: ['ferry', 'ferries'], hotel: ['stay', 'stays'],
};
const kindWord = (kind, n) => (KIND_WORDS[kind] ? KIND_WORDS[kind][n === 1 ? 0 : 1] : n === 1 ? kind : `${kind}s`);

function oneLine(s, n) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
}

function keptText(summary, { question, sourceNames } = {}) {
  const imported = summary && summary.basis === 'imported';
  const extras = [];
  if (!imported) {
    const q = String(question || '').trim();
    const names = (sourceNames || []).filter(Boolean);
    if (q) extras.push(`Asked: ${q}`);
    if (names.length) extras.push(`From: ${names.join(', ')}`);
  }
  const links = (summary && summary.links) || [];
  if (links.length) {
    extras.push('Links:');
    for (const l of links) extras.push(`- ${l.title}: ${l.url}`);
  }
  if (imported) extras.push('External source');
  const suffix = extras.length ? `\n\n${extras.join('\n')}` : '';
  const details = detailLines(summary && summary.details).join('\n');
  let content = [String((summary && summary.content) || '').trim(), details].filter(Boolean).join('\n\n');
  if (content.length + suffix.length > 8000) content = content.slice(0, Math.max(0, 8000 - suffix.length - 1)) + '…';
  return content + suffix;
}

// An object's details as "Label: value" lines after its content, for a keeper that declares no `takes` and so cannot map
// them into its own fields (plan-object-handoff.md, "Nothing is lost"). The label is the field's name in words ("checkIn" is
// "Check in"). A keeper that takes the object gets the object itself (objectKeepInput).
export function detailLines(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return [];
  const label = (name) => {
    const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  };
  const shown = (v) => {
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? v.replace('T', ' ') : v;
    if (Array.isArray(v)) return v.filter((o) => typeof o === 'string').join(', ');
    if (v && typeof v === 'object') return v.name && v.code ? `${v.name} (${v.code})` : String(v.name || v.code || '');
    return '';
  };
  const lines = [];
  for (const [name, v] of Object.entries(details)) {
    if (name === 'upload') continue;
    const text = oneLine(shown(v), 300);
    if (text) lines.push(`${label(name)}: ${text}`);
  }
  return lines;
}

export function keepInput(summary, question) {
  return {
    title: oneLine((summary && summary.title) || '', 120) || 'Untitled',
    body: keptText(summary, { question }),
    tags: ((summary && summary.tags) || []).join(', '),
    icon: (summary && summary.icon) || '',
    kind: (summary && summary.kind) || '',
  };
}

export function suggestionInput(summary) {
  return {
    title: oneLine((summary && summary.title) || '', 120) || 'Untitled',
    kind: (summary && summary.kind) || '',
    content: keptText(summary, {}),
    place: (summary && summary.place && summary.place.name) || '',
    date: (summary && summary.date) || '',
  };
}

// The kinds an older typed keeper (acceptSuggestion with no `takes`) gets (plan-object-handoff.md, "Migration"): a copy
// of TRAVEL_KINDS in server/object-format.js, held equal by tools/check-chat-page.mjs. Every other kind goes to an older
// note keeper. A module that declares `takes` is found by it instead (keepTargets).
export const TRAVEL_KINDS = ['flight', 'train', 'bus', 'ferry', 'car', 'hotel', 'restaurant', 'cafe', 'bar', 'sight', 'museum', 'attraction', 'tour', 'show'];

// Which older keeper (one with no `takes`) an object goes to: the typed one for a travel kind when there is one, else
// the note keeper.
export function keeperFor(summary, { note, suggestion } = {}) {
  return (summary && TRAVEL_KINDS.includes(summary.kind) && suggestion) ? suggestion : note;
}

// Whether an action's `takes` (GET /api/spaces/:id/actions) takes an object of this kind: the same rule as takersOf in
// server/object-format.js. A kind named takes it; "*" takes any kind but a picture and those in `except`; with no kind,
// "*" or "text" (a message's words) does.
export function takesKind(takes, kind) {
  return (Array.isArray(takes) ? takes : []).some((e) => {
    const kinds = Array.isArray(e && e.kinds) ? e.kinds : [];
    if (!kind) return kinds.includes('*') || kinds.includes('text');
    if (kinds.includes(kind)) return true;
    return kinds.includes('*') && kind !== 'image' && !(Array.isArray(e.except) && e.except.includes(kind));
  });
}

// The input of a keeper that takes this object whole (its input of type "object"), or '' when it declares no `takes` for
// the object's kind and gets the older flat fields instead.
export function objectInputOf(action, summary) {
  if (!action || !summary || !takesKind(action.takes, summary.kind)) return '';
  const entry = Object.entries(action.input || {}).find(([, type]) => String(type).replace(/\?$/, '') === 'object');
  return entry ? entry[0] : '';
}

// What Keep sends a keeper that takes the object: the object as the format has it (its details too), which the bus checks
// again and the module maps into its own fields; and the title, for an action that also asks for one on its own. An AI
// answer's question ends its content as "Asked: ...", as keepInput writes it for a keeper of flat fields (never for an import).
export function objectKeepInput(action, field, summary, question) {
  const object = { title: oneLine(summary.title, 120) || 'Untitled' };
  for (const key of ['kind', 'icon', 'content', 'details', 'date', 'tags', 'place', 'links', 'basis']) {
    if (summary[key] !== undefined && summary[key] !== null && summary[key] !== '') object[key] = summary[key];
  }
  const asked = summary.basis === 'imported' ? '' : oneLine(question, 1000);
  if (asked) {
    const content = String(object.content || '').trim();
    const line = `Asked: ${asked}`;
    object.content = [content.length + line.length + 2 > 6000 ? `${content.slice(0, Math.max(0, 6000 - line.length - 3))}…` : content, line].filter(Boolean).join('\n\n');
  }
  return { ...(action.input && action.input.title ? { title: object.title } : {}), [field]: object };
}

// The older keepers, found by name, for a module that declares no `takes` (plan-object-handoff.md, "What modules declare").
function findKeepers(actions) {
  const note = actions.find((a) => a.name === 'saveNote' && a.input && a.input.title && a.input.body);
  const suggestion = actions.find((a) => a.name === 'acceptSuggestion' && a.input && a.input.title && a.input.kind);
  return { note, suggestion };
}

// --- Where an object can be kept (plan-object-handoff.md, "The import preview in Chat") ----------------------------------

// The kinds that happen on a day: journeys, stays, stops, events and tasks. One of these with no day asks for one.
export const DAY_KINDS = [...TRAVEL_KINDS, 'event', 'task'];
const DAY_FIELDS = ['departs', 'checkIn', 'starts', 'due'];
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// Whether an object has a day: its `date`, or a date in its details (when it leaves, checks in, starts or is due).
export function hasDay(summary) {
  if (!summary) return false;
  if (isDay(summary.date)) return true;
  const d = summary.details && typeof summary.details === 'object' ? summary.details : {};
  return DAY_FIELDS.some((f) => typeof d[f] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d[f]));
}

// Whether the preview asks for a day: a kind that has one, and none given.
export function needsDay(summary) {
  return Boolean(summary && DAY_KINDS.includes(summary.kind) && !hasDay(summary));
}

const objectFieldOf = (action) => {
  const entry = Object.entries((action && action.input) || {}).find(([, type]) => String(type).replace(/\?$/, '') === 'object');
  return entry ? entry[0] : '';
};
const firstUrl = (summary) => ((summary && Array.isArray(summary.links) ? summary.links : []).map((l) => l && l.url).find(Boolean) || '');

// Whether Keep can fill an action's other required fields from the object: a title always, an address from its first link.
function fillable(action, field, summary) {
  return Object.entries(action.input || {}).every(([name, type]) => {
    if (name === field || String(type).endsWith('?') || name === 'title') return true;
    return name === 'url' && Boolean(firstUrl(summary));
  });
}

// "a flight", "an event": a kind with its article.
const withArticle = (kind) => `${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind}`;

// How many kinds an action's `takes` names ("*" and "text" are not kinds). Of several actions that name an object's
// kind, the one naming the fewest is the specialist and comes first: a note goes to Research before the Planner, an event
// to the Calendar (unless it reads as travel, eventLooksLikeTravel: then the Planner), a flight to the Planner. Thomas may
// change this rule; it is only this, `eventLooksLikeTravel` and `placeOrder`.
export function namedKindCount(action) {
  const kinds = new Set();
  for (const e of Array.isArray(action && action.takes) ? action.takes : []) {
    for (const k of Array.isArray(e && e.kinds) ? e.kinds : []) if (k !== '*' && k !== 'text') kinds.add(k);
  }
  return kinds.size;
}
// The order of two places: by rank (0 names the kind, 1 the older typed keeper, 2 takes any object, 3 the older note
// keeper, 4 a form on the person's own page that does not name the kind, such as Polls' draft for words with no kind),
// then, among those naming the kind, for an event that reads as travel the one naming travel kinds (`trip`), then the
// specialist; among those taking any object, the note keeper (its `takes` names `note`), then the fewest named kinds;
// then the server's order.
export function placeRank({ named, legacy, typed, local }) {
  if (legacy) return typed ? 1 : 3;
  if (named) return 0;
  return local ? 4 : 2;
}
export function placeOrder(x, y) {
  return x.rank - y.rank
    || (x.rank === 0 ? Number(Boolean(y.trip)) - Number(Boolean(x.trip)) : 0)
    || (x.rank === 2 ? Number(y.note) - Number(x.note) : 0)
    || (x.rank === 0 || x.rank === 2 ? x.span - y.span : 0)
    || x.i - y.i;
}

// Whether an `event` reads as travel (a tour, a transfer, a flight an AI called an event), so its default place is the one
// that names travel kinds (the Planner) rather than the Calendar; `trip` in placeOrder. Only the default changes: the
// Calendar stays in the menu. The rule is a travel word in the title, as a whole word (Unicode-aware, so "Détours" and
// "Trainée" don't count). Only the title: the server keeps no travel details on an event (starts, ends, allDay and
// address; DETAILS.event in server/object-format.js). "Coach" and "transfer" count only when they read as a trip
// ("Coach to Oxford", "Airport transfer", "Transfer to the hotel"), not "Bank transfer" or "Meet the coach". Kept small
// so Thomas can change it here.
const TRAVEL_WORDS = new RegExp('(?<![\\p{L}\\p{N}])(?:' + [
  'tours?', 'excursions?', 'shuttles?', 'flights?', 'trains?', 'ferry', 'ferries', 'cruises?', 'bus', 'buses',
  'taxis?', 'boat trips?', 'day trips?', 'road trips?', 'rental cars?', 'car rentals?', 'car hire',
  'airport (?:pickup|pick-up|drop-off)', 'coach(?:es)? (?:to|from|trip|ride)', '(?:airport|hotel|station|port) transfers?',
  'transfers? (?:to|from)',
].join('|').replace(/ /g, '\\s+') + ')(?![\\p{L}\\p{N}])', 'iu');
export function eventLooksLikeTravel(summary) {
  if (!summary || summary.kind !== 'event') return false;
  return typeof summary.title === 'string' && TRAVEL_WORDS.test(summary.title);
}
// Whether an action names a travel kind (other than `event`): the place a travel-like event goes first.
const namesTravel = (action) => (Array.isArray(action && action.takes) ? action.takes : [])
  .some((e) => Array.isArray(e && e.kinds) && e.kinds.some((k) => TRAVEL_KINDS.includes(k)));

// The places an object can be kept, best first: every action whose `takes` covers its kind (the server's rule, `except`
// included) and that this person may use; a module with no `takes` by the older rule (keeperFor). An action that names
// the kind comes before one that takes any object ("*"), and the older typed keeper sits between them. `needs: ["date"]`
// leaves an action out for an object with no day. `last` (an action id) is the person's last choice for this kind, first.
// Each is { id, action, label, as, module, moduleName, local, legacy, named, field }; `as` is the words after "as" ("a flight").
export function keepTargets(actions, summary, { last = '', objectWord = '' } = {}) {
  const list = (Array.isArray(actions) ? actions : []).filter((a) => a && a.action && a.may !== false);
  const kind = (summary && summary.kind) || '';
  const day = hasDay(summary);
  const travelEvent = eventLooksLikeTravel(summary);
  const out = [];
  list.forEach((a, i) => {
    if (!Array.isArray(a.takes)) return;
    const entries = a.takes.filter((e) => e && e.may !== false && takesKind([e], kind || undefined));
    if (!entries.length) return;
    const field = objectFieldOf(a);
    if (!field || !fillable(a, field, summary)) return;
    if (Array.isArray(a.needs) && a.needs.includes('date') && !day) return;
    const named = kind ? entries.find((e) => Array.isArray(e.kinds) && e.kinds.includes(kind)) : null;
    const as = String((named || entries[0]).as || '').replace('{kind}', kind ? withArticle(kind) : objectWord).trim();
    const name = a.moduleName || a.module;
    out.push({ id: a.action, action: a, field, module: a.module, moduleName: name, local: Boolean(a.local), askerOnly: Boolean(a.askerOnly), legacy: false, named: Boolean(named), as, label: as ? `Add to ${name} as ${as}` : `Add to ${name}`, rank: placeRank({ named: Boolean(named), local: Boolean(a.local) }), span: namedKindCount(a), trip: travelEvent && namesTravel(a), note: a.takes.some((e) => Array.isArray(e && e.kinds) && e.kinds.includes('note')), i });
  });
  const old = findKeepers(list.filter((a) => !Array.isArray(a.takes)));
  const keeper = keeperFor(summary, old);
  if (keeper) {
    const name = keeper.moduleName || keeper.module;
    out.push({ id: keeper.action, action: keeper, field: '', module: keeper.module, moduleName: name, local: Boolean(keeper.local), askerOnly: Boolean(keeper.askerOnly), legacy: true, named: keeper === old.suggestion, as: '', label: `Add to ${name}`, rank: placeRank({ legacy: true, typed: keeper === old.suggestion }), span: 0, note: false, i: list.indexOf(keeper) });
  }
  out.sort(placeOrder);
  const at = last ? out.findIndex((t) => t.id === last) : -1;
  if (at > 0) out.unshift(...out.splice(at, 1));
  return out.map(({ rank, span, note, trip, i, ...t }) => t);
}

// The place a drawn object shows and is sent to. `chosen` is fixed when the object is first drawn with somewhere to go
// (the person's last choice for the kind, else the best), and then only by the person; a fresh list of actions never moves
// it, unless that place is no longer allowed, when it falls back to the best one left and says so (`moved`).
// Answers { target, chosen, moved }.
export function settlePlace(targets, chosen) {
  const list = Array.isArray(targets) ? targets : [];
  if (!list.length) return { target: null, chosen: chosen || '', moved: false };
  const kept = chosen ? list.find((t) => t.id === chosen) : null;
  if (kept) return { target: kept, chosen, moved: false };
  return { target: list[0], chosen: list[0].id, moved: Boolean(chosen) };
}

// Keep ticked: which ticked rows go, and which are left out and why. A row is { kind, target, open } (`open`: whether a
// local place's module is open). A place that opens a form on the person's own page (a local action, Polls' draft) is
// never sent in a batch, since each would replace the last; it is kept with its own Keep.
export function splitTicked(rows) {
  const going = [];
  const nowhere = [];
  const forms = [];
  const closed = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r.target) nowhere.push(r);
    else if (r.target.local && !r.open) closed.push(r);
    else if (r.target.local) forms.push(r);
    else going.push(r);
  }
  return { going, nowhere, forms, closed };
}

// The confirm's second part, what Keep ticked leaves out: "2 polls need Polls open." "1 poll opens a form in Polls: use
// its own Keep." "1 can't be kept here."
export function leftOutWords({ nowhere = [], forms = [], closed = [] } = {}, { one = 'object', many = 'objects' } = {}) {
  const counted = (list) => {
    const kinds = new Set(list.map((r) => r.kind || ''));
    const n = list.length;
    const k = kinds.size === 1 ? [...kinds][0] : '';
    return `${n} ${k ? kindWord(k, n) : n === 1 ? one : many}`;
  };
  const byModule = (list) => {
    const m = new Map();
    for (const r of list) { const name = r.target.moduleName; if (!m.has(name)) m.set(name, []); m.get(name).push(r); }
    return [...m];
  };
  const parts = [];
  for (const [name, list] of byModule(closed)) parts.push(`${counted(list)} ${list.length === 1 ? 'needs' : 'need'} ${name} open.`);
  for (const [name, list] of byModule(forms)) parts.push(`${counted(list)} ${list.length === 1 ? 'opens a form' : 'open a form each'} in ${name}: use ${list.length === 1 ? 'its' : 'each one\'s'} own Keep.`);
  if (nowhere.length) parts.push(`${nowhere.length} can't be kept here.`);
  return parts.join(' ');
}

// What Keep sends a target: the object itself to one that takes it, else the older flat fields. The question goes with it
// as "Asked: ..." to a note (a target that takes the object as any object, or as a note), not to one that maps its fields.
export function keepTargetInput(target, summary, question) {
  if (target.legacy) return target.action.name === 'acceptSuggestion' ? suggestionInput(summary) : keepInput(summary, question);
  const asNote = !target.named || !summary.kind || summary.kind === 'note';
  const input = objectKeepInput(target.action, target.field, summary, asNote ? question : '');
  const url = firstUrl(summary);
  if (target.action.input && Object.hasOwn(target.action.input, 'url') && url) input.url = url;
  return input;
}

// Whether any action here can keep an object at all, for showing Bring in.
export function canKeepAny(actions) {
  const list = (Array.isArray(actions) ? actions : []).filter((a) => a && a.may !== false);
  if (list.some((a) => Array.isArray(a.takes) && a.takes.some((e) => e && e.may !== false) && objectFieldOf(a))) return true;
  const old = findKeepers(list.filter((a) => !Array.isArray(a.takes)));
  return Boolean(old.note || old.suggestion);
}

// The confirm's words for Keep ticked: "3 flights and 2 stays in Planner, 1 task in To-do". `many` is an object with no
// kind ({ one, many }: the environment's word for object).
export function keepCountWords(picks, { one = 'object', many = 'objects' } = {}) {
  const byPlace = new Map();
  for (const { kind, moduleName } of Array.isArray(picks) ? picks : []) {
    if (!byPlace.has(moduleName)) byPlace.set(moduleName, new Map());
    const counts = byPlace.get(moduleName);
    counts.set(kind || '', (counts.get(kind || '') || 0) + 1);
  }
  const and = (parts) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);
  return [...byPlace].map(([place, counts]) => `${and([...counts].map(([k, n]) => `${n} ${k ? kindWord(k, n) : n === 1 ? one : many}`))} in ${place}`).join(', ');
}

// An object's details in one line under its title (plan-object-handoff.md, "The import preview in Chat"):
// "Southwest 1234 · MDW 12:50 → SJC 15:25 · ABC123". A time on the object's own day shows as the time alone.
export function detailsLine(summary) {
  const d = summary && summary.details && typeof summary.details === 'object' && !Array.isArray(summary.details) ? summary.details : null;
  if (!d) return '';
  const day = summary.date || '';
  const s = (v, n = 80) => (typeof v === 'string' || typeof v === 'number' ? oneLine(String(v), n) : '');
  const when = (v) => {
    const m = /^(\d{4}-\d{2}-\d{2})?T?(\d{2}:\d{2})?$/.exec(s(v));
    if (!m || (!m[1] && !m[2])) return '';
    if (m[1] && m[2]) return m[1] === day ? m[2] : `${m[1]} ${m[2]}`;
    return m[1] || m[2];
  };
  const point = (p) => (p && typeof p === 'object' ? s(p.code, 5) || s(p.name, 60) : s(p, 60));
  const end = (p, t) => [point(p), when(t)].filter(Boolean).join(' ');
  const span = (a, b) => [when(a), when(b)].filter(Boolean).join('–');
  const parts = [];
  const kind = summary.kind;
  if (['flight', 'train', 'bus', 'ferry', 'car'].includes(kind)) {
    parts.push([s(d.airline || d.operator || d.company, 60), s(d.number, 20)].filter(Boolean).join(' '));
    const from = end(d.from, d.departs);
    const to = end(d.to, d.arrives);
    parts.push(from && to ? `${from} → ${to}` : from || (to ? `→ ${to}` : ''));
  } else if (kind === 'hotel') {
    parts.push(when(d.checkIn) && `Check in ${when(d.checkIn)}`, when(d.checkOut) && `Check out ${when(d.checkOut)}`);
    if (Number.isInteger(d.guests)) parts.push(`${d.guests} ${d.guests === 1 ? 'guest' : 'guests'}`);
  } else if (kind === 'task') {
    parts.push(when(d.due) && `Due ${when(d.due)}`);
  } else if (kind === 'poll') {
    const options = Array.isArray(d.options) ? d.options.filter((o) => typeof o === 'string') : [];
    parts.push(options.slice(0, 4).map((o) => oneLine(o, 40)).join(' / ') + (options.length > 4 ? ' / …' : ''));
    parts.push(when(d.closes) && `Closes ${when(d.closes)}`);
  } else {
    parts.push(span(d.starts, d.ends));
    if (d.allDay === true) parts.push('All day');
    if (Number.isInteger(d.partySize)) parts.push(`${d.partySize} ${d.partySize === 1 ? 'person' : 'people'}`);
    if (Number.isInteger(d.tickets)) parts.push(`${d.tickets} ${d.tickets === 1 ? 'ticket' : 'tickets'}`);
    parts.push(s(d.address, 80));
  }
  parts.push(s(d.reference, 60));
  return oneLine(parts.filter(Boolean).join(' · '), 200);
}

// --- Send to... (plan-object-handoff.md, "Send to...") ---------------------------------------------------------------

// The day a chat message names, or '' (plan-object-handoff.md, "What each message is"). Stricter than the SDK's
// parseWhen, which reads what someone typed into a date field: in a chat message an ordinary word must not become a day
// ("I sat down", "Wed like pizza", "mon ami", "version 1/2", "paid 12/10"). Read, outside quoted lines:
// - 2026-11-14;
// - a month's name with a day: "nov 14", "14 November", "Nov. 14th, 2027";
// - m/d only when it reads as a date: "on 12/10", or with a time ("12/10 at 7pm", "12/10 19:00");
// - a weekday's whole name ("Friday", "next Friday"), or its short form after on, next or this ("on sat");
// - tomorrow.
// A day already passed this year (with no year given) is next year's. `now` is for the checks.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_WORD = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_SHORT = '(sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)';
export function chatDay(text, now) {
  const base = now instanceof Date ? now : new Date();
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const day = (m, d, y) => {
    if (!(m >= 0 && m < 12) || !(d >= 1 && d <= 31)) return '';
    const year = y || base.getFullYear();
    let date = new Date(year, m, d);
    if (date.getMonth() !== m) return '';
    if (!y && date < today) date = new Date(year + 1, m, d);
    return ymd(date);
  };
  const t = ` ${String(text || '').split('\n').filter((l) => !/^\s*>/.test(l)).join(' ').replace(/\s+/g, ' ').toLowerCase()} `;
  let m = /[\s(](\d{4})-(\d{2})-(\d{2})(?![\d-])/.exec(t);
  if (m) {
    const out = day(Number(m[2]) - 1, Number(m[3]), Number(m[1]));
    if (out) return out;
  }
  const year = (v) => (v ? Number(v) : 0);
  m = new RegExp(`[\\s(]${MONTH_WORD}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d/:])(?:,?\\s+(\\d{4})(?!\\d))?`).exec(t);
  if (m) {
    const out = day(MONTHS.indexOf(m[1].slice(0, 3)), Number(m[2]), year(m[3]));
    if (out) return out;
  }
  m = new RegExp(`[\\s(](\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_WORD}\\b(?:,?\\s+(\\d{4})(?!\\d))?`).exec(t);
  if (m) {
    const out = day(MONTHS.indexOf(m[2].slice(0, 3)), Number(m[1]), year(m[3]));
    if (out) return out;
  }
  const TIME = '(?:at\\s+\\d{1,2}(?::\\d{2})?(?:\\s*[ap]m)?|\\d{1,2}(?::\\d{2})?\\s*[ap]m|\\d{1,2}:\\d{2})';
  const MD = '(\\d{1,2})/(\\d{1,2})(?:/(\\d{2}|\\d{4}))?';
  m = new RegExp(`\\son\\s+${MD}(?![\\d/])`).exec(t) || new RegExp(`[\\s(]${MD}(?![\\d/]),?\\s+${TIME}\\b`).exec(t);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : 0;
    const out = day(Number(m[1]) - 1, Number(m[2]), y);
    if (out) return out;
  }
  m = new RegExp(`[\\s(](?:(on|next|this)\\s+)?(${WEEKDAYS.join('|')})\\b`).exec(t)
    || new RegExp(`\\s(on|next|this)\\s+${WEEKDAY_SHORT}\\.?(?![a-z])`).exec(t);
  if (m) {
    const want = WEEKDAYS.findIndex((w) => w.startsWith(m[2].slice(0, 3)));
    let ahead = (want - base.getDay() + 7) % 7;
    if (m[1] === 'next') ahead = ahead === 0 ? 7 : ahead + (want > base.getDay() ? 7 : 0);
    else if (ahead === 0 && m[1] !== 'this') ahead = 7;
    return ymd(new Date(base.getFullYear(), base.getMonth(), base.getDate() + ahead));
  }
  if (/\stomorrow\b/.test(t)) return ymd(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1));
  return '';
}

// What a chat message is, as objects in the format, in the order they are offered (plan-object-handoff.md, "What each
// message is"). Answers a list of groups { what, objects, named? }:
// - `what` is the kind of message, for "last used": 'picture', 'link', 'text' or 'objects';
// - `named`: only places that name the object's kind take this group (a link to a keeper of links; a message with a day
//   as an event, to a place that takes events and not words, such as the Planner).
// A picture is { kind: 'image', title, details: { name } } (its upload is added when it is sent); an AI answer with
// objects is those objects; any other message is its words with no kind: the title its first line (a quote skipped),
// the content the whole text, the first link with its preview, and the day chatDay finds. Pure, for the checks.
export function messageObjects(entry, { plain, now } = {}) {
  if (!entry || typeof entry !== 'object') return [];
  if (entry.picture) {
    const name = oneLine(entry.name, 120) || 'picture';
    return [{ what: 'picture', objects: [{ kind: 'image', title: name, details: { name } }] }];
  }
  const summaries = entry.kind === 'ai' && Array.isArray(entry.summaries) ? entry.summaries.filter((o) => o && typeof o === 'object' && o.title) : [];
  if (summaries.length) return [{ what: 'objects', objects: summaries }];
  const text = String(entry.kind === 'command' ? entry.text || '' : stripSummaryMarkers(entry.text)).trim();
  if (!text) return [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const first = lines.find((l) => !l.startsWith('>')) || lines[0];
  const title = plainTitle(first, plain).slice(0, 80) || oneLine(first, 80);
  const words = { title, content: text.slice(0, 6000) };
  const groups = [];
  const preview = !entry.kind && entry.preview && linkUrl(entry.preview.url) ? entry.preview : null;
  const url = preview ? preview.url : entry.kind ? '' : findLink(text);
  if (url) {
    const linkTitle = oneLine((preview && preview.title) || siteName(url) || url, 120);
    words.links = [{ title: linkTitle, url }];
    groups.push({ what: 'link', named: true, objects: [{ kind: 'link', title: linkTitle, ...(preview && preview.description ? { content: String(preview.description).slice(0, 500) } : {}), links: [{ title: linkTitle, url }] }] });
  }
  const day = chatDay(text, now);
  if (day) words.date = day;
  groups.push({ what: 'text', objects: [words] });
  if (words.date) groups.push({ what: 'text', named: true, objects: [{ ...words, kind: 'event' }] });
  return groups;
}

// The entries of Send to...: one per place, best first, each { id, what, module, moduleName, local, as, label, hint,
// sends: [{ summary, target }], left, more? }. One object reads "Research as an image"; several read "Planner (5)", with the kinds
// in the hint ("3 flights, 2 stays") and what that place cannot take ("1 task left out"). A place is listed once, for the
// first group it takes; a form on the person's own page (Polls' draft) comes last, and opens only the first of several
// (`more`: how many it leaves for their own Keep). `last` (an action id) is the person's
// last choice for this kind of message: first, and its hint says so. Pure, for the checks.
export function sendChoices(actions, groups, { last = '', objectWord = '', one = 'object', many = 'objects' } = {}) {
  const seen = new Set();
  const out = [];
  for (const g of Array.isArray(groups) ? groups : []) {
    const objects = Array.isArray(g.objects) ? g.objects : [];
    if (objects.length === 1) {
      const summary = objects[0];
      for (const t of keepTargets(actions, summary, { objectWord })) {
        if (seen.has(t.id) || (g.named && !t.named)) continue;
        seen.add(t.id);
        out.push({ id: t.id, what: g.what, module: t.module, moduleName: t.moduleName, local: t.local, as: t.as, label: t.as ? `${t.moduleName} as ${t.as}` : t.moduleName, hint: '', sends: [{ summary, target: t }], left: 0 });
      }
      continue;
    }
    const byPlace = new Map();
    let order = 0;
    objects.forEach((summary) => {
      keepTargets(actions, summary, { objectWord }).forEach((t, rank) => {
        if (g.named && !t.named) return;
        if (!byPlace.has(t.id)) byPlace.set(t.id, { t, sends: [], best: 0, at: order++ });
        const p = byPlace.get(t.id);
        p.sends.push({ summary, target: t });
        if (rank === 0) p.best += 1;
      });
    });
    const places = [...byPlace.values()].filter((p) => !seen.has(p.t.id))
      .sort((x, y) => y.best - x.best || y.sends.length - x.sends.length || x.at - y.at);
    for (const p of places) {
      seen.add(p.t.id);
      const n = p.sends.length;
      const left = objects.length - n;
      const counts = new Map();
      for (const s of p.sends) counts.set(s.summary.kind || '', (counts.get(s.summary.kind || '') || 0) + 1);
      const kinds = [...counts].map(([k, c]) => `${c} ${k ? kindWord(k, c) : c === 1 ? one : many}`).join(', ');
      // A form opens one object at a time (each would replace the last): only the first, and the hint says so.
      if (p.t.local && n > 1) {
        const as = p.sends[0].target.as;
        const hint = [`Opens the first of ${n}`, left ? `${left} left out` : ''].filter(Boolean).join('; ');
        out.push({ id: p.t.id, what: g.what, module: p.t.module, moduleName: p.t.moduleName, local: true, as, label: as ? `${p.t.moduleName} as ${as}` : p.t.moduleName, hint, sends: p.sends.slice(0, 1), left, more: n - 1 });
        continue;
      }
      const hint = [n > 1 ? kinds : '', left ? `${left} left out` : ''].filter(Boolean).join('; ');
      const as = n === 1 ? p.sends[0].target.as : '';
      out.push({ id: p.t.id, what: g.what, module: p.t.module, moduleName: p.t.moduleName, local: p.t.local, as, label: n > 1 ? `${p.t.moduleName} (${n})` : as ? `${p.t.moduleName} as ${as}` : p.t.moduleName, hint, sends: p.sends, left });
    }
  }
  const forms = out.filter((c) => c.local);
  const list = [...out.filter((c) => !c.local), ...forms];
  const at = last ? list.findIndex((c) => c.id === last) : -1;
  if (at > -1) {
    const [c] = list.splice(at, 1);
    list.unshift({ ...c, hint: [c.hint, 'Last used'].filter(Boolean).join('; '), lastUsed: true });
  }
  return list;
}

// A sentence from a module's one line: a capital first, a full stop last.
const sentence = (s) => {
  const t = oneLine(s, 300);
  if (!t) return '';
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? '' : '.'}`;
};

// How one request went, in Chat's words, from GET /api/spaces/:id/action/:requestId (`status`: null when it could not
// be read, a guest's). `result`:
// - 'kept' (done), 'opened' (a form on the person's own page), 'failed' (with the module's `error`), 'sent' (it went;
//   how is not known);
// - 'queued' (waiting for the module to be open), 'adding' (a page has it now);
// - for a form: 'starting' (not opened yet; still followed), 'closed' (it expired: the module is not open).
// Pure, for the checks.
export function requestOutcome(status, { moduleName = '', as = '', local = false, askerOnly = false } = {}) {
  const m = moduleName || 'It';
  if (!status || !status.status) return { result: 'sent', text: `Sent to ${m}.` };
  if (status.status === 'done') {
    const note = sentence(status.note);
    if (status.ok) {
      const text = local ? `Opened in ${m}.` : `Added to ${m}${as ? ` as ${as}` : ''}.`;
      return { result: local ? 'opened' : 'kept', text: [text, note].filter(Boolean).join(' '), note };
    }
    const why = oneLine(status.error, 300);
    return { result: 'failed', text: why ? `${m} couldn't add that: ${why}${/[.!?]$/.test(why) ? '' : '.'}` : `${m} couldn't add that.`, error: why };
  }
  if (local) {
    if (status.status === 'claimed') return { result: 'opened', text: `Opened in ${m}.` };
    if (status.status === 'pending') return { result: 'starting', text: `Waiting for ${m} to open it.` };
    return { result: 'closed', text: `${m} isn't open.` };
  }
  if (status.status === 'expired') return { result: 'failed', text: `${m} couldn't add that.` };
  if (status.status === 'claimed') return { result: 'adding', text: `${m} is adding it.` };
  return { result: 'queued', text: askerOnly ? `Waiting: it is added when you next open ${m}.` : `Waiting: it is added when ${m} is next open.` };
}

// Several requests' outcomes in one note: "Added 3 to Planner. 2 waiting: they are added when Planner is next open."
// Each is { result, text, note, moduleName }; `moduleName` names the one place they all went to, if they did.
export function outcomesWords(outcomes, { moduleName = '' } = {}) {
  const list = Array.isArray(outcomes) ? outcomes.filter(Boolean) : [];
  if (list.length === 1) return list[0].text;
  const of = (r) => list.filter((o) => o.result === r);
  const byModule = (r) => {
    const counts = new Map();
    for (const o of of(r)) counts.set(o.moduleName || moduleName || 'it', (counts.get(o.moduleName || moduleName || 'it') || 0) + 1);
    return [...counts];
  };
  const parts = [];
  const done = [...of('kept'), ...of('sent')];
  if (done.length) parts.push(`${of('kept').length ? 'Added' : 'Sent'} ${done.length}${moduleName ? ` to ${moduleName}` : ''}.`);
  parts.push(...new Set(list.map((o) => o.note).filter(Boolean)));
  for (const [m, n] of byModule('opened')) parts.push(n === 1 ? `Opened in ${m}.` : `Opened ${n} in ${m}.`);
  for (const [m, n] of byModule('adding')) parts.push(`${m} is adding ${n === 1 ? 'it' : n}.`);
  for (const [m, n] of byModule('starting')) parts.push(`Waiting for ${m} to open ${n === 1 ? 'it' : 'them'}.`);
  for (const mine of [false, true]) {
    const counts = new Map();
    for (const o of of('queued').filter((q) => Boolean(q.askerOnly) === mine)) counts.set(o.moduleName || moduleName || 'it', (counts.get(o.moduleName || moduleName || 'it') || 0) + 1);
    for (const [m, n] of counts) parts.push(`${n} waiting: ${n === 1 ? 'it is' : 'they are'} added when ${mine ? `you next open ${m}` : `${m} is next open`}.`);
  }
  const failed = of('failed');
  if (failed.length) parts.push(`${failed.length} couldn't be added. ${failed[0].text}`);
  for (const [m] of byModule('closed')) parts.push(`${m} isn't open.`);
  return parts.join(' ') || list.map((o) => o.text).join(' ');
}

// Whether a picture sent to a module was refused, so its upload is taken back off: refused, unless the module says the
// file is in use there ("that picture is already a photo here"). Pure, for the checks.
export function pictureRefused(outcome) {
  return Boolean(outcome && outcome.result === 'failed' && !/already a photo|in use/i.test(String(outcome.error || '')));
}

// What Send to... adds for a message's words with a day: the day as `due`, for a place that takes one on its own (To-do's
// createTask), since a day on words with no kind is not a due date to the module. Pure, for the checks.
export function wordsExtra(target, summary) {
  const input = (target && !target.legacy && target.action && target.action.input) || {};
  if (!summary || summary.kind || !isDay(summary.date) || !Object.hasOwn(input, 'due')) return {};
  return { due: summary.date };
}

// A title as plain text on one line (Markdown read, never shown raw), with the SDK's helper when the page has it.
export function plainTitle(title, plain) {
  const read = typeof plain === 'function' ? plain : (globalThis.hostText && globalThis.hostText.plain);
  const text = typeof read === 'function' ? read(String(title || ''), { line: true }) : String(title || '');
  return oneLine(text, 120);
}

// An AI answer as the pieces to draw, in order: { text } and { summary: index }.
// Same split the Assistant uses, so a {{summary:N}} marker becomes a preview.
function answerParts(text, summaryCount) {
  const parts = [];
  const drawn = new Set();
  let last = 0;
  const re = /\{\{summary:(\d+)\}\}/g;
  let m;
  const push = (s) => { const t = s.trim(); if (t) parts.push({ text: t }); };
  const src = String(text || '');
  while ((m = re.exec(src))) {
    const n = Number(m[1]);
    if (!(n < summaryCount) || drawn.has(n)) continue;
    push(src.slice(last, m.index));
    parts.push({ summary: n });
    drawn.add(n);
    last = m.index + m[0].length;
  }
  push(src.slice(last));
  for (let i = 0; i < summaryCount; i += 1) if (!drawn.has(i)) parts.push({ summary: i });
  return parts;
}

// Puts a chat popup just above its button, shifted so the whole of it stays on screen. Fixed, so the
// chat column cannot clip it.
export function placeAbove(popup, anchor) {
  if (!popup || !anchor) return;
  const view = popup.ownerDocument.defaultView;
  popup.style.right = 'auto';
  popup.style.bottom = 'auto';
  popup.style.margin = '0';
  const box = anchor.getBoundingClientRect();
  const w = popup.offsetWidth;
  const h = popup.offsetHeight;
  let left = box.right - w;
  let top = box.top - h - 6;
  if (top < 8) top = box.bottom + 6;
  left = Math.max(8, Math.min(left, view.innerWidth - w - 8));
  top = Math.max(8, Math.min(top, view.innerHeight - h - 8));
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

// The marker an AI answer uses for an object preview, {{summary:N}}. Only an AI answer turns it into a preview; an
// ordinary message drops it (the "AI answer shared by" copies from before plan-chat-model.md, decision 16).
export function stripSummaryMarkers(text) {
  return String(text || '').replace(/[ \t]*\{\{summary:\d+\}\}/g, '');
}

// Chat's two views (GitHub #203), in place of the All | Private | Public filter: Discussion, the conversation everyone
// sees, and Assistant, this person's own commands, AI answers and what they bring in. One store: where a message shows
// follows who sees it, so changing the view fetches nothing. Pure, for the checks.
export const CHAT_VIEWS = ['discussion', 'assistant'];
export const viewKey = (spaceId) => `chat-view:${spaceId}`;
export function readView(value) {
  return CHAT_VIEWS.includes(value) ? value : 'discussion';
}
// Where a message shows: 'assistant' when private (only ever its author's page holds one); 'both' for the person's own
// command or AI answer they shared (everyone's Discussion, and still their Assistant, marked shared); else 'discussion'.
export function viewOf({ visibility, kind, mine } = {}) {
  if (visibility === 'private') return 'assistant';
  if (mine && (kind === 'ai' || kind === 'command')) return 'both';
  return 'discussion';
}
export function inView(where, view) {
  return where === 'both' || where === readView(view) || (!where && readView(view) === 'discussion');
}
// The line the Assistant shows while it holds nothing, or ''. The Discussion shows nothing when empty, as before.
export function emptyLine(view, places) {
  if (readView(view) !== 'assistant') return '';
  return (places || []).some((p) => inView(p, 'assistant')) ? '' : 'Your commands, AI answers and what you bring in show here. Only you see them.';
}
// The Discussion's word: the environment's name for Chat (its template's or its own), else "Discussion".
export function discussionWord(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  return !n || n === 'Chat' ? 'Discussion' : n;
}
// A module command is declared with a short name and, beside it, its full word (module.json `word`): /t or /todo, both
// run the same command, and the short name is always the word's first letter. A command with no word has its short name only.
// The short name a typed command word stands for (the short one itself, or a full word), else the word as typed.
// `list` is the commands: { name, word? }.
export function commandName(word, list = []) {
  const w = String(word || '').toLowerCase();
  if (list.some((c) => (c.name ?? c) === w)) return w;
  const hit = list.find((c) => c.word === w);
  return hit ? hit.name : w;
}
// "/t or /todo": how a command shows in the menu and its hint.
export function commandForms(name, word = '') {
  return word ? `/${name} or /${word}` : `/${name}`;
}
// Whether pasted text is one of our import answers (the objects template): JSON that is an object or a list, or a
// fenced objects block, or text with a JSON object that has a title. Anything else is words for the AI. The server's
// checker has the last word on what it holds.
export function looksLikeImport(text) {
  const t = String(text || '').replace(/^\uFEFF/, '').trim();
  if (t.length < 2) return false;
  if (t[0] === '{' || t[0] === '[') {
    try {
      const v = JSON.parse(t);
      return v !== null && typeof v === 'object';
    } catch { /* maybe a block with words around it */ }
  }
  if (/^[ \t>*+-]*`{3,}[ \t]*objects(?![\w-])/im.test(t)) return true;
  return /\{[^{}]*"title"\s*:/.test(t) && /"(?:kind|content|format|formatVersion)"\s*:/.test(t);
}
// What the box does with a line, by the view it is typed in: a command runs in the Assistant (typed in the Discussion,
// it switches there first and the Discussion shows nothing of it), in either view; in the Assistant a pasted import
// answer is brought in ('import') and any other words ask the AI; in the Discussion words are a message. /ai is the one
// built-in command (plan-chat-model.md): in either view it asks the AI the words after it, in the Assistant. A lone or
// malformed slash stays in the box ('none').
export function routeLine(text, view) {
  const t = String(text || '').trim();
  const v = readView(view);
  if (!t) return { run: 'none', view: v, line: '' };
  const ask = /^\/ai(?:\s+([\s\S]*))?$/.exec(t);
  if (ask) return { run: 'ai', view: 'assistant', line: (ask[1] || '').trim() };
  if (/^\/[a-z0-9]{1,12}(?:\s[\s\S]*)?$/.test(t)) return { run: 'command', view: 'assistant', line: t };
  if (t.startsWith('/')) return { run: 'none', view: v, line: t };
  if (v === 'assistant') return looksLikeImport(t) ? { run: 'import', view: 'assistant', line: t } : { run: 'ai', view: 'assistant', line: t };
  return { run: 'message', view: 'discussion', line: t };
}
// A question is at most this many characters (the server refuses more); counted as people count them.
export const ASK_MAX = 1000;
export function questionTooLong(question) {
  const n = [...String(question || '')].length;
  return n > ASK_MAX ? `A question is at most ${ASK_MAX.toLocaleString('en-US')} characters; this one is ${n.toLocaleString('en-US')}.` : '';
}
// The browser's time zone (IANA), sent with every ask so "today" is the asker's today.
export function askZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
}
// The AI used: line of an answer, in parts a page draws. `sent` is what the server kept of the call ({ attached, relevant,
// linked, history, chat, members, notSent, cut }), `leftOut` the call's own list. `w` is this environment's words:
// { object, objects, space, owner, member, members, nameOf(moduleId) }. Answers { counts: [text], notSent: text, fit: text }.
export function aiUsedParts(sent, leftOut, w) {
  const s = sent && typeof sent === 'object' ? sent : {};
  const n = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);
  const many = (c, one, more) => `${c} ${c === 1 ? one : more}`;
  const counts = [];
  if (n(s.relevant)) counts.push(many(n(s.relevant), `related ${w.object}`, `related ${w.objects}`));
  if (n(s.linked)) counts.push(many(n(s.linked), `linked ${w.object}`, `linked ${w.objects}`));
  if (n(s.history)) counts.push(many(n(s.history), 'earlier question', 'earlier questions'));
  if (n(s.chat)) counts.push(many(n(s.chat), 'chat message', 'chat messages'));
  if (n(s.members)) counts.push(many(n(s.members), w.member, w.members));
  const bits = (Array.isArray(s.notSent) ? s.notSent : []).filter((x) => x && n(x.count)).map((x) => {
    const c = n(x.count);
    const from = x.module ? ` from ${x.moduleName || w.nameOf(x.module)}` : '';
    const what = `${c} ${c === 1 ? w.object : w.objects}${from}`;
    return x.why === 'other-space' ? `${what}, from another ${w.space}` : `${what}, kept out by the ${w.owner}'s setting`;
  });
  const fit = s.cut === true || (Array.isArray(leftOut) && leftOut.some((l) => l && (l.why === 'budget' || l.why === 'shortened')));
  return { counts, notSent: bits.length ? `Not sent: ${bits.join('; ')}.` : '', fit: fit ? `Some ${w.objects} were left out to fit.` : '' };
}
// The objects an answer looked up (the server's `sent.lookup`: { searches, read }). `read` is how many objects it opened, or
// the list of them as pointers; a page without the field, or a number alone, still reads. Answers { count, refs }.
export function lookupOf(sent) {
  const l = sent && typeof sent === 'object' && sent.lookup && typeof sent.lookup === 'object' ? sent.lookup : null;
  if (!l) return { count: 0, refs: [] };
  const refs = Array.isArray(l.read) ? l.read.filter((r) => r && typeof r === 'object') : [];
  const num = Number(Array.isArray(l.read) ? l.read.length : l.read);
  return { count: Number.isFinite(num) ? Math.max(0, Math.floor(num)) : 0, refs };
}
// A text split at its citations, [1] or [2, 3]: pieces { text } and { cite: [n] }.
export function citationParts(text) {
  const out = [];
  let last = 0;
  const src = String(text || '');
  for (const m of src.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    if (m.index > last) out.push({ text: src.slice(last, m.index) });
    out.push({ cite: m[1].split(',').map((x) => Number(x)), raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last) });
  return out;
}
// What the page says when the AI is not there for this person, in plain words, from the server's `reason` (GET .../ai:
// 'guest', 'space-off', 'role', 'not-set-up' or 'allowance'; '' when it is there). `words` are this environment's: its
// word for guests, for the owner and for a space. A reason the page does not know says the server's own sentence, capitalised.
export function aiNotice(reason, why = '', { guests = '', owner = '', space = '' } = {}) {
  switch (reason) {
    case '': return '';
    case 'guest': return `${guests} cannot use AI.`;
    case 'space-off': return `AI is turned off in this ${space}.`;
    case 'role': return `Your role can't use AI here: ask the ${owner}.`;
    case 'not-set-up': return 'AI is not set up yet.';
    case 'allowance': return "This month's AI allowance is used up.";
    // The server's own sentence for these (what it is about depends on the setting behind it).
    case 'member': case 'chat': case 'module': {
      const w = String(why || '').replace(/\s+/g, ' ').trim();
      if (!w) return reason === 'module' ? "Your role can't use AI here." : reason === 'chat' ? "AI can't be asked in the chat here." : `You aren't in this ${space}.`;
      const out = w[0].toUpperCase() + w.slice(1);
      return /[.!?]$/.test(out) ? out : `${out}.`;
    }
    default: {
      const w = String(why || '').replace(/\s+/g, ' ').trim();
      if (!w) return '';
      const out = w[0].toUpperCase() + w.slice(1);
      return /[.!?]$/.test(out) ? out : `${out}.`;
    }
  }
}
// Whether an arriving message marks a view as new to read: the Assistant's when it lands there while the person is not
// looking at it (another view, or Chat out of sight); the Discussion's for a message from someone else while they are
// in the Assistant. What the person did themselves never counts.
export function marksNew(where, { view, shown, own } = {}) {
  const v = readView(view);
  if (own) return '';
  if (inView(where, 'assistant') && where !== 'both' && (!shown || v !== 'assistant')) return 'assistant';
  if (inView(where, 'discussion') && shown && v === 'assistant') return 'discussion';
  return '';
}

// Clear… (plan-chat-clear.md, #166): the types, the scopes and the counts, from the messages the page holds. Pure, for
// the checks. The filter plays no part (decision 7): a type takes public and private messages alike.
//
// The type a held message belongs to: 'chat', 'ai', 'module:<id>', 'other' (a stored command with no module, which only
// All takes, as on the server), or '' when there is nothing to clear: a picture (never stored), a guest's echo drawn
// here only, an old copy kept in this browser.
export function clearTypeOf(entry) {
  if (!entry || !entry.stored || entry.picture) return '';
  if (!entry.kind) return 'chat';
  if (entry.kind === 'ai' || entry.command === 'ai') return 'ai';
  if (entry.kind === 'command' && entry.module) return `module:${entry.module}`;
  return 'other';
}
// Whether a held message is of a clear's type ({ type, module } as the route takes them).
export function ofClearType(entry, type, module) {
  const t = clearTypeOf(entry);
  if (!t) return false;
  if (type === 'all') return true;
  if (type === 'module') return Boolean(module) && t === `module:${module}`;
  return t === type;
}
// 'mine': the person's own, public and private. 'everyone': every public message and the person's own private ones,
// never someone else's private one (decision 4; the page never holds one anyway).
export function inClearScope(entry, scope, by) {
  if (!by || !entry) return false;
  if (scope === 'mine') return entry.by === by;
  if (scope === 'everyone') return entry.visibility !== 'private' || entry.by === by;
  return false;
}
// What Clear… lists, in order: Chat messages, AI, each module (as first held), then All. Each is
// { type, module?, command?, mine, everyone }; only the types with something the person could clear are listed (a
// moderator: everyone's; anyone else: their own). Empty when there is nothing, and then Clear… is not offered.
export function clearChoices(entries, { by, moderator = false } = {}) {
  const found = new Map();
  const all = { type: 'all', mine: 0, everyone: 0 };
  for (const entry of entries || []) {
    const t = clearTypeOf(entry);
    if (!t) continue;
    const mine = inClearScope(entry, 'mine', by) ? 1 : 0;
    const everyone = inClearScope(entry, 'everyone', by) ? 1 : 0;
    all.mine += mine;
    all.everyone += everyone;
    if (t === 'other') continue;
    if (!found.has(t)) {
      found.set(t, t.startsWith('module:')
        ? { type: 'module', module: t.slice(7), command: entry.command || '', mine: 0, everyone: 0 }
        : { type: t, mine: 0, everyone: 0 });
    }
    const choice = found.get(t);
    choice.mine += mine;
    choice.everyone += everyone;
  }
  const order = [found.get('chat'), found.get('ai'), ...[...found].filter(([t]) => t.startsWith('module:')).map(([, c]) => c)];
  const listed = order.filter((c) => c && (moderator ? c.everyone : c.mine) > 0);
  if (!listed.length) return [];
  return [...listed, all];
}
// A clear of type chat or all also takes pictures: the person's own for 'mine', every one for 'everyone'. Pictures are
// never stored, so this is each page's own work.
export function clearTakesPicture(entry, { type, scope, by }) {
  if (!entry || !entry.picture || (type !== 'chat' && type !== 'all')) return false;
  return scope === 'everyone' || Boolean(by && entry.by === by);
}
// What a chat-clear-some notice (the server's, on the live stream) takes from a page: the listed ids (never a picture by
// id), and pictures as clearTakesPicture says.
export function clearNoticeTakes(entry, { ids, type, scope, by }) {
  if (!entry || !by) return false;
  const listed = Boolean(entry.id && ids && ids.has(entry.id) && !entry.picture);
  return listed || clearTakesPicture(entry, { type, scope, by });
}

// --- links in Chat (plan-chat-links.md, GitHub #158) ------------------------------------------------------------------
// A message's link preview and its Keep, as this page holds them. Pure, for check-chat-page: everything a notice or the
// server hands in goes through these, so only an http(s) address is ever a link, the words are text of known length,
// and the picture is only ever a yes or no (the page loads it from the image route by the message's id, never from an
// address it was sent).
const MODULE_ID = /^[a-z][a-z0-9-]{0,31}$/;
export function linkUrl(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s || s.length > 500 || !/^https?:\/\//i.test(s)) return '';
  try {
    const u = new URL(s);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return '';
  } catch {
    return '';
  }
  return s;
}
export function cleanPreview(p) {
  if (!p || typeof p !== 'object') return null;
  const url = linkUrl(p.url);
  if (!url) return null;
  const out = { url };
  if (typeof p.module === 'string' && MODULE_ID.test(p.module)) out.module = p.module;
  const at = Number(p.at);
  if (Number.isFinite(at) && at > 0) {
    out.at = at;
    if (typeof p.title === 'string' && p.title.trim()) out.title = oneLine(p.title, 120);
    if (typeof p.description === 'string' && p.description.trim()) out.description = String(p.description).trim().slice(0, 500);
    if (typeof p.image === 'string' && p.image) out.image = true; // only whether there is one
  }
  return out;
}
export function cleanKept(k) {
  if (!k || typeof k !== 'object' || typeof k.by !== 'string' || !k.by) return null;
  const at = Number(k.at);
  return { by: k.by.slice(0, 40), who: oneLine(k.who, 40) || 'someone', at: Number.isFinite(at) ? at : 0 };
}
// A message's one link, by the server's rule (findLink in server/chat-links.js; check-chat-page holds them equal): the
// first usable http(s) address, bare or as [text](url), outside ``` fences, `>` quoted lines and `code` spans.
const MARKDOWN_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_LINK = /(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)"'])/g;
export function findLink(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let fenced = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced || /^\s*>/.test(line)) continue;
    const plain = line.replace(/`[^`\n]+`/g, (m) => ' '.repeat(m.length));
    const found = [];
    const masked = plain.replace(MARKDOWN_LINK, (all, _label, url, at) => {
      found.push({ at, url });
      return ' '.repeat(all.length);
    });
    for (const m of masked.matchAll(BARE_LINK)) found.push({ at: m.index + m[1].length, url: m[2] });
    found.sort((a, b) => a.at - b.at);
    for (const f of found) {
      const url = linkUrl(f.url);
      if (url) return url;
    }
  }
  return '';
}
// The site's name, for the line under a link: its host without "www.".
export function siteName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}
// The space's keeper of links (the action named saveLink taking `url`), from GET .../actions, or null; `may` says
// whether this person may keep (decision 10: Keep is hidden otherwise).
export function linkKeeper(actions) {
  const a = (Array.isArray(actions) ? actions : []).find((x) => x && x.name === 'saveLink' && x.input && Object.hasOwn(x.input, 'url'));
  return a ? { module: String(a.module || ''), name: String(a.moduleName || a.module || ''), may: a.may === true } : null;
}
// Whether a chat-preview notice (the server's) may fill this message's preview: the first copy only, for a message held
// here that has a link, and only for the address the message already has.
export function previewNoticeTakes(entry, data) {
  if (!entry || !entry.id || entry.kind || !data || data.id !== entry.id) return false;
  if (!entry.preview || entry.preview.at) return false;
  const p = cleanPreview(data.preview);
  return Boolean(p && p.at && p.url === entry.preview.url);
}
// Whether a chat-kept notice (the server's) may mark this message kept: the first copy only.
export function keptNoticeTakes(entry, data) {
  if (!entry || !entry.id || !entry.preview || entry.kept || !data || data.id !== entry.id) return false;
  return Boolean(cleanKept(data.kept));
}

export function attachChatInput({ $, api, word, openObject = null, getSpace, getMe, isGuest, keepStoredLink, canvas, resizeChatInput, renderMarkup, frameMessage, addStored, openMenu, isShown = () => true, onAssistantNew = null, isHome = () => false, guestToken = '', pictureBlob = async (entry) => entry.blob }) {
  const input = () => $('chat-input');
  // The field's hint when nothing is typed, on one line: the full one when it fits the field, else a shorter one
  // A command's own hint is left alone. In the Assistant, plain words go to the AI (routeLine), and its hint says so.
  const HINTS = ['Send a message or type / for commands', 'Send a message, or / for commands', 'Send a message'];
  const ASK_HINTS = ['Instruct the Assistant or type / for commands', 'Instruct the Assistant, or / for commands', 'Instruct the Assistant'];
  const NO_AI_HINTS = ['Type / for commands'];
  // Whether the AI is there for this person in this space (GET /api/spaces/:id/ai, asked when Chat opens and when the
  // Assistant shows): unknown until asked, and then the server's reason when it is not.
  let aiState = { known: false, available: true, reason: '', why: '', at: 0 };
  let aiBusy = false;
  let view = 'discussion';
  let importOk = false;
  let hintCtx = null;
  function defaultHint() {
    const list = view === 'assistant' ? (aiState.known && !aiState.available ? NO_AI_HINTS : ASK_HINTS) : HINTS;
    const el = input();
    const cs = el && getComputedStyle(el);
    const free = el ? el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) : 0;
    if (!(free > 0)) return list[0];
    hintCtx ||= document.createElement('canvas').getContext('2d');
    if (!hintCtx) return list[0];
    hintCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return list.find((h) => hintCtx.measureText(h).width <= free) || list[list.length - 1];
  }
  function fitHint() {
    const el = input();
    if (el && (!el.placeholder || HINTS.includes(el.placeholder) || ASK_HINTS.includes(el.placeholder) || NO_AI_HINTS.includes(el.placeholder))) el.placeholder = defaultHint();
  }
  // Back to the view's own hint unless a command is being typed (its example shows only then): after a send, a cancel
  // or a switch of view.
  function resetHint() {
    const el = input();
    if (el && !parseCommand(el.value || '')) el.placeholder = defaultHint();
  }
  if (input() && typeof ResizeObserver === 'function') new ResizeObserver(fitHint).observe(input());
  const note = () => $('chat-note');
  let aiContext = [];
  let lastActions = [];

  function spaceId() {
    const s = getSpace();
    return s && !s.isAside ? s.id : null;
  }

  // Chat's one line of news, in its status area (#chat-note inside #chat-status, the module frame's status bar): always
  // there, a polite live region, so a change is read out once. A failure shows in the error text colour.
  function setNote(text, error = false) {
    const el = note();
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('error', Boolean(text) && error);
  }

  // On Home the chat is the Discussion alone (GitHub #326, Thomas 2026-10-15): no Assistant, and no commands, which
  // run in a space's modules. A typed /word says there is no such command.
  function commandList() {
    const list = [];
    if (isHome()) return list;
    for (const m of canvas.list()) {
      for (const c of m.commands || []) {
        list.push({
          name: c.name,
          label: c.label,
          module: m.id,
          moduleName: m.displayName || m.name,
          icon: /^[a-z0-9-]{1,40}$/.test(m.icon || '') ? m.icon : '',
          word: /^[a-z]{2,12}$/.test(c.word || '') && c.word[0] === c.name ? c.word : '',
          hint: c.hint || '',
          action: c.action,
        });
      }
    }
    return list;
  }

  function parseCommand(raw) {
    const text = String(raw || '');
    const m = /^\/([a-z0-9]{1,12})(?:\s+([\s\S]*))?$/.exec(text.trim());
    if (!m) return null;
    // A full word stands for its short name (/task is /t); the short name is what is stored and sent.
    return { name: commandName(m[1], commandList()), rest: (m[2] || '').trim(), raw: text };
  }

  function matchesFor(name) {
    return commandList().filter((c) => c.name === name);
  }

  function hidePicker() {
    $('chat-command-wrap')?.querySelector('#chat-command-menu')?.remove();
  }

  function showPicker() {
    const items = commandList();
    const byName = new Map();
    // /ai is Chat's own command, listed first (not at Home, which has no Assistant, nor for a guest).
    if (!isHome() && !isGuest()) {
      byName.set('ai', [{ name: 'ai', label: aiState.known && !aiState.available ? `Ask the AI (${aiLine().replace(/\.$/, '').toLowerCase()})` : 'Ask the AI', moduleName: '', word: '', hint: 'Ask the AI a question' }]);
    }
    for (const c of items) {
      const key = c.name;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(c);
    }
    const menu = document.createElement('div');
    menu.className = 'chat-command-menu';
    menu.id = 'chat-command-menu';
    for (const [name, group] of byName) {
      for (const c of group) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chat-command-item';
        const forms = commandForms(name, group[0].word);
        const label = group.length > 1 && c.moduleName ? `${forms} (${c.moduleName})` : forms;
        b.textContent = `${label} — ${c.label}`;
        b.addEventListener('click', () => {
          input().value = `/${name} `;
          input().focus();
          if (c.hint) input().placeholder = c.hint;
          hidePicker();
          resizeChatInput();
        });
        menu.appendChild(b);
      }
    }
    hidePicker();
    $('chat-command-wrap').appendChild(menu);
    const command = $('chat-command');
    const wrap = $('chat-command-wrap');
    const more = $('chat-format-more');
    placeAbove(menu, (wrap?.dataset.collapsed && more && !more.hidden) ? more : command);
    const close = (ev) => {
      if (ev.target.closest('#chat-command-wrap')) return;
      hidePicker();
      document.removeEventListener('pointerdown', close, true);
    };
    document.addEventListener('pointerdown', close, true);
  }

  // --- the views: Discussion | Assistant (GitHub #203) ---
  // #messages carries data-view and each line data-in (frameMessage: viewOf); style.css hides the rest, so changing the
  // view fetches nothing and a message that arrives or changes who sees it follows at once. The module frame's view
  // switch (.mf-switch): a radio group of two, the chosen one checked and the one Tab stop; the arrows move and choose
  // (public/sdk/host.js, hostSwitch). Remembered per space for the session.
  const newIn = { discussion: 0, assistant: 0 };
  function paintNew() {
    const count = $('chat-view-discussion-count');
    if (count) {
      count.hidden = newIn.discussion === 0;
      count.textContent = newIn.discussion > 9 ? '9+' : String(newIn.discussion);
    }
    const said = $('chat-view-discussion-new');
    if (said) said.textContent = newIn.discussion ? `${newIn.discussion} unread` : '';
    const dot = $('chat-view-assistant-dot');
    if (dot) dot.hidden = newIn.assistant === 0;
    const told = $('chat-view-assistant-new');
    if (told) told.textContent = newIn.assistant ? 'New results' : '';
    if (onAssistantNew) onAssistantNew(newIn.assistant);
  }
  function setView(next) {
    view = spaceId() && !isHome() ? readView(next) : 'discussion';
    const id = spaceId();
    if (id && !isHome()) {
      try { sessionStorage.setItem(viewKey(id), view); } catch { /* not remembered */ }
    }
    for (const v of CHAT_VIEWS) {
      const el = $(`chat-view-${v}`);
      if (!el) continue;
      el.setAttribute('aria-checked', v === view ? 'true' : 'false');
    }
    if (window.hostSwitch) window.hostSwitch.rove($('chat-view-discussion')?.parentElement);
    const list = $('messages');
    if (list) list.dataset.view = view;
    if ($('chat')) $('chat').dataset.view = view;
    if (isShown()) newIn[view] = 0;
    paintNew();
    resetHint();
    paintModeTools();
    syncEmpty();
    paintAiState();
    if (view === 'assistant' && id && !isHome()) checkAi();
    if (list) list.scrollTop = list.scrollHeight;
  }
  // Chat came into sight (opened, the column expanded): the view showing is read.
  function seen() {
    if (!isShown() || !newIn[view]) return;
    newIn[view] = 0;
    paintNew();
  }

  function loadView() {
    const id = spaceId();
    let next = 'discussion';
    if (id) {
      try { next = readView(sessionStorage.getItem(viewKey(id))); } catch { /* the default */ }
    }
    newIn.discussion = 0;
    newIn.assistant = 0;
    setView(next);
  }

  // Shown to everyone who can read Chat in a space, guests too; not in an aside, which keeps nothing and runs no
  // command: there it is the Discussion alone.
  function setViewsVisible(on) {
    const g = $('chat-views');
    if (!g) return;
    g.hidden = !on;
    if (!on) { view = 'discussion'; const list = $('messages'); if (list) list.dataset.view = view; if ($('chat')) $('chat').dataset.view = view; newIn.assistant = 0; paintNew(); syncEmpty(); return; }
    loadView();
    // The shared view switch's fit (public/sdk/host.js): icons only while the chat is too narrow for the words.
    if (window.hostSwitch) window.hostSwitch.watch(g);
  }

  // A message just placed (space.js, addEntry): the other view's mark, and the Assistant's news read out.
  function arrived(el, { own = false } = {}) {
    const where = el?.dataset?.in || 'discussion';
    const mark = marksNew(where, { view, shown: isShown(), own });
    if (mark) { newIn[mark] += 1; paintNew(); }
    if (!own && inView(where, 'assistant') && where !== 'both') {
      const who = el.querySelector('.message-name')?.textContent || '';
      announce(view === 'assistant' && isShown() ? `${who || 'New'}: ${oneLine(el.querySelector('.message-body')?.textContent || '', 120)}` : 'New in Assistant.');
    }
  }
  let announceSeq = 0;
  function announce(text) {
    const el = $('chat-view-news');
    if (!el) return;
    const seq = ++announceSeq;
    el.textContent = '';
    setTimeout(() => { if (seq === announceSeq) el.textContent = text; }, 60);
  }

  // The Assistant's line while it holds nothing.
  function syncEmpty() {
    const list = $('messages');
    if (!list) return;
    let line = list.querySelector(':scope > .chat-view-empty');
    const text = emptyLine(list.dataset.view || 'discussion', [...list.querySelectorAll(':scope > .message, :scope > .chat-closed-ask')].map((m) => m.dataset.in || 'discussion'));
    if (!text) { line?.remove(); return; }
    if (!line) {
      line = document.createElement('p');
      line.className = 'sdk-empty-line chat-view-empty';
    }
    // Only when the words differ: setting them again replaces the text node, which the observer below sees as a change
    // and runs syncEmpty again, for ever (the page hangs).
    if (line.textContent !== text) line.textContent = text;
    if (line.parentNode !== list || line !== list.lastElementChild) list.appendChild(line);
  }
  const messagesEl = $('messages');
  if (messagesEl && typeof MutationObserver === 'function') {
    new MutationObserver((records) => {
      // The empty line's own changes (its place, its words) never call for another look.
      const own = (n) => Boolean(n.classList?.contains('chat-view-empty'));
      if (records.every((r) => r.type === 'childList' && (own(r.target) || [...r.addedNodes, ...r.removedNodes].every(own)))) return;
      syncEmpty();
    }).observe(messagesEl, { childList: true, attributes: true, subtree: true, attributeFilter: ['data-in'] });
  }

  // On entering a space: the views, and whether this space can keep a pasted import. Private and public messages
  // alike come from GET .../chat (space.js, renderChatHistory); there is no separate AI thread to load any more.
  async function loadThread() {
    aiContext = [];
    paintContext();
    aiState = { known: false, available: true, reason: '', why: '', at: 0 };
    paintAiState();
    setViewsVisible(Boolean(spaceId()) && !isHome());
    if (!spaceId() || isHome() || !getMe()) return;
    checkAi(true);
    await refreshImport();
  }

  // The last place the person chose to keep each kind of object, in this browser (plan-object-handoff.md, "Its
  // destination"); "text" for an object with no kind.
  const placeKey = (kind) => `chat-keep-place:${kind || 'text'}`;
  const lastPlace = (kind) => { try { return localStorage.getItem(placeKey(kind)) || ''; } catch { return ''; } };
  const rememberPlace = (kind, id) => { try { localStorage.setItem(placeKey(kind), id); } catch { /* not remembered */ } };
  // Every object drawn with a Keep, so a fresh list of actions redraws where each would go.
  const drawnObjects = new Set();

  // An object drawn with its details line, its Keep and where Keep puts it. In the import preview (`pick: 'choose'`,
  // `askDay`) the menu beside Keep chooses the place, for Keep and Keep ticked, and an object of a kind that has a day
  // and none given asks for one; in an AI answer the menu keeps it there at once (plan-object-handoff.md, decision 16).
  // Answers { el, keepBtn, current, target, needsDay, setDay, send, isKept, moved }.
  function drawObject(summary, question, { onKept, pick = 'send', askDay = false, fresh = true } = {}) {
    const el = document.createElement('article');
    el.className = 'chat-object';
    if (summary.kind) el.dataset.kind = summary.kind;
    const titleText = plainTitle(summary.title) || 'Untitled';
    const title = document.createElement('h3');
    title.textContent = titleText;
    el.appendChild(title);
    const details = detailsLine(summary);
    if (details) {
      const line = document.createElement('p');
      line.className = 'chat-object-details';
      line.textContent = details;
      el.appendChild(line);
    }
    const content = String((summary && summary.content) || '').trim();
    if (content) {
      const body = document.createElement('div');
      body.className = 'chat-object-body';
      body.innerHTML = renderMarkup(content);
      el.appendChild(body);
    }
    const from = Array.isArray(summary.sources) ? summary.sources.filter(refOk).slice(0, 12) : [];
    if (from.length) {
      const src = document.createElement('p');
      src.className = 'chat-object-meta chat-object-from';
      src.append('From: ');
      from.forEach((r, i) => { if (i) src.append(', '); src.append(objectLink(r)); });
      el.appendChild(src);
    }
    const meta = [];
    const place = summary.place && (summary.place.name || summary.place);
    if (place) meta.push(String(place));
    if (summary.date) meta.push(String(summary.date));
    if (summary.kind) meta.push(String(summary.kind));
    if (meta.length) {
      const line = document.createElement('p');
      line.className = 'chat-object-meta';
      line.textContent = meta.join(' · ');
      el.appendChild(line);
    }
    const links = (summary && summary.links) || [];
    if (links.length) {
      const list = document.createElement('p');
      list.className = 'chat-object-meta';
      list.textContent = links.map((l) => l.title || l.url).filter(Boolean).join(' · ');
      el.appendChild(list);
    }
    if (summary && summary.basis === 'imported') {
      const basis = document.createElement('p');
      basis.className = 'chat-object-meta';
      basis.textContent = 'From another AI: check it before you rely on it';
      el.appendChild(basis);
    }

    // A missing day (decision 10): optional; filled, it is sent as the object's date. Asked only when some place here
    // could keep the object once it has a day.
    const asksDay = askDay && needsDay(summary);
    let dayInput = null;
    let dayRow = null;
    let dayFromAll = false;
    let dayChanged = () => {};
    if (asksDay) {
      dayRow = document.createElement('p');
      dayRow.className = 'chat-object-day';
      const words = document.createElement('span');
      words.textContent = 'No day';
      dayInput = document.createElement('input');
      dayInput.type = 'date';
      dayInput.setAttribute('aria-label', `Day for ${titleText}`);
      dayChanged = () => {
        words.textContent = dayInput.value ? 'Day' : 'No day';
        drawPlace();
      };
      dayInput.addEventListener('input', () => { dayFromAll = false; dayChanged(); });
      dayInput.addEventListener('change', () => { dayFromAll = false; dayChanged(); });
      // The row of an import is a label for its checkbox: the day's words must not tick or untick it.
      dayRow.addEventListener('click', (e) => {
        if (e.target === dayInput) return;
        e.preventDefault();
        dayInput.focus();
      });
      dayRow.append(words, dayInput);
      el.appendChild(dayRow);
    }
    const current = () => (dayInput && /^\d{4}-\d{2}-\d{2}$/.test(dayInput.value) ? { ...summary, date: dayInput.value } : summary);

    const row = document.createElement('div');
    row.className = 'chat-object-keeprow';
    const keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'btn btn-quiet btn-small chat-object-keep';
    keep.textContent = 'Keep';
    const where = document.createElement('span');
    where.className = 'chat-object-place';
    row.append(keep, where);
    el.appendChild(row);

    // The place shown is the place sent to (settlePlace): fixed on the first draw from a fresh list of actions (`fresh`:
    // an import refreshes it first; an AI answer drawn from history waits for the refresh it asks for), then changed only
    // by the person, or when it is no longer allowed (`moved`, shown and said before anything is sent). Once kept or
    // waiting, the place is plain words and the day is fixed.
    let chosen = '';
    let targets = [];
    let shown = null;
    let state = ''; // '', 'busy', 'kept', 'queued'
    let opened = ''; // the module whose form this last opened, while the place is unchanged
    const view = { el, keepBtn: keep, current, needsDay: false, moved: false, fresh };
    const target = () => shown;
    const done = () => state === 'kept' || state === 'queued';
    function drawPlace() {
      if (!done()) {
        targets = keepTargets(lastActions, current(), { last: chosen ? '' : lastPlace(summary.kind), objectWord: word('object', { a: true }) });
        const settled = settlePlace(targets, chosen);
        if (settled.moved) view.moved = true;
        if (view.fresh) chosen = settled.chosen;
        shown = settled.target;
      }
      const t = shown;
      if (dayRow) {
        const couldKeep = Boolean(t) || keepTargets(lastActions, { ...summary, date: '2000-01-01' }).length > 0;
        dayRow.hidden = !couldKeep;
        view.needsDay = couldKeep && !done();
        dayInput.disabled = done();
      }
      where.replaceChildren();
      // Kept, waiting or on its way, Keep stays focusable but does nothing (aria-disabled); with no place it is off.
      keep.disabled = !t;
      if (state) keep.setAttribute('aria-disabled', 'true');
      else keep.removeAttribute('aria-disabled');
      row.hidden = !t && pick === 'send';
      if (!t) {
        where.textContent = 'Nothing here can keep this';
        return;
      }
      if (!state) keep.setAttribute('aria-label', opened ? `Opened in ${opened}` : `Keep in ${t.moduleName}`);
      if (targets.length < 2 || done()) {
        where.textContent = `in ${t.moduleName}`;
        return;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-quiet btn-small chat-object-place-btn';
      btn.setAttribute('aria-haspopup', 'menu');
      btn.setAttribute('aria-label', `Keep in ${t.moduleName}: choose another place`);
      btn.title = 'Choose where';
      const label = document.createElement('span');
      label.textContent = `in ${t.moduleName}`;
      const caret = document.createElement('i');
      caret.className = 'fa-solid fa-caret-down fa-fw';
      caret.setAttribute('aria-hidden', 'true');
      btn.append(label, caret);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (state) return;
        const last = lastPlace(summary.kind);
        openMenu(btn, targets.map((x) => ({
          label: x.label,
          ...(pick === 'choose' ? { radio: true, checked: x.id === shown.id } : {}),
          hint: x.local && !canvas.isOpen(x.module) ? `Open ${x.moduleName} first` : x.id === last ? 'Last used' : '',
          onPick: async () => {
            if (state) return;
            chosen = x.id;
            if (opened) { opened = ''; keep.textContent = 'Keep'; }
            rememberPlace(summary.kind, x.id);
            drawPlace();
            refocus();
            if (pick === 'send') { await keepNow(); refocus(); }
          },
        })));
      });
      where.appendChild(btn);
    }
    // Focus on this object's place button, or its Keep when it has no menu (a redraw replaces the button).
    function refocus() {
      (where.querySelector('button') || keep).focus();
    }
    // Send to the place shown, once: Keep does nothing while it is on its way, and once kept. A place that opens a form
    // on the person's own page (a local action) says so, and may be opened again.
    // Answers null when nothing went (the note says why), else { outcome }: a promise of how it went (followRequest),
    // which also sets the row and, unless `quiet` (Keep ticked says it once for all), Chat's note.
    async function send(t, { quiet = false } = {}) {
      if (state || !t) return null;
      state = 'busy';
      drawPlace();
      const sent = await requestKeep(current(), question, t);
      if (sent.error) {
        state = '';
        drawPlace();
        setNote(sent.error, true);
        return null;
      }
      // A form still opening keeps the row busy; how it ended is said when it has.
      const onLate = (late) => { settle(t, late); setNote(late.text); };
      const outcome = followRequest(sent.id, t, { onLate }).then((o) => {
        settle(t, o);
        if (!quiet) setNote(o.text);
        return o;
      });
      return { outcome };
    }
    // The row once its request is known: kept (or sent, for a guest), waiting, opened in a form, or back to Keep.
    function settle(t, o) {
      if (o.result === 'starting') return; // still 'busy': followRequest says how it ends
      const out = { kept: 'kept', sent: 'kept', queued: 'queued', adding: 'queued', opened: 'opened' }[o.result] || '';
      state = out === 'kept' || out === 'queued' ? out : '';
      opened = out === 'opened' ? t.moduleName : opened;
      if (state) keep.classList.add(state);
      const words = {
        kept: o.result === 'sent' ? ['Sent', `Sent to ${t.moduleName}`] : ['Kept', `Kept in ${t.moduleName}`],
        queued: o.result === 'adding' ? ['Adding', `${t.moduleName} is adding it`] : ['Waiting', `Waiting for ${t.moduleName}`],
        opened: [`Opened in ${t.moduleName}`, `Opened in ${t.moduleName}`],
      }[out];
      if (words) {
        keep.textContent = words[0];
        keep.setAttribute('aria-label', words[1]);
      }
      if (o.result === 'queued') keep.title = t.askerOnly ? `Waiting: it is added when you next open ${t.moduleName}` : `Waiting: it is added when ${t.moduleName} is next open`;
      if (out) view.moved = false; // the person saw where it went
      drawPlace();
      if (out && onKept) onKept(keep);
    }
    async function keepNow() {
      if (state) return;
      const before = shown;
      await refreshActions();
      if (!shown || !before || shown.id !== before.id) {
        setNote(shown ? `${before ? before.moduleName : 'That place'} can't take this now. It goes in ${shown.moduleName}: press Keep again.` : 'Nothing here can keep that now.');
        view.moved = false; // said, and shown on the row
        return;
      }
      const going = await send(shown);
      if (going) await going.outcome;
    }
    keep.addEventListener('click', async (e) => {
      e.preventDefault();
      const focused = document.activeElement === keep;
      await keepNow();
      if (focused) refocus();
    });
    Object.assign(view, {
      target: () => target(),
      send,
      redraw: drawPlace,
      isKept: done,
      // "Same day for all": fills this one when it is empty, or when that field filled it before.
      setDay(day) {
        if (!dayInput || done() || (dayInput.value && !dayFromAll)) return;
        dayInput.value = day;
        dayFromAll = Boolean(day);
        dayChanged();
      },
    });
    drawPlace();
    drawnObjects.add(view);
    return view;
  }

  function objectPreview(summary, question) {
    const view = drawObject(summary, question, { fresh: false });
    soonRefresh();
    return view.el;
  }
  // AI answers drawn from history ask once for a fresh list of actions; their places are fixed from it.
  let refreshing = null;
  function soonRefresh() {
    refreshing ||= new Promise((resolve) => { setTimeout(resolve, 0); }).then(() => refreshActions()).finally(() => { refreshing = null; });
    return refreshing;
  }

  // How a command's message looks: its module's icon and colour, looked up when drawn (never stored), so a module's
  // new colour reaches its old messages. /ai and an AI answer are the host's: the robot, in gold (decision 4).
  function commandLook({ kind, command, module } = {}) {
    if (kind === 'ai' || command === 'ai') return { icon: 'robot', tint: 'gold', label: '/ai' };
    const m = module ? canvas.list().find((x) => x.id === module) : null;
    const icon = m && /^[a-z0-9-]{1,40}$/.test(m.icon || '') ? m.icon : 'terminal';
    return { icon, tint: canvas.colorOf ? canvas.colorOf(module) : null, label: command ? `/${command}` : '' };
  }

  // An AI answer's body: its text with each {{summary:N}} drawn as a preview with Keep, for anyone who can keep (the
  // space's actions), the author or not. `question` is what Keep records as asked: the asker's question when it is
  // known (the author's page, or the public answer's quote).
  // `meta` is what the stored answer keeps of the call: { sent, used, cut, leftOut, numbered }, drawn under it as the
  // AI used: line, with each [n] in the words a link to the object it names.
  function answerBody(text, summaries, question, meta = null) {
    const body = document.createElement('div');
    body.className = 'message-body text';
    const objects = Array.isArray(summaries) ? summaries : [];
    const cites = citePointers(meta);
    if (!objects.length) {
      body.innerHTML = renderMarkup(String(text || ''));
      linkCitations(body, cites);
    } else {
      body.classList.add('message-stack'); // words and cards a column apart (style.css)
      for (const p of answerParts(text, objects.length)) {
        if (p.summary !== undefined) body.appendChild(objectPreview(objects[p.summary], question || ''));
        else {
          const t = document.createElement('div');
          t.innerHTML = renderMarkup(p.text);
          linkCitations(t, cites);
          body.appendChild(t);
        }
      }
    }
    const foot = usedBlock(meta);
    if (foot) body.appendChild(foot);
    return body;
  }

  // --- what an answer used, and the objects it names ---
  // A pointer is resolved as the reader (POST /api/chat/citations), so a title shows only to someone who may see it. Asked
  // once for a few seconds, then again.
  const pointerId = (r) => `${r.module}|${r.kind}|${r.scope || ''}|${r.space || ''}|${r.id}`;
  const refOk = (r) => Boolean(r && typeof r.module === 'string' && typeof r.kind === 'string' && r.id !== undefined && r.id !== null && r.id !== '');
  const resolved = new Map(); // key -> { at, summary: Promise<object|null> }
  function resolveRefs(refs) {
    const want = refs.filter(refOk);
    const fresh = want.filter((r) => { const c = resolved.get(pointerId(r)); return !c || Date.now() - c.at > 15000; });
    if (fresh.length) {
      const batch = api('POST', '/api/chat/citations' + (guestToken ? `?guest=${encodeURIComponent(guestToken)}` : ''), { refs: fresh.slice(0, 50) }).then((out) => out.summaries || []).catch(() => []);
      fresh.slice(0, 50).forEach((r, i) => resolved.set(pointerId(r), { at: Date.now(), summary: batch.then((list) => list[i] || null) }));
    }
    return Promise.all(want.map((r) => resolved.get(pointerId(r)).summary));
  }
  const kindLabel = (r) => { const k = String(r.kind || word('object')); return k[0].toUpperCase() + k.slice(1); };
  // One object as a link that opens it where it lives; its title once known. One the reader can't see, or that is gone, is
  // said in plain words and is not a link.
  function objectLink(ref, { cite = '' } = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cite ? 'message-cite' : 'message-ref';
    b.textContent = cite || kindLabel(ref);
    const label = (t) => { b.setAttribute('aria-label', cite ? `Open ${t}` : t); b.title = `Open ${t}`; };
    label(kindLabel(ref));
    b.addEventListener('click', () => { if (typeof openObject === 'function') openObject(ref); else canvas.openRef(ref); });
    resolveRefs([ref]).then(([summary]) => {
      if (!summary || summary.error) {
        b.disabled = true;
        b.classList.add('is-gone');
        b.title = '';
        if (!cite) b.textContent = summary && summary.state === 'hidden' ? `${word('object', { a: true, cap: true })} you can't see` : `${word('object', { a: true, cap: true })} that is gone`;
        return;
      }
      const t = plainTitle(summary.title) || kindLabel(ref);
      if (!cite) b.textContent = t;
      label(t);
    });
    return b;
  }
  // The pointers [n] stand for: the attached ones come first in the numbering; `numbered`, when the answer holds it, is all.
  function citePointers(meta) {
    if (!meta) return [];
    if (Array.isArray(meta.numbered) && meta.numbered.length) return meta.numbered;
    return Array.isArray(meta.sent && meta.sent.attached) ? meta.sent.attached : [];
  }
  function linkCitations(root, pointers) {
    if (!pointers.length) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && n.parentElement.closest('a, code, pre, button') ? NodeFilter.FILTER_REJECT : /\[\d/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const parts = citationParts(node.nodeValue);
      if (!parts.some((p) => p.cite && p.cite.some((n) => refOk(pointers[n - 1])))) continue;
      const frag = document.createDocumentFragment();
      for (const p of parts) {
        if (p.text !== undefined) { frag.append(p.text); continue; }
        if (!p.cite.some((n) => refOk(pointers[n - 1]))) { frag.append(p.raw); continue; }
        frag.append('[');
        p.cite.forEach((n, i) => {
          if (i) frag.append(', ');
          if (refOk(pointers[n - 1])) frag.append(objectLink(pointers[n - 1], { cite: String(n) }));
          else frag.append(String(n));
        });
        frag.append(']');
      }
      node.replaceWith(frag);
    }
  }
  const usedWords = () => ({ object: word('object'), objects: word('object', { many: true }), space: word('space'), owner: word('owner'), member: word('member'), members: word('member', { many: true }), nameOf: (id) => { const m = canvas.list().find((x) => x.id === id); return m ? (m.displayName || m.name) : id; } });
  // "looked up N objects": a reader other than the asker is sent only the pointers they may open (the server drops the rest),
  // so N counts what they can see and there is no count of hidden ones. "and N others" is only for one that is gone by now.
  // Drawn at once as the count, then settled when the pointers are resolved.
  function lookedUp({ count, refs }) {
    const span = document.createElement('span');
    span.className = 'message-looked';
    const total = Math.max(count, refs.length);
    const noun = (c) => word('object', { many: c !== 1 });
    span.textContent = `looked up ${total} ${noun(total)}`;
    const shown = refs.filter(refOk).slice(0, 5);
    if (!shown.length) return span;
    resolveRefs(shown).then((list) => {
      const open = shown.filter((r, i) => list[i] && !list[i].error);
      const others = total - open.length;
      if (!open.length) return;
      span.append(': ');
      open.forEach((r, i) => { if (i) span.append(', '); span.append(objectLink(r)); });
      if (others > 0) span.append(` and ${others} ${others === 1 ? 'other' : 'others'}`);
    });
    return span;
  }
  // Under an answer: AI used: (the attached objects as links, then the counts of the rest), Not sent, left out to fit, and
  // cut short. Null for a message that holds none of it (one stored before the server kept it).
  function usedBlock(meta) {
    if (!meta || !meta.sent) return null;
    const parts = aiUsedParts(meta.sent, meta.leftOut, usedWords());
    const wrap = document.createElement('div');
    wrap.className = 'message-used';
    const line = document.createElement('p');
    line.className = 'message-used-line';
    const lead = document.createElement('span');
    lead.className = 'message-used-lead';
    lead.textContent = 'AI used:';
    line.append(lead);
    const attached = (Array.isArray(meta.sent.attached) ? meta.sent.attached : []).filter(refOk);
    const items = [];
    for (const r of attached) items.push(objectLink(r));
    for (const t of parts.counts) items.push(t);
    const looked = lookupOf(meta.sent);
    if (looked.count) items.push(lookedUp(looked));
    if (!items.length) items.push('just your question');
    items.forEach((it, i) => { line.append(i ? ', ' : ' ', it); });
    line.append('.');
    wrap.append(line);
    for (const t of [parts.notSent, parts.fit, meta.cut ? 'The answer was cut short.' : '']) {
      if (!t) continue;
      const p = document.createElement('p');
      p.className = 'message-used-note';
      p.textContent = t;
      wrap.append(p);
    }
    return wrap;
  }

  async function refreshActions() {
    const id = spaceId();
    if (!id) { lastActions = []; return; }
    try {
      lastActions = (await api('GET', `/api/spaces/${encodeURIComponent(id)}/actions`)).actions || [];
    } catch {
      lastActions = [];
    }
    // Where each drawn object would go follows the new list; one no longer on the page is forgotten.
    for (const v of drawnObjects) {
      if (v.el.isConnected) { v.seen = true; v.fresh = true; v.redraw(); } else if (v.seen) drawnObjects.delete(v);
    }
  }

  // Ask a place from keepTargets to keep one object: the object itself to a module that takes it, the older flat fields
  // to one that declares no `takes`. A view (`local`) runs only on the person's own open module, as a command does, and
  // opens its form there; it is never asked for while that module is closed (the request would only expire). Answers
  // { id } (the request's id), or { error } with the sentence to show.
  async function requestKeep(summary, question, target, extra = {}) {
    if (!target) return { error: 'Nothing here can keep that yet.' };
    if (target.local && !canvas.isOpen(target.module)) return { error: `${target.moduleName} isn't open.` };
    try {
      const out = await api('POST', `/api/spaces/${encodeURIComponent(spaceId())}/action`, { action: target.id, input: { ...keepTargetInput(target, summary, question), ...extra } });
      return { id: out && out.id };
    } catch (err) {
      return { error: sentence(err.message) || 'Could not keep that.' };
    }
  }

  const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
  const guest = () => (typeof isGuest === 'function' ? Boolean(isGuest()) : !(getMe() && getMe().key));
  // How a request went (GET /api/spaces/:id/action/:requestId): asked every half second for about five seconds, until it
  // is done or has expired. The bus answers `pending` at first even for a module that is open and takes it at once, so
  // only what it says after that counts. A guest's is never read (guests share one sender). A form that opened is
  // brought forward (on a phone, it replaces Chat in view). A form not opened yet ('starting') is still followed, more
  // slowly, until it opens or its request expires; `onLate` hears how it ended (else Chat's note says it).
  // Answers requestOutcome's { result, text, note, error, moduleName }.
  async function followRequest(requestId, target, { as = target.as, onLate = null } = {}) {
    const id = spaceId();
    const read = async () => {
      try {
        return await api('GET', `/api/spaces/${encodeURIComponent(id)}/action/${encodeURIComponent(requestId)}`);
      } catch {
        return null;
      }
    };
    const outcomeOf = (status) => ({ ...requestOutcome(status, { moduleName: target.moduleName, as, local: target.local, askerOnly: target.askerOnly }), moduleName: target.moduleName, askerOnly: Boolean(target.askerOnly) });
    let status = null;
    if (id && requestId && !guest()) {
      for (let i = 0; i < 10; i += 1) {
        await sleep(500);
        status = await read();
        if (!status || status.status === 'done' || status.status === 'expired') break;
      }
    }
    const outcome = outcomeOf(status);
    if (outcome.result === 'opened') bringForward(target.module);
    if (outcome.result === 'starting') followLate(read, outcomeOf, target, onLate);
    return outcome;
  }
  // A form's request may still be taken until it expires, a minute after it was asked (the bus's openOnly): asked every
  // two seconds until it is opened, done or expired (at most 70 seconds). Unreadable, or still waiting then, reads as
  // "isn't open".
  async function followLate(read, outcomeOf, target, onLate) {
    const until = Date.now() + 70000;
    let status = null;
    while (Date.now() < until) {
      await sleep(2000);
      status = await read();
      if (!status || status.status !== 'pending') break;
    }
    let late = outcomeOf(status);
    if (late.result === 'starting' || late.result === 'sent') late = outcomeOf({ status: 'expired' });
    if (late.result === 'opened') bringForward(target.module);
    if (typeof onLate === 'function') onLate(late);
    else setNote(late.text);
  }
  // A module's form just opened on this page: show that module, as its tab or switch does (canvas.show).
  function bringForward(moduleId) {
    if (moduleId && typeof canvas.show === 'function') canvas.show(moduleId);
  }

  // --- Send to... (plan-object-handoff.md, "Send to...") ---
  // The last place chosen for each kind of message (text, link, picture, objects), in this browser.
  const sendKey = (what) => `chat-send-place:${what}`;
  const lastSend = (what) => { try { return localStorage.getItem(sendKey(what)) || ''; } catch { return ''; } };
  const rememberSend = (what, id) => { try { localStorage.setItem(sendKey(what), id); } catch { /* not remembered */ } };
  const objectNouns = () => ({ one: word('object'), many: word('object', { many: true }) });

  // What a message is, and where it can go, from the actions held now. Only a message held in a space's chat: an aside
  // has none, and an import's preview has its own Keep.
  function sendPlan(entry) {
    if (!spaceId() || !entry || !entry.chat || !canvas) return null;
    const text = globalThis.hostText || {};
    const groups = messageObjects(entry, { plain: text.plain });
    if (!groups.length) return null;
    const what = groups[0].what;
    const choices = sendChoices(lastActions, groups, { last: lastSend(what), objectWord: word('object', { a: true }), ...objectNouns() });
    return choices.length ? { what, choices } : null;
  }

  // A picture's bytes as a JPEG of its first frame, for a module that takes only JPEG, PNG or WebP (a GIF).
  async function asJpeg(blob) {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext('2d');
    g.fillStyle = 'white'; // a JPEG has no see-through parts: what was see-through reads as paper, not black
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0);
    bmp.close();
    const out = await new Promise((resolve) => { c.toBlob(resolve, 'image/jpeg', 0.9); });
    if (!out) throw new Error('That picture could not be read.');
    return out;
  }

  // A picture (decision 15): uploaded into the place's own uploads, as this person, in this space; then the action names
  // the file. A request that fails takes its upload back off; one that never runs is swept by the server.
  async function sendPicture(entry, choice) {
    const { summary, target } = choice.sends[0];
    const sorry = `That picture can't be sent to ${target.moduleName}.`;
    const fail = (text) => ({ result: 'failed', text, moduleName: target.moduleName });
    let blob = await pictureBlob(entry); // the server holds a picture a short while, then it is gone
    if (!(blob instanceof Blob)) return fail('That picture is no longer here.');
    const id = spaceId();
    let name = summary.details.name;
    try {
      if (!/^image\/(jpeg|png|webp)$/.test(blob.type)) {
        blob = await asJpeg(blob);
        name = `${name.replace(/\.[^.]+$/, '') || 'picture'}.jpg`;
      }
      const where = new URLSearchParams({ scope: 'space', space: id, name });
      const up = await api('POST', `/api/modules/${encodeURIComponent(target.module)}/uploads?${where}`, blob, blob.type);
      const fileId = up && up.file && up.file.id;
      if (!fileId) return fail(sorry);
      const drop = () => api('DELETE', `/api/modules/${encodeURIComponent(target.module)}/uploads/${encodeURIComponent(fileId)}?${new URLSearchParams({ scope: 'space', space: id })}`).catch(() => {});
      const sent = await requestKeep({ kind: 'image', title: name, details: { upload: fileId, name } }, '', target);
      if (sent.error) {
        drop();
        return fail(sorry);
      }
      const outcome = await followRequest(sent.id, target);
      if (pictureRefused(outcome)) drop();
      return outcome;
    } catch {
      return fail(sorry);
    }
  }

  // One entry of Send to... chosen: sent at once (decision 14), then one note says how it went.
  async function sendChoice(entry, plan, choice) {
    if (choice.local && !canvas.isOpen(choice.module)) { setNote(`${choice.moduleName} isn't open.`); return; }
    rememberSend(plan.what, choice.id);
    setNote(`Sending to ${choice.moduleName}...`);
    let outcomes = [];
    const first = choice.sends[0].target;
    const keeper = linkKeeper(lastActions);
    if (plan.what === 'picture') {
      outcomes = [await sendPicture(entry, choice)];
    } else if (choice.what === 'link' && typeof keepStoredLink === 'function' && entry.stored && entry.preview && keeper
      && keeper.module === choice.module && first.action && first.action.name === 'saveLink') {
      // A message's own link goes through the link's Keep, so its "Kept by" mark is set as today.
      try {
        const out = await keepStoredLink(entry);
        if (out && out.status === 'kept') outcomes = [{ result: 'kept', text: `Already kept by ${(out.message && out.message.kept && out.message.kept.who) || 'someone'}.` }];
        else outcomes = [out && out.id ? await followRequest(out.id, first) : { ...requestOutcome(null, { moduleName: first.moduleName }), moduleName: first.moduleName }];
      } catch (err) {
        outcomes = [{ result: 'failed', text: err.message || `${first.moduleName} couldn't add that.` }];
      }
    } else {
      // The asker's question goes with a public AI answer's objects, as its Keep sends it.
      const question = entry.kind === 'ai' && entry.visibility === 'public' && entry.question ? entry.question.text : '';
      const waits = [];
      for (const s of choice.sends) {
        const sent = await requestKeep(s.summary, question, s.target, plan.what === 'objects' ? {} : wordsExtra(s.target, s.summary));
        waits.push(sent.error ? { result: 'failed', text: sent.error, moduleName: s.target.moduleName } : followRequest(sent.id, s.target));
      }
      outcomes = await Promise.all(waits);
    }
    const more = !choice.more ? '' : choice.more === 1 ? ' The other one: use its own Keep.' : ` The other ${choice.more}: use each one's own Keep.`;
    // A form still opening: the note says how it ended once it has (followRequest's onLate is not given here).
    setNote(`${outcomesWords(outcomes, { moduleName: choice.moduleName })}${more}`);
  }

  // Send to... on a message's menu: the places from a fresh list of actions, opened from the same button. A private
  // message is its author's only (decision 18): the menu says the space will see it.
  async function sendTo(entry, trigger) {
    await refreshActions();
    const plan = sendPlan(entry);
    if (!plan) { setNote('Nothing here can take that now.'); return; }
    const items = [];
    // On every entry's own hint, so the keyboard and a screen reader reach it with the entry.
    const seen = entry.visibility === 'private' ? `Everyone in this ${word('space')} will see it` : '';
    for (const c of plan.choices) {
      const m = canvas.list().find((x) => x.id === c.module);
      const closed = c.local && !canvas.isOpen(c.module);
      items.push({
        icon: m && /^[a-z0-9-]{1,40}$/.test(m.icon || '') ? m.icon : 'share',
        tint: canvas.colorOf ? canvas.colorOf(c.module) : null,
        label: c.label,
        hint: [closed ? `Open ${c.moduleName} first` : c.hint, seen].filter(Boolean).join('; '),
        onPick: () => sendChoice(entry, plan, c),
      });
    }
    if (trigger && trigger.isConnected) openMenu(trigger, items);
  }

  async function askAbout({ question, refs } = {}) {
    // A module's ask: its words, or none with an object, when the server supplies the question (What should I know about it?).
    const q = String(question || '').trim();
    const kept = (refs || []).filter((r) => r && r.module && r.id);
    if (!q && !kept.length) { setNote('Type a question first.'); return { ok: false }; }
    const prev = aiContext;
    aiContext = kept.map((ref) => ({ ref }));
    setView('assistant'); // a module's question is answered where answers go
    paintContext();
    try {
      input().focus();
      const ok = await runAi(q);
      return { ok };
    } finally {
      aiContext = prev;
      paintContext();
    }
  }

  // --- whether the AI is there, and what is attached to the next question ---
  // Asked of the server (GET .../ai) when Chat loads a space and when the Assistant shows; a guest is known without asking.
  // Unknown (the ask failed) is treated as there: the server has the last word when a question is sent.
  async function checkAi(force = false) {
    const id = spaceId();
    if (!id || isHome()) return aiState;
    if (!force && aiState.known && Date.now() - aiState.at < 30000) return aiState;
    const was = `${aiState.known}${aiState.available}${aiState.reason}`;
    if (isGuest()) aiState = { known: true, available: false, reason: 'guest', why: '', at: Date.now() };
    else {
      try {
        const r = await api('GET', `/api/spaces/${encodeURIComponent(id)}/ai`);
        aiState = { known: true, available: Boolean(r.available), reason: r.available ? '' : String(r.reason || 'other'), why: r.available ? '' : String(r.why || 'AI is not available'), at: Date.now() };
      } catch {
        aiState = { known: false, available: true, reason: '', why: '', at: 0 };
      }
    }
    paintAiState();
    if (was !== `${aiState.known}${aiState.available}${aiState.reason}`) resetHint();
    return aiState;
  }
  function aiLine() {
    return aiState.known && !aiState.available ? aiNotice(aiState.reason, aiState.why, { guests: word('guest', { many: true, cap: true }), owner: word('owner'), space: word('space') }) : '';
  }
  // The state line above the box: only in the Assistant, only when the AI is not there.
  function paintAiState() {
    const el = $('chat-ai-state');
    if (!el) return;
    const text = view === 'assistant' && spaceId() && !isHome() ? aiLine() : '';
    el.hidden = !text;
    if (el.textContent !== text) el.textContent = text;
  }
  // The objects dropped on Chat for the next question, as chips the person can take off. They go with one question.
  function paintContext() {
    const wrap = $('chat-ai-context');
    if (!wrap) return;
    wrap.replaceChildren();
    wrap.hidden = aiContext.length === 0;
    aiContext.forEach((c, i) => {
      const chip = document.createElement('span');
      chip.className = 'sdk-chip-removable chat-ai-chip';
      const kind = String(c.ref.kind || word('object'));
      const mod = canvas.list().find((m) => m.id === c.ref.module);
      const label = `${kind[0].toUpperCase()}${kind.slice(1)}${mod ? ` from ${mod.displayName || mod.name}` : ''}`;
      const text = document.createElement('span');
      text.textContent = label;
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'sdk-chip-x';
      x.setAttribute('aria-label', `Do not ask about ${label}`);
      x.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
      x.addEventListener('click', () => { aiContext.splice(i, 1); paintContext(); input().focus(); });
      chip.append(text, x);
      wrap.appendChild(chip);
    });
    if (aiContext.length) {
      const said = document.createElement('span');
      said.className = 'visually-hidden';
      said.textContent = `${aiContext.length} ${word('object', { many: aiContext.length !== 1 })} will go with your next question.`;
      wrap.appendChild(said);
    }
  }

  // The question and the answer come back stored, both private (plan-chat-model.md, decision 1): drawn from what the
  // server returns, never a copy made here. Nothing is posted to the chat; the author makes the answer public with its
  // badge.
  async function runAi(question) {
    const id = spaceId();
    if (!id) { setNote(`AI is only in ${word('space', { a: true })}.`); return false; }
    if (!String(question || '').trim() && !aiContext.length) { setNote('Type your question after /ai.', true); return false; }
    const q0 = String(question || '').trim();
    if (q0 && [...q0].length < 3) { setNote('Ask a question of at least 3 characters.', true); return false; }
    const tooLong = questionTooLong(question);
    if (tooLong) { setNote(tooLong, true); return false; }
    if (aiBusy) { setNote('Still asking. Wait for the answer.'); return false; }
    // Known to be unavailable: look again once (it may have been set up since), then say why instead of sending.
    if (aiState.known && !aiState.available && !isGuest()) await checkAi(true);
    if (aiState.known && !aiState.available) { setNote(aiLine(), true); return false; }
    aiBusy = true;
    input().setAttribute('aria-busy', 'true');
    setNote('Asking the AI...');
    // After a few seconds the wait is most likely look-ups (a plain answer is quick).
    const lookingTimer = setTimeout(() => { if (aiBusy) setNote('Looking things up...'); }, 6000);
    try {
      const reply = await api('POST', `/api/spaces/${encodeURIComponent(id)}/ai`, {
        question: String(question || '').trim(),
        refs: aiContext.map((c) => c.ref).filter(Boolean),
        tz: askZone(),
      });
      setNote('');
      // What was attached went with this question only.
      aiContext = [];
      paintContext();
      if (reply.question) addStored(reply.question);
      if (reply.message) addStored(reply.message);
      return true;
    } catch (err) {
      // The server's own sentence for a refusal (403, 429, 400); a failure of the AI service is said plainly.
      const said = String(err.message || 'The AI could not answer.');
      setNote(said[0].toUpperCase() + said.slice(1) + (/[.!?]$/.test(said) ? '' : '.'), true);
      return false;
    } finally {
      clearTimeout(lookingTimer);
      aiBusy = false;
      input().removeAttribute('aria-busy');
    }
  }

  function postCommand(parsed, chosen) {
    return api('POST', `/api/spaces/${encodeURIComponent(spaceId())}/command`, {
      name: parsed.name,
      text: parsed.rest,
      module: chosen.module,
    });
  }

  function askClosed(chosen, parsed) {
    const name = chosen.moduleName;
    const box = document.createElement('div');
    box.className = 'chat-closed-ask';
    box.dataset.in = 'assistant'; // the person's own question, in the Assistant
    const q = document.createElement('p');
    q.textContent = `The ${name} is not open. What would you like to do?`;
    const actions = document.createElement('div');
    actions.className = 'chat-closed-actions';
    const finish = () => box.remove();
    const go = (open) => async () => {
      finish();
      try {
        echo(parsed, chosen, await postCommand(parsed, chosen));
        if (input().value.trim() === parsed.raw.trim()) { input().value = ''; resizeChatInput(); resetHint(); }
        if (open) canvas.open(chosen.module);
      } catch (err) {
        setNote(err.message || `The ${name} could not take that.`, true);
      }
    };
    for (const [label, primary, onClick] of [
      [`Add it and open ${name}.`, true, go(true)],
      [`Add it and keep ${name} closed.`, false, go(false)],
      ['Cancel', false, finish],
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = primary ? 'btn btn-primary btn-small' : 'btn btn-small';
      b.textContent = label;
      b.addEventListener('click', onClick);
      actions.appendChild(b);
    }
    box.append(q, actions);
    $('messages').appendChild(box);
    $('messages').scrollTop = $('messages').scrollHeight;
  }

  async function runCommand(parsed) {
    const hits = matchesFor(parsed.name);
    if (!hits.length) {
      setNote(`No command /${parsed.name}`, true);
      return false;
    }
    // A known command runs in the Assistant: typed in the Discussion, it switches there first (GitHub #203).
    setView('assistant');
    const openHits = hits.filter((h) => !h.module || canvas.isOpen(h.module));
    if (hits.length > 1 && openHits.length !== 1) {
      const names = hits.map((h) => h.moduleName).join(' or ');
      setNote(`Which one: ${names}? Use the picker.`, true);
      return false;
    }
    const chosen = openHits[0] || hits[0];
    if (chosen.module && !canvas.isOpen(chosen.module)) {
      askClosed(chosen, parsed);
      return false;
    }
    try {
      echo(parsed, chosen, await postCommand(parsed, chosen));
      return true;
    } catch (err) {
      setNote(err.message || `The ${chosen.moduleName} could not take that.`, true);
      return false;
    }
  }

  function droppedLine(dropped, over) {
    const parts = [];
    const list = Array.isArray(dropped) ? dropped : [];
    if (list.length) {
      const counts = new Map();
      for (const d of list) counts.set(d.why, (counts.get(d.why) || 0) + 1);
      const phrase = (why, n) => {
        if (why === 'it has no title') return n === 1 ? '1 had no title' : `${n} had no title`;
        if (why === 'it has no content') return n === 1 ? '1 had no content' : `${n} had no content`;
        if (why === 'it is a picture') return n === 1 ? "1 was a picture, which can't be imported" : `${n} were pictures, which can't be imported`;
        if (why === 'not valid JSON') return n === 1 ? '1 was not valid JSON' : `${n} were not valid JSON`;
        if (why === `not ${word('object', { a: true })}`) return n === 1 ? `1 was not ${word('object', { a: true })}` : `${n} were not ${word('object', { many: true })}`;
        return `${n} ${why}`;
      };
      parts.push(`${list.length} could not be read: ${[...counts].map(([w, n]) => phrase(w, n)).join(', ')}.`);
    }
    if (over) parts.push(`${over} more were left out: at most 50 at a time.`);
    return parts.join(' ');
  }

  // Why an import could not be read: in the status area, the text staying in the box to fix.
  function setImportWhy(text) {
    if (text) setNote(text, true);
  }

  async function showImport(result) {
    const objects = (result && result.objects) || [];
    const dropped = droppedLine(result && result.dropped, result && result.over);
    if (!objects.length) {
      setImportWhy(dropped || 'Nothing in that could be read.');
      return false;
    }
    // The places come from the modules on now, not those on when the page was loaded.
    await refreshActions();
    setNote('');
    const body = document.createElement('div');
    body.className = 'message-body text';
    const rows = [];
    for (const obj of objects) {
      const row = document.createElement('label');
      row.className = 'chat-import-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = true;
      box.setAttribute('aria-label', 'Keep this one');
      const view = drawObject({ ...obj, basis: 'imported' }, '', {
        pick: 'choose',
        askDay: true,
        onKept: () => {
          if (view.isKept()) box.disabled = true;
          refresh();
        },
      });
      row.append(box, view.el);
      rows.push({ box, view });
      body.appendChild(row);
    }
    const foot = document.createElement('div');
    foot.className = 'chat-import-foot';
    const keepTicked = document.createElement('button');
    keepTicked.type = 'button';
    keepTicked.className = 'btn btn-primary btn-small';
    // One day for every object still without one (decision 10).
    const undated = rows.filter((r) => r.view.needsDay);
    let sameDay = null;
    if (undated.length > 1) {
      sameDay = document.createElement('label');
      sameDay.className = 'chat-import-sameday';
      const field = document.createElement('input');
      field.type = 'date';
      field.addEventListener('change', () => { for (const r of rows) if (r.view.needsDay) r.view.setDay(field.value); });
      sameDay.append('Same day for all', field);
    }
    const droppedEl = document.createElement('p');
    droppedEl.className = 'chat-import-dropped';
    droppedEl.textContent = dropped;
    // Ticked and not yet kept. Each goes to the place its row shows (settlePlace), never another.
    const ticked = () => rows.filter((r) => r.box.checked && !r.view.isKept());
    const pickOf = (r) => {
      const target = r.view.target();
      return { r, obj: r.view.current(), kind: r.view.current().kind, target, open: Boolean(target && target.local && canvas.isOpen(target.module)) };
    };
    // The count is what Keep ticked would send: not a form, a closed module or an object with nowhere to go.
    const refresh = () => {
      keepTicked.textContent = `Keep ticked (${splitTicked(ticked().map(pickOf)).going.length})`;
    };
    refresh();
    body.addEventListener('change', refresh);
    const objectWords = () => ({ one: word('object'), many: word('object', { many: true }) });
    // Keep ticked keeps each ticked object in its own place; the confirm names them ("Keep 3 flights and 2 stays in
    // Planner, 1 task in To-do?") and what is left out: a place that opens a form (one at a time, with its own Keep), one
    // whose module is closed, and an object nothing here can keep. A place no longer allowed has moved on its row, and the
    // confirm says so first.
    keepTicked.addEventListener('click', async () => {
      if (!ticked().length) return;
      // A row's moved mark stays until it is reported here (or kept on its own), however long ago its place moved.
      await refreshActions();
      const movedRows = ticked().filter((r) => r.view.moved);
      const moved = movedRows.length;
      for (const r of movedRows) r.view.moved = false;
      const split = splitTicked(ticked().map(pickOf));
      const leftOut = leftOutWords(split, objectWords());
      const movedWords = moved ? `${moved} ${moved === 1 ? 'has' : 'have'} a new place: the one before is no longer allowed. ` : '';
      if (!split.going.length) { setNote(`${movedWords}${leftOut || 'Nothing here can keep those yet.'}`.trim()); refresh(); return; }
      const what = keepCountWords(split.going.map((p) => ({ kind: p.kind, moduleName: p.target.moduleName })), objectWords());
      // Loaded when asked: this file also runs in Node (the checks), where the page's /confirm.js is not a path.
      const { confirmDialog } = await import('/confirm.js');
      if (!await confirmDialog({ title: `Keep ${what}?`, message: `${movedWords}${leftOut}`.trim(), action: 'Keep' })) { refresh(); return; }
      keepTicked.disabled = true;
      // One after another, as before; then how they all went, in one note.
      const waits = [];
      for (const p of split.going) {
        const going = await p.r.view.send(p.target, { quiet: true });
        if (going) waits.push(going.outcome);
      }
      const outcomes = await Promise.all(waits);
      if (outcomes.length) setNote(outcomesWords(outcomes));
      keepTicked.disabled = false;
      refresh();
    });
    foot.append(...[keepTicked, sameDay, droppedEl].filter(Boolean));
    body.appendChild(foot);
    const entry = {
      who: 'Imported',
      text: objects.map((o) => [o.title, o.content].filter(Boolean).join('\n')).join('\n\n'),
      at: new Date(),
      chat: false,
    };
    const el = frameMessage({
      name: 'Imported',
      at: entry.at,
      visibility: 'private',
      kind: 'ai',
      icon: 'file-import',
      body,
      entry,
    });
    el.classList.add('chat-import-msg');
    setView('assistant'); // what is brought in is the person's own until kept
    $('messages').appendChild(el);
    $('messages').scrollTop = $('messages').scrollHeight;
    return true;
  }

  async function postCheck(body, type) {
    const id = spaceId();
    if (!id) throw new Error(`Bring research in from ${word('space', { a: true })}.`);
    const result = await fetch(`/api/spaces/${encodeURIComponent(id)}/objects/check`, {
      method: 'POST',
      headers: { 'content-type': type, accept: 'application/json' },
      body,
    });
    const json = await result.json();
    if (!result.ok) throw new Error(json.error || 'That could not be read.');
    return json;
  }

  // Pasted answer text, run through the same checker the old paste box used; true when its objects are shown (the box
  // then empties), false with the reason in the status area (the text stays).
  async function checkObjects(input) {
    setNote('');
    try {
      return await showImport(await postCheck(input, 'text/plain'));
    } catch (err) {
      setImportWhy(err.message || 'That could not be read.');
      return false;
    }
  }

  // The Assistant's two tools (copy prompt, bring in research) show only where this person can keep objects (importOk).
  function paintModeTools() {
    const bar = $('chat-format-bar');
    if (!bar) return;
    const assistant = view === 'assistant';
    for (const el of bar.querySelectorAll('[data-for]')) {
      const mine = el.dataset.for === 'assistant';
      const off = mine ? !(assistant && importOk) : assistant;
      el.hidden = off;
      if (off) el.dataset.off = '1'; else delete el.dataset.off;
      delete el.dataset.collapsed;
    }
    $('chat-help-popup').hidden = true;
    $('chat-emoji-popup').hidden = true;
    document.dispatchEvent(new CustomEvent('chat-tools-changed'));
  }

  async function refreshImport() {
    await refreshActions();
    let ok = false;
    try {
      const id = spaceId();
      if (id && getMe() && canKeepAny(lastActions)) {
        const avail = await api('GET', `/api/spaces/${encodeURIComponent(id)}/objects/check`);
        ok = Boolean(avail.available);
      }
    } catch {
      ok = false;
    }
    importOk = ok;
    paintModeTools();
  }

  for (const v of CHAT_VIEWS) {
    $(`chat-view-${v}`)?.addEventListener('click', (e) => {
      e.preventDefault();
      setView(v);
    });
  }
  $('chat-command').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    $('chat-help-popup').hidden = true;
    $('chat-emoji-popup').hidden = true;
    if ($('chat-command-menu')) hidePicker();
    else showPicker();
  });
  // Bring in research: what is in the box, if it holds an answer; else it says where to paste one.
  $('chat-bring')?.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setView('assistant');
    const text = input().value.trim();
    if (!text) { setNote('Paste the answer in the box, then press Enter.'); input().focus(); return; }
    if (await checkObjects(text)) { input().value = ''; resizeChatInput(); resetHint(); }
  });
  $('chat-import-copy')?.addEventListener('click', async (e) => {
    e.preventDefault();
    setNote('');
    try {
      const fmt = await api('GET', '/api/objects/format');
      const text = (fmt && fmt.instructions) || '';
      try {
        await navigator.clipboard.writeText(text);
        setNote('Copied. Paste it into the other AI first.');
      } catch {
        setNote('This browser would not copy it. Allow clipboard access and try again.', true);
      }
    } catch (err) {
      setNote(err.message || 'The prompt could not be copied.', true);
    }
  });
  input().addEventListener('input', () => {
    const parsed = parseCommand(input().value);
    if (input().value.trim() === '/') showPicker();
    if (!parsed) input().placeholder = defaultHint();
    else if (parsed.name === 'ai') input().placeholder = 'Ask the AI a question';
    else {
      const hit = matchesFor(parsed.name)[0];
      if (hit && hit.hint) input().placeholder = hit.hint;
    }
  });

  $('chat').addEventListener('drop', (event) => {
    const raw = event.dataTransfer?.getData(OBJECT_MIME);
    // An object dropped while asking the AI: plain words in the Assistant (routeLine).
    const typed = parseCommand(input().value || '');
    const asking = view === 'assistant' && (!typed || typed.name === 'ai');
    if (!raw || !asking) return;
    try {
      const ref = JSON.parse(raw);
      if (ref && ref.module && ref.id) {
        if (!aiContext.some((c) => c.ref.module === ref.module && c.ref.id === ref.id)) aiContext.push({ ref });
        setNote('');
        paintContext();
      }
    } catch {
      // not an object
    }
  });

  // An accepted command's echo: the private message the server stored and returned (plan-chat-model.md, decision 8). A
  // guest's is not stored (guests share one sender), so it is drawn on this page only, private and not a button.
  function echo(parsed, chosen, reply) {
    if (reply && reply.message) { addStored(reply.message); return; }
    if (!parsed.rest) return;
    const me = getMe();
    addStored({ who: me?.displayName || 'You', by: me?.key || '', text: parsed.rest, at: Date.now(), visibility: 'private', kind: 'command', command: parsed.name, module: chosen?.module || '' }, { local: true });
  }

  return {
    resetHint,
    // true when the command was taken (the box empties); false leaves the text in the box to fix or send again.
    async handleSubmit(text) {
      setNote('');
      const parsed = parseCommand(text);
      if (!parsed) return false;
      return runCommand(parsed);
    },
    loadThread,
    answerBody,
    commandLook,
    syncEmpty,
    // The views (GitHub #203): which is showing, where a typed line goes, a message placed, Chat come into sight.
    view: () => view,
    setView,
    routeLine: (text) => (!String(text || '').trim() && view === 'assistant' && aiContext.length ? { run: 'ai', view, line: '' } : routeLine(text, view)),
    arrived,
    seen,
    refreshActions,
    hidePicker,
    // A pasted answer sent from the box (routeLine 'import'): true when its objects are shown.
    importText: (text) => checkObjects(text),
    // Words typed in the Assistant: asked of the AI. True when the answer came.
    // The Assistant is showing and an object waits to go with the next question: an empty box may send (routeLine).
    canAskEmpty: () => view === 'assistant' && aiContext.length > 0,
    ask: (text) => { setNote(''); if (view !== 'assistant') setView('assistant'); return runAi(text); },
    checkAi,
    note: setNote,
    askAbout,
    // Send to... (plan-object-handoff.md): whether a message's menu offers it, from the actions held now; and the menu.
    canSendTo: (entry) => Boolean(sendPlan(entry)),
    sendTo,
  };
}
