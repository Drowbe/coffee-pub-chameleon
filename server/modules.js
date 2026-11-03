// Installed modules: validating an uploaded zip, unpacking it, and keeping the
// registry of what is installed, enabled, and approved. See docs/MODULES.md.
//
// On disk, under DATA_DIR/modules:
//   registry.json                     what is installed and its state
//   <id>/versions/<version>/...       the module's files, one folder per version
//   <id>/data/                        the module's own data (kept across upgrades)
//
// Modules are front-end only: nothing in a zip is ever run by the server, so
// the file types are allowlisted and the zip is read entirely in memory
// against hard caps before a single byte is written.

const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const { productName } = require('./product-name');
const { StoreError, LOBBY } = require('./store');
const { word, fill } = require('./words');
const { DESTINATION_IDS, DESTINATION_PARTS } = require('./destinations');
const objectFormat = require('./object-format');
const { scanBuiltPage } = require('./module-layout');
const { cleanGuards, unreadableGuards } = require('./module-guards');

// The text a person reads from a manifest, which may name levels by {space}-style placeholders (server/words.js's fill):
// its description, the dashboard widget's title, its permissions' labels, its settings' labels and help (and their
// options'), its events' and actions' labels, and what its kinds of item are called. The module's name is a name and
// is not filled. Answers the manifest itself when it has no placeholder, else a filled copy.
// `{name}` is not a word: in a kind's name it stands for the module's shown name, filled where the kind is named
// (kindNameOf in index.js), so it never counts here and fill() leaves it as it is.
const PLACEHOLDER_RE = /\{(?:(?:a|an|A|An) )?(?!name\})[A-Za-z]+\}/;
function manifestTexts(m) {
  const out = [];
  const at = (obj, key) => { if (obj && typeof obj[key] === 'string') out.push([obj, key]); };
  at(m, 'description');
  at(m.surfaces?.widget, 'title');
  for (const d of Array.isArray(m.surfaces?.destination) ? m.surfaces.destination : []) at(d, 'label');
  for (const p of m.permissions || []) at(p, 'label');
  for (const d of m.settings || []) {
    at(d, 'label'); at(d, 'help');
    for (const o of d.options || []) { at(o, 'label'); at(o, 'help'); }
  }
  for (const e of m.events?.publishes || []) at(e, 'label');
  for (const a of m.actions?.provides || []) at(a, 'label');
  for (const k of m.refs?.produces || []) at(k, 'name');
  return out;
}
const hasPlaceholders = (manifest) => manifestTexts(manifest).some(([o, k]) => PLACEHOLDER_RE.test(o[k]));
function fillManifest(manifest, resolved) {
  if (!manifest || !hasPlaceholders(manifest)) return manifest;
  const copy = structuredClone(manifest);
  for (const [o, k] of manifestTexts(copy)) o[k] = fill(o[k], resolved);
  return copy;
}

const MB = 1024 * 1024;
const LIMITS = {
  zipBytes: 10 * MB, // the upload itself
  files: 500,
  fileBytes: 10 * MB, // any one file, unpacked
  totalBytes: 40 * MB, // everything, unpacked
  keepVersions: 3, // newest versions kept for rollback, plus the active one
};
const ALLOWED_EXT = new Set([
  '.html', '.htm', '.js', '.mjs', '.css', '.json', '.txt', '.md', '.map',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.otf',
]);
const HOOKS = ['schedule', 'notify', 'ai', 'external'];

// A manifest's hooks, each true or false, except `ai`: true (it can't work without the AI service) or "optional" (it uses the
// service when it is on and works without it). Anything else for `ai` is refused.
function cleanHooks(raw) {
  const hooks = Object.fromEntries(HOOKS.map((h) => [h, Boolean(raw?.[h])]));
  if (raw && Object.prototype.hasOwnProperty.call(raw, 'ai')) {
    if (raw.ai !== true && raw.ai !== 'optional') throw new ModuleError('module.json: hooks.ai must be true (the module needs the AI service) or "optional" (it uses the service when it is on)');
    hooks.ai = raw.ai;
  }
  return hooks;
}
// What an object's summary (what another module may show of it) can carry, and which of the producing module's own
// stored fields fill it (`refs.produces[].summary`). See documentation/api/api-module-sdk.md ("Objects").
// `doneAt`: a time (milliseconds) after which the summary's `done` is true whatever the `done` field says (a poll that
// closes by its time).
const SUMMARY_FIELDS = ['title', 'subtitle', 'when', 'end', 'allDay', 'done', 'doneAt', 'place', 'category', 'text', 'amount', 'planned', 'paidBy', 'sharedBy', 'icon', 'visit', 'color', 'spaces'];
const REF_KIND_RE = /^[a-z][a-z0-9-]{0,23}$/;
const REF_CONSUME_RE = /^[a-z][a-z0-9-]{1,31}:[a-z][a-z0-9-]{0,23}$/;
const SCOPES = ['environment', 'space', 'person'];
// Plan-names step 5c, the hard break: a manifest speaks only the new names. One that still uses an old one (a scope
// `room` or `server`, a setting's scope `room` or `server`, `install.settingsFrom: "server"`, a permission default
// keyed `user`, from step 6 `surfaces.panel`, and from step 7 a kind's `card`) is refused at install with a sentence naming the field and what to use instead; one already
// installed does not run (see ModuleManager.outdated) and its card says so.
const OLD_SCOPE_NAMES = {
  room: { use: 'space', why: productName() + ' renamed rooms to spaces' },
  server: { use: 'environment', why: productName() + ' renamed the server to the environment' },
};
// Filled with the environment's words where it is shown (list()); OUTDATED is the text in the default words.
const OUTDATED_TEXT = 'This {module} was built for an older version of ' + productName() + ' and needs an update from its author.';
const OUTDATED = fill(OUTDATED_TEXT, null);
// The old name of surfaces.canvas (plan-names decision 13), named only so a manifest that still uses it is refused.
const OLD_CANVAS_SURFACE = 'panel';
// The old name of a kind's summary (plan-names decision 6), named only so a manifest that still uses it is refused.
const OLD_SUMMARY = 'card';
const isOldScope = (s) => typeof s === 'string' && Object.prototype.hasOwnProperty.call(OLD_SCOPE_NAMES, s);
// The first old name a raw manifest uses, as the sentence that refuses it, or null when it uses none.
function oldNameIn(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const scopes = Array.isArray(raw.scope) ? raw.scope : [raw.scope];
  const oldScope = scopes.find(isOldScope);
  if (oldScope) return `module.json uses the old scope "${oldScope}"; use "${OLD_SCOPE_NAMES[oldScope].use}" (${OLD_SCOPE_NAMES[oldScope].why}).`;
  for (const r of Array.isArray(raw.settings) ? raw.settings : []) {
    if (r && isOldScope(r.scope)) return `module.json: setting "${String(r.key ?? '')}" uses the old scope "${r.scope}"; use "${OLD_SCOPE_NAMES[r.scope].use}" (${OLD_SCOPE_NAMES[r.scope].why}).`;
  }
  const from = raw.install && typeof raw.install === 'object' ? raw.install.settingsFrom : undefined;
  if (isOldScope(from)) return `module.json: install.settingsFrom uses the old name "${from}"; use "${OLD_SCOPE_NAMES[from].use}" (${OLD_SCOPE_NAMES[from].why}).`;
  for (const p of Array.isArray(raw.permissions) ? raw.permissions : []) {
    if (p && p.default && typeof p.default === 'object' && Object.prototype.hasOwnProperty.call(p.default, 'user')) {
      return `module.json: permission "${String(p.key ?? '')}" names the old role "user" in its default; use "member" (${productName()} renamed the user role to member).`;
    }
  }
  // Plan-names step 6: a module's docked or floating surface is on the canvas (surfaces.canvas), no longer a panel.
  if (raw.surfaces && typeof raw.surfaces === 'object' && Object.prototype.hasOwnProperty.call(raw.surfaces, OLD_CANVAS_SURFACE)) {
    return `module.json uses the old surfaces.${OLD_CANVAS_SURFACE}; use surfaces.canvas (${productName()} renamed a module's panel to its place on the canvas).`;
  }
  // Plan-names step 7: what a kind of object shows of itself is its summary, no longer a card.
  for (const p of Array.isArray(raw.refs?.produces) ? raw.refs.produces : []) {
    if (p && typeof p === 'object' && Object.prototype.hasOwnProperty.call(p, OLD_SUMMARY)) {
      return `module.json: refs kind "${String(p.kind ?? '')}" uses the old ${OLD_SUMMARY}; use summary (${productName()} renamed an object's ${OLD_SUMMARY} to its summary).`;
    }
  }
  return null;
}
const ID_RE = /^[a-z][a-z0-9-]{1,31}$/;
// Ids no module may take: 'ai' names the server-wide AI service (not a module) in `missing`/`aiDependents`, the same way a
// module id would, so it must never also be a real one.
const RESERVED_IDS = ['ai'];
// The folders the host keeps inside DATA_DIR/modules/<id>/, which a module's file setting can't name.
const RESERVED_FOLDERS = ['versions', 'library', 'data', 'uploads', 'trash'];
const { cleanRows } = require('./setting-list');
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

class ModuleError extends StoreError {}

const parseVersion = (v) => v.split('.').map(Number);
function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

// --- reading the zip ------------------------------------------------------

