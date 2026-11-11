// One environment's own services: everything under the seam server/index.js reaches by name (store, modules,
// moduleData, moduleHooks, chatHistory, moduleLinks, moduleBus, moduleSettings, ai, moduleUploads, vault, geocodeCache,
// regionCutJobs, and the smaller in-memory state beside them), built once from one data directory. This is
// phase 1 of documentation/plans/plan-environments.md: with no BASE_DOMAIN there is exactly one environment, built
// from DATA_DIR directly -- this file is what that construction always was, factored out so index.js can build
// the same set again for each environment's own directory (DATA_DIR/environments/<slug>/), and index.js's request handlers
// keep reading `store`, `modules` and the rest by the names they use today (see the AsyncLocalStorage + Proxy
// wiring in index.js, right after this file's exports are required).
//
// What is NOT built here, because it is the host's, not any one environment's: the LiveKit client for the call
// service (one call service, shared -- each environment's calls are named apart, see server/call-names.js), the pre-made backgrounds and Font
// Awesome files (part of the app itself, or an admin's own Pro package at DATA_DIR/fontawesome-pro -- see the
// migration note in plan-environments.md: that folder and host.json are the two things a migration never moves).
'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { Store, randomToken } = require('./store');
const { ModuleManager } = require('./modules');
const { ModuleData } = require('./module-data');
const { ModuleHolds, HOLD_SECONDS } = require('./module-holds');
const { ModuleHooks } = require('./module-hooks');
const { ChatHistory } = require('./chat-history');
const { Attention } = require('./attention');
const { Facts } = require('./facts');
const { Tags } = require('./tags');
const { ModuleLinks } = require('./module-links');
const { ModuleBus } = require('./module-bus');
const { ModuleSettings } = require('./module-settings');
const { Ai } = require('./ai');
const { ModuleUploads } = require('./module-uploads');
const { VaultStore } = require('./vault-store');
const { GUEST_LOCKED } = require('./vault-types');
const { GeocodeCache } = require('./geocode');
const { RegionCutJobs } = require('./region-cut');
const { ModuleLimits } = require('./module-limits');
const { ExternalCalendars } = require('./external-calendars');
const { LiveRegister } = require('./live');
const { ModuleLive } = require('./module-live');
const { fetchCalendar } = require('./link-preview');
const auth = require('./auth');
const { migrateEnvironment } = require('./migrate-names');

// The same read-access guard index.js's route handlers use (its own moduleCan), needed here only for
// ModuleHooks' resolveRecipients. Duplicated rather than shared, since it is three lines and pure, and this file
// must not require index.js (index.js requires this one).
function moduleCan(manifest, perms, need) {
  const guard = need && manifest.access?.[need];
  return !guard || Boolean(perms[`module.${manifest.id}.${guard}`]);
}

