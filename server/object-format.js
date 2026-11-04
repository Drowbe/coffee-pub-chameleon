// The objects format: what an AI (this server's or another) may write, and how it is read.
// One checker for the Assistant's answers and for an import. Nothing here names a module.

'use strict';

const { word } = require('./words');
const { productName } = require('./product-name');
const fileFormat = require('./file-format');

const FORMAT_VERSION = fileFormat.FORMAT_VERSIONS.objects;
const FENCE = 'objects'; // the label of the format's fenced block (plan-kind-names.md)
const FILE_SUFFIX = '.objects.json';
const MAX_IMPORT_OBJECTS = 50;
const MAX_IMPORT_CANDIDATES = 200;
const MAX_IMPORT_BYTES = 262144;
const MAX_TITLE = 80;
const MAX_CONTENT = 6000;
const MAX_TAG = 24;
const MAX_TAGS = 5;
const MAX_PLACE_NAME = 120;
const MAX_LINKS = 5;
const MAX_LINK_TITLE = 100;
const MAX_LINK_URL = 500;
const MAX_SOURCES = 12;

const BASES = ['general', 'items', 'both'];
// The kinds (plan-object-handoff.md, "Kinds and their details"). TRAVEL_KINDS are the 13 from before the plan plus
// attraction (a theme park, a zoo: #246, a stop like a sight); the prompt lists them when no enabled module declares
// `takes` (kindsTaken). KINDS is every kind an AI or an import may write. HANDOFF_KINDS pass only between pages
// (cleanObject's `handoff`), never from an AI or an import.
const TRAVEL_KINDS = Object.freeze(['flight', 'train', 'bus', 'ferry', 'car', 'hotel', 'restaurant', 'cafe', 'bar', 'sight', 'museum', 'attraction', 'tour', 'show']);
const KINDS = [...TRAVEL_KINDS, 'event', 'task', 'poll', 'note', 'link'];
const HANDOFF_KINDS = Object.freeze(['image']);

// Each kind's `details` fields and their value types. Every field is optional; a bad one is dropped on its own.
//   when      YYYY-MM-DDTHH:MM, YYYY-MM-DD or HH:MM, local, no zone    point   { code, name } or a string
//   text:N    plain text, Markdown removed, cut at N                   count:N a whole number 1 to N
//   minutes   a whole number 1 to 10080                                flag    true or false
//   options   2 to 10 strings of up to 80, duplicates dropped          upload  a file id (handoffs only)
const MAX_MINUTES = 10080;
const MAX_POINT_NAME = 120;
const MAX_OPTION = 80;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;
const UPLOAD_ID = /^[a-f0-9]{24}$/; // a module upload's file id (server/module-uploads.js)
const STOP_DETAILS = { starts: 'when', ends: 'when', minutes: 'minutes', address: 'text:200' };
const DETAILS = deepFreeze({
  flight: { airline: 'text:60', number: 'text:20', from: 'point', to: 'point', departs: 'when', arrives: 'when', minutes: 'minutes', terminal: 'text:30', gate: 'text:30', seat: 'text:30', class: 'text:30', reference: 'text:60' },
  train: { operator: 'text:60', number: 'text:20', from: 'point', to: 'point', departs: 'when', arrives: 'when', minutes: 'minutes', platform: 'text:30', carriage: 'text:30', seat: 'text:30', class: 'text:30', reference: 'text:60' },
  bus: { operator: 'text:60', number: 'text:20', from: 'point', to: 'point', departs: 'when', arrives: 'when', minutes: 'minutes', seat: 'text:30', reference: 'text:60' },
  ferry: { operator: 'text:60', number: 'text:20', from: 'point', to: 'point', departs: 'when', arrives: 'when', minutes: 'minutes', cabin: 'text:30', seat: 'text:30', reference: 'text:60' },
  car: { company: 'text:60', from: 'point', to: 'point', departs: 'when', arrives: 'when', class: 'text:30', reference: 'text:60' },
  hotel: { address: 'text:200', checkIn: 'when', checkOut: 'when', roomType: 'text:60', guests: 'count:99', reference: 'text:60' },
  restaurant: { ...STOP_DETAILS, partySize: 'count:99', name: 'text:60', reference: 'text:60' },
  cafe: { ...STOP_DETAILS, partySize: 'count:99', name: 'text:60', reference: 'text:60' },
  bar: { ...STOP_DETAILS, partySize: 'count:99', name: 'text:60', reference: 'text:60' },
  sight: { ...STOP_DETAILS, tickets: 'count:999', reference: 'text:60' },
  museum: { ...STOP_DETAILS, tickets: 'count:999', reference: 'text:60' },
  attraction: { ...STOP_DETAILS, tickets: 'count:999', reference: 'text:60' },
  tour: { ...STOP_DETAILS, tickets: 'count:999', reference: 'text:60' },
  show: { ...STOP_DETAILS, tickets: 'count:999', reference: 'text:60' },
  event: { starts: 'when', ends: 'when', allDay: 'flag', address: 'text:200' },
  task: { due: 'when' },
  poll: { options: 'options', closes: 'when', multiple: 'flag' },
  note: {},
  link: {},
  image: { upload: 'upload', name: 'text:120' },
});
const ICONS = ['note', 'lightbulb', 'location-dot', 'calendar-days', 'link', 'star', 'bed', 'hotel', 'utensils', 'ticket', 'train', 'plane', 'car', 'ship', 'bus', 'camera', 'circle-info', 'mug-hot', 'landmark', 'mountain', 'umbrella-beach', 'sun', 'moon', 'bell', 'clock', 'wallet', 'triangle-exclamation', 'circle-check', 'heart', 'users', 'bag-shopping', 'music', 'map', 'suitcase', 'hourglass-half', 'flag', 'magnifying-glass', 'list-check', 'scale-balanced', 'coins'];