// Every regular file in the zip as name -> Buffer, or a ModuleError. Nothing
// touches the disk here.
function readZip(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(new ModuleError("that isn't a readable zip file"));
      const files = new Map();
      let total = 0;
      const fail = (message) => { zip.close(); reject(new ModuleError(message)); };
      zip.on('error', (e) => fail(/relative path|absolute path|invalid characters/.test(e?.message || '') ? 'the zip contains an unsafe file path' : "that isn't a readable zip file"));
      zip.on('end', () => resolve(files));
      zip.on('entry', (entry) => {
        const name = entry.fileName;
        if (name.endsWith('/')) return zip.readEntry(); // a folder
        if (name.startsWith('__MACOSX/') || path.posix.basename(name) === '.DS_Store') return zip.readEntry();
        if (files.size >= LIMITS.files) return fail(`too many files (more than ${LIMITS.files})`);
        // yauzl has already refused absolute paths, "..", and backslashes.
        if (/[\u0000-\u001f]/.test(name)) return fail(`bad file name: ${name}`);
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (mode === 0o120000) return fail(`symbolic links aren't allowed: ${name}`);
        if (!ALLOWED_EXT.has(path.posix.extname(name).toLowerCase())) return fail(`file type not allowed: ${name}`);
        if (entry.uncompressedSize > LIMITS.fileBytes) return fail(`${name} is larger than ${LIMITS.fileBytes / MB} MB`);
        total += entry.uncompressedSize;
        if (total > LIMITS.totalBytes) return fail(`the ${word('module')} is larger than ${LIMITS.totalBytes / MB} MB unpacked`);
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) return fail("that isn't a readable zip file");
          const chunks = [];
          let size = 0;
          stream.on('data', (chunk) => {
            size += chunk.length; // trust the bytes, not the header's claim
            if (size > LIMITS.fileBytes) { stream.destroy(); return fail(`${name} is larger than ${LIMITS.fileBytes / MB} MB`); }
            chunks.push(chunk);
          });
          stream.on('error', () => fail("that isn't a readable zip file"));
          stream.on('end', () => {
            files.set(name, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

// A zip made by right-clicking a folder has everything inside that one
// folder; accept that as well as module.json at the root.
function stripWrapperFolder(files) {
  if (files.has('module.json')) return files;
  const roots = new Set([...files.keys()].map((n) => n.split('/')[0]));
  if (roots.size !== 1) return files;
  const [root] = roots;
  if (!files.has(`${root}/module.json`)) return files;
  return new Map([...files].map(([n, data]) => [n.slice(root.length + 1), data]));
}

// --- the manifest ---------------------------------------------------------

const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

function cleanEntry(value, files, what) {
  const entry = typeof value === 'string' ? value.trim() : '';
  if (!entry || !/^[A-Za-z0-9_.\-/]+$/.test(entry) || entry.startsWith('/') || entry.split('/').includes('..')) {
    throw new ModuleError(`${what} needs a valid "entry" file`);
  }
  if (!/\.html?$/i.test(entry)) throw new ModuleError(`${what} entry must be an .html file`);
  if (!files.has(entry)) throw new ModuleError(`${what} entry ${entry} isn't in the zip`);
  return entry;
}

const clamp = (value, min, max, fallback) => (Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Math.round(Number(value)))) : fallback);

// The validated manifest we keep, or a ModuleError saying what's wrong.
// Anything the manifest says beyond these fields is ignored.
// Refs: the kinds of object a module lets other modules point at (`produces`), and other modules' objects it
// wants to point at (`consumes`, approved by an admin like permissions and hooks are). Always returns both
// lists; throws on a bad declaration. The stored module.json is the author's original, so this runs
// again whenever a manifest is read (see manifestOf).
function cleanRefs(rawRefs, id) {
  const refs = { produces: [], consumes: [] };
  for (const p of Array.isArray(rawRefs?.produces) ? rawRefs.produces.slice(0, 10) : []) {
    const kind = typeof p?.kind === 'string' ? p.kind.trim() : '';
    if (!REF_KIND_RE.test(kind)) throw new ModuleError(`module.json: refs kind "${kind}" must be lowercase letters, digits or dashes`);
    if (refs.produces.some((x) => x.kind === kind)) throw new ModuleError(`module.json: refs kind "${kind}" is listed twice`);
    // The stored key an item lives under: a fixed prefix then {id}, such as "event:{id}".
    const key = typeof p.key === 'string' ? p.key : '';
    if (!/^[a-z][a-z0-9_-]{0,23}:\{id\}$/.test(key)) throw new ModuleError(`module.json: refs "${kind}" needs a "key" like "event:{id}"`);
    const summary = {};
    for (const field of SUMMARY_FIELDS) {
      const from = p.summary?.[field];
      if (from === undefined || from === null) continue;
      if (typeof from !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(from)) throw new ModuleError(`module.json: refs "${kind}" summary.${field} must name a stored field`);
      summary[field] = from;
    }
    if (!summary.title) throw new ModuleError(`module.json: refs "${kind}" needs a summary.title`);
    // What a person sees it called; whether the module can open one of its objects when asked (it
    // handles host.objects.onOpen); whether it shows what links to its objects (host.objects.linksTo).
    const name = String(p.name ?? '').replace(/\p{Cc}/gu, ' ').trim().slice(0, 40) || kind.charAt(0).toUpperCase() + kind.slice(1);
    const produced = { kind, name, key, summary, open: Boolean(p.open), backlinks: Boolean(p.backlinks) };
    // Plain words for the stored `category` (or, when it is empty, the stored `kind`): { "stay": "Lodging" }. The summary
    // then offers the words, so a module that reads categories by name (Budget) needs no table of this module's kinds.
    if (p.categoryNames && typeof p.categoryNames === 'object' && !Array.isArray(p.categoryNames)) {
      if (!summary.category) throw new ModuleError(`module.json: refs "${kind}" categoryNames needs a summary.category`);
      const names = {};
      for (const [from, to] of Object.entries(p.categoryNames).slice(0, 40)) {
        const words = typeof to === 'string' ? to.replace(/\p{Cc}/gu, ' ').trim().slice(0, 30) : '';
        if (/^[A-Za-z0-9_-]{1,32}$/.test(from) && words) names[from] = words;
      }
      if (Object.keys(names).length) produced.categoryNames = names;
    }
    const holds = cleanHolds(kind, p.holds);
    if (holds) produced.holds = holds;
    const dated = cleanDated(kind, p.dated);
    if (dated) produced.dated = dated;
    const mirror = cleanMirror(kind, p.mirror, dated);
    if (mirror) produced.mirror = mirror;
    const create = cleanCreate(kind, p.create, mirror);
    if (create) produced.create = create;
    // Offered to a person's calendar feed (plan-google-calendar.md, decision 6): only what its author marks, and only
    // a dated kind.
    if (p.feed !== undefined && p.feed !== null) {
      if (typeof p.feed !== 'boolean') throw new ModuleError(`module.json: refs "${kind}" feed must be true or false`);
      if (p.feed && !dated) throw new ModuleError(`module.json: refs "${kind}" feed needs "dated"`);
      if (p.feed) produced.feed = true;
    }
    // Shown on a calendar as a marker that links back to the object (plan-calendar-markers.md, decision 1): never a
    // twin and never in a calendar feed, so not with "mirror" or "feed".
    if (p.marker !== undefined && p.marker !== null) {
      if (typeof p.marker !== 'boolean') throw new ModuleError(`module.json: refs "${kind}" marker must be true or false`);
      if (p.marker && !dated) throw new ModuleError(`module.json: refs "${kind}" marker needs "dated"`);
      if (p.marker && mirror) throw new ModuleError(`module.json: refs "${kind}" marker can't be used with "mirror"`);
      if (p.marker && produced.feed) throw new ModuleError(`module.json: refs "${kind}" marker can't be used with "feed"`);
      if (p.marker) produced.marker = true;
    }
    refs.produces.push(produced);
  }
  // "*" means whatever other modules share, so a module can link to the items of a module written
  // after it without either being changed; otherwise named kinds, "module:kind".
  for (const c of Array.isArray(rawRefs?.consumes) ? rawRefs.consumes.slice(0, 20) : []) {
    if (typeof c !== 'string' || (c !== '*' && !REF_CONSUME_RE.test(c))) throw new ModuleError(`module.json: refs.consumes "${c}" must be "*" or look like "module:kind"`);
    if (c !== '*' && c.split(':')[0] === id) throw new ModuleError('module.json: a module does not need to consume its own kinds');
    if (!refs.consumes.includes(c)) refs.consumes.push(c);
  }

  return refs;
}

// What a kind's objects hold (plan-linked-objects.md). One `holds` per kind: the stored field that is the pointer,
// what to do when that object is deleted, and which of the holder's fields follow the object's title and day.
const HOLDS_FIELD_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
function cleanHolds(kind, raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ModuleError(`module.json: refs "${kind}" holds must be an object`);
  for (const key of Object.keys(raw)) {
    if (key !== 'field' && key !== 'onDelete' && key !== 'markField' && key !== 'follow') throw new ModuleError(`module.json: refs "${kind}" holds.${key} is not used`);
  }
  if (typeof raw.field !== 'string' || !HOLDS_FIELD_RE.test(raw.field)) throw new ModuleError(`module.json: refs "${kind}" holds.field must name a stored field`);
  if (raw.onDelete !== 'remove' && raw.onDelete !== 'mark') throw new ModuleError(`module.json: refs "${kind}" holds.onDelete must be "remove" or "mark"`);
  const holds = { field: raw.field, onDelete: raw.onDelete };
  if (Object.prototype.hasOwnProperty.call(raw, 'markField')) {
    if (raw.onDelete !== 'mark') throw new ModuleError(`module.json: refs "${kind}" holds.markField is only for onDelete "mark"`);
    if (typeof raw.markField !== 'string' || !HOLDS_FIELD_RE.test(raw.markField)) throw new ModuleError(`module.json: refs "${kind}" holds.markField must name a stored field`);
    holds.markField = raw.markField;
  } else if (raw.onDelete === 'mark') {
    throw new ModuleError(`module.json: refs "${kind}" holds.onDelete "mark" needs a markField`);
  }
  if (raw.follow !== undefined) {
    if (typeof raw.follow !== 'object' || raw.follow === null || Array.isArray(raw.follow)) throw new ModuleError(`module.json: refs "${kind}" holds.follow must be an object`);
    const follow = {};
    for (const key of Object.keys(raw.follow)) {
      if (key !== 'title' && key !== 'day' && key !== 'pin') throw new ModuleError(`module.json: refs "${kind}" holds.follow.${key} is not used`);
      const from = raw.follow[key];
      if (typeof from !== 'string' || !HOLDS_FIELD_RE.test(from)) throw new ModuleError(`module.json: refs "${kind}" holds.follow.${key} must name a stored field`);
      follow[key] = from;
    }
    if (!follow.title && !follow.day) throw new ModuleError(`module.json: refs "${kind}" holds.follow needs a title or a day`);
    holds.follow = follow;
  }
  return holds;
}

// How a kind's objects are dated, and whether the server keeps a twin of each one (plan-plan-calendar-sync.md).
// A kind either sends twins (`mirror: out`) or receives them (`mirror: in`), and says which stored fields hold the
// title and the day. The two shapes are a wall clock (a day, and maybe a time) or an instant.
function cleanDated(kind, raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ModuleError(`module.json: refs "${kind}" dated must be an object`);
  const wall = ['day', 'time', 'endDay'].some((name) => raw[name] !== undefined);
  const instant = ['start', 'end', 'allDay'].some((name) => raw[name] !== undefined);
  if (wall === instant) throw new ModuleError(`module.json: refs "${kind}" dated is either a day or an instant`);
  // `repeat` (either shape): the stored field holding a repeat in the Calendar's shape, { every, until }.
  // A wall-clock kind may also name `endTime` (the check-out time), `minutes` (its length) and `zone` (where the zone its
  // times are written in is kept: { key, field }, a stored object of the module and the field holding the zone name). An
  // instant kind may name `tz`, the field a copy keeps that zone in.
  // `skips` (with `repeat`): the stored field holding the days ('YYYY-MM-DD') of single occurrences taken out of the repeat.
  const allowed = wall ? ['title', 'day', 'time', 'endDay', 'endTime', 'minutes', 'zone', 'repeat', 'skips'] : ['title', 'start', 'end', 'allDay', 'tz', 'repeat', 'skips'];
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) throw new ModuleError(`module.json: refs "${kind}" dated.${key} is not used`);
  }
  const field = (name, required) => {
    if (raw[name] === undefined || raw[name] === null) {
      if (required) throw new ModuleError(`module.json: refs "${kind}" dated.${name} must name a stored field`);
      return null;
    }
    if (typeof raw[name] !== 'string' || !HOLDS_FIELD_RE.test(raw[name])) throw new ModuleError(`module.json: refs "${kind}" dated.${name} must name a stored field`);
    return raw[name];
  };
  const title = field('title', true);
  const repeat = field('repeat', false);
  const skips = field('skips', false);
  if (skips && !repeat) throw new ModuleError(`module.json: refs "${kind}" dated.skips needs dated.repeat`);
  if (wall) {
    const dated = { form: 'wall', title, day: field('day', true) };
    const time = field('time', false);
    const endDay = field('endDay', false);
    const endTime = field('endTime', false);
    const minutes = field('minutes', false);
    if (time) dated.time = time;
    if (endDay) dated.endDay = endDay;
    if (endTime) dated.endTime = endTime;
    if (minutes) dated.minutes = minutes;
    if (raw.zone !== undefined && raw.zone !== null) {
      const z = raw.zone;
      if (typeof z !== 'object' || Array.isArray(z) || typeof z.key !== 'string' || !/^[A-Za-z0-9:_.-]{1,80}$/.test(z.key) || typeof z.field !== 'string' || !HOLDS_FIELD_RE.test(z.field)) {
        throw new ModuleError(`module.json: refs "${kind}" dated.zone must be { "key": a stored key, "field": a stored field }`);
      }
      dated.zone = { key: z.key, field: z.field };
    }
    if (repeat) dated.repeat = repeat;
    if (skips) dated.skips = skips;
    return dated;
  }
  const dated = { form: 'instant', title, start: field('start', true) };
  const end = field('end', false);
  const allDay = field('allDay', false);
  const tz = field('tz', false);
  if (end) dated.end = end;
  if (allDay) dated.allDay = allDay;
  if (tz) dated.tz = tz;
  if (repeat) dated.repeat = repeat;
  if (skips) dated.skips = skips;
  return dated;
}

function cleanMirror(kind, raw, dated) {
  if (raw === undefined || raw === null) return null;
  if (raw !== 'out' && raw !== 'in') throw new ModuleError(`module.json: refs "${kind}" mirror must be "out" or "in"`);
  if (!dated) throw new ModuleError(`module.json: refs "${kind}" mirror needs dated`);
  return raw;
}

function cleanCreate(kind, raw, mirror) {
  if (raw === undefined || raw === null) {
    if (mirror === 'in') throw new ModuleError(`module.json: refs "${kind}" mirror "in" needs create`);
    return null;
  }
  if (mirror !== 'in') throw new ModuleError(`module.json: refs "${kind}" create is only for mirror "in"`);
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ModuleError(`module.json: refs "${kind}" create must be an object`);
  const create = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!HOLDS_FIELD_RE.test(key)) throw new ModuleError(`module.json: refs "${kind}" create.${key} must name a stored field`);
    const ok = value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
    if (!ok || (typeof value === 'string' && value.length > 200)) throw new ModuleError(`module.json: refs "${kind}" create.${key} must be text, a number, or null`);
    create[key] = value;
  }
  if (!Object.keys(create).length) throw new ModuleError(`module.json: refs "${kind}" create needs a field`);
  return create;
}

