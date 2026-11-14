'use strict';

// An owner's copy of their environment (GET /api/environment/export). Built from allow-lists: a field or a file is in
// the copy only when it is named below, so anything added later stays out until someone decides it may go in
// (tools/check-environment-export.mjs fails on a field or file that is on neither list). The host admin's backup
// (POST /api/host/environments/:slug/backup) is not filtered: it stays complete.
//
// What the copy leaves out, and what a restore of it makes again:
//   app.json   secrets (session signing key and stream key: a restore always makes new ones), invites (sign-up links);
//              on each person passwordHash, linkToken (personal link), mfa (two-step secret, pending secret and
//              recovery-code hashes), externalCalendars (addresses sealed with a key the copy does not carry) and
//              calendarFeed (their calendar address), also per space, and firstPassword (a new owner's first-password
//              link: the hash of a one-time token and its end) and agreed (what they agreed to and when: everyone
//              is asked again after a restore of the copy); on each space guestToken (guest link: a new one
//              is made when asked for); settings.publishedCalendarFeed (the published calendar's address).
//   ai.json    key (sealed with the same key): emptied, so the AI service has to be given its key again.
//   files      everything not on FILE_RULES: among them secrets.key (the key a single install sealed with), pre-names/
//              (copies of the data from before the Names migration, which hold the same secrets), agreements.json
//              (guests' agreements: the host's backup carries them, never an owner's copy), access.json (requests to enter
//              a space, by people and guests, and a guest's approvals: the same), chat-private.json and
//              ai-threads.moved.json (other people's private chat), each person's own module data, held clears and
//              uploads (modules/<id>/data/person-<key>.json, modules/<id>/trash/person-<key>.json,
//              modules/<id>/uploads/person-<key>/...: private to that person), a library module's share links
//              (modules/<id>/library/*.shares.json), and half-written files (*.tmp, *.part, names starting with a dot).
//              A left-out file is never in the copy, even where a rule above would allow it.
// The zip's layout is otherwise the backup's, so the host console's restore reads it the same way.

const path = require('path');
const { DEFAULT_SETTINGS } = require('./store');
const { ENVIRONMENT_COPY_DIR, LEGACY_ENVIRONMENT_RECORD } = require('./migrate-names');

const APP_FILE = 'app.json';
const AI_FILE = 'ai.json';
const LAYOUTS_FILE = 'layouts.json';

// --- app.json ------------------------------------------------------------------------------------------------------

// The top level of app.json that goes in the copy, and what is left out.
const APP_FIELDS = ['version', 'migrations', 'template', 'templateHistory', 'templates', 'settings', 'users', 'spaces', 'asides'];
const APP_LEFT_OUT = ['secrets', 'invites'];
// A person (Store#sanitizeUser).
const USER_FIELDS = ['key', 'login', 'displayName', 'role', 'hostAdmin', 'images', 'spaces', 'player', 'callPrefs', 'themeMode', 'createdAt'];
const USER_LEFT_OUT = ['passwordHash', 'linkToken', 'mfa', 'externalCalendars', 'calendarFeed', 'firstPassword', 'agreed'];
// A person's own record for one space (user.spaces[<space id>]).
const USER_SPACE_FIELDS = ['images', 'useDefaultImages', 'permissions', 'joined'];
const USER_SPACE_LEFT_OUT = ['calendarFeed'];
// A space (Store#sanitizeSpace).
const SPACE_FIELDS = ['id', 'name', 'description', 'members', 'createdAt', 'profile', 'link', 'linkIcon', 'allowGuests', 'entry', 'requestAccess', 'closed', 'opensWith', 'defaultLayout', 'tabs', 'aiOff', 'aiSees', 'publishCalendar', 'guestsSeeHidden', 'phases', 'budget', 'template'];
const SPACE_LEFT_OUT = ['guestToken'];
// An aside (Store#sanitizeAside).
const ASIDE_FIELDS = ['id', 'members', 'origin', 'private', 'createdAt'];
// The settings: every default one, the once-only flags load() sets, and those stored only while set.
const SETTINGS_FIELDS = [
  ...Object.keys(DEFAULT_SETTINGS),
  'builtinThemesSeeded', 'iconsSeeded', 'reactionsCuratedSeeded', 'iconsCuratedSeeded', 'homeIconChoiceSeeded',
  'words', 'verbs', 'spaceDefaults', 'otherCalendars', 'spaceTemplates',
];
const SETTINGS_LEFT_OUT = ['publishedCalendarFeed'];

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
// A deep copy of the named fields of `obj` that are there.
function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (Object.prototype.hasOwnProperty.call(obj, f) && obj[f] !== undefined) out[f] = structuredClone(obj[f]);
  return out;
}
const pickEach = (list, fields, each = (x) => x) => (Array.isArray(list) ? list.filter(isObject).map((x) => each(pick(x, fields), x)) : []);