class FormatError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

// The same as .replace(/<[^>]*>/g, ' ') in one pass (that pattern takes quadratic time on many "<" with no ">"): each "<" up
// to the next ">" becomes a space; once no ">" is left, nothing more is a tag.
function stripTags(s) {
  let out = '';
  let i = 0;
  for (;;) {
    const lt = s.indexOf('<', i);
    if (lt < 0) break;
    const gt = s.indexOf('>', lt + 1);
    if (gt < 0) break;
    out += s.slice(i, lt) + ' ';
    i = gt + 1;
  }
  return i ? out + s.slice(i) : s;
}

const plain = (s, n, lines) => stripTags(String(s == null ? '' : s)).replace(lines ? /(?!\n)\p{Cc}/gu : /\p{Cc}/gu, ' ').replace(lines ? /[ \t]+/g : /\s+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);

// A file's bytes as text: UTF-16 when it starts with that byte order mark, else UTF-8. Same rule as public/file-text.js.
function decodeBytes(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const encoding = bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : 'utf-8';
  return new TextDecoder(encoding).decode(bytes);
}

// Markdown to plain text for a one-line details field: emphasis, code and heading, quote and list marks unmarked, a link
// as "text (address)", a picture as its words. Every span is bounded and stays on one line, and link text holds no "[",
// so each pattern runs in linear time; the value is also cut to a few times its limit first (detailText).
function unmark(s) {
  return String(s)
    .replace(/!\[([^[\]\n]{0,300})\]\(([^()\s]{0,600})\)/g, '$1')
    .replace(/\[([^[\]\n]{1,300})\]\(([^()\s]{1,600})\)/g, '$1 ($2)')
    .replace(/`([^`\n]{0,300})`/g, '$1')
    .replace(/(\*\*|__)(?=\S)([^\n]{1,300}?)\1/g, '$2')
    .replace(/~~(?=\S)([^\n]{1,300}?)~~/g, '$1')
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]{1,300}?)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^\w_])_(?=\S)([^_\n]{1,300}?)_(?!\w)/g, '$1$2')
    .replace(/^[ \t]{0,40}(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d{1,9}[.)][ \t]+)/gm, '');
}

// A details text value: cut to a few times its limit (room for a link's address and markup), unmarked, plain, cut.
const detailText = (v, n) => plain(unmark(String(v).slice(0, Math.max(1000, n * 5))), n);

const realDate = (y, m, d) => {
  const t = new Date(Date.UTC(+y, +m - 1, +d));
  return t.getUTCFullYear() === +y && t.getUTCMonth() === +m - 1 && t.getUTCDate() === +d;
};
const pad2 = (n) => String(n).padStart(2, '0');

// A `when`: a local date and time, a date, or a time alone. A T or a space between them; seconds, and a trailing Z or offset,
// are dropped, keeping the clock time as written. An impossible date or time is no value.
const ZONE = '(?::\\d{2}(?:\\.\\d+)?)?(?:z|[+-]\\d{2}(?::?\\d{2})?)?';
const WHEN_DATE_TIME = new RegExp(`^(\\d{4})-(\\d{2})-(\\d{2})(?:[T ](\\d{1,2}):(\\d{2})${ZONE})?$`, 'i');
const WHEN_TIME = new RegExp(`^(\\d{1,2}):(\\d{2})${ZONE}$`, 'i');
function cleanWhen(v) {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  const clock = (h, mi) => (+h <= 23 && +mi <= 59 ? `${pad2(+h)}:${mi}` : null);
  let m = WHEN_DATE_TIME.exec(s);
  if (m) {
    if (!realDate(m[1], m[2], m[3])) return undefined;
    const day = `${m[1]}-${m[2]}-${m[3]}`;
    if (m[4] === undefined) return day;
    const time = clock(m[4], m[5]);
    return time ? `${day}T${time}` : undefined;
  }
  m = WHEN_TIME.exec(s);
  return (m && clock(m[1], m[2])) || undefined;
}

// A `point`: { code, name } or a string. A string of three capital letters is a code, any other string a name.
function cleanPoint(v) {
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^[A-Z]{3}$/.test(s)) return { code: s };
    const name = detailText(s, MAX_POINT_NAME);
    return name ? { name } : undefined;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const point = {};
  if (typeof v.code === 'string' && /^[A-Za-z0-9]{2,5}$/.test(v.code.trim())) point.code = v.code.trim().toUpperCase();
  if (typeof v.name === 'string') {
    const name = detailText(v.name, MAX_POINT_NAME);
    if (name) point.name = name;
  }
  return point.code || point.name ? point : undefined;
}

function cleanValue(type, v) {
  const [base, arg] = type.split(':');
  const wholeIn = (lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
  switch (base) {
    case 'when': return cleanWhen(v);
    case 'point': return cleanPoint(v);
    // A whole number is read as its digits (an AI often writes a flight's number as 1234); any other non-string is dropped.
    case 'text': return typeof v === 'string' ? detailText(v, +arg) || undefined : Number.isSafeInteger(v) ? String(v).slice(0, +arg) : undefined;
    case 'count': return wholeIn(1, +arg);
    case 'minutes': return wholeIn(1, MAX_MINUTES);
    case 'flag': return typeof v === 'boolean' ? v : undefined;
    case 'upload': return typeof v === 'string' && UPLOAD_ID.test(v) ? v : undefined;
    case 'options': {
      if (!Array.isArray(v)) return undefined;
      const out = [];
      for (const o of v) {
        if (typeof o !== 'string') continue;
        const option = detailText(o, MAX_OPTION);
        if (option && !out.includes(option) && out.length < MAX_OPTIONS) out.push(option);
      }
      return out.length >= MIN_OPTIONS ? out : undefined;
    }
    default: return undefined;
  }
}

// A kind's details, field by field: unknown fields and bad values dropped. Null when nothing is kept, or the kind has none.
function cleanDetails(kind, raw) {
  const fields = Object.prototype.hasOwnProperty.call(DETAILS, kind) ? DETAILS[kind] : null;
  if (!fields || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const details = {};
  for (const [name, type] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(raw, name)) continue;
    const value = cleanValue(type, raw[name]);
    if (value !== undefined) details[name] = value;
  }
  return Object.keys(details).length ? details : null;
}

const kindOf = (raw, handoff) => (KINDS.includes(raw.kind) || (handoff && HANDOFF_KINDS.includes(raw.kind)) ? raw.kind : undefined);

// A title that is only a placeholder in angle brackets, as the prompt's example writes them. No real title is.
const isPlaceholder = (title) => typeof title === 'string' && /^<[^<>]+>$/.test(title.trim());

// One object as kept. `imported`: from a paste or file (basis "imported", no sources). `handoff`: from another page, so a
// handoff kind (image) is kept; never set for an AI's answer or an import. `content` may be left out when details are kept.
function cleanObject(raw, { count = 0, imported = false, handoff = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (isPlaceholder(raw.title)) return null; // the prompt's own example, written back as it was
  const title = plain(raw.title, MAX_TITLE);
  const content = plain(raw.content, MAX_CONTENT, true);
  const kind = kindOf(raw, handoff);
  const details = kind ? cleanDetails(kind, raw.details) : null;
  if (!title || (!content && !details)) return null;
  const basis = imported ? 'imported' : (BASES.includes(raw.basis) ? raw.basis : count > 0 ? 'items' : 'general');
  const summary = { icon: ICONS.includes(raw.icon) ? raw.icon : ICONS[0], title };
  if (content) summary.content = content;
  summary.basis = basis;
  if (kind) summary.kind = kind;
  const tags = [];
  for (const t of Array.isArray(raw.tags) ? raw.tags : []) {
    const tag = String(t == null ? '' : t).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, MAX_TAG);
    if (tag && !tags.includes(tag) && tags.length < MAX_TAGS) tags.push(tag);
  }
  if (tags.length) summary.tags = tags;
  const pl = raw.place;
  if (pl && typeof pl === 'object') {
    const name = plain(pl.name, MAX_PLACE_NAME);
    if (name) {
      summary.place = { name };
      if (Number.isFinite(pl.lat) && Number.isFinite(pl.lng) && Math.abs(pl.lat) <= 90 && Math.abs(pl.lng) <= 180) {
        summary.place.lat = Math.round(pl.lat * 1e6) / 1e6;
        summary.place.lng = Math.round(pl.lng * 1e6) / 1e6;
      }
    }
  }
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw.date || ''));
  if (d && realDate(d[1], d[2], d[3])) summary.date = raw.date;
  const links = [];
  for (const l of Array.isArray(raw.links) ? raw.links.slice(0, MAX_LINKS) : []) {
    let u;
    try { u = new URL(String((l && l.url) || '')); } catch { continue; }
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || u.href.length > MAX_LINK_URL) continue;
    links.push({ title: plain(l.title, MAX_LINK_TITLE) || u.hostname, url: u.href });
  }
  if (links.length) summary.links = links;
  if (details) summary.details = details;
  if (!imported) {
    const sources = [...new Set((Array.isArray(raw.sources) ? raw.sources : []).filter((n) => Number.isInteger(n) && n >= 1 && n <= count))].slice(0, MAX_SOURCES);
    if (sources.length) summary.sources = sources;
  }
  return summary;
}

function dropWhy(raw) {
  if (raw && raw.__notJson) return 'not valid JSON';
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return `not ${word('object', { a: true })}`;
  if (!plain(raw.title, MAX_TITLE)) return 'it has no title';
  if (HANDOFF_KINDS.includes(raw.kind) && !plain(raw.content, MAX_CONTENT, true)) return 'it is a picture';
  if (!plain(raw.content, MAX_CONTENT, true) && !cleanDetails(kindOf(raw, false), raw.details)) return 'it has no content';
  return null;
}

// What modules take (plan-object-handoff.md, "What modules declare"). A provided action's `takes` lists entries of
// { kinds, except?, as, permission? }: `kinds` are kinds from the catalogue, "*" for any object (with or without a kind,
// but a handoff kind only when it is named, and never one in `except`), or "text" for an ordinary message's words, which
// travel as an object with no kind. These are the format's words; the server still names no module.
const TAKE_WORDS = Object.freeze(['*', 'text']);
function entryTakes(entry, kind) {
  const kinds = Array.isArray(entry && entry.kinds) ? entry.kinds : [];
  if (!kind) return kinds.includes('*') || kinds.includes('text');
  if (kinds.includes(kind)) return true;
  return kinds.includes('*') && !HANDOFF_KINDS.includes(kind) && !(Array.isArray(entry.except) && entry.except.includes(kind));
}
// The entries of an action's `takes` that take an object of this kind (undefined: an object with no kind).
const takersOf = (takes, kind) => (Array.isArray(takes) ? takes.filter((e) => entryTakes(e, kind)) : []);

// The kinds the prompt lists: every kind some enabled module's action names in its `takes` ("*" names none), in the
// catalogue's order, never a handoff kind; plus the travel kinds while any enabled module still offers the typed keeper
// from before `takes` (LEGACY_TRAVEL_ACTION, as Chat's old lookup finds it: a title and a kind, and no `takes`).
const LEGACY_TRAVEL_ACTION = 'acceptSuggestion';
const isLegacyTravel = (a) => a && a.name === LEGACY_TRAVEL_ACTION && !Array.isArray(a.takes) && a.input && a.input.title && a.input.kind;
function kindsTaken(manifests) {
  const named = new Set();
  for (const m of Array.isArray(manifests) ? manifests : []) {
    for (const a of (m && m.actions && Array.isArray(m.actions.provides)) ? m.actions.provides : []) {
      if (isLegacyTravel(a)) for (const k of TRAVEL_KINDS) named.add(k);
      for (const e of Array.isArray(a.takes) ? a.takes : []) for (const k of Array.isArray(e.kinds) ? e.kinds : []) named.add(k);
    }
  }
  return KINDS.filter((k) => named.has(k));
}

// An action's `object` input as the bus carries it: what the format keeps from another page (cleanObject with `handoff`,
// so a picture's `image` is kept). An AI's item numbers mean nothing here, so `sources` is dropped, and `basis` is kept
// only as given (an AI answer's object keeps it; a chat message's words have none).
function cleanHandoff(raw) {
  const kept = cleanObject(raw, { handoff: true });
  if (!kept) return null;
  delete kept.sources;
  if (raw.basis === 'imported' || BASES.includes(raw.basis)) kept.basis = raw.basis;
  else delete kept.basis;
  return kept;
}

// The objects rule and the copied instructions that describe this format to a model live in the prompt registry
// (server/prompts/object-rule.js and server/prompts/paste.js).

// A day and a 24-hour clock as a pattern. An impossible day such as 2026-02-30 still passes; the reader drops it.
const SCHEMA_DAY = '\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])';
const SCHEMA_CLOCK = '([01]\\d|2[0-3]):[0-5]\\d';

// The JSON Schema of one details value type: the shape an AI writes (the reader is looser, see cleanValue).
function valueSchema(type) {
  const [base, arg] = type.split(':');
  switch (base) {
    case 'when': return { type: 'string', pattern: `^(${SCHEMA_DAY}(T${SCHEMA_CLOCK})?|${SCHEMA_CLOCK})$` };
    case 'point': return {
      oneOf: [
        { type: 'string', minLength: 1, maxLength: MAX_POINT_NAME },
        { type: 'object', anyOf: [{ required: ['code'] }, { required: ['name'] }], properties: { code: { type: 'string', pattern: '^[A-Za-z0-9]{2,5}$' }, name: { type: 'string', minLength: 1, maxLength: MAX_POINT_NAME } } },
      ],
    };
    case 'text': return { type: 'string', minLength: 1, maxLength: +arg };
    case 'count': return { type: 'integer', minimum: 1, maximum: +arg };
    case 'minutes': return { type: 'integer', minimum: 1, maximum: MAX_MINUTES };
    case 'flag': return { type: 'boolean' };
    case 'options': return { type: 'array', minItems: MIN_OPTIONS, maxItems: MAX_OPTIONS, items: { type: 'string', minLength: 1, maxLength: MAX_OPTION } };
    case 'upload': return { type: 'string', pattern: UPLOAD_ID.source };
    default: throw new Error(`no schema for ${type}`);
  }
}

// `details` for each kind an AI may write, as $defs entries named details-<kind>, each needing at least one of its own
// fields; `false` (never valid) for a kind with none. A handoff kind is not in the schema.
function detailsSchemas() {
  return Object.fromEntries(KINDS.map((kind) => {
    const fields = Object.entries(DETAILS[kind]);
    if (!fields.length) return [`details-${kind}`, false];
    return [`details-${kind}`, {
      type: 'object',
      anyOf: fields.map(([name]) => ({ required: [name] })),
      properties: Object.fromEntries(fields.map(([name, type]) => [name, valueSchema(type)])),
    }];
  }));
}

function schema() {
  const details = detailsSchemas();
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `${productName()} ${word('object', { many: true })}, format 1`,
    description: `One ${word('object')}, a list of ${word('object', { many: true })}, or a ${FILE_SUFFIX} file. Other fields are ignored.`,
    oneOf: [
      { $ref: '#/$defs/object' },
      { type: 'array', items: { $ref: '#/$defs/object' }, maxItems: MAX_IMPORT_OBJECTS },
      { $ref: '#/$defs/file' },
    ],
    $defs: {
      file: {
        type: 'object',
        required: ['format', 'formatVersion', 'objects'],
        properties: {
          format: { const: 'objects' },
          formatVersion: { const: FORMAT_VERSION },
          objects: { type: 'array', items: { $ref: '#/$defs/object' }, maxItems: MAX_IMPORT_OBJECTS },
        },
      },
      object: {
        type: 'object',
        required: ['title'],
        anyOf: [{ required: ['content'] }, { required: ['kind', 'details'] }],
        allOf: KINDS.map((kind) => ({
          if: { required: ['kind'], properties: { kind: { const: kind } } },
          then: { properties: { details: { $ref: `#/$defs/details-${kind}` } } },
        })),
        properties: {
          title: { type: 'string', minLength: 1, maxLength: MAX_TITLE },
          content: { type: 'string', minLength: 1, maxLength: MAX_CONTENT },
          icon: { enum: ICONS.slice() },
          kind: { enum: KINDS.slice() },
          tags: { type: 'array', maxItems: MAX_TAGS, items: { type: 'string', pattern: '^[a-z0-9-]{1,24}$' } },
          place: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string', minLength: 1, maxLength: MAX_PLACE_NAME },
              lat: { type: 'number', minimum: -90, maximum: 90 },
              lng: { type: 'number', minimum: -180, maximum: 180 },
            },
          },
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          details: { type: 'object', minProperties: 1, description: 'Optional; its fields depend on kind ($defs details-<kind>). Needs a kind.' },
          links: {
            type: 'array',
            maxItems: MAX_LINKS,
            items: {
              type: 'object',
              required: ['url'],
              properties: {
                title: { type: 'string', maxLength: MAX_LINK_TITLE },
                url: { type: 'string', pattern: '^https?://', maxLength: MAX_LINK_URL },
              },
            },
          },
        },
      },
      ...details,
    },
  };
}