// Events and actions: how modules react to and ask things of each other, carried by the host without
// naming any module. A module lists the events it `publishes` and the ones it wants to hear
// (`subscribes`), and the actions it `provides` (a name, a label, the input it takes) and the ones it
// wants to ask for (`uses`). What a module subscribes to or uses is approved by an admin, like refs.
const EVENT_NAME_RE = /^[a-z][a-zA-Z0-9]{0,31}$/;
const FIELD_RE = /^[a-z][a-zA-Z0-9]{0,23}$/;
const FIELD_TYPES = ['string', 'text', 'date', 'datetime', 'boolean', 'number', 'ref'];
// An action's input may also be `object`: a whole object of the objects format, cleaned by its checker on the bus
// (plan-object-handoff.md, "What modules declare"). Event data may not.
const INPUT_TYPES = [...FIELD_TYPES, 'object'];
const BUS_USE_RE = /^[a-z][a-z0-9-]{1,31}:[a-z][a-zA-Z0-9]{0,31}$/;

// Stored keys a module's author renamed (`storage.renamed: [{ from, to }]`, each a key prefix, applied in the order
// listed): whenever the module's running version declares a rename, the server moves every stored key starting with
// `from` to the same key starting with `to`, in every scope of the module's data (syncStoredKeys in index.js). A prefix
// uses a key's own characters; a pair's `to` must not start with, or be the start of, its own `from` or an earlier
// pair's (so a rename never applies to its own result and no set of renames moves a key back: a:→b: with b:→a: is
// refused, a chain a:→b: then b:→c: is not), and a prefix is renamed from only once. Always returns a list.
const STORAGE_PREFIX_RE = /^[A-Za-z0-9_.:/-]{1,64}$/;
function cleanStorage(raw) {
  if (raw === undefined || raw === null) return { renamed: [] };
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ModuleError('module.json: "storage" must be an object, such as { "renamed": [{ "from": "item:", "to": "plan:" }] }.');
  const list = raw.renamed === undefined ? [] : raw.renamed;
  if (!Array.isArray(list) || list.length > 10) throw new ModuleError('module.json: storage.renamed must be a list of at most 10 { "from", "to" } key prefixes.');
  const renamed = [];
  for (const r of list) {
    if (!r || typeof r !== 'object' || typeof r.from !== 'string' || typeof r.to !== 'string') throw new ModuleError('module.json: each storage.renamed entry needs a "from" and a "to" key prefix.');
    if (!STORAGE_PREFIX_RE.test(r.from) || !STORAGE_PREFIX_RE.test(r.to)) throw new ModuleError(`module.json: storage.renamed "${r.from}" to "${r.to}": a key prefix is 1 to 64 letters, digits and . _ : / -.`);
    if (r.from.startsWith(r.to) || r.to.startsWith(r.from)) throw new ModuleError(`module.json: storage.renamed "${r.from}" to "${r.to}": one prefix must not start with the other.`);
    if (renamed.some((x) => x.from === r.from)) throw new ModuleError(`module.json: storage.renamed lists "${r.from}" more than once.`);
    const back = renamed.find((x) => r.to.startsWith(x.from) || x.from.startsWith(r.to));
    if (back) throw new ModuleError(`module.json: storage.renamed "${r.from}" to "${r.to}" would move keys back under "${back.from}", which an earlier entry renames from.`);
    renamed.push({ from: r.from, to: r.to });
  }
  return { renamed };
}

// An action's `takes`: what objects it accepts (plan-object-handoff.md, "What modules declare"), as a list of
// { kinds, except?, as, permission? }. `kinds` are kinds from the objects format's catalogue, "*" (any object) or "text"
// (an ordinary message's words); `except` (with "*" only) the catalogue kinds "*" leaves out; `as` the words after
// "Add to <module> as", up to 40 characters ({kind} is the object's kind with "a" or "an"); `permission` one of the
// module's own permissions the person must also have. Null when the action declares none.
const MAX_TAKES = 10;
const MAX_TAKE_AS = 40;
function cleanTakes(raw, action, permissionKeys) {
  if (raw === undefined || raw === null) return null;
  const known = [...objectFormat.KINDS, ...objectFormat.HANDOFF_KINDS];
  const where = `module.json: action "${action}" takes`;
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_TAKES) throw new ModuleError(`${where} must be a list of 1 to ${MAX_TAKES} entries, such as { "kinds": ["note"], "as": "a note" }`);
  return raw.map((e) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new ModuleError(`${where} entries must each be an object with "kinds" and "as"`);
    if (!Array.isArray(e.kinds) || !e.kinds.length || e.kinds.length > known.length + objectFormat.TAKE_WORDS.length) throw new ModuleError(`${where} needs "kinds": a list of kinds of object, "*" or "text"`);
    const kinds = [];
    for (const k of e.kinds) {
      if (typeof k !== 'string' || (!known.includes(k) && !objectFormat.TAKE_WORDS.includes(k))) throw new ModuleError(`${where} "${String(k).slice(0, 40)}", which is not a kind of object, "*" or "text"`);
      if (!kinds.includes(k)) kinds.push(k);
    }
    const entry = { kinds };
    if (e.except !== undefined) {
      if (!kinds.includes('*')) throw new ModuleError(`${where} "except" needs "*" in its kinds`);
      if (!Array.isArray(e.except) || !e.except.length || e.except.length > objectFormat.KINDS.length) throw new ModuleError(`${where} "except" must be a list of kinds of object`);
      const except = [];
      for (const k of e.except) {
        if (typeof k !== 'string' || !objectFormat.KINDS.includes(k)) throw new ModuleError(`${where} except "${String(k).slice(0, 40)}", which is not a kind of object "*" can take`);
        if (kinds.includes(k)) throw new ModuleError(`${where} both lists and leaves out "${k}"`);
        if (!except.includes(k)) except.push(k);
      }
      entry.except = except;
    }
    const as = typeof e.as === 'string' ? e.as.replace(/[\s\p{Cc}]+/gu, ' ').trim() : '';
    if (!as || as.length > MAX_TAKE_AS) throw new ModuleError(`${where} needs "as": the words after "Add to <module> as", up to ${MAX_TAKE_AS} characters`);
    entry.as = as;
    if (e.permission !== undefined) {
      if (typeof e.permission !== 'string' || !permissionKeys.includes(e.permission)) throw new ModuleError(`${where} permission "${String(e.permission).slice(0, 40)}" must name one of the module's own permissions`);
      entry.permission = e.permission;
    }
    return entry;
  });
}

// `permissionKeys`: the keys of the module's own permissions, which a `takes` entry may name.
function cleanBus(rawEvents, rawActions, id, permissionKeys = []) {
  const events = { publishes: [], subscribes: [] };
  for (const p of Array.isArray(rawEvents?.publishes) ? rawEvents.publishes.slice(0, 10) : []) {
    const name = typeof p?.name === 'string' ? p.name.trim() : '';
    if (!EVENT_NAME_RE.test(name)) throw new ModuleError(`module.json: event name "${name}" must be letters and digits, starting with a lowercase letter`);
    if (events.publishes.some((x) => x.name === name)) throw new ModuleError(`module.json: event "${name}" is listed twice`);
    const kind = typeof p.kind === 'string' && REF_KIND_RE.test(p.kind) ? p.kind : '';
    // What the event carries in its data (up to 6 named fields, typed as an action's input is), so a module
    // that follows an item can offer what to do with each.
    const data = {};
    for (const [field, type] of Object.entries(p.data && typeof p.data === 'object' ? p.data : {}).slice(0, 6)) {
      const base = typeof type === 'string' ? type.replace(/\?$/, '') : '';
      if (!FIELD_RE.test(field) || !FIELD_TYPES.includes(base)) throw new ModuleError(`module.json: event "${name}" data "${field}" must be one of ${FIELD_TYPES.join(', ')} (add ? for optional)`);
      data[field] = type;
    }
    events.publishes.push({ name, kind, label: String(p.label ?? '').replace(/\p{Cc}/gu, ' ').trim().slice(0, 60) || name, data });
  }
  for (const c of Array.isArray(rawEvents?.subscribes) ? rawEvents.subscribes.slice(0, 20) : []) {
    if (typeof c !== 'string' || (c !== '*' && !BUS_USE_RE.test(c))) throw new ModuleError(`module.json: events.subscribes "${c}" must be "*" or look like "module:event"`);
    if (c !== '*' && c.split(':')[0] === id) throw new ModuleError('module.json: a module does not need to subscribe to its own events');
    if (!events.subscribes.includes(c)) events.subscribes.push(c);
  }
  const actions = { provides: [], uses: [] };
  for (const p of Array.isArray(rawActions?.provides) ? rawActions.provides.slice(0, 10) : []) {
    const name = typeof p?.name === 'string' ? p.name.trim() : '';
    if (!EVENT_NAME_RE.test(name)) throw new ModuleError(`module.json: action name "${name}" must be letters and digits, starting with a lowercase letter`);
    if (actions.provides.some((x) => x.name === name)) throw new ModuleError(`module.json: action "${name}" is listed twice`);
    const input = {};
    for (const [field, type] of Object.entries(p.input && typeof p.input === 'object' ? p.input : {}).slice(0, 10)) {
      const base = typeof type === 'string' ? type.replace(/\?$/, '') : '';
      // A pointer field may say which kind of item it takes: "ref" (any) or "ref:module:kind".
      const plain = /^ref:[a-z][a-z0-9-]{1,31}:[a-z][a-z0-9-]{0,31}$/.test(base) ? 'ref' : base;
      if (!FIELD_RE.test(field) || !INPUT_TYPES.includes(plain)) throw new ModuleError(`module.json: action "${name}" input "${field}" must be one of ${INPUT_TYPES.join(', ')} (add ? for optional)`);
      input[field] = type;
    }
    // An `object` input and `takes` go together: the bus checks the object's kind against `takes`.
    const objectFields = Object.entries(input).filter(([, type]) => type.replace(/\?$/, '') === 'object').map(([field]) => field);
    if (objectFields.length > 1) throw new ModuleError(`module.json: action "${name}" can have only one input of type "object"`);
    const takes = cleanTakes(p.takes, name, permissionKeys);
    if (takes && !objectFields.length) throw new ModuleError(`module.json: action "${name}" takes objects, so it needs an input of type "object"`);
    if (!takes && objectFields.length) throw new ModuleError(`module.json: action "${name}" input "${objectFields[0]}" is an object, so the action needs "takes"`);
    // `local`: a view, carried out only by the requesting person's own open page of the module and needing only read access
    // (showing something on a map), not something done for the room.
    // `needs` has two meanings, both read by the asking side, never by the bus. With a `ref` input: what the object it
    // points at must have on its card for this action to make sense of it (a position, a date, text), so a drop menu
    // leaves it out for an object without -- "Show on the map" for a task, say. On any action, with or without a `ref`
    // input: what the request itself must carry, so a module offers the action only when it can fill that in -- the
    // Calendar's createEvent needs ["date"], and To-do's rules and Polls offer it only when they have a day to give.
    // Kept as declared either way; the bus does not refuse a request that leaves an optional field out.
    const needs = [...new Set((Array.isArray(p.needs) ? p.needs : []).filter((f) => ['place', 'date', 'text', 'subtitle'].includes(f)))];
    // `askerOnly`: what the action makes belongs to the person who asked (a photo in their name, from their upload), so only
    // their own open page of the module takes the request, which waits until then; asking still needs write access.
    if (p.askerOnly !== undefined && typeof p.askerOnly !== 'boolean') throw new ModuleError(`module.json: action "${name}" askerOnly must be true or false`);
    if (p.askerOnly && p.local === true) throw new ModuleError(`module.json: action "${name}" is local, which is already for the asker only`);
    actions.provides.push({ name, label: String(p.label ?? '').replace(/\p{Cc}/gu, ' ').trim().slice(0, 60) || name, input, ...(p.local === true ? { local: true } : {}), ...(p.askerOnly ? { askerOnly: true } : {}), ...(needs.length ? { needs } : {}), ...(takes ? { takes } : {}) });
  }
  for (const c of Array.isArray(rawActions?.uses) ? rawActions.uses.slice(0, 20) : []) {
    if (typeof c !== 'string' || (c !== '*' && !BUS_USE_RE.test(c))) throw new ModuleError(`module.json: actions.uses "${c}" must be "*" or look like "module:action"`);
    if (c !== '*' && c.split(':')[0] === id) throw new ModuleError('module.json: a module does not need to use its own actions');
    if (!actions.uses.includes(c)) actions.uses.push(c);
  }
  return { events, actions };
}