// app.json for the copy, from the live data (Store#data). The live data is never changed.
function exportApp(data) {
  const src = isObject(data) ? data : {};
  const app = pick(src, APP_FIELDS.filter((f) => !['settings', 'users', 'spaces', 'asides'].includes(f)));
  app.settings = pick(isObject(src.settings) ? src.settings : {}, SETTINGS_FIELDS);
  app.users = pickEach(src.users, USER_FIELDS, (user, raw) => {
    if (isObject(raw.spaces)) {
      user.spaces = {};
      for (const [id, own] of Object.entries(raw.spaces)) if (isObject(own)) user.spaces[id] = pick(own, USER_SPACE_FIELDS);
    }
    return user;
  });
  app.spaces = pickEach(src.spaces, SPACE_FIELDS);
  app.asides = pickEach(src.asides, ASIDE_FIELDS);
  return app;
}

// The fields of app.json data on neither list above, by where they are ("users[]: newField"): what the checks fail on, so a
// field added to the store is classified here before anyone relies on the copy.
function unclassifiedFields(data) {
  const src = isObject(data) ? data : {};
  const objects = (list) => (Array.isArray(list) ? list.filter(isObject) : []);
  const levels = [
    ['app.json', [src], APP_FIELDS, APP_LEFT_OUT],
    ['settings', objects([src.settings]), SETTINGS_FIELDS, SETTINGS_LEFT_OUT],
    ['users[]', objects(src.users), USER_FIELDS, USER_LEFT_OUT],
    ['users[].spaces{}', objects(src.users).flatMap((u) => (isObject(u.spaces) ? objects(Object.values(u.spaces)) : [])), USER_SPACE_FIELDS, USER_SPACE_LEFT_OUT],
    ['spaces[]', objects(src.spaces), SPACE_FIELDS, SPACE_LEFT_OUT],
    ['asides[]', objects(src.asides), ASIDE_FIELDS, []],
  ];
  const out = [];
  for (const [level, list, allowed, leftOut] of levels) {
    for (const o of list) for (const k of Object.keys(o)) if (!allowed.includes(k) && !leftOut.includes(k)) out.push(`${level}: ${k}`);
  }
  return [...new Set(out)];
}

// --- ai.json -------------------------------------------------------------------------------------------------------

// ai.json for the copy: the same settings with the key emptied. A file that cannot be read is left out.
function exportAi(buffer) {
  let ai;
  try { ai = JSON.parse(Buffer.from(buffer).toString('utf8')); } catch { return null; }
  if (!isObject(ai)) return null;
  if ('key' in ai) ai.key = '';
  return ai;
}

// --- layouts.json ----------------------------------------------------------------------------------------------------

// layouts.json for the copy: the same file without each person's last layout (`last`, plan-workspaces.md decision 20).
// It is personal state, the layout a person last opened in a space, so it stays with the environment that kept it and
// does not travel in an owner's copy. A file that is not JSON in the shape of the layouts file is passed on as it is.
function exportLayouts(buffer) {
  let file;
  try { file = JSON.parse(Buffer.from(buffer).toString('utf8')); } catch { return buffer; }
  if (!isObject(file) || !isObject(file.spaces)) return buffer;
  for (const entry of Object.values(file.spaces)) if (isObject(entry)) delete entry.last;
  return Buffer.from(`${JSON.stringify(file, null, 2)}\n`);
}

// --- files ---------------------------------------------------------------------------------------------------------

const MODULE_ID = '[a-z][a-z0-9-]{1,31}';
const SPACE_ID = '[a-z0-9]{4,16}';
// The files an environment's folder holds that go in the copy, by their path in it. app.json and ai.json are made
// above. `declared`: a module's own folders for the files an owner places (its manifest's file settings).
const FILE_RULES = [
  /^(chat|layouts|attention|facts|tags|ai-usage)\.json$/,
  /^ai-log\.jsonl$/,
  /^images\/.+$/,
  /^modules\/(registry|settings|activity|announced|links|schedules|notifications|bus)\.json$/,
  new RegExp(`^modules/${MODULE_ID}/(data|trash)/[^/]+\\.json$`),
  new RegExp(`^modules/${MODULE_ID}/(uploads|versions)/.+$`),
  new RegExp(`^modules/${MODULE_ID}/library/space-${SPACE_ID}\\.json$`),
  new RegExp(`^modules/${MODULE_ID}/geocode\\.json$`),
];
// Never in the copy, whatever a rule says: a half-written file, or one the server keeps out of sight.
const half = (name) => name.split('/').some((part) => part.startsWith('.')) || /\.(tmp|part)$/.test(name);
// What the server may keep in an environment's folder that is deliberately left out (the guard check's other list).
const FILE_LEFT_OUT = [
  /^secrets\.key$/,
  /^modules\/secrets\.json$/, // the sealed values of modules' `secret` settings (server/module-secrets.js): never in an owner's copy
  new RegExp(`^${ENVIRONMENT_COPY_DIR}/`),
  /^chat-private\.json$/,
  /^agreements(\.unreadable-\d+)?\.json$/, // guests' agreements (server/agreements.js): the host's backup only
  /^access(\.unreadable-\d+)?\.json$/, // access requests and the grants a guest holds (server/access-requests.js): the host's backup only
  /^ai-threads(\.moved)?\.json$/,
  (name) => name === LEGACY_ENVIRONMENT_RECORD, // the older name of app.json: only app.json speaks for the environment
  /^tmp\//,
  new RegExp(`^modules/${MODULE_ID}/library/[^/]+\\.shares\\.json$`),
  // Each person's own module data, held clears and uploads: private to that person, so not the owner's to carry.
  new RegExp(`^modules/${MODULE_ID}/(data|trash)/person-[^/]+$`),
  new RegExp(`^modules/${MODULE_ID}/uploads/person-[^/]+/.+$`),
];