// Builds and wires one environment's full set of services from its own data directory: everything that used to
// run once, globally, at server startup now runs here -- once per environment, whether that is the single
// default environment (no BASE_DOMAIN) or one environment's own directory.
//
// `admin`, when given `{ login, password }`, makes the server's admin on a single-environment install (plan-names
// decision 7): ADMIN_LOGIN and ADMIN_PASSWORD on every start. The account with that login becomes `admin` (an install
// upgraded by step 4 had made it an owner) and takes that password when it differs; with no such account one is
// made. With no password set, only a brand-new install (no accounts at all) gets an admin, with a random password
// logged once; an install with accounts gets nothing made and nobody promoted, and one line in the log. Only
// for the default environment; a hosted environment's server admin is the host admin, in host.json.
//
// `managed`, when given, is the function this environment's own Ai instance calls to read the host's managed
// AI service (documentation/plans/plan-environments.md, "Managed AI") -- index.js's own, closing over the host
// registry and the AI_* environment variables. Defaults to offering none, for a caller (a test) that does not
// need it. `secretsKey`, when given, returns the key (a 32-byte Buffer) the environment's own AI key is encrypted
// with at rest in ai.json -- index.js's secretsKeyBuf, the same key as every two-step secret. Without it (a test
// that does not need it) the AI key is kept as it was given. `vaultDir` is the folder this environment's library files
// (server/vault-store.js) keep their bytes in: index.js names it under VAULT_DIR; without it (a test), <dataDir>/vault.
// `onVaultBytes(delta)` is told every change in what they keep (index.js's total for VAULT_MAX_GB).
function buildEnvironment(dataDir, { slug = null, admin = null, log = console.log, managed = () => null, secretsKey = null, vaultDir = null, onVaultBytes = () => {}, vaultSweepMs = 10000 } = {}) {
  // The Names migration (documentation/plans/plan-names.md, "The migration") runs before Store reads app.json, so
  // every service below reads this environment's data in its current shape. Throws a MigrationError naming the
  // file when a part cannot finish, and nothing is built.
  migrateEnvironment(dataDir, { log });
  const store = new Store(dataDir);
  const modules = new ModuleManager(dataDir);
  const moduleData = new ModuleData(modules.dir);
  // What a Clear took, held for its Undo (server/module-holds.js); index.js sets runIn and onExpire.
  const moduleHolds = new ModuleHolds(modules.dir, { holdSeconds: undoSeconds(process.env.CLEAR_UNDO_SECONDS) });
  store.extraPermissions = () => modules.permissionList(); // enabled modules' permissions join the Roles grid
  // The permissions guests never have, whatever is stored for them: a library module's (server/vault-types.js) and changing the
  // space's tags (server/tags.js).
  store.guestLocked = () => [...modules.enabledAll().filter(({ manifest }) => manifest.library).flatMap(({ manifest }) => GUEST_LOCKED.map((k) => `module.${manifest.id}.${k}`)), 'manageTags'];
  // A manifest's text in this environment's words, and a module's display name and icon (server/store.js).
  modules.wordsOf = () => store.resolvedWords();
  modules.beforeOff = (id) => { for (const m of [id, ...modules.dependentsOf(id)]) moduleHolds.expireModule(m); };
  modules.displayOf = (id) => store.moduleDisplay(id);
  store.moduleIconIds = () => Object.entries(modules.registry.modules).map(([id, e]) => modules.storedManifestOf(id, e.version)?.icon).filter(Boolean);

  // Who a module notification reaches: people who could see that module in that place.
  const moduleHooks = new ModuleHooks(modules.dir, {
    resolveRecipients: ({ module, spaceId }, to) => {
      const found = modules.enabled(module);
      if (!found) return [];
      let keys = [];
      if (to === 'space') keys = spaceId ? store.spaceById(spaceId)?.members || [] : [];
      else if (to === 'environment') keys = store.users.map((u) => u.key);
      else keys = store.userByKey(to) ? [to] : [];
      return keys.filter((k) => store.userByKey(k) && moduleCan(found.manifest, store.spacePermissions(k, spaceId), 'read'));
    },
  });
  moduleHooks.start();

  const limiter = new auth.LoginLimiter();
  const moduleLimits = new ModuleLimits();

  if (admin) {
    const login = admin.login || 'admin';
    const password = admin.password || admin.key;
    const existing = store.userByLogin(login);
    if (!password) {
      // No password set: only a brand-new install (no accounts at all) gets an admin, with a random password logged
      // once. Anywhere else nothing is made and nobody is promoted, not even an owner with the default login.
      if (store.users.length === 0) {
        const given = randomToken(9);
        const made = store.addUser({ login, displayName: login, role: 'member', passwordHash: auth.hashPassword(given) });
        store.setServerAdmin(made.key);
        log(`No admin yet and no ADMIN_PASSWORD set. Created "${login}" with password: ${given}`);
      } else if (store.serverAdmins().length === 0) {
        log('This install has no server admin. Set ADMIN_LOGIN and ADMIN_PASSWORD, then restart, to have one.');
      }
    } else if (existing && existing.hostAdmin) {
      log(`"${login}" is the host admin's account here, so ADMIN_LOGIN cannot make it the server's admin. Choose another ADMIN_LOGIN.`);
    } else if (existing) {
      // Made (again) the admin: an install upgraded by step 4 had made this account an owner. The password is set only
      // when it differs, so a restart with the same ADMIN_PASSWORD signs nobody out.
      const samePassword = existing.passwordHash && auth.verifyPassword(password, existing.passwordHash);
      if (existing.role !== 'admin' || !samePassword) {
        store.setServerAdmin(existing.key, samePassword ? undefined : auth.hashPassword(password));
        log(`Admin "${login}" updated from the environment.`);
      }
    } else {
      const made = store.addUser({ login, displayName: login, role: 'member', passwordHash: auth.hashPassword(password) });
      store.setServerAdmin(made.key);
      log(`Admin "${login}" created from the environment.`);
    }
  }

  // Who is on the site, in which space and on the call (server/live.js: the live streams and POST /api/presence), and
  // pending two-person invitations -- both in memory only, never meeting another environment's. liveEvents tells the
  // open live streams (GET /api/live) of a change: ('presence', spaceId); what the server tells a space's chat (tellChat
  // in index.js): ('chat', spaceId, { type, ... }); and that who may read changed: ('access').
  const live = new LiveRegister();
  const liveEvents = new EventEmitter();
  liveEvents.setMaxListeners(0);
  // Modules' live messages (server/module-live.js): who has a module stream open in which space, who joined which
  // module's live messages there, the rates and the sequence numbers. In memory only, never meeting another environment's.
  const moduleLive = new ModuleLive();
  const invites = new Map(); // id -> { id, from, to, spaceId, at }
  const inviteEvents = new EventEmitter();
  inviteEvents.setMaxListeners(0);
  // The theme changed (the owner's theme, its colors or its default mode: 'theme'), or one person picked their own
  // light or dark ('mode'): told to every open page over /api/notifications/stream so it switches without a reload.
  const themeEvents = new EventEmitter();
  themeEvents.setMaxListeners(0);
  // The module list changed (a module installed, turned on or off, rolled back or removed): told to every open page over
  // /api/notifications/stream as a bare 'modules' event (no ids), and each page asks again for what it may see.
  const moduleEvents = new EventEmitter();
  moduleEvents.setMaxListeners(0);

  // The chat pictures relayed lately (POST /api/spaces/:id/chat/pictures): never their bytes, only id -> { space, by, at },
  // so the person who sent one (or a moderator) can delete it for everyone and Clear... can take it.
  const chatPictures = new Map();

  const chatHistory = new ChatHistory(dataDir);
  // Once, on the first start after the one chat store (plan-chat-model.md): the old private AI threads move in as
  // private messages, and ai-threads.json is renamed to ai-threads.moved.json. A later start does nothing.
  const movedThreads = chatHistory.moveThreads((key) => store.userByKey(key)?.displayName || null);
  if (movedThreads) log(`Moved ${movedThreads} private AI ${movedThreads === 1 ? 'message' : 'messages'} into the chat.`);
  const chatPosts = new Map(); // who -> recent post times, to keep one person from flooding a space's history
  // "<space id>:<message id>" -> when its link's preview was asked for (plan-chat-links.md): one read per message, never
  // retried after a failure, and never two at once. Only a message's first five minutes count, so older ones are dropped.
  const chatPreviewsAsked = new Map();

  const attention = new Attention(dataDir);
  const facts = new Facts(dataDir);
  const tags = new Tags(dataDir); // the shared tags, one list per space (server/tags.js)
  const moduleLinks = new ModuleLinks(modules.dir);
  const moduleBus = new ModuleBus(modules.dir);
  const moduleSettings = new ModuleSettings(modules.dir);

  const ai = new Ai(dataDir, process.env, undefined, managed, secretsKey);
  modules.aiReady = () => ai.ready(); // a module declaring hooks.ai depends on the AI service the way one module depends on another

  // A person's other calendars (plan-google-calendar.md, Part 2): read through the private-address guard, kept in
  // memory. Their addresses are sealed with the same key as every other secret; without a key (a test that does not
  // need it) none can be opened, so none is read.
  const externalCalendars = new ExternalCalendars({
    store,
    open: (sealed) => (secretsKey ? auth.decryptSecret(sealed, secretsKey()) : null),
    fetch: fetchCalendar,
  });

  const moduleUploads = new ModuleUploads(modules.dir);
  // A space's library files: their bytes in the vault folder, their records beside the module's data.
  const vault = new VaultStore({ bytesDir: vaultDir || path.join(dataDir, 'vault'), modulesDir: modules.dir, onBytes: onVaultBytes, spaceExists: (id) => Boolean(store.spaceById(id)), budgetMs: vaultSweepMs });
  // Once, with counts, only when something was found.
  {
    const w = vault.swept;
    const found = [
      [w.parts, 'unfinished upload'], [w.orphans, 'file with no record', 'files with no record'], [w.missing, 'record whose file is missing', 'records whose files are missing'],
      [w.folders, 'empty or leftover folder'], [w.spaces, `deleted ${store.word('space')} still holding files`, `deleted ${store.word('space', { many: true })} still holding files`],
    ].filter(([n]) => n).map(([n, one, many]) => `${n} ${n === 1 ? one : (many || `${one}s`)}`);
    if (found.length) log(`Library sweep of ${vaultDir || path.join(dataDir, 'vault')}: ${found.join(', ')}${w.partial ? ' (stopped early; the rest on the next start)' : ''}.`);
  }
  const geocodeCache = new GeocodeCache(modules.dir);
  const regionCutJobs = new RegionCutJobs(dataDir);

  // A Font Awesome icon as inline SVG, cached by id -- keyed off this environment's own custom icons
  // (store.settings.icons), so two environments' same id can mean two different icons.
  const iconSvgs = new Map();

  // What modules have been doing (DATA_DIR/modules/activity.json), for the admin's activity list. Written a few
  // seconds after a change and on the way out (see flushEnvironment).
  const activityFile = path.join(modules.dir, 'activity.json');
  const moduleActivity = (() => {
    try {
      const raw = JSON.parse(fs.readFileSync(activityFile, 'utf8'));
      return Array.isArray(raw) ? raw.slice(-300) : [];
    } catch {
      return [];
    }
  })();
  let activityTimer = null;
  function saveActivity() {
    if (activityTimer) clearTimeout(activityTimer);
    activityTimer = null;
    try {
      fs.mkdirSync(path.dirname(activityFile), { recursive: true });
      fs.writeFileSync(`${activityFile}.tmp`, JSON.stringify(moduleActivity));
      fs.renameSync(`${activityFile}.tmp`, activityFile);
    } catch {
      // the log is a convenience
    }
  }
  function noteActivity(module, what, by, scopeKey) {
    moduleActivity.push({ at: Date.now(), module, what, by: by || null, scope: scopeKey || null });
    if (moduleActivity.length > 300) moduleActivity.shift();
    if (!activityTimer) { activityTimer = setTimeout(saveActivity, 5000); if (activityTimer.unref) activityTimer.unref(); }
  }
  moduleData.on('change', (c) => noteActivity(c.module, `${c.deleted ? 'deleted' : 'saved'} ${c.key}`, c.by, c.scopeKey));
  moduleData.on('changes', (c) => noteActivity(c.module, `${c.restored ? 'put back' : 'cleared'} ${c.changes.length} ${c.changes.length === 1 ? 'key' : 'keys'}`, c.by, c.scopeKey));
  moduleBus.on('event', (e) => noteActivity(e.module, `published the event ${e.name}`, e.by, e.scopeKey));
  moduleBus.on('action', (a) => noteActivity(a.from, `asked ${a.provider} to ${a.action}`, a.by, a.scopeKey));
  // The upload sweep (plan-object-handoff.md, "Send to...", pictures): Chat uploads a picture into the target module's
  // uploads, then asks for the action with the file's id. A request that went without being carried out (seven days
  // unclaimed, or pushed out by the cap) takes its picture with it, only when the file is in the request's own place,
  // was uploaded by the person who asked, and the module's data there does not name it (some other request used it).
  moduleBus.on('actionsDropped', (list) => {
    for (const a of list) {
      const ids = Object.values(a.input || {})
        .filter((v) => v && typeof v === 'object' && v.kind === 'image' && typeof v.details?.upload === 'string')
        .map((v) => v.details.upload);
      for (const fid of ids) {
        try {
          const meta = moduleUploads.meta(a.provider, a.scopeKey, fid);
          if (!meta || meta.by !== a.by) continue;
          if (JSON.stringify(moduleData.list(a.provider, a.scopeKey)).includes(fid)) continue;
          if (moduleHolds.holdsFile(a.provider, a.scopeKey, fid)) continue; // a Clear's Undo may still bring it back
          if (moduleUploads.remove(a.provider, a.scopeKey, fid)) noteActivity(a.provider, `removed a picture sent to it that was never added (${meta.name || fid})`, a.by, a.scopeKey);
        } catch {
          // a place that no longer reads: the file stays, as any upload does
        }
      }
    }
  });
  moduleSettings.on('change', (c) => {
    if (c.scope === 'person') return;
    const where = c.scope === 'space' ? ` for ${store.spaceById(c.spaceId)?.name || store.word('space', { a: true })}` : '';
    noteActivity(c.module, `changed the ${store.word(c.scope)} settings${where}: ${c.keys.join(', ')}`, c.by, null);
  });
  regionCutJobs.on('done', (id) => { const j = regionCutJobs.jobs.get(id); if (j) noteActivity(j.moduleId, `cut a map region: ${j.name}`, j.by, null); });
  regionCutJobs.on('error', (id, error) => { const j = regionCutJobs.jobs.get(id); if (j) noteActivity(j.moduleId, `could not cut a map region: ${error}`, j.by, null); });

  return {
    slug, dataDir,
    store, modules, moduleData, moduleHolds, moduleHooks, chatHistory, attention, facts, tags, moduleLinks, moduleBus, moduleSettings, ai, moduleUploads, vault,
    geocodeCache, regionCutJobs, moduleLimits, limiter, live, liveEvents, moduleLive, invites, inviteEvents, themeEvents, moduleEvents, chatPictures, chatPosts, chatPreviewsAsked, iconSvgs,
    moduleActivity, noteActivity, saveActivity, externalCalendars,
  };
}

// How long a Clear can be undone, in seconds (CLEAR_UNDO_SECONDS): a whole number from 1 to 600, else 30.
function undoSeconds(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 600 ? n : HOLD_SECONDS;
}

// Every write this environment might still owe the disk, at shutdown or when it is set aside (suspended, or
// moved to environments-deleted/): each singleton here already writes synchronously on every change except these
// four, which only debounce and flush on the way out.
function flushEnvironment(env) {
  env.chatHistory.flush();
  env.ai.flush();
  env.geocodeCache.flush();
  env.saveActivity();
}

// An environment set aside for good (deleted, or about to be replaced by a backup's files): what it owes the disk is
// written, and the timers that would still act on its old data stop. A Clear waiting for its Undo is left on disk as it
// is: the environment built next from that folder finishes it (server/module-holds.js, sweep).
function setAsideEnvironment(env) {
  flushEnvironment(env);
  env.moduleHolds.stop();
}

module.exports = { buildEnvironment, flushEnvironment, setAsideEnvironment };