// The tints a module may take as its colour (plan-chat-model.md): names of the theme's --tint-* tokens, never a
// fixed colour. Absent means neutral. `gold` is AI's, which is the host's, but a module may use it too.
const TINTS = ['gold', 'blue', 'green', 'teal', 'purple', 'red', 'orange', 'pink'];
function cleanColor(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string' || !TINTS.includes(raw)) throw new ModuleError(`module.json: "color" must be one of ${TINTS.join(', ')}`);
  return raw;
}

// Commands Chat lists and routes: each names a local action that takes `{ text }`. `ai` is reserved by the host.
const COMMAND_NAME_RE = /^[a-z0-9]{1,12}$/;
const COMMAND_WORD_RE = /^[a-z]{2,12}$/;
function cleanCommands(raw, actions) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ModuleError('module.json: "commands" must be a list');
  if (raw.length > 20) throw new ModuleError('module.json: "commands" can list at most 20 commands');
  const out = [];
  const seen = new Set();
  for (const c of raw) {
    const name = typeof c?.name === 'string' ? c.name.trim() : '';
    if (!COMMAND_NAME_RE.test(name)) throw new ModuleError(`module.json: command name "${name}" must be 1 to 12 lowercase letters or digits`);
    if (name === 'ai') throw new ModuleError('module.json: command name "ai" is reserved');
    if (seen.has(name)) throw new ModuleError(`module.json: command "${name}" is listed twice`);
    seen.add(name);
    const action = typeof c?.action === 'string' ? c.action.trim() : '';
    const def = (actions.provides || []).find((a) => a.name === action);
    if (!action || !def) throw new ModuleError(`module.json: command "${name}" action "${action || ''}" is not in actions.provides`);
    if (!def.local) throw new ModuleError(`module.json: command "${name}" action "${action}" must be local`);
    const textType = def.input && def.input.text;
    const textBase = typeof textType === 'string' ? textType.replace(/\?$/, '') : '';
    if (textBase !== 'string' && textBase !== 'text') throw new ModuleError(`module.json: command "${name}" action "${action}" must accept { "text": "string" }`);
    const label = String(c.label ?? '').replace(/\p{Cc}/gu, ' ').trim().slice(0, 60) || name;
    const hint = String(c.hint ?? '').replace(/\p{Cc}/gu, ' ').trim().slice(0, 80);
    // The full word the short name stands for (/t or /todo): its first letter is the name, so the two can't drift apart.
    let word = '';
    if (c.word !== undefined && c.word !== null && c.word !== '') {
      word = typeof c.word === 'string' ? c.word.trim() : '';
      if (!COMMAND_WORD_RE.test(word) || word[0] !== name) throw new ModuleError(`module.json: command "${name}" word must be 2 to 12 lowercase letters and start with "${name}"`);
    }
    out.push({ name, ...(word ? { word } : {}), label, action, ...(hint ? { hint } : {}) });
  }
  return out;
}

// The settings a module declares: up to 40, each with a scope (who chooses it), a type and a default.
const SETTING_TYPES = ['boolean', 'choice', 'number', 'text', 'url', 'file', 'files', 'list', 'color', 'note'];
const SETTING_SCOPES = ['environment', 'space', 'person'];
const COLOR_RE = /^#[0-9a-f]{6}$/i;
// A path a keyed surface (surfaces.keyed.path) may not claim: the host's own top-level routes, kept here so a
// module manifest is refused up front rather than claiming a path nothing would ever route to it. "view" is
// deliberately not here -- the Stream module's own claim, left reachable once GET /view/:key's page-serving
// goes in phase 3 (see plan-stream-module.md); until then the old route simply answers first (it is registered
// earlier), so the claim exists but nothing reaches it yet.
const RESERVED_KEYED_PATHS = ['api', 'm', 'modules', 'img', 'login', 'logout', 'register', 'guest', 'rooms', 'spaces', 'admin', 'profile', 'fa', 'lib', 'assets', 'sdk', 'invite', 'me', 'module-settings'];
const KEYED_PATH_RE = /^[a-z0-9-]{2,20}$/;
// A module's place search, asked from the server (see geocode.js): which settings say where to search, and the providers it knows.
// { provider: <a choice setting>, address: <a url setting for a custom address>, save: <a boolean setting: keep what comes back>,
//   custom: <the provider value that means the address>, providers: { <provider value>: { address, credit } } }, or null.
// A module's `uploads`: the files its people may add ({ types, maxBytes, maxFiles }), or null for none. Only pictures for now.
function cleanUploads(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ModuleError('module.json: uploads must be an object');
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  const types = Array.isArray(raw.types) ? [...new Set(raw.types.filter((t) => allowed.includes(t)))] : allowed;
  if (!types.length) throw new ModuleError('module.json: uploads.types can be image/jpeg, image/png and image/webp');
  const num = (v, max, def) => (Number.isInteger(v) && v >= 1 ? Math.min(v, max) : def);
  return { types, maxBytes: num(raw.maxBytes, 10 * 1024 * 1024, 10 * 1024 * 1024), maxFiles: num(raw.maxFiles, 5000, 500) };
}

// A module's `library: true`: it keeps a space's files (server/vault-store.js, documentation/plans/plan-attachments-vault.md),
// served by the host's library routes. It needs the space scope and the four permissions those routes are guarded by:
// view (see the files), add (add them), download, remove_any (remove someone else's). Guests never reach a library
// route, whatever Roles says, so none of the four is on for them by default.
const LIBRARY_PERMISSIONS = ['view', 'add', 'download', 'remove_any'];
function cleanLibrary(raw, scope, permissions) {
  if (raw === undefined || raw === null || raw === false) return false;
  if (raw !== true) throw new ModuleError('module.json: library must be true, or left out');
  if (!scope.includes('space')) throw new ModuleError('module.json: library needs the "space" scope');
  const missing = LIBRARY_PERMISSIONS.filter((k) => !permissions.some((p) => p.key === k));
  if (missing.length) throw new ModuleError(`module.json: library needs the permission${missing.length === 1 ? '' : 's'} ${missing.join(', ')}`);
  return true;
}

// A module's own `regionSource`: cutting a region out of a larger PMTiles file into one of its own file folders (see
// server/region-cut.js). `folder` must be a `files`-type setting's own folder (so the admin already has a way to see and
// tick what lands there), and `address` a `url` setting naming where to cut from.
function cleanRegionSource(raw, settings) {
  if (!raw || typeof raw !== 'object') return null;
  const known = (k, type) => typeof k === 'string' && settings.some((d) => d.key === k && (!type || d.type === type));
  if (typeof raw.folder !== 'string' || !settings.some((d) => d.type === 'files' && d.folder === raw.folder)) throw new ModuleError('module.json: regionSource needs a `folder` matching a "files" setting\'s own folder');
  if (!known(raw.address, 'url')) throw new ModuleError('module.json: regionSource needs an `address` url setting');
  return { folder: raw.folder, address: raw.address };
}

// A module's own `pictureMap`: the `file` setting that names a picture map (a raster PMTiles file of an invented world)
// for the whole environment. It must be a `file` setting that takes an upload of picture tiles, so the server can check
// what is put there. The server then tells every module (the context's `environment.pictureMap`) while it is set.
function cleanPictureMap(raw, settings) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.setting !== 'string' || !settings.some((d) => d.key === raw.setting && d.type === 'file' && d.upload && d.upload.accept === 'pmtiles-picture')) throw new ModuleError('module.json: pictureMap needs a `setting` naming a "file" setting with "upload": { "accept": "pmtiles-picture" }');
  return { setting: raw.setting };
}