function parseFenceValue(body) {
  try {
    return { value: JSON.parse(body) };
  } catch {
    return { bad: true };
  }
}

function addCandidates(list, value) {
  if (Array.isArray(value)) list.push(...value);
  else list.push(value);
}

// Balanced top-level `{...}` spans, strings and escapes respected. Used when a chat's rendered view drops the fences.
function braceSpans(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '{') { i += 1; continue; }
    let depth = 0;
    let inStr = false;
    let esc = false;
    let j = i;
    for (; j < text.length; j += 1) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) { out.push(text.slice(i, j + 1)); i = j + 1; break; }
      }
    }
    if (depth !== 0) break;
  }
  return out;
}

// An opening fence whose label is a past block label (server/file-format.js), in any letter case: at the start of a
// line, after any indent, list markers (-, *, +, 1. or 1)) and quote markers (>, nested too); then three or more
// backticks, any spaces or tabs, and the label as a whole word (not followed by a letter, digit, _ or -, so a word
// that only starts with the label is not it); anything may follow. Lines may end in LF or CRLF. The block need not be
// closed (plan-kind-names.md, "Objects files and blocks").
const FENCE_PREFIX = '(?:[ \\t]*(?:>|[-*+][ \\t]|\\d{1,9}[.)][ \\t]))*[ \\t]*';
const PAST_FENCE = new RegExp(`^${FENCE_PREFIX}\`{3,}[ \\t]*(?:${fileFormat.PAST_BLOCK_LABELS.join('|')})(?![\\w-])`, 'im');
const OBJECTS_BLOCK = new RegExp(`\`\`\`${FENCE}[ \\t]*\\r?\\n([\\s\\S]*?)\\n?\`\`\``, 'g');