// Whether a file of the folder goes in the copy. `declared(id)`: the folders module <id> declares for its files.
function fileAllowed(name, declared = () => []) {
  if (half(name) || name.includes('\\') || name.split('/').some((p) => p === '' || p === '..')) return false;
  if (fileLeftOut(name)) return false;
  if (FILE_RULES.some((rule) => rule.test(name))) return true;
  const m = new RegExp(`^modules/(${MODULE_ID})/([a-z0-9][a-z0-9-]{0,31})/.+$`).exec(name);
  return Boolean(m && declared(m[1]).includes(m[2]));
}
const fileLeftOut = (name) => half(name) || FILE_LEFT_OUT.some((rule) => (typeof rule === 'function' ? rule(name) : rule.test(name)));

// The entries of an owner's copy, from the folder's files ([name, Buffer], as walkFiles gives them) and the live
// app.json data. `declared` as for fileAllowed.
function exportEntries(files, appData, { declared } = {}) {
  const out = [];
  for (const [name, data] of files) {
    if (name === APP_FILE) continue;
    if (name === AI_FILE) {
      const ai = exportAi(data);
      if (ai) out.push([name, Buffer.from(`${JSON.stringify(ai, null, 2)}\n`)]);
      continue;
    }
    if (name === LAYOUTS_FILE && fileAllowed(name, declared)) { out.push([name, exportLayouts(data)]); continue; }
    if (fileAllowed(name, declared)) out.push([name, data]);
  }
  out.unshift([APP_FILE, Buffer.from(`${JSON.stringify(exportApp(appData), null, 2)}\n`)]);
  return out;
}

// --- a restore ------------------------------------------------------------------------------------------------------

// The files of a zip being restored (POST /api/host/environments/:slug/restore), with the session and stream keys taken
// out of the environment's record (app.json, or its older name), so the restored environment always makes new ones:
// nobody chooses them by writing a zip, and everyone signs in again. A restore is hosted only, and a hosted environment's
// only admin is the host admin's stand-in (hostAdmin: true), so every other record with role `admin` (a single install's
// admin, or a hand-made one) is restored as an `owner`, as moving a single install into a host does (ownersFromServerAdmin
// in index.js). A record that is not JSON is left as it is (the restore refuses it before this).
// `backup`: the zip is the host's own backup (kept complete, with what people agreed to). Otherwise it is taken as an
// owner's copy, which never carries agreements: any `agreed` on a person and any agreements.json is dropped, so nobody
// is let in on an agreement a zip says they made.
function restoreEntries(files, { backup = false } = {}) {
  const kept = backup ? files : files.filter(([name]) => !/^(agreements|access)(\.unreadable-\d+)?\.json$/.test(path.posix.normalize(name)));
  return kept.map(([name, data]) => {
    const where = path.posix.normalize(name);
    if (where !== APP_FILE && where !== LEGACY_ENVIRONMENT_RECORD) return [name, data];
    let app;
    try { app = JSON.parse(Buffer.from(data).toString('utf8')); } catch { return [name, data]; }
    if (!isObject(app)) return [name, data];
    const admins = Array.isArray(app.users) ? app.users.filter((u) => isObject(u) && u.role === 'admin' && !u.hostAdmin) : [];
    const agreed = !backup && Array.isArray(app.users) && app.users.some((u) => isObject(u) && 'agreed' in u);
    if (!('secrets' in app) && !admins.length && !agreed) return [name, data];
    delete app.secrets;
    for (const u of admins) u.role = 'owner';
    if (!backup && Array.isArray(app.users)) for (const u of app.users) if (isObject(u)) delete u.agreed;
    return [name, Buffer.from(`${JSON.stringify(app, null, 2)}\n`)];
  });
}

module.exports = {
  exportEntries, restoreEntries, exportApp, exportAi, exportLayouts, fileAllowed, fileLeftOut, unclassifiedFields,
  APP_FIELDS, APP_LEFT_OUT, USER_FIELDS, USER_LEFT_OUT, USER_SPACE_FIELDS, USER_SPACE_LEFT_OUT,
  SPACE_FIELDS, SPACE_LEFT_OUT, ASIDE_FIELDS, SETTINGS_FIELDS, SETTINGS_LEFT_OUT,
};