// The lookups a module asks the server for (documentation/plans/plan-flight-lookup.md): `"lookups": ["flight"]`, or none.
// The one kind today is `flight`: GET /api/modules/:id/flight-lookup and POST .../flight-lookup/remember (index.js).
const LOOKUP_KINDS = ['flight'];
function cleanLookups(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ModuleError(`module.json: lookups must be a list; the lookups are ${LOOKUP_KINDS.join(', ')}`);
  const out = [];
  for (const k of raw.slice(0, 10)) {
    if (!LOOKUP_KINDS.includes(k)) throw new ModuleError(`module.json: lookups: "${typeof k === 'string' ? k.slice(0, 40) : k}" is not a lookup; the lookups are ${LOOKUP_KINDS.join(', ')}`);
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

function cleanGeocoder(raw, settings) {
  if (!raw || typeof raw !== 'object') return null;
  const known = (k, type) => typeof k === 'string' && settings.some((d) => d.key === k && (!type || d.type === type));
  if (!known(raw.provider, 'choice') || !known(raw.address, 'url')) throw new ModuleError('module.json: geocoder needs a `provider` choice setting and an `address` url setting');
  const out = { provider: raw.provider, address: raw.address, save: known(raw.save, 'boolean') ? raw.save : '', custom: typeof raw.custom === 'string' ? raw.custom.slice(0, 40) : 'custom', providers: {} };
  for (const [k, v] of Object.entries(raw.providers && typeof raw.providers === 'object' ? raw.providers : {}).slice(0, 5)) {
    if (!/^[a-z][a-z0-9-]{0,23}$/.test(k) || !v || typeof v.address !== 'string' || !/^https:\/\/[^\s]{1,300}$/.test(v.address)) throw new ModuleError(`module.json: geocoder provider "${k}" needs an https address`);
    out.providers[k] = { address: v.address, credit: text(v.credit, 100), name: text(v.name, 30) || k };
  }
  return out;
}

// Longer text that keeps its line breaks, for help that needs more than a line: a setting's own help, and a choice option's.
const longText = (s, n) => String(s ?? '').replace(/(?!\n)\p{Cc}/gu, ' ').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);

function cleanSettings(raw) {
  const out = [];
  for (const r of Array.isArray(raw) ? raw.slice(0, 40) : []) {
    const key = typeof r?.key === 'string' ? r.key.trim() : '';
    if (!/^[a-z][a-zA-Z0-9]{0,23}$/.test(key)) throw new ModuleError(`module.json: setting key "${key}" must be letters and digits, starting with a lowercase letter`);
    if (out.some((d) => d.key === key)) throw new ModuleError(`module.json: setting "${key}" is listed twice`);
    const type = SETTING_TYPES.includes(r.type) ? r.type : null;
    if (!type) throw new ModuleError(`module.json: setting "${key}" needs a type: ${SETTING_TYPES.join(', ')}`);
    const scope = SETTING_SCOPES.includes(r.scope) ? r.scope : 'environment';
    const def = { key, label: text(r.label, 60) || key, help: longText(r.help, 600), type, scope };
    // A setting may be shown only while another one has a given value (`showWhen`), and a choice may start as one of its options
    // when another setting already holds a value and it has none of its own (`defaultIfSet`: for a setting that grew into a choice).
    if (r.showWhen && typeof r.showWhen === 'object') {
      const k = typeof r.showWhen.key === 'string' ? r.showWhen.key : '';
      if (/^[a-z][a-zA-Z0-9]{0,23}$/.test(k) && typeof r.showWhen.value === 'string') def.showWhen = { key: k, value: r.showWhen.value.slice(0, 40) };
      else if (/^[a-z][a-zA-Z0-9]{0,23}$/.test(k) && typeof r.showWhen.not === 'string') def.showWhen = { key: k, not: r.showWhen.not.slice(0, 40) }; // shown unless it has this value
    }
    if (type === 'choice') {
      def.options = (Array.isArray(r.options) ? r.options.slice(0, 12) : []).map((o) => ({ value: typeof o?.value === 'string' ? o.value.trim().slice(0, 40) : '', label: text(o?.label, 40), help: longText(o?.help, 600) })).filter((o) => o.value).map((o) => ({ value: o.value, label: o.label || o.value, ...(o.help ? { help: o.help } : {}) }));
      if (def.options.length < 2) throw new ModuleError(`module.json: setting "${key}" needs at least two options`);
      def.default = def.options.some((o) => o.value === r.default) ? r.default : def.options[0].value;
      const dif = r.defaultIfSet;
      if (dif && typeof dif.key === 'string' && /^[a-z][a-zA-Z0-9]{0,23}$/.test(dif.key) && def.options.some((o) => o.value === dif.value)) def.defaultIfSet = { key: dif.key, value: dif.value };
    } else if (type === 'number') {
      if (Number.isFinite(r.min)) def.min = r.min;
      if (Number.isFinite(r.max)) def.max = r.max;
      let d = Number.isFinite(r.default) ? r.default : def.min ?? 0;
      if (def.min !== undefined) d = Math.max(def.min, d);
      if (def.max !== undefined) d = Math.min(def.max, d);
      def.default = d;
    } else if (type === 'list') {
      // Rows with a label, an icon and a colour (see setting-list.js); `fixed` names rows that cannot be removed.
      def.fixed = (Array.isArray(r.fixed) ? r.fixed : []).filter((x) => typeof x === 'string' && /^[a-z][a-z0-9-]{0,29}$/.test(x)).slice(0, 20);
      def.maxLength = clamp(r.maxLength, 1, 30, 30);
      try {
        def.default = cleanRows(Array.isArray(r.default) ? r.default : [], def);
      } catch (err) {
        throw new ModuleError(`module.json: setting "${key}" default ${err.message}`);
      }
    } else if (type === 'url') {
      def.default = '';
      // Optional limits on an address: https only, and the path must end so (".pmtiles"). Credentials in an address are always refused.
      if (r.httpsOnly === true) def.httpsOnly = true;
      if (typeof r.pathEnds === 'string' && /^\.?[A-Za-z0-9]{1,12}$/.test(r.pathEnds)) def.pathEnds = r.pathEnds.startsWith('.') ? r.pathEnds : `.${r.pathEnds}`;
    } else if (type === 'file' || type === 'files') {
      // A file (or, for `files`, several: a table of what is there with a tick for each) the admin placed for the module, in a folder of the module's own (DATA_DIR/modules/<id>/<folder>/): only the
      // server can choose one. `shared: "host"` makes the folder the host's, one for every environment, rather
      // than each environment's own (documentation/plans/plan-environments.md, "Shared files: the host's map") --
      // only with a base domain; without one the declaration has no effect, since there is no separate host.
      if (def.scope !== 'environment') throw new ModuleError(`module.json: setting "${key}" is a file, so its scope must be "environment"`);
      const folder = r.folder === undefined ? 'files' : String(r.folder);
      // The host's own folders beside it (its versions, data, uploads, a Clear's held data, a library's files) can't be named.
      if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(folder) || RESERVED_FOLDERS.includes(folder)) throw new ModuleError(`module.json: setting "${key}" folder must be lowercase letters, digits and dashes, and not ${RESERVED_FOLDERS.map((f) => `"${f}"`).join(', ')}`);
      def.folder = folder;
      if (r.shared === 'host') def.shared = 'host';
      // `upload`: the owner may put a file here through the page (PUT /api/modules/:id/files/:folder), checked as `accept` says.
      // The one kind is `pmtiles-picture`: a PMTiles file of picture (raster) tiles, one file, no host sharing.
      if (r.upload !== undefined) {
        if (type !== 'file' || !r.upload || r.upload.accept !== 'pmtiles-picture') throw new ModuleError(`module.json: setting "${key}" upload must be { "accept": "pmtiles-picture" } on a "file" setting`);
        if (def.shared) throw new ModuleError(`module.json: setting "${key}" takes uploads, so it cannot be shared with the host`);
        def.upload = { accept: 'pmtiles-picture' };
      }
      def.default = type === 'files' ? [] : '';
    } else if (type === 'color') {
      def.default = typeof r.default === 'string' && COLOR_RE.test(r.default.trim()) ? r.default.trim().toLowerCase() : '#000000';
    } else if (type === 'note') {
      // A label and a hint among the other settings, with no control and no value of its own -- a way for a
      // module to say where something is set up (a search a sibling module owns, e.g.) without a value to read,
      // validate or store. Always environment-level display, whatever scope the manifest asks for or none at all.
      if (r.scope !== undefined && r.scope !== 'environment') throw new ModuleError(`module.json: setting "${key}" is a note, so its scope must be "environment"`);
      def.scope = 'environment';
    } else if (type === 'text') {
      def.maxLength = clamp(r.maxLength, 1, 200, 100);
      def.default = typeof r.default === 'string' ? r.default.slice(0, def.maxLength) : '';
    } else {
      def.default = Boolean(r.default);
    }
    out.push(def);
  }
  return out;
}

// A module's own permission key: lowercase letters, digits and underscores, starting with a letter (tools/check-modules.mjs
// holds the bundled modules to it).
const PERMISSION_KEY_RE = /^[a-z][a-z0-9_]{0,23}$/;

// The module's own scopes, each once.
function cleanScope(raw) {
  return [...new Set(Array.isArray(raw) ? raw : [])].filter((s) => SCOPES.includes(s));
}