// Reads pasted text or a file's text, in this order (plan-kind-names.md, "Objects files and blocks"):
//   a block fenced with a past label anywhere -> the whole paste refused (OLD_SENTENCES.answer); nothing in it is read
//   JSON that is an objects file (format "objects", or any formatVersion) -> its marker checked, then its list
//   a JSON object with an old-shaped marker and no format -> refused (OLD_SENTENCES.objects)
//   any other JSON object or array -> read as one object or a list
//   ```objects blocks; when there are none, any JSON object with a title anywhere in the text (a paste that lost its fences)
function readObjects(text) {
  let src = String(text == null ? '' : text);
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const trimmed = src.trim();
  if (!trimmed) throw new FormatError(400, 'paste an answer or choose a file first');
  if (PAST_FENCE.test(trimmed)) throw new FormatError(400, fileFormat.OLD_SENTENCES.answer);

  let candidates = null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const isObject = parsed && typeof parsed === 'object' && !Array.isArray(parsed);
      const has = (key) => Object.prototype.hasOwnProperty.call(parsed, key);
      if (isObject && (parsed.format === 'objects' || has('formatVersion'))) {
        const marker = fileFormat.readMarker(parsed, 'objects');
        if (marker === 'newer') throw new FormatError(400, `that file is format ${parsed.formatVersion}; this server reads format ${FORMAT_VERSION}`);
        if (marker !== 'ok') throw new FormatError(400, `that is not a ${FILE_SUFFIX} file`);
        if (!Array.isArray(parsed.objects)) throw new FormatError(400, `that file has no list of ${word('object', { many: true })}`);
        candidates = parsed.objects;
      } else if (isObject && fileFormat.readMarker(parsed, 'objects') === 'old') {
        throw new FormatError(400, fileFormat.OLD_SENTENCES.objects);
      } else if (Array.isArray(parsed)) {
        candidates = parsed;
      } else {
        candidates = [parsed];
      }
    } catch (err) {
      if (err instanceof FormatError) throw err;
      candidates = null;
    }
  }

  if (candidates === null) {
    candidates = [];
    OBJECTS_BLOCK.lastIndex = 0;
    let m;
    while ((m = OBJECTS_BLOCK.exec(trimmed))) {
      const parsed = parseFenceValue(m[1]);
      if (parsed.bad) candidates.push({ __notJson: true });
      else addCandidates(candidates, parsed.value);
    }
    if (!candidates.length) {
      for (const span of braceSpans(trimmed)) {
        try {
          const v = JSON.parse(span);
          if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.title === 'string') candidates.push(v);
        } catch { /* ignore */ }
      }
    }
  }

  if (!candidates.length) {
    throw new FormatError(400, `nothing in that could be read as ${word('object', { many: true })}: paste the whole answer, with its ${FENCE} blocks`);
  }

  const found = Math.min(candidates.length, MAX_IMPORT_CANDIDATES);
  const objects = [];
  const dropped = [];
  let over = 0;
  for (let i = 0; i < found; i += 1) {
    const raw = candidates[i];
    const why = dropWhy(raw);
    if (why) { dropped.push({ at: i + 1, why }); continue; }
    const cleaned = cleanObject(raw, { imported: true });
    if (!cleaned) { dropped.push({ at: i + 1, why: 'it has no content' }); continue; }
    if (objects.length < MAX_IMPORT_OBJECTS) objects.push(cleaned);
    else over += 1;
  }
  return { objects, found, dropped, over };
}

module.exports = {
  FORMAT_VERSION,
  FENCE,
  FILE_SUFFIX,
  MAX_IMPORT_OBJECTS,
  MAX_IMPORT_CANDIDATES,
  MAX_IMPORT_BYTES,
  MAX_CONTENT,
  ICONS,
  KINDS,
  TRAVEL_KINDS,
  HANDOFF_KINDS,
  TAKE_WORDS,
  DETAILS,
  BASES,
  FormatError,
  cleanObject,
  cleanDetails,
  cleanHandoff,
  takersOf,
  kindsTaken,
  schema,
  readObjects,
  decodeBytes,
};