// A module's parts of the host's destinations (plan-calendar-destination.md, "Server"; server/destinations.js): up to two,
// each { id, part, entry, label?, order? }, for a destination the host knows, at most one main and one panel per
// destination. A part is mounted at environment scope, so it needs that scope. Asks the admin for nothing new.
const DESTINATION_PART_KEYS = ['id', 'part', 'entry', 'label', 'order'];
function cleanDestinationParts(raw, files, scope) {
  const what = 'module.json: surfaces.destination';
  if (!Array.isArray(raw)) throw new ModuleError(`${what} must be a list of parts`);
  if (raw.length > 2) throw new ModuleError(`${what} lists at most two parts`);
  if (raw.length && !scope.includes('environment')) throw new ModuleError('module.json: surfaces.destination needs the "environment" scope');
  const seen = new Set();
  return raw.map((p) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new ModuleError(`${what}: write each part as { "id", "part", "entry" }`);
    const extra = Object.keys(p).find((k) => !DESTINATION_PART_KEYS.includes(k));
    if (extra) throw new ModuleError(`${what}: "${extra}" is not a part's field; the fields are ${DESTINATION_PART_KEYS.join(', ')}`);
    if (!DESTINATION_IDS.includes(p.id)) throw new ModuleError(`${what}: "${String(p.id ?? '').slice(0, 40)}" is not a destination; the destinations are ${DESTINATION_IDS.join(' and ')}`);
    if (!DESTINATION_PARTS.includes(p.part)) throw new ModuleError(`${what}: a part must be "main" or "panel"`);
    if (seen.has(`${p.id}:${p.part}`)) throw new ModuleError(`${what}: only one ${p.part} part for ${p.id}`);
    seen.add(`${p.id}:${p.part}`);
    if (p.label !== undefined && typeof p.label !== 'string') throw new ModuleError(`${what}: a part's label must be words`);
    if (p.order !== undefined && !Number.isFinite(p.order)) throw new ModuleError(`${what}: a part's order must be a number`);
    const part = { id: p.id, part: p.part, entry: cleanEntry(p.entry, files, `surfaces.destination (${p.id} ${p.part})`) };
    const label = text(p.label, 40);
    if (label) part.label = label;
    if (p.order !== undefined) part.order = clamp(Math.round(p.order), -1000, 1000, 100);
    return part;
  });
}
function cleanManifest(raw, files) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ModuleError('module.json must be an object');
  const old = oldNameIn(raw);
  if (old) throw new ModuleError(old);
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!ID_RE.test(id)) throw new ModuleError('module.json: "id" must be 2-32 lowercase letters, digits or dashes, starting with a letter');
  if (RESERVED_IDS.includes(id)) throw new ModuleError(`module.json: "${id}" is a reserved id and cannot be used`);
  const name = text(raw.name, 40);
  if (!name) throw new ModuleError('module.json: "name" is required');
  const version = typeof raw.version === 'string' ? raw.version.trim() : '';
  if (!VERSION_RE.test(version)) throw new ModuleError('module.json: "version" must look like 1.2.3');
  const scope = cleanScope(raw.scope);
  if (!scope.length) throw new ModuleError('module.json: "scope" must include "environment", "space", or both');
  const icon = typeof raw.icon === 'string' && /^[a-z0-9-]{1,40}$/.test(raw.icon) ? raw.icon : 'puzzle-piece';
  const color = cleanColor(raw.color);

  const surfaces = {};
  // `nav: false` (default true) leaves a module's page out of the main nav's icon row -- for one better
  // reached another way (a space's canvas, a link from what it's about), so the row is not clutter.
  if (raw.surfaces?.page) surfaces.page = { entry: cleanEntry(raw.surfaces.page.entry, files, 'surfaces.page'), nav: raw.surfaces.page.nav !== false };
  if (raw.surfaces?.canvas) {
    const c = raw.surfaces.canvas;
    surfaces.canvas = {
      entry: cleanEntry(c.entry, files, 'surfaces.canvas'),
      width: clamp(c.width, 240, 1200, 420),
      height: clamp(c.height, 200, 1000, 520),
      // How the module may be shown on a space's canvas: floating over the call, docked as a column, or both.
      mode: (() => {
        const modes = [...new Set(Array.isArray(c.mode) ? c.mode : [])].filter((m) => ['float', 'dock'].includes(m));
        return modes.length ? modes : ['float'];
      })(),
      // Whether it belongs on the Lobby's canvas (plan-modules, "the Lobby is for being together"): absent or false
      // keeps it out of the Lobby. Narrows where a module can be and widens nothing, so it asks for no approval.
      lobby: (() => {
        if (c.lobby !== undefined && typeof c.lobby !== 'boolean') throw new ModuleError('module.json: surfaces.canvas.lobby must be true or false');
        return c.lobby === true;
      })(),
      // Whether the canvas menu offers it to open. A module can be on in a space (permissions, hooks)
      // without a window of its own. Absent or true: listed. False: not offered, not restored.
      menu: (() => {
        if (c.menu !== undefined && typeof c.menu !== 'boolean') throw new ModuleError('module.json: surfaces.canvas.menu must be true or false');
        return c.menu !== false;
      })(),
    };
  }
  if (raw.surfaces?.widget) {
    // A small view of the module for the dashboard on the rooms page, across the viewer's rooms.
    if (!scope.includes('environment')) throw new ModuleError('module.json: a surfaces.widget needs the "environment" scope');
    const w = raw.surfaces.widget;
    surfaces.widget = {
      entry: cleanEntry(w.entry, files, 'surfaces.widget'),
      title: text(w.title, 40),
      size: ['small', 'medium', 'wide', 'tall'].includes(w.size) ? w.size : 'small',
      order: Number.isFinite(w.order) ? clamp(Math.round(w.order), -1000, 1000, 100) : 100,
    };
  }
  if (raw.surfaces?.keyed) {
    // A page the access key opens instead of a session, at a path this module claims (one enabled module per
    // path -- see ModuleManager.update's enable guard). Always runs in the page, never a frame, since the host
    // draws media into it directly.
    const k = raw.surfaces.keyed;
    const kpath = typeof k.path === 'string' ? k.path.trim() : '';
    if (!KEYED_PATH_RE.test(kpath)) throw new ModuleError('module.json: surfaces.keyed.path must be 2-20 lowercase letters, digits and dashes');
    if (RESERVED_KEYED_PATHS.includes(kpath)) throw new ModuleError(`module.json: "${kpath}" is a path the host already serves and cannot be claimed`);
    surfaces.keyed = { path: kpath, entry: cleanEntry(k.entry, files, 'surfaces.keyed') };
  }
  if (raw.surfaces?.destination !== undefined) surfaces.destination = cleanDestinationParts(raw.surfaces.destination, files, scope);
  if (scope.includes('environment') && !surfaces.page) throw new ModuleError('a module with the "environment" scope needs a surfaces.page');
  if (scope.includes('space') && !surfaces.canvas) throw new ModuleError('a module with the "space" scope needs a surfaces.canvas');

  const permissions = [];
  for (const p of Array.isArray(raw.permissions) ? raw.permissions.slice(0, 20) : []) {
    const key = typeof p?.key === 'string' ? p.key.trim() : '';
    if (!PERMISSION_KEY_RE.test(key)) throw new ModuleError(`module.json: permission key "${key}" must be lowercase letters, digits or underscores`);
    if (permissions.some((x) => x.key === key)) throw new ModuleError(`module.json: permission "${key}" is listed twice`);
    const d = p.default && typeof p.default === 'object' ? p.default : {};
    // `replaces`: the key this permission had in an earlier version, so each role's choice for it is carried over
    // (carryReplacedGrants in index.js) rather than lost when the author renames it.
    const sameReplaces = p.replaces !== undefined && permissions.find((x) => x.replaces === p.replaces);
    if (sameReplaces) throw new ModuleError(`module.json: permission "${key}" replaces "${p.replaces}", which permission "${sameReplaces.key}" already replaces`);
    if (p.replaces !== undefined && (typeof p.replaces !== 'string' || !PERMISSION_KEY_RE.test(p.replaces) || p.replaces === key || (raw.permissions || []).some((x) => x && x.key === p.replaces))) {
      throw new ModuleError(`module.json: permission "${key}" replaces must name a key this module no longer uses`);
    }
    permissions.push({
      ...(p.replaces !== undefined ? { replaces: p.replaces } : {}),
      key,
      label: text(p.label, 60) || key,
      // A manifest names its defaults by the editable roles (an old `user` key is refused above, by oldNameIn).
      default: { member: Boolean(d.member), guest: Boolean(d.guest), moderator: Boolean(d.moderator ?? d.member) },
    });
  }
  const hooks = cleanHooks(raw.hooks);

  const refs = cleanRefs(raw.refs, id);
  const storage = cleanStorage(raw.storage);
  // What the server holds the module's data to beyond access.read and access.write (server/module-guards.js). It only
  // narrows what people may do, so it asks for no approval.
  const guards = cleanGuards(raw.guards, permissions.map((p) => p.key), ModuleError);
  const { events, actions } = cleanBus(raw.events, raw.actions, id, permissions.map((p) => p.key));
  const commands = cleanCommands(raw.commands, actions);

  // Which of the module's own permissions guards reading and writing its data. `personWrite`: the one that guards writing
  // a person's own data (scope "person") in place of `write`, for a module where anyone who may read keeps their own.
  const access = {};
  if (raw.access?.personWrite !== undefined && raw.access?.personWrite !== null && !scope.includes('person')) {
    throw new ModuleError('module.json: access.personWrite needs the "person" scope');
  }
  for (const kind of ['read', 'write', 'personWrite']) {
    const named = raw.access?.[kind];
    if (named === undefined || named === null) continue;
    if (typeof named !== 'string' || !permissions.some((p) => p.key === named)) {
      throw new ModuleError(`module.json: access.${kind} must name one of the module's own permissions`);
    }
    access[kind] = named;
  }

  const settings = cleanSettings(raw.settings);
  const geocoder = cleanGeocoder(raw.geocoder, settings);
  const regionSource = cleanRegionSource(raw.regionSource, settings);
  const pictureMap = cleanPictureMap(raw.pictureMap, settings);
  const uploads = cleanUploads(raw.uploads);
  const lookups = cleanLookups(raw.lookups);
  const library = cleanLibrary(raw.library, scope, permissions);
  if (library) for (const p of permissions) if (LIBRARY_PERMISSIONS.includes(p.key)) p.default.guest = false;

  // The modules this one cannot work without: the one place a manifest names another module (at run time every module still
  // reaches another only through the generic conduits). It cannot be turned on until they are on.
  const requires = [];
  for (const r of Array.isArray(raw.requires) ? raw.requires.slice(0, 5) : []) {
    if (typeof r !== 'string' || !ID_RE.test(r) || r === id) throw new ModuleError('module.json: requires must list other modules by id');
    if (!requires.includes(r)) requires.push(r);
  }

  // How a bundled module gets onto a fresh or updated environment without an admin visiting Modules first (see
  // ModuleManager.autoInstall in index.js's environmentFor): `auto` installs and enables it once, ever, per
  // environment; `settingsFrom: "environment"` copies each declared environment-scope setting's value out of the host's
  // own store.settings on that same install, for one whose fields used to live there.
  const install = raw.install && typeof raw.install === 'object'
    ? { auto: raw.install.auto === true, settingsFrom: raw.install.settingsFrom === 'environment' ? 'environment' : null }
    : null;

  // `"budget": true`: the module reads the space's budget target (host.space().budget; #216), so Set up offers the
  // target in every space while the module is on. Absent or anything else: false.
  const budget = raw.budget === true;

  // How the module's content sits in the slot the host draws (plan-unified-layout.md): padded (the default) or flush,
  // edge to edge, for a module whose content fills the slot (a map).
  if (raw.content !== undefined && raw.content !== 'padded' && raw.content !== 'flush') throw new ModuleError('module.json: content must be "padded" or "flush"');
  const content = raw.content === 'flush' ? 'flush' : 'padded';

  return { id, name, version, description: text(raw.description, 200), author: text(raw.author, 60), icon, color, scope, surfaces, permissions, hooks, refs, storage, guards, events, actions, commands, access, settings, requires, geocoder, uploads, library, regionSource, pictureMap, lookups, budget, content, install };
}

// The sentence for a zip's pages that draw or restyle what the host draws (server/module-layout.js), or null when they do not.
function layoutWarning(files) {
  const found = [];
  for (const [name, data] of files) {
    if (/\.html?$/i.test(name)) found.push(...scanBuiltPage(name, data.toString('utf8')));
  }
  if (!found.length) return null;
  const selectors = [...new Set(found.map((f) => f.selector))];
  const shown = selectors.slice(0, 3).join(', ') + (selectors.length > 3 ? ` and ${selectors.length - 3} more` : '');
  return `This ${word('module')} draws or restyles parts the host draws (${shown}), so it may look out of place; its author should use the host's title bar, toolbar and shared pieces.`;
}

// --- the registry ---------------------------------------------------------

// A permission's defaults from a stored manifest (the author's original), keyed by the editable roles. A missing
// moderator stays off, as it always has here. (A stored manifest with an old `user` key is outdated and never runs.)
function permissionDefaults(d) {
  const given = d && typeof d === 'object' ? d : {};
  return { moderator: Boolean(given.moderator), member: Boolean(given.member), guest: Boolean(given.guest) };
}

// Whether what an update newly asks for (pendingFor's answer) is only permissions that are off for every role, so
// approving it gives nobody but owners (and the admin) anything new. Used only by the bundled update at start
// (updateBundled in index.js); anything else new, or a new permission on for some role, is not.
function pendingWidensNothing(pending, permissions) {
  if (!pending || pending.hooks.length || pending.refs.length || pending.events.length || pending.actions.length) return false;
  return pending.permissions.every((key) => {
    const p = (permissions || []).find((x) => x.key === key);
    return Boolean(p) && Object.values(permissionDefaults(p.default)).every((on) => !on);
  });
}

class ModuleManager {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'modules');
    this.file = path.join(this.dir, 'registry.json');
    this.registry = { modules: {} };
    this.manifests = new Map(); // "id@version" -> manifest, so permission checks do not hit the disk
    // Whether the server-wide AI service is set up and switched on: a module that declares hooks.ai depends on it the way
    // one module can depend on another (see cleanGeocoder... no, see 'ai' in missing/aiDependents below). Set once, after
    // both this and the Ai instance exist (index.js), since the AI service is not a module Modules otherwise knows about.
    this.aiReady = () => false;
    // This environment's words (for the placeholders in a manifest's text) and a module's display name and icon (the
    // owner's, else the template's; null for the manifest's own), set by the environment's build (environment.js).
    this.wordsOf = () => null;
    this.displayOf = () => ({ name: null, icon: null, ownName: null, ownIcon: null, templateName: null, templateIcon: null });
    this.filled = new Map(); // "id@version|words" -> the manifest with its placeholders filled
    this.withPlaceholders = new WeakSet(); // the stored manifests that have any
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && typeof raw.modules === 'object') this.registry = raw;
    } catch {
      // first run, or unreadable: start empty (module files are untouched)
    }
    if (!Array.isArray(this.registry.autoInstalled)) this.registry.autoInstalled = [];
    // Each entry knows its own id (the one check for where a module is on is asked by entry); read, never saved here.
    for (const [id, entry] of Object.entries(this.registry.modules)) if (entry && typeof entry === 'object' && !entry.id) entry.id = id;
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.registry, null, 2));
    fs.renameSync(tmp, this.file);
  }

  // The stored-key renames in effect for a module's data ([{ from, to, at }], storage.renamed; syncStoredKeys in
  // index.js), kept on its registry entry so they travel with a backup, and setting them.
  appliedRenames(id) {
    const entry = this.registry.modules[id];
    return entry && Array.isArray(entry.renamed) ? entry.renamed.filter((r) => r && typeof r.from === 'string' && typeof r.to === 'string') : [];
  }

  setAppliedRenames(id, list) {
    const entry = this.registry.modules[id];
    if (!entry) return;
    entry.renamed = list;
    this.save();
  }

  versionDir(id, version) {
    return path.join(this.dir, id, 'versions', version);
  }

  isInstalled(id) {
    return Boolean(this.registry.modules[id]);
  }

  // Whether a bundled module's install.auto has already run for this environment, ever -- checked before
  // running it again (see autoInstall in index.js's environmentFor), so an admin who later uninstalls the
  // module is respected rather than having it reinstalled out from under them on the next start.
  autoInstalled(id) {
    return this.registry.autoInstalled.includes(id);
  }

  markAutoInstalled(id) {
    if (!this.registry.autoInstalled.includes(id)) {
      this.registry.autoInstalled.push(id);
      this.save();
    }
  }

  dataDirFor(id) {
    return path.join(this.dir, id, 'data');
  }

  // A module's manifest with its text in this environment's words (fillManifest): the stored one itself when it has
  // no placeholders, else a filled copy, kept per set of words.
  manifestOf(id, version) {
    const manifest = this.storedManifestOf(id, version);
    if (!manifest || !this.withPlaceholders.has(manifest)) return manifest;
    const words = this.wordsOf();
    const key = `${id}@${version}|${words ? JSON.stringify(words) : ''}`;
    if (!this.filled.has(key)) {
      if (this.filled.size > 500) this.filled.clear();
      this.filled.set(key, fillManifest(manifest, words));
    }
    return this.filled.get(key);
  }

  // What a person reads a module called: its display name in this environment, else its manifest's name.
  shownName(manifest) {
    return this.displayOf(manifest.id).name || manifest.name;
  }

  storedManifestOf(id, version) {
    const cacheKey = `${id}@${version}`;
    if (this.manifests.has(cacheKey)) return this.manifests.get(cacheKey);
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(this.versionDir(id, version), 'module.json'), 'utf8'));
    } catch {
      // not installed
    }
    if (manifest) {
      // The stored file is the author's original. One that uses an old name (plan-names step 5c) is kept, and shown,
      // but never runs: enabled() answers null for it and view() says why.
      manifest.outdated = oldNameIn(manifest);
      // Fill in what it left out.
      manifest.hooks = Object.fromEntries(HOOKS.map((h) => [h, h === 'ai' ? (manifest.hooks?.ai === 'optional' ? 'optional' : Boolean(manifest.hooks?.ai)) : Boolean(manifest.hooks?.[h])]));
      manifest.scope = cleanScope(manifest.scope);
      if (!Array.isArray(manifest.permissions)) manifest.permissions = [];
      if (!manifest.access || typeof manifest.access !== 'object') manifest.access = {};
      manifest.requires = Array.isArray(manifest.requires) ? manifest.requires.filter((r) => typeof r === 'string' && ID_RE.test(r) && r !== id).slice(0, 5) : [];
      try {
        manifest.refs = cleanRefs(manifest.refs, id);
      } catch {
        manifest.refs = { produces: [], consumes: [] };
      }
      try {
        manifest.storage = cleanStorage(manifest.storage);
      } catch {
        manifest.storage = { renamed: [] };
      }
      // Guards that no longer read are not dropped (that would lift them): every write is refused, the fields kept from
      // guests are kept as far as they still read, and when those don't read either guests get none of its data
      // (unreadableGuards).
      try {
        manifest.guards = cleanGuards(manifest.guards, manifest.permissions.map((p) => p && p.key), ModuleError);
      } catch {
        manifest.guards = unreadableGuards(manifest.guards);
      }
      try {
        const bus = cleanBus(manifest.events, manifest.actions, id, manifest.permissions.map((p) => p && p.key));
        manifest.events = bus.events;
        manifest.actions = bus.actions;
      } catch {
        manifest.events = { publishes: [], subscribes: [] };
        manifest.actions = { provides: [], uses: [] };
      }
      manifest.color = TINTS.includes(manifest.color) ? manifest.color : null;
      manifest.content = manifest.content === 'flush' ? 'flush' : 'padded';
      try {
        manifest.commands = cleanCommands(manifest.commands, manifest.actions);
      } catch {
        manifest.commands = [];
      }
      try {
        manifest.settings = cleanSettings(manifest.settings);
      } catch {
        manifest.settings = [];
      }
      try { manifest.geocoder = cleanGeocoder(manifest.geocoder, manifest.settings); } catch { manifest.geocoder = null; }
      try { manifest.regionSource = cleanRegionSource(manifest.regionSource, manifest.settings); } catch { manifest.regionSource = null; }
      try { manifest.pictureMap = cleanPictureMap(manifest.pictureMap, manifest.settings); } catch { manifest.pictureMap = null; }
      try { manifest.uploads = cleanUploads(manifest.uploads); } catch { manifest.uploads = null; }
      try { manifest.library = cleanLibrary(manifest.library, manifest.scope || [], manifest.permissions); } catch { manifest.library = false; }
      try { manifest.lookups = cleanLookups(manifest.lookups); } catch { manifest.lookups = []; }
      manifest.budget = manifest.budget === true;
      if (hasPlaceholders(manifest)) this.withPlaceholders.add(manifest);
      this.manifests.set(cacheKey, manifest);
    }
    return manifest;
  }

  // The active manifest of an enabled module, with its registry entry, or null.
  // An outdated one (its manifest uses an old name) counts as off, whatever the registry says: it can't run. So does
  // one that requires an outdated one (needsUpdateFor), since what it needs cannot run.
  //
  // Nor does one whose required modules are not all running: turning a module off and uninstalling it already switch
  // what requires it off in the registry, and this keeps that true when the registry says otherwise (a requirement that
  // went off because it was outdated, or because its update waits for approval). The owner's own choice is kept, so it
  // runs again as soon as what it requires does. (The AI service, the other thing `missing` can name, is not checked
  // here: turning it off switches its dependents off itself.)
  enabled(id, seen = new Set()) {
    const entry = this.registry.modules[id];
    if (!entry || !entry.enabled || seen.has(id)) return null;
    const manifest = this.manifestOf(id, entry.version);
    if (!manifest || manifest.outdated || this.needsUpdateFor(manifest).length) return null;
    seen.add(id);
    return (manifest.requires || []).every((r) => this.enabled(r, seen)) ? { manifest, entry } : null;
  }

  // Whether an installed module cannot run until an author updates something: its own manifest is outdated, or one it
  // requires is (at any depth). Whether it is on does not matter here.
  stale(id, seen = new Set()) {
    const entry = this.registry.modules[id];
    if (!entry || seen.has(id)) return false;
    seen.add(id);
    const manifest = this.manifestOf(id, entry.version);
    if (!manifest) return false;
    return Boolean(manifest.outdated) || (manifest.requires || []).some((r) => this.stale(r, seen));
  }

  // The modules a manifest requires that cannot run until their author updates them (or one they require).
  needsUpdateFor(manifest) {
    return (manifest.requires || []).filter((r) => this.stale(r, new Set([manifest.id])));
  }

  // Every enabled module, for lists and for the permissions grid.
  enabledAll() {
    return Object.keys(this.registry.modules).map((id) => this.enabled(id)).filter(Boolean);
  }

  // The enabled module claiming a keyed path (surfaces.keyed.path), with its run mode -- at most one, kept true
  // by the enable guard in update(). null when nothing enabled claims it.
  keyedFor(path) {
    const found = this.enabledAll().find(({ manifest }) => manifest.surfaces.keyed?.path === path);
    return found ? { manifest: found.manifest, entry: found.entry, runMode: this.runModeOf(found.entry) } : null;
  }

  // Every path an enabled module currently claims.
  keyedPaths() {
    return this.enabledAll().filter(({ manifest }) => manifest.surfaces.keyed).map(({ manifest }) => manifest.surfaces.keyed.path);
  }

  // The installed module claiming a path even while off -- for the 404 sentence when a keyed path's module is
  // not enabled. Not the bundled-but-never-installed case (index.js checks the bundled list itself for that,
  // since only it knows where bundled modules live on disk).
  keyedClaimant(path) {
    for (const id of Object.keys(this.registry.modules)) {
      const entry = this.registry.modules[id];
      const manifest = this.manifestOf(id, entry.version);
      if (manifest?.surfaces.keyed?.path === path) return manifest;
    }
    return null;
  }

  // The permissions enabled modules add to the Roles grid: module.<id>.<key>. `defaults` is keyed by the editable
  // roles (moderator, member, guest), whatever the stored manifest calls them.
  permissionList() {
    return this.enabledAll().flatMap(({ manifest }) => manifest.permissions.map((p) => ({
      key: `module.${manifest.id}.${p.key}`,
      label: p.label,
      group: `${word('module', { cap: true })}: ${this.shownName(manifest)}`,
      // A library's permissions are never on for guests (the library routes refuse them whatever Roles says).
      defaults: manifest.library && LIBRARY_PERMISSIONS.includes(p.key) ? { ...permissionDefaults(p.default), guest: false } : permissionDefaults(p.default),
    })));
  }

  // A file of the active version of an enabled module, as an absolute path, or null.
  resolveFile(id, version, rel) {
    const found = this.enabled(id);
    if (!found || found.entry.version !== version) return null;
    if (typeof rel !== 'string' || rel.includes('\0') || rel.split('/').includes('..')) return null;
    const root = this.versionDir(id, version);
    const full = path.join(root, rel);
    if (!full.startsWith(root + path.sep)) return null;
    try {
      return fs.statSync(full).isFile() ? full : null;
    } catch {
      return null;
    }
  }

  // What the active version asks for that an admin hasn't approved yet.
  pendingFor(entry, manifest) {
    const approved = entry.approved || { permissions: [], hooks: [], refs: [], events: [], actions: [] };
    return {
      permissions: manifest.permissions.filter((p) => !approved.permissions.includes(p.key)).map((p) => p.key),
      hooks: HOOKS.filter((h) => manifest.hooks[h] && !approved.hooks.includes(h)),
      refs: manifest.refs.consumes.filter((c) => !(approved.refs || []).includes(c)),
      events: manifest.events.subscribes.filter((c) => !(approved.events || []).includes(c)),
      actions: manifest.actions.uses.filter((c) => !(approved.actions || []).includes(c)),
    };
  }

  hasPending(pending) {
    return pending.permissions.length > 0 || pending.hooks.length > 0 || pending.refs.length > 0 || pending.events.length > 0 || pending.actions.length > 0;
  }

  view(id) {
    const entry = this.registry.modules[id];
    if (!entry) return null;
    const manifest = this.manifestOf(id, entry.version);
    if (!manifest) return null;
    const pending = this.pendingFor(entry, manifest);
    const { outdated, ...shown } = manifest;
    const display = this.displayOf(id);
    return {
      ...shown,
      // `name` and `icon` stay the manifest's own; `displayName`/`displayIcon` are what this environment calls it and
      // shows it as (the owner's, else the template's), null for none; `ownDisplayName`/`ownDisplayIcon` the owner's alone.
      displayName: display.name,
      displayIcon: display.icon,
      ownDisplayName: display.ownName,
      ownDisplayIcon: display.ownIcon,
      // What the environment's template gives it, whether or not the owner's own is set over it (null for none).
      templateDisplayName: display.templateName,
      templateDisplayIcon: display.templateIcon,
      // An outdated module is off (it can't run) and says why: `outdated` for its card, `outdatedWhy` naming the
      // old name its module.json uses. The registry keeps the admin's own choice, so an update that fixes it
      // runs again as it was.
      enabled: Boolean(this.enabled(id)),
      outdated: outdated ? fill(OUTDATED_TEXT) : null,
      outdatedWhy: outdated || null,
      // What it requires that is installed but needs an update from its author first (not in `missing`, since turning it
      // on would not help).
      needsUpdate: this.needsUpdateFor(manifest),
      // No longer live settings: kept so an older page still reads them, fixed (the stored values are ignored).
      allSpaces: true,
      spaces: [],
      // Whether it may be on in the Lobby (surfaces.canvas.lobby).
      lobby: ModuleManager.lobbyAllowed(manifest),
      versions: [...entry.versions].sort(compareVersions).reverse(),
      // The installed versions whose manifest uses an old name: kept, but never run or rolled back to.
      outdatedVersions: [...entry.versions].sort(compareVersions).reverse().filter((v) => this.manifestOf(id, v)?.outdated),
      // What this needs that is not on (module ids, and 'ai' for the AI service), and the enabled modules that need this one.
      missing: this.missingFor(manifest),
      dependents: this.dependentsOf(id),
      needsApproval: this.hasPending(pending),
      source: entry.source || 'upload',
      runMode: this.runModeOf(entry),
      runModeChosen: entry.runMode === 'page' || entry.runMode === 'sandbox',
      riskAcceptedAt: entry.riskAcceptedAt || null,
      pending,
      installedAt: entry.installedAt,
      updatedAt: entry.updatedAt,
    };
  }

  // --- where a module is on (plan-modules, "the Lobby is for being together") -------------------------------------
  // The one check for "is this module on in this space": an enabled module is on in every space (plan-layout-views,
  // "Killing Available in every space"). The stored `allSpaces` and `spaces` stay on the entry, unread. The Lobby keeps
  // its one real rule: only a module whose manifest declares surfaces.canvas.lobby runs there.
  static lobbyAllowed(manifest) {
    return manifest?.surfaces?.canvas?.lobby === true;
  }

  static onInSpace(entry, manifest, spaceId) {
    if (!entry || !manifest) return false;
    if (spaceId === LOBBY && !ModuleManager.lobbyAllowed(manifest)) return false;
    return Boolean(entry.enabled);
  }

  // The same, by id, on its active version.
  isOnIn(id, spaceId) {
    const entry = this.registry.modules[id];
    return entry ? ModuleManager.onInSpace(entry, this.manifestOf(id, entry.version), spaceId) : false;
  }

  // The enabled modules that list `id` in their `requires`.
  dependentsOf(id) {
    const out = [];
    for (const [other, e] of Object.entries(this.registry.modules)) {
      if (other === id || !this.enabled(other)) continue;
      const m = this.manifestOf(other, e.version);
      if (m && (m.requires || []).includes(id)) out.push(other);
    }
    return out;
  }

  // What a manifest needs that is not there: other modules from `requires`, plus `'ai'` when it declares the `ai` hook and
  // the AI service is not enabled. The AI service is not a module (Modules knows nothing else about it), so it is named by
  // this one reserved id rather than added to the registry.
  missingFor(manifest) {
    const waiting = this.needsUpdateFor(manifest);
    const missing = (manifest.requires || []).filter((r) => !waiting.includes(r) && !this.enabled(r));
    if (manifest.hooks.ai === true && !this.aiReady()) missing.push('ai');
    return missing;
  }

  // The enabled modules that declare the `ai` hook as required (an "optional" one works without the service, so it stays on):
  // what depends on the AI service, the way `dependentsOf` says what depends
  // on a module. For the AI service's own admin page, and to cascade turning it off.
  aiDependents() {
    return this.enabledAll().filter(({ manifest }) => manifest.hooks.ai === true).map(({ manifest }) => ({ id: manifest.id, name: this.shownName(manifest) }));
  }

  // A missing id's name for a message: another module's, or "the AI service".
  missingName(r) {
    return r === 'ai' ? 'the AI service' : (this.registry.modules[r] ? this.shownName(this.manifestOf(r, this.registry.modules[r].version)) : r);
  }

  list() {
    const shown = (m) => m.displayName || m.name;
    return Object.keys(this.registry.modules).map((id) => this.view(id)).filter(Boolean).sort((a, b) => shown(a).localeCompare(shown(b)));
  }

  // Where a module runs. A module that ships with the app is the server's own code and runs in the page;
  // an uploaded one runs in a sandboxed frame, unless an admin chose otherwise for it and accepted what
  // that means (see update). `sandbox`: a frame that can reach only what the SDK lets it. `page`: in
  // the page in a container of its own, with the page's own power.
  runModeOf(entry) {
    if (entry.runMode === 'page' || entry.runMode === 'sandbox') return entry.runMode;
    return entry.source === 'bundled' ? 'page' : 'sandbox';
  }

  // What installing this zip over the installed module would newly ask for, without installing anything: { manifest,
  // pending } (pending as pendingFor answers it, or null when the module is not installed). Refuses as install would.
  async preview(buffer) {
    const files = stripWrapperFolder(await readZip(buffer));
    const manifestFile = files.get('module.json');
    if (!manifestFile) throw new ModuleError('module.json is missing from the zip');
    const manifest = cleanManifest(JSON.parse(manifestFile.toString('utf8')), files);
    const entry = this.registry.modules[manifest.id];
    return { manifest, pending: entry ? this.pendingFor(entry, manifest) : null };
  }

  async install(buffer, { source = 'upload' } = {}) {
    if (!buffer || !buffer.length) throw new ModuleError('choose a zip file to install');
    if (buffer.length > LIMITS.zipBytes) throw new ModuleError(`the zip is larger than ${LIMITS.zipBytes / MB} MB`);
    const files = stripWrapperFolder(await readZip(buffer));
    const manifestFile = files.get('module.json');
    if (!manifestFile) throw new ModuleError('module.json is missing from the zip');
    let raw;
    try {
      raw = JSON.parse(manifestFile.toString('utf8'));
    } catch {
      throw new ModuleError("module.json isn't valid JSON");
    }
    const manifest = cleanManifest(raw, files);
    const existing = this.registry.modules[manifest.id];
    if (existing) {
      const newest = [...existing.versions].sort(compareVersions).pop();
      if (compareVersions(manifest.version, newest) <= 0) {
        throw new ModuleError(`${this.shownName(manifest)} ${newest} is already installed; upload a newer version, or use Roll back for an older one`);
      }
    }

    // Unpack next to the final spot, then move into place in one step.
    const finalDir = this.versionDir(manifest.id, manifest.version);
    const staging = path.join(this.dir, `.staging-${process.pid}-${Date.now()}`);
    try {
      for (const [name, data] of files) {
        const target = path.join(staging, name);
        if (!target.startsWith(staging + path.sep)) throw new ModuleError(`bad file name: ${name}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, data);
      }
      fs.mkdirSync(path.dirname(finalDir), { recursive: true });
      fs.rmSync(finalDir, { recursive: true, force: true });
      fs.renameSync(staging, finalDir);
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }

    const now = new Date().toISOString();
    const entry = existing || {
      id: manifest.id, versions: [], enabled: false, allSpaces: false, spaces: [], approved: { permissions: [], hooks: [], refs: [], events: [], actions: [] }, installedAt: now,
    };
    entry.versions.push(manifest.version);
    entry.version = manifest.version;
    entry.updatedAt = now;
    entry.source = source; // 'bundled' (shipped with this deployment) or 'upload'
    // An upgrade that asks for anything new goes back to waiting for approval.
    if (this.hasPending(this.pendingFor(entry, manifest))) entry.enabled = false;
    this.registry.modules[manifest.id] = entry;
    this.manifests.delete(`${manifest.id}@${manifest.version}`);
    this.filled.clear();
    this.prune(entry);
    this.save();
    const view = this.view(manifest.id);
    // An uploaded module that draws or restyles what the host draws is still installed, with a plain warning for the Modules
    // page (plan-unified-layout.md, question 5). Not stored; it is only in this answer.
    if (source !== 'bundled') {
      const broken = layoutWarning(files);
      if (broken) view.layoutWarning = broken;
    }
    return view;
  }

  // Keep only the newest few versions for rollback (never the active one).
  prune(entry) {
    const sorted = [...entry.versions].sort(compareVersions).reverse();
    for (const v of sorted.slice(LIMITS.keepVersions)) {
      if (v === entry.version) continue;
      fs.rmSync(this.versionDir(entry.id, v), { recursive: true, force: true });
      entry.versions = entry.versions.filter((x) => x !== v);
    }
  }

  get(id) {
    const entry = this.registry.modules[id];
    if (!entry) throw new ModuleError(`no such ${word('module')}`, 404);
    return entry;
  }

  // enabled: turning a module on records that the admin approved what its
  // active version asks for. (allSpaces / spaces are ignored: an enabled module is on in every space.)
  // Everything is checked into a draft first and applied only once all of it is accepted: a refused update
  // changes nothing, not this module and not the ones that need it (GitHub #17).
  update(id, patch, { spaceExists = () => true } = {}) {
    const entry = this.get(id);
    const manifest = this.manifestOf(id, entry.version);
    const draft = {}; // the fields of this entry to set
    let switchOff = []; // the modules that need this one, to turn off with it
    if (patch.enabled !== undefined) {
      if (patch.enabled) {
        if (manifest.outdated) throw new ModuleError(`${this.shownName(manifest)} was built for an older version of ${productName()} and needs an update from its author.`, 409);
        const waiting = this.needsUpdateFor(manifest);
        if (waiting.length) throw new ModuleError(`${this.shownName(manifest)} needs ${waiting.map((r) => this.missingName(r)).join(' and ')}, which ${waiting.length === 1 ? 'needs an update from its author' : 'need an update from their authors'}.`, 409);
        const missing = this.missingFor(manifest);
        if (missing.length) throw new ModuleError(`${this.shownName(manifest)} needs ${missing.map((r) => this.missingName(r)).join(' and ')} installed and turned on first`);
        // One enabled module per keyed path: another one already there means naming it, not silently taking over.
        if (manifest.surfaces.keyed) {
          const holder = this.keyedFor(manifest.surfaces.keyed.path);
          if (holder && holder.manifest.id !== id) throw new ModuleError(`"${manifest.surfaces.keyed.path}" is already claimed by ${this.shownName(holder.manifest)}`);
        }
      } else {
        // Turning off a module others need: those go off with it, but only when the caller said so (`force`).
        const needing = this.dependentsOf(id);
        if (needing.length && patch.force !== true) throw new ModuleError(`${needing.map((r) => this.shownName(this.manifestOf(r, this.registry.modules[r].version))).join(' and ')} needs ${this.shownName(manifest)}; turn ${needing.length === 1 ? 'it' : 'them'} off too?`);
        switchOff = needing;
      }
      draft.enabled = Boolean(patch.enabled);
      if (draft.enabled) {
        draft.approved = { permissions: manifest.permissions.map((p) => p.key), hooks: HOOKS.filter((h) => manifest.hooks[h]), refs: [...manifest.refs.consumes], events: [...manifest.events.subscribes], actions: [...manifest.actions.uses] };
      }
    }
    // Running in the page gives a module the page's own power, so for an uploaded module the admin has to
    // say they understand (`acceptRisk`); one that ships with the app already does. Sandboxed is always allowed.
    if (patch.runMode !== undefined) {
      if (patch.runMode === 'sandbox') {
        if (manifest.surfaces.keyed) throw new ModuleError(`this ${word('module')} has a keyed page, so it must run in the page, not a frame`);
        draft.runMode = 'sandbox';
      } else if (patch.runMode === 'page') {
        if (entry.source !== 'bundled' && patch.acceptRisk !== true) throw new ModuleError(`running ${word('module', { a: true })} in the page means accepting the risk`);
        draft.runMode = 'page';
        if (entry.source !== 'bundled') draft.riskAcceptedAt = new Date().toISOString();
      } else {
        throw new ModuleError('runMode must be "page" or "sandbox"');
      }
    }
    // `allSpaces` and `spaces` are accepted and ignored: an enabled module is on in every space (older pages and scripts
    // still send them). The stored values are left as they are.
    // All accepted: apply at once.
    for (const r of switchOff) this.registry.modules[r].enabled = false;
    Object.assign(entry, draft);
    this.save();
    return this.view(id);
  }

  rollback(id, version) {
    const entry = this.get(id);
    if (!entry.versions.includes(version) || version === entry.version) throw new ModuleError('that version is not available');
    if (this.manifestOf(id, version)?.outdated) throw new ModuleError(`${this.shownName(this.manifestOf(id, version))} ${version} was built for an older version of ${productName()}, so it can't be rolled back to.`, 409);
    entry.version = version;
    entry.updatedAt = new Date().toISOString();
    const manifest = this.manifestOf(id, version);
    const pending = this.pendingFor(entry, manifest);
    if (this.hasPending(pending)) entry.enabled = false;
    this.save();
    return this.view(id);
  }

  // The folders (inside modules/<id>/) the module's file settings name, across its installed versions.
  fileFolders(id) {
    const out = new Set();
    const entry = this.registry.modules[id];
    for (const v of (entry && entry.versions) || []) {
      const m = this.manifestOf(id, v);
      for (const d of (m && m.settings) || []) if ((d.type === 'file' || d.type === 'files') && d.folder) out.add(d.folder);
    }
    return out;
  }

  uninstall(id, { keepData = true } = {}) {
    this.get(id);
    // What needed it goes off with it, including one kept from running only because this one was outdated.
    for (const [other, e] of Object.entries(this.registry.modules)) {
      if (other !== id && e.enabled && (this.manifestOf(other, e.version)?.requires || []).includes(id)) e.enabled = false;
    }
    const keep = this.fileFolders(id); // read while the versions are still there
    fs.rmSync(path.join(this.dir, id, 'versions'), { recursive: true, force: true });
    if (!keepData) {
      // Files an admin placed for the module (its `file` settings' folders) are never deleted here: they can be gigabytes and
      // are not the module's data. Everything else in its folder goes.
      const dir = path.join(this.dir, id);
      let names = [];
      try { names = fs.readdirSync(dir); } catch { /* nothing there */ }
      for (const n of names) if (!keep.has(n)) fs.rmSync(path.join(dir, n), { recursive: true, force: true });
      try { fs.rmdirSync(dir); } catch { /* not empty: it holds the admin's files */ }
    }
    delete this.registry.modules[id];
    for (const key of [...this.manifests.keys()]) if (key.startsWith(`${id}@`)) this.manifests.delete(key);
    this.filled.clear();
    this.save();
  }
}

module.exports = { ModuleManager, ModuleError, fillManifest, manifestTexts, cleanManifest, cleanCommands, TINTS, cleanStorage, oldNameIn, OUTDATED, permissionDefaults, pendingWidensNothing, PERMISSION_KEY_RE, readZip, compareVersions, LIMITS };
